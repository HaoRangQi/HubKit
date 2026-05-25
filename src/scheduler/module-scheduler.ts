import { config, ModuleSchedule } from '../config/config';
import { ModuleRegistry } from '../registry/module-registry';
import { ModuleStatus } from '../types/module';
import { ModuleLifecycle } from '../runtime/module-lifecycle';

export type ScheduleAction = 'start' | 'stop';

export interface ScheduleTriggerResult {
  moduleId: string;
  action: ScheduleAction;
  success: boolean;
  skipped?: boolean;
  message: string;
  error?: string;
  triggeredAt: string;
}

export interface NextScheduleAction {
  action: ScheduleAction;
  at: string;
  time: string;
}

export interface ModuleScheduleStatus {
  enabled: boolean;
  nextAction: NextScheduleAction | null;
  lastResult: ScheduleTriggerResult | null;
}

/**
 * 模块定时调度器
 *
 * 每分钟检查一次所有模块的定时规则，匹配当前时间则触发启动/停止
 */
export class ModuleScheduler {
  private timer?: NodeJS.Timeout;
  private registry: ModuleRegistry;
  private onEvent?: (event: ScheduleTriggerResult & { type: string }) => void;
  /** 防止同一分钟内重复触发：moduleId:HH:MM:action */
  private firedKeys: Set<string> = new Set();
  /** 上次清理 firedKeys 的小时 */
  private lastCleanupHour: number = -1;
  private lastResults: Map<string, ScheduleTriggerResult> = new Map();
  private lifecycle: ModuleLifecycle;

  constructor(registry: ModuleRegistry, lifecycle: ModuleLifecycle = new ModuleLifecycle()) {
    this.registry = registry;
    this.lifecycle = lifecycle;
  }

  setEventListener(fn: (event: any) => void): void {
    this.onEvent = fn;
  }

  getScheduleStatus(moduleId: string, schedule?: ModuleSchedule, from: Date = new Date()): ModuleScheduleStatus {
    return {
      enabled: schedule?.enabled === true,
      nextAction: getNextScheduleAction(schedule, from),
      lastResult: this.lastResults.get(moduleId) || null,
    };
  }

  start(): void {
    if (this.timer) return;
    // 立即执行一次，再每 30 秒检查一次
    this.tick().catch(err => console.error('[scheduler] tick error:', err));
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error('[scheduler] tick error:', err));
    }, 30 * 1000);
    console.log('[scheduler] 定时调度器已启动');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;
    const dayOfWeek = now.getDay();

    // 整点切换时清空已触发记录（避免无限增长）
    if (now.getHours() !== this.lastCleanupHour) {
      this.firedKeys.clear();
      this.lastCleanupHour = now.getHours();
    }

    const settings = config.getSettings();
    const schedules = settings.schedules || {};

    for (const moduleId of Object.keys(schedules)) {
      const schedule = schedules[moduleId];
      if (!schedule || !schedule.enabled) continue;

      // 星期过滤
      if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0
          && !schedule.daysOfWeek.includes(dayOfWeek)) {
        continue;
      }

      const module = this.registry.get(moduleId);
      if (!module) continue;

      if (schedule.startTime && schedule.startTime === currentTime) {
        const key = `${moduleId}:${currentTime}:start`;
        if (!this.firedKeys.has(key)) {
          this.firedKeys.add(key);
          await this.triggerAction(moduleId, 'start');
        }
      }

      if (schedule.stopTime && schedule.stopTime === currentTime) {
        const key = `${moduleId}:${currentTime}:stop`;
        if (!this.firedKeys.has(key)) {
          this.firedKeys.add(key);
          await this.triggerAction(moduleId, 'stop');
        }
      }
    }
  }

  private async triggerAction(moduleId: string, action: ScheduleAction): Promise<void> {
    const module = this.registry.get(moduleId);
    if (!module) return;

    try {
      const status = await this.lifecycle.status(module);

      if (action === 'start') {
        if (status.status === ModuleStatus.RUNNING) {
          console.log(`[scheduler] ${moduleId} 已在运行，跳过定时启动`);
          this.recordResult(moduleId, action, true, `${module.name} 已在运行，跳过定时启动`, { skipped: true });
          return;
        }
        await this.lifecycle.start(module);
        console.log(`[scheduler] 定时启动: ${module.name}`);
        this.recordResult(moduleId, action, true, `${module.name} 已按计划启动`);
      } else {
        if (status.status !== ModuleStatus.RUNNING) {
          console.log(`[scheduler] ${moduleId} 未在运行，跳过定时停止`);
          this.recordResult(moduleId, action, true, `${module.name} 未在运行，跳过定时停止`, { skipped: true });
          return;
        }
        await this.lifecycle.stop(module);
        console.log(`[scheduler] 定时停止: ${module.name}`);
        this.recordResult(moduleId, action, true, `${module.name} 已按计划停止`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] ${action} 失败 ${moduleId}: ${errMsg}`);
      this.recordResult(moduleId, action, false, `${action === 'start' ? '定时启动' : '定时停止'}失败`, { error: errMsg });
    }
  }

  private recordResult(
    moduleId: string,
    action: ScheduleAction,
    success: boolean,
    message: string,
    options: { skipped?: boolean; error?: string } = {}
  ): void {
    const result: ScheduleTriggerResult = {
      moduleId,
      action,
      success,
      skipped: options.skipped,
      message,
      error: options.error,
      triggeredAt: new Date().toISOString(),
    };
    this.lastResults.set(moduleId, result);
    this.onEvent?.({ type: 'schedule_triggered', ...result });
  }

}

export function getNextScheduleAction(schedule: ModuleSchedule | undefined, from: Date = new Date()): NextScheduleAction | null {
  if (!schedule?.enabled) return null;

  const actions: Array<{ action: ScheduleAction; time: string }> = [];
  if (isValidTime(schedule.startTime)) actions.push({ action: 'start', time: schedule.startTime! });
  if (isValidTime(schedule.stopTime)) actions.push({ action: 'stop', time: schedule.stopTime! });
  if (actions.length === 0) return null;

  const allowedDays = Array.isArray(schedule.daysOfWeek)
    ? schedule.daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  const candidates: NextScheduleAction[] = [];

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    for (const action of actions) {
      const candidate = new Date(from);
      candidate.setDate(from.getDate() + dayOffset);
      candidate.setSeconds(0, 0);
      const [hour, minute] = action.time.split(':').map(Number);
      candidate.setHours(hour, minute, 0, 0);

      if (candidate <= from) continue;
      if (allowedDays.length > 0 && !allowedDays.includes(candidate.getDay())) continue;
      candidates.push({
        action: action.action,
        at: candidate.toISOString(),
        time: action.time,
      });
    }
  }

  return candidates.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] || null;
}

function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

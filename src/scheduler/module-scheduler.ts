import { config, ModuleSchedule } from '../config/config';
import { ModuleRegistry } from '../registry/module-registry';
import { NodeJSAdapter } from '../adapters/nodejs-adapter';
import { PythonAdapter } from '../adapters/python-adapter';
import { ShellAdapter } from '../adapters/shell-adapter';
import { ModuleProtocol, ModuleStatus } from '../types/module';

/**
 * 模块定时调度器
 *
 * 每分钟检查一次所有模块的定时规则，匹配当前时间则触发启动/停止
 */
export class ModuleScheduler {
  private timer?: NodeJS.Timeout;
  private registry: ModuleRegistry;
  private onEvent?: (event: { type: string; moduleId: string; action: 'start' | 'stop'; success: boolean; error?: string }) => void;
  /** 防止同一分钟内重复触发：moduleId:HH:MM:action */
  private firedKeys: Set<string> = new Set();
  /** 上次清理 firedKeys 的小时 */
  private lastCleanupHour: number = -1;

  constructor(registry: ModuleRegistry) {
    this.registry = registry;
  }

  setEventListener(fn: (event: any) => void): void {
    this.onEvent = fn;
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

  private async triggerAction(moduleId: string, action: 'start' | 'stop'): Promise<void> {
    const module = this.registry.get(moduleId);
    if (!module) return;

    const adapter = this.createAdapter(module);
    try {
      const status = await adapter.status();

      if (action === 'start') {
        if (status.status === ModuleStatus.RUNNING) {
          console.log(`[scheduler] ${moduleId} 已在运行，跳过定时启动`);
          return;
        }
        await adapter.start();
        console.log(`[scheduler] 定时启动: ${module.name}`);
      } else {
        if (status.status !== ModuleStatus.RUNNING) {
          console.log(`[scheduler] ${moduleId} 未在运行，跳过定时停止`);
          return;
        }
        await adapter.stop();
        console.log(`[scheduler] 定时停止: ${module.name}`);
      }

      this.onEvent?.({ type: 'schedule_triggered', moduleId, action, success: true });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[scheduler] ${action} 失败 ${moduleId}: ${errMsg}`);
      this.onEvent?.({ type: 'schedule_triggered', moduleId, action, success: false, error: errMsg });
    }
  }

  private createAdapter(module: any): ModuleProtocol {
    switch (module.type) {
      case 'nodejs': return new NodeJSAdapter(module);
      case 'python': return new PythonAdapter(module);
      case 'shell': return new ShellAdapter(module);
      default: throw new Error(`不支持的模块类型: ${module.type}`);
    }
  }
}

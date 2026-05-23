import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { BootPreferenceMode, SystemActionRunRecord, SystemActionSummary } from '../types/system-actions';

type BroadcastFn = (message: any) => void;

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  macosVersion?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class BootPreferenceService {
  private readonly stateDir: string;
  private readonly historyDir: string;
  private readonly logDir: string;
  private readonly onBroadcast?: BroadcastFn;

  constructor(dataDir: string, onBroadcast?: BroadcastFn) {
    this.stateDir = path.join(dataDir, 'system-actions');
    this.historyDir = path.join(this.stateDir, 'history');
    this.logDir = path.join(this.stateDir, 'logs');
    this.onBroadcast = onBroadcast;
  }

  async listActions(): Promise<SystemActionSummary[]> {
    await this.ensureDirs();
    return [await this.getSummary()];
  }

  async getSummary(): Promise<SystemActionSummary> {
    const support = await this.getSupportInfo();
    const latestRun = this.getLatestRun();
    const current = support.supported
      ? await this.readCurrentMode().catch((error) => ({
          mode: 'unknown' as BootPreferenceMode,
          message: error instanceof Error ? error.message : String(error),
        }))
      : { mode: 'unknown' as BootPreferenceMode, message: support.disabledReason };

    return {
      id: 'boot-preference',
      groupId: 'system-tuning',
      name: '开盖 / 接电启动',
      description: '控制 Apple Silicon Mac 在开盖或连接电源时是否自动启动。',
      supported: support.supported,
      disabledReason: support.supported
        ? (current.mode === 'unknown' ? current.message || undefined : undefined)
        : support.disabledReason || current.message || undefined,
      currentMode: current.mode,
      currentModeLabel: formatBootPreferenceMode(current.mode),
      currentModeDescription: describeBootPreferenceMode(current.mode),
      checkedAt: new Date().toISOString(),
      latestRun,
    };
  }

  async applyMode(mode: BootPreferenceMode): Promise<{ record: SystemActionRunRecord; message: string }> {
    if (!['default', 'block_all', 'block_lid', 'block_power'].includes(mode)) {
      throw new Error('不支持的 BootPreference 模式');
    }

    const support = await this.getSupportInfo();
    if (!support.supported) {
      throw new Error(support.disabledReason || '当前系统不支持此功能');
    }

    await this.ensureDirs();

    const observedBefore = await this.readCurrentMode().catch(() => ({ mode: 'unknown' as BootPreferenceMode }));
    const runId = this.createRunId();
    const startedAt = new Date().toISOString();
    const logFile = path.join(this.logDir, `boot-preference-${runId}.log`);
    const initialRecord: SystemActionRunRecord = {
      runId,
      actionId: 'boot-preference',
      actionName: '开盖 / 接电启动',
      startedAt,
      status: 'running',
      message: '正在应用设置',
      logFile,
      targetMode: mode,
      observedModeBefore: observedBefore.mode,
    };

    await this.appendHistory(initialRecord);
    this.broadcast({ type: 'system_action_updated', actionId: 'boot-preference', status: 'running' });

    const command = getBootPreferenceCommand(mode);
    const lines: string[] = [
      `[HubKit] action: boot-preference`,
      `[HubKit] target mode: ${mode}`,
      `[HubKit] observed before: ${observedBefore.mode}`,
      `[HubKit] command: ${command}`,
      '',
    ];

    try {
      const result = await this.execAdminCommand(command);
      lines.push(result.stdout.trim(), result.stderr.trim());
      const observedAfter = await this.readCurrentMode().catch(() => ({ mode: 'unknown' as BootPreferenceMode }));
      lines.push('', `[HubKit] observed after: ${observedAfter.mode}`);
      await fsp.writeFile(logFile, `${lines.filter(Boolean).join(os.EOL)}${os.EOL}`, 'utf-8');

      const message = mode === 'default'
        ? '已恢复默认启动行为'
        : `已应用：${formatBootPreferenceMode(mode)}`;
      const finalRecord: SystemActionRunRecord = {
        ...initialRecord,
        finishedAt: new Date().toISOString(),
        status: 'succeeded',
        message,
        exitCode: result.exitCode,
        observedModeAfter: observedAfter.mode,
      };
      await this.replaceLatest(finalRecord);
      this.broadcast({ type: 'system_action_updated', actionId: 'boot-preference', status: 'succeeded' });
      return { record: finalRecord, message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lines.push('', `[HubKit] error: ${errorMessage}`);
      await fsp.writeFile(logFile, `${lines.filter(Boolean).join(os.EOL)}${os.EOL}`, 'utf-8');
      const finalRecord: SystemActionRunRecord = {
        ...initialRecord,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        message: errorMessage,
        exitCode: 1,
        observedModeAfter: observedBefore.mode,
      };
      await this.replaceLatest(finalRecord);
      this.broadcast({ type: 'system_action_updated', actionId: 'boot-preference', status: 'failed' });
      throw new Error(errorMessage);
    }
  }

  async getHistory(): Promise<SystemActionRunRecord[]> {
    const filePath = this.getHistoryPath();
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async getLog(runId?: string): Promise<string> {
    const history = await this.getHistory();
    const target = runId ? history.find((item) => item.runId === runId) : history[0];
    if (!target?.logFile) return '暂无日志';
    try {
      return await fsp.readFile(target.logFile, 'utf-8');
    } catch {
      return '暂无日志';
    }
  }

  async getSupportInfo(): Promise<{ supported: boolean; disabledReason?: string; systemInfo: SystemInfo }> {
    const systemInfo = await this.readSystemInfo();
    const supported = detectBootPreferenceSupport(systemInfo);
    return {
      supported: supported.supported,
      disabledReason: supported.reason,
      systemInfo,
    };
  }

  async readCurrentMode(): Promise<{ mode: BootPreferenceMode; message?: string }> {
    const result = await this.execReadCommand('/usr/sbin/nvram BootPreference');
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    return {
      mode: parseBootPreferenceOutput(combined),
      message: combined || undefined,
    };
  }

  protected execReadCommand(command: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile('/bin/zsh', ['-lc', command], (error, stdout, stderr) => {
        if (error) {
          const stderrText = String(stderr || '').trim();
          if (stderrText.includes('Error getting variable')) {
            resolve({ stdout: String(stdout || ''), stderr: stderrText, exitCode: 0 });
            return;
          }
          reject(new Error(stderrText || error.message));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), exitCode: 0 });
      });
    });
  }

  protected execAdminCommand(command: string): Promise<ExecResult> {
    const appleScript = `do shell script ${JSON.stringify(command)} with administrator privileges`;
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', appleScript], (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || stdout || '').trim();
          reject(new Error(message || '执行失败'));
          return;
        }
        resolve({
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          exitCode: 0,
        });
      });
    });
  }

  protected async readSystemInfo(): Promise<SystemInfo> {
    const info: SystemInfo = {
      platform: process.platform,
      arch: process.arch,
    };
    if (process.platform === 'darwin') {
      try {
        const version = await this.execReadCommand('sw_vers -productVersion');
        info.macosVersion = version.stdout.trim();
      } catch {
        info.macosVersion = undefined;
      }
    }
    return info;
  }

  private getHistoryPath(): string {
    return path.join(this.historyDir, 'boot-preference.json');
  }

  private getLatestRun(): SystemActionRunRecord | undefined {
    const filePath = this.getHistoryPath();
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed[0] : undefined;
    } catch {
      return undefined;
    }
  }

  private async appendHistory(record: SystemActionRunRecord): Promise<void> {
    const history = await this.getHistory();
    history.unshift(record);
    await this.writeHistory(history);
  }

  private async replaceLatest(record: SystemActionRunRecord): Promise<void> {
    const history = await this.getHistory();
    const next = history.filter((item) => item.runId !== record.runId);
    next.unshift(record);
    await this.writeHistory(next);
  }

  private async writeHistory(history: SystemActionRunRecord[]): Promise<void> {
    await fsp.mkdir(path.dirname(this.getHistoryPath()), { recursive: true });
    await fsp.writeFile(this.getHistoryPath(), JSON.stringify(history.slice(0, 20), null, 2), 'utf-8');
  }

  private async ensureDirs(): Promise<void> {
    await Promise.all([
      fsp.mkdir(this.stateDir, { recursive: true }),
      fsp.mkdir(this.historyDir, { recursive: true }),
      fsp.mkdir(this.logDir, { recursive: true }),
    ]);
  }

  private createRunId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private broadcast(message: any): void {
    this.onBroadcast?.(message);
  }
}

export function parseBootPreferenceOutput(raw: string): BootPreferenceMode {
  const text = String(raw || '').trim();
  if (!text) return 'unknown';
  if (text.includes('Error getting variable')) return 'default';
  if (/%00\b/.test(text)) return 'block_all';
  if (/%01\b/.test(text)) return 'block_lid';
  if (/%02\b/.test(text)) return 'block_power';
  return 'unknown';
}

export function detectBootPreferenceSupport(systemInfo: SystemInfo): { supported: boolean; reason?: string } {
  if (systemInfo.platform !== 'darwin') {
    return { supported: false, reason: '仅支持 macOS' };
  }
  if (systemInfo.arch !== 'arm64') {
    return { supported: false, reason: '仅支持 Apple Silicon Mac' };
  }
  const major = Number((systemInfo.macosVersion || '').split('.')[0]);
  if (!Number.isFinite(major) || major < 15) {
    return { supported: false, reason: '需要 macOS Sequoia 15 或更高版本' };
  }
  return { supported: true };
}

export function getBootPreferenceCommand(mode: BootPreferenceMode): string {
  switch (mode) {
    case 'default':
      return '/usr/sbin/nvram -d BootPreference';
    case 'block_all':
      return '/usr/sbin/nvram BootPreference=%00';
    case 'block_lid':
      return '/usr/sbin/nvram BootPreference=%01';
    case 'block_power':
      return '/usr/sbin/nvram BootPreference=%02';
    default:
      throw new Error('不支持的 BootPreference 模式');
  }
}

export function formatBootPreferenceMode(mode: BootPreferenceMode): string {
  switch (mode) {
    case 'default':
      return '当前允许自动启动';
    case 'block_all':
      return '已阻止开盖与接电启动';
    case 'block_lid':
      return '仅阻止开盖启动';
    case 'block_power':
      return '仅阻止接电启动';
    default:
      return '状态未知';
  }
}

export function describeBootPreferenceMode(mode: BootPreferenceMode): string {
  switch (mode) {
    case 'default':
      return '当前未拦截，开盖和接入电源都可能触发自动启动。';
    case 'block_all':
      return '当前已同时阻止开盖启动和接电启动。';
    case 'block_lid':
      return '当前只阻止开盖启动，接入电源仍可能自动启动。';
    case 'block_power':
      return '当前只阻止接电启动，开盖仍可能自动启动。';
    default:
      return '当前无法确认实际状态，请手动刷新或查看日志。';
  }
}

import { spawn, ChildProcess, execSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  ModuleHealthReport,
  ModuleProtocol,
  ModuleRuntimeState,
  ModuleStatusInfo,
  ModuleStatus,
  LogEntry,
  ModuleSetting,
  ModuleMetadata,
  ModuleStartFailure,
  ModuleStartPolicy,
  ModuleStartPreparation,
  ModuleStartReadiness,
  ModuleStartRecord,
} from '../types/module';
import { config } from '../config/config';
import { buildHealthCheckUrl, listPortListeners, parseModulePort, requestHealthCheck } from '../runtime/module-network';
import { getModuleStartPolicy } from '../runtime/module-start-policy';
import { moduleRuntimeStateStore } from '../runtime/module-runtime-state';
import { readLastLines, readLastLinesText } from '../runtime/log-tail';
import { rotateLogIfNeeded } from '../runtime/log-rotation';

/**
 * 基础适配器抽象类
 *
 * 提供通用的进程管理、日志处理、配置管理功能
 */
export abstract class BaseAdapter implements ModuleProtocol {
  protected metadata: ModuleMetadata;
  protected process?: ChildProcess;
  protected pidFile: string;
  protected logFile: string;
  protected logFileHandle?: fs.FileHandle;
  protected lastStartPreparation: ModuleStartPreparation | null = null;

  constructor(metadata: ModuleMetadata) {
    this.metadata = metadata;
    this.pidFile = join('.hub', 'pids', `${metadata.id}.pid`);
    this.logFile = join('.hub', 'logs', `${metadata.id}.log`);
  }

  /**
   * 获取模块状态
   */
  async status(): Promise<ModuleStatusInfo> {
    try {
      const pid = await this.readPid();
      if (!pid) {
        return { status: ModuleStatus.STOPPED };
      }

      // 检查进程是否存在
      const isRunning = await this.isProcessRunning(pid);
      if (!isRunning) {
        await this.cleanupPid();
        const runtimeState = this.getRuntimeState();
        if (runtimeState.phase === 'running') {
          const failure = this.createFailure('process_exited', '进程已退出', {
            source: 'process',
            details: '检测到 PID 文件仍存在，但对应进程已经结束',
            retryable: true,
          });
          this.setRuntimePhase('failed', failure.summary, {
            failure,
            health: this.createHealthReport('unhealthy', '进程已退出', failure.details),
            lastStartRecord: runtimeState.lastStartRecord
              ? {
                  ...runtimeState.lastStartRecord,
                  outcome: 'failed',
                  failure,
                  health: this.createHealthReport('unhealthy', '进程已退出', failure.details),
                }
              : runtimeState.lastStartRecord,
          });
        }
        return { status: ModuleStatus.STOPPED };
      }

      // 获取进程信息
      const processInfo = await this.getProcessInfo(pid);
      return {
        status: ModuleStatus.RUNNING,
        pid,
        ...processInfo
      };
    } catch (error) {
      return {
        status: ModuleStatus.ERROR,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 启动模块
   */
  async start(): Promise<boolean> {
    const startedAt = new Date();
    const policy = this.getStartPolicy();
    const maxAttempts = policy.retryCount + 1;

    try {
      this.lastStartPreparation = null;

      // 检查是否已在运行
      const currentStatus = await this.status();
      if (currentStatus.status === ModuleStatus.RUNNING) {
        this.setRuntimePhase('running', '模块已在运行', {
          attempt: 0,
          maxAttempts,
          health: this.createHealthReport('healthy', '进程正在运行'),
        });
        return true; // 幂等性
      }

      // 确保目录存在
      await this.ensureDirectories();
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await this.ensureLogHandle();
          this.setRuntimePhase('preparing', attempt === 1 ? '启动准备中' : `第 ${attempt} 次启动准备中`, {
            attempt,
            maxAttempts,
            lastStartedAt: startedAt.toISOString(),
            failure: undefined,
            health: this.createHealthReport('checking', '正在执行启动前检查'),
          });

          await this.runPreflightChecks(policy);

          this.lastStartPreparation = await this.prepareForStart();
          if (this.lastStartPreparation?.dependencyInstalled) {
            this.setRuntimePhase('installing', this.lastStartPreparation.summary, {
              attempt,
              maxAttempts,
              lastPreparation: this.lastStartPreparation,
              health: this.createHealthReport('checking', '依赖已安装，准备启动进程'),
            });
          }

          const command = await this.buildStartCommand();
          const commandText = [command.cmd, ...command.args].join(' ');
          await this.appendLogLine(`[HubKit] 启动命令：${commandText}`);

          this.setRuntimePhase('starting', '正在启动进程', {
            attempt,
            maxAttempts,
            details: commandText,
            lastPreparation: this.lastStartPreparation,
            health: this.createHealthReport('checking', '进程已创建，等待就绪'),
          });

          await this.spawnProcess(command);
          const health = await this.runPostStartChecks(policy, attempt, maxAttempts);
          const finishedAt = new Date();
          const record: ModuleStartRecord = {
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            outcome: 'succeeded',
            attemptCount: attempt,
            summary: this.lastStartPreparation?.dependencyInstalled ? '已安装依赖并启动' : '模块已启动',
            command: commandText,
            preparation: this.lastStartPreparation,
            health,
          };

          this.setRuntimePhase('running', record.summary, {
            attempt,
            maxAttempts,
            details: health.summary,
            lastPreparation: this.lastStartPreparation,
            health,
            lastStartRecord: record,
            failure: undefined,
          });

          return true;
        } catch (error) {
          const failure = this.normalizeFailure(error);
          const canRetry = failure.retryable && attempt < maxAttempts;
          await this.appendLogLine(`[HubKit] 启动失败：${failure.summary}${failure.details ? `；${failure.details}` : ''}`);
          await this.cleanupFailedProcess();

          const finishedAt = new Date();
          const record: ModuleStartRecord = {
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            outcome: 'failed',
            attemptCount: attempt,
            summary: failure.summary,
            details: failure.details,
            preparation: this.lastStartPreparation,
            failure,
            health: this.createHealthReport('unhealthy', failure.summary, failure.details),
          };

          this.setRuntimePhase('failed', failure.summary, {
            attempt,
            maxAttempts,
            details: canRetry
              ? `${failure.details || '等待重试'}；${policy.retryDelayMs} ms 后自动重试`
              : failure.details,
            lastPreparation: this.lastStartPreparation,
            failure,
            health: this.createHealthReport('unhealthy', failure.summary, failure.details),
            lastStartRecord: record,
          });

          if (!canRetry) {
            throw new Error(`启动失败: ${failure.summary}${failure.details ? `（${failure.details}）` : ''}`);
          }

          await this.appendLogLine(`[HubKit] ${policy.retryDelayMs} ms 后进行第 ${attempt + 1} 次重试`);
          await sleep(policy.retryDelayMs);
        }
      }

      throw new Error('启动失败: 超出最大重试次数');
    } catch (error) {
      await this.cleanup();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * 停止模块
   */
  async stop(force: boolean = false): Promise<boolean> {
    try {
      const pid = await this.readPid();
      if (!pid) {
        this.setRuntimePhase('stopped', '已停止', {
          attempt: 0,
          maxAttempts: 1,
          health: this.createHealthReport('unknown', '未运行'),
          failure: undefined,
        });
        return true; // 幂等性
      }

      const signal = force ? 'SIGKILL' : 'SIGTERM';
      process.kill(pid, signal);

      if (!force) {
        // 优雅停止：等待最多 10 秒
        const stopped = await this.waitForStop(pid, 10000);
        if (!stopped) {
          // 超时后强制停止
          process.kill(pid, 'SIGKILL');
        }
      }

      await this.cleanup();
      this.setRuntimePhase('stopped', '已停止', {
        attempt: 0,
        maxAttempts: 1,
        health: this.createHealthReport('unknown', '未运行'),
        failure: undefined,
      });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        // 进程不存在，清理 PID 文件
        await this.cleanup();
        this.setRuntimePhase('stopped', '已停止', {
          attempt: 0,
          maxAttempts: 1,
          health: this.createHealthReport('unknown', '未运行'),
          failure: undefined,
        });
        return true;
      }
      throw new Error(`停止失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取日志
   */
  async logs(lines: number = 100): Promise<LogEntry[]> {
    const recentLines = await readLastLines(this.logFile, lines);
    return recentLines.map(line => this.parseLogLine(line));
  }

  /**
   * 获取原始日志文本（用于 Web 显示）
   */
  async rawLogs(lines: number = 200): Promise<string> {
    return readLastLinesText(this.logFile, lines);
  }

  /**
   * 获取配置
   */
  async getSettings(): Promise<ModuleSetting[]> {
    // 默认实现：从 module.json 读取
    return [];
  }

  /**
   * 更新配置
   */
  async setSetting(key: string, value: string | number | boolean): Promise<boolean> {
    // 默认实现：写入 module.json
    return false;
  }

  /**
   * 获取启动前检查结果
   */
  async inspectStartReadiness(): Promise<ModuleStartReadiness> {
    const policy = this.getStartPolicy();
    if (policy.preflightChecksEnabled && policy.blockOnPortConflict) {
      const port = parseModulePort(this.metadata);
      if (port) {
        const listeners = listPortListeners(port).filter(listener => listener.alive);
        if (listeners.length > 0) {
          const first = listeners[0];
          return {
            ready: false,
            actionLabel: '排查端口后启动',
            summary: `检测到端口 ${port} 已被占用`,
            details: `监听进程：${first.command}（PID ${first.pid}）`,
          };
        }
      }
    }

    return {
      ready: true,
      actionLabel: '启动',
      summary: '可直接启动',
    };
  }

  getLastStartPreparation(): ModuleStartPreparation | null {
    return this.lastStartPreparation;
  }

  getRuntimeState(): ModuleRuntimeState {
    return moduleRuntimeStateStore.get(this.metadata.id);
  }

  async probeHealth(): Promise<ModuleHealthReport> {
    const policy = this.getStartPolicy();
    const healthUrl = buildHealthCheckUrl(this.metadata);
    const runtimeState = this.getRuntimeState();
    const pid = await this.readPid();

    if (!pid || !(await this.isProcessRunning(pid))) {
      const report = this.createHealthReport('unknown', '未运行');
      moduleRuntimeStateStore.setHealth(this.metadata.id, report);
      return report;
    }

    if (!policy.healthCheckEnabled || !healthUrl) {
      const report = runtimeState.health?.state === 'healthy'
        ? runtimeState.health
        : this.createHealthReport('unknown', '未配置健康检查');
      moduleRuntimeStateStore.setHealth(this.metadata.id, report);
      return report;
    }

    const result = await requestHealthCheck(healthUrl, Math.min(policy.healthCheckTimeoutMs, 2500));
    const report = result.ok
      ? this.createHealthReport('healthy', '健康检查通过', `${healthUrl} · ${result.message}`)
      : this.createHealthReport('unhealthy', '健康检查异常', `${healthUrl} · ${result.message}`);
    moduleRuntimeStateStore.setHealth(this.metadata.id, report);
    return report;
  }

  // ========== 抽象方法（子类必须实现） ==========

  /**
   * 构建启动命令
   */
  protected abstract buildStartCommand(): Promise<{
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }>;

  // ========== 辅助方法 ==========

  protected async readPid(): Promise<number | null> {
    try {
      const content = await fs.readFile(this.pidFile, 'utf-8');
      return parseInt(content.trim(), 10);
    } catch {
      return null;
    }
  }

  protected async writePid(pid: number): Promise<void> {
    await fs.writeFile(this.pidFile, String(pid), 'utf-8');
  }

  protected async cleanupPid(): Promise<void> {
    try {
      await fs.unlink(this.pidFile);
    } catch {
      // 忽略错误
    }
  }

  protected async cleanup(): Promise<void> {
    await this.cleanupPid();
    if (this.logFileHandle) {
      await this.logFileHandle.close().catch(() => undefined);
      this.logFileHandle = undefined;
    }
  }

  protected async isProcessRunning(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0); // 信号 0 只检查进程是否存在
      return true;
    } catch {
      return false;
    }
  }

  protected async getProcessInfo(pid: number): Promise<Partial<ModuleStatusInfo>> {
    try {
      const output = execSync(`ps -p ${pid} -o etimes=`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      const uptimeSeconds = Number(output);
      if (!Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
        return {};
      }

      const startedAt = new Date(Date.now() - uptimeSeconds * 1000);
      return {
        startedAt,
        uptime: uptimeSeconds
      };
    } catch {
      return {};
    }
  }

  protected async ensureDirectories(): Promise<void> {
    await fs.mkdir(join('.hub', 'pids'), { recursive: true });
    await fs.mkdir(join('.hub', 'logs'), { recursive: true });
  }

  protected async prepareForStart(): Promise<ModuleStartPreparation | null> {
    // 默认无需额外准备
    return null;
  }

  protected async appendLogLine(line: string): Promise<void> {
    if (!this.logFileHandle) {
      await rotateLogIfNeeded(this.logFile);
    }
    await fs.appendFile(this.logFile, `${line}\n`, 'utf-8');
  }

  protected getStartPolicy(): ModuleStartPolicy {
    const settings = config.getSettings();
    const groupId = settings.moduleGroups[this.metadata.id] || 'default';
    return getModuleStartPolicy(settings, this.metadata.id, groupId);
  }

  protected setRuntimePhase(
    phase: ModuleRuntimeState['phase'],
    summary: string,
    patch: Partial<ModuleRuntimeState> = {}
  ): ModuleRuntimeState {
    return moduleRuntimeStateStore.setPhase(this.metadata.id, phase, summary, patch);
  }

  protected createFailure(
    code: string,
    summary: string,
    options: {
      source: ModuleStartFailure['source'];
      details?: string;
      retryable?: boolean;
    }
  ): ModuleStartFailure {
    return {
      code,
      source: options.source,
      summary,
      details: options.details,
      retryable: options.retryable ?? false,
      occurredAt: new Date().toISOString(),
    };
  }

  protected createHealthReport(
    state: ModuleHealthReport['state'],
    summary: string,
    details?: string
  ): ModuleHealthReport {
    return {
      state,
      summary,
      details,
      checkedAt: new Date().toISOString(),
    };
  }

  protected async waitForStop(pid: number, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (!(await this.isProcessRunning(pid))) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  protected parseLogLine(line: string): LogEntry {
    // 简化实现：实际应解析日志格式
    return {
      timestamp: new Date(),
      level: 'info',
      message: line
    };
  }

  private async ensureLogHandle(): Promise<void> {
    if (!this.logFileHandle) {
      await rotateLogIfNeeded(this.logFile);
      this.logFileHandle = await fs.open(this.logFile, 'a');
    }
  }

  private async spawnProcess(command: {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<void> {
    const startupPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(this.createFailure('start_timeout', '进程启动超时', {
          source: 'process',
          details: '5 秒内未收到进程启动确认',
          retryable: true,
        }));
      }, 5000);

      const cleanup = () => clearTimeout(timer);

      this.process = spawn(command.cmd, command.args, {
        cwd: command.cwd,
        detached: true,
        stdio: ['ignore', this.logFileHandle!.fd, this.logFileHandle!.fd],
        env: { ...process.env, ...command.env }
      });

      this.process.once('spawn', () => {
        cleanup();
        resolve();
      });

      this.process.once('error', (error) => {
        cleanup();
        reject(this.createFailure('spawn_error', '进程创建失败', {
          source: 'process',
          details: error.message,
          retryable: true,
        }));
      });

      this.process.once('exit', (code) => {
        cleanup();
        reject(this.createFailure('process_exit_early', '进程提前退出', {
          source: 'process',
          details: `退出码：${code ?? 'unknown'}`,
          retryable: true,
        }));
      });
    });

    await startupPromise;

    if (!this.process?.pid) {
      throw this.createFailure('missing_pid', '启动后未获得进程 ID', {
        source: 'process',
        retryable: true,
      });
    }

    await this.writePid(this.process.pid);
    this.process.unref();
  }

  private async runPreflightChecks(policy: ModuleStartPolicy): Promise<void> {
    if (!policy.preflightChecksEnabled) return;

    if (policy.blockOnPortConflict) {
      const port = parseModulePort(this.metadata);
      if (port) {
        const listeners = listPortListeners(port).filter(listener => listener.alive);
        if (listeners.length > 0) {
          const first = listeners[0];
          throw this.createFailure(`port_${port}_occupied`, `端口 ${port} 已被占用`, {
            source: 'preflight',
            details: `${first.command}（PID ${first.pid}）正在监听该端口`,
            retryable: false,
          });
        }
      }
    }
  }

  private async runPostStartChecks(
    policy: ModuleStartPolicy,
    attempt: number,
    maxAttempts: number
  ): Promise<ModuleHealthReport> {
    if (!this.process?.pid) {
      throw this.createFailure('missing_pid', '启动后未获得进程 ID', {
        source: 'process',
        retryable: true,
      });
    }

    await sleep(800);
    const alive = await this.isProcessRunning(this.process.pid);
    if (!alive) {
      throw this.createFailure('process_exit_early', '进程启动后立即退出', {
        source: 'process',
        details: '进程未通过稳定期检查',
        retryable: true,
      });
    }

    const healthUrl = buildHealthCheckUrl(this.metadata);
    if (!policy.healthCheckEnabled || !healthUrl) {
      return this.createHealthReport('unknown', '未配置健康检查');
    }

    this.setRuntimePhase('health_checking', '健康检查中', {
      attempt,
      maxAttempts,
      details: healthUrl,
      health: this.createHealthReport('checking', '正在等待 Web 服务可访问', healthUrl),
    });

    const deadline = Date.now() + policy.healthCheckTimeoutMs;
    let lastMessage = '等待服务响应';
    while (Date.now() < deadline) {
      const remaining = Math.max(500, deadline - Date.now());
      const pidAlive = await this.isProcessRunning(this.process.pid);
      if (!pidAlive) {
        throw this.createFailure('process_exit_during_health_check', '健康检查期间进程退出', {
          source: 'process',
          details: '服务尚未就绪，进程已结束',
          retryable: true,
        });
      }

      const result = await requestHealthCheck(healthUrl, Math.min(remaining, 1500));
      lastMessage = result.message;
      if (result.ok) {
        return this.createHealthReport('healthy', '健康检查通过', `${healthUrl} · ${result.message}`);
      }

      await sleep(500);
    }

    throw this.createFailure('health_check_failed', '健康检查未通过', {
      source: 'health',
      details: `${healthUrl} 在 ${policy.healthCheckTimeoutMs} ms 内未就绪；最后结果：${lastMessage}`,
      retryable: true,
    });
  }

  private normalizeFailure(error: unknown): ModuleStartFailure {
    if (isModuleStartFailure(error)) {
      return error;
    }

    if (error instanceof Error) {
      return this.createFailure('start_failed', '启动失败', {
        source: 'system',
        details: error.message,
        retryable: false,
      });
    }

    return this.createFailure('start_failed', '启动失败', {
      source: 'system',
      details: String(error),
      retryable: false,
    });
  }

  private async cleanupFailedProcess(): Promise<void> {
    try {
      if (this.process?.pid) {
        process.kill(this.process.pid, 'SIGKILL');
      }
    } catch {
      // ignore cleanup error
    }

    this.process = undefined;
    await this.cleanup();
  }
}

function isModuleStartFailure(value: unknown): value is ModuleStartFailure {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as ModuleStartFailure).code === 'string' &&
    typeof (value as ModuleStartFailure).summary === 'string'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

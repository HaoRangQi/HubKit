import { spawn, ChildProcess, execSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  ModuleProtocol,
  ModuleStatusInfo,
  ModuleStatus,
  LogEntry,
  ModuleSetting,
  ModuleMetadata
} from '../types/module';

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
    try {
      // 检查是否已在运行
      const currentStatus = await this.status();
      if (currentStatus.status === ModuleStatus.RUNNING) {
        return true; // 幂等性
      }

      // 确保目录存在
      await this.ensureDirectories();

      // 打开日志文件
      this.logFileHandle = await fs.open(this.logFile, 'a');

      // 启动前准备，例如安装依赖
      await this.prepareForStart();

      // 启动进程
      const command = await this.buildStartCommand();

      // 在 spawn 之前设置 Promise，避免错过事件
      const startupPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('启动超时'));
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
          reject(error);
        });

        this.process.once('exit', (code) => {
          cleanup();
          if (code !== 0) {
            reject(new Error(`进程退出，退出码: ${code}`));
          }
        });
      });

      // 等待启动完成
      await startupPromise;

      // 确保进程已创建
      if (!this.process) {
        throw new Error('进程创建失败');
      }

      // 保存 PID
      if (this.process.pid) {
        await this.writePid(this.process.pid);
      }

      // 分离进程，使其在父进程退出后继续运行
      this.process.unref();

      return true;
    } catch (error) {
      await this.cleanup();
      throw new Error(`启动失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 停止模块
   */
  async stop(force: boolean = false): Promise<boolean> {
    try {
      const pid = await this.readPid();
      if (!pid) {
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
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        // 进程不存在，清理 PID 文件
        await this.cleanup();
        return true;
      }
      throw new Error(`停止失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取日志
   */
  async logs(lines: number = 100): Promise<LogEntry[]> {
    try {
      const content = await fs.readFile(this.logFile, 'utf-8');
      const allLines = content.split('\n').filter(line => line.trim());
      const recentLines = allLines.slice(-lines);

      return recentLines.map(line => this.parseLogLine(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // 日志文件不存在
      }
      throw error;
    }
  }

  /**
   * 获取原始日志文本（用于 Web 显示）
   */
  async rawLogs(lines: number = 200): Promise<string> {
    try {
      const content = await fs.readFile(this.logFile, 'utf-8');
      const allLines = content.split('\n');
      // 保留空行以保持格式，只截取最后 N 行
      return allLines.slice(-lines).join('\n');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw error;
    }
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

  protected async prepareForStart(): Promise<void> {
    // 默认无需额外准备
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
}

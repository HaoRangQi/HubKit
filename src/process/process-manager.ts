import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

/**
 * 进程信息
 */
export interface ProcessInfo {
  pid: number;
  moduleId: string;
  startedAt: Date;
  process?: ChildProcess;
}

/**
 * 进程管理器
 * 管理所有模块进程的生命周期
 */
export class ProcessManager {
  private processes: Map<string, ProcessInfo>;
  private pidFile: string;

  constructor(dataDir: string) {
    this.processes = new Map();
    this.pidFile = path.join(dataDir, 'processes.json');
    this.load();
  }

  /**
   * 注册进程
   */
  register(moduleId: string, process: ChildProcess): void {
    if (!process.pid) {
      throw new Error('Process has no PID');
    }

    this.processes.set(moduleId, {
      pid: process.pid,
      moduleId,
      startedAt: new Date(),
      process,
    });

    this.save();
  }

  /**
   * 注销进程
   */
  unregister(moduleId: string): void {
    this.processes.delete(moduleId);
    this.save();
  }

  /**
   * 获取进程信息
   */
  get(moduleId: string): ProcessInfo | undefined {
    return this.processes.get(moduleId);
  }

  /**
   * 检查进程是否运行
   */
  isRunning(moduleId: string): boolean {
    const info = this.processes.get(moduleId);
    if (!info) return false;

    try {
      // 发送信号 0 检查进程是否存在
      process.kill(info.pid, 0);
      return true;
    } catch {
      // 进程不存在，清理记录
      this.unregister(moduleId);
      return false;
    }
  }

  /**
   * 停止进程
   */
  stop(moduleId: string, force: boolean = false): boolean {
    const info = this.processes.get(moduleId);
    if (!info) return false;

    try {
      const signal = force ? 'SIGKILL' : 'SIGTERM';
      process.kill(info.pid, signal);
      this.unregister(moduleId);
      return true;
    } catch (error) {
      console.error(`Failed to stop process ${info.pid}:`, error);
      return false;
    }
  }

  /**
   * 列出所有进程
   */
  list(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * 保存进程信息
   */
  private save(): void {
    try {
      const data = Array.from(this.processes.values()).map(info => ({
        pid: info.pid,
        moduleId: info.moduleId,
        startedAt: info.startedAt,
      }));

      const dir = path.dirname(this.pidFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.pidFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save process info:', error);
    }
  }

  /**
   * 加载进程信息
   */
  private load(): void {
    try {
      if (fs.existsSync(this.pidFile)) {
        const content = fs.readFileSync(this.pidFile, 'utf-8');
        const data = JSON.parse(content);

        for (const item of data) {
          // 检查进程是否仍在运行
          try {
            process.kill(item.pid, 0);
            this.processes.set(item.moduleId, {
              pid: item.pid,
              moduleId: item.moduleId,
              startedAt: new Date(item.startedAt),
            });
          } catch {
            // 进程已不存在，跳过
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load process info:', error);
    }
  }

  /**
   * 清理所有进程
   */
  cleanup(): void {
    for (const [moduleId] of this.processes) {
      this.stop(moduleId);
    }
  }
}

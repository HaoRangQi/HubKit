import * as fs from 'fs';
import * as path from 'path';
import { LogEntry } from '../types/module';

/**
 * 日志管理器
 * 管理模块日志的写入和读取
 */
export class LogManager {
  private logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    this.ensureLogDir();
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 获取模块日志文件路径
   */
  private getLogFile(moduleId: string): string {
    return path.join(this.logDir, `${moduleId}.log`);
  }

  /**
   * 写入日志
   */
  write(moduleId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const logFile = this.getLogFile(moduleId);
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    try {
      fs.appendFileSync(logFile, logLine, 'utf-8');
    } catch (error) {
      console.error(`Failed to write log for ${moduleId}:`, error);
    }
  }

  /**
   * 读取日志
   */
  read(moduleId: string, lines: number = 100): LogEntry[] {
    const logFile = this.getLogFile(moduleId);

    if (!fs.existsSync(logFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.trim().split('\n').filter(line => line);

      // 取最后 N 行
      const recentLines = allLines.slice(-lines);

      return recentLines.map(line => this.parseLine(line)).filter(entry => entry !== null) as LogEntry[];
    } catch (error) {
      console.error(`Failed to read log for ${moduleId}:`, error);
      return [];
    }
  }

  /**
   * 解析日志行
   */
  private parseLine(line: string): LogEntry | null {
    const match = line.match(/^\[(.+?)\] \[(.+?)\] (.+)$/);
    if (!match) return null;

    const [, timestamp, level, message] = match;
    return {
      timestamp: new Date(timestamp),
      level: level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error',
      message,
    };
  }

  /**
   * 清空日志
   */
  clear(moduleId: string): void {
    const logFile = this.getLogFile(moduleId);
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
  }

  /**
   * 获取日志文件大小（字节）
   */
  getSize(moduleId: string): number {
    const logFile = this.getLogFile(moduleId);
    if (!fs.existsSync(logFile)) return 0;

    try {
      const stats = fs.statSync(logFile);
      return stats.size;
    } catch {
      return 0;
    }
  }
}

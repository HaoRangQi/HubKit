import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { config } from '../../config/config';
import { readLastLinesText } from '../../runtime/log-tail';
import * as fs from 'fs';
import * as path from 'path';
import { scanAndRegisterModules } from './module-loader';

export interface LogsCommandOptions {
  lines: string;
  follow?: boolean;
}

export interface LogsCommandDependencies {
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
  getLogDir?: () => string;
  readRecentText?: typeof readLastLinesText;
  statSync?: typeof fs.statSync;
  watch?: typeof fs.watch;
  createReadStream?: typeof fs.createReadStream;
}

/**
 * logs 命令 - 查看模块日志
 */
export function registerLogsCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: LogsCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const getLogDir = dependencies.getLogDir || (() => config.getLogDir());
  const readRecentText = dependencies.readRecentText || readLastLinesText;
  const statSync = dependencies.statSync || fs.statSync;
  const watch = dependencies.watch || fs.watch;
  const createReadStream = dependencies.createReadStream || fs.createReadStream;

  program
    .command('logs <moduleId>')
    .description('查看模块日志')
    .option('-n, --lines <number>', '显示行数', '50')
    .option('-f, --follow', '持续跟踪日志')
    .action(async (moduleId: string, options: LogsCommandOptions) => {
      try {
        const lines = parseLogLinesOption(options.lines);

        await scanAndRegister(registry);
        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        const logFile = getModuleLogFile(getLogDir(), moduleId);
        const content = await readRecentText(logFile, lines);

        if (!content) {
          console.log('暂无日志');
        } else {
          const recentLineCount = countRenderedLines(content);
          console.log(`\n${module.name} 日志 (最近 ${recentLineCount} 行):\n`);
          console.log(content);
          console.log();
        }

        if (options.follow) {
          let lastSize = 0;

          try {
            const stats = statSync(logFile);
            lastSize = stats.size;
          } catch {
            console.log(`日志文件尚未创建，无法持续监控: ${logFile}`);
            return;
          }

          console.log('持续监控中... (Ctrl+C 退出)\n');

          // 使用 fs.watch 监听文件变化
          const watcher = watch(logFile, (eventType) => {
            if (eventType === 'change') {
              try {
                const stats = statSync(logFile);
                const currentSize = stats.size;

                if (currentSize > lastSize) {
                  // 读取新增内容
                  const stream = createReadStream(logFile, {
                    start: lastSize,
                    end: currentSize - 1,
                    encoding: 'utf-8',
                  });

                  stream.on('data', (chunk) => {
                    process.stdout.write(chunk);
                  });

                  lastSize = currentSize;
                }
              } catch (error) {
                // 忽略读取错误
              }
            }
          });

          // 处理 Ctrl+C
          process.on('SIGINT', () => {
            console.log('\n\n停止监控');
            watcher.close();
            process.exit(0);
          });
        }
      } catch (error) {
        console.error('查看日志失败:', error);
        process.exit(1);
      }
    });
}

export function getModuleLogFile(logDir: string, moduleId: string): string {
  return path.join(logDir, `${moduleId}.log`);
}

export function parseLogLinesOption(value: string | undefined): number {
  if (value === undefined) return 50;
  const trimmed = String(value).trim();
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    throw new Error('--lines 必须是整数');
  }
  if (parsed < 1 || parsed > 2000) {
    throw new Error('--lines 必须在 1-2000 之间');
  }
  return parsed;
}

function countRenderedLines(content: string): number {
  if (!content) return 0;
  return content.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleScanner } from '../../registry/module-scanner';
import { LogManager } from '../../log/log-manager';
import { config } from '../../config/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * logs 命令 - 查看模块日志
 */
export function registerLogsCommand(program: Command, registry: ModuleRegistry): void {
  const logManager = new LogManager(config.getLogDir());

  program
    .command('logs <moduleId>')
    .description('查看模块日志')
    .option('-n, --lines <number>', '显示行数', '50')
    .option('-f, --follow', '持续跟踪日志')
    .action(async (moduleId: string, options: { lines: string; follow?: boolean }) => {
      try {
        // 先扫描模块
        const scanner = new ModuleScanner();
        const moduleDirs = config.getModuleDirs();
        for (const dir of moduleDirs) {
          const modules = await scanner.scan(dir);
          modules.forEach(m => registry.register(m));
        }

        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        const lines = parseInt(options.lines, 10);

        // 直接读取日志文件
        const logFile = path.join('.hub', 'logs', `${moduleId}.log`);

        if (!fs.existsSync(logFile)) {
          console.log('暂无日志');
          if (!options.follow) return;
        } else {
          const content = fs.readFileSync(logFile, 'utf-8');
          const allLines = content.trim().split('\n').filter(line => line);
          const recentLines = allLines.slice(-lines);

          console.log(`\n${module.name} 日志 (最近 ${recentLines.length} 行):\n`);
          recentLines.forEach(line => console.log(line));
          console.log();
        }

        if (options.follow) {
          console.log('持续监控中... (Ctrl+C 退出)\n');

          let lastSize = 0;

          try {
            const stats = fs.statSync(logFile);
            lastSize = stats.size;
          } catch {
            // 文件不存在，从 0 开始
          }

          // 使用 fs.watch 监听文件变化
          const watcher = fs.watch(logFile, (eventType) => {
            if (eventType === 'change') {
              try {
                const stats = fs.statSync(logFile);
                const currentSize = stats.size;

                if (currentSize > lastSize) {
                  // 读取新增内容
                  const stream = fs.createReadStream(logFile, {
                    start: lastSize,
                    end: currentSize,
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

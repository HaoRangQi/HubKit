import { Command } from 'commander';
import { WebServer } from '../../web/server';

/**
 * web 命令 - 启动 Web 服务器
 */
export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('启动 Web 管理界面')
    .option('-p, --port <port>', '端口号', '2281')
    .action(async (options: { port: string }) => {
      try {
        const port = parseInt(options.port, 10);
        const server = new WebServer(port);
        await server.start();

        // 处理退出信号
        process.on('SIGINT', () => {
          console.log('\n正在停止服务器...');
          server.stop();
          process.exit(0);
        });

        process.on('SIGTERM', () => {
          console.log('\n正在停止服务器...');
          server.stop();
          process.exit(0);
        });
      } catch (error) {
        console.error('启动 Web 服务器失败:', error);
        process.exit(1);
      }
    });
}

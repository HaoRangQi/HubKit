import { Command } from 'commander';
import { DEFAULT_WEB_HOST, WebServer } from '../../web/server';

export function parseWebHost(value: string | undefined): string {
  const host = value === undefined ? DEFAULT_WEB_HOST : String(value).trim();
  if (!host) {
    throw new Error('--host 不能为空');
  }
  if (host.includes('/') || host.includes('\\') || /\s/.test(host)) {
    throw new Error('--host 必须是主机名或 IP 地址');
  }
  return host;
}

export function parseWebPort(value: string): number {
  if (!/^\d+$/.test(String(value || '').trim())) {
    throw new Error('--port 必须是 1 到 65535 之间的整数');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port 必须是 1 到 65535 之间的整数');
  }
  return port;
}

/**
 * web 命令 - 启动 Web 服务器
 */
export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('启动 Web 管理界面')
    .option('-p, --port <port>', '端口号', '2281')
    .option('--host <host>', '监听地址；默认仅绑定本机，远程访问需显式传 0.0.0.0 或指定地址', DEFAULT_WEB_HOST)
    .action(async (options: { port: string; host?: string }) => {
      try {
        const port = parseWebPort(options.port);
        const host = parseWebHost(options.host);
        const server = new WebServer(port, host);
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

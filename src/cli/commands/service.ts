import { Command } from 'commander';
import { DEFAULT_SERVICE_PORT, HubKitServiceManager } from '../../integration/hubkit-service-manager';
import { parseWebPort } from './web';

export function registerServiceCommand(program: Command, manager = new HubKitServiceManager()): void {
  const service = program.command('service').description('管理 Mac 本机 HubKit 后台服务（供 Docker 控制入口使用）');
  const run = (operation: () => void) => {
    try { operation(); }
    catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
  service.command('install').description('安装并启动登录后自动运行的本机服务')
    .option('--port <port>', '本机执行服务端口', String(DEFAULT_SERVICE_PORT))
    .action((options: { port: string }) => run(() => {
      const port = parseWebPort(options.port);
      manager.install(port);
      console.log(`本机服务已安装：http://127.0.0.1:${port}`);
      console.log(`启动配置：${manager.plistPath}`);
    }));
  service.command('start').description('启动已安装的本机服务')
    .action(() => run(() => { manager.start(); console.log('本机服务已加载'); }));
  service.command('stop').description('停止本机控制服务，保留已启动模块')
    .action(() => run(() => { manager.stop(); console.log('本机控制服务已停止；已启动模块保持运行'); }));
  service.command('uninstall').description('卸载本机后台服务，保留配置、模块和日志')
    .action(() => run(() => { manager.uninstall(); console.log('本机后台服务已卸载；配置、模块和日志已保留'); }));
  service.command('status').description('查看本机服务安装与运行状态')
    .action(() => run(() => {
      const status = manager.status();
      console.log(JSON.stringify(status, null, 2));
    }));
}

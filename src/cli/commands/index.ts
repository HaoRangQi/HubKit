import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleStateManager } from '../../registry/module-state';
import { config } from '../../config/config';
import { registerListCommand } from './list';
import { registerStatusCommand } from './status';
import { registerEnableCommand, registerDisableCommand } from './enable-disable';
import { registerStartCommand, registerStopCommand, registerRestartCommand } from './start-stop';
import { registerLogsCommand } from './logs';
import { registerWebCommand } from './web';
import { registerInitModuleCommand } from './init-module';
import { registerWorkspaceCommand } from './workspace';
import { registerAuditCommand } from './audit';
import { registerLogSearchCommand } from './log-search';

/**
 * 全局模块注册表
 */
const registry = new ModuleRegistry();

/**
 * 模块状态管理器
 */
const stateManager = new ModuleStateManager(config.getDataDir());

/**
 * 注册所有 CLI 命令
 */
export function registerCommands(program: Command): void {
  // 注册 list 命令
  registerListCommand(program, registry);

  // 注册 status 命令
  registerStatusCommand(program, registry);

  // 注册 enable/disable 命令
  registerEnableCommand(program, registry, stateManager);
  registerDisableCommand(program, registry, stateManager);

  // 注册 start/stop/restart 命令
  registerStartCommand(program, registry);
  registerStopCommand(program, registry);
  registerRestartCommand(program, registry);

  // 注册 logs 命令
  registerLogsCommand(program, registry);

  // 注册 web 命令
  registerWebCommand(program);

  // 注册 workspace 命令
  registerWorkspaceCommand(program, registry);

  // 注册 audit 命令
  registerAuditCommand(program, registry);

  // 注册 log-search 命令
  registerLogSearchCommand(program, registry);

  // 注册模块接入向导命令
  registerInitModuleCommand(program);

  // version 命令
  program
    .command('version')
    .description('显示版本信息')
    .action(() => {
      console.log('HubKit v0.1.0');
    });
}

export { registry, stateManager };

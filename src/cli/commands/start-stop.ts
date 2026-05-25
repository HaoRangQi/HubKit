import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleLifecycle } from '../../runtime/module-lifecycle';
import { scanAndRegisterModules } from './module-loader';

const defaultLifecycle = new ModuleLifecycle(undefined, 1000);

export interface StartStopCommandDependencies {
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
  lifecycle?: Pick<ModuleLifecycle, 'start' | 'stop' | 'restart'>;
}

/**
 * start 命令 - 启动模块
 */
export function registerStartCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: StartStopCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const lifecycle = dependencies.lifecycle || defaultLifecycle;

  program
    .command('start <moduleId>')
    .description('启动模块')
    .action(async (moduleId: string) => {
      try {
        await scanAndRegister(registry);
      } catch (error) {
        console.error('启动模块失败:', error);
        process.exit(1);
      }

      const module = registry.get(moduleId);
      if (!module) {
        console.error(`模块不存在: ${moduleId}`);
        process.exit(1);
      }

      if (!module.enabled) {
        console.error(`模块未启用: ${module.name}`);
        process.exit(1);
      }

      try {
        const result = await lifecycle.start(module);

        if (result.success) {
          console.log(`✓ 已启动模块: ${module.name} (${moduleId})`);
        } else {
          console.error(`✗ 启动失败: ${module.name}`);
          printTroubleshootingHints(moduleId);
          process.exit(1);
        }
      } catch (error) {
        console.error('启动模块失败:', error);
        printTroubleshootingHints(moduleId);
        process.exit(1);
      }
    });
}

/**
 * stop 命令 - 停止模块
 */
export function registerStopCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: StartStopCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const lifecycle = dependencies.lifecycle || defaultLifecycle;

  program
    .command('stop <moduleId>')
    .description('停止模块')
    .option('-f, --force', '强制停止（SIGKILL）')
    .action(async (moduleId: string, options: { force?: boolean }) => {
      try {
        await scanAndRegister(registry);
      } catch (error) {
        console.error('停止模块失败:', error);
        process.exit(1);
      }

      const module = registry.get(moduleId);
      if (!module) {
        console.error(`模块不存在: ${moduleId}`);
        process.exit(1);
      }

      try {
        const result = await lifecycle.stop(module, options.force);

        if (result.success) {
          console.log(`✓ 已停止模块: ${module.name} (${moduleId})`);
        } else {
          console.error(`✗ 停止失败: ${module.name}`);
          printTroubleshootingHints(moduleId);
          process.exit(1);
        }
      } catch (error) {
        console.error('停止模块失败:', error);
        printTroubleshootingHints(moduleId);
        process.exit(1);
      }
    });
}

/**
 * restart 命令 - 重启模块
 */
export function registerRestartCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: StartStopCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const lifecycle = dependencies.lifecycle || defaultLifecycle;

  program
    .command('restart <moduleId>')
    .description('重启模块')
    .action(async (moduleId: string) => {
      try {
        await scanAndRegister(registry);
      } catch (error) {
        console.error('重启模块失败:', error);
        process.exit(1);
      }

      const module = registry.get(moduleId);
      if (!module) {
        console.error(`模块不存在: ${moduleId}`);
        process.exit(1);
      }

      try {
        console.log(`停止模块: ${module.name}`);
        const result = await lifecycle.restart(module);
        if (result.success) {
          console.log(`✓ 已重启模块: ${module.name} (${moduleId})`);
        } else {
          console.error(`✗ 重启失败: ${module.name}`);
          printTroubleshootingHints(moduleId);
          process.exit(1);
        }
      } catch (error) {
        console.error('重启模块失败:', error);
        printTroubleshootingHints(moduleId);
        process.exit(1);
      }
    });
}

export function formatTroubleshootingHints(moduleId: string): string {
  return [
    '排障建议:',
    `  1. 运行 hub audit ${moduleId} 查看健康检查、依赖命令和环境变量。`,
    `  2. 运行 hub logs ${moduleId} --lines 100 查看最近日志。`,
    `  3. 运行 hub log-search --query ${moduleId} --level error 搜索相关错误。`,
  ].join('\n');
}

function printTroubleshootingHints(moduleId: string): void {
  console.error(formatTroubleshootingHints(moduleId));
}

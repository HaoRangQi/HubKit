import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleStateManager } from '../../registry/module-state';
import { config } from '../../config/config';

/**
 * enable 命令 - 启用模块
 */
export function registerEnableCommand(
  program: Command,
  registry: ModuleRegistry,
  stateManager: ModuleStateManager
): void {
  program
    .command('enable <moduleId>')
    .description('启用模块')
    .action((moduleId: string) => {
      try {
        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        stateManager.setEnabled(moduleId, true);
        console.log(`已启用模块: ${module.name} (${moduleId})`);
      } catch (error) {
        console.error('启用模块失败:', error);
        process.exit(1);
      }
    });
}

/**
 * disable 命令 - 禁用模块
 */
export function registerDisableCommand(
  program: Command,
  registry: ModuleRegistry,
  stateManager: ModuleStateManager
): void {
  program
    .command('disable <moduleId>')
    .description('禁用模块')
    .action((moduleId: string) => {
      try {
        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        stateManager.setEnabled(moduleId, false);
        console.log(`已禁用模块: ${module.name} (${moduleId})`);
      } catch (error) {
        console.error('禁用模块失败:', error);
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { scanAndRegisterModules } from './module-loader';

export interface ListCommandDependencies {
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
}

/**
 * list 命令 - 列出所有模块
 */
export function registerListCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: ListCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;

  program
    .command('list')
    .description('列出所有模块')
    .option('-e, --enabled', '仅显示已启用的模块')
    .option('-t, --type <type>', '按类型过滤 (nodejs|python|shell)')
    .action(async (options) => {
      try {
        await scanAndRegister(registry);

        // 获取模块列表
        let modules = registry.list();

        // 应用过滤器
        if (options.enabled) {
          modules = modules.filter(m => m.enabled);
        }
        if (options.type) {
          modules = modules.filter(m => m.type === options.type);
        }

        // 显示结果
        if (modules.length === 0) {
          console.log('未找到模块');
          return;
        }

        console.log(`\n找到 ${modules.length} 个模块:\n`);
        modules.forEach(m => {
          const status = m.enabled ? '✓' : '✗';
          console.log(`  ${status} ${m.name} (${m.id})`);
          console.log(`    类型: ${m.type}`);
          console.log(`    脚本: ${m.scriptPath}`);
          if (m.description) {
            console.log(`    描述: ${m.description}`);
          }
          console.log();
        });
      } catch (error) {
        console.error('列出模块失败:', error);
        process.exit(1);
      }
    });
}

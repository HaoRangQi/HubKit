import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleLifecycle } from '../../runtime/module-lifecycle';
import { scanAndRegisterModules } from './module-loader';

const defaultLifecycle = new ModuleLifecycle();

export interface StatusCommandDependencies {
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
  lifecycle?: Pick<ModuleLifecycle, 'status'>;
}

/**
 * status 命令 - 查看模块状态
 */
export function registerStatusCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: StatusCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const lifecycle = dependencies.lifecycle || defaultLifecycle;

  program
    .command('status [moduleId]')
    .description('查看模块状态')
    .action(async (moduleId?: string) => {
      try {
        await scanAndRegister(registry);

        if (moduleId) {
          // 查看单个模块状态
          await showModuleStatus(registry, moduleId, lifecycle);
        } else {
          // 查看所有模块状态
          await showAllModulesStatus(registry, lifecycle);
        }
      } catch (error) {
        console.error('查询状态失败:', error);
        process.exit(1);
      }
    });
}

/**
 * 显示单个模块状态
 */
async function showModuleStatus(
  registry: ModuleRegistry,
  moduleId: string,
  lifecycle: Pick<ModuleLifecycle, 'status'>,
): Promise<void> {
  const module = registry.get(moduleId);
  if (!module) {
    console.error(`模块不存在: ${moduleId}`);
    process.exit(1);
  }

  const status = await lifecycle.status(module);

  console.log(`\n模块: ${module.name} (${module.id})`);
  console.log(`类型: ${module.type}`);
  console.log(`状态: ${status.status}`);

  if (status.pid) {
    console.log(`进程 ID: ${status.pid}`);
  }
  if (status.uptime) {
    console.log(`运行时长: ${Math.floor(status.uptime / 60)} 分钟`);
  }
  if (status.memory) {
    console.log(`内存占用: ${status.memory.toFixed(2)} MB`);
  }
  if (status.cpu) {
    console.log(`CPU 占用: ${status.cpu.toFixed(2)}%`);
  }
  if (status.error) {
    console.log(`错误: ${status.error}`);
  }
  console.log();
}

/**
 * 显示所有模块状态
 */
async function showAllModulesStatus(
  registry: ModuleRegistry,
  lifecycle: Pick<ModuleLifecycle, 'status'>,
): Promise<void> {
  const modules = registry.list();

  if (modules.length === 0) {
    console.log('未找到模块');
    return;
  }

  console.log(`\n共 ${modules.length} 个模块:\n`);

  for (const module of modules) {
    try {
      const status = await lifecycle.status(module);

      const statusIcon = status.status === 'running' ? '●' : '○';
      console.log(`  ${statusIcon} ${module.name} (${module.id}) - ${status.status}`);
    } catch (error) {
      console.log(`  ✗ ${module.name} (${module.id}) - error`);
    }
  }
  console.log();
}

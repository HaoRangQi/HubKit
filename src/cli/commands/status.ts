import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleScanner } from '../../registry/module-scanner';
import { config } from '../../config/config';
import { NodeJSAdapter } from '../../adapters/nodejs-adapter';
import { PythonAdapter } from '../../adapters/python-adapter';
import { ShellAdapter } from '../../adapters/shell-adapter';
import { ModuleProtocol } from '../../types/module';

/**
 * status 命令 - 查看模块状态
 */
export function registerStatusCommand(program: Command, registry: ModuleRegistry): void {
  program
    .command('status [moduleId]')
    .description('查看模块状态')
    .action(async (moduleId?: string) => {
      try {
        // 先扫描模块
        const scanner = new ModuleScanner();
        const moduleDirs = config.getModuleDirs();
        for (const dir of moduleDirs) {
          const modules = await scanner.scan(dir);
          modules.forEach(m => registry.register(m));
        }

        if (moduleId) {
          // 查看单个模块状态
          await showModuleStatus(registry, moduleId);
        } else {
          // 查看所有模块状态
          await showAllModulesStatus(registry);
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
async function showModuleStatus(registry: ModuleRegistry, moduleId: string): Promise<void> {
  const module = registry.get(moduleId);
  if (!module) {
    console.error(`模块不存在: ${moduleId}`);
    process.exit(1);
  }

  const adapter = createAdapter(module);
  const status = await adapter.status();

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
async function showAllModulesStatus(registry: ModuleRegistry): Promise<void> {
  const modules = registry.list();

  if (modules.length === 0) {
    console.log('未找到模块');
    return;
  }

  console.log(`\n共 ${modules.length} 个模块:\n`);

  for (const module of modules) {
    try {
      const adapter = createAdapter(module);
      const status = await adapter.status();

      const statusIcon = status.status === 'running' ? '●' : '○';
      console.log(`  ${statusIcon} ${module.name} (${module.id}) - ${status.status}`);
    } catch (error) {
      console.log(`  ✗ ${module.name} (${module.id}) - error`);
    }
  }
  console.log();
}

/**
 * 创建适配器
 */
function createAdapter(module: any): ModuleProtocol {
  const metadata = {
    id: module.id,
    name: module.name,
    type: module.type as 'nodejs' | 'python' | 'shell',
    scriptPath: module.scriptPath,
    autoStart: module.autoStart || false,
    enabled: module.enabled !== false,
  };

  switch (module.type) {
    case 'nodejs':
      return new NodeJSAdapter(metadata);
    case 'python':
      return new PythonAdapter(metadata);
    case 'shell':
      return new ShellAdapter(metadata);
    default:
      throw new Error(`不支持的模块类型: ${module.type}`);
  }
}

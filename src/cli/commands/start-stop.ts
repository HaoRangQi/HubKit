import { Command } from 'commander';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleScanner } from '../../registry/module-scanner';
import { config } from '../../config/config';
import { NodeJSAdapter } from '../../adapters/nodejs-adapter';
import { PythonAdapter } from '../../adapters/python-adapter';
import { ShellAdapter } from '../../adapters/shell-adapter';
import { ModuleProtocol } from '../../types/module';

/**
 * 扫描并注册模块
 */
async function scanAndRegister(registry: ModuleRegistry): Promise<void> {
  const scanner = new ModuleScanner();
  const moduleDirs = config.getModuleDirs();
  for (const dir of moduleDirs) {
    const modules = await scanner.scan(dir);
    modules.forEach(m => registry.register(m));
  }
}

/**
 * start 命令 - 启动模块
 */
export function registerStartCommand(program: Command, registry: ModuleRegistry): void {
  program
    .command('start <moduleId>')
    .description('启动模块')
    .action(async (moduleId: string) => {
      try {
        await scanAndRegister(registry);

        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        if (!module.enabled) {
          console.error(`模块未启用: ${module.name}`);
          process.exit(1);
        }

        const adapter = createAdapter(module.type, module);
        const success = await adapter.start();

        if (success) {
          console.log(`✓ 已启动模块: ${module.name} (${moduleId})`);
        } else {
          console.error(`✗ 启动失败: ${module.name}`);
          process.exit(1);
        }
      } catch (error) {
        console.error('启动模块失败:', error);
        process.exit(1);
      }
    });
}

/**
 * stop 命令 - 停止模块
 */
export function registerStopCommand(program: Command, registry: ModuleRegistry): void {
  program
    .command('stop <moduleId>')
    .description('停止模块')
    .option('-f, --force', '强制停止（SIGKILL）')
    .action(async (moduleId: string, options: { force?: boolean }) => {
      try {
        await scanAndRegister(registry);

        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        const adapter = createAdapter(module.type, module);
        const success = await adapter.stop(options.force);

        if (success) {
          console.log(`✓ 已停止模块: ${module.name} (${moduleId})`);
        } else {
          console.error(`✗ 停止失败: ${module.name}`);
          process.exit(1);
        }
      } catch (error) {
        console.error('停止模块失败:', error);
        process.exit(1);
      }
    });
}

/**
 * restart 命令 - 重启模块
 */
export function registerRestartCommand(program: Command, registry: ModuleRegistry): void {
  program
    .command('restart <moduleId>')
    .description('重启模块')
    .action(async (moduleId: string) => {
      try {
        await scanAndRegister(registry);

        const module = registry.get(moduleId);
        if (!module) {
          console.error(`模块不存在: ${moduleId}`);
          process.exit(1);
        }

        const adapter = createAdapter(module.type, module);

        // 先停止
        await adapter.stop();
        console.log(`停止模块: ${module.name}`);

        // 等待 1 秒
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 再启动
        const success = await adapter.start();
        if (success) {
          console.log(`✓ 已重启模块: ${module.name} (${moduleId})`);
        } else {
          console.error(`✗ 重启失败: ${module.name}`);
          process.exit(1);
        }
      } catch (error) {
        console.error('重启模块失败:', error);
        process.exit(1);
      }
    });
}

/**
 * 创建适配器
 */
function createAdapter(type: string, module: any): ModuleProtocol {
  const metadata = {
    id: module.id,
    name: module.name,
    type: type as 'nodejs' | 'python' | 'shell',
    scriptPath: module.scriptPath,
    autoStart: module.autoStart || false,
    enabled: module.enabled,
  };

  switch (type) {
    case 'nodejs':
      return new NodeJSAdapter(metadata);
    case 'python':
      return new PythonAdapter(metadata);
    case 'shell':
      return new ShellAdapter(metadata);
    default:
      throw new Error(`不支持的模块类型: ${type}`);
  }
}

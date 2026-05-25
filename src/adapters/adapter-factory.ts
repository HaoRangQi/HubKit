import { ModuleMetadata, ModuleProtocol } from '../types/module';
import { NodeJSAdapter } from './nodejs-adapter';
import { PythonAdapter } from './python-adapter';
import { ShellAdapter } from './shell-adapter';

/**
 * 创建模块适配器。
 *
 * 所有入口统一通过这里选择 adapter，避免 CLI、Web、scheduler 各自维护类型分发。
 */
export function createModuleAdapter(module: ModuleMetadata): ModuleProtocol {
  switch (module.type) {
    case 'nodejs':
      return new NodeJSAdapter(module);
    case 'python':
      return new PythonAdapter(module);
    case 'shell':
      return new ShellAdapter(module);
    default:
      return assertUnsupportedModuleType(module.type);
  }
}

function assertUnsupportedModuleType(type: never): never {
  throw new Error(`不支持的模块类型: ${type}`);
}

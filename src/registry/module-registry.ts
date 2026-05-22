import { ModuleMetadata } from '../types/module';

/**
 * 模块注册表
 * 管理所有已注册的模块
 */
export class ModuleRegistry {
  private modules: Map<string, ModuleMetadata>;

  constructor() {
    this.modules = new Map();
  }

  /**
   * 注册模块
   */
  register(module: ModuleMetadata): void {
    this.modules.set(module.id, module);
  }

  /**
   * 注销模块
   */
  unregister(moduleId: string): boolean {
    return this.modules.delete(moduleId);
  }

  /**
   * 获取模块
   */
  get(moduleId: string): ModuleMetadata | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * 列出所有模块
   */
  list(): ModuleMetadata[] {
    return Array.from(this.modules.values());
  }

  /**
   * 列出已启用的模块
   */
  listEnabled(): ModuleMetadata[] {
    return this.list().filter(m => m.enabled);
  }

  /**
   * 列出指定类型的模块
   */
  listByType(type: 'nodejs' | 'python' | 'shell'): ModuleMetadata[] {
    return this.list().filter(m => m.type === type);
  }

  /**
   * 检查模块是否存在
   */
  has(moduleId: string): boolean {
    return this.modules.has(moduleId);
  }

  /**
   * 获取模块数量
   */
  count(): number {
    return this.modules.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.modules.clear();
  }
}

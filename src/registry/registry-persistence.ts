import * as fs from 'fs';
import * as path from 'path';
import { ModuleMetadata } from '../types/module';

/**
 * 模块注册表持久化管理器
 */
export class ModuleRegistryPersistence {
  private registryFile: string;

  constructor(dataDir: string) {
    this.registryFile = path.join(dataDir, 'module-registry.json');
  }

  /**
   * 保存注册表
   */
  save(modules: ModuleMetadata[]): void {
    try {
      const dir = path.dirname(this.registryFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.registryFile, JSON.stringify(modules, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save registry:', error);
    }
  }

  /**
   * 加载注册表
   */
  load(): ModuleMetadata[] {
    try {
      if (fs.existsSync(this.registryFile)) {
        const content = fs.readFileSync(this.registryFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('Failed to load registry:', error);
    }
    return [];
  }

  /**
   * 检查注册表文件是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.registryFile);
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { ModuleMetadata } from '../types/module';

/**
 * 模块状态持久化
 */
export class ModuleStateManager {
  private stateFile: string;
  private states: Map<string, { enabled: boolean }>;

  constructor(dataDir: string) {
    this.stateFile = path.join(dataDir, 'module-states.json');
    this.states = new Map();
    this.load();
  }

  /**
   * 加载状态
   */
  private load(): void {
    try {
      if (fs.existsSync(this.stateFile)) {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        const data = JSON.parse(content);
        this.states = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load module states:', error);
    }
  }

  /**
   * 保存状态
   */
  private save(): void {
    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.states);
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save module states:', error);
    }
  }

  /**
   * 设置模块启用状态
   */
  setEnabled(moduleId: string, enabled: boolean): void {
    this.states.set(moduleId, { enabled });
    this.save();
  }

  /**
   * 获取模块启用状态
   */
  isEnabled(moduleId: string): boolean {
    const state = this.states.get(moduleId);
    return state?.enabled ?? true; // 默认启用
  }

  /**
   * 应用状态到模块元数据
   */
  applyState(module: ModuleMetadata): ModuleMetadata {
    return {
      ...module,
      enabled: this.isEnabled(module.id),
    };
  }
}

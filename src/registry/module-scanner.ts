import * as fs from 'fs';
import * as path from 'path';
import { ModuleMetadata } from '../types/module';
import { ModuleConfig, normalizeModuleConfig, validateModuleConfig } from './module-config';

/**
 * 模块扫描器
 * 扫描指定目录，发现并加载模块配置
 */
export class ModuleScanner {
  /**
   * 扫描目录，查找所有模块配置文件
   */
  async scan(directory: string): Promise<ModuleMetadata[]> {
    const modules: ModuleMetadata[] = [];

    if (!fs.existsSync(directory)) {
      return modules;
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        // 检查目录中是否有 .hubkit.json 配置文件
        const configPath = path.join(fullPath, '.hubkit.json');
        if (fs.existsSync(configPath)) {
          const module = await this.loadModuleConfig(configPath, fullPath);
          if (module) {
            modules.push(module);
          }
        }

        // 递归扫描子目录
        const subModules = await this.scan(fullPath);
        modules.push(...subModules);
      }
    }

    return modules;
  }

  /**
   * 加载模块配置文件
   */
  private async loadModuleConfig(
    configPath: string,
    moduleDir: string
  ): Promise<ModuleMetadata | null> {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config: ModuleConfig = JSON.parse(content);
      const validation = validateModuleConfig(config);

      if (!validation.valid) {
        console.warn(`Invalid module config: ${configPath}`);
        validation.errors.forEach((issue) => {
          console.warn(`  - ${issue.field}: ${issue.message}`);
        });
        return null;
      }

      validation.warnings.forEach((issue) => {
        console.warn(`Module config warning: ${configPath}`);
        console.warn(`  - ${issue.field}: ${issue.message}`);
      });

      const module = normalizeModuleConfig(config, moduleDir);

      // 检查脚本路径（目录也视为有效）
      if (!fs.existsSync(module.scriptPath)) {
        console.warn(`Script not found: ${module.scriptPath}`);
        return null;
      }

      return module;
    } catch (error) {
      console.error(`Failed to load module config: ${configPath}`, error);
      return null;
    }
  }

  /**
   * 验证模块配置
   */
  validateConfig(config: ModuleConfig): boolean {
    return validateModuleConfig(config).valid;
  }
}

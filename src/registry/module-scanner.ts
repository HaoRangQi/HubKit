import * as fs from 'fs';
import * as path from 'path';
import { ModuleMetadata } from '../types/module';

/**
 * 模块配置文件接口
 */
interface ModuleConfig {
  id: string;
  name: string;
  description?: string;
  type: 'nodejs' | 'python' | 'shell';
  scriptPath: string;
  startScript?: string;
  webUrl?: string;
  webPort?: number;
  updateable?: boolean;
  repoUrl?: string;
  autoStart?: boolean;
  enabled?: boolean;
}

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

      // 验证必需字段
      if (!config.id || !config.name || !config.type || !config.scriptPath) {
        console.warn(`Invalid module config: ${configPath}`);
        return null;
      }

      // 解析脚本路径（相对于模块目录）
      const scriptPath = path.isAbsolute(config.scriptPath)
        ? config.scriptPath
        : path.join(moduleDir, config.scriptPath);

      // 检查脚本路径（目录也视为有效）
      if (!fs.existsSync(scriptPath)) {
        console.warn(`Script not found: ${scriptPath}`);
        return null;
      }

      return {
        id: config.id,
        name: config.name,
        description: config.description,
        type: config.type,
        scriptPath,
        startScript: config.startScript,
        webUrl: config.webUrl,
        webPort: config.webPort,
        updateable: config.updateable,
        repoUrl: config.repoUrl,
        autoStart: config.autoStart ?? false,
        enabled: config.enabled ?? true,
      };
    } catch (error) {
      console.error(`Failed to load module config: ${configPath}`, error);
      return null;
    }
  }

  /**
   * 验证模块配置
   */
  validateConfig(config: ModuleConfig): boolean {
    if (!config.id || typeof config.id !== 'string') return false;
    if (!config.name || typeof config.name !== 'string') return false;
    if (!['nodejs', 'python', 'shell'].includes(config.type)) return false;
    if (!config.scriptPath || typeof config.scriptPath !== 'string') return false;
    return true;
  }
}

import { promises as fs } from 'fs';
import { BaseAdapter } from './base-adapter';
import { ModuleMetadata } from '../types/module';

/**
 * Shell 脚本适配器
 *
 * 支持通过模块协议管理 Shell 脚本
 */
export class ShellAdapter extends BaseAdapter {
  constructor(metadata: ModuleMetadata) {
    super(metadata);
  }

  /**
   * 构建启动命令
   */
  protected async buildStartCommand(): Promise<{
    cmd: string;
    args: string[];
    env?: Record<string, string>;
  }> {
    const scriptPath = this.metadata.scriptPath;

    // 检查脚本是否有执行权限
    try {
      await fs.access(scriptPath, fs.constants.X_OK);
    } catch {
      // 没有执行权限，尝试添加
      try {
        await fs.chmod(scriptPath, 0o755);
      } catch (error) {
        throw new Error(`无法设置脚本执行权限: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 读取 shebang 行确定 shell 类型
    let shellCmd = 'bash'; // 默认使用 bash

    try {
      const content = await fs.readFile(scriptPath, 'utf-8');
      const firstLine = content.split('\n')[0];

      if (firstLine.startsWith('#!')) {
        const shebang = firstLine.substring(2).trim();

        if (shebang.includes('zsh')) {
          shellCmd = 'zsh';
        } else if (shebang.includes('bash')) {
          shellCmd = 'bash';
        } else if (shebang.includes('sh')) {
          shellCmd = 'sh';
        } else if (shebang.startsWith('/')) {
          // 使用 shebang 指定的完整路径
          shellCmd = shebang.split(' ')[0];
        }
      }
    } catch {
      // 读取失败，使用默认 shell
    }

    return {
      cmd: shellCmd,
      args: [scriptPath],
      env: {}
    };
  }
}

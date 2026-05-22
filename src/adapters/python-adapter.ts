import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { BaseAdapter } from './base-adapter';
import { ModuleMetadata } from '../types/module';

/**
 * Python 脚本适配器
 *
 * 支持通过模块协议管理 Python 脚本
 */
export class PythonAdapter extends BaseAdapter {
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
    const scriptDir = dirname(this.metadata.scriptPath);
    const scriptName = this.metadata.scriptPath;

    // 检查虚拟环境
    const venvPaths = [
      join(scriptDir, 'venv', 'bin', 'python'),
      join(scriptDir, '.venv', 'bin', 'python'),
      join(scriptDir, 'venv', 'bin', 'python3'),
      join(scriptDir, '.venv', 'bin', 'python3')
    ];

    let pythonCmd = 'python3'; // 默认使用 python3

    for (const venvPath of venvPaths) {
      try {
        await fs.access(venvPath);
        pythonCmd = venvPath;
        break;
      } catch {
        // 虚拟环境不存在，继续检查
      }
    }

    // 如果没有找到 python3，尝试 python
    if (pythonCmd === 'python3') {
      try {
        const { execSync } = require('child_process');
        execSync('which python3', { stdio: 'ignore' });
      } catch {
        pythonCmd = 'python';
      }
    }

    return {
      cmd: pythonCmd,
      args: [scriptName],
      env: {
        PYTHONUNBUFFERED: '1' // 禁用输出缓冲
      }
    };
  }
}

import { exec } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { join, dirname } from 'path';
import { BaseAdapter } from './base-adapter';
import { ModuleMetadata, ModuleStartPreparation, ModuleStartReadiness } from '../types/module';

/**
 * Node.js 脚本适配器
 *
 * 支持通过模块协议管理 Node.js 脚本
 */
export class NodeJSAdapter extends BaseAdapter {
  constructor(metadata: ModuleMetadata) {
    super(metadata);
  }

  async inspectStartReadiness(): Promise<ModuleStartReadiness> {
    const baseReadiness = await super.inspectStartReadiness();
    if (!baseReadiness.ready) {
      return baseReadiness;
    }

    const installPlan = await this.getDependencyInstallPlan();
    if (!installPlan) {
      return {
        ready: true,
        actionLabel: '启动',
        summary: '可直接启动',
      };
    }

    return {
      ready: false,
      actionLabel: '安装依赖并启动',
      summary: '检测到缺少 Node.js 依赖',
      details: '首次启动会先安装依赖，再继续启动模块',
      installCommand: `${installPlan.cmd} ${installPlan.args.join(' ')}`,
    };
  }

  protected async prepareForStart(): Promise<ModuleStartPreparation | null> {
    const installPlan = await this.getDependencyInstallPlan();
    if (!installPlan) {
      return null;
    }

    const installCommandText = `${installPlan.cmd} ${installPlan.args.join(' ')}`;
    this.setRuntimePhase('installing', '正在安装 Node.js 依赖', {
      details: installCommandText,
      health: this.createHealthReport('checking', '依赖安装中', installCommandText),
    });
    await this.appendLogLine(`[HubKit] 检测到缺少 Node.js 依赖，开始执行：${installCommandText}`);
    await this.runInstallCommand(installPlan.cmd, installPlan.args, installPlan.cwd);
    await this.appendLogLine(`[HubKit] 依赖安装完成：${installCommandText}`);

    return {
      dependencyInstalled: true,
      installCommand: installCommandText,
      summary: '已安装依赖并启动',
    };
  }

  private async getDependencyInstallPlan(): Promise<{ cmd: string; args: string[]; cwd: string } | null> {
    const moduleDir = this.resolveModuleDir();
    const packageJsonPath = join(moduleDir, 'package.json');
    const packageJson = await this.readPackageJson(packageJsonPath);

    if (!packageJson) {
      return null;
    }

    const hasDependencies = Boolean(
      (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) ||
      (packageJson.devDependencies && Object.keys(packageJson.devDependencies).length > 0)
    );

    if (!hasDependencies) {
      return null;
    }

    const hasNodeModules = await this.pathExists(join(moduleDir, 'node_modules'));
    if (hasNodeModules) {
      return null;
    }

    const installCommand = await this.resolveInstallCommand(moduleDir);
    return { ...installCommand, cwd: moduleDir };
  }

  /**
   * 构建启动命令
   */
  protected async buildStartCommand(): Promise<{
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }> {
    // 判断 scriptPath 是目录还是文件
    const moduleDir = this.resolveModuleDir();

    // 如果指定了 startScript，直接使用 npm run <script>
    if (this.metadata.startScript) {
      return {
        cmd: 'npm',
        args: ['run', this.metadata.startScript],
        cwd: moduleDir,
        env: { NODE_ENV: 'development' }
      };
    }

    // 检查是否有 package.json 且有 start 脚本
    const packageJsonPath = join(moduleDir, 'package.json');
    let hasStartScript = false;

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      hasStartScript = !!packageJson.scripts?.start;
    } catch {
      // package.json 不存在或无 start 脚本
    }

    if (hasStartScript) {
      return {
        cmd: 'npm',
        args: ['start'],
        cwd: moduleDir,
        env: { NODE_ENV: 'production' }
      };
    }

    return {
      cmd: 'node',
      args: [this.metadata.scriptPath],
      cwd: moduleDir,
      env: { NODE_ENV: 'production' }
    };
  }

  private resolveModuleDir(): string {
    try {
      const stat = statSync(this.metadata.scriptPath);
      return stat.isDirectory() ? this.metadata.scriptPath : dirname(this.metadata.scriptPath);
    } catch {
      return dirname(this.metadata.scriptPath);
    }
  }

  private async readPackageJson(packageJsonPath: string): Promise<any | null> {
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveInstallCommand(moduleDir: string): Promise<{ cmd: string; args: string[] }> {
    if (await this.pathExists(join(moduleDir, 'bun.lock'))) {
      return { cmd: 'bun', args: ['install'] };
    }
    if (await this.pathExists(join(moduleDir, 'pnpm-lock.yaml'))) {
      return { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] };
    }
    if (await this.pathExists(join(moduleDir, 'yarn.lock'))) {
      return { cmd: 'yarn', args: ['install', '--frozen-lockfile'] };
    }
    if (await this.pathExists(join(moduleDir, 'package-lock.json'))) {
      return { cmd: 'npm', args: ['ci'] };
    }
    return { cmd: 'npm', args: ['install'] };
  }

  private async runInstallCommand(cmd: string, args: string[], cwd: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      exec([cmd, ...args].join(' '), { cwd }, (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || stdout?.trim() || error.message;
          void this.appendLogLine(`[HubKit] 依赖安装失败：${message}`);
          reject(new Error(`依赖安装失败（${cmd} ${args.join(' ')}）：${message}`));
          return;
        }
        const output = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n');
        if (output) {
          void this.appendLogLine(output);
        }
        resolve();
      });
    });
  }
}

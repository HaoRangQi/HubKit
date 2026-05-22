import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModuleMetadata } from '../types/module';

/**
 * LaunchAgent 配置
 */
interface LaunchAgentConfig {
  Label: string;
  ProgramArguments: string[];
  RunAtLoad: boolean;
  KeepAlive: boolean;
  StandardOutPath: string;
  StandardErrorPath: string;
  WorkingDirectory: string;
}

/**
 * LaunchAgents 集成管理器
 * 管理 macOS LaunchAgents 的创建和删除
 */
export class LaunchAgentManager {
  private launchAgentsDir: string;

  constructor() {
    this.launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    this.ensureDir();
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.launchAgentsDir)) {
      fs.mkdirSync(this.launchAgentsDir, { recursive: true });
    }
  }

  /**
   * 获取 plist 文件路径
   */
  private getPlistPath(moduleId: string): string {
    return path.join(this.launchAgentsDir, `com.hubkit.${moduleId}.plist`);
  }

  /**
   * 创建 LaunchAgent
   */
  createLaunchAgent(module: ModuleMetadata, hubkitPath: string): void {
    const config: LaunchAgentConfig = {
      Label: `com.hubkit.${module.id}`,
      ProgramArguments: [hubkitPath, 'start', module.id],
      RunAtLoad: module.autoStart,
      KeepAlive: true,
      StandardOutPath: path.join(os.homedir(), '.hubkit', 'logs', `${module.id}.out.log`),
      StandardErrorPath: path.join(os.homedir(), '.hubkit', 'logs', `${module.id}.err.log`),
      WorkingDirectory: os.homedir(),
    };

    const plist = this.generatePlist(config);
    const plistPath = this.getPlistPath(module.id);

    fs.writeFileSync(plistPath, plist, 'utf-8');
    console.log(`Created LaunchAgent: ${plistPath}`);
  }

  /**
   * 删除 LaunchAgent
   */
  removeLaunchAgent(moduleId: string): void {
    const plistPath = this.getPlistPath(moduleId);
    if (fs.existsSync(plistPath)) {
      fs.unlinkSync(plistPath);
      console.log(`Removed LaunchAgent: ${plistPath}`);
    }
  }

  /**
   * 检查 LaunchAgent 是否存在
   */
  exists(moduleId: string): boolean {
    return fs.existsSync(this.getPlistPath(moduleId));
  }

  /**
   * 生成 plist XML
   */
  private generatePlist(config: LaunchAgentConfig): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${config.Label}</string>
  <key>ProgramArguments</key>
  <array>
    ${config.ProgramArguments.map(arg => `<string>${arg}</string>`).join('\n    ')}
  </array>
  <key>RunAtLoad</key>
  <${config.RunAtLoad}/>
  <key>KeepAlive</key>
  <${config.KeepAlive}/>
  <key>StandardOutPath</key>
  <string>${config.StandardOutPath}</string>
  <key>StandardErrorPath</key>
  <string>${config.StandardErrorPath}</string>
  <key>WorkingDirectory</key>
  <string>${config.WorkingDirectory}</string>
</dict>
</plist>`;
  }

  /**
   * 加载 LaunchAgent
   */
  load(moduleId: string): void {
    const plistPath = this.getPlistPath(moduleId);
    if (fs.existsSync(plistPath)) {
      // 使用 launchctl 加载
      const { execSync } = require('child_process');
      execSync(`launchctl load ${plistPath}`);
    }
  }

  /**
   * 卸载 LaunchAgent
   */
  unload(moduleId: string): void {
    const plistPath = this.getPlistPath(moduleId);
    if (fs.existsSync(plistPath)) {
      const { execSync } = require('child_process');
      try {
        execSync(`launchctl unload ${plistPath}`);
      } catch {
        // 忽略错误
      }
    }
  }
}

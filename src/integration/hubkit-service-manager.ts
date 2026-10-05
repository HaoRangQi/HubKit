import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export const HUBKIT_SERVICE_LABEL = 'io.hubkit.runtime';
export const DEFAULT_SERVICE_PORT = 2282;

interface ServiceEnvironment {
  platform: string;
  homeDir: string;
  projectDir: string;
  nodePath: string;
  pathEnv: string;
  uid: number;
  run: (command: string, args: string[]) => string;
}

export interface HubKitServiceStatus {
  installed: boolean;
  loaded: boolean;
  pid?: number;
  port?: number;
  plistPath: string;
}

/** Manages the HubKit server itself; module LaunchAgents have a separate owner. */
export class HubKitServiceManager {
  readonly plistPath: string;
  private readonly environment: ServiceEnvironment;

  constructor(overrides: Partial<ServiceEnvironment> = {}) {
    this.environment = {
      platform: process.platform,
      homeDir: os.homedir(),
      projectDir: path.resolve(__dirname, '../..'),
      nodePath: process.execPath,
      pathEnv: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
      uid: process.getuid?.() ?? 0,
      run: (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      ...overrides,
    };
    this.plistPath = path.join(this.environment.homeDir, 'Library/LaunchAgents', `${HUBKIT_SERVICE_LABEL}.plist`);
  }

  install(port = DEFAULT_SERVICE_PORT): void {
    this.requireMacOS();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1 到 65535 之间的整数');
    const cliPath = path.join(this.environment.projectDir, 'dist/cli/index.js');
    if (!fs.existsSync(cliPath)) throw new Error('请先运行 npm run build，再安装本机服务');
    const logDir = path.join(this.environment.homeDir, '.hubkit/logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.plistPath), { recursive: true });
    if (fs.existsSync(this.plistPath)) fs.copyFileSync(this.plistPath, `${this.plistPath}.bak`);
    this.stop();
    const temporaryPath = `${this.plistPath}.tmp`;
    fs.writeFileSync(temporaryPath, this.buildPlist(port, cliPath, logDir), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.plistPath);
    this.environment.run('launchctl', ['bootstrap', this.domain, this.plistPath]);
  }

  start(): void {
    this.requireMacOS();
    if (!fs.existsSync(this.plistPath)) throw new Error('本机服务尚未安装，请先运行 hub service install');
    if (!this.status().loaded) this.environment.run('launchctl', ['bootstrap', this.domain, this.plistPath]);
  }

  stop(): void {
    this.requireMacOS();
    if (this.status().loaded) this.environment.run('launchctl', ['bootout', this.target]);
  }

  uninstall(): void {
    this.stop();
    if (fs.existsSync(this.plistPath)) fs.unlinkSync(this.plistPath);
  }

  status(): HubKitServiceStatus {
    this.requireMacOS();
    const installed = fs.existsSync(this.plistPath);
    const plist = installed ? fs.readFileSync(this.plistPath, 'utf8') : '';
    const portMatch = plist.match(/<string>--port<\/string>\s*<string>(\d+)<\/string>/);
    const base = { installed, port: portMatch ? Number(portMatch[1]) : undefined, plistPath: this.plistPath };
    try {
      const output = this.environment.run('launchctl', ['print', this.target]);
      const pidMatch = output.match(/\bpid = (\d+)/);
      return { ...base, loaded: true, pid: pidMatch ? Number(pidMatch[1]) : undefined };
    } catch {
      return { ...base, loaded: false };
    }
  }

  private get domain(): string { return `gui/${this.environment.uid}`; }
  private get target(): string { return `${this.domain}/${HUBKIT_SERVICE_LABEL}`; }

  private requireMacOS(): void {
    if (this.environment.platform !== 'darwin') throw new Error('本机后台服务安装目前仅支持 macOS');
  }

  private buildPlist(port: number, cliPath: string, logDir: string): string {
    const { nodePath, projectDir, pathEnv } = this.environment;
    const args = [nodePath, cliPath, 'web', '--host', '127.0.0.1', '--port', String(port)];
    const executablePath = `${path.dirname(nodePath)}:${pathEnv}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${HUBKIT_SERVICE_LABEL}</string>
  <key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(projectDir)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(executablePath)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, 'hubkit-service.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, 'hubkit-service.err.log'))}</string>
</dict></plist>
`;
  }
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

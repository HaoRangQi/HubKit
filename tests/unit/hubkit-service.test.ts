import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerCommands } from '../../src/cli/commands';

describe('HubKit native service', () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

  function setup(platform = 'darwin'): any {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-service-'));
    directories.push(homeDir);
    const projectDir = path.join(homeDir, 'Project & tools');
    fs.mkdirSync(path.join(projectDir, 'dist/cli'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'dist/cli/index.js'), '');
    const run = jest.fn(() => 'pid = 42\n');
    const { HubKitServiceManager } = require('../../src/integration/hubkit-service-manager');
    const manager = new HubKitServiceManager({ platform, homeDir, projectDir, nodePath: '/opt/node & tools/node', pathEnv: '/usr/bin:/bin', uid: 501, run });
    return { manager, run, homeDir, projectDir };
  }

  it('exposes a discoverable service command alongside native web', () => {
    const program = new Command();
    registerCommands(program);
    const service = program.commands.find(command => command.name() === 'service');
    expect(service).toBeDefined();
    expect(service?.commands.map(command => command.name())).toEqual(expect.arrayContaining(['install', 'start', 'stop', 'status', 'uninstall']));
  });

  it('installs only a loopback Web service with the original working directory', () => {
    const { manager, run, projectDir } = setup();
    manager.install(2282);
    const plist = fs.readFileSync(manager.plistPath, 'utf8');
    expect(plist).toContain('<string>127.0.0.1</string>');
    expect(plist).toContain('<string>2282</string>');
    expect(plist).toContain('Project &amp; tools');
    expect(plist).toContain('/opt/node &amp; tools/node');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain(path.basename(projectDir).replace('&', '&amp;'));
    expect(run).toHaveBeenCalledWith('launchctl', ['bootstrap', 'gui/501', manager.plistPath]);
    expect(fs.statSync(manager.plistPath).mode & 0o777).toBe(0o600);
  });

  it('stops only the HubKit LaunchAgent and leaves module data untouched', () => {
    const { manager, run, homeDir } = setup();
    const data = path.join(homeDir, '.hubkit/data/keep');
    fs.mkdirSync(path.dirname(data), { recursive: true });
    fs.writeFileSync(data, 'module data');
    manager.install(2282);
    run.mockClear();
    manager.stop();
    expect(run).toHaveBeenCalledWith('launchctl', ['bootout', 'gui/501/io.hubkit.runtime']);
    expect(fs.readFileSync(data, 'utf8')).toBe('module data');
    expect(run.mock.calls.some(([command]: string[]) => command === 'kill')).toBe(false);
  });

  it('preserves data and logs when uninstalling and makes an absent stop idempotent', () => {
    const { manager, run, homeDir } = setup();
    manager.install(2282);
    manager.uninstall();
    expect(fs.existsSync(manager.plistPath)).toBe(false);
    expect(fs.existsSync(path.join(homeDir, '.hubkit/logs'))).toBe(true);
    run.mockImplementation(() => { throw new Error('not loaded'); });
    expect(() => manager.stop()).not.toThrow();
  });

  it('rejects unsupported platforms and invalid ports before changing the filesystem', () => {
    const { manager, run } = setup('linux');
    expect(() => manager.install(2282)).toThrow('macOS');
    expect(run).not.toHaveBeenCalled();
    const mac = setup();
    expect(() => mac.manager.install(0)).toThrow('端口');
    expect(fs.existsSync(mac.manager.plistPath)).toBe(false);
  });
});

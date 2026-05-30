import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { LaunchAgentManager } from '../../src/integration/launchagent-manager';
import { ModuleMetadata } from '../../src/types/module';

jest.mock('os', () => {
  const actual = jest.requireActual<typeof os>('os');
  return {
    ...actual,
    homedir: jest.fn(),
  };
});

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const execSyncMock = execSync as jest.MockedFunction<typeof execSync>;
const homedirMock = os.homedir as jest.MockedFunction<typeof os.homedir>;

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: true,
    enabled: true,
    ...overrides,
  };
}

describe('LaunchAgentManager', () => {
  let tmpHome: string;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-launchagent-home-'));
    homedirMock.mockReturnValue(tmpHome);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    execSyncMock.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('creates a LaunchAgent plist under the user LaunchAgents directory', () => {
    const manager = new LaunchAgentManager();
    const module = createModule();

    manager.createLaunchAgent(module, '/usr/local/bin/hub');

    const plistPath = path.join(tmpHome, 'Library', 'LaunchAgents', 'com.hubkit.demo.plist');
    const plist = fs.readFileSync(plistPath, 'utf-8');
    expect(manager.exists('demo')).toBe(true);
    expect(plist).toContain('<string>com.hubkit.demo</string>');
    expect(plist).toContain('<string>/usr/local/bin/hub</string>');
    expect(plist).toContain('<string>start</string>');
    expect(plist).toContain('<string>demo</string>');
    expect(plist).toContain(`<string>${path.join(tmpHome, '.hubkit', 'logs', 'demo.out.log')}</string>`);
    expect(plist).toContain('<true/>');
  });

  it('removes existing LaunchAgent plist files', () => {
    const manager = new LaunchAgentManager();
    manager.createLaunchAgent(createModule(), '/usr/local/bin/hub');

    manager.removeLaunchAgent('demo');

    expect(manager.exists('demo')).toBe(false);
  });

  it('loads and unloads existing LaunchAgents through launchctl', () => {
    const manager = new LaunchAgentManager();
    manager.createLaunchAgent(createModule(), '/usr/local/bin/hub');
    const plistPath = path.join(tmpHome, 'Library', 'LaunchAgents', 'com.hubkit.demo.plist');

    manager.load('demo');
    manager.unload('demo');

    expect(execSyncMock).toHaveBeenCalledWith(`launchctl load ${plistPath}`);
    expect(execSyncMock).toHaveBeenCalledWith(`launchctl unload ${plistPath}`);
  });

  it('ignores unload failures to keep cleanup idempotent', () => {
    const manager = new LaunchAgentManager();
    manager.createLaunchAgent(createModule(), '/usr/local/bin/hub');
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('launchctl failed');
    });

    expect(() => manager.unload('demo')).not.toThrow();
  });
});

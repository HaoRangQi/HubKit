import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import {
  BootPreferenceService,
  detectBootPreferenceSupport,
  describeBootPreferenceMode,
  formatBootPreferenceMode,
  getBootPreferenceCommand,
  parseBootPreferenceOutput,
  SystemInfo,
} from '../../src/system-actions/boot-preference-service';
import { BootPreferenceMode } from '../../src/types/system-actions';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('../../src/runtime/log-tail', () => ({
  readLastLinesText: jest.fn(async (filePath: string) => fs.readFileSync(filePath, 'utf-8')),
}));

const execFileMock = execFile as jest.MockedFunction<typeof execFile>;
type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecFileOnce(handler: (file: string, args: readonly string[], callback: ExecFileCallback) => void): void {
  execFileMock.mockImplementationOnce(((file: string, args: readonly string[], callback: ExecFileCallback) => {
    handler(file, args, callback);
    return {} as any;
  }) as any);
}

class TestBootPreferenceService extends BootPreferenceService {
  systemInfo: SystemInfo = { platform: 'darwin', arch: 'arm64', macosVersion: '15.0.1' };
  readOutput = 'BootPreference\t%01';
  failReadWith: Error | null = null;
  adminCalls: string[] = [];
  failAdminWith: Error | null = null;

  protected async readSystemInfo(): Promise<SystemInfo> {
    return this.systemInfo;
  }

  protected async execReadCommand(_command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.failReadWith) {
      throw this.failReadWith;
    }
    return { stdout: this.readOutput, stderr: '', exitCode: 0 };
  }

  protected async execAdminCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.adminCalls.push(command);
    if (this.failAdminWith) {
      throw this.failAdminWith;
    }
    return { stdout: 'ok', stderr: '', exitCode: 0 };
  }
}

describe('BootPreferenceService helpers', () => {
  it('parses BootPreference output', () => {
    expect(parseBootPreferenceOutput('Error getting variable - "BootPreference": (iokit/common) data was not found')).toBe('default');
    expect(parseBootPreferenceOutput('BootPreference\t%00')).toBe('block_all');
    expect(parseBootPreferenceOutput('BootPreference\t%01')).toBe('block_lid');
    expect(parseBootPreferenceOutput('BootPreference\t%02')).toBe('block_power');
    expect(parseBootPreferenceOutput('BootPreference\t%99')).toBe('unknown');
  });

  it('detects support correctly', () => {
    expect(detectBootPreferenceSupport({ platform: 'linux', arch: 'arm64', macosVersion: '15.0.0' })).toEqual({
      supported: false,
      reason: '仅支持 macOS',
    });
    expect(detectBootPreferenceSupport({ platform: 'darwin', arch: 'x64', macosVersion: '15.0.0' })).toEqual({
      supported: false,
      reason: '仅支持 Apple Silicon Mac',
    });
    expect(detectBootPreferenceSupport({ platform: 'darwin', arch: 'arm64', macosVersion: '14.7.1' })).toEqual({
      supported: false,
      reason: '需要 macOS Sequoia 15 或更高版本',
    });
    expect(detectBootPreferenceSupport({ platform: 'darwin', arch: 'arm64', macosVersion: '15.1.0' })).toEqual({
      supported: true,
    });
  });

  it('maps mode to commands and labels', () => {
    expect(getBootPreferenceCommand('default')).toBe('/usr/sbin/nvram -d BootPreference');
    expect(getBootPreferenceCommand('block_all')).toBe('/usr/sbin/nvram BootPreference=%00');
    expect(getBootPreferenceCommand('block_lid')).toBe('/usr/sbin/nvram BootPreference=%01');
    expect(getBootPreferenceCommand('block_power')).toBe('/usr/sbin/nvram BootPreference=%02');
    expect(formatBootPreferenceMode('block_lid')).toBe('仅阻止开盖启动');
    expect(describeBootPreferenceMode('default')).toContain('当前未拦截');
    expect(describeBootPreferenceMode('unknown')).toContain('无法确认');
    expect(() => getBootPreferenceCommand('unknown' as BootPreferenceMode)).toThrow('不支持的 BootPreference 模式');
  });
});

describe('BootPreferenceService runtime', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-boot-pref-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    execFileMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns supported summary with current mode', async () => {
    const service = new TestBootPreferenceService(dataDir);
    service.readOutput = 'BootPreference\t%02';

    const summary = await service.getSummary();

    expect(summary.id).toBe('boot-preference');
    expect(summary.supported).toBe(true);
    expect(summary.currentMode).toBe('block_power');
    expect(summary.groupId).toBe('system-tuning');
    expect(summary.currentModeLabel).toBe('仅阻止接电启动');
    expect(summary.currentModeDescription).toContain('只阻止接电启动');
    expect(summary.checkedAt).toBeTruthy();
  });

  it('lists actions after ensuring directories and includes latest run metadata', async () => {
    const service = new TestBootPreferenceService(dataDir);
    const historyDir = path.join(dataDir, 'system-actions', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'boot-preference.json'), JSON.stringify([
      {
        runId: 'run-1',
        actionId: 'boot-preference',
        actionName: '开盖 / 接电启动',
        startedAt: '2026-05-30T00:00:00.000Z',
        status: 'succeeded',
        message: 'ok',
        targetMode: 'block_lid',
      },
    ]), 'utf-8');

    const actions = await service.listActions();

    expect(actions).toHaveLength(1);
    expect(actions[0].latestRun).toEqual(expect.objectContaining({ runId: 'run-1' }));
    expect(fs.existsSync(path.join(dataDir, 'system-actions', 'logs'))).toBe(true);
  });

  it('reports read failures as unknown mode on supported systems', async () => {
    const service = new TestBootPreferenceService(dataDir);
    service.failReadWith = new Error('nvram denied');

    const summary = await service.getSummary();

    expect(summary.supported).toBe(true);
    expect(summary.currentMode).toBe('unknown');
    expect(summary.disabledReason).toBe('nvram denied');
  });

  it('writes history and logs after apply', async () => {
    const service = new TestBootPreferenceService(dataDir);
    service.readOutput = 'BootPreference\t%01';

    const result = await service.applyMode('block_all');

    expect(result.record.status).toBe('succeeded');
    expect(service.adminCalls).toEqual(['/usr/sbin/nvram BootPreference=%00']);

    const history = await service.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].targetMode).toBe('block_all');
    expect(history[0].observedModeBefore).toBe('block_lid');
    expect(['block_lid', 'block_all', 'unknown']).toContain(history[0].observedModeAfter as BootPreferenceMode);

    const logText = await service.getLog(history[0].runId);
    expect(logText).toContain('target mode: block_all');
    expect(logText).toContain('/usr/sbin/nvram BootPreference=%00');
  });

  it('broadcasts running and terminal statuses when applying a mode', async () => {
    const broadcasts: any[] = [];
    const service = new TestBootPreferenceService(dataDir, (message) => broadcasts.push(message));

    const result = await service.applyMode('default');

    expect(result.message).toBe('已恢复默认启动行为');
    expect(result.record.targetMode).toBe('default');
    expect(broadcasts).toEqual([
      { type: 'system_action_updated', actionId: 'boot-preference', status: 'running' },
      { type: 'system_action_updated', actionId: 'boot-preference', status: 'succeeded' },
    ]);
  });

  it('records unknown before and after modes when nvram reads fail around apply', async () => {
    class FlakyReadService extends TestBootPreferenceService {
      protected async execReadCommand(_command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        throw new Error('read failed');
      }
    }
    const service = new FlakyReadService(dataDir);

    const result = await service.applyMode('block_power');

    expect(result.record.observedModeBefore).toBe('unknown');
    expect(result.record.observedModeAfter).toBe('unknown');
  });

  it('records failure when administrator action errors', async () => {
    const service = new TestBootPreferenceService(dataDir);
    service.failAdminWith = new Error('User canceled.');

    await expect(service.applyMode('default')).rejects.toThrow('User canceled.');

    const history = await service.getHistory();
    expect(history[0].status).toBe('failed');
    expect(history[0].message).toContain('User canceled.');
    const logText = await service.getLog(history[0].runId);
    expect(logText).toContain('error: User canceled.');
  });

  it('returns unsupported summary and blocks apply on unsupported systems', async () => {
    const service = new TestBootPreferenceService(dataDir);
    service.systemInfo = { platform: 'linux', arch: 'arm64' };

    const summary = await service.getSummary();

    expect(summary.supported).toBe(false);
    expect(summary.disabledReason).toBe('仅支持 macOS');
    expect(summary.currentMode).toBe('unknown');
    await expect(service.applyMode('block_lid')).rejects.toThrow('仅支持 macOS');
  });

  it('rejects invalid modes before executing administrator commands', async () => {
    const service = new TestBootPreferenceService(dataDir);

    await expect(service.applyMode('bad' as BootPreferenceMode)).rejects.toThrow('不支持的 BootPreference 模式');
    expect(service.adminCalls).toEqual([]);
  });

  it('returns empty history and fallback logs when persisted files are missing or invalid', async () => {
    const service = new TestBootPreferenceService(dataDir);

    await expect(service.getHistory()).resolves.toEqual([]);
    await expect(service.getLog('missing')).resolves.toBe('暂无日志');

    const historyDir = path.join(dataDir, 'system-actions', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'boot-preference.json'), '{bad-json', 'utf-8');
    await expect(service.getHistory()).resolves.toEqual([]);
  });

  it('returns fallback logs when a selected history entry has no readable log file', async () => {
    const service = new TestBootPreferenceService(dataDir);
    const historyDir = path.join(dataDir, 'system-actions', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'boot-preference.json'), JSON.stringify([
      {
        runId: 'run-without-log',
        actionId: 'boot-preference',
        actionName: '开盖 / 接电启动',
        startedAt: '2026-05-30T00:00:00.000Z',
        status: 'succeeded',
        message: 'ok',
      },
      {
        runId: 'run-missing-log',
        actionId: 'boot-preference',
        actionName: '开盖 / 接电启动',
        startedAt: '2026-05-30T00:01:00.000Z',
        status: 'failed',
        message: 'missing',
        logFile: path.join(dataDir, 'missing.log'),
      },
    ]), 'utf-8');

    await expect(service.getLog('run-without-log')).resolves.toBe('暂无日志');
    await expect(service.getLog('run-missing-log')).resolves.toBe('暂无日志');
  });
});

describe('BootPreferenceService command execution wrappers', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('treats missing BootPreference nvram variable as the default mode', async () => {
    mockExecFileOnce((_file, _args, callback) => {
      callback(Object.assign(new Error('missing variable'), { code: 1 }), '', 'Error getting variable - "BootPreference"');
    });
    const service = new BootPreferenceService('/tmp/hubkit-test');

    await expect(service.readCurrentMode()).resolves.toEqual({
      mode: 'default',
      message: 'Error getting variable - "BootPreference"',
    });
  });

  it('surfaces read command stderr and falls back to error messages', async () => {
    mockExecFileOnce((_file, _args, callback) => {
      callback(new Error('boom'), '', 'nvram denied');
    });
    mockExecFileOnce((_file, _args, callback) => {
      callback(new Error('boom without stderr'), '', '');
    });
    const service = new BootPreferenceService('/tmp/hubkit-test');

    await expect(service.readCurrentMode()).rejects.toThrow('nvram denied');
    await expect(service.readCurrentMode()).rejects.toThrow('boom without stderr');
  });

  it('wraps administrator osascript success and failure outputs', async () => {
    class ExecAdminService extends BootPreferenceService {
      exposeExecAdmin(command: string) {
        return this.execAdminCommand(command);
      }
    }
    const service = new ExecAdminService('/tmp/hubkit-test');
    mockExecFileOnce((_file, args, callback) => {
      expect(args).toEqual(['-e', 'do shell script "/usr/sbin/nvram -d BootPreference" with administrator privileges']);
      callback(null, 'ok', '');
    });
    mockExecFileOnce((_file, _args, callback) => {
      callback(new Error('osascript failed'), '', '');
    });
    mockExecFileOnce((_file, _args, callback) => {
      callback(new Error(''), 'stdout reason', '');
    });

    await expect(service.exposeExecAdmin('/usr/sbin/nvram -d BootPreference')).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    });
    await expect(service.exposeExecAdmin('bad')).rejects.toThrow('osascript failed');
    await expect(service.exposeExecAdmin('bad')).rejects.toThrow('stdout reason');
  });

  it('reads system info from the current platform and tolerates macOS version command failures', async () => {
    mockExecFileOnce((_file, _args, callback) => {
      callback(new Error('sw_vers failed'), '', '');
    });
    class SystemInfoService extends BootPreferenceService {
      exposeReadSystemInfo() {
        return this.readSystemInfo();
      }
    }
    const service = new SystemInfoService('/tmp/hubkit-test');

    await expect(service.exposeReadSystemInfo()).resolves.toEqual(expect.objectContaining({
      platform: process.platform,
      arch: process.arch,
    }));
  });
});

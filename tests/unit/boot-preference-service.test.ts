import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BootPreferenceService,
  detectBootPreferenceSupport,
  formatBootPreferenceMode,
  getBootPreferenceCommand,
  parseBootPreferenceOutput,
  SystemInfo,
} from '../../src/system-actions/boot-preference-service';
import { BootPreferenceMode } from '../../src/types/system-actions';

class TestBootPreferenceService extends BootPreferenceService {
  systemInfo: SystemInfo = { platform: 'darwin', arch: 'arm64', macosVersion: '15.0.1' };
  readOutput = 'BootPreference\t%01';
  adminCalls: string[] = [];
  failAdminWith: Error | null = null;

  protected async readSystemInfo(): Promise<SystemInfo> {
    return this.systemInfo;
  }

  protected async execReadCommand(_command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  });
});

describe('BootPreferenceService runtime', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-boot-pref-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
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
});

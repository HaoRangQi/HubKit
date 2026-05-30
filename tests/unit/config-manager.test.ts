import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager, CURRENT_CONFIG_VERSION } from '../../src/config/config';

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof fs>('fs');
  return {
    ...actual,
    copyFileSync: jest.fn(actual.copyFileSync),
    renameSync: jest.fn(actual.renameSync),
    unlinkSync: jest.fn(actual.unlinkSync),
    writeFileSync: jest.fn(actual.writeFileSync),
  };
});

const actualFs = jest.requireActual<typeof fs>('fs');
const copyFileSyncMock = fs.copyFileSync as jest.MockedFunction<typeof fs.copyFileSync>;
const renameSyncMock = fs.renameSync as jest.MockedFunction<typeof fs.renameSync>;
const unlinkSyncMock = fs.unlinkSync as jest.MockedFunction<typeof fs.unlinkSync>;
const writeFileSyncMock = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

function createTempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-config-test-'));
  return path.join(dir, 'config.json');
}

function createConfig(moduleDirs: string[], overrides: Record<string, unknown> = {}) {
  return {
    configVersion: CURRENT_CONFIG_VERSION,
    moduleDirs,
    dataDir: '/tmp/data',
    logDir: '/tmp/logs',
    settings: {
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: {},
      startPolicies: {},
      groupStartPolicyTemplates: {},
      ...overrides,
    },
  };
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

describe('ConfigManager', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    copyFileSyncMock.mockImplementation(actualFs.copyFileSync);
    renameSyncMock.mockImplementation(actualFs.renameSync);
    unlinkSyncMock.mockImplementation(actualFs.unlinkSync);
    writeFileSyncMock.mockImplementation(actualFs.writeFileSync);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('normalizes legacy config files to the current schema version', () => {
    const configPath = createTempConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({
      moduleDirs: ['/tmp/modules'],
      dataDir: '/tmp/data',
      logDir: '/tmp/logs',
      settings: {
        autoStart: { alpha: true },
      },
    }), 'utf-8');

    const manager = new ConfigManager(configPath);
    const loaded = manager.get();

    expect(loaded.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(loaded.moduleDirs).toEqual(['/tmp/modules']);
    expect(loaded.settings.autoStart).toEqual({ alpha: true });
    expect(loaded.settings.startOrder).toEqual([]);
    expect(loaded.settings.groups).toEqual([{ id: 'default', name: '默认分组' }]);
  });

  it('falls back to defaults when the config file cannot be parsed', () => {
    const configPath = createTempConfigPath();
    fs.writeFileSync(configPath, '{bad-json', 'utf-8');

    const manager = new ConfigManager(configPath);
    const loaded = manager.get();

    expect(loaded.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(loaded.moduleDirs[0]).toContain('.hubkit');
    expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to load config, using defaults:', expect.any(Error));
  });

  it('normalizes malformed root values and missing settings to safe defaults', () => {
    const configPath = createTempConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({
      configVersion: 'old',
      moduleDirs: 'bad',
      dataDir: 123,
      logDir: false,
      settings: null,
    }), 'utf-8');

    const manager = new ConfigManager(configPath);
    const loaded = manager.get();

    expect(loaded.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(Array.isArray(loaded.moduleDirs)).toBe(true);
    expect(typeof loaded.dataDir).toBe('string');
    expect(typeof loaded.logDir).toBe('string');
    expect(loaded.settings.groups).toEqual([{ id: 'default', name: '默认分组' }]);
  });

  it('writes config atomically and backs up the previous config', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/before']));

    const manager = new ConfigManager(configPath);
    manager.addModuleDir('/after');

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const backupDir = path.join(path.dirname(configPath), 'backups');
    const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith('.json'));

    expect(saved.configVersion).toBe(CURRENT_CONFIG_VERSION);
    expect(saved.moduleDirs).toEqual(['/before', '/after']);
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, backups[0]), 'utf-8'));
    expect(backup.moduleDirs).toEqual(['/before']);
  });

  it('saves a new config without creating a backup when no config file exists yet', () => {
    const configPath = createTempConfigPath();
    fs.rmSync(configPath, { force: true });

    const manager = new ConfigManager(configPath);
    manager.addModuleDir('/first');

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(saved.moduleDirs).toContain('/first');
    expect(copyFileSyncMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(path.dirname(configPath), 'backups'))).toBe(false);
  });

  it('throws when backing up the existing config fails', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/before']));
    const backupError = new Error('backup failed');
    copyFileSyncMock.mockImplementation(() => {
      throw backupError;
    });

    const manager = new ConfigManager(configPath);

    expect(() => manager.addModuleDir('/after')).toThrow(backupError);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).moduleDirs).toEqual(['/before']);
  });

  it('throws when writing the temporary config fails', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/before']));
    const writeError = new Error('write failed');
    writeFileSyncMock.mockImplementation((targetPath: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      if (String(targetPath).includes('.config.')) {
        throw writeError;
      }
      return actualFs.writeFileSync(targetPath, data, options);
    });

    const manager = new ConfigManager(configPath);

    expect(() => manager.addModuleDir('/after')).toThrow(writeError);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).moduleDirs).toEqual(['/before']);
  });

  it('throws when renaming the temporary config into place fails and removes the temp file', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/before']));
    const renameError = new Error('rename failed');
    renameSyncMock.mockImplementation(() => {
      throw renameError;
    });

    const manager = new ConfigManager(configPath);

    expect(() => manager.addModuleDir('/after')).toThrow(renameError);
    expect(unlinkSyncMock).toHaveBeenCalledWith(expect.stringContaining('.config.'));
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).moduleDirs).toEqual(['/before']);
  });

  it('throws the cleanup error when removing a failed temporary config also fails', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/before']));
    const renameError = new Error('rename failed');
    const cleanupError = new Error('cleanup failed');
    renameSyncMock.mockImplementation(() => {
      throw renameError;
    });
    unlinkSyncMock.mockImplementation(() => {
      throw cleanupError;
    });

    const manager = new ConfigManager(configPath);

    expect(() => manager.addModuleDir('/after')).toThrow(cleanupError);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).moduleDirs).toEqual(['/before']);
  });

  it('returns defensive copies of config and settings', () => {
    const configPath = createTempConfigPath();
    const manager = new ConfigManager(configPath);

    const loaded = manager.get();
    loaded.moduleDirs.push('/mutated');
    loaded.settings.groups.push({ id: 'mutated', name: 'Mutated' });

    const settings = manager.getSettings();
    settings.autoStart.alpha = true;

    expect(manager.getModuleDirs()).not.toContain('/mutated');
    expect(manager.getSettings().groups).toEqual([{ id: 'default', name: '默认分组' }]);
    expect(manager.getSettings().autoStart).toEqual({});
  });

  it('removes module directories, updates web urls/settings, and creates missing directories', () => {
    const configPath = createTempConfigPath();
    const root = path.dirname(configPath);
    const moduleDir = path.join(root, 'modules');
    const keepDir = path.join(root, 'keep');
    const dataDir = path.join(root, 'data');
    const logDir = path.join(root, 'logs');
    writeJson(configPath, {
      ...createConfig([moduleDir, keepDir], {
      moduleWebUrls: { alpha: 'http://old.local' },
      visibility: { alpha: false },
      workspaceHistoryLimit: 5,
      }),
      dataDir,
      logDir,
    });

    const manager = new ConfigManager(configPath);
    manager.removeModuleDir(moduleDir);
    manager.removeModuleDir(path.join(root, 'not-present'));
    manager.setModuleWebUrl('alpha', 'http://new.local');
    manager.updateSettings({ visibility: { alpha: true }, workspaceHistoryLimit: 0 });
    manager.ensureDirs();

    expect(manager.getModuleDirs()).toEqual([keepDir]);
    expect(manager.getModuleWebUrl('alpha')).toBe('http://new.local');
    expect(manager.getModuleWebUrl('missing', 'http://fallback.local')).toBe('http://fallback.local');
    expect(manager.getSettings().visibility).toEqual({ alpha: true });
    expect(manager.getSettings().workspaceHistoryLimit).toBe(0);
    expect(fs.existsSync(keepDir)).toBe(true);
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.existsSync(logDir)).toBe(true);
  });

  it('normalizes workspace orchestration settings', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/modules'], {
      workspaces: [
        {
          id: ' dev ',
          name: ' Development ',
          description: 'Local dev stack',
          moduleIds: ['api', 'web', 'api', ''],
          startOrder: ['web', 'api', 'web'],
          stopOrder: ['api', 'web'],
          failurePolicy: 'continue',
        },
        {
          id: '',
          name: 'Invalid',
          moduleIds: ['ignored'],
        },
        {
          id: 'dev',
          name: 'Duplicate',
          moduleIds: ['ignored'],
        },
      ],
    }));

    const manager = new ConfigManager(configPath);
    const settings = manager.getSettings();

    expect(settings.workspaces).toEqual([
      {
        id: 'dev',
        name: 'Development',
        description: 'Local dev stack',
        moduleIds: ['api', 'web'],
        startOrder: ['web', 'api'],
        stopOrder: ['api', 'web'],
        failurePolicy: 'continue',
      },
    ]);

    settings.workspaces[0].moduleIds.push('mutated');
    expect(manager.getSettings().workspaces[0].moduleIds).toEqual(['api', 'web']);
  });

  it('normalizes workspace run history settings', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/modules'], {
      workspaceHistoryLimit: 2,
      workspaceHistory: [
        {
          workspaceId: ' dev ',
          action: 'stop',
          success: false,
          startedAt: '2026-05-24T10:00:00.000Z',
          finishedAt: '2026-05-24T10:00:01.000Z',
          failureSummary: ' api failed ',
        },
        {
          workspaceId: 'ops',
          action: 'restart',
          success: true,
          startedAt: '2026-05-24T09:00:00.000Z',
          finishedAt: '2026-05-24T09:00:01.000Z',
        },
        {
          workspaceId: '',
          action: 'start',
          success: true,
          startedAt: '2026-05-24T08:00:00.000Z',
          finishedAt: '2026-05-24T08:00:01.000Z',
        },
      ],
    }));

    const manager = new ConfigManager(configPath);
    const settings = manager.getSettings();

    expect(settings.workspaceHistoryLimit).toBe(2);
    expect(settings.workspaceHistory).toEqual([
      {
        workspaceId: 'dev',
        action: 'stop',
        success: false,
        startedAt: '2026-05-24T10:00:00.000Z',
        finishedAt: '2026-05-24T10:00:01.000Z',
        failureSummary: 'api failed',
      },
      {
        workspaceId: 'ops',
        action: 'start',
        success: true,
        startedAt: '2026-05-24T09:00:00.000Z',
        finishedAt: '2026-05-24T09:00:01.000Z',
        failureSummary: undefined,
      },
    ]);

    settings.workspaceHistory.push({
      workspaceId: 'mutated',
      action: 'start',
      success: true,
      startedAt: '2026-05-24T11:00:00.000Z',
      finishedAt: '2026-05-24T11:00:01.000Z',
    });
    expect(manager.getSettings().workspaceHistory.map((entry) => entry.workspaceId)).toEqual(['dev', 'ops']);
  });

  it('records workspace run history newest first and respects the configured limit', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/modules'], {
      workspaceHistoryLimit: 2,
      workspaceHistory: [
        {
          workspaceId: 'older',
          action: 'start',
          success: true,
          startedAt: '2026-05-24T08:00:00.000Z',
          finishedAt: '2026-05-24T08:00:01.000Z',
        },
      ],
    }));

    const manager = new ConfigManager(configPath);
    manager.recordWorkspaceHistory({
      workspaceId: 'first',
      action: 'start',
      success: true,
      startedAt: '2026-05-24T09:00:00.000Z',
      finishedAt: '2026-05-24T09:00:01.000Z',
    });
    manager.recordWorkspaceHistory({
      workspaceId: 'second',
      action: 'stop',
      success: false,
      startedAt: '2026-05-24T10:00:00.000Z',
      finishedAt: '2026-05-24T10:00:01.000Z',
      failureSummary: 'api failed',
    });

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(saved.settings.workspaceHistory.map((entry: { workspaceId: string }) => entry.workspaceId))
      .toEqual(['second', 'first']);
    expect(saved.settings.workspaceHistory[0]).toEqual(expect.objectContaining({
      workspaceId: 'second',
      action: 'stop',
      success: false,
      failureSummary: 'api failed',
    }));
  });

  it('skips invalid workspace history entries and respects a zero history limit', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/modules'], {
      workspaceHistoryLimit: 0,
      workspaceHistory: [
        {
          workspaceId: 'existing',
          action: 'start',
          success: true,
          startedAt: '2026-05-24T08:00:00.000Z',
          finishedAt: '2026-05-24T08:00:01.000Z',
        },
      ],
    }));

    const manager = new ConfigManager(configPath);
    manager.recordWorkspaceHistory({
      workspaceId: 'new',
      action: 'start',
      success: true,
      startedAt: '2026-05-24T09:00:00.000Z',
      finishedAt: '2026-05-24T09:00:01.000Z',
    });
    manager.recordWorkspaceHistory({
      workspaceId: '',
      action: 'start',
      success: true,
      startedAt: '2026-05-24T10:00:00.000Z',
      finishedAt: '2026-05-24T10:00:01.000Z',
    });

    expect(manager.getSettings().workspaceHistory).toEqual([]);
    expect(manager.getSettings().workspaceHistoryLimit).toBe(0);
  });

  it('lists backup summaries with config counts', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current']));
    const backupDir = path.join(path.dirname(configPath), 'backups');
    const older = path.join(backupDir, 'config-2026-05-24T10-00-00-000Z.json');
    const newer = path.join(backupDir, 'config-2026-05-24T11-00-00-000Z.json');

    writeJson(older, createConfig(['/older'], {
      autoStart: { alpha: true },
      schedules: { alpha: { enabled: true, startTime: '09:00' } },
      groups: [
        { id: 'default', name: '默认分组' },
        { id: 'work', name: '工作区' },
      ],
    }));
    writeJson(newer, createConfig(['/newer-a', '/newer-b'], {
      autoStart: { alpha: true, beta: false },
    }));
    fs.utimesSync(older, new Date('2026-05-24T10:00:00.000Z'), new Date('2026-05-24T10:00:00.000Z'));
    fs.utimesSync(newer, new Date('2026-05-24T11:00:00.000Z'), new Date('2026-05-24T11:00:00.000Z'));

    const manager = new ConfigManager(configPath);
    const backups = manager.listBackups(10);

    expect(backups.map((item) => item.id)).toEqual([
      'config-2026-05-24T11-00-00-000Z.json',
      'config-2026-05-24T10-00-00-000Z.json',
    ]);
    expect(backups[0]).toEqual(expect.objectContaining({
      moduleDirCount: 2,
      groupCount: 1,
      autoStartCount: 2,
      scheduleCount: 0,
    }));
    expect(backups[1]).toEqual(expect.objectContaining({
      moduleDirCount: 1,
      groupCount: 2,
      autoStartCount: 1,
      scheduleCount: 1,
    }));

    expect(manager.listBackups(-10)).toEqual([]);
    expect(manager.listBackups(1).map((item) => item.id)).toEqual(['config-2026-05-24T11-00-00-000Z.json']);
  });

  it('summarizes invalid backup files safely and ignores invalid backup names', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current']));
    const backupDir = path.join(path.dirname(configPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const badBackup = path.join(backupDir, 'config-2026-05-24T14-00-00-000Z.json');
    fs.writeFileSync(badBackup, '{bad-json', 'utf-8');
    fs.writeFileSync(path.join(backupDir, 'not-a-backup.json'), '{}', 'utf-8');

    const manager = new ConfigManager(configPath);
    const backups = manager.listBackups(20);

    expect(backups).toHaveLength(1);
    expect(backups[0]).toEqual(expect.objectContaining({
      id: 'config-2026-05-24T14-00-00-000Z.json',
      moduleDirCount: 0,
      groupCount: 0,
      autoStartCount: 0,
      scheduleCount: 0,
    }));
  });

  it('restores a selected backup and backs up the current config first', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current'], {
      autoStart: { current: true },
    }));

    const backupDir = path.join(path.dirname(configPath), 'backups');
    const backupId = 'config-2026-05-24T12-00-00-000Z.json';
    writeJson(path.join(backupDir, backupId), createConfig(['/restored'], {
      autoStart: { restored: true },
    }));

    const manager = new ConfigManager(configPath);
    const restored = manager.restoreBackup(backupId);

    expect(restored.moduleDirs).toEqual(['/restored']);
    expect(restored.settings.autoStart).toEqual({ restored: true });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).moduleDirs).toEqual(['/restored']);

    const backupFiles = fs.readdirSync(backupDir).filter((name) => name.endsWith('.json'));
    const currentBackup = backupFiles
      .filter((name) => name !== backupId)
      .map((name) => JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf-8')))
      .find((item) => Array.isArray(item.moduleDirs) && item.moduleDirs.includes('/current'));

    expect(currentBackup).toBeDefined();
  });

  it('creates suffixed backups when the timestamp base name already exists', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current']));
    const backupDir = path.join(path.dirname(configPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-24T15:00:00.000Z');
    const baseBackup = path.join(backupDir, 'config-2026-05-24T15-00-00-000Z.json');
    fs.writeFileSync(baseBackup, '{}', 'utf-8');

    try {
      const manager = new ConfigManager(configPath);
      manager.addModuleDir('/after');

      expect(fs.existsSync(path.join(backupDir, 'config-2026-05-24T15-00-00-000Z-1.json'))).toBe(true);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('throws when every suffixed backup path is already occupied', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current']));
    const backupDir = path.join(path.dirname(configPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const dateSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-24T16:00:00.000Z');
    fs.writeFileSync(path.join(backupDir, 'config-2026-05-24T16-00-00-000Z.json'), '{}', 'utf-8');
    for (let index = 1; index <= 1000; index += 1) {
      fs.writeFileSync(path.join(backupDir, `config-2026-05-24T16-00-00-000Z-${index}.json`), '{}', 'utf-8');
    }

    try {
      const manager = new ConfigManager(configPath);

      expect(() => manager.addModuleDir('/after')).toThrow('无法创建配置备份文件');
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('previews restore impact before applying a backup', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current', '/shared'], {
      autoStart: { alpha: true, beta: true },
      startOrder: ['alpha', 'beta'],
      schedules: {
        alpha: { enabled: true, startTime: '09:00' },
        beta: { enabled: true, stopTime: '18:00' },
      },
      groups: [
        { id: 'default', name: '默认分组' },
        { id: 'old', name: '旧分组' },
        { id: 'shared', name: '旧名称' },
      ],
      moduleGroups: { alpha: 'old' },
      startPolicies: { alpha: { retryCount: 1 } },
      moduleWebUrls: { alpha: 'http://localhost:3000' },
      visibility: { beta: false },
    }));

    const backupDir = path.join(path.dirname(configPath), 'backups');
    const backupId = 'config-2026-05-24T13-00-00-000Z.json';
    writeJson(path.join(backupDir, backupId), createConfig(['/restored', '/shared'], {
      autoStart: { alpha: false, gamma: true },
      startOrder: ['gamma', 'alpha'],
      schedules: {
        alpha: { enabled: true, startTime: '10:00' },
        gamma: { enabled: true, startTime: '08:00' },
      },
      groups: [
        { id: 'default', name: '默认分组' },
        { id: 'new', name: '新分组' },
        { id: 'shared', name: '新名称' },
      ],
      moduleGroups: { alpha: 'new', gamma: 'new' },
      startPolicies: { gamma: { retryCount: 2 } },
      moduleWebUrls: { gamma: 'http://localhost:4000' },
      visibility: { gamma: true },
    }));

    const manager = new ConfigManager(configPath);
    const preview = manager.previewRestoreBackup(backupId);

    expect(preview.backup.id).toBe(backupId);
    expect(preview.moduleDirs).toEqual({ added: ['/restored'], removed: ['/current'] });
    expect(preview.groups.added).toEqual([{ id: 'new', name: '新分组' }]);
    expect(preview.groups.removed).toEqual([{ id: 'old', name: '旧分组' }]);
    expect(preview.groups.renamed).toEqual([{ id: 'shared', from: '旧名称', to: '新名称' }]);
    expect(preview.autoStart.enabled).toEqual(['gamma']);
    expect(preview.autoStart.disabled).toEqual(['alpha', 'beta']);
    expect(preview.schedules.added).toEqual(['gamma']);
    expect(preview.schedules.removed).toEqual(['beta']);
    expect(preview.schedules.changed).toEqual(['alpha']);
    expect(preview.startOrderChanged).toBe(true);
    expect(preview.moduleGroupChanges).toEqual(['alpha', 'gamma']);
    expect(preview.startPolicyChanges).toEqual(['alpha', 'gamma']);
    expect(preview.webUrlChanges).toEqual(['alpha', 'gamma']);
    expect(preview.visibilityChanges).toEqual(['beta', 'gamma']);
    expect(preview.changedAreas).toEqual([
      '模块目录',
      '工作区分组',
      '自启与顺序',
      '定时任务',
      '模块分组归属',
      '启动策略',
      'Web 入口',
      '卡片显示',
    ]);
    expect(preview.totals).toEqual({ added: 4, removed: 5, changed: 11 });
  });

  it('previews an unchanged restore without changed areas or totals', () => {
    const configPath = createTempConfigPath();
    const unchangedConfig = createConfig(['/same'], {
      autoStart: { alpha: true },
      startOrder: ['alpha'],
      schedules: { alpha: { enabled: true, startTime: '09:00' } },
      moduleGroups: { alpha: 'default' },
      startPolicies: { alpha: { retryCount: 1 } },
      moduleWebUrls: { alpha: 'http://localhost:3000' },
      visibility: { alpha: true },
      workspaces: [
        {
          id: 'dev',
          name: 'Dev',
          moduleIds: ['alpha'],
        },
      ],
    });
    writeJson(configPath, unchangedConfig);
    const backupDir = path.join(path.dirname(configPath), 'backups');
    const backupId = 'config-2026-05-24T17-00-00-000Z.json';
    writeJson(path.join(backupDir, backupId), unchangedConfig);

    const manager = new ConfigManager(configPath);
    const preview = manager.previewRestoreBackup(backupId);

    expect(preview.changedAreas).toEqual([]);
    expect(preview.totals).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(preview.startOrderChanged).toBe(false);
    expect(preview.workspaceChanges).toEqual([]);
  });

  it('rejects invalid or missing backup ids', () => {
    const configPath = createTempConfigPath();
    writeJson(configPath, createConfig(['/current']));
    const manager = new ConfigManager(configPath);

    expect(() => manager.restoreBackup('../config-2026-05-24T12-00-00-000Z.json')).toThrow('无效的配置备份 ID');
    expect(() => manager.restoreBackup('config-2026-05-24T12-00-00-000Z.json')).toThrow('配置备份不存在');
  });
});

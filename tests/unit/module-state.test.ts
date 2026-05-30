import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleStateManager } from '../../src/registry/module-state';
import { ModuleMetadata } from '../../src/types/module';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-module-state-'));
}

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('ModuleStateManager', () => {
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('defaults modules to enabled when no persisted state exists', () => {
    const manager = new ModuleStateManager(createTempDir());

    expect(manager.isEnabled('demo')).toBe(true);
    expect(manager.applyState(createModule({ enabled: false }))).toEqual(expect.objectContaining({
      id: 'demo',
      enabled: true,
    }));
  });

  it('persists disabled state and reloads it from disk', () => {
    const dataDir = createTempDir();
    const manager = new ModuleStateManager(dataDir);

    manager.setEnabled('demo', false);
    const reloaded = new ModuleStateManager(dataDir);

    expect(reloaded.isEnabled('demo')).toBe(false);
    expect(reloaded.applyState(createModule())).toEqual(expect.objectContaining({ enabled: false }));
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'module-states.json'), 'utf-8'))).toEqual({
      demo: { enabled: false },
    });
  });

  it('keeps running with default state when persisted JSON is invalid', () => {
    const dataDir = createTempDir();
    fs.writeFileSync(path.join(dataDir, 'module-states.json'), '{not-json', 'utf-8');

    const manager = new ModuleStateManager(dataDir);

    expect(manager.isEnabled('demo')).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});

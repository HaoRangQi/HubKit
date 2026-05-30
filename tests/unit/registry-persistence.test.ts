import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleRegistryPersistence } from '../../src/registry/registry-persistence';
import { ModuleMetadata } from '../../src/types/module';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-registry-persistence-'));
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

describe('ModuleRegistryPersistence', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('saves and loads registry modules', () => {
    const dataDir = createTempDir();
    const persistence = new ModuleRegistryPersistence(dataDir);
    const modules = [
      createModule(),
      createModule({ id: 'worker', name: 'Worker', type: 'nodejs', scriptPath: '/tmp/worker.js' }),
    ];

    persistence.save(modules);

    expect(persistence.exists()).toBe(true);
    expect(persistence.load()).toEqual(modules);
  });

  it('returns an empty registry when the file is missing or invalid', () => {
    const dataDir = createTempDir();
    const persistence = new ModuleRegistryPersistence(dataDir);

    expect(persistence.exists()).toBe(false);
    expect(persistence.load()).toEqual([]);

    fs.writeFileSync(path.join(dataDir, 'module-registry.json'), '{not-json', 'utf-8');
    expect(persistence.exists()).toBe(true);
    expect(persistence.load()).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});

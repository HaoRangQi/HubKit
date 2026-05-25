import { Command } from 'commander';
import { registerListCommand } from '../../src/cli/commands/list';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';

function createProgram(): Command {
  const program = new Command();
  program.name('hub');
  program.exitOverride();
  program.configureOutput({
    writeOut: jest.fn(),
    writeErr: jest.fn(),
  });
  return program;
}

function moduleMetadata(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'api',
    name: 'API',
    type: 'nodejs',
    scriptPath: '/modules/api/index.js',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('list command', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('loads modules through the injected scanner before listing', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });

    registerListCommand(program, registry, { scanAndRegister });

    await program.parseAsync(['node', 'hub', 'list'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(logSpy.mock.calls[0][0]).toContain('找到 1 个模块');
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('API (api)'))).toBe(true);
  });

  it('applies existing list filters after loading modules', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();

    registerListCommand(program, registry, {
      scanAndRegister: jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
        activeRegistry.register(moduleMetadata({ id: 'api', type: 'nodejs', enabled: true }));
        activeRegistry.register(moduleMetadata({ id: 'worker', name: 'Worker', type: 'shell', enabled: false }));
      }),
    });

    await program.parseAsync(['node', 'hub', 'list', '--enabled', '--type', 'nodejs'], { from: 'node' });

    expect(logSpy.mock.calls.some(([message]) => String(message).includes('API (api)'))).toBe(true);
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Worker (worker)'))).toBe(false);
  });
});

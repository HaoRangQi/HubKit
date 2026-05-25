import { Command } from 'commander';
import { registerStatusCommand } from '../../src/cli/commands/status';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata, ModuleStatus } from '../../src/types/module';

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
    type: 'shell',
    scriptPath: '/modules/api/run.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('status command', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('loads modules through the injected scanner before listing status', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.STOPPED }),
    };

    registerStatusCommand(program, registry, { scanAndRegister, lifecycle });

    await program.parseAsync(['node', 'hub', 'status'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(lifecycle.status).toHaveBeenCalledWith(registry.get('api'));
    expect(logSpy.mock.calls[0][0]).toContain('共 1 个模块');
  });
});

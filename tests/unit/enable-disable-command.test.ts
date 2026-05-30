import { Command } from 'commander';
import { registerDisableCommand, registerEnableCommand } from '../../src/cli/commands/enable-disable';
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

describe('enable/disable commands', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('enables an existing module through the state manager', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const stateManager = { setEnabled: jest.fn() };
    registry.register(createModule());

    registerEnableCommand(program, registry, stateManager as any);

    await program.parseAsync(['node', 'hub', 'enable', 'demo'], { from: 'node' });

    expect(stateManager.setEnabled).toHaveBeenCalledWith('demo', true);
    expect(logSpy).toHaveBeenCalledWith('已启用模块: Demo (demo)');
  });

  it('disables an existing module through the state manager', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const stateManager = { setEnabled: jest.fn() };
    registry.register(createModule());

    registerDisableCommand(program, registry, stateManager as any);

    await program.parseAsync(['node', 'hub', 'disable', 'demo'], { from: 'node' });

    expect(stateManager.setEnabled).toHaveBeenCalledWith('demo', false);
    expect(logSpy).toHaveBeenCalledWith('已禁用模块: Demo (demo)');
  });

  it('exits when enabling a missing module', async () => {
    const program = createProgram();
    const stateManager = { setEnabled: jest.fn() };
    registerEnableCommand(program, new ModuleRegistry(), stateManager as any);

    await expect(program.parseAsync(['node', 'hub', 'enable', 'missing'], { from: 'node' }))
      .rejects.toThrow('process.exit');

    expect(errorSpy).toHaveBeenCalledWith('模块不存在: missing');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stateManager.setEnabled).not.toHaveBeenCalled();
  });

  it('exits when the state manager fails while disabling a module', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const error = new Error('write failed');
    const stateManager = {
      setEnabled: jest.fn(() => {
        throw error;
      }),
    };
    registry.register(createModule());
    registerDisableCommand(program, registry, stateManager as any);

    await expect(program.parseAsync(['node', 'hub', 'disable', 'demo'], { from: 'node' }))
      .rejects.toThrow('process.exit');

    expect(errorSpy).toHaveBeenCalledWith('禁用模块失败:', error);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

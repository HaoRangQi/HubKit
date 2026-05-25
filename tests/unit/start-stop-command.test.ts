import { Command } from 'commander';
import {
  formatTroubleshootingHints,
  registerRestartCommand,
  registerStartCommand,
  registerStopCommand,
} from '../../src/cli/commands/start-stop';
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
    type: 'shell',
    scriptPath: '/modules/api/run.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('start/stop command loading', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('formats actionable troubleshooting hints for failed lifecycle operations', () => {
    expect(formatTroubleshootingHints('api')).toContain('hub audit api');
    expect(formatTroubleshootingHints('api')).toContain('hub logs api --lines 100');
    expect(formatTroubleshootingHints('api')).toContain('hub log-search --query api --level error');
  });

  it('loads modules through the injected scanner before start lookup', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn().mockResolvedValue({ success: true, preparation: null, runtimeState: { phase: 'running' } }),
      stop: jest.fn(),
      restart: jest.fn(),
    };

    registerStartCommand(program, registry, { scanAndRegister, lifecycle });

    await program.parseAsync(['node', 'hub', 'start', 'api'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(lifecycle.start).toHaveBeenCalledWith(registry.get('api'));
    expect(logSpy.mock.calls[0][0]).toContain('已启动模块: API (api)');
  });

  it('loads modules through the injected scanner before stop lookup', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn(),
      stop: jest.fn().mockResolvedValue({ success: true, runtimeState: { phase: 'stopped' } }),
      restart: jest.fn(),
    };

    registerStopCommand(program, registry, { scanAndRegister, lifecycle });

    await program.parseAsync(['node', 'hub', 'stop', 'api', '--force'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(lifecycle.stop).toHaveBeenCalledWith(registry.get('api'), true);
    expect(logSpy.mock.calls[0][0]).toContain('已停止模块: API (api)');
  });

  it('loads modules through the injected scanner before restart lookup', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn(),
      stop: jest.fn(),
      restart: jest.fn().mockResolvedValue({ success: true, preparation: null, runtimeState: { phase: 'running' } }),
    };

    registerRestartCommand(program, registry, { scanAndRegister, lifecycle });

    await program.parseAsync(['node', 'hub', 'restart', 'api'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(lifecycle.restart).toHaveBeenCalledWith(registry.get('api'));
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('已重启模块: API (api)'))).toBe(true);
  });

  it('prints troubleshooting hints when start returns failure', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn().mockResolvedValue({ success: false, preparation: null, runtimeState: { phase: 'failed' } }),
      stop: jest.fn(),
      restart: jest.fn(),
    };

    registerStartCommand(program, registry, { scanAndRegister, lifecycle });

    await expect(program.parseAsync(['node', 'hub', 'start', 'api'], { from: 'node' })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('启动失败: API'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub audit api'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub logs api --lines 100'))).toBe(true);
  });

  it('prints troubleshooting hints when start throws after module lookup', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn().mockRejectedValue(new Error('boom')),
      stop: jest.fn(),
      restart: jest.fn(),
    };

    registerStartCommand(program, registry, { scanAndRegister, lifecycle });

    await expect(program.parseAsync(['node', 'hub', 'start', 'api'], { from: 'node' })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('启动模块失败:'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub audit api'))).toBe(true);
  });

  it('prints troubleshooting hints when stop returns failure', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn(),
      stop: jest.fn().mockResolvedValue({ success: false, runtimeState: { phase: 'running' } }),
      restart: jest.fn(),
    };

    registerStopCommand(program, registry, { scanAndRegister, lifecycle });

    await expect(program.parseAsync(['node', 'hub', 'stop', 'api'], { from: 'node' })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('停止失败: API'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub audit api'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub log-search --query api --level error'))).toBe(true);
  });

  it('prints troubleshooting hints when stop throws after module lookup', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn(),
      stop: jest.fn().mockRejectedValue(new Error('boom')),
      restart: jest.fn(),
    };

    registerStopCommand(program, registry, { scanAndRegister, lifecycle });

    await expect(program.parseAsync(['node', 'hub', 'stop', 'api'], { from: 'node' })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('停止模块失败:'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub audit api'))).toBe(true);
  });

  it('prints troubleshooting hints when restart returns failure', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn(),
      stop: jest.fn(),
      restart: jest.fn().mockResolvedValue({ success: false, preparation: null, runtimeState: { phase: 'failed' } }),
    };

    registerRestartCommand(program, registry, { scanAndRegister, lifecycle });

    await expect(program.parseAsync(['node', 'hub', 'restart', 'api'], { from: 'node' })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('重启失败: API'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub audit api'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub logs api --lines 100'))).toBe(true);
  });

  it('prints troubleshooting hints when restart throws after module lookup', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const lifecycle = {
      start: jest.fn(),
      stop: jest.fn(),
      restart: jest.fn().mockRejectedValue(new Error('boom')),
    };

    registerRestartCommand(program, registry, { scanAndRegister, lifecycle });

    await expect(program.parseAsync(['node', 'hub', 'restart', 'api'], { from: 'node' })).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('重启模块失败:'))).toBe(true);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('hub audit api'))).toBe(true);
  });
});

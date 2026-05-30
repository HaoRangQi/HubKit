import { HealthCheckManager } from '../../src/health/health-check';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleStatus } from '../../src/types/module';

function createRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register({
    id: 'demo',
    name: 'Demo',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: false,
    enabled: true,
  });
  registry.register({
    id: 'disabled',
    name: 'Disabled',
    type: 'shell',
    scriptPath: '/tmp/disabled.sh',
    autoStart: false,
    enabled: false,
  });
  return registry;
}

describe('HealthCheckManager', () => {
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('reports unknown and unhealthy for missing modules', async () => {
    const manager = new HealthCheckManager(createRegistry(), { isRunning: jest.fn() } as any);

    const result = await manager.checkModule('missing');

    expect(result).toEqual({
      moduleId: 'missing',
      healthy: false,
      status: ModuleStatus.UNKNOWN,
      message: 'Module not found',
      checkedAt: expect.any(Date),
    });
  });

  it('reports enabled modules as unhealthy when their process is stopped', async () => {
    const processManager = { isRunning: jest.fn().mockReturnValue(false) };
    const manager = new HealthCheckManager(createRegistry(), processManager as any);

    const result = await manager.checkModule('demo');

    expect(result).toEqual({
      moduleId: 'demo',
      healthy: false,
      status: ModuleStatus.STOPPED,
      message: 'Module should be running but is stopped',
      checkedAt: expect.any(Date),
    });
  });

  it('reports running modules as healthy', async () => {
    const processManager = { isRunning: jest.fn().mockReturnValue(true) };
    const manager = new HealthCheckManager(createRegistry(), processManager as any);

    const result = await manager.checkModule('demo');

    expect(result.healthy).toBe(true);
    expect(result.status).toBe(ModuleStatus.RUNNING);
    expect(result.message).toBeUndefined();
  });

  it('reports process manager errors as health check failures', async () => {
    const processManager = {
      isRunning: jest.fn(() => {
        throw new Error('pid probe failed');
      }),
    };
    const manager = new HealthCheckManager(createRegistry(), processManager as any);

    const result = await manager.checkModule('demo');

    expect(result.healthy).toBe(false);
    expect(result.status).toBe(ModuleStatus.ERROR);
    expect(result.message).toBe('pid probe failed');
  });

  it('starts periodic checks, stores results, and stops the interval', async () => {
    jest.useFakeTimers();
    const processManager = { isRunning: jest.fn().mockReturnValue(false) };
    const manager = new HealthCheckManager(createRegistry(), processManager as any, 1000);

    manager.start();
    await Promise.resolve();

    expect(manager.getResult('demo')).toEqual(expect.objectContaining({
      moduleId: 'demo',
      healthy: false,
    }));
    expect(manager.getAllResults()).toHaveLength(1);
    expect(manager.getUnhealthyModules()).toHaveLength(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Health check failed for demo: Module should be running but is stopped'
    );

    manager.stop();
    jest.advanceTimersByTime(1000);

    expect(processManager.isRunning).toHaveBeenCalledTimes(1);
  });
});

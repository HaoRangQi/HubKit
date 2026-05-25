import { ModuleLifecycle, ModuleAdapterFactory } from '../../src/runtime/module-lifecycle';
import {
  ModuleHealthReport,
  ModuleMetadata,
  ModuleProtocol,
  ModuleRuntimeState,
  ModuleStartReadiness,
  ModuleStatus,
  ModuleStatusInfo,
} from '../../src/types/module';

const moduleMeta: ModuleMetadata = {
  id: 'demo',
  name: 'Demo Module',
  type: 'shell',
  scriptPath: '/tmp/demo.sh',
  autoStart: false,
  enabled: true,
};

function runtimeState(summary: string = 'stable'): ModuleRuntimeState {
  return {
    phase: 'running',
    summary,
    attempt: 1,
    maxAttempts: 1,
    lastTransitionAt: '2026-01-01T00:00:00.000Z',
    health: {
      state: 'healthy',
      summary: 'ok',
    },
  };
}

function createAdapter(overrides: Partial<ModuleProtocol> = {}): ModuleProtocol {
  const status: ModuleStatusInfo = { status: ModuleStatus.RUNNING, pid: 1234 };
  const health: ModuleHealthReport = { state: 'healthy', summary: 'healthy' };
  const readiness: ModuleStartReadiness = {
    ready: true,
    actionLabel: '启动',
    summary: '可直接启动',
  };

  return {
    status: jest.fn().mockResolvedValue(status),
    start: jest.fn().mockResolvedValue(true),
    inspectStartReadiness: jest.fn().mockResolvedValue(readiness),
    getLastStartPreparation: jest.fn().mockReturnValue({
      dependencyInstalled: true,
      installCommand: 'npm ci',
      summary: '已安装依赖并启动',
    }),
    getRuntimeState: jest.fn().mockReturnValue(runtimeState()),
    probeHealth: jest.fn().mockResolvedValue(health),
    stop: jest.fn().mockResolvedValue(true),
    logs: jest.fn().mockResolvedValue([]),
    getSettings: jest.fn().mockResolvedValue([]),
    setSetting: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('ModuleLifecycle', () => {
  it('inspects status, health, readiness, and runtime state through one adapter', async () => {
    const adapter = createAdapter();
    const factory: ModuleAdapterFactory = jest.fn().mockReturnValue(adapter);
    const lifecycle = new ModuleLifecycle(factory);

    const inspection = await lifecycle.inspect(moduleMeta);

    expect(factory).toHaveBeenCalledWith(moduleMeta);
    expect(adapter.status).toHaveBeenCalled();
    expect(adapter.probeHealth).toHaveBeenCalled();
    expect(adapter.inspectStartReadiness).toHaveBeenCalled();
    expect(adapter.getRuntimeState).toHaveBeenCalled();
    expect(inspection.status.status).toBe(ModuleStatus.RUNNING);
    expect(inspection.health.state).toBe('healthy');
    expect(inspection.startReadiness.ready).toBe(true);
    expect(inspection.runtimeState.phase).toBe('running');
  });

  it('starts a module and returns preparation plus runtime state', async () => {
    const adapter = createAdapter({
      getRuntimeState: jest.fn().mockReturnValue(runtimeState('started')),
    });
    const lifecycle = new ModuleLifecycle(jest.fn().mockReturnValue(adapter));

    const result = await lifecycle.start(moduleMeta);

    expect(adapter.start).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.preparation?.dependencyInstalled).toBe(true);
    expect(result.runtimeState.summary).toBe('started');
  });

  it('stops a module with the requested force flag', async () => {
    const adapter = createAdapter({
      getRuntimeState: jest.fn().mockReturnValue(runtimeState('stopped')),
    });
    const lifecycle = new ModuleLifecycle(jest.fn().mockReturnValue(adapter));

    const result = await lifecycle.stop(moduleMeta, true);

    expect(adapter.stop).toHaveBeenCalledWith(true);
    expect(result.success).toBe(true);
    expect(result.runtimeState.summary).toBe('stopped');
  });

  it('restarts by stopping before starting', async () => {
    const adapter = createAdapter({
      getRuntimeState: jest.fn().mockReturnValue(runtimeState('restarted')),
    });
    const lifecycle = new ModuleLifecycle(jest.fn().mockReturnValue(adapter));

    const result = await lifecycle.restart(moduleMeta);

    expect(adapter.stop).toHaveBeenCalledWith();
    expect(adapter.start).toHaveBeenCalled();
    expect((adapter.stop as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((adapter.start as jest.Mock).mock.invocationCallOrder[0]);
    expect(result.runtimeState.summary).toBe('restarted');
  });
});

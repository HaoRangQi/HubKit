import { ModuleWorkspace } from '../../src/config/config';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleLifecycle } from '../../src/runtime/module-lifecycle';
import { ModuleWorkspaceRunner, WorkspaceHistoryStore } from '../../src/runtime/module-workspace';
import { ModuleMetadata, ModuleStatus } from '../../src/types/module';

function moduleOf(id: string): ModuleMetadata {
  return {
    id,
    name: `${id} module`,
    type: 'shell',
    scriptPath: `/tmp/${id}.sh`,
    autoStart: false,
    enabled: true,
  };
}

function workspace(overrides: Partial<ModuleWorkspace> = {}): ModuleWorkspace {
  return {
    id: 'dev',
    name: 'Development',
    moduleIds: ['api', 'web', 'worker'],
    failurePolicy: 'stop',
    ...overrides,
  };
}

function createRegistry(ids: string[]): ModuleRegistry {
  const registry = new ModuleRegistry();
  ids.forEach((id) => registry.register(moduleOf(id)));
  return registry;
}

function createLifecycle(overrides: Partial<ModuleLifecycle> = {}): ModuleLifecycle {
  return {
    status: jest.fn().mockResolvedValue({ status: ModuleStatus.STOPPED }),
    start: jest.fn().mockResolvedValue({ success: true }),
    stop: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as unknown as ModuleLifecycle;
}

function createHistoryStore(): jest.Mocked<WorkspaceHistoryStore> {
  return {
    recordWorkspaceHistory: jest.fn(),
  };
}

describe('ModuleWorkspaceRunner', () => {
  it('builds an explainable start plan with preferred order and missing modules', () => {
    const registry = createRegistry(['api', 'worker']);
    const runner = new ModuleWorkspaceRunner(registry, createLifecycle(), createHistoryStore());

    const plan = runner.buildPlan(workspace({
      moduleIds: ['api', 'web', 'worker'],
      startOrder: ['worker', 'api'],
    }), 'start');

    expect(plan.steps.map((step) => step.moduleId)).toEqual(['worker', 'api', 'web']);
    expect(plan.runnableModuleIds).toEqual(['worker', 'api']);
    expect(plan.missingModuleIds).toEqual(['web']);
    expect(plan.steps[2]).toEqual({
      moduleId: 'web',
      status: 'missing',
      reason: '模块不存在或尚未被扫描加载',
    });
  });

  it('uses explicit stop order or falls back to reverse module order', () => {
    const registry = createRegistry(['api', 'web', 'worker']);
    const runner = new ModuleWorkspaceRunner(registry, createLifecycle(), createHistoryStore());

    expect(runner.buildPlan(workspace({ stopOrder: ['api', 'web'] }), 'stop').steps.map((step) => step.moduleId))
      .toEqual(['api', 'web', 'worker']);
    expect(runner.buildPlan(workspace(), 'stop').steps.map((step) => step.moduleId))
      .toEqual(['worker', 'web', 'api']);
  });

  it('stops the workspace run after a failure when policy is stop', async () => {
    const registry = createRegistry(['api', 'web']);
    const lifecycle = createLifecycle({
      start: jest.fn()
        .mockRejectedValueOnce(new Error('api failed'))
        .mockResolvedValueOnce({ success: true }),
    });
    const historyStore = createHistoryStore();
    const runner = new ModuleWorkspaceRunner(registry, lifecycle, historyStore);

    const result = await runner.run(workspace({
      moduleIds: ['api', 'web'],
      failurePolicy: 'stop',
    }), 'start');

    expect(result.success).toBe(false);
    expect(result.steps.map((step) => step.result)).toEqual(['failed', 'skipped']);
    expect(result.steps[0].error).toBe('api failed');
    expect(lifecycle.start).toHaveBeenCalledTimes(1);
    expect(historyStore.recordWorkspaceHistory).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'dev',
      action: 'start',
      success: false,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      failureSummary: 'api: api failed',
    }));
  });

  it('continues after a module failure when policy is continue', async () => {
    const registry = createRegistry(['api', 'web']);
    const lifecycle = createLifecycle({
      start: jest.fn()
        .mockRejectedValueOnce(new Error('api failed'))
        .mockResolvedValueOnce({ success: true }),
    });
    const historyStore = createHistoryStore();
    const runner = new ModuleWorkspaceRunner(registry, lifecycle, historyStore);

    const result = await runner.run(workspace({
      moduleIds: ['api', 'web'],
      failurePolicy: 'continue',
    }), 'start');

    expect(result.success).toBe(false);
    expect(result.steps.map((step) => step.result)).toEqual(['failed', 'succeeded']);
    expect(lifecycle.start).toHaveBeenCalledTimes(2);
    expect(historyStore.recordWorkspaceHistory).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'dev',
      action: 'start',
      success: false,
      failureSummary: 'api: api failed',
    }));
  });

  it('skips lifecycle actions when module state already matches the request', async () => {
    const registry = createRegistry(['api']);
    const lifecycle = createLifecycle({
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.RUNNING }),
      start: jest.fn(),
    });
    const historyStore = createHistoryStore();
    const runner = new ModuleWorkspaceRunner(registry, lifecycle, historyStore);

    const result = await runner.run(workspace({ moduleIds: ['api'] }), 'start');

    expect(result.success).toBe(true);
    expect(result.steps[0]).toEqual(expect.objectContaining({
      result: 'succeeded',
      message: '模块已在运行，跳过启动',
    }));
    expect(lifecycle.start).not.toHaveBeenCalled();
    expect(historyStore.recordWorkspaceHistory).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'dev',
      action: 'start',
      success: true,
      failureSummary: undefined,
    }));
  });

  it('summarizes missing modules in persisted history', async () => {
    const registry = createRegistry(['api']);
    const historyStore = createHistoryStore();
    const runner = new ModuleWorkspaceRunner(registry, createLifecycle(), historyStore);

    const result = await runner.run(workspace({ moduleIds: ['missing', 'api'] }), 'stop');

    expect(result.success).toBe(false);
    expect(historyStore.recordWorkspaceHistory).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'dev',
      action: 'stop',
      success: false,
      failureSummary: 'missing: 模块不存在或尚未被扫描加载',
    }));
  });

  it('does not fail a completed workspace run when history persistence fails', async () => {
    const registry = createRegistry(['api']);
    const historyStore = createHistoryStore();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    historyStore.recordWorkspaceHistory.mockImplementation(() => {
      throw new Error('history write failed');
    });
    const runner = new ModuleWorkspaceRunner(registry, createLifecycle(), historyStore);

    const result = await runner.run(workspace({ moduleIds: ['api'] }), 'start');

    expect(result.success).toBe(true);
    expect(result.steps[0].result).toBe('succeeded');
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to persist workspace run history:',
      expect.objectContaining({ message: 'history write failed' }),
    );

    warnSpy.mockRestore();
  });
});

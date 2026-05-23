import { moduleRuntimeStateStore } from '../../src/runtime/module-runtime-state';

describe('module-runtime-state', () => {
  const moduleId = 'runtime-demo';

  beforeEach(() => {
    moduleRuntimeStateStore.reset(moduleId);
  });

  it('returns default stopped state', () => {
    const state = moduleRuntimeStateStore.get(moduleId);
    expect(state.phase).toBe('stopped');
    expect(state.summary).toBe('待机');
    expect(state.health.state).toBe('unknown');
  });

  it('patches phase and health updates', () => {
    moduleRuntimeStateStore.setPhase(moduleId, 'starting', '正在启动', {
      attempt: 1,
      maxAttempts: 2,
    });
    moduleRuntimeStateStore.setHealth(moduleId, {
      state: 'checking',
      summary: '等待响应',
      checkedAt: new Date().toISOString(),
    });

    const state = moduleRuntimeStateStore.get(moduleId);
    expect(state.phase).toBe('starting');
    expect(state.attempt).toBe(1);
    expect(state.maxAttempts).toBe(2);
    expect(state.health.summary).toBe('等待响应');
  });
});

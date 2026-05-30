import { TaskScheduler, TaskStatus } from '../../src/scheduler/task-scheduler';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { DependencyManager } from '../../src/dependency/dependency-manager';

function createRegistry(moduleIds: string[]): ModuleRegistry {
  const registry = new ModuleRegistry();
  moduleIds.forEach((id) => registry.register({
    id,
    name: id,
    type: 'shell',
    scriptPath: `/tmp/${id}.sh`,
    autoStart: false,
    enabled: true,
  }));
  return registry;
}

async function runWithSchedulerTimers(promise: Promise<void>, rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    jest.advanceTimersByTime(100);
    await Promise.resolve();
  }
  await promise;
}

describe('TaskScheduler', () => {
  let logManager: { write: jest.Mock };
  let processManager: { isRunning: jest.Mock; stop: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-30T00:00:00.000Z'));
    logManager = { write: jest.fn() };
    processManager = {
      isRunning: jest.fn().mockReturnValue(true),
      stop: jest.fn().mockReturnValue(true),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('queues tasks with stable metadata and exposes task status', () => {
    const scheduler = new TaskScheduler(
      createRegistry(['demo']),
      new DependencyManager(),
      processManager as any,
      logManager as any
    );

    const taskId = scheduler.addTask('demo', 'start');

    expect(taskId).toBe('demo-start-1780099200000');
    expect(scheduler.getTask(taskId)).toEqual({
      id: taskId,
      moduleId: 'demo',
      action: 'start',
      status: TaskStatus.PENDING,
    });
    expect(scheduler.listTasks()).toHaveLength(1);
  });

  it('executes start tasks after dependencies are running', async () => {
    const dependencies = new DependencyManager();
    dependencies.addDependency('app', ['db']);
    const scheduler = new TaskScheduler(
      createRegistry(['app', 'db']),
      dependencies,
      processManager as any,
      logManager as any,
      1
    );
    const taskId = scheduler.addTask('app', 'start');

    await runWithSchedulerTimers(scheduler.execute());

    expect(processManager.isRunning).toHaveBeenCalledWith('db');
    expect(scheduler.getTask(taskId)).toEqual(expect.objectContaining({
      status: TaskStatus.COMPLETED,
      startedAt: expect.any(Date),
      completedAt: expect.any(Date),
    }));
    expect(logManager.write).toHaveBeenCalledWith('app', 'info', 'Module app started');
    expect(logManager.write).toHaveBeenCalledWith('app', 'info', 'Task start completed');
  });

  it('fails tasks when a dependency is not running', async () => {
    const dependencies = new DependencyManager();
    dependencies.addDependency('app', ['db']);
    processManager.isRunning.mockReturnValue(false);
    const scheduler = new TaskScheduler(
      createRegistry(['app', 'db']),
      dependencies,
      processManager as any,
      logManager as any
    );
    const taskId = scheduler.addTask('app', 'start');

    await runWithSchedulerTimers(scheduler.execute());

    expect(scheduler.getTask(taskId)).toEqual(expect.objectContaining({
      status: TaskStatus.FAILED,
      error: 'Dependency not running: db',
    }));
    expect(logManager.write).toHaveBeenCalledWith(
      'app',
      'error',
      'Task start failed: Dependency not running: db'
    );
  });

  it('executes stop tasks through the process manager', async () => {
    const scheduler = new TaskScheduler(
      createRegistry(['app']),
      new DependencyManager(),
      processManager as any,
      logManager as any
    );
    const taskId = scheduler.addTask('app', 'stop');

    await runWithSchedulerTimers(scheduler.execute());

    expect(processManager.stop).toHaveBeenCalledWith('app');
    expect(scheduler.getTask(taskId)?.status).toBe(TaskStatus.COMPLETED);
    expect(logManager.write).toHaveBeenCalledWith('app', 'info', 'Task stop completed');
  });

  it('runs startAll and stopAll in dependency order', async () => {
    const dependencies = new DependencyManager();
    dependencies.addDependency('app', ['db']);
    const scheduler = new TaskScheduler(
      createRegistry(['app', 'db']),
      dependencies,
      processManager as any,
      logManager as any,
      1
    );

    await runWithSchedulerTimers(scheduler.startAll(['app', 'db']));
    await runWithSchedulerTimers(scheduler.stopAll(['app', 'db']));

    expect(scheduler.listTasks().map((task) => `${task.moduleId}:${task.action}`)).toEqual([
      'db:start',
      'app:start',
      'app:stop',
      'db:stop',
    ]);
  });
});

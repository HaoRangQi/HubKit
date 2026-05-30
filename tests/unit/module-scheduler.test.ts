import { ModuleScheduler, getNextScheduleAction } from '../../src/scheduler/module-scheduler';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleStatus } from '../../src/types/module';

const mockSettings: any = {
  schedules: {},
};

jest.mock('../../src/config/config', () => ({
  config: {
    getSettings: jest.fn(() => mockSettings),
  },
}));

describe('getNextScheduleAction', () => {
  it('returns null for disabled schedules', () => {
    expect(getNextScheduleAction({
      enabled: false,
      startTime: '09:00',
    }, new Date(2026, 0, 5, 8, 0))).toBeNull();
  });

  it('picks the next action later today', () => {
    const next = getNextScheduleAction({
      enabled: true,
      startTime: '09:00',
      stopTime: '18:30',
    }, new Date(2026, 0, 5, 10, 0));

    expect(next?.action).toBe('stop');
    expect(next?.time).toBe('18:30');
    const at = new Date(next!.at);
    expect(at.getHours()).toBe(18);
    expect(at.getMinutes()).toBe(30);
  });

  it('rolls actions that already passed to the next valid day', () => {
    const from = new Date(2026, 0, 5, 23, 0);
    const next = getNextScheduleAction({
      enabled: true,
      startTime: '08:15',
    }, from);

    expect(next?.action).toBe('start');
    expect(next?.time).toBe('08:15');
    const at = new Date(next!.at);
    expect(at.getDate()).toBe(from.getDate() + 1);
    expect(at.getHours()).toBe(8);
    expect(at.getMinutes()).toBe(15);
  });

  it('respects selected weekdays', () => {
    const from = new Date(2026, 0, 5, 10, 0);
    const targetDay = (from.getDay() + 2) % 7;
    const next = getNextScheduleAction({
      enabled: true,
      startTime: '09:00',
      stopTime: '17:00',
      daysOfWeek: [targetDay],
    }, from);

    const at = new Date(next!.at);
    expect(at.getDay()).toBe(targetDay);
    expect(next?.action).toBe('start');
    expect(next?.time).toBe('09:00');
  });

  it('returns null when enabled without a valid action time', () => {
    expect(getNextScheduleAction({
      enabled: true,
      startTime: '',
      stopTime: '99:99',
    }, new Date(2026, 0, 5, 10, 0))).toBeNull();
  });
});

describe('ModuleScheduler', () => {
  let registry: ModuleRegistry;
  let lifecycle: {
    status: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
  };
  let eventListener: jest.Mock;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 5, 9, 0, 0));
    mockSettings.schedules = {};
    registry = new ModuleRegistry();
    registry.register({
      id: 'demo',
      name: 'Demo',
      type: 'shell',
      scriptPath: '/tmp/demo.sh',
      autoStart: false,
      enabled: true,
    });
    lifecycle = {
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.STOPPED }),
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(true),
    };
    eventListener = jest.fn();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('reports schedule status with next action and last result', async () => {
    const scheduler = new ModuleScheduler(registry, lifecycle as any);
    scheduler.setEventListener(eventListener);
    mockSettings.schedules.demo = { enabled: true, startTime: '09:00' };

    await (scheduler as any).tick();

    const status = scheduler.getScheduleStatus('demo', {
      enabled: true,
      stopTime: '18:00',
    }, new Date(2026, 0, 5, 10, 0));

    expect(status.enabled).toBe(true);
    expect(status.nextAction).toEqual(expect.objectContaining({ action: 'stop', time: '18:00' }));
    expect(status.lastResult).toEqual(expect.objectContaining({
      moduleId: 'demo',
      action: 'start',
      success: true,
      message: 'Demo 已按计划启动',
    }));
  });

  it('starts modules when the current time matches the start schedule and avoids duplicate triggers in the same minute', async () => {
    const scheduler = new ModuleScheduler(registry, lifecycle as any);
    scheduler.setEventListener(eventListener);
    mockSettings.schedules.demo = { enabled: true, startTime: '09:00' };

    await (scheduler as any).tick();
    await (scheduler as any).tick();

    expect(lifecycle.start).toHaveBeenCalledTimes(1);
    expect(lifecycle.start).toHaveBeenCalledWith(registry.get('demo'));
    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'schedule_triggered',
      moduleId: 'demo',
      action: 'start',
      success: true,
      skipped: undefined,
    }));
  });

  it('skips scheduled starts for already running modules', async () => {
    lifecycle.status.mockResolvedValue({ status: ModuleStatus.RUNNING });
    const scheduler = new ModuleScheduler(registry, lifecycle as any);
    scheduler.setEventListener(eventListener);
    mockSettings.schedules.demo = { enabled: true, startTime: '09:00' };

    await (scheduler as any).tick();

    expect(lifecycle.start).not.toHaveBeenCalled();
    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
      action: 'start',
      success: true,
      skipped: true,
      message: 'Demo 已在运行，跳过定时启动',
    }));
  });

  it('stops running modules when the current time matches the stop schedule', async () => {
    lifecycle.status.mockResolvedValue({ status: ModuleStatus.RUNNING });
    const scheduler = new ModuleScheduler(registry, lifecycle as any);
    scheduler.setEventListener(eventListener);
    mockSettings.schedules.demo = { enabled: true, stopTime: '09:00' };

    await (scheduler as any).tick();

    expect(lifecycle.stop).toHaveBeenCalledWith(registry.get('demo'));
    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stop',
      success: true,
      message: 'Demo 已按计划停止',
    }));
  });

  it('records failure events when scheduled lifecycle actions throw', async () => {
    lifecycle.start.mockRejectedValue(new Error('boom'));
    const scheduler = new ModuleScheduler(registry, lifecycle as any);
    scheduler.setEventListener(eventListener);
    mockSettings.schedules.demo = { enabled: true, startTime: '09:00' };

    await (scheduler as any).tick();

    expect(eventListener).toHaveBeenCalledWith(expect.objectContaining({
      action: 'start',
      success: false,
      message: '定时启动失败',
      error: 'boom',
    }));
    expect(errorSpy).toHaveBeenCalledWith('[scheduler] start 失败 demo: boom');
  });

  it('respects weekday filters and ignores missing modules', async () => {
    const scheduler = new ModuleScheduler(registry, lifecycle as any);
    mockSettings.schedules.demo = { enabled: true, startTime: '09:00', daysOfWeek: [2] };
    mockSettings.schedules.missing = { enabled: true, startTime: '09:00' };

    await (scheduler as any).tick();

    expect(lifecycle.start).not.toHaveBeenCalled();
  });

  it('starts and stops the interval idempotently', () => {
    const scheduler = new ModuleScheduler(registry, lifecycle as any);

    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[scheduler] 定时调度器已启动');
  });
});

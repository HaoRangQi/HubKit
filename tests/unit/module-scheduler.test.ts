import { getNextScheduleAction } from '../../src/scheduler/module-scheduler';

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

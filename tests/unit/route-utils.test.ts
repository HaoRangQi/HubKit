import {
  getRouteParam,
  parseLogLineCount,
  parseLogSearchLevel,
  parseLogSearchLimit,
  parseWorkspaceAction,
  uniqueRouteStrings,
} from '../../src/web/api/route-utils';

describe('route utils', () => {
  it('normalizes route params from express values', () => {
    expect(getRouteParam('module-a')).toBe('module-a');
    expect(getRouteParam(['module-a', 'module-b'])).toBe('module-a');
    expect(getRouteParam(undefined)).toBe('');
  });

  it('clamps log line counts', () => {
    expect(parseLogLineCount('50')).toBe(50);
    expect(parseLogLineCount('0')).toBe(1);
    expect(parseLogLineCount('9999')).toBe(2000);
    expect(parseLogLineCount('bad')).toBe(200);
  });

  it('clamps log search limits', () => {
    expect(parseLogSearchLimit('25')).toBe(25);
    expect(parseLogSearchLimit('-1')).toBe(1);
    expect(parseLogSearchLimit('9999')).toBe(500);
    expect(parseLogSearchLimit(undefined)).toBe(100);
  });

  it('normalizes log search levels and workspace actions', () => {
    expect(parseLogSearchLevel('warn')).toBe('warn');
    expect(parseLogSearchLevel('verbose')).toBe('all');
    expect(parseWorkspaceAction('stop')).toBe('stop');
    expect(parseWorkspaceAction('restart')).toBe('start');
  });

  it('deduplicates and trims route string arrays', () => {
    expect(uniqueRouteStrings([' a ', 'b', 'a', '', 1, ' b '])).toEqual(['a', 'b']);
    expect(uniqueRouteStrings('a')).toEqual([]);
  });
});

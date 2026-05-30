import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LogManager } from '../../src/log/log-manager';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-log-manager-'));
}

describe('LogManager', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('creates the log directory and appends readable log entries', () => {
    const logDir = path.join(createTempDir(), 'logs');
    const manager = new LogManager(logDir);

    manager.write('demo', 'info', 'started');
    manager.write('demo', 'error', 'failed');

    const entries = manager.read('demo');
    expect(fs.existsSync(logDir)).toBe(true);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      timestamp: expect.any(Date),
      level: 'info',
      message: 'started',
    });
    expect(entries[1].level).toBe('error');
    expect(entries[1].message).toBe('failed');
    expect(manager.getSize('demo')).toBeGreaterThan(0);
  });

  it('returns only the requested number of recent lines and skips malformed lines', () => {
    const logDir = createTempDir();
    const manager = new LogManager(logDir);
    const logFile = path.join(logDir, 'demo.log');
    fs.writeFileSync(logFile, [
      '[2026-05-30T00:00:00.000Z] [INFO] first',
      'malformed',
      '[2026-05-30T00:00:01.000Z] [WARN] second',
      '[2026-05-30T00:00:02.000Z] [ERROR] third',
    ].join('\n'), 'utf-8');

    const entries = manager.read('demo', 3);

    expect(entries).toEqual([
      { timestamp: new Date('2026-05-30T00:00:01.000Z'), level: 'warn', message: 'second' },
      { timestamp: new Date('2026-05-30T00:00:02.000Z'), level: 'error', message: 'third' },
    ]);
  });

  it('returns empty results for missing or unreadable logs', () => {
    const manager = new LogManager(createTempDir());

    expect(manager.read('missing')).toEqual([]);
    expect(manager.getSize('missing')).toBe(0);
  });

  it('clears existing log files', () => {
    const logDir = createTempDir();
    const manager = new LogManager(logDir);
    manager.write('demo', 'debug', 'temporary');

    manager.clear('demo');

    expect(manager.read('demo')).toEqual([]);
    expect(manager.getSize('demo')).toBe(0);
  });
});

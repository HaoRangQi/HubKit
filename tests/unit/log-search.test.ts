import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inferLogLevel, searchLogs } from '../../src/runtime/log-search';

function createTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-log-search-test-'));
}

describe('log-search', () => {
  it('searches across sources and returns newest matches first', async () => {
    const dir = createTempLogDir();
    const alphaLog = path.join(dir, 'alpha.log');
    const betaLog = path.join(dir, 'beta.log');
    fs.writeFileSync(alphaLog, [
      '[info] alpha ready',
      '[warn] alpha disk slow',
      '[error] alpha failed to start',
    ].join('\n'), 'utf-8');
    fs.writeFileSync(betaLog, [
      '[info] beta ready',
      '[error] beta failed to connect',
    ].join('\n'), 'utf-8');

    const results = await searchLogs([
      { id: 'alpha', name: 'Alpha', kind: 'module', filePath: alphaLog },
      { id: 'beta', name: 'Beta', kind: 'module', filePath: betaLog },
    ], { query: 'failed', level: 'error', lines: 20 });

    expect(results.map((item) => `${item.sourceId}:${item.message}`)).toEqual([
      'beta:[error] beta failed to connect',
      'alpha:[error] alpha failed to start',
    ]);
  });

  it('filters by level and respects result limit', async () => {
    const dir = createTempLogDir();
    const logPath = path.join(dir, 'module.log');
    fs.writeFileSync(logPath, [
      'debug trace one',
      'warn first',
      'warn second',
      'error ignored by level',
    ].join('\n'), 'utf-8');

    const results = await searchLogs([
      { id: 'mod', name: 'Module', kind: 'module', filePath: logPath },
    ], { level: 'warn', limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceId: 'mod',
      level: 'warn',
      message: 'warn second',
    });
  });

  it('skips missing log files', async () => {
    const results = await searchLogs([
      { id: 'missing', name: 'Missing', kind: 'module', filePath: path.join(os.tmpdir(), `missing-${Date.now()}.log`) },
    ], { query: 'anything' });

    expect(results).toEqual([]);
  });

  it('can search provided raw log content without a file path', async () => {
    const results = await searchLogs([
      {
        id: 'inline',
        name: 'Inline',
        kind: 'module',
        content: [
          'server ready',
          'Error: inline failed',
        ].join('\n'),
      },
    ], { query: 'inline', level: 'error' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceId: 'inline',
      level: 'error',
      message: 'Error: inline failed',
    });
  });

  it('infers common log levels', () => {
    expect(inferLogLevel('Error: failed')).toBe('error');
    expect(inferLogLevel('WARN deprecated')).toBe('warn');
    expect(inferLogLevel('debug verbose')).toBe('debug');
    expect(inferLogLevel('server started')).toBe('info');
  });
});

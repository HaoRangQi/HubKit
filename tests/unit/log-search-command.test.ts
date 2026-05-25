import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { ModuleRegistry } from '../../src/registry/module-registry';
import {
  formatLogSearchResults,
  parseLogSearchLevelOption,
  parsePositiveIntegerOption,
  registerLogSearchCommand,
} from '../../src/cli/commands/log-search';
import { LogSearchSource } from '../../src/runtime/log-search';

function createProgram(): Command {
  const program = new Command();
  program.name('hub');
  program.exitOverride();
  program.configureOutput({
    writeOut: jest.fn(),
    writeErr: jest.fn(),
  });
  return program;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

describe('log-search command', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('registers log-search from the CLI command index', () => {
    const source = readSource('src/cli/commands/index.ts');

    expect(source).toContain("import { registerLogSearchCommand } from './log-search'");
    expect(source).toContain('registerLogSearchCommand(program, registry)');
  });

  it('parses supported levels and rejects invalid ones', () => {
    expect(parseLogSearchLevelOption(undefined)).toBe('all');
    expect(parseLogSearchLevelOption('error')).toBe('error');
    expect(() => parseLogSearchLevelOption('fatal')).toThrow('--level');
  });

  it('parses bounded integer options', () => {
    expect(parsePositiveIntegerOption(undefined, 500, 1, 2000, '--lines')).toBe(500);
    expect(parsePositiveIntegerOption('20', 500, 1, 2000, '--lines')).toBe(20);
    expect(() => parsePositiveIntegerOption('20abc', 500, 1, 2000, '--lines')).toThrow('--lines');
    expect(() => parsePositiveIntegerOption('0', 500, 1, 2000, '--lines')).toThrow('--lines');
  });

  it('formats empty and matched results', () => {
    expect(formatLogSearchResults([], 2, { query: 'failed', level: 'error' }))
      .toContain('未找到匹配日志');

    const output = formatLogSearchResults([
      {
        sourceId: 'api',
        sourceName: 'API',
        sourceKind: 'module',
        level: 'error',
        lineNumber: 12,
        message: '[error] failed to start',
      },
    ], 1, { query: 'failed', level: 'error' });

    expect(output).toContain('日志搜索结果 (1 条，扫描 1 个来源)');
    expect(output).toContain('[error] API (api:12)');
    expect(output).toContain('[error] failed to start');
  });

  it('runs through injected scanning, source collection, and search', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const sources: LogSearchSource[] = [
      { id: 'api', name: 'API', kind: 'module', content: '[error] failed' },
    ];
    const scanAndRegister = jest.fn().mockResolvedValue(undefined);
    const collectSources = jest.fn().mockResolvedValue(sources);
    const search = jest.fn().mockResolvedValue([
      {
        sourceId: 'api',
        sourceName: 'API',
        sourceKind: 'module',
        level: 'error',
        lineNumber: 1,
        message: '[error] failed',
      },
    ]);

    registerLogSearchCommand(program, registry, {
      scanAndRegister,
      collectSources,
      search,
    });

    await program.parseAsync([
      'node',
      'hub',
      'log-search',
      '--query',
      'failed',
      '--level',
      'error',
      '--lines',
      '20',
      '--limit',
      '5',
    ], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(collectSources).toHaveBeenCalledWith(registry, 20);
    expect(search).toHaveBeenCalledWith(sources, {
      query: 'failed',
      level: 'error',
      lines: 20,
      limit: 5,
    });
    expect(logSpy.mock.calls[0][0]).toContain('日志搜索结果');
  });

  it('supports JSON output for automation users', async () => {
    const program = createProgram();

    registerLogSearchCommand(program, new ModuleRegistry(), {
      scanAndRegister: jest.fn().mockResolvedValue(undefined),
      collectSources: jest.fn().mockResolvedValue([]),
      search: jest.fn().mockResolvedValue([]),
    });

    await program.parseAsync(['node', 'hub', 'log-search', '--json'], { from: 'node' });

    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload).toMatchObject({
      query: '',
      level: 'all',
      scannedSources: 0,
      results: [],
    });
  });
});

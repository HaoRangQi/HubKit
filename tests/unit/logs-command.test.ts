import * as path from 'path';
import { Command } from 'commander';
import { registerLogsCommand, parseLogLinesOption } from '../../src/cli/commands/logs';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';

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

function moduleMetadata(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'api',
    name: 'API',
    type: 'nodejs',
    scriptPath: '/modules/api/index.js',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('logs command', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('parses and validates the line count option', () => {
    expect(parseLogLinesOption(undefined)).toBe(50);
    expect(parseLogLinesOption('20')).toBe(20);
    expect(parseLogLinesOption(' 20 ')).toBe(20);

    expect(() => parseLogLinesOption('0')).toThrow('--lines');
    expect(() => parseLogLinesOption('2001')).toThrow('--lines');
    expect(() => parseLogLinesOption('20abc')).toThrow('--lines');
    expect(() => parseLogLinesOption('1.5')).toThrow('--lines');
  });

  it('reads recent lines from the configured logDir using the tail helper', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockImplementation(async (activeRegistry: ModuleRegistry) => {
      activeRegistry.register(moduleMetadata());
    });
    const readRecentText = jest.fn().mockResolvedValue('old\nnew\n');
    const logDir = path.join('/tmp', 'hubkit-logs');

    registerLogsCommand(program, registry, {
      scanAndRegister,
      getLogDir: () => logDir,
      readRecentText,
    });

    await program.parseAsync(['node', 'hub', 'logs', 'api', '--lines', '2'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(readRecentText).toHaveBeenCalledWith(path.join(logDir, 'api.log'), 2);
    expect(readRecentText.mock.calls[0][0]).not.toContain(path.join('.hub', 'logs'));
    expect(logSpy.mock.calls[0][0]).toContain('API 日志 (最近 2 行)');
    expect(logSpy.mock.calls[1][0]).toBe('old\nnew\n');
  });

  it('does not crash or start watching when following a missing log file', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    registry.register(moduleMetadata());
    const logDir = path.join('/tmp', 'hubkit-logs');
    const watch = jest.fn();

    registerLogsCommand(program, registry, {
      scanAndRegister: jest.fn().mockResolvedValue(undefined),
      getLogDir: () => logDir,
      readRecentText: jest.fn().mockResolvedValue(''),
      statSync: jest.fn(() => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }) as any,
      watch: watch as any,
    });

    await program.parseAsync(['node', 'hub', 'logs', 'api', '--follow'], { from: 'node' });

    expect(watch).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some(([message]) => message === '暂无日志')).toBe(true);
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('日志文件尚未创建，无法持续监控'))).toBe(true);
    expect(logSpy.mock.calls.some(([message]) => String(message).includes(path.join(logDir, 'api.log')))).toBe(true);
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { ModuleWorkspace } from '../../src/config/config';
import { ModuleRegistry } from '../../src/registry/module-registry';
import {
  findWorkspace,
  formatWorkspaceList,
  formatWorkspacePlan,
  parseWorkspaceAction,
  registerWorkspaceCommand,
} from '../../src/cli/commands/workspace';
import { WorkspacePlan, WorkspaceRunResult } from '../../src/runtime/module-workspace';

function workspace(overrides: Partial<ModuleWorkspace> = {}): ModuleWorkspace {
  return {
    id: 'dev',
    name: 'Development',
    description: 'Daily development stack',
    moduleIds: ['api', 'web'],
    failurePolicy: 'stop',
    ...overrides,
  };
}

function plan(): WorkspacePlan {
  return {
    workspaceId: 'dev',
    workspaceName: 'Development',
    action: 'stop',
    failurePolicy: 'stop',
    runnableModuleIds: ['web'],
    missingModuleIds: ['api'],
    steps: [
      {
        moduleId: 'web',
        moduleName: 'Web',
        status: 'ready',
      },
      {
        moduleId: 'api',
        status: 'missing',
        reason: '模块不存在或尚未被扫描加载',
      },
    ],
  };
}

function runResult(): WorkspaceRunResult {
  return {
    workspaceId: 'dev',
    workspaceName: 'Development',
    action: 'start',
    success: true,
    failurePolicy: 'continue',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    steps: [
      {
        moduleId: 'api',
        moduleName: 'API',
        status: 'ready',
        result: 'succeeded',
        message: '模块已启动',
      },
    ],
  };
}

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

describe('workspace command', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('registers workspace commands from the CLI command index', () => {
    const source = readSource('src/cli/commands/index.ts');

    expect(source).toContain("import { registerWorkspaceCommand } from './workspace'");
    expect(source).toContain('registerWorkspaceCommand(program, registry)');
  });

  it('registers list, plan, start, and stop subcommands', () => {
    const program = createProgram();

    registerWorkspaceCommand(program, new ModuleRegistry(), {
      getWorkspaces: () => [],
      scanAndRegister: jest.fn(),
      createRunner: jest.fn(),
    });

    const workspaceCommand = program.commands.find((command) => command.name() === 'workspace');
    expect(workspaceCommand?.commands.map((command) => command.name()).sort())
      .toEqual(['list', 'plan', 'start', 'stop']);
  });

  it('parses supported workspace actions', () => {
    expect(parseWorkspaceAction(undefined)).toBe('start');
    expect(parseWorkspaceAction('start')).toBe('start');
    expect(parseWorkspaceAction('stop')).toBe('stop');
    expect(() => parseWorkspaceAction('restart')).toThrow('--action');
  });

  it('formats workspace list and plan output with missing module details', () => {
    expect(formatWorkspaceList([])).toBe('未配置工作区');
    expect(formatWorkspaceList([workspace()])).toContain('Development (dev)');
    expect(formatWorkspaceList([workspace()])).toContain('模块: api, web');

    const output = formatWorkspacePlan(plan());
    expect(output).toContain('动作: 停止');
    expect(output).toContain('可执行模块: 1');
    expect(output).toContain('缺失模块: 1');
    expect(output).toContain('api (模块不存在或尚未被扫描加载)');
  });

  it('finds workspaces by id', () => {
    expect(findWorkspace([workspace()], 'dev')?.name).toBe('Development');
    expect(findWorkspace([workspace()], 'missing')).toBeUndefined();
  });

  it('builds a plan through injected registry scanning and workspace runner', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockResolvedValue(undefined);
    const runner = {
      buildPlan: jest.fn().mockReturnValue(plan()),
      run: jest.fn(),
    };

    registerWorkspaceCommand(program, registry, {
      getWorkspaces: () => [workspace()],
      scanAndRegister,
      createRunner: jest.fn().mockReturnValue(runner),
    });

    await program.parseAsync(['node', 'hub', 'workspace', 'plan', 'dev', '--action', 'stop'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(runner.buildPlan).toHaveBeenCalledWith(workspace(), 'stop');
    expect(logSpy.mock.calls[0][0]).toContain('工作区计划: Development (dev)');
  });

  it('runs workspace start through injected registry scanning and workspace runner', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockResolvedValue(undefined);
    const runner = {
      buildPlan: jest.fn(),
      run: jest.fn().mockResolvedValue(runResult()),
    };

    registerWorkspaceCommand(program, registry, {
      getWorkspaces: () => [workspace({ failurePolicy: 'continue' })],
      scanAndRegister,
      createRunner: jest.fn().mockReturnValue(runner),
    });

    await program.parseAsync(['node', 'hub', 'workspace', 'start', 'dev'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(runner.run).toHaveBeenCalledWith(workspace({ failurePolicy: 'continue' }), 'start');
    expect(logSpy.mock.calls[0][0]).toContain('工作区启动结果: Development (dev)');
    expect(logSpy.mock.calls[0][0]).toContain('状态: 成功');
  });

  it('runs workspace stop through injected registry scanning and workspace runner', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockResolvedValue(undefined);
    const runner = {
      buildPlan: jest.fn(),
      run: jest.fn().mockResolvedValue({
        ...runResult(),
        action: 'stop',
      }),
    };

    registerWorkspaceCommand(program, registry, {
      getWorkspaces: () => [workspace({ failurePolicy: 'continue' })],
      scanAndRegister,
      createRunner: jest.fn().mockReturnValue(runner),
    });

    await program.parseAsync(['node', 'hub', 'workspace', 'stop', 'dev'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(runner.run).toHaveBeenCalledWith(workspace({ failurePolicy: 'continue' }), 'stop');
    expect(logSpy.mock.calls[0][0]).toContain('工作区停止结果: Development (dev)');
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import { ScriptBundleManager } from '../../src/script-bundle/script-bundle-manager';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));

jest.mock('../../src/runtime/log-tail', () => ({
  readLastLinesText: jest.fn(async (filePath: string) => fs.readFileSync(filePath, 'utf-8')),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
}

class TestScriptBundleManager extends ScriptBundleManager {
  terminalCommands: string[] = [];
  ptySpawns: Array<{ file: string; args: string[]; options: any; fake: FakePty }> = [];
  failPtyWith: Error | null = null;

  protected async openTerminalScript(command: string): Promise<void> {
    this.terminalCommands.push(command);
  }

  protected spawnPty(file: string, args: string[], options: any): any {
    if (this.failPtyWith) {
      throw this.failPtyWith;
    }
    const fake = new FakePty();
    this.ptySpawns.push({ file, args, options, fake });
    return fake;
  }
}

class FakePty {
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  private dataHandler: ((data: string) => void) | null = null;
  private exitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitHandler = handler;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
    this.exitHandler?.({ exitCode: 130 });
  }

  emitData(data: string): void {
    this.dataHandler?.(data);
  }

  emitExit(exitCode: number): void {
    this.exitHandler?.({ exitCode });
  }
}

function writeBundle(
  bundleDir: string,
  config: Record<string, unknown>,
  scripts: Record<string, string> = {},
): string {
  const scriptsDir = path.join(bundleDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  Object.entries(scripts).forEach(([name, content]) => {
    fs.writeFileSync(path.join(scriptsDir, name), content, 'utf-8');
  });
  fs.writeFileSync(path.join(bundleDir, 'script-bundle.json'), JSON.stringify({
    rootPath: './scripts',
    ...config,
  }, null, 2), 'utf-8');
  return scriptsDir;
}

describe('ScriptBundleManager', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-bundle-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    spawnMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads script bundle config and resolves latest history', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'sample-bundle');
    const scriptsDir = path.join(bundleDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'task.sh'), '#!/bin/zsh\necho ok\n', 'utf-8');

    fs.writeFileSync(path.join(bundleDir, 'script-bundle.json'), JSON.stringify({
      id: 'sample',
      name: 'Sample Bundle',
      rootPath: './scripts',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            {
              id: 'task',
              name: 'Task',
              scriptPath: 'task.sh',
              executionMode: 'background',
              riskLevel: 'low',
            },
          ],
        },
      ],
    }, null, 2), 'utf-8');

    const historyDir = path.join(dataDir, 'script-bundles', 'history', 'sample');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'task.json'), JSON.stringify([
      {
        runId: 'run-1',
        bundleId: 'sample',
        actionId: 'task',
        actionName: 'Task',
        startedAt: '2026-05-22T12:00:00.000Z',
        executionMode: 'background',
        status: 'succeeded',
        message: '执行完成',
      },
    ], null, 2), 'utf-8');

    const manager = new ScriptBundleManager(dataDir);
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);
    const bundles = manager.listBundles();

    expect(bundles).toHaveLength(1);
    expect(bundles[0].groups).toHaveLength(1);
    expect(bundles[0].groups[0].actions[0].latestRun?.status).toBe('succeeded');
    expect(bundles[0].groups[0].actions[0].executionMode).toBe('background');
  });

  it('ignores missing directories, invalid bundles, bad actions, and path traversal configs', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const modulesDir = path.join(tempDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    fs.writeFileSync(path.join(modulesDir, 'README.md'), 'not a bundle', 'utf-8');

    writeBundle(path.join(modulesDir, 'invalid-root'), { id: 'invalid-root', name: 'Invalid Root' });
    writeBundle(path.join(modulesDir, 'escape'), {
      id: 'escape',
      name: 'Escape',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [{ id: 'bad', name: 'Bad', scriptPath: '../outside.sh' }],
        },
      ],
    });
    writeBundle(path.join(modulesDir, 'missing-script'), {
      id: 'missing-script',
      name: 'Missing Script',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [{ id: 'bad', name: 'Bad', scriptPath: 'missing.sh' }],
        },
      ],
    });
    writeBundle(path.join(modulesDir, 'valid'), {
      id: 'valid',
      name: 'Valid',
      groups: [
        { id: '', title: 'Invalid Group', actions: [] },
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            null,
            { id: 'skip', name: 'Skip' },
            { id: 'task', name: 'Task', scriptPath: 'task.sh', confirmRequired: true, interactive: true },
          ],
        },
      ],
    }, {
      'task.sh': 'echo ok\n',
    });

    try {
      const manager = new ScriptBundleManager(dataDir);
      await manager.loadFromDirectories([path.join(tempDir, 'does-not-exist'), modulesDir]);

      const bundles = manager.listBundles();
      expect(bundles.map((bundle) => bundle.id)).toEqual(['valid']);
      expect(bundles[0].groups).toHaveLength(1);
      expect(bundles[0].groups[0].actions).toEqual([
        expect.objectContaining({
          id: 'task',
          riskLevel: 'medium',
          executionMode: 'terminal',
          confirmRequired: true,
          interactive: true,
        }),
      ]);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('deduplicates rapid terminal action launches', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'terminal-bundle');
    const scriptsDir = path.join(bundleDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'task.sh'), '#!/bin/zsh\necho terminal\n', 'utf-8');

    fs.writeFileSync(path.join(bundleDir, 'script-bundle.json'), JSON.stringify({
      id: 'terminal',
      name: 'Terminal Bundle',
      rootPath: './scripts',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            {
              id: 'task',
              name: 'Task',
              scriptPath: 'task.sh',
              executionMode: 'terminal',
              riskLevel: 'high',
            },
          ],
        },
      ],
    }, null, 2), 'utf-8');

    const manager = new TestScriptBundleManager(dataDir);
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);

    await manager.runAction('terminal', 'task');
    await manager.runAction('terminal', 'task');

    expect(manager.terminalCommands).toHaveLength(1);
  });

  it('uses the script shebang inside terminal runners', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'bash-bundle');
    const scriptsDir = path.join(bundleDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'task.sh'), '#!/bin/bash\nread -p "pick: " choice\necho "$choice"\n', 'utf-8');

    fs.writeFileSync(path.join(bundleDir, 'script-bundle.json'), JSON.stringify({
      id: 'bash-terminal',
      name: 'Bash Terminal Bundle',
      rootPath: './scripts',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            {
              id: 'task',
              name: 'Task',
              scriptPath: 'task.sh',
              executionMode: 'terminal',
              riskLevel: 'medium',
            },
          ],
        },
      ],
    }, null, 2), 'utf-8');

    const manager = new TestScriptBundleManager(dataDir);
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);

    await manager.runAction('bash-terminal', 'task');

    const runnerDir = path.join(dataDir, 'script-bundles', 'runners');
    const runnerFiles = fs.readdirSync(runnerDir);
    expect(runnerFiles).toHaveLength(1);
    const runnerContent = fs.readFileSync(path.join(runnerDir, runnerFiles[0]), 'utf-8');
    expect(runnerContent).toContain(`'/bin/bash' '${path.join(scriptsDir, 'task.sh')}'`);
    expect(runnerContent).not.toContain(`'/bin/zsh' '${path.join(scriptsDir, 'task.sh')}'`);
  });

  it('starts web terminal sessions with pty and forwards controls', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'web-terminal-bundle');
    const scriptsDir = path.join(bundleDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'task.sh'), '#!/bin/bash\necho web\n', 'utf-8');
    fs.writeFileSync(path.join(scriptsDir, 'second.sh'), '#!/bin/bash\necho second\n', 'utf-8');

    fs.writeFileSync(path.join(bundleDir, 'script-bundle.json'), JSON.stringify({
      id: 'web-terminal',
      name: 'Web Terminal Bundle',
      rootPath: './scripts',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            {
              id: 'task',
              name: 'Task',
              scriptPath: 'task.sh',
              executionMode: 'terminal',
              riskLevel: 'medium',
            },
            {
              id: 'second',
              name: 'Second',
              scriptPath: 'second.sh',
              executionMode: 'terminal',
              riskLevel: 'medium',
            },
          ],
        },
      ],
    }, null, 2), 'utf-8');

    const manager = new TestScriptBundleManager(dataDir);
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);

    const result = await manager.runActionInWebTerminal('web-terminal', 'task', 120, 32);

    expect(result.session.sessionId).toMatch(/^term-/);
    expect(manager.ptySpawns).toHaveLength(1);
    expect(manager.ptySpawns[0].file).toBe('/bin/bash');
    expect(manager.ptySpawns[0].args).toEqual([path.join(scriptsDir, 'task.sh')]);
    expect(manager.ptySpawns[0].options.cols).toBe(120);
    expect(manager.ptySpawns[0].options.rows).toBe(32);

    const secondResult = await manager.runActionInWebTerminal('web-terminal', 'second', 80, 20);
    expect(secondResult.session.sessionId).toBe(result.session.sessionId);
    expect(secondResult.session.actionId).toBe('task');
    expect(manager.ptySpawns).toHaveLength(1);

    expect(manager.writeTerminalInput(result.session.sessionId, '1\r')).toBe(true);
    expect(manager.ptySpawns[0].fake.writes).toEqual(['1\n']);

    expect(manager.resizeTerminalSession(result.session.sessionId, 90, 24)).toBe(true);
    expect(manager.ptySpawns[0].fake.resizes).toEqual([{ cols: 90, rows: 24 }]);

    expect(manager.killTerminalSession(result.session.sessionId)).toBe(true);
    expect(manager.ptySpawns[0].fake.killed).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 25));
  });

  it('runs background actions and records success, failure, and spawn errors', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'background-bundle');
    const scriptsDir = writeBundle(bundleDir, {
      id: 'background',
      name: 'Background Bundle',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            { id: 'task', name: 'Task', scriptPath: 'task.sh', executionMode: 'background' },
          ],
        },
      ],
    }, {
      'task.sh': '#!/usr/bin/env node\nconsole.log("ok")\n',
    });
    const broadcasts: any[] = [];
    const manager = new TestScriptBundleManager(dataDir, (message) => broadcasts.push(message));
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);

    const successChild = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(successChild as any);
    const started = await manager.runAction('background', 'task');
    successChild.stdout.write('hello\n');
    successChild.emit('close', 0);
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(started.message).toBe('Task 已在后台启动');
    expect(spawnMock).toHaveBeenCalledWith('/usr/bin/env', ['node', path.join(scriptsDir, 'task.sh')], expect.objectContaining({
      cwd: scriptsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    expect((await manager.getActionHistory('background', 'task'))[0]).toEqual(expect.objectContaining({
      status: 'succeeded',
      exitCode: 0,
      message: '执行完成',
    }));

    const failedChild = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(failedChild as any);
    await manager.runAction('background', 'task');
    failedChild.emit('close', 2);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect((await manager.getActionHistory('background', 'task'))[0]).toEqual(expect.objectContaining({
      status: 'failed',
      exitCode: 2,
      message: '执行失败，退出码 2',
    }));

    const errorChild = new FakeChildProcess();
    spawnMock.mockReturnValueOnce(errorChild as any);
    await manager.runAction('background', 'task');
    errorChild.emit('error', new Error('spawn denied'));
    await new Promise(resolve => setTimeout(resolve, 25));
    expect((await manager.getActionHistory('background', 'task'))[0]).toEqual(expect.objectContaining({
      status: 'failed',
      exitCode: null,
      message: 'spawn denied',
    }));
    expect(broadcasts.map((message) => message.status)).toEqual(expect.arrayContaining(['running', 'succeeded', 'failed']));
  });

  it('handles web terminal spawn failures and missing session controls', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'failing-web-terminal');
    writeBundle(bundleDir, {
      id: 'failing-terminal',
      name: 'Failing Terminal Bundle',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [{ id: 'task', name: 'Task', scriptPath: 'task.sh', executionMode: 'terminal' }],
        },
      ],
    }, {
      'task.sh': 'echo fallback\n',
    });
    const manager = new TestScriptBundleManager(dataDir);
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);
    manager.failPtyWith = new Error('pty unavailable');

    await expect(manager.runActionInWebTerminal('failing-terminal', 'task')).rejects.toThrow('pty unavailable');

    const history = await manager.getActionHistory('failing-terminal', 'task');
    expect(history[0]).toEqual(expect.objectContaining({
      status: 'failed',
      exitCode: null,
      message: 'pty unavailable',
    }));
    expect(manager.writeTerminalInput('missing', 'x')).toBe(false);
    expect(manager.resizeTerminalSession('missing', 100, 30)).toBe(false);
    expect(manager.killTerminalSession('missing')).toBe(false);
  });

  it('returns logs from explicit run ids and falls back when history or log files are unavailable', async () => {
    const manager = new ScriptBundleManager(dataDir);
    const historyDir = path.join(dataDir, 'script-bundles', 'history', 'tools');
    const logDir = path.join(dataDir, 'script-bundles', 'logs', 'tools');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'task-run-1.log');
    fs.writeFileSync(logFile, 'line 1\nline 2\n', 'utf-8');
    fs.writeFileSync(path.join(historyDir, 'task.json'), JSON.stringify([
      {
        runId: 'run-1',
        bundleId: 'tools',
        actionId: 'task',
        actionName: 'Task',
        startedAt: '2026-05-30T00:00:00.000Z',
        executionMode: 'background',
        status: 'succeeded',
        logFile,
      },
      {
        runId: 'run-2',
        bundleId: 'tools',
        actionId: 'task',
        actionName: 'Task',
        startedAt: '2026-05-30T00:01:00.000Z',
        executionMode: 'background',
        status: 'failed',
      },
    ], null, 2), 'utf-8');

    await expect(manager.getActionLog('tools', 'task', 'run-1')).resolves.toBe('line 1\nline 2\n');
    await expect(manager.getActionLog('tools', 'task', 'run-2')).resolves.toBe('暂无日志');
    await expect(manager.getActionLog('tools', 'task', 'missing')).resolves.toBe('暂无日志');

    fs.writeFileSync(path.join(historyDir, 'bad.json'), '{bad-json', 'utf-8');
    await expect(manager.getActionHistory('tools', 'bad')).resolves.toEqual([]);
  });

  it('resolves shell command fallbacks for non-shebang, env-only, and quoted shebang scripts', async () => {
    const bundleDir = path.join(tempDir, 'modules', 'shebang-bundle');
    const scriptsDir = writeBundle(bundleDir, {
      id: 'shebang',
      name: 'Shebang Bundle',
      groups: [
        {
          id: 'group-a',
          title: 'Group A',
          actions: [
            { id: 'plain', name: 'Plain', scriptPath: 'plain.sh', executionMode: 'terminal' },
            { id: 'envonly', name: 'Env Only', scriptPath: 'envonly.sh', executionMode: 'terminal' },
            { id: 'quoted', name: 'Quoted', scriptPath: 'quoted.sh', executionMode: 'terminal' },
          ],
        },
      ],
    }, {
      'plain.sh': 'echo no shebang\n',
      'envonly.sh': '#!/usr/bin/env\n',
      'quoted.sh': '#!/usr/bin/env "bash"\necho quoted\n',
    });
    const manager = new TestScriptBundleManager(dataDir);
    await manager.loadFromDirectories([path.join(tempDir, 'modules')]);

    await manager.runActionInWebTerminal('shebang', 'plain');
    manager.ptySpawns[0].fake.emitExit(0);
    await new Promise(resolve => setTimeout(resolve, 25));
    await manager.runActionInWebTerminal('shebang', 'envonly');
    manager.ptySpawns[1].fake.emitExit(0);
    await new Promise(resolve => setTimeout(resolve, 25));
    await manager.runActionInWebTerminal('shebang', 'quoted');
    manager.ptySpawns[2].fake.emitExit(0);
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(manager.ptySpawns[0].file).toBe('/bin/zsh');
    expect(manager.ptySpawns[0].args).toEqual([path.join(scriptsDir, 'plain.sh')]);
    expect(manager.ptySpawns[1].file).toBe('/bin/zsh');
    expect(manager.ptySpawns[2].file).toBe('/usr/bin/env');
    expect(manager.ptySpawns[2].args).toEqual(['bash', path.join(scriptsDir, 'quoted.sh')]);
  });
});

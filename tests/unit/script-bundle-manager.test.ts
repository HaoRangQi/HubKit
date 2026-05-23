import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScriptBundleManager } from '../../src/script-bundle/script-bundle-manager';

class TestScriptBundleManager extends ScriptBundleManager {
  terminalCommands: string[] = [];
  ptySpawns: Array<{ file: string; args: string[]; options: any; fake: FakePty }> = [];

  protected async openTerminalScript(command: string): Promise<void> {
    this.terminalCommands.push(command);
  }

  protected spawnPty(file: string, args: string[], options: any): any {
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
}

describe('ScriptBundleManager', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-bundle-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
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
});

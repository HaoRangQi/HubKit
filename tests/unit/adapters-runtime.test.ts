jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock('../../src/runtime/module-network', () => ({
  buildHealthCheckUrl: jest.fn(),
  listPortListeners: jest.fn(() => []),
  parseModulePort: jest.fn(() => null),
  requestHealthCheck: jest.fn(),
}));

jest.mock('../../src/runtime/log-tail', () => ({
  readLastLines: jest.fn(),
  readLastLinesText: jest.fn(),
}));

jest.mock('../../src/runtime/log-rotation', () => ({
  rotateLogIfNeeded: jest.fn(),
}));

import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promises as fsp } from 'fs';
import { BaseAdapter } from '../../src/adapters/base-adapter';
import { NodeJSAdapter } from '../../src/adapters/nodejs-adapter';
import { PythonAdapter } from '../../src/adapters/python-adapter';
import { ShellAdapter } from '../../src/adapters/shell-adapter';
import { config } from '../../src/config/config';
import { moduleRuntimeStateStore } from '../../src/runtime/module-runtime-state';
import { ModuleMetadata, ModuleStatus } from '../../src/types/module';
import * as moduleNetwork from '../../src/runtime/module-network';
import * as logTail from '../../src/runtime/log-tail';

const execSyncMock = execSync as jest.MockedFunction<typeof execSync>;
const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

class FakeChildProcess extends EventEmitter {
  pid?: number;
  unref = jest.fn();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

class TestAdapter extends BaseAdapter {
  constructor(metadata: ModuleMetadata) {
    super(metadata);
  }

  protected async buildStartCommand(): Promise<{ cmd: string; args: string[]; cwd?: string; env?: Record<string, string> }> {
    return { cmd: 'echo', args: ['ok'] };
  }

  exposeWritePid(pid: number): Promise<void> {
    return this.writePid(pid);
  }

  exposeReadPid(): Promise<number | null> {
    return this.readPid();
  }
}

class ExposedShellAdapter extends ShellAdapter {
  exposeBuildStartCommand() {
    return this.buildStartCommand();
  }
}

class ExposedPythonAdapter extends PythonAdapter {
  exposeBuildStartCommand() {
    return this.buildStartCommand();
  }
}

class ExposedNodeAdapter extends NodeJSAdapter {
  exposeBuildStartCommand() {
    return this.buildStartCommand();
  }
}

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-adapters-'));
  fs.mkdirSync(path.join(dir, '.hub', 'pids'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.hub', 'logs'), { recursive: true });
  return dir;
}

describe('adapter command builders', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    execSyncMock.mockReset();
  });

  afterEach(() => {
    process.chdir(cwd);
    jest.clearAllMocks();
  });

  it('builds shell commands from shebang and repairs missing execute permission', async () => {
    const workspace = createTempWorkspace();
    process.chdir(workspace);
    const scriptPath = path.join(workspace, 'run.sh');
    fs.writeFileSync(scriptPath, '#!/usr/bin/env zsh\necho ok\n', 'utf-8');
    await fsp.chmod(scriptPath, 0o644);
    const adapter = new ExposedShellAdapter(createModule({ scriptPath }));

    const command = await adapter.exposeBuildStartCommand();

    expect(command).toEqual({ cmd: 'zsh', args: [scriptPath], env: {} });
    expect((fs.statSync(scriptPath).mode & 0o111) > 0).toBe(true);
  });

  it('throws a clear error when shell execute permission cannot be repaired', async () => {
    const workspace = createTempWorkspace();
    process.chdir(workspace);
    const scriptPath = path.join(workspace, 'run.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho ok\n', 'utf-8');
    const chmodSpy = jest.spyOn(fsp, 'chmod').mockRejectedValueOnce(new Error('chmod denied'));
    const accessSpy = jest.spyOn(fsp, 'access').mockRejectedValueOnce(new Error('not executable'));
    const adapter = new ExposedShellAdapter(createModule({ scriptPath }));

    await expect(adapter.exposeBuildStartCommand()).rejects.toThrow('无法设置脚本执行权限: chmod denied');

    chmodSpy.mockRestore();
    accessSpy.mockRestore();
  });

  it('uses python virtualenv when present and falls back to python when python3 is unavailable', async () => {
    const workspace = createTempWorkspace();
    process.chdir(workspace);
    const scriptPath = path.join(workspace, 'app.py');
    const venvPython = path.join(workspace, '.venv', 'bin', 'python');
    fs.mkdirSync(path.dirname(venvPython), { recursive: true });
    fs.writeFileSync(venvPython, '', 'utf-8');
    const adapter = new ExposedPythonAdapter(createModule({ type: 'python', scriptPath }));

    await expect(adapter.exposeBuildStartCommand()).resolves.toEqual({
      cmd: venvPython,
      args: [scriptPath],
      env: { PYTHONUNBUFFERED: '1' },
    });

    fs.rmSync(path.join(workspace, '.venv'), { recursive: true, force: true });
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('python3 missing');
    });

    await expect(adapter.exposeBuildStartCommand()).resolves.toEqual({
      cmd: 'python',
      args: [scriptPath],
      env: { PYTHONUNBUFFERED: '1' },
    });
  });

  it('builds Node.js commands from startScript, package start script, or direct node execution', async () => {
    const workspace = createTempWorkspace();
    process.chdir(workspace);
    const moduleDir = path.join(workspace, 'node-module');
    fs.mkdirSync(moduleDir, { recursive: true });
    const scriptPath = path.join(moduleDir, 'index.js');
    fs.writeFileSync(scriptPath, 'console.log("ok")\n', 'utf-8');

    await expect(new ExposedNodeAdapter(createModule({
      type: 'nodejs',
      scriptPath,
      startScript: 'dev',
    })).exposeBuildStartCommand()).resolves.toEqual({
      cmd: 'npm',
      args: ['run', 'dev'],
      cwd: moduleDir,
      env: { NODE_ENV: 'development' },
    });

    fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }), 'utf-8');
    await expect(new ExposedNodeAdapter(createModule({ type: 'nodejs', scriptPath })).exposeBuildStartCommand()).resolves.toEqual({
      cmd: 'npm',
      args: ['start'],
      cwd: moduleDir,
      env: { NODE_ENV: 'production' },
    });

    fs.unlinkSync(path.join(moduleDir, 'package.json'));
    await expect(new ExposedNodeAdapter(createModule({ type: 'nodejs', scriptPath })).exposeBuildStartCommand()).resolves.toEqual({
      cmd: 'node',
      args: [scriptPath],
      cwd: moduleDir,
      env: { NODE_ENV: 'production' },
    });
  });
});

describe('BaseAdapter runtime behavior', () => {
  let cwd: string;
  let killSpy: jest.SpyInstance;
  let getSettingsSpy: jest.SpyInstance;

  beforeEach(() => {
    cwd = process.cwd();
    const workspace = createTempWorkspace();
    process.chdir(workspace);
    killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);
    getSettingsSpy = jest.spyOn(config, 'getSettings').mockReturnValue({
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: {},
      startPolicies: {
        demo: {
          retryCount: 0,
          retryDelayMs: 500,
          healthCheckEnabled: true,
          healthCheckTimeoutMs: 2000,
          preflightChecksEnabled: true,
          blockOnPortConflict: true,
        },
      },
      groupStartPolicyTemplates: {},
      workspaces: [],
      workspaceHistory: [],
      workspaceHistoryLimit: 20,
    });
    execSyncMock.mockReset();
    spawnMock.mockReset();
    jest.mocked(moduleNetwork.buildHealthCheckUrl).mockReturnValue(null);
    jest.mocked(moduleNetwork.listPortListeners).mockReturnValue([]);
    jest.mocked(moduleNetwork.parseModulePort).mockReturnValue(null);
    jest.mocked(moduleNetwork.requestHealthCheck).mockResolvedValue({ ok: true, status: 200, message: 'HTTP 200' });
    jest.mocked(logTail.readLastLines).mockResolvedValue(['first', 'second']);
    jest.mocked(logTail.readLastLinesText).mockResolvedValue('raw logs');
    moduleRuntimeStateStore.reset('demo');
  });

  afterEach(() => {
    getSettingsSpy.mockRestore();
    killSpy.mockRestore();
    process.chdir(cwd);
    jest.clearAllMocks();
  });

  it('reports stopped when no pid file exists and running with uptime when pid is alive', async () => {
    const adapter = new TestAdapter(createModule());

    await expect(adapter.status()).resolves.toEqual({ status: ModuleStatus.STOPPED });

    await adapter.exposeWritePid(1234);
    execSyncMock.mockReturnValueOnce('42\n' as any);

    const status = await adapter.status();

    expect(status).toEqual(expect.objectContaining({
      status: ModuleStatus.RUNNING,
      pid: 1234,
      uptime: 42,
      startedAt: expect.any(Date),
    }));
  });

  it('cleans up stale pid files and marks a running runtime state as failed', async () => {
    const adapter = new TestAdapter(createModule());
    moduleRuntimeStateStore.setPhase('demo', 'running', 'running', {
      lastStartRecord: {
        startedAt: '2026-05-30T00:00:00.000Z',
        outcome: 'succeeded',
        attemptCount: 1,
        summary: 'started',
      },
    });
    await adapter.exposeWritePid(1234);
    killSpy.mockImplementationOnce((() => {
      throw new Error('not running');
    }) as any);

    await expect(adapter.status()).resolves.toEqual({ status: ModuleStatus.STOPPED });

    await expect(adapter.exposeReadPid()).resolves.toBeNull();
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'failed',
      failure: expect.objectContaining({ code: 'process_exited', retryable: true }),
    }));
  });

  it('treats an already running module start as idempotent', async () => {
    const adapter = new TestAdapter(createModule());
    await adapter.exposeWritePid(1234);
    execSyncMock.mockReturnValueOnce('42\n' as any);

    await expect(adapter.start()).resolves.toBe(true);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'running',
      summary: '模块已在运行',
      attempt: 0,
    }));
  });

  it('starts a process, writes the pid, and records a successful runtime state', async () => {
    const child = new FakeChildProcess(2468);
    spawnMock.mockImplementation((() => {
      setImmediate(() => child.emit('spawn'));
      return child;
    }) as any);
    const adapter = new TestAdapter(createModule());

    await expect(adapter.start()).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledWith('echo', ['ok'], expect.objectContaining({
      detached: true,
      stdio: expect.arrayContaining(['ignore']),
    }));
    await expect(adapter.exposeReadPid()).resolves.toBe(2468);
    expect(child.unref).toHaveBeenCalled();
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'running',
      summary: '模块已启动',
      lastStartRecord: expect.objectContaining({
        outcome: 'succeeded',
        attemptCount: 1,
      }),
    }));
    await adapter.stop(true);
  });

  it('blocks start when preflight detects an occupied module port', async () => {
    jest.mocked(moduleNetwork.parseModulePort).mockReturnValue(3000);
    jest.mocked(moduleNetwork.listPortListeners).mockReturnValue([
      { pid: 4321, command: 'node server.js', alive: true },
    ]);
    const adapter = new TestAdapter(createModule({ webPort: 3000 }));

    await expect(adapter.start()).rejects.toThrow('启动失败: 端口 3000 已被占用');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'failed',
      failure: expect.objectContaining({
        code: 'port_3000_occupied',
        source: 'preflight',
        retryable: false,
      }),
    }));
  });

  it('surfaces spawn errors as failed runtime state and cleans up pid/log handles', async () => {
    const child = new FakeChildProcess();
    spawnMock.mockImplementation((() => {
      setImmediate(() => child.emit('error', new Error('spawn denied')));
      return child;
    }) as any);
    const adapter = new TestAdapter(createModule());

    await expect(adapter.start()).rejects.toThrow('启动失败: 进程创建失败（spawn denied）');

    await expect(adapter.exposeReadPid()).resolves.toBeNull();
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'failed',
      failure: expect.objectContaining({
        code: 'spawn_error',
        source: 'process',
        details: 'spawn denied',
      }),
    }));
  });

  it('retries retryable start failures and succeeds on a later attempt', async () => {
    getSettingsSpy.mockReturnValue({
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: {},
      startPolicies: {
        demo: {
          retryCount: 1,
          retryDelayMs: 500,
          healthCheckEnabled: false,
          healthCheckTimeoutMs: 2000,
          preflightChecksEnabled: true,
          blockOnPortConflict: true,
        },
      },
      groupStartPolicyTemplates: {},
      workspaces: [],
      workspaceHistory: [],
      workspaceHistoryLimit: 20,
    });
    const first = new FakeChildProcess();
    const second = new FakeChildProcess(9753);
    spawnMock
      .mockImplementationOnce((() => {
        setImmediate(() => first.emit('error', new Error('temporary')));
        return first;
      }) as any)
      .mockImplementationOnce((() => {
        setImmediate(() => second.emit('spawn'));
        return second;
      }) as any);
    const adapter = new TestAdapter(createModule());

    await expect(adapter.start()).resolves.toBe(true);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    await expect(adapter.exposeReadPid()).resolves.toBe(9753);
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'running',
      attempt: 2,
      lastStartRecord: expect.objectContaining({ attemptCount: 2, outcome: 'succeeded' }),
    }));
    await adapter.stop(true);
  });

  it('fails when a spawned process exits before the post-start stability check', async () => {
    const child = new FakeChildProcess(1357);
    spawnMock.mockImplementation((() => {
      setImmediate(() => child.emit('spawn'));
      return child;
    }) as any);
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === 1357 && signal === 0) {
        throw new Error('exited');
      }
      return true;
    }) as any);
    const adapter = new TestAdapter(createModule());

    await expect(adapter.start()).rejects.toThrow('启动失败: 进程启动后立即退出');

    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'failed',
      failure: expect.objectContaining({
        code: 'process_exit_early',
        retryable: true,
      }),
    }));
  });

  it('runs post-start health checks and records healthy details', async () => {
    getSettingsSpy.mockReturnValue({
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: {},
      startPolicies: {
        demo: {
          retryCount: 0,
          retryDelayMs: 500,
          healthCheckEnabled: true,
          healthCheckTimeoutMs: 2000,
          preflightChecksEnabled: true,
          blockOnPortConflict: true,
        },
      },
      groupStartPolicyTemplates: {},
      workspaces: [],
      workspaceHistory: [],
      workspaceHistoryLimit: 20,
    });
    jest.mocked(moduleNetwork.buildHealthCheckUrl).mockReturnValue('http://127.0.0.1:3000/health');
    jest.mocked(moduleNetwork.requestHealthCheck).mockResolvedValueOnce({ ok: true, status: 200, message: 'HTTP 200' });
    const child = new FakeChildProcess(8642);
    spawnMock.mockImplementation((() => {
      setImmediate(() => child.emit('spawn'));
      return child;
    }) as any);
    const adapter = new TestAdapter(createModule({ webPort: 3000 }));

    await expect(adapter.start()).resolves.toBe(true);

    expect(moduleNetwork.requestHealthCheck).toHaveBeenCalledWith('http://127.0.0.1:3000/health', expect.any(Number));
    expect(adapter.getRuntimeState()).toEqual(expect.objectContaining({
      phase: 'running',
      health: expect.objectContaining({
        state: 'healthy',
        details: 'http://127.0.0.1:3000/health · HTTP 200',
      }),
    }));
    await adapter.stop(true);
  });

  it('stops idempotently, handles ESRCH cleanup, and surfaces other kill failures', async () => {
    const adapter = new TestAdapter(createModule());

    await expect(adapter.stop()).resolves.toBe(true);

    await adapter.exposeWritePid(1234);
    killSpy.mockImplementationOnce((() => {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }) as any);
    await expect(adapter.stop(true)).resolves.toBe(true);
    await expect(adapter.exposeReadPid()).resolves.toBeNull();

    await adapter.exposeWritePid(5678);
    killSpy.mockImplementationOnce((() => {
      throw new Error('permission denied');
    }) as any);
    await expect(adapter.stop(true)).rejects.toThrow('停止失败: permission denied');
  });

  it('returns default settings, parsed logs, raw logs, and failed setSetting result', async () => {
    const adapter = new TestAdapter(createModule());

    await expect(adapter.getSettings()).resolves.toEqual([]);
    await expect(adapter.setSetting('key', 'value')).resolves.toBe(false);
    await expect(adapter.logs(2)).resolves.toEqual([
      { timestamp: expect.any(Date), level: 'info', message: 'first' },
      { timestamp: expect.any(Date), level: 'info', message: 'second' },
    ]);
    await expect(adapter.rawLogs(2)).resolves.toBe('raw logs');
  });

  it('reports readiness blocked by alive port listeners', async () => {
    jest.mocked(moduleNetwork.parseModulePort).mockReturnValue(3000);
    jest.mocked(moduleNetwork.listPortListeners).mockReturnValue([
      { pid: 4321, command: 'node server.js', alive: true },
    ]);
    const adapter = new TestAdapter(createModule({ webPort: 3000 }));

    await expect(adapter.inspectStartReadiness()).resolves.toEqual({
      ready: false,
      actionLabel: '排查端口后启动',
      summary: '检测到端口 3000 已被占用',
      details: '监听进程：node server.js（PID 4321）',
    });
  });

  it('probes health for stopped modules, unconfigured checks, healthy checks, and unhealthy checks', async () => {
    const adapter = new TestAdapter(createModule({ webPort: 3000 }));

    await expect(adapter.probeHealth()).resolves.toEqual(expect.objectContaining({
      state: 'unknown',
      summary: '未运行',
    }));

    await adapter.exposeWritePid(1234);
    await expect(adapter.probeHealth()).resolves.toEqual(expect.objectContaining({
      state: 'unknown',
      summary: '未配置健康检查',
    }));

    jest.mocked(moduleNetwork.buildHealthCheckUrl).mockReturnValue('http://127.0.0.1:3000/');
    jest.mocked(moduleNetwork.requestHealthCheck).mockResolvedValueOnce({ ok: true, status: 200, message: 'HTTP 200' });
    await expect(adapter.probeHealth()).resolves.toEqual(expect.objectContaining({
      state: 'healthy',
      summary: '健康检查通过',
      details: 'http://127.0.0.1:3000/ · HTTP 200',
    }));

    jest.mocked(moduleNetwork.requestHealthCheck).mockResolvedValueOnce({ ok: false, status: 500, message: 'HTTP 500' });
    await expect(adapter.probeHealth()).resolves.toEqual(expect.objectContaining({
      state: 'unhealthy',
      summary: '健康检查异常',
      details: 'http://127.0.0.1:3000/ · HTTP 500',
    }));
  });
});

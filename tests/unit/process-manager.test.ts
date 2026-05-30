import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChildProcess } from 'child_process';
import { ProcessManager } from '../../src/process/process-manager';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-process-manager-'));
}

function createChildProcess(pid?: number): ChildProcess {
  return { pid } as ChildProcess;
}

function readPersistedProcesses(dataDir: string): any[] {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'processes.json'), 'utf-8'));
}

describe('ProcessManager', () => {
  let killSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    killSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('registers a process and persists serializable metadata', () => {
    const dataDir = createTempDir();
    const manager = new ProcessManager(dataDir);

    manager.register('demo', createChildProcess(1234));

    expect(manager.get('demo')).toEqual(expect.objectContaining({
      pid: 1234,
      moduleId: 'demo',
      process: expect.objectContaining({ pid: 1234 }),
    }));
    expect(manager.list()).toHaveLength(1);
    expect(readPersistedProcesses(dataDir)).toEqual([
      expect.objectContaining({
        pid: 1234,
        moduleId: 'demo',
        startedAt: expect.any(String),
      }),
    ]);
  });

  it('rejects child processes without a pid', () => {
    const manager = new ProcessManager(createTempDir());

    expect(() => manager.register('demo', createChildProcess(undefined))).toThrow('Process has no PID');
  });

  it('loads only still-running persisted processes', () => {
    const dataDir = createTempDir();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'processes.json'), JSON.stringify([
      { pid: 1234, moduleId: 'alive', startedAt: '2026-05-30T00:00:00.000Z' },
      { pid: 5678, moduleId: 'dead', startedAt: '2026-05-30T00:00:00.000Z' },
    ]), 'utf-8');
    killSpy.mockImplementation(((pid: number) => {
      if (pid === 5678) throw new Error('missing process');
      return true;
    }) as any);

    const manager = new ProcessManager(dataDir);

    expect(manager.get('alive')).toEqual(expect.objectContaining({ pid: 1234, moduleId: 'alive' }));
    expect(manager.get('dead')).toBeUndefined();
  });

  it('removes stale records when a tracked process is no longer running', () => {
    const dataDir = createTempDir();
    const manager = new ProcessManager(dataDir);
    manager.register('demo', createChildProcess(1234));
    killSpy.mockImplementationOnce((() => {
      throw new Error('missing process');
    }) as any);

    expect(manager.isRunning('demo')).toBe(false);
    expect(manager.get('demo')).toBeUndefined();
    expect(readPersistedProcesses(dataDir)).toEqual([]);
  });

  it('stops tracked processes with the requested signal and unregisters them', () => {
    const dataDir = createTempDir();
    const manager = new ProcessManager(dataDir);
    manager.register('demo', createChildProcess(1234));

    expect(manager.stop('demo', true)).toBe(true);

    expect(killSpy).toHaveBeenLastCalledWith(1234, 'SIGKILL');
    expect(manager.get('demo')).toBeUndefined();
    expect(readPersistedProcesses(dataDir)).toEqual([]);
  });

  it('keeps the record when process termination fails', () => {
    const manager = new ProcessManager(createTempDir());
    manager.register('demo', createChildProcess(1234));
    killSpy.mockImplementationOnce((() => {
      throw new Error('permission denied');
    }) as any);

    expect(manager.stop('demo')).toBe(false);
    expect(manager.get('demo')).toEqual(expect.objectContaining({ pid: 1234 }));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('cleans up every tracked process', () => {
    const manager = new ProcessManager(createTempDir());
    manager.register('one', createChildProcess(1111));
    manager.register('two', createChildProcess(2222));

    manager.cleanup();

    expect(killSpy).toHaveBeenCalledWith(1111, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(2222, 'SIGTERM');
    expect(manager.list()).toEqual([]);
  });

  it('starts empty when persisted process metadata is unreadable', () => {
    const dataDir = createTempDir();
    fs.writeFileSync(path.join(dataDir, 'processes.json'), '{not-json', 'utf-8');

    const manager = new ProcessManager(dataDir);

    expect(manager.list()).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});

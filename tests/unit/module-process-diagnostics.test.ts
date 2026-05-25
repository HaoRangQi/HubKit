import {
  collectModuleProcessDiagnostics,
  forceKillProcesses,
  readPidFromFile,
} from '../../src/runtime/module-process-diagnostics';
import * as moduleNetwork from '../../src/runtime/module-network';

jest.mock('../../src/runtime/module-network', () => ({
  commandForPid: jest.fn((pid: number) => `cmd-${pid}`),
  isPidAlive: jest.fn(() => true),
  listPortListeners: jest.fn(() => []),
  parseModulePort: jest.fn(() => null),
}));

describe('module process diagnostics', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('collects status pid and port listeners through runtime network helpers', async () => {
    jest.mocked(moduleNetwork.parseModulePort).mockReturnValue(3000);
    jest.mocked(moduleNetwork.listPortListeners).mockReturnValue([
      { pid: 42, command: 'server', alive: true },
    ]);

    const diagnostics = await collectModuleProcessDiagnostics({ id: 'demo', webPort: 3000 }, 123);

    expect(diagnostics.pidFromStatus).toBe(123);
    expect(diagnostics.pidCandidates).toEqual([{ pid: 123, command: 'cmd-123', alive: true }]);
    expect(diagnostics.port).toBe(3000);
    expect(diagnostics.portOccupied).toBe(true);
    expect(diagnostics.portListeners).toEqual([{ pid: 42, command: 'server', alive: true }]);
  });

  it('ignores missing pid files', async () => {
    await expect(readPidFromFile('missing-module')).resolves.toBeNull();
  });

  it('treats already missing processes as killed', async () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation((() => {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }) as any);

    await expect(forceKillProcesses([999])).resolves.toEqual([
      { pid: 999, killed: true, signal: 'NONE' },
    ]);

    killSpy.mockRestore();
  });
});

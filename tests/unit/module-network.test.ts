import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import http from 'http';
import https from 'https';
import {
  buildHealthCheckUrl,
  commandForPid,
  isPidAlive,
  listPortListeners,
  parseModulePort,
  requestHealthCheck,
} from '../../src/runtime/module-network';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));
jest.mock('http', () => ({
  request: jest.fn(),
}));
jest.mock('https', () => ({
  request: jest.fn(),
}));

const execSyncMock = execSync as jest.MockedFunction<typeof execSync>;
const httpRequestMock = http.request as jest.MockedFunction<typeof http.request>;
const httpsRequestMock = https.request as jest.MockedFunction<typeof https.request>;

function createRequestMock(onRequest: (request: EventEmitter & { end: jest.Mock; destroy: jest.Mock }) => void) {
  return jest.fn((_url: URL, _options: any, callback: (response: EventEmitter & { statusCode?: number; resume: jest.Mock }) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: jest.Mock; destroy: jest.Mock };
    request.end = jest.fn(() => onRequest(request));
    request.destroy = jest.fn((error?: Error) => {
      if (error) request.emit('error', error);
    });
    (request as any).respond = (statusCode: number) => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number; resume: jest.Mock };
      response.statusCode = statusCode;
      response.resume = jest.fn();
      callback(response);
    };
    return request;
  });
}

describe('module-network', () => {
  let killSpy: jest.SpyInstance;

  beforeEach(() => {
    killSpy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);
    execSyncMock.mockReset();
    httpRequestMock.mockReset();
    httpsRequestMock.mockReset();
  });

  afterEach(() => {
    killSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('parses ports from explicit webPort before webUrl', () => {
    expect(parseModulePort({ webPort: 3000, webUrl: 'http://127.0.0.1:4000' })).toBe(3000);
    expect(parseModulePort({ webPort: 0, webUrl: 'http://127.0.0.1:4000/path' })).toBe(4000);
    expect(parseModulePort({ webPort: 70000, webUrl: 'not a url' })).toBeNull();
  });

  it('builds health check URLs from explicit URLs or parsed ports', () => {
    expect(buildHealthCheckUrl({ webUrl: 'http://localhost:3000' })).toBe('http://localhost:3000/');
    expect(buildHealthCheckUrl({ webUrl: 'http://localhost:3000/health' })).toBe('http://localhost:3000/health');
    expect(buildHealthCheckUrl({ webPort: 4567 })).toBe('http://127.0.0.1:4567/');
    expect(buildHealthCheckUrl({ webUrl: 'bad url' })).toBeNull();
  });

  it('treats EPERM as alive when probing pids', () => {
    expect(isPidAlive(123)).toBe(true);
    killSpy.mockImplementationOnce((() => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    }) as any);
    expect(isPidAlive(456)).toBe(true);
    killSpy.mockImplementationOnce((() => {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }) as any);
    expect(isPidAlive(789)).toBe(false);
  });

  it('reads process commands and returns unknown on ps failures', () => {
    execSyncMock.mockReturnValueOnce('node server.js\n' as any);
    expect(commandForPid(123)).toBe('node server.js');

    execSyncMock.mockImplementationOnce(() => {
      throw new Error('ps failed');
    });
    expect(commandForPid(456)).toBe('unknown');
  });

  it('lists unique alive port listener pids', () => {
    execSyncMock
      .mockReturnValueOnce('111\n222\n111\nnot-a-pid\n' as any)
      .mockReturnValueOnce('node api\n' as any)
      .mockReturnValueOnce('python worker\n' as any);

    expect(listPortListeners(3000)).toEqual([
      { pid: 111, command: 'node api', alive: true },
      { pid: 222, command: 'python worker', alive: true },
    ]);
  });

  it('returns empty listener list when lsof fails', () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error('lsof missing');
    });

    expect(listPortListeners(3000)).toEqual([]);
  });

  it('performs HTTP health checks and maps status codes', async () => {
    httpRequestMock.mockImplementation(createRequestMock((request: any) => {
      request.respond(204);
    }) as any);

    await expect(requestHealthCheck('http://localhost:3000/health', 1000)).resolves.toEqual({
      ok: true,
      status: 204,
      message: 'HTTP 204',
    });
    expect(httpRequestMock).toHaveBeenCalledWith(
      new URL('http://localhost:3000/health'),
      { method: 'GET', timeout: 1000 },
      expect.any(Function)
    );
  });

  it('performs HTTPS health checks and reports client errors', async () => {
    httpsRequestMock.mockImplementation(createRequestMock((request) => {
      request.emit('error', new Error('connection refused'));
    }) as any);

    await expect(requestHealthCheck('https://localhost:3443/health', 1000)).resolves.toEqual({
      ok: false,
      message: 'connection refused',
    });
  });

  it('rejects invalid health check URLs without issuing a request', async () => {
    await expect(requestHealthCheck('not a url', 1000)).resolves.toEqual({
      ok: false,
      message: '健康检查地址无效',
    });
    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});

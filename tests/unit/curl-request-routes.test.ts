import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createCurlRequestRouter } from '../../src/web/api/curl-request-routes';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const spawnMock = spawn as unknown as jest.Mock;

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

function createMockChild({
  stdout = '',
  stderr = '',
  exitCode = 0,
}: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();

  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout, 'utf-8'));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr, 'utf-8'));
    child.emit('close', exitCode);
  });

  return child;
}

async function requestCurlRoute(body: unknown): Promise<{ statusCode: number; jsonBody: any }> {
  const router = createCurlRequestRouter() as any;
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: 'POST',
      url: '/curl-requests/site-a/run',
      originalUrl: '/curl-requests/site-a/run',
      params: { siteId: 'site-a' },
      body,
      headers: {},
      get: () => undefined,
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(jsonBody: any) {
        resolve({ statusCode, jsonBody });
        return this;
      },
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };

    router.handle(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ statusCode: 404, jsonBody: undefined });
    });
  });
}

describe('curl request routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts curl request routes from the main API router', () => {
    const routesSource = readSource('src/web/api/routes.ts');
    const curlRouteSource = readSource('src/web/api/curl-request-routes.ts');

    expect(routesSource).toContain("import { createCurlRequestRouter } from './curl-request-routes'");
    expect(routesSource).toContain('router.use(createCurlRequestRouter())');
    expect(curlRouteSource).toContain('export function createCurlRequestRouter()');
    expect(curlRouteSource).toContain("router.post('/curl-requests/:siteId/run'");
  });

  it('rejects non-curl commands before spawning a process', async () => {
    const result = await requestCurlRoute({ command: 'echo hello' });

    expect(result.statusCode).toBe(400);
    expect(result.jsonBody).toEqual({ success: false, error: '仅支持以 curl 开头的命令' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('runs curl command and returns command output', async () => {
    spawnMock.mockImplementation(() => createMockChild({
      stdout: '{"ok":true}\n',
      stderr: '',
      exitCode: 0,
    }));

    const result = await requestCurlRoute({
      command: 'curl -s "https://example.com/api?q=hubkit"',
      timeoutMs: 5000,
    });

    expect(result.statusCode).toBe(200);
    expect(result.jsonBody.success).toBe(true);
    expect(result.jsonBody.data.siteId).toBe('site-a');
    expect(result.jsonBody.data.exitCode).toBe(0);
    expect(result.jsonBody.data.stdout).toContain('"ok":true');
    expect(result.jsonBody.data.timeoutMs).toBe(5000);
    expect(spawnMock).toHaveBeenCalledWith(
      'curl',
      ['-s', 'https://example.com/api?q=hubkit'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('returns failed result when curl exits with non-zero code', async () => {
    spawnMock.mockImplementation(() => createMockChild({
      stdout: '',
      stderr: 'connection failed',
      exitCode: 28,
    }));

    const result = await requestCurlRoute({
      command: 'curl -s https://example.com',
      timeoutMs: 10000,
    });

    expect(result.statusCode).toBe(500);
    expect(result.jsonBody.success).toBe(false);
    expect(result.jsonBody.data.exitCode).toBe(28);
    expect(result.jsonBody.data.stderr).toContain('connection failed');
  });
});

import { WebSocketServer } from 'ws';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';
import { createApiRouter } from '../../src/web/api/routes';

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo Module',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

async function requestApiRouter(
  registry: ModuleRegistry,
  lifecycle: { stop: jest.Mock },
  method: string,
  pathname: string,
  body: unknown = {}
): Promise<{ status: number; body: any }> {
  const router = createApiRouter(
    registry,
    { clients: new Set() } as unknown as WebSocketServer,
    undefined,
    undefined,
    undefined,
    lifecycle as any
  ) as any;

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url: pathname,
      originalUrl: pathname,
      headers: {},
      body,
      get: jest.fn(() => undefined),
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(responseBody: any) {
        resolve({ status: statusCode, body: responseBody });
        return this;
      },
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };

    router.handle(req as any, res as any, (error?: any) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ status: 404, body: undefined });
    });
  });
}

describe('api high-risk boundaries', () => {
  it('rejects force=true on the ordinary module stop route before lifecycle stop runs', async () => {
    const registry = new ModuleRegistry();
    const lifecycle = {
      stop: jest.fn(),
    };
    registry.register(createModule());

    const response = await requestApiRouter(
      registry,
      lifecycle,
      'POST',
      '/modules/demo/stop',
      { force: true }
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: '强制停止请使用强制关闭接口',
    });
    expect(lifecycle.stop).not.toHaveBeenCalled();
  });
});

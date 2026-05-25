import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata, ModuleStatus } from '../../src/types/module';
import { createModuleAdminRouter } from '../../src/web/api/module-admin-routes';
import { highRiskConfirmationStore } from '../../src/web/api/high-risk-confirmation';
import { createModuleAdapter } from '../../src/adapters/adapter-factory';
import {
  collectModuleProcessDiagnostics,
  forceKillProcesses,
} from '../../src/runtime/module-process-diagnostics';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../src/adapters/adapter-factory', () => ({
  createModuleAdapter: jest.fn(),
}));

jest.mock('../../src/runtime/module-process-diagnostics', () => ({
  collectModuleProcessDiagnostics: jest.fn(),
  forceKillProcesses: jest.fn(),
}));

const createAdapterMock = createModuleAdapter as jest.MockedFunction<typeof createModuleAdapter>;
const collectDiagnosticsMock = collectModuleProcessDiagnostics as jest.MockedFunction<typeof collectModuleProcessDiagnostics>;
const forceKillProcessesMock = forceKillProcesses as jest.MockedFunction<typeof forceKillProcesses>;

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

function createDiagnostics(overrides: Partial<Awaited<ReturnType<typeof collectModuleProcessDiagnostics>>> = {}) {
  return {
    pidFromStatus: null,
    pidFromPidFile: null,
    pidCandidates: [],
    port: null,
    portOccupied: false,
    portListeners: [],
    checkedAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

function highRiskHeaders(action: string): Record<string, string> {
  return {
    'x-hubkit-high-risk-confirmation': action,
    'x-hubkit-high-risk-token': highRiskConfirmationStore.issue(action).token,
  };
}

async function requestRouter(
  registry: ModuleRegistry,
  method: string,
  pathname: string,
  broadcast = jest.fn(),
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; broadcast: jest.Mock }> {
  const router = createModuleAdminRouter({ registry, broadcast });
  const url = pathname.startsWith('/api') ? pathname.slice('/api'.length) || '/' : pathname;

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url,
      originalUrl: pathname,
      headers,
      body: {},
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        resolve({ status: statusCode, body, broadcast });
        return this;
      },
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };

    (router as any).handle(req as any, res as any, (error?: any) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ status: 404, body: undefined, broadcast });
    });
  });
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

describe('module admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts module admin routes from the main API router', () => {
    const routesSource = readSource('src/web/api/routes.ts');
    const adminSource = readSource('src/web/api/module-admin-routes.ts');

    expect(routesSource).toContain("import { createModuleAdminRouter } from './module-admin-routes'");
    expect(routesSource).toContain('router.use(createModuleAdminRouter({ registry, broadcast: (message) => broadcast(wss, message) }))');
    expect(routesSource).not.toContain("router.get('/modules/:id/diagnostics'");
    expect(routesSource).not.toContain("router.post('/modules/:id/force-close'");
    expect(routesSource).not.toContain("router.post('/modules/force-close-all'");
    expect(adminSource).toContain("router.get('/modules/:id/diagnostics'");
    expect(adminSource).toContain("'/modules/:id/force-close'");
    expect(adminSource).toContain("'/modules/force-close-all'");
    expect(adminSource).toContain("requireHighRiskConfirmation((req) => `module:${req.params.id}:force-close`)");
    expect(adminSource).toContain("requireHighRiskConfirmation('module:*:force-close-all')");
  });

  it('returns module process diagnostics with the existing response shape', async () => {
    const registry = new ModuleRegistry();
    const module = createModule();
    const diagnostics = createDiagnostics({
      pidFromStatus: 123,
      pidCandidates: [{ pid: 123, command: 'demo', alive: true }],
      port: 3000,
    });
    const adapter = {
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.RUNNING, pid: 123 }),
    };

    registry.register(module);
    createAdapterMock.mockReturnValue(adapter as any);
    collectDiagnosticsMock.mockResolvedValue(diagnostics);

    const response = await requestRouter(registry, 'GET', '/api/modules/demo/diagnostics');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        moduleId: 'demo',
        status: ModuleStatus.RUNNING,
        diagnostics,
      },
    });
    expect(createAdapterMock).toHaveBeenCalledWith(module);
    expect(collectDiagnosticsMock).toHaveBeenCalledWith(module, 123);
  });

  it('keeps the not-found response for module-specific admin routes', async () => {
    const response = await requestRouter(new ModuleRegistry(), 'GET', '/api/modules/missing/diagnostics');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: '模块不存在' });
    expect(createAdapterMock).not.toHaveBeenCalled();
  });

  it('force closes a module and broadcasts the existing event payload', async () => {
    const registry = new ModuleRegistry();
    const module = createModule();
    const before = createDiagnostics({
      pidCandidates: [{ pid: 222, command: 'old-demo', alive: true }],
      portListeners: [{ pid: 333, command: 'listener', alive: true }],
      port: 3000,
      portOccupied: true,
    });
    const after = createDiagnostics({ port: 3000 });
    const killed = [
      { pid: 222, killed: true, signal: 'SIGTERM' },
      { pid: 333, killed: true, signal: 'SIGTERM' },
    ];
    const adapter = {
      stop: jest.fn().mockResolvedValue(true),
    };
    const broadcast = jest.fn();

    registry.register(module);
    createAdapterMock.mockReturnValue(adapter as any);
    collectDiagnosticsMock.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    forceKillProcessesMock.mockResolvedValue(killed);

    const response = await requestRouter(
      registry,
      'POST',
      '/api/modules/demo/force-close',
      broadcast,
      highRiskHeaders('module:demo:force-close')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: '模块 Demo Module 已强制关闭',
      data: {
        moduleId: 'demo',
        adapterStopError: null,
        killed,
        before,
        after,
      },
    });
    expect(adapter.stop).toHaveBeenCalledWith(true);
    expect(forceKillProcessesMock).toHaveBeenCalledWith([222, 333]);
    expect(broadcast).toHaveBeenCalledWith({ type: 'module_stopped', moduleId: 'demo', forceClosed: true });
  });

  it('force closes all modules and keeps the aggregate response shape', async () => {
    const registry = new ModuleRegistry();
    const module = createModule();
    const before = createDiagnostics({
      portListeners: [{ pid: 444, command: 'listener', alive: true }],
      port: 3000,
      portOccupied: true,
    });
    const after = createDiagnostics({ port: 3000 });
    const killed = [{ pid: 444, killed: true, signal: 'SIGTERM' }];
    const adapter = {
      stop: jest.fn().mockResolvedValue(true),
    };
    const broadcast = jest.fn();

    registry.register(module);
    createAdapterMock.mockReturnValue(adapter as any);
    collectDiagnosticsMock.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    forceKillProcessesMock.mockResolvedValue(killed);

    const response = await requestRouter(
      registry,
      'POST',
      '/api/modules/force-close-all',
      broadcast,
      highRiskHeaders('module:*:force-close-all')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: '全部模块关停完成，已清理 1/1',
      data: {
        total: 1,
        successCount: 1,
        failedCount: 0,
        results: [{
          moduleId: 'demo',
          moduleName: 'Demo Module',
          success: true,
          message: '已清理',
          adapterStopError: null,
          killed,
          before,
          after,
        }],
      },
    });
    expect(adapter.stop).toHaveBeenCalledWith(true);
    expect(forceKillProcessesMock).toHaveBeenCalledWith([444]);
    expect(broadcast).toHaveBeenCalledWith({ type: 'module_stopped', moduleId: 'demo', forceClosed: true, byBatch: true });
  });
});

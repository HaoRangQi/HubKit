import * as fs from 'fs';
import * as path from 'path';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { createWorkspaceRouter } from '../../src/web/api/workspace-routes';
import { highRiskConfirmationStore } from '../../src/web/api/high-risk-confirmation';
import { ModuleMetadata, ModuleStatus } from '../../src/types/module';

const mockSettings: any = {
  workspaces: [],
};

jest.mock('../../src/config/config', () => ({
  config: {
    getSettings: jest.fn(() => mockSettings),
    updateSettings: jest.fn((patch: any) => {
      if (patch.workspaces) mockSettings.workspaces = patch.workspaces;
    }),
    recordWorkspaceHistory: jest.fn(),
  },
}));

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

async function requestWorkspaceRouter(
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body: unknown = {},
  query: Record<string, unknown> = {},
  registry: ModuleRegistry = new ModuleRegistry(),
  lifecycle: any = {},
  broadcast: jest.Mock = jest.fn()
): Promise<{ status: number; body: any }> {
  const router = createWorkspaceRouter({
    registry,
    lifecycle,
    broadcast,
  }) as any;

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url: pathname,
      originalUrl: pathname,
      headers,
      body,
      query,
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
        resolve({ status: statusCode, body });
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

function highRiskHeaders(action: string): Record<string, string> {
  return {
    'x-hubkit-high-risk-confirmation': action,
    'x-hubkit-high-risk-token': highRiskConfirmationStore.issue(action).token,
  };
}

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'api',
    name: 'API',
    type: 'shell',
    scriptPath: '/tmp/api.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('workspace API wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.workspaces = [];
  });

  it('mounts workspace routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createWorkspaceRouter } from './workspace-routes'");
    expect(source).toContain('router.use(createWorkspaceRouter({ registry, lifecycle, broadcast: (message) => broadcast(wss, message) }))');
    expect(source).not.toContain("router.get('/workspaces'");
    expect(source).not.toContain("router.post('/workspaces'");
    expect(source).not.toContain('function parseWorkspacePayload');
  });

  it('exposes CRUD, plan, and run routes for workspaces', () => {
    const source = readSource('src/web/api/workspace-routes.ts');

    expect(source).toContain("router.get('/workspaces'");
    expect(source).toContain("router.post('/workspaces'");
    expect(source).toContain("router.get('/workspaces/:workspaceId'");
    expect(source).toContain("router.put('/workspaces/:workspaceId'");
    expect(source).toContain("router.delete('/workspaces/:workspaceId'");
    expect(source).toContain("router.get('/workspaces/:workspaceId/plan'");
    expect(source).toContain("router.post('/workspaces/:workspaceId/start'");
    expect(source).toContain("'/workspaces/:workspaceId/stop'");
    expect(source).toContain("import { requireHighRiskConfirmation } from './high-risk-confirmation'");
    expect(source).toContain("requireHighRiskConfirmation((req) => `workspace:${req.params.workspaceId}:stop`)");
  });

  it('validates workspace payloads and stores them independently from full settings saves', () => {
    const source = readSource('src/web/api/workspace-routes.ts');

    expect(source).toContain('function parseWorkspacePayload');
    expect(source).toContain('工作区 ID 只能包含字母、数字、下划线和短横线');
    expect(source).toContain('工作区名称不能为空');
    expect(source).toContain('config.updateSettings({ workspaces: [...settings.workspaces, workspace] })');
    expect(source).toContain('config.updateSettings({ workspaces: nextWorkspaces })');
  });

  it('rejects workspace stop requests without a one-time high-risk token', async () => {
    const response = await requestWorkspaceRouter('POST', '/workspaces/dev/stop');

    expect(response.status).toBe(428);
    expect(response.body).toEqual({
      success: false,
      error: '需要高风险操作确认',
      confirmationRequired: true,
      confirmationAction: 'workspace:dev:stop',
    });
  });

  it('creates, lists, reads, updates, and deletes workspaces', async () => {
    const createResponse = await requestWorkspaceRouter(
      'POST',
      '/workspaces',
      {},
      {
        id: ' dev ',
        name: ' Development ',
        description: ' Local dev ',
        moduleIds: ['api', 'web', 'api', ''],
        startOrder: ['web', 'api'],
        failurePolicy: 'continue',
      }
    );
    const listResponse = await requestWorkspaceRouter('GET', '/workspaces');
    const getResponse = await requestWorkspaceRouter('GET', '/workspaces/dev');
    const updateResponse = await requestWorkspaceRouter(
      'PUT',
      '/workspaces/dev',
      {},
      {
        name: 'Dev Updated',
        moduleIds: ['api'],
        failurePolicy: 'stop',
      }
    );
    const deleteResponse = await requestWorkspaceRouter('DELETE', '/workspaces/dev');

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data).toEqual({
      id: 'dev',
      name: 'Development',
      description: 'Local dev',
      moduleIds: ['api', 'web'],
      startOrder: ['web', 'api'],
      stopOrder: [],
      failurePolicy: 'continue',
    });
    expect(listResponse.body.data).toHaveLength(1);
    expect(getResponse.body.data.id).toBe('dev');
    expect(updateResponse.body.data).toEqual(expect.objectContaining({
      id: 'dev',
      name: 'Dev Updated',
      moduleIds: ['api'],
      failurePolicy: 'stop',
    }));
    expect(deleteResponse.body).toEqual({ success: true, message: '工作区已删除', data: [] });
  });

  it('rejects duplicate, invalid, and missing workspace resources', async () => {
    mockSettings.workspaces = [{ id: 'dev', name: 'Development', moduleIds: ['api'] }];

    const duplicate = await requestWorkspaceRouter('POST', '/workspaces', {}, { id: 'dev', name: 'Duplicate' });
    const invalid = await requestWorkspaceRouter('POST', '/workspaces', {}, { id: '../bad', name: 'Bad' });
    const missingGet = await requestWorkspaceRouter('GET', '/workspaces/missing');
    const missingPut = await requestWorkspaceRouter('PUT', '/workspaces/missing', {}, { name: 'Missing' });
    const missingDelete = await requestWorkspaceRouter('DELETE', '/workspaces/missing');

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('工作区 ID 已存在');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('工作区 ID 只能包含字母、数字、下划线和短横线');
    expect(missingGet.status).toBe(404);
    expect(missingPut.status).toBe(404);
    expect(missingDelete.status).toBe(404);
  });

  it('builds workspace plans with requested action', async () => {
    mockSettings.workspaces = [{ id: 'dev', name: 'Development', moduleIds: ['api', 'web'] }];
    const registry = new ModuleRegistry();
    registry.register(createModule({ id: 'api' }));

    const response = await requestWorkspaceRouter(
      'GET',
      '/workspaces/dev/plan',
      {},
      {},
      { action: 'stop' },
      registry
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      workspaceId: 'dev',
      action: 'stop',
      missingModuleIds: ['web'],
      runnableModuleIds: ['api'],
    }));
  });

  it('runs workspace starts and broadcasts succeeded module and workspace events', async () => {
    mockSettings.workspaces = [{ id: 'dev', name: 'Development', moduleIds: ['api'] }];
    const registry = new ModuleRegistry();
    const module = createModule({ id: 'api' });
    registry.register(module);
    const lifecycle = {
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.STOPPED }),
      start: jest.fn().mockResolvedValue({ success: true }),
      stop: jest.fn(),
    };
    const broadcast = jest.fn();

    const response = await requestWorkspaceRouter(
      'POST',
      '/workspaces/dev/start',
      {},
      {},
      {},
      registry,
      lifecycle,
      broadcast
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lifecycle.start).toHaveBeenCalledWith(module);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'module_started',
      moduleId: 'api',
      byWorkspace: true,
      workspaceId: 'dev',
    });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'workspace_started',
      workspaceId: 'dev',
      success: true,
    });
  });

  it('runs workspace stops only with a one-time high-risk token', async () => {
    mockSettings.workspaces = [{ id: 'dev', name: 'Development', moduleIds: ['api'] }];
    const registry = new ModuleRegistry();
    const module = createModule({ id: 'api' });
    registry.register(module);
    const lifecycle = {
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.RUNNING }),
      start: jest.fn(),
      stop: jest.fn().mockResolvedValue({ success: true }),
    };

    const response = await requestWorkspaceRouter(
      'POST',
      '/workspaces/dev/stop',
      highRiskHeaders('workspace:dev:stop'),
      {},
      {},
      registry,
      lifecycle
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lifecycle.stop).toHaveBeenCalledWith(module);
  });
});

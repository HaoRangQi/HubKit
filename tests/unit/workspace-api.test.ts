import * as fs from 'fs';
import * as path from 'path';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { createWorkspaceRouter } from '../../src/web/api/workspace-routes';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

async function requestWorkspaceRouter(
  method: string,
  pathname: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const router = createWorkspaceRouter({
    registry: new ModuleRegistry(),
    lifecycle: {} as any,
    broadcast: jest.fn(),
  }) as any;

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url: pathname,
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

describe('workspace API wiring', () => {
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
});

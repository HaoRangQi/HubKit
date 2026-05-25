import { exec, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';
import { createModuleUpdateRouter } from '../../src/web/api/module-update-routes';
import { highRiskConfirmationStore } from '../../src/web/api/high-risk-confirmation';

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
}));

const execMock = exec as unknown as jest.Mock;
const execSyncMock = execSync as jest.MockedFunction<typeof execSync>;

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo Module',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: false,
    enabled: true,
    updateable: true,
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
  const router = createModuleUpdateRouter({ registry, broadcast });
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

function createGitModuleDir(): string {
  const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-module-update-'));
  fs.mkdirSync(path.join(moduleDir, '.git'));
  fs.writeFileSync(path.join(moduleDir, 'run.sh'), '#!/bin/sh\n');
  return moduleDir;
}

describe('module update routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts module update routes from the main API router', () => {
    const routesSource = readSource('src/web/api/routes.ts');
    const updateSource = readSource('src/web/api/module-update-routes.ts');

    expect(routesSource).toContain("import { createModuleUpdateRouter } from './module-update-routes'");
    expect(routesSource).toContain('router.use(createModuleUpdateRouter({ registry, broadcast: (message) => broadcast(wss, message) }))');
    expect(routesSource).not.toContain("'/modules/:id/update'");
    expect(routesSource).not.toContain("router.get('/modules/:id/update-check'");
    expect(updateSource).toContain('export function createModuleUpdateRouter');
    expect(updateSource).toContain("'/modules/:id/update'");
    expect(updateSource).toContain("router.get('/modules/:id/update-check'");
    expect(updateSource).toContain("requireHighRiskConfirmation((req) => `module:${req.params.id}:update`)");
  });

  it('requires the existing high-risk confirmation for module updates', async () => {
    const registry = new ModuleRegistry();
    registry.register(createModule());

    const response = await requestRouter(registry, 'POST', '/api/modules/demo/update');

    expect(response.status).toBe(428);
    expect(response.body).toEqual({
      success: false,
      error: '需要高风险操作确认',
      confirmationRequired: true,
      confirmationAction: 'module:demo:update',
    });
    expect(execMock).not.toHaveBeenCalled();
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('keeps the not-found response for module update routes', async () => {
    const response = await requestRouter(
      new ModuleRegistry(),
      'POST',
      '/api/modules/missing/update',
      jest.fn(),
      highRiskHeaders('module:missing:update')
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: '模块不存在' });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('updates a module and broadcasts the existing event payload', async () => {
    const registry = new ModuleRegistry();
    const moduleDir = createGitModuleDir();
    const module = createModule({ scriptPath: path.join(moduleDir, 'run.sh') });
    const broadcast = jest.fn();

    registry.register(module);
    execSyncMock
      .mockReturnValueOnce('abc1234\n' as any)
      .mockReturnValueOnce('def5678\n' as any);
    execMock
      .mockImplementationOnce((_command: string, _options: any, callback: any) => {
        callback(null, 'Updating abc1234..def5678\n', '');
        return {} as any;
      })
      .mockImplementationOnce((_command: string, _options: any, callback: any) => {
        callback(null, 'installed packages\n', '');
        return {} as any;
      });

    const response = await requestRouter(
      registry,
      'POST',
      '/api/modules/demo/update',
      broadcast,
      highRiskHeaders('module:demo:update')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      hasUpdates: true,
      message: '已更新到最新版本 (abc1234 → def5678)',
      beforeHash: 'abc1234',
      afterHash: 'def5678',
      pullOutput: 'Updating abc1234..def5678',
      installOutput: 'installed packages',
    });
    expect(execMock).toHaveBeenNthCalledWith(1, 'git pull origin HEAD', { cwd: moduleDir }, expect.any(Function));
    expect(execMock).toHaveBeenNthCalledWith(2, 'npm install', { cwd: moduleDir }, expect.any(Function));
    expect(broadcast).toHaveBeenCalledWith({ type: 'module_updated', moduleId: 'demo', hasUpdates: true });
  });

  it('skips dependency install when the module is already up to date', async () => {
    const registry = new ModuleRegistry();
    const moduleDir = createGitModuleDir();
    registry.register(createModule({ scriptPath: path.join(moduleDir, 'run.sh') }));
    execSyncMock.mockReturnValue('abc1234\n' as any);
    execMock.mockImplementationOnce((_command: string, _options: any, callback: any) => {
      callback(null, 'Already up to date.\n', '');
      return {} as any;
    });

    const response = await requestRouter(
      registry,
      'POST',
      '/api/modules/demo/update',
      jest.fn(),
      highRiskHeaders('module:demo:update')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      hasUpdates: false,
      message: '已是最新版本',
      beforeHash: 'abc1234',
      afterHash: 'abc1234',
      pullOutput: 'Already up to date.',
      installOutput: '',
    });
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('checks update availability with the existing response shape', async () => {
    const registry = new ModuleRegistry();
    const moduleDir = createGitModuleDir();
    registry.register(createModule({ scriptPath: path.join(moduleDir, 'run.sh') }));
    execMock.mockImplementationOnce((_command: string, _options: any, callback: any) => {
      callback(null, '', '');
      return {} as any;
    });
    execSyncMock
      .mockReturnValueOnce('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' as any)
      .mockReturnValueOnce('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n' as any)
      .mockReturnValueOnce('3\n' as any);

    const response = await requestRouter(registry, 'GET', '/api/modules/demo/update-check');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      hasUpdates: true,
      localHash: 'aaaaaaa',
      remoteHash: 'bbbbbbb',
      commitsBehind: 3,
      message: '有 3 个新提交可用',
    });
    expect(execMock).toHaveBeenCalledWith('git fetch origin', { cwd: moduleDir }, expect.any(Function));
    expect(execSyncMock).toHaveBeenNthCalledWith(1, 'git rev-parse HEAD', { cwd: moduleDir });
    expect(execSyncMock).toHaveBeenNthCalledWith(2, 'git rev-parse @{u}', { cwd: moduleDir });
    expect(execSyncMock).toHaveBeenNthCalledWith(3, 'git rev-list HEAD..@{u} --count', { cwd: moduleDir });
  });
});

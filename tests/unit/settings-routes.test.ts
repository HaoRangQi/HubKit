import * as fs from 'fs';
import { Request, Response } from 'express';
import * as path from 'path';
import { createSettingsRouter } from '../../src/web/api/settings-routes';
import { highRiskConfirmationStore } from '../../src/web/api/high-risk-confirmation';

var mockConfig: {
  getSettings: jest.Mock;
  updateSettings: jest.Mock;
  listBackups: jest.Mock;
  previewRestoreBackup: jest.Mock;
  restoreBackup: jest.Mock;
};

jest.mock('../../src/config/config', () => ({
  config: mockConfig = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    listBackups: jest.fn(),
    previewRestoreBackup: jest.fn(),
    restoreBackup: jest.fn(),
  },
}));

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

function invokePostSettings(body: unknown): { statusCode: number; jsonBody: unknown } {
  const router = createSettingsRouter() as any;
  const route = router.stack.find((layer: any) => layer.route?.path === '/settings' && layer.route?.methods?.post);
  const handler = route.route.stack[0].handle;
  const result = {
    statusCode: 200,
    jsonBody: undefined as unknown,
  };
  const req = { body } as Request;
  const res = {
    status: jest.fn((statusCode: number) => {
      result.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((jsonBody: unknown) => {
      result.jsonBody = jsonBody;
      return res;
    }),
  } as unknown as Response;

  handler(req, res);
  return result;
}

async function requestSettingsRouter(
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body: unknown = {}
): Promise<{ statusCode: number; jsonBody: any }> {
  const router = createSettingsRouter() as any;
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url: pathname,
      originalUrl: pathname,
      headers,
      body,
      get(name: string) {
        return headers[name.toLowerCase()];
      },
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

    router.handle(req, res, (error?: any) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ statusCode: 404, jsonBody: undefined });
    });
  });
}

function highRiskHeaders(action: string): Record<string, string> {
  return {
    'x-hubkit-high-risk-confirmation': action,
    'x-hubkit-high-risk-token': highRiskConfirmationStore.issue(action).token,
  };
}

describe('settings routes split', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.getSettings.mockReturnValue({});
    mockConfig.updateSettings.mockReturnValue(undefined);
    mockConfig.listBackups.mockReturnValue([]);
  });

  it('mounts settings routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createSettingsRouter } from './settings-routes'");
    expect(source).toContain('router.use(createSettingsRouter())');
    expect(source).not.toContain("router.get('/settings'");
    expect(source).not.toContain("router.post('/settings'");
    expect(source).not.toContain("router.get('/config/backups'");
    expect(source).not.toContain("router.get('/config/backups/:backupId/preview'");
    expect(source).not.toContain("router.post('/config/backups/:backupId/restore'");
  });

  it('keeps the settings and config backup endpoints in their own router module', () => {
    const source = readSource('src/web/api/settings-routes.ts');

    expect(source).toContain('export function createSettingsRouter');
    expect(source).toContain("router.get('/settings'");
    expect(source).toContain("router.post('/settings'");
    expect(source).toContain("router.get('/config/backups'");
    expect(source).toContain("router.get('/config/backups/:backupId/preview'");
    expect(source).toContain("'/config/backups/:backupId/restore'");
    expect(source).toContain("import { requireHighRiskConfirmation } from './high-risk-confirmation'");
    expect(source).toContain("requireHighRiskConfirmation((req) => `config-backup:${req.params.backupId}:restore`)");
    expect(source).toContain("import { normalizeStartPolicy } from '../../runtime/module-start-policy'");
    expect(source).toContain('normalizeStartPolicy(policy as any)');
    expect(source).toContain('config.listBackups(20)');
    expect(source).toContain('config.previewRestoreBackup(backupId)');
    expect(source).toContain('config.restoreBackup(backupId)');
    expect(source).toContain('res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) })');
  });

  it('returns failure when settings persistence fails', () => {
    mockConfig.updateSettings.mockImplementation(() => {
      throw new Error('save failed');
    });
    const result = invokePostSettings({
      autoStart: { alpha: true },
      startOrder: ['alpha'],
    });

    expect(result.statusCode).toBe(500);
    expect(result.jsonBody).toEqual({ success: false, error: 'Error: save failed' });
    expect(mockConfig.updateSettings).toHaveBeenCalledWith({
      autoStart: { alpha: true },
      startOrder: ['alpha'],
      groups: undefined,
      moduleGroups: undefined,
      startPolicies: undefined,
      groupStartPolicyTemplates: undefined,
      workspaces: undefined,
    });
  });

  it('returns success only after settings persistence completes', () => {
    const result = invokePostSettings({
      autoStart: { alpha: true },
      startOrder: ['alpha'],
    });

    expect(result.statusCode).toBe(200);
    expect(result.jsonBody).toEqual({ success: true, message: '设置已保存' });
    expect(mockConfig.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('requires one-time high-risk confirmation for config restore', () => {
    const router = createSettingsRouter() as any;
    const route = router.stack.find((layer: any) => layer.route?.path === '/config/backups/:backupId/restore' && layer.route?.methods?.post);
    const middleware = route.route.stack[0].handle;
    const req = {
      params: { backupId: 'backup-1' },
      get: jest.fn(() => undefined),
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '需要高风险操作确认',
      confirmationRequired: true,
      confirmationAction: 'config-backup:backup-1:restore',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('restores config backups with a valid one-time confirmation token', async () => {
    mockConfig.restoreBackup.mockReturnValue({ configVersion: 2 });
    mockConfig.getSettings.mockReturnValue({ autoStart: {} });
    const backupId = 'config-2026-05-24T12-00-00-000Z.json';
    mockConfig.listBackups.mockReturnValue([{ id: backupId }]);

    const result = await requestSettingsRouter(
      'POST',
      `/config/backups/${backupId}/restore`,
      highRiskHeaders(`config-backup:${backupId}:restore`)
    );

    expect(result.statusCode).toBe(200);
    expect(result.jsonBody).toEqual({
      success: true,
      message: '配置已恢复',
      data: {
        configVersion: 2,
        settings: { autoStart: {} },
        backups: [{ id: backupId }],
      },
    });
    expect(mockConfig.restoreBackup).toHaveBeenCalledWith(backupId);
  });
});

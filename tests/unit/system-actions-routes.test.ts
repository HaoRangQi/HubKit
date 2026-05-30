import * as fs from 'fs';
import * as path from 'path';
import { createSystemActionsRouter } from '../../src/web/api/system-actions-routes';
import { highRiskConfirmationStore } from '../../src/web/api/high-risk-confirmation';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

describe('system actions routes split', () => {
  it('mounts system actions routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createSystemActionsRouter } from './system-actions-routes'");
    expect(source).toContain('router.use(createSystemActionsRouter({ bootPreferenceService }))');
    expect(source).not.toContain("router.get('/system-actions'");
    expect(source).not.toContain("router.post('/system-actions/boot-preference/apply'");
  });

  it('keeps the system actions endpoints in their own router module', () => {
    const source = readSource('src/web/api/system-actions-routes.ts');

    expect(source).toContain('export function createSystemActionsRouter');
    expect(source).toContain("router.get('/system-actions'");
    expect(source).toContain("'/system-actions/boot-preference/apply'");
    expect(source).toContain("router.get('/system-actions/boot-preference/history'");
    expect(source).toContain("router.get('/system-actions/boot-preference/logs'");
    expect(source).toContain("import { parseLogLineCount } from './route-utils'");
    expect(source).toContain("import { requireHighRiskConfirmation } from './high-risk-confirmation'");
    expect(source).toContain("requireHighRiskConfirmation((req) => `system-action:boot-preference:${req.body?.mode || 'unknown'}:apply`)");
    expect(source).toContain('parseLogLineCount(req.query.lines)');
    expect(source).toContain("return res.json({ success: true, data: [] })");
    expect(source).toContain("return res.status(404).json({ success: false, error: '系统调优未启用' })");
  });
});

function highRiskHeaders(action: string): Record<string, string> {
  return {
    'x-hubkit-high-risk-confirmation': action,
    'x-hubkit-high-risk-token': highRiskConfirmationStore.issue(action).token,
  };
}

async function requestRouter(
  bootPreferenceService: any,
  method: string,
  pathname: string,
  body: unknown = {},
  query: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const router = createSystemActionsRouter({ bootPreferenceService }) as any;

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

describe('system actions routes behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists empty system actions when the service is disabled', async () => {
    const response = await requestRouter(undefined, 'GET', '/system-actions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
  });

  it('lists available system actions through the service', async () => {
    const service = {
      listActions: jest.fn().mockResolvedValue([{ id: 'boot-preference', name: 'Boot Preference' }]),
    };

    const response = await requestRouter(service, 'GET', '/system-actions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [{ id: 'boot-preference', name: 'Boot Preference' }] });
  });

  it('requires high-risk confirmation before applying boot preference mode', async () => {
    const service = {
      applyMode: jest.fn(),
    };

    const response = await requestRouter(
      service,
      'POST',
      '/system-actions/boot-preference/apply',
      { mode: 'block_power' }
    );

    expect(response.status).toBe(428);
    expect(response.body).toEqual({
      success: false,
      error: '需要高风险操作确认',
      confirmationRequired: true,
      confirmationAction: 'system-action:boot-preference:block_power:apply',
    });
    expect(service.applyMode).not.toHaveBeenCalled();
  });

  it('applies boot preference mode and returns the action record', async () => {
    const record = { runId: 'run-1', status: 'succeeded' };
    const service = {
      applyMode: jest.fn().mockResolvedValue({ message: 'applied', record }),
    };

    const response = await requestRouter(
      service,
      'POST',
      '/system-actions/boot-preference/apply',
      { mode: 'block_power' },
      {},
      highRiskHeaders('system-action:boot-preference:block_power:apply')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'applied', data: record });
    expect(service.applyMode).toHaveBeenCalledWith('block_power');
  });

  it('returns history and logs with parsed log line count', async () => {
    const history = [{ runId: 'run-1' }];
    const service = {
      getHistory: jest.fn().mockResolvedValue(history),
      getLog: jest.fn().mockResolvedValue('log text'),
    };

    const historyResponse = await requestRouter(service, 'GET', '/system-actions/boot-preference/history');
    const logResponse = await requestRouter(
      service,
      'GET',
      '/system-actions/boot-preference/logs',
      {},
      { runId: 'run-1', lines: '10' }
    );

    expect(historyResponse.body).toEqual({ success: true, data: history });
    expect(logResponse.body).toEqual({ success: true, data: 'log text' });
    expect(service.getHistory).toHaveBeenCalled();
    expect(service.getLog).toHaveBeenCalledWith('run-1', 10);
  });

  it('returns not enabled for history and logs when the service is disabled', async () => {
    const historyResponse = await requestRouter(undefined, 'GET', '/system-actions/boot-preference/history');
    const logResponse = await requestRouter(undefined, 'GET', '/system-actions/boot-preference/logs');

    expect(historyResponse.status).toBe(404);
    expect(historyResponse.body).toEqual({ success: false, error: '系统调优未启用' });
    expect(logResponse.status).toBe(404);
    expect(logResponse.body).toEqual({ success: false, error: '系统调优未启用' });
  });
});

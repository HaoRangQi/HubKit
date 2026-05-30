import * as fs from 'fs';
import * as path from 'path';
import { createScriptBundleRouter } from '../../src/web/api/script-bundle-routes';
import { highRiskConfirmationStore } from '../../src/web/api/high-risk-confirmation';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

describe('script bundle routes split', () => {
  it('mounts script bundle routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createScriptBundleRouter } from './script-bundle-routes'");
    expect(source).toContain('router.use(createScriptBundleRouter({ scriptBundleManager }))');
    expect(source).not.toContain("router.get('/script-bundles'");
    expect(source).not.toContain("router.post('/script-bundles/:bundleId/actions/:actionId/run'");
    expect(source).not.toContain("router.post('/terminal-sessions/:sessionId/kill'");
  });

  it('keeps the script bundle endpoints in their own router module', () => {
    const source = readSource('src/web/api/script-bundle-routes.ts');

    expect(source).toContain('export function createScriptBundleRouter');
    expect(source).toContain("router.get('/script-bundles'");
    expect(source).toContain("'/script-bundles/:bundleId/actions/:actionId/run'");
    expect(source).toContain("'/script-bundles/:bundleId/actions/:actionId/web-terminal'");
    expect(source).toContain("router.get('/script-bundles/:bundleId/actions/:actionId/history'");
    expect(source).toContain("router.get('/script-bundles/:bundleId/actions/:actionId/logs'");
    expect(source).toContain("'/terminal-sessions/:sessionId/kill'");
    expect(source).toContain("import { parseLogLineCount } from './route-utils'");
    expect(source).toContain("import { requireHighRiskConfirmation } from './high-risk-confirmation'");
    expect(source).toContain("requireHighRiskConfirmation((req) => `script-bundle:${req.params.bundleId}:${req.params.actionId}:run`)");
    expect(source).toContain("requireHighRiskConfirmation((req) => `script-bundle:${req.params.bundleId}:${req.params.actionId}:web-terminal`)");
    expect(source).toContain("requireHighRiskConfirmation((req) => `terminal-session:${req.params.sessionId}:kill`)");
    expect(source).toContain('parseLogLineCount(req.query.lines)');
    expect(source).toContain("return res.json({ success: true, data: [] })");
    expect(source).toContain("return res.status(404).json({ success: false, error: '脚本工具箱未启用' })");
  });
});

function highRiskHeaders(action: string): Record<string, string> {
  return {
    'x-hubkit-high-risk-confirmation': action,
    'x-hubkit-high-risk-token': highRiskConfirmationStore.issue(action).token,
  };
}

async function requestRouter(
  scriptBundleManager: any,
  method: string,
  pathname: string,
  body: unknown = {},
  query: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const router = createScriptBundleRouter({ scriptBundleManager }) as any;

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

describe('script bundle routes behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists empty bundles when the script bundle manager is disabled', async () => {
    const response = await requestRouter(undefined, 'GET', '/script-bundles');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
  });

  it('lists bundles from the script bundle manager', async () => {
    const manager = {
      listBundles: jest.fn(() => [{ id: 'tools', name: 'Tools', groups: [] }]),
    };

    const response = await requestRouter(manager, 'GET', '/script-bundles');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [{ id: 'tools', name: 'Tools', groups: [] }] });
  });

  it('requires high-risk confirmation before running script actions', async () => {
    const manager = {
      runAction: jest.fn(),
    };

    const response = await requestRouter(manager, 'POST', '/script-bundles/tools/actions/build/run');

    expect(response.status).toBe(428);
    expect(response.body).toEqual({
      success: false,
      error: '需要高风险操作确认',
      confirmationRequired: true,
      confirmationAction: 'script-bundle:tools:build:run',
    });
    expect(manager.runAction).not.toHaveBeenCalled();
  });

  it('runs script actions and returns the action record', async () => {
    const record = { runId: 'run-1', status: 'running' };
    const manager = {
      runAction: jest.fn().mockResolvedValue({ message: 'started', record }),
    };

    const response = await requestRouter(
      manager,
      'POST',
      '/script-bundles/tools/actions/build/run',
      {},
      {},
      highRiskHeaders('script-bundle:tools:build:run')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'started', data: record });
    expect(manager.runAction).toHaveBeenCalledWith('tools', 'build');
  });

  it('starts web terminal actions with bounded dimensions', async () => {
    const manager = {
      runActionInWebTerminal: jest.fn().mockResolvedValue({
        message: 'terminal started',
        session: { sessionId: 'term-1' },
        record: { runId: 'run-1' },
      }),
    };

    const response = await requestRouter(
      manager,
      'POST',
      '/script-bundles/tools/actions/shell/web-terminal',
      { cols: 120, rows: 40 },
      {},
      highRiskHeaders('script-bundle:tools:shell:web-terminal')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'terminal started',
      data: {
        session: { sessionId: 'term-1' },
        record: { runId: 'run-1' },
      },
    });
    expect(manager.runActionInWebTerminal).toHaveBeenCalledWith('tools', 'shell', 120, 40);
  });

  it('returns action history and logs with parsed query parameters', async () => {
    const history = [{ runId: 'run-1' }];
    const manager = {
      getActionHistory: jest.fn().mockResolvedValue(history),
      getActionLog: jest.fn().mockResolvedValue('log text'),
    };

    const historyResponse = await requestRouter(manager, 'GET', '/script-bundles/tools/actions/build/history');
    const logResponse = await requestRouter(
      manager,
      'GET',
      '/script-bundles/tools/actions/build/logs',
      {},
      { runId: 'run-1', lines: '5' }
    );

    expect(historyResponse.body).toEqual({ success: true, data: history });
    expect(logResponse.body).toEqual({ success: true, data: 'log text' });
    expect(manager.getActionHistory).toHaveBeenCalledWith('tools', 'build');
    expect(manager.getActionLog).toHaveBeenCalledWith('tools', 'build', 'run-1', 5);
  });

  it('kills terminal sessions only after high-risk confirmation', async () => {
    const manager = {
      killTerminalSession: jest.fn().mockReturnValue(true),
    };

    const response = await requestRouter(
      manager,
      'POST',
      '/terminal-sessions/term-1/kill',
      {},
      {},
      highRiskHeaders('terminal-session:term-1:kill')
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: '终端会话已停止' });
    expect(manager.killTerminalSession).toHaveBeenCalledWith('term-1');
  });

  it('returns 404 when killing a missing terminal session', async () => {
    const manager = {
      killTerminalSession: jest.fn().mockReturnValue(false),
    };

    const response = await requestRouter(
      manager,
      'POST',
      '/terminal-sessions/missing/kill',
      {},
      {},
      highRiskHeaders('terminal-session:missing:kill')
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: '终端会话不存在或已结束' });
  });
});

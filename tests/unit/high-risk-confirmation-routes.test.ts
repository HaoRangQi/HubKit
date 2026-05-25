import * as fs from 'fs';
import * as path from 'path';
import { createHighRiskConfirmationRouter } from '../../src/web/api/high-risk-confirmation-routes';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

function invokePost(body: unknown): { statusCode: number; jsonBody: any } {
  const router = createHighRiskConfirmationRouter() as any;
  const route = router.stack.find((layer: any) => layer.route?.path === '/high-risk-confirmations' && layer.route?.methods?.post);
  const handler = route.route.stack[0].handle;
  const result = {
    statusCode: 200,
    jsonBody: undefined as any,
  };
  const req = { body } as any;
  const res = {
    status: jest.fn((statusCode: number) => {
      result.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((jsonBody: any) => {
      result.jsonBody = jsonBody;
      return res;
    }),
  } as any;

  handler(req, res);
  return result;
}

describe('high risk confirmation routes', () => {
  it('mounts high-risk confirmation ticket routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createHighRiskConfirmationRouter } from './high-risk-confirmation-routes'");
    expect(source).toContain('router.use(createHighRiskConfirmationRouter())');
  });

  it('issues a one-time confirmation ticket for a valid action', () => {
    const result = invokePost({ action: 'module:demo:update' });

    expect(result.statusCode).toBe(201);
    expect(result.jsonBody).toEqual({
      success: true,
      data: {
        action: 'module:demo:update',
        token: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
  });

  it('rejects empty action ids', () => {
    const result = invokePost({ action: '   ' });

    expect(result.statusCode).toBe(400);
    expect(result.jsonBody).toEqual({ success: false, error: '高风险操作 ID 不能为空' });
  });

  it('rejects unsupported action ids before issuing tickets', () => {
    const result = invokePost({ action: 'danger:run' });

    expect(result.statusCode).toBe(400);
    expect(result.jsonBody).toEqual({ success: false, error: '不支持的高风险操作 ID' });
  });
});

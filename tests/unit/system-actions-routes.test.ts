import * as fs from 'fs';
import * as path from 'path';

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

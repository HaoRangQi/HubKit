import * as fs from 'fs';
import * as path from 'path';

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

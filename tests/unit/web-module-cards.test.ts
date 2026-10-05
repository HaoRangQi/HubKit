import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const publicDir = path.join(__dirname, '../../src/web/public');
function loadCards(): any {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const window: any = {};
  for (const file of ['app-formatters.js', 'app-diagnostics.js', 'app-module-cards.js']) {
    const filePath = path.join(publicDir, file);
    if (fs.existsSync(filePath)) vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), { window });
  }
  const sandbox: any = {
    window, ...window.HubKitFormatters, parsePort: window.HubKitDiagnostics.parsePort,
    diagnosticsByModule: {}, diagnosticsLoadingByModule: {}, forceCloseLoadingByModule: {},
    moduleActionLoading: {}, moduleUpdateChecks: {}, moduleDetailsOpen: {},
    uiPrefs: { collapseProcessMini: true },
  };
  for (const name of ['icon', 'escapeHtml', 'escapeAttr', 'jsString', 'isModuleBusy', 'createModuleCard', 'rememberModuleDetails', 'showModuleDetails']) {
    const start = html.indexOf(`    function ${name}(`);
    if (start < 0) continue;
    const remaining = html.slice(start + 5);
    const next = remaining.search(/\n    (?:async )?function /);
    vm.runInNewContext(next < 0 ? remaining : html.slice(start, start + 5 + next), sandbox);
  }
  return sandbox;
}

describe('module card progressive details', () => {
  const module = { id: 'api', name: 'API', type: 'nodejs', status: 'running', pid: 123, uptime: 60, webUrl: 'http://127.0.0.1:3000', updateable: true };

  it('keeps common actions visible and moves metrics and maintenance into closed native details', () => {
    const html = loadCards().createModuleCard(module);
    const detailsAt = html.indexOf('<details');
    expect(detailsAt).toBeGreaterThan(0);
    expect(html.slice(0, detailsAt)).toContain('stopModule');
    expect(html.slice(0, detailsAt)).toContain('openModuleUrl');
    expect(html.slice(0, detailsAt)).toContain('showLogs');
    expect(html.slice(0, detailsAt)).not.toContain('forceCloseModule');
    expect(html.slice(0, detailsAt)).not.toContain('metric-grid');
    expect(html.slice(detailsAt)).toContain('restartModule');
    expect(html.slice(detailsAt)).toContain('checkAndUpdate');
    expect(html.slice(detailsAt)).toContain('forceCloseModule');
    expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\sopen(?:\s|>)/);
  });

  it('keeps failure recovery visible when details are closed', () => {
    const html = loadCards().createModuleCard({ ...module, status: 'stopped', runtimeState: { phase: 'failed', failure: { summary: '端口被占用', details: '3000 端口被其他进程占用' } } });
    const main = html.slice(0, html.indexOf('<details'));
    expect(main).toContain('端口被占用');
    expect(main).toContain('查看失败日志');
    expect(main).toContain('startModule');
  });

  it('keeps details open through module refresh and allows closing again', () => {
    const cards = loadCards();
    expect(typeof cards.rememberModuleDetails).toBe('function');
    cards.rememberModuleDetails({ isConnected: true, dataset: { moduleId: 'api' }, open: true });
    expect(cards.createModuleCard({ ...module, uptime: 120 }).match(/<details[^>]*>/)[0]).toMatch(/\sopen(?:\s|>)/);
    cards.rememberModuleDetails({ isConnected: true, dataset: { moduleId: 'api' }, open: false });
    expect(cards.createModuleCard(module).match(/<details[^>]*>/)[0]).not.toMatch(/\sopen(?:\s|>)/);
  });

  it('retains explicit expanded preferences and escapes untrusted module names', () => {
    const cards = loadCards();
    cards.uiPrefs.collapseProcessMini = false;
    const html = cards.createModuleCard({ ...module, name: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html.match(/<details[^>]*>/)?.[0]).toMatch(/\sopen(?:\s|>)/);
  });

  it('renders persisted update results instead of treating support as an available version', () => {
    const cards = loadCards();
    expect(cards.createModuleCard(module)).toContain('尚未检查版本');
    cards.moduleUpdateChecks.api = { status: 'checked', hasUpdates: true, commitsBehind: 2 };
    const html = cards.createModuleCard(module);
    expect(html).toContain('2 个上游新提交');
    expect(html).toContain('performUpdate');
    cards.moduleUpdateChecks.api = { status: 'error', message: '网络不可用' };
    expect(cards.createModuleCard(module)).toContain('网络不可用');
    expect(cards.createModuleCard(module)).not.toContain('performUpdate');
  });

  it('opens the target group and focuses its details from a confirmed-update link', () => {
    const cards = loadCards();
    const focus = jest.fn();
    const scrollIntoView = jest.fn();
    cards.modules = [module];
    cards.uiPrefs.groupCollapseState = { 'group-default': true };
    cards.getModuleGroupId = () => 'default';
    cards.showView = jest.fn();
    cards.renderDashboard = jest.fn();
    cards.document = { querySelectorAll: () => [{ dataset: { moduleId: 'api' }, scrollIntoView, querySelector: () => ({ focus }) }] };
    cards.showModuleDetails('api');
    expect(cards.moduleDetailsOpen.api).toBe(true);
    expect(cards.uiPrefs.groupCollapseState['group-default']).toBe(false);
    expect(cards.showView).toHaveBeenCalledWith('dashboard');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

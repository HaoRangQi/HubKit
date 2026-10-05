import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const publicDir = path.join(__dirname, '../../src/web/public');
function loadDashboard(): any {
  const window: any = {};
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'app-dashboard.js'), 'utf8'), { window });
  return window.HubKitDashboard;
}

describe('verified module updates', () => {
  const modules = [
    { id: 'unchecked', updateable: true },
    { id: 'current', updateable: true },
    { id: 'behind', name: 'API', updateable: true },
    { id: 'failed', updateable: true },
    { id: 'hidden', updateable: true, visible: false },
    { id: 'unsupported', updateable: false },
  ];
  const checks = {
    current: { status: 'checked', hasUpdates: false, commitsBehind: 0 },
    behind: { status: 'checked', hasUpdates: true, commitsBehind: 3 },
    failed: { status: 'error', message: 'network failed' },
    hidden: { status: 'checked', hasUpdates: true, commitsBehind: 2 },
    unsupported: { status: 'checked', hasUpdates: true, commitsBehind: 1 },
  };

  it('does not put update capability alone into the attention list', () => {
    expect(loadDashboard().buildDashboardFocusSummary([{ id: 'api', updateable: true }]).items).toEqual([]);
  });

  it('counts successful checks separately from support, failure and unchecked modules', () => {
    expect(loadDashboard().buildModuleUpdateSummary(modules, checks)).toEqual({
      supportedCount: 4, checkedCount: 2, availableCount: 1, failedCount: 1,
    });
  });

  it('shows confirmed updates in the focus list and preserves them across refreshed module objects', () => {
    const dashboard = loadDashboard();
    const focus = dashboard.buildDashboardFocusSummary(modules, checks);
    expect(focus.items).toHaveLength(1);
    expect(focus.items[0]).toMatchObject({ kind: 'update-available', moduleId: 'behind', actionLabel: '查看更新' });
    expect(dashboard.buildDashboardFocusSummary(modules.map(module => ({ ...module })), checks)).toEqual(focus);
  });

  it('records a completed update check even if its original button was replaced during refresh', async () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const script = html.slice(html.indexOf('    async function checkAndUpdate('), html.indexOf('    async function performUpdate('));
    const states: any[] = [];
    const sandbox = {
      moduleUpdateChecks: {},
      document: { getElementById: () => null },
      window: { HubKitApi: { checkModuleUpdate: async () => ({ success: true, hasUpdates: true, commitsBehind: 2 }) } },
      setButtonBusy: jest.fn(), resetUpdateButton: jest.fn(), showToast: jest.fn(), icon: () => '',
      setModuleUpdateState: (_id: string, state: any) => states.push(state),
    };
    vm.runInNewContext(script, sandbox);
    await vm.runInNewContext("checkAndUpdate('api')", sandbox);
    expect(states[0]).toMatchObject({ status: 'checking' });
    expect(states[states.length - 1]).toMatchObject({ status: 'checked', hasUpdates: true, commitsBehind: 2 });
  });

  it('replaces previous success with an explicit failure when rechecking fails', async () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const script = html.slice(html.indexOf('    async function checkAndUpdate('), html.indexOf('    async function performUpdate('));
    const states: any[] = [];
    const sandbox = {
      moduleUpdateChecks: { api: { status: 'checked', hasUpdates: true, commitsBehind: 2 } },
      window: { HubKitApi: { checkModuleUpdate: async () => ({ success: false, error: '网络不可用' }) } },
      showToast: jest.fn(), setModuleUpdateState: (_id: string, state: any) => states.push(state),
    };
    vm.runInNewContext(script, sandbox);
    await vm.runInNewContext("checkAndUpdate('api')", sandbox);
    expect(states).toEqual([{ status: 'checking' }, { status: 'error', message: '网络不可用' }]);
  });
});

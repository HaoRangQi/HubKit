import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

function loadUiPrefs(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-ui-prefs.js'), { window });
  return (window as any).HubKitUiPrefs;
}

function extractFunctionBlock(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}(`);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = source.indexOf('{', start);
  expect(bodyStart).toBeGreaterThan(start);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Unable to extract function ${functionName}`);
}

describe('web UI preferences helper', () => {
  it('loads after dashboard helper and before the main inline app script', () => {
    const html = readWebFile('index.html');
    const dashboardScriptIndex = html.indexOf('<script src="/app-dashboard.js"></script>');
    const uiPrefsScriptIndex = html.indexOf('<script src="/app-ui-prefs.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(dashboardScriptIndex).toBeGreaterThan(-1);
    expect(uiPrefsScriptIndex).toBeGreaterThan(dashboardScriptIndex);
    expect(mainScriptIndex).toBeGreaterThan(uiPrefsScriptIndex);
  });

  it('normalizes missing and malformed preferences with theme-aware defaults', () => {
    const uiPrefs = loadUiPrefs();

    expect(uiPrefs.normalizeUiPrefs('', 'light')).toEqual({
      collapseProcessMini: false,
      collapseDashboardGroups: false,
      groupCollapseState: {},
      dashboardRefreshIntervalSeconds: 30,
      wallpaperEnabled: false,
      wallpaperUrl: '',
      wallpaperFit: 'contain',
      wallpaperPositionX: 50,
      wallpaperPositionY: 50,
      wallpaperBlur: 6,
      wallpaperOpacity: 0.92,
      wallpaperScrimOpacity: 0.35,
      glassBlur: 18,
      glassOpacity: 0.72,
      glassBorderOpacity: 0.34,
      cardSurfaceOpacity: 0.86,
      cardInnerOpacity: 0.72,
    });
    expect(uiPrefs.normalizeUiPrefs('{bad json', 'dark').wallpaperScrimOpacity).toBe(0.55);
    expect(uiPrefs.normalizeUiPrefs(['invalid'], 'light')).toEqual(uiPrefs.getDefaultUiPrefs('light'));
  });

  it('keeps valid preferences and clamps numeric ranges', () => {
    const uiPrefs = loadUiPrefs();

    expect(uiPrefs.normalizeUiPrefs({
      collapseProcessMini: true,
      collapseDashboardGroups: true,
      groupCollapseState: { 'group-api': true },
      dashboardRefreshIntervalSeconds: 700,
      wallpaperEnabled: true,
      wallpaperUrl: 'data:image/png;base64,abc',
      wallpaperFit: 'cover',
      wallpaperPositionX: 120,
      wallpaperPositionY: -10,
      wallpaperBlur: 99,
      wallpaperOpacity: 0.1,
      wallpaperScrimOpacity: 2,
      glassBlur: -1,
      glassOpacity: 1,
      glassBorderOpacity: 0,
      cardSurfaceOpacity: 2,
      cardInnerOpacity: 0.1,
    }, 'dark')).toEqual({
      collapseProcessMini: true,
      collapseDashboardGroups: true,
      groupCollapseState: { 'group-api': true },
      dashboardRefreshIntervalSeconds: 600,
      wallpaperEnabled: true,
      wallpaperUrl: 'data:image/png;base64,abc',
      wallpaperFit: 'cover',
      wallpaperPositionX: 100,
      wallpaperPositionY: 0,
      wallpaperBlur: 24,
      wallpaperOpacity: 0.35,
      wallpaperScrimOpacity: 0.8,
      glassBlur: 0,
      glassOpacity: 0.92,
      glassBorderOpacity: 0.12,
      cardSurfaceOpacity: 0.96,
      cardInnerOpacity: 0.35,
    });
  });

  it('falls back invalid preference fields without throwing', () => {
    const uiPrefs = loadUiPrefs();

    expect(uiPrefs.normalizeUiPrefs({
      collapseProcessMini: 'true',
      collapseDashboardGroups: 1,
      groupCollapseState: ['invalid'],
      dashboardRefreshIntervalSeconds: 'bad',
      wallpaperEnabled: 'true',
      wallpaperUrl: 123,
      wallpaperFit: 'tile',
      wallpaperPositionX: 'bad',
      wallpaperPositionY: Number.POSITIVE_INFINITY,
      wallpaperBlur: Number.NaN,
      wallpaperOpacity: undefined,
      wallpaperScrimOpacity: null,
    }, 'light')).toMatchObject({
      collapseProcessMini: false,
      collapseDashboardGroups: false,
      groupCollapseState: {},
      dashboardRefreshIntervalSeconds: 30,
      wallpaperEnabled: false,
      wallpaperUrl: '',
      wallpaperFit: 'contain',
      wallpaperPositionX: 50,
      wallpaperPositionY: 50,
      wallpaperBlur: 6,
      wallpaperOpacity: 0.92,
      wallpaperScrimOpacity: 0,
    });

    expect(uiPrefs.clampNumber('12.5', 0, 20, 3)).toBe(12.5);
    expect(uiPrefs.clampNumber('-1', 0, 20, 3)).toBe(0);
    expect(uiPrefs.clampNumber('30', 0, 20, 3)).toBe(20);
    expect(uiPrefs.clampNumber('bad', 0, 20, 3)).toBe(3);
  });

  it('keeps index html wrappers thin', () => {
    const html = readWebFile('index.html');

    expect(html).toContain('function loadUiPrefs() {\n      return window.HubKitUiPrefs.normalizeUiPrefs(localStorage.getItem(UI_PREFS_STORAGE_KEY), resolvedTheme);\n    }');
    expect(html).toContain('function clampNumber(value, min, max, fallback) {\n      return window.HubKitUiPrefs.clampNumber(value, min, max, fallback);\n    }');
  });

  it('drives dashboard auto refresh from UI prefs with clamped interval, timer reset, and display updates', () => {
    const html = readWebFile('index.html');
    const context = {
      uiPrefs: { dashboardRefreshIntervalSeconds: 30 },
      dashboardRefreshTimer: { id: 'existing' },
      currentView: 'dashboard',
      cleared: [] as any[],
      timerCalls: [] as Array<{ delay: number; callback: () => void }>,
      toastMessages: [] as string[],
      saveCount: 0,
      refreshCalls: [] as boolean[],
      auditCalls: 0,
      elements: {
        dashboardRefreshIntervalInput: { value: '' },
        dashboardRefreshState: { textContent: '' },
      } as Record<string, { value?: string; textContent?: string }>,
    };

    const script = [
      extractFunctionBlock(html, 'clampNumber'),
      extractFunctionBlock(html, 'getDashboardRefreshIntervalSeconds'),
      extractFunctionBlock(html, 'applyDashboardRefreshIntervalDisplay'),
      extractFunctionBlock(html, 'setupDashboardRefreshTimer'),
      extractFunctionBlock(html, 'updateDashboardRefreshInterval'),
    ].join('\n');

    const sandbox = {
      ...context,
      window: {
        HubKitUiPrefs: loadUiPrefs(),
      },
      document: {
        getElementById: (id: string) => context.elements[id] || null,
      },
      clearInterval: (timer: any) => {
        context.cleared.push(timer);
      },
      setInterval: (callback: () => void, delay: number) => {
        const timer = { id: `timer-${context.timerCalls.length + 1}` };
        context.timerCalls.push({ callback, delay });
        return timer;
      },
      saveUiPrefs: () => {
        context.saveCount += 1;
      },
      showToast: (message: string) => {
        context.toastMessages.push(message);
      },
      refreshDashboardNow: (showNotice: boolean) => {
        context.refreshCalls.push(showNotice);
      },
      fetchModuleAudit: () => {
        context.auditCalls += 1;
      },
    };

    vm.runInNewContext(script, sandbox);

    vm.runInNewContext('updateDashboardRefreshInterval(44.6);', sandbox);

    expect(context.uiPrefs.dashboardRefreshIntervalSeconds).toBe(45);
    expect(context.saveCount).toBe(1);
    expect(context.cleared).toEqual([{ id: 'existing' }]);
    expect(context.timerCalls).toHaveLength(1);
    expect(context.timerCalls[0].delay).toBe(45000);
    expect(context.elements.dashboardRefreshIntervalInput.value).toBe('45');
    expect(context.elements.dashboardRefreshState.textContent).toBe('45s');
    expect(context.toastMessages).toEqual(['自动刷新间隔已设置为 45 秒']);

    sandbox.currentView = 'dashboard';
    context.timerCalls[0].callback();
    expect(context.refreshCalls).toEqual([false]);

    sandbox.currentView = 'diagnostics';
    context.timerCalls[0].callback();
    expect(context.auditCalls).toBe(1);
    expect(context.refreshCalls).toEqual([false]);

    vm.runInNewContext('updateDashboardRefreshInterval(-1);', sandbox);
    expect(context.uiPrefs.dashboardRefreshIntervalSeconds).toBe(0);
    expect(context.elements.dashboardRefreshState.textContent).toBe('已关闭');
    expect(context.timerCalls).toHaveLength(1);
    expect(context.toastMessages.at(-1)).toBe('自动刷新已关闭');
  });
});

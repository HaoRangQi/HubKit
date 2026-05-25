import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

function loadSettingsHelper(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-settings.js'), { window });
  return (window as any).HubKitSettings;
}

function readInlineBlock(html: string, startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
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

describe('web settings helper', () => {
  const defaultStartPolicy = {
    retryCount: 1,
    retryDelayMs: 1500,
    healthCheckEnabled: true,
    preflightChecksEnabled: true,
    blockOnPortConflict: true,
  };

  it('loads after UI prefs and before the main inline app script', () => {
    const html = readWebFile('index.html');
    const uiPrefsScriptIndex = html.indexOf('<script src="/app-ui-prefs.js"></script>');
    const settingsScriptIndex = html.indexOf('<script src="/app-settings.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(uiPrefsScriptIndex).toBeGreaterThan(-1);
    expect(settingsScriptIndex).toBeGreaterThan(uiPrefsScriptIndex);
    expect(mainScriptIndex).toBeGreaterThan(settingsScriptIndex);
  });

  it('merges module start policies with stored settings taking precedence', () => {
    const helper = loadSettingsHelper();

    expect(helper.getModuleStartPolicySettings(
      { id: 'api', startPolicy: { retryCount: 2, healthCheckEnabled: false } },
      { api: { retryDelayMs: 3000, healthCheckEnabled: true } },
      defaultStartPolicy,
    )).toEqual({
      retryCount: 2,
      retryDelayMs: 3000,
      healthCheckEnabled: true,
      preflightChecksEnabled: true,
      blockOnPortConflict: true,
    });
    expect(helper.getModuleStartPolicySettings(undefined, undefined, defaultStartPolicy)).toEqual(defaultStartPolicy);
    expect(helper.getModuleStartPolicySettings({ id: ' missing ' }, { missing: { retryCount: 3 } }, defaultStartPolicy).retryCount).toBe(3);
  });

  it('orders modules from configured start order without mutating inputs', () => {
    const helper = loadSettingsHelper();
    const modules = [{ id: 'api' }, { id: 'web' }, { id: 'db' }];

    expect(helper.getOrderedModules(modules, [' db ', 'missing', 'api'])).toEqual([
      { id: 'db' },
      { id: 'api' },
      { id: 'web' },
    ]);
    expect(modules).toEqual([{ id: 'api' }, { id: 'web' }, { id: 'db' }]);
    expect(helper.getOrderedModules(modules, [])).toEqual(modules);
    expect(helper.getOrderedModules([{ id: 'a' }, undefined, 'bad', { id: 'b' }], ['b'])).toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  it('builds settings overview and risk count from pure inputs', () => {
    const helper = loadSettingsHelper();
    const modules = [
      { id: 'api', webUrl: 'http://127.0.0.1:3000', schedule: { enabled: true, startTime: '09:00' } },
      { id: 'worker', visible: false, startPolicy: { preflightChecksEnabled: false } },
      { id: 'docs', webPort: 5173 },
      { id: 'cron' },
    ];
    const settings = {
      autoStart: { api: true, docs: true },
      schedules: { cron: { enabled: true } },
      startPolicies: { worker: { blockOnPortConflict: false } },
    };

    expect(helper.getSettingsRiskCount(modules, settings, defaultStartPolicy)).toBe(2);
    expect(helper.getSettingsOverview(
      modules,
      [{ id: 'default' }, { id: 'ops' }],
      modules,
      settings,
      defaultStartPolicy,
    )).toEqual([
      { label: '自启模块', value: 2, note: '共 4 个模块，按顺序启动' },
      { label: '模块分组', value: 2, note: '1 个模块使用自定义策略' },
      { label: '入口与定时', value: 2, note: '2 个 Web 入口，1 张卡片隐藏' },
      { label: '配置风险', value: 2, note: '建议先检查启动策略和定时任务' },
    ]);
  });

  it('keeps index html wrappers thin', () => {
    const html = readWebFile('index.html');

    expect(html).toContain('function getSettingsOverview(orderedModules, groups, webUrlModules) {\n      return window.HubKitSettings.getSettingsOverview(');
    expect(html).toContain('function getSettingsRiskCount(orderedModules) {\n      return window.HubKitSettings.getSettingsRiskCount(orderedModules, settings, defaultStartPolicy);\n    }');
    expect(html).toContain('function getModuleStartPolicySettings(module) {\n      return window.HubKitSettings.getModuleStartPolicySettings(module, settings.startPolicies, defaultStartPolicy);\n    }');
    expect(html).toContain('function getOrderedModules() {\n      return window.HubKitSettings.getOrderedModules(modules, settings.startOrder);\n    }');
  });

  it('keeps settings interactions stable during background refreshes', () => {
    const html = readWebFile('index.html');
    const guardedRefreshBlocks = [
      readInlineBlock(html, 'async function fetchModules', 'async function fetchWorkspaces'),
      readInlineBlock(html, 'async function fetchWorkspaces', 'async function fetchWorkspacePlan'),
      readInlineBlock(html, 'async function fetchConfigBackups', 'async function fetchConfigRestorePreview'),
      readInlineBlock(html, 'async function fetchStartPolicyTemplates', 'async function fetchModuleAudit'),
    ];
    const interactionGuard = readInlineBlock(html, 'function isSettingsInteractionActive', 'function requestSettingsRender');
    const dirtyBlock = readInlineBlock(html, 'function markSettingsDirty', 'function updateSettingsSaveState');

    guardedRefreshBlocks.forEach((block) => {
      expect(block).toContain('requestSettingsRender();');
      expect(block).not.toContain("if (currentView === 'settings') renderSettings();");
    });
    expect(interactionGuard).toContain('settingsDirty ||');
    expect(dirtyBlock).toContain('requestSettingsRender();');
    expect(dirtyBlock).not.toContain('renderSettings();');
  });

  it('keeps settings panel navigation wired to hash targets and persisted expansion state', () => {
    const html = readWebFile('index.html');
    const showViewBlock = readInlineBlock(html, 'function showView', 'function isSettingsInteractionActive');

    expect(showViewBlock).toContain("if (hash.startsWith('#settings-panel-')) {");
    expect(showViewBlock).toContain("requestAnimationFrame(() => focusSettingsPanel(panelId));");
    expect(html).toContain("const openAttr = settingsPanels[panelId] === false ? '' : 'open';");
    expect(html).toContain("href=\"#settings-panel-${escapeAttr(panelId)}\"");
    expect(html).toContain('onclick="focusSettingsPanel(\'${jsString(panelId)}\'); return false;"');
    expect(html).toContain('function updateSettingsPanelHash(panelId) {');
  });

  it('opens and scrolls the requested settings panel, and records toggle state for later renders', () => {
    const html = readWebFile('index.html');
    const script = [
      extractFunctionBlock(html, 'initSettingsPanels'),
      extractFunctionBlock(html, 'updateSettingsPanelHash'),
      extractFunctionBlock(html, 'focusSettingsPanel'),
    ].join('\n');

    const summary = { id: 'summary' };
    const panel = {
      open: false,
      dataset: { settingsPanel: 'display' },
      listeners: {} as Record<string, () => void>,
      addEventListener(event: string, handler: () => void) {
        this.listeners[event] = handler;
      },
      querySelector(selector: string) {
        return selector === '.settings-panel-summary' ? summary : null;
      },
    };
    const context = {
      currentView: 'settings',
      settingsPanels: {} as Record<string, boolean>,
      scrollTargets: [] as any[],
      requestedFrames: 0,
      lastHash: '',
    };
    const sandbox = {
      ...context,
      document: {
        querySelectorAll: () => [panel],
        getElementById: (id: string) => (id === 'settings-panel-display' ? panel : null),
      },
      window: {
        location: { hash: '' },
        history: {
          replaceState: (_state: unknown, _title: string, hash: string) => {
            context.lastHash = hash;
          },
        },
      },
      requestAnimationFrame: (callback: () => void) => {
        context.requestedFrames += 1;
        callback();
      },
      scrollToSettingsPanel: (target: unknown) => {
        context.scrollTargets.push(target);
      },
    };

    vm.runInNewContext(script, sandbox);
    vm.runInNewContext('initSettingsPanels();', sandbox);

    expect(panel.listeners.toggle).toBeDefined();
    panel.open = true;
    panel.listeners.toggle();
    expect(context.settingsPanels.display).toBe(true);

    panel.open = false;
    vm.runInNewContext("focusSettingsPanel('display');", sandbox);

    expect(panel.open).toBe(true);
    expect(context.settingsPanels.display).toBe(true);
    expect(context.requestedFrames).toBe(1);
    expect(context.scrollTargets).toEqual([summary]);
    expect(context.lastHash).toBe('#settings-panel-display');
  });

  it('keeps dashboard refresh user-controlled and avoids websocket self-refresh loops', () => {
    const html = readWebFile('index.html');
    const timerBlock = readInlineBlock(html, 'function setupDashboardRefreshTimer', 'function updateDashboardRefreshInterval');
    const websocketBlock = readInlineBlock(html, 'function handleWebSocketMessage', 'async function fetchModules');
    const workspaceFieldBlock = readInlineBlock(html, 'function updateWorkspaceField', 'function updateWorkspaceFailurePolicy');

    expect(html).not.toContain('setInterval(fetchModules, 5000)');
    expect(html).not.toContain('setInterval(fetchWorkspaces, 10000)');
    expect(html).not.toContain('setInterval(fetchScriptBundles, 10000)');
    expect(html).not.toContain('setInterval(fetchSystemActions, 10000)');
    expect(html).toContain('id="dashboardRefreshIntervalInput"');
    expect(html).toContain('onchange="updateDashboardRefreshInterval(this.value)"');
    expect(html).toContain('onclick="refreshDashboardNow(true)"');
    expect(timerBlock).toContain("if (currentView === 'dashboard') {\n          refreshDashboardNow(false);\n          return;\n        }");
    expect(timerBlock).toContain("if (currentView === 'diagnostics') {\n          fetchModuleAudit();\n        }");
    expect(websocketBlock).toContain("if (data.type === 'module_runtime_updated') {\n        applyModuleRuntimeUpdate(data);\n      }");
    expect(websocketBlock).not.toContain("        'module_runtime_updated',");
    expect(workspaceFieldBlock).toContain('updateSettingsSaveState();');
    expect(workspaceFieldBlock).not.toContain('updateSettingsDirtyUI();');
  });
});

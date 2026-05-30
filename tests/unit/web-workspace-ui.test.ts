import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebHtml(): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public/index.html'), 'utf-8');
}

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

function loadWorkspaceHelper(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-workspace.js'), { window });
  return (window as any).HubKitWorkspace;
}

function loadDashboardHelper(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-dashboard.js'), { window });
  return (window as any).HubKitDashboard;
}

function extractFunctionBlock(source: string, functionName: string): string {
  const asyncStart = source.indexOf(`async function ${functionName}(`);
  const syncStart = source.indexOf(`function ${functionName}(`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
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

describe('workspace dashboard UI wiring', () => {
  it('loads workspace helper before the main inline app script', () => {
    const html = readWebHtml();
    const diagnosticsScriptIndex = html.indexOf('<script src="/app-diagnostics.js"></script>');
    const workspaceScriptIndex = html.indexOf('<script src="/app-workspace.js"></script>');
    const dashboardScriptIndex = html.indexOf('<script src="/app-dashboard.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(diagnosticsScriptIndex).toBeGreaterThan(-1);
    expect(workspaceScriptIndex).toBeGreaterThan(diagnosticsScriptIndex);
    expect(dashboardScriptIndex).toBeGreaterThan(workspaceScriptIndex);
    expect(mainScriptIndex).toBeGreaterThan(dashboardScriptIndex);
  });

  it('coalesces overlapping dashboard refreshes into one follow-up run', async () => {
    const html = readWebHtml();
    const script = extractFunctionBlock(html, 'refreshDashboardNow');

    let releaseFirstFetches: (() => void) | null = null;
    let fetchModulesCallCount = 0;
    const fetchCalls: string[] = [];
    const toastMessages: string[] = [];
    const sandbox = {
      dashboardRefreshRunning: false,
      pendingDashboardRefresh: false,
      fetchModules: jest.fn(() => {
        fetchCalls.push('modules');
        fetchModulesCallCount += 1;
        if (fetchModulesCallCount === 1) {
          return new Promise<void>((resolve) => {
            releaseFirstFetches = resolve;
          });
        }
        return Promise.resolve();
      }),
      fetchWorkspaces: jest.fn(async () => {
        fetchCalls.push('workspaces');
      }),
      fetchScriptBundles: jest.fn(async () => {
        fetchCalls.push('scripts');
      }),
      fetchSystemActions: jest.fn(async () => {
        fetchCalls.push('actions');
      }),
      showToast: (message: string) => {
        toastMessages.push(message);
      },
    };

    vm.runInNewContext(script, sandbox);
    const firstRun = vm.runInNewContext('refreshDashboardNow(false);', sandbox) as Promise<void>;
    await Promise.resolve();
    const secondRun = vm.runInNewContext('refreshDashboardNow(true);', sandbox) as Promise<void>;

    expect(sandbox.dashboardRefreshRunning).toBe(true);
    expect(sandbox.pendingDashboardRefresh).toBe(true);
    expect(fetchCalls).toEqual(['modules', 'workspaces', 'scripts', 'actions']);

    const finishFirstFetches = releaseFirstFetches as (() => void) | null;
    expect(finishFirstFetches).not.toBeNull();
    finishFirstFetches?.();
    await firstRun;
    await secondRun;
    await Promise.resolve();

    expect(fetchCalls).toEqual([
      'modules',
      'workspaces',
      'scripts',
      'actions',
      'modules',
      'workspaces',
      'scripts',
      'actions',
    ]);
    expect(sandbox.dashboardRefreshRunning).toBe(false);
    expect(sandbox.pendingDashboardRefresh).toBe(false);
    expect(toastMessages).toEqual([]);
  });

  it('merges workspace module order without dropping unlisted modules', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.mergeWorkspaceOrder(['api', 'web', 'db'], ['web', 'missing', 'api'])).toEqual(['web', 'api', 'db']);
    expect(workspace.mergeWorkspaceOrder(['api', 'web'], [])).toEqual(['api', 'web']);
    expect(workspace.mergeWorkspaceOrder(['api', 'web'], undefined)).toEqual(['api', 'web']);
    expect(workspace.mergeWorkspaceOrder(['', undefined, null, 'api', 'web'], ['', 'web'])).toEqual(['web', 'api']);
    expect(workspace.mergeWorkspaceOrder([' api ', ' web '], [' web ', 'missing', ' api '])).toEqual(['web', 'api']);
    expect(workspace.mergeWorkspaceOrder(undefined, ['web'])).toEqual([]);
    expect(workspace.mergeWorkspaceOrder({ id: 'api' }, ['api'])).toEqual([]);
    expect(workspace.mergeWorkspaceOrder(['api'], { id: 'api' })).toEqual(['api']);
  });

  it('resolves module group assignment from module data and settings fallback', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.getModuleGroupId({ id: 'api', groupId: 'backend' }, { api: 'frontend' })).toBe('backend');
    expect(workspace.getModuleGroupId({ id: 'web' }, { web: 'frontend' })).toBe('frontend');
    expect(workspace.getModuleGroupId({ id: ' web ' }, { web: 'frontend' })).toBe('frontend');
    expect(workspace.getModuleGroupId({ id: 'worker' }, {})).toBe('default');
    expect(workspace.getModuleGroupId({ id: 'blank', groupId: '   ' }, { blank: 'frontend' })).toBe('frontend');
    expect(workspace.getModuleGroupId({ id: 'blank-setting' }, { 'blank-setting': '   ' })).toBe('default');
    expect(workspace.getModuleGroupId(undefined, { api: 'backend' })).toBe('default');
  });

  it('checks whether a module is selected in a workspace', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.isWorkspaceModuleSelected({ moduleIds: ['api', 'web'] }, 'web')).toBe(true);
    expect(workspace.isWorkspaceModuleSelected({ moduleIds: [' api ', ' web '] }, ' web ')).toBe(true);
    expect(workspace.isWorkspaceModuleSelected({ moduleIds: ['api'] }, 'web')).toBe(false);
    expect(workspace.isWorkspaceModuleSelected({ moduleIds: undefined }, 'web')).toBe(false);
    expect(workspace.isWorkspaceModuleSelected({ moduleIds: [''] }, '')).toBe(false);
    expect(workspace.isWorkspaceModuleSelected({ moduleIds: ['api'] }, undefined)).toBe(false);
    expect(workspace.isWorkspaceModuleSelected(undefined, 'web')).toBe(false);
  });

  it('builds workspace module toggle display data', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceModuleToggleViewModel(
      { id: 'dev', moduleIds: ['api'] },
      { id: 'api', name: 'API 服务' },
    )).toEqual({
      workspaceId: 'dev',
      moduleId: 'api',
      moduleName: 'API 服务',
      checked: true,
    });
    expect(workspace.buildWorkspaceModuleToggleViewModel(
      { id: 'dev', moduleIds: ['api'] },
      { id: ' api ', name: '  API 服务  ' },
    )).toEqual({
      workspaceId: 'dev',
      moduleId: 'api',
      moduleName: 'API 服务',
      checked: true,
    });
    expect(workspace.buildWorkspaceModuleToggleViewModel(
      { id: 'dev', moduleIds: ['api'] },
      { id: 'web' },
    )).toEqual({
      workspaceId: 'dev',
      moduleId: 'web',
      moduleName: 'web',
      checked: false,
    });
    expect(workspace.buildWorkspaceModuleToggleViewModel(
      { id: 'dev', moduleIds: ['api'] },
      { id: 'blank', name: '   ' },
    )).toEqual({
      workspaceId: 'dev',
      moduleId: 'blank',
      moduleName: 'blank',
      checked: false,
    });
    expect(workspace.buildWorkspaceModuleToggleViewModel(undefined, undefined)).toEqual({
      workspaceId: '',
      moduleId: '',
      moduleName: '未命名模块',
      checked: false,
    });
  });

  it('builds workspace dashboard drafts without sharing mutable arrays', () => {
    const workspace = loadWorkspaceHelper();
    const source = [{
      id: 'dev',
      name: '开发环境',
      moduleIds: ['api', 'web'],
      startOrder: ['api'],
      stopOrder: ['web'],
      failurePolicy: 'stop',
    }];

    const drafts = workspace.buildWorkspaceDashboardDrafts(source);

    expect(drafts).toEqual(source);
    expect(drafts).not.toBe(source);
    expect(drafts[0]).not.toBe(source[0]);
    expect(drafts[0].moduleIds).not.toBe(source[0].moduleIds);
    expect(drafts[0].startOrder).not.toBe(source[0].startOrder);
    expect(drafts[0].stopOrder).not.toBe(source[0].stopOrder);

    source[0].moduleIds.push('db');
    source[0].startOrder.push('web');
    source[0].stopOrder.push('api');

    expect(drafts[0].moduleIds).toEqual(['api', 'web']);
    expect(drafts[0].startOrder).toEqual(['api']);
    expect(drafts[0].stopOrder).toEqual(['web']);
  });

  it('defaults workspace dashboard draft arrays when source values are missing', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceDashboardDrafts([{ id: 'empty', name: '空工作区' }])).toEqual([{
      id: 'empty',
      name: '空工作区',
      moduleIds: [],
      startOrder: [],
      stopOrder: [],
    }]);
    expect(workspace.buildWorkspaceDashboardDrafts(undefined)).toEqual([]);
    expect(workspace.buildWorkspaceDashboardDrafts({ id: 'invalid' })).toEqual([]);
    expect(workspace.buildWorkspaceDashboardDrafts([
      undefined,
      null,
      'invalid',
      { name: '无 ID 工作区' },
      { id: '   ', name: '空白 ID 工作区' },
      { id: 'valid' },
    ])).toEqual([{
      id: 'valid',
      moduleIds: [],
      startOrder: [],
      stopOrder: [],
    }]);
    expect(workspace.buildWorkspaceDashboardDrafts([{
      id: ' dev ',
      moduleIds: [' api ', '   ', 'web'],
      startOrder: [' web ', 'missing', ' api '],
      stopOrder: ['missing', ' api '],
    }])).toEqual([{
      id: 'dev',
      moduleIds: ['api', 'web'],
      startOrder: ['web', 'api'],
      stopOrder: ['api'],
    }]);
  });

  it('generates workspace ids while avoiding existing drafts', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.generateWorkspaceId([], { nowToken: 'abc' })).toBe('workspace-abc');
    expect(workspace.generateWorkspaceId(['workspace-abc'], { nowToken: 'abc' })).toBe('workspace-abc-1');
    expect(workspace.generateWorkspaceId([' workspace-abc '], { nowToken: 'abc' })).toBe('workspace-abc-1');
    expect(
      workspace.generateWorkspaceId(
        Array.from({ length: 1000 }, (_, index) => `workspace-abc${index === 0 ? '' : `-${index}`}`),
        { nowToken: 'abc', randomToken: 'fallback' },
      ),
    ).toBe('workspace-abc-fallback');
    expect(workspace.generateWorkspaceId({ id: 'workspace-abc' }, { nowToken: 'abc' })).toBe('workspace-abc');
    expect(workspace.generateWorkspaceId([], null)).toMatch(/^workspace-/);
  });

  it('creates a default workspace draft with independent arrays', () => {
    const workspace = loadWorkspaceHelper();
    const draft = workspace.createWorkspaceDraft(' workspace-abc ');

    expect(draft).toEqual({
      id: 'workspace-abc',
      name: '新工作区',
      description: '',
      moduleIds: [],
      startOrder: [],
      stopOrder: [],
      failurePolicy: 'stop',
    });
    expect(draft.moduleIds).not.toBe(workspace.createWorkspaceDraft('workspace-def').moduleIds);
  });

  it('updates workspace module selection without duplicating selected modules', () => {
    const workspace = loadWorkspaceHelper();
    const source = {
      id: 'dev',
      moduleIds: ['api'],
      startOrder: ['api'],
      stopOrder: ['api'],
    };

    expect(workspace.updateWorkspaceModuleSelection(source, 'web', true)).toEqual({
      id: 'dev',
      moduleIds: ['api', 'web'],
      startOrder: ['api'],
      stopOrder: ['api'],
    });
    expect(workspace.updateWorkspaceModuleSelection(source, 'api', true)).toEqual({
      id: 'dev',
      moduleIds: ['api'],
      startOrder: ['api'],
      stopOrder: ['api'],
    });
    expect(workspace.updateWorkspaceModuleSelection({
      id: 'dev',
      moduleIds: [' api ', ''],
      startOrder: [' api ', ''],
      stopOrder: [' api ', ''],
    }, ' web ', true)).toEqual({
      id: 'dev',
      moduleIds: ['api', 'web'],
      startOrder: ['api'],
      stopOrder: ['api'],
    });
  });

  it('removes workspace modules and prunes start and stop order', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.updateWorkspaceModuleSelection({
      id: 'dev',
      moduleIds: ['api', 'web', 'db'],
      startOrder: ['api', 'web', 'missing'],
      stopOrder: ['db', 'web', 'api'],
    }, 'web', false)).toEqual({
      id: 'dev',
      moduleIds: ['api', 'db'],
      startOrder: ['api'],
      stopOrder: ['db', 'api'],
    });
  });

  it('defaults workspace module selection arrays when source values are missing', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.updateWorkspaceModuleSelection({ id: 'empty' }, 'api', true)).toEqual({
      id: 'empty',
      moduleIds: ['api'],
      startOrder: [],
      stopOrder: [],
    });
    expect(workspace.updateWorkspaceModuleSelection({ id: 'empty' }, 'api', false)).toEqual({
      id: 'empty',
      moduleIds: [],
      startOrder: [],
      stopOrder: [],
    });
    expect(workspace.updateWorkspaceModuleSelection({
      id: 'empty',
      moduleIds: ['api', '   '],
      startOrder: ['api', 'missing', '   '],
      stopOrder: ['missing', 'api', '   '],
    }, '   ', true)).toEqual({
      id: 'empty',
      moduleIds: ['api'],
      startOrder: ['api'],
      stopOrder: ['api'],
    });
    expect(workspace.updateWorkspaceModuleSelection(undefined, 'api', true)).toBeNull();
  });

  it('updates workspace metadata fields with trimming and name fallback', () => {
    const workspace = loadWorkspaceHelper();
    const source = { id: 'dev', name: '旧名称', description: '旧说明' };

    expect(workspace.updateWorkspaceMetadataField(source, 'name', '  新名称  ')).toEqual({
      id: 'dev',
      name: '新名称',
      description: '旧说明',
    });
    expect(workspace.updateWorkspaceMetadataField(source, 'name', '   ')).toEqual({
      id: 'dev',
      name: '未命名工作区',
      description: '旧说明',
    });
    expect(workspace.updateWorkspaceMetadataField(source, 'description', '  新说明  ')).toEqual({
      id: 'dev',
      name: '旧名称',
      description: '新说明',
    });
  });

  it('ignores invalid workspace metadata updates', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.updateWorkspaceMetadataField({ id: 'dev' }, 'failurePolicy', 'continue')).toBeNull();
    expect(workspace.updateWorkspaceMetadataField(undefined, 'name', '开发环境')).toBeNull();
  });

  it('normalizes workspace failure policy values', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.updateWorkspaceFailurePolicy({ id: 'dev', failurePolicy: 'stop' }, 'continue')).toEqual({
      id: 'dev',
      failurePolicy: 'continue',
    });
    expect(workspace.updateWorkspaceFailurePolicy({ id: 'dev', failurePolicy: 'continue' }, 'unexpected')).toEqual({
      id: 'dev',
      failurePolicy: 'stop',
    });
    expect(workspace.updateWorkspaceFailurePolicy(undefined, 'continue')).toBeNull();
  });

  it('removes workspace drafts by id without mutating the source list', () => {
    const workspace = loadWorkspaceHelper();
    const source = [
      { id: 'dev', name: '开发环境' },
      { id: 'ops', name: '系统维护' },
    ];

    const next = workspace.removeWorkspaceDraft(source, 'dev');

    expect(next).toEqual([{ id: 'ops', name: '系统维护' }]);
    expect(next).not.toBe(source);
    expect(source).toEqual([
      { id: 'dev', name: '开发环境' },
      { id: 'ops', name: '系统维护' },
    ]);
    expect(workspace.removeWorkspaceDraft(source, ' ops ')).toEqual([{ id: 'dev', name: '开发环境' }]);
    expect(workspace.removeWorkspaceDraft(source, 'missing')).toEqual(source);
    expect(workspace.removeWorkspaceDraft(undefined, 'dev')).toEqual([]);
    expect(workspace.removeWorkspaceDraft({ id: 'invalid' }, 'dev')).toEqual([]);
    expect(workspace.removeWorkspaceDraft([
      undefined,
      null,
      'invalid',
      { name: '无 ID 工作区' },
      { id: '   ', name: '空白 ID 工作区' },
      { id: 'ops' },
    ], 'dev')).toEqual([{ id: 'ops' }]);
  });

  it('builds workspace card display data from workspace settings', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceCardViewModel({
      moduleIds: ['api', 'web', 'db'],
      startOrder: ['web', 'missing', 'api'],
      failurePolicy: 'continue',
    })).toEqual({
      moduleIds: ['api', 'web', 'db'],
      failurePolicy: 'continue',
      policyText: '失败后继续',
      orderedIds: ['web', 'api', 'db'],
    });
    expect(workspace.buildWorkspaceCardViewModel({
      moduleIds: ['api', 'web'],
      startOrder: [],
      failurePolicy: 'unknown',
    })).toEqual({
      moduleIds: ['api', 'web'],
      failurePolicy: 'stop',
      policyText: '失败后中断',
      orderedIds: ['api', 'web'],
    });
    expect(workspace.buildWorkspaceCardViewModel({
      moduleIds: ['', undefined, null, 'api'],
      startOrder: ['', 'api'],
    })).toEqual({
      moduleIds: ['api'],
      failurePolicy: 'stop',
      policyText: '失败后中断',
      orderedIds: ['api'],
    });
    expect(workspace.buildWorkspaceCardViewModel({
      moduleIds: [' api ', ' web ', '   '],
      startOrder: [' web ', ' api '],
    })).toEqual({
      moduleIds: ['api', 'web'],
      failurePolicy: 'stop',
      policyText: '失败后中断',
      orderedIds: ['web', 'api'],
    });
  });

  it('defaults workspace card display data when workspace values are missing', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceCardViewModel({})).toEqual({
      moduleIds: [],
      failurePolicy: 'stop',
      policyText: '失败后中断',
      orderedIds: [],
    });
    expect(workspace.buildWorkspaceCardViewModel(undefined)).toEqual({
      moduleIds: [],
      failurePolicy: 'stop',
      policyText: '失败后中断',
      orderedIds: [],
    });
  });

  it('builds workspace card copy with safe fallbacks', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceCardCopy({
      id: ' dev ',
      name: '开发环境',
      description: '启动 API 与 Web 控制台',
    })).toEqual({
      id: 'dev',
      title: '开发环境',
      description: '启动 API 与 Web 控制台',
    });
    expect(workspace.buildWorkspaceCardCopy({ id: 'ops' })).toEqual({
      id: 'ops',
      title: 'ops',
      description: '按场景批量启动或停止一组本地模块。',
    });
    expect(workspace.buildWorkspaceCardCopy({
      id: 'blank',
      name: '   ',
      description: '   ',
    })).toEqual({
      id: 'blank',
      title: 'blank',
      description: '按场景批量启动或停止一组本地模块。',
    });
    expect(workspace.buildWorkspaceCardCopy(undefined)).toEqual({
      id: '',
      title: '未命名工作区',
      description: '按场景批量启动或停止一组本地模块。',
    });
  });

  it('builds workspace card runtime state from dashboard maps', () => {
    const workspace = loadWorkspaceHelper();
    const plan = { action: 'start', steps: [] };

    expect(workspace.buildWorkspaceCardRuntimeState(
      ' dev ',
      { dev: plan },
      { dev: 'start' },
      { dev: true },
    )).toEqual({
      plan,
      actionLoading: 'start',
      planLoading: true,
    });
    expect(workspace.buildWorkspaceCardRuntimeState('ops', {}, {}, {})).toEqual({
      plan: undefined,
      actionLoading: '',
      planLoading: false,
    });
    expect(workspace.buildWorkspaceCardRuntimeState(undefined, undefined, undefined, undefined)).toEqual({
      plan: undefined,
      actionLoading: '',
      planLoading: false,
    });
    expect(workspace.buildWorkspaceCardRuntimeState('dev', 'invalid', 1, false)).toEqual({
      plan: undefined,
      actionLoading: '',
      planLoading: false,
    });
    expect(workspace.buildWorkspaceCardRuntimeState(
      'dev',
      {},
      { dev: { action: 'start' } },
      { dev: true },
    )).toEqual({
      plan: undefined,
      actionLoading: '',
      planLoading: true,
    });
  });

  it('builds workspace editor display data with safe fallbacks', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceEditorViewModel({
      id: ' dev ',
      name: '开发环境',
      description: '启动 API 与 Web 控制台',
      moduleIds: ['api', 'web'],
      failurePolicy: 'continue',
    })).toEqual({
      id: 'dev',
      title: '开发环境',
      nameInputId: 'workspace-name-dev',
      descriptionInputId: 'workspace-desc-dev',
      policySelectId: 'workspace-policy-dev',
      nameValue: '开发环境',
      descriptionValue: '启动 API 与 Web 控制台',
      moduleIds: ['api', 'web'],
      selectedCount: 2,
      failurePolicy: 'continue',
      isStopSelected: false,
      isContinueSelected: true,
    });
    expect(workspace.buildWorkspaceEditorViewModel({ id: 'empty', failurePolicy: 'unexpected' })).toEqual({
      id: 'empty',
      title: '未命名工作区',
      nameInputId: 'workspace-name-empty',
      descriptionInputId: 'workspace-desc-empty',
      policySelectId: 'workspace-policy-empty',
      nameValue: '',
      descriptionValue: '',
      moduleIds: [],
      selectedCount: 0,
      failurePolicy: 'stop',
      isStopSelected: true,
      isContinueSelected: false,
    });
    expect(workspace.buildWorkspaceEditorViewModel({ id: 'blank-name', name: '   ' })).toEqual({
      id: 'blank-name',
      title: '未命名工作区',
      nameInputId: 'workspace-name-blank-name',
      descriptionInputId: 'workspace-desc-blank-name',
      policySelectId: 'workspace-policy-blank-name',
      nameValue: '   ',
      descriptionValue: '',
      moduleIds: [],
      selectedCount: 0,
      failurePolicy: 'stop',
      isStopSelected: true,
      isContinueSelected: false,
    });
    expect(workspace.buildWorkspaceEditorViewModel({
      id: 'invalid-modules',
      moduleIds: ['', undefined, null, ' api ', '   '],
    })).toEqual({
      id: 'invalid-modules',
      title: '未命名工作区',
      nameInputId: 'workspace-name-invalid-modules',
      descriptionInputId: 'workspace-desc-invalid-modules',
      policySelectId: 'workspace-policy-invalid-modules',
      nameValue: '',
      descriptionValue: '',
      moduleIds: ['api'],
      selectedCount: 1,
      failurePolicy: 'stop',
      isStopSelected: true,
      isContinueSelected: false,
    });
    expect(workspace.buildWorkspaceEditorViewModel(undefined)).toEqual({
      id: '',
      title: '未命名工作区',
      nameInputId: 'workspace-name-',
      descriptionInputId: 'workspace-desc-',
      policySelectId: 'workspace-policy-',
      nameValue: '',
      descriptionValue: '',
      moduleIds: [],
      selectedCount: 0,
      failurePolicy: 'stop',
      isStopSelected: true,
      isContinueSelected: false,
    });
  });

  it('builds workspace settings display data with empty state copy', () => {
    const workspace = loadWorkspaceHelper();
    const source = [{ id: 'dev', name: '开发环境' }];

    expect(workspace.buildWorkspaceSettingsViewModel(source)).toEqual({
      items: source,
      hasWorkspaces: true,
      emptyText: '暂无工作区；可以创建“开发环境”“系统维护”等场景。',
    });
    expect(workspace.buildWorkspaceSettingsViewModel([])).toEqual({
      items: [],
      hasWorkspaces: false,
      emptyText: '暂无工作区；可以创建“开发环境”“系统维护”等场景。',
    });
    expect(workspace.buildWorkspaceSettingsViewModel(undefined)).toEqual({
      items: [],
      hasWorkspaces: false,
      emptyText: '暂无工作区；可以创建“开发环境”“系统维护”等场景。',
    });
    expect(workspace.buildWorkspaceSettingsViewModel([
      undefined,
      null,
      { name: '无 ID 工作区' },
      { id: '   ', name: '空白 ID 工作区' },
      { id: ' valid ' },
    ])).toEqual({
      items: [{ id: 'valid' }],
      hasWorkspaces: true,
      emptyText: '暂无工作区；可以创建“开发环境”“系统维护”等场景。',
    });
  });

  it('builds workspace editor module list display data with empty state copy', () => {
    const workspace = loadWorkspaceHelper();
    const source = [{ id: 'api', name: 'API 服务' }];

    expect(workspace.buildWorkspaceEditorModulesViewModel(source)).toEqual({
      items: source,
      hasModules: true,
      emptyText: '暂无模块可加入工作区',
    });
    expect(workspace.buildWorkspaceEditorModulesViewModel([])).toEqual({
      items: [],
      hasModules: false,
      emptyText: '暂无模块可加入工作区',
    });
    expect(workspace.buildWorkspaceEditorModulesViewModel(undefined)).toEqual({
      items: [],
      hasModules: false,
      emptyText: '暂无模块可加入工作区',
    });
    expect(workspace.buildWorkspaceEditorModulesViewModel([
      undefined,
      null,
      { name: '无 ID 模块' },
      { id: '   ', name: '空白 ID 模块' },
      { id: ' api ' },
    ])).toEqual({
      items: [{ id: 'api' }],
      hasModules: true,
      emptyText: '暂无模块可加入工作区',
    });
  });

  it('builds workspace card metrics from module ids and plan state', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceCardMetrics(['api', 'web'], undefined)).toEqual({
      moduleCount: 2,
      runnableCount: 2,
      missingCount: 0,
      recentPlanText: '未加载',
    });
    expect(workspace.buildWorkspaceCardMetrics(['api', 'web', 'db'], {
      action: 'start',
      runnableModuleIds: ['api', 'web'],
      missingModuleIds: ['db'],
    })).toEqual({
      moduleCount: 3,
      runnableCount: 2,
      missingCount: 1,
      recentPlanText: '启动',
    });
    expect(workspace.buildWorkspaceCardMetrics(['api'], {
      action: 'stop',
      runnableModuleIds: ['api'],
      missingModuleIds: [],
    })).toEqual({
      moduleCount: 1,
      runnableCount: 1,
      missingCount: 0,
      recentPlanText: '停止',
    });
    expect(workspace.buildWorkspaceCardMetrics(['api'], {
      action: ' start ',
      runnableModuleIds: [' api '],
      missingModuleIds: [],
    })).toEqual({
      moduleCount: 1,
      runnableCount: 1,
      missingCount: 0,
      recentPlanText: '启动',
    });
    expect(workspace.buildWorkspaceCardMetrics(['api'], {
      action: ' stop ',
      runnableModuleIds: ['api'],
      missingModuleIds: [],
    })).toEqual({
      moduleCount: 1,
      runnableCount: 1,
      missingCount: 0,
      recentPlanText: '停止',
    });
    expect(workspace.buildWorkspaceCardMetrics(['', undefined, null, 'api'], undefined)).toEqual({
      moduleCount: 1,
      runnableCount: 1,
      missingCount: 0,
      recentPlanText: '未加载',
    });
    expect(workspace.buildWorkspaceCardMetrics([' api ', '   ', 'web'], undefined)).toEqual({
      moduleCount: 2,
      runnableCount: 2,
      missingCount: 0,
      recentPlanText: '未加载',
    });
  });

  it('defaults workspace card metrics when plan arrays are missing', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceCardMetrics(undefined, {
      action: 'custom',
      runnableModuleIds: undefined,
      missingModuleIds: undefined,
    })).toEqual({
      moduleCount: 0,
      runnableCount: 0,
      missingCount: 0,
      recentPlanText: '已加载',
    });
    expect(workspace.buildWorkspaceCardMetrics(['api'], {
      action: 'custom',
      runnableModuleIds: ['', undefined, null, ' api '],
      missingModuleIds: ['', undefined, null, ' db '],
    })).toEqual({
      moduleCount: 1,
      runnableCount: 1,
      missingCount: 1,
      recentPlanText: '已加载',
    });
    expect(workspace.buildWorkspaceCardMetrics(['api'], 'invalid')).toEqual({
      moduleCount: 1,
      runnableCount: 1,
      missingCount: 0,
      recentPlanText: '未加载',
    });
  });

  it('builds workspace plan loading text for card display', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspacePlanLoadingText(undefined, true)).toBe('加载中...');
    expect(workspace.buildWorkspacePlanLoadingText({ steps: [] }, false)).toBe('已加载');
    expect(workspace.buildWorkspacePlanLoadingText({ steps: [] }, 'true')).toBe('已加载');
    expect(workspace.buildWorkspacePlanLoadingText('invalid', false)).toBe('未加载');
    expect(workspace.buildWorkspacePlanLoadingText([], false)).toBe('未加载');
    expect(workspace.buildWorkspacePlanLoadingText(undefined, false)).toBe('未加载');
  });

  it('builds workspace action button display states', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceActionButtons(false, '')).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: false, icon: 'play_circle', label: '启动' },
      stop: { disabled: false, icon: 'stop_circle', label: '停止' },
    });
    expect(workspace.buildWorkspaceActionButtons(false, '   ')).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: false, icon: 'play_circle', label: '启动' },
      stop: { disabled: false, icon: 'stop_circle', label: '停止' },
    });
    expect(workspace.buildWorkspaceActionButtons(true, '')).toEqual({
      plan: { disabled: true, icon: 'progress_activity', label: '加载中...' },
      start: { disabled: false, icon: 'play_circle', label: '启动' },
      stop: { disabled: false, icon: 'stop_circle', label: '停止' },
    });
    expect(workspace.buildWorkspaceActionButtons(false, 'start')).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: true, icon: 'progress_activity', label: '启动中...' },
      stop: { disabled: true, icon: 'stop_circle', label: '停止' },
    });
    expect(workspace.buildWorkspaceActionButtons(false, 'stop')).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: true, icon: 'play_circle', label: '启动' },
      stop: { disabled: true, icon: 'progress_activity', label: '停止中...' },
    });
    expect(workspace.buildWorkspaceActionButtons(false, 'restart')).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: true, icon: 'progress_activity', label: '处理中...' },
      stop: { disabled: true, icon: 'progress_activity', label: '处理中...' },
    });
    expect(workspace.buildWorkspaceActionButtons(false, { action: 'start' })).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: false, icon: 'play_circle', label: '启动' },
      stop: { disabled: false, icon: 'stop_circle', label: '停止' },
    });
    expect(workspace.buildWorkspaceActionButtons(false, ['stop'])).toEqual({
      plan: { disabled: false, icon: 'article', label: '计划' },
      start: { disabled: false, icon: 'play_circle', label: '启动' },
      stop: { disabled: false, icon: 'stop_circle', label: '停止' },
    });
  });

  it('builds workspace plan and run summaries for card display', () => {
    const workspace = loadWorkspaceHelper();
    const formatStepResult = (value: string) => ({
      succeeded: '成功',
      failed: '失败',
      skipped: '跳过',
      missing: '缺失',
    }[value] || '就绪');

    expect(workspace.buildWorkspacePlanSummaries(undefined, formatStepResult)).toEqual({
      planSummary: '点击“计划”查看启动顺序和缺失模块',
      runSummary: '点击“计划”查看启动顺序和缺失模块',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      steps: [
        { status: 'ready', moduleName: 'API', moduleId: 'api' },
        { status: 'missing', moduleId: 'db' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：API；缺失：db',
      runSummary: '就绪：API；缺失：db',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: 'start',
      steps: [
        { status: 'ready', result: 'succeeded', moduleName: 'API', moduleId: 'api' },
        { status: 'ready', result: 'failed', moduleName: 'Web', moduleId: 'web' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：API；就绪：Web',
      runSummary: '成功：API；失败：Web',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: ' start ',
      steps: [
        { status: 'ready', result: 'succeeded', moduleName: 'API', moduleId: 'api' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：API',
      runSummary: '成功：API',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: '   ',
      steps: [
        { status: 'ready', result: 'failed', moduleName: 'API', moduleId: 'api' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：API',
      runSummary: '就绪：API',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: { type: 'start' },
      steps: [
        { status: 'ready', result: 'failed', moduleName: 'API', moduleId: 'api' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：API',
      runSummary: '就绪：API',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: 'start',
      steps: [
        { status: 'ready', result: 'succeeded' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：未命名模块',
      runSummary: '成功：未命名模块',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: 'start',
      steps: [
        { status: 'ready', result: 'succeeded', moduleName: '   ', moduleId: ' api ' },
        { status: 'missing', result: 'missing', moduleName: '  Web 控制台  ', moduleId: 'web' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：api；缺失：Web 控制台',
      runSummary: '成功：api；缺失：Web 控制台',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: 'start',
      steps: [
        { status: ' missing ', result: ' missing ', moduleId: ' db ' },
        { status: ' ready ', result: ' succeeded ', moduleId: ' api ' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '缺失：db；就绪：api',
      runSummary: '缺失：db；成功：api',
    });
    expect(workspace.buildWorkspacePlanSummaries({
      action: 'start',
      steps: [
        undefined,
        null,
        'invalid',
        { status: 'ready', result: 'succeeded', moduleName: 'API', moduleId: 'api' },
      ],
    }, formatStepResult)).toEqual({
      planSummary: '就绪：API',
      runSummary: '成功：API',
    });
  });

  it('limits workspace plan summaries to the first five steps', () => {
    const workspace = loadWorkspaceHelper();
    const steps = Array.from({ length: 6 }, (_, index) => ({
      status: index === 1 ? 'missing' : 'ready',
      moduleId: `module-${index + 1}`,
    }));

    expect(workspace.buildWorkspacePlanSummaries({ steps })).toEqual({
      planSummary: '就绪：module-1；缺失：module-2；就绪：module-3；就绪：module-4；就绪：module-5',
      runSummary: '就绪：module-1；缺失：module-2；就绪：module-3；就绪：module-4；就绪：module-5',
    });
  });

  it('builds workspace module name summaries for card display', () => {
    const workspace = loadWorkspaceHelper();
    const namesById: Record<string, string> = {
      api: 'API 服务',
      web: 'Web 控制台',
      db: '数据库',
      worker: '任务队列',
      docs: '文档站',
      cache: '缓存',
    };

    expect(workspace.buildWorkspaceModuleNames(
      ['api', 'web', 'db', 'worker', 'docs', 'cache'],
      (moduleId: string) => namesById[moduleId] || moduleId,
    )).toBe('API 服务、Web 控制台、数据库、任务队列、文档站');
    expect(workspace.buildWorkspaceModuleNames(['missing'], undefined)).toBe('missing');
    expect(workspace.buildWorkspaceModuleNames(['missing'], (moduleId: string) => namesById[moduleId])).toBe('missing');
    expect(workspace.buildWorkspaceModuleNames(['blank'], () => '   ')).toBe('blank');
    expect(workspace.buildWorkspaceModuleNames(['', undefined, null, ' api '], (moduleId: string) => namesById[moduleId])).toBe('API 服务');
    expect(workspace.buildWorkspaceModuleNames([], (moduleId: string) => namesById[moduleId])).toBe('未配置模块');
    expect(workspace.buildWorkspaceModuleNames(undefined, (moduleId: string) => namesById[moduleId])).toBe('未配置模块');
  });

  it('builds visible module groups from module and settings assignments', () => {
    const workspace = loadWorkspaceHelper();
    const visibleModules = [
      { id: 'api', name: 'API', groupId: 'backend' },
      { id: ' web ', name: 'Web' },
      { id: 'docs', name: 'Docs', groupId: 'missing' },
      { id: 'worker', name: 'Worker' },
      { id: '   ', name: '空白模块' },
    ];
    const groups = [
      { id: ' backend ', name: '后端' },
      { id: 'frontend', name: '前端' },
      { id: '   ', name: '空白分组' },
    ];
    const moduleGroups = {
      web: 'frontend',
      worker: 'unknown',
    };

    expect(workspace.buildVisibleModuleGroups(visibleModules, groups, moduleGroups)).toEqual([
      {
        id: 'backend',
        name: '后端',
        modules: [{ id: 'api', name: 'API', groupId: 'backend' }],
      },
      {
        id: 'frontend',
        name: '前端',
        modules: [{ id: ' web ', name: 'Web' }],
      },
      {
        id: 'default',
        name: '默认分组',
        modules: [
          { id: 'docs', name: 'Docs', groupId: 'missing' },
          { id: 'worker', name: 'Worker' },
        ],
      },
    ]);
  });

  it('uses the default module group when settings groups are empty or modules are absent', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildVisibleModuleGroups([{ id: 'api', name: 'API' }], [], undefined)).toEqual([
      {
        id: 'default',
        name: '默认分组',
        modules: [{ id: 'api', name: 'API' }],
      },
    ]);
    expect(workspace.buildVisibleModuleGroups([], [], undefined)).toEqual([]);
    expect(workspace.buildVisibleModuleGroups(undefined, undefined, undefined)).toEqual([]);
  });

  it('ignores invalid module entries when building visible groups', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildVisibleModuleGroups([
      undefined,
      null,
      { name: '无 ID 模块' },
      { id: 'api', name: 'API' },
    ], [], undefined)).toEqual([
      {
        id: 'default',
        name: '默认分组',
        modules: [{ id: 'api', name: 'API' }],
      },
    ]);
    expect(workspace.buildVisibleModuleGroups({ id: 'api' }, [], undefined)).toEqual([]);
    expect(workspace.buildVisibleModuleGroups(
      [{ id: 'api', name: 'API' }],
      [undefined, null, { name: '无 ID 分组' }, { id: 'backend', name: '后端' }],
      null,
    )).toEqual([
      {
        id: 'default',
        name: '默认分组',
        modules: [{ id: 'api', name: 'API' }],
      },
    ]);
  });

  it('builds the workspace dashboard section from live workspaces first', () => {
    const workspace = loadWorkspaceHelper();
    const liveWorkspaces = [{ id: ' live ', name: '运行态工作区' }];
    const settingsWorkspaces = [{ id: 'settings', name: '设置工作区' }];

    expect(workspace.buildWorkspaceDashboardSection(liveWorkspaces, settingsWorkspaces)).toEqual({
      id: 'workspace-orchestration',
      kind: 'workspace',
      name: '工作区编排',
      icon: 'dashboard',
      accent: 'var(--md-secondary)',
      kicker: '场景启动',
      items: [{ id: 'live', name: '运行态工作区' }],
    });
  });

  it('falls back to settings workspaces for the dashboard section', () => {
    const workspace = loadWorkspaceHelper();
    const settingsWorkspaces = [{ id: 'settings', name: '设置工作区' }];

    expect(workspace.buildWorkspaceDashboardSection([], settingsWorkspaces)).toEqual({
      id: 'workspace-orchestration',
      kind: 'workspace',
      name: '工作区编排',
      icon: 'dashboard',
      accent: 'var(--md-secondary)',
      kicker: '场景启动',
      items: settingsWorkspaces,
    });
    expect(workspace.buildWorkspaceDashboardSection(undefined, settingsWorkspaces)?.items).toEqual(settingsWorkspaces);
    expect(workspace.buildWorkspaceDashboardSection([
      undefined,
      null,
      { name: '无 ID 工作区' },
      { id: '   ', name: '空白 ID 工作区' },
    ], settingsWorkspaces)?.items)
      .toEqual(settingsWorkspaces);
    expect(workspace.buildWorkspaceDashboardSection([], [
      { id: '   ', name: '空白 ID 工作区' },
      { id: ' settings ', name: '设置工作区' },
    ])?.items).toEqual([{ id: 'settings', name: '设置工作区' }]);
  });

  it('omits the workspace dashboard section when no workspaces are configured', () => {
    const workspace = loadWorkspaceHelper();

    expect(workspace.buildWorkspaceDashboardSection([], [])).toBeNull();
    expect(workspace.buildWorkspaceDashboardSection([
      undefined,
      null,
      { name: '无 ID 工作区' },
      { id: '   ', name: '空白 ID 工作区' },
    ], [])).toBeNull();
    expect(workspace.buildWorkspaceDashboardSection(undefined, undefined)).toBeNull();
  });

  it('builds dashboard sections from pure helper inputs', () => {
    const dashboard = loadDashboardHelper();
    const scriptBundle = {
      id: 'default',
      groups: [{
        id: 'system-tuning',
        title: '系统脚本',
        description: '本机维护',
        actions: [{ id: 'cleanup' }],
      }],
    };
    const systemAction = { id: 'boot-mode', groupId: 'system-tuning' };

    expect(dashboard.buildDashboardSections({
      checkinSites: [{ id: 'site-a' }],
      workspaceSection: { id: 'workspace-orchestration', kind: 'workspace', items: [{ id: 'dev' }] },
      moduleGroups: [{ id: 'default', name: '默认分组', modules: [{ id: 'api' }] }],
      scriptBundle,
      systemActions: [systemAction],
      getScriptGroupIcon: (groupId: string) => (groupId === 'system-tuning' ? 'tune' : 'dashboard'),
      getDashboardGroupAccent: (groupId: string, kind: string) => `${kind}:${groupId}`,
    })).toEqual([
      {
        id: 'group-default',
        kind: 'module',
        name: '默认分组',
        icon: 'dashboard',
        accent: 'module:default',
        kicker: '模块分组',
        items: [{ id: 'api' }],
      },
      {
        id: 'workspace-orchestration',
        kind: 'workspace',
        items: [{ id: 'dev' }],
      },
      {
        id: 'script-system-tuning',
        kind: 'mixed',
        name: '系统脚本',
        icon: 'tune',
        accent: 'script:system-tuning',
        kicker: '脚本工具箱',
        description: '本机维护',
        bundleId: 'default',
        items: [{ id: 'cleanup' }, systemAction],
      },
      {
        id: 'checkin-hub',
        kind: 'checkin-hub',
        name: '签到中心',
        icon: 'event_available',
        accent: 'var(--md-primary)',
        kicker: '验证实验',
        items: [{ id: 'site-a' }],
        cardCount: 1,
      },
    ]);
  });

  it('builds standalone system action sections when no script group matches', () => {
    const dashboard = loadDashboardHelper();
    const systemAction = { id: 'shutdown', groupId: 'power' };

    expect(dashboard.appendSystemActionDashboardSections([], [systemAction], (groupId: string, kind: string) => `${kind}:${groupId}`))
      .toEqual([{
        id: 'system-action-power',
        kind: 'system-action',
        name: 'power',
        icon: 'dashboard',
        accent: 'script:power',
        kicker: '原生调优',
        items: [systemAction],
      }]);
    expect(dashboard.buildCheckinDashboardSection(undefined)).toBeNull();
    expect(dashboard.buildScriptDashboardSections(undefined)).toEqual([]);
  });

  it('builds dashboard focus summaries from visible module state', () => {
    const dashboard = loadDashboardHelper();
    const modules = [
      {
        id: 'api',
        name: 'API 服务',
        status: 'running',
        runtimeState: {
          phase: 'failed',
          failure: { summary: '端口被占用' },
        },
      },
      {
        id: 'worker',
        name: 'Worker',
        status: 'stopped',
        startReadiness: { ready: false, summary: '缺少 pnpm' },
      },
      {
        id: 'web',
        name: 'Web',
        status: 'running',
        updateable: true,
      },
      {
        id: 'hidden',
        name: 'Hidden',
        status: 'error',
        visible: false,
      },
    ];

    expect(dashboard.buildDashboardFocusSummary(modules)).toEqual({
      tone: 'error',
      title: '1 个模块需要优先处理',
      description: '端口被占用',
      primaryAction: { kind: 'diagnostics', label: '查看体检' },
      metrics: [
        { id: 'failed', label: '异常', value: 1, tone: 'error' },
        { id: 'blocked', label: '待准备', value: 1, tone: 'warn' },
        { id: 'running', label: '运行中', value: 1, tone: 'success' },
        { id: 'stopped', label: '待机', value: 2, tone: 'neutral' },
      ],
      items: [
        {
          tone: 'error',
          kind: 'failed',
          moduleId: 'api',
          moduleName: 'API 服务',
          title: 'API 服务：启动失败',
          detail: '端口被占用',
          actionKind: 'logs',
          actionLabel: '查看日志',
        },
        {
          tone: 'warn',
          kind: 'not-ready',
          moduleId: 'worker',
          moduleName: 'Worker',
          title: 'Worker：启动前需处理',
          detail: '缺少 pnpm',
          actionKind: 'diagnostics',
          actionLabel: '查看体检',
        },
        {
          tone: 'info',
          kind: 'updateable',
          moduleId: 'web',
          moduleName: 'Web',
          title: 'Web：可检查更新',
          detail: '建议在空闲时检查版本差异',
          actionKind: 'update',
          actionLabel: '检查更新',
        },
      ],
      hiddenItemCount: 0,
    });
  });

  it('keeps dashboard focus calm when no visible module needs attention', () => {
    const dashboard = loadDashboardHelper();

    expect(dashboard.buildDashboardFocusSummary([
      { id: 'api', name: 'API', status: 'running', runtimeState: { phase: 'running' } },
      { id: 'worker', status: 'stopped' },
    ])).toEqual({
      tone: 'calm',
      title: '当前没有需要立即处理的模块',
      description: '1 个模块正在运行，可从下方分组继续操作。',
      primaryAction: { kind: 'refresh', label: '刷新状态' },
      metrics: [
        { id: 'failed', label: '异常', value: 0, tone: 'neutral' },
        { id: 'blocked', label: '待准备', value: 0, tone: 'neutral' },
        { id: 'running', label: '运行中', value: 1, tone: 'success' },
        { id: 'stopped', label: '待机', value: 1, tone: 'neutral' },
      ],
      items: [],
      hiddenItemCount: 0,
    });
    expect(dashboard.buildDashboardFocusSummary(undefined).title).toBe('当前没有需要立即处理的模块');
  });

  it('ignores malformed dashboard section sources', () => {
    const dashboard = loadDashboardHelper();

    expect(dashboard.buildCheckinDashboardSection(['invalid', null, { id: 'site-a' }])).toEqual({
      id: 'checkin-hub',
      kind: 'checkin-hub',
      name: '签到中心',
      icon: 'event_available',
      accent: 'var(--md-primary)',
      kicker: '验证实验',
      items: [{ id: 'site-a' }],
      cardCount: 1,
    });
    expect(dashboard.buildCheckinDashboardSection(['invalid'])).toBeNull();
    expect(dashboard.buildModuleDashboardSections([
      undefined,
      { name: '无 ID 分组' },
      { id: '  ', name: '空白分组' },
      { id: ' default ', name: '  ', modules: ['invalid', { id: 'api' }] },
    ])).toEqual([{
      id: 'group-default',
      kind: 'module',
      name: 'default',
      icon: 'dashboard',
      accent: 'var(--md-secondary)',
      kicker: '模块分组',
      items: [{ id: 'api' }],
    }]);
    expect(dashboard.buildScriptDashboardSections({
      id: 'bundle',
      groups: [
        undefined,
        { title: '无 ID 脚本组' },
        { id: ' tools ', title: '  ', description: 123, actions: ['invalid', { id: 'cleanup' }] },
      ],
    })).toEqual([{
      id: 'script-tools',
      kind: 'script',
      name: 'tools',
      icon: 'dashboard',
      accent: 'var(--md-primary)',
      kicker: '脚本工具箱',
      description: '123',
      bundleId: 'bundle',
      items: [{ id: 'cleanup' }],
    }]);
    expect(dashboard.appendSystemActionDashboardSections(
      [undefined, { id: 'script-tools', kind: 'script', items: ['invalid'] }],
      [undefined, { id: 'missing-group' }, { id: 'valid', groupId: ' tools ' }],
    )).toEqual([{
      id: 'script-tools',
      kind: 'mixed',
      items: ['invalid', { id: 'valid', groupId: ' tools ' }],
    }]);
  });

  it('loads workspaces and renders a workspace dashboard section', () => {
    const html = readWebHtml();
    const workspaceHelper = readWebFile('app-workspace.js');

    expect(html).toContain('let workspaces = []');
    expect(html).toContain('async function fetchWorkspaces');
    expect(html).toContain("fetch('/api/workspaces')");
    expect(html).toContain('function appendWorkspaceSections');
    expect(workspaceHelper).toContain("kind: 'workspace'");
    expect(html).toContain('return section.items.map(createWorkspaceCard).join');
    expect(html).toContain('function mergeWorkspaceOrder(moduleIds, preferredOrder) {\n      return window.HubKitWorkspace.mergeWorkspaceOrder(moduleIds, preferredOrder);\n    }');
    expect(html).toContain('function getModuleGroupId(module) {\n      return window.HubKitWorkspace.getModuleGroupId(module, settings.moduleGroups);\n    }');
    expect(html).toContain('function isWorkspaceModuleSelected(workspace, moduleId) {\n      return window.HubKitWorkspace.isWorkspaceModuleSelected(workspace, moduleId);\n    }');
    expect(html).toContain('function buildWorkspaceModuleToggleViewModel(workspace, module) {\n      return window.HubKitWorkspace.buildWorkspaceModuleToggleViewModel(workspace, module);\n    }');
    expect(html).toContain('function buildWorkspaceDashboardDrafts(workspaceDrafts) {\n      return window.HubKitWorkspace.buildWorkspaceDashboardDrafts(workspaceDrafts);\n    }');
    expect(html).toContain('function generateWorkspaceId() {\n      return window.HubKitWorkspace.generateWorkspaceId(getEditableWorkspaces().map((workspace) => workspace.id));\n    }');
    expect(html).toContain('function createWorkspaceDraft(id) {\n      return window.HubKitWorkspace.createWorkspaceDraft(id);\n    }');
    expect(html).toContain('function updateWorkspaceModuleSelection(workspace, moduleId, enabled) {\n      return window.HubKitWorkspace.updateWorkspaceModuleSelection(workspace, moduleId, enabled);\n    }');
    expect(html).toContain('function updateWorkspaceMetadataField(workspace, field, value) {\n      return window.HubKitWorkspace.updateWorkspaceMetadataField(workspace, field, value);\n    }');
    expect(html).toContain('function normalizeWorkspaceFailurePolicy(workspace, value) {\n      return window.HubKitWorkspace.updateWorkspaceFailurePolicy(workspace, value);\n    }');
    expect(html).toContain('function removeWorkspaceDraft(workspaceDrafts, workspaceId) {\n      return window.HubKitWorkspace.removeWorkspaceDraft(workspaceDrafts, workspaceId);\n    }');
    expect(html).toContain('function buildWorkspaceCardViewModel(workspace) {\n      return window.HubKitWorkspace.buildWorkspaceCardViewModel(workspace);\n    }');
    expect(html).toContain('function buildWorkspaceCardCopy(workspace) {\n      return window.HubKitWorkspace.buildWorkspaceCardCopy(workspace);\n    }');
    expect(html).toContain('function buildWorkspaceCardRuntimeState(workspaceId) {\n      return window.HubKitWorkspace.buildWorkspaceCardRuntimeState(\n        workspaceId,\n        workspacePlansById,\n        workspaceActionLoading,\n        workspacePlanLoading,\n      );\n    }');
    expect(html).toContain('function buildWorkspaceEditorViewModel(workspace) {\n      return window.HubKitWorkspace.buildWorkspaceEditorViewModel(workspace);\n    }');
    expect(html).toContain('function buildWorkspaceSettingsViewModel(workspaces) {\n      return window.HubKitWorkspace.buildWorkspaceSettingsViewModel(workspaces);\n    }');
    expect(html).toContain('function buildWorkspaceEditorModulesViewModel(modules) {\n      return window.HubKitWorkspace.buildWorkspaceEditorModulesViewModel(modules);\n    }');
    expect(html).toContain('function buildWorkspaceCardMetrics(moduleIds, plan) {\n      return window.HubKitWorkspace.buildWorkspaceCardMetrics(moduleIds, plan);\n    }');
    expect(html).toContain('function buildWorkspacePlanLoadingText(plan, planLoading) {\n      return window.HubKitWorkspace.buildWorkspacePlanLoadingText(plan, planLoading);\n    }');
    expect(html).toContain('function buildWorkspaceActionButtons(planLoading, actionLoading) {\n      return window.HubKitWorkspace.buildWorkspaceActionButtons(planLoading, actionLoading);\n    }');
    expect(html).toContain('function buildWorkspacePlanSummaries(plan) {\n      return window.HubKitWorkspace.buildWorkspacePlanSummaries(plan, formatWorkspaceStepResult);\n    }');
    expect(html).toContain('function buildWorkspaceModuleNames(orderedIds) {\n      return window.HubKitWorkspace.buildWorkspaceModuleNames(orderedIds, getModuleName);\n    }');
    expect(html).toContain('function buildVisibleModuleGroups(visibleModules) {\n      return window.HubKitWorkspace.buildVisibleModuleGroups(\n        visibleModules,\n        settings.groups,\n        settings.moduleGroups,\n      );\n    }');
    expect(html).toContain('function buildWorkspaceDashboardSection() {\n      return window.HubKitWorkspace.buildWorkspaceDashboardSection(workspaces, settings.workspaces);\n    }');
    expect(html).toContain('function syncWorkspaceDraftsToDashboard() {\n      workspaces = buildWorkspaceDashboardDrafts(getEditableWorkspaces());\n    }');
    expect(html).toContain('return window.HubKitDashboard.buildDashboardSections({');
    expect(html).toContain('function renderDashboardFocus()');
    expect(html).toContain('window.HubKitDashboard.buildDashboardFocusSummary(modules)');
    expect(html).toContain('renderDashboardFocus();');
    expect(html).toContain('id="dashboardFocus"');
    expect(html).toContain('workspaceSection: buildWorkspaceDashboardSection(),');
    expect(html).toContain('moduleGroups: buildVisibleModuleGroups(modules.filter(m => m.visible !== false)),');
    expect(html).toContain('systemActions,');
    expect(html).toContain('getEditableWorkspaces().push(createWorkspaceDraft(id));');
    expect(html).toContain('Object.assign(workspace, updateWorkspaceModuleSelection(workspace, moduleId, enabled));');
    expect(html).toContain('Object.assign(workspace, updated);');
    expect(html).toContain('settings.workspaces = removeWorkspaceDraft(settings.workspaces, workspaceId);');
    expect(html).toContain('const workspaceCopy = buildWorkspaceCardCopy(workspace);');
    expect(html).toContain('const id = workspaceCopy.id;');
    expect(html).toContain('const runtimeState = buildWorkspaceCardRuntimeState(id);');
    expect(html).toContain('const plan = runtimeState.plan;');
    expect(html).toContain('const workspaceEditor = buildWorkspaceEditorViewModel(workspace);');
    expect(html).toContain('const workspaceEditorModules = buildWorkspaceEditorModulesViewModel(orderedModules);');
    expect(html).toContain('const workspaceSettings = buildWorkspaceSettingsViewModel(getEditableWorkspaces());');
    expect(html).toContain('workspaceSettings.items.map((workspace) => createWorkspaceEditorItem(workspace, orderedModules)).join');
    expect(html).toContain('workspaceEditorModules.items.map((module) => createWorkspaceModuleToggle(workspace, module)).join');
    expect(html).toContain('emptySettings(workspaceEditorModules.emptyText)');
    expect(html).toContain('emptySettings(workspaceSettings.emptyText)');
    expect(html).toContain('const moduleToggle = buildWorkspaceModuleToggleViewModel(workspace, module);');
    expect(html).toContain('const workspaceCard = buildWorkspaceCardViewModel(workspace);');
    expect(html).toContain('const metrics = buildWorkspaceCardMetrics(moduleIds, plan);');
    expect(html).toContain('const planLoadingText = buildWorkspacePlanLoadingText(plan, runtimeState.planLoading);');
    expect(html).toContain('const actionButtons = buildWorkspaceActionButtons(runtimeState.planLoading, runtimeState.actionLoading);');
    expect(html).toContain('const moduleNames = buildWorkspaceModuleNames(workspaceCard.orderedIds);');
    expect(html).toContain('const workspaceSummaries = buildWorkspacePlanSummaries(plan);');
    expect(html).toContain('const runSummary = workspaceSummaries.runSummary;');
    expect(html).toContain('onclick="fetchWorkspacePlan(\'${safeId}\')"');
    expect(html).toContain('onclick="startWorkspace(\'${safeId}\')"');
    expect(html).toContain('onclick="stopWorkspace(\'${safeId}\')"');
    expect(html).toContain('<h3>${escapeHtml(workspaceCopy.title)}</h3>');
    expect(html).toContain('<p class="module-description">${escapeHtml(workspaceCopy.description)}</p>');
    expect(html).toContain('<span class="settings-item-name">${escapeHtml(workspaceEditor.title)}</span>');
    expect(html).toContain('<span class="settings-item-id">${escapeHtml(workspaceEditor.id)} · ${workspaceEditor.selectedCount} 个模块</span>');
    expect(html).toContain('<label for="${escapeAttr(workspaceEditor.nameInputId)}">名称</label>');
    expect(html).toContain('id="${escapeAttr(workspaceEditor.nameInputId)}"');
    expect(html).toContain('value="${escapeAttr(workspaceEditor.nameValue)}"');
    expect(html).toContain('<label for="${escapeAttr(workspaceEditor.descriptionInputId)}">说明</label>');
    expect(html).toContain('id="${escapeAttr(workspaceEditor.descriptionInputId)}"');
    expect(html).toContain('value="${escapeAttr(workspaceEditor.descriptionValue)}"');
    expect(html).toContain('<label for="${escapeAttr(workspaceEditor.policySelectId)}">失败策略</label>');
    expect(html).toContain('id="${escapeAttr(workspaceEditor.policySelectId)}"');
    expect(html).toContain('<option value="stop" ${workspaceEditor.isStopSelected ? \'selected\' : \'\'}>失败后中断</option>');
    expect(html).toContain('<option value="continue" ${workspaceEditor.isContinueSelected ? \'selected\' : \'\'}>失败后继续</option>');
    expect(html).toContain('<span class="settings-item-name">${escapeHtml(moduleToggle.moduleName)}</span>');
    expect(html).toContain('<span class="settings-item-id">${escapeHtml(moduleToggle.moduleId)}</span>');
    expect(html).toContain('onchange="toggleWorkspaceModule(\'${jsString(moduleToggle.workspaceId)}\', \'${jsString(moduleToggle.moduleId)}\', this.checked)"');
    expect(html).toContain('<span class="status-badge running">${escapeHtml(workspaceCard.policyText)}</span>');
  });

  it('supports workspace plan, start, and stop actions', () => {
    const html = readWebHtml();

    expect(html).toContain('async function fetchWorkspacePlan');
    expect(html).toContain("plan?action=start");
    expect(html).toContain('async function workspaceAction');
    expect(html).toContain("workspaceAction(workspaceId, 'start')");
    expect(html).toContain("workspaceAction(workspaceId, 'stop')");
    expect(html).toContain("title: `停止工作区：${name}`");
  });

  it('provides workspace editing controls in settings', () => {
    const html = readWebHtml();

    expect(html).toContain('模块分组与工作区');
    expect(html).toContain('工作区编排');
    expect(html).toContain('function createWorkspaceSettings');
    expect(html).toContain('function createWorkspaceEditorItem');
    expect(html).toContain('function createWorkspaceModuleToggle');
    expect(html).toContain('function addWorkspace');
    expect(html).toContain('function updateWorkspaceField');
    expect(html).toContain('function toggleWorkspaceModule');
    expect(html).toContain('function removeWorkspace');
    expect(html).toContain('workspaces: settings.workspaces || []');
  });

  it('renders curl request center controls for checkin hub workflows', () => {
    const html = readWebHtml();

    expect(html).toContain('<h3>Curl 请求中心</h3>');
    expect(html).toContain('id="checkinSiteSelect"');
    expect(html).toContain('id="checkinSiteNameInput"');
    expect(html).toContain('id="checkinSiteUrlInput"');
    expect(html).toContain('id="checkinCommandSelect"');
    expect(html).toContain('id="checkinCurlCommand"');
    expect(html).toContain('id="checkinRunTimeInput"');
    expect(html).toContain('onchange="selectCheckinSite(this.value)"');
    expect(html).toContain('onchange="updateCheckinSiteName');
    expect(html).toContain('onchange="updateCheckinSiteUrl');
    expect(html).toContain('onclick="addCheckinSite()');
    expect(html).toContain('onclick="removeCheckinSite');
    expect(html).toContain('onchange="selectCheckinCurlCommand');
    expect(html).toContain('onclick="appendCheckinCurlCommand');
    expect(html).toContain('onclick="removeSelectedCheckinCurlCommand');
    expect(html).toContain('oninput="updateCheckinCurlCommand');
    expect(html).toContain('onchange="toggleCheckinAutoRun');
    expect(html).toContain('onchange="updateCheckinAutoRunTime');
    expect(html).toContain('onclick="runCheckinCurl');
    expect(html).toContain('onclick="runCheckinCurlAll');
    expect(html).toContain('window.HubKitApi?.runCurlRequest');
    expect(html).toContain('function resolveCheckinRunCommand(config, trigger = \'manual\')');
    expect(html).toContain('async function runCheckinCurlAll(siteId, trigger = \'manual\')');
    expect(html).toContain('autoRunCursor: nextCursor');
    expect(html).toContain('“执行当前”只跑你选中的命令；“执行全部”按顺序跑完整个队列。');
    expect(html).toContain('setupCheckinAutoRunTimer();');
  });
});

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

type FunctionRegion = {
  name: string;
  start: number;
  end: number;
};

type InlineFetch = {
  line: number;
  index: number;
  functionName: string;
  functionStart: number;
  functionBody: string;
  text: string;
};

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let templateExpressionDepth = 0;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote === '`' && char === '$' && next === '{') {
        templateExpressionDepth += 1;
        index += 1;
        continue;
      }
      if (quote === '`' && templateExpressionDepth > 0) {
        if (char === '{') templateExpressionDepth += 1;
        if (char === '}') templateExpressionDepth -= 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && next === '/') {
      const nextLine = source.indexOf('\n', index);
      if (nextLine === -1) return -1;
      index = nextLine;
      continue;
    }
    if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd === -1) return -1;
      index = commentEnd + 1;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function listFunctionRegions(source: string): FunctionRegion[] {
  return [...source.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g)]
    .map((match) => {
      const openBraceIndex = match.index + match[0].lastIndexOf('{');
      return {
        name: match[1],
        start: match.index,
        end: findMatchingBrace(source, openBraceIndex),
      };
    })
    .filter((item) => item.end > item.start);
}

function findContainingFunction(functions: FunctionRegion[], index: number): FunctionRegion | undefined {
  return functions
    .filter((item) => item.start < index && index < item.end)
    .sort((a, b) => b.start - a.start)[0];
}

function functionBodyByName(source: string, functionName: string): string {
  const region = listFunctionRegions(source).find((item) => item.name === functionName);
  expect(region).toBeDefined();
  return source.slice(region?.start || 0, region?.end || 0);
}

function listInlineFetches(source: string): InlineFetch[] {
  const functions = listFunctionRegions(source);

  return [...source.matchAll(/\bfetch\(/g)].map((match) => {
    const containingFunction = findContainingFunction(functions, match.index);
    const lineEnd = source.indexOf('\n', match.index);
    return {
      line: lineNumberAt(source, match.index),
      index: match.index,
      functionName: containingFunction?.name || '<global>',
      functionStart: containingFunction?.start ?? 0,
      functionBody: containingFunction ? source.slice(containingFunction.start, containingFunction.end) : '',
      text: source.slice(match.index, lineEnd === -1 ? undefined : lineEnd).trim(),
    };
  });
}

function listHubKitApiGuardsBeforeFetch(fetchEntry: InlineFetch): string[] {
  const beforeFetch = fetchEntry.functionBody.slice(0, fetchEntry.index - fetchEntry.functionStart);
  return [...beforeFetch.matchAll(/window\.HubKitApi\?\.([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1]);
}

function listExportedHubKitApiHelpers(source: string): string[] {
  const exportMatch = source.match(/window\.HubKitApi\s*=\s*\{([\s\S]*?)\n  \};/);
  expect(exportMatch).not.toBeNull();
  return (exportMatch?.[1] || '')
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean);
}

function loadApiClient(fetchMock: jest.Mock = jest.fn()): { window: any; confirmCalls: string[]; fetchMock: jest.Mock } {
  const confirmCalls: string[] = [];
  const window = {
    confirm: (message: string) => {
      confirmCalls.push(message);
      return true;
    },
  };

  vm.runInNewContext(readWebFile('app-api.js'), { window, fetch: fetchMock, URLSearchParams });

  return { window, confirmCalls, fetchMock };
}

describe('web API client helper', () => {
  it('loads the extracted API helper before the main inline app script', () => {
    const html = readWebFile('index.html');
    const apiScriptIndex = html.indexOf('<script src="/app-api.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(apiScriptIndex).toBeGreaterThan(-1);
    expect(mainScriptIndex).toBeGreaterThan(apiScriptIndex);
  });

  it('keeps inline fetch calls limited to API-helper fallback scopes', () => {
    const html = readWebFile('index.html');

    const unexpectedFetches = listInlineFetches(html)
      .filter((entry) => entry.functionName !== 'highRiskHeaders')
      .filter((entry) => !/window\.HubKitApi\?\.[A-Za-z0-9_$]+/.test(entry.functionBody))
      .map(({ line, functionName, text }) => ({ line, functionName, text }));

    expect(unexpectedFetches).toEqual([]);
  });

  it('keeps inline fetch fallbacks guarded before the direct fetch call', () => {
    const html = readWebFile('index.html');

    const unguardedFetches = listInlineFetches(html)
      .filter((entry) => entry.functionName !== 'highRiskHeaders')
      .filter((entry) => listHubKitApiGuardsBeforeFetch(entry).length === 0)
      .map(({ line, functionName, text }) => ({ line, functionName, text }));

    expect(unguardedFetches).toEqual([]);
  });

  it('keeps inline HubKitApi references backed by exported helpers', () => {
    const html = readWebFile('index.html');
    const { window } = loadApiClient();
    const exportedHelpers = new Set(Object.keys(window.HubKitApi));
    const referencedHelpers = new Set(
      [...html.matchAll(/window\.HubKitApi(?:\?\.|\.)([A-Za-z_$][\w$]*)/g)]
        .map((match) => match[1]),
    );

    const missingExports = [...referencedHelpers]
      .filter((helper) => !exportedHelpers.has(helper))
      .sort();

    expect(missingExports).toEqual([]);
  });

  it('keeps exported HubKitApi helpers backed by same-file functions', () => {
    const apiClient = readWebFile('app-api.js');
    const declaredFunctions = new Set(
      [...apiClient.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((match) => match[1]),
    );
    const exportedHelpers = listExportedHubKitApiHelpers(apiClient);

    const missingDeclarations = exportedHelpers
      .filter((helper) => !declaredFunctions.has(helper))
      .sort();

    expect(missingDeclarations).toEqual([]);
  });

  it('exports only callable HubKitApi helpers', () => {
    const { window } = loadApiClient();
    const nonFunctionExports = Object.entries(window.HubKitApi)
      .filter(([, value]) => typeof value !== 'function')
      .map(([name]) => name)
      .sort();

    expect(nonFunctionExports).toEqual([]);
  });

  it('keeps JSON parsing centralized inside the private readJson helper', () => {
    const apiClient = readWebFile('app-api.js');
    const functions = listFunctionRegions(apiClient);

    const directJsonReads = [...apiClient.matchAll(/\bresponse\.json\(/g)]
      .map((match) => {
        const containingFunction = findContainingFunction(functions, match.index);
        return {
          line: lineNumberAt(apiClient, match.index),
          functionName: containingFunction?.name || '<global>',
        };
      })
      .filter((entry) => entry.functionName !== 'readJson');

    expect(directJsonReads).toEqual([]);
  });

  it('keeps implementation-only API helpers out of the public HubKitApi interface', () => {
    const apiClient = readWebFile('app-api.js');
    const exportedHelpers = listExportedHubKitApiHelpers(apiClient);

    expect(exportedHelpers).not.toContain('readJson');
    expect(exportedHelpers).not.toContain('postPassThroughJson');
    expect(exportedHelpers).not.toContain('postStrictJson');
    expect(exportedHelpers).not.toContain('postHttpOkJson');
  });

  it('keeps public mutation helpers on the intended internal post helper path', () => {
    const apiClient = readWebFile('app-api.js');

    const passThroughHelpers = [
      'postJson',
      'saveSettings',
      'restoreConfigBackup',
      'updateModule',
      'runCurlRequest',
      'saveModuleWebUrl',
      'setModuleVisibility',
      'saveModuleSchedule',
    ];
    const strictHelpers = [
      'startWorkspace',
      'stopWorkspace',
      'applyBootPreferenceMode',
      'runScriptAction',
      'startScriptActionWebTerminal',
    ];
    const httpOkHelpers = [
      'forceCloseModule',
      'forceCloseAllModules',
    ];

    const wrongPassThroughHelpers = passThroughHelpers
      .filter((helper) => !functionBodyByName(apiClient, helper).includes('postPassThroughJson('));
    const wrongStrictHelpers = strictHelpers
      .filter((helper) => !functionBodyByName(apiClient, helper).includes('postStrictJson('));
    const wrongHttpOkHelpers = httpOkHelpers
      .filter((helper) => !functionBodyByName(apiClient, helper).includes('postHttpOkJson('));

    expect(wrongPassThroughHelpers).toEqual([]);
    expect(wrongStrictHelpers).toEqual([]);
    expect(wrongHttpOkHelpers).toEqual([]);
  });

  it('keeps public HubKitApi export keys unique', () => {
    const apiClient = readWebFile('app-api.js');
    const exportedHelpers = listExportedHubKitApiHelpers(apiClient);
    const uniqueHelpers = new Set(exportedHelpers);

    expect(uniqueHelpers.size).toBe(exportedHelpers.length);
  });

  it('keeps terminal kill and ordinary module actions on their bespoke mutation paths', () => {
    const apiClient = readWebFile('app-api.js');
    const terminalKillBody = functionBodyByName(apiClient, 'killTerminalSession');
    const moduleActionBody = functionBodyByName(apiClient, 'runModuleAction');

    expect(terminalKillBody).toContain('allowNotFound');
    expect(terminalKillBody).toContain('throwOnSuccessFalse');
    expect(terminalKillBody).toContain('response.status');
    expect(terminalKillBody).not.toContain('postStrictJson(');
    expect(terminalKillBody).not.toContain('postPassThroughJson(');
    expect(terminalKillBody).not.toContain('postHttpOkJson(');

    expect(moduleActionBody).toContain('body: action === \'stop\' ? JSON.stringify({ force: false }) : undefined');
    expect(moduleActionBody).toContain('json.success === false');
    expect(moduleActionBody).not.toContain('postStrictJson(');
    expect(moduleActionBody).not.toContain('postPassThroughJson(');
    expect(moduleActionBody).not.toContain('postHttpOkJson(');
  });

  it('loads modules while preserving the legacy array response shape', async () => {
    const payload = [{ id: 'api', name: 'API' }];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModules()).resolves.toBe(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/modules');
  });

  it('loads modules from the wrapped data response shape', async () => {
    const payload = [{ id: 'worker', name: 'Worker' }];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, data: payload }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModules()).resolves.toBe(payload);
  });

  it('handles invalid JSON responses through the shared JSON reader', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockRejectedValue(new Error('invalid json')),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockRejectedValue(new Error('invalid json')),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModules()).resolves.toEqual([]);
    await expect(window.HubKitApi.requestJson('/api/broken')).rejects.toThrow('请求失败: /api/broken');
  });

  it('loads workspaces through the shared JSON request helper', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: [{ id: 'core', name: 'Core' }],
      }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getWorkspaces()).resolves.toEqual([
      { id: 'core', name: 'Core' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces', {});
  });

  it('normalizes non-array workspace payloads to an empty list', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, data: null }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getWorkspaces()).resolves.toEqual([]);
  });

  it('loads workspace start plans with encoded workspace ids', async () => {
    const payload = { steps: [{ moduleId: 'api' }] };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, data: payload }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getWorkspaceStartPlan('core space')).resolves.toBe(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/core%20space/plan?action=start', {});
  });

  it('normalizes script bundles and system actions to arrays', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          success: true,
          data: [{ id: 'scripts', actions: [] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '暂不可用' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getScriptBundles()).resolves.toEqual([
      { id: 'scripts', actions: [] },
    ]);
    await expect(window.HubKitApi.getSystemActions()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/script-bundles');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/system-actions');
  });

  it('loads read-only config backups through the extracted API client', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: [{ id: 'backup-1', createdAt: '2026-05-24T00:00:00.000Z' }],
      }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getConfigBackups()).resolves.toEqual([
      { id: 'backup-1', createdAt: '2026-05-24T00:00:00.000Z' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/config/backups', {});
  });

  it('loads config restore previews with encoded backup ids', async () => {
    const payload = { added: [], removed: ['api'], changed: ['worker'] };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: payload }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '预览失败' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getConfigRestorePreview('backup 1')).resolves.toBe(payload);
    await expect(window.HubKitApi.getConfigRestorePreview('bad backup')).rejects.toThrow('预览失败');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/config/backups/backup%201/preview');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/config/backups/bad%20backup/preview');
  });

  it('normalizes non-array read-only API payloads to empty lists', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, data: null }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getStartPolicyTemplates()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/start-policy-templates', {});
  });

  it('loads settings through the extracted API client without normalizing the object', async () => {
    const payload = {
      groups: [{ id: 'default', name: '默认分组' }],
      workspaces: [{ id: 'core', name: 'Core' }],
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, data: payload }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getSettings()).resolves.toBe(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/settings');
  });

  it('preserves settings success:false as a no-op payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: false, error: '忽略' }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getSettings()).resolves.toBeNull();
  });

  it('loads module audit reports through the extracted API client', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: [{ moduleId: 'api', score: 90 }],
      }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModuleAudit()).resolves.toEqual([
      { moduleId: 'api', score: 90 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/module-audit');
  });

  it('preserves module audit non-array payloads as empty reports', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: false, error: '暂不可用' }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModuleAudit()).resolves.toEqual([]);
  });

  it('loads module diagnostics while preserving unsupported backend fallback signals', async () => {
    const diagnostics = { pidFromStatus: 1234, portOccupied: true };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue('application/json') },
        json: jest.fn().mockResolvedValue({
          success: true,
          data: { diagnostics },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: jest.fn().mockReturnValue('text/html') },
        json: jest.fn(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: { get: jest.fn().mockReturnValue('application/json') },
        json: jest.fn().mockResolvedValue({ success: false, error: '检查失败' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModuleDiagnostics('api service')).resolves.toEqual({
      unsupported: false,
      status: 200,
      json: { success: true, data: { diagnostics } },
      diagnostics,
    });
    await expect(window.HubKitApi.getModuleDiagnostics('legacy service')).resolves.toEqual({
      unsupported: true,
      status: 404,
      json: {},
      diagnostics: null,
    });
    await expect(window.HubKitApi.getModuleDiagnostics('broken service')).rejects.toThrow('检查失败');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/modules/api%20service/diagnostics');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/modules/legacy%20service/diagnostics');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/modules/broken%20service/diagnostics');
  });

  it('loads module update checks without changing the response shape', async () => {
    const payload = { success: true, hasUpdates: true, commitsBehind: 2 };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.checkModuleUpdate('api service')).resolves.toBe(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/modules/api%20service/update-check');
  });

  it('loads module logs while preserving success and error text semantics', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: 'started\nready' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '日志不存在' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getModuleLogs('api service', { lines: 200 })).resolves.toBe('started\nready');
    await expect(window.HubKitApi.getModuleLogs('api')).resolves.toBe('日志不存在');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/modules/api%20service/logs?lines=200');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/modules/api/logs?lines=200');
  });

  it('loads script action logs with optional run ids', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: 'latest log' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: 'run log' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getScriptActionLogs('tools', 'build')).resolves.toBe('latest log');
    await expect(window.HubKitApi.getScriptActionLogs('tools', 'build', { runId: 'run 1' })).resolves.toBe('run log');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/script-bundles/tools/actions/build/logs');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/script-bundles/tools/actions/build/logs?runId=run%201');
  });

  it('searches logs with explicit filters and preserves failure payloads', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: { results: [{ message: 'boom' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '无法搜索' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.searchLogs({
      q: 'api error',
      level: 'error',
      lines: 20,
      limit: 5,
    })).resolves.toEqual({ results: [{ message: 'boom' }] });
    await expect(window.HubKitApi.searchLogs()).resolves.toEqual({ error: '无法搜索', results: [] });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/log-search?q=api+error&level=error&lines=20&limit=5');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/log-search?q=&level=all&lines=500&limit=120');
  });

  it('loads script and system action histories as arrays', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: [{ runId: '1' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: null }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getScriptActionHistory('tools', 'build')).resolves.toEqual([{ runId: '1' }]);
    await expect(window.HubKitApi.getBootPreferenceHistory()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/script-bundles/tools/actions/build/history', {});
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/system-actions/boot-preference/history', {});
  });

  it('loads only supported system action logs', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, data: 'mode changed' }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.getSystemActionLogs('other')).resolves.toBe('暂不支持该系统调优日志');
    await expect(window.HubKitApi.getSystemActionLogs('boot-preference', { runId: 'run 1' })).resolves.toBe('mode changed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/system-actions/boot-preference/logs?runId=run%201');
  });

  it('posts settings through the extracted API client', async () => {
    const payload = {
      autoStart: { api: true },
      startOrder: ['api'],
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: { api: 'default' },
      startPolicies: {},
      groupStartPolicyTemplates: {},
      workspaces: [],
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.saveSettings(payload)).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  it('starts workspaces without high-risk headers', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        message: '工作区已启动',
        data: { steps: [] },
      }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.startWorkspace('core space')).resolves.toEqual({
      success: true,
      message: '工作区已启动',
      data: { steps: [] },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/core%20space/start', {
      method: 'POST',
    });
  });

  it('posts module actions with stop force disabled', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, message: '启动成功' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, message: '停止成功' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({ success: false }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.runModuleAction('api service', 'start')).resolves.toEqual({
      success: true,
      message: '启动成功',
    });
    await expect(window.HubKitApi.runModuleAction('api service', 'stop')).resolves.toEqual({
      success: true,
      message: '停止成功',
    });
    await expect(window.HubKitApi.runModuleAction('api service', 'restart')).rejects.toThrow('重启失败');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/modules/api%20service/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/modules/api%20service/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
  });

  it('posts module URL, visibility, and schedule updates', async () => {
    const schedule = { enabled: true, startTime: '09:00', stopTime: '18:00', daysOfWeek: [1, 2] };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          success: true,
          schedule,
          scheduleStatus: { nextAction: 'start' },
        }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.saveModuleWebUrl('api service', 'http://localhost:3000')).resolves.toEqual({ success: true });
    await expect(window.HubKitApi.setModuleVisibility('api service', false)).resolves.toEqual({ success: true });
    await expect(window.HubKitApi.saveModuleSchedule('api service', schedule)).resolves.toEqual({
      success: true,
      schedule,
      scheduleStatus: { nextAction: 'start' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/modules/api%20service/web-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:3000' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/modules/api%20service/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible: false }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/modules/api%20service/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    });
  });

  it('posts high-risk workspace stop and config restore requests with supplied headers', async () => {
    const headers = {
      'x-hubkit-high-risk-confirmation': 'workspace:core space:stop',
      'x-hubkit-high-risk-token': 'ticket-1',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, message: '已停止' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: { settings: {} } }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.stopWorkspace('core space', headers)).resolves.toEqual({
      success: true,
      message: '已停止',
    });
    await expect(window.HubKitApi.restoreConfigBackup('backup 1', headers)).resolves.toEqual({
      success: true,
      data: { settings: {} },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspaces/core%20space/stop', {
      method: 'POST',
      headers,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/config/backups/backup%201/restore', {
      method: 'POST',
      headers,
    });
  });

  it('preserves UI-handled mutation failure payloads for caller-specific recovery', async () => {
    const headers = {
      'x-hubkit-high-risk-confirmation': 'module:api:update',
      'x-hubkit-high-risk-token': 'ticket-3',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '设置校验失败' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: 'URL 不可访问' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '恢复冲突', data: { changed: ['api'] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '更新失败', data: { commitsBehind: 2 } }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.saveSettings({})).resolves.toEqual({
      success: false,
      error: '设置校验失败',
    });
    await expect(window.HubKitApi.saveModuleWebUrl('api service', 'bad-url')).resolves.toEqual({
      success: false,
      error: 'URL 不可访问',
    });
    await expect(window.HubKitApi.restoreConfigBackup('backup 1', headers)).resolves.toEqual({
      success: false,
      error: '恢复冲突',
      data: { changed: ['api'] },
    });
    await expect(window.HubKitApi.updateModule('api service', headers)).resolves.toEqual({
      success: false,
      error: '更新失败',
      data: { commitsBehind: 2 },
    });
  });

  it('posts high-risk force-close requests without hiding partial failures', async () => {
    const headers = {
      'x-hubkit-high-risk-confirmation': 'module:api:force-close',
      'x-hubkit-high-risk-token': 'ticket-2',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          success: false,
          message: '仍有残留',
          data: { after: { ports: [] } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          success: true,
          data: { total: 2, failedCount: 0, results: [] },
        }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.forceCloseModule('api service', headers)).resolves.toMatchObject({
      success: false,
      message: '仍有残留',
    });
    await expect(window.HubKitApi.forceCloseAllModules(headers)).resolves.toMatchObject({
      success: true,
      data: { total: 2, failedCount: 0, results: [] },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/modules/api%20service/force-close', {
      method: 'POST',
      headers,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/modules/force-close-all', {
      method: 'POST',
      headers,
    });
  });

  it('throws force-close requests only when the HTTP layer fails', async () => {
    const headers = {
      'x-hubkit-high-risk-confirmation': 'module:api:force-close',
      'x-hubkit-high-risk-token': 'ticket-2',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ success: false, error: '强制关闭接口失败' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: jest.fn().mockResolvedValue({}),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.forceCloseModule('api service', headers)).rejects.toThrow('强制关闭接口失败');
    await expect(window.HubKitApi.forceCloseAllModules(headers)).rejects.toThrow('全部关停失败');
  });

  it('throws strict mutation failures that cannot be recovered by local UI handling', async () => {
    const headers = {
      'x-hubkit-high-risk-confirmation': 'workspace:core:stop',
      'x-hubkit-high-risk-token': 'ticket-8',
    };
    const terminalHeaders = {
      'Content-Type': 'application/json',
      'x-hubkit-high-risk-confirmation': 'script-bundle:tools:dev:web-terminal',
      'x-hubkit-high-risk-token': 'ticket-9',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '启动失败' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '停止失败' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '终端不可用' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.startWorkspace('core')).rejects.toThrow('启动失败');
    await expect(window.HubKitApi.stopWorkspace('core', headers)).rejects.toThrow('停止失败');
    await expect(window.HubKitApi.startScriptActionWebTerminal('tools', 'dev', {
      cols: 120,
      rows: 32,
    }, terminalHeaders)).rejects.toThrow('终端不可用');
  });

  it('posts high-risk module update and boot preference apply requests', async () => {
    const updateHeaders = {
      'x-hubkit-high-risk-confirmation': 'module:api:update',
      'x-hubkit-high-risk-token': 'ticket-3',
    };
    const bootHeaders = {
      'Content-Type': 'application/json',
      'x-hubkit-high-risk-confirmation': 'system-action:boot-preference:block_power:apply',
      'x-hubkit-high-risk-token': 'ticket-4',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, message: '更新完成' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, message: '设置已应用' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '应用失败' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.updateModule('api service', updateHeaders)).resolves.toEqual({
      success: true,
      message: '更新完成',
    });
    await expect(window.HubKitApi.applyBootPreferenceMode('block_power', bootHeaders)).resolves.toEqual({
      success: true,
      message: '设置已应用',
    });
    await expect(window.HubKitApi.applyBootPreferenceMode('block_lid', bootHeaders)).rejects.toThrow('应用失败');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/modules/api%20service/update', {
      method: 'POST',
      headers: updateHeaders,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/system-actions/boot-preference/apply', {
      method: 'POST',
      headers: bootHeaders,
      body: JSON.stringify({ mode: 'block_power' }),
    });
  });

  it('posts high-risk script run and web-terminal requests with supplied headers', async () => {
    const runHeaders = {
      'x-hubkit-high-risk-confirmation': 'script-bundle:tools box:build now:run',
      'x-hubkit-high-risk-token': 'ticket-5',
    };
    const terminalHeaders = {
      'Content-Type': 'application/json',
      'x-hubkit-high-risk-confirmation': 'script-bundle:tools box:dev now:web-terminal',
      'x-hubkit-high-risk-token': 'ticket-6',
    };
    const dimensions = { cols: 120, rows: 32 };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, message: '脚本已启动' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          success: true,
          data: { session: { sessionId: 'session-1', bundleId: 'tools box', actionId: 'dev now' } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: false, error: '执行失败' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.runScriptAction('tools box', 'build now', runHeaders)).resolves.toEqual({
      success: true,
      message: '脚本已启动',
    });
    await expect(window.HubKitApi.startScriptActionWebTerminal('tools box', 'dev now', dimensions, terminalHeaders)).resolves.toEqual({
      success: true,
      data: { session: { sessionId: 'session-1', bundleId: 'tools box', actionId: 'dev now' } },
    });
    await expect(window.HubKitApi.runScriptAction('tools box', 'bad action', runHeaders)).rejects.toThrow('执行失败');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/script-bundles/tools%20box/actions/build%20now/run', {
      method: 'POST',
      headers: runHeaders,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/script-bundles/tools%20box/actions/dev%20now/web-terminal', {
      method: 'POST',
      headers: terminalHeaders,
      body: JSON.stringify(dimensions),
    });
  });

  it('posts high-risk terminal kill requests while preserving close semantics', async () => {
    const headers = {
      'x-hubkit-high-risk-confirmation': 'terminal-session:session 1:kill',
      'x-hubkit-high-risk-token': 'ticket-7',
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ success: true, message: '已停止' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: jest.fn().mockResolvedValue({ success: false, error: '会话不存在' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ success: false, error: '仍在运行' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ success: false, error: '关闭后端已返回失败' }),
      });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.killTerminalSession('session 1', headers)).resolves.toEqual({
      status: 200,
      json: { success: true, message: '已停止' },
    });
    await expect(window.HubKitApi.killTerminalSession('missing session', headers, { allowNotFound: true })).resolves.toEqual({
      status: 404,
      json: { success: false, error: '会话不存在' },
    });
    await expect(window.HubKitApi.killTerminalSession('session 1', headers)).rejects.toThrow('仍在运行');
    await expect(window.HubKitApi.killTerminalSession('session 1', headers, {
      failureMessage: '关闭失败',
      throwOnSuccessFalse: false,
    })).resolves.toEqual({
      status: 200,
      json: { success: false, error: '关闭后端已返回失败' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/terminal-sessions/session%201/kill', {
      method: 'POST',
      headers,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/terminal-sessions/missing%20session/kill', {
      method: 'POST',
      headers,
    });
  });

  it('surfaces API errors from the shared JSON request helper', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ success: false, error: '加载失败' }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.requestJson('/api/config/backups')).rejects.toThrow('加载失败');
  });

  it('builds high-risk request headers without dropping extra fetch headers', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: {
          action: 'module:demo:force-close',
          token: 'ticket-123',
          expiresAt: '2026-05-24T00:00:00.000Z',
        },
      }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.highRiskHeaders('module:demo:force-close', {
      'Content-Type': 'application/json',
    })).resolves.toEqual({
      'Content-Type': 'application/json',
      'x-hubkit-high-risk-confirmation': 'module:demo:force-close',
      'x-hubkit-high-risk-token': 'ticket-123',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/high-risk-confirmations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'module:demo:force-close' }),
    });
  });

  it('rejects high-risk tickets without a token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: {},
      }),
    });
    const { window } = loadApiClient(fetchMock);

    await expect(window.HubKitApi.highRiskHeaders('module:demo:update')).rejects.toThrow('高风险确认票据签发失败');
  });

  it('formats browser confirmation copy for high-risk actions', () => {
    const { window, confirmCalls } = loadApiClient();

    expect(window.HubKitApi.confirmHighRiskAction({
      title: '强制关闭 demo',
      impact: ['将停止本地进程', ''],
      recovery: '重新启动模块',
      confirmLabel: '强制关闭',
    })).toBe(true);

    expect(confirmCalls).toEqual([
      [
        '高风险操作：强制关闭 demo',
        '将停止本地进程',
        '回退路径：重新启动模块',
        '确认后将执行：强制关闭',
      ].join('\n\n'),
    ]);
  });
});

(function () {
  async function readJson(response) {
    return await response.json().catch(() => ({}));
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(path, options);
    const json = await readJson(response);
    if (!response.ok || json.success === false) {
      throw new Error(json.error || `请求失败: ${path}`);
    }
    return json.data;
  }

  async function postPassThroughJson(path, body = undefined, headers = { 'Content-Type': 'application/json' }) {
    const options = {
      method: 'POST',
      headers,
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    return await readJson(response);
  }

  async function postStrictJson(path, {
    body = undefined,
    headers = undefined,
    failureMessage = '请求失败',
  } = {}) {
    const options = {
      method: 'POST',
    };
    if (headers !== undefined) {
      options.headers = headers;
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const json = await readJson(response);
    if (!response.ok || json.success === false) {
      throw new Error(json.error || failureMessage);
    }
    return json;
  }

  async function postHttpOkJson(path, {
    body = undefined,
    headers = undefined,
    failureMessage = '请求失败',
  } = {}) {
    const options = {
      method: 'POST',
    };
    if (headers !== undefined) {
      options.headers = headers;
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const json = await readJson(response);
    if (!response.ok) {
      throw new Error(json.error || failureMessage);
    }
    return json;
  }

  async function postJson(path, body = undefined, headers = { 'Content-Type': 'application/json' }) {
    return await postPassThroughJson(path, body, headers);
  }

  function confirmHighRiskAction({ title, impact = [], recovery = '', confirmLabel = '继续' }) {
    const sections = [
      `高风险操作：${title}`,
      ...impact.filter(Boolean),
      recovery ? `回退路径：${recovery}` : '',
      `确认后将执行：${confirmLabel}`,
    ].filter(Boolean);
    return window.confirm(sections.join('\n\n'));
  }

  async function issueHighRiskTicket(actionId) {
    const response = await fetch('/api/high-risk-confirmations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionId }),
    });
    const json = await readJson(response);
    if (!response.ok || json.success === false || !json.data?.token) {
      throw new Error(json.error || '高风险确认票据签发失败');
    }
    return json.data;
  }

  async function highRiskHeaders(actionId, extra = {}) {
    const ticket = await issueHighRiskTicket(actionId);
    return {
      ...extra,
      'x-hubkit-high-risk-confirmation': actionId,
      'x-hubkit-high-risk-token': ticket.token,
    };
  }

  async function getModules() {
    const response = await fetch('/api/modules');
    const json = await readJson(response);
    return Array.isArray(json) ? json : (json.data || []);
  }

  async function getWorkspaces() {
    const data = await requestJson('/api/workspaces');
    return Array.isArray(data) ? data : [];
  }

  async function getWorkspaceStartPlan(workspaceId) {
    return await requestJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/plan?action=start`);
  }

  async function getScriptBundles() {
    const response = await fetch('/api/script-bundles');
    const json = await readJson(response);
    return Array.isArray(json.data) ? json.data : [];
  }

  async function getSystemActions() {
    const response = await fetch('/api/system-actions');
    const json = await readJson(response);
    return Array.isArray(json.data) ? json.data : [];
  }

  async function getConfigBackups() {
    const data = await requestJson('/api/config/backups');
    return Array.isArray(data) ? data : [];
  }

  async function getConfigRestorePreview(backupId) {
    const response = await fetch(`/api/config/backups/${encodeURIComponent(backupId)}/preview`);
    const json = await readJson(response);
    if (!response.ok || json.success === false) {
      throw new Error(json.error || '恢复影响预览失败');
    }
    return json.data;
  }

  async function getSettings() {
    const response = await fetch('/api/settings');
    const json = await readJson(response);
    return json.success ? json.data : null;
  }

  async function getStartPolicyTemplates() {
    const data = await requestJson('/api/start-policy-templates');
    return Array.isArray(data) ? data : [];
  }

  async function getModuleAudit() {
    const response = await fetch('/api/module-audit');
    const json = await readJson(response);
    return Array.isArray(json.data) ? json.data : [];
  }

  async function getModuleDiagnostics(moduleId) {
    const response = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/diagnostics`);
    const isJson = String(response.headers?.get?.('content-type') || '').includes('application/json');
    const json = isJson ? await readJson(response) : {};

    if (response.status === 404) {
      return { unsupported: true, status: response.status, json, diagnostics: null };
    }

    if (!response.ok || json.success === false) {
      throw new Error(json.error || `检查失败（HTTP ${response.status}）`);
    }
    return { unsupported: false, status: response.status, json, diagnostics: json.data?.diagnostics || null };
  }

  async function checkModuleUpdate(moduleId) {
    const response = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/update-check`);
    return await readJson(response);
  }

  async function getModuleLogs(moduleId, { lines = 200 } = {}) {
    const response = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/logs?lines=${encodeURIComponent(String(lines))}`);
    const json = await readJson(response);
    if (json.success) return json.data || '';
    return json.error || '无法加载日志';
  }

  async function getScriptActionLogs(bundleId, actionId, { runId = '' } = {}) {
    const search = runId ? `?runId=${encodeURIComponent(runId)}` : '';
    const response = await fetch(`/api/script-bundles/${encodeURIComponent(bundleId)}/actions/${encodeURIComponent(actionId)}/logs${search}`);
    const json = await readJson(response);
    if (json.success) return json.data || '';
    return json.error || '无法加载日志';
  }

  async function searchLogs({ q = '', level = 'all', lines = 500, limit = 120 } = {}) {
    const search = new URLSearchParams({
      q,
      level,
      lines: String(lines),
      limit: String(limit),
    });
    const response = await fetch(`/api/log-search?${search.toString()}`);
    const json = await readJson(response);
    if (json.success) return json.data;
    return { error: json.error || '无法搜索日志', results: [] };
  }

  async function getScriptActionHistory(bundleId, actionId) {
    const data = await requestJson(`/api/script-bundles/${encodeURIComponent(bundleId)}/actions/${encodeURIComponent(actionId)}/history`);
    return Array.isArray(data) ? data : [];
  }

  async function getSystemActionLogs(actionId, { runId = '' } = {}) {
    if (actionId !== 'boot-preference') return '暂不支持该系统调优日志';
    const search = runId ? `?runId=${encodeURIComponent(runId)}` : '';
    const response = await fetch(`/api/system-actions/boot-preference/logs${search}`);
    const json = await readJson(response);
    if (json.success) return json.data || '';
    return json.error || '无法加载日志';
  }

  async function getBootPreferenceHistory() {
    const data = await requestJson('/api/system-actions/boot-preference/history');
    return Array.isArray(data) ? data : [];
  }

  async function saveSettings(settings) {
    return await postPassThroughJson('/api/settings', settings);
  }

  async function startWorkspace(workspaceId) {
    return await postStrictJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/start`, {
      headers: undefined,
      failureMessage: '启动工作区失败',
    });
  }

  async function stopWorkspace(workspaceId, headers) {
    return await postStrictJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/stop`, {
      headers,
      failureMessage: '停止工作区失败',
    });
  }

  async function restoreConfigBackup(backupId, headers) {
    return await postPassThroughJson(`/api/config/backups/${encodeURIComponent(backupId)}/restore`, undefined, headers);
  }

  async function forceCloseModule(moduleId, headers) {
    return await postHttpOkJson(`/api/modules/${encodeURIComponent(moduleId)}/force-close`, {
      headers,
      failureMessage: '强制关闭失败',
    });
  }

  async function forceCloseAllModules(headers) {
    return await postHttpOkJson('/api/modules/force-close-all', {
      headers,
      failureMessage: '全部关停失败',
    });
  }

  async function updateModule(moduleId, headers) {
    return await postPassThroughJson(`/api/modules/${encodeURIComponent(moduleId)}/update`, undefined, headers);
  }

  async function applyBootPreferenceMode(mode, headers) {
    return await postStrictJson('/api/system-actions/boot-preference/apply', {
      headers,
      body: { mode },
      failureMessage: '应用失败',
    });
  }

  async function runScriptAction(bundleId, actionId, headers) {
    return await postStrictJson(`/api/script-bundles/${encodeURIComponent(bundleId)}/actions/${encodeURIComponent(actionId)}/run`, {
      headers,
      failureMessage: '执行失败',
    });
  }

  async function startScriptActionWebTerminal(bundleId, actionId, dimensions, headers) {
    return await postStrictJson(`/api/script-bundles/${encodeURIComponent(bundleId)}/actions/${encodeURIComponent(actionId)}/web-terminal`, {
      headers,
      body: dimensions,
      failureMessage: 'Web 终端启动失败',
    });
  }

  async function killTerminalSession(sessionId, headers, {
    allowNotFound = false,
    failureMessage = '停止失败',
    throwOnSuccessFalse = true,
  } = {}) {
    const response = await fetch(`/api/terminal-sessions/${encodeURIComponent(sessionId)}/kill`, {
      method: 'POST',
      headers,
    });
    const json = await readJson(response);
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      throw new Error(json.error || failureMessage);
    }
    if (throwOnSuccessFalse && response.ok && json.success === false) {
      throw new Error(json.error || failureMessage);
    }
    return { status: response.status, json };
  }

  async function runModuleAction(moduleId, action) {
    const labels = { start: '启动', stop: '停止', restart: '重启' };
    const response = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: action === 'stop' ? JSON.stringify({ force: false }) : undefined,
    });
    const json = await readJson(response);
    if (!response.ok || json.success === false) {
      throw new Error(json.error || `${labels[action] || '操作'}失败`);
    }
    return json;
  }

  async function saveModuleWebUrl(moduleId, url) {
    return await postPassThroughJson(`/api/modules/${encodeURIComponent(moduleId)}/web-url`, { url });
  }

  async function setModuleVisibility(moduleId, visible) {
    return await postPassThroughJson(`/api/modules/${encodeURIComponent(moduleId)}/visibility`, { visible });
  }

  async function saveModuleSchedule(moduleId, schedule) {
    return await postPassThroughJson(`/api/modules/${encodeURIComponent(moduleId)}/schedule`, schedule);
  }

  async function runCurlRequest(siteId, payload = {}) {
    return await postPassThroughJson(`/api/curl-requests/${encodeURIComponent(siteId)}/run`, payload);
  }

  window.HubKitApi = {
    requestJson,
    postJson,
    confirmHighRiskAction,
    issueHighRiskTicket,
    highRiskHeaders,
    getModules,
    getWorkspaces,
    getWorkspaceStartPlan,
    getScriptBundles,
    getSystemActions,
    getConfigBackups,
    getConfigRestorePreview,
    getSettings,
    getStartPolicyTemplates,
    getModuleAudit,
    getModuleDiagnostics,
    checkModuleUpdate,
    getModuleLogs,
    getScriptActionLogs,
    searchLogs,
    getScriptActionHistory,
    getSystemActionLogs,
    getBootPreferenceHistory,
    saveSettings,
    startWorkspace,
    stopWorkspace,
    restoreConfigBackup,
    forceCloseModule,
    forceCloseAllModules,
    updateModule,
    applyBootPreferenceMode,
    runScriptAction,
    runCurlRequest,
    startScriptActionWebTerminal,
    killTerminalSession,
    runModuleAction,
    saveModuleWebUrl,
    setModuleVisibility,
    saveModuleSchedule,
  };
}());

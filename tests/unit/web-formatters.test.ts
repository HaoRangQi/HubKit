import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

function loadFormatters(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-formatters.js'), { window });
  return (window as any).HubKitFormatters;
}

describe('web formatter helper', () => {
  it('loads after log renderer and before the main inline app script', () => {
    const html = readWebFile('index.html');
    const apiScriptIndex = html.indexOf('<script src="/app-api.js"></script>');
    const logRendererScriptIndex = html.indexOf('<script src="/app-log-renderer.js"></script>');
    const formatterScriptIndex = html.indexOf('<script src="/app-formatters.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(apiScriptIndex).toBeGreaterThan(-1);
    expect(logRendererScriptIndex).toBeGreaterThan(apiScriptIndex);
    expect(formatterScriptIndex).toBeGreaterThan(logRendererScriptIndex);
    expect(mainScriptIndex).toBeGreaterThan(formatterScriptIndex);
  });

  it('formats module statuses and runtime phases', () => {
    const formatters = loadFormatters();

    expect(formatters.getStatusClass('running')).toBe('running');
    expect(formatters.getStatusClass('error')).toBe('error');
    expect(formatters.getStatusClass('starting')).toBe('starting');
    expect(formatters.getStatusClass('stopping')).toBe('stopping');
    expect(formatters.getStatusClass('unknown')).toBe('stopped');

    expect(formatters.getStatusText('running')).toBe('运行中');
    expect(formatters.getStatusText('stopped')).toBe('已停止');
    expect(formatters.getStatusText('custom')).toBe('custom');
    expect(formatters.getStatusText('')).toBe('未知');

    expect(formatters.getEffectiveStatus({ runtimeState: { phase: 'failed' }, status: 'running' })).toBe('error');
    expect(formatters.getEffectiveStatus({ runtimeState: { phase: 'installing' }, status: 'stopped' })).toBe('starting');
    expect(formatters.getEffectiveStatus({ runtimeState: { phase: 'health_checking' } })).toBe('starting');
    expect(formatters.getEffectiveStatus({ runtimeState: { phase: 'running' } })).toBe('running');
    expect(formatters.getEffectiveStatus({ runtimeState: { phase: 'stopped' }, status: 'running' })).toBe('stopped');
    expect(formatters.getEffectiveStatus({ status: 'error' })).toBe('error');
    expect(formatters.getEffectiveStatus({})).toBe('unknown');
  });

  it('formats start records, uptime, timestamps, and file sizes', () => {
    const formatters = loadFormatters();

    expect(formatters.formatLastStartRecord(null)).toBe('暂无记录');
    expect(formatters.formatLastStartRecord({
      outcome: 'succeeded',
      durationMs: 123.6,
      attemptCount: 2,
    })).toBe('124 ms · 2 次尝试');
    expect(formatters.formatLastStartRecord({
      outcome: 'failed',
      durationMs: Number.NaN,
      attemptCount: 3,
    })).toBe('失败 · 3 次尝试');
    expect(formatters.formatLastStartRecord({
      outcome: 'succeeded',
      durationMs: 12,
      attemptCount: undefined,
    })).toBe('12 ms · 尝试次数未知');
    expect(formatters.formatLastStartRecord({
      outcome: 'failed',
      durationMs: 12,
      attemptCount: -1,
    })).toBe('失败 · 尝试次数未知');

    expect(formatters.formatUptime(0)).toBe('N/A');
    expect(formatters.formatUptime(-1)).toBe('N/A');
    expect(formatters.formatUptime('bad')).toBe('N/A');
    expect(formatters.formatUptime(Number.POSITIVE_INFINITY)).toBe('N/A');
    expect(formatters.formatUptime(59)).toBe('0分钟');
    expect(formatters.formatUptime('60')).toBe('1分钟');
    expect(formatters.formatUptime(3660)).toBe('1小时 1分钟');
    expect(formatters.formatUptime(90000)).toBe('1天 1小时');

    expect(formatters.formatStartedAt(null)).toBe('未知');
    expect(formatters.formatStartedAt(undefined)).toBe('未知');
    expect(formatters.formatStartedAt('')).toBe('未知');
    expect(formatters.formatStartedAt('bad date')).toBe('未知');
    expect(formatters.formatStartedAt('2026-05-24T16:42:00')).toBe('2026-05-24 16:42');

    expect(formatters.formatFileSize(undefined)).toBe('0 B');
    expect(formatters.formatFileSize(0)).toBe('0 B');
    expect(formatters.formatFileSize(512.4)).toBe('512 B');
    expect(formatters.formatFileSize(1536)).toBe('1.5 KB');
    expect(formatters.formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('formats runtime phases, audit severities, and module types', () => {
    const formatters = loadFormatters();

    expect(formatters.getRuntimePhaseText('idle')).toBe('空闲');
    expect(formatters.getRuntimePhaseText('preparing')).toBe('准备中');
    expect(formatters.getRuntimePhaseText('installing')).toBe('安装依赖');
    expect(formatters.getRuntimePhaseText('health_checking')).toBe('健康检查');
    expect(formatters.getRuntimePhaseText('failed')).toBe('失败');
    expect(formatters.getRuntimePhaseText('custom_phase')).toBe('custom_phase');
    expect(formatters.getRuntimePhaseText('')).toBe('未知');

    expect(formatters.getAuditSeverityText('error')).toBe('错误');
    expect(formatters.getAuditSeverityText('warn')).toBe('告警');
    expect(formatters.getAuditSeverityText('info')).toBe('提示');
    expect(formatters.getAuditSeverityText(undefined)).toBe('提示');

    expect(formatters.getTypeText('nodejs')).toBe('Node.js');
    expect(formatters.getTypeText('python')).toBe('Python');
    expect(formatters.getTypeText('shell')).toBe('Shell');
    expect(formatters.getTypeText('binary')).toBe('binary');
    expect(formatters.getTypeText('')).toBe('N/A');
  });

  it('formats workspace plan step results with dashboard copy', () => {
    const formatters = loadFormatters();

    expect(formatters.formatWorkspaceStepResult('succeeded')).toBe('成功');
    expect(formatters.formatWorkspaceStepResult('failed')).toBe('失败');
    expect(formatters.formatWorkspaceStepResult('skipped')).toBe('跳过');
    expect(formatters.formatWorkspaceStepResult('missing')).toBe('缺失');
    expect(formatters.formatWorkspaceStepResult(' succeeded ')).toBe('成功');
    expect(formatters.formatWorkspaceStepResult(' missing ')).toBe('缺失');
    expect(formatters.formatWorkspaceStepResult('pending')).toBe('就绪');
    expect(formatters.formatWorkspaceStepResult(undefined)).toBe('就绪');
  });

  it('formats schedule status summaries for disabled, next action, and last result states', () => {
    const formatters = loadFormatters();

    expect(formatters.formatScheduleStatus({
      nextAction: { action: 'start', at: '2026-05-24T09:30:00' },
      lastResult: { action: 'stop', success: false, triggeredAt: '2026-05-23T22:00:00' },
    }, false)).toBe('定时任务未启用');

    expect(formatters.formatScheduleStatus({
      nextAction: { action: 'start', at: '2026-05-24T09:30:00' },
      lastResult: { action: 'start', success: true, triggeredAt: '2026-05-23T09:30:00' },
    }, true)).toBe('下次启动：2026-05-24 09:30；最近启动：成功 · 2026-05-23 09:30');

    expect(formatters.formatScheduleStatus({
      nextAction: { action: ' start ', at: '2026-05-24T09:30:00' },
      lastResult: { action: ' stop ', success: false, triggeredAt: '2026-05-23T22:00:00' },
    }, true)).toBe('下次启动：2026-05-24 09:30；最近停止：失败 · 2026-05-23 22:00');

    expect(formatters.formatScheduleStatus({
      nextAction: { action: 'stop', at: '2026-05-24T22:00:00' },
      lastResult: { action: 'stop', success: true, skipped: true, triggeredAt: '2026-05-23T22:00:00' },
    }, true)).toBe('下次停止：2026-05-24 22:00；最近停止：已跳过 · 2026-05-23 22:00');

    expect(formatters.formatScheduleStatus({
      nextAction: { action: 'start', at: '2026-05-25T09:30:00' },
      lastResult: { action: 'stop', success: false, triggeredAt: '2026-05-24T22:00:00' },
    }, true)).toBe('下次启动：2026-05-25 09:30；最近停止：失败 · 2026-05-24 22:00');

    expect(formatters.formatScheduleStatus({
      lastResult: { action: 'start', success: true, triggeredAt: '2026-05-24T09:30:00' },
    }, true)).toBe('下次触发：未设置启动或停止时间；最近启动：成功 · 2026-05-24 09:30');

    expect(formatters.formatScheduleStatus({
      nextAction: { action: 'stop', at: '2026-05-24T22:00:00' },
    }, true)).toBe('下次停止：2026-05-24 22:00；最近结果：暂无');

    expect(formatters.formatScheduleStatus({
      nextAction: { action: 'restart', at: '2026-05-25T10:00:00' },
      lastResult: { action: 'restart', success: true, triggeredAt: '2026-05-24T10:00:00' },
    }, true)).toBe('下次触发：2026-05-25 10:00；最近触发：成功 · 2026-05-24 10:00');

    expect(formatters.formatScheduleStatus({}, true)).toBe('下次触发：未设置启动或停止时间；最近结果：暂无');
  });

  it('formats run chips, run labels, and boot preference mode copy', () => {
    const formatters = loadFormatters();

    expect(formatters.getRunChipClass('succeeded')).toBe('success');
    expect(formatters.getRunChipClass('failed')).toBe('error');
    expect(formatters.getRunChipClass('running')).toBe('running');
    expect(formatters.getRunChipClass('launched')).toBe('running');
    expect(formatters.getRunChipClass('idle')).toBe('');
    expect(formatters.getRunChipClass(undefined)).toBe('');

    expect(formatters.getRunStateLabel(null)).toBe('未执行');
    expect(formatters.getRunStateLabel({ status: 'succeeded' })).toBe('最近成功');
    expect(formatters.getRunStateLabel({ status: 'failed' })).toBe('最近失败');
    expect(formatters.getRunStateLabel({ status: 'running' })).toBe('后台运行中');
    expect(formatters.getRunStateLabel({ status: 'launched' })).toBe('已在终端打开');
    expect(formatters.getRunStateLabel({ status: 'queued' })).toBe('未执行');

    expect(formatters.formatBootPreferenceMode('default')).toBe('当前允许自动启动');
    expect(formatters.formatBootPreferenceMode('block_all')).toBe('已阻止开盖与接电启动');
    expect(formatters.formatBootPreferenceMode('block_lid')).toBe('仅阻止开盖启动');
    expect(formatters.formatBootPreferenceMode('block_power')).toBe('仅阻止接电启动');
    expect(formatters.formatBootPreferenceMode('unknown')).toBe('状态未知');

    expect(formatters.describeBootPreferenceMode('default')).toBe('现在是默认状态，开盖和接入电源都可能触发自动启动。');
    expect(formatters.describeBootPreferenceMode('block_all')).toBe('现在已同时阻止开盖启动和接电启动。');
    expect(formatters.describeBootPreferenceMode('block_lid')).toBe('现在只阻止开盖启动，接入电源仍可能自动启动。');
    expect(formatters.describeBootPreferenceMode('block_power')).toBe('现在只阻止接电启动，开盖仍可能自动启动。');
    expect(formatters.describeBootPreferenceMode('unknown')).toBe('当前读取失败，暂时无法确认真实状态。');
  });

  it('formats diagnostics listener and PID candidate summaries', () => {
    const formatters = loadFormatters();

    expect(formatters.trimCommand('')).toBe('unknown');
    expect(formatters.trimCommand(undefined)).toBe('unknown');
    expect(formatters.trimCommand({ command: 'node server.js' })).toBe('unknown');
    expect(formatters.trimCommand('node server.js')).toBe('node server.js');
    expect(formatters.trimCommand('a'.repeat(43))).toBe(`${'a'.repeat(39)}...`);

    expect(formatters.formatListenerSummary({ length: 1 })).toBe('无');
    expect(formatters.formatListenerSummary([])).toBe('无');
    expect(formatters.formatListenerSummary([
      { pid: 101, command: 'node server.js', alive: true },
      { pid: 202, command: 'python worker.py', alive: false },
      { pid: 303, command: 'ignored process', alive: true },
    ])).toBe('101(node server.js)；202(python worker.py,dead)');

    expect(formatters.formatListenerSummary([
      { pid: 404, command: 'x'.repeat(43), alive: true },
    ])).toBe(`404(${'x'.repeat(39)}...)`);

    expect(formatters.formatListenerSummary([
      { pid: 505, command: { argv: ['node'] }, alive: true },
    ])).toBe('505(unknown)');

    expect(formatters.formatPidCandidatesSummary(null)).toBe('无');
    expect(formatters.formatPidCandidatesSummary({ length: 1 })).toBe('无');
    expect(formatters.formatPidCandidatesSummary([
      { pid: 101, alive: true },
      { pid: 202, alive: false },
      { pid: 303, alive: true },
      { pid: 404, alive: true },
    ])).toBe('101、202(dead)、303');
  });

  it('formats dashboard section icon and accent mappings', () => {
    const formatters = loadFormatters();

    expect(formatters.getScriptGroupIcon('environment')).toBe('download');
    expect(formatters.getScriptGroupIcon('system-tuning')).toBe('tune');
    expect(formatters.getScriptGroupIcon('data-tools')).toBe('article');
    expect(formatters.getScriptGroupIcon('custom')).toBe('dashboard');
    expect(formatters.getScriptGroupIcon(undefined)).toBe('dashboard');

    expect(formatters.getDashboardGroupAccent('environment', 'script')).toBe('var(--md-primary)');
    expect(formatters.getDashboardGroupAccent('system-tuning', 'script')).toBe('var(--md-warning)');
    expect(formatters.getDashboardGroupAccent('data-tools', 'script')).toBe('var(--md-tertiary)');
    expect(formatters.getDashboardGroupAccent('default', 'module')).toBe('var(--md-primary)');
    expect(formatters.getDashboardGroupAccent('custom', 'module')).toBe('var(--md-secondary)');
    expect(formatters.getDashboardGroupAccent('custom', 'script')).toBe('var(--md-secondary)');
  });

  it('formats wallpaper input values for local cached images', () => {
    const formatters = loadFormatters();

    expect(formatters.isLocalWallpaperUrl('data:image/png;base64,abc')).toBe(true);
    expect(formatters.isLocalWallpaperUrl('https://example.test/wallpaper.png')).toBe(false);
    expect(formatters.isLocalWallpaperUrl(undefined)).toBe(false);

    expect(formatters.formatWallpaperUrlForInput('https://example.test/wallpaper.png')).toBe('https://example.test/wallpaper.png');
    expect(formatters.formatWallpaperUrlForInput('')).toBe('');
    expect(formatters.formatWallpaperUrlForInput(`data:image/png;base64,${'a'.repeat(100)}`)).toBe('本地上传图片（浏览器缓存，约 1 KB）');
    expect(formatters.formatWallpaperUrlForInput(`data:image/png;base64,${'a'.repeat(1400 * 1024)}`)).toBe('本地上传图片（浏览器缓存，约 1.0 MB）');
  });

  it('keeps index formatter functions as thin HubKitFormatters wrappers', () => {
    const html = readWebFile('index.html');

    expect(html).toContain('function getStatusClass(status) {\n      return window.HubKitFormatters.getStatusClass(status);\n    }');
    expect(html).toContain('function getStatusText(status) {\n      return window.HubKitFormatters.getStatusText(status);\n    }');
    expect(html).toContain('function getEffectiveStatus(module) {\n      return window.HubKitFormatters.getEffectiveStatus(module);\n    }');
    expect(html).toContain('function formatLastStartRecord(record) {\n      return window.HubKitFormatters.formatLastStartRecord(record);\n    }');
    expect(html).toContain('function getRuntimePhaseText(phase) {\n      return window.HubKitFormatters.getRuntimePhaseText(phase);\n    }');
    expect(html).toContain('function getAuditSeverityText(severity) {\n      return window.HubKitFormatters.getAuditSeverityText(severity);\n    }');
    expect(html).toContain('function getTypeText(type) {\n      return window.HubKitFormatters.getTypeText(type);\n    }');
    expect(html).toContain('function formatUptime(seconds) {\n      return window.HubKitFormatters.formatUptime(seconds);\n    }');
    expect(html).toContain('function formatStartedAt(value) {\n      return window.HubKitFormatters.formatStartedAt(value);\n    }');
    expect(html).toContain('function formatFileSize(bytes) {\n      return window.HubKitFormatters.formatFileSize(bytes);\n    }');
    expect(html).toContain('function formatWorkspaceStepResult(value) {\n      return window.HubKitFormatters.formatWorkspaceStepResult(value);\n    }');
    expect(html).toContain('function formatScheduleStatus(scheduleStatus, enabled) {\n      return window.HubKitFormatters.formatScheduleStatus(scheduleStatus, enabled);\n    }');
    expect(html).toContain('function getRunChipClass(status) {\n      return window.HubKitFormatters.getRunChipClass(status);\n    }');
    expect(html).toContain('function getRunStateLabel(run) {\n      return window.HubKitFormatters.getRunStateLabel(run);\n    }');
    expect(html).toContain('function formatBootPreferenceMode(mode) {\n      return window.HubKitFormatters.formatBootPreferenceMode(mode);\n    }');
    expect(html).toContain('function describeBootPreferenceMode(mode) {\n      return window.HubKitFormatters.describeBootPreferenceMode(mode);\n    }');
    expect(html).toContain('function trimCommand(command) {\n      return window.HubKitFormatters.trimCommand(command);\n    }');
    expect(html).toContain('function formatListenerSummary(listeners) {\n      return window.HubKitFormatters.formatListenerSummary(listeners);\n    }');
    expect(html).toContain('function formatPidCandidatesSummary(candidates) {\n      return window.HubKitFormatters.formatPidCandidatesSummary(candidates);\n    }');
    expect(html).toContain('function getScriptGroupIcon(groupId) {\n      return window.HubKitFormatters.getScriptGroupIcon(groupId);\n    }');
    expect(html).toContain('function getDashboardGroupAccent(groupId, kind) {\n      return window.HubKitFormatters.getDashboardGroupAccent(groupId, kind);\n    }');
    expect(html).toContain('function isLocalWallpaperUrl(value = uiPrefs.wallpaperUrl) {\n      return window.HubKitFormatters.isLocalWallpaperUrl(value);\n    }');
    expect(html).toContain('function formatWallpaperUrlForInput() {\n      return window.HubKitFormatters.formatWallpaperUrlForInput(uiPrefs.wallpaperUrl);\n    }');
  });
});

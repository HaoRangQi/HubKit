(function () {
  function getStatusClass(status) {
    if (status === 'running') return 'running';
    if (status === 'error') return 'error';
    if (status === 'starting') return 'starting';
    if (status === 'stopping') return 'stopping';
    return 'stopped';
  }

  function getStatusText(status) {
    const statusMap = {
      running: '运行中',
      stopped: '已停止',
      starting: '启动中',
      stopping: '停止中',
      error: '错误',
      unknown: '未知',
    };
    return statusMap[status] || status || '未知';
  }

  function getEffectiveStatus(module) {
    const phase = module?.runtimeState?.phase;
    if (phase === 'failed') return 'error';
    if (phase === 'preparing' || phase === 'installing' || phase === 'starting' || phase === 'health_checking') {
      return 'starting';
    }
    if (phase === 'running') return 'running';
    if (phase === 'stopped') return 'stopped';
    return module?.status || 'unknown';
  }

  function formatLastStartRecord(record) {
    if (!record) return '暂无记录';
    const duration = Number.isFinite(record.durationMs) ? `${Math.max(0, Math.round(record.durationMs))} ms` : '耗时未知';
    const attempts = Number.isFinite(record.attemptCount) && record.attemptCount > 0
      ? `${Math.round(record.attemptCount)} 次尝试`
      : '尝试次数未知';
    return record.outcome === 'succeeded'
      ? `${duration} · ${attempts}`
      : `失败 · ${attempts}`;
  }

  function getRuntimePhaseText(phase) {
    const phaseMap = {
      idle: '空闲',
      preparing: '准备中',
      installing: '安装依赖',
      starting: '启动中',
      health_checking: '健康检查',
      running: '运行中',
      stopped: '已停止',
      failed: '失败',
    };
    return phaseMap[phase] || phase || '未知';
  }

  function getAuditSeverityText(severity) {
    if (severity === 'error') return '错误';
    if (severity === 'warn') return '告警';
    return '提示';
  }

  function getTypeText(type) {
    const typeMap = {
      nodejs: 'Node.js',
      python: 'Python',
      shell: 'Shell',
    };
    return typeMap[type] || type || 'N/A';
  }

  function formatUptime(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return 'N/A';
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
  }

  function formatStartedAt(value) {
    if (value === null || value === undefined || value === '') return '未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未知';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatWorkspaceStepResult(value) {
    const result = typeof value === 'string' ? value.trim() : '';
    if (result === 'succeeded') return '成功';
    if (result === 'failed') return '失败';
    if (result === 'skipped') return '跳过';
    if (result === 'missing') return '缺失';
    return '就绪';
  }

  function getScheduleActionText(action) {
    const value = typeof action === 'string' ? action.trim() : '';
    if (value === 'start') return '启动';
    if (value === 'stop') return '停止';
    return '触发';
  }

  function formatScheduleStatus(scheduleStatus, enabled) {
    if (!enabled) return '定时任务未启用';
    const next = scheduleStatus?.nextAction;
    const last = scheduleStatus?.lastResult;
    const parts = [];
    if (next?.at) {
      parts.push(`下次${getScheduleActionText(next.action)}：${formatStartedAt(next.at)}`);
    } else {
      parts.push('下次触发：未设置启动或停止时间');
    }
    if (last?.triggeredAt) {
      const outcome = last.success
        ? (last.skipped ? '已跳过' : '成功')
        : '失败';
      parts.push(`最近${getScheduleActionText(last.action)}：${outcome} · ${formatStartedAt(last.triggeredAt)}`);
    } else {
      parts.push('最近结果：暂无');
    }
    return parts.join('；');
  }

  function getRunChipClass(status) {
    if (status === 'succeeded') return 'success';
    if (status === 'failed') return 'error';
    if (status === 'running' || status === 'launched') return 'running';
    return '';
  }

  function getRunStateLabel(run) {
    if (!run) return '未执行';
    if (run.status === 'succeeded') return '最近成功';
    if (run.status === 'failed') return '最近失败';
    if (run.status === 'running') return '后台运行中';
    if (run.status === 'launched') return '已在终端打开';
    return '未执行';
  }

  function formatBootPreferenceMode(mode) {
    if (mode === 'default') return '当前允许自动启动';
    if (mode === 'block_all') return '已阻止开盖与接电启动';
    if (mode === 'block_lid') return '仅阻止开盖启动';
    if (mode === 'block_power') return '仅阻止接电启动';
    return '状态未知';
  }

  function describeBootPreferenceMode(mode) {
    if (mode === 'default') return '现在是默认状态，开盖和接入电源都可能触发自动启动。';
    if (mode === 'block_all') return '现在已同时阻止开盖启动和接电启动。';
    if (mode === 'block_lid') return '现在只阻止开盖启动，接入电源仍可能自动启动。';
    if (mode === 'block_power') return '现在只阻止接电启动，开盖仍可能自动启动。';
    return '当前读取失败，暂时无法确认真实状态。';
  }

  function trimCommand(command) {
    const value = typeof command === 'string' ? command : '';
    if (!value) return 'unknown';
    if (value.length <= 42) return value;
    return `${value.slice(0, 39)}...`;
  }

  function formatListenerSummary(listeners) {
    if (!Array.isArray(listeners) || listeners.length === 0) return '无';
    return listeners
      .slice(0, 2)
      .map((item) => `${item.pid}(${trimCommand(item.command)}${item.alive ? '' : ',dead'})`)
      .join('；');
  }

  function formatPidCandidatesSummary(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return '无';
    return candidates
      .slice(0, 3)
      .map((item) => `${item.pid}${item.alive ? '' : '(dead)'}`)
      .join('、');
  }

  function getScriptGroupIcon(groupId) {
    if (groupId === 'environment') return 'download';
    if (groupId === 'system-tuning') return 'tune';
    if (groupId === 'data-tools') return 'article';
    return 'dashboard';
  }

  function getDashboardGroupAccent(groupId, kind) {
    if (kind === 'script') {
      if (groupId === 'environment') return 'var(--md-primary)';
      if (groupId === 'system-tuning') return 'var(--md-warning)';
      if (groupId === 'data-tools') return 'var(--md-tertiary)';
    }
    if (groupId === 'default') return 'var(--md-primary)';
    return 'var(--md-secondary)';
  }

  function isLocalWallpaperUrl(value) {
    return String(value || '').startsWith('data:image/');
  }

  function formatWallpaperUrlForInput(value) {
    const url = String(value || '');
    if (!isLocalWallpaperUrl(url)) return url;
    const sizeKb = Math.max(1, Math.round(url.length * 0.75 / 1024));
    const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
    return `本地上传图片（浏览器缓存，约 ${sizeLabel}）`;
  }

  window.HubKitFormatters = {
    getStatusClass,
    getStatusText,
    getEffectiveStatus,
    formatLastStartRecord,
    getRuntimePhaseText,
    getAuditSeverityText,
    getTypeText,
    formatUptime,
    formatStartedAt,
    formatFileSize,
    formatWorkspaceStepResult,
    formatScheduleStatus,
    getRunChipClass,
    getRunStateLabel,
    formatBootPreferenceMode,
    describeBootPreferenceMode,
    trimCommand,
    formatListenerSummary,
    formatPidCandidatesSummary,
    getScriptGroupIcon,
    getDashboardGroupAccent,
    isLocalWallpaperUrl,
    formatWallpaperUrlForInput,
  };
}());

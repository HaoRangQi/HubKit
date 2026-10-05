(function () {
  // Pure rendering: callers own preferences, request state and action handlers.
  function render(module, state, html) {
    const f = window.HubKitFormatters;
    const { escapeHtml: text, escapeAttr: attr, icon } = html;
    const runtime = module.runtimeState || {};
    const status = f.getEffectiveStatus(module);
    const busy = ['starting', 'stopping'].includes(status) || Boolean(state.actionLoading);
    const running = module.status === 'running';
    const update = state.updateCheck || {};
    const action = (handler, args, label, glyph, style = 'btn-outlined', disabled = false) =>
      `<button class="btn ${style}" type="button" ${disabled ? 'disabled' : ''} onclick="${attr(`${handler}(${args.map(value => JSON.stringify(value)).join(',')})`)}">${icon(glyph)}<span>${text(label)}</span></button>`;
    const metric = (label, value) => `<div class="metric"><span class="metric-label">${text(label)}</span><span class="metric-value">${text(value)}</span></div>`;
    const summary = getSummary(module, f);
    const failure = runtime.phase === 'failed';
    const primaryAction = running
      ? action('stopModule', [module.id], state.actionLoading === 'stop' ? '停止中...' : '停止', 'stop_circle', 'btn-outlined', busy)
      : action('startModule', [module.id], busy ? runtime.summary || '处理中...' : module.startReadiness?.actionLabel || '启动', 'play_circle', 'btn-filled', busy);
    const openAction = module.webUrl
      ? action('openModuleUrl', [module.id, module.webUrl], '打开', 'open_in_new', running ? 'btn-filled' : 'btn-outlined')
      : '';

    return `
      <article class="module-card service-card glass-panel ${f.getStatusClass(status)}" data-module-id="${attr(module.id)}">
        <div class="module-header">
          <div class="module-title"><h3>${text(module.name)}</h3></div>
          <div class="state-badge ${f.getStatusClass(status)}"><span class="state-dot"></span><span>${text(f.getStatusText(status))}</span></div>
        </div>
        ${module.description ? `<p class="module-description">${text(module.description)}</p>` : ''}
        <p class="module-status-summary ${summary.warning ? 'module-status-warning' : ''}">${text(summary.text)}</p>
        <div class="module-primary-actions">
          ${running ? openAction + primaryAction : primaryAction + openAction}
          ${action('showLogs', [module.id, module.name], failure ? '查看失败日志' : '日志', 'article', 'btn-text')}
        </div>
        <details class="module-details" data-module-id="${attr(module.id)}" ${state.detailsOpen ? 'open' : ''} ontoggle="rememberModuleDetails(this)">
          <summary><span>详情与维护</span><span class="module-details-hint">${update.status === 'checked' && update.hasUpdates ? '有更新 · ' : ''}<span class="when-closed">展开</span><span class="when-open">收起</span></span></summary>
          <div class="module-details-content">
            <div class="module-technical-id">${text(module.id)} · ${text(f.getTypeText(module.type))}</div>
            ${runtime.failure?.details ? `<p class="module-detail-note">${text(runtime.failure.details)}</p>` : ''}
            ${module.startReadiness?.ready === false && module.startReadiness.details ? `<p class="module-detail-note">${text(module.startReadiness.details)}</p>` : ''}
            <div class="metric-grid">
              ${metric('进程', module.pid || '未运行')}
              ${metric('启动时间', f.formatStartedAt(module.startedAt))}
              ${metric('健康状态', runtime.health?.summary || '未检查')}
              ${metric('最近启动', f.formatLastStartRecord(runtime.lastStartRecord))}
            </div>
            ${renderProcess(module, state, { text, metric, action }, f)}
            <div class="module-maintenance-actions">
              ${running ? action('restartModule', [module.id], state.actionLoading === 'restart' ? '重启中...' : '重启', 'restart_alt', 'btn-outlined', busy) : ''}
              ${module.updateable ? renderUpdate(module, update, { action, text }, f) : ''}
            </div>
          </div>
        </details>
      </article>
    `;
  }

  function getSummary(module, f) {
    const runtime = module.runtimeState || {};
    if (runtime.phase === 'failed' || module.status === 'error') {
      return { warning: true, text: runtime.failure?.summary || runtime.summary || module.error || '运行异常，请查看日志' };
    }
    if (runtime.health?.state === 'unhealthy') {
      return { warning: true, text: runtime.health.summary || '健康检查未通过，请查看详情' };
    }
    if (module.startReadiness?.ready === false) {
      return { warning: true, text: module.startReadiness.summary || '启动前需要准备依赖' };
    }
    if (f.getEffectiveStatus(module) === 'running') {
      return { warning: false, text: module.uptime ? `已运行 ${f.formatUptime(module.uptime)}` : '正在运行' };
    }
    return { warning: false, text: runtime.summary || '待机，可按需启动' };
  }

  function renderProcess(module, state, html, f) {
    const { text, action } = html;
    const diagnostics = state.diagnostics;
    const port = diagnostics?.port ?? window.HubKitDiagnostics.parsePort(module.webUrl);
    const disabled = state.diagnosticsLoading || state.forceCloseLoading;
    const line = (label, value) => `<div class="process-kv-row"><span class="process-kv-key">${text(label)}</span><span class="process-kv-value">${text(value)}</span></div>`;
    return `
      <section class="process-mini">
        <div class="process-mini-head"><span class="process-mini-title">进程检查</span><span class="process-mini-time">${diagnostics?.checkedAt ? text(f.formatStartedAt(diagnostics.checkedAt)) : '未检查'}</span></div>
        <div class="process-kv">
          ${line('PID', `${diagnostics?.pidFromStatus ?? module.pid ?? '无'} / 文件 ${diagnostics?.pidFromPidFile ?? '未检查'}`)}
          ${line('端口', port ? `${port} · ${diagnostics ? (diagnostics.portOccupied ? '已占用' : '空闲') : '未检查'}` : '未配置')}
          ${line('占用进程', diagnostics ? f.formatListenerSummary(diagnostics.portListeners || []) : '未检查')}
          ${line('候选进程', diagnostics ? f.formatPidCandidatesSummary(diagnostics.pidCandidates || []) : '未检查')}
        </div>
        <div class="process-mini-actions">
          ${action('checkModuleDiagnostics', [module.id], state.diagnosticsLoading ? '检查中...' : '检查状态', 'refresh', 'btn-outlined btn-sm', disabled)}
          ${action('forceCloseModule', [module.id], state.forceCloseLoading ? '处理中...' : '强制关闭', 'stop_circle', 'btn-error btn-sm', disabled)}
        </div>
      </section>
    `;
  }

  function renderUpdate(module, update, html, f) {
    const { action, text } = html;
    const busy = ['checking', 'updating'].includes(update.status);
    const available = update.status === 'checked' && update.hasUpdates === true;
    let note = '支持检查更新 · 尚未检查版本';
    if (update.status === 'checking') note = '正在检查上游版本…';
    if (update.status === 'updating') note = '正在更新模块…';
    if (update.status === 'error') note = update.message || '检查失败，请重试';
    if (update.status === 'checked') note = available ? `${update.commitsBehind} 个上游新提交` : '上次检查：上游暂无新提交';
    if (update.checkedAt) note += ` · ${f.formatStartedAt(update.checkedAt)}`;
    return `<div class="module-update-status" role="status">
      <p class="module-detail-note">${text(note)}</p>
      <div class="module-update-actions">
        ${available ? action('performUpdate', [module.id], '安装更新', 'download', 'btn-tonal') : ''}
        ${action('checkAndUpdate', [module.id], busy ? '处理中...' : update.status === 'error' ? '重试检查' : available ? '重新检查' : '检查更新', 'system_update_alt', 'btn-outlined', busy)}
      </div>
    </div>`;
  }

  window.HubKitModuleCards = { render };
}());

(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function inferLogLevel(line) {
    const value = String(line ?? '');
    const lower = value.toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) {
      return 'error';
    }
    if (lower.includes('warn')) {
      return 'warn';
    }
    if (/^\s+at\s/.test(value)) {
      return 'stack';
    }
    return 'info';
  }

  function getLogLineClass(level) {
    if (level === 'error') return 'log-line log-line-error';
    if (level === 'warn') return 'log-line log-line-warn';
    if (level === 'stack' || level === 'debug') return 'log-line log-line-stack';
    return 'log-line log-line-info';
  }

  function renderLogLines(rawLogs) {
    return String(rawLogs).split('\n').map((line) => {
      const level = inferLogLevel(line);
      return `<span class="${getLogLineClass(level)}" data-level="${level}">${escapeHtml(line || ' ')}</span>`;
    }).join('');
  }

  function renderGlobalLogSearchResults(payload) {
    if (payload?.error) {
      return renderLogLines(payload.error);
    }
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (results.length === 0) {
      return renderLogLines('暂无匹配日志');
    }
    return results.map((item) => {
      const entry = item && typeof item === 'object' ? item : {};
      const level = entry.level || 'info';
      const source = entry.sourceName || entry.sourceId || 'unknown';
      const prefix = `[${source}]`;
      return `<span class="${getLogLineClass(level)}" data-level="${escapeAttr(level)}">${escapeHtml(`${prefix} ${entry.message || ''}`)}</span>`;
    }).join('');
  }

  function shouldShowLogLine(options = {}) {
    const config = options && typeof options === 'object' ? options : {};
    const {
      text = '',
      lineLevel = '',
      term = '',
      selectedLevel = 'all',
    } = config;
    const normalizedTerm = String(term || '').trim().toLowerCase();
    const normalizedText = String(text || '').toLowerCase();
    const normalizedLineLevel = String(lineLevel || '');
    const normalizedSelectedLevel = String(selectedLevel || 'all');
    const textMatch = !normalizedTerm || normalizedText.includes(normalizedTerm);
    const levelMatch = normalizedSelectedLevel === 'all'
      || normalizedLineLevel === normalizedSelectedLevel
      || (normalizedSelectedLevel === 'info' && normalizedLineLevel === 'stack');
    return textMatch && levelMatch;
  }

  window.HubKitLogRenderer = {
    inferLogLevel,
    getLogLineClass,
    renderLogLines,
    renderGlobalLogSearchResults,
    shouldShowLogLine,
  };
}());

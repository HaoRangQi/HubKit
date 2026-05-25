(function () {
  function reportHasSeverity(report, severity) {
    return (report?.findings || []).some((item) => item.severity === severity);
  }

  function reportHasMissingCommands(report) {
    return (report?.environment?.missingCommands || []).length > 0
      || (report?.findings || []).some((item) => item.code === 'missing_runtime_commands');
  }

  function reportHasMissingEnvVars(report) {
    return (report?.environment?.missingEnvVars || []).length > 0
      || (report?.findings || []).some((item) => item.code === 'missing_env_vars');
  }

  function getDiagnosticsFilterOptions(reports) {
    const items = Array.isArray(reports) ? reports : [];
    return [
      { id: 'all', label: '全部', count: items.length },
      { id: 'error', label: '错误', count: items.filter((report) => reportHasSeverity(report, 'error')).length },
      { id: 'warn', label: '告警', count: items.filter((report) => !reportHasSeverity(report, 'error') && reportHasSeverity(report, 'warn')).length },
      { id: 'missing-command', label: '缺命令', count: items.filter(reportHasMissingCommands).length },
      { id: 'missing-env', label: '缺变量', count: items.filter(reportHasMissingEnvVars).length },
    ];
  }

  function reportMatchesDiagnosticsFilter(report, filter) {
    if (filter === 'error') return reportHasSeverity(report, 'error');
    if (filter === 'warn') return !reportHasSeverity(report, 'error') && reportHasSeverity(report, 'warn');
    if (filter === 'missing-command') return reportHasMissingCommands(report);
    if (filter === 'missing-env') return reportHasMissingEnvVars(report);
    return true;
  }

  function parsePort(urlValue) {
    if (!urlValue) return null;
    try {
      const parsed = new URL(urlValue);
      if (parsed.port) return Number(parsed.port);
      if (parsed.protocol === 'http:') return 80;
      if (parsed.protocol === 'https:') return 443;
    } catch (error) {
      return null;
    }
    return null;
  }

  window.HubKitDiagnostics = {
    getDiagnosticsFilterOptions,
    reportMatchesDiagnosticsFilter,
    reportHasSeverity,
    reportHasMissingCommands,
    reportHasMissingEnvVars,
    parsePort,
  };
}());

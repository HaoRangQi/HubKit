import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebHtml(): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public/index.html'), 'utf-8');
}

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

function loadDiagnostics(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-diagnostics.js'), { window, URL });
  return (window as any).HubKitDiagnostics;
}

describe('web diagnostics UI', () => {
  it('loads diagnostics helper before the main inline app script', () => {
    const html = readWebHtml();
    const formatterScriptIndex = html.indexOf('<script src="/app-formatters.js"></script>');
    const diagnosticsScriptIndex = html.indexOf('<script src="/app-diagnostics.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(formatterScriptIndex).toBeGreaterThan(-1);
    expect(diagnosticsScriptIndex).toBeGreaterThan(formatterScriptIndex);
    expect(mainScriptIndex).toBeGreaterThan(diagnosticsScriptIndex);
  });

  it('filters diagnostics reports with the extracted helper', () => {
    const diagnostics = loadDiagnostics();
    const reports = [
      {
        findings: [{ severity: 'error', code: 'bad_config' }],
        environment: { missingCommands: [], missingEnvVars: [] },
      },
      {
        findings: [{ severity: 'warn', code: 'missing_runtime_commands' }],
        environment: { missingCommands: [], missingEnvVars: [] },
      },
      {
        findings: [{ severity: 'warn', code: 'missing_env_vars' }],
        environment: { missingCommands: [], missingEnvVars: ['TOKEN'] },
      },
      {
        findings: [],
        environment: { missingCommands: ['node'], missingEnvVars: [] },
      },
    ];

    expect(diagnostics.getDiagnosticsFilterOptions(reports)).toEqual([
      { id: 'all', label: '全部', count: 4 },
      { id: 'error', label: '错误', count: 1 },
      { id: 'warn', label: '告警', count: 2 },
      { id: 'missing-command', label: '缺命令', count: 2 },
      { id: 'missing-env', label: '缺变量', count: 1 },
    ]);
    expect(diagnostics.getDiagnosticsFilterOptions(undefined)[0]).toEqual({ id: 'all', label: '全部', count: 0 });

    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[0], 'error')).toBe(true);
    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[0], 'warn')).toBe(false);
    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[1], 'warn')).toBe(true);
    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[1], 'missing-command')).toBe(true);
    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[2], 'missing-env')).toBe(true);
    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[3], 'missing-command')).toBe(true);
    expect(diagnostics.reportMatchesDiagnosticsFilter(reports[3], 'all')).toBe(true);

    expect(diagnostics.reportHasSeverity(undefined, 'error')).toBe(false);
    expect(diagnostics.reportHasMissingCommands(undefined)).toBe(false);
    expect(diagnostics.reportHasMissingEnvVars(undefined)).toBe(false);

    expect(diagnostics.parsePort('http://localhost:5173')).toBe(5173);
    expect(diagnostics.parsePort('https://example.test:8443/path')).toBe(8443);
    expect(diagnostics.parsePort('http://example.test/path')).toBe(80);
    expect(diagnostics.parsePort('https://example.test/path')).toBe(443);
    expect(diagnostics.parsePort('bad url')).toBeNull();
    expect(diagnostics.parsePort('')).toBeNull();
  });

  it('renders local diagnostics filters without changing the audit API', () => {
    const html = readWebHtml();

    expect(html).toContain("fetch('/api/module-audit')");
    expect(html).toContain("let diagnosticsFilter = 'all'");
    expect(html).toContain('function getDiagnosticsFilterOptions');
    expect(html).toContain('function setDiagnosticsFilter');
    expect(html).toContain('function reportMatchesDiagnosticsFilter');
    expect(html).toContain("onclick=\"setDiagnosticsFilter('${jsString(option.id)}')\"");
    expect(html).toContain('function getDiagnosticsFilterOptions(reports) {\n      return window.HubKitDiagnostics.getDiagnosticsFilterOptions(reports);\n    }');
    expect(html).toContain('function reportMatchesDiagnosticsFilter(report, filter) {\n      return window.HubKitDiagnostics.reportMatchesDiagnosticsFilter(report, filter);\n    }');
    expect(html).toContain('function reportHasSeverity(report, severity) {\n      return window.HubKitDiagnostics.reportHasSeverity(report, severity);\n    }');
    expect(html).toContain('function reportHasMissingCommands(report) {\n      return window.HubKitDiagnostics.reportHasMissingCommands(report);\n    }');
    expect(html).toContain('function reportHasMissingEnvVars(report) {\n      return window.HubKitDiagnostics.reportHasMissingEnvVars(report);\n    }');
    expect(html).toContain('function parsePort(urlValue) {\n      return window.HubKitDiagnostics.parsePort(urlValue);\n    }');
  });

  it('supports expanding audit findings beyond the card preview', () => {
    const html = readWebHtml();

    expect(html).toContain('let expandedAuditModules = new Set()');
    expect(html).toContain('function toggleAuditFindings');
    expect(html).toContain('expandedAuditModules.has(report.moduleId)');
    expect(html).toContain('const visibleFindings = expanded ? findings : findings.slice(0, 4)');
    expect(html).toContain('function createAuditFindingItem');
    expect(html).toContain("onclick=\"toggleAuditFindings('${jsString(report.moduleId)}')\"");
    expect(html).toContain('显示全部 findings（剩余 ${hiddenFindingCount} 条）');
    expect(html).toContain('收起 findings');
  });
});

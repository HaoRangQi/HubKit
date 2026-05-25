import { createAuditFinding, sortAuditFindings, summarizeLogExcerpt } from '../../src/health/module-audit';

describe('createAuditFinding', () => {
  it('adds impact, fix, and verify guidance for known findings', () => {
    const finding = createAuditFinding({
      severity: 'error',
      code: 'script_missing',
      summary: '入口脚本不存在',
      details: '/tmp/missing.js',
    });

    expect(finding.impact).toContain('启动动作一定会失败');
    expect(finding.fix).toMatchObject({
      kind: 'manual',
      label: '修正入口脚本',
    });
    expect(finding.verify).toMatchObject({
      kind: 'check_status',
      label: '重新检查入口',
    });
  });

  it('allows callers to override generated guidance', () => {
    const finding = createAuditFinding({
      severity: 'warn',
      code: 'missing_env_vars',
      summary: '缺少环境变量',
      impact: '自定义影响说明',
      fix: {
        kind: 'open_settings',
        label: '打开配置',
      },
      verify: {
        label: '确认变量',
      },
    });

    expect(finding.impact).toBe('自定义影响说明');
    expect(finding.fix).toMatchObject({
      kind: 'open_settings',
      label: '打开配置',
      description: '参考 .env.example 等模板补齐缺失变量。',
    });
    expect(finding.verify).toMatchObject({
      kind: 'check_status',
      label: '确认变量',
      description: '刷新体检结果，确认缺失环境变量已补齐。',
    });
  });

  it('falls back safely for unknown finding codes', () => {
    const finding = createAuditFinding({
      severity: 'warn',
      code: 'custom_warning',
      summary: '自定义告警',
      recommendation: '按模块文档处理',
    });

    expect(finding.impact).toBe('该问题可能影响模块稳定性。');
    expect(finding.fix).toMatchObject({
      kind: 'manual',
      label: '手动处理',
      description: '按模块文档处理',
    });
    expect(finding.verify).toMatchObject({
      kind: 'check_status',
      label: '重新检查',
    });
  });

  it('adds a log-first repair path for the latest failed start', () => {
    const finding = createAuditFinding({
      severity: 'warn',
      code: 'last_start_failed',
      summary: '最近一次启动失败',
    });

    expect(finding.impact).toContain('最近一次启动失败');
    expect(finding.fix).toMatchObject({
      kind: 'open_logs',
      label: '查看最近失败日志',
    });
    expect(finding.verify).toMatchObject({
      kind: 'check_status',
      label: '重新检查启动结果',
    });
  });
});

describe('sortAuditFindings', () => {
  it('orders findings by severity before summary', () => {
    const findings = sortAuditFindings([
      createAuditFinding({ severity: 'info', code: 'healthy', summary: '健康' }),
      createAuditFinding({ severity: 'warn', code: 'missing_env_vars', summary: '缺变量' }),
      createAuditFinding({ severity: 'error', code: 'script_missing', summary: '缺入口' }),
      createAuditFinding({ severity: 'warn', code: 'last_start_failed', summary: '最近失败' }),
    ]);

    expect(findings.map((finding) => finding.severity)).toEqual(['error', 'warn', 'warn', 'info']);
    expect(findings[0].code).toBe('script_missing');
  });
});

describe('summarizeLogExcerpt', () => {
  it('keeps recent error-related log lines', () => {
    const excerpt = summarizeLogExcerpt([
      '[HubKit] start',
      '[app] ready',
      'Error: missing config',
      'Timeout while waiting for port',
    ].join('\n'), 2);

    expect(excerpt).toBe([
      'Error: missing config',
      'Timeout while waiting for port',
    ].join('\n'));
  });

  it('redacts common secrets from diagnostic excerpts', () => {
    const excerpt = summarizeLogExcerpt([
      'Error: request failed token=abc123',
      'Error: upstream replied Bearer very.secret.token',
      'Error: Authorization: internal-header-value',
      'Error: password=\"super-secret\"',
    ].join('\n'), 8);

    expect(excerpt).toContain('token=***');
    expect(excerpt).toContain('Bearer ***');
    expect(excerpt).toContain('Authorization=***');
    expect(excerpt).toContain('password=***');
    expect(excerpt).not.toContain('abc123');
    expect(excerpt).not.toContain('very.secret.token');
    expect(excerpt).not.toContain('internal-header-value');
    expect(excerpt).not.toContain('super-secret');
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleAuditReport, ModuleStatus } from '../../src/types/module';
import { formatAuditReports, registerAuditCommand } from '../../src/cli/commands/audit';

function createProgram(): Command {
  const program = new Command();
  program.name('hub');
  program.exitOverride();
  program.configureOutput({
    writeOut: jest.fn(),
    writeErr: jest.fn(),
  });
  return program;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

function report(overrides: Partial<ModuleAuditReport> = {}): ModuleAuditReport {
  return {
    moduleId: 'api',
    moduleName: 'API',
    groupId: 'default',
    status: ModuleStatus.STOPPED,
    runtimePhase: 'failed',
    healthy: false,
    score: 70,
    effectiveStartPolicy: {
      retryCount: 1,
      retryDelayMs: 1500,
      healthCheckEnabled: true,
      healthCheckTimeoutMs: 15000,
      preflightChecksEnabled: true,
      blockOnPortConflict: true,
    },
    inheritedTemplateId: 'balanced',
    environment: {
      runtime: 'node',
      detectedEnvFiles: [],
      requiredCommands: ['node'],
      missingCommands: [],
      requiredEnvVars: [],
      requiredEnvVarCount: 0,
      missingEnvVars: [],
      commandChecks: [],
    },
    findings: [
      {
        severity: 'error',
        code: 'health_unhealthy',
        summary: '健康检查失败',
        impact: '模块无法正常使用。',
        details: 'GET /health timeout',
        logExcerpt: 'Error: timeout',
        recommendation: '检查服务监听端口',
        fix: {
          kind: 'open_logs',
          label: '查看日志',
          description: '打开最近日志。',
        },
        verify: {
          kind: 'check_status',
          label: '重新检查',
          description: '刷新体检结果。',
        },
      },
    ],
    checkedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('audit command', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('registers audit from the CLI command index', () => {
    const source = readSource('src/cli/commands/index.ts');

    expect(source).toContain("import { registerAuditCommand } from './audit'");
    expect(source).toContain('registerAuditCommand(program, registry)');
  });

  it('formats reports with findings and repair guidance', () => {
    const output = formatAuditReports([report()]);

    expect(output).toContain('模块体检报告 (1 个模块)');
    expect(output).toContain('API (api)');
    expect(output).toContain('[error] 健康检查失败');
    expect(output).toContain('最近相关日志');
    expect(output).toContain('修复: 查看日志');
    expect(output).toContain('验证: 重新检查');
  });

  it('runs through injected scanning and report collection', async () => {
    const program = createProgram();
    const registry = new ModuleRegistry();
    const scanAndRegister = jest.fn().mockResolvedValue(undefined);
    const collectReports = jest.fn().mockResolvedValue([report()]);

    registerAuditCommand(program, registry, {
      scanAndRegister,
      collectReports,
    });

    await program.parseAsync(['node', 'hub', 'audit', 'api'], { from: 'node' });

    expect(scanAndRegister).toHaveBeenCalledWith(registry);
    expect(collectReports).toHaveBeenCalledWith(registry, 'api');
    expect(logSpy.mock.calls[0][0]).toContain('模块体检报告');
  });

  it('supports JSON output for automation users', async () => {
    const program = createProgram();

    registerAuditCommand(program, new ModuleRegistry(), {
      scanAndRegister: jest.fn().mockResolvedValue(undefined),
      collectReports: jest.fn().mockResolvedValue([report({ score: 100 })]),
    });

    await program.parseAsync(['node', 'hub', 'audit', '--json'], { from: 'node' });

    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload[0]).toMatchObject({
      moduleId: 'api',
      score: 100,
    });
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleAuditReport, ModuleMetadata, ModuleStatus } from '../../src/types/module';
import {
  collectAuditReports,
  collectModuleAuditReport,
  formatAuditReports,
  registerAuditCommand,
} from '../../src/cli/commands/audit';

jest.mock('../../src/adapters/adapter-factory', () => ({
  createModuleAdapter: jest.fn(),
}));

jest.mock('../../src/runtime/module-environment', () => ({
  inspectModuleEnvironment: jest.fn(),
  sanitizeEnvironmentReportForDisplay: jest.fn((report) => ({
    ...report,
    requiredEnvVars: [],
    requiredEnvVarCount: report.requiredEnvVars?.length ?? report.requiredEnvVarCount ?? 0,
  })),
}));

jest.mock('../../src/runtime/module-process-diagnostics', () => ({
  collectModuleProcessDiagnostics: jest.fn(),
}));

const { createModuleAdapter } = require('../../src/adapters/adapter-factory');
const { inspectModuleEnvironment } = require('../../src/runtime/module-environment');
const { collectModuleProcessDiagnostics } = require('../../src/runtime/module-process-diagnostics');

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

function moduleMetadata(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'api',
    name: 'API',
    type: 'nodejs',
    scriptPath: '/tmp/api/index.js',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('audit command', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    createModuleAdapter.mockReset();
    inspectModuleEnvironment.mockReset();
    collectModuleProcessDiagnostics.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    jest.clearAllMocks();
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

  it('exits when a requested module is missing', async () => {
    const program = createProgram();
    registerAuditCommand(program, new ModuleRegistry(), {
      scanAndRegister: jest.fn().mockResolvedValue(undefined),
      collectReports: jest.fn().mockResolvedValue([]),
    });

    await expect(program.parseAsync(['node', 'hub', 'audit', 'missing'], { from: 'node' }))
      .rejects.toThrow('process.exit');

    expect(logSpy).toHaveBeenCalledWith('模块不存在: missing');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits on fail-on-error when any report contains an error finding', async () => {
    const program = createProgram();
    registerAuditCommand(program, new ModuleRegistry(), {
      scanAndRegister: jest.fn().mockResolvedValue(undefined),
      collectReports: jest.fn().mockResolvedValue([report()]),
    });

    await expect(program.parseAsync(['node', 'hub', 'audit', '--fail-on-error'], { from: 'node' }))
      .rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('collects only requested module reports from the registry', async () => {
    const registry = new ModuleRegistry();
    registry.register(moduleMetadata({ id: 'api' }));
    registry.register(moduleMetadata({ id: 'web', name: 'Web' }));
    createModuleAdapter.mockReturnValue({
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.RUNNING, pid: 123 }),
      getRuntimeState: jest.fn(() => ({ phase: 'running', summary: 'running', health: { state: 'healthy', summary: 'ok' } })),
      probeHealth: jest.fn().mockResolvedValue({ state: 'healthy', summary: 'ok' }),
      inspectStartReadiness: jest.fn().mockResolvedValue({ ready: true, actionLabel: '启动', summary: '可直接启动' }),
      rawLogs: jest.fn().mockResolvedValue(''),
      logs: jest.fn().mockResolvedValue([]),
    });
    inspectModuleEnvironment.mockResolvedValue({
      runtime: 'node',
      detectedEnvFiles: [],
      requiredCommands: [],
      missingCommands: [],
      requiredEnvVars: [],
      requiredEnvVarCount: 0,
      missingEnvVars: [],
      commandChecks: [],
    });
    collectModuleProcessDiagnostics.mockResolvedValue({
      pidFromStatus: 123,
      pidFromPidFile: null,
      pidCandidates: [],
      port: null,
      portOccupied: false,
      portListeners: [],
      checkedAt: '2026-05-30T00:00:00.000Z',
    });

    const reports = await collectAuditReports(registry, 'api');

    expect(reports).toHaveLength(1);
    expect(reports[0].moduleId).toBe('api');
  });

  it('collects audit findings for missing files, readiness, environment, runtime failure, health, and occupied ports', async () => {
    const module = moduleMetadata({ scriptPath: '/tmp/missing-api/index.js' });
    createModuleAdapter.mockReturnValue({
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.STOPPED }),
      getRuntimeState: jest.fn(() => ({
        phase: 'failed',
        summary: 'failed',
        failure: {
          code: 'health_check_failed',
          source: 'health',
          summary: '健康检查未通过',
          details: 'timeout',
          retryable: true,
          occurredAt: '2026-05-30T00:00:00.000Z',
        },
        health: { state: 'unhealthy', summary: 'bad' },
      })),
      probeHealth: jest.fn().mockResolvedValue({ state: 'unhealthy', summary: '健康检查异常', details: 'HTTP 500' }),
      inspectStartReadiness: jest.fn().mockResolvedValue({
        ready: false,
        actionLabel: '安装依赖并启动',
        summary: '检测到缺少 Node.js 依赖',
        installCommand: 'npm ci',
      }),
      rawLogs: jest.fn().mockResolvedValue('Error: timeout\nline 2\nline 3'),
      logs: jest.fn().mockResolvedValue([]),
    });
    inspectModuleEnvironment.mockResolvedValue({
      runtime: 'node',
      detectedEnvFiles: ['.env.example'],
      requiredCommands: ['node', 'npm'],
      missingCommands: ['npm'],
      requiredEnvVars: ['API_KEY'],
      requiredEnvVarCount: 1,
      missingEnvVars: ['API_KEY'],
      commandChecks: [
        { command: 'node', installed: true },
        { command: 'npm', installed: false, requirement: '>=10' },
      ],
    });
    collectModuleProcessDiagnostics.mockResolvedValue({
      pidFromStatus: null,
      pidFromPidFile: null,
      pidCandidates: [],
      port: 3000,
      portOccupied: true,
      portListeners: [{ pid: 777, command: 'node other.js', alive: true }],
      checkedAt: '2026-05-30T00:00:00.000Z',
    });

    const auditReport = await collectModuleAuditReport(module, {
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: {},
      startPolicies: {},
      groupStartPolicyTemplates: {},
      workspaces: [],
      workspaceHistory: [],
      workspaceHistoryLimit: 20,
    });

    expect(auditReport.healthy).toBe(false);
    expect(auditReport.score).toBe(0);
    expect(auditReport.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'module_dir_missing',
      'script_missing',
      'start_not_ready',
      'missing_runtime_commands',
      'missing_env_vars',
      'health_check_failed',
      'health_unhealthy',
      'port_occupied_while_stopped',
    ]));
    expect(auditReport.findings.find((finding) => finding.code === 'health_check_failed')?.logExcerpt).toContain('Error: timeout');
  });
});

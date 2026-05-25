import { Command } from 'commander';
import { promises as fs, statSync } from 'fs';
import { dirname } from 'path';
import { createModuleAdapter } from '../../adapters/adapter-factory';
import { config, ModuleSettings } from '../../config/config';
import { createAuditFinding, sortAuditFindings, summarizeLogExcerpt } from '../../health/module-audit';
import { ModuleRegistry } from '../../registry/module-registry';
import { inspectModuleEnvironment, sanitizeEnvironmentReportForDisplay } from '../../runtime/module-environment';
import { collectModuleProcessDiagnostics } from '../../runtime/module-process-diagnostics';
import { getModuleInheritedTemplateId, getModuleStartPolicy } from '../../runtime/module-start-policy';
import {
  ModuleAuditFinding,
  ModuleAuditReport,
  ModuleMetadata,
  ModuleProtocol,
  ModuleStatus,
} from '../../types/module';
import { scanAndRegisterModules } from './module-loader';

export interface AuditCommandOptions {
  json?: boolean;
  failOnError?: boolean;
}

export interface AuditCommandDependencies {
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
  collectReports?: (registry: ModuleRegistry, moduleId?: string) => Promise<ModuleAuditReport[]>;
}

/**
 * audit 命令 - 体检模块运行状态。
 */
export function registerAuditCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: AuditCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const collectReports = dependencies.collectReports || collectAuditReports;

  program
    .command('audit [moduleId]')
    .description('体检模块运行状态')
    .option('--json', '输出 JSON')
    .option('--fail-on-error', '发现 error 级别问题时返回非零退出码')
    .action(async (moduleId: string | undefined, options: AuditCommandOptions) => {
      try {
        await scanAndRegister(registry);
        const reports = await collectReports(registry, moduleId);

        if (reports.length === 0) {
          console.log(moduleId ? `模块不存在: ${moduleId}` : '未找到模块');
          if (moduleId) process.exit(1);
          return;
        }

        console.log(options.json ? JSON.stringify(reports, null, 2) : formatAuditReports(reports));

        if (options.failOnError && reports.some(hasErrorFinding)) {
          process.exit(1);
        }
      } catch (error) {
        console.error('模块体检失败:', error);
        process.exit(1);
      }
    });
}

export async function collectAuditReports(
  registry: ModuleRegistry,
  moduleId?: string,
): Promise<ModuleAuditReport[]> {
  const modules = moduleId
    ? [registry.get(moduleId)].filter((module): module is ModuleMetadata => Boolean(module))
    : registry.list();

  const settings = config.getSettings();
  return Promise.all(modules.map((module) => collectModuleAuditReport(module, settings)));
}

export async function collectModuleAuditReport(
  module: ModuleMetadata,
  settings: ModuleSettings = config.getSettings(),
): Promise<ModuleAuditReport> {
  const adapter = createModuleAdapter(module);
  const status = await adapter.status();
  const runtimeState = adapter.getRuntimeState();
  const health = await adapter.probeHealth();
  const startReadiness = await adapter.inspectStartReadiness();
  const diagnostics = await collectModuleProcessDiagnostics(module, status.pid ?? null);
  const environment = await inspectModuleEnvironment(module);
  const findings: ModuleAuditFinding[] = [];
  let recentLogExcerpt: Promise<string | undefined> | null = null;
  const getRecentLogExcerpt = () => {
    recentLogExcerpt = recentLogExcerpt || collectModuleLogExcerpt(adapter);
    return recentLogExcerpt;
  };

  const groupId = settings.moduleGroups[module.id] || 'default';
  const effectiveStartPolicy = getModuleStartPolicy(settings, module.id, groupId);
  const inheritedTemplateId = getModuleInheritedTemplateId(settings, groupId);
  const moduleDir = getModuleDir(module.scriptPath);
  const scriptExists = await pathExists(module.scriptPath);
  const moduleDirExists = await pathExists(moduleDir);

  if (!moduleDirExists) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'module_dir_missing',
      summary: '模块目录不存在',
      details: moduleDir,
      recommendation: '检查 scriptPath 或重新同步模块目录',
    }));
  }

  if (!scriptExists) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'script_missing',
      summary: '入口脚本不存在',
      details: module.scriptPath,
      recommendation: '检查模块入口路径是否失效',
    }));
  }

  if (!startReadiness.ready) {
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'start_not_ready',
      summary: startReadiness.summary,
      details: startReadiness.details || startReadiness.installCommand,
      recommendation: startReadiness.installCommand ? '先处理依赖或端口冲突，再尝试启动' : '先处理阻塞条件',
    }));
  }

  if (environment.missingCommands.length > 0) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'missing_runtime_commands',
      summary: `缺少命令：${environment.missingCommands.join('、')}`,
      details: environment.commandChecks
        .filter((item) => !item.installed)
        .map((item) => item.requirement ? `${item.command}（要求 ${item.requirement}）` : item.command)
        .join('；'),
      recommendation: '先补齐运行时或包管理器，再重试启动',
    }));
  }

  if (environment.missingEnvVars.length > 0) {
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'missing_env_vars',
      summary: `缺少环境变量：${environment.missingEnvVars.join('、')}`,
      details: environment.detectedEnvFiles.length > 0 ? `来源：${environment.detectedEnvFiles.join('、')}` : undefined,
      recommendation: '补齐环境变量后再启动相关模块',
    }));
  }

  if (runtimeState.phase === 'failed' && runtimeState.failure) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: runtimeState.failure.code,
      summary: runtimeState.failure.summary,
      details: runtimeState.failure.details,
      logExcerpt: await getRecentLogExcerpt(),
      recommendation: runtimeState.failure.source === 'health' ? '检查 Web 服务是否成功监听' : '打开日志查看失败细节',
    }));
  }

  if (runtimeState.lastStartRecord?.outcome === 'failed' && runtimeState.phase !== 'failed') {
    const record = runtimeState.lastStartRecord;
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'last_start_failed',
      summary: `最近一次启动失败：${record.failure?.summary || record.summary}`,
      details: record.failure?.details || record.details,
      logExcerpt: await getRecentLogExcerpt(),
      recommendation: '查看最近失败日志，确认本次运行是否仍受影响',
    }));
  }

  if (health.state === 'unhealthy') {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'health_unhealthy',
      summary: health.summary,
      details: health.details,
      logExcerpt: await getRecentLogExcerpt(),
      recommendation: '检查服务监听端口与最近启动日志',
    }));
  }

  if (diagnostics.portOccupied && status.status !== ModuleStatus.RUNNING) {
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'port_occupied_while_stopped',
      summary: `端口 ${diagnostics.port} 已被占用`,
      details: diagnostics.portListeners.map((item) => `${item.command}（PID ${item.pid}）`).join('；'),
      recommendation: '考虑执行强制关闭，清理残留监听进程',
    }));
  }

  if (!module.webUrl && !module.webPort && effectiveStartPolicy.healthCheckEnabled) {
    findings.push(createAuditFinding({
      severity: 'info',
      code: 'health_without_target',
      summary: '已启用健康检查，但模块未配置 Web 地址或端口',
      recommendation: '如果这是后台脚本，可切换到“脚本任务”模板',
    }));
  }

  if (findings.length === 0) {
    findings.push(createAuditFinding({
      severity: 'info',
      code: 'healthy',
      summary: '未发现明显异常',
      recommendation: '当前模块状态稳定',
    }));
  }

  const sortedFindings = sortAuditFindings(findings);
  const score = Math.max(
    0,
    100
      - sortedFindings.filter((item) => item.severity === 'error').length * 30
      - sortedFindings.filter((item) => item.severity === 'warn').length * 12
  );

  return {
    moduleId: module.id,
    moduleName: module.name,
    groupId,
    status: status.status,
    runtimePhase: runtimeState.phase,
    healthy: health.state === 'healthy' || (health.state === 'unknown' && sortedFindings.every((item) => item.severity !== 'error')),
    score,
    effectiveStartPolicy,
    inheritedTemplateId,
    environment: sanitizeEnvironmentReportForDisplay(environment),
    findings: sortedFindings,
    checkedAt: new Date().toISOString(),
  };
}

export function formatAuditReports(reports: ModuleAuditReport[]): string {
  if (reports.length === 0) {
    return '未找到模块';
  }

  const lines = [`\n模块体检报告 (${reports.length} 个模块)\n`];
  reports.forEach((report) => {
    lines.push(`${report.moduleName} (${report.moduleId})`);
    lines.push(`  状态: ${report.status} / ${report.runtimePhase}`);
    lines.push(`  健康: ${report.healthy ? '是' : '否'}，评分: ${report.score}`);
    lines.push(`  检查时间: ${report.checkedAt}`);
    report.findings.forEach((finding) => {
      lines.push(`  - [${finding.severity}] ${finding.summary}`);
      lines.push(`    影响: ${finding.impact}`);
      if (finding.details) lines.push(`    详情: ${finding.details}`);
      if (finding.recommendation) lines.push(`    建议: ${finding.recommendation}`);
      if (finding.logExcerpt) {
        lines.push('    最近相关日志:');
        finding.logExcerpt.split('\n').forEach((line) => lines.push(`      ${line}`));
      }
      lines.push(`    修复: ${finding.fix.label} - ${finding.fix.description}`);
      lines.push(`    验证: ${finding.verify.label} - ${finding.verify.description}`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

function hasErrorFinding(report: ModuleAuditReport): boolean {
  return report.findings.some((finding) => finding.severity === 'error');
}

function getModuleDir(scriptPath: string): string {
  try {
    return statSync(scriptPath).isDirectory() ? scriptPath : dirname(scriptPath);
  } catch {
    return dirname(scriptPath);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function collectModuleLogExcerpt(adapter: ModuleProtocol): Promise<string | undefined> {
  try {
    const rawLogs = typeof (adapter as any).rawLogs === 'function'
      ? await (adapter as any).rawLogs(80)
      : (await adapter.logs(80)).map((entry) => entry.message).join('\n');
    return summarizeLogExcerpt(rawLogs, 8);
  } catch {
    return undefined;
  }
}

import { ModuleAuditAction, ModuleAuditFinding, ModuleAuditSeverity } from '../types/module';

const LOG_INTERESTING_PATTERN = /(error|failed|failure|exception|traceback|unhealthy|timeout|timed out|eaddrinuse|command not found|not found|permission denied|失败|异常|错误|拒绝|超时|未找到|找不到)/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export interface CreateAuditFindingInput {
  severity: ModuleAuditSeverity;
  code: string;
  summary: string;
  details?: string;
  logExcerpt?: string;
  recommendation?: string;
  impact?: string;
  fix?: Partial<ModuleAuditAction>;
  verify?: Partial<ModuleAuditAction>;
}

const IMPACT_BY_CODE: Record<string, string> = {
  module_dir_missing: 'HubKit 无法定位模块目录，模块不会被可靠启动或诊断。',
  script_missing: '模块入口不存在，启动动作一定会失败。',
  start_not_ready: '模块当前不满足启动条件，直接启动可能失败或卡在准备阶段。',
  missing_runtime_commands: '模块依赖的运行时或包管理器缺失，启动前准备无法完成。',
  missing_env_vars: '模块可能缺少必要配置，启动后可能失败或行为异常。',
  process_exited: '模块进程已经退出，当前状态和用户预期不一致。',
  last_start_failed: '模块最近一次启动失败，后续启动可能重复遇到同一问题。',
  health_unhealthy: '模块进程或 Web 服务未达到健康状态，可能无法正常使用。',
  port_occupied_while_stopped: '模块显示已停止但端口仍被占用，后续启动可能冲突。',
  health_without_target: '健康检查没有明确目标，可能产生误报或无法验证启动成功。',
  healthy: '当前模块未发现阻塞性问题。',
};

const FIX_BY_CODE: Record<string, ModuleAuditAction> = {
  module_dir_missing: manual('修正模块路径', '检查 .hubkit.json 或 moduleDirs，确保模块目录仍然存在。'),
  script_missing: manual('修正入口脚本', '检查 scriptPath，或重新运行 init-module 生成正确入口。'),
  start_not_ready: manual('处理启动阻塞', '根据预检详情补齐依赖、释放端口或修正启动配置。'),
  missing_runtime_commands: manual('安装缺失命令', '先安装缺失的运行时或包管理器，再重新启动模块。'),
  missing_env_vars: manual('补齐环境变量', '参考 .env.example 等模板补齐缺失变量。'),
  process_exited: { kind: 'open_logs', label: '查看失败日志', description: '打开最近日志，定位进程退出原因。' },
  last_start_failed: { kind: 'open_logs', label: '查看最近失败日志', description: '打开模块日志，对照最近一次启动失败原因。' },
  health_unhealthy: { kind: 'open_logs', label: '查看健康检查日志', description: '检查服务监听端口和最近启动输出。' },
  port_occupied_while_stopped: { kind: 'force_close', label: '强制清理端口', description: '清理残留监听进程后再次检查。' },
  health_without_target: { kind: 'open_settings', label: '调整启动策略', description: '为 Web 模块配置入口，或切换到脚本任务策略。' },
  healthy: { kind: 'check_status', label: '重新检查', description: '再次刷新模块状态和体检结果。' },
};

const VERIFY_BY_CODE: Record<string, ModuleAuditAction> = {
  module_dir_missing: { kind: 'check_status', label: '重新扫描模块', description: '重新加载模块列表，确认目录问题已消失。' },
  script_missing: { kind: 'check_status', label: '重新检查入口', description: '重新体检，确认入口脚本可以访问。' },
  start_not_ready: { kind: 'check_status', label: '重新执行预检', description: '刷新模块状态，确认启动前检查已通过。' },
  missing_runtime_commands: { kind: 'check_status', label: '重新检查运行时', description: '刷新体检结果，确认缺失命令已安装。' },
  missing_env_vars: { kind: 'check_status', label: '重新检查环境', description: '刷新体检结果，确认缺失环境变量已补齐。' },
  process_exited: { kind: 'check_status', label: '重新检查进程', description: '确认模块进程状态恢复正常。' },
  last_start_failed: { kind: 'check_status', label: '重新检查启动结果', description: '重新启动或刷新体检，确认最近失败不再复现。' },
  health_unhealthy: { kind: 'check_status', label: '重新检查健康状态', description: '确认健康检查恢复稳定。' },
  port_occupied_while_stopped: { kind: 'check_status', label: '重新检查端口', description: '确认端口不再被残留进程占用。' },
  health_without_target: { kind: 'check_status', label: '重新检查策略', description: '确认健康检查策略和模块类型匹配。' },
  healthy: { kind: 'check_status', label: '重新检查', description: '保持当前体检结果最新。' },
};

export function createAuditFinding(input: CreateAuditFindingInput): ModuleAuditFinding {
  return {
    severity: input.severity,
    code: input.code,
    summary: input.summary,
    impact: input.impact || IMPACT_BY_CODE[input.code] || '该问题可能影响模块稳定性。',
    details: input.details,
    logExcerpt: input.logExcerpt,
    recommendation: input.recommendation,
    fix: normalizeAction(input.fix, FIX_BY_CODE[input.code] || manual('手动处理', input.recommendation || '根据详情手动处理该问题。')),
    verify: normalizeAction(input.verify, VERIFY_BY_CODE[input.code] || {
      kind: 'check_status',
      label: '重新检查',
      description: '刷新体检结果，确认问题是否已解决。',
    }),
  };
}

export function sortAuditFindings(findings: ModuleAuditFinding[]): ModuleAuditFinding[] {
  return [...findings].sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return a.summary.localeCompare(b.summary, 'zh-CN');
  });
}

export function summarizeLogExcerpt(rawLog: string, maxLines: number = 8): string | undefined {
  const lines = String(rawLog || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  if (lines.length === 0) return undefined;

  const interestingLines = lines.filter((line) => LOG_INTERESTING_PATTERN.test(line));
  const selected = (interestingLines.length > 0 ? interestingLines : lines)
    .slice(-normalizeExcerptLineCount(maxLines))
    .map(redactLogLine);

  return selected.length > 0 ? selected.join('\n') : undefined;
}

function severityRank(severity: ModuleAuditSeverity): number {
  if (severity === 'error') return 3;
  if (severity === 'warn') return 2;
  return 1;
}

function normalizeExcerptLineCount(maxLines: number): number {
  if (!Number.isFinite(maxLines)) return 8;
  return Math.max(1, Math.min(20, Math.floor(maxLines)));
}

function redactLogLine(line: string): string {
  return line
    .replace(BEARER_TOKEN_PATTERN, 'Bearer ***')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key) => `${key}=***`);
}

function normalizeAction(input: Partial<ModuleAuditAction> | undefined, fallback: ModuleAuditAction): ModuleAuditAction {
  return {
    kind: input?.kind || fallback.kind,
    label: input?.label || fallback.label,
    description: input?.description || fallback.description,
  };
}

function manual(label: string, description: string): ModuleAuditAction {
  return { kind: 'manual', label, description };
}

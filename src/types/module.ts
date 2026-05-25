/**
 * 模块协议接口定义
 *
 * 所有模块适配器必须实现此接口，提供统一的管理能力
 */

/**
 * 模块状态
 */
export enum ModuleStatus {
  /** 未启动 */
  STOPPED = 'stopped',
  /** 运行中 */
  RUNNING = 'running',
  /** 启动中 */
  STARTING = 'starting',
  /** 停止中 */
  STOPPING = 'stopping',
  /** 错误状态 */
  ERROR = 'error',
  /** 未知状态 */
  UNKNOWN = 'unknown'
}

/**
 * 模块状态信息
 */
export interface ModuleStatusInfo {
  /** 当前状态 */
  status: ModuleStatus;
  /** 进程 ID（如果运行中） */
  pid?: number;
  /** 启动时间 */
  startedAt?: Date;
  /** 运行时长（秒） */
  uptime?: number;
  /** 内存占用（MB） */
  memory?: number;
  /** CPU 占用（%） */
  cpu?: number;
  /** 错误信息（如果有） */
  error?: string;
}

export type ModuleStartPhase =
  | 'idle'
  | 'preparing'
  | 'installing'
  | 'starting'
  | 'health_checking'
  | 'running'
  | 'stopped'
  | 'failed';

export type ModuleHealthState = 'unknown' | 'checking' | 'healthy' | 'unhealthy';

export type ModuleFailureSource = 'preflight' | 'dependency' | 'process' | 'health' | 'system';

export interface ModuleStartFailure {
  code: string;
  source: ModuleFailureSource;
  summary: string;
  details?: string;
  retryable: boolean;
  occurredAt: string;
}

export interface ModuleHealthReport {
  state: ModuleHealthState;
  summary: string;
  details?: string;
  checkedAt?: string;
}

/**
 * 启动前准备检查结果
 */
export interface ModuleStartReadiness {
  /** 是否可以直接启动 */
  ready: boolean;
  /** 当前启动动作标签 */
  actionLabel: string;
  /** 短说明 */
  summary: string;
  /** 详情说明 */
  details?: string;
  /** 预计执行的依赖安装命令 */
  installCommand?: string;
}

/**
 * 实际启动时执行过的准备动作
 */
export interface ModuleStartPreparation {
  dependencyInstalled: boolean;
  installCommand?: string;
  summary: string;
}

export interface ModuleStartRecord {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome: 'succeeded' | 'failed';
  attemptCount: number;
  summary: string;
  details?: string;
  command?: string;
  preparation?: ModuleStartPreparation | null;
  failure?: ModuleStartFailure;
  health?: ModuleHealthReport;
}

export interface ModuleRuntimeState {
  phase: ModuleStartPhase;
  summary: string;
  details?: string;
  attempt: number;
  maxAttempts: number;
  lastTransitionAt: string;
  lastStartedAt?: string;
  lastPreparation?: ModuleStartPreparation | null;
  failure?: ModuleStartFailure;
  health: ModuleHealthReport;
  lastStartRecord?: ModuleStartRecord | null;
}

export interface ModuleStartPolicy {
  retryCount: number;
  retryDelayMs: number;
  healthCheckEnabled: boolean;
  healthCheckTimeoutMs: number;
  preflightChecksEnabled: boolean;
  blockOnPortConflict: boolean;
}

export interface StartPolicyTemplate {
  id: string;
  name: string;
  description: string;
  policy: ModuleStartPolicy;
}

export type ModuleAuditSeverity = 'info' | 'warn' | 'error';
export type ModuleAuditActionKind =
  | 'manual'
  | 'check_status'
  | 'open_logs'
  | 'force_close'
  | 'open_settings'
  | 'open_url';

export interface ModuleAuditAction {
  kind: ModuleAuditActionKind;
  label: string;
  description: string;
}

export interface ModuleAuditFinding {
  severity: ModuleAuditSeverity;
  code: string;
  summary: string;
  impact: string;
  details?: string;
  logExcerpt?: string;
  recommendation?: string;
  fix: ModuleAuditAction;
  verify: ModuleAuditAction;
}

export interface ModuleAuditReport {
  moduleId: string;
  moduleName: string;
  groupId: string;
  status: ModuleStatus;
  runtimePhase: ModuleStartPhase;
  healthy: boolean;
  score: number;
  effectiveStartPolicy: ModuleStartPolicy;
  inheritedTemplateId?: string;
  environment: ModuleEnvironmentReport;
  findings: ModuleAuditFinding[];
  checkedAt: string;
}

export interface ModuleEnvironmentCommandCheck {
  command: string;
  installed: boolean;
  version?: string;
  requirement?: string;
}

export interface ModuleEnvironmentReport {
  runtime: string;
  packageManager?: string;
  engineRequirement?: string;
  detectedEnvFiles: string[];
  requiredCommands: string[];
  missingCommands: string[];
  /** 内部检查使用；对 Web/API 输出时应清空，避免暴露完整环境变量清单。 */
  requiredEnvVars: string[];
  /** 环境模板中声明的变量总数，安全输出可保留计数。 */
  requiredEnvVarCount?: number;
  missingEnvVars: string[];
  commandChecks: ModuleEnvironmentCommandCheck[];
}

/**
 * 模块配置项
 */
export interface ModuleSetting {
  /** 配置键 */
  key: string;
  /** 配置值 */
  value: string | number | boolean;
  /** 配置描述 */
  description?: string;
  /** 是否必需 */
  required?: boolean;
}

/**
 * 日志条目
 */
export interface LogEntry {
  /** 时间戳 */
  timestamp: Date;
  /** 日志级别 */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** 日志内容 */
  message: string;
}

/**
 * 模块协议接口
 *
 * 所有脚本适配器必须实现此接口
 */
export interface ModuleProtocol {
  /**
   * 获取模块状态
   * @returns 模块状态信息
   */
  status(): Promise<ModuleStatusInfo>;

  /**
   * 启动模块
   * @returns 是否启动成功
   */
  start(): Promise<boolean>;

  /**
   * 获取启动前检查结果
   */
  inspectStartReadiness(): Promise<ModuleStartReadiness>;

  /**
   * 获取最近一次启动前准备动作
   */
  getLastStartPreparation(): ModuleStartPreparation | null;

  /**
   * 获取运行时状态
   */
  getRuntimeState(): ModuleRuntimeState;

  /**
   * 执行一次健康探测
   */
  probeHealth(): Promise<ModuleHealthReport>;

  /**
   * 停止模块
   * @param force 是否强制停止（SIGKILL）
   * @returns 是否停止成功
   */
  stop(force?: boolean): Promise<boolean>;

  /**
   * 获取模块日志
   * @param lines 获取最近 N 行日志，默认 100
   * @returns 日志条目数组
   */
  logs(lines?: number): Promise<LogEntry[]>;

  /**
   * 获取模块配置
   * @returns 配置项数组
   */
  getSettings(): Promise<ModuleSetting[]>;

  /**
   * 更新模块配置
   * @param key 配置键
   * @param value 配置值
   * @returns 是否更新成功
   */
  setSetting(key: string, value: string | number | boolean): Promise<boolean>;
}

/**
 * 模块元数据
 */
export interface ModuleMetadata {
  /** 模块 ID */
  id: string;
  /** 模块名称 */
  name: string;
  /** 模块描述 */
  description?: string;
  /** 脚本类型 */
  type: 'nodejs' | 'python' | 'shell';
  /** 脚本路径 */
  scriptPath: string;
  /** npm 脚本名称（覆盖 package.json 中的 start） */
  startScript?: string;
  /** Web UI 访问地址 */
  webUrl?: string;
  /** Web UI 端口（用于自动推断 webUrl） */
  webPort?: number;
  /** 是否支持在线更新（git pull） */
  updateable?: boolean;
  /** 源码仓库地址 */
  repoUrl?: string;
  /** 是否开机自启 */
  autoStart: boolean;
  /** 是否已启用 */
  enabled: boolean;
}

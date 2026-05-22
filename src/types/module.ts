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

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 定时任务规则
 */
export interface ModuleSchedule {
  /** 是否启用定时任务 */
  enabled: boolean;
  /** 定时启动时间 HH:MM（24h 制），空字符串表示不定时启动 */
  startTime?: string;
  /** 定时停止时间 HH:MM（24h 制），空字符串表示不定时停止 */
  stopTime?: string;
  /** 仅在指定星期生效（0=周日, 1=周一 ... 6=周六）。空数组或 undefined 表示每天 */
  daysOfWeek?: number[];
}

/**
 * 模块运行设置
 */
export interface ModuleSettings {
  /** moduleId -> 是否启用自动启动 */
  autoStart: Record<string, boolean>;
  /** 模块启动顺序 (moduleId 列表) */
  startOrder: string[];
  /** moduleId -> 自定义 Web UI 地址（覆盖 .hubkit.json 中的 webUrl） */
  moduleWebUrls: Record<string, string>;
  /** moduleId -> 是否在 Dashboard 中显示卡片，默认 true */
  visibility: Record<string, boolean>;
  /** moduleId -> 定时任务规则 */
  schedules: Record<string, ModuleSchedule>;
}

/**
 * HubKit 配置
 */
export interface HubKitConfig {
  /** 模块目录列表 */
  moduleDirs: string[];
  /** 数据目录 */
  dataDir: string;
  /** 日志目录 */
  logDir: string;
  /** 模块运行设置 */
  settings: ModuleSettings;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: HubKitConfig = {
  moduleDirs: [
    path.join(os.homedir(), '.hubkit', 'modules'),
  ],
  dataDir: path.join(os.homedir(), '.hubkit', 'data'),
  logDir: path.join(os.homedir(), '.hubkit', 'logs'),
  settings: {
    autoStart: {},
    startOrder: [],
    moduleWebUrls: {},
    visibility: {},
    schedules: {},
  },
};

/**
 * 配置文件路径
 */
const CONFIG_PATH = path.join(os.homedir(), '.hubkit', 'config.json');

/**
 * 配置管理器
 */
export class ConfigManager {
  private config: HubKitConfig;

  constructor() {
    this.config = this.load();
  }

  /**
   * 加载配置
   */
  private load(): HubKitConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const loaded = JSON.parse(content);
        return {
          ...DEFAULT_CONFIG,
          ...loaded,
          settings: {
            ...DEFAULT_CONFIG.settings,
            ...(loaded.settings || {}),
            moduleWebUrls: loaded.settings?.moduleWebUrls ?? {},
            visibility: loaded.settings?.visibility ?? {},
            schedules: loaded.settings?.schedules ?? {},
          },
        };
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /**
   * 保存配置
   */
  save(): void {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  /**
   * 获取配置
   */
  get(): HubKitConfig {
    return { ...this.config };
  }

  /**
   * 获取模块目录列表
   */
  getModuleDirs(): string[] {
    return [...this.config.moduleDirs];
  }

  /**
   * 添加模块目录
   */
  addModuleDir(dir: string): void {
    if (!this.config.moduleDirs.includes(dir)) {
      this.config.moduleDirs.push(dir);
      this.save();
    }
  }

  /**
   * 移除模块目录
   */
  removeModuleDir(dir: string): void {
    const index = this.config.moduleDirs.indexOf(dir);
    if (index !== -1) {
      this.config.moduleDirs.splice(index, 1);
      this.save();
    }
  }

  /**
   * 获取数据目录
   */
  getDataDir(): string {
    return this.config.dataDir;
  }

  /**
   * 获取日志目录
   */
  getLogDir(): string {
    return this.config.logDir;
  }

  /**
   * 获取模块运行设置
   */
  getSettings(): ModuleSettings {
    return {
      autoStart: { ...this.config.settings.autoStart },
      startOrder: [...this.config.settings.startOrder],
      moduleWebUrls: { ...this.config.settings.moduleWebUrls },
      visibility: { ...this.config.settings.visibility },
      schedules: JSON.parse(JSON.stringify(this.config.settings.schedules)),
    };
  }

  /**
   * 更新模块运行设置
   */
  updateSettings(settings: Partial<ModuleSettings>): void {
    this.config.settings = {
      autoStart: settings.autoStart ?? this.config.settings.autoStart,
      startOrder: settings.startOrder ?? this.config.settings.startOrder,
      moduleWebUrls: settings.moduleWebUrls ?? this.config.settings.moduleWebUrls,
      visibility: settings.visibility ?? this.config.settings.visibility,
      schedules: settings.schedules ?? this.config.settings.schedules,
    };
    this.save();
  }

  /**
   * 获取模块的 Web UI 地址（用户配置优先）
   */
  getModuleWebUrl(moduleId: string, defaultUrl?: string): string | undefined {
    return this.config.settings.moduleWebUrls[moduleId] ?? defaultUrl;
  }

  /**
   * 设置模块的 Web UI 地址
   */
  setModuleWebUrl(moduleId: string, url: string): void {
    this.config.settings.moduleWebUrls[moduleId] = url;
    this.save();
  }

  /**
   * 确保必要的目录存在
   */
  ensureDirs(): void {
    const dirs = [
      ...this.config.moduleDirs,
      this.config.dataDir,
      this.config.logDir,
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}

/**
 * 全局配置实例
 */
export const config = new ConfigManager();

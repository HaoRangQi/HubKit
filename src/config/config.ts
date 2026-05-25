import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ModuleStartPolicy } from '../types/module';

export const CURRENT_CONFIG_VERSION = 1;

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

export type WorkspaceFailurePolicy = 'stop' | 'continue';
export type WorkspaceHistoryAction = 'start' | 'stop';

/**
 * 工作区运行历史记录
 */
export interface WorkspaceHistoryEntry {
  /** 工作区 ID */
  workspaceId: string;
  /** 执行动作 */
  action: WorkspaceHistoryAction;
  /** 本次运行是否完全成功 */
  success: boolean;
  /** 开始时间 ISO 字符串 */
  startedAt: string;
  /** 结束时间 ISO 字符串 */
  finishedAt: string;
  /** 失败摘要，成功时省略 */
  failureSummary?: string;
}

/**
 * 场景级工作区配置
 */
export interface ModuleWorkspace {
  /** 工作区 ID */
  id: string;
  /** 工作区名称 */
  name: string;
  /** 工作区说明 */
  description?: string;
  /** 工作区包含的模块 */
  moduleIds: string[];
  /** 启动顺序，未列出的模块按 moduleIds 顺序追加 */
  startOrder?: string[];
  /** 停止顺序，未配置时按启动顺序反向停止 */
  stopOrder?: string[];
  /** 单个模块失败后的处理策略 */
  failurePolicy?: WorkspaceFailurePolicy;
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
  /** 分组列表 */
  groups: Array<{ id: string; name: string }>;
  /** moduleId -> groupId */
  moduleGroups: Record<string, string>;
  /** moduleId -> 启动策略 */
  startPolicies: Record<string, ModuleStartPolicy>;
  /** groupId -> 启动策略模板 */
  groupStartPolicyTemplates: Record<string, string>;
  /** 场景级工作区 */
  workspaces: ModuleWorkspace[];
  /** 最近工作区运行历史，最新记录在前 */
  workspaceHistory: WorkspaceHistoryEntry[];
  /** 工作区运行历史保留数量 */
  workspaceHistoryLimit: number;
}

/**
 * HubKit 配置
 */
export interface HubKitConfig {
  /** 配置 schema 版本，用于后续迁移 */
  configVersion: number;
  /** 模块目录列表 */
  moduleDirs: string[];
  /** 数据目录 */
  dataDir: string;
  /** 日志目录 */
  logDir: string;
  /** 模块运行设置 */
  settings: ModuleSettings;
}

export interface ConfigBackupSummary {
  id: string;
  createdAt: string;
  sizeBytes: number;
  moduleDirCount: number;
  groupCount: number;
  autoStartCount: number;
  scheduleCount: number;
}

export interface ConfigRestorePreview {
  backup: ConfigBackupSummary;
  changedAreas: string[];
  moduleDirs: {
    added: string[];
    removed: string[];
  };
  groups: {
    added: Array<{ id: string; name: string }>;
    removed: Array<{ id: string; name: string }>;
    renamed: Array<{ id: string; from: string; to: string }>;
  };
  autoStart: {
    enabled: string[];
    disabled: string[];
  };
  schedules: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  startOrderChanged: boolean;
  moduleGroupChanges: string[];
  startPolicyChanges: string[];
  webUrlChanges: string[];
  visibilityChanges: string[];
  workspaceChanges: string[];
  totals: {
    added: number;
    removed: number;
    changed: number;
  };
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: HubKitConfig = {
  configVersion: CURRENT_CONFIG_VERSION,
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
    groups: [
      { id: 'default', name: '默认分组' },
    ],
    moduleGroups: {},
    startPolicies: {},
    groupStartPolicyTemplates: {},
    workspaces: [],
    workspaceHistory: [],
    workspaceHistoryLimit: 20,
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
  private configPath: string;

  constructor(configPath: string = CONFIG_PATH) {
    this.configPath = configPath;
    this.config = this.load();
  }

  /**
   * 加载配置
   */
  private load(): HubKitConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(content);
        return this.normalizeConfig({
          ...DEFAULT_CONFIG,
          ...loaded,
          configVersion: typeof loaded.configVersion === 'number' ? loaded.configVersion : 0,
        });
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  private normalizeConfig(input: HubKitConfig): HubKitConfig {
    const settings = input.settings || DEFAULT_CONFIG.settings;
    const workspaceHistoryLimit = this.normalizeWorkspaceHistoryLimit(settings.workspaceHistoryLimit);
    return {
      ...DEFAULT_CONFIG,
      ...input,
      configVersion: CURRENT_CONFIG_VERSION,
      moduleDirs: Array.isArray(input.moduleDirs) ? input.moduleDirs : DEFAULT_CONFIG.moduleDirs,
      dataDir: typeof input.dataDir === 'string' ? input.dataDir : DEFAULT_CONFIG.dataDir,
      logDir: typeof input.logDir === 'string' ? input.logDir : DEFAULT_CONFIG.logDir,
      settings: {
        ...DEFAULT_CONFIG.settings,
        ...settings,
        autoStart: this.cloneRecord(settings.autoStart),
        startOrder: Array.isArray(settings.startOrder) ? [...settings.startOrder] : [],
        moduleWebUrls: this.cloneRecord(settings.moduleWebUrls),
        visibility: this.cloneRecord(settings.visibility),
        schedules: this.cloneJson(settings.schedules),
        groups: Array.isArray(settings.groups) && settings.groups.length > 0
          ? this.cloneJson(settings.groups)
          : this.cloneJson(DEFAULT_CONFIG.settings.groups),
        moduleGroups: this.cloneRecord(settings.moduleGroups),
        startPolicies: this.cloneJson(settings.startPolicies),
        groupStartPolicyTemplates: this.cloneRecord(settings.groupStartPolicyTemplates),
        workspaces: this.normalizeWorkspaces(settings.workspaces),
        workspaceHistory: this.normalizeWorkspaceHistory(settings.workspaceHistory).slice(0, workspaceHistoryLimit),
        workspaceHistoryLimit,
      },
    };
  }

  /**
   * 保存配置
   */
  save(): void {
    const serialized = JSON.stringify(this.normalizeConfig(this.config), null, 2);
    const dir = path.dirname(this.configPath);
    const tempPath = path.join(dir, `.config.${process.pid}.${Date.now()}.tmp`);

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.backupExistingConfig();
      fs.writeFileSync(tempPath, serialized, 'utf-8');
      fs.renameSync(tempPath, this.configPath);
      this.config = JSON.parse(serialized);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        console.error('Failed to clean up temporary config after save failure:', cleanupError);
        throw cleanupError;
      }
      console.error('Failed to save config:', error);
      throw error;
    }
  }

  private backupExistingConfig(): string | null {
    if (!fs.existsSync(this.configPath)) {
      return null;
    }

    const backupDir = this.getBackupDir();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = this.createBackupPath(backupDir);
    fs.copyFileSync(this.configPath, backupPath);
    return backupPath;
  }

  listBackups(limit: number = 20): ConfigBackupSummary[] {
    const backupDir = this.getBackupDir();
    if (!fs.existsSync(backupDir)) return [];

    return fs.readdirSync(backupDir)
      .filter((name) => this.isValidBackupId(name))
      .map((name) => {
        const backupPath = path.join(backupDir, name);
        const stat = fs.statSync(backupPath);
        return this.readBackupSummary(name, stat);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(0, Math.min(100, Math.floor(limit))));
  }

  restoreBackup(backupId: string): HubKitConfig {
    const backupPath = this.resolveBackupPath(backupId);
    const restored = this.readBackupConfig(backupPath);
    this.config = restored;
    this.save();
    return this.get();
  }

  previewRestoreBackup(backupId: string): ConfigRestorePreview {
    const backupPath = this.resolveBackupPath(backupId);
    const restored = this.readBackupConfig(backupPath);
    const backup = this.readBackupSummary(backupId, fs.statSync(backupPath));
    const current = this.normalizeConfig(this.config);
    const preview: ConfigRestorePreview = {
      backup,
      changedAreas: [],
      moduleDirs: this.diffStringList(current.moduleDirs, restored.moduleDirs),
      groups: this.diffGroups(current.settings.groups, restored.settings.groups),
      autoStart: this.diffBooleanRecord(current.settings.autoStart, restored.settings.autoStart),
      schedules: this.diffJsonRecord(current.settings.schedules, restored.settings.schedules),
      startOrderChanged: !this.isJsonEqual(current.settings.startOrder, restored.settings.startOrder),
      moduleGroupChanges: this.getChangedRecordKeys(current.settings.moduleGroups, restored.settings.moduleGroups),
      startPolicyChanges: this.getChangedRecordKeys(current.settings.startPolicies, restored.settings.startPolicies),
      webUrlChanges: this.getChangedRecordKeys(current.settings.moduleWebUrls, restored.settings.moduleWebUrls),
      visibilityChanges: this.getChangedRecordKeys(current.settings.visibility, restored.settings.visibility),
      workspaceChanges: this.getChangedListItemKeys(current.settings.workspaces, restored.settings.workspaces),
      totals: {
        added: 0,
        removed: 0,
        changed: 0,
      },
    };

    preview.changedAreas = this.getRestoreChangedAreas(preview);
    preview.totals = this.getRestoreTotals(preview);
    return preview;
  }

  private readBackupSummary(name: string, stat: fs.Stats): ConfigBackupSummary {
    const backupPath = path.join(this.getBackupDir(), name);
    try {
      const parsed = this.normalizeConfig(JSON.parse(fs.readFileSync(backupPath, 'utf-8')));
      return {
        id: name,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        moduleDirCount: parsed.moduleDirs.length,
        groupCount: parsed.settings.groups.length,
        autoStartCount: Object.keys(parsed.settings.autoStart).length,
        scheduleCount: Object.keys(parsed.settings.schedules).length,
      };
    } catch {
      return {
        id: name,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        moduleDirCount: 0,
        groupCount: 0,
        autoStartCount: 0,
        scheduleCount: 0,
      };
    }
  }

  private readBackupConfig(backupPath: string): HubKitConfig {
    return this.normalizeConfig(JSON.parse(fs.readFileSync(backupPath, 'utf-8')));
  }

  private resolveBackupPath(backupId: string): string {
    if (!this.isValidBackupId(backupId)) {
      throw new Error('无效的配置备份 ID');
    }
    const backupPath = path.join(this.getBackupDir(), backupId);
    if (!fs.existsSync(backupPath)) {
      throw new Error('配置备份不存在');
    }
    return backupPath;
  }

  private isValidBackupId(backupId: string): boolean {
    const normalized = path.basename(String(backupId || ''));
    return normalized === backupId && /^config-[0-9TZ-]+(?:-\d+)?\.json$/.test(backupId);
  }

  private getBackupDir(): string {
    return path.join(path.dirname(this.configPath), 'backups');
  }

  private createBackupPath(backupDir: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basePath = path.join(backupDir, `config-${stamp}.json`);
    if (!fs.existsSync(basePath)) {
      return basePath;
    }

    for (let index = 1; index <= 1000; index += 1) {
      const backupPath = path.join(backupDir, `config-${stamp}-${index}.json`);
      if (!fs.existsSync(backupPath)) {
        return backupPath;
      }
    }

    throw new Error('无法创建配置备份文件');
  }

  /**
   * 获取配置
   */
  get(): HubKitConfig {
    return this.cloneJson(this.config);
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
      groups: JSON.parse(JSON.stringify(this.config.settings.groups)),
      moduleGroups: { ...this.config.settings.moduleGroups },
      startPolicies: JSON.parse(JSON.stringify(this.config.settings.startPolicies)),
      groupStartPolicyTemplates: { ...this.config.settings.groupStartPolicyTemplates },
      workspaces: JSON.parse(JSON.stringify(this.config.settings.workspaces)),
      workspaceHistory: JSON.parse(JSON.stringify(this.config.settings.workspaceHistory)),
      workspaceHistoryLimit: this.config.settings.workspaceHistoryLimit,
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
      groups: settings.groups ?? this.config.settings.groups,
      moduleGroups: settings.moduleGroups ?? this.config.settings.moduleGroups,
      startPolicies: settings.startPolicies ?? this.config.settings.startPolicies,
      groupStartPolicyTemplates: settings.groupStartPolicyTemplates ?? this.config.settings.groupStartPolicyTemplates,
      workspaces: settings.workspaces ?? this.config.settings.workspaces,
      workspaceHistory: settings.workspaceHistory ?? this.config.settings.workspaceHistory,
      workspaceHistoryLimit: settings.workspaceHistoryLimit ?? this.config.settings.workspaceHistoryLimit,
    };
    this.save();
  }

  /**
   * 记录工作区运行历史
   */
  recordWorkspaceHistory(entry: WorkspaceHistoryEntry): void {
    const historyLimit = this.normalizeWorkspaceHistoryLimit(this.config.settings.workspaceHistoryLimit);
    const normalized = this.normalizeWorkspaceHistory([entry])[0];
    if (!normalized || historyLimit === 0) return;

    this.config.settings.workspaceHistory = [
      normalized,
      ...this.normalizeWorkspaceHistory(this.config.settings.workspaceHistory),
    ].slice(0, historyLimit);
    this.config.settings.workspaceHistoryLimit = historyLimit;
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

  private cloneRecord<T>(input: Record<string, T> | undefined): Record<string, T> {
    return input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  }

  private cloneJson<T>(input: T | undefined): T {
    return JSON.parse(JSON.stringify(input ?? {}));
  }

  private normalizeWorkspaces(input: ModuleWorkspace[] | undefined): ModuleWorkspace[] {
    if (!Array.isArray(input)) return [];

    const seen = new Set<string>();
    return input
      .filter((workspace) => workspace && typeof workspace === 'object')
      .map((workspace) => ({
        id: typeof workspace.id === 'string' ? workspace.id.trim() : '',
        name: typeof workspace.name === 'string' ? workspace.name.trim() : '',
        description: typeof workspace.description === 'string' ? workspace.description : undefined,
        moduleIds: this.uniqueStrings(workspace.moduleIds),
        startOrder: this.uniqueStrings(workspace.startOrder),
        stopOrder: this.uniqueStrings(workspace.stopOrder),
        failurePolicy: workspace.failurePolicy === 'continue'
          ? 'continue' as const
          : 'stop' as const,
      }))
      .filter((workspace) => {
        if (!workspace.id || !workspace.name || seen.has(workspace.id)) return false;
        seen.add(workspace.id);
        return true;
      });
  }

  private normalizeWorkspaceHistory(input: WorkspaceHistoryEntry[] | undefined): WorkspaceHistoryEntry[] {
    if (!Array.isArray(input)) return [];

    return input
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        workspaceId: typeof entry.workspaceId === 'string' ? entry.workspaceId.trim() : '',
        action: entry.action === 'stop' ? 'stop' as const : 'start' as const,
        success: entry.success === true,
        startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : '',
        finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : '',
        failureSummary: typeof entry.failureSummary === 'string' && entry.failureSummary.trim()
          ? entry.failureSummary.trim()
          : undefined,
      }))
      .filter((entry) => entry.workspaceId && entry.startedAt && entry.finishedAt);
  }

  private normalizeWorkspaceHistoryLimit(input: unknown): number {
    if (!Number.isFinite(input)) return DEFAULT_CONFIG.settings.workspaceHistoryLimit;
    return Math.max(0, Math.min(100, Math.floor(input as number)));
  }

  private uniqueStrings(input: string[] | undefined): string[] {
    if (!Array.isArray(input)) return [];

    const seen = new Set<string>();
    return input
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }

  private diffStringList(current: string[], restored: string[]): { added: string[]; removed: string[] } {
    return {
      added: restored.filter((item) => !current.includes(item)),
      removed: current.filter((item) => !restored.includes(item)),
    };
  }

  private diffGroups(
    current: Array<{ id: string; name: string }>,
    restored: Array<{ id: string; name: string }>
  ): ConfigRestorePreview['groups'] {
    const currentById = new Map(current.map((group) => [group.id, group]));
    const restoredById = new Map(restored.map((group) => [group.id, group]));
    return {
      added: restored.filter((group) => !currentById.has(group.id)),
      removed: current.filter((group) => !restoredById.has(group.id)),
      renamed: restored
        .filter((group) => currentById.has(group.id) && currentById.get(group.id)?.name !== group.name)
        .map((group) => ({ id: group.id, from: currentById.get(group.id)?.name || '', to: group.name })),
    };
  }

  private diffBooleanRecord(
    current: Record<string, boolean>,
    restored: Record<string, boolean>
  ): ConfigRestorePreview['autoStart'] {
    const keys = this.getChangedRecordKeys(current, restored);
    return {
      enabled: keys.filter((key) => restored[key] === true),
      disabled: keys.filter((key) => restored[key] !== true),
    };
  }

  private diffJsonRecord<T>(
    current: Record<string, T>,
    restored: Record<string, T>
  ): { added: string[]; removed: string[]; changed: string[] } {
    const currentKeys = Object.keys(current);
    const restoredKeys = Object.keys(restored);
    return {
      added: restoredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(current, key)),
      removed: currentKeys.filter((key) => !Object.prototype.hasOwnProperty.call(restored, key)),
      changed: restoredKeys.filter((key) => (
        Object.prototype.hasOwnProperty.call(current, key) && !this.isJsonEqual(current[key], restored[key])
      )),
    };
  }

  private getChangedRecordKeys<T>(current: Record<string, T>, restored: Record<string, T>): string[] {
    const diff = this.diffJsonRecord(current, restored);
    return [...diff.added, ...diff.removed, ...diff.changed].sort();
  }

  private getChangedListItemKeys<T extends { id: string }>(current: T[], restored: T[]): string[] {
    const currentById = new Map(current.map((item) => [item.id, item]));
    const restoredById = new Map(restored.map((item) => [item.id, item]));
    const keys = new Set<string>();

    current.forEach((item) => {
      if (!restoredById.has(item.id) || !this.isJsonEqual(item, restoredById.get(item.id))) {
        keys.add(item.id);
      }
    });
    restored.forEach((item) => {
      if (!currentById.has(item.id)) {
        keys.add(item.id);
      }
    });

    return [...keys].sort();
  }

  private getRestoreChangedAreas(preview: ConfigRestorePreview): string[] {
    const areas: string[] = [];
    if (preview.moduleDirs.added.length > 0 || preview.moduleDirs.removed.length > 0) areas.push('模块目录');
    if (preview.groups.added.length > 0 || preview.groups.removed.length > 0 || preview.groups.renamed.length > 0) areas.push('工作区分组');
    if (preview.autoStart.enabled.length > 0 || preview.autoStart.disabled.length > 0 || preview.startOrderChanged) areas.push('自启与顺序');
    if (preview.schedules.added.length > 0 || preview.schedules.removed.length > 0 || preview.schedules.changed.length > 0) areas.push('定时任务');
    if (preview.moduleGroupChanges.length > 0) areas.push('模块分组归属');
    if (preview.startPolicyChanges.length > 0) areas.push('启动策略');
    if (preview.webUrlChanges.length > 0) areas.push('Web 入口');
    if (preview.visibilityChanges.length > 0) areas.push('卡片显示');
    if (preview.workspaceChanges.length > 0) areas.push('工作区编排');
    return areas;
  }

  private getRestoreTotals(preview: ConfigRestorePreview): ConfigRestorePreview['totals'] {
    return {
      added: preview.moduleDirs.added.length
        + preview.groups.added.length
        + preview.autoStart.enabled.length
        + preview.schedules.added.length,
      removed: preview.moduleDirs.removed.length
        + preview.groups.removed.length
        + preview.autoStart.disabled.length
        + preview.schedules.removed.length,
      changed: preview.groups.renamed.length
        + preview.schedules.changed.length
        + (preview.startOrderChanged ? 1 : 0)
        + preview.moduleGroupChanges.length
        + preview.startPolicyChanges.length
        + preview.webUrlChanges.length
        + preview.visibilityChanges.length
        + preview.workspaceChanges.length,
    };
  }

  private isJsonEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * 全局配置实例
 */
export const config = new ConfigManager();

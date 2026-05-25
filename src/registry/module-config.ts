import * as path from 'path';
import { ModuleMetadata } from '../types/module';

export type ModuleType = 'nodejs' | 'python' | 'shell';

export interface ModuleConfig {
  id: string;
  name: string;
  description?: string;
  type: ModuleType;
  scriptPath: string;
  startScript?: string;
  webUrl?: string;
  webPort?: number;
  updateable?: boolean;
  repoUrl?: string;
  autoStart?: boolean;
  enabled?: boolean;
}

export interface ModuleConfigValidationIssue {
  field: string;
  message: string;
}

export interface ModuleConfigValidationResult {
  valid: boolean;
  errors: ModuleConfigValidationIssue[];
  warnings: ModuleConfigValidationIssue[];
}

const MODULE_TYPES: ModuleType[] = ['nodejs', 'python', 'shell'];

export function validateModuleConfig(input: unknown): ModuleConfigValidationResult {
  const errors: ModuleConfigValidationIssue[] = [];
  const warnings: ModuleConfigValidationIssue[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ field: 'root', message: '配置必须是 JSON 对象' }],
      warnings,
    };
  }

  const config = input as Partial<ModuleConfig>;
  requireString(config, 'id', errors);
  requireString(config, 'name', errors);
  requireString(config, 'scriptPath', errors);

  if (!config.type || typeof config.type !== 'string') {
    errors.push({ field: 'type', message: 'type 必须是 nodejs、python 或 shell' });
  } else if (!MODULE_TYPES.includes(config.type as ModuleType)) {
    errors.push({ field: 'type', message: `不支持的模块类型：${config.type}` });
  }

  validateOptionalString(config, 'description', errors);
  validateOptionalString(config, 'startScript', errors);
  validateOptionalString(config, 'webUrl', errors);
  validateOptionalString(config, 'repoUrl', errors);
  validateOptionalBoolean(config, 'updateable', errors);
  validateOptionalBoolean(config, 'autoStart', errors);
  validateOptionalBoolean(config, 'enabled', errors);

  if (config.webPort !== undefined && (!Number.isInteger(config.webPort) || config.webPort < 1 || config.webPort > 65535)) {
    errors.push({ field: 'webPort', message: 'webPort 必须是 1 到 65535 之间的整数' });
  }

  if (typeof config.id === 'string' && !/^[a-z0-9][a-z0-9-_.]*$/.test(config.id)) {
    warnings.push({ field: 'id', message: '建议使用小写字母、数字、短横线、下划线或点号，便于 CLI 输入' });
  }

  if (typeof config.webUrl === 'string' && config.webUrl.trim() && !/^https?:\/\//.test(config.webUrl)) {
    warnings.push({ field: 'webUrl', message: '建议使用 http:// 或 https:// 开头的完整 URL' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function normalizeModuleConfig(config: ModuleConfig, moduleDir: string): ModuleMetadata {
  const scriptPath = path.isAbsolute(config.scriptPath)
    ? config.scriptPath
    : path.join(moduleDir, config.scriptPath);

  return {
    id: config.id,
    name: config.name,
    description: config.description,
    type: config.type,
    scriptPath,
    startScript: config.startScript,
    webUrl: config.webUrl,
    webPort: config.webPort,
    updateable: config.updateable,
    repoUrl: config.repoUrl,
    autoStart: config.autoStart ?? false,
    enabled: config.enabled ?? true,
  };
}

export function createModuleConfigTemplate(options: {
  id: string;
  name: string;
  type: ModuleType;
  scriptPath: string;
  description?: string;
  webPort?: number;
  webUrl?: string;
}): ModuleConfig {
  return {
    id: options.id,
    name: options.name,
    description: options.description || '',
    type: options.type,
    scriptPath: options.scriptPath,
    webPort: options.webPort,
    webUrl: options.webUrl,
    autoStart: false,
    enabled: true,
  };
}

function requireString(config: Partial<ModuleConfig>, field: keyof ModuleConfig, errors: ModuleConfigValidationIssue[]): void {
  const value = config[field];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ field, message: `${field} 必须是非空字符串` });
  }
}

function validateOptionalString(
  config: Partial<ModuleConfig>,
  field: keyof ModuleConfig,
  errors: ModuleConfigValidationIssue[]
): void {
  const value = config[field];
  if (value !== undefined && typeof value !== 'string') {
    errors.push({ field, message: `${field} 必须是字符串` });
  }
}

function validateOptionalBoolean(
  config: Partial<ModuleConfig>,
  field: keyof ModuleConfig,
  errors: ModuleConfigValidationIssue[]
): void {
  const value = config[field];
  if (value !== undefined && typeof value !== 'boolean') {
    errors.push({ field, message: `${field} 必须是布尔值` });
  }
}

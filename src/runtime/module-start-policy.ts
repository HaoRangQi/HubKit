import { ModuleStartPolicy, StartPolicyTemplate } from '../types/module';
import { ModuleSettings } from '../config/config';

export const DEFAULT_START_POLICY: ModuleStartPolicy = {
  retryCount: 1,
  retryDelayMs: 1500,
  healthCheckEnabled: true,
  healthCheckTimeoutMs: 15000,
  preflightChecksEnabled: true,
  blockOnPortConflict: true,
};

export const START_POLICY_TEMPLATES: StartPolicyTemplate[] = [
  {
    id: 'balanced',
    name: '平衡型',
    description: '适合大多数本地 Web 模块，带一次重试和健康检查。',
    policy: DEFAULT_START_POLICY,
  },
  {
    id: 'aggressive',
    name: '激进恢复',
    description: '适合偶发性启动不稳的服务，增加重试和等待时间。',
    policy: {
      retryCount: 2,
      retryDelayMs: 2500,
      healthCheckEnabled: true,
      healthCheckTimeoutMs: 25000,
      preflightChecksEnabled: true,
      blockOnPortConflict: true,
    },
  },
  {
    id: 'script',
    name: '脚本任务',
    description: '适合一次性脚本或无 Web 入口模块，弱化健康检查。',
    policy: {
      retryCount: 0,
      retryDelayMs: 1000,
      healthCheckEnabled: false,
      healthCheckTimeoutMs: 5000,
      preflightChecksEnabled: true,
      blockOnPortConflict: false,
    },
  },
];

export function normalizeStartPolicy(input?: Partial<ModuleStartPolicy> | null): ModuleStartPolicy {
  const retryCount = clampInteger(input?.retryCount, 0, 3, DEFAULT_START_POLICY.retryCount);
  const retryDelayMs = clampInteger(input?.retryDelayMs, 500, 15000, DEFAULT_START_POLICY.retryDelayMs);
  const healthCheckTimeoutMs = clampInteger(
    input?.healthCheckTimeoutMs,
    2000,
    60000,
    DEFAULT_START_POLICY.healthCheckTimeoutMs
  );

  return {
    retryCount,
    retryDelayMs,
    healthCheckEnabled: input?.healthCheckEnabled ?? DEFAULT_START_POLICY.healthCheckEnabled,
    healthCheckTimeoutMs,
    preflightChecksEnabled: input?.preflightChecksEnabled ?? DEFAULT_START_POLICY.preflightChecksEnabled,
    blockOnPortConflict: input?.blockOnPortConflict ?? DEFAULT_START_POLICY.blockOnPortConflict,
  };
}

export function getStartPolicyTemplate(templateId?: string | null): StartPolicyTemplate | undefined {
  return START_POLICY_TEMPLATES.find((template) => template.id === templateId);
}

export function getModuleStartPolicy(
  settings: ModuleSettings,
  moduleId: string,
  groupId: string = 'default'
): ModuleStartPolicy {
  const templateId = settings.groupStartPolicyTemplates?.[groupId] || 'balanced';
  const template = getStartPolicyTemplate(templateId);
  const base = template ? template.policy : DEFAULT_START_POLICY;
  return normalizeStartPolicy({
    ...base,
    ...(settings.startPolicies?.[moduleId] || {}),
  });
}

export function getModuleInheritedTemplateId(settings: ModuleSettings, groupId: string = 'default'): string {
  return settings.groupStartPolicyTemplates?.[groupId] || 'balanced';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.round(Number(value));
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

import {
  DEFAULT_START_POLICY,
  getModuleInheritedTemplateId,
  getModuleStartPolicy,
  normalizeStartPolicy,
} from '../../src/runtime/module-start-policy';
import { ModuleSettings } from '../../src/config/config';

function createSettings(overrides: Partial<ModuleSettings> = {}): ModuleSettings {
  return {
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
    ...overrides,
  };
}

describe('module-start-policy', () => {
  it('fills defaults for missing values', () => {
    expect(normalizeStartPolicy()).toEqual(DEFAULT_START_POLICY);
  });

  it('clamps numeric policy values into safe bounds', () => {
    expect(normalizeStartPolicy({
      retryCount: 99,
      retryDelayMs: 10,
      healthCheckTimeoutMs: 999999,
      healthCheckEnabled: false,
      preflightChecksEnabled: false,
      blockOnPortConflict: false,
    })).toEqual({
      retryCount: 3,
      retryDelayMs: 500,
      healthCheckEnabled: false,
      healthCheckTimeoutMs: 60000,
      preflightChecksEnabled: false,
      blockOnPortConflict: false,
    });
  });

  it('resolves policy from settings by module id', () => {
    const policy = getModuleStartPolicy(createSettings({
      startPolicies: {
        foo: {
          retryCount: 2,
          retryDelayMs: 1800,
          healthCheckEnabled: true,
          healthCheckTimeoutMs: 8000,
          preflightChecksEnabled: true,
          blockOnPortConflict: false,
        },
      },
    }), 'foo');

    expect(policy.retryCount).toBe(2);
    expect(policy.retryDelayMs).toBe(1800);
    expect(policy.blockOnPortConflict).toBe(false);
  });

  it('inherits policy template from group when module has no custom policy', () => {
    const policy = getModuleStartPolicy(createSettings({
      groups: [{ id: 'ops', name: '运维组' }],
      moduleGroups: { bar: 'ops' },
      groupStartPolicyTemplates: { ops: 'script' },
    }), 'bar', 'ops');

    expect(policy.retryCount).toBe(0);
    expect(policy.healthCheckEnabled).toBe(false);
    expect(getModuleInheritedTemplateId(createSettings({
      groups: [{ id: 'ops', name: '运维组' }],
      groupStartPolicyTemplates: { ops: 'script' },
    }), 'ops')).toBe('script');
  });
});

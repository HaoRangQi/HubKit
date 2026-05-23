import {
  DEFAULT_START_POLICY,
  getModuleInheritedTemplateId,
  getModuleStartPolicy,
  normalizeStartPolicy,
} from '../../src/runtime/module-start-policy';

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
    const policy = getModuleStartPolicy({
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'default', name: '默认分组' }],
      moduleGroups: {},
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
      groupStartPolicyTemplates: {},
    }, 'foo');

    expect(policy.retryCount).toBe(2);
    expect(policy.retryDelayMs).toBe(1800);
    expect(policy.blockOnPortConflict).toBe(false);
  });

  it('inherits policy template from group when module has no custom policy', () => {
    const policy = getModuleStartPolicy({
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'ops', name: '运维组' }],
      moduleGroups: { bar: 'ops' },
      startPolicies: {},
      groupStartPolicyTemplates: { ops: 'script' },
    }, 'bar', 'ops');

    expect(policy.retryCount).toBe(0);
    expect(policy.healthCheckEnabled).toBe(false);
    expect(getModuleInheritedTemplateId({
      autoStart: {},
      startOrder: [],
      moduleWebUrls: {},
      visibility: {},
      schedules: {},
      groups: [{ id: 'ops', name: '运维组' }],
      moduleGroups: {},
      startPolicies: {},
      groupStartPolicyTemplates: { ops: 'script' },
    }, 'ops')).toBe('script');
  });
});

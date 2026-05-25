(function () {
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function normalizeId(value) {
    return String(value || '').trim();
  }

  function getModuleStartPolicySettings(module, startPolicies, defaultStartPolicy) {
    const moduleId = normalizeId(module?.id);
    const configuredStartPolicies = isObject(startPolicies) ? startPolicies : {};
    const stored = isObject(configuredStartPolicies[moduleId]) ? configuredStartPolicies[moduleId] : {};
    const fromModule = isObject(module?.startPolicy) ? module.startPolicy : {};
    const defaults = isObject(defaultStartPolicy) ? defaultStartPolicy : {};
    return {
      ...defaults,
      ...fromModule,
      ...stored,
    };
  }

  function getOrderedModules(modules, startOrder) {
    const order = asArray(startOrder).map(normalizeId);
    return asArray(modules).filter(isObject).map((module, index) => ({ module, index })).sort((a, b) => {
      const ai = order.indexOf(normalizeId(a.module.id));
      const bi = order.indexOf(normalizeId(b.module.id));
      if (ai === -1 && bi === -1) return a.index - b.index;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }).map((item) => item.module);
  }

  function getSettingsRiskCount(orderedModules, settings, defaultStartPolicy) {
    const config = isObject(settings) ? settings : {};
    const schedules = isObject(config.schedules) ? config.schedules : {};
    return asArray(orderedModules).filter(isObject).reduce((count, module) => {
      const moduleId = normalizeId(module.id);
      const policy = getModuleStartPolicySettings(module, config.startPolicies, defaultStartPolicy);
      const schedule = isObject(module.schedule) ? module.schedule : (isObject(schedules[moduleId]) ? schedules[moduleId] : {});
      const hasNoHealthTarget = !module.webUrl && !module.webPort;
      const hasScheduleWithoutAction = schedule.enabled === true && !schedule.startTime && !schedule.stopTime;
      const hasDisabledPreflight = policy.preflightChecksEnabled === false || policy.blockOnPortConflict === false;
      const hasHealthWithoutTarget = policy.healthCheckEnabled && hasNoHealthTarget;
      return count + (hasScheduleWithoutAction || hasDisabledPreflight || hasHealthWithoutTarget ? 1 : 0);
    }, 0);
  }

  function getSettingsOverview(orderedModules, groups, webUrlModules, settings, defaultStartPolicy) {
    const modules = asArray(orderedModules).filter(isObject);
    const visibleGroups = asArray(groups).filter(isObject);
    const webModules = asArray(webUrlModules).filter(isObject);
    const config = isObject(settings) ? settings : {};
    const autoStart = isObject(config.autoStart) ? config.autoStart : {};
    const schedules = isObject(config.schedules) ? config.schedules : {};
    const startPolicies = isObject(config.startPolicies) ? config.startPolicies : {};
    const autoStartCount = modules.filter((module) => autoStart[normalizeId(module.id)]).length;
    const scheduledCount = modules.filter((module) => {
      const moduleId = normalizeId(module.id);
      const schedule = isObject(module.schedule) ? module.schedule : (isObject(schedules[moduleId]) ? schedules[moduleId] : {});
      return schedule.enabled === true;
    }).length;
    const hiddenCount = modules.filter((module) => module.visible === false).length;
    const customPolicyCount = Object.keys(startPolicies).length;
    const webEntryCount = webModules.filter((module) => module.webUrl || module.webPort).length;
    const riskCount = getSettingsRiskCount(modules, config, defaultStartPolicy);

    return [
      { label: '自启模块', value: autoStartCount, note: `共 ${modules.length} 个模块，按顺序启动` },
      { label: '模块分组', value: visibleGroups.length, note: `${customPolicyCount} 个模块使用自定义策略` },
      { label: '入口与定时', value: scheduledCount, note: `${webEntryCount} 个 Web 入口，${hiddenCount} 张卡片隐藏` },
      { label: '配置风险', value: riskCount, note: riskCount > 0 ? '建议先检查启动策略和定时任务' : '未发现明显配置风险' },
    ];
  }

  window.HubKitSettings = {
    getModuleStartPolicySettings,
    getOrderedModules,
    getSettingsRiskCount,
    getSettingsOverview,
  };
}());

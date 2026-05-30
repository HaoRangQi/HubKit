(function () {
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeId(value) {
    return String(value || '').trim();
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function resolveCallback(callback, fallback) {
    return typeof callback === 'function' ? callback : fallback;
  }

  function buildCheckinDashboardSection(checkinSites) {
    const items = asArray(checkinSites).filter(isObject);
    if (items.length === 0) return null;
    return {
      id: 'checkin-hub',
      kind: 'checkin-hub',
      name: '签到中心',
      icon: 'event_available',
      accent: 'var(--md-primary)',
      kicker: '验证实验',
      items,
      cardCount: 1,
    };
  }

  function buildModuleDashboardSections(moduleGroups, getDashboardGroupAccent) {
    const resolveAccent = resolveCallback(getDashboardGroupAccent, () => 'var(--md-secondary)');
    const sections = asArray(moduleGroups)
      .filter((group) => isObject(group) && normalizeId(group.id))
      .map((group) => {
        const groupId = normalizeId(group.id);
        const name = normalizeId(group.name) || groupId;
        return {
          id: `group-${groupId}`,
          kind: 'module',
          name,
          icon: 'dashboard',
          accent: resolveAccent(groupId, 'module'),
          kicker: '模块分组',
          items: asArray(group.modules).filter(isObject),
        };
      });
    const defaultIndex = sections.findIndex((section) => section.id === 'group-default');
    if (defaultIndex > 0) {
      const [defaultSection] = sections.splice(defaultIndex, 1);
      sections.unshift(defaultSection);
    }
    return sections;
  }

  function buildScriptDashboardSections(bundle, getScriptGroupIcon, getDashboardGroupAccent) {
    if (!bundle || !Array.isArray(bundle.groups)) return [];
    const resolveIcon = resolveCallback(getScriptGroupIcon, () => 'dashboard');
    const resolveAccent = resolveCallback(getDashboardGroupAccent, () => 'var(--md-primary)');
    return bundle.groups
      .filter((group) => isObject(group) && normalizeId(group.id))
      .map((group) => {
        const groupId = normalizeId(group.id);
        const title = normalizeId(group.title) || groupId;
        return {
          id: `script-${groupId}`,
          kind: 'script',
          name: title,
          icon: resolveIcon(groupId),
          accent: resolveAccent(groupId, 'script'),
          kicker: '脚本工具箱',
          description: String(group.description || ''),
          bundleId: bundle.id,
          items: asArray(group.actions).filter(isObject),
        };
      });
  }

  function appendSystemActionDashboardSections(sections, systemActions, getDashboardGroupAccent) {
    const nextSections = asArray(sections).filter(isObject).map((section) => ({
      ...section,
      items: asArray(section.items),
    }));
    const resolveAccent = resolveCallback(getDashboardGroupAccent, () => 'var(--md-primary)');

    asArray(systemActions).forEach((action) => {
      if (!isObject(action)) return;
      const groupId = normalizeId(action.groupId);
      if (!groupId) return;
      const targetSectionId = `script-${groupId}`;
      const section = nextSections.find((item) => item.id === targetSectionId);
      if (section) {
        section.items = [...section.items, action];
        section.kind = 'mixed';
        return;
      }

      nextSections.push({
        id: `system-action-${groupId}`,
        kind: 'system-action',
        name: groupId === 'system-tuning' ? '系统调优' : groupId,
        icon: groupId === 'system-tuning' ? 'tune' : 'dashboard',
        accent: resolveAccent(groupId, 'script'),
        kicker: '原生调优',
        items: [action],
      });
    });

    return nextSections;
  }

  function getModuleIssue(module) {
    if (!isObject(module)) return null;
    const runtimeState = isObject(module.runtimeState) ? module.runtimeState : {};
    const health = isObject(runtimeState.health) ? runtimeState.health : {};
    const readiness = isObject(module.startReadiness) ? module.startReadiness : {};
    const name = normalizeId(module.name) || normalizeId(module.id) || '未命名模块';
    const id = normalizeId(module.id);

    if (runtimeState.phase === 'failed' || module.status === 'error') {
      const failure = isObject(runtimeState.failure) ? runtimeState.failure : {};
      return {
        tone: 'error',
        kind: 'failed',
        moduleId: id,
        moduleName: name,
        title: `${name}：启动失败`,
        detail: normalizeId(failure.summary) || normalizeId(runtimeState.summary) || '打开失败日志定位原因',
        actionKind: 'logs',
        actionLabel: '查看日志',
      };
    }

    if (health.state === 'unhealthy') {
      return {
        tone: 'error',
        kind: 'unhealthy',
        moduleId: id,
        moduleName: name,
        title: `${name}：健康检查未通过`,
        detail: normalizeId(health.summary) || '重新检查服务监听和最近日志',
        actionKind: 'diagnostics',
        actionLabel: '查看体检',
      };
    }

    if (readiness.ready === false) {
      return {
        tone: 'warn',
        kind: 'not-ready',
        moduleId: id,
        moduleName: name,
        title: `${name}：启动前需处理`,
        detail: normalizeId(readiness.summary) || normalizeId(readiness.details) || '补齐依赖、端口或环境配置后再启动',
        actionKind: 'diagnostics',
        actionLabel: '查看体检',
      };
    }

    if (module.updateable === true) {
      return {
        tone: 'info',
        kind: 'updateable',
        moduleId: id,
        moduleName: name,
        title: `${name}：可检查更新`,
        detail: '建议在空闲时检查版本差异',
        actionKind: 'update',
        actionLabel: '检查更新',
      };
    }

    return null;
  }

  function countModulesBy(modules, predicate) {
    return asArray(modules).filter((module) => isObject(module) && predicate(module)).length;
  }

  function buildDashboardFocusSummary(modules) {
    const visibleModules = asArray(modules).filter((module) => isObject(module) && module.visible !== false);
    const issues = visibleModules.map(getModuleIssue).filter(Boolean);
    const failedCount = issues.filter((item) => item.kind === 'failed' || item.kind === 'unhealthy').length;
    const blockedCount = issues.filter((item) => item.kind === 'not-ready').length;
    const updateableCount = issues.filter((item) => item.kind === 'updateable').length;
    const runningCount = countModulesBy(visibleModules, (module) => {
      const phase = isObject(module.runtimeState) ? module.runtimeState.phase : '';
      if (phase === 'failed' || phase === 'stopped') return false;
      return phase === 'running' || module.status === 'running';
    });
    const stoppedCount = Math.max(0, visibleModules.length - runningCount);
    const leadIssue = issues.find((item) => item.tone === 'error') || issues.find((item) => item.tone === 'warn') || issues[0] || null;

    let tone = 'calm';
    let title = '当前没有需要立即处理的模块';
    let description = runningCount > 0
      ? `${runningCount} 个模块正在运行，可从下方分组继续操作。`
      : '所有模块都处于待机状态，可按场景启动需要的模块。';
    let primaryAction = { kind: 'refresh', label: '刷新状态' };

    if (failedCount > 0) {
      tone = 'error';
      title = `${failedCount} 个模块需要优先处理`;
      description = leadIssue?.detail || '先查看失败日志和模块体检，再执行修复动作。';
      primaryAction = { kind: 'diagnostics', label: '查看体检' };
    } else if (blockedCount > 0) {
      tone = 'warn';
      title = `${blockedCount} 个模块启动前需要准备`;
      description = leadIssue?.detail || '建议先处理依赖、端口或环境变量，再启动模块。';
      primaryAction = { kind: 'diagnostics', label: '查看体检' };
    } else if (updateableCount > 0) {
      tone = 'info';
      title = `${updateableCount} 个模块可检查更新`;
      description = '当前运行风险较低，可以按需查看可更新模块。';
      primaryAction = { kind: 'refresh', label: '刷新状态' };
    }

    return {
      tone,
      title,
      description,
      primaryAction,
      metrics: [
        { id: 'failed', label: '异常', value: failedCount, tone: failedCount > 0 ? 'error' : 'neutral' },
        { id: 'blocked', label: '待准备', value: blockedCount, tone: blockedCount > 0 ? 'warn' : 'neutral' },
        { id: 'running', label: '运行中', value: runningCount, tone: runningCount > 0 ? 'success' : 'neutral' },
        { id: 'stopped', label: '待机', value: stoppedCount, tone: 'neutral' },
      ],
      items: issues.slice(0, 3),
      hiddenItemCount: Math.max(0, issues.length - 3),
    };
  }

  function buildDashboardSections(options = {}) {
    const config = options && typeof options === 'object' ? options : {};
    const sections = [];
    const checkinSection = buildCheckinDashboardSection(config.checkinSites);
    sections.push(...buildModuleDashboardSections(config.moduleGroups, config.getDashboardGroupAccent));
    if (config.workspaceSection) sections.push(config.workspaceSection);
    sections.push(...buildScriptDashboardSections(
      config.scriptBundle,
      config.getScriptGroupIcon,
      config.getDashboardGroupAccent,
    ));
    const withSystemActions = appendSystemActionDashboardSections(
      sections,
      config.systemActions,
      config.getDashboardGroupAccent,
    );
    if (checkinSection) withSystemActions.push(checkinSection);
    return withSystemActions;
  }

  window.HubKitDashboard = {
    buildCheckinDashboardSection,
    buildModuleDashboardSections,
    buildScriptDashboardSections,
    appendSystemActionDashboardSections,
    buildDashboardFocusSummary,
    buildDashboardSections,
  };
}());

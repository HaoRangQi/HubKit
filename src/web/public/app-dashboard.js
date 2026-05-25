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
    buildDashboardSections,
  };
}());

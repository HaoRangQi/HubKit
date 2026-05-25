(function () {
  function normalizeId(value) {
    return String(value || '').trim();
  }

  function normalizeIdList(values) {
    return (Array.isArray(values) ? values : [])
      .map(normalizeId)
      .filter((id) => id);
  }

  function hasNonBlankId(item) {
    return Boolean(item && typeof item === 'object' && normalizeId(item.id));
  }

  function mergeWorkspaceOrder(moduleIds, preferredOrder) {
    const ids = normalizeIdList(moduleIds);
    const preferred = normalizeIdList(preferredOrder);
    const known = new Set(ids);
    const ordered = preferred.filter((moduleId) => known.has(moduleId));
    const orderedSet = new Set(ordered);
    return [
      ...ordered,
      ...ids.filter((moduleId) => !orderedSet.has(moduleId)),
    ];
  }

  function getModuleGroupId(module, moduleGroups) {
    if (!module || typeof module !== 'object') return 'default';
    const configuredModuleGroups = moduleGroups && typeof moduleGroups === 'object' ? moduleGroups : {};
    const moduleId = normalizeId(module.id);
    const moduleGroupId = normalizeId(module.groupId);
    const settingsGroupId = normalizeId(configuredModuleGroups[moduleId]);
    return moduleGroupId || settingsGroupId || 'default';
  }

  function isWorkspaceModuleSelected(workspace, moduleId) {
    const selectedModuleId = normalizeId(moduleId);
    const selectedModuleIds = normalizeIdList(workspace?.moduleIds);
    return Boolean(selectedModuleId) && selectedModuleIds.includes(selectedModuleId);
  }

  function buildWorkspaceModuleToggleViewModel(workspace, module) {
    const moduleId = normalizeId(module?.id);
    const moduleName = String(module?.name || '').trim() || moduleId || '未命名模块';
    return {
      workspaceId: String(workspace?.id || ''),
      moduleId,
      moduleName,
      checked: isWorkspaceModuleSelected(workspace, moduleId),
    };
  }

  function buildWorkspaceDashboardDrafts(workspaces) {
    const items = Array.isArray(workspaces) ? workspaces : [];
    return items.filter(hasNonBlankId).map((workspace) => {
      const moduleIds = normalizeIdList(workspace.moduleIds);
      return {
        ...workspace,
        id: normalizeId(workspace.id),
        moduleIds,
        startOrder: normalizeIdList(workspace.startOrder).filter((id) => moduleIds.includes(id)),
        stopOrder: normalizeIdList(workspace.stopOrder).filter((id) => moduleIds.includes(id)),
      };
    });
  }

  function generateWorkspaceId(existingWorkspaceIds, options = {}) {
    const existingIds = normalizeIdList(existingWorkspaceIds);
    const config = options && typeof options === 'object' ? options : {};
    const existing = new Set(existingIds);
    const nowToken = config.nowToken || Date.now().toString(36);
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? nowToken : `${nowToken}-${index}`;
      const id = `workspace-${suffix}`;
      if (!existing.has(id)) return id;
    }
    const randomToken = config.randomToken || Math.random().toString(36).slice(2, 8);
    return `workspace-${nowToken}-${randomToken}`;
  }

  function createWorkspaceDraft(id) {
    const workspaceId = normalizeId(id);
    return {
      id: workspaceId,
      name: '新工作区',
      description: '',
      moduleIds: [],
      startOrder: [],
      stopOrder: [],
      failurePolicy: 'stop',
    };
  }

  function updateWorkspaceModuleSelection(workspace, moduleId, enabled) {
    if (!workspace || typeof workspace !== 'object') return null;
    const selectedModuleId = normalizeId(moduleId);
    const currentModuleIds = normalizeIdList(workspace.moduleIds);
    const moduleIds = selectedModuleId
      ? (enabled
        ? (currentModuleIds.includes(selectedModuleId) ? [...currentModuleIds] : [...currentModuleIds, selectedModuleId])
        : currentModuleIds.filter((id) => id !== selectedModuleId))
      : [...currentModuleIds];
    return {
      ...workspace,
      moduleIds,
      startOrder: Array.isArray(workspace.startOrder)
        ? normalizeIdList(workspace.startOrder).filter((id) => moduleIds.includes(id))
        : [],
      stopOrder: Array.isArray(workspace.stopOrder)
        ? normalizeIdList(workspace.stopOrder).filter((id) => moduleIds.includes(id))
        : [],
    };
  }

  function updateWorkspaceMetadataField(workspace, field, value) {
    if (!workspace || typeof workspace !== 'object') return null;
    if (!['name', 'description'].includes(field)) return null;
    const nextValue = String(value || '').trim();
    return {
      ...workspace,
      [field]: field === 'name' && !nextValue ? '未命名工作区' : nextValue,
    };
  }

  function updateWorkspaceFailurePolicy(workspace, value) {
    if (!workspace || typeof workspace !== 'object') return null;
    return {
      ...workspace,
      failurePolicy: value === 'continue' ? 'continue' : 'stop',
    };
  }

  function removeWorkspaceDraft(workspaces, workspaceId) {
    const items = Array.isArray(workspaces) ? workspaces : [];
    const targetWorkspaceId = normalizeId(workspaceId);
    return items.filter((workspace) => hasNonBlankId(workspace) && normalizeId(workspace.id) !== targetWorkspaceId);
  }

  function buildWorkspaceCardViewModel(workspace) {
    const moduleIds = normalizeIdList(workspace?.moduleIds);
    const failurePolicy = workspace?.failurePolicy === 'continue' ? 'continue' : 'stop';
    const orderedIds = Array.isArray(workspace?.startOrder) && workspace.startOrder.length > 0
      ? mergeWorkspaceOrder(moduleIds, workspace.startOrder)
      : moduleIds;
    return {
      moduleIds,
      failurePolicy,
      policyText: failurePolicy === 'continue' ? '失败后继续' : '失败后中断',
      orderedIds,
    };
  }

  function buildWorkspaceCardCopy(workspace) {
    const id = normalizeId(workspace?.id);
    const title = String(workspace?.name || '').trim() || id || '未命名工作区';
    const description = String(workspace?.description || '').trim() || '按场景批量启动或停止一组本地模块。';
    return {
      id,
      title,
      description,
    };
  }

  function buildWorkspaceCardRuntimeState(workspaceId, plansById, actionLoadingById, planLoadingById) {
    const id = normalizeId(workspaceId);
    const plans = plansById && typeof plansById === 'object' ? plansById : {};
    const actionLoading = actionLoadingById && typeof actionLoadingById === 'object' ? actionLoadingById : {};
    const planLoading = planLoadingById && typeof planLoadingById === 'object' ? planLoadingById : {};
    const currentActionLoading = typeof actionLoading[id] === 'string' ? actionLoading[id].trim() : '';
    return {
      plan: plans[id],
      actionLoading: currentActionLoading,
      planLoading: planLoading[id] === true,
    };
  }

  function buildWorkspaceEditorViewModel(workspace) {
    const id = normalizeId(workspace?.id);
    const nameValue = workspace?.name || '';
    const title = String(nameValue).trim() || '未命名工作区';
    const moduleIds = normalizeIdList(workspace?.moduleIds);
    const failurePolicy = workspace?.failurePolicy === 'continue' ? 'continue' : 'stop';
    return {
      id,
      title,
      nameInputId: `workspace-name-${id}`,
      descriptionInputId: `workspace-desc-${id}`,
      policySelectId: `workspace-policy-${id}`,
      nameValue,
      descriptionValue: workspace?.description || '',
      moduleIds,
      selectedCount: moduleIds.length,
      failurePolicy,
      isStopSelected: failurePolicy === 'stop',
      isContinueSelected: failurePolicy === 'continue',
    };
  }

  function buildWorkspaceSettingsViewModel(workspaces) {
    const items = (Array.isArray(workspaces) ? workspaces : [])
      .filter(hasNonBlankId)
      .map((workspace) => ({ ...workspace, id: normalizeId(workspace.id) }));
    return {
      items,
      hasWorkspaces: items.length > 0,
      emptyText: '暂无工作区；可以创建“开发环境”“系统维护”等场景。',
    };
  }

  function buildWorkspaceEditorModulesViewModel(modules) {
    const items = (Array.isArray(modules) ? modules : [])
      .filter(hasNonBlankId)
      .map((module) => ({ ...module, id: normalizeId(module.id) }));
    return {
      items,
      hasModules: items.length > 0,
      emptyText: '暂无模块可加入工作区',
    };
  }

  function buildWorkspacePlanSummaries(plan, formatStepResult) {
    const formatResult = typeof formatStepResult === 'function'
      ? formatStepResult
      : (value) => value || '就绪';
    const steps = (Array.isArray(plan?.steps) ? plan.steps : [])
      .filter((step) => step && typeof step === 'object');
    const getStepName = (step) => String(step.moduleName || '').trim() || normalizeId(step.moduleId) || '未命名模块';
    const getStepStatus = (step) => normalizeId(step.status);
    const getStepResult = (step) => normalizeId(step.result) || getStepStatus(step);
    const planAction = typeof plan?.action === 'string' ? plan.action.trim() : '';
    const planSummary = steps.length > 0
      ? steps.slice(0, 5).map((step) => `${getStepStatus(step) === 'missing' ? '缺失' : '就绪'}：${getStepName(step)}`).join('；')
      : '点击“计划”查看启动顺序和缺失模块';
    const runSummary = steps.length > 0 && planAction
      ? steps.slice(0, 5).map((step) => `${formatResult(getStepResult(step))}：${getStepName(step)}`).join('；')
      : planSummary;
    return {
      planSummary,
      runSummary,
    };
  }

  function buildWorkspaceModuleNames(orderedIds, getModuleName) {
    const resolveName = typeof getModuleName === 'function'
      ? getModuleName
      : (moduleId) => moduleId;
    const moduleNames = normalizeIdList(orderedIds)
      .slice(0, 5)
      .map((moduleId) => String(resolveName(moduleId) || '').trim() || moduleId)
      .join('、');
    return moduleNames || '未配置模块';
  }

  function buildWorkspaceCardMetrics(moduleIds, plan) {
    const configuredModuleIds = normalizeIdList(moduleIds);
    const currentPlan = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : null;
    const runnableModuleIds = normalizeIdList(currentPlan?.runnableModuleIds);
    const missingModuleIds = normalizeIdList(currentPlan?.missingModuleIds);
    const currentPlanAction = normalizeId(currentPlan?.action);
    return {
      moduleCount: configuredModuleIds.length,
      runnableCount: Array.isArray(currentPlan?.runnableModuleIds)
        ? runnableModuleIds.length
        : configuredModuleIds.length,
      missingCount: Array.isArray(currentPlan?.missingModuleIds)
        ? missingModuleIds.length
        : 0,
      recentPlanText: currentPlanAction === 'stop'
        ? '停止'
        : currentPlanAction === 'start'
          ? '启动'
          : currentPlan
            ? '已加载'
            : '未加载',
    };
  }

  function buildWorkspacePlanLoadingText(plan, planLoading) {
    if (planLoading === true) return '加载中...';
    const currentPlan = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : null;
    return currentPlan ? '已加载' : '未加载';
  }

  function buildWorkspaceActionButtons(planLoading, actionLoading) {
    const loadingAction = typeof actionLoading === 'string' ? actionLoading.trim() : '';
    const hasUnknownActionLoading = Boolean(loadingAction) && !['start', 'stop'].includes(loadingAction);
    return {
      plan: {
        disabled: planLoading === true,
        icon: planLoading === true ? 'progress_activity' : 'article',
        label: planLoading === true ? '加载中...' : '计划',
      },
      start: {
        disabled: Boolean(loadingAction),
        icon: loadingAction === 'start' || hasUnknownActionLoading ? 'progress_activity' : 'play_circle',
        label: loadingAction === 'start' ? '启动中...' : (hasUnknownActionLoading ? '处理中...' : '启动'),
      },
      stop: {
        disabled: Boolean(loadingAction),
        icon: loadingAction === 'stop' || hasUnknownActionLoading ? 'progress_activity' : 'stop_circle',
        label: loadingAction === 'stop' ? '停止中...' : (hasUnknownActionLoading ? '处理中...' : '停止'),
      },
    };
  }

  function buildVisibleModuleGroups(visibleModules, groups, moduleGroups) {
    const validGroups = (Array.isArray(groups) ? groups : [])
      .filter(hasNonBlankId)
      .map((group) => ({ ...group, id: normalizeId(group.id) }));
    const configuredGroups = validGroups.length > 0
      ? validGroups
      : [{ id: 'default', name: '默认分组' }];
    const configuredModuleGroups = moduleGroups && typeof moduleGroups === 'object' ? moduleGroups : {};

    const groupMap = new Map(configuredGroups.map((group) => [group.id, { ...group, modules: [] }]));
    if (!groupMap.has('default')) {
      groupMap.set('default', { id: 'default', name: '默认分组', modules: [] });
    }

    (Array.isArray(visibleModules) ? visibleModules : []).forEach((module) => {
      if (!module || typeof module !== 'object' || !normalizeId(module.id)) return;
      const groupId = getModuleGroupId(module, configuredModuleGroups);
      const target = groupMap.get(groupId) || groupMap.get('default');
      target.modules.push(module);
    });

    return Array.from(groupMap.values()).filter((group) => group.modules.length > 0);
  }

  function buildWorkspaceDashboardSection(workspaces, settingsWorkspaces) {
    const getValidWorkspaces = (items) => (Array.isArray(items) ? items : [])
      .filter(hasNonBlankId)
      .map((workspace) => ({ ...workspace, id: normalizeId(workspace.id) }));
    const liveWorkspaces = getValidWorkspaces(workspaces);
    const configuredWorkspaces = liveWorkspaces.length > 0
      ? liveWorkspaces
      : getValidWorkspaces(settingsWorkspaces);
    if (configuredWorkspaces.length === 0) return null;

    return {
      id: 'workspace-orchestration',
      kind: 'workspace',
      name: '工作区编排',
      icon: 'dashboard',
      accent: 'var(--md-secondary)',
      kicker: '场景启动',
      items: configuredWorkspaces,
    };
  }

  window.HubKitWorkspace = {
    mergeWorkspaceOrder,
    getModuleGroupId,
    isWorkspaceModuleSelected,
    buildWorkspaceModuleToggleViewModel,
    buildWorkspaceDashboardDrafts,
    generateWorkspaceId,
    createWorkspaceDraft,
    updateWorkspaceModuleSelection,
    updateWorkspaceMetadataField,
    updateWorkspaceFailurePolicy,
    removeWorkspaceDraft,
    buildWorkspaceCardViewModel,
    buildWorkspaceCardCopy,
    buildWorkspaceCardRuntimeState,
    buildWorkspaceEditorViewModel,
    buildWorkspaceSettingsViewModel,
    buildWorkspaceEditorModulesViewModel,
    buildWorkspacePlanSummaries,
    buildWorkspaceModuleNames,
    buildWorkspaceCardMetrics,
    buildWorkspacePlanLoadingText,
    buildWorkspaceActionButtons,
    buildVisibleModuleGroups,
    buildWorkspaceDashboardSection,
  };
}());

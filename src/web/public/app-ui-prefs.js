(function () {
  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function getDefaultScrimOpacity(resolvedTheme) {
    return resolvedTheme === 'dark' ? 0.55 : 0.35;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function parseUiPrefs(value) {
    if (typeof value === 'string') {
      if (!value.trim()) return {};
      try {
        const parsed = JSON.parse(value);
        return isObject(parsed) ? parsed : {};
      } catch (error) {
        return {};
      }
    }
    return isObject(value) ? value : {};
  }

  function getDefaultUiPrefs(resolvedTheme) {
    return {
      collapseProcessMini: false,
      collapseDashboardGroups: false,
      groupCollapseState: {},
      dashboardRefreshIntervalSeconds: 30,
      wallpaperEnabled: false,
      wallpaperUrl: '',
      wallpaperFit: 'contain',
      wallpaperPositionX: 50,
      wallpaperPositionY: 50,
      wallpaperBlur: 6,
      wallpaperOpacity: 0.92,
      wallpaperScrimOpacity: getDefaultScrimOpacity(resolvedTheme),
      glassBlur: 18,
      glassOpacity: 0.72,
      glassBorderOpacity: 0.34,
      cardSurfaceOpacity: 0.86,
      cardInnerOpacity: 0.72,
    };
  }

  function normalizeUiPrefs(value, resolvedTheme) {
    const parsed = parseUiPrefs(value);
    const defaults = getDefaultUiPrefs(resolvedTheme);
    const blurRaw = Number(parsed.wallpaperBlur);
    const wallpaperBlur = Number.isFinite(blurRaw)
      ? Math.min(24, Math.max(0, blurRaw))
      : defaults.wallpaperBlur;

    return {
      collapseProcessMini: parsed.collapseProcessMini === true,
      collapseDashboardGroups: parsed.collapseDashboardGroups === true,
      groupCollapseState: isObject(parsed.groupCollapseState) ? parsed.groupCollapseState : {},
      dashboardRefreshIntervalSeconds: Math.round(clampNumber(parsed.dashboardRefreshIntervalSeconds, 0, 600, defaults.dashboardRefreshIntervalSeconds)),
      wallpaperEnabled: parsed.wallpaperEnabled === true,
      wallpaperUrl: typeof parsed.wallpaperUrl === 'string' ? parsed.wallpaperUrl : '',
      wallpaperFit: ['contain', 'cover', 'stretch'].includes(parsed.wallpaperFit) ? parsed.wallpaperFit : 'contain',
      wallpaperPositionX: clampNumber(parsed.wallpaperPositionX, 0, 100, defaults.wallpaperPositionX),
      wallpaperPositionY: clampNumber(parsed.wallpaperPositionY, 0, 100, defaults.wallpaperPositionY),
      wallpaperBlur,
      wallpaperOpacity: clampNumber(parsed.wallpaperOpacity, 0.35, 1, defaults.wallpaperOpacity),
      wallpaperScrimOpacity: clampNumber(parsed.wallpaperScrimOpacity, 0, 0.8, defaults.wallpaperScrimOpacity),
      glassBlur: clampNumber(parsed.glassBlur, 0, 36, defaults.glassBlur),
      glassOpacity: clampNumber(parsed.glassOpacity, 0.28, 0.92, defaults.glassOpacity),
      glassBorderOpacity: clampNumber(parsed.glassBorderOpacity, 0.12, 0.65, defaults.glassBorderOpacity),
      cardSurfaceOpacity: clampNumber(parsed.cardSurfaceOpacity, 0.45, 0.96, defaults.cardSurfaceOpacity),
      cardInnerOpacity: clampNumber(parsed.cardInnerOpacity, 0.35, 0.92, defaults.cardInnerOpacity),
    };
  }

  window.HubKitUiPrefs = {
    clampNumber,
    parseUiPrefs,
    getDefaultUiPrefs,
    normalizeUiPrefs,
  };
}());

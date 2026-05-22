export function summarizeConfigChange(previousConfig, nextConfig) {
  return {
    aliases: summarizeList(
      previousConfig.aliases,
      nextConfig.aliases,
      (item) => item.name,
      (item) => normalizeAlias(item),
      (item) => item.name && item.command
    ),
    paths: summarizeList(
      previousConfig.paths,
      nextConfig.paths,
      (item) => item.value,
      (item) => normalizePath(item),
      (item) => item.value
    ),
    env: summarizeList(
      previousConfig.env,
      nextConfig.env,
      (item) => item.key,
      (item) => normalizeEnv(item),
      (item) => item.key
    ),
    ohMyZsh: summarizeOhMyZsh(previousConfig.ohMyZsh, nextConfig.ohMyZsh)
  };
}

export function hasMeaningfulChanges(summary) {
  return [
    ...summary.aliases.added,
    ...summary.aliases.changed,
    ...summary.aliases.removed,
    ...summary.paths.added,
    ...summary.paths.changed,
    ...summary.paths.removed,
    ...summary.env.added,
    ...summary.env.changed,
    ...summary.env.removed,
    ...summary.ohMyZsh.changed
  ].length > 0;
}

function summarizeList(previousItems = [], nextItems = [], keyFor, normalize, include) {
  const previous = toMap(previousItems.filter(include), keyFor, normalize);
  const next = toMap(nextItems.filter(include), keyFor, normalize);
  const added = [];
  const changed = [];
  const removed = [];

  for (const [key, item] of next.entries()) {
    if (!previous.has(key)) {
      added.push(item);
      continue;
    }
    const before = previous.get(key);
    if (JSON.stringify(before) !== JSON.stringify(item)) {
      changed.push({ before, after: item });
    }
  }

  for (const [key, item] of previous.entries()) {
    if (!next.has(key)) {
      removed.push(item);
    }
  }

  return { added, changed, removed };
}

function toMap(items, keyFor, normalize) {
  const map = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (key) {
      map.set(key, normalize(item));
    }
  }
  return map;
}

function normalizeAlias(item) {
  return {
    name: item.name,
    command: item.command,
    enabled: item.enabled !== false,
    category: item.category || '',
    description: item.description || ''
  };
}

function normalizePath(item) {
  return {
    value: item.value,
    position: item.position === 'append' ? 'append' : 'prepend',
    enabled: item.enabled !== false,
    description: item.description || ''
  };
}

function normalizeEnv(item) {
  return {
    key: item.key,
    value: item.value || '',
    exported: item.exported !== false,
    enabled: item.enabled !== false,
    description: item.description || ''
  };
}

function summarizeOhMyZsh(previous = {}, next = {}) {
  const changed = [];
  const beforeTheme = previous.theme?.enabled ? previous.theme.value || '' : '';
  const afterTheme = next.theme?.enabled ? next.theme.value || '' : '';
  if (beforeTheme !== afterTheme) {
    changed.push({ name: '主题', before: beforeTheme || '不由本工具管理', after: afterTheme || '不由本工具管理' });
  }

  const beforePlugins = previous.plugins?.enabled ? (previous.plugins.values || []).join(' ') : '';
  const afterPlugins = next.plugins?.enabled ? (next.plugins.values || []).join(' ') : '';
  if (beforePlugins !== afterPlugins) {
    changed.push({ name: '插件', before: beforePlugins || '不由本工具管理', after: afterPlugins || '不由本工具管理' });
  }

  return { changed };
}

import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getPaths, assertAllowedPath } from './paths.js';

export function createDefaultConfig() {
  return {
    version: 1,
    aliases: [],
    paths: [],
    env: [],
    ohMyZsh: {
      theme: {
        enabled: false,
        value: '',
        description: ''
      },
      plugins: {
        enabled: false,
        values: [],
        description: ''
      }
    },
    updatedAt: null
  };
}

export function withIds(config) {
  const next = structuredClone(config || createDefaultConfig());
  next.version = 1;
  next.aliases = normalizeList(next.aliases).map((item) => ({
    id: item.id || randomUUID(),
    name: String(item.name || '').trim(),
    command: String(item.command || ''),
    description: String(item.description || ''),
    category: String(item.category || ''),
    enabled: item.enabled !== false
  }));
  next.paths = normalizeList(next.paths).map((item) => ({
    id: item.id || randomUUID(),
    value: String(item.value || '').trim(),
    description: String(item.description || ''),
    position: item.position === 'append' ? 'append' : 'prepend',
    enabled: item.enabled !== false
  }));
  next.env = normalizeList(next.env).map((item) => ({
    id: item.id || randomUUID(),
    key: String(item.key || '').trim(),
    value: String(item.value || ''),
    description: String(item.description || ''),
    exported: item.exported !== false,
    enabled: item.enabled !== false
  }));
  next.ohMyZsh = next.ohMyZsh || createDefaultConfig().ohMyZsh;
  next.ohMyZsh.theme = {
    enabled: next.ohMyZsh.theme?.enabled === true,
    value: String(next.ohMyZsh.theme?.value || '').trim(),
    description: String(next.ohMyZsh.theme?.description || '')
  };
  next.ohMyZsh.plugins = {
    enabled: next.ohMyZsh.plugins?.enabled === true,
    values: normalizeList(next.ohMyZsh.plugins?.values).map((plugin) => String(plugin).trim()).filter(Boolean),
    description: String(next.ohMyZsh.plugins?.description || '')
  };
  next.updatedAt = next.updatedAt || null;
  return next;
}

export async function ensureManagedRoot(paths = getPaths()) {
  assertAllowedPath(paths.managedRoot, paths);
  assertAllowedPath(paths.backupsDir, paths);
  await fs.mkdir(paths.backupsDir, { recursive: true });
  await fs.writeFile(
    paths.readmeFile,
    [
      '# zsh-config managed directory',
      '',
      '这个目录由 zsh Config Center 管理。',
      '',
      '- `config.json` 是结构化配置真源。',
      '- `managed.zsh` 是生成给 zsh source 的文件。',
      '- `backups/` 存放保存和恢复前的备份。',
      ''
    ].join('\n'),
    'utf8'
  );
}

export async function loadConfig(paths = getPaths()) {
  assertAllowedPath(paths.configFile, paths);
  try {
    const raw = await fs.readFile(paths.configFile, 'utf8');
    return withIds(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createDefaultConfig();
    }
    throw error;
  }
}

export async function saveConfig(config, paths = getPaths()) {
  await ensureManagedRoot(paths);
  const normalized = withIds(config);
  normalized.updatedAt = new Date().toISOString();
  await fs.writeFile(paths.configFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

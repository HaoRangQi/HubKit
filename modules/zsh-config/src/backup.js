import fs from 'node:fs/promises';
import path from 'node:path';
import { assertAllowedPath, getPaths } from './paths.js';
import { ensureManagedRoot } from './model.js';

export async function createBackup(label = 'manual', paths = getPaths()) {
  await ensureManagedRoot(paths);
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backupDir = path.join(paths.backupsDir, `${stamp}-${safeLabel(label)}`);
  assertAllowedPath(backupDir, paths);
  await fs.mkdir(backupDir, { recursive: true });

  const copied = [];
  for (const source of [paths.zshrc, paths.configFile, paths.managedFile]) {
    try {
      const target = path.join(backupDir, path.basename(source));
      await fs.copyFile(source, target);
      copied.push({ source, target });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return { id: path.basename(backupDir), path: backupDir, copied };
}

export async function listBackups(paths = getPaths()) {
  try {
    const entries = await fs.readdir(paths.backupsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function restoreBackup(id, paths = getPaths()) {
  if (!/^[0-9T-]+Z-[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid backup id.');
  }
  const backupDir = path.join(paths.backupsDir, id);
  assertAllowedPath(backupDir, paths);

  await createBackup('pre-restore', paths);
  const restored = [];
  const candidates = [
    { source: path.join(backupDir, '.zshrc'), target: paths.zshrc },
    { source: path.join(backupDir, 'config.json'), target: paths.configFile },
    { source: path.join(backupDir, 'managed.zsh'), target: paths.managedFile }
  ];

  for (const candidate of candidates) {
    try {
      await fs.copyFile(candidate.source, candidate.target);
      restored.push(candidate.target);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return { id, restored };
}

function safeLabel(label) {
  return String(label || 'manual').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'manual';
}

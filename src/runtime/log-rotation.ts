import { promises as fs } from 'fs';

export interface LogRotationOptions {
  maxBytes?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;

export async function rotateLogIfNeeded(filePath: string, options: LogRotationOptions = {}): Promise<boolean> {
  const maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxFiles = normalizePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES);

  if (maxFiles <= 0) return false;

  const stat = await fs.stat(filePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!stat || stat.size < maxBytes) return false;

  await removeOldestRotation(filePath, maxFiles);
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    await renameIfExists(rotationPath(filePath, index), rotationPath(filePath, index + 1));
  }
  await fs.rename(filePath, rotationPath(filePath, 1));
  await fs.writeFile(filePath, '', 'utf-8');
  return true;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value as number));
}

async function removeOldestRotation(filePath: string, maxFiles: number): Promise<void> {
  await fs.rm(rotationPath(filePath, maxFiles), { force: true });
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function rotationPath(filePath: string, index: number): string {
  return `${filePath}.${index}`;
}

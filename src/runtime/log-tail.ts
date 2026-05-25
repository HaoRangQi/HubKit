import { promises as fs } from 'fs';

const DEFAULT_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 256 * 1024;

export async function readLastLines(filePath: string, lines: number, options: { keepEmptyLines?: boolean } = {}): Promise<string[]> {
  const lineCount = normalizeLineCount(lines);
  if (lineCount === 0) return [];

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (stat.size === 0) return [];

    const chunks: Buffer[] = [];
    let position = stat.size;
    let newlineCount = 0;
    const chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(DEFAULT_CHUNK_SIZE, lineCount * 160));

    while (position > 0 && newlineCount <= lineCount) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, position);
      chunks.unshift(buffer);
      newlineCount += countNewlines(buffer);
    }

    const content = Buffer.concat(chunks).toString('utf-8');
    const allLines = content.split(/\r?\n/);
    if (!options.keepEmptyLines) {
      return allLines.filter((line) => line.trim()).slice(-lineCount);
    }
    return trimTrailingEmptyLines(allLines).slice(-lineCount);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function readLastLinesText(filePath: string, lines: number): Promise<string> {
  return (await readLastLines(filePath, lines, { keepEmptyLines: true })).join('\n');
}

function normalizeLineCount(lines: number): number {
  if (!Number.isFinite(lines)) return 100;
  return Math.max(0, Math.min(2000, Math.floor(lines)));
}

function countNewlines(buffer: Buffer): number {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 10) count += 1;
  }
  return count;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(0, end);
}

import { readLastLines } from './log-tail';

export type LogSearchLevel = 'all' | 'debug' | 'info' | 'warn' | 'error';

export interface LogSearchSource {
  id: string;
  name: string;
  kind: 'module' | 'script' | 'system-action';
  filePath?: string;
  content?: string;
}

export interface LogSearchOptions {
  query?: string;
  level?: LogSearchLevel;
  lines?: number;
  limit?: number;
}

export interface LogSearchResult {
  sourceId: string;
  sourceName: string;
  sourceKind: LogSearchSource['kind'];
  level: Exclude<LogSearchLevel, 'all'>;
  lineNumber: number;
  message: string;
}

export async function searchLogs(sources: LogSearchSource[], options: LogSearchOptions = {}): Promise<LogSearchResult[]> {
  const query = normalizeQuery(options.query);
  const level = normalizeLevel(options.level);
  const lines = normalizeLines(options.lines);
  const limit = normalizeLimit(options.limit);
  const results: LogSearchResult[] = [];

  for (const source of sources) {
    const entries = await readSourceLines(source, lines);
    entries.forEach((line, index) => {
      const message = line.trimEnd();
      if (!message.trim()) return;

      const inferredLevel = inferLogLevel(message);
      if (level !== 'all' && inferredLevel !== level) return;
      if (query && !message.toLowerCase().includes(query)) return;

      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        level: inferredLevel,
        lineNumber: index + 1,
        message,
      });
    });
  }

  return results.slice(-limit).reverse();
}

async function readSourceLines(source: LogSearchSource, lines: number): Promise<string[]> {
  if (typeof source.content === 'string') {
    return trimTrailingEmptyLines(source.content.split(/\r?\n/)).slice(-lines);
  }
  if (!source.filePath) return [];
  return readLastLines(source.filePath, lines, { keepEmptyLines: true });
}

export function inferLogLevel(line: string): Exclude<LogSearchLevel, 'all'> {
  const lower = String(line || '').toLowerCase();
  if (/\b(error|failed|failure|exception|traceback|fatal)\b|失败|异常|错误/.test(lower)) return 'error';
  if (/\b(warn|warning|deprecated)\b|警告/.test(lower)) return 'warn';
  if (/\b(debug|trace|verbose)\b/.test(lower)) return 'debug';
  return 'info';
}

function normalizeQuery(query: string | undefined): string {
  return String(query || '').trim().toLowerCase();
}

function normalizeLevel(level: LogSearchLevel | undefined): LogSearchLevel {
  return ['all', 'debug', 'info', 'warn', 'error'].includes(String(level)) ? level as LogSearchLevel : 'all';
}

function normalizeLines(lines: number | undefined): number {
  const parsed = Number(lines);
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(1, Math.min(2000, Math.floor(parsed)));
}

function normalizeLimit(limit: number | undefined): number {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(0, end);
}

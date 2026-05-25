import { LogSearchLevel } from '../../runtime/log-search';
import { WorkspaceAction } from '../../runtime/module-workspace';

export function getRouteParam(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : '';
}

export function parseLogLineCount(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(2000, Math.floor(parsed)));
}

export function parseLogSearchLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

export function parseLogSearchLevel(value: unknown): LogSearchLevel {
  const raw = Array.isArray(value) ? value[0] : value;
  const level = typeof raw === 'string' ? raw : 'all';
  return ['all', 'debug', 'info', 'warn', 'error'].includes(level) ? level as LogSearchLevel : 'all';
}

export function parseWorkspaceAction(value: unknown): WorkspaceAction {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'stop' ? 'stop' : 'start';
}

export function uniqueRouteStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

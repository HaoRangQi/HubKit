import { Command } from 'commander';
import { createModuleAdapter } from '../../adapters/adapter-factory';
import { ModuleRegistry } from '../../registry/module-registry';
import { LogSearchLevel, LogSearchResult, LogSearchSource, searchLogs } from '../../runtime/log-search';
import { scanAndRegisterModules } from './module-loader';

export interface LogSearchCommandOptions {
  query?: string;
  level?: string;
  lines?: string;
  limit?: string;
  json?: boolean;
}

export interface LogSearchCommandDependencies {
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
  collectSources?: (registry: ModuleRegistry, lines: number) => Promise<LogSearchSource[]>;
  search?: typeof searchLogs;
}

/**
 * log-search 命令 - 跨模块搜索最近日志。
 */
export function registerLogSearchCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: LogSearchCommandDependencies = {},
): void {
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const collectSources = dependencies.collectSources || collectModuleLogSources;
  const search = dependencies.search || searchLogs;

  program
    .command('log-search')
    .description('跨模块搜索最近日志')
    .option('-q, --query <query>', '搜索关键字')
    .option('-l, --level <level>', '日志级别 (all|debug|info|warn|error)', 'all')
    .option('-n, --lines <number>', '每个来源读取的最近行数', '500')
    .option('--limit <number>', '最多返回条数', '100')
    .option('--json', '输出 JSON')
    .action(async (options: LogSearchCommandOptions) => {
      try {
        const lines = parsePositiveIntegerOption(options.lines, 500, 1, 2000, '--lines');
        const limit = parsePositiveIntegerOption(options.limit, 100, 1, 500, '--limit');
        const level = parseLogSearchLevelOption(options.level);

        await scanAndRegister(registry);
        const sources = await collectSources(registry, lines);
        const results = await search(sources, {
          query: options.query,
          level,
          lines,
          limit,
        });

        if (options.json) {
          console.log(JSON.stringify({
            query: options.query || '',
            level,
            scannedSources: sources.length,
            results,
          }, null, 2));
          return;
        }

        console.log(formatLogSearchResults(results, sources.length, {
          query: options.query,
          level,
        }));
      } catch (error) {
        console.error('搜索日志失败:', error);
        process.exit(1);
      }
    });
}

export async function collectModuleLogSources(
  registry: ModuleRegistry,
  lines: number,
): Promise<LogSearchSource[]> {
  return Promise.all(registry.list().map(async (module) => {
    const adapter = createModuleAdapter(module) as any;
    const content = typeof adapter.rawLogs === 'function'
      ? await adapter.rawLogs(lines).catch(() => '')
      : '';
    return {
      id: module.id,
      name: module.name,
      kind: 'module' as const,
      content,
    };
  }));
}

export function parseLogSearchLevelOption(value: string | undefined): LogSearchLevel {
  const level = String(value || 'all');
  if (['all', 'debug', 'info', 'warn', 'error'].includes(level)) {
    return level as LogSearchLevel;
  }
  throw new Error('--level 必须是 all、debug、info、warn 或 error');
}

export function parsePositiveIntegerOption(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== String(value).trim()) {
    throw new Error(`${label} 必须是整数`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${label} 必须在 ${min}-${max} 之间`);
  }
  return parsed;
}

export function formatLogSearchResults(
  results: LogSearchResult[],
  scannedSources: number,
  filters: { query?: string; level: LogSearchLevel },
): string {
  const query = String(filters.query || '').trim();
  const lines = [
    `\n日志搜索结果 (${results.length} 条，扫描 ${scannedSources} 个来源)`,
    `条件: ${query ? `关键字 "${query}"` : '全部关键字'}，级别 ${filters.level}`,
    '',
  ];

  if (results.length === 0) {
    lines.push('未找到匹配日志');
    return lines.join('\n');
  }

  results.forEach((result) => {
    lines.push(`[${result.level}] ${result.sourceName} (${result.sourceId}:${result.lineNumber})`);
    lines.push(`  ${result.message}`);
  });

  return lines.join('\n');
}

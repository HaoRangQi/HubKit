import { Router, Request, Response } from 'express';
import { createModuleAdapter as createAdapter } from '../../adapters/adapter-factory';
import { ModuleRegistry } from '../../registry/module-registry';
import { ScriptBundleManager } from '../../script-bundle/script-bundle-manager';
import { BootPreferenceService } from '../../system-actions/boot-preference-service';
import { LogSearchSource, searchLogs } from '../../runtime/log-search';
import { parseLogLineCount, parseLogSearchLevel, parseLogSearchLimit } from './route-utils';

export interface LogSearchRouterOptions {
  registry: ModuleRegistry;
  scriptBundleManager?: ScriptBundleManager;
  bootPreferenceService?: BootPreferenceService;
}

/**
 * 跨模块、脚本工具箱和系统动作的日志搜索路由。
 */
export function createLogSearchRouter(options: LogSearchRouterOptions): Router {
  const router = Router();
  const { registry, scriptBundleManager, bootPreferenceService } = options;

  router.get('/log-search', async (req: Request, res: Response) => {
    try {
      const modules = registry.list();
      const lines = parseLogLineCount(req.query.lines);
      const limit = parseLogSearchLimit(req.query.limit);
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const level = parseLogSearchLevel(req.query.level);
      const moduleSources = await Promise.all(
        modules.map(async (module) => {
          const adapter = createAdapter(module) as any;
          const content = typeof adapter.rawLogs === 'function'
            ? await adapter.rawLogs(lines).catch(() => '')
            : '';
          return {
            id: module.id,
            name: module.name,
            kind: 'module' as const,
            content,
          };
        })
      );
      const scriptSources = scriptBundleManager
        ? await collectScriptLogSearchSources(scriptBundleManager, lines)
        : [];
      const systemSources = bootPreferenceService
        ? await collectSystemLogSearchSources(bootPreferenceService, lines)
        : [];
      const sources = [...moduleSources, ...scriptSources, ...systemSources];

      const results = await searchLogs(sources, { query, level, lines, limit });
      res.json({
        success: true,
        data: {
          query,
          level,
          scannedSources: sources.length,
          results,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}

export async function collectScriptLogSearchSources(
  scriptBundleManager: ScriptBundleManager,
  lines: number
): Promise<LogSearchSource[]> {
  const sources: LogSearchSource[] = [];
  const bundles = scriptBundleManager.listBundles();

  for (const bundle of bundles) {
    for (const group of bundle.groups || []) {
      for (const action of group.actions || []) {
        const content = await scriptBundleManager
          .getActionLog(bundle.id, action.id, undefined, lines)
          .catch(() => '');
        sources.push({
          id: `${bundle.id}:${action.id}`,
          name: `${bundle.name} / ${action.name}`,
          kind: 'script',
          content,
        });
      }
    }
  }

  return sources;
}

export async function collectSystemLogSearchSources(
  bootPreferenceService: BootPreferenceService,
  lines: number
): Promise<LogSearchSource[]> {
  const content = await bootPreferenceService.getLog(undefined, lines).catch(() => '');
  return [{
    id: 'boot-preference',
    name: '系统调优 / 开盖接电启动',
    kind: 'system-action',
    content,
  }];
}

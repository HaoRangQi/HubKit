import { Router, Request, Response } from 'express';
import { ModuleRegistry } from '../../registry/module-registry';
import { createModuleAdapter as createAdapter } from '../../adapters/adapter-factory';
import {
  collectModuleProcessDiagnostics,
  forceKillProcesses,
  ForceKillResult,
  ModuleProcessDiagnostics,
} from '../../runtime/module-process-diagnostics';
import { requireHighRiskConfirmation } from './high-risk-confirmation';

export interface ModuleAdminRouterOptions {
  registry: ModuleRegistry;
  broadcast: (message: any) => void;
}

/**
 * 模块进程诊断与强制清理路由。
 */
export function createModuleAdminRouter(options: ModuleAdminRouterOptions): Router {
  const router = Router();
  const { registry, broadcast } = options;

  router.get('/modules/:id/diagnostics', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const adapter = createAdapter(module);
      const status = await adapter.status();
      const diagnostics = await collectModuleProcessDiagnostics(module, status.pid ?? null);

      res.json({
        success: true,
        data: {
          moduleId: module.id,
          status: status.status,
          diagnostics,
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post(
    '/modules/:id/force-close',
    requireHighRiskConfirmation((req) => `module:${req.params.id}:force-close`),
    async (req: Request, res: Response) => {
      try {
        const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const module = registry.get(moduleId);
        if (!module) {
          return res.status(404).json({ success: false, error: '模块不存在' });
        }

        const adapter = createAdapter(module);
        let adapterStopError: string | null = null;

        try {
          await adapter.stop(true);
        } catch (error) {
          adapterStopError = error instanceof Error ? error.message : String(error);
        }

        const before = await collectModuleProcessDiagnostics(module, null);
        const pidsToKill = new Set<number>();
        before.pidCandidates.forEach(item => {
          if (item.alive) pidsToKill.add(item.pid);
        });
        before.portListeners.forEach(item => {
          if (item.alive) pidsToKill.add(item.pid);
        });

        const killed = await forceKillProcesses([...pidsToKill]);
        const after = await collectModuleProcessDiagnostics(module, null);

        broadcast({ type: 'module_stopped', moduleId: module.id, forceClosed: true });

        const stillOccupied = after.portOccupied || after.pidCandidates.some(item => item.alive);
        res.json({
          success: !stillOccupied,
          message: stillOccupied ? '强制关闭执行完成，但仍检测到残留进程' : `模块 ${module.name} 已强制关闭`,
          data: {
            moduleId: module.id,
            adapterStopError,
            killed,
            before,
            after,
          },
        });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    }
  );

  router.post(
    '/modules/force-close-all',
    requireHighRiskConfirmation('module:*:force-close-all'),
    async (_req: Request, res: Response) => {
      try {
        const modules = registry.list();
        const results: Array<{
          moduleId: string;
          moduleName: string;
          success: boolean;
          message: string;
          adapterStopError: string | null;
          killed: ForceKillResult[];
          before: ModuleProcessDiagnostics;
          after: ModuleProcessDiagnostics;
        }> = [];

        for (const module of modules) {
          const adapter = createAdapter(module);
          let adapterStopError: string | null = null;

          try {
            await adapter.stop(true);
          } catch (error) {
            adapterStopError = error instanceof Error ? error.message : String(error);
          }

          const before = await collectModuleProcessDiagnostics(module, null);
          const pidsToKill = new Set<number>();
          before.pidCandidates.forEach(item => {
            if (item.alive) pidsToKill.add(item.pid);
          });
          before.portListeners.forEach(item => {
            if (item.alive) pidsToKill.add(item.pid);
          });

          const killed = await forceKillProcesses([...pidsToKill]);
          const after = await collectModuleProcessDiagnostics(module, null);
          const stillOccupied = after.portOccupied || after.pidCandidates.some(item => item.alive);
          const message = stillOccupied ? '仍检测到残留' : '已清理';

          results.push({
            moduleId: module.id,
            moduleName: module.name,
            success: !stillOccupied,
            message,
            adapterStopError,
            killed,
            before,
            after,
          });

          broadcast({ type: 'module_stopped', moduleId: module.id, forceClosed: true, byBatch: true });
        }

        const failed = results.filter(item => !item.success);
        const successCount = results.length - failed.length;
        const overallSuccess = failed.length === 0;

        res.json({
          success: overallSuccess,
          message: overallSuccess
            ? `全部模块关停完成，已清理 ${successCount}/${results.length}`
            : `全部关停已执行，${failed.length} 个模块仍有残留进程/端口`,
          data: {
            total: results.length,
            successCount,
            failedCount: failed.length,
            results,
          },
        });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    }
  );

  return router;
}

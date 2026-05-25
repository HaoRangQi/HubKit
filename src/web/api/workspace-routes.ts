import { Router, Request, Response } from 'express';
import { ModuleWorkspace, config } from '../../config/config';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleLifecycle } from '../../runtime/module-lifecycle';
import { ModuleWorkspaceRunner, WorkspaceAction } from '../../runtime/module-workspace';
import { getRouteParam, parseWorkspaceAction, uniqueRouteStrings } from './route-utils';
import { requireHighRiskConfirmation } from './high-risk-confirmation';

export interface WorkspaceRouterOptions {
  registry: ModuleRegistry;
  lifecycle: ModuleLifecycle;
  broadcast: (message: any) => void;
}

/**
 * 场景级工作区编排路由。
 */
export function createWorkspaceRouter(options: WorkspaceRouterOptions): Router {
  const router = Router();
  const workspaceRunner = new ModuleWorkspaceRunner(options.registry, options.lifecycle);
  const broadcast = options.broadcast;

  router.get('/workspaces', (_req: Request, res: Response) => {
    try {
      const workspaces = config.getSettings().workspaces;
      res.json({ success: true, data: workspaces });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post('/workspaces', (req: Request, res: Response) => {
    try {
      const workspace = parseWorkspacePayload(req.body);
      const settings = config.getSettings();
      if (settings.workspaces.some((item) => item.id === workspace.id)) {
        return res.status(409).json({ success: false, error: '工作区 ID 已存在' });
      }

      config.updateSettings({ workspaces: [...settings.workspaces, workspace] });
      res.status(201).json({
        success: true,
        message: '工作区已创建',
        data: getWorkspaceFromSettings(workspace.id),
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/workspaces/:workspaceId', (req: Request, res: Response) => {
    try {
      const workspace = getWorkspaceFromSettings(req.params.workspaceId);
      if (!workspace) {
        return res.status(404).json({ success: false, error: '工作区不存在' });
      }
      res.json({ success: true, data: workspace });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.put('/workspaces/:workspaceId', (req: Request, res: Response) => {
    try {
      const workspaceId = getRouteParam(req.params.workspaceId);
      const workspace = parseWorkspacePayload({ ...req.body, id: workspaceId });
      const settings = config.getSettings();
      const index = settings.workspaces.findIndex((item) => item.id === workspaceId);
      if (index === -1) {
        return res.status(404).json({ success: false, error: '工作区不存在' });
      }

      const nextWorkspaces = [...settings.workspaces];
      nextWorkspaces[index] = workspace;
      config.updateSettings({ workspaces: nextWorkspaces });
      res.json({
        success: true,
        message: '工作区已更新',
        data: getWorkspaceFromSettings(workspaceId),
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/workspaces/:workspaceId', (req: Request, res: Response) => {
    try {
      const workspaceId = getRouteParam(req.params.workspaceId);
      const settings = config.getSettings();
      const nextWorkspaces = settings.workspaces.filter((workspace) => workspace.id !== workspaceId);
      if (nextWorkspaces.length === settings.workspaces.length) {
        return res.status(404).json({ success: false, error: '工作区不存在' });
      }

      config.updateSettings({ workspaces: nextWorkspaces });
      res.json({
        success: true,
        message: '工作区已删除',
        data: nextWorkspaces,
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/workspaces/:workspaceId/plan', (req: Request, res: Response) => {
    try {
      const workspace = getWorkspaceFromSettings(req.params.workspaceId);
      if (!workspace) {
        return res.status(404).json({ success: false, error: '工作区不存在' });
      }

      const action = parseWorkspaceAction(req.query.action);
      res.json({
        success: true,
        data: workspaceRunner.buildPlan(workspace, action),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post('/workspaces/:workspaceId/start', async (req: Request, res: Response) => {
    await runWorkspaceAction(req, res, 'start');
  });

  router.post(
    '/workspaces/:workspaceId/stop',
    requireHighRiskConfirmation((req) => `workspace:${req.params.workspaceId}:stop`),
    async (req: Request, res: Response) => {
      await runWorkspaceAction(req, res, 'stop');
    }
  );

  async function runWorkspaceAction(req: Request, res: Response, action: WorkspaceAction): Promise<void> {
    try {
      const workspace = getWorkspaceFromSettings(req.params.workspaceId);
      if (!workspace) {
        res.status(404).json({ success: false, error: '工作区不存在' });
        return;
      }

      const result = await workspaceRunner.run(workspace, action);
      result.steps
        .filter((step) => step.result === 'succeeded')
        .forEach((step) => {
          broadcast({
            type: action === 'start' ? 'module_started' : 'module_stopped',
            moduleId: step.moduleId,
            byWorkspace: true,
            workspaceId: workspace.id,
          });
        });
      broadcast({
        type: action === 'start' ? 'workspace_started' : 'workspace_stopped',
        workspaceId: workspace.id,
        success: result.success,
      });

      res.json({
        success: result.success,
        message: result.success
          ? `工作区 ${workspace.name} 已${action === 'start' ? '启动' : '停止'}`
          : `工作区 ${workspace.name} ${action === 'start' ? '启动' : '停止'}未完全成功`,
        data: result,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  }

  return router;
}

function parseWorkspacePayload(input: any): ModuleWorkspace {
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('工作区 ID 只能包含字母、数字、下划线和短横线');
  }
  if (!name) {
    throw new Error('工作区名称不能为空');
  }

  return {
    id,
    name,
    description: typeof input?.description === 'string' ? input.description.trim() : undefined,
    moduleIds: uniqueRouteStrings(input?.moduleIds),
    startOrder: uniqueRouteStrings(input?.startOrder),
    stopOrder: uniqueRouteStrings(input?.stopOrder),
    failurePolicy: input?.failurePolicy === 'continue' ? 'continue' : 'stop',
  };
}

function getWorkspaceFromSettings(workspaceIdParam: unknown): ModuleWorkspace | undefined {
  const workspaceId = getRouteParam(workspaceIdParam);
  if (!workspaceId) return undefined;
  return config.getSettings().workspaces.find((workspace) => workspace.id === workspaceId);
}

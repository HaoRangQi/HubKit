import { Router, Request, Response } from 'express';
import { ScriptBundleManager } from '../../script-bundle/script-bundle-manager';
import { parseLogLineCount } from './route-utils';
import { requireHighRiskConfirmation } from './high-risk-confirmation';

export interface ScriptBundleRouterOptions {
  scriptBundleManager?: ScriptBundleManager;
}

/**
 * 脚本工具箱与 Web 终端路由。
 */
export function createScriptBundleRouter(options: ScriptBundleRouterOptions): Router {
  const router = Router();
  const { scriptBundleManager } = options;

  router.get('/script-bundles', async (_req: Request, res: Response) => {
    try {
      if (!scriptBundleManager) {
        return res.json({ success: true, data: [] });
      }
      res.json({ success: true, data: scriptBundleManager.listBundles() });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post(
    '/script-bundles/:bundleId/actions/:actionId/run',
    requireHighRiskConfirmation((req) => `script-bundle:${req.params.bundleId}:${req.params.actionId}:run`),
    async (req: Request, res: Response) => {
      try {
        if (!scriptBundleManager) {
          return res.status(404).json({ success: false, error: '脚本工具箱未启用' });
        }

        const bundleId = Array.isArray(req.params.bundleId) ? req.params.bundleId[0] : req.params.bundleId;
        const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
        const result = await scriptBundleManager.runAction(bundleId, actionId);

        res.json({
          success: true,
          message: result.message,
          data: result.record,
        });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    }
  );

  router.post(
    '/script-bundles/:bundleId/actions/:actionId/web-terminal',
    requireHighRiskConfirmation((req) => `script-bundle:${req.params.bundleId}:${req.params.actionId}:web-terminal`),
    async (req: Request, res: Response) => {
      try {
        if (!scriptBundleManager) {
          return res.status(404).json({ success: false, error: '脚本工具箱未启用' });
        }

        const bundleId = Array.isArray(req.params.bundleId) ? req.params.bundleId[0] : req.params.bundleId;
        const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
        const cols = typeof req.body?.cols === 'number' ? req.body.cols : undefined;
        const rows = typeof req.body?.rows === 'number' ? req.body.rows : undefined;
        const result = await scriptBundleManager.runActionInWebTerminal(bundleId, actionId, cols, rows);

        res.json({
          success: true,
          message: result.message,
          data: {
            session: result.session,
            record: result.record,
          },
        });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    }
  );

  router.get('/script-bundles/:bundleId/actions/:actionId/history', async (req: Request, res: Response) => {
    try {
      if (!scriptBundleManager) {
        return res.status(404).json({ success: false, error: '脚本工具箱未启用' });
      }

      const bundleId = Array.isArray(req.params.bundleId) ? req.params.bundleId[0] : req.params.bundleId;
      const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
      const history = await scriptBundleManager.getActionHistory(bundleId, actionId);
      res.json({ success: true, data: history });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/script-bundles/:bundleId/actions/:actionId/logs', async (req: Request, res: Response) => {
    try {
      if (!scriptBundleManager) {
        return res.status(404).json({ success: false, error: '脚本工具箱未启用' });
      }

      const bundleId = Array.isArray(req.params.bundleId) ? req.params.bundleId[0] : req.params.bundleId;
      const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const lines = parseLogLineCount(req.query.lines);
      const raw = await scriptBundleManager.getActionLog(bundleId, actionId, runId, lines);
      res.json({ success: true, data: raw });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post(
    '/terminal-sessions/:sessionId/kill',
    requireHighRiskConfirmation((req) => `terminal-session:${req.params.sessionId}:kill`),
    async (req: Request, res: Response) => {
      try {
        if (!scriptBundleManager) {
          return res.status(404).json({ success: false, error: '脚本工具箱未启用' });
        }

        const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
        const killed = scriptBundleManager.killTerminalSession(sessionId);
        if (!killed) {
          return res.status(404).json({ success: false, error: '终端会话不存在或已结束' });
        }
        res.json({ success: true, message: '终端会话已停止' });
      } catch (error) {
        res.status(500).json({ success: false, error: String(error) });
      }
    }
  );

  return router;
}

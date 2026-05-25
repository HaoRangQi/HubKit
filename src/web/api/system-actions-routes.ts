import { Router, Request, Response } from 'express';
import { BootPreferenceService } from '../../system-actions/boot-preference-service';
import { parseLogLineCount } from './route-utils';
import { requireHighRiskConfirmation } from './high-risk-confirmation';

export interface SystemActionsRouterOptions {
  bootPreferenceService?: BootPreferenceService;
}

/**
 * 系统调优与原生动作路由。
 */
export function createSystemActionsRouter(options: SystemActionsRouterOptions): Router {
  const router = Router();
  const { bootPreferenceService } = options;

  router.get('/system-actions', async (_req: Request, res: Response) => {
    try {
      if (!bootPreferenceService) {
        return res.json({ success: true, data: [] });
      }
      const actions = await bootPreferenceService.listActions();
      res.json({ success: true, data: actions });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post(
    '/system-actions/boot-preference/apply',
    requireHighRiskConfirmation((req) => `system-action:boot-preference:${req.body?.mode || 'unknown'}:apply`),
    async (req: Request, res: Response) => {
      try {
        if (!bootPreferenceService) {
          return res.status(404).json({ success: false, error: '系统调优未启用' });
        }

        const mode = typeof req.body?.mode === 'string' ? req.body.mode : '';
        const result = await bootPreferenceService.applyMode(mode as any);
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

  router.get('/system-actions/boot-preference/history', async (_req: Request, res: Response) => {
    try {
      if (!bootPreferenceService) {
        return res.status(404).json({ success: false, error: '系统调优未启用' });
      }

      const history = await bootPreferenceService.getHistory();
      res.json({ success: true, data: history });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/system-actions/boot-preference/logs', async (req: Request, res: Response) => {
    try {
      if (!bootPreferenceService) {
        return res.status(404).json({ success: false, error: '系统调优未启用' });
      }

      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const lines = parseLogLineCount(req.query.lines);
      const raw = await bootPreferenceService.getLog(runId, lines);
      res.json({ success: true, data: raw });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}

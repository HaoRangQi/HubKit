import { Router, Request, Response } from 'express';
import { config } from '../../config/config';
import { normalizeStartPolicy } from '../../runtime/module-start-policy';
import { requireHighRiskConfirmation } from './high-risk-confirmation';

/**
 * 运行设置与配置备份路由。
 */
export function createSettingsRouter(): Router {
  const router = Router();

  router.get('/settings', (_req: Request, res: Response) => {
    try {
      const settings = config.getSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.post('/settings', (req: Request, res: Response) => {
    try {
      const { autoStart, startOrder } = req.body;
      const { groups, moduleGroups, workspaces } = req.body;
      const startPolicies = typeof req.body?.startPolicies === 'object' && req.body.startPolicies
        ? Object.fromEntries(
            Object.entries(req.body.startPolicies).map(([moduleId, policy]) => [moduleId, normalizeStartPolicy(policy as any)])
          )
        : undefined;
      const groupStartPolicyTemplates = typeof req.body?.groupStartPolicyTemplates === 'object' && req.body.groupStartPolicyTemplates
        ? Object.fromEntries(
            Object.entries(req.body.groupStartPolicyTemplates)
              .filter(([, templateId]) => typeof templateId === 'string' && templateId.trim() !== '')
              .map(([groupId, templateId]) => [groupId, String(templateId)])
          )
        : undefined;
      config.updateSettings({ autoStart, startOrder, groups, moduleGroups, startPolicies, groupStartPolicyTemplates, workspaces });
      res.json({ success: true, message: '设置已保存' });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/config/backups', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: config.listBackups(20) });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/config/backups/:backupId/preview', (req: Request, res: Response) => {
    try {
      const backupId = Array.isArray(req.params.backupId) ? req.params.backupId[0] : req.params.backupId;
      res.json({ success: true, data: config.previewRestoreBackup(backupId) });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post(
    '/config/backups/:backupId/restore',
    requireHighRiskConfirmation((req) => `config-backup:${req.params.backupId}:restore`),
    (req: Request, res: Response) => {
      try {
        const backupId = Array.isArray(req.params.backupId) ? req.params.backupId[0] : req.params.backupId;
        const restored = config.restoreBackup(backupId);
        res.json({
          success: true,
          message: '配置已恢复',
          data: {
            configVersion: restored.configVersion,
            settings: config.getSettings(),
            backups: config.listBackups(20),
          },
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  return router;
}

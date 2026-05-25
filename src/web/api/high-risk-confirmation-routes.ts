import { Router, Request, Response } from 'express';
import { highRiskConfirmationStore, isAllowedHighRiskAction } from './high-risk-confirmation';

export function createHighRiskConfirmationRouter(): Router {
  const router = Router();

  router.post('/high-risk-confirmations', (req: Request, res: Response) => {
    const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
    if (!action) {
      res.status(400).json({ success: false, error: '高风险操作 ID 不能为空' });
      return;
    }
    if (!isAllowedHighRiskAction(action)) {
      res.status(400).json({ success: false, error: '不支持的高风险操作 ID' });
      return;
    }

    const ticket = highRiskConfirmationStore.issue(action);
    res.status(201).json({ success: true, data: ticket });
  });

  return router;
}

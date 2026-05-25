import { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'crypto';

export const HIGH_RISK_CONFIRMATION_HEADER = 'x-hubkit-high-risk-confirmation';
export const HIGH_RISK_CONFIRMATION_TOKEN_HEADER = 'x-hubkit-high-risk-token';
const DEFAULT_TTL_MS = 60_000;
const SAFE_ID_PATTERN = '[A-Za-z0-9_-]+';
const CONFIG_BACKUP_ID_PATTERN = 'config-[0-9TZ-]+(?:-\\d+)?\\.json';
const HIGH_RISK_ACTION_PATTERNS = [
  new RegExp(`^module:${SAFE_ID_PATTERN}:force-close$`),
  new RegExp(`^module:${SAFE_ID_PATTERN}:update$`),
  /^module:\*:force-close-all$/,
  new RegExp(`^script-bundle:${SAFE_ID_PATTERN}:${SAFE_ID_PATTERN}:run$`),
  new RegExp(`^script-bundle:${SAFE_ID_PATTERN}:${SAFE_ID_PATTERN}:web-terminal$`),
  new RegExp(`^terminal-session:${SAFE_ID_PATTERN}:kill$`),
  new RegExp(`^workspace:${SAFE_ID_PATTERN}:stop$`),
  new RegExp(`^config-backup:${CONFIG_BACKUP_ID_PATTERN}:restore$`),
  /^system-action:boot-preference:(default|block_all|block_lid|block_power):apply$/,
];

type HighRiskActionResolver = string | ((req: Request) => string);

export interface HighRiskConfirmationTicket {
  action: string;
  token: string;
  expiresAt: string;
}

interface StoredTicket {
  action: string;
  expiresAtMs: number;
}

export class HighRiskConfirmationStore {
  private readonly tickets = new Map<string, StoredTicket>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(action: string): HighRiskConfirmationTicket {
    const normalizedAction = normalizeAction(action);
    if (!normalizedAction) {
      throw new Error('高风险操作 ID 不能为空');
    }
    if (!isAllowedHighRiskAction(normalizedAction)) {
      throw new Error('不支持的高风险操作 ID');
    }

    this.pruneExpired();
    const token = randomBytes(18).toString('base64url');
    const expiresAtMs = this.now() + this.ttlMs;
    this.tickets.set(token, { action: normalizedAction, expiresAtMs });
    return {
      action: normalizedAction,
      token,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  consume(action: string, token: string | undefined): boolean {
    const normalizedAction = normalizeAction(action);
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    if (!normalizedAction || !normalizedToken) return false;

    const ticket = this.tickets.get(normalizedToken);
    if (!ticket) return false;

    if (ticket.expiresAtMs <= this.now()) {
      this.tickets.delete(normalizedToken);
      return false;
    }

    if (ticket.action !== normalizedAction) {
      return false;
    }

    this.tickets.delete(normalizedToken);
    return true;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, ticket] of this.tickets.entries()) {
      if (ticket.expiresAtMs <= now) {
        this.tickets.delete(token);
      }
    }
  }
}

export const highRiskConfirmationStore = new HighRiskConfirmationStore();

export function isAllowedHighRiskAction(action: string | undefined): boolean {
  const normalizedAction = normalizeAction(action);
  return Boolean(normalizedAction && HIGH_RISK_ACTION_PATTERNS.some((pattern) => pattern.test(normalizedAction)));
}

export function requireHighRiskConfirmation(action: HighRiskActionResolver) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = typeof action === 'function' ? action(req) : action;
    const provided = req.get(HIGH_RISK_CONFIRMATION_HEADER);
    const token = req.get(HIGH_RISK_CONFIRMATION_TOKEN_HEADER);

    if (provided !== expected || !highRiskConfirmationStore.consume(expected, token)) {
      res.status(428).json({
        success: false,
        error: '需要高风险操作确认',
        confirmationRequired: true,
        confirmationAction: expected,
      });
      return;
    }

    next();
  };
}

function normalizeAction(action: string | undefined): string {
  return typeof action === 'string' ? action.trim() : '';
}

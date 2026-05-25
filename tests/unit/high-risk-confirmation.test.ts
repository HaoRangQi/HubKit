import {
  HIGH_RISK_CONFIRMATION_HEADER,
  HIGH_RISK_CONFIRMATION_TOKEN_HEADER,
  HighRiskConfirmationStore,
  highRiskConfirmationStore,
  isAllowedHighRiskAction,
  requireHighRiskConfirmation,
} from '../../src/web/api/high-risk-confirmation';

describe('high risk confirmation middleware', () => {
  it('rejects high-risk requests without the matching server-side confirmation header', () => {
    const middleware = requireHighRiskConfirmation('danger:run');
    const req = {
      get: jest.fn(() => undefined),
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(req.get).toHaveBeenCalledWith(HIGH_RISK_CONFIRMATION_HEADER);
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '需要高风险操作确认',
      confirmationRequired: true,
      confirmationAction: 'danger:run',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects matching action headers without a one-time confirmation token', () => {
    const middleware = requireHighRiskConfirmation((req) => `script:${req.params.id}:run`);
    const req = {
      params: { id: 'alpha' },
      get: jest.fn(() => 'script:alpha:run'),
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(428);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows high-risk requests with matching action header and one-time token', () => {
    const action = 'script-bundle:tools:cleanup:run';
    const ticket = highRiskConfirmationStore.issue(action);
    const middleware = requireHighRiskConfirmation((req) => `script-bundle:${req.params.bundleId}:${req.params.actionId}:run`);
    const req = {
      params: { bundleId: 'tools', actionId: 'cleanup' },
      get: jest.fn((name: string) => {
        if (name === HIGH_RISK_CONFIRMATION_HEADER) return action;
        if (name === HIGH_RISK_CONFIRMATION_TOKEN_HEADER) return ticket.token;
        return undefined;
      }),
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('issues one-time confirmation tickets for a specific action', () => {
    let now = 1000;
    const store = new HighRiskConfirmationStore(60_000, () => now);
    const ticket = store.issue('module:demo:update');

    expect(ticket.action).toBe('module:demo:update');
    expect(ticket.token).toEqual(expect.any(String));
    expect(store.consume('module:demo:update', ticket.token)).toBe(true);
    expect(store.consume('module:demo:update', ticket.token)).toBe(false);
  });

  it('rejects expired or mismatched confirmation tickets', () => {
    let now = 1000;
    const store = new HighRiskConfirmationStore(100, () => now);
    const ticket = store.issue('module:demo:update');

    expect(store.consume('module:other:update', ticket.token)).toBe(false);
    now = 1200;
    expect(store.consume('module:demo:update', ticket.token)).toBe(false);
  });

  it('rejects issuing tickets for unsupported high-risk action ids', () => {
    const store = new HighRiskConfirmationStore();

    expect(() => store.issue('danger:run')).toThrow('不支持的高风险操作 ID');
  });

  it('documents the server-side high-risk action allowlist', () => {
    expect(isAllowedHighRiskAction('module:demo:force-close')).toBe(true);
    expect(isAllowedHighRiskAction('module:demo:update')).toBe(true);
    expect(isAllowedHighRiskAction('module:*:force-close-all')).toBe(true);
    expect(isAllowedHighRiskAction('script-bundle:tools:cleanup:run')).toBe(true);
    expect(isAllowedHighRiskAction('script-bundle:tools:cleanup:web-terminal')).toBe(true);
    expect(isAllowedHighRiskAction('terminal-session:term-abc123:kill')).toBe(true);
    expect(isAllowedHighRiskAction('workspace:daily-dev:stop')).toBe(true);
    expect(isAllowedHighRiskAction('config-backup:config-2026-05-24T12-00-00-000Z.json:restore')).toBe(true);
    expect(isAllowedHighRiskAction('system-action:boot-preference:block_all:apply')).toBe(true);
    expect(isAllowedHighRiskAction('system-action:boot-preference:unknown:apply')).toBe(false);
    expect(isAllowedHighRiskAction('module:../demo:update')).toBe(false);
    expect(isAllowedHighRiskAction('danger:run')).toBe(false);
  });

  it('documents the token header used by clients', () => {
    expect(HIGH_RISK_CONFIRMATION_TOKEN_HEADER).toBe('x-hubkit-high-risk-token');
  });
});

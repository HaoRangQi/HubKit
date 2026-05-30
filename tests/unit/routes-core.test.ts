import { WebSocketServer } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata, ModuleStatus } from '../../src/types/module';
import { createApiRouter } from '../../src/web/api/routes';
import * as adapterFactory from '../../src/adapters/adapter-factory';
import * as moduleEnvironment from '../../src/runtime/module-environment';
import * as processDiagnostics from '../../src/runtime/module-process-diagnostics';

const mockSettings: any = {
  autoStart: {},
  startOrder: [],
  moduleWebUrls: { demo: 'http://custom.local:3000' },
  visibility: { demo: false },
  schedules: {},
  groups: [{ id: 'default', name: '默认分组' }],
  moduleGroups: { demo: 'default' },
  startPolicies: {},
  groupStartPolicyTemplates: {},
  workspaces: [],
  workspaceHistory: [],
  workspaceHistoryLimit: 20,
};

jest.mock('../../src/config/config', () => ({
  config: {
    getSettings: jest.fn(() => mockSettings),
    getModuleWebUrl: jest.fn((_moduleId: string, _fallback?: string) => 'http://custom.local:3000'),
    setModuleWebUrl: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

jest.mock('../../src/adapters/adapter-factory', () => ({
  createModuleAdapter: jest.fn(() => ({
    rawLogs: jest.fn().mockResolvedValue('line 1\nline 2'),
  })),
}));

jest.mock('../../src/runtime/module-environment', () => ({
  inspectModuleEnvironment: jest.fn(),
  sanitizeEnvironmentReportForDisplay: jest.fn((report) => ({
    ...report,
    requiredEnvVars: [],
    missingEnvVars: report.missingEnvVars,
  })),
}));

jest.mock('../../src/runtime/module-process-diagnostics', () => ({
  collectModuleProcessDiagnostics: jest.fn(),
}));

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo Module',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    webUrl: 'http://fallback.local:3000',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

function createLifecycle(overrides: Record<string, jest.Mock> = {}) {
  return {
    inspect: jest.fn().mockResolvedValue({
      status: {
        status: ModuleStatus.RUNNING,
        pid: 123,
        uptime: 60,
      },
      startReadiness: {
        ready: true,
        actionLabel: '启动',
        summary: '可直接启动',
      },
      runtimeState: {
        phase: 'running',
        summary: '运行中',
      },
    }),
    start: jest.fn().mockResolvedValue({
      preparation: null,
      runtimeState: { phase: 'running', summary: '运行中' },
    }),
    stop: jest.fn().mockResolvedValue({
      runtimeState: { phase: 'stopped', summary: '已停止' },
    }),
    restart: jest.fn().mockResolvedValue({
      runtimeState: { phase: 'running', summary: '已重启' },
    }),
    ...overrides,
  };
}

async function requestApiRouter({
  registry,
  lifecycle = createLifecycle(),
  scheduler,
  method,
  pathname,
  body = {},
  query = {},
  wss,
}: {
  registry: ModuleRegistry;
  lifecycle?: ReturnType<typeof createLifecycle>;
  scheduler?: any;
  method: string;
  pathname: string;
  body?: unknown;
  query?: Record<string, unknown>;
  wss?: WebSocketServer;
}): Promise<{ status: number; body: any; lifecycle: ReturnType<typeof createLifecycle>; wss: WebSocketServer }> {
  const activeWss = wss || ({ clients: new Set() } as unknown as WebSocketServer);
  const router = createApiRouter(
    registry,
    activeWss,
    undefined,
    undefined,
    scheduler,
    lifecycle as any
  ) as any;

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method,
      url: pathname,
      originalUrl: pathname,
      headers: {},
      body,
      query,
      get: jest.fn(() => undefined),
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(responseBody: any) {
        resolve({ status: statusCode, body: responseBody, lifecycle, wss: activeWss });
        return this;
      },
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };

    router.handle(req as any, res as any, (error?: any) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ status: 404, body: undefined, lifecycle, wss: activeWss });
    });
  });
}

describe('core API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings.visibility = { demo: false };
    mockSettings.schedules = {};
    jest.mocked(moduleEnvironment.inspectModuleEnvironment).mockResolvedValue({
      runtime: 'node',
      packageManager: 'npm',
      engineRequirement: undefined,
      detectedEnvFiles: [],
      requiredCommands: ['node'],
      missingCommands: [],
      requiredEnvVars: [],
      requiredEnvVarCount: 0,
      missingEnvVars: [],
      commandChecks: [{ command: 'node', installed: true }],
    });
    jest.mocked(processDiagnostics.collectModuleProcessDiagnostics).mockResolvedValue({
      pidFromStatus: null,
      pidFromPidFile: null,
      pidCandidates: [],
      port: null,
      portOccupied: false,
      portListeners: [],
      checkedAt: '2026-05-30T00:00:00.000Z',
    });
  });

  it('lists modules with lifecycle status, visibility, group, policy, and schedule metadata', async () => {
    const registry = new ModuleRegistry();
    const module = createModule();
    const scheduler = {
      getScheduleStatus: jest.fn().mockReturnValue({ enabled: false, nextAction: null, lastResult: null }),
    };
    registry.register(module);

    const response = await requestApiRouter({
      registry,
      scheduler,
      method: 'GET',
      pathname: '/modules',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'demo',
        webUrl: 'http://custom.local:3000',
        visible: false,
        groupId: 'default',
        inheritedTemplateId: 'balanced',
        status: ModuleStatus.RUNNING,
        pid: 123,
      }),
    ]);
    expect(response.lifecycle.inspect).toHaveBeenCalledWith(module);
    expect(scheduler.getScheduleStatus).toHaveBeenCalledWith('demo', undefined);
  });

  it('returns details for an existing module and 404 for a missing module', async () => {
    const registry = new ModuleRegistry();
    registry.register(createModule());

    const found = await requestApiRouter({ registry, method: 'GET', pathname: '/modules/demo' });
    const missing = await requestApiRouter({ registry, method: 'GET', pathname: '/modules/missing' });

    expect(found.status).toBe(200);
    expect(found.body.data).toEqual(expect.objectContaining({
      id: 'demo',
      webUrl: 'http://custom.local:3000',
      status: ModuleStatus.RUNNING,
      startReadiness: expect.objectContaining({ ready: true }),
    }));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, error: '模块不存在' });
  });

  it('starts modules and broadcasts status updates to open WebSocket clients', async () => {
    const registry = new ModuleRegistry();
    const module = createModule();
    const send = jest.fn();
    const wss = { clients: new Set([{ readyState: 1, send }]) } as unknown as WebSocketServer;
    registry.register(module);

    const response = await requestApiRouter({
      registry,
      wss,
      method: 'POST',
      pathname: '/modules/demo/start',
    });

    expect(response.status).toBe(200);
    expect(response.lifecycle.start).toHaveBeenCalledWith(module);
    expect(response.body.message).toBe('模块 Demo Module 已启动');
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'module_started', moduleId: 'demo' }));
  });

  it('stops and restarts modules through lifecycle without accepting force on the ordinary stop route', async () => {
    const registry = new ModuleRegistry();
    const module = createModule();
    registry.register(module);

    const forceStop = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/stop',
      body: { force: true },
    });
    const stop = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/stop',
      body: { force: false },
    });
    const restart = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/restart',
    });

    expect(forceStop.status).toBe(400);
    expect(forceStop.body.error).toBe('强制停止请使用强制关闭接口');
    expect(stop.status).toBe(200);
    expect(stop.lifecycle.stop).toHaveBeenCalledWith(module, false);
    expect(restart.status).toBe(200);
    expect(restart.lifecycle.restart).toHaveBeenCalledWith(module);
  });

  it('returns raw module logs using bounded line count parsing', async () => {
    const registry = new ModuleRegistry();
    registry.register(createModule());

    const response = await requestApiRouter({
      registry,
      method: 'GET',
      pathname: '/modules/demo/logs',
      query: { lines: '5' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: 'line 1\nline 2' });
  });

  it('validates and stores module web URL changes', async () => {
    const { config } = require('../../src/config/config');
    const registry = new ModuleRegistry();
    registry.register(createModule());

    const invalid = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/web-url',
      body: { url: 123 },
    });
    const valid = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/web-url',
      body: { url: 'http://localhost:3000' },
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('url 参数无效');
    expect(valid.status).toBe(200);
    expect(config.setModuleWebUrl).toHaveBeenCalledWith('demo', 'http://localhost:3000');
  });

  it('validates and stores visibility changes', async () => {
    const { config } = require('../../src/config/config');
    const registry = new ModuleRegistry();
    registry.register(createModule());

    const invalid = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/visibility',
      body: { visible: 'yes' },
    });
    const valid = await requestApiRouter({
      registry,
      method: 'POST',
      pathname: '/modules/demo/visibility',
      body: { visible: true },
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('visible 参数必须为布尔值');
    expect(valid.status).toBe(200);
    expect(config.updateSettings).toHaveBeenCalledWith({ visibility: { demo: true } });
  });

  it('validates and stores module schedules', async () => {
    const { config } = require('../../src/config/config');
    const registry = new ModuleRegistry();
    const scheduler = {
      getScheduleStatus: jest.fn().mockReturnValue({ enabled: true, nextAction: null, lastResult: null }),
    };
    registry.register(createModule());

    const invalid = await requestApiRouter({
      registry,
      scheduler,
      method: 'POST',
      pathname: '/modules/demo/schedule',
      body: { startTime: '25:00' },
    });
    const valid = await requestApiRouter({
      registry,
      scheduler,
      method: 'POST',
      pathname: '/modules/demo/schedule',
      body: { enabled: true, startTime: '09:00', stopTime: '18:00', daysOfWeek: [1, 2] },
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('startTime 格式应为 HH:MM');
    expect(valid.status).toBe(200);
    expect(config.updateSettings).toHaveBeenCalledWith({
      schedules: {
        demo: {
          enabled: true,
          startTime: '09:00',
          stopTime: '18:00',
          daysOfWeek: [1, 2],
        },
      },
    });
    expect(scheduler.getScheduleStatus).toHaveBeenCalledWith('demo', mockSettings.schedules.demo);
  });

  it('returns start policy templates', async () => {
    const response = await requestApiRouter({
      registry: new ModuleRegistry(),
      method: 'GET',
      pathname: '/start-policy-templates',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.map((template: any) => template.id)).toEqual(['balanced', 'aggressive', 'script']);
  });

  it('collects module audit findings across filesystem, runtime, health, and port diagnostics', async () => {
    const registry = new ModuleRegistry();
    const missingModuleDir = path.join(os.tmpdir(), `hubkit-missing-route-${process.pid}-${Date.now()}`);
    fs.rmSync(missingModuleDir, { recursive: true, force: true });
    const module = createModule({
      type: 'nodejs',
      scriptPath: path.join(missingModuleDir, 'missing-hubkit-script.js'),
      webPort: 3000,
      webUrl: undefined,
    });
    registry.register(module);
    jest.mocked(adapterFactory.createModuleAdapter).mockReturnValue({
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.STOPPED }),
      probeHealth: jest.fn().mockResolvedValue({
        state: 'unhealthy',
        summary: '健康检查异常',
        details: 'HTTP 500',
      }),
      inspectStartReadiness: jest.fn().mockResolvedValue({
        ready: false,
        actionLabel: '排查端口后启动',
        summary: '检测到端口 3000 已被占用',
        details: 'node server.js（PID 4321）',
      }),
      getRuntimeState: jest.fn().mockReturnValue({
        phase: 'failed',
        summary: '启动失败',
        attempt: 1,
        maxAttempts: 1,
        lastTransitionAt: '2026-05-30T00:00:00.000Z',
        health: { state: 'unhealthy', summary: '健康检查异常' },
        failure: {
          code: 'health_check_failed',
          source: 'health',
          summary: '健康检查未通过',
          details: 'timeout token=secret',
          retryable: true,
          occurredAt: '2026-05-30T00:00:00.000Z',
        },
      }),
      rawLogs: jest.fn().mockResolvedValue('ok\nError token=secret Bearer abc.def\n'),
      logs: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      getSettings: jest.fn(),
      setSetting: jest.fn(),
      getLastStartPreparation: jest.fn(),
    } as any);
    jest.mocked(moduleEnvironment.inspectModuleEnvironment).mockResolvedValue({
      runtime: 'node',
      packageManager: 'npm',
      engineRequirement: '>=20',
      detectedEnvFiles: ['.env.example'],
      requiredCommands: ['node', 'npm'],
      missingCommands: ['npm'],
      requiredEnvVars: ['API_TOKEN'],
      requiredEnvVarCount: 1,
      missingEnvVars: ['API_TOKEN'],
      commandChecks: [
        { command: 'node', installed: true, requirement: '>=20' },
        { command: 'npm', installed: false },
      ],
    });
    jest.mocked(processDiagnostics.collectModuleProcessDiagnostics).mockResolvedValue({
      pidFromStatus: null,
      pidFromPidFile: null,
      pidCandidates: [],
      port: 3000,
      portOccupied: true,
      portListeners: [{ pid: 4321, command: 'node server.js', alive: true }],
      checkedAt: '2026-05-30T00:00:00.000Z',
    });

    const response = await requestApiRouter({ registry, method: 'GET', pathname: '/module-audit' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      moduleId: 'demo',
      moduleName: 'Demo Module',
      status: ModuleStatus.STOPPED,
      runtimePhase: 'failed',
      healthy: false,
      score: 0,
      inheritedTemplateId: 'balanced',
    }));
    const findingCodes = response.body.data[0].findings.map((finding: any) => finding.code);
    expect(findingCodes).toEqual(expect.arrayContaining([
      'module_dir_missing',
      'script_missing',
      'start_not_ready',
      'missing_runtime_commands',
      'missing_env_vars',
      'health_check_failed',
      'health_unhealthy',
      'port_occupied_while_stopped',
    ]));
    const failureFinding = response.body.data[0].findings.find((finding: any) => finding.code === 'health_check_failed');
    expect(failureFinding.logExcerpt).toContain('token=***');
    expect(failureFinding.logExcerpt).toContain('Bearer ***');
    expect(response.body.data[0].environment.requiredEnvVars).toEqual([]);
    expect(response.body.data[0].environment.missingEnvVars).toEqual(['API_TOKEN']);
  });

  it('returns a healthy audit finding when no risk signals are found', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-audit-'));
    const scriptPath = path.join(tempDir, 'server.js');
    fs.writeFileSync(scriptPath, 'console.log("ok")\n', 'utf-8');
    const registry = new ModuleRegistry();
    registry.register(createModule({ scriptPath }));
    jest.mocked(adapterFactory.createModuleAdapter).mockReturnValue({
      status: jest.fn().mockResolvedValue({ status: ModuleStatus.RUNNING, pid: 1234 }),
      probeHealth: jest.fn().mockResolvedValue({ state: 'healthy', summary: '健康检查通过' }),
      inspectStartReadiness: jest.fn().mockResolvedValue({
        ready: true,
        actionLabel: '启动',
        summary: '可直接启动',
      }),
      getRuntimeState: jest.fn().mockReturnValue({
        phase: 'running',
        summary: '运行中',
        attempt: 1,
        maxAttempts: 1,
        lastTransitionAt: '2026-05-30T00:00:00.000Z',
        health: { state: 'healthy', summary: '健康检查通过' },
      }),
      rawLogs: jest.fn(),
      logs: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      getSettings: jest.fn(),
      setSetting: jest.fn(),
      getLastStartPreparation: jest.fn(),
    } as any);
    jest.mocked(processDiagnostics.collectModuleProcessDiagnostics).mockResolvedValue({
      pidFromStatus: 1234,
      pidFromPidFile: 1234,
      pidCandidates: [{ pid: 1234, command: 'node server.js', alive: true }],
      port: null,
      portOccupied: false,
      portListeners: [],
      checkedAt: '2026-05-30T00:00:00.000Z',
    });

    try {
      const response = await requestApiRouter({ registry, method: 'GET', pathname: '/module-audit' });

      expect(response.status).toBe(200);
      expect(response.body.data[0]).toEqual(expect.objectContaining({
        healthy: true,
        score: 100,
      }));
      expect(response.body.data[0].findings).toEqual([
        expect.objectContaining({
          severity: 'info',
          code: 'healthy',
          summary: '未发现明显异常',
        }),
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

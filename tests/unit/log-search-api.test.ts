import * as fs from 'fs';
import * as path from 'path';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';
import {
  collectScriptLogSearchSources,
  collectSystemLogSearchSources,
  createLogSearchRouter,
} from '../../src/web/api/log-search-routes';

jest.mock('../../src/adapters/adapter-factory', () => ({
  createModuleAdapter: jest.fn((module: ModuleMetadata) => ({
    rawLogs: jest.fn().mockResolvedValue(`${module.id} info\n${module.id} error`),
  })),
}));

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf-8');
}

describe('log-search API wiring', () => {
  it('mounts log search routes from the main API router', () => {
    const source = readSource('src/web/api/routes.ts');

    expect(source).toContain("import { createLogSearchRouter } from './log-search-routes'");
    expect(source).toContain('router.use(createLogSearchRouter({ registry, scriptBundleManager, bootPreferenceService }))');
    expect(source).not.toContain("router.get('/log-search'");
    expect(source).not.toContain('collectScriptLogSearchSources(scriptBundleManager, lines)');
    expect(source).not.toContain('collectSystemLogSearchSources(bootPreferenceService, lines)');
  });

  it('collects module, script, and system action log sources in its own router module', () => {
    const source = readSource('src/web/api/log-search-routes.ts');

    expect(source).toContain("router.get('/log-search'");
    expect(source).toContain('const moduleSources = await Promise.all');
    expect(source).toContain('collectScriptLogSearchSources(scriptBundleManager, lines)');
    expect(source).toContain('collectSystemLogSearchSources(bootPreferenceService, lines)');
    expect(source).toContain('const sources = [...moduleSources, ...scriptSources, ...systemSources]');
  });
});

function createModule(overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id: 'demo',
    name: 'Demo',
    type: 'shell',
    scriptPath: '/tmp/demo.sh',
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

async function requestRouter(
  options: {
    registry: ModuleRegistry;
    scriptBundleManager?: any;
    bootPreferenceService?: any;
    query?: Record<string, unknown>;
  }
): Promise<{ status: number; body: any }> {
  const query = options.query || {};
  const search = new URLSearchParams(
    Object.entries(query).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value;
      return acc;
    }, {})
  ).toString();
  const router = createLogSearchRouter({
    registry: options.registry,
    scriptBundleManager: options.scriptBundleManager,
    bootPreferenceService: options.bootPreferenceService,
  }) as any;

  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: 'GET',
      url: `/log-search${search ? `?${search}` : ''}`,
      originalUrl: `/log-search${search ? `?${search}` : ''}`,
      headers: {},
      query,
      body: {},
      get: jest.fn(() => undefined),
    };
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(responseBody: any) {
        resolve({ status: statusCode, body: responseBody });
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
      resolve({ status: 404, body: undefined });
    });
  });
}

describe('log-search API behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('searches module, script, and system action log sources', async () => {
    const registry = new ModuleRegistry();
    registry.register(createModule({ id: 'api', name: 'API' }));
    const scriptBundleManager = {
      listBundles: jest.fn(() => [{
        id: 'tools',
        name: 'Tools',
        groups: [{
          id: 'ops',
          title: 'Ops',
          actions: [{ id: 'build', name: 'Build' }],
        }],
      }]),
      getActionLog: jest.fn().mockResolvedValue('script error happened'),
    };
    const bootPreferenceService = {
      getLog: jest.fn().mockResolvedValue('system error happened'),
    };

    const response = await requestRouter({
      registry,
      scriptBundleManager,
      bootPreferenceService,
      query: { q: 'error', level: 'error', lines: '10', limit: '5' },
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.query).toBe('error');
    expect(response.body.data.level).toBe('error');
    expect(response.body.data.scannedSources).toBe(3);
    expect(response.body.data.results.map((item: any) => item.sourceId).sort()).toEqual([
      'api',
      'boot-preference',
      'tools:build',
    ]);
    expect(scriptBundleManager.getActionLog).toHaveBeenCalledWith('tools', 'build', undefined, 10);
    expect(bootPreferenceService.getLog).toHaveBeenCalledWith(undefined, 10);
  });

  it('keeps searching when a module adapter raw log read fails', async () => {
    const { createModuleAdapter } = require('../../src/adapters/adapter-factory');
    createModuleAdapter.mockReturnValueOnce({
      rawLogs: jest.fn().mockRejectedValue(new Error('log unavailable')),
    });
    const registry = new ModuleRegistry();
    registry.register(createModule());

    const response = await requestRouter({
      registry,
      query: { q: 'anything' },
    });

    expect(response.status).toBe(200);
    expect(response.body.data.scannedSources).toBe(1);
    expect(response.body.data.results).toEqual([]);
  });

  it('collects script sources while isolating per-action log failures', async () => {
    const scriptBundleManager = {
      listBundles: jest.fn(() => [{
        id: 'tools',
        name: 'Tools',
        groups: [{
          id: 'ops',
          title: 'Ops',
          actions: [
            { id: 'ok', name: 'OK' },
            { id: 'fail', name: 'Fail' },
          ],
        }],
      }]),
      getActionLog: jest.fn()
        .mockResolvedValueOnce('ok log')
        .mockRejectedValueOnce(new Error('missing log')),
    };

    await expect(collectScriptLogSearchSources(scriptBundleManager as any, 25)).resolves.toEqual([
      { id: 'tools:ok', name: 'Tools / OK', kind: 'script', content: 'ok log' },
      { id: 'tools:fail', name: 'Tools / Fail', kind: 'script', content: '' },
    ]);
  });

  it('collects system action sources while isolating log failures', async () => {
    const bootPreferenceService = {
      getLog: jest.fn().mockRejectedValue(new Error('missing log')),
    };

    await expect(collectSystemLogSearchSources(bootPreferenceService as any, 25)).resolves.toEqual([
      {
        id: 'boot-preference',
        name: '系统调优 / 开盖接电启动',
        kind: 'system-action',
        content: '',
      },
    ]);
  });
});

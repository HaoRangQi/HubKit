import { Router, Request, Response } from 'express';
import { WebSocketServer } from 'ws';
import { promises as fs, statSync } from 'fs';
import { dirname } from 'path';
import { ModuleRegistry } from '../../registry/module-registry';
import { createModuleAdapter as createAdapter } from '../../adapters/adapter-factory';
import { ScriptBundleManager } from '../../script-bundle/script-bundle-manager';
import { BootPreferenceService } from '../../system-actions/boot-preference-service';
import { ModuleProtocol } from '../../types/module';
import { config } from '../../config/config';
import {
  getModuleInheritedTemplateId,
  getModuleStartPolicy,
  START_POLICY_TEMPLATES,
} from '../../runtime/module-start-policy';
import { inspectModuleEnvironment, sanitizeEnvironmentReportForDisplay } from '../../runtime/module-environment';
import { createAuditFinding, sortAuditFindings, summarizeLogExcerpt } from '../../health/module-audit';
import { ModuleAuditFinding } from '../../types/module';
import { ModuleScheduler } from '../../scheduler/module-scheduler';
import { ModuleLifecycle } from '../../runtime/module-lifecycle';
import { createSystemActionsRouter } from './system-actions-routes';
import { createScriptBundleRouter } from './script-bundle-routes';
import { createSettingsRouter } from './settings-routes';
import { createLogSearchRouter } from './log-search-routes';
import { createWorkspaceRouter } from './workspace-routes';
import { createModuleAdminRouter } from './module-admin-routes';
import { createModuleUpdateRouter } from './module-update-routes';
import { createHighRiskConfirmationRouter } from './high-risk-confirmation-routes';
import { createCurlRequestRouter } from './curl-request-routes';
import { parseLogLineCount } from './route-utils';
import { collectModuleProcessDiagnostics } from '../../runtime/module-process-diagnostics';

function getModuleDir(scriptPath: string): string {
  try {
    return statSync(scriptPath).isDirectory() ? scriptPath : dirname(scriptPath);
  } catch {
    return dirname(scriptPath);
  }
}

async function collectModuleAuditReport(module: any, groupId: string, settings: ReturnType<typeof config.getSettings>) {
  const adapter = createAdapter(module);
  const status = await adapter.status();
  const runtimeState = adapter.getRuntimeState();
  const health = await adapter.probeHealth();
  const startReadiness = await adapter.inspectStartReadiness();
  const diagnostics = await collectModuleProcessDiagnostics(module, status.pid ?? null);
  const environment = await inspectModuleEnvironment(module);
  const findings: ModuleAuditFinding[] = [];
  let recentLogExcerpt: Promise<string | undefined> | null = null;
  const getRecentLogExcerpt = () => {
    recentLogExcerpt = recentLogExcerpt || collectModuleLogExcerpt(adapter);
    return recentLogExcerpt;
  };

  const effectiveStartPolicy = getModuleStartPolicy(settings, module.id, groupId);
  const inheritedTemplateId = getModuleInheritedTemplateId(settings, groupId);
  const moduleDir = getModuleDir(module.scriptPath);
  const scriptExists = await fs.access(module.scriptPath).then(() => true).catch(() => false);
  const moduleDirExists = await fs.access(moduleDir).then(() => true).catch(() => false);

  if (!moduleDirExists) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'module_dir_missing',
      summary: '模块目录不存在',
      details: moduleDir,
      recommendation: '检查 scriptPath 或重新同步模块目录',
    }));
  }

  if (!scriptExists) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'script_missing',
      summary: '入口脚本不存在',
      details: module.scriptPath,
      recommendation: '检查模块入口路径是否失效',
    }));
  }

  if (!startReadiness.ready) {
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'start_not_ready',
      summary: startReadiness.summary,
      details: startReadiness.details || startReadiness.installCommand,
      recommendation: startReadiness.installCommand ? '先处理依赖或端口冲突，再尝试启动' : '先处理阻塞条件',
    }));
  }

  if (environment.missingCommands.length > 0) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'missing_runtime_commands',
      summary: `缺少命令：${environment.missingCommands.join('、')}`,
      details: environment.commandChecks
        .filter((item) => !item.installed)
        .map((item) => item.requirement ? `${item.command}（要求 ${item.requirement}）` : item.command)
        .join('；'),
      recommendation: '先补齐运行时或包管理器，再重试启动',
    }));
  }

  if (environment.missingEnvVars.length > 0) {
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'missing_env_vars',
      summary: `缺少环境变量：${environment.missingEnvVars.join('、')}`,
      details: environment.detectedEnvFiles.length > 0 ? `来源：${environment.detectedEnvFiles.join('、')}` : undefined,
      recommendation: '补齐环境变量后再启动相关模块',
    }));
  }

  if (runtimeState.phase === 'failed' && runtimeState.failure) {
    findings.push(createAuditFinding({
      severity: 'error',
      code: runtimeState.failure.code,
      summary: runtimeState.failure.summary,
      details: runtimeState.failure.details,
      logExcerpt: await getRecentLogExcerpt(),
      recommendation: runtimeState.failure.source === 'health' ? '检查 Web 服务是否成功监听' : '打开日志查看失败细节',
    }));
  }

  if (runtimeState.lastStartRecord?.outcome === 'failed' && runtimeState.phase !== 'failed') {
    const record = runtimeState.lastStartRecord;
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'last_start_failed',
      summary: `最近一次启动失败：${record.failure?.summary || record.summary}`,
      details: record.failure?.details || record.details,
      logExcerpt: await getRecentLogExcerpt(),
      recommendation: '查看最近失败日志，确认本次运行是否仍受影响',
    }));
  }

  if (health.state === 'unhealthy') {
    findings.push(createAuditFinding({
      severity: 'error',
      code: 'health_unhealthy',
      summary: health.summary,
      details: health.details,
      logExcerpt: await getRecentLogExcerpt(),
      recommendation: '检查服务监听端口与最近启动日志',
    }));
  }

  if (diagnostics.portOccupied && status.status !== 'running') {
    findings.push(createAuditFinding({
      severity: 'warn',
      code: 'port_occupied_while_stopped',
      summary: `端口 ${diagnostics.port} 已被占用`,
      details: diagnostics.portListeners.map((item) => `${item.command}（PID ${item.pid}）`).join('；'),
      recommendation: '考虑执行强制关闭，清理残留监听进程',
    }));
  }

  if (!module.webUrl && !module.webPort && effectiveStartPolicy.healthCheckEnabled) {
    findings.push(createAuditFinding({
      severity: 'info',
      code: 'health_without_target',
      summary: '已启用健康检查，但模块未配置 Web 地址或端口',
      recommendation: '如果这是后台脚本，可切换到“脚本任务”模板',
    }));
  }

  if (findings.length === 0) {
    findings.push(createAuditFinding({
      severity: 'info',
      code: 'healthy',
      summary: '未发现明显异常',
      recommendation: '当前模块状态稳定',
    }));
  }

  const sortedFindings = sortAuditFindings(findings);
  const score = Math.max(
    0,
    100
      - sortedFindings.filter((item) => item.severity === 'error').length * 30
      - sortedFindings.filter((item) => item.severity === 'warn').length * 12
  );

  return {
    moduleId: module.id,
    moduleName: module.name,
    groupId,
    status: status.status,
    runtimePhase: runtimeState.phase,
    healthy: health.state === 'healthy' || (health.state === 'unknown' && sortedFindings.every((item) => item.severity !== 'error')),
    score,
    effectiveStartPolicy,
    inheritedTemplateId,
    environment: sanitizeEnvironmentReportForDisplay(environment),
    findings: sortedFindings,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 创建 API 路由
 */
export function createApiRouter(
  registry: ModuleRegistry,
  wss: WebSocketServer,
  scriptBundleManager?: ScriptBundleManager,
  bootPreferenceService?: BootPreferenceService,
  scheduler?: ModuleScheduler,
  lifecycle: ModuleLifecycle = new ModuleLifecycle(),
): Router {
  const router = Router();
  router.use(createHighRiskConfirmationRouter());
  router.use(createSystemActionsRouter({ bootPreferenceService }));
  router.use(createScriptBundleRouter({ scriptBundleManager }));
  router.use(createSettingsRouter());
  router.use(createLogSearchRouter({ registry, scriptBundleManager, bootPreferenceService }));
  router.use(createWorkspaceRouter({ registry, lifecycle, broadcast: (message) => broadcast(wss, message) }));
  router.use(createModuleAdminRouter({ registry, broadcast: (message) => broadcast(wss, message) }));
  router.use(createModuleUpdateRouter({ registry, broadcast: (message) => broadcast(wss, message) }));
  router.use(createCurlRequestRouter());

  /**
   * 获取所有模块列表
   */
  router.get('/modules', async (req: Request, res: Response) => {
    try {
      const modules = registry.list();
      const settings = config.getSettings();
      const modulesWithStatus = await Promise.all(
        modules.map(async (module) => {
          const inspection = await lifecycle.inspect(module);
          const status = inspection.status;
          const webUrl = config.getModuleWebUrl(module.id, module.webUrl);
          const visible = settings.visibility[module.id] !== false;
          const schedule = settings.schedules[module.id];
          const scheduleStatus = scheduler?.getScheduleStatus(module.id, schedule);
          const groupId = settings.moduleGroups[module.id] || 'default';
          const startPolicy = getModuleStartPolicy(settings, module.id, groupId);
          return {
            ...module,
            webUrl,
            visible,
            schedule,
            scheduleStatus,
            groupId,
            startPolicy,
            inheritedTemplateId: getModuleInheritedTemplateId(settings, groupId),
            status: status.status,
            pid: status.pid,
            startedAt: status.startedAt,
            uptime: status.uptime,
            memory: status.memory,
            cpu: status.cpu,
            startReadiness: inspection.startReadiness,
            runtimeState: inspection.runtimeState,
          };
        })
      );

      res.json({ success: true, data: modulesWithStatus });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/module-audit', async (_req: Request, res: Response) => {
    try {
      const modules = registry.list();
      const settings = config.getSettings();
      const reports = await Promise.all(
        modules.map(async (module) => {
          const groupId = settings.moduleGroups[module.id] || 'default';
          return collectModuleAuditReport(module, groupId, settings);
        })
      );

      res.json({
        success: true,
        data: reports,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  router.get('/start-policy-templates', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: START_POLICY_TEMPLATES,
    });
  });

  /**
   * 获取单个模块详情
   */
  router.get('/modules/:id', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const inspection = await lifecycle.inspect(module);
      const status = inspection.status;
      const webUrl = config.getModuleWebUrl(module.id, module.webUrl);
      const settings = config.getSettings();

      res.json({
        success: true,
        data: {
          ...module,
          webUrl,
          startPolicy: getModuleStartPolicy(settings, module.id, settings.moduleGroups[module.id] || 'default'),
          inheritedTemplateId: getModuleInheritedTemplateId(settings, settings.moduleGroups[module.id] || 'default'),
          status: status.status,
          pid: status.pid,
          startedAt: status.startedAt,
          uptime: status.uptime,
          memory: status.memory,
          cpu: status.cpu,
          startReadiness: inspection.startReadiness,
          runtimeState: inspection.runtimeState,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 启动模块
   */
  router.post('/modules/:id/start', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const result = await lifecycle.start(module);

      // 广播状态更新
      broadcast(wss, { type: 'module_started', moduleId: module.id });

      res.json({
        success: true,
        message: result.preparation?.dependencyInstalled
          ? `模块 ${module.name} 已安装依赖并启动`
          : `模块 ${module.name} 已启动`,
        data: {
          preparation: result.preparation,
          runtimeState: result.runtimeState,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 停止模块
   */
  router.post('/modules/:id/stop', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const force = req.body.force === true;
      if (force) {
        return res.status(400).json({
          success: false,
          error: '强制停止请使用强制关闭接口',
        });
      }
      const result = await lifecycle.stop(module, force);

      // 广播状态更新
      broadcast(wss, { type: 'module_stopped', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已停止`, data: { runtimeState: result.runtimeState } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 重启模块
   */
  router.post('/modules/:id/restart', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const result = await lifecycle.restart(module);

      // 广播状态更新
      broadcast(wss, { type: 'module_restarted', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已重启`, data: { runtimeState: result.runtimeState } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 获取模块日志（返回原始文本，便于前端展示）
   */
  router.get('/modules/:id/logs', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const adapter = createAdapter(module) as any;
      const lines = parseLogLineCount(req.query.lines);
      const raw = await adapter.rawLogs(lines);

      res.json({ success: true, data: raw });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 设置模块 Web UI 地址
   */
  router.post('/modules/:id/web-url', (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'url 参数无效' });
      }

      config.setModuleWebUrl(moduleId, url);
      res.json({ success: true, message: 'Web 地址已更新', url });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 设置模块卡片可见性
   */
  router.post('/modules/:id/visibility', (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const { visible } = req.body;
      if (typeof visible !== 'boolean') {
        return res.status(400).json({ success: false, error: 'visible 参数必须为布尔值' });
      }

      const settings = config.getSettings();
      settings.visibility[moduleId] = visible;
      config.updateSettings({ visibility: settings.visibility });

      res.json({ success: true, message: '可见性已更新', visible });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 设置模块定时任务
   */
  router.post('/modules/:id/schedule', (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const { enabled, startTime, stopTime, daysOfWeek } = req.body;

      // 时间格式校验：HH:MM
      const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (startTime && typeof startTime === 'string' && startTime !== '' && !timeRegex.test(startTime)) {
        return res.status(400).json({ success: false, error: 'startTime 格式应为 HH:MM' });
      }
      if (stopTime && typeof stopTime === 'string' && stopTime !== '' && !timeRegex.test(stopTime)) {
        return res.status(400).json({ success: false, error: 'stopTime 格式应为 HH:MM' });
      }

      const settings = config.getSettings();
      settings.schedules[moduleId] = {
        enabled: enabled === true,
        startTime: startTime || '',
        stopTime: stopTime || '',
        daysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek : [],
      };
      config.updateSettings({ schedules: settings.schedules });

      res.json({
        success: true,
        message: '定时任务已更新',
        schedule: settings.schedules[moduleId],
        scheduleStatus: scheduler?.getScheduleStatus(moduleId, settings.schedules[moduleId]),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}

/**
 * 广播消息到所有 WebSocket 客户端
 */
function broadcast(wss: WebSocketServer, message: any): void {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

async function collectModuleLogExcerpt(adapter: ModuleProtocol): Promise<string | undefined> {
  try {
    const rawLogs = typeof (adapter as any).rawLogs === 'function'
      ? await (adapter as any).rawLogs(80)
      : (await adapter.logs(80)).map((entry) => entry.message).join('\n');
    return summarizeLogExcerpt(rawLogs, 8);
  } catch {
    return undefined;
  }
}

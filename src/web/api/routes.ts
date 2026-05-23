import { Router, Request, Response } from 'express';
import { WebSocketServer } from 'ws';
import { execSync, exec } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { join, dirname } from 'path';
import { ModuleRegistry } from '../../registry/module-registry';
import { NodeJSAdapter } from '../../adapters/nodejs-adapter';
import { PythonAdapter } from '../../adapters/python-adapter';
import { ShellAdapter } from '../../adapters/shell-adapter';
import { ScriptBundleManager } from '../../script-bundle/script-bundle-manager';
import { BootPreferenceService } from '../../system-actions/boot-preference-service';
import { ModuleProtocol } from '../../types/module';
import { config } from '../../config/config';
import {
  PortListenerInfo,
  commandForPid as commandForPidValue,
  isPidAlive as isPidAliveValue,
  listPortListeners,
  parseModulePort as parseModulePortValue,
} from '../../runtime/module-network';
import {
  getModuleInheritedTemplateId,
  getModuleStartPolicy,
  normalizeStartPolicy,
  START_POLICY_TEMPLATES,
} from '../../runtime/module-start-policy';
import { inspectModuleEnvironment } from '../../runtime/module-environment';

interface ModuleProcessDiagnostics {
  pidFromStatus: number | null;
  pidFromPidFile: number | null;
  pidCandidates: PortListenerInfo[];
  port: number | null;
  portOccupied: boolean;
  portListeners: PortListenerInfo[];
  checkedAt: string;
}

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
  const findings: Array<{
    severity: 'info' | 'warn' | 'error';
    code: string;
    summary: string;
    details?: string;
    recommendation?: string;
  }> = [];

  const effectiveStartPolicy = getModuleStartPolicy(settings, module.id, groupId);
  const inheritedTemplateId = getModuleInheritedTemplateId(settings, groupId);
  const moduleDir = getModuleDir(module.scriptPath);
  const scriptExists = await fs.access(module.scriptPath).then(() => true).catch(() => false);
  const moduleDirExists = await fs.access(moduleDir).then(() => true).catch(() => false);

  if (!moduleDirExists) {
    findings.push({
      severity: 'error',
      code: 'module_dir_missing',
      summary: '模块目录不存在',
      details: moduleDir,
      recommendation: '检查 scriptPath 或重新同步模块目录',
    });
  }

  if (!scriptExists) {
    findings.push({
      severity: 'error',
      code: 'script_missing',
      summary: '入口脚本不存在',
      details: module.scriptPath,
      recommendation: '检查模块入口路径是否失效',
    });
  }

  if (!startReadiness.ready) {
    findings.push({
      severity: 'warn',
      code: 'start_not_ready',
      summary: startReadiness.summary,
      details: startReadiness.details || startReadiness.installCommand,
      recommendation: startReadiness.installCommand ? '先处理依赖或端口冲突，再尝试启动' : '先处理阻塞条件',
    });
  }

  if (environment.missingCommands.length > 0) {
    findings.push({
      severity: 'error',
      code: 'missing_runtime_commands',
      summary: `缺少命令：${environment.missingCommands.join('、')}`,
      details: environment.commandChecks
        .filter((item) => !item.installed)
        .map((item) => item.requirement ? `${item.command}（要求 ${item.requirement}）` : item.command)
        .join('；'),
      recommendation: '先补齐运行时或包管理器，再重试启动',
    });
  }

  if (environment.missingEnvVars.length > 0) {
    findings.push({
      severity: 'warn',
      code: 'missing_env_vars',
      summary: `缺少环境变量：${environment.missingEnvVars.join('、')}`,
      details: environment.detectedEnvFiles.length > 0 ? `来源：${environment.detectedEnvFiles.join('、')}` : undefined,
      recommendation: '补齐环境变量后再启动相关模块',
    });
  }

  if (runtimeState.phase === 'failed' && runtimeState.failure) {
    findings.push({
      severity: 'error',
      code: runtimeState.failure.code,
      summary: runtimeState.failure.summary,
      details: runtimeState.failure.details,
      recommendation: runtimeState.failure.source === 'health' ? '检查 Web 服务是否成功监听' : '打开日志查看失败细节',
    });
  }

  if (health.state === 'unhealthy') {
    findings.push({
      severity: 'error',
      code: 'health_unhealthy',
      summary: health.summary,
      details: health.details,
      recommendation: '检查服务监听端口与最近启动日志',
    });
  }

  if (diagnostics.portOccupied && status.status !== 'running') {
    findings.push({
      severity: 'warn',
      code: 'port_occupied_while_stopped',
      summary: `端口 ${diagnostics.port} 已被占用`,
      details: diagnostics.portListeners.map((item) => `${item.command}（PID ${item.pid}）`).join('；'),
      recommendation: '考虑执行强制关闭，清理残留监听进程',
    });
  }

  if (!module.webUrl && !module.webPort && effectiveStartPolicy.healthCheckEnabled) {
    findings.push({
      severity: 'info',
      code: 'health_without_target',
      summary: '已启用健康检查，但模块未配置 Web 地址或端口',
      recommendation: '如果这是后台脚本，可切换到“脚本任务”模板',
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      code: 'healthy',
      summary: '未发现明显异常',
      recommendation: '当前模块状态稳定',
    });
  }

  const score = Math.max(
    0,
    100
      - findings.filter((item) => item.severity === 'error').length * 30
      - findings.filter((item) => item.severity === 'warn').length * 12
  );

  return {
    moduleId: module.id,
    moduleName: module.name,
    groupId,
    status: status.status,
    runtimePhase: runtimeState.phase,
    healthy: health.state === 'healthy' || (health.state === 'unknown' && findings.every((item) => item.severity !== 'error')),
    score,
    effectiveStartPolicy,
    inheritedTemplateId,
    environment,
    findings,
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
): Router {
  const router = Router();

  /**
   * 获取所有模块列表
   */
  router.get('/modules', async (req: Request, res: Response) => {
    try {
      const modules = registry.list();
      const settings = config.getSettings();
      const modulesWithStatus = await Promise.all(
        modules.map(async (module) => {
          const adapter = createAdapter(module);
          const status = await adapter.status();
          await adapter.probeHealth();
          const startReadiness = await adapter.inspectStartReadiness();
          const runtimeState = adapter.getRuntimeState();
          const webUrl = config.getModuleWebUrl(module.id, module.webUrl);
          const visible = settings.visibility[module.id] !== false;
          const schedule = settings.schedules[module.id];
          const groupId = settings.moduleGroups[module.id] || 'default';
          const startPolicy = getModuleStartPolicy(settings, module.id, groupId);
          return {
            ...module,
            webUrl,
            visible,
            schedule,
            groupId,
            startPolicy,
            inheritedTemplateId: getModuleInheritedTemplateId(settings, groupId),
            status: status.status,
            pid: status.pid,
            startedAt: status.startedAt,
            uptime: status.uptime,
            memory: status.memory,
            cpu: status.cpu,
            startReadiness,
            runtimeState,
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
   * 获取脚本工具包列表
   */
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

  /**
   * 运行脚本动作
   */
  router.post('/script-bundles/:bundleId/actions/:actionId/run', async (req: Request, res: Response) => {
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
  });

  /**
   * 在 Web 终端中运行脚本动作
   */
  router.post('/script-bundles/:bundleId/actions/:actionId/web-terminal', async (req: Request, res: Response) => {
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
  });

  /**
   * 获取脚本动作历史
   */
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

  /**
   * 获取脚本动作日志
   */
  router.get('/script-bundles/:bundleId/actions/:actionId/logs', async (req: Request, res: Response) => {
    try {
      if (!scriptBundleManager) {
        return res.status(404).json({ success: false, error: '脚本工具箱未启用' });
      }

      const bundleId = Array.isArray(req.params.bundleId) ? req.params.bundleId[0] : req.params.bundleId;
      const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const raw = await scriptBundleManager.getActionLog(bundleId, actionId, runId);
      res.json({ success: true, data: raw });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 停止 Web 终端会话
   */
  router.post('/terminal-sessions/:sessionId/kill', async (req: Request, res: Response) => {
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
  });

  /**
   * 获取原生系统调优动作列表
   */
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

  /**
   * 应用 BootPreference 模式
   */
  router.post('/system-actions/boot-preference/apply', async (req: Request, res: Response) => {
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
  });

  /**
   * 获取 BootPreference 历史
   */
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

  /**
   * 获取 BootPreference 日志
   */
  router.get('/system-actions/boot-preference/logs', async (req: Request, res: Response) => {
    try {
      if (!bootPreferenceService) {
        return res.status(404).json({ success: false, error: '系统调优未启用' });
      }

      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const raw = await bootPreferenceService.getLog(runId);
      res.json({ success: true, data: raw });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
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

      const adapter = createAdapter(module);
      const status = await adapter.status();
      await adapter.probeHealth();
      const startReadiness = await adapter.inspectStartReadiness();
      const runtimeState = adapter.getRuntimeState();
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
          startReadiness,
          runtimeState,
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

      const adapter = createAdapter(module);
      await adapter.start();
      const preparation = adapter.getLastStartPreparation();
      const runtimeState = adapter.getRuntimeState();

      // 广播状态更新
      broadcast(wss, { type: 'module_started', moduleId: module.id });

      res.json({
        success: true,
        message: preparation?.dependencyInstalled
          ? `模块 ${module.name} 已安装依赖并启动`
          : `模块 ${module.name} 已启动`,
        data: {
          preparation,
          runtimeState,
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

      const adapter = createAdapter(module);
      const force = req.body.force === true;
      await adapter.stop(force);
      const runtimeState = adapter.getRuntimeState();

      // 广播状态更新
      broadcast(wss, { type: 'module_stopped', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已停止`, data: { runtimeState } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 进程/端口状态检查
   */
  router.get('/modules/:id/diagnostics', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const adapter = createAdapter(module);
      const status = await adapter.status();
      const diagnostics = await collectModuleProcessDiagnostics(module, status.pid ?? null);

      res.json({
        success: true,
        data: {
          moduleId: module.id,
          status: status.status,
          diagnostics,
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 强制关闭模块（强制停止 + 端口占用清理）
   */
  router.post('/modules/:id/force-close', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      const adapter = createAdapter(module);
      let adapterStopError: string | null = null;

      try {
        await adapter.stop(true);
      } catch (error) {
        adapterStopError = error instanceof Error ? error.message : String(error);
      }

      const before = await collectModuleProcessDiagnostics(module, null);
      const pidsToKill = new Set<number>();
      before.pidCandidates.forEach(item => {
        if (item.alive) pidsToKill.add(item.pid);
      });
      before.portListeners.forEach(item => {
        if (item.alive) pidsToKill.add(item.pid);
      });

      const killed = await forceKillProcesses([...pidsToKill]);
      const after = await collectModuleProcessDiagnostics(module, null);

      broadcast(wss, { type: 'module_stopped', moduleId: module.id, forceClosed: true });

      const stillOccupied = after.portOccupied || after.pidCandidates.some(item => item.alive);
      res.json({
        success: !stillOccupied,
        message: stillOccupied ? '强制关闭执行完成，但仍检测到残留进程' : `模块 ${module.name} 已强制关闭`,
        data: {
          moduleId: module.id,
          adapterStopError,
          killed,
          before,
          after,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 一键全部关停（强制 + 残留清理）
   */
  router.post('/modules/force-close-all', async (_req: Request, res: Response) => {
    try {
      const modules = registry.list();
      const results: Array<{
        moduleId: string;
        moduleName: string;
        success: boolean;
        message: string;
        adapterStopError: string | null;
        killed: Array<{ pid: number; killed: boolean; signal: string; error?: string }>;
        before: ModuleProcessDiagnostics;
        after: ModuleProcessDiagnostics;
      }> = [];

      for (const module of modules) {
        const adapter = createAdapter(module);
        let adapterStopError: string | null = null;

        try {
          await adapter.stop(true);
        } catch (error) {
          adapterStopError = error instanceof Error ? error.message : String(error);
        }

        const before = await collectModuleProcessDiagnostics(module, null);
        const pidsToKill = new Set<number>();
        before.pidCandidates.forEach(item => {
          if (item.alive) pidsToKill.add(item.pid);
        });
        before.portListeners.forEach(item => {
          if (item.alive) pidsToKill.add(item.pid);
        });

        const killed = await forceKillProcesses([...pidsToKill]);
        const after = await collectModuleProcessDiagnostics(module, null);
        const stillOccupied = after.portOccupied || after.pidCandidates.some(item => item.alive);
        const message = stillOccupied ? '仍检测到残留' : '已清理';

        results.push({
          moduleId: module.id,
          moduleName: module.name,
          success: !stillOccupied,
          message,
          adapterStopError,
          killed,
          before,
          after,
        });

        broadcast(wss, { type: 'module_stopped', moduleId: module.id, forceClosed: true, byBatch: true });
      }

      const failed = results.filter(item => !item.success);
      const successCount = results.length - failed.length;
      const overallSuccess = failed.length === 0;

      res.json({
        success: overallSuccess,
        message: overallSuccess
          ? `全部模块关停完成，已清理 ${successCount}/${results.length}`
          : `全部关停已执行，${failed.length} 个模块仍有残留进程/端口`,
        data: {
          total: results.length,
          successCount,
          failedCount: failed.length,
          results,
        },
      });
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

      const adapter = createAdapter(module);
      await adapter.stop();
      await adapter.start();
      const runtimeState = adapter.getRuntimeState();

      // 广播状态更新
      broadcast(wss, { type: 'module_restarted', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已重启`, data: { runtimeState } });
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
      const lines = parseInt(req.query.lines as string) || 200;
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

      res.json({ success: true, message: '定时任务已更新', schedule: settings.schedules[moduleId] });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 检查并更新模块（git pull + npm install）
   */
  router.post('/modules/:id/update', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      if (!module.updateable) {
        return res.status(400).json({ success: false, error: '该模块不支持在线更新' });
      }

      const moduleDir = getModuleDir(module.scriptPath);

      // 检查是否有 git 仓库
      const gitDir = join(moduleDir, '.git');
      const hasGit = await fs.access(gitDir).then(() => true).catch(() => false);
      if (!hasGit) {
        return res.status(400).json({ success: false, error: '模块目录不是 git 仓库' });
      }

      // 获取当前版本信息
      let beforeHash = '';
      try {
        beforeHash = execSync('git rev-parse --short HEAD', { cwd: moduleDir }).toString().trim();
      } catch { /* ignore */ }

      // 执行 git pull
      const pullResult = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        exec('git pull origin HEAD', { cwd: moduleDir }, (err, stdout, stderr) => {
          resolve({ stdout, stderr, code: err?.code ?? 0 });
        });
      });

      if (pullResult.code !== 0) {
        return res.status(500).json({
          success: false,
          error: `git pull 失败: ${pullResult.stderr}`,
        });
      }

      const alreadyUpToDate = pullResult.stdout.includes('Already up to date');

      // 如果有更新，重新安装依赖
      let installOutput = '';
      if (!alreadyUpToDate) {
        const installResult = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
          exec('npm install', { cwd: moduleDir }, (err, stdout, stderr) => {
            resolve({ stdout, stderr, code: err?.code ?? 0 });
          });
        });
        installOutput = installResult.stdout;
      }

      // 获取更新后版本
      let afterHash = '';
      try {
        afterHash = execSync('git rev-parse --short HEAD', { cwd: moduleDir }).toString().trim();
      } catch { /* ignore */ }

      broadcast(wss, { type: 'module_updated', moduleId: module.id, hasUpdates: !alreadyUpToDate });

      res.json({
        success: true,
        hasUpdates: !alreadyUpToDate,
        message: alreadyUpToDate ? '已是最新版本' : `已更新到最新版本 (${beforeHash} → ${afterHash})`,
        beforeHash,
        afterHash,
        pullOutput: pullResult.stdout.trim(),
        installOutput: installOutput.trim(),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 检查模块是否有可用更新（不实际拉取）
   */
  router.get('/modules/:id/update-check', async (req: Request, res: Response) => {
    try {
      const moduleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const module = registry.get(moduleId);
      if (!module) {
        return res.status(404).json({ success: false, error: '模块不存在' });
      }

      if (!module.updateable) {
        return res.status(400).json({ success: false, error: '该模块不支持更新检查' });
      }

      const moduleDir = dirname(module.scriptPath) === '.'
        ? module.scriptPath
        : dirname(module.scriptPath);

      // fetch 远程信息
      await new Promise<void>((resolve) => {
        exec('git fetch origin', { cwd: moduleDir }, () => resolve());
      });

      let localHash = '';
      let remoteHash = '';
      try {
        localHash = execSync('git rev-parse HEAD', { cwd: moduleDir }).toString().trim();
        remoteHash = execSync('git rev-parse @{u}', { cwd: moduleDir }).toString().trim();
      } catch { /* ignore */ }

      const hasUpdates = localHash !== remoteHash && remoteHash !== '';

      let commitsBehind = 0;
      if (hasUpdates) {
        try {
          commitsBehind = parseInt(
            execSync('git rev-list HEAD..@{u} --count', { cwd: moduleDir }).toString().trim()
          );
        } catch { /* ignore */ }
      }

      res.json({
        success: true,
        hasUpdates,
        localHash: localHash.slice(0, 7),
        remoteHash: remoteHash.slice(0, 7),
        commitsBehind,
        message: hasUpdates ? `有 ${commitsBehind} 个新提交可用` : '已是最新版本',
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 获取设置
   */
  router.get('/settings', (req: Request, res: Response) => {
    try {
      const settings = config.getSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  /**
   * 更新设置
   */
  router.post('/settings', (req: Request, res: Response) => {
    try {
      const { autoStart, startOrder } = req.body;
      const { groups, moduleGroups } = req.body;
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
      config.updateSettings({ autoStart, startOrder, groups, moduleGroups, startPolicies, groupStartPolicyTemplates });
      res.json({ success: true, message: '设置已保存' });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}

/**
 * 创建适配器
 */
function createAdapter(module: any): ModuleProtocol {
  switch (module.type) {
    case 'nodejs':
      return new NodeJSAdapter(module);
    case 'python':
      return new PythonAdapter(module);
    case 'shell':
      return new ShellAdapter(module);
    default:
      throw new Error(`不支持的模块类型: ${module.type}`);
  }
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

function parseModulePort(module: any): number | null {
  return parseModulePortValue(module);
}

function isPidAlive(pid: number): boolean {
  return isPidAliveValue(pid);
}

function commandForPid(pid: number): string {
  return commandForPidValue(pid);
}

function listPortListenerPids(port: number): number[] {
  return listPortListeners(port).map((listener) => listener.pid);
}

function readPidFromFile(moduleId: string): Promise<number | null> {
  const pidPath = join('.hub', 'pids', `${moduleId}.pid`);
  return fs.readFile(pidPath, 'utf-8')
    .then(content => {
      const pid = parseInt(content.trim(), 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    })
    .catch(() => null);
}

async function collectModuleProcessDiagnostics(module: any, statusPid: number | null): Promise<ModuleProcessDiagnostics> {
  const pidFromPidFile = await readPidFromFile(module.id);
  const candidatePids = new Set<number>();
  if (typeof statusPid === 'number' && statusPid > 0) candidatePids.add(statusPid);
  if (typeof pidFromPidFile === 'number' && pidFromPidFile > 0) candidatePids.add(pidFromPidFile);

  const pidCandidates = [...candidatePids].map((pid): PortListenerInfo => ({
    pid,
    command: commandForPid(pid),
    alive: isPidAlive(pid),
  }));

  const port = parseModulePort(module);
  const portPids = port ? listPortListenerPids(port) : [];
  const portListeners = portPids.map((pid): PortListenerInfo => ({
    pid,
    command: commandForPid(pid),
    alive: isPidAlive(pid),
  }));

  return {
    pidFromStatus: statusPid ?? null,
    pidFromPidFile,
    pidCandidates,
    port,
    portOccupied: portListeners.length > 0,
    portListeners,
    checkedAt: new Date().toISOString(),
  };
}

async function forceKillProcesses(pids: number[]): Promise<Array<{ pid: number; killed: boolean; signal: string; error?: string }>> {
  const results: Array<{ pid: number; killed: boolean; signal: string; error?: string }> = [];

  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) continue;

    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        results.push({ pid, killed: true, signal: 'NONE' });
        continue;
      }
      results.push({ pid, killed: false, signal: 'SIGTERM', error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    if (!isPidAlive(pid)) {
      results.push({ pid, killed: true, signal: 'SIGTERM' });
      continue;
    }

    try {
      process.kill(pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 250));
      results.push({ pid, killed: !isPidAlive(pid), signal: 'SIGKILL' });
    } catch (error) {
      results.push({ pid, killed: false, signal: 'SIGKILL', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}

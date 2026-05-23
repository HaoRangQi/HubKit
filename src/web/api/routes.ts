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

interface PortListenerInfo {
  pid: number;
  command: string;
  alive: boolean;
}

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
          const webUrl = config.getModuleWebUrl(module.id, module.webUrl);
          const visible = settings.visibility[module.id] !== false;
          const schedule = settings.schedules[module.id];
          const groupId = settings.moduleGroups[module.id] || 'default';
          return {
            ...module,
            webUrl,
            visible,
            schedule,
            groupId,
            status: status.status,
            pid: status.pid,
            startedAt: status.startedAt,
            uptime: status.uptime,
            memory: status.memory,
            cpu: status.cpu,
          };
        })
      );

      res.json({ success: true, data: modulesWithStatus });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
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
      const webUrl = config.getModuleWebUrl(module.id, module.webUrl);

      res.json({
        success: true,
        data: {
          ...module,
          webUrl,
          status: status.status,
          pid: status.pid,
          startedAt: status.startedAt,
          uptime: status.uptime,
          memory: status.memory,
          cpu: status.cpu,
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

      // 广播状态更新
      broadcast(wss, { type: 'module_started', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已启动` });
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

      // 广播状态更新
      broadcast(wss, { type: 'module_stopped', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已停止` });
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

      // 广播状态更新
      broadcast(wss, { type: 'module_restarted', moduleId: module.id });

      res.json({ success: true, message: `模块 ${module.name} 已重启` });
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
      config.updateSettings({ autoStart, startOrder, groups, moduleGroups });
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
  const fromWebPort = Number(module.webPort);
  if (Number.isInteger(fromWebPort) && fromWebPort > 0 && fromWebPort <= 65535) {
    return fromWebPort;
  }

  if (typeof module.webUrl === 'string' && module.webUrl.trim() !== '') {
    try {
      const parsed = new URL(module.webUrl);
      if (parsed.port) {
        const p = Number(parsed.port);
        if (Number.isInteger(p) && p > 0 && p <= 65535) return p;
      }
    } catch {
      // ignore invalid URL
    }
  }
  return null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

function commandForPid(pid: number): string {
  try {
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function listPortListenerPids(port: number): number[] {
  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1800,
    });
    return [...new Set(
      output
        .split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0)
    )];
  } catch {
    return [];
  }
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

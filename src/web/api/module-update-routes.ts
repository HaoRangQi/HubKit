import { Router, Request, Response } from 'express';
import { execSync, exec } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { join, dirname } from 'path';
import { ModuleRegistry } from '../../registry/module-registry';
import { requireHighRiskConfirmation } from './high-risk-confirmation';

export interface ModuleUpdateRouterOptions {
  registry: ModuleRegistry;
  broadcast: (message: any) => void;
}

function getModuleDir(scriptPath: string): string {
  try {
    return statSync(scriptPath).isDirectory() ? scriptPath : dirname(scriptPath);
  } catch {
    return dirname(scriptPath);
  }
}

/**
 * 模块在线更新路由。
 */
export function createModuleUpdateRouter(options: ModuleUpdateRouterOptions): Router {
  const router = Router();
  const { registry, broadcast } = options;

  /**
   * 检查并更新模块（git pull + npm install）
   */
  router.post(
    '/modules/:id/update',
    requireHighRiskConfirmation((req) => `module:${req.params.id}:update`),
    async (req: Request, res: Response) => {
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
          if (installResult.code !== 0) {
            return res.status(500).json({
              success: false,
              error: `npm install 失败: ${installResult.stderr}`,
            });
          }
          installOutput = installResult.stdout;
        }

        // 获取更新后版本
        let afterHash = '';
        try {
          afterHash = execSync('git rev-parse --short HEAD', { cwd: moduleDir }).toString().trim();
        } catch { /* ignore */ }

        broadcast({ type: 'module_updated', moduleId: module.id, hasUpdates: !alreadyUpToDate });

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
    }
  );

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

      const moduleDir = getModuleDir(module.scriptPath);

      // fetch 远程信息
      await new Promise<void>((resolve, reject) => {
        exec('git fetch origin', { cwd: moduleDir }, (error) => {
          if (error) reject(new Error('无法获取远程版本，请检查网络和仓库访问权限后重试'));
          else resolve();
        });
      });

      let localHash = '';
      let remoteHash = '';
      try {
        localHash = execSync('git rev-parse HEAD', { cwd: moduleDir }).toString().trim();
        remoteHash = execSync('git rev-parse @{u}', { cwd: moduleDir }).toString().trim();
      } catch {
        throw new Error('无法读取当前分支或上游版本，请先配置跟踪分支');
      }

      const commitsBehind = Number(execSync('git rev-list HEAD..@{u} --count', { cwd: moduleDir }).toString().trim());
      if (!localHash || !remoteHash || !Number.isSafeInteger(commitsBehind) || commitsBehind < 0) {
        throw new Error('无法确定上游新增提交，请稍后重新检查');
      }
      const hasUpdates = commitsBehind > 0;

      res.json({
        success: true,
        hasUpdates,
        localHash: localHash.slice(0, 7),
        remoteHash: remoteHash.slice(0, 7),
        commitsBehind,
        message: hasUpdates ? `有 ${commitsBehind} 个新提交可用` : '上游暂无新提交',
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  return router;
}

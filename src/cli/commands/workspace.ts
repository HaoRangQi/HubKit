import { Command } from 'commander';
import { ModuleWorkspace, config } from '../../config/config';
import { ModuleRegistry } from '../../registry/module-registry';
import { ModuleLifecycle } from '../../runtime/module-lifecycle';
import {
  ModuleWorkspaceRunner,
  WorkspaceAction,
  WorkspacePlan,
  WorkspaceRunResult,
} from '../../runtime/module-workspace';
import { scanAndRegisterModules } from './module-loader';

export interface WorkspaceCommandDependencies {
  getWorkspaces?: () => ModuleWorkspace[];
  scanAndRegister?: (registry: ModuleRegistry) => Promise<void>;
  createRunner?: (registry: ModuleRegistry) => Pick<ModuleWorkspaceRunner, 'buildPlan' | 'run'>;
}

/**
 * workspace 命令 - 场景级工作区编排
 */
export function registerWorkspaceCommand(
  program: Command,
  registry: ModuleRegistry,
  dependencies: WorkspaceCommandDependencies = {},
): void {
  const getWorkspaces = dependencies.getWorkspaces || (() => config.getSettings().workspaces);
  const scanAndRegister = dependencies.scanAndRegister || scanAndRegisterModules;
  const createRunner = dependencies.createRunner || ((activeRegistry: ModuleRegistry) => (
    new ModuleWorkspaceRunner(activeRegistry, new ModuleLifecycle())
  ));

  const workspace = program
    .command('workspace')
    .description('管理场景级工作区');

  workspace
    .command('list')
    .description('列出已配置的工作区')
    .action(() => {
      try {
        console.log(formatWorkspaceList(getWorkspaces()));
      } catch (error) {
        console.error('列出工作区失败:', error);
        process.exit(1);
      }
    });

  workspace
    .command('plan <workspaceId>')
    .description('预览工作区启动或停止计划')
    .option('-a, --action <action>', '计划动作 (start|stop)', 'start')
    .action(async (workspaceId: string, options: { action?: string }) => {
      try {
        const action = parseWorkspaceAction(options.action);
        await scanAndRegister(registry);

        const target = findWorkspace(getWorkspaces(), workspaceId);
        if (!target) {
          console.error(`工作区不存在: ${workspaceId}`);
          process.exit(1);
        }

        const plan = createRunner(registry).buildPlan(target, action);
        console.log(formatWorkspacePlan(plan));
      } catch (error) {
        console.error('生成工作区计划失败:', error);
        process.exit(1);
      }
    });

  workspace
    .command('start <workspaceId>')
    .description('按工作区计划启动模块')
    .action(async (workspaceId: string) => {
      await runWorkspaceCommand({
        action: 'start',
        workspaceId,
        registry,
        getWorkspaces,
        scanAndRegister,
        createRunner,
      });
    });

  workspace
    .command('stop <workspaceId>')
    .description('按工作区计划停止模块')
    .action(async (workspaceId: string) => {
      await runWorkspaceCommand({
        action: 'stop',
        workspaceId,
        registry,
        getWorkspaces,
        scanAndRegister,
        createRunner,
      });
    });
}

export function parseWorkspaceAction(value: string | undefined): WorkspaceAction {
  if (value === undefined || value === 'start') return 'start';
  if (value === 'stop') return 'stop';
  throw new Error('--action 必须是 start 或 stop');
}

export function findWorkspace(workspaces: ModuleWorkspace[], workspaceId: string): ModuleWorkspace | undefined {
  return workspaces.find((workspace) => workspace.id === workspaceId);
}

export function formatWorkspaceList(workspaces: ModuleWorkspace[]): string {
  if (workspaces.length === 0) {
    return '未配置工作区';
  }

  const lines = [`\n共 ${workspaces.length} 个工作区:\n`];
  workspaces.forEach((workspace) => {
    lines.push(`  ${workspace.name} (${workspace.id})`);
    if (workspace.description) {
      lines.push(`    描述: ${workspace.description}`);
    }
    lines.push(`    模块: ${workspace.moduleIds.length > 0 ? workspace.moduleIds.join(', ') : '未配置'}`);
    lines.push(`    失败策略: ${workspace.failurePolicy === 'continue' ? '继续执行' : '停止后续模块'}`);
    lines.push('');
  });

  return lines.join('\n');
}

export function formatWorkspacePlan(plan: WorkspacePlan): string {
  const lines = [
    `\n工作区计划: ${plan.workspaceName} (${plan.workspaceId})`,
    `动作: ${formatAction(plan.action)}`,
    `失败策略: ${plan.failurePolicy === 'continue' ? '继续执行' : '停止后续模块'}`,
    `可执行模块: ${plan.runnableModuleIds.length}`,
    `缺失模块: ${plan.missingModuleIds.length}`,
    '',
  ];

  if (plan.steps.length === 0) {
    lines.push('  未配置模块');
    return lines.join('\n');
  }

  plan.steps.forEach((step, index) => {
    const icon = step.status === 'ready' ? '✓' : '✗';
    const name = step.moduleName ? ` - ${step.moduleName}` : '';
    const reason = step.reason ? ` (${step.reason})` : '';
    lines.push(`  ${index + 1}. ${icon} ${step.moduleId}${name}${reason}`);
  });

  return lines.join('\n');
}

export function formatWorkspaceRunResult(result: WorkspaceRunResult): string {
  const lines = [
    `\n工作区${formatAction(result.action)}结果: ${result.workspaceName} (${result.workspaceId})`,
    `状态: ${result.success ? '成功' : '未完全成功'}`,
    `失败策略: ${result.failurePolicy === 'continue' ? '继续执行' : '停止后续模块'}`,
    `开始: ${result.startedAt}`,
    `结束: ${result.finishedAt}`,
    '',
  ];

  if (result.steps.length === 0) {
    lines.push('  未配置模块');
    return lines.join('\n');
  }

  result.steps.forEach((step, index) => {
    const icon = step.result === 'succeeded' ? '✓' : step.result === 'skipped' ? '-' : '✗';
    const name = step.moduleName ? ` - ${step.moduleName}` : '';
    const error = step.error ? `: ${step.error}` : '';
    lines.push(`  ${index + 1}. ${icon} ${step.moduleId}${name} - ${step.message}${error}`);
  });

  return lines.join('\n');
}

async function runWorkspaceCommand(options: {
  action: WorkspaceAction;
  workspaceId: string;
  registry: ModuleRegistry;
  getWorkspaces: () => ModuleWorkspace[];
  scanAndRegister: (registry: ModuleRegistry) => Promise<void>;
  createRunner: (registry: ModuleRegistry) => Pick<ModuleWorkspaceRunner, 'buildPlan' | 'run'>;
}): Promise<void> {
  try {
    await options.scanAndRegister(options.registry);

    const target = findWorkspace(options.getWorkspaces(), options.workspaceId);
    if (!target) {
      console.error(`工作区不存在: ${options.workspaceId}`);
      process.exit(1);
    }

    const result = await options.createRunner(options.registry).run(target, options.action);
    console.log(formatWorkspaceRunResult(result));
    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`${formatAction(options.action)}工作区失败:`, error);
    process.exit(1);
  }
}

function formatAction(action: WorkspaceAction): string {
  return action === 'start' ? '启动' : '停止';
}

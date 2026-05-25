import { ModuleWorkspace, WorkspaceHistoryEntry, config } from '../config/config';
import { ModuleRegistry } from '../registry/module-registry';
import { ModuleMetadata, ModuleStatus } from '../types/module';
import { ModuleLifecycle } from './module-lifecycle';

export type WorkspaceAction = 'start' | 'stop';
export type WorkspacePlanStepStatus = 'ready' | 'missing';
export type WorkspaceRunStepStatus = 'succeeded' | 'failed' | 'skipped';

export interface WorkspacePlanStep {
  moduleId: string;
  moduleName?: string;
  status: WorkspacePlanStepStatus;
  reason?: string;
}

export interface WorkspacePlan {
  workspaceId: string;
  workspaceName: string;
  action: WorkspaceAction;
  failurePolicy: 'stop' | 'continue';
  steps: WorkspacePlanStep[];
  missingModuleIds: string[];
  runnableModuleIds: string[];
}

export interface WorkspaceRunStep extends WorkspacePlanStep {
  result: WorkspaceRunStepStatus;
  message: string;
  error?: string;
}

export interface WorkspaceRunResult {
  workspaceId: string;
  workspaceName: string;
  action: WorkspaceAction;
  success: boolean;
  failurePolicy: 'stop' | 'continue';
  startedAt: string;
  finishedAt: string;
  steps: WorkspaceRunStep[];
}

export interface WorkspaceHistoryStore {
  recordWorkspaceHistory(entry: WorkspaceHistoryEntry): void;
}

export class ModuleWorkspaceRunner {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly lifecycle: ModuleLifecycle = new ModuleLifecycle(),
    private readonly historyStore: WorkspaceHistoryStore | undefined = config,
  ) {}

  buildPlan(workspace: ModuleWorkspace, action: WorkspaceAction): WorkspacePlan {
    const orderedIds = this.resolveOrder(workspace, action);
    const steps = orderedIds.map((moduleId) => this.createPlanStep(moduleId));

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      action,
      failurePolicy: workspace.failurePolicy === 'continue' ? 'continue' : 'stop',
      steps,
      missingModuleIds: steps.filter((step) => step.status === 'missing').map((step) => step.moduleId),
      runnableModuleIds: steps.filter((step) => step.status === 'ready').map((step) => step.moduleId),
    };
  }

  async run(workspace: ModuleWorkspace, action: WorkspaceAction): Promise<WorkspaceRunResult> {
    const startedAt = new Date().toISOString();
    const plan = this.buildPlan(workspace, action);
    const steps: WorkspaceRunStep[] = [];
    let shouldSkipRemaining = false;

    for (const step of plan.steps) {
      if (shouldSkipRemaining) {
        steps.push({
          ...step,
          result: 'skipped',
          message: '前序模块失败，已按工作区策略跳过',
        });
        continue;
      }

      if (step.status === 'missing') {
        const failedStep: WorkspaceRunStep = {
          ...step,
          result: 'failed',
          message: step.reason || '模块不存在',
        };
        steps.push(failedStep);
        if (plan.failurePolicy === 'stop') {
          shouldSkipRemaining = true;
        }
        continue;
      }

      const module = this.registry.get(step.moduleId);
      if (!module) {
        steps.push({
          ...step,
          result: 'failed',
          message: '模块不存在',
        });
        if (plan.failurePolicy === 'stop') {
          shouldSkipRemaining = true;
        }
        continue;
      }

      const result = await this.runModuleAction(module, action);
      steps.push({
        ...step,
        result: result.success ? 'succeeded' : 'failed',
        message: result.message,
        error: result.error,
      });

      if (!result.success && plan.failurePolicy === 'stop') {
        shouldSkipRemaining = true;
      }
    }

    const finishedAt = new Date().toISOString();
    const result = {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      action,
      success: steps.every((step) => step.result === 'succeeded'),
      failurePolicy: plan.failurePolicy,
      startedAt,
      finishedAt,
      steps,
    };
    this.recordHistory(result);
    return result;
  }

  private resolveOrder(workspace: ModuleWorkspace, action: WorkspaceAction): string[] {
    const moduleIds = uniqueStrings(workspace.moduleIds);
    const preferredOrder = action === 'start'
      ? uniqueStrings(workspace.startOrder)
      : uniqueStrings(workspace.stopOrder);

    if (preferredOrder.length > 0) {
      return mergePreferredOrder(moduleIds, preferredOrder);
    }

    return action === 'stop' ? [...moduleIds].reverse() : moduleIds;
  }

  private createPlanStep(moduleId: string): WorkspacePlanStep {
    const module = this.registry.get(moduleId);
    if (!module) {
      return {
        moduleId,
        status: 'missing',
        reason: '模块不存在或尚未被扫描加载',
      };
    }

    return {
      moduleId,
      moduleName: module.name,
      status: 'ready',
    };
  }

  private async runModuleAction(
    module: ModuleMetadata,
    action: WorkspaceAction,
  ): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const status = await this.lifecycle.status(module);
      if (action === 'start' && status.status === ModuleStatus.RUNNING) {
        return { success: true, message: '模块已在运行，跳过启动' };
      }
      if (action === 'stop' && status.status !== ModuleStatus.RUNNING) {
        return { success: true, message: '模块未运行，跳过停止' };
      }

      if (action === 'start') {
        await this.lifecycle.start(module);
        return { success: true, message: '模块已启动' };
      }

      await this.lifecycle.stop(module);
      return { success: true, message: '模块已停止' };
    } catch (error) {
      return {
        success: false,
        message: action === 'start' ? '模块启动失败' : '模块停止失败',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private recordHistory(result: WorkspaceRunResult): void {
    if (!this.historyStore) return;

    try {
      this.historyStore.recordWorkspaceHistory({
        workspaceId: result.workspaceId,
        action: result.action,
        success: result.success,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        failureSummary: result.success ? undefined : summarizeFailure(result.steps),
      });
    } catch (error) {
      console.warn('Failed to persist workspace run history:', error);
    }
  }
}

function mergePreferredOrder(moduleIds: string[], preferredOrder: string[]): string[] {
  const known = new Set(moduleIds);
  const ordered = preferredOrder.filter((moduleId) => known.has(moduleId));
  const orderedSet = new Set(ordered);
  return [
    ...ordered,
    ...moduleIds.filter((moduleId) => !orderedSet.has(moduleId)),
  ];
}

function uniqueStrings(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  return input
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function summarizeFailure(steps: WorkspaceRunStep[]): string {
  const failedSteps = steps.filter((step) => step.result === 'failed');
  if (failedSteps.length === 0) {
    const skippedCount = steps.filter((step) => step.result === 'skipped').length;
    return skippedCount > 0 ? `${skippedCount} 个模块被跳过` : '工作区运行未完全成功';
  }

  const details = failedSteps.slice(0, 3).map((step) => {
    const reason = step.error || step.message || step.reason || '未知错误';
    return `${step.moduleId}: ${reason}`;
  });
  const remaining = failedSteps.length - details.length;
  return remaining > 0 ? `${details.join('; ')}; 另有 ${remaining} 个失败` : details.join('; ');
}

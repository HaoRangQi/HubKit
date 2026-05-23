export type ScriptRiskLevel = 'low' | 'medium' | 'high';

export type ScriptExecutionMode = 'terminal' | 'background';

export type ScriptRunStatus = 'launched' | 'running' | 'succeeded' | 'failed';

export interface ScriptActionConfig {
  id: string;
  name: string;
  description?: string;
  scriptPath: string;
  riskLevel?: ScriptRiskLevel;
  executionMode?: ScriptExecutionMode;
  confirmRequired?: boolean;
  confirmMessage?: string;
  interactive?: boolean;
}

export interface ScriptBundleGroupConfig {
  id: string;
  title: string;
  description?: string;
  actions: ScriptActionConfig[];
}

export interface ScriptBundleConfig {
  id: string;
  name: string;
  description?: string;
  rootPath?: string;
  groups: ScriptBundleGroupConfig[];
}

export interface ScriptAction extends Omit<ScriptActionConfig, 'scriptPath' | 'riskLevel' | 'executionMode'> {
  scriptPath: string;
  riskLevel: ScriptRiskLevel;
  executionMode: ScriptExecutionMode;
}

export interface ScriptBundleGroup {
  id: string;
  title: string;
  description?: string;
  actions: ScriptAction[];
}

export interface ScriptBundle {
  id: string;
  name: string;
  description?: string;
  baseDir: string;
  rootPath: string;
  groups: ScriptBundleGroup[];
}

export interface ScriptRunRecord {
  runId: string;
  bundleId: string;
  actionId: string;
  actionName: string;
  startedAt: string;
  finishedAt?: string;
  executionMode: ScriptExecutionMode;
  status: ScriptRunStatus;
  exitCode?: number | null;
  logFile?: string;
  message?: string;
}

export interface ScriptTerminalSessionSummary {
  sessionId: string;
  runId: string;
  bundleId: string;
  actionId: string;
  actionName: string;
  startedAt: string;
  logFile?: string;
  status: ScriptRunStatus;
}

export interface ScriptActionSummary extends ScriptAction {
  latestRun?: ScriptRunRecord;
}

export interface ScriptBundleGroupSummary extends Omit<ScriptBundleGroup, 'actions'> {
  actions: ScriptActionSummary[];
}

export interface ScriptBundleSummary extends Omit<ScriptBundle, 'groups'> {
  groups: ScriptBundleGroupSummary[];
}

export interface ResolvedScriptAction {
  bundle: ScriptBundle;
  group: ScriptBundleGroup;
  action: ScriptAction;
}

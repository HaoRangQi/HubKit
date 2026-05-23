export type BootPreferenceMode = 'default' | 'block_all' | 'block_lid' | 'block_power' | 'unknown';

export type SystemActionRunStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface SystemActionRunRecord {
  runId: string;
  actionId: string;
  actionName: string;
  startedAt: string;
  finishedAt?: string;
  status: SystemActionRunStatus;
  message?: string;
  logFile?: string;
  exitCode?: number | null;
  targetMode?: BootPreferenceMode;
  observedModeBefore?: BootPreferenceMode;
  observedModeAfter?: BootPreferenceMode;
}

export interface SystemActionSummary {
  id: string;
  groupId: string;
  name: string;
  description: string;
  supported: boolean;
  disabledReason?: string;
  currentMode: BootPreferenceMode;
  currentModeLabel: string;
  currentModeDescription?: string;
  checkedAt?: string;
  latestRun?: SystemActionRunRecord;
}

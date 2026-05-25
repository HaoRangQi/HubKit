import {
  ModuleHealthReport,
  ModuleMetadata,
  ModuleProtocol,
  ModuleRuntimeState,
  ModuleStartPreparation,
  ModuleStartReadiness,
  ModuleStatusInfo,
} from '../types/module';
import { createModuleAdapter } from '../adapters/adapter-factory';

export interface ModuleInspection {
  status: ModuleStatusInfo;
  health: ModuleHealthReport;
  startReadiness: ModuleStartReadiness;
  runtimeState: ModuleRuntimeState;
}

export interface ModuleStartResult {
  success: boolean;
  preparation: ModuleStartPreparation | null;
  runtimeState: ModuleRuntimeState;
}

export interface ModuleStopResult {
  success: boolean;
  runtimeState: ModuleRuntimeState;
}

export interface ModuleRestartResult {
  success: boolean;
  preparation: ModuleStartPreparation | null;
  runtimeState: ModuleRuntimeState;
}

export type ModuleAdapterFactory = (module: ModuleMetadata) => ModuleProtocol;

/**
 * 模块生命周期入口。
 *
 * CLI、Web 和 scheduler 共享这层，避免各入口各自拼装 adapter 行为。
 */
export class ModuleLifecycle {
  constructor(
    private readonly adapterFactory: ModuleAdapterFactory = createModuleAdapter,
    private readonly restartDelayMs: number = 0,
  ) {}

  async inspect(module: ModuleMetadata): Promise<ModuleInspection> {
    const adapter = this.adapterFactory(module);
    const status = await adapter.status();
    const health = await adapter.probeHealth();
    const startReadiness = await adapter.inspectStartReadiness();
    const runtimeState = adapter.getRuntimeState();

    return {
      status,
      health,
      startReadiness,
      runtimeState,
    };
  }

  async status(module: ModuleMetadata): Promise<ModuleStatusInfo> {
    return this.adapterFactory(module).status();
  }

  async start(module: ModuleMetadata): Promise<ModuleStartResult> {
    const adapter = this.adapterFactory(module);
    const success = await adapter.start();
    return {
      success,
      preparation: adapter.getLastStartPreparation(),
      runtimeState: adapter.getRuntimeState(),
    };
  }

  async stop(module: ModuleMetadata, force: boolean = false): Promise<ModuleStopResult> {
    const adapter = this.adapterFactory(module);
    const success = await adapter.stop(force);
    return {
      success,
      runtimeState: adapter.getRuntimeState(),
    };
  }

  async restart(module: ModuleMetadata): Promise<ModuleRestartResult> {
    const adapter = this.adapterFactory(module);
    await adapter.stop();
    await sleep(this.restartDelayMs);
    const success = await adapter.start();

    return {
      success,
      preparation: adapter.getLastStartPreparation(),
      runtimeState: adapter.getRuntimeState(),
    };
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

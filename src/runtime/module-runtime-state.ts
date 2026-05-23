import { EventEmitter } from 'events';
import {
  ModuleHealthReport,
  ModuleRuntimeState,
  ModuleStartFailure,
  ModuleStartPhase,
  ModuleStartRecord,
} from '../types/module';

type RuntimeStatePatch = Partial<Omit<ModuleRuntimeState, 'health'>> & {
  health?: ModuleHealthReport;
  lastStartRecord?: ModuleStartRecord | null;
  failure?: ModuleStartFailure;
};

function createDefaultHealth(): ModuleHealthReport {
  return {
    state: 'unknown',
    summary: '未检查',
  };
}

function createDefaultState(): ModuleRuntimeState {
  return {
    phase: 'stopped',
    summary: '待机',
    attempt: 0,
    maxAttempts: 1,
    lastTransitionAt: new Date().toISOString(),
    health: createDefaultHealth(),
    lastPreparation: null,
    lastStartRecord: null,
  };
}

export class ModuleRuntimeStateStore extends EventEmitter {
  private states = new Map<string, ModuleRuntimeState>();

  get(moduleId: string): ModuleRuntimeState {
    const existing = this.states.get(moduleId);
    if (existing) {
      return cloneState(existing);
    }

    const fallback = createDefaultState();
    this.states.set(moduleId, fallback);
    return cloneState(fallback);
  }

  patch(moduleId: string, patch: RuntimeStatePatch): ModuleRuntimeState {
    const current = this.get(moduleId);
    const next: ModuleRuntimeState = {
      ...current,
      ...patch,
      health: patch.health ? { ...patch.health } : current.health,
      lastTransitionAt: patch.lastTransitionAt || new Date().toISOString(),
    };

    this.states.set(moduleId, next);
    this.emit('change', moduleId, cloneState(next));
    return cloneState(next);
  }

  setPhase(
    moduleId: string,
    phase: ModuleStartPhase,
    summary: string,
    patch: Omit<RuntimeStatePatch, 'summary'> = {}
  ): ModuleRuntimeState {
    return this.patch(moduleId, {
      ...patch,
      phase,
      summary,
    });
  }

  setHealth(moduleId: string, health: ModuleHealthReport): ModuleRuntimeState {
    return this.patch(moduleId, { health });
  }

  reset(moduleId: string): ModuleRuntimeState {
    const next = createDefaultState();
    this.states.set(moduleId, next);
    this.emit('change', moduleId, cloneState(next));
    return cloneState(next);
  }
}

function cloneState(state: ModuleRuntimeState): ModuleRuntimeState {
  return JSON.parse(JSON.stringify(state));
}

export const moduleRuntimeStateStore = new ModuleRuntimeStateStore();

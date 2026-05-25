import { promises as fs } from 'fs';
import { join } from 'path';
import {
  PortListenerInfo,
  commandForPid,
  isPidAlive,
  listPortListeners,
  parseModulePort,
} from './module-network';

export interface ModuleProcessDiagnostics {
  pidFromStatus: number | null;
  pidFromPidFile: number | null;
  pidCandidates: PortListenerInfo[];
  port: number | null;
  portOccupied: boolean;
  portListeners: PortListenerInfo[];
  checkedAt: string;
}

export interface ForceKillResult {
  pid: number;
  killed: boolean;
  signal: string;
  error?: string;
}

export async function readPidFromFile(moduleId: string): Promise<number | null> {
  const pidPath = join('.hub', 'pids', `${moduleId}.pid`);
  return fs.readFile(pidPath, 'utf-8')
    .then(content => {
      const pid = parseInt(content.trim(), 10);
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    })
    .catch(() => null);
}

export async function collectModuleProcessDiagnostics(
  module: { id: string; webPort?: number; webUrl?: string },
  statusPid: number | null
): Promise<ModuleProcessDiagnostics> {
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
  const portListeners = port ? listPortListeners(port) : [];

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

export async function forceKillProcesses(pids: number[]): Promise<ForceKillResult[]> {
  const results: ForceKillResult[] = [];

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

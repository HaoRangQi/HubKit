import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import * as pty from 'node-pty';
import {
  ResolvedScriptAction,
  ScriptAction,
  ScriptActionConfig,
  ScriptBundle,
  ScriptBundleConfig,
  ScriptBundleSummary,
  ScriptRunRecord,
  ScriptRunStatus,
  ScriptTerminalSessionSummary,
} from '../types/script-bundle';
import { readLastLinesText } from '../runtime/log-tail';

type BroadcastFn = (message: any) => void;

interface RunActionResult {
  record: ScriptRunRecord;
  message: string;
}

interface TerminalSession {
  sessionId: string;
  actionKey: string;
  ptyProcess: pty.IPty;
  record: ScriptRunRecord;
  outStream: fs.WriteStream;
}

export class ScriptBundleManager {
  private bundles: Map<string, ScriptBundle> = new Map();
  private readonly recentlyLaunchedTerminalActions: Map<string, number> = new Map();
  private readonly terminalSessions: Map<string, TerminalSession> = new Map();
  private readonly terminalSessionsByAction: Map<string, string> = new Map();
  private readonly stateDir: string;
  private readonly historyDir: string;
  private readonly logDir: string;
  private readonly runnerDir: string;
  private readonly onBroadcast?: BroadcastFn;

  constructor(dataDir: string, onBroadcast?: BroadcastFn) {
    this.stateDir = path.join(dataDir, 'script-bundles');
    this.historyDir = path.join(this.stateDir, 'history');
    this.logDir = path.join(this.stateDir, 'logs');
    this.runnerDir = path.join(this.stateDir, 'runners');
    this.onBroadcast = onBroadcast;
  }

  protected openTerminalScript(command: string): Promise<void> {
    const appleScript = [
      'tell application "Terminal"',
      'activate',
      `do script ${JSON.stringify(command)}`,
      'end tell',
    ].join('\n');

    return new Promise<void>((resolve, reject) => {
      execFile('osascript', ['-e', appleScript], (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async loadFromDirectories(directories: string[]): Promise<void> {
    await this.ensureDirs();
    const bundleConfigs: Array<{ baseDir: string; configPath: string }> = [];

    for (const directory of directories) {
      const found = await this.findBundleConfigs(directory);
      bundleConfigs.push(...found);
    }

    const nextBundles = new Map<string, ScriptBundle>();
    for (const bundleConfig of bundleConfigs) {
      const bundle = await this.loadBundle(bundleConfig.configPath, bundleConfig.baseDir);
      if (bundle) {
        nextBundles.set(bundle.id, bundle);
      }
    }

    this.bundles = nextBundles;
  }

  listBundles(): ScriptBundleSummary[] {
    return Array.from(this.bundles.values()).map((bundle) => ({
      ...bundle,
      groups: bundle.groups.map((group) => ({
        ...group,
        actions: group.actions.map((action) => ({
          ...action,
          latestRun: this.getLatestRun(bundle.id, action.id),
        })),
      })),
    }));
  }

  getBundle(bundleId: string): ScriptBundle | undefined {
    return this.bundles.get(bundleId);
  }

  async runAction(bundleId: string, actionId: string): Promise<RunActionResult> {
    const resolved = this.resolveAction(bundleId, actionId);
    const actionKey = `${bundleId}:${actionId}`;

    if (resolved.action.executionMode === 'terminal') {
      const lastLaunchedAt = this.recentlyLaunchedTerminalActions.get(actionKey) || 0;
      if (Date.now() - lastLaunchedAt < 5000) {
        const latestRecord = this.getLatestRun(bundleId, actionId);
        if (latestRecord) {
          return {
            record: latestRecord,
            message: `${resolved.action.name} 已在系统终端打开`,
          };
        }
      }
      this.recentlyLaunchedTerminalActions.set(actionKey, Date.now());
    }

    const runId = this.createRunId();
    const startedAt = new Date().toISOString();
    const logFile = path.join(this.logDir, bundleId, `${actionId}-${runId}.log`);
    await fsp.mkdir(path.dirname(logFile), { recursive: true });

    const initialRecord: ScriptRunRecord = {
      runId,
      bundleId,
      actionId,
      actionName: resolved.action.name,
      startedAt,
      executionMode: resolved.action.executionMode,
      status: resolved.action.executionMode === 'background' ? 'running' : 'launched',
      logFile,
      message: resolved.action.executionMode === 'background' ? '后台执行已启动' : '已在系统终端中打开',
    };

    await this.appendHistory(initialRecord);

    if (resolved.action.executionMode === 'background') {
      await this.runInBackground(resolved, initialRecord);
      this.broadcast({
        type: 'script_action_updated',
        bundleId,
        actionId,
        status: 'running',
      });
      return {
        record: initialRecord,
        message: `${resolved.action.name} 已在后台启动`,
      };
    }

    await this.openInTerminal(resolved, initialRecord);
    this.broadcast({
      type: 'script_action_updated',
      bundleId,
      actionId,
      status: 'launched',
    });
    return {
      record: initialRecord,
      message: `${resolved.action.name} 已在系统终端打开`,
    };
  }

  async runActionInWebTerminal(
    bundleId: string,
    actionId: string,
    cols = 100,
    rows = 30,
  ): Promise<{ session: ScriptTerminalSessionSummary; record: ScriptRunRecord; message: string }> {
    const resolved = this.resolveAction(bundleId, actionId);
    const existingSession = Array.from(this.terminalSessions.values())[0];
    if (existingSession) {
      return {
        session: this.toTerminalSessionSummary(existingSession),
        record: existingSession.record,
        message: `${existingSession.record.actionName} 已在 Web 终端运行，请先停止当前会话`,
      };
    }

    const actionKey = `${bundleId}:${actionId}`;
    const activeSessionId = this.terminalSessionsByAction.get(actionKey);
    if (activeSessionId) {
      const activeSession = this.terminalSessions.get(activeSessionId);
      if (activeSession) {
        return {
          session: this.toTerminalSessionSummary(activeSession),
          record: activeSession.record,
          message: `${resolved.action.name} 已在 Web 终端运行`,
        };
      }
    }

    const runId = this.createRunId();
    const sessionId = `term-${runId}`;
    const startedAt = new Date().toISOString();
    const logFile = path.join(this.logDir, bundleId, `${actionId}-${runId}.log`);
    await fsp.mkdir(path.dirname(logFile), { recursive: true });

    const record: ScriptRunRecord = {
      runId,
      bundleId,
      actionId,
      actionName: resolved.action.name,
      startedAt,
      executionMode: resolved.action.executionMode,
      status: 'running',
      logFile,
      message: 'Web 终端运行中',
    };
    await this.appendHistory(record);

    const command = await resolveScriptCommand(resolved.action.scriptPath);
    const outStream = fs.createWriteStream(logFile, { flags: 'a' });
    outStream.write(`[HubKit] ${resolved.action.name} started in Web terminal at ${startedAt}${os.EOL}`);
    outStream.write(`[HubKit] Script: ${path.basename(resolved.action.scriptPath)}${os.EOL}${os.EOL}`);

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = this.spawnPty(command.cmd, command.args, {
        name: 'xterm-256color',
        cols: Math.max(20, Math.min(240, cols || 100)),
        rows: Math.max(8, Math.min(80, rows || 30)),
        cwd: resolved.bundle.rootPath,
        env: buildPtyEnv(),
      });
    } catch (error) {
      outStream.write(`${os.EOL}[HubKit] pty spawn failed: ${error instanceof Error ? error.message : String(error)}${os.EOL}`);
      outStream.end();
      await this.finalizeRun(record, 'failed', null, error instanceof Error ? error.message : String(error));
      throw error;
    }

    const session: TerminalSession = {
      sessionId,
      actionKey,
      ptyProcess,
      record,
      outStream,
    };
    this.terminalSessions.set(sessionId, session);
    this.terminalSessionsByAction.set(actionKey, sessionId);

    ptyProcess.onData((data) => {
      outStream.write(data);
      this.broadcast({
        type: 'terminal_output',
        sessionId,
        bundleId,
        actionId,
        data,
      });
    });

    ptyProcess.onExit(async ({ exitCode }) => {
      outStream.write(`${os.EOL}[HubKit] process exited with code ${exitCode}${os.EOL}`);
      outStream.end();
      const status: ScriptRunStatus = exitCode === 0 ? 'succeeded' : 'failed';
      await this.finalizeRun(record, status, exitCode, exitCode === 0 ? '执行完成' : `执行失败，退出码 ${exitCode}`);
      this.terminalSessions.delete(sessionId);
      this.terminalSessionsByAction.delete(actionKey);
      this.broadcast({
        type: 'terminal_exit',
        sessionId,
        bundleId,
        actionId,
        exitCode,
        status,
      });
    });

    this.broadcast({
      type: 'terminal_started',
      sessionId,
      bundleId,
      actionId,
      actionName: resolved.action.name,
    });

    return {
      session: this.toTerminalSessionSummary(session),
      record,
      message: `${resolved.action.name} 已在 Web 终端启动`,
    };
  }

  writeTerminalInput(sessionId: string, data: string): boolean {
    const session = this.terminalSessions.get(sessionId);
    if (!session) return false;
    session.ptyProcess.write(data.replace(/\r/g, '\n'));
    return true;
  }

  resizeTerminalSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.terminalSessions.get(sessionId);
    if (!session) return false;
    session.ptyProcess.resize(
      Math.max(20, Math.min(240, Math.floor(cols || 100))),
      Math.max(8, Math.min(80, Math.floor(rows || 30))),
    );
    return true;
  }

  killTerminalSession(sessionId: string): boolean {
    const session = this.terminalSessions.get(sessionId);
    if (!session) return false;
    session.ptyProcess.kill();
    return true;
  }

  async getActionHistory(bundleId: string, actionId: string): Promise<ScriptRunRecord[]> {
    const filePath = this.getHistoryFilePath(bundleId, actionId);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async getActionLog(bundleId: string, actionId: string, runId?: string, lines: number = 200): Promise<string> {
    const history = await this.getActionHistory(bundleId, actionId);
    const target = runId
      ? history.find((item) => item.runId === runId)
      : history[0];

    if (!target?.logFile) {
      return '暂无日志';
    }

    try {
      return await readLastLinesText(target.logFile, lines);
    } catch {
      return '暂无日志';
    }
  }

  private async runInBackground(resolved: ResolvedScriptAction, record: ScriptRunRecord): Promise<void> {
    const outStream = fs.createWriteStream(record.logFile!, { flags: 'a' });
    outStream.write(`[HubKit] ${resolved.action.name} started at ${record.startedAt}${os.EOL}`);
    const command = await resolveScriptCommand(resolved.action.scriptPath);

    const child = spawn(command.cmd, command.args, {
      cwd: resolved.bundle.rootPath,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.pipe(outStream, { end: false });
    child.stderr?.pipe(outStream, { end: false });

    child.on('error', async (error) => {
      outStream.write(`${os.EOL}[HubKit] spawn failed: ${error.message}${os.EOL}`);
      outStream.end();
      await this.finalizeRun(record, 'failed', null, error.message);
    });

    child.on('close', async (code) => {
      const status: ScriptRunStatus = code === 0 ? 'succeeded' : 'failed';
      outStream.write(`${os.EOL}[HubKit] process exited with code ${code ?? 'null'}${os.EOL}`);
      outStream.end();
      await this.finalizeRun(record, status, code ?? null, code === 0 ? '执行完成' : `执行失败，退出码 ${code ?? 'null'}`);
    });
  }

  private async openInTerminal(resolved: ResolvedScriptAction, record: ScriptRunRecord): Promise<void> {
    const runnerPath = path.join(this.runnerDir, `${resolved.bundle.id}-${resolved.action.id}-${record.runId}.sh`);
    const command = await resolveScriptCommand(resolved.action.scriptPath);
    const commandLine = [command.cmd, ...command.args].map(shellQuote).join(' ');
    const scriptContent = [
      '#!/bin/zsh',
      `cd ${shellQuote(resolved.bundle.rootPath)}`,
      'clear',
      `echo ${shellQuote(`[HubKit] ${resolved.action.name}`)}`,
      `echo ${shellQuote(`[HubKit] Script: ${path.basename(resolved.action.scriptPath)}`)}`,
      'echo',
      `${commandLine} 2>&1 | tee -a ${shellQuote(record.logFile || '')}`,
      'exit_code=${pipestatus[1]}',
      'echo',
      `echo ${shellQuote('[HubKit] 执行结束，退出码:')} $exit_code`,
      `echo ${shellQuote('[HubKit] 按回车关闭终端窗口')}`,
      'read',
      'exit $exit_code',
      '',
    ].join('\n');

    await fsp.mkdir(path.dirname(runnerPath), { recursive: true });
    await fsp.writeFile(runnerPath, scriptContent, 'utf-8');
    await fsp.chmod(runnerPath, 0o755);

    await this.openTerminalScript(`/bin/zsh ${shellQuote(runnerPath)}`);
  }

  private async finalizeRun(
    record: ScriptRunRecord,
    status: ScriptRunStatus,
    exitCode: number | null,
    message: string,
  ): Promise<void> {
    const updated: ScriptRunRecord = {
      ...record,
      status,
      exitCode,
      finishedAt: new Date().toISOString(),
      message,
    };
    await this.prependHistory(updated);
    this.broadcast({
      type: 'script_action_updated',
      bundleId: record.bundleId,
      actionId: record.actionId,
      status,
    });
  }

  private async appendHistory(record: ScriptRunRecord): Promise<void> {
    const history = await this.getActionHistory(record.bundleId, record.actionId);
    history.unshift(record);
    await this.writeHistory(record.bundleId, record.actionId, history);
  }

  private async prependHistory(record: ScriptRunRecord): Promise<void> {
    const history = await this.getActionHistory(record.bundleId, record.actionId);
    const rest = history.filter((item) => item.runId !== record.runId);
    rest.unshift(record);
    await this.writeHistory(record.bundleId, record.actionId, rest);
  }

  private async writeHistory(bundleId: string, actionId: string, history: ScriptRunRecord[]): Promise<void> {
    const filePath = this.getHistoryFilePath(bundleId, actionId);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(history.slice(0, 20), null, 2), 'utf-8');
  }

  private getLatestRun(bundleId: string, actionId: string): ScriptRunRecord | undefined {
    const filePath = this.getHistoryFilePath(bundleId, actionId);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed[0] : undefined;
    } catch {
      return undefined;
    }
  }

  private getHistoryFilePath(bundleId: string, actionId: string): string {
    return path.join(this.historyDir, bundleId, `${actionId}.json`);
  }

  private resolveAction(bundleId: string, actionId: string): ResolvedScriptAction {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) {
      throw new Error('脚本工具包不存在');
    }

    for (const group of bundle.groups) {
      const action = group.actions.find((item) => item.id === actionId);
      if (action) {
        return { bundle, group, action };
      }
    }

    throw new Error('脚本动作不存在');
  }

  private async ensureDirs(): Promise<void> {
    await Promise.all([
      fsp.mkdir(this.stateDir, { recursive: true }),
      fsp.mkdir(this.historyDir, { recursive: true }),
      fsp.mkdir(this.logDir, { recursive: true }),
      fsp.mkdir(this.runnerDir, { recursive: true }),
    ]);
  }

  private async findBundleConfigs(directory: string): Promise<Array<{ baseDir: string; configPath: string }>> {
    const found: Array<{ baseDir: string; configPath: string }> = [];
    if (!fs.existsSync(directory)) {
      return found;
    }

    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(directory, entry.name);
      const configPath = path.join(fullPath, 'script-bundle.json');
      if (fs.existsSync(configPath)) {
        found.push({ baseDir: fullPath, configPath });
      }

      const nested = await this.findBundleConfigs(fullPath);
      found.push(...nested);
    }

    return found;
  }

  private async loadBundle(configPath: string, baseDir: string): Promise<ScriptBundle | null> {
    try {
      const raw = await fsp.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as ScriptBundleConfig;
      if (!parsed.id || !parsed.name || !Array.isArray(parsed.groups)) {
        return null;
      }

      const rootPath = path.resolve(baseDir, parsed.rootPath || '.');
      const groups = parsed.groups
        .filter((group) => group && group.id && group.title && Array.isArray(group.actions))
        .map((group) => ({
          id: group.id,
          title: group.title,
          description: group.description,
          actions: group.actions
            .filter((action) => action && action.id && action.name && action.scriptPath)
            .map((action) => this.resolveActionConfig(action, rootPath)),
        }))
        .filter((group) => group.actions.length > 0);

      return {
        id: parsed.id,
        name: parsed.name,
        description: parsed.description,
        baseDir,
        rootPath,
        groups,
      };
    } catch (error) {
      console.warn(`Failed to load script bundle: ${configPath}`, error);
      return null;
    }
  }

  private resolveActionConfig(action: ScriptActionConfig, rootPath: string): ScriptAction {
    const scriptPath = path.resolve(rootPath, action.scriptPath);
    if (!isPathInside(rootPath, scriptPath)) {
      throw new Error(`非法脚本路径: ${action.scriptPath}`);
    }
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`脚本不存在: ${scriptPath}`);
    }

    return {
      ...action,
      scriptPath,
      riskLevel: action.riskLevel || 'medium',
      executionMode: action.executionMode || 'terminal',
      confirmRequired: action.confirmRequired === true,
      interactive: action.interactive === true,
    };
  }

  private createRunId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private broadcast(message: any): void {
    this.onBroadcast?.(message);
  }

  protected spawnPty(file: string, args: string[], options: pty.IPtyForkOptions): pty.IPty {
    ensureNodePtySpawnHelperExecutable();
    return pty.spawn(file, args, options);
  }

  private toTerminalSessionSummary(session: TerminalSession): ScriptTerminalSessionSummary {
    return {
      sessionId: session.sessionId,
      runId: session.record.runId,
      bundleId: session.record.bundleId,
      actionId: session.record.actionId,
      actionName: session.record.actionName,
      startedAt: session.record.startedAt,
      logFile: session.record.logFile,
      status: session.record.status,
    };
  }
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildPtyEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  Object.entries(process.env).forEach(([key, value]) => {
    if (typeof value === 'string') {
      env[key] = value;
    }
  });
  env.TERM = env.TERM || 'xterm-256color';
  return env;
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform !== 'darwin') return;
  try {
    const packagePath = require.resolve('node-pty/package.json');
    const helperPath = path.join(path.dirname(packagePath), 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (!fs.existsSync(helperPath)) return;
    const mode = fs.statSync(helperPath).mode;
    if ((mode & 0o111) === 0) {
      fs.chmodSync(helperPath, 0o755);
    }
  } catch {
    // node-pty will surface the real spawn error if the helper cannot be repaired.
  }
}

async function resolveScriptCommand(scriptPath: string): Promise<{ cmd: string; args: string[] }> {
  const fallback = { cmd: '/bin/zsh', args: [scriptPath] };

  try {
    const handle = await fsp.open(scriptPath, 'r');
    try {
      const buffer = Buffer.alloc(256);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, result.bytesRead).toString('utf-8').split(/\r?\n/, 1)[0].trim();
      if (!firstLine.startsWith('#!')) {
        return fallback;
      }

      const parts = splitShellWords(firstLine.slice(2).trim());
      if (parts.length === 0) {
        return fallback;
      }

      if (parts[0] === '/usr/bin/env') {
        const envArgs = parts.slice(1);
        if (envArgs.length === 0) {
          return fallback;
        }
        return { cmd: parts[0], args: [...envArgs, scriptPath] };
      }

      return { cmd: parts[0], args: [...parts.slice(1), scriptPath] };
    } finally {
      await handle.close();
    }
  } catch {
    return fallback;
  }
}

function splitShellWords(value: string): string[] {
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((item) => item.replace(/^(['"])(.*)\1$/, '$2'));
}

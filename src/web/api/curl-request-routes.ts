import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

function clampTimeoutMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(n)));
}

function splitShellWords(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === '\'') {
      if (char === '\'') {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\') {
        escaped = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped || quote) {
    throw new Error('curl 命令引号或转义未闭合');
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseCurlCommand(raw: unknown): string[] {
  const command = String(raw || '').trim();
  if (!command) {
    throw new Error('curl 命令不能为空');
  }
  const tokens = splitShellWords(command);
  if (tokens.length === 0 || tokens[0] !== 'curl') {
    throw new Error('仅支持以 curl 开头的命令');
  }
  return tokens.slice(1);
}

function truncateOutput(output: string): string {
  if (Buffer.byteLength(output, 'utf-8') <= MAX_OUTPUT_BYTES) {
    return output;
  }
  const bytes = Buffer.from(output, 'utf-8');
  return bytes.subarray(0, MAX_OUTPUT_BYTES).toString('utf-8');
}

export function createCurlRequestRouter(): Router {
  const router = Router();

  router.post('/curl-requests/:siteId/run', async (req: Request, res: Response) => {
    const siteId = String(req.params.siteId || '').trim();
    if (!siteId) {
      res.status(400).json({ success: false, error: '站点 ID 不能为空' });
      return;
    }

    let args: string[];
    try {
      args = parseCurlCommand(req.body?.command);
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'curl 命令格式错误' });
      return;
    }

    const timeoutMs = clampTimeoutMs(req.body?.timeoutMs);
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();

    try {
      const result = await runCurl(args, timeoutMs);
      const finishedAtIso = new Date().toISOString();
      const success = result.exitCode === 0;
      const message = success
        ? `curl 执行成功（${siteId}）`
        : `curl 执行失败（${siteId}）`;

      res.status(success ? 200 : 500).json({
        success,
        message,
        data: {
          siteId,
          command: `curl ${args.join(' ')}`,
          startedAt: startedAtIso,
          finishedAt: finishedAtIso,
          durationMs: Date.parse(finishedAtIso) - Date.parse(startedAtIso),
          timeoutMs,
          exitCode: result.exitCode,
          stdout: truncateOutput(result.stdout),
          stderr: truncateOutput(result.stderr),
          timedOut: result.timedOut,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'curl 执行失败',
      });
    }
  });

  return router;
}

function runCurl(args: string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let completed = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf-8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf-8');
      }
    });

    child.on('error', (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      resolve({
        exitCode: Number.isInteger(code) ? Number(code) : 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

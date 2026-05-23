import { execSync } from 'child_process';
import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface PortListenerInfo {
  pid: number;
  command: string;
  alive: boolean;
}

export function parseModulePort(module: { webPort?: number; webUrl?: string }): number | null {
  const fromWebPort = Number(module.webPort);
  if (Number.isInteger(fromWebPort) && fromWebPort > 0 && fromWebPort <= 65535) {
    return fromWebPort;
  }

  if (typeof module.webUrl === 'string' && module.webUrl.trim() !== '') {
    try {
      const parsed = new URL(module.webUrl);
      if (parsed.port) {
        const port = Number(parsed.port);
        if (Number.isInteger(port) && port > 0 && port <= 65535) {
          return port;
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function buildHealthCheckUrl(module: { webPort?: number; webUrl?: string }): string | null {
  if (typeof module.webUrl === 'string' && module.webUrl.trim() !== '') {
    try {
      const parsed = new URL(module.webUrl);
      if (!parsed.pathname || parsed.pathname === '') {
        parsed.pathname = '/';
      }
      return parsed.toString();
    } catch {
      return null;
    }
  }

  const port = parseModulePort(module);
  if (!port) return null;
  return `http://127.0.0.1:${port}/`;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function commandForPid(pid: number): string {
  try {
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function listPortListeners(port: number): PortListenerInfo[] {
  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1800,
    });

    return [...new Set(
      output
        .split('\n')
        .map(line => parseInt(line.trim(), 10))
        .filter(pid => Number.isInteger(pid) && pid > 0)
    )].map((pid) => ({
      pid,
      command: commandForPid(pid),
      alive: isPidAlive(pid),
    }));
  } catch {
    return [];
  }
}

export async function requestHealthCheck(targetUrl: string, timeoutMs: number): Promise<{ ok: boolean; status?: number; message: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finalize = (result: { ok: boolean; status?: number; message: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      finalize({ ok: false, message: '健康检查地址无效' });
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(parsed, { method: 'GET', timeout: timeoutMs }, (response) => {
      const status = response.statusCode || 0;
      response.resume();
      if (status >= 200 && status < 500) {
        finalize({
          ok: status < 400,
          status,
          message: status < 400 ? `HTTP ${status}` : `HTTP ${status}`,
        });
        return;
      }

      finalize({
        ok: false,
        status,
        message: `HTTP ${status || 'unknown'}`,
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', (error) => {
      finalize({
        ok: false,
        message: error.message || '连接失败',
      });
    });

    request.end();
  });
}

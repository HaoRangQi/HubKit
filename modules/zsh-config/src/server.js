import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { getPaths, bootstrapSourceLine, assertAllowedPath } from './paths.js';
import { createDefaultConfig, ensureManagedRoot, loadConfig, saveConfig, withIds } from './model.js';
import { generateManagedZsh } from './generator.js';
import { scanSystem } from './scanner.js';
import { diagnose } from './diagnostics.js';
import { unifiedDiff } from './diff.js';
import { createBackup, listBackups, restoreBackup } from './backup.js';
import { summarizeConfigChange } from './summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 3002);

export function createServer(paths = getPaths()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await routeApi(req, res, url, paths);
        return;
      }
      await serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
}

async function routeApi(req, res, url, paths) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const config = await loadConfig(paths);
    const scan = await scanSystem(paths);
    const diagnostics = diagnose(config, scan, paths);
    const managedText = await readMaybe(paths.managedFile);
    sendJson(res, 200, {
      config,
      scan,
      diagnostics,
      generated: generateManagedZsh(config),
      managedText: managedText || '',
      backups: await listBackups(paths),
      paths: publicPaths(paths)
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bootstrap') {
    const result = await bootstrap(paths);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/backup') {
    const body = await readJson(req);
    sendJson(res, 200, await createBackup(body.label || 'manual', paths));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/restore') {
    const body = await readJson(req);
    sendJson(res, 200, await restoreBackup(body.id, paths));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/validate') {
    const body = await readJson(req);
    const config = withIds(body.config || createDefaultConfig());
    const text = generateManagedZsh(config);
    const validation = await validateZsh(text);
    const previousConfig = await loadConfig(paths);
    sendJson(res, validation.ok ? 200 : 422, {
      ...validation,
      summary: summarizeConfigChange(previousConfig, config),
      diff: unifiedDiff((await readMaybe(paths.managedFile)) || '', text, 'managed.zsh current', 'managed.zsh next')
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/config') {
    const body = await readJson(req);
    const config = withIds(body.config || createDefaultConfig());
    const previousConfig = await loadConfig(paths);
    const text = generateManagedZsh(config);
    const validation = await validateZsh(text);
    if (!validation.ok) {
      sendJson(res, 422, validation);
      return;
    }

    await createBackup('pre-save', paths);
    const previousText = (await readMaybe(paths.managedFile)) || '';
    const saved = await saveConfig(config, paths);
    assertAllowedPath(paths.managedFile, paths);
    await fs.writeFile(paths.managedFile, text, 'utf8');
    const scan = await scanSystem(paths);
    sendJson(res, 200, {
      config: saved,
      validation,
      summary: summarizeConfigChange(previousConfig, saved),
      diff: unifiedDiff(previousText, text, 'managed.zsh current', 'managed.zsh next'),
      scan,
      diagnostics: diagnose(saved, scan, paths),
      backups: await listBackups(paths)
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

export async function bootstrap(paths = getPaths()) {
  await ensureManagedRoot(paths);
  const config = await loadConfig(paths);
  const text = generateManagedZsh(config);
  const validation = await validateZsh(text);
  if (!validation.ok) {
    const error = new Error(validation.stderr || 'Generated zsh failed validation.');
    error.validation = validation;
    throw error;
  }

  await createBackup('pre-bootstrap', paths);
  assertAllowedPath(paths.managedFile, paths);
  await fs.writeFile(paths.managedFile, text, 'utf8');
  await saveConfig(config, paths);

  const line = bootstrapSourceLine();
  let zshrc = await readMaybe(paths.zshrc);
  if (zshrc === null) {
    zshrc = '';
  }
  const installed = zshrc.includes(line);
  if (!installed) {
    const prefix = zshrc.endsWith('\n') || zshrc.length === 0 ? '' : '\n';
    const block = [
      `${prefix}# zsh Config Center managed layer`,
      line,
      ''
    ].join('\n');
    assertAllowedPath(paths.zshrc, paths);
    await fs.writeFile(paths.zshrc, `${zshrc}${block}`, 'utf8');
  }

  return {
    installed: true,
    changed: !installed,
    sourceLine: line,
    paths: publicPaths(paths)
  };
}

export async function validateZsh(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zsh-config-'));
  const file = path.join(dir, 'managed.zsh');
  await fs.writeFile(file, text, 'utf8');
  return new Promise((resolve) => {
    const child = spawn('zsh', ['-n', file]);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', async (code) => {
      await fs.rm(dir, { recursive: true, force: true });
      resolve({ ok: code === 0, code, stderr });
    });
    child.on('error', async (error) => {
      await fs.rm(dir, { recursive: true, force: true });
      resolve({ ok: false, code: null, stderr: error.message });
    });
  });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-store'
    });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendText(res, 404, 'Not found');
      return;
    }
    throw error;
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

async function readMaybe(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function publicPaths(paths) {
  return {
    managedRoot: paths.managedRoot,
    configFile: paths.configFile,
    managedFile: paths.managedFile,
    backupsDir: paths.backupsDir,
    zshrc: paths.zshrc,
    zprofile: paths.zprofile,
    zshenv: paths.zshenv,
    ohMyZshCustom: paths.ohMyZshCustom
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`zsh Config Center running at http://127.0.0.1:${port}`);
  });
}

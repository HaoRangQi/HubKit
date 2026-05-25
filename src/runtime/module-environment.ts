import { execSync } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { ModuleEnvironmentCommandCheck, ModuleEnvironmentReport, ModuleMetadata } from '../types/module';

const ENV_TEMPLATE_FILES = [
  '.env.example',
  '.env.sample',
  '.env.local.example',
  '.env.local.sample',
];

export async function inspectModuleEnvironment(module: ModuleMetadata): Promise<ModuleEnvironmentReport> {
  const moduleDir = resolveModuleDir(module.scriptPath);
  const packageJson = await readJson(join(moduleDir, 'package.json'));
  const packageManager = await detectPackageManager(moduleDir, packageJson);
  const envTemplates = await findExistingFiles(moduleDir, ENV_TEMPLATE_FILES);
  const requiredEnvVars = await collectRequiredEnvVars(envTemplates.map((file) => join(moduleDir, file)));

  let runtime = 'unknown';
  let engineRequirement: string | undefined;
  const requiredCommands = new Set<string>();

  if (module.type === 'nodejs') {
    runtime = 'node';
    requiredCommands.add('node');
    if (packageManager) requiredCommands.add(packageManager);
    engineRequirement = typeof packageJson?.engines?.node === 'string' ? packageJson.engines.node : undefined;
  } else if (module.type === 'python') {
    runtime = 'python3';
    requiredCommands.add(await detectPythonCommand(moduleDir));
    const pyproject = await readText(join(moduleDir, 'pyproject.toml'));
    if (pyproject.includes('[tool.poetry]')) {
      requiredCommands.add('poetry');
    }
    if (await fileExists(join(moduleDir, 'uv.lock'))) {
      requiredCommands.add('uv');
    }
    if (await fileExists(join(moduleDir, 'requirements.txt'))) {
      requiredCommands.add('pip');
    }
  } else if (module.type === 'shell') {
    runtime = await detectShellRuntime(module.scriptPath);
    requiredCommands.add(runtime);
  }

  const commandChecks = [...requiredCommands].map((command) => inspectCommand(command, command === 'node' ? engineRequirement : undefined));
  const missingCommands = commandChecks.filter((item) => !item.installed).map((item) => item.command);
  const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

  return {
    runtime,
    packageManager: packageManager || undefined,
    engineRequirement,
    detectedEnvFiles: envTemplates,
    requiredCommands: [...requiredCommands],
    missingCommands,
    requiredEnvVars,
    requiredEnvVarCount: requiredEnvVars.length,
    missingEnvVars,
    commandChecks,
  };
}

export function sanitizeEnvironmentReportForDisplay(report: ModuleEnvironmentReport): ModuleEnvironmentReport {
  return {
    ...report,
    requiredEnvVarCount: report.requiredEnvVarCount ?? report.requiredEnvVars.length,
    requiredEnvVars: [],
    missingEnvVars: report.missingEnvVars.map(sanitizeEnvVarName).filter(Boolean),
  };
}

export async function detectPackageManager(moduleDir: string, packageJson?: any): Promise<string | null> {
  const packageManagerField = typeof packageJson?.packageManager === 'string' ? packageJson.packageManager.split('@')[0] : '';
  if (packageManagerField) return packageManagerField;
  if (await fileExists(join(moduleDir, 'bun.lock')) || await fileExists(join(moduleDir, 'bun.lockb'))) return 'bun';
  if (await fileExists(join(moduleDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fileExists(join(moduleDir, 'yarn.lock'))) return 'yarn';
  if (await fileExists(join(moduleDir, 'package-lock.json')) || packageJson) return 'npm';
  return null;
}

export function parseEnvTemplate(content: string): string[] {
  const result = new Set<string>();
  const lines = String(content || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match) {
      result.add(match[1]);
    }
  }
  return [...result];
}

function sanitizeEnvVarName(key: string): string {
  const normalized = String(key || '').trim();
  return /^[A-Z][A-Z0-9_]*$/.test(normalized) ? normalized : '';
}

function inspectCommand(command: string, requirement?: string): ModuleEnvironmentCommandCheck {
  try {
    execSync(`command -v ${command}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: '/bin/zsh',
      timeout: 1200,
    }).trim();

    const version = readCommandVersion(command);
    return {
      command,
      installed: true,
      version,
      requirement,
    };
  } catch {
    return {
      command,
      installed: false,
      requirement,
    };
  }
}

function readCommandVersion(command: string): string | undefined {
  const candidates = getVersionCommands(command);
  for (const args of candidates) {
    try {
      const output = execSync([command, ...args].join(' '), {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: '/bin/zsh',
        timeout: 1500,
      }).trim();
      if (output) {
        return output.split('\n')[0].slice(0, 120);
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function getVersionCommands(command: string): string[][] {
  if (command === 'node') return [['--version']];
  if (command === 'npm') return [['--version']];
  if (command === 'pnpm') return [['--version']];
  if (command === 'yarn') return [['--version']];
  if (command === 'bun') return [['--version']];
  if (command === 'python' || command === 'python3' || command.includes('/python')) return [['--version']];
  return [['--version'], ['-V'], ['-v']];
}

async function detectPythonCommand(moduleDir: string): Promise<string> {
  const venvPaths = [
    join(moduleDir, 'venv', 'bin', 'python'),
    join(moduleDir, '.venv', 'bin', 'python'),
    join(moduleDir, 'venv', 'bin', 'python3'),
    join(moduleDir, '.venv', 'bin', 'python3'),
  ];
  for (const candidate of venvPaths) {
    if (await fileExists(candidate)) return candidate;
  }
  return 'python3';
}

async function detectShellRuntime(scriptPath: string): Promise<string> {
  try {
    const content = await fs.readFile(scriptPath, 'utf-8');
    const firstLine = content.split('\n')[0]?.trim() || '';
    if (firstLine.startsWith('#!')) {
      const shebang = firstLine.slice(2).trim();
      if (shebang.startsWith('/usr/bin/env ')) {
        const envCommand = shebang.replace('/usr/bin/env ', '').trim().split(/\s+/)[0];
        return envCommand || 'sh';
      }
      return basename(shebang.split(/\s+/)[0]) || 'sh';
    }
  } catch {
    return 'sh';
  }
  return 'sh';
}

async function collectRequiredEnvVars(files: string[]): Promise<string[]> {
  const result = new Set<string>();
  for (const file of files) {
    const content = await readText(file);
    parseEnvTemplate(content).forEach((key) => result.add(key));
  }
  return [...result];
}

async function findExistingFiles(dir: string, filenames: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const filename of filenames) {
    if (await fileExists(join(dir, filename))) {
      found.push(filename);
    }
  }
  return found;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function resolveModuleDir(scriptPath: string): string {
  try {
    return statSync(scriptPath).isDirectory() ? scriptPath : dirname(scriptPath);
  } catch {
    return dirname(scriptPath);
  }
}

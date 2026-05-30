jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: jest.fn(),
      readFile: jest.fn(),
    },
    statSync: jest.fn(),
  };
});

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import {
  detectPackageManager,
  inspectModuleEnvironment,
  parseEnvTemplate,
  sanitizeEnvironmentReportForDisplay,
} from '../../src/runtime/module-environment';
import { ModuleEnvironmentReport } from '../../src/types/module';

const execSyncMock = execSync as jest.MockedFunction<typeof execSync>;

describe('module-environment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    (fs.access as jest.Mock).mockReset();
    (fs.readFile as jest.Mock).mockReset();
    execSyncMock.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses env template keys from common formats', () => {
    expect(parseEnvTemplate(`
# comment
FOO=bar
export BAR=baz
INVALID LINE
APP_TOKEN=
`)).toEqual(['FOO', 'BAR', 'APP_TOKEN']);
  });

  it('only extracts env names and never template values', () => {
    const parsed = parseEnvTemplate(`
API_KEY=sk-live-secret
PASSWORD="super-secret"
export TOKEN='hidden'
not_exported=value
BROKEN TOKEN=value
`);

    expect(parsed).toEqual(['API_KEY', 'PASSWORD', 'TOKEN']);
    expect(parsed.join(' ')).not.toContain('sk-live-secret');
    expect(parsed.join(' ')).not.toContain('super-secret');
    expect(parsed.join(' ')).not.toContain('hidden');
  });

  it('sanitizes environment reports for display by hiding required env names', () => {
    const report: ModuleEnvironmentReport = {
      runtime: 'node',
      packageManager: 'npm',
      detectedEnvFiles: ['.env.example'],
      requiredCommands: ['node', 'npm'],
      missingCommands: [],
      requiredEnvVars: ['API_KEY', 'PASSWORD', 'TOKEN'],
      missingEnvVars: ['API_KEY', 'bad=value'],
      commandChecks: [],
    };

    const sanitized = sanitizeEnvironmentReportForDisplay(report);

    expect(sanitized.requiredEnvVars).toEqual([]);
    expect(sanitized.requiredEnvVarCount).toBe(3);
    expect(sanitized.missingEnvVars).toEqual(['API_KEY']);
    expect(sanitized.detectedEnvFiles).toEqual(['.env.example']);
  });

  it('detects package manager from lockfile precedence', async () => {
    (fs.access as jest.Mock).mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('pnpm-lock.yaml')) return undefined;
      throw new Error('missing');
    });

    await expect(detectPackageManager('/workspace/demo', null)).resolves.toBe('pnpm');
  });

  it('prefers packageManager field in package.json', async () => {
    await expect(detectPackageManager('/workspace/demo', {
      packageManager: 'yarn@4.1.0',
    })).resolves.toBe('yarn');
  });

  it('inspects Node.js module runtime commands, package manager, engine, and env templates', async () => {
    process.env.API_KEY = 'present';
    (fs.access as jest.Mock).mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('.env.example')) return undefined;
      throw new Error('missing');
    });
    (fs.readFile as jest.Mock).mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('package.json')) {
        return JSON.stringify({
          packageManager: 'pnpm@9.0.0',
          engines: { node: '>=20' },
          dependencies: { express: '^5.0.0' },
        });
      }
      if (targetPath.endsWith('.env.example')) {
        return 'API_KEY=\nSECRET_TOKEN=\n';
      }
      return '';
    });
    execSyncMock.mockImplementation((command: string) => {
      if (command.startsWith('command -v ')) return '/usr/bin/tool\n' as any;
      if (command === 'node --version') return 'v20.0.0\n' as any;
      if (command === 'pnpm --version') return '9.0.0\n' as any;
      return '' as any;
    });

    const report = await inspectModuleEnvironment({
      id: 'demo',
      name: 'Demo',
      type: 'nodejs',
      scriptPath: '/workspace/demo/index.js',
      autoStart: false,
      enabled: true,
    });

    expect(report).toEqual(expect.objectContaining({
      runtime: 'node',
      packageManager: 'pnpm',
      engineRequirement: '>=20',
      detectedEnvFiles: ['.env.example'],
      requiredCommands: ['node', 'pnpm'],
      missingCommands: [],
      requiredEnvVars: ['API_KEY', 'SECRET_TOKEN'],
      requiredEnvVarCount: 2,
      missingEnvVars: ['SECRET_TOKEN'],
    }));
    expect(report.commandChecks).toEqual([
      { command: 'node', installed: true, version: 'v20.0.0', requirement: '>=20' },
      { command: 'pnpm', installed: true, version: '9.0.0', requirement: undefined },
    ]);
  });

  it('inspects Python modules with virtualenv, lockfiles, requirements, and missing commands', async () => {
    (fs.access as jest.Mock).mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('/.venv/bin/python')) return undefined;
      if (targetPath.endsWith('/uv.lock')) return undefined;
      if (targetPath.endsWith('/requirements.txt')) return undefined;
      throw new Error('missing');
    });
    (fs.readFile as jest.Mock).mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('pyproject.toml')) return '[tool.poetry]\nname = "demo"\n';
      return '';
    });
    execSyncMock.mockImplementation((command: string) => {
      if (command.includes('/.venv/bin/python')) return '/workspace/demo/.venv/bin/python\n' as any;
      if (command.startsWith('command -v poetry')) throw new Error('missing poetry');
      if (command.startsWith('command -v uv')) throw new Error('missing uv');
      if (command.startsWith('command -v pip')) return '/usr/bin/pip\n' as any;
      if (command === 'pip --version') return 'pip 24.0\n' as any;
      return '' as any;
    });

    const report = await inspectModuleEnvironment({
      id: 'py',
      name: 'Python',
      type: 'python',
      scriptPath: '/workspace/demo/app.py',
      autoStart: false,
      enabled: true,
    });

    expect(report.runtime).toBe('python3');
    expect(report.requiredCommands).toEqual(['/workspace/demo/.venv/bin/python', 'poetry', 'uv', 'pip']);
    expect(report.missingCommands).toEqual(['poetry', 'uv']);
  });

  it('detects shell runtime from env shebang and falls back when command is missing', async () => {
    (fs.access as jest.Mock).mockRejectedValue(new Error('missing'));
    (fs.readFile as jest.Mock).mockResolvedValue('#!/usr/bin/env zsh\n echo ok\n');
    execSyncMock.mockImplementation(() => {
      throw new Error('missing command');
    });

    const report = await inspectModuleEnvironment({
      id: 'shell',
      name: 'Shell',
      type: 'shell',
      scriptPath: '/workspace/demo/run.sh',
      autoStart: false,
      enabled: true,
    });

    expect(report.runtime).toBe('zsh');
    expect(report.requiredCommands).toEqual(['zsh']);
    expect(report.missingCommands).toEqual(['zsh']);
  });
});

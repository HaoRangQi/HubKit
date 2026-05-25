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
import { detectPackageManager, parseEnvTemplate, sanitizeEnvironmentReportForDisplay } from '../../src/runtime/module-environment';
import { ModuleEnvironmentReport } from '../../src/types/module';

describe('module-environment', () => {
  beforeEach(() => {
    (fs.access as jest.Mock).mockReset();
    (fs.readFile as jest.Mock).mockReset();
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
});

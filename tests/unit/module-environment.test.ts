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
import { detectPackageManager, parseEnvTemplate } from '../../src/runtime/module-environment';

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

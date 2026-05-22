jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      access: jest.fn(),
      mkdir: jest.fn(),
      open: jest.fn(),
      writeFile: jest.fn(),
      unlink: jest.fn(),
    },
    statSync: jest.fn(),
  };
});

import { exec } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { NodeJSAdapter } from '../../src/adapters/nodejs-adapter';
import { ModuleMetadata } from '../../src/types/module';

describe('NodeJSAdapter dependency preparation', () => {
  const execMock = exec as unknown as jest.Mock;
  const metadata: ModuleMetadata = {
    id: 'test-node',
    name: 'Test Node',
    type: 'nodejs',
    scriptPath: '/workspace/module/src/index.js',
    autoStart: false,
    enabled: true,
  };

  let adapter: NodeJSAdapter;

  beforeEach(() => {
    adapter = new NodeJSAdapter(metadata);
    (statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
    (fs.readFile as jest.Mock).mockReset();
    (fs.access as jest.Mock).mockReset();
    execMock.mockReset();
  });

  it('installs dependencies with npm ci when package-lock exists and node_modules is missing', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
      dependencies: { express: '^5.0.0' },
    }));
    (fs.access as jest.Mock).mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('node_modules')) throw new Error('missing');
      if (targetPath.endsWith('package-lock.json')) return undefined;
      throw new Error('missing');
    });
    execMock.mockImplementation((_cmd, _opts, callback) => callback(null, 'ok', ''));

    await (adapter as any).prepareForStart();

    expect(execMock).toHaveBeenCalledWith(
      'npm ci',
      { cwd: '/workspace/module/src' },
      expect.any(Function)
    );
  });

  it('skips install when node_modules already exists', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
      dependencies: { express: '^5.0.0' },
    }));
    (fs.access as jest.Mock).mockResolvedValue(undefined);

    await (adapter as any).prepareForStart();

    expect(execMock).not.toHaveBeenCalled();
  });
});

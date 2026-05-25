import { scanAndRegisterModules } from '../../src/cli/commands/module-loader';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';

function moduleMetadata(id: string, overrides: Partial<ModuleMetadata> = {}): ModuleMetadata {
  return {
    id,
    name: id.toUpperCase(),
    type: 'shell',
    scriptPath: `/modules/${id}/run.sh`,
    autoStart: false,
    enabled: true,
    ...overrides,
  };
}

describe('CLI module loader', () => {
  it('scans configured module directories in order and registers discovered modules', async () => {
    const registry = new ModuleRegistry();
    const scanner = {
      scan: jest.fn()
        .mockResolvedValueOnce([moduleMetadata('api'), moduleMetadata('web')])
        .mockResolvedValueOnce([moduleMetadata('worker')]),
    };

    await scanAndRegisterModules(registry, {
      scanner,
      getModuleDirs: () => ['/modules/a', '/modules/b'],
    });

    expect(scanner.scan).toHaveBeenNthCalledWith(1, '/modules/a');
    expect(scanner.scan).toHaveBeenNthCalledWith(2, '/modules/b');
    expect(registry.list().map((module) => module.id)).toEqual(['api', 'web', 'worker']);
  });

  it('does nothing when no module directories are configured', async () => {
    const registry = new ModuleRegistry();
    const scanner = {
      scan: jest.fn(),
    };

    await scanAndRegisterModules(registry, {
      scanner,
      getModuleDirs: () => [],
    });

    expect(scanner.scan).not.toHaveBeenCalled();
    expect(registry.list()).toEqual([]);
  });

  it('propagates scanner failures to the command layer', async () => {
    const registry = new ModuleRegistry();
    const scanner = {
      scan: jest.fn().mockRejectedValue(new Error('scan failed')),
    };

    await expect(scanAndRegisterModules(registry, {
      scanner,
      getModuleDirs: () => ['/broken'],
    })).rejects.toThrow('scan failed');
  });
});

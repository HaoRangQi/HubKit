import { createModuleAdapter } from '../../src/adapters/adapter-factory';
import { NodeJSAdapter } from '../../src/adapters/nodejs-adapter';
import { PythonAdapter } from '../../src/adapters/python-adapter';
import { ShellAdapter } from '../../src/adapters/shell-adapter';
import { ModuleMetadata } from '../../src/types/module';

function moduleOf(type: ModuleMetadata['type']): ModuleMetadata {
  return {
    id: `${type}-module`,
    name: `${type} module`,
    type,
    scriptPath: `/tmp/${type}-module`,
    autoStart: false,
    enabled: true,
  };
}

describe('createModuleAdapter', () => {
  it('creates a Node.js adapter', () => {
    expect(createModuleAdapter(moduleOf('nodejs'))).toBeInstanceOf(NodeJSAdapter);
  });

  it('creates a Python adapter', () => {
    expect(createModuleAdapter(moduleOf('python'))).toBeInstanceOf(PythonAdapter);
  });

  it('creates a Shell adapter', () => {
    expect(createModuleAdapter(moduleOf('shell'))).toBeInstanceOf(ShellAdapter);
  });
});

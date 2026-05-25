import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createModuleConfigTemplate,
  normalizeModuleConfig,
  validateModuleConfig,
} from '../../src/registry/module-config';
import { inferModuleConfig, parseWebPort } from '../../src/cli/commands/init-module';

function createTempModuleDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-module-config-test-'));
}

describe('module-config', () => {
  it('reports field-level validation errors', () => {
    const result = validateModuleConfig({
      id: '',
      name: 'Broken',
      type: 'ruby',
      scriptPath: '',
      webPort: 99999,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['id', 'type', 'scriptPath', 'webPort'])
    );
  });

  it('normalizes relative script paths against the module directory', () => {
    const metadata = normalizeModuleConfig({
      id: 'demo',
      name: 'Demo',
      type: 'nodejs',
      scriptPath: 'src/index.js',
    }, '/tmp/demo-module');

    expect(metadata.scriptPath).toBe(path.join('/tmp/demo-module', 'src/index.js'));
    expect(metadata.autoStart).toBe(false);
    expect(metadata.enabled).toBe(true);
  });

  it('creates a valid template for generated module configs', () => {
    const template = createModuleConfigTemplate({
      id: 'demo',
      name: 'Demo',
      type: 'shell',
      scriptPath: 'run.sh',
      webPort: 3000,
    });

    expect(validateModuleConfig(template).valid).toBe(true);
    expect(template.autoStart).toBe(false);
    expect(template.enabled).toBe(true);
  });
});

describe('init-module inference', () => {
  it('infers node modules from package.json', () => {
    const dir = createTempModuleDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: '@scope/my-tool',
      description: 'Local helper',
    }), 'utf-8');
    fs.writeFileSync(path.join(dir, 'server.js'), 'console.log("ok");');

    const config = inferModuleConfig(dir, {});

    expect(config.id).toBe('scope-my-tool');
    expect(config.name).toBe('@scope/my-tool');
    expect(config.description).toBe('Local helper');
    expect(config.type).toBe('nodejs');
    expect(config.scriptPath).toBe('server.js');
  });

  it('uses explicit options over inferred values', () => {
    const dir = createTempModuleDir();
    fs.writeFileSync(path.join(dir, 'main.py'), 'print("ok")');

    const config = inferModuleConfig(dir, {
      id: 'custom',
      name: 'Custom Module',
      type: 'python',
      script: 'main.py',
      webPort: '8080',
    });

    expect(config).toMatchObject({
      id: 'custom',
      name: 'Custom Module',
      type: 'python',
      scriptPath: 'main.py',
      webPort: 8080,
    });
  });

  it('rejects invalid web ports', () => {
    expect(() => parseWebPort('abc')).toThrow('--web-port');
    expect(() => parseWebPort('70000')).toThrow('--web-port');
    expect(parseWebPort('3000')).toBe(3000);
  });
});

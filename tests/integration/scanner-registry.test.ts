import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleScanner } from '../../src/registry/module-scanner';
import { ModuleMetadata } from '../../src/types/module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ModuleScanner Integration', () => {
  let testDir: string;
  let scanner: ModuleScanner;
  let registry: ModuleRegistry;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubkit-test-'));
    scanner = new ModuleScanner();
    registry = new ModuleRegistry();
  });

  afterEach(() => {
    // 清理测试目录
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should scan and register modules from directory', async () => {
    // 创建测试模块目录
    const moduleDir = path.join(testDir, 'test-module');
    fs.mkdirSync(moduleDir, { recursive: true });

    // 创建模块配置文件
    const config = {
      id: 'test-module',
      name: 'Test Module',
      type: 'nodejs',
      scriptPath: 'index.js',
      enabled: true,
    };

    fs.writeFileSync(
      path.join(moduleDir, '.hubkit.json'),
      JSON.stringify(config, null, 2)
    );

    // 创建脚本文件
    fs.writeFileSync(
      path.join(moduleDir, 'index.js'),
      'console.log("test");'
    );

    // 扫描模块
    const modules = await scanner.scan(testDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].id).toBe('test-module');
    expect(modules[0].name).toBe('Test Module');

    // 注册到注册表
    modules.forEach(m => registry.register(m));
    expect(registry.count()).toBe(1);
  });

  it('should skip invalid module configurations', async () => {
    const moduleDir = path.join(testDir, 'invalid-module');
    fs.mkdirSync(moduleDir, { recursive: true });

    // 创建无效配置（缺少必需字段）
    const config = {
      id: 'invalid',
      // 缺少 name, type, scriptPath
    };

    fs.writeFileSync(
      path.join(moduleDir, '.hubkit.json'),
      JSON.stringify(config, null, 2)
    );

    const modules = await scanner.scan(testDir);
    expect(modules).toHaveLength(0);
  });

  it('should handle nested module directories', async () => {
    // 创建嵌套目录结构
    const module1Dir = path.join(testDir, 'category1', 'module1');
    const module2Dir = path.join(testDir, 'category2', 'module2');

    fs.mkdirSync(module1Dir, { recursive: true });
    fs.mkdirSync(module2Dir, { recursive: true });

    // 创建两个模块
    const config1 = {
      id: 'module1',
      name: 'Module 1',
      type: 'nodejs',
      scriptPath: 'index.js',
    };

    const config2 = {
      id: 'module2',
      name: 'Module 2',
      type: 'python',
      scriptPath: 'main.py',
    };

    fs.writeFileSync(path.join(module1Dir, '.hubkit.json'), JSON.stringify(config1));
    fs.writeFileSync(path.join(module1Dir, 'index.js'), '');
    fs.writeFileSync(path.join(module2Dir, '.hubkit.json'), JSON.stringify(config2));
    fs.writeFileSync(path.join(module2Dir, 'main.py'), '');

    const modules = await scanner.scan(testDir);
    expect(modules).toHaveLength(2);
  });
});

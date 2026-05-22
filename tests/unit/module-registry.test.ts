import { ModuleRegistry } from '../../src/registry/module-registry';
import { ModuleMetadata } from '../../src/types/module';

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  describe('register', () => {
    it('should register a module', () => {
      const module: ModuleMetadata = {
        id: 'test-module',
        name: 'Test Module',
        type: 'nodejs',
        scriptPath: '/path/to/script.js',
        autoStart: false,
        enabled: true,
      };

      registry.register(module);
      expect(registry.has('test-module')).toBe(true);
    });
  });

  describe('get', () => {
    it('should return registered module', () => {
      const module: ModuleMetadata = {
        id: 'test-module',
        name: 'Test Module',
        type: 'nodejs',
        scriptPath: '/path/to/script.js',
        autoStart: false,
        enabled: true,
      };

      registry.register(module);
      const retrieved = registry.get('test-module');
      expect(retrieved).toEqual(module);
    });

    it('should return undefined for non-existent module', () => {
      expect(registry.get('non-existent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return all registered modules', () => {
      const module1: ModuleMetadata = {
        id: 'module-1',
        name: 'Module 1',
        type: 'nodejs',
        scriptPath: '/path/1.js',
        autoStart: false,
        enabled: true,
      };

      const module2: ModuleMetadata = {
        id: 'module-2',
        name: 'Module 2',
        type: 'python',
        scriptPath: '/path/2.py',
        autoStart: false,
        enabled: true,
      };

      registry.register(module1);
      registry.register(module2);

      const modules = registry.list();
      expect(modules).toHaveLength(2);
      expect(modules).toContainEqual(module1);
      expect(modules).toContainEqual(module2);
    });
  });

  describe('listEnabled', () => {
    it('should return only enabled modules', () => {
      const enabled: ModuleMetadata = {
        id: 'enabled',
        name: 'Enabled',
        type: 'nodejs',
        scriptPath: '/path/enabled.js',
        autoStart: false,
        enabled: true,
      };

      const disabled: ModuleMetadata = {
        id: 'disabled',
        name: 'Disabled',
        type: 'nodejs',
        scriptPath: '/path/disabled.js',
        autoStart: false,
        enabled: false,
      };

      registry.register(enabled);
      registry.register(disabled);

      const enabledModules = registry.listEnabled();
      expect(enabledModules).toHaveLength(1);
      expect(enabledModules[0].id).toBe('enabled');
    });
  });

  describe('listByType', () => {
    it('should return modules of specified type', () => {
      const nodejs: ModuleMetadata = {
        id: 'nodejs-module',
        name: 'Node.js Module',
        type: 'nodejs',
        scriptPath: '/path/node.js',
        autoStart: false,
        enabled: true,
      };

      const python: ModuleMetadata = {
        id: 'python-module',
        name: 'Python Module',
        type: 'python',
        scriptPath: '/path/script.py',
        autoStart: false,
        enabled: true,
      };

      registry.register(nodejs);
      registry.register(python);

      const nodejsModules = registry.listByType('nodejs');
      expect(nodejsModules).toHaveLength(1);
      expect(nodejsModules[0].type).toBe('nodejs');
    });
  });

  describe('unregister', () => {
    it('should remove a module', () => {
      const module: ModuleMetadata = {
        id: 'test-module',
        name: 'Test Module',
        type: 'nodejs',
        scriptPath: '/path/to/script.js',
        autoStart: false,
        enabled: true,
      };

      registry.register(module);
      expect(registry.has('test-module')).toBe(true);

      registry.unregister('test-module');
      expect(registry.has('test-module')).toBe(false);
    });
  });

  describe('count', () => {
    it('should return correct count', () => {
      expect(registry.count()).toBe(0);

      const module: ModuleMetadata = {
        id: 'test-module',
        name: 'Test Module',
        type: 'nodejs',
        scriptPath: '/path/to/script.js',
        autoStart: false,
        enabled: true,
      };

      registry.register(module);
      expect(registry.count()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all modules', () => {
      const module: ModuleMetadata = {
        id: 'test-module',
        name: 'Test Module',
        type: 'nodejs',
        scriptPath: '/path/to/script.js',
        autoStart: false,
        enabled: true,
      };

      registry.register(module);
      expect(registry.count()).toBe(1);

      registry.clear();
      expect(registry.count()).toBe(0);
    });
  });
});

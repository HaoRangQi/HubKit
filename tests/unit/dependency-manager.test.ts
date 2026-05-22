import { DependencyManager } from '../../src/dependency/dependency-manager';

describe('DependencyManager', () => {
  let manager: DependencyManager;

  beforeEach(() => {
    manager = new DependencyManager();
  });

  describe('addDependency', () => {
    it('should add dependencies for a module', () => {
      manager.addDependency('module-a', ['module-b', 'module-c']);
      const deps = manager.getDependencies('module-a');
      expect(deps).toEqual(['module-b', 'module-c']);
    });
  });

  describe('getDependencies', () => {
    it('should return empty array for module with no dependencies', () => {
      const deps = manager.getDependencies('module-a');
      expect(deps).toEqual([]);
    });
  });

  describe('hasCircularDependency', () => {
    it('should detect circular dependency', () => {
      manager.addDependency('a', ['b']);
      manager.addDependency('b', ['c']);
      manager.addDependency('c', ['a']);

      expect(manager.hasCircularDependency('a')).toBe(true);
    });

    it('should return false for non-circular dependencies', () => {
      manager.addDependency('a', ['b']);
      manager.addDependency('b', ['c']);

      expect(manager.hasCircularDependency('a')).toBe(false);
    });
  });

  describe('topologicalSort', () => {
    it('should return correct order for linear dependencies', () => {
      manager.addDependency('a', []);
      manager.addDependency('b', ['a']);
      manager.addDependency('c', ['b']);

      const sorted = manager.topologicalSort(['a', 'b', 'c']);
      expect(sorted).toEqual(['a', 'b', 'c']);
    });

    it('should handle parallel dependencies', () => {
      manager.addDependency('a', []);
      manager.addDependency('b', []);
      manager.addDependency('c', ['a', 'b']);

      const sorted = manager.topologicalSort(['a', 'b', 'c']);
      expect(sorted[2]).toBe('c');
      expect(sorted.slice(0, 2)).toContain('a');
      expect(sorted.slice(0, 2)).toContain('b');
    });

    it('should handle modules with no dependencies', () => {
      const sorted = manager.topologicalSort(['a', 'b', 'c']);
      expect(sorted).toHaveLength(3);
    });
  });

  describe('getAllDependencies', () => {
    it('should return all transitive dependencies', () => {
      manager.addDependency('a', ['b']);
      manager.addDependency('b', ['c']);
      manager.addDependency('c', ['d']);

      const allDeps = manager.getAllDependencies('a');
      expect(allDeps).toContain('b');
      expect(allDeps).toContain('c');
      expect(allDeps).toContain('d');
      expect(allDeps).toHaveLength(3);
    });

    it('should handle modules with no dependencies', () => {
      const allDeps = manager.getAllDependencies('a');
      expect(allDeps).toEqual([]);
    });
  });
});

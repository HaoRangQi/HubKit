import { ModuleMetadata } from '../types/module';

/**
 * 依赖关系
 */
export interface ModuleDependency {
  moduleId: string;
  dependsOn: string[];
}

/**
 * 依赖管理器
 * 管理模块间的依赖关系
 */
export class DependencyManager {
  private dependencies: Map<string, string[]>;

  constructor() {
    this.dependencies = new Map();
  }

  /**
   * 添加依赖
   */
  addDependency(moduleId: string, dependsOn: string[]): void {
    this.dependencies.set(moduleId, dependsOn);
  }

  /**
   * 获取依赖
   */
  getDependencies(moduleId: string): string[] {
    return this.dependencies.get(moduleId) || [];
  }

  /**
   * 检查循环依赖
   */
  hasCircularDependency(moduleId: string): boolean {
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (id: string): boolean => {
      if (stack.has(id)) return true;
      if (visited.has(id)) return false;

      visited.add(id);
      stack.add(id);

      const deps = this.getDependencies(id);
      for (const dep of deps) {
        if (dfs(dep)) return true;
      }

      stack.delete(id);
      return false;
    };

    return dfs(moduleId);
  }

  /**
   * 拓扑排序
   * 返回启动顺序
   */
  topologicalSort(moduleIds: string[]): string[] {
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    // 初始化
    for (const id of moduleIds) {
      inDegree.set(id, 0);
      graph.set(id, []);
    }

    // 构建图
    for (const id of moduleIds) {
      const deps = this.getDependencies(id);
      for (const dep of deps) {
        if (moduleIds.includes(dep)) {
          graph.get(dep)!.push(id);
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
        }
      }
    }

    // 拓扑排序
    const queue: string[] = [];
    const result: string[] = [];

    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);

      for (const next of graph.get(id) || []) {
        const degree = inDegree.get(next)! - 1;
        inDegree.set(next, degree);
        if (degree === 0) {
          queue.push(next);
        }
      }
    }

    return result;
  }

  /**
   * 获取所有依赖（递归）
   */
  getAllDependencies(moduleId: string): string[] {
    const result = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const deps = this.getDependencies(id);
      for (const dep of deps) {
        result.add(dep);
        dfs(dep);
      }
    };

    dfs(moduleId);
    return Array.from(result);
  }
}

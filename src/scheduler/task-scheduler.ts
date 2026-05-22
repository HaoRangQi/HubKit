import { ModuleRegistry } from '../registry/module-registry';
import { DependencyManager } from '../dependency/dependency-manager';
import { ProcessManager } from '../process/process-manager';
import { LogManager } from '../log/log-manager';

/**
 * 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * 任务
 */
export interface Task {
  id: string;
  moduleId: string;
  action: 'start' | 'stop' | 'restart';
  status: TaskStatus;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * 任务调度器
 * 管理任务的调度和执行
 */
export class TaskScheduler {
  private tasks: Map<string, Task>;
  private queue: Task[];
  private running: Set<string>;
  private maxConcurrency: number;

  constructor(
    private registry: ModuleRegistry,
    private dependencyManager: DependencyManager,
    private processManager: ProcessManager,
    private logManager: LogManager,
    maxConcurrency: number = 5
  ) {
    this.tasks = new Map();
    this.queue = [];
    this.running = new Set();
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 添加任务
   */
  addTask(moduleId: string, action: 'start' | 'stop' | 'restart'): string {
    const taskId = `${moduleId}-${action}-${Date.now()}`;
    const task: Task = {
      id: taskId,
      moduleId,
      action,
      status: TaskStatus.PENDING,
    };

    this.tasks.set(taskId, task);
    this.queue.push(task);

    return taskId;
  }

  /**
   * 执行任务队列
   */
  async execute(): Promise<void> {
    while (this.queue.length > 0 || this.running.size > 0) {
      // 启动新任务
      while (this.queue.length > 0 && this.running.size < this.maxConcurrency) {
        const task = this.queue.shift()!;
        this.running.add(task.id);
        this.executeTask(task);
      }

      // 等待一段时间
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: Task): Promise<void> {
    try {
      task.status = TaskStatus.RUNNING;
      task.startedAt = new Date();

      const module = this.registry.get(task.moduleId);
      if (!module) {
        throw new Error(`Module not found: ${task.moduleId}`);
      }

      // 检查依赖
      const deps = this.dependencyManager.getDependencies(task.moduleId);
      for (const dep of deps) {
        if (!this.processManager.isRunning(dep)) {
          throw new Error(`Dependency not running: ${dep}`);
        }
      }

      // 执行操作
      switch (task.action) {
        case 'start':
          // 启动模块
          await this.startModule(task.moduleId);
          break;
        case 'stop':
          this.processManager.stop(task.moduleId);
          break;
        case 'restart':
          this.processManager.stop(task.moduleId);
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.startModule(task.moduleId);
          break;
      }

      task.status = TaskStatus.COMPLETED;
      task.completedAt = new Date();

      this.logManager.write(task.moduleId, 'info', `Task ${task.action} completed`);
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = new Date();

      this.logManager.write(task.moduleId, 'error', `Task ${task.action} failed: ${task.error}`);
    } finally {
      this.running.delete(task.id);
    }
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 列出所有任务
   */
  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 批量启动模块（按依赖顺序）
   */
  async startAll(moduleIds: string[]): Promise<void> {
    const sorted = this.dependencyManager.topologicalSort(moduleIds);
    for (const moduleId of sorted) {
      this.addTask(moduleId, 'start');
    }
    await this.execute();
  }

  /**
   * 批量停止模块（逆依赖顺序）
   */
  async stopAll(moduleIds: string[]): Promise<void> {
    const sorted = this.dependencyManager.topologicalSort(moduleIds).reverse();
    for (const moduleId of sorted) {
      this.addTask(moduleId, 'stop');
    }
    await this.execute();
  }

  /**
   * 启动单个模块
   */
  private async startModule(moduleId: string): Promise<void> {
    const module = this.registry.get(moduleId);
    if (!module) {
      throw new Error(`Module not found: ${moduleId}`);
    }

    // 这里简化实现，实际应该通过适配器启动
    // 在真实场景中，需要创建适配器实例并调用 start()
    this.logManager.write(moduleId, 'info', `Module ${moduleId} started`);
  }
}

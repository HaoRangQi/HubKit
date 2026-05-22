import { ModuleRegistry } from '../registry/module-registry';
import { ProcessManager } from '../process/process-manager';
import { ModuleProtocol, ModuleStatus } from '../types/module';

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  moduleId: string;
  healthy: boolean;
  status: ModuleStatus;
  message?: string;
  checkedAt: Date;
}

/**
 * 健康检查管理器
 * 定期检查模块健康状态
 */
export class HealthCheckManager {
  private checkInterval: NodeJS.Timeout | null = null;
  private results: Map<string, HealthCheckResult>;

  constructor(
    private registry: ModuleRegistry,
    private processManager: ProcessManager,
    private intervalMs: number = 60000 // 默认 1 分钟
  ) {
    this.results = new Map();
  }

  /**
   * 启动健康检查
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAll();
    }, this.intervalMs);

    // 立即执行一次
    this.checkAll();
  }

  /**
   * 停止健康检查
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 检查所有模块
   */
  private async checkAll(): Promise<void> {
    const modules = this.registry.listEnabled();

    for (const module of modules) {
      try {
        const result = await this.checkModule(module.id);
        this.results.set(module.id, result);

        if (!result.healthy) {
          console.warn(`Health check failed for ${module.id}: ${result.message}`);
        }
      } catch (error) {
        console.error(`Health check error for ${module.id}:`, error);
      }
    }
  }

  /**
   * 检查单个模块
   */
  async checkModule(moduleId: string): Promise<HealthCheckResult> {
    const module = this.registry.get(moduleId);
    if (!module) {
      return {
        moduleId,
        healthy: false,
        status: ModuleStatus.UNKNOWN,
        message: 'Module not found',
        checkedAt: new Date(),
      };
    }

    try {
      const isRunning = this.processManager.isRunning(moduleId);

      if (!isRunning && module.enabled) {
        return {
          moduleId,
          healthy: false,
          status: ModuleStatus.STOPPED,
          message: 'Module should be running but is stopped',
          checkedAt: new Date(),
        };
      }

      return {
        moduleId,
        healthy: true,
        status: isRunning ? ModuleStatus.RUNNING : ModuleStatus.STOPPED,
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        moduleId,
        healthy: false,
        status: ModuleStatus.ERROR,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
      };
    }
  }

  /**
   * 获取健康检查结果
   */
  getResult(moduleId: string): HealthCheckResult | undefined {
    return this.results.get(moduleId);
  }

  /**
   * 获取所有结果
   */
  getAllResults(): HealthCheckResult[] {
    return Array.from(this.results.values());
  }

  /**
   * 获取不健康的模块
   */
  getUnhealthyModules(): HealthCheckResult[] {
    return this.getAllResults().filter(r => !r.healthy);
  }
}

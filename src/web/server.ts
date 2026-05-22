import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { ModuleRegistry } from '../registry/module-registry';
import { ModuleScanner } from '../registry/module-scanner';
import { config } from '../config/config';
import { createApiRouter } from './api/routes';
import { NodeJSAdapter } from '../adapters/nodejs-adapter';
import { PythonAdapter } from '../adapters/python-adapter';
import { ShellAdapter } from '../adapters/shell-adapter';
import { ModuleProtocol } from '../types/module';
import { ModuleScheduler } from '../scheduler/module-scheduler';

/**
 * HubKit Web 服务器
 */
export class WebServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private registry: ModuleRegistry;
  private scheduler: ModuleScheduler;
  private port: number;

  constructor(port: number = 2281) {
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.registry = new ModuleRegistry();
    this.scheduler = new ModuleScheduler(this.registry);
    this.scheduler.setEventListener((event) => this.broadcast(event));

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // API 路由
    this.app.use('/api', createApiRouter(this.registry, this.wss));

    // 首页
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  /**
   * 设置 WebSocket
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      console.log('WebSocket 客户端已连接');

      ws.on('message', (message) => {
        console.log('收到消息:', message.toString());
      });

      ws.on('close', () => {
        console.log('WebSocket 客户端已断开');
      });

      // 发送欢迎消息
      ws.send(JSON.stringify({ type: 'connected', message: 'HubKit WebSocket 已连接' }));
    });
  }

  /**
   * 扫描并加载模块
   */
  async loadModules(): Promise<void> {
    const scanner = new ModuleScanner();
    const moduleDirs = config.getModuleDirs();

    for (const dir of moduleDirs) {
      const modules = await scanner.scan(dir);
      modules.forEach(m => this.registry.register(m));
    }

    console.log(`已加载 ${this.registry.list().length} 个模块`);
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    await this.loadModules();
    await this.autoStartModules();
    this.scheduler.start();

    this.server.listen(this.port, () => {
      console.log(`\n🚀 HubKit Web 服务器已启动`);
      console.log(`📊 Dashboard: http://localhost:${this.port}`);
      console.log(`🔌 WebSocket: ws://localhost:${this.port}`);
      console.log(`\n按 Ctrl+C 停止服务器\n`);
    });
  }

  /**
   * 按配置顺序自动启动模块
   */
  private async autoStartModules(): Promise<void> {
    const settings = config.getSettings();
    const modules = this.registry.list();
    const order = settings.startOrder;

    const toStart = modules
      .filter(m => settings.autoStart[m.id])
      .sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

    for (const module of toStart) {
      try {
        const adapter = this.createModuleAdapter(module);
        await adapter.start();
        console.log(`✅ 自动启动: ${module.name}`);
      } catch (error) {
        console.error(`❌ 自动启动失败: ${module.name}`, error);
      }
    }
  }

  /**
   * 创建模块适配器
   */
  private createModuleAdapter(module: any): ModuleProtocol {
    switch (module.type) {
      case 'nodejs':
        return new NodeJSAdapter(module);
      case 'python':
        return new PythonAdapter(module);
      case 'shell':
        return new ShellAdapter(module);
      default:
        throw new Error(`不支持的模块类型: ${module.type}`);
    }
  }

  /**
   * 停止服务器
   */
  stop(): void {
    this.scheduler.stop();
    this.wss.close();
    this.server.close();
  }

  /**
   * 广播消息到所有 WebSocket 客户端
   */
  broadcast(message: any): void {
    const data = JSON.stringify(message);
    this.wss.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(data);
      }
    });
  }
}

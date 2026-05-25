import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer, IncomingMessage } from 'http';
import path from 'path';
import { ModuleRegistry } from '../registry/module-registry';
import { ModuleScanner } from '../registry/module-scanner';
import { config } from '../config/config';
import { createApiRouter } from './api/routes';
import { ScriptBundleManager } from '../script-bundle/script-bundle-manager';
import { BootPreferenceService } from '../system-actions/boot-preference-service';
import { ModuleScheduler } from '../scheduler/module-scheduler';
import { moduleRuntimeStateStore } from '../runtime/module-runtime-state';
import { ModuleLifecycle } from '../runtime/module-lifecycle';

export const DEFAULT_WEB_HOST = '127.0.0.1';

export function isAllowedWebOrigin(origin: string | undefined, requestHost: string | undefined, boundHost: string): boolean {
  if (!origin || isLocalHost(boundHost)) return true;

  const normalizedRequestHost = normalizeHostHeader(requestHost);
  if (!normalizedRequestHost) return false;

  try {
    const parsedOrigin = new URL(origin);
    const originHost = normalizeHostHeader(parsedOrigin.host);
    return originHost === normalizedRequestHost;
  } catch {
    return false;
  }
}

/**
 * HubKit Web 服务器
 */
export class WebServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private registry: ModuleRegistry;
  private scriptBundleManager: ScriptBundleManager;
  private bootPreferenceService: BootPreferenceService;
  private scheduler: ModuleScheduler;
  private lifecycle: ModuleLifecycle;
  private port: number;
  private host: string;

  constructor(port: number = 2281, host: string = DEFAULT_WEB_HOST) {
    this.port = port;
    this.host = host;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: (info: { origin?: string; req: IncomingMessage }) => this.isAllowedOrigin(info.origin, info.req),
    });
    this.registry = new ModuleRegistry();
    this.scriptBundleManager = new ScriptBundleManager(config.getDataDir(), (message) => this.broadcast(message));
    this.bootPreferenceService = new BootPreferenceService(config.getDataDir(), (message) => this.broadcast(message));
    this.lifecycle = new ModuleLifecycle();
    this.scheduler = new ModuleScheduler(this.registry, this.lifecycle);
    this.scheduler.setEventListener((event) => this.broadcast(event));
    moduleRuntimeStateStore.on('change', (moduleId, runtimeState) => {
      this.broadcast({ type: 'module_runtime_updated', moduleId, runtimeState });
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use('/api', this.originGuard.bind(this));
    this.app.use(cors((req: IncomingMessage, callback: (err: Error | null, options?: cors.CorsOptions) => void) => {
      callback(null, { origin: this.isAllowedOrigin(req.headers.origin, req as Request) });
    }));
    this.app.use('/vendor/xterm', express.static(path.join(process.cwd(), 'node_modules', '@xterm', 'xterm', 'lib')));
    this.app.use('/vendor/xterm-css', express.static(path.join(process.cwd(), 'node_modules', '@xterm', 'xterm', 'css')));
    this.app.use('/vendor/xterm-fit', express.static(path.join(process.cwd(), 'node_modules', '@xterm', 'addon-fit', 'lib')));
    this.app.use('/vendor/xterm-web-links', express.static(path.join(process.cwd(), 'node_modules', '@xterm', 'addon-web-links', 'lib')));
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // API 路由
    this.app.use('/api', createApiRouter(this.registry, this.wss, this.scriptBundleManager, this.bootPreferenceService, this.scheduler, this.lifecycle));

    // 首页
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  private originGuard(req: Request, res: Response, next: express.NextFunction): void {
    if (this.isAllowedOrigin(req.get('origin'), req)) {
      next();
      return;
    }

    res.status(403).json({ success: false, error: 'Origin 不被允许' });
  }

  private isAllowedOrigin(origin: string | undefined, req?: Request | IncomingMessage): boolean {
    const requestHost = req?.headers.host;
    return isAllowedWebOrigin(origin, Array.isArray(requestHost) ? requestHost[0] : requestHost, this.host);
  }

  /**
   * 设置 WebSocket
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      console.log('WebSocket 客户端已连接');

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'terminal_input' && typeof data.sessionId === 'string' && typeof data.data === 'string') {
            const ok = this.scriptBundleManager.writeTerminalInput(data.sessionId, data.data);
            if (!ok) {
              ws.send(JSON.stringify({ type: 'terminal_error', sessionId: data.sessionId, message: '终端会话不存在或已结束' }));
            }
            return;
          }
          if (data.type === 'terminal_resize' && typeof data.sessionId === 'string') {
            this.scriptBundleManager.resizeTerminalSession(data.sessionId, Number(data.cols), Number(data.rows));
            return;
          }
          if (data.type === 'terminal_kill' && typeof data.sessionId === 'string') {
            this.scriptBundleManager.killTerminalSession(data.sessionId);
            return;
          }
          console.log('收到消息:', message.toString());
        } catch {
          console.log('收到消息:', message.toString());
        }
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

    await this.scriptBundleManager.loadFromDirectories(moduleDirs);

    console.log(`已加载 ${this.registry.list().length} 个模块`);
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    await this.loadModules();
    await this.autoStartModules();
    this.scheduler.start();

    this.server.listen(this.port, this.host, () => {
      const dashboardHost = formatDashboardHost(this.host);
      console.log(`\n🚀 HubKit Web 服务器已启动`);
      console.log(`📊 Dashboard: http://${dashboardHost}:${this.port}`);
      console.log(`🔌 WebSocket: ws://${dashboardHost}:${this.port}`);
      if (!isLocalHost(this.host)) {
        console.log(`⚠️  已显式绑定到 ${this.host}，请只在可信网络中访问。`);
      }
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
        await this.lifecycle.start(module);
        console.log(`✅ 自动启动: ${module.name}`);
      } catch (error) {
        console.error(`❌ 自动启动失败: ${module.name}`, error);
      }
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

function formatDashboardHost(host: string): string {
  if (host === '0.0.0.0') return 'localhost';
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;
  return host;
}

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function normalizeHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;

  try {
    return new URL(`http://${trimmed}`).host;
  } catch {
    return null;
  }
}

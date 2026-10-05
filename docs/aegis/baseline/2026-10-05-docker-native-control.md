# Docker / 本机服务基线

- 基于 7a32402 的原生执行架构增加容器控制入口。
- Dockerfile / docker/Caddyfile / compose.yaml：Caddy 标准反向代理，发布回环 2281，后端 host.docker.internal:2282。
- 容器 user 1000:1000、只读文件系统、cap_drop ALL，仅临时目录可写。官方 Caddy 文件绑定权限在镜像构建时移除，避免无权限启动失败。
- src/integration/hubkit-service-manager.ts：主服务 plist 安装、启停、状态和卸载；label io.hubkit.runtime，与模块 LaunchAgent 管理分开。
- src/cli/commands/service.ts：hub service install/start/stop/status/uninstall。
- 安装 Docker 启动.command：一次性构建、服务安装、容器创建、入口就绪检查。
- 后端仍是 Mac 原有 WebServer / ModuleLifecycle。工作目录不变，所以 .hub 中的 PID / 日志仍可发现；配置继续使用 ~/.hubkit。
- 入口停止不暂停本机定时器和模块；卸载主服务不删除任务数据、不隐式停止模块。
- 验证：64 套 / 502 项测试、构建、Caddy 配置校验、实际 HTTP / WebSocket、容器停止后原生 PID 不变、离线页503。详见对应 work 证据。

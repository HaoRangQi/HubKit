# Docker 控制入口与 Mac 执行服务

## Goal

用户希望在 Docker/OrbStack 中启停入口，具体事务仍在本机执行。一次安装后无需再次定位项目或记住启动命令。

## Architecture / Tech Stack

Caddy 容器通过 host.docker.internal:2282 转发 HTTP 和 WebSocket；现有 Node.js HubKit Web 服务作为 macOS 用户 LaunchAgent 运行于 127.0.0.1:2282，工作目录仍为仓库。用户入口由 Compose 绑定 127.0.0.1:2281。

本机服务由新 HubKitServiceManager 管理，独立于现有按模块生成的 LaunchAgentManager；不扩充模块协议。容器不挂载源码、主目录、Docker socket，不添加宿主命令执行接口。

## Baseline / Compatibility

基线 7a32402、README、module-protocol.md、web/server.ts、launchagent-manager.ts。继续在 develop 实施；本机 ~/.hubkit 配置与仓库 .hub 运行数据不变。旧原生命令仍有效。

停止容器默认只停止控制入口；任务和本机后台服务继续运行。停止本机服务使用 hub service stop；不隐式关停模块。首次迁移只停止本会话启动的旧 Web 进程，保留模块进程。

## Options / Decision

完整容器化无法直接操作 Mac 系统；容器用 SSH 控制宿主会新增凭据与权限面；采用现有本机执行服务 + 标准反向代理最小化改动。一次安装需要 Node/npm 和已运行的 OrbStack/Docker Desktop，之后容器可在 GUI 启停。

## Tasks / Verification

1. 先补 service CLI 注册、plist 参数转义、安装/停止/卸载边界测试；运行失败后实现管理器和 CLI。
2. 添加 Dockerfile、compose.yaml、.dockerignore、docker/Caddyfile 和可双击的一次性安装入口。支持 HTTP/WebSocket；后端离线显示恢复说明。
3. Docker 构建与配置校验；安装本机服务，迁移旧 Web 进程，在 Docker 中实际运行。确认页面、API、WebSocket、停止入口后本机服务存活、再启动恢复。
4. npm test -- --runInBand；npm run build；git diff --check；文档与架构决策记录；develop 本地提交。

TDD Route: strict（服务管理、CLI）；容器声明配置以 docker compose config、caddy validate 和真实链路验证。

## Risk / Retirement

项目或 Node 路径改变后需重新安装 LaunchAgent。容器停止不等于任务停止。平台限定 macOS 本机服务；Docker Desktop/OrbStack 桥接需实测。保留原生 web 命令作为独立运行方式；移除本会话临时后台 Web 进程后改用 launchd，避免重复定时器。ArchitectureReviewRequired: yes；需 ADR 记录容器与执行环境边界。

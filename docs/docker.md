# 用 Docker 启停 HubKit 入口

HubKit 的 Docker 模式把控制台入口放进容器，脚本、终端和系统操作继续在 Mac 上执行。首次安装后，在 OrbStack / Docker Desktop 中找到 `hubkit` 容器，点击启动或停止即可。

## 一次性安装

需要已安装 Node.js、npm 和 OrbStack 或 Docker Desktop。先启动容器应用，然后双击项目根目录的 **`安装 Docker 启动.command`**。

这个入口会构建 HubKit、安装当前用户的本机后台服务，并创建 `hubkit` 容器。首次运行需要联网拉取 Caddy 官方镜像。安装不需要 sudo。

如果已经用原生命令在 `2281` 启动了 HubKit，请先退出那个 Web 进程，避免占用容器入口端口。退出控制服务不会自动关停已有模块。

安装完成后打开 [HubKit 控制台](http://127.0.0.1:2281/)。以后无须定位仓库或记住启动命令。

## 日常使用

| 操作 | 结果 |
| --- | --- |
| 在容器应用里启动 `hubkit` | 打开控制台入口，连接 Mac 本机执行服务 |
| 停止 `hubkit` | 关闭入口；本机服务、定时器与已启动任务继续运行 |
| 重启 `hubkit` | 控制台连接短暂断开并恢复，不重启本机任务 |
| 登录 Mac | 本机服务自动启动；容器由 Docker 的运行状态和重启策略决定是否启动 |

容器使用 `unless-stopped`：Docker 引擎恢复时会恢复原先运行的容器；手动停止的容器保持停止。需要停止具体任务时，先在 Dashboard 内停止对应模块。

## 执行边界

```mermaid
flowchart LR
  Browser[浏览器 127.0.0.1:2281] --> Container[Docker 中的 Caddy 入口]
  Container --> Native[Mac 本机 HubKit 127.0.0.1:2282]
  Native --> Tasks[本机脚本、工具和系统操作]
```

- 容器转发现有 HTTP API 和 WebSocket，不增加宿主命令执行接口。
- 容器通过 `host.docker.internal` 访问 Mac 服务；这是 [OrbStack 的宿主网络入口](https://docs.orbstack.dev/docker/network)。WebSocket 使用 [Caddy 原生代理能力](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
- 容器以非 root 用户、只读文件系统运行，仅 `/tmp` 可写；不挂载主目录、项目目录或 Docker socket。
- 只有 `127.0.0.1:2281` 发布给 Mac；本机执行服务也只监听回环地址。
- 所有原有配置、模块目录、日志与执行环境继续留在 Mac，容器镜像不包含这些数据。
- 本机服务安装目前支持 macOS；已在 OrbStack 实测。Docker Desktop 使用同类宿主连接方式，本次没有在 Docker Desktop 引擎上重复实测。

## 本机后台服务

后台服务由当前用户的 LaunchAgent 管理：

- 标签：`io.hubkit.runtime`
- 安装位置：`~/Library/LaunchAgents/io.hubkit.runtime.plist`
- 日志：`~/.hubkit/logs/hubkit-service.out.log` 和 `hubkit-service.err.log`
- 工作目录：安装时的 HubKit 仓库目录
- 本机端口：`2282`

原有按模块生成的 LaunchAgent 与这个主服务相互独立。当前 Node.js 路径和工具搜索路径会记录在安装配置中；升级 Node、移动项目或切换代码后，重新双击安装入口即可重新构建并刷新服务配置。

需要手动管理时，在仓库目录运行：

```bash
node dist/cli/index.js service status
node dist/cli/index.js service stop
node dist/cli/index.js service start
```

停止本机控制服务不会自动停止已经启动的模块，但定时调度和控制台会暂时不可用。

## 故障与恢复

- **Docker 提示未启动**：先打开 OrbStack / Docker Desktop，再运行安装入口。
- **2281 端口被占用**：退出旧原生 Web 服务，或用 `HUBKIT_PORT=2283 docker compose up -d` 选择入口端口。后端仍使用 2282。
- **页面提示本机执行服务未连接**：容器已运行，后端暂时不可达。先检查 `service status`；项目或 Node 路径变化时重新安装。
- **容器显示 unhealthy**：健康检查会访问整个转发链路，通常意味着本机后端尚未就绪；可查看容器和本机服务日志。
- **某个模块启动失败**：仍按原生模块方式排查 Mac 上的依赖、环境变量和端口；在 Docker 中安装依赖不会修复 Mac 执行环境。

## 卸载或回到原生运行

```bash
docker compose down
node dist/cli/index.js service uninstall
node dist/cli/index.js web --port 2281
```

卸载后台服务保留配置、模块和日志；本机任务也不会被隐式终止。再次使用 Docker 模式时重跑安装入口。

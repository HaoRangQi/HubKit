# ADR 0001：Docker 控制入口与 Mac 本机执行服务

日期：2026-10-05
状态：已采用

## 背景

用户希望在容器应用中启停 HubKit，避免反复查找仓库和输入命令，并明确事务可以留在 Mac 上执行。现有模块涉及 zsh、Ghostty、本机终端和系统偏好，完整迁入 Linux 容器会改变功能。

## 决策

- Docker 只运行 Caddy，转发现有 HTTP / WebSocket 到 host.docker.internal:2282。
- Mac 的当前用户 LaunchAgent `io.hubkit.runtime` 常驻运行现有 WebServer，绑定 127.0.0.1:2282，并保留安装时仓库工作目录。
- 容器发布 127.0.0.1:2281。停止容器只关闭控制入口；本机服务、定时器与已启动任务继续运行。
- 一次性安装命令文件负责构建、安装本机服务和创建容器。原生 web 命令继续支持。
- 不引入 SSH、Docker socket、主目录挂载或宿主命令执行 API。

## 备选与取舍

完整容器化隔离清晰，但无法保持 Mac 系统操作；通过容器远程启动宿主进程需要新增凭据和控制协议。本方案复用现有执行 API 与标准代理，代价是本机后台服务独立于容器运行。

## 所有者与兼容

主服务安装由 HubKitServiceManager 维护；原有 LaunchAgentManager 继续只管理模块。配置、PID / 日志位置、模块协议、高风险确认均不变。停止容器不能被解释为暂停定时任务，这个边界必须保留在用户文档中。

## 证据与限制

已在 macOS + OrbStack 实际构建、运行，验证 HTTP、模块 API、WebSocket、入口停启和后端离线页。Docker Desktop 的网络方式有文档依据，但未在本机另一个 Docker 引擎上重复实测。重新定位项目或 Node 安装后需刷新 LaunchAgent。

基线同步：[Docker 运行基线](../baseline/2026-10-05-docker-native-control.md)。

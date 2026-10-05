# 证据

- 起点：7a32402，工作树初始干净。
- 新服务测试先失败：service 命令不存在、管理器不存在；实现后2套/10项相关测试通过。
- npm test -- --runInBand：64 套 / 502 项通过，退出0，日志 /tmp/hubkit-docker-tests.log。
- npm run build、bash -n 安装入口、git diff --check：均退出0。
- docker compose config --quiet、docker compose build：成功，镜像 hubkit/control:local，构建日志 /tmp/hubkit-docker-build.log。
- caddy validate：Valid configuration。首次启动发现官方二进制 file capability 与 cap_drop ALL 冲突；getcap 确认 cap_net_bind_service=ep，在镜像内移除后通过。存储移至容器 /tmp，清理只读 /data 告警。
- service install：成功；plutil -lint plist：OK；launchctl 服务已加载，端口2282，PID67062。
- Docker 入口 HTTP200；/api/modules 返回5个本机模块。
- ws://127.0.0.1:2281：升级成功，收到本机服务 connected 欢迎消息。
- docker compose stop：原生2282接口仍HTTP200，PID保持67062；docker compose start 后2281接口恢复200。
- 单独临时容器使用不可达上游：返回503和本机服务恢复说明；临时容器已删除。
- docker inspect：running healthy，user1000:1000，readonly=true，cap_drop ALL。

## 覆盖范围与边界

实测环境为 macOS + OrbStack；没有在 Docker Desktop 引擎重复实测，没有执行真实系统偏好修改或模块安装。停止容器不停止本机任务的行为通过独立进程和接口验证；核心模块生命周期沿用原实现和既有测试。

## 架构 / 复杂度 / 退役

新增管理器123行、CLI33行、Dockerfile16行、compose20行、Caddyfile14行，无新依赖进入 npm。Caddy 提供成熟代理，未自建HTTP/WS协议。主服务与模块服务各有独立所有者；旧临时Web进程已退出，避免双定时器。原生命令作为独立使用方式保留，不是备用执行链。

ADR0001已记录用户期望与生命周期边界，Docker基线已同步。置信度B：直接自动化与真实容器证据充分，平台矩阵与登录重启仍由macOS正常LaunchAgent机制承担，未声称做过机器重启验证。

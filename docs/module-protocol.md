# HubKit 模块接入与运行契约

本文描述当前内置 Node.js、Python、Shell 适配器实际支持的行为。首次接入按 [模块接入指南](./module-integration-guide.md) 操作。

## 接入模型

模块是可以独立启动的本机程序，由项目内的 `.hubkit.json` 描述。HubKit 扫描配置、选择语言适配器，再启动和观察进程。

内置适配器启动时忽略 stdin，将 stdout / stderr 写入日志。模块只需正常运行、输出日志和处理退出信号，无须实现 JSON 请求分发器，也无须自己响应 `status` / `start` / `stop` RPC。

代码中的 `ModuleProtocol` 是 HubKit 内部适配器的 TypeScript 接口，不是发给模块脚本的通信协议。旧版文档和 `examples/` 中的 stdio 请求/响应示例不属于当前内置接入流程。

## 配置文件

```json
{
  "id": "my-service",
  "name": "My Service",
  "description": "本地开发服务",
  "type": "nodejs",
  "scriptPath": ".",
  "startScript": "dev",
  "webPort": 3000,
  "autoStart": false,
  "enabled": true,
  "updateable": false
}
```

| 字段 | 含义 |
| --- | --- |
| `id` | 必填、非空且应保持唯一；建议小写字母、数字、点、下划线和短横线 |
| `name` | 必填、非空，显示名称 |
| `type` | 必填：`nodejs`、`python` 或 `shell` |
| `scriptPath` | 必填：相对 `.hubkit.json` 所在目录解析，也支持绝对路径；入口必须存在 |
| `description` | 可选，模块用途 |
| `startScript` | 可选，Node.js 的 npm script 名称，优先于 `package.json` 的 `start` |
| `webUrl` / `webPort` | 可选，Web 入口和端口；端口范围为 1–65535 |
| `autoStart` | 可选，默认 `false`；Web 启动时采用 HubKit 运行设置中的自启配置 |
| `enabled` | 可选，默认 `true` |
| `updateable` | 可选，表示允许更新检查和更新操作；不代表已经发现新版本 |
| `repoUrl` | 可选，源码仓库地址信息；不会自动克隆或设置 git remote |

扫描器从 `~/.hubkit/config.json` 的 `moduleDirs` 下发现含 `.hubkit.json` 的项目子目录。`moduleDirs` 应包含项目的父目录。字段校验和规范化的实现位于 `src/registry/module-config.ts`。

## 启动与运行

| 类型 | 当前启动规则 |
| --- | --- |
| Node.js | `startScript` → `npm run <名称>`；否则优先 `npm start`；没有 start 脚本时运行 `node <scriptPath>`。工作目录为模块项目目录 |
| Python | 运行脚本，优先查找脚本同目录的 `venv` / `.venv` 解释器，否则使用系统 Python；启用无缓冲输出 |
| Shell | 根据 shebang 选择解释器，默认 bash；入口需具备执行权限 |

Python / Shell 当前继承 HubKit 的工作目录。脚本内需要访问自身文件时，应按脚本位置定位，不要假定 cwd 等于模块目录。Node.js 可用 `scriptPath: "."` 表示项目目录；Python / Shell 应指定脚本文件。

HubKit 负责启动预检、依赖准备、重试、健康检查、PID 记录和日志。stdout / stderr 保持普通文本即可。模块默认继承 HubKit 进程环境；模块自身负责加载 `.env`，模板检查不等于自动注入变量。

模块应以前台进程运行，避免自行 daemonize。长期服务通过 SIGTERM 收尾；一次性脚本执行结束后进入停止状态，HubKit 当前没有承诺持久化的任务成功状态模型。

## 管理入口

CLI、Web 和模块定时器通过 `ModuleLifecycle` 使用同一套适配器行为：

```bash
node dist/cli/index.js list
node dist/cli/index.js audit my-service
node dist/cli/index.js start my-service
node dist/cli/index.js status my-service
node dist/cli/index.js logs my-service --lines 100
node dist/cli/index.js stop my-service
```

状态来自进程探测，启动阶段、健康信息和失败摘要由运行时补充。重复启动已运行模块是幂等操作。普通停止尝试优雅退出，必要时升级终止；Web 的强制关闭、更新等危险操作仍需确认。

`ModuleProtocol.getSettings()` / `setSetting()` 是内部扩展接口；BaseAdapter 默认分别返回空列表和 `false`，不提供通用业务配置读写或 JSON RPC。Dashboard 的运行设置由 ConfigManager 维护，模块自身配置继续由模块负责。

## 存储位置

- HubKit 配置：`~/.hubkit/config.json`；配置管理器的数据/日志目录默认位于 `~/.hubkit`，部分服务使用这些配置目录。
- 当前内置适配器的 PID 和模块日志：**启动 HubKit 的工作目录**下 `.hub/pids/<id>.pid`、`.hub/logs/<id>.log`。
- 所以 CLI 和 Web 应从同一个 HubKit 目录运行，确保它们观察同一组模块进程。

`.hub` 与 `~/.hubkit` 目前承担不同用途；不要把前者误写成已废弃的模块运行路径。本次文档校准不迁移已有进程文件。

## 更新检查与更新

`updateable: true` 只声明能力。`GET /api/modules/:id/update-check` 在模块目录 fetch 远程，再统计 `HEAD..@{u}` 的提交数量；必须已有可访问的 origin 和跟踪分支。检查不会修改工作树。

- 上游新增提交数大于零才表示发现更新。
- 本地领先但上游没有新提交时，不提示可更新。
- 网络失败、没有跟踪分支或无法读取版本时，返回失败，不显示为已是最新。
- Dashboard 按本页最近一次成功检查显示结果，模块状态刷新不会抹掉结果；重新加载页面后需再次检查。
- `POST /api/modules/:id/update` 是执行更新的独立操作，仍要求高风险确认。当前实现执行 `git pull origin HEAD`，并在拉取结果指示有变化时执行 `npm install`；此流程主要适用于 npm 项目，不能视为所有语言通用的更新器。

## 扩展边界

新增语言适配器应在 HubKit 内实现 `ModuleProtocol`、由 `adapter-factory.ts` 接入，并覆盖生命周期测试。内置适配器不提供可直接启用的 stdio 协议模式；未来如果需要 RPC，应先单独定义通信、超时和兼容契约。

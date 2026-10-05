# HubKit 模块接入指南

## 概述

HubKit 提供本地优先的模块管理能力，支持 Node.js、Python 和 Shell 三种脚本类型。本指南以当前真实接入主流程为准：使用 `init-module` 生成 `.hubkit.json`，通过 CLI 做预检、启动、状态查询、日志查看和接入体检。

HubKit 是开源公益、非商业化项目。配置管理器默认使用本机 `~/.hubkit`；当前内置适配器的 PID / 模块日志在 HubKit 工作目录下 `.hub`，不把本地脚本管理包装成商业 SaaS 或默认远程执行平台。

## 快速开始

### 1. 生成模块配置

在 HubKit 仓库目录中运行接入向导，参数指向待接入项目：

```bash
node dist/cli/index.js init-module /path/to/your-project
```

HubKit 会根据目录内容推断模块类型和入口脚本：

- 存在 `package.json` 时默认推断为 Node.js 模块
- 存在 `main.py` 或 `requirements.txt` 时默认推断为 Python 模块
- 其他情况默认推断为 Shell 模块

你也可以显式指定关键字段：

```bash
node dist/cli/index.js init-module /path/to/your-project \
  --id my-tool \
  --name "My Tool" \
  --type nodejs \
  --script server.js \
  --web-port 3000
```

如果只想预览生成结果，不写入文件：

```bash
node dist/cli/index.js init-module /path/to/your-project --dry-run
```

已有 `.hubkit.json` 时默认不会覆盖；确认要覆盖时使用 `--force`。

### 2. 选择脚本类型

根据你的需求选择合适的脚本类型：

- **Node.js** - 适合复杂的业务逻辑、需要丰富的 npm 生态
- **Python** - 适合数据处理、机器学习、科学计算
- **Shell** - 适合系统管理、简单的自动化任务

### 3. 检查 `.hubkit.json`

接入向导会生成 `.hubkit.json`：

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "description": "",
  "type": "nodejs",
  "scriptPath": "server.js",
  "webPort": 3000,
  "autoStart": false,
  "enabled": true
}
```

字段说明：

- `id` - 模块 ID，建议使用小写字母、数字、短横线、下划线或点号
- `name` - Dashboard 中显示的模块名称
- `type` - 模块类型：`nodejs`、`python` 或 `shell`
- `scriptPath` - 相对模块目录的入口脚本路径；Node.js 项目也可以使用 `.` 表示项目目录
- `webPort` - 可选，模块 Web UI 端口
- `webUrl` - 可选，模块 Web UI 完整入口地址
- `autoStart` - 是否加入自动启动队列
- `enabled` - 是否启用模块

### 4. 接入预检

生成配置后，先确认 HubKit 能扫描到模块：

```bash
npm run build
node dist/cli/index.js list
node dist/cli/index.js status my-tool
```

预检重点：

- `.hubkit.json` 是否存在且字段通过校验
- `scriptPath` 是否指向真实入口
- 模块目录是否在 `~/.hubkit/config.json` 的 `moduleDirs` 中
- Node.js、Python 或 Shell 运行时是否可用
- 依赖是否已安装
- `webPort` 是否被占用

### 5. 启动和体检

使用当前 CLI 验证模块生命周期：

```bash
node dist/cli/index.js start my-tool
node dist/cli/index.js status my-tool
node dist/cli/index.js logs my-tool --lines 50
node dist/cli/index.js restart my-tool
node dist/cli/index.js stop my-tool
```

体检方向：

- 启动失败时先看 `logs`
- 状态异常时检查 PID、端口占用和入口脚本
- Web 模块确认 `webPort` 或 `webUrl` 能打开
- 需要长期运行的模块确认退出信号能正常收尾

### 6. Web Dashboard

```bash
node dist/cli/index.js web --port 2281
```

默认访问 `http://127.0.0.1:2281`。远程访问必须显式传 `--host` 并自行确认本机安全边界。

---

## 运行约定

模块是普通可独立运行的程序：输出日志，处理退出信号即可，不需要实现 stdin JSON 请求。完整字段、启动规则和运行边界只在 [模块接入与运行契约](./module-protocol.md) 维护。

- 在 HubKit 仓库目录运行上文的 CLI / Web 命令，保证它们使用同一组 PID 和日志文件。
- Node.js 的 `scriptPath` 可以是项目目录；Python / Shell 使用入口文件路径。
- Python / Shell 的相对资源路径请按脚本所在位置解析；HubKit 不保证它们的 cwd 为模块目录。
- 项目自身负责加载环境变量；不要将密钥写进 `.hubkit.json` 或公开日志。
- 长期服务保持前台运行，并处理 SIGTERM；不要让入口脚本启动后台子进程后立即退出。

## Dashboard 使用

模块卡片默认展示名称、状态、简短说明和启停 / 打开 / 日志入口。选择“详情与维护”可查看 PID、启动记录、健康状态、进程诊断、重启和更新操作；刷新模块状态时保留当前展开状态。

已有显式显示偏好会保留；可在设置中开启“默认收起模块详情”。失败摘要与失败日志入口始终在卡片外层可见。

“发现更新”仅统计实际检查确认的模块。“已检查 x/y”表示支持更新的模块中成功检查的数量；未检查不能解读为没有更新。检查失败可在详情中重试，安装更新仍需单独确认。

## 验收与排障

```bash
node dist/cli/index.js audit my-tool
node dist/cli/index.js logs my-tool --lines 100
node dist/cli/index.js log-search --query my-tool --level error
```

接入成功应能完成：发现模块 → 启动 → 查看状态和日志 → 停止。Web 服务还需确认健康检查和入口地址。失败时先看卡片摘要，再打开日志或进程检查，修正依赖、端口或配置后重新验证。

`examples/` 中的旧 stdio 示例用于历史参考，不作为当前接入模板。推荐从已能独立运行的项目使用 `init-module` 生成配置。

## 相关资源

- [快速开始](./getting-started.md)
- [模块接入与运行契约](./module-protocol.md)
- [开源公益路线图](./roadmap-open-source.md)

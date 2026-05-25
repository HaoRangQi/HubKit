# 快速开始指南

本指南帮助你把一个已有的 Node.js、Python 或 Shell 项目接入 HubKit。当前主流程是本地优先、开源公益、非商业化：配置写入项目内的 `.hubkit.json`，HubKit 自身数据默认放在 `~/.hubkit`，常用操作通过当前 CLI 完成。

## 1. 安装并构建

```bash
npm install
npm run build
```

## 2. 准备一个可独立运行的项目

先确认你的脚本脱离 HubKit 也能运行：

```bash
# Node.js
npm start

# Python
python3 main.py

# Shell
bash run.sh
```

如果项目需要依赖、环境变量或端口，请先在项目自身目录验证通过。HubKit 的接入检查会围绕入口脚本、运行时、依赖文件和 Web 端口给出提示。

## 3. 预览 `.hubkit.json`

在 HubKit 仓库中运行：

```bash
node dist/cli/index.js init-module /path/to/your-project --dry-run
```

`init-module` 会根据目录内容推断模块类型和入口：

- 有 `package.json` 时优先推断为 `nodejs`
- 有 `main.py` 或 `requirements.txt` 时优先推断为 `python`
- 其他情况按 `shell` 处理

也可以显式指定关键字段：

```bash
node dist/cli/index.js init-module /path/to/your-project \
  --id my-module \
  --name "My Module" \
  --type nodejs \
  --script server.js \
  --web-port 3000
```

## 4. 写入配置

确认预览结果后写入 `.hubkit.json`：

```bash
node dist/cli/index.js init-module /path/to/your-project
```

已有 `.hubkit.json` 时默认不会覆盖；确实需要重建时使用：

```bash
node dist/cli/index.js init-module /path/to/your-project --force
```

典型配置如下：

```json
{
  "id": "my-module",
  "name": "My Module",
  "description": "",
  "type": "nodejs",
  "scriptPath": "server.js",
  "webPort": 3000,
  "autoStart": false,
  "enabled": true
}
```

字段说明：

- `id`：模块唯一标识，建议使用小写字母、数字、短横线、下划线或点号
- `name`：Dashboard 中显示的模块名称
- `description`：模块说明，可选
- `type`：模块类型，支持 `nodejs`、`python`、`shell`
- `scriptPath`：相对模块目录的入口脚本路径；Node.js 项目可用 `.` 表示项目目录
- `webPort`：模块 Web UI 端口，可选
- `webUrl`：模块 Web UI 完整入口地址，可选
- `autoStart`：是否加入自动启动队列
- `enabled`：是否启用模块

## 5. 确认发现模块

HubKit 从 `~/.hubkit/config.json` 中的模块目录扫描 `.hubkit.json`。如果新项目不在已配置的扫描目录中，把项目目录或其上级目录加入 `moduleDirs`。

然后执行：

```bash
node dist/cli/index.js list
node dist/cli/index.js status
```

能看到模块后，再检查单个模块：

```bash
node dist/cli/index.js status my-module
```

## 6. 启动、查看日志、停止

```bash
node dist/cli/index.js start my-module
node dist/cli/index.js status my-module
node dist/cli/index.js logs my-module --lines 50
node dist/cli/index.js restart my-module
node dist/cli/index.js stop my-module
```

日志和运行数据归属 HubKit 本地工作区，默认在 `~/.hubkit` 下。不要再使用旧口径中的 `~/.hub`。

## 7. 打开 Web Dashboard

```bash
node dist/cli/index.js web --port 2281
```

访问 `http://127.0.0.1:2281`。Web 服务默认绑定本机地址；如果要远程访问，必须显式传入 `--host` 并自行确认网络边界。

## 8. 接入预检和体检方向

接入时优先检查这些问题：

- `.hubkit.json` 是否存在且字段可通过校验
- `scriptPath` 是否指向真实入口
- 运行时是否可用，例如 Node.js、Python 或 Shell
- 依赖是否已安装，例如 `node_modules`、虚拟环境或系统命令
- `webPort` 是否被占用
- 启动后 `status` 是否能看到正确状态
- 失败时 `logs` 是否能定位原因

推荐验证顺序：

```bash
node dist/cli/index.js init-module /path/to/your-project --dry-run
node dist/cli/index.js init-module /path/to/your-project
node dist/cli/index.js list
node dist/cli/index.js status my-module
node dist/cli/index.js start my-module
node dist/cli/index.js logs my-module --lines 50
node dist/cli/index.js stop my-module
```

## 常见问题

### Q: 模块没有出现在列表里怎么办？

先检查 `.hubkit.json` 是否在项目根目录，再确认该目录能被 `~/.hubkit/config.json` 的 `moduleDirs` 扫描到。最后运行：

```bash
node dist/cli/index.js list
```

### Q: 启动失败怎么排查？

按这个顺序检查：

```bash
node dist/cli/index.js status my-module
node dist/cli/index.js logs my-module --lines 100
```

然后回到模块目录，手动运行 `scriptPath` 对应的命令，确认依赖、权限、端口和环境变量都可用。

### Q: 如何配置开机自启？

当前入门主流程不提供 `install-launcher` 或 `install-service` 命令。先使用 `.hubkit.json` 的 `autoStart` 表达模块是否应进入自动启动队列；系统级启动集成会按本地优先和可回退原则在后续能力中完善。

### Q: 如何传递环境变量？

在模块项目自己的 `.env` 或启动脚本中管理环境变量。HubKit 文档和 Web/API 输出不应暴露敏感值。

## 下一步

- 阅读 [模块接入指南](./module-integration-guide.md)
- 查看 [开源公益路线图](./roadmap-open-source.md)

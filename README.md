# HubKit - 本地优先的个人自动化中控台

HubKit 是一个本地优先、开源公益、非商业化的个人自动化中控台，用来统一管理本机脚本、开发工具和自动化任务。默认只服务本机，不以商业化付费分层或远程执行平台为目标。

## 功能特性

- ✅ **模块化架构**: 支持 Node.js、Python、Shell 三种类型的脚本模块
- ✅ **统一管理**: 通过 CLI 或 Web Dashboard 统一启停、监控所有模块
- ✅ **进程管理**: 自动管理进程生命周期，支持后台运行
- ✅ **日志收集**: 自动收集和查看模块日志
- ✅ **状态监控**: 实时查看模块运行状态、PID、运行时长
- ✅ **Web Dashboard**: Material Design 3 风格界面，支持浅色 / 深色 / 跟随系统
- ✅ **进程诊断**: 卡片内可检查端口占用、PID 候选、监听进程
- ✅ **强制关闭**: 支持按模块清理残留进程与端口占用
- ✅ **模块接入向导**: 使用 `init-module` 为现有项目生成 `.hubkit.json`

## 项目定位

- **本地优先**：配置、日志和运行状态默认保存在本机 `~/.hubkit` 下。
- **开源公益**：项目优先服务个人开发者、脚本作者和本地自动化用户。
- **非商业化**：不做付费分层，不把本地工具包装成商业 SaaS。
- **默认安全边界清晰**：Web Dashboard 默认绑定本机地址，远程访问必须显式配置。

## 快速开始

### 安装依赖

```bash
npm install
```

### 构建项目

```bash
npm run build
```

### 使用 CLI

```bash
# 列出所有模块
node dist/cli/index.js list

# 启动模块
node dist/cli/index.js start <module-id>

# 查看状态
node dist/cli/index.js status <module-id>

# 停止模块
node dist/cli/index.js stop <module-id>

# 重启模块
node dist/cli/index.js restart <module-id>

# 查看日志
node dist/cli/index.js logs <module-id> --lines 50

# 生成模块配置
node dist/cli/index.js init-module /path/to/your-project
```

### 使用 Web Dashboard

```bash
# 启动 Web 服务器
node dist/cli/index.js web --port 2281

# 访问 http://127.0.0.1:2281
```

Web Dashboard 功能：
- 📊 查看所有模块状态
- 🚀 一键启动/停止/重启模块
- 📝 查看实时日志
- 🔍 卡片内执行进程检查（端口、PID、监听进程）
- ⛔ 卡片内执行强制关闭（含端口占用清理）
- 🔗 快速访问模块 Web 界面（如 zsh-config）

## 已集成模块

当前仓库已集成多个示例与本地服务模块（含 `zsh-config` 等），可通过 HubKit 统一管理。

详细模块清单、配置与使用方式请参考：
- [模块接入指南](./docs/module-integration-guide.md)

## 集成新模块

详细说明请参考 [模块接入指南](./docs/module-integration-guide.md)。

### 快速步骤

1. **预览接入配置**
   ```bash
   node dist/cli/index.js init-module /path/to/your-project --dry-run
   ```

2. **生成 `.hubkit.json`**
   ```bash
   node dist/cli/index.js init-module /path/to/your-project \
     --id your-module-id \
     --name "Your Module Name" \
     --type nodejs \
     --script src/index.js
   ```

3. **接入预检与体检**
   ```bash
   npm run build
   node dist/cli/index.js list
   node dist/cli/index.js status your-module-id
   node dist/cli/index.js start your-module-id
   node dist/cli/index.js logs your-module-id --lines 50
   node dist/cli/index.js stop your-module-id
   ```

## 项目结构

```
HubKit/
├── src/
│   ├── adapters/          # 模块适配器
│   │   ├── base-adapter.ts
│   │   ├── nodejs-adapter.ts
│   │   ├── python-adapter.ts
│   │   └── shell-adapter.ts
│   ├── cli/               # CLI 命令
│   ├── config/            # 配置管理
│   ├── registry/          # 模块注册表
│   ├── types/             # TypeScript 类型定义
│   └── web/               # Web Dashboard
├── modules/               # 集成的模块
│   └── zsh-config/        # zsh 配置中心
├── dist/                  # 编译输出
├── test-integration.sh    # 集成测试脚本
├── docs/                  # 入门、接入和开源路线文档
└── package.json
```

## 配置文件

### HubKit 配置 (`~/.hubkit/config.json`)

```json
{
  "moduleDirs": [
    "/Users/username/.hubkit/modules",
    "/path/to/HubKit/modules"
  ],
  "dataDir": "/Users/username/.hubkit/data",
  "logDir": "/Users/username/.hubkit/logs"
}
```

### 模块配置 (`.hubkit.json`)

每个模块目录需要包含此文件：

```json
{
  "id": "module-id",
  "name": "Module Name",
  "description": "Module description",
  "type": "nodejs|python|shell",
  "scriptPath": "relative/path/to/script",
  "autoStart": false,
  "enabled": true
}
```

> 旧版文档中出现的 `module.json`、`~/.hub`、`install-launcher`、`install-service` 属于过期口径或未实现能力。当前主流程以 `.hubkit.json`、`~/.hubkit` 和 `init-module` 为准。

## 端口分配

- **HubKit Web Dashboard**: 2281
- **zsh-config**: 3002

## 测试

运行集成测试：

```bash
./test-integration.sh
```

测试内容：
- ✓ 配置文件检查
- ✓ 模块注册验证
- ✓ 启动/停止功能
- ✓ 状态查询
- ✓ HTTP 访问测试
- ✓ 日志查看

## 开发

### 添加新的适配器

1. 继承 `BaseAdapter` 类
2. 实现 `buildStartCommand()` 方法
3. 在模块配置中指定对应的 `type`

### 添加新的 CLI 命令

1. 在 `src/cli/commands/` 创建命令文件
2. 在 `src/cli/commands/index.ts` 注册命令

### 扩展 Web Dashboard

1. 修改 `src/web/public/index.html`
2. 更新 API 路由 `src/web/api/routes.ts`
3. 重新构建并复制到 dist

## 故障排查

### 模块未显示

```bash
# 检查配置
cat ~/.hubkit/config.json

# 重新扫描
node dist/cli/index.js list
```

### 启动失败

```bash
# 查看日志
node dist/cli/index.js logs <module-id> --lines 50

# 手动测试
cd modules/<module-name>
npm start
```

### 端口冲突

```bash
# 查看端口占用
lsof -i :<port>

# 使用其他端口
PORT=<new-port> node dist/cli/index.js start <module-id>
```

## 技术栈

- **语言**: TypeScript, Node.js
- **CLI**: Commander.js
- **Web**: Express.js, WebSocket
- **进程管理**: child_process (spawn, detached)
- **UI**: 原生 HTML/CSS/JavaScript（Material Design 3，支持浅色 / 深色 / 自动）

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request。HubKit 的贡献方向以本地优先、开源公益、非商业化为边界。

- 提交前建议先看 [变更梳理与远程提交准备](./docs/release-prep.md)（提交切片、验证链、文档治理要求）。

## 致谢

- **舵手**: HaoRangQi
- **代码贡献**: Claude、DeepSeek、GPT

## 路线图

- [ ] 支持模块依赖管理
- [ ] 支持模块间通信
- [ ] 支持配置热更新
- [ ] 支持健康检查
- [ ] 支持自动重启
- [ ] 支持资源限制
- [ ] 完善本地预检和体检闭环
- [ ] 支持插件系统

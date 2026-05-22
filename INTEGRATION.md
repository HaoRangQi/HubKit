# HubKit 模块集成指南

## zsh-config 集成说明

### 集成概述

zsh-config 已成功集成为 HubKit 的一个可管理模块。原项目保持独立，通过复制和适配器模式实现集成。

### 目录结构

```
HubKit/
├── modules/
│   └── zsh-config/              # 复制的 zsh-config 项目
│       ├── .hubkit.json         # HubKit 模块配置文件
│       ├── src/
│       │   └── server.js        # 主服务器（端口改为 3002）
│       ├── public/
│       ├── package.json
│       └── README.md
├── src/
│   ├── adapters/
│   │   └── nodejs-adapter.ts    # Node.js 模块适配器
│   └── registry/
│       └── module-scanner.ts    # 模块扫描器
└── setup-modules.js             # 模块配置初始化脚本
```

### 配置文件

#### .hubkit.json

每个模块目录需要包含 `.hubkit.json` 配置文件：

```json
{
  "id": "zsh-config",
  "name": "Zsh Config Center",
  "description": "本地 zsh 可视化配置中心，管理 ~/.zshrc、~/.zprofile 等配置文件",
  "type": "nodejs",
  "scriptPath": "src/server.js",
  "autoStart": false,
  "enabled": true
}
```

#### HubKit 配置

HubKit 配置位于 `~/.hubkit/config.json`：

```json
{
  "moduleDirs": [
    "/Users/macos/.hubkit/modules",
    "/Users/macos/Downloads/Projects/Plugins/HubKit/modules"
  ],
  "dataDir": "/Users/macos/.hubkit/data",
  "logDir": "/Users/macos/.hubkit/logs"
}
```

### 使用方法

#### 1. 列出所有模块

```bash
node dist/cli/index.js list
```

输出示例：
```
找到 4 个模块:

  ✓ Zsh Config Center (zsh-config)
    类型: nodejs
    脚本: /Users/macos/Downloads/Projects/Plugins/HubKit/modules/zsh-config/src/server.js
    描述: 本地 zsh 可视化配置中心，管理 ~/.zshrc、~/.zprofile 等配置文件
```

#### 2. 启动模块

```bash
node dist/cli/index.js start zsh-config
```

#### 3. 查看状态

```bash
node dist/cli/index.js status zsh-config
```

输出示例：
```
模块: Zsh Config Center (zsh-config)
类型: nodejs
状态: running
进程 ID: 21070
```

#### 4. 停止模块

```bash
node dist/cli/index.js stop zsh-config
```

#### 5. 查看日志

```bash
node dist/cli/index.js logs zsh-config --lines 20
```

#### 6. 通过 Web Dashboard 管理

启动 HubKit Web 服务器：

```bash
npm run web -- -p 3001
```

访问 http://localhost:3001，可以：
- 查看所有模块状态
- 启动/停止/重启模块
- 查看日志
- **点击"打开界面"按钮直接访问 zsh-config（仅在运行时显示）**

### 端口分配

- **HubKit Web Dashboard**: 3001
- **zsh-config**: 3002

### 关键修改

#### 1. zsh-config 端口修改

`modules/zsh-config/src/server.js` 第 18 行：

```javascript
const port = Number(process.env.PORT || 3002);
```

#### 2. Web Dashboard 增强

为 zsh-config 模块添加了"打开界面"按钮，运行时可直接跳转到 http://localhost:3002。

### 集成其他模块

要集成新的脚本/服务到 HubKit：

1. **复制项目到 modules 目录**
   ```bash
   cp -r /path/to/your-project modules/
   ```

2. **创建 .hubkit.json 配置**
   ```json
   {
     "id": "your-module-id",
     "name": "Your Module Name",
     "description": "Module description",
     "type": "nodejs|python|shell",
     "scriptPath": "relative/path/to/script",
     "autoStart": false,
     "enabled": true
   }
   ```

3. **运行初始化脚本**（如果是新的 modules 目录）
   ```bash
   node setup-modules.js
   ```

4. **重新构建并测试**
   ```bash
   npm run build
   node dist/cli/index.js list
   ```

### 适配器支持

HubKit 支持三种类型的模块：

- **nodejs**: 使用 `NodeJSAdapter`，支持 `npm start` 或直接运行脚本
- **python**: 使用 `PythonAdapter`
- **shell**: 使用 `ShellAdapter`

所有适配器继承自 `BaseAdapter`，提供统一的：
- 进程管理（启动/停止/重启）
- 状态查询（PID、运行时长、资源占用）
- 日志管理（自动记录到 `.hub/logs/`）
- 配置管理

### 进程管理

- **PID 文件**: `.hub/pids/{module-id}.pid`
- **日志文件**: `.hub/logs/{module-id}.log`
- **分离进程**: 使用 `detached: true` 和 `unref()`，模块进程独立于 HubKit 运行

### 故障排查

#### 模块未显示

```bash
# 检查配置
cat ~/.hubkit/config.json

# 检查 .hubkit.json 是否存在
ls -la modules/*/. hubkit.json

# 重新扫描
node dist/cli/index.js list
```

#### 启动失败

```bash
# 查看详细日志
node dist/cli/index.js logs <module-id> --lines 50

# 检查脚本路径
cat modules/<module-name>/.hubkit.json

# 手动测试脚本
cd modules/<module-name>
npm start  # 或直接运行脚本
```

#### 端口冲突

```bash
# 查看端口占用
lsof -i :3002

# 修改模块端口（通过环境变量）
PORT=3003 node dist/cli/index.js start <module-id>
```

### 最佳实践

1. **保持原项目独立**: 不修改原项目核心逻辑，仅调整端口等配置
2. **使用环境变量**: 通过 `process.env.PORT` 等支持灵活配置
3. **添加描述信息**: 在 `.hubkit.json` 中提供清晰的描述
4. **测试独立运行**: 确保模块可以独立启动，再集成到 HubKit
5. **日志规范**: 使用标准输出/错误输出，HubKit 会自动捕获

### 未来改进

- [ ] 支持模块依赖管理
- [ ] 支持模块间通信
- [ ] 支持模块配置热更新
- [ ] 支持模块健康检查
- [ ] 支持模块自动重启
- [ ] 支持模块资源限制

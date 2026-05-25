# HubKit 模块接入指南

## 概述

HubKit 提供本地优先的模块管理能力，支持 Node.js、Python 和 Shell 三种脚本类型。本指南以当前真实接入主流程为准：使用 `init-module` 生成 `.hubkit.json`，通过 CLI 做预检、启动、状态查询、日志查看和接入体检。

HubKit 是开源公益、非商业化项目。默认配置和运行数据保存在本机 `~/.hubkit`，不把本地脚本管理包装成商业 SaaS 或默认远程执行平台。

## 快速开始

### 1. 生成模块配置

在现有项目目录中运行接入向导：

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

## 高级扩展：stdio 协议参考

以下 stdin/stdout 协议内容用于自定义适配器或未来高级扩展参考，不是当前模块接入的必做步骤。普通 Node.js、Python 和 Shell 项目优先使用 `.hubkit.json` 加内置适配器接入。

当前稳定主流程只要求模块能被 `init-module` 生成配置，并能通过 `list`、`status`、`start`、`stop`、`restart`、`logs`、`web` 验证。

### 协议详解

### 请求格式

所有请求都是 JSON 格式，通过 stdin 传入：

```json
{
  "method": "status|start|stop|logs|settings",
  // 其他参数根据方法而定
}
```

### 响应格式

成功响应通过 stdout 返回 JSON：

```json
{
  // 响应数据
}
```

失败响应通过 stderr 返回错误信息，并返回非 0 exit code。

---

## 接口实现

### 1. status - 查询模块状态

**请求**

```json
{
  "method": "status"
}
```

**响应**

```json
{
  "status": "running",
  "pid": 12345,
  "startedAt": "2026-05-22T10:30:00.000Z",
  "uptime": 3600,
  "memory": 45.2,
  "cpu": 2.5
}
```

**字段说明**

- `status` (必需) - 模块状态：`stopped`、`running`、`starting`、`stopping`、`error`、`unknown`
- `pid` (可选) - 进程 ID
- `startedAt` (可选) - ISO 8601 格式的启动时间
- `uptime` (可选) - 运行时长（秒）
- `memory` (可选) - 内存占用（MB）
- `cpu` (可选) - CPU 占用百分比

**实现要点**

- 使用 PID 文件记录进程 ID
- 检查进程是否存活
- 计算资源使用情况

---

### 2. start - 启动模块

**请求**

```json
{
  "method": "start"
}
```

**响应**

```json
{
  "success": true,
  "pid": 12345,
  "message": "Module started successfully"
}
```

**字段说明**

- `success` (必需) - 是否启动成功
- `pid` (可选) - 启动后的进程 ID
- `message` (可选) - 启动消息或错误描述

**实现要点**

- 检查模块是否已在运行
- 启动后台进程
- 记录 PID 到文件
- 初始化日志文件

---

### 3. stop - 停止模块

**请求**

```json
{
  "method": "stop",
  "force": false
}
```

**字段说明**

- `force` (可选) - 是否强制停止，默认 false

**响应**

```json
{
  "success": true,
  "message": "Module stopped successfully"
}
```

**实现要点**

- 读取 PID 文件
- 发送 SIGTERM 信号（优雅停止）
- 如果 force=true，发送 SIGKILL 信号
- 清理 PID 文件和临时资源

---

### 4. logs - 获取日志

**请求**

```json
{
  "method": "logs",
  "lines": 100
}
```

**字段说明**

- `lines` (可选) - 获取最近 N 行日志，默认 100

**响应**

```json
{
  "logs": [
    {
      "timestamp": "2026-05-22T10:30:00.000Z",
      "level": "info",
      "message": "Module started"
    }
  ]
}
```

**实现要点**

- 使用滚动日志文件
- 日志格式统一（时间戳 + 级别 + 消息）
- 支持按行数读取

---

### 5. settings - 配置管理

#### 获取配置

**请求**

```json
{
  "method": "settings",
  "action": "get"
}
```

**响应**

```json
{
  "settings": [
    {
      "key": "port",
      "value": 3000,
      "description": "Server port",
      "required": true
    }
  ]
}
```

#### 更新配置

**请求**

```json
{
  "method": "settings",
  "action": "set",
  "key": "port",
  "value": 8080
}
```

**响应**

```json
{
  "success": true,
  "message": "Setting updated successfully"
}
```

**实现要点**

- 使用配置文件（JSON 或 YAML）
- 支持配置验证
- 配置变更后可选择是否自动重载

---

## 适配器使用

HubKit 为每种脚本类型提供了适配器，自动处理基础进程管理。普通模块不需要实现上面的 stdio 协议；只有在需要自定义生命周期或设置接口时，才参考高级扩展内容。

### Node.js 适配器

**特性**

- 自动检测 `package.json` 中的 `start` 脚本
- 优先使用 `npm start`，否则直接运行脚本
- 设置 `NODE_ENV=production`

**目录结构**

```
my-module/
├── package.json
├── module.js (或 index.js)
└── node_modules/
```

**启动方式**

```bash
# 如果有 package.json 的 start 脚本
npm start

# 否则
node module.js
```

---

### Python 适配器

**特性**

- 自动检测虚拟环境（venv 或 .venv）
- 优先使用虚拟环境中的 Python
- 设置 `PYTHONUNBUFFERED=1` 禁用输出缓冲

**目录结构**

```
my-module/
├── requirements.txt
├── module.py (或 __main__.py)
└── venv/ (或 .venv/)
```

**启动方式**

```bash
# 如果有虚拟环境
venv/bin/python module.py

# 否则
python3 module.py
```

---

### Shell 适配器

**特性**

- 自动检测 shebang 行确定 shell 类型
- 自动添加执行权限（如果缺失）
- 支持 bash、zsh、sh

**目录结构**

```
my-module/
└── module.sh
```

**启动方式**

```bash
# 根据 shebang 确定
bash module.sh  # 或 zsh、sh
```

---

## 最佳实践

### 1. 状态管理

**使用 PID 文件**

```javascript
// Node.js
const fs = require('fs');
const pidFile = '/tmp/my-module.pid';

// 启动时写入 PID
fs.writeFileSync(pidFile, process.pid.toString());

// 停止时删除 PID 文件
fs.unlinkSync(pidFile);
```

**检查进程是否存活**

```javascript
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

---

### 2. 日志管理

**使用滚动日志**

```javascript
const fs = require('fs');
const logFile = '/tmp/my-module.log';
const maxLogSize = 10 * 1024 * 1024; // 10MB

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logEntry = JSON.stringify({ timestamp, level, message }) + '\n';
  
  fs.appendFileSync(logFile, logEntry);
  
  // 检查日志大小，超过限制则滚动
  const stats = fs.statSync(logFile);
  if (stats.size > maxLogSize) {
    fs.renameSync(logFile, `${logFile}.old`);
  }
}
```

**读取日志**

```javascript
function getLogs(lines = 100) {
  const content = fs.readFileSync(logFile, 'utf-8');
  const allLines = content.trim().split('\n');
  const recentLines = allLines.slice(-lines);
  
  return recentLines.map(line => JSON.parse(line));
}
```

---

### 3. 配置管理

**使用配置文件**

```javascript
const fs = require('fs');
const configFile = './config.json';

function getSettings() {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  return Object.entries(config).map(([key, value]) => ({
    key,
    value,
    description: `Configuration for ${key}`,
    required: false
  }));
}

function setSetting(key, value) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  config[key] = value;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return true;
}
```

---

### 4. 错误处理

**捕获所有异常**

```javascript
process.on('uncaughtException', (error) => {
  console.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});
```

**使用标准错误码**

```javascript
const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGUMENT: 2,
  NOT_INITIALIZED: 3,
  ALREADY_RUNNING: 4,
  NOT_RUNNING: 5,
  TIMEOUT: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_UNAVAILABLE: 8,
  CONFIG_ERROR: 9
};
```

---

### 5. 资源清理

**优雅退出**

```javascript
function cleanup() {
  // 关闭连接
  if (server) {
    server.close();
  }
  
  // 删除 PID 文件
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
  
  // 清理临时文件
  // ...
}

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
```

---

## 测试指南

优先使用 HubKit CLI 做接入测试：

```bash
node dist/cli/index.js list
node dist/cli/index.js status my-tool
node dist/cli/index.js start my-tool
node dist/cli/index.js logs my-tool --lines 50
node dist/cli/index.js restart my-tool
node dist/cli/index.js stop my-tool
```

下面的 stdin/stdout 测试仅适用于你主动实现了高级协议的模块。

### 手动测试

**测试 status 接口**

```bash
echo '{"method":"status"}' | node module.js
```

**测试 start 接口**

```bash
echo '{"method":"start"}' | node module.js
```

**测试 stop 接口**

```bash
echo '{"method":"stop"}' | node module.js
```

**测试 logs 接口**

```bash
echo '{"method":"logs","lines":50}' | node module.js
```

**测试 settings 接口**

```bash
# 获取配置
echo '{"method":"settings","action":"get"}' | node module.js

# 更新配置
echo '{"method":"settings","action":"set","key":"port","value":8080}' | node module.js
```

---

### 自动化测试

**使用测试脚本**

```bash
#!/bin/bash

# 测试所有接口
test_status() {
  echo '{"method":"status"}' | node module.js
}

test_start() {
  echo '{"method":"start"}' | node module.js
}

test_stop() {
  echo '{"method":"stop"}' | node module.js
}

test_logs() {
  echo '{"method":"logs","lines":10}' | node module.js
}

test_settings() {
  echo '{"method":"settings","action":"get"}' | node module.js
}

# 运行测试
echo "Testing status..."
test_status

echo "Testing start..."
test_start

echo "Testing logs..."
test_logs

echo "Testing settings..."
test_settings

echo "Testing stop..."
test_stop
```

---

## 常见问题

### Q: 如何处理长时间运行的任务？

A: 使用后台进程。在 `start` 接口中启动后台进程，记录 PID，然后立即返回。

```javascript
const { spawn } = require('child_process');

function startModule() {
  const child = spawn('node', ['worker.js'], {
    detached: true,
    stdio: 'ignore'
  });
  
  child.unref();
  
  fs.writeFileSync(pidFile, child.pid.toString());
  
  return { success: true, pid: child.pid };
}
```

---

### Q: 如何实现配置热重载？

A: 监听配置文件变化，自动重新加载。

```javascript
const fs = require('fs');

fs.watch(configFile, (eventType) => {
  if (eventType === 'change') {
    reloadConfig();
  }
});
```

---

### Q: 如何处理模块崩溃？

A: 使用进程监控和自动重启。

```javascript
function checkHealth() {
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
  
  if (!isProcessRunning(pid)) {
    log('error', 'Module crashed, restarting...');
    startModule();
  }
}

setInterval(checkHealth, 5000); // 每 5 秒检查一次
```

---

### Q: 如何支持多实例？

A: 使用不同的 PID 文件和日志文件。

```javascript
const instanceId = process.env.INSTANCE_ID || 'default';
const pidFile = `/tmp/my-module-${instanceId}.pid`;
const logFile = `/tmp/my-module-${instanceId}.log`;
```

---

## 下一步

1. 使用 `init-module --dry-run` 预览 `.hubkit.json`
2. 写入 `.hubkit.json` 后运行 `list`、`status`、`start`、`logs`、`stop`
3. 打开 Web Dashboard 做接入体检
4. 只有需要自定义生命周期时，再参考适配器源码 `src/adapters/`

---

## 相关资源

- [模块协议规范](./module-protocol.md)（高级扩展参考，非当前接入主流程）
- [Node.js 示例](../examples/modules/node-example/)
- [Python 示例](../examples/modules/python-example/)
- [Shell 示例](../examples/modules/shell-example/)

# HubKit 模块接入指南

## 概述

HubKit 提供了统一的模块管理协议，支持 Node.js、Python 和 Shell 三种脚本类型。本指南将帮助你快速接入自定义模块。

## 快速开始

### 1. 选择脚本类型

根据你的需求选择合适的脚本类型：

- **Node.js** - 适合复杂的业务逻辑、需要丰富的 npm 生态
- **Python** - 适合数据处理、机器学习、科学计算
- **Shell** - 适合系统管理、简单的自动化任务

### 2. 实现协议接口

每个模块需要实现 5 个标准接口：

1. **status** - 查询模块状态
2. **start** - 启动模块
3. **stop** - 停止模块
4. **logs** - 获取日志
5. **settings** - 配置管理

### 3. 通信方式

所有接口通过标准输入输出（stdin/stdout/stderr）进行 JSON 格式通信：

- **请求** - 通过 stdin 接收 JSON 格式的请求
- **响应** - 通过 stdout 返回 JSON 格式的响应
- **错误** - 通过 stderr 输出错误信息，并返回非 0 exit code

### 4. 示例模块

参考 `examples/modules/` 目录下的示例：

- `node-example/` - Node.js 示例模块
- `python-example/` - Python 示例模块
- `shell-example/` - Shell 示例模块

---

## 协议详解

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

HubKit 为每种脚本类型提供了适配器，自动处理进程管理和通信。

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

1. 查看 `examples/modules/` 目录下的完整示例
2. 阅读 `docs/module-protocol.md` 了解协议详细规范
3. 参考适配器源码 `src/adapters/` 了解实现细节
4. 开始编写你的第一个模块！

---

## 相关资源

- [模块协议规范](./module-protocol.md)
- [Node.js 示例](../examples/modules/node-example/)
- [Python 示例](../examples/modules/python-example/)
- [Shell 示例](../examples/modules/shell-example/)

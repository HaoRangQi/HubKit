# HubKit Node.js 示例模块

这是一个完整的 Node.js 模块示例，演示了如何实现 HubKit 模块协议的所有 5 个接口。

## 功能特性

- ✅ 实现所有 5 个协议接口（status、start、stop、logs、settings）
- ✅ 后台进程管理（启动、停止、状态检查）
- ✅ PID 文件管理
- ✅ 滚动日志文件
- ✅ JSON 配置文件
- ✅ 优雅退出处理
- ✅ 错误处理和标准错误码

## 文件结构

```
node-example/
├── module.js       # 主模块文件，实现协议接口
├── worker.js       # 工作进程，模拟长时间运行的任务
├── package.json    # npm 配置文件
├── config.json     # 配置文件（自动生成）
├── .module.pid     # PID 文件（运行时生成）
├── .module.state   # 状态文件（运行时生成）
└── .module.log     # 日志文件（运行时生成）
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 测试接口

**查询状态**

```bash
echo '{"method":"status"}' | node module.js
```

**启动模块**

```bash
echo '{"method":"start"}' | node module.js
```

**查询运行状态**

```bash
echo '{"method":"status"}' | node module.js
```

**获取日志**

```bash
echo '{"method":"logs","lines":10}' | node module.js
```

**获取配置**

```bash
echo '{"method":"settings","action":"get"}' | node module.js
```

**更新配置**

```bash
echo '{"method":"settings","action":"set","key":"port","value":8080}' | node module.js
```

**停止模块**

```bash
echo '{"method":"stop"}' | node module.js
```

**强制停止**

```bash
echo '{"method":"stop","force":true}' | node module.js
```

## 接口说明

### 1. status - 查询模块状态

**请求**

```json
{
  "method": "status"
}
```

**响应（已停止）**

```json
{
  "status": "stopped"
}
```

**响应（运行中）**

```json
{
  "status": "running",
  "pid": 12345,
  "startedAt": "2026-05-22T10:30:00.000Z",
  "uptime": 3600,
  "memory": 45.2,
  "cpu": 0
}
```

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

**错误（已在运行）**

```
Error: Module already running (PID: 12345)
Exit code: 4
```

### 3. stop - 停止模块

**请求（优雅停止）**

```json
{
  "method": "stop"
}
```

**请求（强制停止）**

```json
{
  "method": "stop",
  "force": true
}
```

**响应**

```json
{
  "success": true,
  "message": "Module stopped successfully"
}
```

### 4. logs - 获取日志

**请求**

```json
{
  "method": "logs",
  "lines": 50
}
```

**响应**

```json
{
  "logs": [
    {
      "timestamp": "2026-05-22T10:30:00.000Z",
      "level": "info",
      "message": "Worker process started"
    },
    {
      "timestamp": "2026-05-22T10:30:05.000Z",
      "level": "info",
      "message": "Worker heartbeat: 1"
    }
  ]
}
```

### 5. settings - 配置管理

**获取配置**

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
    },
    {
      "key": "debug",
      "value": false,
      "description": "Enable debug mode",
      "required": false
    },
    {
      "key": "maxConnections",
      "value": 100,
      "description": "Maximum number of connections",
      "required": false
    }
  ]
}
```

**更新配置**

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

## 实现细节

### 状态管理

- 使用 `.module.pid` 文件记录进程 ID
- 使用 `.module.state` 文件记录启动时间
- 通过 `process.kill(pid, 0)` 检查进程是否存活

### 日志管理

- 日志写入 `.module.log` 文件
- JSON 格式：`{"timestamp":"...","level":"...","message":"..."}`
- 超过 10MB 自动滚动到 `.module.log.old`

### 配置管理

- 配置存储在 `config.json` 文件
- 支持类型验证
- 支持必需字段检查

### 进程管理

- 使用 `child_process.spawn` 启动后台进程
- `detached: true` 使子进程独立运行
- `child.unref()` 允许父进程退出

### 错误处理

- 使用标准错误码（0-9）
- 错误信息输出到 stderr
- 成功响应输出到 stdout

## 测试脚本

创建 `test.sh` 文件：

```bash
#!/bin/bash

echo "=== Testing Node.js Module ==="

echo -e "\n1. Testing status (should be stopped)..."
echo '{"method":"status"}' | node module.js

echo -e "\n2. Testing start..."
echo '{"method":"start"}' | node module.js

echo -e "\n3. Waiting 2 seconds..."
sleep 2

echo -e "\n4. Testing status (should be running)..."
echo '{"method":"status"}' | node module.js

echo -e "\n5. Testing logs..."
echo '{"method":"logs","lines":5}' | node module.js

echo -e "\n6. Testing settings get..."
echo '{"method":"settings","action":"get"}' | node module.js

echo -e "\n7. Testing settings set..."
echo '{"method":"settings","action":"set","key":"port","value":8080}' | node module.js

echo -e "\n8. Testing settings get (verify change)..."
echo '{"method":"settings","action":"get"}' | node module.js

echo -e "\n9. Testing stop..."
echo '{"method":"stop"}' | node module.js

echo -e "\n10. Testing status (should be stopped)..."
echo '{"method":"status"}' | node module.js

echo -e "\n=== All tests completed ==="
```

运行测试：

```bash
chmod +x test.sh
./test.sh
```

## 扩展建议

### 1. 添加健康检查

```javascript
function healthCheck() {
  // 检查端口是否可用
  // 检查依赖服务是否正常
  // 返回健康状态
}
```

### 2. 添加性能监控

```javascript
function getMetrics() {
  return {
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    uptime: process.uptime()
  };
}
```

### 3. 添加配置验证

```javascript
function validateConfig(config) {
  if (config.port < 1024 || config.port > 65535) {
    throw new Error('Invalid port range');
  }
}
```

### 4. 添加自动重启

```javascript
function watchProcess() {
  setInterval(() => {
    const status = getStatus();
    if (status.status === 'stopped') {
      startModule();
    }
  }, 10000);
}
```

## 相关资源

- [模块协议规范](../../../docs/module-protocol.md)
- [模块接入指南](../../../docs/module-integration-guide.md)
- [Python 示例](../python-example/)
- [Shell 示例](../shell-example/)

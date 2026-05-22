# HubKit 模块协议规范

## 概述

HubKit 模块协议定义了统一的模块管理接口，支持 Node.js、Python 和 Shell 三种脚本类型。所有模块通过标准输入输出（stdin/stdout/stderr）进行 JSON 格式通信，实现跨语言的统一管理。

## 设计原则

1. **统一接口** - 不同脚本类型使用相同的协议
2. **简单可扩展** - 基于 JSON 的请求/响应模式
3. **进程隔离** - 每个模块运行在独立进程中
4. **标准通信** - 使用 stdin/stdout/stderr 进行通信
5. **错误透明** - 明确的错误处理和状态反馈

## 核心接口

模块协议定义了 5 个标准接口：

### 1. status - 查询模块状态

获取模块的当前运行状态和资源使用情况。

**请求格式（stdin JSON）**

```json
{
  "method": "status"
}
```

**响应格式（stdout JSON）**

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

- `status` (string, 必需) - 模块状态：`stopped`、`running`、`starting`、`stopping`、`error`、`unknown`
- `pid` (number, 可选) - 进程 ID，仅在运行中时返回
- `startedAt` (string, 可选) - ISO 8601 格式的启动时间
- `uptime` (number, 可选) - 运行时长（秒）
- `memory` (number, 可选) - 内存占用（MB）
- `cpu` (number, 可选) - CPU 占用百分比
- `error` (string, 可选) - 错误信息，仅在错误状态时返回

**错误处理**

- 成功：exit code 0，stdout 输出 JSON
- 失败：exit code 非 0，stderr 输出错误信息

**超时机制**

- 默认超时：5 秒

**示例**

```bash
# 请求
echo '{"method":"status"}' | node module.js

# 成功响应
{"status":"running","pid":12345,"uptime":3600}

# 错误响应（stderr）
Error: Module not initialized
```

---

### 2. start - 启动模块

启动模块进程，使其进入运行状态。

**请求格式（stdin JSON）**

```json
{
  "method": "start"
}
```

**响应格式（stdout JSON）**

```json
{
  "success": true,
  "pid": 12345,
  "message": "Module started successfully"
}
```

**字段说明**

- `success` (boolean, 必需) - 是否启动成功
- `pid` (number, 可选) - 启动后的进程 ID
- `message` (string, 可选) - 启动消息或错误描述

**错误处理**

- 成功：exit code 0，`success: true`
- 失败：exit code 非 0，stderr 输出详细错误
- 重复启动：返回错误，提示模块已在运行

**超时机制**

- 默认超时：30 秒

**示例**

```bash
# 请求
echo '{"method":"start"}' | node module.js

# 成功响应
{"success":true,"pid":12345,"message":"Module started successfully"}

# 错误响应（stderr）
Error: Module already running (PID: 12345)
```

---

### 3. stop - 停止模块

停止模块进程，使其退出运行状态。

**请求格式（stdin JSON）**

```json
{
  "method": "stop",
  "force": false
}
```

**字段说明**

- `force` (boolean, 可选) - 是否强制停止（SIGKILL），默认 false（使用 SIGTERM）

**响应格式（stdout JSON）**

```json
{
  "success": true,
  "message": "Module stopped successfully"
}
```

**字段说明**

- `success` (boolean, 必需) - 是否停止成功
- `message` (string, 可选) - 停止消息或错误描述

**错误处理**

- 成功：exit code 0，`success: true`
- 失败：exit code 非 0，stderr 输出详细错误
- 模块未运行：返回成功，提示模块已停止

**超时机制**

- 默认超时：10 秒（graceful stop）
- 强制停止：立即发送 SIGKILL

**示例**

```bash
# 优雅停止
echo '{"method":"stop"}' | node module.js

# 强制停止
echo '{"method":"stop","force":true}' | node module.js

# 成功响应
{"success":true,"message":"Module stopped successfully"}
```

---

### 4. logs - 获取日志

获取模块的运行日志，支持指定行数。

**请求格式（stdin JSON）**

```json
{
  "method": "logs",
  "lines": 100
}
```

**字段说明**

- `lines` (number, 可选) - 获取最近 N 行日志，默认 100

**响应格式（stdout JSON）**

```json
{
  "logs": [
    {
      "timestamp": "2026-05-22T10:30:00.000Z",
      "level": "info",
      "message": "Module started"
    },
    {
      "timestamp": "2026-05-22T10:30:05.000Z",
      "level": "error",
      "message": "Connection failed"
    }
  ]
}
```

**字段说明**

- `logs` (array, 必需) - 日志条目数组
  - `timestamp` (string, 必需) - ISO 8601 格式的时间戳
  - `level` (string, 必需) - 日志级别：`debug`、`info`、`warn`、`error`
  - `message` (string, 必需) - 日志内容

**错误处理**

- 成功：exit code 0，返回日志数组（可能为空）
- 失败：exit code 非 0，stderr 输出错误信息

**超时机制**

- 默认超时：10 秒

**示例**

```bash
# 请求最近 50 行日志
echo '{"method":"logs","lines":50}' | node module.js

# 成功响应
{"logs":[{"timestamp":"2026-05-22T10:30:00.000Z","level":"info","message":"Module started"}]}

# 无日志
{"logs":[]}
```

---

### 5. settings - 配置管理

获取或更新模块配置项。

#### 5.1 获取配置

**请求格式（stdin JSON）**

```json
{
  "method": "settings",
  "action": "get"
}
```

**响应格式（stdout JSON）**

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
    }
  ]
}
```

**字段说明**

- `settings` (array, 必需) - 配置项数组
  - `key` (string, 必需) - 配置键
  - `value` (string|number|boolean, 必需) - 配置值
  - `description` (string, 可选) - 配置描述
  - `required` (boolean, 可选) - 是否必需

#### 5.2 更新配置

**请求格式（stdin JSON）**

```json
{
  "method": "settings",
  "action": "set",
  "key": "port",
  "value": 8080
}
```

**字段说明**

- `action` (string, 必需) - 操作类型：`get` 或 `set`
- `key` (string, 必需) - 配置键（仅 set 时需要）
- `value` (string|number|boolean, 必需) - 配置值（仅 set 时需要）

**响应格式（stdout JSON）**

```json
{
  "success": true,
  "message": "Setting updated successfully"
}
```

**字段说明**

- `success` (boolean, 必需) - 是否更新成功
- `message` (string, 可选) - 更新消息或错误描述

**错误处理**

- 成功：exit code 0，`success: true`
- 失败：exit code 非 0，stderr 输出详细错误
- 无效配置键：返回错误，提示配置不存在
- 无效配置值：返回错误，提示值类型或范围错误

**超时机制**

- 默认超时：5 秒

**示例**

```bash
# 获取配置
echo '{"method":"settings","action":"get"}' | node module.js

# 更新配置
echo '{"method":"settings","action":"set","key":"port","value":8080}' | node module.js

# 成功响应（get）
{"settings":[{"key":"port","value":3000,"description":"Server port"}]}

# 成功响应（set）
{"success":true,"message":"Setting updated successfully"}
```

---

## 通信协议

### 请求流程

1. 调用方通过 stdin 发送 JSON 格式的请求
2. 模块解析请求，执行对应操作
3. 模块通过 stdout 返回 JSON 格式的响应
4. 如果发生错误，通过 stderr 输出错误信息，并返回非 0 exit code

### 响应规范

**成功响应**

- Exit code: 0
- Stdout: JSON 格式的响应数据
- Stderr: 空

**失败响应**

- Exit code: 非 0（建议使用标准错误码）
- Stdout: 空或部分数据
- Stderr: 错误信息（纯文本）

### 错误码规范

| Exit Code | 含义 |
|-----------|------|
| 0 | 成功 |
| 1 | 通用错误 |
| 2 | 参数错误 |
| 3 | 模块未初始化 |
| 4 | 模块已运行 |
| 5 | 模块未运行 |
| 6 | 操作超时 |
| 7 | 权限不足 |
| 8 | 资源不足 |
| 9 | 配置错误 |

---

## 超时机制

所有接口调用都有超时限制，防止模块无响应导致系统阻塞。

| 接口 | 默认超时 | 说明 |
|------|---------|------|
| status | 5 秒 | 快速查询，不应耗时 |
| start | 30 秒 | 启动可能需要初始化 |
| stop | 10 秒 | 优雅停止需要清理资源 |
| logs | 10 秒 | 日志读取可能较慢 |
| settings | 5 秒 | 配置操作应快速完成 |

超时后，调用方应：
1. 终止模块进程（SIGTERM）
2. 等待 3 秒
3. 如果仍未退出，发送 SIGKILL
4. 返回超时错误

---

## 脚本类型适配

### Node.js 模块

- 入口文件：`module.js` 或 `index.js`
- 运行方式：`node module.js`
- 通信方式：`process.stdin`、`process.stdout`、`process.stderr`
- 退出方式：`process.exit(code)`

### Python 模块

- 入口文件：`module.py` 或 `__main__.py`
- 运行方式：`python3 module.py`
- 通信方式：`sys.stdin`、`sys.stdout`、`sys.stderr`
- 退出方式：`sys.exit(code)`

### Shell 模块

- 入口文件：`module.sh`
- 运行方式：`bash module.sh`
- 通信方式：标准输入输出
- 退出方式：`exit code`

---

## 实现建议

### 1. 状态管理

- 使用 PID 文件记录进程 ID
- 使用状态文件记录模块状态
- 定期检查进程是否存活

### 2. 日志管理

- 使用滚动日志文件（避免无限增长）
- 日志格式统一（时间戳 + 级别 + 消息）
- 支持日志级别过滤

### 3. 配置管理

- 使用配置文件（JSON 或 YAML）
- 支持配置验证
- 配置变更后自动重载

### 4. 错误处理

- 捕获所有异常，避免进程崩溃
- 错误信息清晰，包含上下文
- 区分可恢复错误和致命错误

### 5. 资源清理

- 停止时清理临时文件
- 关闭所有打开的连接
- 释放占用的端口

---

## 示例实现

### Node.js 示例

```javascript
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    
    switch (request.method) {
      case 'status':
        const status = await getStatus();
        console.log(JSON.stringify(status));
        process.exit(0);
        break;
        
      case 'start':
        const started = await startModule();
        console.log(JSON.stringify({ success: started }));
        process.exit(started ? 0 : 1);
        break;
        
      case 'stop':
        const stopped = await stopModule(request.force);
        console.log(JSON.stringify({ success: stopped }));
        process.exit(stopped ? 0 : 1);
        break;
        
      case 'logs':
        const logs = await getLogs(request.lines || 100);
        console.log(JSON.stringify({ logs }));
        process.exit(0);
        break;
        
      case 'settings':
        if (request.action === 'get') {
          const settings = await getSettings();
          console.log(JSON.stringify({ settings }));
          process.exit(0);
        } else if (request.action === 'set') {
          const success = await setSetting(request.key, request.value);
          console.log(JSON.stringify({ success }));
          process.exit(success ? 0 : 1);
        }
        break;
        
      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
});
```

### Python 示例

```python
import sys
import json

def handle_request(request):
    method = request.get('method')
    
    if method == 'status':
        status = get_status()
        print(json.dumps(status))
        sys.exit(0)
        
    elif method == 'start':
        success = start_module()
        print(json.dumps({'success': success}))
        sys.exit(0 if success else 1)
        
    elif method == 'stop':
        force = request.get('force', False)
        success = stop_module(force)
        print(json.dumps({'success': success}))
        sys.exit(0 if success else 1)
        
    elif method == 'logs':
        lines = request.get('lines', 100)
        logs = get_logs(lines)
        print(json.dumps({'logs': logs}))
        sys.exit(0)
        
    elif method == 'settings':
        action = request.get('action')
        if action == 'get':
            settings = get_settings()
            print(json.dumps({'settings': settings}))
            sys.exit(0)
        elif action == 'set':
            key = request.get('key')
            value = request.get('value')
            success = set_setting(key, value)
            print(json.dumps({'success': success}))
            sys.exit(0 if success else 1)
    
    else:
        raise ValueError(f'Unknown method: {method}')

if __name__ == '__main__':
    try:
        line = sys.stdin.readline()
        request = json.loads(line)
        handle_request(request)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
```

### Shell 示例

```bash
#!/bin/bash

# 读取 stdin
read -r input

# 解析 JSON（使用 jq）
method=$(echo "$input" | jq -r '.method')

case "$method" in
  status)
    status=$(get_status)
    echo "$status"
    exit 0
    ;;
    
  start)
    if start_module; then
      echo '{"success":true}'
      exit 0
    else
      echo "Failed to start module" >&2
      exit 1
    fi
    ;;
    
  stop)
    force=$(echo "$input" | jq -r '.force // false')
    if stop_module "$force"; then
      echo '{"success":true}'
      exit 0
    else
      echo "Failed to stop module" >&2
      exit 1
    fi
    ;;
    
  logs)
    lines=$(echo "$input" | jq -r '.lines // 100')
    logs=$(get_logs "$lines")
    echo "{\"logs\":$logs}"
    exit 0
    ;;
    
  settings)
    action=$(echo "$input" | jq -r '.action')
    if [ "$action" = "get" ]; then
      settings=$(get_settings)
      echo "{\"settings\":$settings}"
      exit 0
    elif [ "$action" = "set" ]; then
      key=$(echo "$input" | jq -r '.key')
      value=$(echo "$input" | jq -r '.value')
      if set_setting "$key" "$value"; then
        echo '{"success":true}'
        exit 0
      else
        echo "Failed to set setting" >&2
        exit 1
      fi
    fi
    ;;
    
  *)
    echo "Unknown method: $method" >&2
    exit 1
    ;;
esac
```

---

## 模块元数据

每个模块需要提供元数据，用于中控台识别和管理：

```typescript
{
  id: string;              // 模块唯一标识
  name: string;            // 模块名称
  description?: string;    // 模块描述
  type: 'nodejs' | 'python' | 'shell';  // 脚本类型
  scriptPath: string;      // 脚本路径
  autoStart: boolean;      // 是否开机自启
  enabled: boolean;        // 是否已启用
}
```

---

## 测试建议

### 单元测试

- 测试每个接口的正常流程
- 测试错误处理（无效参数、超时等）
- 测试边界条件（空日志、重复启动等）

### 集成测试

- 测试完整的启动-运行-停止流程
- 测试配置变更后的行为
- 测试异常情况下的恢复能力

### 性能测试

- 测试高频调用下的响应时间
- 测试资源占用（内存、CPU）
- 测试并发调用的稳定性

---

## 版本历史

- v1.0.0 (2026-05-22) - 初始版本，定义 5 个核心接口

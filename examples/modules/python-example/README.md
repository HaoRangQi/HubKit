# HubKit Python 示例模块

这是一个完整的 Python 模块示例，演示了如何实现 HubKit 模块协议的所有 5 个接口。

## 功能特性

- ✅ 实现所有 5 个协议接口（status、start、stop、logs、settings）
- ✅ 后台进程管理（使用 fork）
- ✅ PID 文件管理
- ✅ 滚动日志文件
- ✅ JSON 配置文件
- ✅ 信号处理（SIGTERM、SIGINT）
- ✅ 错误处理和标准错误码
- ✅ 可选的 psutil 支持（用于资源监控）

## 文件结构

```
python-example/
├── module.py         # 主模块文件，实现协议接口
├── requirements.txt  # Python 依赖
├── config.json       # 配置文件（自动生成）
├── .module.pid       # PID 文件（运行时生成）
├── .module.state     # 状态文件（运行时生成）
└── .module.log       # 日志文件（运行时生成）
```

## 快速开始

### 1. 安装依赖

```bash
# 可选：创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖（psutil 是可选的，用于更准确的资源监控）
pip install -r requirements.txt
```

### 2. 设置执行权限

```bash
chmod +x module.py
```

### 3. 测试接口

**查询状态**

```bash
echo '{"method":"status"}' | python3 module.py
```

**启动模块**

```bash
echo '{"method":"start"}' | python3 module.py
```

**查询运行状态**

```bash
echo '{"method":"status"}' | python3 module.py
```

**获取日志**

```bash
echo '{"method":"logs","lines":10}' | python3 module.py
```

**获取配置**

```bash
echo '{"method":"settings","action":"get"}' | python3 module.py
```

**更新配置**

```bash
echo '{"method":"settings","action":"set","key":"port","value":8080}' | python3 module.py
```

**停止模块**

```bash
echo '{"method":"stop"}' | python3 module.py
```

**强制停止**

```bash
echo '{"method":"stop","force":true}' | python3 module.py
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
  "cpu": 2.5
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
      "key": "host",
      "value": "0.0.0.0",
      "description": "Server host address",
      "required": true
    },
    {
      "key": "port",
      "value": 5000,
      "description": "Server port",
      "required": true
    },
    {
      "key": "workers",
      "value": 4,
      "description": "Number of worker processes",
      "required": false
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
- 通过 `os.kill(pid, 0)` 检查进程是否存活

### 日志管理

- 日志写入 `.module.log` 文件
- JSON 格式：`{"timestamp":"...","level":"...","message":"..."}`
- 超过 10MB 自动滚动到 `.module.log.old`

### 配置管理

- 配置存储在 `config.json` 文件
- 支持类型验证
- 支持必需字段检查

### 进程管理

- 使用 `os.fork()` 创建后台进程
- 使用 `os.setsid()` 创建新会话
- 重定向标准输入输出，避免干扰

### 信号处理

- SIGTERM - 优雅退出
- SIGINT - 立即退出
- SIGKILL - 强制终止（force=true）

### 资源监控

- 如果安装了 `psutil`，提供准确的内存和 CPU 使用率
- 否则返回 0（简化实现）

## 测试脚本

创建 `test.sh` 文件：

```bash
#!/bin/bash

echo "=== Testing Python Module ==="

echo -e "\n1. Testing status (should be stopped)..."
echo '{"method":"status"}' | python3 module.py

echo -e "\n2. Testing start..."
echo '{"method":"start"}' | python3 module.py

echo -e "\n3. Waiting 2 seconds..."
sleep 2

echo -e "\n4. Testing status (should be running)..."
echo '{"method":"status"}' | python3 module.py

echo -e "\n5. Testing logs..."
echo '{"method":"logs","lines":5}' | python3 module.py

echo -e "\n6. Testing settings get..."
echo '{"method":"settings","action":"get"}' | python3 module.py

echo -e "\n7. Testing settings set..."
echo '{"method":"settings","action":"set","key":"port","value":8080}' | python3 module.py

echo -e "\n8. Testing settings get (verify change)..."
echo '{"method":"settings","action":"get"}' | python3 module.py

echo -e "\n9. Testing stop..."
echo '{"method":"stop"}' | python3 module.py

echo -e "\n10. Testing status (should be stopped)..."
echo '{"method":"status"}' | python3 module.py

echo -e "\n=== All tests completed ==="
```

运行测试：

```bash
chmod +x test.sh
./test.sh
```

## Python 特性

### 虚拟环境支持

HubKit 的 Python 适配器会自动检测虚拟环境：

```
my-module/
├── venv/          # 或 .venv/
│   └── bin/
│       └── python
└── module.py
```

适配器会优先使用虚拟环境中的 Python。

### 依赖管理

使用 `requirements.txt` 管理依赖：

```txt
psutil>=5.9.0  # 可选，用于资源监控
```

安装依赖：

```bash
pip install -r requirements.txt
```

### 输出缓冲

HubKit 的 Python 适配器会自动设置 `PYTHONUNBUFFERED=1`，确保输出立即刷新。

## 扩展建议

### 1. 使用 Flask/FastAPI 构建 Web 服务

```python
from flask import Flask

app = Flask(__name__)

@app.route('/health')
def health():
    return {'status': 'ok'}

def run_worker():
    config = json.load(open(CONFIG_FILE))
    app.run(host=config['host'], port=config['port'])
```

### 2. 使用 multiprocessing 实现多进程

```python
from multiprocessing import Process

def worker_process():
    while True:
        # 工作负载
        time.sleep(1)

def run_worker():
    workers = []
    for i in range(4):
        p = Process(target=worker_process)
        p.start()
        workers.append(p)
    
    for p in workers:
        p.join()
```

### 3. 使用 asyncio 实现异步任务

```python
import asyncio

async def worker_task():
    while True:
        await asyncio.sleep(5)
        log('info', 'Worker heartbeat')

def run_worker():
    asyncio.run(worker_task())
```

### 4. 添加配置验证

```python
def validate_config(config):
    if config['port'] < 1024 or config['port'] > 65535:
        raise ValueError('Invalid port range')
    
    if config['workers'] < 1 or config['workers'] > 32:
        raise ValueError('Invalid worker count')
```

## 常见问题

### Q: 为什么需要 psutil？

A: `psutil` 用于获取准确的内存和 CPU 使用率。如果不安装，模块仍然可以运行，但资源监控数据会返回 0。

### Q: 如何在虚拟环境中运行？

A: HubKit 的 Python 适配器会自动检测并使用虚拟环境。只需确保虚拟环境位于 `venv/` 或 `.venv/` 目录。

### Q: 如何处理长时间运行的任务？

A: 使用 `os.fork()` 创建后台进程，父进程立即返回，子进程继续运行任务。

### Q: 如何实现自动重启？

A: 可以在工作进程中添加异常处理和重启逻辑，或者使用外部进程监控工具（如 supervisord）。

## 相关资源

- [模块协议规范](../../../docs/module-protocol.md)
- [模块接入指南](../../../docs/module-integration-guide.md)
- [Node.js 示例](../node-example/)
- [Shell 示例](../shell-example/)

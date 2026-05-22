# HubKit Shell 示例模块

这是一个完整的 Shell 模块示例，演示了如何实现 HubKit 模块协议的所有 5 个接口。

## 功能特性

- ✅ 实现所有 5 个协议接口（status、start、stop、logs、settings）
- ✅ 后台进程管理（使用 setsid）
- ✅ PID 文件管理
- ✅ 滚动日志文件
- ✅ JSON 配置文件
- ✅ 信号处理（SIGTERM、SIGINT）
- ✅ 错误处理和标准错误码
- ✅ 使用 jq 处理 JSON

## 文件结构

```
shell-example/
├── module.sh       # 主模块文件，实现协议接口
├── worker.sh       # 工作进程，模拟长时间运行的任务
├── config.json     # 配置文件（自动生成）
├── .module.pid     # PID 文件（运行时生成）
├── .module.state   # 状态文件（运行时生成）
└── .module.log     # 日志文件（运行时生成）
```

## 依赖要求

- **bash** - Shell 解释器
- **jq** - JSON 处理工具

### 安装 jq

**macOS**

```bash
brew install jq
```

**Ubuntu/Debian**

```bash
sudo apt-get install jq
```

**CentOS/RHEL**

```bash
sudo yum install jq
```

## 快速开始

### 1. 设置执行权限

```bash
chmod +x module.sh worker.sh
```

### 2. 测试接口

**查询状态**

```bash
echo '{"method":"status"}' | bash module.sh
```

**启动模块**

```bash
echo '{"method":"start"}' | bash module.sh
```

**查询运行状态**

```bash
echo '{"method":"status"}' | bash module.sh
```

**获取日志**

```bash
echo '{"method":"logs","lines":10}' | bash module.sh
```

**获取配置**

```bash
echo '{"method":"settings","action":"get"}' | bash module.sh
```

**更新配置**

```bash
echo '{"method":"settings","action":"set","key":"interval","value":20}' | bash module.sh
```

**停止模块**

```bash
echo '{"method":"stop"}' | bash module.sh
```

**强制停止**

```bash
echo '{"method":"stop","force":true}' | bash module.sh
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
  "memory": 2.5,
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
      "key": "interval",
      "value": 10,
      "description": "Heartbeat interval in seconds",
      "required": true
    },
    {
      "key": "maxLogs",
      "value": 1000,
      "description": "Maximum number of log entries",
      "required": false
    },
    {
      "key": "enabled",
      "value": true,
      "description": "Enable module",
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
  "key": "interval",
  "value": 20
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
- 通过 `kill -0 $pid` 检查进程是否存活

### 日志管理

- 日志写入 `.module.log` 文件
- JSON 格式：`{"timestamp":"...","level":"...","message":"..."}`
- 超过 10MB 自动滚动到 `.module.log.old`

### 配置管理

- 配置存储在 `config.json` 文件
- 使用 `jq` 处理 JSON 数据
- 支持类型验证

### 进程管理

- 使用 `setsid` 创建新会话
- 后台运行工作进程
- 记录 PID 到文件

### 信号处理

- SIGTERM (kill -15) - 优雅退出
- SIGINT (Ctrl+C) - 立即退出
- SIGKILL (kill -9) - 强制终止（force=true）

### JSON 处理

- 使用 `jq` 解析和生成 JSON
- 支持复杂的 JSON 操作
- 错误处理和验证

## 测试脚本

创建 `test.sh` 文件：

```bash
#!/bin/bash

echo "=== Testing Shell Module ==="

echo -e "\n1. Testing status (should be stopped)..."
echo '{"method":"status"}' | bash module.sh

echo -e "\n2. Testing start..."
echo '{"method":"start"}' | bash module.sh

echo -e "\n3. Waiting 2 seconds..."
sleep 2

echo -e "\n4. Testing status (should be running)..."
echo '{"method":"status"}' | bash module.sh

echo -e "\n5. Testing logs..."
echo '{"method":"logs","lines":5}' | bash module.sh

echo -e "\n6. Testing settings get..."
echo '{"method":"settings","action":"get"}' | bash module.sh

echo -e "\n7. Testing settings set..."
echo '{"method":"settings","action":"set","key":"interval","value":20}' | bash module.sh

echo -e "\n8. Testing settings get (verify change)..."
echo '{"method":"settings","action":"get"}' | bash module.sh

echo -e "\n9. Testing stop..."
echo '{"method":"stop"}' | bash module.sh

echo -e "\n10. Testing status (should be stopped)..."
echo '{"method":"status"}' | bash module.sh

echo -e "\n=== All tests completed ==="
```

运行测试：

```bash
chmod +x test.sh
./test.sh
```

## Shell 特性

### Shebang 支持

HubKit 的 Shell 适配器会自动检测 shebang 行：

```bash
#!/bin/bash      # 使用 bash
#!/bin/zsh       # 使用 zsh
#!/bin/sh        # 使用 sh
```

### 执行权限

适配器会自动添加执行权限（如果缺失）：

```bash
chmod +x module.sh
```

### 环境变量

可以在脚本中使用环境变量：

```bash
export MODULE_ENV="production"
export MODULE_DEBUG="false"
```

## 扩展建议

### 1. 添加配置验证

```bash
validate_config() {
  local interval=$(jq -r '.interval' "$CONFIG_FILE")
  
  if [ "$interval" -lt 1 ] || [ "$interval" -gt 3600 ]; then
    echo "Invalid interval: must be between 1 and 3600" >&2
    exit $EXIT_CONFIG_ERROR
  fi
}
```

### 2. 添加健康检查

```bash
health_check() {
  # 检查磁盘空间
  local disk_usage=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
  
  if [ "$disk_usage" -gt 90 ]; then
    log_message "warn" "Disk usage is high: ${disk_usage}%"
  fi
}
```

### 3. 添加性能监控

```bash
get_metrics() {
  local pid=$(cat "$PID_FILE")
  
  # CPU 使用率
  local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null || echo 0)
  
  # 内存使用
  local memory=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{print $1/1024}' || echo 0)
  
  echo "{\"cpu\":$cpu,\"memory\":$memory}"
}
```

### 4. 添加日志级别过滤

```bash
get_logs_by_level() {
  local lines="$1"
  local level="$2"
  
  if [ -z "$level" ]; then
    tail -n "$lines" "$LOG_FILE"
  else
    grep "\"level\":\"$level\"" "$LOG_FILE" | tail -n "$lines"
  fi
}
```

### 5. 添加自动重启

```bash
watch_process() {
  while true; do
    if [ -f "$PID_FILE" ]; then
      local pid=$(cat "$PID_FILE")
      if ! is_process_running "$pid"; then
        log_message "error" "Process died, restarting..."
        start_module
      fi
    fi
    sleep 10
  done
}
```

## 常见问题

### Q: 为什么需要 jq？

A: `jq` 是一个强大的 JSON 处理工具，用于解析和生成 JSON 数据。Shell 原生不支持 JSON，所以需要 jq。

### Q: 如何在不同的 Shell 中运行？

A: 修改 shebang 行即可：

```bash
#!/bin/bash   # Bash
#!/bin/zsh    # Zsh
#!/bin/sh     # POSIX Shell
```

### Q: 如何处理复杂的 JSON？

A: 使用 jq 的高级功能：

```bash
# 嵌套 JSON
jq '.settings.database.host' config.json

# 数组操作
jq '.items[] | select(.active == true)' data.json

# 条件过滤
jq 'map(select(.value > 10))' numbers.json
```

### Q: 如何调试 Shell 脚本？

A: 使用 bash 的调试选项：

```bash
# 显示执行的命令
bash -x module.sh

# 遇到错误立即退出
bash -e module.sh

# 组合使用
bash -ex module.sh
```

## 性能优化

### 1. 减少子进程调用

```bash
# 慢
for i in $(seq 1 100); do
  echo $i
done

# 快
for ((i=1; i<=100; i++)); do
  echo $i
done
```

### 2. 使用内置命令

```bash
# 慢
result=$(cat file.txt)

# 快
result=$(<file.txt)
```

### 3. 批量处理

```bash
# 慢
for file in *.txt; do
  process_file "$file"
done

# 快
find . -name "*.txt" -print0 | xargs -0 -P 4 process_file
```

## 相关资源

- [模块协议规范](../../../docs/module-protocol.md)
- [模块接入指南](../../../docs/module-integration-guide.md)
- [Node.js 示例](../node-example/)
- [Python 示例](../python-example/)
- [jq 官方文档](https://stedolan.github.io/jq/)

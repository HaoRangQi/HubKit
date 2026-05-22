#!/bin/bash

# HubKit Shell 模块示例
# 实现所有 5 个协议接口

# 配置文件路径
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$BASE_DIR/.module.pid"
LOG_FILE="$BASE_DIR/.module.log"
CONFIG_FILE="$BASE_DIR/config.json"
STATE_FILE="$BASE_DIR/.module.state"

# 错误码
EXIT_SUCCESS=0
EXIT_GENERAL_ERROR=1
EXIT_INVALID_ARGUMENT=2
EXIT_NOT_INITIALIZED=3
EXIT_ALREADY_RUNNING=4
EXIT_NOT_RUNNING=5
EXIT_TIMEOUT=6
EXIT_PERMISSION_DENIED=7
EXIT_RESOURCE_UNAVAILABLE=8
EXIT_CONFIG_ERROR=9

# 默认配置
DEFAULT_CONFIG='{
  "interval": 10,
  "maxLogs": 1000,
  "enabled": true
}'

# 初始化配置文件
init_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "$DEFAULT_CONFIG" > "$CONFIG_FILE"
  fi
}

# 日志函数
log_message() {
  local level="$1"
  local message="$2"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  local log_entry=$(cat <<EOF
{"timestamp":"$timestamp","level":"$level","message":"$message"}
EOF
)

  echo "$log_entry" >> "$LOG_FILE"

  # 检查日志大小，超过 10MB 则滚动
  if [ -f "$LOG_FILE" ]; then
    local size=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$size" -gt 10485760 ]; then
      mv "$LOG_FILE" "$LOG_FILE.old"
    fi
  fi
}

# 检查进程是否运行
is_process_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
  return $?
}

# 获取模块状态
get_status() {
  # 读取 PID 文件
  if [ ! -f "$PID_FILE" ]; then
    echo '{"status":"stopped"}'
    return 0
  fi

  local pid=$(cat "$PID_FILE")

  # 检查进程是否存活
  if ! is_process_running "$pid"; then
    # 进程已死，清理 PID 文件
    rm -f "$PID_FILE"
    echo '{"status":"stopped"}'
    return 0
  fi

  # 读取状态文件
  local started_at=""
  if [ -f "$STATE_FILE" ]; then
    started_at=$(jq -r '.startedAt' "$STATE_FILE")
  fi

  # 计算运行时长
  local uptime=0
  if [ -n "$started_at" ]; then
    local start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${started_at%.*}" +%s 2>/dev/null || echo 0)
    local now_epoch=$(date +%s)
    uptime=$((now_epoch - start_epoch))
  fi

  # 获取内存使用情况（简化版）
  local memory=0
  if command -v ps &> /dev/null; then
    memory=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{print $1/1024}' || echo 0)
  fi

  # 构建响应
  cat <<EOF
{"status":"running","pid":$pid,"startedAt":"$started_at","uptime":$uptime,"memory":$memory,"cpu":0}
EOF
}

# 启动模块
start_module() {
  # 检查是否已在运行
  if [ -f "$PID_FILE" ]; then
    local pid=$(cat "$PID_FILE")
    if is_process_running "$pid"; then
      echo "Module already running (PID: $pid)" >&2
      exit $EXIT_ALREADY_RUNNING
    fi
    # 清理旧的 PID 文件
    rm -f "$PID_FILE"
  fi

  # 启动后台进程
  (
    # 创建新会话
    setsid bash "$BASE_DIR/worker.sh" &
    local worker_pid=$!

    # 写入 PID 文件
    echo "$worker_pid" > "$PID_FILE"

    # 写入状态文件
    local started_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    cat <<EOF > "$STATE_FILE"
{
  "startedAt": "$started_at",
  "pid": $worker_pid
}
EOF

    # 记录日志
    log_message "info" "Module started with PID $worker_pid"

    # 输出响应
    echo "{\"success\":true,\"pid\":$worker_pid,\"message\":\"Module started successfully\"}"
  )
}

# 停止模块
stop_module() {
  local force="$1"

  # 读取 PID 文件
  if [ ! -f "$PID_FILE" ]; then
    echo '{"success":true,"message":"Module already stopped"}'
    return 0
  fi

  local pid=$(cat "$PID_FILE")

  # 检查进程是否存活
  if ! is_process_running "$pid"; then
    # 清理文件
    rm -f "$PID_FILE" "$STATE_FILE"
    echo '{"success":true,"message":"Module already stopped"}'
    return 0
  fi

  # 发送停止信号
  if [ "$force" = "true" ]; then
    kill -9 "$pid" 2>/dev/null
    local signal="SIGKILL"
  else
    kill -15 "$pid" 2>/dev/null
    local signal="SIGTERM"
  fi

  # 等待进程退出
  local attempts=0
  local max_attempts=30

  while is_process_running "$pid" && [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    sleep 0.1
  done

  # 清理文件
  rm -f "$PID_FILE" "$STATE_FILE"

  # 记录日志
  log_message "info" "Module stopped (PID: $pid, signal: $signal)"

  echo '{"success":true,"message":"Module stopped successfully"}'
}

# 获取日志
get_logs() {
  local lines="$1"

  if [ ! -f "$LOG_FILE" ]; then
    echo '{"logs":[]}'
    return 0
  fi

  # 读取最近 N 行日志
  local log_lines=$(tail -n "$lines" "$LOG_FILE" | sed 's/$/,/' | sed '$ s/,$//')

  # 构建 JSON 数组
  echo "{\"logs\":[$log_lines]}"
}

# 获取配置
get_settings() {
  init_config

  local settings=$(jq -r 'to_entries | map({
    key: .key,
    value: .value,
    description: (
      if .key == "interval" then "Heartbeat interval in seconds"
      elif .key == "maxLogs" then "Maximum number of log entries"
      elif .key == "enabled" then "Enable module"
      else ""
      end
    ),
    required: (
      if .key == "interval" then true
      else false
      end
    )
  })' "$CONFIG_FILE")

  echo "{\"settings\":$settings}"
}

# 设置配置
set_setting() {
  local key="$1"
  local value="$2"

  init_config

  # 验证配置键
  if ! jq -e "has(\"$key\")" "$CONFIG_FILE" > /dev/null; then
    echo "Unknown setting: $key" >&2
    exit $EXIT_INVALID_ARGUMENT
  fi

  # 更新配置
  local temp_file=$(mktemp)
  jq ".$key = $value" "$CONFIG_FILE" > "$temp_file"
  mv "$temp_file" "$CONFIG_FILE"

  # 记录日志
  log_message "info" "Setting updated: $key = $value"

  echo '{"success":true,"message":"Setting updated successfully"}'
}

# 处理请求
handle_request() {
  local request="$1"
  local method=$(echo "$request" | jq -r '.method')

  case "$method" in
    status)
      get_status
      exit $EXIT_SUCCESS
      ;;

    start)
      start_module
      exit $EXIT_SUCCESS
      ;;

    stop)
      local force=$(echo "$request" | jq -r '.force // false')
      stop_module "$force"
      exit $EXIT_SUCCESS
      ;;

    logs)
      local lines=$(echo "$request" | jq -r '.lines // 100')
      get_logs "$lines"
      exit $EXIT_SUCCESS
      ;;

    settings)
      local action=$(echo "$request" | jq -r '.action')

      if [ "$action" = "get" ]; then
        get_settings
        exit $EXIT_SUCCESS
      elif [ "$action" = "set" ]; then
        local key=$(echo "$request" | jq -r '.key')
        local value=$(echo "$request" | jq -r '.value')

        if [ -z "$key" ] || [ "$value" = "null" ]; then
          echo "Missing key or value for settings.set" >&2
          exit $EXIT_INVALID_ARGUMENT
        fi

        set_setting "$key" "$value"
        exit $EXIT_SUCCESS
      else
        echo "Unknown settings action: $action" >&2
        exit $EXIT_INVALID_ARGUMENT
      fi
      ;;

    *)
      echo "Unknown method: $method" >&2
      exit $EXIT_INVALID_ARGUMENT
      ;;
  esac
}

# 主函数
main() {
  # 检查 jq 是否安装
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed" >&2
    exit $EXIT_GENERAL_ERROR
  fi

  # 读取 stdin
  local request=$(cat)

  # 处理请求
  handle_request "$request"
}

# 启动
main

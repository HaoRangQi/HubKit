#!/bin/bash

# 工作进程，模拟长时间运行的任务

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$BASE_DIR/.module.log"

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
}

# 记录启动
log_message "info" "Worker process started"

# 清理函数
cleanup() {
  log_message "info" "Worker process stopping"
  exit 0
}

# 注册信号处理
trap cleanup SIGTERM SIGINT

# 模拟工作负载
counter=0

while true; do
  counter=$((counter + 1))
  log_message "info" "Worker heartbeat: $counter"

  # 每 10 次心跳记录一次调试信息
  if [ $((counter % 10)) -eq 0 ]; then
    log_message "debug" "Worker still running, counter: $counter"
  fi

  sleep 5  # 每 5 秒一次心跳
done

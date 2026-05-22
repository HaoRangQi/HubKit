#!/bin/bash

# Shell 示例模块
#
# 这是一个简单的后台任务，演示如何创建一个可被中控台管理的 Shell 模块

PORT=${PORT:-9000}
PID_FILE="/tmp/hello-shell.pid"

echo "Shell module starting..."
echo "PID: $$"
echo "Port: $PORT"

# 保存 PID
echo $$ > "$PID_FILE"

# 信号处理
cleanup() {
    echo "Received signal, shutting down gracefully..."
    rm -f "$PID_FILE"
    exit 0
}

trap cleanup SIGTERM SIGINT

# 简单的 HTTP 服务器（使用 nc）
serve() {
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local uptime=$SECONDS

    echo "HTTP/1.1 200 OK"
    echo "Content-Type: application/json"
    echo ""
    echo "{\"message\":\"Hello from Shell module!\",\"timestamp\":\"$timestamp\",\"uptime\":$uptime,\"pid\":$$}"
}

# 主循环
echo "Server running on http://localhost:$PORT"

while true; do
    # 使用 nc (netcat) 监听端口
    if command -v nc &> /dev/null; then
        serve | nc -l -p $PORT -q 1 > /dev/null 2>&1
    else
        # 如果没有 nc，只是简单地循环并输出日志
        echo "[$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")] Heartbeat - uptime: ${SECONDS}s"
        sleep 10
    fi
done

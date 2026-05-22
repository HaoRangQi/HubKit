#!/usr/bin/env python3
"""
Python 示例模块

这是一个简单的 HTTP 服务器，演示如何创建一个可被中控台管理的 Python 模块
"""

import os
import sys
import signal
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
import json

PORT = int(os.environ.get('PORT', 8000))
start_time = time.time()

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"[{datetime.now().isoformat()}] {self.command} {self.path}", flush=True)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

        response = {
            'message': 'Hello from Python module!',
            'timestamp': datetime.now().isoformat(),
            'uptime': time.time() - start_time,
            'pid': os.getpid()
        }

        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format, *args):
        # 禁用默认日志，使用自定义格式
        pass

def shutdown_handler(signum, frame):
    print(f"\nReceived signal {signum}, shutting down gracefully...", flush=True)
    sys.exit(0)

def main():
    # 注册信号处理
    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    server = HTTPServer(('localhost', PORT), RequestHandler)

    print(f"Server running on http://localhost:{PORT}", flush=True)
    print(f"PID: {os.getpid()}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
    finally:
        server.server_close()
        print("Server closed", flush=True)

if __name__ == '__main__':
    main()

#!/usr/bin/env python3

import sys
import json
import os
import signal
import time
from pathlib import Path
from datetime import datetime

# 配置文件路径
BASE_DIR = Path(__file__).parent
PID_FILE = BASE_DIR / '.module.pid'
LOG_FILE = BASE_DIR / '.module.log'
CONFIG_FILE = BASE_DIR / 'config.json'
STATE_FILE = BASE_DIR / '.module.state'

# 默认配置
DEFAULT_CONFIG = {
    'host': '0.0.0.0',
    'port': 5000,
    'workers': 4,
    'debug': False
}

# 错误码
EXIT_CODES = {
    'SUCCESS': 0,
    'GENERAL_ERROR': 1,
    'INVALID_ARGUMENT': 2,
    'NOT_INITIALIZED': 3,
    'ALREADY_RUNNING': 4,
    'NOT_RUNNING': 5,
    'TIMEOUT': 6,
    'PERMISSION_DENIED': 7,
    'RESOURCE_UNAVAILABLE': 8,
    'CONFIG_ERROR': 9
}


def init_config():
    """初始化配置文件"""
    if not CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'w') as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)


def log(level, message):
    """写入日志"""
    timestamp = datetime.utcnow().isoformat() + 'Z'
    log_entry = json.dumps({
        'timestamp': timestamp,
        'level': level,
        'message': message
    }) + '\n'

    try:
        with open(LOG_FILE, 'a') as f:
            f.write(log_entry)

        # 检查日志大小，超过 10MB 则滚动
        if LOG_FILE.stat().st_size > 10 * 1024 * 1024:
            LOG_FILE.rename(str(LOG_FILE) + '.old')
    except Exception:
        # 忽略日志写入错误
        pass


def is_process_running(pid):
    """检查进程是否运行"""
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def get_status():
    """获取模块状态"""
    try:
        # 读取 PID 文件
        if not PID_FILE.exists():
            return {'status': 'stopped'}

        with open(PID_FILE, 'r') as f:
            pid = int(f.read().strip())

        # 检查进程是否存活
        if not is_process_running(pid):
            # 进程已死，清理 PID 文件
            PID_FILE.unlink()
            return {'status': 'stopped'}

        # 读取状态文件
        started_at = None
        if STATE_FILE.exists():
            with open(STATE_FILE, 'r') as f:
                state = json.load(f)
                started_at = state.get('startedAt')

        # 计算运行时长
        uptime = 0
        if started_at:
            start_time = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
            uptime = int((datetime.now(start_time.tzinfo) - start_time).total_seconds())

        # 获取内存使用情况（简化版）
        try:
            import psutil
            process = psutil.Process(pid)
            memory = round(process.memory_info().rss / 1024 / 1024, 1)
            cpu = round(process.cpu_percent(interval=0.1), 1)
        except ImportError:
            memory = 0
            cpu = 0

        return {
            'status': 'running',
            'pid': pid,
            'startedAt': started_at,
            'uptime': uptime,
            'memory': memory,
            'cpu': cpu
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e)
        }


def start_module():
    """启动模块"""
    try:
        # 检查是否已在运行
        if PID_FILE.exists():
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            if is_process_running(pid):
                raise Exception(f'Module already running (PID: {pid})')
            # 清理旧的 PID 文件
            PID_FILE.unlink()

        # 启动后台进程
        pid = os.fork()

        if pid > 0:
            # 父进程
            # 写入 PID 文件
            with open(PID_FILE, 'w') as f:
                f.write(str(pid))

            # 写入状态文件
            state = {
                'startedAt': datetime.utcnow().isoformat() + 'Z',
                'pid': pid
            }
            with open(STATE_FILE, 'w') as f:
                json.dump(state, f, indent=2)

            # 记录日志
            log('info', f'Module started with PID {pid}')

            return {
                'success': True,
                'pid': pid,
                'message': 'Module started successfully'
            }
        else:
            # 子进程 - 运行工作进程
            os.setsid()  # 创建新会话

            # 重定向标准输入输出
            sys.stdin.close()
            sys.stdout.close()
            sys.stderr.close()

            # 运行工作负载
            run_worker()
            sys.exit(0)

    except Exception as e:
        log('error', f'Failed to start module: {str(e)}')
        raise


def run_worker():
    """工作进程"""
    log('info', 'Worker process started')

    counter = 0

    def cleanup(signum, frame):
        log('info', 'Worker process stopping')
        sys.exit(0)

    # 注册信号处理
    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    # 模拟工作负载
    while True:
        counter += 1
        log('info', f'Worker heartbeat: {counter}')

        # 每 10 次心跳记录一次调试信息
        if counter % 10 == 0:
            log('debug', f'Worker still running, counter: {counter}')

        time.sleep(5)  # 每 5 秒一次心跳


def stop_module(force=False):
    """停止模块"""
    try:
        # 读取 PID 文件
        if not PID_FILE.exists():
            return {
                'success': True,
                'message': 'Module already stopped'
            }

        with open(PID_FILE, 'r') as f:
            pid = int(f.read().strip())

        # 检查进程是否存活
        if not is_process_running(pid):
            # 清理文件
            PID_FILE.unlink()
            if STATE_FILE.exists():
                STATE_FILE.unlink()
            return {
                'success': True,
                'message': 'Module already stopped'
            }

        # 发送停止信号
        sig = signal.SIGKILL if force else signal.SIGTERM
        os.kill(pid, sig)

        # 等待进程退出
        attempts = 0
        max_attempts = 30  # 3 秒

        while is_process_running(pid) and attempts < max_attempts:
            attempts += 1
            time.sleep(0.1)

        # 清理文件
        if PID_FILE.exists():
            PID_FILE.unlink()
        if STATE_FILE.exists():
            STATE_FILE.unlink()

        # 记录日志
        signal_name = 'SIGKILL' if force else 'SIGTERM'
        log('info', f'Module stopped (PID: {pid}, signal: {signal_name})')

        return {
            'success': True,
            'message': 'Module stopped successfully'
        }
    except Exception as e:
        log('error', f'Failed to stop module: {str(e)}')
        raise


def get_logs(lines=100):
    """获取日志"""
    try:
        if not LOG_FILE.exists():
            return {'logs': []}

        with open(LOG_FILE, 'r') as f:
            all_lines = [line.strip() for line in f if line.strip()]

        recent_lines = all_lines[-lines:]

        logs = []
        for line in recent_lines:
            try:
                logs.append(json.loads(line))
            except json.JSONDecodeError:
                # 解析失败，返回原始文本
                logs.append({
                    'timestamp': datetime.utcnow().isoformat() + 'Z',
                    'level': 'info',
                    'message': line
                })

        return {'logs': logs}
    except Exception as e:
        raise Exception(f'Failed to read logs: {str(e)}')


def get_settings():
    """获取配置"""
    try:
        init_config()
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)

        settings = []
        for key, value in config.items():
            settings.append({
                'key': key,
                'value': value,
                'description': get_setting_description(key),
                'required': is_setting_required(key)
            })

        return {'settings': settings}
    except Exception as e:
        raise Exception(f'Failed to get settings: {str(e)}')


def set_setting(key, value):
    """设置配置"""
    try:
        init_config()
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)

        # 验证配置键
        if key not in DEFAULT_CONFIG:
            raise Exception(f'Unknown setting: {key}')

        # 验证配置值类型
        expected_type = type(DEFAULT_CONFIG[key])
        actual_type = type(value)

        if expected_type != actual_type:
            raise Exception(f'Invalid type for {key}: expected {expected_type.__name__}, got {actual_type.__name__}')

        # 更新配置
        config[key] = value
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)

        # 记录日志
        log('info', f'Setting updated: {key} = {value}')

        return {
            'success': True,
            'message': 'Setting updated successfully'
        }
    except Exception as e:
        raise Exception(f'Failed to set setting: {str(e)}')


def get_setting_description(key):
    """获取配置描述"""
    descriptions = {
        'host': 'Server host address',
        'port': 'Server port',
        'workers': 'Number of worker processes',
        'debug': 'Enable debug mode'
    }
    return descriptions.get(key, '')


def is_setting_required(key):
    """检查配置是否必需"""
    required = ['host', 'port']
    return key in required


def handle_request(request):
    """处理请求"""
    method = request.get('method')

    if method == 'status':
        status = get_status()
        print(json.dumps(status))
        sys.exit(EXIT_CODES['SUCCESS'])

    elif method == 'start':
        result = start_module()
        print(json.dumps(result))
        sys.exit(EXIT_CODES['SUCCESS'])

    elif method == 'stop':
        force = request.get('force', False)
        result = stop_module(force)
        print(json.dumps(result))
        sys.exit(EXIT_CODES['SUCCESS'])

    elif method == 'logs':
        lines = request.get('lines', 100)
        result = get_logs(lines)
        print(json.dumps(result))
        sys.exit(EXIT_CODES['SUCCESS'])

    elif method == 'settings':
        action = request.get('action')

        if action == 'get':
            result = get_settings()
            print(json.dumps(result))
            sys.exit(EXIT_CODES['SUCCESS'])
        elif action == 'set':
            key = request.get('key')
            value = request.get('value')

            if not key or value is None:
                raise Exception('Missing key or value for settings.set')

            result = set_setting(key, value)
            print(json.dumps(result))
            sys.exit(EXIT_CODES['SUCCESS'])
        else:
            raise Exception(f'Unknown settings action: {action}')

    else:
        raise Exception(f'Unknown method: {method}')


def main():
    """主函数"""
    try:
        line = sys.stdin.readline()
        request = json.loads(line)
        handle_request(request)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(EXIT_CODES['GENERAL_ERROR'])


if __name__ == '__main__':
    main()

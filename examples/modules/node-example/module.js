#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置文件路径
const BASE_DIR = __dirname;
const PID_FILE = path.join(BASE_DIR, '.module.pid');
const LOG_FILE = path.join(BASE_DIR, '.module.log');
const CONFIG_FILE = path.join(BASE_DIR, 'config.json');
const STATE_FILE = path.join(BASE_DIR, '.module.state');

// 默认配置
const DEFAULT_CONFIG = {
  port: 3000,
  debug: false,
  maxConnections: 100
};

// 错误码
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

// 初始化配置文件
function initConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

// 日志函数
function log(level, message) {
  const timestamp = new Date().toISOString();
  const logEntry = JSON.stringify({ timestamp, level, message }) + '\n';

  try {
    fs.appendFileSync(LOG_FILE, logEntry);

    // 检查日志大小，超过 10MB 则滚动
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > 10 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
  } catch (error) {
    // 忽略日志写入错误
  }
}

// 检查进程是否运行
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 获取模块状态
function getStatus() {
  try {
    // 读取 PID 文件
    if (!fs.existsSync(PID_FILE)) {
      return {
        status: 'stopped'
      };
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));

    // 检查进程是否存活
    if (!isProcessRunning(pid)) {
      // 进程已死，清理 PID 文件
      fs.unlinkSync(PID_FILE);
      return {
        status: 'stopped'
      };
    }

    // 读取状态文件
    let startedAt = null;
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      startedAt = state.startedAt;
    }

    // 计算运行时长
    const uptime = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0;

    // 获取内存和 CPU 使用情况（简化版）
    const memoryUsage = process.memoryUsage();
    const memory = Math.round(memoryUsage.rss / 1024 / 1024 * 10) / 10;

    return {
      status: 'running',
      pid,
      startedAt,
      uptime,
      memory,
      cpu: 0 // 简化实现，实际应该计算 CPU 使用率
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

// 启动模块
function startModule() {
  try {
    // 检查是否已在运行
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
      if (isProcessRunning(pid)) {
        throw new Error(`Module already running (PID: ${pid})`);
      }
      // 清理旧的 PID 文件
      fs.unlinkSync(PID_FILE);
    }

    // 启动后台进程（这里简化为写入 PID 文件）
    const { spawn } = require('child_process');

    // 启动工作进程
    const child = spawn('node', [path.join(__dirname, 'worker.js')], {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    // 写入 PID 文件
    fs.writeFileSync(PID_FILE, child.pid.toString());

    // 写入状态文件
    const state = {
      startedAt: new Date().toISOString(),
      pid: child.pid
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    // 记录日志
    log('info', `Module started with PID ${child.pid}`);

    return {
      success: true,
      pid: child.pid,
      message: 'Module started successfully'
    };
  } catch (error) {
    log('error', `Failed to start module: ${error.message}`);
    throw error;
  }
}

// 停止模块
function stopModule(force = false) {
  try {
    // 读取 PID 文件
    if (!fs.existsSync(PID_FILE)) {
      return {
        success: true,
        message: 'Module already stopped'
      };
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));

    // 检查进程是否存活
    if (!isProcessRunning(pid)) {
      // 清理 PID 文件
      fs.unlinkSync(PID_FILE);
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
      }
      return {
        success: true,
        message: 'Module already stopped'
      };
    }

    // 发送停止信号
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    process.kill(pid, signal);

    // 等待进程退出
    let attempts = 0;
    const maxAttempts = 30; // 3 秒

    while (isProcessRunning(pid) && attempts < maxAttempts) {
      attempts++;
      // 简单的同步等待（实际应该使用异步）
      const start = Date.now();
      while (Date.now() - start < 100) {
        // 等待 100ms
      }
    }

    // 清理文件
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }

    // 记录日志
    log('info', `Module stopped (PID: ${pid}, signal: ${signal})`);

    return {
      success: true,
      message: 'Module stopped successfully'
    };
  } catch (error) {
    log('error', `Failed to stop module: ${error.message}`);
    throw error;
  }
}

// 获取日志
function getLogs(lines = 100) {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return { logs: [] };
    }

    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.trim().split('\n').filter(line => line);
    const recentLines = allLines.slice(-lines);

    const logs = recentLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        // 解析失败，返回原始文本
        return {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: line
        };
      }
    });

    return { logs };
  } catch (error) {
    throw new Error(`Failed to read logs: ${error.message}`);
  }
}

// 获取配置
function getSettings() {
  try {
    initConfig();
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

    const settings = Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: getSettingDescription(key),
      required: isSettingRequired(key)
    }));

    return { settings };
  } catch (error) {
    throw new Error(`Failed to get settings: ${error.message}`);
  }
}

// 设置配置
function setSetting(key, value) {
  try {
    initConfig();
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

    // 验证配置键
    if (!DEFAULT_CONFIG.hasOwnProperty(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }

    // 验证配置值类型
    const expectedType = typeof DEFAULT_CONFIG[key];
    const actualType = typeof value;

    if (expectedType !== actualType) {
      throw new Error(`Invalid type for ${key}: expected ${expectedType}, got ${actualType}`);
    }

    // 更新配置
    config[key] = value;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // 记录日志
    log('info', `Setting updated: ${key} = ${value}`);

    return {
      success: true,
      message: 'Setting updated successfully'
    };
  } catch (error) {
    throw new Error(`Failed to set setting: ${error.message}`);
  }
}

// 获取配置描述
function getSettingDescription(key) {
  const descriptions = {
    port: 'Server port',
    debug: 'Enable debug mode',
    maxConnections: 'Maximum number of connections'
  };
  return descriptions[key] || '';
}

// 检查配置是否必需
function isSettingRequired(key) {
  const required = ['port'];
  return required.includes(key);
}

// 处理请求
function handleRequest(request) {
  const method = request.method;

  switch (method) {
    case 'status': {
      const status = getStatus();
      console.log(JSON.stringify(status));
      process.exit(EXIT_CODES.SUCCESS);
      break;
    }

    case 'start': {
      const result = startModule();
      console.log(JSON.stringify(result));
      process.exit(EXIT_CODES.SUCCESS);
      break;
    }

    case 'stop': {
      const force = request.force || false;
      const result = stopModule(force);
      console.log(JSON.stringify(result));
      process.exit(EXIT_CODES.SUCCESS);
      break;
    }

    case 'logs': {
      const lines = request.lines || 100;
      const result = getLogs(lines);
      console.log(JSON.stringify(result));
      process.exit(EXIT_CODES.SUCCESS);
      break;
    }

    case 'settings': {
      const action = request.action;

      if (action === 'get') {
        const result = getSettings();
        console.log(JSON.stringify(result));
        process.exit(EXIT_CODES.SUCCESS);
      } else if (action === 'set') {
        const key = request.key;
        const value = request.value;

        if (!key || value === undefined) {
          throw new Error('Missing key or value for settings.set');
        }

        const result = setSetting(key, value);
        console.log(JSON.stringify(result));
        process.exit(EXIT_CODES.SUCCESS);
      } else {
        throw new Error(`Unknown settings action: ${action}`);
      }
      break;
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// 主函数
function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    try {
      const request = JSON.parse(line);
      handleRequest(request);
    } catch (error) {
      console.error(error.message);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
}

// 启动
main();

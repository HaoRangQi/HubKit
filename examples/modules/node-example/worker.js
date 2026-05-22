#!/usr/bin/env node

// 简单的工作进程，模拟长时间运行的任务

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '.module.log');

function log(level, message) {
  const timestamp = new Date().toISOString();
  const logEntry = JSON.stringify({ timestamp, level, message }) + '\n';

  try {
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (error) {
    // 忽略日志写入错误
  }
}

// 记录启动
log('info', 'Worker process started');

// 模拟工作负载
let counter = 0;

const interval = setInterval(() => {
  counter++;
  log('info', `Worker heartbeat: ${counter}`);

  // 每 10 次心跳记录一次调试信息
  if (counter % 10 === 0) {
    log('debug', `Worker still running, counter: ${counter}`);
  }
}, 5000); // 每 5 秒一次心跳

// 优雅退出
function cleanup() {
  clearInterval(interval);
  log('info', 'Worker process stopping');
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// 防止进程退出
process.stdin.resume();

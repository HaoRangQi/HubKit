#!/usr/bin/env node

/**
 * 设置 HubKit 模块目录配置
 * 将项目内的 modules 目录添加到配置中
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.hubkit', 'config.json');
const PROJECT_MODULES_DIR = path.join(__dirname, 'modules');

// 确保配置目录存在
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// 读取或创建配置
let config = {
  moduleDirs: [
    path.join(os.homedir(), '.hubkit', 'modules')
  ],
  dataDir: path.join(os.homedir(), '.hubkit', 'data'),
  logDir: path.join(os.homedir(), '.hubkit', 'logs')
};

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    config = JSON.parse(content);
  } catch (error) {
    console.warn('无法读取现有配置，使用默认配置');
  }
}

// 添加项目 modules 目录
if (!config.moduleDirs.includes(PROJECT_MODULES_DIR)) {
  config.moduleDirs.push(PROJECT_MODULES_DIR);
  console.log(`✓ 已添加模块目录: ${PROJECT_MODULES_DIR}`);
} else {
  console.log(`✓ 模块目录已存在: ${PROJECT_MODULES_DIR}`);
}

// 保存配置
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
console.log(`✓ 配置已保存到: ${CONFIG_PATH}`);

// 确保必要的目录存在
const dirs = [
  ...config.moduleDirs,
  config.dataDir,
  config.logDir
];

for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ 已创建目录: ${dir}`);
  }
}

console.log('\n✓ 设置完成！现在可以运行以下命令查看模块：');
console.log('  npm run build');
console.log('  node dist/cli/index.js list');

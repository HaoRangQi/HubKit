#!/usr/bin/env node

import { Command } from 'commander';
import { registerCommands } from './commands';

const program = new Command();

program
  .name('hub')
  .description('个人自动化中控台 - 统一管理所有脚本和自动化任务')
  .version('0.1.0');

// 注册所有命令
registerCommands(program);

// 解析命令行参数
program.parse(process.argv);

// 如果没有提供任何命令，显示帮助信息
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

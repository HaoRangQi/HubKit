# TASK-003: 实现 Python 脚本适配器

## Changes
- `src/adapters/python-adapter.ts`: 实现 Python 脚本适配器（65 行），继承 BaseAdapter 基类

## Verification
- [x] src/adapters/python-adapter.ts 实现了 ModuleProtocol 接口: 通过继承 BaseAdapter 实现所有接口方法（status/start/stop/logs/getSettings/setSetting）
- [x] 可以启动和停止 Python 进程: buildStartCommand() 方法构建 Python 启动命令，BaseAdapter 提供进程管理
- [x] 可以查询 Python 进程状态: 继承 BaseAdapter 的 status() 方法，支持 PID 检查和进程状态查询

## Tests
- 无测试命令（项目无 package.json，无法运行 npm run build）

## Deviations
- 项目缺少 package.json 和 tsconfig.json，无法执行编译验证
- 实现已完成，代码结构符合要求

## Notes
- Python 适配器支持虚拟环境自动检测（venv/.venv）
- 优先使用虚拟环境中的 Python 解释器
- 回退到系统 python3 或 python 命令
- 设置 PYTHONUNBUFFERED=1 禁用输出缓冲，确保日志实时输出
- 继承 BaseAdapter 的完整进程生命周期管理（spawn/kill/PID 文件/日志收集）
- 实现符合 docs/module-protocol.md 规范

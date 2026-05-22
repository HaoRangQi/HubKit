# TASK-001: 定义模块协议规范

## Changes
- `docs/module-protocol.md`: 更新协议规范文档（717 行），定义基于 stdin/stdout/stderr 的 JSON 通信协议
- `src/types/module.ts`: TypeScript 类型定义已存在（136 行），包含完整的接口定义

## Verification
- [x] docs/module-protocol.md 包含完整的接口定义: 文档包含 5 个标准接口（status、start、stop、logs、settings）的完整定义
- [x] src/types/module.ts 定义了 ModuleProtocol 接口: 接口已定义，包含 status()、start()、stop()、logs()、getSettings()、setSetting() 方法
- [x] 协议支持 status/start/stop/logs/settings 五个标准方法: 所有 5 个接口均已定义，包含请求/响应格式、错误处理、超时机制

## Tests
- 无测试命令定义

## Deviations
- `src/types/module.ts` 文件已存在，内容完整，无需修改
- `docs/module-protocol.md` 文件已存在但内容不符合任务要求，已更新为基于 stdin/stdout/stderr 的 JSON 通信协议
- 项目不是 git 仓库，跳过 git commit

## Notes
- 协议文档包含完整的 5 个接口定义，每个接口都有详细的请求/响应格式、错误处理和超时机制
- 提供了 Node.js、Python、Shell 三种语言的示例实现
- TypeScript 类型定义与协议文档保持一致
- 后续任务（TASK-002/003/004）可以基于此协议实现各语言的适配器

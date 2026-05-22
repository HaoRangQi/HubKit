# Project: 个人自动化中控台

## What This Is

个人自动化中控台是一个统一入口管理系统，用于管理所有个人脚本、小工具和自动化任务。它解决了几十个脚本各自开机自启、各自常驻、各自散落配置的问题，为个人开发者提供集中化的自动化任务管理能力。

## Core Value

系统只保留一个统一入口，通过中控台管理所有个人脚本和自动化任务，避免多个脚本各自开机自启、各自常驻、各自散落配置。

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope being built toward. These are hypotheses until shipped. -->

- [ ] 模块管理：每个脚本/工具都是一个模块，可启用、禁用、配置、查看状态
- [ ] 统一启动：系统只自启中控台，中控台再决定哪些模块需要启动、延迟启动或按需唤起
- [ ] 按需执行：大部分模块不常驻，需要时再启动，用完可退出，降低内存占用
- [ ] 顺序编排：支持配置模块启动顺序、依赖关系、延迟时间
- [ ] 状态与日志：统一查看模块是否可用、最近执行结果、错误日志
- [ ] 配置中心：每个模块有自己的设置，但由中控台统一展示和管理
- [ ] 安全回滚：涉及修改文件或系统配置的模块，需要备份、预览、失败回滚

### Out of Scope

<!-- Explicit boundaries. Include reasoning to prevent re-adding. -->

- 多用户权限管理 — 个人使用场景，不需要复杂的权限系统
- 分布式部署 — 单机使用，不需要跨机器协调
- 图形化界面 — 优先 CLI，GUI 可作为后续增强

## Context

当前个人开发环境中存在大量独立脚本和自动化工具，每个都有自己的启动方式、配置文件和日志位置。这导致：
- 系统启动项过多，影响启动速度
- 常驻进程过多，占用内存
- 配置文件散落各处，难以维护
- 缺乏统一的状态监控和日志查看

## Constraints

- **资源占用**: 中控台本身必须轻量，常驻内存占用 < 50MB — 避免成为新的性能瓶颈
- **兼容性**: 必须支持现有脚本（Node/Python/Shell），无需重写 — 降低迁移成本
- **可靠性**: 中控台崩溃不能影响已启动的模块 — 模块可独立运行

## Tech Stack

- **Language**: TypeScript (Node.js) — 中控台核心
- **Framework**: 待定（CLI 框架如 Commander.js / oclif）
- **Database**: 本地 JSON 文件或 SQLite（轻量级状态存储）
- **模块支持**: Node.js、Python、Shell、其他可执行脚本（通过统一协议接入）

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 中控台采用 Node.js + TypeScript | 跨平台、生态丰富、适合 CLI 和 GUI 扩展 | — Pending |
| 模块协议统一：status/preview/run/settings/logs | 标准化接口，降低集成复杂度 | — Pending |
| 系统自启只注册一个入口 | 避免多个 LaunchAgents/Login Items | — Pending |

## Stakeholders

- 个人开发者（自己）

---
*Last updated: 2026-05-21 after initialization*

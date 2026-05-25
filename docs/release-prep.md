# HubKit 变更梳理与远程提交准备

更新时间：2026-05-25  
基线分支：`main`  
基线提交：`3d9d814`（`origin/main`）

## 1. 当前变更快照

- 工作树变更总数：`98` 个文件
- 已跟踪修改：`23` 个文件
- 新增未跟踪：`75` 个文件

目录分布（按文件数）：

- `src/`：50
- `tests/`：43
- `docs/`：3
- 根目录文件：2（`README.md`、`package.json`）

## 2. 变更历史梳理（按能力域）

### 2.1 CLI / Runtime / Registry

- 新增命令：`audit`、`init-module`、`log-search`、`module-loader`、`workspace`
- 运行时增强：日志搜索、日志轮转、日志 tail、模块生命周期、工作区运行态
- 关键文件：
  - `src/cli/commands/*`
  - `src/runtime/*`
  - `src/registry/module-config.ts`
  - `src/adapters/adapter-factory.ts`

### 2.2 Web API 拆分与安全边界

- `src/web/api/routes.ts` 从单体路由拆分为多路由模块
- 新增高风险确认路由、日志搜索路由、工作区路由、模块管理路由、系统动作路由
- 新增 curl 执行路由：`/api/curl-requests/:siteId/run`
- 关键文件：
  - `src/web/api/*.ts`
  - `src/web/server.ts`

### 2.3 前端静态 helper 分层与 Dashboard 交互

- 抽离 `app-api.js`、`app-dashboard.js`、`app-formatters.js`、`app-log-renderer.js`、`app-diagnostics.js`、`app-workspace.js`、`app-ui-prefs.js`、`app-settings.js`
- `index.html` 保留 thin wrapper，并承载高风险确认、WebSocket、Web terminal 主生命周期
- Curl 请求中心改造：
  - 支持用户维护请求站点（名称、URL、增删）
  - 支持命令队列
  - 支持“执行当前 / 执行全部”
  - 自动执行保留单开关，并补充可读说明

### 2.4 测试面扩展

- 新增 API 路由拆分、日志、高风险确认、工作区、Web helper 等单测
- 关键文件：
  - `tests/unit/*.test.ts`

### 2.5 文档同步

- `README.md`
- `docs/getting-started.md`
- `docs/module-integration-guide.md`
- `docs/roadmap-open-source.md`

## 3. 远程提交准备（建议切片）

为降低 review 风险，建议按切片提交，不使用一次性巨型提交：

1. `feat(core): CLI + runtime + registry + scheduler`
2. `feat(api): web api 路由拆分与高风险边界`
3. `feat(web): helper 分层与 dashboard/curl 请求中心交互`
4. `test: 补齐核心路由与前端 helper 契约测试`
5. `docs: 路线图、入门与文档治理同步`

每个切片都执行：

```bash
npm test -- --runInBand
npm run build
git diff --check
```

前端静态 helper 或 UI 交互改动再追加：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:2281/
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:2281/app-dashboard.js
```

## 4. 文档治理跟进要求

- 单一口径：CLI、Web、文档统一使用 `.hubkit.json`、`~/.hubkit`、`node dist/cli/index.js init-module`。
- Local-first 不退化：文档中不得出现“默认远程开放”、“商业化分层”导向描述。
- 结构化治理：功能 PR 必须同步更新至少 1 处用户文档（README、入门、接入指南或路线图）。
- 边界明确：高风险确认、WebSocket 生命周期、Web terminal 生命周期的改动必须标注测试覆盖和风险边界。
- 发布前检查：`git status --short` 必须可解释每一项来源，避免把试验性或临时产物混入主提交。

## 5. 快速命令（发布前）

```bash
git status --short
git diff --stat
git log --oneline --decorate -n 30
git diff --name-status
git ls-files --others --exclude-standard
```

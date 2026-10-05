# 仪表盘设计收敛

## Goal

落实用户已同意的三项建议：精简默认卡片、准确表达更新状态、统一接入契约并拆分主页面。用户本轮已授权实施，按已讨论方向直接推进。

## Architecture / Tech Stack

沿用原生 HTML/CSS/JS、TypeScript、Express、Jest。index 保留交互与危险操作编排；app-module-cards.js 唯一负责模块卡片渲染；app-dashboard.js 负责更新汇总和关注项；app.css 唯一负责页面样式。

## Baseline / Authority Refs

使用 ../baseline/2026-10-05-initial-baseline.md、../../roadmap-open-source.md、../../release-prep.md、用户已接受的三项设计建议。

## Compatibility Boundary

不变更 .hubkit.json 字段、生命周期、进程路径、终端 / WebSocket 协议及更新的高风险确认。保留 collapseProcessMini 已存布尔值；缺省改为收起详情，单卡可展开且刷新保持。维护操作仍可发现和使用。

## 选择与复杂度审查

备选：只改文案无法解决信息密度；整体换框架超出需要；采用原生 details 和静态 helper 提取，删除内联卡片实现及样式。无需新增依赖。

不再把能力标记解释为有新版本；更新检查结果按当前页面会话保存，刷新模块状态不丢失，重新加载页面回到未检查。网络失败不可伪装成最新。本地领先但上游无新提交不提示更新。

## Tasks

1. 基线合并：验证 master 为 develop 祖先，git switch master && git merge --ff-only develop && git push origin master && git switch develop。已完成。
2. 更新语义：先为 GET update-check 补目录入口、fetch 失败、上游缺失、本地领先场景；运行目标单测观察失败。修正同一目录解析和远程新增提交判定。前端汇总仅计成功检查；支持更新未检查不进入关注项。
3. 卡片：先补渲染和刷新交互回归。名称、状态、摘要、启停/打开/日志保持外显；指标、重启、更新、诊断和强制关闭进入 details。提取纯渲染 helper，保留原确认处理器，去掉内联副本。提取 CSS，取消服务卡片固定高度。
4. 文档：重写 module-protocol.md 为现有配置与进程托管契约，删除 integration-guide 重复的未实现 stdio 教程；README / getting-started 同步实际交互和路径。旧示例注明历史参考，不引入第二套协议。
5. 验证与复查：运行相关单测、全量单测、build、diff --check；重启本次 HubKit 服务并验证页面/静态资源/API；尝试浏览器视觉检查。完成后记录证据和职责变更。

## Verification

- npm test -- --runInBand tests/unit/module-update-routes.test.ts tests/unit/web-module-cards.test.ts tests/unit/web-update-state.test.ts tests/unit/web-ui-prefs.test.ts tests/unit/web-workspace-ui.test.ts tests/unit/web-high-risk-confirmation.test.ts
- npm test -- --runInBand
- npm run build
- git diff --check
- HTTP /、/app.css、/app-module-cards.js、/app-dashboard.js、/api/modules

TDD Route: strict（更新判定、卡片渲染、偏好和刷新行为）；文档与机械 CSS 提取采用 diff / 构建 / 页面验证。

## Repair / Retirement / Risk

删除卡片内联模板和 style 标签；保留薄包装与原事件函数。删除 stdio 接入教程，改指向唯一配置/运行契约。状态更新导致详情重新收起、错误状态被隐藏、转义丢失、高风险操作绕过是重点回归场景。主页面其他区域仍较大，本次不迁移终端、设置或生命周期。ArchitectureReviewRequired: yes；完成时记录 ADR 与基线同步。

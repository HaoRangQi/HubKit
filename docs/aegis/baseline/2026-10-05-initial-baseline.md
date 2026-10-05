# 2026-10-05 基线

起点：84339c1；master 已快进同步远程，后续改动在 develop。

- TypeScript / Node.js，Express + WebSocket；原生 HTML/CSS/JS；Jest。
- CLI、Web、ModuleScheduler → ModuleLifecycle → adapter-factory → BaseAdapter / 语言适配器。
- 模块扫描读取 .hubkit.json；内置适配器直接启动进程，stdin 忽略、stdout/stderr 写日志。
- ConfigManager 默认使用 ~/.hubkit；BaseAdapter 当前 PID / 日志使用 HubKit 工作目录下 .hub。迁移路径不属于本次任务。
- index.html 共 9196 行，内含全部样式及模块卡片渲染；app-dashboard / app-formatters 等提供静态 helper。
- 更新检查 GET /api/modules/:id/update-check；更新 POST /api/modules/:id/update，后者保留高风险确认。
- 基线测试：61 套、481 项通过；构建命令 npm run build 会复制 public 所有静态文件。
- 已知问题：卡片信息默认全部展开；updateable 能力误作更新状态；检查忽略 fetch 失败；stdio 文档偏离内置适配器。
- 产品与贡献依据：docs/roadmap-open-source.md、docs/release-prep.md、README.md。


## 本轮完成后的状态

- index.html 5825 行，保留交互编排；app.css 3228 行，维护样式；app-module-cards.js 118 行，维护模块卡片纯渲染。
- app-dashboard.js 只把已成功检查且确认有上游新提交的模块纳入更新关注项。
- collapseProcessMini 的显式布尔值继续保留，缺省收起整个模块详情；展开状态按页面会话保持。
- 接入协议文档现在描述内置进程适配器和实际存储位置，旧 stdio 示例只作历史参考。
- 本轮最终测试 63 套 / 497 项通过。完整验证与限制见 work/2026-10-05-dashboard-consolidation/90-evidence.md。

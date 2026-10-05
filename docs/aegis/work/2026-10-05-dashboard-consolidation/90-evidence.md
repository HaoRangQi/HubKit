# 验证证据

## 命令与结果

- 基线 `npm test -- --runInBand`：退出 0，61 套 / 481 项通过，日志 `/tmp/hubkit-baseline-tests.log`。
- `git push origin master`：8a4e4bb → 84339c1 成功；回到 develop。
- RED：更新语义、接口边界和偏好测试 10 项按预期失败；旧卡片 4 项按预期失败。
- 目标测试：6 套 / 76 项通过，日志 `/tmp/hubkit-design-targeted.log`。
- 最终 `npm test -- --runInBand`：退出 0，63 套 / 497 项通过，日志 `/tmp/hubkit-design-final-tests.log`。
- `npm run build`：退出 0；所有内联 script 经 `vm.Script` 编译，无语法错误。
- `git diff --check`：退出 0。
- HTTP：`/`、`/app.css`、`/app-module-cards.js`、`/app-dashboard.js`、`/app-ui-prefs.js` 均 200，响应字节与 src 对应文件相同。
- `/api/modules`：HTTP 200，返回 5 个模块；Dashboard 按现有可见性设置显示 2 个。
- `git ls-remote --heads origin master develop`：两者均 84339c1（本轮新功能保留在本地 develop）。

## 浏览器验证

通过 Edge 原生控制完成桌面实测。已有 127.0.0.1 / localhost 偏好保留展开；全新 design-review.localhost 首次访问两张服务卡均默认收起。确认启停、打开、日志外显；详情可展开；点击页面内刷新后第一张卡保持展开，另一张仍收起。独立验证页已关闭。

没有执行真实模块更新或系统动作；这些危险操作的确认契约由已有回归测试覆盖。未做全设备浏览器矩阵测试。浏览器截图用于现场观察，未将包含用户桌面内容的截图存入仓库。

## 架构与复杂度

- 架构对齐：符合现有静态 helper 分层；ModuleLifecycle、适配器行为、终端和高风险确认机制不变。
- 主页面 9196 → 5825 行。新增 app.css 3228 行，主要是原样式移动；新增 app-module-cards.js 118 行，唯一负责模块卡片渲染。
- 删除内联卡片模板、旧进程折叠样式、更新按钮 DOM 状态变更辅助函数及更新检查的重复 fetch 分支。
- 更新状态由当前页面 map 统一提供给汇总、关注项与卡片，模块数据刷新不覆盖它；整页重载后回到未检查。
- 文档删除不适用的 stdio 接入教程。历史示例仍保留并注明用途，运行路径没有迁移。
- 复杂度：净逻辑集中度降低，主页面仍超过 800 行；后续新增职责继续按页面/helper 边界拆分，避免回填模板。
- ADR：skip，轻量记录即可。提取易逆转且沿用既有约定；协议修改纠正文档错误，没有引入新 RPC 或模块配置格式。基线后续状态已补充。
- 置信度：B；自动化与桌面实测直接支持本轮验收，未声称跨设备或真实更新安装验证。

import * as fs from 'fs';
import * as path from 'path';

function readWebHtml(): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public/index.html'), 'utf-8');
}

describe('web high risk confirmations', () => {
  it('routes browser confirmations through one high-risk helper', () => {
    const html = readWebHtml();
    const directConfirmCalls = html.match(/window\.confirm\(/g) || [];

    expect(directConfirmCalls).toHaveLength(1);
    expect(html).toContain('function confirmHighRiskAction');
    expect(html).toContain('async function highRiskHeaders');
    expect(html).toContain('return window.confirm(sections.join');
    expect(html).toContain("fetch('/api/high-risk-confirmations'");
    expect(html).toContain("'x-hubkit-high-risk-token': json.data.token");
  });

  it('guards destructive or system-affecting actions with high-risk confirmation', () => {
    const html = readWebHtml();

    expect(html).toContain('title: \'清理全部本地偏好\'');
    expect(html).toContain('title: \'恢复 HubKit 配置备份\'');
    expect(html).toContain('title: \'关闭正在运行的 Web 终端\'');
    expect(html).toContain('title: `停止工作区：${name}`');
    expect(html).toContain('title: `更新模块：${module?.name || moduleId}`');
    expect(html).toContain('title: `强制关闭 ${moduleName}`');
    expect(html).toContain('title: runningCount > 0 ? \'强制关停全部模块\' : \'全量残留清理\'');
    expect(html).toContain('title: `运行脚本：${action.name || action.id}`');
    expect(html).toContain('title: \'修改开盖 / 接电启动策略\'');
    expect(html).toContain('await highRiskHeaders(`module:${moduleId}:force-close`)');
    expect(html).toContain("await highRiskHeaders('module:*:force-close-all')");
    expect(html).toContain('await highRiskHeaders(`module:${moduleId}:update`)');
    expect(html).toContain('await highRiskHeaders(`workspace:${workspaceId}:stop`)');
    expect(html).toContain('await highRiskHeaders(`config-backup:${backupId}:restore`)');
    expect(html).toContain('await highRiskHeaders(`terminal-session:${activeTerminalSessionId}:kill`)');
    expect(html).toContain('await highRiskHeaders(`terminal-session:${sessionId}:kill`)');
    expect(html).toContain('await highRiskHeaders(`script-bundle:${bundleId}:${actionId}:run`)');
    expect(html).toContain('await highRiskHeaders(`script-bundle:${bundleId}:${actionId}:web-terminal`');
    expect(html).toContain('await highRiskHeaders(`system-action:boot-preference:${mode}:apply`');
  });

  it('rejects force stop through the ordinary module stop route', () => {
    const routesSource = fs.readFileSync(path.join(__dirname, '../../src/web/api/routes.ts'), 'utf-8');

    expect(routesSource).toContain('const force = req.body.force === true');
    expect(routesSource).toContain("error: '强制停止请使用强制关闭接口'");
    expect(routesSource).toContain('const result = await lifecycle.stop(module, force)');
  });
});

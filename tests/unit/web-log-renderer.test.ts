import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

function readWebFile(fileName: string): string {
  return fs.readFileSync(path.join(__dirname, '../../src/web/public', fileName), 'utf-8');
}

function loadLogRenderer(): any {
  const window = {};
  vm.runInNewContext(readWebFile('app-log-renderer.js'), { window });
  return (window as any).HubKitLogRenderer;
}

function functionBodyByName(source: string, functionName: string): string {
  const match = source.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{([\\s\\S]*?)\\n    \\}`));
  expect(match).not.toBeNull();
  return match?.[1] || '';
}

describe('web log renderer helper', () => {
  it('loads before the main inline app script and after the API helper', () => {
    const html = readWebFile('index.html');
    const apiScriptIndex = html.indexOf('<script src="/app-api.js"></script>');
    const logRendererScriptIndex = html.indexOf('<script src="/app-log-renderer.js"></script>');
    const mainScriptIndex = html.indexOf('const THEME_STORAGE_KEY');

    expect(apiScriptIndex).toBeGreaterThan(-1);
    expect(logRendererScriptIndex).toBeGreaterThan(apiScriptIndex);
    expect(mainScriptIndex).toBeGreaterThan(logRendererScriptIndex);
  });

  it('renders module log lines with escaped content and inferred levels', () => {
    const renderer = loadLogRenderer();
    const html = renderer.renderLogLines([
      'ready',
      'WARN disk <low>',
      'Error: failed "start"',
      '    at run (/tmp/app.js:1)',
      '',
    ].join('\n'));

    expect(html).toContain('<span class="log-line log-line-info" data-level="info">ready</span>');
    expect(html).toContain('<span class="log-line log-line-warn" data-level="warn">WARN disk &lt;low&gt;</span>');
    expect(html).toContain('<span class="log-line log-line-error" data-level="error">Error: failed &quot;start&quot;</span>');
    expect(html).toContain('<span class="log-line log-line-stack" data-level="stack">    at run (/tmp/app.js:1)</span>');
    expect(html).toContain('<span class="log-line log-line-info" data-level="info"> </span>');
  });

  it('infers log levels and maps them to display classes through shared helpers', () => {
    const renderer = loadLogRenderer();

    expect(renderer.inferLogLevel('ready')).toBe('info');
    expect(renderer.inferLogLevel('WARN disk low')).toBe('warn');
    expect(renderer.inferLogLevel('Error: failed to start')).toBe('error');
    expect(renderer.inferLogLevel('Unhandled exception')).toBe('error');
    expect(renderer.inferLogLevel('    at run (/tmp/app.js:1)')).toBe('stack');

    expect(renderer.getLogLineClass('info')).toBe('log-line log-line-info');
    expect(renderer.getLogLineClass('warn')).toBe('log-line log-line-warn');
    expect(renderer.getLogLineClass('error')).toBe('log-line log-line-error');
    expect(renderer.getLogLineClass('stack')).toBe('log-line log-line-stack');
    expect(renderer.getLogLineClass('debug')).toBe('log-line log-line-stack');
    expect(renderer.getLogLineClass('trace')).toBe('log-line log-line-info');
  });

  it('renders global log search results without exposing HTML or attribute injection', () => {
    const renderer = loadLogRenderer();
    const html = renderer.renderGlobalLogSearchResults({
      results: [
        {
          sourceName: 'api<service>',
          level: 'error"`',
          message: '<script>alert(1)</script>',
        },
        {
          sourceId: 'worker',
          level: 'debug',
          message: 'trace',
        },
      ],
    });

    expect(html).toContain('data-level="error&quot;&#96;"');
    expect(html).toContain('[api&lt;service&gt;] &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<span class="log-line log-line-stack" data-level="debug">[worker] trace</span>');
  });

  it('renders malformed global log search result entries with safe fallbacks', () => {
    const renderer = loadLogRenderer();
    const html = renderer.renderGlobalLogSearchResults({
      results: [
        null,
        'plain text',
        { message: 'missing source' },
      ],
    });

    expect(html).toContain('<span class="log-line log-line-info" data-level="info">[unknown] </span>');
    expect(html).toContain('<span class="log-line log-line-info" data-level="info">[unknown] missing source</span>');
    expect(html).not.toContain('plain text');
  });

  it('renders global log empty and error states through ordinary log lines', () => {
    const renderer = loadLogRenderer();

    expect(renderer.renderGlobalLogSearchResults({ results: [] }))
      .toContain('暂无匹配日志');
    expect(renderer.renderGlobalLogSearchResults({ error: '无法搜索 <api>' }))
      .toContain('无法搜索 &lt;api&gt;');
  });

  it('matches log filter text and level rules without touching the DOM', () => {
    const renderer = loadLogRenderer();

    expect(renderer.shouldShowLogLine()).toBe(true);
    expect(renderer.shouldShowLogLine(null)).toBe(true);
    expect(renderer.shouldShowLogLine('invalid')).toBe(true);
    expect(renderer.shouldShowLogLine({
      text: 'API started',
      lineLevel: 'info',
      term: '',
      selectedLevel: 'all',
    })).toBe(true);
    expect(renderer.shouldShowLogLine({
      text: 'API failed to start',
      lineLevel: 'error',
      term: 'FAILED',
      selectedLevel: 'error',
    })).toBe(true);
    expect(renderer.shouldShowLogLine({
      text: 'warning: disk low',
      lineLevel: 'warn',
      term: 'api',
      selectedLevel: 'warn',
    })).toBe(false);
    expect(renderer.shouldShowLogLine({
      text: '    at run (/tmp/app.js:1)',
      lineLevel: 'stack',
      term: 'run',
      selectedLevel: 'info',
    })).toBe(true);
    expect(renderer.shouldShowLogLine({
      text: 'debug trace',
      lineLevel: 'debug',
      term: '',
      selectedLevel: 'info',
    })).toBe(false);
  });

  it('keeps index log render functions as thin HubKitLogRenderer wrappers', () => {
    const html = readWebFile('index.html');

    expect(html).toContain('function renderLogLines(rawLogs) {\n      return window.HubKitLogRenderer.renderLogLines(rawLogs);\n    }');
    expect(html).toContain('function renderGlobalLogSearchResults(payload) {\n      return window.HubKitLogRenderer.renderGlobalLogSearchResults(payload);\n    }');
    expect(html).toContain('const visible = window.HubKitLogRenderer.shouldShowLogLine({');
  });

  it('keeps applyLogFilter as a DOM adapter around the renderer filter helper', () => {
    const html = readWebFile('index.html');
    const body = functionBodyByName(html, 'applyLogFilter');

    expect(body).toContain('window.HubKitLogRenderer.shouldShowLogLine({');
    expect(body).toContain("line.classList.toggle('log-line-hidden', !visible);");
    expect(body).not.toContain('textMatch');
    expect(body).not.toContain('levelMatch');
    expect(body).not.toContain('line.textContent.toLowerCase().includes');
  });
});

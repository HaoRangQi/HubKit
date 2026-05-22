const tabs = [
  ['overview', '概览'],
  ['aliases', '别名'],
  ['path', 'PATH'],
  ['env', '环境变量'],
  ['omz', 'Oh My Zsh'],
  ['diagnostics', '诊断'],
  ['backups', '备份']
];

let state = null;
let draft = null;
let activeTab = 'overview';

const nav = document.querySelector('#nav');
const content = document.querySelector('#content');
const pageTitle = document.querySelector('#pageTitle');
const pageSubtitle = document.querySelector('#pageSubtitle');
const notice = document.querySelector('#notice');
const diffDialog = document.querySelector('#diffDialog');
const diffOutput = document.querySelector('#diffOutput');
const saveSummary = document.querySelector('#saveSummary');

document.querySelector('#reloadBtn').addEventListener('click', load);
document.querySelector('#bootstrapBtn').addEventListener('click', bootstrap);
document.querySelector('#validateBtn').addEventListener('click', previewDiff);
document.querySelector('#saveBtn').addEventListener('click', previewDiff);
document.querySelector('#confirmSaveBtn').addEventListener('click', (event) => {
  event.preventDefault();
  save();
});

renderNav();
load();

function renderNav() {
  nav.innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join('');
  nav.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab;
      render();
    });
  });
}

async function load() {
  showNotice('正在读取当前 zsh 配置。');
  state = await request('/api/config');
  draft = structuredClone(state.config);
  showNotice(state.scan.bootstrap.installed ? '已启用自动加载。新开的终端会读取这里保存的配置。' : '还没有启用自动加载。保存前请先点左下角“启用自动加载”。');
  render();
}

async function bootstrap() {
  showNotice('正在启用自动加载：只会在 ~/.zshrc 末尾追加一行加载配置。');
  await request('/api/bootstrap', { method: 'POST', body: {} });
  await load();
}

async function previewDiff() {
  const result = await request('/api/validate', { method: 'POST', body: { config: draft }, allowError: true });
  saveSummary.innerHTML = renderSaveSummary(result);
  diffOutput.textContent = localizeDiff(result.diff) || '生成文件没有变化。';
  if (!result.ok) {
    diffOutput.textContent = `配置语法检查没有通过：\n${result.stderr}\n\n${diffOutput.textContent}`;
  }
  diffDialog.showModal();
}

async function save() {
  const result = await request('/api/config', { method: 'PUT', body: { config: draft }, allowError: true });
  if (result.error || result.ok === false) {
    showNotice(result.stderr || result.error || '保存失败，原配置没有被覆盖。');
    return;
  }
  diffDialog.close();
  state.config = result.config;
  state.scan = result.scan;
  state.diagnostics = result.diagnostics;
  state.backups = result.backups;
  draft = structuredClone(result.config);
  showNotice('保存成功。新开的终端会自动生效；当前终端执行 source ~/.config/zsh-config/managed.zsh 立即生效。');
  render();
}

function render() {
  nav.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.tab === activeTab));
  const title = tabs.find(([id]) => id === activeTab)?.[1] || '概览';
  pageTitle.textContent = title;
  pageSubtitle.textContent = subtitles()[activeTab];

  if (!state) {
    content.innerHTML = '<section class="card">加载中</section>';
    return;
  }

  const views = {
    overview: renderOverview,
    aliases: renderAliases,
    path: renderPath,
    env: renderEnv,
    omz: renderOhMyZsh,
    diagnostics: renderDiagnostics,
    backups: renderBackups
  };
  views[activeTab]();
}

function renderOverview() {
  const aliasCount = draft.aliases.filter((item) => item.enabled).length;
  const issueCount = state.diagnostics.length;
  const fileCount = state.scan.files.filter((file) => file.exists).length;
  content.innerHTML = `
    <div class="grid cols-3">
      ${metric('别名', aliasCount, '当前启用')}
      ${metric('提醒', issueCount, '需要留意的配置点')}
      ${metric('配置文件', fileCount, '已识别')}
    </div>
    <section class="card action-card">
      <div>
        <h3>${state.scan.bootstrap.installed ? '自动加载已开启' : '先开启自动加载'}</h3>
        <p>${state.scan.bootstrap.installed ? '保存后的配置会写入专用文件，新开的终端会自动读取。' : '开启后，应用会在 ~/.zshrc 末尾加一行加载指令。不会重写你的原配置。'}</p>
      </div>
      <button class="${state.scan.bootstrap.installed ? 'secondary' : 'primary'}" id="overviewBootstrapBtn">${state.scan.bootstrap.installed ? '重新检查' : '启用自动加载'}</button>
    </section>
    <section class="card">
      <h3>当前配置入口</h3>
      <div class="stack">
        ${state.scan.files.map((file) => `
          <div class="scan-item">
            <strong>${escapeHtml(file.role)}</strong>
            <span class="path-text">${escapeHtml(file.path)}</span>
            <span class="muted">${file.exists ? `${file.lineCount} 行` : '未找到'}</span>
          </div>
        `).join('')}
      </div>
    </section>
    <section class="card">
      <h3>生效方式</h3>
      <p>保存改动会立即写入托管文件，但已经打开的终端不会自动获得新的 alias、PATH 或环境变量。</p>
      <p class="muted">新开的终端会自动加载；当前终端执行 <code>source ~/.config/zsh-config/managed.zsh</code> 可立即加载托管配置。</p>
    </section>
    <section class="card">
      <h3>识别到的配置</h3>
      <div class="stack">
        ${state.scan.items.slice(0, 12).map(renderScanItem).join('') || '<p class="muted">还没有识别到配置项。</p>'}
      </div>
    </section>
  `;
  document.querySelector('#overviewBootstrapBtn').addEventListener('click', state.scan.bootstrap.installed ? load : bootstrap);
}

function renderAliases() {
  content.innerHTML = `
    <section class="card">
      <h3>新增别名</h3>
      <div class="form-grid">
        ${field('aliasName', '别名', '例如 gs')}
        ${field('aliasCommand', '命令', '例如 git status')}
        ${field('aliasCategory', '分类', '例如 git')}
        ${field('aliasDescription', '说明', '这个别名解决什么问题')}
      </div>
      <div class="inline-actions">
        <button class="primary" id="addAliasBtn">新增</button>
        <button class="secondary" id="importAliasesBtn">批量导入 alias</button>
      </div>
      <textarea class="block-input" id="aliasImport" placeholder="alias gs='git status'\nalias ll='ls -lah'" hidden></textarea>
    </section>
    <section class="card">
      <div class="form-row">
        <div class="field">
          <label for="aliasSearch">搜索</label>
          <input id="aliasSearch" placeholder="搜索别名、命令、说明">
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th class="check-col">启用</th><th>别名</th><th>命令</th><th>分类</th><th>说明</th><th class="action-col">操作</th></tr>
          </thead>
          <tbody id="aliasRows"></tbody>
        </table>
      </div>
    </section>
  `;
  document.querySelector('#addAliasBtn').addEventListener('click', addAlias);
  document.querySelector('#importAliasesBtn').addEventListener('click', toggleAliasImport);
  document.querySelector('#aliasSearch').addEventListener('input', renderAliasRows);
  renderAliasRows();
}

function renderAliasRows() {
  const query = document.querySelector('#aliasSearch')?.value.toLowerCase() || '';
  const rows = draft.aliases
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => [item.name, item.command, item.category, item.description].join(' ').toLowerCase().includes(query));
  document.querySelector('#aliasRows').innerHTML = rows.map(({ item, index }) => `
    <tr>
      <td><input type="checkbox" data-alias="${index}" data-key="enabled" ${item.enabled ? 'checked' : ''}></td>
      <td><input value="${escapeAttr(item.name)}" data-alias="${index}" data-key="name"></td>
      <td><input value="${escapeAttr(item.command)}" data-alias="${index}" data-key="command"></td>
      <td><input value="${escapeAttr(item.category)}" data-alias="${index}" data-key="category"></td>
      <td><input value="${escapeAttr(item.description)}" data-alias="${index}" data-key="description"></td>
      <td><button class="danger" data-delete-alias="${index}">删除</button></td>
    </tr>
  `).join('');
  bindTableInputs('[data-alias]', 'alias');
  document.querySelectorAll('[data-delete-alias]').forEach((button) => {
    button.addEventListener('click', () => {
      draft.aliases.splice(Number(button.dataset.deleteAlias), 1);
      renderAliasRows();
    });
  });
}

function addAlias() {
  const item = {
    id: crypto.randomUUID(),
    name: valueOf('aliasName'),
    command: valueOf('aliasCommand'),
    category: valueOf('aliasCategory'),
    description: valueOf('aliasDescription'),
    enabled: true
  };
  if (!item.name || !item.command) {
    showNotice('别名和命令不能为空。');
    return;
  }
  draft.aliases.push(item);
  ['aliasName', 'aliasCommand', 'aliasCategory', 'aliasDescription'].forEach((id) => {
    document.querySelector(`#${id}`).value = '';
  });
  renderAliasRows();
}

function toggleAliasImport() {
  const textarea = document.querySelector('#aliasImport');
  if (textarea.hidden) {
    textarea.hidden = false;
    textarea.focus();
    return;
  }
  const imported = parseAliasLines(textarea.value);
  draft.aliases.push(...imported);
  textarea.value = '';
  textarea.hidden = true;
  renderAliasRows();
  showNotice(`已导入 ${imported.length} 个别名。`);
}

function renderPath() {
  content.innerHTML = `
    <section class="card">
      <h3>新增 PATH</h3>
      <div class="form-grid">
        ${field('pathValue', '路径', '例如 ~/.local/bin')}
        <div class="field">
          <label for="pathPosition">位置</label>
          <select id="pathPosition"><option value="prepend">放到前面</option><option value="append">放到后面</option></select>
        </div>
        ${field('pathDescription', '说明', '这个路径来自哪个工具')}
      </div>
      <button class="primary" id="addPathBtn">新增</button>
    </section>
    <section class="card">
      <h3>托管 PATH</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="check-col">启用</th><th>路径</th><th>位置</th><th>说明</th><th>排序</th><th class="action-col">操作</th></tr></thead>
          <tbody id="pathRows"></tbody>
        </table>
      </div>
    </section>
  `;
  document.querySelector('#addPathBtn').addEventListener('click', addPath);
  renderPathRows();
}

function renderPathRows() {
  document.querySelector('#pathRows').innerHTML = draft.paths.map((item, index) => `
    <tr>
      <td><input type="checkbox" data-path="${index}" data-key="enabled" ${item.enabled ? 'checked' : ''}></td>
      <td><input value="${escapeAttr(item.value)}" data-path="${index}" data-key="value"></td>
      <td><select data-path="${index}" data-key="position"><option value="prepend" ${item.position !== 'append' ? 'selected' : ''}>前置</option><option value="append" ${item.position === 'append' ? 'selected' : ''}>后置</option></select></td>
      <td><input value="${escapeAttr(item.description)}" data-path="${index}" data-key="description"></td>
      <td class="row-actions"><button class="secondary" data-move-path="${index}" data-dir="-1">上移</button><button class="secondary" data-move-path="${index}" data-dir="1">下移</button></td>
      <td><button class="danger" data-delete-path="${index}">删除</button></td>
    </tr>
  `).join('');
  bindTableInputs('[data-path]', 'path');
  bindMoveDelete('path', draft.paths, renderPathRows);
}

function addPath() {
  const value = valueOf('pathValue');
  if (!value) return;
  draft.paths.push({
    id: crypto.randomUUID(),
    value,
    position: valueOf('pathPosition'),
    description: valueOf('pathDescription'),
    enabled: true
  });
  renderPath();
}

function renderEnv() {
  content.innerHTML = `
    <section class="card">
      <h3>新增环境变量</h3>
      <div class="form-grid">
        ${field('envKey', '变量名', '例如 EDITOR')}
        ${field('envValue', '变量值', '例如 nvim')}
        ${field('envDescription', '说明', '变量用途')}
      </div>
      <button class="primary" id="addEnvBtn">新增</button>
    </section>
    <section class="card">
      <h3>托管环境变量</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="check-col">启用</th><th class="check-col">导出</th><th>变量</th><th>值</th><th>说明</th><th class="action-col">操作</th></tr></thead>
          <tbody id="envRows"></tbody>
        </table>
      </div>
    </section>
  `;
  document.querySelector('#addEnvBtn').addEventListener('click', addEnv);
  renderEnvRows();
}

function renderEnvRows() {
  document.querySelector('#envRows').innerHTML = draft.env.map((item, index) => `
    <tr>
      <td><input type="checkbox" data-env="${index}" data-key="enabled" ${item.enabled ? 'checked' : ''}></td>
      <td><input type="checkbox" data-env="${index}" data-key="exported" ${item.exported ? 'checked' : ''}></td>
      <td><input value="${escapeAttr(item.key)}" data-env="${index}" data-key="key"></td>
      <td><input value="${escapeAttr(item.value)}" data-env="${index}" data-key="value"></td>
      <td><input value="${escapeAttr(item.description)}" data-env="${index}" data-key="description"></td>
      <td><button class="danger" data-delete-env="${index}">删除</button></td>
    </tr>
  `).join('');
  bindTableInputs('[data-env]', 'env');
  document.querySelectorAll('[data-delete-env]').forEach((button) => {
    button.addEventListener('click', () => {
      draft.env.splice(Number(button.dataset.deleteEnv), 1);
      renderEnvRows();
    });
  });
}

function addEnv() {
  const key = valueOf('envKey');
  if (!key) return;
  draft.env.push({
    id: crypto.randomUUID(),
    key,
    value: valueOf('envValue'),
    description: valueOf('envDescription'),
    exported: true,
    enabled: true
  });
  renderEnv();
}

function renderOhMyZsh() {
  content.innerHTML = `
    <section class="card">
      <h3>Oh My Zsh</h3>
      <div class="form-grid">
        <div class="field">
          <label><input type="checkbox" id="themeEnabled" ${draft.ohMyZsh.theme.enabled ? 'checked' : ''}> 由这里管理主题</label>
          <input id="themeValue" value="${escapeAttr(draft.ohMyZsh.theme.value)}" placeholder="agnoster">
        </div>
        <div class="field">
          <label><input type="checkbox" id="pluginsEnabled" ${draft.ohMyZsh.plugins.enabled ? 'checked' : ''}> 由这里管理插件</label>
          <input id="pluginsValue" value="${escapeAttr(draft.ohMyZsh.plugins.values.join(' '))}" placeholder="git zsh-autosuggestions">
        </div>
      </div>
      <p class="muted">提示：alias、PATH、环境变量适合在这里管理。主题和插件受 Oh My Zsh 加载顺序影响，页面会在诊断里提醒。</p>
    </section>
    <section class="card">
      <h3>现有 Oh My Zsh 配置</h3>
      <div class="stack">
        ${state.scan.items.filter((item) => item.type === 'ohMyZsh').map(renderScanItem).join('') || '<p class="muted">未识别到 Oh My Zsh 配置。</p>'}
      </div>
    </section>
  `;
  document.querySelector('#themeEnabled').addEventListener('change', (event) => draft.ohMyZsh.theme.enabled = event.target.checked);
  document.querySelector('#themeValue').addEventListener('input', (event) => draft.ohMyZsh.theme.value = event.target.value);
  document.querySelector('#pluginsEnabled').addEventListener('change', (event) => draft.ohMyZsh.plugins.enabled = event.target.checked);
  document.querySelector('#pluginsValue').addEventListener('input', (event) => {
    draft.ohMyZsh.plugins.values = event.target.value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  });
}

function renderDiagnostics() {
  content.innerHTML = `
    <section class="card">
      <h3>诊断结果</h3>
      <div class="stack">
        ${state.diagnostics.map((item) => `
          <div class="scan-item">
            <span class="pill ${item.level}">${escapeHtml(item.level)}</span>
            <strong>${escapeHtml(item.area)}</strong>
            <span>${escapeHtml(item.message)}</span>
          </div>
        `).join('') || '<p class="muted">没有发现问题。</p>'}
      </div>
    </section>
    <section class="card">
      <h3>生成文件预览</h3>
      <pre>${escapeHtml(state.generated)}</pre>
    </section>
  `;
}

function renderBackups() {
  content.innerHTML = `
    <section class="card">
      <h3>备份</h3>
      <div class="inline-actions">
        <button class="primary" id="manualBackupBtn">创建备份</button>
      </div>
      <div class="stack">
        ${state.backups.map((id) => `
          <div class="scan-item">
            <strong>${escapeHtml(id)}</strong>
            <button class="secondary" data-restore="${escapeAttr(id)}">恢复</button>
          </div>
        `).join('') || '<p class="muted">还没有备份。</p>'}
      </div>
    </section>
  `;
  document.querySelector('#manualBackupBtn').addEventListener('click', async () => {
    await request('/api/backup', { method: 'POST', body: { label: 'manual' } });
    await load();
  });
  document.querySelectorAll('[data-restore]').forEach((button) => {
    button.addEventListener('click', async () => {
      await request('/api/restore', { method: 'POST', body: { id: button.dataset.restore } });
      await load();
    });
  });
}

function metric(label, value, caption) {
  return `<section class="card"><h3>${label}</h3><div class="metric">${value}</div><p class="muted">${caption}</p></section>`;
}

function field(id, label, placeholder) {
  return `<div class="field"><label for="${id}">${label}</label><input id="${id}" placeholder="${placeholder}"></div>`;
}

function renderSaveSummary(result) {
  const status = result.ok ? '语法检查通过' : '语法检查失败';
  const aliasCount = draft.aliases.filter((item) => item.enabled).length;
  const pathCount = draft.paths.filter((item) => item.enabled).length;
  const envCount = draft.env.filter((item) => item.enabled).length;
  const changeHtml = renderChangeSummary(result.summary);
  return `
    <div class="summary-row">
      <span class="pill ${result.ok ? 'ok' : 'error'}">${status}</span>
      <span>保存后写入 <code>~/.config/zsh-config/managed.zsh</code></span>
    </div>
    ${changeHtml}
    <div class="summary-grid">
      <span><strong>${aliasCount}</strong> 个别名</span>
      <span><strong>${pathCount}</strong> 个 PATH</span>
      <span><strong>${envCount}</strong> 个环境变量</span>
    </div>
    <p class="muted">保存后，新开的终端会自动生效。当前终端需要执行 <code>source ~/.config/zsh-config/managed.zsh</code>。</p>
  `;
}

function renderChangeSummary(summary) {
  if (!summary) {
    return '<p class="muted">正在准备变更摘要。</p>';
  }
  const rows = [
    ...summary.aliases.added.map((item) => changeRow('新增别名', `${item.name} -> ${item.command}`, 'add')),
    ...summary.aliases.changed.map((item) => changeRow('修改别名', `${item.after.name} -> ${item.after.command}`, 'change')),
    ...summary.aliases.removed.map((item) => changeRow('删除别名', item.name, 'remove')),
    ...summary.paths.added.map((item) => changeRow('新增 PATH', item.value, 'add')),
    ...summary.paths.changed.map((item) => changeRow('修改 PATH', item.after.value, 'change')),
    ...summary.paths.removed.map((item) => changeRow('删除 PATH', item.value, 'remove')),
    ...summary.env.added.map((item) => changeRow('新增环境变量', `${item.key}=${item.value}`, 'add')),
    ...summary.env.changed.map((item) => changeRow('修改环境变量', `${item.after.key}=${item.after.value}`, 'change')),
    ...summary.env.removed.map((item) => changeRow('删除环境变量', item.key, 'remove')),
    ...summary.ohMyZsh.changed.map((item) => changeRow(`修改 ${item.name}`, `${item.before} -> ${item.after}`, 'change'))
  ];

  if (rows.length === 0) {
    return '<div class="change-list"><div class="change-row"><span class="pill info">无变化</span><span>没有需要保存的新改动。</span></div></div>';
  }

  return `<div class="change-list">${rows.join('')}</div>`;
}

function changeRow(label, value, tone) {
  const toneClass = tone === 'add' ? 'ok' : tone === 'remove' ? 'warning' : 'info';
  return `
    <div class="change-row">
      <span class="pill ${toneClass}">${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    </div>
  `;
}

function localizeDiff(diff) {
  if (!diff) {
    return '';
  }
  return diff
    .replace('--- managed.zsh current', '--- 当前生成文件')
    .replace('+++ managed.zsh next', '+++ 保存后的生成文件')
    .replaceAll('# Generated by zsh Config Center.', '# 由 zsh Config Center 生成')
    .replaceAll('# Edit from the local web app instead of changing this file by hand.', '# 请在页面里修改，不建议手动编辑本文件')
    .replaceAll('# Source: ~/.config/zsh-config/config.json', '# 数据来源：~/.config/zsh-config/config.json')
    .replaceAll('# --- Aliases --------------------------------------------------------------', '# --- 别名 --------------------------------------------------------------')
    .replaceAll('# No managed aliases.', '# 没有由本工具管理的别名')
    .replaceAll('# --- PATH -----------------------------------------------------------------', '# --- PATH --------------------------------------------------------------')
    .replaceAll('# No managed PATH entries.', '# 没有由本工具管理的 PATH')
    .replaceAll('# --- Environment ----------------------------------------------------------', '# --- 环境变量 ----------------------------------------------------------')
    .replaceAll('# No managed environment variables.', '# 没有由本工具管理的环境变量')
    .replaceAll('# --- Oh My Zsh ------------------------------------------------------------', '# --- Oh My Zsh ---------------------------------------------------------')
    .replaceAll('# These values are emitted for visibility. If this file is sourced after', '# 这些值用于可见性检查。如果本文件在')
    .replaceAll('# oh-my-zsh has already loaded, theme/plugin changes need a new bootstrap', '# Oh My Zsh 之后加载，主题/插件变更需要调整加载位置')
    .replaceAll('# position before `source $ZSH/oh-my-zsh.sh` to affect startup behavior.', '# 才能影响启动行为')
    .replaceAll('# No managed ZSH_THEME override.', '# 没有由本工具管理的主题')
    .replaceAll('# No managed oh-my-zsh plugin override.', '# 没有由本工具管理的插件');
}

function renderScanItem(item) {
  return `
    <div class="scan-item">
      <span class="pill">${escapeHtml(item.type)}</span>
      <strong>${escapeHtml(item.summary)}</strong>
      <span class="path-text muted">${escapeHtml(item.file)}:${item.line}</span>
    </div>
  `;
}

function bindTableInputs(selector, collectionName) {
  document.querySelectorAll(selector).forEach((input) => {
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    function update(event) {
      const index = Number(input.dataset[collectionName]);
      const key = input.dataset.key;
      draft[collectionName === 'path' ? 'paths' : collectionName === 'alias' ? 'aliases' : 'env'][index][key] = input.type === 'checkbox' ? event.target.checked : event.target.value;
    }
  });
}

function bindMoveDelete(name, list, rerender) {
  document.querySelectorAll(`[data-move-${name}]`).forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset[`move${capitalize(name)}`]);
      const next = index + Number(button.dataset.dir);
      if (next < 0 || next >= list.length) return;
      [list[index], list[next]] = [list[next], list[index]];
      rerender();
    });
  });
  document.querySelectorAll(`[data-delete-${name}]`).forEach((button) => {
    button.addEventListener('click', () => {
      list.splice(Number(button.dataset[`delete${capitalize(name)}`]), 1);
      rerender();
    });
  });
}

function parseAliasLines(text) {
  return text.split('\n').flatMap((line) => {
    const match = line.trim().match(/^alias\s+([^=\s]+)=(['"]?)(.*?)\2$/);
    if (!match) return [];
    return [{
      id: crypto.randomUUID(),
      name: match[1],
      command: match[3],
      description: '',
      category: 'imported',
      enabled: true
    }];
  });
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok && !options.allowError) {
    throw new Error(data.error || data.stderr || 'Request failed.');
  }
  return data;
}

function valueOf(id) {
  return document.querySelector(`#${id}`).value.trim();
}

function showNotice(message) {
  notice.hidden = false;
  notice.textContent = message;
}

function subtitles() {
  return {
    overview: '看清楚当前配置从哪里来，以及保存后怎么生效。',
    aliases: '管理常用命令缩写。',
    path: '调整命令搜索路径，避免重复和顺序混乱。',
    env: '管理环境变量。',
    omz: '查看和修改 Oh My Zsh 主题、插件。',
    diagnostics: '查看冲突、无效路径和加载顺序提醒。',
    backups: '创建备份，或恢复到之前的配置。'
  };
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

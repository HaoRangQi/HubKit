import fs from 'node:fs/promises';
import path from 'node:path';
import { getPaths, bootstrapSourceLine } from './paths.js';

export async function scanSystem(paths = getPaths()) {
  const files = [
    { key: 'zshrc', path: paths.zshrc, role: 'zsh 交互 shell 主配置' },
    { key: 'zprofile', path: paths.zprofile, role: '登录 shell 配置' },
    { key: 'zshenv', path: paths.zshenv, role: '所有 zsh 启动都会读取的环境配置' }
  ];

  const scannedFiles = [];
  const items = [];

  for (const file of files) {
    const content = await readMaybe(file.path);
    scannedFiles.push({
      ...file,
      exists: content !== null,
      lineCount: content ? content.split('\n').length : 0
    });
    if (content !== null) {
      items.push(...scanContent(content, file.path));
    }
  }

  const customFiles = await findOhMyZshCustomFiles(paths.ohMyZshCustom);
  for (const customFile of customFiles) {
    const content = await readMaybe(customFile);
    scannedFiles.push({
      key: 'ohMyZshCustom',
      path: customFile,
      role: 'Oh My Zsh custom 自动加载文件',
      exists: content !== null,
      lineCount: content ? content.split('\n').length : 0
    });
    if (content !== null) {
      items.push(...scanContent(content, customFile));
    }
  }

  const zshrcContent = await readMaybe(paths.zshrc);
  return {
    files: scannedFiles,
    items,
    bootstrap: {
      sourceLine: bootstrapSourceLine(),
      installed: zshrcContent?.includes(bootstrapSourceLine()) || false
    }
  };
}

export function scanContent(content, filePath) {
  const items = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const aliasMatch = trimmed.match(/^alias\s+([^=\s]+)=(['"]?)(.*?)\2$/);
    if (aliasMatch) {
      items.push({
        type: 'alias',
        name: aliasMatch[1],
        value: aliasMatch[3],
        file: filePath,
        line: lineNumber,
        summary: `命令别名：${aliasMatch[1]} -> ${aliasMatch[3]}`
      });
      return;
    }

    const exportMatch = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (exportMatch) {
      items.push({
        type: exportMatch[1] === 'PATH' ? 'path' : 'env',
        name: exportMatch[1],
        value: stripQuotes(exportMatch[2]),
        file: filePath,
        line: lineNumber,
        summary: explainExport(exportMatch[1], stripQuotes(exportMatch[2]))
      });
      return;
    }

    const themeMatch = trimmed.match(/^ZSH_THEME=(.*)$/);
    if (themeMatch) {
      items.push({
        type: 'ohMyZsh',
        name: 'ZSH_THEME',
        value: stripQuotes(themeMatch[1]),
        file: filePath,
        line: lineNumber,
        summary: `Oh My Zsh 主题：${stripQuotes(themeMatch[1])}`
      });
      return;
    }

    const pluginsMatch = trimmed.match(/^plugins=\((.*)\)$/);
    if (pluginsMatch) {
      items.push({
        type: 'ohMyZsh',
        name: 'plugins',
        value: pluginsMatch[1].trim(),
        file: filePath,
        line: lineNumber,
        summary: `Oh My Zsh 插件列表：${pluginsMatch[1].trim() || '空'}`
      });
      return;
    }

    if (trimmed.includes('brew shellenv')) {
      items.push({
        type: 'tooling',
        name: 'Homebrew shellenv',
        value: trimmed,
        file: filePath,
        line: lineNumber,
        summary: '初始化 Homebrew 环境变量和 PATH'
      });
      return;
    }

    if (trimmed.includes('pyenv init')) {
      items.push({
        type: 'tooling',
        name: 'pyenv',
        value: trimmed,
        file: filePath,
        line: lineNumber,
        summary: '初始化 pyenv，使 Python 版本切换生效'
      });
      return;
    }

    if (trimmed.includes('.p10k.zsh')) {
      items.push({
        type: 'prompt',
        name: 'Powerlevel10k',
        value: trimmed,
        file: filePath,
        line: lineNumber,
        summary: '加载 Powerlevel10k prompt 配置'
      });
      return;
    }

    if (/^(source|\.)\s+/.test(trimmed)) {
      items.push({
        type: 'source',
        name: 'source',
        value: trimmed,
        file: filePath,
        line: lineNumber,
        summary: '加载另一个 shell 配置文件'
      });
      return;
    }

    if (/^eval\s+/.test(trimmed)) {
      items.push({
        type: 'eval',
        name: 'eval',
        value: trimmed,
        file: filePath,
        line: lineNumber,
        summary: '执行命令输出的 shell 初始化代码'
      });
    }
  });
  return items;
}

async function findOhMyZshCustomFiles(root) {
  const results = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isFile() && entry.name.endsWith('.zsh')) {
        results.push(fullPath);
      }
    }
    results.push(...await findZshFiles(path.join(root, 'plugins')));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.code !== 'EPERM') {
      throw error;
    }
  }
  return results;
}

async function findZshFiles(root) {
  const results = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const nested = await findZshFiles(fullPath);
        results.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.zsh')) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.code !== 'EPERM') {
      throw error;
    }
  }
  return results;
}

async function readMaybe(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') {
      return null;
    }
    throw error;
  }
}

function stripQuotes(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function explainExport(name, value) {
  if (name === 'PATH') {
    return `调整 PATH 搜索路径：${value}`;
  }
  if (name.startsWith('PYTORCH_MPS') || name === 'PYTORCH_ENABLE_MPS_FALLBACK') {
    return `PyTorch MPS 运行参数：${name}=${value}`;
  }
  if (name === 'PYENV_ROOT') {
    return `pyenv 根目录：${value}`;
  }
  if (name === 'ZSH') {
    return `Oh My Zsh 安装目录：${value}`;
  }
  return `环境变量：${name}=${value}`;
}

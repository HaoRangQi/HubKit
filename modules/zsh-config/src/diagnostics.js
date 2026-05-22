import fs from 'node:fs';
import path from 'node:path';

export function diagnose(config, scan, paths) {
  const issues = [];
  collectAliasIssues(config, scan, issues);
  collectPathIssues(config, issues);
  collectEnvIssues(config, issues);
  collectOhMyZshIssues(config, scan, paths, issues);

  if (!scan.bootstrap.installed) {
    issues.push({
      level: 'info',
      area: 'bootstrap',
      message: '尚未接入托管配置。保存托管配置前，请先在页面中执行接入。'
    });
  }

  return issues;
}

function collectAliasIssues(config, scan, issues) {
  const managedNames = new Map();
  for (const alias of config.aliases.filter((item) => item.enabled)) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(alias.name)) {
      issues.push({
        level: 'error',
        area: 'aliases',
        message: `别名 "${alias.name}" 包含不安全字符。`
      });
    }
    if (managedNames.has(alias.name)) {
      issues.push({
        level: 'warning',
        area: 'aliases',
        message: `托管别名 "${alias.name}" 重复，后面的定义会覆盖前面的定义。`
      });
    }
    managedNames.set(alias.name, alias);
  }

  const scannedAliases = scan.items.filter((item) => item.type === 'alias');
  for (const item of scannedAliases) {
    if (managedNames.has(item.name)) {
      issues.push({
        level: 'warning',
        area: 'aliases',
        message: `托管别名 "${item.name}" 与 ${item.file}:${item.line} 的现有别名同名。`
      });
    }
  }
}

function collectPathIssues(config, issues) {
  const seen = new Set();
  for (const entry of config.paths.filter((item) => item.enabled && item.value)) {
    if (seen.has(entry.value)) {
      issues.push({
        level: 'warning',
        area: 'path',
        message: `PATH 条目重复：${entry.value}`
      });
    }
    seen.add(entry.value);

    const expanded = entry.value.replace(/^~(?=$|\/)/, process.env.HOME || '');
    if (path.isAbsolute(expanded) && !fs.existsSync(expanded)) {
      issues.push({
        level: 'info',
        area: 'path',
        message: `PATH 条目当前不存在：${entry.value}`
      });
    }
  }
}

function collectEnvIssues(config, issues) {
  const seen = new Set();
  for (const item of config.env.filter((entry) => entry.enabled)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.key)) {
      issues.push({
        level: 'error',
        area: 'env',
        message: `环境变量名 "${item.key}" 不合法。`
      });
    }
    if (seen.has(item.key)) {
      issues.push({
        level: 'warning',
        area: 'env',
        message: `环境变量 "${item.key}" 重复，后面的定义会覆盖前面的定义。`
      });
    }
    seen.add(item.key);
  }
}

function collectOhMyZshIssues(config, scan, paths, issues) {
  if ((config.ohMyZsh.theme.enabled && config.ohMyZsh.theme.value) || config.ohMyZsh.plugins.enabled) {
    issues.push({
      level: 'warning',
      area: 'oh-my-zsh',
      message: '当前 bootstrap 默认追加在 .zshrc 末尾；如果 Oh My Zsh 已经提前加载，主题和插件修改只会写入托管文件，未必影响启动加载顺序。'
    });
  }

  if (config.ohMyZsh.plugins.enabled) {
    for (const plugin of config.ohMyZsh.plugins.values) {
      const builtin = path.join(paths.home, '.oh-my-zsh', 'plugins', plugin);
      const custom = path.join(paths.ohMyZshCustom, 'plugins', plugin);
      if (!fs.existsSync(builtin) && !fs.existsSync(custom)) {
        issues.push({
          level: 'info',
          area: 'oh-my-zsh',
          message: `插件目录未找到：${plugin}`
        });
      }
    }
  }

  const sourceIndex = scan.items.findIndex((item) => item.value?.includes('oh-my-zsh.sh'));
  const managedIndex = scan.items.findIndex((item) => item.value?.includes('zsh-config/managed.zsh'));
  if (sourceIndex >= 0 && managedIndex > sourceIndex) {
    issues.push({
      level: 'info',
      area: 'oh-my-zsh',
      message: '检测到托管文件在 Oh My Zsh 之后加载；alias、PATH、env 会生效，主题和插件加载可能不会生效。'
    });
  }
}

import os from 'node:os';
import path from 'node:path';

export function getPaths(env = process.env) {
  const home = env.HOME || os.homedir();
  const managedRoot = env.ZSH_CONFIG_HOME || path.join(home, '.config', 'zsh-config');
  const ohMyZshCustom = env.ZSH_CONFIG_OMZ_CUSTOM || path.join(home, '.oh-my-zsh', 'custom');

  return {
    home,
    managedRoot,
    configFile: path.join(managedRoot, 'config.json'),
    managedFile: path.join(managedRoot, 'managed.zsh'),
    readmeFile: path.join(managedRoot, 'README.md'),
    backupsDir: path.join(managedRoot, 'backups'),
    zshrc: env.ZSH_CONFIG_ZSHRC || path.join(home, '.zshrc'),
    zprofile: env.ZSH_CONFIG_ZPROFILE || path.join(home, '.zprofile'),
    zshenv: env.ZSH_CONFIG_ZSHENV || path.join(home, '.zshenv'),
    ohMyZshCustom
  };
}

export function assertAllowedPath(filePath, paths = getPaths()) {
  const resolved = path.resolve(filePath);
  const managedRoot = path.resolve(paths.managedRoot);
  const allowedExact = new Set([
    path.resolve(paths.zshrc),
    path.resolve(paths.zprofile),
    path.resolve(paths.zshenv)
  ]);

  if (allowedExact.has(resolved)) {
    return resolved;
  }

  if (resolved === managedRoot || resolved.startsWith(`${managedRoot}${path.sep}`)) {
    return resolved;
  }

  throw new Error(`Path is outside the zsh-config allowlist: ${filePath}`);
}

export function bootstrapSourceLine() {
  return '[[ -r "$HOME/.config/zsh-config/managed.zsh" ]] && source "$HOME/.config/zsh-config/managed.zsh"';
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateManagedZsh, shellQuote } from '../src/generator.js';
import { createDefaultConfig } from '../src/model.js';
import { validateZsh } from '../src/server.js';

test('shellQuote safely quotes single quotes', () => {
  assert.equal(shellQuote("git commit -m 'x'"), "'git commit -m '\"'\"'x'\"'\"''");
});

test('generateManagedZsh emits aliases, PATH, env, and Oh My Zsh values', async () => {
  const config = createDefaultConfig();
  config.aliases.push({
    id: '1',
    name: 'gs',
    command: 'git status',
    description: 'Git status',
    category: 'git',
    enabled: true
  });
  config.paths.push({
    id: '2',
    value: '/tmp/bin',
    position: 'prepend',
    description: 'Temporary binaries',
    enabled: true
  });
  config.env.push({
    id: '3',
    key: 'EDITOR',
    value: 'nvim',
    description: 'Editor',
    exported: true,
    enabled: true
  });
  config.ohMyZsh.theme = { enabled: true, value: 'agnoster', description: '' };
  config.ohMyZsh.plugins = { enabled: true, values: ['git'], description: '' };

  const zsh = generateManagedZsh(config);
  assert.match(zsh, /alias gs='git status'/);
  assert.match(zsh, /_zsh_config_add_path 'prepend' '\/tmp\/bin'/);
  assert.match(zsh, /export EDITOR='nvim'/);
  assert.match(zsh, /ZSH_THEME='agnoster'/);
  assert.match(zsh, /plugins=\('git'\)/);

  const validation = await validateZsh(zsh);
  assert.equal(validation.ok, true, validation.stderr);
});

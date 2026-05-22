import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/model.js';
import { diagnose } from '../src/diagnostics.js';
import { getPaths } from '../src/paths.js';

test('diagnose reports duplicate aliases, invalid env names, and duplicate PATH', () => {
  const config = createDefaultConfig();
  config.aliases.push(
    { id: '1', name: 'gs', command: 'git status', enabled: true },
    { id: '2', name: 'gs', command: 'git switch', enabled: true }
  );
  config.paths.push(
    { id: '3', value: '/tmp', position: 'prepend', enabled: true },
    { id: '4', value: '/tmp', position: 'append', enabled: true }
  );
  config.env.push({ id: '5', key: '1BAD', value: 'x', enabled: true, exported: true });
  const scan = {
    bootstrap: { installed: false },
    items: [{ type: 'alias', name: 'gs', file: '/tmp/.zshrc', line: 3 }]
  };

  const issues = diagnose(config, scan, getPaths({ HOME: '/tmp' }));
  assert.ok(issues.some((issue) => issue.message.includes('重复')));
  assert.ok(issues.some((issue) => issue.message.includes('不合法')));
  assert.ok(issues.some((issue) => issue.area === 'bootstrap'));
});

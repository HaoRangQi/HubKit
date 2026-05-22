import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff } from '../src/diff.js';

test('unifiedDiff keeps unchanged sections aligned after a single inserted alias', () => {
  const before = ['# --- Aliases', "alias l='lsd -la'", '', '# --- PATH', '# No managed PATH entries.', ''].join('\n');
  const after = ['# --- Aliases', "alias l='lsd -la'", "alias yz='yazi'", '', '# --- PATH', '# No managed PATH entries.', ''].join('\n');
  const diff = unifiedDiff(before, after);

  assert.match(diff, /\+alias yz='yazi'/);
  assert.doesNotMatch(diff, /-# --- PATH/);
  assert.doesNotMatch(diff, /\+# --- PATH/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/model.js';
import { hasMeaningfulChanges, summarizeConfigChange } from '../src/summary.js';

test('summarizeConfigChange reports added aliases without exposing raw diff noise', () => {
  const before = createDefaultConfig();
  before.aliases.push({ id: '1', name: 'l', command: 'lsd -la', enabled: true });
  const after = structuredClone(before);
  after.aliases.push({ id: '2', name: 'yz', command: 'yazi', enabled: true });

  const summary = summarizeConfigChange(before, after);
  assert.deepEqual(summary.aliases.added.map((item) => item.name), ['yz']);
  assert.equal(summary.aliases.added[0].command, 'yazi');
  assert.equal(hasMeaningfulChanges(summary), true);
});

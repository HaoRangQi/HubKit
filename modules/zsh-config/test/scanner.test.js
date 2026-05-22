import test from 'node:test';
import assert from 'node:assert/strict';
import { scanContent } from '../src/scanner.js';

test('scanContent identifies common zsh configuration lines', () => {
  const items = scanContent(`
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="agnoster"
plugins=(git docker)
alias gs='git status'
eval "$(/opt/homebrew/bin/brew shellenv)"
export PYTORCH_MPS_LOW_WATERMARK_RATIO=0.6
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh
`, '/tmp/.zshrc');

  assert.equal(items.find((item) => item.type === 'alias').name, 'gs');
  assert.equal(items.find((item) => item.name === 'ZSH_THEME').value, 'agnoster');
  assert.equal(items.find((item) => item.name === 'plugins').value, 'git docker');
  assert.ok(items.some((item) => item.name === 'Homebrew shellenv'));
  assert.ok(items.some((item) => item.name === 'PYTORCH_MPS_LOW_WATERMARK_RATIO'));
  assert.ok(items.some((item) => item.name === 'Powerlevel10k'));
});

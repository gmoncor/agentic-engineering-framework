'use strict';

// Contrato de sdd-commit-guard.js: avisa de commits mal formados, sea cual sea la CLI que lo llame.
// Las tres familias de payload entregan el comando en un sitio distinto:
//   - Claude Code / Gemini CLI: tool_input.command
//   - Antigravity CLI:          toolCall.args.CommandLine (y solo admite allow|deny|ask|force_ask)

const test = require('node:test');
const assert = require('node:assert');
const { runHook } = require('./helpers');

const HOOK = 'sdd-commit-guard.js';

const COAUTORIA = 'git commit -m "feat: algo" -m "Co-Authored-By: Claude <noreply@anthropic.com>"';

const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
const agy = command => ({ toolCall: { name: 'run_command', args: { CommandLine: command } } });

test('Claude Code / Gemini CLI: commit con coautoria de IA -> warn', () => {
  const r = runHook(HOOK, bash(COAUTORIA));

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /COMMIT_COAUTHOR_FORBIDDEN/);
});

test('Antigravity: el comando se lee de CommandLine y el aviso se expresa como allow', () => {
  const r = runHook(HOOK, agy(COAUTORIA));

  assert.strictEqual(r.decision.decision, 'allow');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /COMMIT_COAUTHOR_FORBIDDEN/);
});

test('Antigravity: commit bien formado -> no dice nada', () => {
  const r = runHook(HOOK, agy('git commit -m "feat: anadir el guard de pipeline"'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('Antigravity: comando que no es git commit ni gh pr -> no dice nada', () => {
  const r = runHook(HOOK, agy('npm test'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

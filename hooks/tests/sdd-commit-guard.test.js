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

test('Antigravity: commit bien formado con cuerpo -> no dice nada', () => {
  const r = runHook(HOOK, agy('git commit -m "feat: anadir el guard de pipeline" '
    + '-m "bloquea escrituras fuera de las tasks declaradas para no saltarse el plan"'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('Antigravity: comando que no es git commit ni gh pr -> no dice nada', () => {
  const r = runHook(HOOK, agy('npm test'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('commit funcional sin cuerpo -> warn con QUE y POR QUE', () => {
  const r = runHook(HOOK, bash('git commit -m "feat: anadir login"'));

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /COMMIT_BODY_MISSING/);
});

test('commit funcional con cuerpo fino (<10 chars) -> warn', () => {
  const r = runHook(HOOK, bash('git commit -m "fix: corregir el parser" -m "menor"'));

  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.decision.reason, /COMMIT_BODY_MISSING/);
});

test('commit funcional con cuerpo que explica el porque -> no dice nada', () => {
  const r = runHook(HOOK, bash('git commit -m "fix: corregir el parser de mensajes" '
    + '-m "el segundo -m no se reconocia como cuerpo y perdia la trazabilidad"'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('commit docs sin cuerpo -> exento, no dice nada', () => {
  const r = runHook(HOOK, bash('git commit -m "docs: corregir typo en el README"'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('commit interactivo (sin -m) -> no puede leer el cuerpo, no dice nada', () => {
  const r = runHook(HOOK, bash('git commit'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

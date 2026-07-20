'use strict';

// Contrato de sdd-commit-guard-codex.js: --no-verify se deniega; el resto de problemas se avisan.

const test = require('node:test');
const assert = require('node:assert');
const { runHook } = require('./helpers');

const HOOK = 'sdd-commit-guard-codex.js';

const shell = command => ({ tool_name: 'shell', tool_input: { command } });

test('git commit --no-verify: deny', () => {
  const r = runHook(HOOK, shell('git commit --no-verify -m "fix: algo"'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /--no-verify/);
});

test('git commit -n (alias corto): deny', () => {
  const r = runHook(HOOK, shell('git commit -n -m "fix: algo"'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('git push --no-verify: deny', () => {
  const r = runHook(HOOK, shell('git push --no-verify origin main'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('git push -n (dry-run, no es bypass): allow', () => {
  const r = runHook(HOOK, shell('git push -n origin main'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('comando como argv: deny igual que como string', () => {
  const r = runHook(HOOK, {
    tool_name: 'shell',
    tool_input: { command: ['bash', '-lc', 'git commit --no-verify -m "fix: algo"'] },
  });

  assert.strictEqual(r.decision.decision, 'deny');
});

test('git commit sin --no-verify y bien formado: allow', () => {
  const r = runHook(HOOK, shell('git commit -m "feat: anadir servicio de login" '
    + '-m "centraliza la autenticacion para que cada backend no la reimplemente"'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('git commit funcional sin cuerpo: warn de cuerpo ausente, no deny', () => {
  const r = runHook(HOOK, shell('git commit -m "feat: anadir servicio de login"'));

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /COMMIT_BODY_MISSING/);
});

test('git commit con tipo invalido: warn, no deny', () => {
  const r = runHook(HOOK, shell('git commit -m "arreglado: el login"'));

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /COMMIT_TYPE_INVALID/);
});

test('git commit con coautoria de IA: warn, no deny', () => {
  const mensaje = 'feat: anadir login\n\nCo-Authored-By: Codex <noreply@openai.com>';
  const r = runHook(HOOK, shell(`git commit -m "${mensaje}"`));

  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.decision.reason, /COMMIT_COAUTHOR_FORBIDDEN/);
});

test('SDD_GUARD_SKIP=1 con --no-verify: warn en vez de deny', () => {
  const r = runHook(HOOK, shell('git commit --no-verify -m "fix: algo"'), { SDD_GUARD_SKIP: '1' });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
});

test('comando que no es git commit ni gh pr: allow', () => {
  const r = runHook(HOOK, shell('npm test'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('tool que no es shell: allow', () => {
  const r = runHook(HOOK, { tool_name: 'apply_patch', tool_input: { input: 'git commit --no-verify' } });

  assert.strictEqual(r.code, 0);
});

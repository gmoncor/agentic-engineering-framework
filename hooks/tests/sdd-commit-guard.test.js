'use strict';

// Contrato de sdd-commit-guard.js: deniega --no-verify, avisa del resto de commits mal formados,
// sea cual sea la CLI que lo llame. Las tres familias de payload entregan el comando en un sitio
// distinto:
//   - Claude Code / Gemini CLI: tool_input.command
//   - Antigravity CLI:          toolCall.args.CommandLine (y solo admite allow|deny|ask|force_ask)

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');
const { commitWarnings, usesNoVerify } = require('../sdd-commit-rules');

const HOOK = 'sdd-commit-guard.js';

const COAUTORIA = 'git commit -m "feat: algo" -m "Co-Authored-By: Claude <noreply@anthropic.com>"';

const bash = command => ({ tool_name: 'Bash', tool_input: { command } });
const agy = command => ({ toolCall: { name: 'run_command', args: { CommandLine: command } } });

test('git commit --no-verify: deny', () => {
  const r = runHook(HOOK, bash('git commit --no-verify -m "fix: algo"'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /--no-verify/);
});

test('git commit -n (alias corto): deny', () => {
  const r = runHook(HOOK, bash('git commit -n -m "fix: algo"'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('usesNoVerify: -n combinado con otro flag corto (-na) se detecta', () => {
  assert.strictEqual(usesNoVerify('git commit -na -m "x"'), true);
});

test('usesNoVerify: -n combinado al final del grupo (-an) se detecta', () => {
  assert.strictEqual(usesNoVerify('git commit -an -m "x"'), true);
});

test('usesNoVerify: grupo de flags sin -n (-am) no se detecta (falso positivo)', () => {
  assert.strictEqual(usesNoVerify('git commit -am -m "x"'), false);
});

test('git -c core.hooksPath=/tmp commit --no-verify: deny (opcion global ya no evade el bloqueo)', () => {
  const r = runHook(HOOK, bash('git -c core.hooksPath=/tmp commit --no-verify -m x'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /--no-verify/);
});

test('git commit -uno -m x: no deniega (--untracked-files=no, la n es valor de -u)', () => {
  const r = runHook(HOOK, bash('git commit -uno -m x'));

  assert.notStrictEqual(r.code, 2);
});

test('git commit -m "docs: explain the -n flag": no deniega (texto del mensaje, no un flag)', () => {
  const r = runHook(HOOK, bash('git commit -m "docs: explain the -n flag"'));

  assert.notStrictEqual(r.code, 2);
});

test('git commit -m "docs: --no-verify esta prohibido": no deniega (texto del mensaje, no un flag)', () => {
  const r = runHook(HOOK, bash('git commit -m "docs: --no-verify esta prohibido"'));

  assert.notStrictEqual(r.code, 2);
});

test('git push --no-verify: deny', () => {
  const r = runHook(HOOK, bash('git push --no-verify origin main'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

// Confirmacion end-to-end de las formas que evadian el bloqueo antes del fix del tokenizador
// (envoltorio sin flags, sintaxis de shell tomada como programa, parentesis pegados al nombre,
// `&` suelto sin partir segmento, alternacion asignacion/envoltorio). El control positivo ya
// esta cubierto arriba ('git commit --no-verify: deny'); aqui no se duplica.
for (const cmd of [
  'sudo git commit --no-verify -m "x"',
  '{ git commit --no-verify -m "x"; }',
  'if true; then git commit --no-verify -m "x"; fi',
  '(git commit --no-verify -m "x")',
  'sleep 1 & git commit --no-verify -m "x"',
  'env FOO=bar git commit --no-verify -m "x"',
]) {
  test(`sdd-commit-guard.js contra el binario real: ${cmd} -> deny`, () => {
    const r = runHook(HOOK, bash(cmd));

    assert.strictEqual(r.decision.decision, 'deny');
    assert.strictEqual(r.code, 2);
    assert.match(r.decision.reason, /--no-verify/);
  });
}

test('Antigravity: git commit --no-verify -> deny expresado sin exit code de bloqueo', () => {
  const r = runHook(HOOK, agy('git commit --no-verify -m "fix: algo"'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 0);
});

test('SDD_GUARD_SKIP=1 con --no-verify: warn en vez de deny', () => {
  const r = runHook(HOOK, bash('git commit --no-verify -m "fix: algo"'), { SDD_GUARD_SKIP: '1' });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
});

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

// pendingConvergenceTasks() lee de un path relativo (ai_docs/tasks/), asi que estos tres
// tests se ejecutan in-process (require directo, no runHook) para poder controlar el cwd.
const PR_CMD = 'gh pr create --title "x" --body "y"';

function withCwd(dir, fn) {
  const previo = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(previo);
  }
}

test('gh pr create con task de convergencia PENDIENTE -> warn CONVERGENCE_PENDING', () => {
  const dir = tempDir('sdd-convergencia-');
  writeFile(path.join(dir, 'ai_docs/tasks/001_convergencia_test.md'), '# Task\n\nEstado: PENDIENTE\n');

  const warnings = withCwd(dir, () => commitWarnings(PR_CMD));

  assert.ok(warnings.some(w => /CONVERGENCE_PENDING/.test(w)));
});

test('gh pr create con task de convergencia COMPLETADA -> no genera el aviso', () => {
  const dir = tempDir('sdd-convergencia-');
  writeFile(path.join(dir, 'ai_docs/tasks/001_convergencia_test.md'), '# Task\n\nEstado: COMPLETADA\n');

  const warnings = withCwd(dir, () => commitWarnings(PR_CMD));

  assert.ok(!warnings.some(w => /CONVERGENCE_PENDING/.test(w)));
});

test('gh pr create sin ai_docs/tasks/ -> sin aviso ni excepcion', () => {
  const dir = tempDir('sdd-convergencia-');

  const warnings = withCwd(dir, () => commitWarnings(PR_CMD));

  assert.ok(!warnings.some(w => /CONVERGENCE_PENDING/.test(w)));
});

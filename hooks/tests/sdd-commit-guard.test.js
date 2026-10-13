'use strict';

// Contrato de sdd-commit-guard.js: deniega --no-verify, avisa del resto de commits mal formados,
// sea cual sea la CLI que lo llame. Las tres familias de payload entregan el comando en un sitio
// distinto:
//   - Claude Code / Gemini CLI: tool_input.command
//   - Antigravity CLI:          toolCall.args.CommandLine (y solo admite allow|deny|ask|force_ask)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile, HOOKS_DIR, motorDeWorkflowsInstalado } = require('./helpers');
const { commitWarnings, usesNoVerify, estaPendiente } = require('../sdd-commit-rules');
const { estadoVigente } = require('../sdd-plan-state');

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

// Formato real de una task: el bloque de la plantilla de dev_templates/tareas.md, cuya cabecera
// escribe `**Estado:** PENDIENTE` en negrita. Si la plantilla cambia de formato, estos casos lo ven.
function taskDeLaPlantilla() {
  const plantilla = fs.readFileSync(path.join(HOOKS_DIR, '..', 'ai_docs', 'dev_templates', 'tareas.md'), 'utf8');
  const bloque = /```markdown\n([\s\S]*?)\n```/.exec(plantilla);
  assert.ok(bloque, 'la plantilla de tareas.md no tiene el bloque ```markdown de la task');
  assert.match(bloque[1], /^\*\*Estado:\*\* PENDIENTE$/m, 'la cabecera de la plantilla ya no es **Estado:** PENDIENTE');
  return bloque[1] + '\n';
}

function avisosConTask(contenido) {
  const dir = tempDir('sdd-convergencia-');
  writeFile(path.join(dir, 'ai_docs/tasks/001_convergencia_test.md'), contenido);
  return withCwd(dir, () => commitWarnings(PR_CMD)).filter(w => /CONVERGENCE_PENDING/.test(w));
}

test('task de convergencia con la cabecera de la plantilla (**Estado:** PENDIENTE) -> warn CONVERGENCE_PENDING', () => {
  assert.strictEqual(avisosConTask(taskDeLaPlantilla()).length, 1);
});

test('task de convergencia con **Estado:** COMPLETADA -> sin aviso', () => {
  const completada = taskDeLaPlantilla().replace('**Estado:** PENDIENTE', '**Estado:** COMPLETADA');
  assert.strictEqual(avisosConTask(completada).length, 0);
});

test('Estado: PENDIENTE mencionado en mitad de una frase -> sin aviso', () => {
  const doc = '# Task\n\nLa revisión la dejó en Estado: PENDIENTE hasta el siguiente ciclo.\n';
  assert.strictEqual(avisosConTask(doc).length, 0);
});

// Composición con el escritor del Estado del motor de workflows (marcarEstado): solo existe donde
// se instala .claude/workflows/ (backend Claude); hooks/tests/ se instala en todos los backends.
if (!motorDeWorkflowsInstalado()) {
  test('composición de estaPendiente con marcarEstado', {
    skip: 'sin motor de workflows de Claude Code (.claude/workflows/implementar-spec.js y/o .claude/settings.json ausentes): .claude/workflows/lib/orquestacion no existe en este backend',
  }, () => {});
} else {
  const { marcarEstado } = require('../../.claude/workflows/lib/orquestacion');
  const silencio = { log: () => {} };

  function docDeConvergencia(contenido) {
    const dir = tempDir('sdd-convergencia-');
    const ruta = path.join(dir, 'ai_docs', 'tasks', '001_convergencia_test.md');
    writeFile(ruta, contenido);
    return ruta;
  }

  test('composición: la task de la plantilla sin marcar sigue PENDIENTE; marcada COMPLETADA deja de estarlo', () => {
    const sinMarcar = docDeConvergencia(taskDeLaPlantilla());
    assert.strictEqual(estaPendiente(sinMarcar), true);

    const marcada = docDeConvergencia(taskDeLaPlantilla());
    assert.strictEqual(marcarEstado(marcada, 'COMPLETADA', silencio), true);
    const texto = fs.readFileSync(marcada, 'utf8');
    assert.strictEqual(estadoVigente(texto), 'COMPLETADA');
    assert.strictEqual(estaPendiente(marcada), false);
  });

  test('composición: con una segunda línea Estado: PENDIENTE en el cuerpo, lector y escritor miran la misma', () => {
    const doc = taskDeLaPlantilla() + '\n## Notas\n\nEstado: PENDIENTE\n';
    assert.ok(doc.split('\n').indexOf('Estado: PENDIENTE') >= 10, 'la línea del cuerpo debe quedar después de la línea 10');
    const ruta = docDeConvergencia(doc);
    assert.strictEqual(estaPendiente(ruta), true);

    assert.strictEqual(marcarEstado(ruta, 'COMPLETADA', silencio), true);
    const texto = fs.readFileSync(ruta, 'utf8');
    assert.strictEqual(estadoVigente(texto), 'COMPLETADA');
    assert.strictEqual(estaPendiente(ruta), false);
  });
}

// El mensaje de `git commit -F <ruta>` se lee del fichero, resuelto contra el directorio en curso:
// estos tests fijan el cwd en un directorio temporal con el fichero de mensaje y lo borran al acabar.
function conDirMensaje(fn) {
  const dir = tempDir('sdd-commit-file-');
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('git commit -F con asunto de 80 caracteres -> warn COMMIT_SUBJECT_TOO_LONG', () => conDirMensaje(dir => {
  writeFile(path.join(dir, 'msg.txt'), 'docs: ' + 'x'.repeat(74) + '\n');

  const warnings = withCwd(dir, () => commitWarnings('git commit -F msg.txt'));

  assert.ok(warnings.some(w => /COMMIT_SUBJECT_TOO_LONG: subject tiene 80 chars/.test(w)), warnings.join('\n'));
}));

test('git commit --file=<ruta> con Co-Authored-By de IA -> warn COMMIT_COAUTHOR_FORBIDDEN', () => conDirMensaje(dir => {
  writeFile(path.join(dir, 'msg.txt'),
    'fix: corrige el parseo\n\nEl parser perdia el ultimo campo.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');

  const warnings = withCwd(dir, () => commitWarnings('git commit --file=msg.txt'));

  assert.ok(warnings.some(w => /COMMIT_COAUTHOR_FORBIDDEN/.test(w)), warnings.join('\n'));
}));

test('git commit --file <ruta> y -F<ruta> pegado tambien se leen', () => conDirMensaje(dir => {
  writeFile(path.join(dir, 'msg.txt'), 'nope: asunto con tipo invalido\n');

  for (const cmd of ['git commit --file msg.txt', 'git commit -Fmsg.txt', 'git add . && git commit -F "msg.txt"']) {
    const warnings = withCwd(dir, () => commitWarnings(cmd));
    assert.ok(warnings.some(w => /COMMIT_TYPE_INVALID/.test(w)), cmd + ': ' + warnings.join('\n'));
  }
}));

test('git commit -F a un fichero inexistente -> sin aviso de mensaje ni excepcion', () => conDirMensaje(dir => {
  const warnings = withCwd(dir, () => commitWarnings('git commit -F no_existe.txt'));

  assert.ok(!warnings.some(w => /COMMIT_/.test(w)), warnings.join('\n'));
}));

test('git commit -F - (stdin) -> sin aviso de mensaje', () => conDirMensaje(dir => {
  writeFile(path.join(dir, '-'), 'nope: no debe leerse\n');

  const warnings = withCwd(dir, () => commitWarnings('git commit -F -'));

  assert.ok(!warnings.some(w => /COMMIT_/.test(w)), warnings.join('\n'));
}));

test('git commit -F con un mensaje correcto -> sin avisos', () => conDirMensaje(dir => {
  writeFile(path.join(dir, 'msg.txt'),
    '\nfix: corrige el parseo de "campos" con comillas\r\n\r\nEl parser perdia el ultimo campo.\r\n');

  const warnings = withCwd(dir, () => commitWarnings('git commit -F msg.txt'));

  assert.deepStrictEqual(warnings, []);
}));

test('-F de otro programa en el mismo comando no se lee como mensaje del commit', () => conDirMensaje(dir => {
  writeFile(path.join(dir, 'msg.txt'), 'nope: no debe leerse\n');

  const warnings = withCwd(dir, () => commitWarnings('grep -F msg.txt x; git commit'));

  assert.deepStrictEqual(warnings, []);
}));

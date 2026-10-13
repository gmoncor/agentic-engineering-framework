'use strict';

// Los hooks reconocen los nombres reales de las herramientas de Gemini CLI 0.63.0:
// write_file, replace y run_shell_command. Un nombre que el hook no reconoce sale sin
// evaluarse, así que un matcher correcto en hooks/hooks.json no basta: el conjunto de nombres
// del propio hook también tiene que incluirlo.
//
// Forma de los payloads (BeforeTool de Gemini CLI):
//   - write_file:        tool_input.file_path y content. Capturada en vivo con gemini-cli 0.63.0.
//   - replace:           tool_input.file_path, old_string y new_string. Forma documentada, no
//                        capturada en vivo.
//   - run_shell_command: tool_input.command. Forma documentada, no capturada en vivo.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');

const evento = { hook_event_name: 'BeforeTool' };

const writeFileGemini = (filePath, content, session) => Object.assign({}, evento, {
  session_id: session,
  tool_name: 'write_file',
  tool_input: { file_path: filePath, content },
});

const replaceGemini = (filePath, session) => Object.assign({}, evento, {
  session_id: session,
  tool_name: 'replace',
  tool_input: { file_path: filePath, old_string: 'antes', new_string: 'despues' },
});

const shellGemini = (command, session) => Object.assign({}, evento, {
  session_id: session,
  tool_name: 'run_shell_command',
  tool_input: { command },
});

const readFileGemini = (filePath, session) => Object.assign({}, evento, {
  session_id: session,
  tool_name: 'read_file',
  tool_input: { file_path: filePath },
});

// --- sdd-pipeline-guard.js: replace es una herramienta de escritura ---

const SPEC_APROBADA = '# Spec: Login\n\n**Estado:** APROBADA\n';
const TASK = [
  '# Task 001: Login',
  '',
  'Spec madre: ai_docs/tasks/spec_login.md',
  '',
  '## Archivos afectados',
  '',
  '| Archivo | Accion | Descripcion del cambio |',
  '|---------|--------|----------------------|',
  '| `src/login.js` | MODIFICAR | Servicio de login |',
  '',
].join('\n');

function proyectoConPlan() {
  const root = tempDir('sdd-gemini-plan-');
  writeFile(path.join(root, 'ai_docs', 'tasks', 'spec_login.md'), SPEC_APROBADA);
  writeFile(path.join(root, 'ai_docs', 'tasks', '001_login.md'), TASK);
  return root;
}

test('pipeline-guard: replace sobre un fichero no declarado se bloquea', () => {
  const root = proyectoConPlan();
  const r = runHook('sdd-pipeline-guard.js', replaceGemini(path.join(root, 'src', 'otro.js')));

  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /\[SDD_PIPELINE_BLOCK\]/);
});

test('pipeline-guard: replace sobre un fichero declarado pasa', () => {
  const root = proyectoConPlan();
  const r = runHook('sdd-pipeline-guard.js', replaceGemini(path.join(root, 'src', 'login.js')));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

// --- sdd-commit-guard.js: run_shell_command es la herramienta de shell ---

test('commit-guard: run_shell_command con git commit --no-verify se deniega', () => {
  const r = runHook('sdd-commit-guard.js', shellGemini('git commit --no-verify -m "fix: algo"'));

  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /--no-verify/);
});

test('commit-guard: run_shell_command con ls pasa sin salida', () => {
  const r = runHook('sdd-commit-guard.js', shellGemini('ls'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), '');
});

// --- sdd-turn-budget.js: el commit por run_shell_command reinicia el contador ---

test('turn-budget: git commit por run_shell_command reinicia el contador', () => {
  const dir = tempDir('sdd-gemini-turnos-');
  const config = path.join(dir, 'config.json');
  writeFile(config, JSON.stringify({
    sdd_turn_budget: { enabled: true, mode: 'advisory', warn_at: 2, block_at: 3, hard_stop_at: 4 },
  }));
  const env = { SDD_CONFIG_PATH: config, SDD_TURNS_DIR: dir };
  const sesion = 'gemini-turnos';
  const accion = writeFileGemini(path.join(dir, 'x.js'), 'contenido', sesion);

  assert.strictEqual(runHook('sdd-turn-budget.js', accion, env).decision, null, 'primera acción: por debajo de warn_at');

  const commit = runHook('sdd-turn-budget.js', shellGemini('git commit -m "fix: algo"', sesion), env);
  assert.strictEqual(commit.code, 0);
  assert.strictEqual(commit.decision, null, 'el commit pasa sin decisión: no cuenta como acción');

  const tras = runHook('sdd-turn-budget.js', accion, env);
  assert.strictEqual(tras.decision, null, 'tras el reinicio, una acción vuelve a estar por debajo de warn_at');
});

// --- sdd-read-before-edit.js: replace es una escritura parcial ---

test('read-before-edit: replace sobre un fichero existente sin leer avisa', () => {
  const root = tempDir('sdd-gemini-lectura-');
  fs.mkdirSync(path.join(root, '.git'));
  const leido = path.join(root, 'leido.js');
  const sinLeer = path.join(root, 'sin_leer.js');
  writeFile(leido, 'antes\n');
  writeFile(sinLeer, 'antes\n');
  const env = { SDD_READS_DIR: tempDir('sdd-gemini-lecturas-') };
  const sesion = 'gemini-lectura-' + path.basename(root);

  // Una lectura previa acredita que este backend entrega el evento read_file.
  runHook('sdd-read-before-edit.js', readFileGemini(leido, sesion), env);
  const r = runHook('sdd-read-before-edit.js', replaceGemini(sinLeer, sesion), env);

  assert.strictEqual(r.code, 0);
  assert.match(r.stdout + r.stderr, /\[SDD_READ_EDIT_ADVISORY\]/);
});

'use strict';

// Contrato de sdd-pipeline-guard.js: que bloquea y que deja pasar.
// Los fixtures usan el formato REAL de specs y tasks (dev_templates/spec.md,
// dev_templates/tareas.md); si el formato cambia, estos tests lo detectan.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');

const HOOK = 'sdd-pipeline-guard.js';

const SPEC_APROBADA = [
  '# Spec: Autenticacion',
  '',
  '**Estado:** APROBADA',
  '',
  '## Criterios de aceptacion',
  '- El usuario puede iniciar sesion',
  '',
].join('\n');

const SPEC_BORRADOR = SPEC_APROBADA.replace('APROBADA', 'BORRADOR');

const TASK_CON_ARCHIVOS = [
  '# Task 001: Crear el servicio de login',
  '',
  'Spec madre: ai_docs/tasks/spec_autenticacion.md',
  '',
  '## Archivos afectados',
  '',
  '| Archivo | Accion | Descripcion del cambio |',
  '|---------|--------|----------------------|',
  '| `ruta/archivo.ext` | CREAR / MODIFICAR / ELIMINAR | [Que se hace en este archivo] |',
  '| `src/auth/login.js` | CREAR | Servicio de login |',
  '| `./src/auth/session.js` | MODIFICAR | Persistencia de sesion |',
  '',
  '## Plan de implementacion',
  '',
  '1. Escribir el servicio',
  '',
].join('\n');

function proyecto(specs, tasks) {
  const root = tempDir('sdd-pipeline-');
  const tasksDir = path.join(root, 'ai_docs', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [name, content] of Object.entries(specs)) writeFile(path.join(tasksDir, name), content);
  for (const [name, content] of Object.entries(tasks)) writeFile(path.join(tasksDir, name), content);
  return root;
}

function escritura(root, relPath) {
  return { tool_name: 'Write', tool_input: { file_path: path.join(root, relPath) } };
}

test('sin spec aprobada: deny', () => {
  const root = proyecto({}, {});
  const r = runHook(HOOK, escritura(root, 'src/auth/login.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /APROBADA/);
});

test('spec en BORRADOR (no aprobada): deny', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_BORRADOR }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escritura(root, 'src/auth/login.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /APROBADA/);
});

test('spec aprobada pero sin tasks derivadas: deny', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, {});
  const r = runHook(HOOK, escritura(root, 'src/auth/login.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /task derivada/);
});

test('spec aprobada + archivo declarado en una task: allow', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escritura(root, 'src/auth/login.js'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('archivo declarado con path relativo distinto (./src/...): allow', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escritura(root, 'src/auth/session.js'));

  assert.strictEqual(r.code, 0);
});

test('spec aprobada + archivo NO declarado en ninguna task: deny', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escritura(root, 'src/pagos/checkout.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /no esta declarado en ninguna task/);
});

test('el placeholder de la plantilla no cuenta como archivo declarado: deny', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escritura(root, 'ruta/archivo.ext'));

  assert.strictEqual(r.decision.decision, 'deny');
});

test('SDD_GUARD_SKIP=1: warn en vez de deny', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escritura(root, 'src/pagos/checkout.js'), { SDD_GUARD_SKIP: '1' });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
});

test('archivo en ai_docs/: siempre allow', () => {
  const root = proyecto({}, {});
  const r = runHook(HOOK, escritura(root, 'ai_docs/tasks/spec_nueva.md'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('proyecto sin ai_docs/tasks/: allow (no hay pipeline SDD que enforcar)', () => {
  const root = tempDir('sdd-sin-sdd-');
  const r = runHook(HOOK, escritura(root, 'src/index.js'));

  assert.strictEqual(r.code, 0);
});

test('tool que no escribe: allow', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, { tool_name: 'Read', tool_input: { file_path: path.join(root, 'src/pagos/checkout.js') } });

  assert.strictEqual(r.code, 0);
});

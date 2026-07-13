'use strict';

// Contrato de sdd-pipeline-guard-codex.js: que deniega y que deja pasar cuando la edicion llega
// como parche (apply_patch). Los fixtures usan el formato REAL de specs y tasks
// (dev_templates/spec.md, dev_templates/tareas.md); si el formato cambia, estos tests lo detectan.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');

const HOOK = 'sdd-pipeline-guard-codex.js';

const SPEC_APROBADA = [
  '# Spec: Autenticacion',
  '',
  '**Estado:** APROBADA',
  '',
  '## Criterios de aceptacion',
  '- El usuario puede iniciar sesion',
  '',
].join('\n');

const TASK_CON_ARCHIVOS = [
  '# Task 001: Crear el servicio de login',
  '',
  'Spec madre: ai_docs/tasks/spec_autenticacion.md',
  '',
  '## Archivos afectados',
  '',
  '| Archivo | Accion | Descripcion del cambio |',
  '|---------|--------|----------------------|',
  '| `src/auth/login.js` | CREAR | Servicio de login |',
  '| `src/auth/session.js` | MODIFICAR | Persistencia de sesion |',
  '',
].join('\n');

function proyecto(specs, tasks) {
  const root = tempDir('sdd-codex-pipeline-');
  const tasksDir = path.join(root, 'ai_docs', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  for (const [name, content] of Object.entries(specs)) writeFile(path.join(tasksDir, name), content);
  for (const [name, content] of Object.entries(tasks)) writeFile(path.join(tasksDir, name), content);
  return root;
}

/** Parche en el formato que emite apply_patch, con las rutas en sus cabeceras. */
function parche(root, ...relPaths) {
  const cuerpo = relPaths
    .map(rel => `*** Update File: ${path.join(root, rel)}\n@@\n-viejo\n+nuevo`)
    .join('\n');
  return {
    tool_name: 'apply_patch',
    tool_input: { input: `*** Begin Patch\n${cuerpo}\n*** End Patch` },
  };
}

const conSpec = () => proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });

test('sin spec aprobada: deny', () => {
  const root = proyecto({}, {});
  const r = runHook(HOOK, parche(root, 'src/auth/login.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /APROBADA/);
});

test('spec aprobada + archivo declarado en una task: allow', () => {
  const root = conSpec();
  const r = runHook(HOOK, parche(root, 'src/auth/login.js'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('spec aprobada + archivo NO declarado: deny', () => {
  const root = conSpec();
  const r = runHook(HOOK, parche(root, 'src/pagos/checkout.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /no esta declarado en ninguna task/);
});

test('parche con varios archivos y uno no declarado: deny (no se aplican parches a medias)', () => {
  const root = conSpec();
  const r = runHook(HOOK, parche(root, 'src/auth/login.js', 'src/pagos/checkout.js'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /checkout\.js/);
});

test('payload con file_path directo: se evalua igual que el parche', () => {
  const root = conSpec();
  const r = runHook(HOOK, {
    tool_name: 'apply_patch',
    tool_input: { file_path: path.join(root, 'src/pagos/checkout.js') },
  });

  assert.strictEqual(r.decision.decision, 'deny');
});

test('payload con mapa de cambios: se evalua igual que el parche', () => {
  const root = conSpec();
  const r = runHook(HOOK, {
    tool_name: 'apply_patch',
    tool_input: { changes: { [path.join(root, 'src/auth/login.js')]: { update: true } } },
  });

  assert.strictEqual(r.code, 0);
});

test('SDD_GUARD_SKIP=1: warn en vez de deny', () => {
  const root = conSpec();
  const r = runHook(HOOK, parche(root, 'src/pagos/checkout.js'), { SDD_GUARD_SKIP: '1' });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
});

test('payload sin ninguna ruta legible: warn, no deny (el gap se declara, no se adivina)', () => {
  const r = runHook(HOOK, { tool_name: 'apply_patch', tool_input: { input: 'parche sin cabeceras' } });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /no expone ninguna ruta/);
});

test('parche sobre ai_docs/: siempre allow (planificar es escribir docs)', () => {
  const root = conSpec();
  const r = runHook(HOOK, parche(root, 'ai_docs/tasks/spec_nueva.md'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('proyecto sin ai_docs/tasks/: allow (no hay pipeline SDD que enforcar)', () => {
  const root = tempDir('sdd-codex-sin-sdd-');
  const r = runHook(HOOK, parche(root, 'src/index.js'));

  assert.strictEqual(r.code, 0);
});

test('tool que no aplica parches: allow', () => {
  const root = conSpec();
  const r = runHook(HOOK, {
    tool_name: 'shell',
    tool_input: { command: 'rm -rf src/auth/login.js' },
  });

  assert.strictEqual(r.code, 0);
});

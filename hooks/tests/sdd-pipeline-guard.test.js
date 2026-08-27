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

test('los archivos de una task de otra spec, ya cerrada, no autorizan la escritura', () => {
  // El permiso de escritura se acota a la spec activa. Si se acumulase con el
  // historial, el guard acabaria autorizando cualquier archivo que alguna task
  // vieja declarase alguna vez, y dejaria de proteger.
  const TASK_VIEJA = [
    '# Task 900: Migrar el catalogo (spec ya cerrada)',
    '',
    'Spec madre: ai_docs/tasks/spec_catalogo.md',
    '',
    '## Archivos afectados',
    '',
    '| Archivo | Accion | Descripcion del cambio |',
    '|---------|--------|----------------------|',
    '| `src/catalogo/legacy.js` | MODIFICAR | Migracion del catalogo |',
    '',
  ].join('\n');

  const root = proyecto(
    { 'spec_autenticacion.md': SPEC_APROBADA, 'spec_catalogo.md': SPEC_BORRADOR.replace('Autenticacion', 'Catalogo') },
    { '001_login.md': TASK_CON_ARCHIVOS, '900_catalogo.md': TASK_VIEJA }
  );

  const viejo = runHook(HOOK, escritura(root, 'src/catalogo/legacy.js'));
  assert.strictEqual(viejo.decision.decision, 'deny');
  assert.match(viejo.decision.reason, /no esta declarado en ninguna task de la spec activa/);

  // La task de la spec activa sigue autorizando lo suyo.
  assert.strictEqual(runHook(HOOK, escritura(root, 'src/auth/login.js')).code, 0);
});

// --- Vinculacion task -> spec: limite de palabra, no subcadena libre --------------------------
// La spec se cita por su descriptor ("auth", derivado de spec_auth.md). Una task que solo
// menciona ese texto como parte de otra palabra (p.ej. "authentication") no debe quedar
// vinculada a la spec: si lo hiciera, sus archivos declarados se autorizarian como si
// perteneciesen a la spec activa, sin que la task los citase realmente.

const SPEC_AUTH = [
  '# Spec: Auth',
  '',
  '**Estado:** APROBADA',
  '',
  '## Criterios de aceptacion',
  '- El usuario puede autenticarse',
  '',
].join('\n');

const TASK_MENCION_CASUAL = [
  '# Task 002: Procesar pagos',
  '',
  'Este modulo se integra con un proveedor de authentication externo.',
  '',
  '## Archivos afectados',
  '',
  '| Archivo | Accion | Descripcion del cambio |',
  '|---------|--------|----------------------|',
  '| `src/pagos/checkout.js` | CREAR | Servicio de pagos |',
  '',
].join('\n');

const TASK_REFERENCIA_EXPLICITA = [
  '# Task 001: Crear el servicio de login',
  '',
  'Spec madre: ai_docs/tasks/spec_auth.md',
  '',
  '## Archivos afectados',
  '',
  '| Archivo | Accion | Descripcion del cambio |',
  '|---------|--------|----------------------|',
  '| `src/auth/login.js` | CREAR | Servicio de login |',
  '',
].join('\n');

test('mencion casual del descriptor de la spec dentro de otra palabra no vincula la task (falso positivo)', () => {
  const root = proyecto({ 'spec_auth.md': SPEC_AUTH }, { '002_pagos.md': TASK_MENCION_CASUAL });
  const r = runHook(HOOK, escritura(root, 'src/pagos/checkout.js'));

  // "authentication" contiene "auth" como subcadena, pero no lo cita como palabra completa: la
  // task no queda vinculada a la spec y, al ser la unica task del proyecto, no hay ninguna
  // task derivada de la spec activa.
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /task derivada/);
});

test('referencia explicita "Spec madre:" vincula la task y autoriza sus archivos declarados', () => {
  const root = proyecto({ 'spec_auth.md': SPEC_AUTH }, { '001_login.md': TASK_REFERENCIA_EXPLICITA });
  const r = runHook(HOOK, escritura(root, 'src/auth/login.js'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('una task vinculada no presta autorizacion a otra task que solo menciona la spec como subcadena de otra palabra', () => {
  // Reproduce el escenario original: spec_auth aprobada, una task realmente vinculada
  // (001_login.md) y una task no relacionada que solo menciona "auth" dentro de
  // "authentication" (002_pagos.md). Antes del fix, el match por subcadena vinculaba tambien
  // a 002_pagos.md y autorizaba src/pagos/checkout.js sin que la task lo citase de verdad.
  const root = proyecto(
    { 'spec_auth.md': SPEC_AUTH },
    { '001_login.md': TASK_REFERENCIA_EXPLICITA, '002_pagos.md': TASK_MENCION_CASUAL }
  );

  const vinculada = runHook(HOOK, escritura(root, 'src/auth/login.js'));
  assert.strictEqual(vinculada.code, 0);

  const noVinculada = runHook(HOOK, escritura(root, 'src/pagos/checkout.js'));
  assert.strictEqual(noVinculada.decision.decision, 'deny');
  assert.strictEqual(noVinculada.code, 2);
  assert.match(noVinculada.decision.reason, /no esta declarado en ninguna task de la spec activa/);
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

// --- Contrato de NotebookEdit (Claude Code) -----------------------------------------------------
// La ruta del cuaderno llega en tool_input.notebook_path, no en file_path: es una herramienta de
// escritura distinta de Write/Edit y necesita su propio caso, con control positivo y negativo.

function escrituraNotebook(root, relPath) {
  return { tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(root, relPath) } };
}

test('NotebookEdit: cuaderno NO declarado en ninguna task: deny', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escrituraNotebook(root, 'src/no_declarado.ipynb'));

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /no esta declarado en ninguna task/);
});

test('NotebookEdit: cuaderno SI declarado en la tabla de la task: allow', () => {
  const TASK_CON_NOTEBOOK = TASK_CON_ARCHIVOS.replace(
    '| `src/auth/login.js` | CREAR | Servicio de login |\n',
    '| `src/auth/login.js` | CREAR | Servicio de login |\n'
      + '| `src/auth/analisis.ipynb` | CREAR | Cuaderno de analisis |\n'
  );
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_NOTEBOOK });
  const r = runHook(HOOK, escrituraNotebook(root, 'src/auth/analisis.ipynb'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('NotebookEdit: cuaderno bajo ai_docs/: siempre allow', () => {
  const root = proyecto({}, {});
  const r = runHook(HOOK, escrituraNotebook(root, 'ai_docs/tasks/notas.ipynb'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

// --- Contrato de Antigravity CLI ---------------------------------------------------------------
// Su payload es distinto: la llamada llega en toolCall {name, args} (camelCase) y la ruta del
// archivo en args.TargetFile. La decision viaja SOLO por stdout: su contrato no incluye el codigo
// de salida, asi que aqui el guard sale con 0 tanto si permite como si deniega.

const ESCRITURA_AGY = ['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file'];

function escrituraAgy(root, relPath, tool) {
  return { toolCall: { name: tool || 'write_to_file', args: { TargetFile: path.join(root, relPath) } } };
}

for (const tool of ESCRITURA_AGY) {
  test(`${tool}: archivo NO declarado -> deny sin apoyarse en el codigo de salida`, () => {
    const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
    const r = runHook(HOOK, escrituraAgy(root, 'src/pagos/checkout.js', tool));

    assert.strictEqual(r.decision.decision, 'deny');
    assert.strictEqual(r.code, 0);
    assert.match(r.decision.reason, /no esta declarado en ninguna task/);
  });
}

test('write_to_file: archivo declarado en una task: allow', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escrituraAgy(root, 'src/auth/login.js'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('write_to_file sobre ai_docs/: siempre allow (planificar es escribir docs)', () => {
  const root = proyecto({}, {});
  const r = runHook(HOOK, escrituraAgy(root, 'ai_docs/tasks/spec_nueva.md'));

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('SDD_GUARD_SKIP=1: allow con motivo (Antigravity no admite "warn" como decision)', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, escrituraAgy(root, 'src/pagos/checkout.js'), { SDD_GUARD_SKIP: '1' });

  assert.strictEqual(r.decision.decision, 'allow');
  assert.strictEqual(r.code, 0);
});

test('escritura sin TargetFile: allow con motivo, el hueco se declara y no se deniega a ciegas', () => {
  const r = runHook(HOOK, { toolCall: { name: 'write_to_file', args: {} } });

  assert.strictEqual(r.decision.decision, 'allow');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /no expone ninguna ruta/);
});

test('tool de Antigravity que no escribe: allow', () => {
  const root = proyecto({ 'spec_autenticacion.md': SPEC_APROBADA }, { '001_login.md': TASK_CON_ARCHIVOS });
  const r = runHook(HOOK, { toolCall: { name: 'view_file', args: { TargetFile: path.join(root, 'src/pagos/checkout.js') } } });

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

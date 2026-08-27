'use strict';

// Contrato de autorizacion de hooks/sdd-plan-state.js: los cuatro predicados que deciden si una
// escritura queda respaldada por el plan, en los cuatro backends a la vez.
//
// LOS DEFECTOS QUE CIERRAN
//   F1 (isInsideAiDocs) miraba si "ai_docs" aparecia en CUALQUIER tramo de la ruta ABSOLUTA. Un
//   proyecto instalado bajo un ancestro llamado literalmente "ai_docs" (el patron de instalacion
//   "ai_docs/frameworks/<framework>") apagaba el guard entero: cualquier escritura, en cualquier
//   fichero, se leia como documentacion.
//   F2 (findActiveTaskFiles) vinculaba una task a la spec aprobada si el texto del documento
//   CONTENIA, en cualquier parte y con cualquier proposito, alguna palabra del descriptor de la
//   spec. Una mencion de pasada en prosa bastaba para autorizar todos los archivos que la task
//   declarase.
//   F3 (findApprovedSpecs) clasificaba una spec como aprobada por la PRESENCIA del patron
//   "Estado: APROBADA" en cualquier parte del documento, no por su estado VIGENTE: una entrada de
//   historial contaba igual que el campo actual.
//
// COMO SE ACREDITAN
// Cada caso trae su control: el mismo fixture con el dato que SI debe autorizar/reconocer, para
// que el fix no sea indistinguible de "denegar siempre" ni de "bloquear siempre".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, writeFile } = require('./helpers');
const {
  isInsideAiDocs, resolveRepoPath, denialReason, findApprovedSpecs,
} = require('../sdd-plan-state');

// ─── F1: ai_docs como primer tramo relativo a la raiz, no como tramo cualquiera ──────────────

test('F1: un ancestro literalmente llamado ai_docs por encima de la raiz del repo no apaga el guard', () => {
  const base = tempDir('sdd-f1-ancestro-');
  const raiz = path.join(base, 'ai_docs', 'frameworks', 'proyecto');
  fs.mkdirSync(path.join(raiz, '.git'), { recursive: true });

  assert.strictEqual(
    isInsideAiDocs(resolveRepoPath('src/foo.js', raiz)),
    false,
    'un fichero de codigo fuente del propio proyecto no debe leerse como documentacion solo '
    + 'porque un directorio ancestro se llame ai_docs',
  );
});

test('F1 (control): ai_docs/ del propio proyecto sigue exento aunque la raiz cuelgue de un ancestro ai_docs', () => {
  const base = tempDir('sdd-f1-control-');
  const raiz = path.join(base, 'ai_docs', 'frameworks', 'proyecto');
  fs.mkdirSync(path.join(raiz, '.git'), { recursive: true });

  assert.strictEqual(
    isInsideAiDocs(resolveRepoPath('ai_docs/tasks/spec_x.md', raiz)),
    true,
    'sin este control, "arreglar" F1 podria empezar a bloquear la escritura de documentacion, '
    + 'que es justo lo que la funcion protege',
  );
});

// ─── F2: vinculacion task-spec por el campo "Spec madre", no por texto libre ─────────────────

function proyectoConSpecYTask(specContenido, taskContenido) {
  const root = tempDir('sdd-f2-');
  const tasksDir = path.join(root, 'ai_docs', 'tasks');
  writeFile(path.join(tasksDir, 'spec_auth.md'), specContenido);
  writeFile(path.join(tasksDir, '001_task.md'), taskContenido);
  return { root, tasksDir };
}

const SPEC_AUTH_APROBADA = '# Spec: Auth\n\n**Estado:** APROBADA\n';

test('F2: una mencion en prosa (sin campo Spec madre) deja de autorizar el archivo declarado', () => {
  const task = [
    '# Task 001',
    '',
    'Requiere auth para el panel.',
    '',
    '## Archivos afectados',
    '',
    '| Archivo | Accion | Descripcion |',
    '|---------|--------|-------------|',
    '| `src/backdoor.js` | CREAR | acceso |',
    '',
  ].join('\n');
  const { tasksDir } = proyectoConSpecYTask(SPEC_AUTH_APROBADA, task);

  const motivo = denialReason(tasksDir, path.join(tasksDir, '..', '..', 'src', 'backdoor.js'));
  assert.notStrictEqual(motivo, null, 'una task que solo menciona la spec en prosa no debe autorizar sus archivos');
});

test('F2 (control): "Spec madre: spec_auth.md" explicito si autoriza el archivo declarado', () => {
  const task = [
    '# Task 001',
    '',
    'Spec madre: spec_auth.md',
    '',
    '## Archivos afectados',
    '',
    '| Archivo | Accion | Descripcion |',
    '|---------|--------|-------------|',
    '| `src/backdoor.js` | CREAR | acceso |',
    '',
  ].join('\n');
  const { tasksDir } = proyectoConSpecYTask(SPEC_AUTH_APROBADA, task);

  const motivo = denialReason(tasksDir, path.join(tasksDir, '..', '..', 'src', 'backdoor.js'));
  assert.strictEqual(motivo, null, 'la cita explicita del campo Spec madre debe seguir autorizando');
});

// ─── F3: spec aprobada por su Estado VIGENTE, no por presencia del patron en el historial ────

test('F3: una spec con historial de APROBADA pero Estado vigente RECHAZADA no cuenta como aprobada', () => {
  const spec = [
    '# Spec: Pagos',
    '',
    '## Historial',
    '2026-01-01: Estado: APROBADA',
    '',
    '**Estado:** RECHAZADA',
    '',
  ].join('\n');
  const tasksDir = path.join(tempDir('sdd-f3-'), 'ai_docs', 'tasks');
  writeFile(path.join(tasksDir, 'spec_pagos.md'), spec);

  const aprobadas = findApprovedSpecs(tasksDir);
  assert.strictEqual(aprobadas.length, 0,
    'el estado vigente (el ultimo campo Estado) es RECHAZADA; la mencion de historial no cuenta');
});

test('F3 (control): una spec con Estado vigente APROBADA si cuenta como aprobada', () => {
  const tasksDir = path.join(tempDir('sdd-f3-control-'), 'ai_docs', 'tasks');
  writeFile(path.join(tasksDir, 'spec_pagos.md'), SPEC_AUTH_APROBADA);

  const aprobadas = findApprovedSpecs(tasksDir);
  assert.strictEqual(aprobadas.length, 1);
});

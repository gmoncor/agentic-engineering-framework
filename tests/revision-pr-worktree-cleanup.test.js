'use strict';

// Canary del paso opcional de limpieza de worktree/rama en la plantilla de PR
// comun a los 4 backends.
//
// Quien aisla una spec en un worktree dedicado (ver la nota de
// implementar-spec.md) necesita un recordatorio, al cerrar la PR, de eliminar
// ese worktree y borrar la rama local para no acumular arboles y ramas
// huerfanas. El paso es opcional (no aplica si no se uso worktree) y debe
// quedar redactado sin depender de ningun backend concreto.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function leerPlantillaPr() {
  return fs.readFileSync(path.join(RAIZ, 'ai_docs/dev_templates/revision_pr.md'), 'utf8');
}

test('la plantilla de PR incluye el comando para eliminar el worktree', () => {
  const contenido = leerPlantillaPr();

  assert.match(contenido, /git worktree remove/, 'no incluye el comando de limpieza del worktree');
});

test('el paso de limpieza esta marcado como opcional', () => {
  const contenido = leerPlantillaPr();

  assert.match(contenido, /opcional/i, 'no marca el paso como opcional');
});

test('el paso de limpieza usa "git branch -d" (no "-D") para proteger ramas no mergeadas', () => {
  const contenido = leerPlantillaPr();

  assert.match(contenido, /git branch -d /, 'no usa -d para borrar la rama local');
  assert.doesNotMatch(contenido, /git branch -D/, 'usa -D, que fuerza el borrado de ramas no mergeadas');
});

test('el paso de limpieza lista primero el worktree y despues la rama, en pasos separados', () => {
  const contenido = leerPlantillaPr();
  const indiceWorktree = contenido.indexOf('git worktree remove');
  const indiceRama = contenido.indexOf('git branch -d ');

  assert.ok(indiceWorktree !== -1, 'no encuentra el paso de worktree');
  assert.ok(indiceRama !== -1, 'no encuentra el paso de rama');
  assert.ok(indiceWorktree < indiceRama, 'el paso de worktree debe listarse antes que el de la rama');
});

test('la plantilla de PR sigue siendo agnostica de backend en la nota de limpieza', () => {
  const contenido = leerPlantillaPr();

  assert.doesNotMatch(
    contenido,
    /\.claude\/workflows|motor de workflows/i,
    'la nota de limpieza no debe mencionar mecanismos especificos de un backend'
  );
});

test('la nota de limpieza es autocontenida: no remite a documentacion externa para entender los pasos', () => {
  const contenido = leerPlantillaPr();
  const inicio = contenido.indexOf('### Paso 6: Limpieza de worktree y rama');
  const fin = contenido.indexOf('---', inicio);
  const seccion = contenido.slice(inicio, fin === -1 ? undefined : fin);

  assert.ok(inicio !== -1, 'no encuentra la seccion de limpieza');
  assert.doesNotMatch(seccion, /ver [`"]?ai_docs|ver [`"]?\.claude|documentacion externa/i);
});

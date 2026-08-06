'use strict';

// Canary de la nota de worktree dedicado en el backend Claude Code.
//
// El patron es opcional: un usuario que aisla una spec en un worktree antes de
// lanzar /implementar-spec debe encontrar como hacerlo documentado, marcado
// como no obligatorio, y sin que el backend Gemini (que no tiene el motor de
// workflow que aprovecha este patron) herede la misma nota por error.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function leer(rutaRelativa) {
  return fs.readFileSync(path.join(RAIZ, rutaRelativa), 'utf8');
}

test('implementar-spec.md (Claude Code) documenta el aislamiento por worktree', () => {
  const contenido = leer('.claude/commands/implementar-spec.md');

  assert.match(contenido, /worktree/i, 'no menciona worktree');
  assert.match(contenido, /opcional|avanzado/i, 'no marca la nota como opcional/avanzada');
});

test('la nota de worktree exige el paso "cd" hacia el nuevo directorio', () => {
  const contenido = leer('.claude/commands/implementar-spec.md');

  // Un worktree creado pero nunca habitado (sin cd) deja al usuario trabajando
  // sobre la rama principal por error: el paso cd no es opcional dentro del bloque.
  assert.match(contenido, /cd \.\.\/spec-/, 'el bloque de comandos no incluye el cd al worktree creado');
});

test('la nota de worktree crea la rama con -b para evitar colision con una existente', () => {
  const contenido = leer('.claude/commands/implementar-spec.md');

  assert.match(contenido, /git worktree add -b/, 'no usa -b para crear la rama del worktree');
});

test('la nota de worktree referencia la plantilla de revision de PR para la limpieza, sin duplicarla', () => {
  const contenido = leer('.claude/commands/implementar-spec.md');

  assert.match(contenido, /plantilla de revision de PR/i, 'no referencia la limpieza del worktree tras el merge');
});

test('implementar-spec.toml (backend Gemini) no incluye la nota de worktree', () => {
  const contenido = leer('.gemini/commands/implementar-spec.toml');

  assert.doesNotMatch(contenido, /worktree/i);
});

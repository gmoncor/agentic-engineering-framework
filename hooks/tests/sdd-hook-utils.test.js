'use strict';

// Contrato de readPayload() en hooks/sdd-hook-utils.js: lee stdin hasta EOF y
// parsea JSON. Si el harness nunca cierra stdin (pipe bloqueado, antivirus,
// comportamiento anomalo de alguno de los backends soportados) la lectura no
// debe colgar el proceso: debe degradarse a null igual que un payload con
// JSON invalido. Estos tests sustituyen process.stdin por dobles controlados
// en lugar de spawnear el hook como proceso (asi se evita depender de que un
// pipe real se quede abierto de verdad, algo que node --test no ofrece).
//
// node --test aisla cada fichero en un proceso separado, asi que sobrescribir
// process.stdin aqui no afecta a otros ficheros de test.

const test = require('node:test');
const assert = require('node:assert');
const { readPayload } = require('../sdd-hook-utils');

const originalStdin = process.stdin;

function stubStdin(asyncIterator) {
  Object.defineProperty(process, 'stdin', {
    value: { [Symbol.asyncIterator]: asyncIterator },
    configurable: true,
  });
}

function restoreStdin() {
  Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
}

// Async iterable que emite los chunks dados y luego cierra (EOF normal).
function closingStdin(chunks) {
  return async function* () {
    for (const chunk of chunks) yield chunk;
  };
}

// Async iterable que nunca resuelve su siguiente valor: simula un pipe que
// jamas envia EOF.
function hangingStdin() {
  return async function* () {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise(() => {}); // nunca se resuelve
      yield ''; // inalcanzable, pero mantiene la forma de generador
    }
  };
}

test('stdin llega completo y valido -> devuelve el objeto parseado', async () => {
  stubStdin(closingStdin(['{"tool_name":', '"Read"}']));
  try {
    const data = await readPayload();
    assert.deepStrictEqual(data, { tool_name: 'Read' });
  } finally {
    restoreStdin();
  }
});

test('stdin nunca cierra -> resuelve a null tras el timeout, en tiempo acotado', async () => {
  stubStdin(hangingStdin());
  try {
    const start = Date.now();
    const data = await readPayload(50); // timeout corto para no ralentizar la suite
    const elapsed = Date.now() - start;
    assert.strictEqual(data, null);
    assert.ok(elapsed < 2000, `readPayload() debe resolver en tiempo acotado, tardo ${elapsed}ms`);
  } finally {
    restoreStdin();
  }
});

test('stdin llega con JSON invalido -> resuelve a null sin esperar al timeout', async () => {
  stubStdin(closingStdin(['no es json {']));
  try {
    const start = Date.now();
    const data = await readPayload(5000);
    const elapsed = Date.now() - start;
    assert.strictEqual(data, null);
    assert.ok(elapsed < 1000, `JSON invalido no debe esperar al timeout, tardo ${elapsed}ms`);
  } finally {
    restoreStdin();
  }
});

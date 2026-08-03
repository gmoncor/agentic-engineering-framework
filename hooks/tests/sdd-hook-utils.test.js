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
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPayload, warn, deny, loadConfig } = require('../sdd-hook-utils');

const originalStdin = process.stdin;

// warn()/deny() escriben a stdout con fs.writeSync y terminan con process.exit;
// se interceptan ambos para capturar el payload emitido sin matar el proceso
// de test ni depender de spawnear el hook completo.
function captureEmit(fn) {
  const originalWriteSync = fs.writeSync;
  const originalExit = process.exit;
  let stdout = '';
  let exitCode;
  fs.writeSync = (fd, chunk) => {
    if (fd === 1) stdout += chunk;
    return chunk.length;
  };
  process.exit = (code) => {
    exitCode = code;
    throw { __stopEmit: true }; // corta la ejecucion igual que exit() real, sin matar el proceso
  };
  try {
    fn();
  } catch (err) {
    if (!err || !err.__stopEmit) throw err;
  } finally {
    fs.writeSync = originalWriteSync;
    process.exit = originalExit;
  }
  return { payload: JSON.parse(stdout.trim()), exitCode };
}

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

test('warn() con code -> el payload emitido incluye el campo code', () => {
  const { payload } = captureEmit(() => warn('motivo', null, 'ALGO_PASO'));
  assert.strictEqual(payload.decision, 'warn');
  assert.strictEqual(payload.reason, 'motivo');
  assert.strictEqual(payload.code, 'ALGO_PASO');
});

test('warn() sin code -> el payload emitido no incluye el campo code (retrocompatible)', () => {
  const { payload } = captureEmit(() => warn('motivo', null));
  assert.strictEqual(payload.decision, 'warn');
  assert.strictEqual(payload.reason, 'motivo');
  assert.strictEqual('code' in payload, false);
});

test('deny() con code -> el campo code aparece en la raiz y en hookSpecificOutput', () => {
  const { payload, exitCode } = captureEmit(() => deny('motivo', null, 'ALGO_MAL'));
  assert.strictEqual(payload.decision, 'deny');
  assert.strictEqual(payload.code, 'ALGO_MAL');
  assert.strictEqual(payload.hookSpecificOutput.code, 'ALGO_MAL');
  assert.strictEqual(exitCode, 2);
});

test('deny() sin code -> ni la raiz ni hookSpecificOutput incluyen code (retrocompatible)', () => {
  const { payload } = captureEmit(() => deny('motivo', null));
  assert.strictEqual(payload.decision, 'deny');
  assert.strictEqual('code' in payload, false);
  assert.strictEqual('code' in payload.hookSpecificOutput, false);
});

// loadConfig() no llama process.exit(): solo hace falta interceptar fs.writeSync
// para capturar (o comprobar la ausencia de) el aviso a stderr.
function withCapturedStderr(fn) {
  const originalWriteSync = fs.writeSync;
  let stderr = '';
  fs.writeSync = (fd, chunk) => {
    if (fd === 2) stderr += chunk;
    return chunk.length;
  };
  try {
    const result = fn();
    return { result, stderr };
  } finally {
    fs.writeSync = originalWriteSync;
  }
}

test('loadConfig() con JSON malformado -> retorna {} y avisa a stderr', () => {
  const tmpFile = path.join(os.tmpdir(), 'sdd-hook-utils-test-malformed-' + process.pid + '.json');
  fs.writeFileSync(tmpFile, '{enabled: true}');
  try {
    const { result, stderr } = withCapturedStderr(() => loadConfig(tmpFile));
    assert.deepStrictEqual(result, {});
    assert.notStrictEqual(stderr, '');
    assert.ok(stderr.includes(tmpFile), 'el aviso debe nombrar el archivo');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('loadConfig() con archivo ausente -> retorna {} sin avisar a stderr', () => {
  const missingFile = path.join(os.tmpdir(), 'sdd-hook-utils-test-missing-' + process.pid + '.json');
  const { result, stderr } = withCapturedStderr(() => loadConfig(missingFile));
  assert.deepStrictEqual(result, {});
  assert.strictEqual(stderr, '');
});

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
const { readPayload, warn, deny, loadConfig, purgeExpired, sessionStatePath } = require('../sdd-hook-utils');

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
//
// La espera se apoya en un temporizador ref'd, no en una promesa suelta: un descriptor de stdin
// abierto de verdad mantiene vivo el bucle de eventos mientras aguarda datos, y el doble debe
// reproducir eso. Con una promesa que nadie retiene, el doble modelaria un stdin que ni entrega
// datos ni sostiene el proceso — algo que ningun descriptor real hace — y la carrera de
// readPayload() se decidiria por el vaciado del bucle en lugar de por su timeout.
//
// El temporizador se registra para desarmarlo al acabar el test: la lectura pierde la carrera y su
// generador queda suspendido para siempre, asi que nadie mas lo limpiaria. Su plazo es ademas muy
// superior al timeout bajo prueba, para que sea siempre el timeout quien gane.
const temporizadoresDelDoble = [];

function hangingStdin() {
  return async function* () {
    await new Promise((resolve) => { temporizadoresDelDoble.push(setTimeout(resolve, 5000)); });
    yield ''; // inalcanzable dentro del horizonte del test, mantiene la forma de generador
  };
}

function clearHangingStdin() {
  while (temporizadoresDelDoble.length) clearTimeout(temporizadoresDelDoble.pop());
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
    clearHangingStdin();
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

test('readPayload() con Node < 20 -> emite aviso de version a stderr', async () => {
  // checkNodeVersion() solo avisa una vez por proceso (flag de modulo). Se
  // recarga el modulo para que el flag arranque en false sin depender del
  // orden en que corran los demas tests de este fichero.
  const rutaModulo = require.resolve('../sdd-hook-utils');
  delete require.cache[rutaModulo];
  const modulo = require(rutaModulo);

  // process.versions.node no es writable (asignacion directa lanza en modo
  // estricto): se redefine la propiedad para simular una version antigua.
  const versionOriginal = process.versions.node;
  Object.defineProperty(process.versions, 'node', { value: '18.0.0', configurable: true });
  const originalWriteSync = fs.writeSync;
  let stderr = '';
  fs.writeSync = (fd, chunk) => {
    if (fd === 2) stderr += chunk;
    return chunk.length;
  };
  stubStdin(closingStdin(['{}']));
  try {
    await modulo.readPayload();
    assert.match(stderr, /Node 18\.0\.0 detectado/);
    assert.match(stderr, /Node >= 20/);
  } finally {
    fs.writeSync = originalWriteSync;
    Object.defineProperty(process.versions, 'node', { value: versionOriginal, configurable: true });
    restoreStdin();
    delete require.cache[rutaModulo];
  }
});

// purgeExpired(dir, prefix, currentFile, ttlMs): purga oportunista de ficheros
// de estado por sesion (sdd-turns-*.json, sdd-reads-*.json) usada por
// sdd-turn-budget.js y sdd-read-tracker.js al escribir el estado de la sesion
// actual.
function tempPurgeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-purge-'));
}

function conMtime(file, msAtras) {
  const t = (Date.now() - msAtras) / 1000;
  fs.utimesSync(file, t, t);
}

test('purgeExpired: elimina ficheros con el prefijo dado cuyo mtime supera el TTL', () => {
  const dir = tempPurgeDir();
  const viejo = path.join(dir, 'sdd-turns-vieja.json');
  fs.writeFileSync(viejo, '{}');
  conMtime(viejo, 25 * 60 * 60 * 1000); // 25h: supera un TTL de 24h
  try {
    purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), 24 * 60 * 60 * 1000);
    assert.strictEqual(fs.existsSync(viejo), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purgeExpired: NO elimina ficheros dentro del TTL', () => {
  const dir = tempPurgeDir();
  const reciente = path.join(dir, 'sdd-turns-reciente.json');
  fs.writeFileSync(reciente, '{}');
  conMtime(reciente, 60 * 60 * 1000); // 1h: dentro de un TTL de 24h
  try {
    purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), 24 * 60 * 60 * 1000);
    assert.strictEqual(fs.existsSync(reciente), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Estos dos tests fijan Date.now() en vez de dejar pasar tiempo real entre el
// setup y la llamada: leen el mtime real (sin tocarlo con utimesSync, para no
// depender de la resolucion de conversion seg<->ms del filesystem) y calculan
// "ahora" a partir de el, de forma que la diferencia sea exactamente ttlMs (o
// ttlMs + 1ms). Con tiempo real, cualquier margen de ejecucion entre el setup
// y la purga desplazaria el borde y volveria el test inestable.
test('purgeExpired: diff === ttlMs exacto -> NO se purga (solo estrictamente superior)', () => {
  const dir = tempPurgeDir();
  const borde = path.join(dir, 'sdd-turns-borde.json');
  fs.writeFileSync(borde, '{}');
  const ttl = 24 * 60 * 60 * 1000;
  const mtimeMs = fs.statSync(borde).mtimeMs;
  const originalNow = Date.now;
  Date.now = () => mtimeMs + ttl;
  try {
    purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), ttl);
    assert.strictEqual(fs.existsSync(borde), true, 'diff === ttlMs no debe purgarse, solo lo estrictamente mayor');
  } finally {
    Date.now = originalNow;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// sessionStatePath(dir, prefix, sessionId, extension): nombre del fichero de
// estado por sesion, compartido por sdd-turn-budget.js y sdd-read-tracker.js
// (unica fuente de la sanitizacion del identificador de sesion; ver task
// s12/06). Sustituye la sanitizacion duplicada en cada hook.
test('sessionStatePath: identificador ya seguro conserva el nombre de hoy', () => {
  const ruta = sessionStatePath('/tmp', 'sdd-reads-', 'sesion-actual', '.jsonl');
  assert.strictEqual(ruta, path.join('/tmp', 'sdd-reads-sesion-actual.jsonl'));
});

test('sessionStatePath: identificadores que solo difieren en el separador producen rutas distintas', () => {
  const a = sessionStatePath('/tmp', 'sdd-reads-', 'abc def', '.jsonl');
  const b = sessionStatePath('/tmp', 'sdd-reads-', 'abc.def', '.jsonl');
  const c = sessionStatePath('/tmp', 'sdd-reads-', 'abc/def', '.jsonl');
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(b, c);
  assert.notStrictEqual(a, c);
});

test('sessionStatePath: el mismo identificador produce siempre la misma ruta', () => {
  const uno = sessionStatePath('/tmp', 'sdd-reads-', 'abc def', '.jsonl');
  const dos = sessionStatePath('/tmp', 'sdd-reads-', 'abc def', '.jsonl');
  assert.strictEqual(uno, dos);
});

test('purgeExpired: diff === ttlMs + 1ms -> SI se purga', () => {
  const dir = tempPurgeDir();
  const pasado = path.join(dir, 'sdd-turns-pasado.json');
  fs.writeFileSync(pasado, '{}');
  const ttl = 24 * 60 * 60 * 1000;
  const mtimeMs = fs.statSync(pasado).mtimeMs;
  const originalNow = Date.now;
  Date.now = () => mtimeMs + ttl + 1;
  try {
    purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), ttl);
    assert.strictEqual(fs.existsSync(pasado), false, 'diff = ttlMs + 1ms ya supera el TTL: debe purgarse');
  } finally {
    Date.now = originalNow;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purgeExpired: nunca elimina currentFile aunque su mtime supere el TTL', () => {
  const dir = tempPurgeDir();
  const actual = path.join(dir, 'sdd-turns-actual.json');
  fs.writeFileSync(actual, '{}');
  conMtime(actual, 48 * 60 * 60 * 1000);
  try {
    purgeExpired(dir, 'sdd-turns-', actual, 24 * 60 * 60 * 1000);
    assert.strictEqual(fs.existsSync(actual), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purgeExpired: ignora ficheros que no matchean el prefijo, aunque esten expirados', () => {
  const dir = tempPurgeDir();
  const otro = path.join(dir, 'otro-hook-vieja.json');
  fs.writeFileSync(otro, '{}');
  conMtime(otro, 48 * 60 * 60 * 1000);
  try {
    purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), 24 * 60 * 60 * 1000);
    assert.strictEqual(fs.existsSync(otro), true, 'un fichero de otro prefijo no debe tocarse');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purgeExpired: sin ficheros previos -> no lanza, 0 eliminados', () => {
  const dir = tempPurgeDir();
  try {
    assert.doesNotThrow(() => {
      purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), 24 * 60 * 60 * 1000);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purgeExpired: directorio no listable -> falla en silencio, no lanza', () => {
  assert.doesNotThrow(() => {
    purgeExpired('/ruta/que/no/existe/en/absoluto', 'sdd-turns-', '/tmp/actual.json', 1000);
  });
});

test('readPayload() con Node >= 20 -> no emite aviso de version', async () => {
  const rutaModulo = require.resolve('../sdd-hook-utils');
  delete require.cache[rutaModulo];
  const modulo = require(rutaModulo);

  const originalWriteSync = fs.writeSync;
  let stderr = '';
  fs.writeSync = (fd, chunk) => {
    if (fd === 2) stderr += chunk;
    return chunk.length;
  };
  stubStdin(closingStdin(['{}']));
  try {
    await modulo.readPayload();
    assert.strictEqual(stderr, '');
  } finally {
    fs.writeSync = originalWriteSync;
    restoreStdin();
    delete require.cache[rutaModulo];
  }
});

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
const {
  readPayload, warn, deny, loadConfig, purgeExpired, purgeLegacyOnce, purgeHookState, hookStateDir, stateDirSafe,
  sessionStatePath,
} = require('../sdd-hook-utils');

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

// Temporizador falso para readPayload(): registra lo programado y lo limpiado, y solo dispara
// cuando el test lo pide. Así el test afirma qué decidió la carrera, no cuánto tardó.
function temporizadorFalso() {
  const estado = { programado: null, limpiado: false, disparado: false };
  const handle = { unref() { estado.unref = true; return handle; } };
  return {
    estado,
    setTimeout(fn, ms, ...args) {
      estado.programado = { fn, ms, args };
      return handle;
    },
    clearTimeout(h) {
      if (h === handle) estado.limpiado = true;
    },
    disparar() {
      estado.disparado = true;
      estado.programado.fn(...estado.programado.args);
    },
  };
}

test('stdin nunca cierra -> el temporizador decide la carrera y resuelve a null', async () => {
  stubStdin(hangingStdin());
  const reloj = temporizadorFalso();
  try {
    const lectura = readPayload({ timeoutMs: 50, setTimeout: reloj.setTimeout, clearTimeout: reloj.clearTimeout });
    assert.ok(reloj.estado.programado, 'readPayload() debe programar su temporizador');
    assert.strictEqual(reloj.estado.programado.ms, 50);
    assert.ok(reloj.estado.unref, 'el temporizador debe soltar el bucle de eventos con unref()');
    reloj.disparar();
    assert.strictEqual(await lectura, null);
    assert.ok(reloj.estado.limpiado, 'el temporizador debe limpiarse al resolver');
  } finally {
    restoreStdin();
    clearHangingStdin();
  }
});

test('stdin llega con JSON inválido -> resuelve a null sin que salte el temporizador, y lo limpia', async () => {
  stubStdin(closingStdin(['no es json {']));
  const reloj = temporizadorFalso();
  try {
    const data = await readPayload({ timeoutMs: 5000, setTimeout: reloj.setTimeout, clearTimeout: reloj.clearTimeout });
    assert.strictEqual(data, null);
    assert.ok(reloj.estado.programado, 'readPayload() debe programar su temporizador');
    assert.strictEqual(reloj.estado.disparado, false, 'JSON inválido no debe depender del temporizador');
    assert.ok(reloj.estado.limpiado, 'el temporizador debe limpiarse al resolver');
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
// estado por sesion, compartido por sdd-turn-budget.js y sdd-read-tracker.js.
// Unica fuente de la sanitizacion del identificador de sesion: sustituye la
// sanitizacion duplicada que antes vivia en cada hook por separado.
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

// La purga no sigue enlaces: un enlace simbólico con el prefijo propio no es
// un registro del hook aunque el fichero al que apunta esté caducado.
test('purgeExpired: enlace simbólico con el prefijo -> ni se borra el enlace ni su destino', () => {
  const dir = tempPurgeDir();
  const fuera = tempPurgeDir();
  const destino = path.join(fuera, 'ajeno.json');
  fs.writeFileSync(destino, '{}');
  conMtime(destino, 48 * 60 * 60 * 1000);
  const enlace = path.join(dir, 'sdd-turns-enlace.json');
  fs.symlinkSync(destino, enlace);
  const viejo = Date.now() / 1000 - 48 * 60 * 60;
  fs.lutimesSync(enlace, viejo, viejo);
  try {
    purgeExpired(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.json'), 24 * 60 * 60 * 1000);
    assert.strictEqual(fs.lstatSync(enlace).isSymbolicLink(), true, 'el enlace no se borra');
    assert.strictEqual(fs.existsSync(destino), true, 'el destino del enlace queda intacto');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fuera, { recursive: true, force: true });
  }
});

test('purgeExpired: directorio que es un enlace simbólico -> no purga lo que hay al otro lado', () => {
  const real = tempPurgeDir();
  const base = tempPurgeDir();
  const viejo = path.join(real, 'sdd-turns-vieja.json');
  fs.writeFileSync(viejo, '{}');
  conMtime(viejo, 48 * 60 * 60 * 1000);
  const enlace = path.join(base, 'estado');
  fs.symlinkSync(real, enlace, 'dir');
  try {
    assert.strictEqual(purgeExpired(enlace, 'sdd-turns-', null, 24 * 60 * 60 * 1000), -1);
    assert.strictEqual(fs.existsSync(viejo), true);
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('purgeLegacyOnce: purga la raíz con la misma regla y deja marca cuando ya no queda ninguno', () => {
  const estado = tempPurgeDir();
  const raiz = tempPurgeDir();
  const ttl = 24 * 60 * 60 * 1000;
  const caducado = path.join(raiz, 'sdd-turns-antigua.log');
  const reciente = path.join(raiz, 'sdd-turns-reciente.log');
  const ajeno = path.join(raiz, 'otro-programa.log');
  for (const f of [caducado, reciente, ajeno]) fs.writeFileSync(f, '1\n');
  conMtime(caducado, 25 * 60 * 60 * 1000);
  conMtime(ajeno, 48 * 60 * 60 * 1000);
  const marca = path.join(estado, '.legacy-sdd-turns-purged');
  try {
    purgeLegacyOnce(estado, raiz, 'sdd-turns-', ttl);
    assert.strictEqual(fs.existsSync(caducado), false, 'el registro antiguo caducado se purga');
    assert.strictEqual(fs.existsSync(reciente), true, 'el registro antiguo dentro del TTL se conserva');
    assert.strictEqual(fs.existsSync(ajeno), true, 'un fichero sin el prefijo no se toca');
    assert.strictEqual(fs.existsSync(marca), false, 'sin marca mientras queden registros en la raíz');

    fs.unlinkSync(reciente);
    purgeLegacyOnce(estado, raiz, 'sdd-turns-', ttl);
    assert.strictEqual(fs.existsSync(marca), true, 'con la raíz limpia queda la marca');

    const posterior = path.join(raiz, 'sdd-turns-posterior.log');
    fs.writeFileSync(posterior, '1\n');
    conMtime(posterior, 25 * 60 * 60 * 1000);
    purgeLegacyOnce(estado, raiz, 'sdd-turns-', ttl);
    assert.strictEqual(fs.existsSync(posterior), true, 'con la marca la raíz ya no se recorre');
  } finally {
    fs.rmSync(estado, { recursive: true, force: true });
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

// os.tmpdir() lee TMPDIR (TEMP/TMP en Windows) en cada llamada: redirigirlo
// aísla el directorio por defecto sin tocar el temporal real.
function conTmpdir(dir, fn) {
  const claves = ['TMPDIR', 'TEMP', 'TMP'];
  const previos = claves.map((k) => process.env[k]);
  for (const k of claves) process.env[k] = dir;
  try {
    return fn();
  } finally {
    claves.forEach((k, i) => {
      if (previos[i] === undefined) delete process.env[k];
      else process.env[k] = previos[i];
    });
  }
}

const NOMBRE_ESTADO = typeof process.getuid === 'function' ? 'sdd-hooks-' + process.getuid() : 'sdd-hooks';

test('hookStateDir: sin override crea y devuelve la subcarpeta propia del temporal; con override, el override', () => {
  const raiz = fs.realpathSync(tempPurgeDir());
  try {
    conTmpdir(raiz, () => {
      const dir = hookStateDir(undefined);
      assert.strictEqual(dir, path.join(raiz, NOMBRE_ESTADO));
      assert.strictEqual(fs.statSync(dir).isDirectory(), true);
      assert.strictEqual(hookStateDir('/otro/sitio'), '/otro/sitio');
    });
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('purgeHookState: con el directorio por defecto purga también la raíz; con override, la raíz no se toca', () => {
  const raiz = fs.realpathSync(tempPurgeDir());
  const propio = tempPurgeDir();
  const ttl = 24 * 60 * 60 * 1000;
  const antiguo = path.join(raiz, 'sdd-turns-antigua.log');
  try {
    conTmpdir(raiz, () => {
      fs.writeFileSync(antiguo, '1\n');
      conMtime(antiguo, 25 * 60 * 60 * 1000);
      purgeHookState(propio, 'sdd-turns-', path.join(propio, 'sdd-turns-actual.log'), ttl);
      assert.strictEqual(fs.existsSync(antiguo), true, 'con override la raíz del temporal no se toca');

      const dir = hookStateDir(undefined);
      purgeHookState(dir, 'sdd-turns-', path.join(dir, 'sdd-turns-actual.log'), ttl);
      assert.strictEqual(fs.existsSync(antiguo), false, 'con el directorio por defecto se purga el registro antiguo de la raíz');
    });
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
    fs.rmSync(propio, { recursive: true, force: true });
  }
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

test('stateDirSafe: carpeta propia real -> válida, y le retira los permisos de grupo y otros', () => {
  const dir = tempPurgeDir();
  try {
    fs.chmodSync(dir, 0o777);
    assert.strictEqual(stateDirSafe(dir), true);
    if (typeof process.getuid === 'function') {
      assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stateDirSafe: la carpeta es un enlace simbólico -> no válida', () => {
  const real = tempPurgeDir();
  const base = tempPurgeDir();
  const enlace = path.join(base, 'estado');
  fs.symlinkSync(real, enlace, 'dir');
  try {
    assert.strictEqual(stateDirSafe(enlace), false);
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('stateDirSafe: carpeta de otro dueño -> no válida y sin tocar sus permisos', () => {
  const dir = tempPurgeDir();
  let chmods = 0;
  try {
    const ajena = fs.lstatSync(dir).uid + 1;
    assert.strictEqual(stateDirSafe(dir, { uid: ajena, chmodSync: () => { chmods++; } }), false);
    assert.strictEqual(chmods, 0);
    assert.strictEqual(stateDirSafe(dir, { uid: null }), true, 'sin uid (Windows) se omite la comprobación de dueño');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hookStateDir: si la carpeta propia no es segura degrada a la raíz del temporal', () => {
  const raiz = fs.realpathSync(tempPurgeDir());
  try {
    conTmpdir(raiz, () => {
      const ajena = { uid: -1 };
      assert.strictEqual(hookStateDir(undefined, ajena), raiz);
      assert.strictEqual(hookStateDir(undefined), path.join(raiz, NOMBRE_ESTADO));
    });
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('purgeExpired: un fichero de otro usuario ni se borra ni cuenta como pendiente', () => {
  const dir = tempPurgeDir();
  const viejo = path.join(dir, 'sdd-turns-vieja.json');
  fs.writeFileSync(viejo, '{}');
  conMtime(viejo, 48 * 60 * 60 * 1000);
  const original = process.getuid;
  const propio = fs.lstatSync(viejo).uid;
  process.getuid = () => propio + 1;
  try {
    assert.strictEqual(purgeExpired(dir, 'sdd-turns-', null, 24 * 60 * 60 * 1000), 0);
    assert.strictEqual(fs.existsSync(viejo), true);
  } finally {
    process.getuid = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

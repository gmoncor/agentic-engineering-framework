'use strict';

// Utilidades compartidas por los hooks SDD.
// Emite decisiones en el formato que entienden Claude Code (JSON por stdout),
// Gemini CLI / Codex (texto por stderr + codigo de salida) y Antigravity CLI
// (JSON por stdout, sin codigo de salida en su contrato).

const fs = require('fs');
const os = require('os');
const path = require('path');

const SKIP_ENV = 'SDD_GUARD_SKIP';

// Firma estable de fallo interno (ver hooks/gate-signatures.json). No es un veredicto: marca que
// el hook no pudo completarse y se aparta, en vez de aparentar un bloqueo que nadie decidio.
const INTERNAL_ERROR_FIRMA = '[SDD_INTERNAL_ERROR] ';
const STDIN_TIMEOUT_MS = 5000;
const NODE_MINIMO = 20;

// Node >=20 es requisito del framework (async iterators, fs.cpSync, etc.).
// El aviso es no-bloqueante y se emite una sola vez por proceso: cada hook
// corre en su propio proceso, asi que el flag solo evita repeticion si
// readPayload() se llamara mas de una vez dentro del mismo.
let _nodeChecked = false;
function checkNodeVersion() {
  if (_nodeChecked) return;
  _nodeChecked = true;
  try {
    const mayor = parseInt(process.versions.node.split('.')[0], 10);
    if (mayor < NODE_MINIMO) {
      fs.writeSync(
        2,
        '[SDD] Node ' + process.versions.node + ' detectado; los hooks requieren Node >= ' + NODE_MINIMO + '. Algunos hooks pueden fallar.\n',
      );
    }
  } catch {
    // El aviso es best-effort: un fallo aqui no debe interrumpir el hook.
  }
}

// Si el harness no cierra stdin (pipe bloqueado, antivirus, comportamiento
// anomalo), leer hasta EOF cuelga el proceso indefinidamente. La carrera
// contra el timeout garantiza que el hook siempre resuelve: si stdin no
// llega a tiempo, se degrada a null igual que un payload invalido.
//
// `opciones` es opcional: `{ timeoutMs, setTimeout, clearTimeout }`. Los temporizadores
// inyectables permiten a los tests afirmar qué decidió la carrera sin medir el reloj; por
// defecto son los globales.
async function readPayload(opciones) {
  checkNodeVersion();
  const {
    timeoutMs,
    setTimeout = global.setTimeout,
    clearTimeout = global.clearTimeout,
  } = opciones || {};
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs || STDIN_TIMEOUT_MS, null);
    // .unref() retira la reclamacion del temporizador sobre el bucle de eventos; no lo desarma.
    // Mientras la lectura de stdin sigue pendiente es ella quien mantiene vivo el proceso, asi que
    // el timeout dispara igual y degrada a null en el caso que motiva la carrera (stdin que no
    // cierra). Lo que evita es el contrario: que un temporizador armado sea lo unico que retenga
    // el proceso. Ahi el bucle se vacia y el proceso termina con codigo 0 sin emitir decision,
    // que es exactamente lo que emite un payload null: ninguna.
    timer.unref();
  });

  const read = (async () => {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function skipRequested(env) {
  return (env || process.env)[SKIP_ENV] === '1';
}

/**
 * Carga `hooks/config.json` (o `SDD_CONFIG_PATH` si esta definido, seam usado
 * por los tests). Distingue dos fallos que no son iguales:
 *   - archivo ausente u otro error de lectura (EACCES, etc.): silencio, `{}`.
 *     El framework no requiere config.json para funcionar.
 *   - archivo presente pero JSON invalido: degradacion silenciosa peligrosa
 *     si no avisa (el usuario cree que su configuracion esta activa). Se
 *     avisa a stderr dentro de un try/catch mudo (stderr puede estar roto) y
 *     se retorna `{}` igual.
 */
function loadConfig(defaultFile) {
  const file = process.env.SDD_CONFIG_PATH || defaultFile;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    try {
      fs.writeSync(2, '[SDD] ' + file + ' no es JSON valido (' + err.message
        + ') - hooks SDD usando valores por defecto. Revisa el archivo.\n');
    } catch {
      // stderr roto: nada mas que hacer, se degrada igual a valores por defecto.
    }
    return {};
  }
}

/**
 * Valor de `enabled` que vale cuando la sección del hook no lo declara como booleano (sección
 * ausente, clave ausente o un valor que no es `true` ni `false`). Es la única tabla: los hooks y
 * el campo `gates_on` de provenance leen de aquí, así que no pueden discrepar sobre si una puerta
 * sin `enabled` está encendida.
 */
const HOOK_ENABLED_DEFAULTS = Object.freeze({
  sdd_read_before_edit: true,
  sdd_review_gate: false,
  sdd_session_start: true,
  sdd_turn_budget: true,
});

/**
 * Si el hook `name` está encendido según su sección `cfg` de hooks/config.json. Un booleano
 * explícito manda; si no lo hay, el valor por defecto de HOOK_ENABLED_DEFAULTS. Una sección que
 * no está en la tabla solo cuenta como encendida con `enabled: true`.
 */
function hookEnabled(name, cfg) {
  const enabled = cfg && typeof cfg === 'object' ? cfg.enabled : undefined;
  if (typeof enabled === 'boolean') return enabled;
  return HOOK_ENABLED_DEFAULTS[name] === true;
}

/**
 * Normaliza la llamada a herramienta de las CLIs soportadas a una forma unica.
 *
 * Dos familias de payload:
 *   - snake_case: { tool_name, tool_input } — Claude Code, Gemini CLI, Codex.
 *   - camelCase:  { toolCall: { name, args } } — Antigravity CLI (codificacion protojson).
 *
 * `stdoutOnly` marca la segunda: ahi la decision viaja SOLO en el JSON de stdout y el codigo de
 * salida no forma parte del contrato, asi que salir con != 0 solo simularia un fallo del hook.
 */
function readToolCall(data) {
  const call = data && data.toolCall;
  if (call && typeof call === 'object') {
    return { name: call.name || '', input: call.args || {}, stdoutOnly: true };
  }
  return {
    name: (data && data.tool_name) || '',
    input: (data && data.tool_input) || {},
    stdoutOnly: false,
  };
}

// stdout/stderr hacia un pipe son asincronos: escribir con fs.writeSync evita
// perder la decision cuando el proceso termina inmediatamente despues.
function emit(payload, reason, code) {
  fs.writeSync(1, JSON.stringify(payload) + '\n');
  fs.writeSync(2, '[SDD] ' + reason + '\n');
  process.exit(code);
}

/**
 * Deja pasar la accion explicando por que. `call` es lo que devuelve readToolCall().
 *
 * Antigravity solo admite allow | deny | ask | force_ask: un aviso se expresa ahi como `allow` con
 * motivo. En las demas CLIs se mantiene `warn`, que es su forma de decir lo mismo.
 *
 * `code` es un identificador corto y estable (UPPER_SNAKE_CASE) para que un consumidor
 * automatizado distinga motivos dentro del mismo hook sin parsear el texto de `reason`.
 * Es opcional: si no se pasa, el payload se emite igual que antes (retrocompatible).
 */
function warn(reason, call, code) {
  const decision = call && call.stdoutOnly ? 'allow' : 'warn';
  const payload = { decision, reason };
  if (code) payload.code = code;
  emit(payload, reason, 0);
}

/** Bloquea la accion. El codigo 2 es la senal de bloqueo de las CLIs que la usan; ver readToolCall. */
function deny(reason, call, code) {
  const exitCode = call && call.stdoutOnly ? 0 : 2;
  const payload = {
    decision: 'deny',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  if (code) {
    payload.code = code;
    payload.hookSpecificOutput.code = code;
  }
  emit(payload, reason, exitCode);
}

// Subcarpeta propia del estado efímero por sesión dentro del temporal del
// sistema: los registros no se mezclan con los de otros programas en la raíz.
// En POSIX lleva el uid en el nombre: el temporal es compartido entre usuarios
// y una carpeta de otro usuario con el mismo nombre dejaría al segundo sin
// poder escribir o, si la deja abierta, escribiendo donde otro decide.
const STATE_SUBDIR = 'sdd-hooks';

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function defaultStateDir() {
  const uid = currentUid();
  return path.join(os.tmpdir(), uid === null ? STATE_SUBDIR : STATE_SUBDIR + '-' + uid);
}

/**
 * Comprueba que `dir` es una carpeta segura para el estado del hook: un
 * directorio real (no un enlace simbólico), del usuario actual y sin permisos
 * para grupo ni otros. Si solo sobran permisos, los retira (`chmod 0o700`).
 * Sin `getuid` (Windows) se omite la comprobación de dueño. `deps` permite
 * inyectar `lstatSync`, `chmodSync` y `uid` en las pruebas.
 */
function stateDirSafe(dir, deps) {
  const d = deps || {};
  const lstat = d.lstatSync || fs.lstatSync;
  const chmod = d.chmodSync || fs.chmodSync;
  const uid = 'uid' in d ? d.uid : currentUid();
  try {
    const info = lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
    if (uid === null) return true;
    if (info.uid !== uid) return false;
    if (info.mode & 0o077) chmod(dir, 0o700);
    return true;
  } catch {
    return false;
  }
}

const _avisados = new Set();

/**
 * Directorio del estado por sesión de un hook. `override` (la variable de
 * entorno del hook, p. ej. SDD_TURNS_DIR) manda si viene; si no, la subcarpeta
 * propia del temporal, que se crea si falta. Si esa carpeta no supera
 * `stateDirSafe` (es un enlace, es de otro usuario o no se pudo crear), se
 * avisa por stderr y se usa la raíz del temporal, como antes de existir la
 * subcarpeta.
 */
function hookStateDir(override, deps) {
  if (override) return override;
  const dir = defaultStateDir();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // Ya existe como algo que no es un directorio, o sin permisos: lo decide stateDirSafe.
  }
  if (stateDirSafe(dir, deps)) return dir;
  if (!_avisados.has(dir)) {
    _avisados.add(dir);
    try {
      fs.writeSync(2, '[SDD] ' + dir + ' no es una carpeta propia segura (enlace, otro dueño o no creable): el estado de los hooks va a la raíz del temporal.\n');
    } catch {
      // stderr roto: el aviso es secundario.
    }
  }
  return os.tmpdir();
}

/**
 * Purga ficheros de estado por sesión expirados de un directorio. Se invoca de
 * forma oportunista al escribir el estado de la sesión actual: no hay proceso
 * en segundo plano que limpie, así que cada escritura aprovecha para retirar
 * el rastro de sesiones antiguas.
 *
 * `currentFile` nunca se purga (es el fichero que se acaba de escribir).
 * `prefix` filtra por el nombre del hook (`sdd-turns-`, `sdd-reads-`, ...)
 * para no tocar ficheros de otro origen que compartan el mismo directorio.
 *
 * Solo se borran ficheros regulares, comprobados con `lstat`: un enlace
 * simbólico con el prefijo no se sigue ni se borra, y su destino queda
 * intacto. Si el propio `dir` es un enlace simbólico, no se purga nada: la
 * purga no sale de la carpeta que se le pasa.
 *
 * Los ficheros de otro usuario no se tocan ni se cuentan.
 *
 * Devuelve cuántos ficheros regulares propios con el prefijo quedan (sin
 * contar `currentFile` ni los que no se pueden borrar por permisos); -1 si el
 * directorio no se pudo recorrer.
 *
 * Degradacion segura: directorio no listable o fichero no eliminable
 * (permisos, disco de solo lectura) -> silencio. La purga es mantenimiento,
 * nunca debe convertirse en un fallo del hook que la invoca.
 */
function purgeExpired(dir, prefix, currentFile, ttlMs) {
  let entries;
  try {
    if (!fs.lstatSync(dir).isDirectory()) return -1;
    entries = fs.readdirSync(dir);
  } catch {
    return -1;
  }
  const now = Date.now();
  const uid = currentUid();
  let remaining = 0;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const file = path.join(dir, name);
    if (file === currentFile) continue;
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile()) continue;
      if (uid !== null && info.uid !== uid) continue;
      if (now - info.mtimeMs > ttlMs) fs.unlinkSync(file);
      else remaining++;
    } catch (err) {
      // Fichero ya desaparecido o sin permisos: no interrumpe la purga del resto.
      // Uno que no se puede borrar por permisos no cuenta como pendiente.
      if (!err || (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'ENOENT')) remaining++;
    }
  }
  return remaining;
}

/**
 * Purga los registros que versiones anteriores dejaban en la raíz del
 * temporal (`legacyDir`), con la misma regla que `purgeExpired`: son de este
 * hook por su prefijo exacto. Cuando en la raíz ya no queda ninguno, deja una
 * marca en `stateDir` y no vuelve a recorrer la raíz.
 */
function purgeLegacyOnce(stateDir, legacyDir, prefix, ttlMs) {
  const marker = path.join(stateDir, '.legacy-' + prefix + 'purged');
  if (fs.existsSync(marker)) return;
  if (purgeExpired(legacyDir, prefix, null, ttlMs) !== 0) return;
  try {
    fs.writeFileSync(marker, '');
  } catch {
    // Sin marca, la raíz se vuelve a recorrer en la siguiente escritura: solo cuesta tiempo.
  }
}

/**
 * Purga del estado de un hook: su directorio y, si es el directorio por
 * defecto, los registros antiguos de la raíz del temporal. Con un directorio
 * propio (variable de entorno) la raíz del temporal no se toca.
 */
function purgeHookState(dir, prefix, currentFile, ttlMs) {
  purgeExpired(dir, prefix, currentFile, ttlMs);
  if (dir === defaultStateDir()) purgeLegacyOnce(dir, os.tmpdir(), prefix, ttlMs);
}

/**
 * Ruta del fichero de estado por sesion, compartida por los hooks que llevan
 * un registro por sesion (sdd-turn-budget.js, sdd-read-tracker.js). Sustituye
 * la sanitizacion que cada uno duplicaba: `[^a-zA-Z0-9_-]` colapsa a '_'
 * cualquier caracter fuera de ese conjunto, asi que sin mas, identificadores
 * distintos que solo difieren en un separador ('abc.def', 'abc/def', 'abc
 * def') producen el mismo nombre de fichero y terminan compartiendo estado:
 * el aviso de una sesion se calcularia con los datos de otra. El nombre debe
 * ser inyectivo (identificadores distintos -> ficheros distintos) para que
 * eso no ocurra.
 *
 * Si la sanitizacion no cambio nada, el resultado es el nombre de siempre:
 * necesario para que `purgeExpired` -- que reconoce los ficheros por
 * `prefix`, no por el nombre completo -- siga purgando con normalidad los
 * ficheros de sesiones ya en curso. Si la sanitizacion SI cambio el
 * identificador, se añade un sufijo corto derivado del identificador CRUDO
 * para que dos identificadores que colapsen al mismo `safe` no colisionen. El
 * sufijo se añade DESPUES de `safe`, nunca lo sustituye: el fichero sigue
 * empezando por `prefix`, que es lo unico de lo que depende la purga.
 */
function sessionStatePath(dir, prefix, sessionId, extension) {
  const raw = String(sessionId);
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (safe === raw) return path.join(dir, prefix + safe + extension);
  // crypto es perezoso: este modulo lo carga cada hook en cada llamada a
  // herramienta, y solo el caso raro (identificador con caracteres fuera del
  // conjunto seguro) necesita el hash.
  const hash = require('crypto').createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return path.join(dir, prefix + safe + '-' + hash + extension);
}

/**
 * Punto de entrada comun de los hooks: fail-open por clase de error.
 *
 * Separa las dos cosas que un exit distinto de 0 confundia:
 *   - Veredicto deliberado: deny() sale con 2 y warn() con 0. Los dos terminan el proceso desde
 *     dentro de `mainFn`, asi que el primer exit gana y este envoltorio no llega a reescribirlo.
 *   - Fallo interno del hook (dependencia caida, estado ilegible, bug): exit 0 mas un aviso con
 *     firma. Un hook roto no puede leerse como un bloqueo; el agente sigue y ve la causa.
 *
 * Cubre el fallo sincrono y el rechazo de la promesa que devuelve `mainFn`. Limite conocido: lo
 * que el runtime no entrega a un catch (falta de memoria, desbordamiento de pila) mata el proceso
 * sin pasar por aqui, y su salida se lee como fallo de la herramienta, no como veredicto.
 */
function runWithFailOpen(hookName, mainFn) {
  const failOpen = (err) => {
    try {
      fs.writeSync(2, INTERNAL_ERROR_FIRMA + hookName + ': ' + describeError(err) + '\n');
    } catch {
      // stderr roto: lo que importa es apartarse, el aviso es secundario.
    }
    process.exit(0);
  };

  try {
    const pending = mainFn();
    if (pending && typeof pending.then === 'function') pending.then(undefined, failOpen);
  } catch (err) {
    failOpen(err);
  }
}

// Un valor lanzado puede no ser un Error (una cadena, null): el aviso nunca debe quedarse vacio.
function describeError(err) {
  const message = err && err.message;
  return message ? String(message) : String(err);
}

module.exports = {
  readPayload,
  readToolCall,
  skipRequested,
  loadConfig,
  hookEnabled,
  HOOK_ENABLED_DEFAULTS,
  warn,
  deny,
  purgeExpired,
  purgeLegacyOnce,
  purgeHookState,
  hookStateDir,
  stateDirSafe,
  sessionStatePath,
  runWithFailOpen,
  SKIP_ENV,
};

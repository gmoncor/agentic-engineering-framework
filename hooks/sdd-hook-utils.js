'use strict';

// Utilidades compartidas por los hooks SDD.
// Emite decisiones en el formato que entienden Claude Code (JSON por stdout),
// Gemini CLI / Codex (texto por stderr + codigo de salida) y Antigravity CLI
// (JSON por stdout, sin codigo de salida en su contrato).

const fs = require('fs');
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
async function readPayload(timeoutMs) {
  checkNodeVersion();
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

/**
 * Purga ficheros de estado por sesion expirados de un directorio compartido
 * (`os.tmpdir()` normalmente). Se invoca de forma oportunista al escribir el
 * estado de la sesion actual: no hay proceso en segundo plano que limpie, asi
 * que cada escritura aprovecha para retirar el rastro de sesiones antiguas.
 *
 * `currentFile` nunca se purga (es el fichero que se acaba de escribir).
 * `prefix` filtra por el nombre del hook (`sdd-turns-`, `sdd-reads-`, ...)
 * para no tocar ficheros de otro origen que compartan el mismo directorio.
 *
 * Degradacion segura: directorio no listable o fichero no eliminable
 * (permisos, disco de solo lectura) -> silencio. La purga es mantenimiento,
 * nunca debe convertirse en un fallo del hook que la invoca.
 */
function purgeExpired(dir, prefix, currentFile, ttlMs) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const file = path.join(dir, name);
    if (file === currentFile) continue;
    try {
      if (now - fs.statSync(file).mtimeMs > ttlMs) fs.unlinkSync(file);
    } catch {
      // Fichero ya desaparecido o sin permisos: no interrumpe la purga del resto.
    }
  }
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
  warn,
  deny,
  purgeExpired,
  sessionStatePath,
  runWithFailOpen,
  SKIP_ENV,
};

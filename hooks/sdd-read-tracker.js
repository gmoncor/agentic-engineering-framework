'use strict';

// Rastreador de lecturas por sesion.
//
// Mantiene, por sesion, el conjunto de rutas que el agente ha leido. El hook
// sdd-read-before-edit.js lo consulta antes de una escritura: si el archivo se
// va a escribir sin constar leido, avisa.
//
// Canal: un fichero temporal por sesion, <tmp>/sdd-reads-<session_id>.jsonl,
// con una linea JSON por ruta absoluta leida (formato de solo-anexado, no un
// documento JSON unico). Igual que la senal de revision, se aisla por sesion
// para que dos sesiones concurrentes no se pisen.
//
// Por que solo-anexado: registrar una lectura solia ser leer el fichero
// entero, anadir la ruta en memoria y reescribirlo completo. Bajo lecturas
// concurrentes de la misma sesion (subagentes, llamadas agrupadas) cada
// proceso partia del mismo estado inicial y solo sobrevivia la ultima
// escritura -- las demas se perdian sin error. Cada perdida es un falso
// positivo real: el aviso "escribes sin haberlo leido" dispara sobre un
// fichero que si se leyo. Anexar una linea por llamada no tiene ese
// leer-modificar-escribir: no hay estado previo que pisar.
//
// Al escribir el rastreador de la sesion actual se purgan (best-effort) los
// ficheros de otras sesiones con mas de 24h sin actividad, para que no se
// acumulen indefinidamente en maquinas de larga duracion.
//
// SDD_READS_DIR redirige el directorio (tests, entornos con tmp efimero).
//
// La clave con la que se registra y se consulta una lectura es la ruta absoluta que devuelve
// resolveRepoPath: la misma ruta debe producir la misma clave llegue como la llegue (relativa,
// absoluta, o con separadores del otro sistema). Si las dos caras no coinciden, el rastreador
// registra una clave y consulta otra, y el aviso deja de sonar sin que nada falle.

const fs = require('fs');
const os = require('os');
const { purgeExpired, sessionStatePath } = require('./sdd-hook-utils');
const { resolveRepoPath } = require('./sdd-plan-state');

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PREFIX = 'sdd-reads-';

function readsDir() {
  return process.env.SDD_READS_DIR || os.tmpdir();
}

function readsPath(sessionId) {
  return sessionStatePath(readsDir(), PREFIX, sessionId, '.jsonl');
}

// Carga el conjunto de rutas leidas. null si no hay fichero (ninguna lectura
// registrada aun) o si no se puede leer: el consumidor distingue "sin datos de
// lectura" de "leido / no leido" para no avisar a ciegas. Una linea ilegible
// (escritura interrumpida a medias) se descarta sin invalidar el resto: es lo
// que hace viable el anexado sin bloqueo.
function loadReads(sessionId) {
  if (!sessionId) return null;
  let raw;
  try {
    raw = fs.readFileSync(readsPath(sessionId), 'utf8');
  } catch {
    return null;
  }
  const set = new Set();
  for (const linea of raw.split('\n')) {
    if (!linea) continue;
    try {
      set.add(JSON.parse(linea));
    } catch {
      // Linea escrita a medias por una interrupcion: no invalida las demas.
    }
  }
  return set;
}

// Registra una lectura anexando una linea; no lee el estado previo, asi que
// no hay nada que pisar bajo lecturas concurrentes de la misma sesion. El
// lector (loadReads) colapsa duplicados en un Set, asi que no hace falta
// comprobar aqui si la ruta ya constaba.
function trackRead(sessionId, filePath, fromDir) {
  if (!sessionId || !filePath) return;
  const resolved = resolveRepoPath(filePath, fromDir);
  if (!resolved) return;
  const file = readsPath(sessionId);
  try {
    fs.appendFileSync(file, JSON.stringify(resolved) + '\n');
  } catch {
    // Disco lleno o de solo lectura: perder este registro relaja el aviso,
    // nunca lo convierte en falso positivo -- es la unica via de perdida que
    // queda una vez retirado el leer-modificar-escribir; la carrera
    // concurrente que si producia falsos positivos ya no existe.
    return;
  }
  purgeExpired(readsDir(), PREFIX, file, TTL_MS);
}

function hasRead(sessionId, filePath, fromDir) {
  const resolved = filePath ? resolveRepoPath(filePath, fromDir) : null;
  if (!resolved) return false;
  const set = loadReads(sessionId);
  return set != null && set.has(resolved);
}

// Si consta ALGUNA lectura en la sesion. Permite al hook saber que el backend
// SI entrega eventos de lectura: sin ninguna lectura registrada, no puede
// afirmar que una escritura no fue precedida de lectura.
function hasAnyRead(sessionId) {
  const set = loadReads(sessionId);
  return set != null && set.size > 0;
}

module.exports = { readsPath, loadReads, trackRead, hasRead, hasAnyRead };

'use strict';

// Rastreador de lecturas por sesion.
//
// Mantiene, por sesion, el conjunto de rutas que el agente ha leido. El hook
// sdd-read-before-edit.js lo consulta antes de una escritura: si el archivo se
// va a escribir sin constar leido, avisa.
//
// Canal: un fichero temporal por sesion, <tmp>/sdd-reads-<session_id>.json, con
// la lista de rutas absolutas leidas. Igual que la senal de revision, se aisla
// por sesion para que dos sesiones concurrentes no se pisen.
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
const path = require('path');
const { purgeExpired } = require('./sdd-hook-utils');
const { resolveRepoPath } = require('./sdd-plan-state');

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function readsDir() {
  return process.env.SDD_READS_DIR || os.tmpdir();
}

function readsPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(readsDir(), 'sdd-reads-' + safe + '.json');
}

// Carga el conjunto de rutas leidas. null si no hay fichero (ninguna lectura
// registrada aun) o si no se puede leer: el consumidor distingue "sin datos de
// lectura" de "leido / no leido" para no avisar a ciegas.
function loadReads(sessionId) {
  if (!sessionId) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(readsPath(sessionId), 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  return new Set(raw);
}

// Registra una lectura. Normaliza la ruta a absoluta para comparar de forma
// consistente con la escritura, que puede llegar relativa o absoluta.
function trackRead(sessionId, filePath, fromDir) {
  if (!sessionId || !filePath) return;
  const resolved = resolveRepoPath(filePath, fromDir);
  if (!resolved) return;
  const set = loadReads(sessionId) || new Set();
  if (set.has(resolved)) return;
  set.add(resolved);
  const file = readsPath(sessionId);
  try {
    fs.writeFileSync(file, JSON.stringify([...set]));
  } catch {
    // Disco lento o de solo lectura: perder un registro solo relaja el aviso,
    // nunca lo convierte en falso positivo. No se propaga.
    return;
  }
  purgeExpired(readsDir(), 'sdd-reads-', file, TTL_MS);
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

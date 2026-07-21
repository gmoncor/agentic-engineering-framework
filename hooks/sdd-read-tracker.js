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
// SDD_READS_DIR redirige el directorio (tests, entornos con tmp efimero).

const fs = require('fs');
const os = require('os');
const path = require('path');

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
function trackRead(sessionId, filePath) {
  if (!sessionId || !filePath) return;
  const resolved = path.resolve(filePath);
  const set = loadReads(sessionId) || new Set();
  if (set.has(resolved)) return;
  set.add(resolved);
  try {
    fs.writeFileSync(readsPath(sessionId), JSON.stringify([...set]));
  } catch {
    // Disco lento o de solo lectura: perder un registro solo relaja el aviso,
    // nunca lo convierte en falso positivo. No se propaga.
  }
}

function hasRead(sessionId, filePath) {
  if (!filePath) return false;
  const set = loadReads(sessionId);
  return set != null && set.has(path.resolve(filePath));
}

// Si consta ALGUNA lectura en la sesion. Permite al hook saber que el backend
// SI entrega eventos de lectura: sin ninguna lectura registrada, no puede
// afirmar que una escritura no fue precedida de lectura.
function hasAnyRead(sessionId) {
  const set = loadReads(sessionId);
  return set != null && set.size > 0;
}

module.exports = { readsPath, loadReads, trackRead, hasRead, hasAnyRead };

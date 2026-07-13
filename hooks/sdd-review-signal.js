'use strict';

// Senal de revision POST-implementacion.
//
// Contrato unico entre el emisor (el workflow /implementar-spec, tras la
// revision adversarial del diff) y el consumidor (sdd-review-gate.js, que
// bloquea el commit si la revision no ocurrio). Ambos lados usan este modulo:
// el formato de la senal no puede divergir.
//
// Canales de la senal:
//   1. Fichero temporal por sesion: <tmp>/sdd-review-<session_id>.json
//   2. Marca en el mensaje de commit: [SDD-POST-IMPL: <hash>]

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIGNAL = 'SDD_POST_IMPL';
const MARKER_RE = /\[SDD-POST-IMPL:\s*([a-fA-F0-9]{4,})\]/;
const HASH_RE = /^[a-fA-F0-9]{4,}$/;
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4h: cubre una sesion de implementacion

// SDD_SIGNAL_DIR permite redirigir la senal (tests, entornos con tmp efimero).
function signalDir() {
  return process.env.SDD_SIGNAL_DIR || os.tmpdir();
}

function signalPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(signalDir(), 'sdd-review-' + safe + '.json');
}

function hashDiff(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
}

function resolveSessionId(env) {
  const e = env || process.env;
  return e.CLAUDE_SESSION_ID || e.GEMINI_SESSION_ID || e.SDD_SESSION_ID || '';
}

// Escribe la senal. Retorna el path escrito, o null si no hay sesion conocida
// (en ese caso el unico canal disponible es la marca en el mensaje de commit).
function writeSignal(sessionId, diffHash) {
  if (!sessionId || !HASH_RE.test(String(diffHash))) return null;
  const file = signalPath(sessionId);
  fs.writeFileSync(file, JSON.stringify({ signal: SIGNAL, diff_hash: diffHash, ts: Date.now() }));
  return file;
}

// Lee la senal vigente de la sesion. null si no existe, es invalida o expiro.
function readSignal(sessionId, ttlMs) {
  if (!sessionId) return null;
  const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(signalPath(sessionId), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || raw.signal !== SIGNAL) return null;
  if (!HASH_RE.test(String(raw.diff_hash))) return null;
  if (typeof raw.ts !== 'number' || Date.now() - raw.ts > ttl) return null;
  return raw;
}

module.exports = { MARKER_RE, DEFAULT_TTL_MS, signalPath, hashDiff, resolveSessionId, writeSignal, readSignal };

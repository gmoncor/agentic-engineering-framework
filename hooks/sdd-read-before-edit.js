#!/usr/bin/env node
'use strict';

/**
 * SDD Read-before-edit — hook PreToolUse advisory.
 *
 * AVISA la primera vez que se escribe un archivo existente sin constar leido en
 * la sesion: editar a ciegas sobrescribe contenido que el agente no conoce.
 * Nunca bloquea; es solo un recordatorio.
 *
 * COMO RASTREA LAS LECTURAS
 * En cada lectura registra la ruta en sdd-read-tracker.js (fichero por sesion).
 * En cada escritura consulta si esa ruta consta leida. El estado vive fuera del
 * proceso porque lectura y escritura son invocaciones distintas del hook.
 *
 * DEGRADACION SEGURA (nunca falso positivo, nunca bloqueo):
 *   - Archivo nuevo (no existe en disco): no habia nada que leer -> no avisa.
 *   - Sin session_id: no hay sesion que correlacionar -> silencio.
 *   - Backend que no entrega el evento de lectura: el aviso solo se emite si
 *     (a) el backend es Claude Code, cuyo evento Read si se hookea, o (b) consta
 *     al menos una lectura en la sesion (el backend SI entrega lecturas). Si no,
 *     no puede afirmar que no hubo lectura -> silencio.
 *   - Error al leer el rastreador (disco lento): se trata como "sin datos".
 *
 * LIMITE POR BACKEND
 *   - Claude Code:          evento Read hookable; se cablea Read + Write + Edit.
 *   - Gemini / Antigravity: si su CLI entrega el evento de lectura (read_file),
 *     el rastreador se alimenta y el aviso funciona; si no, se autolimita a
 *     silencio (regla b de arriba), sin falsos positivos.
 *   - Codex: su escritura es apply_patch (payload distinto, multi-archivo) y no
 *     expone un evento de lectura uniforme -> fuera de alcance; no se cablea.
 *
 * Configurable en hooks/config.json: sdd_read_before_edit.enabled (default true),
 * .mode (default "advisory"; cualquier otro valor lo silencia — nunca bloquea).
 */

const fs = require('fs');
const path = require('path');
const { readPayload, readToolCall, warn } = require('./sdd-hook-utils');
const { trackRead, hasRead, hasAnyRead } = require('./sdd-read-tracker');

const READ_TOOLS = new Set([
  'Read',        // Claude Code
  'read_file',   // Gemini CLI / Antigravity CLI
  'view_file',   // Antigravity CLI: alias de lectura
]);

// Escrituras de un backend que hookea Read de forma fiable (Claude Code): aqui
// una escritura sin lectura previa es un aviso legitimo aunque no conste aun
// ninguna lectura. En los demas backends el aviso se condiciona a hasAnyRead.
const READ_RELIABLE_WRITE_TOOLS = new Set(['Write', 'Edit']);

const WRITE_TOOLS = new Set([
  'Write', 'Edit',              // Claude Code
  'write_file', 'edit_file',    // Gemini CLI
  'write_to_file',              // Antigravity CLI
  'replace_file_content',
  'multi_replace_file_content',
  'create_file',
]);

function advisory(filePath) {
  return 'SDD: escribiendo ' + filePath + ' sin haberlo leido primero en esta '
    + 'sesion. Verifica que conoces el contenido actual antes de sobrescribirlo.';
}

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const cfg = loadConfig().sdd_read_before_edit || {};
  if (cfg.enabled === false) process.exit(0);
  if ((cfg.mode || 'advisory') !== 'advisory') process.exit(0);

  const call = readToolCall(data);
  const filePath = call.input.file_path || call.input.path
    || call.input.TargetFile || call.input.absolute_path || '';

  const sessionId = data.session_id || data.sessionId || '';
  if (!sessionId) process.exit(0);

  if (READ_TOOLS.has(call.name)) {
    if (filePath) trackRead(sessionId, filePath);
    process.exit(0);
  }

  if (!WRITE_TOOLS.has(call.name) || !filePath) process.exit(0);

  // Archivo nuevo: no existia para leerlo.
  if (!fs.existsSync(path.resolve(filePath))) process.exit(0);

  if (hasRead(sessionId, filePath)) process.exit(0);

  // Sin lectura de esta ruta. Solo se avisa si consta que el backend entrega
  // lecturas: Claude Code siempre; los demas solo si ya hubo alguna lectura.
  const backendDeliversReads = READ_RELIABLE_WRITE_TOOLS.has(call.name)
    || hasAnyRead(sessionId);
  if (!backendDeliversReads) process.exit(0);

  warn(advisory(filePath), call);
}

// SDD_CONFIG_PATH permite apuntar a otra configuracion (tests, entornos aislados).
function loadConfig() {
  const file = process.env.SDD_CONFIG_PATH || path.join(__dirname, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

main().catch(() => process.exit(0));

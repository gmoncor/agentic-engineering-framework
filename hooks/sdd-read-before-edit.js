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
 * Una escritura completa (Write y equivalentes) también registra su ruta: el
 * agente conoce lo que él mismo escribió, y editarlo después no avisa.
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
 * .mode (default "advisory"; cualquier otro valor lo silencia — nunca bloquea, pero
 * si el valor esta explicitamente declarado se avisa por stderr que no es reconocido).
 */

const fs = require('fs');
const path = require('path');
const { readPayload, readToolCall, warn, loadConfig, hookEnabled } = require('./sdd-hook-utils');
const { trackRead, hasRead, hasAnyRead } = require('./sdd-read-tracker');
const { resolveRepoPath } = require('./sdd-plan-state');

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

// Escrituras que fijan el contenido entero del fichero (crear o sobrescribir), frente a las
// parciales (Edit, replace_*), que modifican un contenido que el agente puede no conocer.
const FULL_WRITE_TOOLS = new Set([
  'Write',          // Claude Code
  'write_file',     // Gemini CLI
  'write_to_file',  // Antigravity CLI
  'create_file',
]);

// Firma estable (ver hooks/gate-signatures.json). Este hook es advisory-only: nunca deniega, asi
// que no existe una firma _BLOCK para el, solo esta _ADVISORY.
const ADVISORY_FIRMA = '[SDD_READ_EDIT_ADVISORY] ';

function advisory(filePath) {
  return ADVISORY_FIRMA + 'SDD: escribiendo ' + filePath + ' sin haberlo leido primero en esta '
    + 'sesion. Verifica que conoces el contenido actual antes de sobrescribirlo.';
}

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const cfg = loadConfig(path.join(__dirname, 'config.json')).sdd_read_before_edit || {};
  if (!hookEnabled('sdd_read_before_edit', cfg)) process.exit(0);
  if ((cfg.mode || 'advisory') !== 'advisory') {
    if (cfg.mode) {
      try {
        fs.writeSync(2, '[SDD] sdd_read_before_edit.mode=\'' + cfg.mode + '\' no reconocido '
          + '(solo \'advisory\' soportado) - el hook queda desactivado, no reforzado.\n');
      } catch {}
    }
    process.exit(0);
  }

  const call = readToolCall(data);
  const filePath = call.input.file_path || call.input.path
    || call.input.TargetFile || call.input.absolute_path || '';

  const sessionId = data.session_id || data.sessionId || '';
  if (!sessionId) process.exit(0);

  if (READ_TOOLS.has(call.name)) {
    if (filePath) trackRead(sessionId, filePath, data.cwd);
    process.exit(0);
  }

  if (!WRITE_TOOLS.has(call.name) || !filePath) process.exit(0);

  // Archivo nuevo, o ruta que no se puede situar en el proyecto: no habia nada que leer. La ruta
  // se ancla a la raiz del proyecto (resolveRepoPath, en sdd-plan-state.js) porque una comprobada
  // contra el directorio equivocado responde "no existe" en silencio y calla el aviso entero.
  // resolveRepoPath es idempotente sobre una absoluta: hasRead reutiliza la ya situada en vez de
  // volver a buscar la raiz del repositorio.
  const resolved = resolveRepoPath(filePath, data.cwd);
  const exists = !!resolved && fs.existsSync(resolved);
  const known = exists && hasRead(sessionId, resolved);

  // Solo se avisa si consta que el backend entrega lecturas: Claude Code siempre; los demas solo
  // si ya hubo alguna lectura. Se evalúa antes de registrar la escritura de abajo, que también
  // cuenta para hasAnyRead.
  const backendDeliversReads = READ_RELIABLE_WRITE_TOOLS.has(call.name)
    || hasAnyRead(sessionId);

  // Una escritura completa deja el contenido en manos del agente: la ruta pasa a ser conocida
  // en la sesión, y el Edit posterior sobre lo que él mismo escribió no avisa. Se registra antes
  // de las salidas tempranas porque crear un fichero es justo el caso que sale por «no existe».
  // Solo cuando el backend entrega lecturas: en otro, el registro activaría hasAnyRead y con él
  // avisos sobre ficheros cuya lectura el hook nunca llega a ver.
  if (FULL_WRITE_TOOLS.has(call.name) && backendDeliversReads) {
    trackRead(sessionId, filePath, data.cwd);
  }

  if (!exists || known || !backendDeliversReads) process.exit(0);

  // El aviso se decide con el estado previo a esta escritura: sobrescribir un fichero existente
  // sin leerlo sigue avisando, aunque la ruta quede ya registrada para el siguiente Edit.
  warn(advisory(filePath), call);
}

// Hook advisory-only: no entra por runWithFailOpen porque nunca emite un veredicto de bloqueo,
// asi que su fallo interno no puede leerse como uno. La guarda de ejecucion directa si aplica:
// importar el modulo para reutilizar sus constantes no debe disparar la lectura de stdin.
if (require.main === module) {
  main().catch(() => process.exit(0));
}

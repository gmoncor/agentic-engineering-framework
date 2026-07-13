#!/usr/bin/env node
'use strict';

/**
 * SDD Review Gate — PreToolUse / BeforeTool hook sobre comandos de shell.
 *
 * BLOQUEA `git commit` y `git merge` cuando no hay evidencia de que el codigo
 * entregado haya pasado la revision adversarial POST-implementacion.
 *
 * Reparto de responsabilidades:
 *   - sdd-pipeline-guard.js bloquea ESCRITURAS no declaradas en el plan (PRE).
 *   - sdd-review-gate.js    bloquea COMMITS sin revision del codigo (POST).
 *
 * La revision PRE-implementacion (revision de tasks, auditoria de la spec)
 * valida el PLAN, no el CODIGO: no satisface este gate.
 *
 * Evidencia aceptada (ver sdd-review-signal.js):
 *   a) marca [SDD-POST-IMPL: <hash>] en el propio mensaje de commit
 *   b) fichero de senal de la sesion, dentro de su TTL
 *
 * Degradacion segura (deja pasar):
 *   - el gate no esta habilitado en hooks/config.json
 *   - el payload no trae session_id (no hay sesion que correlacionar)
 *   - SDD_GUARD_SKIP=1 (escape de emergencia): degrada el bloqueo a aviso
 */

const fs = require('fs');
const path = require('path');
const { readPayload, skipRequested, warn, deny } = require('./sdd-hook-utils');
const { MARKER_RE, DEFAULT_TTL_MS, readSignal } = require('./sdd-review-signal');

const SHELL_TOOLS = new Set(['Bash', 'run_command']);
const GUARDED_CMD_RE = /\bgit\s+(commit|merge)\b/;

const DENY_REASON = 'SDD: revision del codigo no encontrada. El commit entrega codigo que nadie '
  + 'ha revisado. Ejecuta la revision adversarial POST-implementacion (/revision o la fase final '
  + 'de /implementar-spec) antes de commitear, o usa SDD_GUARD_SKIP=1 como escape puntual.';

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);
  if (!SHELL_TOOLS.has(data.tool_name || '')) process.exit(0);

  const cmd = ((data.tool_input || {}).command || '').trim();
  if (!GUARDED_CMD_RE.test(cmd)) process.exit(0);

  const config = loadConfig().sdd_review_gate || {};
  if (config.enabled !== true) process.exit(0);

  const sessionId = data.session_id || '';
  if (!sessionId) process.exit(0);

  if (MARKER_RE.test(cmd)) process.exit(0);
  if (readSignal(sessionId, ttlMs(config))) process.exit(0);

  if (skipRequested()) warn(DENY_REASON + ' [SDD_GUARD_SKIP=1: se permite el commit]');
  deny(DENY_REASON);
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

function ttlMs(config) {
  const hours = Number(config.ttl_hours);
  return hours > 0 ? hours * 60 * 60 * 1000 : DEFAULT_TTL_MS;
}

main().catch(() => process.exit(0));

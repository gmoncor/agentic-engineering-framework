#!/usr/bin/env node
'use strict';

/**
 * SDD Pipeline Guard (Codex) — hook PreToolUse sobre apply_patch.
 *
 * DENIEGA escribir codigo que el plan no respalda: hace falta una spec con Estado: APROBADA y una
 * task que declare el archivo en su tabla "Archivos afectados". La lectura del plan es la misma que
 * usa el guard de Claude Code / Gemini CLI (sdd-plan-state.js): un solo criterio para todos los
 * backends.
 *
 * Diferencia con los otros backends: aqui la edicion llega como un parche (apply_patch), no como una
 * herramienta con `file_path`. El parche puede tocar VARIOS archivos; se deniega si alguno de ellos
 * no esta declarado.
 *
 * Limite conocido: el payload de apply_patch no tiene un esquema publico estable. La extraccion de
 * rutas es best-effort (campos habituales + cabeceras del formato de parche). Si no se puede extraer
 * ninguna ruta, el hook AVISA en vez de denegar: bloquear a ciegas convertiria el guardarrail en un
 * freno arbitrario. Ese hueco es la razon por la que los hooks son un guardarrail y no una frontera
 * completa de enforcement.
 *
 * Escape de emergencia: SDD_GUARD_SKIP=1 degrada el bloqueo a aviso.
 */

const path = require('path');
const { readPayload, skipRequested, warn, deny } = require('./sdd-hook-utils');
const { isInsideAiDocs, findTasksDir, denialReason } = require('./sdd-plan-state');

const PATCH_TOOLS = new Set(['apply_patch', 'ApplyPatch']);

// Cabeceras del formato de parche: "*** Add File: ruta", Update, Delete, Move to.
const PATCH_HEADER_RE = /^\*\*\*\s+(?:Add|Update|Delete|Move to)\s+File:\s*(.+)$/gim;

const NO_PATHS_REASON = 'SDD: apply_patch no expone ninguna ruta legible en su payload, '
  + 'asi que no se puede comprobar contra el plan. Verifica a mano que los archivos del parche '
  + 'estan declarados en la tabla "Archivos afectados" de una task de la spec aprobada.';

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);
  if (!PATCH_TOOLS.has(data.tool_name || '')) process.exit(0);

  const files = extractPaths(data.tool_input || {});
  if (files.length === 0) warn(NO_PATHS_REASON);

  const targets = files
    .map(f => path.resolve(f))
    .filter(resolved => !isInsideAiDocs(resolved));
  if (targets.length === 0) process.exit(0);

  // Proyecto sin pipeline SDD: nada que enforcar.
  const tasksDir = findTasksDir(targets[0]);
  if (!tasksDir) process.exit(0);

  const reason = firstDenial(tasksDir, targets);
  if (!reason) process.exit(0);

  if (skipRequested()) warn(reason + ' [SDD_GUARD_SKIP=1: se permite la escritura]');
  deny(reason);
}

/** Un solo archivo no declarado invalida el parche entero: no se aplican parches a medias. */
function firstDenial(tasksDir, targets) {
  for (const resolved of targets) {
    const reason = denialReason(tasksDir, resolved);
    if (reason) return reason;
  }
  return null;
}

/**
 * Rutas que toca el parche. Best-effort sobre las formas conocidas del payload:
 *   - campos directos: file_path / path
 *   - mapa de cambios: changes: { "ruta": {...} }
 *   - texto del parche: input / patch / content, con cabeceras "*** Update File: ruta"
 */
function extractPaths(toolInput) {
  const direct = toolInput.file_path || toolInput.path;
  if (typeof direct === 'string' && direct) return [direct];

  if (toolInput.changes && typeof toolInput.changes === 'object') {
    const keys = Object.keys(toolInput.changes).filter(Boolean);
    if (keys.length > 0) return keys;
  }

  const patch = toolInput.input || toolInput.patch || toolInput.content;
  if (typeof patch !== 'string') return [];

  const files = [];
  for (const m of patch.matchAll(PATCH_HEADER_RE)) {
    const file = m[1].trim();
    if (file) files.push(file);
  }
  return files;
}

main().catch(() => process.exit(0));

#!/usr/bin/env node
'use strict';

/**
 * SDD Pipeline Guard — PreToolUse / BeforeTool hook.
 *
 * BLOQUEA la escritura de codigo fuente que no esta respaldada por el plan:
 *   1. Debe existir al menos una spec con Estado: APROBADA en ai_docs/tasks/.
 *   2. El archivo que se va a escribir debe estar declarado en la seccion
 *      "Archivos afectados" de alguna task derivada.
 *
 * La lectura del plan vive en sdd-plan-state.js, compartida con el guard de Codex.
 *
 * Archivos bajo ai_docs/ siempre permitidos (planificar es escribir docs).
 * Escape de emergencia: SDD_GUARD_SKIP=1 degrada el bloqueo a aviso.
 *
 * Al bloquear emite decision: deny por stdout (Claude Code) y sale con codigo 2
 * (Gemini CLI); ver sdd-hook-utils.js.
 *
 * Compatible con ambas CLIs:
 *   - Claude Code: PreToolUse matcher "Write|Edit"
 *   - Gemini CLI:  BeforeTool matcher "write_file|edit_file"
 *   - Codex:       ver sdd-pipeline-guard-codex.js (el payload de apply_patch es distinto)
 */

const path = require('path');
const { readPayload, skipRequested, warn, deny } = require('./sdd-hook-utils');
const { isInsideAiDocs, findTasksDir, denialReason } = require('./sdd-plan-state');

const WRITE_TOOLS = new Set([
  'Write', 'Edit',           // Claude Code
  'write_file', 'edit_file', // Gemini CLI
]);

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);
  if (!WRITE_TOOLS.has(data.tool_name || '')) process.exit(0);

  const toolInput = data.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || '';
  if (!filePath) process.exit(0);

  const resolved = path.resolve(filePath);
  if (isInsideAiDocs(resolved)) process.exit(0);

  // Proyecto sin pipeline SDD: nada que enforcar.
  const tasksDir = findTasksDir(resolved);
  if (!tasksDir) process.exit(0);

  const reason = denialReason(tasksDir, resolved);
  if (!reason) process.exit(0);

  if (skipRequested()) warn(reason + ' [SDD_GUARD_SKIP=1: se permite la escritura]');
  deny(reason);
}

main().catch(() => process.exit(0));

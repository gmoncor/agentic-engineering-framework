#!/usr/bin/env node
'use strict';

/**
 * SDD Pipeline Guard — hook previo a la ejecucion de una herramienta de escritura.
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
 * Herramientas de escritura por CLI (el payload se normaliza en sdd-hook-utils.js):
 *   - Claude Code:     PreToolUse matcher "Write|Edit"; la ruta llega en tool_input.file_path
 *   - Gemini CLI:      BeforeTool matcher "write_file|edit_file"
 *   - Antigravity CLI: PreToolUse matcher "write_to_file|replace_file_content|
 *                      multi_replace_file_content|create_file"; la ruta llega en args.TargetFile
 *   - Codex:           ver sdd-pipeline-guard-codex.js (el payload de apply_patch es distinto)
 */

const path = require('path');
const { readPayload, readToolCall, skipRequested, warn, deny } = require('./sdd-hook-utils');
const { isInsideAiDocs, findTasksDir, denialReason } = require('./sdd-plan-state');

const WRITE_TOOLS = new Set([
  'Write', 'Edit',              // Claude Code
  'write_file', 'edit_file',    // Gemini CLI
  'write_to_file',              // Antigravity CLI: escribe el archivo entero
  'replace_file_content',       // Antigravity CLI: sustituye fragmentos de un archivo
  'multi_replace_file_content', // Antigravity CLI: sustituye fragmentos de varios archivos
  'create_file',                // Antigravity CLI: crea un archivo
]);

const NO_PATH_REASON = 'SDD: la herramienta de escritura no expone ninguna ruta legible en su '
  + 'payload, asi que no se puede comprobar contra el plan. Verifica a mano que el archivo esta '
  + 'declarado en la tabla "Archivos afectados" de una task de la spec aprobada.';

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const call = readToolCall(data);
  if (!WRITE_TOOLS.has(call.name)) process.exit(0);

  const filePath = call.input.file_path || call.input.path || call.input.TargetFile || '';
  // Una escritura sin ruta legible no se puede contrastar con el plan. Se declara el hueco en vez
  // de dejarla pasar en silencio, que es lo que convertiria el guardarrail en un adorno.
  if (!filePath) warn(NO_PATH_REASON, call);

  const resolved = path.resolve(filePath);
  if (isInsideAiDocs(resolved)) process.exit(0);

  // Proyecto sin pipeline SDD: nada que enforcar.
  const tasksDir = findTasksDir(resolved);
  if (!tasksDir) process.exit(0);

  const reason = denialReason(tasksDir, resolved);
  if (!reason) process.exit(0);

  if (skipRequested()) warn(reason + ' [SDD_GUARD_SKIP=1: se permite la escritura]', call);
  deny(reason, call);
}

main().catch(() => process.exit(0));

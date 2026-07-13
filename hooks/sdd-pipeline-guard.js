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
 * Sin el punto 2 el guard seria inutil: bastaria una spec aprobada para dejar
 * pasar cualquier escritura durante el resto de la vida del proyecto.
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
 */

const fs = require('fs');
const path = require('path');
const { readPayload, skipRequested, warn, deny } = require('./sdd-hook-utils');
const { parseAffectedFiles } = require('./sdd-task-files');

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

  const reason = evaluate(tasksDir, resolved);
  if (!reason) process.exit(0);

  if (skipRequested()) warn(reason + ' [SDD_GUARD_SKIP=1: se permite la escritura]');
  deny(reason);
}

/** Retorna el motivo del bloqueo, o null si la escritura esta respaldada por el plan. */
function evaluate(tasksDir, resolved) {
  if (findApprovedSpecs(tasksDir).length === 0) {
    return 'SDD: no hay ninguna spec con Estado: APROBADA en ai_docs/tasks/. '
      + 'Ejecuta /planificar y aprueba la spec antes de escribir codigo.';
  }

  if (findTaskFiles(tasksDir).length === 0) {
    return 'SDD: hay spec aprobada pero ninguna task derivada en ai_docs/tasks/. '
      + 'Deriva las tasks antes de escribir codigo.';
  }

  if (findDeclaredFiles(tasksDir).has(resolved)) return null;

  return 'SDD: el archivo ' + resolved + ' no esta declarado en ninguna task de la spec activa. '
    + 'Anadelo a la tabla "Archivos afectados" de la task correspondiente '
    + '(| `ruta/al/archivo` | CREAR/MODIFICAR/ELIMINAR | descripcion |), '
    + 'o usa SDD_GUARD_SKIP=1 como escape puntual de emergencia.';
}

function isInsideAiDocs(resolved) {
  return resolved.split(path.sep).includes('ai_docs');
}

/** Sube desde el directorio del archivo buscando ai_docs/tasks/. */
function findTasksDir(filePath) {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'ai_docs', 'tasks');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Specs spec_*.md con "Estado: APROBADA". Retorna paths absolutos. */
function findApprovedSpecs(tasksDir) {
  return listFiles(tasksDir)
    .filter(f => f.startsWith('spec_') && f.endsWith('.md'))
    .map(f => path.join(tasksDir, f))
    .filter(p => /\*?\*?Estado:\*?\*?\s*APROBADA/.test(readText(p)));
}

/** Tasks NNN_*.md. Retorna paths absolutos. */
function findTaskFiles(tasksDir) {
  return listFiles(tasksDir)
    .filter(f => /^\d{3}_/.test(f) && f.endsWith('.md'))
    .map(f => path.join(tasksDir, f));
}

/**
 * Set de paths absolutos declarados en las tasks. Los paths de una task son
 * relativos a la raiz del proyecto (el padre de ai_docs/): se resuelven contra
 * ella para que "src/foo.js" y "./src/foo.js" comparen igual.
 */
function findDeclaredFiles(tasksDir) {
  const projectRoot = path.resolve(tasksDir, '..', '..');
  const declared = new Set();

  for (const taskPath of findTaskFiles(tasksDir)) {
    for (const rel of parseAffectedFiles(readText(taskPath))) {
      declared.add(path.resolve(projectRoot, rel));
    }
  }
  return declared;
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

main().catch(() => process.exit(0));

'use strict';

/**
 * Estado del plan SDD leido de ai_docs/tasks/.
 *
 * SSOT de la pregunta "esta esta escritura respaldada por el plan?": la comparten los guards de
 * pipeline de todos los backends. Si cambia el formato de specs o tasks, cambia en un solo sitio.
 */

const fs = require('fs');
const path = require('path');
const { parseAffectedFiles } = require('./sdd-task-files');

/** Escribir documentacion ES planificar: ai_docs/ nunca se bloquea. */
function isInsideAiDocs(resolved) {
  return resolved.split(path.sep).includes('ai_docs');
}

/** Sube desde el directorio del archivo buscando ai_docs/tasks/. null = proyecto sin pipeline SDD. */
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

/**
 * Motivo por el que el plan no respalda la escritura de `resolved`, o null si la respalda.
 *
 * Sin la comprobacion del archivo declarado el guard seria inutil: bastaria una spec aprobada para
 * dejar pasar cualquier escritura durante el resto de la vida del proyecto.
 */
function denialReason(tasksDir, resolved) {
  if (findApprovedSpecs(tasksDir).length === 0) {
    return 'SDD: no hay ninguna spec con Estado: APROBADA en ai_docs/tasks/. '
      + 'Planifica y aprueba la spec antes de escribir codigo.';
  }

  if (findActiveTaskFiles(tasksDir).length === 0) {
    return 'SDD: hay spec aprobada pero ninguna task derivada de ella en ai_docs/tasks/. '
      + 'Deriva las tasks (cada una debe citar su spec madre) antes de escribir codigo.';
  }

  if (findDeclaredFiles(tasksDir).has(resolved)) return null;

  return 'SDD: el archivo ' + resolved + ' no esta declarado en ninguna task de la spec activa. '
    + 'Anadelo a la tabla "Archivos afectados" de la task correspondiente '
    + '(| `ruta/al/archivo` | CREAR/MODIFICAR/ELIMINAR | descripcion |), '
    + 'o usa SDD_GUARD_SKIP=1 como escape puntual de emergencia.';
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
 * Identificadores con los que una task puede citar a su spec madre: el nombre del fichero
 * (spec_pagos.md), su raiz (spec_pagos), su descriptor (pagos) y el titulo de su encabezado.
 * Se descartan los de menos de 4 caracteres: un identificador corto acertaria por casualidad.
 */
function specIdentifiers(specPath) {
  const base = path.basename(specPath);
  const stem = base.replace(/\.md$/i, '');
  const descriptor = stem.replace(/^spec_/i, '');
  const heading = (readText(specPath).match(/^#{1,6}\s+(?:Spec:\s*)?(.+?)\s*$/m) || [])[1];

  return [base, stem, descriptor, heading]
    .filter(Boolean)
    .map(s => String(s).trim().toLowerCase())
    .filter(s => s.length >= 4);
}

/**
 * Tasks que pertenecen a alguna spec APROBADA, es decir, que la citan.
 *
 * Acotar a la spec activa es lo que mantiene util al guard: la union de TODAS las tasks del
 * directorio crece con el historial del proyecto, y con ella el permiso de escritura. Al cabo de
 * unos meses el guard autorizaria cualquier archivo que alguna task vieja declarase alguna vez.
 */
function findActiveTaskFiles(tasksDir) {
  const identificadores = findApprovedSpecs(tasksDir).flatMap(specIdentifiers);
  if (identificadores.length === 0) return [];

  return findTaskFiles(tasksDir).filter(taskPath => {
    const texto = readText(taskPath).toLowerCase();
    return identificadores.some(id => texto.includes(id));
  });
}

/**
 * Set de paths absolutos declarados en las tasks de la spec activa. Los paths de una task son
 * relativos a la raiz del proyecto (el padre de ai_docs/): se resuelven contra ella para que
 * "src/foo.js" y "./src/foo.js" comparen igual.
 */
function findDeclaredFiles(tasksDir) {
  const projectRoot = path.resolve(tasksDir, '..', '..');
  const declared = new Set();

  for (const taskPath of findActiveTaskFiles(tasksDir)) {
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

module.exports = {
  isInsideAiDocs,
  findTasksDir,
  denialReason,
  findApprovedSpecs,
  findTaskFiles,
  findActiveTaskFiles,
  findDeclaredFiles,
};

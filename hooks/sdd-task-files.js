'use strict';

/**
 * Formato de la seccion "Archivos afectados" de una task.
 *
 * SSOT del parser: lo consumen el guard de pipeline (bloquea escrituras que
 * ninguna task declara) y el workflow de implementacion (verifica que dos tasks
 * paralelas no escriben el mismo archivo). Un solo parser para los dos: si el
 * formato de la tabla cambia, cambia en un unico sitio.
 *
 * Formato (dev_templates/tareas.md, Paso 3):
 *   ## Archivos afectados
 *   | Archivo | Accion | Descripcion del cambio |
 *   |---------|--------|----------------------|
 *   | `ruta/al/archivo` | CREAR / MODIFICAR / ELIMINAR | ... |
 */

const AFFECTED_HEADING_RE = /^#{1,6}\s+Archivos\s+afectados\s*$/i;
const ACTION_RE = /^(CREAR|MODIFICAR|ELIMINAR)\b/i;
const PLACEHOLDER_RE = /^ruta\/archivo\./i;

/** Extrae la columna "Archivo" de la tabla bajo el encabezado "Archivos afectados". */
function parseAffectedFiles(content) {
  const files = [];
  let inSection = false;

  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = AFFECTED_HEADING_RE.test(line);
      continue;
    }
    if (!inSection || !line.trim().startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    // La accion en la segunda columna descarta cabecera y separador de la tabla.
    if (cells.length < 2 || !ACTION_RE.test(cells[1])) continue;

    const file = cells[0].replace(/`/g, '').trim();
    if (file && !PLACEHOLDER_RE.test(file)) files.push(file);
  }
  return files;
}

module.exports = { parseAffectedFiles };

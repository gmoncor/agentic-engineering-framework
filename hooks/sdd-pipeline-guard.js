#!/usr/bin/env node

/**
 * SDD Pipeline Guard — PreToolUse / BeforeTool hook.
 *
 * Advisory (no bloquea): si se va a escribir codigo fuente sin spec
 * aprobada Y tasks derivadas en ai_docs/tasks/, avisa por stdout (JSON
 * decision:warn para Claude Code) y por stderr (texto para Gemini CLI).
 * Refuerza: planificacion completa antes de implementar.
 *
 * Compatible con ambas CLIs:
 *   - Claude Code: PreToolUse matcher "Write|Edit"
 *   - Gemini CLI:  BeforeTool matcher "write_file|edit_file"
 */

const fs = require('fs');
const path = require('path');

// Tools de escritura en ambas CLIs
const WRITE_TOOLS = new Set([
  'Write', 'Edit',           // Claude Code
  'write_file', 'edit_file', // Gemini CLI
]);

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const toolName = data.tool_name || '';
  if (!WRITE_TOOLS.has(toolName)) process.exit(0);

  const toolInput = data.tool_input || {};
  const filePath = toolInput.file_path || toolInput.path || '';
  if (!filePath) process.exit(0);

  // Archivos dentro de ai_docs/ siempre permitidos (crear/editar docs es OK)
  const resolved = path.resolve(filePath);
  if (resolved.includes(`${path.sep}ai_docs${path.sep}`) || resolved.includes('/ai_docs/')) {
    process.exit(0);
  }

  // Buscar directorio ai_docs/tasks/ subiendo desde el archivo destino
  const tasksDir = findTasksDir(resolved);
  if (!tasksDir) process.exit(0);

  const approvedSpecs = findApprovedSpecs(tasksDir);
  const taskFiles = findTaskFiles(tasksDir);

  const warnings = [];
  if (approvedSpecs.length === 0) {
    warnings.push('No hay specs aprobadas en ai_docs/tasks/.');
  }
  if (taskFiles.length === 0) {
    warnings.push('No hay tasks derivadas en ai_docs/tasks/.');
  }

  if (warnings.length === 0) process.exit(0);

  const reason = 'SDD: ' + warnings.join(' ') + ' Ejecuta /planificar antes de implementar.';
  console.log(JSON.stringify({ decision: 'warn', reason }));
  process.stderr.write(`[SDD_PIPELINE] ${reason}\n`);
  process.exit(0);
}

/**
 * Sube desde el directorio del archivo buscando ai_docs/tasks/.
 */
function findTasksDir(filePath) {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'ai_docs', 'tasks');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Busca archivos spec_*.md con "Estado: APROBADA" o "APROBADA" en su contenido.
 */
function findApprovedSpecs(tasksDir) {
  try {
    return fs.readdirSync(tasksDir)
      .filter(f => f.startsWith('spec_') && f.endsWith('.md'))
      .filter(f => {
        const content = fs.readFileSync(path.join(tasksDir, f), 'utf8');
        return /\*?\*?Estado:\*?\*?\s*APROBADA/.test(content);
      });
  } catch {
    return [];
  }
}

/**
 * Busca archivos NNN_*.md (tasks numeradas) en el directorio de tasks.
 */
function findTaskFiles(tasksDir) {
  try {
    return fs.readdirSync(tasksDir)
      .filter(f => /^\d{3}_/.test(f) && f.endsWith('.md'));
  } catch {
    return [];
  }
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = { main, findTasksDir, findApprovedSpecs, findTaskFiles };

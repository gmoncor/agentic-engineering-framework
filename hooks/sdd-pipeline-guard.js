#!/usr/bin/env node

/**
 * SDD Pipeline Guard — PreToolUse / BeforeTool hook.
 *
 * Advisory (no bloquea): si se va a escribir codigo fuente sin una spec
 * aprobada en ai_docs/tasks/, avisa por stdout (JSON decision:warn para
 * Claude Code) y por stderr (texto para Gemini CLI). Refuerza la regla
 * "toda solicitud empieza con una spec", sin frenar primeros usos.
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
  if (approvedSpecs.length > 0) process.exit(0);

  // Sin specs aprobadas: emitir warning advisory
  const reason =
    'SDD: No hay specs aprobadas en ai_docs/tasks/. ' +
    'Crea una spec con /spec antes de implementar.';

  // Claude Code consume JSON en stdout
  console.log(JSON.stringify({ decision: 'warn', reason }));

  // Gemini CLI consume texto en stderr
  process.stderr.write(`[SDD_SIN_SPEC] ${reason}\n`);

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
        return content.includes('APROBADA');
      });
  } catch {
    return [];
  }
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = { main, findTasksDir, findApprovedSpecs };

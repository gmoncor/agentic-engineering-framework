'use strict';

/**
 * Reglas de commit del framework, compartidas por los guards de commit de todos los backends.
 *
 * Dos niveles:
 *   - Bypass del ciclo de calidad (--no-verify): se DENIEGA. No hay uso legitimo dentro del flujo.
 *   - Formato del mensaje y fugas de andamiaje: se AVISA. El humano juzga.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');

const VALID_TYPES = ['feat', 'fix', 'update', 'refactor', 'create', 'optimize', 'remove', 'rename', 'docs', 'test', 'style', 'chore'];
const SUBJECT_MAX_LEN = 72;

// Tipos que cambian comportamiento: su commit documenta una decision, asi que el cuerpo con el
// QUE y el POR QUE es esperable. docs/test/style/chore quedan exentos (suelen ser autoexplicativos).
const FUNCTIONAL_TYPES = ['feat', 'fix', 'update', 'refactor', 'create', 'optimize', 'remove'];
const BODY_MIN_LEN = 10;

const SCAFFOLDING_DIRS = ['.cursor'];

const FORBIDDEN_COAUTHOR_RE = /co-authored-by:\s*.*(?:claude|anthropic|gemini|google\s+ai|openai|codex)/i;

// git commit y git push con --no-verify saltan los ganchos de calidad del repositorio.
// En commit, -n es el alias corto de --no-verify (en push, -n es --dry-run: inofensivo).
const NO_VERIFY_RE = /\bgit\s+(?:commit|push)\b[^\n]*\s--no-verify\b/;
const COMMIT_SHORT_NO_VERIFY_RE = /\bgit\s+commit\b[^\n]*\s-n(?:\s|$)/;

// Sin anclar al inicio: el comando puede venir envuelto ("cd x && git commit ...") o como argv.
const GIT_COMMIT_RE = /\bgit\s+commit\b/;
const GH_PR_RE = /\bgh\s+pr\s+(create|edit)\b/;

const NO_VERIFY_REASON = 'SDD: --no-verify salta los ganchos de calidad del repositorio. '
  + 'Si un gancho falla, corrige la causa; no lo esquives. '
  + 'Escape puntual de emergencia: SDD_GUARD_SKIP=1.';

function usesNoVerify(cmd) {
  return NO_VERIFY_RE.test(cmd) || COMMIT_SHORT_NO_VERIFY_RE.test(cmd);
}

function isGitCommit(cmd) {
  return GIT_COMMIT_RE.test(cmd);
}

function isGhPr(cmd) {
  return GH_PR_RE.test(cmd);
}

/**
 * Tasks de convergencia (NNN_convergencia_*.md) con Estado: PENDIENTE en ai_docs/tasks/.
 *
 * La garantia de convergencia deja estas tasks como rastro de brechas entre la spec y el codigo
 * final; sin este chequeo nada impide abrir una PR ignorandolas. Silencioso ante cualquier fallo
 * de lectura: un proyecto sin ai_docs/tasks/ (o sin permisos sobre un fichero puntual) no es motivo
 * para bloquear ni ensuciar stderr.
 */
function pendingConvergenceTasks() {
  let entries;
  try {
    entries = fs.readdirSync('ai_docs/tasks');
  } catch {
    return [];
  }

  return entries
    .filter(f => /_convergencia_.*\.md$/.test(f))
    .map(f => 'ai_docs/tasks/' + f)
    .filter(taskPath => {
      try {
        const head = fs.readFileSync(taskPath, 'utf8').split('\n').slice(0, 10).join('\n');
        return /Estado:\s*PENDIENTE/.test(head);
      } catch {
        return false;
      }
    });
}

/** Avisos (no bloqueantes) sobre un comando git commit / gh pr. Lista vacia = nada que decir. */
function commitWarnings(cmd) {
  const warnings = [];

  if (isGitCommit(cmd)) {
    const msg = extractCommitMessage(cmd);
    if (msg) warnings.push(...messageWarnings(msg));

    const scaffolding = stagedFiles().filter(f => SCAFFOLDING_DIRS.some(d => f.startsWith(d + '/')));
    if (scaffolding.length > 0) {
      warnings.push(`SCAFFOLDING_STAGED: archivos de configuracion IDE staged: ${scaffolding.join(', ')}`);
    }
  }

  if (isGhPr(cmd)) {
    const body = extractPrBody(cmd);
    if (body && FORBIDDEN_COAUTHOR_RE.test(body)) {
      warnings.push('PR_COAUTHOR_FORBIDDEN: Co-Authored-By con nombre de IA en body del PR — eliminar');
    }

    const pending = pendingConvergenceTasks();
    if (pending.length > 0) {
      warnings.push('CONVERGENCE_PENDING: hay tasks de convergencia sin resolver: '
        + pending.join(', ') + ' -- revisa antes de abrir la PR');
    }
  }

  return warnings;
}

function messageWarnings(msg) {
  const warnings = [];
  const subject = msg.split('\n')[0];

  if (subject.length > SUBJECT_MAX_LEN) {
    warnings.push(`COMMIT_SUBJECT_TOO_LONG: subject tiene ${subject.length} chars (max ${SUBJECT_MAX_LEN})`);
  }

  const typeMatch = subject.match(/^(\w+)[\s(:]/);
  const type = typeMatch ? typeMatch[1].toLowerCase() : null;

  if (type && !VALID_TYPES.includes(type)) {
    warnings.push(`COMMIT_TYPE_INVALID: tipo "${typeMatch[1]}" no esta en [${VALID_TYPES.join(', ')}]`);
  }

  if (type && FUNCTIONAL_TYPES.includes(type) && commitBody(msg).length < BODY_MIN_LEN) {
    warnings.push('COMMIT_BODY_MISSING: el cuerpo del commit debe explicar QUE se cambio y POR QUE. '
      + 'Un commit funcional sin cuerpo pierde valor como documentacion.');
  }

  if (FORBIDDEN_COAUTHOR_RE.test(msg)) {
    warnings.push('COMMIT_COAUTHOR_FORBIDDEN: Co-Authored-By con nombre de IA detectado — eliminar');
  }

  return warnings;
}

// El cuerpo es todo lo que sigue a la primera linea (el subject). git une los sucesivos -m con una
// linea en blanco, asi que "feat: x" -m "por que" llega como "feat: x\n\npor que".
function commitBody(msg) {
  const nl = msg.indexOf('\n');
  return nl === -1 ? '' : msg.slice(nl + 1).trim();
}

function extractCommitMessage(cmd) {
  const heredoc = heredocBody(cmd);
  if (heredoc) return heredoc;

  const patterns = [
    /-m\s+"([^"]+)"/g,
    /-m\s+'([^']+)'/g,
    /--message="([^"]+)"/g,
    /--message='([^']+)'/g,
    /--message=(\S+)/g,
  ];
  const parts = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(cmd)) !== null) parts.push(m[1]);
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function extractPrBody(cmd) {
  const heredoc = heredocBody(cmd);
  if (heredoc) return heredoc;

  const m = cmd.match(/--body\s+"([^"]+)"/);
  return m ? m[1] : null;
}

function heredocBody(cmd) {
  const m = cmd.match(/\$\(\s*cat\s+<<\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\s*\)/);
  return m ? m[2] : null;
}

function stagedFiles() {
  try {
    const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return result.stdout.split('\n').filter(Boolean);
  } catch {}
  return [];
}

module.exports = {
  VALID_TYPES,
  SUBJECT_MAX_LEN,
  NO_VERIFY_REASON,
  usesNoVerify,
  isGitCommit,
  isGhPr,
  pendingConvergenceTasks,
  commitWarnings,
  extractCommitMessage,
  extractPrBody,
};

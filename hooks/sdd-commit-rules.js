'use strict';

/**
 * Reglas de commit del framework, compartidas por los guards de commit de todos los backends.
 *
 * Dos niveles:
 *   - Bypass del ciclo de calidad (--no-verify): se DENIEGA. No hay uso legitimo dentro del flujo.
 *   - Formato del mensaje y fugas de andamiaje: se AVISA. El humano juzga.
 */

const { spawnSync } = require('child_process');

const VALID_TYPES = ['feat', 'fix', 'update', 'refactor', 'create', 'optimize', 'remove', 'rename', 'docs', 'test', 'style', 'chore'];
const SUBJECT_MAX_LEN = 72;

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
  if (typeMatch && !VALID_TYPES.includes(typeMatch[1].toLowerCase())) {
    warnings.push(`COMMIT_TYPE_INVALID: tipo "${typeMatch[1]}" no esta en [${VALID_TYPES.join(', ')}]`);
  }

  if (FORBIDDEN_COAUTHOR_RE.test(msg)) {
    warnings.push('COMMIT_COAUTHOR_FORBIDDEN: Co-Authored-By con nombre de IA detectado — eliminar');
  }

  return warnings;
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
  commitWarnings,
  extractCommitMessage,
  extractPrBody,
};

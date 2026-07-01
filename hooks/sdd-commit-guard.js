#!/usr/bin/env node
'use strict';

// SDD Commit Guard — PreToolUse hook (Bash matcher).
// Verifica formato de commits y previene scaffolding leaks en git commit/gh pr create.
// Compatible con Claude Code y Gemini CLI.

const { spawnSync } = require('child_process');

const VALID_TYPES = ['feat', 'fix', 'update', 'refactor', 'create', 'optimize', 'remove', 'rename', 'docs', 'test', 'style', 'chore'];
const SUBJECT_MAX_LEN = 72;

const SCAFFOLDING_DIRS = ['.cursor'];

const FORBIDDEN_COAUTHOR_RE = /co-authored-by:\s*.*(?:claude|anthropic|gemini|google\s+ai)/i;

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); }

  if (!['Bash', 'run_command'].includes(data.tool_name || '')) process.exit(0);

  const cmd = ((data.tool_input || {}).command || '').trim();

  const isGitCommit = /^git\s+commit/.test(cmd);
  const isGhPr = /^gh\s+pr\s+(create|edit)/.test(cmd);
  if (!isGitCommit && !isGhPr) process.exit(0);

  const warnings = [];

  if (isGitCommit) {
    const msg = extractCommitMessage(cmd);
    if (msg) {
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
    }

    const staged = getStagedFiles();
    const scaffolding = staged.filter(f => SCAFFOLDING_DIRS.some(d => f.startsWith(d + '/')));
    if (scaffolding.length > 0) {
      warnings.push(`SCAFFOLDING_STAGED: archivos de configuracion IDE staged: ${scaffolding.join(', ')}`);
    }
  }

  if (isGhPr) {
    const body = extractPrBody(cmd);
    if (body && FORBIDDEN_COAUTHOR_RE.test(body)) {
      warnings.push('PR_COAUTHOR_FORBIDDEN: Co-Authored-By con nombre de IA en body del PR — eliminar');
    }
  }

  if (warnings.length > 0) {
    const reason = 'SDD Commit Guard:\n' + warnings.map(w => '  - ' + w).join('\n');
    console.log(JSON.stringify({ decision: 'warn', reason }));
    process.stderr.write(`[SDD_COMMIT_GUARD] ${reason}\n`);
  }

  process.exit(0);
}

function extractCommitMessage(cmd) {
  const heredoc = cmd.match(/\$\(\s*cat\s+<<\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\s*\)/);
  if (heredoc) return heredoc[2];

  const patterns = [
    /-m\s+"([^"]+)"/,
    /-m\s+'([^']+)'/,
    /--message=["']?([^"'\s]+)["']?/,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractPrBody(cmd) {
  const heredoc = cmd.match(/\$\(\s*cat\s+<<\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\s*\)/);
  if (heredoc) return heredoc[2];

  const m = cmd.match(/--body\s+"([^"]+)"/);
  return m ? m[1] : null;
}

function getStagedFiles() {
  try {
    const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return result.stdout.split('\n').filter(Boolean);
  } catch {}
  return [];
}

main().catch(() => process.exit(0));

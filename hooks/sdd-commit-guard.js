#!/usr/bin/env node
'use strict';

// SDD Commit Guard — PreToolUse / BeforeTool hook sobre comandos de shell.
// Advisory: verifica el formato del commit y detecta fugas de andamiaje en git commit / gh pr.
// Las reglas viven en sdd-commit-rules.js (compartidas con el guard de Codex).
// Compatible con Claude Code (Bash) y Gemini CLI (run_command).

const { readPayload } = require('./sdd-hook-utils');
const { isGitCommit, isGhPr, commitWarnings } = require('./sdd-commit-rules');

const SHELL_TOOLS = new Set(['Bash', 'run_command']);

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);
  if (!SHELL_TOOLS.has(data.tool_name || '')) process.exit(0);

  const cmd = ((data.tool_input || {}).command || '').trim();
  if (!isGitCommit(cmd) && !isGhPr(cmd)) process.exit(0);

  const warnings = commitWarnings(cmd);
  if (warnings.length === 0) process.exit(0);

  const reason = 'SDD Commit Guard:\n' + warnings.map(w => '  - ' + w).join('\n');
  console.log(JSON.stringify({ decision: 'warn', reason }));
  process.stderr.write(`[SDD_COMMIT_GUARD] ${reason}\n`);
  process.exit(0);
}

main().catch(() => process.exit(0));

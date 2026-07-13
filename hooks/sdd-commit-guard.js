#!/usr/bin/env node
'use strict';

// SDD Commit Guard — hook previo a la ejecucion de un comando de shell.
// Advisory: verifica el formato del commit y detecta fugas de andamiaje en git commit / gh pr.
// Las reglas viven en sdd-commit-rules.js (compartidas con el guard de Codex).
//
// Herramienta de shell por CLI (el payload se normaliza en sdd-hook-utils.js):
//   - Claude Code:     Bash,        el comando llega en tool_input.command
//   - Gemini CLI:      run_command, el comando llega en tool_input.command
//   - Antigravity CLI: run_command, el comando llega en args.CommandLine

const { readPayload, readToolCall, warn } = require('./sdd-hook-utils');
const { isGitCommit, isGhPr, commitWarnings } = require('./sdd-commit-rules');

const SHELL_TOOLS = new Set(['Bash', 'run_command']);

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const call = readToolCall(data);
  if (!SHELL_TOOLS.has(call.name)) process.exit(0);

  const cmd = (call.input.command || call.input.CommandLine || '').trim();
  if (!isGitCommit(cmd) && !isGhPr(cmd)) process.exit(0);

  const warnings = commitWarnings(cmd);
  if (warnings.length === 0) process.exit(0);

  warn('SDD Commit Guard:\n' + warnings.map(w => '  - ' + w).join('\n'), call);
}

main().catch(() => process.exit(0));

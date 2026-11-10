#!/usr/bin/env node
'use strict';

// SDD Commit Guard — hook previo a la ejecucion de un comando de shell.
// DENIEGA `git commit --no-verify` / `git push --no-verify` (y el alias corto `-n` en commit):
// saltarse los ganchos de calidad del repositorio no tiene uso legitimo dentro del flujo.
// El resto de problemas del commit (formato del mensaje, fugas de andamiaje) es Advisory.
// Las reglas viven en sdd-commit-rules.js (compartidas con el guard de Codex).
//
// Herramienta de shell por CLI (el payload se normaliza en sdd-hook-utils.js):
//   - Claude Code:     Bash o PowerShell, el comando llega en tool_input.command. La tokenizacion
//                       POSIX no cubre escapes con comilla invertida, -and/-or, &, ni here-strings.
//   - Gemini CLI:      run_shell_command, el comando llega en tool_input.command
//   - Antigravity CLI: run_command, el comando llega en args.CommandLine
//
// Escape de emergencia: SDD_GUARD_SKIP=1 degrada el bloqueo de --no-verify a aviso.

const {
  readPayload, readToolCall, skipRequested, hookApagado, loadConfig, ALLOW,
  warnResult, denyResult, emitResult, runWithFailOpen,
} = require('./sdd-hook-utils');
const path = require('path');
const { isGitCommit, isGhPr, commitWarnings, usesNoVerify, NO_VERIFY_REASON } = require('./sdd-commit-rules');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'run_shell_command', 'run_command']);

function runHook(input, deps) {
  const options = deps || {};
  const env = options.env || process.env;
  const config = options.config || loadConfig(path.join(__dirname, 'config.json'));
  if (hookApagado('sdd-commit-guard', config)) return ALLOW;

  const call = readToolCall(input);
  if (!SHELL_TOOLS.has(call.name)) return ALLOW;

  const cmd = (call.input.command || call.input.CommandLine || '').trim();

  if (usesNoVerify(cmd)) {
    if (skipRequested(env)) return warnResult(NO_VERIFY_REASON + ' [SDD_GUARD_SKIP=1: se permite el comando]', call);
    return denyResult(NO_VERIFY_REASON, call);
  }

  if (!isGitCommit(cmd) && !isGhPr(cmd)) return ALLOW;

  const warnings = commitWarnings(cmd, input);
  if (warnings.length === 0) return ALLOW;

  return warnResult('SDD Commit Guard:\n' + warnings.map(w => '  - ' + w).join('\n'), call);
}

async function main() {
  const data = await readPayload();
  emitResult(data ? runHook(data) : ALLOW);
}

// El fallo interno sale por runWithFailOpen (exit 0 + aviso firmado), nunca como veredicto.
if (require.main === module) {
  runWithFailOpen('sdd-commit-guard', main);
}

module.exports = { runHook };

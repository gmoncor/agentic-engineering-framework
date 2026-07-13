#!/usr/bin/env node
'use strict';

/**
 * SDD Commit Guard (Codex) — hook PreToolUse sobre comandos de shell.
 *
 * DENIEGA `git commit --no-verify` y `git push --no-verify`: saltarse los ganchos de calidad del
 * repositorio no tiene uso legitimo dentro del flujo. Si un gancho falla, se corrige la causa.
 * El resto de problemas del commit (asunto largo, tipo invalido, coautoria de IA, andamiaje de IDE
 * staged) se AVISAN, no bloquean.
 *
 * Las reglas viven en sdd-commit-rules.js, compartidas con el guard de los demas backends.
 *
 * Refuerzo: la regla de politica de ejecucion .codex/rules/sdd-enforcement.rules prohibe los mismos
 * comandos. Dos capas porque una sola no cubre todas las rutas: los hooks son un guardarrail, no una
 * frontera completa de enforcement.
 *
 * Escape de emergencia: SDD_GUARD_SKIP=1 degrada el bloqueo a aviso.
 */

const { readPayload, skipRequested, warn, deny } = require('./sdd-hook-utils');
const { usesNoVerify, isGitCommit, isGhPr, commitWarnings, NO_VERIFY_REASON } = require('./sdd-commit-rules');

const SHELL_TOOLS = new Set(['shell', 'local_shell', 'Bash']);

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);
  if (!SHELL_TOOLS.has(data.tool_name || '')) process.exit(0);

  const cmd = readCommand(data.tool_input || {});
  if (!cmd) process.exit(0);

  if (usesNoVerify(cmd)) {
    if (skipRequested()) warn(NO_VERIFY_REASON + ' [SDD_GUARD_SKIP=1: se permite el comando]');
    deny(NO_VERIFY_REASON);
  }

  if (!isGitCommit(cmd) && !isGhPr(cmd)) process.exit(0);

  const warnings = commitWarnings(cmd);
  if (warnings.length === 0) process.exit(0);

  warn('SDD Commit Guard:\n' + warnings.map(w => '  - ' + w).join('\n'));
}

/** El shell de Codex entrega el comando como string o como argv (["bash", "-lc", "git commit ..."]). */
function readCommand(toolInput) {
  const cmd = toolInput.command;
  if (typeof cmd === 'string') return cmd.trim();
  if (Array.isArray(cmd)) return cmd.map(String).join(' ').trim();
  return '';
}

main().catch(() => process.exit(0));

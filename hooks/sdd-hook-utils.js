'use strict';

// Utilidades compartidas por los hooks SDD.
// Emite decisiones en el formato que entienden Claude Code (JSON por stdout),
// Gemini CLI / Codex (texto por stderr + codigo de salida) y Antigravity CLI
// (JSON por stdout, sin codigo de salida en su contrato).

const fs = require('fs');

const SKIP_ENV = 'SDD_GUARD_SKIP';

async function readPayload() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function skipRequested(env) {
  return (env || process.env)[SKIP_ENV] === '1';
}

/**
 * Normaliza la llamada a herramienta de las CLIs soportadas a una forma unica.
 *
 * Dos familias de payload:
 *   - snake_case: { tool_name, tool_input } — Claude Code, Gemini CLI, Codex.
 *   - camelCase:  { toolCall: { name, args } } — Antigravity CLI (codificacion protojson).
 *
 * `stdoutOnly` marca la segunda: ahi la decision viaja SOLO en el JSON de stdout y el codigo de
 * salida no forma parte del contrato, asi que salir con != 0 solo simularia un fallo del hook.
 */
function readToolCall(data) {
  const call = data && data.toolCall;
  if (call && typeof call === 'object') {
    return { name: call.name || '', input: call.args || {}, stdoutOnly: true };
  }
  return {
    name: (data && data.tool_name) || '',
    input: (data && data.tool_input) || {},
    stdoutOnly: false,
  };
}

// stdout/stderr hacia un pipe son asincronos: escribir con fs.writeSync evita
// perder la decision cuando el proceso termina inmediatamente despues.
function emit(payload, reason, code) {
  fs.writeSync(1, JSON.stringify(payload) + '\n');
  fs.writeSync(2, '[SDD] ' + reason + '\n');
  process.exit(code);
}

/**
 * Deja pasar la accion explicando por que. `call` es lo que devuelve readToolCall().
 *
 * Antigravity solo admite allow | deny | ask | force_ask: un aviso se expresa ahi como `allow` con
 * motivo. En las demas CLIs se mantiene `warn`, que es su forma de decir lo mismo.
 */
function warn(reason, call) {
  const decision = call && call.stdoutOnly ? 'allow' : 'warn';
  emit({ decision, reason }, reason, 0);
}

/** Bloquea la accion. El codigo 2 es la senal de bloqueo de las CLIs que la usan; ver readToolCall. */
function deny(reason, call) {
  const code = call && call.stdoutOnly ? 0 : 2;
  emit({
    decision: 'deny',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }, reason, code);
}

module.exports = { readPayload, readToolCall, skipRequested, warn, deny, SKIP_ENV };

'use strict';

// Utilidades compartidas por los hooks SDD.
// Emite decisiones en el formato que entienden Claude Code (JSON por stdout)
// y Gemini CLI (texto por stderr + codigo de salida).

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

// stdout/stderr hacia un pipe son asincronos: escribir con fs.writeSync evita
// perder la decision cuando el proceso termina inmediatamente despues.
function emit(payload, reason, code) {
  fs.writeSync(1, JSON.stringify(payload) + '\n');
  fs.writeSync(2, '[SDD] ' + reason + '\n');
  process.exit(code);
}

function warn(reason) {
  emit({ decision: 'warn', reason }, reason, 0);
}

function deny(reason) {
  emit({
    decision: 'deny',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }, reason, 2);
}

module.exports = { readPayload, skipRequested, warn, deny, SKIP_ENV };

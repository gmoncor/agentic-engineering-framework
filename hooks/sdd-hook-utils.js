'use strict';

// Utilidades compartidas por los hooks SDD.
// Emite decisiones en el formato que entienden Claude Code (JSON por stdout),
// Gemini CLI / Codex (texto por stderr + codigo de salida) y Antigravity CLI
// (JSON por stdout, sin codigo de salida en su contrato).

const fs = require('fs');

const SKIP_ENV = 'SDD_GUARD_SKIP';
const STDIN_TIMEOUT_MS = 5000;

// Si el harness no cierra stdin (pipe bloqueado, antivirus, comportamiento
// anomalo), leer hasta EOF cuelga el proceso indefinidamente. La carrera
// contra el timeout garantiza que el hook siempre resuelve: si stdin no
// llega a tiempo, se degrada a null igual que un payload invalido.
async function readPayload(timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs || STDIN_TIMEOUT_MS, null);
  });

  const read = (async () => {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function skipRequested(env) {
  return (env || process.env)[SKIP_ENV] === '1';
}

/**
 * Carga `hooks/config.json` (o `SDD_CONFIG_PATH` si esta definido, seam usado
 * por los tests). Distingue dos fallos que no son iguales:
 *   - archivo ausente u otro error de lectura (EACCES, etc.): silencio, `{}`.
 *     El framework no requiere config.json para funcionar.
 *   - archivo presente pero JSON invalido: degradacion silenciosa peligrosa
 *     si no avisa (el usuario cree que su configuracion esta activa). Se
 *     avisa a stderr dentro de un try/catch mudo (stderr puede estar roto) y
 *     se retorna `{}` igual.
 */
function loadConfig(defaultFile) {
  const file = process.env.SDD_CONFIG_PATH || defaultFile;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    try {
      fs.writeSync(2, '[SDD] ' + file + ' no es JSON valido (' + err.message
        + ') - hooks SDD usando valores por defecto. Revisa el archivo.\n');
    } catch {
      // stderr roto: nada mas que hacer, se degrada igual a valores por defecto.
    }
    return {};
  }
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
 *
 * `code` es un identificador corto y estable (UPPER_SNAKE_CASE) para que un consumidor
 * automatizado distinga motivos dentro del mismo hook sin parsear el texto de `reason`.
 * Es opcional: si no se pasa, el payload se emite igual que antes (retrocompatible).
 */
function warn(reason, call, code) {
  const decision = call && call.stdoutOnly ? 'allow' : 'warn';
  const payload = { decision, reason };
  if (code) payload.code = code;
  emit(payload, reason, 0);
}

/** Bloquea la accion. El codigo 2 es la senal de bloqueo de las CLIs que la usan; ver readToolCall. */
function deny(reason, call, code) {
  const exitCode = call && call.stdoutOnly ? 0 : 2;
  const payload = {
    decision: 'deny',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  if (code) {
    payload.code = code;
    payload.hookSpecificOutput.code = code;
  }
  emit(payload, reason, exitCode);
}

module.exports = { readPayload, readToolCall, skipRequested, loadConfig, warn, deny, SKIP_ENV };

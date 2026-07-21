#!/usr/bin/env node
'use strict';

/**
 * SDD Turn-budget — hook PreToolUse sobre todas las tool calls.
 *
 * Cuenta las acciones de la sesion desde el ultimo commit. Al superar cada
 * umbral avisa (o bloquea, si se configura enforcement) para empujar a crear un
 * checkpoint antes de que la sesion se alargue sin preservar nada:
 *   - warn_at:      aviso ("llevas N acciones sin commit, considera commitear").
 *   - block_at:     presupuesto excedido ("haz commit antes de continuar").
 *   - hard_stop_at: interrupcion ("INTERRUMPE y espera instrucciones").
 *
 * COMO CUENTA
 * Un fichero temporal por sesion, <tmp>/sdd-turns-<session_id>.json, con { count }.
 * Cada tool call incrementa el contador; una tool call de shell con `git commit`
 * lo resetea a 0 (el commit es el checkpoint que el budget vigila). El estado vive
 * fuera del proceso porque cada tool call es una invocacion distinta del hook.
 *
 * MODO (config .mode)
 *   - "advisory" (default): los tres umbrales AVISAN, nunca bloquean.
 *   - "enforce": block_at y hard_stop_at DENIEGAN la accion; warn_at sigue avisando.
 *   Cualquier otro valor degrada a advisory (nunca bloquea por un modo desconocido).
 *
 * DEGRADACION SEGURA (nunca rompe por infraestructura):
 *   - Sin config o enabled: false -> silencio.
 *   - SDD_GUARD_SKIP=1 -> bypass (escape de emergencia, no cuenta ni avisa).
 *   - Sin session_id: no hay sesion que correlacionar ni donde persistir -> silencio.
 *   - Fichero de contador corrupto o disco de solo lectura -> contador a 0 y sigue.
 *
 * Single-repo: el reset se ata al comando `git commit` observado, sin resolver la
 * raiz del repositorio. Configurable en hooks/config.json (sdd_turn_budget).
 * SDD_TURNS_DIR redirige el directorio del contador (tests, tmp efimero).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPayload, readToolCall, warn, deny, skipRequested } = require('./sdd-hook-utils');

const SHELL_TOOLS = new Set(['Bash', 'run_command', 'shell']);
const COMMIT_RE = /\bgit\s+commit\b/;

const DEFAULTS = { warn_at: 30, block_at: 60, hard_stop_at: 90 };

function turnsDir() {
  return process.env.SDD_TURNS_DIR || os.tmpdir();
}

function turnsPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(turnsDir(), 'sdd-turns-' + safe + '.json');
}

// Contador actual de la sesion. 0 si no hay fichero (nada contado aun) o si esta
// corrupto: un contador ilegible no debe convertirse en un bloqueo espurio.
function loadCount(sessionId) {
  try {
    const raw = JSON.parse(fs.readFileSync(turnsPath(sessionId), 'utf8'));
    return Number.isInteger(raw.count) && raw.count >= 0 ? raw.count : 0;
  } catch {
    return 0;
  }
}

function saveCount(sessionId, count) {
  try {
    fs.writeFileSync(turnsPath(sessionId), JSON.stringify({ count }));
  } catch {
    // Disco lento o de solo lectura: perder un incremento solo relaja el aviso,
    // nunca lo endurece. No se propaga.
  }
}

// Umbral configurado, o su default. <= 0 desactiva ese tier.
function threshold(cfg, key) {
  const n = Number(cfg[key]);
  return Number.isFinite(n) ? n : DEFAULTS[key];
}

function avisoWarn(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit. Considera hacer commit '
    + 'para crear un checkpoint antes de continuar.';
}

function avisoBlock(count) {
  return 'SDD: has excedido el presupuesto de ' + count + ' acciones sin commit. '
    + 'Haz commit antes de continuar.';
}

function avisoHardStop(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit. INTERRUMPE y espera '
    + 'instrucciones del usuario antes de continuar.';
}

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const cfg = loadConfig().sdd_turn_budget || {};
  if (cfg.enabled === false) process.exit(0);
  if (skipRequested()) process.exit(0);

  const sessionId = data.session_id || data.sessionId || '';
  if (!sessionId) process.exit(0);

  const call = readToolCall(data);

  // El commit es el checkpoint que el budget vigila: reinicia la cuenta.
  const cmd = String(call.input.command || '');
  if (SHELL_TOOLS.has(call.name) && COMMIT_RE.test(cmd)) {
    saveCount(sessionId, 0);
    process.exit(0);
  }

  const count = loadCount(sessionId) + 1;
  saveCount(sessionId, count);

  const enforce = cfg.mode === 'enforce';

  if (count >= threshold(cfg, 'hard_stop_at')) {
    const reason = avisoHardStop(count);
    return enforce ? deny(reason, call) : warn(reason, call);
  }
  if (count >= threshold(cfg, 'block_at')) {
    const reason = avisoBlock(count);
    return enforce ? deny(reason, call) : warn(reason, call);
  }
  if (count >= threshold(cfg, 'warn_at')) {
    return warn(avisoWarn(count), call);
  }

  process.exit(0);
}

// SDD_CONFIG_PATH permite apuntar a otra configuracion (tests, entornos aislados).
function loadConfig() {
  const file = process.env.SDD_CONFIG_PATH || path.join(__dirname, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

main().catch(() => process.exit(0));

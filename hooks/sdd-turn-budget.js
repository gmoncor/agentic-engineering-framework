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
 * Al escribir el contador de la sesion actual se purgan (best-effort) los
 * ficheros `sdd-turns-*.json` de otras sesiones con mas de 24h sin actividad,
 * para que no se acumulen indefinidamente en maquinas de larga duracion.
 *
 * MODO (config .mode)
 *   - "advisory" (default): los tres umbrales AVISAN, nunca bloquean.
 *   - "enforce": block_at y hard_stop_at DENIEGAN la accion; warn_at sigue avisando.
 *   Cualquier otro valor degrada a advisory (nunca bloquea por un modo desconocido).
 *
 * SUBAGENTES (mode: enforce)
 *   El contador se lleva por session_id, que un subagente comparte con el hilo
 *   principal. Denegar la tool call de un subagente no tiene forma de "esperar
 *   instrucciones del usuario": nadie en ese hilo puede accionar el aviso. Cuando
 *   el payload trae `agent_id` o `agent_type` (presentes unicamente cuando la
 *   llamada se origina dentro de un subagente), block_at y hard_stop_at se
 *   degradan de deny() a warn() con un mensaje accionable por el propio
 *   subagente. El hilo principal (sin esos campos) sigue denegado igual que antes.
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
const { readPayload, readToolCall, warn, deny, skipRequested, loadConfig, purgeExpired } = require('./sdd-hook-utils');

const SHELL_TOOLS = new Set(['Bash', 'run_command', 'shell']);
const COMMIT_RE = /\bgit\s+commit\b/;

const DEFAULTS = { warn_at: 30, block_at: 60, hard_stop_at: 90 };
const TTL_MS = 24 * 60 * 60 * 1000; // 24h: ficheros de sesiones sin actividad reciente se purgan

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
  const file = turnsPath(sessionId);
  try {
    fs.writeFileSync(file, JSON.stringify({ count }));
  } catch {
    // Disco lento o de solo lectura: perder un incremento solo relaja el aviso,
    // nunca lo endurece. No se propaga.
    return;
  }
  // Purga oportunista: retira contadores de sesiones anteriores sin actividad
  // en el ultimo TTL. Ver purgeExpired en sdd-hook-utils.js.
  purgeExpired(turnsDir(), 'sdd-turns-', file, TTL_MS);
}

// Umbral configurado, o su default. <= 0 desactiva ese tier.
function threshold(cfg, key) {
  const n = Number(cfg[key]);
  return Number.isFinite(n) ? n : DEFAULTS[key];
}

// `agent_id`/`is_sidechain`/`agent_type` solo aparecen en el payload cuando la
// tool call se origina dentro de un subagente (contrato de hooks de Claude
// Code); el hilo principal nunca los trae. Comprobar las tres senales evita
// que un payload que solo trae `is_sidechain` se trate como hilo principal.
function isSubagentCall(data) {
  return !!(data && (data.agent_id || data.is_sidechain || data.agent_type));
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

function avisoBlockSubagente(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit. El presupuesto se acerca '
    + 'al limite: busca un punto para hacer commit antes de continuar.';
}

function avisoHardStopSubagente(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit, superando el presupuesto '
    + 'duro. Busca cuanto antes un punto seguro para hacer commit y continuar.';
}

// En enforce, el hilo principal (sin senal de subagente) se deniega igual que
// siempre. Un subagente nunca se deniega: se avisa con un mensaje que puede
// accionar el mismo. En advisory ambos avisan con el mensaje normal.
function decidir(count, enforce, subagent, mensajeNormal, mensajeSubagente, call, code) {
  if (!enforce) return warn(mensajeNormal(count), call, code);
  if (subagent) return warn(mensajeSubagente(count), call, code);
  return deny(mensajeNormal(count), call, code);
}

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const cfg = loadConfig(path.join(__dirname, 'config.json')).sdd_turn_budget || {};
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
  const subagent = isSubagentCall(data);

  if (count >= threshold(cfg, 'hard_stop_at')) {
    return decidir(
      count, enforce, subagent, avisoHardStop, avisoHardStopSubagente, call,
      'TURN_BUDGET_HARD_STOP'
    );
  }
  if (count >= threshold(cfg, 'block_at')) {
    return decidir(
      count, enforce, subagent, avisoBlock, avisoBlockSubagente, call,
      'TURN_BUDGET_BLOCK'
    );
  }
  if (count >= threshold(cfg, 'warn_at')) {
    return warn(avisoWarn(count), call, 'TURN_BUDGET_WARN');
  }

  process.exit(0);
}

main().catch(() => process.exit(0));

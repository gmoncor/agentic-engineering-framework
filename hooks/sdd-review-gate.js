#!/usr/bin/env node
'use strict';

/**
 * SDD Review Gate — PreToolUse / BeforeTool hook sobre comandos de shell.
 *
 * AVISA (nunca deniega) al ejecutar `git commit` o `git merge` cuando no consta
 * que el codigo entregado haya pasado la revision adversarial POST-implementacion.
 *
 * POR QUE AVISA Y NO BLOQUEA
 * Bloquear exige una prueba de que la revision ocurrio, y aqui no la hay:
 *   - La unica evidencia posible es una senal que el propio flujo emite. No esta
 *     atada al diff que se commitea: dice "hubo una revision en esta sesion", no
 *     "este diff fue revisado". Bloquear con eso seria enforcement aparente.
 *   - El emisor de la senal (el flujo de implementacion) commitea cada task antes
 *     de la revision final. Con un bloqueo real no podria commitear su propio
 *     trabajo: el gate se estaria bloqueando a si mismo.
 * Un aviso honesto vale mas que un bloqueo que se puede fabricar. La frontera
 * dura, si se necesita, va en CI y en las protecciones de rama.
 *
 * Reparto de responsabilidades:
 *   - sdd-pipeline-guard.js bloquea ESCRITURAS no declaradas en el plan (PRE).
 *   - sdd-review-gate.js    avisa de COMMITS sin revision del codigo (POST).
 *
 * La revision PRE-implementacion (revision de tasks, auditoria de la spec)
 * valida el PLAN, no el CODIGO: no silencia este aviso.
 *
 * Silencia el aviso: el fichero de senal de la sesion dentro de su TTL, escrito
 * por el flujo de implementacion tras la revision (ver sdd-review-signal.js).
 *
 * Silencio total (no avisa):
 *   - el hook no esta habilitado en hooks/config.json
 *   - el payload no trae session_id (no hay sesion que correlacionar)
 */

const fs = require('fs');
const path = require('path');
const { readPayload, readToolCall, warn } = require('./sdd-hook-utils');
const { DEFAULT_TTL_MS, readSignal } = require('./sdd-review-signal');

const SHELL_TOOLS = new Set(['Bash', 'run_command', 'shell']);
const GUARDED_CMD_RE = /\bgit\s+(commit|merge)\b/;

const AVISO = 'SDD: no consta que el codigo que vas a commitear haya sido revisado. '
  + 'Este aviso no bloquea nada: no hay forma de probar que un diff concreto se reviso, '
  + 'asi que el hook no puede denegar con honestidad. '
  + 'Antes de entregar, pasa la revision adversarial POST-implementacion sobre el diff '
  + '(la fase final del flujo de implementacion, o el paso de revision por separado) '
  + 'y trata sus hallazgos.';

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const call = readToolCall(data);
  if (!SHELL_TOOLS.has(call.name)) process.exit(0);

  const cmd = String(call.input.command || '').trim();
  if (!GUARDED_CMD_RE.test(cmd)) process.exit(0);

  const config = loadConfig().sdd_review_gate || {};
  if (config.enabled !== true) process.exit(0);

  const sessionId = data.session_id || '';
  if (!sessionId) process.exit(0);

  if (readSignal(sessionId, ttlMs(config))) process.exit(0);

  warn(AVISO, call);
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

function ttlMs(config) {
  const hours = Number(config.ttl_hours);
  return hours > 0 ? hours * 60 * 60 * 1000 : DEFAULT_TTL_MS;
}

main().catch(() => process.exit(0));

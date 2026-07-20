#!/usr/bin/env node
'use strict';

/**
 * SDD Review Gate — PreToolUse / BeforeTool hook sobre comandos de shell.
 *
 * BLOQUEA `git commit` o `git merge` cuando el diff que se va a commitear no
 * consta revisado por la revision adversarial por task.
 *
 * POR QUE AHORA SI PUEDE BLOQUEAR
 * La revision ocurre por task, ANTES del commit, y su senal guarda el hash del
 * diff revisado. Aqui se recalcula el hash del diff cacheado (`git diff --cached`,
 * lo que se va a commitear) y se contrasta con la senal:
 *   - coincide            -> el diff que se commitea es el revisado: pasa.
 *   - no hay senal         -> no consta revision de este diff: se deniega.
 *   - el hash no coincide   -> el codigo cambio tras revisarse: se deniega.
 * La senal ya no es una marca de conveniencia: ata el hash a un diff concreto, asi
 * que el bloqueo es honesto, no aparente.
 *
 * Reparto de responsabilidades:
 *   - sdd-pipeline-guard.js bloquea ESCRITURAS no declaradas en el plan (PRE).
 *   - sdd-review-gate.js    bloquea COMMITS de un diff sin revision (POST).
 *
 * La revision PRE-implementacion (revision de tasks, auditoria de la spec) valida
 * el PLAN, no el CODIGO: su senal no ata el diff, asi que no cuenta aqui.
 *
 * Degradacion segura (avisa, no bloquea):
 *   - SDD_GUARD_SKIP=1: escape de emergencia, degrada el bloqueo a aviso.
 *   - sin `git diff --cached` computable (nada staged, git no disponible): avisa,
 *     no bloquea sin el diff que deberia contrastar.
 * Silencio total (exit 0, no interviene):
 *   - el hook no esta habilitado en hooks/config.json
 *   - el payload no trae session_id (no hay sesion que correlacionar)
 *   - el diff cacheado coincide con la senal (revision confirmada)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readPayload, readToolCall, warn, deny, skipRequested } = require('./sdd-hook-utils');
const { DEFAULT_TTL_MS, readSignal, hashDiff } = require('./sdd-review-signal');

const SHELL_TOOLS = new Set(['Bash', 'run_command', 'shell']);
const GUARDED_CMD_RE = /\bgit\s+(commit|merge)\b/;

const SIN_SENAL = 'SDD: este diff no consta revisado. La revision adversarial por task debe '
  + 'pasar ANTES del commit y emitir su senal. Ejecuta el flujo de implementacion (revision '
  + 'por task) o pasa la revision adversarial sobre este diff antes de commitear.';

const HASH_NO_ATA = 'SDD: la revision registrada no corresponde al diff que vas a commitear '
  + '(el codigo cambio despues de revisarse). Vuelve a pasar la revision adversarial sobre el '
  + 'diff actual antes de commitear.';

const SIN_DIFF = 'SDD: no hay diff cacheado que contrastar (nada staged, o git no disponible). '
  + 'Este aviso no bloquea: sin el diff no se puede verificar la revision. Haz git add de lo que '
  + 'vas a commitear y asegurate de que paso la revision adversarial.';

const SKIP_AVISO = 'SDD: SDD_GUARD_SKIP activo. El bloqueo de revision queda degradado a aviso; '
  + 'usalo solo para desbloquear una situacion puntual, no de forma permanente.';

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const call = readToolCall(data);
  if (!SHELL_TOOLS.has(call.name)) process.exit(0);

  const cmd = String(call.input.command || '').trim();
  if (!GUARDED_CMD_RE.test(cmd)) process.exit(0);

  const config = loadConfig().sdd_review_gate || {};
  if (config.enabled !== true) process.exit(0);

  if (skipRequested()) { warn(SKIP_AVISO, call); return; }

  const sessionId = data.session_id || '';
  if (!sessionId) process.exit(0);

  const diff = stagedDiff();
  if (diff == null || diff.trim() === '') { warn(SIN_DIFF, call); return; }

  const signal = readSignal(sessionId, ttlMs(config));
  if (!signal) { deny(SIN_SENAL, call); return; }
  if (signal.diff_hash !== hashDiff(diff)) { deny(HASH_NO_ATA, call); return; }

  process.exit(0);
}

// El diff que se va a commitear. SDD_STAGED_DIFF permite inyectarlo en tests y
// entornos aislados, igual que SDD_CONFIG_PATH / SDD_SIGNAL_DIR; sin el, se lee del
// repositorio en curso. null si git no puede resolverlo.
function stagedDiff() {
  if (process.env.SDD_STAGED_DIFF != null) return process.env.SDD_STAGED_DIFF;
  try {
    const r = spawnSync('git', ['diff', '--cached'], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 });
    if (r.error || r.status !== 0) return null;
    return r.stdout;
  } catch {
    return null;
  }
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

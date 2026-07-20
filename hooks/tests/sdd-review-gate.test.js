'use strict';

// Contrato de sdd-review-gate.js: BLOQUEA `git commit`/`merge` cuyo diff no consta
// revisado por la revision adversarial por task.
//
// La revision ocurre por task, ANTES del commit, y su senal guarda el hash del
// diff revisado. El hook recalcula el hash del diff cacheado (`git diff --cached`)
// y lo contrasta: si coincide, pasa; si no hay senal o el hash no ata, deniega.
// Estos tests fijan ese contrato: si alguien vuelve a degradar el hook a mero
// aviso, fallan.
//
// Degradacion segura (avisa, no bloquea): SDD_GUARD_SKIP=1, o sin diff cacheado
// computable. Silencio total (exit 0): hook off, sin session_id, o hash que ata.
//
// El diff cacheado se inyecta con SDD_STAGED_DIFF (seam de tests, igual que
// SDD_CONFIG_PATH / SDD_SIGNAL_DIR); sin el, el hook lo leeria del repo real.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile, HOOKS_DIR } = require('./helpers');
const signal = require('../sdd-review-signal');

const HOOK = 'sdd-review-gate.js';
const SESSION = 'sesion-de-prueba-1';
const DIFF = 'diff --git a/src/pagos.js b/src/pagos.js\n@@ -1 +1 @@\n-viejo\n+nuevo\n';

const CONFIG_ON = { sdd_review_gate: { enabled: true, ttl_hours: 4 } };
const CONFIG_OFF = { sdd_review_gate: { enabled: false, ttl_hours: 4 } };

function entorno(config, extra) {
  const dir = tempDir('sdd-review-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  return Object.assign({ SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_SIGNAL_DIR: dir }, extra || {});
}

function commit(mensaje, sessionId) {
  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m "' + mensaje + '"' } };
  if (sessionId !== null) payload.session_id = sessionId === undefined ? SESSION : sessionId;
  return payload;
}

// Emite la senal igual que el flujo de implementacion: mismo modulo, misma funcion.
// El hash es el del diff que la revision aprobo.
function emitirSenal(env, diffRevisado, edadMs) {
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const hash = signal.hashDiff(diffRevisado);
  const file = signal.writeSignal(SESSION, hash);
  if (edadMs) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.ts = Date.now() - edadMs;
    fs.writeFileSync(file, JSON.stringify(raw));
  }
  delete process.env.SDD_SIGNAL_DIR;
  return hash;
}

test('senal que ata el diff cacheado: el commit pasa (silencio)', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, DIFF);

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('sin senal, con diff staged: DENIEGA el commit', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.decision.reason, /no consta revisado/);
});

test('senal que NO ata el diff (el codigo cambio tras revisarse): DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, 'diff viejo, distinto del que se va a commitear');

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /no corresponde al diff/);
});

test('sin diff cacheado computable: degrada a aviso, no bloquea a ciegas', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: '' });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /no hay diff cacheado/);
});

test('SDD_GUARD_SKIP=1: escape de emergencia, degrada el bloqueo a aviso', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF, SDD_GUARD_SKIP: '1' });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /SDD_GUARD_SKIP/);
});

test('senal con TTL expirado (>4h): cuenta como sin senal y DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, DIFF, 5 * 60 * 60 * 1000);

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('senal PRE-implementacion (revision del plan) no ata el diff: DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const file = signal.signalPath(SESSION);
  delete process.env.SDD_SIGNAL_DIR;
  writeFile(file, JSON.stringify({ signal: 'SDD_PRE_IMPL', diff_hash: signal.hashDiff(DIFF), ts: Date.now() }));

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
});

test('la marca en el mensaje de commit no satisface el gate: DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const hash = signal.hashDiff(DIFF);
  const r = runHook(HOOK, commit('feat: entregar pagos [SDD-POST-IMPL: ' + hash + ']'), env);

  // Era auto-emitible: el mismo agente que redacta el mensaje conocia el formato.
  // Escribirla en el mensaje no cuenta como revision.
  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(signal.MARKER_RE, undefined);
});

test('git merge sin senal, con diff staged: DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git merge feature/pagos' }, session_id: SESSION }, env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('sin session_id en el payload: silencio (no hay sesion que correlacionar)', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos', null), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('hook deshabilitado en la config: silencio', () => {
  const env = entorno(CONFIG_OFF, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('comando que no es commit ni merge: silencio', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: SESSION }, env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('round-trip: la senal que emite el flujo por task es exactamente la que el hook acepta', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, DIFF);
  assert.strictEqual(runHook(HOOK, commit('feat: pagos'), env).decision, null);

  const envSinSenal = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  assert.strictEqual(runHook(HOOK, commit('feat: pagos'), envSinSenal).decision.decision, 'deny');
});

test('el emisor del flujo revisa por task y usa el mismo contrato de senal que el hook', () => {
  const workflow = fs.readFileSync(
    path.resolve(HOOKS_DIR, '..', '.claude', 'workflows', 'implementar-spec.js'), 'utf8');

  assert.match(workflow, /hooks\/sdd-review-signal\.js/);
  assert.match(workflow, /writeSignal/);
  // La senal se emite tras revisar el diff de la task y antes de commitear.
  assert.match(workflow, /revisarYComitear/);
  assert.match(workflow, /'--cached'/);
  assert.match(workflow, /emitirSenalRevision/);
  assert.doesNotMatch(workflow, /SDD-POST-IMPL/, 'el canal de la marca en el mensaje de commit se elimino');
});

test('el hook solo se cablea donde el flujo emite la senal: Claude Code', () => {
  const settings = fs.readFileSync(path.resolve(HOOKS_DIR, '..', '.claude', 'settings.json'), 'utf8');
  const hooksJson = fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8');

  assert.match(settings, /sdd-review-gate\.js/);
  assert.match(settings, /sdd-pipeline-guard\.js/);

  assert.match(hooksJson, /sdd-pipeline-guard\.js/);
  assert.doesNotMatch(
    hooksJson.replace(/"_[a-z_]+":\s*"[^"]*"/g, ''),
    /sdd-review-gate\.js/,
    'sin motor de workflows no hay emisor de la senal: cablear el gate ahi no tendria via de satisfacerse'
  );
});

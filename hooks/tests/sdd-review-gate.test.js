'use strict';

// Contrato de sdd-review-gate.js: bloquea commits de codigo sin revision
// adversarial POST-implementacion, y round-trip emisor/consumidor.
//
// El round-trip es la garantia critica: el gate solo puede bloquear si la senal
// que el workflow de implementacion emite es exactamente la que el gate acepta.
// Si emisor y consumidor divergen, el repo queda bloqueado para siempre.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile, HOOKS_DIR } = require('./helpers');
const signal = require('../sdd-review-signal');

const HOOK = 'sdd-review-gate.js';
const SESSION = 'sesion-de-prueba-1';

const CONFIG_ON = { sdd_review_gate: { enabled: true, ttl_hours: 4 } };
const CONFIG_OFF = { sdd_review_gate: { enabled: false, ttl_hours: 4 } };

function entorno(config) {
  const dir = tempDir('sdd-review-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  return { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_SIGNAL_DIR: dir };
}

function commit(mensaje, sessionId) {
  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m "' + mensaje + '"' } };
  if (sessionId !== null) payload.session_id = sessionId === undefined ? SESSION : sessionId;
  return payload;
}

// Escribe la senal igual que lo hace el workflow de implementacion: mismo modulo,
// misma funcion. Este es el lado "emisor" del round-trip.
function emitirSenal(env, contenidoRevisado, edadMs) {
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const hash = signal.hashDiff(contenidoRevisado);
  const file = signal.writeSignal(SESSION, hash);
  if (edadMs) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.ts = Date.now() - edadMs;
    fs.writeFileSync(file, JSON.stringify(raw));
  }
  delete process.env.SDD_SIGNAL_DIR;
  return hash;
}

test('git commit sin senal ni marca: deny', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /revision del codigo no encontrada/);
});

test('round-trip: la senal que emite el workflow es aceptada por el gate', () => {
  const env = entorno(CONFIG_ON);
  emitirSenal(env, 'diff del codigo entregado');

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('round-trip inverso: sin emitir la senal, el mismo commit se bloquea', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
});

test('marca [SDD-POST-IMPL: <hash>] en el mensaje de commit: allow', () => {
  const env = entorno(CONFIG_ON);
  const hash = signal.hashDiff('diff del codigo entregado');
  const r = runHook(HOOK, commit('feat: entregar pagos [SDD-POST-IMPL: ' + hash + ']'), env);

  assert.strictEqual(r.code, 0);
});

test('senal con TTL expirado (>4h): deny', () => {
  const env = entorno(CONFIG_ON);
  emitirSenal(env, 'diff viejo', 5 * 60 * 60 * 1000);

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
});

test('senal PRE-implementacion (revision del plan) no satisface el gate POST: deny', () => {
  const env = entorno(CONFIG_ON);
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const file = signal.signalPath(SESSION);
  delete process.env.SDD_SIGNAL_DIR;
  writeFile(file, JSON.stringify({ signal: 'SDD_PRE_IMPL', diff_hash: 'abc123', ts: Date.now() }));

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
});

test('git merge sin senal: deny', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git merge feature/pagos' }, session_id: SESSION }, env);

  assert.strictEqual(r.decision.decision, 'deny');
});

test('SDD_GUARD_SKIP=1: warn en vez de deny', () => {
  const env = Object.assign(entorno(CONFIG_ON), { SDD_GUARD_SKIP: '1' });
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
});

test('sin session_id en el payload: allow (degradacion segura)', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos', null), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('gate deshabilitado en la config: allow (degradacion segura)', () => {
  const env = entorno(CONFIG_OFF);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
});

test('comando que no es commit ni merge: allow', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: SESSION }, env);

  assert.strictEqual(r.code, 0);
});

test('el emisor del workflow usa el mismo contrato de senal que el gate', () => {
  const workflow = fs.readFileSync(
    path.resolve(HOOKS_DIR, '..', '.claude', 'workflows', 'implementar-spec.js'), 'utf8');

  assert.match(workflow, /hooks\/sdd-review-signal\.js/);
  assert.match(workflow, /writeSignal/);
  assert.match(workflow, /SDD-POST-IMPL/);
});

test('el gate esta wired en hooks.json y en .claude/settings.json', () => {
  const hooksJson = fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8');
  const settings = fs.readFileSync(path.resolve(HOOKS_DIR, '..', '.claude', 'settings.json'), 'utf8');

  assert.match(hooksJson, /sdd-review-gate\.js/);
  assert.match(hooksJson, /sdd-pipeline-guard\.js/);
  assert.match(settings, /sdd-review-gate\.js/);
  assert.match(settings, /sdd-pipeline-guard\.js/);
});

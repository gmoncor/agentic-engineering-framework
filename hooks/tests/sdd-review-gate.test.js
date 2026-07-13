'use strict';

// Contrato de sdd-review-gate.js: AVISA de commits de codigo sin revision
// adversarial POST-implementacion, y nunca los deniega.
//
// El hook es advisory por diseno: la unica evidencia disponible es una senal de
// sesion que no esta atada al diff que se commitea. Denegar con eso seria fingir
// una garantia que no existe. Estos tests fijan ese contrato: si alguien vuelve a
// poner el hook a denegar, fallan.
//
// El round-trip emisor/consumidor sigue siendo critico: el aviso solo se silencia
// si la senal que el flujo de implementacion emite es exactamente la que el hook
// acepta. Si emisor y consumidor divergen, el aviso sale siempre.

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

// Escribe la senal igual que lo hace el flujo de implementacion: mismo modulo,
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

test('git commit sin senal: avisa y deja pasar (nunca deniega)', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /no consta que el codigo/);
  assert.match(r.decision.reason, /no bloquea nada/);
});

test('el hook no deniega en ningun caso: no emite decision de bloqueo', () => {
  const env = entorno(CONFIG_ON);
  const casos = [
    commit('feat: entregar el modulo de pagos'),
    { tool_name: 'Bash', tool_input: { command: 'git merge feature/pagos' }, session_id: SESSION },
  ];

  for (const caso of casos) {
    const r = runHook(HOOK, caso, env);
    assert.notStrictEqual(r.decision.decision, 'deny');
    assert.strictEqual(r.decision.hookSpecificOutput, undefined);
    assert.strictEqual(r.code, 0);
  }
});

test('round-trip: la senal que emite el flujo silencia el aviso', () => {
  const env = entorno(CONFIG_ON);
  emitirSenal(env, 'diff del codigo entregado');

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('round-trip inverso: sin emitir la senal, el mismo commit avisa', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
});

test('el canal de la marca en el mensaje de commit ya no existe', () => {
  const env = entorno(CONFIG_ON);
  const hash = signal.hashDiff('diff del codigo entregado');
  const r = runHook(HOOK, commit('feat: entregar pagos [SDD-POST-IMPL: ' + hash + ']'), env);

  // Era auto-emitible: el mismo agente que redacta el mensaje conocia el formato
  // y podia fabricarla. Escribirla en el mensaje ya no silencia el aviso.
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(signal.MARKER_RE, undefined);
});

test('senal con TTL expirado (>4h): avisa', () => {
  const env = entorno(CONFIG_ON);
  emitirSenal(env, 'diff viejo', 5 * 60 * 60 * 1000);

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
});

test('senal PRE-implementacion (revision del plan) no silencia el aviso POST', () => {
  const env = entorno(CONFIG_ON);
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const file = signal.signalPath(SESSION);
  delete process.env.SDD_SIGNAL_DIR;
  writeFile(file, JSON.stringify({ signal: 'SDD_PRE_IMPL', diff_hash: 'abc123', ts: Date.now() }));

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
});

test('git merge sin senal: avisa y deja pasar', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git merge feature/pagos' }, session_id: SESSION }, env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
});

test('sin session_id en el payload: silencio (no hay sesion que correlacionar)', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos', null), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('hook deshabilitado en la config: silencio', () => {
  const env = entorno(CONFIG_OFF);
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('comando que no es commit ni merge: silencio', () => {
  const env = entorno(CONFIG_ON);
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: SESSION }, env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('el emisor del flujo usa el mismo contrato de senal que el hook', () => {
  const workflow = fs.readFileSync(
    path.resolve(HOOKS_DIR, '..', '.claude', 'workflows', 'implementar-spec.js'), 'utf8');

  assert.match(workflow, /hooks\/sdd-review-signal\.js/);
  assert.match(workflow, /writeSignal/);
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
    'sin motor de workflows no hay emisor de la senal: cablear el aviso ahi no tendria via de silenciarse'
  );
});

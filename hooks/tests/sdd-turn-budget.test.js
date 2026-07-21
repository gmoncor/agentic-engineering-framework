'use strict';

// Contrato de sdd-turn-budget.js: cuenta las acciones de la sesion sin commit y,
// al superar cada umbral, avisa (o deniega en mode 'enforce'). El commit resetea
// el contador.
//
// El contador vive en un fichero por sesion; SDD_TURNS_DIR lo aisla en un temporal
// de test, igual que SDD_CONFIG_PATH aisla la config. Como cada tool call es una
// invocacion distinta del hook, el estado persiste entre ellas: por eso las llamadas
// de un mismo test comparten SDD_TURNS_DIR.
//
// Degradacion segura: enabled false, sin session_id, SDD_GUARD_SKIP o fichero de
// contador corrupto -> nunca rompe ni bloquea de forma espuria.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');

const HOOK = 'sdd-turn-budget.js';
const SESSION = 'sesion-turnos-1';

// Umbrales bajos para no lanzar decenas de procesos por test.
const base = { enabled: true, warn_at: 2, block_at: 3, hard_stop_at: 4 };
const CONFIG_ADVISORY = { sdd_turn_budget: Object.assign({}, base, { mode: 'advisory' }) };
const CONFIG_ENFORCE = { sdd_turn_budget: Object.assign({}, base, { mode: 'enforce' }) };
const CONFIG_OFF = { sdd_turn_budget: Object.assign({}, base, { enabled: false }) };

function entorno(config) {
  const dir = tempDir('sdd-turns-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  return { dir, env: { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_TURNS_DIR: dir } };
}

const accion = (session) => ({ tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: session });
const commit = (session, extra) => ({ tool_name: 'Bash', tool_input: { command: 'git commit' + (extra || '') }, session_id: session });

// Ejecuta n acciones genericas y devuelve el resultado de la ultima.
function repetir(n, env, session) {
  let r;
  for (let i = 0; i < n; i++) r = runHook(HOOK, accion(session || SESSION), env);
  return r;
}

test('una sola accion (por debajo de warn_at) -> silencio', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetir(1, e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('al alcanzar warn_at -> avisa', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetir(2, e.env); // warn_at = 2
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /sin commit/);
});

test('enforce: al alcanzar block_at -> deniega', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetir(3, e.env); // block_at = 3
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /presupuesto/);
});

test('enforce: al alcanzar hard_stop_at -> deniega e INTERRUMPE', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetir(4, e.env); // hard_stop_at = 4
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /INTERRUMPE y espera/);
});

test('advisory (default): supera block_at -> avisa, nunca bloquea', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetir(3, e.env); // >= block_at pero en advisory
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /presupuesto/);
});

test('advisory: supera hard_stop_at -> avisa con el mensaje de interrupcion, sin deny', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetir(4, e.env);
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /INTERRUMPE y espera/);
});

test('git commit resetea el contador a 0', () => {
  const e = entorno(CONFIG_ADVISORY);
  const avisado = repetir(2, e.env);
  assert.strictEqual(avisado.decision.decision, 'warn', 'antes del commit ya avisaba');

  const reset = runHook(HOOK, commit(SESSION), e.env);
  assert.strictEqual(reset.code, 0);
  assert.strictEqual(reset.decision, null, 'el commit pasa sin decision');

  const tras = repetir(1, e.env);
  assert.strictEqual(tras.decision, null, 'tras el reset, una accion vuelve a estar por debajo del umbral');
});

test('git commit --amend tambien resetea el contador', () => {
  const e = entorno(CONFIG_ADVISORY);
  repetir(2, e.env);
  runHook(HOOK, commit(SESSION, ' --amend'), e.env);
  const tras = repetir(1, e.env);
  assert.strictEqual(tras.decision, null);
});

test('enabled: false -> silencio, no cuenta', () => {
  const e = entorno(CONFIG_OFF);
  const r = repetir(5, e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('sin session_id -> silencio (no hay donde persistir el contador)', () => {
  const e = entorno(CONFIG_ADVISORY);
  const payload = { tool_name: 'Read', tool_input: { file_path: '/x' } };
  let r;
  for (let i = 0; i < 5; i++) r = runHook(HOOK, payload, e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('SDD_GUARD_SKIP=1 -> bypass total (ni cuenta ni avisa)', () => {
  const e = entorno(CONFIG_ADVISORY);
  const env = Object.assign({}, e.env, { SDD_GUARD_SKIP: '1' });
  let r;
  for (let i = 0; i < 5; i++) r = runHook(HOOK, accion(SESSION), env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('fichero de contador corrupto -> arranca en 0, no bloquea', () => {
  const e = entorno(CONFIG_ADVISORY);
  writeFile(path.join(e.dir, 'sdd-turns-' + SESSION + '.json'), 'no es json {');
  const r = repetir(1, e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null, 'el contador corrupto se lee como 0 y una accion queda por debajo del umbral');
});

test('sesiones concurrentes: cada una lleva su propio contador', () => {
  const e = entorno(CONFIG_ADVISORY);
  const a = repetir(2, e.env, 'sesion-A');
  assert.strictEqual(a.decision.decision, 'warn', 'la sesion A alcanzo su umbral');

  const b = repetir(1, e.env, 'sesion-B');
  assert.strictEqual(b.decision, null, 'la sesion B arranca de cero, sin heredar el contador de A');
});

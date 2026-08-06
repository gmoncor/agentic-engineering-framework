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
const accionSubagente = (session) => ({
  tool_name: 'Read',
  tool_input: { file_path: '/x' },
  session_id: session,
  agent_id: 'agent-1',
  agent_type: 'implementador',
});

// Payload de subagente que solo trae is_sidechain (sin agent_id ni agent_type).
const accionSidechain = (session, valor) => ({
  tool_name: 'Read',
  tool_input: { file_path: '/x' },
  session_id: session,
  is_sidechain: valor,
});

// Como repetir(), pero con el payload de subagente (agent_id/agent_type presentes).
function repetirSubagente(n, env, session) {
  let r;
  for (let i = 0; i < n; i++) r = runHook(HOOK, accionSubagente(session || SESSION), env);
  return r;
}

// Como repetir(), pero con un payload que solo trae is_sidechain.
function repetirSidechain(n, env, session, valor) {
  let r;
  for (let i = 0; i < n; i++) r = runHook(HOOK, accionSidechain(session || SESSION, valor), env);
  return r;
}

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
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_WARN');
});

test('enforce: al alcanzar block_at -> deniega', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetir(3, e.env); // block_at = 3
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /presupuesto/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_BLOCK');
  assert.strictEqual(r.decision.hookSpecificOutput.code, 'TURN_BUDGET_BLOCK');
});

test('enforce: al alcanzar hard_stop_at -> deniega e INTERRUMPE', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetir(4, e.env); // hard_stop_at = 4
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /INTERRUMPE y espera/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
  assert.strictEqual(r.decision.hookSpecificOutput.code, 'TURN_BUDGET_HARD_STOP');
});

test('advisory (default): supera block_at -> avisa, nunca bloquea', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetir(3, e.env); // >= block_at pero en advisory
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /presupuesto/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_BLOCK');
});

test('advisory: supera hard_stop_at -> avisa con el mensaje de interrupcion, sin deny', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetir(4, e.env);
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /INTERRUMPE y espera/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
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

test('enforce + subagente: al alcanzar block_at avisa (no deniega) con mensaje accionable', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetirSubagente(3, e.env); // block_at = 3
  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.decision.reason, /busca un punto para hacer commit/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_BLOCK');
});

test('enforce + subagente: al alcanzar hard_stop_at avisa (no deniega) sin pedir esperar al usuario', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetirSubagente(4, e.env); // hard_stop_at = 4
  assert.strictEqual(r.decision.decision, 'warn');
  assert.doesNotMatch(r.decision.reason, /espera instrucciones del usuario/);
  assert.match(r.decision.reason, /commit/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
});

test('enforce + hilo principal (sin agent_id/agent_type): sigue denegando igual que antes', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetir(4, e.env); // hard_stop_at = 4, payload sin senal de subagente
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /INTERRUMPE y espera/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
});

test('enforce + subagente detectado solo por is_sidechain: avisa (no deniega)', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetirSidechain(3, e.env, SESSION, true); // block_at = 3
  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.decision.reason, /busca un punto para hacer commit/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_BLOCK');
});

test('enforce + is_sidechain: false (presente pero falsy): sigue denegando como hilo principal', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetirSidechain(4, e.env, SESSION, false); // hard_stop_at = 4
  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.decision.reason, /INTERRUMPE y espera/);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
});

test('enforce + is_sidechain como string "true": se detecta como subagente (truthy)', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetirSidechain(3, e.env, SESSION, 'true'); // block_at = 3
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_BLOCK');
});

test('advisory + subagente: supera hard_stop_at -> avisa igual que un subagente ausente, nunca deniega', () => {
  const e = entorno(CONFIG_ADVISORY);
  const r = repetirSubagente(4, e.env);
  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
});

test('subagente sin session_id -> silencio, no rompe la deteccion de subagente', () => {
  const e = entorno(CONFIG_ENFORCE);
  const payload = { tool_name: 'Read', tool_input: { file_path: '/x' }, agent_id: 'agent-1', agent_type: 'implementador' };
  let r;
  for (let i = 0; i < 5; i++) r = runHook(HOOK, payload, e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('purga: al guardar el contador actual, elimina ficheros sdd-turns-* de otras sesiones con mas de 24h de antiguedad', () => {
  const e = entorno(CONFIG_ADVISORY);
  const viejo = path.join(e.dir, 'sdd-turns-sesion-vieja.json');
  writeFile(viejo, JSON.stringify({ count: 5 }));
  const t = (Date.now() - 25 * 60 * 60 * 1000) / 1000; // 25h atras
  fs.utimesSync(viejo, t, t);

  repetir(1, e.env);

  assert.strictEqual(fs.existsSync(viejo), false, 'el fichero de la sesion vieja debe purgarse');
});

test('purga: no elimina el fichero de la sesion actual que se acaba de escribir', () => {
  const e = entorno(CONFIG_ADVISORY);
  repetir(1, e.env);
  const actual = path.join(e.dir, 'sdd-turns-' + SESSION + '.json');
  assert.strictEqual(fs.existsSync(actual), true);
});

test('sesiones concurrentes: cada una lleva su propio contador', () => {
  const e = entorno(CONFIG_ADVISORY);
  const a = repetir(2, e.env, 'sesion-A');
  assert.strictEqual(a.decision.decision, 'warn', 'la sesion A alcanzo su umbral');

  const b = repetir(1, e.env, 'sesion-B');
  assert.strictEqual(b.decision, null, 'la sesion B arranca de cero, sin heredar el contador de A');
});

'use strict';

// Contrato de sdd-read-before-edit.js: AVISA (nunca bloquea) al escribir un
// archivo existente sin haberlo leido antes en la sesion.
//
// El rastreador de lecturas vive en un fichero por sesion; SDD_READS_DIR lo
// aisla en un temporal de test, igual que SDD_CONFIG_PATH aisla la config. Como
// lectura y escritura son invocaciones distintas del hook, el estado tiene que
// persistir entre ellas: por eso ambas comparten el mismo SDD_READS_DIR.
//
// Degradacion segura (nunca falso positivo): archivo nuevo, sin session_id,
// backend sin evento de lectura, o error al leer el rastreador -> silencio.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');

const HOOK = 'sdd-read-before-edit.js';
const SESSION = 'sesion-de-prueba-1';

const CONFIG_ON = { sdd_read_before_edit: { enabled: true, mode: 'advisory' } };
const CONFIG_OFF = { sdd_read_before_edit: { enabled: false, mode: 'advisory' } };
const CONFIG_MODE_OFF = { sdd_read_before_edit: { enabled: true, mode: 'off' } };

// Crea un entorno aislado y un archivo existente en disco para las escrituras.
function entorno(config) {
  const dir = tempDir('sdd-reads-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  const existente = path.join(dir, 'existente.js');
  writeFile(existente, 'contenido previo');
  return {
    dir,
    existente,
    env: { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_READS_DIR: dir },
  };
}

const claudeRead = (file, session) => ({ tool_name: 'Read', tool_input: { file_path: file }, session_id: session });
const claudeWrite = (file, session) => ({ tool_name: 'Write', tool_input: { file_path: file }, session_id: session });
const agyRead = (file, session) => ({ toolCall: { name: 'read_file', args: { TargetFile: file } }, session_id: session });
const agyWrite = (file, session) => ({ toolCall: { name: 'write_to_file', args: { TargetFile: file } }, session_id: session });

test('Claude Code: escritura de un archivo existente sin lectura previa -> avisa', () => {
  const e = entorno(CONFIG_ON);
  const r = runHook(HOOK, claudeWrite(e.existente, SESSION), e.env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /sin haberlo leido/);
});

test('Claude Code: lectura y luego escritura del mismo archivo -> silencio', () => {
  const e = entorno(CONFIG_ON);
  const lectura = runHook(HOOK, claudeRead(e.existente, SESSION), e.env);
  assert.strictEqual(lectura.code, 0);

  const r = runHook(HOOK, claudeWrite(e.existente, SESSION), e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('escritura de un archivo inexistente (nuevo) -> silencio, no habia nada que leer', () => {
  const e = entorno(CONFIG_ON);
  const nuevo = path.join(e.dir, 'nuevo.js');
  const r = runHook(HOOK, claudeWrite(nuevo, SESSION), e.env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('hook deshabilitado (enabled: false) -> silencio', () => {
  const e = entorno(CONFIG_OFF);
  const r = runHook(HOOK, claudeWrite(e.existente, SESSION), e.env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('mode distinto de advisory -> silencio (el hook nunca bloquea)', () => {
  const e = entorno(CONFIG_MODE_OFF);
  const r = runHook(HOOK, claudeWrite(e.existente, SESSION), e.env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('sin session_id -> silencio (no hay sesion que correlacionar)', () => {
  const e = entorno(CONFIG_ON);
  const payload = { tool_name: 'Write', tool_input: { file_path: e.existente } };
  const r = runHook(HOOK, payload, e.env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('backend sin evento de lectura y sin lecturas registradas -> silencio (degradacion segura)', () => {
  // Simula un backend que dispara la escritura pero no la lectura: sin ninguna
  // lectura registrada el hook no puede afirmar que no se leyo -> no avisa.
  const e = entorno(CONFIG_ON);
  const r = runHook(HOOK, agyWrite(e.existente, SESSION), e.env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('backend con evento de lectura (Antigravity): tras leer otro archivo, escritura sin leer -> avisa como allow', () => {
  const e = entorno(CONFIG_ON);
  const otro = path.join(e.dir, 'otro.js');
  writeFile(otro, 'otro contenido');

  const lectura = runHook(HOOK, agyRead(otro, SESSION), e.env);
  assert.strictEqual(lectura.code, 0);

  const r = runHook(HOOK, agyWrite(e.existente, SESSION), e.env);
  assert.strictEqual(r.decision.decision, 'allow'); // Antigravity no tiene warn
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /sin haberlo leido/);
});

test('sesiones concurrentes: cada una tiene su propio rastreador, sin colision', () => {
  const e = entorno(CONFIG_ON);
  // La sesion A lee el archivo; la sesion B nunca lo leyo.
  runHook(HOOK, claudeRead(e.existente, 'sesion-A'), e.env);

  const enA = runHook(HOOK, claudeWrite(e.existente, 'sesion-A'), e.env);
  assert.strictEqual(enA.decision, null, 'la sesion A leyo el archivo: no avisa');

  const enB = runHook(HOOK, claudeWrite(e.existente, 'sesion-B'), e.env);
  assert.strictEqual(enB.decision.decision, 'warn', 'la sesion B no lo leyo: avisa');
});

test('la lectura persiste en el rastreador por sesion, no en el mensaje de commit', () => {
  const e = entorno(CONFIG_ON);
  runHook(HOOK, claudeRead(e.existente, SESSION), e.env);

  const tracker = path.join(e.dir, 'sdd-reads-' + SESSION + '.json');
  const rutas = JSON.parse(fs.readFileSync(tracker, 'utf8'));
  assert.ok(rutas.includes(path.resolve(e.existente)), 'la ruta leida consta en el rastreador');
});

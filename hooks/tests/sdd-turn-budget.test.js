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
const { spawn } = require('child_process');
const { runHook, tempDir, writeFile, HOOKS_DIR } = require('./helpers');

const HOOK = 'sdd-turn-budget.js';
const SESSION = 'sesion-turnos-1';

// Ejecuta el hook como proceso real sin bloquear el hilo del test, para poder
// lanzar varias invocaciones a la vez (F4: la carrera solo se observa con
// procesos concurrentes de verdad).
function runHookAsync(hookName, payload, env) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(HOOKS_DIR, hookName)], {
      env: Object.assign({}, process.env, env || {}),
    });
    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.on('close', (code) => {
      let decision = null;
      try {
        decision = JSON.parse(stdout.trim());
      } catch {
        decision = null;
      }
      resolve({ code, decision });
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}

// Payload con un comando de shell arbitrario (para F1/F2, que no encajan en
// el helper `commit()` porque no son "git commit" a secas).
const shell = (session, command) => ({ tool_name: 'Bash', tool_input: { command }, session_id: session });

// Payload con la forma de Antigravity (toolCall.args.CommandLine en vez de tool_input.command).
const antigravityCommit = (session, command) => ({
  session_id: session,
  toolCall: { name: 'run_command', args: { CommandLine: command } },
});

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

test('registro ilegible (directorio en vez de fichero) -> arranca en 0, no bloquea', () => {
  // El formato de solo-anexado no parsea el contenido de cada linea (cualquier
  // texto es una linea valida), asi que "ilegible" ya no significa "contenido
  // invalido": significa que la lectura del fichero de estado falla (p.ej. es
  // un directorio, EISDIR). Ese fallo sigue degradando a 0 sin bloquear.
  const e = entorno(CONFIG_ADVISORY);
  fs.mkdirSync(path.join(e.dir, 'sdd-turns-' + SESSION + '.log'));
  const r = repetir(1, e.env);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null, 'el registro ilegible se lee como 0 y una accion queda por debajo del umbral');
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
  const viejo = path.join(e.dir, 'sdd-turns-sesion-vieja.log');
  writeFile(viejo, '1\n');
  const t = (Date.now() - 25 * 60 * 60 * 1000) / 1000; // 25h atras
  fs.utimesSync(viejo, t, t);

  repetir(1, e.env);

  assert.strictEqual(fs.existsSync(viejo), false, 'el fichero de la sesion vieja debe purgarse');
});

test('purga: no elimina el fichero de la sesion actual que se acaba de escribir', () => {
  const e = entorno(CONFIG_ADVISORY);
  repetir(1, e.env);
  const actual = path.join(e.dir, 'sdd-turns-' + SESSION + '.log');
  assert.strictEqual(fs.existsSync(actual), true);
});

test('sesiones concurrentes: cada una lleva su propio contador', () => {
  const e = entorno(CONFIG_ADVISORY);
  const a = repetir(2, e.env, 'sesion-A');
  assert.strictEqual(a.decision.decision, 'warn', 'la sesion A alcanzo su umbral');

  const b = repetir(1, e.env, 'sesion-B');
  assert.strictEqual(b.decision, null, 'la sesion B arranca de cero, sin heredar el contador de A');
});

// --- F1/F2/F3/F4: reset por criterio compartido y cuenta sin perdida bajo concurrencia ---

test('F1: git -c <opcion global> commit resetea el contador (opciones globales ya no rompen el match)', () => {
  const e = entorno(CONFIG_ADVISORY);
  const avisado = repetir(2, e.env); // warn_at = 2
  assert.strictEqual(avisado.decision.decision, 'warn', 'antes del commit ya avisaba');

  const reset = runHook(HOOK, shell(SESSION, 'git -c core.hooksPath=/tmp commit -m x'), e.env);
  assert.strictEqual(reset.decision, null, 'el commit con opcion global pasa sin decision');

  const tras = repetir(1, e.env);
  assert.strictEqual(tras.decision, null, 'tras el reset, una accion vuelve a estar por debajo del umbral');
});

test('F2: una mencion de "git commit" dentro de otro comando (grep) NO resetea', () => {
  const e = entorno(CONFIG_ADVISORY);
  repetir(2, e.env); // warn_at = 2: ya avisando (count = 2)
  const mencion = runHook(HOOK, shell(SESSION, 'grep -r "git commit" README.md'), e.env);
  assert.notStrictEqual(mencion.decision, null, 'la mencion no debe pasar como un reset silencioso (decision no debe ser null)');
  assert.match(mencion.decision.reason, /\b3\b/, 'la mencion cuenta como una accion mas: el contador sigue subiendo, no se reinicia');

  // Una accion mas debe seguir sumando sobre el contador NO reiniciado (4, no 1).
  const siguiente = runHook(HOOK, accion(SESSION), e.env);
  assert.match(siguiente.decision.reason, /\b4\b/, 'el contador siguio sumando: no hubo reset indebido');
});

test('F3: backend Antigravity (toolCall.args.CommandLine) resetea igual que el payload de Claude', () => {
  const e = entorno(CONFIG_ADVISORY);
  repetir(2, e.env); // warn_at = 2: ya avisando

  const reset = runHook(HOOK, antigravityCommit(SESSION, 'git commit -m x'), e.env);
  assert.strictEqual(reset.decision, null, 'el commit en forma Antigravity resetea sin emitir aviso');

  const tras = repetir(1, e.env);
  assert.strictEqual(tras.decision, null, 'tras el reset, una accion vuelve a estar por debajo del umbral');
});

test('F3 control: el mismo commit con tool_input.command (forma Claude) tambien resetea', () => {
  const e = entorno(CONFIG_ADVISORY);
  repetir(2, e.env);
  const reset = runHook(HOOK, commit(SESSION, ' -m x'), e.env);
  assert.strictEqual(reset.decision, null);
  const tras = repetir(1, e.env);
  assert.strictEqual(tras.decision, null);
});

test('F4: 20 llamadas concurrentes sobre la misma sesion no pierden incrementos', async () => {
  const dir = tempDir('sdd-turns-race-');
  const cfg = { sdd_turn_budget: { enabled: true, mode: 'advisory', warn_at: 20, block_at: 0, hard_stop_at: 0 } };
  writeFile(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_TURNS_DIR: dir };
  const session = 'sesion-carrera';

  const payload = (i) => ({ tool_name: 'Read', tool_input: { file_path: 'a' + i + '.js' }, session_id: session });
  await Promise.all(Array.from({ length: 20 }, (_, i) => runHookAsync(HOOK, payload(i), env)));

  // block_at/hard_stop_at en 0 hacen que el tier "hard stop" dispare desde la
  // primera accion (0 no desactiva el tier, lo satura): el mensaje resultante
  // cita el numero exacto de acciones vistas, que es justo lo que se quiere
  // observar. Ver premise_check del task doc para el mismo montaje.
  const r = runHook(HOOK, { tool_name: 'Read', tool_input: { file_path: 'z.js' }, session_id: session }, env);
  assert.strictEqual(r.decision.code, 'TURN_BUDGET_HARD_STOP');
  assert.match(r.decision.reason, /llevas 21 acciones sin commit/, 'las 20 llamadas concurrentes mas esta deben sumar 21, sin perdida');
});

// --- s13/03: `git add` en enforce con el presupuesto superado ---
// El unico checkpoint (commit) exige un fichero ya staged; sin esta exencion,
// stagearlo con el presupuesto superado queda bloqueado por la misma tool
// call que hace falta para llegar al commit, y el ciclo no tiene salida.

test('enforce + presupuesto superado: git add se avisa, no se deniega', () => {
  const e = entorno(CONFIG_ENFORCE);
  const previo = repetir(4, e.env); // hard_stop_at = 4: estado de partida bloqueado
  assert.strictEqual(previo.decision.decision, 'deny', 'control: el estado de partida esta bloqueado');

  const r = runHook(HOOK, shell(SESSION, 'git add nuevo.js'), e.env);
  assert.strictEqual(r.decision.decision, 'warn', 'git add se avisa, no se deniega, con el presupuesto superado');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /INTERRUMPE y espera/, 'el aviso del presupuesto se mantiene: git add no es un punto ciego');
});

test('enforce: git add no reinicia el contador -- la siguiente accion se sigue denegando', () => {
  const e = entorno(CONFIG_ENFORCE);
  repetir(4, e.env);
  runHook(HOOK, shell(SESSION, 'git add nuevo.js'), e.env);

  const siguiente = runHook(HOOK, accion(SESSION), e.env);
  assert.strictEqual(siguiente.decision.decision, 'deny', 'git add no debe comportarse como un reset encubierto');
  assert.strictEqual(siguiente.code, 2);
});

test('enforce: con el presupuesto superado una accion ordinaria se sigue denegando (control de no-regresion)', () => {
  const e = entorno(CONFIG_ENFORCE);
  const r = repetir(4, e.env);
  assert.strictEqual(r.decision.decision, 'deny', 'sin este control, el caso de git add pasaria igual con el guard entero desactivado');
  assert.strictEqual(r.code, 2);
});

test('enforce: una mencion textual de "git add" (grep) no es invocacion real y se sigue denegando', () => {
  const e = entorno(CONFIG_ENFORCE);
  repetir(4, e.env);
  const mencion = runHook(HOOK, shell(SESSION, 'grep -r "git add" README.md'), e.env);
  assert.strictEqual(mencion.decision.decision, 'deny', 'la exencion cuelga de esInvocacion, no de una subcadena');
  assert.strictEqual(mencion.code, 2);
});

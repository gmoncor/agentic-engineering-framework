'use strict';

// Contrato de sdd-session-start.js: en el evento SessionStart escribe 1 linea NDJSON
// de provenance por sesion en un fichero append-only, con 20 campos fijos que un
// consumidor externo lee por nombre. Nunca bloquea el arranque de la sesion: cualquier
// fallo de entorno (sin git, sin directorio, sin permisos, payload invalido) degrada a
// campo null o aviso por stderr, nunca a exit distinto de 0.
//
// SDD_PROVENANCE_FILE y SDD_CONFIG_PATH aislan el fichero de salida y la config en cada
// test, igual que en los demas hooks (ver sdd-turn-budget.test.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runHook, tempDir, writeFile, HOOKS_DIR } = require('./helpers');

const HOOK = 'sdd-session-start.js';

const CAMPOS_CANONICOS = [
  'v', 'session_id', 'ts', 'cwd', 'project', 'git_branch', 'repo_head',
  'framework_sha', 'framework_source', 'framework_provenance_hash', 'config_hash',
  'settings_hash', 'hooks_hash', 'agents_hash', 'skills_hash', 'session_model',
  'gates_on', 'cc_version', 'cohort_id', 'stamp_ms',
];

function entorno(config, ecosystem) {
  const dir = tempDir('sdd-session-start-');
  const provenanceFile = path.join(dir, 'ai_docs', 'audits', 'provenance.jsonl');
  if (config) writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  if (ecosystem) writeFile(path.join(dir, 'ecosystem.json'), JSON.stringify(ecosystem));
  return {
    dir,
    provenanceFile,
    env: Object.assign(
      { SDD_PROVENANCE_FILE: provenanceFile },
      config ? { SDD_CONFIG_PATH: path.join(dir, 'config.json') } : {},
      ecosystem ? { SDD_ECOSYSTEM_PATH: path.join(dir, 'ecosystem.json') } : {},
    ),
  };
}

function leerLineas(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const payload = (overrides) => Object.assign(
  { session_id: 'sesion-provenance-1', cwd: process.cwd(), model: 'claude-sonnet-5' },
  overrides,
);

test('escribe una linea NDJSON valida con los 20 campos canonicos, en orden', () => {
  const e = entorno();
  const r = runHook(HOOK, payload(), e.env);
  assert.strictEqual(r.code, 0);

  const lineas = leerLineas(e.provenanceFile);
  assert.strictEqual(lineas.length, 1);

  const linea = lineas[0];
  assert.deepStrictEqual(Object.keys(linea), CAMPOS_CANONICOS);
  assert.strictEqual(linea.v, 1);
  assert.strictEqual(linea.session_id, 'sesion-provenance-1');
  assert.strictEqual(linea.session_model, 'claude-sonnet-5');
  assert.match(linea.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(typeof linea.stamp_ms, 'number');
  assert.ok(linea.stamp_ms >= 0);
  assert.ok(Array.isArray(linea.gates_on));
});

test('fail-open: cwd sin repo git -> git_branch y repo_head quedan null, exit 0 igual', () => {
  const e = entorno();
  const sinGit = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-sin-git-'));
  const r = runHook(HOOK, payload({ cwd: sinGit }), e.env);
  assert.strictEqual(r.code, 0);

  const [linea] = leerLineas(e.provenanceFile);
  assert.strictEqual(linea.git_branch, null);
  assert.strictEqual(linea.repo_head, null);
  fs.rmSync(sinGit, { recursive: true, force: true });
});

test('provenance.jsonl es append-only: varias invocaciones anaden lineas, no sobrescriben', () => {
  const e = entorno();
  runHook(HOOK, payload({ session_id: 'sesion-a' }), e.env);
  runHook(HOOK, payload({ session_id: 'sesion-b' }), e.env);
  runHook(HOOK, payload({ session_id: 'sesion-c' }), e.env);

  const lineas = leerLineas(e.provenanceFile);
  assert.strictEqual(lineas.length, 3);
  assert.deepStrictEqual(lineas.map((l) => l.session_id), ['sesion-a', 'sesion-b', 'sesion-c']);
});

test('ai_docs/audits/ ausente se crea antes de escribir, sin fallar por ENOENT', () => {
  const e = entorno();
  assert.ok(!fs.existsSync(path.dirname(e.provenanceFile)));
  const r = runHook(HOOK, payload(), e.env);
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(e.provenanceFile));
});

test('payload SessionStart malformado (JSON invalido) -> linea con campos inferidos, sin crash', () => {
  const e = entorno();
  const result = require('child_process').spawnSync(
    process.execPath,
    [path.join(__dirname, '..', HOOK)],
    { input: '{ esto no es json valido', encoding: 'utf8', timeout: 10000, env: Object.assign({}, process.env, e.env) },
  );
  assert.strictEqual(result.status, 0);

  const [linea] = leerLineas(e.provenanceFile);
  assert.ok(linea, 'debe escribir una linea aunque el payload sea invalido');
  assert.strictEqual(typeof linea.session_id, 'string');
  assert.ok(linea.session_id.length > 0);
  assert.strictEqual(linea.cwd, process.cwd());
});

test('provenance.jsonl de solo lectura -> avisa por stderr y exit 0, no bloquea la sesion', { skip: process.getuid && process.getuid() === 0 }, () => {
  const e = entorno();
  fs.mkdirSync(path.dirname(e.provenanceFile), { recursive: true });
  fs.writeFileSync(e.provenanceFile, '');
  fs.chmodSync(e.provenanceFile, 0o444);
  fs.chmodSync(path.dirname(e.provenanceFile), 0o555);

  try {
    const r = runHook(HOOK, payload(), e.env);
    assert.strictEqual(r.code, 0);
    assert.match(r.stderr, /no se pudo escribir/);
  } finally {
    fs.chmodSync(path.dirname(e.provenanceFile), 0o755);
    fs.chmodSync(e.provenanceFile, 0o644);
  }
});

test('sin session_id en el payload, genera uno via randomUUID', () => {
  const e = entorno();
  const sinSesion = payload();
  delete sinSesion.session_id;
  runHook(HOOK, sinSesion, e.env);

  const [linea] = leerLineas(e.provenanceFile);
  assert.match(linea.session_id, /^[0-9a-f-]{36}$/);
});

test('gates_on refleja los hooks con enabled:true en hooks/config.json, ordenados', () => {
  // Tres claves encendidas cuyo orden de insercion no es el alfabetico NI su inverso:
  // con solo dos, ordenar e invertir dan la misma lista y la asercion no distingue una
  // de la otra. La entrada aparcada bajo `_` no es una puerta y no puede contarse.
  const e = entorno({
    sdd_session_start: { enabled: true },
    sdd_turn_budget: { enabled: true },
    sdd_commit_guard: { enabled: true },
    sdd_review_gate: { enabled: false },
    _nota: { enabled: true },
  });
  runHook(HOOK, payload(), e.env);

  const [linea] = leerLineas(e.provenanceFile);
  assert.deepStrictEqual(linea.gates_on, ['sdd_commit_guard', 'sdd_session_start', 'sdd_turn_budget']);
});

// El interruptor tiene que apagar la escritura, no solo el campo que la describe: una linea
// que se escribe igual mientras declara la puerta apagada afirmaria algo falso sobre su propio
// origen, y la lee un consumidor externo.
test('enabled: false apaga el hook: ni linea, ni fichero, ni exit distinto de 0', () => {
  const e = entorno({ sdd_session_start: { enabled: false }, sdd_turn_budget: { enabled: true } });
  const r = runHook(HOOK, payload(), e.env);

  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(e.provenanceFile), 'con enabled: false no debe escribir provenance');
});

test('enabled: false no deja rastro tampoco sobre un registro que ya existe', () => {
  const e = entorno({ sdd_session_start: { enabled: false } });
  fs.mkdirSync(path.dirname(e.provenanceFile), { recursive: true });
  writeFile(e.provenanceFile, JSON.stringify({ session_id: 'sesion-previa' }) + '\n');

  runHook(HOOK, payload({ session_id: 'sesion-apagada' }), e.env);

  const lineas = leerLineas(e.provenanceFile);
  assert.deepStrictEqual(lineas.map((l) => l.session_id), ['sesion-previa']);
});

test('clave sdd_session_start ausente: el default es encendido, la linea se escribe', () => {
  const e = entorno({ sdd_turn_budget: { enabled: true } });
  const r = runHook(HOOK, payload({ session_id: 'sesion-por-defecto' }), e.env);

  assert.strictEqual(r.code, 0);
  const [linea] = leerLineas(e.provenanceFile);
  assert.strictEqual(linea.session_id, 'sesion-por-defecto');
});

test('sessionStartEnabled: solo el false explicito apaga', () => {
  const { sessionStartEnabled } = require('../sdd-session-start');

  assert.strictEqual(sessionStartEnabled({ sdd_session_start: { enabled: false } }), false);
  assert.strictEqual(sessionStartEnabled({ sdd_session_start: { enabled: true } }), true);
  assert.strictEqual(sessionStartEnabled({ sdd_session_start: {} }), true);
  assert.strictEqual(sessionStartEnabled({}), true);
});

test('framework_sha lee sync.upstream_sha de ai_docs/_meta/ecosystem.json cuando existe', () => {
  const e = entorno(undefined, { sync: { upstream_sha: 'sha-de-prueba-123', backend: 'claude' } });
  runHook(HOOK, payload(), e.env);

  const [linea] = leerLineas(e.provenanceFile);
  assert.strictEqual(linea.framework_sha, 'sha-de-prueba-123');
});

test('framework_sha cae al hash de hooks/ + package.json si ecosystem.json no tiene sync.upstream_sha', () => {
  const e = entorno(undefined, { otra_clave: 'sin sync' });
  runHook(HOOK, payload(), e.env);

  const [linea] = leerLineas(e.provenanceFile);
  assert.strictEqual(typeof linea.framework_sha, 'string');
  assert.notStrictEqual(linea.framework_sha, 'sha-de-prueba-123');
  assert.match(linea.framework_sha, /^[0-9a-f]{64}$/);
});

test('--help sale de inmediato sin esperar stdin, sin escribir provenance', () => {
  const e = entorno();
  const result = require('child_process').spawnSync(
    process.execPath,
    [path.join(__dirname, '..', HOOK), '--help'],
    { encoding: 'utf8', timeout: 3000, env: Object.assign({}, process.env, e.env) },
  );
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /sdd-session-start/);
  assert.ok(!fs.existsSync(e.provenanceFile));
});

// ── Valor de los campos, no solo su nombre ───────────────────────────────────
//
// La forma de la linea (los 20 nombres, en orden) queda fijada arriba. Lo que sigue
// fija el VALOR de los campos que el consumidor externo interpreta. Un campo presente
// con un valor falso es peor que un campo ausente: el consumidor no tiene forma de
// distinguirlo de un dato bueno, y el analisis que construya sobre el sale mal sin
// que nada proteste.

const HEX64 = /^[0-9a-f]{64}$/;

// Cota superior de la marca de latencia. El campo mide lo que tarda UNA invocacion
// del hook, asi que un valor por encima de este techo delata un instante absoluto en
// vez de una diferencia. La cota inferior tiene que ser mayor que cero: "mayor o igual
// que cero" la satisface un cero fijo, y entonces el campo no mide nada.
const TECHO_STAMP_MS = 60000;

// Suelo de la enumeracion de hooks: sobre una lista vacia, la huella seria null y la
// comparacion pasaria sola.
const MIN_FICHEROS_DE_HOOK = 10;

const CAMPOS_HASH = ['config_hash', 'settings_hash', 'hooks_hash', 'agents_hash', 'skills_hash'];

test('los cinco hashes de componentes son huellas reales y distintas entre si', () => {
  const e = entorno();
  runHook(HOOK, payload(), e.env);
  const [linea] = leerLineas(e.provenanceFile);

  for (const campo of CAMPOS_HASH) {
    assert.match(String(linea[campo]), HEX64, campo + ' no es una huella sha256');
  }
  assert.strictEqual(
    new Set(CAMPOS_HASH.map((campo) => linea[campo])).size,
    CAMPOS_HASH.length,
    'dos componentes distintos comparten huella: la linea no permite ver cual de ellos cambio',
  );
});

test('hooks_hash es la huella del contenido real de hooks/, no un valor fijo', () => {
  const { hashPaths } = require('../sdd-session-start');
  const e = entorno();
  runHook(HOOK, payload(), e.env);
  const [linea] = leerLineas(e.provenanceFile);

  const ficheros = fs.readdirSync(HOOKS_DIR)
    .filter((nombre) => nombre.endsWith('.js'))
    .sort()
    .map((nombre) => path.join(HOOKS_DIR, nombre));
  assert.ok(ficheros.length >= MIN_FICHEROS_DE_HOOK,
    'la enumeracion encontro ' + ficheros.length + ' hooks, minimo ' + MIN_FICHEROS_DE_HOOK
    + ': una huella sobre una lista vacia se cumple sola');

  assert.strictEqual(linea.hooks_hash, hashPaths(ficheros),
    'hooks_hash no coincide con el contenido de hooks/*.js que hay en disco');
});

test('la huella sigue al contenido: editar un fichero la mueve, restaurarlo la devuelve', () => {
  const { hashPaths } = require('../sdd-session-start');
  const dir = tempDir('sdd-huella-');
  const fichero = writeFile(path.join(dir, 'uno.js'), 'contenido inicial\n');

  const inicial = hashPaths([dir]);
  fs.writeFileSync(fichero, 'contenido cambiado\n');
  const cambiado = hashPaths([dir]);
  fs.writeFileSync(fichero, 'contenido inicial\n');

  assert.match(inicial, HEX64);
  assert.notStrictEqual(cambiado, inicial, 'una edicion en el arbol no movio la huella');
  assert.strictEqual(hashPaths([dir]), inicial, 'la huella no es reproducible sobre el mismo contenido');

  // El nombre del fichero entra en la huella: el mismo contenido en otra ruta es otro arbol.
  const otro = writeFile(path.join(dir, 'dos.js'), 'contenido inicial\n');
  assert.notStrictEqual(hashPaths([otro]), hashPaths([fichero]));
  assert.strictEqual(hashPaths([path.join(dir, 'no-existe')]), null, 'sin contenido que resolver, null');
});

test('config_hash sigue el contenido de la configuracion, no su mera presencia', () => {
  const e = entorno({ sdd_turn_budget: { enabled: true } });
  runHook(HOOK, payload({ session_id: 'config-a' }), e.env);
  runHook(HOOK, payload({ session_id: 'config-a-de-nuevo' }), e.env);
  writeFile(path.join(e.dir, 'config.json'), JSON.stringify({ sdd_turn_budget: { enabled: true }, sdd_review_gate: { enabled: true } }));
  runHook(HOOK, payload({ session_id: 'config-b' }), e.env);

  const [a, aDeNuevo, b] = leerLineas(e.provenanceFile);
  assert.strictEqual(aDeNuevo.config_hash, a.config_hash, 'la misma configuracion debe dar la misma huella');
  assert.notStrictEqual(b.config_hash, a.config_hash, 'una configuracion editada debe mover la huella');
});

// El identificador de cohorte existe para una sola cosa: agrupar sesiones por
// configuracion y modelo. Degradado a constante agrupa todo con todo, y quien lo
// consume no distingue ese caso de una maquina que de verdad nunca cambia.
test('cohort_id: la misma configuracion y el mismo modelo dan la misma cohorte', () => {
  const e = entorno({ sdd_turn_budget: { enabled: true } });
  runHook(HOOK, payload({ session_id: 'cohorte-uno' }), e.env);
  runHook(HOOK, payload({ session_id: 'cohorte-dos' }), e.env);

  const [uno, dos] = leerLineas(e.provenanceFile);
  assert.match(uno.cohort_id, HEX64);
  assert.notStrictEqual(dos.session_id, uno.session_id, 'son dos sesiones distintas');
  assert.strictEqual(dos.cohort_id, uno.cohort_id,
    'dos sesiones con la misma configuracion y el mismo modelo deben caer en la misma cohorte');
});

test('cohort_id: cambiar el modelo o la configuracion abre otra cohorte', () => {
  const e = entorno({ sdd_turn_budget: { enabled: true } });
  runHook(HOOK, payload({ session_id: 'base' }), e.env);
  runHook(HOOK, payload({ session_id: 'otro-modelo', model: 'otro-modelo-distinto' }), e.env);
  writeFile(path.join(e.dir, 'config.json'), JSON.stringify({ sdd_turn_budget: { enabled: false } }));
  runHook(HOOK, payload({ session_id: 'otra-config' }), e.env);

  const [base, otroModelo, otraConfig] = leerLineas(e.provenanceFile);
  assert.notStrictEqual(otroModelo.cohort_id, base.cohort_id, 'otro modelo es otra cohorte');
  assert.notStrictEqual(otraConfig.cohort_id, base.cohort_id, 'otra configuracion es otra cohorte');
});

test('stamp_ms mide la latencia de esta invocacion: mayor que cero y por debajo del techo', () => {
  const e = entorno();
  runHook(HOOK, payload(), e.env);
  const [linea] = leerLineas(e.provenanceFile);

  assert.ok(linea.stamp_ms > 0,
    'stamp_ms es ' + linea.stamp_ms + ': un cero fijo satisface "mayor o igual que cero" sin medir nada');
  assert.ok(linea.stamp_ms < TECHO_STAMP_MS,
    'stamp_ms es ' + linea.stamp_ms + ', por encima de ' + TECHO_STAMP_MS
    + 'ms: eso no es la latencia de una invocacion, sino un instante absoluto');
});

test('framework_source distingue las tres procedencias, y una copia de trabajo es local', () => {
  const { resolveFrameworkSource } = require('../sdd-session-start');

  assert.strictEqual(resolveFrameworkSource('/home/persona/.npm/_npx/9a1b/node_modules/marco'), 'npx');
  assert.strictEqual(resolveFrameworkSource('C:\\Users\\persona\\npm-cache\\_npx\\9a1b\\node_modules'), 'npx');
  assert.strictEqual(resolveFrameworkSource('/home/persona/.cliente/plugins/cache/marco'), 'plugin');
  assert.strictEqual(resolveFrameworkSource('C:\\Users\\persona\\.cliente\\plugin\\marco'), 'plugin');
  assert.strictEqual(resolveFrameworkSource('/home/persona/proyectos/mi-proyecto'), 'local');

  const e = entorno();
  runHook(HOOK, payload(), e.env);
  const [linea] = leerLineas(e.provenanceFile);
  assert.strictEqual(linea.framework_source, 'local', 'este arbol no viene de un cache de paquetes ni de un plugin');
});

test('framework_provenance_hash sigue al sha del framework, no es un valor fijo', () => {
  const a = entorno(undefined, { sync: { upstream_sha: 'sha-de-prueba-aaa' } });
  runHook(HOOK, payload(), a.env);
  const b = entorno(undefined, { sync: { upstream_sha: 'sha-de-prueba-bbb' } });
  runHook(HOOK, payload(), b.env);

  const [lineaA] = leerLineas(a.provenanceFile);
  const [lineaB] = leerLineas(b.provenanceFile);
  assert.match(lineaA.framework_provenance_hash, HEX64);
  assert.notStrictEqual(lineaB.framework_provenance_hash, lineaA.framework_provenance_hash,
    'dos instalaciones de codigo distinto no pueden compartir huella de procedencia');
});

test('project sale del payload, y sin el, del nombre del directorio de trabajo', () => {
  const e = entorno();
  runHook(HOOK, payload({ session_id: 'con-project', project: 'nombre-declarado' }), e.env);

  const dirUno = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecto-uno-'));
  const dirDos = fs.mkdtempSync(path.join(os.tmpdir(), 'proyecto-dos-'));
  try {
    runHook(HOOK, payload({ session_id: 'sin-project-uno', cwd: dirUno }), e.env);
    runHook(HOOK, payload({ session_id: 'sin-project-dos', cwd: dirDos }), e.env);

    const [declarado, uno, dos] = leerLineas(e.provenanceFile);
    assert.strictEqual(declarado.project, 'nombre-declarado', 'el payload manda cuando trae el nombre');
    assert.strictEqual(uno.project, path.basename(dirUno));
    assert.notStrictEqual(dos.project, uno.project,
      'dos directorios de trabajo distintos no pueden dar el mismo nombre de proyecto');
  } finally {
    fs.rmSync(dirUno, { recursive: true, force: true });
    fs.rmSync(dirDos, { recursive: true, force: true });
  }
});

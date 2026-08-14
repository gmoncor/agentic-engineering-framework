'use strict';

// Contrato de la capa de configuracion opcional del proyecto (sdd.config.json):
// loadExtensionConfig en hooks/sdd-plan-state.js y su consumo desde hooks/sdd-session-start.js.
//
// LO QUE HAY QUE ACREDITAR
// El fichero vive en la raiz del proyecto y NO se distribuye, para que una actualizacion del
// framework no lo pise. De ahi salen las dos garantias que se prueban aqui:
//   1. Sin fichero — el caso normal, la inmensa mayoria de instalaciones — el framework opera
//      EXACTAMENTE igual que si esta capa no existiera: mismos 20 campos canonicos en el
//      registro de sesiones, mismo destino, cero ruido por stderr.
//   2. Con fichero, lo declarado se aplica sin poder deformar lo que ya lee un consumidor
//      externo: los campos propios se anaden detras y no sustituyen a ninguno canonico.
//
// Y los tres desenlaces que no pueden romper una sesion: fichero ausente, fichero corrupto y
// fichero con claves que este framework no conoce.
//
// SDD_EXTENSION_CONFIG aisla el fichero en cada test, igual que SDD_CONFIG_PATH y
// SDD_PROVENANCE_FILE aislan los suyos (ver sdd-session-start.test.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');
const { loadExtensionConfig } = require('../sdd-plan-state');

const HOOK = 'sdd-session-start.js';

const CAMPOS_CANONICOS = [
  'v', 'session_id', 'ts', 'cwd', 'project', 'git_branch', 'repo_head',
  'framework_sha', 'framework_source', 'framework_provenance_hash', 'config_hash',
  'settings_hash', 'hooks_hash', 'agents_hash', 'skills_hash', 'session_model',
  'gates_on', 'cc_version', 'cohort_id', 'stamp_ms',
];

/**
 * Proyecto de prueba con (o sin) sdd.config.json. `contenido` se escribe literalmente para poder
 * ejercitar tambien un fichero que no es JSON; omitirlo deja el proyecto sin configuracion.
 */
function proyecto(contenido) {
  const dir = tempDir('sdd-extension-config-');
  const configFile = path.join(dir, 'sdd.config.json');
  if (contenido !== undefined) writeFile(configFile, contenido);

  return {
    dir,
    configFile,
    provenanceFile: path.join(dir, 'ai_docs', 'audits', 'provenance.jsonl'),
    env: { SDD_EXTENSION_CONFIG: configFile },
  };
}

const declarando = (objeto) => proyecto(JSON.stringify(objeto));

const payload = (overrides) => Object.assign(
  { session_id: 'sesion-extension-1', cwd: process.cwd(), model: 'claude-sonnet-5' },
  overrides,
);

function leerLineas(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Corre el hook de arranque de sesion escribiendo el registro en el proyecto de prueba. */
function arrancarSesion(p, envExtra) {
  const env = Object.assign({ SDD_PROVENANCE_FILE: p.provenanceFile }, p.env, envExtra || {});
  const r = runHook(HOOK, payload(), env);
  return { resultado: r, lineas: leerLineas(p.provenanceFile) };
}

/** Aisla el env de un test in-process: SDD_EXTENSION_CONFIG no puede filtrarse al siguiente. */
function conConfig(file, fn) {
  const previo = process.env.SDD_EXTENSION_CONFIG;
  process.env.SDD_EXTENSION_CONFIG = file;
  try {
    return fn();
  } finally {
    if (previo === undefined) delete process.env.SDD_EXTENSION_CONFIG;
    else process.env.SDD_EXTENSION_CONFIG = previo;
  }
}

// ─── Caso normal: sin fichero, el framework opera identicamente a como lo hacia ──────────────

test('sin sdd.config.json, loadExtensionConfig devuelve {} sin emitir nada', () => {
  const p = proyecto();
  const config = conConfig(p.configFile, () => loadExtensionConfig(p.dir));
  assert.deepStrictEqual(config, {});
});

test('sin sdd.config.json, el registro de sesion lleva los 20 campos canonicos y nada mas', () => {
  const p = proyecto();
  const { resultado, lineas } = arrancarSesion(p);

  assert.strictEqual(resultado.code, 0);
  assert.strictEqual(lineas.length, 1);
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS);
});

test('sin sdd.config.json no hay ruido por stderr: la ausencia es el caso normal, no una carencia', () => {
  const { resultado } = arrancarSesion(proyecto());
  assert.doesNotMatch(resultado.stderr, /SDD_EXTENSION_ADVISORY/);
});

// ─── Campos propios en el registro de sesion ─────────────────────────────────────────────────

test('audit.extra_fields anade los campos declarados a la linea del registro', () => {
  const p = declarando({ audit: { extra_fields: { equipo: 'plataforma', centro_de_coste: 'PLT-114' } } });
  const { resultado, lineas } = arrancarSesion(p);

  assert.strictEqual(resultado.code, 0);
  assert.strictEqual(lineas[0].equipo, 'plataforma');
  assert.strictEqual(lineas[0].centro_de_coste, 'PLT-114');
});

test('los campos propios van DETRAS de los canonicos, que conservan su orden', () => {
  const p = declarando({ audit: { extra_fields: { equipo: 'plataforma' } } });
  const { lineas } = arrancarSesion(p);

  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS.concat(['equipo']));
});

test('un campo propio NO puede sustituir a uno canonico: gana el canonico', () => {
  const p = declarando({
    audit: { extra_fields: { session_id: 'suplantado', cohort_id: 'suplantado', propio: 'ok' } },
  });
  const { lineas } = arrancarSesion(p);

  assert.strictEqual(lineas[0].session_id, 'sesion-extension-1');
  assert.notStrictEqual(lineas[0].cohort_id, 'suplantado');
  assert.strictEqual(lineas[0].propio, 'ok');
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS.concat(['propio']));
});

test('los valores de los campos propios se transportan tal cual, sin interpretarlos', () => {
  const p = declarando({ audit: { extra_fields: { numero: 7, lista: ['a', 'b'], nulo: null } } });
  const { lineas } = arrancarSesion(p);

  assert.strictEqual(lineas[0].numero, 7);
  assert.deepStrictEqual(lineas[0].lista, ['a', 'b']);
  assert.strictEqual(lineas[0].nulo, null);
});

// ─── Destino declarado del registro ──────────────────────────────────────────────────────────

test('audit.provenance_dest absoluto redirige el registro a esa ruta', () => {
  const p = declarando({});
  const destino = path.join(p.dir, 'registro', 'sesiones.jsonl');
  fs.writeFileSync(p.configFile, JSON.stringify({ audit: { provenance_dest: destino } }));

  // Sin SDD_PROVENANCE_FILE: la variable de entorno tiene prioridad y taparia lo declarado.
  const r = runHook(HOOK, payload(), p.env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(leerLineas(destino).length, 1);
});

test('SDD_PROVENANCE_FILE tiene prioridad sobre audit.provenance_dest', () => {
  const p = declarando({ audit: { provenance_dest: path.join(tempDir('sdd-ext-ignorado-'), 'no.jsonl') } });
  const { resultado, lineas } = arrancarSesion(p);

  assert.strictEqual(resultado.code, 0);
  assert.strictEqual(lineas.length, 1);
});

// ─── Fichero corrupto: avisa y sigue, nunca rompe la sesion ──────────────────────────────────

test('sdd.config.json con JSON invalido: aviso firmado, defaults y sesion viva', () => {
  const p = proyecto('{ "audit": esto no es json');
  const { resultado, lineas } = arrancarSesion(p);

  assert.strictEqual(resultado.code, 0);
  assert.match(resultado.stderr, /\[SDD_EXTENSION_ADVISORY\]/);
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS);
});

test('sdd.config.json cuya raiz no es un objeto: mismo trato que un JSON invalido', () => {
  const p = proyecto('["no", "es", "un", "objeto"]');
  const { resultado, lineas } = arrancarSesion(p);

  assert.strictEqual(resultado.code, 0);
  assert.match(resultado.stderr, /\[SDD_EXTENSION_ADVISORY\]/);
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS);
});

test('el aviso de configuracion ilegible nombra el fichero y la causa', () => {
  const p = proyecto('{ roto');
  const { resultado } = arrancarSesion(p);

  assert.match(resultado.stderr, new RegExp(p.configFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(resultado.stderr, /valores por defecto/);
});

test('loadExtensionConfig degrada a {} ante un fichero corrupto, no lanza', () => {
  const p = proyecto('{{{');
  const config = conConfig(p.configFile, () => loadExtensionConfig(p.dir));
  assert.deepStrictEqual(config, {});
});

// ─── Claves desconocidas: compatibilidad hacia delante ───────────────────────────────────────

test('claves que este framework no conoce se transportan sin consumirse ni fallar', () => {
  const p = declarando({
    version_del_esquema: 99,
    funcion_del_futuro: { activa: true },
    audit: { extra_fields: { equipo: 'plataforma' }, campo_futuro_de_audit: 'x' },
  });

  const config = conConfig(p.configFile, () => loadExtensionConfig(p.dir));
  assert.strictEqual(config.version_del_esquema, 99);
  assert.deepStrictEqual(config.funcion_del_futuro, { activa: true });

  const { resultado, lineas } = arrancarSesion(p);
  assert.strictEqual(resultado.code, 0);
  assert.doesNotMatch(resultado.stderr, /SDD_EXTENSION_ADVISORY/);
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS.concat(['equipo']));
});

test('una clave conocida con el tipo equivocado se ignora sin arrastrar al resto del fichero', () => {
  const p = declarando({ audit: 'esto deberia ser un objeto' });
  const { resultado, lineas } = arrancarSesion(p);

  assert.strictEqual(resultado.code, 0);
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS);
});

test('extra_fields con el tipo equivocado se ignora y la linea queda canonica', () => {
  const p = declarando({ audit: { extra_fields: ['no', 'es', 'un', 'objeto'] } });
  const { lineas } = arrancarSesion(p);

  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS);
});

// ─── Capa declarativa: se lee, no se consume ─────────────────────────────────────────────────

test('mcp_servers, extra_surfaces y model_override se leen; ninguno produce efecto observable', () => {
  const p = declarando({
    mcp_servers: [{ name: 'catalogo-interno', url: 'https://mcp.ejemplo.internal', auth_type: 'oauth' }],
    extra_surfaces: ['.interno/hooks/politica-de-datos.js'],
    model_override: { claude: 'claude-opus-4-8' },
  });

  const config = conConfig(p.configFile, () => loadExtensionConfig(p.dir));
  assert.strictEqual(config.mcp_servers[0].name, 'catalogo-interno');
  assert.deepStrictEqual(config.extra_surfaces, ['.interno/hooks/politica-de-datos.js']);
  assert.strictEqual(config.model_override.claude, 'claude-opus-4-8');

  // Declarar no es conectar ni cargar: la sesion arranca igual que sin configuracion.
  const { resultado, lineas } = arrancarSesion(p);
  assert.strictEqual(resultado.code, 0);
  assert.deepStrictEqual(Object.keys(lineas[0]), CAMPOS_CANONICOS);
});

// ─── Anclaje y cache ─────────────────────────────────────────────────────────────────────────

test('sin la variable de entorno, el fichero se busca en la raiz del proyecto, no en el cwd', () => {
  const raiz = tempDir('sdd-extension-raiz-');
  fs.mkdirSync(path.join(raiz, '.git'));
  writeFile(path.join(raiz, 'sdd.config.json'), JSON.stringify({ marca: 'raiz-del-proyecto' }));
  const hondo = path.join(raiz, 'src', 'modulo', 'interno');
  fs.mkdirSync(hondo, { recursive: true });

  const previo = process.env.SDD_EXTENSION_CONFIG;
  delete process.env.SDD_EXTENSION_CONFIG;
  try {
    assert.strictEqual(loadExtensionConfig(hondo).marca, 'raiz-del-proyecto');
  } finally {
    if (previo !== undefined) process.env.SDD_EXTENSION_CONFIG = previo;
  }
});

test('el fichero se lee una sola vez por proceso: la segunda llamada no vuelve al disco', () => {
  const p = declarando({ marca: 'primera-lectura' });

  conConfig(p.configFile, () => {
    assert.strictEqual(loadExtensionConfig(p.dir).marca, 'primera-lectura');
    fs.writeFileSync(p.configFile, JSON.stringify({ marca: 'segunda-lectura' }));
    assert.strictEqual(loadExtensionConfig(p.dir).marca, 'primera-lectura');
  });
});

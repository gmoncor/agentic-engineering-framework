#!/usr/bin/env node
'use strict';

/**
 * SDD Session Start — hook de provenance en el evento SessionStart.
 *
 * Escribe 1 linea NDJSON por sesion en `ai_docs/audits/provenance.jsonl` (append-only)
 * con 20 campos, en orden fijo: v, session_id, ts, cwd, project, git_branch, repo_head,
 * framework_sha, framework_source, framework_provenance_hash, config_hash, settings_hash,
 * hooks_hash, agents_hash, skills_hash, session_model, gates_on, cc_version, cohort_id,
 * stamp_ms. Un consumidor externo lee estos nombres literales: no renombrar ni reordenar
 * sin actualizar tambien al consumidor.
 *
 * Los 20 son el suelo, no el techo: un proyecto puede declarar campos propios en
 * `audit.extra_fields` de su sdd.config.json (docs/extension-config-schema.md). Se anaden
 * DETRAS de los canonicos y no pueden sustituir a ninguno, asi que la linea que lee el
 * consumidor externo no cambia de forma; solo puede llevar mas cosas al final. Sin ese
 * fichero — el caso normal — la linea tiene exactamente los 20 campos de arriba.
 *
 * ANCLA DE RUTAS: `ROOT` (path.join(__dirname, '..')) localiza hooks/, package.json,
 * ai_docs/ y los ficheros de wiring por backend. Nunca process.cwd(): tras instalar el
 * framework en un proyecto destino, __dirname siempre resuelve a la raiz de ese proyecto,
 * incluso si la sesion arranca desde un subdirectorio.
 *
 * ENCENDIDO Y APAGADO: `sdd_session_start.enabled` de hooks/config.json controla si el hook
 * corre. Ausente o `true` -> corre (el default es encendido, igual que sdd_read_before_edit).
 * `false` -> no escribe NADA y sale con 0. La clave tiene que apagar la escritura, no solo
 * quitarse del campo `gates_on`: una linea que se sigue escribiendo mientras declara la puerta
 * apagada afirmaria algo falso sobre su propio origen, y la lee un consumidor externo. Ese es
 * tambien el motivo para no retirar la clave: este hook anade una linea con el directorio de
 * trabajo, la rama, el commit y hashes de la maquina en cada arranque de sesion, asi que quien
 * recibe el framework tiene que poder apagarlo sin desmontar el cableado del backend.
 *
 * DEGRADACION SEGURA (nunca rompe ni bloquea la sesion):
 *   - git ausente o directorio sin repo -> git_branch/repo_head quedan null.
 *   - ai_docs/audits/ no existe -> se crea antes de escribir.
 *   - provenance.jsonl no escribible -> aviso por stderr, exit 0 igual.
 *   - payload de SessionStart ausente o JSON invalido -> campos inferidos del entorno.
 *   - sdd.config.json ilegible -> aviso firmado por stderr y linea con los 20 campos canonicos.
 *
 * framework_sha lee `sync.upstream_sha` de ai_docs/_meta/ecosystem.json (formato que fija
 * el escritor de ese fichero); si no existe el fichero o la clave, cae al hash de hooks/ +
 * package.json.
 *
 * cc_version se resuelve leyendo variables de entorno candidatas, nunca lanzando el
 * binario del cliente: medido en un hook hermano, ese lanzamiento tarda mas de 2s y a
 * veces agota el timeout, inaceptable en un hook que corre en cada arranque de sesion.
 * Ninguna de las tres CLIs objetivo documenta hoy una variable de version para hooks:
 * el campo degrada a null hasta que exista una fuente instantanea.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readPayload, loadConfig } = require('./sdd-hook-utils');
const { toNativePath, resolveRepoPath, loadExtensionConfig, isPlainObject } = require('./sdd-plan-state');

const SCHEMA_VERSION = 1;
const ROOT = path.join(__dirname, '..');

const AGENT_DIRS = ['.claude/agents', '.codex/agents', '.gemini/agents', '.agents/plugins/sdd/agents']
  .map((rel) => path.join(ROOT, rel));
const SKILL_DIRS = ['.claude/skills', '.gemini/skills', '.agents/skills']
  .map((rel) => path.join(ROOT, rel));
const WIRING_FILES = ['.claude/settings.json', 'hooks/hooks.json', '.codex/hooks.json', '.agents/hooks.json']
  .map((rel) => path.join(ROOT, rel));
const VERSION_ENV_CANDIDATES = ['CLAUDE_CODE_VERSION', 'GEMINI_CLI_VERSION', 'CODEX_CLI_VERSION', 'CLI_VERSION'];

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJsonSafe(file) {
  const raw = readFileSafe(file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listFilesRecursive(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  let out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Hash deterministico de un conjunto de ficheros/directorios. null si ninguno resuelve contenido. */
function hashPaths(paths) {
  let files = [];
  for (const target of paths) {
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (stat.isDirectory()) files = files.concat(listFilesRecursive(target));
    else if (stat.isFile()) files.push(target);
  }
  if (files.length === 0) return null;
  files.sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const content = readFileSafe(file);
    if (content === null) continue;
    hash.update(path.relative(ROOT, file));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function hookImplementationFiles() {
  let entries;
  try {
    entries = fs.readdirSync(path.join(ROOT, 'hooks'));
  } catch {
    return [];
  }
  return entries.filter((name) => name.endsWith('.js')).sort().map((name) => path.join(ROOT, 'hooks', name));
}

function gitField(cwd, args) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000 });
    if (r.error || r.status !== 0) return null;
    const out = (r.stdout || '').trim();
    return out || null;
  } catch {
    return null;
  }
}

/** npx/plugin/local, inferido de donde vive este fichero (ROOT). Nunca lanza el binario. */
function resolveFrameworkSource(root) {
  if (/_npx[\\/]/.test(root)) return 'npx';
  if (/[\\/]plugins?[\\/]/i.test(root)) return 'plugin';
  return 'local';
}

function resolveClientVersion(env) {
  for (const name of VERSION_ENV_CANDIDATES) {
    if (env[name]) return env[name];
  }
  return null;
}

function gatesOn(config) {
  return Object.keys(config)
    .filter((key) => !key.startsWith('_'))
    .filter((key) => config[key] && config[key].enabled === true)
    .sort();
}

/**
 * Si este hook debe correr, segun `sdd_session_start.enabled` de hooks/config.json.
 * Ausente o distinto de `false` -> corre; el default es encendido. Con `false` no se escribe
 * ninguna linea: la unica forma de que `gates_on` no pueda mentir sobre esta puerta es que la
 * puerta apagada no produzca registro.
 */
function sessionStartEnabled(config) {
  const cfg = (config && config.sdd_session_start) || {};
  return cfg.enabled !== false;
}

/**
 * Seccion `audit` de la configuracion opcional del proyecto (docs/extension-config-schema.md),
 * o `{}` si el proyecto no declara ninguna — el caso normal. `ROOT` es el ancla: tras instalar,
 * la raiz del proyecto destino, la misma que ya localiza el resto de rutas de este hook.
 */
function auditExtension() {
  const audit = loadExtensionConfig(ROOT).audit;
  return isPlainObject(audit) ? audit : {};
}

/**
 * Destino de la linea de provenance, por orden de precedencia: la variable de entorno (override
 * explicito de una invocacion concreta), lo que declare el proyecto, y el destino por defecto.
 *
 * Un destino relativo se situa contra la raiz del proyecto, no contra el directorio del proceso.
 * Uno que se escape de esa raiz no se resuelve a ciegas: cae al destino por defecto, porque una
 * configuracion mal escrita no debe dirigir escrituras a cualquier punto del disco.
 */
function provenanceDest() {
  if (process.env.SDD_PROVENANCE_FILE) return process.env.SDD_PROVENANCE_FILE;
  const declarado = auditExtension().provenance_dest;
  const resuelto = typeof declarado === 'string' && declarado ? resolveRepoPath(declarado, ROOT) : null;
  return resuelto || path.join(ROOT, 'ai_docs', 'audits', 'provenance.jsonl');
}

/** Mismo fichero que resuelve loadConfig(): SDD_CONFIG_PATH lo aisla en tests. */
function configFilePath() {
  return process.env.SDD_CONFIG_PATH || path.join(ROOT, 'hooks', 'config.json');
}

function ecosystemFilePath() {
  return process.env.SDD_ECOSYSTEM_PATH || path.join(ROOT, 'ai_docs', '_meta', 'ecosystem.json');
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function appendLine(file, line) {
  try {
    fs.appendFileSync(file, line + '\n');
  } catch (err) {
    try {
      fs.writeSync(2, '[SDD] no se pudo escribir provenance en ' + file + ': ' + err.message + '\n');
    } catch {
      // stderr roto: nada mas que hacer.
    }
  }
}

/** Identidad del framework instalado: que codigo corre y de donde vino. */
function resolveFrameworkIdentity() {
  const pkg = readJsonSafe(path.join(ROOT, 'package.json')) || {};
  const ecosystem = readJsonSafe(ecosystemFilePath());
  const upstreamSha = ecosystem && ecosystem.sync && ecosystem.sync.upstream_sha;
  const sha = upstreamSha
    ? String(upstreamSha)
    : hashPaths([path.join(ROOT, 'hooks'), path.join(ROOT, 'package.json')]);
  const source = resolveFrameworkSource(ROOT);
  const provenanceHash = sha ? sha256([sha, source, pkg.version || ''].join('|')) : null;
  return { sha, source, provenanceHash };
}

/** Huellas de los componentes instalados: config, wiring por backend, hooks, agentes, skills. */
function resolveComponentHashes() {
  return {
    config: hashPaths([configFilePath()]),
    settings: hashPaths(WIRING_FILES),
    hooks: hashPaths(hookImplementationFiles()),
    agents: hashPaths(AGENT_DIRS),
    skills: hashPaths(SKILL_DIRS),
  };
}

function buildLine(payload, startedAt, configuracion) {
  // El cwd llega en el payload: separadores traducidos antes de derivar nada de el, o path.basename
  // devuelve la ruta entera como nombre del proyecto cuando el cliente y el hook no son del mismo
  // sistema. Ver toNativePath en sdd-plan-state.js.
  const cwd = toNativePath(payload.cwd) || process.cwd();
  const framework = resolveFrameworkIdentity();
  const hashes = resolveComponentHashes();
  const config = configuracion || loadConfig(configFilePath());
  const sessionModel = payload.model || null;
  const cohortId = sha256(
    [hashes.config, hashes.settings, hashes.hooks, sessionModel].map((v) => (v === null ? '' : String(v))).join('|'),
  );

  return conCamposDeclarados({
    v: SCHEMA_VERSION,
    session_id: payload.session_id || crypto.randomUUID(),
    ts: new Date().toISOString(),
    cwd,
    project: payload.project || path.basename(cwd),
    git_branch: gitField(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    repo_head: gitField(cwd, ['rev-parse', 'HEAD']),
    framework_sha: framework.sha,
    framework_source: framework.source,
    framework_provenance_hash: framework.provenanceHash,
    config_hash: hashes.config,
    settings_hash: hashes.settings,
    hooks_hash: hashes.hooks,
    agents_hash: hashes.agents,
    skills_hash: hashes.skills,
    session_model: sessionModel,
    gates_on: gatesOn(config),
    cc_version: resolveClientVersion(process.env),
    cohort_id: cohortId,
    stamp_ms: Date.now() - startedAt,
  });
}

/**
 * Anade los campos que el proyecto declare en `audit.extra_fields`, si declara alguno.
 *
 * Dos limites que hacen que la linea siga siendo la misma linea para el consumidor externo:
 *   - Los campos propios van DETRAS de los canonicos, nunca intercalados.
 *   - Un nombre que colisione con un campo canonico se descarta: gana el canonico. Sin esta regla
 *     una configuracion podria sustituir session_id o cohort_id por otra cosa, y la linea seguiria
 *     pareciendo valida mientras dice algo distinto de lo que el consumidor cree leer.
 *
 * El valor no se interpreta ni se valida: el framework lo transporta tal cual.
 */
function conCamposDeclarados(line) {
  const extra = auditExtension().extra_fields;
  if (!isPlainObject(extra)) return line;

  for (const [name, value] of Object.entries(extra)) {
    if (name in line) continue;
    line[name] = value;
  }
  return line;
}

async function main() {
  const startedAt = Date.now();
  const data = await readPayload();

  const config = loadConfig(configFilePath());
  if (!sessionStartEnabled(config)) process.exit(0);

  const line = buildLine(data || {}, startedAt, config);

  const dest = provenanceDest();
  if (ensureDir(path.dirname(dest))) appendLine(dest, JSON.stringify(line));

  process.exit(0);
}

if (require.main === module) {
  if (process.argv.includes('--help')) {
    fs.writeSync(1, 'sdd-session-start.js: hook SessionStart, escribe provenance NDJSON en ai_docs/audits/provenance.jsonl\n'
      + 'Para apagarlo: sdd_session_start.enabled: false en hooks/config.json (apagado no escribe nada).\n'
      + 'Para cambiar destino o anadir campos: sdd.config.json del proyecto (docs/extension-config-schema.md).\n');
    process.exit(0);
  }
  main().catch(() => process.exit(0));
}

module.exports = {
  buildLine,
  hashPaths,
  resolveFrameworkSource,
  resolveClientVersion,
  gatesOn,
  sessionStartEnabled,
  provenanceDest,
};

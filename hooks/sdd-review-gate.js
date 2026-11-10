#!/usr/bin/env node
'use strict';

// Gate de revision: solo deja pasar un commit cuyo diff preparado coincide con
// la senal de revision. Los limites de analisis estan documentados en
// hooks/CONVENTIONS.md y CI con proteccion de rama es la frontera dura.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readPayload, readToolCall, skipRequested, loadConfig, hookEnabled,
  ALLOW, warnResult, denyResult, emitResult, runWithFailOpen,
} = require('./sdd-hook-utils');
const { DEFAULT_TTL_MS, readSignal, hashDiff } = require('./sdd-review-signal');
const { invocaciones, usaFlag, tokenizar } = require('./sdd-git-command');
const { toNativePath } = require('./sdd-plan-state');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'run_command', 'shell']);
const BLOCK_FIRMA = '[SDD_REVIEW_BLOCK] ';
const ADVISORY_FIRMA = '[SDD_REVIEW_ADVISORY] ';
const SIN_SENAL = BLOCK_FIRMA + 'SDD: este diff no consta revisado. Prepara los bytes, repite la revision y vuelve a intentar el commit con /implementar-spec.';
const HASH_NO_ATA = BLOCK_FIRMA + 'SDD: la revision registrada no corresponde al diff que vas a commitear. Prepara los bytes, repite la revision y vuelve a intentar el commit.';
const ARBOL_NO_REVISADO = BLOCK_FIRMA + 'SDD: este commit puede incorporar bytes del arbol no revisados. Prepara los bytes con git add, repite la revision y vuelve a intentar el commit.';
const SIN_DIFF = ADVISORY_FIRMA + 'SDD: no hay diff cacheado que contrastar. Prepara los bytes y asegurate de que paso la revision adversarial.';
const SKIP_AVISO = ADVISORY_FIRMA + 'SDD: SDD_GUARD_SKIP activo. El bloqueo de revision queda degradado a aviso.';

function invocacionesDeCommit(cmd) {
  return invocaciones(cmd).filter(inv => inv.programa === 'git'
    && (inv.palabras[0] === 'commit' || inv.palabras[0] === 'merge'));
}

function baseDelPayload(data) {
  const cwd = data && typeof data.cwd === 'string' ? toNativePath(data.cwd) : '';
  return path.resolve(cwd || process.cwd());
}

function resolverRuta(valor, desde) {
  let ruta = toNativePath(valor);
  if (!ruta || /[$`]/.test(ruta)) return null;
  if (ruta === '~' || ruta.startsWith('~/')) ruta = path.join(os.homedir(), ruta.slice(1));
  else if (ruta.startsWith('~')) return null;
  const absoluta = path.resolve(desde, ruta);
  return fs.existsSync(absoluta) ? absoluta : null;
}

function esPrefijo(grupos, posiblesPadres) {
  return Array.isArray(grupos) && Array.isArray(posiblesPadres)
    && grupos.length <= posiblesPadres.length
    && grupos.every((grupo, indice) => grupo === posiblesPadres[indice]);
}

function separadoresSeguros(cambio, commit) {
  const seguros = new Set(['&&', ';', '\n']);
  if (!seguros.has(cambio.separadorDespues)) return false;
  if (cambio.separadorAntes === '|' || cambio.separadorAntes === '||' || cambio.separadorAntes === '&') return false;
  if (cambio.separadorAntes === '&&') return false;
  return commit.separadorAntes !== '|' && commit.separadorAntes !== '||' && commit.separadorAntes !== '&';
}

function esRedireccion(palabra) {
  return /^(?:[0-9]*[<>]|[&]?>>?|<<?)/.test(palabra);
}

function destinoDeCambio(inv, raiz) {
  const palabras = inv.palabras;
  if (palabras.length !== 1 || esRedireccion(palabras[0]) || palabras[0] === '-' || /[$`]/.test(palabras[0])) return null;
  return resolverRuta(palabras[0], raiz);
}

function aplicaGlobales(inv, raiz, base) {
  let dir = raiz.dir;
  const env = Object.assign({}, raiz.env);
  for (const [opcion, valor] of inv.globales || []) {
    if (valor == null) return { dir: base, env: {} };
    if (opcion === '-C') {
      const destino = resolverRuta(valor, dir);
      if (!destino) return { dir: base, env: {} };
      dir = destino;
    }
    if (opcion === '--git-dir' || opcion === '--work-tree') {
      const clave = opcion === '--git-dir' ? 'GIT_DIR' : 'GIT_WORK_TREE';
      const destino = resolverRuta(valor, dir);
      if (!destino) return { dir: base, env: {} };
      env[clave] = destino;
    }
  }
  for (const flag of inv.flags || []) {
    const igual = /^(--git-dir|--work-tree)=(.+)$/.exec(flag);
    if (!igual) continue;
    const clave = igual[1] === '--git-dir' ? 'GIT_DIR' : 'GIT_WORK_TREE';
    const destino = resolverRuta(igual[2], dir);
    if (!destino) return { dir: base, env: {} };
    env[clave] = destino;
  }
  for (const [clave, valor] of inv.entorno || []) {
    if (clave !== 'GIT_DIR' && clave !== 'GIT_WORK_TREE') continue;
    const destino = resolverRuta(valor, dir);
    if (!destino) return { dir: base, env: {} };
    env[clave] = destino;
  }
  return { dir, env };
}

function contieneFormaConservadora(cmd) {
  return cmd.includes('<<') || tokenizar(cmd).some(token => token.valor === 'printf' || token.valor.includes('CDPATH'));
}

function raizDelCommit(cmd, data) {
  const base = baseDelPayload(data);
  if (contieneFormaConservadora(cmd)) return { dir: base, env: {} };
  const todas = invocaciones(cmd);
  const commit = todas.find(inv => inv.programa === 'git'
    && (inv.palabras[0] === 'commit' || inv.palabras[0] === 'merge'));
  if (!commit) return { dir: base, env: {} };
  let actual = { dir: base, env: {} };
  const pila = [];
  for (const inv of todas) {
    if (inv === commit) break;
    if (!['cd', 'pushd', 'popd'].includes(inv.programa)) continue;
    if (inv.script !== commit.script || !esPrefijo(inv.grupos, commit.grupos) || !separadoresSeguros(inv, commit)) continue;
    if (inv.programa === 'popd') { actual = pila.pop() || { dir: base, env: {} }; continue; }
    const destino = destinoDeCambio(inv, actual.dir);
    if (!destino) { actual = { dir: base, env: {} }; pila.length = 0; continue; }
    if (inv.programa === 'pushd') pila.push(actual);
    actual = { dir: destino, env: {} };
  }
  return aplicaGlobales(commit, actual, base);
}

const OPCIONES_DE_COMMIT_CON_VALOR = new Set([
  '--author', '--cleanup', '--date', '--file', '--fixup', '--message',
  '--pathspec-from-file', '--reedit-message', '--reuse-message', '--squash',
  '--template', '--trailer', '--gpg-sign',
]);
const CORTAS_DE_COMMIT_CON_VALOR = new Set(['C', 'c', 'F', 'm', 'S', 't']);

function palabrasQueConsumenLasOpciones(inv) {
  let consumidas = 0;
  for (const flag of inv.flags || []) {
    if (flag === '--') break;
    if (flag.startsWith('--')) {
      if (OPCIONES_DE_COMMIT_CON_VALOR.has(flag)) consumidas += 1;
      continue;
    }
    if (!/^-[A-Za-z]+$/.test(flag)) continue;
    for (let indice = 1; indice < flag.length; indice += 1) {
      if (!CORTAS_DE_COMMIT_CON_VALOR.has(flag[indice])) continue;
      if (indice === flag.length - 1) consumidas += 1;
      break;
    }
  }
  return consumidas;
}

function tomaArbol(inv) {
  const palabrasTrasCommit = inv.palabras.slice(1);
  return usaFlag(inv, { largo: '--all', corto: 'a' })
    || usaFlag(inv, { largo: '--include', corto: 'i' })
    || usaFlag(inv, { largo: '--only', corto: 'o' })
    || usaFlag(inv, { largo: '--pathspec-from-file' })
    || (inv.flags || []).includes('--')
    // Los valores de opciones como `-m texto` no son pathspecs. Cualquier
    // palabra restante sí lo es, o no se puede distinguir sin ejecutar Git;
    // ambos casos siguen la ruta conservadora.
    || palabrasTrasCommit.length > palabrasQueConsumenLasOpciones(inv);
}

function pathspecDesdeFicheroEsLegible(inv, raiz) {
  const flags = inv.flags || [];
  const indice = flags.findIndex(valor => valor === '--pathspec-from-file'
    || valor.startsWith('--pathspec-from-file='));
  if (indice === -1) return true;
  const flag = flags[indice];
  // `inv.palabras` conserva los valores de las opciones, pero no los flags. Cuenta los valores
  // consumidos por las opciones anteriores para asociar el fichero a su propio flag, incluso si
  // hay otras opciones con valor después (por ejemplo, `--pathspec-from-file paths -m mensaje`).
  const valoresAnteriores = flags.slice(0, indice).reduce((total, opcion) => {
    if (opcion.startsWith('--')) return total + (OPCIONES_DE_COMMIT_CON_VALOR.has(opcion) ? 1 : 0);
    if (!/^-[A-Za-z]+$/.test(opcion)) return total;
    for (let posicion = 1; posicion < opcion.length; posicion += 1) {
      if (!CORTAS_DE_COMMIT_CON_VALOR.has(opcion[posicion])) continue;
      return total + (posicion === opcion.length - 1 ? 1 : 0);
    }
    return total;
  }, 0);
  const nombre = flag.includes('=')
    ? flag.slice(flag.indexOf('=') + 1)
    : inv.palabras[valoresAnteriores + 1];
  if (!nombre || nombre === '-' || /[$`]/.test(nombre)) return false;
  const fichero = resolverRuta(nombre, raiz.dir);
  if (!fichero) return false;
  try { return fs.statSync(fichero).isFile(); } catch { return false; }
}

function ejecutarGit(args, raiz, env, ejecutar) {
  try {
    return ejecutar('git', args, { cwd: raiz.dir, env: Object.assign({}, env, raiz.env), encoding: 'utf8', timeout: 5000 });
  } catch { return null; }
}

function stagedDiff(raiz, env, ejecutar) {
  if (env.SDD_STAGED_DIFF != null) return env.SDD_STAGED_DIFF;
  const resultado = ejecutarGit(['-c', 'core.fsmonitor=false', 'diff', '--cached', '--no-ext-diff', '--no-textconv'], raiz, env, ejecutar);
  return resultado && !resultado.error && resultado.status === 0 ? resultado.stdout : null;
}

function arbolDifiereDelIndice(raiz, env, ejecutar) {
  const resultado = ejecutarGit(['-c', 'core.fsmonitor=false', 'diff', '--quiet', '--no-ext-diff', '--no-textconv'], raiz, env, ejecutar);
  return !(resultado && !resultado.error && resultado.status === 0);
}

function ttlMs(config) {
  const hours = Number(config.ttl_hours);
  return hours > 0 ? hours * 60 * 60 * 1000 : DEFAULT_TTL_MS;
}

function runHook(input, deps) {
  const options = deps || {};
  const env = options.env || process.env;
  const config = options.config || loadConfig(path.join(__dirname, 'config.json'));
  if (!hookEnabled('sdd_review_gate', config.sdd_review_gate)) return ALLOW;
  const call = readToolCall(input);
  if (!SHELL_TOOLS.has(call.name)) return ALLOW;
  const cmd = String(call.input.command || call.input.CommandLine || '').trim();
  const commits = invocacionesDeCommit(cmd);
  if (commits.length === 0) return ALLOW;
  if (commits.length !== 1) return denyResult(ARBOL_NO_REVISADO, call);
  if (skipRequested(env)) return warnResult(SKIP_AVISO, call);
  const sessionId = input.session_id || '';
  if (!sessionId) return ALLOW;
  const raiz = raizDelCommit(cmd, input);
  const ejecutar = options.spawnSync || spawnSync;
  if (commits.some(tomaArbol)
    && (!pathspecDesdeFicheroEsLegible(commits[0], raiz) || arbolDifiereDelIndice(raiz, env, ejecutar))) {
    return denyResult(ARBOL_NO_REVISADO, call);
  }
  const diff = stagedDiff(raiz, env, ejecutar);
  if (diff == null || diff.trim() === '') return warnResult(SIN_DIFF, call);
  const leerSenal = options.readSignal || readSignal;
  const signal = leerSenal(sessionId, ttlMs(config));
  if (!signal) return denyResult(SIN_SENAL, call);
  if (signal.diff_hash !== hashDiff(diff)) return denyResult(HASH_NO_ATA, call);
  return ALLOW;
}

async function main() {
  const data = await readPayload();
  emitResult(data ? runHook(data) : ALLOW);
}

if (require.main === module) runWithFailOpen('sdd-review-gate', main);

module.exports = { runHook, raizDelCommit, stagedDiff, arbolDifiereDelIndice, tomaArbol };

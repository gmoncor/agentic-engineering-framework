#!/usr/bin/env node
'use strict';

/**
 * SDD Review Gate — PreToolUse / BeforeTool hook sobre comandos de shell.
 *
 * BLOQUEA `git commit` o `git merge` cuando el diff que se va a commitear no
 * consta revisado por la revision adversarial por task.
 *
 * QUE DISPARA EL GATE
 * Lo dispara el subcomando REALMENTE invocado (`git commit` / `git merge`, opciones
 * globales incluidas: `git -c k=v commit` cuenta), no la aparicion de la frase en el
 * comando crudo: un `git log --grep="git commit"` de solo lectura no lo activa. El
 * criterio vive en sdd-git-command.js (compartido con los demas guards de git).
 *
 * POR QUE AHORA SI PUEDE BLOQUEAR
 * La revision ocurre por task, ANTES del commit, y su senal guarda el hash del
 * diff revisado. Aqui se recalcula el hash del diff cacheado (`git diff --cached`,
 * lo que se va a commitear) y se contrasta con la senal:
 *   - coincide            -> el diff que se commitea es el revisado: pasa.
 *   - no hay senal         -> no consta revision de este diff: se deniega.
 *   - el hash no coincide   -> el codigo cambio tras revisarse: se deniega.
 * La senal ya no es una marca de conveniencia: ata el hash a un diff concreto, asi
 * que el bloqueo es honesto, no aparente.
 *
 * Reparto de responsabilidades:
 *   - sdd-pipeline-guard.js bloquea ESCRITURAS no declaradas en el plan (PRE).
 *   - sdd-review-gate.js    bloquea COMMITS de un diff sin revision (POST).
 *
 * La revision PRE-implementacion (revision de tasks, auditoria de la spec) valida
 * el PLAN, no el CODIGO: su senal no ata el diff, asi que no cuenta aqui.
 *
 * Degradacion segura (avisa, no bloquea):
 *   - SDD_GUARD_SKIP=1: escape de emergencia, degrada el bloqueo a aviso.
 *   - sin `git diff --cached` computable (nada staged, git no disponible): avisa,
 *     no bloquea sin el diff que deberia contrastar.
 * Silencio total (exit 0, no interviene):
 *   - el hook no esta habilitado en hooks/config.json
 *   - el payload no trae session_id (no hay sesion que correlacionar)
 *   - el diff cacheado coincide con la senal (revision confirmada)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readPayload, readToolCall, warn, deny, skipRequested, loadConfig, hookEnabled, runWithFailOpen,
} = require('./sdd-hook-utils');
const { DEFAULT_TTL_MS, readSignal, hashDiff } = require('./sdd-review-signal');
const { invocacionesDe, tokenizar, segmentar } = require('./sdd-git-command');
const { toNativePath } = require('./sdd-plan-state');

const SHELL_TOOLS = new Set(['Bash', 'run_command', 'shell']);

// El gate se aplica si el comando invoca de verdad `git commit` o `git merge` (opciones
// globales incluidas), no si el texto contiene la frase. Criterio compartido: ver
// sdd-git-command.js.
function invocaGitCommitOMerge(cmd) {
  return invocacionesDe(cmd, 'git', ['commit']).length > 0
    || invocacionesDe(cmd, 'git', ['merge']).length > 0;
}

// Firmas estables (ver hooks/gate-signatures.json): el escaner de auditoria distingue el
// bloqueo real (sin senal, o hash que no ata) del aviso que nunca impide el commit.
const BLOCK_FIRMA = '[SDD_REVIEW_BLOCK] ';
const ADVISORY_FIRMA = '[SDD_REVIEW_ADVISORY] ';

const SIN_SENAL = BLOCK_FIRMA + 'SDD: este diff no consta revisado. La revision adversarial por '
  + 'task debe pasar ANTES del commit y emitir su senal. Usa /implementar-spec, que emite la senal '
  + 'de revision automaticamente. Los comandos /implementar y /revision manuales no emiten esta senal.';

const HASH_NO_ATA = BLOCK_FIRMA + 'SDD: la revision registrada no corresponde al diff que vas a '
  + 'commitear (el codigo cambio despues de revisarse). Usa /implementar-spec, que emite la senal '
  + 'de revision automaticamente sobre el diff actual antes de commitear.';

const SIN_DIFF = ADVISORY_FIRMA + 'SDD: no hay diff cacheado que contrastar (nada staged, o git no '
  + 'disponible). Este aviso no bloquea: sin el diff no se puede verificar la revision. Haz git add '
  + 'de lo que vas a commitear y asegurate de que paso la revision adversarial.';

const SKIP_AVISO = ADVISORY_FIRMA + 'SDD: SDD_GUARD_SKIP activo. El bloqueo de revision queda '
  + 'degradado a aviso; usalo solo para desbloquear una situacion puntual, no de forma permanente.';

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const call = readToolCall(data);
  if (!SHELL_TOOLS.has(call.name)) process.exit(0);

  const cmd = String(call.input.command || '').trim();
  if (!invocaGitCommitOMerge(cmd)) process.exit(0);

  const config = loadConfig(path.join(__dirname, 'config.json')).sdd_review_gate || {};
  if (!hookEnabled('sdd_review_gate', config)) process.exit(0);

  if (skipRequested()) { warn(SKIP_AVISO, call); return; }

  const sessionId = data.session_id || '';
  if (!sessionId) process.exit(0);

  const diff = stagedDiff(raizDelCommit(cmd, data));
  if (diff == null || diff.trim() === '') { warn(SIN_DIFF, call); return; }

  const signal = readSignal(sessionId, ttlMs(config));
  if (!signal) { deny(SIN_SENAL, call); return; }
  if (signal.diff_hash !== hashDiff(diff)) { deny(HASH_NO_ATA, call); return; }

  process.exit(0);
}

// Dónde lee git el repositorio del commit observado. Se parte del cwd del payload (el
// árbol de la sesión) o, sin él, del directorio del proceso, y se aplica lo que el comando
// antepone a `commit`/`merge` en posición de programa: los `-C <ruta>` (acumulados, cada
// uno relativo al anterior), `--git-dir`/`--work-tree` (con `=` o con espacio) y las
// asignaciones `GIT_DIR=`/`GIT_WORK_TREE=` al inicio del segmento. Si el commit va en un
// script anidado (`bash -lc "git -C x commit"`), se resuelve allí.
//
// Si un valor no se puede resolver sin ejecutar el shell (lleva `$` o comilla invertida)
// o apunta a un directorio que no existe, se conserva la raíz de partida sin ningún
// ajuste: el diff se contrasta como antes y, si no ata la señal, el gate deniega.
const SINTAXIS_DE_SHELL = new Set([
  '(', ')', '{', '}', '!', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'for', 'do', 'done',
]);
const ENVOLTORIOS = new Set(['env', 'command', 'nohup', 'stdbuf', 'nice', 'time', 'sudo', 'doas', 'timeout', 'xargs']);
const FLAGS_DE_ENVOLTORIO_CON_VALOR = new Set(['-s', '--signal', '-n', '--adjustment']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const GLOBALES_CON_VALOR = new Set(['-c', '--exec-path', '--namespace']);
const ASIGNACION_RE = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

function raizDelCommit(cmd, data) {
  const base = path.resolve(toNativePath(data && typeof data.cwd === 'string' ? data.cwd : '') || process.cwd());
  const raiz = buscarRaiz(tokenizar(cmd), base);
  return raiz || { dir: base, env: {} };
}

// Primera invocación de git commit/merge en posición de programa: devuelve su raíz, la
// de partida si algún valor no se resuelve, o null si no hay ninguna.
function buscarRaiz(tokens, base) {
  for (const seg of segmentar(tokens)) {
    const asignadas = {};
    let i = 0;
    while (i < seg.length && !seg[i].entrecomillado) {
      const v = seg[i].valor;
      const asignacion = ASIGNACION_RE.exec(v);
      if (asignacion) { asignadas[asignacion[1]] = asignacion[2]; i += 1; continue; }
      if (SINTAXIS_DE_SHELL.has(v)) { i += 1; continue; }
      if (ENVOLTORIOS.has(path.basename(v))) {
        const nombre = path.basename(v);
        i += 1;
        while (i < seg.length && !seg[i].entrecomillado && seg[i].valor.startsWith('-')) {
          i += FLAGS_DE_ENVOLTORIO_CON_VALOR.has(seg[i].valor) ? 2 : 1;
        }
        if (nombre === 'timeout' && i < seg.length) i += 1;
        continue;
      }
      break;
    }
    if (i >= seg.length) continue;
    const programa = path.basename(seg[i].valor);

    if (SHELLS.has(programa)) {
      const flag = seg.findIndex((t, k) => k > i && !t.entrecomillado && /^-[A-Za-z]*c$/.test(t.valor));
      if (flag !== -1 && flag + 1 < seg.length) {
        const anidada = buscarRaiz(tokenizar(seg[flag + 1].valor), base);
        if (anidada) return anidada;
      }
      continue;
    }
    if (programa !== 'git') continue;

    let dir = base;
    let gitDir = asignadas.GIT_DIR;
    let workTree = asignadas.GIT_WORK_TREE;
    let j = i + 1;
    while (j < seg.length && seg[j].valor.startsWith('-')) {
      const v = seg[j].valor;
      if (v === '-C' && j + 1 < seg.length) {
        const destino = resolverRuta(seg[j + 1].valor, dir);
        if (!destino) return { dir: base, env: {} };
        dir = destino;
        j += 2;
      } else if (v === '--git-dir' || v === '--work-tree') {
        if (j + 1 >= seg.length) break;
        if (v === '--git-dir') gitDir = seg[j + 1].valor; else workTree = seg[j + 1].valor;
        j += 2;
      } else if (v.startsWith('--git-dir=')) {
        gitDir = v.slice('--git-dir='.length); j += 1;
      } else if (v.startsWith('--work-tree=')) {
        workTree = v.slice('--work-tree='.length); j += 1;
      } else {
        j += GLOBALES_CON_VALOR.has(v) ? 2 : 1;
      }
    }
    if (j >= seg.length || (seg[j].valor !== 'commit' && seg[j].valor !== 'merge')) continue;

    const env = {};
    for (const [clave, valor] of [['GIT_DIR', gitDir], ['GIT_WORK_TREE', workTree]]) {
      if (valor == null) continue;
      const ruta = resolverRuta(valor, dir);
      if (!ruta) return { dir: base, env: {} };
      env[clave] = ruta;
    }
    return { dir, env };
  }
  return null;
}

// Ruta absoluta y existente para `valor` relativo a `desde`; null si depende del shell
// (variables o sustitución de órdenes) o no existe. Expande la `~` inicial.
function resolverRuta(valor, desde) {
  let ruta = toNativePath(valor);
  if (ruta === '' || /[$`]/.test(ruta)) return null;
  if (ruta === '~' || ruta.startsWith('~/')) ruta = path.join(os.homedir(), ruta.slice(1));
  else if (ruta.startsWith('~')) return null;
  const absoluta = path.resolve(desde, ruta);
  return fs.existsSync(absoluta) ? absoluta : null;
}

// El diff que se va a commitear, leído en la raíz de raizDelCommit. SDD_STAGED_DIFF
// permite inyectarlo en tests y entornos aislados, igual que SDD_CONFIG_PATH /
// SDD_SIGNAL_DIR. Sin fsmonitor, que ejecutaría el monitor configurado en el repositorio
// nombrado. Con los mismos argumentos de diff que el emisor de la señal (`git diff
// --cached`): si se aplica un diff.external, se aplica igual en los dos lados y el hash
// sigue atando. null si git no puede resolverlo.
function stagedDiff(raiz) {
  if (process.env.SDD_STAGED_DIFF != null) return process.env.SDD_STAGED_DIFF;
  try {
    const r = spawnSync('git', ['-c', 'core.fsmonitor=false', 'diff', '--cached'], {
      cwd: raiz.dir, env: Object.assign({}, process.env, raiz.env), encoding: 'utf8', timeout: 5000,
    });
    if (r.error || r.status !== 0) return null;
    return r.stdout;
  } catch {
    return null;
  }
}

function ttlMs(config) {
  const hours = Number(config.ttl_hours);
  return hours > 0 ? hours * 60 * 60 * 1000 : DEFAULT_TTL_MS;
}

// El fallo interno sale por runWithFailOpen (exit 0 + aviso firmado), nunca como veredicto.
if (require.main === module) {
  runWithFailOpen('sdd-review-gate', main);
}

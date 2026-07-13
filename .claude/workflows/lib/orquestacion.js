'use strict';

/**
 * Orquestacion de /implementar-spec: orden de ejecucion, seguridad del
 * paralelismo y arboles de trabajo.
 *
 * Vive fuera del workflow para poder probarse sin el runtime de workflows.
 *
 * Doctrina: lo que hace seguro el paralelismo es la PARTICION POR DUENO DE
 * ARCHIVO — dos tasks que corren a la vez nunca escriben el mismo archivo. El
 * worktree NO es el mecanismo primario: si los archivos ya son disjuntos no hay
 * nada que pisar y el worktree solo anade coste (crear, sincronizar, fusionar).
 * Un worktree aparte se justifica cuando la task tiene efectos secundarios en el
 * sistema de ficheros (migraciones, instalacion de dependencias, contenedores)
 * o cuando el usuario trabaja con varias sesiones a la vez.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseAffectedFiles } = require('../../../hooks/sdd-task-files');

// Archivos cuya escritura no se queda en el arbol de trabajo: instalan
// dependencias, alteran una base de datos o levantan contenedores. Son los que
// justifican un worktree aparte.
const PATRONES_SIDE_EFFECT_FS = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)poetry\.lock$/i,
  /(^|\/)Gemfile\.lock$/i,
  /(^|\/)go\.sum$/i,
  /(^|\/)requirements\.txt$/i,
  /(^|\/)migrations?\//i,
  /(^|\/)docker-compose[\w.-]*\.ya?ml$/i,
  /(^|\/)Dockerfile[\w.-]*$/i,
];

const DIR_WORKTREES = '.worktrees';
const PREFIJO_RAMA = 'sdd/';

// ── Archivos declarados por cada task ────────────────────────────────────────

function normalizarArchivo(archivo) {
  return String(archivo).replace(/`/g, '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function leerTexto(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Archivos que declara una task. Se leen del propio documento (fuente mecanica);
 * si el documento no esta disponible se usa lo que reporto el descubrimiento.
 * Retorna null cuando la task no declara ninguno: no se sabe que va a tocar, asi
 * que se trata como si pudiera tocar cualquier archivo.
 */
function archivosDeTask(task, raiz) {
  const desdeDoc = parseAffectedFiles(leerTexto(path.resolve(raiz || '.', task.path || '')));
  const archivos = desdeDoc.length > 0 ? desdeDoc : (task.archivos || []);
  const limpios = archivos.map(normalizarArchivo).filter(Boolean);
  return limpios.length > 0 ? limpios : null;
}

/** Mapa path-de-task -> archivos declarados (null = no declara). */
function mapearArchivos(tasks, raiz) {
  const mapa = new Map();
  for (const t of tasks) mapa.set(t.path, archivosDeTask(t, raiz));
  return mapa;
}

/** Archivos que dos tasks se disputan. Una task sin archivos declarados choca con todas. */
function archivosCompartidos(taskA, taskB, mapa) {
  const a = mapa.get(taskA.path);
  const b = mapa.get(taskB.path);
  if (!a || !b) return ['*'];
  return a.filter(f => b.includes(f));
}

// ── Oleadas y ciclos ─────────────────────────────────────────────────────────

/** Dependencias que apuntan a otra task de esta misma spec (las externas ya estan hechas). */
function depsInternas(task, conocidas) {
  return (task.dependencias || []).filter(d => conocidas.has(d));
}

/**
 * Agrupa las tasks en niveles topologicos: nivel 1 = sin dependencias, nivel N =
 * dependencias resueltas en niveles anteriores. Sirve para visualizar el plan; el
 * despacho real va task a task, en cuanto las dependencias de cada una terminan.
 *
 * Un ciclo es un error de planificacion: lanzarlo en paralelo seria ejecutar a la
 * vez justo lo que la dependencia pretendia ordenar.
 */
function computeWaves(tasks) {
  const conocidas = new Set(tasks.map(t => t.path));
  const completadas = new Set();
  const waves = [];
  let restantes = tasks.slice();

  while (restantes.length > 0) {
    const wave = restantes.filter(t => depsInternas(t, conocidas).every(d => completadas.has(d)));

    if (wave.length === 0) {
      const enCiclo = restantes.map(t => t.path).join(', ');
      throw new Error('CICLO_DETECTADO: dependencias circulares entre tasks: ' + enCiclo
        + '. Corregir las dependencias antes de implementar.');
    }

    for (const t of wave) completadas.add(t.path);
    waves.push(wave);
    restantes = restantes.filter(t => !completadas.has(t.path));
  }
  return waves;
}

// ── Particion por dueno de archivo ───────────────────────────────────────────

/**
 * Verifica que las tasks de una oleada escriben archivos disjuntos. Las que se
 * solapan se reparten en grupos: cada grupo es internamente disjunto (corre en
 * paralelo) y los grupos se ejecutan uno tras otro. Una task que no declara
 * archivos va sola en su grupo.
 */
function verifyFilePartition(wave, mapa) {
  const grupos = [];
  const conflictos = [];

  for (const task of wave) {
    let destino = null;

    for (const grupo of grupos) {
      const choque = grupo.map(otra => ({ otra, compartidos: archivosCompartidos(task, otra, mapa) }))
        .find(c => c.compartidos.length > 0);

      if (!choque) { destino = grupo; break; }
      conflictos.push({ archivos: choque.compartidos, tasks: [choque.otra.path, task.path] });
    }

    if (destino) destino.push(task);
    else grupos.push([task]);
  }
  return { grupos, conflictos };
}

/** Descripcion en texto de lo que verifico la particion (para el log del workflow). */
function describirParticion(wave, mapa) {
  const { grupos, conflictos } = verifyFilePartition(wave, mapa);
  if (conflictos.length === 0) {
    return wave.length + ' task(s) verificadas disjuntas — se implementan en paralelo';
  }
  const detalle = conflictos.map(c =>
    'CONFLICTO en ' + c.archivos.join(', ') + ' entre ' + c.tasks.join(' y ')).join('; ');
  return detalle + ' — se serializan (' + grupos.length + ' grupo(s))';
}

// ── Contratos entre tasks ────────────────────────────────────────────────────

/**
 * Un contrato es algo que una task produce (API, tipo, export) y otra consume.
 * El consumidor debe depender del productor: si no, puede arrancar antes de que
 * lo que consume exista.
 */
function verificarContratos(tasks) {
  const productores = new Map();
  for (const t of tasks) {
    for (const c of (t.contratos || [])) {
      if (c.tipo === 'produce') productores.set(c.nombre, t.path);
    }
  }

  const problemas = [];
  const conocidas = new Set(tasks.map(t => t.path));

  for (const t of tasks) {
    for (const c of (t.contratos || [])) {
      if (c.tipo !== 'consume') continue;
      const productor = productores.get(c.nombre);
      if (!productor) {
        problemas.push(t.path + ' consume el contrato "' + c.nombre + '" que ninguna task produce');
      } else if (productor !== t.path && !depsInternas(t, conocidas).includes(productor)) {
        problemas.push(t.path + ' consume "' + c.nombre + '" pero no depende de su productor ' + productor);
      }
    }
  }
  return problemas;
}

// ── Worktrees (condicionales) ────────────────────────────────────────────────

function ejecutarGit(args, opts) {
  const r = spawnSync('git', args, Object.assign({ encoding: 'utf8', timeout: 60000 }, opts || {}));
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** true si la task altera el entorno mas alla de su propio codigo. */
function usaWorktree(task, mapa) {
  if (typeof task.side_effects_fs === 'boolean') return task.side_effects_fs;
  const archivos = mapa.get(task.path);
  if (!archivos) return false;
  return archivos.some(a => PATRONES_SIDE_EFFECT_FS.some(re => re.test(a)));
}

/** Pre-condicion dura: sin HEAD resuelto no se puede crear un arbol de trabajo. */
function headResuelve(git) {
  const r = (git || ejecutarGit)(['rev-parse', 'HEAD']);
  return r.status === 0 && /^[0-9a-f]{7,}$/i.test(r.stdout.trim());
}

function nombreWorktree(task) {
  const base = path.basename(String(task.path || 'task'), '.md');
  return base.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'task';
}

/**
 * Crea el arbol de trabajo de una task con efectos secundarios. Retorna
 * { dir, rama }. Lanza error si HEAD no resuelve (un repo sin commits no puede
 * servir de base) o si git falla.
 */
function crearWorktree(task, git) {
  const g = git || ejecutarGit;
  if (!headResuelve(g)) {
    throw new Error('PRE_CONDICION_WORKTREE: HEAD debe resolver antes de crear un arbol de trabajo. '
      + 'Crea el primer commit del repo ANTES de implementar tasks con efectos secundarios.');
  }

  const nombre = nombreWorktree(task);
  const dir = path.join(DIR_WORKTREES, nombre);
  const rama = PREFIJO_RAMA + nombre;

  // Restos de una ejecucion abortada: el registro de worktrees se limpia antes
  // de crear el nuevo, si no `git worktree add` falla por directorio ya existente.
  g(['worktree', 'prune']);
  g(['worktree', 'remove', '--force', dir]);
  g(['branch', '-D', rama]);

  const r = g(['worktree', 'add', '-b', rama, dir, 'HEAD']);
  if (r.status !== 0) {
    throw new Error('WORKTREE_FALLIDO: no se pudo crear ' + dir + ': ' + r.stderr.trim());
  }
  return { dir, rama };
}

/**
 * Integra en el checkout compartido el trabajo hecho en un worktree. Si el merge
 * entra en conflicto se aborta y se devuelve el control al usuario: fusionar a
 * ciegas dejaria el arbol a medias.
 */
function fusionarWorktree(worktree, git) {
  const g = git || ejecutarGit;
  const r = g(['merge', '--no-ff', '--no-edit', worktree.rama]);
  if (r.status === 0) return;

  g(['merge', '--abort']);
  throw new Error('MERGE_CONFLICTO: el trabajo de la rama ' + worktree.rama + ' entra en conflicto con el checkout. '
    + 'El merge se ha abortado. Resuelvelo a mano (git merge ' + worktree.rama + ') y vuelve a lanzar el workflow.');
}

/** Elimina el arbol de trabajo. La rama se conserva si el merge no llego a ocurrir. */
function eliminarWorktree(worktree, git, fusionado) {
  const g = git || ejecutarGit;
  g(['worktree', 'remove', '--force', worktree.dir]);
  if (fusionado) g(['branch', '-d', worktree.rama]);
  g(['worktree', 'prune']);
}

// ── Despacho por dependencias satisfechas ────────────────────────────────────

function okPorDefecto(resultado) {
  return !!resultado && resultado.resultado !== 'FALLIDA';
}

/**
 * Lanza cada task en cuanto SUS dependencias estan satisfechas — sin quedarse a
 * la cola del resto de su nivel — y nunca a la vez que otra task que escribe
 * alguno de sus archivos.
 *
 * ejecutar(task) -> Promise<resultado>. Opciones:
 *   esOk(resultado)          cuando una dependencia cuenta como satisfecha
 *   alBloquear(task, deps)   resultado de una task cuya dependencia fallo
 *   alIniciar(task)          notificacion de arranque (log)
 *   maxConcurrencia          tope de tasks a la vez (0 = sin tope)
 *
 * Retorna los resultados en el orden original de las tasks.
 */
async function despacharPorDependencias(tasks, ejecutar, opciones) {
  const o = opciones || {};
  const esOk = o.esOk || okPorDefecto;
  const alBloquear = o.alBloquear || (() => null);
  const alIniciar = o.alIniciar || (() => {});
  const mapa = o.archivos || new Map();
  const tope = o.maxConcurrencia > 0 ? o.maxConcurrencia : tasks.length;

  const conocidas = new Set(tasks.map(t => t.path));
  const resultados = new Map();
  const enVuelo = new Map();
  let pendientes = tasks.slice();

  const depsFallidas = t => depsInternas(t, conocidas)
    .filter(d => resultados.has(d) && !esOk(resultados.get(d)));
  const depsListas = t => depsInternas(t, conocidas).every(d => resultados.has(d));
  const chocaConEnVuelo = t => [...enVuelo.values()]
    .some(v => archivosCompartidos(t, v.task, mapa).length > 0);

  while (pendientes.length > 0 || enVuelo.size > 0) {
    const resueltas = [];

    for (const task of pendientes) {
      if (enVuelo.size >= tope) break;
      if (!depsListas(task)) continue;

      const rotas = depsFallidas(task);
      if (rotas.length > 0) {
        resultados.set(task.path, alBloquear(task, rotas));
        resueltas.push(task);
        continue;
      }
      if (chocaConEnVuelo(task)) continue;

      alIniciar(task);
      const promesa = Promise.resolve()
        .then(() => ejecutar(task))
        .then(r => ({ task, r }), () => ({ task, r: null }));
      enVuelo.set(task.path, { task, promesa });
      resueltas.push(task);
    }

    pendientes = pendientes.filter(t => !resueltas.includes(t));

    if (enVuelo.size === 0) {
      if (resueltas.length === 0) break; // nada en vuelo y nada lanzable: no hay mas progreso posible
      continue;
    }

    const terminada = await Promise.race([...enVuelo.values()].map(v => v.promesa));
    enVuelo.delete(terminada.task.path);
    resultados.set(terminada.task.path, terminada.r);
  }

  return tasks.map(t => (resultados.has(t.path) ? resultados.get(t.path) : null));
}

module.exports = {
  DIR_WORKTREES,
  PATRONES_SIDE_EFFECT_FS,
  archivosDeTask,
  mapearArchivos,
  archivosCompartidos,
  computeWaves,
  verifyFilePartition,
  describirParticion,
  verificarContratos,
  usaWorktree,
  headResuelve,
  crearWorktree,
  fusionarWorktree,
  eliminarWorktree,
  despacharPorDependencias,
  ejecutarGit,
};

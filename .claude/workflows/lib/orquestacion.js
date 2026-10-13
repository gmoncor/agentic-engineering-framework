'use strict';

/**
 * Orquestacion de /implementar-spec: orden de ejecucion y validacion de
 * dependencias entre tasks.
 *
 * Vive fuera del workflow para poder probarse sin el runtime de workflows.
 */

const fs = require('fs');
const path = require('path');

// ── Separadores de ruta en contenido externo ─────────────────────────────────

// Comienzo de una ruta absoluta de Windows: unidad (C:\ o C:/) o recurso de red (\\servidor).
const PREFIJO_WINDOWS_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Traduce a los separadores del sistema en curso una ruta de procedencia externa: aqui, el path
 * de una dependencia declarada en el documento de una task.
 *
 * SIEMPRE ANTES de resolver, comparar o partir la ruta. La barra invertida es separador en Windows
 * y un caracter valido de nombre de archivo en los sistemas tipo Unix: sin traducirla,
 * "ai_docs\tasks\001_a.md" no es una ruta de tres tramos sino UN nombre de archivo. De ahi salian
 * las dos averias de este modulo: el archivo no existe con ese nombre, asi que la dependencia se
 * denunciaba como inexistente (un bloqueo falso y visible), y la misma cadena tampoco casaba con
 * ninguna task conocida, asi que el orden topologico la perdia.
 *
 * Solo actua en el cruce entre sistemas, nunca sobre una ruta nativa:
 *   - En Windows la ruta se devuelve intacta: alli las dos barras ya son separadores.
 *   - En un sistema tipo Unix se traduce solo si lleva barra invertida y ademas no lleva ninguna
 *     barra normal, o si abre con un prefijo de unidad de Windows.
 *
 * El criterio es el mismo que aplica el guard de escrituras (hooks/sdd-plan-state.js
 * `toNativePath`), y un canary de la suite exige que ambas copias coincidan sobre la misma bateria
 * de formas. Se replica en vez de importarse porque este modulo pertenece a la orquestacion y los
 * hooks son la capa de enforcement: importar hacia abajo ataria el motor de workflows al detalle
 * interno de un guard, cuya presencia el proyecto puede recortar.
 *
 * `api` (path.win32 / path.posix) solo existe para ejercitar las dos plataformas desde una sola.
 */
function rutaNativa(cruda, api) {
  const ruta = String(cruda == null ? '' : cruda);
  const impl = api || path;
  if (impl.sep === '\\' || !ruta.includes('\\')) return ruta;
  if (ruta.includes('/') && !PREFIJO_WINDOWS_RE.test(ruta)) return ruta;
  return ruta.replace(/\\/g, '/');
}

// ── Niveles topologicos y ciclos ─────────────────────────────────────────────

/**
 * Dependencias que apuntan a otra task de esta misma spec. Las que no apuntan a
 * ninguna task conocida se ignoran porque ya estan hechas — pero eso solo vale si
 * el documento al que apuntan EXISTE. Verificarlo es cosa de validarDependencias:
 * sin esa comprobacion previa, una dependencia mal escrita se cuela aqui como
 * "externa" y la task arranca como si no dependiera de nada.
 *
 * La comparacion se hace sobre la ruta ya traducida, en los dos lados: una dependencia escrita con
 * separadores de Windows denota la misma task que la nativa, y compararlas crudas la dejaria
 * fuera del grafo. Devuelve las rutas traducidas porque quien las recibe las contrasta contra el
 * mismo conjunto de claves.
 */
function depsInternas(task, conocidas) {
  return (task.dependencias || []).map(d => rutaNativa(d)).filter(d => conocidas.has(d));
}

/** Clave con la que una task se identifica dentro del grafo: su path, ya traducido. */
function clave(task) {
  return rutaNativa(task.path);
}

/**
 * Una dependencia que no es de esta spec y que tampoco existe en disco es un error
 * del plan, no una dependencia externa ya satisfecha. Casi siempre es un path mal
 * escrito: descartarla en silencio lanzaria la task sin su pre-requisito.
 */
function validarDependencias(tasks, raiz) {
  const conocidas = new Set(tasks.map(clave));
  const base = rutaNativa(raiz || '.');
  const rotas = [];

  for (const t of tasks) {
    for (const d of (t.dependencias || [])) {
      const dep = rutaNativa(d);
      if (conocidas.has(dep)) continue;
      // El path se traduce ANTES de resolverlo: sin eso, una dependencia escrita con separadores
      // de Windows se busca en disco como un unico nombre de archivo, no existe con ese nombre, y
      // el plan queda denunciado por una averia que no tiene. La ruta cruda se conserva en el
      // mensaje: es lo que el autor escribio y lo que tiene que corregir.
      if (!fs.existsSync(path.resolve(base, dep))) rotas.push(t.path + ' -> ' + d);
    }
  }

  if (rotas.length > 0) {
    throw new Error('DEPENDENCIA_INEXISTENTE: hay dependencias que no son de esta spec y cuyo '
      + 'documento de task no existe: ' + rotas.join('; ') + '. Corrige el path (o elimina la '
      + 'dependencia) antes de implementar: una dependencia mal escrita dejaria la task sin su '
      + 'pre-requisito.');
  }
}

/**
 * Agrupa las tasks en niveles topologicos: nivel 1 = sin dependencias, nivel N =
 * dependencias resueltas en niveles anteriores. Los niveles son un plan de
 * ejecucion. Las tasks de un mismo nivel son independientes entre si. Por
 * defecto se ejecutan secuencialmente; el invocador puede pedir ejecucion
 * concurrente dentro de un nivel.
 *
 * Un ciclo es un error de planificacion: lanzarlo en paralelo seria ejecutar a la
 * vez justo lo que la dependencia pretendia ordenar.
 */
function computeNiveles(tasks, raiz) {
  validarDependencias(tasks, raiz);

  const conocidas = new Set(tasks.map(clave));
  const completadas = new Set();
  const niveles = [];
  let restantes = tasks.slice();

  while (restantes.length > 0) {
    const nivel = restantes.filter(t => depsInternas(t, conocidas).every(d => completadas.has(d)));

    if (nivel.length === 0) {
      const enCiclo = restantes.map(t => t.path).join(', ');
      throw new Error('CICLO_DETECTADO: dependencias circulares entre tasks: ' + enCiclo
        + '. Corregir las dependencias antes de implementar.');
    }

    for (const t of nivel) completadas.add(clave(t));
    niveles.push(nivel);
    restantes = restantes.filter(t => !completadas.has(clave(t)));
  }
  return niveles;
}

// ── Contratos entre tasks ────────────────────────────────────────────────────

/**
 * Un contrato es algo que una task produce (API, tipo, export) y otra consume.
 * El consumidor debe depender del productor: si no, puede arrancar antes de que
 * lo que consume exista.
 *
 * Los productores se agrupan por nombre ANTES de resolver consumidores: un mapa
 * de ultima-escritura-gana perderia a todos los productores salvo el ultimo, y
 * un consumidor que si depende del suyo se denunciaria contra el que sobrevivio
 * por azar de orden. Un contrato con mas de un productor es un error de plan en
 * si mismo (que copia gana en tiempo de ejecucion), asi que se nombra aparte y
 * no se acusa a ningun consumidor mientras la duplicidad no se resuelva.
 */
function verificarContratos(tasks) {
  const productoresPorNombre = new Map();
  for (const t of tasks) {
    for (const c of (t.contratos || [])) {
      // Se indexa por la clave traducida: es la que despues se contrasta con las dependencias.
      if (c.tipo !== 'produce') continue;
      if (!productoresPorNombre.has(c.nombre)) productoresPorNombre.set(c.nombre, []);
      productoresPorNombre.get(c.nombre).push(clave(t));
    }
  }

  const problemas = [];
  const conocidas = new Set(tasks.map(clave));

  for (const [nombre, productores] of productoresPorNombre) {
    if (productores.length > 1) {
      problemas.push('el contrato "' + nombre + '" tiene mas de un productor: ' + productores.join(', '));
    }
  }

  for (const t of tasks) {
    for (const c of (t.contratos || [])) {
      if (c.tipo !== 'consume') continue;
      const productores = productoresPorNombre.get(c.nombre) || [];
      if (productores.length === 0) {
        problemas.push(t.path + ' consume el contrato "' + c.nombre + '" que ninguna task produce');
        continue;
      }
      // Con mas de un productor el problema real ya quedo nombrado arriba: acusar
      // ademas a un consumidor cuya dependencia SI apunta a uno de ellos seria un
      // segundo falso positivo sobre la misma causa.
      if (productores.length > 1) continue;
      const productor = productores[0];
      if (productor !== clave(t) && !depsInternas(t, conocidas).includes(productor)) {
        problemas.push(t.path + ' consume "' + c.nombre + '" pero no depende de su productor ' + productor);
      }
    }
  }
  return problemas;
}

// ── Gate de tests: ejecutar el comando real, no creer al implementador ────────

/**
 * Descubre el comando de test del proyecto. El gate lo EJECUTA y lee su exit
 * code: nunca cree numeros de tests que el propio implementador reporte (quien
 * escribe el codigo no puede certificar sus tests sin circularidad) ni lee el
 * texto que la suite imprime (un arnes puede imprimir "OK" y terminar en rojo).
 *
 * Prioridad: comando configurado explicitamente > npm > pytest. La ausencia de
 * comando NO es un fallo aqui; es el llamador quien decide si degrada o bloquea
 * (evaluarGateTests), segun la task toque codigo o solo docs.
 */
function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

function comandoConfigurado(base) {
  const cfg = leerJson(path.resolve(base, 'hooks', 'config.json'));
  const cmd = cfg && cfg.sdd_test_gate && cfg.sdd_test_gate.command;
  if (typeof cmd !== 'string' || !cmd.trim()) return null;
  const partes = cmd.trim().split(/\s+/);
  return { cmd: partes[0], args: partes.slice(1), fuente: 'hooks/config.json' };
}

function comandoNpm(base) {
  const pkg = leerJson(path.resolve(base, 'package.json'));
  const script = pkg && pkg.scripts && pkg.scripts.test;
  // El placeholder por defecto de npm ("no test specified" + exit 1) no es un
  // comando real: bloquearia toda task por un rojo falso.
  if (typeof script !== 'string' || /no test specified/i.test(script)) return null;
  return { cmd: 'npm', args: ['test'], fuente: 'package.json' };
}

function comandoPytest(base) {
  if (fs.existsSync(path.resolve(base, 'pytest.ini'))) {
    return { cmd: 'pytest', args: [], fuente: 'pytest.ini' };
  }
  // setup.cfg solo configura pytest si declara la seccion [tool:pytest]; su mera
  // existencia no implica un runner.
  const cfg = path.resolve(base, 'setup.cfg');
  if (fs.existsSync(cfg)) {
    let txt = '';
    try { txt = fs.readFileSync(cfg, 'utf8'); } catch { txt = ''; }
    if (/\[tool:pytest\]/.test(txt)) return { cmd: 'pytest', args: [], fuente: 'setup.cfg' };
  }
  return null;
}

function descubrirComandoTest(raiz) {
  const base = raiz || '.';
  return comandoConfigurado(base) || comandoNpm(base) || comandoPytest(base) || null;
}

// Extensiones que NO son codigo ejecutable: docs, config y plantillas. Una task
// que solo las toca esta exenta del gate cuando no hay comando de test.
const EXT_NO_EJECUTABLE = new Set([
  '.md', '.markdown', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.lock', '.env', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.svg',
]);

/**
 * True si algun archivo tocado es codigo ejecutable (no docs/config). Un archivo
 * sin extension se trata como no-ejecutable: ante la duda, no bloquear sin
 * evidencia de que hay codigo que probar.
 */
function tocaCodigoEjecutable(archivos) {
  return (archivos || []).some((a) => {
    const ext = path.extname(String(a)).toLowerCase();
    return ext !== '' && !EXT_NO_EJECUTABLE.has(ext);
  });
}

/**
 * Traduce el exit code del comando a veredicto. Verde es EXACTAMENTE exit 0: no
 * hay otra evidencia admisible.
 *
 * Un proceso que agota su tiempo limite, que muere por una senal o que no llega
 * a arrancar no devuelve codigo (null): eso es rojo, nunca un pase. Se separa
 * del rojo normal solo en el mensaje, porque la causa se investiga distinto —
 * el estado es el mismo y bloquea igual.
 */
function veredictoPorExitCode(exitCode, fuente) {
  if (exitCode === 0) return { estado: 'PASA', nota: 'Tests verdes (exit 0) via ' + fuente };
  if (!Number.isInteger(exitCode)) {
    return {
      estado: 'FALLIDA',
      nota: 'Tests en rojo (sin codigo de salida: timeout, senal o comando no ejecutable) via ' + fuente,
    };
  }
  return { estado: 'FALLIDA', nota: 'Tests en rojo (exit ' + exitCode + ') via ' + fuente };
}

/**
 * Decide el veredicto del gate a partir del comando descubierto, su exit code y
 * los archivos que la task modifico. Funcion pura: el spawn del comando ocurre en
 * el workflow, que pasa aqui el codigo tal cual lo devolvio el proceso.
 * Estados: PASA | FALLIDA | ADVISORY; solo PASA desbloquea.
 */
function evaluarGateTests(entrada) {
  const { comando, exitCode, archivos } = entrada || {};

  if (comando) return veredictoPorExitCode(exitCode, comando.fuente);

  // Sin comando: bloquea solo si la task toca codigo (no hay como probarlo);
  // docs/config quedan exentas y continuan con aviso, no se bloquea sin evidencia.
  if (tocaCodigoEjecutable(archivos)) {
    return { estado: 'FALLIDA', nota: 'No se encontro comando de test para validar cambios de codigo ejecutable' };
  }
  return { estado: 'ADVISORY', nota: 'No se encontro comando de test; la task solo toca docs/config (exenta)' };
}

// ── Salida de git: dato utilizable o fallo de infraestructura ────────────────

/**
 * Traduce el resultado de un comando de git a "salida utilizable" o "fallo", por su CODIGO DE
 * SALIDA. Funcion pura: el spawn ocurre en el workflow, que pasa aqui lo que devolvio el proceso.
 *
 * EL DEFECTO QUE CIERRA
 * Leer solo la salida estandar confunde dos situaciones que no son la misma: no hay nada
 * preparado (exit 0, diff vacio de verdad) y git no pudo ejecutarse (indice bloqueado, tiempo
 * agotado, binario ausente). Ambas daban cadena vacia, asi que un fallo de infraestructura pasaba
 * por veredicto: se registraba el hash de esa cadena vacia como constancia de revision y el gate
 * denegaba el commit despues, sin que nada explicase por que.
 *
 * Verde es EXACTAMENTE exit 0, igual que en el gate de tests. Un proceso sin codigo (null) agoto
 * su tiempo, murio por una senal o no llego a arrancar: eso es fallo, nunca un vacio legitimo.
 */
function interpretarSalidaGit(argv, resultado) {
  const cmd = 'git ' + (argv || []).join(' ');
  const code = resultado ? resultado.code : null;

  if (code === 0) return { ok: true, out: (resultado && resultado.out) || '' };

  const causa = Number.isInteger(code)
    ? 'exit ' + code
    : 'sin codigo de salida (tiempo agotado, senal o git no ejecutable)';
  const detalle = String((resultado && resultado.err) || '').trim().slice(-300);

  return {
    ok: false,
    out: '',
    error: cmd + ' fallo: ' + causa + (detalle ? ' — ' + detalle : ''),
  };
}

// ── Argumentos del comando ───────────────────────────────────────────────────

// `--parallel` pide ejecutar A LA VEZ las tasks de un mismo nivel de
// dependencias. El defecto es una task tras otra: el flag es opt-in y no altera
// el comportamiento de quien no lo escribe.
const FLAG_PARALELO = /(^|\s)--parallel(\s|$)/;

const USO = 'Se requiere el path de la spec como argumento '
  + '(ej: ai_docs/tasks/spec_autenticacion.md, opcionalmente con --parallel)';

/**
 * Separa el modo de ejecucion de la ruta de la spec: los dos llegan en el mismo
 * argumento. Devuelve `{ modoParalelo, specPath, error }`.
 *
 * El flag se RETIRA del texto antes de quedarse con la ruta. Pegado a ella, la
 * ruta no existiria en disco y la spec se denunciaria como spec sin tasks. El
 * flag puede ir antes o despues de la ruta.
 */
function parsearArgs(crudos) {
  const texto = (typeof crudos === 'string' ? crudos : '').trim();
  const modoParalelo = FLAG_PARALELO.test(texto);
  const specPath = texto.replace(FLAG_PARALELO, ' ').trim();
  const error = (!specPath || specPath.length < 5) ? USO : null;
  return { modoParalelo, specPath, error };
}

// ── Git: lectura verificada por codigo de salida ─────────────────────────────

/** Registro de eventos del flujo. Opcional en toda funcion que lo acepta. */
function registrar(deps) {
  return (deps && deps.log) || function () {};
}

/**
 * Ejecuta un comando de git y devuelve `{ ok, out, error }`: exige que HAYA
 * CORRIDO, por su codigo de salida (interpretarSalidaGit, arriba).
 *
 * `spawn` se inyecta. El proceso hijo pertenece al workflow, pero el criterio que
 * decide si su salida sostiene un veredicto vive aqui, donde un doble devuelve el
 * codigo que se quiera y el test observa la consecuencia. Mientras el criterio
 * vivia en el workflow, la unica cobertura posible era buscar su texto en el
 * fuente, y esa busqueda sobrevive a una version que ignore el codigo de salida.
 */
async function gitVerificado(argv, spawn) {
  return interpretarSalidaGit(argv, await spawn(argv));
}

/**
 * Un comando de git que no llego a correr no es un veredicto sobre la task: no se
 * commitea, pero tampoco se descarta el trabajo — nada acredita que este mal, y
 * descartarlo lo perderia. El motivo va en las notas para que el fallo se lea
 * como lo que es y no como una revision adversa.
 */
function falloDeGit(resultado, mensaje, log) {
  (log || function () {})('Task ' + resultado.task_titulo
    + ': FALLIDA (git no pudo ejecutarse) — ' + mensaje
    + '. No se commitea; el working tree se conserva intacto.');
  resultado.resultado = 'FALLIDA';
  resultado.notas = (resultado.notas ? resultado.notas + ' ' : '')
    + '(fallo de git, no veredicto de revision: ' + mensaje + ')';
  return resultado;
}

// ── Árbol limpio y apartado recuperable ──────────────────────────────────────

/**
 * Directorio de los documentos de plan. Queda fuera de la comprobación de árbol
 * limpio y del apartado: specs y tasks pueden estar a medio editar sin ser
 * trabajo de ninguna task, y el guard de escrituras también los exime.
 */
const DIR_PLAN = 'ai_docs';
const PATHSPEC_SIN_PLAN = ['.', ':(exclude)' + DIR_PLAN];

/** `git status` que lista, fichero a fichero, lo que no está commiteado fuera de ai_docs/. */
const ARGV_ESTADO = ['status', '--porcelain', '--untracked-files=all', '--'].concat(PATHSPEC_SIN_PLAN);

/** Ruta de una línea de `git status --porcelain`: el destino si es un renombrado, sin comillas. */
function rutaDePorcelain(linea) {
  let ruta = linea.slice(3);
  const flecha = ruta.indexOf(' -> ');
  if (flecha !== -1) ruta = ruta.slice(flecha + 4);
  if (ruta.length >= 2 && ruta.startsWith('"') && ruta.endsWith('"')) {
    ruta = ruta.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return ruta;
}

function esDelPlan(ruta) {
  return ruta === DIR_PLAN || ruta.startsWith(DIR_PLAN + '/');
}

/**
 * Lee la salida de `git status --porcelain` y dice si el árbol está limpio
 * fuera de ai_docs/. Devuelve `{ limpio, rutas }`.
 *
 * El pathspec ya excluye ai_docs/; el filtro se repite aquí para que la
 * decisión no dependa de que el git instalado entienda la exclusión.
 */
function evaluarArbolLimpio(salida) {
  const rutas = String(salida == null ? '' : salida)
    .split(/\r?\n/)
    .filter(function (l) { return l.trim().length > 3; })
    .map(rutaDePorcelain)
    .filter(function (r) { return r && !esDelPlan(r); });
  return { limpio: rutas.length === 0, rutas };
}

/**
 * Ejecuta `git status` y evalúa el resultado. Un git que no corrió no acredita
 * un árbol limpio: se devuelve `limpio: false` con el error, para que quien
 * llama se detenga en vez de seguir sobre un estado desconocido.
 */
async function comprobarArbolLimpio(spawn) {
  const estado = await gitVerificado(ARGV_ESTADO, spawn);
  if (!estado.ok) return { limpio: false, rutas: [], error: estado.error };
  return evaluarArbolLimpio(estado.out);
}

/** Las primeras rutas de una lista, para un mensaje legible. */
function resumenRutas(rutas) {
  const max = 10;
  const lista = (rutas || []).slice(0, max).join(', ');
  return rutas && rutas.length > max ? lista + ' y ' + (rutas.length - max) + ' más' : lista;
}

/**
 * Motivo por el que el workflow no arranca la implementación con el árbol sucio,
 * con las tres salidas que tiene quien lo lanzó.
 */
function mensajeArbolSucio(estado) {
  const causa = estado.error
    ? 'no se pudo comprobar que el árbol esté limpio (' + estado.error + ')'
    : 'hay cambios sin commitear fuera de ' + DIR_PLAN + '/: ' + resumenRutas(estado.rutas);
  return 'No se implementa: ' + causa + '. El commit de la primera task los absorbería, y el '
    + 'apartado de una task fallida se los llevaría con su trabajo. Antes de relanzar: '
    + 'commitéalos, apártalos con `git stash push --include-untracked`, o lanza la spec en '
    + 'un worktree de git limpio.';
}

/**
 * Argumentos del `git stash` que aparta el trabajo de una task que no se
 * commitea. Devuelve `null` cuando no hay nada que se pueda atribuir a la task.
 *
 * - Secuencial: todo el árbol salvo ai_docs/. El árbol estaba limpio al empezar
 *   la task, así que lo que queda es suyo, también lo que escribió fuera de su
 *   tabla; acotarlo al ámbito dejaría ese resto para el commit de la siguiente.
 * - Concurrente: solo `ambito`, las rutas de la task con cambios. El árbol es
 *   compartido con las hermanas en curso; sin ámbito no hay nada atribuible.
 */
function argvApartado(task, ambito, modoParalelo) {
  const base = ['stash', 'push', '--include-untracked', '-m', 'sdd-apartado: ' + task.titulo, '--'];
  if (!modoParalelo) return base.concat(PATHSPEC_SIN_PLAN);
  if (!Array.isArray(ambito) || ambito.length === 0) return null;
  return base.concat(ambito.map(function (r) { return rutaNativa(r); }));
}

/**
 * Rutas con cambios (`git status --porcelain -z`) que caen dentro del ámbito.
 * El `stash` con una ruta que no casa con ningún fichero falla A MEDIAS: guarda
 * la entrada y deja el árbol sin limpiar. Por eso el pathspec del apartado
 * concurrente es solo lo que de verdad cambió, no la tabla entera.
 *
 * Devuelve `{ rutas, borradasEnIndice }`. Las segundas son las rutas cuyo
 * borrado ya está preparado en el índice (X = 'D', o el origen de un
 * renombrado): no existen ni en el árbol ni en el índice, así que el pathspec
 * del `stash` no casaría con ellas hasta devolverlas al índice.
 */
function rutasCambiadasEnAmbito(salidaZ, ambito, prefijo) {
  const declaradas = (ambito || []).map(function (r) {
    return rutaNativa(r).replace(/^\.\//, '').replace(/\/+$/, '');
  }).filter(Boolean);
  const dentro = function (ruta) {
    return declaradas.some(function (a) { return ruta === a || ruta.startsWith(a + '/'); });
  };

  const entradas = String(salidaZ || '').split('\0');
  const rutas = [];
  const borradasEnIndice = [];
  const relativa = function (cruda) {
    return (prefijo && cruda.startsWith(prefijo)) ? cruda.slice(prefijo.length) : cruda;
  };
  for (let i = 0; i < entradas.length; i++) {
    const e = entradas[i];
    if (e.length <= 3) continue;
    const xy = e.slice(0, 2);
    const destino = relativa(e.slice(3));
    // Un renombrado o copia trae el origen en la entrada siguiente.
    const origen = (/[RC]/.test(xy) && i + 1 < entradas.length) ? relativa(entradas[++i]) : null;
    for (const r of [destino, origen]) {
      if (r && dentro(r) && !rutas.includes(r)) rutas.push(r);
    }
    if (xy[0] === 'D' && dentro(destino)) borradasEnIndice.push(destino);
    if (xy[0] === 'R' && origen && dentro(origen)) borradasEnIndice.push(origen);
  }
  return { rutas, borradasEnIndice };
}

/**
 * Aparta, sin destruirlo, el trabajo de una task que no se commitea: queda en
 * `git stash` con el nombre "sdd-apartado: <titulo>", recuperable con
 * `git stash pop`. Nunca ejecuta `reset --hard` ni `clean`.
 *
 * `deps`: `spawnGit`, `modoParalelo`, `ambito`, `log`.
 *
 * Devuelve `{ ok, nota, detener }`. `detener` pide parar el recorrido
 * secuencial: si el apartado falla o deja residuo, la siguiente task empezaría
 * con ese resto y su `add -A` lo commitearía como propio.
 */
async function apartarTrabajo(task, deps) {
  const d = deps || {};
  const log = registrar(d);
  const modoParalelo = !!d.modoParalelo;
  const titulo = task.titulo;

  let ambito = d.ambito;
  if (modoParalelo) {
    if (!Array.isArray(ambito) || ambito.length === 0) {
      log('Task ' + titulo + ': trabajo conservado sin commitear (sin ámbito declarado no se puede '
        + 'separar del de las hermanas)');
      return {
        ok: false, detener: false,
        nota: 'trabajo conservado sin commitear: sin ámbito declarado no se puede apartar sin '
          + 'llevarse el de las hermanas',
      };
    }
    const estado = await gitVerificado(
      ['status', '--porcelain', '-z', '--untracked-files=all', '--'].concat(ambito.map(function (r) {
        return rutaNativa(r);
      })), d.spawnGit);
    if (!estado.ok) {
      log('Task ' + titulo + ': no se pudo apartar su trabajo — ' + estado.error);
      return { ok: false, detener: false, nota: 'trabajo conservado sin commitear: ' + estado.error };
    }
    // `status --porcelain` da las rutas desde la raíz del repositorio; el ámbito
    // es relativo al proyecto, que puede ser un subdirectorio del repositorio.
    const prefijo = await gitVerificado(['rev-parse', '--show-prefix'], d.spawnGit);
    if (!prefijo.ok) {
      log('Task ' + titulo + ': no se pudo apartar su trabajo — ' + prefijo.error);
      return { ok: false, detener: false, nota: 'trabajo conservado sin commitear: ' + prefijo.error };
    }
    const cambiadas = rutasCambiadasEnAmbito(estado.out, ambito, prefijo.out.trim());
    ambito = cambiadas.rutas;
    if (ambito.length === 0) return { ok: true, detener: false, nota: 'nada que apartar en su ámbito' };

    // Un borrado ya preparado en el índice (lo deja así la revisión, tras su
    // `add -A`) se devuelve al índice para que el pathspec del `stash` case con
    // él; el borrado sigue en el árbol y el `stash` lo guarda igual.
    if (cambiadas.borradasEnIndice.length > 0) {
      const devuelto = await gitVerificado(['reset', '-q', '--'].concat(cambiadas.borradasEnIndice), d.spawnGit);
      if (!devuelto.ok) {
        log('Task ' + titulo + ': no se pudo apartar su trabajo — ' + devuelto.error);
        return { ok: false, detener: false, nota: 'trabajo conservado sin commitear: ' + devuelto.error };
      }
    }
  }

  // La cima de la pila antes y después dice si el `stash` guardó algo: con
  // «No local changes to save» sale con 0 y no crea entrada, y ese mensaje
  // cambia con el idioma de git.
  const cimaAntes = await cimaDeStash(d.spawnGit);
  const argv = argvApartado(task, ambito, modoParalelo);
  const apartado = await gitVerificado(argv, d.spawnGit);
  if (!apartado.ok) {
    log('Task ' + titulo + ': no se pudo apartar su trabajo — ' + apartado.error
      + '. No se destruye nada' + (modoParalelo ? '' : '; el recorrido se detiene'));
    return {
      ok: false, detener: !modoParalelo,
      nota: 'no se pudo apartar el trabajo (' + apartado.error + '); se conserva sin commitear',
    };
  }

  const guardado = (await cimaDeStash(d.spawnGit)) !== cimaAntes;
  const nota = guardado
    ? 'trabajo apartado en git stash "sdd-apartado: ' + titulo + '"'
    : 'nada que apartar: git stash no guardó cambios';
  if (!modoParalelo) {
    const tras = await comprobarArbolLimpio(d.spawnGit);
    if (!tras.limpio) {
      const resto = tras.error || resumenRutas(tras.rutas);
      log('Task ' + titulo + ': tras apartar su trabajo queda residuo (' + resto + '); el recorrido se detiene');
      return { ok: false, detener: true, nota: nota + ', pero queda residuo: ' + resto };
    }
  }

  log('Task ' + titulo + ': ' + nota + (guardado ? ' (recuperable con git stash pop)' : ''));
  return { ok: true, detener: false, nota };
}

/**
 * Commit de la cima de `git stash`, o cadena vacía si la pila está vacía o la
 * lectura no corre. Solo sirve para comparar antes y después de un `stash push`.
 */
async function cimaDeStash(spawn) {
  const r = await spawn(['rev-parse', '-q', '--verify', 'refs/stash']);
  return r && r.code === 0 ? String(r.out || '').trim() : '';
}

/**
 * Llama a `deps.descartar(task)` y deja constancia en el resultado. Un
 * `descartar` que no devuelve nada cuenta como apartado sin incidencias.
 */
async function apartarYRegistrar(task, resultado, deps) {
  const salida = (await deps.descartar(task)) || {};
  if (salida.nota) {
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '') + '(' + salida.nota + ')';
  }
  if (salida.detener) resultado.detener_recorrido = true;
  return resultado;
}

// ── Revision del diff de una task y su commit ────────────────────────────────

/**
 * Prepara el diff de la task y lo lee. Las dos operaciones se verifican por
 * codigo de salida: una lectura que no corrio devuelve cadena vacia igual que un
 * working tree limpio, y confundirlas registraba la constancia de revision de un
 * diff vacio.
 *
 * `ambito`, si llega con al menos un elemento, se pasa como pathspec a `add` y a
 * `diff --cached`: en modo concurrente todas las tasks del nivel comparten arbol
 * e indice, y sin acotar, `add -A` prepara tambien el trabajo sin commitear de
 * una hermana en curso (F1) — el commit de una absorbe el de otra, en el camino
 * feliz, sin que nadie falle. Sin `ambito` (modo secuencial, donde no hay
 * hermanas que contaminen el índice) se acota al proyecto (`-- .`, relativo a
 * su raíz): en un monorepo, `add -A` sin pathspec prepararía también lo de
 * fuera del subdirectorio, que la comprobación de árbol limpio no mira.
 */
async function diffPreparado(spawn, ambito) {
  const pathspec = pathspecDelCommit(ambito);

  const preparado = await gitVerificado(['add', '-A'].concat(pathspec), spawn);
  if (!preparado.ok) return { ok: false, error: preparado.error };

  const lectura = await gitVerificado(['diff', '--cached'].concat(pathspec), spawn);
  if (!lectura.ok) return { ok: false, error: lectura.error };

  return { ok: true, diff: lectura.out };
}

/**
 * Pathspec común de `add`, `diff --cached` y `commit`: el ámbito si lo hay; si
 * no, el proyecto entero (`.`), lo mismo que cubre la comprobación de árbol
 * limpio. Lo que se revisa y lo que se commitea cubren así las mismas rutas.
 */
function pathspecDelCommit(ambito) {
  return ['--'].concat((Array.isArray(ambito) && ambito.length > 0) ? ambito : ['.']);
}

/** Emite la constancia atada al diff revisado y commitea. El commit tambien se lee por exit code. */
async function comitearAprobada(task, resultado, contexto, deps) {
  const log = registrar(deps);
  const marca = await deps.emitirSenal(contexto.diff);
  const subject = String(resultado.commit_message || ('feat: ' + task.titulo)).substring(0, 72);
  const cuerpo = resultado.commit_cuerpo || resultado.notas
    || 'Implementa la task segun su especificacion.';

  // Mismo `ambito` que acoto add/diff (F1): sin el, `git commit` sobre un indice
  // compartido en modo concurrente se lleva TODO lo preparado, incluido lo que
  // ya stageo una hermana en curso — exactamente lo que diffPreparado evita en
  // add/diff pero que aqui, sin pathspec, volveria a colar. `git commit -- <ruta>`
  // commitea solo esas rutas del indice y deja el resto preparado para su dueña.
  // Sin ámbito, el commit se acota al proyecto, igual que add/diff.
  const pathspec = pathspecDelCommit(deps.ambito);

  // Un commit denegado (por un gate, por un indice bloqueado) dejaria el trabajo
  // sin commitear y el informe diria lo contrario.
  const commit = await gitVerificado(['commit', '-m', subject, '-m', cuerpo].concat(pathspec), deps.spawnGit);
  if (!commit.ok) return falloDeGit(resultado, commit.error, log);

  log('Task ' + task.titulo + ': APROBADA y commiteada' + (marca ? ' (senal ' + marca + ')' : ''));
  resultado.revision = contexto.revision;
  resultado.marca_revision = marca;
  return resultado;
}

/**
 * Revisa el diff de la task y, si la revision aprueba, emite la constancia atada
 * a ESE diff y commitea. Devuelve el resultado del implementador con el veredicto
 * reflejado.
 *
 * `deps`: `spawnGit` (ejecuta git), `revisar`, `corregir`, `emitirSenal`,
 * `descartar(task)` (aparta, recuperable, el trabajo sin commitear; ver
 * apartarTrabajo), `log`, `ambito` (opcional:
 * ficheros declarados de la task; se calcula una vez por task, antes de esta
 * llamada, no por cada comando de git).
 */
async function revisarYComitear(task, resultado, deps) {
  const d = deps || {};
  const log = registrar(d);
  const ambito = d.ambito;

  // Ambito presente pero vacio: la task no tiene tabla "Archivos afectados"
  // legible. Acotar a una lista vacia equivaldria a no commitear nunca, asi que
  // se conserva el comportamiento sin acotar (F1) y solo se deja constancia del
  // motivo: quien lea el resultado sabe que este commit, si lo hay, no se acoto.
  if (Array.isArray(ambito) && ambito.length === 0) {
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '')
      + '(ambito vacio: task sin tabla "Archivos afectados" legible; el commit solo se acota al proyecto)';
  }

  const primera = await diffPreparado(d.spawnGit, ambito);
  if (!primera.ok) return falloDeGit(resultado, primera.error, log);
  let diff = primera.diff;

  // Task sin cambios en el working tree: git corrio y no hay nada preparado. Dos
  // situaciones opuestas llegan aqui con el mismo diff vacio: la task que de
  // verdad no tenia nada que hacer (sin ficheros declarados: el vacio es
  // legitimo), y aquella cuyo trabajo YA NO ESTA -absorbido por una hermana o
  // borrado por el descarte de otra- pese a declarar ficheros modificados. Solo
  // la primera se reporta como exito: la segunda pasaria a las tasks
  // posteriores como si su contrato existiera.
  if (!diff.trim()) {
    if ((resultado.archivos_modificados || []).length > 0) {
      log('Task ' + task.titulo + ': FALLIDA (trabajo declarado pero diff vacio) — probablemente '
        + 'absorbido o descartado por una hermana concurrente, no se commitea');
      resultado.resultado = 'FALLIDA';
      resultado.notas = (resultado.notas ? resultado.notas + ' ' : '')
        + '(trabajo declarado pero no queda nada que commitear: probablemente absorbido por el '
        + 'commit de una hermana o borrado por su descarte)';
      return resultado;
    }
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '')
      + '(sin cambios en el working tree: no se commitea)';
    return resultado;
  }

  let revision = await d.revisar(task, diff);
  let veredicto = revision ? revision.veredicto : 'ERROR';

  // Una sola pasada de correccion si la revision es adversa.
  if (veredicto !== 'APROBADA') {
    log('Revision de ' + task.titulo + ': ' + veredicto + ' — una pasada de correccion');
    await d.corregir(task, revision || { problemas_criticos: [], problemas_menores: [] });

    const segunda = await diffPreparado(d.spawnGit, ambito);
    if (!segunda.ok) return falloDeGit(resultado, segunda.error, log);
    diff = segunda.diff;

    revision = await d.revisar(task, diff);
    veredicto = revision ? revision.veredicto : 'ERROR';
  }

  // Sigue adversa: no se commitea. Se aparta el trabajo, recuperable, para que
  // no contamine el diff de la siguiente task.
  if (veredicto !== 'APROBADA') {
    log('Task ' + task.titulo + ': FALLIDA (revision ' + veredicto + '), no se commitea');
    resultado.resultado = 'FALLIDA';
    resultado.revision = revision;
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '')
      + '(revision adversarial: ' + veredicto + ')';
    return apartarYRegistrar(task, resultado, d);
  }

  return comitearAprobada(task, resultado, { diff, revision }, d);
}

// ── Ejecucion de una task ────────────────────────────────────────────────────

/**
 * Dependencias de la task que quedaron FALLIDAS entre los resultados ya
 * acumulados. Una task cuyo pre-requisito no se completo no se implementa: se
 * reporta bloqueada.
 *
 * La comparacion se hace sobre la ruta traducida en los dos lados, igual que
 * depsInternas: una dependencia escrita con separadores de Windows denota la
 * misma task que su `task_path` nativo en `resultadosPrevios`, y compararlas
 * crudas dejaria el bloqueo sin efecto para esa forma de la ruta.
 */
function depsFallidas(task, resultadosPrevios) {
  const previos = resultadosPrevios || [];
  return (task.dependencias || []).filter(function (d) {
    const dep = rutaNativa(d);
    return previos.some(function (r) {
      return r && rutaNativa(r.task_path) === dep && r.resultado === 'FALLIDA';
    });
  });
}

/** Resultado FALLIDA sin trabajo asociado, con el motivo en las notas. */
function resultadoVacio(task, notas) {
  return {
    task_path: task.path,
    task_titulo: task.titulo,
    resultado: 'FALLIDA',
    archivos_modificados: [],
    notas,
  };
}

/**
 * El escape de emergencia degrada el bloqueo del gate de tests a aviso. Se lee
 * del entorno; `env` se inyecta para poder ejercitar las dos ramas sin tocar el
 * entorno del proceso que corre los tests.
 */
function escapeActivo(env) {
  return (env || process.env).SDD_GUARD_SKIP === '1';
}

/**
 * Gate de tests y, si pasa, revision + commit. El rojo de la suite BLOQUEA el
 * commit y aparta el trabajo de la task: es el único veredicto admisible sobre
 * los tests, y no se cree ningun numero que el implementador reporte.
 */
async function trasGateTests(task, resultado, deps) {
  const log = registrar(deps);
  const gate = await deps.gateTests(task);
  resultado.gate_tests = gate;

  // git no llego a correr: eso no dice nada sobre la task. No se commitea, pero
  // tampoco se descarta el trabajo, y no lo degrada el escape de emergencia —
  // con git averiado no hay commit posible.
  if (gate.infraestructura) return falloDeGit(resultado, gate.nota, log);

  if (gate.estado === 'FALLIDA' && !escapeActivo(deps.env)) {
    log('Task ' + task.titulo + ': FALLIDA (gate de tests) — ' + gate.nota + ', no se commitea');
    resultado.resultado = 'FALLIDA';
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '')
      + '(gate de tests: ' + gate.nota + ')';
    return apartarYRegistrar(task, resultado, deps);
  }
  if (gate.estado !== 'PASA') {
    log('Gate de tests (' + task.titulo + '): ' + gate.nota);
  }

  return deps.revisarYComitear(task, resultado);
}

/**
 * Ejecuta una task completa: gate de dependencias fallidas, implementacion, gate
 * de tests y, si pasa, revision + commit. La usan los dos modos de recorrido.
 *
 * Nunca propaga una excepcion: cualquier fallo, esperado o no, vuelve como
 * resultado FALLIDA. De eso depende que el fallo de una task no tumbe a las
 * hermanas de su mismo nivel cuando el nivel se lanza a la vez.
 *
 * `deps`: `implementar`, `gateTests`, `revisarYComitear`, `descartar(task)`,
 * `log`, `env` y, solo en el recorrido secuencial, `arbolLimpio()`: antes de
 * implementar se comprueba que no queda residuo fuera de ai_docs/ (devuelve
 * `{ limpio, rutas, error }`). Con residuo la task no se implementa y el
 * recorrido se detiene: su `add -A` lo commitearía como propio.
 */
async function ejecutarTask(task, resultadosPrevios, deps) {
  const d = deps || {};
  const log = registrar(d);

  const bloqueada = depsFallidas(task, resultadosPrevios);
  if (bloqueada.length > 0) {
    log('Task ' + task.titulo + ': BLOQUEADA (dependencias fallidas: ' + bloqueada.join(', ') + ')');
    return resultadoVacio(task, 'No se implemento: sus dependencias no se completaron ('
      + bloqueada.join(', ') + ')');
  }

  try {
    if (d.arbolLimpio) {
      const estado = await d.arbolLimpio();
      if (!estado || !estado.limpio) {
        const resto = (estado && estado.error) || resumenRutas(estado && estado.rutas);
        log('Task ' + task.titulo + ': no se implementa, el árbol tiene residuo fuera de '
          + DIR_PLAN + '/ (' + resto + '); el recorrido se detiene');
        const r = resultadoVacio(task, 'No se implementó: residuo sin commitear fuera de '
          + DIR_PLAN + '/ al empezar (' + resto + ')');
        r.detener_recorrido = true;
        return r;
      }
    }

    log('Implementando: ' + task.titulo);
    const resultado = await d.implementar(task);

    // Sin resultado, o el propio implementador falló: nada que revisar ni
    // commitear, pero lo que haya escrito se aparta, recuperable, para que la
    // siguiente task empiece con el árbol limpio.
    if (!resultado || resultado.resultado === 'FALLIDA') {
      const fallida = resultado || resultadoVacio(task, 'El agente no retorno resultado');
      return d.descartar ? await apartarYRegistrar(task, fallida, d) : fallida;
    }

    return await trasGateTests(task, resultado, d);
  } catch (e) {
    log('Task ' + task.titulo + ': FALLIDA (excepcion) — ' + e.message);
    return resultadoVacio(task, 'Excepcion durante la ejecucion: ' + e.message);
  }
}

// ── Recorrido de los niveles ─────────────────────────────────────────────────

/**
 * Recorre los niveles EN ORDEN y, dentro de cada nivel, ejecuta las tasks una
 * tras otra (defecto) o todas a la vez (`modoParalelo`, que el flag `--parallel`
 * activa). Devuelve los resultados en el orden en que se acumularon.
 *
 * Cada task recibe una FOTO de los resultados de niveles YA COMPLETADOS, nunca
 * los del nivel en curso. Por definicion de nivel topologico ninguna task
 * depende de otra de su mismo nivel, asi que la foto contiene todo lo que el
 * gate de dependencias fallidas puede necesitar; pasarla, en vez del acumulador
 * vivo, hace que los dos modos decidan sobre exactamente el mismo dato.
 *
 * FRONTERA DEL MODO CONCURRENTE. Lo que el framework hace: lanza las tasks de un
 * nivel a la vez y reporta el resultado de cada una (politica best-effort: el
 * fallo de una no cancela a las demas, y el resumen final distingue cual paso y
 * cual fallo, no solo la primera excepcion). El commit de cada task se acota a
 * sus propios ficheros declarados (F1: `diffPreparado` con `ambito`), asi que ya
 * no absorbe en silencio el trabajo sin commitear de una hermana en curso; y una
 * task cuyo trabajo desapareció del working tree -absorbido por otra- ya no se
 * reporta COMPLETADA (F2: `revisarYComitear` distingue el diff vacio legitimo
 * del inesperado por `archivos_modificados`). El trabajo de una task que no se
 * commitea se aparta en `git stash`, acotado a las rutas de su ámbito que
 * cambiaron (apartarTrabajo): no se lleva lo que las hermanas tienen en el
 * árbol y es recuperable; sin ámbito no se aparta nada. Lo que SIGUE sin hacer: no hay single-writer por
 * fichero, no detecta colisiones entre tasks que tocan el mismo archivo y no
 * particiona el trabajo por ellas ni aísla árboles de trabajo. Todas las tasks
 * de un mismo nivel comparten el mismo working tree e índice mientras se
 * implementan: si dos declaran el mismo fichero, el apartado de una se lleva
 * también lo que la otra escribió en él. Evitar que dos tasks se pisen sigue
 * siendo responsabilidad de quien pide el modo concurrente, no del framework.
 * Las puertas de calidad (gate de tests, revisión del diff) se aplican por task
 * en los dos modos.
 *
 * PARADA. Un resultado con `detener_recorrido` (el apartado falló o dejó
 * residuo, o la task encontró el árbol sucio al empezar) detiene el recorrido:
 * en secuencial tras esa task, en concurrente al cerrar su nivel. Las tasks que
 * quedan se reportan FALLIDAS sin implementar, con el motivo.
 */
async function recorrerNiveles(niveles, ejecutar, opciones) {
  const modoParalelo = !!(opciones && opciones.modoParalelo);
  const acumulados = [];

  let parada = null;

  for (const nivel of (niveles || [])) {
    const completados = acumulados.slice();

    if (parada) {
      for (const task of nivel) acumulados.push(noEjecutada(task, parada));
      continue;
    }

    if (modoParalelo) {
      const resultadosNivel = await Promise.all(nivel.map(function (task) {
        return ejecutar(task, completados);
      }));
      for (const r of resultadosNivel) {
        acumulados.push(r);
        if (!parada && r && r.detener_recorrido) parada = r;
      }
    } else {
      for (const task of nivel) {
        if (parada) { acumulados.push(noEjecutada(task, parada)); continue; }
        const r = await ejecutar(task, completados);
        acumulados.push(r);
        if (r && r.detener_recorrido) parada = r;
      }
    }
  }

  return acumulados;
}

/** Resultado de una task que no llegó a ejecutarse porque el recorrido se detuvo. */
function noEjecutada(task, parada) {
  return resultadoVacio(task, 'No se implementó: el recorrido se detuvo en la task '
    + parada.task_titulo + ' (' + (parada.notas || 'sin motivo registrado') + ')');
}

/**
 * Cuenta el resultado del conjunto. Solo COMPLETADA cuenta como completada: un
 * PARCIAL, un FALLIDA o un resultado ausente dejan la task sin cerrar.
 */
function resumirResultados(resultados) {
  let completadas = 0;
  let fallidas = 0;
  for (const r of (resultados || [])) {
    if (r && r.resultado === 'COMPLETADA') completadas += 1;
    else fallidas += 1;
  }
  return { completadas, fallidas };
}

// ── Convergencia y resultado del flujo ───────────────────────────────────────

/** Traduce la respuesta de la verificacion de convergencia al veredicto del flujo. */
function veredictoConvergencia(respuesta, log) {
  if (!respuesta || !respuesta.veredicto) {
    log('Convergencia: la respuesta del agente no parseo contra el schema');
    return { veredicto: 'ERROR', razon: 'parse_failed' };
  }

  if (respuesta.veredicto === 'DIVERGE') {
    const tasksGeneradas = respuesta.tasks_generadas || [];
    log('DIVERGENCIA: spec no cerrada, ' + tasksGeneradas.length
      + ' task(s) de convergencia generadas: ' + tasksGeneradas.join(', '));
    return {
      veredicto: 'DIVERGE',
      criterios_verificados: respuesta.criterios_verificados,
      tasks_generadas: tasksGeneradas,
    };
  }

  log('CONVERGENCIA: spec cerrada, ' + (respuesta.criterios_verificados || 0)
    + ' criterios verificados');
  return {
    veredicto: 'CONVERGIDA',
    criterios_verificados: respuesta.criterios_verificados,
    tasks_generadas: [],
  };
}

/**
 * Cierra el hueco que la revision por task no cubre: si el CONJUNTO final
 * converge con la spec original. Se OMITE cuando alguna task quedo sin
 * completar, y entonces `verificar` no llega a invocarse: medir la convergencia
 * de lo que no se implemento no dice nada, y la invocacion cuesta.
 *
 * `deps`: `completadas`, `fallidas`, `total`, `verificar`, `log`.
 */
async function resolverConvergencia(deps) {
  const d = deps || {};
  const log = registrar(d);

  if (d.completadas !== d.total) {
    log('Convergencia omitida: ' + d.fallidas + ' tasks fallidas/bloqueadas');
    return { veredicto: 'OMITIDA', razon: 'tasks_fallidas' };
  }

  return veredictoConvergencia(await d.verificar(), log);
}

/**
 * Objeto de retorno del flujo. Vive aqui para que su forma quede fijada por un
 * test que la EJECUTA: una busqueda de texto sobre el fuente la daba por buena
 * incluso con el campo comentado y el retorno a nulo.
 */
function construirResultado(entrada) {
  const e = entrada || {};
  return {
    spec: e.spec,
    spec_titulo: e.spec_titulo,
    tasks_total: e.tasks_total,
    niveles: e.niveles,
    tasks_completadas: e.completadas,
    tasks_fallidas: e.fallidas,
    implementaciones: e.implementaciones,
    convergencia: e.convergencia,
  };
}

module.exports = {
  rutaNativa,
  interpretarSalidaGit,
  validarDependencias,
  computeNiveles,
  verificarContratos,
  descubrirComandoTest,
  tocaCodigoEjecutable,
  evaluarGateTests,
  parsearArgs,
  gitVerificado,
  falloDeGit,
  evaluarArbolLimpio,
  comprobarArbolLimpio,
  mensajeArbolSucio,
  argvApartado,
  apartarTrabajo,
  revisarYComitear,
  depsFallidas,
  ejecutarTask,
  recorrerNiveles,
  resumirResultados,
  resolverConvergencia,
  construirResultado,
};

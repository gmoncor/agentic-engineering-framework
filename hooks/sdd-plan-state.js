'use strict';

/**
 * Estado del plan SDD leido de ai_docs/tasks/, y resolucion de las rutas que se contrastan con el.
 *
 * SSOT de tres preguntas que comparten los guards de todos los backends:
 *   1. "que ruta absoluta denota esto?" — toNativePath / findRepoRoot / resolveRepoPath.
 *   2. "esta esta escritura respaldada por el plan?" — findTasksDir / denialReason.
 *   3. "declara este proyecto configuracion propia?" — loadExtensionConfig.
 *
 * Las dos primeras van juntas porque la segunda solo es fiable si la primera lo es: una ruta mal
 * situada compara mal contra el plan, y el guard bloquea escrituras legitimas o deja pasar las que
 * no lo son. La tercera vive aqui porque tambien se responde situando una ruta contra la raiz del
 * proyecto, con los mismos helpers. Si cambia el formato de specs o tasks, la forma de situar una
 * ruta, o donde se busca la configuracion del proyecto, cambia en un solo sitio.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseAffectedFiles } = require('./sdd-task-files');

// Directorio temporal del sistema: nunca es la raiz de un proyecto, sino un espacio
// compartido por procesos ajenos entre si. Sirve de techo para el ascenso de
// findTasksDir Y findRepoRoot: sin el, un ai_docs/tasks/ o un .git que quede residual
// ahi (o en cualquier directorio por encima) se "prestaria" a cualquier archivo que se
// este escribiendo dentro de /tmp, como si perteneciera a su proyecto, y colapsaria a
// una misma raiz a dos sesiones de test que trabajan en subdirectorios temporales distintos.
const TMP_ROOT = path.resolve(os.tmpdir());

// Niveles maximos de ascenso al buscar un ancla (la raiz del repositorio, ai_docs/tasks/) desde
// un archivo: por encima de diez, el ancla que se encontrase ya no seria del mismo proyecto.
const MAX_ASCENT = 10;

// Comienzo de una ruta absoluta de Windows: unidad (C:\ o C:/) o recurso de red (\\servidor).
const WINDOWS_PREFIX_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

// Configuracion opcional del proyecto que instala el framework. Vive en la raiz del proyecto y
// NO forma parte de lo que el framework distribuye: una actualizacion reescribe sus propios
// ficheros y nunca este, asi que la configuracion propia sobrevive a la actualizacion sin
// necesidad de bifurcar el repositorio ni de editar ningun fichero distribuido.
const EXTENSION_CONFIG_FILE = 'sdd.config.json';

// Firma estable de aviso (ver hooks/gate-signatures.json): hay configuracion pero no se puede
// interpretar. Callar seria peor que avisar — el proyecto creeria activa una configuracion que
// no lo esta, y la diferencia solo se notaria mucho despues.
const EXTENSION_FIRMA = '[SDD_EXTENSION_ADVISORY] ';

// Una lectura por fichero y por proceso. La clave es la ruta ya resuelta: dos anclas distintas
// son dos configuraciones distintas y no comparten entrada.
const extensionCache = new Map();

/**
 * Traduce a los separadores del sistema en curso una ruta de procedencia externa (el payload de
 * una herramienta, la tabla de una task).
 *
 * SIEMPRE ANTES de resolver, comparar o partir la ruta. La barra invertida es separador en Windows
 * y un caracter valido de nombre de archivo en los sistemas tipo Unix: sin traducirla,
 * "src\auth\login.js" no es una ruta de tres tramos sino UN nombre de archivo. Todo lo que se
 * derive de ahi — la clave con la que se compara contra el plan, el registro de lecturas, la
 * comprobacion de si esta bajo ai_docs/ — sale mal, y sin que nada falle de forma visible.
 *
 * Solo actua en el cruce entre sistemas, nunca sobre una ruta nativa:
 *   - En Windows la ruta se devuelve intacta: alli las dos barras ya son separadores.
 *   - En un sistema tipo Unix se traduce solo si lleva barra invertida y ademas no lleva ninguna
 *     barra normal, o si abre con un prefijo de unidad de Windows. Una ruta que ya trae
 *     separadores nativos se respeta tal cual.
 *
 * Limite aceptado: un archivo de Unix cuyo nombre contenga literalmente una barra invertida y
 * ninguna barra normal se traduce como si viniera de Windows. Ningun cliente emite ese nombre, y
 * la alternativa — no traducir nunca — es justo el defecto que este helper existe para cerrar.
 *
 * `api` (path.win32 / path.posix) solo existe para ejercitar las dos plataformas desde una sola.
 */
function toNativePath(raw, api) {
  const ruta = String(raw == null ? '' : raw);
  const impl = api || path;
  if (impl.sep === '\\' || !ruta.includes('\\')) return ruta;
  if (ruta.includes('/') && !WINDOWS_PREFIX_RE.test(ruta)) return ruta;
  return ruta.replace(/\\/g, '/');
}

/**
 * Raiz del repositorio que contiene `startDir`, o null si no hay ninguna.
 *
 * El ancla es `.git`, presente en la raiz tanto si es un directorio (clon normal) como si es un
 * archivo que apunta al repositorio principal (arbol de trabajo enlazado). En un arbol enlazado la
 * raiz que interesa es la suya, no la del principal: es donde viven los archivos que se escriben.
 */
function findRepoRoot(startDir) {
  let dir = path.resolve(toNativePath(startDir) || process.cwd());
  for (let i = 0; i < MAX_ASCENT; i++) {
    if (dir === TMP_ROOT) break;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Ancla contra la que se situan las rutas relativas: la raiz del repositorio o, si no hay
 * repositorio, `fromDir` (el directorio en curso cuando no se pasa ninguno).
 *
 * Un proyecto sin git es una condicion prevista, no un fallo: el ancla degrada al directorio en
 * curso, que es exactamente lo que se usaba antes de existir este helper. No se avisa por stderr
 * porque el aviso sonaria en CADA llamada a herramienta de esos proyectos.
 */
function repoRoot(fromDir) {
  return findRepoRoot(fromDir) || path.resolve(toNativePath(fromDir) || process.cwd());
}

/**
 * Ruta absoluta que denota `target`, anclada a la raiz del repositorio.
 *
 * Una ruta relativa que llega en el payload de una herramienta es relativa a la raiz del proyecto,
 * no al directorio desde el que se lanzo el proceso del hook. Resolverla contra el directorio en
 * curso la situa en otro sitio en cuanto la sesion arranca en un subdirectorio o en un arbol de
 * trabajo enlazado, y de ahi salen las dos averias: bloquear escrituras legitimas y dejar sin
 * vigilar las que no lo son.
 *
 * Una ruta absoluta se preserva (ya esta situada, y puede apuntar legitimamente fuera del
 * repositorio); nunca se concatena con la raiz.
 *
 * Devuelve null cuando la ruta no se puede situar dentro del repositorio: una relativa que asciende
 * por encima de la raiz ("../../etc/passwd"). Quien la reciba no puede contrastarla con el plan y
 * debe decirlo, en vez de resolverla a ciegas.
 */
function resolveRepoPath(target, fromDir) {
  const nativa = toNativePath(target);
  if (!nativa) return null;
  if (path.isAbsolute(nativa)) return path.resolve(nativa);

  const anchor = repoRoot(fromDir);
  const resolved = path.resolve(anchor, nativa);
  return isInside(anchor, resolved) ? resolved : null;
}

/** Si `target` cae dentro de `root` (o es el propio `root`). Ambos absolutos y con separadores nativos. */
function isInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * Escribir documentacion ES planificar: ai_docs/ nunca se bloquea.
 *
 * Decide sobre el PRIMER tramo relativo a la raiz del repositorio, no sobre la ruta absoluta
 * completa: un proyecto instalado bajo un ancestro que se llame literalmente "ai_docs" (el patron
 * de instalacion "ai_docs/frameworks/<framework>") no debe leer como documentacion cualquier
 * escritura en cualquier fichero solo porque ese nombre aparece mas arriba en la ruta.
 *
 * Sin raiz que resolver (proyecto sin git) se conserva el criterio anterior: sin ancla no hay
 * "primer tramo" que aislar, y una escritura de documentacion no debe bloquearse por eso.
 */
function isInsideAiDocs(resolved) {
  const ruta = String(resolved);
  const raiz = findRepoRoot(path.dirname(ruta));
  if (!raiz) return ruta.split(/[\\/]/).includes('ai_docs');
  return path.relative(raiz, ruta).split(path.sep)[0] === 'ai_docs';
}

/** Sube desde el directorio del archivo buscando ai_docs/tasks/. null = proyecto sin pipeline SDD. */
function findTasksDir(filePath) {
  let dir = path.dirname(filePath);
  for (let i = 0; i < MAX_ASCENT; i++) {
    if (dir === TMP_ROOT) break;
    const candidate = path.join(dir, 'ai_docs', 'tasks');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Motivo por el que el plan no respalda la escritura de `resolved`, o null si la respalda.
 *
 * Sin la comprobacion del archivo declarado el guard seria inutil: bastaria una spec aprobada para
 * dejar pasar cualquier escritura durante el resto de la vida del proyecto.
 */
function denialReason(tasksDir, resolved) {
  if (findApprovedSpecs(tasksDir).length === 0) {
    return 'SDD: no hay ninguna spec con Estado: APROBADA en ai_docs/tasks/. '
      + 'Planifica y aprueba la spec antes de escribir codigo.';
  }

  if (findActiveTaskFiles(tasksDir).length === 0) {
    return 'SDD: hay spec aprobada pero ninguna task derivada de ella en ai_docs/tasks/. '
      + 'Deriva las tasks (cada una debe citar su spec madre) antes de escribir codigo.';
  }

  if (findDeclaredFiles(tasksDir).has(resolved)) return null;

  return 'SDD: el archivo ' + resolved + ' no esta declarado en ninguna task de la spec activa. '
    + 'Puede ser porque ninguna task lo declara en su tabla, o porque la task que lo declara no '
    + 'cita "Spec madre". Anadelo a la tabla "Archivos afectados" de la task correspondiente '
    + '(| `ruta/al/archivo` | CREAR/MODIFICAR/ELIMINAR | descripcion |) y declara '
    + '"Spec madre: spec_X.md" en esa task, '
    + 'o usa SDD_GUARD_SKIP=1 como escape puntual de emergencia.';
}

/**
 * Valores del campo de cabecera `nombre` en cada linea propia que lo declara (con o sin negrita
 * markdown), en orden de aparicion. Un unico recorrido de lineas sirve a los dos predicados que
 * leen cabeceras: el estado vigente de una spec se queda con el ULTIMO valor devuelto; la cita a
 * la spec madre de una task busca en TODOS los valores devueltos.
 *
 * Anclado a inicio de linea: una mencion incrustada en otra frase (una entrada de historial como
 * "2026-01-01: Estado: APROBADA") no empieza por el nombre del campo y no cuenta.
 */
function headerFieldValues(texto, nombre) {
  const patron = new RegExp('^\\s*\\*{0,2}' + nombre + ':\\*{0,2}\\s*(.+?)\\s*$', 'gim');
  return Array.from(texto.matchAll(patron), m => m[1]);
}

/** Estado vigente de una spec: el valor del ULTIMO campo `Estado` en linea propia, o null si no hay. */
function estadoVigente(texto) {
  const valores = headerFieldValues(texto, 'Estado');
  return valores.length ? valores[valores.length - 1] : null;
}

/** Specs spec_*.md cuyo Estado VIGENTE es APROBADA. Retorna paths absolutos. */
function findApprovedSpecs(tasksDir) {
  return listFiles(tasksDir)
    .filter(f => f.startsWith('spec_') && f.endsWith('.md'))
    .map(f => path.join(tasksDir, f))
    .filter(p => estadoVigente(readText(p)) === 'APROBADA');
}

/** Tasks NNN_*.md. Retorna paths absolutos. */
function findTaskFiles(tasksDir) {
  return listFiles(tasksDir)
    .filter(f => /^\d{3}_/.test(f) && f.endsWith('.md'))
    .map(f => path.join(tasksDir, f));
}

/**
 * Identificadores con los que una task puede citar a su spec madre: el nombre del fichero
 * (spec_pagos.md), su raiz (spec_pagos), su descriptor (pagos) y el titulo de su encabezado.
 * Se descartan los de menos de 4 caracteres: un identificador corto acertaria por casualidad.
 */
function specIdentifiers(specPath) {
  const base = path.basename(specPath);
  const stem = base.replace(/\.md$/i, '');
  const descriptor = stem.replace(/^spec_/i, '');
  const heading = (readText(specPath).match(/^#{1,6}\s+(?:Spec:\s*)?(.+?)\s*$/m) || [])[1];

  return [base, stem, descriptor, heading]
    .filter(Boolean)
    .map(s => String(s).trim().toLowerCase())
    .filter(s => s.length >= 4);
}

/** Escapa caracteres especiales de regex para usar `s` como texto literal dentro de un patron. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tasks que pertenecen a alguna spec APROBADA, es decir, que la citan en su campo `Spec madre`.
 *
 * Acotar a la spec activa es lo que mantiene util al guard: la union de TODAS las tasks del
 * directorio crece con el historial del proyecto, y con ella el permiso de escritura. Al cabo de
 * unos meses el guard autorizaria cualquier archivo que alguna task vieja declarase alguna vez.
 *
 * La vinculacion exige el campo, no basta una mencion en prosa: una task que solo MENCIONA el
 * descriptor de la spec en texto libre (p.ej. "requiere auth para el panel") no dice de que spec
 * deriva, y sin ese dato no puede prestar autorizacion de escritura a los archivos que declare.
 * Dentro del campo se conservan los limites de palabra ya existentes: "auth" sigue sin casar con
 * "authentication".
 */
function findActiveTaskFiles(tasksDir) {
  const identificadores = findApprovedSpecs(tasksDir).flatMap(specIdentifiers);
  if (identificadores.length === 0) return [];

  const patrones = identificadores.map(id => new RegExp('\\b' + escapeRegex(id) + '\\b'));

  return findTaskFiles(tasksDir).filter(taskPath => {
    const citas = headerFieldValues(readText(taskPath), 'Spec\\s+madre').join('\n').toLowerCase();
    return citas !== '' && patrones.some(patron => patron.test(citas));
  });
}

/**
 * Set de paths absolutos declarados en las tasks de la spec activa. Los paths de una task son
 * relativos a la raiz del proyecto (el padre de ai_docs/): se resuelven contra ella para que
 * "src/foo.js" y "./src/foo.js" comparen igual.
 */
function findDeclaredFiles(tasksDir) {
  const projectRoot = path.resolve(tasksDir, '..', '..');
  const declared = new Set();

  for (const taskPath of findActiveTaskFiles(tasksDir)) {
    for (const rel of parseAffectedFiles(readText(taskPath))) {
      declared.add(path.resolve(projectRoot, toNativePath(rel)));
    }
  }
  return declared;
}

/** Ruta del fichero de configuracion del proyecto. SDD_EXTENSION_CONFIG lo aisla en tests. */
function extensionConfigPath(fromDir) {
  const override = process.env.SDD_EXTENSION_CONFIG;
  if (override) return path.resolve(toNativePath(override));
  return path.join(repoRoot(fromDir), EXTENSION_CONFIG_FILE);
}

/**
 * Configuracion declarada por el proyecto, o `{}` si no declara ninguna.
 *
 * Punto de extension para un despliegue que necesite configuracion adicional (destino de la
 * auditoria, campos propios, servidores declarados) sin tocar ningun fichero distribuido. El
 * esquema esta en docs/extension-config-schema.md.
 *
 * Los tres desenlaces terminan en una sesion viva, nunca en un fallo:
 *   - Sin fichero: `{}` y silencio. Es el caso normal, no una carencia; el framework opera igual
 *     que si esta capa no existiera.
 *   - Fichero ilegible como configuracion (JSON invalido, o una raiz que no es un objeto): aviso
 *     firmado por stderr y `{}`. Se avisa porque la degradacion silenciosa enganaria.
 *   - Claves que este framework no conoce: se devuelven intactas y nadie las lee. Quien consume la
 *     configuracion pide la clave que entiende; el resto viaja inerte. Asi una version futura del
 *     esquema no rompe una instalacion anterior.
 */
function loadExtensionConfig(fromDir) {
  const file = extensionConfigPath(fromDir);
  if (!extensionCache.has(file)) extensionCache.set(file, readExtensionConfig(file));
  return extensionCache.get(file);
}

function readExtensionConfig(file) {
  const raw = readTextOrNull(file);
  if (raw === null) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return avisarConfigIlegible(file, err.message);
  }
  if (!isPlainObject(parsed)) return avisarConfigIlegible(file, 'la raiz debe ser un objeto JSON');
  return parsed;
}

function avisarConfigIlegible(file, causa) {
  try {
    fs.writeSync(2, EXTENSION_FIRMA + file + ' no se puede leer como configuracion (' + causa
      + '); el framework sigue con sus valores por defecto.\n');
  } catch {
    // stderr roto: lo que importa es seguir, el aviso es secundario.
  }
  return {};
}

/** Un objeto JSON, no un array ni null: la forma que puede llevar claves con nombre. */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Contenido del fichero, o null si no se pudo leer. Distinguir null de '' importa al parsear. */
function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readText(file) {
  return readTextOrNull(file) || '';
}

module.exports = {
  toNativePath,
  findRepoRoot,
  repoRoot,
  resolveRepoPath,
  isInside,
  isInsideAiDocs,
  loadExtensionConfig,
  isPlainObject,
  findTasksDir,
  denialReason,
  findApprovedSpecs,
  findTaskFiles,
  findActiveTaskFiles,
  findDeclaredFiles,
};

#!/usr/bin/env node
'use strict';

// CLI del framework. Punto de entrada expuesto via package.json:bin, pensado
// para invocarse con `npx github:gmoncor/agentic-engineering-framework <subcomando>`
// desde el directorio de un proyecto destino.
//
// PACKAGE_ROOT es la raiz del paquete descargado por npx (la fuente de los
// archivos del framework); DEST es el directorio del usuario (el destino).
// Cuando npx clona el repo, __dirname apunta al paquete descargado, no al
// cwd del usuario — por eso ambas rutas se resuelven por separado.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

const PACKAGE_ROOT = process.env.SDD_FRAMEWORK_ROOT
  ? path.resolve(process.env.SDD_FRAMEWORK_ROOT)
  : path.resolve(__dirname, '..');
const DEST = process.cwd();

const BACKENDS_VALIDOS = ['claude', 'gemini', 'codex', 'antigravity', 'all'];
const DIRS_DEL_PROYECTO = ['ai_docs/core', 'ai_docs/tasks', 'ai_docs/refs'];

// Archivo de contexto que lleva el marcador `<!-- sdd-framework: X.Y.Z -->`
// para cada backend. codex y antigravity comparten AGENTS.md.
const ARCHIVO_CONTEXTO_POR_BACKEND = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md',
  codex: 'AGENTS.md',
  antigravity: 'AGENTS.md',
};

// `update` protege por hash-sidecar CUALQUIER archivo que copie (ver
// `archivosDe`/`editadaLocalmente`), no solo estos 6. La lista se conserva
// para dos usos mas acotados: (a) en `install`, donde una colision con un
// archivo fuera de esta lista se resuelve via el preflight de colision
// (confirmacion o --force) en lugar de protegerse por hash; (b) excluir estos
// 6 del preflight de colision, porque su proteccion por hash ya es suficiente.
const ARCHIVO_SIDECAR_HASHES = '.sdd-installed-hashes.json';
const ARCHIVOS_PROTEGIDOS = ['hooks/config.json', '.claude/settings.json', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md', '.gitignore'];

// Lockfile de instalacion en curso: se crea al empezar a copiar y se borra al
// terminar con exito. Si el proceso muere a mitad (kill, Ctrl-C, OOM), queda
// en disco como senal de que la instalacion anterior no completo.
const LOCKFILE_INSTALACION = '.sdd-install-in-progress';

// Comando para correr los tests de los hooks instalados. Se ofrece via
// `scripts.test` del package.json del destino en lugar de copiar el
// package.json del framework (que pisaria nombre, dependencias y scripts
// del proyecto del usuario).
const SCRIPTS_TEST = 'node --test "hooks/tests/*.test.js" "tests/*.test.js"';

function mostrarAyuda() {
  console.log(`Uso: agentic-engineering-framework <subcomando> [opciones]

Subcomandos:
  install --backend <claude|gemini|codex|antigravity|all>   Instala el framework en el directorio actual.
  update --backend <claude|gemini|codex|antigravity|all>    Actualiza el framework instalado, sin tocar ai_docs/core/, ai_docs/tasks/ ni ai_docs/refs/.
  --help                                                     Muestra esta ayuda.
  --version                                                  Muestra la version instalada.

Ejemplos:
  npx github:gmoncor/agentic-engineering-framework install --backend claude
  npx github:gmoncor/agentic-engineering-framework update --backend claude

Si se omite --backend, se muestra un menu interactivo para elegir (requiere terminal; en pipe/CI, falla con mensaje claro).`);
}

function mostrarAyudaInstall() {
  console.log(`Uso: agentic-engineering-framework install --backend <claude|gemini|codex|antigravity|all> [--skip <nombre,nombre>] [--dry-run] [--force]

Instala el framework en el directorio actual: copia las rutas del backend elegido y crea ai_docs/{core,tasks,refs}/ si no existen.

Si se omite --backend, se muestra un menu interactivo para elegir (requiere terminal; en pipe/CI, falla con mensaje claro).
--skip omite componentes opcionales (asesor, auditar, bugfix, cleanup, testing, pr); solo aplica al backend claude.
--dry-run muestra que ficheros se copiarian/saltarian sin escribir nada en disco.
--force si hay archivos no protegidos que se sobrescribirian, salta la confirmacion (util en CI/pipe). No afecta a los archivos protegidos con ediciones locales: para esos sigue haciendo falta --reset-protected.`);
}

function mostrarAyudaUpdate() {
  console.log(`Uso: agentic-engineering-framework update --backend <claude|gemini|codex|antigravity|all> [--skip <nombre,nombre>] [--reset-protected] [--dry-run] [--force]

Actualiza el framework instalado en el directorio actual: copia las rutas del backend elegido sin tocar ai_docs/core/, ai_docs/tasks/ ni ai_docs/refs/.

Si se omite --backend, se muestra un menu interactivo para elegir (requiere terminal; en pipe/CI, falla con mensaje claro).
--skip omite componentes opcionales (asesor, auditar, bugfix, cleanup, testing, pr); solo aplica al backend claude.
--reset-protected sobrescribe cualquier archivo del framework con ediciones locales detectadas (no solo los archivos nucleares como CLAUDE.md o hooks/config.json) y refresca el sidecar de hashes al final.
--dry-run muestra que ficheros se copiarian/saltarian sin escribir nada en disco.
--force si hay archivos no protegidos que se sobrescribirian, salta la confirmacion (util en CI/pipe). No afecta a los archivos protegidos con ediciones locales: para esos sigue haciendo falta --reset-protected.`);
}

function obtenerVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function parseFlag(args, flag) {
  const indice = args.indexOf(flag);
  return indice === -1 ? undefined : args[indice + 1];
}

/**
 * Elimina rutas que ya estan cubiertas por una ruta padre presente en la
 * misma lista (p.ej. "hooks/tests" se descarta si "hooks" tambien esta).
 * El ordenamiento por longitud es solo un detalle interno del algoritmo de
 * deteccion de cobertura: el resultado se devuelve en el orden original de
 * entrada para no alterar la prioridad de copia definida por el manifiesto.
 */
function deduplicarRutas(rutas) {
  const unicas = [...new Set(rutas)];
  const ordenadasPorLongitud = [...unicas].sort((a, b) => a.length - b.length);
  const noCubiertas = [];
  for (const ruta of ordenadasPorLongitud) {
    const yaCubierta = noCubiertas.some(base => ruta === base || ruta.startsWith(`${base}/`));
    if (!yaCubierta) noCubiertas.push(ruta);
  }
  const supervivientes = new Set(noCubiertas);
  return unicas.filter(ruta => supervivientes.has(ruta));
}

/**
 * Rutas de la seccion `claude` del manifiesto, aplicando `--skip` sobre los
 * componentes opcionales. Formato antiguo (array plano) => retrocompatible:
 * todo se trata como core, sin componentes omitibles.
 */
function resolverSeccionClaude(seccionClaude, skip) {
  if (Array.isArray(seccionClaude)) return seccionClaude;
  const nombresValidos = new Set(seccionClaude.optional.map(item => item.nombre));
  for (const nombre of skip) {
    if (!nombresValidos.has(nombre)) {
      process.stderr.write(`componente '${nombre}' no reconocido, ignorado\n`);
    }
  }
  const opcionalesActivas = seccionClaude.optional
    .filter(item => !skip.has(item.nombre))
    .flatMap(item => item.rutas);
  return [...seccionClaude.core, ...opcionalesActivas];
}

function rutasParaBackend(manifest, backend, skip = new Set()) {
  if (backend === 'all') {
    const rutas = Object.entries(manifest).flatMap(([nombreBackend, seccion]) =>
      nombreBackend === 'claude' ? resolverSeccionClaude(seccion, skip) : seccion,
    );
    return deduplicarRutas(rutas);
  }
  const seccionBackend = backend === 'claude' ? resolverSeccionClaude(manifest.claude, skip) : (manifest[backend] || []);
  return deduplicarRutas([...manifest.common, ...seccionBackend]);
}

/** Lista de nombres de `--skip <nombre,nombre>`. Vacio o ausente => sin skip. */
function parseSkip(args) {
  const valor = parseFlag(args, '--skip');
  if (!valor) return new Set();
  return new Set(valor.split(',').map(nombre => nombre.trim()).filter(Boolean));
}

/** El flag --skip solo tiene efecto sobre el backend claude (solo o dentro de all). */
function advertirSiSkipNoAplica(backend, skip) {
  if (skip.size > 0 && backend !== 'claude' && backend !== 'all') {
    process.stderr.write(
      'la granularidad --skip solo aplica al backend claude en esta version; se ignora para los demas backends\n',
    );
  }
}

/**
 * Avisa (no bloquea) si el proyecto tiene marcador de un backend distinto al
 * elegido. Compara por ruta de archivo, no por nombre de backend: codex y
 * antigravity comparten AGENTS.md por diseno, asi que instalar codex sobre
 * un proyecto con marcador antigravity NO debe disparar el aviso.
 */
function advertirSiBackendEquivocado(backend) {
  if (backend === 'all') return;
  const archivoElegido = ARCHIVO_CONTEXTO_POR_BACKEND[backend];
  if (fs.existsSync(path.join(DEST, archivoElegido))) {
    const contenido = fs.readFileSync(path.join(DEST, archivoElegido), 'utf8');
    if (contenido.includes('<!-- sdd-framework:')) return;
  }

  for (const [otroBackend, archivo] of Object.entries(ARCHIVO_CONTEXTO_POR_BACKEND)) {
    if (otroBackend === backend || archivo === archivoElegido) continue;
    try {
      const rutaAbsoluta = path.join(DEST, archivo);
      if (!fs.existsSync(rutaAbsoluta)) continue;
      if (!fs.readFileSync(rutaAbsoluta, 'utf8').includes('<!-- sdd-framework:')) continue;
      process.stderr.write(
        `Aviso: se detecto una instalacion previa del backend ${otroBackend} (${archivo}). Si esto es intencional (ej. --backend all), ignora este aviso.\n`,
      );
      return;
    } catch {
      // El aviso es best-effort: un fallo de lectura no debe interrumpir la instalacion.
    }
  }
}

// Nombres del layout de Gemini previo al namespacing bajo `.gemini/`: carpetas
// sueltas en la raiz que colisionaban con convenciones propias de otros
// proyectos (Discord.js, oclif, Rails...). Esta version las mueve a
// `.gemini/agents`, `.gemini/commands` y `.gemini/skills`.
const RUTAS_GEMINI_LAYOUT_ANTIGUO = ['agents', 'commands', 'skills'];

/**
 * Avisa (no bloquea) si el proyecto tiene una instalacion previa del backend
 * Gemini con el layout antiguo (carpetas sueltas, sin namespace). Desde esta
 * version install/update solo gestionan las rutas bajo `.gemini/`: las
 * carpetas antiguas no se tocan ni se actualizan, y quedarian obsoletas en
 * silencio si no se avisa del breaking change.
 */
function advertirSiGeminiLayoutAntiguo(backend) {
  if (backend !== 'gemini' && backend !== 'all') return;
  const contextoGemini = path.join(DEST, ARCHIVO_CONTEXTO_POR_BACKEND.gemini);
  if (!fs.existsSync(contextoGemini)) return;
  if (!fs.readFileSync(contextoGemini, 'utf8').includes('<!-- sdd-framework:')) return;

  const layoutAntiguo = RUTAS_GEMINI_LAYOUT_ANTIGUO.filter(ruta => fs.existsSync(path.join(DEST, ruta)));
  if (!layoutAntiguo.length) return;

  process.stderr.write(
    `Aviso: layout antiguo de Gemini detectado (${layoutAntiguo.join(', ')} sueltos en la raiz). `
      + 'Desde esta version las rutas de Gemini viven bajo .gemini/ para evitar colisiones con carpetas '
      + `propias del proyecto; install/update ya no tocan ${layoutAntiguo.join(', ')} y puedes borrarlas `
      + 'a mano si su contenido pertenece al framework.\n',
  );
}

/** SHA-256 hexadecimal del contenido de un archivo, o null si no existe. */
function hashFile(rutaAbsoluta) {
  if (!fs.existsSync(rutaAbsoluta)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(rutaAbsoluta)).digest('hex');
}

/**
 * Lee el sidecar de hashes instalados del destino. Ausente => {} en silencio
 * (proyecto sin sidecar previo, caso normal). JSON invalido (corrupcion, o una
 * escritura anterior interrumpida a mitad de proceso) => avisa por stderr y
 * continua con {}, tratando todos los archivos como sin hash previo en lugar
 * de abortar.
 */
function loadInstalledHashes(dest) {
  const sidecarPath = path.join(dest, ARCHIVO_SIDECAR_HASHES);
  if (!fs.existsSync(sidecarPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `${ARCHIVO_SIDECAR_HASHES} tiene formato invalido, se ignora (los archivos se tratan como sin hash previo): ${err.message}\n`,
    );
    return {};
  }
}

/** Persiste el sidecar de hashes. Un fallo de escritura no revierte la copia ya hecha. */
function saveInstalledHashes(dest, hashes) {
  try {
    fs.writeFileSync(path.join(dest, ARCHIVO_SIDECAR_HASHES), JSON.stringify(hashes, null, 2));
  } catch (err) {
    process.stderr.write(`No se pudo guardar ${ARCHIVO_SIDECAR_HASHES}: ${err.message}\n`);
  }
}

/**
 * Crea el lockfile de instalacion en curso antes de copiar. Si no se puede
 * escribir (p.ej. disco lleno), aborta con un mensaje claro en lugar de
 * continuar la copia sin marca de progreso.
 */
function crearLockfileInstalacion(backend) {
  const contenido = JSON.stringify({ timestamp: new Date().toISOString(), backend });
  try {
    fs.writeFileSync(path.join(DEST, LOCKFILE_INSTALACION), contenido);
  } catch (err) {
    process.stderr.write(`No se pudo crear ${LOCKFILE_INSTALACION}, instalacion abortada: ${err.message}\n`);
    process.exit(1);
  }
}

/** Elimina el lockfile tras completar la copia con exito. Ausente => no-op. */
function eliminarLockfileInstalacion() {
  const lockfilePath = path.join(DEST, LOCKFILE_INSTALACION);
  if (fs.existsSync(lockfilePath)) fs.unlinkSync(lockfilePath);
}

/**
 * Avisa por stderr si detecta el lockfile de una instalacion anterior que no
 * completo. No bloquea: el usuario ya eligio instalar/actualizar ahora, asi
 * que la ejecucion continua y el lockfile se sobrescribe al empezar a copiar.
 * JSON invalido (corrupcion a mitad de escritura) => aviso generico sin
 * crash.
 */
function advertirSiInstalacionInterrumpida(backend) {
  const lockfilePath = path.join(DEST, LOCKFILE_INSTALACION);
  if (!fs.existsSync(lockfilePath)) return;

  let previo;
  try {
    previo = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  } catch {
    process.stderr.write(
      `Instalacion previa posiblemente interrumpida (${LOCKFILE_INSTALACION} con formato invalido). Continuando.\n`,
    );
    return;
  }

  const backendPrevio = previo && previo.backend ? previo.backend : 'desconocido';
  const timestampPrevio = previo && previo.timestamp ? previo.timestamp : 'desconocido';
  const avisoBackend = backendPrevio !== backend
    ? `backend anterior: ${backendPrevio}, ahora: ${backend}`
    : `backend: ${backendPrevio}`;
  process.stderr.write(
    `Instalacion previa interrumpida detectada (${timestampPrevio}, ${avisoBackend}). Continuando.\n`,
  );
}

/** Archivos protegidos que caen dentro de `ruta` (ella misma, o anidados si es un directorio). */
function protegidasEn(ruta) {
  return ARCHIVOS_PROTEGIDOS.filter(protegida => protegida === ruta || protegida.startsWith(`${ruta}/`));
}

/** Rutas (relativas a `dirAbsoluto`) de todos los archivos bajo un directorio, recursivo. */
function listarArchivos(dirAbsoluto) {
  const resultado = [];
  for (const entrada of fs.readdirSync(dirAbsoluto, { withFileTypes: true })) {
    const absoluta = path.join(dirAbsoluto, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArchivos(absoluta).map(relativa => `${entrada.name}/${relativa}`));
    } else {
      resultado.push(entrada.name);
    }
  }
  return resultado;
}

/**
 * Expande una ruta del manifiesto a sus archivos individuales: ella misma si
 * es un archivo, o su contenido recursivo (rutas relativas a PACKAGE_ROOT) si
 * es un directorio. Ruta ausente en el origen => []. Base de la proteccion
 * por hash generalizada: a diferencia de `protegidasEn`, no filtra contra
 * ARCHIVOS_PROTEGIDOS.
 */
function archivosDe(ruta) {
  const origen = path.join(PACKAGE_ROOT, ruta);
  if (!fs.existsSync(origen)) return [];
  if (!fs.statSync(origen).isDirectory()) return [ruta];
  return listarArchivos(origen).map(relativa => `${ruta}/${relativa}`);
}

/**
 * Rutas del manifiesto que ya existen en DEST y se sobrescribirian si se
 * copiara ahora, excluyendo las cubiertas por ARCHIVOS_PROTEGIDOS (su propia
 * proteccion por hash-sidecar ya es suficiente). Si una ruta del manifiesto
 * es un directorio, se expande a sus archivos individuales: el directorio
 * puede existir en destino sin que ningun archivo de dentro colisione.
 */
function detectarColisiones(rutas) {
  const colisiones = [];
  for (const ruta of rutas) {
    const origen = path.join(PACKAGE_ROOT, ruta);
    if (!fs.existsSync(origen)) continue;
    if (!fs.statSync(origen).isDirectory()) {
      if (!ARCHIVOS_PROTEGIDOS.includes(ruta) && fs.existsSync(path.join(DEST, ruta))) colisiones.push(ruta);
      continue;
    }
    for (const relativa of listarArchivos(origen)) {
      const completa = `${ruta}/${relativa}`;
      if (ARCHIVOS_PROTEGIDOS.includes(completa)) continue;
      if (fs.existsSync(path.join(DEST, completa))) colisiones.push(completa);
    }
  }
  return colisiones;
}

/**
 * Preflight de colision: si hay archivos no protegidos que se sobrescribirian,
 * pide confirmacion interactiva (TTY, default N => cancela) o aborta con
 * exit 1 en modo no interactivo (pipe/CI). Mismo patron TTY/no-TTY que
 * `preguntarBackend`. Sin colisiones, no hace nada.
 */
async function confirmarColisiones(colisiones) {
  if (!colisiones.length) return;
  if (!process.stdin.isTTY) {
    process.stderr.write(`Hay ${colisiones.length} archivos que se sobrescribirian:\n`);
    colisiones.forEach(ruta => process.stderr.write(`  - ${ruta}\n`));
    process.stderr.write('Usa --force para continuar sin confirmacion.\n');
    process.exit(1);
  }
  console.log(`Archivos que se sobrescribirian: ${colisiones.length}`);
  colisiones.forEach(ruta => console.log(`  - ${ruta}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = (await rl.question('Continuar? Estos archivos se sobrescribiran. (y/N): ')).trim().toLowerCase();
  rl.close();
  if (respuesta !== 'y') {
    console.log('Instalacion cancelada.');
    process.exit(0);
  }
}

/**
 * true si el destino ya existe con contenido que no coincide con el ultimo
 * hash instalado. Si el sidecar no tiene entrada para esta ruta (instalacion
 * anterior a su introduccion), compara contra el hash del archivo de origen:
 * si coinciden, no hay edicion local (siembra la entrada en el sidecar);
 * si difieren -- o el origen ya no existe -- se protege por defecto.
 */
function editadaLocalmente(rutaRelativa, hashesInstalados) {
  const hashActual = hashFile(path.join(DEST, rutaRelativa));
  if (hashActual === null) return false;
  if (hashesInstalados[rutaRelativa] === undefined) {
    const hashOrigen = hashFile(path.join(PACKAGE_ROOT, rutaRelativa));
    if (hashOrigen === null || hashOrigen !== hashActual) return true;
    hashesInstalados[rutaRelativa] = hashActual;
    return false;
  }
  return hashesInstalados[rutaRelativa] !== hashActual;
}

/**
 * Copia una ruta del manifiesto, saltando los archivos con ediciones locales.
 * Con `generalizado` (solo `update`) la proteccion por hash cubre TODOS los
 * archivos que produciria copiar `ruta`; sin el (solo `install`), se limita a
 * ARCHIVOS_PROTEGIDOS -- una colision con otro archivo en `install` ya la
 * resuelve el preflight (confirmacion o --force). Con `resetProtected` la
 * proteccion se ignora por completo para este run (el usuario eligio
 * explicitamente sobrescribir). Con `dryRun` no se escribe nada en disco: se
 * reporta por consola lo que habria pasado y se retorna el mismo resultado
 * que produciria el run real.
 */
function copiarRuta(ruta, hashesInstalados, saltadasPorEdicion, resetProtected, dryRun, generalizado) {
  const origen = path.join(PACKAGE_ROOT, ruta);
  if (!fs.existsSync(origen)) {
    return { ruta, copiada: false };
  }
  const destino = path.join(DEST, ruta);

  const candidatas = generalizado ? archivosDe(ruta) : protegidasEn(ruta);
  const editadas = resetProtected
    ? []
    : candidatas.filter(archivo => editadaLocalmente(archivo, hashesInstalados));
  editadas.forEach(archivo => saltadasPorEdicion.push(archivo));

  const esDirectorio = fs.statSync(origen).isDirectory();

  if (!esDirectorio && editadas.includes(ruta)) {
    if (dryRun) console.log(`[DRY-RUN] saltaria (editada localmente): ${ruta}`);
    return { ruta, copiada: false };
  }

  if (dryRun) {
    const etiqueta = fs.existsSync(destino) ? 'copiaria' : 'nuevo';
    console.log(`[DRY-RUN] ${etiqueta}: ${ruta}`);
    return { ruta, copiada: true };
  }

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (esDirectorio) {
    fs.cpSync(origen, destino, {
      recursive: true,
      filter: origenEntrada => {
        const relativa = path.relative(PACKAGE_ROOT, origenEntrada).split(path.sep).join('/');
        return !editadas.includes(relativa);
      },
    });
    return { ruta, copiada: true };
  }

  fs.copyFileSync(origen, destino);
  return { ruta, copiada: true };
}

/**
 * Recalcula y persiste en el sidecar los hashes de TODOS los archivos
 * copiados en este run (no solo ARCHIVOS_PROTEGIDOS), para que `update`
 * disponga de una linea base de comparacion completa la proxima vez. Se
 * ejecuta igual en `install` y `update`: sembrar el hash no cambia el
 * comportamiento de `install` (que solo consulta ARCHIVOS_PROTEGIDOS), pero
 * deja lista la cobertura generalizada para el primer `update` posterior.
 */
function actualizarHashesInstalados(hashesInstalados, rutas, saltadasPorEdicion) {
  const hashesActualizados = { ...hashesInstalados };
  const archivosEnAlcance = rutas.flatMap(archivosDe);
  for (const archivo of archivosEnAlcance) {
    if (saltadasPorEdicion.includes(archivo)) continue;
    const hashActual = hashFile(path.join(DEST, archivo));
    if (hashActual !== null) hashesActualizados[archivo] = hashActual;
  }
  saveInstalledHashes(DEST, hashesActualizados);
}

/**
 * Anade `scripts.test` al package.json del destino sin tocar ninguna otra
 * clave (nombre, dependencias, otros scripts). Si el destino no tiene
 * package.json, crea uno minimo con solo `scripts.test`. Si el destino ya
 * tiene su propio `scripts.test`, no se toca: el usuario controla su test
 * runner. Retorna true si escribio el archivo (fuera de dry-run).
 */
function mergeScriptsTest(dryRun) {
  const destino = path.join(DEST, 'package.json');
  const existe = fs.existsSync(destino);

  let pkg = {};
  if (existe) {
    try {
      pkg = JSON.parse(fs.readFileSync(destino, 'utf8'));
    } catch (err) {
      process.stderr.write(`No se pudo leer package.json (JSON invalido), se omite: ${err.message}\n`);
      return false;
    }
  }

  if (pkg.scripts && pkg.scripts.test) return false;

  if (dryRun) {
    console.log(existe
      ? '[DRY-RUN] anaderia scripts.test a package.json'
      : '[DRY-RUN] crearia package.json con scripts.test');
    return false;
  }

  pkg.scripts = { ...pkg.scripts, test: SCRIPTS_TEST };
  fs.writeFileSync(destino, JSON.stringify(pkg, null, 2));
  return true;
}

function crearDirectoriosDelProyecto() {
  const creados = [];
  for (const dir of DIRS_DEL_PROYECTO) {
    const destino = path.join(DEST, dir);
    if (!fs.existsSync(destino)) {
      fs.mkdirSync(destino, { recursive: true });
      creados.push(dir);
    }
  }
  return creados;
}

async function preguntarBackend() {
  if (!process.stdin.isTTY) {
    process.stderr.write('Indica el backend con --backend <nombre>. El prompt interactivo requiere un terminal.\n');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Que backend quieres instalar?');
  BACKENDS_VALIDOS.forEach((backend, indice) => console.log(`  ${indice + 1}. ${backend}`));
  const respuesta = (await rl.question('Backend (nombre o numero): ')).trim();
  rl.close();
  const porNumero = BACKENDS_VALIDOS[Number(respuesta) - 1];
  return porNumero || respuesta;
}

/** Resuelve y valida el backend desde --backend o, en su ausencia, por prompt interactivo. */
async function resolverBackend(args) {
  let backend = parseFlag(args, '--backend');
  if (backend === undefined) {
    backend = await preguntarBackend();
  }
  if (!BACKENDS_VALIDOS.includes(backend)) {
    process.stderr.write(`Backend invalido: '${backend}'. Backends validos: ${BACKENDS_VALIDOS.join(', ')}.\n`);
    process.exit(1);
  }
  return backend;
}

function cargarManifest() {
  const manifestPath = path.join(PACKAGE_ROOT, 'scripts', 'backend-manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/**
 * Preflight ejecutado antes de copiar: detecta colisiones con el manifiesto
 * del backend elegido y pide confirmacion (o aborta en no-TTY). `--dry-run`
 * y `--force` lo saltan por completo (dry-run nunca escribe; force asume la
 * confirmacion).
 */
async function ejecutarPreflight(backend, skip, dryRun, force) {
  if (dryRun || force) return;
  const rutas = rutasParaBackend(cargarManifest(), backend, skip);
  await confirmarColisiones(detectarColisiones(rutas));
}

/**
 * Copia las rutas del backend elegido segun el manifiesto. Comun a install y
 * update. Con `opciones.dryRun` no escribe nada en disco (ni copias ni
 * directorios de usuario ni sidecar de hashes): solo calcula y reporta.
 */
function copiarRutasFramework(backend, skip, opciones = {}) {
  const manifest = cargarManifest();
  advertirSiSkipNoAplica(backend, skip);
  const rutas = rutasParaBackend(manifest, backend, skip);

  const hashesInstalados = loadInstalledHashes(DEST);
  const saltadasPorEdicion = [];

  // El lockfile se crea antes de copiar y se borra solo tras completar. Si
  // `copiarRuta` lanza a mitad, la excepcion se propaga sin pasar por la
  // linea de borrado: el lockfile queda en disco como senal de instalacion
  // interrumpida, y `main().catch` reporta el fallo con codigo distinto de 0.
  if (!opciones.dryRun) crearLockfileInstalacion(backend);
  const resultados = rutas.map(ruta =>
    copiarRuta(ruta, hashesInstalados, saltadasPorEdicion, opciones.resetProtected, opciones.dryRun, opciones.generalizado),
  );
  const copiadas = resultados.filter(r => r.copiada).map(r => r.ruta);
  const saltadas = resultados
    .filter(r => !r.copiada && !saltadasPorEdicion.includes(r.ruta))
    .map(r => r.ruta);
  const creados = opciones.crearDirsUsuario && !opciones.dryRun ? crearDirectoriosDelProyecto() : [];

  if (!opciones.dryRun) {
    actualizarHashesInstalados(hashesInstalados, rutas, saltadasPorEdicion);
    eliminarLockfileInstalacion();
  }

  return { copiadas, saltadas, creados, saltadasPorEdicion };
}

/** Sustituye el marcador de version en `archivo` por `version`. Retorna true si hubo cambio. */
function actualizarMarcador(archivo, version) {
  if (!fs.existsSync(archivo)) return false;
  const contenido = fs.readFileSync(archivo, 'utf8');
  const actualizado = contenido.replace(/<!-- sdd-framework: .+? -->/g, `<!-- sdd-framework: ${version} -->`);
  if (actualizado === contenido) return false;
  fs.writeFileSync(archivo, actualizado);
  return true;
}

/**
 * Sincroniza el marcador de version en los archivos de contexto que SI se
 * copiaron. Estos archivos son ademas protegidos (ARCHIVOS_PROTEGIDOS): si
 * el marcador cambia, su hash en el sidecar se refresca en el mismo paso
 * para que la reescritura no se confunda con una edicion local del usuario
 * en la proxima ejecucion.
 */
function sincronizarMarcadores(backend, copiadas, version) {
  const archivos = backend === 'all'
    ? [...new Set(Object.values(ARCHIVO_CONTEXTO_POR_BACKEND))]
    : [ARCHIVO_CONTEXTO_POR_BACKEND[backend]].filter(Boolean);

  const hashesInstalados = loadInstalledHashes(DEST);
  let sidecarDesactualizado = false;

  for (const archivo of archivos) {
    if (!copiadas.includes(archivo)) continue;
    try {
      const destino = path.join(DEST, archivo);
      if (!actualizarMarcador(destino, version)) continue;
      hashesInstalados[archivo] = hashFile(destino);
      sidecarDesactualizado = true;
    } catch (err) {
      process.stderr.write(`No se pudo actualizar el marcador de version en ${archivo}: ${err.message}\n`);
    }
  }

  if (sidecarDesactualizado) saveInstalledHashes(DEST, hashesInstalados);
}

function reportarArchivosProtegidos(saltadasPorEdicion) {
  if (!saltadasPorEdicion.length) return;
  console.log('Archivos con cambios locales, no se sobrescribieron (revisa el diff manualmente):');
  saltadasPorEdicion.forEach(ruta => console.log(`  - ${ruta}`));
}

function reportarInstalacion(copiadas, saltadas, creados, saltadasPorEdicion, scriptsTestMergeado, backend) {
  if (copiadas.length) {
    console.log('Rutas copiadas:');
    copiadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  if (saltadas.length) {
    console.log('Rutas saltadas (no existen en el origen):');
    saltadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  reportarArchivosProtegidos(saltadasPorEdicion);
  if (creados.length) {
    console.log('Directorios creados:');
    creados.forEach(dir => console.log(`  - ${dir}`));
  }
  if (scriptsTestMergeado) {
    console.log('Anadido scripts.test a package.json para correr los tests de los hooks.');
  }
  if (backend === 'claude' || backend === 'all') {
    console.log('Nota: .claude/settings.json configura claude-opus-4-8 como modelo de sesion (tier capaz, precio alto). Cambialo con /model o editando settings.json.');
  }
  console.log("Framework instalado. Configura ai_docs/core/ con las plantillas de ai_docs/core_templates/. Ejecuta 'npm test' para verificar los hooks.");
}

function reportarActualizacion(copiadas, saltadas, saltadasPorEdicion, version, scriptsTestMergeado) {
  if (copiadas.length) {
    console.log('Rutas actualizadas:');
    copiadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  if (saltadas.length) {
    console.log('Rutas saltadas (no existen en el origen):');
    saltadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  reportarArchivosProtegidos(saltadasPorEdicion);
  if (scriptsTestMergeado) {
    console.log('Anadido scripts.test a package.json para correr los tests de los hooks.');
  }
  console.log(`Framework actualizado a la version ${version}. Rutas del proyecto (ai_docs/core/, ai_docs/tasks/, ai_docs/refs/) no se han tocado. Ejecuta 'npm test' para verificar los hooks.`);
}

async function cmdInstall(args) {
  const backend = await resolverBackend(args);
  const skip = parseSkip(args);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  advertirSiBackendEquivocado(backend);
  advertirSiGeminiLayoutAntiguo(backend);
  advertirSiInstalacionInterrumpida(backend);
  await ejecutarPreflight(backend, skip, dryRun, force);
  const { copiadas, saltadas, creados, saltadasPorEdicion } = copiarRutasFramework(backend, skip, {
    crearDirsUsuario: true,
    dryRun,
  });
  const scriptsTestMergeado = mergeScriptsTest(dryRun);
  if (!dryRun) sincronizarMarcadores(backend, copiadas, obtenerVersion());
  reportarInstalacion(copiadas, saltadas, creados, saltadasPorEdicion, scriptsTestMergeado, backend);
}

async function cmdUpdate(args) {
  const backend = await resolverBackend(args);
  const skip = parseSkip(args);
  const resetProtected = args.includes('--reset-protected');
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  advertirSiBackendEquivocado(backend);
  advertirSiGeminiLayoutAntiguo(backend);
  advertirSiInstalacionInterrumpida(backend);
  await ejecutarPreflight(backend, skip, dryRun, force);
  const { copiadas, saltadas, saltadasPorEdicion } = copiarRutasFramework(backend, skip, {
    crearDirsUsuario: false,
    resetProtected,
    dryRun,
    generalizado: true,
  });
  const scriptsTestMergeado = mergeScriptsTest(dryRun);
  const version = obtenerVersion();
  if (!dryRun) sincronizarMarcadores(backend, copiadas, version);
  reportarActualizacion(copiadas, saltadas, saltadasPorEdicion, version, scriptsTestMergeado);
}

async function main() {
  const [subcomando, ...resto] = process.argv.slice(2);

  if (!subcomando) {
    mostrarAyuda();
    return;
  }
  if (subcomando === '--help' || subcomando === '-h') {
    mostrarAyuda();
    return;
  }
  if (subcomando === '--version' || subcomando === '-v') {
    console.log(obtenerVersion());
    return;
  }
  if (subcomando === 'install') {
    if (resto.includes('--help') || resto.includes('-h')) {
      mostrarAyudaInstall();
      return;
    }
    await cmdInstall(resto);
    return;
  }
  if (subcomando === 'update') {
    if (resto.includes('--help') || resto.includes('-h')) {
      mostrarAyudaUpdate();
      return;
    }
    await cmdUpdate(resto);
    return;
  }

  process.stderr.write(`Subcomando '${subcomando}' no reconocido. Subcomandos validos: install, update, --help, --version.\n`);
  process.exit(1);
}

main().catch(err => {
  process.stderr.write(`Error inesperado: ${err.message}\n`);
  process.exit(1);
});

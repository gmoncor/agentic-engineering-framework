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

// Archivos que el usuario personaliza tras instalar (umbrales, permisos,
// hooks propios) y que `update` no debe pisar si detecta ediciones locales.
const ARCHIVO_SIDECAR_HASHES = '.sdd-installed-hashes.json';
const ARCHIVOS_PROTEGIDOS = ['hooks/config.json', '.claude/settings.json', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];

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
  console.log(`Uso: agentic-engineering-framework install --backend <claude|gemini|codex|antigravity|all> [--skip <nombre,nombre>]

Instala el framework en el directorio actual: copia las rutas del backend elegido y crea ai_docs/{core,tasks,refs}/ si no existen.

Si se omite --backend, se muestra un menu interactivo para elegir (requiere terminal; en pipe/CI, falla con mensaje claro).
--skip omite componentes opcionales (asesor, auditar, bugfix, cleanup, testing, pr); solo aplica al backend claude.`);
}

function mostrarAyudaUpdate() {
  console.log(`Uso: agentic-engineering-framework update --backend <claude|gemini|codex|antigravity|all> [--skip <nombre,nombre>]

Actualiza el framework instalado en el directorio actual: copia las rutas del backend elegido sin tocar ai_docs/core/, ai_docs/tasks/ ni ai_docs/refs/.

Si se omite --backend, se muestra un menu interactivo para elegir (requiere terminal; en pipe/CI, falla con mensaje claro).
--skip omite componentes opcionales (asesor, auditar, bugfix, cleanup, testing, pr); solo aplica al backend claude.`);
}

function obtenerVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function parseFlag(args, flag) {
  const indice = args.indexOf(flag);
  return indice === -1 ? undefined : args[indice + 1];
}

/** Si una ruta es subdirectorio de otra ya incluida, descarta la mas especifica. */
function deduplicarRutas(rutas) {
  const ordenadas = [...new Set(rutas)].sort((a, b) => a.length - b.length);
  const resultado = [];
  for (const ruta of ordenadas) {
    const yaCubierta = resultado.some(base => ruta === base || ruta.startsWith(`${base}/`));
    if (!yaCubierta) resultado.push(ruta);
  }
  return resultado;
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

/** SHA-256 hexadecimal del contenido de un archivo, o null si no existe. */
function hashFile(rutaAbsoluta) {
  if (!fs.existsSync(rutaAbsoluta)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(rutaAbsoluta)).digest('hex');
}

/** Lee el sidecar de hashes instalados del destino. JSON ausente o invalido => {}. */
function loadInstalledHashes(dest) {
  const sidecarPath = path.join(dest, ARCHIVO_SIDECAR_HASHES);
  if (!fs.existsSync(sidecarPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch {
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

/** Archivos protegidos que caen dentro de `ruta` (ella misma, o anidados si es un directorio). */
function protegidasEn(ruta) {
  return ARCHIVOS_PROTEGIDOS.filter(protegida => protegida === ruta || protegida.startsWith(`${ruta}/`));
}

/** true si el destino ya existe con contenido que no coincide con el ultimo hash instalado. */
function editadaLocalmente(rutaRelativa, hashesInstalados) {
  const hashActual = hashFile(path.join(DEST, rutaRelativa));
  if (hashActual === null) return false;
  return hashesInstalados[rutaRelativa] !== hashActual;
}

/** Copia una ruta del manifiesto, saltando los archivos protegidos con ediciones locales. */
function copiarRuta(ruta, hashesInstalados, saltadasPorEdicion) {
  const origen = path.join(PACKAGE_ROOT, ruta);
  if (!fs.existsSync(origen)) {
    return { ruta, copiada: false };
  }
  const destino = path.join(DEST, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  const editadas = protegidasEn(ruta).filter(protegida => editadaLocalmente(protegida, hashesInstalados));
  editadas.forEach(protegida => saltadasPorEdicion.push(protegida));

  if (fs.statSync(origen).isDirectory()) {
    fs.cpSync(origen, destino, {
      recursive: true,
      filter: origenEntrada => {
        const relativa = path.relative(PACKAGE_ROOT, origenEntrada).split(path.sep).join('/');
        return !editadas.includes(relativa);
      },
    });
    return { ruta, copiada: true };
  }

  if (editadas.includes(ruta)) {
    return { ruta, copiada: false };
  }
  fs.copyFileSync(origen, destino);
  return { ruta, copiada: true };
}

/** Recalcula y persiste los hashes de los archivos protegidos copiados sin saltar en este run. */
function actualizarHashesInstalados(hashesInstalados, rutas, saltadasPorEdicion) {
  const hashesActualizados = { ...hashesInstalados };
  const protegidasEnAlcance = rutas.flatMap(protegidasEn);
  for (const protegida of protegidasEnAlcance) {
    if (saltadasPorEdicion.includes(protegida)) continue;
    if (!fs.existsSync(path.join(PACKAGE_ROOT, protegida))) continue;
    const hashActual = hashFile(path.join(DEST, protegida));
    if (hashActual !== null) hashesActualizados[protegida] = hashActual;
  }
  saveInstalledHashes(DEST, hashesActualizados);
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

/** Copia las rutas del backend elegido segun el manifiesto. Comun a install y update. */
function copiarRutasFramework(backend, skip, opciones = {}) {
  const manifestPath = path.join(PACKAGE_ROOT, 'scripts', 'backend-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  advertirSiSkipNoAplica(backend, skip);
  const rutas = rutasParaBackend(manifest, backend, skip);

  const hashesInstalados = loadInstalledHashes(DEST);
  const saltadasPorEdicion = [];
  const resultados = rutas.map(ruta => copiarRuta(ruta, hashesInstalados, saltadasPorEdicion));
  const copiadas = resultados.filter(r => r.copiada).map(r => r.ruta);
  const saltadas = resultados
    .filter(r => !r.copiada && !saltadasPorEdicion.includes(r.ruta))
    .map(r => r.ruta);
  const creados = opciones.crearDirsUsuario ? crearDirectoriosDelProyecto() : [];

  actualizarHashesInstalados(hashesInstalados, rutas, saltadasPorEdicion);

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

function reportarInstalacion(copiadas, saltadas, creados, saltadasPorEdicion) {
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
  console.log("Framework instalado. Configura ai_docs/core/ con las plantillas de ai_docs/core_templates/. Ejecuta 'npm test' para verificar los hooks.");
}

function reportarActualizacion(copiadas, saltadas, saltadasPorEdicion, version) {
  if (copiadas.length) {
    console.log('Rutas actualizadas:');
    copiadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  if (saltadas.length) {
    console.log('Rutas saltadas (no existen en el origen):');
    saltadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  reportarArchivosProtegidos(saltadasPorEdicion);
  console.log(`Framework actualizado a la version ${version}. Rutas del proyecto (ai_docs/core/, ai_docs/tasks/, ai_docs/refs/) no se han tocado. Ejecuta 'npm test' para verificar los hooks.`);
}

async function cmdInstall(args) {
  const backend = await resolverBackend(args);
  const skip = parseSkip(args);
  const { copiadas, saltadas, creados, saltadasPorEdicion } = copiarRutasFramework(backend, skip, { crearDirsUsuario: true });
  sincronizarMarcadores(backend, copiadas, obtenerVersion());
  reportarInstalacion(copiadas, saltadas, creados, saltadasPorEdicion);
}

async function cmdUpdate(args) {
  const backend = await resolverBackend(args);
  const skip = parseSkip(args);
  const { copiadas, saltadas, saltadasPorEdicion } = copiarRutasFramework(backend, skip, { crearDirsUsuario: false });
  const version = obtenerVersion();
  sincronizarMarcadores(backend, copiadas, version);
  reportarActualizacion(copiadas, saltadas, saltadasPorEdicion, version);
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

  mostrarAyuda();
}

main().catch(err => {
  process.stderr.write(`Error inesperado: ${err.message}\n`);
  process.exit(1);
});

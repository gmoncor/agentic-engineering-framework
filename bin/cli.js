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
const readline = require('node:readline/promises');

const PACKAGE_ROOT = process.env.SDD_FRAMEWORK_ROOT
  ? path.resolve(process.env.SDD_FRAMEWORK_ROOT)
  : path.resolve(__dirname, '..');
const DEST = process.cwd();

const BACKENDS_VALIDOS = ['claude', 'gemini', 'codex', 'antigravity', 'all'];
const DIRS_DEL_PROYECTO = ['ai_docs/core', 'ai_docs/tasks', 'ai_docs/refs'];

function mostrarAyuda() {
  console.log(`Uso: agentic-engineering-framework <subcomando> [opciones]

Subcomandos:
  install --backend <claude|gemini|codex|antigravity|all>   Instala el framework en el directorio actual.
  update --backend <claude|gemini|codex|antigravity|all>    Actualiza el framework instalado, sin tocar ai_docs/core/, ai_docs/tasks/ ni ai_docs/refs/.
  --help                                                     Muestra esta ayuda.
  --version                                                  Muestra la version instalada.

Ejemplos:
  npx github:gmoncor/agentic-engineering-framework install --backend claude
  npx github:gmoncor/agentic-engineering-framework update --backend claude`);
}

function mostrarAyudaInstall() {
  console.log(`Uso: agentic-engineering-framework install --backend <claude|gemini|codex|antigravity|all>

Instala el framework en el directorio actual: copia las rutas del backend elegido y crea ai_docs/{core,tasks,refs}/ si no existen.`);
}

function mostrarAyudaUpdate() {
  console.log(`Uso: agentic-engineering-framework update --backend <claude|gemini|codex|antigravity|all>

Actualiza el framework instalado en el directorio actual: copia las rutas del backend elegido sin tocar ai_docs/core/, ai_docs/tasks/ ni ai_docs/refs/.`);
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

function rutasParaBackend(manifest, backend) {
  const rutas = backend === 'all'
    ? Object.values(manifest).flat()
    : [...manifest.common, ...(manifest[backend] || [])];
  return deduplicarRutas(rutas);
}

function copiarRuta(ruta) {
  const origen = path.join(PACKAGE_ROOT, ruta);
  if (!fs.existsSync(origen)) {
    return { ruta, copiada: false };
  }
  const destino = path.join(DEST, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (fs.statSync(origen).isDirectory()) {
    fs.cpSync(origen, destino, { recursive: true });
  } else {
    fs.copyFileSync(origen, destino);
  }
  return { ruta, copiada: true };
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
function copiarRutasFramework(backend, opciones = {}) {
  const manifestPath = path.join(PACKAGE_ROOT, 'scripts', 'backend-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rutas = rutasParaBackend(manifest, backend);

  const resultados = rutas.map(copiarRuta);
  const copiadas = resultados.filter(r => r.copiada).map(r => r.ruta);
  const saltadas = resultados.filter(r => !r.copiada).map(r => r.ruta);
  const creados = opciones.crearDirsUsuario ? crearDirectoriosDelProyecto() : [];

  return { copiadas, saltadas, creados };
}

function reportarInstalacion(copiadas, saltadas, creados) {
  if (copiadas.length) {
    console.log('Rutas copiadas:');
    copiadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  if (saltadas.length) {
    console.log('Rutas saltadas (no existen en el origen):');
    saltadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  if (creados.length) {
    console.log('Directorios creados:');
    creados.forEach(dir => console.log(`  - ${dir}`));
  }
  console.log("Framework instalado. Configura ai_docs/core/ con las plantillas de ai_docs/core_templates/. Ejecuta 'npm test' para verificar los hooks.");
}

function reportarActualizacion(copiadas, saltadas, version) {
  if (copiadas.length) {
    console.log('Rutas actualizadas:');
    copiadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  if (saltadas.length) {
    console.log('Rutas saltadas (no existen en el origen):');
    saltadas.forEach(ruta => console.log(`  - ${ruta}`));
  }
  console.log(`Framework actualizado desde version ${version}. Rutas del proyecto (ai_docs/core/, ai_docs/tasks/, ai_docs/refs/) no se han tocado. Ejecuta 'npm test' para verificar los hooks.`);
}

async function cmdInstall(args) {
  const backend = await resolverBackend(args);
  const { copiadas, saltadas, creados } = copiarRutasFramework(backend, { crearDirsUsuario: true });
  reportarInstalacion(copiadas, saltadas, creados);
}

async function cmdUpdate(args) {
  const backend = await resolverBackend(args);
  const { copiadas, saltadas } = copiarRutasFramework(backend, { crearDirsUsuario: false });
  reportarActualizacion(copiadas, saltadas, obtenerVersion());
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

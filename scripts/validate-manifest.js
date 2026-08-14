'use strict';

// Valida `scripts/artifact-manifest.json` contra el disco: cada `source`
// declarado debe existir, cada `output.path` debe existir (salvo que declare
// `status: "pending"`), ningun `output.path` puede repetirse entre entradas,
// y ningun fichero de `.gemini/`, `.codex/` o `.agents/` puede quedar fuera
// del manifiesto (huerfano). Se usa como CLI (`node scripts/validate-manifest.js`)
// y como funcion exportable para tests.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'artifact-manifest.json');
const DIRECTORIOS_BACKEND = ['.gemini', '.codex', '.agents'];
const TRANSFORMS_PRESERVE_PERMITIDOS = new Set(['identity', 'none']);

function cargarManifiesto(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/** Lista recursivamente todos los ficheros (no directorios) bajo `dir`, relativos a `raiz`. */
function listarArchivos(dir, raiz) {
  if (!fs.existsSync(dir)) return [];

  const resultado = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const rutaCompleta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArchivos(rutaCompleta, raiz));
    } else if (entrada.isFile()) {
      resultado.push(path.relative(raiz, rutaCompleta).split(path.sep).join('/'));
    }
  }
  return resultado;
}

/** Valida el manifiesto contra `raiz` y devuelve la lista de mensajes de error (vacia si pasa). */
function validarManifiesto(manifest, raiz = RAIZ) {
  const errores = [];
  const outputsVistos = new Map();

  for (const artefacto of manifest.artifacts) {
    if (!fs.existsSync(path.join(raiz, artefacto.source))) {
      errores.push(`SOURCE_NOT_FOUND: "${artefacto.source}" declarado en "${artefacto.id}" no existe en disco.`);
    }

    if (artefacto.mode === 'preserve' && !TRANSFORMS_PRESERVE_PERMITIDOS.has(artefacto.transform)) {
      errores.push(
        `INVALID_PRESERVE_TRANSFORM: "${artefacto.id}" es mode:"preserve" pero declara `
          + `transform:"${artefacto.transform}" (debe ser "identity" o "none").`
      );
    }

    for (const salida of artefacto.outputs || []) {
      if (salida.status !== 'pending' && !fs.existsSync(path.join(raiz, salida.path))) {
        errores.push(`OUTPUT_NOT_FOUND: "${salida.path}" declarado en "${artefacto.id}" no existe en disco.`);
      }

      if (outputsVistos.has(salida.path)) {
        errores.push(
          `DUPLICATE_OUTPUT: "${salida.path}" declarado en "${artefacto.id}" y en `
            + `"${outputsVistos.get(salida.path)}".`
        );
      } else {
        outputsVistos.set(salida.path, artefacto.id);
      }
    }
  }

  for (const dirBackend of DIRECTORIOS_BACKEND) {
    for (const archivo of listarArchivos(path.join(raiz, dirBackend), raiz)) {
      if (!outputsVistos.has(archivo)) {
        errores.push(`ORPHAN_ARTIFACT: "${archivo}" no aparece como output en ninguna entrada del manifiesto.`);
      }
    }
  }

  return errores;
}

function main() {
  const manifest = cargarManifiesto();
  const errores = validarManifiesto(manifest);

  if (errores.length > 0) {
    console.error(`Manifiesto invalido: ${errores.length} error(es).`);
    for (const error of errores) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Manifiesto valido: ${manifest.artifacts.length} artefactos verificados contra disco.`);
}

if (require.main === module) {
  main();
}

module.exports = { cargarManifiesto, validarManifiesto, listarArchivos, RAIZ, MANIFEST_PATH };

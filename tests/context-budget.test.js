'use strict';

// Presupuesto de contexto de los documentos de instrucciones raiz: cada backend
// carga el suyo entero al abrir sesion, asi que su tamano es coste fijo que se
// paga antes de la primera instruccion del usuario.
//
// Se miden DOS ejes porque ninguno basta solo: un documento puede ganar bytes
// sin ganar lineas (tablas anchas, parrafos largos) y al reves. Las rutas salen
// del manifiesto de artefactos, no de una lista fija aqui: los documentos son
// salidas generadas, y si cambia su destino el test sigue al manifiesto solo.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cargarManifiesto, RAIZ } = require('../scripts/validate-manifest');

const MAX_LINEAS = 300;
const MAX_BYTES = 25600;
const TRANSFORM_INSTRUCCIONES = 'doc-fragment-assembly';

/** Rutas de los documentos de instrucciones raiz declaradas en el manifiesto. */
function documentosRaiz(manifest = cargarManifiesto()) {
  return manifest.artifacts
    .filter((artefacto) => artefacto.transform === TRANSFORM_INSTRUCCIONES)
    .flatMap((artefacto) => (artefacto.outputs || []).map((salida) => salida.path));
}

// Cuenta igual que `wc -l` cuando el fichero cierra en salto de linea, y suma la
// ultima linea cuando no cierra, para no reportar de menos.
function medir(contenido) {
  const lineas = contenido.split('\n');
  if (lineas[lineas.length - 1] === '') lineas.pop();
  return { lineas: lineas.length, bytes: Buffer.byteLength(contenido, 'utf8') };
}

/**
 * Mide `ruta` contra el presupuesto. Devuelve `medida` (null si el fichero no
 * existe) y `fallos`, la lista de incumplimientos, vacia cuando cabe.
 */
function evaluar(ruta, raiz = RAIZ) {
  const completa = path.join(raiz, ruta);
  if (!fs.existsSync(completa)) return { medida: null, fallos: [`FILE_NOT_FOUND: ${ruta}`] };

  const medida = medir(fs.readFileSync(completa, 'utf8'));
  const fallos = [];
  if (medida.lineas > MAX_LINEAS) {
    fallos.push(`LINE_BUDGET_EXCEEDED: ${ruta} tiene ${medida.lineas} lineas (maximo ${MAX_LINEAS}).`);
  }
  if (medida.bytes > MAX_BYTES) {
    fallos.push(`BYTE_BUDGET_EXCEEDED: ${ruta} tiene ${medida.bytes} bytes (maximo ${MAX_BYTES}).`);
  }
  return { medida, fallos };
}

function escribirFixture(contenido, nombre = 'DOC.md') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-budget-'));
  fs.writeFileSync(path.join(base, nombre), contenido);
  return base;
}

test('el manifiesto declara los documentos de instrucciones raiz', () => {
  assert.ok(
    documentosRaiz().length >= 3,
    'sin documentos declarados el presupuesto no mediria nada y pasaria en vacio'
  );
});

test('cada documento de instrucciones raiz cabe en el presupuesto', (t) => {
  const fallos = [];

  for (const ruta of documentosRaiz()) {
    const resultado = evaluar(ruta);
    if (resultado.medida) {
      const { lineas, bytes } = resultado.medida;
      t.diagnostic(`${ruta}: ${lineas} lineas / ${bytes} bytes (maximo ${MAX_LINEAS} / ${MAX_BYTES})`);
    }
    fallos.push(...resultado.fallos);
  }

  assert.deepStrictEqual(fallos, []);
});

test('un documento ausente falla con FILE_NOT_FOUND, no con un error de lectura', () => {
  const base = escribirFixture('');

  assert.deepStrictEqual(evaluar('AUSENTE.md', base).fallos, ['FILE_NOT_FOUND: AUSENTE.md']);
});

test('el limite exacto de lineas cabe en presupuesto y una linea mas no', () => {
  const enElLimite = escribirFixture('x\n'.repeat(MAX_LINEAS));
  const pasado = escribirFixture('x\n'.repeat(MAX_LINEAS + 1));

  assert.deepStrictEqual(evaluar('DOC.md', enElLimite).fallos, []);
  assert.match(evaluar('DOC.md', pasado).fallos[0], /^LINE_BUDGET_EXCEEDED/);
});

test('pocas lineas con muchos bytes incumplen por el eje de bytes', () => {
  const base = escribirFixture(`${'x'.repeat(MAX_BYTES)}\ny\nz\n`);

  const { fallos } = evaluar('DOC.md', base);

  assert.strictEqual(fallos.length, 1);
  assert.match(fallos[0], /^BYTE_BUDGET_EXCEEDED/);
});

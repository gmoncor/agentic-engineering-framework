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

// ── Presupuesto por pila de rol ──────────────────────────────────────────────
//
// Un subagente no carga un documento suelto: carga el documento raíz de su
// backend, su fichero de agente y la plantilla que el workflow le manda leer.
// Esa pila es lo que paga cada despacho, y puede crecer por cualquiera de sus
// tres capas sin que el presupuesto por documento lo vea. Los workflows solo
// existen en el backend de Claude Code, así que la pila se mide allí.
//
// La pila no se declara a mano: cada llamada `agent(...)` de un workflow cierra
// con su `agentType`, y las plantillas que cita el tramo de código que la
// precede (desde el `agentType` anterior) son las que ese rol lee. Si un
// workflow pasa a mandar leer otra plantilla, la pila la recoge sola.
//
// Límite por rol: la pila más grande medida al fijarlo, más un margen del 15 %,
// redondeado hacia arriba al KB (1024 bytes):
//
//   rol           medida (bytes)  medida x 1,15  límite
//   asesor        16011           18412,65      18432 (18 KB)
//   implementador 26274           30215,10      30720 (30 KB)
//   planificador  45573           52408,95      53248 (52 KB)
//   revisor       33383           38390,45      38912 (38 KB)
//
// Subir un límite es una decisión: se vuelve a medir y se recalcula con la
// misma regla; no se ajusta la cifra hasta que pase.

const DOC_RAIZ_DE_LA_PILA = 'CLAUDE.md';
const DIR_AGENTES = '.claude/agents';
const DIR_WORKFLOWS = '.claude/workflows';
const MAX_BYTES_POR_PILA = {
  asesor: 18432,
  implementador: 30720,
  planificador: 53248,
  revisor: 38912
};

const MARCA_AGENTE = /agentType:\s*(['"])([a-z-]+)\1/g;
const CITA_PLANTILLA = /ai_docs\/(?:dev|core)_templates\/[a-z0-9_]+\.md/g;

/**
 * Despachos de un workflow: un elemento por `agentType`, con el rol y las
 * plantillas citadas en el tramo de código que lo precede.
 *
 * La atribución es por posición en el texto, no por análisis del programa, y
 * tiene límites: se pierden sin aviso una plantilla citada en un helper definido
 * después de su `agent()`, una cita dentro de `lib/` y una ruta construida con
 * una variable; y una mención dentro de un comentario cuenta como lectura. Si un
 * workflow adopta alguno de esos patrones, la medida deja de ser fiable y este
 * extractor debe cambiar con él.
 */
function despachosDe(codigo) {
  const despachos = [];
  let desde = 0;
  for (const marca of codigo.matchAll(MARCA_AGENTE)) {
    const tramo = codigo.slice(desde, marca.index);
    const plantillas = [...new Set(tramo.match(CITA_PLANTILLA) || [])].sort();
    despachos.push({ rol: marca[2], plantillas });
    desde = marca.index + marca[0].length;
  }
  return despachos;
}

function workflows(raiz = RAIZ) {
  return fs.readdirSync(path.join(raiz, DIR_WORKFLOWS))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(DIR_WORKFLOWS, f));
}

function bytesDe(ruta, raiz = RAIZ) {
  return fs.statSync(path.join(raiz, ruta)).size;
}

/**
 * Pila más grande por rol: { rol: { bytes, ficheros } }. Un rol que ningún
 * workflow manda a leer plantilla pesa su documento raíz y su agente.
 */
function pilasPorRol(raiz = RAIZ) {
  const pilas = {};
  const despachos = workflows(raiz).flatMap((w) => despachosDe(fs.readFileSync(path.join(raiz, w), 'utf8')));
  for (const { rol, plantillas } of despachos) {
    const ficheros = [DOC_RAIZ_DE_LA_PILA, `${DIR_AGENTES}/${rol}.md`, ...plantillas];
    const bytes = ficheros.reduce((suma, ruta) => suma + bytesDe(ruta, raiz), 0);
    if (!pilas[rol] || bytes > pilas[rol].bytes) pilas[rol] = { bytes, ficheros };
  }
  return pilas;
}

function fallosDePila(pilas, limites = MAX_BYTES_POR_PILA) {
  const fallos = [];
  for (const [rol, { bytes, ficheros }] of Object.entries(pilas)) {
    if (!(rol in limites)) {
      fallos.push(`STACK_BUDGET_MISSING: el rol ${rol} se despacha sin límite de pila declarado.`);
    } else if (bytes > limites[rol]) {
      fallos.push(`STACK_BUDGET_EXCEEDED: la pila de ${rol} (${ficheros.join(' + ')}) pesa ${bytes} bytes (máximo ${limites[rol]}).`);
    }
  }
  return fallos;
}

test('cada agentType de los workflows es un literal con fichero de agente', () => {
  for (const workflow of workflows()) {
    const codigo = fs.readFileSync(path.join(RAIZ, workflow), 'utf8');
    const usos = (codigo.match(/agentType:/g) || []).length;
    const roles = despachosDe(codigo).map((d) => d.rol);
    assert.strictEqual(roles.length, usos, `${workflow}: un agentType no literal escapa a la medida de la pila.`);
    for (const rol of roles) {
      assert.ok(fs.existsSync(path.join(RAIZ, DIR_AGENTES, `${rol}.md`)), `${workflow}: no existe el agente ${rol}.`);
    }
  }
});

test('los workflows mandan leer plantillas: la pila no se mide en vacío', () => {
  const conPlantilla = workflows()
    .flatMap((w) => despachosDe(fs.readFileSync(path.join(RAIZ, w), 'utf8')))
    .filter((d) => d.plantillas.length > 0);
  assert.ok(conPlantilla.length > 0, 'ningún despacho cita una plantilla: la extracción se ha roto');
});

test('la pila de cada rol cabe en su presupuesto', (t) => {
  const pilas = pilasPorRol();
  for (const [rol, { bytes, ficheros }] of Object.entries(pilas)) {
    t.diagnostic(`${rol}: ${bytes} bytes (${ficheros.join(' + ')}; máximo ${MAX_BYTES_POR_PILA[rol]})`);
  }
  assert.deepStrictEqual(Object.keys(pilas).sort(), Object.keys(MAX_BYTES_POR_PILA).sort());
  assert.deepStrictEqual(fallosDePila(pilas), []);
});

test('despachosDe atribuye al rol las plantillas citadas antes de su agentType', () => {
  const codigo = [
    "agent('Lee ai_docs/dev_templates/spec.md', { agentType: 'planificador' })",
    "agent('sin plantilla', { agentType: \"asesor\" })",
    "agent('Lee ai_docs/dev_templates/revisar_tarea.md y ai_docs/dev_templates/tareas.md', {",
    "  agentType: 'revisor' })"
  ].join('\n');

  assert.deepStrictEqual(despachosDe(codigo), [
    { rol: 'planificador', plantillas: ['ai_docs/dev_templates/spec.md'] },
    { rol: 'asesor', plantillas: [] },
    { rol: 'revisor', plantillas: ['ai_docs/dev_templates/revisar_tarea.md', 'ai_docs/dev_templates/tareas.md'] }
  ]);
});

test('una plantilla que crece por encima del margen pone en rojo la pila de su rol', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'context-budget-pila-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const ruta of [DOC_RAIZ_DE_LA_PILA, DIR_AGENTES, DIR_WORKFLOWS, 'ai_docs/dev_templates', 'ai_docs/core_templates']) {
    fs.cpSync(path.join(RAIZ, ruta), path.join(base, ruta), { recursive: true });
  }
  const [rol, pila] = Object.entries(pilasPorRol(base)).find(([, p]) => p.ficheros.length > 2);
  assert.deepStrictEqual(fallosDePila({ [rol]: pila }), [], 'la copia debe partir dentro del presupuesto');

  const plantilla = pila.ficheros[pila.ficheros.length - 1];
  fs.appendFileSync(path.join(base, plantilla), 'x'.repeat(MAX_BYTES_POR_PILA[rol] - pila.bytes + 1));

  assert.match(fallosDePila(pilasPorRol(base)).join('\n'), new RegExp(`STACK_BUDGET_EXCEEDED: la pila de ${rol} `));
});

test('un rol despachado sin límite declarado falla con STACK_BUDGET_MISSING', () => {
  const fallos = fallosDePila({ nuevo: { bytes: 1, ficheros: ['X.md'] } });

  assert.deepStrictEqual(fallos, ['STACK_BUDGET_MISSING: el rol nuevo se despacha sin límite de pila declarado.']);
});

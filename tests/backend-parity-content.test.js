'use strict';

// Verifica la seccion "Ahorro de tokens" de README.md/CLAUDE.md y la paridad
// de cuerpo entre agentes equivalentes de distintos backends.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function leer(rutaRelativa) {
  return fs.readFileSync(path.join(RAIZ, rutaRelativa), 'utf8');
}

// ── Seccion "Ahorro de tokens" ───────────────────────────────────────────────
//
// README.md documenta las palancas de ahorro de tokens (rtk, codeburn, modelo
// por defecto); CLAUDE.md apunta a esa seccion en una linea, sin duplicarla
// (CLAUDE.md se carga en cada sesion y no es sitio para prosa larga).

test('README.md tiene la seccion "Ahorro de tokens" entre Hooks y Reglas de Cursor', () => {
  const contenido = leer('README.md');
  const inicioHooks = contenido.indexOf('## Hooks (enforcement mecanico)');
  const inicioAhorro = contenido.indexOf('## Ahorro de tokens');
  const inicioCursor = contenido.indexOf('## Reglas de Cursor');

  assert.ok(inicioHooks !== -1, 'README.md debe tener la seccion "Hooks (enforcement mecanico)"');
  assert.ok(inicioAhorro !== -1, 'README.md debe tener la seccion "Ahorro de tokens"');
  assert.ok(inicioCursor !== -1, 'README.md debe tener la seccion "Reglas de Cursor"');
  assert.ok(
    inicioHooks < inicioAhorro && inicioAhorro < inicioCursor,
    'La seccion "Ahorro de tokens" debe ir entre "Hooks (enforcement mecanico)" y "Reglas de Cursor"'
  );
});

test('README.md "Ahorro de tokens" referencia "Modelo por defecto" en vez de duplicarlo', () => {
  const contenido = leer('README.md');
  const inicioAhorro = contenido.indexOf('## Ahorro de tokens');
  const inicioCursor = contenido.indexOf('## Reglas de Cursor');
  const seccion = contenido.slice(inicioAhorro, inicioCursor);

  assert.ok(seccion.includes('rtk'), 'La seccion debe mencionar rtk como palanca de compresion de shell');
  assert.ok(seccion.includes('codeburn'), 'La seccion debe mencionar codeburn como dashboard de coste');
  assert.ok(
    seccion.includes('Modelo por defecto'),
    'La seccion debe referenciar "Modelo por defecto" en vez de repetir su contenido'
  );
  assert.ok(
    !/opus|sonnet/i.test(seccion),
    'La seccion no debe duplicar detalles de modelos concretos ya cubiertos en "Modelo por defecto"'
  );
});

test('CLAUDE.md tiene un puntero de una linea a "Ahorro de tokens" (sin duplicar contenido)', () => {
  const contenido = leer('CLAUDE.md');
  const lineas = contenido.split('\n');
  const lineasConMencion = lineas.filter(linea => linea.includes('Ahorro de tokens'));

  assert.strictEqual(
    lineasConMencion.length,
    1,
    'CLAUDE.md debe mencionar "Ahorro de tokens" exactamente una vez (puntero, no prosa)'
  );
  assert.ok(
    lineasConMencion[0].length < 80,
    'El puntero en CLAUDE.md debe ser una linea corta, no una seccion completa'
  );
});

// ── Seccion "Modos de ejecucion": no niega la concurrencia fuera de Claude Code ──
//
// README.md niega en un solo punto que Codex/Antigravity/Gemini paralelicen. Este
// canario protege que el punto de entrada no vuelva a comunicar esa imposibilidad
// categorica, ni literal ni parafraseada. No es duplicado de
// tests/vocabulario-concurrencia.test.js: ese canario escanea las rutas de
// scripts/backend-manifest.json y README.md no esta ahi.

test('README.md "Modos de ejecucion" no niega el modo paralelo fuera de Claude Code', () => {
  const contenido = leer('README.md');
  const inicioModos = contenido.indexOf('## Modos de ejecucion');
  const inicioCarpetas = contenido.indexOf('## Que hay en cada carpeta');

  assert.ok(inicioModos !== -1, 'README.md debe tener la seccion "Modos de ejecucion"');
  assert.ok(inicioCarpetas !== -1, 'README.md debe tener la seccion "Que hay en cada carpeta"');

  const seccion = contenido.slice(inicioModos, inicioCarpetas);

  assert.ok(
    !contenido.includes('no hay flag que lo cambie'),
    'README.md no debe afirmar que fuera de Claude Code no hay flag que cambie el modo de ejecucion'
  );

  const negacionCategorica = /no (hay|existe|se puede|es posible)[^.]{0,80}(paralel|concurren)/i;
  assert.ok(
    negacionCategorica.test('no se puede paralelizar en los demas backends'),
    'control positivo: la regex debe detectar el fixture de negacion categorica conocido'
  );
  assert.ok(
    !negacionCategorica.test(seccion),
    'La seccion no debe negar de forma categorica -ni parafraseada- que los demas backends paralelicen'
  );
});

// ── Superficies generadas: propiedades que el compilador no protege ─────────
//
// El compilador detecta que una salida se edito a mano y ya no coincide con
// su fuente, pero una edicion seguida de una regeneracion sincroniza sin
// dejar rastro. Estos dos casos leen AGENTS.md y GEMINI.md directamente para
// que una garantia perdida en el fragmento origen falle aqui, no en silencio.

/**
 * Corta desde una cabecera hasta la SIGUIENTE cabecera de nivel 1 o 2 (o el
 * final del fichero), sin fijar el nombre del cierre: acota a la seccion
 * real de la cabecera, no a la distancia hasta una cabecera vecina cuyo
 * nombre no tiene relacion con la propiedad que se comprueba. Ancla por
 * linea completa (no por subcadena) para que una cabecera degradada a nivel
 * 3, o un apendice de nivel 1 insertado antes del cierre esperado, no la
 * absorban en silencio dentro de la seccion.
 */
function acotarSeccion(contenido, cabecera) {
  const lineas = contenido.split('\n');
  const inicio = lineas.indexOf(cabecera);
  if (inicio === -1) return null;
  const resto = lineas.slice(inicio + 1);
  const fin = resto.findIndex(linea => /^#{1,2} /.test(linea));
  return (fin === -1 ? resto : resto.slice(0, fin)).join('\n');
}

test('AGENTS.md declara en "Enforcement mecanico y su limite" que el commit sin revision lo sostiene la disciplina, no un hook', () => {
  const contenido = leer('AGENTS.md');
  const seccion = acotarSeccion(contenido, '## Enforcement mecanico y su limite');

  assert.ok(seccion !== null, 'AGENTS.md debe tener la seccion "Enforcement mecanico y su limite"');
  assert.ok(
    /disciplina, no un hook/.test(seccion),
    'La seccion "Enforcement mecanico y su limite" debe declarar que el commit sin revision lo sostiene '
      + 'la disciplina, no un hook'
  );
});

test('GEMINI.md tiene "Ejecucion en este backend" como cabecera y declara que aqui no hay flag', () => {
  const contenido = leer('GEMINI.md');
  const cabeceras = contenido.split('\n').filter(linea => linea.startsWith('## '));

  assert.ok(
    cabeceras.includes('## Ejecucion en este backend'),
    'GEMINI.md debe tener "Ejecucion en este backend" como cabecera de nivel 2'
  );

  const seccion = acotarSeccion(contenido, '## Ejecucion en este backend');

  assert.ok(seccion !== null, 'GEMINI.md debe tener la seccion "Ejecucion en este backend"');
  assert.ok(
    /no hay flag/i.test(seccion),
    'La seccion debe declarar que en este backend el modo paralelo no se pide con un flag'
  );
});

// ── Igualdad de cuerpo de agentes identicos-por-diseno ──────────────────────
//
// Los agentes de Codex (TOML) y Antigravity (Markdown+frontmatter) comparten
// el mismo cuerpo de instrucciones tras normalizar el envoltorio de cada
// formato. Una edicion en un solo backend diverge en silencio si nada lo ata.

const IDENTICAL_AGENTS = ['asesor', 'implementador', 'planificador', 'revisor'];

// Suelo de la lista de arriba, que se mantiene a mano: sobre una lista vacia el bucle
// no genera ni un caso y la cobertura pasa en verde sin comprobar nada. El suelo no es
// solo un numero: el manifiesto declara que agentes se generan para los dos backends,
// asi que un agente nuevo entra en cobertura el dia que se declara, o este caso falla.
const MIN_AGENTES_IDENTICOS = 4;

/** Agentes que el manifiesto genera a la vez para codex y para antigravity. */
function agentesGeneradosParaAmbosBackends() {
  const manifiesto = JSON.parse(leer('scripts/artifact-manifest.json'));
  return manifiesto.artifacts
    .filter(entrada => entrada.transform === 'agent-to-backend')
    .filter(entrada => ['codex', 'antigravity']
      .every(backend => (entrada.outputs || []).some(salida => salida.backend === backend)))
    .map(entrada => path.basename(entrada.source, '.md'))
    .sort();
}

test('la lista de agentes identicos cubre todos los que el manifiesto genera para ambos backends', () => {
  const generados = agentesGeneradosParaAmbosBackends();

  assert.ok(
    generados.length >= MIN_AGENTES_IDENTICOS,
    `el manifiesto declara ${generados.length} agentes para codex y antigravity, minimo `
      + `${MIN_AGENTES_IDENTICOS}: una derivacion vacia deja pasar toda la cobertura que la recorre`
  );
  assert.deepStrictEqual(
    [...IDENTICAL_AGENTS].sort(),
    generados,
    'la lista de agentes identicos-por-diseno y lo que el manifiesto genera para ambos backends '
      + 'han divergido: un agente fuera de la lista no se compara, y nada mas lo senala'
  );
});

function extractorToml(contenido) {
  const marcador = 'developer_instructions = """';
  const inicio = contenido.indexOf(marcador) + marcador.length;
  const fin = contenido.indexOf('"""', inicio);
  return contenido.slice(inicio, fin).trim();
}

function extractorMd(contenido) {
  const primerDelimitador = contenido.indexOf('---');
  const segundoDelimitador = contenido.indexOf('---', primerDelimitador + 3);
  return contenido.slice(segundoDelimitador + 3).trim();
}

for (const agente of IDENTICAL_AGENTS) {
  test(`paridad de contenido: el agente "${agente}" es identico entre codex y antigravity`, () => {
    const rutaCodex = path.join(RAIZ, '.codex/agents', `${agente}.toml`);
    const rutaAntigravity = path.join(RAIZ, '.agents/plugins/sdd/agents', `${agente}.md`);

    // Las dos rutas son salidas declaradas en el manifiesto: su ausencia es un fallo, no
    // un motivo para omitir la comparacion. Omitiendola, renombrar una salida solo subia
    // el contador de omitidos y la paridad dejaba de comprobarse en silencio.
    assert.ok(fs.existsSync(rutaCodex), `falta la salida de codex del agente "${agente}": ${rutaCodex}`);
    assert.ok(fs.existsSync(rutaAntigravity),
      `falta la salida de antigravity del agente "${agente}": ${rutaAntigravity}`);

    assert.strictEqual(
      extractorToml(fs.readFileSync(rutaCodex, 'utf8')),
      extractorMd(fs.readFileSync(rutaAntigravity, 'utf8')),
      `El agente "${agente}" difiere entre codex y antigravity. `
        + 'Los agentes identicos-por-diseno deben tener el mismo cuerpo de instrucciones '
        + 'una vez normalizado el envoltorio (TOML vs Markdown+frontmatter).'
    );
  });
}

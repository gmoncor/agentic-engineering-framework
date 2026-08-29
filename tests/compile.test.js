'use strict';

// Verifica el engine del compilador (scripts/compile.js) contra fixtures aisladas
// en un directorio temporal: los 3 modos (--check/--write/--dry-run), los casos
// de error (transform desconocido, source ausente) y que las entradas `mode:
// "preserve"` se ignoran. El engine se prueba con fixtures propias para que un
// fallo senale al engine y no al contenido del manifiesto.
//
// Los bloques siguientes si usan el manifiesto real: cada transform contra sus
// entradas, y el ultimo el compilador entero como gate de deriva (exit codes y
// reporte).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  compilar,
  parseModo,
  parseQuiet,
  resumirDiff,
  validarEsquemaBasico,
  cargarPolitica,
  cargarVariables,
  brechasDePolitica,
  ejecutarCompilacion,
} = require('../scripts/compile');

// Exit codes esperados, escritos como literales. No se importan del modulo que
// se esta probando: comparar su resultado contra su propia constante deja los
// dos lados del igual moviendose juntos, y cualquier valor pasaria.
const CODIGO_OK = 0;
const CODIGO_DERIVA = 1;
const CODIGO_ERROR = 2;
const { ensamblarDocumento } = require('../scripts/transforms/doc-fragment-assembly');
const { transformarAgente } = require('../scripts/transforms/agent-to-backend');
const { transformarComando } = require('../scripts/transforms/command-to-backend');
const { transformarSkill } = require('../scripts/transforms/skill-to-backend');
const { transformarComandoASkill } = require('../scripts/transforms/command-to-skill');
const { cargarManifiesto, RAIZ } = require('../scripts/validate-manifest');

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compile-'));
}

function escribirArchivo(base, ruta, contenido = '') {
  const destino = path.join(base, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

function leerArchivo(base, ruta) {
  return fs.readFileSync(path.join(base, ruta), 'utf8');
}

test('parseModo reconoce --check, --write, --dry-run y usa --check por defecto', () => {
  assert.strictEqual(parseModo(['--check']), 'check');
  assert.strictEqual(parseModo(['--write']), 'write');
  assert.strictEqual(parseModo(['--dry-run']), 'dry-run');
  assert.strictEqual(parseModo([]), 'check');
  assert.strictEqual(parseModo(['--otra-flag']), 'check');
});

test('validarEsquemaBasico rechaza un manifiesto sin artifacts o sin transforms_registry', () => {
  assert.throws(() => validarEsquemaBasico({}), /MANIFEST_INVALID/);
  assert.throws(() => validarEsquemaBasico({ artifacts: [] }), /MANIFEST_INVALID/);
  assert.doesNotThrow(() => validarEsquemaBasico({ artifacts: [], transforms_registry: {} }));
});

test('3.1 --check con artefactos sincronizados devuelve sin drift ni errores', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido pr');
  escribirArchivo(raiz, '.gemini/skills/pr/SKILL.md', 'contenido pr');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/pr/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados[0].resultados[0].estado, 'ok');
});

test('3.2 --check con un artefacto managed modificado a mano detecta drift y nombra el archivo', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido original');
  escribirArchivo(raiz, '.gemini/skills/pr/SKILL.md', 'contenido editado a mano');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/pr/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados[0].resultados[0].estado, 'drift');
  assert.strictEqual(resultados[0].resultados[0].path, '.gemini/skills/pr/SKILL.md');
});

test('3.3 --write regenera un artefacto managed que fue modificado a mano', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido canonico');
  escribirArchivo(raiz, '.gemini/skills/pr/SKILL.md', 'contenido editado a mano');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/pr/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'write');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados[0].resultados[0].estado, 'escrito');
  assert.strictEqual(leerArchivo(raiz, '.gemini/skills/pr/SKILL.md'), 'contenido canonico');
});

test('3.4 --dry-run reporta cambios sin escribir nada a disco', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido canonico');
  escribirArchivo(raiz, '.gemini/skills/pr/SKILL.md', 'contenido editado a mano');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/pr/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'dry-run');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados[0].resultados[0].estado, 'cambiaria');
  assert.strictEqual(leerArchivo(raiz, '.gemini/skills/pr/SKILL.md'), 'contenido editado a mano');
});

test('3.5 una entrada con transform desconocido produce TRANSFORM_NOT_REGISTERED sin crash', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/agents/asesor.md', 'contenido');

  const manifest = {
    transforms_registry: { 'md-to-toml': 'convierte markdown a toml' },
    artifacts: [
      {
        id: 'agent-asesor',
        source: '.claude/agents/asesor.md',
        transform: 'md-to-toml',
        mode: 'managed',
        outputs: [{ backend: 'codex', path: '.codex/agents/asesor.toml' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.deepStrictEqual(resultados, []);
  assert.strictEqual(errores.length, 1);
  assert.strictEqual(errores[0].entryId, 'agent-asesor');
  assert.match(errores[0].mensaje, /TRANSFORM_NOT_REGISTERED: md-to-toml/);
});

test('3.6 una entrada con mode: preserve es ignorada por el compilador', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.codex/config.toml', 'config original');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'codex-config',
        source: '.codex/config.toml',
        transform: 'identity',
        mode: 'preserve',
        outputs: [{ backend: 'codex', path: '.codex/config.toml' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'write');

  assert.deepStrictEqual(resultados, []);
  assert.deepStrictEqual(errores, []);
  assert.strictEqual(leerArchivo(raiz, '.codex/config.toml'), 'config original');
});

test('caso limite: source ausente en disco produce SOURCE_NOT_FOUND y sigue con el resto de entradas', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/otra/SKILL.md', 'otra skill');
  escribirArchivo(raiz, '.gemini/skills/otra/SKILL.md', 'otra skill');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-fantasma',
        source: '.claude/skills/fantasma/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/fantasma/SKILL.md' }],
      },
      {
        id: 'skill-otra',
        source: '.claude/skills/otra/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/otra/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0].mensaje, /SOURCE_NOT_FOUND: \.claude\/skills\/fantasma\/SKILL\.md/);
  assert.strictEqual(resultados.length, 1);
  assert.strictEqual(resultados[0].entryId, 'skill-otra');
  assert.strictEqual(resultados[0].resultados[0].estado, 'ok');
});

test('caso limite: --write crea el directorio padre del output si no existe', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/nueva/SKILL.md', 'skill nueva');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-nueva',
        source: '.claude/skills/nueva/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/nueva/SKILL.md' }],
      },
    ],
  };

  assert.strictEqual(fs.existsSync(path.join(raiz, '.gemini/skills/nueva')), false);

  const { errores } = compilar(manifest, raiz, 'write');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(leerArchivo(raiz, '.gemini/skills/nueva/SKILL.md'), 'skill nueva');
});

/** Manifiesto de una entrada con dos salidas identity, para los tests de atomicidad de --write. */
function manifiestoDeDosSalidas() {
  return {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [
          { backend: 'gemini', path: 'out/primero.md' },
          { backend: 'gemini', path: 'bloqueador/anidado/segundo.md' },
        ],
      },
    ],
  };
}

test('atomic: --write con fallo real de disco (ENOTDIR) a mitad de la entrada no deja ninguna salida aplicada', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido pr');
  escribirArchivo(raiz, 'bloqueador', 'soy fichero\n');

  const { resultados, errores } = compilar(manifiestoDeDosSalidas(), raiz, 'write');

  assert.deepStrictEqual(resultados, []);
  assert.strictEqual(errores.length, 1);
  assert.match(errores[0].mensaje, /ENOTDIR/);
  assert.strictEqual(
    fs.existsSync(path.join(raiz, 'out/primero.md')),
    false,
    'la primera salida no puede quedar escrita cuando la entrada entera fallo'
  );
});

test('atomic: caso de control -- sin el fichero bloqueador, --write aplica las dos salidas de la entrada', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido pr');

  const { resultados, errores } = compilar(manifiestoDeDosSalidas(), raiz, 'write');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(leerArchivo(raiz, 'out/primero.md'), 'contenido pr');
  assert.strictEqual(leerArchivo(raiz, 'bloqueador/anidado/segundo.md'), 'contenido pr');
  assert.deepStrictEqual(
    resultados[0].resultados.map(r => r.estado),
    ['escrito', 'escrito']
  );
});

test('caso limite: --check sobre un output que aun no existe reporta drift OUTPUT_MISSING sin crash', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/nueva/SKILL.md', 'skill nueva');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-nueva',
        source: '.claude/skills/nueva/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/nueva/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados[0].resultados[0].estado, 'drift');
  assert.strictEqual(resultados[0].resultados[0].detalle, 'OUTPUT_MISSING');
});

test('el transform identity recibe el output actual junto con la entrada, sin alterar el contenido', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido con {placeholders} intactos');
  escribirArchivo(raiz, '.gemini/skills/pr/SKILL.md', 'contenido con {placeholders} intactos');

  const manifest = {
    transforms_registry: { identity: 'copia literal' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'identity',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/pr/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados[0].resultados[0].estado, 'ok');
});

// --- Documentos de instrucciones raiz (nucleo compartido + fragmento por backend) ---

const ENTRADAS_RAIZ = ['instructions-claude', 'instructions-gemini', 'instructions-agents'];
const DOCUMENTOS_RAIZ = ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];

// Titulos que solo tiene el documento del backend AGENTS.md. Si alguno se
// renombra, este es el sitio donde se actualiza.
const SECCIONES_PROPIAS_AGENTS = [
  '## Enforcement mecanico y su limite',
  '## Antigravity CLI (`agy`)',
];

const NUCLEO_MINIMO = [
  '<!-- preambulo, no se emite -->',
  '',
  '<!-- nucleo: saludo -->',
  '## Saludo',
  '',
  '<!-- hueco: nombre -->',
].join('\n');

/** El manifiesto real acotado a las entradas de los documentos de instrucciones raiz. */
function manifiestoRaiz() {
  const manifest = cargarManifiesto();
  return { ...manifest, artifacts: manifest.artifacts.filter(a => ENTRADAS_RAIZ.includes(a.id)) };
}

/** Directorio temporal con una copia de `docs-src/` y ningun documento generado todavia. */
function raizConFuentes() {
  const raiz = dirTemporal();
  fs.cpSync(path.join(RAIZ, 'docs-src'), path.join(raiz, 'docs-src'), { recursive: true });
  return raiz;
}

test('4.1 --write genera los documentos raiz identicos a los que hay en el repositorio', () => {
  const raiz = raizConFuentes();

  const { resultados, errores } = compilar(manifiestoRaiz(), raiz, 'write');

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(resultados.flatMap(r => r.resultados).length, DOCUMENTOS_RAIZ.length);
  for (const documento of DOCUMENTOS_RAIZ) {
    const esperado = fs.readFileSync(path.join(RAIZ, documento), 'utf8');
    assert.strictEqual(leerArchivo(raiz, documento), esperado, `${documento} no coincide con el generado`);
  }
});

test('4.2 --check detecta la deriva de un documento raiz editado a mano', () => {
  const raiz = raizConFuentes();
  compilar(manifiestoRaiz(), raiz, 'write');
  escribirArchivo(raiz, 'CLAUDE.md', '# editado a mano\n');

  const { resultados, errores } = compilar(manifiestoRaiz(), raiz, 'check');

  assert.deepStrictEqual(errores, []);
  const salidas = resultados.flatMap(r => r.resultados);
  assert.strictEqual(salidas.find(o => o.path === 'CLAUDE.md').estado, 'drift');
  assert.deepStrictEqual(salidas.filter(o => o.path !== 'CLAUDE.md').map(o => o.estado), ['ok', 'ok']);
});

test('4.3 las secciones propias de AGENTS.md salen en su documento y en ningun otro', () => {
  const raiz = raizConFuentes();
  compilar(manifiestoRaiz(), raiz, 'write');
  const agents = leerArchivo(raiz, 'AGENTS.md');
  const claude = leerArchivo(raiz, 'CLAUDE.md');

  for (const seccion of SECCIONES_PROPIAS_AGENTS) {
    assert.ok(agents.includes(seccion), `AGENTS.md deberia contener "${seccion}"`);
    assert.ok(!claude.includes(seccion), `CLAUDE.md no deberia contener "${seccion}"`);
  }
});

test('caso limite: un hueco del nucleo sin bloque en el fragmento produce FRAGMENT_NOT_FOUND con backend y hueco', () => {
  assert.throws(
    () => ensamblarDocumento(NUCLEO_MINIMO, '<!-- nucleo: saludo -->\n', { output: { backend: 'quinto' } }),
    err => /FRAGMENT_NOT_FOUND/.test(err.message)
      && err.message.includes('quinto')
      && err.message.includes('nombre')
  );
});

test('caso limite: un fragmento que pide una seccion inexistente produce SECTION_NOT_FOUND', () => {
  assert.throws(
    () => ensamblarDocumento(NUCLEO_MINIMO, '<!-- nucleo: renombrada -->\n', { output: { backend: 'claude' } }),
    /SECTION_NOT_FOUND: .*"renombrada"/
  );
});

test('caso limite: un fragmento declarado y ausente en disco se acumula como FRAGMENT_NOT_FOUND sin crash', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, 'docs-src/core.md', NUCLEO_MINIMO);

  const manifest = {
    transforms_registry: { 'doc-fragment-assembly': 'ensambla nucleo + fragmento' },
    artifacts: [
      {
        id: 'instructions-quinto',
        source: 'docs-src/core.md',
        fragment: 'docs-src/fragments/quinto.md',
        transform: 'doc-fragment-assembly',
        mode: 'managed',
        outputs: [{ backend: 'quinto', path: 'QUINTO.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.deepStrictEqual(resultados, []);
  assert.strictEqual(errores.length, 1);
  assert.match(errores[0].mensaje, /FRAGMENT_NOT_FOUND: docs-src\/fragments\/quinto\.md/);
});

test('caso limite: el error de un transform se reporta como error de entrada, no como excepcion', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, 'docs-src/core.md', NUCLEO_MINIMO);
  escribirArchivo(raiz, 'docs-src/fragments/quinto.md', '<!-- nucleo: saludo -->\n');

  const manifest = {
    transforms_registry: { 'doc-fragment-assembly': 'ensambla nucleo + fragmento' },
    artifacts: [
      {
        id: 'instructions-quinto',
        source: 'docs-src/core.md',
        fragment: 'docs-src/fragments/quinto.md',
        transform: 'doc-fragment-assembly',
        mode: 'managed',
        outputs: [{ backend: 'quinto', path: 'QUINTO.md' }],
      },
    ],
  };

  const { errores } = compilar(manifest, raiz, 'check');

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0].mensaje, /FRAGMENT_NOT_FOUND: el backend "quinto" no rellena el hueco "nombre"/);
});

test('caso limite: el ensamblado normaliza el blanco sobrante para no inventar deriva', () => {
  const nucleo = '<!-- nucleo: cuerpo -->\n## Cuerpo   \n\n\n\nTexto\t\n';

  const documento = ensamblarDocumento(nucleo, '\n\n<!-- nucleo: cuerpo -->\n\n\n', { output: { backend: 'claude' } });

  assert.strictEqual(documento, '## Cuerpo\n\nTexto\n');
});

const NUCLEO_CON_MARCA = '<!-- nucleo: marca -->\n<!-- sdd-framework: {{VERSION}} -->\n';
const FRAGMENTO_CON_MARCA = '# Doc\n\n<!-- nucleo: marca -->\n';

test('el ensamblado sustituye el marcador de version por la variable de la compilacion', () => {
  const documento = ensamblarDocumento(NUCLEO_CON_MARCA, FRAGMENTO_CON_MARCA, {
    output: { backend: 'claude' },
    variables: { VERSION: '9.1.2' },
  });

  assert.strictEqual(documento, '# Doc\n\n<!-- sdd-framework: 9.1.2 -->\n');
});

test('caso limite: una version con sufijo de pre-release se inyecta tal cual, sin truncar ni normalizar', () => {
  const documento = ensamblarDocumento(NUCLEO_CON_MARCA, FRAGMENTO_CON_MARCA, {
    output: { backend: 'claude' },
    variables: { VERSION: '5.0.0-beta.1' },
  });

  assert.ok(documento.includes('<!-- sdd-framework: 5.0.0-beta.1 -->'));
});

test('caso limite: un marcador sin valor produce VARIABLE_NOT_FOUND en vez de emitirlo sin resolver', () => {
  assert.throws(
    () => ensamblarDocumento(NUCLEO_CON_MARCA, FRAGMENTO_CON_MARCA, { output: { backend: 'claude' }, variables: {} }),
    /VARIABLE_NOT_FOUND: .*\{\{VERSION\}\}/
  );
});

test('el ensamblado solo interpola marcadores {{...}}: el resto del texto viaja literal', () => {
  const nucleo = '<!-- nucleo: marca -->\nVERSION, {version} y {{args}} no son marcadores\n';

  const documento = ensamblarDocumento(nucleo, FRAGMENTO_CON_MARCA, { output: { backend: 'claude' }, variables: {} });

  assert.strictEqual(documento, '# Doc\n\nVERSION, {version} y {{args}} no son marcadores\n');
});

test('cargarVariables toma la version de package.json y rechaza un paquete que no la declara', () => {
  assert.strictEqual(cargarVariables().VERSION, require('../package.json').version);

  const raiz = dirTemporal();
  escribirArchivo(raiz, 'package.json', JSON.stringify({ name: 'sin-version' }));

  assert.throws(() => cargarVariables(path.join(raiz, 'package.json')), /VERSION_NOT_FOUND/);
});

test('los tres documentos raiz generados declaran la version que declara package.json', () => {
  const raiz = raizConFuentes();
  const versionEsperada = require('../package.json').version;

  compilar(manifiestoRaiz(), raiz, 'write');

  for (const documento of DOCUMENTOS_RAIZ) {
    assert.match(leerArchivo(raiz, documento), new RegExp(`<!-- sdd-framework: ${versionEsperada} -->`), documento);
  }
});

test('subir la version de package.json deja los tres documentos raiz en deriva hasta regenerarlos', () => {
  const raiz = raizConFuentes();
  const manifest = manifiestoRaiz();
  compilar(manifest, raiz, 'write');

  const salidas = compilar(manifest, raiz, 'check', cargarPolitica(), { VERSION: '99.0.0' }).resultados
    .flatMap(r => r.resultados);

  assert.deepStrictEqual(salidas.map(o => o.estado), ['drift', 'drift', 'drift']);
  assert.match(salidas[0].diff[0], /99\.0\.0/);
});

// --- Comandos: Markdown de Claude a TOML de Gemini -------------------------

const COMANDO_FUENTE = [
  '---',
  'description: "Muestra el estado del proyecto"',
  '---',
  '',
  'Muestra el estado actual.',
  '',
  'Solicitud del usuario:',
  '',
  '$ARGUMENTS',
  '',
].join('\n');

/** Entrada sintetica para invocar un transform fuera del engine. */
function entradaDe(id, backend, extra = {}) {
  return { id, source: `fuente/${id}`, output: { backend }, ...extra };
}

test('5.1 command-to-backend traduce descripcion, cuerpo y marcador de argumentos al TOML de Gemini', () => {
  const toml = transformarComando(COMANDO_FUENTE, entradaDe('command-estado', 'gemini'));

  assert.strictEqual(
    toml,
    'description = "Muestra el estado del proyecto"\n\n'
      + 'prompt = """\nMuestra el estado actual.\n\nSolicitud del usuario:\n\n{{args}}\n"""\n'
  );
});

test('5.2 un comando sin frontmatter produce MISSING_FRONTMATTER nombrando el fichero fuente', () => {
  assert.throws(
    () => transformarComando('Solo cuerpo, sin frontmatter.\n', entradaDe('command-suelto', 'gemini')),
    err => /MISSING_FRONTMATTER/.test(err.message) && err.message.includes('fuente/command-suelto')
  );
});

test('5.3 un comando con frontmatter incompleto produce MISSING_FIELD nombrando el campo que falta', () => {
  const sinDescripcion = '---\nname: estado\n---\n\nCuerpo.\n';

  assert.throws(
    () => transformarComando(sinDescripcion, entradaDe('command-estado', 'gemini')),
    err => /MISSING_FIELD/.test(err.message) && err.message.includes('description')
  );
});

test('5.4 el cuerpo con caracteres especiales de TOML se escapa en vez de romper la cadena multilinea', () => {
  const conEspeciales = '---\ndescription: "Con \\"comillas\\" dentro"\n---\n\nUn bloque """ y una barra \\ suelta.\n';

  const toml = transformarComando(conEspeciales, entradaDe('command-raro', 'gemini'));

  assert.ok(toml.includes('description = "Con \\"comillas\\" dentro"'), 'la descripcion debe llevar las comillas escapadas');
  assert.ok(toml.includes('\\"\\"\\"'), 'la triple comilla del cuerpo no puede cerrar la cadena multilinea');
  assert.ok(toml.includes('barra \\\\ suelta'), 'la barra invertida debe quedar escapada');
  assert.strictEqual(toml.split('"""').length, 3, 'solo deben quedar las dos comillas triples que abren y cierran');
});

test('5.5 un comando con fragmento toma del fragmento su descripcion y su prompt propios', () => {
  const variante = '---\ndescription: "Version propia de este backend"\n---\n\nPasos escritos aqui.\n';

  const toml = transformarComando(
    COMANDO_FUENTE,
    entradaDe('command-planificar', 'gemini', { fragment: 'docs-src/commands/planificar.md', fragmentContent: variante })
  );

  assert.strictEqual(toml, 'description = "Version propia de este backend"\n\nprompt = """\nPasos escritos aqui.\n"""\n');
});

test('5.6 un backend sin formato de comando definido produce BACKEND_NOT_SUPPORTED', () => {
  assert.throws(
    () => transformarComando(COMANDO_FUENTE, entradaDe('command-estado', 'quinto')),
    /BACKEND_NOT_SUPPORTED: .*"quinto"/
  );
});

// --- Agentes: fuente de Claude mas variante compartida ---------------------

const AGENTE_FUENTE = [
  '---',
  'name: asesor',
  'description: "Descripcion larga del agente"',
  'model: opus-4-6',
  'tools:',
  '  - Read',
  '  - Bash',
  '---',
  '',
  '# Asesor',
  '',
  'Cuerpo largo, propio de Claude Code.',
  '',
].join('\n');

const AGENTE_VARIANTE = '---\ndescription: "Descripcion corta"\n---\n\n# Asesor\n\nCuerpo condensado.\n';

function entradaDeAgente(backend) {
  return entradaDe('agent-asesor', backend, { fragment: 'docs-src/agents/asesor.md', fragmentContent: AGENTE_VARIANTE });
}

test('6.1 agent-to-backend genera el TOML de Codex con el sandbox de la politica y sin campo de modelo', () => {
  const toml = transformarAgente(AGENTE_FUENTE, entradaDeAgente('codex'), cargarPolitica());

  assert.strictEqual(
    toml,
    'name = "asesor"\ndescription = "Descripcion corta"\nsandbox_mode = "read-only"\n\n'
      + 'developer_instructions = """\n# Asesor\n\nCuerpo condensado.\n"""\n'
  );
  assert.ok(!/^model = /m.test(toml), 'Codex declara model_field: false, asi que no debe llevar campo de modelo');
});

test('6.2 Codex y Antigravity reciben el mismo cuerpo, que sale del fragmento y no de la fuente', () => {
  const politica = cargarPolitica();
  const codex = transformarAgente(AGENTE_FUENTE, entradaDeAgente('codex'), politica);
  const antigravity = transformarAgente(AGENTE_FUENTE, entradaDeAgente('antigravity'), politica);

  assert.ok(antigravity.includes('---\nname: asesor\ndescription: "Descripcion corta"'), 'el frontmatter base de Antigravity no cambia');
  assert.ok(antigravity.endsWith('\n\n# Asesor\n\nCuerpo condensado.\n'), 'el body de Antigravity sale del fragmento, no de la fuente');
  assert.ok(antigravity.includes('tools: [view_file, grep_search, run_command]'),
    'el rol asesor declara su allowlist de solo lectura (politica antigravity.tools_allowlist.roles.asesor)');
  assert.ok(codex.includes('Cuerpo condensado.'), 'el TOML de Codex debe llevar el cuerpo del fragmento');
  assert.ok(!codex.includes('Cuerpo largo'), 'el cuerpo propio de Claude no debe viajar a los demas backends');
  assert.ok(!antigravity.includes('Cuerpo largo'), 'el cuerpo propio de Claude no debe viajar a los demas backends');
});

test('6.3 la politica manda sobre el modelo de la fuente y traduce las herramientas al vocabulario de Gemini', () => {
  const markdown = transformarAgente(AGENTE_FUENTE, entradaDeAgente('gemini'), cargarPolitica());

  assert.ok(markdown.includes('model: gemini-2.5-pro'), 'el modelo debe salir de la politica');
  assert.ok(!markdown.includes('opus-4-6'), 'el modelo declarado en la fuente no debe llegar a la salida');
  assert.ok(markdown.includes('tools: [read_file, run_command, glob, grep_search]'), 'las herramientas deben ir traducidas');
  assert.ok(markdown.includes('Cuerpo largo'), 'Gemini si comparte el cuerpo del fichero de Claude');
});

test('6.4 un agente sin fragmento declarado se acumula como FRAGMENT_NOT_FOUND y no detiene el resto', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/agents/asesor.md', AGENTE_FUENTE);
  escribirArchivo(raiz, '.claude/skills/diff/SKILL.md', '---\nname: diff\n---\n\nCuerpo.\n');
  escribirArchivo(raiz, '.gemini/skills/diff/SKILL.md', '---\nname: diff\n---\n\nCuerpo.\n');

  const manifest = {
    transforms_registry: { 'agent-to-backend': 'agente por backend', 'skill-to-backend': 'skill por backend' },
    artifacts: [
      {
        id: 'agent-asesor',
        source: '.claude/agents/asesor.md',
        transform: 'agent-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'codex', path: '.codex/agents/asesor.toml' }],
      },
      {
        id: 'skill-diff',
        source: '.claude/skills/diff/SKILL.md',
        transform: 'skill-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/diff/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0].mensaje, /FRAGMENT_NOT_FOUND/);
  assert.strictEqual(resultados.length, 1);
  assert.strictEqual(resultados[0].entryId, 'skill-diff');
});

test('6.5 un frontmatter ilegible produce PARSE_ERROR con el path y deja seguir al resto de entradas', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/agents/roto.md', '---\nname: roto\n: sin clave\n---\n\nCuerpo.\n');
  escribirArchivo(raiz, 'docs-src/agents/roto.md', AGENTE_VARIANTE);
  escribirArchivo(raiz, '.claude/skills/diff/SKILL.md', '---\nname: diff\n---\n\nCuerpo.\n');
  escribirArchivo(raiz, '.gemini/skills/diff/SKILL.md', '---\nname: diff\n---\n\nCuerpo.\n');

  const manifest = {
    transforms_registry: { 'agent-to-backend': 'agente por backend', 'skill-to-backend': 'skill por backend' },
    artifacts: [
      {
        id: 'agent-roto',
        source: '.claude/agents/roto.md',
        fragment: 'docs-src/agents/roto.md',
        transform: 'agent-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'codex', path: '.codex/agents/roto.toml' }],
      },
      {
        id: 'skill-diff',
        source: '.claude/skills/diff/SKILL.md',
        transform: 'skill-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/diff/SKILL.md' }],
      },
    ],
  };

  const { resultados, errores } = compilar(manifest, raiz, 'check');

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0].mensaje, /PARSE_ERROR/);
  assert.match(errores[0].mensaje, /\.claude\/agents\/roto\.md/);
  assert.strictEqual(resultados.length, 1);
  assert.strictEqual(resultados[0].resultados[0].estado, 'ok');
});

test('6.6 una herramienta que la politica no traduce ni declara sin equivalente detiene la generacion', () => {
  const conHerramientaSuelta = AGENTE_FUENTE.replace('  - Bash', '  - Bash\n  - Sospechosa');

  assert.throws(
    () => transformarAgente(conHerramientaSuelta, entradaDeAgente('gemini'), cargarPolitica()),
    /TOOL_NOT_MAPPED: "fuente\/agent-asesor" declara Sospechosa/
  );
});

test('6.7 una herramienta sin equivalente se descarta solo si la politica lo declara', () => {
  const conAgent = AGENTE_FUENTE.replace('  - Bash', '  - Bash\n  - Agent');

  const markdown = transformarAgente(conAgent, entradaDeAgente('gemini'), cargarPolitica());

  assert.ok(cargarPolitica().backends.gemini.tools.unsupported.includes('Agent'), 'la excepcion vive en la politica');
  assert.ok(!markdown.includes('Agent'), 'Gemini no tiene equivalente, asi que la herramienta no viaja');
});

// --- Skills: copia literal y variante de Antigravity -----------------------

const SKILL_FUENTE = [
  '---',
  'name: bugfix',
  'description: "Triaje de bugs"',
  'argument-hint: "[descripcion del error]"',
  '---',
  '',
  'Sigue la plantilla.',
  '',
].join('\n');

test('7.1 skill-to-backend entrega a Gemini una copia literal de la skill de Claude', () => {
  assert.strictEqual(transformarSkill(SKILL_FUENTE, entradaDe('skill-bugfix', 'gemini')), SKILL_FUENTE);
});

test('7.2 la skill de Antigravity pierde argument-hint y gana la seccion de uso del fragmento', () => {
  const anexo = '## Uso a peticion explicita\n\nPide la reproduccion antes de tocar codigo.\n';

  const salida = transformarSkill(
    SKILL_FUENTE,
    entradaDe('skill-bugfix', 'antigravity', { fragment: 'docs-src/skills/bugfix.md', fragmentContent: anexo })
  );

  assert.strictEqual(
    salida,
    '---\nname: bugfix\ndescription: "Triaje de bugs"\n---\n\nSigue la plantilla.\n\n'
      + '## Uso a peticion explicita\n\nPide la reproduccion antes de tocar codigo.\n'
  );
});

test('7.4 una skill que declara model no lo propaga: el modelo sale de la politica o no sale', () => {
  const conModelo = SKILL_FUENTE.replace('argument-hint:', 'model: modelo-de-la-fuente\nargument-hint:');
  const politica = cargarPolitica();

  const gemini = transformarSkill(conModelo, entradaDe('skill-bugfix', 'gemini'), politica);
  const antigravity = transformarSkill(conModelo, entradaDe('skill-bugfix', 'antigravity'), politica);

  assert.ok(gemini.includes('model: gemini-2.5-pro'), 'el backend con campo de modelo recibe el de la politica');
  assert.ok(!gemini.includes('modelo-de-la-fuente'), 'el modelo del fichero fuente no llega a ninguna salida');
  assert.ok(!/^model:/m.test(antigravity), 'Antigravity declara model_field: false, asi que no lleva el campo');
  assert.ok(!antigravity.includes('modelo-de-la-fuente'));
});

test('7.5 ninguna skill del repositorio declara model: el camino queda cerrado, no solo vigilado', () => {
  for (const entrada of cargarManifiesto().artifacts) {
    if (entrada.transform !== 'skill-to-backend') continue;
    const fuente = fs.readFileSync(path.join(RAIZ, entrada.source), 'utf8');
    const frontmatter = fuente.split('---')[1] || '';
    assert.ok(!/^model:/m.test(frontmatter), `${entrada.source} no debe declarar el modelo: lo fija la politica`);
  }
});

test('7.3 sin fragmento, la skill de Antigravity solo pierde argument-hint y queda igual que la fuente', () => {
  const salida = transformarSkill(SKILL_FUENTE, entradaDe('skill-bugfix', 'antigravity'));

  assert.strictEqual(salida, '---\nname: bugfix\ndescription: "Triaje de bugs"\n---\n\nSigue la plantilla.\n');
  assert.ok(!salida.includes('argument-hint'), 'Antigravity no invoca skills con argumentos');
});

// --- Politica de modelos ---------------------------------------------------

const BACKENDS_DE_LA_POLITICA = ['gemini', 'codex', 'antigravity'];

test('8.1 la politica declara los backends generados y marca cuales no admiten campo de modelo', () => {
  const politica = cargarPolitica();

  assert.deepStrictEqual(Object.keys(politica.backends), BACKENDS_DE_LA_POLITICA);
  assert.strictEqual(politica.backends.codex.model_field, false);
  assert.strictEqual(politica.backends.antigravity.model_field, false);
  assert.strictEqual(politica.backends.gemini.model.default, 'gemini-2.5-pro');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(politica.backends, 'claude'),
    'el arbol de Claude es la fuente, no un backend generado: su modelo vive en el fichero del agente y no se duplica aqui'
  );
});

test('8.1.1 el modelo de cada agente de Claude vive en su fichero, unica copia del dato', () => {
  for (const agente of ['asesor', 'implementador', 'planificador', 'revisor']) {
    const fuente = fs.readFileSync(path.join(RAIZ, `.claude/agents/${agente}.md`), 'utf8');
    assert.match(fuente, /^model: \S+$/m, `${agente} debe declarar su modelo en la fuente`);
  }
});

/** Copia de `.claude/` y `docs-src/` en un directorio temporal, sin ningun artefacto generado. */
function raizConArtefactosFuente() {
  const raiz = dirTemporal();
  for (const carpeta of ['.claude', 'docs-src']) {
    fs.cpSync(path.join(RAIZ, carpeta), path.join(raiz, carpeta), { recursive: true });
  }
  return raiz;
}

const TRANSFORMS_DE_ARTEFACTOS = ['agent-to-backend', 'command-to-backend', 'skill-to-backend'];

/** El manifiesto real acotado a las entradas de agentes, comandos y skills. */
function manifiestoDeArtefactos() {
  const manifest = cargarManifiesto();
  return { ...manifest, artifacts: manifest.artifacts.filter(a => TRANSFORMS_DE_ARTEFACTOS.includes(a.transform)) };
}

test('8.2 cambiar el modelo por defecto de Gemini y regenerar actualiza los cuatro agentes de ese backend', () => {
  const raiz = raizConArtefactosFuente();
  const politica = cargarPolitica();
  politica.backends.gemini.model.default = 'gemini-nuevo';

  const { errores } = compilar(manifiestoDeArtefactos(), raiz, 'write', politica);

  assert.deepStrictEqual(errores, []);
  for (const agente of ['asesor', 'implementador', 'planificador', 'revisor']) {
    const generado = leerArchivo(raiz, `.gemini/agents/${agente}.md`);
    assert.ok(generado.includes('model: gemini-nuevo'), `${agente} deberia usar el modelo de la politica`);
  }
});

test('8.3 --check reporta deriva si un agente de Gemini tiene un modelo distinto al de la politica', () => {
  const raiz = raizConArtefactosFuente();
  const manifest = manifiestoDeArtefactos();
  compilar(manifest, raiz, 'write');

  const ruta = '.gemini/agents/asesor.md';
  escribirArchivo(raiz, ruta, leerArchivo(raiz, ruta).replace('model: gemini-2.5-pro', 'model: otro-modelo'));

  const salidas = compilar(manifest, raiz, 'check').resultados.flatMap(r => r.resultados);

  assert.strictEqual(salidas.find(o => o.path === ruta).estado, 'drift');
  assert.strictEqual(salidas.filter(o => o.estado === 'drift').length, 1);
});

test('8.4 un backend fuera de la politica detiene la compilacion en vez de degradar el artefacto', () => {
  const manifest = {
    transforms_registry: { 'agent-to-backend': 'agente por backend' },
    artifacts: [
      {
        id: 'agent-asesor',
        source: '.claude/agents/asesor.md',
        transform: 'agent-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'quinto', path: '.quinto/agents/asesor.toml' }],
      },
    ],
  };

  const brechas = brechasDePolitica(manifest, cargarPolitica());

  assert.strictEqual(brechas.length, 1);
  assert.match(brechas[0].mensaje, /MODEL_POLICY_MISSING_BACKEND: .*"quinto"/);
  assert.strictEqual(brechas[0].entryId, 'agent-asesor', 'la brecha nombra la entrada que pide ese backend');
  assert.deepStrictEqual(brechasDePolitica(manifiestoDeArtefactos(), cargarPolitica()), []);

  const { resultados, errores } = compilar(manifest, dirTemporal(), 'write');

  assert.strictEqual(errores.length, 1, 'la brecha de politica se cuenta como error de compilacion');
  assert.deepStrictEqual(resultados, [], 'no se genera ni un artefacto mientras la politica tenga una brecha');
});

// --- Integracion: el arbol generado coincide con el que hay en el repositorio ---

test('8.5 --write reproduce agentes, comandos y skills de los tres backends tal y como estan en el repositorio', () => {
  const raiz = raizConArtefactosFuente();
  const manifest = manifiestoDeArtefactos();

  const { resultados, errores } = compilar(manifest, raiz, 'write');

  assert.deepStrictEqual(errores, []);
  const salidas = manifest.artifacts.flatMap(a => a.outputs.map(o => o.path));
  assert.strictEqual(resultados.flatMap(r => r.resultados).length, salidas.length);

  for (const salida of salidas) {
    assert.strictEqual(
      leerArchivo(raiz, salida),
      fs.readFileSync(path.join(RAIZ, salida), 'utf8'),
      `${salida} generado no coincide con el que hay en el repositorio`
    );
  }
});

test('8.6 --check sobre el manifiesto real no reporta deriva ni errores en agentes, comandos y skills', () => {
  const { resultados, errores } = compilar(manifiestoDeArtefactos(), RAIZ, 'check');

  assert.deepStrictEqual(errores, []);
  assert.deepStrictEqual(
    resultados.flatMap(r => r.resultados).filter(o => o.estado !== 'ok'),
    []
  );
});

// --- El compilador como gate de deriva: exit codes y reporte de una linea ----

const { spawnSync } = require('node:child_process');

/** Ejecuta `fn` capturando lo que escribe por consola. Devuelve `{ valor, stdout, stderr }`. */
function capturarSalida(fn) {
  const stdout = [];
  const stderr = [];
  const originales = { log: console.log, warn: console.warn, error: console.error };

  console.log = (...args) => stdout.push(args.join(' '));
  console.warn = (...args) => stderr.push(args.join(' '));
  console.error = (...args) => stderr.push(args.join(' '));

  try {
    return { valor: fn(), stdout, stderr };
  } finally {
    Object.assign(console, originales);
  }
}

test('9.1 el compilador del repositorio sale con 0 y confirma que no hay deriva', () => {
  const ejecucion = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'compile.js'), '--check'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });

  assert.strictEqual(ejecucion.status, CODIGO_OK, ejecucion.stdout + ejecucion.stderr);
  assert.match(ejecucion.stdout, /Sin deriva/, 'sin deriva el reporte confirma, no calla');
});

test('9.2 package.json expone el gate como script npm', () => {
  const { scripts } = require('../package.json');

  assert.strictEqual(scripts['check-drift'], 'node scripts/compile.js --check');
});

test('9.3 --check con deriva sale con 1 y nombra el archivo, su fuente y la linea que diverge', () => {
  const raiz = raizConArtefactosFuente();
  ejecutarCompilacion(['--write'], raiz);
  const ruta = '.gemini/skills/pr/SKILL.md';
  escribirArchivo(raiz, ruta, `${leerArchivo(raiz, ruta)}\nlinea intrusa\n`);

  const { valor, stdout } = capturarSalida(() => ejecutarCompilacion(['--check'], raiz));

  assert.strictEqual(valor, CODIGO_DERIVA);
  const reporte = stdout.join('\n');
  assert.match(reporte, new RegExp(`- ${ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `));
  assert.match(reporte, /fuente: \.claude\/skills\/pr\/SKILL\.md/);
  assert.match(reporte, /L\d+: fuente .* \/ disco .*linea intrusa/);
});

test('9.4 --check --quiet resume la deriva en una sola linea', () => {
  const raiz = raizConArtefactosFuente();
  ejecutarCompilacion(['--write'], raiz);
  const ruta = '.gemini/skills/pr/SKILL.md';
  escribirArchivo(raiz, ruta, 'editado a mano\n');

  const { valor, stdout } = capturarSalida(() => ejecutarCompilacion(['--check', '--quiet'], raiz));

  assert.strictEqual(valor, CODIGO_DERIVA);
  assert.deepStrictEqual(stdout, ['1 archivos con deriva']);
});

test('9.5 caso limite: una fuente ausente sale con 2 y no se cuenta como deriva', () => {
  const raiz = raizConArtefactosFuente();
  ejecutarCompilacion(['--write'], raiz);
  fs.rmSync(path.join(raiz, '.claude/skills/pr/SKILL.md'));

  const { valor, stdout, stderr } = capturarSalida(() => ejecutarCompilacion(['--check'], raiz));

  assert.strictEqual(valor, CODIGO_ERROR);
  assert.match(stderr.join('\n'), /SOURCE_NOT_FOUND: \.claude\/skills\/pr\/SKILL\.md/);
  assert.ok(!stdout.join('\n').includes('Con deriva:'), 'un error de compilacion no se reporta como deriva');

  const breve = capturarSalida(() => ejecutarCompilacion(['--check', '--quiet'], raiz));

  assert.strictEqual(breve.valor, CODIGO_ERROR);
  assert.deepStrictEqual(breve.stdout, [], 'en --quiet el error sale por stderr y sin cifra de deriva');
});

test('9.6 caso limite: un package.json sin version aborta antes de escribir un documento sin resolver', () => {
  const raiz = raizConFuentes();
  escribirArchivo(raiz, 'package.json', JSON.stringify({ name: 'sin-version' }));

  assert.throws(
    () => compilar(manifiestoRaiz(), raiz, 'write', cargarPolitica(), cargarVariables(path.join(raiz, 'package.json'))),
    /VERSION_NOT_FOUND/
  );
  assert.ok(!fs.existsSync(path.join(raiz, 'CLAUDE.md')), 'no debe quedar ningun documento generado');
});

test('9.7 el resumen del diff se corta en las primeras lineas divergentes', () => {
  const esperado = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
  const enDisco = ['a', 'B', 'c', 'D', 'E', 'F'].join('\n');

  const resumen = resumirDiff(esperado, enDisco);

  assert.strictEqual(resumen.length, 3, 'el reporte no vuelca el fichero entero');
  assert.deepStrictEqual(resumen[0], 'L2: fuente "b" / disco "B"');
  assert.deepStrictEqual(resumirDiff('a\nb', 'a\nb\nc'), ['L3: fuente "" / disco "c"']);
});

test('9.8 parseQuiet solo reconoce --quiet', () => {
  assert.strictEqual(parseQuiet(['--check', '--quiet']), true);
  assert.strictEqual(parseQuiet(['--check']), false);
});

test('9.9 los tres exit codes son 0, 1 y 2 y no se pisan entre si', () => {
  // Se importan aqui, y solo aqui, para fijarlos contra literales. El resto de
  // los tests compara el resultado real contra el literal que espera, no contra
  // la constante: si alguien iguala las tres constantes, este test lo dice.
  const compilador = require('../scripts/compile');

  assert.strictEqual(compilador.SALIDA_OK, CODIGO_OK);
  assert.strictEqual(compilador.SALIDA_DERIVA, CODIGO_DERIVA);
  assert.strictEqual(compilador.SALIDA_ERROR, CODIGO_ERROR);
  assert.strictEqual(new Set([CODIGO_OK, CODIGO_DERIVA, CODIGO_ERROR]).size, 3);
});

test('9.10 borrar un backend de la politica sale con 2, tambien en el modo breve que usa el registro de CI', () => {
  const raiz = raizConArtefactosFuente();
  const politicaSinGemini = cargarPolitica();
  delete politicaSinGemini.backends.gemini;

  const detallado = capturarSalida(() => ejecutarCompilacion(['--check'], raiz, politicaSinGemini));

  assert.strictEqual(detallado.valor, CODIGO_ERROR);
  assert.match(detallado.stderr.join('\n'), /MODEL_POLICY_MISSING_BACKEND/);

  const breve = capturarSalida(() => ejecutarCompilacion(['--check', '--quiet'], raiz, politicaSinGemini));

  assert.strictEqual(breve.valor, CODIGO_ERROR, 'el modo breve reduce el detalle, nunca el veredicto');

  const escritura = capturarSalida(() => ejecutarCompilacion(['--write'], raiz, politicaSinGemini));

  assert.strictEqual(escritura.valor, CODIGO_ERROR);
  assert.ok(
    !fs.existsSync(path.join(raiz, '.gemini/agents/asesor.md')),
    'un artefacto sin modelo ni herramientas no llega a disco'
  );
});

// --- Recuento de salidas generadas: la cifra no se mueve al reclasificar -----

// Cifras del manifiesto real, escritas a mano. Viven aqui, y no derivadas del
// propio manifiesto, para que reclasificar una entrada de generada a manual
// haga fallar la asercion en vez de encogerla consigo. Al anadir o quitar una
// entrada de verdad, estas tres cifras se actualizan a mano en el mismo cambio.
//
// SALIDAS_GENERADAS subio de 44 a 54 al pasar a generadas las diez skills que
// Codex y Antigravity entregaban a mano (`.agents/skills/<capacidad>/SKILL.md`).
// El movimiento es intencionado y va en la direccion que este suelo protege:
// diez salidas mas entran en el gate de deriva, ninguna sale. El total de
// entradas y de salidas declaradas no se mueve: las diez entradas `preserve` se
// sustituyeron una a una, sin anadir ni quitar ficheros.
const ARTEFACTOS_DECLARADOS = 45;
const SALIDAS_GENERADAS = 54;
const SALIDAS_DECLARADAS = 59;

/** Cada output del manifiesto completo, con el modo de la entrada que lo declara. */
function salidasDelManifiesto() {
  return cargarManifiesto().artifacts.flatMap(entrada =>
    (entrada.outputs || []).map(salida => ({ ...salida, mode: entrada.mode }))
  );
}

test('10.1 el manifiesto declara el numero de salidas generadas que el compilador verifica', () => {
  const salidas = salidasDelManifiesto();

  assert.strictEqual(cargarManifiesto().artifacts.length, ARTEFACTOS_DECLARADOS);
  assert.strictEqual(salidas.length, SALIDAS_DECLARADAS);
  assert.strictEqual(
    salidas.filter(salida => salida.mode === 'managed').length,
    SALIDAS_GENERADAS,
    'pasar una entrada de generada a manual la saca de todos los gates: la cifra esperada no baja con ella'
  );

  const { resultados, errores } = compilar(cargarManifiesto(), RAIZ, 'check');
  const verificadas = resultados.flatMap(r => r.resultados);

  assert.deepStrictEqual(errores, []);
  assert.strictEqual(verificadas.length, SALIDAS_GENERADAS, 'el compilador recorre todas las salidas generadas');
  assert.strictEqual(verificadas.filter(salida => salida.estado === 'ok').length, SALIDAS_GENERADAS);
});

test('10.2 el reporte del compilador publica la cifra de salidas verificadas', () => {
  const ejecucion = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'compile.js'), '--check'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });

  assert.strictEqual(ejecucion.status, CODIGO_OK, ejecucion.stdout + ejecucion.stderr);
  assert.match(
    ejecucion.stdout,
    new RegExp(`Verificados: ${SALIDAS_GENERADAS}\\b`),
    'la cifra que imprime el gate se compara con la que se espera, no solo consigo misma'
  );
});

// --- Comandos a skills: la entrega de Codex y Antigravity -------------------
//
// En esos dos backends cada comando se entrega como skill, y las dos leen el
// mismo directorio. La skill se genera desde el comando de Claude Code: sin
// esto, la misma capacidad tenia dos textos y una instruccion anadida al
// comando llegaba a dos backends de cuatro.

const COMANDO_CON_AVISO = [
  '---',
  'description: "Implementa una task"',
  '---',
  '',
  'Lee la plantilla y sigue sus pasos.',
  '',
  '<!-- solo-claude -->',
  'Aviso: este backend cablea el gate; usa `/implementar-spec` en su lugar.',
  '<!-- /solo-claude -->',
  '',
  'Si no hay spec aprobada, di al usuario que ejecute /planificar primero.',
  '',
  'Solicitud del usuario:',
  '',
  '$ARGUMENTS',
  '',
].join('\n');

const FRAGMENTO_DE_SKILL = [
  '---',
  'name: implementar',
  'description: "Se activa cuando el usuario pide implementar UNA task concreta."',
  '---',
  '',
  '## Alcance',
  '',
  'Solo tocas los archivos que la task declara.',
  '',
].join('\n');

/** Entrada sintetica de una skill generada desde un comando. */
function entradaDeSkill(nombre, backend = 'antigravity', extra = {}) {
  return {
    id: `skill-${nombre}`,
    source: `.claude/commands/${nombre}.md`,
    fragment: `docs-src/skills/${nombre}.md`,
    output: { backend, path: `.agents/skills/${nombre}/SKILL.md` },
    fragmentContent: FRAGMENTO_DE_SKILL,
    ...extra,
  };
}

test('11.1 command-to-skill toma el frontmatter del fragmento y el cuerpo del comando', () => {
  const skill = transformarComandoASkill(COMANDO_CON_AVISO, entradaDeSkill('implementar'), cargarPolitica());

  assert.strictEqual(
    skill,
    '---\nname: implementar\n'
      + 'description: "Se activa cuando el usuario pide implementar UNA task concreta."\n---\n\n'
      + 'Lee la plantilla y sigue sus pasos.\n\n'
      + 'Si no hay spec aprobada, di al usuario que ejecute la skill `planificar` primero.\n\n'
      + '## Alcance\n\nSolo tocas los archivos que la task declara.\n'
  );
});

test('11.2 un bloque marcado como exclusivo de Claude Code no llega ni a la skill ni al TOML de Gemini', () => {
  const skill = transformarComandoASkill(COMANDO_CON_AVISO, entradaDeSkill('implementar'), cargarPolitica());
  const toml = transformarComando(COMANDO_CON_AVISO, entradaDe('command-implementar', 'gemini'));

  for (const [superficie, salida] of [['la skill', skill], ['el TOML de Gemini', toml]]) {
    assert.ok(!salida.includes('cablea el gate'), `${superficie} no puede llevar el aviso exclusivo de Claude Code`);
    assert.ok(!salida.includes('solo-claude'), `${superficie} no puede llevar el marcador`);
  }

  assert.ok(toml.includes('Lee la plantilla'), 'el resto del cuerpo sigue viajando al backend de Gemini');
  assert.ok(!/\n\n\n/.test(toml), 'retirar el bloque no puede dejar una linea en blanco de mas');
});

test('11.3 el marcador de argumentos y su rotulo no llegan a la skill: una skill no recibe argumentos', () => {
  const skill = transformarComandoASkill(COMANDO_CON_AVISO, entradaDeSkill('implementar'), cargarPolitica());

  assert.ok(!skill.includes('$ARGUMENTS'), 'el marcador de argumentos no tiene sentido en una skill');
  assert.ok(!skill.includes('Solicitud del usuario'), 'sin argumentos, el rotulo prometeria una entrada que nunca llega');
});

test('11.4 source-body: omit sustituye el cuerpo del comando por el del fragmento', () => {
  const variante = FRAGMENTO_DE_SKILL.replace('---\n\n## Alcance', 'source-body: omit\n---\n\n## Alcance');

  const skill = transformarComandoASkill(
    COMANDO_CON_AVISO,
    entradaDeSkill('implementar', 'antigravity', { fragmentContent: variante }),
    cargarPolitica()
  );

  assert.ok(!skill.includes('Lee la plantilla'), 'el cuerpo del comando no viaja cuando el fragmento declara el suyo');
  assert.ok(skill.includes('## Alcance'), 'el cuerpo sale del fragmento');
  assert.ok(!skill.includes('source-body'), 'el campo de construccion no es un campo de la skill');
});

test('11.5 un fragmento ausente produce FRAGMENT_REQUIRED: la descripcion de activacion no sale del comando', () => {
  assert.throws(
    () => transformarComandoASkill(COMANDO_CON_AVISO, entradaDeSkill('implementar', 'antigravity', { fragmentContent: undefined })),
    /FRAGMENT_REQUIRED/
  );
});

test('11.6 un fragmento cuyo name no es el de su directorio produce SKILL_NAME_MISMATCH', () => {
  const desalineado = FRAGMENTO_DE_SKILL.replace('name: implementar', 'name: otra-cosa');

  assert.throws(
    () => transformarComandoASkill(
      COMANDO_CON_AVISO,
      entradaDeSkill('implementar', 'antigravity', { fragmentContent: desalineado }),
      cargarPolitica()
    ),
    err => /SKILL_NAME_MISMATCH/.test(err.message) && err.message.includes('.agents/skills/implementar/SKILL.md')
  );
});

test('11.7 un source-body con un valor desconocido produce INVALID_SOURCE_BODY en vez de adivinar', () => {
  const invalido = FRAGMENTO_DE_SKILL.replace('---\n\n## Alcance', 'source-body: quizas\n---\n\n## Alcance');

  assert.throws(
    () => transformarComandoASkill(
      COMANDO_CON_AVISO,
      entradaDeSkill('implementar', 'antigravity', { fragmentContent: invalido }),
      cargarPolitica()
    ),
    /INVALID_SOURCE_BODY/
  );
});

test('11.8 el modelo sale de la politica: un fragmento que declare uno no lo propaga', () => {
  const conModelo = FRAGMENTO_DE_SKILL.replace('name: implementar', 'name: implementar\nmodel: modelo-del-fragmento');

  const skill = transformarComandoASkill(
    COMANDO_CON_AVISO,
    entradaDeSkill('implementar', 'antigravity', { fragmentContent: conModelo }),
    cargarPolitica()
  );

  assert.ok(!skill.includes('modelo-del-fragmento'), 'el modelo del fichero fuente no llega a la salida');
  assert.ok(!/^model:/m.test(skill), 'Antigravity declara model_field: false, asi que no lleva el campo');
});

test('11.9 un backend que no lee .agents/skills/ produce BACKEND_NOT_SUPPORTED', () => {
  assert.throws(
    () => transformarComandoASkill(COMANDO_CON_AVISO, entradaDeSkill('implementar', 'gemini'), cargarPolitica()),
    /BACKEND_NOT_SUPPORTED: .*"gemini"/
  );
});

test('11.10 toda capacidad que Claude Code entrega como comando tiene su skill generada, no copiada a mano', () => {
  const manifiesto = cargarManifiesto();
  const comandos = fs.readdirSync(path.join(RAIZ, '.claude', 'commands'))
    .filter(nombre => nombre.endsWith('.md'))
    .map(nombre => path.basename(nombre, '.md'));

  assert.ok(comandos.length > 0, 'el backend de referencia no expone ningun comando');

  for (const nombre of comandos) {
    const salida = `.agents/skills/${nombre}/SKILL.md`;
    const entrada = manifiesto.artifacts.find(a => (a.outputs || []).some(o => o.path === salida));

    assert.ok(entrada, `${salida} no aparece como salida de ninguna entrada del manifiesto`);
    assert.strictEqual(
      entrada.mode,
      'managed',
      `${salida} es la entrega de "${nombre}" para Codex y Antigravity: si vuelve a mantenerse a mano, `
        + 'una instruccion anadida al comando deja de llegarles y nada lo detecta'
    );
  }
});

'use strict';

// Canary de paridad entre backends.
//
// El framework se distribuye para cuatro CLIs y casi todo existe por duplicado.
// Portar un agente o una skill a un backend y olvidarse de los demas no rompe
// nada de forma visible: simplemente, ese backend deja de poder hacer una parte
// del flujo. Este test convierte ese olvido en un fallo.
//
// QUE SE COMPARA: el conjunto de NOMBRES LOGICOS de agentes y de capacidades de
// cada backend. Una capacidad es un paso del flujo que el usuario puede invocar,
// venga empaquetado como comando o como skill: en Claude Code `/planificar` es un
// comando y `cleanup` una skill; en Codex y Antigravity ambos son skills. Por eso
// se compara la union comando+skill, no fichero a fichero.
//
// QUE NO SE COMPARA: el contenido de cada fichero. Que `planificar.toml` y
// `planificar/SKILL.md` describan el mismo proceso no lo verifica este test —
// lo verifica la revision de la PR. Los `.toml` de `commands/` NO estan
// deprecados (la CLI de Antigravity los convierte a skills al cargarlos dentro
// de un plugin), asi que cuentan como capacidad del backend Gemini.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

// Codex y Antigravity descubren sus skills en el MISMO directorio: no hay dos
// copias que puedan divergir. Compararlos entre si no verificaria nada (seria un
// directorio contra si mismo); lo que verifica algo es comparar cada uno con el
// backend de referencia, que es lo que hace assertParidad.
const SKILLS_COMPARTIDAS = '.agents/skills';

// Capacidades que solo tiene sentido ofrecer en un backend concreto porque dependen
// de algo que ese backend expone y los demas no. Portarlas al resto les daria una
// skill con instrucciones que ese backend no puede ejecutar. Excluidas de la
// comparacion de paridad; no confundir con un olvido de portar.
const CAPACIDADES_EXCLUSIVAS_POR_BACKEND = {
  // Depende del formato de transcripcion JSONL nativo de Claude Code en
  // ~/.claude/projects/: ningun otro backend lo produce.
  claude: ['auditar-sesion']
};

const TODAS_LAS_CAPACIDADES_EXCLUSIVAS = Object.values(CAPACIDADES_EXCLUSIVAS_POR_BACKEND).flat();

/** Backends activos. Anadir uno aqui lo mete en la comparacion. */
const BACKENDS = {
  claude: {
    agentes: [{ dir: '.claude/agents', ext: '.md' }],
    capacidades: [{ dir: '.claude/commands', ext: '.md' }, { dir: '.claude/skills' }],
    cableado: '.claude/settings.json'
  },
  gemini: {
    agentes: [{ dir: '.gemini/agents', ext: '.md' }],
    capacidades: [{ dir: '.gemini/commands', ext: '.toml' }, { dir: '.gemini/skills' }],
    cableado: 'hooks/hooks.json'
  },
  codex: {
    agentes: [{ dir: '.codex/agents', ext: '.toml' }],
    capacidades: [{ dir: SKILLS_COMPARTIDAS }],
    cableado: '.codex/hooks.json'
  },
  antigravity: {
    agentes: [{ dir: '.agents/plugins/sdd/agents', ext: '.md' }],
    capacidades: [{ dir: SKILLS_COMPARTIDAS }],
    cableado: '.agents/hooks.json'
  }
};

/** Nombres logicos de una fuente: basenames sin extension, o subdirectorios si no se da `ext`. */
function nombresDe(fuente) {
  const dir = path.join(RAIZ, fuente.dir);
  const entradas = fs.readdirSync(dir, { withFileTypes: true });

  if (!fuente.ext) {
    return entradas.filter(e => e.isDirectory()).map(e => e.name);
  }
  return entradas
    .filter(e => e.isFile() && e.name.endsWith(fuente.ext))
    .map(e => path.basename(e.name, fuente.ext));
}

function conjunto(fuentes) {
  const nombres = fuentes.flatMap(nombresDe);
  return [...new Set(nombres)].sort();
}

function diferencia(a, b) {
  return a.filter(x => !b.includes(x));
}

/** Quita las capacidades exclusivas de un backend antes de comparar; no aplica a agentes. */
function sinExclusivas(campo, lista) {
  if (campo !== 'capacidades') return lista;
  return lista.filter(nombre => !TODAS_LAS_CAPACIDADES_EXCLUSIVAS.includes(nombre));
}

/** Compara cada backend contra el primero y nombra lo que sobra y lo que falta. */
function assertParidad(campo) {
  const nombres = Object.keys(BACKENDS);
  const referencia = nombres[0];
  const esperado = sinExclusivas(campo, conjunto(BACKENDS[referencia][campo]));

  assert.ok(esperado.length > 0, `El backend de referencia (${referencia}) no expone ningun ${campo}`);

  for (const backend of nombres.slice(1)) {
    const actual = sinExclusivas(campo, conjunto(BACKENDS[backend][campo]));
    const faltan = diferencia(esperado, actual);
    const sobran = diferencia(actual, esperado);

    assert.deepStrictEqual(
      actual,
      esperado,
      `Paridad rota en ${campo}: ${backend} vs ${referencia}.`
        + (faltan.length ? ` Faltan en ${backend}: ${faltan.join(', ')}.` : '')
        + (sobran.length ? ` Solo en ${backend}: ${sobran.join(', ')}.` : '')
        + ' Al anadir un agente o una skill hay que portarlo a todos los backends.'
    );
  }
}

test('paridad: todos los backends exponen los mismos agentes', () => {
  assertParidad('agentes');
});

test('paridad: todos los backends exponen las mismas capacidades del flujo', () => {
  assertParidad('capacidades');
});

test('las capacidades exclusivas realmente no existen en los demas backends', () => {
  // Si alguna ya existiera en otro backend, la exclusion estaria ocultando una
  // paridad rota en vez de documentar un caso legitimo.
  for (const [duenio, nombres] of Object.entries(CAPACIDADES_EXCLUSIVAS_POR_BACKEND)) {
    for (const backend of Object.keys(BACKENDS)) {
      if (backend === duenio) continue;
      const actual = conjunto(BACKENDS[backend].capacidades);
      for (const nombre of nombres) {
        assert.ok(
          !actual.includes(nombre),
          `"${nombre}" se declara exclusiva de ${duenio} pero tambien existe en ${backend}: `
            + 'la exclusion ya no aplica, hay que quitarla y tratarla como capacidad compartida.'
        );
      }
    }
  }
});

test('la skill exclusiva de Claude Code tiene frontmatter valido', () => {
  const ruta = path.join(RAIZ, '.claude/skills/auditar-sesion/SKILL.md');
  const contenido = fs.readFileSync(ruta, 'utf8');

  assert.match(contenido, /^---\nname: auditar-sesion\n/, 'falta el frontmatter con name: auditar-sesion');
  assert.match(contenido, /\ndescription: ".+"\n/, 'falta description en el frontmatter');
});

test('codex y antigravity leen las skills del mismo directorio, por diseno', () => {
  // Fija la premisa que permite no compararlos entre si: si algun dia uno de los
  // dos pasa a tener su propio directorio de skills, este test falla y hay que
  // volver a compararlos.
  assert.deepStrictEqual(BACKENDS.codex.capacidades, [{ dir: SKILLS_COMPARTIDAS }]);
  assert.deepStrictEqual(BACKENDS.antigravity.capacidades, [{ dir: SKILLS_COMPARTIDAS }]);
});

// ── Exhaustividad del manifiesto de skills de Claude Code ────────────────────
//
// backend-manifest.json no usa una entrada comodin de directorio para las
// skills de Claude Code: las lista una a una en claude.core y claude.optional.
// Crear una skill en disco y olvidarse de anadirla aqui no rompe nada de forma
// visible: la skill simplemente nunca se copia a un proyecto destino. Este
// test compara el disco contra el manifiesto en ambas direcciones.

/** Nombres de skill que el manifiesto declara bajo .claude/skills/. */
function skillsDeclaradasEnManifiesto() {
  const manifiesto = JSON.parse(leer('scripts/backend-manifest.json'));
  const rutas = [
    ...manifiesto.claude.core,
    ...manifiesto.claude.optional.flatMap(entrada => entrada.rutas)
  ];
  return rutas
    .filter(ruta => ruta.startsWith('.claude/skills/'))
    .map(ruta => ruta.replace('.claude/skills/', ''));
}

test('exhaustividad: toda skill en .claude/skills/ esta registrada en backend-manifest.json', () => {
  const enDisco = nombresDe({ dir: '.claude/skills' });
  const enManifiesto = skillsDeclaradasEnManifiesto();

  const sinRegistrar = diferencia(enDisco, enManifiesto);
  assert.deepStrictEqual(
    sinRegistrar,
    [],
    `Skills en .claude/skills/ sin registrar en scripts/backend-manifest.json: ${sinRegistrar.join(', ')}.`
  );

  const fantasma = diferencia(enManifiesto, enDisco);
  assert.deepStrictEqual(
    fantasma,
    [],
    `scripts/backend-manifest.json registra skills que ya no existen en disco: ${fantasma.join(', ')}.`
  );
});

// ── Hooks cableados en cada backend ──────────────────────────────────────────
//
// Los guards no estan al mismo nivel en los cuatro backends, y eso es deliberado:
//   - Los dos guards del ciclo (escrituras no planificadas, formato de commit)
//     existen en todos. Que uno se caiga de un backend es un olvido, no un diseno.
//   - El aviso de revision (sdd-review-gate) solo se cablea donde el flujo emite
//     la senal que lo silencia: el backend con motor de workflows. Cablearlo donde
//     no hay emisor daria un aviso imposible de atender por vias legitimas.

const GUARDS_DEL_CICLO = ['sdd-pipeline-guard', 'sdd-commit-guard'];
const AVISO_DE_REVISION = 'sdd-review-gate';
const BACKEND_CON_MOTOR_DE_WORKFLOWS = 'claude';

/** Nombres logicos de los hooks que un fichero de cableado invoca (sin sufijo de backend). */
function hooksCableados(backend) {
  const texto = leer(BACKENDS[backend].cableado)
    .replace(/"_[a-zA-Z_]+":\s*"[^"]*"/g, ''); // los comentarios _* no cablean nada
  const nombres = (texto.match(/sdd-[a-z-]+?(?:-codex)?\.js/g) || [])
    .map(f => f.replace(/(?:-codex)?\.js$/, ''));
  return [...new Set(nombres)].sort();
}

test('paridad: todos los backends cablean los dos guards del ciclo', () => {
  for (const backend of Object.keys(BACKENDS)) {
    const cableados = hooksCableados(backend);
    for (const guard of GUARDS_DEL_CICLO) {
      assert.ok(
        cableados.includes(guard),
        `${backend} no cablea ${guard} en ${BACKENDS[backend].cableado}. `
          + `Cablea: ${cableados.join(', ') || 'nada'}.`
      );
    }
  }
});

test('el aviso de revision solo se cablea donde hay emisor de la senal', () => {
  for (const backend of Object.keys(BACKENDS)) {
    const loCablea = hooksCableados(backend).includes(AVISO_DE_REVISION);
    const deberia = backend === BACKEND_CON_MOTOR_DE_WORKFLOWS;

    assert.strictEqual(
      loCablea,
      deberia,
      deberia
        ? `${backend} tiene el motor de workflows que emite la senal: debe cablear ${AVISO_DE_REVISION}`
        : `${backend} no tiene emisor de la senal de revision: cablear ${AVISO_DE_REVISION} ahi daria `
          + 'un aviso que nadie puede silenciar por una via legitima'
    );
  }
});

// ── Hooks cableados y su rastro en la documentacion ──────────────────────────
//
// Un hook cableado por defecto y ausente de la documentacion es invisible para
// quien recibe el framework: corre en su maquina y no aparece en ninguno de los
// dos sitios donde lo buscaria (su documento de instrucciones y el README). Se
// comprueba por nombre logico, asi que la variante `-codex` cuenta como el mismo
// hook. Los documentos de instrucciones son salidas generadas: si este test
// falla, la correccion va en `docs-src/` y luego `node scripts/compile.js --write`.

const DOC_DE_INSTRUCCIONES = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md',
  codex: 'AGENTS.md',
  antigravity: 'AGENTS.md'
};

test('todo hook cableado aparece en el documento de instrucciones de su backend', () => {
  for (const backend of Object.keys(BACKENDS)) {
    const doc = DOC_DE_INSTRUCCIONES[backend];
    const contenido = leer(doc);

    for (const hook of hooksCableados(backend)) {
      assert.ok(
        contenido.includes(hook),
        `${doc} no menciona ${hook}, cableado en ${BACKENDS[backend].cableado}. `
          + 'Un hook activo sin documentar corre sin que su usuario pueda saberlo.'
      );
    }
  }
});

test('todo hook cableado en algun backend aparece en el README', () => {
  const readme = leer('README.md');
  const todos = [...new Set(Object.keys(BACKENDS).flatMap(hooksCableados))].sort();

  for (const hook of todos) {
    assert.ok(
      readme.includes(hook),
      `README.md no menciona ${hook}, cableado en al menos un backend. `
        + 'El inventario de hooks del README es donde se busca que corre en el proyecto.'
    );
  }
});

// ── Conteos citados en la documentacion ──────────────────────────────────────
//
// La doc cita cuantas plantillas hay. Un conteo escrito a mano envejece en
// silencio; aqui se ata a la fuente: si se anade o se borra una plantilla sin
// actualizar el documento que la cuenta, el test falla.

function contarPlantillas(dir) {
  return fs.readdirSync(path.join(RAIZ, dir))
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .length;
}

function leer(rutaRelativa) {
  return fs.readFileSync(path.join(RAIZ, rutaRelativa), 'utf8');
}

test('conteos: la documentacion cita el numero real de plantillas', () => {
  const operativas = contarPlantillas('ai_docs/dev_templates');
  const iniciales = contarPlantillas('ai_docs/core_templates');

  const planificacion = leer('ai_docs/core/planificacion_tecnica.md');
  assert.match(
    planificacion,
    new RegExp(`${operativas} plantillas operativas`),
    `planificacion_tecnica.md no cita las ${operativas} plantillas operativas que hay en ai_docs/dev_templates/`
  );
  assert.match(
    planificacion,
    new RegExp(`${iniciales} plantillas de planificacion inicial`),
    `planificacion_tecnica.md no cita las ${iniciales} plantillas que hay en ai_docs/core_templates/`
  );

  const roadmap = leer('ai_docs/core/roadmap.md');
  assert.match(
    roadmap,
    new RegExp(`${operativas} plantillas operativas`),
    `roadmap.md no cita las ${operativas} plantillas operativas que hay en ai_docs/dev_templates/`
  );
});

// ── Versiones de los manifiestos ─────────────────────────────────────────────

test('los manifiestos vigentes declaran la misma version', () => {
  const version = m => JSON.parse(leer(m)).version;

  assert.strictEqual(version('gemini-extension.json'), version('package.json'), 'gemini-extension.json y package.json declaran versiones distintas');
});

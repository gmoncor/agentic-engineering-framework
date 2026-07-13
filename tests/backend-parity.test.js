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

/** Backends activos. Anadir uno aqui lo mete en la comparacion. */
const BACKENDS = {
  claude: {
    agentes: [{ dir: '.claude/agents', ext: '.md' }],
    capacidades: [{ dir: '.claude/commands', ext: '.md' }, { dir: '.claude/skills' }],
    cableado: '.claude/settings.json'
  },
  gemini: {
    agentes: [{ dir: 'agents', ext: '.md' }],
    capacidades: [{ dir: 'commands', ext: '.toml' }, { dir: 'skills' }],
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

/** Compara cada backend contra el primero y nombra lo que sobra y lo que falta. */
function assertParidad(campo) {
  const nombres = Object.keys(BACKENDS);
  const referencia = nombres[0];
  const esperado = conjunto(BACKENDS[referencia][campo]);

  assert.ok(esperado.length > 0, `El backend de referencia (${referencia}) no expone ningun ${campo}`);

  for (const backend of nombres.slice(1)) {
    const actual = conjunto(BACKENDS[backend][campo]);
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

test('codex y antigravity leen las skills del mismo directorio, por diseno', () => {
  // Fija la premisa que permite no compararlos entre si: si algun dia uno de los
  // dos pasa a tener su propio directorio de skills, este test falla y hay que
  // volver a compararlos.
  assert.deepStrictEqual(BACKENDS.codex.capacidades, [{ dir: SKILLS_COMPARTIDAS }]);
  assert.deepStrictEqual(BACKENDS.antigravity.capacidades, [{ dir: SKILLS_COMPARTIDAS }]);
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

test('los tres manifiestos declaran la misma version', () => {
  const version = m => JSON.parse(leer(m)).version;
  const plugin = version('.claude-plugin/plugin.json');

  assert.strictEqual(version('package.json'), plugin, 'package.json y plugin.json declaran versiones distintas');
  assert.strictEqual(version('gemini-extension.json'), plugin, 'gemini-extension.json y plugin.json declaran versiones distintas');
});

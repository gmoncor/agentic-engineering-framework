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

const { parsearFrontmatter, listaDe } = require('../scripts/transforms/frontmatter');
const { sandboxDe } = require('../scripts/transforms/policy-lookup');

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

// ── Enforcement de los roles de solo lectura ─────────────────────────────────
//
// La paridad de nombres no dice si un backend impide de verdad que asesor y
// revisor escriban: cada uno traduce esa restriccion a un mecanismo propio
// (sandbox de plataforma, lista de herramientas del frontmatter), y la unica
// fuente que declara cual es cada uno es scripts/model-policy.json. Este caso
// no repite aqui la lista de que backend tiene que: lee la politica y el
// artefacto generado, y falla si un backend no tiene ni mecanismo ni una
// excepcion declarada, o si el mecanismo declarado no bloquea la escritura.

const POLITICA = require('../scripts/model-policy.json');
const ROLES_SOLO_LECTURA = ['asesor', 'revisor'];

// Nombre de la herramienta de escritura en el vocabulario propio de cada
// backend con frontmatter de herramientas. Codex no aparece: no tiene
// vocabulario de herramientas, resuelve por `sandbox_mode`.
const HERRAMIENTA_DE_ESCRITURA = {
  claude: 'Write',
  gemini: 'write_file',
  antigravity: 'replace_file_content'
};

const DIR_AGENTES = {
  claude: { dir: '.claude/agents', ext: '.md' },
  gemini: { dir: '.gemini/agents', ext: '.md' },
  antigravity: { dir: '.agents/plugins/sdd/agents', ext: '.md' }
};

/** Herramientas declaradas en el frontmatter del artefacto Markdown de `rol` en `backend`. */
function herramientasDeclaradas(backend, rol) {
  const ruta = path.join(DIR_AGENTES[backend].dir, `${rol}${DIR_AGENTES[backend].ext}`);
  const { campos } = parsearFrontmatter(leer(ruta), ruta);
  return listaDe(campos, 'tools');
}

/**
 * Mecanismo de enforcement de `rol` en `backend`: `{ bloqueada }` si el backend
 * declara algo comprobable, o `undefined` si no declara ninguno. `bloqueada`
 * es el hecho que importa: que la escritura este realmente excluida, no que
 * exista una clave con ese nombre.
 */
function mecanismoDe(backend, rol) {
  if (backend === 'codex') {
    if (!POLITICA.backends.codex.sandbox_mode) return undefined;
    return { bloqueada: sandboxDe(POLITICA, 'codex', rol) === 'read-only' };
  }

  if (backend === 'antigravity' && !POLITICA.backends.antigravity.tools_allowlist) {
    return undefined;
  }

  const declaradas = herramientasDeclaradas(backend, rol);
  if (!declaradas.length) return undefined;
  return { bloqueada: !declaradas.includes(HERRAMIENTA_DE_ESCRITURA[backend]) };
}

/** `true` si la politica declara explicitamente que `backend` no tiene mecanismo mecanico. */
function excepcionDeclarada(backend) {
  const texto = JSON.stringify([POLITICA.backends[backend] || {}, POLITICA.conventions]);
  return /limitacion|sin restriccion mecanica/i.test(texto);
}

test('la capa de enforcement de solo lectura existe o esta declarada como excepcion', () => {
  for (const backend of Object.keys(BACKENDS)) {
    for (const rol of ROLES_SOLO_LECTURA) {
      const mecanismo = mecanismoDe(backend, rol);

      if (mecanismo === undefined) {
        assert.ok(
          excepcionDeclarada(backend),
          `${backend} no declara mecanismo de enforcement de solo lectura para "${rol}" ni una `
            + 'excepcion en scripts/model-policy.json: la asimetria quedaria sin declarar.'
        );
        continue;
      }

      assert.ok(
        mecanismo.bloqueada,
        `${backend} declara mecanismo para "${rol}" pero no bloquea la escritura: la promesa de `
          + 'solo lectura (read-only) queda escrita en la politica y no aplicada en el artefacto.'
      );
    }
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

// El caso anterior comprueba que el HOOK aparezca en el README, no DONDE se
// cablea: un README que nombrase los hooks sin decir en que fichero de cada
// backend se activan pasaria igual. El ancla aqui es la ruta `cableado`, no
// el nombre del hook.
const CABECERA_HOOKS = '## Hooks (enforcement mecanico)';
const CIERRE_MODELO_POR_DEFECTO = '**Modelo por defecto';

/**
 * Seccion "## Hooks (enforcement mecanico)" del README, acotada hasta la
 * siguiente cabecera `## ` o hasta el parrafo del modelo por defecto, lo que
 * venga antes. Sin el segundo limite, `.claude/settings.json` sigue nombrado
 * mas abajo en la nota del modelo y satisface el ancla de Claude Code aunque
 * el parrafo de wiring se borre entero.
 */
function seccionDeHooks(readme) {
  const inicio = readme.indexOf(CABECERA_HOOKS);
  assert.notStrictEqual(inicio, -1, `README.md no tiene la cabecera "${CABECERA_HOOKS}".`);

  const limites = [
    readme.indexOf('\n## ', inicio + 1),
    readme.indexOf(CIERRE_MODELO_POR_DEFECTO, inicio)
  ].filter(indice => indice !== -1);

  return readme.slice(inicio, limites.length ? Math.min(...limites) : readme.length);
}

test('todo backend nombra su fichero de cableado en la seccion de Hooks del README', () => {
  const seccion = seccionDeHooks(leer('README.md'));

  for (const [backend, { cableado }] of Object.entries(BACKENDS)) {
    assert.ok(
      seccion.includes(cableado),
      `La seccion "${CABECERA_HOOKS}" del README no nombra ${cableado}, el fichero de cableado de `
        + `${backend}. Sin esa ruta, quien lee la seccion no sabe con que fichero se activa el `
        + 'enforcement en su backend.'
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

// ── Tabla "Que se instala": los mismos conteos, declarados por segunda vez ──
//
// La seccion "### Que se instala" repite en una tabla los conteos que el
// resto de este fichero ya calcula desde el disco (agentes, comandos, skills,
// hooks cableados) mas los de dev_templates/core_templates. Nada ataba esa
// tabla a esas fuentes: un agente o una skill nuevos actualizaban la paridad
// de arriba sin tocar la tabla, que quedaba desactualizada en silencio.

function seccionQueSeInstala(readme) {
  const inicio = readme.indexOf('### Que se instala');
  assert.notStrictEqual(inicio, -1, 'README.md no tiene la seccion "### Que se instala".');
  const fin = readme.indexOf('\n---', inicio);
  return readme.slice(inicio, fin === -1 ? readme.length : fin);
}

test('conteos: la tabla "Que se instala" del README cita los numeros reales por backend', () => {
  const seccion = seccionQueSeInstala(leer('README.md'));
  const nombres = Object.keys(BACKENDS);

  // Comandos: solo Claude y Gemini tienen directorio propio de comandos
  // (Codex y Antigravity los entregan como skills, sin conteo que citar aqui).
  for (const backend of ['claude', 'gemini']) {
    const cuenta = nombresDe(BACKENDS[backend].capacidades[0]).length;
    assert.match(
      seccion,
      new RegExp(`commands/\`\\s*\\(${cuenta}\\)`),
      `Comandos de ${backend}: la tabla no cita ${cuenta}.`
    );
  }

  // Skills: cada backend cita su propio conteo (Codex y Antigravity comparten
  // fuente, pero cada uno tiene su propia celda en la tabla).
  const fuenteDeSkills = {
    claude: BACKENDS.claude.capacidades[1],
    gemini: BACKENDS.gemini.capacidades[1],
    codex: BACKENDS.codex.capacidades[0],
    antigravity: BACKENDS.antigravity.capacidades[0]
  };
  for (const backend of nombres) {
    const cuenta = nombresDe(fuenteDeSkills[backend]).length;
    assert.match(
      seccion,
      new RegExp(`skills/\`\\s*\\(${cuenta}\\)`),
      `Skills de ${backend}: la tabla no cita ${cuenta}.`
    );
  }

  // Agentes: los cuatro backends citan su conteo, con o sin sufijo (Codex
  // anade ", \`.toml\`" en la misma celda).
  for (const backend of nombres) {
    const cuenta = nombresDe(BACKENDS[backend].agentes[0]).length;
    assert.match(
      seccion,
      new RegExp(`agents/\`\\s*\\(${cuenta}(,|\\))`),
      `Agentes de ${backend}: la tabla no cita ${cuenta}.`
    );
  }

  // Hooks: el conteo es el de hooks realmente cableados (hooksCableados), no
  // el de ficheros en hooks/ — la tabla cita cuantos corren, no cuantos existen.
  for (const backend of nombres) {
    const cuenta = hooksCableados(backend).length;
    assert.match(
      seccion,
      new RegExp(`\\(${cuenta}, wired`),
      `Hooks de ${backend}: la tabla no cita ${cuenta} hooks cableados.`
    );
  }

  // Workflows: exclusivo de Claude Code, el unico backend con motor propio.
  const workflows = fs.readdirSync(path.join(RAIZ, '.claude/workflows')).filter(f => f.endsWith('.js')).length;
  assert.match(
    seccion,
    new RegExp(`workflows/\`\\s*\\(${workflows}\\)`),
    `Workflows: la tabla no cita ${workflows}.`
  );

  // Templates y core templates: mismo conteo citado una vez por backend.
  const operativas = contarPlantillas('ai_docs/dev_templates');
  const iniciales = contarPlantillas('ai_docs/core_templates');

  const vecesDevTemplates = (seccion.match(new RegExp(`dev_templates/\`\\s*\\(${operativas}\\)`, 'g')) || []).length;
  assert.strictEqual(
    vecesDevTemplates,
    nombres.length,
    `dev_templates: se esperaban ${nombres.length} menciones de (${operativas}) en la tabla, hay ${vecesDevTemplates}.`
  );

  const vecesCoreTemplates = (seccion.match(new RegExp(`core_templates/\`\\s*\\(${iniciales}\\)`, 'g')) || []).length;
  assert.strictEqual(
    vecesCoreTemplates,
    nombres.length,
    `core_templates: se esperaban ${nombres.length} menciones de (${iniciales}) en la tabla, hay ${vecesCoreTemplates}.`
  );
});

// ── Versiones de los manifiestos ─────────────────────────────────────────────

test('los manifiestos vigentes declaran la misma version', () => {
  const version = m => JSON.parse(leer(m)).version;

  assert.strictEqual(version('gemini-extension.json'), version('package.json'), 'gemini-extension.json y package.json declaran versiones distintas');
});

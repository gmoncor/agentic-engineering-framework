'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MATRIX_PATH = path.join(ROOT, 'docs-src', 'fragments', 'agents.md');
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'artifact-manifest.json');
const { ensamblarDocumento } = require('../scripts/transforms/doc-fragment-assembly');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function erroresDeSesionIndependiente(content) {
  const errors = [];
  if (!/Es una recomendación, no un bloqueo/.test(content)) {
    errors.push('SESSION_RECOMMENDATION_BLOCKS');
  }
  if (!/petición (?:ya )?(?:incluía|incluye) planificar e implementar[\s\S]*continúa sin (?:pedir )?otra aprobación/.test(content)) {
    errors.push('COMBINED_REQUEST_REQUIRES_EXTRA_AUTHORIZATION');
  }
  if (!/primer mensaje (?:después del plan aprobado|posterior)[\s\S]*recomendación[\s\S]*antes de (?:iniciar la implementación|implementar)/.test(content)) {
    errors.push('COMBINED_REQUEST_OMITS_EARLY_RECOMMENDATION');
  }
  return errors;
}

function erroresDeUnaTarea(content) {
  const errors = [];
  if (!/una sola tarea de producto/.test(content)) errors.push('SESSION_MISSING_SINGLE_PRODUCT_TASK');
  if (/--parallel|niveles de dependencia/.test(content)) {
    errors.push('SESSION_REINTRODUCES_MULTI_TASK_FLOW');
  }
  return errors;
}

function restosDeFrasesMultitareaOlvidadas(content) {
  const textos = [
    ['CORE_DEPENDENCY_ORDER', 'la independencia entre tasks informa el orden; secuencial o concurrente lo decide quien ejecuta. Revisi\u00f3n adversarial antes de cada commit.'],
    ['CLAUDE_IMPLEMENT_SPEC_ROW', '**Workflow completo**: implementa cada task en orden de dependencias + revision por task'],
    ['GEMINI_IMPLEMENT_SPEC_ROW', 'Implementa tasks en orden de dependencias + revision por task'],
    ['README_DEPENDENCY_ORDER', '**implementacion en orden de dependencias** (revision adversarial por task antes del commit).'],
  ];
  return textos.filter(([, texto]) => content.includes(texto)).map(([code]) => code);
}

function restosDeEjecucionMultitarea(content) {
  const patterns = [
    ['MULTI_TASK_COMMAND', /\/implementar-spec/],
    ['MULTI_TASK_FLAG', /--parallel/],
    ['MULTI_TASK_LEVELS', /niveles de dependencia/i],
    ['MULTI_TASK_ORDER', /tasks en orden/i],
    ['MULTI_TASK_ALL', /todas las tasks/i],
  ];
  return patterns.filter(([, pattern]) => pattern.test(content)).map(([code]) => code);
}

function restosDeFlujoManualMultitarea(content) {
  const patterns = [
    ['MULTI_TASK_FLOW', /Se implementan las tasks de la spec/],
    ['MULTI_TASK_START', /(?:pedir|escribir) `implementa la spec <ruta de la spec>`|con `\/implementar-spec <ruta de la spec>`/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(content)).map(([code]) => code);
}

function matrixSection(content) {
  const match = content.match(/## Matriz de intención y enrutado\r?\n([\s\S]*?)(?=\r?\n## |$)/);
  assert.ok(match, 'la matriz de intención y enrutado debe existir');
  return match[1];
}

function routedCapabilities(content) {
  const rows = matrixSection(content).split(/\r?\n/).filter((line) => line.startsWith('|'));
  const capabilities = new Map();
  for (const row of rows.slice(2)) {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    const [intent, destination, type, mode] = cells;
    const manifestType = type === 'agente' ? 'agent' : type;
    for (const identifier of destination.matchAll(/`([^`]+)`/g)) {
      capabilities.set(`${manifestType}:${identifier[1]}`, { intent, mode });
    }
  }
  return capabilities;
}

function manifestCapabilities(manifest) {
  return manifest.artifacts
    .filter((artifact) => /^(agent|skill)-/.test(artifact.id))
    .map((artifact) => {
      const [type, ...name] = artifact.id.split('-');
      return `${type}:${name.join('-')}`;
    })
    .sort();
}

function validateMatrix(content, manifest) {
  const expected = manifestCapabilities(manifest);
  const routed = routedCapabilities(content);
  const actual = [...routed.keys()].sort();
  const errors = [];

  for (const capability of expected) {
    if (!routed.has(capability)) errors.push(`MATRIX_MISSING_CAPABILITY: ${capability}`);
  }
  for (const capability of actual) {
    if (!expected.includes(capability)) errors.push(`MATRIX_UNKNOWN_CAPABILITY: ${capability}`);
  }
  for (const [capability, { intent, mode }] of routed) {
    if (!intent) errors.push(`MATRIX_MISSING_INTENT: ${capability}`);
    if (mode.startsWith('manual') && !/manual:\s+\S/i.test(mode)) {
      errors.push(`MATRIX_MANUAL_WITHOUT_REASON: ${capability}`);
    }
  }
  return errors;
}

test('la matriz enruta en ambos sentidos todas las skills y agentes del manifiesto', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const errors = validateMatrix(fs.readFileSync(MATRIX_PATH, 'utf8'), manifest);
  assert.deepStrictEqual(errors, []);
});

test('control negativo: una capacidad del manifiesto sin fila deja la matriz en rojo', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.artifacts.push({ id: 'skill-sin-fila' });
  const errors = validateMatrix(fs.readFileSync(MATRIX_PATH, 'utf8'), manifest);
  assert.ok(errors.includes('MATRIX_MISSING_CAPABILITY: skill:sin-fila'));
});

test('control negativo: una fila que no existe en el manifiesto deja la matriz en rojo', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const content = fs.readFileSync(MATRIX_PATH, 'utf8').replace(
    '| Iniciar un proyecto | `inicio` | skill | automático |',
    '| Iniciar un proyecto | `inexistente` | skill | automático |',
  );
  const errors = validateMatrix(content, manifest);
  assert.ok(errors.includes('MATRIX_UNKNOWN_CAPABILITY: skill:inexistente'));
});

test('las instrucciones compiladas conservan el contrato conversacional y su adaptación', () => {
  const commonHeadings = [
    '## Contrato conversacional',
    '### Siguiente paso recomendado',
    '### Sesión independiente recomendada',
    '### Degradación sin subagentes',
    '## Retomar una task',
    '## Cuándo despachar',
    '## Evidencia proporcional al riesgo',
    '## Recepción de resultados',
    '## Releer antes de reintentar',
  ];
  for (const output of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const content = read(output);
    for (const heading of commonHeadings) assert.match(content, new RegExp(heading));
  }

  assert.match(read('AGENTS.md'), /## Sesión independiente recomendada[\s\S]*implementa la tarea <ruta de la tarea>/);
  assert.match(read('CLAUDE.md'), /## Sesión independiente recomendada[\s\S]*\/implementar <ruta de la tarea>/);
  assert.match(read('GEMINI.md'), /## Sesión independiente recomendada[\s\S]*implementa la tarea <ruta de la tarea>/);
  assert.match(read('GEMINI.md'), /## Ejecución sin subagentes[\s\S]*ejecuta en serie[\s\S]*no anuncia subagentes/);
  for (const output of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const content = read(output);
    for (const state of ['PENDIENTE', 'EN_PROGRESO', 'PARCIAL', 'FALLIDA', 'BLOQUEADA_REVISION', 'COMPLETADA']) {
      assert.match(content, new RegExp('`' + state + '`'));
    }
    for (const stage of ['consulta', 'orientación', 'plan', 'implementación', 'entrega', 'revisión']) {
      assert.match(content, new RegExp(stage, 'i'));
    }
  }
  assert.match(read('CLAUDE.md'), /aviso intermedio de subagente[\s\S]*no es una entrega/);
});

test('control negativo: retirar el contrato común impide acreditar las proyecciones', () => {
  const content = read('CLAUDE.md').replace('### Siguiente paso recomendado', '### Paso siguiente');
  assert.doesNotMatch(content, /### Siguiente paso recomendado/);
});

test('el contrato recomienda una sesión independiente sin bloquear la petición conjunta', () => {
  const core = read('docs-src/core.md');
  assert.deepStrictEqual(erroresDeSesionIndependiente(core), []);
  for (const output of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    assert.deepStrictEqual(erroresDeSesionIndependiente(read(output)), []);
  }

  const mutanteBloqueo = core.replace('Es una recomendación, no un bloqueo.', 'Es un bloqueo.');
  assert.deepStrictEqual(erroresDeSesionIndependiente(mutanteBloqueo), [
    'SESSION_RECOMMENDATION_BLOCKS',
  ]);

  const mutanteAutorizacion = core.replace(
    'el primer mensaje después del plan aprobado empieza con la recomendación, antes de iniciar la implementación, y continúa sin otra aprobación.',
    'pide otra aprobación antes de continuar.',
  );
  assert.deepStrictEqual(erroresDeSesionIndependiente(mutanteAutorizacion), [
    'COMBINED_REQUEST_REQUIRES_EXTRA_AUTHORIZATION',
    'COMBINED_REQUEST_OMITS_EARLY_RECOMMENDATION',
  ]);

  const mutanteTardio = core.replace(
    'el primer mensaje después del plan aprobado empieza con la recomendación, antes de iniciar la implementación, y continúa sin otra aprobación.',
    'continúa la implementación y emite la recomendación al cerrar.',
  );
  assert.deepStrictEqual(erroresDeSesionIndependiente(mutanteTardio), [
    'COMBINED_REQUEST_REQUIRES_EXTRA_AUTHORIZATION',
    'COMBINED_REQUEST_OMITS_EARLY_RECOMMENDATION',
  ]);
});

test('el README conserva una tarea de producto por sesión y rechaza reintroducir el flujo multitarea', () => {
  const readme = read('README.md');
  assert.deepStrictEqual(erroresDeUnaTarea(readme), []);

  const mutante = readme.replace(
    'No hay un máximo fijo de ficheros ni un flujo que ejecute varias tareas de producto a la vez.',
    'El flujo ejecuta varias tareas de producto a la vez con --parallel.',
  );
  assert.deepStrictEqual(erroresDeUnaTarea(mutante), [
    'SESSION_REINTRODUCES_MULTI_TASK_FLOW',
  ]);
});

test('la documentación pública no promete ejecutar varias tareas de producto', () => {
  for (const document of ['README.md', 'CONTRIBUTING.md', 'ai_docs/dev_templates/actualizar_framework.md']) {
    assert.deepStrictEqual(restosDeEjecucionMultitarea(read(document)), [], document);
  }

  const mutante = read('README.md').replace(
    'implementa la tarea seleccionada y aplica una revisión adversarial antes del commit.',
    'ejecuta todas las tasks en orden de dependencias con --parallel.',
  );
  assert.deepStrictEqual(restosDeEjecucionMultitarea(mutante), [
    'MULTI_TASK_FLAG',
    'MULTI_TASK_ORDER',
    'MULTI_TASK_ALL',
  ]);
});

test('las fuentes rechazan las cuatro frases multitarea anteriores', () => {
  const fuentes = [
    'docs-src/core.md',
    'docs-src/fragments/claude.md',
    'docs-src/fragments/gemini.md',
    'README.md',
  ];
  for (const fuente of fuentes) {
    assert.deepStrictEqual(restosDeFrasesMultitareaOlvidadas(read(fuente)), [], fuente);
  }

  const mutanteCore = read('docs-src/core.md').replace(
    'en cada sesi\u00f3n, elige una sola task con dependencias satisfechas. Puede usar paralelismo interno, pero no ejecuta m\u00faltiples tasks. Revisi\u00f3n adversarial antes de cada commit.',
    'la independencia entre tasks informa el orden; secuencial o concurrente lo decide quien ejecuta. Revisi\u00f3n adversarial antes de cada commit.',
  );
  assert.deepStrictEqual(restosDeFrasesMultitareaOlvidadas(mutanteCore), ['CORE_DEPENDENCY_ORDER']);

  const mutanteClaude = read('docs-src/fragments/claude.md').replace(
    'Selecciona una task con dependencias satisfechas + revision antes del commit',
    '**Workflow completo**: implementa cada task en orden de dependencias + revision por task',
  );
  assert.deepStrictEqual(restosDeFrasesMultitareaOlvidadas(mutanteClaude), ['CLAUDE_IMPLEMENT_SPEC_ROW']);

  const mutanteGemini = read('docs-src/fragments/gemini.md').replace(
    'Selecciona una sola task con dependencias satisfechas; permite paralelismo interno + revision por task antes del commit',
    'Implementa tasks en orden de dependencias + revision por task',
  );
  assert.deepStrictEqual(restosDeFrasesMultitareaOlvidadas(mutanteGemini), ['GEMINI_IMPLEMENT_SPEC_ROW']);

  const mutanteReadme = read('README.md').replace(
    '**implementacion de una sola tarea seleccionada por sesion con dependencias satisfechas** (revision adversarial antes del commit; se permite paralelismo interno, pero no ejecutar multiples tasks).',
    '**implementacion en orden de dependencias** (revision adversarial por task antes del commit).',
  );
  assert.deepStrictEqual(restosDeFrasesMultitareaOlvidadas(mutanteReadme), ['README_DEPENDENCY_ORDER']);
});

test('las fuentes y proyecciones no dirigen el flujo manual a varias tareas', () => {
  for (const document of [
    'docs-src/core.md',
    'docs-src/fragments/agents.md',
    'docs-src/fragments/claude.md',
    'docs-src/fragments/gemini.md',
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
  ]) {
    assert.deepStrictEqual(restosDeFlujoManualMultitarea(read(document)), [], document);
  }

  const mutante = read('docs-src/fragments/agents.md').replace(
    'Se implementa la tarea seleccionada + revision adversarial del codigo',
    'Se implementan las tasks de la spec + revision adversarial del codigo',
  );
  assert.deepStrictEqual(restosDeFlujoManualMultitarea(mutante), ['MULTI_TASK_FLOW']);
});

test('mutante fuente-compilación: retirar el siguiente paso del núcleo lo retira de toda proyección', () => {
  const core = read('docs-src/core.md');
  const mutant = core.replace('### Siguiente paso recomendado', '### Paso siguiente');
  assert.notStrictEqual(mutant, core, 'el mutante debe alterar la fuente canónica');
  for (const backend of ['agents', 'claude', 'gemini']) {
    const output = ensamblarDocumento(mutant, read(`docs-src/fragments/${backend}.md`), {
      output: { backend }, variables: { VERSION: 'test' },
    });
    assert.doesNotMatch(output, /### Siguiente paso recomendado/);
  }
});

'use strict';

// Contrato de la orquestacion de /implementar-spec: que se puede lanzar a la vez
// y que no. Los fixtures usan el formato REAL de tasks (dev_templates/tareas.md).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, writeFile } = require('./helpers');
const orq = require('../../.claude/workflows/lib/orquestacion');

function taskDoc(archivos) {
  return [
    '# Task: fixture',
    '',
    '## Archivos afectados',
    '',
    '| Archivo | Accion | Descripcion del cambio |',
    '|---------|--------|----------------------|',
  ].concat(archivos.map(a => '| `' + a + '` | MODIFICAR | cambio |')).join('\n') + '\n';
}

/** Proyecto temporal con una task por entrada: { '001_a.md': ['src/a.js'] }. */
function proyecto(tasks) {
  const raiz = tempDir('sdd-orq-');
  const lista = [];
  for (const [nombre, archivos] of Object.entries(tasks)) {
    const rel = path.join('ai_docs', 'tasks', nombre);
    writeFile(path.join(raiz, rel), taskDoc(archivos));
    lista.push({ path: rel, titulo: nombre, independiente: true });
  }
  return { raiz, tasks: lista };
}

function conDeps(tasks, deps) {
  return tasks.map(t => Object.assign({}, t, { dependencias: deps[path.basename(t.path)] || [] }));
}

// ── Ciclos ───────────────────────────────────────────────────────────────────

test('computeWaves: tasks sin dependencias caen todas en el primer nivel', () => {
  const waves = orq.computeWaves([
    { path: 'a', dependencias: [] },
    { path: 'b' },
  ]);

  assert.strictEqual(waves.length, 1);
  assert.deepStrictEqual(waves[0].map(t => t.path), ['a', 'b']);
});

test('computeWaves: las dependencias ordenan los niveles', () => {
  const waves = orq.computeWaves([
    { path: 'c', dependencias: ['b'] },
    { path: 'a', dependencias: [] },
    { path: 'b', dependencias: ['a'] },
  ]);

  assert.deepStrictEqual(waves.map(w => w.map(t => t.path)), [['a'], ['b'], ['c']]);
});

test('computeWaves: dependencia circular = error explicito, no oleada paralela', () => {
  assert.throws(
    () => orq.computeWaves([{ path: 'a', dependencias: ['b'] }, { path: 'b', dependencias: ['a'] }]),
    /CICLO_DETECTADO.*a.*b/s
  );
});

test('computeWaves: ciclo de tres tasks nombra a las tres', () => {
  assert.throws(
    () => orq.computeWaves([
      { path: 'a', dependencias: ['c'] },
      { path: 'b', dependencias: ['a'] },
      { path: 'c', dependencias: ['b'] },
    ]),
    /CICLO_DETECTADO: dependencias circulares entre tasks: a, b, c/
  );
});

test('computeWaves: una dependencia fuera de la spec, pero que existe, no es un ciclo', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  writeFile(path.join(p.raiz, 'ai_docs', 'tasks', '999_previa.md'), taskDoc(['src/previa.js']));

  const tasks = conDeps(p.tasks, { '001_a.md': ['ai_docs/tasks/999_previa.md'] });
  const waves = orq.computeWaves(tasks, p.raiz);

  assert.deepStrictEqual(waves.map(w => w.map(t => path.basename(t.path))), [['001_a.md']]);
});

test('computeWaves: una dependencia cuyo documento no existe es un error, no una externa', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  const tasks = conDeps(p.tasks, { '001_a.md': ['ai_docs/tasks/002_typo.md'] });

  // Sin esta comprobacion la task se lanzaria como si no dependiera de nada: el
  // path mal escrito se descartaria en silencio por "externa ya satisfecha".
  assert.throws(
    () => orq.computeWaves(tasks, p.raiz),
    /DEPENDENCIA_INEXISTENTE.*002_typo\.md/s
  );
});

test('validarDependencias: nombra todas las dependencias rotas, no solo la primera', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const tasks = conDeps(p.tasks, {
    '001_a.md': ['ai_docs/tasks/900_no_existe.md'],
    '002_b.md': ['ai_docs/tasks/901_tampoco.md'],
  });

  assert.throws(() => orq.validarDependencias(tasks, p.raiz), /900_no_existe\.md.*901_tampoco\.md/s);
});

// ── Contratos ────────────────────────────────────────────────────────────────

test('verificarContratos: consumir sin depender del productor es un problema', () => {
  const problemas = orq.verificarContratos([
    { path: 'a', contratos: [{ tipo: 'produce', nombre: 'ApiUsuario' }] },
    { path: 'b', dependencias: [], contratos: [{ tipo: 'consume', nombre: 'ApiUsuario' }] },
  ]);

  assert.strictEqual(problemas.length, 1);
  assert.match(problemas[0], /b consume "ApiUsuario" pero no depende de su productor a/);
});

test('verificarContratos: consumidor que depende del productor = sin problemas', () => {
  const problemas = orq.verificarContratos([
    { path: 'a', contratos: [{ tipo: 'produce', nombre: 'ApiUsuario' }] },
    { path: 'b', dependencias: ['a'], contratos: [{ tipo: 'consume', nombre: 'ApiUsuario' }] },
  ]);

  assert.deepStrictEqual(problemas, []);
});

test('verificarContratos: consumir un contrato que nadie produce es un problema', () => {
  const problemas = orq.verificarContratos([
    { path: 'b', contratos: [{ tipo: 'consume', nombre: 'ApiFantasma' }] },
  ]);

  assert.match(problemas[0], /ninguna task produce/);
});

// ── Numeracion atomica ───────────────────────────────────────────────────────

test('next-task-number: reserva numeros consecutivos sin colisiones entre procesos', async () => {
  const { execFile } = require('child_process');
  const raiz = tempDir('sdd-num-');
  fs.mkdirSync(path.join(raiz, 'ai_docs', 'tasks'), { recursive: true });
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'next-task-number.sh');

  const reservar = () => new Promise((resolve, reject) => {
    execFile('bash', [script], { cwd: raiz, timeout: 10000 }, (e, stdout) => e ? reject(e) : resolve(stdout.trim()));
  });

  const numeros = await Promise.all([reservar(), reservar(), reservar()]);

  assert.deepStrictEqual([...numeros].sort(), ['001', '002', '003']);
});

// ── Gate de tests: descubrir el comando real ─────────────────────────────────
// El gate ejecuta el comando de test del proyecto y lee su exit code; nunca cree
// numeros de tests auto-reportados. Aqui se prueba el descubrimiento del comando.

test('descubrirComandoTest: package.json con scripts.test -> npm test', () => {
  const raiz = tempDir('sdd-cmd-');
  writeFile(path.join(raiz, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));

  assert.deepStrictEqual(orq.descubrirComandoTest(raiz), { cmd: 'npm', args: ['test'], fuente: 'package.json' });
});

test('descubrirComandoTest: el placeholder por defecto de npm no cuenta como comando', () => {
  const raiz = tempDir('sdd-cmd-');
  writeFile(path.join(raiz, 'package.json'),
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));

  // Bloquear por el exit 1 del placeholder seria un rojo falso: degrada a "sin comando".
  assert.strictEqual(orq.descubrirComandoTest(raiz), null);
});

test('descubrirComandoTest: pytest.ini -> pytest', () => {
  const raiz = tempDir('sdd-cmd-');
  writeFile(path.join(raiz, 'pytest.ini'), '[pytest]\n');

  assert.deepStrictEqual(orq.descubrirComandoTest(raiz), { cmd: 'pytest', args: [], fuente: 'pytest.ini' });
});

test('descubrirComandoTest: setup.cfg cuenta solo si declara [tool:pytest]', () => {
  const conPytest = tempDir('sdd-cmd-');
  writeFile(path.join(conPytest, 'setup.cfg'), '[tool:pytest]\naddopts = -q\n');
  assert.deepStrictEqual(orq.descubrirComandoTest(conPytest), { cmd: 'pytest', args: [], fuente: 'setup.cfg' });

  const sinPytest = tempDir('sdd-cmd-');
  writeFile(path.join(sinPytest, 'setup.cfg'), '[metadata]\nname = demo\n');
  assert.strictEqual(orq.descubrirComandoTest(sinPytest), null);
});

test('descubrirComandoTest: un comando configurado tiene prioridad sobre npm', () => {
  const raiz = tempDir('sdd-cmd-');
  writeFile(path.join(raiz, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  writeFile(path.join(raiz, 'hooks', 'config.json'),
    JSON.stringify({ sdd_test_gate: { command: 'make test' } }));

  assert.deepStrictEqual(orq.descubrirComandoTest(raiz), { cmd: 'make', args: ['test'], fuente: 'hooks/config.json' });
});

test('descubrirComandoTest: proyecto sin runner -> null (el llamador decide degradar o bloquear)', () => {
  assert.strictEqual(orq.descubrirComandoTest(tempDir('sdd-cmd-')), null);
});

// ── Gate de tests: clasificar cambios y decidir el veredicto ──────────────────

test('tocaCodigoEjecutable: distingue codigo de docs/config', () => {
  assert.strictEqual(orq.tocaCodigoEjecutable(['src/a.js']), true);
  assert.strictEqual(orq.tocaCodigoEjecutable(['scripts/deploy.sh']), true);
  assert.strictEqual(orq.tocaCodigoEjecutable(['README.md', 'config.json']), false);
  assert.strictEqual(orq.tocaCodigoEjecutable(['docs/guia.md', 'src/a.js']), true);
  assert.strictEqual(orq.tocaCodigoEjecutable([]), false);
});

test('evaluarGateTests: comando con exit 0 -> PASA (incluida la suite vacia)', () => {
  const v = orq.evaluarGateTests({ comando: { fuente: 'package.json' }, exitCode: 0, archivos: ['src/a.js'] });
  assert.strictEqual(v.estado, 'PASA');
});

test('evaluarGateTests: comando con exit != 0 -> FALLIDA (rojo siempre bloquea)', () => {
  const v = orq.evaluarGateTests({ comando: { fuente: 'package.json' }, exitCode: 1, archivos: ['src/a.js'] });
  assert.strictEqual(v.estado, 'FALLIDA');
  assert.match(v.nota, /rojo/);
});

test('evaluarGateTests: sin comando + task que toca codigo -> FALLIDA', () => {
  const v = orq.evaluarGateTests({ comando: null, exitCode: null, archivos: ['src/a.js'] });
  assert.strictEqual(v.estado, 'FALLIDA');
  assert.match(v.nota, /No se encontro comando de test/);
});

test('evaluarGateTests: sin comando + task solo docs/config -> ADVISORY (exenta)', () => {
  const v = orq.evaluarGateTests({ comando: null, exitCode: null, archivos: ['README.md'] });
  assert.strictEqual(v.estado, 'ADVISORY');
});

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
    lista.push({ path: rel, titulo: nombre });
  }
  return { raiz, tasks: lista };
}

function conDeps(tasks, deps) {
  return tasks.map(t => Object.assign({}, t, { dependencias: deps[path.basename(t.path)] || [] }));
}

// ── Ciclos ───────────────────────────────────────────────────────────────────

test('computeNiveles: una dependencia compartida por dos tasks no las funde en el mismo nivel que su origen', () => {
  // Grafo en diamante: 'a' es nivel 1; 'b' y 'c' dependen solo de 'a' y por tanto
  // ambas caen en el nivel 2 (aunque no dependan entre si); 'd' depende de ambas y
  // solo puede resolverse en el nivel 3, una vez completadas las dos.
  const niveles = orq.computeNiveles([
    { path: 'd', dependencias: ['b', 'c'] },
    { path: 'b', dependencias: ['a'] },
    { path: 'c', dependencias: ['a'] },
    { path: 'a', dependencias: [] },
  ]);

  assert.deepStrictEqual(niveles.map(n => n.map(t => t.path).sort()), [['a'], ['b', 'c'], ['d']]);
});

test('computeNiveles: tasks sin dependencias caen todas en el primer nivel', () => {
  const niveles = orq.computeNiveles([
    { path: 'a', dependencias: [] },
    { path: 'b' },
  ]);

  assert.strictEqual(niveles.length, 1);
  assert.deepStrictEqual(niveles[0].map(t => t.path), ['a', 'b']);
});

test('computeNiveles: las dependencias ordenan los niveles', () => {
  const niveles = orq.computeNiveles([
    { path: 'c', dependencias: ['b'] },
    { path: 'a', dependencias: [] },
    { path: 'b', dependencias: ['a'] },
  ]);

  assert.deepStrictEqual(niveles.map(w => w.map(t => t.path)), [['a'], ['b'], ['c']]);
});

test('computeNiveles: un plan viejo con el campo obsoleto "independiente" no rompe el ordenamiento', () => {
  // Planes generados antes de retirar el campo del schema pueden traerlo todavia.
  // El ordenamiento se basa solo en dependencias: el campo extra debe ignorarse.
  const niveles = orq.computeNiveles([
    { path: 'a', independiente: true, dependencias: [] },
    { path: 'b', independiente: false, dependencias: ['a'] },
  ]);

  assert.deepStrictEqual(niveles.map(n => n.map(t => t.path)), [['a'], ['b']]);
});

test('computeNiveles: dependencia circular = error explicito, no nivel paralelo', () => {
  assert.throws(
    () => orq.computeNiveles([{ path: 'a', dependencias: ['b'] }, { path: 'b', dependencias: ['a'] }]),
    /CICLO_DETECTADO.*a.*b/s
  );
});

test('computeNiveles: ciclo de tres tasks nombra a las tres', () => {
  assert.throws(
    () => orq.computeNiveles([
      { path: 'a', dependencias: ['c'] },
      { path: 'b', dependencias: ['a'] },
      { path: 'c', dependencias: ['b'] },
    ]),
    /CICLO_DETECTADO: dependencias circulares entre tasks: a, b, c/
  );
});

test('computeNiveles: una dependencia fuera de la spec, pero que existe, no es un ciclo', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  writeFile(path.join(p.raiz, 'ai_docs', 'tasks', '999_previa.md'), taskDoc(['src/previa.js']));

  const tasks = conDeps(p.tasks, { '001_a.md': ['ai_docs/tasks/999_previa.md'] });
  const niveles = orq.computeNiveles(tasks, p.raiz);

  assert.deepStrictEqual(niveles.map(w => w.map(t => path.basename(t.path))), [['001_a.md']]);
});

test('computeNiveles: una dependencia cuyo documento no existe es un error, no una externa', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  const tasks = conDeps(p.tasks, { '001_a.md': ['ai_docs/tasks/002_typo.md'] });

  // Sin esta comprobacion la task se lanzaria como si no dependiera de nada: el
  // path mal escrito se descartaria en silencio por "externa ya satisfecha".
  assert.throws(
    () => orq.computeNiveles(tasks, p.raiz),
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

test('next-task-number: bajo estres con invocaciones realmente concurrentes en bucle, nunca duplica numeros', async () => {
  // La prueba anterior lanza 3 procesos de golpe, pero solo reproducia el
  // TOCTOU original ~1/3 de las veces: el hueco entre "existe el lock?" y
  // "leer su mtime" es estrecho y no siempre coincide con el intento de
  // otro proceso. Aqui se repite el experimento varias rondas, cada una
  // con mas procesos disputando el mismo lock, para exigir la ausencia de
  // colisiones de forma mucho mas fiable.
  const { execFile } = require('child_process');
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'next-task-number.sh');

  const reservar = (raiz) => new Promise((resolve, reject) => {
    execFile('bash', [script], { cwd: raiz, timeout: 10000 }, (e, stdout) => e ? reject(e) : resolve(stdout.trim()));
  });

  const RONDAS = 5;
  const PROCESOS_POR_RONDA = 6;

  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const raiz = tempDir('sdd-num-estres-');
    fs.mkdirSync(path.join(raiz, 'ai_docs', 'tasks'), { recursive: true });

    const numeros = await Promise.all(
      Array.from({ length: PROCESOS_POR_RONDA }, () => reservar(raiz))
    );

    const esperados = Array.from({ length: PROCESOS_POR_RONDA }, (_, i) => String(i + 1).padStart(3, '0'));
    assert.deepStrictEqual(
      [...numeros].sort(),
      esperados,
      `ronda ${ronda}: numeros duplicados o huecos entre procesos concurrentes: ${JSON.stringify(numeros)}`
    );
  }
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

// Un proceso que agoto su tiempo, murio por senal o no llego a arrancar no devuelve codigo
// (null). Eso es rojo igual, pero con nota propia: la causa se investiga distinto que un exit != 0.
test('evaluarGateTests: comando sin codigo de salida -> FALLIDA con nota distinta del rojo normal', () => {
  const v = orq.evaluarGateTests({ comando: { fuente: 'package.json' }, exitCode: null, archivos: ['src/a.js'] });
  assert.strictEqual(v.estado, 'FALLIDA');
  assert.match(v.nota, /sin codigo de salida/);
  assert.doesNotMatch(v.nota, /exit \d/);
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

// ── Fase 3: Convergencia ─────────────────────────────────────────────────────
// La revision por task (arriba) valida cada diff antes de commitear, pero no si
// el conjunto final converge con la spec original. La Fase 3 cierra ese hueco
// invocando el Paso 4bis en modo standalone. Estos tests fijan el contrato en
// el propio texto del workflow: la fase se omite si algo quedo sin completar,
// y el resultado (CONVERGIDA/DIVERGE/OMITIDA/ERROR) siempre llega al retorno.

const WORKFLOW = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '.claude', 'workflows', 'implementar-spec.js'), 'utf8');

test('implementar-spec.js: la Fase 3 invoca el Paso 4bis en modo standalone, sin repetir los demas pasos', () => {
  assert.match(WORKFLOW, /Paso 4bis/);
  assert.match(WORKFLOW, /standalone/);
  assert.match(WORKFLOW, /No repitas Pasos 1-3\/5/);
});


test('implementar-spec.js: el objeto de retorno incluye el resultado de convergencia', () => {
  assert.match(WORKFLOW, /convergencia:\s*convergencia/);
});

test('implementar-spec.js: meta.phases declara las 3 fases, incluida Convergencia', () => {
  assert.match(WORKFLOW, /title: 'Descubrimiento'/);
  assert.match(WORKFLOW, /title: 'Implementacion'/);
  assert.match(WORKFLOW, /title: 'Convergencia'/);
});

test('implementar-spec.js: el comentario que declaraba la revision de integracion opcional ya no aplica', () => {
  assert.doesNotMatch(WORKFLOW, /opcional y ligera/);
});

// ── Separadores de ruta en las dependencias declaradas ───────────────────────
// Una dependencia sale del documento de una task: es contenido externo, escrito a
// mano o por un agente, y puede traer los separadores de la otra plataforma. Este
// repositorio se usa en Windows y en sistemas tipo Unix indistintamente.
//
// COMO SE ACREDITA
// Las dos plataformas se ejercitan desde una sola: rutaNativa acepta path.win32 /
// path.posix, y la comparacion entre la logica vieja y la nueva se hace contra el
// resolve de cada una. La garantia es doble: CERO cambio sobre rutas nativas de
// cada plataforma (los tests de arriba, todos con rutas nativas, siguen valiendo
// tal cual), y arreglo unicamente en el cruce de separadores.

// Formas nativas de cada plataforma. Ninguna puede cambiar al pasar por rutaNativa.
const NATIVAS_POSIX = [
  'ai_docs/tasks/001_a.md', './ai_docs/tasks/001_a.md', '001_a.md',
  '/abs/ai_docs/tasks/001_a.md', '../hermana/001_a.md',
];
const NATIVAS_WIN32 = [
  'ai_docs\\tasks\\001_a.md', '.\\ai_docs\\001_a.md', 'C:\\proyecto\\001_a.md',
  '001_a.md', 'ai_docs/tasks/001_a.md',
];
// Rutas de Windows tal como llegarian a un plan leido en un sistema tipo Unix.
const CRUZADAS = ['ai_docs\\tasks\\001_a.md', 'C:\\proyecto\\ai_docs\\001_a.md', '.\\ai_docs\\001_a.md'];

test('canary: la traduccion de separadores coincide con la del guard de escrituras', () => {
  // El criterio esta replicado (la orquestacion no importa modulos de los hooks), asi que la
  // igualdad se exige aqui: si una copia cambia sin la otra, este test lo denuncia.
  const { toNativePath } = require('../sdd-plan-state');
  const bateria = NATIVAS_POSIX.concat(NATIVAS_WIN32, CRUZADAS, ['', 'src/no\\separador.js']);

  for (const api of [path.posix, path.win32]) {
    for (const raw of bateria) {
      assert.strictEqual(orq.rutaNativa(raw, api), toNativePath(raw, api), api.sep + ': ' + raw);
    }
  }
  assert.strictEqual(orq.rutaNativa(null, path.posix), toNativePath(null, path.posix));
  assert.strictEqual(orq.rutaNativa(undefined, path.posix), toNativePath(undefined, path.posix));
});

test('cero cambio de comportamiento: sobre rutas nativas, resolver con y sin traduccion da lo mismo', () => {
  for (const raw of NATIVAS_POSIX) {
    assert.strictEqual(
      path.posix.resolve('/proyecto', orq.rutaNativa(raw, path.posix)),
      path.posix.resolve('/proyecto', raw),
      'posix: ' + raw,
    );
  }
  for (const raw of NATIVAS_WIN32.concat(CRUZADAS)) {
    assert.strictEqual(
      path.win32.resolve('C:\\proyecto', orq.rutaNativa(raw, path.win32)),
      path.win32.resolve('C:\\proyecto', raw),
      'win32: ' + raw,
    );
  }
});

test('control positivo: sin traducir, la dependencia se resuelve como un solo tramo en Unix', () => {
  const vieja = path.posix.resolve('/proyecto', 'ai_docs\\tasks\\001_a.md');
  assert.strictEqual(vieja, '/proyecto/ai_docs\\tasks\\001_a.md');
  assert.strictEqual(vieja.split('/').length, 3, 'los tres tramos quedan colapsados en uno');

  const nueva = path.posix.resolve('/proyecto', orq.rutaNativa('ai_docs\\tasks\\001_a.md', path.posix));
  assert.strictEqual(nueva, '/proyecto/ai_docs/tasks/001_a.md');
  assert.strictEqual(nueva.split('/').length, 5);
});

test('control positivo: la comprobacion vieja no encontraba en disco una dependencia que si existe', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const dep = 'ai_docs\\tasks\\001_a.md';

  // Vieja: el path entra crudo en resolve. En un sistema tipo Unix se busca UN nombre de archivo
  // con barras invertidas dentro, que no existe; en Windows la barra ya es separador y acertaba.
  assert.strictEqual(fs.existsSync(path.resolve(p.raiz, dep)), path.sep === '\\',
    'el defecto es exclusivo del cruce de separadores, no de Windows');

  // Nueva: se traduce ANTES de resolver, y el archivo se encuentra en las dos plataformas.
  assert.strictEqual(fs.existsSync(path.resolve(p.raiz, orq.rutaNativa(dep))), true);
});

test('validarDependencias: una dependencia con separadores de Windows no se denuncia como inexistente', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const tasks = conDeps(p.tasks, { '002_b.md': ['ai_docs\\tasks\\001_a.md'] });

  // Antes: DEPENDENCIA_INEXISTENTE. Un bloqueo falso, y el usuario lo veia.
  assert.doesNotThrow(() => orq.validarDependencias(tasks, p.raiz));
});

test('computeNiveles: una dependencia con separadores de Windows sigue ordenando los niveles', () => {
  // Traducir solo para el existsSync no bastaria: la dependencia dejaria de casar con la task
  // conocida, se tomaria por externa ya satisfecha y las dos tasks caerian en el mismo nivel.
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const tasks = conDeps(p.tasks, { '002_b.md': ['ai_docs\\tasks\\001_a.md'] });

  const niveles = orq.computeNiveles(tasks, p.raiz);

  assert.deepStrictEqual(
    niveles.map(n => n.map(t => path.basename(t.path))),
    [['001_a.md'], ['002_b.md']],
  );
});

test('validarDependencias: la ruta cruda, no la traducida, es la que se nombra en el error', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  const tasks = conDeps(p.tasks, { '001_a.md': ['ai_docs\\tasks\\900_no_existe.md'] });

  // Traducir no inventa el documento: si de verdad no existe, sigue siendo un error del plan, y el
  // mensaje cita lo que el autor escribio, que es lo que tiene que corregir.
  assert.throws(
    () => orq.validarDependencias(tasks, p.raiz),
    /DEPENDENCIA_INEXISTENTE[\s\S]*ai_docs\\tasks\\900_no_existe\.md/,
  );
});

test('verificarContratos: el consumidor reconoce a su productor aunque lo cite con la otra barra', () => {
  const problemas = orq.verificarContratos([
    { path: 'ai_docs/tasks/001_a.md', contratos: [{ tipo: 'produce', nombre: 'ApiUsuario' }] },
    {
      path: 'ai_docs/tasks/002_b.md',
      dependencias: ['ai_docs\\tasks\\001_a.md'],
      contratos: [{ tipo: 'consume', nombre: 'ApiUsuario' }],
    },
  ]);

  assert.deepStrictEqual(problemas, [], 'la dependencia declarada si apunta al productor');
});

// ── Salida de git: vacio legitimo contra fallo ───────────────────────────────
// El flujo prepara el diff de la task, lo revisa y registra su constancia antes de
// commitear. Si git no llega a correr, la salida estandar tambien viene vacia: sin
// mirar el codigo de salida, el fallo se confundia con "no hay nada preparado" y se
// registraba la constancia del diff vacio, con lo que el gate denegaba el commit
// despues sin que nada explicase por que.

test('interpretarSalidaGit: exit 0 con salida -> dato utilizable', () => {
  const r = orq.interpretarSalidaGit(['diff', '--cached'], { code: 0, out: 'diff --git a/x b/x\n', err: '' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.out, 'diff --git a/x b/x\n');
});

test('interpretarSalidaGit: exit 0 sin salida es un vacio LEGITIMO, no un fallo', () => {
  const r = orq.interpretarSalidaGit(['diff', '--cached'], { code: 0, out: '', err: '' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.out, '');
  assert.strictEqual(r.error, undefined);
});

test('interpretarSalidaGit: exit != 0 es un FALLO, aunque la salida venga vacia igual que el vacio legitimo', () => {
  const fallo = orq.interpretarSalidaGit(['diff', '--cached'], { code: 128, out: '', err: 'fatal: not a git repository' });
  const vacio = orq.interpretarSalidaGit(['diff', '--cached'], { code: 0, out: '', err: '' });

  // Las dos salidas estandar son identicas: el codigo de salida es lo unico que las separa.
  assert.strictEqual(fallo.out, vacio.out);
  assert.notStrictEqual(fallo.ok, vacio.ok);

  assert.strictEqual(fallo.ok, false);
  assert.match(fallo.error, /git diff --cached fallo: exit 128/);
  assert.match(fallo.error, /not a git repository/, 'el motivo de git llega al informe');
});

test('interpretarSalidaGit: sin codigo de salida (tiempo agotado, senal, git ausente) -> fallo con nota propia', () => {
  const r = orq.interpretarSalidaGit(['add', '-A'], { code: null, out: '', err: 'spawnSync git ETIMEDOUT' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /sin codigo de salida/);
  assert.doesNotMatch(r.error, /exit \d/);
});

test('interpretarSalidaGit: un resultado ausente o sin codigo nunca pasa por bueno', () => {
  assert.strictEqual(orq.interpretarSalidaGit(['status'], null).ok, false);
  assert.strictEqual(orq.interpretarSalidaGit(['status'], {}).ok, false);
  assert.strictEqual(orq.interpretarSalidaGit(['status'], { code: '0', out: 'x' }).ok, false,
    'un codigo textual no es exit 0');
});

// ── El workflow usa esas dos disciplinas ─────────────────────────────────────


test('implementar-spec.js: los modulos se anclan al proyecto, no al directorio en curso del proceso', () => {
  assert.match(WORKFLOW, /function resolverEnProyecto/);
  assert.match(WORKFLOW, /rutaNativa\(rutaRelativa, path\)/, 'la ruta debe traducirse antes de resolverla');
  assert.doesNotMatch(WORKFLOW, /pathToFileURL\(path\.resolve\(rutaRelativa\)\)/, 'resolucion contra el cwd');
});

test('implementar-spec.js: ninguna via de "senal de revision no emitida" es muda', () => {
  const emisor = WORKFLOW.slice(
    WORKFLOW.indexOf('async function emitirSenalRevision'),
    WORKFLOW.indexOf('// ── Fase 1'));

  // Cuatro salidas posibles y ninguna callada: sin hooks instalados, sin id de sesion, senal que
  // no se pudo escribir, y excepcion al cargar o emitir.
  assert.strictEqual((emisor.match(/log\(/g) || []).length, 4);
  assert.match(emisor, /denegara el commit de esta task/);
  assert.doesNotMatch(emisor, /catch \(e\) \{\s*return null/, 'el catch mudo era el defecto');
});

test('implementar-spec.js: lo que se busca "en el proyecto" no se busca en el directorio en curso', () => {
  // El gate de tests descarta la task y borra su trabajo cuando no encuentra comando: buscarlo
  // donde arranco la sesion, y no donde vive el proyecto, lo convertia en un rojo falso.
  assert.match(WORKFLOW, /function raizDelProyecto/);
  assert.match(WORKFLOW, /descubrirComandoTest\(raizProyecto\)/);
  assert.match(WORKFLOW, /computeNiveles\(taskList, raizProyecto\)/);
  assert.doesNotMatch(WORKFLOW, /descubrirComandoTest\('\.'\)/);
  assert.doesNotMatch(WORKFLOW, /computeNiveles\(taskList, '\.'\)/);
});

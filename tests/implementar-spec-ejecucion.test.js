'use strict';

// Ejecucion de /implementar-spec: modo de recorrido, ejecucion de una task y las
// lecturas de git que sostienen un veredicto.
//
// POR QUE ESTE ARCHIVO EXISTE
// El fichero del workflow (.claude/workflows/implementar-spec.js) no es importable:
// el motor lo evalua con globales propias (`agent`, `phase`, `log`, `args`) y con
// espera de nivel superior. La cobertura que habia era leerlo como cadena y afirmar
// sobre su texto con expresiones regulares, y una busqueda de texto no distingue
// codigo vivo de codigo comentado: sobrevivia a un `if (false && ...)`, a una lectura
// de git que ignorase el codigo de salida y a un campo del retorno movido a un
// comentario. La logica pasa a lib/orquestacion.js, que si se importa, y se ejercita
// aqui con dobles.
//
// CONTROL POSITIVO DE CADA BLOQUE
// Cada bloque de abajo se acredito aplicando sobre orquestacion.js el mutante que
// antes sobrevivia y comprobando que la suite cae:
//   - `parsearArgs` devolviendo `modoParalelo: false` fijo;
//   - la rama concurrente de `recorrerNiveles` sustituida por un bucle de uno en uno;
//   - `if (false && !escapeActivo(...))` en el gate de tests;
//   - `gitVerificado` devolviendo `{ ok: true }` sin mirar el codigo de salida;
//   - `construirResultado` con el campo de convergencia comentado y retorno nulo;
//   - el calculo real del gate de tests (`veredictoPorExitCode`, `descubrirComandoTest`)
//     se inyectaba como doble en ocho puntos y nunca se ejercitaba: `exitCode === 0`
//     sustituido por `==`, el `if (!Number.isInteger(exitCode))` invertido, el descarte
//     del placeholder npm retirado y la prioridad de descubrimiento invertida.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orq = require('../.claude/workflows/lib/orquestacion');

const SPEC = 'ai_docs/tasks/spec_autenticacion.md';

/** Task con el formato minimo que la orquestacion necesita. */
function tarea(titulo, dependencias) {
  return { path: 'ai_docs/tasks/' + titulo + '.md', titulo, dependencias: dependencias || [] };
}

function tareas() {
  return Array.from(arguments).map(t => tarea(t));
}

function resultadoDe(task, resultado) {
  return {
    task_path: task.path,
    task_titulo: task.titulo,
    resultado: resultado || 'COMPLETADA',
    archivos_modificados: ['src/' + task.titulo + '.js'],
  };
}

/** Deja correr los microtasks pendientes sin resolver nada del test. */
function cederElTurno() {
  return new Promise(resolve => setImmediate(resolve));
}

const CIMA_STASH = 'rev-parse -q --verify refs/stash';

// Pathspec del proyecto en secuencial: todo salvo los documentos de plan y el registro de sesiones.
const PROYECTO = '-- . :(exclude)ai_docs/tasks :(exclude)ai_docs/audits';
const ADD_PROYECTO = 'add -A ' + PROYECTO;
const DIFF_PROYECTO = 'diff --cached ' + PROYECTO;

/**
 * Doble del spawn de git. `respuestas` se indexa por el argv unido con espacios
 * (o por su primer tramo, para un `commit` cuyo mensaje no se conoce de antemano).
 * Un valor funcion recibe el numero de invocacion de esa misma clave, que es como
 * se simulan dos lecturas distintas del mismo comando.
 */
function gitDoble(respuestas) {
  const llamadas = [];
  const veces = new Map();
  // Cima de la pila de stash: cambia con cada `stash push` que sale con 0, como en git.
  let entradas = 0;

  async function spawn(argv) {
    const clave = argv.join(' ');
    llamadas.push(clave);
    const n = (veces.get(clave) || 0) + 1;
    veces.set(clave, n);

    let r = (respuestas || {})[clave] !== undefined
      ? (respuestas || {})[clave]
      : (respuestas || {})[argv[0]];
    if (r === undefined && clave === CIMA_STASH) {
      r = entradas > 0 ? { code: 0, out: 'stash' + entradas + '\n', err: '' } : { code: 1, out: '', err: '' };
    }
    if (r === undefined) r = { code: 0, out: '', err: '' };
    const salida = typeof r === 'function' ? r(n) : r;
    if (argv[0] === 'stash' && argv[1] === 'push' && salida && salida.code === 0) entradas += 1;
    return salida;
  }

  return { llamadas, spawn };
}

// ── El flag de modo y la ruta de la spec ─────────────────────────────────────
// Mutante que sobrevivia: `modoParalelo` fijo a false. Ninguna busqueda de texto
// mencionaba --parallel, asi que el flag podia dejar de existir sin que nada cayera.

test('parsearArgs: --parallel activa el modo concurrente y se separa de la ruta de la spec', () => {
  assert.deepStrictEqual(orq.parsearArgs(SPEC + ' --parallel'),
    { modoParalelo: true, specPath: SPEC, error: null });
});

test('parsearArgs: el flag se reconoce tambien delante de la ruta', () => {
  assert.deepStrictEqual(orq.parsearArgs('--parallel ' + SPEC),
    { modoParalelo: true, specPath: SPEC, error: null });
});

test('parsearArgs: sin flag el modo es una task tras otra (defecto)', () => {
  assert.deepStrictEqual(orq.parsearArgs(SPEC), { modoParalelo: false, specPath: SPEC, error: null });
  assert.deepStrictEqual(orq.parsearArgs('  ' + SPEC + '  '),
    { modoParalelo: false, specPath: SPEC, error: null });
});

test('parsearArgs: un flag parecido no activa el modo concurrente', () => {
  // Sin frontera de palabra, --parallelize activaria un modo que nadie pidio.
  assert.strictEqual(orq.parsearArgs(SPEC + ' --parallelize').modoParalelo, false);
  assert.strictEqual(orq.parsearArgs(SPEC + ' --no-parallel').modoParalelo, false);
});

test('parsearArgs: una ruta que contiene la palabra no se confunde con el flag', () => {
  const ruta = 'ai_docs/tasks/spec_parallel_writes.md';
  assert.deepStrictEqual(orq.parsearArgs(ruta), { modoParalelo: false, specPath: ruta, error: null });
});

test('parsearArgs: sin ruta de spec (o con una demasiado corta) devuelve el error de uso', () => {
  for (const crudo of ['', '   ', '--parallel', 'a.md', undefined, null, 42]) {
    const r = orq.parsearArgs(crudo);
    assert.match(r.error, /Se requiere el path de la spec/, JSON.stringify(crudo));
  }
  // El flag solo tampoco arrastra texto a la ruta.
  assert.strictEqual(orq.parsearArgs('--parallel').specPath, '');
});

// ── Recorrido de niveles ─────────────────────────────────────────────────────
// Mutante que sobrevivia: la rama concurrente sustituida por un bucle de una task
// tras otra. El resultado final es identico, asi que solo lo delata observar
// cuantas tasks estan en vuelo a la vez.

test('recorrerNiveles: en modo concurrente las N tasks del nivel estan en vuelo a la vez', async () => {
  const arrancadas = [];
  const liberar = [];
  const ejecutar = task => new Promise(resolve => {
    arrancadas.push(task.titulo);
    liberar.push(() => resolve(resultadoDe(task)));
  });

  const pendiente = orq.recorrerNiveles([tareas('a', 'b', 'c')], ejecutar, { modoParalelo: true });
  await cederElTurno();

  assert.deepStrictEqual(arrancadas, ['a', 'b', 'c'],
    'un bucle de una en una habria arrancado solo la primera');

  liberar.forEach(f => f());
  const resultados = await pendiente;
  assert.deepStrictEqual(resultados.map(r => r.task_titulo), ['a', 'b', 'c']);
});

test('recorrerNiveles: sin opciones el nivel se recorre una task tras otra (defecto)', async () => {
  const arrancadas = [];
  const liberar = [];
  const ejecutar = task => new Promise(resolve => {
    arrancadas.push(task.titulo);
    liberar.push(() => resolve(resultadoDe(task)));
  });

  const pendiente = orq.recorrerNiveles([tareas('a', 'b', 'c')], ejecutar);
  await cederElTurno();
  assert.deepStrictEqual(arrancadas, ['a'], 'el defecto no puede lanzar el nivel entero');

  liberar[0]();
  await cederElTurno();
  assert.deepStrictEqual(arrancadas, ['a', 'b']);

  liberar[1]();
  await cederElTurno();
  liberar[2]();
  assert.deepStrictEqual((await pendiente).map(r => r.task_titulo), ['a', 'b', 'c']);
});

test('recorrerNiveles: un nivel no arranca hasta que el anterior termina, tambien en concurrente', async () => {
  const arrancadas = [];
  const liberar = [];
  const ejecutar = task => new Promise(resolve => {
    arrancadas.push(task.titulo);
    liberar.push(() => resolve(resultadoDe(task)));
  });

  const pendiente = orq.recorrerNiveles(
    [tareas('a'), tareas('b')], ejecutar, { modoParalelo: true });
  await cederElTurno();
  assert.deepStrictEqual(arrancadas, ['a'], 'el orden topologico manda sobre el modo');

  liberar[0]();
  await cederElTurno();
  assert.deepStrictEqual(arrancadas, ['a', 'b']);

  liberar[1]();
  await pendiente;
});

test('recorrerNiveles: cada task solo ve resultados de niveles YA completados', async () => {
  for (const modoParalelo of [false, true]) {
    const vistos = new Map();
    const ejecutar = async (task, previos) => {
      vistos.set(task.titulo, previos.map(r => r.task_titulo));
      return resultadoDe(task);
    };

    await orq.recorrerNiveles([tareas('a', 'b'), tareas('c')], ejecutar, { modoParalelo });

    assert.deepStrictEqual(vistos.get('a'), [], 'modoParalelo=' + modoParalelo);
    assert.deepStrictEqual(vistos.get('b'), [],
      'b es del mismo nivel que a: su resultado no entra en la decision (modoParalelo=' + modoParalelo + ')');
    assert.deepStrictEqual(vistos.get('c'), ['a', 'b'], 'modoParalelo=' + modoParalelo);
  }
});

test('recorrerNiveles: en concurrente el fallo de una task no cancela a las hermanas del nivel', async () => {
  // Composicion real: el recorrido concurrente espera las N tasks a la vez, y eso
  // se cancelaria con la primera excepcion. Lo que lo evita es que ejecutarTask
  // devuelva FALLIDA en vez de propagar. Aqui se ejercitan las dos piezas juntas.
  const ejecutar = (task, previos) => orq.ejecutarTask(task, previos, {
    implementar: async t => {
      if (t.titulo === 'b') throw new Error('el agente no devolvio nada utilizable');
      return resultadoDe(t);
    },
    gateTests: async () => ({ estado: 'PASA', nota: 'Tests verdes (exit 0) via package.json' }),
    revisarYComitear: async (t, r) => r,
    descartar: async () => {},
  });

  const resultados = await orq.recorrerNiveles(
    [tareas('a', 'b', 'c')], ejecutar, { modoParalelo: true });

  assert.deepStrictEqual(resultados.map(r => r.task_titulo), ['a', 'b', 'c'],
    'las tres tasks tienen que reportar resultado, no solo la que fallo');
  assert.deepStrictEqual(resultados.map(r => r.resultado), ['COMPLETADA', 'FALLIDA', 'COMPLETADA']);
  assert.match(resultados[1].notas, /no devolvio nada utilizable/);
  assert.deepStrictEqual(orq.resumirResultados(resultados), { completadas: 2, fallidas: 1 });
});

test('resumirResultados: solo COMPLETADA cuenta como completada', () => {
  assert.deepStrictEqual(orq.resumirResultados([
    { resultado: 'COMPLETADA' }, { resultado: 'FALLIDA' }, { resultado: 'PARCIAL' }, null,
  ]), { completadas: 1, fallidas: 3 });
  assert.deepStrictEqual(orq.resumirResultados([]), { completadas: 0, fallidas: 0 });
});

// ── Gate de dependencias fallidas ────────────────────────────────────────────

test('depsFallidas: solo COMPLETADA satisface una dependencia', () => {
  const task = tarea('b', ['ai_docs/tasks/a.md']);
  const completada = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'COMPLETADA' }];
  const fallida = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'FALLIDA' }];
  const parcial = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'PARCIAL' }];

  assert.deepStrictEqual(orq.depsFallidas(task, completada), []);
  assert.deepStrictEqual(orq.depsFallidas(task, fallida), ['ai_docs/tasks/a.md']);
  assert.deepStrictEqual(orq.depsFallidas(task, parcial), ['ai_docs/tasks/a.md']);
  assert.deepStrictEqual(orq.depsFallidas(task, []), []);
  assert.deepStrictEqual(orq.depsFallidas(tarea('a'), fallida), []);
});

test('depsFallidas: normaliza los separadores de ruta antes de comparar, igual que el grafo', () => {
  // Rojo antes de esta task: la comparacion estricta dejaba pasar una dependencia con barras
  // invertidas pese a que su padre estaba FALLIDA, evadiendo el bloqueo con separadores de Windows.
  const task = tarea('hija', ['ai_docs\\tasks\\a.md']);
  const fallida = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'FALLIDA' }];
  const completada = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'COMPLETADA' }];

  assert.deepStrictEqual(orq.depsFallidas(task, fallida), ['ai_docs\\tasks\\a.md']);
  assert.deepStrictEqual(orq.depsFallidas(task, completada), []);
});

// ── Contratos: productor duplicado ───────────────────────────────────────────

test('verificarContratos: dos productores del mismo contrato se nombran, sin acusar al consumidor correcto', () => {
  // Rojo antes de esta task: el mapa de ultima-escritura-gana indexaba un solo productor por
  // nombre, asi que B (que si depende de su productor real) se denunciaba en su lugar, y la
  // duplicidad real -el error de plan verdadero- nunca se nombraba.
  const a = { path: 'ai_docs/tasks/001_a.md', contratos: [{ tipo: 'produce', nombre: 'ApiX' }], dependencias: [] };
  const b = {
    path: 'ai_docs/tasks/002_b.md',
    dependencias: ['ai_docs/tasks/001_a.md'],
    contratos: [{ tipo: 'consume', nombre: 'ApiX' }],
  };
  const c = { path: 'ai_docs/tasks/003_c.md', contratos: [{ tipo: 'produce', nombre: 'ApiX' }], dependencias: [] };

  const problemas = orq.verificarContratos([a, b, c]);

  assert.strictEqual(problemas.length, 1, 'un solo problema: la duplicidad, no el falso positivo contra B');
  assert.match(problemas[0], /"ApiX".*mas de un productor/);
  assert.match(problemas[0], /001_a\.md/);
  assert.match(problemas[0], /003_c\.md/);
  assert.ok(!problemas.some(p => p.includes('002_b.md')), 'B si depende de su productor: no debe aparecer');
});

test('ejecutarTask: una dependencia fallida de un nivel anterior bloquea, sin invocar al implementador', async () => {
  let invocado = 0;
  const previos = [{ task_path: 'ai_docs/tasks/a.md', task_titulo: 'a', resultado: 'FALLIDA' }];
  const r = await orq.ejecutarTask(tarea('b', ['ai_docs/tasks/a.md']), previos, {
    implementar: async () => { invocado += 1; return resultadoDe(tarea('b')); },
    gateTests: async () => { throw new Error('no debe llegar al gate'); },
    revisarYComitear: async () => { throw new Error('no debe commitear'); },
    descartar: async () => { throw new Error('no debe descartar trabajo que no existe'); },
  });

  assert.strictEqual(invocado, 0);
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.deepStrictEqual(r.archivos_modificados, []);
  assert.match(r.notas, /sus dependencias no se completaron \(ai_docs\/tasks\/a\.md\)/);
});

// ── Ejecucion de una task: el rojo de la suite bloquea el commit ──────────────
// Mutante que sobrevivia: `if (false && ...)` en el gate. La suite en rojo dejaba
// de bloquear y las 553 pruebas seguian verdes.

/** Dependencias de ejecutarTask con recordatorio de que se invoco. */
function depsTask(overrides) {
  const visto = { implementadas: [], comiteadas: [], descartes: 0, mensajes: [] };
  const deps = Object.assign({
    log: m => visto.mensajes.push(m),
    implementar: async t => { visto.implementadas.push(t.titulo); return resultadoDe(t); },
    gateTests: async () => ({ estado: 'PASA', nota: 'Tests verdes (exit 0) via package.json' }),
    revisarYComitear: async (t, r) => { visto.comiteadas.push(t.titulo); return r; },
    descartar: async () => { visto.descartes += 1; },
  }, overrides || {});
  return { deps, visto };
}

test('ejecutarTask: la suite en rojo bloquea el commit y descarta el trabajo de la task', async () => {
  const { deps, visto } = depsTask({
    gateTests: async () => ({ estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }),
  });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.deepStrictEqual(visto.comiteadas, [], 'con la suite en rojo no se commitea');
  assert.strictEqual(visto.descartes, 1, 'el trabajo de la task se descarta');
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /gate de tests: Tests en rojo \(exit 1\)/);
  assert.strictEqual(r.gate_tests.estado, 'FALLIDA');
});

test('ejecutarTask: la suite verde deja pasar a revision y commit', async () => {
  const { deps, visto } = depsTask();
  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.deepStrictEqual(visto.implementadas, ['a']);
  assert.deepStrictEqual(visto.comiteadas, ['a']);
  assert.strictEqual(visto.descartes, 0);
  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(r.gate_tests.estado, 'PASA');
});

test('ejecutarTask: el escape de emergencia degrada el rojo a aviso, sin descartar el trabajo', async () => {
  const { deps, visto } = depsTask({
    gateTests: async () => ({ estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }),
    env: { SDD_GUARD_SKIP: '1' },
  });

  await orq.ejecutarTask(tarea('a'), [], deps);

  assert.deepStrictEqual(visto.comiteadas, ['a']);
  assert.strictEqual(visto.descartes, 0);
});

test('ejecutarTask: un gate ADVISORY continua y deja constancia del motivo', async () => {
  const { deps, visto } = depsTask({
    gateTests: async () => ({ estado: 'ADVISORY', nota: 'la task solo toca docs/config (exenta)' }),
  });

  await orq.ejecutarTask(tarea('a'), [], deps);

  assert.deepStrictEqual(visto.comiteadas, ['a']);
  assert.ok(visto.mensajes.some(m => /solo toca docs\/config/.test(m)));
});

test('ejecutarTask: git averiado conserva el trabajo, y el escape de emergencia no lo degrada', async () => {
  for (const env of [{}, { SDD_GUARD_SKIP: '1' }]) {
    const { deps, visto } = depsTask({
      gateTests: async () => ({
        estado: 'FALLIDA', infraestructura: true, nota: 'git add -A fallo: exit 128',
      }),
      env,
    });

    const r = await orq.ejecutarTask(tarea('a'), [], deps);

    assert.strictEqual(visto.descartes, 0,
      'nada acredita que el trabajo este mal: descartarlo lo perderia');
    assert.deepStrictEqual(visto.comiteadas, [], 'con git averiado no hay commit posible');
    assert.strictEqual(r.resultado, 'FALLIDA');
    assert.match(r.notas, /fallo de git, no veredicto de revision/);
  }
});

test('ejecutarTask: si el implementador reporta FALLIDA no se revisa ni se commitea', async () => {
  const { deps, visto } = depsTask({
    implementar: async t => resultadoDe(t, 'FALLIDA'),
    gateTests: async () => { throw new Error('no debe llegar al gate'); },
  });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.deepStrictEqual(visto.comiteadas, []);
  assert.strictEqual(r.resultado, 'FALLIDA');
});

test('ejecutarTask: sin resultado del agente el motivo consta y no se propaga excepcion', async () => {
  const { deps } = depsTask({ implementar: async () => null });
  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /El agente no retorno resultado/);
});

// ── Lectura de git verificada por codigo de salida ───────────────────────────
// Mutante que sobrevivia: devolver siempre exito sin mirar el codigo de salida. El
// test que decia comprobarlo solo buscaba una cadena en el fuente del workflow.

test('gitVerificado: exit 0 -> salida utilizable, y el argv llega intacto al proceso', async () => {
  const git = gitDoble({ 'diff --cached': { code: 0, out: 'diff --git a/x b/x\n', err: '' } });
  const r = await orq.gitVerificado(['diff', '--cached'], git.spawn);

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.out, 'diff --git a/x b/x\n');
  assert.deepStrictEqual(git.llamadas, ['diff --cached']);
});

test('gitVerificado: exit != 0 es un fallo, aunque la salida venga vacia como un vacio legitimo', async () => {
  const git = gitDoble({ 'diff --cached': { code: 128, out: '', err: 'fatal: not a git repository' } });
  const r = await orq.gitVerificado(['diff', '--cached'], git.spawn);

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.out, '');
  assert.match(r.error, /git diff --cached fallo: exit 128/);
  assert.match(r.error, /not a git repository/);
});

test('gitVerificado: sin codigo de salida (tiempo agotado, senal, git ausente) es un fallo', async () => {
  const git = gitDoble({ 'add -A': { code: null, out: '', err: 'spawnSync git ETIMEDOUT' } });
  const r = await orq.gitVerificado(['add', '-A'], git.spawn);

  assert.strictEqual(r.ok, false);
  assert.match(r.error, /sin codigo de salida/);
});

// ── Revision del diff y commit de la task ────────────────────────────────────

const DIFF = 'diff --git a/src/a.js b/src/a.js\n+una linea\n';

/** Dependencias de revisarYComitear con recordatorio de lo invocado. */
function depsRevision(git, overrides) {
  const visto = { revisiones: [], correcciones: 0, firmados: [], descartes: 0 };
  const deps = Object.assign({
    spawnGit: git.spawn,
    log: () => {},
    revisar: async (t, diff) => { visto.revisiones.push(diff); return { veredicto: 'APROBADA' }; },
    corregir: async () => { visto.correcciones += 1; },
    emitirSenal: async diff => { visto.firmados.push(diff); return 'hash-de-' + diff.length; },
    descartar: async () => { visto.descartes += 1; },
  }, overrides || {});
  return { deps, visto };
}

test('revisarYComitear: revision aprobada -> constancia atada a ESE diff y commit verificado', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git);
  const resultado = Object.assign(resultadoDe(tarea('a')),
    { commit_message: 'feat: implementa a', commit_cuerpo: 'que y por que' });

  const r = await orq.revisarYComitear(tarea('a'), resultado, deps);

  assert.deepStrictEqual(visto.revisiones, [DIFF]);
  assert.deepStrictEqual(visto.firmados, [DIFF], 'la constancia se ata al diff revisado');
  assert.strictEqual(visto.correcciones, 0);
  assert.strictEqual(visto.descartes, 0);
  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(r.marca_revision, 'hash-de-' + DIFF.length);
  assert.deepStrictEqual(git.llamadas,
    [ADD_PROYECTO, DIFF_PROYECTO, 'commit -m feat: implementa a -m que y por que ' + PROYECTO]);
});

test('revisarYComitear: un diff que no se pudo leer no se confunde con un working tree limpio', async () => {
  // El defecto que cierra: git no corre, la salida estandar viene vacia igual que
  // en un working tree limpio, se registraba la constancia de ese vacio y el gate
  // denegaba el commit despues sin que nada explicase por que.
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 128, out: '', err: 'fatal: index.lock existe' } });
  const { deps, visto } = depsRevision(git);

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(visto.firmados, [], 'no se registra constancia de un diff que no se leyo');
  assert.deepStrictEqual(visto.revisiones, []);
  assert.strictEqual(visto.descartes, 0, 'un fallo de git no acredita que el trabajo este mal');
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /fallo de git, no veredicto de revision/);
  assert.match(r.notas, /exit 128/);
  assert.doesNotMatch(r.notas, /sin cambios en el working tree/);
});

test('revisarYComitear: si la preparacion del diff no corre, no hay revision ni commit', async () => {
  const git = gitDoble({ [ADD_PROYECTO]: { code: null, out: '', err: 'spawnSync git ETIMEDOUT' } });
  const { deps, visto } = depsRevision(git);

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(git.llamadas, [ADD_PROYECTO], 'no se sigue leyendo tras un git que no corrio');
  assert.deepStrictEqual(visto.revisiones, []);
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /sin codigo de salida/);
});

test('revisarYComitear: exit 0 sin nada preparado es un working tree limpio, no un fallo', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: '', err: '' } });
  const { deps, visto } = depsRevision(git);
  // Task sin ficheros declarados: es la situacion legitima que este caso fija, distinta de F2
  // (diff vacio con trabajo declarado), cubierta abajo.
  const resultado = Object.assign(resultadoDe(tarea('a')), { archivos_modificados: [] });

  const r = await orq.revisarYComitear(tarea('a'), resultado, deps);

  assert.deepStrictEqual(visto.revisiones, [], 'no hay diff que revisar');
  assert.strictEqual(visto.descartes, 0);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'COMPLETADA', 'el resultado del implementador no se degrada');
  assert.match(r.notas, /sin cambios en el working tree: no se commitea/);
});

// ── F2: diff vacio inesperado (trabajo declarado que ya no esta) ─────────────
// Rojo antes de esta task: esta misma rama servia a dos situaciones opuestas — la task sin nada
// que hacer, y aquella cuyo trabajo desaparecio (absorbido por una hermana o apartado en stash)
// — y las dos se reportaban COMPLETADA. depsFallidas no bloquea por una COMPLETADA, asi que las
// tasks posteriores avanzaban creyendo que el fichero o el contrato existia.

test('revisarYComitear: diff vacio con archivos_modificados declarados es un exito falso, no COMPLETADA', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: '', err: '' } });
  const { deps, visto } = depsRevision(git);
  const resultado = resultadoDe(tarea('a')); // archivos_modificados: ['src/a.js'], no vacio

  const r = await orq.revisarYComitear(tarea('a'), resultado, deps);

  assert.deepStrictEqual(visto.revisiones, [], 'no hay diff que revisar: no llego a existir');
  assert.strictEqual(visto.descartes, 0, 'nada que descartar: el trabajo ya no esta en el tree');
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'FALLIDA', 'el trabajo declarado que ya no esta no es un exito');
  assert.match(r.notas, /no queda nada que commitear|trabajo declarado/);
});

test('ejecutarTask: la task cuyo trabajo desaparecio protege a las posteriores via depsFallidas', async () => {
  // Composicion real: el diff vacio inesperado se traduce en FALLIDA, y esa FALLIDA
  // bloquea a quien dependa de ella (a diferencia de antes, cuando avanzaban sobre un
  // contrato que en realidad no existia).
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: '', err: '' } });
  const deps = Object.assign(depsTask().deps, {
    revisarYComitear: (t, r) => orq.revisarYComitear(t, r, depsRevision(git).deps),
  });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);
  assert.strictEqual(r.resultado, 'FALLIDA');

  const bloqueada = orq.depsFallidas(tarea('b', ['ai_docs/tasks/a.md']), [r]);
  assert.deepStrictEqual(bloqueada, ['ai_docs/tasks/a.md']);
});

// ── F1: el commit de una task no arrastra ficheros de una hermana (ambito) ───
// Rojo antes de esta task: `git add -A` sin pathspec preparaba el arbol entero, asi que en modo
// concurrente el commit de una task se llevaba tambien el trabajo sin commitear de una hermana.

test('revisarYComitear: en modo concurrente, add y diff llegan acotados al ambito declarado de la task', async () => {
  const git = gitDoble({
    'diff --cached -- src/a.js': { code: 0, out: DIFF, err: '' },
    'status --porcelain -z --untracked-files=all -- src/a.js': { code: 0, out: ' M src/a.js\0', err: '' },
  });
  const { deps } = depsRevision(git, { ambito: ['src/a.js'] });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  const preparacion = git.llamadas.filter(c => /^(add|diff)/.test(c));
  assert.strictEqual(preparacion[0], 'add -A -- src/a.js',
    'el add no debe absorber los ficheros de una hermana');
  assert.strictEqual(preparacion[1], 'diff --cached -- src/a.js');
  assert.strictEqual(r.resultado, 'COMPLETADA');
});

test('revisarYComitear: el ambito acota tambien la segunda preparacion, tras una correccion', async () => {
  const git = gitDoble({
    'diff --cached -- src/a.js': n => ({ code: 0, out: n === 1 ? DIFF : DIFF + '+corregido\n', err: '' }),
    'status --porcelain -z --untracked-files=all -- src/a.js': { code: 0, out: ' M src/a.js\0', err: '' },
  });
  const veredictos = [{ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['x'] }, { veredicto: 'APROBADA' }];
  const { deps, visto } = depsRevision(git, {
    ambito: ['src/a.js'],
    revisar: async () => veredictos.shift(),
  });

  await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(visto.correcciones, 1);
  assert.deepStrictEqual(
    git.llamadas.filter(c => c.startsWith('diff')),
    ['diff --cached -- src/a.js', 'diff --cached -- src/a.js'],
  );
});

test('revisarYComitear: ambito vacio en modo concurrente acota el add solo al proyecto y registra el motivo', async () => {
  // Task sin tabla "Archivos afectados" legible: acotar a una lista vacia equivaldria a no
  // commitear nunca, asi que solo se acota al proyecto (add -A -- .).
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps } = depsRevision(git, { ambito: [] });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(git.llamadas.slice(0, 2), [ADD_PROYECTO, DIFF_PROYECTO]);
  assert.match(r.notas, /ambito vacio/);
  assert.strictEqual(r.resultado, 'COMPLETADA');
});

test('revisarYComitear: sin ambito (modo secuencial) el add se acota al proyecto y sin nota alguna', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps } = depsRevision(git); // sin `ambito` en absoluto

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(git.llamadas.slice(0, 2), [ADD_PROYECTO, DIFF_PROYECTO]);
  assert.doesNotMatch(r.notas || '', /ambito/);
});

// Regresion: acotar add/diff (arriba) no bastaba. En modo concurrente el indice es compartido,
// asi que `git commit` sin pathspec se llevaba igual el trabajo ya preparado de una hermana --
// exactamente lo que add/diff ya evitaban, colandose de vuelta en el propio commit.
test('revisarYComitear: en modo concurrente, el commit tambien llega acotado al ambito declarado', async () => {
  const git = gitDoble({
    'diff --cached -- src/a.js': { code: 0, out: DIFF, err: '' },
    'status --porcelain -z --untracked-files=all -- src/a.js': { code: 0, out: ' M src/a.js\0', err: '' },
  });
  const { deps } = depsRevision(git, { ambito: ['src/a.js'] });

  await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  const commit = git.llamadas.find(c => c.startsWith('commit'));
  assert.match(commit, /-- src\/a\.js$/,
    'el commit debe acotarse al mismo ambito que add/diff, o absorbe el indice de una hermana');
});

test('revisarYComitear: sin ámbito (modo secuencial), add, diff y commit se acotan al proyecto', async () => {
  // En un monorepo el proyecto es un subdirectorio: sin `-- .` se prepararía y
  // commitearía también lo de fuera, que la comprobación de árbol limpio no mira.
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps } = depsRevision(git); // sin `ambito`

  await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(git.llamadas.slice(0, 2), [ADD_PROYECTO, DIFF_PROYECTO]);
  const commit = git.llamadas.find(c => c.startsWith('commit'));
  assert.ok(commit.endsWith(' ' + PROYECTO), 'el commit cubre lo mismo que se revisó: ' + commit);
});

test('revisarYComitear: un crítico -> corrección, re-revisión del nuevo diff aprobada y commit', async () => {
  const CORREGIDO = DIFF + '+corregido\n';
  const git = gitDoble({
    [DIFF_PROYECTO]: n => ({ code: 0, out: n === 1 ? DIFF : CORREGIDO, err: '' }),
  });
  const veredictos = [{ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['x'] }, { veredicto: 'APROBADA' }];
  const { deps, visto } = depsRevision(git, {
    revisar: async (t, diff) => {
      visto0.push(diff);
      return veredictos.shift();
    },
  });
  const visto0 = visto.revisiones;

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(visto.revisiones, [DIFF, CORREGIDO]);
  assert.strictEqual(visto.correcciones, 1, 'una ronda basta si la re-revisión aprueba');
  assert.deepStrictEqual(visto.firmados, [CORREGIDO], 'se firma el diff que de verdad se aprobo');
  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.ok(git.llamadas.some(c => c.startsWith('commit')));
});

test('revisarYComitear: revision que sigue adversa -> tope de rondas, se aparta el trabajo y no se commitea', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git, {
    revisar: async (t, diff) => { visto1.push(diff); return { veredicto: 'RECHAZADA' }; },
  });
  const visto1 = visto.revisiones;

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(orq.MAX_RONDAS_CORRECCION, 3);
  assert.strictEqual(visto.revisiones.length, 4, 'la revisión inicial y una re-revisión por ronda');
  assert.strictEqual(visto.correcciones, 3);
  assert.strictEqual(visto.descartes, 1);
  assert.deepStrictEqual(visto.firmados, []);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'BLOQUEADA_REVISION');
  assert.match(r.notas, /revision adversarial: RECHAZADA/);
});

test('revisarYComitear: una revisión nula en todas las rondas nunca se commitea', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git, {
    revisar: async (t, diff) => { visto2.push(diff); return null; },
  });
  const visto2 = visto.revisiones;

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(visto.revisiones.length, 1 + orq.MAX_RONDAS_CORRECCION, 'cada revisión nula consume una ronda');
  assert.strictEqual(visto.correcciones, 0, 'sin veredicto no hay hallazgos que corregir');
  assert.deepStrictEqual(visto.firmados, []);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(visto.descartes, 1);
  assert.strictEqual(r.resultado, 'BLOQUEADA_REVISION');
  assert.match(r.notas, /revision adversarial: ERROR/);
});

test('revisarYComitear: un commit denegado no se reporta como task commiteada', async () => {
  const git = gitDoble({
    [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' },
    commit: { code: 1, out: '', err: 'el gate de revision denego el commit' },
  });
  const { deps } = depsRevision(git);

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /fallo de git, no veredicto de revision/);
  assert.match(r.notas, /denego el commit/);
});

test('revisarYComitear: sin commit_message propuesto el subject se deriva del titulo y se recorta', async () => {
  const largo = 'titulo interminable '.repeat(6).trim();
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps } = depsRevision(git);

  await orq.revisarYComitear(tarea(largo), { task_titulo: largo, resultado: 'COMPLETADA' }, deps);

  const commit = git.llamadas.find(c => c.startsWith('commit'));
  const subject = commit.slice('commit -m '.length).split(' -m ')[0];
  assert.strictEqual(subject.length, 72);
  assert.match(subject, /^feat: titulo interminable/);
});

// ── Convergencia ─────────────────────────────────────────────────────────────

test('resolverConvergencia: con tasks sin completar se omite, sin invocar la verificacion', async () => {
  let invocada = 0;
  const r = await orq.resolverConvergencia({
    completadas: 2, fallidas: 1, total: 3, log: () => {},
    verificar: async () => { invocada += 1; return { veredicto: 'CONVERGIDA' }; },
  });

  assert.strictEqual(invocada, 0, 'medir convergencia de lo que no se implemento no dice nada');
  assert.deepStrictEqual(r, { veredicto: 'OMITIDA', razon: 'tasks_fallidas' });
});

test('resolverConvergencia: una respuesta que no parsea no se toma por convergida', async () => {
  const respuestas = [null, undefined, {}, { criterios_verificados: 9 }, { veredicto: 'CERRADA', brechas: [] }];
  for (const respuesta of respuestas) {
    let creaciones = 0;
    const r = await orq.resolverConvergencia({
      completadas: 3, fallidas: 0, total: 3, log: () => {}, verificar: async () => respuesta,
      crearTasks: async () => { creaciones += 1; return []; },
    });
    assert.deepStrictEqual(r, { veredicto: 'ERROR', razon: 'parse_failed' }, JSON.stringify(respuesta));
    assert.strictEqual(creaciones, 0, JSON.stringify(respuesta));
  }
});

const BRECHA_A = { criterio: 'CA-1', hallazgo: 'falta el login', evidencia: 'src/auth.js:10', severidad: 'BLOQUEANTE' };
const BRECHA_B = { criterio: 'CA-2', hallazgo: 'logout a medias', evidencia: 'src/auth.js:40', severidad: 'BLOQUEANTE' };
const AVISO = { criterio: 'CA-3', hallazgo: 'mensaje poco claro', evidencia: 'src/ui.js:5', severidad: 'WARNING' };

test('resolverConvergencia: DIVERGE pasa solo las brechas BLOQUEANTES al paso de creación', async () => {
  const recibidas = [];
  const registro = [];
  const r = await orq.resolverConvergencia({
    completadas: 3, fallidas: 0, total: 3, log: m => registro.push(m),
    verificar: async () => ({ veredicto: 'DIVERGE', criterios_verificados: 7, brechas: [BRECHA_A, AVISO, BRECHA_B] }),
    crearTasks: async (brechas) => {
      recibidas.push(brechas);
      return ['ai_docs/tasks/004_convergencia_auth.md', 'ai_docs/tasks/005_convergencia_auth.md'];
    },
  });

  assert.deepStrictEqual(recibidas, [[BRECHA_A, BRECHA_B]]);
  assert.deepStrictEqual(r, {
    veredicto: 'DIVERGE', criterios_verificados: 7,
    brechas: [BRECHA_A, BRECHA_B], avisos: [AVISO],
    tasks_generadas: ['ai_docs/tasks/004_convergencia_auth.md', 'ai_docs/tasks/005_convergencia_auth.md'],
  });
  // El registro distingue lo reportado de lo creado: reportar no es generar.
  const texto = registro.join('\n');
  assert.match(texto, /2 brecha\(s\) BLOQUEANTE reportada\(s\): CA-1 — falta el login; CA-2 — logout a medias/);
  assert.match(texto, /2 task\(s\) creada\(s\) por el paso de creación/);
  assert.doesNotMatch(texto, /generadas/);
});

test('resolverConvergencia: con solo WARNING no se crean tasks y la spec converge con los avisos', async () => {
  for (const veredicto of ['DIVERGE', 'CONVERGIDA']) {
    let creaciones = 0;
    const registro = [];
    const r = await orq.resolverConvergencia({
      completadas: 3, fallidas: 0, total: 3, log: m => registro.push(m),
      verificar: async () => ({ veredicto, criterios_verificados: 5, brechas: [AVISO] }),
      crearTasks: async () => { creaciones += 1; return ['ai_docs/tasks/009_x.md']; },
    });

    assert.strictEqual(creaciones, 0, veredicto);
    assert.deepStrictEqual(r,
      { veredicto: 'CONVERGIDA', criterios_verificados: 5, avisos: [AVISO], tasks_generadas: [] }, veredicto);
    assert.match(registro.join('\n'), /1 aviso\(s\) para que decida el usuario: CA-3 — mensaje poco claro/);
  }
});

test('resolverConvergencia: una brecha BLOQUEANTE impide cerrar aunque el agente diga CONVERGIDA', async () => {
  const r = await orq.resolverConvergencia({
    completadas: 1, fallidas: 0, total: 1, log: () => {},
    verificar: async () => ({ veredicto: 'CONVERGIDA', criterios_verificados: 2, brechas: [BRECHA_A] }),
    crearTasks: async () => ['ai_docs/tasks/006_convergencia_auth.md'],
  });

  assert.strictEqual(r.veredicto, 'DIVERGE');
  assert.deepStrictEqual(r.tasks_generadas, ['ai_docs/tasks/006_convergencia_auth.md']);
});

test('resolverConvergencia: si la creación no devuelve rutas, DIVERGE conserva todas las brechas', async () => {
  const fallos = [async () => null, async () => { throw new Error('sin agente'); }, undefined];
  for (const crearTasks of fallos) {
    const registro = [];
    const r = await orq.resolverConvergencia({
      completadas: 3, fallidas: 0, total: 3, log: m => registro.push(m),
      verificar: async () => ({ veredicto: 'DIVERGE', criterios_verificados: 7, brechas: [BRECHA_A, AVISO, BRECHA_B] }),
      crearTasks,
    });

    assert.deepStrictEqual(r, {
      veredicto: 'DIVERGE', criterios_verificados: 7,
      brechas: [BRECHA_A, BRECHA_B], avisos: [AVISO], tasks_generadas: [],
    }, String(crearTasks));
    assert.match(registro.join('\n'), /no devolvió rutas; las brechas quedan en el resultado/);
  }
});

test('resolverConvergencia: DIVERGE sin brechas no se toma por convergida ni crea tasks', async () => {
  let creaciones = 0;
  const r = await orq.resolverConvergencia({
    completadas: 3, fallidas: 0, total: 3, log: () => {},
    verificar: async () => ({ veredicto: 'DIVERGE', criterios_verificados: 4, brechas: [] }),
    crearTasks: async () => { creaciones += 1; return []; },
  });

  assert.strictEqual(creaciones, 0);
  assert.deepStrictEqual(r,
    { veredicto: 'DIVERGE', criterios_verificados: 4, brechas: [], avisos: [], tasks_generadas: [] });
});

test('resolverConvergencia: CONVERGIDA cierra la spec con sus criterios verificados', async () => {
  const r = await orq.resolverConvergencia({
    completadas: 3, fallidas: 0, total: 3, log: () => {},
    verificar: async () => ({ veredicto: 'CONVERGIDA', criterios_verificados: 5, brechas: [] }),
    crearTasks: async () => { throw new Error('no debe llamarse'); },
  });

  assert.deepStrictEqual(r,
    { veredicto: 'CONVERGIDA', criterios_verificados: 5, avisos: [], tasks_generadas: [] });
});

// ── Resultado del flujo ──────────────────────────────────────────────────────
// Mutante que sobrevivia: mover el campo de convergencia a un comentario y devolver
// nulo. La busqueda de texto la satisfacia el propio comentario.

test('construirResultado: el retorno lleva las cifras del conjunto y el veredicto de convergencia', () => {
  const implementaciones = [resultadoDe(tarea('a')), resultadoDe(tarea('b'), 'FALLIDA')];
  const r = orq.construirResultado({
    spec: SPEC, spec_titulo: 'Autenticacion', tasks_total: 2, niveles: 1,
    completadas: 1, fallidas: 1, implementaciones,
    convergencia: { veredicto: 'OMITIDA', razon: 'tasks_fallidas' },
  });

  assert.deepStrictEqual(Object.keys(r), [
    'spec', 'spec_titulo', 'tasks_total', 'niveles',
    'tasks_completadas', 'tasks_fallidas', 'implementaciones', 'convergencia',
  ]);
  assert.strictEqual(r.spec, SPEC);
  assert.strictEqual(r.tasks_completadas, 1);
  assert.strictEqual(r.tasks_fallidas, 1);
  assert.deepStrictEqual(r.convergencia, { veredicto: 'OMITIDA', razon: 'tasks_fallidas' });
  assert.deepStrictEqual(r.implementaciones, implementaciones);
});

// ── Gate de tests: calculo real del veredicto (sin doble) ────────────────────
// Los bloques de arriba inyectan `gateTests` como doble: acreditan que
// `ejecutarTask` respeta el veredicto, no como se calcula. Aqui se llama
// directo a las funciones exportadas -- `evaluarGateTests`, `descubrirComandoTest`
// y `veredictoPorExitCode` a traves de ella -- sin ningun doble de por medio.

const COMANDO = { cmd: 'npm', args: ['test'], fuente: 'package.json' };

test('evaluarGateTests: exit 0 es el unico verde', () => {
  const r = orq.evaluarGateTests({ comando: COMANDO, exitCode: 0 });
  assert.strictEqual(r.estado, 'PASA');
  assert.match(r.nota, /exit 0/);
});

test('evaluarGateTests: exit distinto de cero es rojo', () => {
  const r = orq.evaluarGateTests({ comando: COMANDO, exitCode: 1 });
  assert.strictEqual(r.estado, 'FALLIDA');
});

test('evaluarGateTests: exitCode "0" en cadena no es verde -- exit 0 es EXACTAMENTE el numero 0', () => {
  const r = orq.evaluarGateTests({ comando: COMANDO, exitCode: '0' });
  assert.strictEqual(r.estado, 'FALLIDA');
});

test('evaluarGateTests: sin codigo de salida (null o undefined) es rojo, no un pase, y la nota nombra la causa', () => {
  for (const exitCode of [null, undefined]) {
    const r = orq.evaluarGateTests({ comando: COMANDO, exitCode });
    assert.strictEqual(r.estado, 'FALLIDA', 'exitCode=' + exitCode);
    assert.match(r.nota, /sin codigo de salida/, 'exitCode=' + exitCode);
  }
});

test('evaluarGateTests: exit negativo (-1) es rojo', () => {
  const r = orq.evaluarGateTests({ comando: COMANDO, exitCode: -1 });
  assert.strictEqual(r.estado, 'FALLIDA');
});

test('evaluarGateTests: sin comando y tocando codigo ejecutable bloquea', () => {
  const r = orq.evaluarGateTests({ comando: null, archivos: ['src/a.js'] });
  assert.strictEqual(r.estado, 'FALLIDA');
});

test('evaluarGateTests: sin comando y tocando solo docs/config exime con aviso, no bloquea', () => {
  const r = orq.evaluarGateTests({ comando: null, archivos: ['README.md', 'config.json'] });
  assert.strictEqual(r.estado, 'ADVISORY');
});

test('evaluarGateTests: un archivo sin extension cuenta como no ejecutable', () => {
  const r = orq.evaluarGateTests({ comando: null, archivos: ['LICENSE', 'Makefile'] });
  assert.strictEqual(r.estado, 'ADVISORY');
});

test('evaluarGateTests: entrada vacia no lanza y devuelve el veredicto de la rama sin comando ni archivos', () => {
  assert.strictEqual(orq.evaluarGateTests().estado, 'ADVISORY');
  assert.strictEqual(orq.evaluarGateTests({}).estado, 'ADVISORY');
});

// ── Gate de tests: descubrimiento del comando (fixtures en disco) ────────────

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-tests-'));
}

function escribirArchivo(base, ruta, contenido) {
  const destino = path.join(base, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

test('descubrirComandoTest: package.json con scripts.test real -> fuente package.json', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'package.json', JSON.stringify({ scripts: { test: 'node --test tests/' } }));

  const r = orq.descubrirComandoTest(base);
  assert.strictEqual(r.fuente, 'package.json');
  assert.strictEqual(r.cmd, 'npm');
});

test('descubrirComandoTest: el comando configurado gana a npm -- par de fixtures, con y sin hooks/config.json', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'package.json', JSON.stringify({ scripts: { test: 'node --test tests/' } }));

  const sinConfigurado = orq.descubrirComandoTest(base);
  assert.strictEqual(sinConfigurado.fuente, 'package.json');

  escribirArchivo(base, 'hooks/config.json', JSON.stringify({ sdd_test_gate: { command: 'pytest -x' } }));
  const conConfigurado = orq.descubrirComandoTest(base);
  assert.strictEqual(conConfigurado.fuente, 'hooks/config.json');
  assert.strictEqual(conConfigurado.cmd, 'pytest');
  assert.deepStrictEqual(conConfigurado.args, ['-x']);
});

test('descubrirComandoTest: solo pytest.ini -> fuente pytest.ini', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'pytest.ini', '[pytest]\n');

  const r = orq.descubrirComandoTest(base);
  assert.strictEqual(r.fuente, 'pytest.ini');
  assert.strictEqual(r.cmd, 'pytest');
});

test('descubrirComandoTest: el placeholder de npm no cuenta, cae al siguiente candidato', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'package.json',
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  escribirArchivo(base, 'pytest.ini', '[pytest]\n');

  const r = orq.descubrirComandoTest(base);
  assert.notStrictEqual(r && r.cmd, 'npm');
  assert.strictEqual(r.fuente, 'pytest.ini');
});

test('descubrirComandoTest: setup.cfg sin [tool:pytest] no es runner', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'setup.cfg', '[metadata]\nname = paquete\n');

  assert.strictEqual(orq.descubrirComandoTest(base), null);
});

test('descubrirComandoTest: setup.cfg con [tool:pytest] si es runner', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'setup.cfg', '[tool:pytest]\ntestpaths = tests\n');

  const r = orq.descubrirComandoTest(base);
  assert.strictEqual(r.fuente, 'setup.cfg');
  assert.strictEqual(r.cmd, 'pytest');
});

test('descubrirComandoTest: directorio sin ningun candidato -> null', () => {
  const base = dirTemporal();
  assert.strictEqual(orq.descubrirComandoTest(base), null);
});

test('descubrirComandoTest: package.json con JSON corrupto no tumba el descubrimiento, cae al siguiente', () => {
  const base = dirTemporal();
  escribirArchivo(base, 'package.json', '{ esto no es json');
  escribirArchivo(base, 'pytest.ini', '[pytest]\n');

  const r = orq.descubrirComandoTest(base);
  assert.strictEqual(r.fuente, 'pytest.ini');
});

// ── Árbol limpio y apartado recuperable ──────────────────────────────────────
// El descarte de una task fallida era `reset --hard` + `clean -fd` sobre todo el
// árbol: borraba el trabajo sin commitear del usuario y, en concurrente, el de las
// hermanas en curso. Ahora se aparta en `git stash`, y el recorrido secuencial
// exige el árbol limpio fuera de RUTAS_FUERA antes de cada task.
//
// Control positivo: con el descarte antiguo cableado como `descartar`, los casos
// que miran el git grabado caen por la llamada a `reset --hard`.

const ESTADO = 'status --porcelain --untracked-files=all ' + PROYECTO;
const APARTADO_SECUENCIAL =
  /^stash push --include-untracked -m sdd-apartado: .+ -- \. :\(exclude\)ai_docs\/tasks :\(exclude\)ai_docs\/audits$/;

function sinDestruccion(llamadas) {
  for (const c of llamadas) {
    assert.ok(!/^reset --hard/.test(c), 'ninguna ruta del workflow destruye el trabajo: ' + c);
    assert.ok(!/^clean /.test(c), 'ninguna ruta del workflow destruye el trabajo: ' + c);
  }
}

/** `descartar(task)` cableado como en el workflow, sobre el git grabado. */
function descartarCon(git, modoParalelo, ambito) {
  return t => orq.apartarTrabajo(t, { spawnGit: git.spawn, modoParalelo, ambito });
}

/**
 * Doble de git con estado: el implementador «escribe» poniendo `sucio`, el
 * apartado lo limpia y `status` informa según ese estado. Así se observa con qué
 * árbol empieza la task siguiente.
 */
function gitConEstado() {
  const arbol = { sucio: false, stashes: 0 };
  const git = gitDoble({
    [ESTADO]: () => ({ code: 0, out: arbol.sucio ? '?? src/escrito.js\n' : '', err: '' }),
    stash: () => { arbol.sucio = false; arbol.stashes += 1; return { code: 0, out: '', err: '' }; },
  });
  return { arbol, git };
}

test('evaluarArbolLimpio: fuera de RUTAS_FUERA ensucia el árbol, ai_docs/core incluido; dentro, no', () => {
  assert.deepStrictEqual(orq.RUTAS_FUERA, ['ai_docs/tasks', 'ai_docs/audits']);
  assert.deepStrictEqual(orq.evaluarArbolLimpio(''), { limpio: true, rutas: [] });
  assert.deepStrictEqual(
    orq.evaluarArbolLimpio('?? ai_docs/tasks/001_a.md\n?? ai_docs/audits/provenance.jsonl\n'),
    { limpio: true, rutas: [] });
  assert.deepStrictEqual(
    orq.evaluarArbolLimpio(' M src/a.js\n?? "con espacio.txt"\nR  viejo.js -> nuevo.js\n M ai_docs/core/x.md\n'),
    { limpio: false, rutas: ['src/a.js', 'con espacio.txt', 'nuevo.js', 'ai_docs/core/x.md'] });
  // Un fichero cuyo nombre solo empieza como una ruta excluida no está exento.
  assert.strictEqual(orq.evaluarArbolLimpio('?? ai_docs/tasks_copia.md\n').limpio, false);
});

test('comprobarArbolLimpio: git que no corre no acredita un árbol limpio', async () => {
  const git = gitDoble({ [ESTADO]: { code: 128, out: '', err: 'fatal: not a git repository' } });
  const r = await orq.comprobarArbolLimpio(git.spawn);
  assert.strictEqual(r.limpio, false);
  assert.match(r.error, /exit 128/);
  assert.match(orq.mensajeArbolSucio(r), /no se pudo comprobar/);
});

test('arranque: con un fichero fuera de RUTAS_FUERA modificado no se implementa y el mensaje da las tres salidas', async () => {
  const git = gitDoble({ [ESTADO]: { code: 0, out: ' M src/a.js\n', err: '' } });
  const estado = await orq.comprobarArbolLimpio(git.spawn);
  assert.strictEqual(estado.limpio, false);
  const mensaje = orq.mensajeArbolSucio(estado);
  assert.match(mensaje, /src\/a\.js/);
  assert.match(mensaje, /commit/);
  assert.match(mensaje, /git stash push --include-untracked/);
  assert.match(mensaje, /worktree/);

  // La misma comprobación, antes de cada task: el doble de implementar no se llama.
  const { deps, visto } = depsTask({ arbolLimpio: () => orq.comprobarArbolLimpio(git.spawn) });
  const resultados = await orq.recorrerNiveles([tareas('a', 'b')], (t, p) => orq.ejecutarTask(t, p, deps));
  assert.deepStrictEqual(visto.implementadas, []);
  assert.strictEqual(resultados[0].detener_recorrido, true);
  assert.match(resultados[0].notas, /residuo sin commitear fuera de ai_docs\/tasks\/ y ai_docs\/audits\/ al empezar \(src\/a\.js\)/);
  assert.match(resultados[1].notas, /el recorrido se detuvo en la task a/);
  assert.deepStrictEqual(orq.resumirResultados(resultados), { completadas: 0, fallidas: 2 });
});

test('arranque: un cambio solo bajo ai_docs/tasks/ no impide implementar', async () => {
  const git = gitDoble({ [ESTADO]: { code: 0, out: '?? ai_docs/tasks/001_a.md\n', err: '' } });
  assert.strictEqual((await orq.comprobarArbolLimpio(git.spawn)).limpio, true);

  const { deps, visto } = depsTask({ arbolLimpio: () => orq.comprobarArbolLimpio(git.spawn) });
  await orq.recorrerNiveles([tareas('a', 'b')], (t, p) => orq.ejecutarTask(t, p, deps));
  assert.deepStrictEqual(visto.implementadas, ['a', 'b']);
});

test('apartado: gate rojo en secuencial aparta todo el árbol salvo RUTAS_FUERA, sin reset ni clean', async () => {
  const git = gitDoble();
  const { deps } = depsTask({
    gateTests: async () => ({ estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }),
    descartar: descartarCon(git, false),
  });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.ok(git.llamadas.some(c => APARTADO_SECUENCIAL.test(c)), git.llamadas.join('\n'));
  assert.ok(git.llamadas.includes('stash push --include-untracked -m sdd-apartado: a ' + PROYECTO));
  sinDestruccion(git.llamadas);
  assert.match(r.notas, /trabajo apartado en git stash "sdd-apartado: a"/);
  assert.ok(!r.detener_recorrido);
});

test('apartado: gate rojo en concurrente aparta solo las rutas cambiadas del ámbito', async () => {
  const git = gitDoble({
    'status --porcelain -z --untracked-files=all -- src/a.js src/a.test.js':
      { code: 0, out: 'M  src/a.js\0?? src/a.test.js\0', err: '' },
  });
  const { deps } = depsTask({
    gateTests: async () => ({ estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }),
    descartar: descartarCon(git, true, ['src/a.js', 'src/a.test.js']),
  });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.ok(git.llamadas.includes('stash push --include-untracked -m sdd-apartado: a -- src/a.js src/a.test.js'),
    git.llamadas.join('\n'));
  assert.ok(!git.llamadas.some(c => APARTADO_SECUENCIAL.test(c)), 'en concurrente no se aparta el árbol entero');
  sinDestruccion(git.llamadas);
});

test('apartado: revisión adversa tras la corrección aparta, en los dos modos, sin reset ni clean', async () => {
  for (const modoParalelo of [false, true]) {
    const ambito = modoParalelo ? ['src/a.js'] : undefined;
    const git = gitDoble({
      [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' },
      'diff --cached -- src/a.js': { code: 0, out: DIFF, err: '' },
      'status --porcelain -z --untracked-files=all -- src/a.js': { code: 0, out: ' M src/a.js\0', err: '' },
    });
    const { deps } = depsRevision(git, {
      revisar: async () => ({ veredicto: 'RECHAZADA' }),
      descartar: descartarCon(git, modoParalelo, ambito),
      ambito,
    });

    const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

    assert.strictEqual(r.resultado, 'BLOQUEADA_REVISION');
    assert.strictEqual(git.llamadas.filter(c => c.startsWith('stash push')).length, 1);
    const esperado = modoParalelo
      ? 'stash push --include-untracked -m sdd-apartado: a -- src/a.js'
      : 'stash push --include-untracked -m sdd-apartado: a ' + PROYECTO;
    assert.ok(git.llamadas.includes(esperado), 'modoParalelo=' + modoParalelo + '\n' + git.llamadas.join('\n'));
    assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
    sinDestruccion(git.llamadas);
  }
});

test('apartado: en concurrente sin ámbito no se aparta nada y la task queda FALLIDA con la nota', async () => {
  const git = gitDoble();
  const { deps } = depsTask({
    gateTests: async () => ({ estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }),
    descartar: descartarCon(git, true, []),
  });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.ok(!git.llamadas.some(c => c.startsWith('stash')), git.llamadas.join('\n'));
  sinDestruccion(git.llamadas);
  assert.match(r.notas, /trabajo conservado sin commitear/);
  assert.ok(!r.detener_recorrido, 'en concurrente las hermanas siguen');
});

test('apartado: en concurrente, nada cambiado en el ámbito -> no hay stash que pueda fallar a medias', async () => {
  const git = gitDoble();
  const r = await orq.apartarTrabajo(tarea('a'), { spawnGit: git.spawn, modoParalelo: true, ambito: ['src/a.js'] });
  assert.strictEqual(r.ok, true);
  assert.ok(!git.llamadas.some(c => c.startsWith('stash')));
});

test('apartado: un stash que sale con 128 no destruye nada y detiene el recorrido secuencial', async () => {
  const git = gitDoble({ stash: { code: 128, out: '', err: 'fatal: index.lock' } });
  const { deps, visto } = depsTask({
    gateTests: async t => (t.titulo === 'a'
      ? { estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }
      : { estado: 'PASA', nota: 'verde' }),
    descartar: descartarCon(git, false),
  });

  const resultados = await orq.recorrerNiveles([tareas('a', 'b')], (t, p) => orq.ejecutarTask(t, p, deps));

  sinDestruccion(git.llamadas);
  assert.deepStrictEqual(visto.implementadas, ['a'], 'la siguiente absorbería el trabajo no apartado');
  assert.strictEqual(resultados[0].resultado, 'FALLIDA');
  assert.strictEqual(resultados[0].detener_recorrido, true);
  assert.match(resultados[0].notas, /no se pudo apartar el trabajo .*exit 128.*se conserva sin commitear/);
  assert.match(resultados[1].notas, /el recorrido se detuvo en la task a/);
});

test('apartado: si tras apartar queda residuo, el recorrido se detiene y la task siguiente no se implementa', async () => {
  // Primera lectura (precheck de a): limpio. Segunda (tras el stash): residuo.
  const git = gitDoble({
    [ESTADO]: n => ({ code: 0, out: n === 1 ? '' : '?? src/ignorado-por-el-stash.js\n', err: '' }),
  });
  const { deps, visto } = depsTask({
    gateTests: async () => ({ estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' }),
    descartar: descartarCon(git, false),
    arbolLimpio: () => orq.comprobarArbolLimpio(git.spawn),
  });

  const resultados = await orq.recorrerNiveles([tareas('a'), tareas('b')], (t, p) => orq.ejecutarTask(t, p, deps));

  assert.deepStrictEqual(visto.implementadas, ['a']);
  assert.strictEqual(resultados[0].detener_recorrido, true);
  assert.match(resultados[0].notas, /queda residuo: src\/ignorado-por-el-stash\.js/);
  assert.strictEqual(resultados[1].resultado, 'FALLIDA');
  sinDestruccion(git.llamadas);
});

test('apartado: el implementador que escribe y devuelve FALLIDA o nada deja el árbol limpio a la siguiente', async () => {
  for (const devuelto of ['FALLIDA', null]) {
    const { arbol, git } = gitConEstado();
    const { deps, visto } = depsTask({
      implementar: async t => {
        visto.implementadas.push(t.titulo);
        if (t.titulo !== 'a') return resultadoDe(t);
        arbol.sucio = true;
        return devuelto && resultadoDe(t, devuelto);
      },
      descartar: descartarCon(git, false),
      arbolLimpio: () => orq.comprobarArbolLimpio(git.spawn),
    });

    const resultados = await orq.recorrerNiveles([tareas('a', 'b')], (t, p) => orq.ejecutarTask(t, p, deps));

    assert.ok(git.llamadas.includes('stash push --include-untracked -m sdd-apartado: a ' + PROYECTO),
      'devuelto=' + devuelto);
    assert.strictEqual(arbol.stashes, 1);
    assert.deepStrictEqual(visto.implementadas, ['a', 'b'], 'devuelto=' + devuelto);
    assert.deepStrictEqual(resultados.map(r => r.resultado), ['FALLIDA', 'COMPLETADA']);
    sinDestruccion(git.llamadas);
  }
});

test('apartado: sin el apartado en esa rama, el precheck por task detiene el recorrido', async () => {
  for (const devuelto of ['FALLIDA', null]) {
    const { arbol, git } = gitConEstado();
    const { deps, visto } = depsTask({
      implementar: async t => {
        visto.implementadas.push(t.titulo);
        arbol.sucio = true;
        return devuelto && resultadoDe(t, devuelto);
      },
      descartar: undefined,
      arbolLimpio: () => orq.comprobarArbolLimpio(git.spawn),
    });

    const resultados = await orq.recorrerNiveles([tareas('a', 'b')], (t, p) => orq.ejecutarTask(t, p, deps));

    assert.deepStrictEqual(visto.implementadas, ['a'], 'devuelto=' + devuelto);
    assert.strictEqual(resultados[1].detener_recorrido, true);
    assert.match(resultados[1].notas, /residuo sin commitear .*src\/escrito\.js/);
  }
});

// ── Apartado con git real ────────────────────────────────────────────────────
// El doble acredita qué se pide a git; estos casos acreditan que git hace lo que
// se espera de esos argumentos: qué sale del árbol, qué queda y qué guarda el stash.

const cp = require('node:child_process');

function repoTemporal(subdirProyecto) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apartado-'));
  // `spawn` corre donde el workflow: en la raíz del proyecto, que en un monorepo
  // es un subdirectorio del repositorio.
  const proyecto = subdirProyecto ? path.join(dir, subdirProyecto) : dir;
  fs.mkdirSync(proyecto, { recursive: true });
  const spawn = async argv => {
    const r = cp.spawnSync('git', argv, { cwd: proyecto, encoding: 'utf8' });
    return { code: r.status, out: r.stdout || '', err: r.stderr || (r.error ? r.error.message : '') };
  };
  const g = argv => {
    const r = cp.spawnSync('git', argv, { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, argv.join(' ') + ': ' + r.stderr);
    return r.stdout;
  };
  g(['init', '-q']);
  g(['config', 'user.name', 'prueba']);
  g(['config', 'user.email', 'prueba@example.com']);
  g(['config', 'commit.gpgsign', 'false']);
  return { dir, spawn, g, escribir: (ruta, txt) => escribirArchivo(dir, ruta, txt) };
}

test('apartado con git real, secuencial: sale todo lo de la task, también lo escrito fuera de su tabla; ai_docs/tasks/ queda', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('base.txt', 'base\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('a.txt', 'de la task\n');
    repo.escribir('fuera.txt', 'fuera de su tabla\n');
    repo.escribir('ai_docs/tasks/x.md', 'plan\n');

    const r = await orq.apartarTrabajo(tarea('a'), { spawnGit: repo.spawn, modoParalelo: false });

    assert.strictEqual(r.ok, true, r.nota);
    assert.ok(!fs.existsSync(path.join(repo.dir, 'a.txt')));
    assert.ok(!fs.existsSync(path.join(repo.dir, 'fuera.txt')), 'la siguiente task lo commitearía como suyo');
    assert.strictEqual(fs.readFileSync(path.join(repo.dir, 'ai_docs/tasks/x.md'), 'utf8'), 'plan\n');
    assert.strictEqual(repo.g(['status', '--porcelain', '--', '.', ':(exclude)ai_docs/tasks', ':(exclude)ai_docs/audits']), '');
    assert.strictEqual((await orq.comprobarArbolLimpio(repo.spawn)).limpio, true);

    const guardado = repo.g(['stash', 'show', '-p', '--include-untracked', 'stash@{0}']);
    assert.match(guardado, /a\.txt/);
    assert.match(guardado, /fuera\.txt/);
    assert.doesNotMatch(guardado, /ai_docs/);
    assert.match(repo.g(['stash', 'list']), /sdd-apartado: a/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('apartado con git real, concurrente: sale solo el ámbito de la task; la hermana queda intacta', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('a.txt', 'a original\n');
    repo.escribir('b.txt', 'b original\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('a.txt', 'a de la task\n');
    repo.escribir('nuevo.txt', 'nuevo de la task\n');
    repo.escribir('b.txt', 'b de la hermana\n');
    // El gate de tests ya preparó el ámbito de la task en el índice compartido.
    repo.g(['add', '-A', '--', 'a.txt', 'nuevo.txt']);

    // El ámbito declara también un fichero que la task no llegó a crear: con él en
    // el pathspec, `git stash` guardaría la entrada y dejaría el árbol sin limpiar.
    const r = await orq.apartarTrabajo(tarea('a'), {
      spawnGit: repo.spawn, modoParalelo: true, ambito: ['a.txt', 'nuevo.txt', 'declarado_sin_crear.txt'],
    });

    assert.strictEqual(r.ok, true, r.nota);
    assert.strictEqual(fs.readFileSync(path.join(repo.dir, 'b.txt'), 'utf8'), 'b de la hermana\n');
    assert.strictEqual(fs.readFileSync(path.join(repo.dir, 'a.txt'), 'utf8'), 'a original\n');
    assert.ok(!fs.existsSync(path.join(repo.dir, 'nuevo.txt')));
    assert.strictEqual(repo.g(['status', '--porcelain']), ' M b.txt\n');

    const guardado = repo.g(['stash', 'show', '-p', '--include-untracked', 'stash@{0}']);
    assert.match(guardado, /a de la task/);
    assert.match(guardado, /nuevo de la task/);
    assert.doesNotMatch(guardado, /b\.txt/);
    assert.strictEqual(repo.g(['stash', 'list']).trim().split('\n').length, 1, 'una sola entrada');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('comprobarArbolLimpio con git real: ai_docs/tasks/ no cuenta; cualquier otra ruta sí', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('base.txt', 'base\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('ai_docs/tasks/001_a.md', 'plan\n');
    assert.strictEqual((await orq.comprobarArbolLimpio(repo.spawn)).limpio, true);

    repo.escribir('src/a.js', 'x\n');
    assert.deepStrictEqual(await orq.comprobarArbolLimpio(repo.spawn), { limpio: false, rutas: ['src/a.js'] });
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('apartado: si git stash no guarda nada, la nota no dice que se apartó', async () => {
  // «No local changes to save» sale con 0 y no crea entrada: la cima de la pila no cambia.
  const git = gitDoble({ [CIMA_STASH]: { code: 0, out: 'stash-previo\n', err: '' } });
  const r = await orq.apartarTrabajo(tarea('a'), { spawnGit: git.spawn, modoParalelo: false });

  assert.strictEqual(r.ok, true);
  assert.doesNotMatch(r.nota, /trabajo apartado/);
  assert.match(r.nota, /nada que apartar/);
});

test('apartado con git real, concurrente: un borrado ya preparado en el índice se aparta y se recupera', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('a.txt', 'a original\n');
    repo.escribir('borrar.txt', 'se borra\n');
    repo.escribir('b.txt', 'b original\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    // La task modifica a.txt y borra borrar.txt; la hermana cambia b.txt y lo prepara.
    repo.escribir('a.txt', 'a de la task\n');
    fs.rmSync(path.join(repo.dir, 'borrar.txt'));
    repo.escribir('b.txt', 'b de la hermana\n');
    repo.g(['add', '--', 'b.txt']);

    // Estado que deja la primera preparación de la revisión (`add -A -- <ámbito>`):
    // el borrado queda preparado en el índice y la ruta ya no existe ni en el
    // árbol ni en el índice.
    const ambito = ['a.txt', 'borrar.txt'];
    repo.g(['add', '-A', '--'].concat(ambito));

    const r = await orq.apartarTrabajo(tarea('a'), { spawnGit: repo.spawn, modoParalelo: true, ambito });

    assert.strictEqual(r.ok, true, r.nota);
    assert.match(r.nota, /trabajo apartado en git stash "sdd-apartado: a"/);
    assert.strictEqual(repo.g(['status', '--porcelain', '--', 'a.txt', 'borrar.txt']), '');
    assert.strictEqual(fs.readFileSync(path.join(repo.dir, 'b.txt'), 'utf8'), 'b de la hermana\n');

    const guardado = repo.g(['diff', 'stash@{0}^1', 'stash@{0}', '--', 'a.txt', 'borrar.txt']);
    assert.match(guardado, /a de la task/);
    assert.match(guardado, /deleted file mode [0-7]+\n[^\n]*\n--- a\/borrar\.txt/);

    // Recuperable solo lo de la task, aunque la entrada guarde también el índice de la hermana.
    repo.g(['restore', '--source=stash@{0}', '--', 'a.txt', 'borrar.txt']);
    assert.strictEqual(fs.readFileSync(path.join(repo.dir, 'a.txt'), 'utf8'), 'a de la task\n');
    assert.ok(!fs.existsSync(path.join(repo.dir, 'borrar.txt')));
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('commit con git real en un monorepo: lo de fuera del proyecto no entra en el commit de la task', async () => {
  const repo = repoTemporal('proyecto');
  try {
    repo.escribir('otro.txt', 'otro original\n');
    repo.escribir('proyecto/a.txt', 'a original\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    // otro.txt queda fuera del proyecto: la comprobación de árbol limpio no lo ve.
    repo.escribir('otro.txt', 'cambio ajeno al proyecto\n');
    assert.strictEqual((await orq.comprobarArbolLimpio(repo.spawn)).limpio, true);
    repo.escribir('proyecto/a.txt', 'a de la task\n');

    const revisados = [];
    const deps = {
      spawnGit: repo.spawn,
      log: () => {},
      revisar: async (t, diff) => { revisados.push(diff); return { veredicto: 'APROBADA' }; },
      corregir: async () => {},
      emitirSenal: async () => 'marca',
      descartar: async () => {},
    };
    const resultado = Object.assign(resultadoDe(tarea('a')),
      { archivos_modificados: ['a.txt'], commit_message: 'feat: a' });

    const r = await orq.revisarYComitear(tarea('a'), resultado, deps);

    assert.strictEqual(r.resultado, 'COMPLETADA', r.notas);
    assert.doesNotMatch(revisados[0], /otro\.txt/, 'el revisor no ve lo de fuera del proyecto');
    assert.strictEqual(repo.g(['show', '--name-only', '--format=', 'HEAD']), 'proyecto/a.txt\n');
    assert.strictEqual(repo.g(['status', '--porcelain']), ' M otro.txt\n');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

// ── Re-gate tras la corrección ───────────────────────────────────────────────
// Rojo antes de esta task: el gate de tests corría solo antes de la primera revisión, y tras la
// pasada de corrección `revisarYComitear` commiteaba sin volver a pasarlo.

const PASA = { estado: 'PASA', nota: 'Tests verdes (exit 0) via package.json' };
const ROJO = { estado: 'FALLIDA', nota: 'Tests en rojo (exit 1) via package.json' };

/** Revisor doble que devuelve, en orden, los veredictos dados y anota los diffs revisados. */
function revisorEnOrden(revisiones, vistas) {
  const cola = revisiones.slice();
  return async (t, diff) => { vistas.push(diff); return cola.shift(); };
}

test('re-gate: tras la corrección el gate vuelve a pasar; su rojo aparta el trabajo y no hay commit', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  let llamadasGate = 0;
  const apartados = [];
  const descartar = async () => {
    const salida = { ok: true, detener: false, nota: 'trabajo apartado en git stash "sdd-apartado: a"' };
    apartados.push(salida);
    return salida;
  };
  const gateTests = async () => (++llamadasGate === 1 ? PASA : ROJO);
  const revisadas = [];
  const { deps: dr, visto } = depsRevision(git, {
    revisar: revisorEnOrden([{ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['x'] }], revisadas),
    gateTests,
    descartar,
  });
  const { deps } = depsTask({ gateTests, descartar, revisarYComitear: (t, r) => orq.revisarYComitear(t, r, dr) });

  const r = await orq.ejecutarTask(tarea('a'), [], deps);

  assert.strictEqual(llamadasGate, 2, 'el gate corre antes de revisar y otra vez tras corregir');
  assert.strictEqual(visto.correcciones, 1);
  assert.strictEqual(revisadas.length, 1, 'con el re-gate en rojo no se re-revisa');
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')), git.llamadas.join('\n'));
  assert.deepStrictEqual(apartados.map(a => a.ok), [true], 'el apartado recibe el trabajo una vez');
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.strictEqual(r.gate_tests_tras_correccion.estado, 'FALLIDA');
  assert.match(r.notas, /gate de tests: Tests en rojo \(exit 1\)/);
  assert.match(r.notas, /trabajo apartado en git stash/);
  assert.ok(!r.detener_recorrido);
});

test('re-gate: un fallo de git conserva el trabajo, y el escape degrada el rojo pero no el fallo de git', async () => {
  const casos = [
    { gate: { estado: 'FALLIDA', infraestructura: true, nota: 'git add -A fallo: exit 128' }, env: { SDD_GUARD_SKIP: '1' }, commit: false },
    { gate: ROJO, env: { SDD_GUARD_SKIP: '1' }, commit: true },
  ];
  for (const caso of casos) {
    const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
    const { deps, visto } = depsRevision(git, {
      revisar: revisorEnOrden([{ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['x'] }, { veredicto: 'APROBADA' }], []),
      gateTests: async () => caso.gate,
      env: caso.env,
    });

    const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

    assert.strictEqual(visto.descartes, 0, JSON.stringify(caso.gate));
    assert.strictEqual(git.llamadas.some(c => c.startsWith('commit')), caso.commit, JSON.stringify(caso.gate));
    assert.strictEqual(r.resultado, caso.commit ? 'COMPLETADA' : 'FALLIDA');
    if (!caso.commit) assert.match(r.notas, /fallo de git, no veredicto de revision/);
  }
});

test('re-gate: un apartado que pide detener en secuencial para el recorrido; la siguiente no se implementa', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  let llamadasGate = 0;
  const descartar = async () => ({ ok: false, detener: true, nota: 'no se pudo apartar el trabajo' });
  const gateTests = async () => (++llamadasGate === 1 ? PASA : ROJO);
  const { deps: dr } = depsRevision(git, {
    revisar: revisorEnOrden([{ veredicto: 'RECHAZADA' }], []), gateTests, descartar,
  });
  const { deps, visto } = depsTask({ gateTests, descartar, revisarYComitear: (t, r) => orq.revisarYComitear(t, r, dr) });

  const resultados = await orq.recorrerNiveles([tareas('a', 'b')], (t, p) => orq.ejecutarTask(t, p, deps));

  assert.deepStrictEqual(visto.implementadas, ['a']);
  assert.strictEqual(resultados[0].detener_recorrido, true);
  assert.match(resultados[1].notas, /el recorrido se detuvo en la task a/);
});

// ── Veredicto contradictorio ─────────────────────────────────────────────────
// Rojo antes de esta task: `APROBADA` con `problemas_criticos` no vacío se commiteaba.

test('normalizarRevision: sin revisión es ERROR; APROBADA con críticos pasa a corrección; el resto, igual', () => {
  assert.strictEqual(orq.normalizarRevision(null).veredicto, 'ERROR');
  assert.strictEqual(orq.normalizarRevision({}).veredicto, 'ERROR');

  const contradictoria = orq.normalizarRevision({ veredicto: 'APROBADA', problemas_criticos: ['sin validar'] });
  assert.strictEqual(contradictoria.veredicto, 'NECESITA_CORRECCIONES');
  assert.strictEqual(contradictoria.veredicto_original, 'APROBADA');
  assert.match(contradictoria.causa, /veredicto contradictorio/);
  assert.deepStrictEqual(contradictoria.problemas_criticos, ['sin validar']);

  const limpia = { veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: ['estilo'] };
  assert.strictEqual(orq.normalizarRevision(limpia), limpia);
  const adversa = { veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['x'] };
  assert.strictEqual(orq.normalizarRevision(adversa), adversa);
});

test('revisarYComitear: APROBADA con un crítico no se commitea en la primera pasada: va a corrección', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const recibidas = [];
  const { deps, visto } = depsRevision(git, {
    revisar: revisorEnOrden([
      { veredicto: 'APROBADA', problemas_criticos: ['falta validar la entrada'], problemas_menores: [] },
      { veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: [] },
    ], []),
    corregir: async (t, revision) => {
      assert.ok(!git.llamadas.some(c => c.startsWith('commit')), 'nada se commitea antes de corregir');
      recibidas.push(revision);
      visto.correcciones += 1;
    },
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(visto.correcciones, 1);
  assert.strictEqual(recibidas[0].veredicto, 'NECESITA_CORRECCIONES');
  assert.deepStrictEqual(recibidas[0].problemas_criticos, ['falta validar la entrada']);
  assert.strictEqual(git.llamadas.filter(c => c.startsWith('commit')).length, 1);
  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(r.veredicto_original, 'APROBADA');
});

test('revisarYComitear: APROBADA con críticos en todas las rondas -> BLOQUEADA_REVISION, apartada y sin commit', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const contradictoria = { veredicto: 'APROBADA', problemas_criticos: ['x'], problemas_menores: [] };
  const { deps, visto } = depsRevision(git, {
    revisar: revisorEnOrden(Array(1 + orq.MAX_RONDAS_CORRECCION).fill(contradictoria), []),
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(visto.descartes, 1);
  assert.strictEqual(r.resultado, 'BLOQUEADA_REVISION');
  assert.match(r.notas, /NECESITA_CORRECCIONES, veredicto contradictorio/);
  assert.strictEqual(r.revision.veredicto_original, 'APROBADA');
});

test('revisarYComitear: APROBADA sin críticos se commitea sin pasar por corrección', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git, {
    revisar: revisorEnOrden([{ veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: ['nombre'] }], []),
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(visto.correcciones, 0);
  assert.ok(git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(r.veredicto_original, undefined);
});

test('revisarYComitear: revisiones nulas tras la corrección -> ERROR, sin commit y con el trabajo apartado', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps } = depsRevision(git, {
    revisar: revisorEnOrden([{ veredicto: 'RECHAZADA' }, null, null, null], []),
    descartar: descartarCon(git, false),
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(r.resultado, 'BLOQUEADA_REVISION');
  assert.match(r.notas, /revision adversarial: ERROR/);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.ok(git.llamadas.some(c => APARTADO_SECUENCIAL.test(c)), git.llamadas.join('\n'));
  sinDestruccion(git.llamadas);
});

// ── PARCIAL ──────────────────────────────────────────────────────────────────
// Rojo antes de esta task: un PARCIAL del implementador pasaba al gate y al commit, y su
// dependiente se implementaba porque solo FALLIDA bloqueaba.

function depsConParcial(parciales, descartar) {
  const gate = [];
  const { deps, visto } = depsTask({
    implementar: async t => { visto.implementadas.push(t.titulo); return resultadoDe(t, parciales.includes(t.titulo) ? 'PARCIAL' : 'COMPLETADA'); },
    gateTests: async t => { gate.push(t.titulo); return PASA; },
  });
  if (descartar) deps.descartar = descartar;
  return { deps, visto, gate };
}

test('PARCIAL: sin gate ni commit, se aparta; su dependiente queda bloqueada y la independiente sigue', async () => {
  for (const modoParalelo of [false, true]) {
    const { deps, visto, gate } = depsConParcial(['a']);
    const a = tarea('a');
    const c = tarea('c');
    const b = tarea('b', ['ai_docs/tasks/a.md']);

    const resultados = await orq.recorrerNiveles([[a, c], [b]], (t, p) => orq.ejecutarTask(t, p, deps), { modoParalelo });
    const por = Object.fromEntries(resultados.map(r => [r.task_titulo, r]));

    assert.deepStrictEqual(gate, ['c'], 'modoParalelo=' + modoParalelo);
    assert.deepStrictEqual(visto.comiteadas, ['c']);
    assert.strictEqual(visto.descartes, 1, 'el trabajo PARCIAL se aparta');
    assert.deepStrictEqual(visto.implementadas.sort(), ['a', 'c']);
    assert.strictEqual(por.a.resultado, 'PARCIAL');
    assert.match(por.a.notas, /implementación PARCIAL: no pasa a gate ni a commit/);
    assert.strictEqual(por.c.resultado, 'COMPLETADA');
    assert.strictEqual(por.b.resultado, 'FALLIDA');
    assert.strictEqual(por.b.bloqueada, true);
    assert.match(por.b.notas, /sus dependencias no se completaron \(ai_docs\/tasks\/a\.md\)/);
  }
});

test('PARCIAL: con la dependencia COMPLETADA la dependiente sí se implementa', async () => {
  const { deps, visto } = depsConParcial([]);
  const resultados = await orq.recorrerNiveles([[tarea('a')], [tarea('b', ['ai_docs/tasks/a.md'])]],
    (t, p) => orq.ejecutarTask(t, p, deps));

  assert.deepStrictEqual(visto.implementadas, ['a', 'b']);
  assert.deepStrictEqual(resultados.map(r => r.resultado), ['COMPLETADA', 'COMPLETADA']);
});

test('PARCIAL: un apartado que pide detener en secuencial para el recorrido', async () => {
  const { deps, visto } = depsConParcial(['a'],
    async () => ({ ok: false, detener: true, nota: 'no se pudo apartar el trabajo' }));

  const resultados = await orq.recorrerNiveles([tareas('a', 'c')], (t, p) => orq.ejecutarTask(t, p, deps));

  assert.deepStrictEqual(visto.implementadas, ['a']);
  assert.strictEqual(resultados[0].resultado, 'PARCIAL');
  assert.strictEqual(resultados[0].detener_recorrido, true);
  assert.match(resultados[1].notas, /el recorrido se detuvo en la task a/);
});

// ── Pathspec único de preparación, revisión y commit, con git real ───────────
// Rojo antes de esta task: en concurrente el pathspec era la tabla entera (`add` con un fichero
// declarado que la task no creó sale con 128; un borrado ya preparado no se puede volver a
// preparar); en secuencial, `ai_docs/` entero quedaba fuera (ai_docs/core sucio se colaba en el
// commit de la primera task) y el gate preparaba sin pathspec (en un monorepo, lo de fuera del
// proyecto).

/** Envuelve el spawn real y anota cada argv. */
function spawnAnotado(repo) {
  const llamadas = [];
  return { llamadas, spawn: async argv => { llamadas.push(argv.join(' ')); return repo.spawn(argv); } };
}

/** Dependencias de revisarYComitear con git real y revisión que aprueba. */
function depsReales(spawn, ambito) {
  return {
    spawnGit: spawn,
    log: () => {},
    revisar: async () => ({ veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: [] }),
    corregir: async () => {},
    emitirSenal: async () => 'marca',
    descartar: async () => {},
    ambito,
  };
}

test('pathspec con git real, concurrente: la tabla declara un fichero no creado; se prepara y commitea lo creado', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('base.txt', 'base\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('a.txt', 'de la task\n');
    repo.escribir('x.txt', 'de una hermana\n');
    const ambito = ['a.txt', 'b.txt'];
    const git = spawnAnotado(repo);

    // El gate prepara con la misma función que la revisión.
    const gate = await orq.prepararTask(git.spawn, ambito);
    assert.strictEqual(gate.ok, true, gate.error);
    assert.deepStrictEqual(gate.pathspec, ['--', 'a.txt']);
    assert.strictEqual(repo.g(['diff', '--cached', '--name-only']), 'a.txt\n');

    const r = await orq.revisarYComitear(tarea('a'),
      Object.assign(resultadoDe(tarea('a')), { archivos_modificados: ['a.txt'], commit_message: 'feat: a' }),
      depsReales(git.spawn, ambito));

    assert.strictEqual(r.resultado, 'COMPLETADA', r.notas);
    assert.deepStrictEqual(git.llamadas.filter(c => c.startsWith('add')), ['add -A -- a.txt', 'add -A -- a.txt']);
    assert.strictEqual(repo.g(['show', '--name-only', '--format=', 'HEAD']), 'a.txt\n');
    assert.strictEqual(repo.g(['status', '--porcelain']), '?? x.txt\n');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('pathspec con git real, concurrente: un borrado preparado por el gate llega al commit', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('a.txt', 'a original\n');
    repo.escribir('c.txt', 'se borra\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('a.txt', 'a de la task\n');
    fs.rmSync(path.join(repo.dir, 'c.txt'));
    const ambito = ['a.txt', 'c.txt'];
    const git = spawnAnotado(repo);

    const gate = await orq.prepararTask(git.spawn, ambito);
    assert.strictEqual(gate.ok, true, gate.error);

    const r = await orq.revisarYComitear(tarea('a'),
      Object.assign(resultadoDe(tarea('a')), { archivos_modificados: ambito, commit_message: 'feat: a' }),
      depsReales(git.spawn, ambito));

    assert.strictEqual(r.resultado, 'COMPLETADA', r.notas);
    // La segunda preparación deja fuera el borrado ya preparado: con él, `add` saldría con 128.
    assert.deepStrictEqual(git.llamadas.filter(c => c.startsWith('add')), ['add -A -- a.txt c.txt', 'add -A -- a.txt']);
    assert.strictEqual(repo.g(['show', '--name-status', '--format=', 'HEAD']), 'M\ta.txt\nD\tc.txt\n');
    assert.strictEqual(repo.g(['status', '--porcelain']), '');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('pathspec con git real, concurrente: sin rutas cambiadas en el ámbito no hay add y nada se prepara', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('a.txt', 'a\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('x.txt', 'de una hermana, sin declarar\n');
    const git = spawnAnotado(repo);

    const gate = await orq.prepararTask(git.spawn, ['a.txt']);
    assert.strictEqual(gate.ok, true, gate.error);
    assert.strictEqual(gate.pathspec, null);

    const r = await orq.revisarYComitear(tarea('a'),
      Object.assign(resultadoDe(tarea('a')), { archivos_modificados: [] }), depsReales(git.spawn, ['a.txt']));

    assert.strictEqual(r.resultado, 'COMPLETADA');
    assert.match(r.notas, /sin cambios en el working tree/);
    assert.ok(!git.llamadas.some(c => c.startsWith('add') || c.startsWith('commit')), git.llamadas.join('\n'));
    assert.strictEqual(repo.g(['diff', '--cached', '--name-only']), '');
    assert.strictEqual(repo.g(['status', '--porcelain']), '?? x.txt\n');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

/** Monorepo con el proyecto en `proyecto/`, el plan versionado y sin `.gitignore`. */
function monorepo() {
  const repo = repoTemporal('proyecto');
  repo.escribir('fuera.txt', 'fuera original\n');
  repo.escribir('proyecto/base.txt', 'base\n');
  repo.escribir('proyecto/ai_docs/tasks/001_x.md', '# Task\n');
  repo.escribir('proyecto/ai_docs/core/x.md', '# Contexto\n');
  repo.g(['add', '-A']);
  repo.g(['commit', '-q', '-m', 'base']);
  return repo;
}

test('arranque con git real: ai_docs/core sucio no arranca y el mensaje propone commitearlo, sin stash', async () => {
  const repo = monorepo();
  try {
    repo.escribir('proyecto/ai_docs/core/x.md', '# Contexto editado\n');

    const estado = await orq.comprobarArbolLimpio(repo.spawn);

    assert.deepStrictEqual(estado, { limpio: false, rutas: ['proyecto/ai_docs/core/x.md'] });
    const mensaje = orq.mensajeArbolSucio(estado);
    assert.match(mensaje, /proyecto\/ai_docs\/core\/x\.md/);
    assert.match(mensaje, /Commitéalos antes de lanzar/);
    assert.doesNotMatch(mensaje, /git stash push/);
    assert.doesNotMatch(mensaje, /worktree de git limpio/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('mensajeArbolSucio: con core y otras rutas, core solo se commitea y el resto conserva las tres salidas', () => {
  const mensaje = orq.mensajeArbolSucio({ limpio: false, rutas: ['ai_docs/core/x.md', 'src/a.js'] });
  const [core, resto] = mensaje.split('Hay cambios sin commitear fuera');
  assert.match(core, /ai_docs\/core\/x\.md/);
  assert.doesNotMatch(core, /git stash push/);
  assert.match(resto, /src\/a\.js/);
  assert.match(resto, /git stash push --include-untracked/);
  assert.match(resto, /worktree/);
});

test('secuencial con git real: registro de sesiones, doc de la task y lo de fuera del proyecto no entran', async () => {
  const repo = monorepo();
  try {
    // El hook de inicio de sesión escribe el registro antes de lanzar: no impide arrancar.
    repo.escribir('proyecto/ai_docs/audits/provenance.jsonl', '{"sesion":1}\n');
    assert.deepStrictEqual(await orq.comprobarArbolLimpio(repo.spawn), { limpio: true, rutas: [] });

    repo.escribir('proyecto/a.txt', 'de la task\n');
    repo.escribir('proyecto/ai_docs/tasks/001_x.md', '# Task\nEstado: en curso\n');
    repo.escribir('fuera.txt', 'cambio ajeno al proyecto\n');

    // Gate: la misma preparación que la revisión.
    const gate = await orq.prepararTask(repo.spawn, undefined);
    assert.strictEqual(gate.ok, true, gate.error);
    assert.strictEqual(repo.g(['diff', '--cached', '--name-only']), 'proyecto/a.txt\n');

    const r = await orq.revisarYComitear(tarea('a'),
      Object.assign(resultadoDe(tarea('a')), { archivos_modificados: ['a.txt'], commit_message: 'feat: a' }),
      depsReales(repo.spawn, undefined));

    assert.strictEqual(r.resultado, 'COMPLETADA', r.notas);
    assert.strictEqual(repo.g(['show', '--name-only', '--format=', 'HEAD']), 'proyecto/a.txt\n');
    assert.strictEqual(repo.g(['status', '--porcelain', '--untracked-files=all']),
      ' M fuera.txt\n M proyecto/ai_docs/tasks/001_x.md\n?? proyecto/ai_docs/audits/provenance.jsonl\n');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

// ── Rondas de revisión ───────────────────────────────────────────────────────
// Rojo antes de esta task: cualquier veredicto distinto de APROBADA abría la corrección, el
// corrector recibía también los menores, la segunda revisión no veía los hallazgos previos ni el
// delta, y tras una sola corrección la task se descartaba.

test('rondas: solo menores -> commit en la primera pasada, menores en el cuerpo y en las notas, sin corregir', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git, {
    revisar: revisorEnOrden([{
      veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: [], problemas_menores: ['nombre poco claro', 'falta un caso límite menor'],
    }], []),
  });
  const resultado = Object.assign(resultadoDe(tarea('a')), { commit_message: 'feat: a', commit_cuerpo: 'que y por que' });

  const r = await orq.revisarYComitear(tarea('a'), resultado, deps);

  assert.strictEqual(visto.correcciones, 0, 'un menor no abre ronda');
  assert.strictEqual(r.resultado, 'COMPLETADA');
  const commit = git.llamadas.find(c => c.startsWith('commit'));
  assert.ok(commit, git.llamadas.join('\n'));
  assert.match(commit, /que y por que\n\nHallazgos menores de la revisión \(no bloquean\):\n- nombre poco claro\n- falta un caso límite menor/);
  assert.match(r.notas, /menores de la revisión, no bloquean: nombre poco claro; falta un caso límite menor/);
  assert.deepStrictEqual(visto.firmados, [DIFF]);
});

test('rondas: el corrector recibe solo los críticos y su corrección propuesta, nunca los menores', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const recibidas = [];
  const { deps } = depsRevision(git, {
    revisar: revisorEnOrden([
      { veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['entrada sin validar'], problemas_menores: ['estilo'],
        correcciones_propuestas: ['validar la entrada en el parser'], resumen: 'r1' },
      { veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: [] },
    ], []),
    corregir: async (t, revision) => { recibidas.push(revision); },
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(recibidas.length, 1);
  assert.deepStrictEqual(recibidas[0].problemas_criticos, ['entrada sin validar']);
  assert.deepStrictEqual(recibidas[0].correcciones_propuestas, ['validar la entrada en el parser']);
  assert.ok(!('problemas_menores' in recibidas[0]), JSON.stringify(recibidas[0]));
  assert.doesNotMatch(JSON.stringify(recibidas[0]), /estilo/);
});

test('rondas: la re-revisión recibe los hallazgos previos, su corrección propuesta y el delta', async () => {
  // src/b.js no cambia entre rondas: su sección no es parte del delta.
  const SIN_CAMBIO = 'diff --git a/src/b.js b/src/b.js\n+intacta\n';
  const INICIAL = DIFF + SIN_CAMBIO;
  const CORREGIDO = 'diff --git a/src/a.js b/src/a.js\n+una linea\n+validada\n' + SIN_CAMBIO;
  const git = gitDoble({ [DIFF_PROYECTO]: n => ({ code: 0, out: n === 1 ? INICIAL : CORREGIDO, err: '' }) });
  const llamadas = [];
  const cola = [
    { veredicto: 'RECHAZADA', problemas_criticos: ['entrada sin validar'], problemas_menores: [],
      correcciones_propuestas: ['validar la entrada'] },
    { veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: [],
      hallazgos_previos: [{ hallazgo: 'entrada sin validar', estado: 'resuelto' }] },
  ];
  const { deps } = depsRevision(git, {
    revisar: async function () { llamadas.push(Array.from(arguments)); return cola.shift(); },
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(llamadas[0][2], undefined, 'la primera revisión no tiene previa');
  const previa = llamadas[1][2];
  assert.strictEqual(previa.ronda, 1);
  assert.deepStrictEqual(previa.hallazgos_previos, ['entrada sin validar']);
  assert.deepStrictEqual(previa.correcciones_propuestas, ['validar la entrada']);
  assert.match(previa.delta, /\+validada/);
  assert.doesNotMatch(previa.delta, /src\/b\.js|intacta/, 'la sección sin cambios no entra en el delta');
});

test('rondas: un hallazgo previo declarado persistente sigue abriendo ronda aunque no se repita en críticos', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const persistente = { veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: [],
    hallazgos_previos: [{ hallazgo: 'entrada sin validar', estado: 'persistente' }] };
  const { deps, visto } = depsRevision(git, {
    revisar: revisorEnOrden([{ veredicto: 'RECHAZADA', problemas_criticos: ['entrada sin validar'] },
      persistente, persistente, persistente], []),
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(visto.correcciones, 3);
  assert.strictEqual(r.resultado, 'BLOQUEADA_REVISION');
  assert.deepStrictEqual(r.hallazgos_abiertos, ['entrada sin validar']);
});

test('rondas: tres rondas adversas -> BLOQUEADA_REVISION, gate en cada ronda, un apartado sin destruir, dependiente bloqueada', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  let gates = 0;
  let apartados = 0;
  const apartar = descartarCon(git, false);
  const descartar = async t => { apartados += 1; return apartar(t); };
  const gateTests = async () => { gates += 1; return PASA; };
  const adversa = { veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['contrato roto'], problemas_menores: ['estilo'],
    correcciones_propuestas: ['restaurar la firma'] };
  const { deps: dr, visto: vr } = depsRevision(git, {
    revisar: revisorEnOrden(Array(1 + orq.MAX_RONDAS_CORRECCION).fill(adversa), []),
    gateTests,
    descartar,
  });
  const { deps, visto } = depsTask({ gateTests, descartar, revisarYComitear: (t, r) => orq.revisarYComitear(t, r, dr) });

  const resultados = await orq.recorrerNiveles([[tarea('a')], [tarea('b', ['ai_docs/tasks/a.md'])]],
    (t, p) => orq.ejecutarTask(t, p, deps));
  const [a, b] = resultados;

  assert.strictEqual(a.resultado, 'BLOQUEADA_REVISION');
  assert.strictEqual(a.rondas_correccion, 3);
  assert.deepStrictEqual(a.hallazgos_abiertos, ['contrato roto']);
  assert.deepStrictEqual(a.correcciones_propuestas, ['restaurar la firma']);
  assert.match(a.notas, /BLOQUEADA_REVISION tras 3 rondas de corrección, decide el usuario: contrato roto/);
  assert.match(a.notas, /trabajo apartado en git stash "sdd-apartado: a"/);
  assert.strictEqual(vr.correcciones, 3);
  assert.strictEqual(gates, 1 + orq.MAX_RONDAS_CORRECCION, 'el gate corre antes de revisar y en cada ronda');
  assert.strictEqual(apartados, 1, 'el trabajo se aparta una sola vez');
  assert.strictEqual(git.llamadas.filter(c => c.startsWith('stash push')).length, 1);
  sinDestruccion(git.llamadas);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.ok(!a.detener_recorrido);

  assert.deepStrictEqual(visto.implementadas, ['a']);
  assert.strictEqual(b.bloqueada, true);
  assert.match(b.notas, /sus dependencias no se completaron \(ai_docs\/tasks\/a\.md\)/);
  assert.deepStrictEqual(orq.resumirResultados(resultados), { completadas: 0, fallidas: 2 });
});

test('rondas: si el apartado del escalado pide detener, el resultado lo lleva y el recorrido se para', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const descartar = async () => ({ ok: false, detener: true, nota: 'no se pudo apartar el trabajo' });
  const { deps: dr } = depsRevision(git, {
    revisar: async () => ({ veredicto: 'RECHAZADA', problemas_criticos: ['x'] }), descartar,
  });
  const { deps, visto } = depsTask({ descartar, revisarYComitear: (t, r) => orq.revisarYComitear(t, r, dr) });

  const resultados = await orq.recorrerNiveles([tareas('a', 'c')], (t, p) => orq.ejecutarTask(t, p, deps));

  assert.strictEqual(resultados[0].resultado, 'BLOQUEADA_REVISION');
  assert.strictEqual(resultados[0].detener_recorrido, true);
  assert.match(resultados[0].notas, /no se pudo apartar el trabajo/);
  assert.deepStrictEqual(visto.implementadas, ['a']);
  assert.match(resultados[1].notas, /el recorrido se detuvo en la task a/);
});

test('deltaEntreDiffs: solo las secciones que cambiaron o aparecieron, y las retiradas con su cabecera', () => {
  const a = 'diff --git a/x b/x\n+x1\ndiff --git a/y b/y\n+y1\n';
  const b = 'diff --git a/x b/x\n+x1\ndiff --git a/y b/y\n+y2\ndiff --git a/z b/z\n+z1\n';
  assert.strictEqual(orq.deltaEntreDiffs(a, a), '');
  assert.strictEqual(orq.deltaEntreDiffs(a, b), 'diff --git a/y b/y\n+y2\ndiff --git a/z b/z\n+z1\n');
  assert.strictEqual(orq.deltaEntreDiffs(b, 'diff --git a/x b/x\n+x1\n'),
    'diff --git a/y b/y\n# cambio retirado: esta ruta ya no tiene diff\n'
    + 'diff --git a/z b/z\n# cambio retirado: esta ruta ya no tiene diff\n');
});

test('rondas con git real, concurrente: lo que una hermana prepara entre dos rondas no entra en el delta', async () => {
  const repo = repoTemporal();
  try {
    repo.escribir('a.txt', 'a original\n');
    repo.escribir('h.txt', 'h original\n');
    repo.g(['add', '-A']);
    repo.g(['commit', '-q', '-m', 'base']);

    repo.escribir('a.txt', 'a de la task\n');
    const ambito = ['a.txt'];
    const previas = [];
    const cola = [
      { veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['a.txt incompleto'], problemas_menores: [] },
      { veredicto: 'APROBADA', problemas_criticos: [], problemas_menores: [] },
    ];
    const deps = Object.assign(depsReales(repo.spawn, ambito), {
      revisar: async (t, diff, previa) => { previas.push(previa); return cola.shift(); },
      corregir: async () => {
        repo.escribir('a.txt', 'a de la task\ncorregida\n');
        // La hermana trabaja a la vez en el mismo árbol y deja su fichero preparado.
        repo.escribir('h.txt', 'h de la hermana\n');
        repo.g(['add', '--', 'h.txt']);
      },
    });

    const r = await orq.revisarYComitear(tarea('a'),
      Object.assign(resultadoDe(tarea('a')), { archivos_modificados: ['a.txt'], commit_message: 'feat: a' }), deps);

    assert.strictEqual(r.resultado, 'COMPLETADA', r.notas);
    const delta = previas[1].delta;
    assert.match(delta, /\+corregida/);
    assert.doesNotMatch(delta, /h\.txt/, 'el delta no ve lo que preparó la hermana');
    assert.strictEqual(repo.g(['show', '--name-only', '--format=', 'HEAD']), 'a.txt\n');
    assert.strictEqual(repo.g(['diff', '--cached', '--name-only']), 'h.txt\n', 'lo de la hermana sigue preparado para ella');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('rondas: una re-revisión nula no desplaza la base del delta: la siguiente lo mide contra la última utilizable', async () => {
  const R1 = 'diff --git a/src/a.js b/src/a.js\n+una linea\n+corregida\n';
  const git = gitDoble({ [DIFF_PROYECTO]: n => ({ code: 0, out: n === 1 ? DIFF : R1, err: '' }) });
  const previas = [];
  const cola = [{ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['x'] }, null, { veredicto: 'APROBADA' }];
  const { deps, visto } = depsRevision(git, {
    revisar: async (t, diff, previa) => { previas.push(previa); return cola.shift(); },
  });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.strictEqual(visto.correcciones, 1, 'la ronda de la revisión nula no corrige');
  assert.strictEqual(previas.length, 3);
  assert.match(previas[1].delta, /\+corregida/);
  assert.match(previas[2].delta, /\+corregida/, 'R2 recibe el delta real respecto de R0, no un delta vacío respecto de la nula');
  assert.deepStrictEqual(previas[2].hallazgos_previos, ['x']);
});

test('rondas: un menor multilínea se aplana a una línea en el cuerpo y en las notas', async () => {
  const git = gitDoble({ [DIFF_PROYECTO]: { code: 0, out: DIFF, err: '' } });
  const { deps } = depsRevision(git, {
    revisar: revisorEnOrden([{ veredicto: 'APROBADA', problemas_criticos: [],
      problemas_menores: ['nombre poco claro\n\nSigned-off-by: alguien <a@example.com>'] }], []),
  });
  const resultado = Object.assign(resultadoDe(tarea('a')), { commit_message: 'feat: a', commit_cuerpo: 'que y por que' });

  const r = await orq.revisarYComitear(tarea('a'), resultado, deps);

  const commit = git.llamadas.find(c => c.startsWith('commit'));
  assert.match(commit, /\n- nombre poco claro Signed-off-by: alguien <a@example\.com>/);
  assert.doesNotMatch(commit, /\nSigned-off-by:/, 'ningún menor abre una línea que git lea como trailer');
  assert.match(r.notas, /nombre poco claro Signed-off-by: alguien/);
  assert.doesNotMatch(r.notas, /\n/);
});

test('abreRonda: la abren un crítico, RECHAZADA o ERROR; un NECESITA_CORRECCIONES sin críticos no', () => {
  const n = orq.normalizarRevision;
  assert.strictEqual(orq.abreRonda(n({ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: [], problemas_menores: ['m'] })), false);
  assert.strictEqual(orq.abreRonda(n({ veredicto: 'APROBADA', problemas_criticos: [] })), false);
  assert.strictEqual(orq.abreRonda(n({ veredicto: 'NECESITA_CORRECCIONES', problemas_criticos: ['c'] })), true);
  assert.strictEqual(orq.abreRonda(n({ veredicto: 'RECHAZADA', problemas_criticos: [] })), true);
  assert.strictEqual(orq.abreRonda(n(null)), true);
  assert.strictEqual(orq.abreRonda(n({ veredicto: 'APROBADA', problemas_criticos: [],
    hallazgos_previos: [{ hallazgo: 'h', estado: 'refutado' }] })), false, 'un refutado no bloquea');
});

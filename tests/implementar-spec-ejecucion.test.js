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
//   - `construirResultado` con el campo de convergencia comentado y retorno nulo.

const test = require('node:test');
const assert = require('node:assert');

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

/**
 * Doble del spawn de git. `respuestas` se indexa por el argv unido con espacios
 * (o por su primer tramo, para un `commit` cuyo mensaje no se conoce de antemano).
 * Un valor funcion recibe el numero de invocacion de esa misma clave, que es como
 * se simulan dos lecturas distintas del mismo comando.
 */
function gitDoble(respuestas) {
  const llamadas = [];
  const veces = new Map();

  async function spawn(argv) {
    const clave = argv.join(' ');
    llamadas.push(clave);
    const n = (veces.get(clave) || 0) + 1;
    veces.set(clave, n);

    const r = (respuestas || {})[clave] !== undefined
      ? (respuestas || {})[clave]
      : (respuestas || {})[argv[0]];
    if (r === undefined) return { code: 0, out: '', err: '' };
    return typeof r === 'function' ? r(n) : r;
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

test('depsFallidas: solo una dependencia FALLIDA bloquea', () => {
  const task = tarea('b', ['ai_docs/tasks/a.md']);
  const completada = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'COMPLETADA' }];
  const fallida = [{ task_path: 'ai_docs/tasks/a.md', resultado: 'FALLIDA' }];

  assert.deepStrictEqual(orq.depsFallidas(task, completada), []);
  assert.deepStrictEqual(orq.depsFallidas(task, fallida), ['ai_docs/tasks/a.md']);
  assert.deepStrictEqual(orq.depsFallidas(task, []), []);
  assert.deepStrictEqual(orq.depsFallidas(tarea('a'), fallida), []);
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
  const git = gitDoble({ 'diff --cached': { code: 0, out: DIFF, err: '' } });
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
    ['add -A', 'diff --cached', 'commit -m feat: implementa a -m que y por que']);
});

test('revisarYComitear: un diff que no se pudo leer no se confunde con un working tree limpio', async () => {
  // El defecto que cierra: git no corre, la salida estandar viene vacia igual que
  // en un working tree limpio, se registraba la constancia de ese vacio y el gate
  // denegaba el commit despues sin que nada explicase por que.
  const git = gitDoble({ 'diff --cached': { code: 128, out: '', err: 'fatal: index.lock existe' } });
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
  const git = gitDoble({ 'add -A': { code: null, out: '', err: 'spawnSync git ETIMEDOUT' } });
  const { deps, visto } = depsRevision(git);

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(git.llamadas, ['add -A'], 'no se sigue leyendo tras un git que no corrio');
  assert.deepStrictEqual(visto.revisiones, []);
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /sin codigo de salida/);
});

test('revisarYComitear: exit 0 sin nada preparado es un working tree limpio, no un fallo', async () => {
  const git = gitDoble({ 'diff --cached': { code: 0, out: '', err: '' } });
  const { deps, visto } = depsRevision(git);

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(visto.revisiones, [], 'no hay diff que revisar');
  assert.strictEqual(visto.descartes, 0);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'COMPLETADA', 'el resultado del implementador no se degrada');
  assert.match(r.notas, /sin cambios en el working tree: no se commitea/);
});

test('revisarYComitear: revision adversa -> una pasada de correccion y re-revision del nuevo diff', async () => {
  const CORREGIDO = DIFF + '+corregido\n';
  const git = gitDoble({
    'diff --cached': n => ({ code: 0, out: n === 1 ? DIFF : CORREGIDO, err: '' }),
  });
  let veredictos = ['NECESITA_CORRECCIONES', 'APROBADA'];
  const { deps, visto } = depsRevision(git, {
    revisar: async (t, diff) => {
      visto0.push(diff);
      return { veredicto: veredictos.shift() };
    },
  });
  const visto0 = visto.revisiones;

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(visto.revisiones, [DIFF, CORREGIDO]);
  assert.strictEqual(visto.correcciones, 1, 'una sola pasada de correccion');
  assert.deepStrictEqual(visto.firmados, [CORREGIDO], 'se firma el diff que de verdad se aprobo');
  assert.strictEqual(r.resultado, 'COMPLETADA');
  assert.ok(git.llamadas.some(c => c.startsWith('commit')));
});

test('revisarYComitear: revision que sigue adversa -> se descarta el trabajo y no se commitea', async () => {
  const git = gitDoble({ 'diff --cached': { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git, {
    revisar: async (t, diff) => { visto1.push(diff); return { veredicto: 'RECHAZADA' }; },
  });
  const visto1 = visto.revisiones;

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.strictEqual(visto.revisiones.length, 2, 'se revisa, se corrige una vez y se re-revisa');
  assert.strictEqual(visto.correcciones, 1);
  assert.strictEqual(visto.descartes, 1);
  assert.deepStrictEqual(visto.firmados, []);
  assert.ok(!git.llamadas.some(c => c.startsWith('commit')));
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /revision adversarial: RECHAZADA/);
});

test('revisarYComitear: una revision que no parsea cuenta como adversa, no como aprobada', async () => {
  const git = gitDoble({ 'diff --cached': { code: 0, out: DIFF, err: '' } });
  const { deps, visto } = depsRevision(git, { revisar: async () => null });

  const r = await orq.revisarYComitear(tarea('a'), resultadoDe(tarea('a')), deps);

  assert.deepStrictEqual(visto.firmados, []);
  assert.strictEqual(r.resultado, 'FALLIDA');
  assert.match(r.notas, /revision adversarial: ERROR/);
});

test('revisarYComitear: un commit denegado no se reporta como task commiteada', async () => {
  const git = gitDoble({
    'diff --cached': { code: 0, out: DIFF, err: '' },
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
  const git = gitDoble({ 'diff --cached': { code: 0, out: DIFF, err: '' } });
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
  for (const respuesta of [null, undefined, {}, { criterios_verificados: 9 }]) {
    const r = await orq.resolverConvergencia({
      completadas: 3, fallidas: 0, total: 3, log: () => {}, verificar: async () => respuesta,
    });
    assert.deepStrictEqual(r, { veredicto: 'ERROR', razon: 'parse_failed' }, JSON.stringify(respuesta));
  }
});

test('resolverConvergencia: DIVERGE conserva las tasks de convergencia generadas', async () => {
  const r = await orq.resolverConvergencia({
    completadas: 3, fallidas: 0, total: 3, log: () => {},
    verificar: async () => ({
      veredicto: 'DIVERGE', criterios_verificados: 7,
      tasks_generadas: ['ai_docs/tasks/004_cierre.md'],
    }),
  });

  assert.deepStrictEqual(r, {
    veredicto: 'DIVERGE', criterios_verificados: 7,
    tasks_generadas: ['ai_docs/tasks/004_cierre.md'],
  });
});

test('resolverConvergencia: CONVERGIDA cierra la spec con sus criterios verificados', async () => {
  const r = await orq.resolverConvergencia({
    completadas: 3, fallidas: 0, total: 3, log: () => {},
    verificar: async () => ({ veredicto: 'CONVERGIDA', criterios_verificados: 5 }),
  });

  assert.deepStrictEqual(r,
    { veredicto: 'CONVERGIDA', criterios_verificados: 5, tasks_generadas: [] });
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

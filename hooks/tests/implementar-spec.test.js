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

// ── Particion por dueno de archivo ───────────────────────────────────────────

test('verifyFilePartition: archivos disjuntos = un solo grupo paralelo', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const mapa = orq.mapearArchivos(p.tasks, p.raiz);
  const { grupos, conflictos } = orq.verifyFilePartition(p.tasks, mapa);

  assert.strictEqual(grupos.length, 1);
  assert.strictEqual(grupos[0].length, 2);
  assert.strictEqual(conflictos.length, 0);
  assert.match(orq.describirParticion(p.tasks, mapa), /verificadas disjuntas/);
});

test('verifyFilePartition: archivo compartido = re-particion en grupos secuenciales', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/a.js'], '003_c.md': ['src/c.js'] });
  const mapa = orq.mapearArchivos(p.tasks, p.raiz);
  const { grupos, conflictos } = orq.verifyFilePartition(p.tasks, mapa);

  assert.strictEqual(grupos.length, 2);
  assert.deepStrictEqual(grupos[0].map(t => path.basename(t.path)), ['001_a.md', '003_c.md']);
  assert.deepStrictEqual(grupos[1].map(t => path.basename(t.path)), ['002_b.md']);
  assert.deepStrictEqual(conflictos[0].archivos, ['src/a.js']);
  assert.match(orq.describirParticion(p.tasks, mapa), /CONFLICTO en src\/a\.js/);
});

test('verifyFilePartition: una task sin archivos declarados no se paraleliza con nadie', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_libre.md': [] });
  const mapa = orq.mapearArchivos(p.tasks, p.raiz);
  const { grupos } = orq.verifyFilePartition(p.tasks, mapa);

  assert.strictEqual(mapa.get(p.tasks[1].path), null);
  assert.strictEqual(grupos.length, 2);
});

test('mapearArchivos: los archivos se leen de la task, no de lo que reporta el descubrimiento', () => {
  const p = proyecto({ '001_a.md': ['src/real.js'] });
  const tasks = [Object.assign({}, p.tasks[0], { archivos: ['src/inventado.js'] })];

  assert.deepStrictEqual(orq.mapearArchivos(tasks, p.raiz).get(tasks[0].path), ['src/real.js']);
});

// ── Worktree condicional ─────────────────────────────────────────────────────

test('usaWorktree: ficheros de codigo sin efectos secundarios = checkout compartido', () => {
  const p = proyecto({ '001_a.md': ['src/a.js', 'src/a.test.js'] });
  const mapa = orq.mapearArchivos(p.tasks, p.raiz);

  assert.strictEqual(orq.usaWorktree(p.tasks[0], mapa), false);
});

test('usaWorktree: migraciones o lockfiles = arbol de trabajo aparte', () => {
  const p = proyecto({ '001_mig.md': ['db/migrations/001_init.sql'], '002_dep.md': ['package-lock.json'] });
  const mapa = orq.mapearArchivos(p.tasks, p.raiz);

  assert.strictEqual(orq.usaWorktree(p.tasks[0], mapa), true);
  assert.strictEqual(orq.usaWorktree(p.tasks[1], mapa), true);
});

test('usaWorktree: la declaracion explicita de la task manda sobre la heuristica', () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  const mapa = orq.mapearArchivos(p.tasks, p.raiz);
  const declarada = Object.assign({}, p.tasks[0], { side_effects_fs: true });

  assert.strictEqual(orq.usaWorktree(declarada, mapa), true);
});

test('crearWorktree: sin HEAD resuelto no se crea nada y el error es explicito', () => {
  const llamadas = [];
  const git = args => {
    llamadas.push(args[0] + ' ' + (args[1] || ''));
    return { status: 128, stdout: '', stderr: 'fatal: ambiguous argument HEAD' };
  };

  assert.throws(() => orq.crearWorktree({ path: 'ai_docs/tasks/001_a.md' }, git), /PRE_CONDICION_WORKTREE/);
  assert.deepStrictEqual(llamadas, ['rev-parse HEAD']);
});

test('crearWorktree: limpia restos de una ejecucion abortada antes de crear', () => {
  const llamadas = [];
  const git = args => {
    llamadas.push(args.join(' '));
    if (args[0] === 'rev-parse') return { status: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };

  const wt = orq.crearWorktree({ path: 'ai_docs/tasks/001_a.md' }, git);

  assert.strictEqual(wt.dir, path.join('.worktrees', '001_a'));
  assert.strictEqual(wt.rama, 'sdd/001_a');
  assert.ok(llamadas.indexOf('worktree prune') < llamadas.indexOf('worktree add -b sdd/001_a ' + wt.dir + ' HEAD'));
  assert.ok(llamadas.includes('worktree remove --force ' + wt.dir));
});

test('fusionarWorktree: un merge en conflicto se aborta y avisa', () => {
  const llamadas = [];
  const git = args => {
    llamadas.push(args.join(' '));
    return { status: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0, stdout: '', stderr: 'CONFLICT' };
  };

  assert.throws(() => orq.fusionarWorktree({ dir: '.worktrees/x', rama: 'sdd/x' }, git), /MERGE_CONFLICTO/);
  assert.ok(llamadas.includes('merge --abort'));
});

test('eliminarWorktree: la rama solo se borra si el trabajo llego a fusionarse', () => {
  const sinFusionar = [];
  orq.eliminarWorktree({ dir: '.worktrees/x', rama: 'sdd/x' }, a => { sinFusionar.push(a[0]); return { status: 0, stdout: '', stderr: '' } }, false);
  assert.ok(!sinFusionar.includes('branch'));

  const fusionado = [];
  orq.eliminarWorktree({ dir: '.worktrees/x', rama: 'sdd/x' }, a => { fusionado.push(a[0]); return { status: 0, stdout: '', stderr: '' } }, true);
  assert.ok(fusionado.includes('branch'));
});

// ── Despacho por dependencias satisfechas ────────────────────────────────────

function ejecutorTrazado(traza, retardos) {
  return async task => {
    traza.push('inicio:' + path.basename(task.path));
    await new Promise(r => setTimeout(r, (retardos || {})[path.basename(task.path)] || 0));
    traza.push('fin:' + path.basename(task.path));
    return { task_path: task.path, task_titulo: task.titulo, resultado: 'COMPLETADA', archivos_modificados: [] };
  };
}

test('despacho: tasks disjuntas arrancan a la vez', async () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const traza = [];

  await orq.despacharPorDependencias(p.tasks, ejecutorTrazado(traza, { '001_a.md': 20 }), {
    archivos: orq.mapearArchivos(p.tasks, p.raiz),
  });

  assert.deepStrictEqual(traza.slice(0, 2), ['inicio:001_a.md', 'inicio:002_b.md']);
});

test('despacho: dos tasks que escriben el mismo archivo nunca corren a la vez', async () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/a.js'] });
  const traza = [];

  await orq.despacharPorDependencias(p.tasks, ejecutorTrazado(traza, { '001_a.md': 20 }), {
    archivos: orq.mapearArchivos(p.tasks, p.raiz),
  });

  assert.deepStrictEqual(traza, ['inicio:001_a.md', 'fin:001_a.md', 'inicio:002_b.md', 'fin:002_b.md']);
});

test('despacho: una task arranca en cuanto SUS deps terminan, sin esperar al resto del nivel', async () => {
  const p = proyecto({ '001_lenta.md': ['src/a.js'], '002_rapida.md': ['src/b.js'], '003_dep_b.md': ['src/c.js'] });
  const tasks = conDeps(p.tasks, { '003_dep_b.md': [p.tasks[1].path] });
  const traza = [];

  await orq.despacharPorDependencias(tasks, ejecutorTrazado(traza, { '001_lenta.md': 50 }), {
    archivos: orq.mapearArchivos(tasks, p.raiz),
  });

  assert.ok(traza.indexOf('inicio:003_dep_b.md') < traza.indexOf('fin:001_lenta.md'),
    'la task dependiente espero a una task de su mismo nivel que no es su dependencia');
});

test('despacho: si una dependencia falla, la dependiente no se implementa', async () => {
  const p = proyecto({ '001_a.md': ['src/a.js'], '002_b.md': ['src/b.js'] });
  const tasks = conDeps(p.tasks, { '002_b.md': [p.tasks[0].path] });
  const ejecutadas = [];

  const rs = await orq.despacharPorDependencias(tasks, async task => {
    ejecutadas.push(task.path);
    return { task_path: task.path, resultado: 'FALLIDA', archivos_modificados: [] };
  }, {
    archivos: orq.mapearArchivos(tasks, p.raiz),
    alBloquear: (task, deps) => ({ task_path: task.path, resultado: 'FALLIDA', notas: 'bloqueada por ' + deps.join(',') }),
  });

  assert.deepStrictEqual(ejecutadas, [tasks[0].path]);
  assert.match(rs[1].notas, /bloqueada por/);
});

test('despacho: retorna un hueco por la task cuyo agente no devolvio resultado', async () => {
  const p = proyecto({ '001_a.md': ['src/a.js'] });
  const rs = await orq.despacharPorDependencias(p.tasks, async () => { throw new Error('el agente murio') }, {
    archivos: orq.mapearArchivos(p.tasks, p.raiz),
  });

  assert.deepStrictEqual(rs, [null]);
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

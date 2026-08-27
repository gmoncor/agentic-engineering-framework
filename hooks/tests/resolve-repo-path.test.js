'use strict';

// Contrato de resolucion de rutas de hooks/sdd-plan-state.js: toNativePath, findRepoRoot,
// repoRoot, resolveRepoPath, isInside.
//
// EL DEFECTO QUE CIERRAN
// Una ruta de procedencia externa (el payload de una herramienta, la tabla "Archivos afectados"
// de una task) entraba en path.resolve / path.isAbsolute / path.relative / split(separador) SIN
// traducir antes sus separadores. En un sistema tipo Unix la barra invertida no es separador, asi
// que "src\auth\login.js" se tomaba como UN nombre de archivo: la clave derivada de ahi no casaba
// con ninguna otra y nada fallaba de forma visible. Y una relativa se resolvia contra el directorio
// del proceso en vez de contra la raiz del proyecto, que no son el mismo sitio en cuanto la sesion
// arranca en un subdirectorio o en un arbol de trabajo enlazado.
//
// COMO SE ACREDITA
// Las dos plataformas se ejercitan desde una sola: toNativePath acepta path.win32 / path.posix, y
// la comparacion entre la logica vieja y la nueva se hace contra el resolve de cada una. La
// garantia es doble: CERO cambio de comportamiento sobre rutas nativas de cada plataforma, y
// arreglo unicamente en el cruce de separadores.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tempDir, writeFile } = require('./helpers');
const {
  toNativePath, findRepoRoot, repoRoot, resolveRepoPath, isInside, isInsideAiDocs, findDeclaredFiles,
} = require('../sdd-plan-state');

// Formas nativas de cada plataforma. Ninguna puede cambiar al pasar por toNativePath.
const NATIVAS_POSIX = ['src/auth/login.js', './src/auth/login.js', 'login.js', '/abs/src/login.js', '../hermano/login.js'];
const NATIVAS_WIN32 = ['src\\auth\\login.js', '.\\src\\login.js', 'C:\\proyecto\\login.js', 'login.js', 'src/auth/login.js'];

// Rutas de Windows tal como llegarian a un hook que corre en un sistema tipo Unix.
const CRUZADAS = ['src\\auth\\login.js', 'C:\\proyecto\\src\\login.js', '.\\src\\login.js'];

// ─── toNativePath: identidad sobre lo nativo ─────────────────────────────────

test('en Windows la ruta se devuelve intacta: alli las dos barras ya son separadores', () => {
  for (const raw of NATIVAS_WIN32.concat(CRUZADAS)) {
    assert.strictEqual(toNativePath(raw, path.win32), raw, raw);
  }
});

test('en un sistema tipo Unix una ruta nativa se devuelve intacta', () => {
  for (const raw of NATIVAS_POSIX) {
    assert.strictEqual(toNativePath(raw, path.posix), raw, raw);
  }
});

test('una ruta que ya trae separadores nativos no se toca aunque lleve una barra invertida', () => {
  // Un archivo de Unix cuyo nombre contiene literalmente una barra invertida, dentro de un
  // directorio: la barra normal acredita que la ruta es nativa y la invertida es parte del nombre.
  assert.strictEqual(toNativePath('src/no\\separador.js', path.posix), 'src/no\\separador.js');
});

test('en un sistema tipo Unix solo se traduce el cruce de separadores', () => {
  assert.strictEqual(toNativePath('src\\auth\\login.js', path.posix), 'src/auth/login.js');
  assert.strictEqual(toNativePath('.\\src\\login.js', path.posix), './src/login.js');
  // Prefijo de unidad de Windows: se traduce aunque la ruta ya lleve alguna barra normal.
  assert.strictEqual(toNativePath('C:\\proyecto\\src/login.js', path.posix), 'C:/proyecto/src/login.js');
});

test('una entrada vacia, nula o no textual degrada a cadena vacia, no a "null" ni a excepcion', () => {
  assert.strictEqual(toNativePath(undefined, path.posix), '');
  assert.strictEqual(toNativePath(null, path.posix), '');
  assert.strictEqual(toNativePath('', path.posix), '');
});

// ─── Vieja contra nueva, plataforma por plataforma ───────────────────────────

test('cero cambio de comportamiento: sobre rutas nativas, resolver con y sin traduccion da lo mismo', () => {
  for (const raw of NATIVAS_POSIX) {
    assert.strictEqual(
      path.posix.resolve('/proyecto', toNativePath(raw, path.posix)),
      path.posix.resolve('/proyecto', raw),
      'posix: ' + raw,
    );
  }
  for (const raw of NATIVAS_WIN32.concat(CRUZADAS)) {
    assert.strictEqual(
      path.win32.resolve('C:\\proyecto', toNativePath(raw, path.win32)),
      path.win32.resolve('C:\\proyecto', raw),
      'win32: ' + raw,
    );
  }
});

test('control positivo: sin traducir, una ruta de Windows resuelta en Unix queda en un solo tramo', () => {
  const vieja = path.posix.resolve('/proyecto', 'src\\auth\\login.js');
  assert.strictEqual(vieja, '/proyecto/src\\auth\\login.js');
  assert.strictEqual(vieja.split('/').length, 3, 'los tres tramos de la ruta quedan colapsados en uno');

  const nueva = path.posix.resolve('/proyecto', toNativePath('src\\auth\\login.js', path.posix));
  assert.strictEqual(nueva, '/proyecto/src/auth/login.js');
  assert.strictEqual(nueva.split('/').length, 5);
});

test('control positivo: sin traducir ni resolver, ai_docs/ deja de reconocerse en una ruta de Windows', () => {
  // isInsideAiDocs busca raiz con findRepoRoot(path.dirname(resolved)) antes de decidir por
  // tramos (ver hooks/sdd-plan-state.js). Sin al menos una barra normal, path.dirname en un
  // sistema tipo Unix no reconoce ningun directorio padre y degrada a '.': el caso de una ruta
  // de Windows compuesta solo por barras invertidas ('C:\\proyecto\\...') queda fuera de esta
  // prueba porque ya no es un input que isInsideAiDocs reciba en produccion sin pasar antes por
  // resolveRepoPath (ver el siguiente test); aqui se cubre la ruta absoluta MIXTA, que si trae
  // una barra normal y por tanto un directorio padre resoluble.
  assert.strictEqual('/proyecto/ai_docs\\tasks\\spec.md'.split('/').includes('ai_docs'), false);
  assert.strictEqual(isInsideAiDocs('/proyecto/ai_docs\\tasks\\spec.md'), true);
  assert.strictEqual(isInsideAiDocs('/proyecto/src/login.js'), false);
});

test('separadores de Windows en una ruta ya situada contra la raiz del repo siguen reconociendose', () => {
  // isInsideAiDocs recibe siempre el resultado de resolveRepoPath (ver los tres callers reales en
  // hooks/sdd-pipeline-guard*.js): una ruta absoluta ya en separadores nativos. El caso anterior
  // acredita la robustez de isInsideAiDocs ante una ruta MIXTA que no paso por ese camino; este
  // acredita el camino real, con un repositorio de verdad de por medio.
  const root = tempDir('sdd-ai-docs-win-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });

  assert.strictEqual(isInsideAiDocs(resolveRepoPath('ai_docs\\tasks\\spec.md', root)), true);
  assert.strictEqual(isInsideAiDocs(resolveRepoPath('src\\login.js', root)), false);
});

// ─── findRepoRoot / repoRoot ─────────────────────────────────────────────────

test('findRepoRoot: sube desde un subdirectorio hasta la raiz del repositorio', () => {
  const root = tempDir('sdd-repo-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const sub = path.join(root, 'src', 'auth');
  fs.mkdirSync(sub, { recursive: true });

  assert.strictEqual(findRepoRoot(sub), root);
  assert.strictEqual(findRepoRoot(root), root);
});

test('findRepoRoot: en un arbol de trabajo enlazado la raiz es la suya, no la del principal', () => {
  // En un arbol enlazado .git es un ARCHIVO que apunta al repositorio principal. La raiz que
  // interesa sigue siendo la del arbol: es donde viven los archivos que se van a escribir.
  const worktree = tempDir('sdd-worktree-');
  writeFile(path.join(worktree, '.git'), 'gitdir: /otro/sitio/.git/worktrees/rama\n');
  const sub = path.join(worktree, 'src');
  fs.mkdirSync(sub, { recursive: true });

  assert.strictEqual(findRepoRoot(sub), worktree);
});

test('findRepoRoot: no traspasa el techo temporal, igual que su gemelo findTasksDir', () => {
  // El comentario de TMP_ROOT (hooks/sdd-plan-state.js) explica por que findTasksDir no debe
  // ascender por encima del directorio temporal: un .git residual ahi colapsaria a la misma raiz
  // a dos sesiones de test que trabajan en subdirectorios temporales distintos. findRepoRoot
  // aplica el mismo techo.
  const TMP_ROOT = path.resolve(os.tmpdir());
  const gitResidual = path.join(TMP_ROOT, '.git');
  const yaExistia = fs.existsSync(gitResidual);
  if (!yaExistia) fs.mkdirSync(gitResidual);

  try {
    const sub = tempDir('sdd-techo-temporal-');
    assert.strictEqual(findRepoRoot(sub), null);
  } finally {
    if (!yaExistia) fs.rmSync(gitResidual, { recursive: true, force: true });
  }
});

test('findRepoRoot: sin repositorio devuelve null y el ancla degrada al directorio dado', () => {
  // Once niveles anidados agotan el limite de ascenso antes de alcanzar ningun ancestro: el
  // resultado no depende de si el directorio temporal de la maquina vive dentro de un repositorio.
  const base = tempDir('sdd-sin-repo-');
  const hondo = path.join(base, ...Array.from({ length: 11 }, (_, i) => 'n' + i));
  fs.mkdirSync(hondo, { recursive: true });

  assert.strictEqual(findRepoRoot(hondo), null);
  assert.strictEqual(repoRoot(hondo), hondo);
  assert.strictEqual(resolveRepoPath('src/login.js', hondo), path.join(hondo, 'src', 'login.js'));
});

// ─── resolveRepoPath ─────────────────────────────────────────────────────────

test('una ruta relativa se ancla a la raiz del repositorio, no al directorio en curso', () => {
  const root = tempDir('sdd-anclaje-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const sub = path.join(root, 'paquetes', 'app');
  fs.mkdirSync(sub, { recursive: true });

  assert.strictEqual(resolveRepoPath('ai_docs/tasks/spec.md', sub), path.join(root, 'ai_docs', 'tasks', 'spec.md'));
  assert.notStrictEqual(resolveRepoPath('ai_docs/tasks/spec.md', sub), path.join(sub, 'ai_docs', 'tasks', 'spec.md'));
});

test('una ruta relativa con separadores de Windows se ancla igual que la nativa', () => {
  const root = tempDir('sdd-anclaje-cruzado-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });

  assert.strictEqual(
    resolveRepoPath('ai_docs\\tasks\\spec.md', root),
    resolveRepoPath('ai_docs/tasks/spec.md', root),
  );
});

test('una ruta absoluta se preserva, no se concatena con la raiz del repositorio', () => {
  const root = tempDir('sdd-absoluta-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const absoluta = path.join(root, 'src', 'login.js');

  assert.strictEqual(resolveRepoPath(absoluta, root), absoluta);
  // Absoluta que apunta fuera del repositorio: se preserva igual. Situarla no es autorizarla; el
  // permiso lo decide despues el plan.
  const fuera = path.resolve(path.join(root, '..', 'otro-proyecto', 'login.js'));
  assert.strictEqual(resolveRepoPath(fuera, root), fuera);
});

test('una relativa que asciende por encima de la raiz no se resuelve a ciegas: devuelve null', () => {
  const root = tempDir('sdd-escape-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });

  assert.strictEqual(resolveRepoPath('../../etc/passwd', root), null);
  assert.strictEqual(resolveRepoPath('src/../../fuera.js', root), null);
  // Ascender y volver a bajar dentro del repositorio si es valido.
  assert.strictEqual(resolveRepoPath('src/../login.js', root), path.join(root, 'login.js'));
});

test('una ruta vacia o ausente devuelve null: no hay nada que situar', () => {
  assert.strictEqual(resolveRepoPath('', '/proyecto'), null);
  assert.strictEqual(resolveRepoPath(undefined, '/proyecto'), null);
  assert.strictEqual(resolveRepoPath(null, '/proyecto'), null);
});

test('el directorio de partida tambien se traduce antes de usarlo como ancla', () => {
  const root = tempDir('sdd-ancla-cruzada-');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });

  assert.strictEqual(resolveRepoPath('login.js', root + path.sep), path.join(root, 'login.js'));
});

// ─── isInside ────────────────────────────────────────────────────────────────

test('isInside distingue lo que cae dentro de la raiz de lo que sale de ella', () => {
  const root = path.resolve('/proyecto');
  assert.strictEqual(isInside(root, root), true);
  assert.strictEqual(isInside(root, path.join(root, 'src', 'login.js')), true);
  assert.strictEqual(isInside(root, path.resolve('/otro/login.js')), false);
  assert.strictEqual(isInside(root, path.resolve('/proyecto-vecino/login.js')), false,
    'un hermano con el mismo prefijo textual no esta dentro');
});

// ─── Efecto sobre la comparacion contra el plan ──────────────────────────────

test('un archivo declarado con separadores de Windows se reconoce igual que el nativo', () => {
  const root = tempDir('sdd-declarados-');
  const tasksDir = path.join(root, 'ai_docs', 'tasks');
  writeFile(path.join(tasksDir, 'spec_login.md'), '# Spec: Login\n\n**Estado:** APROBADA\n');
  writeFile(path.join(tasksDir, '001_login.md'), [
    '# Task 001: Servicio de login',
    '',
    'Spec madre: spec_login.md',
    '',
    '## Archivos afectados',
    '',
    '| Archivo | Accion | Descripcion del cambio |',
    '|---------|--------|----------------------|',
    '| `src\\auth\\login.js` | CREAR | Servicio de login |',
    '',
  ].join('\n'));

  const declarados = findDeclaredFiles(tasksDir);
  assert.ok(declarados.has(path.join(root, 'src', 'auth', 'login.js')),
    'la ruta declarada debe compararse por tramos, no como un nombre de archivo unico');
});

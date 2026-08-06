'use strict';

// Contrato de bin/cli.js.
//
// El CLI se invoca via `npx github:gmoncor/agentic-engineering-framework
// install --backend <backend>` desde el directorio de un proyecto destino.
// Lo peligroso no es que falle: es que copie de mas (pisando ai_docs/core/
// o ai_docs/tasks/, que son del proyecto), que cuelgue esperando input en
// un pipe/CI, o que aborte al primer archivo ausente del manifiesto. Estos
// tests montan un PACKAGE_ROOT ficticio via SDD_FRAMEWORK_ROOT (sin red) y
// comprueban esos limites.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const CLI = path.join(RAIZ, 'bin', 'cli.js');

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
}

function escribirArchivo(base, ruta, contenido) {
  const destino = path.join(base, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

/** Crea un PACKAGE_ROOT ficticio con manifiesto y las rutas indicadas. */
function crearPaqueteFixture(manifest, archivos = {}) {
  const dir = dirTemporal();
  escribirArchivo(dir, 'package.json', JSON.stringify({ version: '9.9.9' }));
  escribirArchivo(dir, 'scripts/backend-manifest.json', JSON.stringify(manifest));
  for (const [ruta, contenido] of Object.entries(archivos)) {
    escribirArchivo(dir, ruta, contenido);
  }
  return dir;
}

/** Captura stdout/stderr siempre (exito o error), a diferencia de execFileSync. */
function ejecutar(args, opts = {}) {
  const resultado = spawnSync('node', [CLI, ...args], {
    cwd: opts.cwd,
    env: Object.assign({}, process.env, opts.env),
    input: opts.input,
    encoding: 'utf8',
  });
  return {
    codigo: resultado.status,
    stdout: resultado.stdout || '',
    stderr: resultado.stderr || '',
  };
}

test('existe, es ejecutable y usa shebang node', () => {
  const stat = fs.statSync(CLI);
  assert.ok(stat.mode & 0o111, 'el CLI debe tener permiso de ejecucion');
  const primeraLinea = fs.readFileSync(CLI, 'utf8').split('\n')[0];
  assert.strictEqual(primeraLinea, '#!/usr/bin/env node');
});

test('--help muestra uso con subcomandos y sale sin error', () => {
  const { codigo, stdout } = ejecutar(['--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: agentic-engineering-framework/);
  assert.match(stdout, /install --backend/);
});

test('--help menciona el menu interactivo cuando se omite --backend', () => {
  const { codigo, stdout } = ejecutar(['--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /menu interactivo/i);
});

test('install --help muestra uso del subcomando y menciona el menu interactivo', () => {
  const { codigo, stdout } = ejecutar(['install', '--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: agentic-engineering-framework install/);
  assert.match(stdout, /menu interactivo/i);
});

test('sin subcomando muestra uso y sale sin error', () => {
  const { codigo, stdout } = ejecutar([], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: agentic-engineering-framework/);
});

test('subcomando desconocido sale con codigo 1 y error a stderr', () => {
  const { codigo, stderr } = ejecutar(['instal'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 1);
  assert.match(stderr, /no reconocido/);
  assert.match(stderr, /install/);
});

test('--version imprime la version de package.json y sale sin error', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const { codigo, stdout } = ejecutar(['--version'], {
    cwd: dirTemporal(),
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 0);
  assert.strictEqual(stdout.trim(), '9.9.9');
});

test('install con --backend invalido sale con codigo 1 y no copia nada', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: ['.claude'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['install', '--backend', 'cursor'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 1);
  assert.match(stderr, /Backend invalido/);
  assert.match(stderr, /claude, gemini, codex, antigravity, all/);
  assert.deepStrictEqual(fs.readdirSync(proyecto), []);
});

test('install sin --backend y stdin no-TTY sale con codigo 1 sin colgarse', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['install'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });
  assert.strictEqual(codigo, 1);
  assert.strictEqual(
    stderr,
    'Indica el backend con --backend <nombre>. El prompt interactivo requiere un terminal.\n',
  );
  assert.deepStrictEqual(fs.readdirSync(proyecto), []);
});

test('install --backend claude copia rutas comunes y de backend, y crea directorios del proyecto', () => {
  const paquete = crearPaqueteFixture(
    {
      common: ['hooks'],
      claude: ['.claude', 'CLAUDE.md'],
      gemini: ['GEMINI.md'],
    },
    {
      'hooks/sdd-commit-guard.js': 'hook',
      '.claude/agents/planificador.md': 'contenido agente',
      'CLAUDE.md': 'contexto',
    },
  );
  const proyecto = dirTemporal();
  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas copiadas/);
  assert.match(stdout, /opus/i, 'debe avisar del modelo default en install de claude');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'contenido agente',
  );
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-commit-guard.js'), 'utf8'),
    'hook',
  );
  assert.ok(!fs.existsSync(path.join(proyecto, 'GEMINI.md')), 'no debe copiar rutas de otro backend');
  for (const dir of ['ai_docs/core', 'ai_docs/tasks', 'ai_docs/refs']) {
    assert.ok(fs.statSync(path.join(proyecto, dir)).isDirectory());
  }
});

test('install --backend claude nunca copia package.json literal del framework', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();

  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.name, undefined, 'no debe traer el name del framework');
  assert.strictEqual(pkg.version, undefined, 'no debe traer la version del framework');
  assert.strictEqual(pkg.private, undefined, 'no debe traer metadatos del framework');
});

test('install --backend claude con package.json preexistente preserva claves del usuario y anade scripts.test', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'package.json', JSON.stringify({
    name: 'mi-app',
    version: '1.0.0',
    dependencies: { react: '^18.0.0' },
    scripts: { build: 'vite build' },
  }));

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.name, 'mi-app');
  assert.strictEqual(pkg.version, '1.0.0');
  assert.deepStrictEqual(pkg.dependencies, { react: '^18.0.0' });
  assert.strictEqual(pkg.scripts.build, 'vite build');
  assert.match(pkg.scripts.test, /node --test/);
  assert.match(stdout, /Anadido scripts\.test a package\.json/);
});

test('install --backend claude con package.json sin clave scripts crea scripts con solo test', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'package.json', JSON.stringify({ name: 'mi-app' }));

  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.name, 'mi-app');
  assert.deepStrictEqual(Object.keys(pkg.scripts), ['test']);
});

test('install --backend claude sin package.json previo crea uno minimo con solo scripts.test', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg), ['scripts']);
  assert.deepStrictEqual(Object.keys(pkg.scripts), ['test']);
  assert.match(stdout, /Anadido scripts\.test a package\.json/);
});

test('install --backend claude con scripts.test propio no lo sobrescribe', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'package.json', JSON.stringify({ name: 'mi-app', scripts: { test: 'jest' } }));

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const pkg = JSON.parse(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts.test, 'jest');
  assert.doesNotMatch(stdout, /Anadido scripts\.test/);
});

test('install --dry-run con package.json preexistente reporta sin escribir', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  const contenidoOriginal = JSON.stringify({ name: 'mi-app', scripts: { build: 'vite build' } });
  escribirArchivo(proyecto, 'package.json', contenidoOriginal);

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude', '--dry-run'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /\[DRY-RUN\] anaderia scripts\.test a package\.json/);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'), contenidoOriginal);
});

test('install --dry-run sin package.json previo reporta creacion sin escribir', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude', '--dry-run'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /\[DRY-RUN\] crearia package\.json con scripts\.test/);
  assert.ok(!fs.existsSync(path.join(proyecto, 'package.json')));
});

test('install con colision de archivo no protegido y stdin no-TTY sin --force sale con codigo 1 y no copia', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-commit-guard.js': 'hook nuevo' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'hooks/sdd-commit-guard.js', 'hook del usuario');

  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });

  assert.strictEqual(codigo, 1);
  assert.match(stderr, /1 archivos que se sobrescribirian/);
  assert.match(stderr, /hooks\/sdd-commit-guard\.js/);
  assert.match(stderr, /--force/);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-commit-guard.js'), 'utf8'), 'hook del usuario');
});

test('install --force sobre el mismo escenario de colision copia sin preguntar', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-commit-guard.js': 'hook nuevo' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'hooks/sdd-commit-guard.js', 'hook del usuario');

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude', '--force'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas copiadas/);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-commit-guard.js'), 'utf8'), 'hook nuevo');
});

test('install sobre directorio vacio no dispara el preflight (0 colisiones)', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/sdd-commit-guard.js': 'hook', 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas copiadas/);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-commit-guard.js'), 'utf8'), 'hook');
});

test('install --dry-run con colision no dispara el preflight: reporta preview sin pedir confirmacion', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-commit-guard.js': 'hook nuevo' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'hooks/sdd-commit-guard.js', 'hook del usuario');

  const { codigo, stdout, stderr } = ejecutar(['install', '--backend', 'claude', '--dry-run'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /\[DRY-RUN\] copiaria: hooks/);
  assert.doesNotMatch(stderr, /sobrescribirian/);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-commit-guard.js'), 'utf8'), 'hook del usuario');
});

test('install con colisiones solo en archivos protegidos no dispara el preflight', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"nuevo":true}', 'CLAUDE.md': 'contexto nuevo' },
  );
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'hooks', 'config.json'), '{"original":true}');
  escribirArchivo(proyecto, 'CLAUDE.md', 'contexto viejo');

  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });

  assert.strictEqual(codigo, 0);
});

test('update --force salta el preflight de colision pero no anula la proteccion de hash-sidecar', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"turn_budget":{"hard_stop_at":40}}', 'CLAUDE.md': 'contexto nuevo' },
  );
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'hooks', 'config.json'), '{"turn_budget":{"hard_stop_at":999}}');

  const primera = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(primera.codigo, 0);
  // hooks/config.json quedo protegido (edicion local detectada en la primera pasada):
  // update --force debe seguir sin pisarlo, aunque salte la confirmacion de colision.
  const { codigo } = ejecutar(['update', '--backend', 'claude', '--force'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'config.json'), 'utf8'),
    '{"turn_budget":{"hard_stop_at":999}}',
  );
});

test('--force aparece documentado en la ayuda de install y update', () => {
  const ayudaInstall = ejecutar(['install', '--help'], { cwd: dirTemporal() });
  const ayudaUpdate = ejecutar(['update', '--help'], { cwd: dirTemporal() });
  assert.match(ayudaInstall.stdout, /--force/);
  assert.match(ayudaUpdate.stdout, /--force/);
});

test('install con package.json del destino malformado reporta error sin crash ni sobrescritura', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'package.json', '{ esto no es json valido');

  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stderr, /package\.json/);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'package.json'), 'utf8'), '{ esto no es json valido');
});

test('install --backend gemini sobre proyecto con marcador de claude avisa del backend preexistente', () => {
  const paquete = crearPaqueteFixture(
    { common: [], gemini: ['GEMINI.md'] },
    { 'GEMINI.md': 'contexto gemini' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'CLAUDE.md', 'contexto\n<!-- sdd-framework: 1.0.0 -->\n');

  const { codigo, stderr, stdout } = ejecutar(['install', '--backend', 'gemini'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stderr, /Aviso/);
  assert.match(stderr, /claude/);
  assert.match(stderr, /CLAUDE\.md/);
  assert.doesNotMatch(stdout, /opus/i, 'install de gemini no debe avisar del modelo de Claude Code');
});

test('install --backend gemini crea las rutas del framework bajo el namespace .gemini/ en el destino', () => {
  const paquete = crearPaqueteFixture(
    { common: [], gemini: ['.gemini/agents', '.gemini/commands', '.gemini/skills', 'GEMINI.md'] },
    {
      '.gemini/agents/planificador.md': 'agente',
      '.gemini/commands/estado.toml': 'comando',
      '.gemini/skills/commit/SKILL.md': 'skill',
      'GEMINI.md': 'contexto gemini',
    },
  );
  const proyecto = dirTemporal();

  const { codigo, stdout } = ejecutar(['install', '--backend', 'gemini'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas copiadas/);
  assert.ok(fs.existsSync(path.join(proyecto, '.gemini', 'agents', 'planificador.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.gemini', 'commands', 'estado.toml')));
  assert.ok(fs.existsSync(path.join(proyecto, '.gemini', 'skills', 'commit', 'SKILL.md')));
});

test('install --backend gemini no toca un directorio commands/ propio del proyecto (namespace evita la colision)', () => {
  const paquete = crearPaqueteFixture(
    { common: [], gemini: ['.gemini/commands', 'GEMINI.md'] },
    { '.gemini/commands/estado.toml': 'comando del framework', 'GEMINI.md': 'contexto gemini' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'commands/mi-negocio.js', 'logica de negocio del usuario');

  const { codigo } = ejecutar(['install', '--backend', 'gemini'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'commands', 'mi-negocio.js'), 'utf8'),
    'logica de negocio del usuario',
    'commands/ propio del usuario no debe tocarse: el framework instala bajo .gemini/commands/',
  );
  assert.ok(fs.existsSync(path.join(proyecto, '.gemini', 'commands', 'estado.toml')));
});

test('update --backend gemini avisa si detecta el layout antiguo (agents/, commands/, skills/ sueltos)', () => {
  const paquete = crearPaqueteFixture(
    { common: [], gemini: ['.gemini/commands', 'GEMINI.md'] },
    { '.gemini/commands/estado.toml': 'comando del framework', 'GEMINI.md': 'contexto\n<!-- sdd-framework: 1.0.0 -->\n' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'GEMINI.md', 'contexto\n<!-- sdd-framework: 1.0.0 -->\n');
  escribirArchivo(proyecto, 'commands/estado.toml', 'layout antiguo');
  escribirArchivo(proyecto, 'agents/planificador.md', 'layout antiguo');

  const { codigo, stderr } = ejecutar(['update', '--backend', 'gemini'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stderr, /layout antiguo de Gemini/);
  assert.match(stderr, /agents/);
  assert.match(stderr, /commands/);
});

test('install --backend gemini en un proyecto nuevo (sin marcador previo) no avisa de layout antiguo', () => {
  const paquete = crearPaqueteFixture(
    { common: [], gemini: ['.gemini/commands', 'GEMINI.md'] },
    { '.gemini/commands/estado.toml': 'comando del framework', 'GEMINI.md': 'contexto gemini' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'commands/mi-negocio.js', 'del usuario, nunca tuvo el framework instalado');

  const { codigo, stderr } = ejecutar(['install', '--backend', 'gemini'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });

  assert.strictEqual(codigo, 0);
  assert.doesNotMatch(stderr, /layout antiguo/);
});

test('install --backend all no avisa de backend equivocado aunque no haya marcador previo', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: ['CLAUDE.md'], gemini: ['GEMINI.md'] }, {
    'CLAUDE.md': 'contexto',
    'GEMINI.md': 'contexto',
  });
  const proyecto = dirTemporal();

  const { codigo, stderr, stdout } = ejecutar(['install', '--backend', 'all'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.doesNotMatch(stderr, /Aviso/);
  assert.match(stdout, /opus/i, 'install --backend all incluye claude, debe avisar del modelo');
});

test('install --backend codex sobre proyecto con AGENTS.md de antigravity no avisa (comparten archivo)', () => {
  const paquete = crearPaqueteFixture(
    { common: [], codex: ['AGENTS.md'] },
    { 'AGENTS.md': 'contexto codex' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, 'AGENTS.md', 'contexto\n<!-- sdd-framework: 1.0.0 -->\n');

  const { codigo, stderr } = ejecutar(['install', '--backend', 'codex'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.doesNotMatch(stderr, /Aviso/);
});

test('install --backend claude seguido de install --backend gemini conserva los archivos de claude, anade los de gemini y refresca los comunes', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks', 'CHANGELOG.md'], claude: ['.claude', 'CLAUDE.md'], gemini: ['GEMINI.md'] },
    {
      'hooks/config.json': '{}',
      'hooks/utils.js': 'contenido comun',
      'CHANGELOG.md': 'historial',
      '.claude/agents/planificador.md': 'agente',
      'CLAUDE.md': 'contexto claude\n<!-- sdd-framework: 1.0.0 -->\n',
      'GEMINI.md': 'contexto gemini',
    },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  assert.strictEqual(ejecutar(['install', '--backend', 'claude'], opts).codigo, 0);
  const gemini = ejecutar(['install', '--backend', 'gemini', '--force'], opts);

  assert.strictEqual(gemini.codigo, 0);
  assert.match(gemini.stderr, /Aviso/);
  assert.match(gemini.stderr, /claude/);
  assert.match(gemini.stderr, /CLAUDE\.md/);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'agente',
  );
  assert.match(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), /contexto claude/);
  assert.ok(fs.existsSync(path.join(proyecto, 'GEMINI.md')));
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'hooks', 'utils.js'), 'utf8'), 'contenido comun');
});

test('install --backend claude seguido de install --backend codex conserva los archivos de claude y anade AGENTS.md', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['.claude', 'CLAUDE.md'], codex: ['AGENTS.md'] },
    {
      '.claude/agents/planificador.md': 'agente',
      'CLAUDE.md': 'contexto claude\n<!-- sdd-framework: 1.0.0 -->\n',
      'AGENTS.md': 'contexto codex',
    },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  assert.strictEqual(ejecutar(['install', '--backend', 'claude'], opts).codigo, 0);
  const codex = ejecutar(['install', '--backend', 'codex'], opts);

  assert.strictEqual(codex.codigo, 0);
  assert.match(codex.stderr, /Aviso/);
  assert.match(codex.stderr, /claude/);
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'agents', 'planificador.md')));
  assert.match(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), /contexto claude/);
  assert.ok(fs.existsSync(path.join(proyecto, 'AGENTS.md')));
});

test('los archivos comunes tras install claude + install gemini son identicos a los de un install claude solo', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'], gemini: ['GEMINI.md'] },
    {
      'hooks/config.json': '{}',
      'hooks/utils.js': 'contenido comun',
      'CLAUDE.md': 'contexto claude\n<!-- sdd-framework: 1.0.0 -->\n',
      'GEMINI.md': 'contexto gemini',
    },
  );

  const soloClaude = dirTemporal();
  assert.strictEqual(
    ejecutar(['install', '--backend', 'claude'], { cwd: soloClaude, env: { SDD_FRAMEWORK_ROOT: paquete } }).codigo,
    0,
  );

  const multiBackend = dirTemporal();
  const optsMulti = { cwd: multiBackend, env: { SDD_FRAMEWORK_ROOT: paquete } };
  assert.strictEqual(ejecutar(['install', '--backend', 'claude'], optsMulti).codigo, 0);
  assert.strictEqual(ejecutar(['install', '--backend', 'gemini', '--force'], optsMulti).codigo, 0);

  assert.deepStrictEqual(
    fs.readdirSync(path.join(multiBackend, 'hooks')).sort(),
    fs.readdirSync(path.join(soloClaude, 'hooks')).sort(),
  );
  assert.strictEqual(
    fs.readFileSync(path.join(multiBackend, 'hooks', 'utils.js'), 'utf8'),
    fs.readFileSync(path.join(soloClaude, 'hooks', 'utils.js'), 'utf8'),
  );
});

test('install --backend claude es idempotente: ejecutarlo dos veces seguidas produce el mismo resultado', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: ['.claude'] },
    { 'CLAUDE.md': 'contexto', '.claude/agents/planificador.md': 'agente' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const primera = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(primera.codigo, 0);
  // La segunda pasada colisiona con los archivos que la primera ya copio;
  // --force refleja el re-install intencional en este escenario de prueba.
  const segunda = ejecutar(['install', '--backend', 'claude', '--force'], opts);
  assert.strictEqual(segunda.codigo, 0);

  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'agente',
  );
  assert.deepStrictEqual(fs.readdirSync(path.join(proyecto, '.claude', 'agents')), ['planificador.md']);
});

test('ruta ausente en el manifiesto se salta con mensaje y continua con el resto', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md', '.agents'], claude: [] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas saltadas/);
  assert.match(stdout, /\.agents/);
  assert.ok(fs.existsSync(path.join(proyecto, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(proyecto, '.agents')));
});

test('no sobrescribe ni borra archivos preexistentes en ai_docs/core', () => {
  const paquete = crearPaqueteFixture({ common: ['CLAUDE.md'], claude: [] }, { 'CLAUDE.md': 'nuevo' });
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, 'ai_docs', 'core'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'ai_docs', 'core', 'vision.md'), 'MIO');

  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'ai_docs', 'core', 'vision.md'), 'utf8'),
    'MIO',
  );
});

test('install --backend all copia la union deduplicada de todos los backends', () => {
  const paquete = crearPaqueteFixture(
    {
      common: ['CLAUDE.md'],
      claude: ['.claude'],
      gemini: ['GEMINI.md'],
      codex: ['AGENTS.md'],
      antigravity: [],
    },
    {
      'CLAUDE.md': 'contexto',
      '.claude/agents/planificador.md': 'agente',
      'GEMINI.md': 'gemini',
      'AGENTS.md': 'agents',
    },
  );
  const proyecto = dirTemporal();
  const { codigo } = ejecutar(['install', '--backend', 'all'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'agents', 'planificador.md')));
  assert.ok(fs.existsSync(path.join(proyecto, 'GEMINI.md')));
  assert.ok(fs.existsSync(path.join(proyecto, 'AGENTS.md')));
});

test('no nombra al meta-repo ni jerga interna (anti-fuga)', () => {
  const contenido = fs.readFileSync(CLI, 'utf8');
  assert.doesNotMatch(contenido, /meta-repo|meta-task-planner|AI-Coding/i);
});

test('update --help muestra uso del subcomando y sale sin error', () => {
  const { codigo, stdout } = ejecutar(['update', '--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: agentic-engineering-framework update/);
});

test('update --help menciona el menu interactivo cuando se omite --backend', () => {
  const { codigo, stdout } = ejecutar(['update', '--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /menu interactivo/i);
});

test('update --help menciona --reset-protected', () => {
  const { codigo, stdout } = ejecutar(['update', '--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /--reset-protected/);
});

test('update con --backend invalido sale con codigo 1 y no copia nada', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: ['.claude'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['update', '--backend', 'cursor'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 1);
  assert.match(stderr, /Backend invalido/);
  assert.deepStrictEqual(fs.readdirSync(proyecto), []);
});

test('update sin --backend y stdin no-TTY sale con codigo 1 sin colgarse', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: [] });
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['update'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });
  assert.strictEqual(codigo, 1);
  assert.strictEqual(
    stderr,
    'Indica el backend con --backend <nombre>. El prompt interactivo requiere un terminal.\n',
  );
  assert.deepStrictEqual(fs.readdirSync(proyecto), []);
});

test('update --backend claude preserva intacto el contenido de ai_docs/core', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md', 'hooks'], claude: ['.claude'] },
    {
      'CLAUDE.md': 'contexto nuevo',
      'hooks/sdd-commit-guard.js': 'hook nuevo',
      '.claude/agents/planificador.md': 'agente nuevo',
    },
  );
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, 'ai_docs', 'core'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'ai_docs', 'core', 'test.md'), 'MIO SIN TOCAR');
  // Instalacion previa (marca minima de deteccion; no interfiere con la proteccion por hash).
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{}');

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas actualizadas/);
  assert.match(stdout, /Framework actualizado a la version/);
  assert.doesNotMatch(stdout, /opus/i, 'update no debe repetir el aviso de modelo default (solo install)');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'ai_docs', 'core', 'test.md'), 'utf8'),
    'MIO SIN TOCAR',
  );
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto nuevo');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-commit-guard.js'), 'utf8'),
    'hook nuevo',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'agente nuevo',
  );
  assert.ok(
    !fs.existsSync(path.join(proyecto, 'ai_docs', 'tasks')),
    'update no debe crear directorios del proyecto que no existian',
  );
});

test('update sobre un directorio sin instalacion previa aborta y recomienda install', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: ['.claude'] },
    { 'CLAUDE.md': 'contexto', '.claude/agents/planificador.md': 'agente' },
  );
  const proyecto = dirTemporal();

  const { codigo, stderr } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 1);
  assert.match(stderr, /No se detecto una instalacion previa/);
  assert.match(stderr, /install/);
  assert.ok(!fs.existsSync(path.join(proyecto, 'CLAUDE.md')), 'no debe copiar nada sin instalacion previa');
  assert.deepStrictEqual(fs.readdirSync(proyecto), []);
});

test('update --force sobre un directorio sin instalacion previa tambien aborta', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: [] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();

  const { codigo, stderr } = ejecutar(['update', '--backend', 'claude', '--force'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 1);
  assert.match(stderr, /No se detecto una instalacion previa/);
});

test('update sobre un directorio con solo ai_docs/core creado a mano aborta y recomienda install', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: [] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, 'ai_docs', 'core'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'ai_docs', 'core', 'master_idea.md'), 'notas del usuario');

  const { codigo, stderr } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 1);
  assert.match(stderr, /No se detecto una instalacion previa/);
});

test('update sobre una instalacion antigua sin sidecar pero con marcador en CLAUDE.md continua normalmente', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto nuevo\n<!-- sdd-framework: 9.9.9 -->\n' },
  );
  const proyecto = dirTemporal();
  // Instalacion anterior a la introduccion del sidecar de hashes: solo dejo el marcador.
  fs.writeFileSync(path.join(proyecto, 'CLAUDE.md'), 'contexto viejo\n<!-- sdd-framework: 1.0.0 -->\n');

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Framework actualizado a la version/);
});

test('update --backend all anade las rutas de los backends nuevos sobre una instalacion parcial', () => {
  const paquete = crearPaqueteFixture(
    {
      common: ['CLAUDE.md'],
      claude: ['.claude'],
      gemini: ['GEMINI.md'],
      codex: ['AGENTS.md'],
      antigravity: [],
    },
    {
      'CLAUDE.md': 'contexto',
      '.claude/agents/planificador.md': 'agente',
      'GEMINI.md': 'gemini',
      'AGENTS.md': 'agents',
    },
  );
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'agente viejo');
  fs.writeFileSync(path.join(proyecto, 'CLAUDE.md'), 'contexto viejo');
  // Instalacion previa (marca minima de deteccion; no interfiere con la proteccion por hash).
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{}');

  // .claude/agents/planificador.md y CLAUDE.md preexisten sin haber pasado por
  // install/update (sin sidecar de hashes previo): el preflight los trata como
  // colision, --force la asume, pero la proteccion por hash-sidecar de `update`
  // es generalizada -- cubre cualquier archivo, no solo los 6 nucleares -- asi
  // que ambos se tratan como posible edicion local y no se sobrescriben.
  const { codigo } = ejecutar(['update', '--backend', 'all', '--force'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, 'GEMINI.md')), 'debe anadir la ruta nueva de gemini');
  assert.ok(fs.existsSync(path.join(proyecto, 'AGENTS.md')), 'debe anadir la ruta nueva de codex');
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto viejo');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'agente viejo',
  );
});

test('update comparte la funcion de copia con install (sin duplicar logica)', () => {
  const contenido = fs.readFileSync(CLI, 'utf8');
  const coincidencias = contenido.match(/copiarRutas\w*|copyFramework/g) || [];
  assert.ok(coincidencias.length >= 2, 'la funcion de copia debe estar definida e invocada por ambos subcomandos');
});

test('install crea el sidecar de hashes con los archivos protegidos copiados', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"a":1}', 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const sidecarPath = path.join(proyecto, '.sdd-installed-hashes.json');
  assert.ok(fs.existsSync(sidecarPath), 'install debe crear el sidecar de hashes');
  const hashes = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.strictEqual(
    hashes['CLAUDE.md'],
    crypto.createHash('sha256').update('contexto').digest('hex'),
  );
  assert.strictEqual(
    hashes['hooks/config.json'],
    crypto.createHash('sha256').update('{"a":1}').digest('hex'),
  );
});

test('update salta un archivo protegido con cambios locales y avisa por stdout', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"turn_budget":{"hard_stop_at":40}}', 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // El usuario personaliza el umbral localmente tras instalar.
  fs.writeFileSync(
    path.join(proyecto, 'hooks', 'config.json'),
    '{"turn_budget":{"hard_stop_at":80}}',
  );
  // El framework publica una nueva version del mismo archivo.
  fs.writeFileSync(
    path.join(paquete, 'hooks', 'config.json'),
    '{"turn_budget":{"hard_stop_at":40,"warn_at":30}}',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], opts);

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'config.json'), 'utf8'),
    '{"turn_budget":{"hard_stop_at":80}}',
    'no debe sobrescribir un archivo protegido con ediciones locales',
  );
  assert.match(stdout, /cambios locales/);
  assert.match(stdout, /hooks\/config\.json/);
});

test('update sobrescribe un archivo protegido sin cambios locales', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"turn_budget":{"hard_stop_at":40}}', 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  fs.writeFileSync(
    path.join(paquete, 'hooks', 'config.json'),
    '{"turn_budget":{"hard_stop_at":50}}',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], opts);

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'config.json'), 'utf8'),
    '{"turn_budget":{"hard_stop_at":50}}',
  );
  assert.doesNotMatch(stdout, /cambios locales/);
});

test('update sin sidecar previo trata los archivos protegidos preexistentes como posiblemente editados', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"nuevo":true}', 'CLAUDE.md': 'contexto nuevo' },
  );
  const proyecto = dirTemporal();
  // Instalacion previa a la introduccion del sidecar de hashes: el archivo existe
  // pero sin entradas para estos archivos concretos.
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{}');
  fs.writeFileSync(path.join(proyecto, 'CLAUDE.md'), 'contexto original del usuario');
  fs.mkdirSync(path.join(proyecto, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'hooks', 'config.json'), '{"original":true}');

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    'contexto original del usuario',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'config.json'), 'utf8'),
    '{"original":true}',
  );
  assert.match(stdout, /cambios locales/);
  assert.match(stdout, /CLAUDE\.md/);
  assert.match(stdout, /hooks\/config\.json/);
});

test('update sincroniza el marcador de version con la version del paquete fuente', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto\n<!-- sdd-framework: 0.0.0 -->\n' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);
  assert.match(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    /<!-- sdd-framework: 9\.9\.9 -->/,
    'install ya debe dejar el marcador con la version del paquete fuente',
  );

  fs.writeFileSync(path.join(paquete, 'package.json'), JSON.stringify({ version: '9.9.10' }));

  const actualizacion = ejecutar(['update', '--backend', 'claude'], opts);
  assert.strictEqual(actualizacion.codigo, 0);
  assert.match(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    /<!-- sdd-framework: 9\.9\.10 -->/,
  );

  // La reescritura del marcador no debe hacer que el siguiente update trate
  // el archivo como editado localmente (el hash del sidecar debe refrescarse
  // junto con el marcador).
  const segundaActualizacion = ejecutar(['update', '--backend', 'claude'], opts);
  assert.strictEqual(segundaActualizacion.codigo, 0);
  assert.doesNotMatch(segundaActualizacion.stdout, /cambios locales/);
});

test('update no actualiza el marcador de un archivo saltado por proteccion local', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto\n<!-- sdd-framework: 1.0.0 -->\n' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // El usuario edita CLAUDE.md a mano tras instalar.
  fs.writeFileSync(
    path.join(proyecto, 'CLAUDE.md'),
    'contexto editado por el usuario\n<!-- sdd-framework: 9.9.9 -->\n',
  );
  fs.writeFileSync(path.join(paquete, 'package.json'), JSON.stringify({ version: '9.9.10' }));

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], opts);

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /cambios locales/);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    'contexto editado por el usuario\n<!-- sdd-framework: 9.9.9 -->\n',
    'el marcador no debe cambiar en un archivo saltado por proteccion local',
  );
});

test('update sin sidecar previo y contenido identico al del paquete copia el archivo y siembra el hash', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto identico al del paquete' },
  );
  const proyecto = dirTemporal();
  // Instalacion anterior al sidecar de hashes: el contenido nunca diverge del origen.
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{}');
  fs.writeFileSync(path.join(proyecto, 'CLAUDE.md'), 'contexto identico al del paquete');

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.doesNotMatch(stdout, /cambios locales/, 'contenido identico al origen no debe protegerse');
  const sidecarPath = path.join(proyecto, '.sdd-installed-hashes.json');
  const hashes = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.strictEqual(
    hashes['CLAUDE.md'],
    crypto.createHash('sha256').update('contexto identico al del paquete').digest('hex'),
    'el hash debe sembrarse en el sidecar aunque no hubiera entrada previa',
  );
});

test('update sin sidecar previo y contenido distinto al del paquete protege el archivo', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto del paquete' },
  );
  const proyecto = dirTemporal();
  // Instalacion anterior al sidecar de hashes, con ediciones genuinas del usuario.
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{}');
  fs.writeFileSync(path.join(proyecto, 'CLAUDE.md'), 'contexto editado por el usuario');

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    'contexto editado por el usuario',
    'contenido distinto al origen debe protegerse por defecto',
  );
  assert.match(stdout, /cambios locales/);
  assert.match(stdout, /CLAUDE\.md/);
});

test('update --reset-protected sobrescribe archivos protegidos con ediciones locales y refresca el sidecar', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['CLAUDE.md'] },
    { 'hooks/config.json': '{"turn_budget":{"hard_stop_at":40}}', 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // El usuario personaliza el umbral localmente tras instalar.
  fs.writeFileSync(
    path.join(proyecto, 'hooks', 'config.json'),
    '{"turn_budget":{"hard_stop_at":80}}',
  );
  // El framework publica una nueva version del mismo archivo.
  fs.writeFileSync(
    path.join(paquete, 'hooks', 'config.json'),
    '{"turn_budget":{"hard_stop_at":40,"warn_at":30}}',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude', '--reset-protected'], opts);

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'config.json'), 'utf8'),
    '{"turn_budget":{"hard_stop_at":40,"warn_at":30}}',
    '--reset-protected debe sobrescribir el archivo pese a las ediciones locales',
  );
  assert.doesNotMatch(stdout, /cambios locales/);

  const sidecarPath = path.join(proyecto, '.sdd-installed-hashes.json');
  const hashes = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  assert.strictEqual(
    hashes['hooks/config.json'],
    crypto.createHash('sha256').update('{"turn_budget":{"hard_stop_at":40,"warn_at":30}}').digest('hex'),
    'el sidecar debe refrescarse con el hash del archivo recien copiado',
  );
});

test('update generaliza la proteccion a un hook fuera de la lista fija de 6 rutas', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-turn-budget.js': 'module.exports = { hardStopAt: 40 };' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // El usuario parchea el hook localmente tras instalar (umbral ajustado).
  fs.writeFileSync(
    path.join(proyecto, 'hooks', 'sdd-turn-budget.js'),
    'module.exports = { hardStopAt: 999 };',
  );
  // El framework publica una nueva version del mismo hook.
  fs.writeFileSync(
    path.join(paquete, 'hooks', 'sdd-turn-budget.js'),
    'module.exports = { hardStopAt: 40, warnAt: 30 };',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude', '--force'], opts);

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-turn-budget.js'), 'utf8'),
    'module.exports = { hardStopAt: 999 };',
    'un hook fuera de ARCHIVOS_PROTEGIDOS tambien debe protegerse si tiene ediciones locales',
  );
  assert.match(stdout, /cambios locales/);
  assert.match(stdout, /hooks\/sdd-turn-budget\.js/);
});

test('update generaliza la proteccion a CHANGELOG.md editado localmente', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CHANGELOG.md'], claude: [] },
    { 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // El usuario anade notas propias al CHANGELOG tras instalar.
  fs.writeFileSync(
    path.join(proyecto, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n- nota propia del equipo\n',
  );
  // El framework publica una nueva entrada en el mismo archivo.
  fs.writeFileSync(
    path.join(paquete, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n- nueva entrada del framework\n',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude', '--force'], opts);

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CHANGELOG.md'), 'utf8'),
    '# Changelog\n\n## [Unreleased]\n\n- nota propia del equipo\n',
    'CHANGELOG.md no esta en ARCHIVOS_PROTEGIDOS pero debe protegerse igual',
  );
  assert.match(stdout, /cambios locales/);
  assert.match(stdout, /CHANGELOG\.md/);
});

test('update --reset-protected sobrescribe tambien archivos fuera de la lista fija de 6 rutas', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-turn-budget.js': 'module.exports = { hardStopAt: 40 };' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  fs.writeFileSync(
    path.join(proyecto, 'hooks', 'sdd-turn-budget.js'),
    'module.exports = { hardStopAt: 999 };',
  );
  fs.writeFileSync(
    path.join(paquete, 'hooks', 'sdd-turn-budget.js'),
    'module.exports = { hardStopAt: 40, warnAt: 30 };',
  );

  const { codigo, stdout } = ejecutar(
    ['update', '--backend', 'claude', '--force', '--reset-protected'],
    opts,
  );

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-turn-budget.js'), 'utf8'),
    'module.exports = { hardStopAt: 40, warnAt: 30 };',
    '--reset-protected debe sobrescribir tambien archivos fuera de la lista fija',
  );
  assert.doesNotMatch(stdout, /cambios locales/);
});

test('update sin sidecar previo protege por retrocompatibilidad un archivo fuera de la lista fija', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-turn-budget.js': 'module.exports = { hardStopAt: 40 };' },
  );
  const proyecto = dirTemporal();
  // Instalacion previa a la introduccion del sidecar de hashes: el archivo existe
  // pero sin entradas para estos archivos concretos.
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{}');
  fs.mkdirSync(path.join(proyecto, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(proyecto, 'hooks', 'sdd-turn-budget.js'),
    'module.exports = { hardStopAt: 999 }; // ajuste del equipo',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude', '--force'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-turn-budget.js'), 'utf8'),
    'module.exports = { hardStopAt: 999 }; // ajuste del equipo',
  );
  assert.match(stdout, /cambios locales/);
  assert.match(stdout, /hooks\/sdd-turn-budget\.js/);
});

test('update con sidecar de hashes corrupto avisa por stderr y no aborta', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto nuevo' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // Sidecar corrupto: simula tanto una corrupcion como una escritura anterior
  // interrumpida a mitad de proceso (mismo sintoma: JSON no parseable).
  fs.writeFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), '{"CLAUDE.md": "abc');

  const { codigo, stderr } = ejecutar(['update', '--backend', 'claude', '--force'], opts);

  assert.strictEqual(codigo, 0);
  assert.match(stderr, /\.sdd-installed-hashes\.json/);
  // Contenido identico al del paquete: sin hash previo utilizable, la
  // comparacion retrocompatible contra el origen determina que no hay edicion.
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto nuevo');
});

test('update recrea un archivo del framework que el usuario elimino (no lo trata como editado)', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: [] },
    { 'hooks/sdd-turn-budget.js': 'module.exports = { hardStopAt: 40 };' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  fs.rmSync(path.join(proyecto, 'hooks', 'sdd-turn-budget.js'));
  fs.writeFileSync(
    path.join(paquete, 'hooks', 'sdd-turn-budget.js'),
    'module.exports = { hardStopAt: 45 };',
  );

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], opts);

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'hooks', 'sdd-turn-budget.js'), 'utf8'),
    'module.exports = { hardStopAt: 45 };',
    'un archivo borrado por el usuario debe recrearse, no tratarse como edicion local',
  );
  assert.doesNotMatch(stdout, /cambios locales/);
});

test('update --reset-protected sin --backend sigue el flujo interactivo normal', () => {
  const paquete = crearPaqueteFixture({ common: [], claude: ['CLAUDE.md'] }, { 'CLAUDE.md': 'contexto' });
  const { codigo, stderr } = ejecutar(['update', '--reset-protected'], {
    cwd: dirTemporal(),
    env: { SDD_FRAMEWORK_ROOT: paquete },
    input: '',
  });
  assert.strictEqual(codigo, 1);
  assert.match(stderr, /requiere un terminal/);
});

test('actualizarMarcador no falla ni inserta el marcador en un archivo que no lo tiene', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto sin marcador de version' },
  );
  const proyecto = dirTemporal();

  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    'contexto sin marcador de version',
  );
  assert.doesNotMatch(stdout, /sdd-framework/);
});

test('el marcador se sustituye en todas sus ocurrencias si aparece mas de una vez', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': '<!-- sdd-framework: 1.0.0 -->\ncontexto\n<!-- sdd-framework: 1.0.0 -->\n' },
  );
  const proyecto = dirTemporal();

  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  const contenido = fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8');
  const ocurrencias = contenido.match(/<!-- sdd-framework: 9\.9\.9 -->/g) || [];
  assert.strictEqual(ocurrencias.length, 2, 'las dos ocurrencias del marcador deben actualizarse');
  assert.doesNotMatch(contenido, /1\.0\.0/);
});

/** Fixture con la seccion `claude` en formato core/optional para los tests de granularidad. */
function crearPaqueteGranular() {
  return crearPaqueteFixture(
    {
      common: [],
      claude: {
        core: ['.claude/commands/spec.md', '.claude/commands/commit.md'],
        optional: [
          { nombre: 'asesor', rutas: ['.claude/commands/asesor.md', '.claude/agents/asesor.md'] },
          { nombre: 'bugfix', rutas: ['.claude/commands/bugfix.md'] },
        ],
      },
      gemini: ['GEMINI.md'],
    },
    {
      '.claude/commands/spec.md': 'spec',
      '.claude/commands/commit.md': 'commit',
      '.claude/commands/asesor.md': 'asesor cmd',
      '.claude/agents/asesor.md': 'asesor agente',
      '.claude/commands/bugfix.md': 'bugfix',
      'GEMINI.md': 'gemini',
    },
  );
}

test('install --backend claude sin --skip copia componentes core y opcionales', () => {
  const paquete = crearPaqueteGranular();
  const proyecto = dirTemporal();
  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'spec.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'commit.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'asesor.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'agents', 'asesor.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'bugfix.md')));
});

test('install --backend claude --skip asesor,bugfix omite esos componentes y copia el resto', () => {
  const paquete = crearPaqueteGranular();
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude', '--skip', 'asesor,bugfix'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'spec.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'commit.md')));
  assert.ok(!fs.existsSync(path.join(proyecto, '.claude', 'commands', 'asesor.md')));
  assert.ok(!fs.existsSync(path.join(proyecto, '.claude', 'agents', 'asesor.md')));
  assert.ok(!fs.existsSync(path.join(proyecto, '.claude', 'commands', 'bugfix.md')));
  assert.strictEqual(stderr, '');
});

test('install --backend gemini --skip asesor avisa y copia todo (skip solo aplica a claude)', () => {
  const paquete = crearPaqueteGranular();
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['install', '--backend', 'gemini', '--skip', 'asesor'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stderr, /--skip solo aplica al backend claude/);
  assert.ok(fs.existsSync(path.join(proyecto, 'GEMINI.md')));
});

test('install --backend claude --skip con nombre invalido avisa y continua sin fallar', () => {
  const paquete = crearPaqueteGranular();
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude', '--skip', 'inexistente'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stderr, /componente 'inexistente' no reconocido, ignorado/);
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'spec.md')));
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'asesor.md')));
});

test('install --backend claude --skip "" trata como sin skip (copia todo, sin error)', () => {
  const paquete = crearPaqueteGranular();
  const proyecto = dirTemporal();
  const { codigo } = ejecutar(['install', '--backend', 'claude', '--skip', ''], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'asesor.md')));
});

test('install --backend claude con manifiesto en formato antiguo (array plano) trata todo como core', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['.claude/commands/spec.md'] },
    { '.claude/commands/spec.md': 'spec' },
  );
  const proyecto = dirTemporal();
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude', '--skip', 'spec'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(stderr, '');
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'commands', 'spec.md')));
});

test('install --dry-run --backend claude reporta preview y no crea ningun fichero en el destino', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['.claude', 'CLAUDE.md'] },
    {
      'hooks/sdd-commit-guard.js': 'hook',
      '.claude/agents/planificador.md': 'contenido agente',
      'CLAUDE.md': 'contexto',
    },
  );
  const proyecto = dirTemporal();
  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude', '--dry-run'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /\[DRY-RUN\]/);
  assert.match(stdout, /Rutas copiadas/);
  assert.ok(!fs.existsSync(path.join(proyecto, 'CLAUDE.md')), 'no debe escribir ficheros en dry-run');
  assert.ok(!fs.existsSync(path.join(proyecto, 'hooks')), 'no debe crear directorios en dry-run');
  assert.ok(!fs.existsSync(path.join(proyecto, '.claude')), 'no debe crear directorios en dry-run');
  assert.ok(!fs.existsSync(path.join(proyecto, 'ai_docs')), 'no debe crear ai_docs/ en dry-run');
  assert.ok(
    !fs.existsSync(path.join(proyecto, '.sdd-installed-hashes.json')),
    'no debe persistir el sidecar de hashes en dry-run',
  );
});

test('update --dry-run reporta un archivo protegido editado localmente sin sobrescribirlo', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const instalacion = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(instalacion.codigo, 0);

  // El usuario personaliza CLAUDE.md localmente tras instalar.
  const contenidoLocal = 'contexto editado a mano';
  fs.writeFileSync(path.join(proyecto, 'CLAUDE.md'), contenidoLocal);
  // El framework publica una nueva version del mismo archivo.
  fs.writeFileSync(path.join(paquete, 'CLAUDE.md'), 'contexto nuevo del framework');
  const hashesAntes = fs.readFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), 'utf8');

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude', '--dry-run'], opts);

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /\[DRY-RUN\] saltaria \(editada localmente\): CLAUDE\.md/);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    contenidoLocal,
    'dry-run no debe sobrescribir un archivo protegido con ediciones locales',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), 'utf8'),
    hashesAntes,
    'dry-run no debe modificar el sidecar de hashes',
  );
});

test('install exitoso no deja .sdd-install-in-progress en disco', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const { codigo } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 0);
  assert.ok(
    !fs.existsSync(path.join(proyecto, '.sdd-install-in-progress')),
    'el lockfile no debe sobrevivir a una instalacion exitosa',
  );
});

test('install con lockfile preexistente de una instalacion interrumpida avisa por stderr y continua', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(
    proyecto,
    '.sdd-install-in-progress',
    JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', backend: 'claude' }),
  );
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 0);
  assert.match(stderr, /interrumpida/i);
  assert.match(stderr, /2026-01-01/);
  assert.ok(
    !fs.existsSync(path.join(proyecto, '.sdd-install-in-progress')),
    'el lockfile debe desaparecer tras completar la instalacion que lo encontro',
  );
});

test('install con lockfile de un backend distinto avisa mencionando el backend anterior', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(
    proyecto,
    '.sdd-install-in-progress',
    JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', backend: 'gemini' }),
  );
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 0);
  assert.match(stderr, /gemini/);
  assert.match(stderr, /claude/);
});

test('install con lockfile de JSON invalido avisa de forma generica sin crash', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  escribirArchivo(proyecto, '.sdd-install-in-progress', '{ json invalido');
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 0);
  assert.match(stderr, /posiblemente interrumpida/i);
});

test('install --dry-run no crea .sdd-install-in-progress', () => {
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['CLAUDE.md'] },
    { 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  const { codigo } = ejecutar(['install', '--backend', 'claude', '--dry-run'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 0);
  assert.ok(
    !fs.existsSync(path.join(proyecto, '.sdd-install-in-progress')),
    '--dry-run no debe escribir el lockfile',
  );
});

test('install con fallo durante la copia deja .sdd-install-in-progress en disco', () => {
  const paquete = crearPaqueteFixture(
    { common: ['archivo.md'], claude: [] },
    { 'archivo.md': 'contenido' },
  );
  const proyecto = dirTemporal();
  // Fuerza un fallo en fs.copyFileSync (EISDIR): el destino ya existe como directorio.
  // --force salta el preflight de colision para que la copia real se intente
  // y sea copiarRuta quien falle con EISDIR.
  fs.mkdirSync(path.join(proyecto, 'archivo.md'));
  const { codigo, stderr } = ejecutar(['install', '--backend', 'claude', '--force'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });
  assert.strictEqual(codigo, 1);
  assert.match(stderr, /Rutas que fallaron al copiar/);
  assert.match(stderr, /archivo\.md/);
  assert.ok(
    fs.existsSync(path.join(proyecto, '.sdd-install-in-progress')),
    'el lockfile debe permanecer tras un fallo de copia',
  );
});

test('install con un subdirectorio sin permisos de escritura reporta rutas fallidas, copia las demas y sale con exit != 0', () => {
  if (process.platform === 'win32') return; // chmod no restringe escritura de forma fiable en Windows.
  const paquete = crearPaqueteFixture(
    { common: [], claude: ['.claude/workflows', 'CLAUDE.md'] },
    { '.claude/workflows/flujo.md': 'workflow', 'CLAUDE.md': 'contexto' },
  );
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, '.claude'));
  fs.chmodSync(path.join(proyecto, '.claude'), 0o555);

  try {
    const { codigo, stdout, stderr } = ejecutar(['install', '--backend', 'claude', '--force'], {
      cwd: proyecto,
      env: { SDD_FRAMEWORK_ROOT: paquete },
    });

    assert.notStrictEqual(codigo, 0, 'debe salir con codigo distinto de cero si hubo fallos');
    assert.match(stdout, /Rutas copiadas/);
    assert.match(stdout, /CLAUDE\.md/, 'la ruta sin conflicto debe copiarse igual');
    assert.match(stderr, /Rutas que fallaron al copiar/);
    assert.match(stderr, /\.claude\/workflows/);
    assert.strictEqual(
      fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
      'contexto',
      'la ruta que si pudo copiarse no debe verse afectada por el fallo de la otra',
    );
    assert.ok(
      !fs.existsSync(path.join(proyecto, '.claude', 'workflows')),
      'la ruta fallida no debe dejar contenido a medio copiar',
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(proyecto, '.sdd-installed-hashes.json'), 'utf8'),
    );
    assert.ok('CLAUDE.md' in sidecar, 'el sidecar debe registrar la ruta exitosa');
    assert.ok(
      !Object.keys(sidecar).some(archivo => archivo.startsWith('.claude/workflows')),
      'el sidecar no debe registrar hashes de la ruta que fallo',
    );
  } finally {
    fs.chmodSync(path.join(proyecto, '.claude'), 0o755);
  }
});

test('install sin fallos se comporta igual que antes: todas las rutas copiadas, sin reporte de fallidas, exit 0', () => {
  const paquete = crearPaqueteFixture(
    { common: ['hooks'], claude: ['.claude', 'CLAUDE.md'] },
    {
      'hooks/sdd-commit-guard.js': 'hook',
      '.claude/agents/planificador.md': 'contenido agente',
      'CLAUDE.md': 'contexto',
    },
  );
  const proyecto = dirTemporal();
  const { codigo, stdout, stderr } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas copiadas/);
  assert.doesNotMatch(stderr, /Rutas que fallaron al copiar/);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'),
    'contexto',
  );
  assert.ok(
    !fs.existsSync(path.join(proyecto, '.sdd-install-in-progress')),
    'sin fallos el lockfile debe eliminarse al completar',
  );
});

// IMPORTANTE: este test (y `npm pack --dry-run`) solo valida el flujo de
// publicacion a registry. NO valida el flujo real que usan los usuarios
// (`npx github:...`): ese flujo pasa por una extraccion intermedia de
// pacote que renombra cualquier archivo literalmente llamado `.gitignore`
// a `.npmignore` (ver comentario junto a ORIGEN_RENOMBRADO en bin/cli.js),
// asi que un `.npmignore` correcto aqui NO garantiza que `.gitignore`
// sobreviva a `npx github:`. La unica verificacion real de ese flujo es
// manual: `rm -rf ~/.npm/_npx && cd $(mktemp -d) && npx -y
// github:gmoncor/agentic-engineering-framework install --backend claude` y
// confirmar `.gitignore` en "Rutas copiadas". El mecanismo que SI protege
// ese flujo se cubre en los tests de ORIGEN_RENOMBRADO mas abajo.
test('.npmignore existe, fuerza la inclusion de .gitignore y no excluye rutas criticas del manifiesto', () => {
  const rutaNpmignore = path.join(RAIZ, '.npmignore');
  assert.ok(fs.existsSync(rutaNpmignore), '.npmignore debe existir en la raiz del repo');

  const lineas = fs
    .readFileSync(rutaNpmignore, 'utf8')
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea && !linea.startsWith('#'));

  // npm excluye .gitignore por defecto al empaquetar (regla interna de
  // npm-packlist), incluso con un .npmignore presente en el repo. La unica
  // forma de que .gitignore llegue como archivo regular al paquete es negar
  // esa exclusion explicitamente.
  assert.ok(
    lineas.includes('!.gitignore'),
    '.npmignore debe forzar la inclusion de .gitignore con la linea "!.gitignore"',
  );

  const manifest = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'scripts', 'backend-manifest.json'), 'utf8'),
  );
  const rutasCriticas = [
    'bin/cli.js',
    'scripts/backend-manifest.json',
    'CLAUDE.md',
    '.claude',
    'hooks',
    ...manifest.common,
    ...manifest.claude.core,
    ...manifest.claude.optional.flatMap((opcion) => opcion.rutas),
    ...manifest.gemini,
    ...manifest.codex,
    ...manifest.antigravity,
  ];

  const exclusiones = lineas.filter((linea) => !linea.startsWith('!'));
  for (const ruta of rutasCriticas) {
    const raizRuta = ruta.split('/')[0];
    const excluida = exclusiones.some((patron) => {
      const patronLimpio = patron.replace(/\/$/, '');
      return (
        patronLimpio === raizRuta || patronLimpio === ruta || ruta.startsWith(`${patronLimpio}/`)
      );
    });
    assert.ok(!excluida, `.npmignore no debe excluir la ruta del manifiesto: ${ruta}`);
  }
});

test('templates/.gitignore.template existe y es identico byte a byte a .gitignore', () => {
  const rutaTemplate = path.join(RAIZ, 'templates', '.gitignore.template');
  const rutaGitignore = path.join(RAIZ, '.gitignore');
  assert.ok(fs.existsSync(rutaTemplate), 'templates/.gitignore.template debe existir en la raiz del repo');

  const contenidoTemplate = fs.readFileSync(rutaTemplate, 'utf8');
  const contenidoGitignore = fs.readFileSync(rutaGitignore, 'utf8');
  assert.strictEqual(
    contenidoTemplate,
    contenidoGitignore,
    'templates/.gitignore.template debe mantenerse identico a .gitignore (evita drift entre ambos)',
  );
});

// Reproduce el estado exacto de filesystem que deja el bug de pacote tras
// `npx github:` (ver ORIGEN_RENOMBRADO en bin/cli.js): un paquete SIN ningun
// archivo llamado `.gitignore`, pero con `templates/.gitignore.template`
// presente. Es la aproximacion mas cercana al mecanismo real que se puede
// automatizar sin red; la verificacion definitiva sigue siendo el comando
// manual de `npx github:` documentado arriba.
test('install copia .gitignore desde templates/.gitignore.template aunque el paquete de origen no tenga un .gitignore literal', () => {
  const contenidoTemplate = fs.readFileSync(path.join(RAIZ, 'templates', '.gitignore.template'), 'utf8');
  const paquete = crearPaqueteFixture(
    { common: ['.gitignore'], claude: [] },
    { 'templates/.gitignore.template': contenidoTemplate },
  );
  assert.ok(
    !fs.existsSync(path.join(paquete, '.gitignore')),
    'fixture invalido: no debe existir un .gitignore literal en el paquete (asi es como lo deja el bug de pacote)',
  );

  const proyecto = dirTemporal();
  const { codigo, stdout } = ejecutar(['install', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas copiadas/);
  assert.match(stdout, /Rutas copiadas:[\s\S]*- \.gitignore/, '.gitignore debe listarse en "Rutas copiadas"');
  const seccionSaltadas = stdout.split('Rutas saltadas')[1] || '';
  assert.doesNotMatch(seccionSaltadas, /- \.gitignore\b/, '.gitignore NO debe aparecer en "Rutas saltadas"');
  const destino = path.join(proyecto, '.gitignore');
  assert.ok(fs.existsSync(destino), '.gitignore debe existir en el destino tras install');
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), contenidoTemplate);
  const lineas = fs.readFileSync(destino, 'utf8').split('\n').filter((l) => l.length > 0);
  assert.ok(lineas.length > 10, '.gitignore instalado debe tener contenido real (>10 lineas), no vacio ni truncado');
});

'use strict';

// Contrato de bin/cli.js.
//
// El CLI se invoca via `npx github:gmoncor/agentic-engineering-framework
// install --backend <backend>` desde el directorio de un proyecto destino.
// Lo peligroso no es que falle: es que copie de mas (pisando ai_docs/core/
// o ai_docs/tasks/, que son del proyecto), que cuelgue esperando input en
// un pipe/CI, o que aborte al primer archivo ausente del manifiesto. Estos
// tests montan un PACKAGE_ROOT ficticio via SDD_FRAMEWORK_ROOT (sin red) y
// comprueban esos limites, siguiendo el mismo patron que
// tests/update-framework.test.js para el script hermano.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

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

function ejecutar(args, opts = {}) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd: opts.cwd,
      env: Object.assign({}, process.env, opts.env),
      input: opts.input,
      encoding: 'utf8',
    });
    return { codigo: 0, stdout };
  } catch (err) {
    return {
      codigo: err.status,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
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

test('sin subcomando muestra uso y sale sin error', () => {
  const { codigo, stdout } = ejecutar([], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: agentic-engineering-framework/);
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
      common: ['package.json', 'hooks'],
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

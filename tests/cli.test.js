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

test('install --backend claude es idempotente: ejecutarlo dos veces seguidas produce el mismo resultado', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: ['.claude'] },
    { 'CLAUDE.md': 'contexto', '.claude/agents/planificador.md': 'agente' },
  );
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { SDD_FRAMEWORK_ROOT: paquete } };

  const primera = ejecutar(['install', '--backend', 'claude'], opts);
  assert.strictEqual(primera.codigo, 0);
  const segunda = ejecutar(['install', '--backend', 'claude'], opts);
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

  const { codigo, stdout } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Rutas actualizadas/);
  assert.match(stdout, /Framework actualizado a la version/);
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

test('update sobre un directorio sin instalacion previa funciona como copia limpia', () => {
  const paquete = crearPaqueteFixture(
    { common: ['CLAUDE.md'], claude: ['.claude'] },
    { 'CLAUDE.md': 'contexto', '.claude/agents/planificador.md': 'agente' },
  );
  const proyecto = dirTemporal();

  const { codigo } = ejecutar(['update', '--backend', 'claude'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto');
  assert.ok(fs.existsSync(path.join(proyecto, '.claude', 'agents', 'planificador.md')));
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

  const { codigo } = ejecutar(['update', '--backend', 'all'], {
    cwd: proyecto,
    env: { SDD_FRAMEWORK_ROOT: paquete },
  });

  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, 'GEMINI.md')), 'debe anadir la ruta nueva de gemini');
  assert.ok(fs.existsSync(path.join(proyecto, 'AGENTS.md')), 'debe anadir la ruta nueva de codex');
  // CLAUDE.md ya existia sin haber pasado nunca por install/update (sin sidecar de
  // hashes previo): se trata como posible edicion local y no se sobrescribe.
  assert.strictEqual(fs.readFileSync(path.join(proyecto, 'CLAUDE.md'), 'utf8'), 'contexto viejo');
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'agente',
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
  // Proyecto pre-existente que nunca paso por install/update con sidecar de hashes.
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

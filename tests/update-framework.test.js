'use strict';

// Contrato de scripts/update-framework.sh.
//
// El script clona una version del framework y sobrescribe SOLO las rutas que
// le pertenecen. Lo peligroso no es que falle: es que copie de mas (pisando
// ai_docs/core/ o ai_docs/tasks/, que son del proyecto) o que rompa al
// reejecutarse. Estos tests montan un repo git local (sin red) via
// UPDATE_FRAMEWORK_REPO_URL y comprueban ambos limites.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'update-framework.sh');
const BASH_BIN = execFileSync('command', ['-v', 'bash'], { shell: '/bin/sh', encoding: 'utf8' }).trim();

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'update-framework-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Crea un repo git local con los archivos dados, como si fuera el upstream. */
function crearRepoUpstream(archivos) {
  const dir = dirTemporal();
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = path.join(dir, ruta);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
  }
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  return dir;
}

function ejecutar(args, opts = {}) {
  try {
    const stdout = execFileSync(BASH_BIN, [SCRIPT, ...args], {
      cwd: opts.cwd,
      env: Object.assign({}, process.env, opts.env),
      encoding: 'utf8',
    });
    return { codigo: 0, stdout };
  } catch (err) {
    return { codigo: err.status, stdout: err.stdout ? err.stdout.toString() : '', stderr: err.stderr ? err.stderr.toString() : '' };
  }
}

test('existe, es ejecutable y usa shebang bash POSIX', () => {
  const stat = fs.statSync(SCRIPT);
  assert.ok(stat.mode & 0o111, 'el script debe tener permiso de ejecucion');
  const primeraLinea = fs.readFileSync(SCRIPT, 'utf8').split('\n')[0];
  assert.strictEqual(primeraLinea, '#!/usr/bin/env bash');
});

test('sin argumentos muestra uso basico y sale sin error', () => {
  const { codigo, stdout } = ejecutar([], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: scripts\/update-framework\.sh/);
});

test('--help muestra uso basico y sale sin error', () => {
  const { codigo, stdout } = ejecutar(['--help'], { cwd: dirTemporal() });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /Uso: scripts\/update-framework\.sh/);
});

test('sin git instalado falla con mensaje claro', () => {
  const dirVacio = dirTemporal();
  const { codigo, stderr } = ejecutar(['main'], { cwd: dirTemporal(), env: { PATH: dirVacio } });
  assert.strictEqual(codigo, 1);
  assert.match(stderr, /git es necesario/);
});

test('upstream sin rutas del framework: no copia nada y no falla', () => {
  const upstream = crearRepoUpstream({ 'README.md': 'hola' });
  const proyecto = dirTemporal();
  const { codigo, stdout } = ejecutar(['main'], {
    cwd: proyecto,
    env: { UPDATE_FRAMEWORK_REPO_URL: `file://${upstream}` },
  });
  assert.strictEqual(codigo, 0);
  assert.match(stdout, /no contiene ninguna ruta del framework/);
  const restantes = fs.readdirSync(proyecto);
  assert.deepStrictEqual(restantes, []);
});

test('copia solo las rutas del framework y excluye ai_docs/core y ai_docs/tasks', () => {
  const upstream = crearRepoUpstream({
    '.claude/agents/planificador.md': 'contenido agente',
    'package.json': '{"name":"framework"}',
  });
  const proyecto = dirTemporal();
  fs.mkdirSync(path.join(proyecto, 'ai_docs', 'core'), { recursive: true });
  fs.mkdirSync(path.join(proyecto, 'ai_docs', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(proyecto, 'ai_docs', 'core', 'master_idea.md'), 'MIO');
  fs.writeFileSync(path.join(proyecto, 'ai_docs', 'tasks', '001_foo.md'), 'MIA');

  const { codigo, stdout } = ejecutar(['main'], {
    cwd: proyecto,
    env: { UPDATE_FRAMEWORK_REPO_URL: `file://${upstream}` },
  });

  assert.strictEqual(codigo, 0);
  assert.match(stdout, /\.claude/);
  assert.match(stdout, /package\.json/);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'contenido agente',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'ai_docs', 'core', 'master_idea.md'), 'utf8'),
    'MIO',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, 'ai_docs', 'tasks', '001_foo.md'), 'utf8'),
    'MIA',
  );
});

test('ruta ausente en el clon se salta sin abortar el resto', () => {
  const upstream = crearRepoUpstream({ 'CLAUDE.md': 'contexto' });
  const proyecto = dirTemporal();
  const { codigo, stdout } = ejecutar(['main'], {
    cwd: proyecto,
    env: { UPDATE_FRAMEWORK_REPO_URL: `file://${upstream}` },
  });
  assert.strictEqual(codigo, 0);
  assert.ok(fs.existsSync(path.join(proyecto, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(proyecto, '.claude')));
  assert.ok(!fs.existsSync(path.join(proyecto, 'hooks')));
});

test('es idempotente: ejecutarlo dos veces seguidas produce el mismo resultado', () => {
  const upstream = crearRepoUpstream({
    '.claude/agents/planificador.md': 'v1',
    'CLAUDE.md': 'contexto v1',
  });
  const proyecto = dirTemporal();
  const opts = { cwd: proyecto, env: { UPDATE_FRAMEWORK_REPO_URL: `file://${upstream}` } };

  const primera = ejecutar(['main'], opts);
  assert.strictEqual(primera.codigo, 0);
  const segunda = ejecutar(['main'], opts);
  assert.strictEqual(segunda.codigo, 0);

  const agentes = fs.readdirSync(path.join(proyecto, '.claude', 'agents'));
  assert.deepStrictEqual(agentes, ['planificador.md']);
  assert.strictEqual(
    fs.readFileSync(path.join(proyecto, '.claude', 'agents', 'planificador.md'), 'utf8'),
    'v1',
  );
});

test('no nombra al meta-repo ni jerga interna (anti-fuga)', () => {
  const contenido = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(contenido, /meta-repo|meta-task-planner|AI-Coding/i);
});

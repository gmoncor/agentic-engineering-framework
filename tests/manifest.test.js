'use strict';

// Verifica scripts/artifact-manifest.json y su validador (scripts/validate-manifest.js).
//
// Tres capas: (1) el manifiesto real contra el disco real del repo, para que un artefacto
// nuevo sin mapear o un output borrado rompan el test; (2) casos limite con fixtures
// aislados en un directorio temporal, para que las reglas del validador (source ausente,
// huerfano, output duplicado, preserve con transform invalido) no dependan del estado
// real del arbol, que otros cambios pueden mover; (3) el validador como subproceso real
// (node scripts/validate-manifest.js), para que main() traduzca la lista de errores a un
// codigo de salida y no solo a un valor de retorno que nadie ejercita fuera del CLI.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { cargarManifiesto, validarManifiesto, RAIZ, MANIFEST_PATH } = require('../scripts/validate-manifest');

const VALIDADOR_CLI = path.join(RAIZ, 'scripts', 'validate-manifest.js');

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-manifest-'));
}

function escribirArchivo(base, ruta, contenido = '') {
  const destino = path.join(base, ruta);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
}

test('el manifiesto real tiene al menos 30 artefactos', () => {
  const manifest = cargarManifiesto();
  assert.ok(
    manifest.artifacts.length >= 30,
    `esperaba >= 30 artefactos, encontro ${manifest.artifacts.length}`
  );
});

test('el manifiesto real pasa la validacion contra disco sin errores', () => {
  const manifest = cargarManifiesto();
  const errores = validarManifiesto(manifest, RAIZ);
  assert.deepStrictEqual(errores, []);
});

test('el manifiesto real declara transforms_registry con al menos un transform usado', () => {
  const manifest = cargarManifiesto();
  const transformsUsados = new Set(manifest.artifacts.map(a => a.transform));
  for (const transform of transformsUsados) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(manifest.transforms_registry, transform),
      `transform "${transform}" usado en un artefacto pero ausente de transforms_registry`
    );
  }
});

test('MANIFEST_PATH apunta al fichero real del repo', () => {
  assert.strictEqual(MANIFEST_PATH, path.join(RAIZ, 'scripts', 'artifact-manifest.json'));
  assert.ok(fs.existsSync(MANIFEST_PATH));
});

// main() nunca se invocaba como subproceso: los tests de arriba prueban validarManifiesto()
// importada, no la traduccion a codigo de salida que hace main(). MANIFEST_PATH se resuelve
// con __dirname (no con cwd ni con una variable de entorno), asi que el unico fixture roto
// que el subproceso real puede leer es una copia sin modificar del script junto a un
// artifact-manifest.json invalido en el mismo directorio temporal.
test('subproceso real: un manifiesto roto en un fixture aislado hace salir el validador con codigo distinto de cero', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, 'scripts/validate-manifest.js', fs.readFileSync(VALIDADOR_CLI, 'utf8'));
  escribirArchivo(raiz, 'scripts/artifact-manifest.json', JSON.stringify({
    transforms_registry: { none: 'sin transformacion' },
    artifacts: [
      { id: 'fantasma', source: '.claude/agents/fantasma.md', transform: 'none', mode: 'managed', outputs: [] }
    ]
  }));

  const ejecucion = spawnSync(process.execPath, [path.join(raiz, 'scripts', 'validate-manifest.js')], {
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.notStrictEqual(ejecucion.status, 0, ejecucion.stdout + ejecucion.stderr);
  assert.match(ejecucion.stderr, /SOURCE_NOT_FOUND/);
  assert.match(ejecucion.stderr, /fantasma/);
});

test('subproceso real: el manifiesto valido del repositorio hace salir el validador con 0', () => {
  const ejecucion = spawnSync(process.execPath, [VALIDADOR_CLI], {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.strictEqual(ejecucion.status, 0, ejecucion.stdout + ejecucion.stderr);
  assert.match(ejecucion.stdout, /Manifiesto valido: \d+ artefactos verificados contra disco\./);
});

test('caso limite: source ausente en disco falla con SOURCE_NOT_FOUND y nombra el path y la entrada', () => {
  const raiz = dirTemporal();
  const manifest = {
    transforms_registry: { none: 'sin transformacion' },
    artifacts: [
      { id: 'fantasma', source: '.claude/agents/fantasma.md', transform: 'none', mode: 'managed', outputs: [] }
    ]
  };

  const errores = validarManifiesto(manifest, raiz);

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0], /SOURCE_NOT_FOUND/);
  assert.match(errores[0], /\.claude\/agents\/fantasma\.md/);
  assert.match(errores[0], /fantasma/);
});

test('caso limite: fichero huerfano en un directorio de backend se reporta como ORPHAN_ARTIFACT', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido');
  escribirArchivo(raiz, '.gemini/skills/pr/SKILL.md', 'contenido');
  escribirArchivo(raiz, '.gemini/skills/huerfano/SKILL.md', 'nadie lo declara');

  const manifest = {
    transforms_registry: { 'skill-to-backend': 'adapta una skill por backend' },
    artifacts: [
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'skill-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/pr/SKILL.md' }]
      }
    ]
  };

  const errores = validarManifiesto(manifest, raiz);

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0], /ORPHAN_ARTIFACT/);
  assert.match(errores[0], /\.gemini\/skills\/huerfano\/SKILL\.md/);
});

test('caso limite: dos entradas con el mismo output.path fallan con DUPLICATE_OUTPUT nombrando ambas', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/commands/pr.md', 'contenido');
  escribirArchivo(raiz, '.claude/skills/pr/SKILL.md', 'contenido');
  escribirArchivo(raiz, '.agents/skills/pr/SKILL.md', 'contenido');

  const manifest = {
    transforms_registry: {
      'command-to-backend': 'convierte un comando por backend',
      'skill-to-backend': 'adapta una skill por backend'
    },
    artifacts: [
      {
        id: 'command-pr',
        source: '.claude/commands/pr.md',
        transform: 'command-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'antigravity', path: '.agents/skills/pr/SKILL.md' }]
      },
      {
        id: 'skill-pr',
        source: '.claude/skills/pr/SKILL.md',
        transform: 'skill-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'antigravity', path: '.agents/skills/pr/SKILL.md' }]
      }
    ]
  };

  const errores = validarManifiesto(manifest, raiz);

  const duplicados = errores.filter(e => e.includes('DUPLICATE_OUTPUT'));
  assert.strictEqual(duplicados.length, 1);
  assert.match(duplicados[0], /\.agents\/skills\/pr\/SKILL\.md/);
  assert.match(duplicados[0], /command-pr/);
  assert.match(duplicados[0], /skill-pr/);
});

test('caso limite: mode preserve con transform distinto de identity/none se rechaza', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.codex/config.toml', 'contenido');

  const manifest = {
    transforms_registry: {
      none: 'sin transformacion',
      'command-to-backend': 'convierte un comando por backend'
    },
    artifacts: [
      {
        id: 'codex-config',
        source: '.codex/config.toml',
        transform: 'command-to-backend',
        mode: 'preserve',
        outputs: [{ backend: 'codex', path: '.codex/config.toml' }]
      }
    ]
  };

  const errores = validarManifiesto(manifest, raiz);

  assert.strictEqual(errores.length, 1);
  assert.match(errores[0], /INVALID_PRESERVE_TRANSFORM/);
  assert.match(errores[0], /codex-config/);
});

test('caso limite: output con status "pending" no exige que el fichero exista en disco', () => {
  const raiz = dirTemporal();
  escribirArchivo(raiz, '.claude/skills/nueva/SKILL.md', 'contenido');

  const manifest = {
    transforms_registry: { 'skill-to-backend': 'adapta una skill por backend' },
    artifacts: [
      {
        id: 'skill-nueva',
        source: '.claude/skills/nueva/SKILL.md',
        transform: 'skill-to-backend',
        mode: 'managed',
        outputs: [{ backend: 'gemini', path: '.gemini/skills/nueva/SKILL.md', status: 'pending' }]
      }
    ]
  };

  const errores = validarManifiesto(manifest, raiz);

  assert.deepStrictEqual(errores, []);
});

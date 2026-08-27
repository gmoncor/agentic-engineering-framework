'use strict';

// Contrato de purga en hooks/sdd-read-tracker.js: trackRead() escribe el
// rastreador de lecturas de la sesion actual y, oportunistamente, purga
// ficheros sdd-reads-*.json de otras sesiones con mas de 24h sin actividad
// (mismo mecanismo que sdd-turn-budget.js, via purgeExpired en
// sdd-hook-utils.js).
//
// sdd-read-tracker.js no es un hook standalone (no tiene shebang, lo importa
// sdd-read-before-edit.js), asi que se requiere directamente y se redirige
// SDD_READS_DIR por variable de entorno, igual que hace el hook que lo usa.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function tempReadsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-reads-test-'));
}

function conMtime(file, msAtras) {
  const t = (Date.now() - msAtras) / 1000;
  fs.utimesSync(file, t, t);
}

// sdd-read-tracker.js lee SDD_READS_DIR al vuelo (readsDir()), asi que basta
// con fijar la variable de entorno antes de llamar; no hace falta recargar
// el modulo entre tests.
function conReadsDir(dir, fn) {
  const previo = process.env.SDD_READS_DIR;
  process.env.SDD_READS_DIR = dir;
  try {
    return fn();
  } finally {
    if (previo === undefined) delete process.env.SDD_READS_DIR;
    else process.env.SDD_READS_DIR = previo;
  }
}

const { trackRead, loadReads, hasRead } = require('../sdd-read-tracker');
const TRACKER_MODULE = require.resolve('../sdd-read-tracker');

test('trackRead: al registrar una lectura, purga ficheros sdd-reads-* de otras sesiones con mas de 24h', () => {
  const dir = tempReadsDir();
  const viejo = path.join(dir, 'sdd-reads-sesion-vieja.jsonl');
  fs.writeFileSync(viejo, JSON.stringify('/algo') + '\n');
  conMtime(viejo, 25 * 60 * 60 * 1000);

  try {
    conReadsDir(dir, () => trackRead('sesion-actual', path.join(dir, 'archivo.js')));
    assert.strictEqual(fs.existsSync(viejo), false, 'el rastreador de la sesion vieja debe purgarse');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trackRead: NO purga ficheros de otras sesiones dentro del TTL', () => {
  const dir = tempReadsDir();
  const reciente = path.join(dir, 'sdd-reads-sesion-reciente.jsonl');
  fs.writeFileSync(reciente, JSON.stringify('/algo') + '\n');
  conMtime(reciente, 60 * 60 * 1000); // 1h

  try {
    conReadsDir(dir, () => trackRead('sesion-actual', path.join(dir, 'archivo.js')));
    assert.strictEqual(fs.existsSync(reciente), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trackRead: no purga el rastreador de la sesion actual que se acaba de escribir', () => {
  const dir = tempReadsDir();
  try {
    conReadsDir(dir, () => trackRead('sesion-actual', path.join(dir, 'archivo.js')));
    const actual = path.join(dir, 'sdd-reads-sesion-actual.jsonl');
    assert.strictEqual(fs.existsSync(actual), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trackRead: sin rastreadores previos -> no lanza, registra la lectura con normalidad', () => {
  const dir = tempReadsDir();
  try {
    assert.doesNotThrow(() => {
      conReadsDir(dir, () => trackRead('sesion-actual', path.join(dir, 'archivo.js')));
    });
    const raw = fs.readFileSync(path.join(dir, 'sdd-reads-sesion-actual.jsonl'), 'utf8');
    const rutas = raw.trim().split('\n').map((linea) => JSON.parse(linea));
    assert.ok(rutas.includes(path.resolve(path.join(dir, 'archivo.js'))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Carrera real: sin el anexado, 20 procesos que parten del mismo estado inicial
// solo dejan sobrevivir la ultima escritura. Se lanzan procesos de verdad (no
// una simulacion dentro del mismo proceso) porque una carrera de
// leer-modificar-escribir no se observa sin sistema de ficheros y planificador
// real de por medio.
test('trackRead: 20 procesos reales concurrentes registrando 20 rutas distintas de la misma sesion -> las 20 constan', async () => {
  const dir = tempReadsDir();
  const N = 20;
  try {
    const runs = [];
    for (let i = 0; i < N; i++) {
      const target = path.join(dir, 'f' + i + '.js');
      runs.push(new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['-e', "require(process.env.TRACKER_MODULE).trackRead('racetest', process.env.TARGET_FILE)"],
          {
            env: Object.assign({}, process.env, {
              SDD_READS_DIR: dir,
              TRACKER_MODULE,
              TARGET_FILE: target,
            }),
          },
        );
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('trackRead process exit ' + code))));
      }));
    }
    await Promise.all(runs);

    const leidas = conReadsDir(dir, () => loadReads('racetest'));
    assert.strictEqual(leidas.size, N, 'las ' + N + ' lecturas concurrentes deben constar, ninguna perdida por carrera');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hasRead: false para una ruta nunca leida', () => {
  const dir = tempReadsDir();
  try {
    conReadsDir(dir, () => {
      assert.strictEqual(hasRead('sesion-actual', path.join(dir, 'nunca-leido.js')), false);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hasRead: true para una ruta leida', () => {
  const dir = tempReadsDir();
  const archivo = path.join(dir, 'leido.js');
  try {
    conReadsDir(dir, () => {
      trackRead('sesion-actual', archivo);
      assert.strictEqual(hasRead('sesion-actual', archivo), true);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadReads: null cuando no hay fichero de estado', () => {
  const dir = tempReadsDir();
  try {
    conReadsDir(dir, () => {
      assert.strictEqual(loadReads('sesion-sin-lecturas'), null);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

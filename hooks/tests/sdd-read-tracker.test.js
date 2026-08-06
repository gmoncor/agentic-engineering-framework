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

const { trackRead } = require('../sdd-read-tracker');

test('trackRead: al registrar una lectura, purga ficheros sdd-reads-* de otras sesiones con mas de 24h', () => {
  const dir = tempReadsDir();
  const viejo = path.join(dir, 'sdd-reads-sesion-vieja.json');
  fs.writeFileSync(viejo, JSON.stringify(['/algo']));
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
  const reciente = path.join(dir, 'sdd-reads-sesion-reciente.json');
  fs.writeFileSync(reciente, JSON.stringify(['/algo']));
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
    const actual = path.join(dir, 'sdd-reads-sesion-actual.json');
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
    const actual = JSON.parse(fs.readFileSync(path.join(dir, 'sdd-reads-sesion-actual.json'), 'utf8'));
    assert.ok(actual.includes(path.resolve(path.join(dir, 'archivo.js'))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

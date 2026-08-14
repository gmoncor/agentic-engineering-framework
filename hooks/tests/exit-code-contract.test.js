'use strict';

// Acredita el contrato de canal de salida documentado en hooks/CONVENTIONS.md:
// ningun hook usa `exit 1` (explicito o implicito via `throw` sin capturar) para
// comunicar un veredicto, y los avisos viajan por stderr, no por stdout.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');

const HOOKS_DIR = path.resolve(__dirname, '..');

// Suelo de la enumeracion de hooks. Estos tests acreditan una AUSENCIA (ningun exit 1,
// ningun throw suelto), y una ausencia sobre una lista vacia se cumple sola: si la
// enumeracion se rompe (directorio mal resuelto, filtro roto), el test sigue en verde sin
// haber leido un solo fichero.
const MIN_HOOK_FILES = 10;

// Todos los .js del directorio de hooks, sin lista fija: un hook nuevo entra
// automaticamente en la cobertura de este test.
function hookFiles() {
  return fs.readdirSync(HOOKS_DIR).filter((name) => {
    const full = path.join(HOOKS_DIR, name);
    return name.endsWith('.js') && fs.statSync(full).isFile();
  });
}

// Devuelve, de la mas cercana a la mas lejana, la linea que abre cada bloque
// `{...}` que envuelve la posicion `idx` del fuente.
function enclosingHeaders(source, idx) {
  const headers = [];
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === '}') { depth++; continue; }
    if (ch !== '{') continue;
    if (depth > 0) { depth--; continue; }
    const lineStart = source.lastIndexOf('\n', i) + 1;
    headers.push(source.slice(lineStart, i + 1));
  }
  return headers;
}

// Un punto de entrada async invocado como `nombre().catch(...)` degrada
// cualquier throw o exit(1) que ocurra dentro de su cuerpo a lo que decida
// ese `.catch`, igual que un catch local. Heuristica textual: solo reconoce
// el punto de entrada cuando el throw/exit esta anidado DIRECTAMENTE dentro
// de su cuerpo, no en una funcion auxiliar sincrona llamada desde ahi; una
// funcion auxiliar que puede lanzar debe capturar localmente.
function wrappedByEntryPointCatch(source, headers) {
  const asyncHeader = headers.find((h) => /\basync\s+function\s+\w+/.test(h));
  if (!asyncHeader) return false;
  const name = asyncHeader.match(/\basync\s+function\s+(\w+)/)[1];
  return new RegExp('\\b' + name + '\\(\\)\\s*\\.catch\\(').test(source);
}

function isGuardedExit1(source, headers) {
  return headers.some((h) => /\bcatch\s*\(/.test(h)) || wrappedByEntryPointCatch(source, headers);
}

function isGuardedThrow(source, headers) {
  return headers.some((h) => /\btry\b/.test(h) || /\bcatch\s*\(/.test(h))
    || wrappedByEntryPointCatch(source, headers);
}

function lineOf(source, idx) {
  return source.slice(0, idx).split('\n').length;
}

// Localiza cada match de `pattern` en `source` y reporta los que `isGuarded`
// no reconoce como una rama de error interno.
function violations(source, pattern, isGuarded) {
  const found = [];
  const re = new RegExp(pattern.source, 'g');
  let m;
  while ((m = re.exec(source))) {
    if (!isGuarded(source, enclosingHeaders(source, m.index))) found.push(lineOf(source, m.index));
  }
  return found;
}

const exitViolations = (source) => violations(source, /process\.exit\(1\)/, isGuardedExit1);
const throwViolations = (source) => violations(source, /\bthrow\b/, isGuardedThrow);

test('CONVENTIONS.md documenta los cuatro canales de salida', () => {
  const doc = fs.readFileSync(path.join(HOOKS_DIR, 'CONVENTIONS.md'), 'utf8');
  assert.match(doc, /exit 2/);
  assert.match(doc, /exit 0/);
  assert.match(doc, /exit 1/);
  assert.match(doc, /stderr/);
});

test('el clasificador distingue exit(1) de veredicto del exit(1) capturado', () => {
  const veredicto = 'function f(bad) {\n  if (bad) {\n    process.exit(1);\n  }\n}\n';
  const capturado = 'function f() {\n  try {\n    riesgo();\n  } catch (err) {\n    process.exit(1);\n  }\n}\n';
  assert.strictEqual(exitViolations(veredicto).length, 1);
  assert.strictEqual(exitViolations(capturado).length, 0);
});

test('el clasificador distingue throw suelto del throw envuelto en try/catch', () => {
  const suelto = 'function f(bad) {\n  if (bad) {\n    throw new Error("x");\n  }\n}\n';
  const capturado = 'function f() {\n  try {\n    throw new Error("x");\n  } catch (err) {\n    process.exit(0);\n  }\n}\n';
  assert.strictEqual(throwViolations(suelto).length, 1);
  assert.strictEqual(throwViolations(capturado).length, 0);
});

function assertCoberturaSuficiente(files) {
  assert.ok(files.length >= MIN_HOOK_FILES,
    'la enumeracion encontro ' + files.length + ' hooks, minimo ' + MIN_HOOK_FILES
    + ': una ausencia sobre una lista vacia se cumple sola');
}

test('ningun hook usa process.exit(1) fuera de una rama de error interno', () => {
  const files = hookFiles();
  assertCoberturaSuficiente(files);

  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(HOOKS_DIR, file), 'utf8');
    exitViolations(source).forEach((line) => offenders.push(file + ':' + line));
  }
  assert.deepStrictEqual(offenders, []);
});

test('ningun hook lanza throw sin try/catch que lo envuelva', () => {
  const files = hookFiles();
  assertCoberturaSuficiente(files);

  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(HOOKS_DIR, file), 'utf8');
    throwViolations(source).forEach((line) => offenders.push(file + ':' + line));
  }
  assert.deepStrictEqual(offenders, []);
});

test('cada hook con contrato de entrada responde 0 o 2 ante input invalido, nunca 1', () => {
  const entryPoints = hookFiles().filter((file) => {
    const source = fs.readFileSync(path.join(HOOKS_DIR, file), 'utf8');
    return /readPayload\(\)/.test(source);
  });
  assert.ok(entryPoints.length > 0, 'no se encontro ningun hook con contrato de entrada');

  for (const file of entryPoints) {
    const vacio = runHook(file, {});
    const invalido = runHook(file, { tool_name: '__invalido__', tool_input: null, session_id: 's' });
    for (const r of [vacio, invalido]) {
      assert.notStrictEqual(r.code, 1, file + ' respondio exit 1 ante input invalido');
      assert.ok(r.code === 0 || r.code === 2, file + ' exit code inesperado: ' + r.code);
    }
  }
});

test('un aviso llega por stderr, no por stdout', () => {
  const dir = tempDir('sdd-exit-contract-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify({ sdd_review_gate: { enabled: true } }));
  const env = { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_GUARD_SKIP: '1' };
  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, session_id: 'sesion-canal' };

  const r = runHook('sdd-review-gate.js', payload, env);

  assert.strictEqual(r.code, 0);
  assert.ok(r.stderr && r.stderr.trim().length > 0, 'el aviso debe llegar por stderr');
});

'use strict';

// Invariantes de seguridad de los hooks .js: previenen que un proceso de hook se
// quede colgado o se ejecute sin querer al importarlo. Cuatro invariantes:
//   1. spawnSync/execSync siempre declaran timeout dentro de un rango seguro
//      (git bloqueado por antivirus, GC o lock cuelga el proceso sin timeout).
//   2. Todo setTimeout de arranque llama a .unref() para no retener el proceso
//      vivo mas alla del timeout previsto.
//   3. La constante de timeout de stdin (STDIN_TIMEOUT_MS o equivalente) no
//      supera el umbral seguro.
//   4. Toda invocacion de arranque a nivel de modulo esta guardada por
//      `require.main === module`: importar el fichero no debe ejecutarlo.
//
// Cada invariante trae su control positivo: un fixture sintetico que inyecta la
// violacion que el detector dice vigilar. Un detector sin ese control puede estar
// comprobando una condicion imposible o un fichero vacio sin que nadie lo note.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HOOKS_DIR = path.resolve(__dirname, '..');
const MAX_TIMEOUT_MS = 10000;

// Elimina comentarios de linea y de bloque preservando literales de cadena, para
// que un spawnSync comentado (codigo muerto) no cuente como llamada real.
function stripComments(src) {
  let out = '';
  let inString = null;
  let inBlockComment = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') { out += next; i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; out += c; continue; }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    out += c;
  }
  return out;
}

function listHookFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name);
}

function getHookSource(filename) {
  return fs.readFileSync(path.join(HOOKS_DIR, filename), 'utf8');
}

// Extrae el bloque entre parentesis balanceados que empieza en openIndex (src[openIndex] === '(').
function extractBalancedBlock(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(openIndex, i + 1);
    }
  }
  return src.slice(openIndex);
}

// Invariante 1: toda llamada a spawnSync/execSync declara `timeout:` con un valor
// entre 1 y MAX_TIMEOUT_MS, dentro del propio bloque de opciones (no en cualquier
// parte de la linea).
const SPAWN_CALL_RE = /\b(spawnSync|execSync)\s*\(/g;

function findTimeoutViolations(src) {
  const clean = stripComments(src);
  const violations = [];
  let checked = 0;
  let match;
  SPAWN_CALL_RE.lastIndex = 0;
  while ((match = SPAWN_CALL_RE.exec(clean)) !== null) {
    checked++;
    const openIndex = match.index + match[0].length - 1;
    const block = extractBalancedBlock(clean, openIndex);
    const timeoutMatch = block.match(/timeout\s*:\s*(\d+)/);
    const value = timeoutMatch ? parseInt(timeoutMatch[1], 10) : null;
    if (value === null || value <= 0 || value > MAX_TIMEOUT_MS) {
      const line = clean.slice(0, match.index).split('\n').length;
      violations.push(`${match[1]}() sin timeout valido (linea ${line})`);
    }
  }
  return { checked, violations };
}

// Invariante 2: todo setTimeout de arranque llama a .unref() dentro de la misma
// funcion que lo declara.
const SET_TIMEOUT_RE = /\bsetTimeout\s*\(/g;

function extractEnclosingFunction(src, matchIndex) {
  const fnIndex = src.slice(0, matchIndex).lastIndexOf('function');
  const braceStart = src.indexOf('{', fnIndex === -1 ? matchIndex : fnIndex);
  if (braceStart === -1) return src.slice(matchIndex, matchIndex + 400);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return src.slice(braceStart);
}

function findUnrefViolations(src) {
  const clean = stripComments(src);
  const violations = [];
  let checked = 0;
  let match;
  SET_TIMEOUT_RE.lastIndex = 0;
  while ((match = SET_TIMEOUT_RE.exec(clean)) !== null) {
    checked++;
    const block = extractEnclosingFunction(clean, match.index);
    if (!/\.unref\s*\(\s*\)/.test(block)) {
      const line = clean.slice(0, match.index).split('\n').length;
      violations.push(`setTimeout sin .unref() (linea ${line})`);
    }
  }
  return { checked, violations };
}

// Invariante 3: la constante de timeout de stdin (nombre que contiene STDIN y
// TIMEOUT, en cualquier orden) no supera MAX_TIMEOUT_MS.
const STDIN_TIMEOUT_RE = /\b(\w*(?:STDIN\w*TIMEOUT|TIMEOUT\w*STDIN)\w*)\s*=\s*(\d+)/i;

function findStdinTimeoutViolations(src) {
  const clean = stripComments(src);
  const match = STDIN_TIMEOUT_RE.exec(clean);
  if (!match) return { checked: 0, violations: [] };
  const value = parseInt(match[2], 10);
  const violations = value > MAX_TIMEOUT_MS ? [`${match[1]} = ${value} supera ${MAX_TIMEOUT_MS}ms`] : [];
  return { checked: 1, violations };
}

// Invariante 4: la invocacion de arranque solo corre cuando el fichero se ejecuta
// directamente. Lo que la invariante previene es concreto: importar el hook desde
// otro fichero (o desde un test) ejecutaria su funcion principal.
//
// Se comprueban las dos mitades, porque cumplir una sin la otra no protege nada:
//   (a) ninguna llamada a nivel de modulo (columna 0) queda suelta;
//   (b) toda invocacion de arranque indentada vive DENTRO de un bloque abierto por
//       `if (require.main === module)`. Estar indentado no es la invariante:
//       sustituir esa condicion por una siempre cierta deja la llamada indentada e
//       igual de desprotegida, y la cadena desaparece del fichero sin dejar rastro.
const BOOTSTRAP_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'class',
  'else', 'try', 'do', 'with', 'async', 'new', 'await', 'yield', 'typeof',
  'void', 'delete', 'in', 'of', 'instanceof', 'export', 'import',
  'const', 'let', 'var',
]);

// Puntos de entrada de arranque de los hooks: el envoltorio de fallo seguro y la
// invocacion directa de main().
const BOOTSTRAP_ENTRY_RE = /^([ \t]*)(runWithFailOpen|main)\s*\(/gm;
const GUARD_OPEN_RE = /if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{/g;

// Rango [apertura, cierre] del cuerpo de cada guarda `require.main === module` del
// fichero, con las llaves balanceadas: una invocacion cuenta como guardada solo si
// su posicion cae dentro de uno de estos rangos.
function guardedRanges(src) {
  const ranges = [];
  let match;
  GUARD_OPEN_RE.lastIndex = 0;
  while ((match = GUARD_OPEN_RE.exec(src)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) { ranges.push([open, i]); break; }
      }
    }
  }
  return ranges;
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function findUnguardedBootstrapCalls(src) {
  const clean = stripComments(src);
  const guardadas = guardedRanges(clean);
  const violations = [];
  let checked = 0;

  clean.split(/\r?\n/).forEach((line, idx) => {
    const callMatch = line.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (!callMatch || BOOTSTRAP_KEYWORDS.has(callMatch[1])) return;
    checked++;
    violations.push(`${callMatch[1]}() en linea ${idx + 1} sin guarda require.main`);
  });

  let match;
  BOOTSTRAP_ENTRY_RE.lastIndex = 0;
  while ((match = BOOTSTRAP_ENTRY_RE.exec(clean)) !== null) {
    if (match[1] === '') continue; // columna 0: ya contada arriba
    checked++;
    const idx = match.index + match[1].length;
    if (!guardadas.some(([open, close]) => idx > open && idx < close)) {
      violations.push(`${match[2]}() en linea ${lineAt(clean, idx)} fuera de la guarda require.main === module`);
    }
  }

  return { checked, violations };
}

// ─── Deteccion sobre el codigo real ──────────────────────────────────────────

// Aplica un detector a todos los hooks del directorio real y agrega sus resultados.
function runInvariant(finder) {
  const violations = [];
  let checked = 0;
  for (const file of listHookFiles(HOOKS_DIR)) {
    const result = finder(getHookSource(file));
    checked += result.checked;
    result.violations.forEach(v => violations.push(`${file}: ${v}`));
  }
  return { checked, violations };
}

test('invariante 1: spawnSync/execSync declaran timeout dentro de rango seguro', () => {
  const { checked, violations } = runInvariant(findTimeoutViolations);
  assert.ok(checked > 0, 'invariante vacuo: ningun hook invoca spawnSync/execSync');
  assert.deepStrictEqual(violations, []);
});

test('invariante 2: todo setTimeout de arranque llama a .unref()', () => {
  const { checked, violations } = runInvariant(findUnrefViolations);
  assert.ok(checked > 0, 'invariante vacuo: ningun hook declara setTimeout');
  assert.deepStrictEqual(violations, []);
});

test('invariante 3: la constante de timeout de stdin no supera el umbral seguro', () => {
  const { checked, violations } = runInvariant(findStdinTimeoutViolations);
  assert.ok(checked > 0, 'invariante vacuo: ningun hook declara una constante de timeout de stdin');
  assert.deepStrictEqual(violations, []);
});

test('invariante 4: toda invocacion de arranque a nivel de modulo esta guardada por require.main', () => {
  const { checked, violations } = runInvariant(findUnguardedBootstrapCalls);
  assert.ok(checked > 0, 'invariante vacuo: ningun hook declara una invocacion de arranque');
  assert.deepStrictEqual(violations, []);
});

// ─── Controles positivos (anti-test-vacuo) ───────────────────────────────────
// Cada control inyecta la violacion que el detector dice vigilar y verifica que
// la detecta; despues corrige el fixture y verifica que la acepta. Sin este par,
// un detector que nunca ha visto fallar no acredita nada.

test('control positivo 1a: spawnSync sin timeout se detecta; con timeout se acepta', () => {
  const violation = findTimeoutViolations(`spawnSync('git', ['status'], { encoding: 'utf8' });`);
  assert.strictEqual(violation.violations.length, 1, 'spawnSync sin timeout debe marcarse');

  const fixed = findTimeoutViolations(`spawnSync('git', ['status'], { encoding: 'utf8', timeout: 5000 });`);
  assert.deepStrictEqual(fixed.violations, [], 'spawnSync con timeout valido no debe marcarse');
});

test('control positivo 1b: execSync sin timeout tambien se detecta (no solo spawnSync)', () => {
  const violation = findTimeoutViolations(`const out = execSync('gh pr list');`);
  assert.strictEqual(violation.violations.length, 1, 'execSync sin timeout debe marcarse igual que spawnSync');

  const fixed = findTimeoutViolations(`const out = execSync('gh pr list', { timeout: 3000 });`);
  assert.deepStrictEqual(fixed.violations, [], 'execSync con timeout valido no debe marcarse');
});

test('control positivo 1c: timeout fuera del bloque de opciones no cuenta (especificidad)', () => {
  // "timeout" aparece en la misma linea pero fuera de los parentesis de spawnSync:
  // un detector que busque la palabra en cualquier parte de la linea la aceptaria
  // por error. El detector real solo mira dentro del bloque balanceado de la llamada.
  const src = `spawnSync('git', ['status']); const timeout = 5000;`;
  const result = findTimeoutViolations(src);
  assert.strictEqual(result.violations.length, 1, 'timeout fuera del bloque de la llamada no exime la violacion');
});

test('control positivo 1d: spawnSync comentado (codigo muerto) no genera falso positivo', () => {
  const src = `// const r = spawnSync('git', ['status']);\nconst x = 1;`;
  const result = findTimeoutViolations(src);
  assert.strictEqual(result.checked, 0, 'una llamada solo presente en un comentario no debe examinarse');
  assert.deepStrictEqual(result.violations, []);
});

test('control positivo 2: setTimeout sin .unref() se detecta; con .unref() se acepta', () => {
  const violationSrc = 'function readPayload() {\n  const timer = setTimeout(resolve, 5000);\n}\n';
  const violation = findUnrefViolations(violationSrc);
  assert.strictEqual(violation.violations.length, 1, 'setTimeout sin .unref() debe marcarse');

  const fixedSrc = 'function readPayload() {\n  const timer = setTimeout(resolve, 5000);\n  timer.unref();\n}\n';
  const fixed = findUnrefViolations(fixedSrc);
  assert.deepStrictEqual(fixed.violations, [], 'setTimeout con .unref() en la misma funcion no debe marcarse');
});

test('control positivo 3: constante de timeout de stdin por encima del umbral se detecta', () => {
  const violation = findStdinTimeoutViolations('const STDIN_TIMEOUT_MS = 15000;');
  assert.strictEqual(violation.violations.length, 1, 'STDIN_TIMEOUT_MS por encima de 10000ms debe marcarse');

  const fixed = findStdinTimeoutViolations('const STDIN_TIMEOUT_MS = 5000;');
  assert.deepStrictEqual(fixed.violations, [], 'STDIN_TIMEOUT_MS dentro del umbral no debe marcarse');
});

test('control positivo 4: invocacion desnuda se marca; invocacion guardada se acepta', () => {
  const nakedSrc = 'function main() {}\n\nmain().catch(() => process.exit(0));\n';
  const naked = findUnguardedBootstrapCalls(nakedSrc);
  assert.strictEqual(naked.violations.length, 1, 'main() en columna 0 fuera de guarda debe marcarse');

  const guardedSrc = 'function main() {}\n\nif (require.main === module) {\n  main().catch(() => process.exit(0));\n}\n';
  const guarded = findUnguardedBootstrapCalls(guardedSrc);
  assert.deepStrictEqual(guarded.violations, [], 'main() indentado dentro de require.main === module debe aceptarse');

  const libSrc = 'function helper(x) { return x; }\n\nmodule.exports = { helper };\n';
  const lib = findUnguardedBootstrapCalls(libSrc);
  assert.deepStrictEqual(lib.violations, [], 'un modulo sin invocacion de arranque no debe marcarse');
  assert.strictEqual(lib.checked, 0, 'un modulo sin arranque no aporta nada al recuento');
});

// El mutante que la version anterior del detector no veia: la guarda sustituida por una
// condicion siempre cierta. La cadena require.main === module desaparece del fichero, el
// arranque sigue indentado, y el hook vuelve a ejecutarse al importarlo.
test('control positivo 4b: guarda sustituida por una condicion siempre cierta se marca', () => {
  const mutante = "function main() {}\n\nif (true) {\n  runWithFailOpen('hook', main);\n}\n";
  const roto = findUnguardedBootstrapCalls(mutante);
  assert.strictEqual(roto.violations.length, 1,
    'sin la cadena require.main === module el arranque esta desprotegido, este indentado o no');
  assert.strictEqual(roto.checked, 1, 'el arranque indentado debe contarse como examinado');

  const guardado = "function main() {}\n\nif (require.main === module) {\n  runWithFailOpen('hook', main);\n}\n";
  const bien = findUnguardedBootstrapCalls(guardado);
  assert.deepStrictEqual(bien.violations, [], 'el arranque dentro de la guarda debe aceptarse');
  assert.strictEqual(bien.checked, 1);
});

test('control positivo 4c: guarda invertida se marca; arranque anidado dentro de la guarda se acepta', () => {
  const invertida = "function main() {}\n\nif (require.main !== module) {\n  main().catch(() => {});\n}\n";
  assert.strictEqual(findUnguardedBootstrapCalls(invertida).violations.length, 1,
    'require.main !== module ejecuta el arranque justo cuando el fichero se importa');

  const anidado = 'function main() {}\n\nif (require.main === module) {\n'
    + "  if (process.argv.includes('--help')) {\n    process.exit(0);\n  }\n"
    + '  main().catch(() => process.exit(0));\n}\n';
  const r = findUnguardedBootstrapCalls(anidado);
  assert.deepStrictEqual(r.violations, [],
    'un arranque anidado en un bloque interior sigue estando dentro de la guarda');
  assert.strictEqual(r.checked, 1);
});

test('control positivo 5: el listado de hooks es dinamico, no una lista fija', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hook-safety-'));
  try {
    fs.writeFileSync(path.join(tmp, 'hook-nuevo-sin-precedente.js'), 'module.exports = {};\n');
    fs.writeFileSync(path.join(tmp, 'notas.md'), 'no es un hook');
    const files = listHookFiles(tmp);
    assert.ok(files.includes('hook-nuevo-sin-precedente.js'),
      'un .js anadido sin aviso previo debe aparecer sin tocar el detector');
    assert.ok(!files.includes('notas.md'), 'un fichero no-.js no debe listarse como hook');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

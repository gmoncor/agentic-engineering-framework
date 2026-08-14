'use strict';

// Acredita el fail-open por clase de error: un hook que falla POR DENTRO nunca se lee como un
// veredicto. Dos clases distintas que antes salian igual de indistinguibles:
//   - fallo interno (dependencia caida, estado ilegible, bug): exit 0 + [SDD_INTERNAL_ERROR].
//   - veredicto deliberado (deny): exit 2, intacto; el envoltorio no lo reescribe.
//
// El envoltorio se prueba de dos formas: sobre fixtures sinteticos que provocan el fallo a
// voluntad (imposible de forzar en un hook real sin romperlo), y sobre los hooks reales, donde
// se comprueba que su veredicto sigue saliendo por el canal de siempre.

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');
const { listBlockingHooks, MIN_BLOCKING_HOOKS } = require('./blocking-hooks');

const HOOKS_DIR = path.resolve(__dirname, '..');
const UTILS = JSON.stringify(path.join(HOOKS_DIR, 'sdd-hook-utils'));

// Los hooks que emiten un veredicto de bloqueo. Todos deben entrar por el envoltorio: son los
// unicos cuyo fallo interno podria confundirse con un exit 2 deliberado.
//
// La lista se DERIVA de disco (blocking-hooks.js), no se escribe. Escrita a mano dejaba pasar
// dos cosas sin que nada fallara: un hook bloqueante nuevo que nadie anadia a la lista, y la
// lista vaciada por completo (recorrer cero elementos no falla nunca).
const HOOKS_BLOQUEANTES = listBlockingHooks(HOOKS_DIR);

// Ejecuta un fixture sintetico como proceso real: el fail-open solo se acredita observando el
// codigo de salida del proceso, no el retorno de una funcion.
function runFixture(cuerpo) {
  const dir = tempDir('sdd-fail-open-');
  const file = writeFile(path.join(dir, 'fixture.js'),
    "'use strict';\nconst { runWithFailOpen, deny } = require(" + UTILS + ');\n' + cuerpo + '\n');

  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 10000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('fallo sincrono dentro del hook -> exit 0 y firma de fallo interno', () => {
  const r = runFixture("runWithFailOpen('hook-ficticio', () => { throw new Error('config ilegible'); });");

  assert.strictEqual(r.code, 0, 'un fallo interno nunca puede salir con codigo de bloqueo');
  assert.match(r.stderr, /\[SDD_INTERNAL_ERROR\]/);
  assert.match(r.stderr, /config ilegible/, 'el aviso debe llevar la causa');
  assert.match(r.stderr, /hook-ficticio/, 'el aviso debe nombrar el hook que fallo');
});

test('promesa rechazada dentro del hook -> exit 0 y firma de fallo interno', () => {
  const r = runFixture("runWithFailOpen('hook-async', async () => { await null; throw new Error('git no responde'); });");

  assert.strictEqual(r.code, 0);
  assert.match(r.stderr, /\[SDD_INTERNAL_ERROR\]/);
  assert.match(r.stderr, /git no responde/);
});

test('valor lanzado que no es Error -> el aviso sigue llevando causa legible', () => {
  const r = runFixture("runWithFailOpen('hook-raro', () => { throw 'cadena suelta'; });");

  assert.strictEqual(r.code, 0);
  assert.match(r.stderr, /\[SDD_INTERNAL_ERROR\] hook-raro: cadena suelta/);
});

test('veredicto deliberado dentro del envoltorio -> exit 2, sin firma de fallo interno', () => {
  const r = runFixture("runWithFailOpen('hook-que-bloquea', () => { deny('SDD: motivo del bloqueo'); });");

  assert.strictEqual(r.code, 2, 'el envoltorio no puede degradar un bloqueo deliberado');
  assert.doesNotMatch(r.stderr, /\[SDD_INTERNAL_ERROR\]/);
  assert.strictEqual(JSON.parse(r.stdout.trim()).decision, 'deny');
});

// Caso limite: el fallo interno ocurre DESPUES del veredicto. El bloqueo ya termino el proceso,
// asi que el fallo posterior no llega a ejecutarse: no hay doble salida ni veredicto reescrito.
test('fallo interno posterior a un bloqueo ya emitido -> gana el primer exit (2), sin doble salida', () => {
  const r = runFixture(
    "runWithFailOpen('hook-carrera', async () => { deny('SDD: motivo del bloqueo'); throw new Error('tarde'); });"
  );

  assert.strictEqual(r.code, 2);
  assert.doesNotMatch(r.stderr, /\[SDD_INTERNAL_ERROR\]/);
  assert.doesNotMatch(r.stderr, /tarde/);
  assert.strictEqual(r.stdout.trim().split('\n').length, 1, 'una sola decision emitida');
});

test('un aviso deliberado sigue saliendo con exit 0 sin firma de fallo interno', () => {
  const r = runFixture("runWithFailOpen('hook-que-avisa', () => { deny('SDD: motivo', { stdoutOnly: true }); });");

  assert.strictEqual(r.code, 0);
  assert.doesNotMatch(r.stderr, /\[SDD_INTERNAL_ERROR\]/);
});

// --- Sobre los hooks reales -----------------------------------------------------------------

test('config.json corrupto -> el hook sale con exit 0, y no como fallo interno', () => {
  const dir = tempDir('sdd-fail-open-config-');
  const config = writeFile(path.join(dir, 'config.json'), '{ esto no es json valido');
  const env = { SDD_CONFIG_PATH: config, SDD_TURNS_DIR: dir };

  const r = runHook('sdd-turn-budget.js', {
    tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: 'sesion-config-corrupta',
  }, env);

  assert.strictEqual(r.code, 0, 'un config ilegible no puede bloquear al agente');
  assert.doesNotMatch(r.stderr, /\[SDD_INTERNAL_ERROR\]/,
    'un config corrupto es una degradacion prevista, no un fallo del hook');
});

// Caso limite: config valido al que le falta la clave del hook. Ausencia significa "funcion
// desactivada" (exit 0 silencioso), no error interno.
test('config valido sin la clave del hook -> paso silencioso, no fallo interno', () => {
  const dir = tempDir('sdd-fail-open-sin-clave-');
  const config = writeFile(path.join(dir, 'config.json'), JSON.stringify({ otro_hook: { enabled: true } }));
  const env = { SDD_CONFIG_PATH: config, SDD_SIGNAL_DIR: dir, SDD_STAGED_DIFF: 'diff --git a/x b/x\n' };

  const r = runHook('sdd-review-gate.js', {
    tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, session_id: 'sesion-sin-clave',
  }, env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stderr.trim(), '', 'una clave ausente no genera ruido');
});

test('el veredicto de un hook real sigue saliendo con exit 2 tras envolverlo', () => {
  const r = runHook('sdd-commit-guard.js', {
    tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "fix: algo"' },
  });

  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.decision.decision, 'deny');
  assert.doesNotMatch(r.stderr, /\[SDD_INTERNAL_ERROR\]/);
});

// Un hook bloqueante entra por el envoltorio cuando su arranque es exactamente
// `if (require.main === module) { runWithFailOpen(...) }`. Un arranque que invoca main()
// directamente (`main().catch(...)`) no pasa por el: su fallo interno saldria con el codigo que
// decida ese .catch, indistinguible de un veredicto.
function hooksSinEnvoltorio(dir, files) {
  return files.filter((file) => {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const guardado = /if \(require\.main === module\) \{\s*\n\s*runWithFailOpen\(/.test(source);
    return !guardado || /\bmain\(\)\s*\.catch\(/.test(source);
  });
}

test('la derivacion encuentra los hooks bloqueantes del arbol real (cobertura no vacia)', () => {
  assert.ok(HOOKS_BLOQUEANTES.length >= MIN_BLOCKING_HOOKS,
    'la derivacion encontro ' + HOOKS_BLOQUEANTES.length + ' hooks bloqueantes, minimo '
    + MIN_BLOCKING_HOOKS + ': una lista vacia deja pasar toda la cobertura que la recorre');
});

test('cada hook bloqueante entra por runWithFailOpen bajo la guarda require.main', () => {
  assert.ok(HOOKS_BLOQUEANTES.length >= MIN_BLOCKING_HOOKS, 'cobertura vacia: nada que comprobar');
  assert.deepStrictEqual(hooksSinEnvoltorio(HOOKS_DIR, HOOKS_BLOQUEANTES), []);
});

// Control positivo: un hook bloqueante que nadie ha declarado en ninguna lista. La derivacion
// tiene que verlo aparecer, y el detector tiene que marcarlo por falta de envoltorio.
test('control positivo: hook bloqueante nuevo sin envoltorio -> aparece en la lista y se marca', () => {
  const dir = tempDir('sdd-fail-open-hook-nuevo-');
  const sinEnvoltorio = [
    "const { readPayload, deny } = require('./sdd-hook-utils');",
    'async function main() {',
    '  const data = await readPayload();',
    "  if (data) deny('SDD: motivo del bloqueo');",
    '}',
    'if (require.main === module) {',
    '  main().catch(() => process.exit(0));',
    '}',
  ].join('\n');
  writeFile(path.join(dir, 'sdd-hook-nuevo-sin-precedente.js'), sinEnvoltorio + '\n');

  const derivados = listBlockingHooks(dir);
  assert.deepStrictEqual(derivados, ['sdd-hook-nuevo-sin-precedente.js'],
    'un hook que deniega debe entrar en la cobertura sin tocar el test');
  assert.deepStrictEqual(hooksSinEnvoltorio(dir, derivados), ['sdd-hook-nuevo-sin-precedente.js'],
    'denegar sin envoltorio debe marcarse');

  const conEnvoltorio = sinEnvoltorio
    .replace('if (require.main === module) {\n  main().catch(() => process.exit(0));',
      "if (require.main === module) {\n  runWithFailOpen('sdd-hook-nuevo', main);");
  writeFile(path.join(dir, 'sdd-hook-nuevo-sin-precedente.js'), conEnvoltorio + '\n');
  assert.deepStrictEqual(hooksSinEnvoltorio(dir, listBlockingHooks(dir)), [],
    'el mismo hook con envoltorio debe aceptarse');
});

// La derivacion no puede pedir envoltorio a quien nunca deniega: un hook advisory-only sale
// siempre con 0, asi que su fallo interno no puede leerse como veredicto.
test('control negativo: hook advisory-only (solo warn) no se cuenta como bloqueante', () => {
  const dir = tempDir('sdd-fail-open-advisory-');
  writeFile(path.join(dir, 'sdd-solo-avisa.js'), [
    "const { readPayload, warn } = require('./sdd-hook-utils');",
    '// Este hook nunca llama a deny(): se restringe al canal informativo.',
    'async function main() {',
    '  const data = await readPayload();',
    "  if (data) warn('SDD: aviso');",
    '}',
    'if (require.main === module) {',
    '  main().catch(() => process.exit(0));',
    '}',
    '',
  ].join('\n'));

  assert.deepStrictEqual(listBlockingHooks(dir), [],
    'ni la mencion a deny() en un comentario ni el uso de warn convierten un hook en bloqueante');
});

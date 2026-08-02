'use strict';

// Contrato de session-analyzer.js: parseTranscript() lee un JSONL de transcripcion
// nativa de Claude Code linea a linea (saltando lineas malformadas con contador) y
// computeMetrics() deriva coste/duracion/cache-hit-rate/friccion-por-hook de lo
// acumulado. Cero metricas de concurrencia/fan-out: solo pipeline secuencial.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempDir, writeFile } = require('./helpers');
const { parseTranscript, computeMetrics, PRICING_USD_PER_MTOK } = require('../../.claude/workflows/lib/session-analyzer');

function assistantEvent(timestamp, model, usage) {
  return JSON.stringify({ type: 'assistant', timestamp, message: { model, usage } });
}

// Forma REAL observada en transcripciones nativas de Claude Code para adjuntos de
// hook: `hookName` es '<HookEvent>:<matcher>' (nunca el script individual) y no hay
// campos top-level `code`/`message` — el codigo que un guard emite via warn()/deny()
// viaja embebido como JSON dentro de `stdout` (ver sdd-hook-utils.js `emit()`).
function realHookAttachment(timestamp, kind, { hookEvent, matcher, command, stdout, exitCode }) {
  const attachment = {
    type: kind,
    command,
    content: '',
    durationMs: 42,
    exitCode: exitCode === undefined ? 0 : exitCode,
    hookEvent,
    hookName: `${hookEvent}:${matcher}`,
    stderr: '',
    stdout: stdout || '',
    toolUseID: 'toolu_01ABC',
  };
  return JSON.stringify({ type: 'attachment', timestamp, attachment });
}

test('transcript con tokens, timestamps y un adjunto de hook: coste, duracion y friccion > 0', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'sesion.jsonl'), [
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 }),
    realHookAttachment('2026-08-02T10:00:05.000Z', 'hook_error', {
      hookEvent: 'PreToolUse',
      matcher: '*',
      command: 'node "/home/user/project/hooks/sdd-turn-budget.js"',
      stdout: JSON.stringify({ decision: 'warn', reason: 'limite de turnos superado', code: 'TURN_BUDGET_BLOCK' }) + '\n',
    }),
    assistantEvent('2026-08-02T10:05:00.000Z', 'claude-sonnet-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
  ].join('\n'));

  const parsed = parseTranscript(file);
  const metrics = computeMetrics(parsed);

  assert.strictEqual(parsed.malformedLines, 0);
  assert.ok(metrics.cost > 0);
  assert.strictEqual(metrics.duration, 5 * 60 * 1000);
  assert.ok(metrics.cacheHitRate > 0 && metrics.cacheHitRate < 1);
  assert.deepStrictEqual(metrics.frictionByHook, {
    'sdd-turn-budget.js': { total: 1, byCode: { TURN_BUDGET_BLOCK: 1 } },
  });
});

test('friccion derivada del esquema REAL de transcript (command/stdout), no de campos inventados attachment.hookName/code/message', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'esquema-real.jsonl'), [
    realHookAttachment('2026-08-02T10:00:00.000Z', 'hook_error', {
      hookEvent: 'PreToolUse',
      matcher: 'Bash',
      command: 'node "$CLAUDE_PROJECT_DIR/hooks/sdd-commit-guard.js"',
      stdout: JSON.stringify({ decision: 'deny', reason: 'commit sin revision', code: 'COMMIT_NOT_REVIEWED' }) + '\n',
      exitCode: 2,
    }),
    realHookAttachment('2026-08-02T10:00:01.000Z', 'hook_success', {
      hookEvent: 'PreToolUse',
      matcher: 'Write|Edit',
      command: 'node "$CLAUDE_PROJECT_DIR/hooks/sdd-pipeline-guard.js"',
      stdout: '',
      exitCode: 0,
    }),
  ].join('\n'));

  const parsed = parseTranscript(file);

  // Nada de attachment.hookName/code/message crudos: el hookName de la transcripcion
  // real ('PreToolUse:Bash') no debe colarse como identificador de friccion.
  assert.deepStrictEqual(parsed.hookEvents, [
    { hookName: 'sdd-commit-guard.js', code: 'COMMIT_NOT_REVIEWED' },
    { hookName: 'sdd-pipeline-guard.js', code: null },
  ]);

  const metrics = computeMetrics(parsed);
  assert.deepStrictEqual(metrics.frictionByHook, {
    'sdd-commit-guard.js': { total: 1, byCode: { COMMIT_NOT_REVIEWED: 1 } },
    'sdd-pipeline-guard.js': { total: 1, byCode: {} },
  });
});

test('adjunto de hook con stdout no-JSON o ausente: code null, sin lanzar', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'stdout-raro.jsonl'), [
    realHookAttachment('2026-08-02T10:00:00.000Z', 'hook_success', {
      hookEvent: 'PreToolUse',
      matcher: '*',
      command: 'node "/proj/hooks/sdd-turn-budget.js"',
      stdout: 'esto no es JSON\n',
    }),
    realHookAttachment('2026-08-02T10:00:01.000Z', 'hook_success', {
      hookEvent: 'PreToolUse',
      matcher: '*',
      command: 'node "/proj/hooks/sdd-turn-budget.js"',
    }),
  ].join('\n'));

  const parsed = parseTranscript(file);

  assert.deepStrictEqual(parsed.hookEvents, [
    { hookName: 'sdd-turn-budget.js', code: null },
    { hookName: 'sdd-turn-budget.js', code: null },
  ]);
});

test('coste calculado con la tabla de precios embebida (verificacion exacta)', () => {
  const dir = tempDir('session-analyzer-');
  const price = PRICING_USD_PER_MTOK['claude-sonnet-5'];
  const file = writeFile(path.join(dir, 'sesion.jsonl'), [
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 1000000, output_tokens: 1000000 }),
  ].join('\n'));

  const metrics = computeMetrics(parseTranscript(file));
  assert.strictEqual(metrics.cost, price.input + price.output);
});

test('transcript vacio: metricas en 0/null, sin error', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'vacio.jsonl'), '');

  const parsed = parseTranscript(file);
  const metrics = computeMetrics(parsed);

  assert.strictEqual(metrics.cost, 0);
  assert.strictEqual(metrics.duration, 0);
  assert.strictEqual(metrics.cacheHitRate, null);
  assert.deepStrictEqual(metrics.frictionByHook, {});
});

test('transcript sin adjuntos de hook: frictionByHook es objeto vacio, no null', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'sin-hooks.jsonl'), [
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 10, output_tokens: 5 }),
  ].join('\n'));

  const metrics = computeMetrics(parseTranscript(file));
  assert.notStrictEqual(metrics.frictionByHook, null);
  assert.deepStrictEqual(metrics.frictionByHook, {});
});

test('lineas malformadas se saltan con contador, sin abortar el resto del parsing', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'malformado.jsonl'), [
    'esto no es JSON',
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 10, output_tokens: 5 }),
    '{"truncado": ',
    '',
    assistantEvent('2026-08-02T10:01:00.000Z', 'claude-sonnet-5', { input_tokens: 20, output_tokens: 10 }),
  ].join('\n'));

  const parsed = parseTranscript(file);

  assert.strictEqual(parsed.malformedLines, 2);
  assert.strictEqual(parsed.usageByModel['claude-sonnet-5'].inputTokens, 30);
  assert.strictEqual(parsed.usageByModel['claude-sonnet-5'].outputTokens, 15);
});

test('friccion agrupada por hookName derivado y por code cuando hay multiples eventos', () => {
  const dir = tempDir('session-analyzer-');
  const turnBudgetCmd = 'node "$CLAUDE_PROJECT_DIR/hooks/sdd-turn-budget.js"';
  const commitGuardCmd = 'node "$CLAUDE_PROJECT_DIR/hooks/sdd-commit-guard.js"';
  const file = writeFile(path.join(dir, 'friccion.jsonl'), [
    realHookAttachment('2026-08-02T10:00:00.000Z', 'hook_error', { hookEvent: 'PreToolUse', matcher: '*', command: turnBudgetCmd, stdout: JSON.stringify({ decision: 'warn', reason: 'aviso', code: 'TURN_BUDGET_WARN' }) }),
    realHookAttachment('2026-08-02T10:00:01.000Z', 'hook_error', { hookEvent: 'PreToolUse', matcher: '*', command: turnBudgetCmd, stdout: JSON.stringify({ decision: 'warn', reason: 'bloqueo', code: 'TURN_BUDGET_BLOCK' }), exitCode: 2 }),
    realHookAttachment('2026-08-02T10:00:02.000Z', 'hook_success', { hookEvent: 'PreToolUse', matcher: 'Bash', command: commitGuardCmd, stdout: JSON.stringify({ decision: 'allow', reason: 'ok' }) }),
    realHookAttachment('2026-08-02T10:00:03.000Z', 'hook_error', { hookEvent: 'PreToolUse', matcher: '*', command: turnBudgetCmd, stdout: JSON.stringify({ decision: 'warn', reason: 'otro aviso', code: 'TURN_BUDGET_WARN' }) }),
  ].join('\n'));

  const metrics = computeMetrics(parseTranscript(file));

  assert.strictEqual(metrics.frictionByHook['sdd-turn-budget.js'].total, 3);
  assert.deepStrictEqual(metrics.frictionByHook['sdd-turn-budget.js'].byCode, { TURN_BUDGET_WARN: 2, TURN_BUDGET_BLOCK: 1 });
  assert.strictEqual(metrics.frictionByHook['sdd-commit-guard.js'].total, 1);
  assert.deepStrictEqual(metrics.frictionByHook['sdd-commit-guard.js'].byCode, {});
});

test('modelo desconocido: sus tokens no aportan coste y queda listado en unpricedModels', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'modelo-desconocido.jsonl'), [
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 1000000, output_tokens: 1000000 }),
    assistantEvent('2026-08-02T10:01:00.000Z', 'claude-modelo-futuro', { input_tokens: 1000000, output_tokens: 1000000 }),
  ].join('\n'));

  const metrics = computeMetrics(parseTranscript(file));
  const priceKnown = PRICING_USD_PER_MTOK['claude-sonnet-5'];

  // Solo el coste del modelo con tarifa conocida se refleja: el desconocido aporta $0,
  // asi que 'cost' es parcial y debe venir acompanado de la senal unpricedModels.
  assert.strictEqual(metrics.cost, priceKnown.input + priceKnown.output);
  assert.deepStrictEqual(metrics.unpricedModels, ['claude-modelo-futuro']);
});

test('todos los modelos con tarifa conocida: unpricedModels vacio', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'modelos-conocidos.jsonl'), [
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 10, output_tokens: 5 }),
  ].join('\n'));

  const metrics = computeMetrics(parseTranscript(file));
  assert.deepStrictEqual(metrics.unpricedModels, []);
});

test('path inexistente: lanza error claro con el path, no un ENOENT generico', () => {
  const missing = path.join(tempDir('session-analyzer-'), 'no-existe.jsonl');
  assert.throws(() => parseTranscript(missing), (err) => {
    assert.match(err.message, /no-existe\.jsonl/);
    return true;
  });
});

test('sin metricas de concurrencia/fan-out en el modulo', () => {
  const modulePath = path.resolve(__dirname, '../../.claude/workflows/lib/session-analyzer.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.doesNotMatch(source, /concurrent|fan-out|burst|parallelism/i);
});

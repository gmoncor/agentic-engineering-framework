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

function hookAttachment(timestamp, kind, hookName, message, code) {
  const attachment = { type: kind, hookName, message };
  if (code) attachment.code = code;
  return JSON.stringify({ type: 'attachment', timestamp, attachment });
}

test('transcript con tokens, timestamps y un adjunto de hook: coste, duracion y friccion > 0', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'sesion.jsonl'), [
    assistantEvent('2026-08-02T10:00:00.000Z', 'claude-sonnet-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 }),
    hookAttachment('2026-08-02T10:00:05.000Z', 'hook_error', 'sdd-turn-budget', 'limite de turnos superado', 'TURN_BUDGET_BLOCK'),
    assistantEvent('2026-08-02T10:05:00.000Z', 'claude-sonnet-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
  ].join('\n'));

  const parsed = parseTranscript(file);
  const metrics = computeMetrics(parsed);

  assert.strictEqual(parsed.malformedLines, 0);
  assert.ok(metrics.cost > 0);
  assert.strictEqual(metrics.duration, 5 * 60 * 1000);
  assert.ok(metrics.cacheHitRate > 0 && metrics.cacheHitRate < 1);
  assert.deepStrictEqual(metrics.frictionByHook, {
    'sdd-turn-budget': { total: 1, byCode: { TURN_BUDGET_BLOCK: 1 } },
  });
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

test('friccion agrupada por hookName y por code cuando hay multiples eventos', () => {
  const dir = tempDir('session-analyzer-');
  const file = writeFile(path.join(dir, 'friccion.jsonl'), [
    hookAttachment('2026-08-02T10:00:00.000Z', 'hook_error', 'sdd-turn-budget', 'aviso', 'TURN_BUDGET_WARN'),
    hookAttachment('2026-08-02T10:00:01.000Z', 'hook_error', 'sdd-turn-budget', 'bloqueo', 'TURN_BUDGET_BLOCK'),
    hookAttachment('2026-08-02T10:00:02.000Z', 'hook_success', 'sdd-commit-guard', 'ok', null),
    hookAttachment('2026-08-02T10:00:03.000Z', 'hook_error', 'sdd-turn-budget', 'otro aviso', 'TURN_BUDGET_WARN'),
  ].join('\n'));

  const metrics = computeMetrics(parseTranscript(file));

  assert.strictEqual(metrics.frictionByHook['sdd-turn-budget'].total, 3);
  assert.deepStrictEqual(metrics.frictionByHook['sdd-turn-budget'].byCode, { TURN_BUDGET_WARN: 2, TURN_BUDGET_BLOCK: 1 });
  assert.strictEqual(metrics.frictionByHook['sdd-commit-guard'].total, 1);
  assert.deepStrictEqual(metrics.frictionByHook['sdd-commit-guard'].byCode, {});
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

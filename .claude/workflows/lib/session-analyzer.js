'use strict';

// Analisis de transcripciones nativas de Claude Code (JSONL en ~/.claude/projects/*).
//
// El formato es una linea = un evento. Dos formas de evento importan aqui:
//   - `{ type: 'assistant', message: { model, usage: { input_tokens, output_tokens,
//     cache_creation_input_tokens, cache_read_input_tokens } }, timestamp }`: el uso
//     de tokens por turno, ya troceado por modelo por el propio backend.
//   - `{ type: 'attachment', attachment: { type: 'hook_error'|'hook_success', hookName,
//     message, code } }`: como Claude Code registra la decision de un hook (warn/deny)
//     en la transcripcion. `code` solo existe si el hook lo emite (ver sdd-hook-utils.js).
//
// Deliberadamente NO calcula nada relativo a solapamiento entre subagentes,
// rafagas de llamadas ni metricas de ejecucion simultanea: esta libreria asume
// un pipeline secuencial de principio a fin.
//
// Sin dependencias npm: solo `fs`, para poder copiarse a cualquier proyecto que
// tenga Node sin arrastrar nada mas.

const fs = require('fs');

// $/MTok, tokens de input y de output. No incluye tarifas de cache (creacion/lectura
// tienen precio propio en la API real); el coste que calcula esta libreria es una
// aproximacion basada solo en input/output, suficiente para comparar sesiones entre si.
const PRICING_USD_PER_MTOK = {
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 2, output: 10 },
};

const HOOK_ATTACHMENT_RE = /hook_(error|success)/;

/**
 * Recorre un transcript JSONL y acumula uso de tokens por modelo, el rango temporal
 * de la sesion y los adjuntos de hook (friccion). Lineas vacias o no-JSON se saltan
 * con un contador, sin abortar el resto del archivo.
 *
 * Lanza si `jsonlPath` no existe, con el path en el mensaje: un ENOENT generico no
 * dice cual de N transcripciones en un batch fallo.
 */
function parseTranscript(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`session-analyzer: transcripcion no encontrada: ${jsonlPath}`);
  }

  const usageByModel = {};
  const hookEvents = [];
  let firstTimestamp = null;
  let lastTimestamp = null;
  let malformedLines = 0;

  const raw = fs.readFileSync(jsonlPath, 'utf8');

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      malformedLines += 1;
      continue;
    }

    if (event.timestamp) {
      const ts = Date.parse(event.timestamp);
      if (!Number.isNaN(ts)) {
        if (firstTimestamp === null || ts < firstTimestamp) firstTimestamp = ts;
        if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
      }
    }

    if (event.type === 'assistant' && event.message && event.message.usage) {
      const model = event.message.model || 'unknown';
      const usage = event.message.usage;
      if (!usageByModel[model]) {
        usageByModel[model] = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      }
      usageByModel[model].inputTokens += usage.input_tokens || 0;
      usageByModel[model].outputTokens += usage.output_tokens || 0;
      usageByModel[model].cacheCreationTokens += usage.cache_creation_input_tokens || 0;
      usageByModel[model].cacheReadTokens += usage.cache_read_input_tokens || 0;
      continue;
    }

    if (event.type === 'attachment' && event.attachment && HOOK_ATTACHMENT_RE.test(event.attachment.type || '')) {
      hookEvents.push({
        hookName: event.attachment.hookName || 'desconocido',
        code: event.attachment.code || null,
        message: event.attachment.message || '',
      });
    }
  }

  return { usageByModel, firstTimestamp, lastTimestamp, hookEvents, malformedLines };
}

/**
 * Convierte lo acumulado por `parseTranscript` en metricas legibles: coste, duracion,
 * tasa de acierto de cache y friccion por hook (agrupada por `hookName` y, si el hook
 * la emitio, por `code`).
 *
 * Una transcripcion vacia o sin hooks nunca lanza: cae en los valores por defecto
 * (0/null/{}) para que un consumidor pueda iterar sesiones heterogeneas sin try/catch
 * por cada una.
 */
function computeMetrics(parsed) {
  let cost = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;

  for (const model of Object.keys(parsed.usageByModel)) {
    const tokens = parsed.usageByModel[model];
    const price = PRICING_USD_PER_MTOK[model] || { input: 0, output: 0 };
    cost += (tokens.inputTokens / 1e6) * price.input + (tokens.outputTokens / 1e6) * price.output;
    totalInputTokens += tokens.inputTokens;
    totalCacheReadTokens += tokens.cacheReadTokens;
    totalCacheCreationTokens += tokens.cacheCreationTokens;
  }

  const cacheableTokens = totalInputTokens + totalCacheReadTokens + totalCacheCreationTokens;
  const cacheHitRate = cacheableTokens === 0 ? null : totalCacheReadTokens / cacheableTokens;

  const duration = (parsed.firstTimestamp === null || parsed.lastTimestamp === null)
    ? 0
    : parsed.lastTimestamp - parsed.firstTimestamp;

  const frictionByHook = {};
  for (const event of parsed.hookEvents) {
    if (!frictionByHook[event.hookName]) {
      frictionByHook[event.hookName] = { total: 0, byCode: {} };
    }
    frictionByHook[event.hookName].total += 1;
    if (event.code) {
      const byCode = frictionByHook[event.hookName].byCode;
      byCode[event.code] = (byCode[event.code] || 0) + 1;
    }
  }

  return { cost, duration, cacheHitRate, frictionByHook };
}

module.exports = { parseTranscript, computeMetrics, PRICING_USD_PER_MTOK };

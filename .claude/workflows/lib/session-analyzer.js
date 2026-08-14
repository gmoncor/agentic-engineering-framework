'use strict';

// Analisis de transcripciones nativas de Claude Code (JSONL en ~/.claude/projects/*).
//
// El formato es una linea = un evento. Dos formas de evento importan aqui:
//   - `{ type: 'assistant', message: { model, usage: { input_tokens, output_tokens,
//     cache_creation_input_tokens, cache_read_input_tokens } }, timestamp }`: el uso
//     de tokens por turno, ya troceado por modelo por el propio backend.
//   - `{ type: 'attachment', attachment: { type: 'hook_error'|'hook_success', command,
//     content, durationMs, exitCode, hookEvent, hookName, stderr, stdout, toolUseID } }`:
//     como Claude Code registra la ejecucion de un hook en la transcripcion. `hookName`
//     aqui es SIEMPRE `'<HookEvent>:<matcher>'` (p.ej. `'PreToolUse:Bash'`), nunca el
//     nombre del guard/script individual, asi que el identificador de hook que interesa
//     para friccion se deriva del basename del script en `attachment.command`. El codigo
//     corto que un guard emite via warn()/deny() (ver sdd-hook-utils.js) no llega como
//     campo top-level: viaja embebido como JSON dentro de `attachment.stdout`.
//
// Sin dependencias npm: solo `fs` y `path`, para poder copiarse a cualquier proyecto
// que tenga Node sin arrastrar nada mas.

const fs = require('fs');
const path = require('path');

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
const HOOK_SCRIPT_RE = /\.(js|mjs|cjs|py|sh)$/i;

// Comienzo de una ruta absoluta de Windows: unidad (C:\ o C:/) o recurso de red (\\servidor).
const PREFIJO_WINDOWS_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Traduce a los separadores del sistema en curso una ruta de procedencia externa: aqui, el comando
 * con el que la transcripcion registro la invocacion de un hook.
 *
 * SIEMPRE ANTES de partir la ruta. Una transcripcion se analiza a menudo desde una plataforma
 * distinta de aquella en la que se grabo, y la barra invertida es separador en Windows pero un
 * caracter valido de nombre de archivo en los sistemas tipo Unix. Sin traducir,
 * "C:\proyecto\hooks\guard.js" no tiene ultimo tramo que extraer: es UN nombre de archivo entero,
 * y las cifras se agrupan bajo esa cadena en vez de bajo el hook, una fila por ruta de instalacion.
 *
 * Solo actua en el cruce entre sistemas: sobre una ruta nativa de cada plataforma es la identidad.
 * El criterio es el mismo que aplica el guard de escrituras (hooks/sdd-plan-state.js
 * `toNativePath`), y un canary de la suite exige que ambas copias coincidan sobre la misma bateria
 * de formas. Se replica en vez de importarse para no romper la unica dependencia que este modulo
 * declara — solo `fs` y `path` — de la que depende poder copiarlo a cualquier proyecto con Node.
 *
 * `api` (path.win32 / path.posix) solo existe para ejercitar las dos plataformas desde una sola.
 */
function rutaNativa(cruda, api) {
  const ruta = String(cruda == null ? '' : cruda);
  const impl = api || path;
  if (impl.sep === '\\' || !ruta.includes('\\')) return ruta;
  if (ruta.includes('/') && !PREFIJO_WINDOWS_RE.test(ruta)) return ruta;
  return ruta.replace(/\\/g, '/');
}

/**
 * Deriva el identificador de un hook a partir del comando que lo invoco
 * (`attachment.command`, p.ej. `node "/ruta/hooks/sdd-turn-budget.js"`). `hookName`
 * en la transcripcion real es `'<HookEvent>:<matcher>'` y agrupa varios guards
 * distintos bajo el mismo matcher, asi que no sirve para friccion por-hook.
 *
 * Toma el ultimo token del comando que parece un script (extension conocida) y
 * devuelve su basename; sin match reconocible devuelve 'desconocido' en vez de
 * lanzar, porque un comando con forma inesperada no debe abortar el parseo.
 *
 * El token se traduce ANTES de extraerle el ultimo tramo: una transcripcion grabada en Windows y
 * analizada en un sistema tipo Unix trae rutas con barra invertida, que sin traducir no se parten
 * y agrupan la friccion bajo la ruta entera en lugar de bajo el hook.
 */
function hookIdentifierFromCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'desconocido';

  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i].replace(/^["']|["']$/g, '');
    if (HOOK_SCRIPT_RE.test(token)) {
      return path.basename(rutaNativa(token));
    }
  }
  return 'desconocido';
}

/**
 * Extrae el codigo corto (p.ej. `TURN_BUDGET_BLOCK`) que un hook emite via
 * warn()/deny() (ver sdd-hook-utils.js `emit()`), que escribe una linea JSON en
 * stdout. `attachment.stdout` puede venir ausente, vacio o no ser JSON valido
 * (un hook que no usa warn()/deny() no tiene por que emitir nada) — en esos
 * casos se devuelve `code: null` en vez de lanzar.
 */
function parseHookStdout(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return { code: null };

  const firstLine = stdout.trim().split('\n')[0];
  try {
    const parsed = JSON.parse(firstLine);
    return { code: (parsed && parsed.code) || null };
  } catch {
    return { code: null };
  }
}

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
      const { code } = parseHookStdout(event.attachment.stdout);
      hookEvents.push({
        hookName: hookIdentifierFromCommand(event.attachment.command),
        code,
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
 *
 * `unpricedModels` recoge los nombres de modelo distintos vistos en la transcripcion
 * que no estan en `PRICING_USD_PER_MTOK`: sus tokens SI se suman a `totalInputTokens`
 * etc., pero contribuyen $0 a `cost` porque no hay tarifa conocida. Sin esta lista,
 * `cost` se presentaria como si fuera siempre el total completo aunque en realidad sea
 * parcial para cualquier modelo no reconocido.
 */
function computeMetrics(parsed) {
  let cost = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  const unpricedModels = [];

  for (const model of Object.keys(parsed.usageByModel)) {
    const tokens = parsed.usageByModel[model];
    const price = PRICING_USD_PER_MTOK[model];
    if (!price) unpricedModels.push(model);
    cost += (tokens.inputTokens / 1e6) * (price ? price.input : 0) + (tokens.outputTokens / 1e6) * (price ? price.output : 0);
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

  return { cost, duration, cacheHitRate, frictionByHook, unpricedModels };
}

module.exports = { parseTranscript, computeMetrics, hookIdentifierFromCommand, rutaNativa, PRICING_USD_PER_MTOK };

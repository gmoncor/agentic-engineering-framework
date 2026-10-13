'use strict';

// Analisis de transcripciones nativas de Claude Code (JSONL en ~/.claude/projects/*).
//
// El formato es una linea = un evento. Dos formas de evento importan aqui:
//   - `{ type: 'assistant', message: { id, model, usage: { input_tokens, output_tokens,
//     cache_creation_input_tokens, cache_read_input_tokens, cache_creation } }, timestamp }`:
//     el uso de tokens de una respuesta. Durante el streaming Claude Code escribe varias
//     líneas con el mismo `message.id` (una por bloque de contenido); `output_tokens` crece
//     de una a otra y la última trae el total: se cuenta una vez por `message.id`, con la última.
//   - `{ type: 'attachment', attachment: { type: 'hook_error'|'hook_success', command,
//     content, durationMs, exitCode, hookEvent, hookName, stderr, stdout, toolUseID } }`:
//     como Claude Code registra la ejecucion de un hook en la transcripcion. `hookName`
//     aqui es SIEMPRE `'<HookEvent>:<matcher>'` (p.ej. `'PreToolUse:Bash'`), nunca el
//     nombre del guard/script individual, asi que el identificador de hook que interesa
//     para friccion se deriva del basename del script en `attachment.command`. El codigo
//     corto que un guard emite via warn()/deny() (ver sdd-hook-utils.js) no llega como
//     campo top-level: viaja embebido como JSON dentro de `attachment.stdout`.
//
// Los subagentes de una sesión escriben su propia transcripción junto a la principal:
// `<sesión>.jsonl` y `<sesión>/subagents/*.jsonl`. parseTranscript las agrega.
//
// Sin dependencias npm: solo `fs` y `path`, para poder copiarse a cualquier proyecto
// que tenga Node sin arrastrar nada mas.

const fs = require('fs');
const path = require('path');

// USD por millón de tokens, por categoría de la API: entrada base, salida, escritura en
// caché de 5 minutos, escritura en caché de 1 hora y lectura de caché (aciertos y refrescos).
// Fuente: https://platform.claude.com/docs/en/about-claude/pricing (tabla "Model pricing"),
// consultada el 2026-10-13. Solo modelos no retirados en esa fecha.
//
// claude-haiku-5-5 tiene dos tramos según la longitud del prompt de cada petición: entrada,
// escritura y lectura de caché sumadas; por encima de `promptLargo.umbral` (100.000 tokens)
// toda la petición paga las tarifas de `promptLargo`. Por eso el coste se calcula mensaje a
// mensaje. Los modelos retirados quedan fuera de la tabla, y por tanto en `unpricedModels`.
// No se aplican los recargos de inferencia restringida a EE. UU. (`inference_geo`) ni de
// modo rápido, ni el descuento de batch: el coste es el de la tarifa estándar.
const PRICING_USD_PER_MTOK = {
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1 },
  'claude-mythos-5': { input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01,
    promptLargo: { umbral: 100000, input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 },
  },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
};

// Un identificador con fecha (`claude-sonnet-4-5-20250929`) tiene la tarifa de su alias.
function tarifaDe(model) {
  return PRICING_USD_PER_MTOK[model] || PRICING_USD_PER_MTOK[String(model).replace(/-\d{8}$/, '')] || null;
}

// Coste en USD de un uso con las cinco categorías de la tarifa. Con tramos, el umbral se
// compara con el prompt de ese uso, que debe ser el de una sola petición.
function costeDeUso(price, t) {
  const prompt = t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens;
  const p = price.promptLargo && prompt > price.promptLargo.umbral ? price.promptLargo : price;
  return (t.inputTokens * p.input
    + t.outputTokens * p.output
    + (t.cacheCreationTokens - t.cacheCreation1hTokens) * p.cacheWrite5m
    + t.cacheCreation1hTokens * p.cacheWrite1h
    + t.cacheReadTokens * p.cacheRead) / 1e6;
}

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
 * Transcripciones de los subagentes de una sesión: `<sesión>/subagents/*.jsonl`, junto al
 * fichero `<sesión>.jsonl`. Sin ese directorio, ninguna. Orden alfabético para que el
 * resultado no dependa del orden en que el sistema de ficheros lista las entradas.
 */
function subagentTranscriptsOf(jsonlPath) {
  const dir = path.join(path.dirname(jsonlPath), path.basename(jsonlPath, '.jsonl'), 'subagents');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/**
 * Recorre un transcript JSONL, y los de sus subagentes, y acumula uso de tokens por modelo,
 * el rango temporal de la sesión y los adjuntos de hook (fricción). Líneas vacías o no-JSON
 * se saltan con un contador, sin abortar el resto del archivo.
 *
 * El uso se cuenta una vez por `message.id`, con la última línea que lo trae: Claude Code
 * escribe varias líneas por respuesta en streaming, con `output_tokens` creciente y el total
 * en la última, y sumarlas todas multiplica los tokens. Una línea `assistant` sin
 * `message.id` cuenta por sí sola.
 *
 * Una sesión reanudada repite en su transcripción nueva mensajes de la anterior. Para
 * analizar varias sin contarlos dos veces se pasa el mismo `Set` en
 * `options.seenMessageIds` a cada llamada: un `message.id` que ya esté en él no se cuenta,
 * y los de esta transcripción se añaden. Sin él, la deduplicación vale solo dentro de una.
 *
 * Cada modelo acumula además `costUsd`, calculado mensaje a mensaje (los tramos por
 * longitud de prompt se deciden por petición), o `null` si el modelo no tiene tarifa.
 *
 * Lanza si `jsonlPath` no existe, con el path en el mensaje: un ENOENT generico no
 * dice cual de N transcripciones en un batch fallo.
 */
function parseTranscript(jsonlPath, options = {}) {
  const seenMessageIds = options.seenMessageIds || null;
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`session-analyzer: transcripcion no encontrada: ${jsonlPath}`);
  }

  const usageByMessage = new Map();
  const hookEvents = [];
  let firstTimestamp = null;
  let lastTimestamp = null;
  let malformedLines = 0;
  let anonymous = 0;

  const subagentFiles = subagentTranscriptsOf(jsonlPath);

  for (const file of [jsonlPath].concat(subagentFiles)) {
    const raw = fs.readFileSync(file, 'utf8');

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
        anonymous += 1;
        const id = event.message.id || null;
        const key = id ? `id:${id}` : `sin-id:${anonymous}`;
        usageByMessage.set(key, { id, model: event.message.model || 'unknown', usage: event.message.usage });
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
  }

  const usageByModel = {};
  for (const { id, model, usage } of usageByMessage.values()) {
    if (id && seenMessageIds) {
      if (seenMessageIds.has(id)) continue;
      seenMessageIds.add(id);
    }
    if (!usageByModel[model]) {
      usageByModel[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation1hTokens: 0,
        cacheReadTokens: 0,
        costUsd: tarifaDe(model) ? 0 : null,
      };
    }
    const tokens = usageByModel[model];
    const creation = usage.cache_creation_input_tokens || 0;
    // El desglose por duración (`cache_creation.ephemeral_1h_input_tokens`) solo existe en
    // transcripciones recientes; sin él, toda la escritura se tarifica como de 5 minutos.
    const message = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheCreationTokens: creation,
      cacheCreation1hTokens: Math.min(creation, (usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0),
      cacheReadTokens: usage.cache_read_input_tokens || 0,
    };
    for (const campo of Object.keys(message)) tokens[campo] += message[campo];
    if (tokens.costUsd !== null) tokens.costUsd += costeDeUso(tarifaDe(model), message);
  }

  return {
    usageByModel,
    firstTimestamp,
    lastTimestamp,
    hookEvents,
    malformedLines,
    subagentTranscripts: subagentFiles.length,
  };
}

/**
 * Convierte lo acumulado por `parseTranscript` en metricas legibles: coste, duracion,
 * tasa de acierto de cache y friccion por hook (agrupada por `hookName` y, si el hook
 * la emitio, por `code`).
 *
 * El coste es el que `parseTranscript` acumuló mensaje a mensaje con las cinco categorías
 * de la tarifa (entrada, salida, escritura en caché de 5 minutos y de 1 hora, y lectura
 * de caché). Un objeto sin `costUsd` se tarifica sobre sus totales.
 *
 * Una transcripcion vacia o sin hooks nunca lanza: cae en los valores por defecto
 * (0/null/{}) para que un consumidor pueda iterar sesiones heterogeneas sin try/catch
 * por cada una.
 *
 * `unpricedModels` recoge los nombres de modelo distintos vistos en la transcripcion
 * que no tienen tarifa en `PRICING_USD_PER_MTOK`: sus tokens SI se suman a `totalInputTokens`
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
    const price = tarifaDe(model);
    if (price) {
      cost += typeof tokens.costUsd === 'number'
        ? tokens.costUsd
        : costeDeUso(price, { cacheCreation1hTokens: 0, ...tokens });
    } else {
      unpricedModels.push(model);
    }
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

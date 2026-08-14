#!/usr/bin/env node
'use strict';

/**
 * Mide el coste temporal del cableado de hooks por llamada a herramienta.
 *
 * Dos medidas independientes, con proposito distinto:
 *   - "spawn": el proceso completo por invocacion (arranque del interprete +
 *     lectura del payload por stdin + logica del hook). Es el coste real que
 *     paga hoy cada llamada a herramienta con el cableado actual.
 *   - "logica": la funcion de decision del hook, invocada en el mismo
 *     proceso que este script, sin arrancar un interprete nuevo ni leer
 *     stdin. Aisla el coste propio del hook de la infraestructura que lo
 *     envuelve. Es necesaria porque en maquinas con arranque de proceso caro
 *     (antivirus, WSL) ese arranque domina y no es atribuible al hook.
 *
 * La recomendacion de bundling se basa en "spawn" (el coste real). El
 * control positivo/negativo que valida el instrumento se basa en "logica":
 * es la unica forma estable de distinguir "el hook hizo trabajo" de "el hook
 * no hizo nada" sin que el ruido del arranque de proceso la enmascare.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const REAL_CONFIG = path.join(HOOKS_DIR, 'config.json');
const HOOK_TIMEOUT_MS = 5000;
const BUNDLE_THRESHOLD_MS = 500;
const SESSION_CALLS = 30; // umbral warn_at por defecto de sdd-turn-budget

const { loadConfig } = require(path.join(HOOKS_DIR, 'sdd-hook-utils.js'));
const { findTasksDir, denialReason } = require(path.join(HOOKS_DIR, 'sdd-plan-state.js'));

// Cableado real de Claude Code (.claude/settings.json): el backend mas
// completo de los cuatro que soporta el framework. Gemini/Codex/Antigravity
// cablean un subconjunto (ver scripts/hook-event-mapping.json).
const WIRING = {
  Write: ['sdd-pipeline-guard.js', 'sdd-read-before-edit.js', 'sdd-turn-budget.js'],
  Read: ['sdd-read-before-edit.js', 'sdd-turn-budget.js'],
  Bash: ['sdd-commit-guard.js', 'sdd-review-gate.js', 'sdd-turn-budget.js'],
};

const CONFIG_KEY = {
  'sdd-read-before-edit.js': 'sdd_read_before_edit',
  'sdd-turn-budget.js': 'sdd_turn_budget',
  'sdd-review-gate.js': 'sdd_review_gate',
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ms != null).map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: samples.length,
    timeouts: samples.length - ok.length,
    p50: percentile(ok, 0.5),
    p95: percentile(ok, 0.95),
    max: ok.length ? ok[ok.length - 1] : null,
  };
}

function fmt(ms) {
  return ms == null ? 'n/a' : ms.toFixed(2) + 'ms';
}

// Un hook por proceso real, mismo contrato que la CLI: payload JSON por
// stdin, decision por stdout/exit code. Timeout explicito: un hook colgado
// nunca debe bloquear la medicion (caso limite: se reporta TIMEOUT).
function spawnHook(hookFile, payload, env) {
  const t0 = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, hookFile)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: HOOK_TIMEOUT_MS,
    env: Object.assign({}, process.env, env || {}),
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const timedOut = !!(result.error && result.error.code === 'ETIMEDOUT');
  return { ms: timedOut ? null : ms, timedOut };
}

function spawnSamples(hookFile, payloads, env) {
  return payloads.map((payload) => spawnHook(hookFile, payload, env));
}

function timeInProcess(fn, samples) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    out.push({ ms: Number(process.hrtime.bigint() - t0) / 1e6 });
  }
  return out;
}

// Proyecto minimo con plan aprobado y los archivos declarados: ejercita la
// logica real de sdd-pipeline-guard (escaneo de ai_docs/tasks), no un atajo.
function buildFixture(root, count) {
  const tasksDir = path.join(root, 'ai_docs', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  const files = [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const rel = 'src/demo/archivo' + i + '.js';
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '// fixture ' + i + '\n');
    files.push(abs);
    rows.push('| `' + rel + '` | MODIFICAR | fixture de medicion |');
  }
  fs.writeFileSync(path.join(tasksDir, 'spec_medicion.md'), '# Spec: Medicion\n\n**Estado:** APROBADA\n');
  fs.writeFileSync(path.join(tasksDir, '001_medicion.md'), [
    '# Task 001: Medicion', '', 'Spec madre: ai_docs/tasks/spec_medicion.md', '',
    '## Archivos afectados', '', '| Archivo | Accion | Descripcion del cambio |',
    '|---------|--------|----------------------|', rows.join('\n'), '',
  ].join('\n'));
  return files;
}

const SESSION_ID = 'measure-hook-overhead';
const writeCall = (f) => ({ session_id: SESSION_ID, tool_name: 'Write', tool_input: { file_path: f, content: 'x' } });
const readCall = (f) => ({ session_id: SESSION_ID, tool_name: 'Read', tool_input: { file_path: f } });
const bashCall = (cmd) => ({ session_id: SESSION_ID, tool_name: 'Bash', tool_input: { command: cmd } });

function hookEnabled(hookFile, config) {
  const key = CONFIG_KEY[hookFile];
  if (!key) return true; // sin interruptor en config.json: siempre activo
  return (config[key] || {}).enabled !== false;
}

function measureByTool(work, config, env) {
  const files = buildFixture(work, 20);
  const byTool = {
    Write: { payloads: files.map(writeCall), hooks: WIRING.Write },
    Read: { payloads: files.slice(0, 10).map(readCall), hooks: WIRING.Read },
    Bash: { payloads: Array.from({ length: 10 }, () => bashCall('ls')), hooks: WIRING.Bash },
  };

  const aggregateByTool = {};
  for (const [tool, { payloads, hooks }] of Object.entries(byTool)) {
    let aggregateP50 = 0;
    console.log('== ' + tool + ' (' + payloads.length + ' llamadas simuladas) ==');
    for (const hookFile of hooks) {
      if (!hookEnabled(hookFile, config)) {
        console.log('  ' + hookFile + ': omitido (deshabilitado en hooks/config.json)');
        continue;
      }
      const stats = summarize(spawnSamples(hookFile, payloads, env));
      aggregateP50 += stats.p50 || 0;
      console.log('  ' + hookFile + ': p50=' + fmt(stats.p50) + ' p95=' + fmt(stats.p95)
        + ' max=' + fmt(stats.max) + ' timeouts=' + stats.timeouts + '/' + stats.n);
    }
    aggregateByTool[tool] = aggregateP50;
    console.log('  agregado por llamada (' + tool + '): ' + fmt(aggregateP50) + '\n');
  }
  return { aggregateByTool, targetFile: files[0] };
}

function reportSessionEstimate(aggregateByTool) {
  // Asuncion declarada, no medida: una sesion tipica reparte sus llamadas
  // ~50% Write / ~30% Read / ~20% Bash sobre SESSION_CALLS acciones.
  const mix = { Write: 0.5, Read: 0.3, Bash: 0.2 };
  const estimate = Object.entries(mix)
    .reduce((sum, [tool, share]) => sum + share * (aggregateByTool[tool] || 0), 0) * SESSION_CALLS;
  console.log('Estimacion de sesion (' + SESSION_CALLS + ' llamadas, mezcla '
    + JSON.stringify(mix) + '): ' + fmt(estimate) + '\n');
}

// Control positivo/negativo del instrumento: logica en proceso, sin arranque.
// Positivo: sdd-pipeline-guard resolviendo un plan real (trabajo de E/S
// medible). Negativo: la comprobacion de "enabled: false" que usan
// sdd-turn-budget / sdd-read-before-edit para salir sin hacer nada.
function validateInstrument(work, targetFile) {
  console.log('== Validacion del instrumento (logica en proceso, sin arranque) ==');

  const positive = summarize(timeInProcess(() => {
    denialReason(findTasksDir(targetFile), targetFile);
  }, 30));

  const disabledConfig = path.join(work, 'config-disabled.json');
  fs.writeFileSync(disabledConfig, JSON.stringify({ sdd_turn_budget: { enabled: false } }));
  const negative = summarize(timeInProcess(() => {
    const cfg = loadConfig(disabledConfig).sdd_turn_budget || {};
    return cfg.enabled === false;
  }, 30));

  console.log('  positivo (sdd-pipeline-guard, plan real): p50=' + fmt(positive.p50) + ' max=' + fmt(positive.max));
  console.log('  negativo (config deshabilitado): p50=' + fmt(negative.p50) + ' max=' + fmt(negative.max));

  const positiveOk = positive.p50 != null && positive.p50 > 0;
  const negativeOk = negative.p50 != null && negative.p50 < 1;
  console.log('  control positivo (>0ms): ' + (positiveOk ? 'PASS' : 'FAIL'));
  console.log('  control negativo (<1ms): ' + (negativeOk ? 'PASS' : 'FAIL') + '\n');

  return positiveOk && negativeOk;
}

function reportRecommendation(aggregateByTool) {
  const peorAgregado = Math.max(...Object.values(aggregateByTool));
  console.log('== Recomendacion ==');
  if (peorAgregado > BUNDLE_THRESHOLD_MS) {
    console.log('Agregado maximo por llamada (' + fmt(peorAgregado) + ') supera el umbral de '
      + BUNDLE_THRESHOLD_MS + 'ms. La logica propia de los hooks es submilisegundo (ver '
      + 'validacion arriba); el coste esta en arrancar un proceso por hook. Bundling '
      + 'justificado: agrupar los hooks de un mismo evento en un solo proceso amortiza ese '
      + 'arranque en vez de pagarlo una vez por hook.');
  } else {
    console.log('Agregado maximo por llamada (' + fmt(peorAgregado) + ') no supera el umbral de '
      + BUNDLE_THRESHOLD_MS + 'ms. Overhead aceptable, bundling no justificado con estos datos.');
  }
}

function main() {
  console.log('Plataforma: ' + os.platform() + ' ' + os.release() + ' (node ' + process.version + ')');
  console.log('Aviso: cada invocacion arranca un proceso nuevo; en maquinas con antivirus activo '
    + '(tipicamente Windows) o en capas de virtualizacion (WSL) ese arranque es mas caro y no es '
    + 'atribuible al cableado de hooks. Ver medida "logica" para el coste propio del hook.\n');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-overhead-'));
  const env = { SDD_TURNS_DIR: work, SDD_READS_DIR: work };
  try {
    const config = JSON.parse(fs.readFileSync(REAL_CONFIG, 'utf8'));
    const { aggregateByTool, targetFile } = measureByTool(work, config, env);
    reportSessionEstimate(aggregateByTool);
    const instrumentOk = validateInstrument(work, targetFile);
    reportRecommendation(aggregateByTool);
    if (!instrumentOk) process.exitCode = 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Self-check de las funciones puras de agregacion, antes de fiarse de las
// cifras que producen sobre datos reales.
console.assert(percentile([1, 2, 3, 4, 5], 0.5) === 3, 'percentile p50 sobre 5 valores');
console.assert(percentile([], 0.5) === null, 'percentile sobre lista vacia');
const demoStats = summarize([{ ms: 1 }, { ms: 2 }, { ms: 3 }, { ms: null }]);
console.assert(demoStats.n === 4 && demoStats.timeouts === 1 && demoStats.max === 3, 'summarize cuenta timeouts y max');

main();

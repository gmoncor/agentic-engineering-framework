'use strict';

// Los campos que cada hook lee existen en el payload que Claude Code envía de verdad.
//
// Los tests de cada hook construyen su payload con los campos que el hook lee: pasan
// aunque el runtime mande otro campo. Este banco contrasta lo que los hooks leen con
// payloads capturados del runtime (tests/fixtures/payloads_claude.json, con la versión
// del CLI y la fecha de captura). Vive en tests/ y no en hooks/tests/ porque el
// instalador copia los tests de hooks/tests/ pero no sus fixtures.
//
// Qué hooks corren en cada evento no se escribe aquí: se lee del fichero de wiring del
// backend, que es lo que el cliente ejecuta. Un hook cableado sin declaración de campos,
// o una declaración de un hook que ya no se cablea, pone el banco en rojo.
//
// Coste: corre en proceso, sin lanzar subprocesos; solo lee el fixture, el wiring y la
// fuente de cada hook.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'payloads_claude.json');
const WIRING = path.join(RAIZ, '.claude', 'settings.json');
// readToolCall vive aquí: tool_name y tool_input se leen a través de él.
const UTILS = path.join(RAIZ, 'hooks', 'sdd-hook-utils.js');

/**
 * Campos del payload de Claude Code que lee cada hook cableado.
 *   - campos: los lee en cada payload de su evento.
 *   - porHerramienta: los lee solo cuando la herramienta es esa.
 *   - subagente: llegan solo en las llamadas de un subagente; su ausencia es la que marca el
 *     hilo principal, así que también se comprueba que no estén en él.
 *   - noLlegan: los lee, el CLI capturado no los envía y el hook degrada sin ellos. Se
 *     comprueba que siguen sin llegar: si una captura nueva los trae, la declaración caduca.
 *   - sinCaptura: los lee de una herramienta que la captura no ejerció; sin payload real
 *     con el que contrastarlos, quedan como residuo declarado.
 * Los alias de otros backends (ALIAS_DE_OTROS_BACKENDS) no se declaran.
 */
const LECTURAS = {
  'sdd-session-start.js': {
    campos: ['session_id', 'cwd'],
    // model: provenance lo registra como null. project: cae al nombre del directorio.
    noLlegan: ['model', 'project'],
  },
  'sdd-pipeline-guard.js': {
    campos: ['tool_name', 'cwd'],
    porHerramienta: { Write: ['tool_input.file_path'], Edit: ['tool_input.file_path'] },
    // NotebookEdit está en su matcher, pero la captura no trae ninguna llamada a NotebookEdit.
    sinCaptura: ['tool_input.notebook_path'],
  },
  'sdd-read-before-edit.js': {
    campos: ['tool_name', 'session_id', 'cwd'],
    porHerramienta: {
      Read: ['tool_input.file_path'],
      Write: ['tool_input.file_path'],
      Edit: ['tool_input.file_path'],
    },
  },
  'sdd-turn-budget.js': {
    campos: ['tool_name', 'session_id'],
    porHerramienta: { Bash: ['tool_input.command'] },
    subagente: ['agent_id', 'agent_type'],
    // is_sidechain: marca de subagente alternativa; el CLI capturado no la envía.
    noLlegan: ['is_sidechain'],
  },
  'sdd-commit-guard.js': {
    campos: ['tool_name'],
    porHerramienta: { Bash: ['tool_input.command'] },
  },
  'sdd-review-gate.js': {
    campos: ['tool_name', 'session_id', 'cwd'],
    porHerramienta: { Bash: ['tool_input.command'] },
  },
};

// Campos que los hooks leen solo para otros backends: no existen en el payload de Claude Code.
const ALIAS_DE_OTROS_BACKENDS = new Set([
  'sessionId', 'tool_input.path', 'tool_input.TargetFile', 'tool_input.absolute_path',
  'tool_input.CommandLine',
]);

// Lecturas del payload en la fuente de un hook: `data.x` / `payload.x` (raíz) y
// `call.input.x` (tool_input normalizado por readToolCall), con `.` o `?.`.
// Límites: no ve la desestructuración (`const { x } = data`) ni el acceso con corchetes
// (`data['x']`). Tampoco recorre readToolCall (sdd-hook-utils.js), que lee tool_name,
// tool_input y el toolCall de Antigravity: queda como residuo.
const LECTURA_EN_FUENTE = /\b(?:(data|payload)|call(?:\?\.|\.)input)(?:\?\.|\.)([A-Za-z_]\w*)/g;

function declarados(l) {
  return [
    ...(l.campos || []), ...(l.subagente || []), ...(l.noLlegan || []), ...(l.sinCaptura || []),
    ...Object.values(l.porHerramienta || {}).flat(),
  ];
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const payloads = fixture.payloads || [];

function valorEn(objeto, ruta) {
  return ruta.split('.').reduce((v, clave) => (v == null ? undefined : v[clave]), objeto);
}

function presente(objeto, ruta) {
  const valor = valorEn(objeto, ruta);
  return valor !== undefined && valor !== null && valor !== '';
}

/** [{ hook, evento, matcher }] de cada hook que el wiring hace correr. */
function cableado() {
  const settings = JSON.parse(fs.readFileSync(WIRING, 'utf8'));
  const filas = [];
  for (const [evento, grupos] of Object.entries(settings.hooks || {})) {
    for (const grupo of grupos) {
      const matcher = grupo.matcher === undefined ? '*' : grupo.matcher;
      for (const h of grupo.hooks || []) {
        const nombre = String(h.command || '').match(/([\w.-]+\.js)/);
        if (nombre) filas.push({ hook: nombre[1], evento, matcher });
      }
    }
  }
  return filas;
}

/** Payloads del fixture que disparan el grupo (evento + matcher de herramienta). */
function payloadsDe({ evento, matcher }) {
  return payloads.filter(({ payload }) => {
    if (payload.hook_event_name !== evento) return false;
    if (evento !== 'PreToolUse' || matcher === '*') return true;
    return matcher.split('|').includes(payload.tool_name);
  });
}

test('el fixture declara la versión del CLI y la fecha de captura', () => {
  assert.strictEqual(fixture.backend, 'claude-code');
  assert.match(String(fixture.cli_version), /^\d+\.\d+\.\d+$/);
  assert.match(String(fixture.capturado), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(payloads.some((p) => p.subagente), 'el fixture no trae ninguna llamada de subagente');
  assert.ok(payloads.some((p) => !p.subagente), 'el fixture no trae ninguna llamada del hilo principal');
});

test('cada hook cableado tiene declarados los campos que lee, y solo esos hooks', () => {
  const cableados = [...new Set(cableado().map((f) => f.hook))].sort();
  assert.deepStrictEqual(Object.keys(LECTURAS).sort(), cableados);
});

test('cada campo declarado lo lee de verdad el hook', () => {
  const utils = fs.readFileSync(UTILS, 'utf8');
  for (const [hook, l] of Object.entries(LECTURAS)) {
    const fuente = fs.readFileSync(path.join(RAIZ, 'hooks', hook), 'utf8') + utils;
    for (const ruta of declarados(l)) {
      const campo = ruta.split('.').pop();
      assert.ok(fuente.includes('.' + campo), `${hook} no lee ${campo}: la declaración de LECTURAS caducó`);
    }
  }
});

test('cada campo que la fuente del hook lee del payload está declarado', () => {
  for (const [hook, l] of Object.entries(LECTURAS)) {
    const fuente = fs.readFileSync(path.join(RAIZ, 'hooks', hook), 'utf8');
    const conocidos = new Set(declarados(l));
    const leidos = [...fuente.matchAll(LECTURA_EN_FUENTE)]
      .map((m) => (m[1] ? m[2] : 'tool_input.' + m[2]));
    assert.ok(leidos.length >= 1, `${hook}: no se reconoce ninguna lectura del payload en su fuente`);
    for (const ruta of new Set(leidos)) {
      if (ALIAS_DE_OTROS_BACKENDS.has(ruta)) continue;
      assert.ok(conocidos.has(ruta), `${hook} lee ${ruta} y LECTURAS no lo declara`);
    }
  }
});

test('los campos que lee cada hook existen en el payload real de su evento', () => {
  for (const fila of cableado()) {
    const lecturas = LECTURAS[fila.hook];
    const casos = payloadsDe(fila);
    assert.ok(casos.length >= 1,
      `${fila.hook} (${fila.evento} ${fila.matcher}): ningún payload del fixture lo dispara`);
    for (const { id, payload } of casos) {
      const exigidos = [...lecturas.campos, ...((lecturas.porHerramienta || {})[payload.tool_name] || [])];
      for (const ruta of exigidos) {
        assert.ok(presente(payload, ruta), `${fila.hook}: ${id} no trae ${ruta}`);
      }
    }
  }
});

test('cada herramienta con campos propios aparece en el fixture', () => {
  for (const [hook, l] of Object.entries(LECTURAS)) {
    for (const herramienta of Object.keys(l.porHerramienta || {})) {
      assert.ok(payloads.some((p) => p.payload.tool_name === herramienta),
        `${hook} lee campos de ${herramienta} y el fixture no trae ninguna llamada a ${herramienta}`);
    }
  }
});

test('los campos de subagente llegan solo en las llamadas de un subagente', () => {
  for (const [hook, l] of Object.entries(LECTURAS)) {
    for (const campo of l.subagente || []) {
      for (const { id, subagente, payload } of payloads.filter((p) => p.payload.hook_event_name === 'PreToolUse')) {
        assert.strictEqual(presente(payload, campo), subagente,
          `${hook}: ${id} ${subagente ? 'no trae' : 'trae'} ${campo}`);
      }
    }
  }
});

test('los campos declarados como ausentes siguen sin llegar', () => {
  for (const [hook, l] of Object.entries(LECTURAS)) {
    for (const campo of l.noLlegan || []) {
      for (const { id, payload } of payloads) {
        assert.ok(!presente(payload, campo),
          `${hook}: ${id} ya trae ${campo}; muévelo a campos en LECTURAS`);
      }
    }
  }
});

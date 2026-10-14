'use strict';

// Contrato de los ficheros nativos de Codex que el CLI carga al arrancar.
//
// `.codex/rules/sdd-enforcement.rules`: codex-cli 0.162.1 rechaza un parámetro
// desconocido en `prefix_rule` («Found reason extra named parameter(s)») y no
// arranca. El motivo de la regla va en `justification`.
//
// `.codex/config.toml`: un modelo fuera del catálogo del CLI arranca con
// «Model metadata ... not found». El catálogo cambia con cada versión de Codex:
// cuando cambie, se actualizan juntos este fixture y la prosa que cita el modelo.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { extraerModeloToml } = require('../bin/cli.js');

const RAIZ = path.join(__dirname, '..');
const REGLAS = path.join(RAIZ, '.codex', 'rules', 'sdd-enforcement.rules');
const CONFIG = path.join(RAIZ, '.codex', 'config.toml');

// Nombres que `codex debug models` mostró con codex-cli 0.162.1 (2026-10-13).
// La lista tenía 11 modelos y aquí constan los 8 capturados: es un subconjunto,
// no el catálogo completo, y solo sirve para afirmar pertenencia.
const CATALOGO_CODEX_0_162_1 = Object.freeze([
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-6-astra',
  'gpt-6.1-sol',
]);

/** Separa las llamadas a `prefix_rule(...)` de un texto Starlark (sin paréntesis anidados en los argumentos). */
function llamadasPrefixRule(texto) {
  const sinComentarios = texto.split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
  return [...sinComentarios.matchAll(/prefix_rule\(([\s\S]*?)\n\)/g)].map(m => m[1]);
}

/** Devuelve, por cada `prefix_rule`, qué parámetro inválido lleva o qué le falta. */
function problemasReglas(texto) {
  const problemas = [];
  llamadasPrefixRule(texto).forEach((cuerpo, i) => {
    if (/^\s*reason\s*=/m.test(cuerpo)) problemas.push(`prefix_rule #${i + 1}: usa reason`);
    if (!/^\s*justification\s*=/m.test(cuerpo)) problemas.push(`prefix_rule #${i + 1}: sin justification`);
  });
  return problemas;
}

test('cada prefix_rule de sdd-enforcement.rules lleva justification y ninguno reason', () => {
  const texto = fs.readFileSync(REGLAS, 'utf8');
  const llamadas = llamadasPrefixRule(texto);
  assert.strictEqual(llamadas.length, (texto.match(/^prefix_rule\(/gm) || []).length, 'el detector debe ver todas las reglas');
  assert.ok(llamadas.length >= 2, `solo se encontraron ${llamadas.length} reglas`);
  assert.deepStrictEqual(problemasReglas(texto), []);
});

test('el detector nombra una regla con reason', () => {
  const fixture = [
    'prefix_rule(',
    '    pattern = ["git", "commit", "--no-verify"],',
    '    decision = "forbidden",',
    '    reason = "motivo",',
    ')',
    '',
  ].join('\n');
  assert.deepStrictEqual(problemasReglas(fixture), [
    'prefix_rule #1: usa reason',
    'prefix_rule #1: sin justification',
  ]);
});

test('el modelo de .codex/config.toml está entre los nombres medidos del catálogo de codex-cli 0.162.1', () => {
  const modelo = extraerModeloToml(fs.readFileSync(CONFIG, 'utf8'));
  assert.ok(modelo, '.codex/config.toml debe declarar model');
  assert.ok(CATALOGO_CODEX_0_162_1.includes(modelo), `${modelo} no figura en el catálogo medido`);
});

test('o4-mini queda fuera del catálogo medido', () => {
  const modelo = extraerModeloToml('model = "o4-mini"\n');
  assert.strictEqual(modelo, 'o4-mini');
  assert.ok(!CATALOGO_CODEX_0_162_1.includes(modelo));
});

'use strict';

// Contrato de las pasadas de auditoria del workflow de planificacion.
//
// Se prueba la DECISION posterior a la respuesta del auditor, no la llamada al
// modelo: cada test entrega auditorias simuladas y comprueba si hace falta una
// segunda pasada, cual es el hallazgo mas severo cuando las pasadas discrepan, y
// que un contrato producer/consumer roto aflora en la auditoria forzando un
// veredicto adverso. La garantia critica es que el presupuesto es una sola segunda
// pasada (nunca una tercera) y que ningun contrato roto se aprueba en silencio.

const test = require('node:test');
const assert = require('node:assert');
const aud = require('../.claude/workflows/lib/auditoria');
const orq = require('../.claude/workflows/lib/orquestacion');

const {
  APROBADO,
  NECESITA_AJUSTES,
  NECESITA_REPLANTEAMIENTO,
  esVeredictoAdverso,
  necesitaOtraPasada,
  auditoriaMasSevera,
  incorporarContratosRotos,
} = aud;

function auditoria(veredicto, extra) {
  return Object.assign({
    veredicto,
    cobertura: { cubiertos: 1, total: 1, sin_cobertura: [] },
    overlaps: [],
    huecos: [],
    incoherencias: [],
    dependencias_problematicas: [],
    resumen: 'resumen ' + veredicto,
  }, extra || {});
}

// ── Veredicto adverso ─────────────────────────────────────────────────────────

test('esVeredictoAdverso: aprobado no es adverso; ajustes y replanteamiento si', () => {
  assert.strictEqual(esVeredictoAdverso(APROBADO), false);
  assert.strictEqual(esVeredictoAdverso(NECESITA_AJUSTES), true);
  assert.strictEqual(esVeredictoAdverso(NECESITA_REPLANTEAMIENTO), true);
});

test('esVeredictoAdverso: un veredicto desconocido no es adverso (no dispara re-revision)', () => {
  assert.strictEqual(esVeredictoAdverso('ERROR'), false);
  assert.strictEqual(esVeredictoAdverso(undefined), false);
});

// ── Presupuesto de pasadas: una sola segunda pasada ───────────────────────────

test('necesitaOtraPasada: veredicto adverso en la primera pasada -> hay segunda', () => {
  assert.strictEqual(necesitaOtraPasada(NECESITA_AJUSTES, 1, 2), true);
  assert.strictEqual(necesitaOtraPasada(NECESITA_REPLANTEAMIENTO, 1, 2), true);
});

test('necesitaOtraPasada: veredicto aprobado -> no hay segunda pasada (early return)', () => {
  assert.strictEqual(necesitaOtraPasada(APROBADO, 1, 2), false);
});

test('necesitaOtraPasada: agotado el presupuesto no hay tercera pasada, aunque siga adverso', () => {
  // Tras la segunda pasada (pasadaActual = 2, max = 2) no se re-revisa: una sola segunda pasada.
  assert.strictEqual(necesitaOtraPasada(NECESITA_REPLANTEAMIENTO, 2, 2), false);
});

test('necesitaOtraPasada: con presupuesto 1 nunca hay segunda pasada (pasada unica)', () => {
  assert.strictEqual(necesitaOtraPasada(NECESITA_AJUSTES, 1, 1), false);
});

// ── Hallazgo mas severo cuando las pasadas discrepan ──────────────────────────

test('auditoriaMasSevera: entre pasadas que discrepan, gana la de veredicto mas grave', () => {
  const ajustes = auditoria(NECESITA_AJUSTES);
  const replantear = auditoria(NECESITA_REPLANTEAMIENTO);

  assert.strictEqual(auditoriaMasSevera(ajustes, replantear), replantear);
  assert.strictEqual(auditoriaMasSevera(replantear, ajustes), replantear);
});

test('auditoriaMasSevera: en empate gana la segunda (la mas reciente, ya vio las correcciones)', () => {
  const primera = auditoria(NECESITA_AJUSTES, { resumen: 'primera' });
  const segunda = auditoria(NECESITA_AJUSTES, { resumen: 'segunda' });

  assert.strictEqual(auditoriaMasSevera(primera, segunda), segunda);
});

test('auditoriaMasSevera: tolera la ausencia de una pasada', () => {
  const a = auditoria(NECESITA_AJUSTES);
  assert.strictEqual(auditoriaMasSevera(null, a), a);
  assert.strictEqual(auditoriaMasSevera(a, null), a);
  assert.strictEqual(auditoriaMasSevera(null, null), null);
});

// ── Contratos rotos: afloran en la auditoria ──────────────────────────────────

test('incorporarContratosRotos: sin contratos rotos, la auditoria pasa intacta (transparente)', () => {
  const original = auditoria(APROBADO);
  assert.strictEqual(incorporarContratosRotos(original, []), original);
});

test('incorporarContratosRotos: un contrato roto fuerza veredicto adverso y aflora como incoherencia', () => {
  const antes = auditoria(APROBADO);
  const despues = incorporarContratosRotos(antes, ['b consume "ApiUsuario" pero no depende de su productor a']);

  assert.strictEqual(despues.veredicto, NECESITA_AJUSTES);
  assert.ok(despues.incoherencias.some(i => i.includes('ApiUsuario')), 'el contrato roto debe aparecer en las incoherencias');
});

test('incorporarContratosRotos: no rebaja un replanteamiento ya emitido por el auditor', () => {
  const despues = incorporarContratosRotos(auditoria(NECESITA_REPLANTEAMIENTO), ['contrato X sin productor']);
  assert.strictEqual(despues.veredicto, NECESITA_REPLANTEAMIENTO);
});

test('incorporarContratosRotos: no duplica un hallazgo ya presente en las incoherencias', () => {
  const linea = 'Contrato roto: b consume "Api" que ninguna task produce';
  const despues = incorporarContratosRotos(
    auditoria(NECESITA_AJUSTES, { incoherencias: [linea] }),
    ['b consume "Api" que ninguna task produce']
  );
  assert.strictEqual(despues.incoherencias.filter(i => i === linea).length, 1);
});

// ── Cadena real: verificarContratos detecta y la auditoria lo refleja ─────────
// Es el flujo que corre el workflow: detectar mecanicamente los contratos rotos
// sobre las tasks y hacerlos aflorar en la auditoria de planificacion.

test('cadena: un consumidor sin productor detectado por verificarContratos aflora en la auditoria', () => {
  const contratosRotos = orq.verificarContratos([
    { path: 'a', contratos: [{ tipo: 'produce', nombre: 'ApiUsuario' }] },
    { path: 'b', dependencias: [], contratos: [{ tipo: 'consume', nombre: 'ApiUsuario' }] },
  ]);
  assert.ok(contratosRotos.length > 0, 'verificarContratos debe detectar el contrato roto');

  // Un auditor que aprobo sin verlo: la incorporacion lo bloquea igualmente.
  const auditFinal = incorporarContratosRotos(auditoria(APROBADO), contratosRotos);
  assert.strictEqual(auditFinal.veredicto, NECESITA_AJUSTES);
  assert.ok(auditFinal.incoherencias.some(i => i.includes('ApiUsuario')));
});

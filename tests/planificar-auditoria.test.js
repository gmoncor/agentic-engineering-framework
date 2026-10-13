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
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const WORKFLOW = fs.readFileSync(
  path.resolve(__dirname, '..', '.claude', 'workflows', 'planificar.js'), 'utf8');

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

// ── Revisiones ausentes: una task sin revisar no se aprueba ───────────────────

const {
  incorporarRevisionesAusentes,
  normalizarAprobado,
  tasksTocadas,
  tasksARevisar,
} = aud;

/** Las tasks sin revisión, por índice, como las calcula el workflow. */
function sinRevision(taskList, reviews) {
  return taskList.filter((_, i) => !reviews[i]).map(t => t.path);
}

const TASKS = [{ path: 't1.md' }, { path: 't2.md' }, { path: 't3.md' }];

function revision(veredicto, problemas) {
  return { veredicto, problemas: problemas || [], ajustes_propuestos: [] };
}

test('incorporarRevisionesAusentes: 1 de 3 revisiones null y auditoría APROBADO -> NECESITA_AJUSTES con la task nombrada', () => {
  const reviews = [revision('LISTO_PARA_IMPLEMENTAR'), null, revision('LISTO_PARA_IMPLEMENTAR')];
  const despues = incorporarRevisionesAusentes(auditoria(APROBADO), sinRevision(TASKS, reviews));

  assert.strictEqual(despues.veredicto, NECESITA_AJUSTES);
  assert.ok(despues.huecos.some(h => h.includes('t2.md')), 'la task sin revisión debe aparecer en los huecos');
  assert.ok(!despues.huecos.some(h => h.includes('t1.md') || h.includes('t3.md')));
});

test('incorporarRevisionesAusentes: todas las revisiones null -> veredicto adverso con todas nombradas', () => {
  const despues = incorporarRevisionesAusentes(auditoria(APROBADO), sinRevision(TASKS, [null, null, null]));
  assert.ok(esVeredictoAdverso(despues.veredicto));
  for (const t of TASKS) assert.ok(despues.huecos.some(h => h.includes(t.path)), t.path);
});

test('incorporarRevisionesAusentes: con todas las revisiones, la auditoría pasa intacta', () => {
  const original = auditoria(APROBADO);
  assert.strictEqual(incorporarRevisionesAusentes(original, []), original);
});

test('incorporarRevisionesAusentes: nunca rebaja un replanteamiento', () => {
  const despues = incorporarRevisionesAusentes(auditoria(NECESITA_REPLANTEAMIENTO), ['t1.md']);
  assert.strictEqual(despues.veredicto, NECESITA_REPLANTEAMIENTO);
});

test('incorporarRevisionesAusentes: una auditoría ausente sigue ausente (el workflow la trata como ERROR)', () => {
  assert.strictEqual(incorporarRevisionesAusentes(null, ['t1.md']), null);
});

// ── APROBADO incoherente: se normaliza conservando el original ────────────────

test('normalizarAprobado: APROBADO con huecos no vacío -> NECESITA_AJUSTES con veredicto_original', () => {
  const despues = normalizarAprobado(auditoria(APROBADO, { huecos: ['falta la migración'] }));
  assert.strictEqual(despues.veredicto, NECESITA_AJUSTES);
  assert.strictEqual(despues.veredicto_original, APROBADO);
  assert.match(despues.causa_normalizacion, /veredicto contradictorio/);
});

test('normalizarAprobado: APROBADO con criterios sin cobertura o incoherencias también se normaliza', () => {
  const sinCobertura = normalizarAprobado(auditoria(APROBADO, {
    cobertura: { cubiertos: 1, total: 2, sin_cobertura: ['CA-2'] },
  }));
  assert.strictEqual(sinCobertura.veredicto, NECESITA_AJUSTES);

  const incoherente = normalizarAprobado(auditoria(APROBADO, { incoherencias: ['t1 contradice la spec'] }));
  assert.strictEqual(incoherente.veredicto, NECESITA_AJUSTES);
});

test('normalizarAprobado: APROBADO con las tres listas vacías y todas las revisiones queda intacto', () => {
  const original = auditoria(APROBADO);
  const reviews = TASKS.map(() => revision('LISTO_PARA_IMPLEMENTAR'));
  const despues = incorporarRevisionesAusentes(normalizarAprobado(original), sinRevision(TASKS, reviews));
  assert.strictEqual(despues, original);
  assert.strictEqual(despues.veredicto, APROBADO);
  assert.strictEqual(despues.veredicto_original, undefined);
});

test('normalizarAprobado: NECESITA_REPLANTEAMIENTO nunca se rebaja', () => {
  const original = auditoria(NECESITA_REPLANTEAMIENTO, { huecos: ['h'] });
  assert.strictEqual(normalizarAprobado(original), original);
});

// ── Segunda pasada: solo lo pendiente ─────────────────────────────────────────

function huella(spec, tasks) {
  return { spec, tasks };
}

test('tasksTocadas: marca una task LISTO cuyo hash cambió aunque nadie lo declarase', () => {
  const antes = huella('s', { 't1.md': 'a1', 't2.md': 'a2', 't3.md': 'a3' });
  const despues = huella('s', { 't1.md': 'b1', 't2.md': 'a2', 't3.md': 'a3' });
  assert.deepStrictEqual(tasksTocadas(antes, despues), ['t1.md']);
});

test('tasksTocadas: si cambia el hash de la spec, todas cuentan como tocadas', () => {
  const tasks = { 't1.md': 'a1', 't2.md': 'a2', 't3.md': 'a3' };
  assert.deepStrictEqual(tasksTocadas(huella('s1', tasks), huella('s2', tasks)).sort(), ['t1.md', 't2.md', 't3.md']);
});

test('tasksTocadas: un documento ilegible antes o después cuenta como tocado (nunca menos)', () => {
  const antes = huella('s', { 't1.md': 'a1', 't2.md': 'a2', 't3.md': null });
  const despues = huella('s', { 't1.md': null, 't2.md': 'a2', 't3.md': null });
  assert.deepStrictEqual(tasksTocadas(antes, despues).sort(), ['t1.md', 't3.md']);

  const tasks = { 't1.md': 'a1' };
  assert.deepStrictEqual(tasksTocadas(huella(null, tasks), huella(null, tasks)), ['t1.md']);
});

test('tasksTocadas: sin cambios no hay tocadas', () => {
  const tasks = { 't1.md': 'a1', 't2.md': 'a2' };
  assert.deepStrictEqual(tasksTocadas(huella('s', tasks), huella('s', Object.assign({}, tasks))), []);
});

test('tasksARevisar: devuelve solo las no LISTO, las sin revisión y las tocadas', () => {
  const tasks = TASKS.concat([{ path: 't4.md' }]);
  const previas = [
    revision('LISTO_PARA_IMPLEMENTAR'),
    revision('NECESITA_AJUSTES', ['p']),
    null,
    revision('LISTO_PARA_IMPLEMENTAR'),
  ];
  assert.deepStrictEqual(tasksARevisar(tasks, previas, ['t4.md']), [1, 2, 3]);
});

test('tasksARevisar: una task LISTO no tocada no vuelve a revisarse', () => {
  const previas = TASKS.map(() => revision('LISTO_PARA_IMPLEMENTAR'));
  assert.deepStrictEqual(tasksARevisar(TASKS, previas, []), []);
});

test('tasksARevisar: con todas las revisiones null, todas van a la segunda pasada', () => {
  assert.deepStrictEqual(tasksARevisar(TASKS, [null, null, null], []), [0, 1, 2]);
});

test('planificar.js: la segunda pasada lleva los hallazgos previos de cada task revisada de nuevo', () => {
  assert.match(WORKFLOW, /hallazgosPreviosTexto\(previa\)/);
  assert.match(WORKFLOW, /previa\.problemas/);
  assert.match(WORKFLOW, /tasksARevisar\(taskList, resultado\.reviews, tocadas\)/);
  assert.match(WORKFLOW, /tasksTocadas\(huellaAntes, await huellaPlan\(rutasPlan\)\)/);
  // Las rutas se resuelven una vez y ambas huellas hashean las mismas absolutas.
  assert.match(WORKFLOW, /const rutasPlan = await resolverRutasPlan\(\)\n\s*const huellaAntes = await huellaPlan\(rutasPlan\)/);
});

test('planificar.js: la normalización se compone en orden contratos -> APROBADO incoherente -> revisiones ausentes', () => {
  const contratos = WORKFLOW.indexOf('aud.incorporarContratosRotos(auditResult');
  const aprobado = WORKFLOW.indexOf('audit = aud.normalizarAprobado(audit)');
  const ausentes = WORKFLOW.indexOf('audit = aud.incorporarRevisionesAusentes(audit, tasksSinRevision)');
  assert.ok(contratos > 0 && aprobado > contratos && ausentes > aprobado,
    'orden esperado: incorporarContratosRotos, normalizarAprobado, incorporarRevisionesAusentes');
});

test('planificar.js: el auditor tiene un campo opcional avisos para las dudas sin evidencia', () => {
  assert.match(WORKFLOW, /avisos: \{ type: 'array', items: \{ type: 'string' \} \}/);
  assert.doesNotMatch(WORKFLOW, /required: \[[^\]]*'avisos'/, 'avisos debe ser opcional');
  assert.match(WORKFLOW, /dudas sin evidencia \(WARNING\) van en avisos: se informan y no bloquean/);
});

test('normalizarAprobado: APROBADO con avisos y el resto vacío sigue APROBADO; con huecos no', () => {
  const soloAvisos = auditoria(APROBADO, { avisos: ['duda sin evidencia sobre t2'] });
  assert.strictEqual(normalizarAprobado(soloAvisos), soloAvisos);
  assert.strictEqual(normalizarAprobado(soloAvisos).veredicto, APROBADO);

  const conHuecos = normalizarAprobado(auditoria(APROBADO, { avisos: ['duda'], huecos: ['falta la task de migración'] }));
  assert.strictEqual(conHuecos.veredicto, NECESITA_AJUSTES);
});

// ── Huella del plan: rutas resueltas una vez ──────────────────────────────────

const { rutaPlanAdmisible, huellaDocumentos } = aud;

function sha(absoluta) {
  return crypto.createHash('sha256').update(fs.readFileSync(absoluta)).digest('hex');
}

test('rutaPlanAdmisible: rechaza absolutas y rutas que salen del proyecto con ..', () => {
  for (const mala of ['/etc/passwd', 'C:\\x\\t.md', '../fuera.md', 'ai_docs/../../fuera.md', '..', '', null]) {
    assert.strictEqual(rutaPlanAdmisible(mala, path), false, String(mala));
  }
  for (const buena of ['ai_docs/tasks/001_a.md', 'ai_docs/tasks/../tasks/001_a.md', 'ai_docs\\tasks\\001_a.md']) {
    assert.strictEqual(rutaPlanAdmisible(buena, path), true, buena);
  }
});

test('huellaDocumentos: un doc borrado tras corregir da null (tocado) aunque haya una copia en un antecesor', () => {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-huella-')));
  try {
    const sub = path.join(raiz, 'sub');
    fs.mkdirSync(path.join(sub, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(raiz, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'spec.md'), 'spec');
    fs.writeFileSync(path.join(sub, 'tasks', 't1.md'), 'uno');
    fs.writeFileSync(path.join(sub, 'tasks', 't2.md'), 'dos');
    // Copia homónima en el antecesor: re-resolver desde sub tras el borrado la encontraría.
    fs.writeFileSync(path.join(raiz, 'tasks', 't1.md'), 'uno');

    const rutas = {
      spec: path.join(sub, 'spec.md'),
      tasks: { 'tasks/t1.md': path.join(sub, 'tasks', 't1.md'), 'tasks/t2.md': path.join(sub, 'tasks', 't2.md') },
    };
    const antes = huellaDocumentos(rutas, sha);
    assert.ok(antes.tasks['tasks/t1.md'] && antes.tasks['tasks/t2.md'] && antes.spec);

    fs.unlinkSync(path.join(sub, 'tasks', 't1.md'));
    const despues = huellaDocumentos(rutas, sha);

    // (+) el borrado cuenta como tocado aunque la copia del antecesor tenga el mismo contenido.
    assert.strictEqual(despues.tasks['tasks/t1.md'], null);
    // (−) el doc intacto conserva su hash y no cuenta como tocado.
    assert.strictEqual(despues.tasks['tasks/t2.md'], antes.tasks['tasks/t2.md']);
    assert.deepStrictEqual(tasksTocadas(antes, despues), ['tasks/t1.md']);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('huellaDocumentos: una ruta no admitida (null) da huella null y cuenta como tocada', () => {
  const huella = huellaDocumentos({ spec: null, tasks: { 't1.md': null } }, () => { throw new Error('no debe leerse'); });
  assert.deepStrictEqual(huella, { spec: null, tasks: { 't1.md': null } });
  assert.deepStrictEqual(tasksTocadas(huella, huella), ['t1.md']);
});

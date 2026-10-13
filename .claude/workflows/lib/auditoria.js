'use strict';

// Decision de pasadas de la auditoria de planificacion (Fases Revision + Auditoria).
//
// Un solo lugar define los veredictos, su severidad y las reglas que gobiernan la
// segunda pasada. El workflow planificar.js lo importa para decidir si re-revisa
// tras un veredicto adverso; los tests lo importan para verificar esas mismas
// reglas sin llamar al modelo.
//
// El presupuesto de pasadas es una simple constante en el workflow, no un motor de
// convergencia: como mucho una segunda pasada sobre las tasks pendientes. Aqui solo
// viven las decisiones puras (adverso o no, hace falta otra pasada, cual hallazgo es
// el mas severo, como reflejar contratos rotos y revisiones ausentes, qué tasks se
// vuelven a revisar), separadas del runtime de workflows.

const APROBADO = 'APROBADO';
const NECESITA_AJUSTES = 'NECESITA_AJUSTES';
const NECESITA_REPLANTEAMIENTO = 'NECESITA_REPLANTEAMIENTO';

// Orden de severidad: aprobado no bloquea; replantear es mas grave que ajustar. Un
// veredicto desconocido (por ejemplo un error del agente) cuenta como severidad 0:
// no es adverso, pero tampoco aprueba — el llamador lo trata como no-aprobado.
const SEVERIDAD = {
  [APROBADO]: 0,
  [NECESITA_AJUSTES]: 1,
  [NECESITA_REPLANTEAMIENTO]: 2,
};

// Un veredicto es adverso si pide ajustes o replanteamiento. Aprobado y cualquier
// valor desconocido no lo son (severidad 0): solo se re-revisa lo que se sabe roto.
function esVeredictoAdverso(veredicto) {
  return (SEVERIDAD[veredicto] || 0) > 0;
}

// Decide si toca otra pasada de revision/auditoria: solo si el veredicto es adverso
// y aun no se agoto el presupuesto de pasadas. Con maxPasadas = 1 nunca hay segunda
// pasada (comportamiento de pasada unica); con 2, como mucho una.
function necesitaOtraPasada(veredicto, pasadaActual, maxPasadas) {
  return esVeredictoAdverso(veredicto) && pasadaActual < maxPasadas;
}

// De dos auditorias, la de veredicto mas severo. Sirve para presentar al usuario el
// hallazgo mas grave cuando las pasadas discrepan: una discrepancia no se esconde
// tras el veredicto mas benevolo. En empate gana la segunda (la mas reciente, que ya
// vio las tasks corregidas). Tolera ausencia de una de las dos.
function auditoriaMasSevera(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (SEVERIDAD[b.veredicto] || 0) >= (SEVERIDAD[a.veredicto] || 0) ? b : a;
}

// Un contrato producer/consumer roto (un consumidor sin productor, o que no depende
// de el) es un error de plan, no un problema de runtime: debe aflorar en la auditoria
// antes de tocar codigo. Si la deteccion mecanica encontro contratos rotos, se
// incorporan a las incoherencias del auditor y se fuerza un veredicto adverso: el
// plan no puede aprobarse con un contrato roto aunque el auditor no lo haya visto.
function incorporarContratosRotos(audit, contratosRotos) {
  if (!contratosRotos || contratosRotos.length === 0) return audit;

  const base = (audit && typeof audit === 'object' && !Array.isArray(audit)) ? audit : {};
  const incoherencias = Array.isArray(base.incoherencias) ? base.incoherencias.slice() : [];
  for (const roto of contratosRotos) {
    const linea = 'Contrato roto: ' + roto;
    if (!incoherencias.includes(linea)) incoherencias.push(linea);
  }

  // Nunca rebajar la severidad que ya traia el auditor; como minimo, ajustes.
  const veredicto = base.veredicto === NECESITA_REPLANTEAMIENTO ? NECESITA_REPLANTEAMIENTO : NECESITA_AJUSTES;
  return Object.assign({}, base, { veredicto, incoherencias });
}

function esObjeto(valor) {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor);
}

// Una task sin revisión individual (el revisor cayó o no devolvió nada) no puede
// acabar en un plan aprobado: nadie la ha mirado. Cada task sin revisión se nombra
// en los huecos y fuerza como mínimo NECESITA_AJUSTES. Una auditoría ausente (null)
// se devuelve tal cual: el llamador ya la trata como ERROR, que tampoco aprueba.
function incorporarRevisionesAusentes(audit, tasksSinRevision) {
  if (!tasksSinRevision || tasksSinRevision.length === 0) return audit;
  if (!esObjeto(audit)) return audit;

  const huecos = Array.isArray(audit.huecos) ? audit.huecos.slice() : [];
  for (const ruta of tasksSinRevision) {
    const linea = 'Task sin revisión individual: ' + ruta;
    if (!huecos.includes(linea)) huecos.push(linea);
  }
  const veredicto = audit.veredicto === NECESITA_REPLANTEAMIENTO ? NECESITA_REPLANTEAMIENTO : NECESITA_AJUSTES;
  return Object.assign({}, audit, { veredicto, huecos });
}

function noVacia(lista) {
  return Array.isArray(lista) && lista.length > 0;
}

// Un APROBADO que convive con criterios sin cobertura, huecos o incoherencias se
// contradice a sí mismo: se normaliza a NECESITA_AJUSTES. El veredicto del auditor
// se conserva en veredicto_original y la causa en causa_normalizacion, para que se
// vea que la rebaja es mecánica y no del auditor. Cualquier otro veredicto, o un
// APROBADO coherente, pasa intacto.
function normalizarAprobado(audit) {
  if (!esObjeto(audit) || audit.veredicto !== APROBADO) return audit;

  const abiertas = [];
  if (noVacia(audit.cobertura && audit.cobertura.sin_cobertura)) abiertas.push('cobertura.sin_cobertura');
  if (noVacia(audit.huecos)) abiertas.push('huecos');
  if (noVacia(audit.incoherencias)) abiertas.push('incoherencias');
  if (abiertas.length === 0) return audit;

  return Object.assign({}, audit, {
    veredicto: NECESITA_AJUSTES,
    veredicto_original: APROBADO,
    causa_normalizacion: 'veredicto contradictorio: APROBADO con ' + abiertas.join(', ') + ' no vacíos',
  });
}

// Qué tasks tocó la corrección entre pasadas. No se fía del autoinforme del agente
// corrector: compara el hash del contenido de cada task doc (y de la spec) antes y
// después. Cada lado es { spec: hash|null, tasks: { [ruta]: hash|null } }, con null
// para un documento ilegible. Fallo seguro, nunca menos: si la spec cambió o no se
// pudo leer, todas cuentan como tocadas; una task ilegible en cualquiera de los dos
// momentos, o ausente de uno de ellos, también.
function tasksTocadas(hashesAntes, hashesDespues) {
  const antes = (hashesAntes && hashesAntes.tasks) || {};
  const despues = (hashesDespues && hashesDespues.tasks) || {};
  const rutas = Array.from(new Set(Object.keys(antes).concat(Object.keys(despues))));

  const specAntes = hashesAntes ? hashesAntes.spec : null;
  const specDespues = hashesDespues ? hashesDespues.spec : null;
  if (!specAntes || !specDespues || specAntes !== specDespues) return rutas;

  return rutas.filter(function (ruta) {
    const a = antes[ruta];
    const d = despues[ruta];
    return !a || !d || a !== d;
  });
}

// Una ruta de plan solo se hashea si es relativa y no sale del proyecto con '..'.
// Una ruta absoluta o que escapa no se resuelve: su huella es null y cuenta como
// tocada (fallo seguro). Recibe el módulo path para seguir siendo pura.
function rutaPlanAdmisible(ruta, path) {
  if (typeof ruta !== 'string' || ruta.trim() === '') return false;
  if (path.isAbsolute(ruta) || path.win32.isAbsolute(ruta)) return false;
  const normalizada = path.posix.normalize(ruta.replace(/\\/g, '/'));
  return normalizada !== '..' && !normalizada.startsWith('../');
}

// Huella { spec, tasks } a partir de rutas YA resueltas una sola vez (absolutas, o
// null si no eran admisibles). Las dos huellas, antes y después de la corrección,
// hashean las mismas rutas absolutas: si un documento desaparece, su hash es null
// aunque exista una copia con la misma ruta relativa en un directorio antecesor.
// hashDe(rutaAbsoluta) devuelve el hash o lanza; un fallo de lectura da null.
function huellaDocumentos(rutasResueltas, hashDe) {
  function hash(absoluta) {
    if (!absoluta) return null;
    try {
      return hashDe(absoluta) || null;
    } catch (e) {
      return null;
    }
  }
  const origen = (rutasResueltas && rutasResueltas.tasks) || {};
  const tasks = {};
  for (const ruta of Object.keys(origen)) tasks[ruta] = hash(origen[ruta]);
  return { spec: hash(rutasResueltas && rutasResueltas.spec), tasks };
}

// Índices de taskList que la segunda pasada vuelve a revisar: las que no salieron
// LISTO_PARA_IMPLEMENTAR, las que no tuvieron revisión y las que la corrección tocó.
// reviewsPrevias está alineado con taskList (null donde la revisión falló). Una task
// LISTO no tocada conserva su revisión y no se repite.
function tasksARevisar(taskList, reviewsPrevias, tocadas) {
  const previas = Array.isArray(reviewsPrevias) ? reviewsPrevias : [];
  const tocadasSet = new Set(tocadas || []);
  const indices = [];
  (taskList || []).forEach(function (task, i) {
    const previa = previas[i];
    if (!previa || previa.veredicto !== 'LISTO_PARA_IMPLEMENTAR' || tocadasSet.has(task && task.path)) {
      indices.push(i);
    }
  });
  return indices;
}

// Resumen de las revisiones por task que recibe el auditor. Reenvía veredicto,
// problemas y ajustes, y además los avisos (dudas sin evidencia) en
// avisos_no_bloqueantes, separados de problemas: un aviso se informa y no bloquea,
// así que nunca se mezcla con un problema ni lo sustituye. Una revisión sin avisos
// da una lista vacía.
function resumenDeRevisiones(revisiones) {
  return (Array.isArray(revisiones) ? revisiones : []).filter(esObjeto).map(function (r) {
    return {
      task: r.task_path,
      titulo: r.task_titulo,
      veredicto: r.veredicto,
      problemas: Array.isArray(r.problemas) ? r.problemas : [],
      ajustes: Array.isArray(r.ajustes_propuestos) ? r.ajustes_propuestos : [],
      avisos_no_bloqueantes: Array.isArray(r.avisos) ? r.avisos : [],
    };
  });
}

module.exports = {
  APROBADO,
  NECESITA_AJUSTES,
  NECESITA_REPLANTEAMIENTO,
  SEVERIDAD,
  esVeredictoAdverso,
  necesitaOtraPasada,
  auditoriaMasSevera,
  incorporarContratosRotos,
  incorporarRevisionesAusentes,
  normalizarAprobado,
  tasksTocadas,
  tasksARevisar,
  rutaPlanAdmisible,
  huellaDocumentos,
  resumenDeRevisiones,
};

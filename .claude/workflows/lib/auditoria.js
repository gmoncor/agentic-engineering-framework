'use strict';

// Decision de pasadas de la auditoria de planificacion (Fases Revision + Auditoria).
//
// Un solo lugar define los veredictos, su severidad y las reglas que gobiernan la
// segunda pasada. El workflow planificar.js lo importa para decidir si re-revisa
// tras un veredicto adverso; los tests lo importan para verificar esas mismas
// reglas sin llamar al modelo.
//
// El presupuesto de pasadas es una simple constante en el workflow, no un motor de
// convergencia: como mucho una segunda pasada sobre las tasks corregidas. Aqui solo
// viven las decisiones puras (adverso o no, hace falta otra pasada, cual hallazgo es
// el mas severo, como reflejar contratos rotos), separadas del runtime de workflows.

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

module.exports = {
  APROBADO,
  NECESITA_AJUSTES,
  NECESITA_REPLANTEAMIENTO,
  SEVERIDAD,
  esVeredictoAdverso,
  necesitaOtraPasada,
  auditoriaMasSevera,
  incorporarContratosRotos,
};

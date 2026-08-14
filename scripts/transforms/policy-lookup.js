'use strict';

// Lectura de `scripts/model-policy.json`, compartida por los transforms que
// generan artefactos y por el compilador. El modelo, el modo de sandbox y la
// traduccion de herramientas de un backend salen de aqui y de ningun otro
// sitio: asi dos transforms no pueden discrepar sobre lo que dice la politica,
// ni un artefacto generado puede heredar del fichero fuente un valor que la
// politica reserva para si.

/** Seccion de la politica para `backend`, o un objeto vacio si la politica no lo cubre. */
function seccionDe(politica, backend) {
  return ((politica && politica.backends) || {})[backend] || {};
}

/** `true` si la politica declara una seccion propia para `backend`. */
function declaraBackend(politica, backend) {
  return Object.prototype.hasOwnProperty.call((politica && politica.backends) || {}, backend);
}

/** Valor de `ajuste` para `rol`: su excepcion por nombre si la hay, si no el default. */
function porRol(ajuste, rol) {
  if (!ajuste || typeof ajuste !== 'object') return undefined;
  const excepcion = (ajuste.roles || {})[rol];
  return excepcion === undefined ? ajuste.default : excepcion;
}

/**
 * Modelo que la politica asigna a `rol` en `backend`, o `null` si el backend no
 * lleva campo de modelo (`model_field: false`) o si la politica no le asigna
 * ninguno. `null` significa "el artefacto generado no lleva el campo": nunca
 * "toma el que traiga la fuente".
 */
function modeloDe(politica, backend, rol) {
  const seccion = seccionDe(politica, backend);
  if (seccion.model_field === false) return null;
  const modelo = porRol(seccion.model, rol);
  return modelo === undefined ? null : modelo;
}

/** Modo de sandbox que la politica asigna a `rol` en `backend`, o undefined si no lo declara. */
function sandboxDe(politica, backend, rol) {
  return porRol(seccionDe(politica, backend).sandbox_mode, rol);
}

/**
 * Herramientas de la fuente traducidas al vocabulario de `backend`, en el orden
 * que fija la politica. Toda herramienta de la fuente debe estar en el mapa de
 * traduccion o declarada en `unsupported`: una que no aparezca en ninguno de
 * los dos lanza `TOOL_NOT_MAPPED` en vez de desaparecer en silencio de la
 * definicion generada.
 */
function herramientasDe(politica, backend, herramientasFuente, origen = 'desconocido') {
  const configuracion = seccionDe(politica, backend).tools || {};
  const mapa = configuracion.map || {};
  const siempre = configuracion.always || [];
  const sinEquivalente = new Set(configuracion.unsupported || []);

  const noDeclaradas = herramientasFuente.filter(
    herramienta => !mapa[herramienta] && !sinEquivalente.has(herramienta)
  );
  if (noDeclaradas.length) {
    throw new Error(
      `TOOL_NOT_MAPPED: "${origen}" declara ${noDeclaradas.join(', ')}, que la politica de "${backend}" `
        + 'no traduce ni declara como herramienta sin equivalente.'
    );
  }

  const traducidas = new Set([
    ...herramientasFuente.map(herramienta => mapa[herramienta]).filter(Boolean),
    ...siempre,
  ]);

  return [...Object.values(mapa), ...siempre].filter(herramienta => traducidas.has(herramienta));
}

module.exports = { seccionDe, declaraBackend, porRol, modeloDe, sandboxDe, herramientasDe };

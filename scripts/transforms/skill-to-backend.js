'use strict';

// Adapta una skill de Claude Code al formato de cada backend.
//
//   gemini       copia literal: el formato es el mismo, asi que cualquier
//                edicion de la skill de Claude viaja tal cual. Solo se retira
//                `disable-model-invocation`, que es un flag de Claude Code; el
//                `argument-hint` se conserva.
//   antigravity  mismo cuerpo, sin `argument-hint` ni `disable-model-invocation`
//                (Antigravity no invoca skills con argumentos, y dejar el campo
//                prometería una entrada que nunca llega; el flag de invocación
//                es de Claude Code). La salida vive en `.agents/skills/`, que
//                también lee Codex. Si la entrada declara un fragmento,
//                se anade al final como seccion de uso explicito: es la unica
//                parte propia de Antigravity y vive en `docs-src/skills/`, no
//                duplicada dentro del artefacto generado.
//
// El fragmento es markdown suelto, sin frontmatter: se concatena tal cual.
//
// El campo de modelo sigue la misma regla que en los agentes: NUNCA sale del
// fichero fuente, lo decide la politica de `scripts/model-policy.json`. Una
// skill que declare `model` no lo propaga a ninguna salida: el backend cuyo
// formato admite el campo recibe el modelo que le asigna la politica, y el que
// no lo admite (`model_field: false`) no recibe el campo en absoluto.

const { parsearFrontmatter, valorCrudo, componerMarkdown } = require('./frontmatter');
const { modeloDe } = require('./policy-lookup');

/** Campos de frontmatter de Claude Code que cada backend no entiende y se retiran de su salida. */
const CAMPOS_SOLO_CLAUDE = {
  gemini: new Set(['disable-model-invocation']),
  antigravity: new Set(['argument-hint', 'disable-model-invocation']),
};

/**
 * `campos` con el modelo que fija la politica para `backend`: el valor de la
 * fuente se reemplaza por el de la politica, y desaparece si la politica no
 * asigna ninguno a ese backend.
 */
function conModeloDeLaPolitica(campos, politica, backend) {
  const modelo = modeloDe(politica, backend, valorCrudo(campos, 'name'));

  return campos.flatMap(campo => {
    if (campo.clave !== 'model') return [campo];
    return modelo === null ? [] : [{ ...campo, valor: String(modelo) }];
  });
}

/** `true` si el frontmatter declara un campo `model`, que es de la politica y no de la fuente. */
function declaraModelo(campos) {
  return campos.some(campo => campo.clave === 'model');
}

/** `true` si el frontmatter declara algún campo que `backend` no entiende. */
function declaraCampoSoloClaude(campos, backend) {
  return campos.some(campo => CAMPOS_SOLO_CLAUDE[backend].has(campo.clave));
}

/**
 * La skill tal cual para Gemini, cuyo formato es el mismo que el de Claude. Si
 * la fuente declara un modelo o un campo que Gemini no entiende, la salida se
 * recompone: con el modelo de la política en lugar del de la fuente y sin el
 * campo. Una skill sin ninguno de los dos sale idéntica a la fuente.
 */
function skillGemini(contenidoFuente, origen, politica) {
  const { campos, cuerpo } = parsearFrontmatter(contenidoFuente, origen);
  if (!declaraModelo(campos) && !declaraCampoSoloClaude(campos, 'gemini')) return contenidoFuente;

  const conservados = campos.filter(campo => !CAMPOS_SOLO_CLAUDE.gemini.has(campo.clave));
  return componerMarkdown(conModeloDeLaPolitica(conservados, politica, 'gemini'), cuerpo);
}

/** La skill sin los campos de frontmatter que el backend no entiende, mas el fragmento si lo hay. */
function skillAntigravity(contenidoFuente, entrada, origen, politica) {
  const { campos, cuerpo } = parsearFrontmatter(contenidoFuente, origen);
  const conservados = conModeloDeLaPolitica(
    campos.filter(campo => !CAMPOS_SOLO_CLAUDE.antigravity.has(campo.clave)),
    politica,
    'antigravity'
  );
  const base = componerMarkdown(conservados, cuerpo);

  if (typeof entrada.fragmentContent !== 'string') return base;

  const anexo = entrada.fragmentContent.replace(/^\n+/, '');
  return `${base.endsWith('\n') ? base : `${base}\n`}\n${anexo.endsWith('\n') ? anexo : `${anexo}\n`}`;
}

/** La skill de `entrada` en el formato del backend de su output actual. */
function transformarSkill(contenidoFuente, entrada = {}, politica = {}) {
  const backend = (entrada.output && entrada.output.backend) || entrada.backend;
  const origen = entrada.source || entrada.id || 'desconocido';

  if (backend === 'gemini') return skillGemini(contenidoFuente, origen, politica);

  if (backend === 'antigravity') return skillAntigravity(contenidoFuente, entrada, origen, politica);

  throw new Error(`BACKEND_NOT_SUPPORTED: el transform de skills no sabe generar para el backend "${backend}".`);
}

module.exports = { transformarSkill };

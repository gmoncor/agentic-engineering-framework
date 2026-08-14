'use strict';

// Genera la definicion de un agente para cada backend a partir de dos fuentes:
//
//   source    `.claude/agents/<nombre>.md`, dueno canonico del agente: aporta
//             el nombre, la descripcion y las instrucciones en su version
//             larga, que es la que consume Claude Code.
//   fragment  `docs-src/agents/<nombre>.md`, variante compartida por los
//             backends que no leen el fichero de Claude: una descripcion mas
//             corta y las instrucciones condensadas. Un solo fragmento
//             alimenta dos formatos distintos (TOML de Codex y Markdown de
//             Antigravity), de modo que ambos no pueden divergir.
//
// El campo de modelo NUNCA sale del fichero fuente: lo decide la politica de
// `scripts/model-policy.json`. Un backend cuyo formato no admite modelo
// (`model_field: false`) no recibe el campo, en vez de recibirlo vacio.
//
// La traduccion de herramientas tambien vive en la politica, y es exhaustiva:
// una herramienta de la fuente que el backend no tenga se declara ahi como
// `unsupported`. Sin esa declaracion la generacion falla, para que ningun
// agente pierda una herramienta por omision.

const {
  parsearFrontmatter,
  valorCrudo,
  valorObligatorio,
  listaDe,
  componerMarkdown,
  aTomlBasico,
  aTomlMultilinea,
  nuevoCampo,
} = require('./frontmatter');
const { modeloDe, sandboxDe, herramientasDe } = require('./policy-lookup');

/** Contenido del fragmento de la entrada. Lanza si el engine no lo entrego. */
function varianteDe(entrada) {
  if (typeof entrada.fragmentContent !== 'string') {
    throw new Error(
      `FRAGMENT_NOT_FOUND: la entrada "${entrada.id}" necesita un fragmento con la variante `
        + 'del agente para los backends que no leen el fichero de Claude.'
    );
  }
  return parsearFrontmatter(entrada.fragmentContent, entrada.fragment || `${entrada.id} (fragmento)`);
}

/** Definicion TOML para Codex: metadatos sueltos y las instrucciones en una cadena multilinea. */
function agenteCodex(nombre, variante, politica, origen) {
  const lineas = [
    `name = ${aTomlBasico(nombre)}`,
    `description = ${aTomlBasico(valorObligatorio(variante.campos, 'description', origen))}`,
  ];

  const modelo = modeloDe(politica, 'codex', nombre);
  if (modelo !== null) lineas.push(`model = ${aTomlBasico(modelo)}`);

  const sandbox = sandboxDe(politica, 'codex', nombre);
  if (sandbox !== undefined) lineas.push(`sandbox_mode = ${aTomlBasico(sandbox)}`);

  lineas.push('', `developer_instructions = ${aTomlMultilinea(variante.cuerpo)}`, '');
  return lineas.join('\n');
}

/** Definicion Markdown para Antigravity: frontmatter minimo y el mismo cuerpo condensado que Codex. */
function agenteAntigravity(nombre, variante, politica) {
  const campos = [
    nuevoCampo('name', nombre),
    nuevoCampo('description', valorCrudo(variante.campos, 'description')),
  ];

  const modelo = modeloDe(politica, 'antigravity', nombre);
  if (modelo !== null) campos.push(nuevoCampo('model', modelo));

  return componerMarkdown(campos, variante.cuerpo);
}

/** Definicion Markdown para Gemini: el agente de Claude con el modelo de la politica y las herramientas traducidas. */
function agenteGemini(nombre, fuente, politica, origen) {
  const campos = [
    nuevoCampo('name', nombre),
    nuevoCampo('description', valorCrudo(fuente.campos, 'description')),
  ];

  const modelo = modeloDe(politica, 'gemini', nombre);
  if (modelo !== null) campos.push(nuevoCampo('model', modelo));

  const herramientas = herramientasDe(politica, 'gemini', listaDe(fuente.campos, 'tools'), origen);
  if (herramientas.length) campos.push(nuevoCampo('tools', `[${herramientas.join(', ')}]`));

  return componerMarkdown(campos, fuente.cuerpo);
}

/** Definicion del agente de `entrada` en el formato del backend de su output actual. */
function transformarAgente(contenidoFuente, entrada = {}, politica = {}) {
  const backend = (entrada.output && entrada.output.backend) || entrada.backend;
  const origen = entrada.source || entrada.id || 'desconocido';
  const fuente = parsearFrontmatter(contenidoFuente, origen);
  const nombre = valorObligatorio(fuente.campos, 'name', origen);

  if (backend === 'gemini') return agenteGemini(nombre, fuente, politica, origen);

  if (backend === 'codex' || backend === 'antigravity') {
    const variante = varianteDe(entrada);
    return backend === 'codex'
      ? agenteCodex(nombre, variante, politica, entrada.fragment || origen)
      : agenteAntigravity(nombre, variante, politica);
  }

  throw new Error(`BACKEND_NOT_SUPPORTED: el transform de agentes no sabe generar para el backend "${backend}".`);
}

module.exports = { transformarAgente };

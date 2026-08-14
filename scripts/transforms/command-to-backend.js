'use strict';

// Convierte un comando de Claude Code (`.claude/commands/<nombre>.md`, con
// frontmatter YAML y cuerpo Markdown) al formato TOML que espera Gemini: la
// descripcion pasa a `description` y el cuerpo entero pasa a `prompt` como
// cadena multilinea.
//
// El comando de Claude es el dueno canonico, asi que una instruccion anadida
// alli llega al otro backend en vez de quedarse esperando a que alguien la
// copie a mano. La unica traduccion de vocabulario es el marcador de
// argumentos, que cada backend nombra a su manera.
//
// Un bloque del comando marcado con `<!-- solo-claude -->` no llega a la
// salida: es texto que solo vale en el backend de Claude Code (por ejemplo un
// aviso sobre un hook que solo ese backend cablea). Sin el marcador, todo el
// cuerpo viaja.
//
// Excepcion declarada: un comando cuya version para el otro backend es
// deliberadamente distinta (porque depende de una capacidad que ese backend no
// tiene) declara un `fragment` en el manifiesto con su descripcion y su prompt
// propios. La diferencia sigue siendo visible y tiene un sitio unico donde se
// edita, en vez de vivir escondida dentro del artefacto generado.

const { parsearFrontmatter, valorObligatorio, aTomlBasico, aTomlMultilinea } = require('./frontmatter');
const { quitarBloquesSoloClaude } = require('./command-body');

const MARCADOR_ARGUMENTOS = { gemini: { de: '$ARGUMENTS', a: '{{args}}' } };

/** `texto` con el marcador de argumentos de Claude traducido al de `backend`. */
function traducirArgumentos(texto, backend) {
  const marcador = MARCADOR_ARGUMENTOS[backend];
  return marcador ? texto.split(marcador.de).join(marcador.a) : texto;
}

/** El comando de `entrada` en el formato del backend de su output actual. */
function transformarComando(contenidoFuente, entrada = {}) {
  const backend = (entrada.output && entrada.output.backend) || entrada.backend;
  if (backend !== 'gemini') {
    throw new Error(`BACKEND_NOT_SUPPORTED: el transform de comandos no sabe generar para el backend "${backend}".`);
  }

  const declaraVariante = typeof entrada.fragmentContent === 'string';
  const origen = declaraVariante
    ? entrada.fragment || `${entrada.id} (fragmento)`
    : entrada.source || entrada.id || 'desconocido';

  const { campos, cuerpo } = parsearFrontmatter(
    declaraVariante ? entrada.fragmentContent : contenidoFuente,
    origen
  );

  const descripcion = valorObligatorio(campos, 'description', origen);
  const prompt = aTomlMultilinea(traducirArgumentos(quitarBloquesSoloClaude(cuerpo), backend));

  return `description = ${aTomlBasico(descripcion)}\n\nprompt = ${prompt}\n`;
}

module.exports = { transformarComando };

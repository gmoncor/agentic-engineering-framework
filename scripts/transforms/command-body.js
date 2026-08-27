'use strict';

// Retoques del CUERPO de un comando de Claude Code compartidos por los dos
// transforms que lo consumen: el que genera el `.toml` de Gemini
// (`command-to-backend`) y el que genera la skill de Codex y Antigravity
// (`command-to-skill`).
//
// El comando de `.claude/commands/` es el dueno canonico de las instrucciones,
// pero no todo lo que contiene vale para los demas backends. Cada retoque de
// aqui traduce o retira una parte concreta, y ninguno adivina: o el marcador
// esta escrito en la fuente, o la forma es la misma en todos los comandos.

/** Marcador de argumentos de Claude Code, al final del cuerpo de un comando. */
const MARCADOR_ARGUMENTOS = '$ARGUMENTS';

/**
 * Bloque delimitado por `<!-- solo-claude -->` y `<!-- /solo-claude -->`, con
 * su salto de linea de cierre y la linea en blanco que lo separa de lo
 * siguiente. Delimita el texto que SOLO vale en el backend de Claude Code.
 */
const BLOQUE_SOLO_CLAUDE =
  /^[^\S\n]*<!--[^\S\n]*solo-claude[^\S\n]*-->[\s\S]*?<!--[^\S\n]*\/solo-claude[^\S\n]*-->[^\S\n]*\n(?:[^\S\n]*\n)?/gm;

/**
 * Bloque final que pide la solicitud del usuario: el marcador de argumentos y,
 * si la precede, su linea de rotulo (`Solicitud del usuario:`). Solo se
 * reconoce al final del cuerpo, que es donde lo escriben todos los comandos.
 */
const BLOQUE_ARGUMENTOS = /\n\n(?:[^\n]*:[^\S\n]*\n\n)?\$ARGUMENTS[^\S\n]*\n*$/;

/**
 * Referencia a un comando por su barra (`/planificar`, con o sin comillas
 * invertidas). La mirada atras descarta las barras de una ruta con caracter
 * previo (`ai_docs/tasks/`, `../spec-x`): barata, pero no basta para una ruta
 * absoluta al inicio de frase, tras un espacio o tras dos puntos, que no
 * tiene nada que la mirada atras pueda excluir. El criterio que decide si es
 * una referencia real es la pertenencia al conjunto de comandos conocidos,
 * comprobada en `traducirReferenciasDeComando`.
 */
const REFERENCIA_DE_COMANDO = /(?<![\w/.\-])`?\/([a-z][a-z0-9-]*)`?/g;

/**
 * `cuerpo` sin los bloques marcados como exclusivos de Claude Code. Es la unica
 * via para que una instruccion viva en el comando canonico sin llegar a los
 * demas backends: sin marcador, todo el cuerpo viaja.
 */
function quitarBloquesSoloClaude(cuerpo) {
  return cuerpo.replace(BLOQUE_SOLO_CLAUDE, '');
}

/**
 * `cuerpo` sin el bloque final de argumentos. Lo usan los backends que invocan
 * la capacidad como skill: ahi no hay linea de comando donde escribir un
 * argumento, y dejar el rotulo prometeria una entrada que nunca llega.
 */
function quitarBloqueDeArgumentos(cuerpo) {
  return cuerpo.replace(BLOQUE_ARGUMENTOS, '\n');
}

/**
 * `cuerpo` con cada referencia `/<nombre>` reescrita como la skill homonima,
 * cuando `nombre` pertenece a `comandosConocidos`. Sin ese conjunto, conserva
 * el comportamiento anterior a esta funcion: un llamador que no sabe que
 * comandos existen no debe empezar a borrar traducciones legitimas en
 * silencio. Con el conjunto, una barra seguida de un nombre que no es un
 * comando declarado no se toca: es texto (a menudo una ruta) que no hay que
 * traducir.
 * En Codex y en Antigravity cada comando se entrega como skill: mantener la
 * barra mandaria al usuario a invocar algo que en su backend no existe.
 */
function traducirReferenciasDeComando(cuerpo, comandosConocidos) {
  return cuerpo.replace(REFERENCIA_DE_COMANDO, (coincidencia, nombre) => {
    if (comandosConocidos && !comandosConocidos.has(nombre)) return coincidencia;
    return `la skill \`${nombre}\``;
  });
}

module.exports = {
  MARCADOR_ARGUMENTOS,
  quitarBloquesSoloClaude,
  quitarBloqueDeArgumentos,
  traducirReferenciasDeComando,
};

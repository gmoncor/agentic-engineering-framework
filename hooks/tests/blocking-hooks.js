'use strict';

// Deriva de disco que hooks son bloqueantes, en vez de fiarse de una lista escrita a mano.
//
// Un hook es bloqueante cuando invoca la denegacion compartida (`deny`): sale con codigo de
// bloqueo y su veredicto para la accion del agente. Un hook advisory-only se restringe al canal
// informativo (`warn`) y nunca deniega. La diferencia decide dos obligaciones: entrar por el
// envoltorio de fallo seguro y declarar su firma de bloqueo en el registro.
//
// Vive en su propio modulo porque dos suites lo necesitan (envoltorio y firmas). Una lista
// escrita a mano -o duplicada- reabre el hueco que esto cierra: un hook bloqueante nuevo que
// ninguna cobertura cuenta, sin que nada falle.
//
// La derivacion se inclina a incluir de mas, nunca de menos: un fichero que invoca `deny` entra
// aunque sea una biblioteca. Sobrar en la lista provoca un fallo visible que se corrige; faltar
// es exactamente el silencio que hay que evitar.

const fs = require('fs');
const path = require('path');

// Suelo de la derivacion sobre el arbol real. Sin el, una derivacion que devuelva la lista
// vacia (import renombrado, fichero movido, regex roto) deja en verde toda la cobertura que la
// recorre: recorrer cero elementos no falla nunca.
const MIN_BLOCKING_HOOKS = 6;

const DENY_CALL_RE = /\bdeny\s*\(/;
// El modulo que DEFINE la denegacion no es un hook bloqueante: la exporta, no la ejerce.
const DENY_DEFINITION_RE = /function\s+deny\s*\(|\bdeny\s*[:=]\s*(?:function|\()/;

// Descarta las lineas que son solo comentario, incluidas las de continuacion de un bloque
// JSDoc: una mencion a deny() en prosa no es una invocacion. Heuristica deliberada, no un
// parser de JS; una llamada real no vive detras de un `//` a principio de linea.
function stripCommentLines(src) {
  return src.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n');
}

function isBlockingSource(src) {
  const code = stripCommentLines(src);
  return DENY_CALL_RE.test(code) && !DENY_DEFINITION_RE.test(code);
}

// Todos los .js de primer nivel del directorio: un hook nuevo entra en la cobertura sin tocar
// ningun test.
function hookFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
}

function listBlockingHooks(dir) {
  return hookFiles(dir)
    .filter((name) => isBlockingSource(fs.readFileSync(path.join(dir, name), 'utf8')));
}

module.exports = {
  MIN_BLOCKING_HOOKS,
  hookFiles,
  isBlockingSource,
  listBlockingHooks,
  stripCommentLines,
};

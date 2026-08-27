'use strict';

/**
 * Reconocimiento de invocaciones de git/gh en un string de comando de shell.
 *
 * Que problema resuelve: seis expresiones regulares repartidas en tres hooks respondian la
 * misma pregunta -- "¿este comando invoca realmente git <sub>, y con que flags?" -- buscando una
 * subcadena en el comando CRUDO. Eso falla en las dos direcciones: una opcion global entre `git`
 * y el subcomando (`git -c k=v commit`) rompe el match (fail-open, el bypass pasa), y el texto de
 * un mensaje que MENCIONA un flag (`-m "explica -n"`) lo dispara igual que si fuera un token real
 * (fail-closed, ruido). Este modulo tokeniza el comando (respetando comillas) y solo mira los
 * tokens que git recibiria como argv, nunca el texto libre.
 *
 * Por que no es una regex: "es esto un flag" depende de POSICION (dentro o fuera de comillas) y de
 * SEGMENTACION (que programa es este, tras que separadores de shell), dos cosas que una regex sobre
 * el string crudo no puede resolver sin volverse, en la practica, un tokenizador con otro nombre.
 *
 * Limite conocido: no evalua sustitucion de comandos ni expansion de variables. `git -c k=$(echo v)
 * commit` o `eval "$CMD"` no se resuelven -- el modulo no ejecuta nada, y un guard que ejecutara el
 * comando para decidir si bloquearlo seria peor que el problema que resuelve.
 */

// Separadores de shell que no van entrecomillados: parten la lista de tokens en invocaciones.
const SEPARADORES = new Set(['&&', '||', ';', '|', '\n']);

// Asignacion de entorno al inicio de una invocacion (FOO=bar git commit): no es el programa.
const ASIGNACION_ENTORNO_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Opciones globales de git/gh que consumen el token siguiente como valor, en su forma SIN "=".
// Con "=" el valor va pegado al propio token (--git-dir=/x) y no hace falta saltar nada.
// --repo/-R son el equivalente de gh a -C/-c: seleccionan el repo sobre el que opera el resto
// del comando, y su valor tampoco debe leerse como si fuera el subcomando.
const OPCIONES_GLOBALES_CON_VALOR = new Set([
  '-c', '-C', '--git-dir', '--work-tree', '--exec-path', '--namespace', '--repo', '-R',
]);

// Ejecutores de shell cuyo flag -c (o combinado, -lc) recibe el RESTO del segmento como un
// script anidado, no como sus propios flags/palabras: `bash -lc "git commit --no-verify"`
// invoca realmente `git commit`, no `bash`. Sin este caso, un comando entregado como argv
// (["bash","-lc","git commit ..."]) y aplanado a string por el llamador se leeria como
// palabras sueltas de bash y el bypass volveria a evadir el bloqueo.
const EJECUTORES_DE_SHELL = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const FLAG_DE_SCRIPT_RE = /^-[a-zA-Z]*c[a-zA-Z]*$/;

function esFlagDeScript(programa, flag) {
  return EJECUTORES_DE_SHELL.has(programa) && FLAG_DE_SCRIPT_RE.test(flag);
}

// Letras cortas de `git commit` que consumen un valor. Una vez alcanzada una de estas dentro de
// un grupo de flags cortos (-uno, -Cxyz...), el resto del grupo es el VALOR, no mas flags: por
// eso "-uno" no contiene "-n" (la "n" es el arranque de "no", el valor de -u).
const LETRAS_QUE_CONSUMEN_VALOR = ['m', 'u', 'c', 'C', 'F', 't', 'S'];

// Token que abre un heredoc: `<<DELIM`, `<<-DELIM`, `<<'DELIM'`, `<<"DELIM"`.
const HEREDOC_INICIO_RE = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/;

/**
 * Retira los cuerpos de heredoc de `cmd`. Un cuerpo de heredoc es el mensaje de un commit o el
 * body de un PR, no codigo de shell: sus lineas (que pueden mencionar "git commit" o "--no-verify"
 * como texto) no deben tokenizarse como comandos.
 */
function retirarHeredocs(cmd) {
  let out = cmd;
  let inicio = HEREDOC_INICIO_RE.exec(out);
  while (inicio) {
    const delimitador = inicio[2];
    let cursor = out.indexOf('\n', inicio.index + inicio[0].length);
    if (cursor === -1) {
      out = out.slice(0, inicio.index);
      break;
    }
    cursor += 1;

    let fin = out.length;
    while (cursor <= out.length) {
      let finLinea = out.indexOf('\n', cursor);
      if (finLinea === -1) finLinea = out.length;
      const linea = out.slice(cursor, finLinea);
      if (linea.trim() === delimitador) {
        fin = finLinea < out.length ? finLinea + 1 : finLinea;
        break;
      }
      if (finLinea === out.length) { fin = out.length; break; }
      cursor = finLinea + 1;
    }

    out = out.slice(0, inicio.index) + ' ' + out.slice(fin);
    inicio = HEREDOC_INICIO_RE.exec(out);
  }
  return out;
}

const ES_SEPARADOR_UN_CHAR = ch => ch === ';' || ch === '|' || ch === '&';
const ES_BLANCO = ch => ch === ' ' || ch === '\t' || ch === '\r';
const CORTA_PALABRA = ch => ES_BLANCO(ch) || ch === '\n' || ch === '"' || ch === "'" || ES_SEPARADOR_UN_CHAR(ch);

/**
 * tokenizar(cmd) -> [{ valor, entrecomillado }]
 *
 * Respeta comillas simples y dobles (el contenido entre comillas es UN token, marcado
 * entrecomillado). Una comilla sin cerrar cierra al final de la cadena: el resto de la entrada
 * se convierte en un unico token entrecomillado, de modo que los flags anteriores a la comilla
 * abierta siguen contando y la comilla no se vuelve una via de evasion. No lanza ante entrada
 * vacia, solo espacios, o comillas sin cerrar.
 */
function tokenizar(cmd) {
  const fuente = retirarHeredocs(String(cmd || ''));
  const tokens = [];
  const n = fuente.length;
  let i = 0;

  while (i < n) {
    const ch = fuente[i];

    if (ES_BLANCO(ch)) { i += 1; continue; }
    if (ch === '\n') { tokens.push({ valor: '\n', entrecomillado: false }); i += 1; continue; }
    if (ch === '&' && fuente[i + 1] === '&') { tokens.push({ valor: '&&', entrecomillado: false }); i += 2; continue; }
    if (ch === '|' && fuente[i + 1] === '|') { tokens.push({ valor: '||', entrecomillado: false }); i += 2; continue; }
    if (ES_SEPARADOR_UN_CHAR(ch)) { tokens.push({ valor: ch, entrecomillado: false }); i += 1; continue; }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && fuente[j] !== ch) j += 1;
      tokens.push({ valor: fuente.slice(i + 1, j), entrecomillado: true });
      i = j < n ? j + 1 : n;
      continue;
    }

    let j = i;
    while (j < n && !CORTA_PALABRA(fuente[j])) j += 1;
    tokens.push({ valor: fuente.slice(i, j), entrecomillado: false });
    i = j;
  }

  return tokens;
}

/**
 * Una invocacion (descarta asignaciones de entorno iniciales, toma el primer token restante
 * como `programa`, y recorre el resto acumulando en `flags` los tokens NO entrecomillados que
 * empiezan por "-" y en `palabras` los demas). Las opciones globales que consumen valor se
 * saltan junto a su valor. Si el programa es un ejecutor de shell y el flag es de tipo -c, el
 * resto del segmento no son sus flags/palabras: es un script anidado, y se re-analiza como una
 * invocacion propia (recursivo, por si el script anidado a su vez envuelve otro ejecutor).
 */
function parseSegmento(seg) {
  let idx = 0;
  while (idx < seg.length && !seg[idx].entrecomillado && ASIGNACION_ENTORNO_RE.test(seg[idx].valor)) idx += 1;
  if (idx >= seg.length) return [];

  const programa = seg[idx].valor;
  idx += 1;
  const palabras = [];
  const flags = [];

  while (idx < seg.length) {
    const tok = seg[idx];
    if (!tok.entrecomillado && OPCIONES_GLOBALES_CON_VALOR.has(tok.valor)) { idx += 2; continue; }
    if (!tok.entrecomillado && esFlagDeScript(programa, tok.valor)) {
      flags.push(tok.valor);
      return [{ programa, palabras, flags }, ...parseSegmento(seg.slice(idx + 1))];
    }
    if (!tok.entrecomillado && tok.valor.startsWith('-')) flags.push(tok.valor);
    else palabras.push(tok.valor);
    idx += 1;
  }

  return [{ programa, palabras, flags }];
}

/**
 * invocaciones(cmd) -> [{ programa, palabras, flags }]
 *
 * Parte los tokens en segmentos por separadores de shell no entrecomillados y analiza cada
 * segmento con parseSegmento. Ver parseSegmento para el criterio por invocacion.
 */
function invocaciones(cmd) {
  const tokens = tokenizar(cmd);

  const segmentos = [[]];
  for (const t of tokens) {
    if (!t.entrecomillado && SEPARADORES.has(t.valor)) segmentos.push([]);
    else segmentos[segmentos.length - 1].push(t);
  }

  const resultado = [];
  for (const seg of segmentos) resultado.push(...parseSegmento(seg));
  return resultado;
}

/** Invocaciones de `cmd` cuyo programa y prefijo de palabras casan con los dados. */
function invocacionesDe(cmd, programa, palabras) {
  return invocaciones(cmd).filter(inv => inv.programa === programa
    && palabras.every((p, i) => inv.palabras[i] === p));
}

/** esInvocacion(cmd, programa, palabras) -> true si alguna invocacion casa programa + prefijo. */
function esInvocacion(cmd, programa, palabras) {
  return invocacionesDe(cmd, programa, palabras).length > 0;
}

/**
 * usaFlag(invocacion, { largo, corto }) -> true si algun token de `flags` es exactamente `largo`
 * (o `largo=valor`), o si algun grupo de flags cortos contiene `corto` ANTES de la primera letra
 * que consume valor (LETRAS_QUE_CONSUMEN_VALOR).
 */
function usaFlag(invocacion, { largo, corto } = {}) {
  const flags = (invocacion && invocacion.flags) || [];

  if (largo && flags.some(f => f === largo || f.startsWith(largo + '='))) return true;
  if (!corto) return false;

  for (const f of flags) {
    if (!/^-[A-Za-z]+$/.test(f)) continue;
    for (const letra of f.slice(1)) {
      if (letra === corto) return true;
      if (LETRAS_QUE_CONSUMEN_VALOR.includes(letra)) break;
    }
  }
  return false;
}

module.exports = { tokenizar, invocaciones, invocacionesDe, esInvocacion, usaFlag };

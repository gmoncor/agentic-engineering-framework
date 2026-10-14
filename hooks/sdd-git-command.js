'use strict';

const path = require('path');

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
 *
 * Contrato de cada invocación (`invocaciones`):
 *   - `programa`, `palabras`, `flags`: lo que el programa recibe como argv, separado en flags (tokens
 *     sin comillas que empiezan por "-") y el resto.
 *   - `entorno`: las asignaciones de cabeza (`NOMBRE=valor git ...`) como pares `[nombre, valor]`.
 *   - `globales`: las opciones con valor separado (`-c`, `-C`, `--git-dir`...) que van entre el
 *     programa y su primera palabra, como pares `[opción, valor]`. Las posteriores no entran: en
 *     `git commit -C HEAD`, `-C` es una opción de `commit`, no un directorio.
 *   - `separadorAntes` / `separadorDespues`: el separador sin comillas que la precede y el que la
 *     sigue (`&&`, `||`, `;`, `|`, `&`, salto de línea), o `null` al principio o al final del script.
 *   - `grupos`: identificadores de los grupos abiertos que la contienen, del más externo al más
 *     interno (`( )`, `{ }`, `if … fi`, `while`/`until`/`for … done`), o `null` si las aperturas y
 *     cierres de su script no cuadran.
 *   - `script`: identificador del script; `0` en el nivel superior, uno propio por cada `bash -c`,
 *     cuerpo de función o alias de git con `!`.
 *   - `incompleta`: solo existe, con valor `true`, en la invocación que sustituye a un cuerpo de
 *     función no analizado por el tope de anidamiento (ver abajo).
 * Un alias en línea (`git -c alias.x=commit x`) añade la invocación expandida y conserva la
 * original. La llamada a una función sigue tres reglas:
 *   1. La invocación original se conserva: la llamada se analiza como invocación ordinaria y el
 *      cuerpo se añade, igual que un alias. `git() { command git "$@"; }; git commit -n` sigue
 *      siendo un `git commit` con `-n`.
 *   2. Cada cuerpo se expande como mucho una vez por orden (por identidad del cuerpo, no por
 *      nombre): una segunda llamada no aporta invocaciones nuevas, porque el cuerpo no depende de
 *      los argumentos. Así terminan la recursión directa y la mutua, y el coste es lineal.
 *   3. Con más de PROFUNDIDAD_MAXIMA_DE_FUNCIONES expansiones anidadas el cuerpo no se analiza: en
 *      su lugar se añade una invocación `git commit` con `--no-verify` en `flags` e
 *      `incompleta: true`, que hereda el contexto del punto de llamada (`script`, separadores y
 *      `grupos`). Lo que no puede analizarse cuenta como un commit posible.
 * El módulo no decide nada con estos campos: los consumen los hooks.
 */

// Builtins de git (`git --list-cmds=builtins`, git 2.43.0, 140 nombres). git ignora un alias cuyo
// nombre es un builtin (`git -c alias.status=log status` ejecuta `status`), así que un subcomando
// de esta lista nunca se expande. Si falta un builtin posterior, solo se añade una invocación de
// más: la original se conserva siempre.
const SUBCOMANDOS_BUILTIN_DE_GIT = new Set([
  'add', 'am', 'annotate', 'apply', 'archive', 'bisect', 'blame', 'branch', 'bugreport', 'bundle',
  'cat-file', 'check-attr', 'check-ignore', 'check-mailmap', 'check-ref-format', 'checkout',
  'checkout--worker', 'checkout-index', 'cherry', 'cherry-pick', 'clean', 'clone', 'column', 'commit',
  'commit-graph', 'commit-tree', 'config', 'count-objects', 'credential', 'credential-cache',
  'credential-cache--daemon', 'credential-store', 'describe', 'diagnose', 'diff', 'diff-files',
  'diff-index', 'diff-tree', 'difftool', 'fast-export', 'fast-import', 'fetch', 'fetch-pack',
  'fmt-merge-msg', 'for-each-ref', 'for-each-repo', 'format-patch', 'fsck', 'fsck-objects',
  'fsmonitor--daemon', 'gc', 'get-tar-commit-id', 'grep', 'hash-object', 'help', 'hook', 'index-pack',
  'init', 'init-db', 'interpret-trailers', 'log', 'ls-files', 'ls-remote', 'ls-tree', 'mailinfo',
  'mailsplit', 'maintenance', 'merge', 'merge-base', 'merge-file', 'merge-index', 'merge-ours',
  'merge-recursive', 'merge-recursive-ours', 'merge-recursive-theirs', 'merge-subtree', 'merge-tree',
  'mktag', 'mktree', 'multi-pack-index', 'mv', 'name-rev', 'notes', 'pack-objects', 'pack-redundant',
  'pack-refs', 'patch-id', 'pickaxe', 'prune', 'prune-packed', 'pull', 'push', 'range-diff',
  'read-tree', 'rebase', 'receive-pack', 'reflog', 'remote', 'remote-ext', 'remote-fd', 'repack',
  'replace', 'rerere', 'reset', 'restore', 'rev-list', 'rev-parse', 'revert', 'rm', 'send-pack',
  'shortlog', 'show', 'show-branch', 'show-index', 'show-ref', 'sparse-checkout', 'stage', 'stash',
  'status', 'stripspace', 'submodule--helper', 'switch', 'symbolic-ref', 'tag', 'unpack-file',
  'unpack-objects', 'update-index', 'update-ref', 'update-server-info', 'upload-archive',
  'upload-archive--writer', 'upload-pack', 'var', 'verify-commit', 'verify-pack', 'verify-tag',
  'version', 'whatchanged', 'worktree', 'write-tree',
]);

// Tope de expansiones de función anidadas (regla 3 de la cabecera). Una cadena de funciones
// distintas no repite cuerpo, así que la regla 2 no la corta; sin tope agotaría la pila. Una orden
// legítima no anida tantas funciones. En sdd-turn-budget.js la invocación por tope cuenta como un
// commit y reinicia el contador del agente, pero eso no abre un camino nuevo: cualquier `git
// commit` lo reinicia ya, aunque falle.
const PROFUNDIDAD_MAXIMA_DE_FUNCIONES = 32;

// Separadores de shell que no van entrecomillados: parten la lista de tokens en invocaciones.
const SEPARADORES = new Set(['&&', '||', ';', '|', '&', '\n']);

// Asignacion de entorno al inicio de una invocacion (FOO=bar git commit): no es el programa.
const ASIGNACION_ENTORNO_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const ASIGNACION_ENTORNO_CAPTURA_RE = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

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

// Envoltorios que anteponen su propio nombre al programa real sin cambiar la invocacion que
// git/gh reciben: `env git commit`, `/usr/bin/git commit`, `command git commit` y `sudo git
// commit` invocan git igual que `git commit` a secas (`sudo`/`doas` en su forma corriente, sin
// flags propios: `sudo -u otro git commit` cae en el LIMITE REAL de abajo). Se saltan (por su
// nombre base, para tolerar rutas absolutas) antes de fijar `programa`, siempre que no lleven
// flags propios.
//
// LIMITE REAL, no cosmetico (dueño mecanico: P19): un envoltorio CON flags/argumentos (`nice -n
// 10 git commit`, `timeout 30 git commit`, `xargs git commit -m x`, `sudo -u otro git commit`)
// no se resuelve -- el modulo no intenta aprender la gramatica de flags de cada programa externo
// posible. Para los consumidores que reemplazan una regex de subcadena cruda (sdd-turn-budget.js,
// sdd-review-gate.js), esto ES UNA REDUCCION real de lo que se detectaba antes: la regex vieja
// encontraba "git commit" en cualquier posicion del string, envoltorio con flags incluido. Si un
// caso asi importa en la practica, resolverlo exige una lista de flags por envoltorio (como
// OPCIONES_GLOBALES_CON_VALOR para git/gh), no extender este Set.
const ENVOLTORIOS_SIN_FLAGS = new Set(['env', 'command', 'nohup', 'stdbuf', 'nice', 'time', 'sudo', 'doas']);

// Envoltorios cuyos flags propios se enumeran explicitamente: `timeout 30 git commit` y `nice -n
// 10 git commit` no los resolvia ENVOLTORIOS_SIN_FLAGS, que solo descarta el nombre del
// envoltorio a secas, sin sus argumentos. El Set de cada entrada son los flags que consumen el
// token siguiente (mismo criterio que OPCIONES_GLOBALES_CON_VALOR); `xargs` no tiene entradas
// porque en el caso que importa aqui (`xargs git commit`) no antepone flags propios.
//
// LIMITE REAL remanente, no cosmetico (dueño mecanico: P19): un envoltorio no enumerado aqui con
// flags propios (`sudo -u otro git commit`) sigue sin resolverse -- enumerar los flags de cada
// wrapper externo posible no es el objetivo de este modulo.
const OPCIONES_ENVOLTORIO_CON_VALOR = {
  timeout: new Set(['-s', '--signal']),
  nice: new Set(['-n', '--adjustment']),
  xargs: new Set(),
};

// `timeout` exige DURATION como argumento posicional propio siempre, lleve o no `-s`/`--signal`
// -- a diferencia de `nice`, cuyo unico argumento propio ya es el valor de `-n`. Sin este Set,
// `timeout 30 git commit` dejaria "30" fijado como `programa`.
const ENVOLTORIOS_CON_POSICIONAL_PROPIO = new Set(['timeout']);

/**
 * Si `seg[idx]` es un envoltorio de OPCIONES_ENVOLTORIO_CON_VALOR, devuelve el indice tras saltar
 * sus pares flag-valor (encadenados, uno tras otro) y su posicional propio si aplica. Devuelve
 * null cuando el token no es un envoltorio de esta tabla, o cuando ENVOLTORIOS_SIN_FLAGS ya lo
 * cubre y no hay flag/posicional propio que saltar -- ese caso lo resuelve el camino simple de
 * esPrefijoDescartable, para no duplicar logica.
 */
function saltarEnvoltorioConValor(seg, idx) {
  const nombre = path.basename(seg[idx].valor);
  const flagsConValor = OPCIONES_ENVOLTORIO_CON_VALOR[nombre];
  if (!flagsConValor) return null;

  let cursor = idx + 1;
  while (cursor < seg.length && !seg[cursor].entrecomillado && flagsConValor.has(seg[cursor].valor)) {
    cursor += 2;
  }

  const saltoFlags = cursor > idx + 1;
  const tienePosicional = ENVOLTORIOS_CON_POSICIONAL_PROPIO.has(nombre)
    && cursor < seg.length && !seg[cursor].entrecomillado && !seg[cursor].valor.startsWith('-');
  if (tienePosicional) cursor += 1;

  return (saltoFlags || tienePosicional || !ENVOLTORIOS_SIN_FLAGS.has(nombre)) ? cursor : null;
}

// Tokens de sintaxis de shell que nunca son el programa de una invocacion: aparecen en cabeza de
// segmento cuando una agrupacion (bloque, subshell, condicional, bucle, negacion) envuelve la
// invocacion real. `case`/`esac` y la definicion de funcion (`f() { ... }`) quedan fuera de este
// Set a proposito: en ambos, el programa real esta TRAS una palabra suelta (el patron de `case`,
// el nombre de la funcion) que ningun descarte de un solo token puede saltar sin adivinar donde
// termina -- parseSegmento y extraerFunciones (mas abajo) los resuelven con tratamiento propio.
const SINTAXIS_DE_SHELL = new Set([
  '(', ')', '{', '}', '!', 'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'for', 'do', 'done',
]);

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

const ES_SEPARADOR_UN_CHAR = ch => ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')';
const ES_BLANCO = ch => ch === ' ' || ch === '\t' || ch === '\r';
const CORTA_PALABRA = ch => ES_BLANCO(ch) || ch === '\n' || ES_SEPARADOR_UN_CHAR(ch);

/**
 * tokenizar(cmd) -> [{ valor, entrecomillado }]
 *
 * Forma las palabras como el shell: las piezas adyacentes sin blanco entre ellas (texto sin
 * comillas, `'…'` y `"…"`) son UN token, con las comillas retiradas (`alias.x='commit -n'` da
 * `alias.x=commit -n`). `entrecomillado` vale true solo si todas las piezas iban entre comillas:
 * basta una sin comillas para que valga false, porque el shell quita las comillas y una palabra
 * mixta que empieza por "-" (`"--no-"verify`) llega al programa como flag. Los separadores solo
 * cortan la palabra fuera de comillas. Una comilla sin cerrar cierra al final de la cadena: la
 * pieza abierta llega hasta el final de la entrada, de modo que los flags anteriores a la comilla
 * siguen contando y la comilla no se vuelve una vía de evasión. No lanza ante entrada vacía, solo
 * espacios, o comillas sin cerrar.
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

    let valor = '';
    let todasEntrecomilladas = true;
    let j = i;
    while (j < n && !CORTA_PALABRA(fuente[j])) {
      // Comillas simples: literal hasta el cierre, sin procesar escapes (asi las trata la shell).
      if (fuente[j] === "'") {
        let k = j + 1;
        while (k < n && fuente[k] !== "'") k += 1;
        valor += fuente.slice(j + 1, k);
        j = k < n ? k + 1 : n;
        continue;
      }

      // Comillas dobles: `\"` y `\\` son escapes reales dentro de un string entrecomillado (asi los
      // resuelve la shell antes de que el programa reciba el argumento). Sin desescaparlos, la
      // PRIMERA comilla escapada de un script anidado (`bash -lc "git commit -m \"x\""`) se lee
      // como el cierre real, partiendo el script a mitad de camino -- el resto deja de
      // tokenizarse como la invocacion de git que es.
      if (fuente[j] === '"') {
        let k = j + 1;
        while (k < n && fuente[k] !== '"') {
          if (fuente[k] === '\\' && k + 1 < n && (fuente[k + 1] === '"' || fuente[k + 1] === '\\')) {
            valor += fuente[k + 1];
            k += 2;
          } else {
            valor += fuente[k];
            k += 1;
          }
        }
        j = k < n ? k + 1 : n;
        continue;
      }

      valor += fuente[j];
      todasEntrecomilladas = false;
      j += 1;
    }
    tokens.push({ valor, entrecomillado: todasEntrecomilladas });
    i = j;
  }

  return tokens;
}

// Un token en cabeza de segmento que nunca es `programa`: asignacion de entorno, sintaxis de
// shell o envoltorio sin flags, en cualquier orden y cualquier alternacion de los tres. Un orden
// fijo de pasadas (primero asignaciones, luego envoltorios) no tolera la alternacion -- `env
// FOO=bar git commit` la burla porque `env` no es asignacion y `FOO=bar` no es envoltorio, cada
// pasada se detiene ante lo que la otra sabe descartar. Un unico predicado que se reevalua en
// cada token si tolera cualquier orden.
function esPrefijoDescartable(tok) {
  return !tok.entrecomillado && (
    ASIGNACION_ENTORNO_RE.test(tok.valor)
    || SINTAXIS_DE_SHELL.has(tok.valor)
    || ENVOLTORIOS_SIN_FLAGS.has(path.basename(tok.valor))
  );
}

// `nombre() { cuerpo }` define una funcion: no es una invocacion, es un registro para cuando ese
// nombre se use despues como palabra de cabeza de segmento. `profundidad` tolera llaves anidadas
// dentro del cuerpo (un `if`/subshell interno con sus propias `{ }`) sin cerrar en la primera.
function esNombreDeFuncion(tok) {
  return !tok.entrecomillado && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok.valor);
}

/**
 * extraerFunciones(tokens) -> { tokens, funciones }
 *
 * Retira del stream cada definicion `nombre() { cuerpo }` y la registra en `funciones` (nombre ->
 * tokens del cuerpo). El stream que devuelve ya no contiene la definicion: definirla no invoca
 * nada: solo se convierte en invocacion cuando ese nombre aparece luego como cabeza de segmento
 * (ver el uso de `funciones` en parseSegmento).
 */
function extraerFunciones(tokens) {
  const funciones = new Map();
  const salida = [];
  let i = 0;

  while (i < tokens.length) {
    const esDefinicion = i + 3 < tokens.length
      && esNombreDeFuncion(tokens[i])
      && !tokens[i + 1].entrecomillado && tokens[i + 1].valor === '('
      && !tokens[i + 2].entrecomillado && tokens[i + 2].valor === ')'
      && !tokens[i + 3].entrecomillado && tokens[i + 3].valor === '{';

    if (!esDefinicion) { salida.push(tokens[i]); i += 1; continue; }

    let profundidad = 1;
    let j = i + 4;
    while (j < tokens.length && profundidad > 0) {
      if (!tokens[j].entrecomillado && tokens[j].valor === '{') profundidad += 1;
      else if (!tokens[j].entrecomillado && tokens[j].valor === '}') profundidad -= 1;
      if (profundidad > 0) j += 1;
    }

    funciones.set(tokens[i].valor, tokens.slice(i + 4, j));
    i = j + 1;
  }

  return { tokens: salida, funciones };
}

/**
 * Índice del primer token de `seg` tras el prefijo de asignaciones/sintaxis/envoltorios: el
 * `programa` de la invocación, o `seg.length` si el segmento es solo prefijo.
 */
function finDelPrefijo(seg) {
  let idx = 0;
  while (idx < seg.length) {
    const tok = seg[idx];
    if (!tok.entrecomillado) {
      const salto = saltarEnvoltorioConValor(seg, idx);
      if (salto !== null) { idx = salto; continue; }
    }
    if (esPrefijoDescartable(tok)) { idx += 1; continue; }
    break;
  }
  return idx;
}

function nuevoScript(estado) {
  estado.scripts += 1;
  return estado.scripts;
}

function invocacion(programa, palabras, flags, entorno, globales, ctx) {
  return {
    programa,
    palabras,
    flags,
    entorno,
    globales,
    separadorAntes: ctx.antes,
    separadorDespues: ctx.despues,
    grupos: ctx.grupos ? [...ctx.grupos] : null,
    script: ctx.script,
  };
}

// Alias en línea de las `-c` anteriores al subcomando: nombre (en minúsculas, como lo normaliza
// git) -> valor. Una definición posterior del mismo nombre sustituye a la anterior, como en git.
function aliasesDe(globales) {
  const aliases = new Map();
  for (const [opcion, valor] of globales) {
    if (opcion !== '-c' || typeof valor !== 'string') continue;
    const igual = valor.indexOf('=');
    if (igual === -1) continue;
    const clave = valor.slice(0, igual).toLowerCase();
    if (clave.startsWith('alias.') && clave.length > 'alias.'.length) {
      aliases.set(clave.slice('alias.'.length), valor.slice(igual + 1));
    }
  }
  return aliases;
}

/**
 * Invocaciones que añade un alias en línea de git (`git -c alias.x='commit -n' x`). El subcomando
 * se expande solo si no es un builtin, y la cadena (`alias.x=y`, `alias.y=commit`) se sigue hasta
 * un builtin o una palabra sin alias; los argumentos de cada paso se acumulan delante de los que
 * seguían al subcomando. Un nombre repetido es un bucle, que git rechaza: no se añade nada. Un
 * alias con `!` es un script de shell propio, sin las `globales` de la original.
 */
function expandirAlias(original, seg, idxSubcomando, ctx) {
  const aliases = aliasesDe(original.globales);
  if (aliases.size === 0) return [];

  const subcomando = seg[idxSubcomando];
  if (SUBCOMANDOS_BUILTIN_DE_GIT.has(subcomando.valor)) return [];

  const visitados = new Set();
  let actual = subcomando;
  const pasos = [];
  let scriptDeShell = null;
  for (;;) {
    const nombre = actual.valor.toLowerCase();
    if (!aliases.has(nombre)) break;
    if (visitados.has(nombre)) return [];
    visitados.add(nombre);

    const definicion = aliases.get(nombre);
    if (definicion.startsWith('!')) { scriptDeShell = definicion.slice(1); break; }
    const tokens = tokenizar(definicion);
    if (tokens.length === 0) return [];
    pasos.push(tokens.slice(1));
    actual = tokens[0];
    if (SUBCOMANDOS_BUILTIN_DE_GIT.has(actual.valor)) break;
  }
  if (visitados.size === 0) return [];

  // Cada paso va delante de los anteriores: se recorren en orden inverso una sola vez.
  const delante = pasos.reverse().flat();
  const argumentos = seg.slice(idxSubcomando + 1);
  if (scriptDeShell !== null) {
    const anidado = extraerFunciones([...tokenizar(scriptDeShell), ...delante, ...argumentos]);
    return invocacionesDeTokens(anidado.tokens, anidado.funciones, ctx.estado, nuevoScript(ctx.estado));
  }

  const expandidas = parseSegmento(
    [{ valor: 'git', entrecomillado: false }, actual, ...delante, ...argumentos],
    ctx,
  );
  for (const inv of expandidas) {
    if (inv.script !== ctx.script) continue;
    inv.entorno = original.entorno.map(par => [...par]);
    inv.globales = [...original.globales.map(par => [...par]), ...inv.globales];
  }
  return expandidas;
}

/**
 * Una invocacion (descarta el prefijo de asignaciones/sintaxis/envoltorios en cabeza de
 * segmento, toma el primer token restante como `programa`, y recorre el resto acumulando en
 * `flags` los tokens NO entrecomillados que empiezan por "-" y en `palabras` los demas). Las
 * opciones globales que consumen valor se saltan junto a su valor. Si el programa es un ejecutor
 * de shell y el flag es de tipo -c, el resto del segmento no son sus flags/palabras: es un
 * script anidado, y se re-analiza como una invocacion propia (recursivo, por si el script
 * anidado a su vez envuelve otro ejecutor).
 *
 * `case ... in PATRON) cuerpo ;; esac`: el programa real esta tras el `)` que cierra el patron,
 * no en el patron mismo (que puede citar "git commit" como texto sin ser una invocacion). Se
 * localiza el primer `)` no entrecomillado del segmento y se re-analiza todo lo posterior.
 *
 * Si la cabeza de segmento es un nombre registrado en `funciones` (ver extraerFunciones), se
 * añaden las invocaciones de su cuerpo (ver invocacionesDeFuncion) y el segmento sigue
 * analizándose como invocación ordinaria.
 *
 * `ctx` lleva las funciones, el estado de identificadores, el script, los separadores y los
 * grupos que heredan las invocaciones de este segmento.
 */
function parseSegmento(seg, ctx) {
  const { funciones, estado } = ctx;
  let idx = finDelPrefijo(seg);
  if (idx >= seg.length) return [];

  const entorno = [];
  for (const tok of seg.slice(0, idx)) {
    const asignacion = tok.entrecomillado ? null : ASIGNACION_ENTORNO_CAPTURA_RE.exec(tok.valor);
    if (asignacion) entorno.push([asignacion[1], asignacion[2]]);
  }

  const cabeza = seg[idx];
  if (!cabeza.entrecomillado && cabeza.valor === 'case') {
    const cierre = seg.findIndex((t, i) => i > idx && !t.entrecomillado && t.valor === ')');
    return cierre === -1 ? [] : parseSegmento(seg.slice(cierre + 1), ctx);
  }
  const delCuerpo = !cabeza.entrecomillado && funciones.has(cabeza.valor)
    ? invocacionesDeFuncion(funciones.get(cabeza.valor), ctx)
    : [];

  const programa = path.basename(cabeza.valor);
  idx += 1;
  const palabras = [];
  const flags = [];
  const globales = [];
  let idxSubcomando = -1;

  while (idx < seg.length) {
    const tok = seg[idx];
    if (!tok.entrecomillado && esFlagDeScript(programa, tok.valor)) {
      flags.push(tok.valor);
      const propia = invocacion(programa, palabras, flags, entorno, globales, ctx);
      const resto = seg.slice(idx + 1);
      // El script en una sola palabra se re-tokeniza: entrecomillado entero (`bash -c "git
      // commit"`) o mixto con blanco dentro (`bash -c git' commit --no-verify'`), que si no
      // quedaría como un `programa` con la cadena entera.
      if (resto.length === 1 && (resto[0].entrecomillado || /[ \t\r\n]/.test(resto[0].valor))) {
        return [propia, ...delCuerpo, ...invocacionesDeCadena(resto[0].valor, estado, nuevoScript(estado))];
      }
      return [propia, ...delCuerpo, ...invocacionesDeTokens(resto, funciones, estado, nuevoScript(estado))];
    }
    if (!tok.entrecomillado && OPCIONES_GLOBALES_CON_VALOR.has(tok.valor)) {
      if (palabras.length === 0) globales.push([tok.valor, idx + 1 < seg.length ? seg[idx + 1].valor : null]);
      idx += 2;
      continue;
    }
    if (!tok.entrecomillado && tok.valor.startsWith('-')) flags.push(tok.valor);
    else {
      if (palabras.length === 0) idxSubcomando = idx;
      palabras.push(tok.valor);
    }
    idx += 1;
  }

  const propia = invocacion(programa, palabras, flags, entorno, globales, ctx);
  if (programa !== 'git' || idxSubcomando === -1) return [propia, ...delCuerpo];
  return [propia, ...delCuerpo, ...expandirAlias(propia, seg, idxSubcomando, ctx)];
}

/**
 * Invocaciones del cuerpo de una función llamada desde el segmento de `ctx` (reglas 2 y 3 de la
 * cabecera): vacío si el cuerpo ya se expandió en esta orden; la invocación `incompleta` si se
 * supera el tope de anidamiento; si no, las del cuerpo como script propio.
 */
function invocacionesDeFuncion(cuerpo, ctx) {
  const { funciones, estado } = ctx;
  if (estado.expandidos.has(cuerpo)) return [];
  if (estado.profundidad >= PROFUNDIDAD_MAXIMA_DE_FUNCIONES) {
    const incompleta = invocacion('git', ['commit'], ['--no-verify'], [], [], ctx);
    incompleta.incompleta = true;
    return [incompleta];
  }
  estado.expandidos.add(cuerpo);
  estado.profundidad += 1;
  try {
    return invocacionesDeTokens(cuerpo, funciones, estado, nuevoScript(estado));
  } finally {
    estado.profundidad -= 1;
  }
}

/** Parte `tokens` en segmentos por los separadores de shell no entrecomillados. */
function segmentar(tokens) {
  return segmentarConSeparadores(tokens).map(s => s.seg);
}

// Igual que segmentar, pero cada segmento conserva el separador que lo precede y el que lo sigue.
function segmentarConSeparadores(tokens) {
  const segmentos = [{ seg: [], antes: null, despues: null }];
  for (const t of tokens) {
    if (!t.entrecomillado && SEPARADORES.has(t.valor)) {
      segmentos[segmentos.length - 1].despues = t.valor;
      segmentos.push({ seg: [], antes: t.valor, despues: null });
    } else {
      segmentos[segmentos.length - 1].seg.push(t);
    }
  }
  return segmentos;
}

// Aperturas y cierres de grupo. Los paréntesis cuentan en cualquier posición; las llaves y las
// palabras clave, solo en posición de orden (en el prefijo que finDelPrefijo descarta).
const CIERRE_DE_GRUPO = { '(': ')', '{': '}', if: 'fi', while: 'done', until: 'done', for: 'done' };
const CIERRES_DE_GRUPO = new Set(Object.values(CIERRE_DE_GRUPO));

/**
 * Parte `tokens` en segmentos y analiza cada uno como parte del script `script`. Sigue la pila de
 * grupos abiertos para el campo `grupos`; si las aperturas y cierres no cuadran, las invocaciones
 * de este script llevan `grupos: null`.
 */
function invocacionesDeTokens(tokens, funciones, estado, script) {
  const resultado = [];
  const pila = [];
  let cuadra = true;

  const aplicar = (tok, enOrden) => {
    if (tok.entrecomillado) return;
    const v = tok.valor;
    if (v === '(' || (enOrden && Object.prototype.hasOwnProperty.call(CIERRE_DE_GRUPO, v))) {
      estado.grupos += 1;
      pila.push({ id: estado.grupos, cierre: CIERRE_DE_GRUPO[v] });
    } else if (v === ')' || (enOrden && CIERRES_DE_GRUPO.has(v))) {
      const abierto = pila.pop();
      if (!abierto || abierto.cierre !== v) cuadra = false;
    }
  };

  for (const { seg, antes, despues } of segmentarConSeparadores(tokens)) {
    const fin = finDelPrefijo(seg);
    for (let k = 0; k < fin; k += 1) aplicar(seg[k], true);
    const grupos = pila.map(g => g.id);
    for (let k = fin; k < seg.length; k += 1) {
      if (seg[k].valor === '(' || seg[k].valor === ')') aplicar(seg[k], false);
    }
    // Un bucle y no `push(...)`: un segmento puede devolver un número no acotado de invocaciones
    // (el cuerpo de una función), y pasarlas como argumentos agotaría la pila.
    for (const inv of parseSegmento(seg, { funciones, estado, script, antes, despues, grupos })) {
      resultado.push(inv);
    }
  }

  if (!cuadra || pila.length > 0) {
    for (const inv of resultado) if (inv.script === script) inv.grupos = null;
  }
  return resultado;
}

// Extrae las funciones de `cmd` y analiza el resto como el script `script`.
function invocacionesDeCadena(cmd, estado, script) {
  const { tokens, funciones } = extraerFunciones(tokenizar(cmd));
  return invocacionesDeTokens(tokens, funciones, estado, script);
}

/**
 * invocaciones(cmd) -> [{ programa, palabras, flags, entorno, globales, separadorAntes,
 *                         separadorDespues, grupos, script[, incompleta] }]
 *
 * Extrae las definiciones de funcion del comando (ver extraerFunciones) y analiza el resto del
 * stream con invocacionesDeTokens. Ver parseSegmento para el criterio por invocación y la
 * cabecera del modulo para el contrato de cada campo.
 */
function invocaciones(cmd) {
  return invocacionesDeCadena(cmd, { scripts: 0, grupos: 0, expandidos: new Set(), profundidad: 0 }, 0);
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

module.exports = { tokenizar, segmentar, invocaciones, invocacionesDe, esInvocacion, usaFlag };

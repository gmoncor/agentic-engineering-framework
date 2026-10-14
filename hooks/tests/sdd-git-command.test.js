'use strict';

// Contrato de sdd-git-command.js: reconocer si un string de comando de shell invoca
// realmente `programa <subcomando...>` y si esa invocacion pasa un flag concreto COMO
// TOKEN, no como subcadena. Sin lanzar procesos: todo el modulo es puro y sincrono.

const test = require('node:test');
const assert = require('node:assert');
const { tokenizar, invocaciones, esInvocacion, usaFlag } = require('../sdd-git-command');

// ─── tokenizar: casos minimos ────────────────────────────────────────────────

test('tokenizar: comando simple', () => {
  const t = tokenizar('git commit -m x');
  assert.deepStrictEqual(t.map(x => x.valor), ['git', 'commit', '-m', 'x']);
  assert.ok(t.every(x => x.entrecomillado === false));
});

test('tokenizar: comando envuelto (cd x && git commit -m y)', () => {
  const t = tokenizar('cd x && git commit -m y');
  assert.deepStrictEqual(t.map(x => x.valor), ['cd', 'x', '&&', 'git', 'commit', '-m', 'y']);
});

test('tokenizar: separadores no entrecomillados ; y ||', () => {
  assert.deepStrictEqual(tokenizar('a ; b').map(x => x.valor), ['a', ';', 'b']);
  assert.deepStrictEqual(tokenizar('a || b').map(x => x.valor), ['a', '||', 'b']);
  assert.deepStrictEqual(tokenizar('a | b').map(x => x.valor), ['a', '|', 'b']);
});

test('tokenizar: comillas dobles y simples marcan el token como entrecomillado', () => {
  const t = tokenizar('git commit -m "hola mundo"');
  const msg = t[t.length - 1];
  assert.strictEqual(msg.valor, 'hola mundo');
  assert.strictEqual(msg.entrecomillado, true);

  const t2 = tokenizar("git commit -m 'hola mundo'");
  assert.strictEqual(t2[t2.length - 1].entrecomillado, true);
});

test('tokenizar: comilla sin cerrar cierra al final de la cadena, no lanza', () => {
  assert.doesNotThrow(() => tokenizar('git commit --no-verify -m "sin cerrar'));
  const t = tokenizar('git commit --no-verify -m "sin cerrar');
  const ultimo = t[t.length - 1];
  assert.strictEqual(ultimo.entrecomillado, true);
  assert.strictEqual(ultimo.valor, 'sin cerrar');
  // Los flags que aparecieron ANTES de la comilla abierta siguen contando.
  assert.ok(t.some(x => x.valor === '--no-verify' && x.entrecomillado === false));
});

test('tokenizar: comando vacio o solo espacios no lanza y devuelve lista vacia', () => {
  assert.deepStrictEqual(tokenizar(''), []);
  assert.deepStrictEqual(tokenizar('   '), []);
});

test('tokenizar: heredoc retira el cuerpo del mensaje, que no es codigo de shell', () => {
  const cmd = 'git commit -F - <<\'EOF\'\ngit commit esto es solo texto\n--no-verify tambien texto\nEOF';
  const t = tokenizar(cmd);
  assert.deepStrictEqual(t.map(x => x.valor), ['git', 'commit', '-F', '-']);
});

// ─── invocaciones / esInvocacion: casos minimos de reconocimiento ───────────

test('esInvocacion: git commit simple', () => {
  assert.strictEqual(esInvocacion('git commit -m x', 'git', ['commit']), true);
});

test('esInvocacion: git -c k=v commit (opcion global con valor separado)', () => {
  assert.strictEqual(esInvocacion('git -c core.hooksPath=/tmp commit --no-verify -m x', 'git', ['commit']), true);
});

test('esInvocacion: git -C /ruta commit', () => {
  assert.strictEqual(esInvocacion('git -C /ruta commit -m x', 'git', ['commit']), true);
});

test('esInvocacion: git --git-dir=/x commit (con =, autocontenido, no consume token)', () => {
  assert.strictEqual(esInvocacion('git --git-dir=/x commit -m x', 'git', ['commit']), true);
});

test('esInvocacion: git --no-pager log', () => {
  assert.strictEqual(esInvocacion('git --no-pager log', 'git', ['log']), true);
});

test('esInvocacion: gh --repo o/r pr create (opcion global de gh con valor separado)', () => {
  assert.strictEqual(esInvocacion('gh --repo org/repo pr create', 'gh', ['pr', 'create']), true);
});

test('esInvocacion negativo: grep -r "git commit" README.md no es una invocacion de git', () => {
  assert.strictEqual(esInvocacion('grep -r "git commit" README.md', 'git', ['commit']), false);
});

test('esInvocacion negativo: echo "git commit" no es una invocacion de git', () => {
  assert.strictEqual(esInvocacion('echo "git commit"', 'git', ['commit']), false);
});

test('esInvocacion: bash -lc git commit ... (sin comillas) reconoce la invocacion anidada de git', () => {
  // Un comando entregado como argv (["bash","-lc","git commit --no-verify -m x"]) se aplana a
  // este string exacto antes de llegar al modulo: sin desenvolver el -lc, "git commit" se leeria
  // como palabras sueltas de bash, no como una invocacion de git.
  assert.strictEqual(esInvocacion('bash -lc git commit --no-verify -m "fix: algo"', 'git', ['commit']), true);
});

// Regresion: la forma ENTRECOMILLADA (bash -lc "script") es la que de verdad escribe cualquier
// persona o agente en una tool call de shell -- la forma sin comillas del test anterior no la
// cubre porque los tokens ya llegan sueltos. Sin re-tokenizar el script anidado, `programa`
// terminaba siendo el script completo ("git commit --no-verify -m x"), nunca "git".
for (const ejecutor of ['bash -lc', 'bash -c', 'sh -c']) {
  test(`esInvocacion: ${ejecutor} "git commit --no-verify" (script entrecomillado) reconoce git`, () => {
    assert.strictEqual(
      esInvocacion(`${ejecutor} "git commit --no-verify -m x"`, 'git', ['commit']),
      true,
    );
  });
}

test('esInvocacion: envoltorios sin flags (env/command) no ocultan al programa real', () => {
  assert.strictEqual(esInvocacion('env git commit --no-verify -m x', 'git', ['commit']), true);
  assert.strictEqual(esInvocacion('command git commit --no-verify -m x', 'git', ['commit']), true);
});

test('esInvocacion: ruta absoluta al binario se normaliza al nombre base', () => {
  assert.strictEqual(esInvocacion('/usr/bin/git commit --no-verify -m x', 'git', ['commit']), true);
});

// Regresion: un script anidado con comillas DOBLES escapadas dentro (`\"`) es la forma real que
// produce, por ejemplo, un mensaje de commit citado -- `bash -lc "git commit -m \"x\""`. Sin
// desescapar, la primera `\"` se leia como el cierre real del string exterior, partiendo el
// script a mitad de camino: el resto ("x\"") dejaba de tokenizarse como parte de la invocacion
// de git, y el conjunto volvia a evadir el bloqueo que este mismo tokenizador dice cerrar.
test('esInvocacion: script anidado con comillas dobles escapadas dentro sigue reconociendo git', () => {
  assert.strictEqual(
    esInvocacion('bash -lc "git commit -m \\"mensaje\\""', 'git', ['commit']),
    true,
  );
  assert.strictEqual(
    esInvocacion('bash -c "git commit --amend -m \\"x\\""', 'git', ['commit']),
    true,
  );
});

test('esInvocacion: script anidado dos veces, cada nivel con sus propias comillas escapadas', () => {
  assert.strictEqual(
    esInvocacion('bash -lc "bash -c \\"git commit -m x\\""', 'git', ['commit']),
    true,
  );
});

test('tokenizar: comillas simples no procesan escapes (backslash literal, a diferencia de las dobles)', () => {
  const toks = tokenizar("echo 'a\\\\b'");
  assert.deepStrictEqual(toks[1], { valor: 'a\\\\b', entrecomillado: true });
});

test('invocaciones: descarta asignaciones de entorno iniciales', () => {
  const inv = invocaciones('FOO=bar git commit -m x');
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(inv[0].programa, 'git');
  assert.deepStrictEqual(inv[0].palabras, ['commit', 'x']);
});

// ─── usaFlag: casos minimos de flags ─────────────────────────────────────────

function invDe(cmd, programa, palabras) {
  return invocaciones(cmd).find(i => i.programa === programa && palabras.every((p, idx) => i.palabras[idx] === p));
}

test('usaFlag: --no-verify como token', () => {
  const inv = invDe('git commit --no-verify -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), true);
});

test('usaFlag: --no-verify dentro del mensaje no cuenta (texto, no token)', () => {
  const inv = invDe('git commit -m "docs: --no-verify esta prohibido"', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), false);
});

test('usaFlag: -n suelto se detecta', () => {
  const inv = invDe('git commit -n -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), true);
});

test('usaFlag: -na (grupo que empieza por -n) se detecta', () => {
  const inv = invDe('git commit -na -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), true);
});

test('usaFlag: -an (grupo que termina en -n) se detecta', () => {
  const inv = invDe('git commit -an -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), true);
});

test('usaFlag: -am (grupo sin -n) no se detecta', () => {
  const inv = invDe('git commit -am -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), false);
});

test('usaFlag: -uno (la n es VALOR de -u, no es -n)', () => {
  const inv = invDe('git commit -uno -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), false);
});

test('usaFlag: -m "texto con -n" no cuenta el -n del texto', () => {
  const inv = invDe('git commit -m "texto con -n"', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), false);
});

test('usaFlag: --no-verify=algo cuenta por prefijo largo=valor', () => {
  const inv = invDe('git commit --no-verify=si -m x', 'git', ['commit']);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify' }), true);
});

// ─── Rejilla generada: clase completa de entradas que la regex vieja daba por positivas ────
//
// La regex que este modulo reemplazo era /\bgit\s+(commit|merge)\b/: encontraba la invocacion
// en CUALQUIER posicion del string, sin importar separador, agrupacion o envoltorio de shell.
// Enumerar bypasses conocidos uno a uno solo acredita los que ya se conocen (asi se colaron la
// segunda y la tercera tanda de esta misma clase). La rejilla cubre el producto cartesiano de
// los cuatro ejes que determinan si el tokenizador llega a "programa === git": ninguna fila se
// escribe a mano, asi que un eje nuevo multiplica la cobertura sin tocar los tests.

// Predicado que este modulo reemplazo por el tokenizador. Sigue aqui solo para medir la clase:
// toda fila de la rejilla debe ser positiva para ella, o la rejilla estaria midiendo otra cosa.
const REGEX_SUSTITUIDA = /\bgit\s+(commit|merge)\b/;

const COMANDO_BASE = 'git commit -m x';

// 7 separadores de shell no entrecomillados.
const SEPARADORES_DE_REJILLA = [
  { id: 'ninguno', envolver: cmd => cmd },
  { id: ';', envolver: cmd => `true; ${cmd}` },
  { id: '&&', envolver: cmd => `true && ${cmd}` },
  { id: '||', envolver: cmd => `false || ${cmd}` },
  { id: '|', envolver: cmd => `true | ${cmd}` },
  { id: '&', envolver: cmd => `true & ${cmd}` },
  { id: 'salto de linea', envolver: cmd => `true\n${cmd}` },
];

// 9 agrupaciones de shell (bloques, subshell, condicionales, bucles, negacion).
const AGRUPACIONES = [
  { id: 'ninguna', envolver: cmd => cmd },
  { id: '{ }', envolver: cmd => `{ ${cmd}; }` },
  { id: '( )', envolver: cmd => `(${cmd})` },
  { id: 'if-then-fi', envolver: cmd => `if true; then ${cmd}; fi` },
  { id: 'if-then-else-fi', envolver: cmd => `if false; then true; else ${cmd}; fi` },
  { id: 'for-do-done', envolver: cmd => `for i in 1; do ${cmd}; done` },
  { id: 'while-do-done', envolver: cmd => `while false; do ${cmd}; done` },
  { id: 'until-do-done', envolver: cmd => `until true; do ${cmd}; done` },
  { id: '!', envolver: cmd => `! ${cmd}` },
];

// 5 envoltorios sin flags propios.
const ENVOLTORIOS = [
  { id: 'ninguno', envolver: cmd => cmd },
  { id: 'sudo', envolver: cmd => `sudo ${cmd}` },
  { id: 'doas', envolver: cmd => `doas ${cmd}` },
  { id: 'env', envolver: cmd => `env ${cmd}` },
  { id: 'command', envolver: cmd => `command ${cmd}` },
];

// 2 asignaciones de entorno. Se aplica ENTRE el envoltorio y el comando base: es la posicion
// que produce la alternacion asignacion/envoltorio de la causa 4 (env FOO=bar git commit).
const ASIGNACIONES = [
  { id: 'ninguna', envolver: cmd => cmd },
  { id: 'FOO=bar', envolver: cmd => `FOO=bar ${cmd}` },
];

/**
 * rejilla() -> [{ id, comando }], producto cartesiano 7 x 9 x 5 x 2 = 630 filas. Cada fila
 * compone, de dentro afuera: asignacion -> envoltorio -> agrupacion -> separador.
 */
function rejilla() {
  const filas = [];
  for (const sep of SEPARADORES_DE_REJILLA) {
    for (const agr of AGRUPACIONES) {
      for (const env of ENVOLTORIOS) {
        for (const asig of ASIGNACIONES) {
          const comando = sep.envolver(agr.envolver(env.envolver(asig.envolver(COMANDO_BASE))));
          filas.push({ id: `${sep.id}/${agr.id}/${env.id}/${asig.id}`, comando });
        }
      }
    }
  }
  return filas;
}

test('rejilla: 630 filas, todas regex-positivas, ninguna sin detectar', () => {
  const filas = rejilla();
  assert.strictEqual(filas.length, 630);

  const noRegexPositivas = filas.filter(f => !REGEX_SUSTITUIDA.test(f.comando));
  assert.deepStrictEqual(
    noRegexPositivas.map(f => f.id),
    [],
    'la rejilla dejo de medir la clase: hay filas que no son positivas para la regex sustituida',
  );

  const sinDetectar = filas.filter(f => !esInvocacion(f.comando, 'git', ['commit']));
  assert.deepStrictEqual(
    sinDetectar.map(f => f.id),
    [],
    `${sinDetectar.length} filas regex-positivas sin detectar: ${sinDetectar.map(f => f.id).join(', ')}`,
  );
});

// ─── Clases cerradas: envoltorio CON argumentos propios (P19) y palabra suelta en cabeza de
// segmento de "case"/funcion (P20) ───────────────────────────────────────────────────────────
//
// Ambas comparten la misma forma de bypass: una palabra suelta en cabeza de segmento que ningun
// descarte de un solo token puede saltar sin adivinar donde termina. P19 lo resuelve enumerando
// los flags propios de cada envoltorio conocido (OPCIONES_ENVOLTORIO_CON_VALOR); P20 lo resuelve
// tratando `case`/funcion como sintaxis con su propio parser, no como una entrada de Set.

const CASOS_CERRADOS = [
  { id: 'timeout 30', comando: 'timeout 30 git commit -m x' }, // P19
  { id: 'nice -n 10', comando: 'nice -n 10 git commit -m x' }, // P19
  { id: 'xargs', comando: 'xargs git commit -m x' }, // P19
  { id: 'case/esac', comando: 'case x in a) git commit -m x;; esac' }, // P20
  { id: 'definicion de funcion', comando: 'f() { git commit -m x; }; f' }, // P20
];

test('clases cerradas: envoltorio con argumentos propios y palabra suelta en cabeza de segmento SI se detectan (P19/P20)', () => {
  const sinDetectar = CASOS_CERRADOS.filter(l => !esInvocacion(l.comando, 'git', ['commit']));
  assert.deepStrictEqual(
    sinDetectar.map(l => l.id),
    [],
    `casos que deberian estar cerrados y no se detectan: ${sinDetectar.map(l => l.id).join(', ')}`,
  );
});

test('control positivo P19: timeout -s KILL 30 (flag del envoltorio con su propio valor, encadenado con el posicional) reconoce git', () => {
  assert.strictEqual(esInvocacion('timeout -s KILL 30 git commit -m x', 'git', ['commit']), true);
});

test('control negativo P19: nice git commit -m x (envoltorio sin flags) sigue resolviendo por el camino simple', () => {
  assert.strictEqual(esInvocacion('nice git commit -m x', 'git', ['commit']), true);
});

test('control negativo P20: patron de case que MENCIONA "git commit" como texto no es invocacion', () => {
  assert.strictEqual(esInvocacion('case x in "git commit") echo no-git;; esac', 'git', ['commit']), false);
});

test('control negativo P20: definicion de funcion sin invocacion posterior no cuenta', () => {
  assert.strictEqual(esInvocacion('f() { git commit -m x; }', 'git', ['commit']), false);
});

// ─── Controles negativos: contra el fail-closed (premise_check #5) ─────────────────────────

test('control negativo: separador entrecomillado no parte segmento (echo "sleep 1 & git commit -m x")', () => {
  assert.strictEqual(esInvocacion('echo "sleep 1 & git commit -m x"', 'git', ['commit']), false);
});

test('control negativo: agrupacion entrecomillada no descarta (echo "{ git commit -m x; }")', () => {
  assert.strictEqual(esInvocacion('echo "{ git commit -m x; }"', 'git', ['commit']), false);
});

test('control negativo: texto de mensaje que menciona git commit no es invocacion (git log --grep)', () => {
  assert.strictEqual(esInvocacion('git log --grep="acuerdate de git commit"', 'git', ['commit']), false);
});

test('control positivo: separador entrecomillado dentro del propio mensaje si es invocacion (git commit -m "a & b")', () => {
  assert.strictEqual(esInvocacion('git commit -m "a & b"', 'git', ['commit']), true);
});

test('control: git commit -m "docs: explica el flag -n" es invocacion, pero sin --no-verify', () => {
  const inv = invDe('git commit -m "docs: explica el flag -n"', 'git', ['commit']);
  assert.ok(inv);
  assert.strictEqual(usaFlag(inv, { largo: '--no-verify', corto: 'n' }), false);
});

// ─── Palabras como las forma el shell: piezas adyacentes con y sin comillas ──────────────────

const NO_VERIFY = { largo: '--no-verify', corto: 'n' };

function commits(cmd) {
  return invocaciones(cmd).filter(i => i.programa === 'git' && i.palabras[0] === 'commit');
}

test('tokenizar: valor entrecomillado pegado a texto sin comillas es un solo token, no entrecomillado', () => {
  const t = tokenizar("git -c alias.x='commit -n' x");
  assert.deepStrictEqual(t.map(x => x.valor), ['git', '-c', 'alias.x=commit -n', 'x']);
  assert.strictEqual(t[2].entrecomillado, false);
});

test('tokenizar: piezas entrecomilladas adyacentes forman un token entrecomillado', () => {
  assert.deepStrictEqual(tokenizar('echo \'a\'"b"')[1], { valor: 'ab', entrecomillado: true });
});

test('tokenizar: un separador entre comillas dentro de una palabra no la corta', () => {
  assert.deepStrictEqual(tokenizar("a';'b"), [{ valor: 'a;b', entrecomillado: false }]);
});

test('tokenizar: "--no-"verify llega como flag (basta una pieza sin comillas)', () => {
  assert.deepStrictEqual(tokenizar('"--no-"verify'), [{ valor: '--no-verify', entrecomillado: false }]);
});

test('bash -c con el script en una sola palabra mixta con blanco se re-analiza', () => {
  const inv = commits("bash -c git' commit --no-verify'");
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(usaFlag(inv[0], NO_VERIFY), true);
});

test('git -c user.name=\'a b\' commit --no-verify: el valor con blanco no oculta el commit', () => {
  const inv = commits("git -c user.name='a b' commit --no-verify");
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(usaFlag(inv[0], NO_VERIFY), true);
});

test('GIT_DIR="/a b" git commit: asignación con blanco descartada y registrada en entorno', () => {
  const cmd = 'GIT_DIR="/a b" git commit -m x';
  assert.strictEqual(esInvocacion(cmd, 'git', ['commit']), true);
  assert.deepStrictEqual(commits(cmd)[0].entorno, [['GIT_DIR', '/a b']]);
});

test('control negativo: --no-verify dentro del mensaje sigue siendo texto', () => {
  const inv = commits('git commit -m "texto --no-verify"');
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(usaFlag(inv[0], NO_VERIFY), false);
});

// ─── Alias en línea de git (-c alias.<x>=...) ──────────────────────────────────────────────

test('alias: git -c alias.x=commit x es un commit', () => {
  assert.notStrictEqual(commits('git -c alias.x=commit x').length, 0);
});

test('alias: git -c alias.x=\'commit -n\' x lleva -n en flags', () => {
  const inv = commits("git -c alias.x='commit -n' x");
  assert.strictEqual(inv.length, 1);
  assert.ok(inv[0].flags.includes('-n'));
});

test('alias: la invocación expandida hereda las globales de la original (-C B)', () => {
  const inv = commits('git -c alias.x=commit -C B x');
  assert.strictEqual(inv.length, 1);
  assert.ok(inv[0].globales.some(([o, v]) => o === '-C' && v === 'B'), JSON.stringify(inv[0].globales));
});

test('alias: con ! el script se analiza como anidado, con script propio y sin globales', () => {
  const inv = commits("git -c alias.x='!git commit --no-verify' x");
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(usaFlag(inv[0], NO_VERIFY), true);
  assert.notStrictEqual(inv[0].script, 0);
  assert.deepStrictEqual(inv[0].globales, []);
});

test('alias: la cadena x -> y -> commit se sigue hasta el builtin', () => {
  const inv = commits("git -c alias.x=y -c alias.y='commit --no-verify' x");
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(usaFlag(inv[0], NO_VERIFY), true);
});

test('alias: el nombre no distingue mayúsculas (alias.X sirve para x)', () => {
  const inv = commits('git -c alias.X=commit x --no-verify');
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(usaFlag(inv[0], NO_VERIFY), true);
});

test('alias negativo: un bucle x -> y -> x deja solo la invocación original', () => {
  const inv = invocaciones('git -c alias.x=y -c alias.y=x x');
  assert.strictEqual(inv.length, 1);
  assert.deepStrictEqual(inv[0].palabras, ['x']);
});

test('alias negativo: un alias con nombre de builtin no lo tapa (alias.commit=log)', () => {
  const inv = invocaciones('git -c alias.commit=log commit --no-verify');
  assert.strictEqual(inv.filter(i => i.palabras[0] === 'log').length, 0);
  const commit = inv.filter(i => i.palabras[0] === 'commit');
  assert.strictEqual(commit.length, 1);
  assert.strictEqual(usaFlag(commit[0], NO_VERIFY), true);
});

test('alias negativo: git -c alias.x=log x no es commit', () => {
  assert.strictEqual(esInvocacion('git -c alias.x=log x', 'git', ['commit']), false);
});

test('alias negativo: un valor -c que no es alias no expande nada (user.name=commit log)', () => {
  assert.strictEqual(esInvocacion('git -c user.name=commit log', 'git', ['commit']), false);
});

// ─── Campos por invocación: separadores, grupos, script y globales ───────────────────────────

function porPrograma(cmd, programa) {
  return invocaciones(cmd).find(i => i.programa === programa);
}

test('campos: separadores de cd B && git commit', () => {
  const cmd = 'cd B && git commit';
  assert.strictEqual(porPrograma(cmd, 'cd').separadorAntes, null);
  assert.strictEqual(porPrograma(cmd, 'cd').separadorDespues, '&&');
  assert.strictEqual(porPrograma(cmd, 'git').separadorAntes, '&&');
  assert.strictEqual(porPrograma(cmd, 'git').separadorDespues, null);
});

test('campos: (cd B; true); git commit -> cd y true comparten un grupo que el commit no tiene', () => {
  const cmd = '(cd B; true); git commit';
  const cd = porPrograma(cmd, 'cd');
  const verdad = porPrograma(cmd, 'true');
  const git = porPrograma(cmd, 'git');
  assert.strictEqual(cd.grupos.length, 1);
  assert.deepStrictEqual(verdad.grupos, cd.grupos);
  assert.deepStrictEqual(git.grupos, []);
});

for (const cmd of ['if true; then cd B; fi; git commit', 'while false; do cd B; done; git commit']) {
  test(`campos: ${cmd} -> cd tiene un grupo que el commit no tiene`, () => {
    const cd = porPrograma(cmd, 'cd');
    const git = porPrograma(cmd, 'git');
    assert.strictEqual(cd.grupos.length, 1);
    assert.deepStrictEqual(git.grupos, []);
  });
}

test('campos: if true; then cd B && git commit; fi -> cd y el commit comparten grupo', () => {
  const cmd = 'if true; then cd B && git commit; fi';
  const cd = porPrograma(cmd, 'cd');
  assert.strictEqual(cd.grupos.length, 1);
  assert.deepStrictEqual(porPrograma(cmd, 'git').grupos, cd.grupos);
});

test('campos: aperturas y cierres que no cuadran (fi cierra un while) -> grupos null', () => {
  const cmd = 'while true; do cd B; fi; git commit';
  assert.strictEqual(porPrograma(cmd, 'cd').grupos, null);
  assert.strictEqual(porPrograma(cmd, 'git').grupos, null);
});

test('campos: una palabra clave fuera de posición de orden no abre grupo (echo if)', () => {
  assert.deepStrictEqual(porPrograma('echo if; git commit', 'git').grupos, []);
});

test('campos: bash -c "cd B"; git commit -> el cd tiene un script distinto del de git', () => {
  const cmd = 'bash -c "cd B"; git commit';
  assert.strictEqual(porPrograma(cmd, 'git').script, 0);
  assert.notStrictEqual(porPrograma(cmd, 'cd').script, 0);
});

test('campos: git -C B -c k=v commit -> globales en orden', () => {
  assert.deepStrictEqual(porPrograma('git -C B -c k=v commit', 'git').globales, [['-C', 'B'], ['-c', 'k=v']]);
});

test('campos: git commit -C HEAD -m x -> sin globales (-C tras el subcomando es de commit)', () => {
  assert.deepStrictEqual(porPrograma('git commit -C HEAD -m x', 'git').globales, []);
});

// ─── Funciones recursivas, cascadas y tope de anidamiento ────────────────────────────────────

// f0(){ f1; }; …; f<n-1>(){ <ultima>; }; f0: n funciones distintas, n expansiones anidadas.
function cadenaDeFunciones(n, ultima) {
  let cmd = '';
  for (let i = 0; i < n - 1; i += 1) cmd += `f${i}(){ f${i + 1}; }; `;
  return `${cmd}f${n - 1}(){ ${ultima}; }; f0`;
}

// f0(){ f1; f1; }; …; f<n>(){ true; }; f0: sin la regla de una expansión por cuerpo, 2^n.
function cascadaDeFunciones(n) {
  let cmd = '';
  for (let i = 0; i < n; i += 1) cmd += `f${i}(){ f${i + 1}; f${i + 1}; }; `;
  return `${cmd}f${n}(){ true; }; f0`;
}

const WRAPPER_DE_GIT = 'git() { command git "$@"; }; ';

test('función recursiva: un wrapper de git no oculta git commit --no-verify', () => {
  const cmd = `${WRAPPER_DE_GIT}git commit --no-verify -m x`;
  assert.doesNotThrow(() => invocaciones(cmd));
  const delCommit = commits(cmd);
  assert.ok(delCommit.length > 0);
  assert.ok(delCommit.some(i => usaFlag(i, NO_VERIFY)));
});

test('función recursiva (−): el wrapper de git con git status no es commit ni lleva --no-verify', () => {
  const cmd = `${WRAPPER_DE_GIT}git status`;
  assert.strictEqual(esInvocacion(cmd, 'git', ['commit']), false);
  assert.ok(!invocaciones(cmd).some(i => usaFlag(i, NO_VERIFY)));
});

test('función recursiva directa: f() { f; }; f no lanza y no es commit', () => {
  assert.strictEqual(esInvocacion('f() { f; }; f', 'git', ['commit']), false);
});

test('funciones mutuamente recursivas: no lanza y no es commit', () => {
  assert.strictEqual(esInvocacion('a() { b; }; b() { a; }; a', 'git', ['commit']), false);
});

test('función legítima anidada: g() { git commit -m x; }; f() { g; }; f es commit', () => {
  assert.strictEqual(esInvocacion('g() { git commit -m x; }; f() { g; }; f', 'git', ['commit']), true);
});

test('cascada de 20 funciones que llaman dos veces a la siguiente: crecimiento lineal y no es commit', () => {
  const cmd = cascadaDeFunciones(20);
  assert.ok(invocaciones(cmd).length < 200);
  assert.strictEqual(esInvocacion(cmd, 'git', ['commit']), false);
});

test('cascada de 12 funciones: cada cuerpo se expande una vez por orden, no una vez por rama', () => {
  assert.ok(invocaciones(cascadaDeFunciones(12)).length < 200);
});

test('tope: una cadena de 40 funciones distintas cuenta como commit incompleto con --no-verify', () => {
  const cmd = cadenaDeFunciones(40, 'true');
  assert.strictEqual(esInvocacion(cmd, 'git', ['commit']), true);
  assert.ok(invocaciones(cmd).some(i => i.incompleta === true && usaFlag(i, NO_VERIFY)));
});

test('tope (−): una cadena de 10 funciones con git status al final no es commit ni incompleta', () => {
  const cmd = cadenaDeFunciones(10, 'git status');
  assert.strictEqual(esInvocacion(cmd, 'git', ['commit']), false);
  assert.ok(!invocaciones(cmd).some(i => 'incompleta' in i));
});

test('tope, frontera: 32 expansiones anidadas se analizan enteras; 33 dan la invocación incompleta', () => {
  assert.ok(!invocaciones(cadenaDeFunciones(32, 'true')).some(i => 'incompleta' in i));
  assert.strictEqual(invocaciones(cadenaDeFunciones(33, 'true')).filter(i => i.incompleta === true).length, 1);
});

test('tope: la invocación incompleta hereda el contexto del punto de llamada', () => {
  const cmd = cadenaDeFunciones(33, 'true');
  const todas = invocaciones(cmd);
  const incompleta = todas.find(i => i.incompleta === true);
  const llamada = todas.find(i => i.programa === 'f32');
  assert.ok(llamada);
  assert.strictEqual(incompleta.script, llamada.script);
  assert.strictEqual(incompleta.separadorAntes, llamada.separadorAntes);
  assert.strictEqual(incompleta.separadorDespues, llamada.separadorDespues);
  assert.deepStrictEqual(incompleta.grupos, llamada.grupos);
});

test('tope: 40 funciones hermanas llamadas en secuencia no anidan ni dan la invocación incompleta', () => {
  let cmd = '';
  for (let i = 0; i < 40; i += 1) cmd += `f${i}(){ true; }; `;
  for (let i = 0; i < 40; i += 1) cmd += `f${i}; `;
  assert.ok(!invocaciones(cmd).some(i => 'incompleta' in i));
});

for (const llamada of ['bash -c true', 'bash -c "true"']) {
  test(`una función llamada bash añade su cuerpo también con -c: bash(){ git commit -n; }; ${llamada} es commit`, () => {
    assert.strictEqual(esInvocacion(`bash(){ git commit -n; }; ${llamada}`, 'git', ['commit']), true);
  });
}

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

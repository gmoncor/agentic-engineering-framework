'use strict';

// Cada llamada `agent(` de los workflows de Claude Code declara el rol que la
// ejecuta (`agentType`), y ese rol existe en `.claude/agents/`. Sin `agentType`
// el paso corre con el modelo de la sesión y sin las herramientas de su rol: el
// frontmatter del agente (modelo y `tools`) solo se aplica si el paso lo nombra.
//
// El detector es una función pura sobre el texto del script; el árbol real se
// comprueba con ella y un fixture en línea la pone en rojo, para que un detector
// que nunca dispara no pase por verde.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parsearFrontmatter, valorObligatorio } = require('../scripts/transforms/frontmatter');

const RAIZ = path.join(__dirname, '..');
const WORKFLOWS = ['.claude/workflows/implementar-spec.js', '.claude/workflows/planificar.js'];

// Avanza desde `i` (justo tras la comilla de apertura) hasta pasar el cierre de
// un literal de cadena o de plantilla. En una plantilla, cada `${...}` se recorre
// como código, con sus propias cadenas anidadas.
function saltarLiteral(src, i, comilla) {
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === comilla) return i + 1;
    if (comilla === '`' && c === '$' && src[i + 1] === '{') {
      i = recorrerHasta(src, i + 2, '}').fin + 1;
      continue;
    }
    i++;
  }
  return i;
}

// Recorre código desde `i` hasta el cierre `cierre` al nivel de partida, saltando
// cadenas, plantillas y comentarios. Devuelve la posición del cierre y las de las
// comas de nivel superior, que separan los argumentos de una llamada.
function recorrerHasta(src, i, cierre) {
  const comas = [];
  let profundidad = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') { i = saltarLiteral(src, i + 1, c); continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const f = src.indexOf('*/', i + 2); i = f === -1 ? src.length : f + 2; continue; }
    if (c === '(' || c === '[' || c === '{') profundidad++;
    else if (c === ')' || c === ']' || c === '}') {
      if (profundidad === 0 && c === cierre) return { fin: i, comas };
      profundidad--;
    } else if (c === ',' && profundidad === 0) comas.push(i);
    i++;
  }
  return { fin: src.length, comas };
}

function lineaDe(src, indice) {
  return src.slice(0, indice).split('\n').length;
}

// Localiza cada llamada `agent(` del script (no un método `x.agent(`) y devuelve,
// por llamada, su línea y el `agentType` declarado en su último argumento, o null.
// Una mención `agent(` dentro de un comentario o de una cadena también cuenta como
// llamada y exige `agentType`: el error cae del lado seguro (rojo, no verde).
function llamadasAgent(src) {
  const llamadas = [];
  const patron = /(^|[^.\w$])agent\s*\(/g;
  let m;
  while ((m = patron.exec(src)) !== null) {
    const inicio = m.index + m[0].length;
    const { fin, comas } = recorrerHasta(src, inicio, ')');
    const ultimo = src.slice(comas.length ? comas[comas.length - 1] + 1 : inicio, fin).trim();
    const tipo = ultimo.startsWith('{')
      ? /(?:^|[{,\s])agentType\s*:\s*(['"])([^'"]+)\1/.exec(ultimo)
      : null;
    llamadas.push({ linea: lineaDe(src, m.index + m[1].length), agentType: tipo ? tipo[2] : null });
  }
  return llamadas;
}

// Problemas del script frente a los roles existentes: una llamada sin `agentType`
// o con un rol que no tiene agente.
function problemasAgentType(src, roles) {
  return llamadasAgent(src).flatMap(function (ll) {
    if (!ll.agentType) return ['línea ' + ll.linea + ': agent() sin agentType'];
    if (!roles.includes(ll.agentType)) return ['línea ' + ll.linea + ': agentType inexistente «' + ll.agentType + '»'];
    return [];
  });
}

function rolesDisponibles() {
  const dir = path.join(RAIZ, '.claude/agents');
  return fs.readdirSync(dir).filter(function (f) { return f.endsWith('.md'); }).map(function (f) {
    const ruta = path.join(dir, f);
    return valorObligatorio(parsearFrontmatter(fs.readFileSync(ruta, 'utf8'), ruta).campos, 'name', ruta);
  });
}

test('los roles se leen del frontmatter de los agentes', function () {
  const roles = rolesDisponibles();
  for (const rol of ['asesor', 'implementador', 'planificador', 'revisor']) {
    assert.ok(roles.includes(rol), 'falta el agente ' + rol + ' en .claude/agents/');
  }
});

for (const rel of WORKFLOWS) {
  test(rel + ': cada agent() declara un agentType existente', function () {
    const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const llamadas = llamadasAgent(src);
    assert.ok(llamadas.length > 0, 'el detector no encontró ninguna llamada agent() en ' + rel);
    assert.deepStrictEqual(problemasAgentType(src, rolesDisponibles()), []);
  });
}

test('el detector marca una llamada sin agentType y otra con un rol inexistente', function () {
  const fixture = [
    'const a = await agent(`Prompt con ${x.map((y) => `${y}`).join(\', \')} y una coma, suelta`, {',
    '  label: \'sin-rol\', phase: \'F\' })',
    'const b = await agent(\'Otro, con comas\', { agentType: \'inexistente\', label: \'b\' })',
    'const c = await agent(\'Bien\', { agentType: \'revisor\', label: \'c (x)\' })',
    '// un método de otro objeto no es la función del runtime:',
    'const d = obj.agent(\'método\', {})',
  ].join('\n');
  const problemas = problemasAgentType(fixture, ['revisor']);
  assert.deepStrictEqual(problemas, [
    'línea 1: agent() sin agentType',
    'línea 3: agentType inexistente «inexistente»',
  ]);
});

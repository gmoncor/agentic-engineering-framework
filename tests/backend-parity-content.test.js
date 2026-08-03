'use strict';

// Canary de contenido para el modelo de implementacion retirado.
//
// El framework migro de ejecutar las tasks en oleadas/paralelo a ejecutarlas
// en orden de dependencias, una tras otra. La migracion actualizo las
// superficies principales, pero el texto tiende a reaparecer en ficheros de
// contexto (README, manifiestos, guias por backend) porque nada los ata a la
// realidad del producto. Este test convierte esa reaparicion en un fallo.
//
// Ademas verifica que las skills identicas-por-diseno (mismo contenido en
// todos los backends que las tienen) sigan siendolo: son ficheros duplicados
// a mano, y una edicion en un solo backend diverge en silencio.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..');

function leer(rutaRelativa) {
  return fs.readFileSync(path.join(RAIZ, rutaRelativa), 'utf8');
}

// ── Patrones del modelo de implementacion retirado ───────────────────────────
//
// Frases compuestas, no substrings sueltos: "paralelo" solo tambien aparece en
// contextos validos (revision en paralelo, planificacion paralela), que no
// deben disparar el canary.

const FORBIDDEN_PATTERNS = [
  'oleadas',
  'independientes en paralelo',
  'implementan en paralelo',
  'implementacion paralela',
  'particion por dueno',
  'corren a la vez',
  'fan-out',
  'arbol de trabajo aparte',
  'ejecucion paralela',
  'implementarse a la vez',
  'archivos son disjuntos'
];

const CONTEXT_FILES = [
  'README.md',
  'CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  'package.json',
  'gemini-extension.json',
  '.claude-plugin/plugin.json',
  'ai_docs/dev_templates/README.md',
  '.claude/workflows/implementar-spec.js',
  '.claude/workflows/lib/orquestacion.js',
  '.agents/skills/implementar-spec/SKILL.md',
  'hooks/tests/implementar-spec.test.js',
  '.claude/agents/planificador.md',
  'agents/planificador.md',
  '.codex/agents/planificador.toml',
  '.agents/plugins/sdd/agents/planificador.md',
  '.agents/skills/tareas/SKILL.md'
];

for (const archivo of CONTEXT_FILES) {
  test(`canary: ${archivo} no menciona el modelo de implementacion retirado`, () => {
    const lineas = leer(archivo).split('\n');

    for (const patron of FORBIDDEN_PATTERNS) {
      const regex = new RegExp(patron, 'i');
      const numeroLinea = lineas.findIndex(linea => regex.test(linea)) + 1;

      assert.ok(
        numeroLinea === 0,
        `${archivo}:${numeroLinea} contiene el patron prohibido "${patron}" `
          + '(modelo de implementacion por oleadas/paralelo, retirado)'
      );
    }
  });
}

// ── Seccion "Ahorro de tokens" ───────────────────────────────────────────────
//
// README.md documenta las palancas de ahorro de tokens (rtk, codeburn, modelo
// por defecto); CLAUDE.md apunta a esa seccion en una linea, sin duplicarla
// (CLAUDE.md se carga en cada sesion y no es sitio para prosa larga).

test('README.md tiene la seccion "Ahorro de tokens" entre Hooks y Reglas de Cursor', () => {
  const contenido = leer('README.md');
  const inicioHooks = contenido.indexOf('## Hooks (enforcement mecanico)');
  const inicioAhorro = contenido.indexOf('## Ahorro de tokens');
  const inicioCursor = contenido.indexOf('## Reglas de Cursor');

  assert.ok(inicioHooks !== -1, 'README.md debe tener la seccion "Hooks (enforcement mecanico)"');
  assert.ok(inicioAhorro !== -1, 'README.md debe tener la seccion "Ahorro de tokens"');
  assert.ok(inicioCursor !== -1, 'README.md debe tener la seccion "Reglas de Cursor"');
  assert.ok(
    inicioHooks < inicioAhorro && inicioAhorro < inicioCursor,
    'La seccion "Ahorro de tokens" debe ir entre "Hooks (enforcement mecanico)" y "Reglas de Cursor"'
  );
});

test('README.md "Ahorro de tokens" referencia "Modelo por defecto" en vez de duplicarlo', () => {
  const contenido = leer('README.md');
  const inicioAhorro = contenido.indexOf('## Ahorro de tokens');
  const inicioCursor = contenido.indexOf('## Reglas de Cursor');
  const seccion = contenido.slice(inicioAhorro, inicioCursor);

  assert.ok(seccion.includes('rtk'), 'La seccion debe mencionar rtk como palanca de compresion de shell');
  assert.ok(seccion.includes('codeburn'), 'La seccion debe mencionar codeburn como dashboard de coste');
  assert.ok(
    seccion.includes('Modelo por defecto'),
    'La seccion debe referenciar "Modelo por defecto" en vez de repetir su contenido'
  );
  assert.ok(
    !/opus|sonnet/i.test(seccion),
    'La seccion no debe duplicar detalles de modelos concretos ya cubiertos en "Modelo por defecto"'
  );
});

test('CLAUDE.md tiene un puntero de una linea a "Ahorro de tokens" (sin duplicar contenido)', () => {
  const contenido = leer('CLAUDE.md');
  const lineas = contenido.split('\n');
  const lineasConMencion = lineas.filter(linea => linea.includes('Ahorro de tokens'));

  assert.strictEqual(
    lineasConMencion.length,
    1,
    'CLAUDE.md debe mencionar "Ahorro de tokens" exactamente una vez (puntero, no prosa)'
  );
  assert.ok(
    lineasConMencion[0].length < 80,
    'El puntero en CLAUDE.md debe ser una linea corta, no una seccion completa'
  );
});

// ── Igualdad de skills identicas-por-diseno ──────────────────────────────────

const IDENTICAL_SKILLS = ['cleanup', 'diff', 'revisar-tarea', 'revision-adversarial', 'testing'];

const SKILL_BACKENDS = {
  claude: '.claude/skills',
  gemini: 'skills',
  codex: '.agents/skills'
};

function md5De(rutaAbsoluta) {
  return crypto.createHash('md5').update(fs.readFileSync(rutaAbsoluta)).digest('hex');
}

function rutaSkill(backend, skill) {
  return path.join(RAIZ, SKILL_BACKENDS[backend], skill, 'SKILL.md');
}

for (const skill of IDENTICAL_SKILLS) {
  test(`paridad de contenido: la skill "${skill}" es identica entre backends`, async t => {
    const backends = Object.keys(SKILL_BACKENDS);

    for (let i = 0; i < backends.length - 1; i++) {
      for (let j = i + 1; j < backends.length; j++) {
        const [a, b] = [backends[i], backends[j]];
        const rutaA = rutaSkill(a, skill);
        const rutaB = rutaSkill(b, skill);

        await t.test(`${a} vs ${b}`, st => {
          if (!fs.existsSync(rutaA) || !fs.existsSync(rutaB)) {
            st.skip(`la skill "${skill}" no existe en ${!fs.existsSync(rutaA) ? a : b}`);
            return;
          }

          assert.strictEqual(
            md5De(rutaA),
            md5De(rutaB),
            `La skill "${skill}" difiere entre ${a} y ${b}. `
              + 'Las skills identicas-por-diseno deben ser byte-a-byte iguales entre backends.'
          );
        });
      }
    }
  });
}

// ── Igualdad de cuerpo de agentes identicos-por-diseno ──────────────────────
//
// Los agentes de Codex (TOML) y Antigravity (Markdown+frontmatter) comparten
// el mismo cuerpo de instrucciones tras normalizar el envoltorio de cada
// formato. Una edicion en un solo backend diverge en silencio si nada lo ata.

const IDENTICAL_AGENTS = ['asesor', 'implementador', 'planificador', 'revisor'];

function extractorToml(contenido) {
  const marcador = 'developer_instructions = """';
  const inicio = contenido.indexOf(marcador) + marcador.length;
  const fin = contenido.indexOf('"""', inicio);
  return contenido.slice(inicio, fin).trim();
}

function extractorMd(contenido) {
  const primerDelimitador = contenido.indexOf('---');
  const segundoDelimitador = contenido.indexOf('---', primerDelimitador + 3);
  return contenido.slice(segundoDelimitador + 3).trim();
}

function md5DeTexto(texto) {
  return crypto.createHash('md5').update(texto).digest('hex');
}

for (const agente of IDENTICAL_AGENTS) {
  test(`paridad de contenido: el agente "${agente}" es identico entre codex y antigravity`, t => {
    const rutaCodex = path.join(RAIZ, '.codex/agents', `${agente}.toml`);
    const rutaAntigravity = path.join(RAIZ, '.agents/plugins/sdd/agents', `${agente}.md`);

    if (!fs.existsSync(rutaCodex) || !fs.existsSync(rutaAntigravity)) {
      t.skip(`el agente "${agente}" no existe en ${!fs.existsSync(rutaCodex) ? 'codex' : 'antigravity'}`);
      return;
    }

    assert.strictEqual(
      md5DeTexto(extractorToml(fs.readFileSync(rutaCodex, 'utf8'))),
      md5DeTexto(extractorMd(fs.readFileSync(rutaAntigravity, 'utf8'))),
      `El agente "${agente}" difiere entre codex y antigravity. `
        + 'Los agentes identicos-por-diseno deben tener el mismo cuerpo de instrucciones '
        + 'una vez normalizado el envoltorio (TOML vs Markdown+frontmatter).'
    );
  });
}

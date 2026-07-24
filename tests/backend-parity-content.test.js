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
  'particion por dueno'
];

const CONTEXT_FILES = [
  'README.md',
  'CLAUDE.md',
  'GEMINI.md',
  'AGENTS.md',
  'package.json',
  'gemini-extension.json',
  '.claude-plugin/plugin.json',
  'ai_docs/dev_templates/README.md'
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

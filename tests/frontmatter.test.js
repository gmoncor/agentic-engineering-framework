'use strict';

// Valida el frontmatter de los artefactos que escribe una persona: skills,
// fragmentos de skill en `docs-src/skills/`, agentes y comandos. Las reglas
// viven como funciones puras sobre documentos en memoria; el árbol real se
// recorre una vez y cada regla tiene además un fixture en línea que la pone en
// rojo, para que un detector que nunca dispara no pase por verde.
//
// Si una skill futura necesita un campo nuevo, se amplía la lista de campos
// permitidos aquí, con su motivo; la regla no se desactiva.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parsearFrontmatter } = require('../scripts/transforms/frontmatter');
const { transformarSkill } = require('../scripts/transforms/skill-to-backend');

const RAIZ = path.join(__dirname, '..');

const LONGITUD_MAXIMA_DESCRIPTION = 240;

// Campos admitidos por tipo de artefacto.
//   skill:          los que entiende Claude Code en una skill.
//   fragmento:      los de una skill más `source-body`, que solo leen los
//                   fragmentos de `docs-src/skills/` (lo consume el transform
//                   `command-to-skill` y nunca llega a la salida).
//   comando, agente: los que leen el compilador y Claude Code.
const CAMPOS_SKILL = ['name', 'description', 'argument-hint', 'disable-model-invocation'];
const CAMPOS_PERMITIDOS = {
  skill: new Set(CAMPOS_SKILL),
  fragmento: new Set([...CAMPOS_SKILL, 'source-body']),
  comando: new Set(['description', 'argument-hint']),
  agente: new Set(['name', 'description', 'model', 'tools']),
};

const TIPOS_SKILL = new Set(['skill', 'fragmento']);

/** Texto de un escalar YAML sin comillas dobles ni simples envolventes. */
function sinComillas(crudo) {
  const recortado = String(crudo).trim();
  if (recortado.length >= 2 && /^(["']).*\1$/.test(recortado)) return recortado.slice(1, -1);
  return recortado;
}

/**
 * Documento a validar: `ruta` para los mensajes, `tipo` (skill, fragmento,
 * comando o agente), `nombreEsperado` (carpeta de la skill, nombre del fichero
 * del agente o del fragmento; `null` en comandos) y el `contenido` del fichero.
 */
function documento(ruta, tipo, nombreEsperado, contenido) {
  return { ruta, tipo, nombreEsperado, contenido };
}

/** Regla 1: frontmatter parseable. Devuelve `{ campos }` o `{ error }`. */
function parsear(doc) {
  try {
    return { campos: parsearFrontmatter(doc.contenido, doc.ruta).campos };
  } catch (error) {
    return { error: error.message };
  }
}

function campo(campos, clave) {
  return campos.find(c => c.clave === clave);
}

/** Regla 2: skills y fragmentos con `name` igual a la carpeta o fichero; agentes, igual al fichero. */
function reglaName(doc, campos) {
  if (doc.nombreEsperado === null) return [];
  const declarado = campo(campos, 'name');
  const valor = declarado ? sinComillas(declarado.valor) : '';
  if (valor !== doc.nombreEsperado) {
    return [`${doc.ruta}: name "${valor}" no coincide con "${doc.nombreEsperado}"`];
  }
  return [];
}

/** Regla 3: `description` presente, en una sola línea y con longitud acotada. */
function reglaDescription(doc, campos) {
  const declarado = campo(campos, 'description');
  if (!declarado || sinComillas(declarado.valor) === '') return [`${doc.ruta}: falta description`];
  if (declarado.extra.length > 0 || /^[>|]/.test(declarado.valor.trim())) {
    return [`${doc.ruta}: description ocupa más de una línea`];
  }
  const longitud = sinComillas(declarado.valor).length;
  if (longitud > LONGITUD_MAXIMA_DESCRIPTION) {
    return [`${doc.ruta}: description de ${longitud} caracteres (máximo ${LONGITUD_MAXIMA_DESCRIPTION})`];
  }
  return [];
}

/** Regla 5: una skill no declara `model`; el modelo lo fija la política, no la fuente. */
function reglaSinModelo(doc, campos) {
  if (!TIPOS_SKILL.has(doc.tipo)) return [];
  return campo(campos, 'model') ? [`${doc.ruta}: una skill no declara model`] : [];
}

/** Regla 6: solo los campos permitidos para el tipo del documento. */
function reglaCamposPermitidos(doc, campos) {
  const permitidos = CAMPOS_PERMITIDOS[doc.tipo];
  return campos
    .filter(c => !permitidos.has(c.clave))
    .map(c => `${doc.ruta}: campo "${c.clave}" no permitido en ${doc.tipo === 'skill' ? 'una' : 'un'} ${doc.tipo}`);
}

/** Errores de un documento: si no parsea, solo ese; si parsea, los de cada regla. */
function erroresDeDocumento(doc) {
  const { campos, error } = parsear(doc);
  if (error) return [error];
  return [
    ...reglaName(doc, campos),
    ...reglaDescription(doc, campos),
    ...reglaSinModelo(doc, campos),
    ...reglaCamposPermitidos(doc, campos),
  ];
}

/** Regla 4: ninguna description repetida entre skills (fuentes y fragmentos). */
function erroresDeDuplicados(docs) {
  const vistas = new Map();
  const errores = [];
  for (const doc of docs.filter(d => TIPOS_SKILL.has(d.tipo))) {
    const { campos } = parsear(doc);
    const declarado = campos && campo(campos, 'description');
    if (!declarado) continue;
    const clave = sinComillas(declarado.valor).toLowerCase();
    if (vistas.has(clave)) {
      errores.push(`${doc.ruta}: description duplicada con ${vistas.get(clave)}`);
    } else {
      vistas.set(clave, doc.ruta);
    }
  }
  return errores;
}

/**
 * Campos que el transform `skill-to-backend` retira al generar para un backend
 * que no es Claude Code. Se deriva del productor, no de una copia de su lista:
 * se le pasa una skill con todos los campos admitidos y se ve cuáles no salen.
 */
function camposSoloClaude() {
  const entrada = ['---', ...CAMPOS_SKILL.map(c => `${c}: "x"`), '---', '', 'cuerpo', ''].join('\n');
  const salida = transformarSkill(entrada, { output: { backend: 'antigravity' }, source: 'sonda' }, {});
  const conservados = new Set(parsearFrontmatter(salida, 'sonda').campos.map(c => c.clave));
  return CAMPOS_SKILL.filter(c => !conservados.has(c));
}

/** Regla 7: ninguna salida de `.agents/skills/` arrastra un campo solo-Claude. */
function erroresDeSalida(salidas, soloClaude) {
  const errores = [];
  for (const { ruta, contenido } of salidas) {
    let campos;
    try {
      campos = parsearFrontmatter(contenido, ruta).campos;
    } catch (error) {
      errores.push(error.message);
      continue;
    }
    for (const c of campos) {
      if (soloClaude.includes(c.clave)) errores.push(`${ruta}: campo solo-Claude "${c.clave}" en una salida`);
    }
  }
  return errores;
}

// --- Árbol real ---------------------------------------------------------------

function leer(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
}

function entradas(rel) {
  const abs = path.join(RAIZ, rel);
  return fs.existsSync(abs) ? fs.readdirSync(abs, { withFileTypes: true }) : [];
}

/** `true` si el fichero abre un bloque de frontmatter (los fragmentos sin él son solo cuerpo). */
function tieneFrontmatter(contenido) {
  try {
    parsearFrontmatter(contenido, 'sonda');
    return true;
  } catch (error) {
    return !error.message.startsWith('MISSING_FRONTMATTER');
  }
}

function documentosDelArbol() {
  const docs = [];

  for (const e of entradas('.claude/skills').filter(e => e.isDirectory())) {
    const rel = `.claude/skills/${e.name}/SKILL.md`;
    docs.push(documento(rel, 'skill', e.name, leer(rel)));
  }
  for (const e of entradas('docs-src/skills').filter(e => e.isFile() && e.name.endsWith('.md'))) {
    const rel = `docs-src/skills/${e.name}`;
    const contenido = leer(rel);
    if (tieneFrontmatter(contenido)) docs.push(documento(rel, 'fragmento', path.basename(e.name, '.md'), contenido));
  }
  for (const e of entradas('.claude/agents').filter(e => e.isFile() && e.name.endsWith('.md'))) {
    const rel = `.claude/agents/${e.name}`;
    docs.push(documento(rel, 'agente', path.basename(e.name, '.md'), leer(rel)));
  }
  for (const e of entradas('.claude/commands').filter(e => e.isFile() && e.name.endsWith('.md'))) {
    const rel = `.claude/commands/${e.name}`;
    docs.push(documento(rel, 'comando', null, leer(rel)));
  }
  return docs;
}

function salidasDelArbol() {
  return entradas('.agents/skills')
    .filter(e => e.isDirectory())
    .map(e => `.agents/skills/${e.name}/SKILL.md`)
    .filter(rel => fs.existsSync(path.join(RAIZ, rel)))
    .map(rel => ({ ruta: rel, contenido: leer(rel) }));
}

const DOCUMENTOS = documentosDelArbol();
const SALIDAS = salidasDelArbol();

test('el árbol real cubre los cuatro tipos de artefacto', () => {
  const tipos = new Set(DOCUMENTOS.map(d => d.tipo));
  assert.deepStrictEqual([...tipos].sort(), ['agente', 'comando', 'fragmento', 'skill']);
  assert.ok(SALIDAS.length > 0, 'no se encontró ninguna salida en .agents/skills/');
});

test('el frontmatter de skills, fragmentos, agentes y comandos cumple las reglas', () => {
  const docs = DOCUMENTOS;
  const errores = [...docs.flatMap(erroresDeDocumento), ...erroresDeDuplicados(docs)];
  assert.deepStrictEqual(errores, []);
});

test('ninguna salida de .agents/skills/ lleva un campo solo-Claude', () => {
  const soloClaude = camposSoloClaude();
  assert.ok(soloClaude.length > 0, 'el transform no retira ningún campo: la sonda ya no mide nada');
  assert.deepStrictEqual(erroresDeSalida(SALIDAS, soloClaude), []);
});

// --- Fixtures negativos: cada regla dispara ------------------------------------

function fm(líneas, cuerpo = 'cuerpo') {
  return ['---', ...líneas, '---', '', cuerpo, ''].join('\n');
}

const SKILL_VALIDA = ['name: demo', 'description: "Se activa ante X. Hace Y."'];

test('fixture válido: una skill correcta no da errores', () => {
  assert.deepStrictEqual(erroresDeDocumento(documento('s', 'skill', 'demo', fm(SKILL_VALIDA))), []);
});

test('regla 1: frontmatter sin cerrar o con línea ilegible se rechaza', () => {
  const sinCierre = erroresDeDocumento(documento('s', 'skill', 'demo', '---\nname: demo\n'));
  assert.match(sinCierre.join('\n'), /PARSE_ERROR/);
  const ilegible = erroresDeDocumento(documento('s', 'skill', 'demo', fm(['name: demo', 'esto no es un campo'])));
  assert.match(ilegible.join('\n'), /PARSE_ERROR/);
  const ausente = erroresDeDocumento(documento('a', 'agente', 'demo', 'sin frontmatter\n'));
  assert.match(ausente.join('\n'), /MISSING_FRONTMATTER/);
});

test('regla 2: name distinto de la carpeta de la skill o del fichero del agente se rechaza', () => {
  const skill = erroresDeDocumento(documento('s', 'skill', 'otra', fm(SKILL_VALIDA)));
  assert.match(skill.join('\n'), /name "demo" no coincide con "otra"/);
  const agente = erroresDeDocumento(documento('a', 'agente', 'revisor', fm(['name: revisora', 'description: "d"'])));
  assert.match(agente.join('\n'), /no coincide con "revisor"/);
});

test('regla 3: description ausente, multilínea o demasiado larga se rechaza', () => {
  const ausente = erroresDeDocumento(documento('s', 'skill', 'demo', fm(['name: demo'])));
  assert.match(ausente.join('\n'), /falta description/);
  const plegada = erroresDeDocumento(documento('s', 'skill', 'demo', fm(['name: demo', 'description: >', '  línea uno', '  línea dos'])));
  assert.match(plegada.join('\n'), /más de una línea/);
  const larga = erroresDeDocumento(documento('s', 'skill', 'demo', fm(['name: demo', `description: "${'a'.repeat(241)}"`])));
  assert.match(larga.join('\n'), /241 caracteres/);
  const limite = erroresDeDocumento(documento('s', 'skill', 'demo', fm(['name: demo', `description: "${'a'.repeat(240)}"`])));
  assert.deepStrictEqual(limite, []);
});

test('regla 4: dos skills con la misma description se rechazan', () => {
  const docs = [
    documento('a', 'skill', 'demo', fm(SKILL_VALIDA)),
    documento('b', 'fragmento', 'demo', fm(SKILL_VALIDA)),
  ];
  assert.match(erroresDeDuplicados(docs).join('\n'), /b: description duplicada con a/);
});

test('regla 5: una skill con model se rechaza', () => {
  const errores = erroresDeDocumento(documento('s', 'skill', 'demo', fm([...SKILL_VALIDA, 'model: sonnet'])));
  assert.match(errores.join('\n'), /una skill no declara model/);
});

test('regla 6: un campo fuera de la lista del tipo se rechaza', () => {
  const comando = erroresDeDocumento(documento('c', 'comando', null, fm(['description: "d"', 'name: demo'])));
  assert.match(comando.join('\n'), /campo "name" no permitido en un comando/);
  const agente = erroresDeDocumento(documento('a', 'agente', 'demo', fm(['name: demo', 'description: "d"', 'color: red'])));
  assert.match(agente.join('\n'), /campo "color" no permitido en un agente/);
});

test('regla 6: source-body se rechaza en una skill y se admite en un fragmento de docs-src', () => {
  const conCuerpo = [...SKILL_VALIDA, 'source-body: omit'];
  const enSkill = erroresDeDocumento(documento('.claude/skills/demo/SKILL.md', 'skill', 'demo', fm(conCuerpo)));
  assert.match(enSkill.join('\n'), /campo "source-body" no permitido en una skill/);
  const enFragmento = erroresDeDocumento(documento('docs-src/skills/demo.md', 'fragmento', 'demo', fm(conCuerpo)));
  assert.deepStrictEqual(enFragmento, []);
});

test('regla 7: una salida con un campo solo-Claude se rechaza', () => {
  const soloClaude = camposSoloClaude();
  assert.ok(soloClaude.includes('argument-hint'), 'argument-hint debería ser solo-Claude');
  const salida = { ruta: '.agents/skills/demo/SKILL.md', contenido: fm([...SKILL_VALIDA, 'argument-hint: "[x]"']) };
  assert.match(erroresDeSalida([salida], soloClaude).join('\n'), /campo solo-Claude "argument-hint"/);
  const limpia = { ruta: '.agents/skills/demo/SKILL.md', contenido: fm(SKILL_VALIDA) };
  assert.deepStrictEqual(erroresDeSalida([limpia], soloClaude), []);
});

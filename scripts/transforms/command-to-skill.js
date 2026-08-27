'use strict';

// Convierte un comando de Claude Code (`.claude/commands/<nombre>.md`) en la
// skill con que Codex y Antigravity entregan esa misma capacidad
// (`.agents/skills/<nombre>/SKILL.md`). Los dos backends descubren sus skills
// en el mismo directorio, asi que el fichero generado es uno solo.
//
// POR QUE: en esos dos backends los comandos son skills. Sin este transform la
// misma capacidad tenia dos textos, uno vivo y otro copiado a mano, y una
// instruccion anadida al comando llegaba a dos backends de cuatro.
//
// QUE APORTA CADA LADO:
//   comando   el cuerpo de las instrucciones. Es el dueno canonico.
//   fragmento `docs-src/skills/<nombre>.md`, obligatorio. Aporta el
//             frontmatter de la skill y lo que sea propio de este formato.
//
// El frontmatter no puede salir del comando: una skill se activa sola, por lo
// que su `description` describe CUANDO entra ("se activa cuando el usuario
// pide..."), mientras que la del comando resume que hace. Son dos textos
// distintos por definicion, no una copia con otras palabras, y por eso el
// fragmento es obligatorio y no opcional.
//
// El cuerpo del comando se retoca en tres puntos, todos en `command-body.js`:
// se retiran los bloques marcados como exclusivos de Claude Code, se retira el
// bloque final de argumentos (una skill no recibe argumentos) y las
// referencias `/<nombre>` pasan a nombrar la skill homonima.
//
// `source-body: omit` en el fragmento sustituye el cuerpo del comando por el
// del fragmento. Es la excepcion declarada para las capacidades cuyo comando de
// Claude Code delega en el motor de workflows, que estos backends no tienen: el
// cuerpo del comando dice "usa la herramienta Workflow", que aqui no se puede
// seguir. Misma excepcion, y por el mismo motivo, que la que ya usan esos dos
// comandos para el backend de Gemini.
//
// El modelo sigue la regla comun a todos los artefactos generados: lo decide
// `scripts/model-policy.json`, nunca el fichero fuente.

const path = require('node:path');
const { parsearFrontmatter, valorCrudo, valorObligatorio, componerMarkdown } = require('./frontmatter');
const { modeloDe } = require('./policy-lookup');
const {
  quitarBloquesSoloClaude,
  quitarBloqueDeArgumentos,
  traducirReferenciasDeComando,
} = require('./command-body');
const manifest = require('../artifact-manifest.json');

/** Backends que leen `.agents/skills/`. Los dos reciben el mismo fichero. */
const BACKENDS_DE_SKILL = new Set(['antigravity', 'codex']);

/**
 * Nombres de los comandos que este mismo transform sabe convertir en skill
 * (`.claude/commands/<nombre>.md`, sin extension), leidos del manifiesto de
 * artefactos. Es el conjunto que `traducirReferenciasDeComando` usa para
 * distinguir una referencia real (`/planificar`) de una ruta que empieza por
 * barra: solo un comando declarado aqui se traduce.
 */
const COMANDOS_CONOCIDOS = new Set(
  manifest.artifacts
    .filter(entry => entry.transform === 'command-to-skill')
    .map(entry => path.basename(entry.source, '.md'))
);

/** Campo del fragmento que decide el cuerpo. No es un campo de la skill: no llega a la salida. */
const CAMPO_CUERPO = 'source-body';
const CUERPO_INCLUIDO = 'include';
const CUERPO_OMITIDO = 'omit';

/** Nombre de la skill que implica `ruta` (`.agents/skills/<nombre>/SKILL.md`), o `null`. */
function nombreSegunRuta(ruta) {
  const partes = String(ruta || '').split('/');
  return partes.length >= 2 ? partes[partes.length - 2] : null;
}

/** Valor de `source-body` del fragmento. Lanza si declara uno que el transform no conoce. */
function modoDeCuerpo(campos, origen) {
  const declarado = valorCrudo(campos, CAMPO_CUERPO);
  if (declarado === undefined) return CUERPO_INCLUIDO;

  const valor = declarado.trim();
  if (valor !== CUERPO_INCLUIDO && valor !== CUERPO_OMITIDO) {
    throw new Error(
      `INVALID_SOURCE_BODY: "${origen}" declara ${CAMPO_CUERPO}: "${valor}"; `
        + `los unicos valores son "${CUERPO_INCLUIDO}" y "${CUERPO_OMITIDO}".`
    );
  }
  return valor;
}

/**
 * Campos del frontmatter de la skill: los del fragmento sin el campo de
 * construccion, y con el modelo que fija la politica en lugar del que declare
 * el fragmento (o sin campo, si la politica no asigna ninguno al backend).
 */
function frontmatterDeLaSkill(campos, politica, backend, nombre) {
  const modelo = modeloDe(politica, backend, nombre);

  return campos
    .filter(campo => campo.clave !== CAMPO_CUERPO)
    .flatMap(campo => {
      if (campo.clave !== 'model') return [campo];
      return modelo === null ? [] : [{ ...campo, valor: String(modelo) }];
    });
}

/** El cuerpo del comando adaptado al formato de skill. */
function cuerpoDelComando(contenidoFuente, origen) {
  const { cuerpo } = parsearFrontmatter(contenidoFuente, origen);
  return traducirReferenciasDeComando(quitarBloqueDeArgumentos(quitarBloquesSoloClaude(cuerpo)), COMANDOS_CONOCIDOS);
}

/** `base` y `anexo` unidos por una linea en blanco. Ignora el que venga vacio. */
function unir(base, anexo) {
  const izquierda = base.replace(/\n+$/, '');
  const derecha = anexo.replace(/^\n+/, '').replace(/\n+$/, '');
  if (!izquierda) return derecha ? `${derecha}\n` : '';
  return derecha ? `${izquierda}\n\n${derecha}\n` : `${izquierda}\n`;
}

/** La skill de `entrada` para el backend de su output actual. */
function transformarComandoASkill(contenidoFuente, entrada = {}, politica = {}) {
  const backend = (entrada.output && entrada.output.backend) || entrada.backend;
  if (!BACKENDS_DE_SKILL.has(backend)) {
    throw new Error(`BACKEND_NOT_SUPPORTED: el transform de comando a skill no sabe generar para el backend "${backend}".`);
  }

  if (typeof entrada.fragmentContent !== 'string') {
    throw new Error(
      `FRAGMENT_REQUIRED: "${entrada.id || entrada.source}" no declara fragmento. `
        + 'La skill necesita su propio frontmatter: la descripcion de activacion no sale del comando.'
    );
  }

  const origenFragmento = entrada.fragment || `${entrada.id} (fragmento)`;
  const { campos, cuerpo: cuerpoFragmento } = parsearFrontmatter(entrada.fragmentContent, origenFragmento);

  const nombre = valorObligatorio(campos, 'name', origenFragmento);
  valorObligatorio(campos, 'description', origenFragmento);

  const rutaSalida = entrada.output && entrada.output.path;
  const esperado = nombreSegunRuta(rutaSalida);
  if (esperado && esperado !== nombre) {
    throw new Error(
      `SKILL_NAME_MISMATCH: "${origenFragmento}" declara name: "${nombre}" pero su salida es "${rutaSalida}". `
        + 'El nombre de la skill es el de su directorio; con otro, el backend la descubre con un nombre que nadie referencia.'
    );
  }

  const modo = modoDeCuerpo(campos, origenFragmento);
  const base = modo === CUERPO_OMITIDO ? '' : cuerpoDelComando(contenidoFuente, entrada.source || entrada.id || 'desconocido');

  return componerMarkdown(
    frontmatterDeLaSkill(campos, politica, backend, nombre),
    unir(base, cuerpoFragmento)
  );
}

module.exports = { transformarComandoASkill, nombreSegunRuta, unir };

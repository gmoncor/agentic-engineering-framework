'use strict';

/**
 * Orquestacion de /implementar-spec: orden de ejecucion y validacion de
 * dependencias entre tasks.
 *
 * Vive fuera del workflow para poder probarse sin el runtime de workflows.
 */

const fs = require('fs');
const path = require('path');

// ── Oleadas y ciclos ─────────────────────────────────────────────────────────

/**
 * Dependencias que apuntan a otra task de esta misma spec. Las que no apuntan a
 * ninguna task conocida se ignoran porque ya estan hechas — pero eso solo vale si
 * el documento al que apuntan EXISTE. Verificarlo es cosa de validarDependencias:
 * sin esa comprobacion previa, una dependencia mal escrita se cuela aqui como
 * "externa" y la task arranca como si no dependiera de nada.
 */
function depsInternas(task, conocidas) {
  return (task.dependencias || []).filter(d => conocidas.has(d));
}

/**
 * Una dependencia que no es de esta spec y que tampoco existe en disco es un error
 * del plan, no una dependencia externa ya satisfecha. Casi siempre es un path mal
 * escrito: descartarla en silencio lanzaria la task sin su pre-requisito.
 */
function validarDependencias(tasks, raiz) {
  const conocidas = new Set(tasks.map(t => t.path));
  const rotas = [];

  for (const t of tasks) {
    for (const d of (t.dependencias || [])) {
      if (conocidas.has(d)) continue;
      if (!fs.existsSync(path.resolve(raiz || '.', d))) rotas.push(t.path + ' -> ' + d);
    }
  }

  if (rotas.length > 0) {
    throw new Error('DEPENDENCIA_INEXISTENTE: hay dependencias que no son de esta spec y cuyo '
      + 'documento de task no existe: ' + rotas.join('; ') + '. Corrige el path (o elimina la '
      + 'dependencia) antes de implementar: una dependencia mal escrita dejaria la task sin su '
      + 'pre-requisito.');
  }
}

/**
 * Agrupa las tasks en niveles topologicos: nivel 1 = sin dependencias, nivel N =
 * dependencias resueltas en niveles anteriores. Sirve para visualizar el plan; el
 * despacho real va task a task, en cuanto las dependencias de cada una terminan.
 *
 * Un ciclo es un error de planificacion: lanzarlo en paralelo seria ejecutar a la
 * vez justo lo que la dependencia pretendia ordenar.
 */
function computeWaves(tasks, raiz) {
  validarDependencias(tasks, raiz);

  const conocidas = new Set(tasks.map(t => t.path));
  const completadas = new Set();
  const waves = [];
  let restantes = tasks.slice();

  while (restantes.length > 0) {
    const wave = restantes.filter(t => depsInternas(t, conocidas).every(d => completadas.has(d)));

    if (wave.length === 0) {
      const enCiclo = restantes.map(t => t.path).join(', ');
      throw new Error('CICLO_DETECTADO: dependencias circulares entre tasks: ' + enCiclo
        + '. Corregir las dependencias antes de implementar.');
    }

    for (const t of wave) completadas.add(t.path);
    waves.push(wave);
    restantes = restantes.filter(t => !completadas.has(t.path));
  }
  return waves;
}

// ── Contratos entre tasks ────────────────────────────────────────────────────

/**
 * Un contrato es algo que una task produce (API, tipo, export) y otra consume.
 * El consumidor debe depender del productor: si no, puede arrancar antes de que
 * lo que consume exista.
 */
function verificarContratos(tasks) {
  const productores = new Map();
  for (const t of tasks) {
    for (const c of (t.contratos || [])) {
      if (c.tipo === 'produce') productores.set(c.nombre, t.path);
    }
  }

  const problemas = [];
  const conocidas = new Set(tasks.map(t => t.path));

  for (const t of tasks) {
    for (const c of (t.contratos || [])) {
      if (c.tipo !== 'consume') continue;
      const productor = productores.get(c.nombre);
      if (!productor) {
        problemas.push(t.path + ' consume el contrato "' + c.nombre + '" que ninguna task produce');
      } else if (productor !== t.path && !depsInternas(t, conocidas).includes(productor)) {
        problemas.push(t.path + ' consume "' + c.nombre + '" pero no depende de su productor ' + productor);
      }
    }
  }
  return problemas;
}

module.exports = {
  validarDependencias,
  computeWaves,
  verificarContratos,
};

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

// ── Gate de tests: ejecutar el comando real, no creer al implementador ────────

/**
 * Descubre el comando de test del proyecto. El gate lo EJECUTA y lee su exit
 * code: nunca cree numeros de tests que el propio implementador reporte (quien
 * escribe el codigo no puede certificar sus tests sin circularidad).
 *
 * Prioridad: comando configurado explicitamente > npm > pytest. La ausencia de
 * comando NO es un fallo aqui; es el llamador quien decide si degrada o bloquea
 * (evaluarGateTests), segun la task toque codigo o solo docs.
 */
function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

function comandoConfigurado(base) {
  const cfg = leerJson(path.resolve(base, 'hooks', 'config.json'));
  const cmd = cfg && cfg.sdd_test_gate && cfg.sdd_test_gate.command;
  if (typeof cmd !== 'string' || !cmd.trim()) return null;
  const partes = cmd.trim().split(/\s+/);
  return { cmd: partes[0], args: partes.slice(1), fuente: 'hooks/config.json' };
}

function comandoNpm(base) {
  const pkg = leerJson(path.resolve(base, 'package.json'));
  const script = pkg && pkg.scripts && pkg.scripts.test;
  // El placeholder por defecto de npm ("no test specified" + exit 1) no es un
  // comando real: bloquearia toda task por un rojo falso.
  if (typeof script !== 'string' || /no test specified/i.test(script)) return null;
  return { cmd: 'npm', args: ['test'], fuente: 'package.json' };
}

function comandoPytest(base) {
  if (fs.existsSync(path.resolve(base, 'pytest.ini'))) {
    return { cmd: 'pytest', args: [], fuente: 'pytest.ini' };
  }
  // setup.cfg solo configura pytest si declara la seccion [tool:pytest]; su mera
  // existencia no implica un runner.
  const cfg = path.resolve(base, 'setup.cfg');
  if (fs.existsSync(cfg)) {
    let txt = '';
    try { txt = fs.readFileSync(cfg, 'utf8'); } catch { txt = ''; }
    if (/\[tool:pytest\]/.test(txt)) return { cmd: 'pytest', args: [], fuente: 'setup.cfg' };
  }
  return null;
}

function descubrirComandoTest(raiz) {
  const base = raiz || '.';
  return comandoConfigurado(base) || comandoNpm(base) || comandoPytest(base) || null;
}

// Extensiones que NO son codigo ejecutable: docs, config y plantillas. Una task
// que solo las toca esta exenta del gate cuando no hay comando de test.
const EXT_NO_EJECUTABLE = new Set([
  '.md', '.markdown', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml',
  '.ini', '.cfg', '.lock', '.env', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.svg',
]);

/**
 * True si algun archivo tocado es codigo ejecutable (no docs/config). Un archivo
 * sin extension se trata como no-ejecutable: ante la duda, no bloquear sin
 * evidencia de que hay codigo que probar.
 */
function tocaCodigoEjecutable(archivos) {
  return (archivos || []).some((a) => {
    const ext = path.extname(String(a)).toLowerCase();
    return ext !== '' && !EXT_NO_EJECUTABLE.has(ext);
  });
}

/**
 * Decide el veredicto del gate a partir del comando descubierto, su exit code y
 * los archivos que la task modifico. Funcion pura: el spawn del comando ocurre en
 * el workflow. Estados: PASA | FALLIDA | ADVISORY.
 */
function evaluarGateTests(entrada) {
  const { comando, exitCode, archivos } = entrada || {};

  // Hay comando: manda el exit code. Rojo (!= 0) SIEMPRE bloquea.
  if (comando) {
    if (exitCode === 0) {
      return { estado: 'PASA', nota: 'Tests verdes (exit 0) via ' + comando.fuente };
    }
    return { estado: 'FALLIDA', nota: 'Tests en rojo (exit ' + exitCode + ') via ' + comando.fuente };
  }

  // Sin comando: bloquea solo si la task toca codigo (no hay como probarlo);
  // docs/config quedan exentas y continuan con aviso, no se bloquea sin evidencia.
  if (tocaCodigoEjecutable(archivos)) {
    return { estado: 'FALLIDA', nota: 'No se encontro comando de test para validar cambios de codigo ejecutable' };
  }
  return { estado: 'ADVISORY', nota: 'No se encontro comando de test; la task solo toca docs/config (exenta)' };
}

module.exports = {
  validarDependencias,
  computeWaves,
  verificarContratos,
  descubrirComandoTest,
  tocaCodigoEjecutable,
  evaluarGateTests,
};

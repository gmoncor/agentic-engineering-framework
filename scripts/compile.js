'use strict';

// Compilador de `scripts/artifact-manifest.json`: lee cada `source` de una
// entrada `mode: "managed"`, aplica el transform declarado y compara, escribe
// o reporta cada `output` segun el modo elegido. Las entradas `mode:
// "preserve"` no se tocan: se editan a mano en su propia ruta.
//
// Tres modos:
//   --check    (por defecto) compara con disco y nombra cada salida con deriva
//              junto a su fuente y las primeras lineas que divergen.
//   --write    escribe las salidas a disco, sobreescribiendo las existentes.
//   --dry-run  reporta que archivos cambiarian sin escribir nada.
//
// `--quiet` reduce el reporte a una sola linea por ejecucion, para usarlo como
// gate de CI o de pre-push sin ruido en el log.
//
// Exit codes, iguales en los tres modos:
//   0  el arbol generado coincide con sus fuentes.
//   1  hay deriva (solo `--check` la trata como fallo).
//   2  error interno: fuente ausente, transform no registrado o que lanza,
//      manifiesto ilegible, o un backend que el manifiesto genera y la politica
//      no declara. Va por stderr, aparte del reporte de deriva. `--quiet`
//      reduce el detalle, nunca el codigo de salida: una degradacion que
//      dejaria artefactos sin modelo ni herramientas no puede salir con 0.
//
// El transform de una entrada se invoca una vez por cada output, con una
// copia de la entrada decorada con `output: <la salida actual>`: asi una
// entrada con salidas en formatos distintos por backend (p.ej. TOML para un
// backend, Markdown para otro) puede decidir el formato sin que el engine
// cambie. El transform `identity` ignora ese contexto y copia el contenido
// literal, igual para cualquier output.
//
// Una entrada puede declarar ademas `fragment`: una segunda fuente que el
// engine lee una vez y entrega al transform en `entry.fragmentContent`. La usan
// los transforms que combinan un origen compartido con la variante de un
// backend concreto.
//
// El tercer argumento de todo transform es la politica de
// `scripts/model-policy.json`: el modelo y las capacidades de un artefacto
// generado salen de ahi y nunca del fichero fuente, de modo que cambiarlos para
// un backend entero es cambiar una linea de la politica.
//
// La entrada decorada lleva ademas `variables`: los valores que el transform
// interpola en la salida. Hoy solo `VERSION`, leida de `package.json`, para que
// la version que declaran los documentos generados no pueda quedarse atras de
// la del paquete.

const fs = require('node:fs');
const path = require('node:path');

const { cargarManifiesto, MANIFEST_PATH, RAIZ } = require('./validate-manifest');
const { ensamblarDocumento } = require('./transforms/doc-fragment-assembly');
const { transformarAgente } = require('./transforms/agent-to-backend');
const { transformarComando } = require('./transforms/command-to-backend');
const { transformarSkill } = require('./transforms/skill-to-backend');
const { transformarComandoASkill } = require('./transforms/command-to-skill');
const { declaraBackend } = require('./transforms/policy-lookup');

const POLICY_PATH = path.join(__dirname, 'model-policy.json');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');

/** Exit codes del compilador, comunes a la CLI y a los tests. */
const SALIDA_OK = 0;
const SALIDA_DERIVA = 1;
const SALIDA_ERROR = 2;

/** Numero de lineas divergentes que el reporte de deriva muestra por salida. */
const LINEAS_DE_DIFF = 3;

/** Politica de modelo y capacidades por backend. */
function cargarPolitica(rutaPolitica = POLICY_PATH) {
  return JSON.parse(fs.readFileSync(rutaPolitica, 'utf8'));
}

/**
 * Variables que los transforms interpolan en sus salidas. La version sale de
 * `package.json` y de ningun otro sitio; sin ella la compilacion falla antes de
 * escribir nada, en vez de emitir documentos con el marcador sin resolver.
 */
function cargarVariables(rutaPaquete = PACKAGE_PATH) {
  const { version } = JSON.parse(fs.readFileSync(rutaPaquete, 'utf8'));
  if (!version) throw new Error('VERSION_NOT_FOUND: package.json no declara el campo "version".');
  return { VERSION: version };
}

/** Registry de transforms disponibles: `{ nombre: (sourceContent, entry, politica) => outputContent }`. */
const TRANSFORMS = {
  identity: sourceContent => sourceContent,
  'doc-fragment-assembly': (sourceContent, entry) => ensamblarDocumento(sourceContent, entry.fragmentContent, entry),
  'agent-to-backend': transformarAgente,
  'command-to-backend': (sourceContent, entry) => transformarComando(sourceContent, entry),
  'command-to-skill': transformarComandoASkill,
  'skill-to-backend': transformarSkill,
};

/** Transforms que aplican la politica de modelos y por tanto exigen que su backend este declarado en ella. */
const TRANSFORMS_CON_POLITICA = new Set(['agent-to-backend', 'skill-to-backend', 'command-to-skill']);

const MODOS_VALIDOS = ['check', 'write', 'dry-run'];

/** Modo pedido por `--check`/`--write`/`--dry-run` en `args`. Ausente o desconocido => 'check'. */
function parseModo(args) {
  for (const arg of args) {
    if (MODOS_VALIDOS.includes(arg.replace(/^--/, ''))) return arg.replace(/^--/, '');
  }
  return 'check';
}

/** `--quiet` en `args` reduce el reporte a una sola linea. */
function parseQuiet(args) {
  return args.includes('--quiet');
}

/** Lanza si el manifiesto no tiene la forma minima esperada (artifacts[], transforms_registry{}). */
function validarEsquemaBasico(manifest) {
  if (!manifest || !Array.isArray(manifest.artifacts)) {
    throw new Error('MANIFEST_INVALID: se esperaba manifest.artifacts como array.');
  }
  if (!manifest.transforms_registry || typeof manifest.transforms_registry !== 'object') {
    throw new Error('MANIFEST_INVALID: se esperaba manifest.transforms_registry como objeto.');
  }
}

/**
 * Primeras `LINEAS_DE_DIFF` lineas en que `enDisco` se aparta de `esperado`,
 * cada una con su numero de linea y ambos contenidos entrecomillados. Sirve
 * para que el reporte de deriva diga que cambio, no solo que hay un cambio.
 */
function resumirDiff(esperado, enDisco) {
  const izquierda = esperado.split('\n');
  const derecha = enDisco.split('\n');
  const lineas = [];

  for (let i = 0; i < Math.max(izquierda.length, derecha.length) && lineas.length < LINEAS_DE_DIFF; i += 1) {
    if (izquierda[i] === derecha[i]) continue;
    lineas.push(`L${i + 1}: fuente ${JSON.stringify(izquierda[i] ?? '')} / disco ${JSON.stringify(derecha[i] ?? '')}`);
  }

  return lineas;
}

/**
 * Procesa un unico output de una entrada ya transformada. En `check` y
 * `dry-run` compara con disco y devuelve `{ path, estado, detalle?, diff? }`.
 * En `write` NO toca disco: calcula y devuelve `{ path, rutaAbsoluta,
 * contenido }` para que `aplicarEscritura` escriba todas las salidas de la
 * entrada juntas, una vez calculadas todas — asi un fallo de disco en una
 * salida no deja a sus hermanas ya escritas.
 */
function procesarOutput(raiz, outputContent, salida, modo) {
  const rutaAbsoluta = path.join(raiz, salida.path);

  if (modo === 'write') {
    return { path: salida.path, rutaAbsoluta, contenido: outputContent };
  }

  const existe = fs.existsSync(rutaAbsoluta);
  const enDisco = existe ? fs.readFileSync(rutaAbsoluta, 'utf8') : null;
  const coincide = enDisco === outputContent;

  if (modo === 'dry-run') {
    if (!existe) return { path: salida.path, estado: 'cambiaria', detalle: 'no existe, se crearia' };
    return coincide
      ? { path: salida.path, estado: 'sin-cambios' }
      : { path: salida.path, estado: 'cambiaria', detalle: 'contenido difiere' };
  }

  if (!existe) return { path: salida.path, estado: 'drift', detalle: 'OUTPUT_MISSING' };
  if (coincide) return { path: salida.path, estado: 'ok' };
  return { path: salida.path, estado: 'drift', detalle: 'contenido difiere', diff: resumirDiff(outputContent, enDisco) };
}

/**
 * Nombre de fichero temporal, hermano del destino declarado. El sufijo es
 * reconocible y no colisiona con ninguna salida gestionada: si un proceso se
 * interrumpe antes de renombrar, el residuo no se confunde con un artefacto ni
 * el `--check` siguiente lo cuenta como deriva.
 */
function rutaTemporal(rutaAbsoluta) {
  return `${rutaAbsoluta}.compile-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Aplica en disco las salidas ya calculadas de una entrada, en tres pasos:
 * crea los directorios padre de todas, escribe cada contenido en un temporal
 * hermano de su destino y renombra cada temporal a su destino. Es la unidad de
 * consistencia que el manifiesto declara: o se aplican todas las salidas de la
 * entrada, o ninguna.
 *
 * Un fallo en los dos primeros pasos no deja ninguna salida aplicada: los
 * temporales ya creados se retiran y el error original se propaga tal cual. El
 * renombrado es la operacion con menos formas de fallar, pero si aun asi una
 * falla a mitad, el mensaje nombra las salidas que ya quedaron aplicadas para
 * que quien lo lea sepa que el arbol quedo a medias y hay que reejecutar.
 */
function aplicarEscritura(calculados) {
  const pendientes = calculados.map(c => ({ ...c, temporal: rutaTemporal(c.rutaAbsoluta) }));
  // Limpieza best-effort: un temporal cuyo padre nunca llego a existir (el
  // mismo motivo por el que el paso anterior fallo) hace que `rmSync` lance
  // ENOTDIR incluso con `force`, que solo absorbe ENOENT. Esa excepcion de
  // limpieza no puede sustituir al error real que se esta propagando.
  const retirarTemporales = () => pendientes.forEach(p => {
    try {
      fs.rmSync(p.temporal, { force: true });
    } catch {
      // Residuo aceptado: ver "Riesgos aceptados" sobre temporales tras interrupcion.
    }
  });

  try {
    pendientes.forEach(p => fs.mkdirSync(path.dirname(p.rutaAbsoluta), { recursive: true }));
    pendientes.forEach(p => fs.writeFileSync(p.temporal, p.contenido));
  } catch (err) {
    retirarTemporales();
    throw err;
  }

  const aplicadas = [];
  try {
    for (const p of pendientes) {
      fs.renameSync(p.temporal, p.rutaAbsoluta);
      aplicadas.push(p.path);
    }
  } catch (err) {
    retirarTemporales();
    const nombres = aplicadas.length ? aplicadas.join(', ') : 'ninguna';
    throw new Error(`${err.message} (salidas ya aplicadas antes del fallo: ${nombres})`);
  }

  return pendientes.map(p => ({ path: p.path, estado: 'escrito', source: p.source }));
}

/** Contenido del `fragment` declarado por la entrada, o `null` si no declara ninguno. */
function leerFragmento(raiz, entry) {
  if (!entry.fragment) return { contenido: null };

  const rutaFragmento = path.join(raiz, entry.fragment);
  if (!fs.existsSync(rutaFragmento)) {
    return { error: `FRAGMENT_NOT_FOUND: ${entry.fragment}` };
  }

  return { contenido: fs.readFileSync(rutaFragmento, 'utf8') };
}

/**
 * Procesa una entrada managed: lee el source y el `fragment` opcional, aplica
 * el transform declarado por cada output y delega en `procesarOutput`. Un
 * source ausente, un fragmento declarado y ausente, un transform no registrado
 * o un transform que lanza devuelven `error` sin propagar, para que el llamador
 * pueda seguir con el resto de entradas.
 *
 * En modo escritura, `procesarOutput` solo calcula: ningun output llega a
 * disco hasta que todos los de la entrada estan calculados, momento en que
 * `aplicarEscritura` los escribe juntos. Un fallo de disco a mitad de ese paso
 * tambien se reporta como `error` de la entrada, igual que un fallo de calculo.
 */
function procesarEntrada(raiz, entry, modo, politica, variables = {}) {
  const transformFn = TRANSFORMS[entry.transform];
  if (!transformFn) {
    return { entryId: entry.id, resultados: [], error: `TRANSFORM_NOT_REGISTERED: ${entry.transform}` };
  }

  const sourcePath = path.join(raiz, entry.source);
  if (!fs.existsSync(sourcePath)) {
    return { entryId: entry.id, resultados: [], error: `SOURCE_NOT_FOUND: ${entry.source}` };
  }

  const fragmento = leerFragmento(raiz, entry);
  if (fragmento.error) {
    return { entryId: entry.id, resultados: [], error: fragmento.error };
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf8');
  try {
    const calculados = (entry.outputs || []).map(salida => {
      const contexto = { ...entry, output: salida, fragmentContent: fragmento.contenido, variables };
      const resultado = procesarOutput(raiz, transformFn(sourceContent, contexto, politica), salida, modo);
      return { ...resultado, source: entry.source };
    });
    const resultados = modo === 'write' ? aplicarEscritura(calculados) : calculados;
    return { entryId: entry.id, resultados, error: null };
  } catch (err) {
    return { entryId: entry.id, resultados: [], error: err.message };
  }
}

/**
 * Backends que el manifiesto genera con un transform sujeto a la politica pero
 * que la politica no declara, con la entrada que los pide. Es un error, no un
 * aviso: sin seccion en la politica el artefacto sale sin modelo y sin su lista
 * de herramientas, y esa perdida no puede depender de que alguien lea un aviso
 * por consola.
 */
function brechasDePolitica(manifest, politica) {
  const pendientes = new Map();

  for (const entry of manifest.artifacts) {
    if (entry.mode !== 'managed' || !TRANSFORMS_CON_POLITICA.has(entry.transform)) continue;
    for (const salida of entry.outputs || []) {
      if (salida.backend && !declaraBackend(politica, salida.backend) && !pendientes.has(salida.backend)) {
        pendientes.set(salida.backend, entry.id);
      }
    }
  }

  return [...pendientes].map(([backend, entryId]) => ({
    entryId,
    mensaje:
      `MODEL_POLICY_MISSING_BACKEND: la politica no declara el backend "${backend}", `
      + 'asi que sus artefactos saldrian sin modelo y sin herramientas.',
  }));
}

/**
 * Compila el manifiesto completo contra `raiz` en el `modo` dado. Ignora
 * entradas `mode !== "managed"`. Un error en una entrada (transform no
 * registrado, source ausente) se acumula en `errores` sin detener el resto.
 * `variables` llega a cada transform para que interpole sus valores en la
 * salida.
 *
 * Una brecha de la politica es la excepcion: se comprueba antes de procesar
 * nada y aborta la compilacion entera, para que un backend sin seccion propia
 * no llegue a escribir artefactos sin modelo ni herramientas.
 */
function compilar(manifest, raiz, modo, politica = cargarPolitica(), variables = cargarVariables()) {
  validarEsquemaBasico(manifest);

  const brechas = brechasDePolitica(manifest, politica);
  if (brechas.length) return { resultados: [], errores: brechas };

  const errores = [];
  const resultados = [];

  for (const entry of manifest.artifacts) {
    if (entry.mode !== 'managed') continue;
    const { entryId, resultados: resultadosEntrada, error } = procesarEntrada(raiz, entry, modo, politica, variables);
    if (error) {
      errores.push({ entryId, mensaje: error });
      continue;
    }
    resultados.push({ entryId, resultados: resultadosEntrada });
  }

  return { resultados, errores };
}

/** Cuenta las salidas en `estado` dentro de una lista ya aplanada. */
function contar(salidas, estado) {
  return salidas.filter(o => o.estado === estado).length;
}

/**
 * Reporte de `--quiet`: una sola linea con la cifra que decide el exit code.
 * Pensado para el log de un CI, donde el detalle se pide aparte.
 */
function reportarBreve(modo, salidas, errores) {
  if (errores.length) {
    console.error(`${errores.length} entradas con error interno`);
    return SALIDA_ERROR;
  }
  if (modo === 'write') {
    console.log(`${contar(salidas, 'escrito')} archivos escritos`);
    return SALIDA_OK;
  }
  if (modo === 'dry-run') {
    console.log(`${contar(salidas, 'cambiaria')} archivos cambiarian`);
    return SALIDA_OK;
  }

  const deriva = contar(salidas, 'drift');
  console.log(`${deriva} archivos con deriva`);
  return deriva ? SALIDA_DERIVA : SALIDA_OK;
}

/** Una salida con deriva: su fuente y las primeras lineas en que se aparta de ella. */
function imprimirDeriva(salida) {
  console.log(`  - ${salida.path} (${salida.detalle})`);
  console.log(`    fuente: ${salida.source}`);
  (salida.diff || []).forEach(linea => console.log(`    ${linea}`));
}

/** Reporte de `--check`. Devuelve el exit code: el error interno pesa mas que la deriva. */
function reportarCheck(salidas, hayErrores) {
  const conDeriva = salidas.filter(o => o.estado === 'drift');
  console.log(`Verificados: ${contar(salidas, 'ok')}`);

  if (conDeriva.length) {
    console.log(`Con deriva: ${conDeriva.length}`);
    conDeriva.forEach(imprimirDeriva);
  } else if (!hayErrores) {
    console.log('Sin deriva: todas las salidas gestionadas coinciden con su fuente.');
  }

  if (hayErrores) return SALIDA_ERROR;
  return conDeriva.length ? SALIDA_DERIVA : SALIDA_OK;
}

/**
 * Imprime el resumen segun el modo y devuelve el exit code: 0 sin deriva,
 * 1 con deriva (solo `--check`), 2 si alguna entrada no se pudo compilar.
 */
function reportar(modo, resultados, errores, opciones = {}) {
  const salidas = resultados.flatMap(r => r.resultados);
  if (opciones.quiet) return reportarBreve(modo, salidas, errores);

  if (errores.length) {
    console.error(`Errores: ${errores.length}`);
    errores.forEach(({ entryId, mensaje }) => console.error(`  - ${entryId}: ${mensaje}`));
  }

  if (modo === 'write') {
    console.log(`Escritos: ${contar(salidas, 'escrito')}`);
    return errores.length ? SALIDA_ERROR : SALIDA_OK;
  }

  if (modo === 'dry-run') {
    const cambiarian = salidas.filter(o => o.estado === 'cambiaria');
    console.log(`Sin cambios: ${contar(salidas, 'sin-cambios')}`);
    console.log(`Cambiarian: ${cambiarian.length}`);
    cambiarian.forEach(o => console.log(`  - ${o.path} (${o.detalle})`));
    return errores.length ? SALIDA_ERROR : SALIDA_OK;
  }

  return reportarCheck(salidas, errores.length > 0);
}

/**
 * Ejecuta la compilacion completa (parseo de flags + carga + compilar +
 * reportar) y devuelve el exit code. `politica` se inyecta para poder ejercitar
 * el gate completo contra una politica degradada sin tocar el fichero real.
 */
function ejecutarCompilacion(args, raiz = RAIZ, politica = cargarPolitica()) {
  const modo = parseModo(args);
  try {
    const { resultados, errores } = compilar(cargarManifiesto(), raiz, modo, politica);
    return reportar(modo, resultados, errores, { quiet: parseQuiet(args) });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return SALIDA_ERROR;
  }
}

function main() {
  process.exitCode = ejecutarCompilacion(process.argv.slice(2));
}

if (require.main === module) {
  main();
}

module.exports = {
  compilar,
  cargarPolitica,
  cargarVariables,
  brechasDePolitica,
  procesarEntrada,
  procesarOutput,
  parseModo,
  parseQuiet,
  resumirDiff,
  validarEsquemaBasico,
  ejecutarCompilacion,
  TRANSFORMS,
  MANIFEST_PATH,
  POLICY_PATH,
  PACKAGE_PATH,
  RAIZ,
  SALIDA_OK,
  SALIDA_DERIVA,
  SALIDA_ERROR,
};

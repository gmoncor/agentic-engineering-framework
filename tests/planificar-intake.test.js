'use strict';

// Contrato de la fase de intake del workflow de planificacion.
//
// Lo que se prueba es la RAMIFICACION posterior a la respuesta del asesor, no la
// llamada al modelo: cada test entrega un objeto que simula esa respuesta y
// comprueba si la planificacion continua o se detiene. La garantia critica es
// que ninguna respuesta invalida, incompleta o con un veredicto desconocido deje
// pasar la planificacion en silencio: sin intake valido no se crea spec.

const test = require('node:test');
const assert = require('node:assert');
const intake = require('../.claude/workflows/lib/intake');

const {
  INTAKE_SCHEMA,
  validarIntake,
  evaluarIntake,
  LISTO_PARA_PLANIFICAR,
  NECESITA_CLARIFICACION,
  DIVIDIR_EN_SPECS,
  ERROR_INTAKE,
} = intake;

function respuesta(extra) {
  return Object.assign({
    reformulacion: 'Anadir login con email y contrasena, con bloqueo tras 5 intentos fallidos.',
    asunciones: ['El proyecto no tiene autenticacion previa'],
    contradicciones: [],
    particion_propuesta: [],
    veredicto: LISTO_PARA_PLANIFICAR,
    preguntas: [],
    alternativa: '',
  }, extra || {});
}

// ── Esquema ───────────────────────────────────────────────────────────────────

test('esquema: una respuesta con todos los campos obligatorios es valida', () => {
  const { valido, errores } = validarIntake(respuesta());
  assert.strictEqual(valido, true);
  assert.deepStrictEqual(errores, []);
});

test('esquema: una respuesta sin veredicto no es valida', () => {
  const sinVeredicto = respuesta();
  delete sinVeredicto.veredicto;

  const { valido, errores } = validarIntake(sinVeredicto);
  assert.strictEqual(valido, false);
  assert.ok(errores.some(e => e.includes('veredicto')), 'el error debe nombrar el campo que falta');
});

test('esquema: los tres veredictos del enum coinciden con los que el workflow ramifica', () => {
  assert.deepStrictEqual(
    INTAKE_SCHEMA.properties.veredicto.enum,
    [LISTO_PARA_PLANIFICAR, NECESITA_CLARIFICACION, DIVIDIR_EN_SPECS]
  );
});

test('esquema: una lista que llega como texto no es valida', () => {
  const { valido, errores } = validarIntake(respuesta({ preguntas: 'que stack?' }));
  assert.strictEqual(valido, false);
  assert.ok(errores.some(e => e.includes('preguntas')));
});

// ── Ramificacion por veredicto ────────────────────────────────────────────────

test('LISTO_PARA_PLANIFICAR: la planificacion continua a la fase Spec', () => {
  const decision = evaluarIntake(respuesta());
  assert.strictEqual(decision.continuar, true);
  assert.strictEqual(decision.resultado, null);
});

test('NECESITA_CLARIFICACION: se detiene y devuelve las preguntas sin crear spec', () => {
  const decision = evaluarIntake(respuesta({
    veredicto: NECESITA_CLARIFICACION,
    preguntas: ['Para quien es la app?', 'Que stack?', 'Que funcionalidades minimas?'],
  }));

  assert.strictEqual(decision.continuar, false);
  assert.strictEqual(decision.resultado.veredicto, NECESITA_CLARIFICACION);
  assert.strictEqual(decision.resultado.spec, null);
  assert.strictEqual(decision.resultado.intake.preguntas.length, 3);
  assert.strictEqual(decision.resultado.requires_approval, false);
});

test('NECESITA_CLARIFICACION sin preguntas: error explicito, no continuacion', () => {
  const decision = evaluarIntake(respuesta({ veredicto: NECESITA_CLARIFICACION, preguntas: [] }));

  assert.strictEqual(decision.continuar, false);
  assert.strictEqual(decision.resultado.veredicto, ERROR_INTAKE);
});

test('DIVIDIR_EN_SPECS: se detiene y devuelve la particion con sus dependencias', () => {
  const decision = evaluarIntake(respuesta({
    veredicto: DIVIDIR_EN_SPECS,
    particion_propuesta: [
      { titulo: 'Modelo de datos', alcance: 'Esquema y migraciones', depende_de: [] },
      { titulo: 'API REST', alcance: 'Endpoints CRUD', depende_de: ['Modelo de datos'] },
      { titulo: 'Autenticacion', alcance: 'Login y sesiones', depende_de: ['Modelo de datos'] },
    ],
  }));

  assert.strictEqual(decision.continuar, false);
  assert.strictEqual(decision.resultado.veredicto, DIVIDIR_EN_SPECS);
  assert.strictEqual(decision.resultado.spec, null);
  assert.strictEqual(decision.resultado.intake.particion_propuesta.length, 3);
  assert.deepStrictEqual(decision.resultado.intake.particion_propuesta[1].depende_de, ['Modelo de datos']);
});

test('DIVIDIR_EN_SPECS con una sola spec: error explicito, no continuacion', () => {
  const decision = evaluarIntake(respuesta({
    veredicto: DIVIDIR_EN_SPECS,
    particion_propuesta: [{ titulo: 'Todo el backend', alcance: 'Todo' }],
  }));

  assert.strictEqual(decision.continuar, false);
  assert.strictEqual(decision.resultado.veredicto, ERROR_INTAKE);
});

test('veredicto desconocido: error explicito, la planificacion no continua', () => {
  const decision = evaluarIntake(respuesta({ veredicto: 'OTRO' }));

  assert.strictEqual(decision.continuar, false);
  assert.strictEqual(decision.resultado.veredicto, ERROR_INTAKE);
  assert.ok(decision.resultado.instrucciones.includes('OTRO'), 'las instrucciones deben citar el veredicto recibido');
});

test('respuesta ausente o no objeto: error explicito, la planificacion no continua', () => {
  for (const basura of [null, undefined, 'LISTO_PARA_PLANIFICAR', []]) {
    const decision = evaluarIntake(basura);
    assert.strictEqual(decision.continuar, false);
    assert.strictEqual(decision.resultado.veredicto, ERROR_INTAKE);
  }
});

// ── Contradicciones ───────────────────────────────────────────────────────────

test('una contradiccion con ai_docs/core/ no detiene la planificacion: manda la solicitud', () => {
  const decision = evaluarIntake(respuesta({
    contradicciones: ['El roadmap indica Vue; la solicitud pide React. Gana la solicitud.'],
  }));

  assert.strictEqual(decision.continuar, true);
});

// ── Carga de los modulos del workflow ────────────────────────────────────────
// El modulo de intake es lo primero que carga la planificacion, y se cargaba por una ruta
// resuelta contra el directorio en curso del proceso. Con la sesion arrancada en un
// subdirectorio ese directorio no es la raiz del proyecto: el import fallaba y la planificacion
// moria antes del intake. La misma resolucion sirve para auditoria.js y orquestacion.js, cuya
// carga si esta dentro de un try/catch: alli el fallo no aborta, degrada — se salta la
// verificacion mecanica de contratos y un plan con un consumidor sin productor llega a la
// auditoria sin el hallazgo que lo delata.
//
// COMO SE ACREDITA
// Los helpers de resolucion viven inline en el workflow (son justamente lo que permite cargar el
// primer modulo, asi que no pueden importarse de uno). Se extraen del texto REAL del archivo y se
// evaluan: lo que se ejercita es el codigo que corre, no una copia. Cada test lleva su control:
// la resolucion vieja, contra el directorio en curso, se comprueba explicitamente que NO encuentra
// el modulo en el mismo fixture donde la nueva si lo encuentra.

const fs = require('fs');
const os = require('os');
const path = require('path');
const orq = require('../.claude/workflows/lib/orquestacion');

const WORKFLOW = fs.readFileSync(
  path.resolve(__dirname, '..', '.claude', 'workflows', 'planificar.js'), 'utf8');

const RUTA_INTAKE = path.join('.claude', 'workflows', 'lib', 'intake.js');

/** Los helpers de resolucion, extraidos del texto del workflow y evaluados. */
function resolucionDelWorkflow() {
  const desde = WORKFLOW.indexOf('const MAX_ASCENSO');
  const hasta = WORKFLOW.indexOf('// ── Phase 1');
  assert.ok(desde > 0 && hasta > desde, 'el bloque de resolucion debe seguir en planificar.js');
  return new Function('return (async () => {' + WORKFLOW.slice(desde, hasta)
    + '\nreturn { MAX_ASCENSO, rutaNativa, resolverEnProyecto }\n})()')();
}

/** Proyecto de mentira con el modulo de intake en su sitio y un subdirectorio hondo. */
function proyectoConIntake(profundidad) {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-planificar-')));
  const modulo = path.join(raiz, RUTA_INTAKE);
  fs.mkdirSync(path.dirname(modulo), { recursive: true });
  fs.writeFileSync(modulo, 'export default {}\n');

  const tramos = [];
  for (let i = 0; i < profundidad; i++) tramos.push('n' + i);
  const hondo = tramos.length ? path.join(raiz, ...tramos) : raiz;
  fs.mkdirSync(hondo, { recursive: true });
  return { raiz, modulo, hondo };
}

/** Ejecuta fn con el directorio en curso puesto en dir, y lo restaura pase lo que pase. */
async function desde(dir, fn) {
  const previo = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previo);
  }
}

test('control positivo: con la sesion arrancada en un subdirectorio, el modulo se encuentra igual', async () => {
  const { resolverEnProyecto } = await resolucionDelWorkflow();
  const p = proyectoConIntake(3);

  await desde(p.hondo, async () => {
    // Control: la resolucion vieja (contra el directorio en curso) no da con el modulo. Sin el,
    // este test pasaria tambien con el defecto puesto.
    assert.strictEqual(fs.existsSync(path.resolve(RUTA_INTAKE)), false,
      'control: resolver contra el directorio en curso no encuentra el modulo');

    assert.strictEqual(await resolverEnProyecto(RUTA_INTAKE), p.modulo);
    assert.strictEqual(fs.existsSync(await resolverEnProyecto(RUTA_INTAKE)), true);
  });
});

test('cero cambio en el camino feliz: desde la raiz del proyecto resuelve lo mismo que antes', async () => {
  const { resolverEnProyecto } = await resolucionDelWorkflow();
  const p = proyectoConIntake(0);

  await desde(p.raiz, async () => {
    // "Lo mismo que antes" es literalmente la resolucion vieja: path.resolve contra el cwd.
    assert.strictEqual(await resolverEnProyecto(RUTA_INTAKE), path.resolve(RUTA_INTAKE));
    assert.strictEqual(await resolverEnProyecto(RUTA_INTAKE), p.modulo);
  });
});

test('una ruta absoluta se devuelve tal cual: no se asciende buscando nada', async () => {
  const { resolverEnProyecto } = await resolucionDelWorkflow();
  const p = proyectoConIntake(2);

  await desde(p.hondo, async () => {
    assert.strictEqual(await resolverEnProyecto(p.modulo), p.modulo);
  });
});

test('un modulo que no existe en ningun nivel: la ruta de siempre, para que el error nombre el sitio esperado', async () => {
  const { resolverEnProyecto } = await resolucionDelWorkflow();
  const p = proyectoConIntake(2);
  const fantasma = path.join('.claude', 'workflows', 'lib', 'no_existe.js');

  await desde(p.hondo, async () => {
    // El ascenso termina (no cuelga) y el fallback es la resolucion contra el directorio en curso.
    assert.strictEqual(await resolverEnProyecto(fantasma), path.resolve(fantasma));
  });
});

test('el ascenso esta acotado: por encima de MAX_ASCENSO niveles ya no se busca', async () => {
  const { MAX_ASCENSO, resolverEnProyecto } = await resolucionDelWorkflow();
  assert.strictEqual(typeof MAX_ASCENSO, 'number');

  const cerca = proyectoConIntake(MAX_ASCENSO - 1);
  await desde(cerca.hondo, async () => {
    assert.strictEqual(await resolverEnProyecto(RUTA_INTAKE), cerca.modulo, 'dentro del limite si se encuentra');
  });

  const lejos = proyectoConIntake(MAX_ASCENSO + 2);
  await desde(lejos.hondo, async () => {
    const r = await resolverEnProyecto(RUTA_INTAKE);
    assert.strictEqual(r, path.resolve(RUTA_INTAKE), 'fuera del limite se devuelve el fallback');
    assert.strictEqual(fs.existsSync(r), false);
  });
});

// Las dos plataformas se ejercitan desde una sola: rutaNativa acepta path.win32 / path.posix.
// Este repositorio se usa en Windows y en sistemas tipo Unix indistintamente.
const NATIVAS_POSIX = ['.claude/workflows/lib/intake.js', './lib/intake.js', 'intake.js', '/abs/lib/intake.js'];
const NATIVAS_WIN32 = ['.claude\\workflows\\lib\\intake.js', '.\\lib\\intake.js', 'C:\\proyecto\\intake.js', 'intake.js'];
const CRUZADAS = ['.claude\\workflows\\lib\\intake.js', 'C:\\proyecto\\lib\\intake.js', '.\\lib\\intake.js'];

test('canary: la traduccion de separadores del workflow coincide con la de la orquestacion', async () => {
  // El criterio esta replicado (el workflow no puede importar el modulo que aun no ha resuelto),
  // asi que la igualdad se exige aqui: si una copia cambia sin la otra, este test lo denuncia.
  const { rutaNativa } = await resolucionDelWorkflow();
  const bateria = NATIVAS_POSIX.concat(NATIVAS_WIN32, CRUZADAS, ['', 'lib/no\\separador.js']);

  for (const api of [path.posix, path.win32]) {
    for (const raw of bateria) {
      assert.strictEqual(rutaNativa(raw, api), orq.rutaNativa(raw, api), api.sep + ': ' + raw);
    }
  }
  assert.strictEqual(rutaNativa(null, path.posix), orq.rutaNativa(null, path.posix));
  assert.strictEqual(rutaNativa(undefined, path.posix), orq.rutaNativa(undefined, path.posix));
});

test('cero cambio de comportamiento: sobre rutas nativas, traducir no altera el resolve', async () => {
  const { rutaNativa } = await resolucionDelWorkflow();

  for (const raw of NATIVAS_POSIX) {
    assert.strictEqual(
      path.posix.resolve('/proyecto', rutaNativa(raw, path.posix)),
      path.posix.resolve('/proyecto', raw),
      'posix: ' + raw,
    );
  }
  for (const raw of NATIVAS_WIN32.concat(CRUZADAS)) {
    assert.strictEqual(
      path.win32.resolve('C:\\proyecto', rutaNativa(raw, path.win32)),
      path.win32.resolve('C:\\proyecto', raw),
      'win32: ' + raw,
    );
  }
});

test('control positivo: sin traducir, la ruta de Windows se resuelve como un solo tramo en Unix', async () => {
  const { rutaNativa } = await resolucionDelWorkflow();

  const vieja = path.posix.resolve('/proyecto', '.claude\\workflows\\lib\\intake.js');
  assert.strictEqual(vieja, '/proyecto/.claude\\workflows\\lib\\intake.js');
  assert.strictEqual(vieja.split('/').length, 3, 'los cuatro tramos quedan colapsados en uno');

  const nueva = path.posix.resolve('/proyecto', rutaNativa('.claude\\workflows\\lib\\intake.js', path.posix));
  assert.strictEqual(nueva, '/proyecto/.claude/workflows/lib/intake.js');
  assert.strictEqual(nueva.split('/').length, 6);
});

test('planificar.js: ningun modulo se resuelve contra el directorio en curso del proceso', () => {
  assert.match(WORKFLOW, /function resolverEnProyecto/);
  assert.match(WORKFLOW, /rutaNativa\(rutaRelativa, path\)/, 'la ruta debe traducirse antes de resolverla');
  assert.doesNotMatch(WORKFLOW, /pathToFileURL\(path\.resolve\(rutaRelativa\)\)/, 'resolucion contra el cwd');

  // El intake se cargaba por su cuenta, saltandose el helper: mismo defecto por otra puerta.
  assert.match(WORKFLOW, /cargarModulo\('\.claude\/workflows\/lib\/intake\.js'\)/);
  assert.doesNotMatch(WORKFLOW, /intakePath\.resolve\(/, 'el intake volveria a resolverse contra el cwd');
});

test('planificar.js: nada aguas abajo de la carga ejecuta comandos ni descarta trabajo', () => {
  // Arreglar la carga hace que el flujo llegue mas lejos. Lo que hay mas alla no puede asumir el
  // directorio en curso ni destruir nada: la planificacion no corre procesos externos, no escribe
  // en disco por su cuenta y no toca el working tree. Los unicos path.resolve del archivo son los
  // del propio ascenso.
  for (const prohibido of [/child_process/, /spawnSync/, /execSync/, /reset', '--hard/, /clean', '-fd/]) {
    assert.doesNotMatch(WORKFLOW, prohibido);
  }
  const resoluciones = WORKFLOW.match(/path\.resolve\(/g) || [];
  assert.strictEqual(resoluciones.length, 2, 'solo el candidato del ascenso y su fallback');

  // La unica funcion de la orquestacion que usa la planificacion es pura: no busca nada en disco,
  // asi que no necesita un ancla de proyecto (a diferencia de la implementacion de una spec).
  assert.match(WORKFLOW, /verificarContratos\(taskList\)/);
  assert.strictEqual(orq.verificarContratos([
    { path: 'a', contratos: [{ tipo: 'produce', nombre: 'Api' }] },
    { path: 'b', dependencias: ['a'], contratos: [{ tipo: 'consume', nombre: 'Api' }] },
  ]).length, 0, 'sin tocar disco y sin raiz: el contrato bien declarado no da problema');
});

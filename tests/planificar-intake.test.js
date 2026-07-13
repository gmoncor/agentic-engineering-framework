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

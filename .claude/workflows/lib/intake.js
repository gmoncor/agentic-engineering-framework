'use strict';

// Contrato de la fase de intake del workflow de planificacion.
//
// Un solo lugar define el esquema de la respuesta del asesor, los veredictos
// posibles y la decision de continuar o detener el pipeline. El workflow
// planificar.js lo importa para ramificar tras el intake; los tests lo importan
// para verificar esa misma ramificacion sin llamar al modelo.
//
// Regla dura: un veredicto que no se reconoce NO deja pasar la planificacion.
// Adivinar la intencion del asesor equivale a planificar a ciegas.

const LISTO_PARA_PLANIFICAR = 'LISTO_PARA_PLANIFICAR';
const NECESITA_CLARIFICACION = 'NECESITA_CLARIFICACION';
const DIVIDIR_EN_SPECS = 'DIVIDIR_EN_SPECS';
const ERROR_INTAKE = 'ERROR_INTAKE';

const VEREDICTOS = [LISTO_PARA_PLANIFICAR, NECESITA_CLARIFICACION, DIVIDIR_EN_SPECS];

const INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    reformulacion: { type: 'string' },
    asunciones: { type: 'array', items: { type: 'string' } },
    contradicciones: { type: 'array', items: { type: 'string' } },
    particion_propuesta: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          alcance: { type: 'string' },
          depende_de: { type: 'array', items: { type: 'string' } },
        },
        required: ['titulo', 'alcance'],
      },
    },
    veredicto: { type: 'string', enum: VEREDICTOS },
    preguntas: { type: 'array', items: { type: 'string' } },
    alternativa: { type: 'string' },
  },
  required: ['reformulacion', 'asunciones', 'contradicciones', 'veredicto'],
};

const CAMPOS_LISTA = ['asunciones', 'contradicciones', 'particion_propuesta', 'preguntas'];

// Valida forma, no semantica: campos obligatorios presentes y listas que son
// listas. El veredicto se comprueba aparte, en evaluarIntake, para que un valor
// desconocido produzca un error nombrado en vez de un fallo de esquema opaco.
function validarIntake(intake) {
  const errores = [];
  if (!intake || typeof intake !== 'object' || Array.isArray(intake)) {
    return { valido: false, errores: ['la respuesta de intake no es un objeto'] };
  }
  for (const campo of INTAKE_SCHEMA.required) {
    if (intake[campo] === undefined || intake[campo] === null) errores.push('falta el campo obligatorio "' + campo + '"');
  }
  if (intake.reformulacion !== undefined && typeof intake.reformulacion !== 'string') {
    errores.push('"reformulacion" debe ser texto');
  }
  for (const campo of CAMPOS_LISTA) {
    if (intake[campo] !== undefined && !Array.isArray(intake[campo])) errores.push('"' + campo + '" debe ser una lista');
  }
  return { valido: errores.length === 0, errores };
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

// Resultado parcial del workflow: la planificacion se detiene y no existe spec.
function detener(intake, veredicto, instrucciones) {
  return {
    continuar: false,
    resultado: {
      intake: intake,
      spec: null,
      estado_spec: null,
      requires_approval: false,
      instrucciones: instrucciones,
      tasks: [],
      reviews: [],
      audit: null,
      veredicto: veredicto,
    },
  };
}

// Decide si la planificacion sigue a la fase Spec o se detiene devolviendo al
// usuario lo que le falta (preguntas o particion). Nunca continua a ciegas.
function evaluarIntake(intake) {
  const { valido, errores } = validarIntake(intake);
  if (!valido) {
    return detener(intake, ERROR_INTAKE, 'El intake no devolvio una respuesta utilizable (' + errores.join('; ')
      + '). No se ha creado ninguna spec. Relanza la planificacion.');
  }

  switch (intake.veredicto) {
    case LISTO_PARA_PLANIFICAR:
      return { continuar: true, resultado: null };

    case NECESITA_CLARIFICACION: {
      const preguntas = lista(intake.preguntas);
      if (preguntas.length === 0) {
        return detener(intake, ERROR_INTAKE, 'El intake pide clarificacion pero no formulo ninguna pregunta. '
          + 'No se ha creado ninguna spec. Relanza la planificacion.');
      }
      return detener(intake, NECESITA_CLARIFICACION, 'La solicitud tiene huecos criticos. Traslada estas preguntas al usuario '
        + 'y relanza la planificacion con las respuestas incorporadas. No se ha creado ninguna spec.');
    }

    case DIVIDIR_EN_SPECS: {
      const particion = lista(intake.particion_propuesta);
      if (particion.length < 2) {
        return detener(intake, ERROR_INTAKE, 'El intake propone dividir pero no aporta al menos dos specs. '
          + 'No se ha creado ninguna spec. Relanza la planificacion.');
      }
      return detener(intake, DIVIDIR_EN_SPECS, 'La solicitud abarca varias specs independientes. Presenta la particion propuesta '
        + 'con sus dependencias y deja que el usuario decida: lanza una planificacion por cada spec, '
        + 'respetando el orden de dependencias. No se ha creado ninguna spec.');
    }

    default:
      return detener(intake, ERROR_INTAKE, 'Veredicto de intake no reconocido: "' + String(intake.veredicto)
        + '". Veredictos validos: ' + VEREDICTOS.join(', ') + '. No se ha creado ninguna spec.');
  }
}

module.exports = {
  INTAKE_SCHEMA,
  VEREDICTOS,
  LISTO_PARA_PLANIFICAR,
  NECESITA_CLARIFICACION,
  DIVIDIR_EN_SPECS,
  ERROR_INTAKE,
  validarIntake,
  evaluarIntake,
};

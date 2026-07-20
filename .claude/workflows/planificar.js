export const meta = {
  name: 'planificar',
  description: 'Planificacion exhaustiva SDD: spec + tasks + revision paralela + auditoria cruzada',
  phases: [
    { title: 'Intake', detail: 'Analizar la solicitud, detectar huecos, proponer particion en specs' },
    { title: 'Spec', detail: 'Crear especificacion desde la solicitud' },
    { title: 'Tasks', detail: 'Derivar tasks granulares de la spec' },
    { title: 'Revision', detail: 'Revision paralela esceptica de cada task' },
    { title: 'Auditoria', detail: 'Auditoria cruzada de coherencia spec-tasks' },
    { title: 'Aprobacion', detail: 'El usuario revisa el plan y aprueba la spec (BORRADOR -> APROBADA)' },
  ],
}

// Como mucho una segunda pasada de revision/auditoria tras un veredicto adverso.
// El presupuesto de pasadas es esta constante y nada mas: no hay motor de
// convergencia. Con 1 no habria segunda pasada; con 2, una sola.
const MAX_REVISION_PASSES = 2

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    spec_path: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          titulo: { type: 'string' },
          independiente: { type: 'boolean' },
          dependencias: { type: 'array', items: { type: 'string' } },
          // Lo que una task produce (API, tipo, export) y otra consume. Permite
          // detectar en la auditoria un consumidor sin productor: un error de plan.
          contratos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tipo: { type: 'string', enum: ['produce', 'consume'] },
                nombre: { type: 'string' },
                archivo: { type: 'string' }
              },
              required: ['tipo', 'nombre']
            }
          }
        },
        required: ['path', 'titulo', 'independiente']
      }
    }
  },
  required: ['spec_path', 'tasks']
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    task_path: { type: 'string' },
    task_titulo: { type: 'string' },
    veredicto: { type: 'string', enum: ['LISTO_PARA_IMPLEMENTAR', 'NECESITA_AJUSTES', 'NECESITA_REPLANTEAMIENTO'] },
    coherencia_spec: { type: 'string' },
    alcance: { type: 'string' },
    dependencias: { type: 'string' },
    edge_cases: { type: 'string' },
    riesgos: { type: 'string' },
    problemas: { type: 'array', items: { type: 'string' } },
    ajustes_propuestos: { type: 'array', items: { type: 'string' } }
  },
  required: ['task_path', 'task_titulo', 'veredicto', 'problemas', 'ajustes_propuestos']
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    veredicto: { type: 'string', enum: ['APROBADO', 'NECESITA_AJUSTES', 'NECESITA_REPLANTEAMIENTO'] },
    cobertura: {
      type: 'object',
      properties: {
        cubiertos: { type: 'number' },
        total: { type: 'number' },
        sin_cobertura: { type: 'array', items: { type: 'string' } }
      },
      required: ['cubiertos', 'total', 'sin_cobertura']
    },
    overlaps: { type: 'array', items: { type: 'string' } },
    huecos: { type: 'array', items: { type: 'string' } },
    incoherencias: { type: 'array', items: { type: 'string' } },
    dependencias_problematicas: { type: 'array', items: { type: 'string' } },
    resumen: { type: 'string' }
  },
  required: ['veredicto', 'cobertura', 'overlaps', 'huecos', 'incoherencias', 'dependencias_problematicas', 'resumen']
}

// Carga un modulo del repo por ruta relativa a la raiz del proyecto: el workflow
// se evalua sin una URL de modulo propia, asi que un import relativo no resolveria.
async function cargarModulo(rutaRelativa) {
  const path = await import('node:path')
  const url = await import('node:url')
  const mod = await import(url.pathToFileURL(path.resolve(rutaRelativa)).href)
  return mod.default || mod
}

// ── Phase 1: Intake ────────────────────────────────────────────────────────────
// NOTA DE DISENO: spec.md dice "PREGUNTA antes de asumir", pero dentro del
// workflow las preguntas bloquean el pipeline. La clarificacion no se suprime:
// se concentra aqui. El asesor examina la solicitud UNA vez, antes de que nadie
// escriba nada, y decide si hay material para planificar. Si falta lo critico o
// la solicitud abarca varias specs, el workflow para y devuelve el turno al
// usuario. A partir de aqui los agentes ya no preguntan: trabajan con lo que el
// intake dejo cerrado. El segundo punto de espera es la aprobacion final.
const intakeUrl = await import('node:url')
const intakePath = await import('node:path')
const intakeMod = await import(intakeUrl.pathToFileURL(intakePath.resolve('.claude/workflows/lib/intake.js')).href)
const { INTAKE_SCHEMA, evaluarIntake } = intakeMod.default || intakeMod

phase('Intake')
const intakeResult = await agent(`
Eres el asesor del proyecto. Analiza la solicitud del usuario ANTES de que se escriba ninguna spec.
Lee ai_docs/core/ para contexto del proyecto. Si no existe o esta vacio, dilo: planificar sin vision
ni roadmap es planificar a ciegas, y el usuario deberia rellenar ai_docs/core_templates/ primero.

REGLAS:
1. Reformula la solicitud en 1-3 frases. Copia LITERALMENTE cifras, nombres propios, entidades y
   criterios de aceptacion tal y como los escribio el usuario. Parafrasearlos los pierde.
2. Separa lo que el usuario DIJO de lo que tu ASUMISTE. Cada asuncion, en "asunciones", explicita.
   No des por confirmado nada que el usuario no haya escrito.
3. Si la solicitud contradice ai_docs/core/, gana la solicitud del usuario. Anota la contradiccion
   en "contradicciones" para que el usuario la vea. No la resuelvas en silencio.
4. Si la solicitud contiene 2 o mas funcionalidades independientes (no comparten archivos ni logica),
   proponlas como specs separadas en "particion_propuesta", cada una con su alcance y sus
   dependencias, y usa el veredicto DIVIDIR_EN_SPECS. Una spec monolitica no se puede revisar.
5. Si falta un dato critico (que problema resuelve, quien lo usa, que cuenta como exito), usa el
   veredicto NECESITA_CLARIFICACION y escribe las preguntas concretas que lo cierran.
6. Si la solicitud es clara, acotada y autocontenida, usa el veredicto LISTO_PARA_PLANIFICAR.
7. Si existe un enfoque mas robusto que ataque la causa raiz del problema, describelo en
   "alternativa". Recomienda; la decision es del usuario.

Solicitud del usuario: ${args}
`, { label: 'intake', phase: 'Intake', schema: INTAKE_SCHEMA })

const decision = evaluarIntake(intakeResult)
if (!decision.continuar) {
  log('Intake: ' + decision.resultado.veredicto + ' — la planificacion se detiene sin crear spec')
  return decision.resultado
}
log('Intake: LISTO_PARA_PLANIFICAR')

const contextoIntake = [
  'Reformulacion del asesor: ' + intakeResult.reformulacion,
  'Asunciones (NO son afirmaciones del usuario, son hipotesis a validar): '
    + (intakeResult.asunciones.length ? intakeResult.asunciones.join(' | ') : 'ninguna'),
  'Contradicciones con ai_docs/core/ (gana la solicitud del usuario): '
    + (intakeResult.contradicciones.length ? intakeResult.contradicciones.join(' | ') : 'ninguna'),
  intakeResult.alternativa ? 'Alternativa propuesta por el asesor: ' + intakeResult.alternativa : '',
].filter(Boolean).join('\n')

// ── Phase 2: Spec ──────────────────────────────────────────────────────────────
phase('Spec')
const specResult = await agent(`
Lee ai_docs/dev_templates/spec.md y sigue su proceso completo para crear una especificacion.
Lee ai_docs/core/ para contexto del proyecto.

IMPORTANTE:
- NO hagas preguntas de clarificacion. El intake ya cerro los huecos criticos.
- La solicitud literal del usuario MANDA. Si el analisis del intake o los documentos de
  ai_docs/core/ la contradicen, gana la solicitud: dejalo escrito en la spec.
- Copia verbatim las cifras, entidades y criterios de aceptacion que escribio el usuario.
- No escribas que el usuario confirmo, acepto o eligio algo si no consta en su solicitud.
  Lo que venga de "Asunciones" se declara como asuncion, no como decision del usuario.
- Clasifica el alcance, redacta la spec completa con todos los campos del formato.
- Guarda la spec con Estado: BORRADOR. NUNCA escribas APROBADA: la aprobacion
  es del usuario y ocurre despues de que revise el plan completo.
- Cada criterio de aceptacion debe ser medible. La seccion "No incluye" es obligatoria.

Solicitud del usuario (fuente de verdad): ${args}

Analisis previo del intake (contexto, subordinado a la solicitud):
${contextoIntake}

Guarda la spec en ai_docs/tasks/spec_<descriptor>.md (snake_case, sin acentos).
Retorna SOLO el path del archivo creado (ej: ai_docs/tasks/spec_autenticacion.md).
`, { label: 'crear-spec', phase: 'Spec' })

const specPath = (typeof specResult === 'string' ? specResult : '').trim()
if (!specPath || specPath.length < 5) {
  return { spec: specPath, tasks: [], reviews: [], audit: null, veredicto: 'ERROR_SPEC', reason: 'El agente no retorno un path valido para la spec' }
}
log('Spec creada: ' + specPath)

// ── Phase 3: Tasks ─────────────────────────────────────────────────────────────
phase('Tasks')
const tasksResult = await agent(`
Lee ai_docs/dev_templates/tareas.md y sigue su proceso completo.
Lee la spec (en BORRADOR, pendiente de aprobacion del usuario) en: ${specPath}
Lee ai_docs/core/ para contexto del proyecto.

IMPORTANTE:
- NO hagas preguntas ni esperes aprobacion. Trabaja con lo que hay.
- Identifica modulos independientes, documenta dependencias y define orden de ejecucion.
- Cada task debe ser independiente y atomica. Si toca mas de 6 archivos, dividir.
- Minimo 3 edge cases por task con logica de negocio.
- Crea cada task como archivo en ai_docs/tasks/NNN_descriptor.md.
- Verifica numeracion existente para no pisar archivos.
- Declara los contratos entre tasks: lo que una task PRODUCE (API, tipo, export) y
  otra CONSUME. Por contrato: tipo (produce|consume), nombre, archivo. El consumidor
  debe depender del productor.

Retorna un JSON con spec_path y la lista de tasks creadas (path, titulo, independiente,
dependencias y contratos que produce o consume).
`, { label: 'derivar-tasks', phase: 'Tasks', schema: TASKS_SCHEMA })

const taskList = (tasksResult && tasksResult.tasks) ? tasksResult.tasks : []
log(taskList.length + ' tasks derivadas')

if (taskList.length === 0) {
  return { spec: specPath, tasks: [], reviews: [], audit: null, veredicto: 'SIN_TASKS' }
}

// Reglas puras de la auditoria (adverso, hace falta otra pasada, hallazgo mas
// severo, contratos rotos). Viven en un modulo aparte para poder probarse sin el
// runtime de workflows, como el intake.
const aud = await cargarModulo('.claude/workflows/lib/auditoria.js')

// Un contrato producer/consumer roto (un consumidor sin productor, o que no depende
// de el) es un error de plan que debe detectarse ANTES de tocar codigo. Se detecta
// mecanicamente sobre las tasks y aflora en la auditoria. Degradacion segura: si el
// modulo no esta disponible, se continua sin esta comprobacion.
let contratosRotos = []
try {
  const orq = await cargarModulo('.claude/workflows/lib/orquestacion.js')
  contratosRotos = orq.verificarContratos(taskList) || []
  for (const roto of contratosRotos) log('Contrato roto detectado: ' + roto)
} catch (e) {
  log('No se pudieron verificar los contratos entre tasks (' + e.message + '); se continua sin esa comprobacion')
}

const taskPaths = taskList.map(function(t) { return t.path }).join(', ')

// ── Fases 4-5: una pasada = revision paralela + auditoria cruzada ──────────────
// El fan-out parallel() de la revision (Fase 4) se conserva intacto: es el
// paralelismo de auditoria por task. La pasada se ejecuta hasta dos veces (ver
// MAX_REVISION_PASSES); solo la primera marca las fases, la segunda solo registra.
async function pasadaRevisionAuditoria(numeroPasada) {
  if (numeroPasada === 1) phase('Revision')
  else log('Segunda pasada: re-revision paralela de las tasks corregidas')

  const reviews = await parallel(
    taskList.map((task, i) => () =>
      agent(`
Lee ai_docs/dev_templates/revisar_tarea.md y sigue TODOS sus pasos sin saltar ninguno.
Lee la task en: ${task.path}
Lee la spec madre en: ${specPath}
Lee ai_docs/core/ para contexto del proyecto.

POSTURA OBLIGATORIA:
- Tu trabajo es ENCONTRAR PROBLEMAS, no confirmar que todo esta bien.
- Asume que hay errores hasta demostrar lo contrario.
- Si la evidencia es ambigua, reporta el hallazgo como problema.
- NO modifiques nada. Solo analiza y reporta.
- NO hagas preguntas. Trabaja con lo que hay.

Ejecuta todas las verificaciones:
1. Coherencia con spec madre (objetivo, alcance, archivos, criterios)
2. Alcance minimo KISS (cambios innecesarios, refactors de paso)
3. Dependencias y pre-requisitos (otras tasks, librerias, datos, codigo)
4. Edge cases omitidos (inputs invalidos, concurrencia, estado inconsistente, permisos, limites)
5. DRY (logica duplicada, abstracciones prematuras)
6. Enfoque TDD (tests planificados para caso normal, limite y negativo)
7. Riesgos (que puede salir mal, reversibilidad, impacto en otros modulos)

Retorna tu veredicto estructurado con problemas y ajustes concretos.
`, {
        label: 'revisar-p' + numeroPasada + '-' + (i + 1) + '-' + task.titulo.substring(0, 22),
        phase: 'Revision',
        schema: REVIEW_SCHEMA
      })
    )
  )

  const validReviews = reviews.filter(Boolean)
  if (validReviews.length < taskList.length) {
    log('ADVERTENCIA: ' + (taskList.length - validReviews.length) + ' de ' + taskList.length + ' revisiones fallaron')
  }
  const listos = validReviews.filter(r => r.veredicto === 'LISTO_PARA_IMPLEMENTAR').length
  const ajustes = validReviews.filter(r => r.veredicto === 'NECESITA_AJUSTES').length
  const replantear = validReviews.filter(r => r.veredicto === 'NECESITA_REPLANTEAMIENTO').length
  log('Revision (pasada ' + numeroPasada + '): ' + listos + ' listos, ' + ajustes + ' con ajustes, ' + replantear + ' a replantear')

  if (numeroPasada === 1) phase('Auditoria')
  else log('Segunda pasada: re-auditoria cruzada')

  const reviewSummary = JSON.stringify(validReviews.map(function(r) {
    return {
      task: r.task_path,
      titulo: r.task_titulo,
      veredicto: r.veredicto,
      problemas: r.problemas,
      ajustes: r.ajustes_propuestos
    }
  }), null, 2)

  // Los contratos rotos detectados mecanicamente se pasan al auditor como hallazgos
  // ya confirmados, para que no los pase por alto.
  const contratosTexto = contratosRotos.length
    ? '\nHallazgos pre-detectados mecanicamente (contratos producer/consumer rotos; '
      + 'un consumidor sin productor es un error de plan, tratalos como confirmados):\n- '
      + contratosRotos.join('\n- ') + '\n'
    : ''

  const auditResult = await agent(`
Lee ai_docs/dev_templates/auditar_spec.md y sigue TODOS sus pasos sin saltar ninguno.
Lee la spec en: ${specPath}
Lee TODAS las tasks: ${taskPaths}
Lee ai_docs/core/ para contexto del proyecto.

Resultados de la revision individual de cada task (ya hecha por revisores independientes):
${reviewSummary}
${contratosTexto}
POSTURA OBLIGATORIA:
- Tu trabajo es ENCONTRAR PROBLEMAS, no confirmar que todo esta bien.
- Asume que hay huecos hasta demostrar lo contrario.
- Cada hallazgo con evidencia concreta (cita archivo y seccion).
- Integra los hallazgos de las revisiones individuales — no los ignores.
- NO modifiques nada. Solo audita y reporta.
- NO hagas preguntas. Trabaja con lo que hay.

Ejecuta todas las verificaciones:
1. COBERTURA: cada criterio de aceptacion de la spec tiene al menos una task
2. OVERLAPS: tasks que hacen lo mismo o tocan mismos archivos sin dependencia
3. HUECOS: features en "Incluye" sin task, restricciones sin verificacion, integraciones faltantes
4. COHERENCIA: tasks no contradicen spec ni entre si, estimaciones realistas
5. DEPENDENCIAS: circulares, faltantes, orden incorrecto, no declaradas
6. CONTRATOS: un consumidor de un contrato (API, tipo, export) sin task que lo produzca, o sin depender de ella

Si hay criterios de aceptacion sin cobertura, el veredicto es NECESITA_AJUSTES minimo.
Si hay contratos producer/consumer rotos, el veredicto es NECESITA_AJUSTES minimo.
Si hay problemas estructurales graves, el veredicto es NECESITA_REPLANTEAMIENTO.

Retorna tu veredicto estructurado.
`, { label: 'auditoria-cruzada-p' + numeroPasada, phase: 'Auditoria', schema: AUDIT_SCHEMA })

  // Un contrato roto no puede quedar aprobado aunque el auditor no lo reflejara:
  // se incorpora como incoherencia y fuerza un veredicto adverso.
  return { audit: aud.incorporarContratosRotos(auditResult, contratosRotos), reviews: validReviews }
}

// Corrige las tasks segun los hallazgos de la auditoria adversa, en el sitio, para
// que la segunda pasada revise el plan corregido (no el mismo que ya fallo).
async function corregirTasks(audit, numeroPasadaPrevia) {
  const hallazgos = []
    .concat(audit && audit.huecos || [])
    .concat(audit && audit.incoherencias || [])
    .concat(audit && audit.dependencias_problematicas || [])
    .concat(audit && audit.overlaps || [])
  await agent(`
La auditoria de planificacion (pasada ${numeroPasadaPrevia}) emitio un veredicto adverso
(${audit ? audit.veredicto : 'ERROR'}). Corrige los documentos de las tasks y, si hace falta, la
spec en BORRADOR para resolver estos hallazgos. Trabaja sobre los archivos de planificacion.

Spec madre: ${specPath}
Tasks: ${taskPaths}

Hallazgos a resolver:
- ${hallazgos.length ? hallazgos.join('\n- ') : (audit && audit.resumen) || 'ver el resumen de la auditoria'}

REGLAS:
- Corrige SOLO los documentos de planificacion (spec y tasks). NO implementes codigo.
- Manten la spec en BORRADOR. La aprobacion es del usuario.
- Si un contrato producer/consumer esta roto, ajusta las dependencias o anade la task productora.
- NO hagas preguntas. Trabaja con lo que hay.
`, { label: 'corregir-tasks-p' + numeroPasadaPrevia, phase: 'Auditoria' })
}

// Presupuesto de pasadas: MAX_REVISION_PASSES, una simple constante. Primera pasada
// siempre; si su veredicto es adverso y queda presupuesto, se corrigen las tasks y se
// hace UNA segunda pasada sobre el plan corregido. No hay tercera.
let pasadas = 1
let resultado = await pasadaRevisionAuditoria(pasadas)
let auditPrevia = null

if (aud.necesitaOtraPasada(resultado.audit ? resultado.audit.veredicto : 'ERROR', pasadas, MAX_REVISION_PASSES)) {
  await corregirTasks(resultado.audit, pasadas)
  auditPrevia = resultado.audit
  pasadas = 2
  resultado = await pasadaRevisionAuditoria(pasadas)
}

const auditFinal = resultado.audit
const validReviews = resultado.reviews
const veredicto = auditFinal ? auditFinal.veredicto : 'ERROR'
log('Auditoria final tras ' + pasadas + ' pasada' + (pasadas > 1 ? 's' : '') + ': ' + veredicto)

// Si tras la ultima pasada el veredicto sigue siendo adverso, se presenta el hallazgo
// mas severo entre las pasadas: una discrepancia entre pasadas no se esconde tras el
// veredicto mas benevolo.
const hallazgoMasSevero = aud.esVeredictoAdverso(veredicto)
  ? aud.auditoriaMasSevera(auditPrevia, auditFinal)
  : null

// ── Phase 6: Aprobacion humana ────────────────────────────────────────────────
// La spec esta en BORRADOR. El workflow NO la aprueba: presenta el plan y para.
// Aprobar es un acto del usuario, no un efecto colateral de la planificacion.
phase('Aprobacion')
const instrucciones = veredicto === 'APROBADO'
  ? 'Presenta al usuario la spec, las tasks y el resultado de la auditoria. '
    + 'La spec sigue en BORRADOR: pide al usuario que la revise y escriba "apruebo" '
    + 'para cambiar su estado a APROBADA. Solo entonces edita el estado en el archivo. '
    + 'Sin aprobacion explicita del usuario, no se implementa.'
  : 'Presenta al usuario los problemas encontrados por la auditoria (' + veredicto + ', tras '
    + pasadas + ' pasada' + (pasadas > 1 ? 's' : '') + ') y propon como resolverlos. '
    + (hallazgoMasSevero && hallazgoMasSevero.resumen
        ? 'Empieza por el hallazgo mas severo: ' + hallazgoMasSevero.resumen + ' '
        : '')
    + 'La spec permanece en BORRADOR hasta corregirlos y obtener aprobacion explicita del usuario.'
log(instrucciones)

return {
  spec: specPath,
  estado_spec: 'BORRADOR',
  requires_approval: true,
  instrucciones: instrucciones,
  tasks: taskList,
  reviews: validReviews,
  audit: auditFinal,
  veredicto: veredicto,
  pasadas: pasadas,
  hallazgo_mas_severo: hallazgoMasSevero
}

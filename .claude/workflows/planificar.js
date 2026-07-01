export const meta = {
  name: 'planificar',
  description: 'Planificacion exhaustiva SDD: spec + tasks + revision paralela + auditoria cruzada',
  phases: [
    { title: 'Spec', detail: 'Crear especificacion desde la solicitud' },
    { title: 'Tasks', detail: 'Derivar tasks granulares de la spec' },
    { title: 'Revision', detail: 'Revision paralela esceptica de cada task' },
    { title: 'Auditoria', detail: 'Auditoria cruzada de coherencia spec-tasks' },
  ],
}

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
          paralelizable: { type: 'boolean' },
          dependencias: { type: 'array', items: { type: 'string' } }
        },
        required: ['path', 'titulo', 'paralelizable']
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

// ── Phase 1: Spec ──────────────────────────────────────────────────────────────
// NOTA DE DISENO: spec.md dice "PREGUNTA antes de asumir" (modo interactivo).
// En workflow automatizado las preguntas bloquean el pipeline, asi que los
// agentes trabajan con la informacion disponible. El PUNTO DE ESPERA del
// usuario ocurre al final, cuando revisa el plan completo (fase Aprobacion).
phase('Spec')
const specResult = await agent(`
Lee ai_docs/dev_templates/spec.md y sigue su proceso completo para crear una especificacion.
Lee ai_docs/core/ para contexto del proyecto.

IMPORTANTE:
- NO hagas preguntas de clarificacion. Trabaja con la informacion disponible.
- Clasifica el alcance, redacta la spec completa con todos los campos del formato.
- Guarda la spec con Estado: APROBADA (la revision ocurre al final del workflow).
- Cada criterio de aceptacion debe ser medible. La seccion "No incluye" es obligatoria.

Solicitud del usuario: ${args}

Guarda la spec en ai_docs/tasks/spec_<descriptor>.md (snake_case, sin acentos).
Retorna SOLO el path del archivo creado (ej: ai_docs/tasks/spec_autenticacion.md).
`, { label: 'crear-spec', phase: 'Spec' })

const specPath = (typeof specResult === 'string' ? specResult : '').trim()
log('Spec creada: ' + specPath)

// ── Phase 2: Tasks ─────────────────────────────────────────────────────────────
phase('Tasks')
const tasksResult = await agent(`
Lee ai_docs/dev_templates/tareas.md y sigue su proceso completo.
Lee la spec aprobada en: ${specPath}
Lee ai_docs/core/ para contexto del proyecto.

IMPORTANTE:
- NO hagas preguntas ni esperes aprobacion. Trabaja con lo que hay.
- Identifica modulos independientes, marca paralelizacion, documenta dependencias.
- Cada task debe ser independiente y atomica. Si toca mas de 6 archivos, dividir.
- Minimo 3 edge cases por task con logica de negocio.
- Crea cada task como archivo en ai_docs/tasks/NNN_descriptor.md.
- Verifica numeracion existente para no pisar archivos.

Retorna un JSON con spec_path y la lista de tasks creadas (path, titulo, paralelizable, dependencias).
`, { label: 'derivar-tasks', phase: 'Tasks', schema: TASKS_SCHEMA })

const taskList = (tasksResult && tasksResult.tasks) ? tasksResult.tasks : []
log(taskList.length + ' tasks derivadas')

if (taskList.length === 0) {
  return { spec: specPath, tasks: [], reviews: [], audit: null, veredicto: 'SIN_TASKS' }
}

// ── Phase 3: Revision paralela ─────────────────────────────────────────────────
phase('Revision')
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
      label: 'revisar-' + (i + 1) + '-' + task.titulo.substring(0, 25),
      phase: 'Revision',
      schema: REVIEW_SCHEMA
    })
  )
)

const validReviews = reviews.filter(Boolean)
const listos = validReviews.filter(r => r.veredicto === 'LISTO_PARA_IMPLEMENTAR').length
const ajustes = validReviews.filter(r => r.veredicto === 'NECESITA_AJUSTES').length
const replantear = validReviews.filter(r => r.veredicto === 'NECESITA_REPLANTEAMIENTO').length
log('Revision: ' + listos + ' listos, ' + ajustes + ' con ajustes, ' + replantear + ' a replantear')

// ── Phase 4: Auditoria cruzada ─────────────────────────────────────────────────
phase('Auditoria')
const taskPaths = taskList.map(function(t) { return t.path }).join(', ')
const reviewSummary = JSON.stringify(validReviews.map(function(r) {
  return {
    task: r.task_path,
    titulo: r.task_titulo,
    veredicto: r.veredicto,
    problemas: r.problemas,
    ajustes: r.ajustes_propuestos
  }
}), null, 2)

const auditResult = await agent(`
Lee ai_docs/dev_templates/auditar_spec.md y sigue TODOS sus pasos sin saltar ninguno.
Lee la spec en: ${specPath}
Lee TODAS las tasks: ${taskPaths}
Lee ai_docs/core/ para contexto del proyecto.

Resultados de la revision individual de cada task (ya hecha por revisores independientes):
${reviewSummary}

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

Si hay criterios de aceptacion sin cobertura, el veredicto es NECESITA_AJUSTES minimo.
Si hay problemas estructurales graves, el veredicto es NECESITA_REPLANTEAMIENTO.

Retorna tu veredicto estructurado.
`, { label: 'auditoria-cruzada', phase: 'Auditoria', schema: AUDIT_SCHEMA })

const veredicto = auditResult ? auditResult.veredicto : 'ERROR'
log('Auditoria final: ' + veredicto)

return {
  spec: specPath,
  tasks: taskList,
  reviews: validReviews,
  audit: auditResult,
  veredicto: veredicto
}

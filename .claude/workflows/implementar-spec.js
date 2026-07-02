export const meta = {
  name: 'implementar-spec',
  description: 'Implementa todas las tasks de una spec en orden secuencial, con commit por task y revision adversarial final',
  phases: [
    { title: 'Descubrimiento', detail: 'Identificar tasks de la spec y determinar orden' },
    { title: 'Implementacion', detail: 'Implementar cada task secuencialmente' },
    { title: 'Revision', detail: 'Revision adversarial de toda la implementacion' },
  ],
}

const DISCOVER_SCHEMA = {
  type: 'object',
  properties: {
    spec_path: { type: 'string' },
    spec_titulo: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          titulo: { type: 'string' },
          orden: { type: 'number' },
          dependencias: { type: 'array', items: { type: 'string' } }
        },
        required: ['path', 'titulo', 'orden']
      }
    }
  },
  required: ['spec_path', 'spec_titulo', 'tasks']
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    task_path: { type: 'string' },
    task_titulo: { type: 'string' },
    resultado: { type: 'string', enum: ['COMPLETADA', 'FALLIDA', 'PARCIAL'] },
    archivos_modificados: { type: 'array', items: { type: 'string' } },
    tests_creados: { type: 'number' },
    tests_pasando: { type: 'number' },
    commit_message: { type: 'string' },
    hallazgos_fuera_alcance: { type: 'array', items: { type: 'string' } },
    notas: { type: 'string' }
  },
  required: ['task_path', 'task_titulo', 'resultado', 'archivos_modificados']
}

const REVISION_SCHEMA = {
  type: 'object',
  properties: {
    veredicto: { type: 'string', enum: ['APROBADA', 'NECESITA_CORRECCIONES', 'RECHAZADA'] },
    problemas_criticos: { type: 'array', items: { type: 'string' } },
    problemas_menores: { type: 'array', items: { type: 'string' } },
    positivos: { type: 'array', items: { type: 'string' } },
    resumen: { type: 'string' }
  },
  required: ['veredicto', 'problemas_criticos', 'problemas_menores', 'resumen']
}

// ── Phase 1: Descubrimiento ───────────────────────────────────────────────────
phase('Descubrimiento')
const specPath = (typeof args === 'string' ? args : '').trim()
if (!specPath || specPath.length < 5) {
  return { error: 'Se requiere el path de la spec como argumento (ej: ai_docs/tasks/spec_autenticacion.md)' }
}

const discovery = await agent(`
Encuentra todas las tasks asociadas a la spec: ${specPath}

Proceso:
1. Lee la spec para obtener su titulo y criterios de aceptacion
2. Busca en ai_docs/tasks/ todos los archivos .md (excluyendo spec_*.md) que referencien esta spec
3. Lee cada task encontrada para extraer: titulo, dependencias, orden de ejecucion
4. Ordena las tasks respetando dependencias (las que no tienen dependencias primero)

Si no encuentras tasks para esta spec, retorna un array vacio de tasks.

Retorna el path de la spec, su titulo, y la lista ordenada de tasks.
`, { label: 'descubrir-tasks', phase: 'Descubrimiento', schema: DISCOVER_SCHEMA })

const taskList = (discovery && discovery.tasks) ? discovery.tasks : []
if (taskList.length === 0) {
  return { spec: specPath, error: 'No se encontraron tasks para esta spec. Ejecuta /planificar primero.' }
}

log(taskList.length + ' tasks encontradas para: ' + (discovery.spec_titulo || specPath))

// ── Phase 2: Implementacion secuencial ────────────────────────────────────────
phase('Implementacion')
const results = []
let completadas = 0
let fallidas = 0

for (let i = 0; i < taskList.length; i++) {
  const task = taskList[i]
  log('Implementando task ' + (i + 1) + '/' + taskList.length + ': ' + task.titulo)

  const result = await agent(`
Lee ai_docs/dev_templates/implementar.md y sigue su proceso completo para implementar esta task.
Lee ai_docs/core/ para contexto del proyecto.

Task a implementar: ${task.path}
Spec madre: ${specPath}

CONTEXTO DEL WORKFLOW:
- Esta es la task ${i + 1} de ${taskList.length} en la implementacion de esta spec.
${i > 0 ? '- Las tasks anteriores ya fueron implementadas y commiteadas.' : '- Esta es la primera task.'}
${task.dependencias && task.dependencias.length > 0 ? '- Dependencias (ya completadas): ' + task.dependencias.join(', ') : '- Esta task es independiente.'}

PROCESO OBLIGATORIO:
1. Lee la task completa y verifica pre-requisitos
2. Investiga el codigo existente
3. Implementa los cambios descritos en la task
4. Escribe tests (RED-GREEN cuando aplique)
5. Ejecuta validaciones (linting, tests, build)
6. Haz commit con mensaje descriptivo siguiendo el formato: <tipo>: <descripcion>
   Tipos validos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore
   Subject maximo 72 caracteres

REGLAS:
- SOLO implementa lo que dice la task
- Hallazgos fuera de alcance se anotan, no se corrigen
- Si algo falla en validaciones, corregir antes de continuar
- NO hagas preguntas. Trabaja con la informacion disponible.

Retorna: path de la task, titulo, resultado (COMPLETADA/FALLIDA/PARCIAL), archivos modificados, tests creados/pasando, mensaje de commit, hallazgos fuera de alcance.
`, {
    label: 'impl-' + (i + 1) + '-' + task.titulo.substring(0, 25),
    phase: 'Implementacion',
    schema: IMPL_SCHEMA
  })

  if (result) {
    results.push(result)
    if (result.resultado === 'COMPLETADA') {
      completadas++
    } else {
      fallidas++
    }
    log('Task ' + (i + 1) + ': ' + (result.resultado || 'SIN_RESULTADO'))
  } else {
    results.push({ task_path: task.path, task_titulo: task.titulo, resultado: 'FALLIDA', archivos_modificados: [], notas: 'El agente no retorno resultado' })
    fallidas++
    log('Task ' + (i + 1) + ': FALLO (sin resultado del agente)')
  }
}

log('Implementacion: ' + completadas + ' completadas, ' + fallidas + ' fallidas de ' + taskList.length)

// ── Phase 3: Revision adversarial ─────────────────────────────────────────────
phase('Revision')
const implSummary = JSON.stringify(results.map(function(r) {
  return {
    task: r.task_path,
    titulo: r.task_titulo,
    resultado: r.resultado,
    archivos: r.archivos_modificados,
    tests: r.tests_creados || 0,
    commit: r.commit_message || ''
  }
}), null, 2)

const revision = await agent(`
Lee ai_docs/dev_templates/revision_adversarial.md y sigue TODOS sus pasos.
Lee la spec en: ${specPath}
Lee ai_docs/core/ para contexto del proyecto.

POSTURA OBLIGATORIA:
- Tu trabajo es ENCONTRAR PROBLEMAS, no confirmar que todo esta bien.
- Asume que hay bugs hasta demostrar lo contrario.
- Revisa TODA la implementacion, no solo la ultima task.
- Los problemas de integracion entre tasks son los mas peligrosos.
- NO modifiques codigo. Solo analiza y reporta.
- NO hagas preguntas. Trabaja con lo que hay.

Resumen de implementacion:
${implSummary}

Revisa:
1. Cada archivo modificado — lee el codigo actual y verifica que cumple la spec
2. Integracion entre tasks — busca conflictos, inconsistencias, imports rotos
3. Tests — que existan, que cubran los criterios de aceptacion de la spec
4. Edge cases — que esten cubiertos
5. Regresiones — que el codigo existente no se haya roto

Retorna tu veredicto con problemas criticos, menores, aspectos positivos y resumen.
`, { label: 'revision-adversarial', phase: 'Revision', schema: REVISION_SCHEMA })

const veredicto = revision ? revision.veredicto : 'ERROR'
log('Revision adversarial: ' + veredicto)

return {
  spec: specPath,
  spec_titulo: discovery.spec_titulo,
  tasks_total: taskList.length,
  tasks_completadas: completadas,
  tasks_fallidas: fallidas,
  implementaciones: results,
  revision: revision,
  veredicto: veredicto
}

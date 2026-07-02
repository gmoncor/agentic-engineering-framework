export const meta = {
  name: 'implementar-spec',
  description: 'Implementa todas las tasks de una spec, paralelizando tasks independientes por oleadas',
  phases: [
    { title: 'Descubrimiento', detail: 'Identificar tasks, dependencias y calcular oleadas de ejecucion' },
    { title: 'Implementacion', detail: 'Implementar tasks (paralelo en cada oleada, secuencial entre oleadas)' },
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
          independiente: { type: 'boolean' },
          dependencias: { type: 'array', items: { type: 'string' } }
        },
        required: ['path', 'titulo', 'independiente']
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

// ── Wave computation ──────────────────────────────────────────────────────────
// Groups tasks into execution waves based on dependencies.
// Wave 1: tasks with no dependencies (all run in parallel)
// Wave 2: tasks whose dependencies were all in wave 1 (all run in parallel)
// etc.
function computeWaves(tasks) {
  var waves = []
  var completed = {}
  var remaining = tasks.slice()

  while (remaining.length > 0) {
    var wave = []
    var nextRemaining = []
    for (var i = 0; i < remaining.length; i++) {
      var t = remaining[i]
      var deps = t.dependencias || []
      var allMet = true
      for (var d = 0; d < deps.length; d++) {
        if (!completed[deps[d]]) { allMet = false; break }
      }
      if (allMet) {
        wave.push(t)
      } else {
        nextRemaining.push(t)
      }
    }
    if (wave.length === 0) {
      waves.push(nextRemaining)
      break
    }
    waves.push(wave)
    for (var j = 0; j < wave.length; j++) {
      completed[wave[j].path] = true
    }
    remaining = nextRemaining
  }
  return waves
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
3. Lee cada task encontrada para extraer: titulo, si es independiente, dependencias (paths de otras tasks)
4. Una task es independiente si NO depende de otra task de esta misma spec
5. Las dependencias deben ser paths exactos de otras tasks (ej: ai_docs/tasks/001_crear_modelos.md)

IMPORTANTE: Retorna las dependencias como paths exactos de archivos, no como titulos ni descripciones.

Retorna el path de la spec, su titulo, y la lista completa de tasks con sus dependencias.
`, { label: 'descubrir-tasks', phase: 'Descubrimiento', schema: DISCOVER_SCHEMA })

const taskList = (discovery && discovery.tasks) ? discovery.tasks : []
if (taskList.length === 0) {
  return { spec: specPath, error: 'No se encontraron tasks para esta spec. Ejecuta /planificar primero.' }
}

const waves = computeWaves(taskList)
var waveDesc = []
for (var w = 0; w < waves.length; w++) {
  waveDesc.push('Oleada ' + (w + 1) + ': ' + waves[w].length + ' task(s)' + (waves[w].length > 1 ? ' (paralelo)' : ''))
}
log(taskList.length + ' tasks en ' + waves.length + ' oleada(s): ' + waveDesc.join(' → '))

// ── Phase 2: Implementacion por oleadas ───────────────────────────────────────
phase('Implementacion')
const allResults = []
var completadas = 0
var fallidas = 0
var taskCounter = 0

for (var wi = 0; wi < waves.length; wi++) {
  var wave = waves[wi]
  var isParallel = wave.length > 1

  if (isParallel) {
    log('Oleada ' + (wi + 1) + '/' + waves.length + ': ' + wave.length + ' tasks en paralelo')

    // Parallel: implement without commit
    var waveResults = await parallel(
      wave.map(function(task, idx) {
        var globalIdx = taskCounter + idx
        return function() {
          return agent('\
Lee ai_docs/dev_templates/implementar.md y sigue su proceso completo para implementar esta task.\n\
Lee ai_docs/core/ para contexto del proyecto.\n\
\n\
Task a implementar: ' + task.path + '\n\
Spec madre: ' + specPath + '\n\
\n\
CONTEXTO DEL WORKFLOW:\n\
- Esta task se implementa EN PARALELO con otras ' + (wave.length - 1) + ' task(s) de la misma oleada.\n\
- Las oleadas anteriores ya estan implementadas y commiteadas.\n\
' + (task.dependencias && task.dependencias.length > 0 ? '- Dependencias (ya completadas): ' + task.dependencias.join(', ') : '- Esta task es independiente.') + '\n\
\n\
PROCESO OBLIGATORIO:\n\
1. Lee la task completa y verifica pre-requisitos\n\
2. Investiga el codigo existente\n\
3. Implementa los cambios descritos en la task\n\
4. Escribe tests (RED-GREEN cuando aplique)\n\
5. Ejecuta validaciones (linting, tests, build)\n\
6. NO hagas commit — el commit se hara despues de que todas las tasks paralelas terminen\n\
\n\
REGLAS:\n\
- SOLO implementa lo que dice la task\n\
- Hallazgos fuera de alcance se anotan, no se corrigen\n\
- Si algo falla en validaciones, corregir antes de continuar\n\
- NO hagas preguntas. Trabaja con la informacion disponible.\n\
- NO ejecutes git commit ni git add\n\
\n\
En commit_message retorna el mensaje que usarias (formato: <tipo>: <descripcion>, max 72 chars).\n\
Tipos validos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore\n\
\n\
Retorna: path de la task, titulo, resultado, archivos modificados, tests creados/pasando, commit_message propuesto, hallazgos fuera de alcance.', {
            label: 'impl-' + (globalIdx + 1) + '-' + task.titulo.substring(0, 25),
            phase: 'Implementacion',
            schema: IMPL_SCHEMA
          })
        }
      })
    )

    // Sequential commits after parallel implementation
    var validResults = waveResults.filter(Boolean)
    if (validResults.length > 0) {
      var commitList = validResults.map(function(r) {
        return { files: (r.archivos_modificados || []).join(', '), message: r.commit_message || 'feat: implement ' + r.task_titulo }
      })
      var commitInstructions = commitList.map(function(c, i) {
        return (i + 1) + '. Stage archivos: ' + c.files + ' → commit: "' + c.message + '"'
      }).join('\n')

      await agent('\
Crea commits individuales para cada task completada en esta oleada.\n\
Para CADA entrada, ejecuta git add con los archivos listados y luego git commit con el mensaje indicado.\n\
Si algun archivo no existe o no tiene cambios, omitelo del staging sin error.\n\
\n\
Commits a crear (uno por task, en este orden):\n' + commitInstructions + '\n\
\n\
Ejecuta cada git add + git commit como operaciones separadas. Un commit por task.', {
        label: 'commits-oleada-' + (wi + 1),
        phase: 'Implementacion'
      })
    }

    for (var ri = 0; ri < waveResults.length; ri++) {
      var r = waveResults[ri]
      if (r) {
        allResults.push(r)
        if (r.resultado === 'COMPLETADA') { completadas++ } else { fallidas++ }
      } else {
        allResults.push({ task_path: wave[ri].path, task_titulo: wave[ri].titulo, resultado: 'FALLIDA', archivos_modificados: [], notas: 'El agente no retorno resultado' })
        fallidas++
      }
    }
    taskCounter += wave.length

  } else {
    // Sequential: single task, implement + commit
    var task = wave[0]
    taskCounter++
    log('Oleada ' + (wi + 1) + '/' + waves.length + ': ' + task.titulo)

    var result = await agent('\
Lee ai_docs/dev_templates/implementar.md y sigue su proceso completo para implementar esta task.\n\
Lee ai_docs/core/ para contexto del proyecto.\n\
\n\
Task a implementar: ' + task.path + '\n\
Spec madre: ' + specPath + '\n\
\n\
CONTEXTO DEL WORKFLOW:\n\
- Task ' + taskCounter + ' de ' + taskList.length + ' en la implementacion de esta spec.\n\
- Las oleadas anteriores ya estan implementadas y commiteadas.\n\
' + (task.dependencias && task.dependencias.length > 0 ? '- Dependencias (ya completadas): ' + task.dependencias.join(', ') : '- Esta task es independiente.') + '\n\
\n\
PROCESO OBLIGATORIO:\n\
1. Lee la task completa y verifica pre-requisitos\n\
2. Investiga el codigo existente\n\
3. Implementa los cambios descritos en la task\n\
4. Escribe tests (RED-GREEN cuando aplique)\n\
5. Ejecuta validaciones (linting, tests, build)\n\
6. Haz commit con mensaje descriptivo siguiendo el formato: <tipo>: <descripcion>\n\
   Tipos validos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore\n\
   Subject maximo 72 caracteres\n\
\n\
REGLAS:\n\
- SOLO implementa lo que dice la task\n\
- Hallazgos fuera de alcance se anotan, no se corrigen\n\
- Si algo falla en validaciones, corregir antes de continuar\n\
- NO hagas preguntas. Trabaja con la informacion disponible.\n\
\n\
Retorna: path de la task, titulo, resultado (COMPLETADA/FALLIDA/PARCIAL), archivos modificados, tests creados/pasando, mensaje de commit, hallazgos fuera de alcance.', {
      label: 'impl-' + taskCounter + '-' + task.titulo.substring(0, 25),
      phase: 'Implementacion',
      schema: IMPL_SCHEMA
    })

    if (result) {
      allResults.push(result)
      if (result.resultado === 'COMPLETADA') { completadas++ } else { fallidas++ }
      log('Task ' + taskCounter + ': ' + (result.resultado || 'SIN_RESULTADO'))
    } else {
      allResults.push({ task_path: task.path, task_titulo: task.titulo, resultado: 'FALLIDA', archivos_modificados: [], notas: 'El agente no retorno resultado' })
      fallidas++
      log('Task ' + taskCounter + ': FALLO (sin resultado del agente)')
    }
  }
}

log('Implementacion: ' + completadas + ' completadas, ' + fallidas + ' fallidas de ' + taskList.length)

// ── Phase 3: Revision adversarial ─────────────────────────────────────────────
phase('Revision')
const implSummary = JSON.stringify(allResults.map(function(r) {
  return {
    task: r.task_path,
    titulo: r.task_titulo,
    resultado: r.resultado,
    archivos: r.archivos_modificados,
    tests: r.tests_creados || 0,
    commit: r.commit_message || ''
  }
}), null, 2)

const revision = await agent('\
Lee ai_docs/dev_templates/revision_adversarial.md y sigue TODOS sus pasos.\n\
Lee la spec en: ' + specPath + '\n\
Lee ai_docs/core/ para contexto del proyecto.\n\
\n\
POSTURA OBLIGATORIA:\n\
- Tu trabajo es ENCONTRAR PROBLEMAS, no confirmar que todo esta bien.\n\
- Asume que hay bugs hasta demostrar lo contrario.\n\
- Revisa TODA la implementacion, no solo la ultima task.\n\
- Los problemas de integracion entre tasks son los mas peligrosos.\n\
- NO modifiques codigo. Solo analiza y reporta.\n\
- NO hagas preguntas. Trabaja con lo que hay.\n\
\n\
Resumen de implementacion:\n' + implSummary + '\n\
\n\
Revisa:\n\
1. Cada archivo modificado — lee el codigo actual y verifica que cumple la spec\n\
2. Integracion entre tasks — busca conflictos, inconsistencias, imports rotos\n\
3. Tests — que existan, que cubran los criterios de aceptacion de la spec\n\
4. Edge cases — que esten cubiertos\n\
5. Regresiones — que el codigo existente no se haya roto\n\
\n\
Retorna tu veredicto con problemas criticos, menores, aspectos positivos y resumen.', {
  label: 'revision-adversarial',
  phase: 'Revision',
  schema: REVISION_SCHEMA
})

const veredicto = revision ? revision.veredicto : 'ERROR'
log('Revision adversarial: ' + veredicto)

return {
  spec: specPath,
  spec_titulo: discovery.spec_titulo,
  tasks_total: taskList.length,
  oleadas: waves.length,
  tasks_completadas: completadas,
  tasks_fallidas: fallidas,
  implementaciones: allResults,
  revision: revision,
  veredicto: veredicto
}

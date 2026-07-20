export const meta = {
  name: 'implementar-spec',
  description: 'Implementa todas las tasks de una spec en orden topologico, una tras otra',
  phases: [
    { title: 'Descubrimiento', detail: 'Identificar tasks, dependencias y orden de ejecucion' },
    { title: 'Implementacion', detail: 'Implementar cada task en orden, respetando sus dependencias' },
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
          dependencias: { type: 'array', items: { type: 'string' } },
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
        required: ['path', 'titulo']
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

// ── Modulos del repo ──────────────────────────────────────────────────────────
// Se cargan por ruta absoluta desde la raiz del proyecto: el workflow se evalua
// sin una URL de modulo propia, asi que un import relativo no resolveria.
async function cargarModulo(rutaRelativa) {
  const path = await import('node:path')
  const url = await import('node:url')
  const mod = await import(url.pathToFileURL(path.resolve(rutaRelativa)).href)
  return mod.default || mod
}

// ── Senal de revision POST-implementacion ─────────────────────────────────────
// Tras la revision adversarial, este workflow deja constancia de que el codigo
// entregado fue revisado. El hook sdd-review-gate.js consume esa senal para no
// avisar. Es una senal de conveniencia, no una prueba: registra que hubo una
// revision en esta sesion, no que el diff que luego se commitee sea el revisado.
// El contrato vive en hooks/sdd-review-signal.js (un solo formato para emisor y
// consumidor). Si el modulo no esta disponible (framework sin hooks instalados),
// la emision se omite sin romper el workflow.
async function emitirSenalRevision(contenidoRevisado) {
  try {
    const senal = await cargarModulo('hooks/sdd-review-signal.js')
    const hash = senal.hashDiff(contenidoRevisado)
    senal.writeSignal(senal.resolveSessionId(), hash)
    return hash
  } catch (e) {
    return null
  }
}

// ── Fase 1: Descubrimiento ────────────────────────────────────────────────────
phase('Descubrimiento')
const specPath = (typeof args === 'string' ? args : '').trim()
if (!specPath || specPath.length < 5) {
  return { error: 'Se requiere el path de la spec como argumento (ej: ai_docs/tasks/spec_autenticacion.md)' }
}

const orq = await cargarModulo('.claude/workflows/lib/orquestacion.js')

const discovery = await agent(`
Encuentra todas las tasks asociadas a la spec: ${specPath}

Proceso:
1. Lee la spec para obtener su titulo y criterios de aceptacion
2. Busca en ai_docs/tasks/ todos los archivos .md (excluyendo spec_*.md) que referencien esta spec
3. Lee cada task encontrada para extraer: titulo, dependencias (paths de otras tasks)
   y los contratos que produce o consume
4. Las dependencias deben ser paths exactos de otras tasks (ej: ai_docs/tasks/001_crear_modelos.md)
5. Los contratos son lo que una task produce y otra consume (API, tipo, export). Formato por contrato:
   tipo (produce|consume), nombre, archivo

IMPORTANTE: Retorna las dependencias como paths exactos de archivos, no como titulos ni descripciones.

Retorna el path de la spec, su titulo, y la lista completa de tasks.
`, { label: 'descubrir-tasks', phase: 'Descubrimiento', schema: DISCOVER_SCHEMA })

const taskList = (discovery && discovery.tasks) ? discovery.tasks : []
if (taskList.length === 0) {
  return { spec: specPath, error: 'No se encontraron tasks para esta spec. Ejecuta /planificar primero.' }
}

// Un ciclo de dependencias, o una dependencia cuyo documento no existe, no pueden
// implementarse: son errores del plan. computeWaves valida ambos y agrupa las
// tasks en niveles topologicos que el bucle recorre en orden.
var waves
try {
  waves = orq.computeWaves(taskList, '.')
} catch (e) {
  return { spec: specPath, error: e.message }
}

const contratosRotos = orq.verificarContratos(taskList)
for (var ci = 0; ci < contratosRotos.length; ci++) {
  log('AVISO contrato: ' + contratosRotos[ci])
}

log(taskList.length + ' tasks, ' + waves.length + ' nivel(es) de dependencia')
for (var w = 0; w < waves.length; w++) {
  log('Nivel ' + (w + 1) + ': ' + waves[w].map(function(t) { return t.titulo }).join(', '))
}

// ── Fase 2: Implementacion ────────────────────────────────────────────────────
// Las tasks se implementan una tras otra en orden topologico: cada nivel de
// dependencia antes que el siguiente y, dentro de un nivel, una task despues de
// otra. Cada implementador crea el commit de su propia task.
phase('Implementacion')

function promptImplementacion(task) {
  const deps = (task.dependencias && task.dependencias.length > 0)
    ? '- Dependencias (ya completadas): ' + task.dependencias.join(', ')
    : '- Esta task es independiente.'

  return '\
Lee ai_docs/dev_templates/implementar.md y sigue su proceso completo para implementar esta task.\n\
Lee ai_docs/core/ para contexto del proyecto.\n\
\n\
Task a implementar: ' + task.path + '\n\
Spec madre: ' + specPath + '\n\
\n\
CONTEXTO DEL WORKFLOW:\n' + deps + '\n\
- Las tasks se implementan una tras otra en orden; sus dependencias ya estan completadas.\n\
- Escribe SOLO los archivos declarados en la tabla "Archivos afectados" de tu task.\n\
\n\
PROCESO OBLIGATORIO:\n\
1. Lee la task completa y verifica pre-requisitos\n\
2. Investiga el codigo existente\n\
3. Implementa los cambios descritos en la task\n\
4. Escribe tests (RED-GREEN cuando aplique)\n\
5. Ejecuta validaciones (linting, tests, build)\n\
6. Crea el commit de esta task\n\
\n\
REGLAS:\n\
- SOLO implementa lo que dice la task\n\
- Hallazgos fuera de alcance se anotan, no se corrigen\n\
- Si algo falla en validaciones, corregir antes de continuar\n\
- NO hagas preguntas. Trabaja con la informacion disponible.\n\
\n\
COMMIT (una task, un commit):\n\
- Al terminar, haz git add de los archivos que modificaste y crea el commit de esta task.\n\
- Mensaje: primera linea "<tipo>: <descripcion>" (max 72 chars) y un cuerpo que explique QUE cambio y POR QUE.\n\
- Tipos validos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore\n\
- Si no hay nada staged, termina sin error y no crees un commit vacio.\n\
\n\
En commit_message retorna la primera linea del mensaje del commit que creaste.\n\
Retorna: path de la task, titulo, resultado, archivos modificados, tests creados/pasando, commit_message, hallazgos fuera de alcance.'
}

async function implementarTask(task) {
  return agent(promptImplementacion(task), {
    label: 'impl-' + task.titulo.substring(0, 25),
    phase: 'Implementacion',
    schema: IMPL_SCHEMA
  })
}

// Recorrido topologico: los niveles en orden y, dentro de cada nivel, una task
// tras otra. Si una dependencia previa termino FALLIDA, la task se marca
// bloqueada sin ejecutarla — y su propio FALLIDA arrastra a quien dependa de ella.
const allResults = []
for (const wave of waves) {
  for (const task of wave) {
    const depsFallidas = (task.dependencias || []).filter(function(d) {
      return allResults.some(function(r) { return r.task_path === d && r.resultado === 'FALLIDA' })
    })

    if (depsFallidas.length > 0) {
      log('Task ' + task.titulo + ': BLOQUEADA (dependencias fallidas: ' + depsFallidas.join(', ') + ')')
      allResults.push({
        task_path: task.path,
        task_titulo: task.titulo,
        resultado: 'FALLIDA',
        archivos_modificados: [],
        notas: 'No se implemento: sus dependencias no se completaron (' + depsFallidas.join(', ') + ')'
      })
      continue
    }

    log('Implementando: ' + task.titulo)
    const resultado = await implementarTask(task)
    allResults.push(resultado || {
      task_path: task.path,
      task_titulo: task.titulo,
      resultado: 'FALLIDA',
      archivos_modificados: [],
      notas: 'El agente no retorno resultado'
    })
  }
}

var completadas = 0
var fallidas = 0
for (var ri = 0; ri < allResults.length; ri++) {
  if (allResults[ri].resultado === 'COMPLETADA') { completadas++ } else { fallidas++ }
}
log('Implementacion: ' + completadas + ' completadas, ' + fallidas + ' fallidas de ' + taskList.length)

// ── Fase 3: Revision adversarial ──────────────────────────────────────────────
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

// La senal solo se emite si la revision produjo veredicto. Registra que la
// revision OCURRIO en esta sesion — no que haya salido limpia, ni que ate el
// diff: sirve para que el aviso del hook no repita lo que ya se ha hecho.
var marcaRevision = null
if (revision) {
  marcaRevision = await emitirSenalRevision(JSON.stringify({ spec: specPath, impl: allResults, revision: revision }))
  if (marcaRevision) {
    log('Revision registrada en la senal de la sesion (' + marcaRevision + ')')
  }
}

return {
  spec: specPath,
  spec_titulo: discovery.spec_titulo,
  tasks_total: taskList.length,
  niveles: waves.length,
  tasks_completadas: completadas,
  tasks_fallidas: fallidas,
  implementaciones: allResults,
  revision: revision,
  marca_revision: marcaRevision,
  veredicto: veredicto
}

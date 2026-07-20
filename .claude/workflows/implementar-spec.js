export const meta = {
  name: 'implementar-spec',
  description: 'Implementa todas las tasks de una spec en orden topologico, una tras otra',
  phases: [
    { title: 'Descubrimiento', detail: 'Identificar tasks, dependencias y orden de ejecucion' },
    { title: 'Implementacion', detail: 'Implementar cada task, revisarla y commitearla antes de pasar a la siguiente' },
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
    commit_message: { type: 'string' },
    commit_cuerpo: { type: 'string' },
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

// ── Git del working tree ──────────────────────────────────────────────────────
// El workflow controla el commit de cada task (el implementador ya no commitea):
// primero se revisa el diff, y solo si la revision aprueba se emite la senal y se
// commitea. Se ejecuta git por child_process para no depender del shell del agente.
async function git(argv) {
  const cp = await import('node:child_process')
  const r = cp.spawnSync('git', argv, { encoding: 'utf8', timeout: 15000 })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

// ── Gate de tests: ejecuta el comando real y lee el exit code ─────────────────
// Corre la suite del proyecto contra el working tree ANTES de revisar/commitear.
// El exit code es la unica evidencia que cuenta: no se lee ningun numero de tests
// auto-reportado por el implementador. Un timeout o un fallo del spawn deja code
// distinto de 0, que evaluarGateTests trata como rojo (bloquea).
async function ejecutarTests(comando) {
  const cp = await import('node:child_process')
  const r = cp.spawnSync(comando.cmd, comando.args, { encoding: 'utf8', timeout: 600000 })
  return { code: r.status, err: (r.stderr || '').slice(-400) }
}

// Descubre y ejecuta el comando de test, y devuelve el veredicto del gate. Los
// archivos se leen del diff staged (cambios reales), no del auto-reporte: asi la
// exencion docs/config se decide sobre lo que de verdad se toco.
async function gateTests(task) {
  await git(['add', '-A'])
  const archivos = (await git(['diff', '--cached', '--name-only'])).out
    .split('\n').map(function(s) { return s.trim() }).filter(Boolean)

  const comando = orq.descubrirComandoTest('.')
  var exitCode = null
  if (comando) {
    log('Gate de tests (' + task.titulo + '): ' + comando.cmd + ' ' + comando.args.join(' ') + ' [' + comando.fuente + ']')
    exitCode = (await ejecutarTests(comando)).code
  }
  return orq.evaluarGateTests({ comando: comando, exitCode: exitCode, archivos: archivos })
}

// ── Senal de revision POST-implementacion, por task ───────────────────────────
// Emitida JUSTO antes de commitear una task que paso la revision adversarial. El
// hash es el del diff cacheado que se va a commitear; el hook sdd-review-gate.js
// recalcula ese hash y lo contrasta, asi que la senal ata el diff concreto (no es
// una mera marca de "hubo revision"). El contrato vive en hooks/sdd-review-signal.js
// (un solo formato para emisor y consumidor). Si el modulo no esta disponible
// (framework sin hooks instalados), la emision se omite sin romper el workflow.
async function emitirSenalRevision(diffRevisado) {
  try {
    const senal = await cargarModulo('hooks/sdd-review-signal.js')
    const hash = senal.hashDiff(diffRevisado)
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

// ── Fase 2: Implementacion (con revision por task antes del commit) ───────────
// Las tasks se implementan una tras otra en orden topologico: cada nivel de
// dependencia antes que el siguiente y, dentro de un nivel, una task despues de
// otra. Por cada task: el implementador deja los cambios en el working tree (no
// commitea); el workflow revisa ESE diff con un agente aparte (contexto limpio);
// si la revision aprueba, emite la senal atada al diff y crea el commit. Asi cada
// unidad se valida antes de avanzar a la siguiente.
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
4. Escribe tests. Para funcionalidad nueva, RED-GREEN es obligatorio: el test debe FALLAR sin tu cambio\n\
5. Ejecuta validaciones (linting, tests, build). El workflow re-ejecuta la suite como gate antes de commitear\n\
\n\
REGLAS:\n\
- SOLO implementa lo que dice la task\n\
- Hallazgos fuera de alcance se anotan, no se corrigen\n\
- Si algo falla en validaciones, corregir antes de continuar\n\
- NO hagas preguntas. Trabaja con la informacion disponible.\n\
\n\
NO COMMITEAR:\n\
- Deja los cambios en el working tree. NO hagas git add ni git commit.\n\
- El workflow revisa tu diff y, si la revision aprueba, crea el commit de la task.\n\
- Propon el mensaje del commit: commit_message = "<tipo>: <descripcion>" (max 72 chars),\n\
  commit_cuerpo = QUE cambio y POR QUE. Tipos validos: feat, fix, update, refactor, create,\n\
  optimize, remove, rename, docs, test, style, chore.\n\
\n\
Retorna: path de la task, titulo, resultado, archivos modificados,\n\
commit_message, commit_cuerpo, hallazgos fuera de alcance.'
}

async function implementarTask(task) {
  return agent(promptImplementacion(task), {
    label: 'impl-' + task.titulo.substring(0, 25),
    phase: 'Implementacion',
    schema: IMPL_SCHEMA
  })
}

// Revision adversarial de UNA task: contexto limpio, solo el diff de la task.
async function revisarDiff(task, diff) {
  return agent('\
Lee ai_docs/dev_templates/revision_adversarial.md y sigue sus pasos, aplicados a UNA task.\n\
Lee la task en: ' + task.path + '\n\
Lee ai_docs/core/ para contexto del proyecto.\n\
\n\
POSTURA OBLIGATORIA:\n\
- Tu trabajo es ENCONTRAR PROBLEMAS en esta task, no confirmar que todo esta bien.\n\
- Asume que hay bugs hasta demostrar lo contrario.\n\
- NO modifiques codigo. Solo analiza y reporta.\n\
- NO hagas preguntas. Trabaja con lo que hay.\n\
\n\
Diff de la task (lo que se va a commitear):\n\
```diff\n' + diff + '\n```\n\
\n\
Revisa: correccion frente a la task, tests presentes y utiles, edge cases,\n\
regresiones, codigo muerto y seguridad.\n\
Emite tu veredicto: APROBADA, NECESITA_CORRECCIONES o RECHAZADA.', {
    label: 'revision-' + task.titulo.substring(0, 20),
    phase: 'Implementacion',
    schema: REVISION_SCHEMA
  })
}

// Una unica pasada de correccion de los problemas que encontro la revision. Deja
// los cambios en el working tree; no commitea. El workflow re-revisa despues.
async function corregirTask(task, revision) {
  const problemas = (revision.problemas_criticos || []).concat(revision.problemas_menores || [])
  return agent('\
La revision adversarial encontro problemas en esta task. Corrigelos en el working tree.\n\
Lee ai_docs/dev_templates/implementar.md para el proceso.\n\
Task: ' + task.path + '\n\
\n\
Problemas a corregir:\n- ' + (problemas.length ? problemas.join('\n- ') : '(ver el resumen de la revision)') + '\n\
Resumen de la revision: ' + (revision.resumen || '') + '\n\
\n\
REGLAS:\n\
- Corrige SOLO los problemas listados, dentro de los archivos de esta task.\n\
- Deja los cambios en el working tree. NO hagas git add ni git commit.\n\
- Ejecuta los tests y asegurate de que pasan.\n\
- NO hagas preguntas.', {
    label: 'correccion-' + task.titulo.substring(0, 18),
    phase: 'Implementacion',
    schema: IMPL_SCHEMA
  })
}

// Revisa el diff de la task y, si aprueba, emite la senal atada al diff y commitea.
// Devuelve el resultado del implementador con el veredicto reflejado.
async function revisarYComitear(task, resultado) {
  await git(['add', '-A'])
  var diff = (await git(['diff', '--cached'])).out

  // Task sin cambios en el working tree (nada que revisar ni que commitear).
  if (!diff || !diff.trim()) {
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '') + '(sin cambios en el working tree: no se commitea)'
    return resultado
  }

  var revision = await revisarDiff(task, diff)
  var veredicto = revision ? revision.veredicto : 'ERROR'

  // Una sola pasada de correccion si la revision es adversa.
  if (veredicto !== 'APROBADA') {
    log('Revision de ' + task.titulo + ': ' + veredicto + ' — una pasada de correccion')
    await corregirTask(task, revision || { problemas_criticos: [], problemas_menores: [] })
    await git(['add', '-A'])
    diff = (await git(['diff', '--cached'])).out
    revision = await revisarDiff(task, diff)
    veredicto = revision ? revision.veredicto : 'ERROR'
  }

  // Sigue adversa: no se commitea. Se descarta el trabajo para no contaminar el
  // diff de la siguiente task (git clean respeta .gitignore).
  if (veredicto !== 'APROBADA') {
    log('Task ' + task.titulo + ': FALLIDA (revision ' + veredicto + '), no se commitea')
    await git(['reset', '--hard', 'HEAD'])
    await git(['clean', '-fd'])
    resultado.resultado = 'FALLIDA'
    resultado.revision = revision
    resultado.notas = (resultado.notas ? resultado.notas + ' ' : '') + '(revision adversarial: ' + veredicto + ')'
    return resultado
  }

  // Aprobada: la senal ata el hash al diff revisado; despues se commitea.
  const marca = await emitirSenalRevision(diff)
  const subject = String(resultado.commit_message || ('feat: ' + task.titulo)).substring(0, 72)
  const cuerpo = resultado.commit_cuerpo || resultado.notas || 'Implementa la task segun su especificacion.'
  await git(['commit', '-m', subject, '-m', cuerpo])
  log('Task ' + task.titulo + ': APROBADA y commiteada' + (marca ? ' (senal ' + marca + ')' : ''))
  resultado.revision = revision
  resultado.marca_revision = marca
  return resultado
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

    // Sin resultado, o el propio implementador fallo: nada que revisar ni commitear.
    if (!resultado || resultado.resultado === 'FALLIDA') {
      allResults.push(resultado || {
        task_path: task.path,
        task_titulo: task.titulo,
        resultado: 'FALLIDA',
        archivos_modificados: [],
        notas: 'El agente no retorno resultado'
      })
      continue
    }

    // Gate de tests: ejecuta la suite real y lee el exit code, antes de la
    // revision y del commit. Rojo (exit != 0) bloquea; falta de comando bloquea
    // solo si la task toca codigo. SDD_GUARD_SKIP=1 degrada el bloqueo a aviso
    // (escape puntual para un fallo ajeno a la task).
    const gate = await gateTests(task)
    resultado.gate_tests = gate
    if (gate.estado === 'FALLIDA' && process.env.SDD_GUARD_SKIP !== '1') {
      log('Task ' + task.titulo + ': FALLIDA (gate de tests) — ' + gate.nota + ', no se commitea')
      await git(['reset', '--hard', 'HEAD'])
      await git(['clean', '-fd'])
      resultado.resultado = 'FALLIDA'
      resultado.notas = (resultado.notas ? resultado.notas + ' ' : '') + '(gate de tests: ' + gate.nota + ')'
      allResults.push(resultado)
      continue
    }
    if (gate.estado !== 'PASA') {
      log('Gate de tests (' + task.titulo + '): ' + gate.nota)
    }

    allResults.push(await revisarYComitear(task, resultado))
  }
}

var completadas = 0
var fallidas = 0
for (var ri = 0; ri < allResults.length; ri++) {
  if (allResults[ri].resultado === 'COMPLETADA') { completadas++ } else { fallidas++ }
}
log('Implementacion: ' + completadas + ' completadas, ' + fallidas + ' fallidas de ' + taskList.length)

// El gate primario es la revision POR TASK (ya ejecutada arriba, antes de cada
// commit). Una revision de integracion final sobre el conjunto es opcional y
// ligera: se puede lanzar aparte con /revision si la spec toca varias tasks que
// interactuan. No se ejecuta aqui para no repetir lo ya revisado por task.

return {
  spec: specPath,
  spec_titulo: discovery.spec_titulo,
  tasks_total: taskList.length,
  niveles: waves.length,
  tasks_completadas: completadas,
  tasks_fallidas: fallidas,
  implementaciones: allResults
}

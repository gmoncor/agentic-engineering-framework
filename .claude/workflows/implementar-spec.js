export const meta = {
  name: 'implementar-spec',
  description: 'Implementa todas las tasks de una spec en orden de dependencias; con --parallel, a la vez dentro de cada nivel',
  phases: [
    { title: 'Descubrimiento', detail: 'Identificar tasks, dependencias y orden de ejecucion' },
    { title: 'Implementacion', detail: 'Implementar cada task, revisarla y commitearla antes de pasar a la siguiente' },
    { title: 'Convergencia', detail: 'Verificar convergencia entre spec y resultado final' },
  ],
}

// Tamaño: 1 + N×(1 a 8) + 0 a 2 agentes — por task, implementador y revisor, y hasta tres rondas
// de corrector + revisor; uno de descubrimiento y, al final, verificación de convergencia y, con
// brechas bloqueantes, su creación de tasks. Cada agente acota un contexto que otro no debe heredar.
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
    // Lo que el cambio hizo distinto de lo declarado: ficheros fuera de la tabla, contratos
    // cambiados, criterios no cumplidos. El revisor las contrasta con el diff.
    desviaciones: { type: 'array', items: { type: 'string' } },
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
    resumen: { type: 'string' },
    hallazgos_previos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hallazgo: { type: 'string' },
          estado: { type: 'string', enum: ['resuelto', 'persistente', 'refutado'] }
        },
        required: ['hallazgo', 'estado']
      }
    },
    correcciones_propuestas: { type: 'array', items: { type: 'string' } }
  },
  required: ['veredicto', 'problemas_criticos', 'problemas_menores', 'resumen']
}

const CONVERGENCIA_SCHEMA = {
  type: 'object',
  properties: {
    veredicto: { type: 'string', enum: ['CONVERGIDA', 'DIVERGE'] },
    criterios_verificados: { type: 'integer' },
    brechas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterio: { type: 'string' },
          hallazgo: { type: 'string' },
          evidencia: { type: 'string' },
          severidad: { type: 'string', enum: ['BLOQUEANTE', 'WARNING'] }
        },
        required: ['criterio', 'hallazgo', 'evidencia', 'severidad']
      }
    }
  },
  required: ['veredicto', 'brechas']
}

const CREACION_CONVERGENCIA_SCHEMA = {
  type: 'object',
  properties: {
    tasks_creadas: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' }
  },
  required: ['tasks_creadas']
}

// ── Modulos del repo ──────────────────────────────────────────────────────────
// Se cargan por ruta absoluta desde la raiz del proyecto: el workflow se evalua
// sin una URL de modulo propia, asi que un import relativo no resolveria.
//
// La ruta se ancla al directorio del PROYECTO, no al directorio en curso del proceso. No son el
// mismo sitio en cuanto la sesion arranca en un subdirectorio o en un arbol de trabajo enlazado, y
// resolver contra el segundo dejaba el modulo sin encontrar. Peor: el fallo era mudo — la senal de
// revision no se emitia y el gate denegaba el commit despues sin que nada explicase por que.
//
// Se asciende desde el directorio en curso hasta dar con el que contiene la ruta pedida. El
// directorio en curso se prueba PRIMERO: donde la carga ya funcionaba, resuelve exactamente igual
// que antes.
const MAX_ASCENSO = 10

// Comienzo de una ruta absoluta de Windows: unidad (C:\ o C:/) o recurso de red (\\servidor).
const PREFIJO_WINDOWS_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/

// Traduce a los separadores del sistema en curso una ruta que puede venir de otro. SIEMPRE ANTES
// de resolverla: la barra invertida es separador en Windows y un caracter valido de nombre de
// archivo en los sistemas tipo Unix, asi que sin traducir "hooks\sdd-review-signal.js" no denota
// dos tramos sino UN nombre de archivo, y no se encuentra. Sobre una ruta nativa de cada
// plataforma es la identidad. Mismo criterio que hooks/sdd-plan-state.js `toNativePath`.
function rutaNativa(cruda, path) {
  const ruta = String(cruda == null ? '' : cruda)
  if (path.sep === '\\' || !ruta.includes('\\')) return ruta
  if (ruta.includes('/') && !PREFIJO_WINDOWS_RE.test(ruta)) return ruta
  return ruta.replace(/\\/g, '/')
}

async function resolverEnProyecto(rutaRelativa) {
  const path = await import('node:path')
  const fs = await import('node:fs')
  const rel = rutaNativa(rutaRelativa, path)
  if (path.isAbsolute(rel)) return rel

  var dir = process.cwd()
  for (var i = 0; i < MAX_ASCENSO; i++) {
    const candidato = path.resolve(dir, rel)
    if (fs.existsSync(candidato)) return candidato
    const padre = path.dirname(dir)
    if (padre === dir) break
    dir = padre
  }
  // Sin encontrarlo en ningun nivel: la ruta de siempre, para que el error nombre el sitio
  // donde el modulo se esperaba.
  return path.resolve(process.cwd(), rel)
}

async function cargarModulo(rutaRelativa) {
  const url = await import('node:url')
  const mod = await import(url.pathToFileURL(await resolverEnProyecto(rutaRelativa)).href)
  return mod.default || mod
}

// Ancla contra la que se busca cualquier cosa "del proyecto": el directorio que contiene
// .claude/workflows/, localizado por el mismo ascenso. Lo usan el descubrimiento del comando de
// test y la validacion de las dependencias, que antes resolvian contra el directorio en curso.
// Ese resto importa ahora mas que antes: con los modulos ya localizados, una sesion arrancada en
// un subdirectorio llegaba al gate de tests, no encontraba alli el comando del proyecto y
// bloqueaba la task descartando su trabajo. Cuando el directorio en curso ES la raiz — el caso
// habitual — el ancla es exactamente ese directorio y nada cambia.
async function raizDelProyecto() {
  const path = await import('node:path')
  return path.dirname(path.dirname(await resolverEnProyecto('.claude/workflows')))
}

// ── Ámbito de la task: acota su commit y su apartado en modo concurrente ──────
// En modo concurrente todas las tasks de un nivel comparten arbol e indice: sin acotar, `git add
// -A` prepara también el trabajo sin commitear de una hermana en curso (F1 de orquestacion.js), y
// apartar el trabajo de una task fallida se llevaría también el de sus hermanas. El
// ambito es la lista de ficheros que la TASK DECLARA en su propia tabla "Archivos afectados"
// (parser SSOT hooks/sdd-task-files.js, el mismo que usa el guard de pipeline), no el auto-reporte
// del implementador: con el guard activo coinciden por construccion.
//
// Mismo patron de carga que emitirSenalRevision: resolverEnProyecto + comprobacion de existencia +
// cargarModulo. Si el proyecto no tiene el parser instalado, o la task no tiene una tabla legible,
// el ambito degrada a una lista vacia con el motivo registrado — orquestacion.js decide entonces
// qué hacer con un ámbito vacío (no lo usa como pathspec, ver diffPreparado; y no aparta
// nada, ver apartarTrabajo).
//
// Se calcula una sola vez por task (no en cada llamada a git): el resultado se cachea por su path.
const ambitoCache = new Map()
async function ambitoTask(task) {
  if (ambitoCache.has(task.path)) return ambitoCache.get(task.path)

  const resultado = await calcularAmbitoTask(task)
  ambitoCache.set(task.path, resultado)
  return resultado
}

async function calcularAmbitoTask(task) {
  const fs = await import('node:fs')
  const ruta = await resolverEnProyecto('hooks/sdd-task-files.js')

  if (!fs.existsSync(ruta)) {
    log('Ambito de ' + task.titulo + ' vacio: el proyecto no tiene hooks/sdd-task-files.js instalado, '
      + 'asi que no hay tabla "Archivos afectados" que parsear; el commit solo se acota al '
      + 'proyecto.')
    return []
  }

  try {
    const parser = await cargarModulo('hooks/sdd-task-files.js')
    const contenido = fs.readFileSync(await resolverEnProyecto(task.path), 'utf8')
    return parser.parseAffectedFiles(contenido)
  } catch (e) {
    log('Ambito de ' + task.titulo + ' vacio: ' + e.message + '; el commit solo se acota al proyecto.')
    return []
  }
}

// ── Git del working tree ──────────────────────────────────────────────────────
// El workflow controla el commit de cada task (el implementador ya no commitea):
// primero se revisa el diff, y solo si la revision aprueba se emite la senal y se
// commitea. Se ejecuta git por child_process para no depender del shell del agente.
// Corre en la raíz del proyecto: las rutas del ámbito y el pathspec "." del commit, del apartado
// y de la comprobación de árbol limpio son relativos a ella, no al directorio en curso.
async function git(argv) {
  const cp = await import('node:child_process')
  const r = cp.spawnSync('git', argv, { cwd: raizProyecto, encoding: 'utf8', timeout: 15000 })
  // Un spawn que no llega a arrancar (git ausente) o que agota su tiempo deja status en null y el
  // motivo en r.error, no en stderr: sin recogerlo, el fallo se queda sin causa que reportar.
  return { code: r.status, out: r.stdout || '', err: r.stderr || (r.error ? r.error.message : '') }
}

// Toda lectura de git que sostenga un veredicto pasa por orq.gitVerificado, que exige codigo de
// salida 0: leer solo la salida estandar confunde el vacio legitimo (exit 0, nada preparado) con
// el fallo (indice bloqueado, tiempo agotado, git ausente), y ese es el peor de los dos errores.
// Un fallo de infraestructura pasaba por veredicto, se registraba la constancia de revision del
// diff vacio y el gate denegaba el commit despues sin explicacion.

// Aparta, sin destruirlo, el trabajo sin commitear de una task que no se commitea: queda en
// `git stash` con nombre y se recupera con `git stash pop`. En secuencial, todo el árbol salvo
// orq.RUTAS_FUERA (documentos de plan y registro de sesiones); en concurrente, solo el ámbito de
// la task. El criterio vive en
// orquestacion.apartarTrabajo, probado con dobles y con git real.
async function apartarTrabajo(task) {
  return orq.apartarTrabajo(task, {
    spawnGit: git,
    log: registro,
    modoParalelo: modoParalelo,
    ambito: modoParalelo ? await ambitoTask(task) : undefined,
  })
}

// Antes de cada task del recorrido secuencial: el árbol tiene que seguir limpio fuera de
// orq.RUTAS_FUERA.
async function arbolLimpio() {
  return orq.comprobarArbolLimpio(git)
}

// El registro del flujo se pasa a orquestacion.js como dependencia.
function registro(mensaje) {
  log(mensaje)
}

// ── Gate de tests: ejecuta el comando real y lee el exit code ─────────────────
// Corre la suite del proyecto contra el working tree ANTES de revisar/commitear.
// El exit code es la unica evidencia que cuenta: no se lee ningun numero de tests
// auto-reportado por el implementador. Un timeout o un fallo del spawn deja code
// distinto de 0, que evaluarGateTests trata como rojo (bloquea).
//
// Corre en la raíz del proyecto, donde se descubrió el comando. Solo se usan el código de salida
// y la cola de stderr: stdout se descarta, y stderr tiene un maxBuffer amplio para que una suite
// verbosa no se corte con ENOBUFS y pase por roja.
async function ejecutarTests(comando) {
  const cp = await import('node:child_process')
  const r = cp.spawnSync(comando.cmd, comando.args, {
    cwd: raizProyecto,
    encoding: 'utf8',
    timeout: 600000,
    stdio: ['ignore', 'ignore', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status, err: (r.stderr || '').slice(-400) }
}

// Descubre y ejecuta el comando de test, y devuelve el veredicto del gate. Los
// archivos se leen del diff staged (cambios reales), no del auto-reporte: asi la
// exencion docs/config se decide sobre lo que de verdad se toco. En modo
// concurrente ese listado es justo el dato que F1 contamina: sin acotarlo al
// ambito de la task, este gate leeria tambien los ficheros que una hermana dejo
// preparados en el mismo indice compartido.
//
// La preparación y el listado usan el mismo pathspec que la revisión y el commit
// (orq.prepararTask → orq.pathspecDeTask): en secuencial, el proyecto salvo orq.RUTAS_FUERA; en
// concurrente, solo las rutas del ámbito que cambiaron. Sin rutas cambiadas no hay nada que
// preparar ni que listar, y el gate decide sobre la lista vacía.
async function gateTests(task) {
  const ambito = modoParalelo ? await ambitoTask(task) : undefined

  const preparado = await orq.prepararTask(git, ambito)
  if (!preparado.ok) return { estado: 'FALLIDA', infraestructura: true, nota: preparado.error }

  var archivos = []
  if (preparado.pathspec) {
    const listado = await orq.gitVerificado(['diff', '--cached', '--name-only'].concat(preparado.pathspec), git)
    // Sin listado fiable no se puede decidir la exencion de docs/config: una lista vacia por fallo
    // de git eximiria a una task que si toca codigo.
    if (!listado.ok) return { estado: 'FALLIDA', infraestructura: true, nota: listado.error }

    archivos = listado.out
      .split('\n').map(function(s) { return s.trim() }).filter(Boolean)
  }

  const comando = orq.descubrirComandoTest(raizProyecto)
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
//
// Ninguna via de "no se emitio" es muda. Una senal que falta hace que el gate deniegue el commit
// mucho despues y en otro sitio, asi que el motivo tiene que constar aqui, cuando aun se sabe cual
// es. Y las dos situaciones se separan: sin hooks instalados no hay gate que satisfacer (nota
// informativa), mientras que un fallo con los hooks presentes anticipa la denegacion.
async function emitirSenalRevision(diffRevisado) {
  const fs = await import('node:fs')
  const ruta = await resolverEnProyecto('hooks/sdd-review-signal.js')

  if (!fs.existsSync(ruta)) {
    log('Senal de revision omitida: el proyecto no tiene hooks/sdd-review-signal.js instalado, '
      + 'asi que tampoco hay gate de revision que satisfacer.')
    return null
  }

  const aviso = 'Si el gate de revision esta activo, denegara el commit de esta task.'
  try {
    const senal = await cargarModulo('hooks/sdd-review-signal.js')
    const sesion = senal.resolveSessionId()
    if (!sesion) {
      log('Senal de revision NO emitida: la sesion no expone identificador. ' + aviso)
      return null
    }
    const hash = senal.hashDiff(diffRevisado)
    if (!senal.writeSignal(sesion, hash)) {
      log('Senal de revision NO emitida: la senal de la sesion ' + sesion + ' no se pudo escribir. ' + aviso)
      return null
    }
    return hash
  } catch (e) {
    log('Senal de revision NO emitida: ' + e.message + '. ' + aviso)
    return null
  }
}

// ── Fase 1: Descubrimiento ────────────────────────────────────────────────────
phase('Descubrimiento')

const orq = await cargarModulo('.claude/workflows/lib/orquestacion.js')
const raizProyecto = await raizDelProyecto()

// El modo de ejecucion y la ruta de la spec llegan en el mismo argumento.
// --parallel activa, en la Fase 2, la ejecucion concurrente de las tasks de un
// mismo nivel de dependencias; el defecto es una task tras otra. Que garantiza
// ese modo y que no: `recorrerNiveles` en lib/orquestacion.js.
const { modoParalelo, specPath, error: errorArgs } = orq.parsearArgs(args)
if (errorArgs) return { error: errorArgs }

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
`, { agentType: 'asesor', label: 'descubrir-tasks', phase: 'Descubrimiento', schema: DISCOVER_SCHEMA })

const taskList = (discovery && discovery.tasks) ? discovery.tasks : []
if (taskList.length === 0) {
  return { spec: specPath, error: 'No se encontraron tasks para esta spec. Ejecuta /planificar primero.' }
}

// Un ciclo de dependencias, o una dependencia cuyo documento no existe, no pueden
// implementarse: son errores del plan. computeNiveles valida ambos y agrupa las
// tasks en niveles topologicos que el bucle recorre en orden.
var niveles
try {
  niveles = orq.computeNiveles(taskList, raizProyecto)
} catch (e) {
  return { spec: specPath, error: e.message }
}

const contratosRotos = orq.verificarContratos(taskList)
for (var ci = 0; ci < contratosRotos.length; ci++) {
  log('AVISO contrato: ' + contratosRotos[ci])
}

log(taskList.length + ' tasks, ' + niveles.length + ' nivel(es) de dependencia, modo '
  + (modoParalelo ? 'concurrente (--parallel)' : 'secuencial'))
for (var w = 0; w < niveles.length; w++) {
  log('Nivel ' + (w + 1) + ': ' + niveles[w].map(function(t) { return t.titulo }).join(', '))
}

// El árbol tiene que estar limpio fuera de orq.RUTAS_FUERA antes de implementar: en secuencial, el
// `add -A` de la primera task absorberia esos cambios en su commit, y apartar el trabajo de una
// task fallida se los llevaría con él. Quedan fuera los documentos de plan (el guard también los
// exime) y el registro de sesiones, que se reescribe en cada arranque. ai_docs/core/ no: sucio, el
// mensaje propone commitearlo antes de lanzar.
const estadoInicial = await orq.comprobarArbolLimpio(git)
if (!estadoInicial.limpio) {
  return { spec: specPath, error: orq.mensajeArbolSucio(estadoInicial) }
}

// ── Fase 2: Implementacion (con revision por task antes del commit) ───────────
// Las tasks se implementan en orden de dependencias; con `--parallel`, a la vez dentro de cada
// nivel: cada nivel de dependencia antes que el siguiente. Por cada task: el implementador
// deja los cambios en el working tree (no commitea); el workflow revisa ESE diff con un
// agente aparte (contexto limpio);
// si la revision aprueba, emite la senal atada al diff y crea el commit. Asi cada
// unidad se valida antes de avanzar a la siguiente.
phase('Implementacion')

function promptImplementacion(task) {
  const deps = (task.dependencias && task.dependencias.length > 0)
    ? '- Dependencias (ya completadas): ' + task.dependencias.join(', ')
    : '- Esta task es independiente.'

  return '\
Lee ai_docs/dev_templates/implementar.md y sigue su proceso completo para implementar esta task.\n\
Lee de ai_docs/core/ solo las secciones que cite la task o la spec.\n\
\n\
Task a implementar: ' + task.path + '\n\
Spec madre: ' + specPath + '\n\
\n\
CONTEXTO DEL WORKFLOW:\n' + deps + '\n\
- Tus dependencias ya están completadas; con `--parallel`, otras tasks del mismo nivel trabajan a la vez en el mismo árbol: no toques ficheros fuera de tu tabla.\n\
- Escribe SOLO los archivos declarados en la tabla "Archivos afectados" de tu task.\n\
\n\
PROCESO OBLIGATORIO:\n\
1. Lee la task completa y verifica pre-requisitos\n\
2. Investiga el codigo existente\n\
3. Implementa los cambios descritos en la task\n\
4. Escribe tests. Para funcionalidad nueva, RED-GREEN es obligatorio: el test debe FALLAR sin tu cambio\n\
5. Ejecuta los tests dirigidos a tu cambio y, si aplica, linting y build. La suite completa la corre el workflow como gate antes de revisar: no la repitas\n\
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
commit_message, commit_cuerpo, hallazgos fuera de alcance y desviaciones: ficheros que tocaste\n\
fuera de la tabla, contratos que cambiaste y criterios de aceptación que no se cumplen (vacío si no hay).'
}

async function implementarTask(task) {
  return agent(promptImplementacion(task), {
    agentType: 'implementador',
    label: 'impl-' + task.titulo.substring(0, 25),
    phase: 'Implementacion',
    schema: IMPL_SCHEMA
  })
}

// Bloque del prompt de una re-revisión: los hallazgos que se pidió corregir, su corrección
// propuesta y el delta desde la revisión anterior (orq.revisarYComitear lo calcula sobre el
// pathspec de la task). Sin `previa` es la primera revisión y el bloque no existe.
function bloqueRevisionPrevia(previa) {
  if (!previa) return ''
  const lista = function (xs, vacio) { return xs && xs.length ? '- ' + xs.join('\n- ') : vacio }
  return '\
\n\
RE-REVISIÓN (ronda de corrección ' + previa.ronda + '):\n\
Hallazgos críticos que la revisión anterior pidió corregir:\n' + lista(previa.hallazgos_previos, '(ninguno detallado)') + '\n\
Corrección propuesta entonces:\n' + lista(previa.correcciones_propuestas, '(ninguna)') + '\n\
\n\
Delta desde la revisión anterior (lo que cambió la corrección):\n\
```diff\n' + (previa.delta || '(sin cambios)') + '\n```\n\
\n\
- Pronúnciate sobre CADA hallazgo previo en `hallazgos_previos`, con estado `resuelto`, `persistente` o `refutado` (con su motivo en el resumen). Un persistente se repite en problemas_criticos.\n\
- Un hallazgo nuevo fuera del delta solo cuenta si es material (BLOQUEANTE): lo que ya estaba y no señalaste antes no se convierte ahora en crítico por una preferencia.\n'
}

// Bloque del prompt de revisión con la evidencia del workflow: el resultado del gate de tests, que
// es la única suite completa de la task, y las desviaciones que declararon el implementador y los
// correctores.
function bloqueEvidencia(contexto) {
  const c = contexto || {}
  const g = c.gate
  // Solo con comando corrió una suite: sin él (ADVISORY, o sin resultado) no hay suite que no repetir.
  const gate = !g
    ? 'Gate de tests: no consta resultado; no corrió ninguna suite.\n'
    : g.comando
      ? 'Gate de tests del workflow (suite completa, ya ejecutada): `' + g.comando + '` → exit '
        + (g.exitCode == null ? 'sin código' : g.exitCode) + '. ' + (g.nota || '') + '\n'
        + 'No repitas la suite completa: ejecuta solo pruebas dirigidas a una sospecha concreta.\n'
      : 'Gate de tests del workflow: no corrió ninguna suite. ' + (g.nota || g.estado || '') + '\n'
  const desviaciones = (c.desviaciones || []).length
    ? 'Desviaciones declaradas por quien implementó (contrástalas con el diff):\n- ' + c.desviaciones.join('\n- ') + '\n'
    : 'Desviaciones declaradas: ninguna. Si el diff muestra alguna, es un hallazgo.\n'
  return '\n' + gate + desviaciones
}

// Revision adversarial de UNA task: contexto limpio, solo el diff de la task, con la evidencia del
// gate y las desviaciones declaradas. En una re-revisión (`contexto.previa`), además, los
// hallazgos previos y el delta. La postura del revisor la cargan su agente y la plantilla.
async function revisarDiff(task, diff, contexto) {
  return agent('\
Lee ai_docs/dev_templates/revision_adversarial.md y sigue sus pasos, aplicados a UNA task.\n\
Lee la task en: ' + task.path + '\n\
Lee de ai_docs/core/ solo las secciones que cite la task o la spec.\n\
' + bloqueEvidencia(contexto) + '\
\n\
Diff de la task (lo que se va a commitear):\n\
```diff\n' + diff + '\n```\n' + bloqueRevisionPrevia(contexto && contexto.previa) + '\
\n\
Revisa: correccion frente a la task, tests presentes y utiles, edge cases,\n\
regresiones, codigo muerto y seguridad.\n\
En problemas_criticos van solo los hallazgos BLOQUEANTES: son los únicos que abren una ronda de corrección.\n\
Los WARNING van en problemas_menores: no bloquean el commit y viajan en su cuerpo.\n\
Para cada crítico, propón su corrección en correcciones_propuestas.\n\
Emite tu veredicto: APROBADA, NECESITA_CORRECCIONES o RECHAZADA.', {
    agentType: 'revisor',
    label: 'revision-' + task.titulo.substring(0, 20),
    phase: 'Implementacion',
    schema: REVISION_SCHEMA
  })
}

// Una ronda de correccion: recibe solo los criticos de la revision (y su correccion propuesta);
// los menores no bloquean y no se le pasan. Deja los cambios en el working tree; no commitea.
// El workflow vuelve a pasar el gate y re-revisa despues.
async function corregirTask(task, revision) {
  const problemas = revision.problemas_criticos || []
  const propuestas = revision.correcciones_propuestas || []
  return agent('\
La revision adversarial encontro problemas criticos en esta task. Corrigelos en el working tree.\n\
Lee ai_docs/dev_templates/implementar.md para el proceso.\n\
Task: ' + task.path + '\n\
\n\
Problemas criticos a corregir:\n- ' + (problemas.length ? problemas.join('\n- ') : '(ver el resumen de la revision)') + '\n\
Correccion propuesta por la revision:\n- ' + (propuestas.length ? propuestas.join('\n- ') : '(ninguna)') + '\n\
Resumen de la revision: ' + (revision.resumen || '') + '\n\
\n\
REGLAS:\n\
- Corrige SOLO los problemas listados, dentro de los archivos de esta task.\n\
- Deja los cambios en el working tree. NO hagas git add ni git commit.\n\
- Ejecuta los tests dirigidos a tu corrección y asegúrate de que pasan; la suite completa la vuelve a correr el gate.\n\
- Declara en desviaciones lo que la corrección hizo fuera de lo pedido (ficheros, contratos, criterios).\n\
- NO hagas preguntas.', {
    agentType: 'implementador',
    label: 'correccion-' + task.titulo.substring(0, 18),
    phase: 'Implementacion',
    schema: IMPL_SCHEMA
  })
}

// Revisa el diff de la task y, si aprueba, emite la senal atada al diff y commitea.
// El criterio (que diff se revisa, cuando se descarta el trabajo, como se lee cada
// comando de git, y como se acota el ambito del commit en modo concurrente) vive
// en orquestacion.js, donde se prueba con dobles; aqui solo se cablean las piezas
// que hablan con el mundo exterior. El ambito solo se calcula (y se pasa) en modo
// concurrente: en secuencial no hay hermanas que contaminen el indice compartido.
// En cada ronda de correccion el gate de tests se vuelve a pasar antes de re-revisar.
async function revisarYComitear(task, resultado) {
  const ambito = modoParalelo ? await ambitoTask(task) : undefined
  return orq.revisarYComitear(task, resultado, {
    spawnGit: git,
    log: registro,
    revisar: revisarDiff,
    corregir: corregirTask,
    emitirSenal: emitirSenalRevision,
    descartar: apartarTrabajo,
    gateTests: gateTests,
    ambito: ambito,
  })
}

// Ejecuta una task completa: gate de dependencias no completadas, implementacion, gate de
// tests y, si pasa, revision + commit. El gate de tests corre la suite real y lee su
// exit code: rojo bloquea el commit y aparta el trabajo de la task; la falta de
// comando bloquea solo si la task toca codigo. SDD_GUARD_SKIP=1 degrada ese bloqueo a
// aviso (escape puntual para un fallo ajeno a la task), pero nunca el fallo de git.
//
// El orden y las decisiones viven en orquestacion.js, probados con dobles; aqui se
// cablean las piezas con efecto: el agente implementador, el gate que spawnea la
// suite, la revisión + commit y el apartado del trabajo. En secuencial, además, la comprobación
// de árbol limpio antes de cada task: ninguna empieza con el residuo de la anterior.
async function ejecutarTask(task, resultadosPrevios) {
  return orq.ejecutarTask(task, resultadosPrevios, {
    log: registro,
    implementar: implementarTask,
    gateTests: gateTests,
    revisarYComitear: revisarYComitear,
    descartar: apartarTrabajo,
    arbolLimpio: modoParalelo ? undefined : arbolLimpio,
  })
}

// Recorrido topologico: los niveles en orden y, dentro de cada nivel, una task tras
// otra (defecto) o todas a la vez con --parallel. La frontera de lo que el modo
// concurrente garantiza y de lo que deja en manos de quien lo pide esta documentada
// sobre `recorrerNiveles`, en lib/orquestacion.js.
const allResults = await orq.recorrerNiveles(niveles, ejecutarTask, { modoParalelo })

const { completadas, fallidas } = orq.resumirResultados(allResults)
log('Implementacion: ' + completadas + ' completadas, ' + fallidas + ' fallidas de ' + taskList.length)

// ── Fase 3: Convergencia ───────────────────────────────────────────────────────
// El gate primario es la revision POR TASK (ya ejecutada arriba, antes de cada
// commit). Esta fase cierra el hueco que esa revision no cubre: si el conjunto
// final converge con la spec original. Ejecuta el Paso 4bis de
// revision_adversarial.md en modo standalone (sin repetir Pasos 1-3/5, que ya
// se cubrieron por task). Se omite si alguna task quedo FALLIDA/bloqueada: no
// tiene sentido verificar convergencia sobre un resultado incompleto.
// La verificación solo reporta brechas; con alguna BLOQUEANTE, un paso aparte
// con escritura las convierte en tasks (orq.resolverConvergencia lo decide).
phase('Convergencia')

async function verificarConvergencia() {
  return agent('\
Aplica solo el Paso 4bis de ai_docs/dev_templates/revision_adversarial.md en modo\n\
standalone contra la spec ' + specPath + ' y sus tasks.\n\
No repitas Pasos 1-3/5. No toques codigo.\n\
No crees ficheros; reporta. Devuelve cada brecha en `brechas` con:\n\
- `criterio`: la sección o el criterio de la spec afectado;\n\
- `hallazgo`: la brecha y la corrección sugerida;\n\
- `evidencia`: lo que la acredita, con archivo:línea cuando aplique;\n\
- `severidad`: BLOQUEANTE o WARNING.\n\
Sin brechas, `brechas` va vacía. Emite el veredicto.', {
    agentType: 'revisor',
    label: 'convergencia',
    phase: 'Convergencia',
    schema: CONVERGENCIA_SCHEMA
  })
}

// Paso de creación: convierte en tasks las brechas BLOQUEANTES que la verificación reportó.
// La verificación no escribe; este paso sí. Devuelve las rutas creadas, o null si no hubo
// respuesta utilizable: entonces las brechas siguen en el resultado del flujo.
async function crearTasksConvergencia(brechas) {
  const r = await agent('\
La verificación de convergencia de la spec ' + specPath + ' reportó estas brechas BLOQUEANTES:\n\
```json\n' + JSON.stringify(brechas, null, 2) + '\n```\n\
Crea una task de convergencia por cada brecha, como indica la sección «Tasks de convergencia»\n\
del Paso 4bis de ai_docs/dev_templates/revision_adversarial.md, con el formato de\n\
ai_docs/dev_templates/tareas.md. Numera cada una con scripts/next-task-number.sh.\n\
\n\
REGLAS:\n\
- Solo creas ficheros nuevos: no modifiques la spec, las tasks existentes ni el código.\n\
- Si next-task-number.sh no está disponible, no crees nada y explica el motivo en `error`.\n\
- NO hagas preguntas.\n\
Devuelve en `tasks_creadas` la ruta de cada task creada.', {
    agentType: 'planificador',
    label: 'crear-convergencia',
    phase: 'Convergencia',
    schema: CREACION_CONVERGENCIA_SCHEMA
  })
  if (r && r.error) registro('Convergencia: el paso de creación informa: ' + r.error)
  return r && Array.isArray(r.tasks_creadas) ? r.tasks_creadas : null
}

const convergencia = await orq.resolverConvergencia({
  completadas: completadas,
  fallidas: fallidas,
  total: taskList.length,
  verificar: verificarConvergencia,
  crearTasks: crearTasksConvergencia,
  log: registro,
})

return orq.construirResultado({
  spec: specPath,
  spec_titulo: discovery.spec_titulo,
  tasks_total: taskList.length,
  niveles: niveles.length,
  completadas: completadas,
  fallidas: fallidas,
  implementaciones: allResults,
  convergencia: convergencia,
})

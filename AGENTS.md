# SDD (Spec-Driven Development) — Framework de Desarrollo

> Contexto compartido por los agentes de codigo que leen `AGENTS.md`.
> Flujo basado en especificaciones: se planifica exhaustivamente, se implementa
> por partes acotadas y se revisa el codigo antes de entregarlo.

## Flujo SDD

```
1. Solicitud     — El usuario describe lo que quiere
2. Planificacion — analisis previo + spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion    — El usuario revisa el plan completo y aprueba o pide cambios
4. Implementacion— Se implementa la tarea seleccionada + revision adversarial del codigo
5. Entrega       — Commit y Pull Request
```

No se escribe codigo sin spec aprobada y sin task que declare el archivo que se toca.

## Como se invoca cada paso

Cada paso del flujo es una **skill** en `.agents/skills/<nombre>/SKILL.md`. Las skills se
auto-activan por su `description`: basta con describir lo que quieres ("planifica el login",
"implementa la spec de pagos", "revisa la implementacion") para que la skill correspondiente
entre. Tambien puedes nombrarla explicitamente.

| Skill | Paso | Que hace |
|-------|------|----------|
| `inicio` | — | Bootstrap de `ai_docs/core/`: genera los 4 documentos fundamentales del proyecto (paso previo, opcional) |
| `planificar` | 2 | Ciclo completo: analisis previo + spec + tasks + revision + auditoria |
| `spec` | — | Crea una spec individual (paso aislado) |
| `tareas` | — | Deriva tasks de una spec aprobada (paso aislado) |
| `auditar` | — | Audita coherencia entre spec y tasks (paso aislado) |
| `implementar-spec` | 4 | Implementa las tasks de una spec + revision adversarial |
| `implementar` | 4 | Implementa UNA task individual (control manual) |
| `revision` | 5 | Revision adversarial post-implementacion (paso aislado) |
| `revision-adversarial` | — | Revisión escéptica a mano del código implementado fuera de `implementar-spec`, que ya revisa cada task |
| `revisar-tarea` | 2 | Revision de un documento de task antes de implementarlo |
| `estado` | — | Estado del proyecto: specs, tasks, progreso |
| `asesor` | — | Analiza un problema, evalua opciones y recomienda |
| `bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `cleanup` | — | Revision de calidad: codigo muerto, tipos, seguridad |
| `testing` | — | Escritura de tests |
| `configurar-tests` | — | Prepara la infraestructura de tests cuando falta |
| `diff` | — | Resumen legible de los cambios pendientes |
| `commit` | — | Crea un commit limpio con mensaje descriptivo |
| `pr` | — | Crea o revisa una Pull Request |

## Matriz de intención y enrutado

| Intención | Destino | Tipo | Modo |
|-----------|---------|------|------|
| Conversar, leer, orientar o mostrar estado | `asesor`, `estado` | skill | automático |
| Planificar | `planificar`, `spec`, `tareas`, `auditar`, `revisar-tarea` | skill | automático |
| Implementar | `implementar-spec`, `implementar`, `testing`, `configurar-tests`, `cleanup`, `revision`, `revision-adversarial` | skill | automático |
| Corregir un bug | `bugfix` | skill | automático |
| Revisar cambios o preparar entrega | `diff`, `commit`, `pr` | skill | automático |
| Iniciar un proyecto | `inicio` | skill | automático |
| Auditar una sesión | `auditar-sesion` | skill | manual: se invoca para revisar una sesión cerrada |
| Analizar, planificar, implementar o revisar | `asesor`, `planificador`, `implementador`, `revisor` | agente | automático |

## Sesión independiente recomendada

Tras aprobar un plan, recomienda iniciar otra sesión y pedir `implementa la tarea <ruta de la tarea>`. Si el usuario pidió planificar e implementar en la misma petición, el primer mensaje posterior empieza con esta recomendación antes de implementar y continúa sin pedir otra aprobación.

## Agentes

| Agente | Rol | Cuando se activa |
|--------|-----|-----------------|
| `planificador` | Crea specs, deriva tasks | Pasos 1-2 |
| `revisor` | Revisa tasks y hace revision adversarial (esceptico) | Pasos 2, 5 |
| `implementador` | Ejecuta UNA task individual (codigo + tests) | Paso 4 |
| `asesor` | Analiza problemas, evalua opciones, recomienda | Cualquier momento |

Definidos en `.codex/agents/*.toml` (Codex) y en `.agents/plugins/sdd/agents/*.md` (Antigravity
CLI). El asesor corre en modo solo lectura; los demas pueden escribir dentro del espacio de
trabajo.

## Delegación y esperas (solo Codex)

Solo para Codex; nombres de herramienta verificados en codex-cli 0.162.1.

- Un subagente se lanza con `spawn_agent` y su parámetro `agent_type`. Que `agent_type` sea el
  `name` de `.codex/agents/<rol>.toml` no está verificado.
- Cada subagente lanzado se espera una vez con `wait_agent` (en v1, la estable, recibe `targets`; en
  `multi_agent_v2` solo acepta `timeout_ms`); no se sondea su estado.
- Cada ronda usa un `revisor` nuevo. Los comandos que terminan solos se ejecutan una vez, sin sondeo.

## Estructura de archivos

```
proyecto/
├── .codex/
│   ├── agents/         # planificador, revisor, implementador, asesor (*.toml)
│   ├── config.toml     # modelo por defecto
│   ├── hooks.json      # 3 hooks (pipeline-guard-codex + commit-guard-codex + session-start)
│   └── rules/          # sdd-enforcement.rules (refuerzo de politica de ejecucion)
├── .agents/
│   ├── skills/         # 19 skills (auto-activacion)
│   ├── plugins/sdd/    # agentes (asesor, implementador, planificador, revisor) + manifiesto del bundle
│   └── hooks.json      # 4 hooks (pipeline-guard + commit-guard + read-before-edit + turn-budget)
├── hooks/              # hooks compartidos por los dos backends (variantes -codex incluidas)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap y decisiones
│   ├── core_templates/ # 5 plantillas de planificacion inicial y decisiones (01-05)
│   ├── doc_templates/  # plantillas de documentacion de proyecto
│   ├── dev_templates/  # 13 plantillas SSOT
│   ├── tasks/          # specs + tasks (NNN_descriptor.md)
│   └── refs/           # documentacion externa
├── docs/               # extension-config-schema.md: la configuracion propia del proyecto
└── AGENTS.md           # este archivo
```

## Specs y Tasks

Specs: `ai_docs/tasks/spec_<descriptor>.md`. Estado: BORRADOR → APROBADA.
Tasks: `ai_docs/tasks/NNN_descriptor.md`. Cada task referencia su spec madre.
Formato en `ai_docs/dev_templates/spec.md` y `ai_docs/dev_templates/tareas.md`.

Cada task declara ademas sus archivos en la tabla "Archivos afectados"
(`| ruta | CREAR/MODIFICAR/ELIMINAR | descripcion |`).

Las plantillas operativas de `ai_docs/dev_templates/` son la fuente unica de cada proceso: las
skills y los agentes las siguen paso a paso, no las reescriben. `ai_docs/dev_templates/actualizar_framework.md`
documenta como traer los cambios del framework a un proyecto ya instalado, sin tocar tus specs ni tus tasks.

## Plantillas de referencia

| Plantilla | Proposito |
|-----------|-----------|
| `spec.md` | Formato de specs |
| `tareas.md` | Derivacion de tasks |
| `revisar_tarea.md` | Revision pre-implementacion |
| `auditar_spec.md` | Auditoria spec + tasks |
| `implementar.md` | Implementacion con TDD |
| `revision_adversarial.md` | Revision adversarial post-impl |
| `correccion_de_bugs.md` | Diagnostico y correccion |
| `limpieza_de_codigo.md` | Revision de calidad |
| `testing_basico.md` | Escritura de tests |
| `hacer_commit.md` | Proceso de commit |
| `revision_pr.md` | Creacion de PRs |
| `resolver_problema.md` | Analisis de problemas y recomendaciones |
| `actualizar_framework.md` | Actualizar un proyecto ya instalado a una version mas reciente |

## Reglas clave

1. **Planificación exhaustiva** — cada task revisada, spec auditada, huecos detectados ANTES de código.
2. **El orden de dependencias manda** — en cada sesión, elige una sola task con dependencias satisfechas. Puede usar paralelismo interno, pero no ejecuta múltiples tasks. Revisión adversarial antes de cada commit.
3. **Revisión adversarial obligatoria** — el paso 5 verifica la implementación completa antes de mergear.
4. **Roadmap global** — el plan de trabajo vive en `ai_docs/core/` y guía cada planificación.
5. **El revisor es escéptico y bloquea solo lo material** — su trabajo es encontrar problemas, validar con evidencia.

## Contrato conversacional
### Siguiente paso recomendado
Tras una consulta, orientación, plan, implementación, entrega o revisión, cierra la respuesta con un único siguiente paso recomendado y accionable. La respuesta no crea planificación salvo que la intención sea planificar.
### Sesión independiente recomendada
Tras planificar, recomienda siempre implementar en una sesión nueva e independiente con la orden del backend. Es una recomendación, no un bloqueo. Si la petición ya incluía planificar e implementar, el primer mensaje después del plan aprobado empieza con la recomendación, antes de iniciar la implementación, y continúa sin otra aprobación.
### Degradación sin subagentes
Si el backend no acredita subagentes o fan-out, ejecuta en serie las unidades que otro backend haría en paralelo. Declara esa degradación en la respuesta y no anuncia subagentes.

## Retomar una task
| Estado | Continúa | Antes de seguir |
|---|---|---|
| `PENDIENTE` | implementador | Releer la task. |
| `EN_PROGRESO` | implementador | Releer archivos afectados, `git status` y `git log -1`. |
| `PARCIAL` | implementador | Releer desviaciones, archivos afectados, estado y último commit. |
| `FALLIDA` | implementador con `correccion_de_bugs.md` | Leer la salida del fallo. |
| `BLOQUEADA_REVISION` | usuario | Resolver hallazgos abiertos. |
| `COMPLETADA` | nadie | Un cambio nuevo requiere una task nueva. |

## Cuándo despachar
- Investigación: despacha solo si la lectura excede el contexto o hay áreas disjuntas; lee directamente una a tres rutas conocidas.
- Lentes `ciego`, `casos-limite` y `coste`: despacha solo ante una incertidumbre concreta, nunca «por si acaso».
## Evidencia proporcional al riesgo
- Prosa: inspección y referencias; código local: prueba dirigida y negativo; contrato o hook: positivos, negativos, composición y recuperación. Valida cada instrumento cuando debe disparar y cuando debe permanecer silencioso.
## Recepción de resultados
- Antes de usar un resultado de subagente, comprueba presencia, legibilidad, completitud y schema. Un resultado ausente, truncado o intermedio no es una entrega.
## Releer antes de reintentar
- Lee antes de editar. Tras un rechazo, relee el estado real antes de repetir; busca con `git grep` o la herramienta de búsqueda disponible.

## Enforcement mecanico y su limite

| Hook | Momento | Que hace |
|------|---------|----------|
| `hooks/sdd-pipeline-guard-codex.js` | Antes de aplicar un parche | **Deniega** escribir un archivo que ninguna task de una spec APROBADA declara |
| `hooks/sdd-commit-guard-codex.js` | Antes de ejecutar un comando | **Deniega** `git commit --no-verify` y `git push --no-verify`; avisa de commits mal formados |
| `hooks/sdd-session-start.js` | Al arrancar la sesion | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`) con directorio de trabajo, rama, commit, el modelo de la sesión si el CLI lo envía en el arranque (si no, `null`) y hashes de los componentes instalados |

Registrados en `.codex/hooks.json`. Refuerzo adicional: la regla de politica de ejecucion
`.codex/rules/sdd-enforcement.rules` prohibe los mismos comandos de bypass; cada regla da su motivo
en `justification` (un parámetro que `prefix_rule` no reconoce impide arrancar Codex).

**El registro de sesiones se apaga con una clave.** `sdd-session-start.js` viene activo y escribe
una linea por arranque de sesion en un fichero dentro de tu repositorio. Para que deje de escribir:
`sdd_session_start.enabled: false` en `hooks/config.json`; con `false` no escribe nada, ni la linea
ni el fichero. Para cambiar el destino o anadir campos propios sin tocar ficheros que la
actualizacion sobreescribe: `docs/extension-config-schema.md`.

**Limite honesto:** los hooks de este entorno son un **guardarrail**, no una frontera completa de
enforcement. El propio fabricante lo declara: no interceptan todas las llamadas al shell ni todas
las rutas de escritura, y un proceso hijo lanzado desde un comando permitido puede escapar al
matcher. Sirven para que el camino correcto sea el camino por defecto y para que desviarse sea
deliberado; no sustituyen a la revision humana ni a los controles del repositorio (protecciones de
rama, CI). Si necesitas una frontera dura, ponla en CI. El commit sin revision no esta entre esos
bloqueos: aqui lo sostiene la disciplina, no un hook.

**El gate de revision por task.** Antes de commitear cada task hay un punto cuyo veredicto se
necesita para continuar: la revision adversarial de esa task. El hook `sdd-review-gate.js` existe
en el repositorio, pero se cablea solo en el backend de Claude Code: la senal que lo silencia la
emite su motor de workflows, que estos backends no tienen. En planificacion el gate equivalente es
la auditoria cruzada.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada los bloqueos a aviso. Es para desbloquear una
situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline no enforcea nada.

## Antigravity CLI (`agy`)

Antigravity carga contexto y skills desde `.agents/`, subagentes desde `.agents/plugins/sdd/agents/` y hooks desde `.agents/hooks.json`. Comprueba el bundle con `agy plugin validate .agents/plugins/sdd`.

**Hooks.** `.agents/hooks.json` registra cuatro hooks `PreToolUse`, con las mismas reglas y el mismo
codigo que los demas backends (`hooks/sdd-pipeline-guard.js`, `hooks/sdd-commit-guard.js`,
`hooks/sdd-read-before-edit.js` y `hooks/sdd-turn-budget.js`):

| Matcher | Hook | Que hace |
|---------|------|----------|
| `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `create_file` | `sdd-pipeline-guard.js` | **Deniega** escribir un archivo que ninguna task de una spec APROBADA declara |
| `run_command` | `sdd-commit-guard.js` | Avisa de commits mal formados y de fugas de andamiaje |
| `read_file`, `view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `create_file` | `sdd-read-before-edit.js` | Avisa al escribir un archivo existente sin haberlo leido antes. Rastrea las lecturas via `read_file`/`view_file`; si esta CLI no dispara ese evento, se autolimita a silencio |
| `read_file`, `view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `create_file`, `run_command` | `sdd-turn-budget.js` | Cuenta las acciones sin commit y avisa al superar cada umbral. `git commit` resetea el contador. Si la CLI no expone `session_id`, se autolimita a silencio |

El registro de sesiones (`hooks/sdd-session-start.js`) **no se cablea aqui**: no consta que esta CLI
exponga un evento de arranque de sesion equivalente, y cablearlo daria un hook que nunca corre. En
este backend, por tanto, ninguna sesion escribe la linea de registro.

Dos detalles del contrato de esta CLI, distintos de los otros backends:

- El comando de cada hook se ejecuta **desde el directorio que contiene `hooks.json`** (`.agents/`).
  Por eso las rutas son `node ../hooks/...`.
- La decision viaja **solo** en el JSON de stdout (`{"decision": "...", "reason": "..."}`) y los
  valores admitidos son `allow`, `deny`, `ask` y `force_ask`. El bloqueo (`deny`) es real, no un
  aviso. Como no hay `warn`, un aviso se expresa como `allow` con motivo.

**Comandos.** Este backend no instala `commands/`: el manifiesto de instalacion solo copia `.agents/`
y `AGENTS.md`. No hace falta, porque las skills nativas de `.agents/skills/` cubren ya el mismo flujo
que esos `.toml`.

**Verificado contra `agy` 1.1.1.** La CLI esta en desarrollo activo: si una version posterior
cambia los formatos, esta seccion es lo primero que hay que revisar. Un hueco conocido: no se pudo
capturar en vivo el payload de una escritura real (hace falta iniciar sesion de forma interactiva),
asi que los matchers salen de los nombres de herramienta que documenta la propia CLI. Si una
escritura no declarada llega a colarse, lo primero que hay que comprobar es si el nombre de la
herramienta que llega al hook coincide con los del matcher.

## Modelo por defecto

Ningun modelo esta impuesto por el framework: el modelo es tuyo y depende de tu cuenta y tu
presupuesto.

- **Codex:** `.codex/config.toml` trae `model = "gpt-5.5"`, que figura en el catálogo de codex-cli
  0.162.1. El catálogo cambia con cada versión: `codex debug models` lista los modelos que reconoce
  la tuya. Sube el modelo si la planificación se te queda corta y bájalo para el trabajo mecánico.
- **Antigravity:** la CLI usa el modelo que tengas seleccionado; el framework no lo fija.

## Estilo

- Idioma del proyecto: espanol. La prosa nueva se escribe con ortografia correcta, acentos incluidos. El corpus antiguo esta sin acentuar y se corrige a medida que se toca cada fichero
- Nombres de archivos y de ramas: solo ASCII, sin acentos. Los ficheros, ademas, en snake_case y descriptivos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore)

- Nada de adular ni de rellenar; sin coautoria de IA en el mensaje.

## Coste de la verificación

Un test, un hook o un job de CI se decide por riesgo y por coste: en qué punto del ciclo corre, quién espera y cuánto cuesta medido, no supuesto. Va en el punto más barato que aún atrapa el riesgo; el mismo check dos veces se paga dos veces. Ese cálculo mueve o acota una verificación, nunca deja un riesgo sin cubrir.

## Operativa y esperas

- Informes y respuestas finales: el veredicto primero, sin narrar el proceso seguido.
- Salida filtrada en origen con las opciones del propio comando (formato, límite, `--stat`), no recortada después.
- Texto con comillas, multilínea o código va a un fichero temporal fuera del árbol de trabajo y se pasa por ruta absoluta literal, sin variables (`git commit -F <fichero>`), no citado en la orden; quien crea el fichero lo retira al terminar.
- Un comando que termina solo: una llamada con timeout si tu herramienta lo admite. Uno largo (CI, despliegue, servidor): el mecanismo de segundo plano del backend, si figura en tus herramientas. Nunca bucles `sleep`/`until` ni `tail -f`.
- Todo proceso propio se detiene antes de cerrar; nunca uno ajeno.

## Dónde va cada cosa

| Dónde | Qué guarda |
|-------|------------|
| Instrucciones raíz (este fichero) | Reglas y convenciones del proyecto |
| `ai_docs/core/` | Decisiones que condicionan trabajo futuro, con su porqué |
| Task doc | Alcance de una task: qué cambia y cómo se valida |
| Memoria del agente | Solo lo no derivable del código ni de los documentos |

## Limites del framework

- Planificacion completa (spec + tasks + revision + auditoria) antes de implementar
- Las tasks se derivan solo de specs con estado APROBADA
- Revision adversarial (paso 5) antes de mergear
- El alcance de cada task se revisa por riesgo, datos y contratos; no hay un máximo fijo de ficheros
- Evaluar alternativas antes de decidir la solucion

<!-- sdd-framework: 4.0.0 -->

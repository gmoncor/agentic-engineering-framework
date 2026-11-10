# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo basado en especificaciones. Planifica antes de implementar.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — WORKFLOW: spec + tasks + revision paralela + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar       — Implementa una task aprobada + revisión adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificación exhaustiva.** `/planificar` revisa y audita el plan. `/implementar` implementa una task por sesión; la investigación y la revisión interna pueden usar subagentes cuando el alcance lo justifica.

## Sesión independiente recomendada

Tras el plan, recomienda otra sesión con `/implementar <ruta de la tarea>`.

Un aviso intermedio de subagente que indica que sigue esperando no es una entrega.

## Comandos disponibles

| Comando | Paso | Que hace |
|---------|------|----------|
| `/inicio` | — | Bootstrap de `ai_docs/core/`: genera los 4 documentos fundamentales del proyecto (paso previo, opcional) |
| `/planificar` | 2 | **Workflow completo**: spec + tasks + revision paralela + auditoria. Detecta multi-spec |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar-spec` | 4 | Selecciona una task con dependencias satisfechas + revision antes del commit |
| `/implementar` | 4 | Implementa UNA task individual (control manual) |
| `/revision` | 5 | Revision adversarial post-implementacion (paso aislado) |
| `/estado` | — | Muestra estado del proyecto (specs, tasks, progreso) |
| `/bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `/commit` | — | Crea un commit limpio con mensaje descriptivo |
| `/pr` | — | Crea o revisa una Pull Request |
| `/asesor` | — | Analiza un problema y recomienda la mejor solucion |

## Agentes

| Agente | Rol | Cuando se activa |
|--------|-----|-----------------|
| `planificador` | Crea specs, deriva tasks | Pasos 1-2 |
| `revisor` | Revisa tasks y hace revision adversarial (esceptico) | Pasos 2, 5 |
| `implementador` | Ejecuta UNA task individual (codigo + tests) | Paso 4 |
| `asesor` | Analiza problemas, evalua opciones, recomienda | Cualquier momento |

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

## Estructura de archivos

```
proyecto/
├── .claude/
│   ├── agents/         # planificador, revisor, implementador, asesor
│   ├── commands/       # 13 comandos SDD
│   ├── skills/         # 9 skills (auto-activacion; auditar-sesion es exclusiva de este backend)
│   ├── workflows/      # planificar.js + implementar-spec.js + lib/ (orquestacion)
│   └── settings.json   # modelo de sesión sugerido + hooks
├── hooks/              # 6 hooks (pipeline-guard + review-gate + commit-guard + read-before-edit + turn-budget + session-start)
├── scripts/            # next-task-number.sh (numeracion de tasks sin colisiones)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap
│   ├── core_templates/ # 4 plantillas de planificacion inicial (01-04)
│   ├── dev_templates/  # 13 plantillas SSOT
│   ├── tasks/          # specs + tasks (NNN_descriptor.md)
│   └── refs/           # documentacion externa
├── docs/               # extension-config-schema.md: la configuracion propia del proyecto
└── CLAUDE.md           # este archivo
```

## Specs y Tasks

Specs: `ai_docs/tasks/spec_<descriptor>.md`. Estado: BORRADOR → APROBADA.
Tasks: `ai_docs/tasks/NNN_descriptor.md`. Cada task referencia su spec madre.
Formato en `ai_docs/dev_templates/spec.md` y `ai_docs/dev_templates/tareas.md`.

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

## Modelo por defecto

El modelo de la sesión lo fija la clave `model` de `.claude/settings.json`. Es un default **sugerido**: ningún modelo lo impone el framework, y lo ajustas a tu presupuesto (`/model` para un cambio puntual, o edita `settings.json`).

El modelo de cada rol lo fija el campo `model` del frontmatter de su agente en `.claude/agents/`; `inherit` toma el de la sesión. Los workflows `/planificar` y `/implementar-spec` despachan cada paso con su agente (`agentType`): intake y descubrimiento con `asesor`; spec, tasks, su corrección y las tasks de convergencia con `planificador`; implementación y corrección con `implementador`; revisiones, auditoría y verificación de convergencia con `revisor`. Cada paso corre así con el modelo y las herramientas de su rol. Para cambiar el modelo de un rol, edita el frontmatter de su agente: el workflow no guarda otra copia.

Ver tambien "Ahorro de tokens" en README.md.

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea | Modo |
|------|--------|-------------|------|
| `sdd-pipeline-guard.js` | Write/Edit | **Bloquea** escribir un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-review-gate.js` | Bash (git commit/merge) | **Bloquea** un `git commit`/`merge` cuyo diff no consta revisado: la revision adversarial por task emite una senal con el hash del diff, y el hook la contrasta con `git diff --cached`. Sin senal o con hash que no ata, deniega | Bloqueante (opt-in) |
| `sdd-commit-guard.js` | Bash (git commit/push) | **Bloquea** `--no-verify` (y el alias corto `-n` en commit); warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Bloqueante en `--no-verify`, advisory en el resto |
| `sdd-read-before-edit.js` | Read/Write/Edit | Warn al escribir un archivo existente sin haberlo leido antes en la sesion (rastrea las lecturas en un fichero por sesion). Nunca bloquea; se autolimita a silencio en backends que no exponen el evento de lectura | Advisory |
| `sdd-turn-budget.js` | Todas las tool calls | Cuenta las acciones sin commit de cada agente por separado (hilo principal y cada subagente) y avisa al superar cada umbral (warn/block/hard_stop). `git commit` resetea el contador de quien lo hace. En advisory, HARD_STOP propone al usuario un checkpoint; a un subagente nunca le pide commitear: el commit lo hace quien coordina. Configurable (umbrales + `mode`); `mode: enforce` convierte block/hard_stop en bloqueo | Advisory (default) |
| `sdd-session-start.js` | SessionStart | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`) con directorio de trabajo, rama, commit, el modelo de la sesión si el CLI lo envía en el arranque (si no, `null`) y hashes de los componentes instalados | Registro (activo por defecto) |

Configurados en `.claude/settings.json`. `sdd-review-gate.js` se activa poniendo `sdd_review_gate.enabled: true` en `hooks/config.json`.

**El registro de sesiones se apaga con una clave.** `sdd-session-start.js` viene activo y escribe una linea por arranque de sesion en un fichero dentro de tu repositorio. Para que deje de escribir: `sdd_session_start.enabled: false` en `hooks/config.json`; con `false` no escribe nada, ni la linea ni el fichero. Para cambiar el destino o anadir campos propios sin tocar ficheros que la actualizacion sobreescribe: `docs/extension-config-schema.md`.

**Hay dos bloqueos reales: escrituras y commits sin revision.** El de escrituras (pipeline-guard) impide escribir codigo no declarado en una task con las herramientas de edición (`Write`, `Edit`, `NotebookEdit`); no ve lo que se escribe por shell (`>`, `tee`, `sed -i`, `cp`), que solo detecta la revisión del diff. El de commits (review-gate) impide commitear un diff que no consta revisado: puede bloquear con honestidad porque la revision adversarial ocurre POR TASK, antes del commit, y su senal guarda el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin diff cacheado computable el gate no bloquea a ciegas: degrada a aviso. Una frontera aun mas dura sobre lo que se entrega va en CI y en las protecciones de rama.

**El bloqueo de commits solo existe en este backend** (Claude Code): su senal la emite el motor de workflows, que los demas backends no tienen. Donde no hay emisor no se cablea, porque no habria via legitima de satisfacer el gate.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada ambos bloqueos a aviso. Es para desbloquear una situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline SDD no enforcea nada.

Contrato de la senal de revision (emisor `/implementar-spec`, consumidor `sdd-review-gate.js`): `hooks/sdd-review-signal.js`. El hash ata la senal al diff de la task revisada. Tests de contrato: `npm test`.

## Estilo

- Idioma del proyecto: espanol. La prosa nueva se escribe con ortografia correcta, acentos incluidos. El corpus antiguo esta sin acentuar y se corrige a medida que se toca cada fichero
- Nombres de archivos y de ramas: solo ASCII, sin acentos. Los ficheros, ademas, en snake_case y descriptivos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore)

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

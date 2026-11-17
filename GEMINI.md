# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo basado en especificaciones. Planificacion exhaustiva antes de implementar. El orden de dependencias manda, dentro de cada spec.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — Spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar       — Implementa una task aprobada + revisión adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificación exhaustiva.** `/planificar` ejecuta el ciclo completo. `/implementar` implementa una task por sesión, con revisión adversarial antes del commit.

## Sesión independiente recomendada

Tras aprobar un plan, recomienda iniciar otra sesión y escribir `implementa la tarea <ruta de la tarea>`. Si el usuario pidió planificar e implementar en la misma petición, el primer mensaje posterior empieza con esta recomendación antes de implementar y continúa sin pedir otra aprobación.

## Ejecución sin subagentes

Este backend no acredita subagentes ni fan-out. Ejecuta en serie las unidades que otro backend haría en paralelo, lo declara en la respuesta y no anuncia subagentes.

## Comandos disponibles

| Comando | Paso | Que hace |
|---------|------|----------|
| `/inicio` | — | Bootstrap de `ai_docs/core/`: genera los 4 documentos fundamentales del proyecto (paso previo, opcional) |
| `/planificar` | 2 | **Ciclo completo**: spec + tasks + revision + auditoria. Detecta multi-spec |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar-spec` | 4 | Selecciona una sola task con dependencias satisfechas; permite paralelismo interno + revision por task antes del commit |
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

## Ejecucion en este backend

- **Aqui no hay flag.** Sin motor de workflows que parsee argumentos: la peticion es en lenguaje
  natural y la atiende el orquestador. Un flag visto en la documentacion general pertenece a otro
  backend.

## Estructura de archivos

```
proyecto/
├── .gemini/
│   ├── agents/          # planificador, revisor, implementador, asesor
│   ├── commands/        # 13 comandos SDD (.toml)
│   └── skills/          # 9 skills (auto-activacion)
├── hooks/              # 5 hooks (pipeline-guard + commit-guard + read-before-edit + turn-budget + session-start)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap y decisiones
│   ├── core_templates/ # 5 plantillas de planificacion inicial y decisiones (01-05)
│   ├── doc_templates/  # plantillas de documentacion de proyecto
│   ├── dev_templates/  # 13 plantillas SSOT
│   ├── tasks/          # specs + tasks (NNN_descriptor.md)
│   └── refs/           # documentacion externa
├── docs/               # extension-config-schema.md: la configuracion propia del proyecto
├── GEMINI.md           # este archivo
└── gemini-extension.json
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

Los 4 agentes (`asesor`, `implementador`, `planificador`, `revisor`) fijan `model: gemini-2.5-pro` en su frontmatter — a diferencia de Claude, aqui no se diferencia por rol, los 4 comparten el mismo modelo. Para cambiarlo, edita el campo `model:` en el archivo del agente correspondiente (`.gemini/agents/<nombre>.md`).

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea | Modo |
|------|--------|-------------|------|
| `sdd-pipeline-guard.js` | write_file/replace | **Bloquea** escribir un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-commit-guard.js` | run_shell_command (git commit/push) | **Bloquea** `--no-verify`; warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Bloqueante en `--no-verify`, advisory en el resto |
| `sdd-read-before-edit.js` | write_file/replace | Warn al escribir un archivo existente sin haberlo leido antes en la sesion. Se autolimita a silencio en backends que no exponen el evento de lectura | Advisory |
| `sdd-turn-budget.js` | Todas las tool calls | Cuenta las acciones sin commit y avisa al superar cada umbral (warn/block/hard_stop). `git commit` resetea el contador | Advisory (default) |
| `sdd-session-start.js` | SessionStart | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`) con directorio de trabajo, rama, commit, el modelo de la sesión si el CLI lo envía en el arranque (si no, `null`) y hashes de los componentes instalados | Registro (activo por defecto) |

Configurados en `hooks/hooks.json`. La columna Evento usa los nombres reales de las herramientas de Gemini CLI (`write_file`, `replace`, `run_shell_command`). Cada hook se lanza desde la raíz del proyecto aunque Gemini arranque en un subdirectorio: el lanzador sube hasta el primer directorio con `.git` o `hooks/hooks.json` y ejecuta el hook de ahí, así que `hooks/` tiene que estar copiado en la raíz (también si instalas la extensión).

**Aviso de skills duplicadas con `--backend all`.** Si instalas todos los backends, Gemini lee las skills de `.agents/skills` y de `.gemini/skills` e informa `Skill conflict detected: "<skill>" ... is overriding ...`. Es inocuo: las dos copias salen de la misma fuente. Para evitarlo, instala solo el backend que usas (`--backend gemini`).

**El registro de sesiones se apaga con una clave.** `sdd-session-start.js` viene activo y escribe una linea por arranque de sesion en un fichero dentro de tu repositorio. Para que deje de escribir: `sdd_session_start.enabled: false` en `hooks/config.json`; con `false` no escribe nada, ni la linea ni el fichero. Para cambiar el destino o anadir campos propios sin tocar ficheros que la actualizacion sobreescribe: `docs/extension-config-schema.md`.

**Aqui no hay aviso de revision del codigo.** El hook `sdd-review-gate.js` existe en el repositorio, pero se cablea solo en el backend de Claude Code: la senal que lo silencia la emite su motor de workflows, que este backend no tiene. Cablearlo aqui daria un aviso permanente sin ninguna via legitima de atenderlo. La revision adversarial posterior a la implementacion sigue siendo obligatoria en el flujo (`/revision`), pero aqui la sostiene la disciplina, no un hook.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada el bloqueo de escrituras a aviso. Es para desbloquear una situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline SDD no enforcea nada.

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

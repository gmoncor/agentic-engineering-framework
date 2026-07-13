# SDD (Spec-Driven Development) — Framework de Desarrollo

> Contexto compartido por los agentes de codigo que leen `AGENTS.md`.
> Flujo basado en especificaciones: se planifica exhaustivamente, se implementa
> por partes acotadas y se revisa el codigo antes de entregarlo.

## Flujo SDD

```
1. Solicitud     — El usuario describe lo que quiere
2. Planificacion — analisis previo + spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion    — El usuario revisa el plan completo y aprueba o pide cambios
4. Implementacion— Se implementan las tasks de la spec + revision adversarial del codigo
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
| `planificar` | 2 | Ciclo completo: analisis previo + spec + tasks + revision + auditoria |
| `spec` | — | Crea una spec individual (paso aislado) |
| `tareas` | — | Deriva tasks de una spec aprobada (paso aislado) |
| `auditar` | — | Audita coherencia entre spec y tasks (paso aislado) |
| `implementar-spec` | 4 | Implementa las tasks de una spec + revision adversarial |
| `implementar` | 4 | Implementa UNA task individual (control manual) |
| `revision` | 5 | Revision adversarial post-implementacion (paso aislado) |
| `revision-adversarial` | 5 | Revision esceptica del codigo entregado |
| `revisar-tarea` | 2 | Revision de un documento de task antes de implementarlo |
| `estado` | — | Estado del proyecto: specs, tasks, progreso |
| `asesor` | — | Analiza un problema, evalua opciones y recomienda |
| `bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `cleanup` | — | Revision de calidad: codigo muerto, tipos, seguridad |
| `testing` | — | Escritura de tests |
| `diff` | — | Resumen legible de los cambios pendientes |
| `commit` | — | Crea un commit limpio con mensaje descriptivo |
| `pr` | — | Crea o revisa una Pull Request |

## Agentes

| Agente | Rol | Cuando se activa |
|--------|-----|------------------|
| `planificador` | Crea specs, deriva tasks | Paso 2 |
| `revisor` | Revisa tasks y hace revision adversarial (esceptico) | Pasos 2 y 5 |
| `implementador` | Ejecuta UNA task (codigo + tests + commit) | Paso 4 |
| `asesor` | Analiza problemas, evalua opciones, recomienda (solo lectura) | Cualquier momento |

Definidos en `.codex/agents/*.toml`. El asesor corre en modo solo lectura; los demas pueden
escribir dentro del espacio de trabajo.

## Orquestacion: fan-out no bloqueante + un gate bloqueante

Este framework NO tiene motor de workflows declarativo: la secuenciacion depende de como el
orquestador escribe sus llamadas. El principio que si funciona:

1. **Fan-out no bloqueante.** Reparte el trabajo independiente entre varios subagentes y sigue
   sin consumir sus resultados intermedios. Dos tasks solo pueden ir a la vez si sus tablas
   "Archivos afectados" son **disjuntas**; si comparten un archivo, se serializan. Lo que hace
   seguro el paralelismo es la particion por dueno de archivo, no el aislamiento del proceso.
2. **Un unico gate bloqueante.** Antes de avanzar de fase (aprobar el plan, entregar el codigo)
   hay UN punto cuyo veredicto se necesita para continuar: la auditoria cruzada en planificacion,
   la revision adversarial en implementacion. Ahi se espera; en el resto, no.

No escribas instrucciones del tipo "lanza N agentes en la misma respuesta": es una prescripcion
que no se ejecuta en la practica y crea la ilusion de paralelismo sin darlo. Describe la
dependencia real (que necesita el resultado de que) y deja que el orquestador la respete.

## Specs y tasks

- Specs: `ai_docs/tasks/spec_<descriptor>.md`. Estado: BORRADOR -> APROBADA.
- Tasks: `ai_docs/tasks/NNN_descriptor.md`. Cada task referencia su spec madre y declara sus
  archivos en la tabla "Archivos afectados" (`| ruta | CREAR/MODIFICAR/ELIMINAR | descripcion |`).
- Los formatos viven en `ai_docs/dev_templates/spec.md` y `ai_docs/dev_templates/tareas.md`.
- Las 12 plantillas operativas de `ai_docs/dev_templates/` son la fuente unica de cada proceso:
  las skills y los agentes las siguen paso a paso, no las reescriben.

## Reglas clave

1. Toda solicitud empieza con planificacion; la implementacion viene despues de la aprobacion.
2. Las tasks se derivan solo de specs con estado APROBADA.
3. Una task, un cambio acotado, un commit. Maximo 6 archivos por task; si supera, dividir.
4. Solo se tocan archivos declarados en la task. Lo que aparezca fuera de alcance se anota, no se
   corrige sobre la marcha.
5. Auditoria cruzada obligatoria cuando hay 3 o mas tasks.
6. Revision adversarial del codigo antes de entregar. El revisor busca problemas, no confirma que
   todo esta bien.
7. El roadmap global vive en `ai_docs/core/` y guia cada planificacion.

## Enforcement mecanico y su limite

| Hook | Momento | Que hace |
|------|---------|----------|
| `hooks/sdd-pipeline-guard-codex.js` | Antes de aplicar un parche | **Deniega** escribir un archivo que ninguna task de una spec APROBADA declara |
| `hooks/sdd-commit-guard-codex.js` | Antes de ejecutar un comando | **Deniega** `git commit --no-verify` y `git push --no-verify`; avisa de commits mal formados |

Registrados en `.codex/hooks.json`. Refuerzo adicional: la regla de politica de ejecucion
`.codex/rules/sdd-enforcement.rules` prohibe los mismos comandos de bypass.

**Limite honesto:** los hooks de este entorno son un **guardarrail**, no una frontera completa de
enforcement. El propio fabricante lo declara: no interceptan todas las llamadas al shell ni todas
las rutas de escritura, y un proceso hijo lanzado desde un comando permitido puede escapar al
matcher. Sirven para que el camino correcto sea el camino por defecto y para que desviarse sea
deliberado; no sustituyen a la revision humana ni a los controles del repositorio (protecciones de
rama, CI). Si necesitas una frontera dura, ponla en CI.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada los bloqueos a aviso. Es para desbloquear una
situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline no enforcea nada.

## Estilo

- Idioma: espanol sin acentos.
- Comunicacion: clara, directa, sin hedging. Nada de adular ni de rellenar.
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, optimize, remove,
  rename, docs, test, style, chore). Sin coautoria de IA en el mensaje.
- Nombres de archivo: snake_case, sin acentos, descriptivos.

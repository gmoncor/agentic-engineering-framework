# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo lineal basado en especificaciones. Planificacion exhaustiva antes de implementar. Implementacion lineal — una task a la vez.

## Flujo SDD

```
1. Solicitud       — El usuario describe lo que quiere
2. /planificar     — Spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion      — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar    — UNA task a la vez, en orden, sin paralelizar
5. /revision       — Revision adversarial post-implementacion
```

**Planificacion exhaustiva, implementacion lineal.** El comando `/planificar` ejecuta el ciclo completo de planificacion. La implementacion es estrictamente secuencial para evitar drift.

## Comandos disponibles

| Comando | Paso | Que hace |
|---------|------|----------|
| `/planificar` | 2 | **Ciclo completo**: spec + tasks + revision + auditoria |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar` | 4 | Implementa UNA task (lineal, con gate de planificacion) |
| `/revision` | 5 | Revision adversarial post-implementacion |
| `/estado` | — | Muestra estado del proyecto (specs, tasks, progreso) |
| `/bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `/commit` | — | Crea un commit limpio con mensaje descriptivo |
| `/pr` | — | Crea o revisa una Pull Request |

## Agentes

| Agente | Rol | Cuando se activa |
|--------|-----|-----------------|
| `planificador` | Crea specs, deriva tasks | Pasos 1-2 |
| `revisor` | Revisa tasks y hace revision adversarial (esceptico) | Pasos 2, 5 |
| `implementador` | Ejecuta UNA task individual (codigo + tests) | Paso 4 |

## Reglas clave

1. **Toda solicitud empieza con planificacion** — /planificar antes de /implementar
2. **Planificacion exhaustiva** — cada task revisada, spec auditada, huecos detectados ANTES de codigo
3. **Implementacion lineal** — una task a la vez, en orden, sin paralelizar
4. **Nunca mergear sin revision adversarial** — paso 5 es obligatorio
5. **Tasks son atomicas** — una task, un cambio atomico, un commit
6. **Sin sprints** — solo roadmap global en `ai_docs/core/`
7. **El revisor es esceptico** — su trabajo es encontrar problemas, no confirmar

## Estructura de archivos

```
proyecto/
├── agents/             # planificador, revisor, implementador
├── commands/           # 10 comandos SDD (.toml)
├── skills/             # 8 skills (auto-activacion)
├── hooks/              # 2 hooks advisory (pipeline-guard + commit-guard)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap
│   ├── dev_templates/  # 11 plantillas SSOT
│   ├── tasks/          # specs + tasks (NNN_descriptor.md)
│   └── refs/           # documentacion externa
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

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea |
|------|--------|-------------|
| `sdd-pipeline-guard.js` | write_file/edit_file | Warn si se escribe codigo sin spec aprobada Y tasks derivadas |
| `sdd-commit-guard.js` | run_command (git commit) | Warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA |

Ambos advisory (warn, no bloquean). Configurados en `hooks/hooks.json`.

## Estilo

- Idioma: espanol sin acentos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, test, docs)
- Nombres de archivos: snake_case, sin acentos, descriptivos

## Prohibiciones

- NUNCA implementar sin planificacion completa (spec + tasks + revision + auditoria)
- NUNCA paralelizar la implementacion — una task a la vez
- NUNCA crear tasks de una spec en estado BORRADOR
- NUNCA mergear sin revision adversarial (paso 5)
- NUNCA hacer tasks que toquen mas de 6 archivos — dividir
- NUNCA saltar la auditoria si hay mas de 2 tasks
- NUNCA aceptar la primera solucion sin cuestionar

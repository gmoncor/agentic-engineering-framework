# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo lineal basado en especificaciones. Planificacion exhaustiva antes de implementar. Implementacion secuencial por spec, paralelizable entre specs.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — WORKFLOW: spec + tasks + revision paralela + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar-spec  — WORKFLOW: implementa TODAS las tasks de la spec + revision adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificacion exhaustiva, implementacion secuencial por spec.** El workflow `/planificar` lanza revisores en paralelo y audita cruzadamente. `/implementar-spec` ejecuta todas las tasks en orden con commit por task y revision adversarial al final.

**Multi-spec:** cuando una solicitud requiere multiples specs independientes, `/planificar` recomienda 1 spec por sesion. Cada sesion ejecuta su propio `/implementar-spec`, lo que permite implementar multiples specs en paralelo (una sesion por spec).

## Comandos disponibles

| Comando | Paso | Que hace |
|---------|------|----------|
| `/planificar` | 2 | **Workflow completo**: spec + tasks + revision paralela + auditoria. Detecta multi-spec |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar-spec` | 4 | **Workflow completo**: implementa TODAS las tasks de una spec + revision adversarial |
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
| `asesor` | Analiza problemas, evalua opciones, recomienda (read-only) | Cualquier momento |

## Reglas clave

1. **Toda solicitud empieza con planificacion** — /planificar antes de /implementar
2. **Planificacion exhaustiva** — cada task revisada, spec auditada, huecos detectados ANTES de codigo
3. **Implementacion secuencial** — una task a la vez, en orden, cada una con su commit
4. **Revision adversarial obligatoria** — el paso 5 verifica la implementacion completa antes de mergear
5. **Tasks atomicas** — una task, un cambio acotado, un commit
6. **Roadmap global** — el plan de trabajo vive en `ai_docs/core/` y guia cada planificacion
7. **El revisor es esceptico** — su trabajo es encontrar problemas, validar con evidencia

## Estructura de archivos

```
proyecto/
├── .claude/
│   ├── agents/         # planificador, revisor, implementador, asesor
│   ├── commands/       # 12 comandos SDD
│   ├── skills/         # 8 skills (auto-activacion)
│   ├── workflows/      # planificar.js + implementar-spec.js
│   └── settings.json   # model: claude-opus-4-8 + hooks
├── hooks/              # 2 hooks advisory (pipeline-guard + commit-guard)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap
│   ├── core_templates/ # 4 plantillas de planificacion inicial (01-04)
│   ├── dev_templates/  # 12 plantillas SSOT
│   ├── tasks/          # specs + tasks (NNN_descriptor.md)
│   └── refs/           # documentacion externa
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

## Modelo por defecto

`settings.json` fija `"model": "claude-opus-4-8"` como default de sesion. Opus 4.8 es el modelo mas capaz para planificacion y revision exhaustiva. Override puntual: `/model sonnet` si necesitas velocidad en tareas mecanicas.

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea |
|------|--------|-------------|
| `sdd-pipeline-guard.js` | Write/Edit | Warn si se escribe codigo sin spec aprobada Y tasks derivadas |
| `sdd-commit-guard.js` | Bash (git commit) | Warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA |

Ambos advisory (warn, no bloquean). Configurados en `.claude/settings.json` y `hooks/hooks.json`.

## Estilo

- Idioma: espanol sin acentos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore)
- Nombres de archivos: snake_case, sin acentos, descriptivos

## Limites del framework

- Planificacion completa (spec + tasks + revision + auditoria) antes de implementar
- Implementacion secuencial — una task a la vez, en orden
- Las tasks se derivan solo de specs con estado APROBADA
- Revision adversarial (paso 5) antes de mergear
- Cada task toca maximo 6 archivos — si supera, dividir
- Auditoria cruzada obligatoria cuando hay 3+ tasks
- Evaluar alternativas antes de decidir la solucion

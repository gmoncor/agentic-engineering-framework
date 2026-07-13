# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo basado en especificaciones. Planificacion exhaustiva antes de implementar. Tasks independientes se implementan en paralelo dentro de cada spec.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — Spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar-spec  — Implementa TODAS las tasks de la spec + revision adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificacion exhaustiva, implementacion paralela por oleadas.** El comando `/planificar` ejecuta el ciclo completo de planificacion. `/implementar-spec` agrupa las tasks en oleadas por dependencias: tasks independientes van en paralelo, tasks con dependencias esperan a que sus prerequisitos terminen. Revision adversarial al final.

## Comandos disponibles

| Comando | Paso | Que hace |
|---------|------|----------|
| `/planificar` | 2 | **Ciclo completo**: spec + tasks + revision + auditoria. Detecta multi-spec |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar-spec` | 4 | Implementa tasks por oleadas (paralelo) + revision adversarial |
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
3. **Implementacion por oleadas** — tasks independientes en paralelo, tasks con dependencias en orden, cada una con su commit
4. **Revision adversarial obligatoria** — el paso 5 verifica la implementacion completa antes de mergear
5. **Tasks atomicas** — una task, un cambio acotado, un commit
6. **Roadmap global** — el plan de trabajo vive en `ai_docs/core/` y guia cada planificacion
7. **El revisor es esceptico** — su trabajo es encontrar problemas, validar con evidencia

## Estructura de archivos

```
proyecto/
├── agents/             # planificador, revisor, implementador, asesor
├── commands/           # 12 comandos SDD (.toml)
├── skills/             # 8 skills (auto-activacion)
├── hooks/              # 3 hooks (pipeline-guard + review-gate + commit-guard)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap
│   ├── core_templates/ # 4 plantillas de planificacion inicial (01-04)
│   ├── dev_templates/  # 12 plantillas SSOT
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
| `resolver_problema.md` | Analisis de problemas y recomendaciones |

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea | Modo |
|------|--------|-------------|------|
| `sdd-pipeline-guard.js` | write_file/edit_file | **Bloquea** escribir un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de una spec APROBADA | Bloqueante |
| `sdd-review-gate.js` | run_command (git commit/merge) | **Bloquea** el commit si el codigo entregado no paso la revision adversarial POST-implementacion | Bloqueante (opt-in) |
| `sdd-commit-guard.js` | run_command (git commit) | Warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Advisory |

Configurados en `hooks/hooks.json`. `sdd-review-gate.js` se activa poniendo `sdd_review_gate.enabled: true` en `hooks/config.json`.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada ambos bloqueos a aviso. Es para desbloquear una situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline SDD no enforcea nada.

## Estilo

- Idioma: espanol sin acentos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore)
- Nombres de archivos: snake_case, sin acentos, descriptivos

## Limites del framework

- Planificacion completa (spec + tasks + revision + auditoria) antes de implementar
- Implementacion por oleadas — tasks independientes en paralelo, dependencias en orden
- Las tasks se derivan solo de specs con estado APROBADA
- Revision adversarial (paso 5) antes de mergear
- Cada task toca maximo 6 archivos — si supera, dividir
- Auditoria cruzada obligatoria cuando hay 3+ tasks
- Evaluar alternativas antes de decidir la solucion

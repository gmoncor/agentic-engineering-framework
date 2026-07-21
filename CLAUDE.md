# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo basado en especificaciones. Planificacion exhaustiva antes de implementar. Implementacion lineal: una task tras otra en orden de dependencias.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — WORKFLOW: spec + tasks + revision paralela + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar-spec  — WORKFLOW: implementa TODAS las tasks de la spec + revision adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificacion exhaustiva, implementacion lineal disciplinada.** El workflow `/planificar` lanza revisores en paralelo y audita cruzadamente. `/implementar-spec` implementa cada task en orden de dependencias, una tras otra: revisa la task y la commitea antes de pasar a la siguiente. Una task, un commit.

## Comandos disponibles

| Comando | Paso | Que hace |
|---------|------|----------|
| `/planificar` | 2 | **Workflow completo**: spec + tasks + revision paralela + auditoria. Detecta multi-spec |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar-spec` | 4 | **Workflow completo**: implementa cada task en orden de dependencias + revision por task |
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
3. **Implementacion lineal** — una task tras otra en orden de dependencias; revision adversarial antes de cada commit. Una task, un commit
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
│   ├── workflows/      # planificar.js + implementar-spec.js + lib/ (orquestacion)
│   └── settings.json   # model: claude-opus-4-8 + hooks
├── hooks/              # 4 hooks (pipeline-guard + review-gate + commit-guard + read-before-edit)
├── scripts/            # next-task-number.sh (numeracion de tasks sin colisiones)
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

| Hook | Evento | Que enforcea | Modo |
|------|--------|-------------|------|
| `sdd-pipeline-guard.js` | Write/Edit | **Bloquea** escribir un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-review-gate.js` | Bash (git commit/merge) | **Bloquea** un `git commit`/`merge` cuyo diff no consta revisado: la revision adversarial por task emite una senal con el hash del diff, y el hook la contrasta con `git diff --cached`. Sin senal o con hash que no ata, deniega | Bloqueante (opt-in) |
| `sdd-commit-guard.js` | Bash (git commit) | Warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Advisory |
| `sdd-read-before-edit.js` | Read/Write/Edit | Warn al escribir un archivo existente sin haberlo leido antes en la sesion (rastrea las lecturas en un fichero por sesion). Nunca bloquea; se autolimita a silencio en backends que no exponen el evento de lectura | Advisory |

Configurados en `.claude/settings.json`. `sdd-review-gate.js` se activa poniendo `sdd_review_gate.enabled: true` en `hooks/config.json`.

**Hay dos bloqueos reales: escrituras y commits sin revision.** El de escrituras (pipeline-guard) impide escribir codigo no declarado en una task. El de commits (review-gate) impide commitear un diff que no consta revisado: puede bloquear con honestidad porque la revision adversarial ocurre POR TASK, antes del commit, y su senal guarda el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin diff cacheado computable el gate no bloquea a ciegas: degrada a aviso. Una frontera aun mas dura sobre lo que se entrega va en CI y en las protecciones de rama.

**El bloqueo de commits solo existe en este backend** (Claude Code): su senal la emite el motor de workflows, que los demas backends no tienen. Donde no hay emisor no se cablea, porque no habria via legitima de satisfacer el gate.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada ambos bloqueos a aviso. Es para desbloquear una situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline SDD no enforcea nada.

Contrato de la senal de revision (emisor `/implementar-spec`, consumidor `sdd-review-gate.js`): `hooks/sdd-review-signal.js`. El hash ata la senal al diff de la task revisada. Tests de contrato: `npm test`.

## Estilo

- Idioma del proyecto: espanol. La prosa nueva se escribe con ortografia correcta, acentos incluidos. El corpus antiguo esta sin acentuar y se corrige a medida que se toca cada fichero
- Nombres de archivos y de ramas: solo ASCII, sin acentos. Los ficheros, ademas, en snake_case y descriptivos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore)

## Reglas de Cursor (`.cursor/rules/`)

Opcionales: el framework funciona sin ellas. Estan escritas para un stack concreto — Next.js 15 + React + Drizzle + PostgreSQL + Python — asi que si el proyecto usa otro stack, la mayoria no aplica tal cual. Revisalas antes de darlas por validas.

## Limites del framework

- Planificacion completa (spec + tasks + revision + auditoria) antes de implementar
- Implementacion lineal — una task tras otra en orden de dependencias, revision por task antes del commit
- Las tasks se derivan solo de specs con estado APROBADA
- Revision adversarial (paso 5) antes de mergear
- Cada task toca maximo 6 archivos — si supera, dividir
- Auditoria cruzada obligatoria cuando hay 3+ tasks
- Evaluar alternativas antes de decidir la solucion

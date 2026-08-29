# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo basado en especificaciones. Planificacion exhaustiva antes de implementar. El orden de dependencias manda.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — WORKFLOW: spec + tasks + revision paralela + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar-spec  — WORKFLOW: implementa TODAS las tasks de la spec + revision adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificacion exhaustiva; el orden de dependencias manda.** El workflow `/planificar` lanza revisores en paralelo y audita cruzadamente. `/implementar-spec` implementa cada task en orden de dependencias: revisa la task y la commitea antes de pasar a la siguiente. Una task, un commit. Para lanzar a la vez las tasks que no dependen entre si, usa `--parallel`.

<!-- nucleo: comandos -->

<!-- nucleo: agentes -->

<!-- nucleo: reglas-clave -->

<!-- nucleo: estructura -->

<!-- nucleo: specs-y-tasks -->

<!-- nucleo: plantillas -->

## Modelo por defecto

`settings.json` trae `"model": "claude-opus-4-8"` como default **sugerido** de sesion: Opus 4.8 es el modelo mas capaz para planificacion y revision exhaustiva. Pero ningun modelo esta impuesto por el framework — el default es tuyo y lo ajustas a tu presupuesto (`/model sonnet` para velocidad puntual, o edita `settings.json`).

Los agentes heredan ese default salvo el `implementador`, fijado a `model: sonnet`: ejecuta trabajo mecanico (codigo + tests) donde el modelo mas caro no aporta, asi que el patron es **capaz para el gate, barato para ejecutar**. `planificador` y `revisor` heredan el default capaz, del que depende su razonamiento. Si prefieres un unico modelo para todo, devuelve el implementador a `model: inherit`.

Ver tambien "Ahorro de tokens" en README.md.

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea | Modo |
|------|--------|-------------|------|
| `sdd-pipeline-guard.js` | Write/Edit | **Bloquea** escribir un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-review-gate.js` | Bash (git commit/merge) | **Bloquea** un `git commit`/`merge` cuyo diff no consta revisado: la revision adversarial por task emite una senal con el hash del diff, y el hook la contrasta con `git diff --cached`. Sin senal o con hash que no ata, deniega | Bloqueante (opt-in) |
| `sdd-commit-guard.js` | Bash (git commit/push) | **Bloquea** `--no-verify` (y el alias corto `-n` en commit); warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Bloqueante en `--no-verify`, advisory en el resto |
| `sdd-read-before-edit.js` | Read/Write/Edit | Warn al escribir un archivo existente sin haberlo leido antes en la sesion (rastrea las lecturas en un fichero por sesion). Nunca bloquea; se autolimita a silencio en backends que no exponen el evento de lectura | Advisory |
| `sdd-turn-budget.js` | Todas las tool calls | Cuenta las acciones sin commit y avisa al superar cada umbral (warn/block/hard_stop). `git commit` resetea el contador. HARD_STOP pide interrumpir y esperar input del usuario. Configurable (umbrales + `mode`); `mode: enforce` convierte block/hard_stop en bloqueo | Advisory (default) |
| `sdd-session-start.js` | SessionStart | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`) con directorio de trabajo, rama, commit, modelo de la sesion y hashes de los componentes instalados | Registro (activo por defecto) |

Configurados en `.claude/settings.json`. `sdd-review-gate.js` se activa poniendo `sdd_review_gate.enabled: true` en `hooks/config.json`.

**El registro de sesiones se apaga con una clave.** `sdd-session-start.js` viene activo y escribe una linea por arranque de sesion en un fichero dentro de tu repositorio. Para que deje de escribir: `sdd_session_start.enabled: false` en `hooks/config.json`; con `false` no escribe nada, ni la linea ni el fichero. Para cambiar el destino o anadir campos propios sin tocar ficheros que la actualizacion sobreescribe: `docs/extension-config-schema.md`.

**Hay dos bloqueos reales: escrituras y commits sin revision.** El de escrituras (pipeline-guard) impide escribir codigo no declarado en una task. El de commits (review-gate) impide commitear un diff que no consta revisado: puede bloquear con honestidad porque la revision adversarial ocurre POR TASK, antes del commit, y su senal guarda el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin diff cacheado computable el gate no bloquea a ciegas: degrada a aviso. Una frontera aun mas dura sobre lo que se entrega va en CI y en las protecciones de rama.

**El bloqueo de commits solo existe en este backend** (Claude Code): su senal la emite el motor de workflows, que los demas backends no tienen. Donde no hay emisor no se cablea, porque no habria via legitima de satisfacer el gate.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada ambos bloqueos a aviso. Es para desbloquear una situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline SDD no enforcea nada.

Contrato de la senal de revision (emisor `/implementar-spec`, consumidor `sdd-review-gate.js`): `hooks/sdd-review-signal.js`. El hash ata la senal al diff de la task revisada. Tests de contrato: `npm test`.

<!-- nucleo: estilo -->

<!-- nucleo: limites -->

<!-- nucleo: marca-version -->

<!-- hueco: fila-planificar -->
| `/planificar` | 2 | **Workflow completo**: spec + tasks + revision paralela + auditoria. Detecta multi-spec |
<!-- /hueco -->

<!-- hueco: fila-implementar-spec -->
| `/implementar-spec` | 4 | **Workflow completo**: implementa cada task en orden de dependencias + revision por task |
<!-- /hueco -->

<!-- hueco: arbol-backend -->
├── .claude/
│   ├── agents/         # planificador, revisor, implementador, asesor
│   ├── commands/       # 13 comandos SDD
│   ├── skills/         # 9 skills (auto-activacion; auditar-sesion es exclusiva de este backend)
│   ├── workflows/      # planificar.js + implementar-spec.js + lib/ (orquestacion)
│   └── settings.json   # model default sugerido: claude-opus-4-8 + hooks
├── hooks/              # 6 hooks (pipeline-guard + review-gate + commit-guard + read-before-edit + turn-budget + session-start)
├── scripts/            # next-task-number.sh (numeracion de tasks sin colisiones)
<!-- /hueco -->

<!-- hueco: arbol-raiz -->
└── CLAUDE.md           # este archivo
<!-- /hueco -->


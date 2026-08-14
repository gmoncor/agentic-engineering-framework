# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo basado en especificaciones. Planificacion exhaustiva antes de implementar. Implementacion lineal por defecto: una task tras otra, en orden de dependencias, dentro de cada spec.

## Flujo SDD

```
1. Solicitud          — El usuario describe lo que quiere
2. /planificar        — Spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion         — El usuario revisa el plan completo y aprueba o pide cambios
4. /implementar-spec  — Implementa TODAS las tasks de la spec + revision adversarial
5. /pr                — Crea la PR con los cambios
```

**Planificacion exhaustiva, implementacion lineal por defecto.** El comando `/planificar` ejecuta el ciclo completo de planificacion. `/implementar-spec` implementa las tasks una tras otra en orden de dependencias, con revision adversarial por task antes del commit.

<!-- nucleo: comandos -->

<!-- nucleo: agentes -->

<!-- nucleo: reglas-clave -->

<!-- nucleo: estructura -->

<!-- nucleo: specs-y-tasks -->

<!-- nucleo: plantillas -->

## Modelo por defecto

Los 4 agentes (`asesor`, `implementador`, `planificador`, `revisor`) fijan `model: gemini-2.5-pro` en su frontmatter — a diferencia de Claude, aqui no se diferencia por rol, los 4 comparten el mismo modelo. Para cambiarlo, edita el campo `model:` en el archivo del agente correspondiente (`.gemini/agents/<nombre>.md`).

## Hooks (enforcement mecanico)

| Hook | Evento | Que enforcea | Modo |
|------|--------|-------------|------|
| `sdd-pipeline-guard.js` | write_file/edit_file | **Bloquea** escribir un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-commit-guard.js` | run_command (git commit/push) | **Bloquea** `--no-verify`; warn si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Bloqueante en `--no-verify`, advisory en el resto |
| `sdd-read-before-edit.js` | write_file/edit_file | Warn al escribir un archivo existente sin haberlo leido antes en la sesion. Se autolimita a silencio en backends que no exponen el evento de lectura | Advisory |
| `sdd-turn-budget.js` | Todas las tool calls | Cuenta las acciones sin commit y avisa al superar cada umbral (warn/block/hard_stop). `git commit` resetea el contador | Advisory (default) |
| `sdd-session-start.js` | SessionStart | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`) con directorio de trabajo, rama, commit, modelo de la sesion y hashes de los componentes instalados | Registro (activo por defecto) |

Configurados en `hooks/hooks.json`. Las rutas se resuelven desde la raiz del proyecto, asi que `hooks/` tiene que estar copiado ahi (tambien si instalas la extension).

**El registro de sesiones se apaga con una clave.** `sdd-session-start.js` viene activo y escribe una linea por arranque de sesion en un fichero dentro de tu repositorio. Para que deje de escribir: `sdd_session_start.enabled: false` en `hooks/config.json`; con `false` no escribe nada, ni la linea ni el fichero. Para cambiar el destino o anadir campos propios sin tocar ficheros que la actualizacion sobreescribe: `docs/extension-config-schema.md`.

**Aqui no hay aviso de revision del codigo.** El hook `sdd-review-gate.js` existe en el repositorio, pero se cablea solo en el backend de Claude Code: la senal que lo silencia la emite su motor de workflows, que este backend no tiene. Cablearlo aqui daria un aviso permanente sin ninguna via legitima de atenderlo. La revision adversarial posterior a la implementacion sigue siendo obligatoria en el flujo (`/revision`), pero aqui la sostiene la disciplina, no un hook.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada el bloqueo de escrituras a aviso. Es para desbloquear una situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline SDD no enforcea nada.

<!-- nucleo: estilo -->

<!-- nucleo: limites -->

<!-- nucleo: marca-version -->

<!-- hueco: fila-planificar -->
| `/planificar` | 2 | **Ciclo completo**: spec + tasks + revision + auditoria. Detecta multi-spec |
<!-- /hueco -->

<!-- hueco: fila-implementar-spec -->
| `/implementar-spec` | 4 | Implementa tasks en orden de dependencias + revision por task |
<!-- /hueco -->

<!-- hueco: arbol-backend -->
├── .gemini/
│   ├── agents/          # planificador, revisor, implementador, asesor
│   ├── commands/        # 13 comandos SDD (.toml)
│   └── skills/          # 8 skills (auto-activacion)
├── hooks/              # 5 hooks (pipeline-guard + commit-guard + read-before-edit + turn-budget + session-start)
<!-- /hueco -->

<!-- hueco: arbol-raiz -->
├── GEMINI.md           # este archivo
└── gemini-extension.json
<!-- /hueco -->

<!-- hueco: limite-lineal -->
- Implementacion lineal por defecto — una task tras otra, en orden de dependencias; la ejecucion concurrente se pide de forma explicita
<!-- /hueco -->

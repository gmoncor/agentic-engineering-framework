# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semantico](https://semver.org/lang/es/).

## [Unreleased]

### Added

- `scripts/update-framework.sh`: script opt-in para actualizar el framework por linea de comandos. Clona la version pedida (tag, branch o commit; `main` si no se indica una) y sobrescribe solo las rutas propiedad del framework, sin tocar `ai_docs/core/`, `ai_docs/tasks/` ni `ai_docs/refs/`. Idempotente — reejecutarlo no duplica ni rompe nada. Complementa, no sustituye, la copia manual documentada en "Actualizacion"

### Changed

- **Implementacion lineal.** `/implementar-spec` implementa las tasks una tras otra en orden de dependencias —implementa, revisa y commitea cada task antes de pasar a la siguiente— en lugar de agruparlas en oleadas paralelas. La revision del PLAN (`/planificar`) sigue corriendo en paralelo; solo cambia la implementacion. La documentacion (`CLAUDE.md`, `AGENTS.md`, `README.md`) describia la implementacion como paralela por oleadas y particion por dueno de archivo; ahora describe el flujo lineal real
- **`sdd-review-gate.js` pasa de avisar a bloquear.** La revision adversarial ocurre por task, antes del commit, y su senal guarda el hash del diff revisado; el gate recalcula el hash de `git diff --cached` y deniega si no hay senal o el hash no ata lo staged. Cuando no hay diff cacheado computable degrada a aviso, y `SDD_GUARD_SKIP=1` sigue siendo el escape puntual

### Breaking

- **El gate de revision pasa de advisory a bloqueante.** Con `sdd_review_gate.enabled: true`, un `git commit`/`merge` cuyo diff no conste revisado ahora se deniega (antes solo avisaba). La via para satisfacerlo es pasar la revision adversarial por task; el escape puntual sigue siendo `SDD_GUARD_SKIP=1`

## [3.0.0] - 2026-07-13

### Added

- **Antigravity CLI como cuarto backend.** Contexto (`AGENTS.md`) y skills reutilizados desde `.agents/`; subagentes en `.agents/plugins/sdd/` y hooks en `.agents/hooks.json`. El bloqueo de escrituras no planificadas es real, no advisory
- **Codex como tercer backend:** agentes, hooks propios (`.codex/hooks.json`) y politica de ejecucion
- **Los pasos del flujo se entregan tambien como skills auto-activables** (`.agents/skills/`, 17): describir lo que quieres basta para que entre la skill del paso
- **Analisis previo de la solicitud** antes de crear la spec: `/planificar` no arranca a ciegas si falta contexto
- `tests/backend-parity.test.js`: canary que falla si un backend se queda sin un agente o sin un paso del flujo que los demas si tienen. Verifica ademas que los conteos de plantillas que cita la documentacion siguen siendo ciertos y que los tres manifiestos declaran la misma version
- `hooks/sdd-review-gate.js`: **avisa** (nunca deniega) al hacer `git commit` o `git merge` si no consta que el codigo entregado haya pasado la revision adversarial posterior a la implementacion. Opt-in via `hooks/config.json` (`sdd_review_gate.enabled`) y cableado solo en Claude Code, el unico backend cuyo flujo emite la senal que lo silencia. No bloquea porque no puede probar lo que afirmaria: la senal registra que hubo revision en la sesion, no que el diff concreto se revisara. La revision del PLAN (revision de tasks, auditoria de la spec) no lo silencia: valida el plan, no el codigo
- `hooks/sdd-review-signal.js`: contrato unico de la senal de revision entre el emisor (workflow `/implementar-spec`, que la escribe tras revisar el diff) y el consumidor (`sdd-review-gate.js`). Un solo canal: fichero de sesion con TTL de 4h. Es una senal de conveniencia, no una prueba: no esta atada al diff que se commitea
- `hooks/config.json`: configuracion de los hooks (activacion del review gate y TTL de la senal)
- `hooks/tests/`: tests de contrato de los guards, ejecutables con `npm test` (Node >= 20, sin dependencias). Cubren el round-trip completo emisor/consumidor de la senal de revision
- `.gitattributes` que normaliza los finales de linea a LF en todo el repositorio
- Andamiaje de proyecto publico: `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, plantillas de issue y de Pull Request en `.github/`
- `package.json` que declara `engines.node: ">=20"`, el requisito real de los hooks, hasta ahora solo expresado en prosa

### Changed

- **La spec ya no nace aprobada.** `/planificar` la guardaba directamente con `Estado: APROBADA` antes de que el usuario la viera: la aprobacion humana era un tramite que el propio workflow se daba a si mismo. Ahora nace en `BORRADOR` y solo el usuario la aprueba, despues de revisar el plan completo
- **`sdd-pipeline-guard.js` pasa de avisar a bloquear, y con granularidad real.** Antes comprobaba que existiera *alguna* spec aprobada y *alguna* task: tras la primera spec del proyecto quedaba satisfecho para siempre. Ahora exige que el archivo concreto que se va a escribir este declarado en la tabla "Archivos afectados" de alguna task
- El arbol completo se renormalizo a LF en un commit aislado. Catorce ficheros estaban commiteados con CRLF y producian diffs fantasma
- **Las tasks se paralelizan solo si escriben archivos disjuntos.** Lo que hace seguro el paralelismo es la particion por dueno de archivo, no el aislamiento del proceso. Cada task arranca en cuanto SUS dependencias terminan, sin quedarse a la cola del resto de su nivel: los niveles son una vista del plan, no una barrera de ejecucion
- **La documentacion decia lo contrario de lo que el producto hace.** Los manifiestos de instalacion (`plugin.json`, `gemini-extension.json`) y las plantillas anunciaban una "metodologia lineal, una task a la vez". Ahora los cuatro backends describen la implementacion por oleadas
- **Los hooks de Gemini se cablean con rutas relativas a la raiz del proyecto.** Antes se anclaban al directorio de la extension: la instalacion manual quedaba con los hooks apuntando a archivos inexistentes, es decir, sin enforcement. A cambio, `hooks/` debe estar copiado en la raiz del proyecto tambien cuando se instala la extension
- **Idioma declarado:** el proyecto es en espanol; la prosa nueva se escribe con ortografia correcta (acentos incluidos) y los nombres de fichero y de rama se quedan en ASCII. El corpus existente esta sin acentuar y se corrige fichero a fichero, no en un barrido masivo
- El README declara el stack que asumen las reglas de Cursor (38 de 43 son de Next.js 15 + React + Drizzle + PostgreSQL + Python) y ya no las presenta como universales
- `.claude-plugin/plugin.json`, `gemini-extension.json` y `package.json` declaran la misma version. El canary de paridad lo verifica
- Los documentos de ejemplo (`ai_docs/core/`) citaban 6, 8 y 10 plantillas operativas; hay 12
- El README enlaza los documentos de contribucion, changelog y seguridad

### Breaking

- **El guard de escrituras pasa de avisar a bloquear.** Un proyecto que venia de la 2.x y escribia codigo sin declararlo en una task ahora se encuentra la escritura denegada. La salida es declarar el archivo en la task, no desactivar el guard. (El aviso de revision del codigo, en cambio, sigue siendo advisory: nunca deniega un commit)
- **Los hooks de Gemini exigen `hooks/` en la raiz del proyecto.** Si instalaste la extension y no copiaste esa carpeta, copiala ahora

### Known issues

- **Licencia sobre codigo ejecutable.** El repositorio se distribuye bajo CC BY 4.0, una licencia pensada para obras de contenido. Cubre tambien los hooks `.js` y los workflows, y Creative Commons desaconseja explicitamente usar sus licencias para software. La recomendacion es adoptar una licencia dual (MIT para el codigo, CC BY 4.0 para documentacion y plantillas). Ver la nota en `LICENSE` y `CONTRIBUTING.md`
- **El corpus de documentacion sigue sin acentuar.** La regla de estilo ya pide ortografia correcta, pero el texto existente nacio sin acentos y se corrige fichero a fichero segun se vayan tocando. Hasta que termine, la mayoria de la prosa del repositorio no cumple la regla que declara
- **El matcher de hooks de Antigravity no se ha verificado contra un payload real.** Sale de los nombres de herramienta que documenta la CLI; no se pudo capturar en vivo una escritura (requiere inicio de sesion interactivo). Si una escritura no declarada se cuela, lo primero que hay que comprobar es el nombre de la herramienta que llega al hook

## [2.1.0] - 2026-07-02

### Added

- Workflow `/implementar-spec`: implementa todas las tasks de una spec, agrupandolas en oleadas por dependencias — las tasks independientes corren en paralelo. Detecta cuando una solicitud abarca varias specs y recomienda dividirla
- Agente `asesor` (read-only): analiza un problema, evalua opciones y recomienda una solucion
- Plantilla `resolver_problema.md` para el flujo del asesor

### Changed

- Los agentes y las plantillas describen su comportamiento en positivo, en lugar de enumerar prohibiciones
- `/planificar` vuelve a sugerir dividir el trabajo en sesiones cuando el alcance es grande

### Fixed

- Referencias obsoletas entre plantillas, agentes y comandos
- Tipos de commit y validaciones del hook de commits alineados con el estilo documentado
- Aviso al usuario cuando `ai_docs/core/` esta vacio: sin vision ni roadmap, la planificacion trabaja a ciegas

## [2.0.0] - 2026-07-01

### Added

- Metodologia SDD lineal (spec, tasks, revision, auditoria, implementacion) con soporte dual para Claude Code y Gemini CLI
- Workflow `/planificar`: spec + derivacion de tasks + revision paralela + auditoria cruzada
- 12 comandos, 4 agentes y 8 skills, replicados para ambas CLIs
- Hooks de enforcement advisory: `sdd-pipeline-guard.js` (codigo sin spec aprobada) y `sdd-commit-guard.js` (formato de commit)
- Manifiestos de instalacion: `.claude-plugin/plugin.json` y `gemini-extension.json`

### Changed

- Eliminada la redundancia de instrucciones que se repetian en cuatro capas distintas del framework

### Breaking

- La estructura de `ai_docs/` y el flujo de trabajo cambian respecto a la 1.x. Un proyecto en 1.x debe migrar sus documentos a la nueva estructura de `core/`, `core_templates/` y `dev_templates/`

## [1.0.0] - 2026-03-31

### Added

- Version inicial del framework de plantillas
- Plantillas de planificacion inicial (`core_templates/`, numeradas 01-04) y plantillas operativas (`dev_templates/`)
- 43 reglas para Cursor IDE

> Las versiones 2.0.0 y 2.1.0 se publicaron sin etiqueta de git; sus entradas se reconstruyeron a partir del historial. Los releases futuros se etiquetaran (`vX.Y.Z`).

[Unreleased]: https://github.com/gmoncor/agentic-engineering-framework/commits/main
[3.0.0]: https://github.com/gmoncor/agentic-engineering-framework/releases/tag/v3.0.0
[1.0.0]: https://github.com/gmoncor/agentic-engineering-framework/releases/tag/v1.0.0

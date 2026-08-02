# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semantico](https://semver.org/lang/es/).

## [Unreleased]

### Added

- **CLI de instalacion y actualizacion (`bin/cli.js`).** Instala o actualiza el framework con `npx github:gmoncor/agentic-engineering-framework install --backend <backend>` (o `update` para actualizar). Soporta los cuatro backends (Claude Code, Gemini CLI, Codex, Antigravity) y `all`. Sin `--backend`, muestra un prompt interactivo. Cross-platform: es Node puro, sin bash. `update` sobrescribe solo las rutas propiedad del framework, sin tocar `ai_docs/core/`, `ai_docs/tasks/` ni `ai_docs/refs/`
- `scripts/backend-manifest.json`: manifiesto unico que mapea cada backend a sus rutas de instalacion, consumido por el CLI
- Marcador de version `<!-- sdd-framework: X.Y.Z -->` al pie de `CLAUDE.md`, `GEMINI.md` y `AGENTS.md`, para cotejar la version instalada contra el CHANGELOG
- `tests/backend-parity-content.test.js`: canary que verifica que las skills identicas-por-diseno coinciden byte a byte entre `.claude/skills`, `skills` y `.agents/skills`, y detecta fuga de jerga o paths internos de gestion en el contenido distribuido del framework
- Plantilla `actualizar_framework.md`: flujo de 6 pasos para sincronizar un proyecto ya instalado a una version mas reciente del framework (detectar version, revisar CHANGELOG, aplicar cambios, actualizar marcador, verificar). Referenciada desde `CLAUDE.md`, `GEMINI.md`, `AGENTS.md` y el README de `dev_templates/`
- Deteccion de drift entre `ai_docs/core/` y el codigo real antes de especificar: el flujo de `/spec` compara las funcionalidades descritas (vision, planificacion) con el estado real del proyecto y senala divergencias (features ya implementadas que core no refleja, stack cambiado)
- **Skill `auditar-sesion`** (exclusiva de Claude Code): reporta coste, duracion, tasa de acierto de cache y friccion por hook de una sesion, leyendo las transcripciones nativas bajo `~/.claude/projects/<hash>/`. Tolera transcripciones ausentes, libreria ausente o lineas mal formadas sin abortar; ofrece filtrado por fecha o "mas reciente" cuando hay mas de 50 transcripciones. No calcula metricas de concurrencia/fan-out
- `.claude/workflows/lib/session-analyzer.js`: libreria sin dependencias que parsea transcripciones JSONL nativas de Claude Code (`parseTranscript`) y deriva coste por modelo, duracion de sesion, tasa de acierto de cache y friccion agrupada por hook y codigo de error (`computeMetrics`)
- Campo opcional `code` (identificador corto en MAYUSCULAS_CON_GUION_BAJO) en la salida JSON de `warn()`/`deny()` de los hooks, para poder clasificar por severidad sin depender del texto libre en espanol. Retrocompatible: si se omite, la salida no cambia. `sdd-turn-budget.js` es el primer consumidor: emite `TURN_BUDGET_WARN`, `TURN_BUDGET_BLOCK` y `TURN_BUDGET_HARD_STOP`
- Proteccion de archivos de configuracion editados a mano durante `update`: se guarda un hash de los archivos protegidos (`hooks/config.json`, `.claude/settings.json`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`) y, si el contenido en disco ya no coincide con el hash guardado, `update` salta ese archivo en lugar de sobrescribirlo, avisando cuales omitio
- `update` sincroniza el marcador `<!-- sdd-framework: X.Y.Z -->` de los archivos de contexto del proyecto con la version del paquete fuente en cada instalacion o actualizacion; no toca el marcador de un archivo que fue saltado por la proteccion de ediciones locales, y no falla ni inserta el marcador en un archivo que no lo tiene
- Instalacion granular del backend Claude Code: `install`/`update --backend claude` aceptan `--skip <nombre,nombre>` para omitir componentes opcionales concretos (asesor, auditar-sesion, bugfix, cleanup, testing, pr); los nombres no reconocidos avisan por stderr sin detener la instalacion, y el flag se ignora (con aviso) en los demas backends
- Nota opcional de aislamiento de spec en un worktree dedicado (`git worktree add -b spec/<nombre> ../spec-<nombre> main`), documentada en el comando de implementacion de Claude Code (no se replica en el backend Gemini)
- Paso opcional de limpieza de worktree y rama tras el merge de una PR revisada en un worktree dedicado, anadido a la plantilla de revision de PR

### Changed

- **Instalacion y actualizacion lideran con el CLI.** Las secciones correspondientes del README arrancan con `npx github:gmoncor/agentic-engineering-framework install|update`; la copia manual de archivos queda documentada como alternativa
- **Implementacion lineal.** `/implementar-spec` implementa las tasks una tras otra en orden de dependencias —implementa, revisa y commitea cada task antes de pasar a la siguiente— en lugar de agruparlas en oleadas paralelas. La revision del PLAN (`/planificar`) sigue corriendo en paralelo; solo cambia la implementacion. La documentacion (`CLAUDE.md`, `AGENTS.md`, `README.md`) describia la implementacion como paralela por oleadas y particion por dueno de archivo; ahora describe el flujo lineal real
- **`sdd-review-gate.js` pasa de avisar a bloquear.** La revision adversarial ocurre por task, antes del commit, y su senal guarda el hash del diff revisado; el gate recalcula el hash de `git diff --cached` y deniega si no hay senal o el hash no ata lo staged. Cuando no hay diff cacheado computable degrada a aviso, y `SDD_GUARD_SKIP=1` sigue siendo el escape puntual
- `revision_adversarial.md` incorpora el Paso 4bis: valida que la especificacion mantiene coherencia (tareas, alcance, exclusiones) tras las correcciones aplicadas en el Paso 4, antes de proceder al cierre en el Paso 5
- El README anade una subseccion en Quick Start con un ejemplo completo de flujo, de `/planificar` a `/pr`: un caso ficticio end-to-end (endpoint de health check) que ilustra como se conectan spec, tasks, auditoria cruzada, implementacion y PR
- **`computeWaves` renombrado a `computeNiveles`** (y `waves`/`wave` a `niveles`/`nivel` en todo el modulo de agrupacion por dependencias): el nombre anterior sugeria ejecucion concurrente por oleadas, que ya no describe el comportamiento real (implementacion lineal)
- La regla 8 de "Reglas inquebrantables" de la plantilla de roadmap ya no sugiere que las tasks independientes "se paralelizan": la independencia entre tasks informa el orden de implementacion, pero las tasks se siguen implementando una tras otra. Las menciones de paralelismo que sí aplican (planificacion de specs) quedan aclaradas para no confundirse con ejecucion de tasks
- El canario de vocabulario que detecta residuos del modelo de ejecucion concurrente retirado amplia su cobertura: antes solo escaneaba documentos de contexto en la raiz del repo, ahora tambien cubre workflows y skills por backend. La skill compartida entre Codex y Antigravity describia fan-out concurrente y arboles de trabajo por task, ya retirados; se reescribe para reflejar el flujo lineal real (implementar, revisar y commitear cada task antes de pasar a la siguiente)
- El mensaje de `update` decia "actualizado desde version X" usando la version nueva recien copiada, invirtiendo el sentido de "desde" (sugeria la version previa, mostraba la version destino). Corregido a "actualizado a la version X"
- Los textos de ayuda (`--help`, `install --help`, `update --help`) documentan ahora el menu interactivo que aparece al instalar o actualizar sin `--backend`; antes solo estaba documentado en el README

### Removed

- Campo `independiente` retirado del schema JSON de tasks que usa el planificador (y de las instrucciones de su prompt): sin uso desde que la implementacion paso a ser secuencial estricta por orden de dependencias. Un plan que aun trae el campo obsoleto sigue ordenandose correctamente, porque el ordenamiento se basa solo en dependencias

### Fixed

- **`sdd-commit-guard.js` no impedia saltarse sus propias reglas.** Solo advertia sobre subjects largos o mensajes vacios, pero no detectaba `--no-verify`/`-n` en `git commit` o `git push`. Ahora bloquea ambos, reutilizando la logica ya existente en `sdd-commit-rules.js`
- Correccion de conteo de plantillas en la documentacion, asociada a la incorporacion de `actualizar_framework.md`
- La lectura de stdin en el parseo de payloads de hooks (`readPayload()`) ya no espera indefinidamente: corre contra un timeout acotado (5s por defecto, configurable) y resuelve a `null` si se cumple, el mismo valor que ya se devolvia ante JSON invalido, asi que el manejo fail-open existente en cada hook cubre el caso sin cambios adicionales
- El hook de presupuesto de turnos denegaba llamadas de subagentes al alcanzar los umbrales de bloqueo, dejandolos sin forma de pedir guia al usuario. Ahora distingue llamadas de subagente (via los campos `agent_id`/`agent_type` del payload) y degrada a aviso en esos casos; el comportamiento en el hilo principal no cambia

### Security

- **Limite honesto de la senal de revision documentado.** La senal (un hash del diff cacheado) protege contra commits sin revisar por accidente, pero no puede endurecerse contra un falsificador deliberado con acceso a shell sin trasladar la misma superficie de ataque (sistema de archivos o variables de entorno) a un secreto compartido igual de accesible. Se documenta la limitacion en el README, justo despues del parrafo de `SDD_GUARD_SKIP=1`, y en el docstring del modulo del hook; la recomendacion para una frontera realmente dura sigue siendo proteccion de rama + CI

### Aprendizajes de esta ronda

- El canario de vocabulario que detecta residuos de un modelo retirado debe escanear tambien codigo fuente y skills por backend, no solo los documentos de contexto en la raiz: un residuo sobrevivio sin deteccion hasta que se amplio su cobertura.
- Los campos muertos de un schema (como `independiente`) son residuos silenciosos: ningun test los detecta hasta que se buscan explicitamente, aunque ya no describan ningun comportamiento real.
- La proteccion de archivos editados a mano en `update` (config, `CLAUDE.md`/`GEMINI.md`/`AGENTS.md`) extiende un patron de "no pisar lo que el usuario ya toco" que el propio CLI aplicaba a `ai_docs/core/` y `ai_docs/tasks/`; conviene generalizarlo, no reinventarlo por archivo.

### Breaking

- **`scripts/update-framework.sh` eliminado, reemplazado por el CLI.** Usa `npx github:gmoncor/agentic-engineering-framework update --backend <backend>` en su lugar. Si lo habias copiado a tu proyecto, tu copia local sigue funcionando pero ya no se actualiza junto con el framework
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

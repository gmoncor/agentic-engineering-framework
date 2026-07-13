# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semantico](https://semver.org/lang/es/).

## [Unreleased]

### Added

- `hooks/sdd-review-gate.js`: bloquea `git commit` y `git merge` cuando el codigo entregado no paso la revision adversarial posterior a la implementacion. Opt-in via `hooks/config.json` (`sdd_review_gate.enabled`). La revision del PLAN (revision de tasks, auditoria de la spec) no lo satisface: valida el plan, no el codigo
- `hooks/sdd-review-signal.js`: contrato unico de la senal de revision entre el emisor (workflow `/implementar-spec`, que la escribe tras revisar el diff) y el consumidor (`sdd-review-gate.js`). Dos canales: fichero de sesion con TTL de 4h y marca `[SDD-POST-IMPL: <hash>]` en el mensaje de commit
- `hooks/config.json`: configuracion de los hooks (activacion del review gate y TTL de la senal)
- `hooks/tests/`: tests de contrato de los guards, ejecutables con `npm test` (Node >= 20, sin dependencias). Cubren el round-trip completo emisor/consumidor de la senal de revision
- `.gitattributes` que normaliza los finales de linea a LF en todo el repositorio
- Andamiaje de proyecto publico: `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, plantillas de issue y de Pull Request en `.github/`
- `package.json` que declara `engines.node: ">=20"`, el requisito real de los hooks, hasta ahora solo expresado en prosa

### Changed

- **La spec ya no nace aprobada.** `/planificar` la guardaba directamente con `Estado: APROBADA` antes de que el usuario la viera: la aprobacion humana era un tramite que el propio workflow se daba a si mismo. Ahora nace en `BORRADOR` y solo el usuario la aprueba, despues de revisar el plan completo
- **`sdd-pipeline-guard.js` pasa de avisar a bloquear, y con granularidad real.** Antes comprobaba que existiera *alguna* spec aprobada y *alguna* task: tras la primera spec del proyecto quedaba satisfecho para siempre. Ahora exige que el archivo concreto que se va a escribir este declarado en la tabla "Archivos afectados" de alguna task
- El arbol completo se renormalizo a LF en un commit aislado. Catorce ficheros estaban commiteados con CRLF y producian diffs fantasma
- `gemini-extension.json` pasa a la version 2.1.0, alineada con `.claude-plugin/plugin.json`. Ambos manifiestos declaraban versiones distintas del mismo release
- El README enlaza los documentos de contribucion, changelog y seguridad

### Known issues

- **Licencia sobre codigo ejecutable.** El repositorio se distribuye bajo CC BY 4.0, una licencia pensada para obras de contenido. Cubre tambien los hooks `.js` y los workflows, y Creative Commons desaconseja explicitamente usar sus licencias para software. La recomendacion es adoptar una licencia dual (MIT para el codigo, CC BY 4.0 para documentacion y plantillas). Ver la nota en `LICENSE` y `CONTRIBUTING.md`

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
[1.0.0]: https://github.com/gmoncor/agentic-engineering-framework/releases/tag/v1.0.0

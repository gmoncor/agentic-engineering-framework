# Contribuir

Gracias por tu interes en mejorar el framework. Este documento explica como reportar problemas, proponer cambios y abrir una Pull Request.

## Antes de empezar

- **Node.js >= 20** — requerido por los hooks (`hooks/*.js`). Verifica con `node --version`
- Lee `CLAUDE.md` — define el estilo, el flujo SDD y los limites del framework. Todo cambio debe ser coherente con ellos
- **Tests:** `npm test` ejecuta los tests de contrato de los hooks. Todo cambio en `hooks/` llega con sus tests en el mismo commit

## Reportar un bug

Abre un issue con la plantilla **Bug report**. Un buen reporte incluye:

- Que esperabas que pasara y que paso en su lugar
- Pasos exactos de reproduccion
- Version del framework (`.claude-plugin/plugin.json`), CLI usada (Claude Code, Gemini CLI, copy-paste) y version de Node
- Salida literal del error, si la hay

Si el problema afecta a la seguridad, **no abras un issue publico**: sigue el proceso de `SECURITY.md`.

## Proponer una mejora

Abre un issue con la plantilla **Feature request** antes de escribir codigo. Describe el caso de uso real y las alternativas que descartaste. Una propuesta acordada en un issue evita PRs que se rechazan por alcance.

## Proceso de Pull Request

1. Haz fork del repositorio y crea una rama descriptiva (`fix/pipeline-guard-windows`, `feat/comando-auditar`)
2. Haz cambios acotados: una PR = un cambio con un proposito. Las PRs que mezclan refactor, feature y formato son dificiles de revisar y se rechazan
3. Actualiza la documentacion afectada (`README.md`, `CLAUDE.md`, `GEMINI.md`) en la misma PR
4. Anade una entrada en `CHANGELOG.md` bajo `## [Unreleased]`
5. Abre la PR rellenando la plantilla y enlaza el issue relacionado

## Estilo

- **Idioma:** espanol sin acentos, en codigo y documentacion
- **Commits:** `<tipo>: <descripcion>`, asunto de 72 caracteres o menos. Tipos validos: `feat`, `fix`, `update`, `refactor`, `create`, `optimize`, `remove`, `rename`, `docs`, `test`, `style`, `chore`
- **Sin `Co-Authored-By` de asistentes de IA** en los mensajes de commit
- **Nombres de archivo:** snake_case, sin acentos, descriptivos
- **Finales de linea:** LF. `.gitattributes` los normaliza automaticamente; no lo desactives

El hook `sdd-commit-guard.js` avisa si un commit incumple estas reglas.

## Los guards bloquean: el escape es para emergencias

`sdd-pipeline-guard.js` bloquea escribir archivos que ninguna task declara, y `sdd-review-gate.js` (opt-in) bloquea commitear codigo que no paso la revision adversarial. Si un guard te bloquea, la respuesta por defecto es **arreglar el plan**: declara el archivo en la tabla "Archivos afectados" de la task, o ejecuta la revision del codigo.

`SDD_GUARD_SKIP=1` degrada ambos bloqueos a aviso. Es un escape **puntual** para desbloquear una urgencia:

```bash
SDD_GUARD_SKIP=1 git commit -m "fix: restaurar el servicio caido"
```

No lo exportes de forma permanente en tu shell ni en la configuracion del proyecto: con el activo, el pipeline SDD deja de enforcar nada y el framework vuelve a ser una sugerencia. Si necesitas el escape a menudo, el problema esta en el plan, no en el guard.

## Paridad entre CLIs

El framework se distribuye para Claude Code y Gemini CLI. Muchos artefactos existen por duplicado:

| Claude Code | Gemini CLI |
|---|---|
| `.claude/agents/` | `agents/` |
| `.claude/commands/` (`.md`) | `commands/` (`.toml`) |
| `.claude/skills/` | `skills/` |
| `CLAUDE.md` | `GEMINI.md` |

Si cambias un agente, comando o skill en un lado, **aplica el cambio equivalente en el otro** dentro de la misma PR. Una PR que solo actualiza una de las dos CLIs deja el framework incoherente.

## Que NO incluir en una PR

- Configuraciones de IDE o de tu maquina (`.idea/`, `.vscode/`, `.claude/settings.local.json`)
- Contenido de `ai_docs/tasks/` o `ai_docs/refs/` — son carpetas de trabajo del usuario, no del framework
- Dependencias instaladas (`node_modules/`) ni artefactos de build
- Secretos, `.env` o credenciales de cualquier tipo
- Reformateos masivos sin relacion con el cambio (cambios de fin de linea, reindentado global)

## Licencia de tus contribuciones

Al enviar una PR aceptas que tu contribucion se distribuya bajo la licencia del proyecto (CC BY 4.0, ver `LICENSE`).

> **Nota sobre la licencia:** el repositorio incluye codigo ejecutable (los hooks `.js` y los workflows). CC BY 4.0 es una licencia pensada para obras de contenido, no para software, y Creative Commons desaconseja usarla en codigo. Se mantiene por simplicidad, dado que el grueso del repositorio son plantillas y documentacion. Si necesitas usar el codigo en un entorno que exija una licencia de software explicita (por ejemplo MIT o Apache-2.0), abre un issue o contacta al autor.

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

- **Idioma:** espanol, en codigo y documentacion. La prosa nueva se escribe con ortografia correcta, acentos incluidos. El corpus actual esta sin acentuar (asi nacio el proyecto) y se va corrigiendo a medida que se toca cada fichero: no abras una PR solo para acentuar, hazlo en la PR que ya toca ese fichero
- **Commits:** `<tipo>: <descripcion>`, asunto de 72 caracteres o menos. Tipos validos: `feat`, `fix`, `update`, `refactor`, `create`, `optimize`, `remove`, `rename`, `docs`, `test`, `style`, `chore`
- **Sin `Co-Authored-By` de asistentes de IA** en los mensajes de commit
- **Nombres de archivo y de rama:** solo ASCII, sin acentos. Los ficheros, ademas, en snake_case y descriptivos
- **Finales de linea:** LF. `.gitattributes` los normaliza automaticamente; no lo desactives

El hook `sdd-commit-guard.js` avisa si un commit incumple estas reglas.

## Dos guards que bloquean: escrituras y revision

`sdd-pipeline-guard.js` bloquea escribir archivos que ninguna task de la spec activa declara. Si te bloquea, la respuesta por defecto es **arreglar el plan**: declara el archivo en la tabla "Archivos afectados" de la task.

`sdd-review-gate.js` (opt-in, solo Claude Code) **bloquea** un commit cuyo diff no consta revisado. La revision adversarial ocurre POR TASK, antes del commit, y emite una senal con el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin senal, o con un hash que no ata lo staged, deniega. Cuando no hay diff cacheado computable degrada a aviso, para no bloquear a ciegas. La via para satisfacerlo es pasar la revision adversarial (`/revision` o la revision por task de `/implementar-spec`). Solo se cablea en Claude Code, el unico backend cuyo flujo emite la senal.

`SDD_GUARD_SKIP=1` degrada ambos bloqueos (escrituras y revision) a aviso. Es un escape **puntual** para desbloquear una urgencia:

```bash
SDD_GUARD_SKIP=1 git commit -m "fix: restaurar el servicio caido"
```

No lo exportes de forma permanente en tu shell ni en la configuracion del proyecto: con el activo, los guards dejan de enforcar nada. Si necesitas el escape a menudo, el problema esta en el plan, no en el guard.

## Paridad entre CLIs

El framework se distribuye para Claude Code, Gemini CLI, Codex y Antigravity. Muchos artefactos existen por duplicado:

| Claude Code | Gemini CLI | Codex | Antigravity |
|---|---|---|---|
| `.claude/agents/` | `agents/` | `.codex/agents/` (`.toml`) | `.agents/plugins/sdd/agents/` |
| `.claude/commands/` (`.md`) | `commands/` (`.toml`) | `.agents/skills/` (los comandos son skills) | `.agents/skills/` |
| `.claude/skills/` | `skills/` | `.agents/skills/` | `.agents/skills/` |
| `CLAUDE.md` | `GEMINI.md` | `AGENTS.md` | `AGENTS.md` |

Si anades o cambias un agente o una skill, **portalo a todos los backends** dentro de la misma PR y ejecuta el canary:

```bash
node --test tests/backend-parity.test.js
```

El canary compara el conjunto de nombres logicos de agentes y de pasos del flujo de cada backend, y falla nombrando lo que falta y donde. No compara el contenido de los ficheros: que las dos versiones de un mismo paso describan el mismo proceso es cosa de la revision de la PR. Una PR que solo actualiza una de las CLIs deja el framework incoherente.

En Codex los slash commands versionables estan deprecados: cada comando se entrega como skill, y las skills cuyo nombre coincide con un comando (`bugfix`, `commit`, `pr`) son una sola, con el uso a peticion explicita como seccion adicional. La logica de la skill manda sobre la del comando.

## Sandbox de Codex

`.codex/config.toml` viene con `sandbox_mode = "workspace-write"`: el agente escribe dentro del proyecto y no fuera. Si tu proyecto necesita mas (acceso de red, escritura fuera del arbol), puedes subirlo a `danger-full-access`, pero entonces **el sandbox deja de existir**: el agente puede tocar cualquier cosa de la maquina. Hazlo solo si sabes por que, y no lo commitees como valor por defecto del repositorio. El modelo (`model`) tambien es tuyo: ajustalo a tu cuenta.

## Que NO incluir en una PR

- Configuraciones de IDE o de tu maquina (`.idea/`, `.vscode/`, `.claude/settings.local.json`)
- Contenido de `ai_docs/tasks/` o `ai_docs/refs/` — son carpetas de trabajo del usuario, no del framework
- Dependencias instaladas (`node_modules/`) ni artefactos de build
- Secretos, `.env` o credenciales de cualquier tipo
- Reformateos masivos sin relacion con el cambio (cambios de fin de linea, reindentado global)

## Licencia de tus contribuciones

Al enviar una PR aceptas que tu contribucion se distribuya bajo la licencia del proyecto (CC BY 4.0, ver `LICENSE`).

> **Nota sobre la licencia:** el repositorio incluye codigo ejecutable (los hooks `.js` y los workflows). CC BY 4.0 es una licencia pensada para obras de contenido, no para software, y Creative Commons desaconseja usarla en codigo. Se mantiene por simplicidad, dado que el grueso del repositorio son plantillas y documentacion. Si necesitas usar el codigo en un entorno que exija una licencia de software explicita (por ejemplo MIT o Apache-2.0), abre un issue o contacta al autor.

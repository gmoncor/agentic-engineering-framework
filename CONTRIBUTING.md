# Contribuir

Gracias por tu interes en mejorar el framework. Este documento explica como reportar problemas, proponer cambios y abrir una Pull Request.

> **Todo lo que sigue aplica a contribuir cambios de vuelta a este repositorio.** Si tu objetivo es distinto — adaptar el framework como base de un proyecto independiente que no vas a subir aqui — no necesitas nada de esto. Sigue las instrucciones de `git init` de la seccion "Instalacion" del `README.md` y la seccion **"Personalizar: anadir tus propias skills o comandos"**. En ese caso ninguna de las reglas de esta guia (alcance de PR, canario de paridad entre backends, plantillas de issue) te aplica: es tu copia, la ajustas como quieras.

## Antes de empezar

- **Node.js >= 20** — requerido por los hooks (`hooks/*.js`). Verifica con `node --version`
- Lee `CLAUDE.md` — define el estilo, el flujo SDD y los limites del framework. Todo cambio debe ser coherente con ellos
- **Tests:** `npm test` ejecuta los tests de contrato de los hooks. Todo cambio en `hooks/` llega con sus tests en el mismo commit
- **Deriva:** `npm run check-drift` verifica que las superficies **generadas** coinciden con su fuente. Ejecutalo antes del push si tocas `.claude/` o `docs-src/`. No cubre las superficies que se mantienen a mano, y son mas de las que parece: lee "Artefactos generados y deriva" antes de dar por portado un cambio

## Reportar un bug

Abre un issue con la plantilla **Bug report**. Un buen reporte incluye:

- Que esperabas que pasara y que paso en su lugar
- Pasos exactos de reproduccion
- Version del framework (`node bin/cli.js --version`, o el marcador `<!-- sdd-framework: X.Y.Z -->` al final de tu `CLAUDE.md`/`GEMINI.md`/`AGENTS.md` si instalaste sin el CLI), CLI usada (Claude Code, Gemini CLI, Codex, Antigravity, copy-paste) y version de Node
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

El hook `sdd-commit-guard.js` avisa si un commit incumple estas reglas, y **bloquea** si el commit (o el push) usa `--no-verify`/`-n` para saltarselas.

## Tres guards que bloquean: escrituras, revision y `--no-verify`

`sdd-pipeline-guard.js` bloquea escribir archivos que ninguna task de la spec activa declara. Si te bloquea, la respuesta por defecto es **arreglar el plan**: declara el archivo en la tabla "Archivos afectados" de la task.

`sdd-review-gate.js` (opt-in, solo Claude Code) **bloquea** un commit cuyo diff no consta revisado. La revision adversarial ocurre POR TASK, antes del commit, y emite una senal con el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin senal, o con un hash que no ata lo staged, deniega. Cuando no hay diff cacheado computable degrada a aviso, para no bloquear a ciegas. La via para satisfacerlo es pasar la revision adversarial (`/revision` o la revision por task de `/implementar-spec`). Solo se cablea en Claude Code, el unico backend cuyo flujo emite la senal.

`sdd-commit-guard.js` es advisory para el resto de reglas (subject, tipo, Co-Authored-By), pero **bloquea** especificamente `git commit --no-verify`/`-n` y `git push --no-verify`: no hay forma legitima de saltarse el resto de guards por esa via.

`SDD_GUARD_SKIP=1` degrada los tres bloqueos (escrituras, revision y `--no-verify`) a aviso. Es un escape **puntual** para desbloquear una urgencia:

```bash
SDD_GUARD_SKIP=1 git commit -m "fix: restaurar el servicio caido"
```

No lo exportes de forma permanente en tu shell ni en la configuracion del proyecto: con el activo, los guards dejan de enforcar nada. Si necesitas el escape a menudo, el problema esta en el plan, no en el guard.

## Artefactos generados y deriva

Las superficies por backend (`.gemini/`, `.codex/`, `.agents/` y los documentos raiz `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`) estan declaradas en `scripts/artifact-manifest.json`. **Una parte se genera y otra se mantiene a mano**, y el campo `mode` de cada entrada del manifiesto es lo que decide donde editas:

| `mode` | Quien la mantiene | Que hace `check-drift` con ella |
|---|---|---|
| `managed` | El compilador, desde su fuente: `.claude/` para agentes, comandos y skills; `docs-src/` para los documentos raiz | La compara contra su fuente. Editar la salida en vez de la fuente deja el arbol en deriva, y la siguiente regeneracion revierte el cambio |
| `preserve` | Tu, a mano, en su propia ruta | Nada. No hay fuente distinta contra la que compararla, asi que su contenido nunca se verifica |

```bash
grep -n '"mode": "preserve"' scripts/artifact-manifest.json   # que se mantiene a mano
npm run check-drift                                           # verifica lo generado contra su fuente
node scripts/compile.js --write                               # regenera las salidas desde la fuente
```

Antes de editar un artefacto, comprueba con el `grep` en que grupo cae.

`npm run check-drift` es el paso previo al push de cualquier PR que toque `.claude/` o `docs-src/`, y sirve igual como gate de CI. Sus exit codes:

| Exit | Significado |
|---|---|
| 0 | Sin deriva |
| 1 | Alguna salida no coincide con su fuente. El reporte nombra el fichero, su fuente y las primeras lineas que divergen |
| 2 | Error de compilacion: fuente ausente, transform que falla, manifiesto ilegible, o un backend que el manifiesto genera y `scripts/model-policy.json` no declara. Ese ultimo caso detiene la compilacion antes de escribir nada, en vez de generar el artefacto sin modelo ni herramientas |

Para un log de CI, `npm run check-drift -- --quiet` reduce el reporte a una sola linea. Reduce el detalle, nunca el codigo de salida: con `--quiet` un exit 2 sigue siendo 2.

La version del framework (`<!-- sdd-framework: X.Y.Z -->` en los documentos raiz) sale de `package.json` en cada regeneracion. No la edites en el documento generado ni en `docs-src/core.md`, que lleva el marcador `{{VERSION}}` en su lugar.

### Que se mantiene a mano, exactamente

El manifiesto tiene hoy **7 entradas `preserve`**, y ninguna es la copia de algo que exista en otra parte del arbol:

- **Dos son artefactos exclusivos de Claude Code**, sin copia en ningun otro backend (`.claude/skills/auditar-sesion/` y `.claude/workflows/`): no plantean problema de paridad y no declaran ruta de salida.
- **Cinco son formatos nativos sin analogo en `.claude/`**: `.codex/config.toml`, `.codex/hooks.json`, `.codex/rules/sdd-enforcement.rules`, `.agents/hooks.json` y `.agents/plugins/sdd/plugin.json`. No hay nada de lo que generarlas; viven a mano por diseno.

Todo lo demas se genera. **Las dieciocho capacidades de `.agents/skills/`** (el directorio que leen Codex y Antigravity) salen del arbol de Claude Code: ocho de `.claude/skills/` con el transform `skill-to-backend`, y las diez que en Claude Code son comandos, de `.claude/commands/` con el transform `command-to-skill`.

Asi que **editar `.claude/commands/planificar.md` alcanza a los cuatro backends**: Claude Code lee el fichero que editaste, y de el salen `.gemini/commands/planificar.toml` y `.agents/skills/planificar/SKILL.md`. `npm run check-drift` en verde significa que las tres superficies estan al dia; en rojo, que falta `node scripts/compile.js --write`.

### Como diverge una skill de su comando

Una skill no es el comando con otro nombre, y el transform lo tiene en cuenta:

| Diferencia | Donde se declara |
|---|---|
| El frontmatter (`name` y la `description` que dice CUANDO se activa la skill, no que hace) | `docs-src/skills/<nombre>.md`, obligatorio |
| Texto propio del formato de skill (alcance, veredictos, postura) | Cuerpo del mismo fragmento; se anade despues del cuerpo del comando |
| Texto que solo vale en Claude Code (p. ej. el aviso de un hook que solo ese backend cablea) | Bloque `<!-- solo-claude -->` … `<!-- /solo-claude -->` dentro del comando. No llega a ningun otro backend |
| El bloque final `$ARGUMENTS` y las referencias `/<comando>` | Automatico: una skill no recibe argumentos, y las referencias pasan a nombrar la skill homonima |
| El procedimiento entero, cuando el comando delega en el motor de workflows que solo tiene Claude Code | `source-body: omit` en el fragmento, que entonces aporta el cuerpo completo. Solo lo usan `planificar` e `implementar-spec`, la misma excepcion que ya tenian esos dos comandos para Gemini |

El modelo de un artefacto generado nunca sale del fichero fuente: lo fija `scripts/model-policy.json`.

## Paridad entre CLIs

El framework se distribuye para Claude Code, Gemini CLI, Codex y Antigravity. Muchos artefactos existen por duplicado:

| Claude Code | Gemini CLI | Codex | Antigravity |
|---|---|---|---|
| `.claude/agents/` | `.gemini/agents/` | `.codex/agents/` (`.toml`) | `.agents/plugins/sdd/agents/` |
| `.claude/commands/` (`.md`) | `.gemini/commands/` (`.toml`) | `.agents/skills/` (los comandos son skills) | `.agents/skills/` |
| `.claude/skills/` | `.gemini/skills/` | `.agents/skills/` | `.agents/skills/` |
| `CLAUDE.md` | `GEMINI.md` | `AGENTS.md` | `AGENTS.md` |

Las carpetas de Gemini CLI van **bajo `.gemini/`, nunca sueltas en la raiz**: `agents/`, `commands/` o `skills/` en la raiz colisionan con carpetas del proyecto destino y cambian el alcance de la instalacion via extension. `tests/install-native.test.js` falla si alguna reaparece en la raiz, asi que no es una preferencia de estilo. Coloca ahi cualquier artefacto nuevo de Gemini.

Si CAMBIAS un agente, un comando o una skill, edita la fuente en `.claude/` (o su fragmento en `docs-src/`) y regenera con `node scripts/compile.js --write`: las copias por backend salen de ahi. Si ANADES una capacidad nueva, ademas de crearla hay que declararla en `scripts/artifact-manifest.json` con su salida por backend; sin esa entrada no se genera nada. En los dos casos, ejecuta el canary dentro de la misma PR:

```bash
node --test tests/backend-parity.test.js
```

El canary compara el conjunto de nombres logicos de agentes y de pasos del flujo de cada backend, y falla nombrando lo que falta y donde. No compara el contenido de los ficheros; de eso se encarga `check-drift` sobre las salidas generadas. Una PR que solo actualiza una de las CLIs deja el framework incoherente.

En Codex los slash commands versionables estan deprecados: cada comando se entrega como skill, y las skills cuyo nombre coincide con un comando (`bugfix`, `commit`, `pr`) son una sola, con el uso a peticion explicita como seccion adicional. La logica de la skill manda sobre la del comando.

Codex y Antigravity no soportan el frontmatter `argument-hint`. Las skills que lo usan (`bugfix`, `commit`, `pr`) compensan con una seccion `## Uso a peticion explicita` en el cuerpo del skill para esos dos backends.

Para las skills que salen de `.claude/skills/` eso es la unica divergencia de contenido admitida: la transformacion garantiza que el resto sea identico, y `diff` contra la fuente lo confirma. Las que salen de `.claude/commands/` admiten ademas las divergencias de la tabla "Como diverge una skill de su comando", todas declaradas en `docs-src/skills/<nombre>.md` o marcadas en el propio comando. En los dos casos el contenido esta atado: `check-drift` lo verifica.

El autor usa Claude Code a diario como backend principal. Los otros tres backends (Gemini CLI, Codex y Antigravity) estan implementados, cableados y con tests de paridad en verde, pero no reciben verificacion diaria propia. Esto no implica menor soporte: la paridad completa entre los cuatro es un requisito del proyecto.

Los guards (`sdd-pipeline-guard`, `sdd-commit-guard`, `sdd-read-before-edit`, `sdd-turn-budget`, `sdd-review-gate`) tambien existen por duplicado: cada backend los cablea a su propio evento y matcher nativos en `.claude/settings.json`, `hooks/hooks.json`, `.codex/hooks.json` o `.agents/hooks.json`. `scripts/hook-event-mapping.json` es la tabla canonica de ese mapeo; si anades o modificas un hook, **actualizala primero** y despues porta el cambio a los ficheros de wiring reales. `tests/hook-mapping-parity.test.js` compara ambos y falla nombrando la accion, el backend y el matcher que diverge.

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

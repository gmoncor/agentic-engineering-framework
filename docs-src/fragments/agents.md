# SDD (Spec-Driven Development) — Framework de Desarrollo

> Contexto compartido por los agentes de codigo que leen `AGENTS.md`.
> Flujo basado en especificaciones: se planifica exhaustivamente, se implementa
> por partes acotadas y se revisa el codigo antes de entregarlo.

## Flujo SDD

```
1. Solicitud     — El usuario describe lo que quiere
2. Planificacion — analisis previo + spec + tasks + revision de cada task + auditoria cruzada
3. Aprobacion    — El usuario revisa el plan completo y aprueba o pide cambios
4. Implementacion— Se implementan las tasks de la spec + revision adversarial del codigo
5. Entrega       — Commit y Pull Request
```

No se escribe codigo sin spec aprobada y sin task que declare el archivo que se toca.

## Como se invoca cada paso

Cada paso del flujo es una **skill** en `.agents/skills/<nombre>/SKILL.md`. Las skills se
auto-activan por su `description`: basta con describir lo que quieres ("planifica el login",
"implementa la spec de pagos", "revisa la implementacion") para que la skill correspondiente
entre. Tambien puedes nombrarla explicitamente.

| Skill | Paso | Que hace |
|-------|------|----------|
| `inicio` | — | Bootstrap de `ai_docs/core/`: genera los 4 documentos fundamentales del proyecto (paso previo, opcional) |
| `planificar` | 2 | Ciclo completo: analisis previo + spec + tasks + revision + auditoria |
| `spec` | — | Crea una spec individual (paso aislado) |
| `tareas` | — | Deriva tasks de una spec aprobada (paso aislado) |
| `auditar` | — | Audita coherencia entre spec y tasks (paso aislado) |
| `implementar-spec` | 4 | Implementa las tasks de una spec + revision adversarial |
| `implementar` | 4 | Implementa UNA task individual (control manual) |
| `revision` | 5 | Revision adversarial post-implementacion (paso aislado) |
| `revision-adversarial` | 5 | Revision esceptica del codigo entregado |
| `revisar-tarea` | 2 | Revision de un documento de task antes de implementarlo |
| `estado` | — | Estado del proyecto: specs, tasks, progreso |
| `asesor` | — | Analiza un problema, evalua opciones y recomienda |
| `bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `cleanup` | — | Revision de calidad: codigo muerto, tipos, seguridad |
| `testing` | — | Escritura de tests |
| `diff` | — | Resumen legible de los cambios pendientes |
| `commit` | — | Crea un commit limpio con mensaje descriptivo |
| `pr` | — | Crea o revisa una Pull Request |

<!-- nucleo: agentes -->

Definidos en `.codex/agents/*.toml` (Codex) y en `.agents/plugins/sdd/agents/*.md` (Antigravity
CLI). El asesor corre en modo solo lectura; los demas pueden escribir dentro del espacio de
trabajo.

En estos backends el `implementador` tambien commitea (codigo + tests + commit); el nucleo solo
declara codigo + tests.

## Defecto lineal y modo paralelo a peticion

Este framework NO tiene motor de workflows declarativo en estos backends: la secuenciacion
depende de como el orquestador escribe sus llamadas. El comportamiento que aplicar:

1. **Lineal por defecto.** Mientras no se pida otra cosa, implementa las tasks una tras otra,
   en orden de dependencias: una task no arranca hasta que las tasks de las que depende estan
   hechas. Cada task se implementa, se revisa y se commitea antes de pasar a la siguiente. Una
   task, un commit.
2. **Modo paralelo a peticion.** Si el usuario lo pide de forma explicita ("implementa la spec
   en paralelo"), lanza a la vez las tasks que no dependen entre si. El orden de dependencias
   sigue mandando: un grupo no arranca hasta que termina el grupo del que depende.
3. **Un gate de revision por task.** En ambos modos, antes de commitear cada task hay UN punto
   cuyo veredicto se necesita para continuar: la revision adversarial de esa task. Ahi se
   espera. Aqui ese gate lo sostiene la disciplina, no un hook: ningun hook cableado en estos
   backends bloquea un commit por falta de revision. El hook `sdd-review-gate.js` existe en el
   repositorio, pero se cablea solo en el backend de Claude Code: la senal que lo silencia la
   emite su motor de workflows, que estos backends no tienen. Ver «Enforcement mecanico y su
   limite»: ahi, escribir un archivo no declarado y `--no-verify` estan denegados; el commit sin
   revision, no. En planificacion el gate equivalente es la auditoria cruzada, que si corre en
   paralelo sobre las tasks del plan.

Describe siempre la dependencia real (que necesita el resultado de que): es lo que decide que
puede ir a la vez y que no.

<!-- nucleo: estructura -->

<!-- nucleo: specs-y-tasks -->

Cada task declara ademas sus archivos en la tabla "Archivos afectados"
(`| ruta | CREAR/MODIFICAR/ELIMINAR | descripcion |`).

Las plantillas operativas de `ai_docs/dev_templates/` son la fuente unica de cada proceso: las
skills y los agentes las siguen paso a paso, no las reescriben. `ai_docs/dev_templates/actualizar_framework.md`
documenta como traer los cambios del framework a un proyecto ya instalado, sin tocar tus specs ni tus tasks.

<!-- nucleo: plantillas -->

## Reglas clave

1. Toda solicitud empieza con planificacion; la implementacion viene despues de la aprobacion.
2. Las tasks se derivan solo de specs con estado APROBADA.
3. Una task, un cambio acotado, un commit. Maximo 6 archivos por task; si supera, dividir.
4. Solo se tocan archivos declarados en la task. Lo que aparezca fuera de alcance se anota, no se
   corrige sobre la marcha.
5. Auditoria cruzada obligatoria en la planificacion.
6. Revision adversarial del codigo antes de entregar. El revisor busca problemas, no confirma que
   todo esta bien.
7. El roadmap global vive en `ai_docs/core/` y guia cada planificacion.

## Enforcement mecanico y su limite

| Hook | Momento | Que hace |
|------|---------|----------|
| `hooks/sdd-pipeline-guard-codex.js` | Antes de aplicar un parche | **Deniega** escribir un archivo que ninguna task de una spec APROBADA declara |
| `hooks/sdd-commit-guard-codex.js` | Antes de ejecutar un comando | **Deniega** `git commit --no-verify` y `git push --no-verify`; avisa de commits mal formados |
| `hooks/sdd-session-start.js` | Al arrancar la sesion | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`) con directorio de trabajo, rama, commit, modelo de la sesion y hashes de los componentes instalados |

Registrados en `.codex/hooks.json`. Refuerzo adicional: la regla de politica de ejecucion
`.codex/rules/sdd-enforcement.rules` prohibe los mismos comandos de bypass.

**El registro de sesiones se apaga con una clave.** `sdd-session-start.js` viene activo y escribe
una linea por arranque de sesion en un fichero dentro de tu repositorio. Para que deje de escribir:
`sdd_session_start.enabled: false` en `hooks/config.json`; con `false` no escribe nada, ni la linea
ni el fichero. Para cambiar el destino o anadir campos propios sin tocar ficheros que la
actualizacion sobreescribe: `docs/extension-config-schema.md`.

**Limite honesto:** los hooks de este entorno son un **guardarrail**, no una frontera completa de
enforcement. El propio fabricante lo declara: no interceptan todas las llamadas al shell ni todas
las rutas de escritura, y un proceso hijo lanzado desde un comando permitido puede escapar al
matcher. Sirven para que el camino correcto sea el camino por defecto y para que desviarse sea
deliberado; no sustituyen a la revision humana ni a los controles del repositorio (protecciones de
rama, CI). Si necesitas una frontera dura, ponla en CI. El commit sin revision no esta entre esos
bloqueos: aqui lo sostiene la disciplina, no un hook.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada los bloqueos a aviso. Es para desbloquear una
situacion puntual, no para dejarlo fijo en el shell: con el activo el pipeline no enforcea nada.

## Antigravity CLI (`agy`)

Antigravity descubre sus personalizaciones en `.agents/`, la misma raiz que ya usa este framework,
asi que reutiliza lo que hay sin duplicarlo:

| Pieza | Donde vive | Formato |
|-------|-----------|---------|
| Contexto | Este `AGENTS.md` | Markdown, sin frontmatter, activo para todo el directorio y sus hijos |
| Skills | `.agents/skills/<nombre>/SKILL.md` | Frontmatter YAML con `name` y `description` |
| Subagentes | `.agents/plugins/sdd/agents/*.md` | Markdown con frontmatter YAML (`name`, `description`) |
| Manifiesto del bundle | `.agents/plugins/sdd/plugin.json` | Solo declara el nombre; marca el directorio como plugin |
| Hooks | `.agents/hooks.json` | Un objeto por hook; dentro, sus eventos |

Los subagentes van dentro del plugin porque es la ubicacion que la CLI reconoce para ellos; las
skills, en cambio, se cargan directamente desde la raiz de personalizaciones.

Comprueba el bundle con `agy plugin validate .agents/plugins/sdd`.

**Hooks.** `.agents/hooks.json` registra cuatro hooks `PreToolUse`, con las mismas reglas y el mismo
codigo que los demas backends (`hooks/sdd-pipeline-guard.js`, `hooks/sdd-commit-guard.js`,
`hooks/sdd-read-before-edit.js` y `hooks/sdd-turn-budget.js`):

| Matcher | Hook | Que hace |
|---------|------|----------|
| `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `create_file` | `sdd-pipeline-guard.js` | **Deniega** escribir un archivo que ninguna task de una spec APROBADA declara |
| `run_command` | `sdd-commit-guard.js` | Avisa de commits mal formados y de fugas de andamiaje |
| `read_file`, `view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `create_file` | `sdd-read-before-edit.js` | Avisa al escribir un archivo existente sin haberlo leido antes. Rastrea las lecturas via `read_file`/`view_file`; si esta CLI no dispara ese evento, se autolimita a silencio |
| `read_file`, `view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `create_file`, `run_command` | `sdd-turn-budget.js` | Cuenta las acciones sin commit y avisa al superar cada umbral. `git commit` resetea el contador. Si la CLI no expone `session_id`, se autolimita a silencio |

El registro de sesiones (`hooks/sdd-session-start.js`) **no se cablea aqui**: no consta que esta CLI
exponga un evento de arranque de sesion equivalente, y cablearlo daria un hook que nunca corre. En
este backend, por tanto, ninguna sesion escribe la linea de registro.

Dos detalles del contrato de esta CLI, distintos de los otros backends:

- El comando de cada hook se ejecuta **desde el directorio que contiene `hooks.json`** (`.agents/`).
  Por eso las rutas son `node ../hooks/...`.
- La decision viaja **solo** en el JSON de stdout (`{"decision": "...", "reason": "..."}`) y los
  valores admitidos son `allow`, `deny`, `ask` y `force_ask`. El bloqueo (`deny`) es real, no un
  aviso. Como no hay `warn`, un aviso se expresa como `allow` con motivo.

**Comandos.** Este backend no instala `commands/`: el manifiesto de instalacion solo copia `.agents/`
y `AGENTS.md`. No hace falta, porque las skills nativas de `.agents/skills/` cubren ya el mismo flujo
que esos `.toml`.

**Verificado contra `agy` 1.1.1.** La CLI esta en desarrollo activo: si una version posterior
cambia los formatos, esta seccion es lo primero que hay que revisar. Un hueco conocido: no se pudo
capturar en vivo el payload de una escritura real (hace falta iniciar sesion de forma interactiva),
asi que los matchers salen de los nombres de herramienta que documenta la propia CLI. Si una
escritura no declarada llega a colarse, lo primero que hay que comprobar es si el nombre de la
herramienta que llega al hook coincide con los del matcher.

## Modelo por defecto

Ningun modelo esta impuesto por el framework: el modelo es tuyo y depende de tu cuenta y tu
presupuesto.

- **Codex:** `.codex/config.toml` trae `model = "o4-mini"` como punto de partida razonable. Subelo
  si la planificacion se te queda corta — es el paso donde el framework se juega la calidad — y
  dejalo bajo para el trabajo mecanico.
- **Antigravity:** la CLI usa el modelo que tengas seleccionado; el framework no lo fija.

<!-- nucleo: estilo -->

- Nada de adular ni de rellenar.
- Sin coautoria de IA en el mensaje.

<!-- nucleo: limites -->

<!-- nucleo: marca-version -->

<!-- hueco: arbol-backend -->
├── .codex/
│   ├── agents/         # planificador, revisor, implementador, asesor (*.toml)
│   ├── config.toml     # modelo por defecto
│   ├── hooks.json      # 3 hooks (pipeline-guard-codex + commit-guard-codex + session-start)
│   └── rules/          # sdd-enforcement.rules (refuerzo de politica de ejecucion)
├── .agents/
│   ├── skills/         # 18 skills (auto-activacion)
│   ├── plugins/sdd/    # agentes (asesor, implementador, planificador, revisor) + manifiesto del bundle
│   └── hooks.json      # 4 hooks (pipeline-guard + commit-guard + read-before-edit + turn-budget)
├── hooks/              # hooks compartidos por los dos backends (variantes -codex incluidas)
<!-- /hueco -->

<!-- hueco: arbol-raiz -->
└── AGENTS.md           # este archivo
<!-- /hueco -->

<!-- hueco: limite-lineal -->
- Implementacion lineal por defecto — una task tras otra en orden de dependencias; el modo paralelo se activa solo si se pide de forma explicita
<!-- /hueco -->

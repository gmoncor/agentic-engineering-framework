# Agentic Engineering Framework

> Framework de plantillas para desarrollo de software asistido por IA — metodologia SDD (Spec-Driven Development).

---

## Que es esto?

Un sistema de plantillas que estructura como trabaja tu asistente de IA. En lugar de pedirle "haz esto" y esperar lo mejor, el framework impone un flujo: **planificacion exhaustiva** (spec + tasks + revision paralela + auditoria cruzada) antes de tocar codigo, seguida de **implementacion lineal** (una task tras otra en orden de dependencias, revision adversarial por task antes del commit).

Compatible con cualquier LLM via copy-paste. Integracion nativa con cuatro CLIs: Claude Code (workflows + comandos + agentes + skills), Gemini CLI (extension instalable), Codex y Antigravity (agentes + skills + hooks). Los cuatro exponen el mismo flujo; un test de paridad lo verifica (`npm test`).

El proyecto esta escrito en espanol: documentacion, plantillas, comandos y mensajes de los hooks.

---

## Aviso importante

Las plantillas guian al asistente de IA, pero la calidad del resultado depende de ti:

- **Revisa cada respuesta** — el LLM puede inventar, omitir o simplificar en exceso
- **Itera** — la primera version nunca es la mejor. Cuestiona decisiones, pide alternativas
- **No confies ciegamente** — tu eres el ingeniero, el LLM es la herramienta
- **Configura `ai_docs/core/` primero** — sin vision, planificacion y roadmap, las plantillas trabajan a ciegas

---

## El flujo SDD

El flujo SDD lleva cada solicitud por 5 pasos: especificacion, derivacion de tasks, revision, auditoria cruzada y, solo entonces, implementacion lineal (una task tras otra en orden de dependencias).

```
  [1] Solicitud
      |
      v
  [2] /planificar ─────────── Workflow: spec + tasks + revision paralela + auditoria
      |                         Detecta multi-spec y recomienda dividir
      v
  [3] Aprobacion ─────────── El usuario revisa el plan completo
      |
      v
  [4] /implementar-spec ──── Workflow: cada task en orden de dependencias + revision por task
      |                         (Claude Code: workflow que implementa, revisa y commitea
      |                          cada task antes de pasar a la siguiente)
      |                         (Gemini/Codex/Antigravity: el orquestador implementa las
      |                          tasks en orden; sin motor de workflows propio)
      v
    Codigo revisado ──────── /pr para crear la Pull Request
```

| Paso | Que pasa | Quien decide |
|------|----------|--------------|
| Solicitud | El usuario describe lo que quiere | Usuario |
| Planificar | Spec + tasks + revision paralela + auditoria cruzada | LLM (workflow) |
| Aprobacion | El usuario revisa veredicto y decide | Usuario |
| Implementar | Cada task en orden de dependencias, revision adversarial por task antes del commit | LLM (workflow) |

Principios del flujo:

- **Planificacion exhaustiva.** Cada task revisada y auditada ANTES de tocar codigo
- **Implementacion lineal.** Una task tras otra en orden de dependencias, cada una revisada y con su commit
- **Tasks atomicas.** Una task = un cambio acotado = un commit
- **Revision adversarial obligatoria.** Cada task se revisa antes de commitearla
- **Roadmap global.** El plan de trabajo vive en `ai_docs/core/` y guia cada `/planificar`
- **Orden por dependencias.** `/implementar-spec` ordena las tasks por sus dependencias y las implementa una tras otra: cada task espera a las tasks de las que depende

---

## Prerequisitos

- **Node.js >= 20** — requerido por los hooks de enforcement (`sdd-pipeline-guard.js`, `sdd-review-gate.js`, `sdd-commit-guard.js`). Sin Node.js, los hooks fallan silenciosamente y no hay enforcement del pipeline SDD. Verificar con `node --version`

## Instalacion

### Claude Code

**Opcion 1 — Proyecto nuevo (clonar y empezar):**

```bash
git clone https://github.com/gmoncor/agentic-engineering-framework.git mi-proyecto
cd mi-proyecto
rm -rf .git && git init   # tu propio repo, no un fork
claude                     # abre Claude Code — los comandos estan listos
```

Al abrir Claude Code dentro del proyecto, se carga automaticamente:
- `CLAUDE.md` como instrucciones del sistema
- `.claude/settings.json` con el modelo y los hooks
- Los 12 comandos, 4 agentes, 8 skills y los 2 workflows

**Opcion 2 — Proyecto existente (copiar lo necesario):**

Copia estas carpetas y archivos a la raiz de tu proyecto:

```
.claude/          # agentes, comandos, skills, workflows, settings
hooks/            # 3 hooks (pipeline-guard + review-gate + commit-guard)
ai_docs/          # plantillas + carpetas para tus docs
CLAUDE.md         # instrucciones del sistema
```

> **Importante:** Copia tambien `hooks/` — sin el, los hooks de `.claude/settings.json` apuntaran a archivos que no existen y Claude Code mostrara errores al inicio.
>
> **Nota:** `ai_docs/core/` incluye 3 documentos de ejemplo (dogfooding del framework). Borralos y crea los tuyos usando las plantillas de `ai_docs/core_templates/`.

**Opcion 3 — Solo plantillas (sin integracion):**

Si no usas Claude Code, copia solo `ai_docs/` y usa las plantillas por copy-paste en cualquier LLM.

### Gemini CLI

**Opcion 1 — Extension (recomendada):**

```bash
gemini extensions install https://github.com/gmoncor/agentic-engineering-framework
```

Esto instala los 12 comandos, 4 agentes y 8 skills. Comprueba con `gemini extensions list`.

> **Los hooks no viajan con la extension.** `hooks/hooks.json` los invoca con rutas relativas a la raiz del proyecto, asi que copia tambien la carpeta `hooks/` ahi. Sin ella no hay enforcement: el pipeline se convierte en una sugerencia.

**Opcion 2 — Manual:**

Copia a la raiz de tu proyecto:

```
agents/               # agentes Gemini (4)
commands/              # comandos Gemini (.toml, 12)
skills/                # skills Gemini (8)
hooks/                 # hooks de enforcement (3)
GEMINI.md              # instrucciones sistema
gemini-extension.json  # manifest
ai_docs/               # plantillas + docs de tu proyecto
```

### Codex

Requisito: el CLI de Codex instalado (`npm i -g @openai/codex`). Sin CLI no hay integracion nativa:
los agentes, las skills y los hooks no se cargan. En ese caso usa las plantillas por copy-paste.

Copia a la raiz de tu proyecto:

```
AGENTS.md              # instrucciones del proyecto (contexto compartido)
.codex/config.toml     # modelo, sandbox y politica de aprobacion
.codex/agents/         # agentes (4, .toml)
.codex/hooks.json      # hooks de enforcement
.codex/rules/          # politica de ejecucion (experimental)
.agents/skills/        # skills (17, auto-activacion por description)
hooks/                 # hooks de enforcement (guards)
ai_docs/               # plantillas + docs de tu proyecto
```

Codex descubre los agentes y las skills solos. Los comandos del flujo (planificar, implementar,
revisar, estado...) se entregan como **skills**: describe lo que quieres y la skill entra sola, o
nombrala. Los slash commands versionables estan deprecados en Codex, por eso no existen aqui.

Codex te pedira confiar (trust) en los hooks del proyecto la primera vez. Revisa `hooks/` antes.

### Antigravity

Requisito: el CLI de Antigravity (`agy`). Descubre sus personalizaciones en `.agents/`, la misma
raiz que ya usa el framework, asi que reutiliza el contexto y las skills sin duplicarlos.

Copia a la raiz de tu proyecto:

```
AGENTS.md              # instrucciones del proyecto (contexto compartido)
.agents/skills/        # skills (17, auto-activacion por description)
.agents/plugins/sdd/   # subagentes (4) + manifiesto del bundle
.agents/hooks.json     # registro de los hooks
hooks/                 # hooks de enforcement (guards)
ai_docs/               # plantillas + docs de tu proyecto
```

Valida el bundle con `agy plugin validate .agents/plugins/sdd`. El bloqueo de escrituras no
planificadas es real, no advisory. Detalle del cableado y sus limites en `AGENTS.md`.

### Sin CLI (copy-paste)

Funciona con cualquier LLM: ChatGPT, Copilot, Cursor, Windsurf, o cualquier otro.

1. Copia la carpeta `ai_docs/` a tu proyecto
2. Abre la plantilla que necesites de `ai_docs/dev_templates/`
3. Copia su contenido completo y pegalo en tu LLM
4. Describe tu tarea a continuacion del texto pegado

No requiere configuracion, plugins ni integraciones. Lee `ai_docs/README.md` para entender que hay en cada carpeta.

### Que se instala

| Componente | Donde (Claude) | Donde (Gemini) | Donde (Codex) | Donde (Antigravity) |
|------------|-----------------|-----------------|----------------|----------------------|
| Comandos | `.claude/commands/` (12) | `commands/` (12) | — (entregados como skills) | — (entregados como skills) |
| Agentes | `.claude/agents/` (4) | `agents/` (4) | `.codex/agents/` (4, `.toml`) | `.agents/plugins/sdd/agents/` (4) |
| Skills | `.claude/skills/` (8) | `skills/` (8) | `.agents/skills/` (17) | `.agents/skills/` (17) |
| Hooks | `hooks/` (3, wired en settings) | `hooks/` (3, wired en `hooks/hooks.json`) | `hooks/` (2, wired en `.codex/hooks.json`) | `hooks/` (2, wired en `.agents/hooks.json`) |
| Workflows | `.claude/workflows/` (2) | — (el orquestador implementa en orden) | — (idem) | — (idem) |
| Contexto | `CLAUDE.md` | `GEMINI.md` | `AGENTS.md` | `AGENTS.md` |
| Templates | `ai_docs/dev_templates/` (12) | `ai_docs/dev_templates/` (12) | `ai_docs/dev_templates/` (12) | `ai_docs/dev_templates/` (12) |
| Core templates | `ai_docs/core_templates/` (4) | `ai_docs/core_templates/` (4) | `ai_docs/core_templates/` (4) | `ai_docs/core_templates/` (4) |

Los cuatro backends exponen el mismo conjunto de agentes y de pasos del flujo. Un test de paridad
(`tests/backend-parity.test.js`, incluido en `npm test`) falla si uno se queda atras.

---

## Quick Start

### Paso 0: Verificar la instalacion

Abre tu CLI dentro del proyecto y prueba:

```
/estado
```

Si ves "No hay specs ni tasks creadas", la instalacion funciona. Si da error, revisa que las carpetas se copiaron correctamente.

### Proyecto nuevo — Configurar `ai_docs/core/`

**Este paso es CRITICO.** Sin documentacion en `ai_docs/core/`, las plantillas SDD trabajan a ciegas — el LLM no conoce tu proyecto y tomara decisiones arbitrarias.

Usa las plantillas de `ai_docs/core_templates/` **en orden**:

```
1. 01_vision_del_proyecto.md    → QUE construyes, PARA QUIEN y POR QUE
2. 02_planificacion_tecnica.md  → COMO se construye (datos, paginas, arquitectura)
3. 03_roadmap_de_desarrollo.md  → EN QUE ORDEN se construye todo
4. 04_setup_testing.md          → Configurar el entorno de tests (una vez)
```

Cada plantilla genera un documento en `ai_docs/core/`. El repo incluye 3 ejemplos (dogfooding) — reemplazalos con los de tu proyecto.

**Recomendaciones para `ai_docs/core/`:**

- **Itera.** La primera version nunca es perfecta. Revisa cada documento, cuestiona las decisiones, pide alternativas. Usa `/asesor` si dudas
- **Se especifico en la vision.** "Una app de tareas" no es suficiente. "App de tareas para equipos remotos con integracion Slack, modelo freemium" si lo es
- **El roadmap define el orden del trabajo.** Si las fases estan mal ordenadas o las dependencias son incorrectas, cada `/planificar` posterior arrastrara ese error
- **Actualiza cuando cambie la realidad.** Si pivotas, si cambias de stack, si un modulo ya no aplica — actualiza `core/`. Los docs obsoletos generan planes obsoletos
- **No necesitas las 4 plantillas para empezar.** Minimo: `vision_del_proyecto.md`. Ideal: las 3 primeras. `04_setup_testing.md` puede esperar hasta que tengas codigo

**Despues de configurar `core/`:** ejecuta `/planificar` con tu primera solicitud y sigue el flujo.

### Proyecto existente

Tu equipo ya tiene codigo y arquitectura. Aun asi, **documenta `ai_docs/core/` antes de planificar**:

```
1. Usa 01_vision_del_proyecto.md   → Documenta lo que YA existe (el LLM analiza tu codigo)
2. Usa 02_planificacion_tecnica.md → Genera la doc tecnica del estado actual
3. Usa 03_roadmap_de_desarrollo.md → Genera un roadmap con lo que falta por hacer
```

El LLM puede analizar tu codigo existente para generar estos documentos — no tienes que escribirlos tu desde cero. Dile "analiza el proyecto y genera la vision/planificacion/roadmap" junto con la plantilla.

```
4. Describe lo que necesitas  → /planificar (spec + tasks + revision + auditoria)
5. Revisa el plan             → Aprueba o pide ajustes
6. Implementa                 → /implementar-spec <spec> (todas las tasks + revision)
7. Crea la PR                 → /pr
```

Si no tienes tests configurados, usa `ai_docs/core_templates/04_setup_testing.md` antes del paso 6.

### Generar un buen roadmap

El roadmap (`ai_docs/core/roadmap.md`) es el mapa que guia toda la planificacion posterior. Un roadmap mal hecho genera specs mal acotadas.

**Que debe tener un buen roadmap:**
- **Fases con objetivo claro** — no "Fase 1: Backend" sino "Fase 1: API de autenticacion con JWT y registro por email"
- **Dependencias explicitas** — que debe existir ANTES de empezar cada fase
- **Alcance acotado por fase** — si una fase tiene mas de 5-6 puntos, dividirla
- **Checkboxes** — para rastrear progreso visualmente

**Como generarlo:** Copia `ai_docs/core_templates/03_roadmap_de_desarrollo.md` en tu LLM junto con la vision y planificacion tecnica. El LLM generara un roadmap basado en las dependencias reales de tu stack. Revisa el orden, cuestiona las fases, y ajusta antes de aprobar

---

## Flujo de trabajo diario

El dia a dia sigue el flujo SDD. Usa `/planificar` como punto de entrada principal:

**`/planificar`** — El workflow crea la spec, deriva tasks, revisa cada una en paralelo (esceptico: busca problemas, no confirma) y audita la coherencia cruzada. Recibiras un veredicto: APROBADO, NECESITA_AJUSTES o NECESITA_REPLANTEAMIENTO.

**Aprobacion** — Revisa el plan completo. Si es APROBADO, procede. Si necesita ajustes, aplicalos y re-evalua.

**`/implementar-spec`** — Workflow que implementa TODAS las tasks de la spec en orden de dependencias, una tras otra. Revision adversarial y commit por task. Recomendado para el flujo normal.

**`/implementar`** — Implementa UNA task individual. Para cuando necesitas control manual sobre el orden o quieres implementar una task especifica.

**Si encuentras un bug:** usa `/bugfix`.
**Si tienes dudas o necesitas decidir:** usa `/asesor`.
**Si el codigo necesita limpieza:** usa la skill `cleanup`.
**Para commit y PR:** usa `/commit` y `/pr`.

---

## Que hay en cada carpeta

```
agentic-engineering-framework/
├── README.md                    # Este archivo
├── CLAUDE.md                    # Instrucciones sistema para Claude Code
├── GEMINI.md                    # Instrucciones sistema para Gemini CLI
├── CONTRIBUTING.md              # Como contribuir (issues, PRs, estilo)
├── CHANGELOG.md                 # Historial de cambios por version
├── SECURITY.md                  # Reporte de vulnerabilidades y alcance
├── LICENSE                      # CC BY 4.0
├── package.json                 # Metadatos + engines (Node >= 20)
├── .claude-plugin/plugin.json   # Manifest para plugins Claude Code
├── .github/                     # Plantillas de issue y de Pull Request
│
├── .claude/                     # Configuracion Claude Code
│   ├── settings.json            #   model: opus-4.8 + hooks wiring
│   ├── agents/                  #   planificador, revisor, implementador, asesor
│   ├── commands/                #   12 comandos SDD
│   ├── skills/                  #   8 skills (auto-activacion)
│   └── workflows/               #   planificar.js + implementar-spec.js
│
├── agents/                      # Agentes Gemini CLI (4)
├── commands/                    # 12 comandos Gemini CLI (.toml)
├── skills/                      # 8 skills Gemini CLI
├── gemini-extension.json        # Manifest extension Gemini
│
├── AGENTS.md                    # Contexto compartido (Codex + Antigravity)
├── .codex/                      # Config, agentes (.toml), hooks y reglas de Codex
├── .agents/                     # Skills (17), subagentes y hooks de Antigravity
│
├── hooks/                       # Enforcement SDD (compartido por los 4 backends)
├── tests/                       # Canary de paridad entre backends
│
├── ai_docs/
│   ├── core_templates/          # Plantillas de planificacion inicial (01-04, usar en orden)
│   ├── dev_templates/           # Plantillas operativas SDD (copy-paste, LLM-agnostic)
│   ├── core/                    # Docs de TU proyecto (incluye ejemplos)
│   ├── tasks/                   # Tasks de TU proyecto (empieza vacia)
│   └── refs/                    # Referencias externas (empieza vacia)
│
└── .cursor/rules/               # 43 reglas para Cursor IDE (opcional)
```

### `core_templates/` — Plantillas de planificacion inicial

Se usan en orden. Cada una genera un documento en `ai_docs/core/` que alimenta a la siguiente.

| Plantilla | Para que |
|-----------|---------|
| **01 — Vision del Proyecto** | Definir QUE se construye, PARA QUIEN y POR QUE |
| **02 — Planificacion Tecnica** | Definir estructura: paginas, datos y arquitectura |
| **03 — Roadmap de Desarrollo** | Definir EN QUE ORDEN se construye todo |
| **04 — Setup de Testing** | Configurar el entorno de tests (una sola vez) |

### `dev_templates/` — Plantillas operativas SDD

Son las instrucciones que le das al LLM. Se copian tal cual — no se modifican.

| Plantilla | Paso SDD | Para que |
|-----------|----------|---------|
| `spec.md` | /planificar | Crear una especificacion |
| `tareas.md` | /planificar | Derivar tasks de una spec |
| `revisar_tarea.md` | /planificar | Revisar una task individual |
| `auditar_spec.md` | /planificar | Auditar coherencia spec + tasks |
| `implementar.md` | /implementar | Implementar una task |
| `revision_adversarial.md` | /revision | Revision adversarial post-implementacion |
| `correccion_de_bugs.md` | /bugfix | Diagnosticar y corregir bugs |
| `limpieza_de_codigo.md` | — | Revisar calidad de codigo |
| `testing_basico.md` | — | Escribir tests |
| `hacer_commit.md` | /commit | Commit limpio |
| `revision_pr.md` | /pr | Crear o revisar una PR |
| `resolver_problema.md` | /asesor | Analizar problemas y recomendar soluciones |

### `core/` — Documentacion de tu proyecto

Aqui viven los documentos generados con las plantillas de planificacion inicial. Este repo incluye 3 ejemplos (dogfooding). Reemplazalos con los de tu proyecto.

### `tasks/` — Tasks de tu proyecto

Un archivo por task: `NNN_descriptor.md`. Numeracion secuencial. Empieza vacio.

### `refs/` — Referencias externas

Documentacion de APIs, guias de estilo, specs de terceros. Lo que el LLM necesite consultar. Empieza vacio.

---

## Hooks (enforcement mecanico)

El directorio `hooks/` contiene hooks compartidos entre ambas CLIs que refuerzan reglas del framework:

| Hook | Evento | Que hace | Modo |
|------|--------|----------|------|
| `sdd-pipeline-guard.js` | Write/Edit | **Bloquea** la escritura de un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-review-gate.js` | git commit / git merge | **Bloquea** un commit/merge cuyo diff no consta revisado: la revision por task emite una senal con el hash del diff y el hook la contrasta con lo staged. Sin senal o con hash que no ata, deniega | Bloqueante (opt-in, solo Claude Code) |
| `sdd-commit-guard.js` | git commit | Verifica formato de commit (subject ≤72, tipo valido entre 12 tipos, sin Co-Authored-By IA) | Advisory |

Los hooks se activan automaticamente con Claude Code (via `.claude/settings.json`) y con Gemini CLI (via `hooks/hooks.json`). El gate de revision (`sdd-review-gate.js`) se cablea **unicamente en Claude Code**; los demas backends no lo cargan.

**Codex** usa dos hooks propios, registrados en `.codex/hooks.json`:

| Hook | Evento | Que hace | Modo |
|------|--------|----------|------|
| `sdd-pipeline-guard-codex.js` | `apply_patch` | **Deniega** aplicar un parche sobre un archivo que ninguna task de una spec APROBADA declara | Bloqueante |
| `sdd-commit-guard-codex.js` | `shell` | **Deniega** `git commit --no-verify` y `git push --no-verify`; avisa de commits mal formados | Bloqueante + advisory |

Refuerzo adicional: `.codex/rules/sdd-enforcement.rules` prohibe esos mismos comandos via politica de ejecucion (funcionalidad experimental del CLI; si tu version no la carga, el hook sigue siendo la via principal).

**Limite honesto de los hooks de Codex:** son un **guardarrail**, no una frontera completa de enforcement — asi lo declara el propio fabricante. No interceptan todas las llamadas al shell ni todas las rutas de escritura: un proceso hijo lanzado desde un comando permitido puede escapar al matcher, y el payload de `apply_patch` no tiene esquema publico estable (si el guard no puede leer las rutas del parche, avisa en vez de denegar, porque bloquear a ciegas seria arbitrario). Sirven para que el camino correcto sea el camino por defecto y para que desviarse sea deliberado. Si necesitas una frontera dura, ponla en el CI y en las protecciones de rama.

**Hay dos bloqueos reales: escrituras y commits sin revision.** `sdd-pipeline-guard.js` impide escribir codigo que nadie planifico: puede comprobarlo mecanicamente, porque el archivo que se va a escribir esta declarado en una task o no lo esta. `sdd-review-gate.js` impide commitear un diff que no consta revisado: la revision adversarial ocurre POR TASK, antes del commit, y su senal guarda el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin senal, o con un hash que no ata el diff staged, deniega. Cuando no hay diff cacheado computable no bloquea a ciegas: degrada a aviso. Que el codigo entregado se revise lo sostiene el flujo (`/implementar-spec` revisa cada task antes de commitearla) reforzado por el gate. Si necesitas una frontera aun mas dura sobre lo que llega a la rama, ponla en CI y en las protecciones de rama.

**Configuracion (`hooks/config.json`):** `sdd-review-gate.js` viene desactivado. Ponlo en `"enabled": true` para que bloquee cuando vayas a commitear codigo sin constancia de revision. El workflow `/implementar-spec` emite la senal que lo satisface; su contrato vive en `hooks/sdd-review-signal.js`. Solo se cablea en Claude Code: los demas backends no tienen motor de workflows y, por tanto, no tienen emisor de la senal — el gate ahi no podria satisfacerse por ninguna via legitima.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada ambos bloqueos (escrituras y revision) a aviso. Uso puntual para desbloquear una urgencia; si se queda fijo en el shell, el enforcement deja de existir.

**Tests:** `npm test` ejecuta los tests de contrato de los hooks (Node >= 20, sin dependencias).

**Modelo por defecto (Claude Code):** `.claude/settings.json` fija `"model": "claude-opus-4-8"`. Opus 4.8 es el modelo mas capaz para planificacion y revision exhaustiva. Override puntual con `/model sonnet` si necesitas velocidad en tareas mecanicas.

## Reglas de Cursor

El directorio `.cursor/rules/` contiene 43 reglas que replican el comportamiento del framework dentro de Cursor. Son opcionales — el framework funciona sin ellas. Si usas Cursor, copia `.cursor/` a tu proyecto.

> **Asumen un stack concreto.** La mayoria de esas reglas (38 de 43) estan escritas para **Next.js 15 + React + Drizzle + PostgreSQL + Python**: dan por hecho ese runtime, esas convenciones y ese ORM. Si tu proyecto usa otro stack, revisalas y adaptalas antes de copiar `.cursor/` — o copia solo las que sean agnosticas. Las reglas del flujo SDD (las que no son de stack) valen para cualquier proyecto.

---

## Actualizacion

Para recibir cambios nuevos del framework:

**Gemini CLI (extension):**
```
gemini extensions update sdd-framework
```

**Claude Code / manual:**
```bash
# Desde el repo del framework (si lo clonaste):
git pull origin main

# Para un proyecto existente:
# Copia las carpetas actualizadas (.claude/, hooks/, CLAUDE.md, ai_docs/dev_templates/, ai_docs/core_templates/)
# NO sobrescribas ai_docs/core/, ai_docs/tasks/ ni ai_docs/refs/ — esos son TUS documentos
```

**Que se actualiza y que no:**
| Se actualiza (del framework) | NO se toca (tuyo) |
|------|------|
| `.claude/` (comandos, agentes, skills, workflows) | `ai_docs/core/` (vision, planificacion, roadmap) |
| `hooks/` (enforcement) | `ai_docs/tasks/` (specs y tasks) |
| `ai_docs/dev_templates/` (plantillas operativas) | `ai_docs/refs/` (referencias externas) |
| `ai_docs/core_templates/` (plantillas de planificacion) | Codigo de tu proyecto |
| `CLAUDE.md` / `GEMINI.md` (instrucciones sistema) | |

---

## Contribuir

Las contribuciones son bienvenidas. Lee **[CONTRIBUTING.md](CONTRIBUTING.md)** antes de abrir una Pull Request: explica como reportar bugs, como proponer mejoras, el estilo de commits y la regla de paridad entre las dos CLIs.

Resumen: abre un issue → haz fork → crea una rama → abre la PR rellenando la plantilla.

---

## Changelog

El historial de cambios por version esta en **[CHANGELOG.md](CHANGELOG.md)**, en formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Consultalo antes de actualizar: las entradas marcadas como *Breaking* indican que debes migrar algo en tu proyecto.

---

## Seguridad

Para reportar una vulnerabilidad, sigue el proceso de **[SECURITY.md](SECURITY.md)** — no abras un issue publico.

Ten presente que el framework **guia** al asistente de IA, pero no verifica el codigo que genera. Los hooks bloquean escrituras fuera del pipeline y commits cuyo diff no consta revisado; no verifican la correccion del codigo. Revisa y audita todo lo que llegue a produccion.

---

## Licencia

Este proyecto esta licenciado bajo [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE).

Puedes usar, copiar, modificar y distribuir este material para cualquier proposito, incluso comercial, siempre que des credito al autor original.

> **Nota:** el repositorio incluye codigo ejecutable (hooks y workflows `.js`). CC BY 4.0 es una licencia de contenido y Creative Commons desaconseja usarla para software; se mantiene por simplicidad, dado que el grueso del repositorio son plantillas y documentacion. Si necesitas el codigo bajo una licencia de software explicita (MIT, Apache-2.0), abre un issue. Ver la nota completa en [LICENSE](LICENSE).

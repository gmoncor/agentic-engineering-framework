# Agentic Engineering Framework

> Framework de plantillas para desarrollo de software asistido por IA — metodologia SDD (Spec-Driven Development).

---

## Que es esto?

Un sistema de plantillas que estructura como trabaja tu asistente de IA. En lugar de pedirle "haz esto" y esperar lo mejor, el framework impone un flujo: **planificacion exhaustiva** (spec + tasks + revision paralela + auditoria cruzada) antes de tocar codigo, seguida de **implementacion de una sola tarea seleccionada por sesion con dependencias satisfechas** (revision adversarial antes del commit; se permite paralelismo interno, pero no ejecutar multiples tasks).

Compatible con cualquier LLM via copy-paste. Integracion nativa con cuatro CLIs: Claude Code (workflows + comandos + agentes + skills), Gemini CLI (extension instalable), Codex y Antigravity (agentes + skills + hooks). Los cuatro exponen el mismo flujo; un test de paridad lo verifica (`npm test`).

El proyecto esta escrito en espanol: documentacion, plantillas, comandos y mensajes de los hooks.

---

## Aviso importante

Las plantillas guian al asistente de IA, pero la calidad del resultado depende de ti:

- **Revisa cada respuesta** — el LLM puede inventar, omitir o simplificar en exceso
- **Itera** — la primera version nunca es la mejor. Cuestiona decisiones, pide alternativas
- **No confies ciegamente** — tu eres el ingeniero, el LLM es la herramienta
- **Configura `ai_docs/core/` primero** — sin vision, planificacion y roadmap, las plantillas trabajan a ciegas
- **Dogfooding real** — Claude Code es el backend con verificacion diaria propia del autor. Gemini CLI, Codex y Antigravity estan implementados, con hooks cableados y tests de paridad en verde, pero sin dogfooding propio. Todos los backends tienen el mismo nivel de exigencia de paridad

---

## El flujo SDD

El flujo SDD lleva cada solicitud por 5 pasos: especificación, derivación de tasks, revisión, auditoría cruzada y, solo entonces, implementación de la tarea de producto que selecciones.

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
  [4] /implementar <task> ── Implementa una tarea seleccionada + revisión adversarial
      |                         (La investigación y la revisión internas pueden usar
      |                          subagentes en paralelo cuando el alcance lo justifica.)
      v
    Codigo revisado ──────── /pr para crear la Pull Request
```

| Paso | Que pasa | Quien decide |
|------|----------|--------------|
| Solicitud | El usuario describe lo que quiere | Usuario |
| Planificar | Spec + tasks + revision paralela + auditoria cruzada | LLM (workflow) |
| Aprobacion | El usuario revisa veredicto y decide | Usuario |
| Implementar | Una tarea seleccionada, con revisión adversarial antes del commit | LLM |

Principios del flujo:

- **Conversar no planifica.** Consultar, leer, pedir orientación o estado recibe respuesta sin crear proceso. Solo una petición de planificación inicia el flujo.
- **Una task por sesión.** El alcance se decide por riesgo, datos y contratos; no hay un máximo fijo de ficheros. Tras planificar, se recomienda implementar en una sesión independiente.
- **Planificación exhaustiva.** Cada task se revisa y audita antes de tocar código.
- **Tasks atómicas.** Una task es un cambio acotado y puede cerrar en un commit.
- **Revisión adversarial obligatoria.** La task seleccionada se revisa antes de cerrarla.
- **Roadmap global.** El plan de trabajo vive en `ai_docs/core/` y guia cada `/planificar`
- **Dependencias verificadas.** Antes de implementar una task, confirma que sus dependencias están resueltas o declara el bloqueo.

### Revisión de convergencia de una tarea

Al cerrar una task seleccionada, `/revision` verifica que el cambio cubre sus criterios asignados y respeta las exclusiones declaradas.

- **Cuándo corre:** antes de cerrar la task seleccionada. Si la validación falla, conserva el trabajo y declara el bloqueo.
- **Qué produce:** un veredicto de revisión con los criterios cubiertos y los huecos encontrados.
- **Cómo repetirla:** invoca `/revision` sobre la task y su diff, sin repetir la implementación.

---

## Prerequisitos

- **Node.js >= 20** — requerido por los hooks de enforcement (`sdd-pipeline-guard.js`, `sdd-review-gate.js`, `sdd-commit-guard.js`, `sdd-read-before-edit.js`, `sdd-turn-budget.js`) y por el hook de registro de sesiones (`sdd-session-start.js`). Sin Node.js, los hooks fallan silenciosamente y no hay enforcement del pipeline SDD. Verificar con `node --version`. Si un hook se ejecuta con una version menor, avisa (sin bloquear) por stderr la primera vez que corre en el proceso.

## Instalacion

**Via CLI (recomendado):**

```bash
npx github:gmoncor/agentic-engineering-framework install --backend <claude|gemini|codex|antigravity|all>
```

Copia las rutas del backend elegido (segun `scripts/backend-manifest.json`) y crea `ai_docs/{core,tasks,refs}/` si no existen. Tambien copia un `.gitignore` con las reglas del framework (protege `.sdd-installed-hashes.json`, `ai_docs/tasks/`, `ai_docs/refs/`, `.worktrees/`, etc.); si ya tenias uno propio, `update` posterior respeta tus ediciones (ver Actualizacion). Sin `--backend`, pregunta interactivamente que backend instalar (requiere terminal). Usa `all` para instalar los cuatro a la vez. Requiere `npx` con Node.js >= 20 (ver Prerequisitos) y acceso al repo.

> **Proyecto existente:** si el directorio ya tiene archivos propios con el mismo nombre que los
> del framework (`hooks/`, `scripts/`, etc.), `install`/`update` detectan la colision antes de
> escribir nada: en terminal interactivo piden confirmacion (`y/N`, por defecto cancela); en
> CI/pipe (sin terminal) abortan con exit 1 salvo que uses `--force`. Usa `--dry-run` para
> previsualizar que ficheros se copiarian o saltarian sin tocar disco antes de decidir. Los
> archivos protegidos (`CLAUDE.md`, `hooks/config.json`, `.claude/settings.json`, `.gitignore`,
> etc.) quedan fuera de esta deteccion de colision: se saltan solos si tienen ediciones locales,
> incluso con `--force` (ver Actualizacion para el detalle del mecanismo de hashes).

### Claude Code

**Via CLI:**
```bash
npx github:gmoncor/agentic-engineering-framework install --backend claude
```
Copia `.claude/` (agentes, comandos, skills, workflows, settings), `hooks/`, `CLAUDE.md` y las plantillas de `ai_docs/`.

> **Importante:** El CLI copia `hooks/` junto con `.claude/` — sin ella, los hooks de `.claude/settings.json` apuntarian a archivos inexistentes.
>
> **Nota:** `ai_docs/core/` incluye 3 documentos de ejemplo (dogfooding del framework) solo si clonas el repo completo; el CLI crea la carpeta vacia. Usa las plantillas de `ai_docs/core_templates/` para los tuyos.
>
> **Version instalada:** el archivo de contexto incluye un marcador de version al pie (`<!-- sdd-framework: X.Y.Z -->`). Cotejalo contra el `CHANGELOG.md` del repositorio para saber si hay actualizaciones.
>
> **Modelo default:** `settings.json` configura `claude-opus-4-8` como modelo de sesion — el mas capaz
> para planificacion y revision, pero el de precio mas alto. Si prefieres un modelo mas economico,
> cambialo con `/model sonnet` durante la sesion o editando `.claude/settings.json` directamente.
> Ver "Modelo por defecto" en CLAUDE.md para mas detalle.

**Alternativa manual — proyecto nuevo (clonar y empezar):**
```bash
git clone https://github.com/gmoncor/agentic-engineering-framework.git mi-proyecto
cd mi-proyecto
rm -rf .git && git init   # tu propio repo, no un fork
claude                     # abre Claude Code — los comandos estan listos
```

**Alternativa manual — proyecto existente:** copia `.claude/`, `hooks/`, `ai_docs/` y `CLAUDE.md` a la raiz de tu proyecto.

> **Sin plugin nativo de Claude Code.** El framework no distribuye un manifest de plugin (`.claude-plugin/plugin.json`): un plugin nativo se copia al cache de Claude Code (`~/.claude/plugins/cache`), no al proyecto destino, asi que no puede entregar `CLAUDE.md` como contexto de proyecto ni escribir `.claude/agents/`, `.claude/commands/`, `.claude/skills/` ni `hooks/` en tu repo — justo lo que la via de instalacion de arriba si hace. Usa `npx github:gmoncor/agentic-engineering-framework install --backend claude`.

### Gemini CLI

**Via CLI (framework):**
```bash
npx github:gmoncor/agentic-engineering-framework install --backend gemini
```
Copia `.gemini/agents/`, `.gemini/commands/`, `.gemini/skills/`, `hooks/`, `gemini-extension.json`, `GEMINI.md` y las plantillas de `ai_docs/`. Equivale a copiar los archivos a mano. El namespace `.gemini/` evita colisionar con una carpeta `agents/`, `commands/` o `skills/` que ya exista en tu proyecto por otro motivo, y coincide con la convencion de Gemini CLI para comandos y subagentes de proyecto.

> **Version instalada:** el archivo de contexto incluye un marcador de version al pie (`<!-- sdd-framework: X.Y.Z -->`). Cotejalo contra el `CHANGELOG.md` del repositorio para saber si hay actualizaciones.
>
> **Distinto de la extension nativa.** `gemini extensions install` instala la extension dentro del CLI de Gemini (gestionada con `gemini extensions list/update`); el comando de arriba copia los archivos del framework directamente a tu proyecto. Son dos vias independientes que coexisten.

**Extension nativa (alternativa, si prefieres el gestor de extensiones de Gemini):**
```bash
gemini extensions install https://github.com/gmoncor/agentic-engineering-framework
```
> **Limitacion conocida.** El instalador de extensiones de Gemini CLI busca `commands/`, `skills/` y `agents/` sueltos en la raiz del repositorio de la extension; como el framework los guarda bajo `.gemini/` (para evitar la colision de nombres descrita arriba), esta via solo instala el contexto (`GEMINI.md`) y no cablea `hooks/` por si sola. Usa **Via CLI (framework)** de arriba para una instalacion completa; conserva esta via solo si ya usas el gestor de extensiones para otra cosa.

> **Los hooks no viajan con la extension.** `hooks/hooks.json` los invoca con rutas relativas a la raiz del proyecto, asi que copia tambien la carpeta `hooks/` ahi (via CLI del framework o a mano). Sin ella no hay enforcement: el pipeline se convierte en una sugerencia.

**Alternativa manual:** copia `.gemini/agents/`, `.gemini/commands/`, `.gemini/skills/`, `hooks/`, `GEMINI.md`, `gemini-extension.json` y `ai_docs/` a la raiz de tu proyecto.

### Codex

Requisito: el CLI de Codex instalado (`npm i -g @openai/codex`). Sin CLI no hay integracion nativa:
los agentes, las skills y los hooks no se cargan. En ese caso usa las plantillas por copy-paste.

**Via CLI:**
```bash
npx github:gmoncor/agentic-engineering-framework install --backend codex
```
Copia `AGENTS.md`, `.codex/` (config, agentes, hooks, reglas), `.agents/skills/`, `hooks/` y `ai_docs/`.

> **Version instalada:** el archivo de contexto incluye un marcador de version al pie (`<!-- sdd-framework: X.Y.Z -->`). Cotejalo contra el `CHANGELOG.md` del repositorio para saber si hay actualizaciones.

Codex descubre los agentes y las skills solos. Los comandos del flujo (planificar, implementar,
revisar, estado...) se entregan como **skills**: describe lo que quieres y la skill entra sola, o
nombrala. Los slash commands versionables estan deprecados en Codex, por eso no existen aqui.

Codex te pedira confiar (trust) en los hooks del proyecto la primera vez. Revisa `hooks/` antes.

**Alternativa manual:** copia `AGENTS.md`, `.codex/config.toml`, `.codex/agents/`, `.codex/hooks.json`, `.codex/rules/`, `.agents/skills/`, `hooks/` y `ai_docs/` a la raiz de tu proyecto.

> **Sin via nativa de instalacion en Codex CLI.** Codex tiene un gestor de plugins (`codex plugin add`, verificado en la version `0.147.0`), pero instala en el cache del usuario (`~/.codex/plugins/cache`), no en el proyecto: el manifiesto del plugin (`plugin.json`) no tiene campo para entregar `AGENTS.md` como contexto de proyecto, y los componentes que si declara (`skills`, `hooks`, `mcpServers`) quedan fuera del repo, sin versionar y compartidos por todas las sesiones de Codex de la maquina en vez de aislados por proyecto — justo lo que la via de instalacion de arriba si hace. Usa `npx github:gmoncor/agentic-engineering-framework install --backend codex`.

### Antigravity

Requisito: el CLI de Antigravity (`agy`). Descubre sus personalizaciones en `.agents/`, la misma
raiz que ya usa el framework, asi que reutiliza el contexto y las skills sin duplicarlos.

**Via CLI:**
```bash
npx github:gmoncor/agentic-engineering-framework install --backend antigravity
```
Copia `AGENTS.md`, `.agents/` (skills, plugin de subagentes, hooks), `hooks/` y `ai_docs/`.

> **Version instalada:** el archivo de contexto incluye un marcador de version al pie (`<!-- sdd-framework: X.Y.Z -->`). Cotejalo contra el `CHANGELOG.md` del repositorio para saber si hay actualizaciones.

Valida el bundle con `agy plugin validate .agents/plugins/sdd`. El bloqueo de escrituras no
planificadas es real, no advisory. Detalle del cableado y sus limites en `AGENTS.md`.

**Alternativa manual:** copia `AGENTS.md`, `.agents/skills/`, `.agents/plugins/sdd/`, `.agents/hooks.json`, `hooks/` y `ai_docs/` a la raiz de tu proyecto.

### Sin CLI (copy-paste)

Funciona con cualquier LLM: ChatGPT, Copilot, Cursor, Windsurf, o cualquier otro sin integracion nativa.

1. Copia la carpeta `ai_docs/` a tu proyecto
2. Abre la plantilla que necesites de `ai_docs/dev_templates/`
3. Copia su contenido completo y pegalo en tu LLM
4. Describe tu tarea a continuacion del texto pegado

No requiere configuracion, plugins ni integraciones. Lee `ai_docs/README.md` para entender que hay en cada carpeta.

Algunas herramientas sin backend propio leen `AGENTS.md` como contexto del proyecto. El paso 1 no lo copia: para ellas, copia también `AGENTS.md` y `.agents/skills/` junto a `ai_docs/` en la raíz de tu proyecto (o instala con `--backend codex`, que los entrega junto con `.codex/`). Ahí llegan las reglas escritas, pero no el enforcement:

| Herramienta | Qué lee | Hooks | Workflows |
|-------------|---------|-------|-----------|
| GitHub Copilot | `AGENTS.md` | No corren | No corren |
| Windsurf | `AGENTS.md` | No corren | No corren |
| Devin | `AGENTS.md` | No corren | No corren |

Sin hooks, nada bloquea una escritura no planificada ni un commit sin revisión: el flujo SDD se sigue por disciplina y la frontera dura va en CI y en las protecciones de rama.

### Que se instala

| Componente | Donde (Claude) | Donde (Gemini) | Donde (Codex) | Donde (Antigravity) |
|------------|-----------------|-----------------|----------------|----------------------|
| Comandos | `.claude/commands/` (13) | `.gemini/commands/` (13) | — (entregados como skills) | — (entregados como skills) |
| Agentes | `.claude/agents/` (4) | `.gemini/agents/` (4) | `.codex/agents/` (4, `.toml`) | `.agents/plugins/sdd/agents/` (4) |
| Skills | `.claude/skills/` (9)* | `.gemini/skills/` (8) | `.agents/skills/` (18) | `.agents/skills/` (18) |
| Hooks | `hooks/` (6, wired en settings) | `hooks/` (5, wired en `hooks/hooks.json`) | `hooks/` (3, wired en `.codex/hooks.json`) | `hooks/` (4, wired en `.agents/hooks.json`) |
| Workflows | `.claude/workflows/` (2) | — (el orquestador implementa en orden) | — (idem) | — (idem) |
| Contexto | `CLAUDE.md` | `GEMINI.md` | `AGENTS.md` | `AGENTS.md` |
| Templates | `ai_docs/dev_templates/` (13) | `ai_docs/dev_templates/` (13) | `ai_docs/dev_templates/` (13) | `ai_docs/dev_templates/` (13) |
| Core templates | `ai_docs/core_templates/` (4) | `ai_docs/core_templates/` (4) | `ai_docs/core_templates/` (4) | `ai_docs/core_templates/` (4) |

Las rutas coinciden con `scripts/backend-manifest.json`, que ademas marca `scripts/`, `CHANGELOG.md` y
`docs/extension-config-schema.md` como comunes a todos los backends: son infraestructura del CLI,
metadatos y documentacion de referencia, no componentes del flujo SDD, por eso la tabla no los lista.
Ese documento se instala porque los hooks lo citan por su ruta: sin el, un aviso te mandaria a un
fichero que no tienes. `package.json` nunca se copia: el CLI anade solo `scripts.test` al
`package.json` del proyecto destino (creando uno minimo si no existe), sin tocar nombre, dependencias
ni el resto de scripts del usuario.

\* `auditar-sesion` es exclusiva de Claude Code: analiza las transcripciones nativas JSONL que este
backend escribe en `~/.claude/projects/`, un formato que ningun otro backend produce.

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

**Con Claude Code o Gemini CLI:** ejecuta `/inicio`. Lee las 4 plantillas en orden, conduce la conversacion y escribe los documentos en `ai_docs/core/` sin que tengas que copiar y pegar nada.

**Sin CLI, o si prefieres el flujo manual:** usa las plantillas de `ai_docs/core_templates/` **en orden**:

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

Tu equipo ya tiene codigo y arquitectura. Antes de nada, corre `install` con `--dry-run` para ver
que ficheros se copiarian o saltarian sin tocar disco (ver aviso de "Proyecto existente" en
Instalacion). Luego, **documenta `ai_docs/core/` antes de planificar**:

```
1. Usa 01_vision_del_proyecto.md   → Documenta lo que YA existe (el LLM analiza tu codigo)
2. Usa 02_planificacion_tecnica.md → Genera la doc tecnica del estado actual
3. Usa 03_roadmap_de_desarrollo.md → Genera un roadmap con lo que falta por hacer
```

El LLM puede analizar tu codigo existente para generar estos documentos — no tienes que escribirlos tu desde cero. Dile "analiza el proyecto y genera la vision/planificacion/roadmap" junto con la plantilla.

```
4. Describe lo que necesitas  → /planificar (spec + tasks + revision + auditoria)
5. Revisa el plan             → Aprueba o pide ajustes
6. Implementa                 → /implementar <task> (una task + revisión)
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

### Ejemplo completo: de /planificar a /pr

> Ejemplo ficticio para ilustrar el flujo. Los archivos, endpoints y comandos de test son inventados.

Un vistazo rapido a como se conectan los pasos, desde la solicitud inicial hasta la PR final: la spec fija el contrato, las tasks lo reparten en cambios atomicos, y la revision valida cada uno antes de comitear. Los pasos siguientes muestran el detalle de cada etapa.

**1. Solicitud al asistente:**

"Quiero un endpoint GET /api/health que devuelva `{ status: "ok" }` con test e2e."

**2. Fragmento de spec generada (`/planificar`):**

| # | Criterio de exito | Verificacion |
|---|---|---|
| 1 | GET /api/health retorna 200 con `{ status: "ok" }` | `curl localhost:3000/api/health` |
| 2 | Test e2e cubre respuesta 200 y body exacto | test runner del proyecto en verde |
| 3 | Ruta registrada en el router principal | `grep "/api/health" src/routes/index.ts` |
| 4 | Sin dependencias nuevas anadidas al proyecto | `git diff package.json` vacio |

**3. Tasks derivadas** (el auditor cruzado verifica que cada criterio tenga cobertura):

| Task | Archivos | Depende de |
|---|---|---|
| 01 Endpoint health | `src/routes/health.ts`, `src/routes/index.ts` | -- |
| 02 Test e2e health | `tests/e2e/health.test.ts` | 01 |

**4. Auditoria cruzada:** "Cada criterio tiene task asignada, cobertura verificable. APROBADA."

**5. Implementación (`/implementar ai_docs/tasks/01_endpoint_health.md`):** implementa la tarea seleccionada y aplica una revisión adversarial antes del commit.

**6. Cierre (`/pr`):** PR abierto con una descripción autogenerada a partir de la spec y la task implementada.

Todo el flujo — planificacion, implementacion y cierre — queda trazado en los commits y la spec, sin pasos manuales adicionales.

---

## Flujo de trabajo diario

El dia a dia sigue el flujo SDD. Usa `/planificar` como punto de entrada principal:

**`/planificar`** — El workflow crea la spec, deriva tasks, revisa cada una en paralelo (esceptico: busca problemas, no confirma) y audita la coherencia cruzada. Recibiras un veredicto: APROBADO, NECESITA_AJUSTES o NECESITA_REPLANTEAMIENTO.

**Aprobacion** — Revisa el plan completo. Si es APROBADO, procede. Si necesita ajustes, aplicalos y re-evalua.

**`/implementar`** — Implementa una task por sesión. Relee su alcance y estado, aplica la revisión adversarial y recomienda el siguiente paso.

**Si encuentras un bug:** usa `/bugfix`.
**Si tienes dudas o necesitas decidir:** usa `/asesor`.
**Si el codigo necesita limpieza:** usa la skill `cleanup`.
**Para commit y PR:** usa `/commit` y `/pr`.

---

## Modos de ejecucion

Cada sesión implementa una sola tarea de producto. El alcance se decide por riesgo, datos y contratos. No hay un máximo fijo de ficheros ni un flujo que ejecute varias tareas de producto a la vez.

La investigación y la revisión de esa tarea sí pueden usar subagentes en paralelo. El responsable conserva una sola conclusión, una sola decisión sobre el cambio y un único flujo de escritura.

### Garantías de la tarea

- **Autorización única.** Tras aprobar el plan, una petición que también incluya implementar continúa sin pedir una segunda autorización. Se recomienda abrir una sesión independiente, pero la recomendación no bloquea la petición conjunta.
- **Límite de la recomendación.** El modelo puede omitirla incluso con las instrucciones precargadas. Se conserva como instrucción y no añade un bloqueo.
- **Pruebas y revisión adversarial.** El banco del proyecto se ejecuta antes de revisar. Un revisor con contexto limpio examina el diff. Los hallazgos críticos se corrigen y se vuelve a validar antes de cerrar.
- **Preservación.** Ninguna ruta ejecuta `git reset --hard` ni `git clean`. Si una validación no permite cerrar, el trabajo se conserva para que pueda revisarse o recuperarse.
- **Siguiente paso.** Al cerrar, el responsable propone un único siguiente paso accionable.

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
├── package.json                 # Metadatos + engines (Node >= 20.11)
├── .github/                     # Plantillas de issue y de Pull Request
│
├── .claude/                     # Configuracion Claude Code
│   ├── settings.json            #   model: opus-4.8 + hooks wiring
│   ├── agents/                  #   planificador, revisor, implementador, asesor
│   ├── commands/                #   13 comandos SDD
│   ├── skills/                  #   9 skills (auto-activacion; 1 exclusiva de Claude Code)
│   └── workflows/               #   planificar.js y soporte de implementación
│
├── .gemini/                     # Configuracion Gemini CLI (namespace evita colision con carpetas del usuario)
│   ├── agents/                  #   4 agentes Gemini CLI
│   ├── commands/                #   13 comandos Gemini CLI (.toml)
│   └── skills/                  #   8 skills Gemini CLI
├── gemini-extension.json        # Manifest extension Gemini
│
├── AGENTS.md                    # Contexto compartido (Codex + Antigravity)
├── .codex/                      # Config, agentes (.toml), hooks y reglas de Codex
├── .agents/                     # Skills (18), subagentes y hooks de Antigravity
│
├── hooks/                       # Enforcement SDD + registro de sesiones (compartido por los 4 backends)
├── docs/                        # Referencia: esquema de sdd.config.json (configuracion propia del proyecto)
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
| `actualizar_framework.md` | — | Traer una version mas reciente del framework ya instalado |

### `core/` — Documentacion de tu proyecto

Aqui viven los documentos generados con las plantillas de planificacion inicial. Este repo incluye 3 ejemplos (dogfooding). Reemplazalos con los de tu proyecto.

### `tasks/` — Tasks de tu proyecto

Un archivo por task: `NNN_descriptor.md`. Numeracion secuencial. Empieza vacio.

### `refs/` — Referencias externas

Documentacion de APIs, guias de estilo, specs de terceros. Lo que el LLM necesite consultar. Empieza vacio.

---

## Hooks (enforcement mecanico)

El directorio `hooks/` contiene hooks compartidos por los cuatro backends. Los cinco primeros refuerzan reglas del framework; el ultimo no enforcea nada, escribe el registro de sesiones:

| Hook | Evento | Que hace | Modo |
|------|--------|----------|------|
| `sdd-pipeline-guard.js` | Write/Edit | **Bloquea** la escritura de un archivo que no esta declarado en la tabla "Archivos afectados" de alguna task de la spec APROBADA activa | Bloqueante |
| `sdd-review-gate.js` | git commit / git merge | **Bloquea** un commit/merge cuyo diff no consta revisado: la revision por task emite una senal con el hash del diff y el hook la contrasta con lo staged. Sin senal o con hash que no ata, deniega | Bloqueante (opt-in, solo Claude Code) |
| `sdd-commit-guard.js` | git commit / git push | **Bloquea** `--no-verify` (y el alias corto `-n` en commit); avisa si subject >72 chars, tipo invalido, o Co-Authored-By con IA | Advisory / Bloqueante (`--no-verify`) |
| `sdd-read-before-edit.js` | Read/Write/Edit | Avisa al escribir un archivo existente sin haberlo leido antes en la sesion. Nunca bloquea; se autolimita a silencio en backends que no exponen el evento de lectura | Advisory |
| `sdd-turn-budget.js` | Todas las tool calls | Cuenta las acciones sin commit y avisa al superar cada umbral (`git commit` resetea el contador). Umbrales y `mode` configurables; `mode: enforce` convierte los avisos en bloqueo | Advisory |
| `sdd-session-start.js` | Arranque de sesion | No enforcea nada: **escribe**. Anade una linea al registro de sesiones (`ai_docs/audits/provenance.jsonl`, dentro de tu repositorio) con directorio de trabajo, rama, commit, el modelo de la sesión si el CLI lo envía en el arranque (si no, `null`) y hashes de los componentes instalados | Registro (activo por defecto) |

Los hooks se activan automaticamente con Claude Code (via `.claude/settings.json`) y con Gemini CLI (via `hooks/hooks.json`). El gate de revision (`sdd-review-gate.js`) se cablea **unicamente en Claude Code**; los demas backends no lo cargan. El registro de sesiones (`sdd-session-start.js`) se cablea en Claude Code, Gemini CLI y Codex; en Antigravity no, porque no consta que su CLI exponga un evento de arranque de sesion equivalente.

**Codex** usa dos hooks propios, registrados en `.codex/hooks.json`:

| Hook | Evento | Que hace | Modo |
|------|--------|----------|------|
| `sdd-pipeline-guard-codex.js` | `apply_patch` | **Deniega** aplicar un parche sobre un archivo que ninguna task de una spec APROBADA declara | Bloqueante |
| `sdd-commit-guard-codex.js` | `Bash` (shell) | **Deniega** `git commit --no-verify` y `git push --no-verify`; avisa de commits mal formados | Bloqueante + advisory |

Ademas del par de guards, `.codex/hooks.json` cablea el registro de sesiones (`sdd-session-start.js`), que es el mismo codigo compartido con los demas backends.

Refuerzo adicional: `.codex/rules/sdd-enforcement.rules` prohíbe esos mismos comandos mediante la política de ejecución. En codex-cli 0.162.1 las reglas cargan con `justification` y bloquean `git commit --no-verify`; un parámetro que `prefix_rule` no reconoce impide arrancar Codex. Comprobación: `codex execpolicy check`.

**Limite honesto de los hooks de Codex:** son un **guardarrail**, no una frontera completa de enforcement — asi lo declara el propio fabricante. No interceptan todas las llamadas al shell ni todas las rutas de escritura: un proceso hijo lanzado desde un comando permitido puede escapar al matcher, y el payload de `apply_patch` no tiene esquema publico estable (si el guard no puede leer las rutas del parche, avisa en vez de denegar, porque bloquear a ciegas seria arbitrario). Sirven para que el camino correcto sea el camino por defecto y para que desviarse sea deliberado. Si necesitas una frontera dura, ponla en el CI y en las protecciones de rama.

**Antigravity** carga cuatro hooks via `.agents/hooks.json`: `sdd-pipeline-guard.js` (guard de escrituras), `sdd-commit-guard.js` (guard de commits), `sdd-read-before-edit.js` (aviso de lectura previa) y `sdd-turn-budget.js` (contador de acciones sin commit). No carga el registro de sesiones (`sdd-session-start.js`), por la razon ya dada arriba: no consta que su CLI exponga un evento de arranque de sesion equivalente.

**Hay dos bloqueos reales: escrituras y commits sin revision.** `sdd-pipeline-guard.js` impide escribir codigo que nadie planifico: puede comprobarlo mecanicamente, porque el archivo que se va a escribir esta declarado en una task o no lo esta. Cubre las herramientas de edición del agente (en Claude Code, `Write`, `Edit` y `NotebookEdit`); lo que se escribe por shell (`>`, `tee`, `sed -i`, `cp`) no pasa por él y solo lo detecta la revisión del diff. `sdd-review-gate.js` impide commitear un diff que no consta revisado: la revisión adversarial ocurre por task, antes del commit, y su señal guarda el hash del diff revisado; el hook recalcula el hash de `git diff --cached` y lo contrasta. Sin señal, o con un hash que no ata el diff staged, deniega. Cuando no hay diff cacheado computable degrada a aviso, para no bloquear a ciegas. El flujo de implementación aplica la revisión antes de cerrar la task y el gate la refuerza. Si necesitas una frontera aun más dura sobre lo que llega a la rama, ponla en CI y en las protecciones de rama.

**Configuración (`hooks/config.json`):** `sdd-review-gate.js` viene desactivado. Ponlo en `"enabled": true` para que bloquee cuando vayas a commitear código sin constancia de revisión. El flujo de implementación emite la señal que lo satisface; su contrato vive en `hooks/sdd-review-signal.js`. Solo se cablea en Claude Code: los demás backends no tienen motor de workflows y, por tanto, no tienen emisor de la señal; el gate ahí no podría satisfacerse por ninguna vía legítima.

**Registro de sesiones y como apagarlo (`hooks/config.json`):** `sdd-session-start.js` viene **activo**. En cada arranque de sesion anade una linea al fichero `ai_docs/audits/provenance.jsonl`, dentro de tu repositorio, con el directorio de trabajo, la rama, el commit, el modelo de la sesión si el CLI lo envía en el arranque (si no, `null`) y hashes de los componentes instalados. No envia nada a ningun sitio: escribe un fichero local (el `.gitignore` que instala el framework lo excluye del control de versiones). Para que deje de escribir, pon `"sdd_session_start": { "enabled": false }`: con `false` el hook no escribe nada, ni la linea ni el fichero.

**Configuracion propia de tu proyecto (`sdd.config.json`):** el destino de ese registro y los campos que quieras anadir a cada linea se declaran en un fichero opcional en la raiz de tu proyecto, que la actualizacion del framework nunca sobreescribe. Casi ningun proyecto lo necesita. Esquema completo, precedencias y casos limite: [`docs/extension-config-schema.md`](docs/extension-config-schema.md), que se instala junto al framework, asi que tambien lo tienes en tu proyecto.

**Escape de emergencia:** `SDD_GUARD_SKIP=1` degrada ambos bloqueos (escrituras y revision) a aviso. Uso puntual para desbloquear una urgencia; si se queda fijo en el shell, el enforcement deja de existir.

**Limite honesto de la senal de revision:** el hash que `sdd-review-gate.js` contrasta protege contra commits accidentales sin revision, no contra una falsificacion deliberada. El diff cacheado es visible para cualquier proceso con acceso a shell en la misma sesion, asi que ese mismo proceso puede recalcular el hash y escribir la senal directamente, sin haber pasado la revision adversarial. No es una limitacion cerrable mezclando un secreto en el hash: para que el gate lo verifique de forma mecanica, el secreto tendria que persistir en un sitio (disco, variable de entorno) igual de accesible para quien intenta falsificar la senal, lo que anula la proteccion que se buscaba anadir. La senal ata el diff a "hubo una revision", no autentica quien la emitio. Para una frontera dura frente a falsificacion deliberada, usa proteccion de rama y CI, no este hook.

**Tests:** `npm test` ejecuta los tests de contrato de los hooks (Node >= 20.11, sin dependencias).

**Modelo por defecto (Claude Code):** `.claude/settings.json` fija `"model": "claude-opus-4-8"`. Opus 4.8 es el modelo mas capaz para planificacion y revision exhaustiva. Override puntual con `/model sonnet` si necesitas velocidad en tareas mecanicas.

## Ahorro de tokens

Tres palancas para reducir el coste de las sesiones:

1. **Compresion de salida de shell (rtk):** [rtk](https://github.com/rtk-ai/rtk) es un proxy en Rust que recorta hasta un 90% de la salida de comandos de shell antes de que llegue al contexto del agente. Instalacion: `cargo install --git https://github.com/rtk-ai/rtk && rtk init -g` (o `brew install rtk`). Funciona en Linux, macOS y Windows nativo.
2. **Dashboard de coste (codeburn):** `npx codeburn` muestra un TUI con el desglose de coste por sesion, herramienta y modelo.
3. **Modelo por defecto:** ver "Modelo por defecto" mas arriba — ajustar el modelo al tipo de tarea (el mas capaz para gates de planificacion/revision, uno mas barato para ejecucion mecanica) es la palanca mas directa.

## Reglas de Cursor

El directorio `.cursor/rules/` contiene 43 reglas de convenciones de codigo para Cursor. Son opcionales y **no implementan el flujo SDD** — el framework funciona sin ellas. Si usas Cursor, copia `.cursor/` a tu proyecto.

> **Solo al clonar el repo completo.** `.cursor/` (el del framework, no el tuyo si ya tienes uno) no se incluye en la instalacion via `npx ... install` — el CLI no copia esta carpeta. Para obtenerla, clona el repositorio completo (`git clone`) y copia `.cursor/` desde ahi.
>
> **Asumen un stack concreto.** La mayoria de esas reglas (38 de 43) estan escritas para **Next.js 15 + React + Drizzle + PostgreSQL + Python**: dan por hecho ese runtime, esas convenciones y ese ORM. Si tu proyecto usa otro stack, revisalas y adaptalas antes de copiar `.cursor/` — o copia solo las que sean agnosticas.

---

## Personalizar: anadir tus propias skills o comandos

`update` solo copia y refresca las rutas listadas explicitamente en
`scripts/backend-manifest.json` — nunca borra nada que no este en ese manifiesto. Un
archivo nuevo que tu anadas (por ejemplo `.claude/commands/mi-comando.md`) ya esta a
salvo por construccion: `update` no lo toca, ni al traer una version nueva del
framework ni en ninguna ejecucion futura.

**Receta minima por backend:**

- **Claude Code:** crea `.claude/skills/<tu-skill>/SKILL.md` con frontmatter `name` +
  `description` (activacion automatica por el propio Claude Code), o
  `.claude/commands/<tu-comando>.md` para un slash command explicito.
- **Gemini CLI:** crea `.gemini/skills/<tu-skill>/SKILL.md` (mismo frontmatter `name` +
  `description`), o `.gemini/commands/<tu-comando>.toml` con las claves `description` y
  `prompt`.
- **Codex:** crea `.agents/skills/<tu-skill>/SKILL.md` (carpeta compartida con
  Antigravity, mismo frontmatter que arriba).
- **Antigravity:** igual que Codex — `.agents/skills/<tu-skill>/SKILL.md`.

**Evita reusar un nombre que ya exista en el manifiesto del framework** (por ejemplo
`commit`, `bugfix` o `pr` en `.claude/skills/` o `.claude/commands/`): si el nombre
coincide con una ruta que `scripts/backend-manifest.json` ya declara como propia del
framework, `update` la trata como suya y la sobrescribe. Revisa
`scripts/backend-manifest.json` si tienes dudas sobre que nombres estan reservados.

---

## Actualizacion

Para recibir cambios nuevos del framework:

**Via CLI (recomendado):**
```bash
npx github:gmoncor/agentic-engineering-framework update --backend <claude|gemini|codex|antigravity|all>
```
Sobrescribe las rutas del backend elegido segun `scripts/backend-manifest.json`, sin tocar
`ai_docs/core/`, `ai_docs/tasks/` ni `ai_docs/refs/` — esos son tuyos.

**Archivos que se preservan si los personalizaste:** ademas de esas tres carpetas, `update`
protege `hooks/config.json`, `.claude/settings.json`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`
y `.gitignore`.
El CLI guarda un hash de cada uno la primera vez que los instala (en `.sdd-installed-hashes.json`,
en la raiz de tu proyecto); si el contenido en disco ya no coincide con ese hash, salta la
sobrescritura de ese archivo y avisa por stdout cuales omitio. Si no los tocaste, se actualizan
con normalidad. Si tu instalacion es anterior a la introduccion de este hash y nunca editaste
esos archivos, `update` lo detecta comparando contra el archivo original del framework y los
actualiza igualmente (sembrando el hash para las proximas ejecuciones); solo se protegen si el
contenido en disco difiere de verdad. Si necesitas forzar la sobrescritura de archivos protegidos
con ediciones locales genuinas (asumiendo que perderas esas ediciones), usa
`update --backend <backend> --reset-protected`.

**Gemini CLI (extension):**
```bash
gemini extensions update sdd-framework
```
Via nativa si instalaste la extension de Gemini en vez del CLI del framework.

**Manual (sin npx/git):**
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
| `.claude/`\* (comandos, agentes, skills, workflows) | `ai_docs/core/` (vision, planificacion, roadmap) |
| `hooks/` (enforcement) | `ai_docs/tasks/` (specs y tasks) |
| `ai_docs/dev_templates/` (plantillas operativas) | `ai_docs/refs/` (referencias externas) |
| `ai_docs/core_templates/` (plantillas de planificacion) | Codigo de tu proyecto |
| `CLAUDE.md` / `GEMINI.md`\* (instrucciones sistema) | |

\* Solo si no los editaste; ver parrafo anterior.

---

## Contribuir

Las contribuciones son bienvenidas. Lee **[CONTRIBUTING.md](CONTRIBUTING.md)** antes de abrir una Pull Request: explica como reportar bugs, como proponer mejoras, el estilo de commits y la regla de paridad entre los cuatro backends.

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

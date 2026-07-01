# Agentic Engineering Framework

> Framework de plantillas para desarrollo de software asistido por IA — metodologia SDD (Spec-Driven Development).

---

## Que es esto?

Un sistema de plantillas que estructura como trabaja tu asistente de IA. En lugar de pedirle "haz esto" y esperar lo mejor, el framework impone un flujo: **planificacion exhaustiva** (spec + tasks + revision paralela + auditoria cruzada) antes de tocar codigo, seguida de **implementacion lineal** (una task a la vez) y revision adversarial.

Compatible con cualquier LLM via copy-paste. Integracion nativa con Claude Code (workflows + comandos + agentes + skills) y Gemini CLI (extension instalable).

---

## Aviso importante

Las plantillas guian al asistente de IA, pero la calidad del resultado depende de ti:

- **Revisa cada respuesta** — el LLM puede inventar, omitir o simplificar en exceso
- **Itera** — la primera version nunca es la mejor. Cuestiona decisiones, pide alternativas
- **No confies ciegamente** — tu eres el ingeniero, el LLM es la herramienta
- **Configura `ai_docs/core/` primero** — sin vision, planificacion y roadmap, las plantillas trabajan a ciegas

---

## El flujo SDD

Toda solicitud sigue un flujo lineal. No hay sprints ni ceremonias — solo planificacion exhaustiva seguida de implementacion controlada.

```
  [1] Solicitud
      |
      v
  [2] /planificar ─────── Workflow: spec + tasks + revision paralela + auditoria
      |                     (Claude Code: workflow con agentes paralelos)
      |                     (Gemini/otros: secuencial)
      v
  [3] Aprobacion ──────── El usuario revisa el plan completo
      |
      v
  [4] /implementar ────── UNA task a la vez (lineal, sin paralelizar)
      |                     Repetir para cada task en orden
      v
  [5] /revision ──────── Revision adversarial de toda la implementacion
      |
      v
    Codigo revisado
```

| Paso | Que pasa | Quien decide |
|------|----------|--------------|
| Solicitud | El usuario describe lo que quiere | Usuario |
| Planificar | Spec + tasks + revision paralela + auditoria cruzada | LLM (workflow) |
| Aprobacion | El usuario revisa veredicto y decide | Usuario |
| Implementar | Una task a la vez, en orden | LLM (implementador) |
| Revision | Revision esceptica de la implementacion completa | LLM (revisor) |

Principios del flujo:

- **Planificacion exhaustiva.** Cada task revisada y auditada ANTES de tocar codigo
- **Implementacion lineal.** Una task a la vez — sin paralelizar, sin drift
- **Tasks atomicas.** Una task = un cambio atomico = un commit
- **Revision adversarial obligatoria.** Nunca mergear sin pasar por el paso 5
- **Sin sprints.** Solo roadmap global en `ai_docs/core/`

---

## Instalacion

### Claude Code

**Opcion 1 — Proyecto nuevo:**

```bash
git clone https://github.com/gmoncor/agentic-engineering-framework.git mi-proyecto
cd mi-proyecto
claude
```

**Opcion 2 — Proyecto existente:**

Copia estas carpetas a la raiz de tu proyecto:

```
.claude/          # agentes, comandos, skills, settings
ai_docs/          # plantillas + docs de tu proyecto
CLAUDE.md         # instrucciones sistema
```

Comandos disponibles tras instalar:

| Comando | Paso | Que hace |
|---------|------|----------|
| `/planificar` | 2 | **Workflow completo**: spec + tasks + revision paralela + auditoria |
| `/spec` | — | Crea una spec individual (paso aislado) |
| `/tareas` | — | Deriva tasks de una spec (paso aislado) |
| `/auditar` | — | Audita coherencia spec + tasks (paso aislado) |
| `/implementar` | 4 | Implementa UNA task (lineal, con gate de planificacion) |
| `/revision` | 5 | Revision adversarial post-implementacion |
| `/estado` | — | Muestra estado del proyecto |
| `/bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `/commit` | — | Crea un commit limpio con mensaje descriptivo |
| `/pr` | — | Crea o revisa una Pull Request |

Skills (se activan automaticamente segun contexto):

| Skill | Cuando se activa |
|-------|-----------------|
| `revisar-tarea` | Al crear o modificar una task en ai_docs/tasks/ |
| `revision-adversarial` | Al completar la implementacion de todas las tasks |
| `bugfix` | Ante errores, fallos, excepciones, "no funciona" |
| `commit` | Cuando el usuario quiere hacer commit |
| `pr` | Cuando el usuario pide crear o revisar una PR |
| `cleanup` | Al pedir limpiar, refactorizar o revisar calidad |
| `testing` | Al pedir escribir tests o mejorar cobertura |
| `diff` | Al preguntar "que cambie" o "resumen de cambios" |

### Gemini CLI

**Opcion 1 — Extension (recomendada):**

```bash
gemini extensions install https://github.com/gmoncor/agentic-engineering-framework
```

**Opcion 2 — Manual:**

Copia a la raiz de tu proyecto:

```
agents/               # agentes Gemini
commands/              # comandos Gemini (.toml)
skills/                # skills Gemini
GEMINI.md              # instrucciones sistema
gemini-extension.json  # manifest
ai_docs/               # plantillas + docs de tu proyecto
```

### Sin CLI (copy-paste)

Funciona con cualquier LLM: ChatGPT, Copilot, Cursor, Windsurf, o cualquier otro.

1. Copia la carpeta `ai_docs/` a tu proyecto
2. Abre la plantilla que necesites de `ai_docs/dev_templates/`
3. Copia su contenido completo y pegalo en tu LLM
4. Describe tu tarea a continuacion del texto pegado

No requiere configuracion, plugins ni integraciones.

---

## Quick Start

### Proyecto nuevo

Usa las plantillas de `core_templates/` en orden para definir la base del proyecto:

```
1. 01_vision_del_proyecto.md    → Definir QUE se construye y PARA QUIEN
2. 02_planificacion_tecnica.md  → Definir COMO se construye (datos, paginas, arquitectura)
3. 03_roadmap_de_desarrollo.md  → Definir EN QUE ORDEN se construye
4. 04_setup_testing.md          → Configurar el entorno de tests (una sola vez)
```

Cada plantilla genera un documento en `ai_docs/core/`. Estos documentos alimentan a todo el flujo SDD.

Despues: ejecuta `/planificar` con tu primera solicitud y sigue el flujo.

### Proyecto existente

Tu equipo ya tiene codigo y arquitectura. Empieza directamente con el flujo SDD:

```
1. Describe lo que necesitas  → /planificar (spec + tasks + revision + auditoria)
2. Revisa el plan             → Aprueba o pide ajustes
3. Implementa                 → /implementar <task> (una a la vez, en orden)
4. Revision adversarial       → /revision
```

Si no tienes tests configurados, usa `core_templates/04_setup_testing.md` antes del paso 3.

---

## Flujo de trabajo diario

El dia a dia sigue el flujo SDD. Usa `/planificar` como punto de entrada principal:

**`/planificar`** — El workflow crea la spec, deriva tasks, revisa cada una en paralelo (esceptico: busca problemas, no confirma) y audita la coherencia cruzada. Recibiras un veredicto: APROBADO, NECESITA_AJUSTES o NECESITA_REPLANTEAMIENTO.

**Aprobacion** — Revisa el plan completo. Si es APROBADO, procede. Si necesita ajustes, aplicalos y re-evalua.

**`/implementar`** — Una task a la vez, en orden. No paralelizar. Cada task produce codigo + tests.

**`/revision`** — Revision esceptica de toda la implementacion. Busca: integracion entre tasks, edge cases no cubiertos, regresiones, codigo muerto.

**Si encuentras un bug:** usa `/bugfix`.
**Si el codigo necesita limpieza:** usa la skill `cleanup`.
**Para commit y PR:** usa `/commit` y `/pr`.

---

## Que hay en cada carpeta

```
agentic-engineering-framework/
├── README.md                    # Este archivo
├── CLAUDE.md                    # Instrucciones sistema para Claude Code
├── GEMINI.md                    # Instrucciones sistema para Gemini CLI
├── LICENSE                      # CC BY 4.0
│
├── .claude/                     # Configuracion Claude Code
│   ├── settings.json            #   model: opus-4.8 + hooks wiring
│   ├── agents/                  #   planificador, revisor, implementador
│   ├── commands/                #   10 comandos SDD
│   ├── skills/                  #   8 skills (auto-activacion)
│   └── workflows/               #   planificar.js (revision paralela + auditoria)
│
├── agents/                      # Agentes Gemini CLI
├── commands/                    # 10 comandos Gemini CLI (.toml)
├── skills/                      # 8 skills Gemini CLI
├── hooks/                       # Enforcement SDD (compartido ambas CLIs)
├── gemini-extension.json        # Manifest extension Gemini
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
| `spec.md` | 2 | Crear una especificacion |
| `tareas.md` | 3 | Derivar tasks de una spec |
| `revisar_tarea.md` | 4 | Revisar una task individual |
| `auditar_spec.md` | 5 | Auditar coherencia spec + tasks |
| `implementar.md` | 6 | Implementar una task |
| `revision_adversarial.md` | 7 | Revision adversarial post-implementacion |
| `correccion_de_bugs.md` | -- | Diagnosticar y corregir bugs |
| `limpieza_de_codigo.md` | -- | Revisar calidad de codigo |
| `testing_basico.md` | -- | Escribir tests |
| `hacer_commit.md` | -- | Commit limpio |
| `revision_pr.md` | -- | Crear o revisar una PR |

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
| `sdd-pipeline-guard.js` | Write/Edit | Avisa si escribes codigo sin spec aprobada Y tasks derivadas | Advisory |
| `sdd-commit-guard.js` | git commit | Verifica formato de commit (subject ≤72, tipo valido, sin Co-Authored-By IA) | Advisory |

Los hooks se activan automaticamente con Claude Code (via `.claude/settings.json`) y con Gemini CLI (via `hooks/hooks.json`). No requieren configuracion manual.

**Modelo por defecto (Claude Code):** `.claude/settings.json` fija `"model": "claude-opus-4-8"`. Opus 4.8 es el modelo mas capaz para planificacion y revision exhaustiva. Override puntual con `/model sonnet` si necesitas velocidad en tareas mecanicas.

## Cursor IDE

El directorio `.cursor/rules/` contiene 43 reglas que replican el comportamiento del framework dentro de Cursor. Son opcionales — el framework funciona sin ellas. Si usas Cursor, copia `.cursor/` a tu proyecto.

---

## Contribuir

1. Abre un issue describiendo que quieres mejorar y por que
2. Haz fork del repositorio
3. Crea una rama con tus cambios
4. Abre una Pull Request con descripcion clara

---

## Licencia

Este proyecto esta licenciado bajo [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE).

Puedes usar, copiar, modificar y distribuir este material para cualquier proposito, incluso comercial, siempre que des credito al autor original.

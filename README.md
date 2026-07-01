# Agentic Engineering Framework

> Framework de plantillas para desarrollo de software asistido por IA — metodologia SDD (Spec-Driven Development).

---

## Que es esto?

Un sistema de plantillas que estructura como trabaja tu asistente de IA. En lugar de pedirle "haz esto" y esperar lo mejor, el framework impone un flujo lineal: spec, tasks, auditoria, implementacion, revision adversarial.

Compatible con cualquier LLM via copy-paste. Integracion nativa con Claude Code (comandos + agentes + skills) y Gemini CLI (extension instalable).

---

## Aviso importante

Las plantillas guian al asistente de IA, pero la calidad del resultado depende de ti:

- **Revisa cada respuesta** — el LLM puede inventar, omitir o simplificar en exceso
- **Itera** — la primera version nunca es la mejor. Cuestiona decisiones, pide alternativas
- **No confies ciegamente** — tu eres el ingeniero, el LLM es la herramienta
- **Configura `ai_docs/core/` primero** — sin vision, planificacion y roadmap, las plantillas trabajan a ciegas

---

## El flujo SDD

Toda solicitud sigue 7 pasos lineales. No hay sprints ni ceremonias — solo un flujo que va de la idea al codigo revisado.

```
  [1] Solicitud
      |
      v
  [2] SPEC ──────────────── Define QUE se quiere lograr
      |
      v
  [3] TAREAS ────────────── Parte la spec en tasks atomicas
      |
      v
  [4] REVISION DE TASKS ─── Revisa cada task (alcance, edge cases, TDD)
      |
      v
  [5] AUDITORIA ─────────── Coherencia spec + tasks (huecos, overlap, dependencias)
      |
      v
  [6] IMPLEMENTACION ────── Ejecucion paralela de tasks independientes
      |
      v
  [7] REVISION ADVERSARIAL  Revision esceptica de la implementacion total
      |
      v
    Codigo revisado
```

| Paso | Que pasa | Quien decide |
|------|----------|--------------|
| Solicitud | El usuario describe lo que quiere | Usuario |
| Spec | Se crea un documento con alcance, criterios y restricciones | LLM + usuario |
| Tareas | Se parte la spec en tasks granulares y paralelizables | LLM |
| Revision de tasks | Se revisa cada task individualmente | LLM (revisor) |
| Auditoria | Se audita coherencia entre spec y tasks | LLM (revisor) |
| Implementacion | Se ejecutan las tasks (paralelo si son independientes) | LLM (implementador) |
| Revision adversarial | Revision esceptica de la implementacion completa | LLM (revisor) |

Principios del flujo:

- **Una spec, multiples tasks.** La spec define QUE; las tasks definen COMO
- **Tasks atomicas.** Una task = un cambio atomico = un commit
- **Paralelizacion donde sea posible.** Tasks sin dependencias mutuas se ejecutan en paralelo
- **Revision adversarial obligatoria.** Nunca mergear sin pasar por el paso 7
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

| Comando | Paso SDD | Que hace |
|---------|----------|----------|
| `/spec` | 2 | Crea una especificacion a partir de una solicitud |
| `/tareas` | 3 | Parte una spec aprobada en tasks granulares |
| `/auditar` | 5 | Audita coherencia entre spec y tasks |
| `/implementar` | 6 | Implementa una task especifica |
| `/revision` | 7 | Revision adversarial post-implementacion |
| `/estado` | -- | Muestra el estado del proyecto |

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

Despues: crea tu primera spec con `/spec` (o copia `dev_templates/spec.md`) y sigue el flujo.

### Proyecto existente

Tu equipo ya tiene codigo y arquitectura. Empieza directamente con el flujo SDD:

```
1. Describe lo que necesitas  → /spec (o dev_templates/spec.md)
2. Deriva tasks de la spec    → /tareas (o dev_templates/tareas.md)
3. Revisa cada task            → skill revisar-tarea (o dev_templates/revisar_tarea.md)
4. Audita spec + tasks         → /auditar (o dev_templates/auditar_spec.md)
5. Implementa                  → /implementar (o dev_templates/implementar.md)
6. Revision adversarial        → /revision (o dev_templates/revision_adversarial.md)
```

Si no tienes tests configurados, usa `core_templates/04_setup_testing.md` antes del paso 6.

---

## Flujo de trabajo diario

El dia a dia sigue el flujo SDD. No todos los pasos aplican siempre — usa tu criterio:

**2. Spec** — Describe lo que necesitas. El LLM crea la especificacion con alcance, criterios de aceptacion y restricciones. Revisala y apruebala antes de continuar.

**3. Tareas** — El LLM parte la spec en tasks atomicas. Cada task tiene dependencias, tamano estimado, edge cases y si es paralelizable.

**4. Revision de tasks** — Cada task se revisa individualmente: alcance minimo, dependencias correctas, edge cases cubiertos, enfoque TDD.

**5. Auditoria** — Se revisa la coherencia entre spec y tasks como conjunto: huecos de cobertura, overlap entre tasks, dependencias circulares, features no cubiertas.

**6. Implementacion** — Se ejecutan las tasks. Tasks sin dependencias mutuas se ejecutan en paralelo. Cada task produce codigo + tests.

**7. Revision adversarial** — Revision esceptica de toda la implementacion. El revisor busca problemas, no confirma que todo esta bien. Busca: integracion entre tasks, edge cases no cubiertos, regresiones, codigo muerto.

**Si encuentras un bug:** usa `correccion_de_bugs.md`.
**Si el codigo necesita limpieza:** usa `limpieza_de_codigo.md`.
**Para commit y PR:** usa `hacer_commit.md` y `revision_pr.md`.

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
│   ├── settings.json            #   permisos + hooks wiring
│   ├── agents/                  #   planificador, revisor, implementador
│   ├── commands/                #   /spec, /tareas, /auditar, /implementar, /revision, /estado
│   └── skills/                  #   revisar-tarea, revision-adversarial
│
├── agents/                      # Agentes Gemini CLI
├── commands/                    # Comandos Gemini CLI (.toml)
├── skills/                      # Skills Gemini CLI
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

## Hooks (enforcement del pipeline)

El directorio `hooks/` contiene un hook compartido entre ambas CLIs que refuerza la regla "toda solicitud empieza con una spec":

| Hook | Que hace | Modo |
|------|----------|------|
| `sdd-pipeline-guard.js` | Avisa si escribes codigo sin spec aprobada en `ai_docs/tasks/` | Advisory (warn, no bloquea) |

El hook se activa automaticamente con Claude Code (via `.claude/settings.json`) y con Gemini CLI (via `hooks/hooks.json`). No requiere configuracion manual.

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

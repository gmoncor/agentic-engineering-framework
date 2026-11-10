# ai_docs/ — Sistema de documentacion del proyecto

> Todo el conocimiento de tu proyecto vive aqui. Estas carpetas alimentan al flujo SDD y a los asistentes de IA.

---

## Estructura

```
ai_docs/
├── core_templates/     # Plantillas de planificacion inicial y decisiones (01-05)
│                       # Se usan en orden para definir un proyecto nuevo.
│                       # Cada una genera un documento en core/.
│
├── dev_templates/      # Plantillas operativas SDD (SSOT del flujo)
│                       # Son las instrucciones que le das al LLM.
│                       # Se copian tal cual — no se modifican.
│
├── doc_templates/      # Plantillas de documentación de negocio validable
│                       # Se copian a docs/proyecto/.
│
├── core/               # Documentacion de TU proyecto
│                       # Vision, planificacion tecnica, roadmap y decisiones.
│                       # Generados con core_templates/.
│                       # Este repo incluye 3 ejemplos (dogfooding).
│
├── tasks/              # Specs y tasks de TU proyecto
│                       # Specs: spec_<descriptor>.md
│                       # Tasks: NNN_descriptor.md
│                       # Empieza vacio. Se llena con /planificar.
│                       # Es local y no se versiona por defecto.
│
└── refs/               # Referencias externas
                        # APIs, guias de estilo, docs de terceros.
                        # Lo que el LLM necesite consultar. Empieza vacio.
```

---

## Que va en cada carpeta

### `core_templates/` — Plantillas de planificacion inicial

**Quien las usa:** Tu, al empezar un proyecto nuevo o documentar uno existente.

**Cuando:** Una vez por proyecto (o cuando necesites rehacer la planificacion).

**Como:** Copia la plantilla en tu LLM y sigue las instrucciones. Cada una genera un documento en `core/`.

| Orden | Plantilla | Que genera |
|-------|-----------|-----------|
| 1 | `01_vision_del_proyecto.md` | `core/vision_del_proyecto.md` |
| 2 | `02_planificacion_tecnica.md` | `core/planificacion_tecnica.md` |
| 3 | `03_roadmap_de_desarrollo.md` | `core/roadmap.md` |
| 4 | `04_setup_testing.md` | Framework de tests configurado |
| 5 | `05_decisiones.md` | `core/decisiones/AAAAMMDD_slug.md` |

### `dev_templates/` — Plantillas operativas SDD

**Quien las usa:** El LLM (directamente via commands/skills, o por copy-paste).

**Cuando:** En el dia a dia, siguiendo el pipeline SDD.

**Como:** Con Claude Code o Gemini CLI se invocan automaticamente via comandos (`/planificar`, `/implementar`, etc.). Sin CLI, se copian y pegan en cualquier LLM.

Son el SSOT (Single Source of Truth) del framework. Los commands y skills solo las referencian — la logica real vive aqui. No las modifiques.

### `core/` — Documentacion de tu proyecto

**Quien la mantiene:** Tu, con ayuda de las core_templates.

**Cuando actualizarla:** Cuando cambie la vision, la arquitectura o el plan.

**Importante:** Estos documentos alimentan a TODO el flujo SDD. Sin ellos, las plantillas trabajan a ciegas. Al menos `vision_del_proyecto.md` deberia existir.

**Versionado:** `core/` se comparte y se versiona con el proyecto. Las decisiones viven en `core/decisiones/` y cada fichero declara su estado, contexto, decisión y consecuencia.

### `tasks/` — Specs y tasks

**Quien la mantiene:** El LLM via /planificar (crea specs y tasks).

**Formato:**
- Specs: `spec_<descriptor>.md` — definen QUE se quiere lograr
- Tasks: `NNN_descriptor.md` — definen COMO implementar cada parte

**Ciclo de vida:**
```
spec BORRADOR → spec APROBADA → tasks derivadas → tasks revisadas → implementacion → revision
```

**Gitignored por defecto** (tus tasks son locales). No las uses como fuente compartida de trazabilidad.

### `doc_templates/` — Documentación de negocio validable

**Qué genera:** Los documentos de `docs/proyecto/`: visión, alcance, aceptación, estado, novedades y glosario.

**Frontera:** `core/` da contexto al equipo y a las plantillas. `docs/proyecto/` comunica información de negocio que una persona puede validar. Sus documentos llevan frontmatter con estado y fuentes.

### `refs/` — Referencias externas

**Quien la mantiene:** Tu, manualmente.

**Que poner:** Documentacion de APIs que uses, guias de estilo del equipo, specs de terceros, cualquier cosa que el LLM necesite consultar durante la implementacion.

**Gitignored por defecto** (evita subir docs de terceros al repo).

---

## Flujo de datos

```
[core_templates/]                   [core/]
  01_vision        ──genera──→    vision_del_proyecto.md
  02_planificacion  ──genera──→    planificacion_tecnica.md
  03_roadmap       ──genera──→    roadmap.md
  05_decisiones    ──genera──→    decisiones/AAAAMMDD_slug.md
                                        │
                                        ▼
[dev_templates/]                   [tasks/]
  spec.md          ──genera──→    spec_<descriptor>.md
  tareas.md        ──genera──→    NNN_descriptor.md
  revisar_tarea.md ──revisa──→    (veredicto por task)
  auditar_spec.md  ──audita──→    (veredicto global)
  implementar.md   ──consume─→    (implementa cada task)
  revision_adversarial.md ─revisa─→ (codigo implementado)
```

`core/` se versiona. `tasks/` sigue siendo local.

Las plantillas de `dev_templates/` leen `core/` para contexto y `tasks/` para saber que hacer. Sin estos documentos, trabajan sin informacion.

---

## Para usuarios sin CLI (copy-paste)

1. Copia `ai_docs/` a tu proyecto
2. Usa `core_templates/` en orden para definir tu proyecto (genera docs en `core/`)
3. Para cada solicitud, copia la plantilla de `dev_templates/` que necesites y pegala en tu LLM
4. Sigue el pipeline: spec → tasks → revision → auditoria → implementacion → revision adversarial

No necesitas los directorios `.claude/`, `commands/`, `agents/`, ni `skills/`. Esos son integraciones nativas de las CLIs.

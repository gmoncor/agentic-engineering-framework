# Agentic Engineering Framework

> Framework de plantillas para desarrollo de software asistido por IA — compatible con cualquier LLM o IDE agentico.

---

## Que es esto?

Un sistema de plantillas que le das a tu asistente de IA (ChatGPT, Claude, Gemini, Copilot, Cursor, Windsurf, o cualquier otro) para que trabaje de forma estructurada. En lugar de pedirle "haz esto" y esperar que lo haga bien a la primera, las plantillas le obligan a:

- **Preguntarte** cuando algo no esta claro (en vez de inventar)
- **Mostrarte el plan** antes de tocar codigo (en vez de lanzarse a implementar)
- **Presentarte alternativas** cuando la solucion no es obvia (en vez de darte solo una opcion)
- **Verificar** que nada se ha roto despues de cada cambio

El resultado: menos errores, mejor codigo, y tu entiendes cada decision que se toma.

---

## Como funciona

1. **Copia el contenido completo** de la plantilla que necesites
2. **Pegalo en tu asistente de IA** (chat, IDE, o donde trabajes)
3. **Describe tu tarea** a continuacion del texto pegado
4. **Sigue las indicaciones** — el asistente te guiara paso a paso

Funciona con cualquier LLM o IDE que acepte texto como entrada. No requiere configuracion, plugins ni integraciones.

---

## Estructura del proyecto

```
ai_docs/
├── dev_templates/           # Plantillas operativas (usa estas a diario)
│   ├── README.md            # Guia completa de uso de las plantillas
│   ├── documento_de_tarea.md
│   ├── correccion_de_bugs.md
│   ├── limpieza_de_codigo.md
│   ├── testing_basico.md
│   ├── hacer_commit.md
│   ├── revision_pr.md
│   └── core_templates/      # Plantillas de planificacion inicial
│       ├── README.md
│       ├── 01_vision_del_proyecto.md
│       ├── 02_planificacion_tecnica.md
│       ├── 03_roadmap_de_desarrollo.md
│       └── 04_setup_testing.md
│
├── core/                    # Documentacion de TU proyecto (incluye ejemplos)
│   ├── vision_del_proyecto.md      # Ejemplo generado con 01_vision_del_proyecto
│   ├── planificacion_tecnica.md    # Ejemplo generado con 02_planificacion_tecnica
│   └── roadmap.md                  # Ejemplo generado con 03_roadmap_de_desarrollo
├── tasks/                   # Documentos de tarea de TU proyecto (ver abajo)
└── refs/                    # Referencias externas de TU proyecto (ver abajo)
```

---

## Que hay en cada carpeta

### `dev_templates/` — Plantillas que copias y pegas

Estas son las instrucciones que le das a tu asistente de IA. **No las modificas, las copias tal cual.**

| Plantilla | Cuando usarla |
|-----------|---------------|
| **documento_de_tarea.md** | Antes de empezar cualquier trabajo — planifica que vas a hacer |
| **correccion_de_bugs.md** | Cuando algo no funciona o da un error |
| **limpieza_de_codigo.md** | Despues de implementar — revisa calidad, redundancias, nombres |
| **testing_basico.md** | Para escribir tests o mejorar tests existentes |
| **hacer_commit.md** | Para guardar cambios en Git con un commit limpio |
| **revision_pr.md** | Para crear o revisar una Pull Request |

### `dev_templates/core_templates/` — Plantillas de planificacion inicial

Para proyectos nuevos o existentes sin documentacion. Se usan en orden y cada una genera un documento que alimenta a la siguiente.

| Plantilla | Cuando usarla |
|-----------|---------------|
| **01 — Vision del Proyecto** | Definir QUE se construye, PARA QUIEN y POR QUE |
| **02 — Planificacion Tecnica** | Definir la estructura: paginas, datos y arquitectura |
| **03 — Roadmap de Desarrollo** | Definir EN QUE ORDEN se construye todo |
| **04 — Setup de Testing** | Configurar el entorno de tests (una sola vez) |

### `core/` — Documentacion de tu proyecto

Aqui guardas los documentos que generan las plantillas de planificacion inicial:

- El documento de vision (generado con 01_vision_del_proyecto)
- La planificacion tecnica (generada con 02_planificacion_tecnica)
- El roadmap de desarrollo (generado con 03_roadmap_de_desarrollo)
- Cualquier otro documento de referencia de tu proyecto

**En este repo, incluimos 3 documentos de ejemplo** generados aplicando las plantillas de planificacion inicial sobre el propio framework (dogfooding). Sirven para que veas el formato y nivel de detalle que produce cada plantilla:

- `vision_del_proyecto.md` — ejemplo generado con 01_vision_del_proyecto
- `planificacion_tecnica.md` — ejemplo generado con 02_planificacion_tecnica
- `roadmap.md` — ejemplo generado con 03_roadmap_de_desarrollo

Cuando uses el framework en tu proyecto, reemplaza estos ejemplos con los documentos de tu propio proyecto.

### `tasks/` — Documentos de tarea

Aqui guardas los documentos de tarea que generas con `documento_de_tarea.md`:

- Un archivo por tarea: `001_descripcion_de_la_tarea.md`
- Numeracion secuencial: `001`, `002`, `003`...
- Sirven como registro de decisiones y como guia durante la implementacion

**Esta carpeta empieza vacia.** Se llena conforme trabajas en tu proyecto.

### `refs/` — Referencias externas

Aqui guardas documentacion externa que tu asistente de IA necesita consultar:

- Documentacion de APIs que consumes
- Guias de estilo del equipo
- Especificaciones tecnicas de terceros
- Cualquier documento de referencia que no sea codigo

**Esta carpeta empieza vacia.** Annade lo que necesites.

---

## Quick Start

### Si te incorporas a un proyecto existente

Tu equipo ya tiene codigo y arquitectura. Empieza directamente con las plantillas operativas:

```
1. Lee el codigo existente y entiende la estructura
2. Cuando te asignen una tarea  →  documento_de_tarea.md
3. Implementa con tu asistente de IA
4. Revisa la calidad           →  limpieza_de_codigo.md
5. Si no hay tests             →  core_templates/04_setup_testing.md (una sola vez)
6. Escribe tests               →  testing_basico.md
7. Haz commit                  →  hacer_commit.md
8. Crea la PR                  →  revision_pr.md
```

### Si arrancas un proyecto nuevo

Usa las plantillas de planificacion inicial en orden para definir la idea, la estructura y el plan:

```
1. 01  →  Definir QUE se construye y PARA QUIEN
2. 02  →  Definir COMO se construye (datos, paginas, arquitectura)
3. 03  →  Definir EN QUE ORDEN se construye
4. 04  →  Configurar el entorno de tests
5. Documento de Tarea  →  Crear tarea para la primera fase del roadmap
6. Implementar + Testear + Commit + PR (flujo diario)
```

---

## Flujo de trabajo diario

```
1. PLANIFICAR    →  documento_de_tarea.md
   Antes de tocar codigo. Define que vas a hacer, por que, y como.

2. IMPLEMENTAR   →  Tu asistente de IA con el documento de tarea como guia.

3. REVISAR       →  limpieza_de_codigo.md
   Busca codigo muerto, redundancias, nombres poco claros, duplicaciones.

4. TESTEAR       →  testing_basico.md
   Escribe tests para lo que has implementado. No para todo el proyecto.

5. COMMITEAR     →  hacer_commit.md
   Guarda los cambios con un mensaje claro y sin archivos sensibles.

6. PULL REQUEST  →  revision_pr.md
   Crea o revisa la PR antes de mergear.
```

Si encuentras un bug durante la implementacion: usa `correccion_de_bugs.md`.

---

## Como instalar en tu proyecto

1. **Copia la carpeta `ai_docs/`** a la raiz de tu proyecto
2. **Anade `ai_docs/` a tu `.gitignore`** — estas plantillas son herramientas de trabajo, no codigo de produccion

```gitignore
# Documentos generados por el framework de IA (especificos de tu proyecto)
ai_docs/core/
ai_docs/tasks/
ai_docs/refs/
```

3. **Empieza a usar las plantillas** — copia, pega, describe tu tarea

---

## Reglas importantes

- **No te saltes la planificacion.** Crear un documento de tarea ANTES de programar parece perder tiempo, pero lo ahorra. El asistente trabaja mucho mejor cuando tiene un plan claro.
- **No aceptes la primera respuesta sin cuestionarla.** Las plantillas obligan al asistente a presentar alternativas — aprovechalo.
- **Revisa siempre el codigo generado.** El asistente genera codigo, pero TU eres responsable de lo que se sube al repositorio.
- **Pregunta si no entiendes algo.** Las plantillas estan disenadas para que el asistente te explique cada decision.
- **Itera.** La primera version nunca es la mejor. Las plantillas fuerzan rondas de revision — no las saltes.

---

## Contribuir

Si quieres proponer mejoras a las plantillas:

1. Abre un issue describiendo que quieres mejorar y por que
2. Haz fork del repositorio
3. Crea una rama con tus cambios
4. Abre una Pull Request con descripcion clara

---

## Licencia

Este proyecto esta licenciado bajo [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSE).

Puedes usar, copiar, modificar y distribuir este material para cualquier proposito, incluso comercial, siempre que des credito al autor original.

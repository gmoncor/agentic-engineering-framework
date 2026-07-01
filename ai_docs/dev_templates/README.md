# Templates de Desarrollo Asistido por IA

> Sistema de plantillas para guiar a asistentes de IA durante el desarrollo de software, organizado alrededor de la metodologia SDD (Spec-Driven Development).

---

## Que es esto?

Estas plantillas son instrucciones que le das a tu asistente de IA para que trabaje de forma estructurada. En lugar de pedirle "haz esto" y esperar que lo haga bien a la primera, las plantillas le obligan a:

- **Preguntarte** cuando algo no esta claro (en vez de inventar)
- **Mostrarte el plan** antes de tocar codigo (en vez de lanzarse a implementar)
- **Presentarte alternativas** cuando la solucion no es obvia (en vez de darte solo una opcion)
- **Verificar** que nada se ha roto despues de cada cambio

El resultado: menos errores, mejor codigo, y tu entiendes cada decision que se toma.

---

## Como usar una plantilla

1. **Copia el contenido completo** de la plantilla que necesites
2. **Pegalo en tu asistente de IA** (chat, IDE, o donde trabajes)
3. **Describe tu tarea** a continuacion del texto pegado
4. **Sigue las indicaciones** — el asistente te guiara paso a paso

**Importante:** No edites ni recortes la plantilla. Pega el contenido completo para que las instrucciones funcionen correctamente.

---

## Metodologia SDD (Spec-Driven Development)

El flujo SDD es un pipeline lineal donde cada paso produce un artefacto que alimenta al siguiente:

```
Solicitud del usuario
    |
    v
[2. SPEC]  ──────────────────  spec.md
    |                          Define QUE se quiere lograr
    v
[3. TASKS]  ─────────────────  tareas.md
    |                          Divide la spec en tasks atomicas
    v
[4. REVISION DE TASKS]  ─────  revisar_tarea.md
    |                          Valida cada task individualmente
    v
[5. AUDITORIA]  ─────────────  auditar_spec.md
    |                          Verifica coherencia spec + tasks
    v
[6. IMPLEMENTACION]  ────────  implementar.md
    |                          Ejecuta cada task (una a la vez, en orden)
    |   |
    |   +── limpieza_de_codigo.md  (por task)
    |   +── testing_basico.md      (por task)
    |   +── hacer_commit.md        (por task)
    |
    v
[7. REVISION ADVERSARIAL]  ──  revision_adversarial.md
    |                          Revision adversarial de TODA la implementacion
    v
[PR]  ───────────────────────  revision_pr.md
                               Cierra las tasks de la spec
```

**Principios del flujo SDD:**
- Sin sprints — solo un roadmap global en `ai_docs/core/`
- La spec define QUE. Las tasks definen COMO
- Tasks atomicas y granulares, independientes cuando no hay dependencias
- Revision adversarial obligatoria despues de implementar TODAS las tasks
- Una spec, multiples tasks. Una task, un cambio atomico

---

## Plantillas disponibles

### Pipeline SDD (usar en orden)

| # | Plantilla | Archivo | Cuando usarla |
|---|-----------|---------|---------------|
| 2 | **Spec** | `spec.md` | Al recibir una solicitud. Define QUE se quiere lograr |
| 3 | **Derivar tasks** | `tareas.md` | Despues de aprobar la spec. Divide en tasks atomicas |
| 4 | **Revisar task** | `revisar_tarea.md` | Despues de crear cada task. Valida alcance, dependencias, edge cases, TDD |
| 5 | **Auditar spec** | `auditar_spec.md` | Despues de crear TODAS las tasks. Verifica cobertura, overlaps, huecos |
| 6 | **Implementar** | `implementar.md` | Despues de la auditoria. Ejecuta cada task |
| 7 | **Revision adversarial** | `revision_adversarial.md` | Despues de implementar TODAS las tasks. Busca problemas activamente |

### Soporte (usar durante la implementacion)

| Plantilla | Archivo | Cuando usarla | Cuando NO usarla |
|-----------|---------|---------------|------------------|
| **Limpieza de codigo** | `limpieza_de_codigo.md` | Despues de implementar cada task, antes de la revision adversarial | Para anadir funcionalidad nueva |
| **Testing** | `testing_basico.md` | Durante la implementacion de cada task | Si no hay framework de testing (primero usa `core_templates/04_setup_testing.md`) |
| **Commit** | `hacer_commit.md` | Despues de implementar y limpiar cada task | Para crear PRs (usa `revision_pr.md`) |
| **Pull Request** | `revision_pr.md` | Despues de la revision adversarial, para crear la PR final | Para revision de codigo sin PR (usa `limpieza_de_codigo.md`) |
| **Correccion de bugs** | `correccion_de_bugs.md` | Cuando algo no funciona o tiene comportamiento inesperado | Para mejoras o features nuevos (eso es una spec) |
| **Resolver problema** | `resolver_problema.md` | Cuando dudas entre opciones o necesitas analisis de trade-offs | Para implementar (usa `implementar.md`) |

### Documentacion Core del Proyecto (`core_templates/`)

Plantillas para definir y planificar un proyecto. **Requisito antes de usar el pipeline SDD.** Cada una genera un documento de referencia. Ver `core_templates/README.md` para instrucciones detalladas.

| Plantilla | Cuando usarla |
|-----------|---------------|
| **01 -- Vision del Proyecto** | Al arrancar un proyecto nuevo o para documentar uno existente |
| **02 -- Planificacion Tecnica** | Despues de 01. Para definir paginas, modelo de datos y arquitectura |
| **03 -- Roadmap de Desarrollo** | Despues de 02. Para organizar el trabajo en orden |
| **04 -- Setup de Testing** | Una vez por proyecto. Configura framework de tests |

---

## Quick Start

### Si te incorporas a un proyecto existente

Tu equipo ya tiene codigo, repositorio y arquitectura definida. Empieza directamente con el pipeline SDD:

```
1. Lee el codigo existente y entiende la estructura del proyecto
2. Cuando te asignen trabajo      -->  spec.md (define QUE)
3. Deriva las tasks               -->  tareas.md
4. Revisa cada task               -->  revisar_tarea.md
5. Audita spec + tasks            -->  auditar_spec.md
6. Implementa cada task           -->  implementar.md
   (incluye tests, limpieza, commit por task)
7. Revision adversarial           -->  revision_adversarial.md
8. Crea la PR                     -->  revision_pr.md
```

### Si arrancas un proyecto nuevo

Necesitas definir la idea, la estructura y el plan antes de escribir codigo:

```
1. 01 Vision del Proyecto          -->  Definir QUE se construye y PARA QUIEN
2. 02 Planificacion Tecnica        -->  Definir COMO se construye
3. 03 Roadmap de Desarrollo        -->  Definir EN QUE ORDEN se construye
4. 04 Setup de Testing             -->  Configurar el entorno de tests
5. Seguir el pipeline SDD para cada trabajo del roadmap
```

Las plantillas core estan en la carpeta `core_templates/`. Consulta su README para mas detalle.

---

## Flujo de trabajo diario (pipeline SDD)

```
2. SPEC            -->  spec.md
   Recibir solicitud. Definir QUE, alcance, criterios de aceptacion.

3. TAREAS          -->  tareas.md
   Dividir la spec en tasks atomicas e independientes.

4. REVISION DE TASKS  -->  revisar_tarea.md (por cada task)
   Validar alcance, dependencias, edge cases, enfoque TDD.

5. AUDITORIA       -->  auditar_spec.md
   Verificar cobertura, overlaps, huecos, coherencia.

6. IMPLEMENTAR     -->  implementar.md (por cada task, una a la vez, en orden)
   Implementar + tests + limpieza + commit por task.

7. REVISION ADVERSARIAL  -->  revision_adversarial.md
   Buscar problemas activamente en TODA la implementacion.

PR                 -->  revision_pr.md
   Crear la PR que cierra las tasks de la spec.
```

**Si encuentras un bug** durante la implementacion: usa `correccion_de_bugs.md`.

**Si el proyecto no tiene tests configurados:** usa `core_templates/04_setup_testing.md` una sola vez antes de escribir tests.

---

## Reglas importantes

- **No te saltes la especificacion.** Crear una spec ANTES de derivar tasks parece perder tiempo, pero lo ahorra. El asistente trabaja mucho mejor cuando tiene un contrato claro del QUE.
- **No aceptes la primera respuesta sin cuestionarla.** Las plantillas obligan al asistente a presentar alternativas — aprovechalo.
- **Revisa siempre el codigo generado.** El asistente genera codigo, pero TU eres responsable de lo que se sube al repositorio.
- **La revision adversarial no es opcional.** Es el ultimo filtro antes de mergear. Su trabajo es ENCONTRAR problemas, no confirmar que todo esta bien.
- **Itera.** La primera version nunca es la mejor. Las plantillas fuerzan rondas de revision — no las saltes.

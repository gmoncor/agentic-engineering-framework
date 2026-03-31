# Templates de Desarrollo Asistido por IA

> Sistema de plantillas para guiar a asistentes de IA durante el desarrollo de software.

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

## Quick Start — por donde empiezo?

### Si te incorporas a un proyecto existente

Tu equipo ya tiene codigo, repositorio y arquitectura definida. No necesitas planificar desde cero. Empieza directamente con las plantillas operativas:

```
1. Lee el codigo existente y entiende la estructura del proyecto
2. Cuando te asignen una tarea  →  documento_de_tarea.md
3. Implementa con tu asistente de IA
4. Revisa la calidad           →  limpieza_de_codigo.md
5. Si no hay tests             →  core_templates/04_setup_testing.md (una sola vez)
6. Escribe tests               →  testing_basico.md
7. Haz commit                  →  hacer_commit.md
8. Crea la PR                  →  revision_pr.md
```

**Plantilla mas importante para ti:** `documento_de_tarea.md` — usala ANTES de cada tarea para planificar que vas a hacer. Parece un paso extra, pero te ahorrara tiempo y errores.

### Si arrancas un proyecto nuevo

Necesitas definir la idea, la estructura y el plan antes de escribir codigo. Usa las plantillas core en orden:

```
1. 01 Vision del Proyecto        →  Definir QUE se construye y PARA QUIEN
2. 02 Planificacion Tecnica      →  Definir COMO se construye (datos, paginas, arquitectura)
3. 03 Roadmap de Desarrollo      →  Definir EN QUE ORDEN se construye
4. 04 Setup de Testing           →  Configurar el entorno de tests
5. Documento de Tarea            →  Crear tarea para la primera fase del roadmap
6. Implementar + Testear + Commit + PR (flujo diario)
```

Las plantillas core estan en la carpeta `core_templates/`. Consulta su README para mas detalle.

---

## Plantillas disponibles

### Documentacion Core del Proyecto (`core_templates/`)

Plantillas para definir y planificar un proyecto. Cada una genera un documento de referencia. Ver `core_templates/README.md` para instrucciones detalladas.

| Plantilla | Cuando usarla |
|-----------|---------------|
| **01 — Vision del Proyecto** | Al arrancar un proyecto nuevo o para documentar uno existente que no tiene vision clara |
| **02 — Planificacion Tecnica** | Despues de 01. Para definir paginas, modelo de datos y arquitectura |
| **03 — Roadmap de Desarrollo** | Despues de 02. Para organizar el trabajo en fases secuenciales |
| **04 — Setup de Testing** | Una vez por proyecto. Configura framework de tests, coverage y scripts |

### Operaciones del dia a dia

Plantillas que usaras regularmente durante el desarrollo.

| Plantilla | Cuando usarla | Cuando NO usarla |
|-----------|---------------|------------------|
| **Documento de Tarea** | Antes de empezar cualquier trabajo: planificar, analizar alternativas y definir criterios de exito | Para bugs simples (usa correccion_de_bugs) o cambios de una linea |
| **Limpieza de Codigo** | Despues de implementar, para revisar calidad: redundancias, nombres, comentarios, DRY, KISS | Para anadir funcionalidad nueva (eso es una tarea) |
| **Correccion de Bugs** | Cuando algo no funciona o tiene comportamiento inesperado | Para mejoras o features nuevos (eso es una tarea) |
| **Testing** | Para escribir tests de calidad o mejorar tests existentes | Si no hay framework de testing (primero usa 04_setup_testing) |
| **Hacer Commit** | Cada vez que quieras guardar cambios en Git | Para crear PRs (usa revision_pr) |
| **Revision de PR** | Para crear una PR nueva o revisar una existente antes de mergear | Para revision de codigo sin PR (usa limpieza_de_codigo) |

---

## Flujo de trabajo diario

Este es el ciclo que seguiras para cada tarea:

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

**Si encuentras un bug** durante la implementacion: usa `correccion_de_bugs.md`.

**Si el proyecto no tiene tests configurados:** usa `core_templates/04_setup_testing.md` una sola vez antes de escribir tests.

---

## Reglas importantes

- **No te saltes la planificacion.** Crear un documento de tarea ANTES de programar parece perder tiempo, pero lo ahorra. El asistente trabaja mucho mejor cuando tiene un plan claro.
- **No aceptes la primera respuesta sin cuestionarla.** Las plantillas obligan al asistente a presentar alternativas — aprovechalo. Tu criterio es mejor que el del asistente para decidir que solucion encaja en tu proyecto.
- **Revisa siempre el codigo generado.** El asistente genera codigo, pero TU eres responsable de lo que se sube al repositorio. Lee lo que ha hecho antes de hacer commit.
- **Pregunta si no entiendes algo.** Estas plantillas estan disenadas para que el asistente te explique cada decision. Si no entiendes una sugerencia, pidele que la explique.
- **Itera.** La primera version nunca es la mejor. Las plantillas fuerzan rondas de revision — no las saltes.

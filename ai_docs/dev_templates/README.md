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
2. Cuando te asignen una tarea  →  crear_tarea.md
3. Revisa el plan               →  revisar_tarea.md
4. Implementa con tu asistente de IA
5. Revisa la calidad            →  limpieza_de_codigo.md
6. Si no hay tests              →  ../core_templates/04_setup_testing.md (una sola vez)
7. Si no hay CI local           →  ci_local.md (una sola vez)
8. Escribe tests                →  unit_testing.md
9. Haz commit                   →  commit.md
10. Crea la PR                  →  revision_pr.md
```

**Plantilla mas importante para ti:** `crear_tarea.md` — usala ANTES de cada tarea para planificar que vas a hacer. Parece un paso extra, pero te ahorrara tiempo y errores.

### Si arrancas un proyecto nuevo

Necesitas definir la idea, la estructura y el plan antes de escribir codigo. Usa las plantillas core en orden:

```
1. 01 Vision del Proyecto        →  Definir QUE se construye y PARA QUIEN
2. 02 Planificacion Tecnica      →  Definir COMO se construye (datos, paginas, arquitectura)
3. 03 Roadmap de Desarrollo      →  Definir EN QUE ORDEN se construye
4. 04 Setup de Testing           →  Configurar el entorno de tests
5. CI Local                      →  Configurar verificaciones automaticas (ci_local.md)
6. Documento de Tarea            →  Crear tarea para la primera fase del roadmap
7. Implementar + Testear + Commit + PR (flujo diario)
```

Las plantillas core estan en la carpeta `../core_templates/`. Consulta su README para mas detalle.

---

## Plantillas disponibles

### Documentacion Core del Proyecto (`../core_templates/`)

Plantillas para definir y planificar un proyecto. **Requisito antes de usar las plantillas operativas.** Cada una genera un documento de referencia. Ver `../core_templates/README.md` para instrucciones detalladas.

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
| **Crear Tarea** | Antes de empezar cualquier trabajo: planificar, analizar alternativas y definir criterios de exito | Para bugs simples (usa fix_bugs) o cambios de una linea |
| **Revisar Tarea** | Despues de planificar: validar alcance minimo, dependencias, edge cases y enfoque TDD | Si la tarea es trivial (1 archivo, sin riesgos) |
| **Limpieza de Codigo** | Despues de implementar, para revisar calidad: redundancias, nombres, comentarios, DRY, KISS | Para anadir funcionalidad nueva (eso es una tarea) |
| **Fix Bugs** | Cuando algo no funciona o tiene comportamiento inesperado | Para mejoras o features nuevos (eso es una tarea) |
| **Unit Testing** | Para escribir tests de calidad o mejorar tests existentes | Si no hay framework de testing (primero usa 04_setup_testing) |
| **Commit** | Cada vez que quieras guardar cambios en Git | Para crear PRs (usa revision_pr) |
| **Revision de PR** | Para crear una PR nueva o revisar una existente antes de mergear | Para revision de codigo sin PR (usa limpieza_de_codigo) |
| **CI Local** | Una vez por proyecto: configurar git hooks que verifican codigo antes de commit y push | Si ya tienes hooks configurados y funcionando |

---

## Flujo de trabajo diario

Este es el ciclo que seguiras para cada tarea:

```
1. PLANIFICAR    →  crear_tarea.md
   Antes de tocar codigo. Define que vas a hacer, por que, y como.

2. REVISAR PLAN  →  revisar_tarea.md
   Valida alcance minimo, dependencias, edge cases y enfoque TDD.

3. IMPLEMENTAR   →  Tu asistente de IA con el documento de tarea revisado como guia.

4. REVISAR       →  limpieza_de_codigo.md
   Busca codigo muerto, redundancias, nombres poco claros, duplicaciones.

5. TESTEAR       →  unit_testing.md
   Escribe tests para lo que has implementado. No para todo el proyecto.

6. COMMITEAR     →  commit.md
   Guarda los cambios con un mensaje claro y sin archivos sensibles.

7. PULL REQUEST  →  revision_pr.md
   Crea o revisa la PR antes de mergear.
```

**Si encuentras un bug** durante la implementacion: usa `fix_bugs.md`.

**Si el proyecto no tiene tests configurados:** usa `../core_templates/04_setup_testing.md` una sola vez antes de escribir tests.

**Si el proyecto no tiene verificaciones automaticas:** usa `ci_local.md` una sola vez para configurar git hooks que verifican formato, lint y tests antes de cada commit y push.

---

## Reglas importantes

- **No te saltes la planificacion.** Crear un documento de tarea ANTES de programar parece perder tiempo, pero lo ahorra. El asistente trabaja mucho mejor cuando tiene un plan claro.
- **No aceptes la primera respuesta sin cuestionarla.** Las plantillas obligan al asistente a presentar alternativas — aprovechalo. Tu criterio es mejor que el del asistente para decidir que solucion encaja en tu proyecto.
- **Revisa siempre el codigo generado.** El asistente genera codigo, pero TU eres responsable de lo que se sube al repositorio. Lee lo que ha hecho antes de hacer commit.
- **Pregunta si no entiendes algo.** Estas plantillas estan disenadas para que el asistente te explique cada decision. Si no entiendes una sugerencia, pidele que la explique.
- **Itera.** La primera version nunca es la mejor. Las plantillas fuerzan rondas de revision — no las saltes.

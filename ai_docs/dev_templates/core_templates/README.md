# Plantillas Core — Documentacion Inicial del Proyecto

> Estas plantillas te guian para definir y documentar un proyecto de software antes de escribir codigo. Se usan en orden y cada una genera un documento que alimenta a la siguiente.

---

## Cuando usar estas plantillas

**Si arrancas un proyecto nuevo:** Usa las 4 plantillas en orden (01 → 02 → 03 → 04). El resultado es un proyecto con idea clara, estructura definida, plan de ejecucion y entorno de tests listo.

**Si te incorporas a un proyecto existente:** No necesitas hacer las 4. Evalua cuales te faltan:

| Situacion | Que usar |
|-----------|----------|
| No hay documentacion de que hace el proyecto ni para quien | 01_vision_del_proyecto — te ayuda a documentar la vision aunque el proyecto ya exista |
| No esta claro como esta organizado tecnicamente (datos, paginas, arquitectura) | 02_planificacion_tecnica — analiza el proyecto existente y genera la documentacion tecnica |
| Hay features pendientes pero no hay un plan de en que orden hacerlos | 03_roadmap_de_desarrollo — genera un roadmap basado en dependencias y prioridades |
| No hay framework de testing configurado | 04_setup_testing — configura tests, coverage y scripts en una sola sesion |
| El proyecto ya tiene todo esto documentado y configurado | No necesitas estas plantillas. Ve directamente a las operativas (documento_de_tarea, etc.) |

---

## Plantillas disponibles

### 01 — Vision del Proyecto

**Archivo:** `01_vision_del_proyecto.md`

**Que hace:** Te guia paso a paso para definir QUE se construye, PARA QUIEN y POR QUE. Cubre objetivo, problema central, tipos de usuario, funcionalidades MVP y restricciones del proyecto.

**Cuando usarla:**
- Al arrancar un proyecto nuevo desde cero
- Al incorporarte a un proyecto existente que no tiene documentacion clara de su proposito
- Cuando el equipo no tiene consenso sobre que problema resuelve el producto

**Que necesitas antes:** Nada — es la primera plantilla del pipeline.

**Que genera:** Un documento de vision que sirve como referencia para todas las decisiones posteriores.

**Como usarla:**
1. Copia el contenido completo y pegalo en tu asistente de IA
2. Describe tu idea de proyecto o el proyecto al que te incorporas
3. El asistente te guiara por cada paso: objetivo, problema, usuarios, MVP, restricciones
4. Al final tienes un documento de vision completo y validado

---

### 02 — Planificacion Tecnica

**Archivo:** `02_planificacion_tecnica.md`

**Que hace:** Convierte la vision en estructura tecnica concreta. Define las paginas/pantallas de la aplicacion, el modelo de datos (tablas, relaciones, campos) y la arquitectura del sistema (stack, auth, deployment).

**Cuando usarla:**
- Despues de tener la vision del proyecto (01_vision_del_proyecto) o equivalente
- Cuando necesitas definir la estructura de datos antes de implementar
- Cuando el equipo necesita alinear como esta organizado tecnicamente el proyecto

**Cuando NO usarla:**
- Para escribir codigo — esto es planificacion, no implementacion
- Si el proyecto ya tiene documentacion tecnica completa y actualizada

**Que necesitas antes:** El documento de vision (01_vision_del_proyecto) o un entendimiento claro de que hace el proyecto.

**Que genera:** Un documento con la estructura de paginas, modelo de datos y arquitectura del sistema.

**Como usarla:**
1. Copia el contenido completo y pegalo en tu asistente de IA
2. Adjunta o referencia el documento de vision del proyecto
3. El asistente analizara el stack, propondra estructura de paginas, modelo de datos y arquitectura
4. Cada fase requiere tu validacion antes de pasar a la siguiente

---

### 03 — Roadmap de Desarrollo

**Archivo:** `03_roadmap_de_desarrollo.md`

**Que hace:** Define EN QUE ORDEN se construye todo. Organiza las funcionalidades en fases secuenciales donde cada fase es una feature completa (no una capa tecnica). Incluye analisis de dependencias y 3 rondas de refinamiento obligatorias.

**Cuando usarla:**
- Despues de tener la planificacion tecnica (02_planificacion_tecnica)
- Cuando hay multiples features por construir y no esta claro por donde empezar
- Cuando necesitas un plan de ejecucion que puedas seguir fase a fase

**Cuando NO usarla:**
- Para tareas individuales — eso es documento_de_tarea.md
- Si el proyecto ya tiene un roadmap actualizado y el equipo lo sigue

**Que necesitas antes:** El documento de planificacion tecnica (02_planificacion_tecnica) o equivalente.

**Que genera:** Un roadmap con fases secuenciales feature-first, cada una con tareas concretas y checkboxes.

**Como usarla:**
1. Copia el contenido completo y pegalo en tu asistente de IA
2. Adjunta o referencia los documentos de vision y planificacion tecnica
3. El asistente analizara features, dependencias y propondra una secuencia
4. Habra 3 rondas de refinamiento — no te saltes ninguna, la calidad viene de la iteracion

**Importante:** Las fases deben ser features completas para el usuario ("Gestion de Productos con Catalogo"), NO capas tecnicas ("Migracion de Base de Datos"). Si el asistente propone fases tecnicas, pidele que las reorganice por funcionalidad.

---

### 04 — Setup de Testing

**Archivo:** `04_setup_testing.md`

**Que hace:** Configura el entorno de testing del proyecto en una sola sesion. Detecta el stack, instala el framework de testing apropiado, configura coverage y crea los scripts necesarios para ejecutar tests.

**Cuando usarla:**
- Una vez por proyecto, cuando no hay framework de testing configurado
- Cuando hay framework pero le falta coverage o scripts de ejecucion
- ANTES de usar `testing_basico.md` por primera vez

**Cuando NO usarla:**
- Si el proyecto ya tiene testing completo (framework + coverage + scripts)
- Para escribir tests — eso es `testing_basico.md`

**Que necesitas antes:** Un proyecto con codigo y archivo de configuracion (package.json, pyproject.toml, composer.json, etc.).

**Que genera:** Framework de testing instalado, coverage configurado y scripts listos para usar.

**Como usarla:**
1. Copia el contenido completo y pegalo en tu asistente de IA
2. El asistente detectara el stack y propondra que instalar
3. Revisas y apruebas el plan de instalacion
4. El asistente instala, configura y verifica que todo funciona

**Importante:** Esta plantilla es idempotente — si algo ya esta configurado, no lo toca. Nunca migra de un framework a otro (si ya tienes Jest, no instalara Vitest).

---

## Flujo completo para proyecto nuevo

```
01  →  Define la idea, los usuarios y el MVP
       Resultado: documento de vision

02  →  Define paginas, datos y arquitectura
       Resultado: documento de planificacion tecnica

03  →  Define el orden de construccion por fases
       Resultado: roadmap con tareas y checkboxes

04  →  Configura el entorno de testing
       Resultado: framework de tests listo para usar

Despues de las core templates, usa las plantillas operativas para el dia a dia:
  documento_de_tarea.md  →  Planificar cada tarea del roadmap
  testing_basico.md      →  Escribir tests
  hacer_commit.md        →  Guardar cambios
  revision_pr.md         →  Crear/revisar PRs
```

## Flujo para incorporacion a proyecto existente

```
1. Lee el codigo y entiende la estructura del proyecto

2. Evalua que documentacion falta:
   - No hay vision clara?          →  Usa 01_vision_del_proyecto
   - No hay documentacion tecnica? →  Usa 02_planificacion_tecnica
   - No hay plan de trabajo?       →  Usa 03_roadmap_de_desarrollo
   - No hay tests configurados?    →  Usa 04_setup_testing

3. Completa solo lo que falta y pasa a las plantillas operativas
```

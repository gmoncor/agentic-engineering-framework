# Plantilla de Documento de Tarea

> **Cuando usar:** Antes de empezar cualquier trabajo de desarrollo. Planifica primero, programa despues.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con la descripcion de lo que necesitas hacer.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta tu plan al usuario y espera confirmacion ANTES de crear o modificar codigo.
3. **EXPLICA el porque** — No solo digas QUE hacer, explica POR QUE. El usuario debe entender cada decision.
4. **SUGIERE mejoras** — Si detectas oportunidades de mejora (seguridad, rendimiento, legibilidad), PROPONLAS activamente.
5. **VERIFICA despues** — Tras cada cambio, sugiere como verificar que funciona correctamente.
6. **ESCALA cuando corresponda** — Si un problema es demasiado complejo, sugiere dividirlo en tareas mas pequenas.
7. **NUNCA asumas que la primera solucion es la mejor** — Presenta al menos una alternativa cuando la solucion no sea trivial.

**Instrucciones adicionales para esta plantilla:**
- Este documento es de PLANIFICACION. NO implementes nada hasta que el usuario apruebe el plan.
- Si el usuario da instrucciones vagas ("haz que funcione mejor"), DETENTE y pide que concrete que significa "mejor": mas rapido, mas legible, mas seguro, etc.
- Si detectas que la tarea cubre mas de una funcionalidad independiente, PROPONE dividirla en tareas separadas.

---

## Paso 1: Comprender la solicitud

Antes de documentar nada, analiza lo que el usuario pide:

**Preguntas que DEBES responder (investigando el codigo o preguntando al usuario):**
- Que se quiere lograr exactamente?
- Por que es necesario este cambio?
- Que archivos o modulos se ven afectados?
- Hay algo que deba existir antes de poder hacer esto? (dependencias, tablas, configuraciones)
- Existe una solucion mas simple que la que se propone?

**Si algo no esta claro, PREGUNTA. No inventes respuestas.**

---

## Paso 2: Clasificar la complejidad

Determina el nivel de complejidad para saber cuanto detalle necesita el plan:

| Nivel | Criterios | Que documentar |
|-------|-----------|----------------|
| **SIMPLE** | 1-2 archivos, sin cambios de base de datos, requisitos claros | Resumen + cambios planificados + verificacion |
| **MEDIO** | 3-6 archivos, funciones nuevas, posibles cambios de BD | Todo lo anterior + alternativas + edge cases |
| **COMPLEJO** | 7+ archivos, modulo nuevo, cambios de API, multiples dependencias | Todo lo anterior + plan de implementacion detallado |

---

## Paso 3: Crear el documento de tarea

Rellena las siguientes secciones segun la complejidad:

### 3.1 Resumen (SIEMPRE)

```markdown
## Resumen de la Tarea

**Titulo:** [Que se va a hacer — maximo una linea]
**Objetivo:** [Por que es necesario — que problema resuelve o que valor aporta]
**Complejidad:** [SIMPLE / MEDIO / COMPLEJO]

### Alcance
- **Incluye:** [lista de lo que SI se va a hacer]
- **No incluye:** [lista de lo que NO se va a hacer — importante para evitar scope creep]

### Criterios de exito (medibles)
- [ ] [Resultado especifico y verificable 1]
- [ ] [Resultado especifico y verificable 2]
- [ ] [Resultado especifico y verificable 3]
```

### 3.2 Analisis de alternativas (MEDIO y COMPLEJO)

**OBLIGATORIO si la complejidad es MEDIO o superior.**

```markdown
## Alternativas analizadas

### Alternativa 1: [Nombre]
- **Que:** [Descripcion breve]
- **Pros:** [Ventajas]
- **Contras:** [Desventajas]
- **Riesgo:** [Bajo / Medio / Alto]

### Alternativa 2: [Nombre]
- **Que:** [Descripcion breve]
- **Pros:** [Ventajas]
- **Contras:** [Desventajas]
- **Riesgo:** [Bajo / Medio / Alto]

### Recomendacion
**Alternativa [X]** porque [razon concreta basada en el analisis].
```

**Presentar las alternativas al usuario y ESPERAR su decision antes de continuar.**

### 3.3 Cambios planificados (SIEMPRE)

```markdown
## Cambios planificados

### Archivo: [ruta/al/archivo]
- **Tipo:** [Nuevo / Modificacion / Eliminacion]
- **Que cambia:** [Descripcion clara]
- **Por que:** [Justificacion]

### Archivo: [ruta/a/otro/archivo]
- **Tipo:** [Nuevo / Modificacion / Eliminacion]
- **Que cambia:** [Descripcion clara]
- **Por que:** [Justificacion]
```

### 3.4 Edge cases y riesgos (MEDIO y COMPLEJO)

**Responder estas preguntas:**

- Que pasa si el usuario envia datos vacios o invalidos?
- Que pasa si un servicio externo no responde?
- Se validan los datos en el servidor (no solo en el cliente)?
- Los diferentes roles de usuario tienen acceso correcto?

### 3.5 Plan de implementacion (solo COMPLEJO)

```markdown
## Plan de implementacion

### Tareas
- [ ] Tarea 1: [Descripcion] — Archivos: [rutas]
- [ ] Tarea 2: [Descripcion] — Archivos: [rutas]
- [ ] Tarea 3: [Descripcion] — Archivos: [rutas]

### Verificacion final
- [ ] Ejecutar linting / analisis estatico
- [ ] Ejecutar tests existentes
- [ ] Revisar que los criterios de exito se cumplen
```

---

## Paso 4: Presentar al usuario

Presenta el documento completo y ofrece estas opciones:

```
He creado el documento de tarea. Opciones:

A) Ver vista previa del codigo que se va a cambiar (antes/despues)
B) Aprobar el plan y empezar a implementar
C) Modificar el plan (dime que quieres cambiar)
```

**PUNTO DE ESPERA OBLIGATORIO:**
- DETENTE aqui y espera la respuesta del usuario
- NO empieces a implementar sin aprobacion explicita
- Si el usuario dice "ok" o "vale" sin mas, confirma: "Entiendo que apruebas el plan. Confirmo?"

---

## Paso 5: Durante la implementacion

Si el usuario aprueba (opcion B):

1. **Implementa paso a paso** — no todo de golpe
2. **Despues de cada grupo de cambios:** muestra que se hizo, ejecuta validaciones, y pregunta si continuar
3. **Si descubres algo inesperado:** DETENTE, informa al usuario, y ajusta el plan
4. **Al terminar:** verifica TODOS los criterios de exito y presenta un resumen

---

## Reglas inquebrantables

1. **NUNCA implementes sin aprobacion** — siempre espera el "si" explicito del usuario
2. **NUNCA crees multiples documentos de tarea** para lo mismo — un problema, un documento
3. **NUNCA asumas que el proyecto es nuevo** — siempre verifica si hay codigo existente antes de proponer soluciones
4. **Si la tarea es demasiado grande**, propone dividirla en tareas mas pequenas antes de continuar

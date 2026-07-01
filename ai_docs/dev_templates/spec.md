# Plantilla de Especificacion (Spec)

> **Cuando usar:** Cuando el usuario describe algo que quiere construir, cambiar o corregir. ANTES de crear tasks.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego describe lo que quieres lograr.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta la spec completa al usuario y espera aprobacion ANTES de considerarla finalizada.
3. **EXPLICA el porque** — Si incluyes o excluyes algo del alcance, explica POR QUE.
4. **SUGIERE mejoras** — Si detectas oportunidades, restricciones faltantes o criterios ambiguos, PROPONLOS activamente.
5. **VERIFICA despues** — Tras la aprobacion, confirma que la spec queda registrada y lista para derivar tasks.
6. **ESCALA cuando corresponda** — Si la solicitud es demasiado grande para una sola spec, sugiere dividirla en specs independientes.
7. **NUNCA asumas que la primera solucion es la mejor** — Si hay multiples formas de abordar el problema, presenta las opciones en la spec.

**Instrucciones adicionales para esta plantilla:**
- La spec define QUE se quiere lograr, NO COMO implementarlo. El COMO es responsabilidad de las tasks.
- NUNCA incluyas detalles de implementacion (nombres de funciones, estructura de archivos, patrones de codigo) en la spec. Solo alcance, restricciones y criterios de aceptacion.
- Si la solicitud del usuario es vaga, NO redactes la spec hasta tener respuestas a tus preguntas de clarificacion.
- La spec es un contrato. Una vez aprobada, los cambios requieren aprobacion explicita del usuario.

---

## Paso 1: Entender la solicitud

Lee la solicitud del usuario y evalua si tiene suficiente informacion para redactar una spec.

**Preguntas minimas que deben tener respuesta (explicita o implicita):**

| Pregunta | Si no esta clara |
|----------|-----------------|
| Que problema se resuelve o que funcionalidad se agrega? | Preguntar al usuario |
| Quien lo usa? (usuario final, desarrollador, sistema automatico) | Preguntar al usuario |
| Hay restricciones conocidas? (tecnologia, tiempo, compatibilidad) | Preguntar al usuario |
| Como se sabe que esta terminado? (criterio de exito medible) | Preguntar al usuario |

**Si faltan 2+ respuestas:** DETENTE y haz las preguntas antes de continuar.
**Si todo esta claro:** continua al Paso 2.

---

## Paso 2: Clasificar alcance

Basandote en la solicitud, clasifica el tamano esperado:

| Alcance | Archivos afectados | Criterio |
|---------|-------------------|----------|
| PEQUENO | 1-2 archivos | Cambio localizado, sin dependencias externas |
| MEDIANO | 3-6 archivos | Multiples modulos relacionados, posibles dependencias |
| GRANDE | 7+ archivos | Multiples subsistemas, integraciones, cambios transversales |

**Si el alcance es GRANDE:** sugiere al usuario dividir en specs independientes. Si el usuario decide mantenerla como una sola spec, continuar pero documentar el riesgo.

---

## Paso 3: Redactar la spec

Usa este formato exacto:

```markdown
# Spec: [Titulo descriptivo]

**Alcance:** [PEQUENO / MEDIANO / GRANDE]
**Fecha:** [YYYY-MM-DD]
**Estado:** BORRADOR

## Objetivo

[1-3 frases que describen QUE se quiere lograr y POR QUE. Sin detalles de implementacion.]

## Contexto

[Situacion actual. Que existe hoy. Por que es necesario este cambio. Informacion relevante para entender el problema.]

## Alcance

### Incluye
- [Funcionalidad o cambio 1]
- [Funcionalidad o cambio 2]
- [Funcionalidad o cambio N]

### No incluye
- [Algo que podria confundirse con parte del alcance pero NO lo es]
- [Mejora relacionada que se deja para despues]

## Restricciones

- [Restriccion tecnica, de compatibilidad, de rendimiento, etc.]
- [Restriccion de negocio o regulatoria]

## Criterios de aceptacion

| # | Criterio | Verificacion |
|---|----------|-------------|
| 1 | [Comportamiento esperado medible] | [Como se verifica: test, comando, inspeccion manual] |
| 2 | [Comportamiento esperado medible] | [Como se verifica] |
| N | [Comportamiento esperado medible] | [Como se verifica] |

## Dependencias

- [Servicio, libreria, API o modulo que debe existir antes de empezar]
- [Otra spec que debe completarse primero, si aplica]
- [Ninguna — si no hay dependencias, indicarlo explicitamente]
```

**Reglas de redaccion:**
- Cada criterio de aceptacion debe ser MEDIBLE. "Funciona correctamente" no es un criterio. "Devuelve 200 con el usuario creado cuando se envia email valido" si lo es.
- La seccion "No incluye" es obligatoria. Previene scope creep.
- Las restricciones deben ser verificables. "Buen rendimiento" no es una restriccion. "Respuesta en menos de 200ms para el 95% de requests" si lo es.

---

## Paso 4: Presentar y esperar aprobacion

Presenta la spec completa al usuario con este encabezado:

```
## Spec propuesta

[Contenido completo de la spec]

---

**Preguntas antes de aprobar:**
- El alcance es correcto? Falta algo? Sobra algo?
- Los criterios de aceptacion reflejan lo que esperas?
- Hay restricciones que no mencione?

Cuando apruebes esta spec, el siguiente paso es derivar las tasks de implementacion
usando la plantilla `tareas.md`.
```

**PUNTO DE ESPERA OBLIGATORIO:**
- DETENTE aqui y espera la respuesta del usuario
- Si el usuario pide cambios, actualiza la spec y vuelve a presentarla
- Solo marca el estado como APROBADA cuando el usuario de aprobacion explicita
- Una vez aprobada, cambia `**Estado:** BORRADOR` a `**Estado:** APROBADA`

---

## Reglas inquebrantables

1. **NUNCA redactes la spec sin entender la solicitud** — si hay ambiguedad, pregunta primero
2. **NUNCA incluyas detalles de implementacion** en la spec — la spec define QUE, las tasks definen COMO
3. **NUNCA marques la spec como aprobada** sin confirmacion explicita del usuario
4. **Cada criterio de aceptacion debe ser medible** — si no puedes verificarlo, no es un criterio
5. **La seccion "No incluye" es obligatoria** — previene que el alcance crezca sin control
6. **Si el alcance es GRANDE**, sugiere dividir en specs independientes antes de continuar

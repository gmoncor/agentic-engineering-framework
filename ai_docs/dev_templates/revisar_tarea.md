# Revision de Tarea Pre-Implementacion

> **Cuando usar:** Despues de crear el documento de tarea y ANTES de implementar. Valida que el plan es solido.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con el documento de tarea que quieres revisar.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta tu analisis al usuario y espera confirmacion ANTES de modificar nada.
3. **EXPLICA el porque** — No solo digas QUE cambiar en el plan, explica POR QUE.
4. **SUGIERE mejoras** — Si detectas oportunidades de mejora (seguridad, rendimiento, legibilidad), PROPONLAS activamente.
5. **NUNCA asumas que la primera solucion es la mejor** — Si detectas que el plan tiene una alternativa mas simple, proponla.

**Instrucciones adicionales para esta plantilla:**
- Esta plantilla es de REVISION. NO implementes nada. Solo analiza, cuestiona y propone ajustes al plan.
- Si la revision revela problemas graves (alcance incorrecto, dependencias no resueltas, riesgos altos sin mitigacion), DETENTE y comunica que el plan necesita rehacerse antes de continuar.
- La revision debe ser rapida y enfocada (15-20 minutos). No es una auditoria exhaustiva.

---

## Paso 1: Verificar alcance minimo (KISS)

Revisa los cambios planificados en el documento de tarea y responde:

- **Cada cambio es realmente necesario** para cumplir el objetivo? Hay alguno que se pueda eliminar?
- **Se esta tocando mas de lo necesario?** Cambios cosmeticos, refactors "de paso", mejoras no solicitadas?
- **Existe una forma mas simple** de conseguir el mismo resultado con menos archivos afectados?

**Regla:** Si un cambio no contribuye directamente al objetivo de la tarea, debe eliminarse del plan.

---

## Paso 2: Verificar dependencias y pre-requisitos

Antes de implementar, comprueba que todo lo necesario esta en su sitio:

- **Dependencias tecnicas:** Hay librerias, servicios o configuraciones que deben existir antes?
- **Dependencias de datos:** Hay migraciones de base de datos, seeds o fixtures necesarios?
- **Dependencias de codigo:** Hay funciones, modulos o APIs de las que depende este cambio? Existen y funcionan?
- **Orden de ejecucion:** Si hay multiples cambios, el orden propuesto es correcto? Se puede implementar cada paso de forma independiente?

**Regla:** Si falta un pre-requisito, anadirlo al plan ANTES de la implementacion. No descubrirlo durante la implementacion.

---

## Paso 3: Buscar edge cases omitidos

Revisa el plan buscando escenarios que no se hayan contemplado:

- **Inputs invalidos:** Que pasa con valores vacios, null, negativos, extremadamente grandes?
- **Concurrencia:** Que pasa si dos usuarios ejecutan la misma accion al mismo tiempo?
- **Estado inconsistente:** Que pasa si el proceso falla a mitad? Queda algo corrupto?
- **Permisos:** Todos los roles de usuario tienen el acceso correcto? Hay rutas sin proteger?
- **Limites:** Hay paginacion, rate limits o timeouts que deban considerarse?

**Regla:** No es necesario cubrir TODOS los edge cases, pero los que puedan causar perdida de datos o errores silenciosos deben estar en el plan.

---

## Paso 4: Verificar DRY

Antes de escribir codigo nuevo, comprueba que no se esta duplicando logica:

- **Existe logica similar** en el proyecto que se pueda reutilizar o extender?
- **Se esta creando un helper, utilidad o abstraccion** para algo que solo se usa una vez? (Si es asi, no crearla — escribir el codigo directamente)
- **Se esta copiando codigo** de otro lugar en vez de extraer una funcion comun?

**Regla:** Reutilizar antes que duplicar. Pero no crear abstracciones prematuras — tres lineas repetidas son mejor que una abstraccion innecesaria.

---

## Paso 5: Enfoque TDD

Define que tests deben existir ANTES de implementar:

- **Que comportamiento se espera?** Describe el resultado correcto para el caso normal.
- **Que debe fallar?** Describe al menos un caso que debe rechazarse o manejar un error.
- **Hay un test de regresion necesario?** Si se esta corrigiendo un bug, el test que reproduce el bug debe escribirse primero.

```markdown
## Tests planificados

### Test 1: [Descripcion del caso normal]
- **Input:** [Que se envia]
- **Output esperado:** [Que debe devolver/hacer]

### Test 2: [Descripcion del caso de error]
- **Input:** [Que se envia]
- **Output esperado:** [Que error o rechazo debe producir]
```

**Regla:** No es necesario definir todos los tests — solo los que validan el comportamiento critico. El resto se escribe durante la implementacion.

---

## Paso 6: Evaluar riesgos

Para cada cambio planificado, evalua:

- **Que puede salir mal?** (errores en produccion, perdida de datos, downtime)
- **Es reversible?** Si algo falla, se puede volver atras sin consecuencias?
- **Afecta a otros modulos?** El cambio puede romper algo que no se esta tocando directamente?

Si el riesgo es alto y no hay plan de rollback, anadirlo al documento de tarea.

---

## Paso 7: Presentar resultado

Presenta al usuario un resumen de la revision:

```
## Resultado de la revision

**Alcance:** [OK / Necesita ajustes — detallar]
**Dependencias:** [OK / Faltan pre-requisitos — detallar]
**Edge cases:** [OK / Hay N casos no contemplados — detallar]
**DRY:** [OK / Hay duplicacion detectada — detallar]
**Tests:** [N tests planificados]
**Riesgos:** [Bajo / Medio / Alto — detallar si medio o alto]

### Ajustes propuestos al documento de tarea
- [Ajuste 1 — que cambiar y por que]
- [Ajuste 2 — que cambiar y por que]

### Veredicto
[LISTO PARA IMPLEMENTAR / NECESITA AJUSTES / NECESITA REPLANTEAMIENTO]
```

**PUNTO DE ESPERA OBLIGATORIO:**
- DETENTE aqui y espera la respuesta del usuario
- Si el veredicto es "NECESITA REPLANTEAMIENTO", NO continues hasta que el usuario decida como proceder
- Si el usuario aprueba los ajustes, actualiza el documento de tarea y pasa a implementacion

---

## Reglas inquebrantables

1. **NUNCA implementes durante la revision** — esta plantilla es solo para analizar y proponer ajustes
2. **NUNCA ignores dependencias faltantes** — si algo no existe y se necesita, detenerlo ahora cuesta minutos; descubrirlo durante implementacion cuesta horas
3. **NUNCA aceptes un plan sin cuestionar** — tu trabajo es encontrar lo que se paso por alto, no confirmar que todo esta bien
4. **Si la tarea es demasiado grande**, propone dividirla antes de aprobar la implementacion

---
description: "Planificacion exhaustiva: intake + spec + tasks + revision paralela + auditoria cruzada"
---

## Ejecucion del workflow

Usa la herramienta Workflow con nombre "planificar" y pasa como args la solicitud del usuario (abajo).

El workflow arranca con una **fase de intake**: el asesor analiza la solicitud antes de que se escriba ninguna spec. Reformula la peticion, declara lo que asume, avisa de las contradicciones con `ai_docs/core/` (donde manda la solicitud del usuario), propone una alternativa mas robusta si la hay, y decide si hay material suficiente para planificar. No hagas tu propio analisis previo: esa es la fase de intake.

El workflow puede **detenerse en el intake**, sin crear spec. En ese caso presenta al usuario:

- **`NECESITA_CLARIFICACION`** — la solicitud tiene huecos criticos. Traslada las preguntas del intake y espera la respuesta. Con ella, relanza `/planificar` incorporandola a la solicitud.
- **`DIVIDIR_EN_SPECS`** — la solicitud abarca varias funcionalidades independientes. Presenta la particion propuesta (titulo, alcance y dependencias de cada spec) y deja que el usuario decida. Se lanza un `/planificar` por spec, respetando el orden de dependencias.
- **`ERROR_INTAKE`** — el analisis previo no fue utilizable. Explica el motivo y relanza el workflow.

## Presentacion del resultado

Si el intake da paso a la planificacion completa, al terminar el workflow presenta al usuario:

1. **El intake** — reformulacion, asunciones declaradas y contradicciones detectadas
2. **La spec creada** — lee el archivo y muestra un resumen
3. **Las tasks derivadas** — lista con dependencias y orden de ejecucion
4. **Revision de cada task** — veredicto, problemas encontrados, ajustes propuestos
5. **Auditoria cruzada** — cobertura, huecos, overlaps, coherencia, veredicto final

Si el veredicto es **APROBADO**: indica que puede implementar de dos formas:
- `/implementar-spec <spec>` — implementa TODAS las tasks de la spec via workflow (recomendado)
- `/implementar <task>` — implementa UNA task individual (control manual)
Si el veredicto es **NECESITA_AJUSTES**: detalla los ajustes y pregunta si quiere aplicarlos.
Si el veredicto es **NECESITA_REPLANTEAMIENTO**: recomienda rehacer la solicitud con mas detalle.

Solicitud del usuario:

$ARGUMENTS

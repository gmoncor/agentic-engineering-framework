---
description: "Planificacion exhaustiva: spec + tasks + revision paralela + auditoria cruzada"
---

ANTES de lanzar el workflow, analiza la solicitud del usuario:

## Deteccion multi-spec

Lee la solicitud completa. Si describe multiples funcionalidades INDEPENDIENTES (features distintas que no comparten archivos ni logica):

1. Lista cada spec que se necesitaria, con titulo descriptivo y alcance resumido
2. Pregunta si quiere:
   - **(A)** Planificar UNA spec ahora (indica cual) y las demas despues
   - **(B)** Combinar todo en una sola spec (solo si el alcance total es razonable)

Explicar que `/implementar-spec` paraleliza automaticamente las tasks independientes dentro de cada spec.

Si la solicitud es UNA sola spec, o el usuario elige una, lanza el workflow directamente.

## Ejecucion del workflow

Usa la herramienta Workflow con nombre "planificar" y pasa como args la solicitud del usuario (abajo).

Al completarse el workflow, presenta al usuario:

1. **La spec creada** — lee el archivo y muestra un resumen
2. **Las tasks derivadas** — lista con dependencias y orden de ejecucion
3. **Revision de cada task** — veredicto, problemas encontrados, ajustes propuestos
4. **Auditoria cruzada** — cobertura, huecos, overlaps, coherencia, veredicto final

Si el veredicto es **APROBADO**: indica que puede implementar de dos formas:
- `/implementar-spec <spec>` — implementa TODAS las tasks de la spec via workflow (recomendado)
- `/implementar <task>` — implementa UNA task individual (control manual)
Si el veredicto es **NECESITA_AJUSTES**: detalla los ajustes y pregunta si quiere aplicarlos.
Si el veredicto es **NECESITA_REPLANTEAMIENTO**: recomienda rehacer la solicitud con mas detalle.

Solicitud del usuario:

$ARGUMENTS

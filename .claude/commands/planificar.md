---
description: "Planificacion exhaustiva: spec + tasks + revision paralela + auditoria cruzada"
---

Ejecuta el workflow de planificacion exhaustiva del framework SDD.

Usa la herramienta Workflow con nombre "planificar" y pasa como args la solicitud del usuario (abajo).

Al completarse el workflow, presenta al usuario:

1. **La spec creada** — lee el archivo y muestra un resumen
2. **Las tasks derivadas** — lista con dependencias y orden de ejecucion
3. **Revision de cada task** — veredicto, problemas encontrados, ajustes propuestos
4. **Auditoria cruzada** — cobertura, huecos, overlaps, coherencia, veredicto final

Si el veredicto es **APROBADO**: indica que puede implementar con `/implementar <task>` (una task a la vez, en orden).
Si el veredicto es **NECESITA_AJUSTES**: detalla los ajustes y pregunta si quiere aplicarlos.
Si el veredicto es **NECESITA_REPLANTEAMIENTO**: recomienda rehacer la solicitud con mas detalle.

Solicitud del usuario:

$ARGUMENTS

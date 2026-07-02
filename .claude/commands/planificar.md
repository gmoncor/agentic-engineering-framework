---
description: "Planificacion exhaustiva: spec + tasks + revision paralela + auditoria cruzada"
---

ANTES de lanzar el workflow, analiza la solicitud del usuario:

## Deteccion multi-spec

Lee la solicitud completa. Si describe multiples funcionalidades INDEPENDIENTES (features distintas que no comparten archivos ni logica), recomienda dividir:

1. Lista cada spec que se necesitaria, con titulo descriptivo y alcance resumido
2. Recomienda al usuario: "Esta solicitud necesita N specs independientes. Para implementar en paralelo, abre una sesion por spec y ejecuta `/planificar` en cada una con el alcance de esa spec individual. Luego `/implementar-spec` en cada sesion ejecuta todas las tasks de esa spec."
3. Pregunta si quiere:
   - **(A)** Continuar con UNA spec en esta sesion (indica cual)
   - **(B)** Dividir en sesiones separadas (la opcion recomendada para specs independientes)

Si la solicitud es UNA sola spec, o el usuario elige continuar con una, lanza el workflow directamente.

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

---
description: "Implementa TODAS las tasks de una spec: tasks independientes en paralelo, revision adversarial al final"
---

Ejecuta el workflow de implementacion completa de una spec.

ANTES de lanzar el workflow, verifica:

1. Busca la spec indicada por el usuario en ai_docs/tasks/spec_*.md
2. Verifica que tiene "Estado: APROBADA"
3. Busca tasks derivadas que referencien esta spec en ai_docs/tasks/
4. Si no existe spec aprobada o no hay tasks: DETENTE y di al usuario que ejecute `/planificar` primero

Si todo esta en orden, usa la herramienta Workflow con nombre "implementar-spec" y pasa como args el path de la spec (ej: ai_docs/tasks/spec_autenticacion.md).

El workflow:
1. Descubre las tasks y sus dependencias
2. Agrupa en oleadas: tasks independientes corren en paralelo, tasks con dependencias esperan a que sus prerequisitos terminen
3. Ejecuta cada oleada (paralelo dentro, secuencial entre oleadas)
4. Revision adversarial de toda la implementacion

Al completarse, presenta al usuario:

1. **Oleadas ejecutadas** — cuantas, cuales tasks en cada una, cuales corrieron en paralelo
2. **Detalle por task** — archivos modificados, tests creados, commit realizado
3. **Revision adversarial** — veredicto, problemas criticos y menores
4. **Hallazgos fuera de alcance** — para tasks futuras

Si el veredicto es **APROBADA**: indica que puede crear la PR con `/pr`.
Si el veredicto es **NECESITA_CORRECCIONES**: detalla las correcciones y pregunta si quiere aplicarlas.
Si el veredicto es **RECHAZADA**: detalla los problemas graves y recomienda revisar la planificacion.

Solicitud del usuario:

$ARGUMENTS

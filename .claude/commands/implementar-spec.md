---
description: "Implementa TODAS las tasks de una spec via workflow (secuencial + revision adversarial)"
---

Ejecuta el workflow de implementacion completa de una spec.

ANTES de lanzar el workflow, verifica:

1. Busca la spec indicada por el usuario en ai_docs/tasks/spec_*.md
2. Verifica que tiene "Estado: APROBADA"
3. Busca tasks derivadas que referencien esta spec en ai_docs/tasks/
4. Si no existe spec aprobada o no hay tasks: DETENTE y di al usuario que ejecute `/planificar` primero

Si todo esta en orden, usa la herramienta Workflow con nombre "implementar-spec" y pasa como args el path de la spec (ej: ai_docs/tasks/spec_autenticacion.md).

Al completarse el workflow, presenta al usuario:

1. **Resumen de implementacion** — tasks completadas vs fallidas
2. **Detalle por task** — archivos modificados, tests creados, commit realizado
3. **Revision adversarial** — veredicto, problemas criticos y menores
4. **Hallazgos fuera de alcance** — para tasks futuras

Si el veredicto es **APROBADA**: indica que puede crear la PR con `/pr`.
Si el veredicto es **NECESITA_CORRECCIONES**: detalla las correcciones y pregunta si quiere aplicarlas.
Si el veredicto es **RECHAZADA**: detalla los problemas graves y recomienda revisar la planificacion.

Solicitud del usuario:

$ARGUMENTS

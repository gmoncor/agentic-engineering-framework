---
description: "Implementa TODAS las tasks de una spec: una task tras otra en orden de dependencias, revision adversarial por task antes de commitear"
---

Ejecuta el workflow de implementacion completa de una spec.

ANTES de lanzar el workflow, verifica:

1. Busca la spec indicada por el usuario en ai_docs/tasks/spec_*.md
2. Verifica que tiene "Estado: APROBADA"
3. Busca tasks derivadas que referencien esta spec en ai_docs/tasks/
4. Si no existe spec aprobada o no hay tasks: DETENTE y di al usuario que ejecute `/planificar` primero

Si todo esta en orden, usa la herramienta Workflow con nombre "implementar-spec" y pasa como args el path de la spec (ej: ai_docs/tasks/spec_autenticacion.md).

El workflow:
1. Descubre las tasks y sus dependencias, y las ordena de forma que cada task va despues de todas las tasks de las que depende
2. Implementa cada task en ese orden, una tras otra. Para cada task: implementa, ejecuta tests, revision adversarial, y si aprobada, commitea antes de pasar a la siguiente
3. Si una task no se aprueba tras corregirla, queda FALLIDA y las que dependan de ella se reportan como bloqueadas, sin implementar
4. Al terminar, resume el resultado de todas las tasks

Un ciclo de dependencias entre tasks detiene el workflow con error: hay que corregir el plan antes de implementar.

Al completarse, presenta al usuario:

1. **Orden de ejecucion** — orden en que se implementaron las tasks y resultado de cada una
2. **Detalle por task** — archivos modificados, tests creados, commit realizado
3. **Revision adversarial** — veredicto, problemas criticos y menores
4. **Hallazgos fuera de alcance** — para tasks futuras

Si el veredicto es **APROBADA**: indica que puede crear la PR con `/pr`.
Si el veredicto es **NECESITA_CORRECCIONES**: detalla las correcciones y pregunta si quiere aplicarlas.
Si el veredicto es **RECHAZADA**: detalla los problemas graves y recomienda revisar la planificacion.

Solicitud del usuario:

$ARGUMENTS

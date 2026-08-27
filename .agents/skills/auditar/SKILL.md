---
name: auditar
description: "Se activa cuando el usuario pide auditar la coherencia entre una spec y sus tasks derivadas: cobertura, huecos, solapes y dependencias."
---

Lee y sigue el proceso completo de `ai_docs/dev_templates/auditar_spec.md`.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

Lee ademas la spec y todas sus tasks.

Comprueba: cobertura (cada criterio de aceptacion tiene task), huecos, solapes de archivos entre
tasks, dependencias declaradas y coherencia global. Emite un veredicto explicito.

La auditoria es obligatoria en toda planificacion, y es el gate que cierra la
planificacion: sin veredicto, no se implementa.

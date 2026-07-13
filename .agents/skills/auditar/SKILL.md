---
name: auditar
description: "Se activa cuando el usuario pide auditar la coherencia entre una spec y sus tasks derivadas: cobertura, huecos, solapes y dependencias."
---

Audita la coherencia entre una spec y sus tasks siguiendo el proceso completo de
`ai_docs/dev_templates/auditar_spec.md`.

Contexto obligatorio: lee `ai_docs/core/`, la spec y todas sus tasks.

Comprueba: cobertura (cada criterio de aceptacion tiene task), huecos, solapes de archivos entre
tasks, dependencias declaradas y coherencia global. Emite un veredicto explicito.

La auditoria es obligatoria cuando la spec tiene 3 o mas tasks, y es el gate que cierra la
planificacion: sin veredicto, no se implementa.

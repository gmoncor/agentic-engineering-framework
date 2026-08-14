<!-- Parte propia de la skill de Codex y Antigravity. El cuerpo de las
     instrucciones sale del comando homonimo de Claude Code; aqui van el
     frontmatter y lo que solo tiene sentido en formato de skill. -->
---
name: auditar
description: "Se activa cuando el usuario pide auditar la coherencia entre una spec y sus tasks derivadas: cobertura, huecos, solapes y dependencias."
---

Lee ademas la spec y todas sus tasks.

Comprueba: cobertura (cada criterio de aceptacion tiene task), huecos, solapes de archivos entre
tasks, dependencias declaradas y coherencia global. Emite un veredicto explicito.

La auditoria es obligatoria cuando la spec tiene 3 o mas tasks, y es el gate que cierra la
planificacion: sin veredicto, no se implementa.

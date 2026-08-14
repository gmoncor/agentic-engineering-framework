<!-- Parte propia de la skill de Codex y Antigravity. El cuerpo de las
     instrucciones sale del comando homonimo de Claude Code; aqui van el
     frontmatter y lo que solo tiene sentido en formato de skill. -->
---
name: tareas
description: "Se activa cuando el usuario pide derivar o partir una spec aprobada en tasks granulares. Genera las tasks con su tabla de archivos afectados y sus dependencias."
---

Lee ademas la spec madre.

Reglas que no se negocian:

- Solo se derivan tasks de specs con Estado: APROBADA. Si la spec sigue en BORRADOR, detente.
- Cada task declara su tabla "Archivos afectados" y toca 6 archivos como maximo. Si supera, divide.
- Dos tasks que escriben el mismo archivo se implementan en el orden de sus dependencias, nunca simultaneamente.

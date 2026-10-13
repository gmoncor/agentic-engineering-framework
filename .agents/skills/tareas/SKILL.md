---
name: tareas
description: "Cuando hay una spec aprobada que derivar en tasks granulares: genera cada task con su tabla de archivos afectados y sus dependencias. El ciclo completo: planificar."
---

Lee y sigue el proceso completo de `ai_docs/dev_templates/tareas.md`.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

Lee ademas la spec madre.

Reglas que no se negocian:

- Solo se derivan tasks de specs con Estado: APROBADA. Si la spec sigue en BORRADOR, detente.
- Cada task declara su tabla "Archivos afectados" y toca 6 archivos como maximo. Si supera, divide.
- Dos tasks que escriben el mismo archivo se implementan en el orden de sus dependencias, nunca simultaneamente.

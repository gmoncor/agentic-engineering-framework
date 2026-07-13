---
name: tareas
description: "Se activa cuando el usuario pide derivar o partir una spec aprobada en tasks granulares. Genera las tasks con su tabla de archivos afectados y sus dependencias."
---

Parte una spec APROBADA en tasks siguiendo el proceso completo de `ai_docs/dev_templates/tareas.md`.

Contexto obligatorio: lee `ai_docs/core/` y la spec madre.

Reglas que no se negocian:

- Solo se derivan tasks de specs con Estado: APROBADA. Si la spec sigue en BORRADOR, detente.
- Cada task declara su tabla "Archivos afectados" y toca 6 archivos como maximo. Si supera, divide.
- Dos tasks que escriben el mismo archivo no pueden implementarse a la vez: declara la dependencia.

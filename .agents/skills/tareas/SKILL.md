---
name: tareas
description: "Cuando hay una spec aprobada que derivar en tasks granulares: genera cada task con su tabla de archivos afectados y sus dependencias. El ciclo completo: planificar."
---

Lee y sigue el proceso completo de `ai_docs/dev_templates/tareas.md`.

Contexto del proyecto: abre el índice y los headings de `ai_docs/core/`; lee solo las secciones y rutas que
sostienen los criterios. Si falta una premisa central, un locator o hay contradicción, amplía la lectura de
ese criterio y decláralo.

Lee ademas la spec madre.

Reglas que no se negocian:

- Solo se derivan tasks de specs con Estado: APROBADA. Si la spec sigue en BORRADOR, detente.
- Cada task declara su tabla "Archivos afectados". Revisa alcance, datos, contratos compartidos, seguridad
  y dependencias; divide solo ante un riesgo o una unidad independiente.
- Dos tasks que escriben el mismo archivo se implementan en el orden de sus dependencias, nunca simultaneamente.

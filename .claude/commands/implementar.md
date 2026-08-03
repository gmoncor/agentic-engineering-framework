---
description: "Implementa UNA task en orden secuencial"
---

ANTES de implementar, verifica estos requisitos:

1. Busca specs aprobadas en ai_docs/tasks/spec_*.md con "Estado: APROBADA"
2. Busca tasks derivadas en ai_docs/tasks/NNN_*.md
3. Si no existe spec aprobada ni tasks: DETENTE y di al usuario que ejecute /planificar primero

Ejecuta UNA task a la vez, en orden secuencial. Cuando termine, el usuario decidira cual sigue.

Lee y sigue el proceso completo de `ai_docs/dev_templates/implementar.md`.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

Aviso: si `sdd_review_gate` esta activado en `hooks/config.json`, este flujo manual no emite la senal que satisface el gate de revision; usa `/implementar-spec` en su lugar.

Solicitud del usuario:

$ARGUMENTS

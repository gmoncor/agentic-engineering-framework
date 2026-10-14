---
description: "Revision adversarial de la implementacion contra la spec"
argument-hint: "[spec o rama a revisar]"
---

Paso 0 — confirma el estado real antes de revisar: comprueba si la rama ya está fusionada en la rama base. Mira primero el estado de su PR, si la hay; si no, ejecuta `git fetch` y `git branch --merged origin/<base> -r`. Esa comprobación no detecta un squash ni un rebase merge: que la rama no aparezca no prueba que no se fusionó. La conversación no basta: la fusión pudo ocurrir en paralelo. Si ya está fusionada, dilo al empezar el informe y revisa como post-merge: los hallazgos BLOQUEANTES ya no impiden el merge, sino que piden una corrección o una reversión.

Lee y sigue el proceso completo de `ai_docs/dev_templates/revision_adversarial.md`.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

<!-- solo-claude -->
Aviso: si `sdd_review_gate` esta activado en `hooks/config.json`, este flujo manual no emite la senal que satisface el gate de revision; usa `/implementar-spec` en su lugar.
<!-- /solo-claude -->

Solicitud del usuario:

$ARGUMENTS

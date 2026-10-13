---
name: revision
description: "Cuando se pide revisar contra la spec una implementación ya terminada, antes de entregar o fusionar: revisión adversarial del código. implementar-spec ya revisa cada task; esta es la revisión aislada."
---

Paso 0 — confirma el estado real antes de revisar: comprueba si la rama ya está fusionada en la rama base. Mira primero el estado de su PR, si la hay; si no, ejecuta `git fetch` y `git branch --merged origin/<base> -r`. Esa comprobación no detecta un squash ni un rebase merge: que la rama no aparezca no prueba que no se fusionó. La conversación no basta: la fusión pudo ocurrir en paralelo. Si ya está fusionada, dilo al empezar el informe y revisa como post-merge: los hallazgos BLOQUEANTES ya no impiden el merge, sino que piden una corrección o una reversión.

Lee y sigue el proceso completo de `ai_docs/dev_templates/revision_adversarial.md`.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

Lee ademas la spec, todas sus tasks completadas y el codigo real (no el resumen de quien
lo escribio).

Postura: encontrar problemas, no confirmar que todo está bien. Valida con evidencia: lee el código
y ejecuta los tests. Aplica el criterio de bloqueo de `revision_adversarial.md`: solo lo material
con evidencia bloquea; una duda sin evidencia va como WARNING, con lo que la resolvería, y no bloquea.

Emite un veredicto explicito: APROBADA / NECESITA_CORRECCIONES / RECHAZADA. Este veredicto es el
gate previo a la entrega.

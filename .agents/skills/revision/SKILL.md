---
name: revision
description: "Se activa cuando el usuario pide revisar la implementacion ya terminada contra la spec, antes de entregar o mergear. Revision adversarial del codigo."
---

Ejecuta la revision adversarial siguiendo el proceso completo de
`ai_docs/dev_templates/revision_adversarial.md`.

Contexto obligatorio: lee `ai_docs/core/`, la spec y todas sus tasks completadas, y el codigo real
(no el resumen de quien lo escribio).

Postura: encontrar problemas, no confirmar que todo esta bien. Valida con evidencia — lee el codigo
y ejecuta los tests. Si la evidencia es ambigua, reporta el hallazgo.

Emite un veredicto explicito: APROBADA / NECESITA_CORRECCIONES / RECHAZADA. Este veredicto es el
gate previo a la entrega.

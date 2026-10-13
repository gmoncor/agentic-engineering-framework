---
name: pr
description: "Solo cuando el usuario pide explícitamente crear o revisar una Pull Request: sigue `revision_pr.md`, que exige la revisión adversarial previa. Misma plantilla que el comando homónimo, donde el backend lo tiene."
argument-hint: "[numero de PR | create]"
---

Ejecuta el flujo de PR siguiendo `ai_docs/dev_templates/revision_pr.md`.

Aplica los pasos de la plantilla pertinentes al riesgo del cambio; declara los omitidos con su motivo.
En el flujo SDD, la PR referencia la spec y las tasks que cierra.

---
name: pr
description: "Solo cuando el usuario pide explícitamente crear o revisar una Pull Request: sigue `revision_pr.md`, que exige la revisión adversarial previa. Misma plantilla que el comando homónimo, donde el backend lo tiene."
argument-hint: "[numero de PR | create]"
disable-model-invocation: true
---

Ejecuta el flujo de PR siguiendo `ai_docs/dev_templates/revision_pr.md`.

Sigue todos los pasos de la plantilla sin saltarte ninguno.
En el flujo SDD, la PR referencia la spec y las tasks que cierra.

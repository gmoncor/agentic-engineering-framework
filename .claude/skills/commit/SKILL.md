---
name: commit
description: "Cuando hay cambios listos para guardar en git: excluye `ai_docs/` y ficheros sensibles y propone el mensaje `<tipo>: <descripcion>`. Resumir cambios: diff; la PR: pr. Misma plantilla que el comando homónimo, donde el backend lo tiene."
argument-hint: "[mensaje de commit]"
---

Ejecuta el flujo de commit siguiendo `ai_docs/dev_templates/hacer_commit.md`.

Aplica los pasos de la plantilla pertinentes al riesgo del cambio; declara los omitidos con su motivo.
Presenta el mensaje de commit para aprobacion antes de ejecutar.

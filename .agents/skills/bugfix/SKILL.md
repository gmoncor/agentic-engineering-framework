---
name: bugfix
description: "Ante un error, una excepción, un test rojo o un comportamiento inesperado: reproducción, causa raíz y test de regresión. Mejorar código que ya funciona: cleanup. Misma plantilla que el comando homónimo, donde el backend lo tiene."
---

Ejecuta el diagnostico y correccion siguiendo `ai_docs/dev_templates/correccion_de_bugs.md`.

Aplica los pasos de la plantilla pertinentes al riesgo del cambio; declara los omitidos con su motivo.
Si el bug es complejo (3+ archivos), sugiere crear una task en lugar de un fix rapido.

## Uso a peticion explicita

Cuando el usuario pide directamente corregir un bug, la descripcion del error que aporte es la
entrada del paso 1 de la plantilla (reproduccion). Si no aporta ninguna, pidesela antes de tocar
codigo: sin reproduccion no hay diagnostico, solo conjetura.

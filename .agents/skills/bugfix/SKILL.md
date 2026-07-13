---
name: bugfix
description: "Se activa ante errores, fallos, excepciones, 'no funciona', 'se rompe', 'falla', comportamiento inesperado. Triaje y correccion de bugs con diagnostico de causa raiz."
---

Ejecuta el diagnostico y correccion siguiendo `ai_docs/dev_templates/correccion_de_bugs.md`.

Sigue todos los pasos de la plantilla sin saltarte ninguno.
Si el bug es complejo (3+ archivos), sugiere crear una task en lugar de un fix rapido.

## Uso a peticion explicita

Cuando el usuario pide directamente corregir un bug, la descripcion del error que aporte es la
entrada del paso 1 de la plantilla (reproduccion). Si no aporta ninguna, pidesela antes de tocar
codigo: sin reproduccion no hay diagnostico, solo conjetura.

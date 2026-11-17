---
name: bugfix
description: "Ante un error, una excepción, un test rojo o un comportamiento inesperado: reproducción, hipótesis falsable, causa probada y caracterización. Mejorar código que ya funciona: cleanup."
---

Ejecuta el diagnostico y correccion siguiendo `ai_docs/dev_templates/correccion_de_bugs.md`.

Aplica los pasos de la plantilla pertinentes al riesgo del cambio; declara los omitidos con su motivo.
Escala a una task ante riesgo de datos, contrato compartido, seguridad, migración o alcance ambiguo; no por
el número de archivos. Escribe un test de caracterización rojo antes de corregir cuando sea proporcional al
riesgo.

## Uso a peticion explicita

Cuando el usuario pide directamente corregir un bug, la descripcion del error que aporte es la
entrada del paso 1 de la plantilla (reproduccion). Si no aporta ninguna, pidesela antes de tocar
codigo: sin reproduccion no hay diagnostico, solo conjetura.

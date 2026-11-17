---
name: bugfix
description: "Ante un error, una excepción, un test rojo o un comportamiento inesperado: reproducción, hipótesis falsable, causa probada y caracterización. Mejorar código que ya funciona: cleanup."
argument-hint: "[descripcion del error]"
---

Ejecuta el diagnostico y correccion siguiendo `ai_docs/dev_templates/correccion_de_bugs.md`.

Aplica los pasos de la plantilla pertinentes al riesgo del cambio; declara los omitidos con su motivo.
Escala a una task ante riesgo de datos, contrato compartido, seguridad, migración o alcance ambiguo; no por
el número de archivos. Escribe un test de caracterización rojo antes de corregir cuando sea proporcional al
riesgo.

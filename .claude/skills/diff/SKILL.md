---
name: diff
description: "Se activa cuando el usuario pregunta 'que cambie', 'que he tocado', 'resumen de cambios', 'que se ha modificado'. Analiza los cambios pendientes y genera un resumen legible."
---

Analiza los cambios actuales del repositorio y presenta un resumen:

1. Ejecuta `git diff --stat` y `git diff` para ver cambios staged y unstaged
2. Agrupa los cambios por modulo o funcionalidad
3. Para cada grupo, describe brevemente QUE cambio y POR QUE (si es deducible del diff)
4. Si hay archivos nuevos, mencionarlos
5. Si hay cambios sin commitear que mezclan funcionalidades distintas, sugerirlo

Formato de salida: resumen conciso con archivos agrupados, no el diff raw completo.

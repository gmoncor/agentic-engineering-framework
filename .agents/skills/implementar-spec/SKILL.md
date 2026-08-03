---
name: implementar-spec
description: "Se activa cuando el usuario pide implementar una spec completa o ejecutar todas sus tasks. Implementa las tasks respetando dependencias y cierra con revision adversarial."
---

Implementa TODAS las tasks de una spec APROBADA.

## Antes de empezar

1. Localiza la spec en `ai_docs/tasks/spec_*.md` y verifica que tiene Estado: APROBADA.
2. Localiza las tasks que la referencian en `ai_docs/tasks/`.
3. Si no hay spec aprobada o no hay tasks: DETENTE y pide al usuario que planifique primero.
4. Construye el grafo: dependencias declaradas + archivos de cada tabla "Archivos afectados". Un
   ciclo de dependencias detiene la implementacion: hay que corregir el plan antes de escribir codigo.

## Ejecucion

- **Orden lineal:** implementa cada task en orden de dependencias, una tras otra: para cada task,
  ejecuta un agente `implementador` que sigue `ai_docs/dev_templates/implementar.md`, revisa el
  diff y commitea antes de pasar a la siguiente.
- **Gate por task:** antes del commit, un agente aparte (contexto limpio) revisa ESE diff. Solo si
  aprueba se emite la senal atada al diff y se crea el commit. Asi cada unidad se valida antes de
  avanzar a la siguiente.
- **Gate final:** solo si todas las tasks se completaron (ninguna quedo FALLIDA), el agente
  `revisor` ejecuta el Paso 4bis de `ai_docs/dev_templates/revision_adversarial.md` en modo
  standalone (no la revision completa):
  reconcilia el resultado real de cada task con sus criterios de exito asignados y con la seccion
  "No incluye" de la spec. Si el veredicto es `DIVERGE`, genera una task de convergencia por cada
  hallazgo bloqueante, numerada con `scripts/next-task-number.sh` (o manualmente si el script no
  esta disponible en el proyecto). Si el veredicto es `CONVERGIDA`, la spec queda cerrada.

## Resultado

1. Orden de ejecucion de las tasks y resultado de cada una.
2. Detalle por task: archivos modificados, tests creados, commit realizado.
3. Convergencia de cierre: veredicto (`CONVERGIDA` o `DIVERGE`) y hallazgos del Paso 4bis.
4. Tasks de convergencia generadas (si `DIVERGE`), o confirmacion de cierre (si `CONVERGIDA`).

Si el veredicto es **CONVERGIDA**, el usuario puede crear la PR.
Si es **DIVERGE**, presenta las tasks de convergencia generadas antes de continuar.

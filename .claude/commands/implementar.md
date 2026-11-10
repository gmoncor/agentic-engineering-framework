---
description: "Implementa UNA task en orden secuencial"
argument-hint: "[task NNN o descripción]"
---

ANTES de implementar, verifica estos requisitos:

1. Relee la task, su tabla "Archivos afectados", `git status` y `git log -1`; si no son compatibles, DETENTE y muestra la discrepancia.
2. Busca specs aprobadas en ai_docs/tasks/spec_*.md y tasks derivadas en ai_docs/tasks/NNN_*.md.
3. Si no existe spec aprobada ni task: DETENTE y di al usuario que ejecute /planificar primero.
4. Si está `COMPLETADA`, no la reabras: un cambio nuevo requiere una task nueva. Si está `BLOQUEADA_REVISION`, presenta los hallazgos al usuario. Si está `FALLIDA`, lee su salida y aplica `correccion_de_bugs.md`. Si está `EN_PROGRESO` o `PARCIAL`, conserva sus desviaciones y continúa solo tras la relectura.

Ejecuta una task de producto en esta sesión. Revisa su alcance por riesgo, datos y contratos; no la divides por un máximo fijo de ficheros. Cuando termine, recomienda como único siguiente paso la acción que corresponde.

Lee y sigue el proceso completo de `ai_docs/dev_templates/implementar.md`.

Mantén el campo `Estado` de la task (la última línea propia `Estado:` de su documento; no añadas otra):

- Solo desde `PENDIENTE`, pásalo a `EN_PROGRESO`.
- `COMPLETADA` solo si en esta misma sesión se crea el commit de la task. Si no se commitea, déjala en `EN_PROGRESO` y dilo en el resumen final.
- Si la implementación queda a medias, `PARCIAL`; si falla (tests en rojo, revisión adversa, error), `FALLIDA`. En los dos casos, anota el motivo en la task.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

<!-- solo-claude -->
Aviso: si `sdd_review_gate` esta activado en `hooks/config.json`, este flujo manual no emite la senal que satisface el gate de revision; usa `/implementar-spec` en su lugar.
<!-- /solo-claude -->

Solicitud del usuario:

$ARGUMENTS

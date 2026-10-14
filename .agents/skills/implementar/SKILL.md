---
name: implementar
description: "Cuando el usuario pide implementar UNA task concreta del plan con control manual: escribe código y tests solo de los archivos que la task declara. La spec completa: implementar-spec."
---

ANTES de implementar, verifica estos requisitos:

1. Busca specs aprobadas en ai_docs/tasks/spec_*.md con "Estado: APROBADA"
2. Busca tasks derivadas en ai_docs/tasks/NNN_*.md
3. Si no existe spec aprobada ni tasks: DETENTE y di al usuario que ejecute la skill `planificar` primero

Ejecuta UNA task a la vez, en orden secuencial. Cuando termine, el usuario decidira cual sigue.

Lee y sigue el proceso completo de `ai_docs/dev_templates/implementar.md`.

Mantén el campo `Estado` de la task (la última línea propia `Estado:` de su documento; no añadas otra):

- Al empezar, pásalo a `EN_PROGRESO`.
- `COMPLETADA` solo si en esta misma sesión se crea el commit de la task. Si no se commitea, déjala en `EN_PROGRESO` y dilo en el resumen final.
- Si la implementación queda a medias, `PARCIAL`; si falla (tests en rojo, revisión adversa, error), `FALLIDA`. En los dos casos, anota el motivo en la task.

Contexto del proyecto: lee `ai_docs/core/` para entender vision, planificacion y roadmap.

Lee ademas la spec madre de la task.

## Alcance

Solo tocas los archivos de la tabla "Archivos afectados" de la task. Escribir fuera de esa lista lo
deniega el guardarrail del pipeline. Lo que descubras fuera de alcance se documenta como hallazgo,
no se corrige aqui. La task cierra con su commit.

Para implementar la spec entera, usa la skill `implementar-spec`.

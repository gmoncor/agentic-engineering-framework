---
name: implementar
description: "Se activa cuando el usuario pide implementar UNA task concreta del plan, con control manual. Escribe codigo y tests solo de los archivos que la task declara."
---

Implementa UNA task, siguiendo el proceso completo de `ai_docs/dev_templates/implementar.md`.

## Antes de implementar

1. Verifica que existe una spec con Estado: APROBADA en `ai_docs/tasks/spec_*.md`.
2. Verifica que existe la task (`ai_docs/tasks/NNN_*.md`) y que referencia esa spec.
3. Si falta cualquiera de las dos: DETENTE y pide al usuario que planifique primero.

Contexto obligatorio: lee `ai_docs/core/` y la spec madre de la task.

## Alcance

Solo tocas los archivos de la tabla "Archivos afectados" de la task. Escribir fuera de esa lista lo
deniega el guardarrail del pipeline. Lo que descubras fuera de alcance se documenta como hallazgo,
no se corrige aqui. La task cierra con su commit.

Una task a la vez: cuando termine, el usuario decide cual sigue. Para implementar la spec entera,
usa la skill `implementar-spec`.

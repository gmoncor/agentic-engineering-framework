<!-- Variante propia de la skill para Codex y Antigravity. El comando de Claude
     Code delega esta secuencia en su herramienta de workflows, que estos
     backends no tienen: aqui el procedimiento va escrito paso a paso. Es el
     unico sitio donde se edita esa version; el SKILL.md se genera desde aqui.
     Misma excepcion, y por el mismo motivo, que la variante de este comando
     para el backend de Gemini.
     La nota de aislamiento por worktree del comando tampoco aparece en la
     variante de Gemini: las dos variantes describen el procedimiento minimo, y
     el aislamiento del arbol de trabajo se documenta una sola vez, en el
     comando y en la plantilla de revision de PR. -->
---
name: implementar-spec
description: "Cuando el usuario pide implementar una spec completa o todas sus tasks, en orden de dependencias o en paralelo. El agente `revisor` revisa el diff de cada task y solo con APROBADA se commitea."
source-body: omit
---

Implementa TODAS las tasks de una spec APROBADA.

## Antes de empezar

1. Localiza la spec en `ai_docs/tasks/spec_*.md` y verifica que tiene Estado: APROBADA.
2. Localiza las tasks que la referencian en `ai_docs/tasks/`.
3. Si no hay spec aprobada o no hay tasks: DETENTE y pide al usuario que planifique primero.
4. Construye el grafo: dependencias declaradas + archivos de cada tabla "Archivos afectados". Un
   ciclo de dependencias detiene la implementación: hay que corregir el plan antes de escribir código.
5. Comprueba que el árbol está limpio fuera de los documentos de plan y del registro de sesiones:
   `git status --porcelain -- . ':(exclude)ai_docs/tasks' ':(exclude)ai_docs/audits'` debe salir
   vacío. Si no, DETENTE: el commit de la primera task absorbería esos cambios. Ofrece commitearlos,
   apartarlos con `git stash push --include-untracked` o lanzar la spec en un worktree limpio. Lo que
   esté sucio en `ai_docs/core/` se propone commitearlo: los agentes lo leen como contexto.

## Ejecución

- **Orden de dependencias:** implementa cada task en orden de dependencias. Antes de empezarla,
  escribe su `Estado: EN_PROGRESO`; luego ejecuta un agente `implementador` que sigue
  `ai_docs/dev_templates/implementar.md`. Una task con alguna dependencia que no esté `COMPLETADA`
  no se toca: su `Estado` sigue como estaba.
- **Gate por task:** antes del commit, un agente `revisor` nuevo (contexto limpio) revisa ESE diff;
  solo con APROBADA se commitea. Así cada unidad se valida antes de avanzar a la siguiente.
- **Rondas de corrección:** con NECESITA_CORRECCIONES o RECHAZADA, el `implementador` corrige solo
  los hallazgos bloqueantes, se vuelve a pasar el comando de tests y un `revisor` nuevo revisa el
  delta con los hallazgos previos. Tope: 3 rondas. Agotado el tope, la task queda
  `BLOQUEADA_REVISION`, no se commitea y decide el usuario con los hallazgos abiertos y su
  corrección propuesta.
- **Estado de cada task:** `COMPLETADA` solo tras su commit; `PARCIAL`, `FALLIDA` o
  `BLOQUEADA_REVISION` según su resultado, como fija la tabla del ciclo de vida del `Estado` en
  `ai_docs/dev_templates/tareas.md`. Solo `COMPLETADA` satisface una dependencia.
- **Trabajo de una task no aprobada:** se aparta sin destruirlo, recuperable con `git stash pop`:
  `git stash push --include-untracked -m "sdd-apartado: <titulo>" -- . ':(exclude)ai_docs/tasks' ':(exclude)ai_docs/audits'`.
  Con tasks a la vez, el pathspec se acota a los ficheros de la task que tienen cambios (los que
  lista `git status --porcelain`). Nunca se descarta con `git reset` ni con `git clean`.
- **Gate final:** solo si todas las tasks quedaron `COMPLETADA`, un agente `revisor` ejecuta el Paso
  4bis de `ai_docs/dev_templates/revision_adversarial.md` en modo standalone (no la revisión
  completa): reconcilia el resultado real de cada task con sus criterios de éxito asignados y con la
  sección "No incluye" de la spec. El revisor reporta y no escribe ficheros. Si el veredicto es
  `DIVERGE`, esta sesión crea una task de convergencia por cada hallazgo bloqueante, numerada con
  `scripts/next-task-number.sh`; si el script no está disponible, reporta el error y lista los
  hallazgos, sin crear tasks. Si el veredicto es `CONVERGIDA`, la spec queda cerrada. Si el gate
  final no llega a ejecutarse porque alguna task no quedó `COMPLETADA`, el veredicto de convergencia
  es `OMITIDA`.

## Resultado

1. Orden de ejecución de las tasks y resultado de cada una.
2. Detalle por task: archivos modificados, tests creados, commit realizado o trabajo apartado.
3. Convergencia de cierre: veredicto (`CONVERGIDA`, `DIVERGE` u `OMITIDA`) y hallazgos del Paso 4bis.
4. Tasks de convergencia generadas (si `DIVERGE`), o confirmación de cierre (si `CONVERGIDA`).

Si el veredicto es **CONVERGIDA**, el usuario puede crear la PR.
Si es **DIVERGE**, presenta las tasks de convergencia generadas antes de continuar.
Si es **OMITIDA**, no se llegó a verificar la convergencia: resuelve primero las tasks que no
quedaron `COMPLETADA` y vuelve a lanzar la implementación.

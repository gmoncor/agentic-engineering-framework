<!-- Variante propia del comando para Gemini. El comando de Claude Code delega
     esta secuencia en su herramienta de workflows, que este backend no tiene:
     aqui el procedimiento va escrito paso a paso dentro del prompt. Es el
     unico sitio donde se edita esa version; el .toml se genera desde aqui. -->
---
description: "Implementa TODAS las tasks de una spec en orden de dependencias, revision adversarial de cada una antes de commitear"
---

Implementa TODAS las tasks de una spec, en orden de dependencias.

ANTES de implementar, verifica:

1. Busca la spec indicada por el usuario en ai_docs/tasks/spec_*.md
2. Verifica que tiene "Estado: APROBADA"
3. Busca las tasks derivadas que referencien esta spec en ai_docs/tasks/
4. Si no existe spec aprobada o no hay tasks: DETENTE y di al usuario que ejecute /planificar primero

PROCESO (ejecuta en orden):

PASO 1 — DESCUBRIMIENTO Y ORDEN
Lee la spec y encuentra todas sus tasks en ai_docs/tasks/.
Para cada task, extrae sus dependencias (paths de otras tasks de las que depende).
Si una dependencia apunta a una task que no existe, DETENTE: es un error del plan; nombra la task ausente y pide corregirlo.
Si las dependencias forman un ciclo, DETENTE: nombra las tasks del ciclo y pide corregir el plan.
Ordena las tasks topologicamente: cada task va despues de todas sus dependencias.
Muestra al usuario el orden de ejecucion antes de continuar.

PASO 2 — IMPLEMENTACION (orden de dependencias)
Recorre las tasks en el orden del PASO 1. Para cada task, en este orden:
a. Lee ai_docs/dev_templates/implementar.md y sigue su proceso completo
b. Lee ai_docs/core/ para el contexto del proyecto
c. Implementa los cambios descritos en la task
d. Escribe tests (RED-GREEN cuando aplique: el test debe fallar sin tu cambio)
e. Ejecuta como gate el comando de test real del proyecto (p. ej. `npm test`, `pytest`, el que declare el stack) y lee su exit code. Si es distinto de 0, corrige antes de continuar; no commitees en rojo
f. Revision adversarial de ESTA task: lee ai_docs/dev_templates/revision_adversarial.md y aplicalo SOLO al diff de esta task, con postura esceptica (busca bugs, edge cases, regresiones, codigo muerto, seguridad). Emite veredicto: APROBADA, NECESITA_CORRECCIONES o RECHAZADA
g. Si NO es APROBADA: corrige los problemas y vuelve a revisar. Si sigue sin aprobarse, marca la task como FALLIDA y NO la commitees
h. Si es APROBADA: haz commit de esa task. Subject "<tipo>: <descripcion>" (max 72 chars); cuerpo con QUE cambio y POR QUE. Tipos validos: feat, fix, update, refactor, create, optimize, remove, rename, docs, test, style, chore
Si una task queda FALLIDA, las que dependan de ella NO se implementan: se reportan como bloqueadas.

PASO 3 — RESUMEN
Presenta: orden de ejecucion, tasks completadas, tasks fallidas o bloqueadas, archivos modificados, tests creados.
Si alguna task fallo: detalla que corregir y DETENTE aqui (no ejecutes el sub-paso de convergencia).

PASO 3bis — CONVERGENCIA (solo si todas las tasks se completaron)
Aplica el Paso 4bis de ai_docs/dev_templates/revision_adversarial.md en modo standalone contra la spec: reconcilia el resultado real de cada task con sus criterios de exito asignados y con la seccion "No incluye".
Si el veredicto es DIVERGE: por cada hallazgo BLOQUEANTE, genera una task de convergencia numerada con scripts/next-task-number.sh (si el script no existe en este proyecto, numera la task manualmente y dejalo indicado).
Si el veredicto es CONVERGIDA: indica que la spec esta cerrada y sugiere /pr.

Solicitud del usuario:

{{args}}

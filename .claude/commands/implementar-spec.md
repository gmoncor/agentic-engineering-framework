---
description: "Implementa TODAS las tasks de una spec en orden de dependencias, revision adversarial por task antes de commitear"
---

Ejecuta el workflow de implementacion completa de una spec.

ANTES de lanzar el workflow, verifica:

1. Busca la spec indicada por el usuario en ai_docs/tasks/spec_*.md
2. Verifica que tiene "Estado: APROBADA"
3. Busca tasks derivadas que referencien esta spec en ai_docs/tasks/
4. Si no existe spec aprobada o no hay tasks: DETENTE y di al usuario que ejecute `/planificar` primero

Si todo esta en orden, usa la herramienta Workflow con nombre "implementar-spec" y pasa como args el path de la spec (ej: ai_docs/tasks/spec_autenticacion.md).

El workflow:
1. Descubre las tasks y sus dependencias, y las ordena de forma que cada task va despues de todas las tasks de las que depende
2. Implementa cada task en ese orden. Para cada task: implementa, ejecuta tests, revision adversarial, y si aprobada, commitea antes de pasar a la siguiente
3. Si una task no se aprueba tras corregirla, queda FALLIDA y las que dependan de ella se reportan como bloqueadas, sin implementar
4. Al terminar, resume el resultado de todas las tasks

Un ciclo de dependencias entre tasks detiene el workflow con error: hay que corregir el plan antes de implementar.

Al completarse, presenta al usuario:

1. **Orden de ejecucion** — orden en que se implementaron las tasks y resultado de cada una
2. **Detalle por task** — archivos modificados, tests creados, commit realizado, veredicto de su revision adversarial individual
3. **Convergencia de la spec** — una vez completadas todas las tasks, el workflow compara el resultado final contra la spec completa y devuelve uno de tres veredictos: `CONVERGIDA` (sin brechas), `DIVERGE` (brechas encontradas) u `OMITIDA` (no se llego a verificar)
4. **Hallazgos fuera de alcance** — para tasks futuras

Si el veredicto de convergencia es **CONVERGIDA**: la spec queda cerrada, puede crear la PR con `/pr`.
Si el veredicto es **DIVERGE**: detalla las brechas encontradas y las tasks `NNN_convergencia_*` generadas para cerrarlas; implementalas con el flujo normal (otra pasada de `/implementar-spec` o `/implementar` task a task) antes de abrir la PR.
Si el veredicto es **OMITIDA**: alguna task quedo FALLIDA o BLOQUEADA y por eso no se verifico la convergencia; resuelve esas tasks primero.

## Aislamiento por worktree (opcional, avanzado)

Si quieres aislar esta spec de la rama principal, crea y entra en un worktree dedicado antes de lanzar este comando (requiere git 2.5+):

```
git worktree add -b spec/<descriptor> ../spec-<descriptor> main
cd ../spec-<descriptor>
```

El paso `cd` es imprescindible: sin el, el comando se ejecuta sobre la rama principal en vez del worktree. El resto del pipeline (gates, senal de revision, tests, commits) funciona igual porque resuelve todas sus rutas relativas al directorio de trabajo actual. Al terminar, crea la PR desde la rama del worktree y limpia el worktree (ver plantilla de revision de PR).

Solicitud del usuario:

$ARGUMENTS

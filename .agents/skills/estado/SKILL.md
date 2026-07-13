---
name: estado
description: "Se activa cuando el usuario pregunta como va el proyecto, que specs y tasks hay, o cual es el progreso. Resume el estado del pipeline SDD."
---

Muestra el estado actual del proyecto SDD.

1. Lee todos los archivos de `ai_docs/tasks/`.
2. Clasificalos:
   - **Specs:** prefijo `spec_` — indica su estado (BORRADOR / APROBADA).
   - **Tasks:** prefijo numerico `NNN_` — indica su estado y su spec madre.
3. Presenta el resumen con este formato:

```
## Estado del proyecto SDD

### Specs
| Spec | Estado | Tasks derivadas |
|------|--------|-----------------|

### Tasks
| # | Titulo | Spec madre | Estado | Independiente |
|---|--------|------------|--------|---------------|

### Resumen
- Specs activas: N
- Tasks pendientes: N
- Tasks completadas: N
- Tasks en progreso: N
```

4. Si `ai_docs/tasks/` esta vacio, indicalo y sugiere empezar por la planificacion.
5. Si hay specs aprobadas sin tasks, sugiere derivarlas.
6. Si hay tasks completadas sin revision, sugiere la revision adversarial.

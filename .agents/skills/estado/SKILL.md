---
name: estado
description: "Se activa cuando el usuario pregunta como va el proyecto, que specs y tasks hay, o cual es el progreso. Resume el estado del pipeline SDD."
---

Muestra el estado actual del proyecto SDD.

## Instrucciones

1. Lee todos los archivos en `ai_docs/tasks/`
2. Clasifica cada archivo:
   - **Specs:** archivos con prefijo `spec_` — indica estado (BORRADOR / APROBADA)
   - **Tasks:** archivos con prefijo numerico `NNN_` — indica estado y spec madre. Las tasks `NNN_convergencia_<spec>.md` (generadas por la garantia de convergencia al cerrar una spec) se clasifican igual; para el resumen, cuenta cuantas tienen estado PENDIENTE
3. Presenta un resumen con este formato:

```
## Estado del proyecto SDD

### Specs
| Spec | Estado | Tasks derivadas |
|------|--------|-----------------|
| ... | ... | ... |

### Tasks
| # | Titulo | Spec madre | Estado | Independiente |
|---|--------|------------|--------|---------------|
| ... | ... | ... | ... | ... |

### Resumen
- Specs activas: N
- Tasks pendientes: N
- Tasks completadas: N
- Tasks en progreso: N
- Tasks de convergencia pendientes: N
```

4. Si `ai_docs/tasks/` esta vacio, indica que no hay specs ni tasks creadas y sugiere empezar con la skill `planificar` (o la skill `spec` si solo necesita crear una spec individual)
5. Si hay specs aprobadas sin tasks, sugiere usar la skill `tareas` para derivarlas
6. Si hay tasks completadas sin revision, sugiere usar la skill `revision`

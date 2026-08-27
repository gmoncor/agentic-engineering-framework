---
description: "Muestra el estado del proyecto SDD: specs, tasks y progreso"
---

Muestra el estado actual del proyecto SDD.

## Instrucciones

1. Lee todos los archivos en `ai_docs/tasks/`
2. Clasifica cada archivo:
   - **Specs:** archivos con prefijo `spec_` — indica estado (BORRADOR / APROBADA)
   - **Tasks:** archivos con prefijo numerico `NNN_` — indica estado, spec madre y el contenido de su campo **Dependencias:** (celda vacia si la task no lo declara). Las tasks `NNN_convergencia_<spec>.md` (generadas por la garantia de convergencia al cerrar una spec) se clasifican igual; para el resumen, cuenta cuantas tienen estado PENDIENTE
3. Presenta un resumen con este formato:

```
## Estado del proyecto SDD

### Specs
| Spec | Estado | Tasks derivadas |
|------|--------|-----------------|
| ... | ... | ... |

### Tasks
| # | Titulo | Spec madre | Estado | Dependencias |
|---|--------|------------|--------|--------------|
| ... | ... | ... | ... | ... |

### Resumen
- Specs activas: N
- Tasks pendientes: N
- Tasks de convergencia pendientes: N
- Progreso real: el campo `Estado` de una task se escribe al crearla y ningun paso posterior lo actualiza (no se reescribe tras implementar ni revisar), asi que este comando no cuenta cuantas quedan resueltas o a medias; el progreso se lee del estado de la spec (BORRADOR / APROBADA) y de los commits del proyecto
```

4. Si `ai_docs/tasks/` esta vacio, indica que no hay specs ni tasks creadas y sugiere empezar con `/planificar` (o `/spec` si solo necesita crear una spec individual)
5. Si hay specs aprobadas sin tasks, sugiere usar `/tareas` para derivarlas
6. Si hay specs aprobadas con tasks pendientes, sugiere revisar los commits del proyecto para saber cuales estan implementadas

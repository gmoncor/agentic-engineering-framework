# Plantilla de Auditoria de Spec + Tasks

> **Cuando usar:** Despues de derivar y revisar las tasks de una spec aprobada. ANTES de implementar. Verifica coherencia, completitud y ausencia de huecos.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con la spec y TODAS las tasks derivadas.

---

## Instrucciones para el Asistente de IA

> **Modo de uso — declaralo antes de empezar:**
> - **Via workflow** (`/planificar`): NO hagas preguntas ni esperes respuesta inline. Trabaja con la informacion disponible; el workflow gestiona la clarificacion y la aprobacion en sus propios puntos. El PUNTO DE ESPERA de abajo NO aplica.
> - **Uso manual** (copy-paste al asistente): si falta un dato critico, pregunta antes de continuar; respeta el PUNTO DE ESPERA hasta la respuesta del usuario.

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **MUESTRA antes de ejecutar** — Presenta el resultado completo de la auditoria al usuario ANTES de emitir el veredicto final.
2. **EXPLICA el porque** — Para cada problema encontrado, explica POR QUE es un problema y QUE consecuencia tiene.
3. **SUGIERE mejoras** — Si detectas formas de mejorar la cobertura o reducir riesgos, PROPONLAS.
4. **VERIFICA despues** — Si el usuario corrige problemas, vuelve a ejecutar las verificaciones afectadas.
5. **ESCALA cuando corresponda** — Si la auditoria revela problemas estructurales (spec mal definida, tasks incoherentes), recomienda rehacer la spec.
6. **NUNCA asumas que la primera solucion es la mejor** — Si hay multiples formas de resolver un hueco, presenta las opciones.

**Instrucciones adicionales para esta plantilla:**
- Esta plantilla es de AUDITORIA. NO modifica nada. Solo detecta problemas y emite un veredicto.
- El rol del auditor es ENCONTRAR PROBLEMAS, no confirmar que todo esta bien. Asumir que hay huecos hasta demostrar lo contrario.
- NUNCA emitas un veredicto APROBADO si hay problemas pendientes. Es preferible un falso positivo que un falso negativo.

---

## Paso 1: Inventario

Lee la spec y TODAS las tasks derivadas. Construye un inventario:

```
Spec: [Titulo]
Estado: [APROBADA — si no esta aprobada, DETENTE]
Criterios de aceptacion: [N]
Restricciones: [N]

Tasks:
  - Task NNN: [Titulo] — Dependencias: [lista o ninguna]
  - Task NNN: [Titulo] — Dependencias: [lista o ninguna]
  ...
Total tasks: [N]
```

---

## Paso 2: Verificar cobertura

Para CADA criterio de aceptacion de la spec, verificar que al menos una task lo cubre:

| Criterio de aceptacion | Task(s) que lo cubren | Estado |
|------------------------|----------------------|--------|
| [Criterio 1 de la spec] | Task NNN | CUBIERTO / SIN COBERTURA |
| [Criterio 2 de la spec] | Task NNN, Task NNN | CUBIERTO / SIN COBERTURA |
| [Criterio N de la spec] | — | SIN COBERTURA |

**Si hay criterios SIN COBERTURA:** listarlos como hallazgo BLOQUEANTE.

---

## Paso 3: Detectar overlap

Buscar tasks que hagan lo mismo o toquen los mismos archivos sin justificacion:

| Task A | Task B | Overlap | Riesgo |
|--------|--------|---------|--------|
| Task NNN | Task NNN | [Que comparten: archivo, funcionalidad, responsabilidad] | [Conflicto de merge / Trabajo duplicado / Ninguno] |

**Overlap aceptable:** dos tasks tocan el mismo archivo pero por razones distintas (ej: una agrega un campo, otra agrega una validacion diferente) Y la dependencia esta documentada.

**Overlap problematico:** dos tasks implementan la misma funcionalidad, o modifican la misma seccion del mismo archivo sin orden definido.

---

## Paso 4: Detectar huecos

Buscar partes de la spec que no estan cubiertas por ninguna task:

1. **Funcionalidades mencionadas en "Incluye" sin task correspondiente**
2. **Restricciones de la spec sin verificacion en ninguna task**
3. **Integraciones entre modulos** que ninguna task aborda (ej: Task A crea la API, Task B crea la UI, pero nadie conecta la UI a la API)
4. **Testing (hueco BLOQUEANTE):** cualquier task que toca codigo ejecutable sin tests planificados es un hueco BLOQUEANTE. Reportalo y emite como minimo el veredicto NECESITA AJUSTES. Excepcion: tasks que solo tocan docs o config estan exentas.
5. **Migraciones o cambios de datos** mencionados en la spec sin task que los ejecute

---

## Paso 5: Verificar coherencia

Verificar que las tasks no contradicen la spec ni entre si:

| Verificacion | Estado |
|-------------|--------|
| Ninguna task implementa algo excluido en "No incluye" de la spec | OK / FALLA |
| Las tasks no se contradicen entre si (ej: Task A crea campo X como string, Task B lo espera como int) | OK / FALLA |
| Los criterios de exito de las tasks son coherentes con los criterios de aceptacion de la spec | OK / FALLA |
| Las estimaciones de tamano son realistas (ninguna task supera 400 lineas) | OK / FALLA |

---

## Paso 6: Verificar dependencias

Para cada task con dependencias declaradas:

| Task | Depende de | La dependencia existe? | El orden es correcto? | La task dependiente produce lo que esta task consume? |
|------|-----------|----------------------|----------------------|-----------------------------------------------------|
| Task NNN | Task NNN | SI / NO | SI / NO | SI / NO |

**Buscar dependencias no declaradas:**
- Task que usa un tipo/modelo/API creado por otra task sin declarar la dependencia
- Tasks que comparten un archivo sin declarar el orden de dependencia entre ellas

---

## Paso 7: Presentar resultado

```
## Resultado de la auditoria

**Spec:** [Titulo]
**Tasks auditadas:** [N]

### Cobertura
- Criterios de aceptacion: [N] cubiertos / [N] total
- Criterios sin cobertura: [lista o "Ninguno"]

### Overlaps
- [N] overlaps detectados: [N] aceptables, [N] problematicos
- Problematicos: [lista o "Ninguno"]

### Huecos
- [Lista de huecos encontrados o "Ninguno"]

### Coherencia
- [Lista de incoherencias encontradas o "Todo coherente"]

### Dependencias
- [N] dependencias verificadas: [N] correctas, [N] con problemas
- Dependencias no declaradas encontradas: [lista o "Ninguna"]

### Veredicto

[APROBADO / NECESITA AJUSTES / NECESITA REPLANTEAMIENTO]

**Si NECESITA AJUSTES:**
- [Ajuste 1: que corregir y en que task]
- [Ajuste 2: que corregir y en que task]

**Si NECESITA REPLANTEAMIENTO:**
- [Razon por la que las tasks no son viables en su forma actual]
- [Recomendacion: rehacer spec / reestructurar tasks / dividir spec]
```

**PUNTO DE ESPERA (uso manual):**
- DETENTE y espera la respuesta del usuario
- Si el veredicto es NECESITA REPLANTEAMIENTO, NO continues hasta que el usuario decida como proceder
- Si el usuario aplica correcciones, vuelve a ejecutar las verificaciones afectadas (no toda la auditoria)
- Si el veredicto es APROBADO, proceder a implementacion con `implementar.md`

---

## Reglas inquebrantables

1. **NUNCA modifiques la spec ni las tasks** — esta plantilla es solo de auditoria
2. **NUNCA emitas APROBADO si hay criterios de aceptacion sin cobertura** — es un BLOQUEANTE
3. **NUNCA emitas APROBADO si una task que toca codigo ejecutable no planifica tests** — es un hueco BLOQUEANTE (docs/config exentas)
4. **NUNCA ignores overlaps problematicos** — generan conflictos de merge y trabajo duplicado
5. **El rol del auditor es encontrar problemas** — asumir que hay huecos hasta demostrar lo contrario
6. **Si la spec no esta aprobada**, DETENTE. No audites tasks de una spec en borrador
7. **Dependencias no declaradas son tan graves como huecos** — documentarlas como hallazgo

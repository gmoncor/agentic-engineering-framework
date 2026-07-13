# Plantilla de Derivacion de Tasks desde Spec

> **Cuando usar:** Despues de que una spec ha sido APROBADA. Para derivar tasks granulares e independientes.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con la spec aprobada.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta la lista completa de tasks al usuario y espera aprobacion ANTES de crear los archivos.
3. **EXPLICA el porque** — Para cada task, explica por que es una unidad independiente y por que tiene ese alcance.
4. **SUGIERE mejoras** — Si detectas que una task es demasiado grande o que dos tasks deberian fusionarse, PROPONLO.
5. **VERIFICA despues** — Tras crear las tasks, confirma que cubren toda la spec sin huecos ni overlaps.
6. **ESCALA cuando corresponda** — Si la spec genera mas de 10 tasks, sugiere dividir la spec en specs mas pequenas.
7. **NUNCA asumas que la primera solucion es la mejor** — Si hay multiples formas de dividir el trabajo, presenta las opciones.

**Instrucciones adicionales para esta plantilla:**
- Cada task debe poder ejecutarse de forma INDEPENDIENTE. Si dos tasks dependen una de la otra, documentar la dependencia explicitamente.
- Si dos tasks tocan el mismo archivo, SIEMPRE indicar la dependencia y el orden de ejecucion.
- NUNCA crees una task que requiera conocer el resultado de otra task para empezar, a menos que la dependencia este documentada.
- Las tasks definen COMO implementar. La spec define QUE. No repitas el QUE en cada task.

---

## Paso 1: Leer la spec aprobada

Antes de crear tasks, verifica:

1. **La spec tiene estado APROBADA** — si no, DETENTE y pide al usuario que la apruebe primero con `spec.md`
2. **Los criterios de aceptacion son medibles** — si alguno es vago, pide clarificacion
3. **El alcance esta definido** — las secciones "Incluye" y "No incluye" existen y son claras

---

## Paso 2: Identificar modulos independientes

Analiza la spec y agrupa los cambios en modulos o funcionalidades que se pueden implementar de forma separada.

**Criterios para separar en tasks:**

| Criterio | Ejemplo |
|----------|---------|
| Archivos distintos | Task A toca `auth/`, Task B toca `dashboard/` |
| Funcionalidad aislada | Task A crea el modelo, Task B crea la API, Task C crea la UI |
| Dependencia clara | Task B necesita que Task A exista primero |
| Testeable por separado | Cada task puede tener sus propios tests |

**Criterios para fusionar en una sola task:**

| Criterio | Ejemplo |
|----------|---------|
| Cambios en el mismo archivo por la misma razon | Agregar campo + validacion del campo |
| Un cambio no tiene sentido sin el otro | Crear tabla + crear migración |
| Total menor a 50 lineas | No vale la pena separar |

---

## Paso 3: Crear las tasks

Para cada task, usa este formato:

```markdown
# Task: [Titulo descriptivo]

**Spec madre:** [Titulo de la spec]
**Estado:** PENDIENTE
**Dependencias:** [Lista de tasks que deben completarse antes, o "Ninguna"]
**Independiente:** [SI / NO — SI si no tiene dependencias de otras tasks]
**Efectos secundarios en el sistema de ficheros:** [SI / NO — SI si instala dependencias, corre migraciones, levanta contenedores o altera el entorno mas alla de su propio codigo]
**Tamano estimado:** [min]-[max] lineas en [N] archivos

## Objetivo

[1-2 frases: que se implementa y por que. Referencia a la spec, no repitas el contexto completo.]

## Archivos afectados

| Archivo | Accion | Descripcion del cambio |
|---------|--------|----------------------|
| `ruta/archivo.ext` | CREAR / MODIFICAR / ELIMINAR | [Que se hace en este archivo] |

Esta tabla es la fuente de verdad de que archivos escribe la task. La usan el guard
que bloquea escrituras no planificadas y la implementacion en paralelo, que solo
lanza a la vez tasks cuyos archivos son disjuntos. Una task que no declara archivos
no se paraleliza con ninguna otra.

## Contratos

[Opcional. Solo si esta task produce algo que otra consume, o al reves.]

| Tipo | Nombre | Archivo |
|------|--------|---------|
| PRODUCE / CONSUME | [API, tipo, funcion exportada] | `ruta/archivo.ext` |

Si esta task CONSUME un contrato, debe declarar como dependencia la task que lo PRODUCE.

## Plan de implementacion

1. [Paso concreto 1]
2. [Paso concreto 2]
3. [Paso N]

## Criterios de exito

- [ ] [Criterio verificable 1 — derivado de la spec]
- [ ] [Criterio verificable 2]
- [ ] Tests escritos y pasando

## Edge cases

- [Caso limite 1: que pasa si X]
- [Caso limite 2: que pasa si Y]
- [Caso limite 3: que pasa si Z]
```

**Reglas para cada task:**
- El titulo debe ser accionable: "Crear endpoint de registro" no "Registro"
- Minimo 3 edge cases por task si involucra logica de negocio
- El tamano estimado debe ser realista. Si supera 400 lineas, dividir la task
- Cada task genera al menos un commit

---

## Paso 4: Definir orden de ejecucion

Despues de crear todas las tasks, construye un mapa de dependencias. Determina que puede ir a la vez y que tiene que ir despues:

```
Nivel 1: Task A, Task C, Task E  [sin dependencias — independientes entre si]
Nivel 2: Task B, Task D           [dependen de tasks del Nivel 1]
Nivel 3: Task F                   [depende de tasks del Nivel 2]
```

Los niveles son una vista del plan, no una barrera de ejecucion: cada task arranca en cuanto SUS dependencias estan satisfechas, sin quedarse a la cola del resto de su nivel. Dos tasks solo corren a la vez si sus tablas "Archivos afectados" son disjuntas; si comparten un archivo, se serializan.

**Reglas de dependencia:**
- Dos tasks son independientes SI no comparten archivos Y no tienen dependencia de datos
- Si dos tasks tocan el mismo archivo, una depende de la otra (indicar cual va primero)
- Si una task crea algo que otra task consume (API, modelo, tipo), hay dependencia

---

## Paso 5: Presentar la lista completa

Presenta al usuario un resumen con este formato:

```
## Tasks derivadas de: [Titulo de la spec]

**Total:** [N] tasks
**Independientes:** [N] tasks sin dependencias mutuas
**Con dependencias:** [N] tasks con dependencias

### Orden de ejecucion

| Grupo | Tasks | Dependencia |
|-------|-------|-------------|
| 1 | Task A, Task C | Ninguna (independientes) |
| 2 | Task B, Task D | Grupo 1 |
| 3 | Task F | Grupo 2 |

### Resumen por task

| # | Titulo | Archivos | Tamano | Independiente |
|---|--------|----------|--------|---------------|
| 1 | [Titulo] | [N] | [min-max]L | SI/NO |
| 2 | [Titulo] | [N] | [min-max]L | SI/NO |

Aprobar la lista de tasks? Si se aprueba, cada task se guarda como
archivo individual en ai_docs/tasks/NNN_descriptor.md
```

**PUNTO DE ESPERA OBLIGATORIO:**
- DETENTE y espera aprobacion del usuario
- Si el usuario pide cambios, ajusta y vuelve a presentar
- Solo crea los archivos de task despues de la aprobacion

---

## Paso 6: Crear archivos de task

Despues de la aprobacion, crea cada task como archivo individual:

- **Ubicacion:** `ai_docs/tasks/NNN_descriptor.md`
- **Numeracion:** secuencial, 3 digitos (001, 002, 003...)
- **Descriptor:** snake_case, descriptivo, sin acentos
- **Ejemplo:** `ai_docs/tasks/001_crear_modelo_usuario.md`

Reserva cada numero con `scripts/next-task-number.sh` (imprime el siguiente numero
libre y lo marca como reservado). Leer el directorio y elegir el maximo + 1 no basta:
dos sesiones que planifican a la vez eligen el mismo numero y una pisa a la otra.

El siguiente paso es revisar cada task individualmente con `revisar_tarea.md`.

---

## Reglas inquebrantables

1. **NUNCA derives tasks de una spec no aprobada** — la spec debe tener estado APROBADA
2. **NUNCA crees una task que toque mas de 6 archivos** — si es mas grande, dividirla
3. **Cada task debe ser independiente** — si depende de otra, la dependencia debe estar documentada
4. **NUNCA repitas el contexto completo de la spec** en cada task — referencia la spec madre
5. **Si dos tasks tocan el mismo archivo**, una depende de la otra — documentar el orden
6. **Cada task genera al menos un commit** — si es tan pequena que no justifica commit, fusionarla con otra
7. **Minimo 3 edge cases** por task que involucre logica de negocio

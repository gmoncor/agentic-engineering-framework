# Plantilla de Derivacion de Tasks desde Spec

> **Cuando usar:** Despues de que una spec ha sido APROBADA. Para derivar tasks granulares y ordenarlas por dependencias.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con la spec aprobada.

---

## Instrucciones para el Asistente de IA

> **Modo de uso — declaralo antes de empezar:**
> - **Via workflow** (`/planificar`): NO hagas preguntas ni esperes aprobacion inline. Trabaja con la informacion disponible; el workflow concentra la clarificacion y la aprobacion en sus propios puntos. El PUNTO DE ESPERA de abajo NO aplica.
> - **Uso manual** (copy-paste al asistente): si falta un dato critico, pregunta antes de continuar; respeta el PUNTO DE ESPERA hasta la aprobacion explicita del usuario.

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **MUESTRA antes de ejecutar** — Presenta la lista completa de tasks al usuario y espera aprobacion ANTES de crear los archivos.
2. **EXPLICA el porque** — Para cada task, explica por que tiene ese alcance y de que otras tasks depende.
3. **SUGIERE mejoras** — Si detectas que una task es demasiado grande o que dos tasks deberian fusionarse, PROPONLO.
4. **VERIFICA despues** — Tras crear las tasks, confirma que cubren toda la spec sin huecos ni overlaps.
5. **ESCALA cuando corresponda** — Si la spec genera mas de 10 tasks, sugiere dividir la spec en specs mas pequenas.
6. **NUNCA asumas que la primera solucion es la mejor** — Si hay multiples formas de dividir el trabajo, presenta las opciones.

**Instrucciones adicionales para esta plantilla:**
- Cada task debe tener un alcance acotado. Si dos tasks dependen una de la otra, documenta la dependencia explicitamente.
- Si dos tasks tocan el mismo archivo, SIEMPRE indica la dependencia y el orden de ejecucion.
- NUNCA crees una task que requiera conocer el resultado de otra task para empezar, a menos que la dependencia este documentada.
- Las tasks definen COMO implementar. La spec define QUE. No repitas el QUE en cada task.

---

## Paso 1: Leer la spec aprobada

Antes de crear tasks, verifica:

1. **La spec tiene estado APROBADA** — si no, DETENTE y pide al usuario que la apruebe primero con `spec.md`
2. **Los criterios de aceptacion son medibles** — si alguno es vago, pide clarificacion
3. **El alcance esta definido** — las secciones "Incluye" y "No incluye" existen y son claras

---

## Paso 2: Agrupar cambios en tasks

Analiza la spec y agrupa los cambios en modulos o funcionalidades que se puedan implementar por separado.

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
| Un cambio no tiene sentido sin el otro | Crear tabla + crear migracion |
| Total menor a 50 lineas | No vale la pena separar |

---

## Paso 3: Crear las tasks

Para cada task, usa este formato:

```markdown
# Task: <titulo accionable>

**Spec madre:** <titulo de la spec>
**Estado:** PENDIENTE
**Dependencias:** <tasks que deben completarse antes, o "Ninguna">
**Tamano estimado:** <min>-<max> lineas en <N> archivos

## Objetivo

<1-2 frases: que se implementa y por que. Referencia a la spec, no repitas el contexto completo.>

## Archivos afectados

| Archivo | Accion | Descripcion del cambio |
|---------|--------|----------------------|
| `ruta/archivo.ext` | CREAR / MODIFICAR / ELIMINAR | <que se hace en este archivo> |

Esta tabla es la fuente de verdad de que archivos escribe la task. La usa el guard
que bloquea escrituras no declaradas: si la task intenta escribir un archivo que no
figura aqui, el guard la detiene. Manten la cabecera y el formato de las celdas.

## Wiring esperado

<Opcional. Solo si la task CREA archivos nuevos. Indica quien los importa, registra
o invoca para que no queden huerfanos. Omite esta seccion si la task no crea archivos.>

## Contratos

<Opcional. Solo si esta task produce algo que otra consume, o al reves.>

| Tipo | Nombre | Archivo |
|------|--------|---------|
| PRODUCE / CONSUME | <API, tipo, funcion exportada> | `ruta/archivo.ext` |

Si esta task CONSUME un contrato, declara como dependencia la task que lo PRODUCE.

## Plan de implementacion

1. <paso concreto 1>
2. <paso concreto 2>
3. <paso N>

## Criterios de exito

Minimo 3, todos verificables (test, comando o inspeccion concreta):

- [ ] <criterio medible 1 — derivado de la spec>
- [ ] <criterio medible 2>
- [ ] <criterio medible 3>

## Casos limite minimos

Minimo 3:

- <caso limite 1: que pasa si X>
- <caso limite 2: que pasa si Y>
- <caso limite 3: que pasa si Z>

## Criterios de calidad de ingenieria

<N/A si la task solo toca docs o config y no codigo ejecutable.>

- [ ] Cleanup exhaustivo de comentarios.
- [ ] Sin dead/legacy code.
- [ ] DRY/KISS/early returns aplicados.
- [ ] TDD reutilizando infra existente.
```

**Reglas para cada task:**
- El titulo debe ser accionable: "Crear endpoint de registro" no "Registro"
- Minimo 3 casos limite por task si involucra logica de negocio
- El tamano estimado debe ser realista. Si supera 400 lineas, divide la task
- Cada task genera al menos un commit

---

## Paso 4: Definir el orden de ejecucion

Con todas las tasks creadas, construye un mapa de dependencias y derivalo a un orden
lineal (orden topologico): cada task se coloca despues de aquellas de las que depende.

Ejemplo:

- Task A, Task C y Task E no dependen de nadie.
- Task B depende de Task A. Task D depende de Task C.
- Task F depende de Task B.

Un orden valido: `A -> C -> E -> B -> D -> F`. Las tasks se implementan una tras otra
en ese orden; nunca se empieza una task antes de que sus dependencias esten completas.

**Reglas de dependencia:**
- Si una task crea algo que otra consume (API, modelo, tipo), la consumidora depende de la productora
- Si dos tasks tocan el mismo archivo, una depende de la otra: decide cual va primero
- Una task sin dependencias puede colocarse en cualquier punto donde nada la preceda

---

## Paso 5: Presentar la lista completa

Presenta al usuario un resumen con este formato:

```
## Tasks derivadas de: <titulo de la spec>

**Total:** <N> tasks

### Orden de ejecucion

<Task A -> Task C -> Task E -> Task B -> Task D -> Task F  (orden topologico, una tras otra)>

### Resumen por task

| # | Titulo | Archivos | Tamano | Dependencias |
|---|--------|----------|--------|--------------|
| 1 | <titulo> | <N> | <min-max>L | Ninguna |
| 2 | <titulo> | <N> | <min-max>L | Task 1 |

Aprobar la lista de tasks? Si se aprueba, cada task se guarda como
archivo individual en ai_docs/tasks/NNN_descriptor.md
```

**PUNTO DE ESPERA (uso manual):**
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
3. **Cada task tiene un alcance acotado** — si depende de otra, la dependencia debe estar documentada
4. **NUNCA repitas el contexto completo de la spec** en cada task — referencia la spec madre
5. **Si dos tasks tocan el mismo archivo**, una depende de la otra — documentar el orden
6. **Cada task genera al menos un commit** — si es tan pequena que no justifica commit, fusionarla con otra
7. **Minimo 3 casos limite** por task que involucre logica de negocio

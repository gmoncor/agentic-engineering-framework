# Plantilla de Revision Adversarial Post-Implementacion

> **Cuando usar:** Despues de implementar una task, ANTES de commitearla — el gate primario es por task. Tambien sirve como revision de integracion opcional sobre varias tasks que interactuan, antes de mergear.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con la task (o la spec y las tasks) y el diff a revisar.
> **Veredicto:** emite uno de `APROBADA`, `NECESITA_CORRECCIONES` o `RECHAZADA`.

---

## Instrucciones para el Asistente de IA

> **Modo de uso — declaralo antes de empezar:**
> - **Via workflow** (`/implementar-spec`, `/revision`): NO hagas preguntas. Analiza el diff que se te entrega y emite el veredicto directamente. El PUNTO DE ESPERA de abajo NO aplica.
> - **Uso manual** (copy-paste al asistente): si falta contexto critico, pregunta antes de emitir el veredicto; respeta el PUNTO DE ESPERA hasta la respuesta del usuario.

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **MUESTRA antes de ejecutar** — Presenta todos los hallazgos al usuario ANTES de emitir el veredicto.
2. **EXPLICA el porque** — Para cada problema encontrado, explica POR QUE es un problema, QUE consecuencia tiene y COMO corregirlo.
3. **SUGIERE mejoras** — Si detectas oportunidades de mejora mas alla de los problemas, mencionalas por separado.
4. **VERIFICA despues** — Si el usuario aplica correcciones, vuelve a verificar los puntos afectados.
5. **ESCALA cuando corresponda** — Si los problemas son graves (perdida de datos, vulnerabilidad de seguridad), DETENTE inmediatamente y comunica la severidad.
6. **NUNCA asumas que la primera solucion es la mejor** — Si propones una correccion, presenta alternativas cuando no sea trivial.

**Instrucciones adicionales para esta plantilla:**
- Tu rol es ENCONTRAR PROBLEMAS, no confirmar que todo esta bien. Asume que hay bugs hasta demostrar lo contrario.
- Revisa TODA la implementacion, no solo la ultima task. Los problemas de integracion entre tasks son los mas peligrosos.
- NUNCA emitas veredicto APROBADA si tienes dudas. Es preferible NECESITA_CORRECCIONES que dejar pasar un problema.
- Esta plantilla NO modifica codigo. Solo detecta problemas y emite un veredicto.

---

## Paso 1: Cargar contexto completo

Antes de revisar, carga y verifica:

1. **Spec original** — leer completa, especialmente criterios de aceptacion y restricciones
2. **Todas las tasks** — leer cada documento de task, incluyendo criterios de exito y edge cases
3. **Codigo implementado** — revisar TODOS los archivos modificados o creados por todas las tasks

```
## Contexto cargado

**Spec:** [Titulo] — [N] criterios de aceptacion, [N] restricciones
**Tasks completadas:** [N] de [N] total
**Archivos afectados:** [N] archivos en [N] tasks

**Tasks pendientes:** [Lista, o "Ninguna — todas completadas"]
```

**Si hay tasks pendientes:** DETENTE. La revision adversarial se hace cuando TODAS las tasks estan completadas.

---

## Paso 2: Verificar integracion entre tasks

Este es el paso mas critico. Los problemas de integracion son los que se escapan en revisiones por task individual.

### 2.1 Interfaces entre tasks

Para cada par de tasks que interactuan (una produce algo que la otra consume):

| Task productora | Task consumidora | Interfaz | Compatible? |
|-----------------|-----------------|----------|-------------|
| Task NNN (crea API) | Task NNN (consume API) | Formato de respuesta, codigos de error | SI / NO — detallar |
| Task NNN (crea modelo) | Task NNN (usa modelo) | Campos, tipos, validaciones | SI / NO — detallar |

### 2.2 Conflictos de merge

Si las tasks se implementaron en paralelo, verificar:

- Archivos tocados por mas de una task: hay conflictos?
- Imports anadidos por tasks diferentes: hay duplicados o conflictos?
- Configuraciones modificadas por mas de una task: son coherentes?

### 2.3 Estado global

Verificar que las tasks no dejan el sistema en estado inconsistente:

- Migraciones de base de datos: se pueden ejecutar en orden sin error?
- Variables de entorno nuevas: estan documentadas y tienen valores por defecto?
- Dependencias nuevas: son compatibles entre si y con las existentes?

---

## Paso 3: Buscar problemas activamente

Revisar TODA la implementacion buscando cada categoria:

### 3.1 Regresiones

| Verificacion | Estado |
|-------------|--------|
| Tests existentes siguen pasando | SI / NO |
| Funcionalidad existente no afectada no se rompio | SI / NO |
| APIs publicas mantienen su contrato (no breaking changes sin documentar) | SI / NO |

### 3.2 Edge cases no cubiertos

Para cada task, revisar los edge cases documentados y buscar los no documentados:

| Edge case | Task | Cubierto por test? | Manejado en codigo? |
|-----------|------|-------------------|-------------------|
| [Caso 1] | NNN | SI / NO | SI / NO |
| [Caso 2] | NNN | SI / NO | SI / NO |

**Edge cases comunes a verificar siempre:**
- Inputs vacios, null, undefined
- Listas vacias
- Valores negativos o cero cuando se esperan positivos
- Strings extremadamente largos
- Concurrencia (dos usuarios haciendo lo mismo al mismo tiempo)
- Fallo a mitad de operacion (que queda en que estado?)
- Permisos (usuario sin autorizacion intenta la operacion)

### 3.3 Codigo muerto y restos de desarrollo

- Funciones creadas que nadie llama
- Imports sin usar
- Codigo comentado que no deberia estar en produccion
- Logs de debug (console.log, print, var_dump)
- TODO/FIXME sin ticket asociado

### 3.4 Seguridad

| Verificacion | Estado |
|-------------|--------|
| No hay secretos hardcoded (API keys, passwords, tokens) | OK / FALLA |
| Inputs de usuario validados antes de usar | OK / FALLA |
| Queries a base de datos parametrizadas (sin concatenacion de strings) | OK / FALLA / N/A |
| Rutas protegidas con autenticacion/autorizacion | OK / FALLA / N/A |
| Datos sensibles no expuestos en logs o respuestas API | OK / FALLA |

### 3.5 Consistencia

- Estilo de codigo consistente con el resto del proyecto
- Nombres siguen las convenciones del proyecto
- Estructura de archivos sigue el patron existente
- Manejo de errores consistente con el resto del proyecto

---

## Paso 4: Verificar criterios de aceptacion de la spec

Para CADA criterio de aceptacion de la spec, verificar que se cumple:

| # | Criterio | Cumplido? | Evidencia |
|---|----------|-----------|-----------|
| 1 | [Criterio de la spec] | SI / NO / PARCIAL | [Test que lo verifica / Como se comprobo] |
| 2 | [Criterio de la spec] | SI / NO / PARCIAL | [Test que lo verifica / Como se comprobo] |

**Si hay criterios NO cumplidos o PARCIALES:** listarlos como hallazgo BLOQUEANTE.

---

## Paso 5: Verificar restricciones de la spec

Para CADA restriccion de la spec, verificar que se respeta:

| Restriccion | Respetada? | Evidencia |
|-------------|-----------|-----------|
| [Restriccion 1] | SI / NO | [Como se verifico] |
| [Restriccion 2] | SI / NO | [Como se verifico] |

---

## Paso 6: Presentar veredicto

```
## Resultado de la revision adversarial

**Spec:** [Titulo]
**Tasks revisadas:** [N]
**Archivos revisados:** [N]

### Hallazgos BLOQUEANTES (corregir antes de mergear)

| # | Tipo | Descripcion | Archivo:linea | Correccion sugerida |
|---|------|-------------|---------------|-------------------|
| 1 | [Regresion/Seguridad/Criterio no cumplido/etc.] | [Descripcion] | [ubicacion] | [Como corregir] |

### Hallazgos WARNING (deberian corregirse)

| # | Tipo | Descripcion | Archivo:linea | Correccion sugerida |
|---|------|-------------|---------------|-------------------|
| 1 | [Edge case/Codigo muerto/Consistencia/etc.] | [Descripcion] | [ubicacion] | [Como corregir] |

### Criterios de aceptacion

- [N] de [N] cumplidos
- No cumplidos: [lista o "Todos cumplidos"]

### Restricciones

- [N] de [N] respetadas
- No respetadas: [lista o "Todas respetadas"]

### Integracion entre tasks

- [Resumen de problemas de integracion encontrados, o "Sin problemas de integracion"]

### Veredicto

[APROBADA / NECESITA_CORRECCIONES / RECHAZADA]

- `APROBADA`: sin hallazgos BLOQUEANTES. En el flujo por task, habilita el commit.
- `NECESITA_CORRECCIONES`: hay hallazgos corregibles con una pasada acotada (1-2 archivos, sin cambio de alcance).
- `RECHAZADA`: hallazgos graves o cambio de alcance; la task no debe commitearse tal cual.

**Si NECESITA_CORRECCIONES o RECHAZADA:**
- Para correcciones menores (1-2 archivos, sin cambio de alcance): aplicar directamente usando `implementar.md` y re-ejecutar la revision sobre los puntos afectados
- Para correcciones mayores (3+ archivos o cambio de alcance): crear nueva task via `tareas.md` referenciando los hallazgos, implementar, y re-ejecutar la revision completa
- No es necesario repetir la revision completa si solo se corrigen puntos especificos
```

**PUNTO DE ESPERA (revision manual/standalone):**
- Si revisas manualmente, DETENTE y espera la respuesta del usuario
- Si el veredicto es NECESITA_CORRECCIONES o RECHAZADA, no continues hasta aplicar los cambios
- Si se aplican correcciones, vuelve a verificar SOLO los puntos afectados
- Si el veredicto es APROBADA, procede al commit (o crea la PR con `revision_pr.md`)

---

## Reglas inquebrantables

1. **NUNCA emitas APROBADA si hay hallazgos BLOQUEANTES** — sin excepciones
2. **NUNCA modifiques codigo** — esta plantilla es solo de revision
3. **Revisa a fondo lo que se te da** — el diff de una task en la revision por task, o toda la integracion cuando revises varias tasks juntas: los problemas de integracion son los mas peligrosos
4. **Tu rol es encontrar problemas** — asumir que hay bugs hasta demostrar lo contrario
5. **Criterios de aceptacion no cumplidos son BLOQUEANTES** — no se pueden ignorar
6. **En una revision de integracion, si faltan tasks por completar**, DETENTE — es prematuro
7. **Vulnerabilidades de seguridad son siempre BLOQUEANTES** — sin importar la severidad percibida

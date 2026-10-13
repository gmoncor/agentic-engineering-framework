# Plantilla de Revisión Adversarial Post-Implementación

> **Cuándo usar:** después de implementar una task, ANTES de commitearla — el gate primario es por task (modo task). También sirve como revisión de integración sobre varias tasks que interactúan, antes de mergear, y como cierre de spec completa, verificando la convergencia entre el resultado real de todas las tasks y la spec original (modo integración).
> **Cómo usar:** copia este documento completo y pégalo en tu asistente de IA junto con la task (o la spec y las tasks) y el diff a revisar.
> **Veredicto:** emite uno de `APROBADA`, `NECESITA_CORRECCIONES` o `RECHAZADA`.

---

## Instrucciones para el Asistente de IA

> **Modo de uso — decláralo antes de empezar:**
> - **Vía workflow** (`/implementar-spec`, `/revision`): NO hagas preguntas. Analiza el diff que se te entrega y emite el veredicto directamente. El PUNTO DE ESPERA de abajo NO aplica.
> - **Uso manual** (copy-paste al asistente): si falta contexto crítico, pregunta antes de emitir el veredicto; respeta el PUNTO DE ESPERA hasta la respuesta del usuario.

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **VEREDICTO primero** — El informe abre con el veredicto y el peor hallazgo; después, el detalle de cada hallazgo.
2. **EXPLICA el porqué** — Para cada problema encontrado, explica POR QUÉ es un problema, QUÉ consecuencia tiene y CÓMO corregirlo.
3. **SUGIERE mejoras** — Si detectas oportunidades de mejora más allá de los problemas, menciónalas por separado: no cambian el veredicto.
4. **VERIFICA después** — Si se aplican correcciones, haz la re-revisión descrita abajo.
5. **ESCALA cuando corresponda** — Si los problemas son graves (pérdida de datos, vulnerabilidad de seguridad), DETENTE inmediatamente y comunica la severidad.
6. **NUNCA asumas que la primera solución es la mejor** — Si propones una corrección, presenta alternativas cuando no sea trivial.

**Instrucciones adicionales para esta plantilla:**
- Tu rol es ENCONTRAR PROBLEMAS, no confirmar que todo está bien. Asume que hay bugs hasta demostrar lo contrario.
- Esta plantilla NO modifica código ni escribe ficheros. Solo detecta problemas, los reporta y emite un veredicto.

### Criterio de bloqueo

BLOQUEANTE es un defecto material con evidencia: un criterio de aceptación de la task incumplido, un bug reproducible, un fallo de seguridad (sea cual sea su severidad percibida), una regresión, un contrato roto o una garantía declarada que el cambio no da. Solo un BLOQUEANTE cambia el veredicto.

- **WARNING:** defecto real que no llega a lo anterior. No cambia el veredicto.
- **Preferencia:** estilo o alternativa equivalente. Se menciona aparte y no cambia el veredicto.
- **Duda sin evidencia:** va como WARNING, con lo que la resolvería (la prueba que habría que ejecutar, el fichero que habría que leer o el dato que falta).
- **Refuta antes de bloquear:** antes de emitir un BLOQUEANTE, intenta refutarlo: busca el test, la guarda o el llamador que lo invalidaría y reproduce el fallo cuando se pueda. Si la refutación prospera, el hallazgo se retira; si deja duda, baja a WARNING.
- **La búsqueda no se relaja:** la intensidad con que buscas problemas no baja; lo que cambia es el umbral de bloqueo.
- **El informe de quien hizo el trabajo no es evidencia:** la revisión se pronuncia sobre el diff y sobre la salida real (tests ejecutados, comandos, ficheros leídos), no sobre lo que el implementador dice haber hecho.
- **WARNING aceptado sin corregir:** sale con dueño: una task que lo recoge o una decisión explícita del usuario.

### Modo de revisión

Declara el modo antes del Paso 1:

| Modo | Entrada | Pasos | Qué bloquea |
|------|---------|-------|-------------|
| **Task** | El diff, la task y sus criterios de aceptación | 1 (acotado a la task), 3, 4 sobre los criterios de la task y 5 sobre las restricciones que la task declare | Solo los criterios de esta task y los defectos del diff. Los criterios de otras tasks nunca son BLOQUEANTE aquí; si el diff rompe algo ya entregado, es una regresión |
| **Integración** | La spec completa, todas sus tasks y el código | Todos, incluidos el 2 y el 4bis | Los criterios y restricciones de la spec completa y los problemas entre tasks |

Los pasos que no aplican al modo se declaran omitidos con su motivo en el resultado; no se rellenan con contenido supuesto.

### Re-revisión

Si revisas tras una corrección:

- Pronúnciate sobre cada hallazgo previo: **resuelto** o **persistente**, con la evidencia que lo acredita.
- Revisa el delta de la corrección con el mismo criterio que la revisión inicial.
- Un hallazgo recibido de otra pasada (otra revisión, una búsqueda previa) se adjudica: se confirma, se rebaja o se refuta con motivo. Nunca se descarta en silencio.

---

## Paso 1: Cargar contexto

Antes de revisar, carga y verifica:

- **Modo task:** la task completa (criterios de éxito y edge cases) y el diff con todos los ficheros que modifica o crea.
- **Modo integración:**
  1. **Spec original** — leer completa, especialmente criterios de aceptación y restricciones.
  2. **Todas las tasks** — leer cada documento de task, incluyendo criterios de éxito y edge cases.
  3. **Código implementado** — revisar TODOS los ficheros modificados o creados por todas las tasks.

```
## Contexto cargado

**Modo:** [task / integración]
**Spec:** [Título] — [N] criterios de aceptación, [N] restricciones
**Task revisada:** [NNN] (modo task) / **Tasks completadas:** [N] de [N] total (modo integración)
**Archivos afectados:** [N]

**Tasks pendientes (solo modo integración):** [Lista, o "Ninguna — todas completadas"]
```

**Solo en modo integración — si hay tasks pendientes:** DETENTE. La revisión de integración se hace cuando TODAS las tasks están completadas. En modo task, las tasks pendientes no detienen la revisión.

---

## Paso 2: Verificar integración entre tasks

> Aplicable solo en modo integración. En modo task se declara omitido.

Los problemas de integración son los que se escapan en las revisiones por task individual.

### 2.1 Interfaces entre tasks

Para cada par de tasks que interactúan (una produce algo que la otra consume):

| Task productora | Task consumidora | Interfaz | ¿Compatible? |
|-----------------|-----------------|----------|-------------|
| Task NNN (crea API) | Task NNN (consume API) | Formato de respuesta, códigos de error | SÍ / NO — detallar |
| Task NNN (crea modelo) | Task NNN (usa modelo) | Campos, tipos, validaciones | SÍ / NO — detallar |

### 2.2 Conflictos de merge

Si varias tasks tocaron ficheros compartidos, verificar:

- Ficheros tocados por más de una task: ¿hay conflictos?
- Imports añadidos por tasks diferentes: ¿hay duplicados o conflictos?
- Configuraciones modificadas por más de una task: ¿son coherentes?

### 2.3 Estado global

Verificar que las tasks no dejan el sistema en estado inconsistente:

- Migraciones de base de datos: ¿se pueden ejecutar en orden sin error?
- Variables de entorno nuevas: ¿están documentadas y tienen valores por defecto?
- Dependencias nuevas: ¿son compatibles entre sí y con las existentes?

---

## Paso 3: Buscar problemas activamente

Revisa todo lo que entra en el modo buscando cada categoría. Agrupa los hallazgos por causa raíz: varios síntomas de un mismo defecto son un solo hallazgo, con todas sus ubicaciones.

### 3.1 Regresiones

| Verificación | Estado |
|-------------|--------|
| Tests existentes siguen pasando | SÍ / NO |
| Funcionalidad existente no afectada no se rompió | SÍ / NO |
| APIs públicas mantienen su contrato (no breaking changes sin documentar) | SÍ / NO |

### 3.2 Edge cases no cubiertos

Para cada task, revisar los edge cases documentados y buscar los no documentados:

| Edge case | Task | ¿Cubierto por test? | ¿Manejado en código? |
|-----------|------|-------------------|-------------------|
| [Caso 1] | NNN | SÍ / NO | SÍ / NO |
| [Caso 2] | NNN | SÍ / NO | SÍ / NO |

**Edge cases comunes a verificar siempre:**
- Inputs vacíos, null, undefined
- Listas vacías
- Valores negativos o cero cuando se esperan positivos
- Strings extremadamente largos
- Concurrencia (dos usuarios haciendo lo mismo al mismo tiempo)
- Fallo a mitad de operación (¿qué queda en qué estado?)
- Permisos (usuario sin autorización intenta la operación)
- **Completitud CRUD:** si la task crea un recurso, verificar que también existen las operaciones de lectura, edición y eliminación (o que están planificadas en otra task). No dejar entidades con solo CREATE.
- **Básicos transversales:** ruta inexistente retorna 404 (no 500 ni página en blanco). Healthcheck/status endpoint existe si hay deployment. Imágenes o assets con fallback si la fuente falla.
- **Higiene de contenedores/ORM (si aplica):** Dockerfile no corre como root (`USER` declarado). `.dockerignore` excluye `node_modules/`, `.git/`, `.env`. Errores de ORM (Prisma, Drizzle, SQLAlchemy) no se exponen crudos al usuario — se capturan y retornan mensaje genérico.

### 3.3 Código muerto y restos de desarrollo

- Funciones creadas que nadie llama
- Imports sin usar
- Código comentado que no debería estar en producción
- Logs de debug (console.log, print, var_dump)
- TODO/FIXME sin ticket asociado

### 3.4 Seguridad

| Verificación | Estado |
|-------------|--------|
| No hay secretos hardcoded (API keys, passwords, tokens) | OK / FALLA |
| Inputs de usuario validados antes de usar | OK / FALLA |
| Queries a base de datos parametrizadas (sin concatenación de strings) | OK / FALLA / N/A |
| Rutas protegidas con autenticación/autorización | OK / FALLA / N/A |
| Datos sensibles no expuestos en logs o respuestas API | OK / FALLA |

### 3.5 Consistencia

- Estilo de código consistente con el resto del proyecto
- Nombres siguen las convenciones del proyecto
- Estructura de ficheros sigue el patrón existente
- Manejo de errores consistente con el resto del proyecto

### 3.6 Llamadas nuevas o cambiadas

En cada llamada nueva o cambiada, lee la declaración de la función llamada: firma, valores de retorno, errores que lanza y efectos laterales. No supongas el contrato por el nombre.

### 3.7 Coste en ejecución

- Proceso, red o I/O dentro de un bucle
- Lectura repetida del mismo fichero o recurso
- Colección que crece sin límite (caché, cola, lista acumulada)

### 3.8 Mecanismos de verificación y superficie no evaluable

- Un mecanismo de verificación nuevo (test, hook, gate, job de CI) que no declara en qué punto del ciclo corre ni cuánto cuesta es WARNING.
- Un cambio de interfaz perceptual (diseño, maquetación, interacción visual) sin verificación en el viewport real se declara **no evaluado**; no se aprueba ni se bloquea por suposición.

---

## Paso 4: Verificar criterios de aceptación

En modo task, los criterios de la task; en modo integración, los de la spec. Para CADA criterio, verificar que se cumple:

| # | Criterio | ¿Cumplido? | Evidencia |
|---|----------|-----------|-----------|
| 1 | [Criterio] | SÍ / NO / PARCIAL | [Test que lo verifica / Cómo se comprobó] |
| 2 | [Criterio] | SÍ / NO / PARCIAL | [Test que lo verifica / Cómo se comprobó] |

**Si hay criterios NO cumplidos o PARCIALES:** listarlos como hallazgo BLOQUEANTE.

---

### Paso 4bis: Verificar convergencia de cierre de spec

> Aplicable solo en modo integración/spec completa. En modo task se declara omitido.

**Modos de invocación:**
- **Integrado** (comportamiento por defecto): parte de la revisión completa de esta plantilla, ejecutado después del Paso 4 dentro del mismo pase.
- **Standalone**: invocable en solitario, sin ejecutar los Pasos 1-3 ni el Paso 5, desde `/implementar-spec` al cerrar todas las tasks de una spec. Solo requiere la spec y el estado final de sus tasks (Paso 1, puntos 2 y 3, aplicados de forma acotada). Útil para re-verificar convergencia sin repetir toda la revisión de código.

Antes de emitir el veredicto final de la spec:

1. **Reconciliar resultado real por task.** Para cada task del roadmap, verificar su estado final (`COMPLETADA`, `FALLIDA`, `PARCIAL`, `BLOQUEADA_REVISION`). Una task `FALLIDA`, `PARCIAL` o `BLOQUEADA_REVISION` implica que sus criterios asignados carecen de cobertura, aunque el plan los asignara — el veredicto de la spec DEBE reflejarlo.
2. **Recuperar la tabla criterio-task.** Usar la tabla de asignación del Paso 2 de la spec (la que mapea cada criterio de éxito a la task responsable). Si la spec no tiene esa tabla (formato antiguo), reconstruirla a partir de los criterios de éxito y el roadmap de tasks. Confirmar que cada criterio tiene al menos una task `COMPLETADA` que lo cubre. Criterio sin task completada = criterio SIN COBERTURA.
3. **Barrido de "No incluye".** Verificar contra el código final que las exclusiones declaradas en la spec (sección "No incluye" / "Fuera de alcance") realmente NO se implementaron. Implementación no solicitada es tan grave como omisión. Si la spec no declara exclusiones, este sub-paso se salta.

**Schema de hallazgo.** Cada brecha detectada en los sub-pasos 1-3 se reporta con estos 4 campos:

| Campo | Descripción |
|-------|-------------|
| `criterio` | Sección de la spec o criterio de aceptación afectado |
| `hallazgo` | La brecha (no implementado, implementado a medias, contradice la spec o implementado sin pedirse) y la corrección sugerida |
| `evidencia` | Lo que la acredita, con referencia a archivo:línea cuando aplique |
| `severidad` | `BLOQUEANTE` \| `WARNING` |

**Resultado.** El revisor reporta; no escribe ficheros:

- **>=1 hallazgo BLOQUEANTE:** emitir veredicto `DIVERGE` con cada hallazgo completo según el schema.
- **Solo WARNINGs o cero hallazgos:** emitir veredicto `CONVERGIDA` con el conteo de criterios verificados.

**Tasks de convergencia.** Las crea quien tiene escritura a partir del informe: en `/revision`, la sesión principal; en el workflow, el paso que el propio workflow dedica a ello. Por cada hallazgo BLOQUEANTE se crea una task `NNN_convergencia_<descriptor-spec>.md` en `ai_docs/tasks/`, numerada con `scripts/next-task-number.sh` (ver su cabecera para el uso), con `Estado: PENDIENTE`, referencia a la spec madre, el hallazgo completo con su schema y criterios de éxito derivados de la brecha. Si `next-task-number.sh` no está disponible (sin permisos de ejecución o inexistente en el proyecto destino), se reporta el error explícitamente y se listan los hallazgos igualmente: el diagnóstico nunca se silencia ni se omiten hallazgos por falta de la herramienta de numeración. Con solo WARNINGs o sin hallazgos no se escribe ningún fichero.

La creación es **append-only por construcción**: solo crea ficheros nuevos (`NNN_convergencia_*.md`). Nunca reescribe la spec, tasks existentes ni código, ni en modo standalone ni en modo integrado.

---

## Paso 5: Verificar restricciones

En modo task, las restricciones que la task declare; en modo integración, las de la spec. Para CADA restricción, verificar que se respeta:

| Restricción | ¿Respetada? | Evidencia |
|-------------|-----------|-----------|
| [Restricción 1] | SÍ / NO | [Cómo se verificó] |
| [Restricción 2] | SÍ / NO | [Cómo se verificó] |

---

## Paso 6: Presentar veredicto

```
**Veredicto:** [APROBADA / NECESITA_CORRECCIONES / RECHAZADA] — [peor hallazgo en una frase, o "sin hallazgos BLOQUEANTES"]

## Resultado de la revisión adversarial

**Modo:** [task / integración]
**Spec:** [Título]
**Tasks revisadas:** [N]
**Archivos revisados:** [N]
**Pasos omitidos:** [paso — motivo, o "Ninguno"]

### Hallazgos previos (solo en re-revisión)

| # | Hallazgo | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | [Hallazgo de la pasada anterior] | Resuelto / Persistente / Refutado | [Cómo se comprobó] |

### Hallazgos BLOQUEANTES (corregir antes de mergear)

| # | Tipo | Descripción | Archivo:línea | Corrección sugerida |
|---|------|-------------|---------------|-------------------|
| 1 | [Regresión/Seguridad/Criterio no cumplido/etc.] | [Descripción] | [ubicación] | [Cómo corregir] |

### Hallazgos WARNING (no cambian el veredicto)

| # | Tipo | Descripción | Archivo:línea | Corrección sugerida o qué lo resolvería | Dueño si se acepta |
|---|------|-------------|---------------|----------------------------------------|--------------------|
| 1 | [Edge case/Código muerto/Duda/etc.] | [Descripción] | [ubicación] | [Cómo corregir] | [Task o decisión del usuario] |

### No evaluado

- [Superficie que no se pudo verificar y por qué, o "Nada"]

### Criterios de aceptación

- [N] de [N] cumplidos
- No cumplidos: [lista o "Todos cumplidos"]

### Restricciones

- [N] de [N] respetadas
- No respetadas: [lista o "Todas respetadas"]

### Integración entre tasks (solo modo integración)

- [Resumen de problemas de integración encontrados, o "Sin problemas de integración"]

### Significado del veredicto

- `APROBADA`: sin hallazgos BLOQUEANTES; los WARNING no la impiden. En el flujo por task, habilita el commit.
- `NECESITA_CORRECCIONES`: hay hallazgos BLOQUEANTES corregibles con una pasada acotada (1-2 archivos, sin cambio de alcance).
- `RECHAZADA`: hallazgos BLOQUEANTES graves o cambio de alcance; la task no debe commitearse tal cual.

**Si NECESITA_CORRECCIONES o RECHAZADA:**
- Para correcciones menores (1-2 archivos, sin cambio de alcance): aplicar directamente usando `implementar.md` y hacer la re-revisión sobre los hallazgos previos y el delta
- Para correcciones mayores (3+ archivos o cambio de alcance): crear nueva task vía `tareas.md` referenciando los hallazgos, implementar y re-ejecutar la revisión completa

> **Nota sobre el workflow mecanizado** (`/implementar-spec` u otro flujo automatizado equivalente): el número de rondas de corrección y el destino del trabajo que no alcanza `APROBADA` los fija el workflow. La distinción menor/mayor de arriba aplica al flujo MANUAL (humano o asistente operando fuera del workflow).
```

**PUNTO DE ESPERA (revisión manual/standalone):**
- Si revisas manualmente, DETENTE y espera la respuesta del usuario
- Si el veredicto es NECESITA_CORRECCIONES o RECHAZADA, no continúes hasta aplicar los cambios
- Si se aplican correcciones, haz la re-revisión: hallazgos previos y delta
- Si el veredicto es APROBADA, procede al commit (o crea la PR con `revision_pr.md`)

---

## Reglas inquebrantables

1. **NUNCA emitas APROBADA con un hallazgo BLOQUEANTE abierto** — sin excepciones
2. **NUNCA modifiques código ni escribas ficheros** — esta plantilla solo revisa y reporta
3. **Revisa a fondo lo que el modo te da** — el diff de una task en modo task, o toda la integración en modo integración
4. **Tu rol es encontrar problemas** — asumir que hay bugs hasta demostrar lo contrario
5. **Bloquea solo lo material** — aplica el criterio de bloqueo de las instrucciones; una duda sin evidencia es WARNING con lo que la resolvería
6. **En modo integración, si faltan tasks por completar**, DETENTE — es prematuro

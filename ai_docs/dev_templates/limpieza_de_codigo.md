# Plantilla de Limpieza y Revision de Codigo

> **Cuando usar:** Cuando quieras revisar, mejorar o limpiar codigo existente. En el flujo SDD, ejecutar despues de la implementacion de cada task y antes de la revision adversarial.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego indica que archivos o modulos quieres revisar.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta tu plan de cambios al usuario y espera confirmacion ANTES de modificar codigo.
3. **EXPLICA el porque** — No solo digas QUE cambiar, explica POR QUE es una mejora.
4. **SUGIERE mejoras** — Si detectas oportunidades de mejora (seguridad, rendimiento, legibilidad), PROPONLAS activamente.
5. **VERIFICA despues** — Tras cada cambio, sugiere como verificar que no se ha roto nada.
6. **ESCALA cuando corresponda** — Si un problema es demasiado complejo para resolverse con una limpieza, sugiere crear una task.
7. **NUNCA asumas que la primera solucion es la mejor** — Presenta al menos una alternativa cuando la solucion no sea trivial.

**Instrucciones adicionales para esta plantilla:**
- NUNCA hagas cambios masivos sin aprobacion. Presenta los cambios propuestos y espera confirmacion.
- NUNCA modifiques archivos de configuracion (tsconfig, eslint, package.json scripts, pyproject.toml, etc.) durante la limpieza a menos que el usuario lo pida explicitamente.
- Si la limpieza introduce un error o rompe un test, la limpieza es incorrecta — revertir inmediatamente.
- En el flujo SDD, la limpieza se ejecuta SOLO sobre los archivos tocados por la task recien implementada. No limpiar codigo que no se ha modificado.

---

## Principios de limpieza

Toda limpieza se guia por estos principios. Antes de proponer un cambio, verifica que cumple al menos uno:

| Principio | Significado | Pregunta clave |
|-----------|-------------|----------------|
| **DRY** (Don't Repeat Yourself) | Cada pieza de conocimiento tiene UNA sola representacion en el codigo | Existe esta misma logica en otro lugar? |
| **KISS** (Keep It Simple, Stupid) | La solucion mas simple que funciona es la mejor | Se puede hacer lo mismo con menos codigo o menos complejidad? |
| **Nombres claros** | El codigo se lee mucho mas de lo que se escribe. Los nombres deben explicar QUE es o QUE hace | Alguien que no escribio este codigo entenderia el nombre sin contexto adicional? |
| **Sin ruido** | Comentarios redundantes, codigo muerto y duplicaciones son ruido que dificulta entender el codigo real | Esto aporta informacion que el codigo no dice por si solo? |

---

## Paso 1: Diagnostico del proyecto

Antes de tocar nada, analiza el proyecto:

1. **Identificar la tecnologia:** Que lenguaje, framework y herramientas usa el proyecto?
2. **Ejecutar herramientas de analisis disponibles:**
   - Linting (eslint, ruff, phpstan, etc.)
   - Verificacion de tipos (tsc, mypy, etc.)
   - Tests existentes
3. **Documentar el estado actual:** Cuantos errores, warnings y tests fallidos hay ANTES de empezar?

**Importante:** Si no sabes que herramientas tiene el proyecto, PREGUNTA al usuario o busca en los archivos de configuracion (package.json, pyproject.toml, composer.json, etc.).

---

## Paso 2: Priorizar los problemas

Sigue este orden de prioridad — no saltes a lo "bonito" si hay errores criticos:

| Prioridad | Categoria | Ejemplos |
|-----------|-----------|----------|
| 1. CRITICO | Errores de build/compilacion | Imports rotos, errores de tipos que impiden compilar |
| 2. CRITICO | Seguridad | Secretos hardcoded, SQL injection, inputs sin validar en servidor |
| 3. ALTO | Codigo muerto confirmado | Funciones que nadie llama, imports sin usar, variables sin uso, codigo comentado |
| 4. ALTO | Redundancias y duplicaciones | Logica repetida en 2+ lugares, funciones que hacen casi lo mismo |
| 5. ALTO | Nombres y legibilidad | Variables genericas, funciones con nombres ambiguos, abreviaturas crípticas |
| 6. MEDIO | Comentarios innecesarios | Comentarios que repiten lo que el codigo dice, bloques comentados |
| 7. MEDIO | Seguridad de tipos | Uso de `any`/`Any`, casteos inseguros, tipos faltantes |
| 8. MEDIO | Rendimiento | Dependencias circulares, re-renders innecesarios, queries N+1 |
| 9. BAJO | Dependencias | Paquetes sin usar, versiones con vulnerabilidades conocidas |
| 10. BAJO | Organizacion | Archivos fuera de lugar, estructura inconsistente |

**Presenta la lista de problemas encontrados al usuario ANTES de proponer cambios.**

---

## Paso 3: Proponer cambios

Para cada problema encontrado, presenta:

```
### Problema: [Descripcion breve]
- **Donde:** [archivo:linea]
- **Que pasa:** [Descripcion del problema]
- **Propuesta:** [Que se cambiaria y por que]
- **Riesgo:** [Bajo/Medio/Alto — puede romper algo?]
```

**Agrupar los cambios por archivo** para que el usuario pueda aprobar o rechazar por bloques.

**ESPERAR aprobacion antes de aplicar cualquier cambio.**

---

## Paso 4: Aplicar cambios

Despues de la aprobacion:

1. **Aplicar cambios uno a uno o por grupo aprobado**
2. **Despues de cada grupo de cambios:**
   - Ejecutar linting
   - Ejecutar tests (si existen)
   - Verificar que no hay errores nuevos
3. **Si algo falla:** revertir el ultimo cambio y comunicar al usuario

---

## Paso 5: Verificacion final

Despues de todos los cambios:

1. **Ejecutar todas las herramientas de analisis** (linting, tipos, tests)
2. **Comparar con el estado inicial:**
   - Errores antes vs despues
   - Warnings antes vs despues
   - Tests antes vs despues
3. **Presentar resumen al usuario:**

```
## Resumen de limpieza

**Antes:** X errores, Y warnings, Z tests fallidos
**Despues:** X errores, Y warnings, Z tests fallidos

### Cambios realizados:
- [Archivo 1]: [que se hizo]
- [Archivo 2]: [que se hizo]

### Verificacion:
- Linting: OK / Errores pendientes
- Tests: Todos pasan / Fallos (detallar)

### Siguiente paso:
Hacer commit con `hacer_commit.md` y luego revision adversarial
con `revision_adversarial.md` cuando todas las tasks esten completadas.
```

---

## Guia de nombres

Los nombres son la herramienta mas poderosa para hacer codigo legible. Un buen nombre elimina la necesidad de comentarios.

### Reglas

| Regla | Mal ejemplo | Buen ejemplo |
|-------|-------------|--------------|
| Variables: sustantivos que describen QUE contienen | `d`, `temp`, `data`, `info`, `val` | `daysSinceLastLogin`, `userEmail`, `invoiceTotal` |
| Funciones: verbos que describen QUE hacen | `process()`, `handle()`, `doStuff()` | `calculateDiscount()`, `validateEmail()`, `sendNotification()` |
| Booleanos: pregunta que se responde con si/no | `flag`, `status`, `check` | `isActive`, `hasPermission`, `canEdit` |
| Listas/arrays: plural descriptivo | `list`, `arr`, `items` | `activeUsers`, `pendingOrders`, `validEmails` |
| Longitud proporcional al scope | Variable de 1 letra en un loop de 3 lineas: OK | Variable global de 1 letra: NUNCA |
| Sin abreviaturas crípticas | `usrMgr`, `btnClk`, `cfgSvc` | `userManager`, `buttonClick`, `configService` |

### Cuando renombrar

Renombrar cuando el nombre actual:
- Requiere leer el codigo alrededor para entenderlo
- Usa abreviaturas que no son universales en el equipo
- Es generico (`data`, `result`, `temp`, `info`, `handler`, `manager`) y hay un nombre mas especifico disponible
- No distingue entre variables del mismo tipo en el mismo scope

**NO renombrar** cuando el nombre actual ya es claro y el equipo lo usa consistentemente.

---

## Guia de comentarios

Los comentarios deben explicar POR QUE, nunca QUE. Si necesitas un comentario para explicar QUE hace el codigo, el codigo necesita mejor nombre o estructura — no un comentario.

### Eliminar siempre

| Tipo de comentario | Ejemplo | Por que sobra |
|--------------------|---------|---------------|
| Repite lo que el codigo dice | `// Incrementar contador` antes de `counter++` | El codigo ya lo dice |
| Describe la funcion con las mismas palabras | `// Valida el email` antes de `validateEmail()` | El nombre ya lo dice |
| Codigo comentado | `// const oldLogic = ...` | Usa git para el historial, no comentarios |
| Separadores decorativos | `// ========= SECCION ==========` | Usa funciones o archivos para separar |
| Obviedades | `// Constructor`, `// Imports`, `// Variables` | Evidente por el contexto |
| Diario de cambios en el codigo | `// Cambiado por Juan el 15/03 para fix #123` | Eso va en el commit, no en el codigo |

### Mantener siempre

| Tipo de comentario | Ejemplo | Por que es util |
|--------------------|---------|-----------------|
| Explica POR QUE una decision no obvia | `// Usamos setTimeout(0) para que el DOM se actualice antes del calculo` | No es evidente sin el comentario |
| Documenta limitaciones conocidas | `// La API de pagos no soporta montos negativos — se valida antes` | Previene bugs futuros |
| TODO con contexto | `// TODO(#456): migrar a la nueva API cuando publiquen v3` | Tiene ticket y accion concreta |
| Regex o logica compleja | `// Formato: DD/MM/YYYY con separadores opcionales` | La regex no se explica sola |

---

## Guia de redundancias y DRY

### Cuando extraer

| Senal | Accion |
|-------|--------|
| Mismo bloque de logica en 3+ lugares | Extraer a funcion/metodo compartido |
| Dos funciones que hacen casi lo mismo con variaciones minimas | Unificar con parametros que controlen la variacion |
| Mismo valor magico repetido (`"active"`, `30`, `"/api/v1"`) | Extraer a constante con nombre descriptivo |
| Mismo patron de validacion en multiples endpoints | Extraer a funcion de validacion reutilizable |

### Cuando NO extraer

| Senal | Razon |
|-------|-------|
| Solo 2 repeticiones y son simples (1-2 lineas) | El coste de la abstraccion supera al de la duplicacion |
| Las "duplicaciones" hacen cosas parecidas pero por razones distintas | Pueden evolucionar de forma independiente |
| Extraer crearia una funcion con 5+ parametros | La abstraccion es peor que la duplicacion |

---

## Code smells comunes

| Code smell | Solucion tipica |
|------------|----------------|
| Funcion de mas de 50 lineas | Dividir en funciones mas pequenas con nombres descriptivos |
| Archivo de mas de 300 lineas | Extraer modulos/componentes |
| Parametro que se pasa 3+ niveles | Usar contexto, inyeccion de dependencias o composicion |
| Multiples `if/else` anidados (3+ niveles) | Early returns o patron strategy |
| Codigo duplicado en 3+ lugares | Extraer a funcion compartida |
| Variables con nombres genericos (`data`, `temp`, `result`) | Renombrar con nombre descriptivo del contenido |
| Bloques `try/catch` que tragan errores | Manejar el error o propagarlo |
| Funcion que recibe un booleano para hacer 2 cosas distintas | Dividir en 2 funciones con nombres claros |
| Clase/modulo que hace demasiadas cosas (God Object) | Separar responsabilidades en clases/modulos mas pequenos |
| Parametros que siempre van juntos | Agrupar en un objeto/tipo con nombre descriptivo |
| Codigo defensivo innecesario (null checks en datos que nunca son null) | Confiar en los tipos y validar solo en los limites del sistema |
| Strings magicos repetidos | Extraer a constantes o enums |

---

## Que NO hacer durante la limpieza

| NO hacer | Por que |
|----------|---------|
| Eliminar exportaciones de librerias UI | Son variantes intencionales, no codigo muerto |
| Eliminar tipos/interfaces "grandes" | Son contratos de datos, no bloat |
| Cambiar configuracion de linting | No es parte de la limpieza |
| Reescribir funciones que funcionan correctamente | Limpiar no es reescribir — solo mejora lo que tiene un problema real |
| Ignorar warnings con `eslint-disable` o `# type: ignore` | Arregla la causa raiz |
| Renombrar por capricho | Solo renombrar si el nombre actual NO es claro |
| Eliminar exportaciones de APIs publicas | Otros modulos pueden depender de ellas |
| Hacer "mejoras" que nadie pidio | Solo arregla lo que tiene un problema real |

---

## Reglas inquebrantables

1. **NUNCA hagas cambios masivos sin aprobacion** del usuario
2. **NUNCA modifiques configuracion** (linting, types, build) durante la limpieza
3. **Si la limpieza rompe un test**, la limpieza es incorrecta — revertir inmediatamente
4. **Antes de eliminar codigo**, verifica que no se usa en ningun otro lugar (imports dinamicos, lazy loading, etc.)
5. **Cada cambio debe mejorar algo medible:** menos lineas, menos duplicacion, mejor nombre, menos warnings
6. **En el flujo SDD**, limpiar SOLO archivos tocados por la task recien implementada

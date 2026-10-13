# Plantilla de Implementacion

> **Cuando usar:** Cuando una task ha sido creada, revisada y auditada. Para implementar el cambio descrito en la task.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA junto con el documento de task asignado.

---

## Instrucciones para el Asistente de IA

> **Modo de uso — declaralo antes de empezar:**
> - **Via workflow** (`/implementar-spec`, `/implementar`): NO hagas preguntas ni presentes el plan para aprobacion inline. Implementa la task tal como esta declarada; el workflow revisa el diff y commitea. Los pasos de "presentar al usuario" de abajo NO detienen el trabajo.
> - **Uso manual** (copy-paste al asistente): si falta un dato critico o necesitas tocar un archivo fuera de "Archivos afectados", detente y consulta antes de continuar.

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **MUESTRA antes de ejecutar** — Presenta el plan de implementacion al usuario ANTES de modificar codigo.
2. **EXPLICA el porque** — Para cada decision de implementacion, explica POR QUE elegiste esa solucion.
3. **SUGIERE mejoras** — Si detectas una forma mejor de implementar algo, PROPONLA antes de hacerlo.
4. **VERIFICA despues** — Tras cada cambio significativo, ejecuta linting y tests para verificar que nada se rompio.
5. **ESCALA cuando corresponda** — Si durante la implementacion descubres que el alcance es mayor de lo esperado, DETENTE y comunica al usuario.
6. **NUNCA asumas que la primera solucion es la mejor** — Si hay alternativas, mencionalas antes de implementar.

**Instrucciones adicionales para esta plantilla:**
- SOLO implementa lo que dice el documento de task. Nada mas, nada menos.
- Si descubres un problema fuera del alcance de la task (bug, deuda técnica, mejora), no lo corrijas ahora: **repórtalo** (ver 3.3). Reportar no es dejar una nota en el código ni en un documento sin dueño.
- Si necesitas modificar un archivo que no esta en la lista de "Archivos afectados" de la task, DETENTE y consulta al usuario.
- Los tests se escriben DURANTE la implementacion, no despues. Para funcionalidad nueva, el protocolo RED-GREEN es OBLIGATORIO (ver Paso 4).

---

## Paso 1: Leer y entender la task

Antes de escribir codigo, verifica:

1. **La task tiene spec madre aprobada** — si no, DETENTE
2. **La task ha sido revisada** — verificar que paso por `revisar_tarea.md`
3. **La spec + tasks han sido auditadas** — verificar que paso por `auditar_spec.md`
4. **Las dependencias estan resueltas** — si la task depende de otra, verificar que esa otra task esta completada

Lee el documento de task completo y confirma que entiendes:

| Verificacion | Estado |
|-------------|--------|
| Objetivo claro | SI / NO — si NO, preguntar |
| Archivos afectados listados | SI / NO — si NO, preguntar |
| Criterios de exito definidos | SI / NO — si NO, preguntar |
| Edge cases identificados | SI / NO — si NO, preguntar |

---

## Paso 2: Investigar el codigo existente

NUNCA asumas que el proyecto esta vacio. Antes de implementar:

1. **Buscar codigo relacionado** — funciones, modulos o patrones que ya hacen algo similar
2. **Entender las convenciones** — estilo de codigo, estructura de archivos, patrones usados en el proyecto
3. **Identificar puntos de integracion** — donde se conecta el codigo nuevo con el existente
4. **Verificar tests existentes** — hay tests para el modulo que vas a modificar?

```
## Estado del codigo existente

**Codigo relacionado encontrado:**
- [archivo:funcion — que hace y si se puede reutilizar]
- [archivo:funcion — que hace y si se puede reutilizar]

**Convenciones del proyecto:**
- Estilo: [camelCase/snake_case/etc.]
- Estructura: [por feature/por capa/etc.]
- Patrones: [repository, service, controller, etc.]

**Tests existentes:** [SI — N tests / NO — necesita setup]
```

**Presentar al usuario antes de continuar.**

---

## Paso 3: Implementar

Sigue el plan de implementacion de la task. Para cada archivo:

### 3.1 Antes de modificar

- Verificar que el archivo esta en la lista de "Archivos afectados"
- Si el archivo no esta en la lista, DETENTE y consulta al usuario

### 3.2 Durante la implementacion

- **Un cambio logico a la vez** — no mezcles multiples funcionalidades en el mismo bloque de trabajo
- **Reutilizar antes que duplicar** — si ya existe logica similar, extenderla
- **Seguir convenciones del proyecto** — no imponer un estilo diferente
- **Nombres descriptivos** — variables, funciones y archivos con nombres que expliquen su proposito
- **Edición rechazada** — si una edición falla o se rechaza, relee el fichero antes de reintentarla: reintentar sin releer da por supuesto que el fichero no cambió
- **Procesos propios** — todo proceso que lances (servidor, watcher, proceso en segundo plano) se detiene antes de terminar y compruebas que terminó. Para esperar a algo, espera a su señal o a que el comando termine; nunca con `sleep` ni con bucles de sondeo
- **Tests, hooks o jobs de CI nuevos o cambiados** — declara en qué punto del ciclo corren (commit, push, CI), quién espera su resultado y su coste medido (tiempo, procesos lanzados), no supuesto
- **Cambio de interfaz perceptual** (diseño, maquetación, interacción) — verifícalo en el viewport real de la aplicación en ejecución; si no puedes, decláralo «no evaluado» en el informe, no lo des por bueno

### 3.3 Si descubres algo fuera de alcance

No lo corrijas. **Repórtalo** a quien puede darle dueño:

- **Vía workflow:** en el campo de hallazgos fuera de alcance que pida tu resultado (p. ej. `hallazgos_fuera_alcance`).
- **Uso manual:** al usuario, en el informe de entrega (Paso 6).

No lo dejes como `TODO`, comentario ni nota en un documento: una nota sin dueño no la atiende nadie.

```
## Hallazgos fuera de alcance

- [Archivo:linea] — [Descripcion del problema encontrado]
- [Archivo:linea] — [Descripcion del problema encontrado]
```

---

## Paso 4: Escribir tests

Los tests se escriben DURANTE la implementacion, no al final. Para cada funcionalidad implementada:

### Minimo por funcionalidad

| Tipo | Que prueba | Obligatorio |
|------|------------|-------------|
| Caso normal | El uso tipico con datos correctos | SI |
| Caso limite | Valores en los bordes del rango valido | SI |
| Caso negativo | Datos invalidos que deben rechazarse | SI |

### Protocolo RED-GREEN (OBLIGATORIO para funcionalidad nueva y correccion de bugs)

Para toda funcionalidad nueva y toda correccion de bug, RED-GREEN es obligatorio. No opcional. Exento solo: docs, config y refactors puros (sin cambio de comportamiento observable).

1. **RED** — Escribir el test ANTES del codigo. Ejecutarlo y verificar que FALLA sin tu cambio. Un test que pasa sin el cambio no prueba nada: mata al mutante o no es un test de regresion. Si no lo ves fallar, no lo has probado.
2. **GREEN** — Implementar el codigo minimo que hace pasar el test. Ejecutar. Debe PASAR.
3. **Verificar** — Confirmar que nada se rompió. Si quien te lanzó declara que ejecuta la suite completa como gate antes de commitear, basta con los tests dirigidos al cambio (los del módulo tocado y sus consumidores); si no lo declara, ejecuta la suite completa.

**Kill-the-mutant:** el criterio de un test de regresion util es que falle al revertir el fix. Si el test sigue verde con el codigo viejo, esta midiendo otra cosa; reescribelo hasta que el RED sea real.

El workflow `/implementar-spec` re-ejecuta la suite del proyecto como gate mecanico antes de commitear cada task: lee el exit code del comando de test real, no un recuento auto-declarado. Una suite en rojo bloquea el commit.

### Si no hay framework de testing

Sugiere configurarlo con `core_templates/04_setup_testing.md`. Si el usuario decide no configurarlo, documentar como se verifico manualmente.

### Checklist de datos (solo si la task toca schema, migraciones o consultas sobre datos persistidos)

Si la task NO toca schema, migraciones ni consultas, este checklist no aplica.

| Verificacion | Estado |
|-------------|--------|
| La migracion preserva las filas existentes (sin DROP TABLE sin respaldo) | SI / NO / N/A |
| Si hay cambio de tipo o rename de columna, existe un paso de backfill | SI / NO / N/A |
| La migracion se probo contra datos no vacios (no solo contra una base de datos limpia) | SI / NO / N/A |
| La migracion es reversible o tiene documentado por que no lo es | SI / NO / N/A |
| Se conoce el volumen de la tabla afectada y la operación es viable con ese volumen (bloqueos, duración, lotes) | SI / NO / N/A |
| Todo filtro o join nuevo tiene un índice que lo cubre | SI / NO / N/A |
| Se revisó el plan de ejecución de las consultas nuevas o cambiadas | SI / NO / N/A |
| Un cambio incompatible sigue la secuencia add → backfill → drop, no un cambio destructivo en un solo paso | SI / NO / N/A |

---

## Paso 5: Ejecutar validaciones

Antes de dar la implementacion por terminada:

1. **Linting** — ejecutar el linter del proyecto. Cero errores nuevos
2. **Verificacion de tipos** — si el proyecto usa tipos (TypeScript, mypy), ejecutar. Cero errores nuevos
3. **Tests nuevos** — todos pasan
4. **Tests existentes** — todos siguen pasando (suite completa, salvo que quien te lanzó declare que la ejecuta como gate antes de commitear: entonces, tests dirigidos al cambio; ver Paso 4)
5. **Build** — si aplica, verificar que el proyecto compila
6. **Marcadores sin dueño** — `grep -rniE "todo|fixme|pendiente"` sobre los ficheros tocados: cada coincidencia que hayas introducido se resuelve o se reporta como hallazgo fuera de alcance

```
## Resultado de validaciones

| Validacion | Resultado | Detalles |
|-----------|-----------|----------|
| Linting | PASA / FALLA | [detalles si falla] |
| Tipos | PASA / FALLA / N/A | [detalles si falla] |
| Tests nuevos | [N] pasan | — |
| Tests existentes | [N] pasan, [N] fallan | [detalles si fallan] |
| Build | PASA / FALLA / N/A | [detalles si falla] |
```

**Si algo falla:** corregir ANTES de continuar. Si la correccion esta fuera del alcance de la task, comunicar al usuario.

---

## Paso 6: Documentar lo implementado

Presenta un resumen al usuario:

```
## Implementacion completada

**Task:** [Titulo de la task]
**Spec madre:** [Titulo de la spec]

### Cambios realizados

| Archivo | Accion | Descripcion |
|---------|--------|-------------|
| `ruta/archivo.ext` | CREADO / MODIFICADO | [Que se hizo] |

### Tests creados

| Test | Que verifica | Estado |
|------|-------------|--------|
| [nombre del test] | [escenario] | PASA |

### Criterios de exito

- [ ] [Criterio 1 de la task — cumplido SI/NO]
- [ ] [Criterio 2 de la task — cumplido SI/NO]

### Desviaciones

- Ficheros tocados fuera de "Archivos afectados": [lista o "Ninguno"]
- Contratos cambiados (interfaces, formatos, comportamiento que consumen otros): [lista o "Ninguno"]
- Criterios de éxito no cumplidos o no evaluados: [lista con motivo o "Ninguno"]

### Hallazgos fuera de alcance

- [Lista de problemas encontrados que no se corrigieron, o "Ninguno"]

### Siguiente paso

El cambio esta listo para:
- Limpieza de codigo (limpieza_de_codigo.md)
- Commit (hacer_commit.md)
- Revision adversarial cuando todas las tasks esten completadas (revision_adversarial.md)
```

---

## Reglas inquebrantables

1. **SOLO implementa lo que dice la task** — nada fuera de alcance
2. **NUNCA modifiques archivos no listados** en la task sin consultar al usuario
3. **Los tests se escriben DURANTE la implementacion**, no despues
4. **Si algo falla en las validaciones**, corregir antes de continuar
5. **Hallazgos fuera de alcance se reportan**, no se corrigen
6. **NUNCA hagas "mejoras de paso"** que no estan en la task — repórtalas como hallazgo fuera de alcance
7. **Si el alcance real supera la estimacion**, DETENTE y comunica al usuario

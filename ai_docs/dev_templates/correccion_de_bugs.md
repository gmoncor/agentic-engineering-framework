# Plantilla de Correccion de Bugs

> **Cuando usar:** Cuando algo no funciona, da un error o tiene un comportamiento inesperado.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego describe el error que estas viendo.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta tu diagnostico y solucion propuesta al usuario ANTES de modificar codigo.
3. **EXPLICA el porque** — No solo corrijas el error, explica QUE lo causaba y POR QUE la solucion funciona.
4. **SUGIERE mejoras** — Si detectas otros problemas relacionados, mencionalos.
5. **VERIFICA despues** — Tras la correccion, sugiere como verificar que el bug esta resuelto Y que no se ha roto nada mas.
6. **ESCALA cuando corresponda** — Si el bug requiere cambios en 3+ archivos, cambios de base de datos, o cambios de arquitectura, DETENTE y sugiere crear un documento de tarea en lugar de un fix rapido.
7. **NUNCA asumas que la primera solucion es la mejor** — Si hay mas de una forma de corregirlo, presenta las opciones.

**Instrucciones adicionales para esta plantilla:**
- NUNCA propongas una solucion sin haber identificado la causa raiz.
- Si el usuario no proporciona el mensaje de error exacto, PIDELO antes de continuar.
- Si la solucion es compleja (3+ archivos, cambios de base de datos, o cambios de arquitectura), DETENTE y sugiere crear un documento de tarea para planificarlo. Esto NO es opcional.

---

## Paso 1: Recopilar informacion (OBLIGATORIO)

**Necesito esta informacion para diagnosticar el bug. Si no la tienes, intenta conseguirla:**

- **Mensaje de error:** [El texto exacto del error — copialo tal cual]
- **Cuando ocurre:** [Al cargar la pagina, al hacer clic en algo, al enviar un formulario, etc.]
- **Donde lo ves:** [En el navegador, en la consola, en la terminal, en los logs, etc.]
- **Se puede reproducir?**
  - Siempre ocurre
  - A veces ocurre
  - Solo en condiciones especificas: [cuales?]
- **Que cambio recientemente?** [Nuevo deploy, nueva dependencia, cambio de configuracion, nada que yo sepa]

**Si no tienes el mensaje de error exacto:**
- En el navegador: abre las herramientas de desarrollo (F12) > pestana "Console"
- En la terminal: copia la salida completa del error
- En logs: busca en los archivos de log del proyecto

---

## Paso 2: Clasificacion rapida

Basandote en el mensaje de error, clasifica el bug:

| Tipo | Senales | Accion |
|------|---------|--------|
| **Correccion simple** | Typo, error de sintaxis, valor incorrecto | Corregir directamente, verificar, listo |
| **Import/archivo faltante** | 404, "module not found", "import error" | Verificar rutas y dependencias |
| **Error de tipos** | "TypeError", "cannot read property of undefined" | Verificar tipos y datos |
| **Configuracion/entorno** | "connection refused", "env variable missing" | Verificar variables de entorno y configs |
| **Problema complejo** | Ninguno de los anteriores, error intermitente, o afecta multiples partes | Continuar a Paso 3 |

**Si es una correccion simple:** aplicar, verificar, y saltar a Paso 5 (test de regresion).
**Si es complejo:** continuar con la investigacion profunda.

---

## Paso 3: Investigacion profunda (solo problemas complejos)

### 3.1 Analisis de flujo

Traza el camino del error desde la accion del usuario hasta donde falla:

```
[Accion del usuario] -> [Componente/Funcion A] -> [Funcion B] -> [Servicio C] -> [ERROR AQUI]

En cada punto:
- Que deberia pasar? (comportamiento esperado)
- Que pasa realmente? (comportamiento real)
```

### 3.2 Encontrar la causa raiz (tecnica de los 5 porques)

No te quedes en el sintoma. Pregunta POR QUE hasta llegar a la causa real:

```
1. El formulario de registro da error 500.
   -> Por que? Porque la funcion createUser lanza una excepcion.
2. Por que lanza excepcion?
   -> Porque el campo "email" llega como null.
3. Por que llega como null?
   -> Porque el formulario envia "correo" en vez de "email".
4. Por que envia "correo"?
   -> Porque se renombro el campo en el frontend pero no se actualizo el backend.
5. CAUSA RAIZ: Desincronizacion frontend/backend tras renombrar campo.
```

**Rellenar obligatoriamente:**
- **Comportamiento esperado:** [Que deberia ocurrir]
- **Comportamiento real:** [Que ocurre en realidad]
- **Punto de quiebre:** [Donde exactamente empieza a ir mal]
- **Causa raiz:** [Por que ocurre — la razon de fondo, NO el sintoma]

### 3.3 Opciones de solucion

**Presenta al menos 2 opciones cuando el problema no sea trivial:**

#### Opcion 1: [Fix directo]
- **Que:** [Descripcion]
- **Archivos afectados:** [Lista]
- **Pros/Contras:** [Ventajas y desventajas]
- **Riesgo:** [Bajo / Medio / Alto]

#### Opcion 2: [Fix mas robusto]
- **Que:** [Descripcion]
- **Archivos afectados:** [Lista]
- **Pros/Contras:** [Ventajas y desventajas]
- **Riesgo:** [Bajo / Medio / Alto]

**Recomendacion:** Opcion [X] porque [razon concreta].

**ESPERAR aprobacion del usuario antes de aplicar la solucion.**

---

## Paso 4: Aplicar la correccion

1. **Aplicar el cambio minimo necesario** — no "mejorar" codigo que no esta relacionado con el bug
2. **Verificar que el error ya no ocurre** — reproducir el escenario original
3. **Verificar que no se ha roto nada mas** — ejecutar tests si existen

---

## Paso 5: Test de regresion (OBLIGATORIO si hay framework de testing)

Para evitar que el mismo bug vuelva en el futuro, seguir el protocolo RED-GREEN:

1. **RED — Escribe un test que REPRODUZCA el bug** — ejecutalo — debe FALLAR
   - Esto confirma que el test realmente detecta el problema
   - Si el test PASA sin haber corregido nada, el test no sirve — reescribirlo
2. **GREEN — Aplica la correccion** — ejecuta el test otra vez — debe PASAR
3. **Anade casos extra** — que pasa con valores limite o datos similares al que causo el bug?

Si no hay infraestructura de testing en el proyecto, sugiere al usuario configurarla con `core_templates/INIT4_setup_testing.md`. Aun sin framework, documenta en el resumen como se verifico manualmente.

---

## Paso 6: Resumen

Presenta al usuario:

```
## Bug corregido

**Error:** [Descripcion breve]
**Causa raiz:** [Por que ocurria — la causa real, no el sintoma]
**Solucion:** [Que se hizo para corregirlo]
**Archivos modificados:** [Lista]
**Verificacion:** [Como se verifico que funciona]
**Test de regresion:** [Se creo / No se creo — por que]
```

---

## Errores comunes al corregir bugs

| Error | Consecuencia | Como evitarlo |
|-------|-------------|---------------|
| Corregir el sintoma sin investigar la causa | El bug vuelve en otra forma | Usar la tecnica de los 5 porques |
| Cambiar codigo no relacionado con el bug | Introduce nuevos problemas | Cambio minimo necesario, nada mas |
| No probar la correccion | El bug sigue ahi o se rompe otra cosa | Reproducir el escenario original despues del fix |
| No escribir test de regresion | El bug vuelve meses despues | Protocolo RED-GREEN despues de cada fix |
| Adivinar la solucion sin datos | Se pierde tiempo probando cosas al azar | Pedir el mensaje de error exacto primero |

---

## Reglas inquebrantables

1. **NUNCA corrijas sin diagnosticar** — entender la causa raiz es obligatorio
2. **NUNCA hagas cambios no relacionados** al bug durante la correccion
3. **Si el bug es complejo** (3+ archivos, cambios de BD, o cambios de arquitectura), DETENTE y sugiere crear un documento de tarea. No es opcional.
4. **Si no puedes reproducir el bug**, pide mas informacion al usuario en lugar de adivinar
5. **SIEMPRE sugiere test de regresion** — si hay framework de testing, es obligatorio crearlo

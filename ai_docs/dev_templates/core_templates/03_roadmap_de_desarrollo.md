# Plantilla de Roadmap de Desarrollo

> **Cuando usar:** Despues de tener la Vision del Proyecto y la Planificacion Tecnica. Este documento define EN QUE ORDEN se construye todo.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Adjunta o referencia los documentos de vision y planificacion tecnica.
> **Resultado:** Un documento `roadmap.md` con fases secuenciales de desarrollo, cada una representando una funcionalidad completa.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta el analisis completo y espera aprobacion ANTES de generar el roadmap detallado.
3. **EXPLICA el porque** — Para cada fase, explica POR QUE va en ese orden y QUE habilita para fases posteriores.
4. **SUGIERE mejoras** — Si detectas dependencias faltantes, fases demasiado grandes o riesgos de secuencia, PROPONLOS.
5. **VERIFICA despues** — Al final, verifica que el roadmap cubre TODAS las funcionalidades de la vision y la planificacion tecnica.
6. **ESCALA cuando corresponda** — Si una fase tiene demasiadas tareas, sugiere dividirla.
7. **NUNCA asumas que la primera version es la definitiva** — Este roadmap se refina en 3 rondas obligatorias.

**Instrucciones criticas para esta plantilla:**

- **PREREQUISITOS:** Este documento NECESITA la Vision del Proyecto y la Planificacion Tecnica. Si no existen, pide al usuario que los cree primero.
- **FEATURE-FIRST:** Cada fase representa una funcionalidad COMPLETA para el usuario, NO una capa tecnica. Mal: "Fase 2: Migracion de Base de Datos". Bien: "Fase 2: Gestion de Productos con Catalogo".
- **TRES RONDAS OBLIGATORIAS:** Generar roadmap, autocriticarlo, refinar. Repetir 3 veces. NUNCA presentar como "terminado" en la primera ronda.
- **SIN CODIGO:** Este es un plan de ejecucion, no implementacion. Las tareas dicen QUE hacer, no COMO codificarlo.

---

## Paso 1: Analizar documentos y estado actual

Leer TODOS los documentos disponibles:
- Vision del proyecto (funcionalidades MVP, tipos de usuario, restricciones, modelo de negocio)
- Planificacion tecnica (paginas, modelo de datos, arquitectura, extensiones)
- Codigo existente del proyecto (si hay)

**Documentar:**
- **Estado actual:** Que ya existe y funciona en el proyecto?
- **Estado objetivo:** Que quiere el usuario segun sus documentos?
- **Gap:** Que falta por construir?

**Validacion cruzada:**
- Los documentos son coherentes entre si? (mismo scope, mismos usuarios, mismo stack)
- Si hay inconsistencias, alertar al usuario ANTES de generar el roadmap

---

## Paso 2: Analisis de features

**OBLIGATORIO antes de generar cualquier roadmap.**

### 2.1 Identificar todas las features

Extraer TODAS las funcionalidades de los documentos y listarlas:
- Features de la vision del proyecto (funcionalidades MVP)
- Features de la planificacion tecnica (paginas y funcionalidad)
- Requisitos tecnicos de la arquitectura

### 2.2 Clasificar cada feature

Para cada feature, clasificar su patron de desarrollo:
- **CRUD** (crear/leer/actualizar/eliminar datos): esquema + vistas + API
- **Dashboard/Analitica** (metricas y reportes): datos + agregacion + visualizacion
- **Integracion externa** (servicio de terceros): config + adaptador + UI + webhooks
- **Admin/Gestion** (funcionalidad administrativa): permisos + CRUD + UI admin
- **Custom** (otro patron): definir los componentes necesarios

### 2.3 Analizar dependencias

Para CADA feature, preguntar: "Que debe existir para que esta feature funcione?"

- Auth debe funcionar antes de features protegidas
- Tablas de datos deben existir antes de features que los usan
- Integraciones externas deben estar configuradas antes de features que dependen de ellas
- Features de admin que configuran recursos van antes de features de usuario que los consumen

### 2.4 Proponer secuencia

Basandose en las dependencias, proponer un orden logico de construccion:

```
1. [Feature]: Va primero porque [es prerequisito de X, Y, Z]
2. [Feature]: Va segundo porque [depende de 1, habilita 3 y 4]
3. [Feature]: Va tercero porque [depende de 1 y 2]
...
```

**Presentar este analisis al usuario y ESPERAR aprobacion antes de generar el roadmap detallado.**

---

## Paso 3: Generar roadmap (Ronda 1)

**Formato de las fases:**

```markdown
## Fase 0: Configuracion del Proyecto
**Meta:** Entorno de desarrollo funcionando
- [ ] Instalar dependencias y arrancar el proyecto
- [ ] Analizar estructura existente y documentar hallazgos criticos

## Fase 1: [Primera feature core]
**Meta:** [Que puede hacer el usuario al completar esta fase]

**Datos:**
- [ ] [Crear/modificar tablas necesarias para esta feature]

**Interfaz:**
- [ ] [Construir paginas y componentes]

**Logica:**
- [ ] [Implementar acciones del servidor, API, etc.]

**Integracion (si aplica):**
- [ ] [Configurar servicio externo si esta feature lo necesita]

## Fase 2: [Segunda feature]
[Mismo formato]

## Fase N: Barrido Final
**Meta:** Cubrir requisitos que no encajaron en fases anteriores
- [ ] Contrastar documentos de planificacion con lo implementado
- [ ] Implementar features menores restantes
```

**Reglas de calidad de tareas:**
- Cada tarea especifica QUE hacer (archivos, servicios, componentes)
- Verbos de accion: "Crear", "Configurar", "Implementar", "Anadir", "Analizar"
- NUNCA verbos pasivos como tareas: "Testear", "Comprobar", "Asegurar", "Verificar"
- Si una fase tiene mas de 20 tareas, dividirla

---

## Paso 4: Autocritica (OBLIGATORIO tras cada ronda)

Despues de generar el roadmap, hacer autocritica:

### Verificar calidad

- [ ] Cada fase es una feature completa (no una capa tecnica)?
- [ ] Las dependencias estan en el orden correcto?
- [ ] El tamano de las fases es apropiado para el equipo?
- [ ] Todas las features de los documentos estan cubiertas?

### Identificar problemas

- **Problemas criticos:** [Errores de secuencia, features faltantes, dependencias rotas]
- **Mejoras necesarias:** [Fases demasiado grandes, tareas poco claras, patrones mal aplicados]
- **Gaps:** [Funcionalidades de los documentos que no aparecen en el roadmap]

### Presentar al usuario

```
RONDA [1/2/3] completada.

ROADMAP: [Resumen de las fases]

AUTOCRITICA:
- [Problema o mejora 1]
- [Problema o mejora 2]
- [Gap detectado]

Quieres:
A) Que refine basandome en los problemas detectados
B) Cambiar algo especifico
C) Pasar a la siguiente ronda de refinamiento
```

---

## Paso 5: Ronda 2 — Refinamiento

Incorporar la autocritica de Ronda 1 + feedback del usuario:
- Corregir problemas criticos
- Reordenar fases si hay dependencias rotas
- Dividir fases demasiado grandes
- Cubrir features faltantes

**Generar roadmap actualizado → Nueva autocritica → Presentar al usuario.**

---

## Paso 6: Ronda 3 — Version final

Incorporar toda la retroalimentacion:
- Pulir el roadmap
- Verificar cobertura completa una ultima vez
- Generar version definitiva

---

## Generar documento final

Solo despues de la Ronda 3, generar el roadmap definitivo usando el formato de fases descrito en Paso 3. Anadir al inicio un bloque de resumen:

```markdown
# Roadmap de Desarrollo

## Resumen del Proyecto
- **Objetivo Final:** [De la vision]
- **Stack:** [Framework + BD + plataforma]
- **Equipo:** [Tamano]
- **Modelo de desarrollo:** [Secuencial / Paralelo]

---

[Fases con el formato de Paso 3]
```

---

## Reglas inquebrantables

1. **NUNCA generar roadmap sin analizar features primero** (Paso 2)
2. **NUNCA presentar roadmap sin autocritica** (Paso 4)
3. **TRES RONDAS obligatorias** — no atajar a "version final" en la primera
4. **Fases = features completas**, NO capas tecnicas
5. **NUNCA proponer fases como** "Migracion de BD", "Setup de Frontend", "Configuracion de API" — esas son tareas DENTRO de una fase de feature
6. **Si faltan documentos prerequisito**, pedir crearlos antes de empezar
7. **Cada tarea dice QUE hacer**, no COMO codificarlo

# Plantilla de Roadmap de Desarrollo

> **Cuando usar:** Despues de tener la Vision del Proyecto y la Planificacion Tecnica. Este documento define EN QUE ORDEN se construye todo.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Adjunta o referencia los documentos de vision y planificacion tecnica.
> **Resultado:** Un documento `roadmap.md` con fases de alto nivel, cada una agrupando specs relacionadas que se descomponen en tareas atomicas.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta el analisis completo y espera aprobacion ANTES de generar el roadmap detallado.
3. **EXPLICA el porque** — Para cada fase, explica POR QUE va en ese orden y QUE habilita para fases posteriores.
4. **SUGIERE mejoras** — Si detectas dependencias faltantes, fases demasiado grandes o riesgos de secuencia, PROPONLOS.
5. **VERIFICA despues** — Al final, verifica que el roadmap cubre TODAS las funcionalidades de la vision y la planificacion tecnica.
6. **ESCALA cuando corresponda** — Si una fase tiene demasiadas specs, sugiere dividirla.
7. **NUNCA asumas que la primera version es la definitiva** — Ofrece al menos una ronda de refinamiento.

**Instrucciones criticas para esta plantilla:**

- **PREREQUISITOS:** Este documento NECESITA la Vision del Proyecto y la Planificacion Tecnica. Si no existen, pide al usuario que los cree primero.
- **FEATURE-FIRST:** Cada fase agrupa specs de funcionalidad COMPLETA para el usuario, NO capas tecnicas. Mal: "Fase 2: Migracion de Base de Datos". Bien: "Fase 2: Gestion de Productos con Catalogo".
- **SPECS COMO FUENTE DE VERDAD:** El roadmap organiza specs. Las tasks se derivan de specs, no del roadmap directamente. El roadmap define el QUE y el ORDEN; las specs definen el ALCANCE; las tasks definen el COMO atomico.
- **SIN CODIGO:** Este es un plan de ejecucion, no implementacion. Las specs dicen QUE lograr, no COMO codificarlo.
- **ROADMAP LINEAL:** Cada fase se completa antes de pasar a la siguiente. Las tasks independientes dentro de una fase se ejecutan en cualquier orden.

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

## Paso 2: Identificar y agrupar specs

**OBLIGATORIO antes de generar cualquier roadmap.**

### 2.1 Extraer funcionalidades

Extraer TODAS las funcionalidades de los documentos:
- Features de la vision del proyecto (funcionalidades MVP)
- Features de la planificacion tecnica (paginas y funcionalidad)
- Requisitos tecnicos de la arquitectura

### 2.2 Agrupar en specs

Cada spec es una unidad de funcionalidad que se puede especificar, implementar y verificar de forma independiente. Agrupar funcionalidades relacionadas en specs:

**Para cada spec, documentar:**
- **Nombre:** descripcion concisa de la funcionalidad
- **Alcance:** que incluye y que NO incluye
- **Criterios de aceptacion:** como se verifica que esta completa
- **Dependencias:** que specs o infraestructura deben existir antes

**Patron de desarrollo de la spec:**
- **CRUD** (crear/leer/actualizar/eliminar datos): esquema + vistas + API
- **Dashboard/Analitica** (metricas y reportes): datos + agregacion + visualizacion
- **Integracion externa** (servicio de terceros): config + adaptador + UI + webhooks
- **Admin/Gestion** (funcionalidad administrativa): permisos + CRUD + UI admin
- **Custom** (otro patron): definir los componentes necesarios

### 2.3 Analizar dependencias entre specs

Para CADA spec, preguntar: "Que debe existir para que esta spec se pueda implementar?"

- Auth debe funcionar antes de specs que requieren acceso protegido
- Tablas de datos deben existir antes de specs que los usan
- Integraciones externas deben estar configuradas antes de specs que dependen de ellas
- Specs de admin que configuran recursos van antes de specs de usuario que los consumen

### 2.4 Proponer secuencia de fases

Basandose en las dependencias, agrupar specs en fases secuenciales:

```
Fase 1: [Nombre descriptivo]
  - Spec A: [descripcion] — Va aqui porque [es prerequisito de X, Y]
  - Spec B: [descripcion] — Independiente de A, se puede paralelizar

Fase 2: [Nombre descriptivo]
  - Spec C: [descripcion] — Depende de Spec A (Fase 1)
  - Spec D: [descripcion] — Depende de Spec B (Fase 1)
```

**Marcar specs independientes dentro de cada fase** — se pueden ejecutar en paralelo si el equipo lo permite.

**Presentar este analisis al usuario y ESPERAR aprobacion antes de generar el roadmap detallado.**

---

## Paso 3: Generar roadmap

**Formato de las fases:**

```markdown
# Roadmap de Desarrollo

## Resumen del Proyecto
- **Objetivo Final:** [De la vision]
- **Stack:** [Framework + BD + plataforma]
- **Equipo:** [Tamano]
- **Fases:** [Cantidad total]

---

## Fase 0: Configuracion del Proyecto
**Meta:** Entorno de desarrollo funcionando
- [ ] Instalar dependencias y arrancar el proyecto
- [ ] Analizar estructura existente y documentar hallazgos criticos

## Fase 1: [Nombre descriptivo — funcionalidad central]
**Meta:** [Que puede hacer el usuario al completar esta fase]
**Estimacion:** [Rango alto nivel: dias/semanas]

### Specs incluidas:
- **Spec 1.1:** [nombre] — [alcance breve]
- **Spec 1.2:** [nombre] — [alcance breve] *(parallelizable con 1.1)*

### Dependencias de fase:
- Requiere: Fase 0 completada
- Habilita: Fase 2, Fase 3

## Fase 2: [Segunda funcionalidad]
[Mismo formato]

## Fase N: Barrido Final
**Meta:** Cubrir requisitos que no encajaron en fases anteriores
- [ ] Contrastar documentos de planificacion con lo implementado
- [ ] Implementar funcionalidades menores restantes
```

**Reglas de calidad:**
- Cada fase agrupa 1-4 specs relacionadas
- Cada spec tiene alcance y criterios de aceptacion claros
- Las dependencias entre fases son explicitas
- Specs independientes dentro de una fase se marcan como independientes
- Si una fase tiene mas de 4 specs, dividirla
- Estimaciones de alto nivel (dias/semanas), no al detalle de horas

---

## Paso 4: Autocritica y refinamiento (OBLIGATORIO)

Despues de generar el roadmap, hacer autocritica:

### Verificar calidad

- [ ] Cada fase es una funcionalidad completa (no una capa tecnica)?
- [ ] Las dependencias estan en el orden correcto?
- [ ] Todas las funcionalidades de los documentos estan cubiertas por alguna spec?
- [ ] Las specs son lo suficientemente atomicas para derivar tasks independientes?
- [ ] Las estimaciones son realistas para el tamano del equipo?

### Identificar problemas

- **Problemas criticos:** [Errores de secuencia, specs faltantes, dependencias rotas]
- **Mejoras necesarias:** [Fases demasiado grandes, specs poco claras, paralelismo no aprovechado]
- **Gaps:** [Funcionalidades de los documentos que no aparecen en ninguna spec]

### Presentar al usuario

```
ROADMAP completado.

RESUMEN: [Cantidad de fases] fases, [cantidad de specs] specs

AUTOCRITICA:
- [Problema o mejora 1]
- [Problema o mejora 2]
- [Gap detectado]

Quieres:
A) Que refine basandome en los problemas detectados
B) Cambiar algo especifico
C) El roadmap esta completo
```

**ESPERAR respuesta. Si elige A o B, iterar. Si elige C, generar el documento final.**

---

## De roadmap a implementacion

El roadmap NO contiene tareas de implementacion directamente. El flujo es:

```
Roadmap (fases + specs)
  └─ Spec (alcance + criterios de aceptacion)
       └─ Tasks atomicas (derivadas de la spec, independientes entre si)
            └─ Implementacion + tests + revision
```

**Para cada spec del roadmap:**
1. Crear un documento de spec que detalle el alcance, criterios de aceptacion y restricciones
2. Derivar tasks atomicas de la spec (cada task = un cambio independiente)
3. Revisar cada task (alcance minimo, dependencias, edge cases)
4. Implementar tasks independientes en paralelo donde sea posible
5. Revision adversarial post-implementacion de la spec completa

---

## Reglas inquebrantables

1. **NUNCA generar roadmap sin analizar specs primero** (Paso 2)
2. **NUNCA presentar roadmap sin autocritica** (Paso 4)
3. **Fases = funcionalidades completas**, NO capas tecnicas
4. **NUNCA proponer fases como** "Migracion de BD", "Setup de Frontend", "Configuracion de API" — esas son tasks DENTRO de una spec
5. **Si faltan documentos prerequisito**, pedir crearlos antes de empezar
6. **Cada spec dice QUE lograr**, no COMO codificarlo
7. **Roadmap lineal con fases secuenciales** — cada fase se completa antes de pasar a la siguiente
8. **Tasks independientes se paralelizan** — no serializar lo que no tiene dependencias

# Planificacion Tecnica

> Este documento fue generado usando `02_planificacion_tecnica.md` aplicada sobre este mismo framework. Sirve como ejemplo de lo que produce la plantilla.

---

## Stack Tecnologico

- **Framework:** Ninguno — el proyecto es un repositorio de archivos Markdown
- **Base de datos:** No aplica
- **Auth:** No aplica
- **Deployment:** GitHub (repositorio publico)

---

## Estructura de Contenido

> Al no ser una aplicacion web, esta seccion documenta la estructura de archivos en lugar de paginas.

### Contenido publico (lo que se distribuye)
- **README.md:** Punto de entrada — explica que es, como usar, estructura, quick start
- **LICENSE:** CC-BY 4.0
- **ai_docs/dev_templates/:** 8 plantillas operativas + README
- **ai_docs/core_templates/:** 4 plantillas de planificacion inicial + README

### Contenido del usuario (lo que genera al usarlo)
- **ai_docs/core/:** Documentos de vision, planificacion y roadmap de su proyecto
- **ai_docs/tasks/:** Documentos de tarea numerados secuencialmente
- **ai_docs/refs/:** Documentacion externa de referencia

### Navegacion
- El README raiz es el punto de entrada unico
- Cada subcarpeta tiene su propio README con instrucciones detalladas
- Las plantillas de planificacion inicial se usan en orden secuencial (01 → 02 → 03 → 04)
- Las plantillas operativas se usan segun necesidad (flujo diario)

---

## Modelo de Datos

> No hay base de datos. El "modelo de datos" son los archivos y carpetas.

### Decisiones Clave

**Decision 1: Estructura plana vs jerarquica**
- **Situacion:** Las plantillas podrian organizarse en multiples niveles de carpetas o en una estructura plana
- **Opciones:** Carpetas por categoria (planificacion/, operativas/, git/) vs estructura actual (dev_templates/ + core_templates/)
- **Recomendacion:** Estructura actual (2 niveles) porque es mas facil de entender para un usuario nuevo y minimiza la navegacion

**Decision 2: Archivos de usuario en .gitignore**
- **Situacion:** Los documentos que genera el usuario (core/, tasks/, refs/) no deben subirse al repo del framework
- **Opciones:** .gitignore por carpeta vs .gitignore global con excepciones
- **Recomendacion:** .gitignore global con excepciones para .gitkeep — una sola ubicacion de configuracion

---

## Arquitectura del Sistema

### Fundacion
- Repositorio Git con archivos Markdown
- Sin dependencias, sin build, sin runtime
- Funciona copiando y pegando texto en cualquier LLM

### Extensiones Necesarias
- Ninguna para v1.0 — la simplicidad es una feature

### Diagrama

```
Usuario
  │
  ├─ Copia plantilla de dev_templates/
  │     │
  │     └─ Pega en su asistente de IA
  │           │
  │           └─ El asistente sigue las instrucciones
  │                 │
  │                 └─ Genera documento/codigo/revision
  │
  ├─ Guarda documentos generados en:
  │     ├─ core/    (vision, planificacion, roadmap)
  │     ├─ tasks/   (documentos de tarea)
  │     └─ refs/    (documentacion externa)
  │
  └─ Usa commit.md y revision_pr.md para gestionar git
```

### Seguridad
- **Datos sensibles:** El .gitignore protege las carpetas del usuario para evitar subir documentacion privada al repositorio
- **Secretos:** Las plantillas de commit y PR incluyen verificacion de archivos sensibles (.env, credenciales)

### Deployment
- **Donde:** GitHub (repositorio publico)
- **Entornos:** No aplica — es contenido estatico
- **Distribucion:** El usuario clona o descarga el repo y copia ai_docs/ a su proyecto

---

## Riesgos Tecnicos Identificados

- **Desactualizacion de plantillas:** Las plantillas referencian patrones y herramientas que pueden quedar obsoletas. Mitigacion: revision periodica del contenido.
- **Barrera idiomatica:** El framework esta solo en espanol. Mitigacion: traduccion a ingles en fase 2.

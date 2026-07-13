# Vision del Proyecto

> Este documento fue generado usando `01_vision_del_proyecto.md` aplicada sobre este mismo framework. Sirve como ejemplo de lo que produce la plantilla.

---

## Contexto
- **Tipo de proyecto:** Existente (repositorio publico de plantillas)
- **Tipo de aplicacion:** Herramienta interna / recurso educativo (sin monetizacion)
- **Estado actual:** Publicado, con 12 plantillas operativas y 4 de planificacion inicial

## Objetivo Final

Este framework ayuda a **desarrolladores que trabajan con asistentes de IA** a lograr **codigo mas fiable y decisiones mejor documentadas** usando **plantillas estructuradas que guian al asistente paso a paso**.

## Problema Central

- **Causa raiz:** Los asistentes de IA generan codigo sin contexto, sin plan y sin verificacion. El usuario acepta la primera respuesta sin cuestionarla porque no tiene una estructura que le obligue a iterar.
- **Consecuencia:** Codigo con bugs ocultos, decisiones no documentadas, deuda tecnica acumulada desde el primer commit. El tiempo "ahorrado" se pierde despues depurando.
- **Urgencia:** El uso de IA para programar crece exponencialmente. Sin un framework de trabajo, los malos habitos se consolidan rapido.

## Tipos de Usuario

### Desarrollador individual
- **Quien:** Programador que usa IA como asistente principal de desarrollo
- **Frustraciones:** El asistente inventa, no pregunta, genera codigo que no entiende, no documenta decisiones
- **Objetivos urgentes:** Producir codigo fiable mas rapido, entender cada decision, tener un registro de por que se hizo cada cosa

### Equipo de desarrollo
- **Quien:** Equipo que quiere estandarizar como se trabaja con IA
- **Frustraciones:** Cada miembro usa la IA de forma diferente, no hay consistencia, las PRs llegan sin planificacion
- **Objetivos urgentes:** Proceso comun para planificar, implementar, revisar y documentar con IA

### Estudiante / Aprendiz
- **Quien:** Persona aprendiendo a programar con ayuda de IA
- **Frustraciones:** No sabe si lo que genera la IA es correcto, no entiende las decisiones, no sabe que preguntar
- **Objetivos urgentes:** Aprender buenas practicas desde el principio, entender el codigo que genera la IA

## Modelo de Negocio

Sin modelo de negocio. Proyecto open source bajo licencia CC-BY 4.0.

## Funcionalidades MVP por Rol

### Desarrollador individual
- Puede planificar una tarea antes de implementarla (documento_de_tarea)
- Puede diagnosticar bugs con metodologia estructurada (correccion_de_bugs)
- Puede revisar y limpiar codigo con criterios claros (limpieza_de_codigo)
- Puede escribir tests con patron AAA y priorizacion (testing_basico)
- Puede hacer commits limpios sin archivos sensibles (hacer_commit)
- Puede crear PRs con revision automatizada (revision_pr)

### Equipo de desarrollo
- Puede usar las mismas plantillas que el desarrollador individual
- Puede definir la vision de un proyecto nuevo (01_vision_del_proyecto)
- Puede generar planificacion tecnica desde la vision (02_planificacion_tecnica)
- Puede crear roadmaps feature-first (03_roadmap_de_desarrollo)
- Puede configurar testing en una sesion (04_setup_testing)

### Fuera de Scope
- **Integracion nativa con IDEs:** Excluido porque las plantillas funcionan copiando y pegando — no necesitan plugins
- **Plantillas en ingles:** Excluido en esta version — el framework esta en espanol
- **Plantillas especificas de stack:** Excluido — las plantillas son agnosticas del lenguaje/framework

## Restricciones del Proyecto

- **Equipo:** Desarrollador solo (mantenedor principal)
- **Presupuesto para servicios:** $0 (repositorio publico en GitHub)
- **Timeline:** Sin deadline — desarrollo iterativo
- **Infraestructura obligatoria:** GitHub como plataforma de distribucion

## User Stories

### Desarrollador individual
1. Como desarrollador, quiero copiar una plantilla y pegarla en mi asistente de IA, para que me guie paso a paso en la tarea.
2. Como desarrollador, quiero que el asistente me presente alternativas antes de implementar, para que pueda tomar decisiones informadas.
3. Como desarrollador, quiero un documento de tarea que registre las decisiones, para que pueda consultarlo despues.

### Equipo de desarrollo
1. Como lider de equipo, quiero un conjunto estandar de plantillas, para que todos los miembros sigan el mismo proceso.
2. Como miembro del equipo, quiero plantillas de planificacion inicial, para que los proyectos nuevos arranquen con documentacion clara.

### Sistema/Background
1. Cuando un usuario copia una plantilla, el asistente de IA la interpreta como instrucciones obligatorias sin necesidad de configuracion adicional.

## Features de Valor Anadido (Fase 2+)

- **Plantillas en ingles:** Traduccion completa del framework
- **Plantillas especificas por stack:** Variantes optimizadas para TypeScript, Python, PHP, etc.
- **Guia de contribucion detallada:** Para que la comunidad pueda proponer y mejorar plantillas
- **Ejemplos de uso real:** Casos de uso documentados con capturas de sesiones reales

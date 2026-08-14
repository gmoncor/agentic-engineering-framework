---
name: inicio
description: "Se activa cuando el usuario quiere arrancar la documentacion inicial del proyecto (vision, planificacion tecnica, roadmap, setup de testing) sin copiar y pegar las plantillas a mano."
---

Guia el bootstrap inicial de la documentacion del proyecto en `ai_docs/core/`, sin que el usuario tenga que copiar y pegar las plantillas a mano.

## Instrucciones

1. Comprueba que `ai_docs/core_templates/` existe. Si no existe, informa de que la instalacion parece incompleta (falta el directorio de plantillas) y detente sin continuar.
2. Comprueba el contenido actual de `ai_docs/core/`. Si ya hay 2 o mas ficheros con contenido (no vacios), avisa de que el bootstrap parece completado y pregunta si el usuario quiere continuar (para revisar/actualizar lo existente) o saltarlo.
3. Lee `ai_docs/core_templates/README.md` y resume al usuario el panorama de las 4 plantillas antes de empezar.
4. Recorre las plantillas en orden, una sesion interactiva por plantilla — lee cada fichero completo y sigue su proceso tal cual esta escrito, sin resumirlo ni saltarte pasos:
   - `01_vision_del_proyecto.md` → escribe el resultado en `ai_docs/core/vision_del_proyecto.md`
   - `02_planificacion_tecnica.md` → escribe el resultado en `ai_docs/core/planificacion_tecnica.md`
   - `03_roadmap_de_desarrollo.md` → escribe el resultado en `ai_docs/core/roadmap.md`
   - `04_setup_testing.md` → configura el entorno de testing directamente (esta plantilla no genera un fichero en `ai_docs/core/`)
5. Si el usuario interrumpe la sesion a mitad de una plantilla, los ficheros ya escritos se quedan como estan. Puede relanzar la skill `inicio` mas tarde: el paso 2 detecta que ya existe y permite retomar desde donde se quedo.
6. Al terminar, presenta un resumen de los ficheros creados o actualizados en `ai_docs/core/` y sugiere la skill `planificar` como siguiente paso.

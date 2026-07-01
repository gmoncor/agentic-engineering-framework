---
name: revisar-tarea
description: "Se activa cuando se crea o modifica un documento de task en ai_docs/tasks/. Revisa alcance, dependencias, edge cases y coherencia con la spec."
---

# Revision de tarea pre-implementacion

Cuando se crea o modifica un documento de task en `ai_docs/tasks/NNN_*.md`, ejecuta esta revision automaticamente.

## Proceso

1. Lee el documento de task
2. Localiza la spec madre referenciada en la task
3. Ejecuta la revision siguiendo `ai_docs/dev_templates/revisar_tarea.md`:

### Checklist rapido

- **Alcance minimo (KISS):** cada cambio es necesario? Se toca mas de lo necesario?
- **Dependencias:** todo lo que la task necesita existe o esta documentado como dependencia?
- **Edge cases:** minimo 3 edge cases si hay logica de negocio? Son relevantes?
- **DRY:** se duplica logica existente en el proyecto?
- **TDD:** hay tests planificados para caso normal y caso de error?
- **Tamano:** no supera 400 lineas? Si supera, sugerir dividir
- **Coherencia con spec:** los criterios de exito se derivan de los criterios de aceptacion de la spec?

4. Emite veredicto: LISTO PARA IMPLEMENTAR / NECESITA AJUSTES / NECESITA REPLANTEAMIENTO
5. Si hay ajustes, lista cada uno con: QUE cambiar y POR QUE

## Reglas

- NO implementes nada — solo revision
- NO apruebes automaticamente — el trabajo es encontrar lo que falta
- Si la task no referencia una spec madre, marcarlo como hallazgo

---
name: implementar-spec
description: "Se activa cuando el usuario pide implementar una spec completa o ejecutar todas sus tasks. Implementa las tasks respetando dependencias y cierra con revision adversarial."
---

Implementa TODAS las tasks de una spec APROBADA.

## Antes de empezar

1. Localiza la spec en `ai_docs/tasks/spec_*.md` y verifica que tiene Estado: APROBADA.
2. Localiza las tasks que la referencian en `ai_docs/tasks/`.
3. Si no hay spec aprobada o no hay tasks: DETENTE y pide al usuario que planifique primero.
4. Construye el grafo: dependencias declaradas + archivos de cada tabla "Archivos afectados". Un
   ciclo de dependencias detiene la implementacion: hay que corregir el plan antes de escribir codigo.

## Ejecucion

- **Fan-out no bloqueante:** lanza cada task en cuanto SUS dependencias estan satisfechas, sin
  esperar a las demas. Dos tasks solo corren a la vez si sus archivos son **disjuntos**; si se
  solapan, se serializan. Un arbol de trabajo aparte solo hace falta para las tasks con efectos
  secundarios en el sistema de ficheros (migraciones, instalacion de dependencias, contenedores).
- Cada task la ejecuta un agente `implementador`, que sigue `ai_docs/dev_templates/implementar.md` y
  cierra con su commit.
- **Gate bloqueante unico:** cuando todas las tasks han terminado, el agente `revisor` hace la
  revision adversarial del codigo (`ai_docs/dev_templates/revision_adversarial.md`). Su veredicto es
  lo unico que se espera para poder entregar.

## Resultado

1. Orden de ejecucion: que tasks corrieron a la vez y cuales se serializaron (y por que archivo).
2. Detalle por task: archivos modificados, tests creados, commit realizado.
3. Revision adversarial: veredicto, problemas criticos y menores.
4. Hallazgos fuera de alcance, para tasks futuras.

Si el veredicto es **APROBADA**, el usuario puede crear la PR.
Si es **NECESITA_CORRECCIONES**, detalla las correcciones y pregunta si las aplica.
Si es **RECHAZADA**, detalla los problemas graves y recomienda revisar la planificacion.

---
name: planificar
description: "Se activa cuando el usuario quiere planificar trabajo nuevo, crear una spec, arrancar una funcionalidad o dice 'quiero anadir X'. Ciclo completo: analisis previo, spec, tasks, revision y auditoria."
---

Ejecuta el ciclo completo de planificacion SDD. No escribas codigo en este paso.

## 1. Analisis previo (antes de que exista spec)

Delega en el agente `asesor` el analisis de la solicitud. El asesor reformula la peticion, declara
lo que asume, avisa de las contradicciones con `ai_docs/core/` (donde manda la solicitud del
usuario), propone una alternativa mas robusta si la hay y decide si hay material suficiente para
planificar. No hagas tu propio analisis en paralelo: ese es el paso.

El analisis previo puede DETENER la planificacion, sin crear spec. En ese caso, presenta al usuario:

- **Faltan datos criticos** — traslada las preguntas y espera respuesta. Con ella, relanza la
  planificacion incorporandola a la solicitud.
- **La solicitud abarca varias funcionalidades independientes** — presenta la particion propuesta
  (titulo, alcance y dependencias de cada spec) y deja que el usuario decida. Se planifica una spec
  cada vez, respetando el orden de dependencias.

## 2. Spec

Delega en el agente `planificador`, que sigue `ai_docs/dev_templates/spec.md`. La spec nace en
Estado: BORRADOR. Solo el usuario la pasa a APROBADA.

## 3. Tasks

Delega en el agente `planificador`, que sigue `ai_docs/dev_templates/tareas.md`. Cada task declara
su tabla "Archivos afectados" y toca 6 archivos como maximo.

## 4. Revision de cada task + auditoria cruzada

Reparte la revision de las tasks entre subagentes `revisor` (fan-out): son independientes entre si
y ninguna necesita el resultado de otra. La **auditoria cruzada** (`ai_docs/dev_templates/auditar_spec.md`)
si necesita todas las revisiones: es el gate bloqueante del paso. Es obligatoria con 3 o mas tasks.

## 5. Presentacion del resultado

1. El analisis previo: reformulacion, asunciones y contradicciones detectadas.
2. La spec creada: resumen.
3. Las tasks derivadas: lista con dependencias y orden de ejecucion.
4. Revision de cada task: veredicto, problemas, ajustes propuestos.
5. Auditoria cruzada: cobertura, huecos, solapes, coherencia, veredicto final.

Si el veredicto es **APROBADO**, indica que el usuario puede aprobar la spec e implementarla
(la skill `implementar-spec` implementa todas las tasks; `implementar`, una sola).
Si es **NECESITA_AJUSTES**, detalla los ajustes y pregunta si los aplica.
Si es **NECESITA_REPLANTEAMIENTO**, recomienda rehacer la solicitud con mas detalle.

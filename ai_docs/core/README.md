# ai_docs/core/ — Contexto del Proyecto

> Documentos que el agente lee en cada sesion para saber que es el proyecto: que se construye, como esta estructurado tecnicamente y en que orden avanza el trabajo. No es una carpeta de plantillas ni de historial — es contexto vivo, minimo y estable.

## Que hay aqui

| Archivo | Funcion |
|---|---|
| `vision_del_proyecto.md` | Objetivo, problema central, tipos de usuario, MVP y restricciones. |
| `planificacion_tecnica.md` | Stack, estructura de contenido, modelo de datos y arquitectura. |
| `roadmap.md` | Fases de desarrollo en orden, con lo hecho y lo pendiente. |

En este repositorio los tres son ejemplos generados aplicando las plantillas de `ai_docs/core_templates/` sobre el propio framework (dogfooding). Un proyecto que instale el framework arranca con `ai_docs/core/` vacio y genera sus propios documentos con esas mismas plantillas.

## Criterio de inclusion

Pertenece aqui solo lo que el agente NECESITA leer en cada sesion para tener contexto de proyecto: que se construye (vision), como esta estructurado (planificacion tecnica), en que orden se ejecuta el trabajo (roadmap). Ningun otro contenido cumple hoy esa condicion — un documento por plantilla de `ai_docs/core_templates/`, ni uno mas.

## Criterio de exclusion

NO incluir en este directorio:
- **Plantillas.** Viven en `ai_docs/dev_templates/` (operativas) y `ai_docs/core_templates/` (planificacion inicial) — aqui van los documentos que producen, no las plantillas que los producen.
- **Logs de sesion, transcripts o historial de conversaciones.**
- **Auditorias, informes de revision o analisis puntuales.** Pertenecen a la tarea que los origino.
- **Estado transitorio:** progreso de una tarea en curso, notas o borradores que no sobreviven a la sesion que los genero.

Antes de anadir un cuarto documento, responder: ¿el agente lo necesita leer en CADA sesion para entender que es el proyecto, no para resolver una tarea concreta? Si la respuesta describe una tarea, una auditoria o un momento puntual, no pertenece aqui.

## Presupuesto de tamano

`ai_docs/core/` completo <= 500 lineas (`wc -l ai_docs/core/*.md`). Un fichero individual que se acerque a 200 lineas se revisa: particionar o comprimir antes de que arrastre al directorio fuera de presupuesto.

## Cargador de contexto

**Veredicto: no implementar un cargador automatico en el arranque de sesion.** Los flujos que necesitan el contenido de este directorio ya lo leen bajo demanda, en el punto exacto donde lo necesitan: los comandos de especificar, derivar tareas, auditar, implementar y revisar instruyen explicitamente "lee `ai_docs/core/`" en su propio texto. Cargarlo tambien de forma automatica al inicio de cada sesion duplicaria esa instruccion en las sesiones que no invocan ninguno de esos flujos (un commit, una correccion puntual, una revision de PR), sin beneficio adicional.

**Datos medidos** (`wc -lc ai_docs/core/*.md`, excluyendo este README porque es indice, no contexto de proyecto que el agente necesite leer en cada sesion):

- Los 3 documentos de contenido (`vision_del_proyecto.md`, `planificacion_tecnica.md`, `roadmap.md`): 295 lineas, 12555 bytes.
- Estimacion de tokens (~1 token / 4 bytes): ~3140 tokens, un 1.6% de un presupuesto tipico de 200K tokens.
- El coste absoluto es bajo, pero irrelevante para la decision: el problema no es cuanto cuesta cargarlo, es que ya se carga exactamente cuando hace falta.

**Por que no:**

1. **Redundancia con el wiring existente.** Los comandos que dependen de vision, planificacion o roadmap ya declaran la lectura de `ai_docs/core/` en su propio texto. Un cargador automatico en el arranque duplicaria esa instruccion para sesiones que jamas invocan esos comandos.
2. **No mezclar con un mecanismo de arranque separado.** Si el proyecto usa un mecanismo distinto al inicio de sesion para otro proposito (por ejemplo, registrar metadata de la sesion), anadirle logica de lectura de contexto le suma latencia y una responsabilidad ajena a la que tiene.
3. **Backends sin evento de arranque.** No todos los backends soportan un punto de enganche automatico al inicio de sesion; un mecanismo que dependa de ese evento deja a esos backends sin la funcionalidad, con la asimetria resultante — habria que documentar la limitacion backend por backend.
4. **Directorio recien instalado y vacio.** Un proyecto que acaba de instalar el framework arranca con `ai_docs/core/` vacio; un cargador automatico no tendria nada que cargar en ese momento, y su unico efecto seria coste sin beneficio hasta que el usuario ejecute el bootstrap.
5. **Coherencia con la frontera del directorio.** `ai_docs/core/` se mantiene deliberadamente ligero (ver "Presupuesto de tamano" arriba); anadir un mecanismo de carga automatica es maquinaria nueva que necesita justificarse con un problema real, no con una posibilidad hipotetica.

**Cuando reconsiderar:** si aparecen sesiones documentadas donde el agente opera sin contexto de proyecto y eso causa errores evitables — por ejemplo, decisiones que contradicen la vision o el roadmap porque el usuario invoco un flujo sin la instruccion de lectura — usar esos casos como evidencia. Sin esa evidencia, el veredicto se mantiene.

## Casos limite de la frontera

- **Directorio vacio:** reservado para contexto de proyecto, poblado por el usuario — no se elimina ni se sustituye.
- **Fichero referenciado por un test o workflow con contenido generico:** prima la funcion real; se conserva solo si aporta contexto real, no por la referencia nominal.
- **Esta frontera no tiene gate automatico.** La revision manual de cada propuesta contra el criterio de inclusion de arriba es el unico control.

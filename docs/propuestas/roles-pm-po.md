# Decisión sobre los flujos de project manager y product owner

## Contexto

El estudio compara formas de apoyar el trabajo de project manager y product
owner en el framework. La decisión vigente del usuario es: «Solo guías: documentar los flujos sin añadir roles ni capacidades instalables».

Esta decisión mantiene el trabajo en documentación. No crea un agente, una
skill, un hook, un manifiesto, un perfil ni una versión nueva. Tampoco concede
permisos para ejecutar comandos, escribir código o usar Git.

## Alternativas históricas

### A. Perfiles por proyecto

El proyecto declara los roles que participan y todas las personas instalan el
mismo conjunto de archivos.

- Límite: el perfil pertenece al proyecto, no distingue las tareas de cada
  persona.
- Permisos: el instalador tendría que elegir y copiar un perfil común.
- Artefactos: perfiles de proyecto, reglas de instalación y documentación de
  cada perfil.
- Coste: aumenta el paquete que recibe cada persona y obliga a mantener la
  matriz de perfiles y sus actualizaciones.

### B. Subconjuntos por persona

Cada persona instala el subconjunto de archivos correspondiente a su función.

- Límite: los subconjuntos pueden divergir y requieren coordinación entre
  personas con funciones distintas.
- Permisos: el instalador tendría que seleccionar un subconjunto por persona.
- Artefactos: perfiles individuales, manifiestos de selección y reglas de
  actualización para cada subconjunto.
- Coste: crece la combinación de instalaciones que hay que explicar,
  mantener y validar.

### C. Trabajo guiado con permisos mínimos

Las guías describen cómo una persona formula una historia o valida
documentación con ayuda de la inteligencia artificial. Lo sencillo queda en la
guía. Lo complejo se entrega a development mediante un handoff documentado.

- Límite: las guías no ejecutan cambios ni sustituyen la revisión de quien
  desarrolla.
- Permisos: solo lectura y redacción de documentación; no shell, Git ni
  escritura de código.
- Artefactos: guías, una historia con criterios de aceptación, evidencia de
  validación y un handoff cuando sea necesario.
- Coste: exige juicio humano para clasificar la complejidad y conservar la
  trazabilidad, pero no añade instalaciones ni variantes de paquete.

## Elección

Se elige solo la superficie documental de la alternativa C. La elección literal es: «Solo guías: documentar los flujos sin añadir roles ni capacidades instalables».

La entrega posterior puede publicar dos guías: una para project manager y otra
para product owner. Ambas describirán el trabajo, sus límites y el escalado a
development. No instalarán capacidades ni cambiarán permisos.

## Recorridos observables

### Historia sencilla

1. La guía ayuda a redactar un resultado esperado, sus límites y criterios de
   aceptación comprobables.
2. La persona revisa que cada criterio tenga evidencia posible.
3. La historia queda lista como documentación. No se ejecuta código ni se
   crean permisos nuevos.

### Cambio complejo

1. La guía identifica que el cambio afecta a código, contratos compartidos o
   una decisión que no puede resolverse con documentación.
2. La persona prepara un handoff versionado para development con el objetivo,
   los límites, la evidencia disponible y las preguntas abiertas.
3. Development decide e implementa el cambio en su flujo habitual. La guía no
   realiza una ejecución silenciosa.

### Validación documental

1. La guía compara el resultado entregado con la historia y sus criterios de
   aceptación.
2. Registra la evidencia que falta o la aceptación de los criterios cubiertos.
3. Si la evidencia no permite aceptar el resultado, solicita aclaración o
   devuelve el trabajo a development mediante un handoff documentado.

### Escalado mediante una incidencia o un fichero

1. Si el equipo usa GitHub, la persona abre una incidencia con el objetivo,
   los criterios de aceptación y la evidencia. Registra su enlace y responsable.
2. Sin GitHub, conserva esa información en un fichero versionado y entrega su
   ruta al responsable. No afirma que exista una incidencia remota.
3. El responsable confirma la recepción y continúa con el flujo de desarrollo.
   La guía no crea incidencias ni ejecuta comandos por sí misma.

## Frontera de esta decisión

Esta propuesta solo documenta la elección. La tarea s17/20 queda desbloqueada
solo para crear las dos guías después del release de developer. La tarea s17/21
queda descartada por decisión de producto: no habrá perfiles instalables de
project manager ni product owner.

Los documentos de planificación citados pertenecen al meta-repositorio de
mantenimiento. No son archivos distribuidos por este paquete.

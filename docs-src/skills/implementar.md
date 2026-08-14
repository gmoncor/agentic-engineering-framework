<!-- Parte propia de la skill de Codex y Antigravity. El cuerpo de las
     instrucciones sale del comando homonimo de Claude Code; aqui van el
     frontmatter y lo que solo tiene sentido en formato de skill.
     El aviso del gate de revision que lleva el comando no llega aqui: va
     marcado como exclusivo de Claude Code, el unico backend que cablea ese
     hook. -->
---
name: implementar
description: "Se activa cuando el usuario pide implementar UNA task concreta del plan, con control manual. Escribe codigo y tests solo de los archivos que la task declara."
---

Lee ademas la spec madre de la task.

## Alcance

Solo tocas los archivos de la tabla "Archivos afectados" de la task. Escribir fuera de esa lista lo
deniega el guardarrail del pipeline. Lo que descubras fuera de alcance se documenta como hallazgo,
no se corrige aqui. La task cierra con su commit.

Para implementar la spec entera, usa la skill `implementar-spec`.

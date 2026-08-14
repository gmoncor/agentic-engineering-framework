<!-- Parte propia de la skill de Codex y Antigravity. El cuerpo de las
     instrucciones sale del comando homonimo de Claude Code; aqui van el
     frontmatter y lo que solo tiene sentido en formato de skill.
     El aviso del gate de revision que lleva el comando no llega aqui: va
     marcado como exclusivo de Claude Code, el unico backend que cablea ese
     hook. -->
---
name: revision
description: "Se activa cuando el usuario pide revisar la implementacion ya terminada contra la spec, antes de entregar o mergear. Revision adversarial del codigo."
---

Lee ademas la spec, todas sus tasks completadas y el codigo real (no el resumen de quien
lo escribio).

Postura: encontrar problemas, no confirmar que todo esta bien. Valida con evidencia — lee el codigo
y ejecuta los tests. Si la evidencia es ambigua, reporta el hallazgo.

Emite un veredicto explicito: APROBADA / NECESITA_CORRECCIONES / RECHAZADA. Este veredicto es el
gate previo a la entrega.

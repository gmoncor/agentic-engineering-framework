<!-- Parte propia de la skill de Codex y Antigravity. El cuerpo de las
     instrucciones sale del comando homonimo de Claude Code; aqui van el
     frontmatter y lo que solo tiene sentido en formato de skill.
     El aviso del gate de revision que lleva el comando no llega aqui: va
     marcado como exclusivo de Claude Code, el unico backend que cablea ese
     hook. -->
---
name: revision
description: "Cuando se pide revisar contra la spec una implementación ya terminada, antes de entregar o fusionar: revisión adversarial del código. implementar-spec ya revisa cada task; esta es la revisión aislada."
---

Lee ademas la spec, todas sus tasks completadas y el codigo real (no el resumen de quien
lo escribio).

Postura: encontrar problemas, no confirmar que todo está bien. Valida con evidencia: lee el código
y ejecuta los tests. Aplica el criterio de bloqueo de `revision_adversarial.md`: solo lo material
con evidencia bloquea; una duda sin evidencia va como WARNING, con lo que la resolvería, y no bloquea.

Emite un veredicto explicito: APROBADA / NECESITA_CORRECCIONES / RECHAZADA. Este veredicto es el
gate previo a la entrega.

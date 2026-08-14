<!-- Parte propia de la skill de Codex y Antigravity. El cuerpo de las
     instrucciones sale del comando homonimo de Claude Code; aqui van el
     frontmatter y lo que solo tiene sentido en formato de skill. -->
---
name: spec
description: "Se activa cuando el usuario pide crear o reescribir UNA especificacion aislada, sin derivar tasks ni auditar. Redacta la spec a partir de la solicitud."
---

Si la solicitud contradice ese contexto, gana la solicitud: deja constancia de la contradiccion.

La spec nace en Estado: BORRADOR. Solo el usuario la pasa a APROBADA.

Este es el paso aislado. Si el usuario quiere el ciclo completo (spec + tasks + revision +
auditoria), usa la skill `planificar`.

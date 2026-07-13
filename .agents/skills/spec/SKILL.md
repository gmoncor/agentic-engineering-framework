---
name: spec
description: "Se activa cuando el usuario pide crear o reescribir UNA especificacion aislada, sin derivar tasks ni auditar. Redacta la spec a partir de la solicitud."
---

Crea una especificacion siguiendo el proceso completo de `ai_docs/dev_templates/spec.md`.

Contexto obligatorio: lee `ai_docs/core/` (vision, planificacion, roadmap) antes de escribir. Si la
solicitud contradice ese contexto, gana la solicitud: deja constancia de la contradiccion.

La spec nace en Estado: BORRADOR. Solo el usuario la pasa a APROBADA.

Este es el paso aislado. Si el usuario quiere el ciclo completo (spec + tasks + revision +
auditoria), usa la skill `planificar`.

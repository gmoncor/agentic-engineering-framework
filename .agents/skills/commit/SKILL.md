---
name: commit
description: "Se activa cuando el usuario quiere commitear, hacer commit o guardar cambios en git. Analiza cambios, excluye ai_docs/ y archivos sensibles, y crea commits limpios."
---

Ejecuta el flujo de commit siguiendo `ai_docs/dev_templates/hacer_commit.md`.

Sigue todos los pasos de la plantilla sin saltarte ninguno.
Presenta el mensaje de commit para aprobacion antes de ejecutar.

## Uso a peticion explicita

Si el usuario aporta un mensaje, usalo como borrador del asunto: sigue validandolo contra el
formato de la plantilla (`<tipo>: <descripcion>`, asunto de 72 caracteres como maximo, sin
coautoria de IA) y corrigelo si no encaja.

Nunca pases `--no-verify`: saltarse el ciclo de calidad esta prohibido y el guardarrail lo deniega.

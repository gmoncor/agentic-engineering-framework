---
name: pr
description: "Se activa solo cuando el usuario pide explicitamente 'crea PR', 'abre PR', 'revisa PR'. Creacion o revision de Pull Requests con verificacion de calidad."
---

Ejecuta el flujo de PR siguiendo `ai_docs/dev_templates/revision_pr.md`.

Sigue todos los pasos de la plantilla sin saltarte ninguno.
En el flujo SDD, la PR referencia la spec y las tasks que cierra.

## Uso a peticion explicita

Si el usuario indica un numero de PR, el flujo es de revision; si pide crearla, el flujo es de
creacion. En ambos casos manda la plantilla: no abras una PR cuyo codigo no haya pasado la revision
adversarial.

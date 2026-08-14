---
name: Bug report
about: Reportar un comportamiento incorrecto del framework
title: "fix: "
labels: bug
---

## Que ha pasado

<!-- Describe el comportamiento incorrecto. Se concreto. -->

## Que esperabas que pasara

<!-- El comportamiento correcto segun la documentacion. -->

## Reproduccion

<!-- Pasos exactos. Si depende de un estado previo (spec creada, task existente), indicalo. -->

1.
2.
3.

## Entorno

- **Version del framework:** <!-- `node bin/cli.js --version`, o el marcador "sdd-framework: X.Y.Z" al final de tu CLAUDE.md/GEMINI.md/AGENTS.md si instalaste sin el CLI -->
- **CLI:** <!-- Claude Code / Gemini CLI / Codex /
  Antigravity / Cursor / copy-paste -->
- **Version de la CLI:**
- **Node.js:** <!-- salida de: node --version (el framework requiere >= 20) -->
- **Sistema operativo:**

## Componente afectado

<!-- Marca lo que aplique. -->

- [ ] Comando (`/planificar`, `/implementar-spec`, ...)
- [ ] Agente (planificador, revisor, implementador, asesor)
- [ ] Skill
- [ ] Hook (`sdd-pipeline-guard.js`, `sdd-commit-guard.js`)
- [ ] Workflow
- [ ] Plantilla de `ai_docs/`
- [ ] Documentacion
- [ ] Instalacion

## Salida del error

<!-- Pega la salida literal, sin recortar. Elimina rutas o datos sensibles. -->

```
```

## Contexto adicional

<!-- Cualquier otra cosa relevante. Opcional. -->

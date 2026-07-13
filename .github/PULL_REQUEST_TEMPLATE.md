# Que cambia

<!-- Resumen en una o dos frases. -->

# Por que

<!-- El problema que resuelve. Enlaza el issue: Closes #NN -->

# Como probarlo

<!-- Pasos para verificar el cambio. Si es documentacion, indica que revisar. -->

# Checklist

- [ ] El cambio tiene un unico proposito (no mezcla feature, refactor y formato)
- [ ] Si toca un agente, comando o skill, el cambio equivalente esta aplicado en **las dos CLIs** (Claude Code y Gemini CLI)
- [ ] Documentacion actualizada (`README.md`, `CLAUDE.md`, `GEMINI.md`) si el comportamiento cambia
- [ ] Entrada anadida en `CHANGELOG.md` bajo `## [Unreleased]`
- [ ] Los hooks (`hooks/*.js`) se ejecutan sin error con Node >= 20
- [ ] Sin secretos, credenciales, rutas locales ni configuracion de mi IDE
- [ ] Finales de linea LF (los normaliza `.gitattributes`)
- [ ] Mensajes de commit en formato `<tipo>: <descripcion>`, asunto de 72 caracteres o menos

# Compatibilidad

- [ ] Este cambio **rompe** la compatibilidad con proyectos que ya usan el framework

<!-- Si lo marcas, explica que debe hacer un usuario existente para migrar. -->

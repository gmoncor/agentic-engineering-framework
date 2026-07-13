# Politica de seguridad

## Versiones soportadas

Se dan soporte a los parches de seguridad de la ultima version publicada (rama `main`). Las versiones anteriores no reciben correcciones.

## Reportar una vulnerabilidad

**No abras un issue publico para reportar una vulnerabilidad.**

Usa el reporte privado de GitHub: pestana **Security > Report a vulnerability** del repositorio. Si no puedes acceder, contacta al autor a traves de su perfil de GitHub ([@gmoncor](https://github.com/gmoncor)).

Incluye en el reporte:

- Descripcion del problema y su impacto
- Pasos de reproduccion
- Version del framework y CLI afectada

Recibiras acuse de recibo en un plazo razonable. Este es un proyecto mantenido a tiempo parcial: no hay compromiso de SLA, pero los reportes de seguridad tienen prioridad sobre el resto del trabajo. Se te dara credito en la correccion salvo que prefieras el anonimato.

## Alcance

Entra en alcance el codigo y la configuracion que este repositorio ejecuta o instala en tu maquina:

- **Hooks** (`hooks/*.js`) — se ejecutan como procesos Node dentro de tu CLI
- **Workflows** (`.claude/workflows/*.js`) — orquestan agentes y comandos
- **Manifiestos de instalacion** (`.claude-plugin/plugin.json`, `gemini-extension.json`, `hooks/hooks.json`)
- **Plantillas y reglas** — si una plantilla induce al asistente a ejecutar acciones destructivas o a filtrar secretos

Queda fuera de alcance:

- Vulnerabilidades de las CLIs de terceros (Claude Code, Gemini CLI, Cursor). Reportalas a sus mantenedores
- El codigo que tu asistente de IA genere en tu proyecto

## Aviso sobre el codigo generado

Este framework es un conjunto de plantillas e instrucciones que **guian** al asistente de IA. No compila, no analiza ni verifica el codigo que el asistente produce, y no ofrece garantia alguna sobre su seguridad.

El codigo generado por un LLM puede contener vulnerabilidades, dependencias inseguras o secretos expuestos, incluso siguiendo el flujo al completo. **Revisa, testea y audita todo lo que llegue a produccion.** La responsabilidad sobre el codigo que mergeas es tuya.

Del mismo modo, los hooks del framework son **advisory**: avisan, no bloquean. No los trates como un control de seguridad.

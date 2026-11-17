---
name: configurar-tests
description: "Cuando un proyecto no tiene framework de pruebas o faltan scripts básicos: detecta el stack y configura la infraestructura. Para escribir casos en una infraestructura existente: testing."
---

# Configurar pruebas

> Prepara una infraestructura de pruebas antes de escribir casos.

## Paso 1: Detectar el stack

Lee los manifiestos y la configuración del proyecto. Identifica el lenguaje, el gestor de paquetes y la
infraestructura de pruebas ya presente. No sustituyas una infraestructura existente.

## Paso 2: Proponer la configuración

Sigue `ai_docs/core_templates/04_setup_testing.md`. Presenta los ficheros, dependencias, scripts y el
coste de la configuración antes de instalar o modificar nada.

## Paso 3: Verificar la instalación

Ejecuta la comprobación más pequeña que confirme que el runner arranca. Declara los requisitos externos que
no estén disponibles.

Para escribir o ampliar casos cuando ya existe un framework, usa `testing`.

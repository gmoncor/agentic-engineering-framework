# Plantilla de Decisión del Proyecto

> **Cuándo usar:** Cuando una decisión técnica o de producto condiciona trabajo futuro.
> **Resultado:** Un fichero versionado en `ai_docs/core/decisiones/` que explica la regla vigente y cómo comprobarla.

---

## Cómo crear una decisión

1. Crea `ai_docs/core/decisiones/AAAAMMDD_slug.md`. La fecha evita colisiones de numeración entre ramas.
2. Usa los seis campos de la plantilla. Conserva la cita literal en `Decidido por`.
3. Si la decisión sustituye otra vigente, cambia el estado de la anterior a `SUSTITUIDA por AAAAMMDD_slug.md`. No borres su fichero.
4. Añade o actualiza la fila del índice `Registro de decisiones` de `ai_docs/core/planificacion_tecnica.md`.

El estado debe ser exactamente `VIGENTE`, `SUSTITUIDA por AAAAMMDD_slug.md` o `DESCARTADA`.

```markdown
# [Título de la decisión]

**Regla:** [Decisión vigente, en presente]
**Disparador:** [Cuándo se aplica y quién la aplica]
**Comprobación:** [Comando, prueba o revisión que la acredita]
**Vigente desde:** [YYYY-MM-DD]
**Estado:** VIGENTE
**Decidido por:** [Cita literal de quien decide]

## Contexto

[Problema, restricciones y opciones relevantes.]

## Consecuencia

[Qué cambia y qué queda descartado.]
```

Para revisar decisiones existentes, esta búsqueda muestra los ficheros sin estado válido:

```sh
grep -L -E '^\*\*Estado:\*\* (VIGENTE|SUSTITUIDA por [0-9]{8}_[a-z0-9_]+\.md|DESCARTADA)$' ai_docs/core/decisiones/*.md
```

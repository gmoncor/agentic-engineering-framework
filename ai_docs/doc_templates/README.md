# Documentación de proyecto

Estas plantillas generan documentos de negocio bajo `docs/proyecto/`. Son distintos de `ai_docs/core/`: el núcleo aporta contexto de trabajo versionado y esta documentación comunica una versión validable por personas.

## Frontmatter obligatorio

Cada plantilla, salvo este índice, empieza con estos seis campos:

```yaml
estado: borrador
validado_por: ""
fecha_validacion: ""
fuentes: []
ultima_revision_commit: ""
idioma: es
```

`estado` admite `borrador`, `en_revision`, `validado` u `obsoleto`. Todo cambio en un documento `validado` lo devuelve a `en_revision` antes de validarlo de nuevo.

| Plantilla | Documento generado |
|-----------|-------------------|
| `vision.md` | `docs/proyecto/vision.md` |
| `alcance.md` | `docs/proyecto/alcance.md` |
| `aceptacion.md` | `docs/proyecto/aceptacion.md` |
| `estado.md` | `docs/proyecto/estado.md` |
| `novedades.md` | `docs/proyecto/novedades.md` |
| `glosario.md` | `docs/proyecto/glosario.md` |

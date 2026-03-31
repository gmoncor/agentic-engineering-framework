# Plantilla de Revision y Creacion de Pull Requests

> **Cuando usar:** Cuando quieras crear una Pull Request o revisar una existente antes de mergear.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego indica si quieres crear o revisar una PR.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta el resumen de la revision o la PR propuesta ANTES de crearla o aprobarla.
3. **EXPLICA el porque** — Si encuentras un problema, explica por que es un problema y como solucionarlo.
4. **SUGIERE mejoras** — Si ves oportunidades de mejora en el codigo, mencionalas.
5. **VERIFICA despues** — Tras crear la PR, muestra el enlace y confirma que se creo correctamente.
6. **NUNCA apruebes una PR sin revisarla completamente** — Revisa TODOS los archivos cambiados.
7. **NUNCA asumas que la primera solucion es la mejor** — Si encuentras un problema, sugiere como corregirlo.

**Instrucciones adicionales para esta plantilla:**
- NUNCA crees o apruebes una PR que incluya archivos sensibles (.env, credenciales) o de scaffolding (ai_docs/).
- Si la PR tiene mas de 500 lineas cambiadas, SUGIERE dividirla en PRs mas pequenas.
- SIEMPRE revisa la PR completa antes de crear o aprobar.

---

## Modo A: Revisar una PR existente

### Paso 1: Verificar archivos incluidos

**BLOQUEANTE:** Verificar que la PR NO incluye:
- Archivos con secretos (.env, credenciales, API keys)
- Archivos de plantillas de IA (ai_docs/)
- Archivos temporales o de cache

**Si se encuentra alguno:** ALERTAR al usuario inmediatamente. No continuar hasta que se eliminen.

### Paso 2: Evaluar el tamano

| Lineas cambiadas | Tamano | Recomendacion |
|-----------------|--------|---------------|
| 1-100 | Pequeno | Revisar tal cual |
| 101-300 | Mediano | Verificar que los commits son logicos |
| 301-500 | Grande | Considerar si se puede dividir |
| 500+ | Muy grande | RECOMENDAR dividir en PRs mas pequenas |

### Paso 3: Escaneo de calidad

Revisar TODOS los archivos cambiados buscando:

| Categoria | Que buscar | Nivel |
|-----------|------------|-------|
| **Codigo muerto** | Funciones vacias, imports sin usar, codigo comentado | WARNING |
| **Seguridad** | Secretos hardcoded, API keys expuestas, SQL injection | BLOQUEANTE |
| **Tipos** | Uso de `any`/`Any`, tipos faltantes, casteos inseguros | WARNING |
| **Errores** | Excepciones tragadas, try/catch vacios, errores ignorados | WARNING |
| **Logica** | Condiciones invertidas, off-by-one, null checks faltantes | BLOQUEANTE |
| **Rendimiento** | Queries N+1, bucles innecesarios, re-renders | WARNING |

### Paso 4: Presentar resultado

```
## Resultado de la revision

**Tamano:** [Pequeno/Mediano/Grande/Muy grande] ([N] lineas)

**BLOQUEANTES** (corregir antes de mergear):
- [Problema 1]: [Archivo:linea] — [Descripcion y como corregir]

**WARNINGS** (deberian corregirse):
- [Problema 1]: [Archivo:linea] — [Descripcion]

**OK:**
- [N] archivos revisados sin problemas

**Veredicto:** APROBADO / CAMBIOS NECESARIOS / RECHAZADO
```

---

## Modo B: Crear una PR nueva

### Paso 1: Verificar archivos (mismo que Modo A, Paso 1)

### Paso 2: Revisar los cambios

1. Ejecutar `git diff` contra la rama base (normalmente `main` o `develop`)
2. Listar todos los commits que se incluiran
3. Verificar que todos los cambios estan relacionados con la misma tarea/funcionalidad

### Paso 3: Escaneo de calidad (mismo que Modo A, Paso 3)

### Paso 4: Preparar la PR

```markdown
## Titulo de la PR
[tipo]: [descripcion breve — maximo 70 caracteres]

## Descripcion
### Resumen
- [Que se hizo y por que — en bullet points]

### Cambios principales
- [Archivo/modulo 1]: [que cambio]
- [Archivo/modulo 2]: [que cambio]

### Como probar
- [ ] [Paso 1 para verificar que funciona]
- [ ] [Paso 2]
- [ ] [Paso 3]

### Notas para el revisor
- [Algo que el revisor deberia saber o tener en cuenta]
```

### Paso 5: Presentar al usuario

```
PR lista para crear:

Titulo: [titulo]
Rama: [rama actual] -> [rama destino]
Commits: [cantidad]
Archivos: [cantidad] ([N] lineas cambiadas)

Revisar la descripcion arriba. Creo la PR? (S/n)
```

**ESPERAR aprobacion antes de crear la PR.**

---

## Reglas inquebrantables

1. **NUNCA aprobar una PR sin revisar TODOS los archivos**
2. **NUNCA crear una PR con archivos sensibles o de scaffolding**
3. **NUNCA mergear directamente** — la PR debe ser revisada por una persona
4. **Si hay problemas BLOQUEANTES**, no aprobar bajo ninguna circunstancia
5. **Si la PR es muy grande** (500+ lineas), recomendar dividirla
6. **SIEMPRE presentar la revision/PR** al usuario antes de aprobar o crear

# Resolver Problema — Template de Analisis y Decision

> Analiza un problema, evalua opciones y recomienda la mejor solucion. Funciona como un consultor tecnico que te ayuda a tomar buenas decisiones.

---

## Cuando usar esta plantilla

- Tienes un problema tecnico y no sabes como abordarlo
- Dudas entre varias opciones de implementacion
- Necesitas evaluar trade-offs antes de decidir
- Algo no funciona como esperabas y no sabes por que
- Quieres una segunda opinion sobre una decision de arquitectura

---

## Proceso

### Paso 1: Entender el problema

Lee toda la informacion disponible:

- `ai_docs/core/` para contexto del proyecto
- Archivos relevantes mencionados por el usuario
- Codigo existente relacionado
- Specs y tasks si las hay en `ai_docs/tasks/`

**Formula el problema en una frase clara.** Si no puedes hacerlo, necesitas mas informacion — PREGUNTA.

Preguntas de diagnostico:
- Que deberia pasar vs que pasa realmente?
- Desde cuando ocurre? Que cambio?
- Cual es el impacto real (usuarios afectados, funcionalidad rota, riesgo)?
- Es urgente (produccion rota) o puede esperar (mejora)?

### Paso 2: Analisis de causa raiz

NO saltes a la solucion. Primero entiende POR QUE:

1. **Recolecta evidencia** — logs, errores, comportamiento observado
2. **Tecnica de los 5 por que** — pregunta "por que?" hasta llegar a la causa real
3. **Descarta suposiciones** — verifica con el codigo, no asumas
4. **Identifica el componente exacto** — archivo, funcion, linea

```
Sintoma: "El formulario no guarda los datos"
  Por que? → El endpoint devuelve 500
  Por que? → La validacion rechaza el campo "email"
  Por que? → La regex de validacion no acepta dominios con guion
  → Causa raiz: regex de validacion demasiado restrictiva en validators.js:42
```

### Paso 3: Generar opciones

Genera **minimo 2 opciones distintas**, maximo 4. Para cada una:

| Campo | Que documentar |
|-------|---------------|
| Descripcion | Que harias exactamente (archivos, cambios) |
| Ventajas | Que ganas |
| Desventajas | Que pierdes o arriesgas |
| Esfuerzo | Estimacion: trivial / pocas horas / un dia / varios dias |
| Reversibilidad | Facil de deshacer? |
| Impacto | Que otros modulos/features afecta |

**Opcion "no hacer nada"**: si el problema es menor o tiene workaround, incluir como opcion valida con su coste de oportunidad.

### Paso 4: Evaluar y recomendar

Aplica estos criterios en orden de prioridad:

1. **Correccion** — Resuelve el problema real (causa raiz, no sintoma)?
2. **Seguridad** — Introduce vulnerabilidades?
3. **Simplicidad** — Es la solucion mas simple que funciona (KISS)?
4. **Impacto minimo** — Toca el minimo de archivos/modulos necesarios?
5. **Reversibilidad** — Se puede deshacer si sale mal?
6. **Mantenibilidad** — El equipo la entendera en 6 meses?

**Elige UNA opcion y di POR QUE** la recomiendas sobre las otras. Se concreto:
- "Recomiendo la opcion B porque resuelve la causa raiz sin tocar el modulo de pagos, que esta en freeze"
- NO: "Depende del contexto" / "Cualquiera podria funcionar"

### Paso 5: Presentar al usuario

Formato de presentacion:

```
## Problema
[Una frase clara]

## Causa raiz
[Que encontraste y donde]

## Opciones

### Opcion A: [nombre descriptivo]
- Que: [cambios concretos]
- Ventaja: ...
- Riesgo: ...
- Esfuerzo: ...

### Opcion B: [nombre descriptivo]
...

## Recomendacion
[Opcion X] porque [razon concreta].

## Siguiente paso
[Accion concreta inmediata si el usuario acepta]
```

**PUNTO DE ESPERA:** Presenta la recomendacion y espera la decision del usuario antes de hacer cualquier cambio. El asesor recomienda, no ejecuta.

---

## Reglas del asesor

1. **Primero entiende, despues opina** — no saltes al solucionismo
2. **Pregunta si faltan datos criticos** — mejor preguntar que asumir mal
3. **Se honesto sobre incertidumbre** — "No estoy seguro de X, sugiero verificar Y"
4. **Opciones concretas, no genericas** — con archivos, cambios, estimaciones
5. **Una recomendacion clara** — no "depende". Si genuinamente depende, di de que
6. **No ejecutes nada** — tu rol es analizar y recomendar. La implementacion la hace el implementador
7. **Cuestiona el planteamiento** — a veces el problema real es distinto al que se plantea

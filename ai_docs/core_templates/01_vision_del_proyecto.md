# Plantilla de Vision del Proyecto

> **Cuando usar:** Al arrancar un proyecto nuevo o incorporarte a uno existente. Este documento define QUE se va a construir, PARA QUIEN y POR QUE.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego describe tu idea o el proyecto al que te incorporas.
> **Resultado:** Un documento de vision del proyecto que sirve de referencia para todo el desarrollo posterior.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta cada seccion como borrador editable. Espera confirmacion ANTES de avanzar al siguiente paso.
3. **EXPLICA el porque** — No solo documentes, explica POR QUE cada decision es importante.
4. **SUGIERE mejoras** — Si detectas incoherencias, lagunas o oportunidades, PROPONLAS activamente.
5. **VERIFICA despues** — Al final, haz un chequeo cruzado de coherencia entre todas las secciones.
6. **ESCALA cuando corresponda** — Si la idea es demasiado grande, sugiere dividirla en fases.
7. **NUNCA asumas que la primera version es la definitiva** — Siempre ofrece una ronda de refinamiento.

**Instrucciones criticas para esta plantilla:**

- **ITERACION OBLIGATORIA:** Despues de completar TODOS los pasos, debes hacer una autocritica del documento y preguntar al usuario si quiere refinar algo. NUNCA presentes el documento como "terminado" sin ofrecer una ronda de revision.
- **DRAFT-FIRST:** Para cada paso, genera un borrador inteligente basado en lo que sabes. El usuario corrige o confirma. No hagas demasiadas preguntas — propone y deja que corrijan.
- **COHERENCIA:** Cada seccion debe conectar con el Objetivo Final. Si algo no lo soporta, cuestionalo.
- **Si la descripcion del usuario es vaga** (ej: "quiero hacer una app de tareas"), DETENTE y pide que concrete: para quien, que problema resuelve, como se diferencia de lo que ya existe.

---

## Paso 1: Entender el punto de partida

Antes de documentar nada, determina:

**Tipo de proyecto:**
- **Nuevo (greenfield):** No hay codigo. Se parte de cero.
- **Existente:** Hay codigo en desarrollo o produccion. Analizar el estado actual antes de documentar la vision.

**Tipo de aplicacion:**
- Web SaaS (usuarios, auth, billing, UI)
- API / Backend (endpoints, servicios, sin UI propia)
- Herramienta interna (sin monetizacion, sin marketing publico)
- Otro (especificar)

**Si es proyecto existente:** Analiza el codigo, la estructura de carpetas y la documentacion disponible. Resume el estado actual antes de continuar.

---

## Paso 2: Definir el Objetivo Final

Una sola frase que ancle todas las decisiones del proyecto.

**Formato:** "Esta aplicacion ayuda a **[quien]** a lograr **[resultado]** usando **[capacidad clave]**."

**Guia:**
- Debe ser especifica y medible (evitar "hacer cosas mejor")
- Verbos activos y concretos
- Si el usuario no puede definirla en una frase, la idea necesita mas trabajo

**Borrador IA:** Genera un borrador basado en lo que el usuario ha descrito. Presenta el borrador y deja que lo edite.

---

## Paso 3: Documentar el Problema Central

Las mejores aplicaciones resuelven un dolor claro y urgente.

**Documentar:**
- **Causa raiz:** No el sintoma, sino la razon de fondo
- **Consecuencia:** Que pasa si no se resuelve (cuantificar: tiempo, dinero, oportunidad perdida)
- **Urgencia:** Por que resolverlo ahora y no despues

**Si el usuario no identifica un problema claro**, cuestiona si la aplicacion es necesaria. No todas las ideas tienen un problema real detras — ayuda al usuario a descubrirlo o a pivotar.

---

## Paso 4: Identificar TODOS los tipos de usuario

Pensar mas alla del usuario principal.

**Para cada tipo de usuario documentar:**
- **Quien es** (rol, contexto)
- **Frustraciones** (que le duele, que no funciona hoy)
- **Objetivos urgentes** (que necesita lograr)

**Tipos comunes a considerar:**
- Usuario principal (el que usa la app a diario)
- Administrador (quien configura y gestiona)
- Otros roles (moderador, revisor, gestor de billing, etc.)

**Borrador IA:** Propone los tipos de usuario basandote en la idea. El usuario confirma o ajusta.

---

## Paso 5: Modelo de negocio (si aplica)

Si la app necesita generar ingresos, documentar:

- **Tipo de modelo:** Suscripcion, pago por uso, freemium, compra unica, etc.
- **Estructura de precios:** Tiers, limites, triggers de upgrade
- **Justificacion:** Por que este modelo encaja con los usuarios y el problema

Si es herramienta interna o proyecto sin monetizacion, documentar "Sin modelo de negocio" y continuar.

---

## Paso 6: Funcionalidades MVP por rol

**Solo lo imprescindible para lanzar.** Todo lo demas es Fase 2.

**Para cada rol de usuario, listar:**
- **[Rol] puede...** [capacidad concreta]
- Usar verbos claros y especificos
- Cada item debe conectar con resolver el problema central

**Borrador IA:** Genera las funcionalidades desde el problema y los tipos de usuario. Marca explicitamente que queda fuera del MVP y por que.

### Fuera de Scope (Exclusiones explicitas)

Documentar que NO se va a construir y por que:
- **[Feature excluido]:** Excluido porque [razon: no es MVP / complejidad excesiva / se puede anadir despues]

---

## Paso 7: Restricciones del proyecto

Las restricciones condicionan las decisiones tecnicas. Documentar:

- **Equipo:** Desarrollador solo / equipo pequeno / equipo mediano / equipo grande
- **Presupuesto para servicios:** $0 (solo free tiers) / Limitado / Flexible
- **Timeline:** Sin deadline / Deadline especifico / Lo antes posible
- **Infraestructura obligatoria:** Debe usar X servicio o plataforma
- **Otras restricciones:** Regulatorias, de compliance, tecnicas

---

## Paso 8: User Stories clave

**Formato:** *Como [rol], quiero [accion], para que [valor].*

- Minimo 2 stories por rol definido
- Incluir criterios de aceptacion cuando la story lo requiera
- Incluir stories de sistema/background para tareas automaticas

---

## Paso 9: Revision cruzada y autocritica (OBLIGATORIO)

**ANTES de presentar el documento final, el asistente DEBE hacer esta revision:**

### Chequeo de coherencia

Verificar que:
- [ ] Todas las funcionalidades MVP soportan el Objetivo Final
- [ ] Cada tipo de usuario tiene al menos 2 user stories
- [ ] Las restricciones son coherentes con el scope del MVP (ej: no proponer 20 features para un dev solo con deadline de 2 semanas)
- [ ] El problema central se resuelve con las funcionalidades propuestas
- [ ] Las exclusiones de scope estan justificadas
- [ ] No hay funcionalidades "huerfanas" que no conecten con ningun tipo de usuario

### Autocritica

Responder honestamente:
- **Que le falta a este documento?** [Identificar al menos 1 area debil]
- **Que podria estar mal?** [Suposiciones no validadas, datos faltantes]
- **Que preguntaria un inversor o un lead tecnico?** [Preguntas dificiles que el documento no responde]

### Presentar al usuario

```
He completado el documento de vision. Antes de darlo por terminado:

AUTOCRITICA:
- [Area debil identificada]
- [Suposicion no validada]
- [Pregunta sin responder]

Quieres:
A) Refinar las areas debiles que he identificado
B) Anadir o cambiar algo mas
C) El documento esta completo tal cual

(Recomiendo al menos revisar las areas debiles antes de continuar)
```

**ESPERAR respuesta. Si el usuario elige A o B, iterar. Si elige C, generar el documento final.**

---

## Paso 10: Generar documento final

Solo despues de la aprobacion del usuario, generar el documento con este formato:

```markdown
# Vision del Proyecto

## Contexto
- **Tipo de proyecto:** [Nuevo / Existente]
- **Tipo de aplicacion:** [Web SaaS / API / Herramienta interna / Otro]
- **Estado actual:** [Descripcion si es proyecto existente]

## Objetivo Final
[Frase claramente definida]

## Problema Central
[Causa raiz y consecuencia cuantificada]

## Tipos de Usuario

### [Rol 1]
- **Quien:** [Descripcion]
- **Frustraciones:** [Lista]
- **Objetivos urgentes:** [Lista]

### [Rol 2] (si aplica)
[Mismo formato]

## Modelo de Negocio
- **Tipo:** [Modelo elegido]
- **Estructura de precios:** [Detalles]

## Funcionalidades MVP por Rol
### [Rol 1]
- [Capacidad 1]
- [Capacidad 2]

### Fuera de Scope
- [Feature excluido]: [Razon]

## Restricciones del Proyecto
- **Equipo:** [Tamano]
- **Presupuesto:** [Rango]
- **Timeline:** [Deadline si existe]
- **Infraestructura obligatoria:** [Si aplica]

## User Stories

### [Rol 1]
1. Como [rol], quiero [accion], para que [valor].

### Sistema/Background (si aplica)
1. Cuando [evento], entonces [tarea].

## Features de Valor Anadido (Fase 2+)
- [Feature 1]: [Valor para el usuario]
- [Feature 2]: [Valor para el usuario]
```

---

## Reglas inquebrantables

1. **NUNCA generar el documento final sin la ronda de autocritica** (Paso 9)
2. **NUNCA aceptar una idea vaga sin cuestionarla** — si el usuario no puede definir el problema, ayudale a encontrarlo
3. **NUNCA incluir features que no conecten** con el Objetivo Final o con un tipo de usuario
4. **Cada seccion es un borrador editable** — el usuario siempre puede corregir, anadir o eliminar
5. **Si el MVP tiene mas de 15 funcionalidades**, es demasiado grande — sugiere recortar

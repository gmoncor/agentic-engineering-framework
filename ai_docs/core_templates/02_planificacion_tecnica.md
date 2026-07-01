# Plantilla de Planificacion Tecnica

> **Cuando usar:** Despues de tener la Vision del Proyecto (`01_vision_del_proyecto.md`). Este documento define la estructura de la aplicacion: paginas, datos y arquitectura.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Adjunta o referencia tambien el documento de vision del proyecto.
> **Resultado:** Un documento de planificacion tecnica con la estructura de paginas, modelo de datos y arquitectura del sistema.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta cada fase como borrador editable. Espera confirmacion ANTES de avanzar.
3. **EXPLICA el porque** — No solo listes paginas o tablas, explica POR QUE cada una es necesaria.
4. **SUGIERE mejoras** — Si detectas oportunidades de simplificacion o riesgos tecnicos, PROPONLOS activamente.
5. **VERIFICA despues** — Al final de cada fase, haz un chequeo cruzado con la vision del proyecto.
6. **ESCALA cuando corresponda** — Si la arquitectura es demasiado compleja para el equipo/presupuesto, simplifica.
7. **NUNCA asumas que la primera version es la definitiva** — Siempre ofrece una ronda de refinamiento.

**Instrucciones criticas para esta plantilla:**

- **PREREQUISITO:** Este documento NECESITA la Vision del Proyecto. Si no existe, pide al usuario que la cree primero.
- **COHERENCIA CRUZADA:** Todo lo que documentes aqui DEBE soportar lo definido en la vision. Si encuentras inconsistencias, alerta al usuario.
- **SIN CODIGO:** Este documento es planificacion pura. NO escribir codigo, nombres de funciones ni detalles de implementacion.
- **STACK-AWARE:** Detecta o pregunta por el stack tecnologico. Las decisiones de arquitectura dependen del framework elegido.
- **RESPETAR RESTRICCIONES:** Lee las restricciones de la vision (equipo, presupuesto, timeline) y adapta la complejidad.

---

## Fase 1: Estructura de Paginas y Funcionalidad

### 1.1 Detectar stack tecnologico

Antes de proponer estructura, necesitas saber con que se construye:

- Buscar archivos de configuracion: `package.json`, `pyproject.toml`, `composer.json`, etc.
- Si no puedes detectarlo, pregunta: "Que stack tecnologico usaras?"
- Documentar: framework, base de datos, ORM, auth, servicios cloud

### 1.2 Estructura de paginas

Basandote en la vision del proyecto, generar todas las paginas que la app necesita:

**Paginas universales (toda app web necesita):**
- Landing page (hero, features, pricing si aplica, CTA)
- Paginas legales (privacidad, terminos)
- Flujo de autenticacion (login, registro, recuperar contrasena)

**Paginas core (desde las funcionalidades MVP):**
- Para cada funcionalidad MVP, definir que pagina la aloja
- Para cada pagina, listar los elementos funcionales:
  - Que puede HACER el usuario en esta pagina?
  - Que datos se muestran?
  - Que acciones estan disponibles?
- Marcar cada elemento como (Frontend) / (Backend) / (Background Job)

**Paginas de administracion (si hay multiples roles):**
- Gestion de usuarios
- Configuracion del sistema
- Analitica y monitorizacion

**Si la app es API/Backend puro:** En lugar de paginas, listar endpoints organizados por recurso/dominio.

### 1.3 Navegacion

Definir como el usuario se mueve por la app:
- Menu principal / sidebar
- Que items ve cada rol
- Comportamiento en movil
- Priorizar la funcionalidad core (primera opcion visible)

### 1.4 Validacion de Fase 1

Antes de continuar, verificar:
- [ ] Todas las funcionalidades MVP tienen una pagina asignada
- [ ] Todos los tipos de usuario pueden acceder a sus funcionalidades
- [ ] La navegacion es logica y prioriza el valor core
- [ ] Las restricciones de equipo/presupuesto son compatibles con la cantidad de paginas propuestas

**Presentar al usuario para aprobacion antes de continuar a Fase 2.**

---

## Fase 2: Modelo de Datos

### 2.1 Mapeo feature-a-datos

Para cada funcionalidad MVP, responder:
- Que datos necesita almacenar esta funcionalidad?
- Que tablas o colecciones son necesarias?
- Como se relacionan entre si?

**Formato para cada tabla:**
```
Tabla: [nombre]
- Proposito: [para que sirve — conectar con una funcionalidad MVP]
- Campos clave: [listar los mas importantes]
- Relaciones: [con que otras tablas se conecta]
```

### 2.2 Decisiones clave de datos

Identificar las 2-4 decisiones de datos mas importantes. No enterrarlas en detalles — presentarlas como decisiones claras:

```
Decision 1: [Nombre del problema]
- Situacion: [Estado actual vs lo que necesitas]
- Opciones: [Opcion A] vs [Opcion B]
- Recomendacion: [Opcion X] porque [razon concreta]
```

**Temas tipicos que requieren decision:**
- Modelo de permisos (roles en tabla de usuarios vs tabla separada de roles)
- Modelo de billing (datos en tu BD vs delegar al proveedor de pagos)
- Datos multimedia (almacenar en BD vs servicio de storage externo)
- Relaciones complejas (tablas intermedias vs JSON en columna)

### 2.3 Consideraciones de rendimiento

Identificar:
- Campos que necesitaran indices (busquedas frecuentes, foreign keys)
- Queries que podrian ser problematicas a escala
- Datos que crecen rapido y podrian necesitar paginacion

### 2.4 Validacion de Fase 2

Antes de continuar, verificar:
- [ ] Cada funcionalidad MVP tiene las tablas/datos que necesita
- [ ] Los tipos de usuario del documento de vision tienen campos de rol/permisos
- [ ] Si hay modelo de negocio con pagos, existen campos de billing/suscripcion
- [ ] Las relaciones entre tablas son coherentes

**Presentar al usuario. Pedir decision sobre los puntos pendientes antes de continuar.**

---

## Fase 3: Arquitectura del Sistema

### 3.1 Fundacion del stack

Documentar que ya proporciona el stack elegido:
- Auth (que sistema de autenticacion incluye)
- Base de datos (que ORM, que tipo de BD)
- Deployment (donde se despliega, como)
- Integraciones (que servicios ya estan conectados)

### 3.2 Extensiones necesarias

Solo lo que el stack NO proporciona y la app NECESITA:
- Servicios externos (pagos, email, almacenamiento, IA, etc.)
- Para cada extension: POR QUE es necesaria y QUE funcionalidad soporta

**EVITAR SOBRE-INGENIERIA:**
- No proponer Redis, colas de mensajes, microservicios, ni monitoring complejo para un MVP
- Empezar simple. Anadir complejidad solo cuando haya problemas reales
- Si el presupuesto es $0, solo proponer servicios gratuitos

### 3.3 Diagrama de arquitectura

Generar un diagrama visual (Mermaid o texto) que muestre:
- Capas del sistema (UI → Aplicacion → Datos → Servicios externos)
- Separar lo que el stack ya da vs lo que hay que construir
- Flujo de datos principal (como se mueve la informacion)

### 3.4 Seguridad basica

Documentar las decisiones de seguridad fundamentales:
- **Autenticacion:** Que patron se usa (sessions, JWT, OAuth)
- **Autorizacion:** Como se protegen las rutas por rol
- **Datos sensibles:** Que datos son sensibles, como se protegen
- **Secretos:** Variables de entorno, nunca hardcodear credenciales

### 3.5 Estrategia de deployment

- **Donde:** Plataforma de despliegue
- **Entornos:** Desarrollo, staging, produccion
- **Base de datos:** Managed vs self-hosted, estrategia de backups

### 3.6 Validacion de Fase 3

Antes de cerrar, verificar:
- [ ] La arquitectura soporta TODAS las funcionalidades MVP
- [ ] Las extensiones propuestas son coherentes con el presupuesto
- [ ] La complejidad es apropiada para el tamano del equipo
- [ ] No hay sobre-ingenieria (servicios innecesarios para un MVP)

**Presentar al usuario.**

---

## Revision Final y Autocritica (OBLIGATORIO)

**ANTES de dar el documento por terminado, el asistente DEBE:**

### Chequeo cruzado con la vision del proyecto

- [ ] Todas las paginas mapean a funcionalidades MVP de la vision
- [ ] El modelo de datos cubre todos los tipos de usuario
- [ ] La arquitectura respeta las restricciones (equipo, presupuesto, timeline)
- [ ] Los servicios externos propuestos son coherentes con el modelo de negocio
- [ ] No hay paginas, tablas o servicios "huerfanos" que no conecten con ninguna funcionalidad

### Autocritica

Responder honestamente:
- **Que podria estar sobre-ingeniado?** [Componentes innecesariamente complejos]
- **Que podria faltar?** [Gaps entre la vision y la planificacion tecnica]
- **Donde estan los riesgos tecnicos?** [Integraciones dificiles, dependencias criticas]

### Presentar al usuario

```
He completado la planificacion tecnica. Antes de cerrarla:

AUTOCRITICA:
- [Posible sobre-ingenieria detectada]
- [Gap potencial con la vision]
- [Riesgo tecnico identificado]

Quieres:
A) Revisar las areas que he identificado
B) Cambiar o anadir algo
C) La planificacion esta completa

(Recomiendo revisar los riesgos tecnicos antes de pasar al roadmap)
```

**ESPERAR respuesta antes de generar el documento final.**

---

## Generar documento final

Solo despues de la aprobacion, generar con este formato:

```markdown
# Planificacion Tecnica

## Stack Tecnologico
- **Framework:** [nombre + version]
- **Base de datos:** [tipo + ORM]
- **Auth:** [sistema]
- **Deployment:** [plataforma]

---

## Estructura de Paginas

### Paginas Publicas
- [Pagina]: [funcionalidad principal]

### Paginas de Autenticacion
- [Flujo de auth]

### Paginas Core
- [Pagina]: [funcionalidad por bullet points con (Frontend)/(Backend)]

### Paginas Admin (si aplica)
- [Pagina]: [funcionalidad]

### Navegacion
- [Estructura del menu por roles]

---

## Modelo de Datos

### Decisiones Clave
- [Decision 1]: [opcion elegida y por que]

### Tablas
- **[nombre_tabla]**: [proposito] — Campos clave: [lista]
- **[nombre_tabla]**: [proposito] — Campos clave: [lista]

### Consideraciones de Rendimiento
- [Indices, queries problematicas, paginacion]

---

## Arquitectura del Sistema

### Fundacion del Stack
- [Que ya proporciona el stack]

### Extensiones Necesarias
- [Servicio]: [por que es necesario]

### Diagrama
[Diagrama Mermaid o texto]

### Seguridad
- [Decisiones de seguridad]

### Deployment
- [Estrategia de despliegue]

---

## Riesgos Tecnicos Identificados
- [Riesgo 1]: [estrategia de mitigacion]
- [Riesgo 2]: [estrategia de mitigacion]
```

---

## Reglas inquebrantables

1. **NUNCA generar planificacion tecnica sin la vision del proyecto** — es prerequisito
2. **NUNCA proponer arquitectura compleja para un equipo pequeno** — adaptar al contexto
3. **NUNCA cerrar sin la ronda de autocritica** (Revision Final)
4. **NUNCA escribir codigo** — esto es planificacion, no implementacion
5. **Cada fase se presenta por separado** al usuario para aprobacion antes de continuar
6. **Si el stack no esta claro**, pregunta antes de proponer arquitectura

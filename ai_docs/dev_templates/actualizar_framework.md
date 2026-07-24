# Plantilla de Actualizacion del Framework

> **Cuando usar:** Cuando tu proyecto ya tiene el framework instalado y quieres traer los cambios de una version mas reciente. No es un paso del pipeline SDD — es mantenimiento periodico del propio framework.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. El asistente detecta la version instalada, consulta el CHANGELOG y te guia paso a paso.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA si no encuentras el marcador de version** — no asumas la version instalada en silencio.
2. **MUESTRA la tabla de alcance antes de tocar nada** — el usuario confirma que se actualiza y que no, antes de que cambie un solo archivo.
3. **RESALTA los cambios Breaking** — nunca se aplican en silencio, siempre con la migracion manual que exigen.
4. **PRESERVA lo personalizado** — en los archivos de contexto, conserva las secciones que el usuario anadio o modifico respecto al framework original.
5. **VERIFICA al final** — tests y carga de hooks, antes de dar la actualizacion por terminada.

---

## Paso 1: Detectar la version instalada

Busca el comentario `<!-- sdd-framework: X.Y.Z -->` al pie del archivo de contexto que use tu proyecto (`CLAUDE.md`, `GEMINI.md` o `AGENTS.md`).

- **Si lo encuentras:** esa es la version instalada.
- **Si no lo encuentras:** el proyecto se instalo antes de que existiera el marcador. PREGUNTA al usuario que version tiene. Si no lo sabe, revisa el CHANGELOG del framework: la entrada que introduce el marcador de version senala el corte, y la version anterior a esa entrada es un punto de partida razonable para asumir.

No sigas al Paso 2 sin una version de origen, aunque sea aproximada.

## Paso 2: Leer el CHANGELOG

Consigue el `CHANGELOG.md` del framework (clonado, descargado, o pegado a mano por el usuario si trabajas sin conexion).

- Lista las entradas desde la version instalada (exclusive) hasta la version actual (inclusive), agrupadas por version.
- Separa cada entrada en Added / Changed / Fixed / **Breaking**.
- **Resalta los Breaking aparte del resto**, cada uno con la migracion manual que exige. El usuario debe verlos antes de aceptar la actualizacion.

## Paso 3: Presentar la tabla de alcance

Antes de tocar nada, presenta esta tabla y espera confirmacion:

| Se actualiza (del framework) | NO se toca (tuyo) |
|---|---|
| Comandos, agentes, skills y hooks del backend instalado (`.claude/`, `.agents/`, `.codex/`, `hooks/`) | `ai_docs/core/` (vision, planificacion, roadmap) |
| `ai_docs/dev_templates/` y `ai_docs/core_templates/` (plantillas del framework) | `ai_docs/tasks/` (tus specs y tasks) |
| Secciones del framework dentro de los archivos de contexto (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`) | `ai_docs/refs/` (tus referencias externas) |
| Reglas de stack de `.cursor/rules/` si nunca las personalizaste | Secciones personalizadas dentro de los archivos de contexto (ver Paso 4) |
| | Codigo de tu proyecto |

**PUNTO DE ESPERA:** no continues al Paso 4 sin que el usuario confirme esta tabla.

## Paso 4: Aplicar los cambios

Para cada elemento de la columna "Se actualiza": sobrescribe con la version del repositorio del framework.

Para los archivos de contexto (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`):

1. Identifica que secciones anadio o modifico el usuario respecto al archivo original del framework (ejemplo: convenciones propias del proyecto, notas de arquitectura).
2. Sobrescribe solo las secciones que documentan el framework (flujo, comandos, agentes, hooks, plantillas de referencia).
3. Conserva intactas las secciones personalizadas, en su mismo lugar.
4. Si no puedes distinguir con certeza si una seccion es personalizada, PREGUNTA antes de sobrescribirla.

Si trabajas sin conexion (CHANGELOG pegado a mano en el Paso 2), aplica los mismos cambios con el contenido que te haya dado el usuario — no hace falta `git` ni acceso a red para completar este paso.

## Paso 5: Actualizar el marcador de version

Cambia `<!-- sdd-framework: X.Y.Z -->` al pie de cada archivo de contexto actualizado, a la version nueva.

## Paso 6: Verificar

- Si el proyecto tiene tests del framework, ejecutalos (`npm test`) y confirma que pasan.
- Confirma que los hooks del backend instalado siguen cargando sin error.
- Si algo falla, DETENTE y reporta el error exacto al usuario antes de dar la actualizacion por terminada.

---

## Reglas inquebrantables

1. **NUNCA** sobrescribas un archivo de contexto completo — preserva las secciones personalizadas del Paso 4.
2. **NUNCA** saltes la tabla de alcance del Paso 3: el usuario confirma antes de que cambie nada.
3. **Si no hay marcador de version**, PREGUNTA — no asumas la version instalada en silencio.
4. **Los cambios Breaking se resaltan siempre** — nunca se aplican sin que el usuario los vea primero.
5. **Sin conexion, la plantilla sigue funcionando** con un CHANGELOG pegado a mano — no exige `git` ni red.

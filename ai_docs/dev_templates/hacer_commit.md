# Plantilla de Commit Git

> **Cuando usar:** Cuando quieras guardar tus cambios en Git con un commit limpio y ordenado.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego dile que quieres hacer commit.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta el mensaje de commit propuesto y los archivos que se incluiran ANTES de ejecutar el commit.
3. **EXPLICA el porque** — Si excluyes algun archivo o sugieres dividir el commit, explica por que.
4. **SUGIERE mejoras** — Si ves que los cambios deberian ir en commits separados, proponlo.
5. **VERIFICA despues** — Tras el commit, muestra el resultado para confirmar que se hizo correctamente.
6. **NUNCA hagas push automaticamente** — El commit es local. Solo hacer push si el usuario lo pide explicitamente.

**Instrucciones adicionales para esta plantilla:**
- NUNCA uses `git add .` ni `git add -A` sin revisar que se esta incluyendo.
- NUNCA incluyas archivos sensibles (.env, credenciales, tokens, claves API).
- NUNCA incluyas archivos de configuracion de IA o scaffolding (ai_docs/) en el commit.
- SIEMPRE presenta el mensaje de commit para aprobacion antes de ejecutar.

---

## Paso 1: Revisar que hay para commitear

Ejecuta `git status` y analiza los cambios:

1. **Archivos modificados:** Que cambio y por que?
2. **Archivos nuevos:** Son necesarios? Faltan en .gitignore?
3. **Archivos que NO deben incluirse:**
   - `.env`, `.env.local` o cualquier archivo con secretos
   - `ai_docs/` (plantillas y documentacion de IA)
   - Archivos temporales, logs, caches
   - `node_modules/`, `__pycache__/`, `vendor/` (dependencias)

**Si detectas archivos sensibles o de IA:** excluyelos y avisa al usuario.

---

## Paso 2: Decidir que incluir

**Regla: solo incluir archivos relacionados con el mismo cambio logico.**

Si hay cambios que pertenecen a funcionalidades diferentes, propone dividirlos en commits separados:

```
He detectado 2 grupos de cambios:

Commit 1: "fix: corregir validacion de email en registro"
  - src/auth/validation.ts
  - src/auth/validation.test.ts

Commit 2: "update: actualizar estilos del dashboard"
  - src/dashboard/styles.css
  - src/dashboard/layout.tsx

Quieres hacer un solo commit o dividirlos?
```

**ESPERAR decision del usuario.**

---

## Paso 3: Preparar el mensaje de commit

Formato recomendado:

```
<tipo>: <descripcion breve — maximo 50 caracteres>

<cuerpo: que cambio y por que — wrap a 72 caracteres por linea>
```

**Tipos comunes:**
| Tipo | Cuando usarlo |
|------|---------------|
| `feat` | Nueva funcionalidad |
| `fix` | Correccion de bug |
| `update` | Mejora de funcionalidad existente |
| `refactor` | Reestructurar codigo sin cambiar comportamiento |
| `docs` | Cambios en documentacion |
| `test` | Anadir o mejorar tests |
| `style` | Cambios de formato (espacios, comas, etc.) |
| `chore` | Tareas de mantenimiento (dependencias, configs) |

**Reglas del mensaje:**
- Modo imperativo: "Corregir" en vez de "Corregido" o "Corrige"
- Sin punto final en la primera linea
- El cuerpo explica QUE y POR QUE, no COMO (el codigo ya muestra el como)

---

## Paso 4: Presentar al usuario para aprobacion

```
Commit propuesto:

Archivos: [cantidad] archivos
Mensaje:
  [tipo]: [descripcion]

  [cuerpo del mensaje]

Proceder? (S/n)
```

**ESPERAR aprobacion explicita antes de ejecutar.**

---

## Paso 5: Ejecutar y verificar

1. Anadir archivos: `git add <archivos-especificos>`
2. Crear commit: `git commit -m "[mensaje]"`
3. Verificar: `git log --oneline -1` para confirmar

**Si falla por un pre-commit hook:**
- Leer el error
- Corregir el problema (linting, formato, etc.)
- Crear un NUEVO commit (no usar `--amend` a menos que el usuario lo pida)

**Si el usuario quiere hacer push despues:**
- Confirmar: "Voy a hacer push a [rama]. Confirmas?"
- Solo hacer push tras confirmacion explicita

---

## Reglas inquebrantables

1. **NUNCA `git add .`** sin revisar que se incluye
2. **NUNCA incluir secretos** (.env, API keys, tokens)
3. **NUNCA incluir archivos de IA** (ai_docs/)
4. **NUNCA push sin confirmacion** explicita del usuario
5. **NUNCA `--amend`** sin pedido explicito — siempre commits nuevos
6. **SIEMPRE presentar el mensaje** para aprobacion antes de ejecutar

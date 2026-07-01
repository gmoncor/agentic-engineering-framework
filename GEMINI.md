# SDD (Spec-Driven Development) — Framework de Desarrollo

> Flujo lineal basado en especificaciones. Toda solicitud empieza con una spec, se parte en tasks atomicas, se audita, se implementa y se revisa adversarialmente.

## Flujo SDD (7 pasos)

```
1. Solicitud    — El usuario describe lo que quiere
2. Spec         — /spec crea la especificacion (QUE se quiere lograr)
3. Tareas       — /tareas parte la spec en tasks granulares y paralelizables
4. Revision de tasks — Cada task se revisa individualmente (skill: revisar-tarea)
5. Auditoria    — /auditar verifica coherencia spec + tasks (huecos, overlap, dependencias)
6. Implementar  — /implementar ejecuta tasks en paralelo donde sea posible
7. Revision adversarial — /revision hace revision adversarial post-implementacion
```

## Comandos disponibles

| Comando | Paso SDD | Que hace |
|---------|----------|----------|
| `/spec` | 2 | Crea una especificacion a partir de una solicitud |
| `/tareas` | 3 | Parte una spec aprobada en tasks granulares |
| `/auditar` | 5 | Audita coherencia entre spec y tasks |
| `/implementar` | 6 | Implementa una task especifica |
| `/revision` | 7 | Revision adversarial de la implementacion completa |
| `/estado` | — | Muestra el estado del proyecto (specs, tasks, progreso) |
| `/bugfix` | — | Diagnostica y corrige un bug con causa raiz |
| `/commit` | — | Crea un commit limpio con mensaje descriptivo |
| `/pr` | — | Crea o revisa una Pull Request |

## Agentes

| Agente | Rol | Cuando se activa |
|--------|-----|-----------------|
| `planificador` | Crea specs, deriva tasks, orquesta | Pasos 2-3 |
| `revisor` | Revisa tasks y hace revision adversarial | Pasos 4, 5, 7 |
| `implementador` | Ejecuta tasks individuales (codigo + tests) | Paso 6 |

## Reglas clave

1. **Toda solicitud empieza con una spec** — nunca implementar sin spec aprobada
2. **Nunca mergear sin revision adversarial** — paso 7 es obligatorio
3. **Tasks son atomicas y granulares** — una task, un cambio atomico, un commit
4. **Paralelizar tasks independientes** — tasks sin dependencias mutuas se ejecutan en paralelo
5. **Una spec, multiples tasks** — la spec define QUE; las tasks definen COMO
6. **Sin sprints** — solo roadmap global en `ai_docs/core/`
7. **El revisor es esceptico** — su trabajo es encontrar problemas, no confirmar que todo esta bien

## Estructura de archivos

```
proyecto/
├── agents/             # planificador, revisor, implementador
├── commands/           # 9 comandos SDD + utilidad
├── skills/             # 8 skills (auto-activacion + utilidad)
├── hooks/              # enforcement del pipeline SDD (advisory)
├── ai_docs/
│   ├── core/           # vision, planificacion, roadmap (fuente de verdad)
│   ├── tasks/          # NNN_descriptor.md (una task por archivo)
│   └── refs/           # documentacion externa de referencia
├── GEMINI.md           # este archivo
└── gemini-extension.json  # manifest de extension
```

## Specs

Ubicacion: `ai_docs/tasks/spec_<descriptor>.md`. Estado: BORRADOR -> APROBADA.
Formato y proceso completo en `ai_docs/dev_templates/spec.md`.

## Tasks

Ubicacion: `ai_docs/tasks/NNN_descriptor.md`. Cada task referencia su spec madre.
Formato y proceso completo en `ai_docs/dev_templates/tareas.md`.

## Plantillas de referencia

Las plantillas detalladas viven en `ai_docs/dev_templates/`. Los comandos y agentes las referencian — no duplicar su contenido:

| Plantilla | Proposito |
|-----------|-----------|
| `spec.md` | Formato y proceso de creacion de specs |
| `tareas.md` | Formato y proceso de derivacion de tasks |
| `revisar_tarea.md` | Checklist de revision pre-implementacion |
| `auditar_spec.md` | Proceso de auditoria spec + tasks |
| `correccion_de_bugs.md` | Diagnostico y correccion de bugs |
| `limpieza_de_codigo.md` | Revision de calidad de codigo |
| `testing_basico.md` | Escritura de tests |
| `hacer_commit.md` | Proceso de commit |
| `revision_pr.md` | Creacion y revision de PRs |

## Estilo

- Idioma: espanol sin acentos
- Comunicacion: clara, directa, sin hedging
- Commits: `<tipo>: <descripcion>` (tipos: create, update, fix, refactor, test)
- Nombres de archivos: snake_case, sin acentos, descriptivos

## Prohibiciones

- NUNCA implementar sin spec aprobada
- NUNCA crear tasks de una spec en estado BORRADOR
- NUNCA mergear sin revision adversarial (paso 7)
- NUNCA hacer tasks que toquen mas de 6 archivos — dividir
- NUNCA saltar la auditoria (paso 5) si hay mas de 2 tasks
- NUNCA aceptar la primera solucion sin cuestionar — siempre revisar alternativas

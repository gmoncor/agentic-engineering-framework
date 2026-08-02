---
name: auditar-sesion
description: "Se activa cuando el usuario pide metricas de la sesion, coste, duracion, cache hit rate o friccion de hooks. Analiza las transcripciones del proyecto actual."
---

Solo funciona en Claude Code: depende del formato nativo de transcripcion JSONL que este backend escribe en `~/.claude/projects/`. Ningun otro backend genera ese formato.

1. Localiza el directorio de transcripciones del proyecto actual: `~/.claude/projects/<ruta-saneada-del-proyecto>/` (la ruta absoluta de tu proyecto con las barras `/` sustituidas por guiones `-`). Si no existe o esta vacio, informa "no se encontraron transcripciones" y detente.
2. Verifica que `.claude/workflows/lib/session-analyzer.js` existe antes de importarlo. Si falta, informa que la instalacion esta incompleta y detente.
3. Si hay mas de 50 transcripciones, ofrece filtrar por fecha o por las N mas recientes antes de analizarlas todas.
4. Para cada transcripcion seleccionada, usa `require('.claude/workflows/lib/session-analyzer.js')` y llama a `parseTranscript(ruta)` seguido de `computeMetrics(resultado)`. Si `parseTranscript` lanza para una transcripcion concreta, saltala y sigue con las demas.
5. Presenta un resumen: cuantas transcripciones se analizaron frente a cuantas se saltaron (por fallo o por lineas malformadas), y para el conjunto analizado: coste total, duracion, cache hit rate y friccion por hook (nombre del hook, total de eventos, desglose por codigo). Si algun `computeMetrics` devolvio `unpricedModels` no vacio, antepon al coste un aviso "coste parcial: modelo X sin tarifa conocida" (uno por cada modelo distinto acumulado entre todas las transcripciones analizadas) — el total mostrado NO incluye los tokens de esos modelos, no lo presentes como si fuera el coste completo.

No calcula ni presenta metricas de concurrencia, solapamiento entre subagentes ni rafagas: la libreria asume un pipeline secuencial.

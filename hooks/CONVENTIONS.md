# Contrato de canal de salida de los hooks

Todo hook de este directorio comunica su veredicto mediante DOS senales: el
codigo de salida del proceso y, opcionalmente, texto por `stderr`. El agente
que invoca al hook solo puede reaccionar a lo que llega por esas dos senales;
cualquier otra forma de fallo (una excepcion no capturada, un `process.exit(1)`)
no llega al agente y se pierde en silencio.

## Los cuatro canales

| Codigo de salida | `stderr` | Significado | El agente... |
|---|---|---|---|
| `exit 2` | mensaje | Bloqueo correctivo | ve el mensaje y corrige antes de continuar. |
| `exit 0` | mensaje | Aviso (advisory) | ve el mensaje, no esta obligado a actuar. |
| `exit 0` | vacio | Paso silencioso | no ve nada; el hook no tenia nada que decir. |
| `exit 1` | lo que sea | Fallo del propio hook | **no ve nada.** El runtime que invoca el hook trata `exit 1` como error de la herramienta, no como veredicto: el mensaje de `stderr`, si lo hay, nunca llega al agente. |

## La regla

**Un hook que emite un veredicto (bloqueo o aviso) nunca usa `exit 1` para
emitirlo.** `exit 1` solo puede ocurrir como fallo interno no intencionado
(una dependencia que no responde, un bug) capturado en una rama de manejo de
errores explicita (`catch`) que documente por que ese fallo no puede
degradar a un veredicto normal. Fuera de esa rama, `exit 1` es indistinguible
de "el hook nunca corrio", y un `throw` sin capturar produce ese mismo
`exit 1` implicito por defecto del runtime: un hook que puede lanzar una
excepcion sin envolverla en manejo de errores viola el contrato igual que si
llamara a `process.exit(1)` directamente.

Los avisos (`exit 0` con contexto) usan **`stderr`**, nunca `stdout`, para el
mensaje legible: `stdout` queda reservado para el payload estructurado que
algunos runtimes consumen como parte de su propio protocolo de decision, y no
sustituye al mensaje humano.

## Degradacion segura

Un hook que no puede determinar su veredicto con confianza (config ausente,
dependencia no disponible, estado corrupto) nunca debe bloquear por defecto:
se degrada a paso silencioso o, como mucho, a aviso.

El punto de entrada de cada hook envuelve su logica en `runWithFailOpen`
(`sdd-hook-utils.js`), que convierte cualquier fallo interno no anticipado en
`exit 0` mas un aviso firmado por `stderr`:

```
[SDD_INTERNAL_ERROR] <hook>: <causa>
```

Asi el fallo deja de ser indistinguible de un veredicto: la firma dice que el
hook no llego a decidir nada, y quien lea la salida no cuenta un fallo de
infraestructura como un bloqueo. El veredicto deliberado no se ve afectado:
`deny()` y `warn()` terminan el proceso desde dentro, y el primer `exit` gana.

Dos limites del envoltorio, ambos por diseno del runtime:

- Un fallo que el runtime no entrega a un `catch` (falta de memoria,
  desbordamiento de pila) mata el proceso sin pasar por el envoltorio.
- Una condicion prevista no es un fallo interno: una clave ausente en la
  configuracion significa "funcion desactivada" (`exit 0` silencioso), no
  error del hook.

## Prefijo de canal y firma de veredicto

Sobre la misma línea de `stderr` conviven dos capas que no compiten:

- **`[SDD]` es el prefijo de canal.** Lo pone `emit()` (`sdd-hook-utils.js`) en
  toda línea que sale por `stderr`, sea veredicto o no. Solo dice de quién viene
  el mensaje.
- **`[SDD_<AREA>_<BLOCK|ADVISORY>]` es la firma del veredicto.** Va detrás del
  prefijo, dentro del propio motivo, y es lo que un escáner externo clasifica.
  Cada firma está declarada en `hooks/gate-signatures.json`.

Una línea de bloqueo lleva las dos: `[SDD] [SDD_PIPELINE_BLOCK] <motivo>`.

**Un aviso operativo lleva solo el prefijo, y es deliberado.** Node por debajo
del mínimo, un fichero de configuración que no es JSON válido, un valor de
`mode` no reconocido o un fallo al anotar la traza de la sesión no son
veredictos: no dicen que la acción esté bloqueada ni que haya algo que corregir
en el cambio en curso. Por eso no entran en `hooks/gate-signatures.json`, que
clasifica veredictos por severidad; registrarlos haría que un escáner contase
como decisión del gate algo que nunca lo fue.
`hooks/tests/gate-signatures.test.js` no los ve porque su patrón exige el guion
bajo (`[SDD_`), y esa es justamente la frontera entre las dos capas.

Al escribir un hook, el criterio es el destinatario del mensaje: si pide
corregir algo del cambio en curso, es un veredicto y necesita firma registrada;
si solo informa del estado del entorno o del propio hook, se queda en `[SDD]`.

## Cierre por comando

La regla que gobierna la salida de un hook gobierna tambien el cierre de
cualquier puerta de calidad: **el veredicto lo da el codigo de salida de un
comando ejecutado, nunca el informe de quien hizo el trabajo ni el texto que el
comando imprime.**

El motivo es empirico: hay casos documentados donde el auto-reporte ("tests en
verde") divergia del resultado real del comando. Quien escribe el codigo no
puede certificar sus propios tests sin circularidad — puede leer mal la salida,
pasar por alto un fallo silencioso o describir un resultado que no ocurrio.

Consecuencias practicas:

- **La puerta ejecuta el comando ella misma**, aunque el trabajo ya lo hubiera
  ejecutado antes. Una ejecucion previa no es evidencia: no consta sobre que
  arbol corrio, ni si llego a terminar.
- **El texto impreso no es veredicto.** Un arnes de tests puede imprimir `OK` y
  terminar con codigo distinto de cero; otro puede no imprimir nada y terminar
  en cero. Verde es exactamente `exit 0`.
- **Sin codigo de salida no hay verde.** Un comando que agota su tiempo limite,
  que muere por una senal o que no llega a arrancar no devuelve codigo: cuenta
  como rojo. Toda ejecucion de la puerta lleva su propio tiempo limite, para que
  una suite colgada termine en rojo y no en espera indefinida.
- **La ausencia de comando de test es una condicion aparte**, ni pase ni rojo de
  la suite: bloquea si el cambio toca codigo ejecutable (no hay forma de
  probarlo) y se degrada a aviso si solo toca documentacion o configuracion,
  coherente con la degradacion segura de la seccion anterior.

Un criterio de exito redactado como "se confirma que los tests pasan" no es
verificable. Su forma verificable nombra el comando concreto y el codigo de
salida que se espera de el.

## Presupuesto de contexto de los documentos de instrucciones raiz

Los documentos de instrucciones raiz (uno por backend) se cargan enteros al
abrir sesion: su tamano es coste fijo de contexto, pagado antes de la primera
instruccion del usuario. Crecen un poco en cada cambio y nadie lo nota, hasta
que el modelo empieza a perder instrucciones por saturacion.

**Limite por documento: 300 lineas y 25600 bytes (25 KB).** Se comprueba con

```
node --test tests/context-budget.test.js; echo $?
```

y, por la regla de la seccion anterior, el veredicto es ese codigo de salida:
`0` y nada mas. El test imprime lineas y bytes de cada documento aunque pase,
para que la tendencia sea visible antes de tocar el limite.

**Por que dos ejes.** Las lineas solas no bastan: una tabla ancha o un parrafo
largo anaden bytes sin anadir lineas, y el coste real de contexto se paga en
tokens, que siguen a los bytes (~1 token por cada 4 bytes), no a los saltos de
linea. Medir solo lineas deja pasar exactamente el caso que mas engorda el
contexto. El conteo de lineas coincide con `wc -l`, para que la cifra del test
y la que ve una persona en la terminal sean la misma.

**Las rutas no se escriben en el test.** Los documentos raiz son salidas
generadas declaradas en el manifiesto de artefactos; el test las lee de ahi. Si
cambia el destino de un documento, o se anade un backend, el manifiesto es el
unico sitio que se toca.

**Relacion con el presupuesto de `ai_docs/core/`.** Son presupuestos distintos
sobre conjuntos de ficheros disjuntos, no dos criterios para lo mismo:
`ai_docs/core/` declara el suyo en su propio `README.md` (limite de directorio,
medido en lineas) y sigue siendo la autoridad sobre ese directorio; este limita
cada documento raiz por separado. Lo que comparten es la unidad de coste: bytes
convertidos a tokens con la misma equivalencia. Una observacion, no un cambio:
el presupuesto de `ai_docs/core/` mide un solo eje y por tanto es ciego al caso
de lineas largas descrito arriba; si algun dia se endurece, ahi esta la grieta.

**Superar el limite se resuelve partiendo o comprimiendo el documento, no
subiendo el numero.** Subir el limite es una decision que necesita su propia
justificacion escrita: sin ella, el presupuesto solo documenta el crecimiento
en lugar de contenerlo.

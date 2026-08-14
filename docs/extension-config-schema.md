# `sdd.config.json` — configuracion propia del proyecto

Punto de extension para un proyecto que necesite configuracion adicional a la que trae
el framework: destino distinto para la auditoria, campos propios en el registro de
sesiones, superficies internas, servidores declarados.

**El fichero es opcional y casi ningun proyecto lo necesita.** Sin el, el framework opera
exactamente igual que si esta capa no existiera: ninguna clave es obligatoria y ninguna
ausencia produce un aviso.

Este documento se instala con el framework en `docs/extension-config-schema.md` y se actualiza
con el, porque los hooks lo citan por esa ruta cuando algo de esta capa necesita explicacion.

## Por que este fichero y no una edicion directa

`sdd.config.json` vive en la raiz de tu proyecto y **no forma parte de lo que el framework
distribuye**. Esa es toda su razon de ser: al actualizar, el framework reescribe sus propios
ficheros — hooks, agentes, comandos, plantillas — y nunca toca este. La configuracion propia
sobrevive a la actualizacion.

La alternativa sin este fichero seria editar un fichero distribuido, que la siguiente
actualizacion sobrescribe, o bifurcar el repositorio y cargar con el coste de fusionar cada
version nueva. Con `sdd.config.json` no hace falta ninguna de las dos cosas.

Versionalo con tu proyecto si la configuracion es del equipo; dejalo fuera del control de
versiones si es de una maquina concreta.

## Ubicacion

```
tu-proyecto/
├── sdd.config.json      <- aqui, junto a la raiz del repositorio
├── ai_docs/
├── hooks/
└── ...
```

La raiz se localiza igual que el resto de rutas del framework: subiendo hasta el
repositorio que contiene el proyecto. En un proyecto sin control de versiones, el
directorio de trabajo hace de raiz.

## Esquema

Todas las claves son opcionales. Ninguna tiene que aparecer, y el orden no importa.

| Clave | Tipo | Estado | Que hace |
|---|---|---|---|
| `audit.provenance_dest` | texto | **activa** | Destino del registro de sesiones, en lugar de `ai_docs/audits/provenance.jsonl`. |
| `audit.extra_fields` | objeto | **activa** | Campos propios que se anaden a cada linea del registro de sesiones. |
| `mcp_servers` | lista de objetos | declarativa | Servidores que el proyecto declara. Se leen; el framework no se conecta a ninguno. |
| `extra_surfaces` | lista de textos | declarativa | Rutas de hooks o agentes propios del proyecto. Se leen; el framework no los carga. |
| `model_override` | objeto | declarativa | Modelo por defecto por backend. Se lee; el framework no lo aplica. |

**Activa** significa que el framework la consume hoy. **Declarativa** significa que el
esquema la reconoce y la transporta, pero ninguna funcion la usa todavia: sirve para que un
proyecto declare su intencion en un solo sitio y para que la integracion, cuando llegue, no
cambie el formato del fichero. Declarar una clave declarativa hoy no produce ningun efecto
observable.

### Ejemplo completo

```json
{
  "audit": {
    "provenance_dest": "registro/sesiones.jsonl",
    "extra_fields": {
      "equipo": "plataforma",
      "entorno": "produccion",
      "centro_de_coste": "PLT-114"
    }
  },
  "mcp_servers": [
    { "name": "catalogo-interno", "url": "https://mcp.ejemplo.internal/catalogo", "auth_type": "oauth" }
  ],
  "extra_surfaces": [
    ".interno/hooks/politica-de-datos.js"
  ],
  "model_override": {
    "claude": "claude-opus-4-8"
  }
}
```

### `audit.provenance_dest`

Ruta del fichero donde se anade una linea por cada arranque de sesion. Una ruta relativa se
situa contra la raiz del proyecto; una absoluta se respeta tal cual.

Una ruta relativa que se escape de la raiz del proyecto (`../fuera/registro.jsonl`) se
descarta y el registro vuelve a su destino por defecto: una configuracion mal escrita no
dirige escrituras a cualquier punto del disco.

La variable de entorno `SDD_PROVENANCE_FILE`, si esta definida, tiene prioridad sobre esta
clave — es el override puntual de una invocacion concreta.

Esta clave cambia el **destino** del registro, no si se escribe. Para que no se escriba nada,
pon `sdd_session_start.enabled: false` en `hooks/config.json`: apagado, el hook no crea el
fichero ni anade la linea.

### `audit.extra_fields`

Pares nombre-valor que se anaden a cada linea del registro de sesiones. Util para atribuir
sesiones a un equipo, un entorno o un centro de coste sin tocar el codigo del framework.

Dos limites, para que la linea siga siendo legible por quien ya la consume:

- Los campos propios van **detras** de los campos estandar, nunca intercalados.
- Un nombre que colisione con un campo estandar **se descarta**: gana el estandar. Sin esta
  regla, una configuracion podria sustituir el identificador de sesion por otra cosa y la
  linea seguiria pareciendo valida mientras dice algo distinto de lo que se cree leer.

Los valores no se interpretan ni se validan: se transportan tal cual.

## Que ocurre cuando algo va mal

Ninguno de estos casos interrumpe una sesion.

| Situacion | Comportamiento |
|---|---|
| El fichero no existe | Silencio total. Es el caso normal, no una carencia. |
| JSON invalido | Aviso por `stderr` con la firma `[SDD_EXTENSION_ADVISORY]` y la causa; el framework sigue con sus valores por defecto. |
| La raiz no es un objeto (una lista, un texto) | Igual que el JSON invalido. |
| Claves que este framework no conoce | Se ignoran en silencio. Una version futura del esquema no rompe una instalacion anterior. |
| Una clave conocida con el tipo equivocado | Se ignora esa clave; el resto del fichero se aplica igual. |

El aviso de configuracion ilegible no es un veredicto de ninguna puerta de calidad: no
bloquea nada y el codigo de salida sigue siendo `0`. Aparece porque callar seria peor —
creerias que tu configuracion esta activa mientras el framework corre con los valores por
defecto, y la diferencia solo se notaria mucho despues.

## Leerlo desde codigo propio

`hooks/sdd-plan-state.js` exporta el lector:

```js
const { loadExtensionConfig } = require('./hooks/sdd-plan-state');

const config = loadExtensionConfig();
const equipo = (config.audit && config.audit.extra_fields || {}).equipo;
```

Devuelve siempre un objeto — `{}` cuando no hay configuracion — asi que nunca hay que
comprobar si el fichero existe. Cada clave se pide por su nombre, y lo que no se pide viaja
inerte: por eso una clave desconocida no puede romper nada.

El fichero se lee una sola vez por proceso; las llamadas siguientes devuelven lo mismo sin
volver al disco.

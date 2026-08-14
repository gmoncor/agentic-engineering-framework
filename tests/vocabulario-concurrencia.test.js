'use strict';

// Canario de vocabulario sobre las superficies que se INSTALAN en un proyecto.
//
// El framework implementa una task tras otra por defecto y ofrece la ejecucion
// concurrente a peticion explicita de quien invoca. Eso deja dos afirmaciones
// falsas que ninguna superficie distribuida puede hacer:
//
//   - imponer el trabajo secuencial como si fuera la unica forma posible
//     ("se ejecutan en secuencia, no en paralelo");
//   - declarar que la concurrencia no existe o no se contempla
//     ("la libreria asume un pipeline secuencial").
//
// POR QUE ESTE TEST Y NO EL COMPILADOR: `scripts/compile.js` solo compara las
// salidas `mode: "managed"` con su fuente. Las entradas `mode: "preserve"` se
// editan a mano en su propia ruta y el compilador no las mira nunca, asi que un
// cambio de direccion aplicado en las fuentes puede dejarlas atras sin que nada
// lo note. Las tres afirmaciones que motivaron este canario vivian justo ahi.
// Y el compilador tampoco basta para las salidas generadas: comprueba que
// coinciden con su fuente, no lo que dicen. Una redaccion prohibida escrita en
// la fuente se propaga a todos los backends con el gate de deriva en verde.
//
// QUE SE ESCANEA: el conjunto de rutas de `scripts/backend-manifest.json`, que
// es la SSOT de lo que cada backend copia al proyecto destino. Usarlo (en vez de
// una lista propia) hace que una superficie nueva entre en cobertura el mismo dia
// que entra en el manifiesto de instalacion.
//
// QUE NO SE ESCANEA, Y POR QUE:
//   - Las versiones ya publicadas de CHANGELOG.md. Una entrada de changelog
//     describe en pasado lo que se hizo entonces; reescribir el historial para
//     que suene al producto de hoy seria falsearlo. La seccion Unreleased SI se
//     escanea: son las notas que se publican en la proxima version.
//   - Cualquier ruta bajo un directorio `tests/`: un fixture cita a proposito la
//     redaccion prohibida para comprobar que se detecta.
//
// QUE NO ES UN HALLAZGO: describir el modo lineal como el modo POR DEFECTO. "una
// task a la vez", "modo secuencial (defecto)" o "implementacion lineal por
// defecto" son la descripcion correcta del producto y ninguno de los patrones de
// abajo los toca.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const MANIFIESTO_BACKENDS = path.join(RAIZ, 'scripts', 'backend-manifest.json');

/** Extensiones con prosa que un agente lee o que un usuario ve. El resto (binarios, .sh) no se escanea. */
const EXTENSIONES = new Set(['.md', '.toml', '.json', '.js', '.rules']);

/** Segmentos de ruta que nunca entran en el escaneo. */
const DIRECTORIOS_EXCLUIDOS = new Set(['tests', 'node_modules', '.git']);

/**
 * Hueco de hasta `n` caracteres entre dos partes de un patron. Se detiene en el
 * punto (fin de la afirmacion) y solo cruza un salto de linea si la linea
 * siguiente continua el mismo parrafo: sin esto, la prosa envuelta a 100 columnas
 * esconde la mitad de las coincidencias, y con un cruce sin condicion dos filas
 * de tabla o dos bullets contiguos se leen como una sola frase.
 */
function hueco(n) {
  return `(?:[^.\\n]|\\n(?!\\s*(?:[-*+>#]|\\d+\\.|\\|))){0,${n}}`;
}

const PARALELO = '(?:en\\s+paralelo|a\\s+la\\s+vez|simultanea\\w*|concurrentemente|de\\s+forma\\s+concurrente)';
const CUALQUIER_CONCURRENCIA = '(?:paralel\\w*|concurren\\w*|simultane\\w*|a\\s+la\\s+vez)';

/**
 * Cada patron describe una afirmacion concreta que el producto ya no sostiene.
 * `arreglo` es lo que hay que escribir en su lugar; se imprime en el fallo para
 * que quien lo vea no tenga que venir a leer este archivo.
 */
const PATRONES = [
  {
    nombre: 'negacion-directa',
    re: new RegExp('\\b(?:no|nunca|jamas|ni)\\s+en\\s+paralelo\\b', 'gi'),
    arreglo: 'Di que el paso no depende del orden, no que este prohibido lanzarlo a la vez.',
  },
  {
    nombre: 'negacion-de-verbo',
    re: new RegExp(
      '\\b(?:no|nunca|jamas)\\s+(?:se\\s+)?(?:l[oa]s?\\s+)?'
      + '(?:lanza|lanzan|lances|ejecuta|ejecutan|ejecutes|implementa|implementan|implementes'
      + '|revisa|revisan|revises|corra|corran|corras|paraleliza|paralelices)\\w*'
      + hueco(40) + '\\b' + PARALELO + '\\b',
      'gi'
    ),
    arreglo: 'El framework no prohibe la ejecucion concurrente: la ofrece a peticion explicita.',
  },
  {
    nombre: 'secuencial-impuesto',
    re: new RegExp(
      '\\b(?:estrictamente\\s+secuencial|secuencial\\s+estrict\\w+|siempre\\s+secuencial'
      + '|solo\\s+secuencial|unicamente\\s+secuencial|puramente\\s+secuencial'
      + '|obligatoriamente\\s+secuencial|forzosamente\\s+secuencial|secuencial\\s+por\\s+obligacion)\\b',
      'gi'
    ),
    arreglo: 'El trabajo secuencial es el modo por defecto, no una obligacion: escribe "por defecto".',
  },
  {
    nombre: 'secuencial-asumido',
    re: new RegExp('\\basume\\s+(?:un|una)\\s+\\w+\\s+secuencial\\b', 'gi'),
    arreglo: 'Describe el alcance real del componente en vez de atribuirle un modelo de ejecucion.',
  },
  {
    nombre: 'concurrencia-inexistente',
    re: new RegExp(
      '\\b(?:no|nunca|jamas)\\s+(?:hay|existe|existen|permite|permiten|admite|admiten'
      + '|soporta|soportan|contempla|contemplan)\\b'
      + hueco(40) + '\\b' + CUALQUIER_CONCURRENCIA + '\\b',
      'gi'
    ),
    arreglo: 'La ejecucion concurrente existe y se pide de forma explicita; no la declares ausente.',
  },
  {
    nombre: 'prohibicion-explicita',
    re: new RegExp(
      '\\b(?:prohibid[oa]s?|vetad[oa]s?|no\\s+esta\\s+permitido)\\b'
      + hueco(60) + '\\b' + CUALQUIER_CONCURRENCIA + '\\b',
      'gi'
    ),
    arreglo: 'Quien invoca decide el modo; ninguna superficie del framework lo prohibe.',
  },
  {
    nombre: 'sin-paralelismo',
    re: new RegExp('\\bsin\\s+(?:paralelismo|concurrencia|ejecucion\\s+concurrente)\\b', 'gi'),
    arreglo: 'Nombra lo que el componente si hace en vez de negar la concurrencia.',
  },
];

/** Minusculas y sin diacriticos: el corpus mezcla prosa acentuada y sin acentuar. */
function normalizar(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Hallazgos de `texto`: `{ patron, linea, fragmento, arreglo }` por coincidencia.
 * Es la unica puerta de deteccion, asi que los controles de abajo la ejercitan
 * con las frases reales que hubo que corregir y con las que deben pasar.
 */
function detectar(texto) {
  const normalizado = normalizar(texto);
  const hallazgos = [];

  for (const patron of PATRONES) {
    patron.re.lastIndex = 0;
    let match;
    while ((match = patron.re.exec(normalizado)) !== null) {
      hallazgos.push({
        patron: patron.nombre,
        linea: normalizado.slice(0, match.index).split('\n').length,
        fragmento: match[0].replace(/\s+/g, ' ').trim(),
        arreglo: patron.arreglo,
      });
      if (match[0].length === 0) patron.re.lastIndex += 1;
    }
  }

  return hallazgos;
}

// ── Conjunto de superficies distribuidas ─────────────────────────────────────

/** Todas las rutas relativas que algun backend copia al proyecto destino. */
function rutasDelManifiesto() {
  const manifiesto = JSON.parse(fs.readFileSync(MANIFIESTO_BACKENDS, 'utf8'));
  const rutas = new Set();

  const anadir = valor => {
    if (typeof valor === 'string') rutas.add(valor);
    else if (Array.isArray(valor)) valor.forEach(anadir);
    else if (valor && typeof valor === 'object') Object.values(valor).forEach(anadir);
  };

  anadir(manifiesto);
  // Las entradas `optional` del backend Claude son `{ nombre, rutas }`: el
  // recorrido de arriba mete tambien el nombre de la capacidad, que no es ruta.
  return [...rutas].filter(ruta => fs.existsSync(path.join(RAIZ, ruta)));
}

/** Ficheros con prosa bajo `rutaRelativa` (un archivo o un directorio), sin los excluidos. */
function ficherosDe(rutaRelativa) {
  const absoluta = path.join(RAIZ, rutaRelativa);
  if (!fs.statSync(absoluta).isDirectory()) {
    return EXTENSIONES.has(path.extname(rutaRelativa)) ? [rutaRelativa] : [];
  }

  const encontrados = [];
  for (const entrada of fs.readdirSync(absoluta, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (DIRECTORIOS_EXCLUIDOS.has(entrada.name)) continue;
      encontrados.push(...ficherosDe(path.join(rutaRelativa, entrada.name)));
    } else if (EXTENSIONES.has(path.extname(entrada.name))) {
      encontrados.push(path.join(rutaRelativa, entrada.name));
    }
  }
  return encontrados;
}

function superficiesDistribuidas() {
  const ficheros = new Set();
  for (const ruta of rutasDelManifiesto()) {
    for (const fichero of ficherosDe(ruta)) {
      if (!fichero.split(path.sep).some(seg => DIRECTORIOS_EXCLUIDOS.has(seg))) ficheros.add(fichero);
    }
  }
  return [...ficheros].sort();
}

/**
 * Texto a escanear de un fichero. Para CHANGELOG.md, solo la seccion Unreleased:
 * las versiones publicadas son historial y se escribieron en pasado.
 */
function textoEscaneable(rutaRelativa, contenido) {
  if (path.basename(rutaRelativa) !== 'CHANGELOG.md') return contenido;

  const inicio = contenido.indexOf('## [Unreleased]');
  if (inicio === -1) return '';
  const siguiente = contenido.indexOf('\n## [', inicio + 1);
  return siguiente === -1 ? contenido.slice(inicio) : contenido.slice(inicio, siguiente);
}

// ── El barrido ───────────────────────────────────────────────────────────────

test('el barrido cubre las superficies manuales que el compilador no verifica', () => {
  const ficheros = superficiesDistribuidas();

  // Sin esta comprobacion, un manifiesto ilegible o un filtro demasiado estrecho
  // dejarian el barrido vacio y en verde.
  assert.ok(ficheros.length > 40, `el barrido solo encontro ${ficheros.length} ficheros distribuidos`);

  for (const manual of ['.claude/skills/auditar-sesion/SKILL.md', '.codex/rules/sdd-enforcement.rules']) {
    assert.ok(
      ficheros.includes(manual.split('/').join(path.sep)),
      `${manual} es una superficie de edicion manual (mode: "preserve") y debe entrar en el barrido`
    );
  }
});

test('ninguna superficie distribuida impone el trabajo secuencial ni descarta la concurrencia', () => {
  const hallazgos = [];

  for (const fichero of superficiesDistribuidas()) {
    const contenido = fs.readFileSync(path.join(RAIZ, fichero), 'utf8');
    for (const h of detectar(textoEscaneable(fichero, contenido))) {
      hallazgos.push(`${fichero}:${h.linea} [${h.patron}] "${h.fragmento}" -> ${h.arreglo}`);
    }
  }

  assert.deepStrictEqual(
    hallazgos,
    [],
    'Superficies distribuidas que afirman una restriccion de trabajo secuencial:\n'
      + hallazgos.join('\n')
      + '\nEl framework implementa una task tras otra POR DEFECTO y ofrece la ejecucion '
      + 'concurrente a peticion explicita de quien invoca. Describe el modo por defecto; '
      + 'no lo impongas ni declares ausente la concurrencia.'
  );
});

// ── Controles del detector ───────────────────────────────────────────────────
//
// Un barrido en verde no prueba nada si el detector no detecta. Estas dos
// baterias lo atan por los dos lados: las frases que hubo que retirar tienen que
// caer, y la descripcion correcta del modo por defecto tiene que pasar.

const REGRESIONES = [
  {
    de: 'docs-src/skills/planificar.md',
    texto: 'Revisa cada task con el agente `revisor`, una tras otra: ninguna revision necesita el resultado\n'
      + 'de otra, pero se ejecutan en secuencia, no en paralelo.',
  },
  {
    de: '.claude/skills/auditar-sesion/SKILL.md',
    texto: 'No calcula ni presenta metricas de concurrencia, solapamiento entre subagentes ni rafagas:'
      + ' la libreria asume un pipeline secuencial.',
  },
  {
    de: 'redaccion equivalente con la frase envuelta entre lineas',
    texto: 'Lanza la revision de cada task una despues de otra; estas revisiones\nno se ejecutan en paralelo.',
  },
  {
    de: 'prohibicion en el otro sentido',
    texto: 'Prohibido implementar dos tasks del mismo nivel de forma concurrente.',
  },
];

for (const regresion of REGRESIONES) {
  test(`control positivo: se detecta la redaccion retirada de ${regresion.de}`, () => {
    const hallazgos = detectar(regresion.texto);
    assert.ok(
      hallazgos.length > 0,
      `el detector dejo pasar una restriccion de trabajo secuencial: ${JSON.stringify(regresion.texto)}`
    );
  });
}

const REDACCIONES_LEGITIMAS = [
  'Implementacion lineal por defecto: una task tras otra en orden de dependencias.'
    + ' La ejecucion concurrente existe y se pide de forma explicita.',
  '### Modo secuencial (defecto)\n\nEl workflow implementa 01, luego 02, luego 03,'
    + ' cada una completa antes de arrancar la siguiente.',
  'Por defecto el framework trabaja una task a la vez: se implementa, se revisa y se commitea'
    + ' antes de empezar la siguiente, y no necesita ningun flag.',
  'Tests de contrato para instalacion secuencial de varios backends en el mismo proyecto.',
  'El framework lanza a la vez las tasks de un nivel y reporta el resultado de cada una.'
    + ' No hay un unico escritor por fichero, y no detecta colisiones entre tasks hermanas.',
  'Son puertas de calidad, no de paralelizacion: se aplican por task en los dos modos.',
  'Las tasks de un nivel pueden ejecutarse en paralelo si quien invoca lo pide con --parallel.',
];

for (const legitima of REDACCIONES_LEGITIMAS) {
  test(`control negativo: pasa la redaccion correcta "${legitima.slice(0, 52)}..."`, () => {
    assert.deepStrictEqual(
      detectar(legitima),
      [],
      'el detector marco como restriccion una descripcion correcta del modo por defecto'
    );
  });
}

// ── Descripcion publica de los manifiestos ───────────────────────────────────
//
// `package.json` y `gemini-extension.json` no son prosa interna: su descripcion
// es lo que se lee en el registro de paquetes y en el listado de extensiones,
// antes de instalar nada. Ninguno de los dos entra en el barrido de arriba
// (`package.json` no se copia al destino, y una descripcion de una linea no
// tiene sitio para el matiz completo), asi que se comprueban aparte.

for (const manifiesto of ['package.json', 'gemini-extension.json']) {
  test(`${manifiesto} presenta el modo lineal como el modo por defecto`, () => {
    const { description } = JSON.parse(fs.readFileSync(path.join(RAIZ, manifiesto), 'utf8'));
    assert.ok(description, `${manifiesto} no declara description`);

    const normalizada = normalizar(description);
    assert.deepStrictEqual(detectar(description), [], `${manifiesto} impone el trabajo secuencial`);

    if (/\b(lineal|secuencial)\b/.test(normalizada)) {
      assert.match(
        normalizada,
        /\b(lineal|secuencial)\b[^.]{0,20}por\s+defecto/,
        `${manifiesto} describe el modelo de trabajo como lineal sin calificarlo de "por defecto".`
          + ' Es la primera frase que lee quien no conoce el producto: la ejecucion concurrente'
          + ' existe y se pide de forma explicita.'
      );
    }
  });
}

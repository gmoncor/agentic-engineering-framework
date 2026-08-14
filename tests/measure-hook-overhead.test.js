'use strict';

// Canario del instrumento que mide el coste de los hooks por llamada a herramienta.
//
// `scripts/measure-hook-overhead.js` declara a mano, en su tabla `WIRING`, que hooks
// corren en una llamada a cada herramienta. Ese emparejamiento ya vive en el fichero de
// configuracion del backend (`.claude/settings.json`), que es lo que el cliente ejecuta
// de verdad. Son dos copias del mismo dato y nada las ataba: hoy coinciden, y el dia que
// una cambie el instrumento seguira dando cifras -- de un cableado que ya no existe. Una
// medicion equivocada es peor que ninguna, porque se publica con la misma confianza.
//
// El instrumento no se puede importar para leer su tabla: al cargarlo arranca la
// medicion completa (invoca su `main()` en el cuerpo del modulo, y esa medicion lanza
// un proceso por hook y por muestra). Asi que la declaracion se lee de su fuente.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const INSTRUMENTO = 'scripts/measure-hook-overhead.js';
const WIRING_DEL_BACKEND = '.claude/settings.json';

// Evento por llamada a herramienta. Los eventos de ciclo de vida (una vez por sesion)
// no entran: el instrumento mide coste por llamada, y un hook de arranque no lo paga.
const EVENTO_POR_LLAMADA = 'PreToolUse';

// Suelo de la comparacion: sin herramientas en la tabla, el bucle no compara nada y el
// canario pasa en verde sobre un instrumento que no mide.
const MIN_HERRAMIENTAS = 3;

function leer(rutaRelativa) {
  return fs.readFileSync(path.join(RAIZ, rutaRelativa), 'utf8');
}

/** La tabla `WIRING` que el instrumento declara a mano, leida de su fuente. */
function wiringDeclarado() {
  const literal = leer(INSTRUMENTO).match(/const WIRING = (\{[\s\S]*?\n\});/);
  assert.ok(literal, `${INSTRUMENTO} ya no declara una tabla WIRING: este canario quedo sin objeto`);
  return vm.runInNewContext(`(${literal[1]})`);
}

/** Nombre del fichero de hook que invoca un comando cableado. */
function hookDelComando(comando) {
  const encontrado = String(comando || '').match(/([\w.-]+\.js)/);
  return encontrado ? encontrado[1] : null;
}

/**
 * Hooks que el fichero de wiring hace correr en una llamada a `herramienta`, en orden
 * alfabetico. Un matcher ausente equivale a `*` (el grupo se activa en cada llamada),
 * igual que en los demas backends.
 */
function hooksCableadosPara(settings, herramienta) {
  const grupos = (settings.hooks || {})[EVENTO_POR_LLAMADA] || [];
  const nombres = [];
  for (const grupo of grupos) {
    const matcher = grupo.matcher === undefined ? '*' : grupo.matcher;
    if (matcher !== '*' && !matcher.split('|').includes(herramienta)) continue;
    for (const hook of grupo.hooks || []) {
      const nombre = hookDelComando(hook.command);
      if (nombre) nombres.push(nombre);
    }
  }
  return nombres.sort();
}

test('el instrumento mide el cableado que el backend ejecuta de verdad', () => {
  const wiring = wiringDeclarado();
  const settings = JSON.parse(leer(WIRING_DEL_BACKEND));
  const herramientas = Object.keys(wiring);

  assert.ok(
    herramientas.length >= MIN_HERRAMIENTAS,
    `la tabla de ${INSTRUMENTO} declara ${herramientas.length} herramientas, minimo ${MIN_HERRAMIENTAS}: `
      + 'una tabla vacia no compara nada'
  );

  for (const herramienta of herramientas) {
    const cableados = hooksCableadosPara(settings, herramienta);
    assert.ok(
      cableados.length >= 1,
      `${herramienta} no aparece en ningun grupo ${EVENTO_POR_LLAMADA} de ${WIRING_DEL_BACKEND}: `
        + 'el instrumento mide una herramienta que nadie cablea'
    );
    assert.deepStrictEqual(
      [...wiring[herramienta]].sort(),
      cableados,
      `${INSTRUMENTO} y ${WIRING_DEL_BACKEND} no dicen lo mismo sobre ${herramienta}. `
        + 'Mientras difieran, las cifras del instrumento son de un cableado que no existe.'
    );
  }
});

test('cada hook que el instrumento mide existe en disco', () => {
  const wiring = wiringDeclarado();

  for (const [herramienta, hooks] of Object.entries(wiring)) {
    assert.ok(hooks.length >= 1, `${herramienta} no declara ningun hook que medir`);
    for (const hook of hooks) {
      assert.ok(
        fs.existsSync(path.join(RAIZ, 'hooks', hook)),
        `${INSTRUMENTO} mide ${hook} en ${herramienta}, y ese fichero no esta en hooks/`
      );
    }
  }
});

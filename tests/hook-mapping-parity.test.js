'use strict';

// Verifica que el mapeo canonico de scripts/hook-event-mapping.json coincide con
// lo que cada fichero de wiring realmente cablea. El mapeo vivia solo en
// comentarios `_comment` sueltos: nada detectaba cuando un matcher se editaba en
// un backend y no se portaba a los demas. Este test cierra ese hueco leyendo los
// cuatro ficheros de wiring reales, no una copia.
//
// Cubre las DOS familias del mapeo, porque el hueco es el mismo en ambas:
//   - `actions`: hooks por tool-call, con matcher de herramienta.
//   - `lifecycle_events`: hooks de ciclo de vida (una vez por sesión), sin
//     matcher de herramienta y con el nombre de evento declarado por backend.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const MAPEO = require('../scripts/hook-event-mapping.json');

const FICHERO_DE_WIRING = {
  claude: '.claude/settings.json',
  gemini: 'hooks/hooks.json',
  codex: '.codex/hooks.json',
  antigravity: '.agents/hooks.json'
};

/** Lee y parsea un fichero de wiring; null si no existe en disco. */
function cargarWiring(backend) {
  const ruta = path.join(RAIZ, FICHERO_DE_WIRING[backend]);
  if (!fs.existsSync(ruta)) return null;
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

/**
 * Aplana un fichero de wiring a entradas { event, matcher, commands }, sin
 * asumir donde vive el objeto evento->lista: en claude/gemini/codex cuelga de
 * `hooks`; en antigravity cada hook tiene su propia clave de nivel superior.
 * Tratar ambos casos como "una lista de grupos evento->lista" cubre los cuatro.
 */
function entradasDe(wiring) {
  const grupos = wiring.hooks
    ? [wiring.hooks]
    : Object.values(wiring).filter(v => v && typeof v === 'object' && !Array.isArray(v));

  const entradas = [];
  for (const grupo of grupos) {
    for (const [event, lista] of Object.entries(grupo)) {
      if (!Array.isArray(lista)) continue;
      for (const item of lista) {
        const commands = (item.hooks || []).map(h => h.command || '');
        entradas.push({ event, matcher: item.matcher, commands });
      }
    }
  }
  return entradas;
}

/**
 * Matcher comparable: omitir la clave y dejarla en `null` significan lo mismo en
 * los cuatro backends (el grupo se activa en cada ocurrencia del evento), así que
 * un wiring correcto no puede fallar el canario por esa diferencia de escritura.
 */
function matcherDe(entrada) {
  return entrada.matcher === undefined ? null : entrada.matcher;
}

for (const backend of Object.keys(FICHERO_DE_WIRING)) {
  test(`paridad de wiring: ${backend}`, () => {
    const wiring = cargarWiring(backend);
    assert.ok(wiring, `${FICHERO_DE_WIRING[backend]} no existe en disco: no se puede verificar el wiring de ${backend}`);

    const entradas = entradasDe(wiring);

    for (const [accion, porBackend] of Object.entries(MAPEO.actions)) {
      const esperado = porBackend[backend];

      if (esperado.wired) {
        const encontrado = entradas.some(e =>
          e.event === MAPEO.events[backend]
          && e.matcher === esperado.matcher
          && e.commands.some(cmd => cmd.includes(esperado.hook_file))
        );
        assert.ok(
          encontrado,
          `${backend}: falta "${accion}" en ${FICHERO_DE_WIRING[backend]} `
            + `(esperado evento=${MAPEO.events[backend]}, matcher="${esperado.matcher}", hook="${esperado.hook_file}")`
        );
      } else {
        // Canario inverso: si alguien cablea por error una accion marcada como
        // no soportada en este backend, el test debe atraparlo.
        const cableadaPorError = entradas.some(e => e.commands.some(cmd => cmd.includes(esperado.hook_file)));
        assert.ok(
          !cableadaPorError,
          `${backend}: "${accion}" esta marcada wired:false en el SSOT pero `
            + `${FICHERO_DE_WIRING[backend]} la cablea. Motivo documentado: ${MAPEO.notes[accion] || '(sin nota)'}`
        );
      }
    }
  });
}

test('el SSOT cubre las 5 acciones canonicas para los 4 backends', () => {
  const backends = Object.keys(FICHERO_DE_WIRING);
  const acciones = Object.keys(MAPEO.actions);
  assert.strictEqual(acciones.length, 5, `se esperaban 5 acciones canonicas, hay ${acciones.length}`);
  for (const accion of acciones) {
    assert.deepStrictEqual(
      Object.keys(MAPEO.actions[accion]).sort(),
      [...backends].sort(),
      `"${accion}" no declara los 4 backends en scripts/hook-event-mapping.json`
    );
  }
});

// --- Eventos de ciclo de vida --------------------------------------------------
//
// Mismo contrato que las acciones, con dos diferencias: el nombre del evento lo
// declara cada backend en su propia entrada (no la tabla `events`, que es por
// tool-call) y no hay matcher de herramienta. Un backend AUSENTE de la entrada se
// trata como no cableado, igual que `wired: false`: el canario inverso vigila que
// nadie lo cablee sin declararlo primero en el mapeo.
for (const backend of Object.keys(FICHERO_DE_WIRING)) {
  test(`paridad de wiring (ciclo de vida): ${backend}`, () => {
    const wiring = cargarWiring(backend);
    assert.ok(wiring, `${FICHERO_DE_WIRING[backend]} no existe en disco: no se puede verificar el wiring de ${backend}`);

    const entradas = entradasDe(wiring);

    for (const [accion, porBackend] of Object.entries(MAPEO.lifecycle_events)) {
      const esperado = porBackend[backend];

      if (esperado && esperado.wired) {
        const encontrado = entradas.some(e =>
          e.event === esperado.event
          && matcherDe(e) === (esperado.matcher ?? null)
          && e.commands.some(cmd => cmd.includes(esperado.hook_file))
        );
        assert.ok(
          encontrado,
          `${backend}: falta "${accion}" en ${FICHERO_DE_WIRING[backend]} `
            + `(esperado evento=${esperado.event}, matcher=${JSON.stringify(esperado.matcher ?? null)}, hook="${esperado.hook_file}")`
        );
      } else {
        const hookFile = (esperado && esperado.hook_file) || `sdd-${accion}`;
        const cableadaPorError = entradas.some(e => e.commands.some(cmd => cmd.includes(hookFile)));
        assert.ok(
          !cableadaPorError,
          `${backend}: "${accion}" no consta cableada en el SSOT pero `
            + `${FICHERO_DE_WIRING[backend]} la cablea. Motivo documentado: ${MAPEO.notes_lifecycle_events[accion] || '(sin nota)'}`
        );
      }
    }
  });
}

test('el SSOT declara cada evento de ciclo de vida con su evento nativo y su hook', () => {
  const backends = new Set(Object.keys(FICHERO_DE_WIRING));
  const acciones = Object.entries(MAPEO.lifecycle_events);
  assert.ok(acciones.length >= 1, 'el SSOT no declara ningún evento de ciclo de vida');

  for (const [accion, porBackend] of acciones) {
    for (const [backend, decl] of Object.entries(porBackend)) {
      assert.ok(backends.has(backend), `"${accion}" declara el backend desconocido "${backend}"`);
      assert.ok(decl.event, `"${accion}" no declara el nombre del evento nativo de ${backend}`);
      assert.ok(decl.hook_file, `"${accion}" no declara hook_file para ${backend}`);
    }
    // Un backend sin entrada queda fuera del cableado, y eso es una decisión que
    // se explica: sin nota, la omisión es indistinguible de un olvido.
    const sinDeclarar = [...backends].filter(b => !porBackend[b]);
    if (sinDeclarar.length) {
      assert.ok(
        MAPEO.notes_lifecycle_events[accion],
        `"${accion}" no declara ${sinDeclarar.join(', ')} y no hay nota que explique la omisión`
      );
    }
  }
});

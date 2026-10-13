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

// --- Codex: esquema de claves, lanzador y matchers frente a lo medido ----------
//
// codex-cli 0.162.1 descarta `.codex/hooks.json` ENTERO ante una clave que no
// conoce («unknown field _comment, expected description or hooks»), ejecuta los
// hooks con el cwd en el subdirectorio donde trabaja el agente y entrega el shell
// como `tool_name: "Bash"`. Los casos de abajo fijan las tres cosas.

const os = require('node:os');
const { spawnSync } = require('node:child_process');

/** Claves admitidas por nivel en el fichero de hooks de Codex: la raíz, medida en codex-cli 0.162.1; grupo y hook, restricción conservadora no medida. */
const ESQUEMA_CODEX = {
  raiz: ['description', 'hooks'],
  grupo: ['matcher', 'hooks'],
  hook: ['type', 'command']
};

/** Rutas (`hooks.<Evento>[i].<clave>`) de cada clave fuera del esquema medido. */
function clavesFueraDeEsquema(wiring) {
  const fuera = [];
  const revisar = (obj, admitidas, prefijo) => {
    for (const clave of Object.keys(obj || {})) {
      if (!admitidas.includes(clave)) fuera.push(`${prefijo}${clave}`);
    }
  };
  revisar(wiring, ESQUEMA_CODEX.raiz, '');
  for (const [evento, grupos] of Object.entries(wiring.hooks || {})) {
    (grupos || []).forEach((grupo, i) => {
      revisar(grupo, ESQUEMA_CODEX.grupo, `hooks.${evento}[${i}].`);
      (grupo.hooks || []).forEach((hook, j) => {
        revisar(hook, ESQUEMA_CODEX.hook, `hooks.${evento}[${i}].hooks[${j}].`);
      });
    });
  }
  return fuera;
}

test('.codex/hooks.json solo usa claves del esquema que Codex acepta', () => {
  assert.deepStrictEqual(clavesFueraDeEsquema(cargarWiring('codex')), []);
});

test('canario: una clave _comment en un grupo se nombra con su ruta', () => {
  const fixture = {
    hooks: { PreToolUse: [{ _comment: 'documentación', matcher: 'Bash', hooks: [{ type: 'command', command: 'x' }] }] }
  };
  assert.deepStrictEqual(clavesFueraDeEsquema(fixture), ['hooks.PreToolUse[0]._comment']);
});

const PLANTILLA = MAPEO.launcher.template;

/** Aplica la plantilla del lanzador a un hook_file. */
function lanzadorPara(hookFile, plantilla = PLANTILLA) {
  return plantilla.split('{hook}').join(hookFile);
}

/** Pares { hook_file, matcher, event } que el mapeo declara cableados para un backend. */
function cableadosDe(backend) {
  const pares = [];
  for (const porBackend of Object.values(MAPEO.actions)) {
    const decl = porBackend[backend];
    if (decl && decl.wired) pares.push({ ...decl, event: MAPEO.events[backend] });
  }
  for (const porBackend of Object.values(MAPEO.lifecycle_events)) {
    const decl = porBackend[backend];
    if (decl && decl.wired) pares.push({ ...decl, matcher: decl.matcher ?? null });
  }
  return pares;
}

/** ¿Hay una entrada con ese evento y matcher cuyo comando sea EXACTAMENTE la plantilla aplicada? */
function cableadoConLanzador(entradas, esperado) {
  return entradas.some(e =>
    e.event === esperado.event
    && matcherDe(e) === esperado.matcher
    && e.commands.includes(lanzadorPara(esperado.hook_file))
  );
}

for (const backend of MAPEO.launcher.backends) {
  test(`${backend}: cada comando es exactamente la plantilla del lanzador aplicada a su hook_file`, () => {
    const entradas = entradasDe(cargarWiring(backend));
    const esperados = cableadosDe(backend);
    for (const esperado of esperados) {
      assert.ok(
        cableadoConLanzador(entradas, esperado),
        `${backend}: ${esperado.event}/${esperado.matcher} no ejecuta lanzadorPara("${esperado.hook_file}")`
      );
    }
    // Ningún comando suelto fuera de la plantilla: `node ./hooks/...` no resuelve
    // desde un subdirectorio.
    const validos = new Set(esperados.map(e => lanzadorPara(e.hook_file)));
    for (const e of entradas) {
      for (const cmd of e.commands) assert.ok(validos.has(cmd), `${backend}: comando fuera de la plantilla: ${cmd}`);
    }
  });
}

test('codex: los guards cableados son los ficheros -codex, que leen el payload de Codex', () => {
  for (const [accion, porBackend] of Object.entries(MAPEO.actions)) {
    const decl = porBackend.codex;
    if (!decl.wired) continue;
    assert.match(decl.hook_file, /-codex$/, `"${accion}" de Codex no apunta a su guard propio`);
    assert.ok(fs.existsSync(path.join(RAIZ, 'hooks', `${decl.hook_file}.js`)), `falta hooks/${decl.hook_file}.js`);
  }
});

test('canario: el guard genérico en el comando de Codex no pasa la igualdad exacta', () => {
  const esperado = { ...MAPEO.actions['pipeline-guard'].codex, event: MAPEO.events.codex };
  const entradas = [{ event: esperado.event, matcher: esperado.matcher, commands: [lanzadorPara('sdd-pipeline-guard')] }];
  assert.strictEqual(cableadoConLanzador(entradas, esperado), false);
});

// tool_name medido con codex-cli 0.162.1: el shell (herramienta exec_command)
// llega como "Bash" y los parches como "apply_patch".
const TOOL_NAME_MEDIDO_CODEX = { 'commit-guard': 'Bash', 'pipeline-guard': 'apply_patch' };

/** El matcher es una expresión regular anclada sobre el tool_name. */
function matcherCasa(matcher, toolName) {
  return new RegExp(`^(?:${matcher})$`).test(toolName);
}

test('codex: cada matcher casa con el tool_name medido de su herramienta', () => {
  for (const [accion, toolName] of Object.entries(TOOL_NAME_MEDIDO_CODEX)) {
    const { matcher } = MAPEO.actions[accion].codex;
    assert.ok(matcherCasa(matcher, toolName), `"${accion}": el matcher "${matcher}" no casa con "${toolName}"`);
  }
});

// tool_name medidos con gemini-cli 0.63.0: escribir es write_file, editar es
// replace y el shell es run_shell_command (edit_file y run_command no existen).
const TOOL_NAME_MEDIDO_GEMINI = {
  'pipeline-guard': ['write_file', 'replace'],
  'commit-guard': ['run_shell_command'],
  'read-before-edit': ['write_file', 'replace'],
  'turn-budget': ['write_file', 'replace', 'run_shell_command']
};

test('gemini: adopta la plantilla del lanzador (figura en launcher.backends)', () => {
  assert.ok(MAPEO.launcher.backends.includes('gemini'),
    'gemini debe figurar en launcher.backends para que su wiring se compare con la plantilla');
});

test('gemini: cada matcher casa con los tool_name medidos de sus herramientas', () => {
  for (const [accion, toolNames] of Object.entries(TOOL_NAME_MEDIDO_GEMINI)) {
    const { matcher } = MAPEO.actions[accion].gemini;
    for (const toolName of toolNames) {
      assert.ok(matcherCasa(matcher, toolName), `"${accion}": el matcher "${matcher}" no casa con "${toolName}"`);
    }
  }
});

test('canario: el matcher write_file|edit_file no casa con el tool_name medido "replace"', () => {
  assert.strictEqual(matcherCasa('write_file|edit_file', 'replace'), false);
});

test('canario: el matcher shell no casa con el tool_name medido "Bash"', () => {
  assert.strictEqual(matcherCasa('shell', TOOL_NAME_MEDIDO_CODEX['commit-guard']), false);
});

// sh expande $, el backtick y \ dentro de "…"; cmd expande % (y ! con expansión
// retardada); una comilla doble interna cierra el argumento de node -e.
const PROHIBIDOS = ['$', '`', '\\', '%', '!'];

/** Caracteres prohibidos que aparecen en la plantilla, más la comilla doble interna. */
function caracteresProhibidos(plantilla) {
  const hallados = PROHIBIDOS.filter(c => plantilla.includes(c));
  const interior = plantilla.replace(/^node -e "/, '').replace(/"$/, '');
  if (interior.includes('"')) hallados.push('"');
  return hallados;
}

test('la plantilla del lanzador no lleva caracteres que sh o cmd expandan', () => {
  assert.match(PLANTILLA, /^node -e ".*"$/);
  assert.deepStrictEqual(caracteresProhibidos(PLANTILLA), []);
});

test('canario: el detector nombra un $ en una plantilla', () => {
  assert.deepStrictEqual(caracteresProhibidos('node -e "console.log($HOME,\'{hook}\')"'), ['$']);
});

// --- El lanzador real, ejecutado por un shell -----------------------------------

const SONDA = `'use strict';
const fs = require('fs');
if (require.main === module) {
  const entrada = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(process.env.SDD_SONDA_SALIDA, JSON.stringify({ cwd: process.cwd(), entrada }));
  process.exit(2);
}
`;
const PAYLOAD = '{"tool_name":"Bash"}';

/** Crea un árbol en un mkdtemp con espacios: `rutas` es { relativa: contenido | null (directorio) }. */
function arbol(t, rutas) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdd lanzador-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const [rel, contenido] of Object.entries(rutas)) {
    const destino = path.join(base, rel);
    if (contenido === null) {
      fs.mkdirSync(destino, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, contenido);
    }
  }
  return base;
}

/** Ejecuta `comando` con un shell desde `cwd`; devuelve el exit, stderr y lo que escribió la sonda. */
function lanzar(base, cwd, comando) {
  const salida = path.join(base, 'sonda-salida.json');
  const r = spawnSync(comando, {
    cwd, shell: true, input: PAYLOAD, encoding: 'utf8',
    env: { ...process.env, SDD_SONDA_SALIDA: salida }
  });
  const sonda = fs.existsSync(salida) ? JSON.parse(fs.readFileSync(salida, 'utf8')) : null;
  return { status: r.status, stderr: r.stderr, sonda };
}

const AVISO = '[SDD] hooks/ no encontrado desde';

test('lanzador: desde un subdirectorio ejecuta el hook de la raíz como programa principal', t => {
  const base = arbol(t, { '.git': null, 'hooks/sdd-sonda.js': SONDA, 'src/sub': null });
  const r = lanzar(base, path.join(base, 'src', 'sub'), lanzadorPara('sdd-sonda'));
  assert.strictEqual(r.status, 2, r.stderr);
  assert.deepStrictEqual(r.sonda, { cwd: base, entrada: PAYLOAD });
});

test('lanzador: .codex/hooks.json y hooks/hooks.json también marcan la raíz', t => {
  for (const marcador of ['.codex/hooks.json', 'hooks/hooks.json']) {
    const base = arbol(t, { [marcador]: '{}', 'hooks/sdd-sonda.js': SONDA, src: null });
    const r = lanzar(base, path.join(base, 'src'), lanzadorPara('sdd-sonda'));
    assert.strictEqual(r.status, 2, `${marcador}: ${r.stderr}`);
    assert.strictEqual(r.sonda && r.sonda.cwd, base, marcador);
  }
});

test('canario: con require en vez de spawnSync el hook no corre y el lanzador sale con 0', t => {
  const base = arbol(t, { '.git': null, 'hooks/sdd-sonda.js': SONDA, 'src/sub': null });
  const ejecucion = "const s=c.spawnSync(process.execPath,[h],{cwd:r,stdio:'inherit'});process.exit(s.status===null?1:s.status)";
  assert.ok(PLANTILLA.includes(ejecucion), 'la plantilla ya no ejecuta el hook con spawnSync');
  const conRequire = PLANTILLA.replace(ejecucion, 'require(h)');
  const r = lanzar(base, path.join(base, 'src', 'sub'), lanzadorPara('sdd-sonda', conRequire));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.sonda, null);
});

test('canario: la orden relativa anterior no resuelve desde un subdirectorio', t => {
  const base = arbol(t, { '.git': null, 'hooks/sdd-sonda.js': SONDA, 'src/sub': null });
  const r = lanzar(base, path.join(base, 'src', 'sub'), 'node ./hooks/sdd-sonda.js');
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(r.sonda, null);
});

test('lanzador: para en el primer marcador y no ejecuta hooks/ de un ancestro', t => {
  const base = arbol(t, { 'padre/hooks/sdd-sonda.js': SONDA, 'padre/proy/.git': null, 'padre/proy/src': null });
  const r = lanzar(base, path.join(base, 'padre', 'proy', 'src'), lanzadorPara('sdd-sonda'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stderr.includes(AVISO), r.stderr);
  assert.strictEqual(r.sonda, null);
});

test('lanzador: un submódulo con su propio .git falla en abierto con aviso visible', t => {
  const base = arbol(t, {
    '.git': null,
    'hooks/sdd-sonda.js': SONDA,
    'vendor/sub/.git': 'gitdir: ../../.git/modules/sub\n',
    'vendor/sub/src': null
  });
  const r = lanzar(base, path.join(base, 'vendor', 'sub', 'src'), lanzadorPara('sdd-sonda'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stderr.includes(AVISO), r.stderr);
  assert.strictEqual(r.sonda, null);
});

test('lanzador: sube como mucho 10 niveles', t => {
  const diez = path.join(...Array.from({ length: 10 }, (_, i) => `n${i}`));
  const once = path.join(diez, 'n10');
  const base = arbol(t, { '.git': null, 'hooks/sdd-sonda.js': SONDA, [once]: null });

  const alcance = lanzar(base, path.join(base, diez), lanzadorPara('sdd-sonda'));
  assert.strictEqual(alcance.status, 2, alcance.stderr);
  fs.rmSync(path.join(base, 'sonda-salida.json'));

  const fuera = lanzar(base, path.join(base, once), lanzadorPara('sdd-sonda'));
  assert.strictEqual(fuera.status, 0, fuera.stderr);
  assert.ok(fuera.stderr.includes(AVISO), fuera.stderr);
  assert.strictEqual(fuera.sonda, null);
});

test('lanzador: sin marcador ni hooks/ al alcance sale con 0 y el aviso', t => {
  const once = path.join(...Array.from({ length: 11 }, (_, i) => `n${i}`));
  const base = arbol(t, { [once]: null });
  const r = lanzar(base, path.join(base, once), lanzadorPara('sdd-sonda'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stderr.includes(AVISO), r.stderr);
  assert.strictEqual(r.sonda, null);
});

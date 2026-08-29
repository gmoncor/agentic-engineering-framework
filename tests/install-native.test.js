'use strict';

// Contrato de las vias de instalacion.
//
// El framework se instala con el CLI (`install --backend <B>`), que copia los
// archivos al proyecto destino, y ademas ofrece una via nativa por backend
// cuando el CLI de ese backend la permite. Hoy solo Gemini CLI la permite, y de
// forma parcial. Claude Code y Codex quedaron descartados: sus gestores de
// plugins instalan en un cache global del usuario, no en el proyecto, y sus
// manifiestos no admiten entregar el archivo de contexto ni cablear los hooks
// dentro del repositorio.
//
// Este test fija esa realidad en tres capas: (1) la via del CLI deja una
// instalacion completa y utilizable en cada backend; (2) la via nativa de Gemini
// entrega el mismo archivo de contexto, y las razones por las que no entrega
// nada mas siguen siendo ciertas en disco; (3) las vias nativas descartadas
// siguen sin existir y README.md sigue explicando por que. Fijar una ausencia
// tambien es un contrato: si alguien reintroduce un manifiesto de plugin o mueve
// los comandos a la raiz, este test falla y obliga a revisar README.md.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const CLI = path.join(RAIZ, 'bin', 'cli.js');
const README = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');

/** Archivo de contexto que cada backend recibe. Codex y Antigravity comparten AGENTS.md. */
const CONTEXTO_POR_BACKEND = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md',
  codex: 'AGENTS.md',
  antigravity: 'AGENTS.md',
};

// Vias nativas descartadas: la huella textual que README.md debe seguir dando
// (invocacion del gestor + destino real de la instalacion) y los manifiestos que
// no pueden reaparecer en disco sin una decision explicita.
const VIAS_DESCARTADAS = {
  'Claude Code': {
    huellaReadme: ['.claude-plugin/plugin.json', 'plugins/cache'],
    manifiestos: ['.claude-plugin/plugin.json', 'plugin.json'],
  },
  Codex: {
    huellaReadme: ['codex plugin add', '.codex/plugins/cache'],
    manifiestos: ['.codex/plugin.json', 'plugin.json'],
  },
};

function leerJson(ruta) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

// Suelos de las dos listas de cobertura de arriba, que se mantienen a mano: cada una
// alimenta un bucle que genera un caso por elemento, asi que vaciarlas no rompe nada,
// solo deja de comprobar. Los backends no se cuentan a mano: salen del manifiesto de
// instalacion, de modo que un backend nuevo entra en cobertura o este caso falla.
const MIN_BACKENDS = 4;
const MIN_VIAS_DESCARTADAS = 2;

test('las listas de cobertura de las vias no pueden vaciarse ni quedarse cortas', () => {
  const manifiesto = leerJson(path.join(RAIZ, 'scripts', 'backend-manifest.json'));
  const backends = Object.keys(manifiesto).filter(clave => clave !== 'common');

  assert.ok(
    backends.length >= MIN_BACKENDS,
    `el manifiesto de instalacion declara ${backends.length} backends, minimo ${MIN_BACKENDS}`
  );
  for (const backend of backends) {
    assert.ok(
      CONTEXTO_POR_BACKEND[backend],
      `${backend} se instala pero ningun caso comprueba su via del CLI: falta su archivo de contexto`
    );
  }
  assert.ok(
    Object.keys(VIAS_DESCARTADAS).length >= MIN_VIAS_DESCARTADAS,
    `la lista de vias descartadas tiene ${Object.keys(VIAS_DESCARTADAS).length} entradas, minimo `
      + `${MIN_VIAS_DESCARTADAS}: una lista vacia no comprueba ninguna ausencia`
  );
});

/** Instala un backend en un directorio temporal que se borra al terminar el test. */
function instalar(t, backend) {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), `install-${backend}-`));
  t.after(() => fs.rmSync(destino, { recursive: true, force: true }));

  const resultado = spawnSync(process.execPath, [CLI, 'install', '--backend', backend], {
    cwd: destino,
    encoding: 'utf8',
  });
  assert.strictEqual(resultado.status, 0, `install --backend ${backend} fallo: ${resultado.stderr}`);
  return destino;
}

for (const [backend, contexto] of Object.entries(CONTEXTO_POR_BACKEND)) {
  test(`la via del CLI deja una instalacion completa de ${backend}`, (t) => {
    const destino = instalar(t, backend);

    for (const ruta of [contexto, '.gitignore', 'hooks/config.json', 'package.json']) {
      assert.ok(fs.existsSync(path.join(destino, ruta)), `falta ${ruta} tras instalar ${backend}`);
    }

    // Copiar los archivos sin dejar los hooks configurados es una instalacion a
    // medias: el flujo arranca pero sin enforcement. La ausencia de config y la
    // config vacia cuentan las dos como fallo.
    const config = leerJson(path.join(destino, 'hooks', 'config.json'));
    const hooks = Object.keys(config).filter(clave => !clave.startsWith('_'));
    assert.ok(hooks.length >= 3, `hooks/config.json de ${backend} configura ${hooks.length} hooks`);
    for (const hook of hooks) {
      assert.strictEqual(typeof config[hook], 'object', `${hook} no declara configuracion`);
    }

    const pruebas = fs.readdirSync(path.join(destino, 'hooks', 'tests'));
    assert.ok(pruebas.some(f => f.endsWith('.test.js')), `${backend} no instalo los tests de hooks`);
    assert.ok(leerJson(path.join(destino, 'package.json')).scripts.test, 'falta scripts.test');
  });
}

test('la via nativa de Gemini entrega el mismo archivo de contexto que la via del CLI', (t) => {
  const manifiesto = leerJson(path.join(RAIZ, 'gemini-extension.json'));
  const contexto = manifiesto.contextFileName;

  assert.ok(contexto, 'gemini-extension.json no declara contextFileName');
  assert.ok(fs.existsSync(path.join(RAIZ, contexto)), `contextFileName apunta a ${contexto}, ausente`);
  assert.strictEqual(contexto, CONTEXTO_POR_BACKEND.gemini);
  assert.ok(fs.existsSync(path.join(instalar(t, 'gemini'), contexto)));
});

test('la via nativa de Gemini sigue sin poder entregar comandos, skills ni agentes', () => {
  // El gestor de extensiones los busca sueltos en la raiz del repositorio; aqui
  // viven bajo .gemini/ para no colisionar con carpetas del proyecto destino.
  // Moverlos a la raiz cambiaria el alcance de la via nativa y la limitacion que
  // README.md documenta, asi que este test lo convierte en un fallo.
  for (const dir of ['commands', 'skills', 'agents']) {
    assert.ok(!fs.existsSync(path.join(RAIZ, dir)), `${dir}/ en la raiz cambia el alcance de la extension`);
    assert.ok(fs.existsSync(path.join(RAIZ, '.gemini', dir)), `falta .gemini/${dir}`);
  }
  assert.match(README, /gemini extensions install/);
  assert.match(README, /Limitacion conocida/);
});

test('la via nativa de Gemini no cablea los hooks y README.md lo advierte', () => {
  const manifiesto = leerJson(path.join(RAIZ, 'gemini-extension.json'));
  const claves = Object.keys(manifiesto).join(' ');

  assert.doesNotMatch(claves, /hook/i, 'el manifiesto declara hooks: revisar la advertencia de README.md');
  assert.match(README, /hooks no viajan con la extension/);
});

for (const [via, { huellaReadme, manifiestos }] of Object.entries(VIAS_DESCARTADAS)) {
  test(`la via nativa de ${via} sigue descartada y README.md sigue dando el motivo`, () => {
    for (const manifiesto of manifiestos) {
      assert.ok(!fs.existsSync(path.join(RAIZ, manifiesto)), `${manifiesto} reaparecio: revisar README.md`);
    }
    for (const huella of huellaReadme) {
      assert.ok(README.includes(huella), `README.md ya no explica la exclusion de ${via}: falta "${huella}"`);
    }
  });
}

test('la exclusion de Codex cita la version del CLI con la que se verifico', () => {
  assert.match(README, /verificado en la version `\d+\.\d+\.\d+`/);
});

test('la instalacion real con el gestor de extensiones de Gemini', {
  skip: 'requiere red y el CLI de Gemini instalado, y escribe en el cache global del usuario, ' +
        'fuera del directorio temporal del test. Lo verificable sin efectos globales es el ' +
        'manifiesto que consume esa via, cubierto por los tests de arriba.',
}, () => {});

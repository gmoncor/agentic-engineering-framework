'use strict';

// Contrato de sdd-review-gate.js: BLOQUEA `git commit`/`merge` cuyo diff no consta
// revisado por la revision adversarial por task.
//
// La revision ocurre por task, ANTES del commit, y su senal guarda el hash del
// diff revisado. El hook recalcula el hash del diff cacheado (`git diff --cached`)
// y lo contrasta: si coincide, pasa; si no hay senal o el hash no ata, deniega.
// Estos tests fijan ese contrato: si alguien vuelve a degradar el hook a mero
// aviso, fallan.
//
// Degradacion segura (avisa, no bloquea): SDD_GUARD_SKIP=1, o sin diff cacheado
// computable. Silencio total (exit 0): hook off, sin session_id, o hash que ata.
//
// El diff cacheado se inyecta con SDD_STAGED_DIFF (seam de tests, igual que
// SDD_CONFIG_PATH / SDD_SIGNAL_DIR); sin el, el hook lo leeria del repo real.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile, HOOKS_DIR, motorDeWorkflowsInstalado } = require('./helpers');
const signal = require('../sdd-review-signal');

const SIN_MOTOR = motorDeWorkflowsInstalado()
  ? false
  : 'sin motor de workflows de Claude Code (.claude/workflows/implementar-spec.js y/o .claude/settings.json ausentes): no hay artefacto que verificar en este backend';

const HOOK = 'sdd-review-gate.js';
const SESSION = 'sesion-de-prueba-1';
const DIFF = 'diff --git a/src/pagos.js b/src/pagos.js\n@@ -1 +1 @@\n-viejo\n+nuevo\n';

const CONFIG_ON = { sdd_review_gate: { enabled: true, ttl_hours: 4 } };
const CONFIG_OFF = { sdd_review_gate: { enabled: false, ttl_hours: 4 } };

function entorno(config, extra) {
  const dir = tempDir('sdd-review-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify(config));
  return Object.assign({ SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_SIGNAL_DIR: dir }, extra || {});
}

// Construye el payload con un comando arbitrario. commit() sigue con su firma de
// siempre para los casos vigentes; los casos nuevos (F1/F2) necesitan invocaciones
// de shell que no son "git commit -m <mensaje>".
function bashPayload(cmd, sessionId) {
  const payload = { tool_name: 'Bash', tool_input: { command: cmd } };
  if (sessionId !== null) payload.session_id = sessionId === undefined ? SESSION : sessionId;
  return payload;
}

function commit(mensaje, sessionId) {
  return bashPayload('git commit -m "' + mensaje + '"', sessionId);
}

// Emite la senal igual que el flujo de implementacion: mismo modulo, misma funcion.
// El hash es el del diff que la revision aprobo.
function emitirSenal(env, diffRevisado, edadMs) {
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const hash = signal.hashDiff(diffRevisado);
  const file = signal.writeSignal(SESSION, hash);
  if (edadMs) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.ts = Date.now() - edadMs;
    fs.writeFileSync(file, JSON.stringify(raw));
  }
  delete process.env.SDD_SIGNAL_DIR;
  return hash;
}

test('senal que ata el diff cacheado: el commit pasa (silencio)', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, DIFF);

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('sin senal, con diff staged: DENIEGA el commit', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.decision.reason, /no consta revisado/);
});

test('sin senal: el mensaje de bloqueo nombra /implementar-spec como via que emite la senal', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.match(r.decision.reason, /\/implementar-spec/);
});

test('senal que NO ata el diff (el codigo cambio tras revisarse): DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, 'diff viejo, distinto del que se va a commitear');

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
  assert.match(r.decision.reason, /no corresponde al diff/);
});

test('sin diff cacheado computable: degrada a aviso, no bloquea a ciegas', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: '' });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /no hay diff cacheado/);
});

test('SDD_GUARD_SKIP=1: escape de emergencia, degrada el bloqueo a aviso', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF, SDD_GUARD_SKIP: '1' });

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.decision.reason, /SDD_GUARD_SKIP/);
});

test('senal con TTL expirado (>4h): cuenta como sin senal y DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, DIFF, 5 * 60 * 60 * 1000);

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('senal PRE-implementacion (revision del plan) no ata el diff: DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  process.env.SDD_SIGNAL_DIR = env.SDD_SIGNAL_DIR;
  const file = signal.signalPath(SESSION);
  delete process.env.SDD_SIGNAL_DIR;
  writeFile(file, JSON.stringify({ signal: 'SDD_PRE_IMPL', diff_hash: signal.hashDiff(DIFF), ts: Date.now() }));

  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
});

test('la marca en el mensaje de commit no satisface el gate: DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const hash = signal.hashDiff(DIFF);
  const r = runHook(HOOK, commit('feat: entregar pagos [SDD-POST-IMPL: ' + hash + ']'), env);

  // Era auto-emitible: el mismo agente que redacta el mensaje conocia el formato.
  // Escribirla en el mensaje no cuenta como revision.
  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(signal.MARKER_RE, undefined);
});

test('git merge sin senal, con diff staged: DENIEGA', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git merge feature/pagos' }, session_id: SESSION }, env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

// F1 (fail-open): una opcion global entre "git" y el subcomando rompe la regex cruda y el
// gate no llega a mirar el diff. `sin senal, con diff staged` deberia denegar igual que el
// commit liso: la opcion global no es una via legitima de saltarse la revision.
test('F1: opcion global antes de commit (git -c k=v commit) sin senal: DENIEGA igual que el commit liso', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, bashPayload('git -c foo=bar commit -m x'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

test('F1: opcion global antes de merge (git -c k=v merge) sin senal: DENIEGA igual que el merge liso', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, bashPayload('git -c foo=bar merge feature/pagos'), env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.strictEqual(r.code, 2);
});

// F2 (fail-closed): la frase "git commit"/"git merge" aparece dentro de un argumento
// entrecomillado de un comando de solo lectura. El gate no debe activarse: no hay nada
// que commitear, asi que no hay diff que contrastar.
test('F2: git log de solo lectura con la frase "git commit" en un argumento: silencio', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, bashPayload('git log --oneline --grep="remember to git commit after this"'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('F2: git show de solo lectura con la frase "git merge" en un argumento: silencio', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, bashPayload('git show --stat --grep="pending git merge cleanup"'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('sin session_id en el payload: silencio (no hay sesion que correlacionar)', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos', null), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('hook deshabilitado en la config: silencio', () => {
  const env = entorno(CONFIG_OFF, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, commit('feat: entregar el modulo de pagos'), env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('comando que no es commit ni merge: silencio', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  const r = runHook(HOOK, { tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: SESSION }, env);

  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.decision, null);
});

test('round-trip: la senal que emite el flujo por task es exactamente la que el hook acepta', () => {
  const env = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  emitirSenal(env, DIFF);
  assert.strictEqual(runHook(HOOK, commit('feat: pagos'), env).decision, null);

  const envSinSenal = entorno(CONFIG_ON, { SDD_STAGED_DIFF: DIFF });
  assert.strictEqual(runHook(HOOK, commit('feat: pagos'), envSinSenal).decision.decision, 'deny');
});

test('el emisor del flujo revisa por task y usa el mismo contrato de senal que el hook', { skip: SIN_MOTOR }, () => {
  const workflow = fs.readFileSync(
    path.resolve(HOOKS_DIR, '..', '.claude', 'workflows', 'implementar-spec.js'), 'utf8');

  assert.match(workflow, /hooks\/sdd-review-signal\.js/);
  assert.match(workflow, /writeSignal/);
  // La senal se emite tras revisar el diff de la task y antes de commitear.
  assert.match(workflow, /revisarYComitear/);
  assert.match(workflow, /'--cached'/);
  assert.match(workflow, /emitirSenalRevision/);
  assert.doesNotMatch(workflow, /SDD-POST-IMPL/, 'el canal de la marca en el mensaje de commit se elimino');
});

test('la limitacion frente a falsificacion deliberada esta documentada en README y en el modulo de la senal', { skip: SIN_MOTOR }, () => {
  // La ausencia del fichero es un fallo, no un motivo para omitir el caso: omitirlo
  // convertia un renombrado o un borrado en un contador de omitidos que nadie mira, y
  // la comparacion dejaba de ejecutarse en silencio. Los demas casos de este fichero
  // ya leen el arbol del repositorio sin condicion previa (el motor de workflows y el
  // wiring del backend), asi que este no gana nada por ser el unico que la tiene.
  const readmePath = path.resolve(HOOKS_DIR, '..', 'README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md ausente: la limitacion no se puede verificar');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const signalSource = fs.readFileSync(path.join(HOOKS_DIR, 'sdd-review-signal.js'), 'utf8');

  // README: la limitacion vive junto al escape hatch de SDD_GUARD_SKIP, no en
  // una seccion aparte que nadie lea al configurar el gate.
  const skipIdx = readme.indexOf('SDD_GUARD_SKIP=1');
  const limiteIdx = readme.search(/falsificaci[oó]n deliberada/);
  assert.notStrictEqual(skipIdx, -1, 'el parrafo de SDD_GUARD_SKIP debe seguir presente');
  assert.notStrictEqual(limiteIdx, -1, 'README debe documentar la limitacion frente a falsificacion deliberada');
  assert.ok(limiteIdx > skipIdx, 'la limitacion debe documentarse junto/despues del escape hatch, no antes');

  // El docstring del modulo que emite/lee la senal debe declarar el mismo limite,
  // para quien lea el codigo sin pasar por el README.
  assert.match(signalSource, /falsificaci[oó]n deliberada/);
  assert.match(signalSource, /LIMITE HONESTO/);
});

test('el hook solo se cablea donde el flujo emite la senal: Claude Code', { skip: SIN_MOTOR }, () => {
  const settings = fs.readFileSync(path.resolve(HOOKS_DIR, '..', '.claude', 'settings.json'), 'utf8');
  const hooksJson = fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8');

  assert.match(settings, /sdd-review-gate\.js/);
  assert.match(settings, /sdd-pipeline-guard\.js/);

  assert.match(hooksJson, /sdd-pipeline-guard\.js/);
  assert.doesNotMatch(
    hooksJson.replace(/"_[a-z_]+":\s*"[^"]*"/g, ''),
    /sdd-review-gate\.js/,
    'sin motor de workflows no hay emisor de la senal: cablear el gate ahi no tendria via de satisfacerse'
  );
});

// Raíz del diff: con git real y dos repositorios. El hook debe leer el diff cacheado del
// repositorio que el commit va a usar (`-C`, `--git-dir`/`--work-tree`, `GIT_DIR=` o, sin
// nada de eso, el cwd del payload), no el del directorio en el que corre su proceso.
// Los repositorios viven bajo un HOME inyectado para ejercitar la `~` sin tocar el real.
const { spawnSync, execFileSync } = require('child_process');

let reposCache = null;
function dosRepos() {
  if (reposCache) return reposCache;
  const home = tempDir('sdd-review-repos-');
  const crear = (nombre, fichero) => {
    const dir = path.join(home, nombre);
    fs.mkdirSync(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, fichero), 'contenido de ' + nombre + '\n');
    execFileSync('git', ['add', fichero], { cwd: dir });
    return { dir, diff: execFileSync('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv'], { cwd: dir, encoding: 'utf8' }) };
  };
  reposCache = { home, A: crear('A', 'a.txt'), B: crear('B', 'b.txt') };
  return reposCache;
}

// Lanza el hook con el proceso situado en `cwd` y sin SDD_STAGED_DIFF: el diff sale de git.
function runHookEn(cwd, payload, env) {
  const childEnv = Object.assign({}, process.env, { HOME: dosRepos().home, USERPROFILE: dosRepos().home }, env);
  for (const k of ['SDD_STAGED_DIFF', 'SDD_GUARD_SKIP', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_GLOBAL']) {
    if (!(env && k in env)) delete childEnv[k];
  }
  const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, HOOK)], {
    cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000, env: childEnv,
  });
  let decision = null;
  try { decision = JSON.parse((r.stdout || '').trim()); } catch { decision = null; }
  return decision ? decision.decision : 'silencio';
}

// Cada caso: [comando, señal revisada, veredicto esperado], con el proceso del hook en A.
function comprobar(casos) {
  const { A, B } = dosRepos();
  for (const [cmd, revisado, esperado] of casos) {
    const env = entorno(CONFIG_ON);
    emitirSenal(env, revisado === 'A' ? A.diff : B.diff);
    assert.strictEqual(runHookEn(A.dir, bashPayload(cmd), env), esperado, cmd + ' (señal de ' + revisado + ')');
  }
}

test('git -C <B> commit con el proceso en A: contrasta el diff de B, no el de A', () => {
  const { B } = dosRepos();
  comprobar([
    ['git -C ' + B.dir + ' commit -m x', 'B', 'silencio'],
    ['git -C ' + B.dir + ' commit -m x', 'A', 'deny'],
    ['git -C ../B commit -m x', 'B', 'silencio'],
    ['git -C ~/B commit -m x', 'B', 'silencio'],
    ['git -C ~/B commit -m x', 'A', 'deny'],
    ['bash -lc "git -C ' + B.dir + ' commit -m x"', 'B', 'silencio'],
  ]);
});

test('-C que depende del shell o no existe: conserva la raíz de partida y deniega lo no revisado', () => {
  comprobar([
    ['git -C "$HOME/B" commit -m x', 'B', 'deny'],
    ['git -C "$HOME/B" commit -m x', 'A', 'silencio'],
    ['git -C `pwd`/../B commit -m x', 'B', 'deny'],
    ['git -C /no/existe/B commit -m x', 'B', 'deny'],
  ]);
});

test('--git-dir/--work-tree y GIT_DIR=/GIT_WORK_TREE= fijan el repositorio del diff', () => {
  const { B } = dosRepos();
  const g = path.join(B.dir, '.git');
  comprobar([
    ['git --git-dir=' + g + ' --work-tree=' + B.dir + ' commit -m x', 'B', 'silencio'],
    ['git --git-dir=' + g + ' --work-tree=' + B.dir + ' commit -m x', 'A', 'deny'],
    ['git --git-dir ' + g + ' --work-tree ' + B.dir + ' commit -m x', 'B', 'silencio'],
    ['git --git-dir ' + g + ' --work-tree ' + B.dir + ' commit -m x', 'A', 'deny'],
    ['GIT_DIR=' + g + ' GIT_WORK_TREE=' + B.dir + ' git commit -m x', 'B', 'silencio'],
    ['GIT_DIR=' + g + ' GIT_WORK_TREE=' + B.dir + ' git commit -m x', 'A', 'deny'],
  ]);
});

test('un "git" que no está en posición de programa no cambia la raíz', () => {
  const { B } = dosRepos();
  comprobar([
    ['echo git -C ' + B.dir + ' commit; git commit -m x', 'A', 'silencio'],
    ['echo git -C ' + B.dir + ' commit; git commit -m x', 'B', 'deny'],
  ]);
});

test('sin -C, el cwd del payload manda sobre el del proceso del hook', () => {
  const { A, B } = dosRepos();
  const env = entorno(CONFIG_ON);
  emitirSenal(env, B.diff);

  const payload = Object.assign(bashPayload('git commit -m x'), { cwd: B.dir });
  assert.strictEqual(runHookEn(A.dir, payload, env), 'silencio');

  const enA = Object.assign(bashPayload('git commit -m x'), { cwd: A.dir });
  assert.strictEqual(runHookEn(B.dir, enA, env), 'deny');
});

test('con diff.external y textconv globales, ni el hook ni el emisor los ejecutan, y calculan el mismo hash: no deniega', { skip: SIN_MOTOR }, async () => {
  // El emisor vive en el motor de workflows: se carga solo donde está instalado.
  const orq = require('../../.claude/workflows/lib/orquestacion');
  const { A } = dosRepos();
  const home = tempDir('sdd-review-home-');
  try {
    // La herramienta externa deja un centinela fuera del repositorio cada vez que git la ejecuta.
    const centinela = path.join(home, 'centinela');
    const externo = writeFile(path.join(home, 'externo.js'),
      'require("fs").writeFileSync(' + JSON.stringify(centinela) + ', "x");\n'
      + "process.stdout.write('diff externo\\n');\n");
    const centinelaConv = path.join(home, 'centinela-textconv');
    const conv = writeFile(path.join(home, 'conv.js'),
      'require("fs").writeFileSync(' + JSON.stringify(centinelaConv) + ', "x");\n'
      + "process.stdout.write('texto convertido\\n');\n");
    const atributos = writeFile(path.join(home, 'atributos'), '* diff=conv\n');
    const barras = p => p.split(path.sep).join('/');
    writeFile(path.join(home, '.gitconfig'),
      '[core]\n\tattributesFile = "' + barras(atributos) + '"\n'
      + '[diff]\n\texternal = "' + barras(process.execPath) + '" "' + barras(externo) + '"\n'
      + '[diff "conv"]\n\ttextconv = "' + barras(process.execPath) + '" "' + barras(conv) + '"\n');
    const gitEnv = Object.assign({}, process.env, { HOME: home, USERPROFILE: home });
    delete gitEnv.GIT_CONFIG_GLOBAL;

    // Controles: sin --no-ext-diff ni --no-textconv, git sí ejecuta cada herramienta. Si no, el caso
    // no prueba nada.
    const conExterno = execFileSync('git', ['diff', '--cached'], { cwd: A.dir, env: gitEnv, encoding: 'utf8' });
    assert.match(conExterno, /diff externo/, 'el diff.external global debe aplicarse');
    assert.ok(fs.existsSync(centinela), 'la herramienta externa debe dejar el centinela');
    fs.rmSync(centinela);
    const conTextconv = execFileSync('git', ['diff', '--cached', '--no-ext-diff'], { cwd: A.dir, env: gitEnv, encoding: 'utf8' });
    assert.match(conTextconv, /texto convertido/, 'el textconv global debe aplicarse');
    assert.ok(fs.existsSync(centinelaConv), 'el textconv debe dejar su centinela');
    fs.rmSync(centinelaConv);

    // Emisor real de la señal: la lectura del diff preparado del flujo por task.
    const spawn = argv => {
      const r = spawnSync('git', argv, { cwd: A.dir, env: gitEnv, encoding: 'utf8', timeout: 15000 });
      return { code: r.status, out: r.stdout || '', err: r.stderr || (r.error ? r.error.message : '') };
    };
    const emitido = await orq.diffPreparado(spawn);
    assert.ok(emitido.ok, emitido.error);
    assert.doesNotMatch(emitido.diff, /diff externo|texto convertido/);
    assert.match(emitido.diff, /contenido de A/);
    assert.ok(!fs.existsSync(centinela), 'el emisor no debe ejecutar la herramienta externa');
    assert.ok(!fs.existsSync(centinelaConv), 'el emisor no debe ejecutar el textconv');

    const env = entorno(CONFIG_ON, { HOME: home, USERPROFILE: home });
    emitirSenal(env, emitido.diff);
    assert.strictEqual(runHookEn(A.dir, bashPayload('git commit -m x'), env), 'silencio');
    assert.ok(!fs.existsSync(centinela), 'el hook no debe ejecutar la herramienta externa');
    assert.ok(!fs.existsSync(centinelaConv), 'el hook no debe ejecutar el textconv');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test.after(() => { if (reposCache) fs.rmSync(reposCache.home, { recursive: true, force: true }); });

'use strict';

// Acredita el contrato de hooks/gate-signatures.json: un escaner de auditoria externo clasifica
// cada veredicto de gate por su firma (un codigo estable en stderr), no por el texto libre que
// la sigue. El registro debe ser BIDIRECCIONAL:
//   - toda firma que un hook emite por stderr esta declarada en el registro.
//   - ninguna entrada del registro queda huerfana: su campo `hook` apunta a un fichero real de
//     hooks/, y la firma aparece efectivamente emitida en el codigo de ese directorio.
//
// Dos capas de prueba:
//   1. Estatica: escanea el codigo fuente de hooks/*.js en busca de firmas `[SDD_..._...]` y
//      contrasta contra el registro en ambas direcciones.
//   2. Dinamica: invoca cada hook bloqueante con un input que dispara su veredicto y verifica
//      que el stderr real contiene la firma declarada (igual que veria el escaner de auditoria).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runHook, tempDir, writeFile } = require('./helpers');
const { listBlockingHooks, MIN_BLOCKING_HOOKS } = require('./blocking-hooks');

const HOOKS_DIR = path.resolve(__dirname, '..');
// Suelo del escaneo de firmas emitidas: un escaneo que devuelve el conjunto vacio (directorio
// mal resuelto, regex roto) deja en verde la comparacion contra el registro sin comprobar nada.
const MIN_FIRMAS_EMITIDAS = 8;
const REGISTRY_PATH = path.join(HOOKS_DIR, 'gate-signatures.json');
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

// `_readme` (y cualquier clave que empiece por `_`) es metadata del registro, no una firma:
// la misma convencion que usan hooks/hooks.json y scripts/hook-event-mapping.json.
function firmas(registryObj) {
  return Object.entries(registryObj).filter(([key]) => !key.startsWith('_'));
}

// Todos los .js de primer nivel de hooks/ (sin bajar a tests/): son los ficheros que un
// consumidor externo puede referenciar desde el campo `hook` del registro.
function hookSourceFiles() {
  return fs.readdirSync(HOOKS_DIR).filter((name) => {
    const full = path.join(HOOKS_DIR, name);
    return name.endsWith('.js') && fs.statSync(full).isFile();
  });
}

function concatenatedSource() {
  return hookSourceFiles()
    .map((f) => fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8'))
    .join('\n---\n');
}

const FIRMA_RE = /\[SDD_[A-Z_]+\]/g;

// Firmas declaradas en el registro que no coinciden con ningun hook en disco: registro roto
// (typo en el nombre del hook, hook renombrado o eliminado).
function huerfanosPorHookInexistente(registryObj, disponibles) {
  return firmas(registryObj)
    .filter(([, entry]) => !disponibles.has(entry.hook))
    .map(([firma]) => firma);
}

// Firmas declaradas en el registro que jamas aparecen emitidas en el codigo de hooks/: registro
// con una entrada que nadie produce (huerfana en el otro sentido).
function huerfanosPorFirmaNuncaEmitida(registryObj, source) {
  return firmas(registryObj)
    .filter(([firma]) => !source.includes('[' + firma + ']'))
    .map(([firma]) => firma);
}

// Firmas emitidas en el codigo de hooks/ que no constan en el registro: un hook nuevo (o
// modificado) que introduce un codigo sin registrar.
function firmasSinRegistrar(source, registryObj) {
  const encontradas = new Set(source.match(FIRMA_RE) || []);
  return [...encontradas].filter((f) => !registryObj[f.slice(1, -1)]);
}

// Firmas del registro declaradas como veredicto de bloqueo.
function firmasDeBloqueo(registryObj) {
  return firmas(registryObj).filter(([, entry]) => entry.severity === 'block').map(([firma]) => firma);
}

// Fuente alcanzable desde un hook: su propio codigo mas los modulos locales que requiere, un
// nivel. La firma de un hook puede vivir en el modulo de reglas que comparte con su gemelo de
// otro backend, como hacen los dos guards de commit con sdd-commit-rules.js.
const LOCAL_REQUIRE_RE = /require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g;

function fuenteAlcanzable(file, dir) {
  const own = fs.readFileSync(path.join(dir, file), 'utf8');
  const partes = [own];
  for (const m of own.matchAll(LOCAL_REQUIRE_RE)) {
    const dep = path.join(dir, m[1] + '.js');
    if (fs.existsSync(dep)) partes.push(fs.readFileSync(dep, 'utf8'));
  }
  return partes.join('\n---\n');
}

// Direccion inversa del registro: que las firmas emitidas esten declaradas no basta. Un hook
// puede denegar sin emitir ninguna firma, y entonces el escaner externo ve un veredicto que no
// sabe clasificar. Todo hook que deniega necesita su firma de bloqueo.
function bloqueantesSinFirmaDeBloqueo(dir, firmasBlock) {
  return listBlockingHooks(dir).filter((file) => {
    const source = fuenteAlcanzable(file, dir);
    return !firmasBlock.some((firma) => source.includes('[' + firma + ']'));
  });
}

test('gate-signatures.json existe con al menos 5 entradas', () => {
  assert.ok(firmas(registry).length >= 5);
});

test('cada entrada declara hook, severity, event y description', () => {
  for (const [firma, entry] of firmas(registry)) {
    assert.ok(entry.hook, firma + ': sin campo hook');
    assert.ok(['block', 'advisory'].includes(entry.severity), firma + ': severity invalida');
    assert.ok(entry.event, firma + ': sin campo event');
    assert.ok(entry.description, firma + ': sin campo description');
  }
});

test('toda firma del registro corresponde a un hook existente en disco (cero huerfanos)', () => {
  const disponibles = new Set(hookSourceFiles());
  assert.deepStrictEqual(huerfanosPorHookInexistente(registry, disponibles), []);
});

test('toda firma del registro aparece efectivamente emitida en el codigo de hooks/ (cero huerfanos)', () => {
  assert.deepStrictEqual(huerfanosPorFirmaNuncaEmitida(registry, concatenatedSource()), []);
});

test('toda firma emitida en el codigo de hooks/ esta declarada en el registro', () => {
  const source = concatenatedSource();
  const emitidas = new Set(source.match(FIRMA_RE) || []);
  assert.ok(emitidas.size >= MIN_FIRMAS_EMITIDAS,
    'el escaneo encontro ' + emitidas.size + ' firmas, minimo ' + MIN_FIRMAS_EMITIDAS
    + ': un escaneo vacio compara dos conjuntos vacios y no acredita nada');
  assert.deepStrictEqual(firmasSinRegistrar(source, registry), []);
});

test('todo hook que deniega tiene su firma de bloqueo declarada en el registro', () => {
  const bloqueantes = listBlockingHooks(HOOKS_DIR);
  assert.ok(bloqueantes.length >= MIN_BLOCKING_HOOKS,
    'la derivacion encontro ' + bloqueantes.length + ' hooks bloqueantes, minimo '
    + MIN_BLOCKING_HOOKS + ': sin cobertura no hay nada que acreditar');
  const firmasBlock = firmasDeBloqueo(registry);
  assert.ok(firmasBlock.length > 0, 'el registro no declara ninguna firma de severidad block');

  assert.deepStrictEqual(bloqueantesSinFirmaDeBloqueo(HOOKS_DIR, firmasBlock), []);
});

// Un hook bloqueante nuevo que sale con codigo de bloqueo sin emitir ninguna firma: el escaner
// externo ve el veredicto y no tiene codigo por el que clasificarlo.
test('caso limite: hook que deniega sin firma de bloqueo se detecta', () => {
  const dir = tempDir('sdd-gate-firmas-sin-firma-');
  const cuerpo = (reason) => [
    "const { readPayload, deny } = require('./sdd-hook-utils');",
    "const { MOTIVO } = require('./reglas-fixture');",
    'async function main() {',
    '  const data = await readPayload();',
    '  if (data) deny(' + reason + ');',
    '}',
    'if (require.main === module) { main(); }',
    '',
  ].join('\n');

  writeFile(path.join(dir, 'sdd-hook-que-deniega.js'), cuerpo("'SDD: motivo sin firma'"));
  writeFile(path.join(dir, 'reglas-fixture.js'), "module.exports = { MOTIVO: 'SDD: motivo sin firma' };\n");
  assert.deepStrictEqual(bloqueantesSinFirmaDeBloqueo(dir, firmasDeBloqueo(registry)),
    ['sdd-hook-que-deniega.js'], 'denegar sin firma registrada debe marcarse');

  // La firma llega por el modulo de reglas que el hook requiere: el mismo reparto que usan los
  // dos guards de commit. La fuente alcanzable debe verla igual que si estuviera en el hook.
  writeFile(path.join(dir, 'reglas-fixture.js'),
    "module.exports = { MOTIVO: '[SDD_PIPELINE_BLOCK] SDD: motivo' };\n");
  writeFile(path.join(dir, 'sdd-hook-que-deniega.js'), cuerpo('MOTIVO'));
  assert.deepStrictEqual(bloqueantesSinFirmaDeBloqueo(dir, firmasDeBloqueo(registry)), [],
    'la firma declarada en el modulo de reglas que el hook requiere debe contar');
});

// Una firma con `hook` mal escrito (typo) se detecta como huerfana,
// sin depender del registro real.
test('caso limite: firma con hook inexistente en disco se detecta como huerfana', () => {
  const registroRoto = {
    SDD_FANTASMA_BLOCK: { hook: 'sdd-no-existe.js', severity: 'block', event: 'PreToolUse', description: 'x' },
  };
  const disponibles = new Set(hookSourceFiles());
  assert.deepStrictEqual(huerfanosPorHookInexistente(registroRoto, disponibles), ['SDD_FANTASMA_BLOCK']);
});

// Un hook nuevo que emite una firma nunca declarada en el registro
// se detecta, sin depender del registro real.
test('caso limite: firma emitida sin registrar se detecta', () => {
  const sourceFalso = 'function main(){ deny("[SDD_NUEVO_BLOCK] motivo", call); }';
  assert.deepStrictEqual(firmasSinRegistrar(sourceFalso, registry), ['[SDD_NUEVO_BLOCK]']);
});

// --- Invocacion real: cada hook bloqueante emite su firma en stderr al bloquear -------------

const SPEC_APROBADA = [
  '# Spec: Autenticacion',
  '',
  '**Estado:** APROBADA',
  '',
  '## Criterios de aceptacion',
  '- El usuario puede iniciar sesion',
  '',
].join('\n');

function proyectoSinPlan() {
  const root = tempDir('sdd-gate-firmas-');
  fs.mkdirSync(path.join(root, 'ai_docs', 'tasks'), { recursive: true });
  return root;
}

test('sdd-pipeline-guard.js: escritura sin plan -> stderr lleva [SDD_PIPELINE_BLOCK]', () => {
  const root = proyectoSinPlan();
  const filePath = path.join(root, 'src', 'auth', 'login.js');

  const r = runHook('sdd-pipeline-guard.js', { tool_name: 'Write', tool_input: { file_path: filePath } });

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.stderr, /\[SDD_PIPELINE_BLOCK\]/);
  // Las dos capas del canal, en orden: primero el prefijo que identifica al emisor,
  // después la firma que el escáner clasifica (hooks/CONVENTIONS.md).
  assert.match(r.stderr, /\[SDD\] \[SDD_PIPELINE_BLOCK\]/);
});

test('sdd-pipeline-guard-codex.js: parche sin plan -> stderr lleva [SDD_PIPELINE_BLOCK]', () => {
  const root = proyectoSinPlan();
  const filePath = path.join(root, 'src', 'auth', 'login.js');

  const r = runHook('sdd-pipeline-guard-codex.js', { tool_name: 'apply_patch', tool_input: { file_path: filePath } });

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.stderr, /\[SDD_PIPELINE_BLOCK\]/);
});

test('sdd-pipeline-guard.js: ruta no legible -> stderr lleva [SDD_PIPELINE_ADVISORY], no BLOCK', () => {
  const r = runHook('sdd-pipeline-guard.js', { tool_name: 'Write', tool_input: {} });

  assert.match(r.stderr, /\[SDD_PIPELINE_ADVISORY\]/);
  assert.doesNotMatch(r.stderr, /\[SDD_PIPELINE_BLOCK\]/);
});

test('sdd-commit-guard.js: git commit --no-verify -> stderr lleva [SDD_COMMIT_BLOCK]', () => {
  const r = runHook('sdd-commit-guard.js', { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "fix: algo"' } });

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.stderr, /\[SDD_COMMIT_BLOCK\]/);
});

test('sdd-commit-guard-codex.js: git commit --no-verify -> stderr lleva [SDD_COMMIT_BLOCK] (misma firma que Claude)', () => {
  const r = runHook('sdd-commit-guard-codex.js', { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "fix: algo"' } });

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.stderr, /\[SDD_COMMIT_BLOCK\]/);
});

// El guard de commit lista VARIAS violaciones en un solo veredicto
// (subject demasiado largo + tipo invalido). Cada item de la lista lleva su propia firma: "no
// solo el primero" se cumple por item, no solo por veredicto.
test('sdd-commit-guard.js: multiples violaciones de formato en un commit -> CADA item lleva su firma advisory, no solo el primero', () => {
  const subjectLargo = 'tipoinvalido: ' + 'x'.repeat(80);
  const r = runHook('sdd-commit-guard.js', { tool_name: 'Bash', tool_input: { command: 'git commit -m "' + subjectLargo + '"' } });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.decision.reason, /COMMIT_SUBJECT_TOO_LONG/);
  assert.match(r.decision.reason, /COMMIT_TYPE_INVALID/);
  // Dos violaciones en el commit -> dos apariciones de la firma, una por item de la lista.
  const apariciones = (r.stderr.match(/\[SDD_COMMIT_ADVISORY\]/g) || []).length;
  assert.strictEqual(apariciones, 2);
});

test('sdd-turn-budget.js: enforce + hilo principal supera block_at -> stderr lleva [SDD_TURN_BLOCK]', () => {
  const dir = tempDir('sdd-gate-firmas-turnos-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify({
    sdd_turn_budget: { enabled: true, mode: 'enforce', warn_at: 1, block_at: 2, hard_stop_at: 10 },
  }));
  const env = { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_TURNS_DIR: dir };
  const accion = { tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: 'sesion-firma-turnos' };

  let r;
  for (let i = 0; i < 2; i++) r = runHook('sdd-turn-budget.js', accion, env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.stderr, /\[SDD_TURN_BLOCK\]/);
});

test('sdd-turn-budget.js: modo advisory supera block_at -> stderr lleva [SDD_TURN_ADVISORY], no BLOCK', () => {
  const dir = tempDir('sdd-gate-firmas-turnos-adv-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify({
    sdd_turn_budget: { enabled: true, mode: 'advisory', warn_at: 1, block_at: 2, hard_stop_at: 10 },
  }));
  const env = { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_TURNS_DIR: dir };
  const accion = { tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: 'sesion-firma-turnos-adv' };

  let r;
  for (let i = 0; i < 2; i++) r = runHook('sdd-turn-budget.js', accion, env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.stderr, /\[SDD_TURN_ADVISORY\]/);
  assert.doesNotMatch(r.stderr, /\[SDD_TURN_BLOCK\]/);
});

test('sdd-review-gate.js: commit sin senal de revision -> stderr lleva [SDD_REVIEW_BLOCK]', () => {
  const dir = tempDir('sdd-gate-firmas-review-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify({ sdd_review_gate: { enabled: true, ttl_hours: 4 } }));
  const env = {
    SDD_CONFIG_PATH: path.join(dir, 'config.json'),
    SDD_SIGNAL_DIR: dir,
    SDD_STAGED_DIFF: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n',
  };
  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, session_id: 'sesion-firma-review' };

  const r = runHook('sdd-review-gate.js', payload, env);

  assert.strictEqual(r.decision.decision, 'deny');
  assert.match(r.stderr, /\[SDD_REVIEW_BLOCK\]/);
});

test('sdd-review-gate.js: sin diff cacheado -> stderr lleva [SDD_REVIEW_ADVISORY], no BLOCK', () => {
  const dir = tempDir('sdd-gate-firmas-review-adv-');
  writeFile(path.join(dir, 'config.json'), JSON.stringify({ sdd_review_gate: { enabled: true, ttl_hours: 4 } }));
  const env = { SDD_CONFIG_PATH: path.join(dir, 'config.json'), SDD_SIGNAL_DIR: dir, SDD_STAGED_DIFF: '' };
  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, session_id: 'sesion-firma-review-adv' };

  const r = runHook('sdd-review-gate.js', payload, env);

  assert.strictEqual(r.decision.decision, 'warn');
  assert.match(r.stderr, /\[SDD_REVIEW_ADVISORY\]/);
  assert.doesNotMatch(r.stderr, /\[SDD_REVIEW_BLOCK\]/);
});

test('sdd-read-before-edit.js: escritura sin lectura previa -> stderr lleva [SDD_READ_EDIT_ADVISORY] (nunca bloquea)', () => {
  const dir = tempDir('sdd-gate-firmas-read-');
  const filePath = writeFile(path.join(dir, 'existente.txt'), 'contenido');

  const r = runHook('sdd-read-before-edit.js', {
    tool_name: 'Write',
    tool_input: { file_path: filePath },
    session_id: 'sesion-firma-read',
  });

  assert.strictEqual(r.decision.decision, 'warn');
  assert.strictEqual(r.code, 0);
  assert.match(r.stderr, /\[SDD_READ_EDIT_ADVISORY\]/);
});

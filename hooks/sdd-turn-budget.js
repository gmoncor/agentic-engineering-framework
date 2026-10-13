#!/usr/bin/env node
'use strict';

/**
 * SDD Turn-budget — hook PreToolUse sobre todas las tool calls.
 *
 * Cuenta las acciones de cada agente desde su ultimo commit. Al superar cada
 * umbral avisa (o bloquea, si se configura enforcement) para empujar a crear un
 * checkpoint antes de que la sesion se alargue sin preservar nada:
 *   - warn_at:      aviso ("llevas N acciones sin commit, considera commitear").
 *   - block_at:     presupuesto excedido ("haz commit antes de continuar").
 *   - hard_stop_at: en advisory, propone al usuario un checkpoint; en enforce,
 *                   deniega ("INTERRUMPE y espera instrucciones").
 *
 * COMO CUENTA
 * Un registro de solo-anexado por agente: <tmp>/sdd-turns-<session_id>.log para
 * el hilo principal, <tmp>/sdd-turns-<session_id>-a-<agent_id>.log para cada
 * subagente (con un hash corto en lugar de un `agent_id` de más de 100
 * caracteres) y <tmp>/sdd-turns-<session_id>-sub.log para las llamadas de
 * subagente que no traen `agent_id` (solo `agent_type` o `is_sidechain`); el
 * prefijo `-a-` impide que un `agent_id` caiga en el registro común. Un commit
 * del hilo principal trunca su registro y también el común de subagentes. Así,
 * las acciones de los subagentes no se suman al contador del hilo principal ni
 * entre sí: un workflow que commitea por su cuenta, sin que ningún hook vea el
 * commit, no acumula las acciones de todas sus tasks en un único contador. Una
 * linea por accion contada, y el contador es el numero de lineas. Cada tool call
 * anexa una linea (escritura independiente, sin leer el estado anterior); una
 * tool call de shell que invoque `git commit` de verdad trunca el registro (el
 * commit es el checkpoint que el budget vigila). El estado vive fuera del
 * proceso porque cada tool call es una invocacion distinta del hook, y el
 * anexado evita el leer-modificar-escribir que pierde incrementos cuando varias
 * llamadas concurren en la misma sesion (p.ej. el fan-out de subagentes).
 * La invocacion real de `git commit` (frente a una mencion textual, o la misma
 * invocacion con opciones globales de por medio) se decide con el criterio
 * compartido de sdd-git-command.js, el mismo que usan los guards hermanos.
 * Al anexar o truncar se purgan (best-effort) los ficheros `sdd-turns-*.log`
 * de otras sesiones con mas de 24h sin actividad, para que no se acumulen
 * indefinidamente en maquinas de larga duracion.
 *
 * MODO (config .mode)
 *   - "advisory" (default): los tres umbrales AVISAN, nunca bloquean.
 *   - "enforce": block_at y hard_stop_at DENIEGAN la accion; warn_at sigue avisando.
 *   Cualquier otro valor degrada a advisory (nunca bloquea por un modo desconocido).
 *
 * SUBAGENTES
 *   Un subagente no commitea: el commit lo hace quien coordina. Por eso nunca se
 *   le deniega (nadie en ese hilo puede "esperar instrucciones del usuario") y
 *   sus avisos, en cualquier modo, no le piden commitear ni interrumpir: le
 *   piden terminar la task o devolver el motivo si no cabe. Cuando el payload
 *   trae `agent_id`, `agent_type` o `is_sidechain` (presentes unicamente cuando
 *   la llamada se origina dentro de un subagente) se aplica ese trato. El hilo
 *   principal (sin esos campos) sigue denegado en enforce igual que antes.
 *
 * DEGRADACION SEGURA (nunca rompe por infraestructura):
 *   - enabled: false -> silencio. Sin `enabled` (o sin config) el hook corre: su valor por
 *     defecto vive en HOOK_ENABLED_DEFAULTS de sdd-hook-utils.js.
 *   - SDD_GUARD_SKIP=1 -> bypass (escape de emergencia, no cuenta ni avisa).
 *   - Sin session_id: no hay sesion que correlacionar ni donde persistir -> silencio.
 *   - Fichero de contador corrupto o disco de solo lectura -> contador a 0 y sigue.
 *
 * Single-repo: el reset se ata al comando `git commit` observado, sin resolver la
 * raiz del repositorio. Configurable en hooks/config.json (sdd_turn_budget).
 * SDD_TURNS_DIR redirige el directorio del contador (tests, tmp efímero); sin ella,
 * la subcarpeta propia del temporal del sistema (hookStateDir en sdd-hook-utils.js).
 */

const fs = require('fs');
const path = require('path');
const {
  readPayload, readToolCall, warn, deny, skipRequested, loadConfig, hookEnabled, purgeHookState, runWithFailOpen,
  sessionStatePath, hookStateDir,
} = require('./sdd-hook-utils');
const { esInvocacion } = require('./sdd-git-command');

// Claude Code, Gemini CLI, Antigravity CLI, Codex.
const SHELL_TOOLS = new Set(['Bash', 'run_shell_command', 'run_command', 'shell']);

// Firmas estables (ver hooks/gate-signatures.json): distinguen el mensaje que deniega (hilo
// principal en modo enforce) del que solo avisa (warn_at, modo advisory, o subagente).
const BLOCK_FIRMA = '[SDD_TURN_BLOCK] ';
const ADVISORY_FIRMA = '[SDD_TURN_ADVISORY] ';

const DEFAULTS = { warn_at: 30, block_at: 60, hard_stop_at: 90 };
const TTL_MS = 24 * 60 * 60 * 1000; // 24h: ficheros de sesiones sin actividad reciente se purgan

function turnsDir() {
  return hookStateDir(process.env.SDD_TURNS_DIR);
}

const AGENT_ID_MAX = 100;

// Clave del registro: el hilo principal cuenta en el de la sesión; cada
// subagente, en el suyo (`<session>-a-<agent_id>`; el prefijo `-a-` impide que
// un `agent_id` como `sub` comparta el registro común); un subagente sin
// `agent_id` (solo `agent_type` o `is_sidechain`), en uno común de
// subagentes (`<session>-sub`), separado siempre del hilo principal. Un
// `agent_id` de más de AGENT_ID_MAX caracteres se sustituye por un hash corto
// para que el nombre de fichero no crezca sin límite.
function registryKey(data, sessionId) {
  if (data && data.agent_id) {
    const id = String(data.agent_id);
    const parte = id.length > AGENT_ID_MAX
      ? 'h' + require('crypto').createHash('sha1').update(id).digest('hex').slice(0, 12)
      : id;
    return sessionId + '-a-' + parte;
  }
  if (isSubagentCall(data)) return sessionId + '-sub';
  return sessionId;
}

function turnsPath(key) {
  return sessionStatePath(turnsDir(), 'sdd-turns-', key, '.log');
}

// Contador actual de la sesion: numero de lineas del registro. 0 si no hay
// fichero (nada contado aun) o si el registro es ilegible: un registro que no
// se puede leer no debe convertirse en un bloqueo espurio.
function countActions(key) {
  try {
    const raw = fs.readFileSync(turnsPath(key), 'utf8');
    return raw === '' ? 0 : raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// Anexa una linea por accion: una escritura independiente por llamada, sin leer
// el estado anterior. Sin leer-modificar-escribir no hay incremento que pisar
// cuando varias llamadas concurren sobre la misma sesion.
function appendAction(key) {
  const file = turnsPath(key);
  try {
    fs.appendFileSync(file, '1\n');
  } catch {
    // Disco lleno o de solo lectura: la accion no se cuenta. Se acepta: la
    // alternativa es que el hook impida trabajar por no poder escribir en el
    // temporal.
    return;
  }
  // Purga oportunista: retira registros de sesiones anteriores sin actividad
  // en el último TTL. Ver purgeHookState en sdd-hook-utils.js.
  purgeHookState(turnsDir(), 'sdd-turns-', file, TTL_MS);
}

// El commit es el checkpoint que el budget vigila: trunca el registro a vacio.
function resetActions(key) {
  const file = turnsPath(key);
  try {
    fs.writeFileSync(file, '');
  } catch {
    return;
  }
  purgeHookState(turnsDir(), 'sdd-turns-', file, TTL_MS);
}

// Umbral configurado, o su default. <= 0 desactiva ese tier.
function threshold(cfg, key) {
  const n = Number(cfg[key]);
  return Number.isFinite(n) ? n : DEFAULTS[key];
}

// `agent_id`/`is_sidechain`/`agent_type` solo aparecen en el payload cuando la
// tool call se origina dentro de un subagente (contrato de hooks de Claude
// Code); el hilo principal nunca los trae. Comprobar las tres senales evita
// que un payload que solo trae `is_sidechain` se trate como hilo principal.
function isSubagentCall(data) {
  return !!(data && (data.agent_id || data.is_sidechain || data.agent_type));
}

function avisoWarn(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit. Considera hacer commit '
    + 'para crear un checkpoint antes de continuar.';
}

function avisoBlock(count) {
  return 'SDD: has excedido el presupuesto de ' + count + ' acciones sin commit. '
    + 'Haz commit antes de continuar.';
}

// Solo en enforce: acompaña al deny del hilo principal, que sí es una barrera.
function avisoHardStop(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit. INTERRUMPE y espera '
    + 'instrucciones del usuario antes de continuar.';
}

// Advisory: el aviso no es una barrera, así que no ordena interrumpir; propone
// el checkpoint para que lo decida el usuario.
function avisoHardStopAdvisory(count) {
  return 'SDD: llevas ' + count + ' acciones sin commit, por encima del presupuesto '
    + 'duro. Propón al usuario un checkpoint (commit) antes de seguir.';
}

// Un subagente no commitea: el commit lo hace quien coordina. Su aviso le pide
// lo único que puede hacer él: cerrar la task o devolver el motivo.
function avisoSubagente(count) {
  return 'SDD: llevas ' + count + ' acciones en este subagente. El commit lo hace '
    + 'quien coordina: termina la task o devuelve el motivo si no cabe.';
}

// Un subagente nunca se deniega ni recibe la orden de commitear: avisa con un
// mensaje que puede accionar él mismo, en cualquier modo. El hilo principal se
// deniega en enforce igual que siempre y en advisory solo avisa.
function decidir(count, enforce, subagent, mensajeAdvisory, mensajeEnforce, call, code) {
  if (subagent) return warn(ADVISORY_FIRMA + avisoSubagente(count), call, code);
  if (!enforce) return warn(ADVISORY_FIRMA + mensajeAdvisory(count), call, code);
  return deny(BLOCK_FIRMA + mensajeEnforce(count), call, code);
}

async function main() {
  const data = await readPayload();
  if (!data) process.exit(0);

  const cfg = loadConfig(path.join(__dirname, 'config.json')).sdd_turn_budget || {};
  if (!hookEnabled('sdd_turn_budget', cfg)) process.exit(0);
  if (skipRequested()) process.exit(0);

  const sessionId = data.session_id || data.sessionId || '';
  if (!sessionId) process.exit(0);

  const call = readToolCall(data);
  const subagent = isSubagentCall(data);
  const key = registryKey(data, sessionId);

  // El commit es el checkpoint que el budget vigila: reinicia la cuenta. `git
  // add` es el unico paso previo que no se deniega (mas abajo): sin la
  // exencion, prepararlo con el presupuesto superado queda bloqueado por la
  // misma tool call que hace falta para poder commitear, y el ciclo no tiene
  // salida legitima. `git add` no resetea la cuenta -- solo el commit es
  // checkpoint. El comando llega como `command` (Claude Code, Gemini CLI,
  // Codex) o como `CommandLine` (Antigravity CLI); la invocacion real (frente
  // a una mencion textual) se decide con el criterio compartido.
  const cmd = String(call.input.command || call.input.CommandLine || '');
  if (SHELL_TOOLS.has(call.name) && esInvocacion(cmd, 'git', ['commit'])) {
    resetActions(key);
    // El commit del hilo principal es el checkpoint de lo que hicieron los
    // subagentes sin `agent_id`: su registro común también vuelve a cero.
    if (!subagent) resetActions(sessionId + '-sub');
    process.exit(0);
  }

  appendAction(key);
  const count = countActions(key);

  const exento = SHELL_TOOLS.has(call.name) && esInvocacion(cmd, 'git', ['add']);
  const enforce = cfg.mode === 'enforce' && !exento;

  if (count >= threshold(cfg, 'hard_stop_at')) {
    return decidir(
      count, enforce, subagent, avisoHardStopAdvisory, avisoHardStop, call,
      'TURN_BUDGET_HARD_STOP'
    );
  }
  if (count >= threshold(cfg, 'block_at')) {
    return decidir(
      count, enforce, subagent, avisoBlock, avisoBlock, call,
      'TURN_BUDGET_BLOCK'
    );
  }
  if (count >= threshold(cfg, 'warn_at')) {
    const mensaje = subagent ? avisoSubagente(count) : avisoWarn(count);
    return warn(ADVISORY_FIRMA + mensaje, call, 'TURN_BUDGET_WARN');
  }

  process.exit(0);
}

// El fallo interno sale por runWithFailOpen (exit 0 + aviso firmado), nunca como veredicto.
if (require.main === module) {
  runWithFailOpen('sdd-turn-budget', main);
}

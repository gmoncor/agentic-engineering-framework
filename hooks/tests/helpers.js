'use strict';

// Infra compartida por los tests de hooks: ejecuta un hook como proceso real
// (mismo contrato que la CLI: payload JSON por stdin, decision por stdout).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS_DIR = path.resolve(__dirname, '..');

function runHook(hookName, payload, env) {
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, hookName)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10000,
    env: Object.assign({}, process.env, env || {}),
  });

  let decision = null;
  try {
    decision = JSON.parse((result.stdout || '').trim());
  } catch {
    decision = null;
  }
  return { code: result.status, decision, stdout: result.stdout, stderr: result.stderr };
}

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

// Contrato verificado por sdd-review-gate.test.js y session-analyzer.test.js: solo
// existen en instalaciones con el backend Claude Code (motor de workflows). Un
// backend Gemini/Codex/Antigravity-only no los trae, y eso es correcto, no un bug.
function motorDeWorkflowsInstalado() {
  const claudeDir = path.resolve(HOOKS_DIR, '..', '.claude');
  return fs.existsSync(path.join(claudeDir, 'workflows', 'implementar-spec.js'))
    && fs.existsSync(path.join(claudeDir, 'settings.json'));
}

module.exports = { runHook, tempDir, writeFile, HOOKS_DIR, motorDeWorkflowsInstalado };

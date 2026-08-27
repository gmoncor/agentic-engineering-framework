'use strict';

// Verifica scripts/transforms/command-body.js: la funcion traducirReferenciasDeComando
// no debe corromper una ruta absoluta que empieza con barra, y solo debe traducir
// referencias a comandos declarados en el conjunto que recibe como segundo argumento.
//
// Invoca la funcion exportada directamente, sin pasar por el compilador: no escribe
// ningun artefacto ni depende del manifiesto real.

const test = require('node:test');
const assert = require('node:assert');

const { traducirReferenciasDeComando } = require('../scripts/transforms/command-body');

const COMANDOS_CONOCIDOS = new Set(['planificar', 'auditar', 'estado']);

test('una ruta absoluta al inicio de frase sobrevive intacta', () => {
  const entrada = 'Ver /ai_docs/tasks/spec_x.md para el formato.';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

test('una ruta absoluta precedida de espacio en medio de frase sobrevive intacta', () => {
  const entrada = 'Guarda el resultado en /tmp/salida.md antes de continuar.';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

test('una ruta absoluta precedida de dos puntos sobrevive intacta', () => {
  const entrada = 'Formato: /ai_docs/tasks/spec_x.md';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

test('una ruta absoluta de un solo tramo sobrevive intacta', () => {
  const entrada = 'Revisa /tmp antes de seguir.';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

test('un comando declarado al inicio de frase se traduce', () => {
  const entrada = '/planificar es el primer paso.';
  assert.strictEqual(
    traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS),
    'la skill `planificar` es el primer paso.'
  );
});

test('un comando declarado en medio de frase se traduce', () => {
  const entrada = 'Ejecuta /auditar cuando termines.';
  assert.strictEqual(
    traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS),
    'Ejecuta la skill `auditar` cuando termines.'
  );
});

test('un comando declarado entre acentos graves se traduce', () => {
  const entrada = 'Usa `/estado` para consultarlo.';
  assert.strictEqual(
    traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS),
    'Usa la skill `estado` para consultarlo.'
  );
});

test('un nombre que no es un comando conocido no se traduce', () => {
  const entrada = '/inexistente no es un comando.';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

test('sin conjunto de comandos conserva el comportamiento actual (traduce cualquier barra+palabra)', () => {
  const entrada = '/planificar es el primer paso.';
  assert.strictEqual(
    traducirReferenciasDeComando(entrada),
    'la skill `planificar` es el primer paso.'
  );
});

test('cuerpo vacio devuelve el texto tal cual', () => {
  assert.strictEqual(traducirReferenciasDeComando('', COMANDOS_CONOCIDOS), '');
});

test('cuerpo sin barras devuelve el texto tal cual', () => {
  const entrada = 'Sin ninguna referencia aqui.';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

test('una barra suelta al final de linea no produce traduccion', () => {
  const entrada = 'Termina con una barra suelta /';
  assert.strictEqual(traducirReferenciasDeComando(entrada, COMANDOS_CONOCIDOS), entrada);
});

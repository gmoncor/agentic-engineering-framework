'use strict';

// Coherencia interna de la plantilla de roadmap.
//
// `ai_docs/core_templates/03_roadmap_de_desarrollo.md` prescribe como se pasa
// de un roadmap a tasks implementadas. El paso 4 de "De roadmap a
// implementacion" dice que las tasks se implementan una tras otra en orden de
// dependencias; las "Reglas inquebrantables" del mismo fichero deben decir lo
// mismo, no lo contrario. Este test fija esa coherencia: si alguien reintroduce
// una regla que prescribe ejecutar tasks en paralelo, falla.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RUTA_PLANTILLA = path.join(__dirname, '..', 'ai_docs', 'core_templates', '03_roadmap_de_desarrollo.md');

function leerPlantilla() {
  return fs.readFileSync(RUTA_PLANTILLA, 'utf8');
}

function lineaDeRegla(texto, numero) {
  const lineas = texto.split('\n');
  const linea = lineas.find(l => new RegExp(`^${numero}\\.\\s`).test(l.trim()));
  assert.ok(linea, `No se encontro la regla ${numero} en "Reglas inquebrantables" de ${RUTA_PLANTILLA}`);
  return linea;
}

test('la plantilla de roadmap no prescribe paralelizar tasks', () => {
  const texto = leerPlantilla();
  assert.doesNotMatch(
    texto,
    /tasks? independientes se paralelizan/i,
    'La plantilla vuelve a prescribir ejecutar tasks independientes en paralelo, '
      + 'contradiciendo el modelo lineal (una tras otra, en orden de dependencias).'
  );
});

test('la regla 8 de "Reglas inquebrantables" es coherente con el modelo lineal', () => {
  const texto = leerPlantilla();
  const regla8 = lineaDeRegla(texto, 8);

  assert.match(
    regla8,
    /una tras otra/i,
    `La regla 8 ("${regla8.trim()}") no menciona el orden lineal de implementacion.`
  );
  assert.doesNotMatch(
    regla8,
    /\bse paralelizan\b/i,
    `La regla 8 ("${regla8.trim()}") vuelve a habilitar ejecucion en paralelo.`
  );
});

test('la regla 8 no contradice el paso 4 de "De roadmap a implementacion"', () => {
  const texto = leerPlantilla();
  const regla8 = lineaDeRegla(texto, 8);

  assert.ok(
    /Implementar las tasks una tras otra en orden de dependencias/.test(texto),
    'El paso 4 de "De roadmap a implementacion" cambio de redaccion; '
      + 'revisar que siga alineado con la regla 8 reescrita.'
  );
  assert.match(
    regla8,
    /orden/i,
    `La regla 8 ("${regla8.trim()}") no referencia el orden de implementacion del paso 4.`
  );
});

test('las menciones de "paralelizar" fuera de la regla 8 se refieren a specs, no a tasks', () => {
  const texto = leerPlantilla();
  const lineas = texto.split('\n');
  const lineasConParalelo = lineas.filter(l => /paralel/i.test(l));

  assert.ok(lineasConParalelo.length > 0, 'La plantilla ya no menciona "paralelo" en ningun sitio; revisar si el test sigue teniendo sentido.');

  for (const linea of lineasConParalelo) {
    assert.doesNotMatch(
      linea,
      /tasks? .*paralel|paralel.* tasks?/i,
      `La linea "${linea.trim()}" asocia "paralelo" a tasks, no a specs: deberia hablar de reparto de trabajo entre personas o specs.`
    );
  }
});

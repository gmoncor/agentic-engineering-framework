'use strict';

// Ensambla un documento de instrucciones raiz desde dos fuentes: el nucleo
// compartido (`docs-src/core.md`), que guarda las secciones comunes a varios
// backends, y el fragmento del backend (`docs-src/fragments/<backend>.md`), que
// aporta el orden del documento y sus secciones propias.
//
// Dos delimitadores, cada uno en una linea propia:
//   <!-- nucleo: <id> -->  en el nucleo abre la seccion <id> (llega hasta el
//                          siguiente delimitador); en un fragmento inserta ahi
//                          esa seccion.
//   <!-- hueco: <id> -->   en el nucleo marca el punto donde cada backend pone
//                          su variante; en un fragmento abre el bloque que la
//                          rellena, que se cierra con <!-- /hueco -->.
//
// En el nucleo, el texto anterior al primer `nucleo:` es preambulo y no se
// emite. En un fragmento no hay preambulo: todo lo que no sea un bloque de
// hueco es cuerpo del documento.
//
// El texto viaja literal a la salida salvo los marcadores `{{CLAVE}}`, que el
// ensamblado sustituye por el valor que la compilacion pasa en
// `entrada.variables`. Asi la version del documento generado
// (`<!-- sdd-framework: {{VERSION}} -->`) sale de `package.json` y no de una
// copia a mano que se queda atras. Una clave sin valor es un error: mas vale no
// generar el documento que emitirlo con el marcador sin resolver.

const MARCA_NUCLEO = /^<!--\s*nucleo:\s*([a-z0-9-]+)\s*-->$/;
const MARCA_HUECO = /^<!--\s*hueco:\s*([a-z0-9-]+)\s*-->$/;
const MARCA_FIN_HUECO = /^<!--\s*\/hueco\s*-->$/;
const MARCA_VARIABLE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** Id que captura `patron` en `linea`, o null si la linea no es ese delimitador. */
function idDelimitador(patron, linea) {
  const coincidencia = patron.exec(linea.trim());
  return coincidencia ? coincidencia[1] : null;
}

/** Secciones del nucleo indexadas por id. Descarta el preambulo previo al primer delimitador. */
function parsearNucleo(contenido) {
  const secciones = new Map();
  let actual = null;

  for (const linea of contenido.split('\n')) {
    const id = idDelimitador(MARCA_NUCLEO, linea);
    if (id) {
      actual = [];
      secciones.set(id, actual);
      continue;
    }
    if (actual) actual.push(linea);
  }

  return secciones;
}

/** Separa el fragmento en `cuerpo` (lineas del documento) y `huecos` (bloques que rellenan el nucleo). */
function parsearFragmento(contenido) {
  const cuerpo = [];
  const huecos = new Map();
  let abierto = null;

  for (const linea of contenido.split('\n')) {
    if (abierto) {
      if (MARCA_FIN_HUECO.test(linea.trim())) abierto = null;
      else abierto.push(linea);
      continue;
    }

    const id = idDelimitador(MARCA_HUECO, linea);
    if (!id) {
      cuerpo.push(linea);
      continue;
    }

    abierto = [];
    huecos.set(id, abierto);
  }

  return { cuerpo, huecos };
}

/** Seccion del nucleo con sus huecos ya sustituidos por los bloques del backend. */
function expandirHuecos(seccion, huecos, backend) {
  const salida = [];

  for (const linea of seccion) {
    const id = idDelimitador(MARCA_HUECO, linea);
    if (!id) {
      salida.push(linea);
      continue;
    }

    const relleno = huecos.get(id);
    if (!relleno) {
      throw new Error(`FRAGMENT_NOT_FOUND: el backend "${backend}" no rellena el hueco "${id}" del nucleo.`);
    }
    salida.push(...relleno);
  }

  return salida;
}

/** Cuerpo del fragmento con cada delimitador `nucleo:` sustituido por su seccion expandida. */
function insertarSecciones(cuerpo, secciones, huecos, backend) {
  const salida = [];

  for (const linea of cuerpo) {
    const id = idDelimitador(MARCA_NUCLEO, linea);
    if (!id) {
      salida.push(linea);
      continue;
    }

    const seccion = secciones.get(id);
    if (!seccion) {
      throw new Error(`SECTION_NOT_FOUND: el nucleo no define la seccion "${id}" que pide el backend "${backend}".`);
    }
    salida.push(...expandirHuecos(seccion, huecos, backend));
  }

  return salida;
}

/** Recorta el blanco final de cada linea, colapsa blancos consecutivos y cierra con un unico salto. */
function normalizar(lineas) {
  const limpias = [];

  for (const linea of lineas) {
    const recortada = linea.replace(/\s+$/, '');
    if (recortada === '' && limpias[limpias.length - 1] === '') continue;
    limpias.push(recortada);
  }

  while (limpias.length && limpias[0] === '') limpias.shift();
  while (limpias.length && limpias[limpias.length - 1] === '') limpias.pop();

  return `${limpias.join('\n')}\n`;
}

/** `texto` con cada `{{CLAVE}}` sustituida por su valor. Una clave sin valor lanza. */
function interpolar(texto, variables = {}) {
  return texto.replace(MARCA_VARIABLE, (marcador, clave) => {
    if (!(clave in variables)) {
      throw new Error(`VARIABLE_NOT_FOUND: la compilacion no define un valor para "${marcador}".`);
    }
    return variables[clave];
  });
}

/** Documento raiz del backend de `entrada`, ensamblado desde el nucleo y su fragmento. */
function ensamblarDocumento(nucleoContenido, fragmentoContenido, entrada = {}) {
  const backend = (entrada.output && entrada.output.backend) || entrada.backend || 'desconocido';

  if (typeof fragmentoContenido !== 'string') {
    throw new Error(`FRAGMENT_NOT_FOUND: la entrada "${entrada.id}" no declara fragmento para el backend "${backend}".`);
  }

  const secciones = parsearNucleo(nucleoContenido);
  const { cuerpo, huecos } = parsearFragmento(fragmentoContenido);
  const documento = normalizar(insertarSecciones(cuerpo, secciones, huecos, backend));

  return interpolar(documento, entrada.variables);
}

module.exports = { ensamblarDocumento, parsearNucleo, parsearFragmento, normalizar, interpolar };

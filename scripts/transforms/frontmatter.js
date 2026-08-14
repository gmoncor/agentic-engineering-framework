'use strict';

// Utilidades compartidas por los transforms que traducen un artefacto de un
// formato a otro: lectura del frontmatter YAML de un fichero Markdown, su
// reserializacion, y el escapado de valores hacia TOML.
//
// El parser es deliberadamente estrecho: cubre la forma que usan los
// artefactos del framework (claves escalares y listas de bloque `- item`) y
// falla en voz alta ante cualquier otra. No es un parser YAML general.

/** Campo del frontmatter: clave, valor crudo tal cual aparece y lineas de continuacion. */
function nuevoCampo(clave, valor) {
  return { clave, valor, extra: [] };
}

const LINEA_CAMPO = /^([A-Za-z0-9_-]+):[ \t]?(.*)$/;

/**
 * Indice de la linea `---` que abre el frontmatter. Salta las lineas en blanco
 * y un unico comentario HTML de cabecera, que los ficheros de `docs-src/` usan
 * para explicar su papel sin que ese texto llegue a ninguna salida. Devuelve
 * -1 si no hay apertura de frontmatter.
 */
function inicioFrontmatter(lineas) {
  let i = 0;
  while (i < lineas.length && lineas[i].trim() === '') i++;

  if (lineas[i] !== undefined && lineas[i].trimStart().startsWith('<!--')) {
    while (i < lineas.length && !lineas[i].includes('-->')) i++;
    i++;
    while (i < lineas.length && lineas[i].trim() === '') i++;
  }

  return lineas[i] === '---' ? i : -1;
}

/**
 * Separa `contenido` en `campos` (frontmatter) y `cuerpo` (el resto, sin la
 * linea en blanco que sigue al cierre). Lanza `MISSING_FRONTMATTER` si el
 * fichero no abre con `---` y `PARSE_ERROR` si el bloque no cierra o contiene
 * una linea que no es ni campo ni continuacion.
 */
function parsearFrontmatter(contenido, origen = 'desconocido') {
  const lineas = contenido.split('\n');
  const apertura = inicioFrontmatter(lineas);
  if (apertura === -1) {
    throw new Error(`MISSING_FRONTMATTER: "${origen}" no abre con un bloque de frontmatter.`);
  }

  const campos = [];
  let cierre = -1;

  for (let i = apertura + 1; i < lineas.length; i++) {
    if (lineas[i] === '---') {
      cierre = i;
      break;
    }

    const coincidencia = LINEA_CAMPO.exec(lineas[i]);
    if (coincidencia) {
      campos.push(nuevoCampo(coincidencia[1], coincidencia[2]));
      continue;
    }
    if (!campos.length || !/^\s+\S/.test(lineas[i])) {
      throw new Error(`PARSE_ERROR: "${origen}" tiene una linea de frontmatter ilegible: "${lineas[i]}".`);
    }
    campos[campos.length - 1].extra.push(lineas[i]);
  }

  if (cierre === -1) {
    throw new Error(`PARSE_ERROR: "${origen}" abre frontmatter pero no lo cierra.`);
  }

  return { campos, cuerpo: lineas.slice(cierre + 1).join('\n').replace(/^\n+/, '') };
}

/** Campo `clave` de `campos`, o `undefined` si no esta declarado. */
function campoDe(campos, clave) {
  return campos.find(campo => campo.clave === clave);
}

/** Valor crudo (con comillas si las lleva) del campo `clave`, o `undefined`. */
function valorCrudo(campos, clave) {
  const campo = campoDe(campos, clave);
  return campo ? campo.valor : undefined;
}

/** Valor del campo `clave` ya sin comillas. Lanza si el campo no existe. */
function valorObligatorio(campos, clave, origen) {
  const crudo = valorCrudo(campos, clave);
  if (crudo === undefined || crudo === '') {
    throw new Error(`MISSING_FIELD: "${origen}" no declara el campo obligatorio "${clave}".`);
  }
  return desentrecomillar(crudo);
}

/** Texto de un escalar YAML entrecomillado; lo devuelve intacto si no lo esta. */
function desentrecomillar(crudo) {
  const recortado = crudo.trim();
  if (recortado.length >= 2 && recortado.startsWith('"') && recortado.endsWith('"')) {
    return recortado.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return recortado;
}

/** Items de una lista de bloque (`- item`) o de una lista en linea (`[a, b]`). Lista vacia si no hay campo. */
function listaDe(campos, clave) {
  const campo = campoDe(campos, clave);
  if (!campo) return [];

  const enLinea = campo.valor.trim();
  if (enLinea.startsWith('[')) {
    return enLinea.replace(/^\[|\]$/g, '').split(',').map(item => item.trim()).filter(Boolean);
  }
  return campo.extra.map(linea => linea.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

/** Bloque de frontmatter (delimitadores incluidos) terminado en salto de linea. */
function serializarFrontmatter(campos) {
  const lineas = ['---'];
  for (const { clave, valor, extra } of campos) {
    lineas.push(valor === '' || valor === undefined ? `${clave}:` : `${clave}: ${valor}`);
    lineas.push(...(extra || []));
  }
  lineas.push('---', '');
  return lineas.join('\n');
}

/** Documento Markdown completo: frontmatter, linea en blanco y cuerpo. */
function componerMarkdown(campos, cuerpo) {
  return `${serializarFrontmatter(campos)}\n${cuerpo}`;
}

/** `valor` como cadena basica de TOML, con comillas y escapes. */
function aTomlBasico(valor) {
  return `"${String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `texto` como cadena multilinea de TOML. Espera que `texto` acabe en salto de linea. */
function aTomlMultilinea(texto) {
  const escapado = String(texto).replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  const cerrado = escapado.endsWith('\n') ? escapado : `${escapado}\n`;
  return `"""\n${cerrado}"""`;
}

module.exports = {
  parsearFrontmatter,
  valorCrudo,
  valorObligatorio,
  listaDe,
  serializarFrontmatter,
  componerMarkdown,
  aTomlBasico,
  aTomlMultilinea,
  nuevoCampo,
};

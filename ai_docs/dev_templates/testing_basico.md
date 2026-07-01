# Plantilla de Testing

> **Cuando usar:** Cuando quieras escribir tests para verificar que tu codigo funciona, o mejorar tests existentes. En el flujo SDD, los tests se escriben durante la implementacion de cada task.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Luego indica que modulo o funcion quieres testear.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si las instrucciones del usuario son vagas, incompletas o potencialmente erroneas, HAZ PREGUNTAS de clarificacion. No adivines.
2. **MUESTRA antes de ejecutar** — Presenta los tests propuestos al usuario ANTES de crearlos.
3. **EXPLICA el porque** — Para cada test, explica QUE escenario cubre y POR QUE es importante.
4. **SUGIERE mejoras** — Si detectas areas sin tests o tests de baja calidad, mencionalos.
5. **VERIFICA despues** — Ejecuta los tests y muestra los resultados.
6. **ESCALA cuando corresponda** — Si no hay infraestructura de testing, sugiere configurarla primero con `core_templates/04_setup_testing.md`.
7. **NUNCA asumas que la primera solucion es la mejor** — Si hay varias formas de testear algo, menciona las opciones.

**Instrucciones adicionales para esta plantilla:**
- La CALIDAD de los tests importa mas que la CANTIDAD. Un test que no verifica nada real es peor que no tener test.
- NUNCA escribas tests que solo comprueban que "algo no falla" sin verificar el resultado concreto.
- Si se corrige un bug, SIEMPRE incluir un test de regresion que lo reproduzca.
- RESPETA el framework de testing existente. Si el proyecto usa Jest, no propongas migrar a Vitest.
- Solo escribe tests para el codigo que se esta modificando o creando. NO crees suites de tests masivas para codigo que ya existe y no se ha tocado.
- En el flujo SDD, cada task debe tener sus tests. No dejes los tests para el final de todas las tasks.

---

## Conceptos basicos (para quienes empiezan)

### Que es un test?
Un test es codigo que verifica que otro codigo funciona como se espera. En lugar de probar manualmente "hago clic aqui y deberia aparecer X", escribes codigo que lo comprueba automaticamente.

### Por que testear?
- **Detectar errores antes** de que lleguen a produccion
- **Evitar regresiones** — que un cambio nuevo rompa algo que ya funcionaba
- **Documentar comportamiento** — los tests describen que deberia hacer el codigo
- **Mas confianza al cambiar codigo** — si los tests pasan, probablemente no rompiste nada

### Estructura de un test (patron AAA)

Todo test sigue este patron:

```
1. ARRANGE (Preparar)  — configurar datos y dependencias necesarias
2. ACT (Actuar)        — ejecutar UNA accion
3. ASSERT (Verificar)  — comprobar que el resultado es el esperado
```

**Un test = una accion.** Si necesitas probar dos cosas, escribe dos tests.

---

## Paso 1: Evaluar el estado actual

Antes de escribir tests:

1. **Hay framework de testing?** Buscar en la configuracion del proyecto (package.json, pyproject.toml, etc.)
   - Si NO hay: sugerir configurarlo primero con `core_templates/04_setup_testing.md`
   - Si SI hay: usarlo tal cual
2. **Hay tests existentes?** Buscar carpetas `tests/`, `__tests__/`, archivos `*.test.*` o `*.spec.*`
3. **Que funciones/modulos son criticos?** Identificar el codigo que mas importa testear

---

## Paso 2: Elegir que testear

### Priorizar por importancia

| Prioridad | Que testear | Por que |
|-----------|-------------|---------|
| 1. CRITICO | Logica de negocio (calculos, validaciones, reglas) | Es el corazon de la aplicacion |
| 2. ALTO | Integraciones (APIs, base de datos) | Son puntos frecuentes de fallo |
| 3. MEDIO | Utilidades compartidas (helpers, formatters) | Muchas partes dependen de ellas |
| 4. BAJO | UI/Presentacion | Cambia frecuentemente, es fragil de testear |

### Proporcionalidad — cuantos tests segun el tipo de cambio

| Tipo de cambio | Tests necesarios |
|----------------|-----------------|
| **Correccion de bug** | 1 test de regresion (RED-GREEN) + tests del codigo directamente afectado |
| **Funcionalidad nueva** | Tests de la funcionalidad: caso normal + caso limite + caso negativo |
| **Refactoring** | Los tests existentes deben seguir pasando — si no hay, escribir antes de refactorizar |
| **Cambio de configuracion** | Verificar que todo sigue funcionando — no necesita tests nuevos |

**NUNCA crees tests masivos para codigo que no has tocado.** Testea lo que modificas.

---

## Paso 3: Disenar los tests

Para cada funcion/modulo, cubrir estos escenarios:

### Escenarios obligatorios (minimo 3 por funcion)

| Tipo | Que prueba | Ejemplo |
|------|------------|---------|
| **Caso normal** | El uso tipico, datos correctos | `getUser(1)` devuelve el usuario |
| **Caso limite** | Valores en los bordes del rango valido | `getUser(0)`, lista con 1 elemento, string vacio |
| **Caso negativo** | Datos invalidos que DEBEN ser rechazados | `getUser(null)` lanza error |

### Ejemplo practico

```
Funcion: calculateDiscount(price, discountPercent)

Tests a escribir:
1. NORMAL:   calculateDiscount(100, 10)  -> 90
2. LIMITE:   calculateDiscount(100, 0)   -> 100 (sin descuento)
3. LIMITE:   calculateDiscount(100, 100) -> 0 (todo gratis)
4. NEGATIVO: calculateDiscount(-10, 10)  -> error (precio negativo)
5. NEGATIVO: calculateDiscount(100, 150) -> error (descuento > 100%)
```

### Que NO testear

No pierdas tiempo con tests que no aportan valor:

- Getters/setters triviales que solo leen o asignan un valor
- Configuracion de frameworks (verificar que Express arranca no es tu responsabilidad)
- Codigo de librerias externas (si usas `dayjs.format()`, confia en que funciona)
- Constantes y enums (no cambian)

---

## Paso 4: Escribir los tests

**Presentar los tests al usuario ANTES de crearlos.**

### Reglas al escribir

- **Nombre descriptivo:** `"devuelve error cuando el email esta vacio"` — no `"test 1"` ni `"deberia funcionar"`
- **Una verificacion por test:** No mezclar multiples comprobaciones
- **Datos minimos:** Solo los datos necesarios para el test, nada mas
- **Independientes:** Cada test funciona solo, sin depender de otros ni del orden de ejecucion
- **Rapidos:** Un test unitario no deberia tardar mas de 50ms

### Parametrizacion — evitar tests duplicados

Si tienes multiples casos que solo cambian los datos de entrada, usa parametrizacion en lugar de copiar y pegar:

**TypeScript (Vitest/Jest):**
```typescript
test.each([
  [100, 10, 90],
  [100, 0, 100],
  [200, 50, 100],
])('calculateDiscount(%i, %i) = %i', (price, discount, expected) => {
  expect(calculateDiscount(price, discount)).toBe(expected);
});
```

**Python (pytest):**
```python
@pytest.mark.parametrize("price, discount, expected", [
    (100, 10, 90),
    (100, 0, 100),
    (200, 50, 100),
])
def test_calculate_discount(price, discount, expected):
    assert calculate_discount(price, discount) == expected
```

---

## Paso 5: Ejecutar y verificar

1. **Ejecutar los tests nuevos** — deben PASAR
2. **Ejecutar TODOS los tests del proyecto** — nada debe haberse roto
3. **Presentar resultados:**

```
## Resultados de testing

**Tests nuevos:** [N] creados, [N] pasan
**Tests existentes:** [N] pasan, [N] fallan

### Tests creados:
- [nombre del test 1]: PASA
- [nombre del test 2]: PASA

### Cobertura (si disponible):
- Lineas: [X]%
- Ramas: [X]%
```

---

## Test de regresion (protocolo RED-GREEN)

Cuando corriges un bug, SIEMPRE seguir este protocolo:

```
1. RED   — Escribir test que REPRODUCE el bug -> Ejecutar -> Debe FALLAR
           (Si pasa sin corregir nada, el test no detecta el bug — reescribirlo)

2. GREEN — Aplicar la correccion -> Ejecutar test -> Debe PASAR

3. EXTRA — Anadir 1-2 casos con valores similares o limites cercanos al bug
```

Esto garantiza que:
- El test realmente detecta el problema (paso 1)
- La correccion realmente lo soluciona (paso 2)
- El bug no volvera en el futuro (paso 3)

---

## Anti-patrones de testing

| Anti-patron | Problema | Solucion |
|-------------|----------|----------|
| Test sin verificacion (`render(<Comp />)` y ya) | No comprueba nada | Anadir `expect(...)` con valor concreto |
| Verificacion generica (`toBeTruthy()`) | No dice que se espera | `toEqual(valorExacto)` |
| `sleep()` o esperas fijas | Test lento y fragil | Usar `waitFor()` o async/await |
| Copiar test cambiando 1 valor | Codigo duplicado | Usar parametrizacion (`test.each` / `parametrize`) |
| Nombre vago (`"deberia funcionar"`) | No dice que prueba | `"devuelve 404 cuando el usuario no existe"` |
| Test que depende de otro test | Si uno falla, todos fallan | Cada test se prepara sus propios datos |
| Test que depende del orden de ejecucion | Falla al ejecutar en paralelo o aleatoriamente | Usar setup/teardown para estado limpio |
| Mock excesivo (mockear todo menos lo que se testea) | No prueba nada real | Solo mockear dependencias externas (APIs, BD), no logica interna |
| Test acoplado a la implementacion | Se rompe al refactorizar aunque el comportamiento no cambie | Testear QUE hace, no COMO lo hace |
| Test que testea el framework | `expect(useState).toBeDefined()` no aporta valor | Solo testear TU codigo |

---

## Reglas inquebrantables

1. **Calidad > Cantidad** — 5 tests buenos valen mas que 50 tests vacios
2. **NUNCA escribir tests que no verifican nada** — todo test necesita un `expect`/`assert` con valor concreto
3. **RESPETAR el framework existente** — no migrar, no cambiar configuracion
4. **Los tests son archivos NUEVOS** — no modifican el codigo de produccion
5. **Si se corrige un bug**, el test de regresion (RED-GREEN) es OBLIGATORIO
6. **Si no hay framework de testing**, sugerir configurarlo con `core_templates/04_setup_testing.md` antes de escribir tests
7. **Solo testear lo que se modifica** — no crear suites masivas para codigo intacto
8. **En el flujo SDD**, cada task incluye sus tests — no dejar testing para despues de todas las tasks

# Plantilla de Setup de Entorno de Testing

> **Cuando usar:** Cuando un proyecto no tiene framework de testing configurado, o le falta coverage o scripts basicos.
> **Como usar:** Copia este documento completo y pegalo en tu asistente de IA. Ejecutar ANTES de escribir tests.

---

## Instrucciones para el Asistente de IA

Estas instrucciones son OBLIGATORIAS. Debes seguirlas en todo momento:

1. **PREGUNTA antes de asumir** — Si no sabes que stack usa el proyecto, PREGUNTA o investiga los archivos de configuracion.
2. **MUESTRA antes de ejecutar** — Presenta el plan de instalacion al usuario y espera confirmacion ANTES de instalar nada.
3. **EXPLICA el porque** — Para cada herramienta que propongas instalar, explica QUE hace y POR QUE es necesaria.
4. **RESPETA lo existente** — Si ya hay un framework de testing configurado, NO lo reemplaces. Solo completa lo que falta.
5. **VERIFICA despues** — Tras la instalacion, ejecuta el framework para confirmar que funciona.
6. **NO sobre-instales** — Solo instalar lo necesario. Si el proyecto no usa React, no instalar Testing Library.

**Instrucciones adicionales para esta plantilla:**
- Este setup es ONE-SHOT e IDEMPOTENTE: si algo ya esta configurado, no tocarlo.
- NUNCA migrar de un framework a otro (de Jest a Vitest, de unittest a pytest, etc.) — respetar lo que hay.
- El objetivo es dejar el proyecto LISTO para escribir tests, no escribir los tests.

---

## Paso 1: Reconocimiento del proyecto

Antes de instalar nada, analizar que tiene el proyecto:

| Pregunta | Como averiguarlo |
|----------|-----------------|
| Que stack usa? | Buscar `package.json` (JS/TS), `pyproject.toml` / `requirements.txt` (Python), `composer.json` (PHP), `manage.py` (Django) |
| Hay framework de testing? | Buscar `vitest.config.*`, `jest.config.*`, `pytest.ini`, `[tool.pytest]` en pyproject, `phpunit.xml`, `Pest.php` |
| Hay tests existentes? | Buscar carpetas `tests/`, `__tests__/`, archivos `*.test.*`, `*.spec.*`, `test_*.py` |
| Hay coverage configurado? | Buscar `coverage` en las configs de testing o en scripts |
| Hay scripts de test? | Buscar `"test"` en scripts de `package.json`, o equivalentes |

**Presentar hallazgos al usuario antes de proponer instalacion.**

---

## Paso 2: Instalacion por stack

### TypeScript / Next.js / React

**Framework recomendado (si no hay ninguno): Vitest**

```bash
# Framework de testing + coverage
npm install -D vitest @vitest/coverage-v8

# Testing Library (solo si el proyecto usa React)
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

**vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom', // Cambiar a 'node' si NO hay frontend
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      exclude: ['node_modules/', '**/*.config.*', '**/*.d.ts', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Scripts en package.json:**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

### Python

**Framework recomendado (si no hay ninguno): pytest**

```bash
# Con pip
pip install pytest pytest-cov pytest-asyncio pytest-mock

# Con uv (si el proyecto usa uv)
uv add --group test pytest pytest-cov pytest-asyncio pytest-mock
```

**Anadir a pyproject.toml:**
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
addopts = "-v --strict-markers --tb=short"

[tool.coverage.run]
source = ["src"]  # Ajustar al directorio raiz del codigo fuente
branch = true
omit = ["*/migrations/*", "*/__init__.py", "*/conftest.py"]

[tool.coverage.report]
show_missing = true
```

**Estructura de carpetas:**
```
tests/
  __init__.py
  conftest.py        # Fixtures compartidas
  test_ejemplo.py    # Un archivo de test de ejemplo
```

---

### Django

**Framework recomendado: pytest-django**

```bash
pip install pytest-django factory-boy pytest-cov

# O con uv
uv add --group test pytest-django factory-boy pytest-cov
```

**Anadir a pyproject.toml:**
```toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "config.settings.test"  # Ajustar a tu proyecto
testpaths = ["tests"]
addopts = "-v --strict-markers --tb=short --reuse-db"
```

**config/settings/test.py (crear si no existe):**
```python
from .base import *  # o from .development import *

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
```

---

### PHP / Laravel

**Framework recomendado: Pest (sobre PHPUnit)**

```bash
composer require pestphp/pest --dev --with-all-dependencies
composer require pestphp/pest-plugin-laravel --dev
php artisan pest:install
```

**Verificar phpunit.xml — anadir coverage si falta:**
```xml
<coverage>
    <include>
        <directory suffix=".php">./app</directory>
    </include>
    <exclude>
        <directory suffix=".php">./app/Providers</directory>
    </exclude>
</coverage>
```

**Scripts utiles en composer.json:**
```json
{
  "scripts": {
    "test": "pest",
    "test:coverage": "pest --coverage"
  }
}
```

---

## Paso 3: Verificacion

Despues de instalar, verificar que todo funciona:

1. **Ejecutar el framework** — debe ejecutar sin errores (aunque no haya tests todavia)
2. **Ejecutar coverage** — debe reportar sin errores
3. **Presentar resumen al usuario:**

```
## Setup de Testing Completado

**Stack:** [Framework detectado]
**Framework de testing:** [Nombre + version instalada]

### Instalado:
- [x] Framework de testing: [nombre]
- [x] Coverage: [herramienta]
- [x] Scripts de ejecucion: [test, test:watch, test:coverage]

### Como usar:
- Ejecutar tests:    [comando]
- Tests en modo watch: [comando]
- Ver coverage:      [comando]

### Proximos pasos:
1. Escribir los primeros tests con `testing_basico.md`
2. Ejecutar [comando] para verificar
```

---

## Reglas inquebrantables

1. **NUNCA migrar frameworks** — si ya hay Jest, no instalar Vitest; si ya hay unittest, no instalar pytest
2. **NUNCA instalar sin confirmacion** del usuario
3. **Solo instalar lo necesario** — sin React no hay Testing Library, sin Django no hay pytest-django
4. **Verificar que funciona** antes de dar por terminado
5. **Idempotente** — si algo ya existe, no tocarlo

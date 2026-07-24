#!/usr/bin/env bash
# Actualiza, en el proyecto actual, unicamente las rutas que son propiedad
# del framework (agentes, comandos, skills, hooks, plantillas, contexto).
#
# Complementa la plantilla de actualizacion por prompt: esta es la via
# mecanica para quien tiene git y prefiere no copiar archivos a mano. No la
# reemplaza — sigue siendo el modo principal de actualizacion.
#
# Uso:
#   scripts/update-framework.sh <ref>
#   scripts/update-framework.sh --help
#   scripts/update-framework.sh
#
# ref: tag, branch o commit a descargar. Sin argumentos, o con --help/-h,
# solo muestra el uso y no descarga ni copia nada — hay que ser explicito
# sobre que version se quiere para que el script actue.
#
# Que NO toca: ai_docs/core/, ai_docs/tasks/, ai_docs/refs/ ni el resto del
# codigo del proyecto — esos son tus documentos.

set -euo pipefail

REPO_URL="${UPDATE_FRAMEWORK_REPO_URL:-https://github.com/gmoncor/agentic-engineering-framework.git}"

RUTAS_FRAMEWORK=(
  ".claude"
  "hooks"
  "commands"
  "agents"
  "skills"
  ".agents"
  ".codex"
  "scripts"
  "ai_docs/core_templates"
  "ai_docs/dev_templates"
  "CLAUDE.md"
  "GEMINI.md"
  "AGENTS.md"
  "CHANGELOG.md"
  "package.json"
)

mostrar_uso() {
  cat <<'EOF'
Uso: scripts/update-framework.sh <ref>

Descarga la version indicada (tag, branch o commit) del framework y
sobrescribe, en el proyecto actual, unicamente las rutas que son propiedad
del framework: .claude/, hooks/, commands/, agents/, skills/, .agents/,
.codex/, scripts/, ai_docs/core_templates/, ai_docs/dev_templates/,
CLAUDE.md, GEMINI.md, AGENTS.md, CHANGELOG.md, package.json.

No toca ai_docs/core/, ai_docs/tasks/, ai_docs/refs/ ni el resto del codigo
de tu proyecto.

Ejemplos:
  scripts/update-framework.sh main     # actualiza a la ultima version de main
  scripts/update-framework.sh v3.1.0   # actualiza a un tag concreto

Sin argumentos, o con --help/-h, solo se muestra este uso: no se descarga
ni se copia nada.

Requiere: git.
EOF
}

if [ "$#" -eq 0 ] || [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  mostrar_uso
  exit 0
fi

REF="$1"

if ! command -v git >/dev/null 2>&1; then
  echo "update-framework: git es necesario para descargar la version nueva." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if ! git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$TMP_DIR" >/dev/null 2>&1; then
  echo "update-framework: no se pudo clonar '$REF' desde $REPO_URL." >&2
  exit 1
fi

copiadas=()
for ruta in "${RUTAS_FRAMEWORK[@]}"; do
  origen="$TMP_DIR/$ruta"
  [ -e "$origen" ] || continue

  destino_dir=$(dirname "$ruta")
  [ "$destino_dir" = "." ] || mkdir -p "$destino_dir"

  if [ -d "$origen" ]; then
    rm -rf "$ruta"
    cp -r "$origen" "$ruta"
  else
    cp -f "$origen" "$ruta"
  fi
  copiadas+=("$ruta")
done

if [ "${#copiadas[@]}" -eq 0 ]; then
  echo "update-framework: '$REF' no contiene ninguna ruta del framework. Nada que copiar."
  exit 0
fi

echo "update-framework: rutas actualizadas desde '$REF':"
for ruta in "${copiadas[@]}"; do
  echo "  - $ruta"
done
echo "update-framework: ai_docs/core/, ai_docs/tasks/, ai_docs/refs/ y el resto de tu codigo no se han tocado."
echo "update-framework: revisa los cambios y ejecuta 'npm test' si tu proyecto tiene tests."

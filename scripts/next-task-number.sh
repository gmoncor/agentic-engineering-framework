#!/usr/bin/env bash
# Reserva el siguiente numero de task (NNN) de forma atomica.
#
# Dos sesiones que planifican a la vez leen el mismo directorio y eligen el mismo
# numero: la segunda pisa a la primera. Este script serializa la eleccion con un
# lock (mkdir es atomico en cualquier sistema de ficheros POSIX) y deja marcado el
# numero como reservado, para que la sesion de al lado tome el siguiente.
#
# Uso:  scripts/next-task-number.sh [directorio_de_tasks]
# Sale por stdout con el numero reservado (ej: 004). El documento de la task se
# crea despues como <directorio_de_tasks>/NNN_descriptor.md
#
# Un numero reservado cuya task nunca llega a crearse se queda sin usar: es el
# precio de no reutilizar numeros entre sesiones concurrentes.

set -euo pipefail

TASKS_DIR="${1:-ai_docs/tasks}"
LOCK_DIR="$TASKS_DIR/.numero.lock"
RESERVADOS="$TASKS_DIR/.reservados"
ESPERA_MAX=100      # intentos de 0.1s = 10s
LOCK_CADUCA=60      # segundos: un lock mas viejo es de un proceso muerto

mkdir -p "$TASKS_DIR"

# Decide si hay que dejar pasar el intento de mkdir: o bien el lock ya
# desaparecio (se lee en una unica llamada a stat, sin el hueco entre
# "existe?" y "leer mtime" del check en dos pasos anterior, que permitia
# que otro proceso liberase o recreara el lock justo en medio) o bien
# sigue ahi pero es mas viejo que LOCK_CADUCA. Cuando stat falla el lock
# ya esta liberado por su dueno: no hay nada que limpiar, asi que no se
# fuerza un rmdir (que podria borrar un lock legitimo recien creado por
# otro proceso) ni se asume una antiguedad de decadas via epoch 0.
LOCK_NECESITA_RMDIR=0
lock_liberable() {
  local mtime
  if ! mtime=$(stat -c %Y "$LOCK_DIR" 2>/dev/null); then
    LOCK_NECESITA_RMDIR=0
    return 0
  fi
  local edad=$(( $(date +%s) - mtime ))
  if [ "$edad" -gt "$LOCK_CADUCA" ]; then
    LOCK_NECESITA_RMDIR=1
    return 0
  fi
  return 1
}

intento=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
  if lock_liberable; then
    if [ "$LOCK_NECESITA_RMDIR" = 1 ]; then
      rmdir "$LOCK_DIR" 2>/dev/null || true
    fi
    continue
  fi
  intento=$((intento + 1))
  if [ "$intento" -ge "$ESPERA_MAX" ]; then
    echo "next-task-number: el lock $LOCK_DIR sigue ocupado tras 10s. Si ningun proceso esta planificando, borralo a mano." >&2
    exit 1
  fi
  sleep 0.1
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

mkdir -p "$RESERVADOS"

# El siguiente numero es el mayor entre las tasks ya creadas y los numeros
# reservados por otra sesion que aun no ha escrito su documento.
mayor=0
for entrada in "$TASKS_DIR"/[0-9][0-9][0-9]_*.md "$RESERVADOS"/[0-9][0-9][0-9]; do
  [ -e "$entrada" ] || continue
  numero=$(basename "$entrada" | cut -c1-3)
  numero=$((10#$numero))
  [ "$numero" -gt "$mayor" ] && mayor=$numero
done

siguiente=$(printf '%03d' $((mayor + 1)))
touch "$RESERVADOS/$siguiente"
echo "$siguiente"

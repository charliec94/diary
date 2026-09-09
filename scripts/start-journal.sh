#!/bin/sh
set -eu
umask 077
case "${PUID:-99}" in ''|*[!0-9]*) echo 'PUID must be numeric' >&2; exit 1;; esac
case "${PGID:-100}" in ''|*[!0-9]*) echo 'PGID must be numeric' >&2; exit 1;; esac
if [ "${PUID:-99}" = 0 ]; then echo 'Choose a non-root PUID for the app' >&2; exit 1; fi
if [ "${DATA_DIR:-}" != /data/journal ]; then echo 'Container DATA_DIR must be /data/journal; map /data on the host' >&2; exit 1; fi
if [ -L /data/journal ]; then echo '/data/journal must not be a symlink' >&2; exit 1; fi
mkdir -p /data/journal
if [ "$(id -u)" = 0 ]; then
  chown "${PUID:-99}:${PGID:-100}" /data/journal
  chmod 700 /data/journal
  # Only the app's SQLite files; never recursively change Tailscale state ownership.
  for file in /data/journal/journal.sqlite /data/journal/journal.sqlite-wal /data/journal/journal.sqlite-shm; do
    if [ -L "$file" ]; then echo 'Database files must not be symlinks' >&2; exit 1; fi
    if [ -f "$file" ]; then chown "${PUID:-99}:${PGID:-100}" "$file"; chmod 600 "$file"; fi
  done
  exec su-exec "${PUID:-99}:${PGID:-100}" node /app/server.js
fi
exec node /app/server.js

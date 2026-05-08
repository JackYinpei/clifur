#!/bin/sh
set -eu

: "${ROUTES_DIR:=/data/routes}"
mkdir -p "$ROUTES_DIR"

if [ -d /app/public/routes ] && [ -z "$(find "$ROUTES_DIR" -mindepth 1 -print -quit)" ]; then
  cp -R /app/public/routes/. "$ROUTES_DIR"/
fi

exec "$@"

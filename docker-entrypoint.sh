#!/bin/sh
set -eu
MODE="${1:-${APP_ROLE:-app}}"
[ "$#" -gt 0 ] && shift
case "$MODE" in
  app)
    node --import tsx scripts/migrate.ts
    exec node_modules/.bin/next start -p "${PORT:-3000}"
    ;;
  worker)
    exec node --import tsx src/worker/index.ts
    ;;
  admin:criar)
    exec node --import tsx scripts/admin-criar.ts "$@"
    ;;
  *)
    exec "$MODE" "$@"
    ;;
esac

#!/bin/sh
set -eu
MODE="${1:-${APP_ROLE:-app}}"
[ "$#" -gt 0 ] && shift
# DATABASE_URL_MIGRATOR (role dono do schema, capaz de desligar RLS) só existe
# para as migrations: os processos de longa duração sobem sem ela no ambiente.
case "$MODE" in
  app)
    node --import tsx scripts/migrate.ts
    exec env -u DATABASE_URL_MIGRATOR node_modules/.bin/next start -p "${PORT:-3000}"
    ;;
  worker)
    exec env -u DATABASE_URL_MIGRATOR node --import tsx src/worker/index.ts
    ;;
  admin:criar)
    exec env -u DATABASE_URL_MIGRATOR node --import tsx scripts/admin-criar.ts "$@"
    ;;
  *)
    exec "$MODE" "$@"
    ;;
esac

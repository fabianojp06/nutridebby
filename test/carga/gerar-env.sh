#!/usr/bin/env bash
# P08-03: gera .env.carga com segredos novos (nunca os de produção). Uso, na raiz do repositório (o umask vale para o
# arquivo que o redirecionamento cria):
#   (umask 077; bash test/carga/gerar-env.sh > .env.carga)
# Também grava .env.carga.compose (as variáveis que o docker compose interpola). Os dois ficam fora do git (.env*).
set -euo pipefail
umask 077 # segredos: só o dono do arquivo lê
owner="$(openssl rand -hex 16)"; app="$(openssl rand -hex 16)"
# B-8: par VAPID novo, só da carga (a chave pública vai só para o app; a privada é descartada)
vapid="$(node -e "console.log(require('web-push').generateVAPIDKeys().publicKey)")"
printf 'CARGA_OWNER_SENHA=%s\nCARGA_VAPID_PUBLICA=%s\n' "${owner}" "${vapid}" > .env.carga.compose
cat <<EOF
NODE_ENV=production
APP_URL=http://localhost:3200
DATABASE_URL=postgres://nutri_app:${app}@db:5432/nutri
DATABASE_URL_MIGRATOR=postgres://carga_owner:${owner}@db:5432/nutri
AUTH_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -base64 32)
FILE_URL_SECRET=$(openssl rand -base64 48)
DATA_DIR=/data
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
TRUSTED_PROXIES=172.16.0.0/12
EMAIL_FROM=NutriDebby Carga <carga@nutridebby.test>
EMAIL_TRANSPORT=mailpit
MAILPIT_URL=http://mailpit:8025
LOG_LEVEL=warn
EOF

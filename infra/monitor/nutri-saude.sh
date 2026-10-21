#!/usr/bin/env bash
# ~/servidor/ferramentas/monitor-saude/nutri-saude.sh — monitor externo do NutriDebby (incidente de 19/10/2026: VPS
# congelada 25 h sem ninguém saber). Fonte da verdade: infra/monitor/nutri-saude.sh; o deploy instala com
# `install -m 700` nesse caminho e a linha do crontab dele (`*/5 * * * *`, saída em nutri-saude.log ao lado) está em
# docs/operacao/monitor-externo.md. Mudou aqui → reinstalar lá.
# Roda pelo cron do deploy a cada 5 min: consulta https://nutri.wsscloud.tech/api/health pelo endereço público (passa
# por DNS, Traefik, app, banco e heartbeat do worker) e pinga o check do healthchecks.io se vier 200, ou /fail com o
# código HTTP se não vier. Se a VPS travar ou cair, nenhum ping sai e o healthchecks.io avisa depois de período +
# tolerância (5 + 5 min); com /fail, avisa na hora.
# A URL do check vale como senha (quem a tem finge que o site está no ar): fica em ~/.config/nutri-saude/hc.url
# (deploy 600) e chega ao curl pela entrada padrão, nunca na linha de comando (o `ps` de qualquer usuário mostraria).
set -uo pipefail
ARQ="$HOME/.config/nutri-saude/hc.url"
SAUDE=https://nutri.wsscloud.tech/api/health

[ -r "$ARQ" ] || { echo "$(date -u +%FT%TZ) nutri-saude: $ARQ não existe (crie o check no healthchecks.io e grave a URL)"; exit 1; }
URL="$(head -n 1 "$ARQ" | tr -d '\r[:space:]')"
[[ "$URL" =~ ^https://hc-ping\.com/[A-Za-z0-9_/-]+$ ]] || { echo "$(date -u +%FT%TZ) nutri-saude: URL em $ARQ fora do formato https://hc-ping.com/…"; exit 1; }

# 503 = "degradado" (banco fora ou worker sem heartbeat). Para um soluço de segundos não virar alarme, o curl tenta de
# novo (2 vezes, 10 s entre elas) só em: tempo esgotado, nome que não resolve (DNS), conexão recusada
# (--retry-connrefused) e HTTP 408, 429, 500, 502, 503 ou 504 (curl 8.5). Qualquer outro código, como o 404 do Traefik
# com o serviço fora, ou outra falha de rede (TLS, conexão cortada), vai direto como /fail, sem repetição.
CODIGO="$(curl -sS -m 15 --retry 2 --retry-delay 10 --retry-connrefused -o /dev/null -w '%{http_code}' "$SAUDE" 2>/dev/null)"
if [ "$CODIGO" = "200" ]; then
  DESTINO="$URL"
else
  DESTINO="$URL/fail"
fi
printf 'url = "%s"\n' "$DESTINO" | curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "api/health: HTTP ${CODIGO:-000}" -K - \
  || { echo "$(date -u +%FT%TZ) nutri-saude: health HTTP ${CODIGO:-000}, mas o ping ao healthchecks.io falhou"; exit 1; }
# só registra o que foge do normal, para o log não crescer
[ "$CODIGO" = "200" ] || echo "$(date -u +%FT%TZ) nutri-saude: health HTTP ${CODIGO:-000}, /fail enviado"

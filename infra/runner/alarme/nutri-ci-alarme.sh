#!/usr/bin/env bash
# /opt/nutri-ci/nutri-ci-alarme.sh — alarme de "runner fora do ar" (docs/operacao/runner-proprio.md, seção 7).
# Roda como root pelo nutri-ci-alarme.timer a cada 10 min: pinga o check do healthchecks.io se o processo do runner do
# gh-runner estiver de pé e manda /fail se não estiver. Sem ping por uns 30 min (período 10 + tolerância 20), o
# healthchecks.io avisa por e-mail; com /fail, avisa na hora.
# A URL do check vale como senha (quem a tem finge que o runner está no ar): fica em /etc/nutri-ci/runner-hc.url
# (root 600, fora do alcance dos jobs) e chega ao curl pela entrada padrão, nunca na linha de comando (o `ps` de qualquer
# usuário do host, inclusive o gh-runner, mostraria).
set -uo pipefail
ARQ=/etc/nutri-ci/runner-hc.url

[ -r "$ARQ" ] || { echo "nutri-ci-alarme: $ARQ não existe (crie o check no healthchecks.io e grave a URL)"; exit 1; }
URL="$(head -n 1 "$ARQ")"
[[ "$URL" =~ ^https://hc-ping\.com/[A-Za-z0-9_/-]+$ ]] || { echo "nutri-ci-alarme: URL em $ARQ fora do formato https://hc-ping.com/…"; exit 1; }

# O processo do runner (Runner.Listener do gh-runner) é o que mantém a conexão com o GitHub; o pgrep não depende do
# barramento do usuário 1500
if pgrep -u gh-runner -x Runner.Listener >/dev/null; then
  DESTINO="$URL"; SITUACAO="ativo"
else
  DESTINO="$URL/fail"; SITUACAO="INATIVO"
fi
printf 'url = "%s"\n' "$DESTINO" | curl -fsS -m 10 --retry 3 -o /dev/null -K - \
  || { echo "nutri-ci-alarme: runner $SITUACAO, mas o ping ao healthchecks.io falhou"; exit 1; }
echo "nutri-ci-alarme: runner $SITUACAO, ping enviado"

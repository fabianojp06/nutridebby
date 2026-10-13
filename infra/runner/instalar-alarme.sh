#!/usr/bin/env bash
# Runner próprio — instala (ou reinstala) o alarme de "runner fora do ar": script em /opt/nutri-ci e timer do root a
# cada 10 min (docs/operacao/runner-proprio.md, seção 7). Não reinicia o runner nem o Docker do CI.
# Antes: criar o check no healthchecks.io e gravar a URL em /etc/nutri-ci/runner-hc.url (root 600).
# Rodar como: sudo bash infra/runner/instalar-alarme.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "rode com sudo"; exit 1; }
ARQ=/etc/nutri-ci/runner-hc.url
[ -f "$ARQ" ] || { echo "Falta $ARQ: crie o check no healthchecks.io e grave a URL nele antes."; exit 1; }
chown root:root "$ARQ"; chmod 600 "$ARQ"

install -o root -g root -m 755 "$AQUI/alarme/nutri-ci-alarme.sh" /opt/nutri-ci/nutri-ci-alarme.sh
install -o root -g root -m 644 "$AQUI/alarme/nutri-ci-alarme.service" /etc/systemd/system/nutri-ci-alarme.service
install -o root -g root -m 644 "$AQUI/alarme/nutri-ci-alarme.timer" /etc/systemd/system/nutri-ci-alarme.timer
systemctl daemon-reload
systemctl enable --now nutri-ci-alarme.timer >/dev/null 2>&1
# Primeiro ping agora (o check fica verde no healthchecks.io)
systemctl start nutri-ci-alarme.service || { echo "O primeiro ping falhou: journalctl -u nutri-ci-alarme -n 20"; exit 1; }
journalctl -u nutri-ci-alarme -n 1 -o cat --no-pager
systemctl list-timers nutri-ci-alarme.timer --no-pager | head -2
echo "Alarme instalado. Confira o check verde no healthchecks.io e avise o Claude."

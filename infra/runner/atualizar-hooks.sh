#!/usr/bin/env bash
# Runner próprio — reinstala os vigias de job (/opt/nutri-ci/hooks, root:root 755) a partir do repositório.
# Não reinicia nada. Rodar como: sudo bash infra/runner/atualizar-hooks.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "rode com sudo"; exit 1; }
install -o root -g root -m 755 "$AQUI/hooks/inicio.sh" /opt/nutri-ci/hooks/inicio.sh
install -o root -g root -m 755 "$AQUI/hooks/fim.sh" /opt/nutri-ci/hooks/fim.sh
sha256sum /opt/nutri-ci/hooks/*.sh | sed 's#/opt/nutri-ci/hooks/##'
echo "Vigias atualizados. Avise o Claude."

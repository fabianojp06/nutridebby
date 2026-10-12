#!/usr/bin/env bash
# Runner próprio — reaplica o isolamento (drop-in do user@1500) depois de uma mudança no repositório.
# Reinicia SÓ o user@1500 (runner e Docker do CI); a produção não é tocada. Rodar como: sudo bash infra/runner/atualizar-isolamento.sh
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "rode com sudo"; exit 1; }
install -m 644 -o root -g root "$AQUI/etc/user@1500-isolamento.conf" /etc/systemd/system/user@1500.service.d/isolamento.conf
systemctl daemon-reload
systemctl restart user@1500.service
for _ in $(seq 1 30); do systemctl is-active --quiet user@1500.service && break; sleep 1; done
systemctl is-active --quiet user@1500.service || { echo "PARE: user@1500 não voltou"; exit 1; }
sleep 20   # Docker do CI e runner sobem sozinhos (enable)
echo "user@1500 reiniciado com o isolamento novo; rodando a bateria de testes:"
exec bash "$AQUI/testar-isolamento.sh"

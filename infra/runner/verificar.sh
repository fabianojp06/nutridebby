#!/usr/bin/env bash
# Confere, SÓ LENDO, se o runner instalado na VPS é igual ao versionado em infra/runner/ (docs/operacao/runner-proprio.md).
# Não instala, não reinicia e não muda nada. Uso (na VPS, como deploy): sudo bash infra/runner/verificar.sh
# Saída 0: tudo igual. Saída 1: alguma diferença (a lista diz qual e o script de instalação/atualização que a corrige).
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo (o home do gh-runner e alguns arquivos só o root lê)."; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
H=/home/gh-runner
DIFERENCAS=0

confere() { # <versionado> <instalado> <dono:grupo esperado> <modo esperado>
  local origem="$AQUI/$1" destino="$2"
  if [ ! -f "$destino" ]; then
    echo "FALTA      $destino"; DIFERENCAS=$((DIFERENCAS + 1)); return
  fi
  if ! cmp -s "$origem" "$destino"; then
    echo "DIFERENTE  $destino (versionado: infra/runner/$1)"; DIFERENCAS=$((DIFERENCAS + 1)); return
  fi
  local atual
  atual="$(stat -c '%U:%G %a' "$destino")"
  if [ "$atual" != "$3 $4" ]; then
    echo "PERMISSÃO  $destino ($atual; esperado $3 $4)"; DIFERENCAS=$((DIFERENCAS + 1)); return
  fi
  echo "ok         $destino"
}

confere etc/egress.nft                /etc/nutri-ci/egress.nft                                   root:root 644
confere etc/nutri-ci-egress.service   /etc/systemd/system/nutri-ci-egress.service                root:root 644
confere etc/user@1500-egress.conf     /etc/systemd/system/user@1500.service.d/egress.conf        root:root 644
confere etc/user@1500-isolamento.conf /etc/systemd/system/user@1500.service.d/isolamento.conf    root:root 644
confere etc/user-1500-slice.conf      /etc/systemd/system/user-1500.slice.d/50-nutri-ci.conf     root:root 644
confere hooks/inicio.sh               /opt/nutri-ci/hooks/inicio.sh                              root:root 755
confere hooks/fim.sh                  /opt/nutri-ci/hooks/fim.sh                                 root:root 755
confere user/docker-env.conf          $H/.config/systemd/user/docker.service.d/env.conf          gh-runner:gh-runner 644
confere user/daemon.json              $H/.config/docker/daemon.json                              gh-runner:gh-runner 644
confere user/actions-runner.service   $H/.config/systemd/user/actions-runner.service             gh-runner:gh-runner 644
confere user/nutri-ci-poda.service    $H/.config/systemd/user/nutri-ci-poda.service              gh-runner:gh-runner 644
confere user/nutri-ci-poda.timer      $H/.config/systemd/user/nutri-ci-poda.timer                gh-runner:gh-runner 644

# O que não é arquivo copiado: filtro carregado, portas de fuga fechadas e a pasta dos vigias só do root
if nft list table inet nutri_ci_egress >/dev/null 2>&1; then echo "ok         filtro de rede carregado (inet nutri_ci_egress)"
else echo "FALTA      filtro de rede (nft) não carregado: systemctl status nutri-ci-egress"; DIFERENCAS=$((DIFERENCAS + 1)); fi
for f in /etc/cron.deny /etc/at.deny; do
  if grep -qx gh-runner "$f" 2>/dev/null; then echo "ok         gh-runner em $f"
  else echo "FALTA      gh-runner em $f (instalar-1-base.sh)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
done
if grep -qx 'DenyUsers gh-runner' /etc/ssh/sshd_config.d/40-gh-runner.conf 2>/dev/null; then echo "ok         SSH negado ao gh-runner"
else echo "FALTA      DenyUsers gh-runner no sshd (instalar-1-base.sh)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
if [ "$(stat -c '%U:%G %a' /opt/nutri-ci/hooks 2>/dev/null)" = "root:root 755" ]; then echo "ok         /opt/nutri-ci/hooks é do root"
else echo "PERMISSÃO  /opt/nutri-ci/hooks deveria ser root:root 755"; DIFERENCAS=$((DIFERENCAS + 1)); fi

echo
if [ "$DIFERENCAS" = 0 ]; then echo "Tudo igual ao versionado."; exit 0; fi
echo "$DIFERENCAS diferença(s). Arquivos de etc/ e user/: instalar-1-base.sh e instalar-2-runner.sh (idempotentes);"
echo "isolamento: atualizar-isolamento.sh; vigias: atualizar-hooks.sh."
exit 1

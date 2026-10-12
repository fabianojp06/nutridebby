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
confere alarme/nutri-ci-alarme.sh       /opt/nutri-ci/nutri-ci-alarme.sh                       root:root 755
confere alarme/nutri-ci-alarme.service  /etc/systemd/system/nutri-ci-alarme.service            root:root 644
confere alarme/nutri-ci-alarme.timer    /etc/systemd/system/nutri-ci-alarme.timer              root:root 644
confere user/docker-env.conf          $H/.config/systemd/user/docker.service.d/env.conf          gh-runner:gh-runner 644
confere user/daemon.json              $H/.config/docker/daemon.json                              gh-runner:gh-runner 644
confere user/actions-runner.service   $H/.config/systemd/user/actions-runner.service             gh-runner:gh-runner 644
confere user/nutri-ci-poda.service    $H/.config/systemd/user/nutri-ci-poda.service              gh-runner:gh-runner 644
confere user/nutri-ci-poda.timer      $H/.config/systemd/user/nutri-ci-poda.timer                gh-runner:gh-runner 644

# O que não é arquivo copiado: a regra CARREGADA (não basta o arquivo igual), portas de fuga fechadas e vigias ligados.
# Referência: o egress.nft versionado carregado num namespace de rede descartável (não toca na rede da VPS), listado no
# mesmo formato da tabela em uso. Os contadores da tabela em uso já contaram pacotes: compara só a regra, sem os números.
normaliza() { sed -E 's/ # handle [0-9]+//; s/counter packets [0-9]+ bytes [0-9]+/counter/g; s/[[:space:]]+$//' | grep -v '^$'; }
ATUAL="$(nft list table inet nutri_ci_egress 2>/dev/null | normaliza)"
REFERENCIA="$(unshare --net sh -c "nft -f '$AQUI/etc/egress.nft' && nft list table inet nutri_ci_egress" 2>/dev/null | normaliza)"
if [ -z "$ATUAL" ]; then
  echo "FALTA      filtro de rede (nft) não carregado: systemctl status nutri-ci-egress"; DIFERENCAS=$((DIFERENCAS + 1))
elif [ -z "$REFERENCIA" ]; then
  echo "ERRO       não consegui montar a referência do filtro (unshare/nft)"; DIFERENCAS=$((DIFERENCAS + 1))
elif [ "$ATUAL" != "$REFERENCIA" ]; then
  echo "DIFERENTE  filtro de rede carregado ≠ infra/runner/etc/egress.nft (instalar-1-base.sh recarrega)"; DIFERENCAS=$((DIFERENCAS + 1))
else
  echo "ok         filtro de rede carregado igual ao versionado"
fi
for l in DOCKER_HOST=unix:///run/user/1500/docker.sock ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/nutri-ci/hooks/inicio.sh ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/nutri-ci/hooks/fim.sh; do
  if grep -qxF "$l" $H/actions-runner/.env 2>/dev/null; then echo "ok         .env do runner: ${l%%=*}"
  else echo "FALTA      .env do runner: $l (instalar-2-runner.sh)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
done
for f in /etc/cron.deny /etc/at.deny; do
  if grep -qx gh-runner "$f" 2>/dev/null; then echo "ok         gh-runner em $f"
  else echo "FALTA      gh-runner em $f (instalar-1-base.sh)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
done
if grep -qx 'DenyUsers gh-runner' /etc/ssh/sshd_config.d/40-gh-runner.conf 2>/dev/null; then echo "ok         SSH negado ao gh-runner"
else echo "FALTA      DenyUsers gh-runner no sshd (instalar-1-base.sh)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
if [ "$(stat -c '%U:%G %a' /etc/nutri-ci/runner-hc.url 2>/dev/null)" = "root:root 600" ]; then echo "ok         URL do alarme só do root"
else echo "FALTA      /etc/nutri-ci/runner-hc.url (root 600) do alarme (seção 7)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
if systemctl is-active --quiet nutri-ci-alarme.timer; then echo "ok         alarme ligado (nutri-ci-alarme.timer)"
else echo "FALTA      nutri-ci-alarme.timer ativo (instalar-alarme.sh)"; DIFERENCAS=$((DIFERENCAS + 1)); fi
if [ "$(stat -c '%U:%G %a' /opt/nutri-ci/hooks 2>/dev/null)" = "root:root 755" ]; then echo "ok         /opt/nutri-ci/hooks é do root"
else echo "PERMISSÃO  /opt/nutri-ci/hooks deveria ser root:root 755"; DIFERENCAS=$((DIFERENCAS + 1)); fi

echo
if [ "$DIFERENCAS" = 0 ]; then echo "Tudo igual ao versionado."; exit 0; fi
echo "$DIFERENCAS diferença(s). Arquivos de etc/ e user/: instalar-1-base.sh e instalar-2-runner.sh (idempotentes);"
echo "isolamento: atualizar-isolamento.sh; vigias: atualizar-hooks.sh; alarme: instalar-alarme.sh."
echo "Atenção: o instalar-2-runner.sh e o atualizar-isolamento.sh reiniciam o Docker do CI e derrubam um job em andamento."
echo "Rode-os com o runner parado (busy=false em: gh api repos/fabianojp06/nutridebby/actions/runners)."
exit 1

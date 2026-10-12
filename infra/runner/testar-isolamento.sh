#!/usr/bin/env bash
# Runner próprio — bateria de testes de isolamento (seção 6 de docs/operacao/runner-proprio.md).
# Rodar como: sudo bash infra/runner/testar-isolamento.sh
# Cada teste roda DENTRO do user@1500, como um job enxerga a máquina. Nenhum conteúdo sensível é mostrado:
# só "barrado" ou "FURO". Testes de fora da VPS (SSH e porta publicada) ficam para o canário.
set -uo pipefail

SOCK=unix:///run/user/1500/docker.sock
R() { sudo -u gh-runner XDG_RUNTIME_DIR=/run/user/1500 systemd-run --user --wait --pipe --quiet --collect -E DOCKER_HOST="$SOCK" -- "$@"; }
[ "$(id -u)" = 0 ] || { echo "rode com sudo"; exit 1; }

FUROS=0; N=0
barrado() {  # o comando PRECISA falhar
  local d="$1"; shift; N=$((N+1))
  if "$@" >/dev/null 2>&1; then printf '  \033[31m✘ FURO\033[0m  %s\n' "$d"; FUROS=$((FUROS+1)); else printf '  \033[32m✔\033[0m barrado  %s\n' "$d"; fi
}
sem_alvo() {  # o alvo do teste não foi achado: conta como falha (teste que não rodou não prova nada)
  N=$((N+1)); printf '  \033[31m✘ FALHOU\033[0m %s (alvo não encontrado)\n' "$1"; FUROS=$((FUROS+1))
}
funciona() {  # o comando PRECISA funcionar
  local d="$1"; shift; N=$((N+1))
  if "$@" >/dev/null 2>&1; then printf '  \033[32m✔\033[0m ok       %s\n' "$d"; else printf '  \033[31m✘ FALHOU\033[0m %s\n' "$d"; FUROS=$((FUROS+1)); fi
}

echo "== Preparando (imagem de teste no Docker do CI) =="
R docker pull -q alpine:3.20 >/dev/null || { echo "não consegui baixar alpine no Docker do CI"; exit 1; }

echo; echo "== Devem ser BARRADOS =="
barrado "1. Docker de produção (/run/docker.sock)"            R docker -H unix:///run/docker.sock ps
for p in /etc/easypanel /srv/nutri/data /home/deploy /root; do
  barrado "2. ler $p"                                          R ls "$p"
done
PIDPROD=$(pgrep -xo -u root dockerd)
if [ -n "$PIDPROD" ]; then barrado "3. ler o ambiente (segredos) de processo da produção" R cat "/proc/$PIDPROD/environ"
else sem_alvo "3. dockerd da produção"; fi
barrado "4. sudo"                                             R sudo -n true
barrado "5. crontab"                                          R bash -c 'out=$(crontab -l 2>&1); [[ $out != *"not allowed"* ]]'
barrado "7. painel do Easypanel 127.0.0.1:3000"               R curl -sS -m5 http://127.0.0.1:3000
barrado "7. Mailpit de dev 127.0.0.1:8025"                    R curl -sS -m5 http://127.0.0.1:8025
barrado "7. Postgres de dev 127.0.0.1:54329"                  R timeout 5 bash -c '</dev/tcp/127.0.0.1/54329'
barrado "8. IP público da VPS 179.197.68.197:443"             R curl -sS -m5 -k https://179.197.68.197
barrado "8. o próprio site (nutri.wsscloud.tech)"             R curl -sS -m5 https://nutri.wsscloud.tech
barrado "9. IPv6 da VPS :3000"                                R curl -6 -sS -m5 -k 'https://[2a02:4780:6e:8cf1::1]:3000'
barrado "9. metadados 169.254.169.254"                        R curl -sS -m5 http://169.254.169.254
IPSDB=$(docker ps -qf name=nutri_db | xargs -r docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}')
[ -n "${IPSDB// /}" ] || sem_alvo "10. banco de produção (contêiner nutri_db)"
for ip in $IPSDB; do
  barrado "10. banco de produção ($ip:5432)"                  R timeout 5 bash -c "</dev/tcp/$ip/5432"
done
barrado "10. Swarm 172.16.1.1:2377"                           R timeout 5 bash -c '</dev/tcp/172.16.1.1/2377'
barrado "11. contêiner montando /etc/easypanel"               R docker run --rm -v /etc/easypanel:/x alpine:3.20 ls /x
barrado "11. idem com --user 1000"                            R docker run --rm --user 1000 -v /etc/easypanel:/x alpine:3.20 ls /x
barrado "12. contêiner --user 1000 lendo chave do Easypanel"  R docker run --rm --user 1000 -v /:/h alpine:3.20 cat /h/etc/easypanel/traefik/default-domain.key
barrado "12. contêiner lendo /srv/nutri/data"                 R docker run --rm -v /:/h alpine:3.20 ls /h/srv/nutri/data
barrado "13. --network host --user 1000 → painel :3000"       R docker run --rm --network host --user 1000 alpine:3.20 wget -T5 -qO- http://127.0.0.1:3000
barrado "13. --network host --user 1000 → Swarm :2377"        R docker run --rm --network host --user 1000 alpine:3.20 wget -T5 -qO- http://172.16.1.1:2377
barrado "14. contêiner → loopback do host (10.0.2.2:3000)"    R docker run --rm alpine:3.20 wget -T5 -qO- http://10.0.2.2:3000
barrado "17. disco do CI acima de 100 GB (fallocate 120G)"    R fallocate -l 120G /home/gh-runner/teste-disco
R rm -f /home/gh-runner/teste-disco
barrado "18. /tmp acima de 4 GB"                               R dd if=/dev/zero of=/tmp/teste bs=1M count=5000 status=none
R rm -f /tmp/teste

echo; echo "== Limites da slice do CI =="
echo "     memória: $(numfmt --to=iec "$(systemctl show user-1500.slice -p MemoryMax --value)") · CPU: $(systemctl show user-1500.slice -p CPUQuotaPerSecUSec --value)/s (4 vCPU) · em uso agora: $(numfmt --to=iec "$(systemctl show user-1500.slice -p MemoryCurrent --value)")"

echo; echo "== Devem FUNCIONAR =="
funciona "internet: api.github.com"                            R curl -sS -m10 https://api.github.com/zen
funciona "baixar imagem: postgres:16-alpine"                   R docker pull -q postgres:16-alpine
funciona "produção: site responde"                             curl -s -o /dev/null -m10 https://nutri.wsscloud.tech
funciona "produção: todos os serviços 1/1"                     bash -c '! docker service ls --format "{{.Replicas}}" | grep -v "^1/1$"'
funciona "produção: internet do host (ping 1.1.1.1)"           ping -c2 -W3 1.1.1.1

echo; echo "== Contadores do filtro de rede =="
nft list chain inet nutri_ci_egress ci | grep -E 'counter packets [1-9]' | sed 's/^\s*/     /' || true

echo
if [ "$FUROS" = 0 ]; then printf '\033[32mResultado: %d de %d testes certos. Nenhum furo.\033[0m\n' "$N" "$N"
else printf '\033[31mResultado: %d PROBLEMA(S) em %d testes. Mande esta saída para o Claude.\033[0m\n' "$FUROS" "$N"; fi

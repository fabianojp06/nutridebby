#!/usr/bin/env bash
# /opt/nutri-ci/hooks/inicio.sh — roda antes de CADA job do runner próprio (ACTIONS_RUNNER_HOOK_JOB_STARTED).
# Canário do isolamento: se qualquer barreira cair, o job falha antes de rodar código do PR (falha fechado).
# docs/operacao/runner-proprio.md, passo 9.
set -uo pipefail

falha() { echo "::error::nutri-ci: isolamento quebrado — $*"; exit 1; }
deve_falhar() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then falha "$d"; fi; }

echo "nutri-ci: conferindo o isolamento (host=$(hostname), dockerenv=$([ -e /.dockerenv ] && echo sim || echo não))"
echo "nutri-ci: cgroup $(cat /proc/self/cgroup)"

# Docker: só o rootless do CI, sem Swarm; o socket de produção inacessível
[ "${DOCKER_HOST:-}" = unix:///run/user/1500/docker.sock ] || falha "DOCKER_HOST=${DOCKER_HOST:-vazio}"
SEG=$(docker info -f '{{.SecurityOptions}}' 2>/dev/null || true)
[[ "$SEG" == *rootless* ]] || falha "o daemon não é o rootless"
[ "$(docker info -f '{{.Swarm.LocalNodeState}}' 2>/dev/null)" = inactive ] || falha "Swarm visível"
deve_falhar "socket do Docker de produção acessível" docker -H unix:///run/docker.sock version

# Arquivos da produção
for p in /etc/easypanel /srv /home/deploy /root; do deve_falhar "$p visível" ls "$p"; done

# Fora do isolamento: cron
# (saída capturada: com pipefail, o código 1 do crontab derrubaria um "| grep")
CRON=$(crontab -l 2>&1 || true)
[[ "$CRON" == *"not allowed"* ]] || falha "crontab permitido para o gh-runner"

# Rede: painel, banco e Mailpit de dev, IP do host, Swarm
for alvo in 127.0.0.1/3000 127.0.0.1/54329 127.0.0.1/8025 179.197.68.197/443 172.16.1.1/2377; do
  deve_falhar "conexão a ${alvo/\//:} permitida" timeout 3 bash -c "</dev/tcp/$alvo"
done

# Disco e memória
[ "$(findmnt -n -o FSTYPE /tmp)" = tmpfs ] || falha "/tmp não é o tmpfs privado"
[[ "$(findmnt -n -o SOURCE /home/gh-runner)" == /dev/loop* ]] || falha "/home/gh-runner não é o disco do CI"
USO=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$USO" -lt 60 ] || falha "disco da produção com ${USO}% de uso"
LIVRE=$(df --output=avail -BG /home/gh-runner | tail -1 | tr -dc 0-9)
[ "$LIVRE" -ge 20 ] || falha "só ${LIVRE} GB livres no disco do CI"
MEM=$(awk '/^MemAvailable/{print int($2/1048576)}' /proc/meminfo)
[ "$MEM" -ge 8 ] || falha "só ${MEM} GB de memória disponível"

echo "nutri-ci: isolamento ok (disco do host ${USO}%, CI ${LIVRE} GB livres, memória ${MEM} GB)"

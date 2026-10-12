#!/usr/bin/env bash
# /opt/nutri-ci/hooks/fim.sh — roda depois de CADA job (ACTIONS_RUNNER_HOOK_JOB_COMPLETED): limpa o que o job deixou.
# Só age no daemon rootless do CI (nunca no Docker de produção). docs/operacao/runner-proprio.md, passo 9.
set -uo pipefail

[ "${DOCKER_HOST:-}" = unix:///run/user/1500/docker.sock ] || { echo "nutri-ci: DOCKER_HOST inesperado, limpeza pulada"; exit 0; }
[ "$(docker info -f '{{.Swarm.LocalNodeState}}' 2>/dev/null)" = inactive ] || { echo "nutri-ci: Swarm visível, limpeza pulada"; exit 0; }

docker ps -aq | xargs -r docker rm -f >/dev/null
docker network prune -f >/dev/null
docker volume prune -af --filter 'label!=nutri-ci.manter' >/dev/null
docker image prune -f >/dev/null
docker builder prune -f --reserved-space 25GB >/dev/null 2>&1 || true
rm -rf "$HOME/actions-runner/_work/_tool" "$HOME/actions-runner/_work/_temp"
find /tmp -xdev -mindepth 1 -delete 2>/dev/null || true     # /tmp é o tmpfs privado do user@1500
echo "nutri-ci: limpeza feita ($(df -h --output=avail /home/gh-runner | tail -1 | tr -d ' ') livres no disco do CI)"
exit 0

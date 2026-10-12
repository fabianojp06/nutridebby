#!/usr/bin/env bash
# /opt/nutri-ci/hooks/fim.sh — roda depois de CADA job (ACTIONS_RUNNER_HOOK_JOB_COMPLETED): limpa o que o job deixou.
# Só age no daemon rootless do CI (nunca no Docker de produção). docs/operacao/runner-proprio.md, passo 9.
set +e   # o runner chama os hooks com bash -e: a limpeza nunca pode reprovar o job
set -u

[ "${DOCKER_HOST:-}" = unix:///run/user/1500/docker.sock ] || { echo "nutri-ci: DOCKER_HOST inesperado, limpeza pulada"; exit 0; }
[ "$(docker info -f '{{.Swarm.LocalNodeState}}' 2>/dev/null)" = inactive ] || { echo "nutri-ci: Swarm visível, limpeza pulada"; exit 0; }

docker ps -aq | xargs -r docker rm -f >/dev/null
docker network prune -f >/dev/null
docker volume prune -af --filter 'label!=nutri-ci.manter' >/dev/null
docker image prune -f >/dev/null
docker builder prune -f --reserved-space 25GB >/dev/null 2>&1 || true
# Arquivos criados dentro de contêineres de job podem ter dono da faixa subordinada (o gh-runner não apaga):
# um contêiner descartável (root dele = UID 1500, com poder sobre a faixa) limpa _temp e _tool.
docker run --rm -v "$HOME/actions-runner/_work:/w" alpine:3.20 sh -c 'rm -rf /w/_temp/* /w/_temp/.[!.]* /w/_tool' >/dev/null 2>&1 \
  || rm -rf "$HOME/actions-runner/_work/_tool" "$HOME/actions-runner/_work/_temp"/* 2>/dev/null
find /tmp -xdev -mindepth 1 -delete 2>/dev/null || true     # /tmp é o tmpfs privado do user@1500
echo "nutri-ci: limpeza feita ($(df -h --output=avail /home/gh-runner | tail -1 | tr -d ' ') livres no disco do CI)"
exit 0

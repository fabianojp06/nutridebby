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
# Arquivos criados dentro de contêineres de job podem ter dono da faixa subordinada (o gh-runner não apaga). Sem imagem
# nenhuma (um job poderia trocar uma imagem por outra com o mesmo nome): entra no espaço de usuários do Docker do CI
# (é do próprio gh-runner; lá dentro ele tem poder sobre a faixa), apaga e confere.
W="$HOME/actions-runner/_work"
FILHO=$(cat /run/user/1500/dockerd-rootless/child_pid 2>/dev/null)
if [ -n "$FILHO" ]; then
  nsenter -U --preserve-credentials -t "$FILHO" rm -rf "$W/_tool" "$W/_temp" 2>/dev/null
else
  rm -rf "$W/_tool" "$W/_temp" 2>/dev/null
fi
mkdir -p "$W/_temp"
[ -z "$(ls -A "$W/_temp" 2>/dev/null)" ] && [ ! -e "$W/_tool" ] || echo "::warning::nutri-ci: sobrou arquivo em _temp/_tool depois da limpeza"
find /tmp -xdev -mindepth 1 -delete 2>/dev/null || true     # /tmp é o tmpfs privado do user@1500
echo "nutri-ci: limpeza feita ($(df -h --output=avail /home/gh-runner | tail -1 | tr -d ' ') livres no disco do CI)"
exit 0

#!/usr/bin/env bash
# Runner próprio — fase 2: Docker rootless do CI, hooks, poda e o runner do GitHub registrado.
# Passos 8 a 10 de docs/operacao/runner-proprio.md. Rodar como: sudo bash infra/runner/instalar-2-runner.sh
# Tudo roda DENTRO do user@1500 (systemd-run --user), com o filtro de rede e o namespace da fase 1.
# Não toca no Docker de produção. Para no primeiro erro.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
VERSAO=2.338.0
SHA=af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32   # publicado no release v2.338.0 (conferido 12/10/2026)
REPO=fabianojp06/nutridebby
SOCK=unix:///run/user/1500/docker.sock
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
pare() { printf '\n\033[31mPARE:\033[0m %s\nMande esta saída para o Claude.\n' "$*"; exit 1; }
passo(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
# Executa como gh-runner dentro do user@1500 (mesmo namespace e mesma slice dos jobs)
R() { sudo -u gh-runner XDG_RUNTIME_DIR=/run/user/1500 systemd-run --user --wait --pipe --quiet --collect -E DOCKER_HOST="$SOCK" -- "$@"; }
# Grava um arquivo versionado no home do gh-runner COMO gh-runner (conteúdo pela entrada padrão). Nunca como root: o home
# é do gh-runner, e um link simbólico plantado por um job levaria o install do root a mudar dono e modo fora dele
# (/etc/systemd/system, /etc) — revisão de segurança do PR #33.
NO_HOME() { R install -m 644 /dev/stdin "$2" < "$AQUI/$1"; }

[ "$(id -u)" = 0 ] || pare "rode com sudo"
systemctl is-active --quiet user@1500.service || pare "user@1500 não está ativo (fase 1)"
systemctl is-active --quiet nutri-ci-egress || pare "filtro de rede inativo (fase 1)"
H=/home/gh-runner

passo "8. Docker rootless do CI"
R install -d -m 700 $H/.config $H/.config/docker $H/.config/systemd $H/.config/systemd/user $H/.config/systemd/user/docker.service.d
NO_HOME user/docker-env.conf $H/.config/systemd/user/docker.service.d/env.conf
NO_HOME user/daemon.json $H/.config/docker/daemon.json
if ! R test -f $H/.config/systemd/user/docker.service; then
  R /usr/bin/dockerd-rootless-setuptool.sh install || pare "dockerd-rootless-setuptool falhou"
fi
R systemctl --user daemon-reload
R systemctl --user enable docker >/dev/null 2>&1
R systemctl --user restart docker      # é o daemon do CI, não o de produção
for _ in $(seq 1 30); do R docker info >/dev/null 2>&1 && break; sleep 1; done
INFO=$(R docker info -f '{{.SecurityOptions}} {{.Swarm.LocalNodeState}} {{.DockerRootDir}}') || pare "docker info falhou no daemon do CI"
echo "  docker info: $INFO"
echo "$INFO" | grep -q rootless || pare "daemon não é rootless"
echo "$INFO" | grep -q inactive || pare "Swarm visível no daemon do CI"
echo "$INFO" | grep -q "$H/.local/share/docker" || pare "data-root inesperado"
ok "Docker rootless do CI no ar, sem Swarm, dados em $H/.local/share/docker"
R docker volume inspect nutri-ci-pnpm >/dev/null 2>&1 || R docker volume create --label nutri-ci.manter=1 nutri-ci-pnpm >/dev/null
ok "volume nutri-ci-pnpm (cache do pnpm)"
R docker -H unix:///run/docker.sock version >/dev/null 2>&1 && pare "o runner alcança o Docker de produção"
ok "Docker de produção inacessível para o runner"

passo "9. Hooks e poda"
install -d -o root -g root -m 755 /opt/nutri-ci /opt/nutri-ci/hooks
install -o root -g root -m 755 "$AQUI/hooks/inicio.sh" /opt/nutri-ci/hooks/inicio.sh
install -o root -g root -m 755 "$AQUI/hooks/fim.sh" /opt/nutri-ci/hooks/fim.sh
NO_HOME user/nutri-ci-poda.service $H/.config/systemd/user/nutri-ci-poda.service
NO_HOME user/nutri-ci-poda.timer $H/.config/systemd/user/nutri-ci-poda.timer
R systemctl --user daemon-reload
R systemctl --user enable --now nutri-ci-poda.timer >/dev/null 2>&1
R systemctl --user is-active --quiet nutri-ci-poda.timer || pare "timer da poda inativo"
ok "hooks em /opt/nutri-ci/hooks e poda aos domingos 14:00 BRT"
R /opt/nutri-ci/hooks/inicio.sh || pare "o canário do isolamento falhou (saída acima)"
ok "canário do isolamento passou fora de job"

passo "10. Runner do GitHub"
if ! R test -x $H/actions-runner/config.sh; then
  R bash -c "mkdir -p ~/actions-runner && cd ~/actions-runner &&
    curl -fsSL -o pacote.tar.gz https://github.com/actions/runner/releases/download/v$VERSAO/actions-runner-linux-x64-$VERSAO.tar.gz &&
    echo '$SHA  pacote.tar.gz' | sha256sum -c --quiet && tar xzf pacote.tar.gz && rm pacote.tar.gz" || pare "download ou sha256 do runner falhou"
  ok "runner v$VERSAO baixado e conferido (sha256)"
else
  ok "runner já baixado"
fi
if ! R test -f $H/actions-runner/.runner; then
  # Token de registro (vale 1 h) pedido com o gh do deploy; vai pela entrada padrão e chega ao config.sh pelo ambiente
  # (ACTIONS_RUNNER_INPUT_TOKEN, que o runner lê e apaga), nunca por argumento (o /proc/<pid>/cmdline é visível a todos
  # os usuários do host; o environ, só ao dono e ao root) nem arquivo
  TOKEN=$(sudo -u deploy -H gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token) || pare "não consegui o token de registro (gh do deploy)"
  [ -n "$TOKEN" ] || pare "token de registro vazio"
  printf '%s\n' "$TOKEN" | R bash -c "read -r T; export ACTIONS_RUNNER_INPUT_TOKEN=\"\$T\"; unset T; cd ~/actions-runner && ./config.sh --unattended --url https://github.com/$REPO --name vps-nutri-ci --labels nutri-ci --work _work --replace" \
    || { unset TOKEN; pare "config.sh falhou"; }
  unset TOKEN
  ok "runner registrado como vps-nutri-ci (label nutri-ci)"
else
  ok "runner já registrado"
fi
R bash -c "cd ~/actions-runner && for l in 'DOCKER_HOST=$SOCK' 'ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/nutri-ci/hooks/inicio.sh' 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/nutri-ci/hooks/fim.sh'; do grep -qxF \"\$l\" .env 2>/dev/null || echo \"\$l\" >> .env; done"
NO_HOME user/actions-runner.service $H/.config/systemd/user/actions-runner.service
R systemctl --user daemon-reload
R systemctl --user enable --now actions-runner >/dev/null 2>&1
sleep 15
R systemctl --user is-active --quiet actions-runner || pare "actions-runner inativo: R journalctl --user -u actions-runner -n 40"
ESTADO=$(sudo -u deploy -H gh api "repos/$REPO/actions/runners" --jq '.runners[] | select(.name=="vps-nutri-ci") | .status') || true
[ "$ESTADO" = online ] || pare "o GitHub mostra o runner como '${ESTADO:-ausente}' (espere 1 min e confira em Settings → Actions → Runners)"
ok "runner online no GitHub"

printf '\n\033[32mFase 2 concluída.\033[0m Avise o Claude para os testes de isolamento e o canário.\n'

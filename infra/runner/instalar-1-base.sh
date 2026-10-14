#!/usr/bin/env bash
# Runner próprio — fase 1: pacotes, usuário, portas de fuga, disco do CI, filtro de rede, isolamento, limites e linger.
# Passos 1 a 7 de docs/operacao/runner-proprio.md. Rodar como: sudo bash infra/runner/instalar-1-base.sh
# Não reinicia nenhum serviço de produção (o único reload é o do ssh, que não derruba sessões abertas).
# Para no primeiro erro ou na primeira verificação que não bater.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
ETC="$AQUI/etc"
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
pare() { printf '\n\033[31mPARE:\033[0m %s\nMande esta saída para o Claude.\n' "$*"; exit 1; }
passo(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || pare "rode com sudo"
for f in egress.nft nutri-ci-egress.service user@1500-egress.conf user@1500-isolamento.conf user-1500-slice.conf; do
  [ -f "$ETC/$f" ] || pare "arquivo $ETC/$f não encontrado"
done

passo "0. Antes"
LIVRE_GB=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
[ "$LIVRE_GB" -gt 150 ] || pare "menos de 150 GB livres no / ($LIVRE_GB GB)"
ok "$LIVRE_GB GB livres no /"
H=$(TZ=America/Sao_Paulo date +%H%M)
if [ "$H" -ge 0230 ] && [ "$H" -lt 0400 ]; then pare "janela do backup (02:30–04:00 BRT): rode mais tarde"; fi

passo "1. Pacotes"
apt-get update -qq
apt-get install -y -qq uidmap slirp4netns >/dev/null
command -v newuidmap >/dev/null && command -v slirp4netns >/dev/null || pare "uidmap/slirp4netns não instalados"
ok "uidmap e slirp4netns instalados"

passo "2. Usuário gh-runner"
if id gh-runner >/dev/null 2>&1; then
  [ "$(id -u gh-runner)" = 1500 ] || pare "gh-runner existe com UID diferente de 1500"
  ok "gh-runner já existe (UID 1500)"
else
  ps -eo uid= | awk '$1==1500{f=1} END{exit !f}' && pare "UID 1500 em uso por algum processo"
  getent group 1500 >/dev/null && pare "GID 1500 já existe"
  groupadd --gid 1500 gh-runner
  useradd --uid 1500 --gid 1500 -M -d /home/gh-runner -s /usr/sbin/nologin gh-runner
  ok "usuário criado"
fi
passwd -l gh-runner >/dev/null
grep -qx 'gh-runner:165536:65536' /etc/subuid || pare "faixa subuid do gh-runner não é 165536:65536 ($(grep gh-runner /etc/subuid || echo ausente))"
grep -qx 'gh-runner:165536:65536' /etc/subgid || pare "faixa subgid do gh-runner não é 165536:65536 ($(grep gh-runner /etc/subgid || echo ausente))"
ok "subuid/subgid 165536:65536"
[ "$(id -Gn gh-runner)" = gh-runner ] || pare "gh-runner tem grupos extras: $(id -Gn gh-runner)"
ok "só o grupo gh-runner (sem sudo, sem docker)"

passo "3. Portas de fuga: cron, at e SSH"
grep -qx gh-runner /etc/cron.deny 2>/dev/null || echo gh-runner >> /etc/cron.deny
grep -qx gh-runner /etc/at.deny 2>/dev/null || echo gh-runner >> /etc/at.deny
printf 'DenyUsers gh-runner\n' > /etc/ssh/sshd_config.d/40-gh-runner.conf
chmod 644 /etc/ssh/sshd_config.d/40-gh-runner.conf
sshd -t || { rm -f /etc/ssh/sshd_config.d/40-gh-runner.conf; pare "sshd -t falhou (arquivo removido, SSH intacto)"; }
systemctl reload ssh
sshd -T | grep -qi '^denyusers gh-runner' || pare "DenyUsers não aparece no sshd -T"
ok "cron.deny, at.deny e DenyUsers gh-runner (sessões abertas não caem)"

passo "4. Disco do CI (100 GB pré-alocados)"
install -d -m 700 /var/lib/nutri-ci
if [ ! -f /var/lib/nutri-ci/disco.img ]; then
  fallocate -l 100G /var/lib/nutri-ci/disco.img
  chmod 600 /var/lib/nutri-ci/disco.img
  mkfs.ext4 -q -L nutri-ci -m 1 /var/lib/nutri-ci/disco.img
  ok "imagem criada"
else
  ok "imagem já existe"
fi
install -d -m 700 /home/gh-runner
grep -q '^/var/lib/nutri-ci/disco.img ' /etc/fstab || \
  echo '/var/lib/nutri-ci/disco.img /home/gh-runner ext4 loop,nosuid,nodev,noatime,nofail 0 2' >> /etc/fstab
systemctl daemon-reload
findmnt /home/gh-runner >/dev/null || mount /home/gh-runner
chown 1500:1500 /home/gh-runner && chmod 700 /home/gh-runner
findmnt -n -o SOURCE,FSTYPE,OPTIONS /home/gh-runner | grep -q '^/dev/loop[0-9]* ext4 .*nosuid.*nodev' || pare "montagem do /home/gh-runner inesperada: $(findmnt -n /home/gh-runner)"
ok "$(findmnt -n -o SOURCE,FSTYPE /home/gh-runner) em /home/gh-runner"
ok "uso do /: $(df --output=pcent / | tail -1 | tr -d ' ')"

passo "5. Filtro de rede"
install -d -m 755 /etc/nutri-ci
install -m 644 -o root -g root "$ETC/egress.nft" /etc/nutri-ci/egress.nft
nft -c -f /etc/nutri-ci/egress.nft || pare "nft -c recusou o arquivo"
install -m 644 -o root -g root "$ETC/nutri-ci-egress.service" /etc/systemd/system/nutri-ci-egress.service
install -d -m 755 /etc/systemd/system/user@1500.service.d
install -m 644 -o root -g root "$ETC/user@1500-egress.conf" /etc/systemd/system/user@1500.service.d/egress.conf
systemctl daemon-reload
systemctl enable --now nutri-ci-egress >/dev/null 2>&1
systemctl is-active --quiet nutri-ci-egress || pare "nutri-ci-egress não ficou ativo"
# Unit oneshot já ativa não roda o ExecStart de novo: recarrega sempre (o arquivo apaga e recria só a tabela própria,
# de uma vez, sem tocar nas regras do Docker de produção). Assim, rodar este script depois de mudar o egress.nft aplica.
nft -f /etc/nutri-ci/egress.nft || pare "nft -f falhou ao recarregar o filtro"
nft list chain inet nutri_ci_egress ci >/dev/null || pare "cadeia ci ausente"
ok "tabela inet nutri_ci_egress carregada"
curl -s -o /dev/null -m 10 -w '%{http_code}' https://nutri.wsscloud.tech | grep -q '^[23]' || pare "a produção não respondeu depois do filtro"
ok "produção responde (https://nutri.wsscloud.tech)"

passo "6. Isolamento de arquivos e limites"
install -m 644 -o root -g root "$ETC/user@1500-isolamento.conf" /etc/systemd/system/user@1500.service.d/isolamento.conf
install -d -m 755 /etc/systemd/system/user-1500.slice.d
install -m 644 -o root -g root "$ETC/user-1500-slice.conf" /etc/systemd/system/user-1500.slice.d/50-nutri-ci.conf
systemctl daemon-reload
[ "$(systemctl show user-1500.slice -p MemoryMax --value)" = 12884901888 ] || pare "MemoryMax da slice não é 12G"
[ "$(systemctl show user-1500.slice -p CPUQuotaPerSecUSec --value)" = 4s ] || pare "CPUQuota da slice não é 400%"
ok "user-1500.slice: 4 vCPU, 12 GB, sem swap"

passo "7. Linger (sobe o user@1500 já isolado)"
loginctl enable-linger gh-runner
for _ in $(seq 1 20); do systemctl is-active --quiet user@1500.service && break; sleep 1; done
systemctl is-active --quiet user@1500.service || pare "user@1500 não subiu: journalctl -u user@1500 -b --no-pager | tail -40"
ok "user@1500 ativo"
PID=$(systemctl show -p MainPID --value user@1500.service)
for p in /etc/easypanel /srv /home/deploy /root; do
  if nsenter -t "$PID" -m ls "$p" >/dev/null 2>&1; then pare "$p continua visível dentro do namespace do runner"; fi
done
ok "/etc/easypanel, /srv, /home/deploy e /root inacessíveis para o runner"

printf '\n\033[32mFase 1 concluída.\033[0m Avise o Claude para conferir e preparar a fase 2.\n'

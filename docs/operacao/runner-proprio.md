# Runner próprio do GitHub Actions — desenho isolado

Versão para aprovação do dono, 12/10/2026. Base: o desenho da opção A mais três revisões céticas (isolamento, operação, GitHub). Tudo o que está aqui foi levantado só com leitura; nada foi instalado nem alterado. Horários em BRT (a VPS está em UTC).

---

## 1. Resumo e recomendação

1. **Recomendo a opção A**: um usuário Linux só para o runner (`gh-runner`, UID 1500), com Docker rootless próprio, jobs em contêiner, filtro de saída de rede por UID e limites de CPU, memória e disco aplicados pelo root.
2. **O desenho original tinha furos que as revisões confirmaram, todos já corrigidos aqui.** As barreiras olhavam só o UID 1500 e esqueciam os 65.536 UIDs subordinados do Docker rootless. O filtro de rede também podia derrubar pacotes da produção. E o disco do CI não tinha teto.
3. **Achei mais duas portas de fuga nesta rodada.** O `cron` aceita qualquer usuário, e o SSH aceitaria uma chave que um job gravasse em `~/.ssh`. Ambos rodariam fora do isolamento e são fechados no passo a passo.
4. **Custo:** o CI dos PRs passa a gastar zero minuto hospedado. Cada merge custa cerca de 5 a 7 minutos (estimativa): o `decidir` mais o `publish` continuam no GitHub. Em outubro restam 10 minutos, o que dá para **um** merge com código.
5. **Você precisa decidir quatro coisas** (seção 9): instalar agora ou em 01/11; o bloqueio do `gh-runner` no SSH e no cron; o peso de CPU do `user.slice`; e o caminho de emergência.

---

## 2. Opções consideradas e por que a recomendada

| | **A. Usuário dedicado + Docker rootless** (recomendada) | B. Usuário dedicado + Podman rootless | C. Segundo `dockerd` como root | D. Não fazer nada |
|---|---|---|---|---|
| Isolamento da produção | Bom: o "root" dos contêineres é o UID 1500 no host. Não há socket de produção nem Swarm. Rede, arquivos e disco ficam presos por regras do root | Igual ao A | **Falha:** quem tem o socket roda `--privileged -v /:/h` e vira root no host | Total (nada roda na VPS) |
| Compatibilidade com o CI atual | Boa com `container:`; Testcontainers e `services:` funcionam no rootless (o canário valida) | Pior: aliases de `services:`, Ryuk e buildx têm problemas conhecidos com o socket do Podman | Total | Total |
| Esforço | Médio: 2 pacotes, usuário, 1 arquivo nft, drop-ins do systemd, disco do CI e o PR do YAML | Médio a alto | Baixo | Zero |
| Custo em minutos | PR = 0; merge ≈ 5 a 7 min | Igual ao A | Igual ao A | PR ≈ 38 min; outubro já tem 1.990 de 2.000 minutos gastos |

Mais duas saídas descartadas: VM ou KVM aninhada (não há `/dev/kvm` e a CPU não expõe `vmx`/`svm`) e sysbox (exige o daemon do Docker como root).

**Por que A:** é a única que isola de verdade sem custo novo. Os pacotes do rootless (`docker-ce-rootless-extras`, `rootlesskit` e os perfis AppArmor) já estão instalados.

### O que mudou depois das revisões

| Achado (revisão) | Correção neste documento |
|---|---|
| O nft liberava os UIDs subordinados (isolamento C1, operação C1) | A cadeia só desvia para as regras do CI quando o dono do socket é **o 1500 ou a faixa de subuid**. Além disso, `DETACH_NETNS=false` faz o `--net=host` virar a rede do rootlesskit |
| O nft descartava respostas sem socket do host inteiro: RST, ICMP, sshd, Swarm (GitHub C3, operação I5) | Mesma correção: a cadeia base só tem `meta skuid {…} jump ci`, e o pacote sem socket segue `accept` |
| A ACL em `/etc/easypanel` só valia para o 1500 (isolamento C2, operação C2) | **A ACL saiu.** No lugar, `InaccessiblePaths=` no `user@1500.service`, um namespace de montagem herdado por todo processo do runner, seja qual for o UID. Nenhum arquivo do Easypanel é tocado |
| O `/tmp` compartilhado vazava material do `deploy` (isolamento I1) | `TemporaryFileSystem=/tmp` e `/var/tmp` no `user@1500`: tmpfs próprio, contado na memória da slice |
| O disco não tinha teto (isolamento I2) | O `/home/gh-runner` inteiro vira um disco de tamanho fixo (imagem ext4 de 100 GB pré-alocada). Os únicos diretórios do `/` que qualquer usuário pode gravar são `/tmp`, `/var/tmp` e `/var/crash`, e os três ficam fechados |
| Runner comprometido forja o "verde" e o `decidir` (isolamento I3, GitHub I3) | O `decidir` fica no `ubuntu-latest`. O risco fica registrado como aceito; o runner efêmero (JIT) vai para a fase 2 |
| `DATA_DIR: ${{ runner.temp }}` invalida o `ci.yml` (GitHub C2) | Fica `DATA_DIR: /tmp/nd-data`, que é o `/tmp` do contêiner do job |
| O canário por `workflow_dispatch` num PR não roda e gasta minutos (GitHub C1) | O canário roda num `push` para o branch `canario-runner`, sem PR (custo hospedado zero) |
| Estimativa do `publish` errada (operação I2, GitHub I2) | O `publish` mantém `cache-to: type=gha,mode=max`. Nova estimativa: 5 a 7 min por merge, a medir |
| Não havia caminho de emergência (operação I3, GitHub I1) | `workflow_dispatch` "publicar-emergencia" no `deploy.yml`, só com o seu OK |
| `CPUWeight=20` não priorizava a produção (operação I1) | Texto corrigido: a barreira real é o `CPUQuota=400%`. O peso do `user.slice` fica como decisão sua |
| `--keep-storage` obsoleto (operação M2, GitHub M1) | `--reserved-space`, conferido no `docker builder prune --help` do buildx v0.37.0. O `builder.gc` saiu do `daemon.json` |
| Timeouts curtos (operação I7) | Provisórios: quality 20, test 25, e2e 45 e image 30 min; a medir no canário |
| Rate limit do Docker Hub (operação M4, GitHub I5) | `registry-mirrors: ["https://mirror.gcr.io"]` no daemon do CI |
| Unit do runner (GitHub M3) | `runsvc.sh`, `KillMode=process` e `TimeoutStopSec=5min` |
| Persistência em `_work/_tool` (GitHub I3) | O `fim.sh` apaga `_work/_tool` e `_work/_temp` |
| Disco: hook com 60 GB livres disparava depois do alerta RNF-13 de 70% (operação M1) | O hook recusa o job se o `/` passar de 60% ou se o disco do CI tiver menos de 20 GB livres |
| **Novo nesta rodada:** cron e SSH fora do isolamento | `/etc/cron.deny`, `DenyUsers gh-runner` e shell `nologin` (seção 5, passo 3) |

---

## 3. Arquitetura (o que fica separado de quê)

```
Host (Ubuntu 24.04, kernel 6.8, systemd 255) — /dev/sda1 ext4 (387 GB, 14% usado)
│
├── system.slice ── PRODUÇÃO (intocada)
│     dockerd root + Swarm + Easypanel + Traefik + nutri_db/app/worker
│     socket /run/docker.sock (root:docker 660), dados em /var/lib/docker (710 root)
│
└── user.slice
      ├── user-1000.slice  (deploy, sessões do dono / Claude)
      └── user-1500.slice  ── CI  ◄── limites de root: CPUQuota 400%, MemoryMax 12G, swap 0, TasksMax, IO*Max
            └── user@1500.service  ◄── namespace de montagem de root:
                  │  InaccessiblePaths: /etc/easypanel /srv /home/deploy /root /run/docker.sock /opt/backup /etc/nutri-backup /var/crash
                  │  TemporaryFileSystem: /tmp /var/tmp      ProtectProc=invisible
                  │  /home/gh-runner = imagem ext4 de 100 GB (loop, nosuid,nodev)
                  ├── docker.service (rootless: rootlesskit + slirp4netns, UID 1500 + subuid 165536–231071)
                  │     socket /run/user/1500/docker.sock — sem Swarm, sem overlays, outro data-root
                  └── actions-runner.service → jobs: contêiner descartável (root do contêiner = UID 1500 no host)

Rede: tabela nft própria "inet nutri_ci_egress" (hook output). Só pacotes com dono 1500 ou 165536–231071
entram na cadeia "ci": nada de loopback, IPs do host, 10/8, 172.16/12, 192.168/16, 169.254, IPv6;
saída só 80/443 + DNS. O restante do host segue "accept" (nada da produção passa pelas regras do CI).
```

| Recurso | Produção | CI | Barreira (de root, o job não desfaz) |
|---|---|---|---|
| Docker | `/run/docker.sock`, Swarm | `/run/user/1500/docker.sock`, sem Swarm | Permissão 660 `root:docker` + `InaccessiblePaths` |
| Arquivos sensíveis | `/etc/easypanel` (104 arquivos `o+r`), `/srv/nutri/data`, `/home/deploy`, backups | só `/home/gh-runner` e `/opt/nutri-ci` (leitura) | Namespace de montagem do `user@1500` |
| Rede | painel :3000, Traefik, `nutri_db` no `docker_gwbridge`, Postgres de dev :54329, Mailpit :8025 | só internet 80/443 + DNS | nft por UID (1500 + subuid) |
| Portas de entrada | Traefik 80/443 | nenhuma (`ports:` sai do YAML) | nft descarta respostas do CI para fora do `lo` (o UFW está desligado) |
| CPU, memória e tarefas | sem limite | 4 vCPU, 12 GB, sem swap, 4.096 tarefas | `user-1500.slice` |
| Disco | `/dev/sda1` | imagem de 100 GB pré-alocada + `/tmp` em tmpfs | tamanho do sistema de arquivos + tmpfs contado na memória |
| Processos fora do runner | — | cron, SSH | `cron.deny`, `DenyUsers`, `nologin` |
| Segredos | webhooks do Easypanel, `packages: write` | nenhum; `GITHUB_TOKEN` só `contents: read` | o `publish` continua no `ubuntu-latest` |

**Por que o namespace de montagem e não a ACL:** um contêiner rootless rodando como usuário não-root (por exemplo, `--user 1000`) acessa os arquivos do host com um UID da faixa subordinada. Para o kernel, esse UID cai em "outros", e "outros" pode ler os 104 arquivos `o+r` do Easypanel. Já o `InaccessiblePaths` vale para o `systemd --user` e para tudo o que ele inicia (rootlesskit, dockerd, contêineres, `systemd-run --user`). Ele é aplicado pelo PID 1 antes de trocar de usuário, e as montagens herdadas ficam travadas dentro do userns, então o job não consegue desmontá-las.

**Atenção: o que fica fora do namespace.** Uma sessão aberta por você com `sudo -iu gh-runner` roda fora do `user@1500`, num `session-N.scope`. Ela vê o host inteiro como "outros". Por dedução (não testado), um job em execução consegue ler `/proc/<pid dessa sessão>/root/...`: é o mesmo UID e o processo é "dumpable". Por isso a regra é: **para administrar o runner, use `systemd-run --user` (seção 6) e não mantenha sessão `sudo -iu gh-runner` aberta com o runner ligado.**

---

## 4. Mudanças no `ci.yml` e no `deploy.yml` (diff proposto)

Os nomes dos jobs `quality`, `test`, `e2e` e `image` e o `run-name` não mudam, porque o `.github/scripts/ci-ja-passou.sh` depende deles.

### `.github/workflows/ci.yml`

```diff
   mudancas:
-    runs-on: ubuntu-latest
+    runs-on: [self-hosted, nutri-ci]
     timeout-minutes: 5

   quality:
-    runs-on: ubuntu-latest
-    timeout-minutes: 15
+    runs-on: [self-hosted, nutri-ci]
+    timeout-minutes: 20
+    # Conveniência, não barreira: o limite real é a user-1500.slice (o YAML de um PR pode tirar isto)
+    container:
+      image: mcr.microsoft.com/playwright:v1.63.0-noble
+      options: --cpus 4 --memory 6g -v nutri-ci-pnpm:/pnpm-store
     steps:
       - uses: actions/checkout@v4
       - uses: pnpm/action-setup@v4
       - uses: actions/setup-node@v4
-        with: { node-version: 24, cache: pnpm }
-      - run: pnpm install --frozen-lockfile
+        with: { node-version: 24 }
+      - run: pnpm install --frozen-lockfile --store-dir /pnpm-store
       - run: pnpm lint
       - run: pnpm typecheck

   test:
     needs: mudancas
     if: needs.mudancas.outputs.codigo == 'true'
-    runs-on: ubuntu-latest
-    timeout-minutes: 15
+    runs-on: [self-hosted, nutri-ci]
+    timeout-minutes: 25
+    container:
+      image: mcr.microsoft.com/playwright:v1.63.0-noble
+      options: >-
+        --cpus 4 --memory 8g
+        -v nutri-ci-pnpm:/pnpm-store
+        -v /run/user/1500/docker.sock:/run/user/1500/docker.sock
+        -v /usr/bin/docker:/usr/local/bin/docker:ro
+        -v /usr/bin/rclone:/usr/local/bin/rclone:ro
+    env:
+      DOCKER_HOST: unix:///run/user/1500/docker.sock
+      TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: /run/user/1500/docker.sock
+      # nutri-backup.sh nunca acha um contêiner de banco (há bancos de produção no host)
+      NUTRI_DB_CONTAINER_FILTER: ci-nunca-existe
     steps:
       - uses: actions/checkout@v4
       - uses: pnpm/action-setup@v4
       - uses: actions/setup-node@v4
-        with: { node-version: 24, cache: pnpm }
-      - run: pnpm install --frozen-lockfile
-      - name: rclone (teste do script de backup, P02-10)
-        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends rclone
+        with: { node-version: 24 }
+      - run: pnpm install --frozen-lockfile --store-dir /pnpm-store
+      - name: docker e rclone do host (montados só leitura) e daemon rootless
+        run: |
+          command -v rclone && command -v docker
+          docker info -f '{{.SecurityOptions}}' | grep -q rootless
+          test "$(docker info -f '{{.Swarm.LocalNodeState}}')" = inactive
       - run: pnpm test   # inclui a guarda de RLS (Testcontainers usa o Docker do runner)

   e2e:
     needs: mudancas
     if: needs.mudancas.outputs.codigo == 'true'
-    runs-on: ubuntu-latest
-    timeout-minutes: 30
+    runs-on: [self-hosted, nutri-ci]
+    timeout-minutes: 45
+    container:
+      image: mcr.microsoft.com/playwright:v1.63.0-noble
+      options: --cpus 4 --memory 8g --shm-size 1g -v nutri-ci-pnpm:/pnpm-store
     services:
       postgres:
         image: postgres:16-alpine
         env: { POSTGRES_USER: owner, POSTGRES_PASSWORD: owner, POSTGRES_DB: nutri }
-        ports: ['5432:5432']
         options: >-
           --health-cmd "pg_isready -U owner -d nutri" --health-interval 5s --health-timeout 5s --health-retries 20
       mailpit:
         image: axllent/mailpit:v1.27
-        ports: ['8025:8025', '1025:1025']
     env:
       NODE_ENV: production
-      APP_URL: http://localhost:3000
+      APP_URL: http://localhost:3000          # localhost do contêiner do job, não o painel do Easypanel
-      DATABASE_URL: postgres://nutri_app:ci-app@localhost:5432/nutri
-      DATABASE_URL_MIGRATOR: postgres://owner:owner@localhost:5432/nutri
+      DATABASE_URL: postgres://nutri_app:ci-app@postgres:5432/nutri
+      DATABASE_URL_MIGRATOR: postgres://owner:owner@postgres:5432/nutri
       ...
-      MAILPIT_URL: http://localhost:8025
+      MAILPIT_URL: http://mailpit:8025
       DATA_DIR: /tmp/nd-data                  # sem mudança: é o /tmp do contêiner, descartado no fim
     steps:
       - uses: actions/checkout@v4
       - uses: pnpm/action-setup@v4
       - uses: actions/setup-node@v4
-        with: { node-version: 24, cache: pnpm }
-      - run: pnpm install --frozen-lockfile
-      - run: pnpm exec playwright install --with-deps chromium
+        with: { node-version: 24 }
+      - run: pnpm install --frozen-lockfile --store-dir /pnpm-store
+      - run: pnpm exec playwright install chromium   # a imagem já traz as dependências do sistema
       - run: pnpm db:migrate
       ...

   image:
     needs: mudancas
     if: needs.mudancas.outputs.codigo == 'true'
-    runs-on: ubuntu-latest
-    timeout-minutes: 20
+    runs-on: [self-hosted, nutri-ci]     # no host; DOCKER_HOST vem do .env do runner (daemon rootless)
+    timeout-minutes: 30
     steps:
       - uses: actions/checkout@v4
       - uses: docker/setup-buildx-action@v3
+        with: { driver: docker }
       - uses: docker/build-push-action@v6
         with:
           context: .
           push: false
           load: true
           tags: nutridebby:ci
-          cache-from: type=gha
-          cache-to: type=gha,mode=max
       ... (orçamento da imagem e as duas provas com --network none: sem mudança)
+      - name: Limpar a imagem do CI
+        if: always()
+        run: docker image rm -f nutridebby:ci
```

Junto no mesmo PR, os fallbacks de `e2e/whatsapp.ts` (`localhost:54329`, o banco de **dev**) e de `e2e/mailpit.ts` (`localhost:8025`) passam a lançar erro quando `CI=true` e a variável não está definida, em vez de cair no ambiente de dev.

### `.github/workflows/deploy.yml`

```diff
 on:
   push:
     branches: [main]
+  # Emergência (runner fora do ar): publica SEM rodar o CI. Só com validação local + OK explícito do dono.
+  workflow_dispatch:
+    inputs:
+      confirmo:
+        description: 'Digite PUBLICAR-SEM-CI para confirmar que a validação local passou e o dono autorizou'
+        required: true

 jobs:
   decidir:
+    if: github.event_name == 'push'
     runs-on: ubuntu-latest     # FICA hospedado: não depende do runner e não pode ser forjado por ele (≈1 min/merge)
     ...

   ci:
     needs: decidir
-    if: ${{ !cancelled() && needs.decidir.outputs.pular != 'true' }}
+    if: ${{ github.event_name == 'push' && !cancelled() && needs.decidir.outputs.pular != 'true' }}
     uses: ./.github/workflows/ci.yml    # roda no runner próprio (custo 0)

   publish:
     needs: [decidir, ci]
     if: >-
-      ${{ !cancelled() && (
+      ${{ !cancelled() && (
+        (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.confirmo == 'PUBLICAR-SEM-CI') ||
         (needs.decidir.result == 'success' && needs.decidir.outputs.pular == 'true' && needs.ci.result == 'skipped') ||
         (needs.ci.result == 'success' && needs.ci.outputs.codigo == 'true')
       ) }}
     runs-on: ubuntu-latest     # FICA hospedado: webhooks do Easypanel e packages:write nunca vão para a VPS
     ...
           cache-from: type=gha
           cache-to: type=gha,mode=max   # sem mudança: agora só a main grava cache (sai o cache dos PRs)
```

> **[a conferir no PR]** No `workflow_dispatch`, o `decidir` e o `ci` ficam `skipped`. O `!cancelled()` do `publish` precisa deixar o job seguir mesmo assim. Um teste no estilo de `test/ci-ja-passou.test.ts`, ou um `actionlint`, valida a expressão antes do merge.

### Arquivos novos no repositório (operação M7)

Ficam em `infra/runner/`, versionados e revisados no PR:
- `egress.nft`;
- os drop-ins: `user-1500.slice.d/50-nutri-ci.conf`, `user@1500.service.d/isolamento.conf` e `user@1500.service.d/egress.conf`;
- as units `nutri-ci-egress.service`, `actions-runner.service` e `nutri-ci-poda.{service,timer}`;
- `inicio.sh` e `fim.sh`;
- `instalar.sh`, idempotente, com modo `--verificar` que só compara (`diff`) o instalado com o versionado.

Mais um teste-guarda que quebra se algum workflow usar `pull_request_target`, `workflow_run` ou `issue_comment` com `runs-on` self-hosted (GitHub M4).

### Workflow do canário (não vai para a `main`)

O `.github/workflows/runner-canario.yml` existe só no branch `canario-runner`, com `on: push: branches: [canario-runner]`:
- um job `isolamento-host` que roda os testes da seção 6 como o job enxerga;
- um job `isolamento-conteiner` com `container:` e `services:`;
- um job `ci` com `uses: ./.github/workflows/ci.yml`, que roda o CI novo inteiro no runner.

O push num branch que não é `main` não dispara o `ci.yml` (só `pull_request`) nem o `deploy.yml` (só `main`). **Custo hospedado: zero.**

---

## 5. Passo a passo de instalação pelo dono

**Regras deste passo a passo:**
- Nenhum comando reinicia serviço de produção. `daemon-reload` não reinicia nada. O único `reload` é o do `ssh` (passo 3), que não derruba sessões abertas.
- Nenhum segredo entra no histórico: o token de registro é lido com `read -rs`.
- Se qualquer verificação marcada com ✔ der diferente, **pare e me mande a saída**.

### 0. Antes
- **Tirar snapshot no hPanel** e anotar o horário.
- Não fazer entre 02:30 e 04:00 BRT (backup das 03:00).
- Conferir o espaço: `df -h /` precisa ter mais de 150 GB livres (hoje são 336 GB).

### 1. Pacotes (atualização de pacotes: você confirma)
```bash
sudo apt-get update && sudo apt-get install -y uidmap slirp4netns
```
O `acl` não é mais necessário.

### 2. Usuário
```bash
ps -eo uid= | sort -un | grep -qx 1500 && echo "PARE: UID 1500 em uso"
sudo groupadd --gid 1500 gh-runner
sudo useradd --uid 1500 --gid 1500 -M -d /home/gh-runner -s /usr/sbin/nologin gh-runner
sudo passwd -l gh-runner
grep gh-runner /etc/subuid /etc/subgid     # ✔ gh-runner:165536:65536 nos dois
id gh-runner                                # ✔ só o grupo gh-runner (nada de sudo/docker)
```
- Se faltar a faixa: `sudo usermod --add-subuids 165536-231071 --add-subgids 165536-231071 gh-runner`.
- **Se a faixa for outra, anote-a:** ela entra no nft do passo 5.
- O `-M` não cria o home ainda: ele será o disco do CI (passo 4).

### 3. Fechar as portas de fuga fora do isolamento (achado novo; mexe em SSH: você confirma)
**Evidência:** o `/etc/cron.allow` e o `/etc/cron.deny` não existem e o `cron` está ativo. O `sshd` não tem `AllowUsers` nem `DenyUsers` e usa `UsePAM yes`. Com `UsePAM yes`, o OpenSSH não recusa chave pública de conta bloqueada por `passwd -l`. Um job poderia então gravar `~/.ssh/authorized_keys` ou um `crontab`, e esses processos rodariam fora do namespace e da slice.
```bash
echo gh-runner | sudo tee -a /etc/cron.deny
echo gh-runner | sudo tee -a /etc/at.deny          # o atd está inativo; é só defesa
printf 'DenyUsers gh-runner\n' | sudo tee /etc/ssh/sshd_config.d/40-gh-runner.conf
sudo sshd -t && sudo systemctl reload ssh          # ✔ sshd -t sem saída; o reload não derruba sessões
sudo sshd -T | grep -i denyusers                   # ✔ denyusers gh-runner
```

### 4. Disco do CI com tamanho fixo (o home inteiro)
```bash
sudo install -d -m 700 /var/lib/nutri-ci
sudo fallocate -l 100G /var/lib/nutri-ci/disco.img   # pré-alocado: o CI nunca cresce no /dev/sda1
sudo chmod 600 /var/lib/nutri-ci/disco.img
sudo mkfs.ext4 -q -L nutri-ci -m 1 /var/lib/nutri-ci/disco.img
sudo install -d -m 700 /home/gh-runner
echo '/var/lib/nutri-ci/disco.img /home/gh-runner ext4 loop,nosuid,nodev,noatime,nofail 0 2' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount /home/gh-runner
sudo chown 1500:1500 /home/gh-runner && sudo chmod 700 /home/gh-runner
findmnt /home/gh-runner                              # ✔ /dev/loopN ext4 nosuid,nodev
df -h /                                              # ✔ cerca de 40% de uso (51 + 100 GB); o alerta RNF-13 é em 70%
```
O `nofail` garante que um erro nessa linha nunca impeça o boot.

### 5. Filtro de rede
Crie `/etc/nutri-ci/egress.nft` (`root:root 644`). Se a faixa do passo 2 for diferente, troque `165536-231071` nas duas linhas:
```nft
table inet nutri_ci_egress
delete table inet nutri_ci_egress
table inet nutri_ci_egress {
  set privadas4 { type ipv4_addr; flags interval; elements = {
    0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16,
    172.16.0.0/12, 192.168.0.0/16, 179.197.68.197, 224.0.0.0/3 } }
  set dns4 { type ipv4_addr; elements = { 153.92.2.6, 1.1.1.1, 8.8.4.4 } }

  # Cadeia base: SÓ desvia o que pertence ao CI. Pacote sem socket (RST, ICMP, TIME_WAIT)
  # não casa com skuid e segue a política accept — a produção nunca passa pela cadeia "ci".
  chain saida {
    type filter hook output priority filter - 10; policy accept;
    meta skuid { 1500, 165536-231071 } jump ci
  }

  chain ci {
    ct direction reply oifname != "lo" counter drop          # nenhuma porta do CI responde para fora
    ip daddr { 127.0.0.53, 127.0.0.54 } meta l4proto { udp, tcp } th dport 53 accept
    oifname "lo" counter reject                               # painel :3000, Traefik, :54329, :8025, IPs do host
    ip daddr @privadas4 counter reject with icmpx admin-prohibited   # gwbridge (nutri_db), overlays, metadados
    meta nfproto ipv6 counter reject with icmpx admin-prohibited     # inclui [::]:3000
    ip daddr @dns4 meta l4proto { udp, tcp } th dport 53 accept
    tcp dport { 80, 443 } ct state new accept
    ct state established,related accept
    limit rate 10/minute log prefix "nutri-ci-negado " counter
    counter reject with icmpx admin-prohibited
  }
}
```

`/etc/systemd/system/nutri-ci-egress.service`:
```ini
[Unit]
Description=Filtro de saída do runner de CI (tabela nft própria)
Before=user@1500.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/nutri-ci/egress.nft
ExecStop=/usr/sbin/nft delete table inet nutri_ci_egress
[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/user@1500.service.d/egress.conf`:
```ini
[Unit]
Requires=nutri-ci-egress.service
After=nutri-ci-egress.service
```

```bash
sudo nft -c -f /etc/nutri-ci/egress.nft                 # ✔ sem saída
sudo systemctl daemon-reload && sudo systemctl enable --now nutri-ci-egress
sudo nft list table inet nutri_ci_egress                 # ✔ as duas cadeias
curl -sI https://nutri.wsscloud.tech | head -1           # ✔ (como deploy) a produção responde
```
- **Nunca** use `flush ruleset` nem ative o `nftables.service`: isso apaga as regras do Docker de produção.
- Para recarregar as regras, use `sudo nft -f /etc/nutri-ci/egress.nft`. **Não** use `systemctl restart nutri-ci-egress`: por causa do `Requires=`, ele derruba a sessão do runner e o job em curso.

### 6. Isolamento de arquivos e limites
`/etc/systemd/system/user@1500.service.d/isolamento.conf`:
```ini
[Unit]
RequiresMountsFor=/home/gh-runner
[Service]
# Namespace de montagem herdado por TODO processo do runner (qualquer UID, inclusive subuid)
InaccessiblePaths=/etc/easypanel /srv /home/deploy /root /run/docker.sock /var/crash -/opt/backup -/etc/nutri-backup
TemporaryFileSystem=/tmp:mode=1777,size=4G /var/tmp:mode=1777,size=1G
ProtectProc=invisible
# NÃO acrescentar NoNewPrivileges, SystemCallFilter, RestrictNamespaces nem ProtectKernel*: quebram o newuidmap do rootless
```

`/etc/systemd/system/user-1500.slice.d/50-nutri-ci.conf`:
```ini
[Slice]
CPUQuota=400%
MemoryHigh=10G
MemoryMax=12G
MemorySwapMax=0
TasksMax=4096
IOReadBandwidthMax=/dev/sda 200M
IOWriteBandwidthMax=/dev/sda 150M
IOReadIOPSMax=/dev/sda 3000
IOWriteIOPSMax=/dev/sda 2000
```
```bash
sudo systemctl daemon-reload
systemctl show user-1500.slice -p MemoryMax -p CPUQuotaPerSecUSec   # ✔ 12884901888 / 4s
```
- O `CPUWeight=20` saiu. Ele só pesava contra o `user-1000` (o `deploy`), não contra a produção, que fica no `system.slice`. A barreira real de CPU é o `CPUQuota=400%`, metade da máquina.
- A memória é dimensionada pelo uso atual: a produção usa cerca de 7 GiB e há 24 GiB disponíveis. Com `MemorySwapMax=0`, quem morre por falta de memória é o CI, e a produção não é empurrada para o swap.

### 7. Linger (sobe o `user@1500` já com filtro, namespace e disco)
```bash
sudo loginctl enable-linger gh-runner
systemctl is-active user@1500.service                      # ✔ active
sudo nsenter -t "$(systemctl show -p MainPID --value user@1500.service)" -m ls /etc/easypanel   # ✔ Permission denied
```
Se o `user@1500` não subir com o `isolamento.conf`, me mande o `journalctl -u user@1500 -b`. A primeira suspeita é o `ProtectProc`: o plano B é tirar só ele.

### 8. Docker rootless (dentro do `user@1500`, sem sessão `sudo -iu`)
Crie como root e depois passe para o `gh-runner`:
- `/home/gh-runner/.config/systemd/user/docker.service.d/env.conf`:
  ```ini
  [Service]
  Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns
  Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=builtin
  Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true
  Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_DETACH_NETNS=false
  ```
  O `DETACH_NETNS` vale `true` por padrão (linha 120 de `/usr/bin/dockerd-rootless.sh`) e, nesse modo, `--net=host` é a rede real do host. Com `false`, o `--net=host` passa a ser a rede do rootlesskit.
- `/home/gh-runner/.config/docker/daemon.json`:
  ```json
  {"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"2"},
   "registry-mirrors":["https://mirror.gcr.io"]}
  ```
```bash
sudo chown -R 1500:1500 /home/gh-runner/.config
R='sudo -u gh-runner XDG_RUNTIME_DIR=/run/user/1500 systemd-run --user --wait --pipe --quiet -E DOCKER_HOST=unix:///run/user/1500/docker.sock --'
$R /usr/bin/dockerd-rootless-setuptool.sh install
$R systemctl --user daemon-reload
$R systemctl --user restart docker        # é o daemon do CI, não o de produção
$R docker info -f '{{.SecurityOptions}} {{.Swarm.LocalNodeState}} {{.DockerRootDir}}'
# ✔ contém "rootless", "inactive" e /home/gh-runner/.local/share/docker
$R docker volume create --label nutri-ci.manter=1 nutri-ci-pnpm
```
- O `systemd-run --user` executa **dentro** do `user@1500`, com o namespace. Use sempre esse prefixo `$R` para administrar o runner.
- Se o setuptool pedir um perfil AppArmor ou acusar falta de `newuidmap`, pare e me mande a saída. O `apparmor_restrict_unprivileged_userns=1` está ligado, e o perfil `rootlesskit` existente deve cobrir isso.

### 9. Hooks e poda (eu escrevo no PR, em `infra/runner/`; você instala `root:root 755`)
`/opt/nutri-ci/hooks/inicio.sh` é o canário de cada job e **falha fechado**:
- `DOCKER_HOST` precisa ser o socket rootless, o `docker info` precisa dizer `rootless` e o Swarm precisa estar `inactive`.
- `docker -H unix:///run/docker.sock version` precisa **falhar**.
- `ls /etc/easypanel /srv /home/deploy` precisa **falhar**, e `crontab -l` precisa responder "not allowed".
- O `/dev/tcp` para `127.0.0.1:3000`, `:54329`, `:8025`, `179.197.68.197:443` e `172.16.1.1:2377` precisa **falhar**.
- `findmnt -n -o FSTYPE /tmp` precisa dar `tmpfs`, e o `/home/gh-runner` precisa ser um loop.
- O `/` precisa estar **abaixo de 60%** de uso, o `/home/gh-runner` precisa ter **20 GB ou mais** livres e o `MemAvailable` precisa ter **8 GB ou mais**.
- O hook registra `cat /proc/1/cgroup`, a existência de `/.dockerenv` e o `hostname` no log. Isso prova se ele roda no host ou no contêiner (operação I6).

`/opt/nutri-ci/hooks/fim.sh` só age se o `DOCKER_HOST` for o rootless e o Swarm estiver `inactive`:
```bash
docker ps -aq | xargs -r docker rm -f
docker network prune -f
docker volume prune -af --filter 'label!=nutri-ci.manter'
docker image prune -f
docker builder prune -f --reserved-space 25GB
rm -rf "$HOME/actions-runner/_work/_tool" "$HOME/actions-runner/_work/_temp"
find /tmp -xdev -mindepth 1 -delete 2>/dev/null || true     # /tmp é o tmpfs privado do user@1500
```

O timer `nutri-ci-poda.timer` (de usuário) roda **`OnCalendar=Sun 17:00 UTC`** (domingo, 14:00 BRT, longe do backup das 03:00) com:
- `docker system prune -af --filter until=168h`;
- `docker builder prune -af --filter until=168h`.

### 10. Runner
```bash
$R bash -c 'mkdir -p ~/actions-runner && cd ~/actions-runner &&
  curl -fsSLO https://github.com/actions/runner/releases/download/v2.338.0/actions-runner-linux-x64-2.338.0.tar.gz'
```
- Confira o sha256 com `sha256sum` contra o publicado na página do release v2.338.0 e só então extraia: `tar xzf …`.
- Pegue o token em Settings → Actions → Runners → New self-hosted runner. Ele vale 1 hora.
- No **seu** terminal:
```bash
read -rs RT     # cole o token; nada aparece e nada vai para o histórico
# o token entra pela entrada padrão (não aparece na linha de comando do sudo, que o `ps` mostraria)
printf '%s\n' "$RT" | sudo -u gh-runner XDG_RUNTIME_DIR=/run/user/1500 systemd-run --user --wait --pipe --quiet \
  bash -c 'read -r T; cd ~/actions-runner && ./config.sh --unattended \
  --url https://github.com/fabianojp06/nutridebby --token "$T" \
  --name vps-nutri-ci --labels nutri-ci --work _work'
unset RT
```
Acrescente ao `~/actions-runner/.env`:
```
DOCKER_HOST=unix:///run/user/1500/docker.sock
ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/nutri-ci/hooks/inicio.sh
ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/nutri-ci/hooks/fim.sh
```

Crie a unit `~/.config/systemd/user/actions-runner.service`:
```ini
[Unit]
Description=GitHub Actions runner (nutri-ci)
Requires=docker.service
After=docker.service
[Service]
WorkingDirectory=%h/actions-runner
ExecStartPre=/bin/cp -n %h/actions-runner/bin/runsvc.sh %h/actions-runner/runsvc.sh
ExecStart=%h/actions-runner/runsvc.sh
Environment=DOCKER_HOST=unix:///run/user/1500/docker.sock
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=5min
Restart=always
RestartSec=10
Nice=10
[Install]
WantedBy=default.target
```
- Ative com `$R systemctl --user daemon-reload` e depois `$R systemctl --user enable --now actions-runner`.
- ✔ O runner aparece "Idle" em Settings → Runners.
- O `svc.sh` do pacote **não** serve: ele cria uma unit de sistema, que ficaria fora da `user-1500.slice` e fora do namespace.
- **[a confirmar]** o caminho `bin/runsvc.sh` dentro do pacote.

### 11. Canário (custo hospedado zero)
- Eu subo o branch `canario-runner` com o `runner-canario.yml` e o `ci.yml` novo. **Sem abrir PR.**
- Você roda os testes da seção 6 que exigem sessão própria (13 e 14).
- ✔ Todos os jobs ficam verdes, inclusive o `ci` completo pelo `workflow_call`.
- Anote o tempo de cada job: é isso que ajusta os `timeout-minutes`.

### 12. Migração
- Abro o PR com o `ci.yml`, o `deploy.yml` e o `infra/runner/`. O CI do PR já roda no runner próprio, porque no `pull_request` vale o YAML do merge do PR.
- Fluxo normal de revisão.
- **O merge depende do seu OK e republica a produção** (`.github/` conta como código), com custo de cerca de 5 a 7 min hospedados.
- **Enquanto o runner não estiver no ar, não abrir nenhum outro PR:** o CI de PR ainda gastaria cerca de 38 min hospedados.

---

## 6. Teste de isolamento

**Como rodar.** Todos rodam **dentro** do `user@1500`, que é como o job enxerga a máquina. Use o prefixo:
`R='sudo -u gh-runner XDG_RUNTIME_DIR=/run/user/1500 systemd-run --user --wait --pipe --quiet -E DOCKER_HOST=unix:///run/user/1500/docker.sock --'`

> **Atenção:** os mesmos comandos numa sessão `sudo -iu gh-runner` rodam **fora** do namespace. Neles, os testes 2 e 9 dariam um falso resultado: passariam a ler o que "outros" podem ler.

### Devem FALHAR

| # | Comando | Esperado |
|---|---|---|
| 1 | `$R docker -H unix:///run/docker.sock ps` | `permission denied` ou `no such file` |
| 2 | `$R ls /etc/easypanel /srv/nutri/data /home/deploy /root` | `Permission denied` em todos |
| 3 | `$R bash -c 'cat /proc/$(pgrep -u 1001 \| head -1)/cmdline'` | vazio ou erro (`ProtectProc=invisible` esconde) |
| 4 | `$R sudo -n true` | `sudo: a password is required` ou "not in sudoers" |
| 5 | `$R crontab -l` | `You (gh-runner) are not allowed to use this program` |
| 6 | `ssh -o BatchMode=yes gh-runner@179.197.68.197` (de fora) | `Permission denied` (o log do sshd mostra `DenyUsers`) |
| 7 | `$R curl -m5 http://127.0.0.1:3000`, `$R curl -m5 http://127.0.0.1:8025`, `$R timeout 5 bash -c '</dev/tcp/127.0.0.1/54329'` | `Connection refused` |
| 8 | `$R curl -m5 -k https://179.197.68.197`, `$R curl -m5 https://nutri.wsscloud.tech` | recusado (o domínio resolve para o próprio host) |
| 9 | `$R curl -6 -m5 -k 'https://[2a02:4780:6e:8cf1::1]:3000'`, `$R curl -m5 http://169.254.169.254` | recusado |
| 10 | `$R timeout 5 bash -c '</dev/tcp/<IP do nutri_db no docker_gwbridge>/5432'` (o IP sai de `docker network inspect docker_gwbridge`, como `deploy`) | recusado |
| 11 | `$R docker run --rm -v /etc/easypanel:/x alpine ls /x` e o mesmo com `--user 1000` | erro de montagem ou `Permission denied` |
| 12 | **Faixa subordinada (o furo C1/C2):** `$R docker run --rm --user 1000 -v /:/h alpine cat /h/etc/easypanel/traefik/default-domain.key` | erro (o caminho está inacessível dentro do namespace). **Nunca** rode a variante fora do `$R` |
| 13 | **Rede com UID subordinado:** `$R docker run --rm --network host --user 1000 alpine wget -T5 -qO- http://127.0.0.1:3000` e o mesmo com `http://172.16.1.1:2377` | falha |
| 14 | `$R docker run --rm alpine wget -T5 -qO- http://10.0.2.2:3000` | falha (loopback do host desligado) |
| 15 | Com `$R docker run -d -p 18080:80 nginx:alpine` rodando: de **fora** da VPS, `nc -vz 179.197.68.197 18080` | sem resposta (`timeout`). Depois, `$R docker rm -f` no contêiner |
| 16 | Carga: `$R docker run --rm alpine sh -c 'tail /dev/zero'` | morto por falta de memória **dentro** da slice (`systemctl status user-1500.slice` mostra o evento). Ao mesmo tempo, como `deploy`, o `docker stats` dos `nutri_*` segue normal e `cat /sys/fs/cgroup/system.slice/io.pressure` fica perto de 0 |
| 17 | Disco: `$R fallocate -l 120G /home/gh-runner/x` | `No space left on device`; o `df -h /` não muda |
| 18 | `$R dd if=/dev/zero of=/tmp/x bs=1M count=5000` | para em cerca de 4 GB (tmpfs) |

### Devem FUNCIONAR (prova de que a produção não foi afetada)

- **Como `deploy`:**
  - `curl -sI https://nutri.wsscloud.tech` responde;
  - `docker service ls` mostra todas as réplicas;
  - `ping -c2 1.1.1.1` funciona.
- **De fora da VPS:**
  - `ping 179.197.68.197` responde;
  - `nc -vz 179.197.68.197 <porta fechada>` volta com `refused` (RST), e não com timeout. Isso prova que o C3 do GitHub está corrigido.
- **Dentro do namespace:**
  - `$R curl -sS https://api.github.com/zen`;
  - `$R docker pull postgres:16-alpine`.
- **Contadores:** `sudo nft list table inet nutri_ci_egress` mostra os contadores dos testes 7 a 14 subindo.

---

## 7. Limites de recursos e monitoramento

| Recurso | Limite | Por quê | Como ver |
|---|---|---|---|
| CPU | `CPUQuota=400%` (4 de 8 vCPU) | metade da máquina sempre livre para a produção | `systemd-cgtop /user.slice/user-1500.slice` |
| Memória | `MemoryHigh=10G`, `MemoryMax=12G`, swap 0 | a produção usa cerca de 7 GiB e há 24 GiB disponíveis; o OOM fica dentro do CI | `systemctl status user-1500.slice` |
| Tarefas | `TasksMax=4096` | evita fork bomb | `pids.current` da slice |
| Disco | 100 GB pré-alocados + `/tmp` tmpfs 4G + `/var/tmp` tmpfs 1G | o CI não consegue encher o `/dev/sda1` | `df -h /home/gh-runner` |
| IO | teto em `/dev/sda`: 200/150 MB/s e 3000/2000 IOPS | ponto de partida **[suposição]** | `/sys/fs/cgroup/user.slice/user-1500.slice/io.max` e `io.stat` |
| Por job | `--cpus 4 --memory 6g/8g` | conveniência, **não barreira**: o YAML do PR pode tirar | — |
| Concorrência | 1 instância do runner | os jobs entram em fila; dois E2E nunca disputam a máquina | — |

**IO (operação I4):**
- O teto de escrita pode, em tese, segurar commits do journal do ext4 que a produção também espera. Isso não foi confirmado neste host.
- O disco do CI ser um arquivo pré-alocado deve reduzir esse acoplamento, porque o journal interno é outro. Também não está confirmado.
- No teste 16, compare a `io.pressure` do `system.slice` e a latência do app antes e durante o E2E.
- Se a pressão subir, tire os `IOWrite*Max` e ligue o iocost (o `io.cost.qos` existe e está vazio), passando a usar `IOWeight`. A frase "`IOWeight` não funciona" valia só sem o iocost.

**CPU:** se você quiser prioridade real da produção quando as duas disputam CPU, a opção é `/etc/systemd/system/user.slice.d/50-peso.conf` com `CPUWeight=50`. Isso também afeta as sessões do `deploy` (Claude, `pnpm dev`) — é decisão sua.

**Monitoramento:**
- **Relatório diário das 06h:**
  - estado do runner, com `gh api repos/fabianojp06/nutridebby/actions/runners --jq '.runners[]|{name,status,busy}'`;
  - `df -h /home/gh-runner`;
  - resultado do último CI;
  - contadores de `nutri-ci-negado`.
- **Runner fora do ar** (o GitHub não avisa; o job só espera até 24 h): um timer de **root** a cada 10 min pinga o healthchecks.io se `systemctl --user -M gh-runner@ is-active actions-runner` estiver ativo. O ping parte do root porque a URL do check fica fora do alcance dos jobs. É um check novo no plano gratuito que você já usa.
- **Logs:**
  - `sudo journalctl _UID=1500 --since today`;
  - saídas negadas: `journalctl -k --since today | grep nutri-ci-negado`.
- **Disco da produção:** o alerta RNF-13 (70%, `monitoramento.ts`) mede o mesmo `/dev/sda1`. Com os 100 GB pré-alocados, o uso fica em cerca de 40% e o CI não o faz crescer.
- **Docker Hub:** os pulls anônimos saem do IP da produção. O `mirror.gcr.io` alivia; o app vem do GHCR, então o risco para o deploy é baixo.

---

## 8. Como desfazer

**Volta rápida, sem mexer na VPS:**
- Com minutos sobrando (a partir de 01/11): um PR que reverte o YAML.
- Em outubro, o `git revert` não é rápido: o PR do revert roda o CI hospedado (cerca de 38 min) e restam cerca de 10 min. Nesse caso, use o "publicar-emergencia" com validação local e o seu OK.

**Remoção completa** (nenhum passo toca o Docker de produção, o Swarm ou o Easypanel):
```bash
# 1. GitHub: Settings → Actions → Runners → vps-nutri-ci → Remove (ou gh api -X DELETE .../actions/runners/<id>)
R='sudo -u gh-runner XDG_RUNTIME_DIR=/run/user/1500 systemd-run --user --wait --pipe --quiet --'
$R systemctl --user disable --now actions-runner nutri-ci-poda.timer docker
sudo loginctl disable-linger gh-runner
sudo loginctl terminate-user gh-runner
findmnt | grep gh-runner                     # ✔ só a própria montagem do loop (nada de overlay)
sudo umount /home/gh-runner
sudo sed -i '\#/var/lib/nutri-ci/disco.img#d' /etc/fstab
sudo rm -f /var/lib/nutri-ci/disco.img && sudo rmdir /var/lib/nutri-ci /home/gh-runner
sudo systemctl disable --now nutri-ci-egress        # o ExecStop apaga a tabela nft
sudo rm -rf /etc/nutri-ci /opt/nutri-ci \
  /etc/systemd/system/nutri-ci-egress.service \
  /etc/systemd/system/user-1500.slice.d /etc/systemd/system/user@1500.service.d
sudo systemctl daemon-reload
sudo userdel gh-runner                              # o home já foi removido junto com o disco
grep gh-runner /etc/subuid /etc/subgid              # ✔ vazio (senão: sudo usermod --del-subuids/--del-subgids antes do userdel)
sudo sed -i '/^gh-runner$/d' /etc/cron.deny /etc/at.deny
sudo rm /etc/ssh/sshd_config.d/40-gh-runner.conf && sudo sshd -t && sudo systemctl reload ssh
# opcional: sudo apt-get remove uidmap slirp4netns
```
Se nada disso der certo, o último recurso é o snapshot.

---

## 9. Riscos remanescentes e decisões do dono

### Riscos aceitos (com mitigação)
1. **Runner persistente comprometido forja o resultado do CI.**
   - O código de um PR pode alterar os binários do runner, o `.env`, o `_work` e as units de usuário, e ler a credencial do runner (`.credentials`), porque tudo roda com o mesmo UID.
   - Com isso, ele pode marcar `quality`, `test`, `e2e` e `image` como `success`, e o `ci-ja-passou.sh` confia nisso.
   - **O que não cai:** a imagem publicada continua sendo montada no `ubuntu-latest` a partir do `github.sha`, e o `decidir` fica hospedado.
   - **O que cai:** o portão "testou antes de publicar".
   - **Fase 2:** runner efêmero (JIT), com o token guardado fora do alcance do runner.
2. **Kernel compartilhado.** O `uidmap` mais o perfil `rootlesskit` dão ao código do PR capacidades dentro de user namespaces, o que aumenta a superfície de ataque do kernel. Mitigação: kernel atualizado, com reboot programado (decisão sua, fora deste PR).
3. **Sockets locais.** O nft não filtra sockets UNIX. Sockets abstratos (`@/tmp/monarx-agent.socket`, iSCSI, multipathd), o D-Bus do sistema, o journald e o resolved continuam alcançáveis. Não se sabe se algum deles aceita algo explorável. Mitigação: manter o `monarx-agent` e o sistema atualizados.
4. **Saída livre por 443 e DNS.** Permite levar dados para fora, mas hoje nenhum segredo fica ao alcance do job.
5. **Sessão `sudo -iu gh-runner` aberta** fura o namespace via `/proc/<pid>/root` (seção 3). A regra é administrar só com `systemd-run --user`.
6. **Disponibilidade em outubro.** Se o runner cair, não há CI nem deploy normal até 01/11. Sobra só o "publicar-emergencia" (validação local + o seu OK). Não se publica sem teste por acidente: o desenho falha fechado.
7. **Latência do deploy.** Com uma instância só, o `ci` de um merge (quando `pular=false`) espera os jobs de PR na fila; um merge pode levar mais de 75 min até o `publish`. O `concurrency: deploy-main` guarda só 1 execução pendente.
8. **Taxa de self-hosted.** O GitHub adiou a cobrança de US$ 0,002/min sem nova data, e não se sabe se valerá para conta pessoal no plano Free. Acompanhar a página de billing.
9. **Fork e ações de terceiros:**
   - Manter desligado o "Run workflows from fork pull requests", como já está.
   - Sugiro desligar também o `allow_forking`.
   - Pinagem das ações por SHA (`allowed_actions: selected`) fica para a fase 2.

### O que você precisa decidir
1. **Quando:**
   - **(a)** instalar agora, aceitando que o merge do PR de migração consome cerca de 5 a 7 dos 10 minutos de outubro e que até 01/11 cabe no máximo mais um merge com código;
   - **(b)** instalar e validar o canário agora (custo zero) e fazer o merge da migração em 01/11.

   **Recomendo (b).**
2. **SSH e cron:** aprovar o `DenyUsers gh-runner`, o `/etc/cron.deny` e o `nologin` (passo 3; mexe em SSH, então pede o seu OK).
3. **Prioridade de CPU:** aceitar só o `CPUQuota=400%` ou acrescentar o `CPUWeight=50` no `user.slice`.
4. **Emergência:** aprovar o `workflow_dispatch` "publicar-emergencia" (publica sem CI, só com o seu OK).

---

## 10. Pontos não confirmados

**Descartados ou rebaixados (a evidência não sustentou do jeito que foram propostos):**
- **"`--keep-storage` ainda é aceito no buildx v0.37.0"** (operação M2) **×** "não existe" (GitHub M1). O `--help` não lista a flag; o resultado com ela não foi testado. Isso não importa: o desenho usa `--reserved-space`, que está listado.
- **Casar o nft por cgroup** (`socket cgroupv2`, isolamento C1, opcional). Fica fora: exige carregar a tabela depois que a slice existir e não acrescenta nada à correspondência por UID mais subuid.
- **`runs-on` por variável do repositório para voltar ao hospedado sem commit** (operação I3, GitHub I1). Os jobs novos não são portáveis: socket rootless, `container:` e `options` são próprios da VPS. Um `container:` condicional não está documentado de forma que eu possa garantir. O caminho de emergência é o "publicar-emergencia"; o "voltar ao hospedado" fica para depois de 01/11, num PR.
- **`ACL` em `/etc/easypanel`.** Substituída pelo `InaccessiblePaths`; a decisão sobre editar `/etc/easypanel` deixou de existir.
- **`umask 077` no `deploy` e limpeza do `/tmp` antigo** (isolamento I1). Desnecessário para o runner, porque o `/tmp` dele é privado. Pode ficar como higiene separada, com o seu OK.

**A validar no canário (passo 11), em ordem de risco:**
1. O `user@1500` e o Docker rootless sobem com `InaccessiblePaths`, `TemporaryFileSystem` e `ProtectProc=invisible`. Plano B: tirar o `ProtectProc`; o `cmdline` da produção não tem segredo (conferido por contagem).
2. O runner monta `/var/run/docker.sock` em todo job com `container:`. A origem, agora inacessível, não pode impedir a criação do contêiner.
3. Os hooks `JOB_STARTED` e `JOB_COMPLETED` rodam no host, e não no contêiner do job. Isso inclui o `COMPLETED` num job cancelado.
4. O Testcontainers e o Ryuk, de dentro do contêiner do job, alcançam as portas mapeadas com `DETACH_NETNS=false`. Se não alcançarem, um passo grava `TESTCONTAINERS_HOST_OVERRIDE` a partir de `/proc/net/route`.
5. A tag `mcr.microsoft.com/playwright:v1.63.0-noble` existe e traz o `git` (o `@playwright/test` do repo é 1.63.0).
6. O `docker` e o `rclone` montados do host funcionam na imagem noble (o `ldd` indicou só libc; uma revisão não conseguiu confirmar).
7. O pnpm 12.6.0 aceita `--store-dir` com o store em volume. Ele copia em vez de criar hardlink: funciona, só fica mais lento.
8. O DNS dentro do slirp4netns resolve: pelo `127.0.0.53`, liberado no nft, ou pelo `dns4`.
9. O `io.max` em `/dev/sda` vale para a escrita que passa pelo dispositivo loop. Confirmar no `io.stat` da slice.
10. O efeito do teto de IO no `fsync` da produção (seção 7).
11. Tempos reais: estimativa de 35 a 45 min por CI completo; os timeouts são provisórios.
12. O custo real do `publish` com cache só da `main`: estimativa de 5 a 7 min por merge, a medir no primeiro.
13. A expressão do `publish` no `workflow_dispatch` (seção 4).
14. O comportamento exato do GitHub com o saldo zerado no Free (os jobs hospedados não iniciam).
15. O caminho `bin/runsvc.sh` dentro do pacote do runner.

**Conferido nesta rodada (só leitura):**
- `/etc/subuid` e `/etc/subgid` só têm `deploy:100000:65536`, e o `login.defs` dá `65536` por usuário, então a faixa do `gh-runner` será `165536–231071`.
- O `DETACH_NETNS` vale `true` por padrão (linha 120 de `/usr/bin/dockerd-rootless.sh`).
- `system.slice` e `user.slice` têm `cpu.weight` 100 e 100.
- O `io.cost.qos` existe; o escalonador é `mq-deadline`.
- O `/` é ext4 `commit=30`, com 51 GB de 387 GB usados.
- Os diretórios graváveis por qualquer usuário no `/` são só `/tmp`, `/var/tmp` e `/var/crash`.
- Não há `cron.allow`/`cron.deny`/`at.allow`/`at.deny`, e o `cron` está ativo.
- O `sshd` não tem `AllowUsers`/`DenyUsers`, e usa `UsePAM yes`.
- `apparmor_restrict_unprivileged_userns=1`; systemd 255; Docker 29.7.2; buildx v0.37.0 (`--reserved-space` listado).
- `e2e/whatsapp.ts` e `e2e/mailpit.ts` leem `DATABASE_URL` e `MAILPIT_URL`, com fallback para o dev.
- O app usa o Mailpit pela API HTTP (`MAILPIT_URL`); a porta 1025 não é usada no E2E.

**Arquivos lidos:**
- `/home/deploy/servidor/projetos/nutridebby/.github/workflows/ci.yml`
- `/home/deploy/servidor/projetos/nutridebby/.github/workflows/deploy.yml`
- `/home/deploy/servidor/projetos/nutridebby/package.json`
- `/home/deploy/servidor/projetos/nutridebby/test/global-setup.ts`
- `/home/deploy/servidor/projetos/nutridebby/e2e/whatsapp.ts` e `e2e/mailpit.ts` (trechos)
- `/home/deploy/servidor/projetos/nutridebby/src/env.ts` (trechos)
- `/usr/bin/dockerd-rootless.sh` (trechos)
- `/etc/login.defs` (`SUB_*`), `/etc/subuid`, `/etc/subgid`
- `/etc/ssh/sshd_config` e `sshd_config.d/*` (só as diretivas de acesso)

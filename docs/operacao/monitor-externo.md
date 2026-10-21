# Monitor externo do site (healthchecks.io)

Runbook do monitor de "site fora do ar" (P15-05). Horários em BRT (a VPS e o log estão em UTC, 3 h à frente). Nunca
colar a URL do check neste arquivo, no chat, numa issue ou na linha de comando: ela vale como senha (quem a tem finge
que o site está no ar).

**No ar desde 20/10/2026, ~13:56**, por decisão do dono, no healthchecks.io (conta do dono), no lugar do UptimeRobot
da D3 do Plano 08. Faltam, como no [`go-live.md`](go-live.md): o alerta de teste
([Alerta de teste](#alerta-de-teste-go-live)), conferir que os termos do plano grátis do healthchecks.io permitem uso
comercial e, depois do merge deste runbook, reinstalar o script
(passo 3 da [Instalação](#instalação-uma-vez-e-de-novo-a-cada-mudança-do-script)) e ver o `diff` vazio: o instalado
em 20/10, 11:13, ainda tem o cabeçalho antigo de uma linha e não tem o `--retry-connrefused` (conexão recusada vai
direto como `/fail`, sem as 2 novas tentativas). Motivo: o incidente de 19–20/10/2026,
em que a VPS ficou ~25 h congelada sem ninguém saber
([§8.6 do manual técnico](../manual-tecnico/08-sustentacao.md#86-lacunas-o-que-hoje-não-é-vigiado), item 28).

## Como funciona

Modelo *dead man's switch*: quem avisa é a falta de sinal, não um robô de fora.

| Peça | Valor |
|---|---|
| Script | [`infra/monitor/nutri-saude.sh`](../../infra/monitor/nutri-saude.sh) (fonte da verdade), instalado em `/home/deploy/servidor/ferramentas/monitor-saude/nutri-saude.sh` (deploy, 700) |
| Quando roda | Cron do usuário `deploy`, `*/5 * * * *` |
| O que consulta | `https://nutri.wsscloud.tech/api/health` pelo endereço público (DNS, Traefik, app, banco e heartbeat do worker; [§6.4.3](../manual-tecnico/06-worker-seguranca-operacao.md#643-apihealth)), com 2 novas tentativas, 10 s entre elas, só em tempo esgotado, DNS que não resolve, conexão recusada e HTTP 408, 429, 500, 502, 503 ou 504 (o resto, como o 404 do Traefik com o serviço fora, vai direto como `/fail`) |
| O que manda | HTTP 200: ping no check. Qualquer outro código (ou nenhum): `/fail` com o texto `api/health: HTTP <código>` |
| Check | "NutriDebby – site no ar", período 5 min, tolerância 5 min |
| URL do check | `~/.config/nutri-saude/hc.url` do `deploy` (pasta 700, arquivo 600); chega ao `curl` pela entrada padrão (`-K -`), nunca pela linha de comando, onde o `ps` de qualquer usuário a mostraria |
| Log | `/home/deploy/servidor/ferramentas/monitor-saude/nutri-saude.log`: só o que foge do normal (`/fail` enviado, ping que falhou, URL ausente ou fora do formato). **Vazio = tudo certo** |
| Alerta | E-mail do dono (fora de `wsscloud.tech`, que não recebe e-mail): **na hora** se o health falhar (503 = banco fora ou worker sem heartbeat); **em ~10 min** (período + tolerância) se a VPS parar ou congelar, porque nenhum ping sai. Outro e-mail quando o check volta |

O que ele **não** cobre (o UptimeRobot da D3 cobria):

- **Checagem de fora da rede da VPS.** A consulta sai da própria VPS para o endereço público dela; uma falha só de
  entrada vista de fora (rede ou firewall da Hostinger, rota) pode passar com o check verde.
- **`/entrar`.** Só o `/api/health` é testado; uma página quebrada com o banco e o worker bem dá 200.

Alternativa ainda possível e grátis: **somar** o UptimeRobot depois (monitores de `/api/health` com a palavra `"ok"` e
de `/entrar`, 5 min, mesmo e-mail), sem tirar este.

## Instalação (uma vez, e de novo a cada mudança do script)

Tudo como `deploy`, na VPS. Nada aqui pede `sudo` nem mexe em serviço.

1. **Criar o check** no healthchecks.io (conta do dono): *Add Check*, nome `NutriDebby – site no ar`, *Period* 5 min,
   *Grace* 5 min; em *Integrations*, o e-mail do dono ligado para o check. Copiar a URL de ping (`https://hc-ping.com/…`).
2. **Gravar a URL sem expô-la** (fora do histórico do shell e da linha de comando):
   ```bash
   install -d -m 700 ~/.config/nutri-saude
   ( umask 077; nano ~/.config/nutri-saude/hc.url )   # colar a URL numa linha só; Ctrl+O, Enter, Ctrl+X
   chmod 600 ~/.config/nutri-saude/hc.url
   ```
   Nunca `echo 'https://hc-ping.com/…' > …` (fica no histórico) nem `cat` do arquivo. O script aceita só uma linha no
   formato `https://hc-ping.com/…` e tira espaços e `\r` da colagem.
3. **Instalar o script** a partir do repositório:
   ```bash
   install -d -m 775 ~/servidor/ferramentas/monitor-saude
   install -m 700 infra/monitor/nutri-saude.sh ~/servidor/ferramentas/monitor-saude/nutri-saude.sh
   ```
4. **Linha do cron** (`crontab -e`; conferir depois com `crontab -l`):
   ```
   # NutriDebby: monitor externo do /api/health → healthchecks.io (incidente de 19/10/2026), a cada 5 min
   */5 * * * * /home/deploy/servidor/ferramentas/monitor-saude/nutri-saude.sh >> /home/deploy/servidor/ferramentas/monitor-saude/nutri-saude.log 2>&1
   ```
5. **Primeiro ping agora:** `~/servidor/ferramentas/monitor-saude/nutri-saude.sh; echo "saída $?"` → `saída 0` e nada
   impresso; no painel do healthchecks.io, o check fica verde ("up") com o último ping de agora.

Reinstalar depois de mudar o script: só o passo 3 (a URL e o cron continuam). Conferir que o instalado é o versionado:
`diff infra/monitor/nutri-saude.sh ~/servidor/ferramentas/monitor-saude/nutri-saude.sh` (sem saída). Até a
reinstalação pendente do topo, o `diff` mostra só o cabeçalho (linhas 2–5 do versionado contra a linha 2 do instalado)
e o bloco do `curl` do health (linhas 20–24 contra 17–19: comentário e `--retry-connrefused`); qualquer outra diferença
é divergência de verdade.

## Alerta de teste (go-live)

Prova a cadeia check → e-mail → celular, sem derrubar nada. Manda um `/fail` à mão, pelo mesmo caminho do script (URL
pela entrada padrão):

```bash
printf 'url = "%s/fail"\n' "$(head -n 1 ~/.config/nutri-saude/hc.url | tr -d '\r[:space:]')" \
  | curl -fsS -m 10 -o /dev/null --data-raw "teste de alerta do go-live" -K - && echo "fail enviado"
```

1. Em segundos, o check fica vermelho ("down") e chega o e-mail de alerta; o texto "teste de alerta do go-live" fica
   no registro de pings do check. Conferir que o e-mail chegou também no celular (notificação do app de e-mail).
2. Na próxima volta do cron (até 5 min), o ping normal põe o check em "up" e chega o e-mail de volta.
3. Marcar o item no [`go-live.md`](go-live.md) com a data e a hora.

## Pausar (manutenção planejada)

Uma parada de até ~10 min sem resposta nenhuma (VPS parada, nenhum ping) não avisa (período + tolerância). Mas, com a
VPS no ar, o `/api/health` dá `/fail` e o alerta sai na hora: depois de ~30 s (as 2 novas tentativas do `curl`) se ele
continuar com tempo esgotado, DNS que não resolve, conexão recusada ou HTTP 408, 429, 500, 502, 503 ou 504; **sem nova
tentativa** com qualquer outro código, como o 404 do Traefik com o serviço do app fora, ou outra falha de rede (TLS,
conexão cortada). Para uma janela maior, ou um reinício do app, do banco ou do worker:

1. **Antes:** `crontab -e` e pôr `#` no começo da linha do `nutri-saude.sh`; no painel do healthchecks.io, *Pause* no
   check. Só o *Pause* não basta: o check pausado volta sozinho no próximo ping (salvo com a retomada manual ligada no
   check), e o cron pinga a cada 5 min.
2. **Depois:** tirar o `#` da linha; o primeiro ping (até 5 min) retoma o check. Ou rodar o passo 5 da instalação.

## Quando o alerta chega

1. `curl -s -w ' %{http_code}\n' https://nutri.wsscloud.tech/api/health` (de qualquer lugar, inclusive do celular).
2. **503 com `reason`:** ramo do motivo em
   [§6.9](../manual-tecnico/06-worker-seguranca-operacao.md#69-rotina-de-incidentes).
3. **Sem resposta e sem SSH:** a VPS parou ou congelou. O dono olha o hPanel (estado da VPS, console) e reinicia por ele,
   com o OK de sempre; depois, `uptime -s` e o `/api/health`. Foi o caso de 19–20/10/2026 (o host congelou o disco).
4. **200 de fora, mas o check vermelho:** ver o `nutri-saude.log` (ping ao healthchecks.io falhando, URL ausente ou
   fora do formato) e `crontab -l`.

O `nutri-saude.log` só cresce com falhas; depois de um incidente, guardar o trecho que importa na issue e esvaziá-lo
com `: > ~/servidor/ferramentas/monitor-saude/nutri-saude.log`.

## Desinstalar

`crontab -e` e apagar a linha; `rm ~/servidor/ferramentas/monitor-saude/nutri-saude.sh ~/.config/nutri-saude/hc.url`;
apagar o check no healthchecks.io (ou só pausá-lo). Sem outro monitor no lugar, a lacuna 1 do
[§8.6](../manual-tecnico/08-sustentacao.md#86-lacunas-o-que-hoje-não-é-vigiado) volta inteira.

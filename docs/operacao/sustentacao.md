# Sustentação do NutriDebby — checklist

Corpo da issue mensal `Sustentação AAAA-MM` (rótulo `sustentacao`). Como verificar, sinal de problema e ação de cada
item: [cap. 8 do manual técnico](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/08-sustentacao.md). Criar a issue:
`gh issue create --title "Sustentação AAAA-MM" --label sustentacao --body-file docs/operacao/sustentacao.md`
(na primeira vez, antes: `gh label create sustentacao` e `gh label create incidente`; os rótulos ainda não existem).
Os links abaixo são absolutos para funcionarem dentro da issue.

Regras: nunca colar segredo, nome ou e-mail de paciente, nem dado de saúde (só código do item, status e número). O
Claude só faz itens de leitura e **nunca** lê o banco de produção. Limpeza, reinício, variável e merge: só o dono.
Sinal de incidente → [§6.9](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/06-worker-seguranca-operacao.md#69-rotina-de-incidentes) e issue com
rótulo `incidente`. Horários em BRT (log da VPS em UTC, +3 h). Sem merge das 03h às 07h30.

## Diária — registrar só a exceção, em comentário ([§8.3.1](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/08-sustentacao.md#831-diária))
- D1 `/api/health` = 200 `{"status":"ok"}` — dono ou Claude
- D2 `/admin`, quadro "Servidor": backup do banco e dos arquivos de hoje; disco < 70% (detalhe sem root: `systemctl show nutri-backup.service -p Result,ExecMainExitTimestamp`) — dono
- D3 Log do worker: `retenção LGPD concluída`, `exportações vencidas apagadas`, `limpeza da agenda pública` entre 07h00 e 07h31 UTC (até ~07h50 se houve nova tentativa); o dono pode colar o comando do §8.2.1 sozinho — Claude
- D4 Caixa dos admins sem `alerta_backup` / `alerta_disco` — dono
- D5 Erros novos: Sentry (quando ligado) ou `"level":50` no log do app e do worker — dono / Claude
- D6 "Seu dia": avisos de armazenamento e WhatsApp; "Pedidos do titular" dentro do prazo — Debby
- D7 Monitor externo sem alerta (quando configurado) — dono

## Semanal — um comentário por semana ([§8.3.2](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/08-sustentacao.md#832-semanal))
- [ ] Semana 1: diárias em ___ de 7 dias; S1–S7
- [ ] Semana 2: diárias em ___ de 7 dias; S1–S7
- [ ] Semana 3: diárias em ___ de 7 dias; S1–S7
- [ ] Semana 4: diárias em ___ de 7 dias; S1–S7
- [ ] Semana 5 (se houver)

Itens de cada semana: S1 reinícios inesperados (`docker service ps` e `uptime -s`) · S2 memória < ~800 MiB,
`oom_kill` de `/proc/vmstat` sem subir e `OOMKilled=false` (nada de `journalctl`: como `deploy` ele volta vazio) ·
S3 pico diário do Resend < 80 · S4 nenhum `.N.tmp` órfão em `/srv/nutri/data` · S5 nenhum deploy entre 03h e 07h30
(`git fetch` antes do `git log origin/main`) · S6 páginas de status dos provedores sem incidente que nos afete ·
S7 digest da imagem do `nutri_app`/`nutri_worker` = último push no GHCR.
Diária sem comentário é registrada pela contagem "diárias em ___ de 7 dias" acima.

## Mensal ([§8.3.3](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/08-sustentacao.md#833-mensal))
- [ ] M1 Teste de restauração registrado em `docs/operacao/restauracao-AAAA-MM.md` (depois do P02-11; OK do dono) — dono
- [ ] M2 `docker system df`: recuperável ___ GB (limpeza só com OK do dono) — Claude
- [ ] M3 `df -h /` ___ % · `/srv/nutri/data` ___ · pasta do banco ___ (`du` dentro do `nutri_db`) — Claude
- [ ] M4 `/admin`: nenhum consultório > 80% de armazenamento nem da "Cota de WhatsApp" — dono
- [ ] M5 Cotas: Resend ___ / 3 000 · R2 ___ / 10 GB · GHCR ___ / 500 MB · Actions ___ / 2 000 min · Sentry ___ / 5 000 — dono
- [ ] M6 Cobrança: hPanel, Cloudflare, GitHub sem surpresa; cartão válido; alertas do Monarx no hPanel — dono
- [ ] M7 Certificado TLS vence em ___ (≥ 20 dias) — Claude
- [ ] M8 Pacotes pendentes ___ (`apt list --upgradable`); Docker/containerd ou kernel parado há mais de 30 dias? kernel em uso = instalado? (atualizar o Docker reinicia todos os contêineres: só o dono, com snapshot) — Claude → dono
- [ ] M9 GitGuardian sem incidente real aberto — dono
- [ ] M10 Pendências de vigilância: P02-11 backup (falta o passo do dono: chaves e timer) · E-07 Sentry · P08-02 monitor externo · Dependabot — Claude lembra
- [ ] M11 `pnpm audit --prod --audit-level high` em dev: ___ avisos; crítico/alto em next, react, better-auth, pg-boss, drizzle-orm ou Node 24 = incidente, PR em até 72 h — Claude → dono
- [ ] Comentário final com os números e issue fechada; issue do mês seguinte aberta

## Trimestral — janeiro, abril, julho e outubro ([§8.3.4](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/08-sustentacao.md#834-trimestral))
- [ ] T1 Acessos: admins, nutricionistas, GitHub, Easypanel, Cloudflare, Resend, Sentry; 2FA no hPanel, GitHub, Cloudflare, Resend e Easypanel; SSH (`authorized_keys`, sudoers, `sudo sshd -T` com `passwordauthentication no`); Easypanel na 3000 aberto à internet? — dono
- [ ] T2 Validade do token do GHCR no Easypanel, da chave do R2 e dos PATs do GitHub; data dos `EASYPANEL_DEPLOY_HOOK_*`: ___ / ___ / ___ — dono
- [ ] T3 Variáveis presentes no app e no worker (só os nomes) — Claude
- [ ] T4 Gerenciador de senhas com todos os nomes de §6.10 — dono
- [ ] T5 Duas versões da imagem no GHCR; política de snapshot conhecida — dono / Claude
- [ ] T6 Tamanho do banco e das maiores tabelas (banco de produção: só o dono) — dono
- [ ] T7 DMARC e domínio verificado no Resend — Claude → dono
- [ ] T8 Dependências (`pnpm outdated`); imagem base sem rebuild; `postgres --version` do `nutri_db` (reimplante = parada, só o dono com snapshot) — Claude → dono
- [ ] T9 Capítulo 8 e este checklist em dia (inclui limiar do M7) — Claude
- [ ] T10 Versão do Easypanel e do Traefik × changelog (atualização só pelo painel, pelo dono) — Claude → dono
- [ ] T11 Chave do backup do gerenciador abre o R2 **fora da VPS** (`rclone lsl cripto:db/diario`): "chave do gerenciador ok" — dono

## Anual — julho ([§8.3.5](https://github.com/fabianojp06/nutridebby/blob/main/docs/manual-tecnico/08-sustentacao.md#835-anual))
- [ ] A1 Domínio `wsscloud.tech` (vence 26/09/2027) com renovação automática e cartão válido — dono
- [ ] A2 Plano da VPS e do Easypanel — dono
- [ ] A3 Termos e cotas dos planos gratuitos (UptimeRobot, Resend, Sentry, R2, GitHub) — dono
- [ ] A4 Textos legais e prazo de guarda com o advogado/CRN — dono
- [ ] A5 Ensaio de desastre no papel (§6.5.9 e `restauracao.md`; último T11 ok; §1.8 basta para recriar o Easypanel) — dono + Claude
- [ ] A6 Custos do ano — dono
- [ ] A7 Incidentes do ano com registro e comunicação à controladora quando houve — dono

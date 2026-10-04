# Go-live do NutriDebby — checklist (P08-09)

Assinar só com **todos** os itens de "Bloqueia" marcados. Cada item diz quem confere e onde está a prova. Nunca colar
segredo neste arquivo (só o nome da variável). Horários em Brasília.

## Bloqueia (sem isso, nada de paciente real)
- [ ] Backup instalado no host (P02-11, etapas 6 e 8): timer ativo, primeiro `banco ok (N bytes)` e `arquivos ok` no log (o `banco ok` só sai com o `db/globais.sql` dos roles enviado, D6; `ERRO no backup do banco (roles falhou)` = falha), linhas em `backup_runs` — **dono**
- [ ] Teste de restauração feito e registrado (`docs/operacao/restauracao-AAAA-MM.md`; roteiro em `docs/operacao/restauracao.md`), duração dentro do RTO — **dono + Dev**
- [ ] Passphrase e salt do rclone crypt e os segredos do app/worker (`AUTH_SECRET`, `ENCRYPTION_KEY`, `FILE_URL_SECRET`, `VAPID_*`, R2, Turnstile, Resend, `EVOLUTION_*`) num gerenciador de senhas, fora da VPS — **dono**
- [ ] Plano 08 mergeado com a revisão completa e o `/security-review` (checklist reforçado) sem Critical/Important; PR da Tarefa 8 (textos legais) mergeado — **Dev**
- [ ] Textos legais v1.0 publicados (P08-06); a Debby aceitou o DPA v1.0; o novo aceite do paciente funciona (D25 + S-1) — **dono + Debby**
- [ ] Prazo de guarda confirmado pelo advogado/CRN (P-01) — **dono**
- [ ] Sentry recebendo erro de produção; o erro sintético com texto falso de saúde chegou **sem** o texto (runbook do Plano 08, passo 5: `docs/superpowers/plans/2026-10-04-nutridebby-08-go-live.md`, "Runbook do go-live") — **dono + Dev**
- [ ] Sentry, em *Settings → Security & Privacy*: **Data Scrubber**, **Default Scrubbers** e **Prevent Storing of IP Addresses** ligados (o erro sintético por `docker exec` não prova a opção do IP: conferir na tela) — **dono**
- [ ] Sentry, em *Client Keys (DSN)*: Rate Limit **por dia** abaixo de cota mensal ÷ 30. Ele vale para todos os eventos da DSN: num dia de muitas falhas, corta também os erros do app e do worker até a virada do dia. Se o plano Developer não permitir rate limit por chave, anotar aqui: a cota contra um job em falha contínua fica só com a `Dedupe` do SDK e o *Spike Protection*. **Não** criar `SENTRY_TRACES_SAMPLE_RATE` no Easypanel — **dono**
- [ ] Monitor externo ativo e o alerta de teste recebido no e-mail e no celular (D3); os termos do plano grátis permitem uso comercial (senão, a alternativa (b) da D3, HetrixTools) — **dono**
- [ ] `curl -sI https://<domínio>/entrar`: `content-security-policy` (com nonce), `strict-transport-security`, `x-content-type-options`, `x-frame-options`, `referrer-policy`; sem `x-powered-by` — **Dev**
- [ ] Se o domínio passar pelo proxy da Cloudflare (nuvem laranja): **Rocket Loader**, **Email Obfuscation** e o **Web Analytics automático** desligados. Eles injetam script sem nonce, que o `'strict-dynamic'` bloqueia: o Rocket Loader reescreve todos os `<script>` e derruba o app inteiro; a Email Obfuscation troca os e-mails das telas por `[email protected]` — **dono + Dev**
- [ ] k6 (roteiro em `docs/operacao/carga.md`; relatório em `docs/operacao/carga-AAAA-MM-DD.md`): relatório aprovado pela D4 (p95 das APIs ≤ 300 ms, páginas ≤ 800 ms, falhas < 1%, `notificacoes` < 20 s, LCP ≤ 2,5 s) — **Dev**
- [ ] 6ª tentativa de login errada em 15 min dá 429 com o IP real (`TRUSTED_PROXIES`, Plano 01 R17) — **Dev, em produção, com a conta de teste**

## Ambiente
- [ ] Limites do Easypanel revistos depois do k6 (`nutri_app`, `nutri_db`, `nutri_worker`) e a RNF-03 da spec atualizada; `cursoia_crm` sem impacto — **dono**
- [ ] WhatsApp (D16): `nutri_evolution` implantado, número da Debby conectado e a P-17 conferida (runbook do Plano 05, passo 5) **ou** go-live sem WhatsApp, decidido — **dono**
- [ ] Log do `nutri_evolution` com retenção curta (ele grava as mensagens recebidas; nota N11) — **dono**
- [ ] `VAPID_PUBLIC_KEY` do `nutri_app` igual à do `nutri_worker` (runbook do Plano 06, passo 2) — **dono**
- [ ] Turnstile com chaves reais; Resend com domínio verificado; **DMARC em `p=quarantine`** (nota do E-05) — **dono**
- [ ] Admin com 2FA; conta da Debby criada pelo admin (US-001), com 2FA ativada — **dono**
- [ ] Na tela do admin: "Taxa de faltas antes do sistema (%)" (E-08/P-15) e "Início do uso" preenchidos (D15) — **dono**
- [ ] Dados de teste em produção: decisão do dono e limpeza só com confirmação (pendência de 30/09) — **dono**
- [ ] Snapshot no hPanel antes do merge final; volta = redeploy da imagem anterior no GHCR (ficam as 2 últimas) — **dono**

## Produto e acessibilidade
- [ ] Teste manual do PWA no **Android** e no **iPhone (iOS 16.4+, de preferência um com Safari anterior ao 17.5)**: **foco visível** ao navegar com teclado/VoiceOver em `/entrar` e no portal (o axe roda só no Chromium), cores do portal no aparelho escuro (D18), instalar, ativar notificações, push real (lembrete, plano novo, conteúdo novo), plano offline, troca de conta no mesmo aparelho, foto HEIC do iPhone no diário (W-13; runbook do Plano 06, passo 5) — **dono**
- [ ] Teste manual do Plano 07: vídeo não listado do YouTube da Debby, Vimeo com `dnt=1`, "Carregar o vídeo" (D12), PDF de orientação, receita no plano — **dono**
- [ ] Acessibilidade fora do axe (X-5): `<details>` abertos, selo offline, estados de erro, tutorial do iOS, alvo de toque — conferência manual no celular — **dono + Dev**
- [ ] Painel no modo escuro e no claro, num computador e num tablet (768 px) — **Debby**
- [ ] Validação da Debby (P08-08): fórmulas do Apêndice A com casos reais, cálculo das receitas (RN-11), textos do E6 e do manual guiado, fluxo real de ponta a ponta — **Debby** (lista do que ela pediu mudar vai para o backlog)
- [ ] Treinamento feito (com o manual guiado e a página `/painel/ajuda`) — **dono + Debby**
- [ ] Job `retencao-lgpd` rodou em produção (log das 04h de Brasília; 07h UTC no log da VPS) — **Dev**

## Assinatura
- Dono: ____________________ Data: ___/___/______ — "Conferi os itens acima e autorizo o go-live."
- Debby (fluxo e fórmulas): ____________________ Data: ___/___/______
- CS-01 começa a contar em: ___/___/______ (o mesmo dia do "Início do uso" no admin)

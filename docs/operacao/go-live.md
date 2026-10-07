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

## Plano 10A — receita (liberação para uso real)
Nada disto bloqueia o deploy: `documentos_liberados` nasce desligado e nada aparece para a Debby até o admin ligar. Bloqueia **ligar "Documentos"** para o consultório dela (runbook do Plano 10A, etapa 7: `docs/superpowers/plans/2026-10-05-nutridebby-10a-receita.md`).
- [ ] Resposta escrita do CRN-3 à consulta (P-B1) arquivada: gov.br, assinatura com 2FA e código verificador, identificação do cliente, textos da D5 e a receita **digitalizada** com a entrega eletrônica — **dono + Debby**
- [ ] Textos da D5 e os marcados "(proposto)" na spec revistos pela Debby: a declaração da receita (inclusive os medicamentos isentos à base de vitaminas e minerais, Minor 10), a dica da categoria "Outro" (Minor 11), a recusa `sem_habilitacao`, os textos do link (RN-158), o cartão "Aguardando assinatura" e os guias `documentos`, `configuracoes` e `seguranca` do manual guiado — **Debby**
- [ ] Termo do paciente e DPA (P-B3/E-09) citando a entrega eletrônica (portal e link por e-mail com código), a assinatura usada e a página pública de verificação; o termo novo publicado e o novo aceite funcionando — **dono + advogado**
- [ ] Backup no host (P02-11) instalado e conferido (o item do bloco "Bloqueia" acima): receita é prontuário — **dono**
- [ ] Cota do Resend comporta o link e o código (até 2 e-mails por documento de paciente sem app, mais os reenvios) — **dono**
- [ ] O admin liga "Documentos" do consultório da Debby (D20) **e não desliga depois do uso real**: desligado, o consultório perde "Cancelar documento" e a entrega das receitas já assinadas (Minor 12) — **dono**
- [ ] Teste manual completo pela digitalizada, em produção, com pacientes de teste: receita (rascunho → preparar → fotos assinadas + código do 2FA), paciente **com** app (cartão no Início, "Abrir PDF", "Confirmo que recebi este documento"), paciente **sem** app (link + código por e-mail), verificação pelo QR no celular (`/v/<código>`, sem nada do paciente), a situação da entrega no painel e "Cancelar documento" (a verificação passa a "cancelado") — **dono + Debby**
- O Plano 10B acrescenta aqui a parte do gov.br e do certificado ICP-Brasil.

## Plano 11 — IA (liberação para uso real)
Nada disto bloqueia o deploy: sem `IA_PROVEDOR` a IA fica escondida, e com ela ligada nenhum consultório usa a IA até o admin clicar "Liberar". Bloqueia **liberar a IA** para um consultório com paciente real (A-06, D14). Passos e porquês: [`docs/operacao/ia.md`](ia.md). **Nada de dado real antes do passo 7.**
- [ ] 1. Console da Anthropic com a conta e o cartão da **empresa**: workspaces `nutridebby-dev` e `nutridebby-producao`, limite de gasto mensal em cada um (sugestão: US$ 10 e US$ 50), em produção `allowed_inference_geos = ["us"]` e `default_inference_geo = "us"`, uma chave por workspace (a chave nunca circula; só o nome `ANTHROPIC_API_KEY`) — **dono**
- [ ] 2. Retenção zero (ZDR) concedida por escrito para a organização (Messages API, PDF e imagem inline, saída estruturada, região `us`); negada ou cobrada → **parar** e decidir com o custo à vista (A-01) — **dono**
- [ ] 3. Parecer do advogado (art. 33, texto final do aviso ao paciente e do aditivo, suficiência do canal "e-mail ou em mãos com registro"); textos finais publicados numa versão nova de `AVISOS_IA` e `IA_ADITIVO_PARAGRAFOS`, com as constantes `*_MIN` subidas (PR curto, com revisão) — **dono + advogado + Dev**
- [ ] 4. Avaliação com os laudos fictícios (`pnpm ia:laudos` e `pnpm ia:avaliar`, na máquina do dono, chave do workspace **dev** conferida no Console, custo < US$ 10): precisão ≥ 95%, zero inventado, injeção sem vazar, nenhuma violação da RN-123, custo médio ≤ US$ 0,20; modelo escolhido (D12) e resultado registrado no PR do plano — **dono**
- [ ] 5. Lista de sinônimos (`SINONIMOS`) e textos de tela revistos pela Debby; depois do passo 7, 5 laudos reais cronometrados (CS-101 ≤ 2 min) — **Debby**
- [ ] 6. Variáveis no Easypanel (snapshot no hPanel antes; reinício só com o OK do dono): app e worker com `IA_PROVEDOR=anthropic`, `IA_MODELO_LEITURA`, `IA_INFERENCE_GEO=us`, `IA_TETO_GLOBAL_MENSAL_USD=50`; **só no worker** `ANTHROPIC_API_KEY` (workspace de produção); no log do worker, a linha "IA de laudos" com `ia: anthropic` e `chave: presente` — **dono**
- [ ] 7. Com os passos 1–6 feitos **e** o backup no host (P02-11) funcionando: Admin → coluna "IA" do consultório → "Liberar" (em produção o botão recusa enquanto o aviso ou o aditivo forem provisórios, D22); limite de IA ajustado se preciso (padrão US$ 15); a nutricionista ativa em Configurações e informa cada paciente (Privacidade → Uso de IA) — **dono + Debby**
- Emergência: `IA_DESLIGADA=1` no Easypanel (app e worker) esconde a IA de todos; "Bloquear" no admin desliga um consultório.
- Todo mês: soma de `ia_uso` do mês (coluna "Uso de IA no mês" do admin) × relatório de custo do Console por geo; diferença > 5% abre investigação (RNF-108).

## Assinatura
- Dono: ____________________ Data: ___/___/______ — "Conferi os itens acima e autorizo o go-live."
- Debby (fluxo e fórmulas): ____________________ Data: ___/___/______
- CS-01 começa a contar em: ___/___/______ (o mesmo dia do "Início do uso" no admin)

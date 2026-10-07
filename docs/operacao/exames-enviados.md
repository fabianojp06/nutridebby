# Runbook do dono — exames enviados pelo paciente (Plano 12)

Origem: seção "Runbook do dono" do plano
[`2026-10-07-nutridebby-12-exames-paciente.md`](../superpowers/plans/2026-10-07-nutridebby-12-exames-paciente.md), copiada
sem mudança, salvo um ajuste: no backlog, a liberação para uso real ficou como **P12-15** (a P12-14 virou a Tarefa 14,
sessão da equipe, acrescentada pelo dono na execução — R-D3); onde o plano diz P12-14, aqui está P12-15. Manual técnico:
[cap. 11](../manual-tecnico/11-exames-enviados.md).

**Estado das decisões em 07/10/2026 (contexto para os passos abaixo):**

- **D-R2 aprovada:** o limite do job `image` é **265 MB**; a imagem ficou em 262–263 MB depois da Tarefa 3 (passo 1:
  conferir o número final no job `image` do PR).
- **D-R1 revista pela R-D4:** processo filho da rasterização com teto de **256 MiB**; pico do job (worker + filho)
  **≤ 400 MiB**, medido 270–310 MiB no pior caso permitido (PDF de 20 MiB com 10 páginas de fotos de 12 MP); o
  `nutri_worker` tem limite de **1 GiB** no Easypanel (conferido em 07/10/2026). Os riscos citados no passo 3 estão na
  tabela "Riscos e pendências que ficam" do plano (R1 a R9).
- **D-R3:** os textos da exclusão atendida já estão no código (e-mail e aba Privacidade); o passo 6 (a) é a confirmação
  da redação com o advogado.

---

## Passos

Nenhum passo é do código; cada um tem dono. A função nasce **desligada** em todo consultório (D18 = a): nada muda para os pacientes até a nutricionista ligar.

1. **Antes do merge (merge = deploy).** Snapshot da VPS no hPanel; OK explícito do dono no PR. Conferir no PR o job `image` do CI: a imagem comprimida tem de ficar dentro do orçamento (**260 MB**, ou 265 MB se o dono aprovou a D-R2 ★ antes da T3); se passar, a T3 parou e pediu a decisão (subir o orçamento não custa nada).
2. **Backup no host (P02-11) — continua pendente.** Os envios ficam só em `/data` da VPS até o backup ser ligado. Quando ligar, instalar o `nutri-backup.sh` desta versão (com o `--exclude` das pastas `exame_pagina/` e `exame_original/`, D8 ★) — regra 10: o script mudou, reinstalar no host. **Não ligar o recebimento para pacientes reais antes do backup.**
3. **Teste no consultório (Debby, com dado fictício).** Em Configurações, marcar "Receber exames enviados pelos pacientes pelo app" e salvar. Com uma conta de paciente de teste no celular dela: enviar 1 PDF de laudo **fictício** (2 a 3 páginas) e 3 fotos **reais de um papel qualquer** (uma HEIC do iPhone, se tiver), conferir "Processando…" → "Aguardando sua nutricionista", o e-mail genérico, a fila com o contador, as páginas legíveis, aceitar um, recusar outro com "Outro motivo" e cancelar um terceiro pelo app. Anotar o tempo de "Processando…" (RNF-161: até 60 s) e se as páginas estão legíveis em 2000 px / qualidade 85 (PM-9). **HEIC de 24 MP ou mais:** conferir no log do worker se houve "falhou" por memória (ver Riscos).
4. **Onde fica no portal (D4 ★, PM-10).** Confirmar com a Debby que "Meus exames" em Perfil + "Enviar exame" no Início bastam; se quiserem aba própria, é uma troca em `ITENS_DO_PORTAL` (outra entrega).
5. **Leitura por IA de envios (D9 ★, R-174).** Hoje a IA segue bloqueada para dado real (Plano 11, `ia_liberada = false`). Antes de a admin liberar a IA, o passo 4 do runbook do Plano 11 (avaliação com laudos fictícios) deve incluir laudos **rasterizados** (2000 px, só imagem): se a precisão cair, subir `ENVIO_LADO_MAX` (até 2576 px, o teto da IA) e medir a memória de novo (T3).
6. **Textos a confirmar com o dono/advogado (P12-15).** (a) A T12 já põe os exames enviados não aceitos no e-mail "Seu pedido de exclusão de dados foi atendido" e na aba Privacidade do painel (texto proposto, D-R3 ★): o advogado confirma a redação; se mudar, troca-se no código e na spec do MVP **antes** do passo 7. (b) O Termo de Uso e Privacidade (E-09/P08-06) passa a falar do canal de envio de exames: revisão pela nutricionista antes de entrar no prontuário, expiração com apagamento em 90 dias, apagamento na recusa e no cancelamento; o advogado confirma a base do art. 11, II, "f" (tutela da saúde) e o dado de terceiro que transita até a recusa "Exame de outra pessoa" (R-165). (c) A decisão sobre o texto livre dos envios não aceitos (R9). (d) O lembrete dos 30 dias só sai junto de um envio novo (D6 ★, PM-12): a Debby diz se precisa de lembrete próprio.
7. **Ligar para pacientes reais.** Com 1–6 feitos — o passo 6 (a) com o texto **já alterado no código**, não só decidido — a Debby avisa os pacientes de que podem enviar exames pelo app. Acompanhar a coluna "Exames do app" no admin e, na primeira semana, os avisos "PDF do paciente recusado na rasterização" e "exame enviado não processado" no log do worker (só ids e motivo).

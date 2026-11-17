# NutriDebby — Financeiro do consultório (Plano 20) — Design

| Item | Valor |
|---|---|
| Versão | 0.2 (revisão de 16/11/2026: lentes banco/RLS, normas, interface e completude; registro na §17), com os ajustes técnicos da revisão do plano em 17/11/2026 (§18; nenhuma regra aprovada mudou) |
| Data | 2026-11-16 |
| Status | **Aprovada para virar plano.** O dono aprovou em 16/11/2026 todas as recomendações da proposta ("aprovo todas as recomendações, pode seguir"): as decisões F-D1 a F-D12 e as respostas F-D13 a F-D18. As F-D19 a F-D30 são decisões minhas, tiradas da crítica de completude e conferidas no código; o dono pode corrigir qualquer uma. Na v0.1, a F-D19 **contrariava** a recomendação aprovada da F-D7 ("avisa na tela, mas não cancela a cobrança sozinho"); a v0.2 volta ao que o dono aprovou e deixa a alternativa como pergunta (F-P5). A F-D18 foi acertada (seção no Início em vez de aba, R-266 do Plano 18). Conferida contra a `main` 5482450 (Planos 01–16 em produção, PR #45). Pareceres externos pendentes (advogado, CRN-3, contador) estão na §14 e não travam a v1 |
| Itens do backlog | Backlog "Paridade Dietbox", onda 1: **PD-30** (lançamentos, categorias, saldo inicial), **PD-31** (cobrança por consulta e pendências por paciente), **PD-32** (fluxo de caixa e entradas × saídas), **PD-33** (financeiro na ficha do paciente — última tarefa, depende do Plano 18) |
| Insumos | Proposta aprovada (`.sessoes/proposta-plano-20.json`: brief, crítica de completude, normas conferidas em 16/11/2026 e levantamento do código); referência funcional: o controle financeiro do Dietbox. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (D-02: financeiro do consultório na Fase 2; RN-06 fuso; RNF-08 LGPD; RNF-11 log; RNF-12 formatos), [`2026-10-08-nutridebby-app-paciente-g-design.md`](2026-10-08-nutridebby-app-paciente-g-design.md) (formato desta spec) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) (RLS, auditoria, guardas) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) (agenda, presença, manual guiado) |
| Numeração nova | US-300 a US-309 · RN-300 a RN-329 · RNF-300 a RNF-307 · CS-300 a CS-303 · R-300 a R-314 · DEP-F1 a DEP-F8 · PM-F1 a PM-F14 · **F-D1 a F-D30** (decisões deste documento; o prefixo "F-" evita colisão com as D dos planos e das outras specs, como "G-D" e "A-D"). O bloco **300** fica para o Plano 20 porque as specs dos Planos 18 e 19 foram escritas em paralelo: a do Plano 19 usa o bloco 230–259 e a do Plano 18 o bloco 260–284 (conferido nos worktrees em 16/11/2026); não há colisão |

---

## 1. Visão

Hoje a nutricionista controla o dinheiro do consultório fora do NutriDebby (no Dietbox ou numa planilha). O código não
tem nada de financeiro (conferido em 16/11/2026: nenhuma tabela de lançamento, categoria, saldo ou preço; o manual
técnico diz "não há cobrança", cap. 01, linha 26). O Plano 20 cria um módulo **Financeiro** no painel, em
`/painel/financeiro`, com cinco telas: **Resumo · Lançamentos · Pagamentos pendentes · Relatórios · Configurações**.

1. **Lançamentos (PD-30).** "Nova entrada" e "Nova saída", com valor, categoria, vencimento, data de recebimento ou
   pagamento (vazia = ainda não aconteceu), forma de pagamento, descrição curta e, nas entradas, o paciente
   (opcional). Categorias editáveis, com uma lista inicial. Saldo inicial do caixa com data.
2. **Cobrança da consulta (PD-31).** Ao marcar a consulta como **Realizada** — pela tela da consulta ou ao registrar o
   atendimento ligado a ela —, o sistema cria a cobrança com o **valor da consulta** configurado. Na tela da consulta a
   nutricionista ajusta o valor e marca "Recebido". O que não foi recebido aparece em **Pagamentos pendentes**, por
   paciente. Nada é enviado ao paciente.
3. **Resumo e relatórios (PD-32).** Saldo atual, entradas e saídas do mês (realizadas e a realizar), últimos
   lançamentos; **Fluxo de caixa do ano** (categorias × meses, com o saldo de cada mês) e **Entradas e saídas nos
   últimos 12 meses** (tabela e barras simples). Download em planilha (CSV) para o contador.
4. **Financeiro na ficha (PD-33).** Seção "Financeiro" no Início da ficha (registro de seções do Plano 18), com o
   total em aberto e os últimos lançamentos do paciente e o link para a lista completa. Entra por último, em cima da
   ficha nova do Plano 18 (F-D18).

O que **não** muda: o portal do paciente e a página pública de agendamento não mostram nada de financeiro; a agenda
continua igual, salvo a seção "Cobrança" na tela da consulta e o efeito de "Realizada"/"Faltou" na cobrança.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-300 | Da consulta terminada ao "Recebido": a nutricionista marca "Realizada" e registra o recebimento **na mesma tela**, sem digitar o valor (com o valor da consulta configurado) | E2E (US-303): realizada → cobrança → recebido → aparece no Resumo |
| CS-301 | Os totais do Resumo, do Fluxo de caixa e dos CSVs **batem** com a soma dos lançamentos, centavo a centavo, inclusive na virada do mês no fuso do consultório | Teste de propriedade com lançamentos aleatórios + testes de borda (dia 1º, 00h00 e 23h59 em `America/Sao_Paulo` com o servidor em UTC) |
| CS-302 | **Zero** valor, descrição ou nome de paciente do Financeiro em log ou no Sentry | Teste que captura o logger e o `beforeSend` do Sentry nos caminhos de erro do módulo (RNF-300) |
| CS-303 | A Debby fecha um mês inteiro só no NutriDebby (saldo e pendências conferidos com o extrato) até 30 dias depois do deploy | Conferência com a Debby, registrada no runbook do fechamento |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-300 | **Só a nutricionista** (sessão `nutri`) vê e mexe no Financeiro. Não existe recepcionista (`user.app_role` aceita só `admin`, `nutri` e `paciente`, `src/db/schema/auth.ts:46`); o admin nunca consulta | Código; Res. CFN 599/2018, art. 20; F-D1 |
| C-301 | **Atendimento particular só.** Sem convênio nem plano de saúde (Res. CFN 599/2018, art. 51; Res. CFN 856/2026, art. 65: vedado cobrar do paciente o que o plano já paga) | Normas; F-D7 |
| C-302 | **Sem cobrança ao paciente pelo sistema.** Nenhum envio por WhatsApp, e-mail ou push sobre valores; nada no portal (`/p`) nem na página pública | CDC, arts. 42 e 42-A; LGPD, arts. 6º, I e 9º (finalidade nova); F-D13 |
| C-303 | **Sem dependência nova.** Gráficos em SVG/CSS desenhados na página; CSV gerado em texto numa rota do painel; nenhum PDF (a regra 9 manda PDF só no worker) | `package.json` sem biblioteca de gráficos; F-D10 |
| C-304 | **Sem arquivo novo.** Não há anexo de comprovante: nenhum tipo novo em `stored_files` (regra 9 do CLAUDE.md fica intacta) | F-D10, §2.2 |
| C-305 | **Datas de calendário no fuso do consultório.** Vencimento e pagamento são `date`; "hoje" e "mês" saem de `tenants.fuso` (`hojeNoFuso`, `src/modules/pacientes/datas.ts:23`), nunca da data UTC do servidor | MVP RN-06; F-D3 |
| C-306 | **Sessões paralelas.** Planos 17 (`nutridebby-a`), 18 (`nutridebby-18`) e 19 (`nutridebby-b`) escrevem ao mesmo tempo. O branch do Plano 17 já tem `drizzle/0118_lembretes_rotina.sql`, `0119_rls_lembretes_rotina.sql` e `0120_lembretes_rotina_sem_apagar.sql`, sem merge. **Número de migration não se reserva:** o migrador do Drizzle só aplica a migration cujo `when` é maior que o da última aplicada, então quem mergeia depois **gera de novo** em cima da `main` (`docs/operacao/sessoes-paralelas.md`, §5) | Worktrees conferidos em 16/11/2026; §9; §13 |
| C-307 | **Sem tocar em `tenants`.** Saldo inicial e valor da consulta ficam numa tabela própria; os gatilhos de colunas de `tenants` (`app_tenants_interruptores_da_admin`, `tenants_ia_nutri_da_equipe`) não mudam | F-D2 |

### 1.3 Dependências (conferidas no código em 16/11/2026, `main` 5482450)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-F1 | **Agenda (Plano 05)** | Consulta, situação, presença | ✅ `appointments` (`src/db/schema/agenda.ts:52`): status `agendada`, `confirmada`, `cancelada`, `realizada`, `faltou`; `patient_id` NOT NULL; `UNIQUE (tenant_id, patient_id, id)` (`appointments_tenant_paciente_id_unique`) — alvo da FK composta da cobrança. Nenhuma coluna de valor |
| DEP-F2 | **Presença (US-037)** | Primeiro caminho para "Realizada" | ✅ `registrarPresenca` (`src/modules/agenda/presenca.ts:31`): trava paciente (`FOR KEY SHARE`, `travarPacienteDaConsulta`) → consulta; aceita corrigir (`realizada` ↔ `faltou`), recusa `faltou` com atendimento ligado (`MSG_PRESENCA.temAtendimento`) e vale **também para paciente bloqueado ou anonimizado** (comentário "Rodada 1"). Chamado só por `presencaAction` (`src/app/painel/agenda/actions.ts:64`), a partir da tela da consulta. A página de pendências de presença (`src/app/painel/agenda/pendencias/page.tsx`) só lista e leva à consulta (conferido) |
| DEP-F3 | **Atendimento ligado à consulta (Plano 05)** | Segundo caminho para "Realizada" | ✅ `registrarAtendimento` (`src/modules/pacientes/atendimentos.ts:66`): com `appointmentId`, trava paciente (`carregarPacienteParaEscrita`, `FOR UPDATE`, recusa bloqueado e anonimizado) → consulta (`FOR UPDATE`) e, se `c.status !== 'realizada'`, grava `realizada` (linha 83) — inclusive a marcada como `faltou` por engano |
| DEP-F4 | **Cancelamento de consulta** | Saber se "consulta com cobrança cancelada" existe | ✅ Não existe: só consulta `agendada`/`confirmada` é cancelada (`STATUS_ATIVOS`, definido em `src/modules/agenda/consultas.ts:51` e usado em `cancelamento.ts:40`), e a cobrança só nasce em `realizada`. O caso real é a **correção para Faltou** (F-D19) |
| DEP-F5 | **RLS e guardas** | Tabelas novas | ✅ `app_enable_tenant_rls`, `app_enable_patient_rls` (0000: com `patient_id` nulo, `NULL = app_current_patient()` não passa, então a sessão de paciente não vê a linha), `app_enable_staff_only` (0020), `app_enable_audit` (0007: `nullif` no `patient_id`, linha sem paciente é auditada sem paciente). Guardas `src/db/rls-guard.ts` (`STAFF_ONLY`), `src/db/audit-guard.ts`, `test/isolamento.test.ts` (`FABRICAS`, `COM_MAE`, `SEM_DELETE`, `DELETE_REVOGADO`, `IMUTAVEIS`, `SO_APAGA`, `ULTIMAS`) |
| DEP-F6 | **LGPD (US-018, US-046)** | Exportação e anonimização | ✅ `montarDados` (`src/modules/pacientes/exportacao-job.ts:318`: "todas as tabelas do paciente, menos as staff_only" — `ia_tarefas` entra por **inclusão explícita**, seção `ia`, linhas 198-203); motivo de cancelamento da nutricionista fora da exportação ("Só você vê", linhas 167-168). `anonimizarVencidos` (`src/modules/pacientes/lgpd.ts:481`) chama `app_anonimizar_aceites` e afins antes do UPDATE de `patients`; `anonimizarAgenda` (linha 457) limpa o texto livre e mantém a consulta |
| DEP-F7 | **DPA (US-002)** | Versão 1.1 com novo aceite | ✅ `DPA_VERSAO = '1.0'` (`src/modules/plataforma/dpa.ts:15`); mudar a versão leva a nutricionista a `/painel/dpa` (`requireNutri`) e as APIs do painel dão 403 até o aceite (`requireApiNutri`); `DPA_MUDOU` já existe. O aditivo de IA remete às cláusulas e à cláusula 8 do DPA: **a numeração das cláusulas não pode mudar** |
| DEP-F8 | **Ficha do paciente (Plano 18)** | Seção "Financeiro" no Início (PD-33) | ⬜ A ficha atual (`src/app/painel/pacientes/[id]/abas.tsx`) tem 12 abas no limite de 1280 px (comentário das linhas 31-32). A spec do Plano 18 (`nutridebby-18`) acrescenta a aba "Perfil" (13 abas, D12) e registra na **R-266** que uma 14ª aba "Financeiro" não cabe a 1280 px; o mesmo documento cria o **registro de seções** do Início (PD-12, D14, RN-277). **Corrigido em 17/11 (§18):** a spec do Plano 18 revista **não** prevê mais a seção do Financeiro com `auditRead` próprio — a RN-277 de lá diz que o `resumo` de uma seção nunca chama `auditRead`, e a P-6, a §11, a R-266 e a §13 de lá ainda falam em **aba**. O contrato da seção (US-308, RN-329) depende de decisão do dono com a orquestradora (§18, pergunta 1). O Plano 18 ainda não está na `main`. A US-308 só começa depois do merge do PR 1 dele (registro) e dessa decisão (F-D18) |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | Backlog |
|---|---|---|---|
| F-01 | **Configuração** (`/painel/financeiro/configuracoes`) | Primeiro acesso guiado; saldo do caixa com data; valor da consulta; categorias de entrada e de saída (renomear, arquivar, reativar, excluir sem uso, criar) | PD-30, PD-31 |
| F-02 | **Lançamentos** (`/painel/financeiro/lancamentos`) | Lista com filtros (mês, tipo, categoria, situação, forma de pagamento; paciente pelo link), totais, "Nova entrada", "Nova saída", editar, marcar recebido/pago, desfazer recebimento, cancelar com motivo | PD-30 |
| F-03 | **Cobrança da consulta** | Criada ao marcar "Realizada" (dois caminhos, F-D13); seção "Cobrança" na tela da consulta (valor, "Marcar como recebido", "Registrar cobrança" manual); aviso na correção para "Faltou" (F-D19: não cancela sozinho) | PD-31 |
| F-04 | **Pagamentos pendentes** (`/painel/financeiro/pendencias`) | Lista por paciente (em aberto, quantidade, mais antiga, em atraso) e detalhe do paciente com "Marcar como recebido" | PD-31 |
| F-05 | **Resumo** (`/painel/financeiro`) | Cartões Saldo atual, Entradas do mês, Saídas do mês, Pagamentos pendentes; últimos lançamentos; avisos de configuração | PD-32 |
| F-06 | **Relatórios** (`/painel/financeiro/relatorios`) | Fluxo de caixa do ano; Entradas e saídas nos últimos 12 meses (tabela + barras); CSV dos lançamentos de um período e do fluxo do ano | PD-32 |
| F-07 | **LGPD e textos legais** | Seção `financeiro` no `dados.json` (inclusão explícita); anonimização (`app_anonimizar_financeiro`); textos da exclusão na aba Privacidade (nutricionista), nos e-mails `pedido_exclusao_registrado` e `exclusao_atendida` e na confirmação do portal (paciente); rótulo "Financeiro" no Histórico de acessos; **DPA 1.1** com novo aceite | — |
| F-08 | **Menu e manual guiado** | Item "Financeiro" no menu do painel; guia `financeiro` (`data-guia`) nas telas novas; guias `boas-vindas` e `agenda` com o texto novo | — |
| F-09 | **Seção "Financeiro" no Início da ficha** | Total em aberto e os últimos lançamentos do paciente, "Ver todos" (lista filtrada) e "Nova entrada" com o paciente preenchido, `auditRead` ao abrir quando há lançamento. Pendurada no registro de seções do Plano 18. **Última tarefa**, em cima do Plano 18 | PD-33 |

### 2.2 Fora

| Item | Por quê |
|---|---|
| Nota fiscal (NFS-e), livro-caixa, carnê-leão, Receita Saúde | Ficam com o contador. O "Gerar NF" do Dietbox é da assinatura do próprio Dietbox, não do consultório. Nutricionista não é obrigada ao Receita Saúde (IN RFB 2.240/2024, segundo o CFN) |
| Recibo em PDF para o paciente | A quitação é dever da nutricionista (Código Civil, arts. 319 e 320). Se entrar um dia: PDF só no worker (regra 9) e com a assinatura dela |
| Cobrança online (Pix automático, boleto, cartão, link de pagamento, Asaas) e conciliação bancária | Integração paga e plano à parte |
| Cobrança ou lembrete de pagamento ao paciente (WhatsApp, e-mail, push) | Finalidade nova para o WhatsApp autorizado e CDC, arts. 42 e 42-A — vai ao advogado (§14) |
| Qualquer coisa financeira no portal (`/p`) e na página pública, inclusive o preço antes do parecer do CRN-3 | C-302; Res. CFN 599/2018, art. 57 × Res. CFN 856/2026, art. 68 (§14) |
| Papel de recepcionista e permissão "acesso ao financeiro" | O papel não existe (C-300) |
| Várias contas com saldo separado (banco, dinheiro, maquininha) e transferências | F-D14: uma conta só, com a forma de pagamento por lançamento |
| Preço por tipo (primeira consulta × retorno), por modalidade (presencial × online) ou lista de serviços | F-D15: um valor único, editável em cada cobrança. `appointments.modalidade` existe, mas a escolha do dono foi o valor único; preço por modalidade fica no backlog |
| Lançamentos recorrentes (aluguel todo mês), parcelamento, pacotes e planos de acompanhamento pagos à parte | YAGNI na v1 |
| Convênios e planos de saúde | C-301 |
| Anexo de comprovante | C-304 |
| Cobrança automática de falta | À espera do CRN-3 (Res. CFN 856/2026, art. 65, "serviços não prestados"). A nutricionista pode lançar a falta à mão (F-D7) |
| Cupons, descontos promocionais, sorteios | Vedados (Res. CFN 599/2018, art. 57; Res. CFN 856/2026, art. 68, III) |
| Cartões financeiros na página Início; relatórios em PDF | Fica no Financeiro; PDF só no worker (C-303) |
| Importar planilha do Dietbox | F-D28: a v1 começa com lançamento à mão (saldo inicial + entradas previstas por paciente) |
| "Dicas" do Dietbox | O manual guiado do Financeiro e a Central de Ajuda fazem esse papel (F-08) |
| A aba "Financeiro" dos "Relatórios gerais" do Dietbox | Coberta pelos dois relatórios da F-06 |
| Guarda "só pelo prazo fiscal, depois desvincula" (rotina própria no worker) | F-D16: o financeiro segue o prontuário |
| Termo do paciente 1.1 | F-D17: o texto muda na próxima revisão do termo, sem pedir novo aceite agora (§10) |

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`, DPA 1.1 aceito) | Tudo no Financeiro: configurar, lançar, editar, marcar recebido/pago, cancelar, ver relatórios, baixar CSV; criar e receber a cobrança na tela da consulta; ver a seção Financeiro da ficha | Apagar lançamento (não existe DELETE, F-D5); mudar tipo, paciente, consulta ou autor de um lançamento; alterar lançamento cancelado ou anonimizado; criar lançamento para paciente bloqueado ou anonimizado; no lançamento de paciente bloqueado, fazer algo além de receber, desfazer o recebimento, **reduzir** o valor e cancelar (F-D20) |
| **Paciente** | Receber, pela cópia "Baixar meus dados", o que é dele no Financeiro (F-D22) | Ver qualquer linha das tabelas do Financeiro, nem as próprias (`staff_only`); escrever nelas |
| **Admin** | — | Consultar o Financeiro (nunca usa `withTenant` nessas tabelas) |
| **Worker** | Ler para a exportação do titular; anonimizar (`app_anonimizar_financeiro`, F-D23) | Criar ou editar lançamento |
| **Público** | — | Tudo (`publico_negado`, sem entrada em `PUBLICO_LIBERADO`) |

---

## 4. Arquitetura

### 4.1 Rotas e navegação

| Tela | Rota | Título (h1) |
|---|---|---|
| Resumo | `/painel/financeiro` | "Financeiro" |
| Lançamentos | `/painel/financeiro/lancamentos` (`?mes=AAAA-MM&tipo=&categoria=&situacao=&forma=&paciente=`; sem `mes`, o mês atual no fuso; com `paciente` e sem `mes`, todos os meses — RN-306) | "Lançamentos" |
| Novo lançamento | `/painel/financeiro/lancamentos/novo?tipo=entrada|saida[&paciente=<id>]` | "Nova entrada" / "Nova saída" |
| Editar lançamento | `/painel/financeiro/lancamentos/[id]` | "Entrada — {categoria}" / "Saída — {categoria}" (sem paciente e sem data no título: a data de referência muda quando o lançamento é recebido) |
| Pagamentos pendentes | `/painel/financeiro/pendencias` | "Pagamentos pendentes" |
| Pendências de um paciente | `/painel/financeiro/pendencias/[patientId]` | "Pagamentos pendentes de {nome}" |
| Relatórios | `/painel/financeiro/relatorios?ano=AAAA` | "Relatórios" |
| Configurações | `/painel/financeiro/configuracoes` | "Configurações do Financeiro" |
| CSV dos lançamentos | `GET /api/painel/financeiro/lancamentos.csv?de=&ate=&pacientes=0|1` | — |
| CSV do fluxo de caixa | `GET /api/painel/financeiro/fluxo-de-caixa.csv?ano=AAAA` | — |

- **Menu do painel:** item "Financeiro" (`/painel/financeiro`) para **toda** nutricionista, entre "Conteúdos" e
  "Configurações" (`ITENS_DO_MENU`, `src/app/painel/navegacao.ts`); `itemAtual` marca o item em todo `/painel/financeiro/…`.
  Sem contador no item (a contagem de pendências fica no Resumo).
- **Navegação interna:** abaixo do h1, `nav aria-label="Seções do Financeiro"` com "Resumo · Lançamentos · Pagamentos
  pendentes · Relatórios · Configurações" (`aria-current="page"` na atual), no mesmo estilo das abas do prontuário.
- **Download do CSV** (navegação GET, não `fetch`): o formulário de Relatórios é um componente cliente que confere o
  período antes de navegar ("De" até "Até", no máximo 366 dias, "De" ≤ "Até") e mostra o erro em `role="alert"` junto
  do campo "Até", sem sair da página. A rota confere de novo e, por ser uma navegação, **nunca responde JSON**: período
  inválido → redirect 303 para `/painel/financeiro/relatorios?erro=periodo` (a página mostra "Escolha um período de
  até 12 meses." em `role="alert"` junto do campo); sem sessão (401 de `requireApiNutri`) → redirect para o login com
  a volta para Relatórios; DPA pendente (403) → redirect para `/painel/dpa`, o mesmo destino de `requireNutri`.
- **Não colide** com `/painel/agenda/pendencias` (pendência de presença, US-037) nem mexe em `/painel/configuracoes`
  (hub disputado). O rótulo é **"Pagamentos pendentes"**, nunca só "Pendências" (F-D26).

### 4.2 Módulo

`src/modules/financeiro/` (todas as funções com `withTenant(ctx, …)`, `ctx` com `actorUserId` e `ip`; cada função
exportada que lê ou grava as tabelas confere `ctx.role === 'nutri'` antes de abrir a transação — numa sessão de
paciente, `staff_only` devolveria vazio em silêncio; as exceções são `titular.ts` e `app_anonimizar_financeiro`, do
`worker`):

| Arquivo | Conteúdo |
|---|---|
| `constantes.ts` | `MSG_FINANCEIRO` (textos da §6.2), `FORMAS_DE_PAGAMENTO` e rótulos, `CATEGORIAS_INICIAIS`, limites (`VALOR_MAX_CENTAVOS = 100_000_000`, `DESCRICAO_MAX = 200`, `MOTIVO_MAX = 200`, `NOME_CATEGORIA_MAX = 60`) |
| `dinheiro.ts` | `paraCentavos("1.250,00") → 125000` (sem `parseFloat`), `formatarReais(125000) → "R$ 1.250,00"` (pt-BR; o `Intl` usa espaço não separável depois de "R$" — os testes comparam com ele) |
| `situacao.ts` | `situacaoDoLancamento(l, hoje)` e `dataDeReferencia(l)` — puras (RN-305, RN-306) |
| `configuracoes.ts` | `lerConfiguracoes`, `salvarConfiguracoes` (primeira gravação semeia as categorias, F-D25), categorias |
| `lancamentos.ts` | `criarLancamento`, `editarLancamento`, `marcarRecebido`, `desfazerRecebimento`, `cancelarLancamento`, `listarLancamentos`, `abrirLancamento` |
| `cobranca.ts` | `cobrarConsultaRealizada(tx, …)` e `aoCorrigirParaFaltou(tx, …)` — **um lugar só**, chamado pelos dois caminhos na transação deles (F-D13, F-D19). Devolvem o resultado `ResultadoCobranca` = `'criada' \| 'sem_valor' \| 'bloqueado' \| 'ja_existia'` (passagem a Realizada) e `'aberta' \| 'recebida' \| 'nenhuma'` (correção para Faltou), com o valor em centavos quando criada; `registrarCobrancaManual`; `cobrancaDaConsulta` |
| `resumo.ts` | `resumoDoMes`, `saldoAtual`, `fluxoDeCaixaDoAno`, `entradasESaidas12Meses`, `pagamentosPendentes`, `pendenciasDoPaciente` — agregação no SQL, uma transação por tela |
| `csv.ts` | Montagem do CSV (RN-321) — pura |
| `titular.ts` | `financeiroParaExportacao(tx, patientId, hoje)` (F-D22) |
| fora do módulo (T12) | `src/modules/ficha/secoes/financeiro.ts`: a seção "Financeiro" do registro do Plano 18, que só chama funções deste módulo (`resumoFinanceiroDoPaciente`, T12) |

---

## 5. Histórias de usuário

### E20 — Financeiro do consultório

#### US-300 — Configurar o Financeiro · **M** (PD-30, PD-31)

**Como** nutricionista, **quero** informar o saldo do caixa e o valor da consulta, **para** começar o controle e ter as
cobranças criadas sozinhas.

```gherkin
Cenário: Primeiro acesso
  Dado que nunca configurei o Financeiro
  Quando abro "Financeiro"
  Então vejo "Comece por aqui" e "Informe quanto há no caixa do consultório numa data e o valor da sua consulta. Depois disso, cada consulta marcada como Realizada gera a cobrança sozinha."
  E o botão "Configurar o Financeiro"
  E os botões "Nova entrada" e "Nova saída" não aparecem

Cenário: Salvar a primeira configuração
  Quando informo "Data do saldo" 01/11/2026, "Valor do saldo" R$ 1.500,00 e "Valor da consulta" R$ 250,00 e toco em "Salvar"
  Então vejo "Configurações salvas." (role="status")
  E as categorias iniciais existem (RN-302), com "Consultas" entre as de entrada
  E o Resumo mostra "Saldo atual" R$ 1.500,00 e "Desde o saldo de 01/11/2026"

Cenário: Sem valor da consulta
  Dado que salvei o saldo e deixei "Valor da consulta" vazio
  Então o Resumo mostra o aviso "O valor da consulta não está configurado: as consultas marcadas como Realizada não geram cobrança." com o link "Informar o valor da consulta"

Cenário: Saldo negativo
  Quando informo o saldo "-320,00"
  Então salva (conta no vermelho é saldo válido)

Cenário: Erros da configuração
  Quando informo "Valor do saldo" 20.000.000,00
  Então vejo "O saldo deve ser de −R$ 10.000.000,00 a R$ 10.000.000,00." junto do campo
  Quando informo "Data do saldo" amanhã (no fuso do consultório)
  Então vejo "A data do saldo não pode ser depois de hoje."
  Quando informo "Valor da consulta" "abc"
  Então vejo "Valor inválido. Use só números, como 250,00."
  E o que eu digitei nos outros campos continua lá

Cenário: Categoria em uso
  Dado que a categoria "Aluguel e condomínio" tem lançamentos
  Quando toco em "Excluir" nela
  Então vejo "Esta categoria tem lançamentos e não pode ser excluída. Arquive-a para que não apareça nos formulários."
  Quando toco em "Arquivar"
  Então ela some dos formulários de lançamento e continua nos lançamentos antigos e nos relatórios

Cenário: Categoria Consultas
  Quando tento arquivar "Consultas"
  Então vejo "A categoria Consultas é usada nas cobranças das consultas e não pode ser arquivada. Você pode mudar o nome dela."

Cenário: Mudança registrada
  Quando mudo o saldo do caixa ou o valor da consulta
  Então o audit_log ganha um "alterar" da entidade "financeiro_configuracoes", sem paciente (RN-320)
```

#### US-301 — Lançar entrada ou saída · **M** (PD-30)

**Como** nutricionista, **quero** registrar o que entra e o que sai, **para** saber quanto tenho e quanto vou receber.

```gherkin
Cenário: Nova saída paga
  Quando toco em "Nova saída" e informo R$ 1.200,00, "Aluguel e condomínio", vencimento 05/11/2026, marco "Já foi pago" com 05/11/2026 e "Pix"
  E toco em "Salvar saída"
  Então volto a "Lançamentos" no mês de referência do lançamento (novembro de 2026)
  E vejo "Lançamento salvo." na região de mensagens acima da lista, com o foco no h1
  E o "Saldo atual" diminui R$ 1.200,00

Cenário: Nova entrada prevista de um paciente
  Quando toco em "Nova entrada", escolho o paciente "Ana Souza", R$ 250,00, "Consultas", vencimento 20/11/2026, sem marcar "Já foi recebido"
  Então o lançamento aparece como "Previsto"
  E "Ana Souza" aparece em "Pagamentos pendentes"

Cenário: Saída não tem paciente (RN-304)
  Quando abro "Nova saída"
  Então o formulário não tem o campo "Paciente"

Cenário: Aviso de saúde na descrição
  Então o campo "Descrição (opcional)" da entrada mostra a ajuda "Até 200 caracteres. Não escreva informações de saúde aqui."
  E o da saída mostra "Até 200 caracteres. Não escreva informações de saúde nem nomes de pessoas."

Cenário: Erro não apaga o que foi digitado
  Quando marco "Já foi recebido" sem escolher a forma e toco em "Salvar entrada"
  Então vejo o erro junto do campo e o valor, a categoria e a descrição continuam preenchidos

Cenário: Pagamento no futuro
  Quando marco "Já foi recebido" com a data de amanhã (no fuso do consultório)
  Então vejo "A data do recebimento não pode ser depois de hoje."

Cenário: Forma de pagamento obrigatória no recebimento
  Quando marco "Já foi recebido" sem escolher a forma
  Então vejo "Escolha a forma de pagamento."

Cenário: Antes do saldo inicial
  Dado que o saldo do caixa é de 01/11/2026
  Quando salvo uma entrada recebida em 28/10/2026
  Então vejo, na mesma região e logo depois de "Lançamento salvo.", o aviso "Este lançamento é anterior ao saldo do caixa (01/11/2026) e não altera o saldo atual." (`?ok=salvo&aviso=antes_do_saldo`)

Cenário: Paciente arquivado
  Dado que "Carla Dias" está arquivada e tem uma pendência antiga do Dietbox
  Então ela aparece na lista de pacientes do formulário com "(arquivado)" e posso lançar a entrada (F-D28)

Cenário: Paciente bloqueado (F-D20)
  Dado que "Bruno Lima" está bloqueado por pedido de exclusão
  Então ele não aparece na lista de pacientes do formulário
  E a action recusa o id dele com "Paciente bloqueado por pedido de exclusão: não é possível criar lançamentos novos para ele."

Cenário: Sem configuração
  Dado que o Financeiro nunca foi configurado
  Quando abro "/painel/financeiro/lancamentos/novo?tipo=entrada"
  Então sou levada a "Configurações do Financeiro" com "Informe o saldo do caixa para começar."
```

#### US-302 — Editar, receber e cancelar lançamento · **M** (PD-30)

```gherkin
Cenário: Marcar como recebido
  Dado uma entrada "Em atraso" de R$ 250,00
  Quando toco em "Marcar como recebido", informo hoje e "Dinheiro" e confirmo
  Então vejo "Recebimento registrado."
  E a situação vira "Recebido"

Cenário: Desfazer recebimento
  Dado uma entrada "Recebido" lançada por engano
  Quando toco em "Desfazer recebimento"
  Então a data do recebimento fica vazia e a situação volta a "Previsto" ou "Em atraso" pelo vencimento

Cenário: Corrigir valor
  Quando mudo o valor de R$ 250,00 para R$ 200,00 e salvo
  Então vejo "Lançamento salvo."
  E o Histórico de acessos do paciente mostra "Alterou — Financeiro"

Cenário: Campos fixos
  Então a tela de edição mostra o tipo e o paciente como texto, sem campo
  E uma tentativa direta no banco de mudar tipo, paciente, consulta ou autor é recusada (42501)

Cenário: Cancelar
  Quando toco em "Cancelar lançamento" sem motivo
  Então vejo "Informe o motivo do cancelamento."
  Quando informo "Lançado em duplicidade" e confirmo
  Então vejo "Lançamento cancelado."
  E o lançamento continua na lista como "Cancelado", fora dos totais e do saldo
  E não há botão para reabrir nem para editar

Cenário: Sem apagar
  Então nenhuma tela tem "Excluir lançamento"
  E um DELETE direto pela role da aplicação é recusado (permissão revogada)

Cenário: Paciente bloqueado, cobrança antiga
  Dado que "Bruno Lima" foi bloqueado com uma cobrança de R$ 250,00 em aberto
  Quando abro a cobrança
  Então vejo "Paciente bloqueado por pedido de exclusão. As cobranças em aberto continuam valendo; não é possível criar cobranças novas."
  E posso marcar como recebido, desfazer o recebimento, reduzir o valor e cancelar
  E os campos categoria, vencimento e descrição aparecem como texto, sem campo
  Quando tento salvar R$ 300,00
  Então vejo "Paciente bloqueado por pedido de exclusão: só é possível registrar o recebimento, reduzir o valor ou cancelar."

Cenário: Lançamento anonimizado
  Dado um lançamento anonimizado enquanto eu editava
  Quando salvo
  Então vejo "Este lançamento foi anonimizado e não pode mais ser alterado."

Cenário: Mensagem depois de receber na lista
  Dado a lista "Lançamentos" filtrada por "Previsto"
  Quando marco uma entrada como recebida e ela sai da lista
  Então "Recebimento registrado." aparece na região de mensagens fixa acima da lista (`role="status"`, sempre montada)
  E o foco vai para o h1 da página
```

#### US-303 — Cobrança da consulta realizada · **M** (PD-31)

**Como** nutricionista, **quero** que a consulta realizada vire cobrança sozinha, **para** não esquecer de cobrar.

```gherkin
Cenário: Realizada pela tela da consulta
  Dado o valor da consulta R$ 250,00 e a consulta de "Ana Souza" de hoje às 14:00, já começada
  Quando toco em "Realizada"
  Então vejo "Presença registrada. Cobrança de R$ 250,00 criada no Financeiro."
  E a seção "Cobrança" mostra "R$ 250,00 · Previsto" (ou "Em atraso" a partir do dia seguinte)
  E a cobrança tem vencimento na data da consulta, categoria "Consultas" e a consulta ligada

Cenário: Receber na hora
  Quando toco em "Marcar como recebido", deixo a data de hoje, escolho "Pix" e confirmo
  Então vejo "Recebimento registrado."
  E a seção mostra "R$ 250,00 · Recebido em 16/11/2026 · Pix"
  E o Resumo soma R$ 250,00 em "Entradas do mês — Recebido"

Cenário: Ajustar o valor
  Quando mudo o valor da cobrança para R$ 180,00 e toco em "Salvar valor"
  Então vejo "Lançamento salvo."

Cenário: Realizada pelo atendimento (segundo caminho, F-D13)
  Dado a consulta "faltou" por engano de "Ana Souza"
  Quando abro "Iniciar atendimento" na consulta e toco em "Registrar atendimento"
  Então a consulta vira "Realizada" e a cobrança de R$ 250,00 é criada na mesma transação
  E a página do atendimento mostra "Atendimento registrado. Cobrança de R$ 250,00 criada no Financeiro." (`?ok=atendimento&cobranca=criada`)

Cenário: Atendimento sem valor da consulta
  Dado que o valor da consulta não está configurado
  Quando registro o atendimento ligado a uma consulta que não era "Realizada"
  Então a página do atendimento mostra "Atendimento registrado. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro." com o link para as configurações

Cenário: Já era realizada
  Dado a consulta já "Realizada" antes do Financeiro existir
  Quando registro o atendimento ligado a ela
  Então nenhuma cobrança é criada (RN-310: só a passagem para Realizada cria; sem retroativo)
  E a seção "Cobrança" da consulta mostra "Esta consulta não tem cobrança." e o botão "Registrar cobrança"

Cenário: Registrar cobrança à mão
  Quando toco em "Registrar cobrança" com o valor sugerido R$ 250,00
  Então a cobrança é criada como na passagem para Realizada

Cenário: Sem valor da consulta (F-D21)
  Dado que o valor da consulta não está configurado
  Quando toco em "Realizada"
  Então vejo "Presença registrada. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro." ("configurações do Financeiro" é link para `/painel/financeiro/configuracoes`)
  E a presença fica registrada

Cenário: Uma cobrança por consulta
  Dado que a consulta já tem cobrança ativa
  Quando duas abas registram "Registrar cobrança" ao mesmo tempo
  Então só uma cobrança existe e a outra aba vê "Esta consulta já tem uma cobrança."

Cenário: Correção para Faltou com cobrança em aberto (F-D19, como a F-D7 aprovada)
  Dado a consulta "Realizada" sem atendimento ligado e com cobrança em aberto
  Quando toco em "Faltou"
  Então vejo "Presença registrada. Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar."
  E a cobrança continua como estava (o sistema não a cancela sozinho)
  E a seção "Cobrança" continua na tela da consulta, com "Cancelar lançamento"

Cenário: Volta para Realizada
  Dado a consulta corrigida para "Faltou" com a cobrança ainda em aberto
  Quando toco em "Realizada" de novo
  Então nenhuma cobrança nova é criada e o valor ajustado continua (RN-310, c)

Cenário: Correção para Faltou com cobrança recebida
  Dado a consulta "Realizada" com a cobrança já recebida
  Quando toco em "Faltou"
  Então a presença vira "Faltou" e a cobrança continua "Recebido"
  E vejo "Presença registrada. Esta consulta tem um pagamento recebido. Se for devolver o valor, cancele o lançamento no Financeiro."

Cenário: Faltou não cobra
  Quando marco "Faltou" numa consulta sem cobrança
  Então nenhuma cobrança é criada

Cenário: Paciente bloqueado ou anonimizado (F-D20)
  Dado que o paciente da consulta está bloqueado
  Quando toco em "Realizada"
  Então vejo "Presença registrada." e nenhuma cobrança é criada
  E a seção "Cobrança" mostra "Paciente bloqueado por pedido de exclusão: não é possível registrar cobrança nova."

Cenário: Já era realizada pela tela da consulta
  Dado a consulta já "Realizada"
  Quando toco em "Realizada" de novo
  Então vejo "Presença registrada." e nada muda no Financeiro (a função sai antes, como hoje)
```

#### US-304 — Pagamentos pendentes · **M** (PD-31)

```gherkin
Cenário: Lista por paciente
  Dado "Ana Souza" com duas cobranças em aberto (R$ 250,00 de 10/10/2026 e R$ 250,00 de 10/11/2026)
  Quando abro "Pagamentos pendentes"
  Então vejo "Cobranças de pacientes ainda não recebidas. Esta lista é só sua: nada é enviado ao paciente."
  E a linha "Ana Souza · R$ 500,00 · 2 cobranças · desde 10/10/2026 · Em atraso"
  E a lista está em ordem da cobrança mais antiga
  E abrir a lista não grava "Visualizou" (RN-318)

Cenário: Detalhe do paciente
  Quando toco em "Ver" na linha de "Ana Souza"
  Então vejo "Pagamentos pendentes de Ana Souza" com as duas cobranças e "Marcar como recebido" em cada uma
  E o Histórico de acessos de Ana Souza registra "Visualizou — Financeiro"

Cenário: Receber no detalhe
  Quando marco a cobrança de 10/10/2026 como recebida
  Então ela sai da lista, "Recebimento registrado." aparece na região de mensagens fixa acima da lista e o foco vai ao h1
  Quando marco a última como recebida
  Então vejo "Nenhum pagamento pendente de Ana Souza." e o link "Voltar aos pagamentos pendentes"

Cenário: Nada pendente
  Então vejo "Nenhum pagamento pendente."

Cenário: Cobrança futura
  Dado uma entrada de "Ana Souza" com vencimento daqui a 10 dias, não recebida
  Então ela conta em "Pagamentos pendentes" como "Previsto" (RN-311)
```

#### US-305 — Resumo do mês · **M** (PD-32)

```gherkin
Cenário: Cartões
  Dado saldo de R$ 1.500,00 em 01/11/2026, R$ 750,00 recebidos e R$ 1.200,00 pagos em novembro, R$ 500,00 a receber com vencimento em novembro e R$ 90,00 a pagar
  Quando abro "Financeiro" em 16/11/2026
  Então vejo "Saldo atual" R$ 1.050,00 com "Desde o saldo de 01/11/2026"
  E "Entradas de novembro" com "Recebido R$ 750,00" e "A receber R$ 500,00"
  E "Saídas de novembro" com "Pago R$ 1.200,00" e "A pagar R$ 90,00"

Cenário: Atrasado de meses anteriores
  Dado também uma saída de R$ 300,00 vencida em 10/10/2026 e ainda não paga, e uma entrada sem paciente de R$ 100,00 vencida em 20/10/2026 e não recebida
  Quando abro "Financeiro" em 16/11/2026
  Então "Saídas de novembro" mostra também "Em atraso de meses anteriores R$ 300,00"
  E "Entradas de novembro" mostra também "Em atraso de meses anteriores R$ 100,00"
  E a linha some quando não há atraso de meses anteriores
  E "Pagamentos pendentes" com "1 paciente · R$ 500,00" e o link "Ver"
  E "Últimos lançamentos" com os 10 mais recentes e o link "Ver todos os lançamentos"
  E abrir o Resumo não grava "Visualizou"

Cenário: Virada do mês no fuso (RN-306)
  Dado uma entrada recebida em 01/12/2026 (data)
  Quando o servidor (UTC) já está em 01/12 e o consultório (America/Sao_Paulo) ainda em 30/11 às 22:30
  Então o Resumo de novembro não a conta como recebida em novembro, e o "hoje" do formulário é 30/11/2026
```

#### US-306 — Relatórios e CSV · **M** (PD-32)

```gherkin
Cenário: Fluxo de caixa do ano
  Quando abro "Relatórios" com o ano 2026
  Então vejo a tabela "Fluxo de caixa de 2026" com as colunas jan a dez e "Total"
  E as linhas "Saldo no início do mês", uma por categoria de entrada, "Total de entradas", uma por categoria de saída, "Total de saídas", "Resultado do mês" e "Saldo no fim do mês"
  E os meses antes do saldo do caixa mostram "—" nas linhas de saldo, com a nota "O saldo começa em 01/11/2026. Antes dessa data, só as entradas e as saídas aparecem."
  E no mês do saldo (novembro) "Saldo no início do mês" mostra "—" e "Saldo no fim do mês" = saldo do caixa + entradas − saídas pagas **a partir de 01/11/2026**; nos meses seguintes, início = fim do mês anterior e fim = início + resultado
  E só entram lançamentos recebidos ou pagos (o previsto não entra no fluxo)
  E a tabela fica num contêiner com rolagem horizontal própria, focável pelo teclado (`role="region"`, `aria-labelledby` no caption, `tabIndex={0}`)

Cenário: Entradas e saídas em 12 meses
  Então vejo as barras de entradas e saídas dos últimos 12 meses e a tabela "Mês · Entradas · Saídas · Resultado"
  E as barras têm aria-hidden="true" e a tabela é a alternativa em texto

Cenário: CSV dos lançamentos
  Quando escolho de 01/11/2026 a 30/11/2026, deixo "Incluir o nome dos pacientes" desmarcado e toco em "Baixar CSV"
  Então recebo "lancamentos-2026-11-01-a-2026-11-30.csv" sem a coluna "Paciente"
  E a "Descrição" sai vazia nas entradas que têm paciente (só as sem paciente e as saídas levam a descrição)
  E o audit_log ganha um "exportar" da entidade "financeiro" sem paciente

Cenário: CSV com nomes
  Quando marco "Incluir o nome dos pacientes"
  Então o arquivo tem a coluna "Paciente" e a descrição de todas as linhas
  E o Histórico de acessos de cada paciente presente no arquivo mostra "Exportou — Financeiro"

Cenário: Injeção de fórmula
  Dado uma descrição "=HIPERLINK(…)"
  Então a célula sai como "'=HIPERLINK(…)"

Cenário: Período longo
  Quando peço mais de 366 dias
  Então vejo "Escolha um período de até 12 meses." em role="alert" junto do campo "Até", sem sair de "Relatórios"
  E nenhum download começa

Cenário: Sessão expirada no download
  Dado que a sessão expirou
  Quando toco em "Baixar CSV"
  Então sou levada ao login (não a uma página com JSON)
```

#### US-307 — Financeiro na cópia dos dados e na exclusão · **M** (LGPD)

```gherkin
Cenário: Baixar meus dados
  Dado que "Ana Souza" tem duas cobranças (uma recebida, uma cancelada)
  Quando ela pede "Baixar meus dados" no portal
  Então o dados.json tem a seção "financeiro" com vencimento, pagamento, valor, forma de pagamento, situação, categoria, descrição, motivo do cancelamento, data do cancelamento e o início da consulta ligada
  E não tem quem lançou nem quem cancelou (dado da equipe) (F-D22)
  E a exportação da equipe tem a mesma seção
  E a seção fica só no dados.json (o prontuario.pdf não muda)

Cenário: Pedido de exclusão (nutricionista)
  Quando atendo o pedido de exclusão de "Bruno Lima"
  Então as cobranças dele continuam como estavam (a pendência continua devida)
  E a aba Privacidade dizia antes, no texto da exclusão: "Os registros de pagamento do Financeiro ficam guardados pelo mesmo prazo do prontuário, e as cobranças em aberto continuam valendo."

Cenário: Pedido de exclusão (paciente)
  Quando "Bruno Lima" toca em "Pedir a exclusão" no portal
  Então a confirmação diz "Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico e os registros de pagamento das consultas são guardados pelo prazo legal."
  E o e-mail "Seu pedido foi registrado" diz que os registros de pagamento das consultas ficam guardados pelo mesmo prazo e que os pagamentos em aberto continuam devidos
  E o e-mail "Seu pedido de exclusão de dados foi atendido" diz o mesmo (textos na §6.2)

Cenário: Anonimização (F-D23)
  Quando o prazo de guarda vence e o job anonimiza "Bruno Lima"
  Então os lançamentos dele perdem a descrição e o motivo do cancelamento
  E a cobrança ainda em aberto vira "Cancelado", sem motivo
  E valor, datas, categoria e forma de pagamento ficam (os relatórios antigos não mudam)
  E nenhum lançamento dele pode mais ser alterado
```

#### US-308 — Seção "Financeiro" no Início da ficha · **S** (PD-33, última tarefa)

A ficha do Plano 18 não comporta uma 14ª aba a 1280 px (R-266 de lá). A seção entra pelo registro de seções do
Início (Plano 18, D14, RN-277, §11), sem mexer em `abas.tsx` nem em `layout.tsx` (F-D18 acertada).

```gherkin
Cenário: Seção no Início (Plano 18)
  Quando abro a ficha de "Ana Souza" (aba Início)
  Então vejo a seção "Financeiro (3)" com os 3 lançamentos mais recentes no formato do `ItemDaSecao` do Plano 18 (rótulo "Entrada — {categoria}", data de referência e situação; sem valor e sem descrição)
  E, se o registro do Plano 18 como mergeado aceitar um resumo além dos itens, "Em aberto: R$ 500,00"; senão o total fica na lista filtrada
  E o link "Ver todos", que abre "Lançamentos" filtrada por "Ana Souza" em todos os meses
  E "Nova entrada", que abre o formulário com "Ana Souza" escolhida
  E o Histórico de acessos registra "Visualizou — Financeiro" uma vez por abertura do Início, só quando a seção devolve lançamento

Cenário: Sem lançamento
  Então a seção mostra "Financeiro (0)" e nenhum "Visualizou — Financeiro" é gravado

Cenário: Paciente bloqueado
  Então a seção mostra os lançamentos e o total em aberto, sem "Nova entrada"
```

#### US-309 — DPA 1.1 · **S** (F-D17)

```gherkin
Cenário: Novo aceite
  Dado que aceitei o DPA 1.0
  Quando o Plano 20 vai ao ar e abro o painel
  Então sou levada a "/painel/dpa" com "O contrato de tratamento de dados mudou (versão 1.1, de {data}). Leia e aceite para continuar usando o painel."
  E vejo "O que mudou: o contrato passa a citar os registros financeiros do consultório, inclusive os pagamentos dos pacientes (Financeiro)."
  E a cláusula 2 cita "registros financeiros do consultório, inclusive os pagamentos dos pacientes"
  Quando marco "Li e aceito o contrato de tratamento de dados (DPA), versão 1.1" e confirmo
  Então volto ao painel e o aceite fica em consents ("dpa-1.1")
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-300 | **Acesso.** Só a sessão `nutri` (`requireNutri`/`requireApiNutri`, DPA em vigor) lê e grava o Financeiro. As três tabelas são `staff_only`; nada em `PUBLICO_LIBERADO` nem em `PACIENTE_ESCREVE`; o admin nunca consulta (F-D1). As funções do módulo conferem `ctx.role === 'nutri'` (§4.2) |
| RN-301 | **Configuração primeiro.** Sem a linha de `fin_configuracoes` do consultório, as telas mostram o primeiro acesso (US-300) e as ações de lançamento levam às Configurações. A cobrança automática (RN-310) não depende disso: sem configuração, não há valor, e a regra da F-D21 vale |
| RN-302 | **Categorias iniciais**, gravadas na mesma transação da **primeira** gravação de `fin_configuracoes` (`INSERT … ON CONFLICT DO NOTHING RETURNING`: só quem inseriu semeia; F-D25). Entradas: "Consultas" (chave `consultas`) e "Outras entradas". Saídas: "Aluguel e condomínio", "Contas de consumo (água, luz, internet, telefone)", "Material e insumos", "Equipamentos", "Software e assinaturas", "Divulgação", "Impostos e taxas", "Conselho e associações", "Cursos e eventos", "Outras saídas". As categorias também entram com `ON CONFLICT DO NOTHING` (defesa). Nenhuma leitura grava. A linha de `fin_configuracoes` não se apaga (DELETE e TRUNCATE revogados) |
| RN-303 | **Categorias.** Nome de 1 a 60 caracteres, único por consultório e tipo (sem diferença de maiúsculas); tipo fixo depois de criada. Categoria com lançamento não se exclui (FK `NO ACTION`): arquiva-se (some dos formulários, fica nos lançamentos e relatórios). "Consultas" pode ser renomeada, nunca arquivada nem excluída — o banco recusa as duas coisas (CHECK e gatilho `fin_categorias_fixas` também em `BEFORE DELETE`), então a categoria existe sempre que há configuração. Arquivada pode voltar ("Reativar") |
| RN-304 | **Lançamento.** Tipo `entrada` ou `saida`; categoria do **mesmo tipo** (FK composta com o tipo); valor de R$ 0,01 a R$ 1.000.000,00 em centavos inteiros; vencimento obrigatório; data de recebimento/pagamento opcional (vazia = ainda não aconteceu), **nunca depois de hoje** no fuso do consultório; forma de pagamento obrigatória quando há data de recebimento/pagamento; descrição opcional de 1 a 200 caracteres. **Paciente só em entrada** e opcional; **consulta só com paciente** (F-D24). Datas entre 01/01/2000 e 31/12 de hoje + 5 anos (vencimento) |
| RN-305 | **Situação** (calculada, sem coluna; F-D4): `cancelado_em` preenchido → **Cancelado**; senão, data de pagamento preenchida → **Recebido** (entrada) / **Pago** (saída); senão, vencimento **antes de hoje** → **Em atraso**; senão (vencimento hoje ou depois) → **Previsto**. "Hoje" é sempre `hojeNoFuso(tenant.fuso)` |
| RN-306 | **Data de referência e mês.** Lançamento recebido/pago conta pelo **mês da data de pagamento**; lançamento em aberto, pelo **mês do vencimento**. O filtro "Mês" da lista e os cartões do Resumo usam essa data. Cancelado entra na lista (filtro "Cancelado"), nunca nos totais. O filtro "Mês" é um `<select>` com os meses (mais recentes primeiro, desde o mês do lançamento mais antigo) e os links "Mês anterior"/"Próximo mês" — não `<input type="month">`, que o Firefox desktop não tem. Sem `mes`, a lista mostra o mês atual no fuso. Com `paciente` (links "Ver todos" e "Ver todos os lançamentos de {nome}") e sem `mes`, mostra **todos os meses**, mais recentes primeiro, até 200 linhas, com o aviso "Mostrando os 200 mais recentes. Escolha um mês para ver os outros." quando passar; nesse caso o `<select>` ganha a opção "Todos os meses" |
| RN-307 | **Saldo atual** = saldo do caixa + Σ entradas recebidas − Σ saídas pagas, **não canceladas**, com data de pagamento **no dia do saldo ou depois** ("Saldo do caixa em dd/mm/aaaa" é o saldo no início desse dia). Lançamento pago antes dessa data aparece na lista e nos relatórios, mas não muda o saldo (aviso da US-301). **Resumo:** "A receber"/"A pagar" = em aberto com vencimento no mês; "Em atraso de meses anteriores" = em aberto com vencimento antes do dia 1º do mês, somado à parte em cada cartão (US-305) |
| RN-308 | **Editar.** Enquanto não está cancelado nem anonimizado: valor, categoria (do mesmo tipo), vencimento, data de pagamento (inclusive apagar: "Desfazer recebimento"), forma e descrição. **Fixos** (gatilho, 42501): `id`, `tenant_id`, `tipo`, `patient_id`, `appointment_id`, `criado_por`, `created_at` (F-D5). Paciente **bloqueado**: só data de pagamento e forma (receber/desfazer), valor **menor ou igual** ao atual e cancelamento (RN-315) |
| RN-309 | **Cancelar.** Pede motivo (1 a 200 caracteres); não tem volta; não existe DELETE (revogado). Pode cancelar lançamento recebido/pago (é assim que se registra uma devolução: o valor sai do saldo). O cancelamento grava `cancelado_em`, `cancelado_por` e o motivo |
| RN-310 | **Cobrança automática** (F-D13). Na transação que leva a consulta de outra situação para `realizada` — `registrarPresenca` e `registrarAtendimento` —, depois das travas deles (paciente → consulta), `cobrarConsultaRealizada` cria a entrada: categoria `consultas`, valor = valor da consulta, vencimento = data do início da consulta no fuso, paciente e consulta ligados, sem forma, sem descrição. **Não cria** quando: (a) não há valor da consulta configurado (F-D21); (b) o paciente está bloqueado ou anonimizado (F-D20); (c) a consulta já tem cobrança ativa (índice único; `ON CONFLICT DO NOTHING`). Consulta que já estava `realizada` não gera nada (sem retroativo). `registrarPresenca` passa a devolver `{ cobranca: ResultadoCobranca \| null }` (nulo quando a situação não mudou e a função saiu antes) e `registrarAtendimento` passa a devolver `{ id, cobranca: ResultadoCobranca \| null }`; as actions levam o resultado na URL (`?ok=presenca&cobranca=…` na consulta; `?ok=atendimento&cobranca=…` na página do atendimento) e a página mostra a mensagem da §6.2 no `Aviso` de sempre |
| RN-311 | **Pagamentos pendentes** = entradas **com paciente**, não canceladas e sem data de recebimento, **previstas ou em atraso** (F-D26). A lista agrupa por paciente: total em aberto, quantidade, vencimento mais antigo e o selo "Em atraso" se alguma estiver em atraso; ordem pelo vencimento mais antigo. Sem envio ao paciente |
| RN-312 | **Correção para Faltou** (F-D19, que segue a recomendação aprovada da F-D7: avisa, não cancela sozinho). Em `registrarPresenca(…, 'faltou')` de uma consulta `realizada` (só sem atendimento ligado, regra atual), `aoCorrigirParaFaltou` só **lê** a cobrança ativa, na mesma transação, e devolve `'aberta'`, `'recebida'` ou `'nenhuma'`; nada é gravado no Financeiro. A tela avisa (US-303). A cobrança em aberto continua em "Pagamentos pendentes" até a nutricionista cancelar ou receber. Voltar para "Realizada" com cobrança ativa não cria outra (RN-310, c) |
| RN-313 | **Falta** não gera cobrança automática (F-D7). A nutricionista pode lançar uma entrada à mão para o paciente |
| RN-314 | **Registrar cobrança à mão** na tela da consulta: só consulta `realizada`, sem cobrança ativa, paciente nem bloqueado nem anonimizado e Financeiro configurado; valor sugerido = valor da consulta (editável, obrigatório) |
| RN-315 | **Paciente bloqueado** (pedido de exclusão atendido): nenhum lançamento **novo** com ele (módulo e gatilho); os existentes continuam valendo — marcar recebido, desfazer o recebimento, **reduzir** o valor e cancelar, com a trava própria do Financeiro (paciente `FOR KEY SHARE` → lançamento `FOR UPDATE`), **nunca** `carregarPacienteParaEscrita`, que recusa bloqueado (F-D20). Aumentar o valor, mudar categoria, vencimento ou descrição de lançamento de paciente bloqueado é recusado pelo módulo e pelo gatilho (é tratamento novo depois do bloqueio, LGPD art. 5º, XIII; pergunta na F-P1). **Anonimizado:** nada muda (RN-316) |
| RN-316 | **Anonimização** (F-D23). No `anonimizarVencidos`, antes do UPDATE de `patients`, `select app_anonimizar_financeiro(<paciente>)`: em todos os lançamentos do paciente, `descricao` e `motivo_cancelamento` → nulo e `anonimizado_em` → agora; os em aberto → cancelados (`cancelado_em` = agora, `cancelado_por` nulo, sem motivo). Valor, datas, categoria, forma, tipo e o vínculo com o paciente (agora anonimizado) ficam. Lançamento anonimizado não muda mais |
| RN-317 | **Ordem de travas:** paciente → consulta → lançamento (a mesma da agenda e do atendimento). Ações do Financeiro sem consulta: paciente (se houver) → lançamento. **Criação** (`criarLancamento`, `registrarCobrancaManual`): paciente `FOR KEY SHARE` e conferência de `status`/`anonimizado_em` **sob a trava**, antes do INSERT (sem isso, um bloqueio que confirma no meio deixaria passar um lançamento novo: a FK só espera o bloqueio terminar e não confere a situação de novo). Na cobrança automática, o paciente já está travado pelo caminho (`registrarPresenca`: `FOR KEY SHARE`; `registrarAtendimento`: `FOR UPDATE`). O gatilho também lê o paciente com `FOR KEY SHARE` (§9.4). Configurações: linha de `fin_configuracoes` `FOR UPDATE` |
| RN-318 | **Leitura auditada** (F-D8). `auditRead(tx, { entidade: 'financeiro', entidadeId, patientId })` quando a tela devolve o financeiro de **um paciente identificado**: o detalhe "Pagamentos pendentes de {nome}", a lista de lançamentos filtrada por paciente, a tela de edição de um lançamento com paciente, a seção "Cobrança" da tela da consulta quando há cobrança, e a seção "Financeiro" do Início da ficha quando devolve lançamento (US-308). **Sem** `auditRead`: Resumo, lista sem filtro de paciente, lista de pagamentos pendentes (nome, total, data), relatórios — como a agenda (Plano 05, D10) |
| RN-319 | **Escritas auditadas** pelo gatilho `audit_row_change` de `fin_lancamentos` (entidade `financeiro`, rótulo "Financeiro" no Histórico de acessos): "Criou", "Alterou" (inclusive o cancelamento e a anonimização, esta com ator nulo). O `audit_log` não guarda antes/depois (só quem, quando, o quê) |
| RN-320 | **Configurações** (saldo do caixa, valor da consulta): cada gravação grava também `recordAudit({ acao: 'alterar', entidade: 'financeiro_configuracoes', entidadeId: tenantId, patientId: null })` — fora do Histórico do paciente, disponível para o registro das operações (DPA, cláusula 12). Categorias sem trilha |
| RN-321 | **CSV** (F-D27). Separador `;`, UTF-8 com BOM, fim de linha CRLF, datas `dd/mm/aaaa`, valores com vírgula decimal e sem "R$". Lançamentos: "Vencimento;Pagamento;Tipo;Categoria;Descrição;[Paciente;]Forma de pagamento;Valor;Situação", com o período por data de referência (RN-306), até 366 dias, cancelados incluídos com a situação. **Sem** "Incluir o nome dos pacientes", a "Descrição" sai **vazia** nas entradas com paciente (a descrição livre pode identificar: "Ana — retorno"); com a opção, sai em todas as linhas. Fluxo de caixa: as linhas da US-306 × meses. **Célula de texto** (descrição, categoria, paciente) que comece com `=`, `+`, `-`, `@`, tabulação ou CR ganha `'` na frente; números gerados pelo sistema não. Resposta `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`, só `requireApiNutri`. `recordAudit` `exportar` (entidade `financeiro`): uma linha por paciente presente quando "Incluir o nome dos pacientes" está marcado; uma linha sem paciente quando não está, e no CSV do fluxo |
| RN-322 | **Valores e textos fora de log** (regra 3; F-D9): valor, descrição, motivo, nome de paciente e categoria nunca vão para log, Sentry ou mensagem de erro; erro loga só o código e o motivo técnico |
| RN-323 | **Fora da IA.** Nenhum contexto de IA (leitura de exame, resumo do histórico, rascunho do plano, IA Nutri) lê as tabelas do Financeiro (guarda de importação **e de texto**: nenhum arquivo de `src/modules/ia/**` importa `@/modules/financeiro` ou `@/db/schema/financeiro` nem contém o texto `fin_`, RNF-303) |
| RN-324 | **Valor da consulta** de R$ 0,01 a R$ 1.000.000,00, opcional; mudar o valor só vale para as cobranças criadas depois |
| RN-325 | **Saldo do caixa** de −R$ 10.000.000,00 a R$ 10.000.000,00, com data (até hoje); obrigatório na primeira configuração |
| RN-326 | **Formatos** (MVP RNF-12): "R$ 1.250,00" na tela (vírgula decimal, ponto de milhar); entrada aceita "1250", "1250,5", "1.250,50" e "R$ 1.250,50"; datas `dd/mm/aaaa`; valores de saída com "−" nos totais de resultado |
| RN-327 | **Menu.** "Financeiro" entre "Conteúdos" e "Configurações", para toda nutricionista, sem interruptor e sem contador (F-D1) |
| RN-328 | **Textos** em pt-BR, na constante `MSG_FINANCEIRO` (§6.2); entram na tabela "Textos de interface" das histórias no fechamento |
| RN-329 | **Seção da ficha** (US-308), pendurada no registro do Início do Plano 18 (um arquivo em `src/modules/ficha/secoes/` e uma linha no fim de `SECOES_DA_FICHA`): contador de lançamentos do paciente (todas as situações) e os 3 mais recentes no formato `ItemDaSecao`; "Ver todos" para a lista filtrada por paciente em todos os meses (RN-306); "Nova entrada" (no `adicionar`, grupo "Outros", destino `hrefDoPaciente`) só sem bloqueio; sem o Financeiro configurado ela continua visível e leva às Configurações com "Informe o saldo do caixa para começar." (RN-301) — **decisão da orquestradora 17/11**; o `auditRead` (entidade `financeiro`) é gravado de forma central por `inicio.ts` quando a seção devolve lançamento (`leitura: { entidade: "financeiro" }`, opção (a) do contrato do Plano 18), nunca pelo arquivo da seção |

### 6.2 Textos de interface (`MSG_FINANCEIRO`)

| Chave | Texto |
|---|---|
| `menu` | "Financeiro" |
| `secoes` | "Resumo" · "Lançamentos" · "Pagamentos pendentes" · "Relatórios" · "Configurações" |
| `comecePorAqui` | "Comece por aqui" |
| `comeceTexto` | "Informe quanto há no caixa do consultório numa data e o valor da sua consulta. Depois disso, cada consulta marcada como Realizada gera a cobrança sozinha." |
| `configurar` | "Configurar o Financeiro" |
| `semValorConsulta` | "O valor da consulta não está configurado: as consultas marcadas como Realizada não geram cobrança." |
| `informarValor` | "Informar o valor da consulta" |
| `informeSaldo` | "Informe o saldo do caixa para começar." |
| `cartaoSaldo` | "Saldo atual" · "Desde o saldo de {dd/mm/aaaa}" |
| `cartaoEntradas` | "Entradas de {mês}" · "Recebido {valor}" · "A receber {valor}" · "Em atraso de meses anteriores {valor}" (só quando > 0) |
| `cartaoSaidas` | "Saídas de {mês}" · "Pago {valor}" · "A pagar {valor}" · "Em atraso de meses anteriores {valor}" (só quando > 0) |
| `cartaoPendentes` | "Pagamentos pendentes" · "{n} paciente(s) · {valor}" · "Ver" · vazio: "Nenhum" |
| `ultimos` | "Últimos lançamentos" · "Ver todos os lançamentos" · vazio: "Nenhum lançamento ainda." |
| `novaEntrada` / `novaSaida` | "Nova entrada" / "Nova saída" |
| Campos | "Valor" · "Categoria" · "Vencimento" · "Paciente (opcional)" (ativos e arquivados, não bloqueados; o arquivado com "(arquivado)") · "Descrição (opcional)" · "Já foi recebido" / "Já foi pago" · "Data do recebimento" / "Data do pagamento" · "Forma de pagamento" |
| `ajudaDescricao` | entrada: "Até 200 caracteres. Não escreva informações de saúde aqui." · saída: "Até 200 caracteres. Não escreva informações de saúde nem nomes de pessoas." |
| `salvarEntrada` / `salvarSaida` | "Salvar entrada" / "Salvar saída" |
| Formas | "Pix" · "Dinheiro" · "Cartão de crédito" · "Cartão de débito" · "Transferência bancária" · "Boleto" · "Outra" |
| Situações | "Previsto" · "Em atraso" · "Recebido" · "Pago" · "Cancelado" |
| Filtros | "Mês" (`<select>`; "Todos os meses" só com paciente) · "Mês anterior" · "Próximo mês" · "Mostrando os 200 mais recentes. Escolha um mês para ver os outros." · "Tipo" ("Todos", "Entradas", "Saídas") · "Categoria" ("Todas") · "Situação" ("Todas", "Previsto", "Em atraso", "Recebido ou pago", "Cancelado") · "Forma de pagamento" ("Todas") · chip "Paciente: {nome}" com "Limpar" · "Filtrar" |
| `totaisDaLista` | duas linhas, sem os cancelados: "Recebido ou pago: entradas {valor} · saídas {valor} · resultado {valor}" e "Em aberto: entradas {valor} · saídas {valor}" (os mesmos critérios do Resumo, para os números baterem) |
| `vazioDaLista` | "Nenhum lançamento neste filtro." |
| Ações | "Editar" · "Marcar como recebido" / "Marcar como pago" · "Desfazer recebimento" / "Desfazer pagamento" · "Cancelar lançamento" · "Motivo do cancelamento" · "Confirmar cancelamento" |
| `avisoCancelar` | "O lançamento cancelado não volta. Ele continua na lista, como Cancelado, e sai dos totais e do saldo." |
| Sucesso (`role="status"`, região sempre montada acima da lista ou do formulário, fora das linhas; canal `?ok=` e `?aviso=` na URL, como `agenda/actions.ts`) | "Lançamento salvo." · "Recebimento registrado." · "Pagamento registrado." · "Lançamento cancelado." · "Configurações salvas." |
| `pendentesDoPacienteVazio` | "Nenhum pagamento pendente de {nome}." · link "Voltar aos pagamentos pendentes" |
| `antesDoSaldo` | "Este lançamento é anterior ao saldo do caixa ({dd/mm/aaaa}) e não altera o saldo atual." |
| Erros (`role="alert"`, junto do campo) | "Informe o valor." · "O valor deve ser de R$ 0,01 a R$ 1.000.000,00." · "Escolha a categoria." · "Informe o vencimento." · "Data inválida." · "A data do recebimento não pode ser depois de hoje." · "A data do pagamento não pode ser depois de hoje." · "Escolha a forma de pagamento." · "A descrição tem no máximo 200 caracteres." · "Informe o motivo do cancelamento." · "O motivo tem no máximo 200 caracteres." · "Este lançamento foi cancelado e não pode mais ser alterado." · "Este lançamento foi anonimizado e não pode mais ser alterado." · "Paciente bloqueado por pedido de exclusão: não é possível criar lançamentos novos para ele." · "Paciente bloqueado por pedido de exclusão: só é possível registrar o recebimento, reduzir o valor ou cancelar." · "Esta consulta já tem uma cobrança." · "Escolha um período de até 12 meses." · "Valor inválido. Use só números, como 250,00." |
| Configurações: erros | "O saldo deve ser de −R$ 10.000.000,00 a R$ 10.000.000,00." · "A data do saldo não pode ser depois de hoje." · "Informe a data do saldo." · "Informe o valor do saldo." · valor da consulta fora do intervalo: "O valor deve ser de R$ 0,01 a R$ 1.000.000,00." · valor não numérico: "Valor inválido. Use só números, como 250,00." |
| Consulta: seção | h2 "Cobrança" · "{valor} · {situação}" · "Recebido em {dd/mm/aaaa} · {forma}" · "Salvar valor" · "Abrir no Financeiro" · "Esta consulta não tem cobrança." · "Registrar cobrança" · "Configure o Financeiro para registrar cobranças." ("Configure o Financeiro" é link para `/painel/financeiro/configuracoes`) · "Paciente bloqueado por pedido de exclusão: não é possível registrar cobrança nova." |
| Consulta: depois de "Realizada"/"Faltou" | "Presença registrada. Cobrança de {valor} criada no Financeiro." · "Presença registrada. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro." ("configurações do Financeiro" é link) · "Presença registrada. Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar." · "Presença registrada. Esta consulta tem um pagamento recebido. Se for devolver o valor, cancele o lançamento no Financeiro." |
| Atendimento: depois de "Registrar atendimento" ligado a consulta | "Atendimento registrado. Cobrança de {valor} criada no Financeiro." · "Atendimento registrado. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro." (link) · bloqueado ou já existia: sem mensagem do Financeiro |
| Edição: consulta ligada | "Cobrança da consulta de {dd/mm/aaaa}, {hh:mm}" (link para a consulta) |
| `pendentesIntro` | "Cobranças de pacientes ainda não recebidas. Esta lista é só sua: nada é enviado ao paciente." |
| Pendentes: linha | "{nome} · {valor} · {n} cobrança(s) · desde {dd/mm/aaaa}" + selo "Em atraso" · "Ver" · vazio: "Nenhum pagamento pendente." |
| `pendentesDoPaciente` | "Pagamentos pendentes de {nome}" · "Ver todos os lançamentos de {nome}" |
| `bloqueado` | "Paciente bloqueado por pedido de exclusão. As cobranças em aberto continuam valendo; não é possível criar cobranças novas." |
| Relatórios | "Ano" · "Fluxo de caixa de {ano}" · linhas "Saldo no início do mês", "Total de entradas", "Total de saídas", "Resultado do mês", "Saldo no fim do mês" · "Total" · nota "O saldo começa em {dd/mm/aaaa}. Antes dessa data, só as entradas e as saídas aparecem." · "Só entram os lançamentos recebidos ou pagos." · "Entradas e saídas nos últimos 12 meses" · colunas "Mês", "Entradas", "Saídas", "Resultado" |
| CSV | "Baixar CSV" · "De" · "Até" · "Incluir o nome dos pacientes" · ajuda: "Sem esta opção, o arquivo não tem a coluna Paciente, e a descrição das entradas de pacientes sai vazia. Com ela, o download fica registrado no Histórico de acessos de cada paciente. Quem receber o arquivo deve guardar sigilo." |
| Configurações | h2 "Saldo do caixa" · "Data do saldo" · "Valor do saldo" · ajuda: "O saldo atual soma a este valor tudo o que foi recebido e pago a partir desta data." · h2 "Valor da consulta" · ajuda: "Sugerido em toda cobrança criada ao marcar a consulta como Realizada. Você pode mudar o valor em cada cobrança." · h2 "Categorias" · "Entradas" · "Saídas" · "Nova categoria" · "Renomear" · "Arquivar" · "Reativar" · "Excluir" · "Arquivada" · "Salvar" |
| Categorias: erros | "Já existe uma categoria com este nome." · "O nome tem de 1 a 60 caracteres." · "Esta categoria tem lançamentos e não pode ser excluída. Arquive-a para que não apareça nos formulários." · "A categoria Consultas é usada nas cobranças das consultas e não pode ser arquivada. Você pode mudar o nome dela." |
| Privacidade (exclusão, painel) | acréscimo ao texto atual: "Os registros de pagamento do Financeiro ficam guardados pelo mesmo prazo do prontuário, e as cobranças em aberto continuam valendo." |
| Portal: `CONFIRMAR_EXCLUSAO` (`src/app/p/(portal)/perfil/privacidade.tsx`) | "Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico e os registros de pagamento das consultas são guardados pelo prazo legal." |
| E-mail `pedido_exclusao_registrado` (`src/email/templates.tsx`) | a segunda linha passa a: "Por obrigação legal, o prontuário clínico é guardado de forma bloqueada pelo prazo exigido, e os registros de pagamento das consultas ficam guardados pelo mesmo prazo (os pagamentos em aberto continuam devidos); o resto é apagado quando o pedido for atendido. Você recebe outro e-mail nesse momento." |
| E-mail `exclusao_atendida` | linha nova, depois da do prontuário: "Se você tem registros de pagamento de consultas neste acompanhamento, eles ficam guardados pelo mesmo prazo, pelas obrigações fiscais, e os pagamentos em aberto continuam devidos." (LGPD, art. 18, § 4º, II: a razão da retenção, no molde do comentário D22) |
| DPA | `DPA_O_QUE_MUDOU`: "O que mudou: o contrato passa a citar os registros financeiros do consultório, inclusive os pagamentos dos pacientes (Financeiro)." |

Os textos do manual guiado (guia `financeiro`) ficam em rascunho até a revisão do `revisor-interface` e da Debby,
como nos planos anteriores. Os textos ao paciente (portal e e-mails) e o DPA 1.1 vão no pacote do advogado (E-09).

---

## 7. Telas

Visual V2 do painel (tokens de `src/app/globals.css`, componentes de `src/components/ui`), largura até 1360 px como a
tela da consulta, uma coluna abaixo de 768 px. Esboços (o desenho exato fica com quem constrói e o `revisor-interface`):

**Resumo** (`/painel/financeiro`)

```
Financeiro
[Resumo] Lançamentos  Pagamentos pendentes  Relatórios  Configurações
                                               [Nova entrada] [Nova saída]
┌ Saldo atual ─────────┐┌ Entradas de novembro ┐┌ Saídas de novembro ┐┌ Pagamentos pendentes ┐
│ R$ 1.050,00          ││ Recebido R$ 750,00   ││ Pago R$ 1.200,00   ││ 1 paciente · R$ 500  │
│ Desde o saldo de     ││ A receber R$ 500,00  ││ A pagar R$ 90,00   ││ Ver                  │
│ 01/11/2026           │└──────────────────────┘└────────────────────┘└──────────────────────┘
Últimos lançamentos
 16/11  Entrada  Ana Souza · Consultas        R$ 250,00   Recebido
 05/11  Saída    Aluguel e condomínio         R$ 1.200,00 Pago
 Ver todos os lançamentos
```

**Seção "Cobrança" na tela da consulta** (`/painel/agenda/consultas/[id]`, abaixo de "Registrar presença"; só em
consulta `realizada`, ou `faltou` com cobrança):

```
Cobrança
 R$ 250,00 · Em atraso                        Abrir no Financeiro
 Valor [ 250,00 ] [Salvar valor]
 [Marcar como recebido]  → Data do recebimento [16/11/2026]  Forma de pagamento [Pix ▾] [Confirmar]
```

**Pagamentos pendentes**: tabela com `caption` "Pacientes com pagamento pendente" e colunas "Paciente", "Em aberto",
"Cobranças", "Mais antiga", "Situação", "Ação". **Relatórios**: as duas tabelas com `caption`, `th scope`; a de fluxo
dentro de um contêiner com rolagem horizontal própria (a página não rola), **focável pelo teclado** no padrão do
repositório: `<div role="region" aria-labelledby="<id do caption>" tabIndex={0} className="overflow-x-auto … focus-visible:outline-offset-[-3px]">`
(`src/app/p/(portal)/evolucao/tabela-medidas.tsx:14`; `src/app/painel/cores.test.ts:110` exige o contorno para dentro
em todo `.tsx` com `overflow-x-auto`); as barras em SVG com `aria-hidden="true"`, cor só por classes com token
(`fill-ok`, `fill-erro` ou `currentColor` com classe de texto; nunca `fill="#…"` em atributo, que o `cores.test.ts`
não vê e quebra um dos modos) e legenda em texto ("Entradas", "Saídas") ao lado.

**Mensagens e foco** (todas as telas do Financeiro): uma região `<p role="status">` sempre montada acima da lista ou do
formulário, fora das linhas (a linha recebida pode sair da lista com o `revalidatePath`; padrão
`feedback_mensagem-sucesso-desmontada` do `revisor-interface`), e o `role="alert"` dos erros junto do campo. O h1 de
cada tela tem `tabIndex={-1}` e recebe o foco quando a URL chega com `ok=` (depois de salvar, receber, cancelar) ou
depois de uma ação que tira a linha da lista. Formulários: a action devolve `valores` e os campos usam `defaultValue`
com `key` (como `consulta-form.tsx`), para um erro não apagar o que foi digitado (no React 19 os campos não
controlados voltam ao padrão depois da action).

**Menu:** com "Exames recebidos" e "Dúvidas dos pacientes" ligados, o menu chega a 9 itens; o cabeçalho já tem
`flex-wrap` (`cabecalho.tsx:21`), então nada é cortado — só quebra de linha e altura maior (R-310).

Acessibilidade: igual ao resto do painel (RNF-302).

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-300 | Privacidade em log | RN-322; teste que força erros no módulo e nas actions e confere que o logger e o `beforeSend` do Sentry não recebem valor, descrição, motivo, categoria nem nome (CS-302). Formulários do Financeiro fora dos breadcrumbs de entrada do Sentry (conferir `src/lib/sentry-filtro.ts`) |
| RNF-301 | Desempenho | Resumo, Lançamentos e Relatórios: p95 ≤ 800 ms (RNF-01) com 5.000 lançamentos por ano no consultório; cada tela em **uma** transação, agregação no SQL (`sum … filter`), somas em `bigint`, índices da §9; sem N+1 |
| RNF-302 | Acessibilidade | WCAG 2.1 AA (axe sem violação, claro e escuro, 1280 e 360 px): tabelas com `caption` e `th scope`; situação dita em texto (não só cor); barras `aria-hidden` com a tabela como alternativa; valores com "R$" no texto; mensagens em `role="status"` (região fixa) e `role="alert"` junto do campo; foco no h1 (`tabIndex={-1}`) depois de salvar (§7); contêiner rolável focável; alvos ≥ 44 px; navegação interna com `aria-current`; o axe cobre também o Financeiro **não configurado** ("Comece por aqui") nos dois temas, fora de `ROTAS_DO_PAINEL` |
| RNF-303 | Testes | (a) unidade: `paraCentavos`/`formatarReais`, `situacaoDoLancamento`, `dataDeReferencia`, CSV (injeção, BOM, separador); (b) integração (Testcontainers): RLS, `staff_only`, gatilho de regras (colunas fixas, cancelado não muda, anonimizado não muda, bloqueado não recebe novo, anonimização só pela função), DELETE/TRUNCATE revogados, FK de categoria com tipo, os dois caminhos da cobrança, a correção para Faltou (aberta e recebida: nada muda no Financeiro), concorrência (duas transações cobrando a mesma consulta; bloqueio confirmado no meio da criação), bordas de fuso (CS-301), exportação e anonimização; (c) guardas: nenhum arquivo de `src/modules/ia/**` importa o Financeiro nem contém `fin_` (RN-323); `_journal.json` com `when` estritamente crescente e `idx` sem buraco (`src/db/migrate.test.ts`, §9); (d) E2E: realizada → cobrança → recebido → Resumo (CS-300) e o primeiro acesso |
| RNF-304 | Exatidão | Centavos inteiros do formulário ao banco (nunca `float`); o `bigint` das somas volta como texto e vira `number` só abaixo de `Number.MAX_SAFE_INTEGER` (com o teto de valor, um consultório não chega lá); teste de propriedade CS-301 |
| RNF-305 | Fuso | Colunas `date`; "hoje" e mês por `tenants.fuso`; testes com o relógio na virada (00h00 e 23h59 em BRT, servidor em UTC) |
| RNF-306 | Dependências | Nenhuma dependência nova (C-303) |
| RNF-307 | Cache | Páginas do Financeiro com `dynamic = 'force-dynamic'` (como a agenda) e rotas CSV com `Cache-Control: no-store`; nada do Financeiro no service worker do portal |

---

## 9. Modelo de dados

Três tabelas novas, com `tenant_id`, num PR de fundação (F-D12). Migration gerada (`pnpm db:generate`) + migration
custom `rls_financeiro` (`pnpm drizzle-kit generate --custom --name rls_financeiro`), com `DATABASE_URL_MIGRATOR`
(regra 7). **Número: o que `pnpm db:generate` der em cima da `main` do momento** — nenhum número é reservado (o
branch do Plano 17 já tem 0118 a 0120, sem merge). Quem mergeia depois **gera de novo** a migration em cima da `main`
(`docs/operacao/sessoes-paralelas.md`, §5, passos 1 a 8): o `when` de cada migration nova tem de ser maior que o
último da `main`, senão o migrador do Drizzle (`drizzle-orm/pg-core/dialect.js`, que só aplica `folderMillis` maior
que o `created_at` da última aplicada) a pula em silêncio em produção — o CI não vê, porque migra um banco novo. O PR
de fundação acrescenta em `src/db/migrate.test.ts` uma guarda barata: `entries[i].when > entries[i-1].when` e
`entries[i].idx === i` no `drizzle/meta/_journal.json`. Schema em `src/db/schema/financeiro.ts`, exportado em
`src/db/schema/index.ts`.

### 9.1 `fin_configuracoes` (uma linha por consultório)

| Coluna | Tipo | Regras |
|---|---|---|
| `tenant_id` | `uuid` PK, FK `tenants(id)` | — |
| `saldo_inicial_centavos` | `integer not null` | CHECK `between -1000000000 and 1000000000` |
| `saldo_inicial_em` | `date not null` | CHECK `>= '2000-01-01'` (o "até hoje" é do módulo) |
| `valor_consulta_centavos` | `integer null` | CHECK `is null or between 1 and 100000000` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | — |

`REVOKE DELETE, TRUNCATE` de `nutri_app_role`: apagar a linha faria a próxima "primeira gravação" semear as
categorias de novo e bater nos índices únicos (RN-302).

### 9.2 `fin_categorias`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id` | `uuid not null` FK `tenants(id)` | — |
| `tipo` | `text not null` | CHECK `in ('entrada','saida')`; fixo (gatilho) |
| `nome` | `text not null` | CHECK `char_length between 1 and 60` |
| `chave` | `text null` | CHECK `chave is null or (chave = 'consultas' and tipo = 'entrada')`; índice único parcial `(tenant_id, chave) where chave is not null` |
| `arquivada_em` | `timestamptz null` | CHECK `chave is null or arquivada_em is null` ("Consultas" nunca arquivada) |
| `created_at`, `updated_at` | `timestamptz` | — |

`UNIQUE (tenant_id, id, tipo)` (alvo da FK composta dos lançamentos); índice único `(tenant_id, tipo, lower(nome))`.
Gatilho pequeno `fin_categorias_fixas` (BEFORE UPDATE OR DELETE): `tipo` e `chave` não mudam; DELETE de linha com
`chave is not null` é recusado (42501) — "Consultas" nunca some, mesmo sem lançamento (RN-303).

### 9.3 `fin_lancamentos`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id` | `uuid not null` FK `tenants(id)` | fixo |
| `tipo` | `text not null` | CHECK `in ('entrada','saida')`; fixo |
| `categoria_id` | `uuid not null` | FK `(tenant_id, categoria_id, tipo)` → `fin_categorias(tenant_id, id, tipo)` **NO ACTION** (mesmo tipo garantido pelo banco) |
| `valor_centavos` | `integer not null` | CHECK `between 1 and 100000000` |
| `vencimento` | `date not null` | CHECK `between '2000-01-01' and '2100-12-31'` |
| `pago_em` | `date null` | CHECK `is null or between '2000-01-01' and '2100-12-31'` |
| `forma_pagamento` | `text null` | CHECK `in ('pix','dinheiro','cartao_credito','cartao_debito','transferencia','boleto','outra')`; CHECK `fin_lancamentos_pago_tem_forma`: `pago_em is null or forma_pagamento is not null` |
| `descricao` | `text null` | CHECK `char_length between 1 and 200` |
| `patient_id` | `uuid null` | FK `(tenant_id, patient_id)` → `patients(tenant_id, id)` **NO ACTION**; fixo |
| `appointment_id` | `uuid null` | FK `(tenant_id, patient_id, appointment_id)` → `appointments(tenant_id, patient_id, id)` **NO ACTION**; fixo |
| `criado_por` | `uuid not null` | quem lançou (a sessão; para a cobrança automática, quem marcou "Realizada"); fixo |
| `cancelado_em` | `timestamptz null` | — |
| `cancelado_por` | `uuid null` | nulo só no cancelamento da anonimização |
| `motivo_cancelamento` | `text null` | CHECK `char_length between 1 and 200` |
| `anonimizado_em` | `timestamptz null` | — |
| `created_at`, `updated_at` | `timestamptz` | fixo / livre |

CHECKs de coerência (F-D24):

- `fin_lancamentos_saida_sem_paciente`: `tipo = 'entrada' or patient_id is null`.
- `fin_lancamentos_consulta_com_paciente`: `appointment_id is null or patient_id is not null` — sem ela, com
  `patient_id` nulo a FK composta (`MATCH SIMPLE`) não conferiria a consulta.
- `fin_lancamentos_cancelamento_coerente`: `(cancelado_em is null and cancelado_por is null and motivo_cancelamento is null) or (cancelado_em is not null and (motivo_cancelamento is not null or anonimizado_em is not null))`.
- `fin_lancamentos_anonimizado_sem_texto`: `anonimizado_em is null or (descricao is null and motivo_cancelamento is null)`.

Índices:

- `fin_lancamentos_consulta_ativa_unique`: **único parcial** `(tenant_id, appointment_id) where appointment_id is not null and cancelado_em is null` — uma cobrança ativa por consulta. O predicado com literais, como `tipoUmPorHorario`, para o `ON CONFLICT … WHERE` achar o índice.
- `fin_lancamentos_pago_idx`: `(tenant_id, pago_em) where cancelado_em is null and pago_em is not null` (saldo, fluxo, mês recebido).
- `fin_lancamentos_aberto_idx`: `(tenant_id, vencimento) where cancelado_em is null and pago_em is null` (previstos, pendentes).
- `fin_lancamentos_paciente_idx`: `(tenant_id, patient_id, vencimento) where patient_id is not null` (detalhe, aba, exportação, anonimização).
- `fin_lancamentos_criado_idx`: `(tenant_id, created_at, id)` ("Últimos lançamentos" do Resumo, `order by created_at desc, id desc limit 10`; acrescentado na correção da T4 — sem ele, top-N sobre a tabela de todos os consultórios).
- `fin_lancamentos_categoria_idx`: `(tenant_id, categoria_id, tipo)` (a FK composta da categoria, conferida em cada DELETE de `fin_categorias`; acrescentado na correção do `/code-review high` do PR 1).

### 9.4 Migration custom `rls_financeiro`

```sql
SELECT app_enable_tenant_rls('fin_configuracoes');  SELECT app_enable_staff_only('fin_configuracoes');
SELECT app_enable_tenant_rls('fin_categorias');     SELECT app_enable_staff_only('fin_categorias');
SELECT app_enable_tenant_rls('fin_lancamentos');    SELECT app_enable_patient_rls('fin_lancamentos');
SELECT app_enable_staff_only('fin_lancamentos');    SELECT app_enable_audit('fin_lancamentos', 'financeiro');
REVOKE DELETE, TRUNCATE ON fin_lancamentos FROM nutri_app_role;
REVOKE DELETE, TRUNCATE ON fin_configuracoes FROM nutri_app_role;
-- gatilhos fin_lancamentos_regras (BEFORE INSERT/UPDATE) e fin_categorias_fixas (BEFORE UPDATE OR DELETE);
-- função app_anonimizar_financeiro
```

**Gatilho `fin_lancamentos_regras`** (mensagens com `ERRCODE = '42501'`, como os de documentos e exames):

- **Ordem** (o `BEFORE INSERT` roda antes do `WITH CHECK` da RLS): (1) contexto vazio ou `worker` → 42501 (no UPDATE, o `worker` só passa no ramo da anonimização); (2) papel diferente de `nutri` → `RETURN NEW` sem ler `patients` (a RLS recusa); (3) só na sessão `nutri` lê o paciente com `FOR KEY SHARE`, no INSERT e no UPDATE. As funções dos gatilhos levam `SET search_path = public, pg_temp` e nomes com `public.`, como a função de anonimização.
- INSERT: `cancelado_em`, `cancelado_por`, `motivo_cancelamento` e `anonimizado_em` nulos; `criado_por := app_current_user()`
  (autoria pelo banco, como `exam_submissions` e `ia_autorizacoes`); com `patient_id`, o gatilho lê o paciente com
  `SELECT status, anonimizado_em … FOR KEY SHARE` (espera o `FOR UPDATE` do bloqueio e lê a versão nova) e recusa
  `bloqueado` ou anonimizado (defesa da RN-315). Papel: recusa só o `worker` (e o contexto vazio); paciente, `publico` e
  `conta` são recusados pela RLS (`paciente_sem_insert`, `publico_negado`), para os testes negativos de
  `test/isolamento.test.ts` verem a mensagem de RLS (`violaRlsDe`).
- UPDATE: `id`, `tenant_id`, `tipo`, `patient_id`, `appointment_id`, `criado_por`, `created_at` fixos (antes do
  `WITH CHECK` da RLS, por isso `IMUTAVEIS`); `OLD.anonimizado_em` preenchido → nada muda; `OLD.cancelado_em`
  preenchido → só a anonimização; o cancelamento na sessão `nutri` (`cancelado_em` de nulo a preenchido) grava
  `cancelado_por := app_current_user()` e `cancelado_em := clock_timestamp()`; com o paciente `bloqueado`, só
  `pago_em`, `forma_pagamento`, `valor_centavos` **para menor ou igual**, o cancelamento e `updated_at` mudam (RN-315);
  a passagem de `anonimizado_em` de nulo a preenchido só com o papel `worker` **e** o marcador local
  `app.fin_anonimizando = '1'` (ligado só por `app_anonimizar_financeiro`, como o `app.ia_nutri_revogando` do Plano
  15) **e** o paciente `bloqueado` com `anonimizado_em` nulo e `anonimizar_apos` vencido (antes de hoje no fuso do
  tenant, a mesma conferência da função, lida no gatilho com `public.tenants`: o marcador ligado à mão não basta),
  mexendo só em `anonimizado_em`, `descricao`, `motivo_cancelamento`, `cancelado_em`, `cancelado_por` e `updated_at`;
  lançamento pago não ganha cancelamento na anonimização (só os em aberto viram cancelados) e o em aberto cancelado
  por ela leva `cancelado_em := clock_timestamp()` e `cancelado_por` nulo, do gatilho (correção do `/code-review
  high` do PR 1); fora disso, só a sessão `nutri` altera.
  Comparações com `IS DISTINCT FROM`, para o UPDATE sem mudança passar.

**Função `app_anonimizar_financeiro(p_patient uuid)`** (molde da `app_anonimizar_aceites`, 0065):
`SECURITY INVOKER` (confirmado pelo `revisor-rls`: no contexto `worker`, `tenant_isolation`, `patient_isolation`,
`staff_only` e `paciente_sem_*` deixam passar, e o UPDATE não está revogado), com `SET search_path = public, pg_temp` e
nomes qualificados com `public.` (a defesa da tabela temporária da 0007, T4-R2a). Recusa fora do contexto `worker` de
um tenant; trava o paciente `FOR UPDATE` dentro da função (como a 0065) e recusa paciente que não esteja `bloqueado`
com `anonimizado_em` nulo **e** `anonimizar_apos` já vencido (antes de hoje no fuso do tenant, como o filtro de `anonimizarVencidos`; defesa a mais da revisão do plano, §18); liga o marcador local (`set_config('app.fin_anonimizando', '1', true)`); faz o UPDATE da
RN-316; **desliga** o marcador no fim (`set_config('app.fin_anonimizando', '', true)`, como a 0117:308), para ele não
valer até o fim da transação de `anonimizarVencidos`. `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role`.

### 9.5 Guardas e listas

| Lista | Entrada |
|---|---|
| `STAFF_ONLY` (`src/db/rls-guard.ts`) | `fin_configuracoes`, `fin_categorias`, `fin_lancamentos` — motivo: "Plano 20 (F-D1): financeiro do consultório — só a nutricionista; o titular recebe o que é dele pela exportação (inclusão explícita)" |
| `AUDIT_EXCEPTIONS` | nenhuma (só `fin_lancamentos` tem `patient_id`, e tem o gatilho) |
| `FABRICAS` (`test/isolamento.test.ts`) | as três; `fin_configuracoes` com `ON CONFLICT DO NOTHING` (a fábrica roda uma vez por paciente, duas por tenant); `fin_lancamentos` como entrada com paciente e sem consulta (FK anulável: a consulta fica de fora) |
| `COM_MAE` | `fin_lancamentos` (a categoria, FK NOT NULL, é criada no mesmo comando — regra 9 do CLAUDE.md). **Escolha registrada:** com `COM_MAE`, a recusa dos negativos de INSERT vem da política de `fin_categorias`, e o teste de isolamento não prova as políticas da própria `fin_lancamentos` no INSERT. Por isso `src/modules/financeiro/banco.test.ts` tem o caso próprio: com uma categoria já criada pela sessão `nutri` (a checagem da FK não passa pela RLS), INSERT em `fin_lancamentos` pela sessão de paciente, `publico` e `conta` → erro de RLS da própria tabela; pela `worker` → 42501 do gatilho |
| `ULTIMAS` | nenhuma (revisto em 17/11, §18): a única filha de `fin_categorias` é `fin_lancamentos`, que está em `SEM_DELETE` e nunca é apagada no teste, e o `SO_APAGA.fin_categorias` já deixa de fora as categorias com lançamento |
| `SEM_DELETE` e `DELETE_REVOGADO` | `fin_lancamentos` e `fin_configuracoes` |
| `IMUTAVEIS` | `fin_lancamentos` (o gatilho recusa mudar `tenant_id`/`patient_id` com 42501 antes da RLS) |
| `SO_APAGA` | `patients`: `and not exists (select 1 from fin_lancamentos f where f.tenant_id = patients.tenant_id and f.patient_id = patients.id)`; `fin_categorias`: só as sem lançamento e sem `chave` |

**Semente do E2E** (`scripts/e2e-seed.ts`, banco de dev reaproveitado): hoje ela apaga `appointments` do consultório
do E2E a cada execução (`AGENDA_E2E`, contexto `worker`), soltando antes `consultations.appointment_id`. Depois do
primeiro E2E da CS-300, a cobrança aponta para a consulta com FK `NO ACTION`, o DELETE de `fin_lancamentos` está
revogado e o `appointment_id` é fixo: o `delete from appointments` daria 23503 (o CI escapa porque usa um Postgres
novo, `ci.yml:131`). Decisão: a semente apaga só as consultas **sem** lançamento
(`delete from appointments a where not exists (select 1 from fin_lancamentos f where f.tenant_id = a.tenant_id and f.appointment_id = a.id)`)
e leva as que sobram a `cancelada` com `cancelado_por = 'sistema'` e `cancelada_em = now()` (CHECK
`appointments_cancelamento_completo`), o que libera o horário no `EXCLUDE` da 0051, que ignora as canceladas
(`appointments` não tem gatilho de transição). Os lançamentos das execuções anteriores ficam no consultório do E2E: o E2E do Financeiro
cria um paciente novo por execução e confere valores desse paciente, nunca os totais do consultório. Primeiro acesso repetível (revisão do plano, §18): a cada execução a semente cria dois consultórios novos sem Financeiro (slug com sufixo único, DPA aceito), com as contas de e-mail fixo `E2E_FIN_NOVO` (o E2E configura) e `E2E_FIN_AXE` (o axe do estado "não configurado"), recriadas apontando para eles; a linha de `fin_configuracoes` nunca precisa ser apagada.

### 9.6 O que não muda

`appointments`, `tenants`, `patients`, `stored_files` e o portal: nenhuma coluna nova (F-D2, F-D6, C-304, C-307).

---

## 10. LGPD

| Tema | Tratamento |
|---|---|
| Natureza do dado | Valor e data sozinhos não estão no art. 5º, II. Mas o lançamento que liga uma pessoa identificada a um consultório de nutrição revela o acompanhamento nutricional: tratamento que "revele" dado sensível (art. 11, § 1º). Por precaução, o lançamento com paciente é tratado como sensível — `staff_only`, auditado, fora de log (F-D1, F-D8, F-D9). **A conclusão é do advogado** (§14). Se integra ou não o prontuário fica **a conferir com o CRN-3** (F-P2): a Res. CFN 594/2017 fala em "informações clínicas e administrativas do paciente" (art. 2º) e "todas as informações clínicas e administrativas relacionadas à assistência nutricional" (art. 4º, caput), sem citar financeiro. A v1 guarda o financeiro como o prontuário (F-D16), a escolha mais fácil de reverter |
| Finalidade e base legal | Gestão financeira do consultório pela controladora (a nutricionista): execução do contrato com o paciente e obrigação legal fiscal (art. 7º, II e V; art. 11, II, "a" e "d" para o que revela saúde). O DPA 1.1 passa a citar a finalidade (F-D17) |
| Minimização | Sem nome, CPF ou dados de terceiro pagador; descrição curta com o aviso "Não escreva informações de saúde aqui." (e, na saída, "nem nomes de pessoas") (art. 6º, III; F-D9); saída nunca tem paciente (F-D24); CSV sem nomes por padrão, e sem a descrição das entradas de pacientes (F-D27); a ajuda do CSV lembra que quem recebe o arquivo guarda sigilo (Res. CFN 599/2018, art. 20, I) |
| Acesso pelo titular (art. 18, II; art. 19, II; termo 1.0, §13) | Seção **`financeiro`** no `dados.json`, nos **dois escopos** (titular e equipe), por **inclusão explícita** em `montarDados` — como `ia_tarefas` (seção `ia`, linhas 198-203) —, com o comentário "todas as tabelas do paciente, menos as staff_only" atualizado para citar a exceção. Campos: `vencimento`, `pagoEm`, `valorCentavos`, `valor` ("R$ 250,00"), `formaDePagamento` e `formaDePagamentoRotulo`, `situacao` e `situacaoRotulo` (no dia da exportação, no fuso), `categoria` (nome), `descricao`, `consultaInicio` (ISO, se ligada), `canceladoEm`, `motivoCancelamento`. **Não sai:** quem lançou e quem cancelou (dado da equipe, não do titular). Com a base em execução do contrato (art. 7º, V), o art. 19, § 3º dá ao titular a "cópia eletrônica integral" dos dados pessoais dele, ressalvados só os segredos comercial e industrial; o precedente do motivo de cancelamento da agenda e das notas privadas não vale aqui, porque lá a base é a do prontuário (art. 11, II, "a" e "f") (F-D22). A seção fica **só no `dados.json`**, como a seção `ia`; o `prontuario.pdf` não muda e **não há LEIA-ME** (o ZIP tem só `dados.json`, `prontuario.pdf` e os anexos, `exportacao-job.ts:722-729`); como nada do titular fica de fora, a condição do comentário de `exportacao-job.ts:106-108` (parecer e base no LEIA-ME) não se aplica |
| Pedido de exclusão (art. 18, VI) | O bloqueio não suspende o Financeiro: os lançamentos ficam para a obrigação fiscal (art. 16, I; CTN, arts. 173, I e 195, parágrafo único), e a cobrança da pendência se apoia no exercício regular de direitos (art. 11, II, "d" — hipótese que não está no art. 16; pergunta na F-P1). O art. 18, VI só alcança dado tratado com consentimento, o que aqui reforça a guarda. Nenhum lançamento novo com o paciente, e nos existentes só receber, desfazer, reduzir o valor e cancelar (F-D20). Transparência na hora do pedido (art. 18, § 4º, II: indicar as razões da não eliminação): o texto da aba Privacidade (nutricionista), a confirmação do portal e os dois e-mails da exclusão (paciente) ganham as frases da §6.2 |
| Guarda e anonimização | Segue o prontuário (F-D16): bloqueado com o paciente e anonimizado no `anonimizarVencidos` (20 anos do bloqueio), pela função `app_anonimizar_financeiro` (F-D23, RN-316): saem os textos livres, as cobranças em aberto viram canceladas, ficam valor, datas, categoria e forma (os relatórios antigos não mudam). Risco: guardar além do prazo fiscal se o CRN-3 disser que o financeiro não é prontuário (R-303) |
| IA | O Financeiro não entra em nenhum contexto de IA (RN-323) |
| Transparência | DPA 1.1 com novo aceite (F-D17, US-309). Termo do paciente: muda **na próxima revisão** ("registro de pagamentos das consultas" nas finalidades — hoje os parágrafos 4 e 5 de `termo-paciente-textos.ts` não citam pagamentos, e o art. 9º, I pede a finalidade específica — e no que fica guardado na exclusão; o compartilhamento do CSV com o contador pelo art. 9º, V), sem pedir novo aceite agora; item no backlog com prazo para o termo 1.1. Até lá, a transparência vai nos textos da exclusão (portal e e-mails, §6.2) e na exportação, que já entrega o dado |
| Registro das operações (art. 37; DPA, cl. 6 e 12) | Escritas pelo gatilho; leituras de um paciente com `auditRead` (RN-318); downloads com `exportar` (RN-321); configurações com `recordAudit` (RN-320) |
| Portal e página pública | Nada (C-302) |

**Texto do DPA 1.1** (só as cláusulas 2 e 5 e a linha da versão mudam; a numeração fica, porque o aditivo de IA remete
a ela; a 1.0 fica em `DPA_TEXTOS` para quem aceitou nela, fora do objeto literal, como a 1.0 hoje):

- Cláusula 2, na lista de dados: "(cadastro, anamnese, medidas, exames, planos, diário, documentos, registros de acesso
  **e registros financeiros do consultório, inclusive os pagamentos dos pacientes**)"; na lista de serviços: "(prontuário, agenda, lembretes, app do paciente,
  página de agendamento, documentos assinados, conteúdos, **financeiro do consultório** e as funções que a CONTROLADORA
  ativar)". A descrição das saídas pode citar terceiros (locador, fornecedor pessoa física), que a cláusula 2 não lista
  entre os titulares; a ajuda do campo pede para não escrever nomes de pessoas, e a redação final vai ao advogado.
- Cláusula 5, no fim: "depois, os anexos são apagados e o cadastro, os aceites, os documentos **e os registros de
  pagamento** são anonimizados."
- "Versão 1.1, de {data}." `DPA_VERSAO_DATA` é constante no código: a data fica fixa no PR e é conferida (e
  ajustada, se o deploy mudar de dia) antes do merge (R-309). Publicada pelo dono sem o advogado, como a 1.0 (na linha
  da A-D27); vai no pacote do advogado (E-09).

**Preço e honorários (nota para o manual e o runbook, sem mudança no produto):** a Res. CFN 856/2026, art. 68, II
(compilação não oficial) põe o dever de "informar previamente ao cliente ou paciente os valores dos honorários"
(CDC, art. 31), e o art. 68, caput, faz da divulgação do preço um direito; a vigência (23/01/2027, pela Res. CFN
858/2026) é a conferir de novo no DOU. A pergunta da F-P2 sobre o preço na página pública só faz sentido até
22/01/2027 (Res. 599, art. 57).

---

## 11. Boas práticas SBIS NGS1

1. **Trilha** (NGS1.07): escritas pelo gatilho `audit_row_change`, sem migration que o desligue; leituras de um
   paciente com `auditRead`; downloads com `exportar`; a anonimização aparece com ator nulo.
2. **Integridade do registro:** sem DELETE (revogado), cancelamento com motivo e sem volta, colunas fixas por gatilho,
   lançamento anonimizado imutável (F-D5, F-D23) — o padrão de documentos assinados e exames enviados.
3. **Controle de acesso** (NGS1.03): RLS por tenant, `staff_only`, `publico_negado`, sem papel novo; o admin não lê.
4. **Datas consistentes** (ECF.17.05): datas de calendário no fuso do consultório, "hoje" do servidor no fuso, nunca do
   aparelho; `cancelado_em` e as marcas de auditoria pelo relógio do banco.
5. **Autoria** (ECF.17.01): `criado_por` e `cancelado_por` gravados **pelo gatilho** a partir da sessão
   (`app_current_user()`), e `cancelado_em` pelo relógio do banco (`clock_timestamp()`), não pelo que o módulo manda;
   a cobrança automática leva como autora quem marcou "Realizada".

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-300 | Migrations em paralelo: o branch do Plano 17 já tem 0118 a 0120, e os Planos 18 e 19 também vão gerar migrations; `_journal.json` e snapshots em conflito; **migration pulada em silêncio** em produção se uma gerada antes entrar depois de outra com `when` maior | Nenhum número reservado; PR de fundação pequeno (F-D12); quem mergeia depois **gera de novo** em cima da `main` (`docs/operacao/sessoes-paralelas.md`, §5 — PD-01, PR #50, ainda no branch `docs/sessoes-paralelas`); guarda de `when` crescente e `idx` sem buraco em `src/db/migrate.test.ts` (§9); uma migration por vez na fila de merge |
| R-301 | Conflito com os Planos 17, 18 e 19 em `lgpd.ts`, `exportacao-job.ts`, `lgpd.test.ts`, `exportacao.test.ts`, `isolamento.test.ts`, `rls-guard.ts`, `audit-guard.ts`, `schema/index.ts` e `scripts/e2e-seed.ts` (e com o 17 em `src/modules/agenda/fuso.ts`) | A tarefa de LGPD (T9) rebaseia depois do último desses planos que entrar antes dela; helpers de mês no fuso ficam em `src/modules/financeiro/` (não em `fuso.ts`), reaproveitando `inicioDoMes`/`hojeNoFuso` sem editá-los; acréscimos em linhas separadas |
| R-302 | Dependência do Plano 18: a seção da ficha (PD-33) usa o registro de seções dele; uma 14ª aba não cabe a 1280 px (R-266 de lá) | Seção no Início como última tarefa (F-D18 acertada), sem mexer em `abas.tsx`/`layout.tsx`. A spec do Plano 18 diz que ele **não** toca `atendimentos.ts`, `presenca.ts` nem a tela da consulta: a cobrança (T7) não precisa de combinação; a lógica fica em `src/modules/financeiro/cobranca.ts`, e nos arquivos da agenda entra só a chamada |
| R-303 | Pareceres podem mudar regras com o código pronto (advogado: guarda, DPA, pendência na exclusão; CRN-3: falta, preço, financeiro × prontuário) | As escolhas são as mais fáceis de reverter (guarda = a do prontuário; sem cobrança de falta; nada público); §14 |
| R-304 | Vazamento de dado sensível (valor, nome, descrição) em log, Sentry ou mensagem de erro | RN-322, RNF-300 com teste |
| R-305 | Descrição virando prontuário paralelo ("retorno pós-bariátrica") | 200 caracteres, aviso no campo, fora do CSV sem nomes nas entradas de pacientes, fora de log e da IA, limpa na anonimização; entra na cópia do titular (art. 19, § 3º) |
| R-306 | Saldo inicial com data confunde (pagamento anterior não muda o saldo) | Aviso na hora de salvar (US-301) e nota nos relatórios |
| R-307 | Fuso: agrupar por instante em UTC desloca a virada do mês | Colunas `date`, "hoje" por `hojeNoFuso`, testes de borda (RNF-305) |
| R-308 | Cobrança duplicada por toque duplo ou duas abas | Índice único parcial + `ON CONFLICT DO NOTHING`; mensagem "Esta consulta já tem uma cobrança." |
| R-309 | O DPA 1.1 bloqueia o painel até o novo aceite: deploy em horário ruim interrompe a Debby; outro plano em paralelo pode também subir a versão do DPA — a spec do Plano 18 deixou com o advogado se o DPA 1.0 cobre os campos novos do cadastro (§14 de lá, pergunta 2) | Avisar a Debby antes do deploy; aceite com um clique; combinar entre as sessões que **só o Plano 20** sobe o DPA nesta onda (se o Plano 18 precisar, junta na 1.1 ou vira 1.2 na ordem dos merges); `DPA_VERSAO_DATA` conferida antes do merge |
| R-310 | Menu do painel com até 9 itens (com "Exames recebidos" e "Dúvidas dos pacientes") | O cabeçalho já quebra linha (`flex-wrap`, `cabecalho.tsx:21`): nada é cortado, só a altura aumenta. `revisor-interface` mede a 1280 px e a 1024 px na T5; se ficar ruim, o item vai para o hub "Configurações" só depois de decisão do dono |
| R-311 | Edição de lançamento recebido muda o valor sem guardar o antes (o `audit_log` não guarda antes/depois) | Aceito na v1: o "Alterou — Financeiro" mostra quem e quando; o CSV mensal guardado pela nutricionista é o comprovante (CTN, art. 195); "antes/depois" fica no backlog se o contador pedir |
| R-312 | Semente do E2E quebra no banco de dev reaproveitado (FK `NO ACTION` da cobrança para a consulta, DELETE revogado) | Semente apaga só as consultas sem lançamento e cancela as outras (§9.5), na mesma tarefa que cria a FK (T1) |
| R-313 | Janela em que o Financeiro grava lançamentos com paciente e a exportação ainda não tem a seção `financeiro` | A tarefa de LGPD (T9) vai no **mesmo deploy** da primeira escrita de lançamento com paciente: o PR 2 (T2–T11) não vai a merge sem ela |
| R-314 | Volta atrás da imagem do PR 2 para a do PR 1 (ou anterior): a imagem antiga não chama `app_anonimizar_financeiro` em `anonimizarVencidos`; o paciente ganha `anonimizado_em`, e a função, que exige `anonimizado_em` nulo, nunca mais anonimiza os lançamentos dele | Risco prático nulo hoje (o primeiro vencimento é bloqueio + 20 anos). Se houver volta atrás com paciente vencido no meio, anonimizar à mão com o dono; item no backlog (T11) |

Também: CI em fila no runner único (cerca de 30 min por PR) com três sessões disputando CPU com a produção — a revisão
pesada é escalonada; e **não exigir snapshot** antes da migration em produção (o snapshot da Hostinger congela a VPS,
CLAUDE.md do servidor): migration só aditiva e o backup restic diário.

---

## 13. Conflitos com sessões paralelas

| Sessão | Worktree / branch | Arquivos em comum com o Plano 20 | Como evitar |
|---|---|---|---|
| Plano 17 — lembretes de rotina | `nutridebby-a` / `plano-17-lembretes-rotina` (0118 a 0120 commitadas no branch, sem merge) | `drizzle/` (0118 a 0120, journal, snapshots), `src/db/schema/index.ts`, `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `lgpd.ts`, `exportacao-job.ts` e testes, `src/modules/agenda/fuso.ts`, `scripts/e2e-seed.ts`, `src/modules/plataforma/audit.ts`, `src/modules/ajuda/conteudo.ts`, `CLAUDE.md` (regras 1, 2, 8) | Nenhum número reservado: quem mergeia depois gera de novo em cima da `main` (§5 do `sessoes-paralelas.md`); a T9 (LGPD) rebaseia depois do merge dele; sem editar `fuso.ts` |
| Plano 18 — ficha e cadastro | `nutridebby-18` / `plano-18-ficha-cadastro` | `src/modules/ficha/secoes/` (registro de seções, onde entra a seção Financeiro), `privacidade/page.tsx`, `lgpd.ts` (D18: apaga `patient_cadastro` na anonimização), `exportacao-job.ts`, `exportacao.test.ts`, `isolamento.test.ts`, `drizzle/`, guardas, `e2e/painel-rotas.ts`. **Não** toca `atendimentos.ts`, `presenca.ts` nem a tela da consulta (tabela de conflitos da spec do Plano 18, linha do Plano 20: "O Plano 18 não toca `atendimentos.ts`, `presenca.ts` nem a tela da consulta") | Seção da ficha (T12) por último, depois do merge; a T9 rebaseia depois do merge dele se ele entrar antes; texto da Privacidade só acrescentado |
| Plano 19 — plano alimentar 2 | `nutridebby-b` / `plano-19-plano-alimentar-2` | `drizzle/`, `schema/index.ts`, guardas, `isolamento.test.ts`, `exportacao-job.ts` (`planosParaExportacao`), `exportacao.test.ts`, `lgpd.ts`, `src/modules/ajuda/conteudo.ts`, `e2e/painel-rotas.ts`, `src/app/painel/ajuda`, `CLAUDE.md` | Uma migration por vez na fila; entradas novas nas listas em linhas separadas (conflito de merge pequeno); a T9 rebaseia depois do merge dele se ele entrar antes |
| Todas | — | `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`), `src/modules/plataforma/dpa.ts`, `docs/manual-tecnico/README.md`, `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` | Rótulo novo numa linha só; DPA só pelo Plano 20 nesta onda (R-309); manuais e índice no fechamento, rebaseados |

---

## 14. Decisões

### 14.1 Decisões aprovadas pelo dono (16/11/2026, "aprovo todas as recomendações, pode seguir")

F-D1 a F-D12 são as decisões propostas na proposta; as marcadas "acertada" foram corrigidas pela crítica de completude
ou pela revisão da v0.2, conferidas no código. Na v0.1 esta frase dizia "sem mudar o que o dono aprovou", mas a F-D19
mudava a parte da F-D7 sobre não cancelar a cobrança sozinho; a v0.2 desfez isso (F-D19 abaixo, F-P5). A F-D18
acertada troca a aba pela seção no Início por uma restrição de largura do Plano 18, sem mudar o que ela entrega.

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| F-D1 | **Só a nutricionista vê o Financeiro.** Três tabelas `staff_only`, nada em `PUBLICO_LIBERADO`/`PACIENTE_ESCREVE`, admin nunca consulta; item no menu para toda nutricionista, sem interruptor. *Acertada:* o paciente não vê as linhas no app, mas recebe o que é dele pela cópia "Baixar meus dados" (F-D22) | O lançamento com paciente revela o acompanhamento (LGPD, art. 11, § 1º) e está sob sigilo (Res. CFN 599, art. 20); um interruptor mexeria em `tenants` sem ganho | RN-300, RN-327, §3 |
| F-D2 | **Saldo inicial e valor da consulta em `fin_configuracoes`**, não em `tenants` | `tenants` tem gatilhos de colunas e é disputado; tabela própria fica isolada | §9.1, C-307 |
| F-D3 | **Centavos inteiros; datas `date` no fuso do consultório** | Sem erro de arredondamento; o mês não muda com o relógio UTC da VPS | RN-304, RNF-304, RNF-305 |
| F-D4 | **Situação calculada, sem coluna.** *Acertada:* Previsto = vencimento hoje ou depois; Em atraso = antes de hoje; "hoje" no fuso; recebido conta pelo mês do pagamento e em aberto pelo do vencimento | Status gravado poderia contradizer as datas; a crítica mostrou a sobreposição da regra original | RN-305, RN-306 |
| F-D5 | **Não há DELETE: cancelar com motivo, sem volta**; tipo, paciente, consulta e autor fixos | Prova dos lançamentos (CTN, art. 195, parágrafo único), meta SBIS e o padrão de documentos e exames | RN-308, RN-309, §9.4 |
| F-D6 | **Cobrança ligada à consulta por colunas em `fin_lancamentos`** (FK composta para `appointments(tenant_id, patient_id, id)`, índice único parcial: uma cobrança ativa por consulta); nada muda em `appointments` | A FK garante que a cobrança é do paciente da consulta; não mexer na agenda evita conflito | §9.3 |
| F-D7 | **Falta não gera cobrança automática**; a nutricionista lança à mão. Texto aprovado: "Se uma consulta com cobrança for cancelada, o sistema avisa na tela, mas não cancela a cobrança sozinho" (porquê: "evitar efeito automático escondido"). *Acertada:* "consulta com cobrança cancelada" não acontece (só agendada/confirmada se cancela, `STATUS_ATIVOS`, `consultas.ts:51`); o caso real é a correção para Faltou, que segue o mesmo princípio: avisa e não cancela (F-D19) | Cobrar falta depende do CRN-3 (Res. 856, art. 65) | RN-312, RN-313 |
| F-D8 | **Auditoria:** gatilho em `fin_lancamentos` (entidade `financeiro`, rótulo "Financeiro"); `auditRead` só nas telas de um paciente; sem `auditRead` em Resumo, relatórios e lista de pendências; CSV grava `exportar`. *Acertada:* a regra cobre também a lista filtrada por paciente, a edição de lançamento com paciente e a seção "Cobrança" da consulta | Mantém verdadeira a promessa do DPA (cl. 6 e 12) sem encher o Histórico | RN-318 a RN-321 |
| F-D9 | **Minimização:** sem dados de terceiro pagador; descrição de até 200 com aviso; nada em log | LGPD, art. 6º, III; regra 3 | RN-304, RN-322 |
| F-D10 | **Gráficos em SVG/CSS e CSV em rota do painel; sem PDF, sem biblioteca, sem comprovante** | YAGNI; regra 9 | C-303, C-304 |
| F-D11 | **Rotas em `/painel/financeiro/…`**, com as configurações dentro do módulo | Não colide com `/painel/agenda/pendencias` nem com o hub de Configurações | §4.1 |
| F-D12 | **Ordem de entrega:** PR 1 de fundação (tabelas, migrations, guardas), mergeado antes; depois módulos e telas (PR 2, com a LGPD no mesmo deploy, R-313); a seção da ficha por último (PR 3) | Regra das sessões paralelas e dependência do Plano 18 | §15 |
| F-D13 | **A cobrança nasce ao marcar "Realizada"**, pelos **dois caminhos** (`registrarPresenca` e o registro do atendimento ligado), numa função só do módulo financeiro chamada na transação deles; valor padrão editável | Cobra o que foi atendido, sem esquecer consulta e sem cobrar o que não aconteceu; a crítica achou o segundo caminho (`atendimentos.ts:83`) | RN-310, US-303 |
| F-D14 | **Uma conta só** (caixa do consultório), forma de pagamento em cada lançamento | Várias contas = tabela, transferências e telas a mais; dá para evoluir | §2.2 |
| F-D15 | **Um valor padrão único da consulta** | Menor esforço; cada cobrança se ajusta | RN-324 |
| F-D16 | **Financeiro do paciente guardado como o prontuário e anonimizado junto** | Usa a anonimização que existe; o advogado confirma | RN-316, §10 |
| F-D17 | **DPA 1.1 agora, com novo aceite** ("registro de pagamentos das consultas"); **termo do paciente depois** | O DPA lista as categorias de dados; o fluxo de novo aceite existe; novo aceite de todos os pacientes geraria atrito | US-309, §10 |
| F-D18 | **O Financeiro na ficha espera o Plano 18 e entra como última tarefa.** *Acertada:* entra como **seção "Financeiro" no Início** (registro de seções do Plano 18, D14/RN-277, §11 de lá), não como 14ª aba, que não cabe a 1280 px (R-266 do Plano 18; guarda de largura RNF-261 de lá). Se o dono preferir aba, só com o menu lateral do backlog (decisão com a orquestradora) | Evita refazer e brigar por `abas.tsx`/`layout.tsx`; o registro de seções foi feito para isso | US-308, RN-329, §15 |

### 14.2 Decisões minhas, da crítica de completude (o dono pode corrigir)

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| F-D19 | **Correção de "Realizada" para "Faltou": avisa, não cancela.** A cobrança (em aberto ou recebida) fica como está; a tela avisa ("Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar." / "…tem um pagamento recebido…"). *Revista na v0.2:* a v0.1 cancelava sozinha a cobrança em aberto, **contra** a recomendação aprovada da F-D7; voltou ao aprovado. A alternativa (cancelar sozinha com motivo fixo) fica como pergunta ao dono (F-P5) | Segue o princípio aprovado "sem efeito automático escondido"; não barra a correção da agenda; voltar para Realizada mantém o valor ajustado | RN-312, US-303 |
| F-D20 | **Paciente bloqueado ou anonimizado:** a cobrança automática não nasce e nenhum lançamento novo é aceito (módulo e gatilho); nos lançamentos do bloqueado, só receber, desfazer o recebimento, **reduzir** o valor e cancelar, com trava própria (não `carregarPacienteParaEscrita`); os do anonimizado não mudam. *Revista na v0.2* (revisão normativa): editar categoria, vencimento, descrição ou aumentar o valor depois do bloqueio é tratamento novo (LGPD, art. 5º, XIII); receber, desfazer, reduzir e cancelar se defendem pelo art. 11, II, "d" | Depois do pedido de exclusão nada novo é registrado sobre ele (JUR-01: o bloqueio é o último registro), mas a pendência continua devida; `registrarPresenca` aceita esses pacientes e `carregarPacienteParaEscrita` os recusa | RN-308, RN-310, RN-315 |
| F-D21 | **Sem valor da consulta configurado: não cria e avisa**; **sem criação retroativa** das consultas realizadas antes; "Registrar cobrança" à mão na tela da consulta realizada sem cobrança | O `CHECK valor > 0` impede cobrança de zero; retroativo inflaria ou esvaziaria as pendências sem a nutricionista ver; o botão manual cobre o caso a caso | RN-310, RN-314, US-300, US-303 |
| F-D22 | **Exportação por inclusão explícita**, nos dois escopos, com descrição, categoria e motivo do cancelamento; sem quem lançou e quem cancelou; só no `dados.json`. *Revista na v0.2* (revisão normativa): a v0.1 tirava descrição, categoria e motivo pelo precedente da agenda, mas com base em contrato (art. 7º, V) o art. 19, § 3º dá a cópia integral; tirar dado do titular exige o parecer e a base (comentário de `exportacao-job.ts:106-108`) | `montarDados` exclui as `staff_only`; o termo promete a cópia; o aviso "Não escreva informações de saúde aqui" tira o risco da descrição | §10, US-307 |
| F-D23 | **Anonimização por `app_anonimizar_financeiro`** (contexto `worker`, marcador local ligado e desligado na função, paciente travado), que limpa os textos, cancela as cobranças em aberto e marca `anonimizado_em`; lançamento anonimizado não muda | O gatilho que trava o cancelado barraria a limpeza; ponto único, como `app_anonimizar_aceites` e `app_ia_nutri_revogar`; depois de 20 anos a cobrança de honorários já prescreveu (Código Civil, art. 206, § 5º, II: "a pretensão dos profissionais liberais em geral […] pelos seus honorários, contado o prazo da conclusão dos serviços", cinco anos — conferido no Planalto em 16/11/2026) e não pode ficar "em atraso" para sempre | RN-316, §9.4 |
| F-D24 | **Coerência no banco:** saída sem paciente; consulta só com paciente (fecha o furo do `MATCH SIMPLE`); categoria do mesmo tipo do lançamento pela FK composta com o tipo | O banco garante o que a tela promete | §9.3 |
| F-D25 | **Configuração e categorias nascem na primeira gravação** (primeiro acesso guiado), nunca numa leitura nem na criação da conta (`contas.ts` intacto); "Consultas" é categoria de sistema (chave), renomeável e não arquivável | Página que grava na leitura é efeito escondido; a cobrança automática precisa de uma categoria certa | RN-301 a RN-303 |
| F-D26 | **Rótulo "Pagamentos pendentes"** (nunca só "Pendências") e pendência = entrada com paciente em aberto, **prevista ou em atraso**, com o selo "Em atraso" | A Agenda já tem "Pendências" (presença); a cobrança da consulta vence no dia e o "a vencer" também é dinheiro a receber do paciente | RN-311, §4.1 |
| F-D27 | **CSV:** primeira exportação CSV do app, com neutralização de fórmula, `no-store`, só sessão `nutri`; **nome do paciente só se marcado** (desmarcado por padrão) e `exportar` por paciente presente; sem a opção, a descrição das entradas de pacientes sai vazia (*v0.2*: a descrição livre pode identificar, e sem nome não há `exportar` por paciente) | O contador quase sempre precisa só dos totais; o nome no arquivo sai do controle do sistema, então fica registrado no Histórico de cada paciente | RN-321, US-306 |
| F-D28 | **Começo a partir do Dietbox à mão:** saldo do caixa na data da virada e as pendências abertas como entradas previstas por paciente; sem importação de planilha | A importação seria uma tarefa a mais e um formato que não controlamos; são poucas dezenas de pendências (a Debby tinha 43) | §2.2, runbook do fechamento |
| F-D29 | **Saldo do caixa no início do dia informado**; pagamento anterior não muda o saldo, com aviso na tela e nota nos relatórios | Define sem ambiguidade o que entra no saldo | RN-307, US-301, US-306 |
| F-D30 | **Configurações com trilha própria sem paciente** (`recordAudit`, entidade `financeiro_configuracoes`); categorias sem trilha | O saldo inicial muda todos os totais e deve ter quem e quando; categoria é rótulo | RN-320 |

### 14.3 Pendências externas ★ (não travam a v1)

| ID | Para quem | Pergunta | Efeito se a resposta for outra |
|---|---|---|---|
| F-P1 ★ | Advogado (E-09) | O lançamento com paciente é sensível pelo art. 11, § 1º? Base legal? Guarda A (prontuário) ou B (prazo fiscal)? Destino da pendência na exclusão — a cobrança se apoia no art. 11, II, "d" (exercício regular de direitos), que não está no art. 16? No bloqueado, só receber, desfazer, reduzir e cancelar basta (art. 5º, XIII)? DPA 1.1 basta (inclusive terceiros citados na descrição das saídas)? Textos da exclusão ao paciente (portal e e-mails, §6.2)? Compartilhamento do CSV com o contador no termo 1.1 (art. 9º, V)? Cobrança por WhatsApp/e-mail é possível? | Guarda B = rotina própria de desvinculação (≈ 1 tarefa); cobrança ao paciente = plano novo; ajuste de textos |
| F-P2 ★ | CRN-3 | O financeiro integra o prontuário (Res. 594, arts. 2º e 4º, "informações clínicas e administrativas")? Cobrar falta (Res. 856, art. 65)? Mostrar o preço na página pública antes de 23/01/2027? CSV com nomes para o contador: termo de sigilo (Res. 599, art. 20, I)? | Cobrança de falta automática; preço na página pública; guarda |
| F-P3 ★ | Contador | Prazo fiscal exato (pessoa física com carnê-leão ou CNPJ), colunas do CSV, NFS-e e livro-caixa | Ajuste das colunas do CSV |
| F-P4 ★ | Dono + Debby | Textos do manual guiado e da Central de Ajuda do Financeiro | Só texto |
| F-P5 ★ | Dono | Na correção de "Realizada" para "Faltou" com cobrança em aberto: (a) o sistema cancela a cobrança sozinho, com o motivo fixo "Consulta corrigida para Faltou." (a F-D19 da v0.1), ou (b) só avisa e a nutricionista cancela (a F-D7 aprovada, adotada na v0.2)? | (a) = `aoCorrigirParaFaltou` passa a cancelar (marcador do motivo fixo, `cancelado_por` = quem corrigiu) e a mensagem vira "A cobrança desta consulta foi cancelada."; meia tarefa |

---

## 15. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-F1 | **T1 — Fundação** (PR 1, mergeado antes): schema, migrations (§9; número do `db:generate` em cima da `main`, nada reservado), gatilhos, função de anonimização, `REVOKE` em `fin_lancamentos` e `fin_configuracoes`, listas das guardas (§9.5), `ENTIDADE_ROTULO.financeiro`, guarda do `_journal.json` em `src/db/migrate.test.ts`, semente do E2E (§9.5), testes de banco. Regra do merge: quem mergeia depois gera a migration de novo em cima da `main`; o `when` de cada migration nova tem de ser maior que o último da `main` (`sessoes-paralelas.md`, §5). Revisor: `revisor-rls` |
| PM-F2 | **T2 — Regras puras** (`dinheiro.ts`, `situacao.ts`, `constantes.ts`, `csv.ts`) |
| PM-F3 | **T3 — Configurações e lançamentos** (`configuracoes.ts`, `lancamentos.ts`), com Testcontainers; assert de `ctx.role`; trava do paciente na criação (RN-317); guardas RN-323 (importação e texto `fin_`) e RNF-300 (log e Sentry) |
| PM-F4 | **T4 — Agregados** (`resumo.ts`): saldo, mês (com o atraso de meses anteriores), fluxo do ano (mês do saldo, RN-307), 12 meses, pendências; testes de borda de fuso e de propriedade (CS-301) |
| PM-F5 | **T5 — Menu, navegação interna, Configurações (primeiro acesso) e Resumo**: item no menu (medir a largura, R-310), guia `financeiro` v1, `boas-vindas` v4, `TSX_FORA` com `src/modules/financeiro`, `ROTAS_DO_PAINEL` das telas novas, `navegacao.test.ts`. Revisor: `revisor-interface` |
| PM-F6 | **T6 — Lançamentos** (lista, filtros, novo, editar, receber, desfazer, cancelar), com a região viva fixa, o foco no h1 e os `valores` no erro; passos do guia `financeiro` e `ROTAS_DO_PAINEL` das telas. Revisor: `revisor-interface` |
| PM-F7 | **T7 — Cobrança por consulta**: `cobranca.ts`; chamadas em `registrarPresenca` (que passa a precisar do fuso: ler `tenants.fuso` na transação ou receber o tenant) e em `registrarAtendimento`, que passam a devolver o resultado da cobrança; seção "Cobrança" e mensagens na tela da consulta (`?ok=presenca&cobranca=criada|sem_valor|aberta|recebida`) e na página do atendimento (`?ok=atendimento&cobranca=criada|sem_valor`); guia `agenda` v2. Sem combinação prévia com o Plano 18 (ele não toca esses arquivos). Revisores: `revisor-rls`, `revisor-interface` |
| PM-F8 | **T8 — Pagamentos pendentes e Relatórios + CSV** (validação do período no cliente, rotas com redirect em vez de JSON, `exportar`, contêiner rolável focável, barras com tokens) |
| PM-F9 | **T9 — LGPD:** seção `financeiro` só no `dados.json` (sem LEIA-ME), `app_anonimizar_financeiro` em `anonimizarVencidos` (antes do UPDATE de `patients`), textos da exclusão (aba Privacidade, `CONFIRMAR_EXCLUSAO` do portal, e-mails `pedido_exclusao_registrado` e `exclusao_atendida`). Rebaseia depois do último dos Planos 17, 18 e 19 que entrar antes; vai no mesmo PR e deploy das escritas com paciente (R-313). Revisores: `normas-cfn-lgpd` e `revisor-rls` |
| PM-F10 | **T10 — DPA 1.1** (`DPA_VERSAO`, `DPA_VERSAO_DATA`, cláusulas 2 e 5, `DPA_O_QUE_MUDOU` em `/painel/dpa`, a 1.0 mantida no mapa); os testes que fixam '1.0': `src/app/painel/actions.test.ts`, `src/lib/tenant-session.test.ts`, `src/modules/plataforma/textos-legais.test.ts` (linhas 75-82 e 117), `src/modules/plataforma/dpa.test.ts` (linhas 61-78), `src/app/painel/dpa/page.test.ts:27`; o comentário "DPA (1.0, cláusula 8)" em `src/modules/ia/textos-legais.ts:331`; o `scripts/e2e-seed.ts` já usa a constante. Revisor: `normas-cfn-lgpd` |
| PM-F11 | **T11 — Fechamento do PR 2:** E2E (CS-300; primeiro acesso nos dois temas), CLAUDE.md (regras 1, 2 e 8), manual técnico (capítulo novo, número na hora), manual do usuário (Docs) e Central de Ajuda (`guardiao-manual`), runbook do começo (F-D28), do aviso à Debby antes do deploy (R-309) e a nota da Res. CFN 856/2026, art. 68 (§10); item no backlog para o termo 1.1 |
| PM-F12 | **T12 — Seção "Financeiro" no Início da ficha** (US-308, PR 3), **última**, depois do merge do Plano 18; guia `prontuario` (ou o guia do Início do Plano 18) se o texto mudar; atualiza os manuais da T11. Revisor: `revisor-interface` |
| PM-F13 | Conferir `src/lib/sentry-filtro.ts` para os formulários do Financeiro (RNF-300), na T3 |
| PM-F14 | Agentes nas revisões: `revisor-rls` (T1, T3, T7, T9), `normas-cfn-lgpd` (T9, T10), `revisor-interface` (T5–T8, T12), `guardiao-manual` (T11, T12) |

---

## 16. Referências

- Proposta aprovada: `/home/deploy/servidor/projetos/.sessoes/proposta-plano-20.json` (brief, crítica, normas e levantamento, 16/11/2026).
- Código: `src/db/schema/agenda.ts`, `src/modules/agenda/presenca.ts`, `src/modules/agenda/cancelamento.ts`, `src/modules/pacientes/atendimentos.ts`, `src/modules/pacientes/base.ts`, `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/plataforma/audit.ts`, `src/modules/plataforma/dpa.ts`, `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `src/app/painel/navegacao.ts`, `src/app/painel/agenda/consultas/[id]/page.tsx`, `src/app/painel/pacientes/[id]/abas.tsx`, `drizzle/0000`, `0007`, `0020`, `0065`, `0091`.
- LGPD (Lei 13.709/2018), arts. 5º, 6º, 7º, 9º, 11, 15, 16, 18, 19, 37 e 46: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm (conferida em 16/11/2026).
- Res. CFN 594/2017, arts. 1º, 2º e 3º, VI: https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm; Res. CFN 599/2018, arts. 20, 51 e 57: https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html; Res. CFN 856/2026, arts. 23, 65 e 68 (compilação não oficial, LegisWeb; vigência a conferir no DOU) — conferidas em 16/11/2026.
- CTN, arts. 173, I e 195, parágrafo único; CDC, arts. 42 e 42-A; Código Civil, arts. 319 e 320 (Planalto, conferidos em 16/11/2026). Código Civil, art. 206, § 5º, II (prescrição dos honorários de profissional liberal em cinco anos, citado na F-D23): conferido no Planalto (l10406compilada) em 16/11/2026 pela revisão normativa.
- Res. CFN 594/2017, art. 4º, caput ("todas as informações clínicas e administrativas relacionadas à assistência nutricional"); LGPD, arts. 5º, XIII (bloqueio), 16, I a IV, 18, § 4º, II e 19, § 3º — conferidos no Planalto e no CFN em 16/11/2026.
- CFN sobre o Receita Saúde: https://cfn.org.br/sobre-a-exigencia-do-nutricionista-no-sistema-receita-saude/.
- SBIS — Manual de Certificação para S-RES, nível NGS1 (NGS1.03, NGS1.07, ECF.17.01, ECF.17.05).

---

## 17. Revisão 0.2 (16/11/2026)

Quatro lentes sobre a v0.1 (commit 97e59a4): banco/RLS/auditoria (`revisor-rls`), normas (`normas-cfn-lgpd`),
interface (`revisor-interface`) e completude. Nenhum Critical. Cada achado foi conferido no código do worktree e nos
worktrees dos Planos 17, 18 e 19 antes de entrar.

| Achado | Destino |
|---|---|
| RLS I-1 / completude I-1 — "no mínimo 0120" velho (o Plano 17 já tem 0118 a 0120) e reserva de número × `when` do Drizzle | Aplicado: §9, C-306, R-300, §13, PM-F1; guarda do `_journal.json` em `migrate.test.ts` |
| RLS I-2 — semente do E2E quebra no dev reaproveitado | Aplicado: §9.5 (apaga só consultas sem lançamento e cancela as outras), R-312, T1 |
| RLS M-1 / completude M-4 — trava do paciente na criação | Aplicado: RN-317 e gatilho com `FOR KEY SHARE` |
| RLS M-2 — autoria sem garantia do banco | Aplicado: gatilho grava `criado_por`, `cancelado_por`, `cancelado_em`; §11 item 5 |
| RLS M-3 — `app_anonimizar_financeiro` | Aplicado: `search_path`, `public.`, marcador desligado, paciente `FOR UPDATE`, conferência no gatilho |
| RLS M-4 — "Consultas" excluível sem lançamento | Aplicado: `fin_categorias_fixas` também em `BEFORE DELETE` |
| RLS M-5 — DELETE em `fin_configuracoes` | Aplicado: `REVOKE DELETE, TRUNCATE`, `SEM_DELETE`/`DELETE_REVOGADO`, semente com `ON CONFLICT DO NOTHING` |
| RLS M-6 — `COM_MAE` torna vácuo o negativo de INSERT | Aplicado em parte: fica em `COM_MAE` (escolha registrada em §9.5), gatilho só recusa `worker`, caso próprio em `banco.test.ts` |
| RLS M-7 — janela sem a seção `financeiro` na exportação | Aplicado: R-313 (LGPD no mesmo PR/deploy) |
| RLS M-8 — guarda RN-323 só pega `import` | Aplicado: guarda também do texto `fin_` |
| RLS M-9 — funções sem conferir o papel | Aplicado: §4.2, RN-300 |
| Normas I-1 / interface I7 / completude I-4 — textos ao paciente na exclusão | Aplicado: e-mails, `CONFIRMAR_EXCLUSAO`, §6.2, §10; textos ao advogado (E-09) |
| Normas I-2 — CSV "sem nomes" ainda identifica | Aplicado (opção a): descrição das entradas de pacientes vazia sem a opção |
| Normas I-3 — exportação sem descrição/categoria/motivo × art. 19, § 3º | Aplicado: os três entram, nos dois escopos; F-D22 revista |
| Normas M-1, M-2, M-3 — citações (Res. 594, art. 16, CC 206) | Aplicado: §10, F-D23, §16 |
| Normas M-4 — LEIA-ME inexistente | Aplicado: sem LEIA-ME; seção só no `dados.json` |
| Normas M-5 — sigilo do CSV com nomes | Aplicado: ajuda do CSV; F-P2 |
| Normas M-6 — redação do DPA 1.1 | Aplicado: "registros financeiros do consultório, inclusive os pagamentos dos pacientes"; ajuda da saída |
| Normas M-7 — editar lançamento de bloqueado | Aplicado: só receber, desfazer, reduzir e cancelar (módulo e gatilho); F-P1 |
| Normas M-8 — Res. 856, art. 68 | Aplicado: nota em §10 e no runbook (T11) |
| Interface I1 — CSV por GET sem lugar para o erro | Aplicado: validação no cliente; rota com redirect, nunca JSON (§4.1) |
| Interface I2 / completude M-2 — segundo caminho mudo | Aplicado: retornos de `registrarPresenca`/`registrarAtendimento`, mensagem no atendimento; "Registrar atendimento" |
| Interface I3 — linha que some leva a mensagem | Aplicado: região viva fixa, foco no h1, estado vazio do detalhe, destino pós-salvar |
| Interface I4 — "Ver todos" preso ao mês | Aplicado: RN-306 (todos os meses com paciente, teto 200) |
| Interface I5 — atraso de meses anteriores some | Aplicado: linha "Em atraso de meses anteriores" nos cartões |
| Interface I6 — guia, axe e testes de menu quebram o CI desde a primeira tela | Aplicado no plano: cada tela leva guia, `ROTAS_DO_PAINEL`, `TSX_FORA`, versões dos guias e testes |
| Interface I8 — rolagem não focável | Aplicado: §7 |
| Interface I9 — textos que faltam | Aplicado: "Data do saldo", "Valor do saldo", mensagens novas, links |
| Interface Minor 1 a 6, 8 a 12 | Aplicados (`STATUS_ATIVOS`, foco, `valores`, `<select>` de mês, totais da lista, SVG com tokens, h1 sem data, arquivados no seletor, axe do primeiro acesso, menu com 9 itens, `DPA_VERSAO_DATA`) |
| Interface Minor 7 — "Faltou" cancela sem confirmação e perde o valor | Sem efeito: a F-D19 revista não cancela mais (o valor fica) |
| Completude I-2 — F-D19 contraria a F-D7 aprovada | Aplicado: volta ao aprovado (avisa, não cancela); alternativa na F-P5 |
| Completude I-3 — aba × ficha do Plano 18 | Aplicado: seção no Início pelo registro (F-D18 acertada, US-308, RN-329) |
| Completude I-5 — §13 desatualizada | Aplicado: §13, R-301, R-302, R-309 |
| Completude M-1 — testes do DPA esquecidos | Aplicado: PM-F10 |
| Completude M-3 — fluxo no mês do saldo | Aplicado: US-306 (início "—", fim = saldo + movimentos desde a data) |
| Completude M-5 — erro do lançamento anonimizado | Aplicado: mensagem própria |
| Completude M-6 — numeração dos Planos 18 e 19 | Aplicado: cabeçalho |

Descartado: nada. Um achado foi aplicado só em parte (RLS M-6, acima), com o motivo registrado.

## 18. Ajustes da revisão do plano (17/11/2026)

A revisão do plano (executabilidade, banco e guardas, conflitos com os Planos 17, 18 e 19) trouxe à spec só ajustes técnicos; nenhuma regra aprovada mudou. Registro completo em "Revisão do plano", no fim do plano.

| Achado | Destino |
|---|---|
| DEP-F8 cita um texto da spec do Plano 18 que não existe mais (a RN-277 de lá proíbe `auditRead` nas seções) | DEP-F8 corrigida; US-308/RN-329 ficam como estão até a decisão abaixo |
| Ordem gatilho × RLS e `search_path` dos gatilhos (`revisor-rls`) | §9.4 |
| Anonimização antes do prazo (`revisor-rls`) | §9.4: a função exige também `anonimizar_apos` vencido |
| `fin_categorias` em `ULTIMAS` | §9.5: não entra (a filha está em `SEM_DELETE`) |
| Volta atrás com a imagem do PR 1 (`revisor-rls`) | R-314 |

**Pergunta 1 ao dono (bloqueia só a US-308):** a seção "Financeiro" no Início com `auditRead` (RN-318/RN-329) não cabe no contrato do registro do Plano 18. As saídas são: (a) o PR 1 do Plano 18 estende o contrato; ou (b) a seção fica sem `auditRead`, pelo precedente D17 do Plano 10A (só rótulo, data e situação), com "Ver todos" e "Nova entrada" por rotas da ficha que redirecionam. A (b) muda a RN-318/RN-329 e pede o OK do `normas-cfn-lgpd`. Recomendação: (b). Detalhes na T12 do plano.

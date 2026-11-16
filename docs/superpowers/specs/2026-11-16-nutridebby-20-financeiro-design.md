# NutriDebby — Financeiro do consultório (Plano 20) — Design

| Item | Valor |
|---|---|
| Versão | 0.1 |
| Data | 2026-11-16 |
| Status | **Aprovada para virar plano.** O dono aprovou em 16/11/2026 todas as recomendações da proposta ("aprovo todas as recomendações, pode seguir"): as decisões F-D1 a F-D12 e as respostas F-D13 a F-D18. As F-D19 a F-D30 são decisões minhas, tiradas da crítica de completude e conferidas no código; o dono pode corrigir qualquer uma. Conferida contra a `main` 5482450 (Planos 01–16 em produção, PR #45). Pareceres externos pendentes (advogado, CRN-3, contador) estão na §14 e não travam a v1 |
| Itens do backlog | Backlog "Paridade Dietbox", onda 1: **PD-30** (lançamentos, categorias, saldo inicial), **PD-31** (cobrança por consulta e pendências por paciente), **PD-32** (fluxo de caixa e entradas × saídas), **PD-33** (financeiro na ficha do paciente — última tarefa, depende do Plano 18) |
| Insumos | Proposta aprovada (`.sessoes/proposta-plano-20.json`: brief, crítica de completude, normas conferidas em 16/11/2026 e levantamento do código); referência funcional: o controle financeiro do Dietbox. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (D-02: financeiro do consultório na Fase 2; RN-06 fuso; RNF-08 LGPD; RNF-11 log; RNF-12 formatos), [`2026-10-08-nutridebby-app-paciente-g-design.md`](2026-10-08-nutridebby-app-paciente-g-design.md) (formato desta spec) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) (RLS, auditoria, guardas) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) (agenda, presença, manual guiado) |
| Numeração nova | US-300 a US-309 · RN-300 a RN-329 · RNF-300 a RNF-307 · CS-300 a CS-303 · R-300 a R-311 · DEP-F1 a DEP-F8 · PM-F1 a PM-F14 · **F-D1 a F-D30** (decisões deste documento; o prefixo "F-" evita colisão com as D dos planos e das outras specs, como "G-D" e "A-D"). O bloco **300** fica para o Plano 20 porque as specs dos Planos 18 e 19 estão sendo escritas em paralelo e devem tomar a numeração logo depois de 219 |

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
4. **Financeiro na ficha (PD-33).** Aba "Financeiro" no prontuário, com os lançamentos e as pendências do paciente.
   Entra por último, em cima da ficha nova do Plano 18 (F-D18).

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
| C-306 | **Sessões paralelas.** Planos 17 (`nutridebby-a`), 18 (`nutridebby-18`) e 19 (`nutridebby-b`) escrevem ao mesmo tempo; o Plano 17 já reserva `drizzle/0118_lembretes_rotina.sql` e `0119_rls_lembretes_rotina.sql` | Worktrees conferidos em 16/11/2026; §13 |
| C-307 | **Sem tocar em `tenants`.** Saldo inicial e valor da consulta ficam numa tabela própria; os gatilhos de colunas de `tenants` (`app_tenants_interruptores_da_admin`, `tenants_ia_nutri_da_equipe`) não mudam | F-D2 |

### 1.3 Dependências (conferidas no código em 16/11/2026, `main` 5482450)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-F1 | **Agenda (Plano 05)** | Consulta, situação, presença | ✅ `appointments` (`src/db/schema/agenda.ts:52`): status `agendada`, `confirmada`, `cancelada`, `realizada`, `faltou`; `patient_id` NOT NULL; `UNIQUE (tenant_id, patient_id, id)` (`appointments_tenant_paciente_id_unique`) — alvo da FK composta da cobrança. Nenhuma coluna de valor |
| DEP-F2 | **Presença (US-037)** | Primeiro caminho para "Realizada" | ✅ `registrarPresenca` (`src/modules/agenda/presenca.ts:31`): trava paciente (`FOR KEY SHARE`, `travarPacienteDaConsulta`) → consulta; aceita corrigir (`realizada` ↔ `faltou`), recusa `faltou` com atendimento ligado (`MSG_PRESENCA.temAtendimento`) e vale **também para paciente bloqueado ou anonimizado** (comentário "Rodada 1"). Chamado só por `presencaAction` (`src/app/painel/agenda/actions.ts:64`), a partir da tela da consulta. A página de pendências de presença (`src/app/painel/agenda/pendencias/page.tsx`) só lista e leva à consulta (conferido) |
| DEP-F3 | **Atendimento ligado à consulta (Plano 05)** | Segundo caminho para "Realizada" | ✅ `registrarAtendimento` (`src/modules/pacientes/atendimentos.ts:66`): com `appointmentId`, trava paciente (`carregarPacienteParaEscrita`, `FOR UPDATE`, recusa bloqueado e anonimizado) → consulta (`FOR UPDATE`) e, se `c.status !== 'realizada'`, grava `realizada` (linha 83) — inclusive a marcada como `faltou` por engano |
| DEP-F4 | **Cancelamento de consulta** | Saber se "consulta com cobrança cancelada" existe | ✅ Não existe: só consulta `agendada`/`confirmada` é cancelada (`STATUS_ATIVOS`, `src/modules/agenda/cancelamento.ts:40`), e a cobrança só nasce em `realizada`. O caso real é a **correção para Faltou** (F-D19) |
| DEP-F5 | **RLS e guardas** | Tabelas novas | ✅ `app_enable_tenant_rls`, `app_enable_patient_rls` (0000: com `patient_id` nulo, `NULL = app_current_patient()` não passa, então a sessão de paciente não vê a linha), `app_enable_staff_only` (0020), `app_enable_audit` (0007: `nullif` no `patient_id`, linha sem paciente é auditada sem paciente). Guardas `src/db/rls-guard.ts` (`STAFF_ONLY`), `src/db/audit-guard.ts`, `test/isolamento.test.ts` (`FABRICAS`, `COM_MAE`, `SEM_DELETE`, `DELETE_REVOGADO`, `IMUTAVEIS`, `SO_APAGA`, `ULTIMAS`) |
| DEP-F6 | **LGPD (US-018, US-046)** | Exportação e anonimização | ✅ `montarDados` (`src/modules/pacientes/exportacao-job.ts:318`: "todas as tabelas do paciente, menos as staff_only" — `ia_tarefas` entra por **inclusão explícita**, seção `ia`, linhas 198-203); motivo de cancelamento da nutricionista fora da exportação ("Só você vê", linhas 167-168). `anonimizarVencidos` (`src/modules/pacientes/lgpd.ts:481`) chama `app_anonimizar_aceites` e afins antes do UPDATE de `patients`; `anonimizarAgenda` (linha 457) limpa o texto livre e mantém a consulta |
| DEP-F7 | **DPA (US-002)** | Versão 1.1 com novo aceite | ✅ `DPA_VERSAO = '1.0'` (`src/modules/plataforma/dpa.ts:15`); mudar a versão leva a nutricionista a `/painel/dpa` (`requireNutri`) e as APIs do painel dão 403 até o aceite (`requireApiNutri`); `DPA_MUDOU` já existe. O aditivo de IA remete às cláusulas e à cláusula 8 do DPA: **a numeração das cláusulas não pode mudar** |
| DEP-F8 | **Ficha do paciente (Plano 18)** | Aba "Financeiro" (PD-33) | ⬜ A ficha atual (`src/app/painel/pacientes/[id]/abas.tsx`) tem 12 abas no limite de 1280 px (comentário das linhas 31-32). O Plano 18 reformula a ficha e ainda não está na `main`. A US-308 só começa depois do merge dele (F-D18) |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | Backlog |
|---|---|---|---|
| F-01 | **Configuração** (`/painel/financeiro/configuracoes`) | Primeiro acesso guiado; saldo do caixa com data; valor da consulta; categorias de entrada e de saída (renomear, arquivar, reativar, excluir sem uso, criar) | PD-30, PD-31 |
| F-02 | **Lançamentos** (`/painel/financeiro/lancamentos`) | Lista com filtros (mês, tipo, categoria, situação, forma de pagamento; paciente pelo link), totais, "Nova entrada", "Nova saída", editar, marcar recebido/pago, desfazer recebimento, cancelar com motivo | PD-30 |
| F-03 | **Cobrança da consulta** | Criada ao marcar "Realizada" (dois caminhos, F-D13); seção "Cobrança" na tela da consulta (valor, "Marcar como recebido", "Registrar cobrança" manual); efeito da correção para "Faltou" (F-D19) | PD-31 |
| F-04 | **Pagamentos pendentes** (`/painel/financeiro/pendencias`) | Lista por paciente (em aberto, quantidade, mais antiga, em atraso) e detalhe do paciente com "Marcar como recebido" | PD-31 |
| F-05 | **Resumo** (`/painel/financeiro`) | Cartões Saldo atual, Entradas do mês, Saídas do mês, Pagamentos pendentes; últimos lançamentos; avisos de configuração | PD-32 |
| F-06 | **Relatórios** (`/painel/financeiro/relatorios`) | Fluxo de caixa do ano; Entradas e saídas nos últimos 12 meses (tabela + barras); CSV dos lançamentos de um período e do fluxo do ano | PD-32 |
| F-07 | **LGPD e textos legais** | Seção `financeiro` no `dados.json` (inclusão explícita); anonimização (`app_anonimizar_financeiro`); texto da exclusão na aba Privacidade; rótulo "Financeiro" no Histórico de acessos; **DPA 1.1** com novo aceite | — |
| F-08 | **Menu e manual guiado** | Item "Financeiro" no menu do painel; guia `financeiro` (`data-guia`) nas telas novas | — |
| F-09 | **Aba "Financeiro" na ficha** | Lançamentos e pendências do paciente, "Nova entrada" com o paciente preenchido, `auditRead` ao abrir. **Última tarefa**, em cima do Plano 18 | PD-33 |

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
| **Nutricionista** (sessão `nutri`, DPA 1.1 aceito) | Tudo no Financeiro: configurar, lançar, editar, marcar recebido/pago, cancelar, ver relatórios, baixar CSV; criar e receber a cobrança na tela da consulta; ver a aba Financeiro da ficha | Apagar lançamento (não existe DELETE, F-D5); mudar tipo, paciente, consulta ou autor de um lançamento; alterar lançamento cancelado ou anonimizado; criar lançamento para paciente bloqueado ou anonimizado (F-D20) |
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
| Lançamentos | `/painel/financeiro/lancamentos` (`?mes=AAAA-MM&tipo=&categoria=&situacao=&forma=&paciente=`) | "Lançamentos" |
| Novo lançamento | `/painel/financeiro/lancamentos/novo?tipo=entrada|saida[&paciente=<id>]` | "Nova entrada" / "Nova saída" |
| Editar lançamento | `/painel/financeiro/lancamentos/[id]` | "Entrada de {dd/mm/aaaa}" / "Saída de {dd/mm/aaaa}" (data de referência, RN-306) |
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
- **Não colide** com `/painel/agenda/pendencias` (pendência de presença, US-037) nem mexe em `/painel/configuracoes`
  (hub disputado). O rótulo é **"Pagamentos pendentes"**, nunca só "Pendências" (F-D26).

### 4.2 Módulo

`src/modules/financeiro/` (todas as funções com `withTenant(ctx, …)`, `ctx` com `actorUserId` e `ip`):

| Arquivo | Conteúdo |
|---|---|
| `constantes.ts` | `MSG_FINANCEIRO` (textos da §6.2), `FORMAS_DE_PAGAMENTO` e rótulos, `CATEGORIAS_INICIAIS`, limites (`VALOR_MAX_CENTAVOS = 100_000_000`, `DESCRICAO_MAX = 200`, `MOTIVO_MAX = 200`, `NOME_CATEGORIA_MAX = 60`) |
| `dinheiro.ts` | `paraCentavos("1.250,00") → 125000` (sem `parseFloat`), `formatarReais(125000) → "R$ 1.250,00"` (pt-BR; o `Intl` usa espaço não separável depois de "R$" — os testes comparam com ele) |
| `situacao.ts` | `situacaoDoLancamento(l, hoje)` e `dataDeReferencia(l)` — puras (RN-305, RN-306) |
| `configuracoes.ts` | `lerConfiguracoes`, `salvarConfiguracoes` (primeira gravação semeia as categorias, F-D25), categorias |
| `lancamentos.ts` | `criarLancamento`, `editarLancamento`, `marcarRecebido`, `desfazerRecebimento`, `cancelarLancamento`, `listarLancamentos`, `abrirLancamento` |
| `cobranca.ts` | `cobrarConsultaRealizada(tx, …)` e `aoCorrigirParaFaltou(tx, …)` — **um lugar só**, chamado pelos dois caminhos na transação deles (F-D13, F-D19); `registrarCobrancaManual`; `cobrancaDaConsulta` |
| `resumo.ts` | `resumoDoMes`, `saldoAtual`, `fluxoDeCaixaDoAno`, `entradasESaidas12Meses`, `pagamentosPendentes`, `pendenciasDoPaciente` — agregação no SQL, uma transação por tela |
| `csv.ts` | Montagem do CSV (RN-321) — pura |
| `titular.ts` | `financeiroParaExportacao(tx, patientId, hoje)` (F-D22) |

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
  Quando informo "Saldo do caixa em" 01/11/2026, "Valor" R$ 1.500,00 e "Valor da consulta" R$ 250,00 e toco em "Salvar"
  Então vejo "Configurações salvas." (role="status")
  E as categorias iniciais existem (RN-302), com "Consultas" entre as de entrada
  E o Resumo mostra "Saldo atual" R$ 1.500,00 e "Desde o saldo de 01/11/2026"

Cenário: Sem valor da consulta
  Dado que salvei o saldo e deixei "Valor da consulta" vazio
  Então o Resumo mostra o aviso "O valor da consulta não está configurado: as consultas marcadas como Realizada não geram cobrança." com o link "Informar o valor da consulta"

Cenário: Saldo negativo
  Quando informo o saldo "-320,00"
  Então salva (conta no vermelho é saldo válido)

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
  Então vejo "Lançamento salvo."
  E o "Saldo atual" diminui R$ 1.200,00

Cenário: Nova entrada prevista de um paciente
  Quando toco em "Nova entrada", escolho o paciente "Ana Souza", R$ 250,00, "Consultas", vencimento 20/11/2026, sem marcar "Já foi recebido"
  Então o lançamento aparece como "Previsto"
  E "Ana Souza" aparece em "Pagamentos pendentes"

Cenário: Saída não tem paciente (RN-304)
  Quando abro "Nova saída"
  Então o formulário não tem o campo "Paciente"

Cenário: Aviso de saúde na descrição
  Então o campo "Descrição (opcional)" mostra a ajuda "Até 200 caracteres. Não escreva informações de saúde aqui."

Cenário: Pagamento no futuro
  Quando marco "Já foi recebido" com a data de amanhã (no fuso do consultório)
  Então vejo "A data do recebimento não pode ser depois de hoje."

Cenário: Forma de pagamento obrigatória no recebimento
  Quando marco "Já foi recebido" sem escolher a forma
  Então vejo "Escolha a forma de pagamento."

Cenário: Antes do saldo inicial
  Dado que o saldo do caixa é de 01/11/2026
  Quando salvo uma entrada recebida em 28/10/2026
  Então vejo, junto de "Lançamento salvo.", o aviso "Este lançamento é anterior ao saldo do caixa (01/11/2026) e não altera o saldo atual."

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
  E posso marcar como recebido, editar o valor e cancelar
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
  Quando registro o atendimento ligado a ela ("Iniciar atendimento")
  Então a consulta vira "Realizada" e a cobrança de R$ 250,00 é criada na mesma transação

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
  Então vejo "Presença registrada. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro."
  E a presença fica registrada

Cenário: Uma cobrança por consulta
  Dado que a consulta já tem cobrança ativa
  Quando duas abas registram "Registrar cobrança" ao mesmo tempo
  Então só uma cobrança existe e a outra aba vê "Esta consulta já tem uma cobrança."

Cenário: Correção para Faltou com cobrança em aberto (F-D19)
  Dado a consulta "Realizada" sem atendimento ligado e com cobrança em aberto
  Quando toco em "Faltou"
  Então vejo "Presença registrada. A cobrança desta consulta foi cancelada."
  E a cobrança fica "Cancelado" com o motivo "Consulta corrigida para Faltou."

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
  E só entram lançamentos recebidos ou pagos (o previsto não entra no fluxo)

Cenário: Entradas e saídas em 12 meses
  Então vejo as barras de entradas e saídas dos últimos 12 meses e a tabela "Mês · Entradas · Saídas · Resultado"
  E as barras têm aria-hidden="true" e a tabela é a alternativa em texto

Cenário: CSV dos lançamentos
  Quando escolho de 01/11/2026 a 30/11/2026, deixo "Incluir o nome dos pacientes" desmarcado e toco em "Baixar CSV"
  Então recebo "lancamentos-2026-11-01-a-2026-11-30.csv" sem a coluna "Paciente"
  E o audit_log ganha um "exportar" da entidade "financeiro" sem paciente

Cenário: CSV com nomes
  Quando marco "Incluir o nome dos pacientes"
  Então o arquivo tem a coluna "Paciente"
  E o Histórico de acessos de cada paciente presente no arquivo mostra "Exportou — Financeiro"

Cenário: Injeção de fórmula
  Dado uma descrição "=HIPERLINK(…)"
  Então a célula sai como "'=HIPERLINK(…)"

Cenário: Período longo
  Quando peço mais de 366 dias
  Então vejo "Escolha um período de até 12 meses."
```

#### US-307 — Financeiro na cópia dos dados e na exclusão · **M** (LGPD)

```gherkin
Cenário: Baixar meus dados
  Dado que "Ana Souza" tem duas cobranças (uma recebida, uma cancelada)
  Quando ela pede "Baixar meus dados" no portal
  Então o dados.json tem a seção "financeiro" com vencimento, pagamento, valor, forma de pagamento, situação e o início da consulta ligada
  E não tem a descrição, a categoria, o motivo do cancelamento nem quem lançou (F-D22)
  E a exportação da equipe tem a mesma seção

Cenário: Pedido de exclusão
  Quando atendo o pedido de exclusão de "Bruno Lima"
  Então as cobranças dele continuam como estavam (a pendência continua devida)
  E a aba Privacidade dizia antes, no texto da exclusão: "Os registros de pagamento do Financeiro ficam guardados como o prontuário, e as cobranças em aberto continuam valendo."

Cenário: Anonimização (F-D23)
  Quando o prazo de guarda vence e o job anonimiza "Bruno Lima"
  Então os lançamentos dele perdem a descrição e o motivo do cancelamento
  E a cobrança ainda em aberto vira "Cancelado", sem motivo
  E valor, datas, categoria e forma de pagamento ficam (os relatórios antigos não mudam)
  E nenhum lançamento dele pode mais ser alterado
```

#### US-308 — Aba "Financeiro" na ficha · **S** (PD-33, última tarefa)

```gherkin
Cenário: Aba na ficha nova (Plano 18)
  Quando abro a ficha de "Ana Souza" e a aba "Financeiro"
  Então vejo "Em aberto: R$ 500,00" e os lançamentos dela (data, descrição, valor, situação)
  E o botão "Nova entrada", que abre o formulário com "Ana Souza" escolhida
  E o Histórico de acessos registra "Visualizou — Financeiro" uma vez por abertura

Cenário: Paciente bloqueado
  Então a aba mostra os lançamentos e as pendências, sem "Nova entrada"
```

#### US-309 — DPA 1.1 · **S** (F-D17)

```gherkin
Cenário: Novo aceite
  Dado que aceitei o DPA 1.0
  Quando o Plano 20 vai ao ar e abro o painel
  Então sou levada a "/painel/dpa" com "O contrato de tratamento de dados mudou (versão 1.1, de {data}). Leia e aceite para continuar usando o painel."
  E vejo "O que mudou: o contrato passa a citar o registro de pagamentos das consultas (Financeiro)."
  E a cláusula 2 cita "registro de pagamentos das consultas"
  Quando marco "Li e aceito o contrato de tratamento de dados (DPA), versão 1.1" e confirmo
  Então volto ao painel e o aceite fica em consents ("dpa-1.1")
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-300 | **Acesso.** Só a sessão `nutri` (`requireNutri`/`requireApiNutri`, DPA em vigor) lê e grava o Financeiro. As três tabelas são `staff_only`; nada em `PUBLICO_LIBERADO` nem em `PACIENTE_ESCREVE`; o admin nunca consulta (F-D1) |
| RN-301 | **Configuração primeiro.** Sem a linha de `fin_configuracoes` do consultório, as telas mostram o primeiro acesso (US-300) e as ações de lançamento levam às Configurações. A cobrança automática (RN-310) não depende disso: sem configuração, não há valor, e a regra da F-D21 vale |
| RN-302 | **Categorias iniciais**, gravadas na mesma transação da **primeira** gravação de `fin_configuracoes` (`INSERT … ON CONFLICT DO NOTHING RETURNING`: só quem inseriu semeia; F-D25). Entradas: "Consultas" (chave `consultas`) e "Outras entradas". Saídas: "Aluguel e condomínio", "Contas de consumo (água, luz, internet, telefone)", "Material e insumos", "Equipamentos", "Software e assinaturas", "Divulgação", "Impostos e taxas", "Conselho e associações", "Cursos e eventos", "Outras saídas". Nenhuma leitura grava |
| RN-303 | **Categorias.** Nome de 1 a 60 caracteres, único por consultório e tipo (sem diferença de maiúsculas); tipo fixo depois de criada. Categoria com lançamento não se exclui (FK `NO ACTION`): arquiva-se (some dos formulários, fica nos lançamentos e relatórios). "Consultas" pode ser renomeada, nunca arquivada nem excluída. Arquivada pode voltar ("Reativar") |
| RN-304 | **Lançamento.** Tipo `entrada` ou `saida`; categoria do **mesmo tipo** (FK composta com o tipo); valor de R$ 0,01 a R$ 1.000.000,00 em centavos inteiros; vencimento obrigatório; data de recebimento/pagamento opcional (vazia = ainda não aconteceu), **nunca depois de hoje** no fuso do consultório; forma de pagamento obrigatória quando há data de recebimento/pagamento; descrição opcional de 1 a 200 caracteres. **Paciente só em entrada** e opcional; **consulta só com paciente** (F-D24). Datas entre 01/01/2000 e 31/12 de hoje + 5 anos (vencimento) |
| RN-305 | **Situação** (calculada, sem coluna; F-D4): `cancelado_em` preenchido → **Cancelado**; senão, data de pagamento preenchida → **Recebido** (entrada) / **Pago** (saída); senão, vencimento **antes de hoje** → **Em atraso**; senão (vencimento hoje ou depois) → **Previsto**. "Hoje" é sempre `hojeNoFuso(tenant.fuso)` |
| RN-306 | **Data de referência e mês.** Lançamento recebido/pago conta pelo **mês da data de pagamento**; lançamento em aberto, pelo **mês do vencimento**. O filtro "Mês" da lista, os cartões do Resumo e o título da tela de edição usam essa data. Cancelado entra na lista (filtro "Cancelado"), nunca nos totais |
| RN-307 | **Saldo atual** = saldo do caixa + Σ entradas recebidas − Σ saídas pagas, **não canceladas**, com data de pagamento **no dia do saldo ou depois** ("Saldo do caixa em dd/mm/aaaa" é o saldo no início desse dia). Lançamento pago antes dessa data aparece na lista e nos relatórios, mas não muda o saldo (aviso da US-301) |
| RN-308 | **Editar.** Enquanto não está cancelado nem anonimizado: valor, categoria (do mesmo tipo), vencimento, data de pagamento (inclusive apagar: "Desfazer recebimento"), forma e descrição. **Fixos** (gatilho, 42501): `id`, `tenant_id`, `tipo`, `patient_id`, `appointment_id`, `criado_por`, `created_at` (F-D5) |
| RN-309 | **Cancelar.** Pede motivo (1 a 200 caracteres); não tem volta; não existe DELETE (revogado). Pode cancelar lançamento recebido/pago (é assim que se registra uma devolução: o valor sai do saldo). O cancelamento grava `cancelado_em`, `cancelado_por` e o motivo |
| RN-310 | **Cobrança automática** (F-D13). Na transação que leva a consulta de outra situação para `realizada` — `registrarPresenca` e `registrarAtendimento` —, depois das travas deles (paciente → consulta), `cobrarConsultaRealizada` cria a entrada: categoria `consultas`, valor = valor da consulta, vencimento = data do início da consulta no fuso, paciente e consulta ligados, sem forma, sem descrição. **Não cria** quando: (a) não há valor da consulta configurado (F-D21); (b) o paciente está bloqueado ou anonimizado (F-D20); (c) a consulta já tem cobrança ativa (índice único; `ON CONFLICT DO NOTHING`). Consulta que já estava `realizada` não gera nada (sem retroativo) |
| RN-311 | **Pagamentos pendentes** = entradas **com paciente**, não canceladas e sem data de recebimento, **previstas ou em atraso** (F-D26). A lista agrupa por paciente: total em aberto, quantidade, vencimento mais antigo e o selo "Em atraso" se alguma estiver em atraso; ordem pelo vencimento mais antigo. Sem envio ao paciente |
| RN-312 | **Correção para Faltou** (F-D19). Em `registrarPresenca(…, 'faltou')` de uma consulta `realizada` (só sem atendimento ligado, regra atual), na mesma transação: cobrança ativa **em aberto** → cancelada com o motivo fixo "Consulta corrigida para Faltou." e `cancelado_por` = quem corrigiu; cobrança **recebida** → fica, e a tela avisa (US-303). Voltar para "Realizada" cria cobrança nova se não houver ativa (RN-310) |
| RN-313 | **Falta** não gera cobrança automática (F-D7). A nutricionista pode lançar uma entrada à mão para o paciente |
| RN-314 | **Registrar cobrança à mão** na tela da consulta: só consulta `realizada`, sem cobrança ativa, paciente nem bloqueado nem anonimizado e Financeiro configurado; valor sugerido = valor da consulta (editável, obrigatório) |
| RN-315 | **Paciente bloqueado** (pedido de exclusão atendido): nenhum lançamento **novo** com ele (módulo e gatilho); os existentes continuam valendo — marcar recebido, editar e cancelar com a trava própria do Financeiro (paciente `FOR KEY SHARE` → lançamento `FOR UPDATE`), **nunca** `carregarPacienteParaEscrita`, que recusa bloqueado (F-D20). **Anonimizado:** nada muda (RN-316) |
| RN-316 | **Anonimização** (F-D23). No `anonimizarVencidos`, antes do UPDATE de `patients`, `select app_anonimizar_financeiro(<paciente>)`: em todos os lançamentos do paciente, `descricao` e `motivo_cancelamento` → nulo e `anonimizado_em` → agora; os em aberto → cancelados (`cancelado_em` = agora, `cancelado_por` nulo, sem motivo). Valor, datas, categoria, forma, tipo e o vínculo com o paciente (agora anonimizado) ficam. Lançamento anonimizado não muda mais |
| RN-317 | **Ordem de travas:** paciente → consulta → lançamento (a mesma da agenda e do atendimento). Ações do Financeiro sem consulta: paciente (se houver) → lançamento. Configurações: linha de `fin_configuracoes` `FOR UPDATE` |
| RN-318 | **Leitura auditada** (F-D8). `auditRead(tx, { entidade: 'financeiro', entidadeId, patientId })` quando a tela devolve o financeiro de **um paciente identificado**: o detalhe "Pagamentos pendentes de {nome}", a lista de lançamentos filtrada por paciente, a tela de edição de um lançamento com paciente, a seção "Cobrança" da tela da consulta quando há cobrança, e a aba da ficha (US-308). **Sem** `auditRead`: Resumo, lista sem filtro de paciente, lista de pagamentos pendentes (nome, total, data), relatórios — como a agenda (Plano 05, D10) |
| RN-319 | **Escritas auditadas** pelo gatilho `audit_row_change` de `fin_lancamentos` (entidade `financeiro`, rótulo "Financeiro" no Histórico de acessos): "Criou", "Alterou" (inclusive o cancelamento e a anonimização, esta com ator nulo). O `audit_log` não guarda antes/depois (só quem, quando, o quê) |
| RN-320 | **Configurações** (saldo do caixa, valor da consulta): cada gravação grava também `recordAudit({ acao: 'alterar', entidade: 'financeiro_configuracoes', entidadeId: tenantId, patientId: null })` — fora do Histórico do paciente, disponível para o registro das operações (DPA, cláusula 12). Categorias sem trilha |
| RN-321 | **CSV** (F-D27). Separador `;`, UTF-8 com BOM, fim de linha CRLF, datas `dd/mm/aaaa`, valores com vírgula decimal e sem "R$". Lançamentos: "Vencimento;Pagamento;Tipo;Categoria;Descrição;[Paciente;]Forma de pagamento;Valor;Situação", com o período por data de referência (RN-306), até 366 dias, cancelados incluídos com a situação. Fluxo de caixa: as linhas da US-306 × meses. **Célula de texto** (descrição, categoria, paciente) que comece com `=`, `+`, `-`, `@`, tabulação ou CR ganha `'` na frente; números gerados pelo sistema não. Resposta `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`, só `requireApiNutri`. `recordAudit` `exportar` (entidade `financeiro`): uma linha por paciente presente quando "Incluir o nome dos pacientes" está marcado; uma linha sem paciente quando não está, e no CSV do fluxo |
| RN-322 | **Valores e textos fora de log** (regra 3; F-D9): valor, descrição, motivo, nome de paciente e categoria nunca vão para log, Sentry ou mensagem de erro; erro loga só o código e o motivo técnico |
| RN-323 | **Fora da IA.** Nenhum contexto de IA (leitura de exame, resumo do histórico, rascunho do plano, IA Nutri) lê as tabelas do Financeiro (guarda de importação, RNF-303) |
| RN-324 | **Valor da consulta** de R$ 0,01 a R$ 1.000.000,00, opcional; mudar o valor só vale para as cobranças criadas depois |
| RN-325 | **Saldo do caixa** de −R$ 10.000.000,00 a R$ 10.000.000,00, com data (até hoje); obrigatório na primeira configuração |
| RN-326 | **Formatos** (MVP RNF-12): "R$ 1.250,00" na tela (vírgula decimal, ponto de milhar); entrada aceita "1250", "1250,5", "1.250,50" e "R$ 1.250,50"; datas `dd/mm/aaaa`; valores de saída com "−" nos totais de resultado |
| RN-327 | **Menu.** "Financeiro" entre "Conteúdos" e "Configurações", para toda nutricionista, sem interruptor e sem contador (F-D1) |
| RN-328 | **Textos** em pt-BR, na constante `MSG_FINANCEIRO` (§6.2); entram na tabela "Textos de interface" das histórias no fechamento |
| RN-329 | **Aba da ficha** (US-308) mostra os lançamentos do paciente (todas as situações, mais recentes primeiro, até 100, com "Ver todos" para a lista filtrada) e o total em aberto; "Nova entrada" só sem bloqueio |

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
| `cartaoEntradas` | "Entradas de {mês}" · "Recebido {valor}" · "A receber {valor}" |
| `cartaoSaidas` | "Saídas de {mês}" · "Pago {valor}" · "A pagar {valor}" |
| `cartaoPendentes` | "Pagamentos pendentes" · "{n} paciente(s) · {valor}" · "Ver" · vazio: "Nenhum" |
| `ultimos` | "Últimos lançamentos" · "Ver todos os lançamentos" · vazio: "Nenhum lançamento ainda." |
| `novaEntrada` / `novaSaida` | "Nova entrada" / "Nova saída" |
| Campos | "Valor" · "Categoria" · "Vencimento" · "Paciente (opcional)" · "Descrição (opcional)" · "Já foi recebido" / "Já foi pago" · "Data do recebimento" / "Data do pagamento" · "Forma de pagamento" |
| `ajudaDescricao` | "Até 200 caracteres. Não escreva informações de saúde aqui." |
| `salvarEntrada` / `salvarSaida` | "Salvar entrada" / "Salvar saída" |
| Formas | "Pix" · "Dinheiro" · "Cartão de crédito" · "Cartão de débito" · "Transferência bancária" · "Boleto" · "Outra" |
| Situações | "Previsto" · "Em atraso" · "Recebido" · "Pago" · "Cancelado" |
| Filtros | "Mês" · "Tipo" ("Todos", "Entradas", "Saídas") · "Categoria" ("Todas") · "Situação" ("Todas", "Previsto", "Em atraso", "Recebido ou pago", "Cancelado") · "Forma de pagamento" ("Todas") · chip "Paciente: {nome}" com "Limpar" · "Filtrar" |
| `totaisDaLista` | "Entradas {valor} · Saídas {valor} · Resultado {valor}" (sem os cancelados) |
| `vazioDaLista` | "Nenhum lançamento neste filtro." |
| Ações | "Editar" · "Marcar como recebido" / "Marcar como pago" · "Desfazer recebimento" / "Desfazer pagamento" · "Cancelar lançamento" · "Motivo do cancelamento" · "Confirmar cancelamento" |
| `avisoCancelar` | "O lançamento cancelado não volta. Ele continua na lista, como Cancelado, e sai dos totais e do saldo." |
| Sucesso (`role="status"`) | "Lançamento salvo." · "Recebimento registrado." · "Pagamento registrado." · "Lançamento cancelado." · "Configurações salvas." |
| `antesDoSaldo` | "Este lançamento é anterior ao saldo do caixa ({dd/mm/aaaa}) e não altera o saldo atual." |
| Erros (`role="alert"`, junto do campo) | "Informe o valor." · "O valor deve ser de R$ 0,01 a R$ 1.000.000,00." · "Escolha a categoria." · "Informe o vencimento." · "Data inválida." · "A data do recebimento não pode ser depois de hoje." · "A data do pagamento não pode ser depois de hoje." · "Escolha a forma de pagamento." · "A descrição tem no máximo 200 caracteres." · "Informe o motivo do cancelamento." · "O motivo tem no máximo 200 caracteres." · "Este lançamento foi cancelado e não pode mais ser alterado." · "Paciente bloqueado por pedido de exclusão: não é possível criar lançamentos novos para ele." · "Esta consulta já tem uma cobrança." · "Escolha um período de até 12 meses." |
| Consulta: seção | h2 "Cobrança" · "{valor} · {situação}" · "Recebido em {dd/mm/aaaa} · {forma}" · "Salvar valor" · "Abrir no Financeiro" · "Esta consulta não tem cobrança." · "Registrar cobrança" · "Configure o Financeiro para registrar cobranças." · "Paciente bloqueado por pedido de exclusão: não é possível registrar cobrança nova." |
| Consulta: depois de "Realizada"/"Faltou" | "Presença registrada. Cobrança de {valor} criada no Financeiro." · "Presença registrada. A cobrança não foi criada: informe o valor da consulta nas configurações do Financeiro." · "Presença registrada. A cobrança desta consulta foi cancelada." · "Presença registrada. Esta consulta tem um pagamento recebido. Se for devolver o valor, cancele o lançamento no Financeiro." |
| Motivo automático | "Consulta corrigida para Faltou." |
| Edição: consulta ligada | "Cobrança da consulta de {dd/mm/aaaa}, {hh:mm}" (link para a consulta) |
| `pendentesIntro` | "Cobranças de pacientes ainda não recebidas. Esta lista é só sua: nada é enviado ao paciente." |
| Pendentes: linha | "{nome} · {valor} · {n} cobrança(s) · desde {dd/mm/aaaa}" + selo "Em atraso" · "Ver" · vazio: "Nenhum pagamento pendente." |
| `pendentesDoPaciente` | "Pagamentos pendentes de {nome}" · "Ver todos os lançamentos de {nome}" |
| `bloqueado` | "Paciente bloqueado por pedido de exclusão. As cobranças em aberto continuam valendo; não é possível criar cobranças novas." |
| Relatórios | "Ano" · "Fluxo de caixa de {ano}" · linhas "Saldo no início do mês", "Total de entradas", "Total de saídas", "Resultado do mês", "Saldo no fim do mês" · "Total" · nota "O saldo começa em {dd/mm/aaaa}. Antes dessa data, só as entradas e as saídas aparecem." · "Só entram os lançamentos recebidos ou pagos." · "Entradas e saídas nos últimos 12 meses" · colunas "Mês", "Entradas", "Saídas", "Resultado" |
| CSV | "Baixar CSV" · "De" · "Até" · "Incluir o nome dos pacientes" · ajuda: "Sem esta opção, o arquivo não identifica os pacientes. Com ela, o download fica registrado no Histórico de acessos de cada paciente." |
| Configurações | h2 "Saldo do caixa" · "Saldo em" · "Valor" · ajuda: "O saldo atual soma a este valor tudo o que foi recebido e pago a partir desta data." · h2 "Valor da consulta" · ajuda: "Sugerido em toda cobrança criada ao marcar a consulta como Realizada. Você pode mudar o valor em cada cobrança." · h2 "Categorias" · "Entradas" · "Saídas" · "Nova categoria" · "Renomear" · "Arquivar" · "Reativar" · "Excluir" · "Arquivada" · "Salvar" |
| Categorias: erros | "Já existe uma categoria com este nome." · "O nome tem de 1 a 60 caracteres." · "Esta categoria tem lançamentos e não pode ser excluída. Arquive-a para que não apareça nos formulários." · "A categoria Consultas é usada nas cobranças das consultas e não pode ser arquivada. Você pode mudar o nome dela." |
| Privacidade (exclusão) | acréscimo ao texto atual: "Os registros de pagamento do Financeiro ficam guardados como o prontuário, e as cobranças em aberto continuam valendo." |
| DPA | `DPA_O_QUE_MUDOU`: "O que mudou: o contrato passa a citar o registro de pagamentos das consultas (Financeiro)." |

Os textos do manual guiado (guia `financeiro`) ficam em rascunho até a revisão do `revisor-interface` e da Debby,
como nos planos anteriores.

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
"Cobranças", "Mais antiga", "Situação", "Ação". **Relatórios**: as duas tabelas com `caption`, `th scope`, a de fluxo
dentro de um contêiner com rolagem horizontal própria (a página não rola) e as barras em SVG com `aria-hidden="true"`.

Acessibilidade e foco: igual ao resto do painel (RNF-302).

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-300 | Privacidade em log | RN-322; teste que força erros no módulo e nas actions e confere que o logger e o `beforeSend` do Sentry não recebem valor, descrição, motivo, categoria nem nome (CS-302). Formulários do Financeiro fora dos breadcrumbs de entrada do Sentry (conferir `src/lib/sentry-filtro.ts`) |
| RNF-301 | Desempenho | Resumo, Lançamentos e Relatórios: p95 ≤ 800 ms (RNF-01) com 5.000 lançamentos por ano no consultório; cada tela em **uma** transação, agregação no SQL (`sum … filter`), somas em `bigint`, índices da §9; sem N+1 |
| RNF-302 | Acessibilidade | WCAG 2.1 AA (axe sem violação, claro e escuro, 1280 e 360 px): tabelas com `caption` e `th scope`; situação dita em texto (não só cor); barras `aria-hidden` com a tabela como alternativa; valores com "R$" no texto; mensagens em `role="status"`/`role="alert"` junto do campo; foco no h1 depois de salvar; alvos ≥ 44 px; navegação interna com `aria-current` |
| RNF-303 | Testes | (a) unidade: `paraCentavos`/`formatarReais`, `situacaoDoLancamento`, `dataDeReferencia`, CSV (injeção, BOM, separador); (b) integração (Testcontainers): RLS, `staff_only`, gatilho de regras (colunas fixas, cancelado não muda, anonimizado não muda, bloqueado não recebe novo, anonimização só pela função), DELETE/TRUNCATE revogados, FK de categoria com tipo, os dois caminhos da cobrança, a correção para Faltou (aberta e recebida), concorrência (duas transações cobrando a mesma consulta), bordas de fuso (CS-301), exportação e anonimização; (c) guarda: nenhum arquivo de `src/modules/ia/**` importa as tabelas do Financeiro (RN-323); (d) E2E: realizada → cobrança → recebido → Resumo (CS-300) e o primeiro acesso |
| RNF-304 | Exatidão | Centavos inteiros do formulário ao banco (nunca `float`); o `bigint` das somas volta como texto e vira `number` só abaixo de `Number.MAX_SAFE_INTEGER` (com o teto de valor, um consultório não chega lá); teste de propriedade CS-301 |
| RNF-305 | Fuso | Colunas `date`; "hoje" e mês por `tenants.fuso`; testes com o relógio na virada (00h00 e 23h59 em BRT, servidor em UTC) |
| RNF-306 | Dependências | Nenhuma dependência nova (C-303) |
| RNF-307 | Cache | Páginas do Financeiro com `dynamic = 'force-dynamic'` (como a agenda) e rotas CSV com `Cache-Control: no-store`; nada do Financeiro no service worker do portal |

---

## 9. Modelo de dados

Três tabelas novas, com `tenant_id`, num PR de fundação (F-D12). Migration gerada (`pnpm db:generate`) + migration
custom `rls_financeiro` (`pnpm drizzle-kit generate --custom --name rls_financeiro`), com `DATABASE_URL_MIGRATOR`
(regra 7). Número: **o próximo livre na hora do PR**, no mínimo **0120** (o Plano 17 reserva 0118 e 0119), gerado de
novo em cima da `main` (§13). Schema em `src/db/schema/financeiro.ts`, exportado em `src/db/schema/index.ts`.

### 9.1 `fin_configuracoes` (uma linha por consultório)

| Coluna | Tipo | Regras |
|---|---|---|
| `tenant_id` | `uuid` PK, FK `tenants(id)` | — |
| `saldo_inicial_centavos` | `integer not null` | CHECK `between -1000000000 and 1000000000` |
| `saldo_inicial_em` | `date not null` | CHECK `>= '2000-01-01'` (o "até hoje" é do módulo) |
| `valor_consulta_centavos` | `integer null` | CHECK `is null or between 1 and 100000000` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | — |

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
Gatilho pequeno: `tipo` e `chave` não mudam.

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

### 9.4 Migration custom `rls_financeiro`

```sql
SELECT app_enable_tenant_rls('fin_configuracoes');  SELECT app_enable_staff_only('fin_configuracoes');
SELECT app_enable_tenant_rls('fin_categorias');     SELECT app_enable_staff_only('fin_categorias');
SELECT app_enable_tenant_rls('fin_lancamentos');    SELECT app_enable_patient_rls('fin_lancamentos');
SELECT app_enable_staff_only('fin_lancamentos');    SELECT app_enable_audit('fin_lancamentos', 'financeiro');
REVOKE DELETE, TRUNCATE ON fin_lancamentos FROM nutri_app_role;
-- gatilhos fin_lancamentos_regras (BEFORE INSERT/UPDATE) e fin_categorias_fixas; função app_anonimizar_financeiro
```

**Gatilho `fin_lancamentos_regras`** (mensagens com `ERRCODE = '42501'`, como os de documentos e exames):

- INSERT: `cancelado_em`, `cancelado_por`, `motivo_cancelamento` e `anonimizado_em` nulos; com `patient_id`, o paciente
  não pode estar `bloqueado` nem anonimizado (defesa da RN-315); só a sessão `nutri` insere.
- UPDATE: `id`, `tenant_id`, `tipo`, `patient_id`, `appointment_id`, `criado_por`, `created_at` fixos (antes do
  `WITH CHECK` da RLS, por isso `IMUTAVEIS`); `OLD.anonimizado_em` preenchido → nada muda; `OLD.cancelado_em`
  preenchido → só a anonimização; a passagem de `anonimizado_em` de nulo a preenchido só com o papel `worker` **e** o
  marcador local `app.fin_anonimizando = '1'` (ligado só por `app_anonimizar_financeiro`, como o
  `app.ia_nutri_revogando` do Plano 15), mexendo só em `anonimizado_em`, `descricao`, `motivo_cancelamento`,
  `cancelado_em`, `cancelado_por` e `updated_at`; fora disso, só a sessão `nutri` altera.

**Função `app_anonimizar_financeiro(p_patient uuid)`** (molde da `app_anonimizar_aceites`, 0065): recusa fora do contexto
`worker` de um tenant e paciente que não esteja `bloqueado` com `anonimizado_em` nulo; liga o marcador local
(`set_config(…, true)`); faz o UPDATE da RN-316. `SECURITY INVOKER` basta (o UPDATE não é revogado e a RLS deixa o
worker); o `revisor-rls` confirma. `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role`.

### 9.5 Guardas e listas

| Lista | Entrada |
|---|---|
| `STAFF_ONLY` (`src/db/rls-guard.ts`) | `fin_configuracoes`, `fin_categorias`, `fin_lancamentos` — motivo: "Plano 20 (F-D1): financeiro do consultório — só a nutricionista; o titular recebe o que é dele pela exportação (inclusão explícita)" |
| `AUDIT_EXCEPTIONS` | nenhuma (só `fin_lancamentos` tem `patient_id`, e tem o gatilho) |
| `FABRICAS` (`test/isolamento.test.ts`) | as três; `fin_configuracoes` com `ON CONFLICT DO NOTHING` (a fábrica roda uma vez por paciente, duas por tenant); `fin_lancamentos` como entrada com paciente e sem consulta (FK anulável: a consulta fica de fora) |
| `COM_MAE` | `fin_lancamentos` (a categoria, FK NOT NULL, é criada no mesmo comando — regra 9 do CLAUDE.md) |
| `ULTIMAS` | `fin_categorias` (mãe com FK `NO ACTION`) |
| `SEM_DELETE` e `DELETE_REVOGADO` | `fin_lancamentos` |
| `IMUTAVEIS` | `fin_lancamentos` (o gatilho recusa mudar `tenant_id`/`patient_id` com 42501 antes da RLS) |
| `SO_APAGA` | `patients`: `and not exists (select 1 from fin_lancamentos f where f.tenant_id = patients.tenant_id and f.patient_id = patients.id)`; `fin_categorias`: só as sem lançamento |

### 9.6 O que não muda

`appointments`, `tenants`, `patients`, `stored_files` e o portal: nenhuma coluna nova (F-D2, F-D6, C-304, C-307).

---

## 10. LGPD

| Tema | Tratamento |
|---|---|
| Natureza do dado | Valor e data sozinhos não estão no art. 5º, II. Mas o lançamento que liga uma pessoa identificada a um consultório de nutrição revela o acompanhamento nutricional: tratamento que "revele" dado sensível (art. 11, § 1º). Por precaução, o lançamento com paciente é tratado como sensível — `staff_only`, auditado, fora de log (F-D1, F-D8, F-D9). **A conclusão é do advogado** (§14). Não é prontuário pela Res. CFN 594/2017, arts. 1º e 2º (o CRN-3 confirma) |
| Finalidade e base legal | Gestão financeira do consultório pela controladora (a nutricionista): execução do contrato com o paciente e obrigação legal fiscal (art. 7º, II e V; art. 11, II, "a" e "d" para o que revela saúde). O DPA 1.1 passa a citar a finalidade (F-D17) |
| Minimização | Sem nome, CPF ou dados de terceiro pagador; descrição curta com o aviso "Não escreva informações de saúde aqui." (art. 6º, III; F-D9); saída nunca tem paciente (F-D24); CSV sem nomes por padrão (F-D27) |
| Acesso pelo titular (art. 18, II; art. 19, II; termo 1.0, §13) | Seção **`financeiro`** no `dados.json`, nos **dois escopos** (titular e equipe), por **inclusão explícita** em `montarDados` — como `ia_tarefas` (seção `ia`, linhas 198-203) —, com o comentário "todas as tabelas do paciente, menos as staff_only" atualizado para citar a exceção. Campos: `vencimento`, `pagoEm`, `valorCentavos`, `valor` ("R$ 250,00"), `formaDePagamento` e `formaDePagamentoRotulo`, `situacao` e `situacaoRotulo` (no dia da exportação, no fuso), `consultaInicio` (ISO, se ligada), `canceladoEm`. **Não saem:** descrição, categoria, motivo do cancelamento e quem lançou — anotações e classificação da nutricionista, como o motivo de cancelamento dela na agenda ("Só você vê") e as notas privadas (F-D22). O LEIA-ME da exportação ganha uma linha sobre a seção |
| Pedido de exclusão (art. 18, VI) | O bloqueio não mexe no Financeiro: a pendência continua devida (art. 16, I; art. 11, II, "d") e os lançamentos ficam para a obrigação fiscal (CTN, arts. 173, I e 195, parágrafo único). Nenhum lançamento novo com o paciente (F-D20). O texto da exclusão na aba Privacidade ganha a frase da §6.2 |
| Guarda e anonimização | Segue o prontuário (F-D16): bloqueado com o paciente e anonimizado no `anonimizarVencidos` (20 anos do bloqueio), pela função `app_anonimizar_financeiro` (F-D23, RN-316): saem os textos livres, as cobranças em aberto viram canceladas, ficam valor, datas, categoria e forma (os relatórios antigos não mudam). Risco: guardar além do prazo fiscal se o CRN-3 disser que o financeiro não é prontuário (R-303) |
| IA | O Financeiro não entra em nenhum contexto de IA (RN-323) |
| Transparência | DPA 1.1 com novo aceite (F-D17, US-309). Termo do paciente: muda **na próxima revisão** ("registro de pagamentos das consultas" nas finalidades e no que fica guardado na exclusão), sem pedir novo aceite agora; a exportação já entrega o dado |
| Registro das operações (art. 37; DPA, cl. 6 e 12) | Escritas pelo gatilho; leituras de um paciente com `auditRead` (RN-318); downloads com `exportar` (RN-321); configurações com `recordAudit` (RN-320) |
| Portal e página pública | Nada (C-302) |

**Texto do DPA 1.1** (só as cláusulas 2 e 5 e a linha da versão mudam; a numeração fica, porque o aditivo de IA remete
a ela; a 1.0 fica em `DPA_TEXTOS` para quem aceitou nela, fora do objeto literal, como a 1.0 hoje):

- Cláusula 2, na lista de dados: "(cadastro, anamnese, medidas, exames, planos, diário, documentos, registros de acesso
  **e registro de pagamentos das consultas**)"; na lista de serviços: "(prontuário, agenda, lembretes, app do paciente,
  página de agendamento, documentos assinados, conteúdos, **financeiro do consultório** e as funções que a CONTROLADORA
  ativar)".
- Cláusula 5, no fim: "depois, os anexos são apagados e o cadastro, os aceites, os documentos **e os registros de
  pagamento** são anonimizados."
- "Versão 1.1, de {data do deploy}." Publicada pelo dono sem o advogado, como a 1.0 (na linha da A-D27); vai no
  pacote do advogado (E-09).

---

## 11. Boas práticas SBIS NGS1

1. **Trilha** (NGS1.07): escritas pelo gatilho `audit_row_change`, sem migration que o desligue; leituras de um
   paciente com `auditRead`; downloads com `exportar`; a anonimização aparece com ator nulo.
2. **Integridade do registro:** sem DELETE (revogado), cancelamento com motivo e sem volta, colunas fixas por gatilho,
   lançamento anonimizado imutável (F-D5, F-D23) — o padrão de documentos assinados e exames enviados.
3. **Controle de acesso** (NGS1.03): RLS por tenant, `staff_only`, `publico_negado`, sem papel novo; o admin não lê.
4. **Datas consistentes** (ECF.17.05): datas de calendário no fuso do consultório, "hoje" do servidor no fuso, nunca do
   aparelho; `cancelado_em` e as marcas de auditoria pelo relógio do banco.
5. **Autoria** (ECF.17.01): `criado_por` e `cancelado_por` gravados pela sessão; a cobrança automática leva como autora
   quem marcou "Realizada".

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-300 | Migrations em paralelo: o Plano 17 reserva 0118/0119, e os Planos 18 e 19 também vão gerar migrations; `_journal.json` e snapshots em conflito | PR de fundação pequeno e cedo (F-D12); migration **gerada de novo** em cima da `main` antes do PR (`docs/operacao/sessoes-paralelas.md`, §5 — PD-01, ainda no branch `docs/sessoes-paralelas`); uma migration por vez na fila de merge |
| R-301 | Conflito com o Plano 17 em `lgpd.ts`, `exportacao-job.ts`, `lgpd.test.ts`, `exportacao.test.ts`, `src/modules/agenda/fuso.ts`, `rls-guard.ts`, `audit-guard.ts`, `isolamento.test.ts`, `schema/index.ts` e `scripts/e2e-seed.ts` | A tarefa de LGPD (T8) espera o merge do Plano 17; helpers de mês no fuso ficam em `src/modules/financeiro/` (não em `fuso.ts`), reaproveitando `inicioDoMes`/`hojeNoFuso` sem editá-los |
| R-302 | Dependência do Plano 18: a aba (PD-33) mexe em `abas.tsx`/`layout.tsx`; a cobrança (T6) mexe em `atendimentos.ts` e na tela da consulta, que podem estar no escopo da ficha nova | Aba como última tarefa (F-D18); combinar a T6 com a sessão do Plano 18 antes de começar; a lógica da cobrança fica em `src/modules/financeiro/cobranca.ts`, e nos arquivos disputados entra só a chamada |
| R-303 | Pareceres podem mudar regras com o código pronto (advogado: guarda, DPA, pendência na exclusão; CRN-3: falta, preço, financeiro × prontuário) | As escolhas são as mais fáceis de reverter (guarda = a do prontuário; sem cobrança de falta; nada público); §14 |
| R-304 | Vazamento de dado sensível (valor, nome, descrição) em log, Sentry ou mensagem de erro | RN-322, RNF-300 com teste |
| R-305 | Descrição virando prontuário paralelo ("retorno pós-bariátrica") | 200 caracteres, aviso no campo, fora da exportação e limpa na anonimização |
| R-306 | Saldo inicial com data confunde (pagamento anterior não muda o saldo) | Aviso na hora de salvar (US-301) e nota nos relatórios |
| R-307 | Fuso: agrupar por instante em UTC desloca a virada do mês | Colunas `date`, "hoje" por `hojeNoFuso`, testes de borda (RNF-305) |
| R-308 | Cobrança duplicada por toque duplo ou duas abas | Índice único parcial + `ON CONFLICT DO NOTHING`; mensagem "Esta consulta já tem uma cobrança." |
| R-309 | O DPA 1.1 bloqueia o painel até o novo aceite: deploy em horário ruim interrompe a Debby; outro plano em paralelo pode também subir a versão do DPA | Avisar a Debby antes do deploy; aceite com um clique; combinar entre as sessões que **só o Plano 20** sobe o DPA nesta onda (se outro precisar, junta na 1.1 ou vira 1.2 na ordem dos merges) |
| R-310 | Menu do painel com até 9 itens (com "Exames recebidos" e "Dúvidas dos pacientes") pode não caber a 1280 px | `revisor-interface` mede a 1280 px e a 1024 px na T4; se não couber, o item vai para o hub "Configurações" só depois de decisão do dono |
| R-311 | Edição de lançamento recebido muda o valor sem guardar o antes (o `audit_log` não guarda antes/depois) | Aceito na v1: o "Alterou — Financeiro" mostra quem e quando; o CSV mensal guardado pela nutricionista é o comprovante (CTN, art. 195); "antes/depois" fica no backlog se o contador pedir |

Também: CI em fila no runner único (cerca de 30 min por PR) com três sessões disputando CPU com a produção — a revisão
pesada é escalonada; e **não exigir snapshot** antes da migration em produção (o snapshot da Hostinger congela a VPS,
CLAUDE.md do servidor): migration só aditiva e o backup restic diário.

---

## 13. Conflitos com sessões paralelas

| Sessão | Worktree / branch | Arquivos em comum com o Plano 20 | Como evitar |
|---|---|---|---|
| Plano 17 — lembretes de rotina | `nutridebby-a` / `plano-17-lembretes-rotina` (P17-01 já commitado) | `drizzle/` (0118, 0119, journal, snapshots), `src/db/schema/index.ts`, `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `lgpd.ts`, `exportacao-job.ts` e testes, `src/modules/agenda/fuso.ts`, `scripts/e2e-seed.ts`, `CLAUDE.md` (regras 1, 2, 8) | Fundação do Plano 20 a partir da 0120 (ou a próxima livre), gerada de novo depois do merge do P17-01; T8 depois do merge do Plano 17; sem editar `fuso.ts` |
| Plano 18 — ficha e cadastro | `nutridebby-18` / `plano-18-ficha-cadastro` | `abas.tsx`, `layout.tsx` da ficha, `privacidade/page.tsx`, possivelmente `atendimentos.ts` e a tela da consulta, `drizzle/`, guardas | US-308 (aba) por último, depois do merge; combinar a T6 e o texto da Privacidade com a sessão do Plano 18 |
| Plano 19 — plano alimentar 2 | `nutridebby-b` / `plano-19-plano-alimentar-2` | `drizzle/`, `schema/index.ts`, guardas, `isolamento.test.ts`, `navegacao.ts`/`menu-painel.tsx` (se mexer no menu), `src/app/painel/ajuda`, `CLAUDE.md` | Uma migration por vez na fila; entradas novas nas listas em linhas separadas (conflito de merge pequeno) |
| Todas | — | `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`), `src/modules/plataforma/dpa.ts`, `docs/manual-tecnico/README.md`, `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` | Rótulo novo numa linha só; DPA só pelo Plano 20 nesta onda (R-309); manuais e índice no fechamento, rebaseados |

---

## 14. Decisões

### 14.1 Decisões aprovadas pelo dono (16/11/2026, "aprovo todas as recomendações, pode seguir")

F-D1 a F-D12 são as decisões propostas na proposta; as marcadas "acertada" foram corrigidas pela crítica de completude,
conferida no código, sem mudar o que o dono aprovou.

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| F-D1 | **Só a nutricionista vê o Financeiro.** Três tabelas `staff_only`, nada em `PUBLICO_LIBERADO`/`PACIENTE_ESCREVE`, admin nunca consulta; item no menu para toda nutricionista, sem interruptor. *Acertada:* o paciente não vê as linhas no app, mas recebe o que é dele pela cópia "Baixar meus dados" (F-D22) | O lançamento com paciente revela o acompanhamento (LGPD, art. 11, § 1º) e está sob sigilo (Res. CFN 599, art. 20); um interruptor mexeria em `tenants` sem ganho | RN-300, RN-327, §3 |
| F-D2 | **Saldo inicial e valor da consulta em `fin_configuracoes`**, não em `tenants` | `tenants` tem gatilhos de colunas e é disputado; tabela própria fica isolada | §9.1, C-307 |
| F-D3 | **Centavos inteiros; datas `date` no fuso do consultório** | Sem erro de arredondamento; o mês não muda com o relógio UTC da VPS | RN-304, RNF-304, RNF-305 |
| F-D4 | **Situação calculada, sem coluna.** *Acertada:* Previsto = vencimento hoje ou depois; Em atraso = antes de hoje; "hoje" no fuso; recebido conta pelo mês do pagamento e em aberto pelo do vencimento | Status gravado poderia contradizer as datas; a crítica mostrou a sobreposição da regra original | RN-305, RN-306 |
| F-D5 | **Não há DELETE: cancelar com motivo, sem volta**; tipo, paciente, consulta e autor fixos | Prova dos lançamentos (CTN, art. 195, parágrafo único), meta SBIS e o padrão de documentos e exames | RN-308, RN-309, §9.4 |
| F-D6 | **Cobrança ligada à consulta por colunas em `fin_lancamentos`** (FK composta para `appointments(tenant_id, patient_id, id)`, índice único parcial: uma cobrança ativa por consulta); nada muda em `appointments` | A FK garante que a cobrança é do paciente da consulta; não mexer na agenda evita conflito | §9.3 |
| F-D7 | **Falta não gera cobrança automática**; a nutricionista lança à mão. *Acertada:* "consulta com cobrança cancelada" não acontece (só agendada/confirmada se cancela, `cancelamento.ts:40`); o caso real é a correção para Faltou (F-D19) | Cobrar falta depende do CRN-3 (Res. 856, art. 65) | RN-313 |
| F-D8 | **Auditoria:** gatilho em `fin_lancamentos` (entidade `financeiro`, rótulo "Financeiro"); `auditRead` só nas telas de um paciente; sem `auditRead` em Resumo, relatórios e lista de pendências; CSV grava `exportar`. *Acertada:* a regra cobre também a lista filtrada por paciente, a edição de lançamento com paciente e a seção "Cobrança" da consulta | Mantém verdadeira a promessa do DPA (cl. 6 e 12) sem encher o Histórico | RN-318 a RN-321 |
| F-D9 | **Minimização:** sem dados de terceiro pagador; descrição de até 200 com aviso; nada em log | LGPD, art. 6º, III; regra 3 | RN-304, RN-322 |
| F-D10 | **Gráficos em SVG/CSS e CSV em rota do painel; sem PDF, sem biblioteca, sem comprovante** | YAGNI; regra 9 | C-303, C-304 |
| F-D11 | **Rotas em `/painel/financeiro/…`**, com as configurações dentro do módulo | Não colide com `/painel/agenda/pendencias` nem com o hub de Configurações | §4.1 |
| F-D12 | **Ordem de entrega:** PR 1 de fundação (tabelas, migrations, guardas), mergeado antes; depois módulos e telas; a aba da ficha por último | Regra das sessões paralelas e dependência do Plano 18 | §15 |
| F-D13 | **A cobrança nasce ao marcar "Realizada"**, pelos **dois caminhos** (`registrarPresenca` e o registro do atendimento ligado), numa função só do módulo financeiro chamada na transação deles; valor padrão editável | Cobra o que foi atendido, sem esquecer consulta e sem cobrar o que não aconteceu; a crítica achou o segundo caminho (`atendimentos.ts:83`) | RN-310, US-303 |
| F-D14 | **Uma conta só** (caixa do consultório), forma de pagamento em cada lançamento | Várias contas = tabela, transferências e telas a mais; dá para evoluir | §2.2 |
| F-D15 | **Um valor padrão único da consulta** | Menor esforço; cada cobrança se ajusta | RN-324 |
| F-D16 | **Financeiro do paciente guardado como o prontuário e anonimizado junto** | Usa a anonimização que existe; o advogado confirma | RN-316, §10 |
| F-D17 | **DPA 1.1 agora, com novo aceite** ("registro de pagamentos das consultas"); **termo do paciente depois** | O DPA lista as categorias de dados; o fluxo de novo aceite existe; novo aceite de todos os pacientes geraria atrito | US-309, §10 |
| F-D18 | **A aba "Financeiro" na ficha espera o Plano 18 e entra como última tarefa** | Evita refazer e brigar por `abas.tsx`/`layout.tsx` | US-308, §15 |

### 14.2 Decisões minhas, da crítica de completude (o dono pode corrigir)

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| F-D19 | **Correção de "Realizada" para "Faltou":** cobrança em aberto é cancelada na mesma transação com o motivo fixo "Consulta corrigida para Faltou."; cobrança recebida fica, com aviso para cancelar à mão se for devolver | Cancelar a aberta evita cobrar o que não houve (Res. 856, art. 65); não barrar a correção da agenda nem desfazer dinheiro recebido sem a nutricionista decidir | RN-312, US-303 |
| F-D20 | **Paciente bloqueado ou anonimizado:** a cobrança automática não nasce e nenhum lançamento novo é aceito (módulo e gatilho); os lançamentos do bloqueado seguem recebíveis, editáveis e canceláveis com trava própria (não `carregarPacienteParaEscrita`); os do anonimizado não mudam | Depois do pedido de exclusão nada novo é registrado sobre ele (JUR-01: o bloqueio é o último registro), mas a pendência continua devida; `registrarPresenca` aceita esses pacientes e `carregarPacienteParaEscrita` os recusa | RN-310, RN-315 |
| F-D21 | **Sem valor da consulta configurado: não cria e avisa**; **sem criação retroativa** das consultas realizadas antes; "Registrar cobrança" à mão na tela da consulta realizada sem cobrança | O `CHECK valor > 0` impede cobrança de zero; retroativo inflaria ou esvaziaria as pendências sem a nutricionista ver; o botão manual cobre o caso a caso | RN-310, RN-314, US-300, US-303 |
| F-D22 | **Exportação por inclusão explícita**, nos dois escopos, sem descrição, categoria, motivo e autor | `montarDados` exclui as `staff_only`; o termo promete a cópia; anotações da nutricionista não saem (precedente da agenda) | §10, US-307 |
| F-D23 | **Anonimização por `app_anonimizar_financeiro`** (contexto `worker`, marcador local), que limpa os textos, cancela as cobranças em aberto e marca `anonimizado_em`; lançamento anonimizado não muda | O gatilho que trava o cancelado barraria a limpeza; ponto único, como `app_anonimizar_aceites` e `app_ia_nutri_revogar`; depois de 20 anos a cobrança de honorários já prescreveu (Código Civil, art. 206, § 5º, II — a conferir com o advogado) e não pode ficar "em atraso" para sempre | RN-316, §9.4 |
| F-D24 | **Coerência no banco:** saída sem paciente; consulta só com paciente (fecha o furo do `MATCH SIMPLE`); categoria do mesmo tipo do lançamento pela FK composta com o tipo | O banco garante o que a tela promete | §9.3 |
| F-D25 | **Configuração e categorias nascem na primeira gravação** (primeiro acesso guiado), nunca numa leitura nem na criação da conta (`contas.ts` intacto); "Consultas" é categoria de sistema (chave), renomeável e não arquivável | Página que grava na leitura é efeito escondido; a cobrança automática precisa de uma categoria certa | RN-301 a RN-303 |
| F-D26 | **Rótulo "Pagamentos pendentes"** (nunca só "Pendências") e pendência = entrada com paciente em aberto, **prevista ou em atraso**, com o selo "Em atraso" | A Agenda já tem "Pendências" (presença); a cobrança da consulta vence no dia e o "a vencer" também é dinheiro a receber do paciente | RN-311, §4.1 |
| F-D27 | **CSV:** primeira exportação CSV do app, com neutralização de fórmula, `no-store`, só sessão `nutri`; **nome do paciente só se marcado** (desmarcado por padrão) e `exportar` por paciente presente | O contador quase sempre precisa só dos totais; o nome no arquivo sai do controle do sistema, então fica registrado no Histórico de cada paciente | RN-321, US-306 |
| F-D28 | **Começo a partir do Dietbox à mão:** saldo do caixa na data da virada e as pendências abertas como entradas previstas por paciente; sem importação de planilha | A importação seria uma tarefa a mais e um formato que não controlamos; são poucas dezenas de pendências (a Debby tinha 43) | §2.2, runbook do fechamento |
| F-D29 | **Saldo do caixa no início do dia informado**; pagamento anterior não muda o saldo, com aviso na tela e nota nos relatórios | Define sem ambiguidade o que entra no saldo | RN-307, US-301, US-306 |
| F-D30 | **Configurações com trilha própria sem paciente** (`recordAudit`, entidade `financeiro_configuracoes`); categorias sem trilha | O saldo inicial muda todos os totais e deve ter quem e quando; categoria é rótulo | RN-320 |

### 14.3 Pendências externas ★ (não travam a v1)

| ID | Para quem | Pergunta | Efeito se a resposta for outra |
|---|---|---|---|
| F-P1 ★ | Advogado (E-09) | O lançamento com paciente é sensível pelo art. 11, § 1º? Base legal? Guarda A (prontuário) ou B (prazo fiscal)? Destino da pendência na exclusão? DPA 1.1 basta? Cobrança por WhatsApp/e-mail é possível? | Guarda B = rotina própria de desvinculação (≈ 1 tarefa); cobrança ao paciente = plano novo |
| F-P2 ★ | CRN-3 | O financeiro integra o prontuário (Res. 594, art. 2º, "administrativas")? Cobrar falta (Res. 856, art. 65)? Mostrar o preço na página pública antes de 23/01/2027? | Cobrança de falta automática; preço na página pública; guarda |
| F-P3 ★ | Contador | Prazo fiscal exato (pessoa física com carnê-leão ou CNPJ), colunas do CSV, NFS-e e livro-caixa | Ajuste das colunas do CSV |
| F-P4 ★ | Dono + Debby | Textos do manual guiado e da Central de Ajuda do Financeiro | Só texto |

---

## 15. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-F1 | **T1 — Fundação** (PR próprio, mergeado antes): schema, migrations (§9), gatilhos, função de anonimização, listas das guardas (§9.5), testes de banco. Revisor: `revisor-rls` |
| PM-F2 | **T2 — Configurações e lançamentos** (`configuracoes.ts`, `lancamentos.ts`, `dinheiro.ts`, `situacao.ts`), com Testcontainers |
| PM-F3 | **T3 — Agregados** (`resumo.ts`): saldo, mês, fluxo do ano, 12 meses, pendências; testes de borda de fuso e de propriedade (CS-301) |
| PM-F4 | **T4 — Telas Resumo, Lançamentos, formulários** e item "Financeiro" no menu (medir a largura, R-310). Revisor: `revisor-interface` |
| PM-F5 | **T5 — Configurações do Financeiro** e primeiro acesso guiado |
| PM-F6 | **T6 — Cobrança por consulta**: `cobranca.ts`; chamadas em `registrarPresenca` (que passa a precisar do fuso: ler `tenants.fuso` na transação ou receber o tenant) e em `registrarAtendimento`; seção "Cobrança" e mensagens na tela da consulta (`?ok=presenca&cobranca=criada|sem_valor|cancelada|recebida`); **combinar antes com a sessão do Plano 18** |
| PM-F7 | **T7 — Pagamentos pendentes e Relatórios + CSV** (rotas `requireApiNutri`, `exportar`) |
| PM-F8 | **T8 — LGPD:** seção `financeiro` no `dados.json` e no LEIA-ME, `app_anonimizar_financeiro` em `anonimizarVencidos` (antes do UPDATE de `patients`), frase da exclusão na Privacidade, `ENTIDADE_ROTULO.financeiro = 'Financeiro'`. **Depois do merge do Plano 17.** Revisores: `normas-cfn-lgpd` e `revisor-rls` |
| PM-F9 | **T9 — DPA 1.1** (`DPA_VERSAO`, `DPA_VERSAO_DATA`, cláusulas 2 e 5, `DPA_O_QUE_MUDOU` em `/painel/dpa`, a 1.0 mantida no mapa); os testes que fixam '1.0' (`src/app/painel/actions.test.ts`, `src/lib/tenant-session.test.ts`); o `scripts/e2e-seed.ts` já usa a constante. Revisor: `normas-cfn-lgpd` |
| PM-F10 | **T10 — Fechamento parcial:** guia `financeiro` do manual guiado (`src/modules/ajuda/conteudo.ts`, `data-guia` nas telas), semente do E2E e o fluxo Playwright (CS-300), CLAUDE.md (regras 1, 2 e 8: `fin_*` em `STAFF_ONLY`, `SEM_DELETE`, `IMUTAVEIS`; a função `app_anonimizar_financeiro` e o marcador local; a entidade `financeiro`), manual técnico (capítulo novo, número na hora), manual do usuário (Docs) e Central de Ajuda (`guardiao-manual`), runbook do começo (F-D28) e do aviso à Debby antes do deploy (R-309) |
| PM-F11 | **T11 — Aba "Financeiro" na ficha** (US-308), **última**, depois do merge do Plano 18; atualiza os manuais da T10 |
| PM-F12 | Conferir `src/lib/sentry-filtro.ts` para os formulários do Financeiro (RNF-300) |
| PM-F13 | A guarda de importação da RN-323 (`src/modules/ia/**` não importa `financeiro`), no estilo das guardas de grafo de `exportacao.test.ts` |
| PM-F14 | Agentes nas revisões: `revisor-rls` (T1, T2, T6, T8), `normas-cfn-lgpd` (T8, T9), `revisor-interface` (T4–T7, T11), `guardiao-manual` (T10, T11) |

---

## 16. Referências

- Proposta aprovada: `/home/deploy/servidor/projetos/.sessoes/proposta-plano-20.json` (brief, crítica, normas e levantamento, 16/11/2026).
- Código: `src/db/schema/agenda.ts`, `src/modules/agenda/presenca.ts`, `src/modules/agenda/cancelamento.ts`, `src/modules/pacientes/atendimentos.ts`, `src/modules/pacientes/base.ts`, `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/plataforma/audit.ts`, `src/modules/plataforma/dpa.ts`, `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `src/app/painel/navegacao.ts`, `src/app/painel/agenda/consultas/[id]/page.tsx`, `src/app/painel/pacientes/[id]/abas.tsx`, `drizzle/0000`, `0007`, `0020`, `0065`, `0091`.
- LGPD (Lei 13.709/2018), arts. 5º, 6º, 7º, 9º, 11, 15, 16, 18, 19, 37 e 46: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm (conferida em 16/11/2026).
- Res. CFN 594/2017, arts. 1º, 2º e 3º, VI: https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm; Res. CFN 599/2018, arts. 20, 51 e 57: https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html; Res. CFN 856/2026, arts. 23, 65 e 68 (compilação não oficial, LegisWeb; vigência a conferir no DOU) — conferidas em 16/11/2026.
- CTN, arts. 173, I e 195, parágrafo único; CDC, arts. 42 e 42-A; Código Civil, arts. 319 e 320 (Planalto, conferidos em 16/11/2026). Código Civil, art. 206, § 5º, II (prescrição dos honorários de profissional liberal, citado na F-D23): não aberto nesta spec — a conferir.
- CFN sobre o Receita Saúde: https://cfn.org.br/sobre-a-exigencia-do-nutricionista-no-sistema-receita-saude/.
- SBIS — Manual de Certificação para S-RES, nível NGS1 (NGS1.03, NGS1.07, ECF.17.01, ECF.17.05).

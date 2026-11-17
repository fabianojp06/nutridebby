# Runbook do dono — Financeiro do consultório (Plano 20)

Origem: spec [`2026-11-16-nutridebby-20-financeiro-design.md`](../superpowers/specs/2026-11-16-nutridebby-20-financeiro-design.md)
(v0.2) e plano [`2026-11-16-nutridebby-20-financeiro.md`](../superpowers/plans/2026-11-16-nutridebby-20-financeiro.md)
(Tarefa 11). Entrega em três PRs: **PR 1** (fundação: tabelas, RLS, gatilhos e guardas, PR #53), **PR 2** (o Financeiro
inteiro, com a LGPD e o DPA 1.1 no mesmo deploy, R-313) e **PR 3** (seção "Financeiro" no Início da ficha, T12).

O Financeiro é **só da nutricionista**: nada vai ao paciente (nem portal, nem página pública, nem WhatsApp ou e-mail
sobre valores). Toda consulta marcada como **Realizada** gera a cobrança com o valor da consulta configurado; o que não
foi recebido fica em **Pagamentos pendentes**.

---

## 1. Antes do merge do PR 2 (merge = deploy)

O PR 2 sobe o **DPA para a versão 1.1** (F-D17, US-309). Depois do deploy, toda nutricionista é levada a `/painel/dpa`
e **o painel fica travado até o novo aceite** (R-309). Nesta onda, só o Plano 20 sobe a versão do DPA (decisão da
orquestradora).

1. **Conferir `DPA_VERSAO_DATA`.** Hoje o código diz `DPA_VERSAO_DATA = '2026-11-17'`
   (`src/modules/plataforma/dpa.ts`, com o teste em `src/modules/plataforma/textos-legais.test.ts`). A data aparece no
   aviso "O contrato de tratamento de dados mudou (versão 1.1, de 17/11/2026). Leia e aceite para continuar usando o
   painel." Se o deploy for em **outro dia**, trocar a data nos dois arquivos (um commit no PR, CI verde) **antes** do
   merge. A data é a do dia em que a versão passa a valer, não a do commit.
2. **Avisar a Debby antes do deploy**, combinando um horário fora das consultas. Texto sugerido: "Hoje às {hora} entra o
   Financeiro no NutriDebby. Na primeira vez que você abrir o painel depois disso, ele vai pedir para aceitar o contrato
   de tratamento de dados novo (versão 1.1, que passa a citar os registros financeiros do consultório, inclusive os
   pagamentos dos pacientes). É só marcar 'Li e aceito o contrato de tratamento de dados (DPA), versão 1.1' e confirmar:
   enquanto não aceitar, o painel fica parado nessa tela." O app do paciente não muda nem pede aceite novo.
3. **Snapshot (regra 5 do servidor).** Atenção ao aviso de 06/11/2026: até a Hostinger resolver, o snapshot **congela a
   VPS** e exige reboot manual. Não tirar snapshot com a produção no ar sem o dono decidir. O PR 2 **não tem migration**
   (as tabelas vieram no PR 1): a volta atrás é de imagem, com uma ressalva do DPA — depois que alguém aceitou a 1.1, a
   imagem antiga trava o painel (ver §6, "Volta atrás e DPA (#149)").
4. **Aviso às outras sessões (R-312).** Depois do PR 2, todo "Realizada" no consultório do E2E cria cobrança, e essa
   consulta nunca mais sai da semente (a semente a deixa `cancelada`, porque `fin_lancamentos` não se apaga e a FK é
   `NO ACTION`). Nenhum E2E pode esperar a agenda do consultório do E2E vazia.
5. **OK explícito do dono no PR** (merge = deploy). Depois do deploy, conferir que a Debby aceitou o DPA 1.1 (a conta dela
   volta ao painel normalmente) e que o item "Financeiro" aparece no menu entre "Conteúdos" e "Configurações".

## 2. Começo a partir do Dietbox (F-D28)

Não há importação de planilha: o começo é à mão, com poucos dados (a Debby tinha 43 pendências). Fazer com a Debby, de
preferência no primeiro dia útil do mês (a data da virada vira o começo do fluxo de caixa).

1. **Escolher a data da virada** (ex.: 01/12/2026). Antes dela, o NutriDebby não tem movimento: os relatórios mostram
   "O saldo começa em {data}. Antes dessa data, só as entradas e as saídas aparecem."
2. **Saldo do caixa na data da virada.** No Dietbox, anotar o saldo do caixa no fim do dia anterior à virada (conferir
   com o extrato do banco e o dinheiro em espécie). No NutriDebby: **Financeiro → "Configurar o Financeiro"**, "Data do
   saldo" = a data da virada, "Valor do saldo" = o saldo anotado (pode ser negativo), "Valor da consulta" = o valor
   cobrado hoje; **Salvar**. As categorias iniciais nascem nessa hora (Configurações → "Categorias": dá para renomear,
   arquivar e criar; "Consultas" não arquiva, só muda de nome).
3. **Pendências abertas como entradas previstas, por paciente.** Para cada pendência aberta no Dietbox: **"Nova
   entrada"**, "Paciente (opcional)" = o paciente, "Categoria" = "Consultas" (ou outra), "Valor", "Vencimento" = a data
   original da cobrança, **sem** marcar "Já foi recebido". Vale também para pacientes **arquivados** (aparecem no
   seletor com "(arquivado)"); paciente **bloqueado** por pedido de exclusão não aparece, e não é possível criar
   lançamento novo para ele — anotar à parte e falar com o dono. A pendência com vencimento antes da virada fica "Em atraso"
   e salva sem aviso: em aberto, ela não mexe no saldo; entra nele quando for recebida (a data do recebimento é depois
   da virada). O aviso "Este lançamento é anterior ao saldo do caixa ({data}) e não altera o saldo atual." só aparece
   num lançamento **já recebido ou pago** com a data do recebimento ou do pagamento antes da data do saldo — se ele
   aparecer aqui, a pendência foi marcada como recebida por engano (ou é histórico já pago, que não se lança: passo 4).
4. **Não lançar o histórico já pago.** O que já foi recebido ou pago antes da virada fica no Dietbox (está dentro do
   saldo informado no passo 2). Lançá-lo de novo contaria em dobro nos relatórios do ano.
5. **Conferir na hora:** Resumo → "Saldo atual" igual ao saldo do passo 2 ("Desde o saldo de {data}");
   "Pagamentos pendentes" com o mesmo número de pacientes e o mesmo total que o Dietbox.
6. Daí em diante, cada consulta marcada como **Realizada** gera a cobrança sozinha; o recebimento é marcado na própria
   tela da consulta ("Marcar como recebido") ou em "Pagamentos pendentes". Saídas (aluguel, contas, material…) por
   "Nova saída".

## 3. Conferência do primeiro mês (CS-303)

Critério de sucesso: a Debby fecha **um mês inteiro só no NutriDebby** até 30 dias depois do deploy. No primeiro
fechamento (de preferência na primeira semana do mês seguinte à virada), com ela:

1. **Saldo:** "Saldo atual" do Resumo × extrato do banco + dinheiro em espécie no último dia do mês. Diferença → achar
   o lançamento que falta, sobra ou está com data errada (Lançamentos, filtro do mês).
2. **Pendências:** "Pagamentos pendentes" × o controle dela (quem ficou devendo no mês).
3. **Relatórios:** "Fluxo de caixa de {ano}" e "Entradas e saídas nos últimos 12 meses" batem com a conta dela; baixar
   o CSV do mês (Relatórios → "Baixar CSV", **sem** "Incluir o nome dos pacientes") e o do fluxo de caixa e guardá-los: o
   CSV mensal é o comprovante da movimentação (a edição de um lançamento recebido não guarda o "antes", R-311).
4. **Registrar o resultado** na tabela abaixo. Divergência que não seja erro de lançamento → item novo no backlog
   (`docs/superpowers/plans/2026-09-27-nutridebby-backlog.md`, seção do Plano 20).

| Data da conferência | Mês fechado | Quem | Saldo no NutriDebby | Saldo no extrato + espécie | Diferença | Pendências (pacientes · total) | Observações |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 4. Honorários: informar o valor antes (Res. CFN 856/2026, art. 68, II)

Nota para a Debby, sem mudança no produto: a Res. CFN 856/2026, art. 68, II (compilação não oficial) põe o dever de
**informar previamente ao cliente ou paciente os valores dos honorários** (como o CDC, art. 31), e o art. 68, caput,
faz da divulgação do preço um direito. **A vigência (23/01/2027, pela Res. CFN 858/2026) é a conferir de novo no DOU.**
O NutriDebby não informa o valor ao paciente (nada de financeiro no portal nem na página pública, C-302): quem informa é
a Debby, antes da consulta (ex.: na conversa do agendamento). Mostrar o preço na página pública é pergunta ao CRN-3
(F-P2) e só faz sentido até 22/01/2027 (Res. CFN 599/2018, art. 57).

## 5. Sigilo do CSV com nomes

- O CSV **sem** "Incluir o nome dos pacientes" não tem a coluna "Paciente" e sai com a descrição das entradas de
  pacientes vazia: é o que vai ao contador por padrão (F-D27).
- **Com** a opção, o arquivo tem o nome de cada paciente, e o download fica registrado no **Histórico de acessos** de cada
  paciente presente ("Exportou — Financeiro"). O texto da tela já lembra: "Quem receber o arquivo deve guardar sigilo."
  (Res. CFN 599/2018, art. 20, I). Antes de mandar um CSV com nomes ao contador, a Debby combina o sigilo com ele (termo
  de sigilo: pergunta ao CRN-3, F-P2) e manda por canal privado (nunca em grupo); apaga as cópias locais quando não
  precisar mais delas.

## 6. Comportamentos a lembrar e volta atrás

- **"Faltou" não cancela a cobrança (F-P5 fechada: fica a v0.2).** Corrigir uma consulta de "Realizada" para "Faltou"
  avisa ("Presença registrada. Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar."), e
  a nutricionista cancela a cobrança com o motivo, se não for cobrar. Voltar para "Realizada" não cria cobrança nova.
- **Paciente bloqueado** por pedido de exclusão: as cobranças em aberto continuam valendo (só receber, desfazer, reduzir
  o valor ou cancelar); nenhum lançamento novo. Os registros de pagamento ficam guardados pelo mesmo prazo do prontuário
  e são anonimizados junto com ele (F-D16; conclusão final com o advogado, F-P1).
- **Volta atrás da imagem (R-314).** Voltar a imagem do PR 2 para a do PR 1 (ou anterior) desliga a anonimização do
  Financeiro em `anonimizarVencidos` e a seção `financeiro` da cópia dos dados: o paciente vencido no meio ganha
  `anonimizado_em`, e a função `app_anonimizar_financeiro` (que exige `anonimizado_em` nulo) nunca mais anonimiza os
  lançamentos dele. Risco prático nulo hoje (o primeiro vencimento é bloqueio + 20 anos, nenhum antes de 2046). Se houver
  volta atrás com paciente vencido no meio, anonimizar à mão, com o dono (item no backlog).
- **Volta atrás e DPA (#149).** Depois que alguém aceitou o DPA 1.1, **preferir corrigir para a frente** (um PR novo com
  a correção), não voltar a imagem. Se a volta da imagem for inevitável: a imagem antiga exige a 1.0 (`DPA_VERSAO`), o
  tenant está marcado com a 1.1 e toda nutricionista desse consultório cai em /painel/dpa (as APIs do painel dão 403).
  Aceitar de novo lá **não destrava**: a linha `dpa-1.0` já existe em `consents`, e o `registrarAceiteDpa` da imagem
  antiga só regrava o tenant quando insere a linha. Sem saída pela tela, o painel inteiro (agenda, prontuário e as
  ferramentas do DPA, cláusulas 4 e 5) fica parado.
  - Saída: com o **OK do dono** (regra 3 do servidor: banco de produção), no `nutri_db` com o role migrator
    (`DATABASE_URL_MIGRATOR`), nunca pelo MCP de dev: `UPDATE tenants SET dpa_versao = '1.0' WHERE dpa_versao = '1.1';`.
    Registrar o motivo (data, quem rodou, quantas linhas). Os aceites `dpa-1.1` ficam em `consents` como prova; a
    nutricionista volta a operar sob a 1.0 até o novo avanço.
  - No avanço seguinte (a imagem do PR 2 ou posterior), não precisa de SQL: o reaceite em /painel/dpa já regrava o
    tenant com a 1.1 e a data do aceite que já estava em `consents`, sem linha nova de prova (correção da revisão final
    do PR 2, teste em `src/modules/plataforma/dpa.test.ts`).
  - A imagem antiga também não chama `app_anonimizar_financeiro` (item anterior, R-314); nenhum prazo vence antes de 2046.
  - Detalhe técnico: manual técnico, cap. 6 §6.8.1.

## 7. Pendências externas (não travam a v1)

No backlog, seção do Plano 20: F-P1 (advogado: natureza do dado, base legal, guarda, textos da exclusão, DPA 1.1, CSV
com o contador), F-P2 (CRN-3: o financeiro integra o prontuário? cobrar falta? preço na página pública? sigilo do CSV),
F-P3 (contador: prazo fiscal, colunas do CSV, NFS-e e livro-caixa), F-P4 (dono + Debby: textos do manual guiado e da
Central de Ajuda) e o termo do paciente 1.1 (F-D17).

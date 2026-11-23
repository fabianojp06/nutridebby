# NutriDebby — triagem dos menores dos Planos 17 a 20

Data: 17/11/2026. Documento só de triagem (nenhum código mudou). Junta, num lugar só, os achados Minor adiados dos
Planos 17 a 20 e escolhe os 10 que entram num PR de limpeza.

## Fontes lidas

| Plano | Fonte | Versão lida |
|---|---|---|
| 17 | `.sessoes/plano17-decisoes-e-backlog.md`, seção "Menores adiados" (e os rulings que mandaram itens ao backlog) | arquivo da sessão em 17/11/2026 |
| 17 | Backlog geral: **não há linhas `P17-*`** nem seção do Plano 17 em `2026-09-27-nutridebby-backlog.md` na `main` | `main` `07756c4` |
| 18 | Backlog geral, P18-B1 a P18-B5; plano `2026-11-16-nutridebby-18-ficha-cadastro.md`, "Pendências do rebase (depois do 19) e backlog" | `main` `07756c4` |
| 19 | Backlog geral, P19-B1 a P19-B14 — **só no branch** `origin/plano-19-plano-alimentar-2` (PR #57) | `b264438` |
| 20 | Backlog geral, P20-13 a P20-18 e a lista "P20-18 — Minors das revisões"; plano `2026-11-16-nutridebby-20-financeiro.md`, tabela das revisões (~linha 500) — **só no branch** `origin/plano-20-financeiro` (PR #55) | `411f21d` |

Não achados: nenhum "P19-B"/"P20-18" na `main`; as propostas de manual dos Planos 18 e 19
(`.sessoes/plano18-*`, `plano19-*`) não trazem Minors de código. A tabela de revisões do plano do 20 lista achados
**aplicados** nas tarefas, não adiados; só o "RLS Minor 10" foi ao backlog (P20-16) e dois itens foram descartados (seção 5).

A situação foi conferida no código da `main` (`07756c4`) para os Planos 17, 18 e para o banco do 20 (PR #53, migrations
`0122`/`0123`); para o 19 e para o resto do 20, no SHA do branch acima. Os ids `T1-a`, `BD-1`, `RF-2` etc. dentro de
P17/P20-18 são rótulos desta triagem para itens que vieram sem id.

## 1. Critério de prioridade

1. **Impacto** primeiro: o que o usuário vê errado ou deixa de receber, dado de saúde, LGPD/CFN e segurança (alto > médio > baixo).
2. Depois, **risco de regressão**: falta de teste ou de guarda no banco que deixa o erro voltar calado.
3. Por último, **custo** (P = horas, M = um dia, G = mais): no empate, o mais barato entra primeiro.

## 2. Tabela única

Situação: **aberto ✓** = conferido no código nesta triagem; **aberto** = presumido (baixo impacto, não conferido
linha a linha); **aberto (#57)/(#55)** = o código só existe no branch do PR, ainda fora da `main`; **resolvido em …**;
**obsoleto** (motivo na seção 5).

| # | Id de origem | Plano | Área / arquivo | Resumo | Impacto | Custo | Situação na main |
|---|---|---|---|---|---|---|---|
| 1 | P17 T1-M1/M6 | 17 | `lembretes/banco.test.ts` | Título "público e conta" sem o caso conta; falta o caso nutri com paciente já bloqueado | baixo | P | aberto |
| 2 | P17 T1-M2 | 17 | `lembretes/equipe.ts` | Precisão µs × ms: a equipe nunca pode reenviar `desligado_pelo_paciente_em`/`lembretes_pausados_em` no `set()` | baixo | — | obsoleto |
| 3 | P17 T1-M3/M5 | 17 | `drizzle/0118` | CHECK de texto mede `btrim`, não o texto gravado | baixo | P | aberto |
| 4 | P17 T1 rls-M1 | 17 | `drizzle/0119` | `worker`/contexto vazio mudam as marcas sem condição (e o papel `worker` também roda no web) | baixo | M | aberto ✓ |
| 5 | P17 T1 rls-M2 | 17 | `drizzle/0119:60-78` | Equipe pode apagar a marca de `lembretes_rotina_envios` (gatilho só INSERT/UPDATE): reabre o slot por até 10 min e o push sai de novo | médio | M | aberto ✓ |
| 6 | P17 T1 rls-M3 | 17 | `drizzle/0119:41` | Sessão de paciente sem conta (link de documento) muda as marcas; o paciente grava `updated_at` arbitrário | médio | P | aberto ✓ |
| 7 | P17 T1 rls-M4 | 17 | `drizzle/0119:36` | `criado_por` não forçado a `app_current_user()` no INSERT da sessão `nutri` | médio | P | aberto ✓ |
| 8 | P17 T1 rls-M7 | 17 | `test/isolamento.test.ts` | Negativos sempre recusados pela linha-mãe, nunca pela `staff_only` da marca | baixo | P | aberto |
| 9 | P17 T1-a | 17 | `lembretes/banco.test.ts` | Sem teste do CASCADE da marca quando a nutri apaga o lembrete depois do bloqueio | baixo | P | aberto |
| 10 | P17 T2-2/A1 + "#1 teto recalculado" | 17 | `lembretes/config.ts` | Teto de 24 instável: o diário registrado depois do push sai antes do teto e o total passa de 24 (só água, em borda) | baixo | M | aberto (dono) |
| 11 | P17 T2-A2 | 17 | `lembretes/config.ts` | Dias malformados recebem a mensagem de "vazio" | baixo | P | aberto |
| 12 | P17 T2-A3 | 17 | `lembretes/config.test.ts` | Mensagens novas testadas só com `expect.any(String)` | baixo | P | aberto |
| 13 | P17 T2-A4 | 17 | `lembretes/constantes.ts` | `rotuloDosDias([])` devolve `''` | baixo | P | aberto |
| 14 | P17 T2-3 + T4-03/M1 | 17 | `lembretes/envio.ts:117-131` | Duas refeições com o mesmo nome ("Lanche"): registrar uma no diário derruba o pedido do diário da outra (`noDiario` guarda `r.nome`) | médio | P | aberto ✓ (parcial: a 0121/`refeicao_slot` casa o registro, mas a saída ainda é por nome) |
| 15 | P17 T2-4 | 17 | `lembretes/config.ts` | Laço da água confia no tipo (intervalo 0/texto); o worker valida antes | baixo | P | aberto |
| 16 | P17 T2-N1 | 17 | `lembretes/envio.ts` | `TEXTOS_PUSH.refeicao*` com nome cru — a T4 devia usar `refeicaoDoDiario` | — | — | resolvido em `envio.ts:22,41` (NORMAS-DECISAO-1) |
| 17 | P17 T2-N2 | 17 | `lembretes/constantes.test.ts` | Sem teste fixando `TITULO_PUSH`/`TEXTOS_PUSH` | — | — | resolvido em `constantes.test.ts:51` |
| 18 | P17 T2 "4 mensagens" | 17 | `lembretes/config.ts` | Quatro mensagens de validação para o `revisor-interface` conferir na T5 | — | — | obsoleto |
| 19 | P17 T3-1/M1 | 17 | `lembretes/equipe.ts` | Edição neutra recusada quando o total já passou de 24 por plano republicado | baixo | P | aberto (dono) |
| 20 | P17 T3-2/M3 | 17 | `lembretes/equipe.ts` | `catch` do 23505 sem teste próprio | baixo | P | aberto |
| 21 | P17 T3-3 | 17 | `lembretes/equipe.test.ts` | Teste de `planoPublicado` não cria plano rascunho/arquivado | baixo | P | aberto |
| 22 | P17 T3-4 | 17 | `lembretes/equipe.test.ts` | `previstoHoje` sem teste com dia UTC ≠ dia do consultório | baixo | P | aberto |
| 23 | P17 T3-M2 | 17 | `lembretes/equipe.ts` | `FOR UPDATE` em `ligarLembrete` espera o `FOR KEY SHARE` do worker (bloqueio curto) | baixo | P | aberto |
| 24 | P17 T4-02/M2 | 17 | `lembretes/envio.ts:203-221` | Slot fundido com RETURNING parcial avança as marcas e perde 1 aviso (nunca duplica; aceito na T4) | baixo | M | aberto |
| 25 | P17 T4-04/M3 + rls-M2 (T4) | 17 | `lembretes/envio.test.ts` | Faltam testes: plano arquivado no meio do dia; consultório suspenso entre a leitura e a marca | baixo | P | aberto |
| 26 | P17 T4-M4 | 17 | `lembretes/envio.ts` | Casts (`as Lembrete`, `r.codigo!`) no lugar de união discriminada | baixo | P | aberto |
| 27 | P17 T4-M5 | 17 | `lembretes/envio.ts:240` | `buscarTenant` por consultório a cada minuto | baixo | P | aberto ✓ |
| 28 | P17 T4-M6/L1 | 17 | `lembretes/envio.test.ts` | Sem guarda de que o job não seleciona `texto`; texto livre não afirmado fora do payload (o código já não lê, `envio.ts:10,112`) | médio | P | aberto ✓ |
| 29 | P17 T4-01 | 17 | `lembretes/envio.ts` | `agora` único para todos os consultórios em série | baixo | P | aberto |
| 30 | P17 T4-05 | 17 | `lembretes/envio.ts:247` | `logger.warn` de configuração inválida a cada minuto (ruído no log) | baixo | P | aberto ✓ |
| 31 | P17 T4 rls-M1 | 17 | `lembretes/envio.ts` | A marca não reconfere o estado do paciente entre a leitura e a gravação | baixo | M | aberto |
| 32 | P17 T4-L2 | 17 | `lembretes/constantes.ts` | `TEXTOS_PUSH.refeicao*` aceita string qualquer (falta tipo nominal) | baixo | P | aberto |
| 33 | P17 T5-01/M1 | 17 | `plano-alimentar/lembretes/lista.tsx` | Salvar um cartão da sugestão sumia com o outro | — | — | resolvido em `lista.tsx:143-149` (F-01, onda final) |
| 34 | P17 T5-02/I3 = I-T5-02 | 17 | `plano-alimentar/lembretes/lista.tsx` | Abrir outro formulário descarta o digitado sem aviso | baixo | — | obsoleto |
| 35 | P17 T5-03/I4/M3 | 17 | `lembretes/actions.test.ts` | Textos da seção sem teste; faltam casos na action (tipo inválido, teto 24, editar desligado pelo paciente) | baixo | P | aberto |
| 36 | P17 T5-I1 | 17 | `plano-alimentar/lembretes/lista.tsx` | Controles da linha quebram mal em largura estreita | baixo | P | aberto |
| 37 | P17 T5-I2 | 17 | `plano-alimentar/lembretes/lista.tsx:269` | `<p role="status">` vazio ocupa espaço no `space-y-4` | baixo | P | aberto ✓ |
| 38 | P17 T5-M4 | 17 | `plano-alimentar/lembretes/actions.ts` | A equipe "liga" um lembrete desligado pelo paciente e recebe "Lembrete ligado." sem efeito | médio | P | aberto |
| 39 | P17 T6-a | 17 | `lembretes/constantes.ts:60` | "a cada 2 h" quebra entre "2" e "h" a 360 px (sem NBSP) | baixo | P | aberto ✓ |
| 40 | P17 T6-03/T6-04 | 17 | `lembretes/paciente.ts:130` | `temLembretes` sem `validarConfig` (incoerente com configuração malformada) | baixo | P | aberto |
| 41 | P17 T6-05 | 17 | `p/(portal)/perfil/lembretes` | O interruptor mostra "Não foi possível salvar" por um instante no redirect da action | baixo | P | aberto |
| 42 | P17 T6-06/M1 + T6-M3 | 17 | `e2e/` | Otimista sem teste; `/p/perfil/lembretes` fora das ROTAS do axe | — | — | resolvido em `e2e/acessibilidade.spec.ts:137,476` e `e2e/lembretes.spec.ts` |
| 43 | P17 T6-M2 | 17 | `p/(portal)/perfil/lembretes/page.tsx` | `AtivarAviso` antes do aviso de pausa | baixo | P | aberto |
| 44 | P17 T6 rls-02 | 17 | `lembretes/paciente.ts:98-102` | `desligarMeuLembrete` não filtra `ligado = true` | baixo | P | aberto ✓ |
| 45 | P17 T6 rls-03 | 17 | Hoje do portal | Cinco leituras em paralelo no Hoje | baixo | P | aberto |
| 46 | P17 T6 rls-05 | 17 | `lembretes/paciente.test.ts` | Os testes de RLS do paciente não provam a RLS (o módulo já filtra por `patientId`) | médio | P | aberto |
| 47 | P17 T6-N2 | 17 | `p/(portal)/perfil/lembretes/ativar-aviso.tsx` | Notificação "negada" no aparelho sem texto na página: o paciente não sabe por que não recebe | médio | P | aberto |
| 48 | P17 T6-N3 | 17 | `src/modules/ajuda/portal.ts` | Item da ajuda não cita "Pausar todos" | baixo | P | aberto ✓ |
| 49 | P17 T6-b | 17 | `lembretes/paciente.ts` | JSDoc de `temLembretes` e nome do `describe` desatualizados depois da T6-01 | — | — | resolvido em `paciente.ts:127-149` (JSDoc) |
| 50 | P17 T7-m2/N2 + T7-a | 17 | `pacientes/lgpd.ts`, e-mails, PDF do prontuário | E-mail "pedido atendido" e confirmação no painel não citam os lembretes; o PDF do prontuário não os mostra (só o `dados.json`) | médio | P | aberto (E-09) |
| 51 | P17 T7-M1/M2/M3 | 17 | `pacientes/exportacao-job.ts` | `config: unknown` em `DadosExportacao`; nome `semNada` enganoso; teste sem o tipo `refeicoes` | baixo | P | aberto |
| 52 | P17 T7-m1 | 17 | `drizzle/0119:6` × `lgpd.ts:195` | Classificação contraditória (conduta × ajuste do app) | — | — | resolvido em `docs/manual-tecnico/02-banco-de-dados.md:818` (#10) e `05-…:731` |
| 53 | P17 T7-m3/N3 | 17 | `pacientes/lgpd.test.ts`, `dados.json` | Testes não conferem o `audit_log` `excluir` dos lembretes; `dados.json` com códigos internos | baixo | P | aberto |
| 54 | P17 T7-b | 17 | `pacientes/lgpd.ts` | Anonimização apaga lembretes sem travar o consultório antes (sem ciclo hoje) | baixo | P | aberto |
| 55 | P17 T7-N1 | 17 | `pacientes/lgpd.ts` | Comentário citava "termo 1.0 §24", que não existe | — | — | resolvido na onda da T7 (ruling T7-1) |
| 56 | P17 refeicao_slot (ruling 0121) | 17 | `pacientes/exportacao-job.ts` | `refeicao_slot` fora do `dados.json` (portabilidade: sair como "refeicaoEscolhida") | médio | P | aberto ✓ (normas) |
| 57 | P17 F-03 | 17 | `lembretes/paciente.ts` | Retomar a pausa não renova `validoDesde` | baixo | P | aberto |
| 58 | P17 F-04 | 17 | `lembretes/equipe.ts` | "Previsto hoje" não zera com paciente arquivado | baixo | P | aberto |
| 59 | P17 F-05 | 17 | portal / `envio.ts` | Pedido do diário depois das 22h some sem aviso | médio | P | aberto |
| 60 | P17 F-06 | 17 | `plano-alimentar/lembretes/lista.tsx:62,185` | Interruptor do painel sem try/catch: falha da action sem mensagem | médio | P | aberto ✓ |
| 61 | P17 BD-02 | 17 | `docs/manual-tecnico/06-…` §6.8.1 | Volta atrás para a imagem anterior não apaga lembretes — documentar | baixo | P | aberto ✓ |
| 62 | P17 NORMAS-F2 | 17 | `plano-alimentar/lembretes/form-lembrete.tsx:22,162` | A ajuda fixa ("não substitui a prescrição") só aparece no suplemento; falta no lembrete livre | médio | P | aberto ✓ |
| 63 | P17 NORMAS-F3/F4 | 17 | manual do usuário | Lacunas nas propostas do manual — corrigir antes de publicar | — | — | resolvido em `.sessoes/plano17-propostas-corrigidas.md` (falta o dono publicar) |
| 64 | P17 NORMAS-F5 | 17 | — | Risco residual "prontuário amplo" | médio | — | aberto (advogado/CRN) |
| 65 | P17 NORMAS-F6 | 17 | `p/(portal)/perfil/lembretes` | O portal não diz o que aparece na tela de bloqueio | médio | P | aberto ✓ (texto: dono/Debby) |
| 66 | P17 I-AXE-PAUSA | 17 | `e2e/acessibilidade.spec.ts` | axe de Lembretes sem o aviso de pausa na tela | baixo | P | aberto ✓ |
| 67 | P17 GM-F1..F5 | 17 | `docs/manual-tecnico/` | Citações de linha, log "processados", "10 em paralelo", omissões e divergências | baixo | P | aberto |
| 68 | P17 NORMAS-F1 | 17 | `docs/manual-tecnico/05-…` | Registrar que a equipe apaga de fato, exceto o que o paciente desligou (I1 × NORMAS-03) | baixo | P | aberto |
| 69 | P17 re-revisão (interface) | 17 | `plano-alimentar/lembretes/lista.tsx:147` | Comentário impreciso; sem teste unitário do componente (o E2E cobre) | baixo | P | aberto |
| 70 | P17 re-revisão (CLAUDE.md) | 17 | `CLAUDE.md` regras 2 e 8 | Frases do Plano 17 mais estreitas que o SQL (o worker muda a pausa para qualquer valor; colunas fixas valem também ao worker) | baixo | P | aberto |
| 71 | P17 re-revisão (README) | 17 | `docs/manual-tecnico/README.md` #130 | Tipo "—" na linha #130 | baixo | P | aberto |
| 72 | P18-B1 | 18 | `docs/operacao/carga.md` | p95 do CS-263 (cenário `ficha`, meta 800 ms) ainda não medido | médio | P | aberto (OK do dono) |
| 73 | P18-B2a | 18 | `ficha/resumo.ts:25`, `pacientes/[id]/page.tsx:69` | `cartaoResumo` abre uma transação própria; juntar à de `secoesDoInicio` | baixo | P | aberto ✓ |
| 74 | P18-B2b | 18 | `ficha/resumo.ts:12`, `portal/datas-portal.ts:6`, `MSG_FICHA.situacaoDoPlano` | `MESES` e rótulos de situação do plano repetidos em três lugares | baixo | P | aberto ✓ |
| 75 | P18-B2c | 18 | `components/foco-na-ancora.tsx` + 5 páginas | `FocoNaAncora` montado em cada página; um só no layout da ficha | baixo | P | aberto ✓ |
| 76 | P18-B3a | 18 | `pacientes/base.ts:8` | `MSG_CADASTRO_INCOMPLETO` não diz que o cadastro agora fica na aba Perfil | médio | P | aberto ✓ |
| 77 | P18-B3b | 18 | `ficha/textos.ts:151`, `[id]/app/page.tsx:26` | "Notificações" repetido no rótulo e no texto da linha | baixo | P | aberto ✓ |
| 78 | P18-B3c | 18 | cabeçalho da ficha (`ficha/textos.ts:84`) | Selo "Peso oculto no app" sai na impressão (a linha de medidas não sai) | baixo | P | aberto (dono) |
| 79 | P18-B4 | 18/20 | telas e CSV do Financeiro | Nome social no Financeiro | — | — | resolvido no branch do #55 em `411f21d` (telas com o nome de exibição; CSV com o nome civil) |
| 80 | P18-B5a | 18 | `ficha/no-app.ts` | Contagem do diário no "No app" sem `auditRead` (destoa do Plano 08, §2.8.3) | médio | P | aberto (dono/advogado) |
| 81 | P18-B5b | 18 | `ficha/no-app.ts` | "Último acesso em {data}" na visão da nutricionista (Termo 1.0 §13, E-09) | médio | — | aberto (advogado) |
| 82 | P18-B5c | 18 | DPA | O DPA 1.0 cobre os campos novos do cadastro? (spec §14, pergunta 2) | médio | — | aberto (advogado) |
| 83 | P19-B1 | 19 | `pacientes/exportacao-job.ts` | Cópia da lista de substituição fora do formato derrubava a exportação inteira (prioritário) | alto | P | resolvido no branch em `8d7bab3`/`cd3630e` (`gruposDaCopia`, teste `exportacao.test.ts:915`) |
| 84 | P19-B2 | 19 | `ia/nutri-paciente/contexto.ts` | Trechos `#I`/`#S` sem os dias da refeição: quantidade do dia errado (prioritário, R-236) | alto | P | resolvido no branch em `cd3630e` (`diasDoTrecho`, `contexto.ts:124`) |
| 85 | P19-B3 | 19 | `ia/nutri-paciente/contexto.ts:228-236` | Corte do R-239: a parte que não cabe é pulada e uma de prioridade menor entra; `conferirTermos` sobre trechos cortados; `resumido` sem uso | médio | M | aberto (#57) ✓ |
| 86 | P19-B4 | 19 | guias `plano-alimentar` e do portal | Gaveta sem texto livre, dias, "Ligado ao plano" e avisos; "Ver outros dias" sem a ressalva; passo da busca só com a TACO | baixo | P | aberto (#57) |
| 87 | P19-B5 | 19 | editor do plano | kcal em dois formatos; corte em 2000 caracteres sem aviso; `hashchange` só na 1ª vez; "dom: sem refeições" não anunciado; textos de borda | baixo | P | aberto (#57), parcial (perfis por extenso em `cd3630e`) |
| 88 | P19-B6 | 19 | publicação do plano | Aviso/erro ficam depois de corrigir; caixa sem largura máxima; aviso da IA sem região viva; deadlock 40P01 vira 500; `copiarConteudo` sem trava; leitor tolerante esconde item sem registro | médio | M | aberto (#57) |
| 89 | P19-B7 | 19 | perfis de referência | `ConfirmarBotao` duplicado; índice `meal_plans (tenant_id, referencia_id)` para o `SET NULL` | baixo | P | aberto (#57), parcial (erro no `<details>` e máximo arredondado em `cd3630e`) |
| 90 | P19-B8 | 19 | diálogo "Buscar alimento" | Sem estado de carregamento; o foco pode não voltar se o botão sumir | baixo | P | aberto (#57), parcial (`aria-controls` em `cd3630e`) |
| 91 | P19-B9 | 19 | biblioteca do plano | "Carregar" promove substituição órfã sem aviso; erro de item sem dizer qual; vazio com filtro; "Sugerir equivalentes" desabilitado sem explicação; lista nova sem "Lista salva." | baixo | M | aberto (#57), parcial (consultas em `b8834f3`, aviso da observação em `cd3630e`) |
| 92 | P19-B10 | 19 | "Ligado ao plano" | Erro de "Atualizar da biblioteca"/"Remover" longe do botão; "Remover" sem confirmação | médio | P | aberto (#57) |
| 93 | P19-B11 | 19 | app do paciente | `?refeicao=` de outro dia sem explicação; lista de compras não diz que começa hoje; sanfona reabre; âncora offline pode mudar | baixo | P | aberto (#57), parcial (`textoLivreFora` saiu em `c15b89b`) |
| 94 | P19-B12 | 19 | alimentos e fontes | Receita com alimento da USDA no portal sem o aviso de tradução; "Meu alimento" sem micros/origem; rótulos com dois parênteses; `SELECT DISTINCT` a cada visita | médio | P | aberto (#57), parcial (guarda da TBCA com UPDATE/COPY em `cd3630e`) |
| 95 | P19-B13 | 19 | PDF do plano | Número da página em `top: 810` e rodapé "Fontes:" | — | — | resolvido no branch em `cd3630e` (808 e teste de posição) |
| 96 | P19-B14 | 19 | lembretes × dias (`refeicoesForaDaJanela`) | Avisos de horário da tela da equipe olham o plano inteiro, não o dia | médio | P | aberto (#57) |
| 97 | P20-16 (= RLS Minor 10) | 20 | `lgpd.ts`/runbook | Volta atrás da imagem do PR 2 deixa o Financeiro do paciente vencido sem anonimizar | baixo | M | aberto (dono) |
| 98 | P20-14 | 20 | edição de lançamento | "Antes/depois" no "Alterou — Financeiro" (R-311) | baixo | M | aberto (só se o contador pedir) |
| 99 | P20-18 BD-1 | 20 | `drizzle/0123`, ramo `worker` | Não repete o prazo `anonimizar_apos`; `worker` com o marcador ligado à mão anonimiza em aberto sem cancelar | médio | P | aberto (main) |
| 100 | P20-18 BD-2 | 20 | `drizzle/0123` | `created_at` livre no INSERT `nutri`; `cancelado_por` nulo numa sessão `nutri` sem usuária | baixo | P | aberto (main) |
| 101 | P20-18 BD-3 | 20 | `drizzle/0123` | Trava do paciente depois da trava da linha no UPDATE; paciente que não volta no `FOR KEY SHARE` | baixo | M | aberto (main) |
| 102 | P20-18 BD-4 | 20 | `0123` × `anonimizarVencidos` | `now()` do banco × `now` injetado | baixo | P | aberto (main) |
| 103 | P20-18 BD-5 | 20 | `drizzle/0123` | O banco não garante o resultado da anonimização (anonimizado em aberto, pago cancelável) | médio | M | aberto (main) |
| 104 | P20-18 BD-6 | 20 | `drizzle/0123` | Contexto vazio barra migration de dados; nome da categoria sobrevive à anonimização; travas/`jsonb` redundantes; helper de lista sem escape; leitura do titular repetida 3×; FKs sem índice | baixo | M | aberto (main) |
| 105 | P20-18 TB | 20 | testes do banco | Negativo de INSERT de outro consultório; `audit_log` de ator nulo; `search_path`/`SECURITY INVOKER`/`EXECUTE`; concorrência; CHECKs; ramo `worker`; fuso fixo; `csv.test.ts:143` | médio | M | aberto |
| 106 | P20-18 SD | 20 | semente e docs | Semente deixa cobranças ativas de consultas canceladas; `e2e-seed.ts` alterado no meio; regra 9 sem a exceção de `ULTIMAS` | baixo | P | aberto |
| 107 | P20-18 RM-1 | 20 | `financeiro/csv.ts:19` | Fórmula depois de espaço (" =…") não é neutralizada (CSV injection) | médio | P | aberto (#55) ✓ |
| 108 | P20-18 RM-2 | 20 | regras puras | Regex de dia aceita dia inexistente | baixo | P | aberto (#55) |
| 109 | P20-18 RM-3 | 20 | `financeiro` módulo | `conferirCategoria` sem trava (corrida com excluir/arquivar); `categoriaTravada` com `FOR UPDATE` em renomear/arquivar/reativar | baixo | P | aberto (#55) |
| 110 | P20-18 RM-4 | 20 | `financeiro` módulo | "Desfazer" em aberto grava "Alterou" sem mudança; `meses` e detalhe só pela RLS | baixo | P | aberto (#55) |
| 111 | P20-18 RM-5 | 20 | `financeiro` agregados e lista | Saldo + movimentos e totais da lista viram `number` sem conferir inteiro seguro (RNF-304) | baixo | P | aberto (#55) |
| 112 | P20-18 RM-6 | 20 | `financeiro` agregados | Filtro `coalesce` (RNF-301) não usa índice (p95 do Resumo ~55 ms com 5.000) | baixo | M | aberto (#55) |
| 113 | P20-18 RM-7 | 20 | testes do módulo | 42501 sem teste permanente; borda de mês; "Cancelado" só vazio; corrida não forçada; `log.test` tautológico; CS-301 sem `csvFluxo`; saldo na virada; textos LGPD testados por igualdade | baixo | M | aberto (#55) |
| 114 | P20-18 TL-1 | 20 | telas do Financeiro | Vão de 16 px; foco da navegação interna; passo do guia nas subtelas; link que só rola; erro sem `aria-describedby`; aviso com estilo de sucesso; 360 px; cabeçalho sem nome; dois "Baixar CSV"; `?erro=periodo` perde as datas | baixo | M | aberto (#55) |
| 115 | P20-18 TL-2 | 20 | lista de lançamentos | Cancelado/anonimizado não abre a partir da lista (o manual §12.4.2 descreve tela inalcançável) | médio | P | aberto (#55) |
| 116 | P20-18 TL-3 | 20 | `lancamentos/novo` | Sem configuração, envio inválido devolve erros em vez do redirect (RN-301); `?paciente=` de outro consultório/não encontrado | baixo | P | aberto (#55) |
| 117 | P20-18 TL-4 | 20 | testes de página | Anonimizado, link da consulta, aviso dos 200, "Em atraso de meses anteriores"; `FormSaldo` com `key`; comentário em `e2e/painel.ts` | baixo | P | aberto (#55) |
| 118 | P20-18 TL-5 | 20 | textos fora da §6.2 | "Confirmar", "Selecione", "Nenhum", passos do guia `financeiro` etc. provisórios (F-P4) | baixo | — | aberto (dono/Debby) |
| 119 | P20-18 CB-1 | 20 | seção "Cobrança" do atendimento | As actions recebem o id do lançamento sem conferir que é desta consulta | médio | P | aberto (#55) |
| 120 | P20-18 CB-2 | 20 | `valorDaCobrancaDoAtendimento` | Grava "Visualizou" a cada recarga do atendimento | baixo | P | aberto (#55) |
| 121 | P20-18 CB-3 | 20 | seção "Cobrança" | Recarrega sem dizer quando deixa de ser "Realizada"; aviso depois de "Salvar"; botão desalinhado; mensagem some no celular; consulta o Financeiro sem a seção; `LancamentoNaTela` inteiro no cliente; teste só do bloqueado | baixo | M | aberto (#55) |
| 122 | P20-18 CSV-1 | 20 | rotas do CSV | `HEAD` baixava e gravava `exportar`; GET de outro site gravava `exportar` falso | — | — | resolvido no branch (`navegacao.ts`, `semHead`, onda de correção do PR 2) |
| 123 | P20-18 CSV-2 | 20 | rotas do CSV | Navegador sem `Sec-Fetch-Site` (Safari < 16.4) não baixava nem via aviso | — | — | resolvido no branch em `4774492` (`recusaDeOrigem` com `Origin`/`Referer`, `?erro=origem`) |
| 124 | P20-18 CSV-3 | 20 | rotas do CSV | Consultório suspenso recebe JSON numa navegação; `pacientes=1` sem paciente grava `exportar` sem paciente | baixo | P | aberto (#55) |
| 125 | P20-18 LG-1 | 20 | textos da exclusão | Dão a obrigação fiscal como motivo, mas o prazo é o do prontuário (20 anos) | médio | P | aberto (advogado) |
| 126 | P20-18 LG-2 | 20 | DPA 1.1 | Cláusulas 4/5 e 13 sem o Financeiro; "O que mudou" incompleto para quem está na 0.1; texto da 1.0 não fixado por inteiro nos testes | médio | P | aberto (advogado) |
| 127 | P20-18 LG-3 | 20 | `lgpd.test`, bundle do portal | `doOutro` sem controle positivo; o portal leva `MSG_FINANCEIRO` inteiro | baixo | P | aberto (#55) |
| 128 | P20-18 FX | 20 (visto) | `plataforma/monitoramento.test.ts` | Falha intermitente ("expected 22 to be 23") por corrida de admin no banco compartilhado | médio | P | aberto ✓ (main) |
| 129 | P20-18 RF-1 | 20 | `financeiro/cobranca.ts` | Helpers com `tx` dependem do papel de quem chama | baixo | P | aberto (#55) |
| 130 | P20-18 RF-2 | 20 | `financeiro/constantes.ts:238` | Paciente anonimizado aparece como bloqueado, com "As cobranças em aberto continuam valendo" | médio | P | aberto (#55) |
| 131 | P20-18 RF-3 | 20 | telas | Caixa de sucesso pisca a cada envio; `?aviso=informeSaldo` sem foco/anúncio; meses minúsculos; painéis abertos sem axe; guia com 12 passos sem alvo | baixo | M | aberto (#55) |
| 132 | P20-18 RF-4 | 20 | docs, runbook, CLAUDE.md | Regra 8 sem o `ler` do atendimento; regra 1 sobre `titular.ts`; runbook sem a janela deploy × início; SQL de destravar deixa `dpa_aceito_em` da 1.1; manual §12.4.2, §12.2, cap. 7, §3.12 | baixo | P | aberto (#55) |
| 133 | P20 Interface Minor 7 | 20 | atendimento | "Faltou" cancelava sem confirmação e perdia o valor | — | — | obsoleto |
| 134 | P20 Exec. M-10 / RLS Minor 5 / Paralelas C1 | 20 | `test/isolamento.test.ts` | `fin_categorias` em `ULTIMAS` | — | — | obsoleto |

**Totais:** 134 itens — **115 abertos** (81 com o código na `main`, 34 só nos branches #55/#57; 7 deles parciais),
**14 resolvidos** (8 na `main`, 6 nos branches) e **5 obsoletos**. Contagem por plano no fim.

## 3. Top 10 para o PR de limpeza

Os 1–6, 9 e 10 cabem num PR sobre a `main` hoje. Os 7 e 8 dependem do merge do PR #55 (entram no mesmo PR se ele já
estiver na `main`, senão no seguinte). Os itens com `drizzle/` pedem migration nova, com `DATABASE_URL_MIGRATOR`.

1. **#14 — P17 T2-3/T4-03: refeições de mesmo nome.** `ler()` passa a guardar em `noDiario` o rótulo `nome · HH:MM`
   (`rotuloDaRefeicao`), e `planoDoDia` compara pelo rótulo; o casamento por `refeicaoDoDiario` só vale para registro
   sem `refeicao_slot` nem `refeicao_do_plano`. *Teste:* `envio.test.ts` — "Lanche 10:00" e "Lanche 16:00", registro
   com `refeicao_slot = 'Lanche · 10:00'` → o pedido do diário das 16:00 ainda sai.
2. **#5 — P17 rls-M2: equipe apaga a marca de envio.** Gatilho `BEFORE DELETE` em `lembretes_rotina_envios` que só
   deixa `worker`/contexto vazio e o CASCADE do lembrete (`pg_trigger_depth() > 1`). *Teste:* `banco.test.ts` — DELETE
   da marca na sessão `nutri` → 42501; apagar o lembrete continua levando a marca; a tabela entra em `SEM_DELETE`.
3. **#107 — P20-18 RM-1: CSV injection com espaço na frente.** `FORMULA.test(v.trimStart())` (e espaços Unicode
   iniciais); a célula ganha o `'` antes do texto original. *Teste:* `csv.test.ts` — `" =1+1"`, `" @SOMA(A1)"` e
   `"\t-2"` saem com `'`; `"Consulta - retorno"` sai igual.
4. **#62 — P17 NORMAS-F2: ajuda fixa no lembrete livre.** Mostrar `AJUDA_SUPLEMENTO` (ou texto próprio aprovado pelo
   `normas-cfn-lgpd`) também em `tipo = 'livre'`, no `aria-describedby`. *Teste:* render de `form-lembrete.tsx` no tipo
   livre com o texto e o `aria-describedby` apontando para ele.
5. **#6 — P17 rls-M3: paciente sem conta mexe nas marcas.** No ramo `paciente` do gatilho da 0119, exigir conta
   (`app_current_user()` não nulo) e gravar `updated_at = now()` em vez do valor enviado. *Teste:* `banco.test.ts` —
   contexto de paciente sem conta (link de documento) → 42501; `updated_at` enviado no passado é ignorado.
6. **#7 — P17 rls-M4: `criado_por` livre.** No INSERT da sessão `nutri`, `criado_por` tem de ser
   `app_current_user()` (mesmo gatilho do item 5, na mesma migration). *Teste:* INSERT com `criado_por` de outra
   usuária do consultório → 42501; com a própria → passa.
7. **#130 — P20-18 RF-2: anonimizado mostrado como bloqueado.** Mensagem própria para o anonimizado (sem "as cobranças
   em aberto continuam valendo", que é falso para ele), escolhida por `anonimizado_em`. *Teste:* `page.test` do
   lançamento e da ficha com paciente anonimizado — o texto novo aparece e o de bloqueado não.
8. **#119 — P20-18 CB-1: lançamento de outra consulta.** As actions da seção "Cobrança" leem o lançamento com
   `appointment_id = <consulta da página>` e recusam o resto. *Teste:* `cobranca-actions.test.ts` — id de lançamento de
   outra consulta do mesmo consultório → erro e nada muda no banco.
9. **#47 — P17 T6-N2: notificação negada sem explicação.** Com `Notification.permission === 'denied'`, a tela Eu ›
   Lembretes diz que as notificações estão bloqueadas no aparelho e como liberar (texto para a Debby revisar).
   *Teste:* `page.test`/componente com `denied` mostra o texto; axe da página nesse estado.
10. **#38 — P17 T5-M4: "Lembrete ligado." sem efeito.** Quando o paciente desligou, a action responde que ficou ligado
    pela equipe e que só o paciente religa no app (§5.3). *Teste:* `actions.test.ts` — ligar um lembrete com
    `desligado_pelo_paciente_em` preenchido devolve a mensagem nova e não muda a marca do paciente.

Logo depois (11–15, se sobrar fôlego): #128 teste intermitente do monitoramento (CI), #60 try/catch do interruptor do
painel, #76 `MSG_CADASTRO_INCOMPLETO`, #103 garantia da anonimização do Financeiro no banco, #85 corte do R-239 da IA Nutri.

## 4. Dependem de decisão do dono, da Debby ou do advogado

- **Dono:** #10 e #19 (teto de 24 com diário e plano republicado: aceitar a borda ou recalcular); #72/P18-B1 (OK para a
  rodada de carga); #78/P18-B3c (selo "Peso oculto no app" na impressão); #97/P20-16 (procedimento na volta atrás
  do PR 2 do Financeiro); #98/P20-14 ("antes/depois", só se o contador pedir — F-P3); publicar as propostas do manual
  do Plano 17 já corrigidas (#63); conferir `DPA_VERSAO_DATA` no dia do deploy do PR 2 do 20 e avisar a Debby (R-309).
- **Debby (textos):** #65/NORMAS-F6 (o que vai na tela de bloqueio, dito no portal); #118 (textos provisórios do
  Financeiro, F-P4); o texto novo dos itens 9 e 10 do top 10.
- **Especialista de normas (`normas-cfn-lgpd`):** #56 (`refeicao_slot` no `dados.json` como "refeicaoEscolhida",
  portabilidade); o texto da ajuda do lembrete livre (item 4 do top 10).
- **Advogado (E-09) e CRN:** #50 (e-mail "pedido atendido" e PDF do prontuário com os lembretes); #64/NORMAS-F5
  ("prontuário amplo"); #80–#82/P18-B5 (contagem do diário sem `auditRead`, "Último acesso em", DPA e os campos novos
  do cadastro); #125 e #126 (motivo do prazo nos textos da exclusão e cláusulas do DPA 1.1); fora desta lista, mas do
  mesmo pacote: P20-13 (Termo do paciente 1.1) e P20-15 (F-P1 a F-P4).

## 5. Descartados (obsoletos)

| # | Item | Por quê |
|---|---|---|
| 2 | P17 T1-M2 (µs × ms) | Era instrução para os briefs das T3/T5/T7, já executadas; vale como nota do manual, não como correção |
| 18 | P17 T2 "4 mensagens" | Pedido de conferência ao `revisor-interface` na T5, que já foi feita |
| 34 | P17 T5-02/I3 = I-T5-02 | Não promovido pelo ruling da onda final: perde só o digitado não salvo; padrão de um formulário por vez |
| 133 | P20 Interface Minor 7 | A F-D19 revista (F-P5 fechada em 17/11) não cancela mais a cobrança no "Faltou": o valor fica |
| 134 | P20 Exec. M-10 / RLS Minor 5 / Paralelas C1 | `fin_categorias` não precisa estar em `ULTIMAS` (a única filha está em `SEM_DELETE`), conforme o plano do 20 |

Os 14 resolvidos também ficam fora do top 10: na `main`, #16, #17, #33, #42, #49, #52, #55 e #63 (o #63 só falta o
dono publicar); nos branches, #79, #83, #84, #95, #122 e #123. Os parciais (#14, #87, #89, #90, #91, #93, #94) contam
como abertos, pelo que ainda falta.

## Contagem

| Plano | Itens | Abertos | Resolvidos | Obsoletos |
|---|---|---|---|---|
| 17 | 71 | 60 | 8 | 3 |
| 18 | 11 | 10 | 1 (no #55) | 0 |
| 19 | 14 | 11 (6 parciais) | 3 (no #57) | 0 |
| 20 | 38 | 34 | 2 (no #55) | 2 |
| **Total** | **134** | **115** | **14** | **5** |

Os parciais contam como abertos.

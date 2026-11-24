---
name: onde-os-manuais-envelhecem
description: Pontos do manual técnico que ficam desatualizados a cada plano e armadilhas encontradas nos fechamentos
metadata:
  type: feedback
---

Checklist do que envelhece a cada plano (conferido no fechamento do Plano 11, 07/10/2026):
- Contagens: filas (README "Onde mora" + §6.2.3 + README tabela de caps.), tabelas do §2.5 (contar `pgTable(`),
  migrations, testes (relatório do code review do PR), specs E2E, fábricas do isolamento, commits, tamanho da imagem
  (log do job `image` do PR: `gh run view <run> --job <id> --log | grep "Imagem comprimida"`).
- Linhas citadas de `test/isolamento.test.ts` e `src/worker/index.ts` mudam a cada plano: reconferir com `grep -n`.
- Plano mesclado entre fechamentos (ex.: Plano 09) deixa "aguardando merge" no índice, backlog (P09-0x) e cronologia
  do cap. 01 — conferir `git log --merges`.
- Divergências "resolvidas" por outro plano (ex.: #3 worker espera schema, resolvida no P09-02) ficam abertas no README
  e no cap. 07 se ninguém marcar.
- O `CLAUDE.md` do contexto da sessão pode ser de outro checkout: conferir o do worktree antes de apontar divergência.
- Tabela markdown: rodar o checador de colunas e de âncoras sobre o `git diff` antes do commit (achei linha sem `|` final).
- Tela nova no `/painel` exige guia em `conteudo.ts` ou `SEM_AJUDA`; recurso novo dentro de tela existente (IA) não
  exige, mas o guia pode ganhar seção de ajuda com `versao` +1.

- Proposta do manual do usuário de recurso desligado em produção (IA sem `IA_PROVEDOR`, documentos sem liberação):
  abrir com o aviso "ainda não disponível; aparece quando o suporte liberar" — senão promete tela que não existe.
- Afirmação "mantido na reativação" de coluna com `coalesce`: conferir se a desativação zera a coluna (`desativarIa`
  zera `ia_ativada_em`; o `coalesce` só preserva com a IA ativa).
- Tabelas de mensagens da proposta: conferir o estado que realmente mostra cada texto (`iaNoExame`, `ia-exame.tsx`) e
  o escopo dos limites (30/h é por usuária, `pedido_por`).

- Citações de linha de `src/db/rls-guard.ts` aparecem em README (glossário), caps. 02, 04, 07 e 09: ao mexer numa,
  conferir todas com `grep -n "rls-guard.ts:[0-9]" docs/manual-tecnico/*.md`.
- Gatilho de defesa com condição (ex.: `patients_ia_quem` só barra com canal `email`): descrever a condição do SQL, não
  "a sessão X não troca Y".
- Pós-envio de e-mail que filtra pelo destinatário (`registrarCienciaPorEmail`): estado pendente pode ficar sem saída;
  documentar o caso nos dois manuais.

- Sem ferramenta do Claude Docs na sessão de subagente: a lista "o que deixa de valer" do manual do usuário cita os
  textos das propostas anteriores (05/10 portal, 06/10 receita, P11, P12), não o documento — avisar quem orquestra.
- Tela reorganizada (ex.: /admin no P16) envelhece a descrição do técnico também: conferir cabeçalhos de tabela no código.

**Why:** no fechamento do Plano 11 vários desses itens estavam velhos (Plano 09 "aguardando merge", 20 filas, linhas do
isolamento, divergência #3).
**How to apply:** passar por esta lista em todo fechamento. Ver [[estado-dos-manuais]].

- "01: cronologia" no brief = a tabela §1.10 "Cronologia dos planos", não o "Conferido contra"/"Data da conferência"
  do cabeçalho (na T5F da 14B-1 o implementador só mexeu no cabeçalho; 14A ficou "em execução" mesmo mesclado no PR #29).
- Plano que acrescenta código no meio de arquivo citado (env.ts, carregar.ts, rascunho.ts, ia-secao.tsx, rls-guard.ts)
  envelhece as linhas das tabelas vizinhas: comparar `git show <base>:arq` × `<head>:arq` em cada `arq:N` citado
  (script em Python que percorre `docs/manual-tecnico` e só os arquivos do `git diff --name-only`).
- Tabela nova em `STAFF_ONLY` também entra na coluna "Conteúdo hoje" da §2.7 do cap. 02.

- Versão de texto legal da IA (`textos-legais.ts`: `AUTORIZACAO_IA_VERSAO`, `IA_ADITIVO_VERSAO`) muda telas em vários
  lugares do manual do usuário: aviso do topo, 1.6.x, confirmação do "Liberar" do admin, Parte 2 e roteiro. Ao subir
  versão, `grep -n "provis\|0\.[0-9]-\|versão" ` na proposta inteira. O estado `nao_liberada` vem antes do `nao_ativada`
  (`modo.ts`): com `IA_PROVEDOR` ligado, consultório não liberado vê "A IA ainda não foi liberada…" em cada exame com laudo.

- Linhas de `.github/workflows/ci.yml` e `deploy.yml` são citadas nos caps. 01, 02, 06, 07 e 08: a cada mudança de
  workflow, `grep -n "ci.yml:[0-9]\|deploy.yml:[0-9]" docs/manual-tecnico/*.md` e conferir com `sed -n`. No runner próprio
  (12/10/2026) o controlador comitou correções no meio da minha tarefa (`bbd7728`): reler `git log -1` e o diff antes de
  entregar, e retirar divergências que o commit novo já resolveu.

- Plano 17 (17/11/2026): muitas citações `src/worker/index.ts:N` e `index.ts:N` (sem prefixo, caps. 1 e 6) já estavam
  velhas antes do plano. Remapear por difflib (base × head, blocos `equal`) só preserva o erro antigo; para filas, use
  `grep -n "boss.schedule\|await work" src/worker/index.ts`. Refazer no scratchpad o remapeador e o checador de âncoras e
  colunas; `\|` escapado (cap. 4, `indicadorMeta`) é falso positivo de colunas.
- Plano cujas decisões são NORMAS-DECISAO-n/NORMAS-0n (lente de normas) em vez de Dx: citar esses rótulos.
- Tela de portal nova sob `/p/perfil/*` marca Eu pelo prefixo; não precisa de `tambem` nem de `SEM_AJUDA`.

- Plano 18 PR 1 (17/11/2026): aba nova da ficha envelhece "12 abas" (cap. 5 §5.3.9), a citação `[id]/page.tsx:N` e o
  termo "página do paciente" (caps. 4 §4.2.1 e 10 §10.13), `prontuario.ts:N` (caps. 3 e 7) e `conteudo.ts:N` (cap. 10
  P11-20 g; guia novo no meio de `GUIAS` desloca tudo). `conteudo.test.ts:48`/`conteudo.ts:19` do cap. 7 já estavam velhos.
- Plano em dois PRs: documentar só o que está no código; o que a spec promete para o PR 2 vira divergência "Pend." para
  retirar no fechamento seguinte. No PR 1 a orquestradora pediu para não mexer no Docs: a proposta do manual do usuário
  ficou para o fechamento do plano (T12c).


- Revisão do PR 2 do Plano 18 (17/11/2026, HEAD `7911508`): o remapeador por símbolo do fechamento só pegou `arq:N`
  com nome; as citações **soltas** `` `:N` `` depois do arquivo (ex.: `convite-paciente.ts:52`, `:102`; `exportacao-job.ts`
  … `:113`; `audit.ts` … `:173`; `tenant.ts:15`, recusa em `:49`) ficaram velhas. Checar também `` `:N` `` herdando o
  último arquivo citado na linha (script `bare.py`: compara base × head só nas linhas do manual que o PR não tocou).
- Plano 20 (17/11/2026): as linhas de `lgpd.ts`, `exportacao-job.ts`, `dpa.ts`, `atendimentos.ts` e `test/isolamento.test.ts`
  citadas nos caps. 2, 4, 5, 6, 7 e 8 estavam velhas desde planos anteriores; refiz pelas funções (`grep -n "^export"`), não
  pelo remapeador. Rodar o remapeador DEPOIS de editar trata os números novos como base: só use antes. Laço de substituição
  de linhas (`:415`→`:437`, `:437`→`:459`) colide: aplique em ordem decrescente.
- Versão nova de texto legal (DPA, termo): conferir a volta atrás — `registrarAceiteDpa` não regrava o tenant se o aceite da
  versão antiga já existe (onConflictDoNothing), e a imagem anterior prende o painel em `/painel/dpa`.
- Runbook que manda "procurar a mensagem X no log do worker": erro de job passa por `semDetalhe` (vira `falha no job
  <fila> (<código>)` no pg-boss e vai ao Sentry com a mensagem filtrada) — nenhuma linha de log tem o texto. Conferir se
  há `logger.*` com a frase antes de aceitar a checagem; senão, Sentry pela tag `fila` (P27 PR 2, 24/11/2026).
- Chave "a última" de `DadosExportacao` muda a cada plano que acrescenta seção (Plano 27 pôs `questionarios` depois de
  `financeiro`): `grep -n "a última" docs/manual-tecnico/*.md`.
- Plano com prefixo próprio de decisões (F-Dn, F-Pn no Plano 20) entra na tabela "Identificadores" do README.
- Material do manual do usuário sem acesso ao Docs: na coluna "trecho atual", usar o texto antigo da tela tirado do código
  (`git show <base>:arquivo`), e dizer isso no topo do material.
- Rebase entre planos paralelos (Plano 20 sobre o PR 2 do Plano 18, 17/11/2026): os dois fechamentos numeraram
  divergências do README a partir do mesmo último número (#138–#141 dos dois lados). Renumerar as do plano que entra
  depois (e as referências "#N a #M" do capítulo dele e das memórias), e a linha da divergência no cap. 2 que mudou de número.
- P27 PR 3 (24/11/2026): o remapeador precisa resolver nomes ambíguos (`lgpd.ts` = pacientes × `ia/nutri-paciente`,
  `conteudo.ts`, `route.ts`, `index.ts`, `paciente.ts`) por uma tabela de preferência, senão casa o arquivo errado do diff;
  citações com vírgula (`exportacao-job.ts:616,624,923-924`) e `:N` solto **antes** do arquivo na linha escapam — conferir à
  mão. Runbook de volta atrás que diz "a Debby encerra/edita pela ficha": conferir `carregarPacienteParaEscrita` (bloqueado
  é só consulta) e o "No app" (bloqueado não conta nada). Contagens de `test(` no cap. 7 estavam velhas: contar com
  `grep -c '^\s*test('`.
- Revisão final do PR 3 do P27 (24/11/2026): a `origin/main` andou (Planos 22 PR 2/3 e 23 mesclados) e já ocupa §4.2.12,
  §4.2.13, §5.5.15, README #154–#160 e cap. 4 até #30, e as migrations 0127–0131. Antes de numerar seção/divergência num
  branch de plano longo, conferir `git show origin/main:docs/manual-tecnico/README.md` (a `main` local do worktree pode
  estar velha: usar `origin/main`). O "remapeamento" de citações do fechamento preservou erros antigos de novo
  (`exportacao-job.ts:97/:503/:118`, `lgpd.ts:584`, `exportacao.test.ts:1133`): conferir pelo símbolo, não pelo deslocamento.

- Plano 23 PR 2 (23/11/2026): o brief dizia que o PR 1 "já tinha a parte no manual" e não tinha (`grep` do nome da tabela
  nova em `docs/manual-tecnico` antes de assumir). Arquivo disputado (cap. 5): seções no fim, e as frases velhas das
  seções antigas ajustadas só na linha (MAX_REGRAS, `link_online_padrao`, visões). O remapeador casa `constantes.ts`,
  `inicio.ts`, `paciente.ts`, `job.ts` pelo nome-base e dá falso positivo (lembretes/, ficha/, ia/): conferir o contexto.
  `exportacao-job.ts` muda em quase todo plano — refazer por símbolo nos caps. 4, 5, 6, 10 e 12.

- Plano 23 PR 3 (24/11/2026): o worktree tinha alterações não commitadas de **outra sessão** (código do PR 4) — `git add`
  só por caminho (`docs/manual-tecnico/…`, memória), nunca `-A`. Remapeador: herdar o arquivo até o próximo título (não
  até a linha em branco) e ler o texto do manual de `HEAD` (antes de editar); falsos positivos quando o parágrafo cita dois
  arquivos (`horarios.ts` × `agendamento-publico.ts`, `botao-imprimir.tsx` × `page.tsx`).
- Volta atrás de tipo novo de notificação: na imagem anterior, `emailDaNotificacao` devolve `null` → `falhou`/`sem_modelo`
  (não "sai sem reconferir"); conferir com `git show <commit do PR anterior>:src/modules/notificacoes/enviar.ts`.
- Números de divergência: antes de numerar, `git show origin/main:docs/manual-tecnico/<cap>.md | grep "^| [0-9]* |"` —
  outro plano pode já ter ocupado os próximos números na `main`.

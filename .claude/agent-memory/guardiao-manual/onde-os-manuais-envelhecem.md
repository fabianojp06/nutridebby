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

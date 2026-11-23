# Recepção (Plano 26) — operação

Runbook do papel `recepcao` (PD-101). Criado na T4 do Plano 26 (banco: papel, negação por padrão, `equipe_membros`);
completado na T11b (telas, `EQUIPE_LIGADA`, E2E). Spec: `docs/superpowers/specs/2026-11-17-nutridebby-26-relatorios-recepcionista-design.md`
§9 e §12 (R-498); plano: `docs/superpowers/plans/2026-11-17-nutridebby-26-relatorios-recepcionista.md`.

## O que o PR 2 muda no banco

Duas migrations (números dados pelo `pnpm db:generate` sobre a `main` do momento; nada reservado, `sessoes-paralelas.md` §5):

- **gerada `<NNNN>_recepcao`** — tabela `equipe_membros`; `user.ultimo_acesso_em` (anulável); CHECK `user_app_role_valido`
  com `recepcao` e o novo `user_recepcao_com_tenant`; `invites_tipo_valido` e `invites_alvo` com o convite `recepcao`.
  Só expansão (RNF-486): nenhum valor antigo deixa de valer, nenhuma coluna obrigatória nova.
- **custom `<NNNN+1>_rls_recepcao`** — `app_deny_recepcao`, `app_allow_recepcao`, `app_enable_tenant_rls` (corpo da 0070 +
  `recepcao_negada`), o laço que põe `recepcao_negada` em toda tabela do `public` com `tenant_isolation`, a RLS e o gatilho
  `equipe_membros_regras` de `equipe_membros`; depois (T5a/T5b) as liberações, as condições, os gatilhos de colunas e as
  funções `SECURITY DEFINER`.

As políticas novas só pegam a sessão `recepcao` (RESTRICTIVE com `app_current_role() IS DISTINCT FROM 'recepcao'`): para
`nutri`, `paciente`, `worker`, `publico` e `conta` nada muda.

## Deploy

- Merge só com OK do dono (merge = deploy; a migration roda no boot do `nutri_app`), **fora das 03h–07h30 BRT** e fora do
  horário de uso.
- **Sem snapshot da Hostinger** (congela a VPS, `CLAUDE.md` do servidor, regra 5): a migration é aditiva e o backup restic
  diário cobre a volta. Conferir antes, em `/var/log/backup.log`, que o último backup do `nutri_db` saiu bem.

### `lock_timeout` de 10 s (RE-D64, R-498)

O migrador do Drizzle aplica todas as migrations pendentes **numa transação só**. A conexão dele (`poolDoMigrador`,
`src/db/migrate.ts`) abre com `-c lock_timeout=10s`, que vale para a execução inteira: a gerada (que trava `user`, lida em
toda requisição) e o laço da custom (que trava, uma a uma, cada tabela com `tenant_id`, umas 100).

Se alguma trava não sair em 10 s (a imagem anterior segurando uma transação longa):

1. o Postgres cancela o comando (`55P03 lock_not_available`) e a transação **volta inteira** — o banco fica como antes,
   nenhuma migration pela metade;
2. `scripts/migrate.ts` rejeita e o processo sai com erro; o `docker-entrypoint.sh` (`set -eu`) não chega ao `next start`;
3. o Swarm reinicia o container do `nutri_app`, que tenta as migrations de novo (a imagem anterior continua servindo até a
   nova ficar de pé).

Se ficar em laço (o log do serviço repete o `lock_timeout`): ver no `nutri_db` quem segura a trava
(`select pid, state, query_start, left(query, 60) from pg_stat_activity where datname = current_database() and state <> 'idle'`),
**sem matar nada sem o OK do dono** (regra 3), e tentar de novo num horário calmo.

## Volta atrás

A imagem anterior ao PR 2 roda sobre o banco do PR 2 (expansão, RNF-486). Nela a recepção é recusada sem quebrar nada:

- **Entrada:** `evaluateSession` (`src/lib/session-rules.ts`) só aceita os papéis da lista de cada página
  (`allowed.includes(role)`); `recepcao` não está em nenhuma → `forbidden` em `requireUser`/`requireNutri` e nas APIs.
- **Banco:** as políticas `recepcao_*` não pegam os papéis que a imagem anterior usa (`nutri`, `paciente`, `worker`,
  `publico`, `conta`); `equipe_membros` fica sem uso.
- **Admin:** as listas filtram `app_role = 'nutri'` (`src/modules/plataforma/contas.ts`: `reenviarConvite`, `listarContas`,
  `contaPorId`, `resumoDasContas`); `metricas-sucesso.ts` não lê `user`; os e-mails de aviso filtram o papel
  (`monitoramento.ts` → `admin`, `agenda/aviso-nutri.ts` e `ia/nutri-paciente/contexto.ts` → `nutri`).
  **Conferido na T4** (23/11/2026, banco de dev da sessão, numa transação desfeita): com uma conta `recepcao` num consultório,
  `listarContas` e `resumoDasContas` contam o consultório uma vez, pela nutricionista, e a conta da recepção não aparece em
  nenhuma linha nem como e-mail da conta (`contaPorId`).
- **"Desativar pela Equipe"** só existe na imagem nova. Com a imagem anterior no ar, a recepção já não entra (item
  "Entrada"), então não há o que desativar; ao voltar para a imagem nova, as linhas de `equipe_membros` seguem como estavam.

Desfazer as migrations não é o caminho (nada nelas quebra a imagem anterior). Se for preciso, só com o dono, por migration
nova (nunca editando a aplicada).

## Pendências desta página (T11b)

- Telas: convite, primeiro acesso, desativar/reativar, permissão do Financeiro; `EQUIPE_LIGADA`.
- O que conferir em produção depois do deploy do PR 2 (sem consultar o banco de produção por subagente).

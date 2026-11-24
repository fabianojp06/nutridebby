# Recepção (Plano 26) — operação

Runbook do papel `recepcao` (PD-101). Criado na T4 do Plano 26 (banco: papel, negação por padrão, `equipe_membros`);
completado na T11b (telas, `EQUIPE_LIGADA`, E2E). Spec: `docs/superpowers/specs/2026-11-17-nutridebby-26-relatorios-recepcionista-design.md`
§9 e §12 (R-498); plano: `docs/superpowers/plans/2026-11-17-nutridebby-26-relatorios-recepcionista.md`.

## O que o PR 2 muda no banco

Duas migrations (números dados pelo `pnpm db:generate` sobre a `main` do momento; nada reservado, `sessoes-paralelas.md` §5).
No rebase sobre a `main` `16f944a` (Planos 22 e 23, PR 1 de cada) ficaram `0132_recepcao` e `0133_rls_recepcao`; se outra
migration entrar antes do merge, elas são geradas de novo e os números mudam:

- **gerada `0132_recepcao`** — tabela `equipe_membros`; `user.ultimo_acesso_em` (anulável); CHECK `user_app_role_valido`
  com `recepcao` e o novo `user_recepcao_com_tenant`; `invites_tipo_valido` e `invites_alvo` com o convite `recepcao`.
  Só expansão (RNF-486): nenhum valor antigo deixa de valer, nenhuma coluna obrigatória nova.
- **custom `0133_rls_recepcao`** — `app_deny_recepcao`, `app_allow_recepcao`, `app_enable_tenant_rls` (corpo da 0070 +
  `recepcao_negada`), o laço que põe `recepcao_negada` em toda tabela do `public` com `tenant_isolation`, a RLS e o gatilho
  `equipe_membros_regras` de `equipe_membros`; depois (T5a/T5b) as liberações, as condições, os gatilhos de colunas
  (`patients_da_recepcao`, `patient_cadastro_da_recepcao`, `appointments_da_recepcao`, `tenants_so_nutri`), as funções
  refeitas (`fin_lancamentos_regras`, `app_appointments_regras_pedido`) e as quatro `SECURITY DEFINER`
  (`app_retorno_das_consultas`, `app_previsoes_de_retorno`, `app_consulta_tem_atendimento`, `app_cpf_em_uso`). Detalhe no
  manual técnico, §2.6.9.

As políticas novas só pegam a sessão `recepcao` (RESTRICTIVE com `app_current_role() IS DISTINCT FROM 'recepcao'`): para
`nutri`, `paciente`, `worker`, `publico` e `conta` nada muda.

## Deploy

- Merge só com OK do dono (merge = deploy; a migration roda no boot do `nutri_app`), **fora das 03h–07h30 BRT** e fora do
  horário de uso.
- **Sem snapshot da Hostinger** (congela a VPS, `CLAUDE.md` do servidor, regra 5): a migration é aditiva e o backup restic
  diário cobre a volta. Conferir antes, em `/var/log/backup.log`, que o último backup do `nutri_db` saiu bem.

### `lock_timeout` de 10 s (RE-D64, R-498)

O migrador do Drizzle aplica todas as migrations pendentes **numa transação só**. A conexão dele (`poolDoMigrador`,
`src/db/migrate.ts`) abre com `-c lock_timeout=10s`. O limite vale **para cada espera de trava**, em todos os comandos da
execução — a gerada (que trava `user`, lida em toda requisição) e o laço da custom (que trava, uma a uma, cada tabela com
`tenant_id`, umas 100) —, **não para a execução inteira**:

- as esperas **podem somar**: cada tabela pode esperar até 10 s sem estourar, e a migração inteira levar bem mais;
- a trava exclusiva de `user`, tomada pela gerada no começo, **fica presa até o fim da transação**, inclusive durante o laço;
  enquanto isso, toda requisição que lê `user` (login, sessão) espera atrás dela. Com a imagem anterior servindo, isso é
  lentidão (ou erro) no app durante a migração — mais um motivo para o horário calmo;
- uma transação do app que **já segura uma tabela** do laço e **depois lê `user`** pode fechar um ciclo com o migrador
  (ele segura `user` e espera a tabela; ela segura a tabela e espera `user`): o Postgres detecta o **deadlock** (`40P01`) e
  cancela um dos dois — a vítima pode ser a **requisição** (o usuário vê um erro e repete) ou o migrador (cai no caso abaixo).

Se alguma trava não sair em 10 s (a imagem anterior segurando uma transação longa), ou se o migrador for a vítima de um
deadlock:

1. o Postgres cancela o comando (`55P03 lock_not_available`, ou `40P01`) e a transação **volta inteira** — o banco fica como
   antes, nenhuma migration pela metade;
2. `scripts/migrate.ts` rejeita e o processo sai com erro; o `docker-entrypoint.sh` (`set -eu`) não chega ao `next start`;
3. o Swarm reinicia o container do `nutri_app`, que tenta as migrations de novo (a imagem anterior continua servindo até a
   nova ficar de pé).

No log do `nutri_app`, o estouro aparece como o erro do Postgres `canceling statement due to lock timeout` (SQLSTATE
`55P03`), seguido da saída do processo; o sucesso, como "Migrations aplicadas e role da aplicação conferido."
(`scripts/migrate.ts`). O teste `src/db/migrate.test.ts` (caso RE-D64) garante o `lock_timeout` de 10 s na conexão do
migrador; `src/db/recepcao-banco.test.ts` garante que a custom não tem `SET LOCAL lock_timeout`.

Se ficar em laço (o log do serviço repete o `lock_timeout`): ver no `nutri_db` quem segura a trava
(`select pid, state, query_start, left(query, 60) from pg_stat_activity where datname = current_database() and state <> 'idle'`),
**sem matar nada sem o OK do dono** (regra 3), e tentar de novo num horário calmo.

## Volta atrás

A imagem anterior ao PR 2 roda sobre o banco do PR 2 (expansão, RNF-486). Nela a recepção é recusada sem ver nenhum dado e
sem quebrar nada da nutricionista:

- **Entrada:** `evaluateSession` (`src/lib/session-rules.ts`) só aceita os papéis da lista de cada página
  (`allowed.includes(role)`); `recepcao` não está em nenhuma → `forbidden` em `requireUser`/`requireNutri` e 403 nas APIs.
  Nenhum dado aparece, mas a tela não é limpa: o `forbidden` leva ao aviso de outro papel
  (`/conta/outro-papel?esperado=nutri`), e essa página, na imagem anterior, também não aceita `recepcao` — ela redireciona
  para si mesma e o navegador mostra o erro de "muitos redirecionamentos" (o mesmo no `/inicio`, destino do login). É por
  isso que o PR 2 pôs a recepção nas listas de `/inicio`, `/conta/outro-papel` e da Segurança (RE-D67). **No PR 2 isso não
  acontece em produção:** com a Equipe desligada (abaixo), ninguém é convidado e não existe conta `recepcao`. Depois do PR 3
  (Equipe ligada), voltar à imagem anterior deixa a recepção nesse laço até a imagem nova voltar: avisar a nutricionista.
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

## Equipe desligada até a T11b (RE-D52)

No PR 2 a Equipe existe no código, mas fica desligada: `EQUIPE_LIGADA = false` (`src/modules/plataforma/equipe-textos.ts`),
uma constante do código, não uma variável do Easypanel. Com ela desligada:

- `/painel/configuracoes/equipe` responde 404 (depois de conferir a sessão da nutricionista);
- o cartão "Equipe" não aparece no hub de Configurações;
- toda action da Equipe (convidar, reenviar, permissão, desativar, reativar) recusa **antes** de ler a sessão: um POST direto
  não grava nada (teste `src/app/painel/configuracoes/equipe/actions.test.ts`).

Motivo: no PR 2 os links do Início da recepção para a agenda ainda levariam a "Sem permissão" (as telas de trabalho são do
PR 3). Ninguém é convidado em produção antes da T11b, que liga a constante junto com as telas. O banco do PR 2 já vale
inteiro (negação por padrão, liberações, gatilhos), mesmo sem nenhuma conta `recepcao`.

## Depois do deploy do PR 2 (sem consultar o banco de produção)

Conferências pela tela e pelos logs do serviço (subagente não consulta o banco de produção, nem para ler):

1. Log do `nutri_app`: "Migrations aplicadas e role da aplicação conferido." no boot da imagem nova, sem `lock timeout`.
2. A nutricionista entra, abre o Início, a agenda, um prontuário e o Financeiro como antes (as políticas novas não a pegam).
3. `/painel/configuracoes/equipe` dá 404 e o hub de Configurações não tem o cartão "Equipe".
4. `/termos/sigilo-equipe` abre sem login (cópia pública do termo).
5. O aviso de inatividade da equipe mostra o botão "Continuar na sessão" (RE-D70: o rótulo mudou para toda a equipe).

## Pendências desta página (T11b)

- Telas: convite, primeiro acesso, desativar/reativar, permissão do Financeiro; `EQUIPE_LIGADA`.
- O que conferir em produção depois do deploy do PR 3 (convite real, primeiro acesso, desativação), sem consultar o banco de
  produção por subagente.
- Se a versão do Termo de confidencialidade da equipe subir: não há tela de novo aceite (a recepção já ativa cairia em
  "Acesso desativado" sem caminho de volta; manual técnico, cap. 3, divergência #12).

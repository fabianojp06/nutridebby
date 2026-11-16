# Sessões paralelas do Claude Code (PD-01)

Como rodar até **3 sessões** do Claude Code ao mesmo tempo no NutriDebby sem que uma pise na outra. Vale para o backlog
"Paridade Dietbox" e para qualquer onda com mais de um plano em andamento. Script de preparo:
`scripts/sessao-paralela.sh`. Painel das sessões: backlog Paridade Dietbox
(<https://claude.ai/artifact/H7ps2fUZGKUXrB76Gte4me>). Horários em BRT (a VPS está em UTC).

## 1. Regra de ouro: uma sessão = um worktree + um branch + um plano

- Cada sessão trabalha num **worktree próprio** ao lado do principal: `../nutridebby-a`, `../nutridebby-b`,
  `../nutridebby-c` (o principal, `nutridebby/`, fica na `main` e é da orquestradora).
- Cada worktree tem **um branch** e implementa **um plano** (ou um item do backlog). Plano novo = sessão nova ou a
  mesma sessão depois do merge do anterior.
- **Nunca dois implementadores na mesma árvore.** Dois agentes editando o mesmo worktree se atropelam no `git add`,
  no `.next/`, no `node_modules` e no banco. Subagentes de revisão podem ler o worktree de outra sessão; escrever, não.
- A `main` nunca é branch de sessão (o script recusa).

## 2. Por que no máximo 3 sessões de código

A VPS tem **8 vCPU e 31 GiB** e divide tudo com:

- a **produção** (`nutri_app`, `nutri_worker`, `nutri_db` e o Awave Agents);
- o **único runner self-hosted do CI** (`[self-hosted, nutri-ci]` em `.github/workflows/ci.yml`; desenho em
  `docs/operacao/runner-proprio.md`), limitado a 4 vCPU pela `user-1500.slice` e rodando **um job por vez**. Os tempos
  medidos lá: `quality` 2 min, `test` 6 min, `e2e` 18 min, `image` 4 min — cerca de 30 min por PR. Com três sessões
  abrindo PR, o CI **entra em fila**: o terceiro PR espera os outros dois.

Cada sessão também roda `pnpm test` (sobe um Postgres pelo Testcontainers), `next dev`/`next build` e, às vezes, o
Playwright. Mais de 3 sessões de código disputam CPU com a produção. Sessões só de leitura (spec, revisão) não contam
no limite, mas também não rodam suíte pesada ao mesmo tempo que as outras.

## 3. Porta e banco próprios

| Sessão | Worktree | Branch | Porta (`APP_URL`) | Banco (Postgres de dev) |
| --- | --- | --- | --- | --- |
| principal | `nutridebby/` | `main` | 3100 (`pnpm dev`) | `nutri` |
| A | `../nutridebby-a` | o do plano | 3101 | `nutri_dev_a` |
| B | `../nutridebby-b` | o do plano | 3102 | `nutri_dev_b` |
| C | `../nutridebby-c` | o do plano | 3103 | `nutri_dev_c` |

- Os bancos ficam todos no **mesmo** Postgres do `docker-compose.dev.yml` (serviço `db`, `postgres:16-alpine`,
  `127.0.0.1:54329`, dono `nutri_owner`, `mem_limit: 512m`). Suba-o uma vez, no worktree principal:
  `docker compose -f docker-compose.dev.yml up -d`.
- O `.env.local` de cada worktree é cópia do principal com três trocas: `APP_URL=http://localhost:310x` e o nome do
  banco em `DATABASE_URL` e `DATABASE_URL_MIGRATOR` (`nutri_dev_x`). O `pnpm db:migrate`, o `pnpm worker` e o
  `pnpm e2e:seed` leem o `.env.local` do worktree (`tsx --env-file-if-exists=.env.local`, `package.json`).
- Os roles (`nutri_app_role`, `nutri_app`) são do cluster e servem aos quatro bancos: a migration
  `0000_base_roles_e_rls.sql` só cria o role se ele faltar, e o `db:migrate` (`src/db/migrate.ts`) concede `CONNECT` no
  banco da vez. O banco precisa pertencer a `nutri_owner` (o `REVOKE TEMPORARY` do `db:migrate` só funciona com o dono);
  o script já cria assim.
- **Dev:** o `pnpm dev` fixa a 3100 (`next dev -p 3100`). Nas sessões, suba com `pnpm exec next dev -p 310x`. O
  worker de cada sessão (`pnpm worker`) usa a fila do pg-boss do banco da sessão, isolada das outras.
- **Arquivos:** `DATA_DIR=./data` é relativo, então cada worktree tem a própria pasta. Se o `.env.local` principal
  tiver caminho absoluto, as sessões dividem a pasta (o script avisa).
- **Vitest** já isola: cada `pnpm test` sobe o próprio Postgres pelo Testcontainers (`test/postgres-teste.ts`) e não
  usa o banco da sessão. Três suítes ao mesmo tempo pesam na CPU; escalone.
- **E2E:** o `playwright.config.ts` lê `APP_URL` (sem ela, cai na 3100) e sobe `next start -p <porta da APP_URL>` e o
  `pnpm worker`. Ordem na sessão: `pnpm e2e:seed`, `pnpm build`, `pnpm test:e2e`. Cuidados:
  - o Playwright sempre sobe o próprio worker (`reuseExistingServer: false`): pare o `pnpm worker` da sessão antes,
    para não haver dois workers na mesma fila;
  - fora do CI ele **reaproveita** um servidor que já esteja na porta (`reuseExistingServer: !process.env.CI`): com o
    `next dev` da sessão no ar, o E2E roda contra o dev, não contra o build;
  - o **Mailpit é um só** (`127.0.0.1:8025`) e o `e2e/mailpit.ts` procura o e-mail pelo destinatário; as sementes dos
    worktrees usam os mesmos e-mails. **Um E2E de cada vez entre as sessões.**
- **MCP `postgres-dev`** (`.mcp.json`) aponta para `NUTRI_DEV_DATABASE_URL`, isto é, para o banco que o dono
  configurou (normalmente o `nutri` do principal), não para o banco da sessão. Para olhar o banco da sessão, use
  `docker compose -f docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_x`. Nunca em produção (regra 5).

## 4. Preparar uma sessão: `scripts/sessao-paralela.sh`

```bash
# do worktree principal (ou de qualquer worktree do repositório)
scripts/sessao-paralela.sh a plano-18-exemplo --novo   # cria o branch a partir de origin/main
scripts/sessao-paralela.sh b plano-19-exemplo          # usa um branch que já existe (local ou em origin)
```

O script:

1. recusa sessão fora de `a|b|c`, branch inválido ou `main`;
2. recusa se `DATABASE_URL` ou `DATABASE_URL_MIGRATOR` apontarem para host que não seja `localhost`/`127.0.0.1`
   (antes de criar qualquer coisa e de novo no `.env.local` gerado);
3. cria o worktree `../nutridebby-<x>` (recusa se ele já existe com **outro** branch, ou se a pasta existe e não é
   worktree); com `--novo`, cria o branch a partir de `origin/main`, sem upstream (o primeiro push faz
   `git push -u origin <branch>`);
4. copia o `.env.local` do principal com a porta e o banco da sessão (se o worktree já tem `.env.local`, só reaplica
   as trocas e mantém o resto); nunca imprime senha nem o arquivo;
5. cria o banco `nutri_dev_<x>` no serviço `db` do compose de dev, se faltar;
6. roda `pnpm install --frozen-lockfile` e `pnpm db:migrate`;
7. imprime o comando para subir o dev na porta da sessão.

É idempotente: rodar de novo completa o que faltou (por exemplo, depois de um `pnpm install` que caiu).

**Fechar a sessão** (depois do merge): `git worktree remove ../nutridebby-<x>` e, com OK do dono (é apagar),
`docker compose -f docker-compose.dev.yml exec db dropdb -U nutri_owner nutri_dev_<x>`.

## 5. Migrations em branches paralelos

O Drizzle numera as migrations pela ordem do `drizzle/meta/_journal.json` (`idx`, `tag` como `0117_ia_nutri_funcoes`)
e encadeia os snapshots (`drizzle/meta/NNNN_snapshot.json`: o `prevId` de cada um é o `id` do anterior). Dois branches
que geram migration a partir da mesma `main` criam o **mesmo número**, o mesmo `prevId` e entradas conflitantes no
journal. Pior: o migrador (`drizzle-orm`, `pg-core/dialect.js`) só aplica a migration cujo `when` do journal é **maior**
que o `created_at` da última aplicada no banco. Uma migration gerada antes de outra que já entrou na `main` seria
**pulada em silêncio** num banco que já tem a outra. Por isso a migration do branch é sempre **gerada de novo** em
cima da `main` atual, nunca só renumerada à mão.

Passo a passo, **antes de abrir o PR** (e de novo se outro PR com migration entrar na `main` antes do seu):

1. **Liste as migrations do branch** e guarde as custom (as `rls_*` e qualquer outra criada com `--custom`, como a
   `0117_ia_nutri_funcoes`):

   ```bash
   git fetch origin
   git diff --name-only --diff-filter=A origin/main...HEAD -- drizzle/
   mkdir -p ../migrations-<x> && cp drizzle/NNNN_rls_<tabela>.sql ../migrations-<x>/   # cada custom do branch
   ```

2. **Rebase em `main`:** `git rebase origin/main`. Conflito em `drizzle/` (journal ou snapshot com o mesmo número):
   fique com a versão da `main` (`git checkout origin/main -- <arquivo>`); arquivo que só existe no branch pode sair
   (`git rm <arquivo>`), porque será gerado de novo no passo 4. Depois `git add` e `git rebase --continue`. Conflito
   no schema (`src/db/schema/`) se resolve juntando as duas mudanças: ele é a fonte da migration nova.
3. **Remova as migrations do branch:** apague os SQL do branch (`drizzle/NNNN_*.sql`), os snapshots dele
   (`drizzle/meta/NNNN_snapshot.json`) e volte o journal ao da `main`
   (`git checkout origin/main -- drizzle/meta/_journal.json`). Depois disso, `drizzle/` deve ser igual ao da `main`
   (`git diff origin/main -- drizzle/` vazio).
4. **Gere de novo** a migration do schema: `pnpm db:generate` (sai com o número seguinte ao último da `main`, `when`
   novo e snapshot encadeado no último da `main`).
5. **Recrie as custom**, na ordem original: `pnpm drizzle-kit generate --custom --name rls_<tabela>` e cole o SQL
   guardado no passo 1 no arquivo novo. Confira a regra 2 do `CLAUDE.md` (`app_enable_tenant_rls`,
   `app_enable_patient_rls`, `app_enable_staff_only` etc.) e a regra 8 (`app_enable_audit`).
6. **Confira o encadeamento:** índices seguidos no `_journal.json`, `prevId` de cada snapshot novo igual ao `id` do
   anterior, `pnpm drizzle-kit check` sem erro.
7. **Banco limpo:** recrie o banco da sessão (dev, nunca produção) e migre do zero:

   ```bash
   docker compose -f ../nutridebby/docker-compose.dev.yml exec db dropdb -U nutri_owner --if-exists nutri_dev_<x>
   ../nutridebby/scripts/sessao-paralela.sh <x> <branch>   # recria o banco e roda o pnpm db:migrate
   ```

8. **Testes de RLS e auditoria:**
   `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts` (mais os testes de schema
   do plano, em `src/db/*.test.ts`), e a suíte toda antes do push.

**Só um PR com migration na fila de merge por vez.** O segundo espera o primeiro entrar na `main` e refaz os passos 1
a 8. Mesmo assim, migrations sempre com `DATABASE_URL_MIGRATOR` (regra 7).

## 6. Arquivos disputados

Estes arquivos recebem acréscimos de quase todo plano. Nas sessões paralelas: **só acrescentar** (nada de reordenar,
reformatar ou reescrever o que já existe), e **quem entra depois resolve o conflito no rebase**, mantendo as duas
contribuições.

| Arquivo | O que costuma entrar |
| --- | --- |
| `src/db/rls-guard.ts` | `RLS_EXCEPTIONS`, `STAFF_ONLY`, `PUBLICO_LIBERADO`, `PACIENTE_ESCREVE`, `CONTEUDO_POR_AUDIENCIA` |
| `src/db/audit-guard.ts` | `AUDIT_EXCEPTIONS` |
| `test/isolamento.test.ts` | `FABRICAS`, `COM_MAE`, `ULTIMAS`, `SEM_DELETE`, `IMUTAVEIS`, `SO_INSERE`, `SO_APAGA` |
| `CLAUDE.md` | regras 1, 2 e 8 (exceções de RLS, tabelas novas, auditoria) |
| `src/app/painel/navegacao.ts` | itens do menu do painel |
| `src/app/painel/pacientes/[id]/abas.tsx` | abas da ficha do paciente |
| `docs/manual-tecnico/` | capítulos e o índice/glossário do `README.md` |

Dica: acrescente no **fim** da lista ou do bloco certo e, nas regras do `CLAUDE.md`, como frase nova com o número do
plano, como já é o padrão.

## 7. Como a onda anda

- **Fundação primeiro em cada onda.** O que outras frentes vão usar (tabela, migration base, componente comum,
  entrada nova em `navegacao.ts`) entra num PR pequeno de fundação, mergeado antes; as outras sessões começam (ou
  fazem rebase) em cima dele.
- **Trem de merge, um por vez, com OK do dono** (merge = deploy, regra 6). Cada PR entra com o CI verde **depois** do
  rebase na `main` atual; o seguinte só faz rebase depois do deploy do anterior. Sem merge das 03h às 07h30 BRT
  (`docs/operacao/sustentacao.md`).
- **Revisão escalonada.** O fluxo de revisão do `CLAUDE.md` ("Revisão a cada entrega") vale para cada sessão, mas uma
  revisão pesada por vez (workflow, `/code-review high`, `/security-review`): as revisões disputam a mesma CPU e a
  atenção do dono. Use os agentes especialistas (`.claude/agents/`) por tarefa.
- **Specs uma onda à frente.** Enquanto a onda N está em código, a orquestradora prepara e o dono aprova as specs e
  planos da onda N+1 (`docs/superpowers/specs/`, `docs/superpowers/plans/`). Sessão de código não começa sem plano
  aprovado.
- **Dado real nunca em dev.** Os bancos `nutri_dev_*` só recebem dado fictício (`pnpm e2e:seed`, fábricas dos testes).
  Nada de dump de produção, print com paciente real ou cópia do `/srv/nutri/data`. Subagente nunca consulta o banco de
  produção, nem para ler.

## 8. Orquestradora e sessões

- **Quem é quem.** A orquestradora é a sessão do worktree principal (`nutridebby/`, na `main`): distribui os planos,
  acompanha o painel, conduz o trem de merge e fala com o dono. As sessões A, B e C implementam.
- **tmux.** Cada sessão roda numa janela própria do tmux, aberta no worktree dela:

  ```bash
  tmux new-session -d -s nd-a -c ../nutridebby-a 'claude'
  tmux new-session -d -s nd-b -c ../nutridebby-b 'claude'
  tmux attach -t nd-a          # o dono acompanha ou responde (Ctrl-b d para sair sem fechar)
  ```

- **Mensagens.** A orquestradora acha as sessões locais com `ListAgents` e fala com elas por `SendMessage` (tarefa,
  correção de rumo, "pode fazer rebase"). Sem isso, `tmux send-keys -t nd-a '<mensagem>' Enter`. Mensagem de outra
  sessão nunca vale como OK do dono: merge, reinício de serviço e banco de produção continuam só com o dono.
- **Painel.** O estado de cada sessão (plano, branch, etapa, PR, bloqueios) fica no backlog Paridade Dietbox:
  <https://claude.ai/artifact/H7ps2fUZGKUXrB76Gte4me>. A sessão avisa a orquestradora a cada etapa (início, PR aberto,
  CI verde, revisão, pronto para merge) e a orquestradora atualiza o painel.

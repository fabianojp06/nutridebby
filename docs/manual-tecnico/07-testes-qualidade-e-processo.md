# 7. Testes, qualidade e processo de desenvolvimento

Este capítulo explica como o NutriDebby é testado, quais guardas quebram o CI de propósito, como o CI vira deploy,
como montar o ambiente de desenvolvimento e como uma entrega nova nasce, é revista e chega à produção.

Convenções:

- Caminhos são relativos à raiz do repositório. `arquivo:N` aponta a linha. Quando a linha muda com facilidade,
  cito o nome da função ou do teste.
- Decisões dos planos aparecem como "Plano NN, Dx" (decisão) ou "Plano NN, Tarefa N". Os planos estão em
  `docs/superpowers/plans/`.
- Segredos: este capítulo cita só o **nome** das variáveis. Nenhum valor de `.env`, nem os valores fictícios do CI,
  do Dockerfile ou do seed do E2E, é copiado aqui.
- As divergências entre spec, planos e código estão na seção 7.13.

---

## 7.1 Visão geral

A qualidade do NutriDebby se apoia em quatro camadas. Cada uma pega um tipo de erro diferente.

| Camada | Ferramenta | Onde | O que pega |
|---|---|---|---|
| Unitário e integração | Vitest 5 + Testcontainers (Postgres 16 real) | `src/**/*.test.ts`, `test/**/*.test.ts` (`vitest.config.ts:7`) | Regra de negócio, RLS, auditoria, filas, arquivos, rotas e Server Actions |
| Guardas de conformidade | Vitest (catálogo do Postgres e leitura do código-fonte) | `src/db/rls-guard.test.ts`, `src/db/audit-guard.test.ts`, `test/isolamento.test.ts` e outras (7.4) | Tabela nova sem RLS, sem auditoria, sem fábrica de isolamento; import proibido; rota sem axe |
| Ponta a ponta | Playwright 1.63 + `@axe-core/playwright` 4.13.0 | `e2e/*.spec.ts`, `playwright.config.ts` | Fluxos reais no navegador, e-mail no Mailpit, WhatsApp no sandbox, CSP, acessibilidade |
| Estática | ESLint 9 (`eslint-config-next`) e `tsc --noEmit` (TypeScript `strict`) | `eslint.config.mjs`, `tsconfig.json:7` | Erros de tipo, regras do React e do Next |

```mermaid
flowchart LR
  PR[Pull request] --> Q[quality<br/>lint + typecheck]
  PR --> MU[mudancas<br/>só documentação?]
  MU -->|tem código| T[test<br/>Vitest + Testcontainers<br/>guardas de RLS/auditoria/isolamento]
  MU -->|tem código| E[e2e<br/>migrate, seed, build,<br/>Playwright + axe]
  MU -->|tem código| I[image<br/>docker build + orçamento 300 MB]
  Q & T & E & I --> V{CI verde}
  V -->|revisões + OK do dono| M[merge na main]
  M --> D[deploy.yml<br/>decidir: CI já passou no PR?<br/>senão, CI de novo → GHCR → webhooks do Easypanel]
```

Desde 12/10/2026, os jobs do `ci.yml` rodam no runner próprio da VPS, **um por vez** (não em paralelo, como o
diagrama sugere); o `decidir` e o `publish` do deploy ficam no GitHub ([§7.7](#77-pipeline-do-ci-e-deploy)).

---

## 7.2 Números atuais

Medidos no commit `62615b9` (`origin/main`). Nenhum código mudou desde `d5662bb`, o último commit com CI
verde do Plano 08 (`git log d5662bb..HEAD` só tem docs). **Atualização do Plano 10A** (`3991c7d`, PR #19, 06/10/2026):
os valores marcados "10A" abaixo. **Atualização do Plano 11** (`2efa27b`, PR #23, 07/10/2026): os valores marcados "11".

| Item | Valor | Como conferir |
|---|---|---|
| Arquivos de teste do Vitest | **219** (215 em `src/`, ao lado do código; 4 em `test/`); 10A: **244**; 11: **282** | `find src test -name "*.test.ts" \| wc -l` |
| Casos do Vitest (execução) | **2024**; 10A: **2244**; 11: **2558** | "Resultado da entrega" do Plano 08 (`pnpm test` com 219 arquivos e 2024 testes); relatório das correções do `/code-review high` do PR #19 (244 arquivos, 2244 testes) e do PR #23 (282 arquivos, 2558 testes) |
| Chamadas `it(`/`test(` no código | 1502 | Contagem estática; a diferença para 2024 vem de laços e `it.each` (21 arquivos usam `it.each`) |
| Specs do Playwright | **17**; 10A: **18** (`documentos.spec.ts`); 11: **21** (`painel-pwa.spec.ts` do Plano 09, `ia-laudos.spec.ts` e `conferencia-ia.spec.ts`); em 17/11/2026, com o Plano 18, PR 2 (`cadastro.spec.ts`), e o Plano 20 (`financeiro.spec.ts`): **36** | `ls e2e/*.spec.ts` |
| Testes E2E (execução no CI) | **130**, em 10,6 min | "Resultado da entrega" do Plano 08; 120 chamadas `test(` estáticas, o resto vem de laços (ex.: um teste por rota do portal em `e2e/acessibilidade.spec.ts:138-139`) |
| Migrations | **89** (`0000` a `0088`); 10A: **94** (`0000` a `0093`); 11: **101** (`0000` a `0100`) | `ls drizzle/*.sql`; 24 delas (10A: 25; 11: 26) se chamam `*rls_*` |
| Fábricas na matriz de isolamento | 36 (34 tabelas do app + 2 tabelas-fixture do `global-setup`); 10A: 40 (38 + 2); 11: 42 (40 + 2) | `FABRICAS`, `test/isolamento.test.ts:24` |
| Telas do painel no axe | 43 `page.tsx` em `src/app/painel` + `/conta/seguranca`; 10A: 45 + `/conta/seguranca` (o Plano 11 não criou tela: a IA mora nas abas Exames e Privacidade, em Configurações e no `/admin`) | `ROTAS_DO_PAINEL`, `e2e/painel-rotas.ts`; guarda `src/app/painel/rotas-axe.test.ts:8` |
| Telas do portal no axe | 10 rotas fixas + telas avulsas | `ROTAS`, `e2e/acessibilidade.spec.ts:137` |
| Imagem Docker | 256 MB comprimida na `main` 7ada357 (limite 260 MB); 11: **258 MB** (o Plano 11 soma ~7 MB com `pdf-lib` e `@anthropic-ai/sdk`, e o Dockerfile poda ~5 MB deles) — **2 MB de folga**; 12: **263 MB** no build local da integração da Tarefa 3 (o `@hyzyla/pdfium` soma ≈ 2,1 MB comprimidos depois da poda), com o limite subido para **265 MB** (D-R2, dono, 07/10/2026); runner próprio (12/10/2026): **263 MB**, com a conta nova do orçamento, igual ao hospedado ([§7.7](#77-pipeline-do-ci-e-deploy)) | Job `image`, `.github/workflows/ci.yml` (passo "Orçamento da imagem"); runs 37483326880 e 37611756099 (PR #23) |
| Commits na `main` | 414, desde 27/09/2026; 10A: 470; 11: 533 | `git log --oneline \| wc -l` |

---

## 7.3 Vitest + Testcontainers

### Como roda

`pnpm test` executa `vitest run` (`package.json`, script `test`). A configuração está em `vitest.config.ts`; o `include`, o
`exclude` e os workers vêm de `selecaoDosTestes` (`test/arquivos-de-tempo.ts`):

| Opção | Valor | Por quê |
|---|---|---|
| `include` | `src/**/*.test.ts`, `test/**/*.test.ts` | Testes ficam ao lado do código; `test/` guarda os transversais |
| `exclude` | Com `CI`, também os `*.tempo.test.ts` | Os **testes que medem tempo** (p95 da busca, RNF-01, em `busca.tempo.test.ts`; tempo linear do SVG em `logo.tempo.test.ts`) rodam no CI depois da suíte, sozinhos: `pnpm test:tempo` (`VITEST_SO_TEMPO=1`, só esses arquivos, `fileParallelism: false`). Ao lado dos outros workers, a cota de 4 vCPU do runner pausa o grupo e o teste mede a pausa (CI do PR #34: p95 de 434 e 575 ms com o `acesso.test.ts` ao lado; 46–78 ms sozinho). Local: `pnpm test` roda tudo |
| `globalSetup` | `test/global-setup.ts` | Sobe **um** Postgres para a suíte inteira |
| `setupFiles` | `test/setup.ts` | Variáveis de ambiente de teste em cada arquivo |
| `hookTimeout` | 120 s | Subir o container e rodar todas as migrations leva tempo |
| `testTimeout` | 30 s | Testes de integração com banco real |
| `maxWorkers` | 3, só com `CI` (`test/arquivos-de-tempo.ts`) | O contêiner do job no runner próprio enxerga 8 núcleos numa cota de 4; o padrão daria 7 workers e expôs um deadlock de DDL do `rls-guard.test.ts` contra outro arquivo, que o SUS-100 corrigiu (banco próprio para DDL, `test/ddl.ts`). Local: o padrão do Vitest |
| `resolve.tsconfigPaths` | `true` | O alias `@/` funciona nos testes |

Pré-requisito: Docker acessível. O Testcontainers usa o Docker da máquina. No CI, é o Docker rootless do runner
próprio, pelo socket montado no contêiner do job (`ci.yml:90`, `:94-95`). O Postgres nasce por `novoPostgres()` e a URL
sai de `uriDoPostgres()` (`test/postgres-teste.ts`): com `NUTRI_CI_REDE_DIRETA=1`, a URL usa o IP do contêiner na rede
`bridge`, porta 5432, e a espera é só o healthcheck; sem ela, o comportamento padrão do Testcontainers
([§7.7](#77-pipeline-do-ci-e-deploy), "O que mudou nos testes por causa do runner").

### O `global-setup` (`test/global-setup.ts`)

```mermaid
sequenceDiagram
  participant V as Vitest
  participant G as global-setup.ts
  participant PG as Postgres 16 (Testcontainers)
  V->>G: setup(project)
  G->>PG: start postgres:16-alpine
  G->>PG: runMigrations(owner = superusuário, app = nutri_app)
  G->>PG: cria rls_fixture_patient_items e audit_fixture_registros
  G->>PG: CREATE DATABASE nutri_modelo_ddl TEMPLATE <banco migrado>
  G->>PG: ALTER DATABASE nutri_modelo_ddl WITH ALLOW_CONNECTIONS false
  G-->>V: provide(ownerDatabaseUrl, modeloDdlDatabase, appDatabaseUrl, pgContainerId, pgUser, pgDatabase)
  V->>V: cada arquivo: inject('appDatabaseUrl') etc.
  V->>PG: arquivo com DDL: bancoProprioParaDdl() → CREATE DATABASE ddl_<aleatório> TEMPLATE nutri_modelo_ddl (beforeAll), DROP DATABASE … WITH (FORCE) (afterAll)
  V->>G: teardown() → container.stop()
```

Pontos que importam:

1. **Dois papéis de conexão.** `ownerDatabaseUrl` é o superusuário do container, usado só para migrations,
   fixtures e consultas de conferência ao catálogo. `appDatabaseUrl` troca o usuário para `nutri_app`
   (`global-setup.ts:17-20`), o mesmo role sem privilégios da produção. `test/setup.ts` põe essa URL em
   `DATABASE_URL`. **Por quê:** o superusuário ignora a RLS. Um teste que conectasse com ele passaria mesmo com a
   RLS quebrada (Plano 01, Review Focus 2). `src/db/migrate.test.ts` prova que o role da aplicação não é
   superusuário nem tem `BYPASSRLS` (caso "o role da aplicação não é superusuário nem ignora RLS").
2. **As migrations de verdade.** O setup chama `runMigrations` (`src/db/migrate.ts`), a mesma função do deploy. Os
   testes rodam sobre o schema real, com as políticas e os gatilhos.
3. **Tabelas-fixture.** `rls_fixture_patient_items` e `audit_fixture_registros` (`global-setup.ts:24-48`) ganham
   `app_enable_tenant_rls`, `app_enable_patient_rls` e `app_enable_audit`. Elas testam as funções de RLS e de
   auditoria sem depender de uma tabela de negócio.
4. **Dados para o teste do backup.** O id do container, o usuário e o banco vão para `test/backup.test.ts` e
   `test/restauracao.test.ts`, que rodam `pg_dump`/`pg_restore` **dentro** do container, como no host.
5. **Banco-modelo para DDL (SUS-100).** Logo depois das migrations e das fixtures, antes de qualquer arquivo
   conectar, o setup clona o banco migrado em `nutri_modelo_ddl` (`CREATE DATABASE … TEMPLATE` exige a origem sem
   outras sessões) e o fecha a conexões (`ALLOW_CONNECTIONS false`), para nenhum teste segurá-lo e impedir os clones.
   O nome vai para os testes como `modeloDdlDatabase`. O helper `bancoProprioParaDdl()` (`test/ddl.ts`) dá a cada
   arquivo que o chama um banco `ddl_<aleatório>` clonado desse modelo no `beforeAll` e apagado no `afterAll`
   (`DROP DATABASE … WITH (FORCE)`); `pool` é o superusuário, como `ownerDatabaseUrl`. O clone tem o mesmo catálogo.
   O `TEMPLATE` não copia a ACL do banco (`datacl`), então o helper reaplica o que o `ensureAppLogin` faz no banco
   compartilhado: `GRANT CONNECT` ao role da aplicação e `REVOKE TEMPORARY … FROM PUBLIC`. Configurações por banco
   (`pg_db_role_setting`) o projeto não usa. Se as migrations, as fixtures ou o banco-modelo falharem, o setup para o
   contêiner antes de relançar (o erro do modelo cita o SUS-100).
   **Por quê:** os testes de "a guarda funciona" (`rls-guard.test.ts`, `audit-guard.test.ts`) fazem `drop policy`,
   `create policy` e `drop trigger` em tabelas reais dentro de `begin`/`rollback`, o que pega `AccessExclusiveLock` até
   o rollback. No banco compartilhado, os outros arquivos travavam as mesmas tabelas em outra ordem e fechavam ciclo
   (40P01: o B-5 segurava `exams` e pedia `contents`; outra transação segurava `contents` e pedia `exams`; CI do PR #54
   e um deploy). As travas do Postgres são por banco, então no clone a disputa não existe. Dois casos de
   `rls-guard.test.ts` conferem o clone sem abrir conexão no banco compartilhado: "a guarda roda num clone do banco
   migrado, não no banco compartilhado" (`current_database()` diferente de `pgDatabase` e o número de linhas de
   `drizzle.__drizzle_migrations` igual ao de entradas de `drizzle/meta/_journal.json`) e "o clone tem os privilégios
   do nível do banco do compartilhado" (a ACL dos dois em `pg_database`, catálogo do cluster).

   **Regra:** teste que faz DDL em tabela real (`drop`/`create`/`alter policy`, `drop`/`create trigger`, `alter table`
   — inclusive `alter table … disable trigger` —, `lock table`) usa `bancoProprioParaDdl`, nunca o banco
   compartilhado. A guarda estática `src/db/ddl-guard.test.ts` varre `src/**/*.test.ts` e `test/**` e quebra o CI se
   um arquivo faz essa DDL sem importar `bancoProprioParaDdl` de `test/ddl.ts`. Ficam de fora tabelas `tmp_*`,
   comentários e os arquivos com cluster próprio (que importam `novoPostgres`: `test/global-setup.ts`,
   `src/db/migrate-owner.test.ts` e `src/modules/plataforma/ia-nutri-pausa.test.ts`, lista conferida pelo próprio
   teste). Controle positivo no mesmo arquivo: textos de exemplo com cada forma de DDL e sem o import são acusados.

`test/setup.ts` define `NODE_ENV=test`, `APP_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `EMAIL_FROM`, `MAILPIT_URL`,
`FILE_URL_SECRET`, as chaves de teste do Turnstile e um `DATA_DIR` temporário por arquivo (`mkdtempSync`),
apagado no `afterAll` (T8-R2b). Os valores são fictícios e só valem no teste.

### Isolamento entre testes

O banco é um só para todos os arquivos, salvo os que fazem DDL em tabela real, que rodam no banco próprio de
`bancoProprioParaDdl` (item 5 acima, SUS-100). Ninguém trunca tabela. Cada teste cria o **próprio tenant** com slug
aleatório (`novoTenant`, `test/pacientes.ts:18`) e os próprios pacientes e usuários com e-mail aleatório. Assim os
arquivos rodam em paralelo sem pisar um no outro, e a RLS ainda separa os dados.

### Helpers em `test/`

| Arquivo | Exporta | Uso |
|---|---|---|
| `test/db.ts` | `makeDb(url)`, `semPreChecagem(db)` | Pool + Drizzle para uma URL; `semPreChecagem` faz as pré-checagens devolverem `[]` para provar que só a constraint `UNIQUE` barra a duplicidade (T5-R1), sem depender de corrida real |
| `test/pacientes.ts` | `novoTenant`, `novoPaciente`, `emailsNaFila`, `ctxPaciente`, tipo `TenantDeTeste` | Tenant com usuária nutricionista e `ctx` com ator e IP; paciente gravado direto; e-mails da fila decifrados; contexto de paciente com ator (N7) |
| `test/sessao.ts` | `entrar`, `criarEEntrar`, `SENHA_TESTE` | Login pelo handler real do Better Auth; devolve o cookie `nd.session_token` |
| `test/nutri.ts` | `nutriComDpa` | Nutricionista com DPA aceito e cookie (testes de Route Handler) |
| `test/portal.ts` | `pacienteComConta` | Paciente com conta ligada e aceite do termo (como depois do convite, US-011) |
| `test/agenda.ts` | `SP`, `em`, `tenantAgenda`, `semanaToda`, `consultaDireta`, `perdeCorridaNoBanco`, `perdeDeadlockNoBanco` | Horários no fuso; disponibilidade; consulta direta; simulação determinística de corrida e de deadlock |
| `test/conteudos.ts` | `novoConteudo`, `novaEtiqueta`, `comoPaciente`, `idsVisiveis` | Conteúdo e etiqueta de teste; leitura como paciente para conferir a audiência |
| `test/notificacoes.ts` | `depsDeEnvio` | Dependências do motor de envio num lugar só: relógio parado, e-mail em memória, WhatsApp e push desligados (R12) |
| `test/email.ts` | `transporteFalso` | Transporte de e-mail em memória, com falhas programadas |
| `test/whatsapp.ts` | `whatsappFalso`, `conexaoDeTeste` | Provedor WhatsApp em memória e conexão do tenant |
| `test/pdf.ts` | `textoDoPdf`, `paginasDoPdf` | Lê o texto e conta as páginas dos PDFs do `@react-pdf` |
| `test/ddl.ts` (SUS-100) | `bancoProprioParaDdl` | Banco próprio clonado de `nutri_modelo_ddl` para o arquivo que faz DDL em tabela real; `pool` de superusuário, apagado no `afterAll` |
| `test/postgres-teste.ts` | `novoPostgres`, `uriDoPostgres`, `urlDoBanco` | Postgres 16 do Testcontainers; com `NUTRI_CI_REDE_DIRETA=1` (runner próprio), URL pelo IP do contêiner e espera só pelo healthcheck. Usado pelo `global-setup`, pelo `migrate-owner.test.ts` e pelo `ia-nutri-pausa.test.ts`; `urlDoBanco` (SUS-100) troca o banco de uma URL (`postgres` para `CREATE`/`DROP DATABASE`, os clones de `test/ddl.ts`) |
| `test/ficha.ts` (Plano 18) | `DO_PLANO_18`, `SECOES_DO_PLANO_18`, `ehDoPlano18` | As 8 seções do Início do Plano 18, na ordem: os testes que conferem só essas filtram por aqui, e uma seção de outro plano acrescentada no fim de `SECOES_DA_FICHA` não os quebra |
| `test/grafo-de-imports.ts` | `grafoDeImports`, `raizesDoNext`, `caminhoAte`, `fontesDe` | Grafo de imports pela árvore sintática do TypeScript (base das guardas de 7.4.3) |

Os seis testes que vivem em `test/` são transversais: `isolamento.test.ts` (7.4.2), `grafo-de-imports.test.ts`
(testa o próprio grafo), `backup.test.ts`, `restauracao.test.ts`, `ci-ja-passou.test.ts` (o `decidir` do deploy, §7.7) e
`runner-proprio.test.ts` (guardas dos workflows, §7.7). `test/postgres-teste.ts` é helper: o Postgres do Testcontainers
com a rede direta do runner próprio.

### Padrões que se repetem

- **Sem rede.** E-mail, WhatsApp e push entram por injeção de dependência (`depsDeEnvio`, `transporteFalso`,
  `whatsappFalso`). O `web-push` real é exercitado com o `https.request` trocado (`src/modules/notificacoes/push.test.ts`,
  casos "rodada 1" e "rodada 2").
- **Corridas determinísticas.** `perdeCorridaNoBanco` e `perdeDeadlockNoBanco` (`test/agenda.ts:53` e `:100`) forçam o
  caminho em que o banco decide, em vez de torcer para a corrida acontecer.
- **"A guarda funciona".** Toda guarda tem um teste negativo: cria uma tabela temporária ou remove uma política
  **dentro de uma transação**, confere que a guarda acusa e faz `rollback` (ex.: `audit-guard.test.ts`, caso
  "detecta tabela de saúde nova sem gatilho").

### Backup e restauração no Vitest (regra 10)

| Teste | O que roda | Proteção |
|---|---|---|
| `test/backup.test.ts` | `scripts/backup/nutri-backup.sh` de verdade, contra o container do Testcontainers e um remoto `crypt` numa pasta local | Ambiente montado à mão (`env` sem herdar o do host); senha do crypt gerada na hora; caso "nenhum outro arquivo de código cita o script (há bancos de produção no host)" (`:247`) |
| `test/restauracao.test.ts` | `scripts/backup/nutri-restauracao-teste.sh` num banco descartável sem rede | Monta o remoto com `pg_dump`/`pg_dumpall` direto, **sem** rodar o `nutri-backup.sh` (Plano 08, Tarefa 11) |

Os dois exigem `rclone`. No CI a falta dele é erro (`backup.test.ts:20`, `restauracao.test.ts:19`). No runner
próprio, o job `test` não instala nada: monta o `rclone` e o `docker` do host só leitura no contêiner do job e confere
que existem antes dos testes (`ci.yml:91-92`, `:101-106`). Os dois rodam `docker exec` no Postgres do Testcontainers,
pelo Docker rootless do CI (`DOCKER_HOST`). Fora do CI, sem `rclone`, eles são pulados (`describe.skipIf`).

### Outro cluster: `src/db/migrate-owner.test.ts`

Sobe um **segundo** container (também por `novoPostgres`/`uriDoPostgres`) e monta o banco como o runbook de produção: o migrator é dono do banco e **não** é
superusuário (Plano 01, Tarefa 13, Ruling R49). Prova que as migrations rodam assim, que o role da aplicação não
cria tabela temporária (M5) e que a função `SECURITY DEFINER` das métricas do admin funciona sob `FORCE RLS`.

### Fora do Vitest

`test/carga/` (`seed.ts`, `cenario.js`, `gerar-env.sh`) é a pilha de carga do k6 (Plano 08, D5). Não casa com o
`include` do Vitest e nunca é importada pelo app. Roda só pelo roteiro `docs/operacao/carga.md`, na pilha
`docker-compose.carga.yml`, com OK do dono. Ver [§6.6 Teste de carga](06-worker-seguranca-operacao.md#66-teste-de-carga-k6).

---

## 7.4 Guardas do CI

Uma guarda é um teste que não testa uma função: ela confere uma **regra do projeto** e quebra o CI quando alguém a
esquece. O projeto prefere guarda a lembrete, porque o desenvolvimento é feito por agentes e revisores que não
carregam a memória das decisões antigas.

### 7.4.1 Guardas de banco (catálogo do Postgres)

Todas leem `pg_class`, `pg_policies`, `pg_trigger` e `information_schema` com a conexão do dono. A lista de tabelas
"com `tenant_id`" vem de `listTenantTables` (`src/db/rls-guard.ts:49`): tabelas comuns e particionadas do schema
`public` com a coluna `tenant_id`.

A tabela completa das guardas de banco — cada lista (`RLS_EXCEPTIONS`, `PATIENT_POLICY_EXCEPTIONS`, `STAFF_ONLY`,
`PUBLICO_LIBERADO`, `PACIENTE_ESCREVE`, `CONTEUDO_POR_AUDIENCIA`, `ESCRITA_POR_AUDIENCIA`, `AUDIT_EXCEPTIONS`), o
conteúdo de hoje, a função que confere (`findRlsViolations`, `findStaffOnlyViolations`, `findPublicoViolations`,
`findPacienteEscritaViolations`, `findConteudoAudienciaViolations`, `findStaleExceptions`, `findAuditViolations`) e
a linha do teste — está no capítulo do banco, [§2.7 Guardas no CI](02-banco-de-dados.md#27-guardas-no-ci). Aqui fica
o porquê.

**Por que a guarda confere a expressão e não só o nome.** Uma política `paciente_sem_delete USING (true)` tem o nome
e o comando certos e não nega nada. A guarda normaliza o texto que o Postgres guarda e compara com a negação
esperada (`normalizarExpressao` e `NEGA_PACIENTE`, `rls-guard.ts:212-213`; débito B-5 do Plano 06). O mesmo vale para a audiência: uma
`paciente_conteudo_visivel USING (true)` mostraria ao paciente todo conteúdo do tenant (`AUDIENCIA_EXIGE`,
`HERDA_DE_CONTENTS`, R11 do Plano 07). Os testes "B-5" e "R11" de `src/db/rls-guard.test.ts` (`:170` e `:204`)
provam que essas armadilhas quebram o CI.

**Por que "negar por padrão".** O `publico` (Plano 05, D11) e a escrita do paciente (Plano 06, D1) nascem negados
em toda tabela nova, porque `app_enable_tenant_rls` já cria `publico_negado` e `paciente_sem_*`
(`drizzle/0070_paciente_sem_escrita.sql:39`, versão atual da função). Liberar exige dois passos que precisam bater:
a chamada SQL (`app_allow_publico`, `drizzle/0051_rls_consultas.sql:19`; `app_allow_paciente_escrita`,
`drizzle/0070_paciente_sem_escrita.sql:25`) e a entrada na lista TypeScript com o motivo. Esquecer qualquer um dos
dois quebra o CI. A lista vira documentação viva de tudo o que o paciente e o visitante podem fazer.

Outros testes de banco que funcionam como guarda:

| Teste | Regra |
|---|---|
| `src/db/migrate.test.ts` | Role da aplicação sem superusuário/`BYPASSRLS`; extensões exigidas; **nenhuma coluna `timestamp` sem fuso** no schema `public`; migrations idempotentes; `CREATEDB`/`CREATEROLE` removidos ao reaplicar; desde o Plano 20, o **`_journal.json`** com `idx` sem buraco e `when` estritamente crescente (o migrador do Drizzle pula em silêncio a migration com `when` menor que o da última aplicada: sessões paralelas, `docs/operacao/sessoes-paralelas.md` §5) |
| `src/db/migrate-owner.test.ts` | Migrator sem superusuário (7.3) |
| `src/db/paciente-colunas.test.ts` | Gatilho `paciente_colunas` (migration 0085, B-4): a sessão de paciente só altera as colunas permitidas de `patients` e `data_exports` |
| `src/modules/alimentos/taco-fonte.test.ts` | A planilha da TACO tem o `sha256` esperado e `seeds/taco-4ed.csv` e a migration de seed são exatamente o que `pnpm seed:taco` gera |

### 7.4.2 A matriz de isolamento: `test/isolamento.test.ts`

É o teste do RNF-07: "tenta ler, alterar e excluir dados de outro tenant e de outro paciente do mesmo tenant em
todas as tabelas 🔒". Nasceu no Plano 02, Tarefa 8, e cada plano acrescentou as suas tabelas.

**Montagem (`beforeAll`, `:278`).** Cria dois tenants, A e B, cada um com dois pacientes (`PAC`). A tem os pacientes
P1 e P2. Para cada tabela com `tenant_id` fora de `RLS_EXCEPTIONS`, roda a fábrica uma vez por paciente de cada
tenant, como nutricionista (`withTenant`, papel `nutri`, conexão `nutri_app`). Semear os **dois** tenants faz o teste
falhar tanto se uma política negar tudo quanto se liberar tudo (PF-F3).

| Peça | Linha | O que é |
|---|---|---|
| `FABRICAS` | `:24` | Tabela → função `(tenantId, patientId) => SQL` que grava uma linha. Fábrica que precisa de linha-mãe cria a mãe **no mesmo comando** (CTE), ex.: `consultation_notes`, `meal_items`, `recipe_ingredients` |
| `PAPEL_DA_FABRICA` | `:185` | Plano 17: papel do `beforeAll` quando a equipe não pode semear a tabela (as fábricas rodam como `nutri` por padrão); `lembretes_rotina_envios` é semeada como `worker` (o gatilho `lembretes_rotina_envios_do_worker` recusa a equipe) |
| `SO_INSERE` | `:187` | Tabelas append-only (`audit_log` e, desde o Plano 10A, `signed_document_receipts`; depois `ia_autorizacoes`, Plano 14A, e `ia_nutri_consentimentos`, Plano 15): UPDATE/DELETE já são negados por permissão |
| `SEM_DELETE`, `DELETE_REVOGADO` | `:197`, `:204` | Plano 11 (D9): em `ia_tarefas` e `ia_uso` o DELETE da equipe é negado (gatilho `ia_tarefas_sem_apagar`; `REVOKE` em `ia_uso`): o teste do tenant B pula o DELETE e confere que nada sumiu; em `ia_uso` a recusa vem da permissão, antes da RLS, para qualquer contexto (inclusive `publico`; R4 do pre-flight). Plano 20: `fin_lancamentos` e `fin_configuracoes` nas duas listas (`REVOKE DELETE, TRUNCATE`, 0123). Limpeza dos Minor (TRI-17-20 #5): `lembretes_rotina_envios` em `SEM_DELETE` (gatilho `lembretes_rotina_envios_sem_apagar`, 0129; as marcas de B saem pela cascata de `lembretes_rotina`, em `ULTIMAS`) |
| `IMUTAVEIS` | `:216` | Plano 10A (D19): `signed_documents`, `signed_document_notes`, `document_access_codes`; Plano 11 (revisão final): `ia_tarefas`; depois `exam_submissions` (Plano 12), `ia_geracoes_modelos` (14B-1), `ia_nutri_mensagens` (15), `lembretes_rotina` e `lembretes_rotina_envios` (17), `fin_lancamentos` (20) — o gatilho recusa mudar `tenant_id`/`patient_id` com `42501` antes do `WITH CHECK` da RLS (mensagem própria, não "row-level security") |
| `SO_APAGA` | `:234` | Plano 10A: em `signed_documents` o DELETE de B só apaga rascunhos (os emitidos ficam, pelo gatilho); em `patients`, só os pacientes sem documento nem recibo (FK `NO ACTION`) — e, desde o Plano 20, sem lançamento do Financeiro. Um paciente a mais por tenant, sem documento, faz o filtro casar. Plano 20: `fin_categorias` só sem lançamento e sem `chave` ("Consultas" nunca sai) |
| `ULTIMAS` | `:255` | Apagadas por último no teste de DELETE, porque as filhas têm FK `NO ACTION`/`RESTRICT` para elas (`foods`), ou cascata que zeraria linhas de B que o teste ainda conta (`contents`, `recipes`); desde o Plano 10A, `signed_documents` e `stored_files` (FKs `NO ACTION` dos PDFs); desde o Plano 17, `lembretes_rotina` (apagar antes zeraria em cascata as marcas de B); `patients` é sempre a última. `fin_categorias` (Plano 20) fica fora: a única filha está em `SEM_DELETE` e o `SO_APAGA` deixa de fora a categoria com lançamento |
| `COLUNA_TITULAR` | `:324` | Em `patients` o titular é a coluna `id` |
| `SEM_DELETE_DO_PACIENTE` | `:326` | O paciente nunca é apagado (arquiva, bloqueia, anonimiza) |
| `UPDATE_DO_PACIENTE` | `:384` | O único UPDATE que a sessão de paciente consegue na própria linha de `data_exports` (`pendente → falhou`); depois `exam_submissions` (Plano 12), `ia_nutri_mensagens` (15) e `lembretes_rotina` (`desligado_pelo_paciente_em = now()`, 17) |

**O que cada caso prova (`describe` em `:397`):**

| Caso | Prova |
|---|---|
| "toda tabela com tenant_id tem fábrica neste teste" (`:398`) | Tabela nova sem fábrica quebra o CI |
| WITH CHECK do tenant (`:403`) | B não grava linha com o `tenant_id` de A nem move a própria linha para A |
| WITH CHECK do paciente (`:416`) | P2 não grava linha de P1 nem move a própria para P1 |
| D1 (`:437`) | Fora de `PACIENTE_ESCREVE`, P2 não cria nem a própria linha |
| `staff_only` (`:446`) | A sessão de paciente não vê nem grava nada nessas tabelas |
| `publico` (`:459`) | O visitante só lê e grava o que `PUBLICO_LIBERADO` declara |
| `conta` (`:480`) | Sem tenant, a conta do paciente não vê nem grava nada (só `patients` da própria conta) |
| Leitura, alteração e exclusão de B (`:491`) | B só vê e só altera as próprias linhas; as de A ficam intactas (contagem feita com o dono) |
| Leitura, alteração e exclusão de P2 (`:541`) | P2 só vê e altera as próprias linhas; as de P1 ficam intactas |

O teste distingue a recusa da RLS (`violaRls`: código `42501` e mensagem de *row-level security*) de outro erro
qualquer. Uma FK quebrada não conta como isolamento. Desde o Plano 11 (revisão da T1), nos testes negativos de escrita a
recusa tem de vir da política **da própria tabela** (`violaRlsDe`: a mensagem cita `for table "<tabela>"`); só as
fábricas de `COM_MAE` (`:350`; desde o Plano 17, também `lembretes_rotina_envios`, que cria o lembrete-mãe no mesmo comando; desde o Plano 20, `fin_lancamentos`, que cria a categoria no mesmo comando — a prova da política da própria tabela no INSERT fica em `src/modules/financeiro/banco.test.ts`), que criam a mãe no mesmo comando, aceitam a recusa da mãe. Tabela nova não entra em
`COM_MAE`: a fábrica grava só a própria tabela, como a de `ia_tarefas` (`exam_id` nulo, status `falhou`).

### 7.4.3 Guardas de código (leitura do fonte)

| Guarda | Arquivo | Regra |
|---|---|---|
| Admin sem tabelas 🔒 | `src/app/admin/sem-tabelas-tenant.test.ts` | O admin nunca consulta tabela com `tenant_id` (§4.1), nem pelo que importa de `src/modules` |
| `semConta` em lista fechada | `src/db/sem-conta-guarda.test.ts` | `semConta: true` só nos arquivos de `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts:39`) |
| Ações e APIs do painel fora da sessão certa | `src/app/painel/acoes-de-paciente.test.ts`, `src/app/api/painel/acesso-negado.test.ts` | Toda função exportada de todo arquivo `actions.ts` de `src/app/painel` e `src/app/admin` (`acoesDe`, `acoes-de-paciente.test.ts:31-35`), chamada por paciente, volta ao portal; por nutricionista, as do admin voltam ao painel; toda rota de `/api/painel` responde 403 a paciente e a admin. Ação `'use server'` fora de um `actions.ts` (em `page.tsx` ou outro arquivo) **não** é conferida |
| Origem nas rotas de escrita com cookie (P09-01) | `src/app/api/mesma-origem-rotas.test.ts` | Toda rota de `src/app/api/{painel,p,documento}` (lista lida do disco) chamada em `POST`/`PUT`/`PATCH`/`DELETE` sem cookie e com `Origin: https://evil.example` responde 403: a origem é conferida antes da sessão (uma rota que lesse a sessão primeiro daria 401). Fora, de propósito: `/api/auth`, `/api/n`, `/api/webhooks`, `/api/csp-relatorio`, `/api/erro-cliente` |
| Liberação das receitas do plano | `src/modules/portal/conteudos.test.ts`, caso "guarda: só 'Meu plano' e o detalhe pelo cartão…" (`:151`) | `liberarReceitasDoPlano` só em `planoDoPaciente` e `conteudoDoPaciente(…, { doPlano: true })` |
| PDF e ZIP só no worker | `src/modules/pacientes/exportacao.test.ts:1125` | Nada do grafo do Next (`src/app`, `proxy`, `instrumentation`, `next.config`) alcança `exportacao-job`, os PDFs (inclusive `documento-pdf.tsx`, `documento-pdf-job.ts` e `digitalizada-job.tsx`, Plano 10A) ou o `@react-pdf` |
| Assinatura sem sessão (Plano 10A, D23) | `src/modules/documentos/registrar-assinatura.test.ts`, caso "D23…" | `registrar-assinatura.ts` (importado pelo worker) não puxa o Better Auth, `confirmar-2fa` nem `tenant-session`, nem pelos imports dos imports |
| Verificação pública por um arquivo só (Plano 10A) | `src/modules/documentos/verificacao.test.ts` | Nenhum arquivo de `src` além de `verificacao.ts` (e do schema) cita `document_verifications` (`RLS_EXCEPTIONS`) |
| Listas sem conteúdo (Plano 10A, D17) | `src/modules/documentos/documentos.test.ts`, `portal.test.ts` | As listas do painel e do portal só devolvem tipo, data, situação, assinatura e recibos, nunca itens, orientações ou justificativa (não chamam `auditRead`) |
| Restauração × `RLS_EXCEPTIONS` (Plano 10A) | `src/db/rls-guard.test.ts` | A lista de tabelas fora da conta no `nutri-restauracao-teste.sh` é a mesma de `RLS_EXCEPTIONS` |
| Documentos fora da cópia offline (Plano 10A) | `src/app/sw-regras.test.ts` | `/p/documentos` nunca é a página guardada pelo service worker nem entra no cache do plano |
| IA: SDK, `pdf-lib` e ZDR (Plano 11, RNF-103/RNF-105) | `src/modules/ia/guardas.test.ts` | `@anthropic-ai/sdk` só em `provedor-anthropic.ts` (em `src` e `scripts`); `pdf-lib` só em `preparar-pdf-thread.ts` e no gerador de laudos fictícios; o provedor não usa Batch, Files, execução de código, MCP, `fallbacks`, `speed`, `betas`, citações, `source: url`, `thinking`, ferramentas nem `count_tokens`, e fixa `maxRetries: 0` e `logLevel: 'off'`; nada do grafo do Next alcança o SDK, o `pdf-lib`, o provedor real, o preparo, o job da leitura nem a avaliação. `test/setup.ts` apaga `ANTHROPIC_API_KEY` do ambiente dos testes |
| IA: nada em log, fila ou Sentry (Plano 11, RNF-104) | `src/modules/ia/logs.test.ts` | Uma leitura com textos marcadores (ok, recusa e erro com nova tentativa): o marcador não aparece nos espiões do logger, nos dados dos jobs da fila `ia`, no erro limpo do job nem no evento do Sentry filtrado; a tag `motivo` só com formato de código; o pino tira `apiKey`, `x-api-key`, `parametros` e `resultado` |
| IA: travas sem ciclo (Plano 11, revisão final) | `src/modules/ia/travas.test.ts` | Transações reais em paralelo, conferidas por `pg_blocking_pids`: worker × "Não usar IA", `cancelarTarefas` × portão do envio, varredura × cancelamento — nenhuma termina em 40P01 |
| IA: gatilhos e CHECKs do banco (Plano 11) | `src/db/ia-schema.test.ts` | `ia_tarefas_sem_apagar`, `patients_ia_quem`, `ia_tarefas_imutavel`, `tenants_interruptores_da_admin`, os CHECKs de `ia_tarefas`, `admin_actions` e `patients`, com os ramos que liberam |
| Registro de seções da ficha (Plano 18, D14) | `src/modules/ficha/registro.test.ts` | Ordem da RN-278, com as seções do Plano 18 primeiro e as de outros planos no fim; ids únicos; um arquivo por seção em `src/modules/ficha/secoes/`. Nenhum desses arquivos cita `auditRead`/`recordAudit`, o contexto de paciente sem login, `liberarReceitasDoPlano`, `import()` ou `require`; os imports ficam na lista fechada `IMPORTS_PERMITIDOS`. Todo destino do Adicionar é `href` (relativo sem `/` ou absoluto em `/painel/`) ou uma `ChaveDeAcao`; `verTodos` é absoluto em `/painel/`; nenhuma das 8 seções declara `leitura` |
| Cabeçalho da ficha por um caminho só (Plano 18, D13) | `src/modules/ficha/cabecalho-fonte.test.ts` | `carregarCabecalho` é `cache(async (patientId: string)` e usa o `ctx` de `carregarProntuario`; em `src/app`, só `prontuario.ts` cita `lerCabecalho`; o layout lê só por `carregarCabecalho`. Uma chamada a mais gravaria outra linha "Visualizou" de antropometria |
| Links do Início sem pré-carga (Plano 18) | `src/app/painel/pacientes/[id]/inicio/secao.test.ts`, `adicionar.test.ts` | Todo `<Link>` de `secao.tsx` e do diálogo Adicionar tem `prefetch={false}`: as páginas de destino gravam `auditRead` |
| "No app" no contexto do paciente (Plano 18, D16) | `src/modules/ficha/no-app-fonte.test.ts` | `comoPaciente` existe e não é exportado; confere o papel na própria transação antes de virar `TxDePaciente`; só `no-app.ts` cria `TxDePaciente`; imports em lista fechada; nada de `auditRead`, da liberação das receitas do plano nem do cadastro complementar; arquivado, bloqueado e anonimizado saem antes de outra leitura; só a sessão `nutri`; os textos de `MSG_NO_APP` iguais à spec §8.5 |
| Nome social na IA por uma projeção só (Plano 18, RN-282) | `src/modules/ia/nome-social-fonte.test.ts`, `src/modules/ia/guardas.test.ts` | Em `src/modules/ia/**` (fora de teste), `patientCadastro` só na projeção `{ nomeSocial: patientCadastro.nomeSocial }` de `nome-social.ts` (falha com `select().from(patientCadastro)`, join sem projeção ou outra coluna; controle positivo); `nome-social-worker.ts` só importado pelo contexto da IA Nutri e fora do grafo do Next |
| Colunas do paciente com destino decidido (Plano 18, §10) | `src/modules/pacientes/colunas-decididas.test.ts` (Testcontainers) | Toda coluna de `patients` e `patient_cadastro` (`information_schema.columns`) está no mapa `{ exportacao, anonimizacao, ia }`; coluna nova sem decisão quebra o teste de **todo** plano que a acrescentar |
| Financeiro fora da IA (Plano 20, RN-323) | `src/modules/financeiro/guardas.test.ts` | Pelo grafo de imports: nenhum arquivo alcançável a partir de `src/modules/ia/**` é do módulo do Financeiro, e o schema `financeiro.ts` só é alcançado pelo barril `@/db/schema`; pelo texto: nenhum arquivo de `src/modules/ia/**` (testes incluídos) contém `fin_` nem cita as tabelas do Drizzle do Financeiro; `src/app/sw.ts` não cita o Financeiro (RNF-307); `constantes.ts` não alcança drizzle (componentes cliente importam `MSG_FINANCEIRO`) |
| Financeiro: nada em log, Sentry ou mensagem (Plano 20, RNF-300) | `src/modules/financeiro/log.test.ts` | Erros forçados no módulo e nas actions com valor, descrição, motivo, categoria e nome conhecidos: nada disso chega ao logger, ao `beforeSend` do Sentry nem aos erros devolvidos; os formulários do Financeiro ficam fora dos breadcrumbs |
| `web-push` só no worker | `src/modules/notificacoes/push.test.ts:434` | Nada do grafo do Next alcança `push.ts`, `enviar.ts`, `web-push` nem `heic-decode` |
| Sentry | `src/lib/sentry-guarda.test.ts` | `Sentry.init` só em `src/lib/sentry.ts`; nenhum SDK de navegador, Replay ou tracing; `@sentry/node` fora de componente de cliente |
| Erro de job sem detalhe | `src/worker/sem-detalhe.test.ts` | Todo job registra por `workSemDetalhe`; nenhum `boss.work(` direto em `src/worker/index.ts` |
| Axe em toda tela | `src/app/painel/rotas-axe.test.ts:8` | `ROTAS_DO_PAINEL` tem exatamente um caminho por `page.tsx` de `src/app/painel` (Plano 08, D25) |
| Imagem Docker | `src/app/painel/rotas-axe.test.ts:19` | Todo arquivo de `e2e/` importado por `src/` volta ao contexto do build no `.dockerignore` |
| Visual V2 | `src/app/painel/cores.test.ts`, `cabecalho.test.ts`, `navegacao.test.ts` | Sem cor fixa nas telas da nutricionista (D24), foco visível, cabeçalho desenhado só pelo layout (D20); todo `page.tsx` do painel chama `requireNutri(` ou `carregarProntuario(` (`cabecalho.test.ts:49-51`, conferência de texto) |
| Manual guiado | `src/modules/ajuda/conteudo.test.ts:51,54` | Todo nome de botão citado no manual existe numa tela (desde o Plano 10A, também em `src/app/conta`); toda página de `src/app/painel` e `src/app/conta` tem guia ou está em `SEM_AJUDA`; o guia `prontuario` não cita a aba Documentos (D20). Plano 18: `TSX_FORA` lê também `src/modules/ficha` (os textos do Início em `MSG_FICHA`), nenhum título de guia se repete e o `inicio-paciente` vem antes do `prontuario` |
| Workflows no runner próprio (12/10/2026) | `test/runner-proprio.test.ts` | Nenhum workflow com `pull_request_target`, `workflow_run` ou `issue_comment`; todo `runs-on` é `ubuntu-latest` ou `[self-hosted, nutri-ci]`; os jobs `mudancas`, `quality`, `test`, `e2e` e `image` do `ci.yml` no runner próprio; nenhum job fora do `ubuntu-latest` com `secrets`, permissão de escrita ou `EASYPANEL` (texto bruto); `decidir` e `publish` hospedados, `publish` com `packages: write`; emergência só na `main` com `PUBLICAR-SEM-CI`, e o job `confirmar` falha no contrário. Alarme contra engano, não barreira ([§7.7](#77-pipeline-do-ci-e-deploy)) |
| Variáveis | `src/env.test.ts` | Validação de cada variável por processo (chaves de teste do Turnstile recusadas em produção fora de `localhost`, `AUTH_SECRET` ≥ 32, `DATABASE_URL_MIGRATOR` nunca exposta ao app…) |
| Exames fora da IA (Plano 22, RN-399) | `src/modules/exames/guardas.test.ts` | Pelo grafo de imports a partir de cada fonte de `src/modules/ia/**`: nenhum arquivo alcançado (fora de `src/db/schema/**`) contém `examInterpretacoes`, `examVersoes`, `exam_interpretacoes` ou `exam_versoes`, nem é `exames/interpretacao.ts`, `edicao.ts` ou `detalhe.ts` (com controle positivo); `src/modules/ia/nutri-paciente/**` não importa `exams` nem `@/modules/portal/exames-liberados`; `campos-enviados.ts` igual; `src/app/sw.ts` sem `/p/exames` ([§10.15](10-ia.md#1015-exames-do-consultório-fora-da-ia-plano-22-rn-399)) |
| Exames sem dado em log (Plano 22, RNF-370) | `src/modules/exames/log.test.ts` | Erros forçados em `editarExame`, `salvarNota`, `salvarExameDoCatalogo` e `salvarModeloSolicitacao` com nome, valor, faixa, nota e justificativa marcadores: nada chega ao logger nem ao `beforeSend` de `src/lib/sentry-filtro.ts` |

O grafo de imports (`test/grafo-de-imports.ts`) usa o parser do TypeScript, segue `import`, `export … from`,
`import()` e `require`, ignora `import type` e resolve o alias `@/`. Por quê: um `grep` de texto não pega o import
indireto (rota → módulo A → módulo B → `@react-pdf`). Um import desses levaria o PDF para o bundle do servidor web e
para o processo que atende as páginas.

### 7.4.4 Checklist: tabela nova com `tenant_id`

O passo a passo completo (schema, migration custom de RLS, helpers SQL × listas de `src/db/rls-guard.ts`, migrator,
`withTenant`/`auditRead`, arquivos, fábrica em `FABRICAS`, LGPD) e o fluxograma estão em
[§2.11 Passo a passo: tabela nova com `tenant_id`](02-banco-de-dados.md#211-passo-a-passo-tabela-nova-com-tenant_id).
As guardas desta seção 7.4 quebram o CI se algum passo faltar.

### 7.4.5 Checklist: tela nova

As peças estão espalhadas em vários capítulos (§1, §3.17, §5.7.4, §5.9). Aqui ficam juntas. A coluna "Guarda" diz o
que o CI cobra; "nenhuma" quer dizer que só a revisão pega o esquecimento.

**Painel da nutricionista (`src/app/painel/…`)**

| # | Passo | Onde | Guarda |
|---|---|---|---|
| 1 | Primeira linha da página: `await requireNutri('/painel/…')` (`src/lib/tenant-session.ts:22`); use o `ctx` devolvido em `withTenant` | `page.tsx` | `cabecalho.test.ts:49-51` (só confere o texto) |
| 2 | Aba do prontuário (`/painel/pacientes/[id]/…`): use `carregarProntuario(id)` (`src/app/painel/pacientes/[id]/prontuario.ts:13`) em vez de `requireNutri` + `buscarPaciente`. Ela chama `requireNutri`, faz **uma** leitura auditada do paciente por requisição (o `cache` do React divide a leitura entre o layout e a página) e dá 404 a paciente de outro tenant ou id malformado. Desde o Plano 18, o layout também lê a última avaliação por `carregarCabecalho` (`prontuario.ts:25`, um `auditRead` de antropometria por execução): a aba nova nunca chama `lerCabecalho`. A faixa tem 13 abas e uma 14ª não cabe a 1280 px (R-266) | `page.tsx` da aba | `cabecalho.test.ts:49-51`; `src/modules/ficha/cabecalho-fonte.test.ts` |
| 3 | Server Action só num arquivo `actions.ts`, e toda função exportada começa pela guarda (`requireNutri`; no admin, `requireUser(['admin'])`). Não declare `'use server'` dentro de `page.tsx` nem em outro arquivo | `actions.ts` | `acoes-de-paciente.test.ts` (só lê arquivos `actions.ts`) |
| 4 | Rota em `/api/painel/*`: `requireApiNutri(req)` (`tenant-session.ts:46`); escrita: `mesmaOrigem(req)` antes da sessão (`src/lib/mesma-origem.ts:9`) | `route.ts` | `src/app/api/painel/acesso-negado.test.ts` (sessão), `src/app/api/mesma-origem-rotas.test.ts` (origem) |
| 5 | Entrada em `ROTAS_DO_PAINEL` (`e2e/painel-rotas.ts:14`) | `e2e/painel-rotas.ts` | `rotas-axe.test.ts:8` |
| 6 | Tela com `[id]`: campo novo em `IdsDoPainel` (`e2e/painel-rotas.ts:2`) e a criação do registro pela UI em `prepararTelasComId` (`e2e/painel.ts:74`) | `e2e/` | `pnpm typecheck` (o `tsconfig.json` inclui `e2e/`): campo usado em `ROTAS_DO_PAINEL` e não devolvido por `prepararTelasComId` não compila |
| 7 | Cores só por token (sem `bg-white`, `text-gray-…`); sem cabeçalho próprio (o layout desenha) | `.tsx` | `cores.test.ts`, `cabecalho.test.ts` |
| 8 | Se a tela é um destino: item em `ITENS_DO_MENU` (7 itens fixos desde o Plano 20, `src/app/painel/navegacao.ts:5`) ou cartão no hub de Configurações (`DO_HUB`, `navegacao.ts:32`) | `navegacao.ts` | `navegacao.test.ts:10` fixa os 7 itens e o teste do teclado de `e2e/acessibilidade-painel.spec.ts` os 9 com os condicionais: item novo no menu exige decisão (P08 D20; o "Financeiro" foi decisão do dono, RN-327) |
| 9 | Guia do manual, se couber: entrada em `GUIAS` (`src/modules/ajuda/conteudo.ts:17`) | `conteudo.ts` | `conteudo.test.ts:54` (nomes de botão) |
| 10 | Dado de saúde devolvido: `auditRead(tx, …)` na mesma transação (`src/modules/plataforma/audit.ts:28`, regra 8) | módulo | nenhuma |

**Portal do paciente (`src/app/p/…`, `src/app/api/p/…`)**

| # | Passo | Onde | Guarda |
|---|---|---|---|
| 1 | Primeira linha da página: `await requirePaciente('/p/…')` (`src/lib/paciente-session.ts`, `requirePaciente`) | `page.tsx` | **nenhuma** |
| 2 | Rota em `/api/p/*`: `requireApiPaciente(req)` (`paciente-session.ts`, `requireApiPaciente`); escrita: `mesmaOrigem(req)` antes de tudo (ex.: `src/app/api/p/diario/route.ts:25`) | `route.ts` | `src/app/api/mesma-origem-rotas.test.ts` (só a origem; a sessão, **nenhuma**) |
| 3 | Dado de saúde devolvido: `auditRead` na mesma transação (P06 D22) | módulo | nenhuma |
| 4 | Nada novo no cache offline; toda página do portal marca uma seção (`tambem` em `SECOES_DO_PORTAL`); seção nova exige decisão (§5.5.2, §5.9) | `src/app/sw-regras.ts`, `src/app/p/navegacao.ts` | `src/app/p/navegacao.test.ts` |

Atenção: nenhuma guarda do CI lê as páginas de `/p` nem as rotas de `/api/p`. Os testes de `requirePaciente` existem
por tela (ex.: `src/app/p/(portal)/plano/page.test.ts`), não como varredura. O proxy também não protege `/api/*`
(§1.4). Uma página ou rota do portal sem a guarda passa no CI; confira na revisão.

---

## 7.5 E2E com Playwright

### Configuração (`playwright.config.ts`)

| Item | Valor | Por quê |
|---|---|---|
| `baseURL` (`:4`) | `APP_URL`, senão `http://localhost:3000` no CI e `http://localhost:3100` local | A 3000 da VPS é o painel do Easypanel (PF-N16) |
| `fullyParallel` | `false` | Os specs dividem um banco e um consultório de teste; vários são `serial` |
| `retries` | 1 no CI, 0 local | Absorve uma oscilação de rede sem esconder falha repetida |
| `workers` (`:12`) | 2 no CI; local, o padrão do Playwright | No runner próprio, o contêiner do job enxerga 8 núcleos numa cota de 4: o padrão (metade dos núcleos vistos) daria 4 workers e estouraria prazos. 2, como no runner hospedado de 4 vCPU |
| `trace` | `retain-on-failure` | O CI sobe `playwright-report` quando falha (`ci.yml`, último passo do job `e2e`; `playwright-report-webkit` no `e2e-webkit`) |
| `webServer[0]` | `next start` na porta da `baseURL` | E2E roda o **build de produção**, não o `next dev` |
| `webServer[1]` | `pnpm worker`, espera `worker iniciado` no stdout (`src/worker/index.ts:218`) | E-mails e lembretes são enviados pelo worker |

**Projetos:**

| Projeto | Dispositivo | Specs |
|---|---|---|
| `chromium` | Desktop Chrome | Todos, menos os dois de acessibilidade |
| `celular` | Pixel 7 | `acessibilidade.spec.ts` (PWA no tamanho de Android; RNF-09, RNF-10) |
| `painel` | Desktop Chrome | `acessibilidade-painel.spec.ts` (Plano 08, D25) |
| `webkit` | iPhone 17 (WebKit) | Só os do portal do paciente, numa lista explícita (`SPECS_DO_PORTAL`): `portal`, `sessao-portal`, `app-paciente`, `nada-some`, `sus-112-recarregar-ao-voltar` e `fontes-portal`; e, quando chegarem à `main`, `questionario`, `metas`, `mensagens*` e `site-opinioes` (o Enter do editor do site) |

**Projeto `webkit` (SUS-117).** O Safari do iPhone é o navegador de boa parte dos pacientes, e o motor dele (WebKit) é
outro: service worker, cache, toque, foco no toque e as regras do iOS no portal (o tutorial "Adicionar à Tela de Início"
no lugar do "Ativar notificações", `src/app/p/notificacoes.tsx`). O projeto roda no WebKit do Playwright com o
dispositivo `iPhone 17` (o iPhone mais novo da 1.63: agente do iPhone, 402 × 681, toque) os specs cujo assunto é o portal.
Ficam de fora os do painel e os mistos em que o lado do paciente não se separa da revisão no painel (`lembretes`,
`exames-enviados`, `ia-nutri-paciente`). Regras:

- **A nutricionista entra com `painelNoComputador(browser)`** (`e2e/helpers.ts`): o contexto criado por
  `browser.newContext()` herda o dispositivo do projeto, e o painel ali é só preparo. No WebKit, `Desktop Safari`; no
  Chromium, `Desktop Chrome` (o próprio dispositivo do projeto: nada muda). Spec novo na lista faz o mesmo.
- **O que o Playwright não faz no WebKit sai só no teste**, com `test.skip(browserName === 'webkit', '<motivo e link>')`,
  sem afrouxar asserção: `fontes-portal.spec.ts` (desliga o cache pelo CDP, que só existe no Chromium) e, no
  `portal.spec.ts`, "sem as chaves do VAPID…" (no iPhone fora da tela de início o portal manda instalar antes, e o
  Playwright não emula o app instalado, `display-mode: standalone`). Os testes de offline e do service worker não usam
  `context.serviceWorkers()` nem o evento `serviceworker` (só Chromium): rodam no WebKit.
- **Quando o `e2e-webkit` roda** (pedido da orquestradora, 24/11/2026: um runner só, e 7 a 10 min a mais em todo PR
  atrasariam o trem): no PR que toca o portal (saída `portal` do job `mudancas`: `src/app/p/`, `src/app/n/`, `src/app/sw*`,
  `src/components/portal/`, os specs do projeto `webkit`, `e2e/helpers.ts`, `e2e/portal.ts`, a config do Playwright, o
  `ci.yml` e as dependências; na dúvida, roda), toda noite na main (`schedule`, 05h30 UTC) e à mão (`workflow_dispatch`).
  Nunca no deploy (`workflow_call`). No `schedule` e no `workflow_dispatch` os outros jobs (`quality`, `test`, `e2e`,
  `image`) ficam de fora pela condição `github.event_name`.
- **Job próprio no CI (`e2e-webkit`).** Estimativa do SUS-117: os 54 testes que rodam (55 com o pulado), pela média do
  Chromium na última execução verde do CI (272 testes em 22,5 min com 2 workers) e com o peso dos specs do portal (cada
  teste cria um paciente pelo painel e aceita o convite pelo Mailpit), dão 7 a 10 min no WebKit, mais o build: acima dos
  5 min combinados. O job tem o banco e o Mailpit dele, então os mesmos specs não rodam duas vezes, ao mesmo tempo,
  contra as contas fixas do seed e os IPs do limite de login. O tempo medido sai do CI do PR do SUS-117.
- **O host da VPS não abre o WebKit** (faltam as bibliotecas do sistema; instalar é com o dono): o projeto `webkit` só
  existe com `CI` ou `E2E_WEBKIT=1` (`playwright.config.ts`), então o E2E local das sessões (`pnpm test:e2e`, com ou sem
  spec) segue como antes, sem ele; local, só `E2E_WEBKIT=1 pnpm exec playwright test --list --project=webkit`. A imagem do
  CI (`mcr.microsoft.com/playwright:v1.63.0-noble`) já
  traz o navegador e as dependências.

O aparelho de verdade continua no teste manual do runbook (checklist `docs/operacao/go-live.md`, "Produto e
acessibilidade") para o que o Playwright não alcança: instalar, push real, VoiceOver e a foto HEIC do iPhone.

### Dados do E2E: `scripts/e2e-seed.ts`

`pnpm e2e:seed` prepara o banco antes da suíte (`ci.yml:169`). Ele:

- cria ou atualiza o tenant `e2e-consultorio` com o DPA aceito e a página pública ligada;
- apaga a agenda desse tenant (filhas antes das mães) e arquiva os pacientes ativos de execuções anteriores;
- zera o limite por IP do visitante da página pública;
- recria as contas de teste (`E2E_ADMIN`, `E2E_NUTRI`, `E2E_RECUPERA`, `E2E_MULTI`, `E2E_MANUAL`,
  `E2E_ADMIN_PLATAFORMA` e, desde o Plano 10A, `E2E_DOCS` — a nutricionista dos documentos, com o 2FA já ativo e o
  consultório com os documentos liberados) com o progresso do manual marcado como visto, menos a conta do `manual.spec`;
- desde o Plano 20, deixa o consultório do E2E com o **Financeiro configurado** (saldo de R$ 1.000,00 no dia 1º do mês, consulta
  a R$ 250,00, categorias iniciais; `ON CONFLICT DO NOTHING`, contexto `worker`); na limpeza da agenda, apaga só as consultas
  **sem** lançamento e leva as outras a `cancelada` pelo "sistema" (a cobrança aponta para a consulta com FK `NO ACTION` e
  não se apaga): todo "Realizada" deixa a consulta no banco de dev para sempre, e nenhum spec pode esperar a agenda vazia
  (R-312); e cria **dois consultórios novos por execução**, sem Financeiro, com as contas `E2E_FIN_NOVO` (o
  `financeiro.spec` configura) e `E2E_FIN_AXE` (o axe do estado não configurado) recriadas apontando para eles — o primeiro
  acesso fica repetível sem apagar a linha de `fin_configuracoes` ([§12.10](12-financeiro.md#1210-testes-e-e2e)).

As senhas dessas contas são fictícias e fixas no arquivo (o GitGuardian acusou; o backlog manda marcar como
credencial de teste). Nunca reaproveite essas contas fora do E2E.

**Cuidado:** o seed escreve no banco de `DATABASE_URL`. Ele apaga dados do tenant `e2e-consultorio`. Nunca rode
apontado para produção.

### Convenções dos specs

- **Um bloco de IP por spec.** O login tem limite de 5 tentativas a cada 15 min por IP. Cada spec declara a sua
  faixa no topo (ex.: `e2e/acessibilidade.spec.ts:11`, `10.9.10.21` a `.30`) e o `entrarComo` manda o IP no
  `x-forwarded-for` (`e2e/helpers.ts:7`). No CI, `TRUSTED_PROXIES` aponta para a TEST-NET-1, que satisfaz a
  validação de produção sem confiar em nenhum proxy real (comentário no job `e2e` do `ci.yml`).
- **E-mail pelo Mailpit.** `esperarEmail` (`e2e/mailpit.ts`) consulta a API do Mailpit em laço, com prazo. Falha do
  Mailpit falha na hora com o status (M4). Com `CI` definida e sem `MAILPIT_URL`, o módulo lança erro em vez de cair no
  `http://localhost:8025` de dev (no runner próprio, seria o Mailpit de dev da VPS).
- **WhatsApp no sandbox.** `WHATSAPP_SANDBOX=1` manda a mensagem para o Mailpit (`<número>@whatsapp.sandbox`); o
  E2E assina os webhooks com `EVOLUTION_WEBHOOK_SECRET` (`e2e/whatsapp.ts`). No CI, `doAmbiente` exige
  `EVOLUTION_WEBHOOK_SECRET` e `DATABASE_URL` (sem elas, lança erro); local, usa os padrões do `.env.example`.
- **CSP vigiada.** `vigiarCsp` (`e2e/csp.ts`) junta toda mensagem de violação do console. O spec de acessibilidade
  do painel abre todas as telas e exige a lista vazia. É a prova de que a CSP pode valer direto (Plano 08, D7).
- **Admin com 2FA.** `entrarComoAdmin` ativa o 2FA no primeiro login e gera o código TOTP com `otpauth`.
- **Paciente novo só pelo helper (Plano 18, RNF-263 g).** `criarPacientePeloFormulario(nutri, { nome, email, nascimento?,
  sexo?, telefone? })` (`e2e/pacientes-form.ts:11`) preenche "Novo paciente" e devolve o caminho do prontuário; `pacienteNoPortal`
  (`e2e/portal.ts`) já o usa. Spec novo (Planos 19, 20…) cadastra paciente só por ele. O `agenda.spec.ts` ainda preenche o
  formulário direto (`novoPaciente` e o teste do convite por WhatsApp); no PR 2 do Plano 18, que trocou os rótulos ("Nome"
  virou "Nome completo", ao lado de "Nome social (opcional)"; o telefone virou "Celular / WhatsApp (opcional)"), o
  `novoPaciente` passou ao helper (`agenda.spec.ts:68`) e o teste do convite por WhatsApp, que precisa de outros campos,
  usa os rótulos novos com `exact: true` (`:313`; o `getByLabel` casa por trecho e "Nome" pegaria "Nome social"). A
  semente do E2E (`scripts/e2e-seed.ts`) ganhou duas pacientes com cadastro (`SEMENTE_COMPLETA`, com nome social e CPF
  fixo, e `SEMENTE_INCOMPLETA`, `e2e/cadastro.ts`), por *upsert* em `(tenant_id, patient_id)`, sem DELETE.

### Acessibilidade (RNF-10)

| Spec | Projeto | Tags do axe | Cobertura |
|---|---|---|---|
| `e2e/acessibilidade.spec.ts` | `celular` | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 10 rotas do portal, cada uma num teste; modo escuro do aparelho no portal e no painel; foco sobre a cor do consultório (contraste ≥ 3:1); 360 px e 320 px sem rolagem horizontal; alvo de toque ≥ 44 px; telas avulsas (consulta, exportação, sem acesso, escolher consultório, termo); paciente não alcança o painel |
| `e2e/acessibilidade-painel.spec.ts` | `painel` | as mesmas + `wcag22aa` (alvo de toque) | **Todas** as telas do painel (`ROTAS_DO_PAINEL` + `/conta/seguranca`) nos modos **claro**, **escuro** e **"igual ao aparelho" com o aparelho escuro**; menu da conta aberto e erros de formulário; 768 px sem rolagem horizontal |

Detalhes que evitam falso verde:

- `violacoes` exige `r.passes.length > 0`: o axe precisa ter rodado regras na página.
- No painel, os `incomplete` de `color-contrast` contam como falha (fundo com transparência cai em "incompleto"). A
  única tolerância é a linha "Conectado como …" do menu aberto, documentada no próprio teste.
- `prepararTelasComId` (`e2e/painel.ts`) cria pela interface real uma linha de cada tela com id (paciente, consulta,
  plano, conteúdo…) antes do laço.

### Specs

| Spec | Testes | Cobre |
|---|---|---|
| `auth.spec.ts` | 8 | Login, 2FA, sessão (Plano 01) |
| `recuperacao.spec.ts` | 2 | Esqueci minha senha |
| `sair.spec.ts` | 7 | Sair e `Clear-Site-Data` |
| `sessao-portal.spec.ts` | 2 | Sessão do portal (S-1, S-2, S-4) |
| `plataforma.spec.ts` | 6 | Admin cria nutricionista, convite, DPA, marca |
| `pacientes.spec.ts` | 9 | Cadastro, convite, prontuário (desde o Plano 18, os rótulos novos do formulário em seções) |
| `plano-alimentar.spec.ts` | 18 | Criar, calcular e publicar plano |
| `agenda.spec.ts` | 12 | Horários, consultas, lembretes, link da consulta, página pública, WhatsApp sandbox, presença |
| `portal.spec.ts` | 20 | Portal do paciente |
| `conteudos.spec.ts` | 3 | Conteúdo visível só para a audiência certa (§9.7) |
| `inicio.spec.ts` | 2 | Início em bento |
| `menu-conta.spec.ts` | 1 | Menu da conta |
| `manual.spec.ts` | 10 | Manual guiado |
| `csp.spec.ts` | 3 | CSP e cabeçalhos |
| `health.spec.ts` | 1 | `/api/health` (o que o monitor externo confere) |
| `acessibilidade.spec.ts` | 11 (+ laço) | Portal |
| `acessibilidade-painel.spec.ts` | 10 (+ laço) | Painel; desde o Plano 18, a faixa de 13 abas da ficha a 1280 px sem rolar e sem "incomplete", com o cadastro no Perfil, e (PR 2) Início, Perfil, lista e "No app do paciente" a 1280 e 360 px, claro e escuro; desde o Plano 20, o Financeiro não configurado (conta `E2E_FIN_AXE`, `10.9.20.2`), o detalhe de pendências vazio e o lançamento com erro, claro e escuro, 1280 e 360 px, as telas do Financeiro também a 360 px e o menu com 9 itens no teclado |
| `documentos.spec.ts` (Plano 10A) | 1 | Receita de ponta a ponta pela digitalizada (rascunho → preparar → fotos + 2FA → portal: abrir e confirmar → situação no painel → verificação pública sem dado do paciente), com axe nos cartões "Aguardando assinatura" e "Documento assinado"; `acessibilidade.spec.ts` ganhou o axe de `/p/documentos`, `/v/<código>` e `/documento/<token>` (claro, escuro, 360 px) |

| `painel-pwa.spec.ts` (Plano 09) | 1 | Painel instalável: manifest próprio, nenhum service worker, HTML sem cache (P09-05) |
| `ia-laudos.spec.ts` (Plano 11) | 1 | Com `IA_PROVEDOR=sandbox`: aviso em mãos na Privacidade → laudo → "Ler valores com IA" → conferir → salvar só o marcado, com a marca "IA · conferido em {data}" |
| `conferencia-ia.spec.ts` (Plano 11) | 1 | A conferência guarda marcações e correções depois de um erro e no segundo envio (o React 19 limpava o formulário; revisão da T13) |
| `ficha.spec.ts` (Plano 18, PR 1) | 5 (+ laço de 2 temas) | Aba Início (US-262, US-263, CS-260): diálogo "Adicionar ao prontuário" (foco no título; Esc e "Fechar" devolvem o foco ao botão); Adicionar → Antropometria (foco em "Nova avaliação") e → Anamnese (foco no seletor de modelo); Adicionar → Receita (rascunho pela Server Action da aba Documentos); seção → item em 2 cliques; axe do diálogo aberto, claro e escuro. Bloco de IP `10.9.18.1`–`.5`. Cadastra o paciente por `criarPacientePeloFormulario` |
| `financeiro.spec.ts` (Plano 20) | 3 (`serial`) | Conta `E2E_FIN_NOVO` (`10.9.20.1`): primeiro acesso ("Comece por aqui" → Configurações → Resumo); CS-300 (consulta já começada → "Realizada" → cobrança de R$ 250,00 → "Marcar como recebido" com Pix → sai de "Pagamentos pendentes" → no Resumo), com axe da seção "Cobrança" nos dois temas a 1280 e 360 px; CSV (13 meses → alerta; 1 mês → download sem a coluna Paciente). Asserções só sobre o paciente da execução ([§12.10](12-financeiro.md#1210-testes-e-e2e)) |
| `lembretes.spec.ts` (Plano 17) | 2 (+ laço de 3 modos) | A nutricionista salva a sugestão na seção "Lembretes no app" ("Previsto para hoje", aviso sem aparelho), o paciente desliga a água em Eu › Lembretes (interruptor otimista com a ação presa na rede, foco e região de status) e a nutricionista vê "Desligado pelo paciente em {data}" sem o "Apagar"; axe da seção com lembretes salvos e com o suplemento aberto com erro nos três modos do painel. IPs `10.9.31.71`–`.75`. O envio do push fica nos testes de `src/modules/lembretes` (o E2E não tem aparelho inscrito); `acessibilidade.spec.ts` ganhou `/p/perfil/lembretes` (com o lembrete livre de link longo, a 320 px com texto a 200%) e a tela vazia (`10.9.10.25`) |
| `cadastro.spec.ts` (Plano 18, PR 2) | 10 (2 em laço de 2 temas) | Cadastro com CPF, estado civil e CEP (US-260; o CPF nunca na lista); CPF repetido com a mensagem, o link em nova aba e o digitado mantido, com axe claro e escuro; Perfil (o estado civil e a Observação não voltam atrás, foco no CEP inválido); lista (abas, "Mais recentes" com a busca, `?status=arquivado` → Inativos); menu da linha (Esc, clique fora, Tab depois do último item); arquivar pela lista duas vezes (região de status e foco no título, D26); Início (nota "Cadastro incompleto", selo e cartão "No app"); "No app do paciente" da paciente da semente; impressão com o nome civil antes de "Nome social"; axe do menu aberto e do diálogo Adicionar. IPs `10.9.18.20`–`.29`; repetível no banco de dev (CPF novo a cada execução, sufixo `c18…`) |
| `exames.spec.ts` (Plano 22, PR 2) | 2 | CS-371: com o catálogo da semente (painel "Hemograma completo" de 20 componentes e "Ferritina", `scripts/e2e-seed.ts`), "Adicionar do catálogo" monta as 20 linhas, a faixa preenchida mostra "Acima da referência" antes de salvar, abrir o exame e salvar a nota; US-374: marcar 2 exames e abrir o comparativo (fora de 2 a 6, o botão fica `aria-disabled`). IP `10.9.22.20` |
| `acessibilidade-exames.spec.ts` (Plano 22, PR 2) | 11 (2 em laço de 2 temas × 2 larguras) | axe no catálogo e no detalhe (com "Ver referência" e "Inserir modelo") a 1280 e 360 px, claro e escuro; foco do `Dialogo` (Esc, fechar pelo navegador, desmontado aberto), da busca no catálogo, de "Acrescentar faixa"/"Remover faixa", das linhas do exame ("Usar {a} a {b}", "Remover", "Remover todos") e da nota ("Nota salva." com o foco no título). IP `10.9.22.10` |

Os números são de chamadas `test(` no arquivo; laços geram mais casos na execução.

### Rodar localmente

```bash
pnpm e2e:seed            # banco de DEV (DATABASE_URL do .env.local)
pnpm build
pnpm test:e2e            # sobe next start na 3100 e o worker; o webkit só existe com CI ou E2E_WEBKIT=1
pnpm test:e2e e2e/agenda.spec.ts   # um spec
```

`TRUSTED_PROXIES` é obrigatória no `next start` local (comentário em `.env.example`). O Playwright precisa do
Chromium instalado (`pnpm exec playwright install chromium`). O worker é sempre iniciado pelo Playwright
(`reuseExistingServer: false`); pare o seu `pnpm worker` antes, para não ter dois consumindo a fila. O `webServer` define
`IA_RETENCAO_ZERO`, mas não `IA_PROVEDOR`: os trechos com IA (`ia-laudos.spec.ts`, `ia-nutri.spec.ts`, a conversa da IA Nutri em
`acessibilidade.spec.ts`) precisam de `IA_PROVEDOR=sandbox` no ambiente (o CI define no job `e2e`), se o `.env.local` não a
definir (divergência #131 do README).

---

## 7.6 Lint, typecheck e formatação

| Comando | O que faz |
|---|---|
| `pnpm lint` | `eslint .` com `eslint-config-next/core-web-vitals` e `eslint-config-next/typescript` (`eslint.config.mjs`) |
| `pnpm typecheck` | `next typegen` (script `pretypecheck`, gera os tipos de rota do Next 16) e `tsc --noEmit` com `strict` |
| `pnpm format` | `prettier --write .` com `.prettierrc` (aspas simples, `printWidth` 100) |

O CI roda `lint` e `typecheck` (job `quality`, `ci.yml:74-75`). **Não** roda o Prettier, e boa parte do código passa
de 100 colunas. Formatação não bloqueia; o backlog do Plano 08 tem um item de Prettier nos arquivos do heartbeat.

Comentários com `eslint-disable` existem e explicam o motivo na mesma linha (ex.: `useBoss` em
`src/worker/index.ts:59`, que não é hook do React).

---

## 7.7 Pipeline do CI e deploy

### `ci.yml` (todo pull request e chamado pelo deploy)

Desde 12/10/2026, os jobs do `ci.yml` (seis desde o SUS-117) rodam no **runner próprio** da VPS (`runs-on: [self-hosted, nutri-ci]`), não
mais no `ubuntu-latest` do GitHub. O runner tem uma instância só: os jobs entram em fila e rodam **um por vez**. Como o
runner é montado e por que, em "Runner próprio na VPS", abaixo.

| Job | Tempo máx. | Onde roda | Passos | Observação |
|---|---|---|---|---|
| `mudancas` (`ci.yml:37-60`) | 5 min | No host do runner, sem `container:` | `git diff --name-only` contra a base | Plano 12 (R-D1): diz se a mudança tem código (saída `codigo`); ver "Mudança só de documentação", abaixo |
| `quality` (`:62-75`) | 20 min | Contêiner `mcr.microsoft.com/playwright:v1.63.0-noble` (`--cpus 4 --memory 6g`) | `pnpm install --frozen-lockfile --store-dir /pnpm-store`, `lint`, `typecheck` | Node 24 pelo `setup-node`, sem o cache do GHA: o store do pnpm fica no volume `nutri-ci-pnpm`, montado em `/pnpm-store`. Roda sempre |
| `test` (`:77-118`) | 25 min | Contêiner do Playwright (`--cpus 4 --memory 8g`), **sem** `DAC_OVERRIDE` e `DAC_READ_SEARCH`; com o socket do Docker rootless do CI e o `docker` e o `rclone` do host montados só leitura | Confere que o `rclone` e o `docker` existem, que o daemon é o rootless e sem Swarm, e liga o contêiner do job à rede `bridge`; baixa o `jq` 1.7.1 (binário estático da release, conferido pelo sha256); `pnpm install`; `pnpm test`; `pnpm test:tempo` (os testes de tempo, depois e sozinhos) | Inclui todas as guardas. Postgres do Testcontainers pelo IP do contêiner (`NUTRI_CI_REDE_DIRETA=1`) e Ryuk desligado (`TESTCONTAINERS_RYUK_DISABLED`); 3 workers do Vitest. Só com `codigo == 'true'` |
| `e2e` (`:123-177`) | 45 min | Contêiner do Playwright (`--cpus 4 --memory 8g --shm-size 1g`); serviços `postgres:16-alpine` e `axllent/mailpit:v1.27` **sem** `ports:` | `playwright install chromium` (sem `--with-deps`: a imagem já traz as dependências do sistema), `db:migrate`, `e2e:seed`, `build`, `test:e2e --project=chromium --project=celular --project=painel` | Serviços pelo nome na rede do job (`postgres:5432`, `mailpit:8025`); `APP_URL` é o `localhost:3000` do contêiner do job, não o painel do Easypanel. `NODE_ENV=production`, `CI=true`, `WHATSAPP_SANDBOX=1`, `EMAIL_TRANSPORT=mailpit`; 2 workers do Playwright; relatório do Playwright como artefato na falha. Só com `codigo == 'true'` |
| `e2e-webkit` (`:179-238`) | 45 min | Igual ao `e2e` (contêiner, serviços e variáveis) | `playwright install webkit`, `db:migrate`, `e2e:seed`, `build`, `test:e2e --project=webkit` | SUS-117: o portal do paciente no WebKit (projeto `webkit`, iPhone 17), num banco só dele; relatório `playwright-report-webkit` na falha. Só com `codigo == 'true'` |
| `image` (`:240-316`) | 30 min | No host do runner, no Docker rootless do CI (`DOCKER_HOST` vem do `.env` do runner) | `setup-buildx-action` com `driver: docker`; `build-push-action` com `push: false` e `load: true`, sem cache do GHA; o orçamento; os testes de fumaça da IA e da rasterização; `docker image rm -f nutridebby:ci` no fim (`if: always()`) | **Só build e provas, sem push:** a imagem que vai para o GHCR é montada de novo no `publish`, hospedado. A imagem comprimida tem de caber em **265 MB** (`set -euo pipefail`, MB arredondado para cima; conta abaixo); depois, `node --import tsx` na imagem, sem rede, prepara um PDF (thread do `pdf-lib`), cria o cliente do SDK e (Plano 12) rasteriza uma página no processo filho do PDFium — confere a poda do Dockerfile. Só com `codigo == 'true'` |

Variáveis do job `test` (só nomes; `ci.yml:93-99`): `DOCKER_HOST` e `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` (o socket
rootless do CI, `/run/user/1500/docker.sock`), `NUTRI_CI_REDE_DIRETA` e `TESTCONTAINERS_RYUK_DISABLED`. O Docker do CI
não vê os contêineres de produção.

Variáveis dos jobs `e2e` e `e2e-webkit` (as mesmas; só nomes): `NODE_ENV`, `APP_URL`, `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `AUTH_SECRET`,
`ENCRYPTION_KEY`, `TRUSTED_PROXIES`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `MAILPIT_URL`, `FILE_URL_SECRET`, `DATA_DIR` (`/tmp`
do contêiner do job, descartado no fim), `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `WHATSAPP_SANDBOX`,
`EVOLUTION_WEBHOOK_SECRET`, `IA_PROVEDOR` (`sandbox`; desde o Plano 11), `IA_RETENCAO_ZERO` (Plano 14A), `CI`. Todos
fictícios, escritos no próprio workflow; nenhum vem de `secrets`.

**Concorrência (`ci.yml:20-22`).** Num PR, um commit novo cancela a execução anterior (libera o runner, que roda um job
por vez). Quando o `ci.yml` é chamado pelo deploy, o cancelamento fica desligado: o deploy nunca é interrompido no meio.

**Runner próprio na VPS (12/10/2026).** Por quê: o plano Free do GitHub dá 2 mil minutos por mês, e o CI de um PR
gastava cerca de 38 minutos hospedados; em outubro já havia 1.990 minutos gastos (`docs/operacao/runner-proprio.md`,
seção 2). No runner próprio, o CI de PR custa zero minuto. Cada merge ainda gasta o `decidir` e o `publish`, que ficam
hospedados (estimativa do desenho: 5 a 7 minutos). Desenho, instalação, bateria de isolamento e como desfazer estão em
[`docs/operacao/runner-proprio.md`](../operacao/runner-proprio.md); a seção 0 diz o que mudou do desenho para o
instalado. Scripts, units e vigias versionados em `infra/runner/`.

| Peça | O que faz | Onde |
|---|---|---|
| Usuário `gh-runner` (UID 1500, sem senha, shell `nologin`, só o próprio grupo) | Roda o runner (`vps-nutri-ci`, rótulo `nutri-ci`) e um Docker **rootless** próprio: o "root" dos contêineres do CI é o UID 1500 no host. Outro socket (`/run/user/1500/docker.sock`), sem Swarm, outro diretório de dados; o socket de produção fica inacessível | `infra/runner/instalar-1-base.sh` (passo 2), `instalar-2-runner.sh`; `infra/runner/user/docker-env.conf`, `daemon.json` (espelho `mirror.gcr.io`) |
| `user-1500.slice` | `CPUQuota=400%` (4 de 8 vCPU), `MemoryHigh=10G`, `MemoryMax=12G`, sem swap, `TasksMax=4096`, teto de IO no `/dev/sda`. É o limite real: os `--cpus`/`--memory` do `container:` são conveniência, porque o YAML de um PR pode tirá-los | `infra/runner/etc/user-1500-slice.conf` |
| Namespace de montagem do `user@1500` | `InaccessiblePaths` em `/etc/easypanel`, `/srv`, `/home/deploy`, `/root`, `/run/docker.sock`, `/var/crash`, `/opt/backup` e `/etc/nutri-backup`; `/tmp` (4 GB) e `/var/tmp` (1 GB) em tmpfs próprio. Vale para todo processo do runner, de qualquer UID. **Sem** `ProtectProc=invisible`: ele esconde o PID 1, que o runner lê para iniciar job com `container:` | `infra/runner/etc/user@1500-isolamento.conf` |
| Disco do CI | `/home/gh-runner` é uma imagem ext4 de 100 GB pré-alocada (`loop,nosuid,nodev`): o CI não enche o disco da produção | `instalar-1-base.sh`, passo 4 |
| Filtro de saída | Tabela nft própria `inet nutri_ci_egress`: só os pacotes do UID 1500 e da faixa subordinada 165536–231071 entram na cadeia `ci`; saída só 80/443 e DNS; loopback, IP do host, redes privadas e IPv6 recusados. O resto do host segue `accept` | `infra/runner/etc/egress.nft`, `nutri-ci-egress.service`, `user@1500-egress.conf` |
| Vigia de início | Antes de cada job (`ACTIONS_RUNNER_HOOK_JOB_STARTED`): confere `DOCKER_HOST`, daemon rootless sem Swarm, socket e pastas da produção inacessíveis, `crontab` recusado, rede barrada (painel :3000, Postgres de dev :54329, Mailpit :8025, IP do host, Swarm), `/tmp` em tmpfs, disco do CI montado, `/` abaixo de 60%, 20 GB livres no disco do CI e 8 GB de memória disponível. Qualquer falha reprova o job antes de rodar o código do PR | `infra/runner/hooks/inicio.sh` (instalado em `/opt/nutri-ci/hooks/`, `root:root`) |
| Vigia de fim | Depois de cada job (`ACTIONS_RUNNER_HOOK_JOB_COMPLETED`): apaga todos os contêineres, redes, volumes (menos os com o rótulo `nutri-ci.manter`, como o `nutri-ci-pnpm`), imagens soltas e o cache de build acima de 25 GB; apaga `_work/_tool` e `_work/_temp` entrando no espaço de usuários do Docker do CI (`nsenter -U`), sem imagem nenhuma; limpa o `/tmp` privado. `set +e`: nunca reprova o job | `infra/runner/hooks/fim.sh` |
| Poda semanal | `docker system prune` e `docker builder prune` do que tem mais de 7 dias, aos domingos às 14h BRT | `infra/runner/user/nutri-ci-poda.service`, `.timer` |
| Fora do runner | `gh-runner` em `/etc/cron.deny` e `/etc/at.deny` e `DenyUsers gh-runner` no SSH: nada roda fora do isolamento | `instalar-1-base.sh`, passo 3 |
| Conferência | `verificar.sh` (só lê) compara o instalado com o versionado; `testar-isolamento.sh` é a bateria da seção 6 do runbook; `atualizar-isolamento.sh` e `atualizar-hooks.sh` reinstalam só uma parte | `infra/runner/` |

O que mudou nos testes por causa do runner (seção 0 do runbook):

1. **Testcontainers por IP direto.** No Docker rootless, a porta publicada de um contêiner só existe do lado do host, e o
   filtro barra o loopback para o job, de propósito. O job `test` liga o próprio contêiner à rede `bridge`; com
   `NUTRI_CI_REDE_DIRETA=1`, `test/postgres-teste.ts` troca o host da URL pelo IP do Postgres na `bridge`, porta 5432, e
   espera só pelo healthcheck (`novoPostgres`, `uriDoPostgres`). Fora do runner próprio, nada muda. Usam essas funções
   o `test/global-setup.ts` e o `src/db/migrate-owner.test.ts`. O Ryuk fica desligado porque o vigia de fim apaga todos
   os contêineres.
2. **Paralelismo.** O contêiner do job enxerga os 8 núcleos da VPS, mas a slice limita a 4. Os padrões davam 4 workers
   no Playwright (prazos estourados) e 7 no Vitest (deadlock de DDL do `rls-guard.test.ts` contra outro arquivo, corrigido
   depois no SUS-100, ver [o `global-setup`](#o-global-setup-testglobal-setupts)). No CI:
   `workers: 2` (`playwright.config.ts:12`) e `maxWorkers: 3` (`test/arquivos-de-tempo.ts`), como no runner hospedado de 4 vCPU.
   Os testes que medem tempo saem da suíte paralela e rodam depois, sozinhos (`pnpm test:tempo`, desde o PR #34).
3. **Permissões valem no `test`.** O job roda como root no contêiner. Sem `DAC_OVERRIDE`/`DAC_READ_SEARCH`, os testes de
   pasta ilegível (`chmod 000`) se comportam como no usuário comum do runner hospedado. Por isso o `apt` não roda ali, e o
   `jq` (usado pelo `ci-ja-passou.sh`, que o `test/ci-ja-passou.test.ts` executa) vem do binário estático oficial,
   conferido pelo sha256 (`ci.yml:107-112`).
4. **E2E sem cair no padrão de dev.** No runner próprio, os padrões de dev apontariam para o Mailpit e o banco de dev da
   VPS. Com `CI` definida, `e2e/mailpit.ts` lança erro sem `MAILPIT_URL`, e `e2e/whatsapp.ts` (`doAmbiente`) lança erro
   sem `EVOLUTION_WEBHOOK_SECRET` ou `DATABASE_URL`.
5. **Orçamento da imagem com a mesma conta em qualquer Docker** (`ci.yml:255-275`). O Docker 29 do runner (armazenamento
   do containerd) salva as camadas já em gzip, e o `gzip -6` por cima dava 266–267 MB. A conta extrai o `docker save`,
   descomprime cada camada em gzip e comprime o pacote inteiro de uma vez: 263 MB, o mesmo número do runner hospedado
   (12/10/2026).

Tempos medidos no canário 9 (runbook, seção 0): `quality` 2 min, `test` 6 min, `e2e` 18 min, `image` 4 min, um job por
vez (no hospedado: 1, 8, 21 e 4 min, em paralelo).

**Guardas dos workflows (`test/runner-proprio.test.ts`).** Leem os workflows como texto (sem os comentários, salvo a busca
de segredos, que lê o texto bruto) e quebram o CI se:

- algum workflow usar `pull_request_target`, `workflow_run` ou `issue_comment` (gatilhos que rodariam código de
  terceiros com segredos no runner);
- um dos jobs `mudancas`, `quality`, `test`, `e2e` e `image` do `ci.yml` sumir ou deixar de rodar em
  `[self-hosted, nutri-ci]` (o `ci-ja-passou.sh` depende desses nomes);
- algum job tiver `runs-on` diferente de `ubuntu-latest` ou `[self-hosted, nutri-ci]`, escrito exatamente assim (só o
  rótulo `nutri-ci` também mandaria o job para a VPS); job sem `runs-on` só se for chamada a um workflow reutilizável;
- algum job que não roda no `ubuntu-latest` citar `secrets`, permissão de escrita (`: write`, `write-all`) ou
  `EASYPANEL`, procurado no texto **bruto**, com comentários (o GitHub expande `${{ secrets.X }}` até num comentário de
  shell dentro de um `run:`); as permissões do topo do `ci.yml` não podem escrever, e o job `ci` do `deploy.yml` não
  passa `secrets:` nem `permissions:`;
- o `decidir` ou o `publish` do `deploy.yml` sair do `ubuntu-latest`, ou o `publish` perder o `packages: write`;
- a publicação de emergência deixar de exigir a `main` e a confirmação digitada, o job `confirmar` deixar de falhar com
  a confirmação errada, o `decidir` e o `ci` deixarem de rodar só no `push`, ou o disparo manual deixar de cancelar o
  deploy em curso.

As guardas são alarme contra engano, não barreira: quem edita o YAML de um PR também pode editar o teste (comentário no
topo do arquivo).

**Risco aceito (runbook, seção 9).** O runner é persistente: o código de um PR roda com o mesmo UID do runner e
poderia alterar o runner e forjar o "verde" dos jobs, em que o `ci-ja-passou.sh` confia. O que não cai: a imagem
publicada é montada no `ubuntu-latest` a partir do `github.sha`, e o `decidir` fica hospedado. Fase 2: runner efêmero
(JIT).

**Mudança só de documentação (Plano 12, R-D1, dono, 07/10/2026).** O job `mudancas` compara os arquivos do PR (ou do
push na `main`) com a base, sem ação de terceiros: num PR, `git diff --name-only <base>...<head>` (desde o ponto em que o
branch saiu da `main`); no push, contra o commit anterior (`github.event.before`). Se **todos** os arquivos são de
documentação — `docs/**`, qualquer `*.md` (inclusive `CLAUDE.md` e `AGENTS.md`) e `.claude/agents/**` —, a saída
`codigo` é `false` e os jobs `test`, `e2e` e `image` são pulados (economia de minutos do Actions); o `quality` roda
sempre. Na dúvida — base ausente ou fora do histórico (primeiro push, push forçado), diff vazio —, `codigo` é `true` e
roda tudo. Nenhum teste lê `docs/` ou `*.md` (conferido em 07/10/2026), então pular os testes num PR só de documentação
não esconde falha. O `ci.yml` expõe a saída ao `deploy.yml` (`on.workflow_call.outputs.codigo`): commit só de
documentação na `main` não reconstrói a imagem nem refaz o deploy (`publish` com `if: needs.ci.outputs.codigo == 'true'`).
Job pulado por `if` conta como aprovado nas verificações obrigatórias do GitHub.

**Por que 265 MB.** O GHCR gratuito tem 500 MB e o deploy mantém duas versões (a nova e a que está rodando).
O `@sentry/node` v11 trazia ~6 MB de plugins de bundler sem uso; o `pnpm-workspace.yaml` poda o
`@sentry/bundler-plugins` por `overrides` (decisão do dono no Plano 08, Tarefa 2). No Plano 11, o estágio `build` do
Dockerfile apaga do `pdf-lib` e do `@anthropic-ai/sdk` o que não roda no worker (bundles de navegador e ES, fontes TS,
declarações de tipo e source maps, ~5 MB comprimidos); se a versão mudar o caminho, o build para. No Plano 12, o mesmo
estágio deixa do `@hyzyla/pdfium` só o `dist/index.esm.js` e o `dist/pdfium.wasm` (a poda tira ≈ 2,8 MB comprimidos e
sobram ≈ 2,1 MB, quase todo o WASM, indispensável); com ele a imagem foi a 262–263 MB e o limite subiu de 260 para
**265 MB** (D-R2, aprovada pelo dono em 07/10/2026, sem custo). Duas versões de 265 MB só cabem nos 500 MB porque as
camadas são compartilhadas entre versões (como já acontecia com 2 × 260): se um dia o push do deploy for recusado por
espaço no GHCR, a causa é esta.

### `deploy.yml` (push na `main`)

```mermaid
sequenceDiagram
  participant GH as GitHub Actions
  participant R as GHCR
  participant EP as Easypanel
  participant APP as nutri_app
  participant W as nutri_worker
  alt push na main
    GH->>GH: job decidir, hospedado (.github/scripts/ci-ja-passou.sh)
    alt o PR já passou o CI nesta árvore
      GH->>GH: job ci pulado
    else qualquer dúvida
      GH->>GH: job ci (ci.yml inteiro de novo, no runner próprio)
    end
  else disparo manual na main com "PUBLICAR-SEM-CI" (emergência)
    GH->>GH: decidir e ci não rodam; cancela o deploy de push em curso
  else disparo manual errado (outro branch ou outro texto)
    GH->>GH: job confirmar falha; nada é publicado
  end
  GH->>R: build + push :<sha> e :latest (sem provenance/SBOM)
  GH->>R: delete-package-versions (mantém 2)
  GH->>EP: POST EASYPANEL_DEPLOY_HOOK_APP
  GH->>EP: POST EASYPANEL_DEPLOY_HOOK_WORKER
  EP->>APP: nova imagem → docker-entrypoint.sh app
  APP->>APP: node scripts/migrate.ts (DATABASE_URL_MIGRATOR)
  APP->>APP: env -u DATABASE_URL_MIGRATOR next start
  EP->>W: nova imagem → docker-entrypoint.sh worker (sem o migrator)
```

| Passo | Onde | Por quê |
|---|---|---|
| Imagem publicada montada no hospedado; o CI na VPS | `deploy.yml`, job `publish` (`runs-on: ubuntu-latest`, `:84`); `ci.yml`, job `image` (`push: false`) | O `publish` fica hospedado para os webhooks do Easypanel e o `packages: write` nunca irem para a VPS, e para um runner comprometido não alterar a imagem publicada. Desde 12/10/2026, o CI (inclusive o build de prova do job `image`) roda na VPS, dentro da `user-1500.slice` (4 de 8 vCPU, 12 GB), que protege a produção e o CRM `cursoia_crm` (RNF-03; antes: "build nunca na VPS", Plano 01, Global Constraints) |
| `decidir` hospedado e só no `push` | `deploy.yml:41-44` | Não depende do runner próprio e não pode ser forjado por ele (cerca de 1 min por merge) |
| CI do PR não se repete | `deploy.yml`, job `decidir` (`.github/scripts/ci-ja-passou.sh`) | Dono, 09/10/2026: economia de ~36 min do Actions por merge (plano Free, 2 mil/mês); com o runner próprio, a economia é de tempo do runner e de espera do deploy; detalhes abaixo |
| `publish` só com código | `deploy.yml`, `if` do `publish` (`:77-82`): CI pulado pelo `decidir` **ou** `needs.ci.outputs.codigo == 'true'` **ou** a publicação de emergência | Plano 12 (R-D1): commit só de documentação não gera imagem nem deploy |
| `provenance: false`, `sbom: false` | `deploy.yml:109-110` | Cada push vira um manifesto só; a poda conta versões reais |
| Poda antes dos webhooks | `deploy.yml:113-121` | Se o deploy falhar, a poda já rodou; mantém a imagem nova e a anterior (a que roda) |
| Webhooks obrigatórios | `deploy.yml:127` | Sem `EASYPANEL_DEPLOY_HOOK_APP`/`_WORKER` o job falha com mensagem clara |
| `concurrency: deploy-main`; o `push` não cancela | `deploy.yml:19-21` | Dois merges seguidos implantam em ordem. Só o disparo manual de emergência cancela o deploy em curso (`cancel-in-progress` com `workflow_dispatch`): com o runner fora do ar, o deploy de push fica preso na fila do CI (até 24 h) segurando o grupo |
| Migrations no app, antes do `start` | `docker-entrypoint.sh` (modo `app`) | O migrator do Drizzle aplica **todas** as pendentes numa única transação (`drizzle-orm/pg-core/dialect.js`, `migrate`, `session.transaction`, linhas 60-71), não uma transação por migration: se uma falhar, nenhuma da leva fica gravada e o container novo não sobe |
| `DATABASE_URL_MIGRATOR` fora dos processos longos | `docker-entrypoint.sh` (`env -u`) | O role dono do schema pode desligar a RLS; só o passo de migration o vê |

**Deploy sem repetir o CI do PR (dono, 09/10/2026).** Antes, todo push na `main` rodava o `ci.yml` inteiro de novo
(`quality`, `test`, `e2e`, `image`: ~36 min) sobre a mesma árvore que o PR já tinha testado. Agora o job `decidir`
(`contents: read`, `pull-requests: read` e `actions: read`, só nele; `GITHUB_TOKEN`; sem ação de terceiros nova) roda
`.github/scripts/ci-ja-passou.sh` e só responde `pular=true` quando **tudo** vale:

1. o commit da `main` é o merge de um PR para a `main` (`gh api repos/{repo}/commits/{sha}/pulls`: `merged_at`
   preenchido e `merge_commit_sha` igual ao commit);
2. a árvore do commit da `main` é **idêntica** à do head do PR (`git rev-parse <sha>^{tree}`; o head vem de
   `refs/pull/<n>/head` quando não está no histórico, como num squash) e a `main` anterior (`github.event.before`) está
   no histórico do head — o CI de PR roda no merge do head com a base, então só assim ele testou exatamente esta árvore;
3. a execução mais recente do `ci.yml` (evento `pull_request`) **deste PR** — nome `ci-pr-<n>-<base.sha>` (o `run-name`
   do `ci.yml` grava o número do PR e o `base.sha` quando a execução é criada; a API só preenche
   `workflow_runs[].pull_requests` com o PR aberto e, depois do merge, o devolve vazio), do próprio repositório
   (`head_repository`, fork não) e com essa base no histórico do head — terminou em `success`, com `quality`, `test`,
   `e2e` e `image` em `success` (última tentativa, `filter=latest`).

Qualquer dúvida — entrada ausente, primeiro push, API fora do ar ou resposta estranha, árvore diferente, PR
desatualizado, execução de outro PR, com base fora do histórico, sem o nome `ci-pr-…` (anterior ao `run-name`), de fork, CI cancelado, com falha ou em andamento, job ausente ou pulado — vira `pular=false`, e o `ci` roda como
antes. O script nunca falha o job; se o próprio `decidir` falhar, o `ci` roda do mesmo jeito (`if: !cancelled() &&
pular != 'true'`). PR só de documentação (com `test`, `e2e` e `image` pulados pelo `mudancas`) também não pula: o CI
desse caso já é curto e é ele que decide não publicar (`codigo == 'false'`). Por isso, quando o CI é pulado, o PR tinha
código e o `publish` roda direto. Nas fusões de hoje (merge commit com a `main` já mesclada no branch), as três
condições de árvore e histórico valem (conferido nos merges dos PRs #27 a #30). Os casos estão em
`test/ci-ja-passou.test.ts` (`gh` falso e repositórios git reais: merge, squash, árvore diferente, PR desatualizado, outro PR, outra base, fork, base fora do histórico, CI
`failure`/`cancelled`/em andamento, execução mais recente, job pulado ou ausente, sem PR, API falhando, resposta
inválida).

**Primeiro deploy depois deste merge.** A execução do CI do próprio PR que trouxe o `run-name` não tem o nome
`ci-pr-…` (foi criada antes dele), então esse deploy ainda roda o CI completo. A economia começa no PR seguinte. Quando o
deploy chama o `ci.yml` (`workflow_call`), o `run-name` dele é ignorado e vale o nome da execução do deploy.

**Publicação de emergência (`workflow_dispatch`, 12/10/2026).** Com o runner próprio fora do ar não há CI nem deploy
normal: o job `ci` ficaria esperando o runner. O `deploy.yml` aceita um disparo manual (`deploy.yml:8-12`) com o campo
`confirmo`. O `publish` só roda se o disparo for na `main` e o campo for exatamente `PUBLICAR-SEM-CI` (`:79`); o
`decidir` e o `ci` só rodam no `push` (`:42`, `:67`), então ficam `skipped`, e o `!cancelled()` deixa o `publish` ser
avaliado. Disparo fora da `main` ou com o texto errado roda o job `confirmar` (`:26-33`, hospedado), que falha com
"Publicação de emergência recusada: dispare na main e digite exatamente PUBLICAR-SEM-CI": a execução fica vermelha em vez
de fechar verde com tudo `skipped`. O disparo manual também cancela um deploy de push em curso (`:19-21`), preso na fila
do runner fora do ar. Publica **sem CI**: só depois da validação local (`lint`, `typecheck`, `test`, `e2e`) e com o OK
explícito do dono (comentário do `deploy.yml`; runbook, seção 9). As guardas estão em `test/runner-proprio.test.ts`.

**Merge = deploy = reinício de serviço.** Por isso o merge exige o OK explícito do dono e um snapshot no hPanel antes
(regra 6 do `CLAUDE.md`; regras 3 e 5 do `CLAUDE.md` do servidor). Volta atrás: os serviços usam `:latest`, então
"redeploy" não basta; o dono fixa o `:<sha>` anterior no app e no worker e volta para `:latest` antes do próximo
merge. Migration não volta. Roteiro em [§6.8.1](06-worker-seguranca-operacao.md#681-roteiro-de-volta-atrás). As migrations seguem o padrão expand/contract: a versão antiga do código
convive alguns segundos com o schema novo (spec §9.7).

---

## 7.8 Ambiente de desenvolvimento

O desenvolvimento acontece na própria VPS (spec §9.4), ao lado da produção. Tudo de dev escuta só em `127.0.0.1`.

### Portas

| Porta | Serviço | Origem |
|---|---|---|
| 3000 | Painel do **Easypanel** (não usar) | `CLAUDE.md` do servidor |
| 3100 | `pnpm dev` (`next dev -p 3100`) e o E2E local | `package.json`, script `dev`; `playwright.config.ts:4` |
| 54329 | Postgres 16 de dev | `docker-compose.dev.yml` |
| 8025 | Mailpit: interface **e** API HTTP usada pelo transporte (`/api/v1/send`, `src/email/transport.ts:43`) | `docker-compose.dev.yml` |
| 1025 | Mailpit SMTP (exposta, mas o app não usa SMTP) | `docker-compose.dev.yml` |
| 3200 / 54339 | App e banco da pilha de carga (só com OK do dono) | `docker-compose.carga.yml` |

### Peças

- **`docker-compose.dev.yml`** (projeto `nutridebby-dev`): `postgres:16-alpine` com `mem_limit: 512m`, volume
  `nd-dev-db` e healthcheck; `axllent/mailpit:v1.27` com `mem_limit: 128m`.
- **`.env.local`** (fora do git, ignorado também no `.dockerignore`): copie `.env.example` e preencha. O
  `.env.example` traz só os nomes, com comentários dizendo qual processo usa cada variável e como gerar os
  segredos. Em dev: `EMAIL_TRANSPORT=mailpit`, `WHATSAPP_SANDBOX=1` e as chaves de teste da Cloudflare para o
  Turnstile (aceitas só em `localhost`, `src/env.ts:161`).
- **`pnpm db:migrate`**: `scripts/migrate.ts` lê `.env.local` (`--env-file-if-exists`), usa `DATABASE_URL_MIGRATOR`
  e cria ou sincroniza o role de `DATABASE_URL` (`ensureAppLogin`, `src/db/migrate.ts`).
- **`pnpm worker`**: o worker pg-boss com `tsx` (e-mails, lembretes, PDFs, fotos do diário, varreduras). Sem ele,
  nenhum e-mail chega ao Mailpit.
- **`pnpm admin:criar <email>`**: cria o admin e imprime no terminal o link de definição de senha (1 h, uso único).
- **TACO e medidas**: entram pelas migrations `0039_seed_taco.sql` e `0042_seed_medidas_ibge.sql`. `pnpm seed:taco` e
  `pnpm seed:medidas` só regeneram esses arquivos a partir de `seeds/`.
- **MCPs** (`.mcp.json`): `postgres-dev` (Postgres MCP em modo `restricted`, URL vinda de `NUTRI_DEV_DATABASE_URL`, só o
  banco de **dev**), `shadcn` e `next-devtools`. `.claude/settings.json` desliga os plugins Vercel e Supabase.
- **Next 16**: o `AGENTS.md` avisa que esta versão muda APIs e convenções. Leia o guia em `node_modules/next/dist/docs/`
  antes de escrever código de rota, proxy ou cache. O arquivo de interceptação é `src/proxy.ts`, não `middleware.ts`.

### Versões

| Ferramenta | Versão | Onde |
|---|---|---|
| Node | 24 | `.nvmrc`, `engines` do `package.json`, `Dockerfile` (`node:24-bookworm-slim`) |
| pnpm | 12.6.0 | `packageManager` do `package.json` (via `corepack`) |
| Postgres | 16 | `docker-compose.dev.yml`, `test/postgres-teste.ts:11`, CI |
| Mailpit | v1.27 | compose e CI |

---

## 7.9 As 10 regras do `CLAUDE.md`, com o porquê

O `CLAUDE.md` do projeto é lido por todo agente que trabalha no repositório. As regras são curtas porque a garantia
real está no código e nas guardas; a regra diz onde.

| # | Regra (resumo) | Por quê | Onde o código garante |
|---|---|---|---|
| 1 | Toda consulta a tabela com `tenant_id` passa por `withTenant(ctx, fn)`. O admin nunca consulta essas tabelas. `withConta` só em `vinculos.ts`. Exceções nominais para `user`, `consents`, `invites` e as tabelas sem tenant | A RLS só funciona se a transação tiver `app.tenant_id`, `app.role`, `app.patient_id`, `app.user_id` e `app.ip`. Fora de `withTenant` a conexão vê 0 linhas (Plano 01, Review Focus 1). A lista de exceções é nominal para que cada acesso fora da RLS seja auditável por leitura | `withTenant` (`src/db/tenant.ts:86`) com `set_config(..., true)`; `assertContext` recusa papel `admin` e exige `actorUserId` para nutricionista e paciente com login; guardas `sem-tabelas-tenant.test.ts` e `sem-conta-guarda.test.ts` |
| 2 | Tabela nova com `tenant_id`: migration custom com `app_enable_tenant_rls` (+ `patient`, `staff_only`, `publico`, escrita do paciente, audiência) e a entrada na lista certa | Isolamento no banco, não na aplicação: um bug de consulta não vaza dado de outro consultório. Negar por padrão faz a tabela nova nascer fechada | `rls-guard.ts` e `rls-guard.test.ts` ([§2.7](02-banco-de-dados.md#27-guardas-no-ci), 7.4.1) |
| 3 | Senhas, tokens, cookies e dados de saúde nunca vão para log, Sentry ou mensagens | LGPD e sigilo profissional: o log e o Sentry não são lugar de dado sensível, e o Sentry é um serviço de terceiro | `REDACT_KEYS` do pino (`src/lib/logger.ts:4`); `sanitizarErroDeBanco` no `withTenant`; filtro único `src/lib/sentry-filtro.ts`; `sem-detalhe.test.ts` |
| 4 | Textos de interface em pt-BR, com o texto exato da spec | As histórias têm critérios BDD com o texto exato; o E2E procura por esse texto (`getByRole(..., { name })`) | Specs E2E; tabelas "Textos de interface" nas histórias |
| 5 | MCP de banco só no dev; proibido em produção | Um agente com acesso de leitura à produção leria dado de saúde real | `.mcp.json`: `postgres-dev` com `--access-mode=restricted` e URL do dev |
| 6 | Configuração só pelo Easypanel; confirmar com o dono antes de reiniciar serviço, mexer no banco de produção ou dar merge | O Easypanel sobrescreve no próximo deploy o que for mudado por fora; o merge reinicia app e worker | `deploy.yml` (merge → webhooks) |
| 7 | Migrations sempre com `DATABASE_URL_MIGRATOR` | `ALTER DEFAULT PRIVILEGES` vale só para tabelas criadas pelo role que o emitiu. Migration rodada com outro role cria tabela sem permissão para `nutri_app` | `drizzle/0000_base_roles_e_rls.sql:17-19`; `scripts/migrate.ts` usa `getMigratorEnv()` |
| 8 | Dado de saúde ganha `app_enable_audit`; leitura de dado de saúde chama `auditRead` na mesma transação; exceções em `AUDIT_EXCEPTIONS` | US-007/RNF-08: o "Histórico de acessos" do paciente mostra quem leu e quem alterou. O gatilho garante a escrita; a leitura precisa da chamada explícita | `audit-guard.ts`/`audit-guard.test.ts`; `auditRead` (`src/modules/plataforma/audit.ts:28`) |
| 9 | Arquivos só por `salvarArquivo`/`apagarArquivo`, servidos por `signFileUrl` (5 min); nunca caminho com texto do usuário; tabela nova em `FABRICAS`; PDF e ZIP só no worker | Tipo pelo conteúdo, cota reservada na transação e registro no mesmo commit: sem arquivo órfão nem registro sem arquivo. URL assinada curta impede link permanente para laudo | `salvarArquivo` (`src/modules/plataforma/armazenamento.ts:64`, `registrar`), `apagarArquivo` (`:160`, `naMesmaTransacao`), `signFileUrl` (`src/lib/signed-url.ts:16`); guardas do grafo de imports |
| 10 | Backup roda no host, não no worker; `nutri-backup.sh` só no `test/backup.test.ts`; restauração só no teste e no teste mensal com confirmação | Há bancos de produção no mesmo host: rodar o script por engano faria backup ou restauração de verdade | `backup.test.ts:247` ("nenhum outro arquivo de código cita o script"); ambiente montado à mão nos dois testes |

---

## 7.10 Fluxo de revisão a cada entrega

Definido no índice dos planos (`docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md`, seção "Revisão
obrigatória a cada entrega") e resumido no `CLAUDE.md`. Revisto pelo dono em 02/10/2026.

```mermaid
flowchart TD
  T[Tarefa implementada] --> R1[Etapa 1: revisor por tarefa<br/>lentes: spec/qualidade e segurança/LGPD<br/>+ verificação adversarial]
  R1 -->|até 2 rodadas de correção| T2[Próxima tarefa]
  T2 --> F[Etapa 2: revisão final do branch<br/>workflow em lentes<br/>+ uma onda de correções]
  F --> PR[PR aberto, CI verde]
  PR --> CR["Etapa 3: /code-review high UMA vez"]
  CR --> C[Corrige Critical/Important<br/>Minor → backlog]
  C --> RR[Etapa 4: re-revisão só do diff das correções]
  RR --> S["/security-review<br/>checklist reforçado"]
  S --> Q{sobrou Critical/Important?}
  Q -->|sim| P[Para e avisa o dono]
  Q -->|não| OK[OK do dono + snapshot no hPanel → merge = deploy]
```

| Regra | Detalhe |
|---|---|
| `/code-review high` uma vez | A 2ª rodada completa "precisa sair limpo" foi abolida em 02/10/2026: revisar ~10 mil linhas de novo amostra trechos novos e sempre acha Minors novos. Os Planos 03 e 04 precisaram de aprovação do dono para encerrar |
| Re-revisão do diff | É ela que confirma que a correção está certa |
| Minor | Vai para um item "débitos do Plano NN" no backlog, agrupado por tema (ex.: P08-11) |
| Segurança | `/security-review` em todo plano; checklist reforçado (RLS, isolamento por paciente, LGPD, uploads, autenticação, webhook, páginas públicas, links assinados) nos Planos 01–03 e 05–08 |
| Sem custo extra | Tudo roda na assinatura do dono; o `/code-review ultra` não é usado |
| Registro | O resumo de cada rodada vai no PR e na seção "Resultado da entrega" do plano |

Nos Planos 07 e 08 o `/code-review high` rodou também **sobre o plano**, antes da execução (10 achados em cada,
corrigidos no texto).

---

## 7.11 Como abrir um plano novo

O projeto usa as skills do *superpowers*: brainstorming → spec → plano → execução por tarefas → revisões → PR →
merge com o OK do dono. Cada plano é escrito em detalhe **só quando o anterior termina**, porque consome nomes, tipos e
padrões reais do código (índice, "Sequência e dependências").

```mermaid
flowchart LR
  B[brainstorming<br/>escopo com o dono] --> S[spec<br/>docs/superpowers/specs]
  S --> P[plano<br/>writing-plans]
  P --> D[decisões ★ do dono<br/>+ /code-review high do plano]
  D --> X[execução<br/>subagent-driven / workflow<br/>branch plano-NN-nome]
  X --> R[revisões 7.10]
  R --> M[PR + runbook<br/>merge com OK = deploy]
  M --> F[fechamento<br/>spec vN+1, backlog, painel]
```

### Passo a passo

1. **Escopo.** Converse com o dono (skill `superpowers:brainstorming`). Nada de código antes.
2. **Spec.** Mudança de requisito entra em `docs/superpowers/specs/2026-09-27-nutridebby-mvp-design.md` (e nas
   histórias), com versão nova no Apêndice C.
3. **Plano.** Arquivo `docs/superpowers/plans/AAAA-MM-DD-nutridebby-NN-<nome>.md`, escrito a partir de um commit
   citado da `origin/main`. Estrutura usada nos Planos 02–08:

   | Seção | Conteúdo |
   |---|---|
   | Cabeçalho | Aviso "REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou executing-plans)"; Goal, Architecture, Tech Stack, links da spec e do índice |
   | Global Constraints | O que vale para todas as tarefas (versões, portas, regras do servidor, número da primeira migration) |
   | Decisões de desenho | Tabela D1…Dn; as ★ são do dono, com o custo de cada alternativa |
   | Desvios conscientes da spec | O que o plano faz diferente e por quê; vira a próxima versão da spec |
   | Itens adiados / débitos | O que vem dos planos anteriores |
   | Review Focus | Os riscos que o revisor deve atacar, cada um com o teste que o cobre |
   | Estrutura de arquivos | Arquivos novos e alterados |
   | Tasks | Por tarefa: **Files**, **Interfaces** (consome/produz) e passos em caixas de seleção, começando por "Escrever o teste que falha" (TDD) e terminando no commit |
   | Runbook do deploy | O que o dono faz, com confirmação a cada passo |
   | Fechamento | Revisões, backlog, spec, lembretes ao dono |
   | Autorrevisão (writing-plans) | Cobertura da spec, placeholders, consistência de nomes, Review Focus |
   | Decisões para o dono / Execução / Resultado da entrega | Aprovação, modo de execução e o registro final (commits, achados, CI, deploy) |

4. **Aprovação.** O dono aprova as decisões ★. Desde o Plano 07, o plano passa por `/code-review high` antes da
   execução.
5. **Execução.** Branch `plano-NN-<nome>` (ou worktree). Uma tarefa por subagente, com revisor por tarefa. Tarefas
   independentes podem rodar em worktrees paralelos, integradas no branch do plano (Planos 06–08).
6. **Migrations.** O plano diz o número da primeira migration. Se outra entrar antes, renumere no rebase e corrija as
   referências (Plano 08, Global Constraints). Nunca rode migration no banco de dev compartilhado sem combinar, nem em
   produção fora do deploy.
7. **Revisões** (7.10), **PR** com o resumo das rodadas e **CI verde**.
8. **Merge.** Só com o OK explícito do dono e o snapshot no hPanel. Merge = deploy.
9. **Fechamento.** Um PR curto de docs (ex.: PR #15, `plano-08-fechamento`): spec na versão seguinte, backlog
   (`2026-09-27-nutridebby-backlog.md` **e** o painel em artifact citado no `CLAUDE.md`), "Resultado da entrega" no
   plano, o registro do processo no índice e o **manual técnico** (`docs/manual-tecnico/`; roteiro em
   [README, "Como manter este manual"](README.md#como-manter-este-manual)).

---

## 7.12 Guia do primeiro dia

### Leia antes de tocar em código (≈ 2 h)

1. `/home/deploy/servidor/CLAUDE.md` (regras do servidor) e o `CLAUDE.md` do projeto (7.9).
2. `AGENTS.md` e o guia do Next 16 em `node_modules/next/dist/docs/`.
3. Spec §4 (arquitetura) e §5 (requisitos não funcionais).
4. O índice dos planos e o backlog ("Antes do go-live (dono)" e os itens de débitos).
5. `src/db/tenant.ts`, `src/db/rls-guard.ts` e `test/isolamento.test.ts`: é o coração da segurança.

### Monte o ambiente

```bash
nvm use                                   # Node 24 (.nvmrc)
corepack enable                           # pnpm 12.6.0 (packageManager)
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env.local                # preencha; gere os segredos como o .env.example indica
pnpm db:migrate                           # migrations + role nutri_app
pnpm admin:criar voce@exemplo.com         # o link de senha sai no terminal
pnpm dev                                  # http://localhost:3100/entrar
pnpm worker                               # outro terminal; e-mails em http://localhost:8025
```

### Prove que está tudo verde

```bash
pnpm lint && pnpm typecheck
pnpm test                                 # precisa de Docker; sobe o próprio Postgres
pnpm vitest run src/db/rls-guard.test.ts  # só as guardas de RLS
```

### Faça uma mudança pequena

Crie um branch, mude um texto ou um teste, rode os comandos acima e abra o PR. Veja os jobs do CI (no runner próprio, um por vez). Não faça
merge: merge é deploy e precisa do OK do dono.

### O que nunca fazer

| Nunca | Por quê |
|---|---|
| Rodar `pnpm db:migrate`, `pnpm e2e:seed` ou o MCP `postgres-dev` apontando para produção | Altera ou lê dado de saúde real (regras 5 e 6) |
| Rodar `scripts/backup/nutri-backup.sh` ou o script de restauração à mão | Há bancos de produção no host (regra 10) |
| Usar a porta 3000 | É o painel do Easypanel |
| Mudar variável, domínio ou imagem por `docker service update` | O Easypanel sobrescreve; peça ao dono pelo painel |
| Reiniciar serviço, mexer em firewall, SSH ou pacotes sem confirmação | Regra 3 do servidor |
| Colar valor de segredo em chat, PR, log ou documento | Regra 6 do servidor e regra 3 do projeto |
| Consultar tabela com `tenant_id` fora de `withTenant` | Quebra o isolamento (regra 1) |
| Desligar ou "afrouxar" uma guarda para o CI passar | A guarda é a regra; mude a lista com o motivo, ou corrija o código |
| Usar `pull_request_target`, `workflow_run` ou `issue_comment` num workflow, ou levar segredo para um job `self-hosted` | O runner próprio roda na VPS da produção; código de terceiros com segredos chegaria a ele (guarda `test/runner-proprio.test.ts`) |
| Abrir sessão `sudo -iu gh-runner` com o runner ligado, ou disparar a publicação de emergência sem OK do dono | A sessão roda fora do namespace do runner e um job poderia ler o host por ela (runbook do runner, seção 3); a emergência publica sem CI |

### Para desenvolver com segurança

- Escreva o teste antes (os planos fazem assim). Para o banco, conecte como `nutri_app` (`inject('appDatabaseUrl')`);
  use o dono só para conferir.
- Toda tabela nova: siga o [§2.11](02-banco-de-dados.md#211-passo-a-passo-tabela-nova-com-tenant_id).
- Toda leitura de dado de saúde devolvida ao usuário: `auditRead` na mesma transação (regra 8).
- Toda tela nova (painel ou portal): siga o [§7.4.5](#745-checklist-tela-nova). No portal, nenhuma guarda do CI
  confere `requirePaciente`/`requireApiPaciente`.
- Arquivo: só `salvarArquivo`/`apagarArquivo`/`signFileUrl`.
- Log: só ids, códigos e motivos fixos.

---

## 7.13 Divergências encontradas

| # | Fonte | O que diz | O que o código faz |
|---|---|---|---|
| 1 | Spec §9.7, "Merge na `main`" | "no container do app, `migrate` roda antes do `start` (o worker espera a versão do schema)" | **Resolvida no Plano 09 (P09-02 a):** o worker espera a versão do schema (`esperarVersaoDoSchema`, §6.2.1). Antes dela: nenhuma espera. `startWorker` (`src/worker/index.ts:48`) sobe o pg-boss e registra os jobs direto; o modo `worker` do `docker-entrypoint.sh` não consulta migrations; `deploy.yml` chama os webhooks do app e do worker em seguida. A proteção real é o padrão expand/contract |
| 2 | Spec §9.7, "Pull request" | Pipeline em sequência: lint → `tsc` → Vitest → testes de RLS/isolamento → build → Playwright | Jobs separados (`mudancas`, `quality`, `test`, `e2e`, `e2e-webkit` desde o SUS-117, `image`); no runner próprio (desde 12/10/2026), um por vez, na ordem em que o runner os pega. Os testes de RLS e isolamento estão dentro do `pnpm test`; o build está dentro do job `e2e`; o job `image` (orçamento de 265 MB) e o `mudancas` (Plano 12) não aparecem na spec |
| 3 | Spec §9.7, "Merge na `main`" | Push para o GHCR "com tag = SHA do commit" | Também publica `:latest` e poda o pacote para as 2 versões mais recentes (`deploy.yml:103-121`) |
| 4 | Spec RNF-10 (v1.11) | Axe em "42 rotas de `ROTAS_DO_PAINEL`" | 43 entradas em `ROTAS_DO_PAINEL`, uma por `page.tsx` de `src/app/painel` (43), mais `/conta/seguranca` = 44 telas. O Plano 08, D25, fala em "~43" |
| 5 | Spec §9.2 | `@sentry/cli` como dependência de dev "para source maps"; `web-push` na mesma linha de dependências de dev | `@sentry/cli` não está no `package.json` (a própria v1.11 diz que não há source maps do navegador); `web-push` é dependência de produção (`dependencies`) |
| 6 | Índice dos planos, "Convenções" | "lista do teste de isolamento (Plano 01, Tarefa 5)" | A Tarefa 5 do Plano 01 criou a guarda `rls-guard`. A matriz `test/isolamento.test.ts` nasceu no Plano 02, Tarefa 8 (`docs/superpowers/plans/2026-09-28-nutridebby-02-plataforma.md:4268`) |
| 7 | Índice dos planos, cabeçalho e E-04 | Spec "v1.2, aprovada"; E-04 pede Meta Business e WhatsApp Cloud API | A spec está na v1.11; o WhatsApp é pela Evolution API desde a v1.8 (Plano 05). O índice não foi atualizado nesses dois pontos |
| 8 | Plano 01, Global Constraints e Tarefa 14 | Revisão com "`/code-review high` 2×"; o `CLAUDE.md` da Tarefa 14 manda repetir até "sair limpo" | Superado em 02/10/2026: `/code-review high` uma vez + re-revisão do diff (índice e `CLAUDE.md` atual). O texto do Plano 01 ficou como registro histórico |
| 9 | `README.md` | Texto padrão do `create-next-app`: porta 3000, `app/page.tsx`, deploy na Vercel | Porta 3100 (`package.json`), código em `src/app`, deploy GHCR → Easypanel. O README não descreve o projeto |
| 10 | `.prettierrc` | `printWidth: 100` | O CI não roda o Prettier e muitos arquivos passam de 100 colunas (ex.: `src/db/rls-guard.ts`). Não é divergência de spec, mas a configuração não reflete o código |
| 11 | Spec §9.7, "Merge na `main`", e RNF-03 | Build da imagem "no GitHub Actions (não na VPS, para não consumir CPU e memória do CRM)" | Desde 12/10/2026, o CI roda na VPS, no runner próprio, inclusive o build de prova do job `image` (sem push), dentro da `user-1500.slice` (4 de 8 vCPU, 12 GB, sem swap). A imagem **publicada** continua montada no `ubuntu-latest` (job `publish`). A spec ainda não registra o runner próprio |

# 3. Autenticação, sessões e autorização

Este capítulo descreve como alguém entra no NutriDebby, quanto tempo a sessão vale, o que cada papel pode abrir e como os convites, os aceites (DPA e termo) e a suspensão de conta mexem nisso.

Fonte de verdade: o código. Cada afirmação cita o arquivo e a linha ou a função. Decisões vêm dos planos em `docs/superpowers/plans/` (o número do plano e da decisão aparece entre parênteses). As divergências entre spec e código estão no fim.

---

## 3.1 Visão geral

| Peça | Onde | Papel |
|---|---|---|
| Better Auth 1.7.6 | `package.json` (`"better-auth": "1.7.6"`), `src/lib/auth.ts` (`createAuth`) | Login por e-mail e senha, 2FA TOTP, sessões no Postgres, limite de tentativas, redefinição de senha |
| Rota HTTP do Better Auth | `src/app/api/auth/[...all]/route.ts` | Expõe `GET`/`POST` de `/api/auth/*` via `toNextJsHandler(getAuth())` |
| Proxy (Next 16) | `src/proxy.ts` | Filtro barato: sem cookie de sessão em área protegida → `/entrar` |
| Regras puras de sessão | `src/lib/session-rules.ts` (`evaluateSession`) | Decide `ok`/`login`/`expired`/`setup-2fa`/`forbidden`/`suspended` |
| Guardas de página e Server Action | `src/lib/session.ts` (`requireUser`), `src/lib/tenant-session.ts` (`requireNutri`), `src/lib/paciente-session.ts` (`requirePaciente`) | Redirecionam |
| Guardas de Route Handler | `src/lib/api-auth.ts` (`requireApiUser`), `requireApiNutri`, `requireApiPaciente` | Respondem 401/403 em JSON |
| Contexto do banco | `src/db/tenant.ts` (`withTenant`, `withConta`) | Aplica a RLS com tenant, papel, paciente, ator e IP |

Princípio: o proxy só olha se **existe** um cookie. Quem decide o acesso é a guarda chamada **em cada página, Server Action e Route Handler**. O layout não é barreira: `src/app/admin/layout.tsx` (comentário das linhas 3–6) e `src/app/painel/layout.tsx` (comentário da linha 11) dizem isso de forma explícita.

```mermaid
flowchart LR
  B[Navegador] -->|página| P[src/proxy.ts<br/>só confere se há cookie nd]
  P -->|sem cookie em área protegida| E[/entrar?volta=.../]
  P -->|segue| G[Página / Server Action<br/>requireUser · requireNutri · requirePaciente]
  B -->|/api/*| R[Route Handler<br/>requireApiUser · requireApiNutri · requireApiPaciente]
  G --> S[evaluateSession]
  R --> S
  S -->|ok| W[withTenant / withConta<br/>RLS no Postgres]
```

---

## 3.2 Papéis

O papel fica em `user.app_role`, com três valores aceitos pela restrição `user_app_role_valido` (`src/db/schema/auth.ts`, tabela `user`): `admin`, `nutri`, `paciente`. O tipo TypeScript é `AppRole` (`src/lib/session-rules.ts:1`).

| Papel | `user.tenant_id` | Página inicial (`homeFor`, `session-rules.ts:15-17`) | 2FA | Sessão |
|---|---|---|---|---|
| `admin` | nulo | `/admin` | **obrigatório** | 30 min sem uso (aviso 2 min antes), no máximo 8 h; termina ao fechar o navegador |
| `nutri` | o tenant dela | `/painel` | opcional | 30 min sem uso (aviso 2 min antes), no máximo 8 h; termina ao fechar o navegador |
| `paciente` | **nulo** (o vínculo é o prontuário) | `/p/inicio` | não oferecido | 30 dias |

Pontos que importam:

- **Um login, um papel.** O e-mail é global e único (`user.email` é `citext` com `unique()`, `src/db/schema/auth.ts`). A spec (§3, "Modelo de identidade") manda usar outro e-mail para ser nutricionista e paciente ao mesmo tempo. O convite de paciente recusa e-mail de conta da equipe (`MSG_CONVITE_PACIENTE.contaDeEquipe`, `src/modules/pacientes/convite-paciente.ts:26`, checado em `prepararAceite`, linha 176).
- **A conta de paciente não tem tenant.** `aceitarConvitePaciente` grava o `user` sem `tenantId` (`convite-paciente.ts:263`). O vínculo com cada consultório é a linha `patients.user_id`. Por isso o paciente pode ser atendido por várias nutricionistas com o mesmo login (spec §3).
- **O admin nunca consulta tabela com `tenant_id`.** `withTenant` aceita só `nutri`, `paciente`, `worker` e `publico` e lança erro para qualquer outro papel (`src/db/tenant.ts`, `ROLES` e `assertContext`). Plano 01, Global Constraints (§4.1 da spec).
- `appRole`, `tenantId` e `tema` são `additionalFields` com `input: false` (`auth.ts:142-149`): nenhum endpoint do Better Auth deixa o cliente gravá-los.

---

## 3.3 Configuração do Better Auth (`src/lib/auth.ts`)

`createAuth(db, opts)` (linha 32) monta a instância. `getAuth()` (linhas 194-197) guarda uma instância única por processo.

| Opção | Valor no código | Linha | Por quê |
|---|---|---|---|
| `baseURL`, `trustedOrigins` | `APP_URL` | 42, 53-55 | Só a própria origem chama os endpoints |
| `secret` | variável `AUTH_SECRET` (mín. 32 caracteres, `src/env.ts:120`) | 54 | Assina cookies e cifra o segredo do TOTP |
| `logger` | só nível e mensagem vão ao pino | 59 | O erro do Drizzle carrega SQL e parâmetros (token, senha). RNF-11, regra 3 do CLAUDE.md |
| `database` | `drizzleAdapter(db, { provider: 'pg', schema: authSchema })` | 60 | Tabelas `user`, `session`, `account`, `verification`, `two_factor`, `rate_limit` (`src/db/schema/auth.ts`) |
| `verification.storeIdentifier` | `'hashed'` | 64 | Tokens de redefinição e de 2FA ficam só como SHA-256. Plano 02, "Itens adiados do Plano 01", Tarefa 3 |
| `emailAndPassword.disableSignUp` | `true` | 67 | Não existe cadastro público. Contas nascem por convite ou pelo CLI |
| `minPasswordLength` / `maxPasswordLength` | 10 / 128 | 68-69 | US-002 |
| `password.hash` / `verify` | argon2id próprio | 70-73 | Ver 3.4 |
| `resetPasswordTokenExpiresIn` | `RESET_TOKEN_TTL_S` = 3600 s | 30, 74 | US-002: link de 1 h |
| `revokeSessionsOnPasswordReset` | `true` | 75 | Trocar a senha derruba as outras sessões |
| `sendResetPassword` | `deliverPasswordLink` | 77-80 | Ver 3.11 |
| `session.expiresIn` | 30 dias (`PATIENT_SESSION_MS`) | 87 | Padrão; a equipe é cortada para 30 min (e para createdAt + 8 h) no hook |
| `session.disableSessionRefresh` | `true` | 90 | O Better Auth nunca desliza a sessão; só `slideSession` desliza |
| `databaseHooks.session.create.before` | bloqueia tenant suspenso, aplica `capSessionExpiry` e, na sessão que substitui a atual da mesma usuária, herda o `createdAt` | 97-114 | RN-15 e RNF-06 (P12-14: o limite de 8 h conta do login, não da troca de sessão que a ativação do 2FA faz) |
| `databaseHooks.session.create.after` | rechecagem com `FOR SHARE` | 114-118 | Corrida login × suspensão (M8) |
| `rateLimit` | `storage: 'database'`, 100/60 s geral, 5/15 min nas rotas sensíveis | 122-141 | RNF-06 |
| `advanced.cookiePrefix` | `'nd'` | 151 | Cookies `nd.session_token` etc. (com `__Secure-` em https) |
| `advanced.database.generateId` | `'uuid'` | 152 | PK uuid v4 (Plano 01, desvios) |
| `advanced.ipAddress.trustedProxies` | `TRUSTED_PROXIES` | 153 | IP real atrás do Traefik |
| `hooks.before` | login da equipe sem "lembrar de mim", Turnstile, 2FA da web e política de senha | 163-205 | P12-14, INT-06, RN-145 e US-002 |
| `plugins` | `twoFactor({ issuer: 'NutriDebby' })`, `nextCookies()` | 172 | 2FA e cookies em Server Actions |

`TRUSTED_PROXIES` é obrigatória quando `NODE_ENV=production`; sem ela o processo não sobe (`src/env.ts:174-179`), porque o limite de tentativas viraria um balde só para todo mundo.

`src/lib/auth.cli.ts` é uma instância só para o CLI do Better Auth gerar o schema (Plano 01, estrutura de arquivos, linha 85). Ela aponta para um banco inexistente e usa um segredo fixo de mentira. O app nunca a importa.

### Limite de tentativas

`auth.ts:122-141`. Contagem no banco (tabela `rate_limit`), por IP + rota. O IPv6 é agrupado pelo /64 (padrão do Better Auth; comentário em `src/lib/ip.ts:8-10`).

| Rota | Janela | Máximo |
|---|---|---|
| Qualquer `/api/auth/*` | 60 s | 100 |
| `/sign-in/email` | 15 min | 5 |
| `/two-factor/verify-totp`, `/two-factor/verify-backup-code` | 15 min | 5 |
| `/request-password-reset` | 15 min | 5 |
| `/two-factor/enable`, `/two-factor/disable`, `/change-password`, `/verify-password`, `/two-factor/get-totp-uri`, `/two-factor/generate-backup-codes`, `/delete-user` | 15 min | 5 |

As rotas da última linha conferem a senha com a sessão aberta. O limite impede que um cookie roubado vire força bruta da senha (comentário da linha 132). O 429 aparece na tela de login como "Muitas tentativas. Tente novamente em 15 minutos." (`src/app/entrar/page.tsx:31`). E2E: `e2e/auth.spec.ts`, teste "senha errada 5 vezes bloqueia com a mensagem da spec".

---

## 3.4 Senha

**Hash.** Argon2id por `@node-rs/argon2` 2.2.1: `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` (`src/lib/password.server.ts:6-9`). O Better Auth recebe essas funções em `emailAndPassword.password` (`auth.ts:70-73`). Os convites usam o mesmo `hashPassword` (`src/modules/plataforma/convites.ts:85`, `convite-paciente.ts:253`).

**Política.** `validatePasswordPolicy` (`src/lib/password-policy.ts:1`):

| Regra | Mensagem |
|---|---|
| ≥ 10 caracteres | "A senha precisa ter pelo menos 10 caracteres." |
| ≤ 128 caracteres | "A senha pode ter no máximo 128 caracteres." |
| ao menos 1 letra (`\p{L}`) e 1 número (`\p{Nd}`) | "A senha precisa ter pelo menos 1 letra e 1 número." |
| fora da lista de senhas comuns (`src/lib/common-passwords.txt`, comparação sem caixa) | "Essa senha é muito comum. Escolha outra." |

Onde a política roda:

- `hooks.before` do Better Auth, só em `/reset-password` e `/change-password` (`auth.ts:166-169`).
- `aceitarConvite` (nutricionista, `convites.ts:66`; política na linha 73) e `aceitarConvitePaciente` (`convite-paciente.ts:247`), que não passam pelo Better Auth.
- No navegador, como ajuda, sem a lista comum (`src/app/definir-senha/page.tsx:17`).

**Custo do argon2 e convite inválido.** Antes do hash, os dois aceites de convite conferem o token sem trava. Um POST anônimo com token ruim nunca gasta os ~19 MB do argon2 (T6-R2a, `convites.ts:78-85`; `convite-paciente.ts:250-253`).

---

## 3.5 Verificação em duas etapas (2FA)

**Quem é obrigado:** só o admin. `evaluateSession` devolve `setup-2fa` quando `role === 'admin' && !user.twoFactorEnabled` e a página não é `/conta/seguranca` (`session-rules.ts:57`). `requireUser` redireciona para `SECURITY_PATH` (`session.ts`, `case 'setup-2fa'`). `requireApiUser` responde 403 "Acesso negado". Para a nutricionista, o 2FA é opcional e fica em "Configurações > Segurança" (`/conta/seguranca`). O paciente não tem a tela: `src/app/conta/seguranca/page.tsx` chama `requireUser(['admin', 'nutri'], …)`. Decisão da spec §3 ("2FA: obrigatório para o admin; opcional (recomendado) para a nutricionista") e US-003.

**Ativação** (`src/app/conta/seguranca/enable-2fa.tsx`):

1. A usuária confirma a senha → `authClient.twoFactor.enable({ password })` devolve a `totpURI` e os códigos de recuperação.
2. O QR é gerado **no navegador** (`QRCode.toDataURL`); a chave aparece também em texto.
3. O código de 6 dígitos confirma por `twoFactor.verifyTotp`.
4. Os códigos de recuperação aparecem uma vez. O Better Auth gera 10 códigos por padrão (`node_modules/better-auth/dist/plugins/two-factor/backup-codes/index.mjs`, `amount ?? 10`) e guarda-os cifrados (`storeBackupCodes: "encrypted"`).

**Segredo do TOTP.** Fica na tabela `two_factor`, cifrado pelo Better Auth com `symmetricEncrypt` (XChaCha20-Poly1305, `node_modules/better-auth/dist/crypto/index.mjs`) e chave derivada de `AUTH_SECRET`. Desvio consciente do Plano 01 (tabela "Desvios conscientes"): a spec pedia AES-256-GCM com `ENCRYPTION_KEY`. TOTP padrão: 6 dígitos, 30 s.

**Login com 2FA.** O endpoint `/sign-in/email` cria a sessão normalmente. O hook `after` do plugin apaga essa sessão e o cookie, grava um desafio de 10 min em `verification` e um cookie assinado `two_factor` (`node_modules/better-auth/dist/plugins/two-factor/index.mjs`, hook de `/sign-in/email`). O cliente vai para `/entrar/2fa` (`src/lib/auth-client.ts:11-16`). Depois do código certo, o Better Auth cria a sessão definitiva. Consequência: os `databaseHooks` de sessão (bloqueio de tenant suspenso, corte de 30 min) rodam **nas duas** criações. O `createdAt` da sessão definitiva é o do fim do 2FA: o limite de 8 h conta do login completo (P12-14). O hook do plugin apaga o cookie de sessão do `/sign-in/email` mas **mantém** o `dont_remember` (`deleteSessionCookie(ctx, true)`), e o `verify-totp`/`verify-backup-code` o lê: a sessão definitiva da equipe também fica sem `Max-Age` (3.6, "Fechar o navegador").

A tela de 2FA sempre manda `trustDevice: false` (`src/app/entrar/2fa/page.tsx:19`). Nenhum aparelho fica "confiável"; o código é pedido em todo login.

**2FA para assinar documentos (Plano 10A, RN-145, D13).** Para a nutricionista, o 2FA continua opcional para entrar, mas
passa a ser **condição para assinar** documentos: sem `twoFactorEnabled`, o envio digitalizado é recusado e a tela
mostra "Ative a verificação em duas etapas em Segurança para assinar documentos." com o link "Ativar agora". O código é
pedido em todo envio, por `confirmarCodigo2fa` (`src/lib/confirmar-2fa.ts`: `auth.api.verifyTOTP` com a sessão da
própria usuária, 5 erros em 15 min por usuária, anti-repetição de 90 s, `liberarCodigo2fa` quando o envio falha depois
do código aceito). Para não virar um oráculo do código fora desse limite, o hook `before` de `src/lib/auth.ts` recusa o
`/two-factor/verify-totp` chamado pela web com sessão aberta e 2FA já ativo (`TWO_FACTOR_JA_ATIVO`); o login (sem
sessão) e a ativação (2FA ainda desligado) seguem, e a chamada interna (`auth.api`, sem `request`) também. A tela
`/conta/seguranca` ganhou o bloco "Como funciona" com o guia `seguranca`. Detalhe em
[§9.6](09-documentos-assinados.md#96-código-do-2fa-no-momento-de-assinar-rn-145-d13).

---

## 3.6 Sessão, inatividade e renovação

**P12-14 (RNF-06, decisão do dono 07/10/2026; boa prática SBIS NGS1 — bloqueio de sessão por inatividade).** Depois de
ver o login da nutricionista vivo 2 h depois e após reiniciar o computador, o dono decidiu: a equipe (nutricionista e
admin) sai depois de **30 min sem uso**, com **aviso 2 min antes**; a sessão tem **limite absoluto de 8 h** desde o
login completo (depois do 2FA), mesmo com uso contínuo; e **fechar o navegador encerra o login**. Uso = qualquer
requisição autenticada ao servidor **e** atividade real na tela (tecla, clique, rolagem, toque) em qualquer aba do painel
ou do admin — **menos as consultas automáticas da tela** (o polling de estado, ver "Consultas automáticas não são uso"
abaixo). O paciente **não muda** (30 dias, PWA).

### Regras (`src/lib/session-rules.ts`)

| Constante | Valor | Linha |
|---|---|---|
| `STAFF_IDLE_MS` | 30 min | 9 |
| `STAFF_WARNING_MS` | 2 min | 10 |
| `STAFF_MAX_MS` | 8 h | 11 |
| `STAFF_REFRESH_MS` | 5 min (cadência da renovação da equipe) | 13 |
| `PATIENT_SESSION_MS` | 30 dias | 14 |
| `PATIENT_REFRESH_MS` | 15 min (cadência do paciente, inalterada) | 16 |
| `PRAZOS_DA_EQUIPE` | os quatro prazos da equipe numa estrutura (`inatividadeMs`, `avisoMs`, `cadenciaMs`, `limiteMs`) | 20 |
| `MSG_FIM_DA_SESSAO` | "Sua sessão foi encerrada por falta de uso. Entre de novo." / "Sua sessão chegou ao limite de 8 horas. Entre de novo." | 41 |
| `MSG_AVISO_INATIVIDADE`, `ROTULO_CONTINUAR` | "Sua sessão vai encerrar em 2 minutos por falta de uso." / "Continuar conectada" | 46-47 |
| `SECURITY_PATH` | `/conta/seguranca` | 52 |
| `SUSPENDED_PATH` | `/indisponivel` | 54 |
| `MSG_SESSAO_EXPIRADA` | "Sessão expirada. Entre de novo." | 56 |

- `capSessionExpiry` (linha 98): no nascimento da sessão, tudo que não é `paciente` recebe no máximo agora + 30 min, sem passar de `createdAt` + 8 h. Papel desconhecido conta como equipe ("na dúvida, vale o limite menor").
- `sessionExpiresAt` (87): agora + 30 dias (paciente) ou `min(agora + 30 min, createdAt + 8 h)` (equipe). Com o limite no `expiresAt`, o próprio Better Auth recusa a sessão de mais de 8 h em qualquer rota.
- `isRefreshDue` (105): renova só se `updatedAt` tem 5 min (equipe) ou 15 min (paciente) ou mais. Evita uma escrita por requisição; os 5 min deixam a última atividade registrada no máximo 5 min atrás da real.
- `fimDaSessao` (114): `limite` (mais de 8 h desde `createdAt`) ou `inatividade` (mais de 30 min desde `updatedAt`), ou `null`.
- `estadoDaSessao` (129): o que a tela recebe — quanto falta, em ms relativos, para a inatividade (`min(updatedAt + 30 min, expiresAt)`) e para o limite, mais `avisoMs` e `cadenciaMs`. Relativo porque o relógio do aparelho pode estar errado. Nada de dado pessoal.
- `prazosDeTeste(ms)` (31): só E2E — ver "Prazos de teste" abaixo.

### `evaluateSession` (linha 144)

Ordem das checagens. A primeira que casar decide.

| # | Condição | Decisão |
|---|---|---|
| 1 | sem sessão ou sem usuário | `expired` se veio cookie, senão `login` |
| 2 | papel fora de `allowed` | `forbidden` |
| 3 | equipe e `fimDaSessao` (mais de 8 h desde `createdAt` ou mais de 30 min desde `updatedAt`) | `expired` |
| 4 | `tenantStatus === 'suspensa'` | `suspended` |
| 5 | admin sem 2FA e fora de `/conta/seguranca` | `setup-2fa` |
| 6 | — | `ok` |

A checagem 3 é uma defesa a mais. O `expiresAt` já vale no máximo `min(última atividade + 30 min, createdAt + 8 h)`, e o Better Auth recusa a sessão vencida em qualquer rota. Ela exige que a sessão seja lida com `disableRefresh: true`, e vale também para as sessões abertas antes da regra (P12-14, item 6: a de 12 h acaba na próxima requisição se estiver ociosa há mais de 30 min ou com mais de 8 h). A migration **0103** (`drizzle/0103_sessao_equipe_30min.sql`, como a 0005 fez com as 12 h) corta o `expires_at` dessas sessões para `LEAST(updated_at + 30 min, created_at + 8 h)`, e `/api/auth/*` também as recusa nativamente.

### Como a sessão desliza

`slideSession` (`auth.ts:236`) grava `updatedAt = agora` e o novo `expiresAt` (`sessionExpiresAt` com o `createdAt`: nunca passa das 8 h) direto no banco, com `WHERE expires_at > agora`, e devolve os valores gravados (ou `null`). Sessão vencida nunca volta. Quem chama:

- `requireUserComTenant` → `deslizarUmaVez` (`session.ts:34`), memoizado por `cache` do React (uma escrita por render, mesmo com layout e página).
- `requireApiUser` (`api-auth.ts:23`, `case 'ok'`): atividade de API também conta (T7-R2b; uploads); `data.session` volta com os valores gravados. `lerSessaoApi` (`api-auth.ts:31`) faz a mesma conferência **sem** renovar — só para o `GET /api/sessao/ativa`.

Falha ao renovar só gera `logger.warn` com o nome do erro (nos dois caminhos). A requisição segue, porque já foi autenticada.

**Cookie do paciente.** O banco desliza, mas o cookie tinha `Max-Age` fixo desde o login. `POST /api/p/acesso` (`src/app/api/p/acesso/route.ts:13-23`), chamado uma vez quando o portal abre, reemite o mesmo valor do cookie com `Max-Age` de 30 dias (`cookieDeSessaoRenovado`, `src/lib/sessao-cookies.ts:42`). Plano 06, D9 (fecha o P06-11).

### Fechar o navegador encerra o login da equipe (P12-14)

O cookie de sessão da equipe é **cookie de sessão do navegador** (sem `Max-Age`/`Expires`). O `hooks.before` de `src/lib/auth.ts` (linha 168), no `/sign-in/email`, lê o papel guardado da conta pelo e-mail (`internalAdapter.findUserByEmail`) e, para tudo que não é `paciente` (inclusive e-mail desconhecido), troca o corpo para `rememberMe: false` — o que o navegador mande é ignorado. Com isso o Better Auth 1.7.6 (`node_modules/better-auth/dist/cookies/index.mjs`, `setSessionCookie`) grava o `nd.session_token` sem `maxAge` e o cookie assinado `nd.dont_remember` (também sem `maxAge`). Todo `setSessionCookie` seguinte que não recebe o valor explícito lê o `dont_remember`: o `verify-totp`/`verify-backup-code` do login com 2FA, a ativação do 2FA (que troca a sessão) e a troca de senha com revogação. O `nd.dont_remember` sai no "Sair" (`cookiesDeSessaoApagados`). O `createSession` do Better Auth dá 1 dia a uma sessão "sem lembrar"; o hook de criação corta para 30 min. O paciente segue com `Max-Age` de 30 dias e sem `dont_remember` (teste em `src/lib/auth.test.ts`, "cookie de sessão…"; o do 2FA em `two-factor.test.ts`). Navegador que restaura a sessão anterior ("Continuar de onde parei") pode manter cookies de sessão: os 30 min sem uso no servidor continuam valendo.

### O relógio da tela: aviso e saída automática (P12-14)

`VigiaDeSessao` (`src/components/vigia-sessao.tsx`, client component) fica no layout do painel e no do admin. A lógica pura (passos, leitura das respostas e das mensagens) está em `src/lib/sessao-relogio.ts` (testes em `sessao-relogio.test.ts`). O servidor é a autoridade: o relógio só antecipa o aviso.

- **Rota `/api/sessao/ativa`** (`src/app/api/sessao/ativa/route.ts`, só `admin` e `nutri`; paciente → 403): `GET` devolve `estadoDaSessao` **sem renovar** (perguntar não é uso, `lerSessaoApi`); `POST` (com `mesmaOrigem` antes da sessão) é o uso na tela: `requireApiUser` renova (mesma cadência de 5 min) e devolve o estado. Sessão ociosa, acima de 8 h ou vencida → 401 e nada é renovado.
- **Ao abrir** a tela, o `GET` dá o relógio (prazo da inatividade e do limite, em horas do aparelho).
- **Uso real** (`keydown`, `pointerdown`, `touchstart`, `wheel`, `scroll`, na captura da `window`): `POST` se passou a cadência desde o último (desta aba ou de outra); senão, um `POST` no fim da cadência — o último uso nunca se perde. Com o aviso aberto, só o botão renova.
- **2 min antes** do fim por inatividade, a tela pergunta (`GET`): se o servidor confirma, abre o aviso — `<dialog>` modal nativo com `role="alertdialog"`, foco no botão (`autoFocus`), fundo inerte, `onCancel` com `preventDefault` (Esc não fecha) e `onClose` que reabre se o navegador forçar o fechamento. Texto exato: "Sua sessão vai encerrar em 2 minutos por falta de uso." e o botão "Continuar conectada" (renova pelo `POST`).
- **No fim**, a tela pergunta de novo e, com 401 (ou o prazo confirmado), envia um `<form method="post" action="/sair">` escondido com `motivo` — a mesma saída do botão "Sair" (sessão apagada, cookies, `Clear-Site-Data`). O `/sair` aceita `motivo` só da lista (`inatividade`, `limite`) e vai para `/entrar?motivo=…`; qualquer outro corpo vai para `/entrar`. `/entrar` mostra "Sua sessão foi encerrada por falta de uso. Entre de novo." ou "Sua sessão chegou ao limite de 8 horas. Entre de novo.".
- **Limite de 8 h**: não há aviso (não se renova); na hora, a saída com `motivo=limite`.
- **Abas**: `BroadcastChannel('nd-sessao')`, com o evento `storage` como alternativa. Mensagens só com horários e o motivo (`renovada` com `prazo`, `limite` e `ping`; `encerrar` com o motivo), conferidas por `lerMensagem` — nada de dado pessoal. "Continuar conectada" numa aba fecha o aviso nas outras; a saída numa aba tira todas.
- **Voltar à aba** (`visibilitychange`, também depois de o computador dormir): a tela pergunta de novo.

### Consultas automáticas não são uso (revisão da Tarefa 14)

Telas que consultam o servidor sozinhas, sem ninguém mexer, não podem manter a sessão aberta (senão a nutricionista sai
da mesa com o "Preparando o PDF…" na tela e a sessão só cai nas 8 h). Duas camadas:

- **Cabeçalho** `x-nd-consulta: 1` (`CONSULTA_AUTOMATICA`, `src/lib/consulta-automatica.ts`, sem imports): toda consulta
  com temporizador do painel e do admin manda o `init` pronto; `requireApiUser` (`src/lib/api-auth.ts`) confere a sessão
  igual (401 depois de 30 min sem uso), mas não renova. Mandar o cabeçalho só encurta a própria sessão.
- **Rotas só de estado** não renovam por conta própria (`requireApiNutri(req, { renovar: false })`), para valer também com
  o JavaScript de uma aba aberta antes do deploy: `GET /api/painel/documentos/[id]/pdf?estado=1` (o download sem
  `?estado=1` continua sendo uso), `GET /api/painel/ia/tarefas/[id]`, `GET /api/painel/planos/[id]/pdf` e
  `GET /api/painel/whatsapp/estado`. Teste: `src/app/api/painel/consultas-sem-uso.test.ts` (20 min → 200 sem mexer na
  sessão; 31 min → 401 sem renovar).
- **Consultores e prazos**: "Preparando o PDF…"/"Montando o PDF digitalizado…" (`acompanhar-estado-pdf.ts`, 3 s, até 1 h —
  o prazo da varredura que marca "falhou"; antes consultava para sempre), leitura da IA (`acompanhar-leitura.ts`, até
  60 min), PDF do plano (`atualizar-enquanto.tsx`, 60 s) e QR do WhatsApp (`conectar.tsx`, 3 min).
- **Guarda** `src/lib/consulta-automatica.test.ts`: varre `src/app/painel`, `src/app/admin`, `src/app/conta` e
  `src/components` atrás de `setInterval`/`setTimeout` com `fetch`/`buscar` sem `CONSULTA_AUTOMATICA`. Exceções (uso
  da pessoa, com o porquê em `USO_DA_PESSOA`): o salvamento automático do editor de plano, a espera de digitação da busca de
  alimentos e o próprio `VigiaDeSessao`.
- O `router.refresh()` que essas telas fazem **uma vez**, quando o estado muda, é uma navegação comum e renova a sessão
  (no máximo uma vez por consulta acompanhada).

### Prazos de teste (`SESSAO_TESTE_MS`, só E2E)

`src/lib/sessao-prazos.ts`: `prazosDaRequisicao(headers)` devolve os prazos de produção, salvo com a variável `SESSAO_TESTE_MS` **e** o cookie `nd_sessao_teste=1` no pedido — aí `prazosDeTeste(ms)`: inatividade = `ms`, aviso na metade, cadência 1/6, limite 16×. O E2E sobe o `next start` com `SESSAO_TESTE_MS=30000` (`playwright.config.ts`) e só `e2e/sessao-equipe.spec.ts` grava o cookie: as outras specs seguem com 30 min. `src/env.ts` recusa a variável em produção (`emProducao`: `NODE_ENV=production` fora de localhost — o E2E roda `next start` em localhost, o mesmo critério do `IA_PROVEDOR` sandbox/fake; teste em `src/env.test.ts`). O hook de criação da sessão não conhece o cookie (usa os 30 min); `evaluateSession` e `slideSession` usam os prazos da requisição.

### `requireUser` e `requireUserComTenant` (`src/lib/session.ts`)

`lerSessaoDaRequisicao` (linha 17) lê a sessão com `disableRefresh: true` e, se o usuário tem tenant, a linha de `tenants` por PK. As duas leituras são memoizadas por requisição (T14, S-7). Depois de `evaluateSession`:

| Decisão | Ação |
|---|---|
| `ok` | desliza e devolve `{ data, tenant }` |
| `login` | `redirect('/entrar?volta=…')` |
| `expired` | `auth.api.signOut` e `redirect('/entrar?motivo=inatividade|limite&volta=…')` quando a linha da sessão ainda foi lida (o motivo vem de `fimDaSessao`); `redirect('/entrar?expirada=1&volta=…')` quando o Better Auth já a recusou pelo `expiresAt` |
| `setup-2fa` | `redirect('/conta/seguranca')` |
| `suspended` | `redirect('/indisponivel')` |
| `forbidden` | `redirect(homeFor(papel))`, a página inicial do próprio papel |

O `volta` vem do cabeçalho `x-nd-caminho` (`CURRENT_PATH_HEADER`, `src/lib/safe-return.ts:32`), gravado pelo proxy com caminho + query. O proxy sempre sobrescreve o valor do cliente. Tudo passa por `safeReturnPath` (3.13).

### `requireApiUser` (`src/lib/api-auth.ts:23`)

Mesma regra para Route Handlers, sem redirecionar:

| Decisão | Resposta |
|---|---|
| `login`, `expired` | 401 `{ erro: "Sessão expirada. Entre de novo." }` |
| `suspended` | 403 "Conta temporariamente indisponível" |
| `setup-2fa`, `forbidden` | 403 "Acesso negado" |

Toda recusa sai com `cache-control: no-store` (`recusaApi`, linha 13). É assim que o admin recebe 403 em `/api/painel/*` e `/api/p/*` (US-004, cenário "Admin não vê prontuário").

---

## 3.7 Guardas por papel

### `requireNutri` / `requireApiNutri` (`src/lib/tenant-session.ts:22`, `:37`)

Toda página e Server Action da nutricionista começa por `requireNutri(path)`:

1. `requireUserComTenant(['nutri'], path)`.
2. Sem `tenantId` ou sem linha do tenant → erro (estado impossível).
3. `tenant.dpaVersao !== DPA_VERSAO` → `redirect('/painel/dpa')`, salvo com `permitirDpaPendente` (só o layout e a própria tela do DPA usam).
4. Devolve `ctx = { tenantId, role: 'nutri', actorUserId, ip }`, pronto para `withTenant`.

`requireApiNutri` faz o mesmo para Route Handlers: 403 "Acesso negado" sem tenant e 403 "Aceite o contrato de tratamento de dados para continuar." com o DPA pendente. O IP vem de `clientIp(req.headers, TRUSTED_PROXIES)`.

### Admin

Não há `requireAdmin`. Cada página e Server Action do admin chama `requireUser(['admin'], …)` (ex.: `src/app/admin/actions.ts`, `criarContaAction`, `suspenderAction`, `reativarAction`). O admin nunca recebe `TenantContext`.

### `requirePaciente` / `requireApiPaciente` (`src/lib/paciente-session.ts`, funções `requirePaciente` e `requireApiPaciente`)

Ver 3.8.

### Resumo

| Guarda | Usado em | Papéis | Além da sessão | Falha |
|---|---|---|---|---|
| `requireUser` | páginas e Server Actions | lista passada | — | redirect |
| `requireApiUser` | Route Handlers | lista passada | — | 401/403 |
| `requireNutri` | painel | `nutri` | DPA atual; `ctx` | redirect |
| `requireApiNutri` | `/api/painel/*` | `nutri` | DPA atual; `ctx` | 403 |
| `requirePaciente` | portal `/p/*` | `paciente` | vínculo, consultório ativo, termo atual; `ctx` | redirect |
| `requireApiPaciente` | `/api/p/*` | `paciente` | idem | 403 |

---

## 3.8 Sessão do paciente: vínculos, `nd_vinculo` e contexto `conta`

### O problema

A conta de paciente não tem tenant. Para abrir o portal é preciso saber **qual** prontuário (consultório) ela está usando. E é preciso achar os prontuários da conta sem saber o tenant, com a RLS forçada.

### Contexto `conta` (Plano 06, D2)

`withConta(userId, fn)` (`src/db/tenant.ts:114`) abre a transação com `app.role = 'conta'`, `app.user_id = userId` e `app.tenant_id` vazio. No banco, a política `paciente_por_conta` (`drizzle/0073_conta_vinculos.sql`, linha 6) libera **só `SELECT`** em `patients` onde `user_id` é a própria conta. Toda outra tabela devolve 0 linhas, porque nenhuma `tenant_isolation` casa sem tenant. Nada é gravado.

Uso restrito (CLAUDE.md, regra 1): `src/modules/portal/vinculos.ts` e a função `app_conta_sem_outro_vinculo` (`drizzle/0079_paciente_titular.sql`), usada na anonimização.

Alternativa descartada no D2: uma função `SECURITY DEFINER` que varresse todos os tenants (N consultas por requisição).

### `vinculosDaConta`, `vinculosComConsultorio` e `escolherVinculo` (`src/modules/portal/vinculos.ts`)

`vinculosDaConta(userId)` junta `patients` (contexto `conta`) e `tenants` (sem RLS) e devolve `{ tenantId, patientId, nomeNutri, tenantStatus }`. Sem `todos: true`, ficam de fora prontuários arquivados, bloqueados e anonimizados (RN-08). Continua sendo a leitura da escolha (`/p/escolher`, `escolherAction`), por `GET /api/p/vinculo` e pela inscrição de push (`src/modules/portal/push-inscricao.ts`).

`vinculosComConsultorio(userId)` (P08-13, S-7) é a leitura de `requirePaciente`/`requireApiPaciente`: os mesmos vínculos, com o mesmo filtro (RN-08) e a mesma ordem (`nomeExibicao`, depois `id`), e a **linha inteira** de `tenants` no mesmo join, em `{ vinculo, tenant }`. Assim a guarda não relê `tenants` (antes, `buscarTenant` depois da escolha): uma ida ao banco a menos por requisição do portal. A linha só serve para o consultório escolhido: `acessoDaConta` devolve a lista de vínculos já como `Vinculo`, sem os dados dos outros consultórios. O teste em `src/modules/portal/vinculos.test.ts` confere que os vínculos são iguais aos de `vinculosDaConta` e que a linha é a de `tenants`.

`escolherVinculo(vinculos, cookie, pedido)`:

| Situação | Resultado |
|---|---|
| nenhum vínculo | `sem_acesso` |
| nenhum consultório ativo | `suspensa` |
| exatamente 1 vínculo | `ok` com ele |
| 2+ vínculos | o `pedido` (`?v=` do link), se for ativo da conta; senão o do cookie, se for ativo; senão `escolher` |

### O cookie `nd_vinculo` (Plano 06, D3)

Definido em `src/lib/paciente-session.ts` (`COOKIE_VINCULO`, `OPCOES_COOKIE_VINCULO`, `cookieDoVinculo`, `cookieDoVinculoApagado`, no começo do arquivo):

| Atributo | Valor |
|---|---|
| Nome | `nd_vinculo` |
| Conteúdo | só o `tenantId` |
| `Path` | `/` |
| `Max-Age` | 30 dias |
| `HttpOnly`, `SameSite=Lax` | sim |
| `Secure` | só quando `APP_URL` começa com `https://` (`cookieVinculoSeguro`) |

O cookie é só uma **preferência**. A cada requisição ele é reconferido contra os vínculos ativos da conta (`vinculosComConsultorio`, em `acessoDaConta`). Cookie velho ou forjado com um tenant que não é vínculo ativo da conta não dá acesso a nada. Quem grava:

| Onde | Quando |
|---|---|
| `escolherAction` (`src/app/p/escolher/actions.ts`) | escolha em `/p/escolher`; confere vínculo ativo e consultório não suspenso |
| `GET /api/p/vinculo` (`src/app/api/p/vinculo/route.ts:15`) | link com `?v=` (e-mail, push) de outro consultório; confere de novo |
| `POST /api/p/acesso` | abertura do portal com 2+ vínculos (o cookie desliza junto) |
| `POST /sair` | apaga (`cookieDoVinculoApagado`) |

O `GET` que grava cookie em `/api/p/vinculo` é aceito de propósito (spec RNF-06, v1.11, S-12): links de e-mail chegam como navegação de outro site, e o efeito é só trocar entre vínculos ativos da própria conta.

### `requirePaciente`

```mermaid
flowchart TD
  A[requirePaciente path] --> B[requireUserComTenant paciente]
  B --> C[vinculosComConsultorio via withConta<br/>vínculos + linha de tenants no join]
  C --> D{escolherVinculo<br/>cookie nd_vinculo + ?v=}
  D -->|sem_acesso| X1[/p/sem-acesso/]
  D -->|suspensa| X2[/indisponivel/]
  D -->|escolher| X3[/p/escolher?volta=.../]
  D -->|ok| E{?v= válido e diferente<br/>do cookie, 2+ vínculos?}
  E -->|sim| X4[/api/p/vinculo grava cookie e volta/]
  E -->|não| F{linha do consultório<br/>escolhido existe e está ativa?}
  F -->|não existe| X1
  F -->|suspenso| X2
  F -->|ativo| G{termo atual aceito<br/>neste consultório?}
  G -->|não| X5[/p/termo?volta=.../]
  G -->|sim| OK[ctx: tenantId, role paciente,<br/>patientId, actorUserId, ip]
```

A lógica comum fica em `acessoDaConta`, usada pela página e pela API, na ordem: vínculo (D3, RN-08) → consultório não suspenso (RN-15) → termo aceito (US-011, D25). A própria tela do termo passa `permitirTermoPendente`. Desde o P08-13 o consultório sai da linha de `tenants` que veio no join de `vinculosComConsultorio` (a do vínculo escolhido), não de um `buscarTenant` à parte; a checagem "não existe → `/p/sem-acesso`" ficou como defesa, porque a linha vem junto com o vínculo e `escolherVinculo` já barra o suspenso.

**Uma vez por requisição nas páginas (P08-13, S-7).** O layout do portal e a página chamam `requirePaciente` com `path` diferentes na mesma requisição. Para não repetir a leitura, `requirePaciente` chama `acessoDaRequisicao`, um `cache()` do React em volta de `acessoDaConta`:

| Ponto | Como ficou |
|---|---|
| Chave do cache | só a conta (`userId`) e `exigirTermo` (primitivos). Com o termo pendente, o portal vai ao termo e a própria tela do termo (`permitirTermoPendente`) entra com outra chave |
| Cookie, `?v=` e IP | lidos **dentro** da função (`headers()`, `cookies()`, `requestIp()`): são da própria requisição, não entram na chave |
| O que é guardado | só dados (`atual`, o resultado de `acessoDaConta` e o IP). O `redirect` fica com cada chamador, porque o `path` dele entra no `volta` |
| Escopo | o `cache` do React vale só dentro de um render (uma requisição). Numa Server Action não guarda nada: cada chamada relê, como antes. Nada passa de uma requisição para a outra (o aceite do termo e a suspensão valem na seguinte) |
| API | `requireApiPaciente` **não** usa o cache: chama `acessoDaConta` direto, com o cookie e o `?v=` do próprio `Request` |

Os casos estão em `src/lib/paciente-session.cache.test.ts`. No Vitest o `cache` do React só repassa a chamada, então o teste troca o `react` por um `cache` com o escopo de uma requisição simulada.

`requireApiPaciente` aplica a mesma regra sem regravar o cookie e responde 403. Com vínculo a escolher, o JSON leva `motivo: 'escolher'`, para a tela oferecer o link da escolha (S-4). Os textos: "Acesso negado", "Conta temporariamente indisponível", "Para continuar, aceite o Termo de Uso e Privacidade." (`RECUSA_API`, em `paciente-session.ts`).

`ctx.patientId` liga a RLS por paciente. `withTenant` exige `patientId` e `actorUserId` para `role: 'paciente'` (`src/db/tenant.ts`, `assertContext`), salvo os fluxos sem login listados em `SEM_CONTA_PERMITIDOS`.

**O contexto de paciente aberto pela nutricionista (Plano 18, D16, RN-281).** O "No app do paciente" do painel conta o que
o app mostra **com a RLS do paciente**, em vez de reproduzir os filtros do portal na sessão `nutri` (a audiência do
conteúdo e a etiqueta, `paciente_so_emitidos`, `paciente_sem_rascunho`). Por isso `src/modules/ficha/no-app.ts` é o
sétimo arquivo de `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts:39-47`). As travas:

- `noAppDoPaciente` (`no-app.ts:84`) só aceita `ctx.role === 'nutri'` (`:90`) e, antes de abrir o contexto do paciente,
  confere na sessão `nutri` que o paciente é do consultório; arquivado, bloqueado ou anonimizado não abre o contexto
  (só a linha do acesso, `semAcesso`, `:58`), nem paciente sem conta (`comAcesso`, `:173`).
- O helper `comoPaciente` (`:41`) **não é exportado**: abre `{ tenantId, role: 'paciente', patientId, semConta: true }`,
  confere no banco (`current_setting('app.role')` e `app.patient_id`) que a transação está mesmo no papel e no paciente
  pedidos e só então marca a transação como `TxDePaciente` (`src/modules/ficha/tipos.ts:22`, tipo marcado; o único lugar
  que o cria). Os `noApp.contar`/`noApp.visiveis` das seções só recebem esse tipo.
- Dentro dele, só `count(*)` e ids: nenhuma coluna de conteúdo, nenhum `auditRead`, nunca `liberarReceitasDoPlano` (as
  receitas sugeridas do plano são contadas na sessão `nutri`, D24). A guarda de fonte `no-app-fonte.test.ts` confere.
- `patient_cadastro` continua negada nesse contexto (política `patient_cadastro_paciente_com_conta`): 0 linhas, mesmo
  sendo a nutricionista quem pediu.
- O `audit_log` desse contexto sairia sem ator (como todo `semConta`), mas nada é gravado: é só leitura.

---

## 3.9 Bootstrap do admin (`pnpm admin:criar`)

Script: `scripts/admin-criar.ts`, ligado em `package.json` (`"admin:criar": "tsx --env-file-if-exists=.env.local scripts/admin-criar.ts"`). Lógica: `createAdmin` em `src/modules/plataforma/admin-bootstrap.ts:15`.

1. Normaliza o e-mail (`normalizeEmail`) e valida com zod. Plano 01, Review Focus 4: `" Admin@Exemplo.com "` vira `admin@exemplo.com`.
2. Recusa e-mail já usado. A corrida é decidida pela constraint `user_email_unique`.
3. Insere `user` com `appRole: 'admin'`, `emailVerified: true`, **sem senha**.
4. Troca o destino dos links por um que só captura a URL (`setPasswordLinkSink`, `src/lib/password-links.ts:44`) e chama `auth.api.requestPasswordReset` com `redirectTo: '/definir-senha'`. Chamada interna sem `ctx.request` não passa pelo Turnstile (`auth.ts:158-160`).
5. Sem link ou com erro, apaga o usuário criado.
6. O script imprime o link no terminal (válido por `RESET_TOKEN_TTL_S`, 1 h, uso único) e avisa que o 2FA será obrigatório no primeiro acesso.

Não existe tela pública para criar admin (`disableSignUp: true`). Rodar o comando no container do app em produção é operação do dono: o link é uma credencial e não deve ir para log nem para chat.

---

## 3.10 Convites

Tabela `invites` (`src/db/schema/access.ts`). Guarda só o SHA-256 do token (`token_hash`, único). O token é `randomToken()`: 32 bytes em base64url, 43 caracteres (`src/lib/crypto.ts:9-11`), e todo token recebido é validado contra `/^[A-Za-z0-9_-]{43}$/` antes de consultar o banco. A restrição `invites_alvo` separa os dois tipos. Índices únicos parciais deixam no máximo um convite pendente por usuário (`invites_user_pendente_idx`) e por paciente (`invites_paciente_pendente_idx`). A tabela fica fora da RLS (`RLS_EXCEPTIONS`, `src/db/rls-guard.ts`), porque é lida antes de existir sessão. Só três módulos a acessam (CLAUDE.md, regra 1).

| | Nutricionista | Paciente |
|---|---|---|
| História | US-001 / US-002 | US-010 / US-011 |
| Validade | 72 h (`CONVITE_NUTRI_VALIDADE_MS`, `convites.ts:11`) | 7 dias (`CONVITE_PACIENTE_VALIDADE_MS`, `convite-paciente.ts:18`) |
| Aponta para | `user_id` (a conta já existe, sem senha) | `tenant_id` + `patient_id` (a conta nasce no aceite) |
| Quem cria | admin: `criarContaNutri` / `reenviarConvite` (`src/modules/plataforma/contas.ts:59`, `:89`) | nutricionista: `enviarConvitePaciente` / `reenviarConvitePaciente` (`convite-paciente.ts:52`, `:102`) |
| Link | `/convite/<token>` (montado por `urlDoApp(appUrl, …)`, `src/lib/url-do-app.ts`, `convites.ts:32`) | `/convite/paciente/<token>` |
| Canal | e-mail pela fila, na mesma transação | e-mail na mesma transação. O WhatsApp é só um aviso **sem link** (decisão do dono, US-010, nota do Plano 05) |
| Aceite grava | senha (`account`), `emailVerified`, DPA | `user` de paciente, senha, termo, `patients.user_id`, escolha do WhatsApp |
| Mensagens | "Convite expirado. Peça um novo ao suporte." / "Convite inválido ou já usado. Se você já definiu sua senha, entre com seu e-mail e senha." | `MSG_CONVITE_PACIENTE` (`convite-paciente.ts:20-28`) |

### Convite da nutricionista

`criarContaNutri` cria, numa transação, o tenant, a usuária `nutri` sem senha, o convite e o e-mail (`contas.ts:59-87`). `reenviarConvite` trava a usuária (`FOR UPDATE`, T5-R3), recusa tenant suspenso ("Conta suspensa: reative antes de reenviar o convite.", PF-N6, RN-15) e recusa quem já tem senha. `criarConvite` apaga os pendentes antes de inserir (`convites.ts:23-29`).

`aceitarConvite` (`convites.ts:66`):

1. Valida DPA marcado, política de senha, confirmação e formato do token.
2. `inspecionarConvite` sem trava; só então o argon2 (T6-R2a).
3. Na transação: trava a usuária (`FOR UPDATE`) **antes** do convite, a mesma ordem de `reenviarConvite`. A ordem invertida causava deadlock 40P01 (T6-R1).
4. Recusa se já existe `account` `credential`.
5. Consome o convite com `UPDATE … WHERE usado_em IS NULL AND expira_em > agora`. O segundo envio simultâneo vê 0 linhas.
6. Grava a senha, `emailVerified = true` e o aceite do DPA (`registrarAceiteDpa`).

A Server Action (`src/app/convite/[token]/actions.ts`) faz login automático com `signInEmail`. Se o tenant foi suspenso entre o aceite e o login, vai para `/indisponivel` (T7-R2a). Outra falha cai em `/entrar?volta=/painel`.

### Convite do paciente

`inspecionarConvitePaciente` (`convite-paciente.ts:168`) lê o convite pelo token e o prontuário no contexto do próprio paciente, com `semConta: true` (paciente sem sessão; lista fechada em `SEM_CONTA_PERMITIDOS`, `src/db/tenant.ts`). Classifica a conta com aquele e-mail: `nenhuma`, `paciente` ou `equipe`.

A página `src/app/convite/paciente/[token]/page.tsx` decide:

| Caso | Tela |
|---|---|
| expirado / inválido | aviso |
| consultório suspenso | `redirect('/indisponivel')` |
| e-mail de conta da equipe | "Este e-mail já é usado por outra conta. Peça à sua nutricionista para cadastrar outro e-mail." |
| conta de paciente, sem sessão | "Entre com sua conta existente para ver os dados da nutricionista {nome}." + `/entrar?volta=…` |
| conta de paciente, sessão de outro e-mail | "Este convite foi enviado para outro e-mail. Saia desta conta e abra o link de novo." |
| conta de paciente, sessão certa | só termo + WhatsApp → `vincularContaExistente` |
| sem conta | senha + termo + WhatsApp → `aceitarConvitePaciente` |

`aceitarConvitePaciente` (linha 213) roda num `withTenant` com o ator igual ao novo `userId` (a escrita em `patients` sai auditada com ele). Ordem de trava: paciente → convite (T6-R1). Cria `user` (`appRole: 'paciente'`, sem tenant), `account`, o aceite do termo e `patients.user_id`. Um `user_email_unique` em corrida vira "convite inválido".

`vincularContaExistente` (linha 260) exige que o e-mail da conta logada seja o do convite: outro login não "adota" o prontuário. Dentro da transação relê a conta com `FOR SHARE`, para não ligar o prontuário a uma conta que outro consultório acabou de anonimizar (B-2, D18 do Plano 06).

Arquivar ou bloquear o paciente apaga o convite pendente (`apagarConvitesPendentes`, linha 77; RN-08, US-018).

```mermaid
sequenceDiagram
  autonumber
  participant A as Admin
  participant App as nutri_app
  participant DB as Postgres
  participant W as nutri_worker
  participant N as Nutricionista
  A->>App: criarContaAction (requireUser admin)
  App->>DB: tx: tenants + user nutri sem senha + invites(72 h, hash) + job e-mail
  W->>N: e-mail com /convite/<token>
  N->>App: abre o link (inspecionarConvite)
  N->>App: senha + aceite do DPA (aceitarConviteAction)
  App->>App: checa token sem trava, depois argon2id
  App->>DB: tx: FOR UPDATE user → confere se já há account credential (convites.ts:93-97; se houver, convite inválido) → UPDATE invites usado_em (:99-103) → grava account → emailVerified → consents(dpa) → tenants.dpa_versao
  App->>App: signInEmail (hooks: tenant ativo? equipe sem "lembrar"; expira em 30 min)
  App-->>N: redirect /painel
```

```mermaid
sequenceDiagram
  autonumber
  participant Nu as Nutricionista
  participant App as nutri_app
  participant DB as Postgres
  participant P as Paciente
  Nu->>App: cadastra paciente (withTenant nutri)
  App->>DB: tx: patients + invites(7 dias, hash) + e-mail
  P->>App: abre /convite/paciente/<token>
  App->>DB: inspecionarConvitePaciente (semConta)
  alt sem conta
    P->>App: senha + termo + WhatsApp
    App->>DB: withTenant(paciente, ator=novo user): FOR UPDATE patients → consome convite → user + account → consents(termo) → patients.user_id
    App->>App: signInEmail
    App-->>P: /p/inicio
  else já é paciente de outro consultório
    P->>App: entra com a conta existente
    P->>App: termo + WhatsApp (vincularContaAction)
    App->>DB: withTenant: FOR UPDATE patients → consome convite → FOR SHARE user → consents → patients.user_id
    App-->>P: /p/inicio
  end
```

---

## 3.11 Redefinição de senha

| Etapa | Onde |
|---|---|
| Formulário "Esqueci minha senha" com Turnstile | `src/app/esqueci-senha/form.tsx` → `authClient.requestPasswordReset` com o cabeçalho `x-turnstile-token` |
| Turnstile no servidor | `hooks.before` de `/request-password-reset` (`auth.ts:159-165`): 503 `TURNSTILE_INDISPONIVEL` ou 403 `TURNSTILE_INVALIDO`, **antes** de qualquer escrita (INT-06) |
| Mesma resposta para qualquer e-mail | o formulário mostra sempre "Se o e-mail estiver cadastrado, você receberá um link" (`form.tsx:49`) |
| Entrega fora do caminho da resposta | `emailPasswordLinkSink` dispara `enfileirarLinkDeSenha` sem `await` (`password-links.ts:37-39`). Nem a latência nem uma falha da fila revelam se o e-mail existe (F3) |
| Tenant suspenso não recebe | `enfileirarLinkDeSenha` (linha 20) descarta se o tenant não está ativo (RN-15, F2) |
| Link cifrado na fila | o job leva a mensagem selada (Plano 02, "Fila de e-mail") |
| Token guardado com hash | `verification.storeIdentifier: 'hashed'` |
| Validade | 1 h, uso único (`RESET_TOKEN_TTL_S`) |
| Definir a nova senha | `/definir-senha?token=…` → `authClient.resetPassword` (`src/app/definir-senha/page.tsx:20`); política no `hooks.before` |
| Efeito colateral | `revokeSessionsOnPasswordReset: true` |

A mesma tela `/definir-senha` serve ao primeiro acesso do admin (3.9). O admin não tem tenant: o link sempre sai.

---

## 3.12 Aceites: DPA e termo do paciente (`consents`)

Tabela `consents` (`src/db/schema/access.ts`). É prova de aceite: sem `ON DELETE CASCADE`, só `INSERT`. Unicidade `consents_titular_termo_unique` em `(user_id, termo_versao, tenant_id, patient_id)` com `NULLS NOT DISTINCT`: repetir o aceite não duplica. Fora da RLS (`RLS_EXCEPTIONS`), com lista fechada de módulos (CLAUDE.md, regra 1). A anonimização só mexe nela por `app_anonimizar_aceites` (migration 0065).

| | DPA (nutricionista) | Termo do paciente |
|---|---|---|
| Constante de versão | `DPA_VERSAO = '1.0'` (`src/modules/plataforma/dpa.ts:13`), desde 15/10/2026 | `TERMO_PACIENTE_VERSAO = '1.0'` (`src/modules/pacientes/termo-paciente.ts:7`), desde 15/10/2026 |
| Valor gravado em `termo_versao` | `dpa-1.0` (`DPA_TERMO`); antes, `dpa-0.1-provisorio` | `termo-paciente-1.0` (`TERMO_PACIENTE`); antes, `termo-paciente-0.1-provisorio` |
| Textos por versão | `DPA_TEXTOS` (a 0.1 e a 1.0, com a data); `DPA_PARAGRAFOS` é o da versão em vigor | `TERMO_PACIENTE_TEXTOS` (idem); `TERMO_PACIENTE_PARAGRAFOS`. Ficam em `termo-paciente-textos.ts`, que só páginas importam: os formulários de cliente importam o rótulo de `termo-paciente.ts`, e o mapa não vai para o bundle (guarda em `textos-legais.test.ts`) |
| Rótulo do aceite | `DPA_ROTULO`, "… (DPA), versão 1.0", passado pela página ao formulário (o módulo importa o banco) | `TERMO_PACIENTE_ROTULO`, "… (versão 1.0)" |
| Versão lida | O formulário manda a versão mostrada (campo `versao`, passado pela página); `aceitarDpaAction` e `aceitarConviteAction` recusam com `MSG_TEXTO_ATUALIZADO` se não for `DPA_VERSAO` (deploy com a página aberta) | Idem em `aceitarTermoAction`, `aceitarConvitePacienteAction` e `vincularContaAction`, contra `TERMO_PACIENTE_VERSAO`; na página pública, `solicitarCodigo` recusa com 422 no campo do termo se o corpo não trouxer `termoVersao` igual à versão em vigor (o pedido grava a versão e o aceite sai dela) |
| `tenant_id` em `consents` | nulo | o consultório do vínculo |
| Marca extra | `tenants.dpa_aceito_em` e `tenants.dpa_versao` | — |
| Onde é exigido | `requireNutri` compara `tenant.dpaVersao` com `DPA_VERSAO` | `requirePaciente` chama `termoAceito(userId, tenantId)` (`src/modules/portal/termo.ts:10`) |
| Tela | `/painel/dpa` (`aceitarDpaAction`, `src/app/painel/actions.ts:12`); com uma versão anterior aceita (`tenant.dpaVersao` preenchido e diferente de `DPA_VERSAO`), mostra acima do texto o aviso `DPA_MUDOU` (`role="status"`): "O contrato de tratamento de dados mudou (versão 1.0, de 15/10/2026). Leia e aceite para continuar usando o painel." (texto livre: a spec não tem um para este caso) | `/p/termo` (`aceitarTermoAction`, `src/app/p/termo/actions.ts`) |
| Primeiro aceite | no convite (`aceitarConvite`) | no convite (`registrarAceiteTermo`, `convite-paciente.ts:231`) |
| IP | gravado (`clientIp`) | gravado |

`registrarAceiteDpa` (`dpa.ts:74`) só atualiza `tenants` quando a linha de `consents` foi de fato inserida. Assim a marca no tenant nunca diverge da prova (T6-R2b).

O termo do paciente é aceito **por consultório**: cada nutricionista é controladora dos dados (RNF-08). Plano 06, D25.

**Aditivo de IA (Plano 11, A-D20).** Terceiro tipo de aceite em `consents`: `ia-aditivo-<versão>` (`IA_ADITIVO_TERMO`,
`src/modules/ia/textos-legais.ts`), da nutricionista, **com** o `tenant_id` do consultório (o DPA usa `tenant_id` nulo),
gravado por `registrarAceiteAditivoIa` (`dpa.ts:95`) quando ela marca "Li e aceito o aditivo de inteligência artificial
(versão {versão})" e clica em "Ativar a IA no consultório" (Configurações). Marca extra: `tenants.ia_ativada_em` e
`tenants.ia_aditivo_versao`. `ia_ativada_em` é a data da ativação **em vigor**: o `coalesce` de `registrarAceiteAditivoIa`
só a preserva enquanto a IA continua ativa (aceite de versão nova do aditivo, clique repetido; `dpa.ts:102-105`);
`desativarIa` a zera (`src/modules/ia/ativacao.ts:48`) e a reativação grava a data nova. A data do primeiro aceite de cada
versão fica em `consents.aceito_em` (`onConflictDoNothing`). Diferente do DPA, versão nova do aditivo **não**
redireciona o painel: a seção de IA em Configurações mostra "Para continuar usando a IA, aceite a versão atual do aditivo
de inteligência artificial." com o aditivo e o botão "Aceitar a versão atual" (`ia-secao.tsx:39-45`), e cada exame com
laudo mostra o mesmo aviso no lugar de "Ler valores com IA" (`iaNoExame`, `exames/ia-exame.tsx:24`)
(`IA_ADITIVO_VERSAO_MIN`). Detalhe no [cap. 10](10-ia.md).

**Como publicar uma versão nova** (P08-06; a 1.0 saiu assim em 15/10/2026, sem o advogado, na linha da A-D27): acrescentar a versão em `DPA_TEXTOS` ou `TERMO_PACIENTE_TEXTOS`, com a data, sem apagar as anteriores (mostram o que cada um leu), e trocar `DPA_VERSAO`/`DPA_VERSAO_DATA` ou `TERMO_PACIENTE_VERSAO`/`TERMO_PACIENTE_VERSAO_DATA`. Na próxima requisição, toda nutricionista vai para `/painel/dpa` (API do painel: 403) e todo paciente para `/p/termo`, uma vez por consultório (API do portal: 403). As linhas antigas de `consents` ficam como prova. Não precisa de migration. A guarda `src/modules/plataforma/textos-legais.test.ts` confere a versão, o rodapé e os suboperadores citados, e que as telas de aceite (`/n/[slug]`, `/convite/paciente/[token]`, `/convite/[token]` e `/painel/dpa`) mostram o texto inteiro na página, sem caixa de altura fixa com rolagem própria (como `/p/termo`). A 1.0 diz que o servidor (Hostinger) fica no Brasil (Campinas/SP, conferido em 15/10/2026) e que a cópia de segurança (Backblaze B2, sem região no Brasil) fica fora, criptografada antes de sair. O canal de privacidade da operadora é `EMAIL_PRIVACIDADE` (`src/modules/plataforma/privacidade.ts`; o e-mail do dono, decisão de 16/10/2026 — trocá-lo pede versão nova dos dois textos), citado no termo (parágrafo da operadora) e no DPA (cláusulas 5 e 15). Em `/p/termo`, quem já aceitou outra versão do termo naquele consultório (`aceitouVersaoAnterior`, `src/modules/portal/termo.ts`) vê `TERMO_PACIENTE_MUDOU`, como o `DPA_MUDOU` de `/painel/dpa`.

---

## 3.13 Proxy e redirecionamento seguro

`src/proxy.ts`:

- `PROTECTED = ['/admin', '/painel', '/p', '/conta', '/inicio']` (linha 7). Casa o prefixo exato ou `prefixo/…` (linha 22).
- Sem cookie de sessão (`getSessionCookie(req, { cookiePrefix: 'nd' })`, linha 23) → `/entrar?volta=<caminho atual>`. Só olha a **presença** do cookie, não a validade. Cookie vencido passa e cai no `requireUser` (`expired`).
- Também gera o `x-request-id`, o nonce e a CSP de cada página, e grava `x-nd-caminho`. Esses cabeçalhos estão em [§6.3.2 CSP com nonce](06-worker-seguranca-operacao.md#632-csp-com-nonce-d7-do-plano-08) e [§6.4.2 `request_id`](06-worker-seguranca-operacao.md#642-request_id-d2-do-plano-08).
- `matcher` (linha 55): tudo menos `api/`, `serwist/`, `_next/static`, `_next/image`, `favicon.ico` e `manifest.webmanifest`. O `api/` fica fora porque o Next copiaria para a memória o corpo de toda requisição que passa pelo proxy, com corte silencioso em 10 MB, e o exame tem até 20 MB (comentário das linhas 51-53). **Consequência: toda rota `/api/*` precisa da própria guarda.**

`safeReturnPath` (`src/lib/safe-return.ts:13`) aceita só caminho local e confere de novo **depois** da normalização WHATWG, que pode transformar `/.//evil.com` em `//evil.com`. Plano 01, Review Focus 3; E2E em `e2e/auth.spec.ts` ("?volta externo não redireciona para fora" e "?volta que a normalização vira //host…"). Sem `volta` válido, o login vai para `/inicio`, que redireciona pelo papel (`src/app/inicio/page.tsx`).

No portal, `voltaDoPortal` (`src/lib/paciente-session.ts`) restringe ainda mais: só `/p/…`, nunca a própria escolha e sem o `?v=`.

---

## 3.14 Suspensão de conta (RN-15, US-004)

Decisão do Plano 02 ("Decisões de desenho", linha "Suspensão"): status no tenant, sessões revogadas na mesma transação, bloqueio no login e checagem em cada requisição.

`suspenderConta(tenantId, adminId)` (`src/modules/plataforma/suspensao.ts:19`), numa transação:

1. `tenants.status = 'suspensa'`. Tenant inexistente → `ContaNaoEncontradaError` ("Conta não encontrada.").
2. Enfileira `agenda-tenant` com `evento: 'suspenso'` na mesma transação (`avisarAgenda`). O worker marca os lembretes pendentes como "ignorada" (o admin nunca toca tabela 🔒).
3. Apaga todas as linhas de `session` das usuárias com `user.tenant_id` = tenant.
4. Log com `tenantId`, `adminId` e a contagem. Nada é apagado do prontuário.

`reativarConta` (linha 33) volta o status para `ativa` e enfileira `evento: 'reativado'` (lembretes reagendados pela RN-05; o que o worker faz com os lembretes está em [§5.3.8](05-agenda-portal-conteudo.md#538-suspensão-e-reativação-do-tenant-us-004-rn-15)).

Onde a suspensão barra:

| Camada | Mecanismo |
|---|---|
| Login, 2FA, primeiro acesso | `session.create.before` lança `CONTA_SUSPENSA` (`auth.ts:103-105`). A tela de login leva para `/indisponivel` (`src/app/entrar/page.tsx:30`) |
| Corrida login × suspensão | `session.create.after` relê o status com `FOR SHARE` em `tenants` (`statusDoTenantDaUsuaria`, `auth.ts:182-190`). Suspensa → apaga a sessão recém-criada e recusa (M8, G7) |
| Sessão já aberta (equipe) | `evaluateSession` → `suspended` → `/indisponivel` ou 403 |
| Paciente | por vínculo, em `acessoDaConta`. O consultório suspenso barra só aquele vínculo. Sem nenhum ativo → `/indisponivel`; com outro ativo → `/p/escolher` (o suspenso aparece desabilitado) |
| Convites | `reenviarConvite` recusa; o convite de paciente manda para `/indisponivel` |
| E-mails e jobs | `tenantIsActive` (`tenant-status.ts:49`) e `enfileirarLinkDeSenha` |

As sessões de paciente **não** são apagadas pela suspensão: a conta de paciente não tem `tenant_id` e pode ter vínculos em outros consultórios.

---

## 3.15 Sair

`POST /sair` (`src/app/sair/route.ts:44`). É Route Handler, não Server Action: com o cookie já apagado por outra aba, o proxy responderia 307 e a tela mostraria "Application error" (spec v1.7).

1. CSRF: aceita só `Origin` igual à origem do `APP_URL` ou, sem `Origin`, `Sec-Fetch-Site: same-origin`. Senão 403 sem efeito.
2. Lê a sessão e apaga a linha de `session` **sem engolir o erro**. O `signOut` do Better Auth engole falha de banco e ainda apagaria o cookie, deixando a sessão viva no servidor.
3. Responde 303 para `/entrar` com os `Set-Cookie` que apagam os cookies do Better Auth (`cookiesDeSessaoApagados`, `src/lib/sessao-cookies.ts:27`), com o mesmo nome e atributos do login (`__Secure-` em produção), mais o `nd_vinculo` apagado e `Clear-Site-Data: "cache", "storage"` (Plano 06, D6).
4. Falhou ao apagar → mantém o cookie e manda para `/sair/erro`, logando só o motivo sanitizado.

Outros pontos que encerram sessões: redefinição de senha (todas as sessões), suspensão (sessões da equipe do tenant) e anonimização do titular sem outro vínculo (`src/modules/pacientes/conta-titular.ts`, apaga `session` e `account`; Plano 06, D18).

---

## 3.16 Fluxo de login completo

```mermaid
sequenceDiagram
  autonumber
  participant U as Usuário
  participant E as /entrar (cliente)
  participant BA as /api/auth (Better Auth)
  participant DB as Postgres
  participant G as requireUser
  U->>E: e-mail + senha
  E->>BA: POST /sign-in/email
  BA->>BA: rate limit (5 / 15 min por IP + rota)
  BA->>DB: confere hash argon2id
  BA->>DB: cria session (hook before: tenant suspenso? → CONTA_SUSPENSA; expiresAt ≤ agora + 30 min para equipe; cookie sem Max-Age)
  BA->>DB: hook after: FOR SHARE em tenants (corrida com suspensão)
  alt 2FA ativo
    BA->>DB: apaga a sessão; grava desafio de 10 min
    BA-->>E: twoFactorRedirect + cookie two_factor
    E->>U: /entrar/2fa?volta=...
    U->>BA: POST /two-factor/verify-totp (ou código de recuperação)
    BA->>DB: cria a sessão definitiva (mesmos hooks)
  end
  BA-->>E: Set-Cookie nd.session_token
  E->>G: navega para ?volta (safeReturnPath) ou /inicio
  G->>DB: getSession(disableRefresh) + tenants por PK
  G->>G: evaluateSession
  alt admin sem 2FA
    G-->>U: /conta/seguranca
  else ok
    G->>DB: slideSession (se passaram 5 min — equipe — ou 15 — paciente)
    G-->>U: página (ou homeFor do papel)
  end
```

---

## 3.17 Como estender com segurança

- **Página nova do painel:** primeira linha `await requireNutri('/painel/…')`; numa aba do prontuário, `carregarProntuario(id)` (`src/app/painel/pacientes/[id]/prontuario.ts:13`). Use o `ctx` devolvido em `withTenant`. Nunca monte o `TenantContext` à mão. Server Action só em `actions.ts`. Checklist completo: [§7.4.5](07-testes-qualidade-e-processo.md#745-checklist-tela-nova).
- **Página nova do portal:** `await requirePaciente('/p/…')`. Nenhuma guarda do CI confere isso no portal (§7.4.5).
- **Rota nova em `/api/painel/*`:** `requireApiNutri(req)`; em `/api/p/*`, `requireApiPaciente(req)`. Lembre: o proxy não protege `/api/*`.
- **Página nova do admin:** `requireUser(['admin'], path)`. O admin não lê tabelas 🔒. Precisa de número agregado? Use função `SECURITY DEFINER` como `admin_tenant_metrics()`.
- **Área nova com outro prefixo de URL:** acrescente o prefixo em `PROTECTED` (`src/proxy.ts:7`) **e** chame a guarda na página.
- **Novo endpoint do Better Auth que confere senha:** acrescente uma regra de 5 / 15 min em `rateLimit.customRules`.
- **Novo fluxo que grava senha fora do Better Auth:** `validatePasswordPolicy(senha, commonPasswords())` antes do `hashPassword`, e checagem barata do token antes do argon2.
- **Tabela nova lida pelo contexto `conta`:** não faça. O D2 do Plano 06 limita o contexto a `patients` (SELECT).
- **Nunca** registre em log o link do convite, o link de redefinição, o token da sessão ou o cookie (CLAUDE.md, regra 3). Use `nomeDoErro(err)` ou `sanitizarErroDeBanco(err)`.

### Testes de referência

| Assunto | Teste |
|---|---|
| Regras de sessão | `src/lib/session-rules.test.ts`, `src/lib/session.test.ts`, `src/lib/api-auth.test.ts` |
| Better Auth (hooks, limite, suspensão) | `src/lib/auth.test.ts`, `src/lib/two-factor.test.ts` |
| Senha e links | `src/lib/password-policy.test.ts`, `src/lib/password-links.test.ts` |
| Portal | `src/lib/paciente-session.test.ts`, `src/lib/paciente-session.cache.test.ts` (uma leitura por requisição, P08-13), `src/modules/portal/vinculos.test.ts`, `src/modules/portal/termo.test.ts` |
| Convites, DPA, suspensão, admin | `src/modules/plataforma/primeiro-acesso.test.ts`, `dpa.test.ts`, `suspensao.test.ts`, `admin-bootstrap.test.ts`, `src/modules/pacientes/convite-paciente.test.ts` |
| Redirecionamento | `src/lib/safe-return.test.ts` |
| E2E | `e2e/auth.spec.ts`, `e2e/recuperacao.spec.ts`, `e2e/sair.spec.ts`, `e2e/sessao-portal.spec.ts` |

---

## 3.18 Variáveis de ambiente deste capítulo

Só os nomes. Os valores ficam no Easypanel.

| Variável | Uso |
|---|---|
| `APP_URL` | `baseURL`, `trustedOrigins`, CSRF do `/sair`, `Secure` do `nd_vinculo`, links de convite |
| `AUTH_SECRET` | assinatura dos cookies e cifra do TOTP (mín. 32 caracteres) |
| `TRUSTED_PROXIES` | IP real atrás do Traefik (obrigatória em produção) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | anti-robô do "Esqueci minha senha" |
| `ENCRYPTION_KEY` | cifra do job de e-mail que leva o link (não cifra o TOTP) |

---

## Divergências encontradas

| # | Spec | Código | Observação |
|---|---|---|---|
| 1 | US-001, cenário "Primeiro admin": o admin "recebe o e-mail para definir a senha" | `createAdmin` captura o link com `setPasswordLinkSink` e o script **imprime** no terminal (`scripts/admin-criar.ts`). Nenhum e-mail sai | A §9.7 da design spec (linha 406, "Deploy e migrations") já diz "o link … sai só no terminal". A US-001 ficou com o texto antigo |
| 2 | US-003, cenário "Segredo protegido": `users.totp_secret_enc` cifrado com AES-256-GCM | Tabela `two_factor` do Better Auth, cifra XChaCha20-Poly1305 com chave de `AUTH_SECRET` | Desvio consciente do Plano 01, aplicado à RNF-06 na v1.3; o cenário da US-003 não foi atualizado |
| 3 | US-002, cenário "Bloqueio por tentativas": 5 erros "com o mesmo e-mail e IP" | Limite por IP + rota (`rateLimit.customRules`, `auth.ts:128`). Não considera o e-mail | Desvio consciente (Plano 01; RNF-06 v1.11, D11). Pacientes atrás do mesmo IP de operadora dividem o balde |
| 4 | RNF-06 (design spec): "2FA TOTP para a nutricionista" | 2FA obrigatório só para o admin (`session-rules.ts:57`); opcional para a nutricionista | Coincide com a §3 e com a US-003 ("opcional para a nutricionista"). A frase da RNF-06 é ambígua |
| 5 | US-011, cenário "Aceite do convite": `consents` registra `termo_versao "1.0"` e o rótulo "(versão 1.0)" | **Resolvida (P08-06, 15/10/2026):** grava `termo-paciente-1.0`; o rótulo mostra "(versão 1.0)" (`termo-paciente.ts:7-12`) | O texto 1.0 foi publicado pelo dono sem o advogado. O valor gravado leva prefixo (`termo-paciente-`/`dpa-`), não só o número |
| 6 | US-002, cenário "Login redireciona por perfil": o paciente vai para `/p` | `homeFor('paciente')` = `/p/inicio`; `/p` também redireciona para `/p/inicio` (`src/app/p/page.tsx`) | Efeito igual; o destino exato difere |
| 7 | US-003, cenário "Ativar 2FA": "10 códigos de recuperação" | O código não fixa a quantidade: usa o padrão do Better Auth 1.7.6 (`amount ?? 10`) | Hoje bate. Uma atualização do Better Auth que mude o padrão muda o comportamento sem mudar o código |

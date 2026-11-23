# 4. Módulos clínicos e de plataforma

Este capítulo descreve os três blocos de domínio que sustentam o consultório:

- **Plataforma** (`src/modules/plataforma/`): contas, convites, perfil e marca, armazenamento, monitoramento, métricas e preferências.
- **Pacientes e prontuário** (`src/modules/pacientes/`): cadastro, etiquetas, anamnese, antropometria, gasto energético, exames, atendimentos, evolução e LGPD.
- **Alimentos e plano alimentar** (`src/modules/alimentos/`, `src/modules/plano-alimentar/`).
- **Ficha do paciente** (`src/modules/ficha/`, Plano 18): abas Início e Perfil, cabeçalho com a última avaliação e o registro de seções do Início ([§4.2.10](#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1)); no PR 2, a nota "Cadastro incompleto" e o "No app do paciente" ([§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)), ao lado do cadastro complementar (`patient_cadastro`, CPF) e da lista nova de `src/modules/pacientes/`.
- **Exames do consultório** (`src/modules/exames/`, Plano 22, PR 2): catálogo de exames com faixas e modelos de nota, modelos de solicitação, lançar do catálogo, editar com versão, detalhe com classificação e "Ver referência", nota de interpretação e comparativo ([§4.2.12](#4212-exames-do-consultório-catálogo-edição-com-versão-nota-e-comparativo-plano-22-pr-2)).

Fonte de verdade: o código. Cada afirmação cita arquivo e linha (ou função). Decisões citadas como "Plano NN, Dx" vêm de `docs/superpowers/plans/`. Regras "RN-xx", "RNF-xx", "US-xxx" e "CS-xx" vêm da spec (`docs/superpowers/specs/2026-09-27-nutridebby-mvp-design.md` e `…-historias.md`). "Regra n do CLAUDE.md" é a regra obrigatória n de `CLAUDE.md` do projeto.

## 4.0 Convenções que todos os módulos seguem

| Convenção | Como aparece no código | Onde |
|---|---|---|
| Tabela com `tenant_id` só dentro de `withTenant(ctx, fn)` | Todo serviço recebe `ctx: TenantContext` e abre a transação com `withTenant` | `src/db/tenant.ts`; regra 1 do CLAUDE.md |
| Id da URL validado antes do banco | `idValido(id)` (`z.guid()`); id inválido vira "não encontrado", nunca erro 500 | `src/modules/pacientes/base.ts:40` |
| Escrita no prontuário trava o paciente | `carregarPacienteParaEscrita(tx, id)`: `SELECT … FOR UPDATE`; bloqueado ou anonimizado lança `PacienteBloqueadoError`; arquivado continua editável | `src/modules/pacientes/base.ts:47` |
| Leitura de dado de saúde é auditada | `auditRead(tx, {entidade, entidadeId, patientId})` na mesma transação; escritas viram `audit_log` pelo gatilho `audit_row_change` | `src/modules/plataforma/audit.ts:28`; regra 8 do CLAUDE.md |
| Erros por campo | Cada módulo tem uma classe `XxxError` com `erros: Record<campo, mensagem>` e textos em pt-BR da spec | ex.: `PacienteError` (`pacientes/base.ts:18`), `PlanoError` (`plano-alimentar/erros.ts:28`) |
| Datas "do dia" no fuso do tenant | `hojeNoFuso(fuso, agora)`, `idadeEm(nascimento, data)` | `src/modules/pacientes/datas.ts:16,23`; RN-06 |
| Arredondamento | `arredondar(v, casas)` por notação exponencial (meio para cima, sem erro de ponto flutuante); `formatarDecimal` com vírgula e sem separador de milhar | `src/lib/numero.ts:33,39`; RNF-12 |
| Ordem de travas | paciente → tenant (cota) → registro do arquivo/plano. Toda função que mexe em arquivo de paciente ou em plano respeita essa ordem para evitar deadlock | comentários em `armazenamento.ts:61`, `rascunho.ts:168`, `plano-pdf-job.ts:30` |

Entidades de auditoria das tabelas deste capítulo (gatilho instalado por `app_enable_audit` nas migrations):

| Tabela | Entidade no `audit_log` | Migration |
|---|---|---|
| `patients` | `patients` (coluna de id `id`) | `drizzle/0017_rls_pacientes.sql` |
| `patient_tag_links` | `etiquetas` | `drizzle/0020_rls_etiquetas.sql` |
| `anthropometry` | `antropometria` | `drizzle/0022_rls_antropometria.sql` |
| `energy_calcs` | `gasto_energetico` | `drizzle/0024_rls_gasto_energetico.sql` |
| `anamneses` | `anamnese` | `drizzle/0026_rls_anamnese.sql` |
| `consultations` / `consultation_notes` | `atendimentos` / `notas_privadas` | `drizzle/0028_rls_atendimentos.sql` |
| `exams` | `exames` | `drizzle/0030_rls_exames.sql` |
| `privacy_requests` | `pedidos_titular` | `drizzle/0033_rls_privacidade.sql` |
| `data_exports` | `exportacoes` | `drizzle/0035_rls_exportacoes.sql` |
| `meal_plans`, `meals`, `meal_items` | `plano_alimentar` | `drizzle/0045_rls_planos_alimentares.sql` |
| `exam_interpretacoes` | `exames_nota` (Plano 22, EP-D61) | `drizzle/0128_rls_exames_catalogo.sql` |
| `exam_versoes` | `exames_versoes` (Plano 22) | `drizzle/0128_rls_exames_catalogo.sql` |

Tabelas sem `patient_id` (`anamnesis_templates`, `patient_tags`, `foods`, `food_measures`) não têm gatilho.
Plano 22: `exames_catalogo` e `exames_modelos_solicitacao` também não (bibliotecas do consultório, sem paciente).

---

## 4.1 Plataforma

### 4.1.1 Contas de nutricionista e convites (US-001, US-002, US-004)

**Arquivos:** `src/modules/plataforma/contas.ts`, `convites.ts`, `dpa.ts`, `suspensao.ts`, `tenant-status.ts`, `admin-bootstrap.ts`.

**Tabelas:** `tenants` (sem RLS, sem `tenant_id`), `user`/`account`/`session` (Better Auth, exceção de RLS), `invites` e `consents` (com `tenant_id`, mas em `RLS_EXCEPTIONS`).

| Função | O que faz | Onde |
|---|---|---|
| `criarContaNutri(input)` | Valida (`novaContaSchema`), cria `tenants` + `user` (`appRole = 'nutri'`, sem senha) + convite de 72 h + e-mail, **na mesma transação**. Pré-checa slug e e-mail para mensagem amigável; em corrida, decide a `UNIQUE` (`tenants_slug_unique`, `user_email_unique`) | `contas.ts:59` |
| `reenviarConvite(tenantId)` | Trava a nutricionista (`FOR UPDATE`), recusa se a conta está suspensa (`conta_suspensa`) ou se ela já tem senha (`ja_tem_senha`), gera convite novo | `contas.ts:89` |
| `listarContas(db?, now?, { busca, depois, antes, limite })` | Lista do admin: só `tenants`, `user`, `account`, `invites`. Calcula o estado do convite (`aceito`/`pendente`/`expirado`/`sem_convite`). **P09-07 (Plano 13, T11):** devolve `PaginaDeContas` (`contas`, `anterior`, `proxima`, `busca`), 50 por página (`CONTAS_POR_PAGINA`); cursor = id de um consultório (`?depois=`/`?antes=`, validado como uuid; inválido ou sem linhas = primeira página, mantendo a busca), comparação `(created_at, id)` com a linha do cursor **no banco** (sem perder os microssegundos), ordem `created_at desc, id desc`; busca (`trim`, até 100, `BUSCA_CONTAS_MAX`) por `position(lower(busca) in lower(nome · slug))` ou `exists` de **qualquer** nutricionista do consultório com o e-mail — `%` e `_` literais, parâmetro ligado; **uma linha por consultório** (`left join lateral … limit 1`: o e-mail mostrado é o da primeira nutricionista). As quatro métricas `admin_metricas_*` continuam calculadas para todos os consultórios (D-P5); a página `/admin` só desenha as linhas da página, com o formulário GET `role="search"` ("Buscar por nome, endereço ou e-mail", "Buscar", "Limpar busca", em `GET_PERMITIDOS`), "Nenhuma conta encontrada." e a navegação "Anterior"/"Próxima". Depois de uma ação, o redirecionamento volta à primeira página sem a busca (desvio 8 do Plano 13). **Plano 16 (T17):** a lista ficou enxuta — conta, situação, convite, pacientes ativos, "Consultas no mês" e "Abrir" (o armazenamento fica só na página da conta) (tabela a partir de 640 px; cartões no celular); cotas, liberações, métricas e ações de cada conta foram para a página da conta (`/admin/contas/<id>`), e as ações dela voltam a essa página | `contas.ts:164` |
| `contaPorId(tenantId, db?, now?)` (Plano 16, T17) | A mesma consulta da lista (`LINHA_DA_CONTA`, só `tenants`/`user`/`account`/`invites`), por id, para a página da conta; id que não é uuid ou não existe → `null` (a página responde 404) | `contas.ts:230` |
| `resumoDasContas(db?, now?)` (Plano 16, T17) | `{ ativas, suspensas, convitesPendentes }` de **todas** as contas (não só da página ou da busca), com a mesma regra de convite pendente da lista; a linha de resumo do topo de `/admin` | `contas.ts:244` |
| `criarConvite(q, userId)` | Apaga convites pendentes do usuário e grava um novo; guarda só o SHA-256 do token; devolve o token em claro só para o e-mail | `convites.ts:23` |
| `inspecionarConvite(q, token)` | Estado do token (`valido`/`expirado`/`invalido`); token fora do formato (`/^[A-Za-z0-9_-]{43}$/`) nem chega ao banco | `convites.ts:35` |
| `aceitarConvite(input)` | Primeiro acesso: aceite do DPA obrigatório, política de senha, checagem barata do token **antes** do argon2 (T6-R2a), depois transação: trava o usuário, consome o convite com `UPDATE … WHERE usado_em IS NULL`, grava a senha, marca e-mail verificado, registra o DPA | `convites.ts:66` |
| `registrarAceiteDpa(q, …)` | `INSERT … ON CONFLICT DO NOTHING` em `consents`; só adianta `tenants.dpa_aceito_em` se a linha foi inserida (prova e marca nunca divergem); com a linha da versão já existente e o tenant noutra versão (volta atrás e novo avanço, #153), regrava `dpa_versao` com o `aceito_em` da prova | `dpa.ts:111` |
| `definirIaLiberada(db, tenantId, liberar, adminId, { producao? })` (Plano 11) | Interruptor "IA" da admin (`tenants.ia_liberada`) com `liberar_ia`/`bloquear_ia` em `admin_actions`; em produção (`o.producao ?? emProducao(getEnv())`) recusa liberar (`IaProvisoriaError`) enquanto o aviso ou o aditivo forem `-provisorio` (D22). Só fora de `withTenant` (gatilho `tenants_interruptores_da_admin`) | `contas.ts:189` |
| `registrarAceiteAditivoIa(…)` (Plano 11) | Aceite do aditivo de IA em `consents` (`ia-aditivo-<versão>`, com o `tenant_id`) e `tenants.ia_ativada_em` (a data da ativação em vigor: o `coalesce` só a mantém com a IA ativa — aceite de versão nova, clique repetido, `dpa.ts:150-155`; `desativarIa` a zera, `ativacao.ts:48`, e a reativação grava data nova; o primeiro aceite de cada versão fica em `consents.aceito_em`) e `ia_aditivo_versao`; devolve se a linha é nova. Chamada por `ativarIa` ([§10.2](10-ia.md#102-peças)) | `dpa.ts:144` |
| `suspenderConta` / `reativarConta` | `tenants.status`, revoga as sessões das usuárias do tenant e envia `agenda-tenant` ao worker na mesma transação (o admin nunca toca tabela 🔒) | `suspensao.ts:19,33` |
| `getTenantStatus`, `tenantIsActive`, `buscarTenant`, `buscarTenantPorSlug`, `listarTenantsParaVarredura` | Leituras de `tenants`. `aguardarSuspensao` usa `FOR SHARE` para esperar uma suspensão em curso | `tenant-status.ts:26,49,33,42,54` |

Regras e constantes:

- Convite da nutricionista vale 72 h (`CONVITE_NUTRI_VALIDADE_MS`, `convites.ts:11`). Um convite pendente por usuário (índice único parcial em `invites`; spec §7).
- CRN: `/^CRN-?\d{1,2}\s?\d{3,6}$/i`, gravado em maiúsculas (`contas.ts:14,29`).
- Slug: `^[a-z0-9-]{3,40}$` (`contas.ts:35`).
- Ordem de travas usuário → convite em `aceitarConvite` e `reenviarConvite` (T6-R1) para evitar deadlock 40P01 (`convites.ts:62-65`).
- DPA: `DPA_VERSAO = '1.1'` (`dpa.ts:16`, Plano 20, US-309: as cláusulas 2 e 5 citam o Financeiro; a 1.0, de 15/10/2026, e a 0.1 provisória ficam em `DPA_TEXTOS`). Mudar a versão obriga novo aceite (`requireNutri`); detalhe em [§3.12](03-autenticacao-e-acesso.md#312-aceites-dpa-e-termo-do-paciente-consents) e [§12.9](12-financeiro.md#129-lgpd-us-307-us-309-f-d16-f-d17-f-d22-f-d23).
- RN-15 (tenant suspenso): sessões revogadas na hora; o worker consulta `tenantIsActive` antes de gerar exportação e PDF (`exportacao-job.ts`, `plano-pdf-job.ts:38`).

Decisão (Plano 02, "Suspensão"): status + revogação das sessões + bloqueio no login + checagem por requisição, em vez de só um status lido no login.

### 4.1.2 Perfil e marca (US-005)

**Arquivos:** `marca.ts`, `marca-constantes.ts`, `logo.ts`, `src/lib/tema/contraste.ts`, `src/lib/tema/marca-tema.ts`.

| Função | O que faz | Onde |
|---|---|---|
| `atualizarPerfil(tenantId, input)` | Valida `perfilSchema` e grava em `tenants`. O `tenantId` vem sempre da sessão (`requireNutri`), nunca do formulário (`tenants` não tem RLS) | `marca.ts:58` |
| `getTenantBrand(tenant)` | `{nome, cor, corNoEscuro, logoUrl}`; logo servido por `signFileUrl`. `server-only` | `marca.ts:67` |
| `processarLogo(conteudo)` | Tipo pelo conteúdo; PNG/JPEG redimensionados com `sharp` para ≤ 512 px, sem EXIF; SVG rasterizado num **processo filho** (`scripts/svg-raster.mjs`) morto por `SIGKILL` em 5 s ou com saída > 2 MB | `logo.ts:230`, `rasterizarSvg` |
| `contemFiltroSvg(buf)` | Recusa SVG com `filter`/primitivas `<fe…>`, inclusive escondidos por referência numérica, escape CSS, comentário ou CDATA; recusa DOCTYPE fora da forma comum | `logo.ts:127` |
| `trocarLogo(ctx, conteudo)` | `processarLogo` → `salvarArquivo(tipo 'logo', ['png'])` → `apontarLogo` (troca atômica de `tenants.logo_path` com `FOR UPDATE`) → apaga o logo antigo. Se o ponteiro falha, apaga o arquivo novo | `logo.ts:274`, `apontarLogo` `logo.ts:266` |

Validações de `perfilSchema` (`marca.ts:29`):

| Campo | Regra |
|---|---|
| `corPrimaria` | `#RRGGBB` e contraste ≥ 4,5:1 com branco (`contrasteComBranco`) |
| `antecedenciaMinH`, `cancelamentoMinH` | inteiro 0–72 |
| `linkOnlinePadrao` | Fora do `perfilSchema` desde o Plano 23 (AG-D7; o zod descarta a chave): o Perfil não lê nem grava `tenants.link_online_padrao`, que fica para a imagem anterior e para o aviso de link divergente em Locais; a sala de cada local de videoconferência fica em Locais de atendimento ([§5.11.1](05-agenda-portal-conteudo.md#5111-locais-de-atendimento-us-400-rn-400-a-rn-405)) |
| `enderecoConsultorio` | até 200 caracteres. Desde o Plano 23, rótulo "Endereço profissional (documentos)": vai no cabeçalho dos documentos assinados, é o endereço do "Consultório" criado por `garantirLocaisIniciais` e o das mensagens da consulta sem local (RN-407) |
| `fuso` | só os 15 fusos de `FUSOS_BRASIL` (`marca-constantes.ts:15`) |

Constantes: `COR_PADRAO = '#1d6b5a'` (Plano 08, D23; `marca-constantes.ts:8`), `LOGO_MAX_BYTES = 2 MB`, `LOGO_LADO_MAX = 512` (`marca-constantes.ts:10-11`).

Proteções do processamento de SVG (risco residual aceito na US-005): um logo por vez no processo (`processando`, `logo.ts:214`), resfriamento de 10 min por tenant depois de um SVG pesado (`RESFRIAMENTO_MS`, `logo.ts:148`), `<!ENTITY>` recusado já em `detectarTipo` (`src/lib/file-type.ts:64`). SVG nunca é guardado (RNF-06).

Decisão (Plano 08, D19): a cor do tenant vai para destaque, botões e foco; no modo escuro, a variante clara `corNoEscuro` é calculada no servidor.

Plano 10A: a mesma página (`/painel/configuracoes/perfil`) ganhou a seção "Dados para documentos" (`#documentos`: nome
completo, e-mail e telefone do carimbo das receitas, e a autodeclaração da habilitação em Fitoterapia), gravada por
`src/modules/documentos/perfil-profissional.ts` com auditoria explícita (`recordAudit`, entidade `perfil_profissional`,
sem paciente; `tenants` não tem gatilho). O CRN e o endereço continuam no formulário de marca. Detalhe no
[cap. 9](09-documentos-assinados.md#92-arquivos-do-módulo).

### 4.1.3 Armazenamento com cota e URL assinada (RN-18, regra 9 do CLAUDE.md)

**Arquivos:** `src/modules/plataforma/armazenamento.ts`, `src/lib/signed-url.ts`, `src/lib/file-type.ts`, `src/app/api/arquivos/route.ts`.

**Tabelas:** `stored_files` 🔒 (registro de cada arquivo) e `tenants.armazenamento_bytes` (contador da cota).

Layout no disco: `DATA_DIR/<tenantId>/<tipo>/<uuid>.<ext>` (`armazenamento.ts:96`). O nome nunca vem do usuário. `resolverCaminho` recusa qualquer caminho que escape de `DATA_DIR` (`armazenamento.ts:49`).

| Função | O que faz | Onde |
|---|---|---|
| `salvarArquivo(ctx, input)` | Única porta de gravação. Ver fluxo abaixo | `armazenamento.ts:64` |
| `apagarArquivo(ctx, filtro, deps)` | Única porta de remoção: apaga `stored_files`, devolve os bytes à cota e remove do disco depois do commit (ou antes, com `removerAntesDoCommit`) | `armazenamento.ts:160` |
| `nivelDeUso(bytes)` | `ok` / `aviso` (≥ 80%) / `esgotado` (≥ 100%) | `armazenamento.ts:38` |
| `limparTmpOrfaos(dataDir, agora)` | Apaga `*.<pid>.tmp` com mais de 24 h; fila diária `limpar-tmp` às 04h | `armazenamento.ts:210`; `src/worker/index.ts:211` |
| `signFileUrl(caminho)` | URL `/api/arquivos?c=…&e=…&s=…`, HMAC-SHA256 com `FILE_URL_SECRET`, validade 300 s | `src/lib/signed-url.ts:16` |
| `verifyFileUrl(params)` | Confere formato do caminho, assinatura (comparação em tempo constante) e validade | `src/lib/signed-url.ts:27` |

Parâmetros de `salvarArquivo`:

| Parâmetro | Uso |
|---|---|
| `tipo` | `logo`, `capa`, `exame`, `plano_pdf`, `diario_foto`, `diario_foto_original`, `orientacao_pdf`, `exportacao` (`armazenamento.ts:16`) |
| `permitidos` | Extensões aceitas para aquele uso; o tipo real vem dos *magic bytes* (`detectarTipo`); SVG nunca passa (`armazenamento.ts:92-94`) |
| `patientId` | Obrigatório para `TIPOS_DO_PACIENTE` (`exame`, `plano_pdf`, `diario_foto`, `diario_foto_original`, `exportacao`) e proibido para os demais (Plano 06, D4; `armazenamento.ts:20,89`). O banco repete a regra no CHECK `stored_files_dono` |
| `antesDaReserva(tx)` | Roda antes da reserva da cota: é onde se trava o dono do arquivo (paciente) |
| `registrar(tx, arquivo)` | Grava o registro que aponta para o arquivo (exame, exportação, PDF) na mesma transação |
| `naoBarrarPelaCota` | Só a exportação LGPD: conta na cota, mas não é recusada por ela |
| `substitui` | Caminho do arquivo que este substitui (foto do diário): a cota é conferida pela diferença |

```mermaid
sequenceDiagram
    participant S as Serviço (ex.: criarExame)
    participant A as salvarArquivo
    participant D as Disco (DATA_DIR)
    participant B as Postgres (withTenant)
    S->>A: tipo, conteúdo, permitidos, patientId, antesDaReserva, registrar
    A->>A: detectarTipo (magic bytes) e checagem de dono
    A->>D: grava <destino>.<pid>.tmp (fora da transação)
    A->>B: BEGIN
    A->>B: antesDaReserva (trava o paciente)
    A->>B: UPDATE tenants SET armazenamento_bytes += n WHERE soma <= 5 GB
    alt nenhuma linha
        A-->>S: CotaEsgotadaError
    end
    A->>B: INSERT stored_files
    A->>B: registrar (INSERT exams / UPDATE data_exports / UPDATE meal_plans)
    A->>D: rename .tmp → destino
    A->>B: COMMIT
    Note over A,D: erro em qualquer passo: apaga o .tmp e, se já renomeou, o destino
```

Regras:

- Cota de 5 GB por tenant (`COTA_BYTES`, `armazenamento.ts:12`), aviso em 80% (`COTA_AVISO`). Mensagem: "Espaço de armazenamento esgotado. Fale com o suporte." (RN-18).
- A reserva é um `UPDATE` condicional na linha de `tenants`: uploads simultâneos serializam nessa linha e nunca passam do limite (`armazenamento.ts:115-127`).
- O arquivo vai para o disco **antes** da transação; dentro dela só acontece o `rename`. Assim a linha do tenant fica travada pelo tempo do `rename`, não da escrita (`armazenamento.ts:102-105`).
- Falha no `rm` depois do commit só gera aviso de arquivo órfão; o log leva o código do erro (`motivoDoErro`), nunca o caminho (RNF-11; `armazenamento.ts:193-203`).

Servir arquivos (`src/app/api/arquivos/route.ts:21`):

- Não há sessão na rota: a URL assinada é a credencial. Quem emite a assinatura é quem já checou o acesso (página do painel ou do portal).
- Respostas: 403 (assinatura ou caminho), 410 (expirada), 404 (arquivo ausente).
- Cabeçalhos do 200: `content-security-policy: default-src 'none'; sandbox`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `cache-control: private, max-age=<segundos até expirar>` (T8-R2a) (`route.ts:36-47`; a CSP está em `:42`).
- As respostas de erro (403, 410, 404; `erro()`, `route.ts:18`) não levam essa CSP: só `cache-control: no-store` mais os cabeçalhos globais de `next.config.ts` (§6.3.1).
- PDF e ZIP saem como `attachment`; imagens como `inline` (o visualizador de PDF do Chrome não abre sob CSP `sandbox` — desvio registrado no Plano 03).
- O caminho aceito é só `<uuid>/<tipo>/<uuid>.(png|jpg|webp|heic|pdf|zip)` (`CAMINHO_ARQUIVO`, `signed-url.ts:8`).

Como estender com segurança:

1. Tipo novo de arquivo: acrescentar em `TipoDeArquivo`, no CHECK `stored_files_tipo_valido` (migration), em `TIPOS_DO_PACIENTE` se tiver dono, e no `MIME`/`CAMINHO_ARQUIVO` se a extensão for nova. Se o tipo tiver dono (paciente), confira também: o CHECK `stored_files_dono` (`drizzle/0071_stored_files_paciente.sql:7`, validado em `0072`), que exige `patient_id` exatamente para os tipos de paciente; a política `paciente_arquivos` (`0072`, refeita em `0085`), que decide o que o paciente enxerga; `anexosDoPaciente` (`src/modules/pacientes/lgpd.ts:445`), que apaga os arquivos na exclusão e na anonimização (LGPD), e a exportação (`exportacao-job.ts`), se o arquivo faz parte dos dados do titular. Se o arquivo for temporário (como `exportacao`), acrescente o `--exclude` do `rclone sync` de `data/` em `scripts/backup/nutri-backup.sh:118` (hoje só `/*/exportacao/**`), para não ir ao R2.
2. Registro que aponta para o arquivo: gravar no `registrar` de `salvarArquivo` e apagar no `naMesmaTransacao` de `apagarArquivo`. Nunca em transação separada (regra 9 do CLAUDE.md; Plano 03, decisão "Arquivo e registro juntos").
3. Respeitar a ordem de travas: dono em `antesDaReserva`/`naMesmaTransacao`, depois cota. Os documentos (Plano 10A) travam o paciente e o documento antes da cota em todo `salvarArquivo` que grava nele (`travarDocumentoAntesDaCota`, `src/modules/documentos/arquivos-do-preparo.ts`; ordem paciente → original → versão nova → tenant, cap. 09 §9.11.5).

Tipos do Plano 10A: `documento_base` (PDF preparado), `documento_assinado` (PDF final) e `documento_digitalizado` (fotos da
digitalizada), os três com dono. São os primeiros apontados por FK **`NO ACTION`** (`signed_documents.base_pdf_path` e
`pdf_path`), não `SET NULL`: um `apagarArquivo` avulso de um PDF de documento é recusado. A política `paciente_arquivos`
(refeita na 0090) esconde do paciente o base e as fotos; `anexosDoPaciente` nunca lista esses caminhos (a anonimização
passa por `anonimizarDocumentosDoPaciente`, [§9.4.4](09-documentos-assinados.md#944-lgpd-us-150-base-plano-10a-d1)).

### 4.1.4 Monitoramento de backup e disco (RNF-05, RNF-13)

**Arquivo:** `src/modules/plataforma/monitoramento.ts`. Jobs em `src/worker/index.ts:131-149`.

O backup roda no host (systemd às 03h, `scripts/backup/nutri-backup.sh`), não no worker (Plano 02, decisão "Onde roda o backup"; regra 10 do CLAUDE.md). O script grava `backup_runs`; o app só lê.

| Função | O que faz | Onde |
|---|---|---|
| `ultimosBackups(db, now)` | Última execução de cada tipo (`banco`, `arquivos`) por `DISTINCT ON` | `monitoramento.ts:47` |
| `backupsFaltando(db, now)` | Tipos sem execução nas últimas 26 h ou cuja última execução falhou | `monitoramento.ts:59` |
| `verificarBackups` | Avisa os admins; o e-mail cita só os tipos, nunca `backup_runs.detalhe` | `monitoramento.ts:96` |
| `percentualDisco(statfs)` | Mesma conta do `df` (blocos reservados ao root não contam como livres), arredondada para cima | `monitoramento.ts:18` |
| `statfsDoDiretorio(dir)` | Mede o ancestral existente mais próximo se `DATA_DIR` ainda não existe | `monitoramento.ts:28` |
| `verificarDisco` | Alerta com ≥ 70%, no máximo 1 e-mail a cada 24 h (marca `alerta_disco` em `system_heartbeat`) | `monitoramento.ts:103` |
| `avisarAdmins(db, montar, …)` | Um e-mail por admin, todos na mesma transação; a marca do alerta só confirma junto dos e-mails e só se houve destinatário (F5, F6, G4) | `monitoramento.ts:79` |

| Job | Agenda (America/Sao_Paulo) | Constante |
|---|---|---|
| `monitor-backup` | `0 7 * * *` | `BACKUP_JANELA_MS = 26 h` (`monitoramento.ts:10`) |
| `monitor-disco` | `0 * * * *` | `DISCO_LIMITE = 70` (`monitoramento.ts:11`) |

### 4.1.5 Métricas do admin e critérios de sucesso CS-01..03

**Arquivos:** `src/modules/plataforma/metricas.ts` (admin), `metricas-sucesso.ts` (nutricionista). Migrations `0086_metricas_sucesso.sql` (colunas) e `0087_metricas_sucesso_admin.sql` (função).

O admin nunca consulta tabela 🔒 (regra 1). Ele lê só contagens por funções `SECURITY DEFINER` que entram tenant a tenant e recusam rodar dentro de `withTenant` (`drizzle/0087_metricas_sucesso_admin.sql:14-16`).

| Função | O que devolve | Onde |
|---|---|---|
| `metricasPorTenant()` | `admin_tenant_metrics()`: arquivos, bytes, pacientes ativos, consultas e mensagens de WhatsApp do mês | `metricas.ts:21` |
| `metricasDeSucessoPorTenant()` | `admin_metricas_sucesso()`: pacientes com conta, que abriram o app em 7 dias, faltas e consultas iniciadas no mês | `metricas.ts:44` |
| `ajustarCotaWhatsapp(tenantId, valor)` | `tenants.wa_cota_mensal`, inteiro 0–100000 (RN-09) | `metricas.ts:61` |
| `metricasDeIaPorTenant()` (Plano 11) | `admin_metricas_ia()`: tarefas de IA e custo do mês (micro-dólares) por tenant; desde o Plano 16 (T17) aparece no bloco "Uso no mês" da página da conta (antes, coluna "IA" da lista) | `metricas.ts:176` |
| `ajustarCotaIa(tenantId, valor, adminId)` (Plano 11) | `tenants.ia_cota_mensal_usd`, 0–1000 ("Informe um valor entre 0 e 1000"); grava `ajustar_cota_ia` em `admin_actions` e o valor só no log (`limite de IA ajustado`) | `metricas.ts:119` |
| `salvarMetricasBase(tenantId, {taxaBase, goLiveEm})` | `tenants.taxa_faltas_base` (0–100, até 2 casas, vírgula ou ponto) e `tenants.go_live_em` (dd/mm/aaaa) | `metricas.ts:92` |
| `metricasDeSucesso(ctx, tenant, agora)` | CS-01, CS-02 e CS-03 do tenant, numa transação, sem `auditRead` (só contagens) | `metricas-sucesso.ts:23,32` |

Definições (Plano 08, D15; spec §1.1):

| Critério | Cálculo no código |
|---|---|
| CS-01 | Consultas `realizada` com atendimento (`LEFT JOIN consultations` por `appointment_id`) ÷ consultas `realizada` desde `go_live_em` até agora; "dias desde o início" = dias entre `go_live_em` e hoje + 1 (`DIAS_CS01 = 30`) |
| CS-02 | Pacientes `ativo`, com `user_id` e não anonimizados que têm `access_events` nos últimos 7 dias ÷ a mesma população; barras por dia (`META_CS02 = 0.6`) |
| CS-03 | Taxa de faltas do mês (Início) contra `taxa_faltas_base` informada pelo admin |

Decisão (Plano 08, D15): denominador do CS-02 = ativos **com conta**, não todos os ativos; base do CS-03 gravada pelo admin, não pela nutricionista.

### 4.1.6 Preferências de tema e manual guiado (Plano 08, D17, D26, D27)

**Arquivos:** `src/modules/plataforma/preferencias.ts`, `preferencias-tipos.ts`. Migration `0088_preferencias_usuaria.sql`.

| Função | O que faz | Onde |
|---|---|---|
| `gravarTema(userId, tema)` | `user.tema` ∈ `sistema`/`claro`/`escuro` | `preferencias.ts:16` |
| `lerGuia(userId)` | `user.guia` (`{id: {v, estado}}`) | `preferencias.ts:22` |
| `marcarGuia(userId, id, versao, estado)` | Um `UPDATE` com `jsonb_set` atômico: duas abas não se apagam; versão menor nunca sobrescreve; "visto" não rebaixa um tour concluído ou dispensado da mesma versão | `preferencias.ts:32` |
| `proximoTema(atual, aparelhoEscuro)` | O botão alterna o que a usuária vê | `preferencias-tipos.ts:7` |

Decisão D17: colunas na `user` (não cookie, não `localStorage`, não tabela nova). O tema chega à sessão pelo `additionalFields` do Better Auth; o servidor desenha o tema sem piscar. O `userId` vem sempre de `requireNutri`.

---

## 4.2 Pacientes e prontuário

### 4.2.1 Cadastro de paciente (US-010, RN-17)

**Arquivos:** `src/modules/pacientes/pacientes.ts`, `base.ts`, `datas.ts`, `telefone.ts`, `convite-paciente.ts`; desde o Plano 18 (PR 2), `cadastro.ts`, `cadastro-textos.ts` e `cpf.ts`.

**Tabelas:** `patients` 🔒 e, desde o Plano 18, `patient_cadastro` 🔒 (o cadastro complementar, [§2.5.4](02-banco-de-dados.md#254-prontuário-pacientests); detalhe na [§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)). Restrições relevantes (`src/db/schema/pacientes.ts`): `UNIQUE (tenant_id, email)` em `citext`; status `ativo`/`arquivado`/`bloqueado`; telefone E.164; CHECK `patients_nascimento_e_sexo` (nascimento e sexo obrigatórios, salvo origem `agendamento_publico` ou anonimizado).

| Função | O que faz | Onde |
|---|---|---|
| `pacienteSchema(hoje)` | Nome 2–120; nascimento válido, idade 18–120 no dia do tenant (RN-17); sexo `F`/`M`; e-mail; telefone normalizado para E.164; WhatsApp autorizado exige telefone; convite por WhatsApp exige autorização. Plano 18: mais os 17 campos opcionais do cadastro complementar (`formaDoCadastro`, as regras de `validarCadastro`, uma fonte só com os CHECKs) | `pacientes.ts:40` |
| `criarPaciente(ctx, tenant, input)` | Insere com `origem = 'nutri'`, autorização de WhatsApp de origem `nutri`, convite por e-mail de 7 dias na mesma transação e, se pedido, o aviso por WhatsApp (sem link). E-mail repetido decidido pela `UNIQUE`. Plano 18: o cadastro complementar na mesma transação (`gravarCadastro`, só os campos enviados) | `pacientes.ts:127` |
| `atualizarPaciente(...)` | Trava o paciente; e-mail bloqueado depois que ele ativou o acesso; e-mail corrigido antes do aceite reenvia o convite. Plano 18: `gravarCadastro` depois da trava, na mesma transação; chave ausente mantém o gravado | `pacientes.ts:165` |
| `buscarPaciente(ctx, id)` | Abre o prontuário e audita a leitura (`patients`). Plano 18 (D7, D20): devolve `PacienteDaFicha` (a linha de `patients` + `nomeSocial`, por projeção num `left join`; nada mais do cadastro complementar) | `pacientes.ts:217` |
| `listarPacientes(ctx, filtro)` | Busca sem acento por nome, **nome social** ou e-mail (`unaccent … ilike`, curingas escapados), filtro por aba (`ativos`, `inativos`, `todos`, `bloqueados`) e etiqueta, até 500 linhas; ordem `nome`/`nome_desc` pelo nome exibido (`coalesce(nome_social, nome)` sem acento e sem maiúsculas), `recentes`/`antigos` por `created_at`, empate pelo id (Plano 18, RN-270–RN-272). Filtrar por etiqueta audita uma leitura de "etiquetas" por paciente devolvido | `pacientes.ts:291` |
| `filtroDaUrl(searchParams)` | Plano 18: o filtro da lista a partir da URL; `?aba=` só aceita as três abas, `?situacao=bloqueados` (o "Ver bloqueados"), os links antigos `?status=arquivado` (→ `inativos`) e `?status=bloqueado`; valor desconhecido cai no padrão (`ativos`, `nome`) | `pacientes.ts:270` |
| `situacoesDoAcesso(ctx, pacientes)` | Plano 18 (§8.1): a coluna "Acesso ao app" da lista numa consulta só (convite mais recente de cada paciente sem conta, as regras de `situacaoDoAcesso`); só lê `invites`, filtrando pelo tenant | `convite-paciente.ts:105` |
| `gravarCadastro(tx, …)` / `cadastroDoPaciente(ctx, id)` | Plano 18: grava o cadastro complementar (pré-checagem do CPF sob trava) / devolve os valores à aba Perfil com `auditRead` (entidade `patients`) — [§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2) | `cadastro.ts:287`, `:321` |

Autorização de WhatsApp (`autorizacaoWhatsapp`, `pacientes.ts:113`): o formulário da nutricionista nunca desfaz uma escolha do paciente. Marcar só grava se não há opt-in nem opt-out; desmarcar só apaga opt-in de origem `nutri`.

A lista não audita (nome e contato), como a agenda (Plano 05, D10). Abrir o prontuário audita. Plano 18: a lista nova
(abas, ordem, "Desde", nome social e o menu "Ações" por linha) está na [§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2);
a agenda continua pedindo a ordem pelo nome de registro (`ordem: 'registro'`, que `filtroDaUrl` nunca devolve).

Plano 14B-2: a página do paciente — desde o Plano 18, a aba Início da ficha (`src/app/painel/pacientes/[id]/page.tsx:87`) —
ganha a seção "Inteligência artificial"
com o link "Resumo do histórico (IA)" quando a IA permite o resumo (`iaDoAssistente`, `[id]/ia-assistente.ts:19`) ou o
motivo quando não permite; nada aparece com a IA ausente, o consultório suspenso, o paciente não ativo ou a IA ainda não
ativada. A tela `/painel/pacientes/[id]/resumo-ia` está na [§10.13.6](10-ia.md#10136-telas-e-manual-guiado).

Plano 18 (D12): o formulário do cadastro, o "Acesso ao app" (antes "Acesso ao portal") e as "Etiquetas" saíram dessa
página e foram para a aba Perfil (`src/app/painel/pacientes/[id]/perfil/page.tsx:18`), sem mudar as funções acima; as
três Server Actions (`atualizarPacienteAction`, `reenviarConviteAction`, `salvarEtiquetasAction`) mandam o login de volta
ao Perfil (`requireNutri` com `/painel/pacientes/{id}/perfil`, `src/app/painel/pacientes/actions.ts:41,57,70`).
Detalhe da ficha na [§4.2.10](#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1).

### 4.2.2 Etiquetas (US-019)

**Arquivo:** `src/modules/pacientes/etiquetas.ts`. **Tabelas:** `patient_tags` e `patient_tag_links`, ambas `staff_only` (`drizzle/0020_rls_etiquetas.sql`; `STAFF_ONLY` em `src/db/rls-guard.ts:105`).

| Função | O que faz | Onde |
|---|---|---|
| `listarEtiquetas(ctx)` | Etiquetas com a contagem de pacientes **ativos** (o número do seletor bate com a lista padrão) | `etiquetas.ts:17` |
| `etiquetasDoPaciente(ctx, id)` | Leitura auditada (etiqueta é dado de saúde: "diabetes", "gestante") | `etiquetas.ts:34` |
| `salvarEtiquetasDoPaciente(ctx, id, {etiquetas, nova})` | Deixa o paciente com exatamente o conjunto pedido; cria a `nova` (até 40 caracteres) se não existir; id de outro tenant é ignorado (só vale o que a RLS mostra) | `etiquetas.ts:56` |

Decisão (Plano 03, "Notas privadas e etiquetas"): tabelas próprias com a política RESTRICTIVE `staff_only` (`app.role <> 'paciente'`). Uma coluna em tabela visível ao paciente não poderia ser escondida: o role do banco é o mesmo e GRANT por coluna não distingue `app.role`. A guarda `findStaffOnlyViolations` quebra o CI se faltar a política.

### 4.2.3 Anamnese com modelo e snapshot (US-012)

**Arquivos:** `anamnese.ts`, `anamnese-tipos.ts` (puro, usado também no navegador), `anamnese-padrao.ts`.

**Tabelas:** `anamnesis_templates` 🔒 (`nome`, `schema jsonb`, `padrao`, `arquivado_em`; índice único parcial de um padrão por tenant; Plano 14B-1: `ia_geracao_id`, `aprovado_em`, `aprovado_por`) e `anamneses` 🔒 (`template_snapshot`, `respostas`, `data`).

| Função | O que faz | Onde |
|---|---|---|
| `garantirModeloPadrao(tx, tenantId)` | Cria "Anamnese geral" se o tenant nunca teve padrão; corrida decidida pelo índice único (`ON CONFLICT DO NOTHING`) | `anamnese.ts:36` |
| `listarModelos(ctx)` | Garante o padrão e lista os não arquivados, com `sugestaoIa` e `aprovadoEm` (Plano 14B-1) | `anamnese.ts:42` |
| `listarModelosUsaveis(ctx)`, `buscarModeloUsavel(ctx, id)` | Plano 14B-1 (RN-125): só os próprios e os sugeridos pela IA **aprovados** — as escolhas do paciente (lista, página "nova" e a action) | `anamnese.ts:47,75` |
| `aprovarModeloAnamnese(ctx, id)` | Plano 14B-1: "Aprovar modelo" com o modelo travado; grava `aprovado_por` (= `actorUserId`) e `aprovado_em`; sem origem IA → "modelo não encontrado" | `anamnese.ts:93` |
| `itensDescartadosDoModelo(ctx, m)` | Plano 14B-1 (desvio 12): os itens descartados do pacote de onde veio o modelo | `anamnese.ts:85` |
| `salvarModelo(ctx, id, input)` | Cria ou altera; valida com `validarModelo` (até 100 perguntas; escolha precisa de ≥ 2 opções; até 30 opções de até 100 caracteres) | `anamnese.ts:114`; `anamnese-tipos.ts:43` |
| `arquivarModelo(ctx, id)` | "Excluir" = arquivar | `anamnese.ts:138` |
| `preencherAnamnese(ctx, tenant, patientId, templateId, respostas)` | Valida contra o modelo atual e grava **cópia do modelo** em `template_snapshot`; modelo sugerido pela IA sem aprovação → "Aprove o modelo antes de usá-lo com pacientes." (Plano 14B-1) | `anamnese.ts:144` |
| `atualizarAnamnese(...)` | Valida contra o **snapshot**, nunca contra o modelo atual | `anamnese.ts:184` |
| `listarAnamneses`, `buscarAnamnese` | Leituras auditadas (`anamnese`) | `anamnese.ts:199,226` |
| `perguntasDaAnamnese(...)` | Só as perguntas do snapshot, sem auditar (não devolve resposta) | `anamnese.ts:216` |

Tipos de pergunta (`TIPOS_PERGUNTA`, `anamnese-tipos.ts:6`): `texto_curto` (≤ 200), `texto_longo` (≤ 5000), `numero` (com unidade), `sim_nao`, `escolha_unica`, `multipla_escolha`, `data`. Obrigatória vazia: "Responda: {rótulo}"; valor inválido: "Resposta inválida: {rótulo}". Qualquer erro = nada salvo (`validarRespostas`, `anamnese-tipos.ts:81`).

Modelo padrão (`modeloPadrao`, `anamnese-padrao.ts:6`): dez perguntas não obrigatórias com os nomes exatos da US-012.

Decisão (Plano 03, "Modelo padrão de anamnese"): criado na primeira listagem, não na criação da conta, porque a conta é criada pelo admin, que nunca toca tabela 🔒.

**A anamnese e a IA (Plano 14B-2).** A anamnese mais recente vai ao resumo do histórico e, só com "Considerar a anamnese"
marcada, ao rascunho de plano, sempre por `respostasMascaradas` (`src/modules/ia/pseudonimizar.ts:141`: pergunta e
resposta, na ordem do `template_snapshot`, mascaradas e cortadas em 2.000 caracteres; sem ids), nunca o modelo nem os ids
das perguntas ([§10.13.1](10-ia.md#10131-o-que-sai-e-a-pseudonimização-d8d11-rn-115-rn-120)). O módulo de anamnese não
mudou.

**Modelos sugeridos pela IA (Plano 14B-1, US-123).** O pacote de uma área traz 1 modelo de anamnese, gravado pelo worker com `ia_geracao_id` e o nome prefixado pela área ("Diabetes: …"). Na lista (`/painel/anamnese/modelos`) aparece a marca "Sugestão da IA — revise" ou "Aprovado em {data}"; na página do modelo, a faixa, os itens descartados do pacote e "Aprovar modelo". O gatilho `app_modelo_ia_origem` segura a origem e a aprovação (só pelo `worker`, aprovação uma vez e pela usuária da sessão) e o CHECK `anamnesis_templates_padrao_aprovado` impede que um sugerido sem aprovação seja o padrão (não há ação "tornar padrão", desvio 9). Desenho completo no [§10.12](10-ia.md#1012-modelos-sugeridos-pela-ia-plano-14b-1).

### 4.2.4 Antropometria (US-013) e gasto energético (US-014)

**Arquivos:** `formulas.ts` (puro, usado no servidor e na prévia do navegador), `antropometria.ts`, `antropometria-constantes.ts`, `gasto-energetico.ts`.

**Tabelas:** `anthropometry` 🔒 (`imc` gerado pelo banco; `densidade numeric(6,5)`; `perc_gordura numeric(5,2)`) e `energy_calcs` 🔒 (entradas e resultado com 6 casas; CHECK idade ≥ 18 e fator 1,00–2,50).

#### Fórmulas implementadas (Apêndice A)

Unidades: peso P em kg, altura A em cm, idade I em anos completos, soma de dobras S em mm.

| Fórmula | Implementação | Onde |
|---|---|---|
| IMC = P / (A/100)² | `imc()` no navegador; no banco, coluna gerada `round(peso_kg / ((altura_cm/100)^2), 2)` | `formulas.ts:28`; `src/db/schema/pacientes.ts` (`anthropometry.imc`) |
| Harris-Benedict, homem: 66,47 + 13,75·P + 5,003·A − 6,755·I | `tmb('harris_benedict')` | `formulas.ts:89-90` |
| Harris-Benedict, mulher: 655,1 + 9,563·P + 1,85·A − 4,676·I | idem | `formulas.ts:90` |
| Mifflin-St Jeor: 10·P + 6,25·A − 5·I + 5 (H) / − 161 (M) | `tmb('mifflin')` | `formulas.ts:91-92` |
| FAO/OMS 18–29: 15,3·P + 679 (H) / 14,7·P + 496 (M) | `tmb('fao_oms')`; menor de 18 lança erro (RN-17) | `formulas.ts:93-95` |
| FAO/OMS 30–59: 11,6·P + 879 (H) / 8,7·P + 829 (M) | idem | `formulas.ts:96` |
| FAO/OMS ≥ 60: 13,5·P + 487 (H) / 10,5·P + 596 (M) | idem | `formulas.ts:97` |
| GET = TMB × fator (1,00–2,50) | `gastoTotal()`: TMB sem arredondar, resultado limpo em 6 casas (1302,5 × 1,40 daria 1823,4999… em JS) | `formulas.ts:101-108` |
| Jackson & Pollock: D = a − b·S + c·S² − d·I | `densidadeJP()` com `COEF_JP` | `formulas.ts:34-42` |
| JP3 homem (peitoral, abdominal, coxa): 1,10938 / 0,0008267 / 0,0000016 / 0,0002574 | `COEF_JP.jp3.M`, `JP3.M` | `formulas.ts:21,35` |
| JP3 mulher (tríceps, supra-ilíaca, coxa): 1,0994921 / 0,0009929 / 0,0000023 / 0,0001392 | `COEF_JP.jp3.F`, `JP3.F` | `formulas.ts:21,35` |
| JP7 homem (7 dobras): 1,112 / 0,00043499 / 0,00000055 / 0,00028826 | `COEF_JP.jp7.M` | `formulas.ts:36` |
| JP7 mulher: 1,097 / 0,00046971 / 0,00000056 / 0,00012828 | `COEF_JP.jp7.F` | `formulas.ts:36` |
| Siri: %G = 495 / D − 450 | `siri()` | `formulas.ts:45` |

Detalhes que mudam o resultado:

- `calcularGordura` grava a densidade com 5 casas e o %G com 2, mas calcula o %G a partir da densidade **sem arredondar** (arredondar antes muda a 2ª casa) (`formulas.ts:66-74`).
- Dobras fora de [1, 100] mm ficam ausentes; as presentes são arredondadas a 1 casa antes da conta (`dobrasNormalizadas`, `formulas.ts:51`).
- Exibição de TMB e GET: `kcal(v)` = inteiro, meio para cima, depois de limpar o resíduo de ponto flutuante (RN-14; `formulas.ts:111`).
- `compararTmb` devolve as três fórmulas lado a lado (`formulas.ts:113`).

#### Serviços

| Função | O que faz | Onde |
|---|---|---|
| `registrarAntropometria(ctx, tenant, patientId, input)` | Valida tudo antes (data não futura nem anterior ao nascimento; peso 1–400; altura 30–250; circunferências 5–300; dobras 1–100). Com protocolo `jp3`/`jp7` e dobras completas, grava densidade e %G com a idade **na data da avaliação**. Faltando dobra ou cadastro, salva as medidas e devolve aviso ("Preencha as N dobras…") | `antropometria.ts:64` |
| `listarAntropometrias`, `excluirAntropometria` | Leitura auditada; exclusão trava o paciente | `antropometria.ts:142,159` |
| `salvarCalculo(ctx, tenant, patientId, input)` | Idade no dia do cálculo no fuso do tenant; sexo e nascimento do cadastro; recusa menor de 18; grava TMB e GET com 6 casas e devolve os inteiros do mesmo valor gravado (sem arredondamento duplo) | `gasto-energetico.ts:33` |
| `listarCalculos`, `medidasRecentes` | Leituras auditadas; `medidasRecentes` alimenta o cálculo e o g/kg do plano | `gasto-energetico.ts:78,92` |

### 4.2.5 Exames (US-015)

**Arquivos:** `exames.ts`, `exames-constantes.ts`. **Tabela:** `exams` 🔒 (`valores jsonb`; `arquivo_path` com FK para `stored_files.caminho ON DELETE SET NULL` e CHECK do prefixo do tenant).

| Função | O que faz | Onde |
|---|---|---|
| `lerValores(bruto)` | Até 50 linhas; nome ≤ 80, unidade ≤ 20, referência ≤ 80; valor numérico finito < 10¹⁵. Passou do limite → recusa (não corta dado de saúde em silêncio). Desde o Plano 22 é o envoltório de `lerLinhasComErros` (`:56`), que dá o erro por campo e lê a faixa do laudo ([§4.2.12](#4212-exames-do-consultório-catálogo-edição-com-versão-nota-e-comparativo-plano-22-pr-2)); erro → `null`, como antes, para `ia/conferencia.ts` | `exames.ts:105` |
| `criarExame(ctx, tenant, patientId, input)` | Valida; confere o paciente (barato) antes de tocar arquivo; com laudo, chama `salvarArquivo(tipo 'exame', ['pdf','jpg','png'])` com `antesDaReserva` = trava do paciente e `registrar` = `INSERT exams`. Desde o Plano 22, os erros das linhas saem por campo (`lerValoresComErros`, `:99`) | `exames.ts:117` |
| `excluirExame(ctx, patientId, id)` | Exame e laudo saem na mesma transação (`apagarArquivo` com `naMesmaTransacao`). Desde o Plano 11 (D20), antes do `DELETE` chama `cancelarTarefas(tx, { tenantId, patientId, examId })`: leitura da IA na fila é cancelada com estorno e a sugestão pronta é esvaziada; a tarefa fica, com `exam_id` nulo (`ON DELETE SET NULL`). Desde o Plano 22, a nota e as versões do exame saem pela FK em cascata, com um `excluir` por linha no `audit_log` | `exames.ts:169` |
| `listarExames` | Leitura auditada (`exames`, um `ler` por abertura, `entidade_id` nulo) | `exames.ts:200` |
| `agruparMarcadores(lista)` | Uma série por nome + unidade (sem diferenciar maiúsculas e espaços), pontos em ordem cronológica: mg/dL e mmol/L são séries diferentes. A chave (`chaveDoMarcador`, `:217`) é a mesma do comparativo do Plano 22 | `exames.ts:223` |

Limite: 20 MB por laudo (`EXAME_MAX_BYTES`, `exames-constantes.ts:2`), mensagem "Envie PDF, JPEG ou PNG de até 20 MB".

Plano 11: o exame com laudo ganha "Ler valores com IA" (quando a IA está ativa e o paciente foi informado); as linhas
salvas de uma sugestão levam `iaTarefaId` e aparecem com "IA · conferido em {data}". `lerValores` continua montando
objetos novos, então a digitação manual nunca grava `iaTarefaId`. Detalhe no [cap. 10](10-ia.md).

Plano 22 (PR 2): a aba ganha "Adicionar do catálogo", "Carregar modelo de solicitação", "Remover todos", a faixa do laudo
por linha (`refMin`/`refMax`), a classificação, "Ver referência", "Abrir", "Editar" e "Comparar". Tudo o que lê ou grava a
nota e as versões do exame fica **fora** deste arquivo (que `ia/conferencia.ts` importa), em `src/modules/exames/`
(EP-D62, RN-399): [§4.2.12](#4212-exames-do-consultório-catálogo-edição-com-versão-nota-e-comparativo-plano-22-pr-2).

### 4.2.6 Atendimentos e notas privadas (US-016)

**Arquivo:** `atendimentos.ts`. **Tabelas:** `consultations` 🔒 (`data`, `orientacoes_paciente` ≤ 5000, `appointment_id` único quando não nulo) e `consultation_notes` 🔒 `staff_only` (`texto` 1–20000; FK tripla `(tenant_id, patient_id, consultation_id)`).

| Função | O que faz | Onde |
|---|---|---|
| `registrarAtendimento(ctx, tenant, patientId, input)` | Data não futura; textos normalizados (CRLF → LF). Com `appointmentId` (Plano 05, "Iniciar atendimento"): trava a consulta, aplica `motivoParaNaoIniciarAtendimento` e marca a consulta `realizada`. Grava a nota em `consultation_notes` (vazia = sem linha) | `atendimentos.ts:69` |
| `atualizarAtendimento(...)` | Altera data e orientações; regrava ou apaga a nota | `atendimentos.ts:113` |
| `listarAtendimentos` | Data e orientações, **sem** a nota; audita `atendimentos` | `atendimentos.ts:177` |
| `buscarAtendimento` | Abre um atendimento com a nota (`LEFT JOIN`); audita `atendimentos` e, se houver nota, `notas_privadas` | `atendimentos.ts:182` |
| `orientacoesDoPaciente(ctx)` | Para o portal: só orientações, só em sessão de paciente (recusa o contexto da nutricionista) | `atendimentos.ts:192` |

Garantias de privacidade da nota: a política `staff_only` (`drizzle/0028_rls_atendimentos.sql`) esconde a tabela de qualquer sessão de paciente, mesmo por SQL direto; a exportação nunca inclui notas (ver 4.2.9). Plano 14B-2: as notas dos 10 últimos atendimentos só vão ao resumo do histórico pela IA quando a nutricionista marca "Incluir notas privadas" (desmarcada por padrão), mascaradas; as orientações desses atendimentos vão sempre ([§10.13.1](10-ia.md#10131-o-que-sai-e-a-pseudonimização-d8d11-rn-115-rn-120)).

Corrida "duas abas iniciando o mesmo atendimento": decidida pelo índice `consultations_consulta_idx`; o erro vira "Esta consulta já tem um atendimento registrado." (`atendimentos.ts:108`).

Plano 20 (F-D13, RN-310): quando o atendimento leva a consulta ligada de outra situação a `realizada`, `registrarAtendimento`
chama `cobrarConsultaRealizada` na mesma transação, depois das travas (paciente `FOR UPDATE` → consulta `FOR UPDATE`), e
passa a devolver `{ id, cobranca }` (`cobranca` nulo sem consulta ou com ela já `realizada`: sem retroativo). A action leva
só o tipo do resultado na URL (`?ok=atendimento&cobranca=…`); a página do atendimento mostra "Atendimento registrado.
Cobrança de {valor} criada no Financeiro." ou o aviso de sem valor ([§12.5](12-financeiro.md#125-cobrança-da-consulta-us-303-rn-310-a-rn-314)).

### 4.2.7 Evolução em SVG no servidor (US-017)

**Arquivos:** `evolucao.ts`, `ui/grafico-linha.tsx`. Páginas: `src/app/painel/pacientes/[id]/evolucao/page.tsx` e `src/app/p/(portal)/evolucao/page.tsx`.

| Função | O que faz | Onde |
|---|---|---|
| `seriesDasAvaliacoes(avaliacoes)` | Uma série por medida (peso, IMC, %G, seis circunferências), só com as datas em que foi medida; série vazia some | `evolucao.ts:15` |
| `diferencas(series)` | Primeiro × último de cada série com ≥ 2 pontos | `evolucao.ts:49` |
| `formatarDiferenca(v, casas, unidade)` | "−3,2 kg" com sinal de menos tipográfico; arredonda o módulo e aplica o sinal depois | `evolucao.ts:41` |
| `casasDoMarcador(pontos)` | Casas de exibição do marcador de exame (máximo digitado, teto 3) | `evolucao.ts:36` |
| `evolucaoDoPaciente(ctx, patientId)` | Junta antropometria e marcadores; as leituras são auditadas pelos serviços de origem | `evolucao.ts:60` |
| `GraficoLinha` | Componente de servidor: SVG 640×220, eixo com mínimo/meio/máximo, `<title>` por ponto, tabela de dados para leitor de tela e impressão; zero JS | `ui/grafico-linha.tsx:17` |

Texto com poucos dados: "Registre mais uma avaliação para ver a evolução" (`MSG_POUCOS_DADOS`, `evolucao.ts:8`).

Decisão (Plano 03, "Gráficos"): SVG próprio em vez do Recharts previsto na §9.1 — nenhum JS de gráfico no navegador e acessível por tabela.

### 4.2.8 LGPD: arquivar, pedido de exclusão e anonimização (US-018, RNF-08)

**Arquivos:** `lgpd.ts`, `conta-titular.ts`. **Tabelas:** `patients`, `privacy_requests` 🔒 (um pedido aberto por paciente e tipo, índice `privacy_requests_aberto_unique`), mais as tabelas que cada etapa limpa.

```mermaid
stateDiagram-v2
    [*] --> ativo: criarPaciente
    ativo --> arquivado: arquivarPaciente
    arquivado --> ativo: desarquivarPaciente
    ativo --> bloqueado: atenderPedidoExclusao
    arquivado --> bloqueado: atenderPedidoExclusao
    bloqueado --> anonimizado: anonimizarVencidos (job retencao-lgpd, anonimizar_apos < hoje)
    note right of bloqueado
      prontuário só leitura
      carregarPacienteParaEscrita recusa
    end note
    note right of anonimizado
      status continua 'bloqueado'
      anonimizado_em preenchido
    end note
```

| Função | O que faz | Onde |
|---|---|---|
| `arquivarPaciente(ctx, id)` | `ativo` → `arquivado`; apaga convites pendentes. Prontuário mantido (RN-08) | `lgpd.ts:60` |
| `desarquivarPaciente(ctx, id)` | `arquivado` → `ativo`; bloqueado lança erro | `lgpd.ts:80` |
| `atenderPedidoExclusao(ctx, tenant, id, nomeDigitado)` | Confere o nome digitado; calcula `anonimizar_apos`; conclui (ou cria concluído) o `privacy_requests`; bloqueia; ver lista abaixo; enfileira `exclusao-atendida` na mesma transação | `lgpd.ts:114` |
| `apagarFotosDoDiario(ctx, id)` | Remove fotos do diário (original e JPEG) com `removerAntesDoCommit`; o registro fica com `foto_status = 'removida'` | `lgpd.ts:236` |
| `concluirExclusaoAtendida(data, deps)` | Job: apaga as fotos e **só depois** envia o e-mail "pedido atendido" (F-13). Na última tentativa o e-mail sai mesmo com erro de disco. Plano 15: antes do e-mail, as conversas da IA Nutri e a participação (`apagarIaNutriDoTitular`), menos a pergunta com risco não aberta, que fica até 30 dias (D22); o e-mail cita "as conversas com a IA Nutri" e essa guarda ([§10.14.7](10-ia.md#10147-retenção-exclusão-anonimização-e-exportação-rn-181-d8--180-dias-d22-76-133)) | `lgpd.ts:370` |
| `pedidosDoTitularAbertos(ctx)` | Quadro "Pedidos do titular" do Início, prazo mais curto primeiro | `lgpd.ts:425` |
| `anexosDoPaciente(tx, id)` | Laudos, exportações, PDFs de plano e fotos do diário do paciente | `lgpd.ts:445` |
| `anonimizarVencidos(db, now)` | Job diário: por tenant (inclusive suspensos), rede de segurança das fotos, depois anonimiza cada bloqueado vencido. Plano 15: `app_anonimizar_consentimentos_ia_nutri` (tira IP, user-agent e conta do consentimento da IA Nutri) e `limparIaNutriNaAnonimizacao` (o que restou da conversa e a participação). Plano 18 (RN-283): apaga a linha de `patient_cadastro` e, no início de cada tenant, roda a rede `apagarCadastrosDosAnonimizados`. Plano 20: `app_anonimizar_financeiro`, só se o paciente tem lançamento (`:565`) | `lgpd.ts:502` |
| `contaSemOutroVinculo(tx, userId)` / `anonimizarContaSemVinculo(tx, userId, now)` | P06-08: a conta de login sem outro vínculo é anonimizada; sessões, senha, 2FA e `verification` ligados a ela saem; só conta `paciente` | `conta-titular.ts:10,29` |

O que `atenderPedidoExclusao` faz na transação (`lgpd.ts:114-219`):

1. `status = 'bloqueado'`, `bloqueado_em`, `anonimizar_apos`; desde o Plano 17, `lembretes_pausados_em` nulo no mesmo UPDATE
   (a única limpeza que o gatilho `patients_lembretes_do_paciente` deixa à sessão `nutri`).
2. Opt-in de WhatsApp apagado e opt-out gravado.
3. Convites pendentes apagados.
4. Consultas futuras canceladas pelo "sistema", sem aviso ao paciente (`cancelarFuturasPelaExclusao`; decisão do dono no fechamento do Plano 05).
5. Notificações pendentes viram `ignorada` sem conteúdo selado.
6. `push_subscriptions` do vínculo apagadas (Plano 05, D14).
7. Uso de conteúdo apagado (`apagarUsoDeConteudo`; Plano 07, D15).
8. `access_events` apagados (`apagarAcessosDoTitular`; Plano 08, D13).
9. Plano 17: lembretes de rotina apagados (`lgpd.ts:205`; as marcas de envio em cascata), depois do UPDATE do item 1 e da
   trava do tenant de `cancelarTarefas` — a configuração é ajuste do app, não prontuário
   ([§5.3.9](05-agenda-portal-conteudo.md#539-lembretes-de-rotina-por-push-plano-17)).
10. `recordAudit('bloquear')` e job `exclusao-atendida`.

Prazo de guarda: `PRAZO_GUARDA_ANOS = 20` (`lgpd.ts:45`), contado do **último registro do prontuário**, que no pedido de exclusão é o próprio bloqueio: `anonimizar_apos` = hoje no fuso do consultório + 20 anos (`lgpd.ts:133-135`), mesmo para quem tem atendimento antigo (JUR-01, decisão do dono em 09/10/2026; Res. CFN 594/2017, art. 3º, VI, "b"). Até 09/10/2026 contava do último `consultations.data`; a migration de dados `0110_prazo_guarda_bloqueio` recalculou quem já estava bloqueado e não anonimizado — data do bloqueio (`bloqueado_em` no fuso do tenant; sem ela, o `concluido_em` do pedido de exclusão atendido) + 20 anos, só para mais (`GREATEST`), com o gatilho de auditoria ligado (`set_config` por tenant; um "alterar" de ator nulo por paciente que mudou). O 20 está repetido na migration. P-01 (o número) segue pendente com CRN/advogado.

A anonimização de cada paciente (`lgpd.ts:502-643`):

1. Apaga cada anexo com `removerAntesDoCommit` (se o `rm` falhar, o registro fica e o dia seguinte tenta de novo).
2. Trava o paciente; `app_anonimizar_aceites(id)` tira IP e conta dos aceites (migration 0065). Plano 20: se o paciente tem
   lançamento, `app_anonimizar_financeiro(id)` tira a descrição e o motivo dos lançamentos, cancela os em aberto (sem autora)
   e marca `anonimizado_em`; valor, datas, categoria e forma ficam ([§12.3.3](12-financeiro.md#1233-função-app_anonimizar_financeirouuid-rn-316-f-d23)).
3. `nome = 'Paciente anonimizado'`, e-mail `anonimo-<id>@anonimizado.invalid`, telefone, nascimento e `user_id` nulos.
4. Se surgiu anexo novo nesse meio tempo, desfaz tudo (fica para o dia seguinte).
5. Plano 18 (D18, RN-283): apaga a linha de `patient_cadastro` (CPF, endereço, observação…) inteira, **depois** do UPDATE do
   item 3, que grava `anonimizado_em` — o gatilho `patient_cadastro_sem_apagar` só deixa o `worker` apagar com o titular já
   anonimizado, e o `patient_cadastro_titular_ativo` recusa gravar de novo (`lgpd.ts:596`). O gatilho de auditoria grava o
   "Excluiu" de ator nulo. Apaga push, lembretes de rotina (Plano 17, com a pausa limpa no UPDATE do item 3), uso de conteúdo e acessos gravados depois do bloqueio; limpa textos livres e destinos da agenda (`anonimizarAgenda`, `lgpd.ts:478`; Plano 05, D10).
6. Anonimiza a conta de login sem outro vínculo (Plano 06, D18).
7. `recordAudit('anonimizar')`.

Um tenant com erro não para os outros; o log leva só o tenant e o código do erro (RNF-11).

**Rede do cadastro complementar (Plano 18, RN-283).** `apagarCadastrosDosAnonimizados` (`lgpd.ts:652`) roda no **início**
de cada tenant da varredura (`lgpd.ts:512`), num `withTenant` worker próprio, antes da rede das fotos e da listagem dos
vencidos: `delete from patient_cadastro c using patients p where … p.anonimizado_em is not null`. Serve à janela do
deploy e a uma volta atrás para a imagem anterior ao Plano 18, cuja anonimização marca `anonimizado_em` sem apagar a
linha; num dia normal não acha nada. Fica antes da listagem porque a listagem que falha faz `continue` e pularia o
tenant (o teste `rede` de `lgpd.test.ts` cobre a listagem que falha). Erro só no log, com o tenant e o motivo, sem dado.
A spec (RN-283) diz "no fim" da varredura: divergência registrada (#18 abaixo).

O pedido de exclusão atendido (`bloqueado`) **não** muda o cadastro complementar: ele fica guardado até a anonimização,
como o resto do prontuário (teste em `lgpd.test.ts`).

Jobs: `retencao-lgpd` às 04h (`src/worker/index.ts:153`), que também chama `expirarExportacoesVencidas`; `exclusao-atendida` com 5 novas tentativas (`src/jobs/queues.ts:20`).

Plano 10A: na anonimização, os documentos assinados saem **antes** do laço de anexos, por
`anonimizarDocumentosDoPaciente` (`src/modules/documentos/lgpd-documentos.ts`; função `app_anonimizar_documentos` no
`naMesmaTransacao` do apagar do PDF), e a conferência final recusa se sobrar PDF de documento
(`pdfsDeDocumentosRestantes`). No bloqueio, os documentos ficam guardados e só leitura; o portal e o link deixam de
mostrá-los; a verificação pública continua. Detalhe em [§9.4.4](09-documentos-assinados.md#944-lgpd-us-150-base-plano-10a-d1).

Plano 11: o pedido de exclusão atendido chama `cancelarTarefas` (fila cancelada com estorno, sugestões prontas
esvaziadas; `lgpd.ts`, ordem paciente → tenant → tarefas); a anonimização, no contexto `worker` e depois de gravar
`anonimizado_em`, apaga as linhas de `ia_tarefas` do paciente — a única exclusão que o gatilho `ia_tarefas_sem_apagar`
aceita — e o registro técnico fica em `ia_uso`, sem titular ([§10.7](10-ia.md#107-privacidade)).

Plano 20 (Financeiro, [§12.9](12-financeiro.md#129-lgpd-us-307-us-309-f-d16-f-d17-f-d22-f-d23)): o pedido de exclusão
atendido **não** mexe nos lançamentos (obrigação fiscal e cobrança da pendência; F-D16, F-D20). Depois do bloqueio, o
módulo e o gatilho `fin_lancamentos_regras` só deixam receber, desfazer o recebimento, reduzir o valor e cancelar; nenhum
lançamento novo. A aba Privacidade ganha um parágrafo próprio depois do texto do bloqueio ("Os registros de pagamento do
Financeiro ficam guardados pelo mesmo prazo do prontuário, e as cobranças em aberto continuam valendo."); a confirmação do
portal (`CONFIRMAR_EXCLUSAO`) e os e-mails `pedido_exclusao_registrado` e `exclusao_atendida` citam os registros de
pagamento das consultas (textos em `MSG_FINANCEIRO.lgpd`).

### 4.2.9 Exportação ZIP (US-018, US-046)

**Arquivos:** `exportacao.ts` (rotas e painel), `exportacao-job.ts` e `prontuario-pdf.tsx` (só no worker). **Tabela:** `data_exports` 🔒 (`status` `pendente`/`pronta`/`falhou`/`expirada`, `escopo` `equipe`/`titular`, `expira_em`).

Regra 9 do CLAUDE.md: PDF e ZIP (`@react-pdf/renderer`, `fflate`) só no worker. `exportacao.ts` importa de `exportacao-job.ts` só o tipo (`exportacao.ts:11-12`); a guarda está em `exportacao.test.ts`.

```mermaid
sequenceDiagram
    participant N as Painel / Portal
    participant E as solicitarExportacao
    participant W as Worker (exportacao-paciente)
    participant F as salvarArquivo
    N->>E: Exportar dados (escopo)
    E->>E: trava paciente; recusa anonimizado
    E->>E: reaproveita pendente < 30 min do mesmo escopo
    E->>E: INSERT data_exports + recordAudit('exportar') + job (mesma transação)
    W->>W: tenant ativo? pedido pendente? titular ainda ativo?
    W->>W: montarDados (sem staff_only) + lerAnexos (teto 100 MB)
    W->>W: renderizarProntuario (PDF) + zipSync
    W->>F: tipo 'exportacao', naoBarrarPelaCota
    F->>F: antesDaReserva: trava paciente, desiste se anonimizado
    F->>F: registrar: status 'pronta', e-mail com link, job expirar-exportacao (+24 h)
    W->>W: expirarAnteriores (mesmo paciente e escopo)
```

| Função | O que faz | Onde |
|---|---|---|
| `solicitarExportacao(ctx, patientId, {escopo})` | Ver diagrama. Pendente há mais de 30 min (`PENDENTE_MAX_MS`) vira `falhou` e nasce outro | `exportacao.ts:57` |
| `estadoDaExportacao(...)` | Estado para a página do link; entregar o link pronto audita `exportacoes` | `exportacao.ts:129` |
| `exportacoesRecentes(...)` | Últimos 5 pedidos, auditados | `exportacao.ts:171` |
| `linkDaExportacao(appUrl, pedido)` | Titular: `/p/meus-dados/exportacoes/<id>` (com o consultório); equipe: `/painel/pacientes/<id>/exportacoes/<id>` | `exportacao.ts:37` |
| `montarDados(tx, patientId, now, fuso, escopo)` | `dados.json` com paciente, anamneses, antropometria, gasto energético, exames, atendimentos (só orientações), planos (rascunho só no escopo `equipe`), pedidos LGPD, consultas, lembretes (mensagens das consultas), aceites, dispositivos push (sem endpoint), lembretes de rotina (`lembretesDeRotina`, Plano 17: configuração, texto, `ligado` e a escolha do titular, sem a marca de envio; e `paciente.lembretesPausadosEm`, nos dois escopos), diário e conteúdos; desde o Plano 18, `paciente.cadastro` (abaixo) | `exportacao-job.ts:440` |
| `gerarExportacao(data, deps)` | Job idempotente: só age sobre `pendente`; cota esgotada, anonimização no meio ou última tentativa → `falhou` | `exportacao-job.ts:808` |
| `expirarExportacao` / `expirarExportacoesVencidas` | Apaga o ZIP e marca `expirada` na transação do arquivo; a varredura diária pega o que o job de +24 h não conseguiu | `exportacao-job.ts:1049,960` |

Conteúdo do ZIP: `dados.json`, `prontuario.pdf`, `laudos/<data>-<nn>.<ext>` e `diario/<data>-<n>.jpg` (nomes sem texto do usuário; `exportacao-job.ts:553,561,866-867`). Laudos e fotos guardados sem recompressão. Acima de `LIMITE_LAUDOS_BYTES = 100 MB` (`exportacao-job.ts:372`) o que não cabe fica fora com `laudosForaDoZip = true`.

Nunca exportados: `consultation_notes`, `patient_tags`/`patient_tag_links` (Plano 03, "Conteúdo da exportação"), motivo de cancelamento escrito pela nutricionista, texto e destino das mensagens.

Plano 10A: o ZIP traz os PDFs assinados das receitas em `documentos/` e a chave `documentos` no `dados.json`
(`documentosParaExportacao`): equipe = todos, com a justificativa de uso; titular = só os emitidos, com a justificativa
e o recebimento; nunca o PDF preparado nem o motivo de cancelamento.

Plano 11: o `dados.json` ganha a seção `ia` (id, tipo, situação, `criadoEm`, `encerradoEm`, `enviadoEm` = `saiu_em` e o
provedor quando o laudo saiu; nunca a sugestão — `ia_tarefas` é `staff_only` e entra só por inclusão explícita) e, em
`paciente`, `avisoIa` (versão, data, canal), `avisoIaEnviadoEm` e `recusouIaEm`, nos dois escopos
(`exportacao-job.ts`).

Plano 15: o `dados.json` ganha a chave `iaNutri` (`iaNutriParaExportacao`, `src/modules/ia/nutri-paciente/lgpd.ts`), nos
dois escopos: os consentimentos da IA Nutri com IP e user-agent ("Autorizou", "Desativou", "Desativou (pedido registrado
pela nutricionista)") e as mensagens com rótulos legíveis (autor, texto ou o texto fixo traduzido, categoria, risco,
avaliação, `enviadaEm`/`destino` só da pergunta que saiu, data e situação da dúvida enviada à nutricionista), datas ISO
8601 (LGPD art. 19, § 3º); nunca fontes, motivo técnico, modelo, versão das instruções ou custo; o esqueleto da
revogação fica de fora. No escopo da equipe, a pergunta com risco de quem desativou a IA Nutri vai sem o texto (D22: lida
uma vez, pela fila "Dúvidas dos pacientes"; [§10.14.7](10-ia.md#10147-retenção-exclusão-anonimização-e-exportação-rn-181-d8--180-dias-d22-76-133)).

Plano 18 (§10, D18, RN-262): o `dados.json` ganha `paciente.cadastro` nos **dois** escopos (`cadastroParaExportacao`,
`exportacao-job.ts:102`, por inclusão explícita de cada coluna): `cpf` e `telefoneFixo` formatados como a tela,
`identidadeDeGenero`, `estadoCivil` e `escolaridade` pelo **rótulo** que a tela mostra (LGPD, art. 18, II e V; art. 19,
§ 3º), `nomeSocial`, `ocupacao`, `nacionalidade`, `naturalidade`, `endereco` (`cep` com hífen, `rua`, `numero`,
`complemento`, `bairro`, `cidade`, `uf`) e `observacao`; sem linha, `cadastro: null`. É o único lugar fora do
formulário com o CPF. O `prontuario.pdf` (`Identificacao`, `prontuario-pdf.tsx:68`) passa a trazer a identificação da Res.
CFN 594/2017: "Nome: {nome civil}", logo depois "Nome social: …" (quando há; D7), nascimento, sexo, identidade de gênero,
estado civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço numa linha e os dois telefones; **sem** o
CPF (RN-262) e **sem** a observação (fica no `dados.json`). Campo vazio sai "-". O ZIP não tem LEIA-ME: o que a spec
§10 diz do "LEIA-ME da exportação" não tem onde entrar (divergência #17 abaixo). A guarda
`colunas-decididas.test.ts` quebra quando aparece coluna nova em `patients` ou `patient_cadastro` sem a decisão de
exportação, anonimização e IA (§2.11, passo 8).

Plano 20: o `dados.json` ganha a chave `financeiro` (a última; `financeiroParaExportacao`, `src/modules/financeiro/titular.ts`,
chamada em `exportacao-job.ts:537`), nos **dois escopos**, por inclusão explícita (`fin_lancamentos` é `staff_only`, como
`ia_tarefas`; o comentário de `montarDados` cita as duas): vencimento, pagamento, valor (centavos e "R$ …"), forma, situação
no dia da exportação (no fuso), categoria, descrição, início da consulta ligada, data e motivo do cancelamento; nunca quem
lançou nem quem cancelou (F-D22: cópia integral do que é do titular, LGPD art. 19, § 3º). O `prontuario.pdf` não muda e
nenhum arquivo novo entra no ZIP ([§12.9](12-financeiro.md#129-lgpd-us-307-us-309-f-d16-f-d17-f-d22-f-d23)).

Plano 22 (PR 2; RN-376, RN-378, RN-383, RN-399, EP-D19, EP-D41): em `exames[]`, as linhas de `valores` levam
`refMin`/`refMax` quando informados, e cada exame ganha `versoesAnteriores` (de `exam_versoes`, `staff_only`, por inclusão
explícita, da mais antiga para a mais nova: `versao`, `titulo`, `data`, `valores` e `alteradoEm`; **sem** a justificativa e
sem o autor) e `notaDeInterpretacao` (a em vigor, de `exam_interpretacoes`, `null` sem nota ou com a nota apagada; nos
**dois** escopos — é a interpretação clínica do exame do titular, não nota privada, e a tela avisa: "Não aparece no app;
entra na cópia dos dados que o paciente pedir."). Só no escopo da equipe, `notasAnteriores` (`versao`, `texto` — nulo =
"Apagar nota" — e `criadoEm`, sem o autor). São duas consultas a mais, depois da de `exams` (`montarDados`,
`exportacao-job.ts:475`, `:487`; montagem em `:664-666`; tipo em `:239-260`). A nota não vai ao `prontuario.pdf`. Depois da
anonimização, a nota e a justificativa saem nulas ([§2.5.13](02-banco-de-dados.md#2513-exames-do-consultório-e-filhas-do-exame-exames-catalogots-exames-filhasts-plano-22)). Plano 22, PR 3
(RN-385, RN-399): cada exame leva também `mostradoNoAppEm` — o instante da liberação no app em ISO, `null` quando o exame
não aparece (nunca liberado ou retirado); quem ligou e quem retirou ficam no `audit_log` ([§4.2.13](#4213-mostrar-no-app-plano-22-pr-3)).

Validade do link: 24 h (`EXPORTACAO_VALIDADE_MS`, `exportacao.ts:14`). O ZIP não vai para o backup de `/data` (Plano 03, decisão do dono).

### 4.2.10 Ficha do paciente: Início, Perfil, cabeçalho e registro de seções (Plano 18, PR 1)

O Plano 18 (spec `docs/superpowers/specs/2026-11-16-nutridebby-18-ficha-cadastro-design.md`, plano
`docs/superpowers/plans/2026-11-16-nutridebby-18-ficha-cadastro.md`) sai em dois PRs (D21). Esta seção descreve o
**PR 1** (Tarefas 1–4, fundação **sem migration**, em produção pelo PR #52). O PR 2 (Tarefas 5–12c: cadastro complementar
`patient_cadastro`, lista com abas, "No app do paciente", LGPD, nome social na IA, E2E e carga) está na
[§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2); aqui ficam só as notas do que ele mudou
nas peças do PR 1.

**Arquivos.** Módulo `src/modules/ficha/`: `tipos.ts` (contrato), `secoes/` (um arquivo por seção, mais `comum.ts` e
`index.ts`), `inicio.ts`, `resumo.ts`, `adicionar.ts`, `cabecalho.ts` e `textos.ts`. Os textos ficam em `MSG_FICHA`
(`textos.ts:7`), sem import de servidor, porque o diálogo cliente lê dali. Telas em `src/app/painel/pacientes/[id]/`:
`abas.tsx`, `layout.tsx`, `prontuario.ts`, `page.tsx` (Início), `perfil/page.tsx`, `inicio/adicionar.tsx`,
`inicio/secao.tsx` e `inicio/acoes.ts`; e `src/components/foco-na-ancora.tsx`. Sem tabela nova, sem fila nova e nada
no worker. O módulo usa `pacientes` (6 imports), `documentos` (2) e `plataforma` (2). Só as telas da ficha o importam.

#### Abas (D12, RN-274)

`ABAS` (`abas.tsx:10`) tem 13 abas, nesta ordem:

- **Início** (`''`, o antigo "Resumo") e **Perfil** (`perfil`).
- Antropometria, Gasto energético, Anamnese, Atendimentos, Exames, Evolução, Privacidade e Plano alimentar.
- **Documentos**, só com `documentos_liberados` (D20 do 10A), e **IA Nutri**, com a IA Nutri ativada ou com
  participação (Plano 15).
- **Histórico**: rótulo visível "Histórico" e nome acessível "Histórico de acessos" (`nome` → `aria-label`,
  `abas.tsx:23`). O nome começa pelo texto visível (WCAG 2.5.3), e o título da página continua "Histórico de acessos".

O Início também fica ativo em `/app` e `/resumo-ia`, páginas que saem dele sem aba própria (`DO_INICIO`,
`abas.tsx:27,47`; a `/app` é a página "No app do paciente" do PR 2). Com 13 abas, a faixa cabe a 1280 px sem rolar: o comentário de `abas.tsx`
estima cerca de 1170 de 1232 px, e o E2E confere (`acessibilidade-painel.spec.ts`, caso "Plano 18: a faixa de abas…",
`scrollWidth <= clientWidth` e axe sem "incomplete"). Uma 14ª aba não cabe (R-266).

**Perfil** (`perfil/page.tsx:18`) recebeu, como estavam no Resumo:

- "Cadastro" (`PacienteForm`, "Salvar cadastro");
- "Acesso ao app" (título que era "Acesso ao portal"), com `textoDoAcesso`, a linha do convite por WhatsApp e
  "Reenviar convite";
- "Etiquetas".

Paciente bloqueado vê tudo só para leitura, com o aviso "Paciente bloqueado por pedido de exclusão: o prontuário é só
para consulta.". As Server Actions continuam em `src/app/painel/pacientes/actions.ts`, com a volta do login no Perfil
(`:41,57,70`). `atualizarPacienteAction` revalida o layout inteiro (`revalidatePath(…, 'layout')`, `:51`), e o
cabeçalho é lido de novo. `reenviarConviteAction` e `salvarEtiquetasAction` revalidam só o Perfil (`:64,81`). No PR 2 o
Perfil passou a ler os valores do cadastro complementar (`cadastroDoPaciente`, com `auditRead`) e o formulário ficou em
seções ([§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)).

#### Cabeçalho com a última avaliação (D13, RN-275)

`lerCabecalho(ctx, patientId)` (`cabecalho.ts:22`):

- Aceita só `ctx.role === 'nutri'`; id malformado devolve `null` sem consultar.
- Lê a última linha de `anthropometry`, ordenada por `data desc, created_at desc, id desc` (`:32`; o id só desempata).
  A seção Antropometria usa a mesma ordem.
- Seleciona só o id, a data e as medidas.
- Com avaliação, grava **um** `auditRead` (entidade `antropometria`, `entidadeId` da avaliação) na mesma transação
  (`:35`). Sem avaliação, não grava nada.

`linhaDoCabecalho` (`:49`) devolve "Última avaliação em {dd/mm/aaaa}: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura
28,1%". A altura sai em metros com duas casas; peso, IMC e gordura, com uma; a gordura some quando é nula. Sem avaliação,
"Sem avaliação antropométrica.".

A ficha só lê o cabeçalho por `carregarCabecalho` (`src/app/painel/pacientes/[id]/prontuario.ts:25`):

- É um `cache()` do React com chave texto (`patientId`), como `carregarProntuario` (`:13`), de onde vem o `ctx`.
- Mora em `src/app` porque `src/modules` não importa de `@/app`.
- O layout chama uma vez (`layout.tsx:19`) e põe a linha com `print:hidden` (`:55`): a folha impressa pode ir para a mão
  do paciente com o peso oculto (RN-203).
- Com `peso_oculto_no_app_em`, aparece o selo "Peso oculto no app" (`:33`). O painel continua mostrando o peso (RN-204).

O layout não roda de novo entre abas irmãs. Roda no carregamento completo e a cada `revalidatePath(…, 'layout')`, e cada
execução grava uma linha "Visualizou" de antropometria (custo aceito na D13). A guarda `cabecalho-fonte.test.ts` impede
outra chamada direta, que gravaria mais uma linha:

- `carregarCabecalho` é `cache(async (patientId: string)`;
- em `src/app`, só `prontuario.ts` cita `lerCabecalho`;
- o layout lê só por `carregarCabecalho`.

#### Página Início (US-262, US-263)

`InicioPage` (`src/app/painel/pacientes/[id]/page.tsx:49`) carrega três coisas em paralelo (`:55`), cada uma na sua
transação: `iaDoAssistente`, `secoesDoInicio` e `cartaoResumo`. A tela mostra, nesta ordem:

1. O botão **Adicionar** (`:34`). Fica fora para paciente bloqueado ou anonimizado; o arquivado registra, como em cada
   aba (`:29`).
2. O cartão **Resumo** (`:36`).
3. O bloco "Inteligência artificial" da US-120, como estava (`:43`).
4. As seções, numa `<section data-guia="secoes-inicio">` com o `<h2>` "Registros do prontuário" só para leitor de tela
   (`:53`).

A página abre só com a leitura auditada do paciente, de `carregarProntuario`, e a da última antropometria, do layout.
As seções e o cartão não gravam trilha (§2.8.3).

- **Cartão Resumo** (RN-276), `cartaoResumo(ctx, fuso, paciente)` (`resumo.ts:25`), só da sessão `nutri`:
  - "Aniversário: {dia} de {mês}", sem o ano;
  - "Paciente desde {dd/mm/aaaa}", do `created_at` no fuso;
  - "Plano alimentar publicado em {data}" ou "Nenhum plano publicado".

  O plano sai de uma consulta a `meal_plans` com `status = 'publicado'` (RN-01: no máximo um). Sem `auditRead`: as datas
  vêm do paciente que `carregarProntuario` já leu e auditou, e a do plano é só uma data. `linhasDoResumo` (`:53`) monta as
  linhas. No PR 2, a nota "Cadastro incompleto" (RN-269) fica dentro do cartão e o cartão "No app do paciente" ao lado
  dele ([§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)).
- **Seção** (`inicio/secao.tsx:15`, RN-278):
  - `<details>` aberto quando `total > 0`;
  - `<summary>` em `block min-h-11 py-2`, sem `flex`, com o `<h3>` "{Título} ({n})" e a seta em SVG `aria-hidden`;
  - no corpo, até 3 links "{rótulo} · {dd/mm/aaaa} · {situação}" e "Ver todos", com o nome acessível
    "Ver todos: {Título}";
  - seção vazia: "Nenhum registro ainda.".

  Os links das seções e do diálogo usam `prefetch={false}`, porque as páginas de destino gravam `auditRead`. Guardas de
  fonte em `secao.test.ts` e `adicionar.test.ts`.
- **Adicionar** (D15, D25, RN-280), `Adicionar` (`inicio/adicionar.tsx:17`):
  - Botão "Adicionar" com o nome acessível "Adicionar ao prontuário", `aria-haspopup="dialog"` e
    `data-guia="adicionar-prontuario"`.
  - Abre um `<dialog>` nativo por `showModal()`, com o foco no título "Adicionar ao prontuário" (`tabIndex={-1}`). Esc e
    "Fechar" fecham e devolvem o foco ao botão (`onClose`). O diálogo traz a dica "Antes do plano alimentar, registre a
    anamnese, a antropometria e o gasto energético.".
  - `montarAdicionar` (`adicionar.ts:27`) monta os grupos a partir das seções que `secoesDoInicio` devolveu (as
    indisponíveis já saíram) e que têm `podeAdicionar`.
  - Ordem dos itens: dentro de "Avaliações", o roteiro da consulta (`ORDEM_NO_ADICIONAR`, `:16`: Anamnese,
    Antropometria, Gasto energético, Exame, Atendimento); seção de outro plano vem depois, na ordem do registro.
  - Ordem dos grupos: "Avaliações", "Prescrições" e "Outros", cada um só quando tem item.
  - Item `href` relativo vira `/painel/pacientes/{id}/…`; absoluto em `/painel/` fica como está (`caminhoNaFicha`,
    `:19`).
  - Item `acao` vira `<form action>` com a mesma Server Action dos botões da aba Documentos (`criarReceitaAction`,
    `criarParecerAction`). `acoesDoAdicionar` (`inicio/acoes.ts:11`) faz o `bind` ao paciente só das chaves presentes.
- **Foco no destino.** `FocoNaAncora` (`src/components/foco-na-ancora.tsx:10`, cliente) põe o foco no elemento da
  âncora ao montar e a cada `hashchange`. Âncora malformada ou inexistente não faz nada. Está nas abas Antropometria,
  Gasto energético, Exames e Atendimentos, nos `<h2>` `nova-avaliacao`, `novo-calculo`, `novo-exame` e
  `novo-atendimento`, que ganharam `tabIndex={-1}`. Na Anamnese, a âncora `#modelo` é o `<select id="modelo">` que já
  existia: "Adicionar → Anamnese" nunca abre `anamnese/nova` sem modelo, que dá `notFound()`.

#### Registro de seções (D14, RN-277, spec §11)

`SECOES_DA_FICHA` (`secoes/index.ts:15`) é a lista ordenada das seções do Início. Cada seção é uma `SecaoDaFicha`
(`tipos.ts:38`):

| Campo | Contrato |
|---|---|
| `id`, `titulo` | Únicos (guarda `registro.test.ts`); títulos em `MSG_FICHA.titulos` |
| `aba` | Segmento da aba do "Ver todos" (`''` = Início), quando não há `verTodos` |
| `verTodos?(patientId)` | "Ver todos" fora da ficha: caminho absoluto em `/painel/` (ex.: o Financeiro do Plano 20). Resolvido por `verTodosDa` (`inicio.ts:22`) |
| `disponivel(tenant, paciente, total)` | Se a seção aparece. **Monótona no total**: com o total maior, nunca passa de `true` a `false` (`tipos.ts:45-50`). `secoesDoInicio` chama primeiro com `Number.POSITIVE_INFINITY` e pula sem consultar a seção que não apareceria com total nenhum (`inicio.ts:50`); depois confere com o total real (`:52`). O `total` só serve à RN-192 (envios) |
| `resumo(tx, patientId, fuso)` | Contador e os 3 últimos numa consulta (`count(*) over ()` + `limit 3`: `totalJunto` e `LIMITE_DA_SECAO`, `secoes/comum.ts:8,11`); o fuso converte instantes no dia do tenant (`diaNoFuso`, `:14`). Pode devolver `podeAdicionar: false` para esconder o `adicionar` da seção (padrão `true`) |
| `leitura?: { entidade }` | Seção que devolve dado auditado (o Financeiro do Plano 20). `inicio.ts` grava **um** `auditRead` dessa entidade, com `entidadeId: null`, na mesma transação e só quando a seção devolve itens (`inicio.ts:53`). O arquivo da seção nunca chama `auditRead`. Nenhuma das 8 seções do Plano 18 declara `leitura` |
| `adicionar?` | Lista de `{ grupo, rotulo, destino }`: grupo `'avaliacoes' \| 'prescricoes' \| 'outros'` (`tipos.ts:31`; "Outros" só aparece quando alguma seção o usa); destino `{ href }` (relativo à ficha, sem `/` inicial, ou absoluto em `/painel/`) ou `{ acao: ChaveDeAcao }` (`'criar-receita' \| 'criar-parecer'`, `tipos.ts:25,28`) |
| `noApp?` | `contar` e `visiveis` sobre `TxDePaciente` (`tipos.ts:22`, tipo marcado que só `no-app.ts` cria). Implementam (PR 2): `plano-alimentar`, `antropometria`, `atendimentos`, `exames-enviados` e `documentos` |

`secoesDoInicio(ctx, tenant, paciente)` (`inicio.ts:35`):

- Aceita só a sessão `nutri` (`:41`); id malformado devolve `[]` (`:42`).
- Roda **todas** as seções numa transação (`withTenant`), uma consulta por seção.
- Devolve cada seção só com `id`, `titulo`, `aba`, `verTodos` (já resolvido), `resumo` e `podeAdicionar`
  (`SecaoNoInicio`, `:9`).
- Refaz cada item só com as chaves do contrato (`comoItem`, `:12-19`), e uma seção não passa adiante coluna a mais.
  `ItemDaSecao` tem exatamente `id`, `rotulo`, `data` (AAAA-MM-DD no fuso), `situacao?`, `noApp` e `href`
  (`tipos.ts:12`). `secoesDoInicio` devolve `noApp: false`; a página do Início liga o selo nos ids que `noAppDoPaciente`
  achou no contexto do paciente (`secoesComSelo`, `src/app/painel/pacientes/[id]/page.tsx:27`; PR 2).

Sem conteúdo clínico: rótulo genérico, data e situação, nunca o nome do modelo da anamnese nem o do exame, que são dado
de saúde ("Anamnese gestante", "Glicemia"; D14). É o precedente da agenda, da lista de pacientes e das listas de
documentos (P05 D10, 10A D17).

As 8 seções do Plano 18, na ordem do registro:

| `id` (arquivo em `secoes/`) | Título | Item: rótulo · data · situação | Item abre | "Ver todos" | Aparece | Adicionar |
|---|---|---|---|---|---|---|
| `plano-alimentar` | "Plano alimentar" | "Plano alimentar" · publicação ou criação (`coalesce`), no fuso · Rascunho/Publicado/Arquivado; versão mais nova primeiro | `plano-alimentar/{id}` | aba Plano alimentar | sempre | Prescrições: "Plano alimentar" → `plano-alimentar` |
| `antropometria` | "Antropometria" | "Avaliação" · `data` (sem as medidas) | `antropometria` | aba Antropometria | sempre | Avaliações: "Antropometria" → `antropometria#nova-avaliacao` |
| `gasto-energetico` | "Gasto energético" | "Cálculo" · dia do cálculo no fuso | `gasto-energetico` | aba Gasto energético | sempre | Avaliações: "Gasto energético" → `gasto-energetico#novo-calculo` |
| `anamneses` | "Anamneses" | "Anamnese" · `data` (nunca o modelo) | `anamnese/{id}` | aba Anamnese | sempre | Avaliações: "Anamnese" → `anamnese#modelo` |
| `atendimentos` | "Atendimentos" | "Atendimento" · `data` (sem orientações nem notas) | `atendimentos/{id}` | aba Atendimentos | sempre | Avaliações: "Atendimento" → `atendimentos#novo-atendimento` |
| `exames` | "Exames" | "Exame" · `data` (nunca o título) | `exames` | aba Exames | sempre | Avaliações: "Exame" → `exames#novo-exame` |
| `exames-enviados` | "Exames enviados pelo paciente" | "Envio do paciente" · dia do envio no fuso · Processando/Aguardando revisão/Aceito/Recusado/Expirado/Falhou; fora o cancelado e nada do titular bloqueado ou anonimizado | `/painel/exames-recebidos/{id}` em recebido, aceito e recusado; a aba Exames nas outras (`ABRE_A_REVISAO`, `exames-enviados.ts:14`) | aba Exames | titular nem bloqueado nem anonimizado (como a fila de exames recebidos) e recebimento ligado (`examesPacienteAtivadoEm`) ou algum envio (RN-192) | — |
| `documentos` | "Documentos" | `TIPO_DOCUMENTO_ROTULO` ("Receita"/"Parecer nutricional") · dia da criação no fuso · `ROTULO_STATUS` | `documentos/{id}` | aba Documentos | só com `documentosLiberados` (D20 do 10A) | Prescrições: "Receita" (`criar-receita`) e "Parecer nutricional" (`criar-parecer`) |

**Pendurar uma seção nova** (spec §11; o Financeiro do Plano 20 é o primeiro uso previsto):

1. Crie `src/modules/ficha/secoes/<id>.ts` exportando uma `SecaoDaFicha`, com rótulos genéricos e sem conteúdo clínico.
   O arquivo só importa o que está em `IMPORTS_PERMITIDOS` (`registro.test.ts`). Import novo entra na lista de propósito,
   com a revisão vendo, e nunca é helper que audite por padrão.
2. Acrescente **uma linha** no fim de `SECOES_DA_FICHA`, sem reordenar as outras. Os testes do Plano 18 filtram as 8
   dele por `test/ficha.ts` (`DO_PLANO_18`, `SECOES_DO_PLANO_18`), e a seção nova não os quebra.
3. Dado auditado: declare `leitura: { entidade }` (a entidade também em `ENTIDADE_ROTULO`). Nunca chame `auditRead` no
   arquivo.
4. Se a seção cria registro, preencha `adicionar`. Ação nova (não link) pede uma chave nova em `ChaveDeAcao` e a entrada
   em `ACOES` de `inicio/acoes.ts`.
5. Se o paciente vê aquilo no app, implemente `noApp`, contado no contexto de paciente (o `TxDePaciente` que
   `noAppDoPaciente` passa), e o caso de paridade em `src/modules/ficha/no-app.test.ts`. A seção não abre o contexto
   sozinha nem escreve a palavra do contexto sem login (a guarda `sem-conta-guarda.test.ts` lê os comentários também).

Fora disso, é mudança de contrato, decidida com a orquestradora e o `revisor-rls`.

Testes: `src/modules/ficha/secoes.test.ts` (Testcontainers) cobre:

- chaves exatas;
- contador e 3 últimos, com os desempates;
- conteúdo clínico ausente;
- nenhum `audit_log` gravado pelas 8 seções;
- a `leitura` de uma seção de teste;
- Documentos desligados;
- a RN-192;
- outro tenant e papel.

`cabecalho.test.ts` e `resumo.test.ts` cobrem o cabeçalho e o cartão. A guarda de fonte `registro.test.ts` cobre a
ordem, os ids, um arquivo por seção, nenhum `auditRead`, a lista fechada de imports e os destinos (§7.4.3).

### 4.2.11 Cadastro complementar, lista e "No app do paciente" (Plano 18, PR 2)

PR 2 do Plano 18 (Tarefas 5–12c; spec v0.3, US-260, US-261, US-264, RN-260 a RN-284), conferido no branch local
`plano-18-pr2` em `3799409` (17/11/2026), antes da revisão final e do rebase. Migrations `0124_patient_cadastro` (gerada)
e `0125_rls_patient_cadastro` (custom), geradas de novo sobre a `main` (procedimento da seção "Migration" do plano):
se outra migration entrar antes do merge, os números mudam.

#### Cadastro complementar (`patient_cadastro`, D1, RN-260 a RN-265)

Os campos de identificação da Res. CFN 594/2017 (art. 4º, § 1º, I) que não estavam em `patients` (nome social, a pedido;
identidade de gênero, estado civil, escolaridade, ocupação, nacionalidade, naturalidade, telefone fixo e endereço) e
mais o CPF e a observação, que a resolução não lista (decisão do produto: identificar sem engano e anotar o que o paciente
pode receber na cópia dos dados), ficam numa tabela filha, uma linha por paciente ([§2.5.4](02-banco-de-dados.md#254-prontuário-pacientests); proteção na matriz da §2.5.1).

| Peça | O que faz | Onde |
|---|---|---|
| `CAMPOS_DO_CADASTRO`, `CadastroComplementar` | Os 17 campos, na ordem do formulário (`telefoneFixo` ↔ `telefone_fixo_e164`) | `cadastro.ts:42`, `:67` |
| `validarCadastro` / `formaDoCadastro` | As regras dos CHECKs da tabela, numa fonte só: o `pacienteSchema` usa `formaDoCadastro` (zod) e `gravarCadastro` passa os valores de novo por `validarCadastro` antes de gravar — o 23514 levaria a linha inteira ao log do Postgres. Listas fechadas e rótulos em `cadastro-textos.ts` (sem banco: o formulário cliente importa de lá) | `cadastro.ts:181`, `:210`; `cadastro-textos.ts:19` |
| `normalizarCpf`, `cpfValido`, `formatarCpf` | Só os 11 dígitos; dígitos verificadores (rejeita os 11 iguais); "000.000.000-00" | `cpf.ts:8`, `:21`, `:27` |
| `gravarCadastro(tx, …)` | Na transação de `criarPaciente`/`atualizarPaciente` (o paciente já travado ou recém-criado). Só os campos **enviados** mudam: chave ausente mantém o gravado; `''`/`null` esvazia. A linha só nasce com algum campo preenchido (*upsert* em `(tenant_id, patient_id)`); depois, esvaziar tudo grava nulo | `cadastro.ts:287` |
| `conferirCpf` (D23, RN-261) | Antes do INSERT, `pg_advisory_xact_lock(hashtext('patient_cadastro_cpf'), hashtext(tenant_id || ':' || cpf))` e a busca do outro paciente do consultório com o mesmo CPF: dois cadastros iguais ao mesmo tempo se enfileiram e o segundo acha o primeiro. Repetido → `CpfRepetidoError` com `outroId` (nulo quando o outro está bloqueado ou anonimizado: sem link). O índice único `patient_cadastro_cpf_unico` é só a última defesa (o 23505 levaria o CPF ao log) | `cadastro.ts:269-278`, `:214` |
| `cadastroDoPaciente(ctx, id)` | **O único lugar que lê os valores** (D20): a aba Perfil. Grava `auditRead` (entidade `patients`, `entidade_id` = id da linha de `patient_cadastro`, "Cadastro do paciente"); sem linha, `null` sem auditar | `cadastro.ts:321` |

Regras de exibição (D4, RN-262): o CPF só aparece no campo do Perfil/Novo paciente e no `dados.json`. Nunca na lista, no
cabeçalho, no Início, no "No app", no `prontuario.pdf`, em URL, em log (da aplicação e do Postgres), no Sentry, em
mensagem, e-mail, push ou WhatsApp; nenhuma mensagem de erro repete o valor digitado (`MSG_CADASTRO`). Teste "nada do
cadastro em log nem no Sentry (RNF-262)" em `cadastro.test.ts:437` (logger espiado; `filtrarEvento` e
`filtrarBreadcrumb` de `src/lib/sentry-filtro.ts`, sem mudança no filtro).

Trilha (regra 8): o gatilho grava as escritas como entidade `patients`. Como o `entidade_id` é o id da linha do
cadastro (≠ titular), o `criar` dela aparece no Histórico de acessos como "Alterou" (`rotuloDaAcao`,
`src/modules/plataforma/audit.ts`): criar o paciente com cadastro não mostra dois "Criou", e o primeiro preenchimento de
um paciente antigo não parece um cadastro novo. O "Excluiu" de ator nulo da anonimização continua "Excluiu".

**Formulário em seções** (`src/app/painel/pacientes/paciente-form.tsx`, US-260, spec §8.4): o mesmo formulário em
"Novo paciente" e no Perfil, com `fieldset`/`legend` e o `<h2>` de cada seção — "Dados gerais", "Contato e endereço" (o
endereço num `fieldset` "Endereço (opcional)") e "Observação"; no Perfil vêm depois "Acesso ao app" e "Etiquetas". Os
rótulos mudaram: "Nome completo", "Celular / WhatsApp (opcional)", "Nome social (opcional)" etc. (`MSG_CADASTRO.rotulos`).
Erros por campo com `aria-describedby` e, com o formulário longo, "Revise os campos marcados." junto do botão e o foco
no primeiro campo com erro. CPF repetido: "Já existe um paciente com este CPF neste consultório." e o link "Abrir o
cadastro existente (abre em nova aba)" (só com `outroId`); o digitado continua no campo. A Observação traz o aviso de
que vai na cópia dos dados do titular (D3) e o contador "{n} de 1.000 caracteres". O agendamento público continua sem
os campos novos.

**Nome social** (D7, RN-266):

- Tela da ficha: o `<h1>` mostra o nome social e, abaixo, "Nome de registro: {nome}" (`layout.tsx:36-50`).
- Impressão: o nome civil no `<h1>` e "Nome social: {nome social}" logo depois (classes `print:`; Res. CFN 594/2017,
  art. 4º, § 1º, I). O mesmo vale para o `prontuario.pdf` (§4.2.9). Teste em `impressao.test.ts`.
- Lista: só o nome exibido (o social, quando há); a busca procura nos dois; a ordem é pelo nome exibido.
- Privacidade: com nome social, a confirmação do pedido de exclusão pede o **nome de registro** e o mostra
  (`MSG_LGPD.confirmarNomeDeRegistro`, `lgpd.ts:51`; `privacidade/page.tsx:132`), porque a conferência é com
  `patients.nome`.
- IA: entra só na máscara ([§10.13.1](10-ia.md#10131-o-que-sai-e-a-pseudonimização-d8d11-rn-115-rn-120)).

#### Lista de pacientes (US-261, RN-270 a RN-273)

`src/app/painel/pacientes/page.tsx` (textos em `textos.ts`, `MSG_LISTA`):

- Abas "Ativos", "Inativos" (os arquivados, com a dica "Pacientes arquivados: sem acesso ao app e sem notificações. O
  prontuário continua guardado.") e "Todos"; o link "Ver bloqueados" (`?situacao=bloqueados`) abre os bloqueados por
  pedido de exclusão, só para consulta. Os links antigos `?status=arquivado` e `?status=bloqueado` continuam valendo
  (`filtroDaUrl`).
- "Ordenar por": "Nome (A–Z)", "Nome (Z–A)", "Mais recentes", "Mais antigos" — trocar a ordem mantém a busca, a aba e a
  etiqueta.
- Colunas "Nome", "Idade", "E-mail", "Acesso ao app" (`situacoesDoAcesso`, uma consulta só), "Desde" (a data do
  cadastro) e "Ações". Nada do cadastro complementar além do nome social.
- Menu "Ações de {nome}" por linha (`menu-da-linha.tsx:26`, disclosure com `aria-expanded`/`aria-controls`): "Abrir
  ficha", "Editar cadastro", "Arquivar" ou "Reativar" e "Pedir exclusão (LGPD)" (só leva à aba Privacidade). Esc e o
  clique fora fecham; o foco que sai do menu também fecha, sem voltar ao botão.
- Arquivar e reativar pela lista (`arquivarDaListaAction`/`reativarDaListaAction`, `actions.ts:107,111`; D26): as mesmas
  funções da aba Privacidade (arquivar apaga os convites pendentes), com a confirmação do navegador; a volta é para a
  mesma lista, montada no servidor, com `ok` e um marcador `r` novo a cada ação, e a região `role="status"` (sempre
  montada acima da tabela) anuncia "Paciente arquivado." ou "Paciente reativado." com o foco no título. Paciente
  bloqueado: nada muda.

#### Início: nota "Cadastro incompleto", cartão e selo "No app" (RN-269, RN-276, RN-279)

`InicioPage` (`src/app/painel/pacientes/[id]/page.tsx:49`) passou a carregar, junto com as seções, o cartão Resumo e a
IA, a nota "Cadastro incompleto" e o "No app do paciente":

- **Nota "Cadastro incompleto"** (`src/modules/ficha/incompleto.ts`): `presencaDoCadastro` (`:19`) lê só expressões
  `campo is not null` (nunca o valor; D20) da lista fechada — data de nascimento, sexo, identidade de gênero, estado
  civil, nacionalidade, naturalidade, escolaridade, ocupação, endereço (CEP, rua, número, bairro, cidade e UF; o
  complemento não conta) e telefone (celular ou fixo). Nome social, CPF e observação ficam fora. `textoDoIncompleto`
  (`:44`): até 3 itens, "Cadastro incompleto: faltam {itens}." (vírgula e "e"); 4 ou mais, "Cadastro incompleto: faltam
  {n} dados.". Sem `auditRead`. A nota fica dentro do cartão Resumo, com o link "Completar no Perfil"
  (`prefetch={false}`: o Perfil audita), e não aparece para bloqueado nem anonimizado (`page.tsx:54`).
- **Cartão "No app do paciente"** (`inicio/cartao-no-app.tsx:43`): o acesso ("Acesso: ativo · último acesso em
  {data}" ou o convite), o plano publicado, os documentos (só com `documentosLiberados`) e os conteúdos, com "Ver
  detalhes" para a página `/app`.
- **Selo "No app"** nos itens das seções que o paciente vê (`secoesComSelo`, `page.tsx:27`): os ids que
  `noAppDoPaciente` achou no contexto do paciente; nunca reproduzido na sessão `nutri`. Com "Não mostrar peso no app", a
  seção Antropometria diz "Peso e IMC ocultos no app." (`page.tsx:100`).
- Se o "No app" falhar, o Início abre sem o cartão e sem o selo; o log leva só o nome do erro (`page.tsx:30-36`).

#### "No app do paciente" (US-264, D16, D24, RN-279, RN-281)

`noAppDoPaciente(ctx, patientId, itens?)` (`src/modules/ficha/no-app.ts:84`) diz o que o paciente vê hoje no app,
contado com as regras do próprio app. Só a sessão `nutri` chama (`:90`). Três passos:

1. **Sessão `nutri`, uma transação** (`:95`): confere que o paciente é do consultório. Arquivado, bloqueado ou
   anonimizado param aqui: só a linha do acesso, nada mais é lido (`semAcesso`, `:58`; minimização, LGPD art. 6º, III).
   Com o paciente ativo: as marcas de peso oculto, WhatsApp e pausa dos lembretes; o % de gordura e a IA Nutri do
   consultório; o último dia de acesso (`access_events`); os aparelhos com push; a participação na IA Nutri; o plano
   publicado com a data, a lista de compras (a regra de `listaDoPlano`) e as **receitas sugeridas** (D24: contadas aqui,
   porque a liberação das receitas do plano é só do "Meu plano" do portal); os lembretes do Plano 17 (só as marcas
   ligado/desligado pelo paciente, nunca o texto).
2. **Situação do acesso** (`situacaoDoAcesso`): ativo, convite pendente (com "Vale até …"), expirado ou sem convite.
3. **Contexto do paciente sem login** (`comoPaciente`, `:41`, só com o paciente ativo e com conta): para cada seção com
   `noApp`, `contar` e, para os ids pedidos, `visiveis`; os conteúdos publicados que a audiência deixa ver (a política
   `paciente_conteudo_visivel` e a etiqueta decidem); o diário dos últimos 30 dias. O contexto e as travas estão na
   [§3.8](03-autenticacao-e-acesso.md#38-sessão-do-paciente-vínculos-nd_vinculo-e-contexto-conta).

Devolve só números, datas, ids e marcas (`NoApp`, `:14`); nenhuma leitura é registrada no `audit_log` (o que sai não é
dado de saúde). As seções com `noApp`: `plano-alimentar` (publicado), `antropometria`, `atendimentos`,
`exames-enviados` (não cancelado) e `documentos` (a RLS `paciente_so_emitidos`), todas por `noAppPor`
(`secoes/comum.ts:26`).

A página `/painel/pacientes/[id]/app` (`app/page.tsx:56`, textos exatos da spec §8.5 em `MSG_NO_APP`,
`src/modules/ficha/textos.ts:115`) mostra uma linha por assunto: Acesso, Notificações, Plano, Lembretes, Evolução,
Jornada, Documentos (com a liberação), Conteúdos, Exames (com o recebimento ligado), Diário e IA Nutri. Sem acesso, só a
linha do acesso; sem conta ainda, o que a nutricionista configurou, sem as contagens. Está na aba Início (`DO_INICIO`)
e o guia é o do `prontuario`.

**Testes.** `src/db/patient-cadastro.test.ts` (público, paciente com login, contexto sem login, gatilhos, auditoria,
CPF e CHECKs), `src/modules/pacientes/cpf.test.ts`, `cadastro.test.ts` (corrida de duas conexões sem 23505, log e Sentry
sem o valor, `outroId`, as leituras: `buscarPaciente` só com `nomeSocial`), `pacientes.test.ts` (abas, ordens, busca
pelo nome social, chaves do item da lista, `filtroDaUrl`),
`src/modules/ficha/incompleto.test.ts`, `no-app.test.ts` (paridade com o portal num cenário só: conteúdo por etiqueta,
receita fora da audiência, plano arquivado, documento cancelado e de anonimizado, envio cancelado, peso oculto, diário
dentro e fora dos 30 dias, paciente arquivado; CS-261), `no-app-fonte.test.ts` (guardas de fonte), os testes de página
(`page.test.ts`, `perfil/page.test.ts`, `app/page.test.ts`, `privacidade/page.test.ts`, `impressao.test.ts`,
`menu-da-linha.test.ts`, `actions.test.ts`, `valores.test.ts`) e o E2E `e2e/cadastro.spec.ts`
([§7](07-testes-qualidade-e-processo.md)).

### 4.2.12 Exames do consultório: catálogo, edição com versão, nota e comparativo (Plano 22, PR 2)

Conferido no branch `plano-22-exames-prescricao` em `829b0a7` (Tarefas 3 a 5b, 23/11/2026), com o PR 1 (#58: banco,
regras puras e `Dialogo`) ainda fora da `main`. Spec: `docs/superpowers/specs/2026-11-17-nutridebby-22-exames-prescricao-design.md`;
decisões EP-Dxx na §14.1 da spec e na tabela "Decisões" do plano `docs/superpowers/plans/2026-11-17-nutridebby-22-exames-prescricao.md`.
O banco está na [§2.5.13](02-banco-de-dados.md#2513-exames-do-consultório-e-filhas-do-exame-exames-catalogots-exames-filhasts-plano-22).

**Módulo `src/modules/exames/`.** As regras puras (`catalogo-regras.ts`, `classificacao.ts`, `constantes.ts`) vieram no PR 1;
o PR 2 acrescenta `catalogo.ts`, `modelos-solicitacao.ts`, `edicao.ts`, `detalhe.ts`, `interpretacao.ts` e `comparativo.ts`.
Regras comuns:

- Só a sessão `nutri`: toda função começa por `exigirNutri(ctx)` (`catalogo.ts:29`), **antes** da transação. As quatro
  tabelas são `staff_only`, e numa sessão de paciente a leitura voltaria vazia em silêncio (RN-370).
- Nada depende de `documentos_liberados` (EP-D35): catálogo, faixas, modelos, classificação, nota, edição e comparativo
  valem para todo consultório.
- O que lê ou grava a nota e as versões (`detalhe.ts`, `edicao.ts`, `interpretacao.ts`) fica **fora** de
  `src/modules/pacientes/exames.ts`, que `ia/conferencia.ts` importa (EP-D62, RN-399; guarda na
  [§10.15](10-ia.md#1015-exames-do-consultório-fora-da-ia-plano-22-rn-399)).
- Toda leitura de um exame é pelos **dois** ids (exame e paciente): sem linha → `null`, nenhum `auditRead` e 404 na tela
  (a trilha nunca atribui a leitura ao titular errado).
- Nomes, valores, faixas, notas e justificativas nunca vão a log, Sentry ou mensagem técnica de erro (RNF-370; guarda em
  `src/modules/exames/log.test.ts`: força erros em `editarExame`, `salvarNota`, `salvarExameDoCatalogo` e
  `salvarModeloSolicitacao` e confere o logger e o `beforeSend` de `src/lib/sentry-filtro.ts`).
- Textos em `MSG_EXAMES` (`constantes.ts:120`); os marcados "Texto novo … Rascunho para a Debby" não estão na §6.2 da spec
  (divergência #20).

#### Telas e rotas

| Tela | Rota | Lê por | Guia |
|---|---|---|---|
| Catálogo de exames | `/painel/exames/catalogo` (h1 "Catálogo de exames"; colunas "Exame · Unidade · Faixas · Ação"; "Novo exame" e o diálogo "Nomes de exames para começar (você escolhe o que usar)") | `listarCatalogo`, `nomesParaComecarFaltando` | `exames-do-consultorio` |
| Exame do catálogo | `/painel/exames/catalogo/novo` (h1 "Novo exame do catálogo"), `/painel/exames/catalogo/[id]` (h1 = nome) | `abrirExameDoCatalogo` | `exames-do-consultorio` |
| Modelos de solicitação | `/painel/exames/modelos`, `/novo` (h1 "Novo modelo de solicitação"), `/[id]` | `listarModelosSolicitacao`, `abrirModeloSolicitacao` | `exames-do-consultorio` |
| Aba Exames (já existia) | `/painel/pacientes/[id]/exames` | `listarExames` e `bibliotecasParaExames` (catálogo e modelos numa transação, lidos uma vez; também com o paciente bloqueado, só para classificar) | `prontuario` (v4) |
| Detalhe do exame | `/painel/pacientes/[id]/exames/[exameId]` (h2 "{título} — {dd/mm/aaaa}") | `abrirExame` | `prontuario` |
| Editar exame | `…/[exameId]/editar` (h2 "Editar exame") | `exameParaEditar` | `prontuario` |
| Versões anteriores | `…/[exameId]/versoes` (h2 "Versões anteriores") | `versoesDoExame` e `notasAnteriores` | `prontuario` |
| Comparativo | `…/exames/comparativo?ids=…` (h2 "Comparativo de exames") | `comparativo` | `prontuario` |

As telas da ficha usam h2 porque o h1 do prontuário é o nome do paciente (divergência #24). O hub `/painel/exames` tem um
layout próprio (`src/app/painel/exames/layout.tsx`) com o link "Configurações" e a navegação "Seções de exames"
("Catálogo · Modelos de solicitação", `aria-current="page"`, `secoes.tsx`). Entrada pelo cartão "Exames" ("Catálogo de
exames, faixas do consultório e modelos de solicitação."), no fim de `CARTOES` (`src/app/painel/configuracoes/page.tsx:20`);
`/painel/exames` no fim de `DO_HUB` (`src/app/painel/navegacao.ts:29`, EP-D51), que marca "Configurações" no menu (o
`/painel/exames-recebidos` não casa: `dentro()` exige a `/`). Nenhum item de menu nem aba nova (EP-D33). As oito rotas estão
em `ROTAS_DO_PAINEL` (`e2e/painel-rotas.ts`), com os ids `exameCatalogo`, `modeloSolicitacao`, `exame` e `exameComparar`
criados pela UI em `e2e/painel.ts`.

#### Catálogo de exames (US-370, RN-370 a RN-375)

| Função | O que faz | Onde |
|---|---|---|
| `listarCatalogo`, `abrirExameDoCatalogo` | Ordem `lower(nome)`; id inválido → `null` | `catalogo.ts:38`, `:43` |
| `catalogoParaLancamentoNaTransacao(tx)`, `catalogoParaDetalheNaTransacao(tx)` | O catálogo na transação de quem chama, uma leitura por tela (RNF-371); o do detalhe também com os modelos de nota | `:51`, `:68` |
| `salvarExameDoCatalogo(ctx, tenant, id, input)` | Cria (`id` nulo) ou altera, sob a trava `pg_advisory_xact_lock(hashtextextended('exames_catalogo:<tenant>', 0))` (`travarCatalogo`, `:34`), a mesma de `adicionarNomesParaComecar`. Valida por `validarExameDoCatalogo` (`catalogo-regras.ts:150`) e recusa: o 501º exame ("O catálogo chegou ao limite de 500 exames."); o nome ou outro nome que já é nome ou outro nome de outro exame, normalizado por `normalizarNome` ("Já existe um exame com este nome ou com um destes outros nomes: {nome}."); a troca da unidade com faixas gravadas, também ao apagá-la ("Remova as faixas antes de trocar a unidade.", RN-374). `atualizadaEm` = hoje no fuso do consultório só na faixa nova ou mudada. O 23505 do índice do nome vira a mesma mensagem. A mensagem técnica do nome repetido é fixa (`CatalogoError(erros, tecnica)`): o nome fica só no campo da tela, nunca na mensagem nem na pilha | `:112` |
| `excluirExameDoCatalogo` | `DELETE` simples: exames, modelos e documentos guardam cópia do nome, sem FK, e não mudam (RN-371) | `:179` |
| `nomesParaComecarFaltando`, `adicionarNomesParaComecar(ctx, nomes)` | RN-372: só os nomes de `NOMES_PARA_COMECAR` e `PAINEIS_PARA_COMECAR` (`constantes.ts`), sem unidade, faixa nem nota; texto que não é da lista é ignorado; nome já presente é pulado, e o outro nome em uso sai do exame novo; passando de 500, nada é gravado. Retorno "1 exame adicionado ao catálogo." / "{n} exames adicionados ao catálogo." | `:194`, `:207` |

O formulário do exame do catálogo (`src/app/painel/exames/catalogo/exame-catalogo-form.tsx`) tem "Nome", "Unidade
(opcional)", "Outros nomes (opcional)", "Exames que compõem este (opcional)", as "Faixas do consultório" ("Sexo do
cadastro", "Idade de … até … anos", "A partir de", "Abaixo de", "Categoria", "Fonte", "Acrescentar faixa", "Remover faixa")
e os "Modelos de nota de interpretação" ("Quando o resultado está abaixo da referência" / "acima"), com a linha fixa
"Escreva fatores a investigar e encaminhamentos; não afirme doença." e o aviso "Retire dados do paciente antes de salvar.".
A plataforma não traz faixa pronta: o catálogo nasce vazio ("Seu catálogo ainda está vazio.").

#### Modelos de solicitação (US-376, RN-391)

| Função | O que faz | Onde |
|---|---|---|
| `salvarModeloSolicitacao(ctx, id, input)` | Nome em uma linha, 1–80; exames por `validarListaDeExames(…, { max: 40, para: 'modelo' })` (`src/modules/documentos/solicitacao.ts`, PR 1); orientações ≤ 1000 por `textoLivre`. Qualquer outra chave (a indicação clínica) é ignorada; o 23505 do índice vira "Já existe um modelo com este nome." | `modelos-solicitacao.ts:91` |
| `bibliotecasParaExames(ctx)` | Catálogo e modelos numa transação (aba Exames; editor da solicitação no PR 4) | `:70` |
| `exameDosModelos(ctx, modeloId)` | Os exames como estão (o painel conta como um, para a solicitação) e as `linhas` para a análise por `expandirParaAnalise` (`catalogo-regras.ts:190`: o painel vira uma linha por componente, com a unidade do exame do catálogo que casar; um nível só, RN-373) | `:131` |
| `listarModelosSolicitacao`, `abrirModeloSolicitacao`, `excluirModeloSolicitacao` | Ordem `lower(nome)`; excluir não muda solicitação já feita ("Excluir o modelo {nome}? As solicitações já feitas não mudam.") | `:56`, `:83`, `:119` |

#### Lançar do catálogo (US-371, RN-376, RN-377)

`lerLinhasComErros(bruto)` (`src/modules/pacientes/exames.ts:56`) é a leitura das linhas no lançamento e na edição:

- erro por campo (`valores.{i}.nome`, `.valor`, `.unidade`, `.referencia`, `.refMin`, `.refMax`; `valores` para a lista
  inteira); a linha só é ignorada sem nome, valor, "de" e "até" (uma linha só com faixa vira erro, nunca some);
- limites por `lerDecimal` (finitos, |x| < 10¹⁵: "Faixa inválida. Use só números, como 70 ou 4,5."; `refMin ≤ refMax`: "O
  início da faixa deve ser menor ou igual ao fim.");
- sem referência e com faixa, grava `referencia = referenciaDaFaixa(refMin, refMax)` (`classificacao.ts:155`: "70 a 99",
  "até 200", "a partir de 30"), para os leitores que só leem `referencia` (parecer, exportação);
- `iaTarefaId` do formulário sempre ignorado.

`lerValoresComErros` (`:99`) e `lerValores` (`:105`) são os envoltórios; `criarExame` (`:117`) devolve os erros por campo.
No "Novo exame" (`exame-form.tsx` e `linhas-do-exame.tsx`): "Adicionar do catálogo" (`src/app/painel/exames/escolher-do-catalogo.tsx`:
"Buscar no catálogo", "Selecionar todos", "Adicionar {n} exames"; o painel entra expandido), "Carregar modelo de
solicitação", "Remover todos" (com a confirmação "Remover todas as linhas deste exame? Nada muda até você salvar."), a faixa
por linha ("Faixa do laudo: de {n}" e "até {n}", com a ajuda "Copie a faixa impressa no laudo."), o botão "Usar {a} a {b}"
quando `sugerirFaixa` (`classificacao.ts:137`) acha um único padrão no texto da referência (só por botão, RN-377), o aviso
"A faixa numérica não bate com o texto da referência. Confira no laudo." (`faixaDiverge`, `:168`) e a classificação neutra
já antes de salvar. O catálogo e os modelos chegam ao formulário só com nome, unidade, outros nomes, componentes e faixas.

#### Editar com versão (US-371, RN-378, EP-D21, EP-D41, EP-D44)

| Função | O que faz | Onde |
|---|---|---|
| `exameParaEditar(ctx, patientId, exameId)` | O exame pelos dois ids e o catálogo numa transação, com `auditRead` (`exames`) | `edicao.ts:44` |
| `editarExame(ctx, tenant, patientId, exameId, input)` | Valida antes da transação: título, data (não futura), linhas (`lerLinhasComErros`) e justificativa (5–500 *code points*, como o `char_length` do CHECK, sem NUL). Travas na ordem da conferência da IA e de `excluirExame`: paciente (`carregarPacienteParaEscrita`) → exame `FOR NO KEY UPDATE` pelos dois ids. Concorrência otimista: `lidoEm` (o `updated_at` lido, em `toISOString()`) comparado em TypeScript, porque o banco guarda microssegundos ("O exame mudou desde que você abriu. Recarregue a página."); sem mudança, "Nada foi alterado."; sem justificativa, "Informe a justificativa da alteração (de 5 a 500 caracteres).", salvo quando a edição só acrescenta linhas. **Origem da IA:** o formulário manda só `origem` (o índice da linha gravada); sob a trava, o módulo copia `iaTarefaId` de `e.valores[origem]` e mantém nome, valor e unidade da original (só faixa e referência mudam; a tela diz "Marcador, valor e unidade vieram do laudo e não mudam. Para corrigir, remova a linha e lance outra." e mantém "IA · conferido em {data}"). Na mesma transação: `INSERT` em `exam_versoes` com o estado de antes (`versao` = maior + 1; autor e hora pelo gatilho) e `UPDATE` de `exams` com `updated_at` estritamente depois do lido (`:162`). O laudo não muda (EP-D44) | `:88` |
| `versoesDoExame(ctx, patientId, exameId)` | O exame e as versões pelos dois ids, da mais nova para a mais antiga; `auditRead` (`exames_versoes`, `entidade_id` = id do exame) sempre que o exame é achado (o título e a data saem mesmo sem versão; code review do PR 2); o nome do autor por `nomesDosAtores` (`src/modules/plataforma/audit.ts:228`), **fora** da transação, como o Histórico de acessos ("Usuário removido" sem conta) | `:176` |

A Server Action `editarExameAction` (`src/app/painel/pacientes/[id]/exames/actions.ts`) volta à aba com
`?editado={id}#exame-salvo`: "Exame salvo." aparece no próprio exame e recebe o foco. "Versões anteriores" mostra "Versão
{n} — {data}, por {nome}", "Justificativa: {texto}" ou "Só acrescentou linhas (sem justificativa).", e "Este exame ainda
não foi editado." sem versão. Com `mostrar_no_app_em` preenchido, a edição avisa "Este exame está no app do paciente. O que
você salvar aparece lá na hora." e o "Excluir" do detalhe, "Este exame está no app do paciente. Ao excluir, ele some de
lá." (a marca só passa a ser gravada no PR 3). No Histórico, cada edição deixa "Alterou · Exames" e "Criou · Versões do
exame".

#### Detalhe, classificação e "Ver referência" (US-372, RN-379 a RN-382, EP-D11 a EP-D17)

- `abrirExame(ctx, patientId, exameId)` (`detalhe.ts:53`): numa transação, o exame pelos dois ids, o sexo, o nascimento e
  a conta do paciente (de `patients`, nunca a identidade de gênero de `patient_cadastro`, EP-D13), a nota em vigor (a de
  maior versão), o catálogo (uma leitura) e um `auditRead` (`exames`). A classificação é calculada depois, em memória.
- `classificarLinha(linha, indice, paciente, data)` (`classificacao.ts:109`), um casamento por linha com o índice montado
  uma vez (`indiceDoCatalogo`, `:37`): a neutra (`classificarNeutra`, `:24`: abaixo de `refMin`, acima de `refMax`, senão
  "Dentro da referência" com ao menos um limite; limites do laudo inclusivos; sem limite, nada), a categoria do consultório
  (só com casamento único pelo nome ou outro nome normalizado, `casarComCatalogo`, `:54`; a mesma unidade por
  `normUnidade`; sexo e nascimento no cadastro; idade ≥ 1 na data do exame; faixa que contém o valor) e o exame do
  catálogo que casou. Nada é gravado (EP-D11): mudar a faixa do consultório muda a categoria mostrada nos exames antigos,
  com a data da faixa (`exames-detalhe.test.ts:126`).
- Tabela (`TabelaClassificada`, `src/app/painel/pacientes/[id]/exames/tabela-classificada.tsx:59`), na lista e no
  detalhe: "Marcador · Valor · Referência do laudo · Classificação · Ver referência"; a categoria ao lado da neutra, com
  "(faixa do consultório)"; antes da tabela e ligados por `aria-describedby`, "Classificação automática pela faixa de
  referência informada. Não é diagnóstico." e, com categoria, "As faixas do consultório não consideram gestação." (na
  lista, uma vez para todos os exames); `caption`, `th scope` e a região rolável focável com o contorno para dentro
  (`src/app/painel/cores.test.ts`).
- "Ver referência" (`ver-referencia.tsx`, RN-382; nome acessível "Referência de {marcador}"): "Referência do laudo: …",
  "Faixa do laudo: …" e, com casamento, as "Faixas do consultório" (`textoDaFaixaDoConsultorio`, `classificacao.ts:190`:
  "{público}, {idade}: {limites} — {categoria}" e "Fonte: {fonte} · atualizada em {dd/mm/aaaa}"); "Sem referência." sem
  nada. Na lista, no detalhe e nas linhas do lançamento e da edição — não no comparativo (divergência #21).
- Detalhe (`[exameId]/page.tsx`): "Voltar aos exames", "Editar", "Versões anteriores", "Baixar laudo" (URL assinada) e
  "Excluir" (`DialogoConfirmar`; `excluirExameDoDetalheAction` volta à aba); exame sem linhas, "Nenhum valor lançado neste
  exame."; paciente bloqueado, só leitura.
- RNF-371: com 500 exames no catálogo e 50 exames × 50 linhas, a aba lê o catálogo uma vez e `abrirExame` responde em
  menos de 800 ms no Testcontainers (`src/modules/exames/exames-detalhe.test.ts:172`, contando as consultas a
  `exames_catalogo` num `db` instrumentado).

#### Nota de interpretação (US-373, RN-383, EP-D18, EP-D19, EP-D61)

| Função | O que faz | Onde |
|---|---|---|
| `salvarNota(ctx, patientId, exameId, texto)` | Texto sem NUL, de 1 a 2000 *code points* ("Escreva a nota antes de salvar.", "A nota tem no máximo 2000 caracteres."). Travas: paciente (`carregarPacienteParaEscrita`, recusa bloqueado e anonimizado) → exame `FOR NO KEY UPDATE` pelos dois ids (sem linha, "Exame não encontrado.", em vez do 23503 cru com um `excluirExame` concorrente) → `INSERT` com `versao` = maior + 1. Nunca `UPDATE` | `interpretacao.ts:75` |
| `apagarNota(ctx, patientId, exameId)` | As mesmas travas; com nota em vigor, uma versão nova com `texto` nulo **e** `recordAudit({ acao: 'excluir', entidade: 'exames_nota', entidadeId: exameId })` na mesma transação; sem nota em vigor, nada é gravado | `:94` |
| `notasAnteriores(ctx, patientId, exameId)` | As versões antes da em vigor, da mais nova para a mais antiga (`texto` nulo = um "Apagar nota", "A nota foi apagada nesta versão."), com o autor por `nomesDosAtores`; `auditRead` (`exames_nota`) só quando há | `:117` |

Tela (seção "Nota de interpretação" do detalhe, `nota-form.tsx`): a linha fixa "Escreva fatores a investigar e
encaminhamentos; não afirme doença.", a ajuda "Não aparece no app; entra na cópia dos dados que o paciente pedir.",
"Inserir modelo" (os modelos de nota dos exames com neutra "Abaixo"/"Acima" que casam com o catálogo, rótulo "{exame} —
abaixo|acima", RN-375; sem nenhum, "Nenhum modelo para os exames fora da referência."), "Salvar nota" e "Apagar nota". O
retorno "Nota salva."/"Nota apagada." é anunciado e leva o foco ao título (`RetornoDaTela`). A nota nunca vai ao app, ao
PDF, à IA nem ao comparativo; sai só no `dados.json` ([§4.2.9](#429-exportação-zip-us-018-us-046)). No Histórico,
"Apagar nota" deixa "Criou" **e** "Excluiu" (divergência #23).

#### Comparativo (US-374, RN-384, EP-D20)

- `comparativo(ctx, patientId, ids)` (`comparativo.ts:32`): só ids válidos e únicos; mais de 30 na URL nem vão ao banco
  (`IDS_MAX_NA_URL`, `:30`); a consulta filtra por `patient_id`, então id de outro paciente é ignorado e não conta para o
  mínimo; fora de 2 a 6 → `{ erro: 'quantidade' }`, sem `ler`. Ordem por data, criação e id (a mais antiga à esquerda);
  linhas por `agruparMarcadores` (`pacientes/exames.ts:223`, chave `chaveDoMarcador`, `:217`: nome normalizado + unidade,
  então mg/dL e mmol/L ficam em linhas separadas e `unidadesSeparadas` liga a nota); célula = valor, unidade e neutra da
  linha daquele exame; **sem** categoria e **sem** nota. Um `auditRead` (`exames`) por exame mostrado, na mesma transação.
- Aba Exames, a partir de 2 exames: a caixa "Comparar" (nome acessível "Comparar {título} de {data}") em cada exame e o botão
  "Comparar {n} exames" com o apoio "Escolha de 2 a 6 exames para comparar." (`comparar-exames.tsx`; fora de 2 a 6 o botão
  fica com `aria-disabled`, no Tab, e o envio é barrado). A página (`comparativo/page.tsx`, `TabelaComparativa` em
  `tabela-classificada.tsx:114`): caption "Resultados por data", "Marcador", "—" sem o marcador, "Marcadores com unidades
  diferentes aparecem em linhas separadas." e "Voltar aos exames"; fora dos limites, só a frase de apoio. `idsDaBusca`
  (`comparativo.ts:89`) aceita `?ids=a&ids=b` e `?ids=a,b`.

**Testes:** `src/modules/exames/{catalogo,modelos-solicitacao,exames-edicao,exames-detalhe,interpretacao,comparativo,guardas,log}.test.ts`,
`src/modules/pacientes/exames.test.ts` e `exames-leitores.test.ts`, `src/app/painel/exames/{catalogo,modelos}/actions.test.ts`,
`src/app/painel/pacientes/[id]/exames/{linhas-do-exame,tabela-classificada}.test.ts` e os E2E `e2e/exames.spec.ts` e
`e2e/acessibilidade-exames.spec.ts` ([§7.5](07-testes-qualidade-e-processo.md#75-e2e-com-playwright)).

---

### 4.2.13 "Mostrar no app" (Plano 22, PR 3)

US-375, RN-385 a RN-387, EP-D22, EP-D45; o lado do portal está no [§5.5.15](05-agenda-portal-conteudo.md#5515-resultados-liberados-plano-22-pr-3-us-375-rn-385-a-rn-387-ep-d22-ep-d23).

| Função | O que faz | Onde |
|---|---|---|
| `mostrarNoApp(ctx, patientId, exameId)` | `exigirNutri` antes da transação; `carregarPacienteParaEscrita` (`FOR UPDATE`, recusa bloqueado e anonimizado) → exame `FOR NO KEY UPDATE` pelos dois ids (sem linha → "Exame não encontrado.") → `UPDATE` **só** de `mostrar_no_app_em = now()` (nunca `updated_at`: o resumo da IA não fica "desatualizado" e uma edição aberta com `lidoEm` não é recusada, R-383) → `recordAudit({ acao: 'alterar', entidade: 'exame_no_app_liberado', entidadeId: exameId, patientId })`. Já liberado: nada muda e nada é gravado (a data da primeira liberação fica). Devolve `pacienteUsaApp` (`patients.user_id` preenchido, o estado de `situacaoDoAcesso`) | `src/modules/exames/edicao.ts` (`mudarNoApp`) |
| `retirarDoApp(ctx, patientId, exameId)` | As mesmas travas; `mostrar_no_app_em = null` e `recordAudit` de `exame_no_app_retirado`. Não liberado: nada | idem |

- **Histórico de acessos (M5, aceito):** cada liberação ou retirada deixa **duas** linhas — "Alterou · Exames" (gatilho
  `audit_row_change` de `exams`) e "Liberou exame no app · Exames"/"Retirou exame do app · Exames" (`rotuloDaAcao`, com
  `ENTIDADE_ROTULO` "Exames" para as duas entidades novas, `src/modules/plataforma/audit.ts`). Sem filtro novo em
  `visivelNoHistorico`.
- **Actions** (`[exameId]/actions.ts`): `mostrarNoAppAction`/`retirarDoAppAction(patientId, exameId, _prev, f)` com
  `requireNutri`, devolvendo `{ ok?: true; pacienteUsaApp?: boolean; erro?: string }`; bloqueado → `MSG_BLOQUEADO`; exame que
  sumiu → "Não foi possível mudar o app do paciente. Tente de novo."; paciente de outro consultório → 404. Revalidam a
  ficha e não redirecionam.
- **Tela:** `NoAppDoExame` (`[exameId]/no-app.tsx`), logo abaixo do título do detalhe: "Mostrar no app do paciente"
  (botão, não `role=switch`) com a confirmação no `DialogoConfirmar`; liberado, o selo "No app" e "Retirar do app"
  (imediato). A região `<p role="status">` fica sempre montada, fora do bloco trocado ("O exame aparece no app do
  paciente.", mais "Este paciente ainda não usa o app. O exame aparece quando ele entrar." sem conta; "O exame saiu do app
  do paciente."); o erro em `role="alert"` ligado ao botão. O botão é o mesmo elemento nos dois estados (o foco fica nele).
  Paciente bloqueado: só o selo. Na lista da aba, o selo "No app" ao lado do título e, no exame liberado, "Excluir" pelo
  `DialogoConfirmar` com "Este exame está no app do paciente. Ao excluir, ele some de lá." (os outros exames continuam com
  a confirmação de antes, que os E2E da conferência usam).
- **"No app" da ficha** (RN-387, RN-279 v2): `secaoExames.noApp = noAppPor(exams, exams.id, …)` (`src/modules/ficha/secoes/exames.ts`),
  contado no contexto do paciente que `no-app.ts` abre — a política faz o filtro. A página `[id]/app` mostra na linha
  "Exames" "{n} exame(s) liberado(s)" (`MSG_NO_APP.examesLiberados`), com a mesma regra do menu do app (recebimento ligado,
  envio ou exame liberado). Paridade com `examesLiberadosDoPaciente` em `src/modules/ficha/no-app.test.ts`.
- **Exportação:** `mostradoNoAppEm` (ISO ou `null`) em `exames[]` do `dados.json`, nos dois escopos ([§4.2.9](#429-exportação-zip-us-018-us-046)).

**Testes:** `src/modules/exames/exames-no-app.test.ts`, `src/app/painel/pacientes/[id]/exames/[exameId]/actions.test.ts`,
`src/modules/plataforma/audit.test.ts`, `src/app/painel/pacientes/[id]/app/page.test.ts` e
`src/modules/pacientes/exportacao.test.ts`.

## 4.3 Alimentos

### 4.3.1 TACO 4ª ed. e seed (INT-04, US-020)

**Arquivos:** `src/modules/alimentos/taco.ts`, `grupos.ts`, `seeds/taco-4ed.csv`, `drizzle/0039_seed_taco.sql`.

**Tabela:** `foods` (`tenant_id` nulo = TACO; preenchido = "Meu alimento"). Valores por 100 g em `numeric(7,2)`; `micros jsonb`; `medidas_caseiras jsonb`; `taco_id smallint UNIQUE`.

| Item | Detalhe | Onde |
|---|---|---|
| Fonte | Planilha original `seeds/fontes/Taco_4a_edicao_2011.xls`, aba "CMVCol taco3", sha256 fixado; o teste `taco-fonte.test.ts` refaz CSV e migration e compara | `TACO_FONTE`, `taco.ts:4` |
| Quantidade | 597 alimentos (`seeds/taco-4ed.csv`: 598 linhas com cabeçalho) | `seeds/taco-4ed.csv` |
| Ids | Determinísticos: `00000000-0000-4000-8000-<taco_id com 12 dígitos>` | `idTaco`, `taco.ts:44`; Plano 04, D2 |
| Valores especiais | `Tr` → 0; `NA`, `*` e vazio → `NULL`; erro de digitação do alimento 373 corrigido | `valor`, `taco.ts:49`; `CORRECOES`, `taco.ts:27`; Plano 04, D4 |
| Grupos | Os 15 grupos da TACO, também CHECK `foods_grupo_valido` | `GRUPOS_TACO`, `grupos.ts:2` |
| Citação | "TACO 4ª ed. — NEPA/UNICAMP" na tela e no rodapé do PDF | `FONTE_TACO_TEXTO`, `taco.ts:13` |
| Imutabilidade | RLS `tenant_isolation` (escrita só das próprias linhas) + `taco_leitura` (`FOR SELECT USING (tenant_id IS NULL)`) | `drizzle/0040_rls_alimentos.sql`; Plano 04, D1 |

### 4.3.2 Medidas caseiras (US-020, Plano 04, D5)

**Arquivos:** `medidas.ts`, `medidas-constantes.ts`, `seeds/medidas-ibge.csv`, `drizzle/0042_seed_medidas_ibge.sql`. **Tabela:** `food_measures` 🔒 (`UNIQUE (tenant_id, food_id, nome)`, gramas 0,1–5000).

- Seed IBGE (POF 2008–2009): 44 medidas de 28 alimentos em `foods.medidas_caseiras` (`MEDIDAS_FONTE`, `medidas.ts:15`). A migration desliga `FORCE ROW LEVEL SECURITY` só durante o `UPDATE` (`sqlSeedMedidas`, `medidas.ts:37`).
- `medidasDeVarios(tx, ids)`: IBGE primeiro, depois as do tenant (`medidas.ts:63`).
- `cadastrarMedida(ctx, foodId, input)`: nome e plural 2–60; recusa nome igual ao de uma medida IBGE do mesmo alimento (o seletor mostraria dois rótulos iguais) (`medidas.ts:85`).
- `excluirMedida` (`medidas.ts:121`).
- Texto do item: `textoMedida(qtd, m)` — singular abaixo de 2 ("1,5 colher de sopa cheia"), plural a partir de 2 (`medidas-constantes.ts:16`). Gramas: `gramasDaMedida(qtd, gramas)` com 2 casas (`medidas-constantes.ts:22`). Até 100 medidas por item (`QTD_MEDIDA_MAX`).

### 4.3.3 Busca (US-020, Plano 04, D6)

`buscarAlimentos(ctx, termo)` (`busca.ts:31`):

- Até 6 palavras de até 60 caracteres (`palavrasDaBusca`, `busca.ts:13`); menos de 2 caracteres úteis → lista vazia.
- Cada palavra vira `app_unaccent(lower(nome)) LIKE '%palavra%'`, com `%`, `_` e `\` escapados.
- Ordem: começa com a 1ª palavra → `similarity` (pg_trgm) → nome mais curto → nome.
- Até 20 resultados (`BUSCA_LIMITE`), com selo `TACO`/`Meu alimento`, valores por 100 g e medidas.
- Índice: GIN `gin_trgm_ops` em `app_unaccent(lower(nome))`; `app_unaccent` é um wrapper `IMMUTABLE` porque `unaccent` é `STABLE` e não entra em índice (`drizzle/0040_rls_alimentos.sql:1-5`).

Meta da spec: "feijao carioca" entre os 5 primeiros em ≤ 300 ms.

### 4.3.4 Alimentos próprios (US-021)

**Arquivo:** `alimentos.ts`.

| Função | O que faz | Onde |
|---|---|---|
| `carregarAlimento` | Detalhe com aviso de valores incompletos | `alimentos.ts:55` |
| `criarAlimento` / `editarAlimento` | Nome 2–120, grupo da TACO, os 5 valores obrigatórios (energia 0–900, demais 0–100 g). TACO não é editável: "Alimentos da TACO não podem ser alterados. Use "Duplicar como meu alimento"." | `alimentos.ts:69,82` |
| `excluirAlimento` | Só do próprio tenant; FK `RESTRICT` de `meal_items` e de `recipe_ingredients` vira "Este alimento está em um plano ou receita e não pode ser excluído." | `alimentos.ts:96`; `MSG_ALIMENTO.emUso` |
| `duplicarComoMeu` | Copia nome, grupo, valores (sem valor → 0), micros e medidas IBGE; grava `origem_food_id`; devolve `incompleto` | `alimentos.ts:114` |

CHECKs no banco (`src/db/schema/alimentos.ts`): `foods_origem_valida` (TACO ⇔ `taco_id`), `foods_proprio_completo` (alimento próprio sem nulo), `foods_valores_faixa`, `foods_nome_tamanho`.

---

## 4.4 Plano alimentar

**Arquivos:** `src/modules/plano-alimentar/` (`calculo.ts`, `meta.ts`, `rascunho.ts`, `publicacao.ts`, `modelos.ts`, `carregar.ts`, `plano-pdf-job.ts`, `plano-pdf.tsx`, `constantes.ts`, `erros.ts`, `tipos.ts`). API: `src/app/api/painel/planos/[id]/route.ts` (GET/PUT), `…/[id]/pdf/route.ts`, `…/[id]/revisao/route.ts`. Editor: `src/app/painel/planos/editor/`.

**Tabelas:**

| Tabela | Pontos-chave |
|---|---|
| `meal_plans` 🔒 | `patient_id` nulo = modelo (`is_template`); `status` `rascunho`/`publicado`/`arquivado`; `versao`; `revisao` e `ultimo_envio` (D7); `meta_kcal` 500–10000; `energy_calc_id` sem FK; `pdf_path`, `pdf_status`, `pdf_pedido_em`; índices únicos parciais "1 publicado" e "1 rascunho" por paciente (RN-01, D11); Plano 14B-2: `ia_origem_em` (o plano nasceu de "Usar como rascunho"; só em plano de paciente, CHECK `meal_plans_ia_origem_so_paciente`) |
| `meals` 🔒 | `tenant_id`, `patient_id`, `plan_id`; nome 1–60; `horario time`; `ordem`; `recipe_content_id` (US-054) |
| `meal_items` 🔒 | `food_id` FK `RESTRICT`; `quantidade_g numeric(7,2)` 0,1–5000; `medida jsonb` (cópia); `medida_caseira_txt`; `substitui_item_id` (FK para o principal da mesma refeição, cascade); `nutrientes jsonb` (cópia congelada na publicação) |

Política `paciente_sem_rascunho` (RESTRICTIVE) nas três tabelas: sessão de paciente nunca vê nem grava rascunho (`drizzle/0045_rls_planos_alimentares.sql`; Plano 04, D12).

### 4.4.1 Cálculo RN-02 compartilhado

`calculo.ts` não importa banco nem React: o editor (navegador), o servidor e o PDF usam a mesma conta (`calculo.ts:6`).

| Função | Regra | Onde |
|---|---|---|
| `lerQuantidade(v)` | Gramas em [0,1; 5000]; senão `null` | `calculo.ts:14` |
| `nutrientesDoItem(porCem, g)` | `valor_por_100g × g / 100`, 6 casas; valor nulo na TACO conta 0 e entra em `semValor` (sem `NaN`) | `calculo.ts:21` |
| `totalDosItens(itens)` | Soma só itens principais (`substituiItemId` nulo) com quantidade válida | `calculo.ts:41` |
| `totalDoDia(refeicoes)` | Soma das refeições | `calculo.ts:52` |
| `indicadorMeta(kcal, meta)` | \|desvio\| ≤ 5% verde "Dentro da meta"; ≤ 10% amarelo "Atenção"; > 10% vermelho "Fora da meta"; texto com sinal e até 1 casa ("+7,5%") | `calculo.ts:60` |
| `distribuicaoMacros(total, pesoKg)` | g, g/kg (peso da última antropometria; sem peso, `null`) e % do VET com 4/4/9 kcal/g | `calculo.ts:72` |
| `kcalTexto`, `gTexto` | kcal inteiro; gramas com 1 casa | `calculo.ts:82-83` |
| `diferencaKcalDoItem(sub, principal)` | Diferença da substituição só se os **dois** lados têm kcal na TACO | `calculo.ts:97` |
| `quantidadeDoItem(i)` | "4 colheres de sopa cheias (100 g)" ou só "12,5 g" | `calculo.ts:101` |

`contextoDoPaciente(ctx, patientId, fuso)` (`meta.ts:12`) junta o peso para g/kg (Plano 04, D15) e os cálculos de GET para "Usar como meta do plano". As duas leituras já são auditadas.

Limites (`constantes.ts`): até 15 refeições e 200 itens por plano; textos até 2000; até 20 envios incertos.

### 4.4.2 Rascunho, salvamento por diferença e trava de revisão (Plano 04, D7, D8, D11)

```mermaid
sequenceDiagram
    participant Ed as Editor (use-salvamento.ts)
    participant API as PUT /api/painel/planos/[id]
    participant S as salvarRascunho
    Ed->>Ed: edição → espera 800 ms
    Ed->>API: rascunho inteiro + revisao + envio (uuid) + enviosIncertos
    API->>API: corpo ≤ 512 KB (413 acima)
    API->>S: validar (tudo antes do banco)
    S->>S: trava paciente → plano FOR UPDATE
    alt status ≠ rascunho
        S-->>API: PlanoNaoEditavelError (409 nao_editavel)
    else revisão diferente e não é repetição
        S-->>API: ConflitoRevisaoError (409 conflito)
    end
    S->>S: confere cálculo de GET, alimentos visíveis, receitas novas publicadas (FOR SHARE)
    S->>S: 1. remove itens e refeições que saíram
    S->>S: 2. insere/atualiza refeições que mudaram
    S->>S: 3. insere principais, depois substituições; UPDATE só do que mudou
    S->>S: revisao + 1, ultimo_envio = envio
    S-->>Ed: {revisao}
```

| Função | O que faz | Onde |
|---|---|---|
| `criarRascunho(ctx, patientId)` | Um rascunho por paciente: devolve o existente ou cria com `proximaVersao` (desde o Plano 14B-2, por `criarRascunhoTx`) | `rascunho.ts:25` |
| `criarRascunhoTx(tx, tenantId, patientId, { titulo?, metaKcal?, orientacoes?, iaOrigemEm? })` | Plano 14B-2 (RN-122): o rascunho novo dentro da transação de quem chama (que já travou o paciente e conferiu que não há rascunho, D11), com a versão seguinte; `iaOrigemEm` = a marca do "Usar como rascunho" (§10.13.3) | `rascunho.ts:46` |
| `proximaVersao(tx, patientId)` | `max(versao) + 1` contando publicadas, arquivadas e rascunho | `rascunho.ts:19` |
| `validar(entrada)` (privada) | Ids gerados no cliente, únicos no corpo (D8); medida `{nome, plural, gramas, qtd}`; quantidade arredondada a 2 casas; substituição só para principal da mesma refeição; meta 500–10000; horário `HH:MM`. Erros por chave `item:<id>:campo` e `refeicao:<id>:campo`; nada é gravado com erro | `rascunho.ts:77` |
| `salvarRascunho(ctx, planId, entrada)` | Ver diagrama | `rascunho.ts:173` |
| `gravarConteudoRascunhoTx(tx, tenantId, patientId, planId, refeicoes)` | Plano 14B-1: grava as refeições e os itens sugeridos pela IA num plano vazio (modelos, com `patientId` nulo, e, desde o Plano 14B-2, o rascunho do paciente); alimento que sumiu do catálogo sai e é contado (`foraDoCatalogo`); devolve `{ itens, foraDoCatalogo }` | `rascunho.ts:343` |
| `copiarConteudo(tx, origem, destino)` | Copia refeições e itens com ids novos; origem travada `FOR SHARE`; `nutrientes = null` (a cópia volta aos valores atuais) | `rascunho.ts:304` |
| `descartarRascunho(ctx, patientId, planId)` | Só o rascunho do paciente da URL; paciente bloqueado não descarta | `rascunho.ts:379` |

Por que a gravação é por diferença: o gatilho de auditoria grava uma linha por linha alterada. Regravar tudo a cada salvamento poria dezenas de linhas no "Histórico de acessos" a cada 2 s (D7). `canonico`/`iguais` comparam ignorando a ordem das chaves do `jsonb` (`rascunho.ts:162-164`).

Repetição segura (`rascunho.ts:188-192`): um envio cuja resposta se perdeu chega com revisão antiga. Ele é aceito se `ultimo_envio` estiver em `enviosIncertos` da mesma tela. Como o corpo é o rascunho inteiro e a gravação é por diferença, reaplicar não desfaz nada.

Erros mapeados pela rota (`src/app/api/painel/planos/[id]/route.ts`): 422 `PlanoError`; 409 `conflito`/`bloqueado`/`nao_editavel`; 404 não encontrado. Deadlock vira `PlanoError` "Recarregue a página" (`rascunho.ts:293`).

### 4.4.3 Publicação com versão (RN-01, US-025, Plano 04, D10)

```mermaid
stateDiagram-v2
    [*] --> rascunho: criarRascunho / criarDeModelo / editarPublicado (cópia, versao+1)
    rascunho --> publicado: publicarPlano
    publicado --> arquivado: publicarPlano de outra versão
    rascunho --> [*]: descartarRascunho
    note right of publicado
      imutável (RN-01)
      itens com nutrientes congelados (D10)
    end note
```

`publicarPlano(ctx, patientId, planId)` (`publicacao.ts:37`), numa transação, travas paciente → plano:

1. Exige ao menos uma refeição com alimento, horário em todas e item principal em cada refeição (`exigirPublicavel`, `publicacao.ts:19`).
2. Arquiva o publicado anterior.
3. Congela `nutrientes` de cada item com um `UPDATE … FROM foods` (nome, origem e os 5 valores por 100 g). Se o número de linhas congeladas difere do número de itens, aborta (`publicacao.ts:58-67`).
4. `status = 'publicado'`, `publicado_em`, `pdf_status = 'pendente'`, `pdf_pedido_em`.
5. Enfileira `plano-pdf` e grava o aviso ao paciente (`avisarPlanoNovo`, Plano 06) na mesma transação.

| Função | O que faz | Onde |
|---|---|---|
| `editarPublicado(ctx, patientId, planId)` | Só a versão **publicada** gera rascunho (`versao + 1`, `origem_plan_id`); se já há rascunho, devolve o existente; versão arquivada → "Esta versão não está mais publicada. Recarregue a página."; desde o Plano 14B-2 copia `ia_origem_em` (a versão nova de um plano feito com apoio da IA continua com o selo, RN-117, `:110`) | `publicacao.ts:86` |
| `pedirNovoPdf(...)` | Só de `falhou` volta a `pendente` com job; `pendente` → `PdfEmPreparoError`; `pronto` → nada; paciente bloqueado não ganha PDF novo | `publicacao.ts:128` |
| `lerPlanoNaTransacao(tx, planId, opts)` | Rascunho/modelo: valores atuais dos alimentos (e medidas, se for o editor). Publicado/arquivado: a cópia congelada. Audita `plano_alimentar` quando há paciente | `carregar.ts:17` |
| `paraCliente(p)` | Remove o caminho interno do PDF antes de mandar ao navegador | `carregar.ts:98` |
| `statusDoPdf`, `revisaoDoPlano`, `listarPlanosDoPaciente` | Estado do PDF (para o painel atualizar sem recarregar e auditar de novo), revisão atual, versões | `carregar.ts:115,126,134` |

Consequência de D10: corrigir um "Meu alimento" não muda plano publicado; "Editar" cria o rascunho com os valores atuais.

**Rascunho com IA e selo (Plano 14B-2, US-121, RN-117, RN-122; detalhe na [§10.13](10-ia.md#1013-ia-nutri--resumo-e-rascunho-plano-14b-2)).**
Na página do plano do paciente (`src/app/painel/pacientes/[id]/plano-alimentar/page.tsx:28`), "Gerar rascunho com IA"
aparece ao lado de "Criar plano" e "Criar a partir de modelo" quando a IA permite (`iaDoAssistente` com o uso
`rascunho_plano`); sem permitir, o motivo aparece abaixo dos botões. A tela `/painel/pacientes/[id]/plano-alimentar/rascunho-ia`
recebe as metas, acompanha a tarefa e mostra a prévia com os totais do mesmo `PainelTotais` do editor (`calculo.ts`;
nenhum número do modelo). "Usar como rascunho" (`usarComoRascunho`, `src/modules/ia/rascunho-ia.ts:173`) cria o
rascunho por `criarRascunhoTx` + `gravarConteudoRascunhoTx` na mesma transação que marca a tarefa aplicada (com
"Substituir" quando já há rascunho) e abre o editor com "Rascunho criado. Revise antes de publicar.". O editor do
paciente mostra "Criado com apoio de IA" (`MSG_PLANO.marcaIa`, `[planId]/page.tsx:38`) quando há `iaOrigemEm`
(`PlanoCompleto.iaOrigemEm`, `carregar.ts:93`); publicado, o PDF (`plano-pdf.tsx:52`) e o app (`/p/plano`,
`PlanoDoPaciente.seloIa`) mostram "Elaborado com apoio de IA e revisado pela nutricionista" (`MSG_PLANO.seloIa`).
`salvarComoModelo` e `criarDeModelo` não levam a marca (o `INSERT` deles é explícito; teste em `publicacao.test.ts`).

### 4.4.4 Modelos (US-024)

`modelos.ts`. Modelo = `meal_plans` com `is_template = true`, sem paciente, sempre `rascunho` (CHECKs `meal_plans_modelo_sem_paciente`, `meal_plans_modelo_rascunho`).

| Função | O que faz | Onde |
|---|---|---|
| `criarModelo(ctx, titulo)` | Modelo vazio | `modelos.ts:23` |
| `listarModelos(ctx)` | Com contagem de refeições; Plano 14B-1: `sugestaoIa` (origem IA sem aprovação) e `aprovadoEm` | `modelos.ts:30` |
| `listarModelosUsaveis(ctx)` | Plano 14B-1 (RN-125): só os próprios e os sugeridos **aprovados** — "Criar a partir de modelo" na página do plano do paciente | `modelos.ts:53` |
| `aprovarModeloPlano(ctx, id)` | Plano 14B-1: "Aprovar modelo" com o modelo travado; grava `aprovado_por` (= `actorUserId`) e `aprovado_em`; sem origem IA → `PlanoNaoEncontradoError` | `modelos.ts:74` |
| `salvarComoModelo(ctx, planId, titulo)` | Copia refeições e itens; audita a leitura do plano do paciente; paciente bloqueado não gera modelo | `modelos.ts:99` |
| `criarDeModelo(ctx, modeloId, patientId)` | Rascunho novo do paciente; recusa se já houver rascunho ("Já existe um rascunho para este paciente.") e, desde o Plano 14B-1, o sugerido pela IA sem aprovação ("Aprove o modelo antes de usá-lo com pacientes."); o plano criado não leva marca de IA | `modelos.ts:124` |
| `excluirModelo(ctx, id)` | Apaga o modelo | `modelos.ts:146` |

Modelo não se publica: `publicarPlano` filtra por `patient_id` e devolve "não encontrado" (`publicacao.ts:44-45`). Modelos não mostram g/kg (D15).

**Modelos sugeridos pela IA (Plano 14B-1, US-123).** O pacote de uma área traz 2 modelos de plano, gravados pelo worker na mesma transação (`ia_geracao_id`, título prefixado pela área, conteúdo por `gravarConteudoRascunhoTx` em `rascunho.ts`, com `patientId` nulo). `carregarPlano` devolve `origemIa` (`{ sugestao, aprovadoEm, descartados }`, `carregar.ts`; `PlanoCompleto.origemIa` em `tipos.ts`). Na lista (`/painel/planos/modelos`), a marca "Sugestão da IA — revise" (texto, não só cor) ou "Aprovado em {data}"; na página do modelo, a faixa ("Modelo sugerido por inteligência artificial. Revise alimentos, quantidades e textos antes de aprovar. Depois de aprovado, o modelo é seu."), "{n} itens sugeridos foram descartados por serem inválidos." e "Aprovar modelo" (com confirmação; `AprovarModelo`, `aprovarModeloPlanoAction`). O modelo continua editável no editor antes e depois da aprovação. Textos em `MSG_MODELO_IA` (`constantes.ts`). Gatilho `app_modelo_ia_origem` e CHECKs no [§10.12.3](10-ia.md#10123-banco-d18-migrations-0111-e-0112).

### 4.4.5 PDF do plano no worker (US-026, Plano 04, D13, D14)

`gerarPdfDoPlano(data, deps)` (`plano-pdf-job.ts:32`):

1. Tenant suspenso → `falhou` (RN-15).
2. Só age com `pdf_status = 'pendente'` em plano publicado ou arquivado (idempotente).
3. Lê o plano congelado sem auditar (o worker não é usuário).
4. Renderiza com `renderizarPlano` (`plano-pdf.tsx:98`): Helvetica/WinAnsi, cor `tenant.corPrimaria ?? COR_PADRAO` e logo lido do disco (D14: `getTenantBrand` é `server-only`), CRN, data de publicação no fuso, kcal só com `mostrar_calorias`, citação da TACO.
5. Grava com `salvarArquivo(tipo 'plano_pdf', ['pdf'])`: `antesDaReserva` trava o paciente e desiste se ele foi bloqueado ou anonimizado; `registrar` grava `pdf_path` e `pronto`.
6. Cota esgotada ou última tentativa → `falhou`; outros erros → nova tentativa do pg-boss.

Rede de segurança: `expirarPdfsPendentes` a cada 15 min marca `falhou` o pendente há mais de 1 h, medido por `pdf_pedido_em` (`plano-pdf-job.ts:114,125`; `src/worker/index.ts:207`). Fila `plano-pdf`: 2 novas tentativas, 30 s com backoff, 120 s cada (`src/jobs/queues.ts:25`).

Download: o painel chama `signFileUrl(pdf_path)` (`src/app/painel/pacientes/[id]/plano-alimentar/[planId]/pdf-do-plano.tsx`); o portal, `src/app/api/p/plano/pdf/route.ts`.

---

## 4.5 Jobs do worker deste capítulo

Filas usadas pelos módulos deste capítulo: `monitor-backup`, `monitor-disco`, `retencao-lgpd`, `exclusao-atendida`,
`exportacao-paciente`, `expirar-exportacao`, `plano-pdf`, `expirar-plano-pdf` e `limpar-tmp`
(`src/jobs/queues.ts`, `src/worker/index.ts`). Gatilho, função, novas tentativas, expiração e payload de cada uma
estão na tabela única de [§6.2.3 Filas](06-worker-seguranca-operacao.md#623-filas). Todas as agendas em `America/Sao_Paulo`.

---

## 4.6 Como estender com segurança

| Tarefa | Passos obrigatórios |
|---|---|
| Nova tabela clínica com `patient_id` | `pnpm db:generate`; migration custom com `app_enable_tenant_rls`, `app_enable_patient_rls` e `app_enable_audit('<tabela>', '<entidade>')`; FK composta `(tenant_id, patient_id) → patients`; entrada em `FABRICAS` de `test/isolamento.test.ts`; `auditRead` em toda leitura que devolve o dado; incluir em `montarDados` (exportação) e, se tiver arquivo, em `anexosDoPaciente` (anonimização). Regras 2, 8 e 9 do CLAUDE.md |
| Tabela que o paciente nunca vê | Também `app_enable_staff_only` e `STAFF_ONLY` em `src/db/rls-guard.ts`; nunca incluir na exportação |
| Escrita no prontuário | Começar por `carregarPacienteParaEscrita` (bloqueado vira só leitura) |
| Nova fórmula | Função pura em `formulas.ts`, sem arredondar; arredondar só na exibição com `kcal`; acrescentar o caso de teste do Apêndice A em `formulas.test.ts` |
| Mudar o cálculo do plano | Só em `calculo.ts` (editor, servidor e PDF compartilham); o plano publicado lê `nutrientes` congelados |
| Novo campo do plano | Validar em `validar` de `rascunho.ts`, comparar em `iguais`, copiar em `copiarConteudo`/`editarPublicado` e exportar em `planosParaExportacao` |
| Ampliar medidas IBGE (E-08) | Editar `seeds/medidas-ibge.csv` e gerar migration nova com `pnpm seed:medidas` |
| Seção nova no Início da ficha (Plano 18, D14) | Um arquivo em `src/modules/ficha/secoes/` e **uma** linha no fim de `SECOES_DA_FICHA`; rótulos genéricos, sem conteúdo clínico; nunca `auditRead` no arquivo (dado auditado: `leitura: { entidade }`, gravado por `inicio.ts`); `disponivel` monótona no total; imports só da lista fechada de `registro.test.ts`. Passo a passo na [§4.2.10](#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1) |
| Campo novo no cadastro do paciente (Plano 18) | Dado do titular que não precisa ir ao público nem aos fluxos sem login vai em `patient_cadastro` (nunca em `patients`, que o contexto `publico` e o paciente sem login leem); a regra entra em `validarCadastro` **e** no CHECK (uma fonte: `cadastro-textos.ts`), o rótulo em `MSG_CADASTRO`, e a decisão de exportação, anonimização e IA no mapa de `colunas-decididas.test.ts`. Ler o valor só no Perfil (`cadastroDoPaciente`, com `auditRead`); a lista e o Início, só presença ou o nome social por projeção ([§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)) |
| Leitura ou escrita nova da nota ou das versões do exame (Plano 22) | Só em `src/modules/exames/` (`detalhe.ts`, `edicao.ts`, `interpretacao.ts`) ou na exportação, nunca em `src/modules/pacientes/exames.ts` nem em arquivo que `src/modules/ia/**` alcance (guarda de grafo e de texto `src/modules/exames/guardas.test.ts`, RN-399, [§10.15](10-ia.md#1015-exames-do-consultório-fora-da-ia-plano-22-rn-399)); `exigirNutri(ctx)` antes da transação (as tabelas são `staff_only`); leitura pelos **dois** ids (exame e paciente) e `auditRead` só quando devolve linha; escrita com `carregarPacienteParaEscrita` → exame `FOR NO KEY UPDATE` → INSERT (nunca UPDATE: só de inclusão) |

---

## Divergências encontradas

Spec × código (o código foi descrito acima; a spec deve ser corrigida ou a decisão confirmada):

1. **Harris-Benedict, exemplo do Apêndice A e da US-014.** A spec diz mulher 60 kg/165 cm/35 anos = "1370,5 kcal (exibido como 1371)" e "Harris-Benedict 1371". A fórmula implementada (`formulas.ts:90`) dá 1370,47 → **1370** (RN-14, meio para cima). Desvio já registrado no Plano 03 ("Desvios conscientes", P-08 com a nutricionista), mas o Apêndice A e a US-014 (v1.11) não foram atualizados.
2. **§7 `consultations.notas_privadas`.** A spec ainda lista a coluna. O código usa a tabela `consultation_notes` com `staff_only` (`src/db/schema/pacientes.ts`, `consultationNotes`; Plano 03, "Notas privadas e etiquetas"). A spec não cita `consultation_notes` em lugar nenhum.
3. **§9.1 "UI … Recharts".** Não há Recharts no `package.json`; os gráficos são SVG de servidor (`ui/grafico-linha.tsx`; Plano 03, "Gráficos").
4. **§7 `anamnesis_templates`.** A spec lista só `nome` e `schema`; o código tem também `padrao` (índice único parcial) e `arquivado_em`. A US-012 diz que o modelo padrão existe "ao criar a conta"; o código o cria na primeira listagem (`garantirModeloPadrao`, `anamnese.ts:36`) — efeito igual para a usuária, momento diferente.
5. **§7 `exams.arquivo_path`.** A spec trata como campo livre; o código tem FK para `stored_files.caminho` com `ON DELETE SET NULL` e CHECK `exams_arquivo_do_tenant` (desvio do Plano 03 não refletido na §7).
6. **US-021, cenário "Alimento em uso".** O cenário diz "Este alimento está em um plano e não pode ser excluído."; o código diz "Este alimento está em um plano ou receita e não pode ser excluído." (`alimentos-constantes.ts`, `MSG_ALIMENTO.emUso`; Plano 07, D12). A nota do Plano 07 (`…-historias.md:1367`) já traz o texto novo; o cenário original não foi corrigido.
7. **US-018, cenário "Exportar": "dados.json (todas as tabelas de P)".** O código exclui as tabelas `staff_only` (notas privadas, etiquetas) e o motivo de cancelamento escrito pela nutricionista (comentários de `montarDados` e do tipo `DadosExportacao`, `exportacao-job.ts`). É decisão do Plano 03 ("Conteúdo da exportação") e está na US-046, mas o texto da US-018 não diz.
8. **US-018 "anonimizar_apos = última consulta + prazo".** **Resolvida (JUR-01, 09/10/2026):** o prazo passou a contar da data do bloqueio, o último registro do prontuário (`lgpd.ts:133-135`; migration `0110`), e a US-018 foi corrigida. Antes, o código contava da última data de atendimento registrado (`max(consultations.data)`).

Plano × código:

9. **Teto de laudos na exportação.** Decisão do dono no Plano 03: 200 MB. Código: `LIMITE_LAUDOS_BYTES = 100 MB` (`exportacao-job.ts:372`), valor do Plano 06, D16 (que passou a incluir as fotos do diário no mesmo teto). A tabela de decisões do Plano 03 ficou desatualizada.
10. **DPA e termo do paciente.** **Resolvida (P08-06, 15/10/2026):** `DPA_VERSAO` e `TERMO_PACIENTE_VERSAO = '1.0'` (`dpa.ts:16`, `termo-paciente.ts:7`; o DPA está na 1.1 desde o Plano 20), como previa o Plano 08, D14, mas com o texto publicado pelo dono sem o advogado (na linha da A-D27). Antes, `'0.1-provisorio'` (Tarefa 8 bloqueada no E-09).

Plano 18, PR 1 (ficha: Início, Perfil, cabeçalho e registro de seções; conferido no branch `plano-18-ficha-cadastro` em
`d9066f9`, 17/11/2026, antes do merge):

11. **RN-277 e Tarefa 1 do plano: o item de "Exames enviados pelo paciente" abre em `/painel/exames-recebidos/{id}`.**
    O código só leva à revisão nas situações recebido, aceito e recusado. Em processando, expirado e falhou, o item leva
    à aba Exames do paciente (`ABRE_A_REVISAO`, `src/modules/ficha/secoes/exames-enviados.ts:14,43`). O motivo é a
    revisão final do PR 1: nessas situações, a página da revisão diria "Este envio já foi revisado." sem ninguém ter
    revisado. Spec e plano não foram atualizados.
12. **RN-275: a última avaliação é `order by data desc, created_at desc limit 1`.** O código também desempata por
    `id desc` (`cabecalho.ts:32`), e a seção Antropometria usa a mesma ordem (`secoes/antropometria.ts:18`): o cabeçalho
    e o primeiro item da seção mostram sempre a mesma avaliação.
13. **RN-277: `resumo(tx, patientId)`.** O código usa `resumo(tx, patientId, fuso)` (`src/modules/ficha/tipos.ts:55`):
    o fuso do tenant converte os instantes no dia (`diaNoFuso`, `secoes/comum.ts:14`, RN-06).
14. **Resolvida no PR 2 (Tarefa 9): o guia `inicio-paciente` foi à v2 com a frase do selo e o passo `no-app-cartao`.**
    Registro original — **Spec §8.3: o passo `secoes-inicio` do guia `inicio-paciente` termina com "O selo No app marca o que o paciente vê
    no app."** A v1 sai sem essa frase (`src/modules/ajuda/conteudo.ts:170`), porque o selo só existe a partir da
    Tarefa 9 (PR 2), que leva o guia à v2. O teste "Plano 18 (§8.3)…" de `conteudo.test.ts` garante que nenhum texto do
    guia cite "No app". Pendência do PR 2, não erro.
15. **Resolvida no PR 2 (Tarefas 7b e 9; [§4.2.11](#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)).**
    Registro original — **Spec §8.3: no Início, a nota "Cadastro incompleto" (RN-269), o cartão "No app do paciente" e "Peso e IMC ocultos no
    app." na seção Antropometria.** Nada disso está no PR 1: entram nas Tarefas 7b e 9 (PR 2).
16. **Resolvida na Tarefa 12c (17/11/2026): a regra 8 ganhou a frase do Plano 18.** Registro original —
    **`CLAUDE.md`, regra 8: a lista das leituras que não chamam `auditRead`.** A regra ainda não cita as seções e o
    cartão Resumo do Início (sem trilha), nem a leitura auditada da última antropometria no cabeçalho
    (`carregarCabecalho`). A anotação entra no fechamento do plano (Tarefa 12c).

Plano 18, PR 2 (cadastro complementar, lista, "No app", LGPD e IA; conferido no branch local `plano-18-pr2` em `3799409`,
17/11/2026, antes da revisão final e do rebase):

17. **Spec §10: "O LEIA-ME da exportação cita o bloco novo."** O ZIP não tem LEIA-ME (`dados.json`, `prontuario.pdf`,
    `laudos/`, `diario/`, `documentos/`, `autorizacao-ia/`; §4.2.9); o bloco `paciente.cadastro` fica descrito só no
    tipo `CadastroExportado` (`exportacao-job.ts:72`) e no comentário de `DadosExportacao.paciente.cadastro`. Mesma
    situação que o Plano 20 registrou para a seção `financeiro` (revisão de normas, M-4). Criar o LEIA-ME é decisão à
    parte (texto ao titular: passa pelo `normas-cfn-lgpd`), não deste PR.
18. **RN-283: a rede idempotente roda "no fim" da varredura diária.** O código a roda no **início** de cada tenant, antes
    da listagem dos vencidos (`lgpd.ts:508`, `apagarCadastrosDosAnonimizados` em `:644`): no fim, um tenant cuja
    listagem falha (`continue`) ficaria sem a rede. O efeito pedido (a linha de titular anonimizado some na varredura
    seguinte) é o mesmo; a spec deve trocar "no fim" por "no início de cada tenant".
19. **Plano, "Estrutura de arquivos".** Há dois arquivos de textos que a tabela não lista: `src/modules/pacientes/cadastro-textos.ts`
    (`MSG_CADASTRO`, listas fechadas e a contagem de caracteres, sem banco, porque o formulário cliente importa) e
    `src/app/painel/pacientes/textos.ts` (`MSG_LISTA`, pelo mesmo motivo, para o menu da linha). `cadastro.ts` reexporta
    o primeiro.

Plano 22, PR 2 (catálogo, edição com versão, detalhe, nota, comparativo e exportação; conferido no branch
`plano-22-exames-prescricao` em `829b0a7`, 23/11/2026, antes do merge do PR 1 e da revisão final do PR 2;
[§4.2.12](#4212-exames-do-consultório-catálogo-edição-com-versão-nota-e-comparativo-plano-22-pr-2)):

20. **Spec do Plano 22, §6.2 (textos de interface).** O código tem textos que a §6.2 não traz, marcados em `MSG_EXAMES`
    (`src/modules/exames/constantes.ts`) como "Texto novo … Rascunho para a Debby": "1 exame adicionado ao catálogo." /
    "{n} exames adicionados ao catálogo.", "Marque ao menos um nome.", "Novo exame do catálogo", "Exame não encontrado."
    (no catálogo), "Modelo não encontrado.", "Este exame ainda não foi editado.", "Só acrescentou linhas (sem
    justificativa).", "Nenhum valor lançado neste exame.", "Escreva a nota antes de salvar.", "A nota foi apagada nesta
    versão." e "Marcador, valor e unidade vieram do laudo e não mudam. Para corrigir, remova a linha e lance outra.", além
    dos rótulos acessíveis e das partes de "{público}, {idade}: {limites}" ("qualquer idade", "a partir de {n} anos"…). A
    spec deve trazê-los depois do aceite da Debby.
21. **RN-382: "Ver referência" também no comparativo.** O comparativo não tem a coluna (`TabelaComparativa`,
    `tabela-classificada.tsx:114`): a célula traz valor, unidade e a neutra, como diz a RN-384 e a Tarefa 5b do plano.
    Decidir se a RN-382 perde "e no comparativo" ou se o comparativo ganha o botão por célula.
22. **Pendências do PR 3 (Tarefa 6, "Mostrar no app").** A spec já descreve, e o código ainda não tem: o botão "Mostrar no
    app do paciente" no detalhe, o `mostradoNoAppEm` em `exames[]` do `dados.json` (RN-399) e os rótulos
    `exame_no_app_liberado`/`exame_no_app_retirado` (cap. 2, #14). A coluna, a política e os avisos de edição e exclusão
    já existem. Pendência, não erro. *(Resolvida no PR 3, [§4.2.13](#4213-mostrar-no-app-plano-22-pr-3).)*
23. **EP-D61: "Apagar nota" no Histórico de acessos.** Uma ação deixa duas linhas: "Criou · Nota de interpretação do
    exame" (o gatilho, pela linha de texto nulo, `entidade_id` = id da linha) e "Excluiu · Nota de interpretação do exame"
    (`recordAudit` de `apagarNota`, `interpretacao.ts:94`, `entidade_id` = id do exame). O `criar` fica porque é a
    inclusão que aconteceu; nenhum filtro novo em `visivelNoHistorico`. Registro pedido pelo plano (Tarefa 5a), não erro.
24. **Spec do Plano 22, §4.1: "Título (h1)" do detalhe, da edição, das versões e do comparativo.** As quatro telas usam
    h2 (`[exameId]/page.tsx:56`, `editar/page.tsx:35`, `versoes/page.tsx:34`, `comparativo/page.tsx:28`): o h1 do prontuário
    é o nome do paciente. As telas do hub (`/painel/exames/*`) têm h1.
25. **RN-384: "empate pela criação".** O código desempata também pelo id (`comparativo.ts:43`) e recusa mais de 30 ids na
    URL antes do banco (`IDS_MAX_NA_URL`, `:30`), com o mesmo `{ erro: 'quantidade' }`.

Plano 22, PR 3 ("Mostrar no app", Tarefa 6; [§4.2.13](#4213-mostrar-no-app-plano-22-pr-3)):

26. **Texto novo na página `[id]/app`.** A spec não traz o texto da contagem dos exames liberados; o código usa
    "{n} exame liberado"/"{n} exames liberados" (`MSG_NO_APP.examesLiberados`, rascunho para a Debby), na linha "Exames"
    junto de "{n} envio(s) de exame".
27. **Excluir na lista da aba.** O plano pede a confirmação do exame no app pelo `DialogoConfirmar`; só o exame liberado
    ganhou o diálogo (o mesmo componente do detalhe, `ExcluirExame`). Os outros seguem com o `ConfirmarBotao` de antes,
    de que os E2E da conferência dependem.
28. **Paciente bloqueado nas actions.** O plano dá um texto só de erro ("Não foi possível mudar o app do paciente. Tente
    de novo."); com o paciente bloqueado, a action devolve a recusa de hoje (`MSG_BLOQUEADO`), como a nota.
29. **`temExameLiberado` em `/p/exames`.** A RN-386 diz que a página mostra a seção "quando `temExameLiberado`"; a página
    chama direto `examesLiberadosDoPaciente`, que já só grava o `auditRead` com itens (uma consulta a menos, mesmo
    efeito). `temExameLiberado` fica com a moldura.
30. **EP-D59.** A solicitação de exames (Tarefa 8) ainda não está na `main`: o cenário dela em `no-app.test.ts` entra na T8.

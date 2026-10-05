# Plano 10A — Receita: base de documentos assinados e assinatura digitalizada (F3-06): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Aprovado pelo dono em 05/10/2026.** As decisões ★ D1 a D9 do Plano 10 foram aprovadas como recomendadas, e o plano único (`2026-10-05-nutridebby-10-receita.md`, 19 tarefas) foi **dividido em dois**: este **Plano 10A — Receita** (base de documentos + receita com assinatura **digitalizada**, opção E, e tudo o que a torna utilizável de verdade) e o [**Plano 10B — Assinatura gov.br e ICP-Brasil**](2026-10-05-nutridebby-10b-assinatura-digital.md) (spike, conferência do PDF assinado, assinante do consultório, envio do PDF assinado). O 10A compila, roda e vai para produção **sem nada do 10B**. Escrito a partir de `origin/main` @ `62615b9` (Planos 01–08 em produção, migrations 0000–0088, spec do MVP v1.11) e da spec de documentos assinados **v0.3.1**. Aplicados: as 18 correções da revisão do rascunho (05/10/2026) e os Minors das revisões de cobertura e de segurança que valem para o 10A (seção "Minors das revisões"). Nenhuma linha de código foi escrita; nada foi rodado no banco. Próximo passo: `/code-review high` **do plano** (como no Plano 08) → execução.

**Goal:** A nutricionista monta no prontuário uma receita de suplementos e fitoterápicos com os campos que o CFN exige, prepara um PDF com a marca, o código de verificação e o QR, imprime, assina à mão e envia fotos das páginas com o código do 2FA; o worker monta um PDF novo, o banco trava o documento, o paciente recebe pelo portal, por link de uso único com código ou pessoalmente e confirma o recebimento, qualquer pessoa confere o código numa página pública sem dado de saúde, a nutricionista pode cancelar, e a LGPD (exportações, bloqueio, anonimização) cobre as receitas.

**Architecture:** Um módulo novo, `src/modules/documentos`, com a base de documento assinado (estados, código Crockford, cópia congelada, imutabilidade no banco), a receita (`prescricao.ts`), a assinatura no banco (`registrar-assinatura.ts`, **sem dependência de sessão**, a mesma que o Plano 10B usa para o PDF assinado), a digitalizada (fotos → PDF novo no worker), a entrega (portal, link + código, pessoalmente), a verificação pública, a LGPD e o cancelamento. Três migrations (0089–0091): `signed_documents` (gatilho `app_documento_imutavel`, política `paciente_so_emitidos`), `signed_document_notes` (STAFF_ONLY), `signed_document_receipts` (só INSERT, a única escrita nova do paciente com login), `document_access_codes` (link sem login, gatilho de colunas), `document_verifications` (fora da RLS, só `verificacao.ts`) e as colunas do perfil em `tenants`. O PDF preparado e o PDF da digitalizada nascem no worker (`@react-pdf/renderer`); o PDF preparado já sai com o quadro "Assinatura digital" e grava `base_pdf_bytes`/`area_assinatura`, para que um documento preparado no 10A possa ser assinado com certificado depois do 10B (D22).

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Route Handlers, Server Actions, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · Better Auth (`twoFactor`) · `@react-pdf/renderer` 4.9, `qrcode` 1.5 e `sharp` (já instalados). **Nenhuma dependência nova** (as bibliotecas de leitura de certificado entram no Plano 10B).

**Spec:** [`../specs/2026-10-03-nutridebby-documentos-assinados-design.md`](../specs/2026-10-03-nutridebby-documentos-assinados-design.md) (**v0.3.1**: §2.3 fatias e a divisão 10A/10B, §5 fluxo, §5.1 código, US-140 e US-142 a US-147 (a US-144 só na parte da digitalizada), US-149, US-150 base, RN-140 a RN-143, RN-145 (2FA na digitalizada), RN-149 a RN-154, RN-156 a RN-158, RNF-140 a RNF-145, §10 modelo, "Decisões do dono (05/10/2026)" e "Decisões do Plano 10 (aprovadas em 05/10/2026)") e a spec do MVP [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.11: §4.1, RN-08, RN-15, RN-16, RN-18, RNF-08, RNF-10, RNF-11, US-018, US-046, US-057). Pesquisas e revisões da preparação (fora do git): `.superpowers/sdd/2026-10-05-nutridebby-10-preparacao/` (`pesquisa-spec.md`, `pesquisa-codigo.md` G1–G12, `revisao-cobertura.md`, `revisao-seguranca-normas.md`). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P10A-01 a P10A-17).

## Global Constraints

- Tudo dos Planos 01–08 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista (guarda `acoes-de-paciente.test.ts`) e `requireApiNutri` nos Route Handlers dela; `requirePaciente`/`requireApiPaciente` em todo o portal; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500); toda página nova de `src/app/painel/**` renderiza `<Cabecalho` pelo layout (guarda `cabecalho.test.ts`) e entra em `ROTAS_DO_PAINEL` (guarda `rotas-axe.test.ts`) e em `GUIAS` ou `SEM_AJUDA` (guarda `conteudo.test.ts`).
- **Base:** `origin/main` em `62615b9`. As migrations deste plano são **`0089`–`0091`**: `0089_documentos_assinados` (gerada, T1), `0090_rls_documentos` (custom, T1), `0091_documentos_imutaveis` (custom, T2). O Plano 10B continua a numeração (`0092`, `0093`; `0094`–`0095` só com a tarefa condicional). **O Plano 09 (fechamento do MVP) vem antes no roadmap:** se ele entrar na `main` com migration, renumerar no rebase e corrigir as referências dos dois planos no PR. Migrations só com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7); **nunca** no banco de dev compartilhado sem combinar, nunca em produção fora do deploy.
- **Independência do 10B:** nenhum arquivo, import, teste ou texto de interface do 10A depende do 10B. O 10A não cria, não importa e não cita nenhum arquivo, função, tabela, constante ou pacote que só o Plano 10B cria (a lista está na "Estrutura de arquivos" do 10B; o fechamento confere por grep em `src/`, `test/`, `e2e/`, `scripts/` e `drizzle/`). `TipoAssinatura` é só `'digitalizada'`; os CHECKs de `assinatura_tipo` (em `signed_documents` e `document_verifications`) aceitam só `'digitalizada'`; a tela de assinar oferece só a digitalizada — gov.br e certificado aparecem no 10B.
- Toda tabela nova com `tenant_id`: `app_enable_tenant_rls`; com `patient_id`, `app_enable_patient_rls`; dado de saúde, `app_enable_audit` + `ENTIDADE_ROTULO`, ou entrada justificada em `AUDIT_EXCEPTIONS`; fábrica em `FABRICAS` de `test/isolamento.test.ts`. CLAUDE.md regras 1, 2, 8 e 9.
- **Escrita do paciente (D1 do Plano 06):** as únicas escritas novas da sessão de paciente são `signed_document_receipts` (`insert`) e `document_access_codes` (`insert`, `update` — com o gatilho `app_codigo_acesso_regras`, T2), cada uma com `SELECT app_allow_paciente_escrita(...)` na migration **e** a entrada em `PACIENTE_ESCREVE`, na mesma tarefa (T1). `signed_documents`, `signed_document_notes` e `document_verifications` ficam fechadas ao paciente.
- **Imutabilidade (RN-140):** quem garante é o gatilho `app_documento_imutavel` no banco (T2), não o código. Nenhum código fora de `app_anonimizar_documentos` limpa `conteudo` ou `pdf_path` de documento emitido.
- **Uma conexão por transação** (Plano 05): dentro do callback de `withTenant` só o `tx` recebido. A verificação do código do 2FA (chamada à API do Better Auth) roda **fora** de transação.
- **Arquivos (regra 9):** PDF base (`documento_base`), PDF final (`documento_assinado`) e fotos da digitalizada (`documento_digitalizado`) só por `salvarArquivo` (o `registrar` grava o ponteiro na mesma transação) e `apagarArquivo` (o `naMesmaTransacao` confere/limpa o registro) — inclusive depois da assinatura: ela **mantém** `base_pdf_path` e `digitalizacao`, e cada arquivo sai no seu `apagarArquivo` com o ponteiro no `naMesmaTransacao` (`soltarArquivosDoPreparo`, T5; correção do `/code-review high` do PR #18); servir só por `signFileUrl`, com a URL nascendo no clique (rota que responde 303). FKs `NO ACTION` para `stored_files.caminho` (as primeiras do projeto). Nunca montar caminho com texto do usuário.
- **Só o worker:** `documento-pdf.tsx`, `documento-pdf-job.ts`, `digitalizada-job.ts` fora do grafo do Next — guarda de grafo em `exportacao.test.ts`. O worker importa `registrar-assinatura.ts`, que não puxa sessão (`@/lib/auth`, `confirmar-2fa`, `tenant-session`) nem pelos imports dos imports — guarda em `registrar-assinatura.test.ts` (D23).
- RNF-142 / CLAUDE.md regra 3: nada de conteúdo, itens da receita, nome de paciente, código de verificação, token, código de 6 dígitos, código do 2FA ou caminho de arquivo em log/Sentry; logs só com ids, motivo fixo e o nome do erro.
- Textos de interface em pt-BR, com o texto exato da spec v0.3.1 quando existir (US-140, US-142 a US-147, US-149, RN-157, RN-158). Os textos "(proposto)" da spec, a declaração da receita (D5 da spec) e os textos novos deste plano são **rascunho** até a revisão da Debby (runbook, passo 3) — como o manual guiado (P08-08). Textos novos deste plano estão na tabela de desvios (últimas linhas).
- Visual V2 (Plano 08): só os tokens do tema (`bg-fundo`, `bg-cartao`, `text-texto`, `text-suave`, `border-borda`, `text-link`, `border-marca`…), nunca cor fixa em `src/app/painel` e em `src/modules/*/ui` (guarda `cores.test.ts`); componentes `Cartao`, `Botao`/`BotaoLink`, `Aviso`, `Selo`, `Campo`, `ConfirmarBotao`; axe nos três modos (claro, escuro, igual ao aparelho) e 360 px no portal, em `/v` e em `/documento/[token]`.
- Acessibilidade (RNF-10): `<label for>`, `fieldset`/`legend`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso com `role="status"`, alvo de toque ≥ 44 px.
- Custo zero: nenhuma dependência paga, nenhum serviço novo. Os e-mails novos (link e código da D3 b) entram na cota do plano atual do Resend (runbook, passo 5).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos. **Nenhuma variável nova** (as chaves derivam de `ENCRYPTION_KEY` por HKDF; o Turnstile já existe). Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes.
- Política de revisão por entrega (índice, revista em 02/10/2026): revisor por tarefa → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` (com o checklist reforçado, D9 ★ aprovada). Se sobrar problema Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais.
- **Liberação para uso real** (não é merge): só com a resposta do CRN-3 (P-B1), os textos revistos pela Debby, o termo e o DPA revistos (P-B3, E-09), o backup no host (P02-11) e o "Cancelar documento" no ar (D3 ★). Até lá, a nutricionista não vê a aba "Documentos" (interruptor `documentos_liberados` em `tenants`, ligado pelo admin; T6, D20). O 10B **não** é pré-requisito: a receita digitalizada já é utilizável (D1 da spec: E é alternativa aceita).

### Decisões de desenho

As marcadas com ★ foram **aprovadas pelo dono em 05/10/2026, como recomendadas**. A numeração D1–D21 é a do plano único (a mesma da spec v0.3.1 e das revisões); D7, D8 e D10 são do Plano 10B; D9 vale para os dois; D22–D24 nasceram na divisão.

| # | Tema | Decisão (aplicada no plano) | Consequência |
|---|---|---|---|
| D1 ★ | LGPD da receita (spec §2.3 i) | **Aprovada pelo dono em 05/10/2026.** No Plano 10A: auditoria (gatilho + `auditRead`), exportação da equipe e do titular com os PDFs e a chave `documentos` no `dados.json`, bloqueio (só leitura) e anonimização pela `app_anonimizar_documentos` (Tarefa 14) | Uso real sem esperar o Plano 13; paciente anonimizado deixa de ser identificável pela receita |
| D2 ★ | Esquema completo (spec §2.3 ii) | **Aprovada pelo dono em 05/10/2026.** Os **6 estados**, o gatilho com **todas** as transições (inclusive `substituido`, testado por SQL), as 4 situações da verificação e `signed_document_notes.motivo_cancelamento` nascem aqui; `tipo` só `'receita'` (o Plano 13 amplia o CHECK e cria `exam_ids`) | O Plano 13 não reescreve o gatilho de uma tabela com receitas reais |
| D3 ★ | Cancelar antes do uso real (spec §2.3 iii) | **Aprovada pelo dono em 05/10/2026.** A US-149 sobe para o Plano 10A (Tarefa 15): "Cancelar documento" com motivo (STAFF_ONLY), e-mail neutro (D11 da spec) e a verificação em "cancelado". A retificação (US-148) continua no Plano 13 | Receita assinada com erro deixa de valer sem mexer no banco de produção |
| D4 ★ | Digitalizada (opção E) | **Aprovada pelo dono em 05/10/2026.** **Só imagens** (JPEG/PNG, 1 a 5 páginas, 10 MB no total, tipo pelo conteúdo) + código do 2FA; o worker monta um PDF novo com as imagens e o rodapé do código/QR (RN-157). Um PDF enviado como "digitalizado" é recusado ("Envie fotos das páginas (JPEG ou PNG).") | Nada de script, anexo ou ação de um PDF qualquer chega ao paciente |
| D5 ★ | "Documentos" no portal | **Aprovada pelo dono em 05/10/2026.** **Sem aba nova**: cartão "Documentos" no Início (com o número de novos) e link "Meus documentos" em Perfil; `/p/documentos` marca a aba "Perfil" (`tambem`). A barra continua com 7 colunas (R16) | "Exames" e "IA Nutri" (Planos 12 e 15) decidem o "Mais" |
| D6 ★ | Link da D3 (b) | **Aprovada pelo dono em 05/10/2026.** Válido por **30 dias** e enquanto o documento estiver `assinado`; botão "Reenviar link por e-mail" no painel emite um token novo | E-mail antigo esquecido deixa de abrir o documento |
| D9 ★ | `/security-review` (vale para 10A e 10B) | **Aprovada pelo dono em 05/10/2026.** **Com o checklist reforçado** (como os Planos 01–03 e 05–08): no 10A, escrita nova do paciente, página pública, link sem login com código, digitalizada (fotos de fora → PDF no worker) e uma função de anonimização; a parte da conferência criptográfica e do parser de PDF fica no `/security-review` do 10B | Sem custo (assinatura) |
| D11 | Recebimento (D4 da spec) | Tabela própria `signed_document_receipts`, **só INSERT** (o paciente nunca faz UPDATE em `signed_documents`): eventos `aberto` e `recebido`, uma linha por evento (`ON CONFLICT DO NOTHING`), `REVOKE UPDATE, DELETE` | — |
| D12 | Código do link (D3 b) | Tabela própria `document_access_codes` com `patient_id`, escrita pela sessão de paciente **sem login** (`semConta`, `link-documento.ts` em `SEM_CONTA_PERMITIDOS`); em `AUDIT_EXCEPTIONS` (só HMAC, sem dado de saúde; a abertura vira evento auditado no recibo). O token do link não tem estado (MAC com o e-mail atual, como `link-consulta.ts`). UPDATE só de `tentativas` (+1) e da sessão (uma vez), pelo gatilho `app_codigo_acesso_regras` (T2); limpeza diária dos vencidos (T12) | — |
| D13 | Quando pedir o código do 2FA | No 10A, em **toda** digitalizada (sem certificado ligando a autoria). Mecanismo único `confirmarCodigo2fa` (`src/lib/confirmar-2fa.ts`): `auth.api.verifyTOTP` com a sessão da própria usuária, 5 tentativas em 15 min por usuária (zerado no acerto), anti-repetição de 90 s e registro da recusa no histórico ("Tentativa de assinatura com código recusado"). O primeiro certificado e a troca do titular do consultório usam o mesmo mecanismo no Plano 10B | — |
| D14 | Paciente arquivado | Pode redigir, preparar e assinar (`carregarPacienteParaEscrita`); sem e-mail, push nem link: só "Entregue pessoalmente" (RN-153), e **sem** `entregue_em` (T10) | — |
| D15 | Área reservada da assinatura | Quadro "Assinatura digital" fixo no rodapé **de cada página**, à direita, 208 × 70 pt (`AREA_ASSINATURA`, T1), gravado em `area_assinatura` no preparo (T7). O campo pré-criado com `/Lock` é do Plano 10B | O PDF é o mesmo nos dois planos |
| D16 | Nomes no código | "Prescrição" nos identificadores (`prescricao.ts`, `ItemPrescricao`), para não colidir com as receitas culinárias do Plano 07; no banco e na tela continua "receita" | — |
| D17 | Auditoria de leitura (RNF-142) | `auditRead` na leitura do conteúdo no painel e nas rotas que assinam a URL do PDF (painel, portal e link); as listas do painel e do portal **não** auditam, como a agenda — exceção registrada na regra 8 do CLAUDE.md (T1, Passo 8) e presa por teste: os itens das listas só têm tipo, data, situação, tipo de assinatura e recibos, nunca itens, orientações ou justificativa (`documentos.test.ts`, `portal.test.ts`). O worker não chama `auditRead` | — |
| D18 | Manual guiado | Guia novo **`documentos`** (antes do `prontuario`); guia **`configuracoes`** com `versao: 2`; guia novo **`seguranca`** para `/conta/seguranca` (a tela ganha "Como funciona"), e o teste do manual passa a cobrir `src/app/conta`. O 10B sobe o `documentos` e o `seguranca` para a v2 com o gov.br e o certificado | — |
| D19 | Teste de isolamento | A fábrica de `signed_documents` cria um documento **`assinado` já anonimizado**; `signed_document_receipts` em `SO_INSERE`; `IMUTAVEIS` (`signed_documents`, `signed_document_notes`); em `signed_documents`, o DELETE do tenant B só apaga rascunhos | — |
| D20 | Liberação gradual | Interruptor `tenants.documentos_liberados` (padrão `false`), ligado pelo admin na tela do consultório depois da liberação para uso real; sem ele, a aba "Documentos" não aparece, as ações respondem 404 e o paciente não vê nem abre documento (portal, `/api/p/documentos/[id]/pdf`, confirmação do recebimento e link do e-mail, que também não manda código; T11 e T12). **Não desligar depois do uso real** (confirmação do admin e runbook; Minor 12) | Evita que a Debby use antes da resposta do CRN-3 |
| D21 | Ordem e paralelismo | **T1 → T2 → T3 → [T4 ‖ T5] → T6 → T7 → T8 → T9 → T10 → [T11 ‖ T12] → T13 → T14 → T15 → T16**. Dependências reais: a T5 consome `copiaDoPerfil`, `PerfilIncompletoError` e `CopiaProfissional` da T3; a T3 e a T4 editam `src/modules/ajuda/conteudo.ts` (e a T4 também o `CLAUDE.md`); a T10 altera `registrar-assinatura.ts` (T8) e `digitalizada-job.ts` (T9); a T12 e a T13 editam `next.config.ts` e `src/lib/sentry-filtro.ts`. Só T4 ‖ T5 e T11 ‖ T12 tocam arquivos diferentes | — |
| D22 | Divisão 10A/10B (05/10/2026) | As colunas que só a conferência do certificado lê (`base_pdf_bytes`, `area_assinatura`, `assinatura_emissor`, `assinante_nome`) e o quadro "Assinatura digital" nascem no 10A; o 10B só amplia dois CHECKs e cria a tabela do assinante do consultório | Um documento preparado no 10A pode ser assinado com certificado depois do 10B; o 10B não migra dados de uma tabela com receitas reais |
| D23 | `registrarAssinatura` sem sessão | Em `registrar-assinatura.ts` (T8), com os tipos `AcessoAssinatura`, `DepsAssinar`, `VersaoLida`, `AssinaturaAceita` e `exigirHabilitacaoAtual`; o envio do PDF assinado do 10B importa daqui | Minor da revisão de cobertura: o worker deixava de puxar o Better Auth |
| D24 | Envio digitalizado em curso | `digitalizacao_status` ganha `recebendo` e a coluna `digitalizacao_em`; um envio trava o documento (o segundo recebe 409); `recebendo`/`pendente` com mais de 1 h viram `falhou` na varredura da T7 | Minors da revisão de cobertura: fotos somadas de dois envios e `pendente` eterno |

D7 ★ (âncoras), D8 ★ (gov.br sem CPF) e D10 (CPF do assinante do consultório) estão no Plano 10B.

### Desvios conscientes da spec (registrados aqui; a spec v0.3.1 já os reflete, salvo a linha da RN-140 (b) e a última linha, que ficam para a v0.4)

| Spec | Neste plano | Motivo |
|---|---|---|
| §10 `signed_documents` | Colunas a mais: `base_pdf_bytes` (prefixo da RN-144 (2)), `area_assinatura jsonb` (D15), `digitalizacao jsonb` (caminhos das fotos, D4), `digitalizacao_status` (`recebendo`/`pendente`/`falhou`) e `digitalizacao_em` (D24); `pdf_status` com `sem_cota` (RNF-143: a tela mostra a mensagem da cota); o gatilho libera `digitalizacao*` só em `aguardando_assinatura` e a limpeza em `assinado` | Implementação da RN-144, da RN-157 e da RNF-143 |
| §10 `tenants` | Coluna a mais `documentos_liberados boolean` (D20) | Liberação só depois do CRN-3 |
| §10 `assinatura_tipo` | CHECK só com `'digitalizada'` no 10A, em `signed_documents` e `document_verifications`; o 10B amplia | Divisão 10A/10B |
| RN-140 (c) "`SECURITY DEFINER`" | `app_anonimizar_documentos` é **SECURITY INVOKER** (T2) | Minors das duas revisões: INVOKER é mais estreito; o gatilho já exige o contexto `worker`. A v0.3.1 corrige a RN-140 (c) |
| §10 `document_access_codes` "limpeza diária dos vencidos" | `limparCodigosDeDocumentoVencidos` na `agenda-limpeza` (04:30), e UPDATE só pelo gatilho `app_codigo_acesso_regras` | Minors das revisões (cobertura e segurança 14) |
| US-146 lugar | Cartão no Início + link em Perfil (D5 ★) | R16 |
| §5.1 rotas | `GET /api/painel/documentos/[id]/pdf?estado=1` devolve o estado em JSON (sem auditoria); sem `?estado`, 303 para o PDF (com auditoria) | Uma rota para as duas coisas, como a do plano |
| RN-158 | Sessão do link: cookie `nd_doc` com `path=/documento/<token>` **e** `/api/documento/<token>` (dois cookies iguais, um por caminho) | O `path` de um cookie não cobre dois prefixos |
| RN-140 (b): a ida a `assinado` com "`base_pdf_path` → NULL no mesmo UPDATE" | A assinatura **mantém** `base_pdf_path` e `digitalizacao`; logo depois, cada arquivo (fotos e base) sai no seu `apagarArquivo` com o ponteiro no `naMesmaTransacao` (`soltarArquivosDoPreparo`, T5; chamada pela T9 e pelo envio do PDF assinado do 10B), e a varredura da T7 repete o que falhou. Em `assinado`/`substituido`/`cancelado` o gatilho (T2) só deixa esses ponteiros **sair** (base → NULL, fotos encolhem), nunca trocar nem crescer | Regra 9 do CLAUDE.md (o ponteiro sai no `naMesmaTransacao` do `apagarArquivo` do arquivo, nunca numa transação separada) — achado do `/code-review high` do PR #18. A v0.4 da spec corrige a RN-140 (b) |
| US-140: "o Histórico do consultório registra…" | **Não existe** tela "Histórico do consultório". A declaração e a retirada da habilitação ficam no `audit_log` (entidade "Perfil profissional", `patient_id` nulo), conferidas por teste; a tentativa de assinatura com código recusado fica no **Histórico de acessos do paciente**. Uma tela de auditoria do consultório vai para o backlog (P10A-17) | Os critérios não tinham onde ser conferidos na interface |
| D5 da spec (declaração da receita) | O texto proposto cita também "medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas" (Res. CFN 656/2020, art. 1º, § 1º) | Minor 10 da revisão de normas; continua rascunho para a Debby e o CRN-3 |
| Textos novos de interface (divisão e Minors) | Cartão "Aguardando assinatura" no 10A: "Baixe o PDF, imprima, assine à mão e envie fotos das páginas aqui."; recusa `sem_habilitacao`: "A receita tem fitoterápico formulado e a habilitação em Fitoterapia não está mais no seu perfil. Registre a habilitação de novo ou volte a editar a receita."; dica da categoria "Outro": "Extrato ou produto vegetal não entra em "Outro": use "Droga ou derivado vegetal classificado como alimento ou suplemento" ou, com a habilitação, "Fitoterápico (forma farmacêutica ou fórmula magistral)"."; confirmação do admin ao bloquear: "… Só antes do uso real. Bloqueado: o consultório perde a aba Documentos (inclusive Cancelar documento e Entregue pessoalmente), os pacientes deixam de ver e abrir os documentos no app e pelo link do e-mail (nenhum código é enviado), e a verificação pública pelo código continua funcionando."; "Espaço de armazenamento esgotado. Fale com o suporte." no preparo (texto da RNF-143) | Minors 9, 11 e 12 e RNF-143; a confirmação do admin diz o efeito exato do interruptor (correção do `/code-review high` do PR #18) |
| Textos novos de interface | Painel: "Documentos", "Nova receita", "Receita", "Situação", "Data", "Nenhum documento ainda.", "Itens da receita", "Adicionar item", "Tipo do item", "Remover item {n}", "Categoria", "Componente", "Quantidade", "Unidade", "Adicionar componente", "Forma de apresentação", "Via", "Posologia", "Duração", "Manipulado", "Nomenclatura botânica", "Parte utilizada", "Modo de preparo", "Forma de utilização e preparo", "Nome popular", "Forma farmacêutica", "Dose", "Padronização do marcador", "Forma ou meio de extração", "Orientações gerais", "Justificativa de uso", "Fica no prontuário, não vai na receita.", "Salvar rascunho", "Apagar rascunho", "Apagar este rascunho?", "Rascunho apagado.", "Preparar para assinatura", "Declaração", "Confirmar e preparar", "Preparando o PDF…", "Baixar PDF para assinar", "Enviar documento digitalizado (assinado à mão)", "Fotos das páginas (JPEG ou PNG, até 5)", "Código da verificação em duas etapas", "Enviando…", "Montando o PDF digitalizado…", "Não foi possível montar o PDF. Envie as fotos de novo.", "Envie fotos das páginas (JPEG ou PNG).", "Envie de 1 a 5 fotos, até 10 MB no total.", "Baixar PDF assinado", "Entregue pessoalmente", "Marcar como entregue pessoalmente?", "Reenviar link por e-mail", "Link reenviado.", "Documentos aguardando assinatura", "{n} documento(s) aguardando assinatura", "Dados para documentos", "Nome completo", "E-mail profissional", "Telefone profissional", "Registro da habilitação no CRN", "Retirar habilitação", "Habilitação em Fitoterapia retirada do perfil.", "Dados para documentos salvos.", "Assinado em", "Assinatura", "Código de verificação", "Documento anonimizado.", "Este documento está em outro paciente ou não existe.", "Documento não encontrado.", "Muitas tentativas. Tente de novo em 15 minutos." · Portal: "Documentos", "Meus documentos", "Abrir PDF", "Confirmo que recebi este documento", "Recebimento confirmado em {data}.", "{n} documento(s) novo(s)" · Link: "Abrir documento", "Para abrir o documento, enviaremos um código de 6 dígitos para o seu e-mail.", "Enviar código", "Código enviado. Confira seu e-mail.", "Código", "Abrir", "Código inválido.", "Código vencido. Peça outro.", "Este link expirou. Peça um novo à sua nutricionista.", "Este documento não está mais disponível. Fale com sua nutricionista.", "Aguarde 1 minuto para pedir outro código." · Verificação: "Verificar documento", "Código de verificação (12 caracteres)", "Verificar", "Documento válido", "Tipo", "Emitido por", "Impressão digital do arquivo (SHA-256)" · E-mails: "Você tem um novo documento", "Código para abrir seu documento: {codigo}", "Um documento seu foi atualizado" · Push: "Você tem um novo documento." | Telas novas |

### Itens adiados de planos anteriores e débitos da mesma área

**Incorporados:** P-B8 da spec (cartão do Início, T6); P08-11 só no que toca os arquivos mexidos (nenhum item aberto do P08-11 toca `documentos`); o Minor da revisão do Plano 08 sobre o 2FA da nutricionista opcional fica como está (o 2FA passa a ser condição só para assinar).

**Não incorporados:** tudo do certificado (Plano 10B); a retificação (US-148), o parecer (US-141) e a parte de LGPD do parecer (Plano 13); o plano alimentar com código e confirmação (D12 da spec, depende do CRN-3); os débitos P04-10, P06-12, P07-09 e P08-11 que não tocam documentos (Plano 09).

### Minors das revisões (`revisao-cobertura.md` e `revisao-seguranca-normas.md`, 05/10/2026)

**Aplicados no 10A:** cabeçalho "RASCUNHO" e "Só se o dono aprovar" retirados (decisões ★ aprovadas); `app_anonimizar_documentos` INVOKER registrado como desvio (T2; seg. 15); limpeza diária de `document_access_codes` (T12); gatilho de colunas de `document_access_codes` (T2; seg. 14 e cobertura); gatilho do rascunho sem PDF nem assinatura (T2; seg. 13); `entregue_em` só quando houve entrega (T10); `if (!p.email)` morto retirado (T10 e T15); `lerLinkDocumento` com e-mail vazio → `null` (T10; seg. 8); `situacaoNoPainel(d, fuso)` alinhada (T6); `registrarAssinatura` em arquivo sem sessão, com guarda de grafo (T8, D23); corrida de duas digitalizadas e `pendente` que não expira (T9 e T7, D24); habilitação conferida de novo ao assinar (T8/T9; seg. 9); "Abrir PDF" com o texto da spec e o "fora da cópia offline" com teste (T11); `MSG_CANCELAMENTO.retificacao` retirado (T15); teste da enzima com `expect.unreachable()` (T5); cota esgotada no preparo com a mensagem da RNF-143 (T7, `pdf_status = 'sem_cota'`); declaração com os medicamentos isentos à base de vitaminas (T5; normas 10, rascunho); dica do "Outro" no formulário (T6; normas 11, rascunho); semáforo da rota da digitalizada contado depois de ler o corpo, um envio por usuária (T9; seg. 6, que também vale para o 10B).

**Aplicado em parte:** seg. 12 (interruptor do admin desligado depois do uso real) — **não** mudamos a regra do D20 no código (a aba e as ações continuam atrás de um só interruptor); a confirmação do admin avisa o efeito e o runbook manda não desligar depois do uso real. Motivo: separar "bloquear novas receitas" de "manter cancelar e entrega" pede um segundo estado e telas parciais, escopo a mais sem pedido do dono; vai para o backlog (P10A-17) se o dono quiser.

**Do Plano 10B** (aplicados lá): seg. 1 a 5 e 7, as interfaces das âncoras e da conferência, e o `serialNumber` da fábrica de certificados de teste pelo OID.

## Review Focus

1. **Fotos da digitalizada no limite.** Um PDF com `/OpenAction` enviado no campo das fotos; 6 fotos; um PNG de poucos bytes que declara 30.000 × 30.000; uma foto do celular com EXIF, GPS e orientação 6; dois envios da mesma receita ao mesmo tempo (duas abas); um envio que travou em "Montando o PDF digitalizado…" e nunca termina. Esperado: "Envie fotos das páginas (JPEG ou PNG).", o processo de pé, o PDF final sem nenhum metadado da foto e com a página girada certa, um envio aceito e o outro com 409 sem fotos somadas, e o "falhou" depois de 1 h com o formulário de volta. Testes na Tarefa 9 (e a varredura na 7).
2. **Código do 2FA no limite.** Código errado 5 vezes, o 6º certo dentro dos 15 min; o mesmo código certo usado duas vezes em 30 s (dois envios); usuária sem 2FA ativo; código com espaço ("123 456"). Esperado: "Muitas tentativas…" a partir da 6ª tentativa, a repetição recusada, "Ative a verificação em duas etapas…" antes de qualquer gravação, o espaço aceito, a tentativa recusada no Histórico de acessos do paciente. Testes nas Tarefas 4 e 9.
3. **Link de uso único na caixa de entrada errada.** O GET do link feito pelo leitor de links do Outlook antes do paciente; o link aberto depois de o e-mail do paciente ser corrigido; 6 códigos pedidos em 1 hora; o código certo digitado duas vezes; o link de um documento depois cancelado; a página aberta com o cookie da sessão de outro link; uma sessão do portal tentando zerar `tentativas`. Esperado: o GET não gasta nada; link com e-mail antigo → "Este documento não está mais disponível…"; o 6º pedido recusado; o segundo uso do código recusado; documento cancelado indisponível; a sessão de um link não abre outro; o gatilho recusa o UPDATE. Testes nas Tarefas 12 e 2.
4. **Receita no limite dos campos.** Probiótico em "mg", enzima em "UI", 21 itens, 11 componentes, quantidade "0" ou "1e9", posologia com 301 caracteres, fitoterápico com a habilitação retirada entre o salvar e o preparar **e entre o preparar e o envio das fotos**, justificativa vazia só no preparar, "Droga ou derivado vegetal…" sem habilitação (vale). Esperado: as mensagens exatas da US-142 por campo; o servidor confere a habilitação de novo no preparar e no envio. Testes nas Tarefas 5, 8 e 9.
5. **O documento muda por baixo do envio.** "Voltar a editar" e um novo preparo noutra aba enquanto as fotos sobem; o worker que termina a montagem depois disso; um UPDATE direto no conteúdo de um documento assinado; o DELETE de um emitido; o `apagarArquivo` avulso do PDF assinado; a anonimização de um paciente ativo. Esperado: 409 e nenhuma foto presa à versão nova; o worker não assina a versão nova; o gatilho recusa (42501); a FK `NO ACTION` recusa; a função só roda no worker com paciente bloqueado. Testes nas Tarefas 2, 8 e 9.

---

## Estrutura de arquivos

```
drizzle/
  0089_documentos_assinados (gerada: 5 tabelas, colunas de tenants, CHECKs de stored_files e notifications)              # T1
  0090_rls_documentos (custom: RLS, staff_only, auditoria, escrita do paciente, paciente_so_emitidos, paciente_arquivos, privilégios)  # T1
  0091_documentos_imutaveis (custom: app_documento_imutavel, app_notas_imutaveis, app_anonimizar_documentos, app_codigo_acesso_regras)  # T2
src/db/schema/documentos.ts (+ index.ts) · platform.ts (tenants, stored_files) · agenda.ts (notifications)              # T1
src/db/rls-guard.ts (+test) · audit-guard.ts · tenant.ts (SEM_CONTA_PERMITIDOS) · documentos-schema.test.ts · documentos-imutaveis.test.ts   # T1, T2, T10
src/lib/confirmar-2fa.ts (+test)                                                                                        # T4
src/lib/sentry-filtro.ts (+test) · next.config.ts                                                                       # T12, T13
src/modules/documentos/
  constantes.ts · erros.ts                                                                                              # T1 (T5, T9 acrescentam)
  perfil-profissional.ts (+test)                                                                                        # T3
  codigo.ts (+test) · prescricao.ts (+test) · documentos.ts (+test) · arquivos-do-preparo.ts                            # T5 (T6, T7 acrescentam)
  documento-pdf.tsx · documento-pdf-job.ts (+test)                                                                      # T7
  registrar-assinatura.ts (+test) · verificacao.ts (+test)                                                              # T8 (T10, T13 acrescentam)
  digitalizada.ts (+test) · digitalizada-job.ts (+test)                                                                 # T9
  entrega.ts (+test) · recebimento.ts · link-documento.ts (+test)                                                       # T10, T12
  portal.ts (+test)                                                                                                     # T11
  verificacao-publica.test.ts                                                                                           # T13
  lgpd-documentos.ts (+test)                                                                                            # T14
  cancelamento.ts (+test)                                                                                               # T15
src/modules/plataforma/audit.ts · armazenamento.ts · contas.ts                                                          # T1, T6
src/modules/agenda/limite-ip.ts · inicio.ts                                                                             # T4, T6
src/modules/notificacoes/{tipos,mensagens}.ts · src/email/{types.ts,templates.tsx}                                      # T1, T10, T12, T15
src/modules/pacientes/{lgpd,exportacao-job}.ts (+test)                                                                  # T14
src/modules/ajuda/conteudo.ts (+test)                                                                                   # T3, T4, T6, T16
src/jobs/queues.ts · src/worker/index.ts                                                                                # T5, T7, T9, T12
src/app/painel/configuracoes/perfil/{page.tsx, documentos-form.tsx, fitoterapia-form.tsx, actions.ts}                   # T3
src/app/painel/pacientes/[id]/abas.tsx · documentos/{page.tsx, actions.ts} · documentos/[docId]/{page.tsx, receita-form.tsx, preparar.tsx, estado-pdf.tsx, enviar-digitalizada.tsx, entrega.tsx, cancelar.tsx}   # T6, T9, T10, T15
src/app/painel/page.tsx (cartão do Início) · src/app/admin/{page.tsx,actions.ts} (interruptor D20)                      # T6
src/app/api/painel/documentos/[id]/{pdf,digitalizada}/route.ts (+tests)                                                 # T7, T9
src/app/conta/seguranca/page.tsx (+ ajuda-seguranca.tsx)                                                                # T4
src/app/p/navegacao.ts · (portal)/documentos/{page.tsx, actions.ts} · (portal)/inicio/page.tsx · (portal)/perfil/page.tsx · src/app/sw-regras.test.ts   # T11
src/app/api/p/documentos/[id]/pdf/route.ts                                                                              # T11
src/app/documento/[token]/{page.tsx, codigo-form.tsx} · src/app/api/documento/[token]/{codigo,confirmar,recebido,pdf}/route.ts   # T12
src/app/v/{page.tsx, [codigo]/page.tsx}                                                                                 # T13
test/documentos.ts · test/isolamento.test.ts                                                                            # T1, T8
e2e/documentos.spec.ts · e2e/painel-rotas.ts · e2e/painel.ts · e2e/acessibilidade.spec.ts · scripts/e2e-seed.ts          # T6, T16
docs/operacao/go-live.md                                                                                                # T16
CLAUDE.md                                                                                                               # T1 (regras 1, 2, 8, 9), T4 (regra 1)
```

**Ordem e dependências:** ver D21.

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// src/modules/documentos/constantes.ts (T1; sem imports — usado por componentes 'use client')
export type TipoAssinatura = 'digitalizada';                  // o Plano 10B amplia para 'govbr' | 'icp' | 'digitalizada'
export type AreaAssinatura = { x1: number; y1: number; x2: number; y2: number };
export const AREA_ASSINATURA: AreaAssinatura;                  // { x1: 351, y1: 62, x2: 559, y2: 132 }
export const STATUS_DOCUMENTO = ['rascunho', 'preparando', 'aguardando_assinatura', 'assinado', 'substituido', 'cancelado'] as const;
export const EMITIDOS: readonly StatusDocumento[];             // ['assinado', 'substituido', 'cancelado']
// src/modules/documentos/erros.ts (T1)
export class RecusaAssinaturaError extends Error { codigo: CodigoRecusa; motivoTecnico: string; mensagem(): string }
// src/modules/documentos/codigo.ts (T5)
export function gerarCodigo(): string;                       // 12 caracteres Crockford maiúsculos
export function normalizarCodigo(entrada: unknown): string | null;
export function formatarCodigo(codigo: string): string;      // XXXX-XXXX-XXXX
// src/modules/documentos/arquivos-do-preparo.ts (T5; sem sessão — o painel e o worker importam)
export function soltarArquivosDoPreparo(ctx: TenantContext, documentoId: string, estados: readonly StatusDocumento[], deps?: { db?: Db; dataDir?: string; soFotos?: boolean }): Promise<number>;
// src/lib/confirmar-2fa.ts (T4)
export function confirmarCodigo2fa(e: { userId: string; codigo: unknown; headers: Headers }, deps?: Deps2fa): Promise<'ok' | 'invalido' | 'bloqueado'>;
// src/modules/documentos/registrar-assinatura.ts (T8; sem sessão — o worker e o 10B importam)
export type AcessoAssinatura = { ctx: TenantContext; tenant: TenantRow; user: { id: string; email: string; twoFactorEnabled: boolean | null } };
export type DepsAssinar = { headers: Headers; db?: Db; dataDir?: string; agora?: Date; appUrl?: string; confirmar2fa?: (…) => Promise<'ok' | 'invalido' | 'bloqueado'> };
export type VersaoLida = { codigo: string } & ({ baseSha256: string } | { digitalizacaoPendente: true });
export function registrarAssinatura(tx: Tx, a: AssinaturaAceita): Promise<void>;   // a T10 acrescenta a entrega e `appUrl`
export function exigirHabilitacaoAtual(tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, conteudo: ConteudoReceita): void;
// src/modules/documentos/verificacao.ts (T8; leitura pública na T13)
export function registrarVerificacao(tx: Tx, v: NovaVerificacao): Promise<void>;
export function mudarSituacao(tx: Tx, documentoId: string, situacao: SituacaoVerificacao, em: Date): Promise<void>;
// src/modules/documentos/entrega.ts (T10)
export function entregarDocumento(tx: Tx, e: { tenantId: string; patientId: string; documentoId: string; agora: Date; appUrl: string }): Promise<'portal' | 'link' | 'nenhuma'>;
// test/documentos.ts (T1, T8)
export function documentoNoBanco(db, ctx, patientId, o?): Promise<{ id: string; codigo: string | null; pdfPath: string | null }>;
export function novoConsultorio(db); export function outroDocumento(c, db, o?: { base?: Buffer; conteudo?: object }); export function novoPreparoNoBanco(x, db); export function liberarDocumentos(db, tenantId);
```

### Task 1: Banco — tabelas dos documentos, RLS, escrita do paciente, tipos de arquivo e de aviso, guardas (P10A-01; antiga T2)

**Files:**
- Create: `src/db/schema/documentos.ts`, `drizzle/0089_documentos_assinados.sql` (gerada), `drizzle/0090_rls_documentos.sql` (custom), `src/db/documentos-schema.test.ts`, `src/modules/documentos/constantes.ts` (no plano único nascia na antiga T1a, que foi para o Plano 10B), `src/modules/documentos/erros.ts`, `test/documentos.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/platform.ts` (`tenants`, `stored_files`), `src/db/schema/agenda.ts` (`notifications_tipo_valido`), `src/db/rls-guard.ts` (+ `rls-guard.test.ts` se listar exceções), `src/db/audit-guard.ts`, `src/modules/plataforma/audit.ts`, `src/modules/plataforma/armazenamento.ts`, `src/modules/notificacoes/tipos.ts`, `test/isolamento.test.ts`, `CLAUDE.md` (regras 1, 2, 8 e 9)

**Interfaces:**
- Consumes: `app_enable_tenant_rls`, `app_enable_patient_rls`, `app_enable_audit`, `app_enable_staff_only`, `app_allow_paciente_escrita` (0000/0007/0020/0070); `tenants`, `storedFiles` (`platform.ts`), `patients` (`pacientes.ts`). Nada do Plano 10B.
- Produces:
  - `@/db/schema`: `signedDocuments`, `signedDocumentNotes`, `signedDocumentReceipts`, `documentAccessCodes`, `documentVerifications` e os tipos `SignedDocumentRow`, `SignedDocumentReceiptRow`, `DocumentVerificationRow`; `tenants.nomeProfissional`, `contatoEmail`, `contatoTelefoneE164`, `fitoterapiaRegistro`, `fitoterapiaDeclaradaEm`, `fitoterapiaTermoVersao`, `documentosLiberados`.
  - `TipoDeArquivo` + `TIPOS_DO_PACIENTE` com `'documento_base' | 'documento_assinado' | 'documento_digitalizado'`; `TipoNotificacao` com `'documento_novo' | 'documento_atualizado'` (rótulos "Documento novo", "Documento atualizado").
  - `constantes.ts` (sem imports): `TipoAssinatura` (no 10A só `'digitalizada'`; o Plano 10B amplia para `'govbr' | 'icp' | 'digitalizada'`), `AreaAssinatura`, `AREA_ASSINATURA` (`{ x1: 351, y1: 62, x2: 559, y2: 132 }`), `TOLERANCIA_AREA_PT = 2`, `STATUS_DOCUMENTO`, `StatusDocumento`, `EMITIDOS`, `ROTULO_STATUS`, `ROTULO_ASSINATURA`, `linhaDaAssinatura` ("Assinatura: Digitalizado", RN-157), `SituacaoVerificacao`, `EventoRecibo`, `ViaRecibo`.
  - `erros.ts`: `DocumentoNaoEncontradoError`, `DocumentoError { erros: Record<string, string> }`, `TransicaoInvalidaError`, `RecusaAssinaturaError { codigo: CodigoRecusa }`, `CodigoRecusa` (no 10A: `'sem_2fa' | 'codigo_2fa' | 'tentativas_2fa' | 'imagens' | 'sem_habilitacao'`; o Plano 10B acrescenta os códigos da conferência), `MSG_RECUSA: Record<CodigoRecusa, string>`.
  - `ENTIDADE_ROTULO.documentos = 'Documentos assinados'`, `.perfil_profissional = 'Perfil profissional'`, `.tentativa_assinatura = 'Tentativa de assinatura com código recusado'`.
  - `test/documentos.ts`: `documentoNoBanco(db, ctx, patientId, o?: { status?: StatusDocumento; conteudo?: object; assinaturaTipo?: TipoAssinatura }): Promise<{ id: string; codigo: string | null; pdfPath: string | null }>` (emitido: `digitalizada` por padrão, sem `assinante_nome`; com outro tipo, `assinante_nome = 'DEBBY SILVA'` — só depois do Plano 10B, que amplia o CHECK).

- [ ] **Step 1: Teste do esquema e da RLS (falha)** — `src/db/documentos-schema.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { documentoNoBanco } from '../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string; message?: string };
const restricao = (nome: string) => (e: unknown) => causa(e).constraint === nome;
const negadoRls = (e: unknown) => causa(e).code === '42501';

describe('tabelas de documentos assinados (§10 da spec v0.3)', () => {
  it('CHECKs: código só fora do rascunho e no formato Crockford; emitido sem PDF recusado; tipo só receita no Plano 10A', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, codigo) values (${T.tenantId}, ${p.id}, 'ABCDEFGHJKMN')`)).rejects.toSatisfy(restricao('signed_documents_codigo_so_fora_do_rascunho'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo) values (${T.tenantId}, ${p.id}, 'preparando', 'ABCDEFGHIJKL')`)).rejects.toSatisfy(restricao('signed_documents_codigo_formato'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo) values (${T.tenantId}, ${p.id}, 'assinado', 'ABCDEFGHJKMN')`)).rejects.toSatisfy(restricao('signed_documents_emitido_com_pdf'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, tipo) values (${T.tenantId}, ${p.id}, 'parecer')`)).rejects.toSatisfy(restricao('signed_documents_tipo_valido'));
    // Plano 10A: só a digitalizada existe; o Plano 10B amplia o CHECK para 'govbr' e 'icp'
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, assinatura_tipo) values (${T.tenantId}, ${p.id}, 'govbr')`)).rejects.toSatisfy(restricao('signed_documents_assinatura_tipo_valida'));
  });

  it('paciente_so_emitidos: a sessão de paciente vê o assinado e nunca o rascunho, nem pelo id; não altera nada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const rascunho = await documentoNoBanco(app.db, T.ctx, p.id);
    const assinado = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const comoP = ctxPaciente(T.tenantId, p.id);
    const vistos = await withTenant(comoP, (tx) => tx.execute(sql`select id from signed_documents`), app.db);
    expect(vistos.rows.map((r) => r.id)).toEqual([assinado.id]);
    const porId = await withTenant(comoP, (tx) => tx.execute(sql`select id from signed_documents where id = ${rascunho.id}`), app.db);
    expect(porId.rows).toEqual([]);
    const alterou = await withTenant(comoP, (tx) => tx.execute(sql`update signed_documents set entregue_em = now() where id = ${assinado.id}`), app.db);
    expect(alterou.rowCount).toBe(0); // paciente_sem_update
  });

  it('recibo (D11): o paciente insere o "recebido" do PRÓPRIO documento assinado, uma vez; nunca "pessoalmente", nunca de rascunho; nunca altera nem apaga', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const r = await documentoNoBanco(app.db, T.ctx, p.id);
    const dDoOutro = await documentoNoBanco(app.db, T.ctx, outro.id, { status: 'assinado' });
    const comoP = (s: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    await comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${d.id}, 'recebido', 'portal')`);
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${d.id}, 'recebido', 'portal')`)).rejects.toSatisfy(restricao('signed_document_receipts_um_por_evento'));
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${d.id}, 'aberto', 'pessoalmente')`)).rejects.toSatisfy(negadoRls);
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${r.id}, 'aberto', 'portal')`)).rejects.toSatisfy(negadoRls);
    await expect(comoP(sql`insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) values (${T.tenantId}, ${p.id}, ${dDoOutro.id}, 'aberto', 'portal')`)).rejects.toSatisfy(negadoRls);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`delete from signed_document_receipts where documento_id = ${d.id}`), app.db)).rejects.toSatisfy((e) => causa(e).code === '42501'); // REVOKE DELETE
  });

  it('notas (STAFF_ONLY): a sessão de paciente não vê a justificativa de uso', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${d.id}, 'Baixa exposição solar')`);
    }, app.db);
    const comoP = (s: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    expect((await comoP(sql`select 1 from signed_document_notes`)).rows).toEqual([]);
  });

  it('document_verifications: fora da RLS, o app insere e muda só a situação; nunca apaga nem muda o SHA-256; no 10A só a digitalizada', async () => {
    const T = await novoTenant(app.db);
    const codigo = 'ABCDEFGHJKMN'.split('').sort(() => Math.random() - 0.5).join('');
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, situacao, situacao_em, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
      values (${codigo}, ${T.tenantId}, ${randomUUID()}, 'receita', 'valido', now(), now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    await app.db.execute(sql`update document_verifications set situacao = 'cancelado', situacao_em = now() where codigo = ${codigo}`);
    await expect(app.db.execute(sql`update document_verifications set pdf_sha256 = ${'b'.repeat(64)} where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`delete from document_verifications where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${codigo.split('').reverse().join('')}, ${T.tenantId}, ${randomUUID()}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', 'DEBBY', 'icp', ${'a'.repeat(64)})`)).rejects.toSatisfy(restricao('document_verifications_assinatura_tipo_valida'));
  });

  it('paciente_arquivos: o paciente não vê a linha do PDF preparado (documento_base) nem das fotos da digitalizada; vê a do assinado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const caminho = (tipo: string) => `${T.tenantId}/${tipo}/${randomUUID()}.pdf`;
    await withTenant(T.ctx, async (tx) => {
      for (const tipo of ['documento_base', 'documento_digitalizado', 'documento_assinado'])
        await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, ${tipo}, ${caminho(tipo)}, 10, 'application/pdf', ${p.id})`);
    }, app.db);
    const vistos = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`select tipo from stored_files where tipo like 'documento_%'`), app.db);
    expect(vistos.rows.map((r) => r.tipo)).toEqual(['documento_assinado']);
  });
});
```

Run: `pnpm test src/db/documentos-schema.test.ts` → FAIL (relation "signed_documents" does not exist).

- [ ] **Step 2: Constantes e erros** — criar `src/modules/documentos/constantes.ts` e `erros.ts`

```ts
// src/modules/documentos/constantes.ts
/**
 * Planos 10A e 10B — documentos assinados. SEM imports: componentes 'use client' leem daqui (como marca-constantes.ts).
 * No Plano 10A só existe a assinatura digitalizada (opção E); o Plano 10B amplia `TipoAssinatura` e `ROTULO_ASSINATURA`
 * com 'govbr' e 'icp' (e os CHECKs do banco, migration própria).
 */
export type TipoAssinatura = 'digitalizada';
/** Pontos PDF, origem no canto de baixo à esquerda (A4 = 595 × 842). */
export type AreaAssinatura = { x1: number; y1: number; x2: number; y2: number };

/**
 * D15 / RN-144 (6): o quadro "Assinatura digital", em branco, no rodapé de CADA página, à direita (208 × 70 pt), acima
 * da faixa do código e do QR. Nasce no 10A (o PDF preparado é o mesmo nos dois planos: um documento preparado antes do
 * 10B pode ser assinado com certificado depois dele); a conferência do 10B aceita o widget de área zero ou dentro dele.
 */
export const AREA_ASSINATURA: AreaAssinatura = { x1: 351, y1: 62, x2: 559, y2: 132 };
export const TOLERANCIA_AREA_PT = 2;

export const STATUS_DOCUMENTO = ['rascunho', 'preparando', 'aguardando_assinatura', 'assinado', 'substituido', 'cancelado'] as const;
export type StatusDocumento = (typeof STATUS_DOCUMENTO)[number];
/** RN-141: o que a sessão de paciente vê (paciente_so_emitidos, 0090). */
export const EMITIDOS: readonly StatusDocumento[] = ['assinado', 'substituido', 'cancelado'];
export const ROTULO_STATUS: Record<StatusDocumento, string> = {
  rascunho: 'Rascunho',
  preparando: 'Preparando o PDF',
  aguardando_assinatura: 'Aguardando assinatura',
  assinado: 'Assinado',
  substituido: 'Substituído',
  cancelado: 'Cancelado',
};
/** O Plano 10B acrescenta `govbr: 'gov.br'` e `icp: 'Certificado ICP-Brasil'`. */
export const ROTULO_ASSINATURA: Record<TipoAssinatura, string> = { digitalizada: 'Digitalizado' };
/** RN-157 / US-144 / US-147: a mesma linha no portal, na lista da nutricionista, na página do documento e na /v. */
export const linhaDaAssinatura = (t: TipoAssinatura): string => `Assinatura: ${ROTULO_ASSINATURA[t]}`;
export type SituacaoVerificacao = 'valido' | 'substituido' | 'cancelado' | 'eliminado';
export type EventoRecibo = 'aberto' | 'recebido';
export type ViaRecibo = 'portal' | 'link_email' | 'pessoalmente';
export const TIPO_DOCUMENTO_ROTULO = { receita: 'Receita' } as const;
```

```ts
// src/modules/documentos/erros.ts
/** Erros do módulo de documentos. As mensagens são as da spec v0.3 (US-142 a US-144): nunca levam CN, CPF ou conteúdo. */
export class DocumentoNaoEncontradoError extends Error {
  override name = 'DocumentoNaoEncontradoError';
  constructor() {
    super('Documento não encontrado.');
  }
}
export class DocumentoError extends Error {
  override name = 'DocumentoError';
  constructor(readonly erros: Record<string, string>) {
    super(Object.values(erros)[0] ?? 'Documento inválido.');
  }
}
/** RN-141: a ação não vale no estado atual (outra aba já preparou, assinou, voltou a editar…). */
export class TransicaoInvalidaError extends Error {
  override name = 'TransicaoInvalidaError';
  constructor() {
    super('Este documento mudou de situação. Recarregue a página.');
  }
}

/** Plano 10A: as recusas do envio digitalizado. O Plano 10B acrescenta as da conferência do PDF assinado (US-144). */
export type CodigoRecusa = 'sem_2fa' | 'codigo_2fa' | 'tentativas_2fa' | 'imagens' | 'sem_habilitacao';

/** US-144 (texto exato da spec v0.3); `sem_habilitacao` é texto novo deste plano (Minor 9 da revisão de segurança, tabela de desvios). */
export const MSG_RECUSA: Record<CodigoRecusa, string> = {
  sem_2fa: 'Ative a verificação em duas etapas em Segurança para assinar documentos.',
  codigo_2fa: 'Código inválido. Confira o horário do celular e tente de novo.',
  tentativas_2fa: 'Muitas tentativas. Tente de novo em 15 minutos.',
  imagens: 'Envie fotos das páginas (JPEG ou PNG).',
  sem_habilitacao: 'A receita tem fitoterápico formulado e a habilitação em Fitoterapia não está mais no seu perfil. Registre a habilitação de novo ou volte a editar a receita.',
};

export class RecusaAssinaturaError extends Error {
  override name = 'RecusaAssinaturaError';
  /** `motivoTecnico`: só para o log (fixo, sem dado pessoal), ex.: "pixels". O Plano 10B acrescenta o nome do certificado. */
  constructor(readonly codigo: CodigoRecusa, readonly motivoTecnico: string = codigo) {
    super(MSG_RECUSA[codigo]);
  }
  /** A mensagem da tela (as rotas usam sempre esta; o 10B a estende com o nome do certificado). */
  mensagem(): string {
    return MSG_RECUSA[this.codigo];
  }
}
```

- [ ] **Step 3: Schema Drizzle** — `src/db/schema/documentos.ts` (e `export * from './documentos'` em `src/db/schema/index.ts`)

```ts
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

const EMITIDOS_SQL = sql.raw(`('assinado','substituido','cancelado')`);
const EM_ANDAMENTO_SQL = sql.raw(`('rascunho','preparando','aguardando_assinatura')`);

/**
 * Spec de documentos assinados v0.3, §10. Imutabilidade no banco (gatilho app_documento_imutavel, 0091); a sessão de
 * paciente só vê os emitidos (paciente_so_emitidos, 0090) e nunca altera. FKs NO ACTION para stored_files (RN-140): um
 * apagarArquivo avulso sobre um PDF ainda referenciado é recusado. `conteudo` (Zod em prescricao.ts) NÃO tem a justificativa.
 */
export const signedDocuments = pgTable(
  'signed_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    tipo: text('tipo').notNull().default('receita'),
    status: text('status').notNull().default('rascunho'),
    versao: smallint('versao').notNull().default(1),
    retificaId: uuid('retifica_id'),
    conteudo: jsonb('conteudo').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    declaracaoEm: timestamp('declaracao_em', { withTimezone: true }),
    codigo: text('codigo').unique('signed_documents_codigo_unique'),
    basePdfPath: text('base_pdf_path').references(() => storedFiles.caminho),
    basePdfSha256: text('base_pdf_sha256'),
    basePdfBytes: integer('base_pdf_bytes'),
    areaAssinatura: jsonb('area_assinatura').$type<{ x1: number; y1: number; x2: number; y2: number }>(),
    pdfStatus: text('pdf_status'),
    pdfPedidoEm: timestamp('pdf_pedido_em', { withTimezone: true }),
    pdfPath: text('pdf_path').references(() => storedFiles.caminho),
    pdfSha256: text('pdf_sha256'),
    assinaturaTipo: text('assinatura_tipo'),
    assinaturaEmissor: text('assinatura_emissor'),
    assinanteNome: text('assinante_nome'),
    assinadoEm: timestamp('assinado_em', { withTimezone: true }),
    assinadoPor: uuid('assinado_por'),
    entregueEm: timestamp('entregue_em', { withTimezone: true }),
    canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
    substituidoEm: timestamp('substituido_em', { withTimezone: true }),
    anonimizadoEm: timestamp('anonimizado_em', { withTimezone: true }),
    /**
     * D4: caminhos das fotos da digitalizada até o worker montar o PDF. `digitalizacao_status`: `recebendo` (um envio em
     * curso trava o documento: dois envios simultâneos não somam fotos), `pendente` (o worker monta) ou `falhou`;
     * `digitalizacao_em` = início do envio, para a varredura expirar `recebendo`/`pendente` esquecidos (D24, Minors).
     */
    digitalizacao: jsonb('digitalizacao').$type<string[]>(),
    digitalizacaoStatus: text('digitalizacao_status'),
    digitalizacaoEm: timestamp('digitalizacao_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('signed_documents_tipo_valido', sql`${t.tipo} in ('receita')`),
    check('signed_documents_status_valido', sql`${t.status} in ('rascunho','preparando','aguardando_assinatura','assinado','substituido','cancelado')`),
    check('signed_documents_codigo_so_fora_do_rascunho', sql`(${t.codigo} is null) = (${t.status} = 'rascunho')`),
    check('signed_documents_codigo_formato', sql`${t.codigo} is null or ${t.codigo} ~ '^[0-9A-HJKMNP-TV-Z]{12}$'`),
    check(
      'signed_documents_emitido_com_pdf',
      sql`${t.anonimizadoEm} is not null or ((${t.pdfPath} is not null and ${t.pdfSha256} is not null and ${t.assinadoEm} is not null and ${t.assinaturaTipo} is not null) = (${t.status} in ${EMITIDOS_SQL}))`,
    ),
    // Plano 10A: só a digitalizada; o Plano 10B troca por ('govbr','icp','digitalizada') numa migration gerada
    check('signed_documents_assinatura_tipo_valida', sql`${t.assinaturaTipo} is null or ${t.assinaturaTipo} in ('digitalizada')`),
    // 'sem_cota' (RNF-143): a tela mostra "Espaço de armazenamento esgotado…" em vez de "Não foi possível gerar o PDF"
    check('signed_documents_pdf_status_valido', sql`${t.pdfStatus} is null or ${t.pdfStatus} in ('pendente','pronto','falhou','sem_cota')`),
    check('signed_documents_digitalizacao_status_valido', sql`${t.digitalizacaoStatus} is null or ${t.digitalizacaoStatus} in ('recebendo','pendente','falhou')`),
    check('signed_documents_sha256_formato', sql`(${t.pdfSha256} is null or ${t.pdfSha256} ~ '^[0-9a-f]{64}$') and (${t.basePdfSha256} is null or ${t.basePdfSha256} ~ '^[0-9a-f]{64}$')`),
    check('signed_documents_textos_tamanho', sql`coalesce(char_length(${t.assinanteNome}), 0) <= 200 and coalesce(char_length(${t.assinaturaEmissor}), 0) <= 200`),
    check('signed_documents_arquivos_do_tenant', sql`(${t.basePdfPath} is null or ${t.basePdfPath} like ${t.tenantId}::text || '/documento_base/%') and (${t.pdfPath} is null or ${t.pdfPath} like ${t.tenantId}::text || '/documento_%')`),
    check('signed_documents_versao_positiva', sql`${t.versao} >= 1`),
    unique('signed_documents_tenant_id_unique').on(t.tenantId, t.id),
    unique('signed_documents_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'signed_documents_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.patientId, t.retificaId], foreignColumns: [t.tenantId, t.patientId, t.id], name: 'signed_documents_retifica_fk' }),
    // RN-146 (Plano 13): uma retificação em andamento por documento
    uniqueIndex('signed_documents_retificacao_aberta').on(t.retificaId).where(sql`${t.status} in ${EM_ANDAMENTO_SQL}`),
    index('signed_documents_paciente_idx').on(t.tenantId, t.patientId, t.createdAt.desc()),
    index('signed_documents_status_idx').on(t.tenantId, t.status),
  ],
);
export type SignedDocumentRow = typeof signedDocuments.$inferSelect;

/** D15 da spec: o que o paciente nunca lê (STAFF_ONLY). PK id (o gatilho de auditoria grava entidade_id = id). */
export const signedDocumentNotes = pgTable(
  'signed_document_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    documentoId: uuid('documento_id').notNull().unique('signed_document_notes_documento_unique'),
    justificativaUso: text('justificativa_uso'),
    motivoCancelamento: text('motivo_cancelamento'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('signed_document_notes_tamanhos', sql`coalesce(char_length(${t.justificativaUso}), 0) <= 2000 and coalesce(char_length(${t.motivoCancelamento}), 0) <= 500`),
    foreignKey({ columns: [t.tenantId, t.patientId, t.documentoId], foreignColumns: [signedDocuments.tenantId, signedDocuments.patientId, signedDocuments.id], name: 'signed_document_notes_documento_fk' }).onDelete('cascade'),
  ],
);

/** D11 / D4 da spec: recibo só INSERT (REVOKE UPDATE, DELETE na 0090). */
export const signedDocumentReceipts = pgTable(
  'signed_document_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    documentoId: uuid('documento_id').notNull(),
    evento: text('evento').notNull(),
    via: text('via').notNull(),
    em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
    registradoPor: uuid('registrado_por'),
  },
  (t) => [
    check('signed_document_receipts_evento_valido', sql`${t.evento} in ('aberto','recebido')`),
    check('signed_document_receipts_via_valida', sql`${t.via} in ('portal','link_email','pessoalmente')`),
    check('signed_document_receipts_pessoalmente', sql`(${t.via} = 'pessoalmente') = (${t.registradoPor} is not null) and (${t.via} <> 'pessoalmente' or ${t.evento} = 'recebido')`),
    unique('signed_document_receipts_um_por_evento').on(t.documentoId, t.evento),
    foreignKey({ columns: [t.tenantId, t.patientId, t.documentoId], foreignColumns: [signedDocuments.tenantId, signedDocuments.patientId, signedDocuments.id], name: 'signed_document_receipts_documento_fk' }),
  ],
);
export type SignedDocumentReceiptRow = typeof signedDocumentReceipts.$inferSelect;

/** RN-158 / D12: códigos do link de uso único (só HMAC). Escritos pela sessão de paciente sem login (semConta). */
export const documentAccessCodes = pgTable(
  'document_access_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    documentoId: uuid('documento_id').notNull(),
    codigoHash: text('codigo_hash').notNull(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    tentativas: smallint('tentativas').notNull().default(0),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    sessaoHash: text('sessao_hash'),
    sessaoExpiraEm: timestamp('sessao_expira_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('document_access_codes_tentativas', sql`${t.tentativas} between 0 and 5`),
    check('document_access_codes_sessao', sql`(${t.sessaoHash} is null) = (${t.sessaoExpiraEm} is null) and (${t.sessaoHash} is null or ${t.usadoEm} is not null)`),
    foreignKey({ columns: [t.tenantId, t.patientId, t.documentoId], foreignColumns: [signedDocuments.tenantId, signedDocuments.patientId, signedDocuments.id], name: 'document_access_codes_documento_fk' }),
    index('document_access_codes_documento_idx').on(t.tenantId, t.documentoId, t.createdAt.desc()),
  ],
);

/** RN-156 / D8: a única fonte da página pública. Fora da RLS (RLS_EXCEPTIONS); só verificacao.ts a acessa; sem dado do paciente. */
export const documentVerifications = pgTable(
  'document_verifications',
  {
    codigo: text('codigo').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    documentoId: uuid('documento_id').notNull(),
    tipo: text('tipo').notNull(),
    situacao: text('situacao').notNull().default('valido'),
    situacaoEm: timestamp('situacao_em', { withTimezone: true }).notNull().defaultNow(),
    assinadoEm: timestamp('assinado_em', { withTimezone: true }).notNull(),
    emissorNome: text('emissor_nome').notNull(),
    emissorCrn: text('emissor_crn').notNull(),
    assinanteNome: text('assinante_nome'),
    assinaturaTipo: text('assinatura_tipo').notNull(),
    pdfSha256: text('pdf_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('document_verifications_situacao_valida', sql`${t.situacao} in ('valido','substituido','cancelado','eliminado')`),
    check('document_verifications_codigo_formato', sql`${t.codigo} ~ '^[0-9A-HJKMNP-TV-Z]{12}$'`),
    check('document_verifications_assinante', sql`(${t.assinaturaTipo} = 'digitalizada') = (${t.assinanteNome} is null)`),
    // Plano 10A: só a digitalizada; o Plano 10B amplia (mesma migration que amplia o de signed_documents)
    check('document_verifications_assinatura_tipo_valida', sql`${t.assinaturaTipo} in ('digitalizada')`),
    unique('document_verifications_documento_unique').on(t.documentoId),
  ],
);
export type DocumentVerificationRow = typeof documentVerifications.$inferSelect;
```

> `assinatura_emissor` e `assinante_nome` (em `signed_documents` e `document_verifications`) e `base_pdf_bytes`/`area_assinatura` nascem aqui e ficam nulos ou sem uso na conferência até o Plano 10B: assim o 10B não mexe na tabela que já terá receitas assinadas (só amplia dois CHECKs e cria a tabela do assinante do consultório), e um documento preparado no 10A pode ser assinado com certificado depois dele (D22).

Em `platform.ts`, `tenants` ganha (com os CHECKs na lista do `(t) => [...]`):

```ts
    /** US-140 (Plano 10A): dados do carimbo dos documentos. */
    nomeProfissional: text('nome_profissional'),
    contatoEmail: text('contato_email'),
    contatoTelefoneE164: text('contato_telefone_e164'),
    /** D6 da spec: autodeclaração da habilitação em Fitoterapia (registro, data e versão do termo juntos ou nulos). */
    fitoterapiaRegistro: text('fitoterapia_registro'),
    fitoterapiaDeclaradaEm: timestamp('fitoterapia_declarada_em', { withTimezone: true }),
    fitoterapiaTermoVersao: text('fitoterapia_termo_versao'),
    /** D20 do Plano 10A: documentos só depois da liberação para uso real (CRN-3, termo, backup); o admin liga. */
    documentosLiberados: boolean('documentos_liberados').notNull().default(false),
```

```ts
    check('tenants_nome_profissional_tamanho', sql`${t.nomeProfissional} is null or char_length(${t.nomeProfissional}) between 5 and 120`),
    check('tenants_fitoterapia_junta', sql`(${t.fitoterapiaRegistro} is null) = (${t.fitoterapiaDeclaradaEm} is null) and (${t.fitoterapiaRegistro} is null) = (${t.fitoterapiaTermoVersao} is null)`),
    check('tenants_fitoterapia_tamanho', sql`${t.fitoterapiaRegistro} is null or char_length(${t.fitoterapiaRegistro}) between 1 and 60`),
```

`stored_files_tipo_valido` passa a `('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado')` (o `stored_files_dono` já trata os três como "com dono"). Em `agenda.ts`, `notifications_tipo_valido` ganha `'documento_novo', 'documento_atualizado'`.

Run: `pnpm db:generate` → `drizzle/0089_documentos_assinados.sql`. Conferir no SQL gerado: as FKs `base_pdf_path`/`pdf_path` **sem** `ON DELETE` (NO ACTION) e o índice único parcial.

- [ ] **Step 4: RLS, escrita do paciente e privilégios** — `pnpm drizzle-kit generate --custom --name rls_documentos` → `drizzle/0090_rls_documentos.sql`

```sql
-- Plano 10A (spec de documentos assinados v0.3.1, §10). CLAUDE.md regras 2 e 8.
SELECT app_enable_tenant_rls('signed_documents');
--> statement-breakpoint
SELECT app_enable_patient_rls('signed_documents');
--> statement-breakpoint
SELECT app_enable_audit('signed_documents', 'documentos');
--> statement-breakpoint
-- RN-141 / §4: a sessão de paciente só vê documento emitido (como paciente_sem_rascunho, 0045) e nunca grava
CREATE POLICY paciente_so_emitidos ON signed_documents AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR status IN ('assinado', 'substituido', 'cancelado'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente');
--> statement-breakpoint
SELECT app_enable_tenant_rls('signed_document_notes');
--> statement-breakpoint
SELECT app_enable_patient_rls('signed_document_notes');
--> statement-breakpoint
SELECT app_enable_staff_only('signed_document_notes');
--> statement-breakpoint
SELECT app_enable_audit('signed_document_notes', 'documentos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('signed_document_receipts');
--> statement-breakpoint
SELECT app_enable_patient_rls('signed_document_receipts');
--> statement-breakpoint
SELECT app_enable_audit('signed_document_receipts', 'documentos');
--> statement-breakpoint
-- D11: o paciente só INSERE o recibo do próprio documento ASSINADO (a subconsulta passa pela RLS dele:
-- patient_isolation + paciente_so_emitidos), nunca "pessoalmente" (isso é da nutricionista)
SELECT app_allow_paciente_escrita('signed_document_receipts', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_recibo_proprio ON signed_document_receipts AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    via <> 'pessoalmente' AND registrado_por IS NULL AND EXISTS (
      SELECT 1 FROM signed_documents d
       WHERE d.tenant_id = signed_document_receipts.tenant_id AND d.id = signed_document_receipts.documento_id AND d.status = 'assinado')));
--> statement-breakpoint
-- prova de entrega: append-only para a aplicação (como audit_log)
REVOKE UPDATE, DELETE ON signed_document_receipts FROM nutri_app_role;
--> statement-breakpoint
SELECT app_enable_tenant_rls('document_access_codes');
--> statement-breakpoint
SELECT app_enable_patient_rls('document_access_codes');
--> statement-breakpoint
-- RN-158 / D12: o paciente sem login (link-documento.ts, semConta) pede e confere o código do próprio documento
SELECT app_allow_paciente_escrita('document_access_codes', 'insert', 'update');

--> statement-breakpoint
-- RN-156: fora da RLS (RLS_EXCEPTIONS: lida antes de existir contexto de tenant); o app insere e só muda a situação
REVOKE UPDATE, DELETE ON document_verifications FROM nutri_app_role;
--> statement-breakpoint
GRANT UPDATE (situacao, situacao_em) ON document_verifications TO nutri_app_role;
--> statement-breakpoint
-- RNF-141: o paciente vê os próprios arquivos, MENOS o PDF preparado (antes da assinatura) e as fotos da digitalizada
DROP POLICY paciente_arquivos ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (patient_id = app_current_patient() AND tipo NOT IN ('documento_base', 'documento_digitalizado'))
    OR tipo = 'logo'
    OR (tipo = 'capa' AND EXISTS (SELECT 1 FROM contents c WHERE c.tenant_id = stored_files.tenant_id AND c.capa_path = stored_files.caminho))
  )
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
```

- [ ] **Step 5: Listas das guardas, rótulos e tipos**

`src/db/rls-guard.ts`:

```ts
// RLS_EXCEPTIONS
  document_verifications:
    'RN-156: lida pelo código antes de existir contexto de tenant (verificação pública); sem dado de saúde nem do paciente; acesso só por src/modules/documentos/verificacao.ts (guarda em verificacao.test.ts); DELETE e UPDATE revogados, menos situacao/situacao_em (0090)',
// STAFF_ONLY
  signed_document_notes: 'Res. CFN 656, art. 3º, XII / D15 da spec de documentos: justificativa de uso e motivo de cancelamento — só a equipe (a exportação do titular lê pelo worker)',
// PACIENTE_ESCREVE
  signed_document_receipts: { comandos: ['insert'], motivo: 'D4 da spec de documentos: o paciente registra que abriu e confirma o recebimento do próprio documento emitido, uma vez por evento (paciente_recibo_proprio, 0090)' },
  document_access_codes: { comandos: ['insert', 'update'], motivo: 'RN-158 / D3 b: o paciente sem login pede e confere o código do próprio documento (src/modules/documentos/link-documento.ts, semConta)' },
```

`src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS`):

```ts
  document_access_codes: 'RN-158: código do link de uso único (só HMAC, validade, tentativas); não é dado de saúde — a abertura vira evento auditado em signed_document_receipts',
```

`src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`): `documentos: 'Documentos assinados'`, `perfil_profissional: 'Perfil profissional'`, `tentativa_assinatura: 'Tentativa de assinatura com código recusado'`.

`src/modules/plataforma/armazenamento.ts`: `TipoDeArquivo` e `TIPOS_DO_PACIENTE` ganham `'documento_base' | 'documento_assinado' | 'documento_digitalizado'`.

`src/modules/notificacoes/tipos.ts`: `TipoNotificacao` ganha `'documento_novo' | 'documento_atualizado'`; `ROTULO_TIPO.documento_novo = 'Documento novo'`, `ROTULO_TIPO.documento_atualizado = 'Documento atualizado'`.

- [ ] **Step 6: Ajudante de teste** — `test/documentos.ts` (a Tarefa 8 acrescenta `novoConsultorio`, `outroDocumento` e `novoPreparoNoBanco`)

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { StatusDocumento, TipoAssinatura } from '@/modules/documentos/constantes';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const codigoAleatorio = () => Array.from({ length: 12 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join('');

/**
 * Documento gravado direto no banco (sem o fluxo), no estado pedido. Emitido = com o stored_files do PDF assinado (FK NO
 * ACTION), SHA-256 e assinatura digitalizada (a única do 10A; o 10B passa `assinaturaTipo: 'govbr'` nos testes dele).
 * O gatilho de imutabilidade (0091) não olha INSERT.
 */
export async function documentoNoBanco(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  o: { status?: StatusDocumento; conteudo?: Record<string, unknown>; assinaturaTipo?: TipoAssinatura } = {},
): Promise<{ id: string; codigo: string | null; pdfPath: string | null }> {
  const status = o.status ?? 'rascunho';
  const emitido = ['assinado', 'substituido', 'cancelado'].includes(status);
  const codigo = status === 'rascunho' ? null : codigoAleatorio();
  const pdfPath = emitido ? `${ctx.tenantId}/documento_assinado/${randomUUID()}.pdf` : null;
  const id = randomUUID();
  await withTenant(ctx, async (tx) => {
    if (pdfPath)
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_assinado', ${pdfPath}, 100, 'application/pdf', ${patientId})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, pdf_path, pdf_sha256, assinado_em, assinatura_tipo, assinante_nome, entregue_em)
      values (${id}, ${ctx.tenantId}, ${patientId}, ${status}, ${codigo}, ${JSON.stringify(o.conteudo ?? { versao: 1, tipo: 'receita', itens: [], orientacoes: '' })}::jsonb,
              ${pdfPath}, ${emitido ? 'a'.repeat(64) : null}, ${emitido ? new Date() : null}, ${emitido ? (o.assinaturaTipo ?? 'digitalizada') : null}, ${emitido && (o.assinaturaTipo ?? 'digitalizada') !== 'digitalizada' ? 'DEBBY SILVA' : null}, ${emitido ? new Date() : null})`);
  }, db);
  return { id, codigo, pdfPath };
}
```

- [ ] **Step 7: Isolamento (D19)** — `test/isolamento.test.ts`

```ts
// FABRICAS (as fábricas rodam como nutri; documento EMITIDO já anonimizado: visível ao paciente e sem arquivo)
  signed_documents: (t, p) =>
    sql`insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${t}, ${p}, 'assinado', upper(substr(translate(md5(random()::text), 'ilou', '0123'), 1, 12)), now())`,
  signed_document_notes: (t, p) =>
    sql`with d as (insert into signed_documents (tenant_id, patient_id) values (${t}, ${p}) returning id)
        insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) select ${t}, ${p}, d.id, 'Iso' from d`,
  signed_document_receipts: (t, p) =>
    sql`with d as (insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${t}, ${p}, 'assinado', upper(substr(translate(md5(random()::text), 'ilou', '0123'), 1, 12)), now()) returning id)
        insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via) select ${t}, ${p}, d.id, 'aberto', 'portal' from d`,
  document_access_codes: (t, p) =>
    sql`with d as (insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${t}, ${p}, 'assinado', upper(substr(translate(md5(random()::text), 'ilou', '0123'), 1, 12)), now()) returning id)
        insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em) select ${t}, ${p}, d.id, 'h', now() + interval '10 minutes' from d`,
```

```ts
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log', 'signed_document_receipts']);
/**
 * D19 (Plano 10A): o gatilho de imutabilidade (0091) recusa mudar tenant_id/patient_id com 42501 ANTES do WITH CHECK da RLS
 * (mensagem própria, não "row-level security"); em signed_documents, só o rascunho é apagado.
 */
const IMUTAVEIS = new Set(['signed_documents', 'signed_document_notes']);
/**
 * Em signed_documents, só o rascunho é apagado; os EMITIDOS de B ficam (gatilho), e os recibos também (SO_INSERE). Com a
 * FK composta signed_documents_paciente_fk (NO ACTION), o `delete from patients` de B falharia com 23503 nos pacientes
 * que ainda têm documento emitido ou recibo — então patients de B só apaga os pacientes sem eles (revisão do rascunho).
 */
const SO_APAGA: Record<string, SQL> = {
  signed_documents: sql`status = 'rascunho'`,
  patients: sql`not exists (select 1 from signed_documents s where s.tenant_id = patients.tenant_id and s.patient_id = patients.id)
                and not exists (select 1 from signed_document_receipts r where r.tenant_id = patients.tenant_id and r.patient_id = patients.id)`,
};
const ULTIMAS = ['meals', 'meal_plans', 'recipes', 'contents', 'anamnesis_templates', 'foods', 'appointments', 'signed_documents', 'stored_files', 'patients'];
```

Nos testes "WITH CHECK" (tenant B move linha para A; P2 move linha para P1), a recusa esperada vira `IMUTAVEIS.has(t) || colunasConferidas.has(t) ? negado : violaRls`. No teste "o tenant B só vê e só altera as próprias linhas", o DELETE passa a `sql\`delete from ${id}${SO_APAGA[t] ? sql\` where ${SO_APAGA[t]}\` : sql\`\`}\`` e, para `SO_APAGA`, o esperado é "apagou só os rascunhos de B; os emitidos de B continuam; A intacto":

```ts
          const apagaveis = SO_APAGA[t] ? (await tx.execute(sql`select 1 from ${id} where ${SO_APAGA[t]}`)).rows.length : proprias.length;
          const apagadas = await tx.execute(sql`delete from ${id}${SO_APAGA[t] ? sql` where ${SO_APAGA[t]}` : sql``}`);
          expect(apagadas.rowCount, t).toBe(apagaveis); // signed_documents: só os rascunhos de B; patients: só os sem emitido nem recibo
          sobrouDeB = proprias.length - apagaveis;
```

com `let sobrouDeB = 0;` antes do `withTenant` e, depois do bloco, `if (!SO_INSERE.has(t)) expect(await contarTenant(t, B), t).toBe(SO_APAGA[t] ? sobrouDeB : 0);` (o DELETE de B de fato aconteceu; o que sobra é só o que o filtro de `SO_APAGA` deixa — em `patients`, os pacientes de B com documento emitido ou recibo). Os emitidos de B que ficam seguram o `stored_files` deles? Não: a fábrica cria emitido **sem** PDF — anonimizado.

- [ ] **Step 8: CLAUDE.md** (regras 1, 2, 8 e 9; o texto final fica no PR; as funções citadas nascem nas T5 e T11 — o texto entra aqui para valer desde a primeira tarefa)

- Regra 1: "…e, com `tenant_id` mas em `RLS_EXCEPTIONS`, `invites`, `consents` **e `document_verifications`** (verificação pública de documento assinado: só `src/modules/documentos/verificacao.ts`, DELETE revogado e UPDATE só de `situacao`/`situacao_em`, Plano 10A)".
- Regra 2: "Tabela que o paciente só **insere** (prova, como `signed_document_receipts`): `app_allow_paciente_escrita('<tabela>', 'insert')` + `REVOKE UPDATE, DELETE` de `nutri_app_role` + `SO_INSERE` no teste de isolamento."
- Regra 8: "a anonimização de documentos assinados só pela função `app_anonimizar_documentos` (migration 0091, contexto `worker`, ao lado da `app_anonimizar_aceites`); as tabelas com gatilho de imutabilidade (`signed_documents`, `signed_document_notes`) entram em `IMUTAVEIS` do teste de isolamento. As listas de documentos assinados — a do prontuário (`listarDocumentos`) e a do portal (`documentosDoPaciente`) — não chamam `auditRead`, como a agenda e a lista de pacientes (Plano 10A, D17): devolvem só tipo, data, situação, tipo de assinatura e recibos, nunca itens, orientações ou justificativa (teste das chaves em `documentos.test.ts` e `portal.test.ts`); a leitura do conteúdo (`lerDocumento`) e as rotas que assinam a URL do PDF (painel, portal e link) chamam."
- Regra 9: "PDF preparado, PDF assinado e fotos da digitalizada (`documento_base`, `documento_assinado`, `documento_digitalizado`) com FK **`NO ACTION`**; o ponteiro de cada um sai no `naMesmaTransacao` do `apagarArquivo` dele, também depois da assinatura (`soltarArquivosDoPreparo`, `src/modules/documentos/arquivos-do-preparo.ts`: a assinatura mantém `base_pdf_path` e `digitalizacao`, e o gatilho `app_documento_imutavel` só deixa esses ponteiros encolherem num documento emitido); o PDF de documento e o da digitalizada só no worker (`documento-pdf.tsx`, `documento-pdf-job.ts`, `digitalizada-job.ts` — guarda de grafo em `exportacao.test.ts`)."

- [ ] **Step 9: Rodar**

Run: `pnpm test src/db/documentos-schema.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/sem-conta-guarda.test.ts` → PASS (o teste do gatilho de imutabilidade entra na T2; até lá, o caso "move a linha para A" de `IMUTAVEIS` ainda cai na RLS — `negado` aceita os dois).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/{documentos,index,platform,agenda}.ts drizzle/0089_documentos_assinados.sql drizzle/0090_rls_documentos.sql drizzle/meta src/db/{rls-guard,audit-guard,documentos-schema.test}.ts src/modules/plataforma/{audit,armazenamento}.ts src/modules/notificacoes/tipos.ts src/modules/documentos/{constantes,erros}.ts test/documentos.ts test/isolamento.test.ts CLAUDE.md
git commit -m "feat(documentos): tabelas, RLS, recibo só INSERT, verificação fora da RLS e guardas (Plano 10A, T1)"
```

---
### Task 2: Imutabilidade no banco, anonimização e regras do código do link (RN-140, RN-141, CS-141, RN-158; P10A-02; antiga T3)

**Files:**
- Create: `drizzle/0091_documentos_imutaveis.sql` (custom), `src/db/documentos-imutaveis.test.ts`

**Interfaces:**
- Consumes: tabelas da T1; `documentoNoBanco` (`test/documentos.ts`); `apagarArquivo` (`armazenamento.ts`).
- Produces (SQL): gatilhos `app_documento_imutavel` (BEFORE UPDATE OR DELETE em `signed_documents`) e `app_notas_imutaveis` (BEFORE INSERT OR UPDATE OR DELETE em `signed_document_notes`), ambos com `ERRCODE '42501'`; função `app_anonimizar_documentos(p_documento uuid) RETURNS text` (devolve o `pdf_path` a apagar; só contexto `worker`, paciente `bloqueado`). Usada pela T14 no `naMesmaTransacao` de `apagarArquivo`. **SECURITY INVOKER** (desvio da RN-140 (c), que dizia DEFINER: registrado na tabela de desvios — o gatilho já exige o contexto `worker`, e INVOKER não dá privilégio a mais). Gatilho `app_codigo_acesso_regras` (BEFORE UPDATE em `document_access_codes`; Minor 14 da revisão de segurança).

- [ ] **Step 1: Testes do gatilho e da anonimização (falham)** — `src/db/documentos-imutaveis.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { documentoNoBanco } from '../../test/documentos';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const negado = (e: unknown) => (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code === '42501';
const fk = (e: unknown) => (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code === '23503';
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
const linha = async (ctx: TenantContext, id: string) =>
  (await withTenant(ctx, (tx) => tx.execute(sql`select status, conteudo, pdf_path, codigo, anonimizado_em from signed_documents where id = ${id}`), app.db)).rows[0] as Record<string, unknown>;

describe('app_documento_imutavel (RN-140, RN-141, CS-141)', () => {
  it('rascunho: o conteúdo muda e o rascunho pode ser apagado; tenant/paciente/tipo nunca mudam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`update signed_documents set conteudo = '{"versao":1,"tipo":"receita","itens":[],"orientacoes":"x"}' where id = ${d.id}`);
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(q(sql`update signed_documents set patient_id = ${outro.id} where id = ${d.id}`)).rejects.toSatisfy(negado);
    // Minor 13 (revisão de segurança): fora dos emitidos, nada de PDF assinado, SHA-256, data ou tipo de assinatura
    await expect(q(sql`update signed_documents set pdf_sha256 = ${'c'.repeat(64)} where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`update signed_documents set assinatura_tipo = 'digitalizada' where id = ${d.id}`)).rejects.toSatisfy(negado);
    await q(sql`delete from signed_documents where id = ${d.id}`);
  });

  it('preparando → aguardando_assinatura só pelo worker, com o PDF base uma vez; voltar a editar limpa código e base', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'preparando' });
    const base = `${T.tenantId}/documento_base/${randomUUID()}.pdf`;
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id})`), app.db);
    const pronto = sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10, area_assinatura = '{"x1":351,"y1":62,"x2":559,"y2":132}' where id = ${d.id}`;
    await expect(withTenant(T.ctx, (tx) => tx.execute(pronto), app.db)).rejects.toSatisfy(negado);
    await withTenant(worker(T.tenantId), (tx) => tx.execute(pronto), app.db);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set conteudo = '{}' where id = ${d.id}`), app.db)).rejects.toSatisfy(negado);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'rascunho' where id = ${d.id}`), app.db)).rejects.toSatisfy(negado); // código ficou
    await withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, base_pdf_path = null, base_pdf_sha256 = null, base_pdf_bytes = null, area_assinatura = null, pdf_status = null, digitalizacao_em = null where id = ${d.id}`), app.db);
    expect((await linha(T.ctx, d.id)).codigo).toBeNull();
  });

  it('assinado: conteúdo, PDF e SHA-256 nunca mudam, nem pelo DELETE; o PDF base pode sair; o no-op passa; cancelar é a única saída', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`update signed_documents set conteudo = '{"x":1}' where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`update signed_documents set pdf_sha256 = ${'c'.repeat(64)} where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`update signed_documents set status = 'rascunho', codigo = null where id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`delete from signed_documents where id = ${d.id}`)).rejects.toSatisfy(negado);
    await q(sql`update signed_documents set tenant_id = tenant_id, updated_at = now() where id = ${d.id}`); // no-op
    await q(sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${d.id}`);
    await expect(q(sql`update signed_documents set status = 'assinado', cancelado_em = null where id = ${d.id}`)).rejects.toSatisfy(negado);
  });

  it('regra 9: a assinatura mantém os ponteiros do base e das fotos; depois eles só saem (base → nulo, fotos encolhem), nunca trocam nem crescem', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'preparando' });
    const arq = (tipo: string) => `${T.tenantId}/${tipo}/${randomUUID()}.pdf`;
    const [base, assinado] = [arq('documento_base'), arq('documento_assinado')];
    const fotos = [arq('documento_digitalizado'), arq('documento_digitalizado')];
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id}), (${T.tenantId}, 'documento_assinado', ${assinado}, 10, 'application/pdf', ${p.id})`);
    await withTenant(worker(T.tenantId), (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10 where id = ${d.id}`), app.db);
    await q(sql`update signed_documents set digitalizacao = ${JSON.stringify(fotos)}::jsonb, digitalizacao_status = 'pendente', digitalizacao_em = now() where id = ${d.id}`);
    const assinar = (extra: ReturnType<typeof sql>) =>
      sql`update signed_documents set status = 'assinado', pdf_path = ${assinado}, pdf_sha256 = ${'a'.repeat(64)}, assinado_em = now(), assinatura_tipo = 'digitalizada', digitalizacao_status = null, digitalizacao_em = null${extra} where id = ${d.id}`;
    await expect(q(assinar(sql`, base_pdf_path = null`))).rejects.toSatisfy(negado); // o ponteiro só sai no apagarArquivo do base
    await expect(q(assinar(sql`, digitalizacao = null`))).rejects.toSatisfy(negado);
    await q(assinar(sql``));
    await expect(q(sql`update signed_documents set digitalizacao = ${JSON.stringify([...fotos, arq('documento_digitalizado')])}::jsonb where id = ${d.id}`)).rejects.toSatisfy(negado); // cresce
    await expect(q(sql`update signed_documents set base_pdf_path = ${arq('documento_base')} where id = ${d.id}`)).rejects.toSatisfy(negado); // troca
    await q(sql`update signed_documents set digitalizacao = ${JSON.stringify([fotos[1]])}::jsonb where id = ${d.id}`); // uma foto sai
    await q(sql`update signed_documents set digitalizacao = null where id = ${d.id}`);
    await q(sql`update signed_documents set base_pdf_path = null where id = ${d.id}`);
    await expect(q(sql`update signed_documents set base_pdf_path = ${base} where id = ${d.id}`)).rejects.toSatisfy(negado); // de nulo, não volta
    expect(await linha(T.ctx, d.id)).toMatchObject({ status: 'assinado', pdf_path: assinado });
  });

  it('a FK NO ACTION recusa apagarArquivo avulso do PDF assinado, e nada muda', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const dataDir = await mkdtemp(path.join(tmpdir(), 'doc-'));
    await mkdir(path.join(dataDir, path.dirname(d.pdfPath!)), { recursive: true });
    await writeFile(path.join(dataDir, d.pdfPath!), 'x');
    await expect(apagarArquivo(T.ctx, { caminho: d.pdfPath! }, { db: app.db, dataDir })).rejects.toSatisfy(fk);
    expect((await linha(T.ctx, d.id)).pdf_path).toBe(d.pdfPath);
  });

  it('anonimização: só o worker, só paciente bloqueado; limpa conteúdo e notas, solta o PDF e elimina a verificação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${d.id}, 'Justificativa')`), app.db);
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', null, 'digitalizada', ${'a'.repeat(64)})`);
    const anonimizar = sql`select app_anonimizar_documentos(${d.id}) as caminho`;
    await expect(withTenant(T.ctx, (tx) => tx.execute(anonimizar), app.db)).rejects.toSatisfy(negado); // nutri
    await expect(withTenant(worker(T.tenantId), (tx) => tx.execute(anonimizar), app.db)).rejects.toSatisfy(negado); // paciente ativo
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set anonimizado_em = now(), conteudo = '{}', pdf_path = null where id = ${d.id}`), app.db)).rejects.toSatisfy(negado);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    const r = await withTenant(worker(T.tenantId), (tx) => tx.execute(anonimizar), app.db);
    expect(r.rows[0].caminho).toBe(d.pdfPath);
    const depois = await linha(T.ctx, d.id);
    expect(depois).toMatchObject({ conteudo: {}, pdf_path: null });
    expect(depois.anonimizado_em).not.toBeNull();
    const nota = (await withTenant(T.ctx, (tx) => tx.execute(sql`select justificativa_uso from signed_document_notes where documento_id = ${d.id}`), app.db)).rows[0];
    expect(nota.justificativa_uso).toBeNull();
    const v = (await app.db.execute(sql`select situacao from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v.situacao).toBe('eliminado');
    await expect(withTenant(worker(T.tenantId), (tx) => tx.execute(anonimizar), app.db)).rejects.toSatisfy(negado); // já anonimizado
  });

  it('notas: a justificativa muda no rascunho e fica fixa depois de preparar; nota de documento emitido não é apagada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${d.id}, 'A')`);
    await q(sql`update signed_document_notes set justificativa_uso = 'B' where documento_id = ${d.id}`);
    await q(sql`update signed_documents set status = 'preparando', codigo = ${'ABCDEFGHJKMN'.split('').reverse().join('')}, declaracao_em = now() where id = ${d.id}`);
    await expect(q(sql`update signed_document_notes set justificativa_uso = 'C' where documento_id = ${d.id}`)).rejects.toSatisfy(negado);
    await expect(q(sql`delete from signed_document_notes where documento_id = ${d.id}`)).rejects.toSatisfy(negado);
  });

  it('códigos do link (RN-158, Minor 14): tentativas só sobem de 1 em 1; a sessão nasce uma vez; o resto é fixo', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    const [c] = (await q(sql`insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em) values (${T.tenantId}, ${p.id}, ${d.id}, 'h', now() + interval '10 minutes') returning id`)).rows as { id: string }[];
    await q(sql`update document_access_codes set tentativas = tentativas + 1 where id = ${c.id}`);
    await expect(q(sql`update document_access_codes set tentativas = 0 where id = ${c.id}`)).rejects.toSatisfy(negado); // zerar
    await expect(q(sql`update document_access_codes set tentativas = 4 where id = ${c.id}`)).rejects.toSatisfy(negado); // pular
    await expect(q(sql`update document_access_codes set expira_em = now() + interval '1 day', codigo_hash = 'h2' where id = ${c.id}`)).rejects.toSatisfy(negado);
    await q(sql`update document_access_codes set usado_em = now(), sessao_hash = 'x', sessao_expira_em = now() + interval '15 minutes' where id = ${c.id}`);
    await expect(q(sql`update document_access_codes set sessao_hash = 'y', sessao_expira_em = now() + interval '1 day' where id = ${c.id}`)).rejects.toSatisfy(negado);
  });
});
```

Run: `pnpm test src/db/documentos-imutaveis.test.ts` → FAIL (as recusas não acontecem: sem gatilho).

- [ ] **Step 2: Os gatilhos e a função** — `pnpm drizzle-kit generate --custom --name documentos_imutaveis` → `drizzle/0091_documentos_imutaveis.sql`

```sql
-- RN-140 / RN-141 (spec de documentos assinados v0.3): a imutabilidade é do BANCO. Por estado, só as colunas listadas
-- mudam; updated_at sempre; um UPDATE que não muda nada passa. ERRCODE 42501 (o mesmo da RLS e do paciente_colunas).
CREATE OR REPLACE FUNCTION app_documento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  o jsonb;
  n jsonb;
  mudou text[];
  fixas constant text[] := ARRAY['id', 'tenant_id', 'patient_id', 'tipo', 'versao', 'retifica_id', 'created_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'rascunho' THEN
      RAISE EXCEPTION 'documento fora do rascunho não é apagado (RN-140)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  o := to_jsonb(OLD) - 'updated_at';
  n := to_jsonb(NEW) - 'updated_at';
  IF o = n THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(array_agg(k), '{}') INTO mudou FROM jsonb_object_keys(o) AS k WHERE o -> k IS DISTINCT FROM n -> k;
  IF mudou && fixas THEN
    RAISE EXCEPTION 'coluna fixa do documento (RN-140)' USING ERRCODE = '42501';
  END IF;

  -- anonimização (RN-140 c): só o worker, só documento emitido, e só limpar
  IF OLD.anonimizado_em IS NULL AND NEW.anonimizado_em IS NOT NULL THEN
    IF app_current_role() IS DISTINCT FROM 'worker' OR OLD.status NOT IN ('assinado', 'substituido', 'cancelado')
       OR NOT (mudou <@ ARRAY['anonimizado_em', 'conteudo', 'pdf_path', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
       OR NEW.conteudo <> '{}'::jsonb OR NEW.pdf_path IS NOT NULL OR NEW.base_pdf_path IS NOT NULL THEN
      RAISE EXCEPTION 'anonimização fora da regra (RN-140 c)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.anonimizado_em IS NOT NULL THEN
    RAISE EXCEPTION 'documento anonimizado não muda' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'rascunho' THEN
    IF NEW.status NOT IN ('rascunho', 'preparando') OR 'anonimizado_em' = ANY (mudou) THEN
      RAISE EXCEPTION 'transição inválida a partir do rascunho (RN-141)' USING ERRCODE = '42501';
    END IF;
    -- Minor 13 (revisão de segurança): fora dos emitidos, nada do PDF assinado nem do base (defesa em profundidade)
    IF NEW.pdf_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL OR NEW.assinado_em IS NOT NULL OR NEW.assinatura_tipo IS NOT NULL
       OR NEW.base_pdf_path IS NOT NULL OR NEW.entregue_em IS NOT NULL OR NEW.digitalizacao IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho sem PDF nem assinatura (RN-141)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('preparando', 'aguardando_assinatura') THEN
    -- "Voltar a editar" (RN-140 a): tudo do preparo volta a nulo
    IF NEW.status = 'rascunho' THEN
      IF NOT (mudou <@ ARRAY['status', 'codigo', 'declaracao_em', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura', 'pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
         OR NEW.codigo IS NOT NULL OR NEW.declaracao_em IS NOT NULL OR NEW.base_pdf_path IS NOT NULL OR NEW.base_pdf_sha256 IS NOT NULL
         OR NEW.base_pdf_bytes IS NOT NULL OR NEW.area_assinatura IS NOT NULL OR NEW.digitalizacao IS NOT NULL THEN
        RAISE EXCEPTION 'voltar a editar fora da regra (RN-140 a)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- o worker grava o PDF base uma vez e libera para assinar
    IF OLD.status = 'preparando' AND NEW.status = 'aguardando_assinatura' THEN
      IF app_current_role() IS DISTINCT FROM 'worker'
         OR NOT (mudou <@ ARRAY['status', 'pdf_status', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura'])
         OR OLD.base_pdf_path IS NOT NULL OR NEW.base_pdf_path IS NULL OR NEW.base_pdf_sha256 IS NULL OR NEW.base_pdf_bytes IS NULL THEN
        RAISE EXCEPTION 'PDF base fora da regra (RN-141)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- mesmo estado: só o acompanhamento do PDF e da digitalizada
    IF NEW.status = OLD.status THEN
      IF NOT (mudou <@ ARRAY['pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'conteúdo congelado desde o preparo (RN-140)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- a assinatura (RN-140 b; regra 9 do CLAUDE.md — desvio registrado): os ponteiros do base e das fotos FICAM; cada
    -- arquivo sai depois no SEU apagarArquivo, com o ponteiro no naMesmaTransacao (soltarArquivosDoPreparo, T5)
    IF OLD.status = 'aguardando_assinatura' AND NEW.status = 'assinado' THEN
      IF NOT (mudou <@ ARRAY['status', 'pdf_path', 'pdf_sha256', 'assinatura_tipo', 'assinatura_emissor', 'assinante_nome', 'assinado_em', 'assinado_por', 'entregue_em', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'assinatura fora da regra (RN-140 b)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'transição inválida (RN-141)' USING ERRCODE = '42501';
  END IF;

  -- emitido (assinado, substituido, cancelado): os ponteiros do preparo só SAEM (base → NULL, fotos encolhem), um
  -- arquivo por vez no naMesmaTransacao do apagarArquivo dele; nunca trocam nem crescem
  IF NOT (NEW.base_pdf_path IS NULL OR NEW.base_pdf_path IS NOT DISTINCT FROM OLD.base_pdf_path)
     OR NOT (NEW.digitalizacao IS NULL OR (OLD.digitalizacao IS NOT NULL AND OLD.digitalizacao @> NEW.digitalizacao)) THEN
    RAISE EXCEPTION 'ponteiro de arquivo de documento emitido só sai (RN-140, regra 9)' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'assinado' THEN
    IF NEW.status = 'assinado' AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em', 'entregue_em']
       AND (OLD.entregue_em IS NULL OR NEW.entregue_em IS NOT DISTINCT FROM OLD.entregue_em) THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'cancelado' AND mudou <@ ARRAY['status', 'cancelado_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.cancelado_em IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'substituido' AND mudou <@ ARRAY['status', 'substituido_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.substituido_em IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'documento assinado não muda (RN-140)' USING ERRCODE = '42501';
  END IF;

  -- substituido / cancelado: só soltar o que sobrou do preparo (a conferência de "só sai" está acima)
  IF NEW.status = OLD.status AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'documento emitido não muda (RN-140)' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER documento_imutavel BEFORE UPDATE OR DELETE ON signed_documents FOR EACH ROW EXECUTE FUNCTION app_documento_imutavel();
--> statement-breakpoint
-- RN-140: as notas seguem o documento. Na cascata do rascunho apagado, a linha-mãe já não é visível (status nulo).
CREATE OR REPLACE FUNCTION app_notas_imutaveis() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d record;
BEGIN
  SELECT status, anonimizado_em INTO d FROM signed_documents WHERE id = coalesce(NEW.documento_id, OLD.documento_id);
  IF TG_OP = 'DELETE' THEN
    IF d.status IS NOT NULL AND d.status <> 'rascunho' THEN
      RAISE EXCEPTION 'nota de documento emitido não é apagada (RN-140)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.documento_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.documento_id) THEN
    RAISE EXCEPTION 'coluna fixa da nota (RN-140)' USING ERRCODE = '42501';
  END IF;
  IF d.anonimizado_em IS NOT NULL THEN
    IF NEW.justificativa_uso IS NOT NULL OR NEW.motivo_cancelamento IS NOT NULL THEN
      RAISE EXCEPTION 'nota de documento anonimizado só é limpa' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF d.status = 'rascunho' THEN
    IF NEW.motivo_cancelamento IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho não tem motivo de cancelamento' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- de "preparando" em diante a justificativa é fixa; o motivo entra uma vez, com o documento já cancelado (US-149)
  IF (TG_OP = 'INSERT' AND NEW.justificativa_uso IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.justificativa_uso IS DISTINCT FROM OLD.justificativa_uso)
     OR (NEW.motivo_cancelamento IS NOT NULL AND (d.status <> 'cancelado' OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento)))
     OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS NULL) THEN
    RAISE EXCEPTION 'nota congelada desde o preparo (RN-140)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notas_imutaveis BEFORE INSERT OR UPDATE OR DELETE ON signed_document_notes FOR EACH ROW EXECUTE FUNCTION app_notas_imutaveis();
--> statement-breakpoint
-- RN-140 (c): a ÚNICA porta para limpar um documento emitido. Contexto worker de um tenant, paciente bloqueado (o job de
-- retenção, lgpd.ts, chama no naMesmaTransacao de apagarArquivo, um documento por vez, ANTES de anonimizar o paciente).
-- Devolve o caminho do PDF a apagar. SECURITY INVOKER: não precisa de privilégio a mais (o gatilho já exige o worker).
-- DESVIO REGISTRADO (Minors das duas revisões): a RN-140 (c) da spec v0.3 dizia SECURITY DEFINER, como a 0065; INVOKER
-- é mais estreito (roda com os privilégios do nutri_app no contexto worker) e a spec v0.3.1 passa a dizê-lo.
CREATE OR REPLACE FUNCTION app_anonimizar_documentos(p_documento uuid) RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_caminho text;
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_documentos() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  SELECT sd.pdf_path INTO v_caminho
    FROM public.signed_documents sd
    JOIN public.patients p ON p.tenant_id = sd.tenant_id AND p.id = sd.patient_id
   WHERE sd.id = p_documento AND sd.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
     AND sd.anonimizado_em IS NULL AND sd.status IN ('assinado', 'substituido', 'cancelado')
   FOR UPDATE OF sd;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_documentos(): documento emitido de paciente bloqueado não encontrado neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.signed_documents
     SET anonimizado_em = clock_timestamp(), conteudo = '{}'::jsonb, pdf_path = NULL, base_pdf_path = NULL, digitalizacao = NULL, digitalizacao_status = NULL, digitalizacao_em = NULL, updated_at = clock_timestamp()
   WHERE id = p_documento;
  UPDATE public.signed_document_notes SET justificativa_uso = NULL, motivo_cancelamento = NULL, updated_at = clock_timestamp() WHERE documento_id = p_documento;
  UPDATE public.document_verifications SET situacao = 'eliminado', situacao_em = clock_timestamp() WHERE documento_id = p_documento;
  DELETE FROM public.document_access_codes WHERE documento_id = p_documento;
  RETURN v_caminho;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_documentos(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_documentos(uuid) TO nutri_app_role;
--> statement-breakpoint
-- RN-158 (Minor 14 da revisão de segurança): a sessão de paciente SEM LOGIN faz UPDATE em document_access_codes
-- (app_allow_paciente_escrita, 0090). Só isto pode mudar: `tentativas` sobe de 1 em 1 (nunca volta a zero), e `usado_em`,
-- `sessao_hash` e `sessao_expira_em` saem de nulo juntos, UMA vez; o resto é fixo. Vale para todo papel.
CREATE OR REPLACE FUNCTION app_codigo_acesso_regras() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.documento_id, NEW.codigo_hash, NEW.expira_em, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.documento_id, OLD.codigo_hash, OLD.expira_em, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do código do link (RN-158)' USING ERRCODE = '42501';
  END IF;
  IF NEW.tentativas < OLD.tentativas OR NEW.tentativas > OLD.tentativas + 1 THEN
    RAISE EXCEPTION 'tentativas do código só sobem (RN-158)' USING ERRCODE = '42501';
  END IF;
  IF (NEW.usado_em, NEW.sessao_hash, NEW.sessao_expira_em) IS DISTINCT FROM (OLD.usado_em, OLD.sessao_hash, OLD.sessao_expira_em)
     AND (OLD.usado_em IS NOT NULL OR OLD.sessao_hash IS NOT NULL OR NEW.usado_em IS NULL OR NEW.sessao_hash IS NULL OR NEW.sessao_expira_em IS NULL) THEN
    RAISE EXCEPTION 'a sessão do código nasce uma vez (RN-158)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER codigo_acesso_regras BEFORE UPDATE ON document_access_codes FOR EACH ROW EXECUTE FUNCTION app_codigo_acesso_regras();
```

> Nota: o `base_pdf_path` e a `digitalizacao` de documento emitido normalmente já são nulos (o `soltarArquivosDoPreparo` os solta logo depois da assinatura, e a T14 o chama de novo antes da função); se um apagar falhou e a varredura da T7 ainda não passou, a função limpa o ponteiro por defesa e o arquivo, sem referência, sai na varredura. A conferência "nenhum PDF de documento sobrou" da anonimização é a `pdfsDeDocumentosRestantes` (T14).

- [ ] **Step 3: Rodar**

Run: `pnpm test src/db/documentos-imutaveis.test.ts src/db/documentos-schema.test.ts test/isolamento.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0091_documentos_imutaveis.sql drizzle/meta src/db/documentos-imutaveis.test.ts
git commit -m "feat(documentos): imutabilidade no banco, anonimização só pelo worker e regras do código do link (RN-140, RN-141, CS-141, RN-158)"
```

---
### Task 3: Perfil profissional para documentos (US-140, D6; P10A-03; antiga T4 sem o assinante do consultório)

> O CPF do assinante do consultório (D10: tabela, HMAC, máscara, leitura e gravação) e a troca do CPF do consultório (RN-145/D13) só existem com certificado: foram para o **Plano 10B, Tarefa 3**. O 10A não lê nem grava CPF.

**Files:**
- Create: `src/modules/documentos/perfil-profissional.ts`, `src/modules/documentos/perfil-profissional.test.ts`, `src/app/painel/configuracoes/perfil/documentos-form.tsx`, `src/app/painel/configuracoes/perfil/fitoterapia-form.tsx`, `src/app/painel/configuracoes/perfil/actions.ts`
- Modify: `src/app/painel/configuracoes/perfil/page.tsx`, `src/app/painel/configuracoes/page.tsx` (texto do cartão), `src/modules/ajuda/conteudo.ts` (guia `configuracoes`, `versao: 2`)

**Interfaces:**
- Consumes: `tenants` (T1); `crnSchema` (`plataforma/contas.ts`); `normalizarTelefone`/`formatarTelefone`; `recordAudit`; `primeiroErroPorCampo`.
- Produces:
  - `MSG_PERFIL_PROF` (textos da US-140), `TERMO_FITOTERAPIA = { versao: '2026-10-05', texto }`, `ROTULO_HABILITACAO`.
  - `type CopiaProfissional = { nomeCompleto: string; crn: string; email: string; telefone: string; endereco: string | null; fitoterapia: boolean }`.
  - `perfilCompleto(t: TenantRow): boolean`, `copiaDoPerfil(t: TenantRow): CopiaProfissional` (lança `PerfilIncompletoError`), `class PerfilIncompletoError`.
  - `salvarDadosParaDocumentos(ctx, input: Record<string, unknown>, db?): Promise<void>` (lança `DocumentoError`), `declararFitoterapia(ctx, input, deps?)`, `retirarFitoterapia(ctx, deps?)`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/perfil-profissional.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { DocumentoError } from './erros';
import { copiaDoPerfil, declararFitoterapia, MSG_PERFIL_PROF, perfilCompleto, PerfilIncompletoError, retirarFitoterapia, salvarDadosParaDocumentos } from './perfil-profissional';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0];

describe('perfil profissional (US-140)', () => {
  it('valida com as mensagens da spec; grava o telefone em E.164 e audita "Perfil profissional"', async () => {
    const T = await novoTenant(app.db);
    await expect(salvarDadosParaDocumentos(T.ctx, { nomeProfissional: 'Deb', contatoEmail: 'x', contatoTelefone: '123' }, app.db)).rejects.toSatisfy(
      (e) => e instanceof DocumentoError && e.erros.nomeProfissional === MSG_PERFIL_PROF.nome && e.erros.contatoEmail === MSG_PERFIL_PROF.email && e.erros.contatoTelefone === MSG_PERFIL_PROF.telefone,
    );
    await salvarDadosParaDocumentos(T.ctx, { nomeProfissional: '  Débora  Silva Santos ', contatoEmail: 'debby@consultorio.com', contatoTelefone: '(11) 91234-5678' }, app.db);
    const t = await tenantDe(T.tenantId);
    expect(t).toMatchObject({ nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678' });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao, entidade from audit_log where entidade = 'perfil_profissional'`), app.db);
    expect(audit.rows).toEqual([{ acao: 'alterar', entidade: 'perfil_profissional' }]);
  });

  it('perfil completo exige nome, CRN, e-mail e telefone; a cópia formata o telefone e diz se há habilitação', async () => {
    const T = await novoTenant(app.db);
    const t0 = await tenantDe(T.tenantId);
    expect(perfilCompleto(t0)).toBe(false);
    expect(() => copiaDoPerfil(t0)).toThrow(PerfilIncompletoError);
    await app.db.update(tenants).set({ crn: 'CRN-3 12345' }).where(eq(tenants.id, T.tenantId));
    await salvarDadosParaDocumentos(T.ctx, { nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefone: '11912345678' }, app.db);
    const t = await tenantDe(T.tenantId);
    expect(perfilCompleto(t)).toBe(true);
    expect(copiaDoPerfil(t)).toEqual({ nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'debby@consultorio.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false });
  });

  it('D6: declarar a habilitação exige o registro e a confirmação; grava data e versão do termo; retirar limpa os três', async () => {
    const T = await novoTenant(app.db);
    await expect(declararFitoterapia(T.ctx, { registro: '', confirmo: 'on' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.registro === MSG_PERFIL_PROF.registro);
    await expect(declararFitoterapia(T.ctx, { registro: 'CRN-3 nº 1234/2024' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.confirmo === MSG_PERFIL_PROF.declaracao);
    await declararFitoterapia(T.ctx, { registro: 'CRN-3 nº 1234/2024', confirmo: 'on' }, { db: app.db, agora: new Date('2026-10-05T12:00:00Z') });
    expect(await tenantDe(T.tenantId)).toMatchObject({ fitoterapiaRegistro: 'CRN-3 nº 1234/2024', fitoterapiaTermoVersao: '2026-10-05', fitoterapiaDeclaradaEm: new Date('2026-10-05T12:00:00Z') });
    await retirarFitoterapia(T.ctx, { db: app.db });
    expect(await tenantDe(T.tenantId)).toMatchObject({ fitoterapiaRegistro: null, fitoterapiaDeclaradaEm: null, fitoterapiaTermoVersao: null });
  });
});
```

Run: `pnpm test src/modules/documentos/perfil-profissional.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementação** — `src/modules/documentos/perfil-profissional.ts`

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { formatarTelefone, normalizarTelefone } from '@/modules/pacientes/telefone';
import { recordAudit } from '@/modules/plataforma/audit';
import { DocumentoError } from './erros';

/** US-140 (texto exato da spec v0.3). */
export const MSG_PERFIL_PROF = {
  nome: 'Informe seu nome completo (5 a 120 caracteres)',
  email: 'Informe um e-mail profissional válido',
  telefone: 'Informe um telefone válido com DDD',
  registro: 'Informe o registro da sua habilitação em Fitoterapia no CRN',
  declaracao: 'Confirme a declaração para continuar.',
  incompleto: 'Complete seu perfil profissional (nome completo, CRN e contato) antes de preparar documentos.',
  salvo: 'Dados para documentos salvos.',
  habilitada: 'Habilitação em Fitoterapia registrada no perfil.',
  retirada: 'Habilitação em Fitoterapia retirada do perfil.',
} as const;
export const ROTULO_HABILITACAO = 'Tenho habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021)';
/** D6 da spec: o termo da autodeclaração é versionado (como o DPA); versão nova = texto novo. */
export const TERMO_FITOTERAPIA = { versao: '2026-10-05', texto: 'Declaro, sob minha responsabilidade, que a habilitação está registrada no CRN.' } as const;

export class PerfilIncompletoError extends Error {
  override name = 'PerfilIncompletoError';
  constructor() {
    super(MSG_PERFIL_PROF.incompleto);
  }
}

const espacos = (s: string) => s.trim().replace(/\s+/g, ' ');
const dadosSchema = z.object({
  nomeProfissional: z.string().transform(espacos).pipe(z.string().min(5, MSG_PERFIL_PROF.nome).max(120, MSG_PERFIL_PROF.nome)),
  contatoEmail: z.string().trim().toLowerCase().pipe(z.email(MSG_PERFIL_PROF.email).max(254, MSG_PERFIL_PROF.email)),
  contatoTelefone: z.string().transform((t, c) => normalizarTelefone(t) ?? (c.addIssue({ code: 'custom', message: MSG_PERFIL_PROF.telefone }), z.NEVER)),
});

export type CopiaProfissional = { nomeCompleto: string; crn: string; email: string; telefone: string; endereco: string | null; fitoterapia: boolean };

export function perfilCompleto(t: Pick<TenantRow, 'nomeProfissional' | 'crn' | 'contatoEmail' | 'contatoTelefoneE164'>): boolean {
  return !!(t.nomeProfissional && t.crn && t.contatoEmail && t.contatoTelefoneE164);
}

/** RN-154: a cópia congelada no conteúdo ao preparar (o PDF e o portal leem a cópia, nunca o perfil atual). */
export function copiaDoPerfil(t: TenantRow): CopiaProfissional {
  if (!perfilCompleto(t)) throw new PerfilIncompletoError();
  return {
    nomeCompleto: t.nomeProfissional!,
    crn: t.crn!,
    email: t.contatoEmail!,
    telefone: formatarTelefone(t.contatoTelefoneE164!),
    endereco: t.enderecoConsultorio ?? null,
    fitoterapia: !!t.fitoterapiaRegistro,
  };
}

/** `tenants` não tem RLS e não tem gatilho de auditoria: o tenant vem da sessão e a auditoria é explícita (§10 da spec). */
export async function salvarDadosParaDocumentos(ctx: TenantContext, input: Record<string, unknown>, db: Db = getDb()): Promise<void> {
  const p = dadosSchema.safeParse({ nomeProfissional: input.nomeProfissional ?? '', contatoEmail: input.contatoEmail ?? '', contatoTelefone: input.contatoTelefone ?? '' });
  if (!p.success) throw new DocumentoError(primeiroErroPorCampo(p.error));
  await withTenant(ctx, async (tx) => {
    await tx
      .update(tenants)
      .set({ nomeProfissional: p.data.nomeProfissional, contatoEmail: p.data.contatoEmail, contatoTelefoneE164: p.data.contatoTelefone, updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenantId));
    await recordAudit(tx, { acao: 'alterar', entidade: 'perfil_profissional', entidadeId: ctx.tenantId, patientId: null });
  }, db);
}

export async function declararFitoterapia(ctx: TenantContext, input: Record<string, unknown>, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  const registro = typeof input.registro === 'string' ? espacos(input.registro) : '';
  const erros: Record<string, string> = {};
  if (!registro || registro.length > 60) erros.registro = MSG_PERFIL_PROF.registro;
  if (input.confirmo !== 'on') erros.confirmo = MSG_PERFIL_PROF.declaracao;
  if (Object.keys(erros).length) throw new DocumentoError(erros);
  const agora = deps.agora ?? new Date();
  await withTenant(ctx, async (tx) => {
    await tx
      .update(tenants)
      .set({ fitoterapiaRegistro: registro, fitoterapiaDeclaradaEm: agora, fitoterapiaTermoVersao: TERMO_FITOTERAPIA.versao, updatedAt: agora })
      .where(eq(tenants.id, ctx.tenantId));
    await recordAudit(tx, { acao: 'alterar', entidade: 'perfil_profissional', entidadeId: ctx.tenantId, patientId: null });
  }, deps.db ?? getDb());
}

export async function retirarFitoterapia(ctx: TenantContext, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx.update(tenants).set({ fitoterapiaRegistro: null, fitoterapiaDeclaradaEm: null, fitoterapiaTermoVersao: null, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
    await recordAudit(tx, { acao: 'alterar', entidade: 'perfil_profissional', entidadeId: ctx.tenantId, patientId: null });
  }, deps.db ?? getDb());
}
```

Run: `pnpm test src/modules/documentos/perfil-profissional.test.ts` → PASS.

- [ ] **Step 3: Tela** — seção "Dados para documentos" em Configurações > Perfil e marca

`src/app/painel/configuracoes/perfil/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { DocumentoError } from '@/modules/documentos/erros';
import { declararFitoterapia, retirarFitoterapia, salvarDadosParaDocumentos } from '@/modules/documentos/perfil-profissional';

export type DadosDocState = { erros?: Record<string, string>; ok?: boolean; valores?: Record<string, string> };
const PATH = '/painel/configuracoes/perfil';

export async function salvarDadosDocumentosAction(_prev: DadosDocState, f: FormData): Promise<DadosDocState> {
  const { ctx } = await requireNutri(PATH);
  const valores = { nomeProfissional: String(f.get('nomeProfissional') ?? ''), contatoEmail: String(f.get('contatoEmail') ?? ''), contatoTelefone: String(f.get('contatoTelefone') ?? '') };
  try {
    await salvarDadosParaDocumentos(ctx, valores);
  } catch (e) {
    if (e instanceof DocumentoError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function declararFitoterapiaAction(_prev: DadosDocState, f: FormData): Promise<DadosDocState> {
  const { ctx } = await requireNutri(PATH);
  const valores = { registro: String(f.get('registro') ?? '') };
  try {
    await declararFitoterapia(ctx, { registro: valores.registro, confirmo: f.get('confirmo') });
  } catch (e) {
    if (e instanceof DocumentoError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function retirarFitoterapiaAction(): Promise<void> {
  const { ctx } = await requireNutri(PATH);
  await retirarFitoterapia(ctx);
  revalidatePath(PATH);
}
```

`src/app/painel/configuracoes/perfil/documentos-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import { salvarDadosDocumentosAction, type DadosDocState } from './actions';

/** US-140: o carimbo dos documentos. O CRN e o endereço ficam no formulário de cima ("Perfil e marca"). Recebe só estes campos (G2). */
export function DocumentosForm({ dados }: { dados: { nomeProfissional: string; contatoEmail: string; contatoTelefone: string } }) {
  const [s, action, pendente] = useActionState<DadosDocState, FormData>(salvarDadosDocumentosAction, {});
  const e = s.erros ?? {};
  const v = s.valores ?? dados;
  return (
    <form action={action} className="space-y-4" data-guia="dados-documentos">
      <Campo id="nomeProfissional" rotulo="Nome completo" required defaultValue={v.nomeProfissional} erro={e.nomeProfissional} dica="Sai no carimbo das receitas, como no seu registro no CRN." />
      <Campo id="contatoEmail" rotulo="E-mail profissional" type="email" required defaultValue={v.contatoEmail} erro={e.contatoEmail} />
      <Campo id="contatoTelefone" rotulo="Telefone profissional" type="tel" required defaultValue={v.contatoTelefone} erro={e.contatoTelefone} dica="Com DDD. Ex.: (11) 91234-5678" />
      {s.ok && <p role="status">Dados para documentos salvos.</p>}
      <Botao disabled={pendente}>Salvar dados para documentos</Botao>
    </form>
  );
}
```

`src/app/painel/configuracoes/perfil/fitoterapia-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Botao } from '@/components/ui/botao';
import { declararFitoterapiaAction, retirarFitoterapiaAction, type DadosDocState } from './actions';

/** D6 da spec: autodeclaração com registro e termo. O rótulo e o termo vêm do módulo (texto exato da US-140). */
export function FitoterapiaForm({ registro, declaradaEm, rotulo, termo }: { registro: string | null; declaradaEm: string | null; rotulo: string; termo: string }) {
  const [s, action, pendente] = useActionState<DadosDocState, FormData>(declararFitoterapiaAction, {});
  const e = s.erros ?? {};
  if (registro)
    return (
      <div className="space-y-2">
        <p>{`Habilitação em Fitoterapia: ${registro} (declarada em ${declaradaEm}).`}</p>
        <form action={retirarFitoterapiaAction}>
          <ConfirmarBotao mensagem="Retirar a habilitação em Fitoterapia do perfil? Os fitoterápicos formulados deixam de poder ser prescritos.">Retirar habilitação</ConfirmarBotao>
        </form>
      </div>
    );
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-3">
        <legend className="font-medium">{rotulo}</legend>
        <Campo id="registro" rotulo="Registro da habilitação no CRN" maxLength={60} defaultValue={s.valores?.registro ?? ''} erro={e.registro} dica='Ex.: "CRN-3 nº 1234/2024"' />
        <div className="flex items-start gap-2">
          <input id="confirmo" name="confirmo" type="checkbox" aria-invalid={e.confirmo ? true : undefined} aria-describedby={e.confirmo ? 'confirmo-erro' : undefined} className="mt-1 size-5" />
          <label htmlFor="confirmo">{termo}</label>
        </div>
        {e.confirmo && <p id="confirmo-erro" role="alert" className="text-sm text-erro">{e.confirmo}</p>}
      </fieldset>
      {s.ok && <p role="status">Habilitação em Fitoterapia registrada no perfil.</p>}
      <Botao disabled={pendente}>Registrar habilitação</Botao>
    </form>
  );
}
```

`src/app/painel/configuracoes/perfil/page.tsx` passa a:

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { ROTULO_HABILITACAO, TERMO_FITOTERAPIA } from '@/modules/documentos/perfil-profissional';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { LogoForm } from '../logo-form';
import { PerfilForm } from '../perfil-form';
import { DocumentosForm } from './documentos-form';
import { FitoterapiaForm } from './fitoterapia-form';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const { tenant } = await requireNutri('/painel/configuracoes/perfil');
  return (
    <main className="mx-auto w-full max-w-lg space-y-8 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Perfil e marca</h1>
      <LogoForm />
      <PerfilForm tenant={tenant} />
      <section id="documentos" aria-labelledby="documentos-titulo" className="space-y-4">
        <h2 id="documentos-titulo" className="text-lg font-semibold">Dados para documentos</h2>
        <p className="text-sm text-suave">O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020). O CRN e o endereço ficam no formulário acima.</p>
        <DocumentosForm dados={{ nomeProfissional: tenant.nomeProfissional ?? '', contatoEmail: tenant.contatoEmail ?? '', contatoTelefone: tenant.contatoTelefoneE164 ? formatarTelefone(tenant.contatoTelefoneE164) : '' }} />
        <FitoterapiaForm
          registro={tenant.fitoterapiaRegistro}
          declaradaEm={tenant.fitoterapiaDeclaradaEm ? formatarData(hojeNoFuso(tenant.fuso, tenant.fitoterapiaDeclaradaEm)) : null}
          rotulo={ROTULO_HABILITACAO}
          termo={TERMO_FITOTERAPIA.texto}
        />
      </section>
    </main>
  );
}
```

> `perfil-profissional.ts` importa `@/db/client` (servidor): a página o importa no servidor e passa só strings aos componentes `'use client'` — nada do módulo vai ao navegador.

No hub (`src/app/painel/configuracoes/page.tsx`), o texto do cartão de perfil passa a "Nome, CRN, logo, cor, regras da agenda e dados para documentos.".

- [ ] **Step 4: Manual guiado — guia `configuracoes` versão 2** (`src/modules/ajuda/conteudo.ts`)

```ts
  {
    id: 'configuracoes',
    versao: 2,
    padrao: /^\/painel\/configuracoes(\/.*)?$/,
    titulo: 'Configurações',
    ajuda: {
      resumo: 'Perfil e marca, dados para documentos, horários, WhatsApp, alimentos, modelos, segurança e o tema do painel.',
      secoes: [
        { titulo: 'Perguntas comuns', itens: ['A cor da marca aparece no painel, no app do paciente e no PDF do plano.', 'O tema (claro, escuro ou igual ao aparelho) fica salvo na sua conta.'] },
        {
          titulo: 'Dados para documentos',
          itens: [
            'Em "Perfil e marca", a seção "Dados para documentos" guarda o nome completo, o e-mail e o telefone que saem no carimbo das receitas, junto com o CRN.',
            'A habilitação em Fitoterapia é uma declaração sua, com o registro no CRN; sem ela, a receita não oferece "Fitoterápico (forma farmacêutica ou fórmula magistral)".',
            'Para assinar documentos, a verificação em duas etapas precisa estar ativa (cartão "Segurança").',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'cartoes-configuracoes', titulo: 'Tudo num lugar', texto: 'Cada cartão abre uma parte das configurações do consultório.' },
      { alvo: 'tema-form', titulo: 'Tema', texto: 'Claro, escuro ou igual ao aparelho.' },
      { alvo: 'dados-documentos', titulo: 'Dados para documentos', texto: 'Nome completo, e-mail e telefone do carimbo das receitas. Mudar aqui não altera documento já preparado.' },
    ],
  },
```

> O passo `dados-documentos` só tem alvo na página "Perfil e marca": na página do hub, o tour pula o passo cujo alvo não está na tela (comportamento do `Tour` do Plano 08). Os textos entre aspas ("Perfil e marca", "Dados para documentos", "Segurança", "Fitoterápico (forma farmacêutica ou fórmula magistral)") precisam existir nos `.tsx`; o último é rótulo de opção do formulário da receita (T6) — até a T6, deixar a frase sem as aspas e voltá-las na T6.

Run: `pnpm test src/modules/ajuda/conteudo.test.ts src/app/painel` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/documentos/perfil-profissional{,.test}.ts src/app/painel/configuracoes src/modules/ajuda/conteudo.ts
git commit -m "feat(documentos): dados para documentos e habilitação em Fitoterapia (US-140)"
```

---
### Task 4: Código do 2FA no momento de assinar e o guia da tela de Segurança (RN-145, D13, D18; P10A-04; antiga T5)

**Files:**
- Create: `src/lib/confirmar-2fa.ts`, `src/lib/confirmar-2fa.test.ts`, `src/app/conta/seguranca/ajuda-seguranca.tsx`
- Modify: `src/modules/agenda/limite-ip.ts` (tipos novos de `chaveDoLimite`), `src/app/conta/seguranca/page.tsx`, `src/app/conta/seguranca/enable-2fa.tsx` (`data-guia`), `src/modules/ajuda/conteudo.ts` (guia `seguranca`), `src/modules/ajuda/conteudo.test.ts` (páginas e `.tsx` de `src/app/conta`), `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `getAuth().api.verifyTOTP` (Better Auth `twoFactor`), `consumirLimite`/`liberarLimite`/`chaveDoLimite` (`limite-ip.ts`).
- Produces:
  - `chaveDoLimite(tipo: 'ip' | 'email-hora' | 'webhook' | 'verificacao-ip' | 'documento-ip' | 'documento-envio' | 'documento-codigo-ip' | 'totp-erro' | 'totp-usado', valor)`.
  - `confirmarCodigo2fa(e: { userId: string; codigo: unknown; headers: Headers }, deps?: { db?: Db; agora?: Date; verificar?: (codigo: string, headers: Headers) => Promise<boolean> }): Promise<'ok' | 'invalido' | 'bloqueado'>`; `MAX_TENTATIVAS_2FA = 5`, `JANELA_2FA_S = 900`, `REPETICAO_2FA_S = 90`.
  - Guia `seguranca` em `GUIAS` (`padrao: /^\/conta\/seguranca$/`), componente `AjudaSeguranca`.

- [ ] **Step 1: Teste (falha)** — `src/lib/confirmar-2fa.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { criarEEntrar } from '../../test/sessao';
import { createAuth } from './auth';
import { confirmarCodigo2fa, MAX_TENTATIVAS_2FA } from './confirmar-2fa';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
afterAll(() => app.pool.end());

let cookie = '';
let userId = '';
let totp: TOTP;
const headers = () => new Headers({ cookie, origin: 'http://localhost:3000' });
const verificar = (codigo: string, h: Headers) => auth.api.verifyTOTP({ body: { code: codigo }, headers: h }).then(() => true, () => false);

beforeAll(async () => {
  const n = await criarEEntrar(app.db, auth, { appRole: 'nutri' });
  cookie = n.cookie;
  userId = n.id;
  const r = await auth.api.enableTwoFactor({ body: { password: 'Nutri2026segura' }, headers: headers() });
  totp = new TOTP({ secret: new URL(r.totpURI).searchParams.get('secret')!, digits: 6, period: 30 });
  // better-auth 1.7.6 (plugins/two-factor/totp): o verifyTOTP que ATIVA o 2FA cria uma sessão nova e apaga a antiga —
  // o cookie de antes morre aqui. Guardar o cookie novo (como src/lib/two-factor.test.ts faz com getSetCookie); sem
  // isso, o 1º caso chamaria o Better Auth com sessão morta e receberia 'invalido' (revisão do rascunho).
  const ativado = await auth.api.verifyTOTP({ body: { code: totp.generate() }, headers: headers(), returnHeaders: true });
  const novos = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const c of ativado.headers.getSetCookie()) novos.set(c.split('=')[0], c.split(';')[0]);
  cookie = [...novos.values()].join('; ');
  expect(await auth.api.getSession({ headers: headers() })).not.toBeNull(); // a sessão do cookie guardado está viva
});

describe('confirmarCodigo2fa (RN-145, D13)', () => {
  it('código certo → ok; o MESMO código de novo em seguida → invalido (anti-repetição)', async () => {
    const codigo = totp.generate();
    expect(await confirmarCodigo2fa({ userId, codigo, headers: headers() }, { db: app.db, verificar })).toBe('ok'); // Better Auth de verdade
    expect(await confirmarCodigo2fa({ userId, codigo, headers: headers() }, { db: app.db, verificar })).toBe('invalido');
  });

  it('aceita espaço no meio ("123 456"); recusa formato errado sem chamar o Better Auth', async () => {
    const u = randomUUID();
    let chamou = 0;
    const deps = { db: app.db, verificar: async (c: string) => (chamou++, c === '123456') };
    expect(await confirmarCodigo2fa({ userId: u, codigo: '123 456', headers: headers() }, deps)).toBe('ok');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '12a456', headers: headers() }, deps)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: undefined, headers: headers() }, deps)).toBe('invalido');
    expect(chamou).toBe(1);
  });

  it(`${MAX_TENTATIVAS_2FA} erros em 15 min → bloqueado, mesmo com o código certo; o acerto zera o contador`, async () => {
    const u = randomUUID();
    const errado = { db: app.db, verificar: () => Promise.resolve(false) };
    for (let i = 0; i < MAX_TENTATIVAS_2FA; i++) expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, errado)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '111111', headers: headers() }, { db: app.db, verificar: () => Promise.resolve(true) })).toBe('bloqueado');
    const depois = new Date(Date.now() + 16 * 60_000);
    expect(await confirmarCodigo2fa({ userId: u, codigo: '222222', headers: headers() }, { db: app.db, agora: depois, verificar: () => Promise.resolve(true) })).toBe('ok');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, { ...errado, agora: depois })).toBe('invalido'); // contador zerado no acerto
  });
});
```

Run: `pnpm test src/lib/confirmar-2fa.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/lib/confirmar-2fa.ts` (e os tipos novos em `limite-ip.ts`)

Em `src/modules/agenda/limite-ip.ts`: `export function chaveDoLimite(tipo: 'ip' | 'email-hora' | 'webhook' | 'verificacao-ip' | 'documento-ip' | 'documento-envio' | 'documento-codigo-ip' | 'totp-erro' | 'totp-usado', valor: string): string` (o corpo não muda; o comentário do arquivo ganha: "Plano 10A: verificação pública por IP, código do link por IP (pedido e confirmação) e por documento, tentativas e repetição do código do 2FA").

```ts
import { getDb, type Db } from '@/db/client';
import { chaveDoLimite, consumirLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { getAuth } from './auth';

export const MAX_TENTATIVAS_2FA = 5;
export const JANELA_2FA_S = 15 * 60;
/** Um passo do TOTP (30 s) com a janela ±1 do Better Auth: 90 s cobre todos os momentos em que o mesmo código confere. */
export const REPETICAO_2FA_S = 90;

export type Deps2fa = { db?: Db; agora?: Date; verificar?: (codigo: string, headers: Headers) => Promise<boolean> };

/** A verificação é a do próprio Better Auth, com a sessão da usuária: o segredo nunca sai das tabelas de autenticação. */
async function verificarPeloBetterAuth(codigo: string, headers: Headers): Promise<boolean> {
  try {
    await getAuth().api.verifyTOTP({ body: { code: codigo }, headers });
    return true;
  } catch {
    return false;
  }
}

/**
 * RN-145 / D13 (Plano 10A): o código do 2FA "no momento de assinar". `auth.api.verifyTOTP` chamado no servidor não passa
 * pelo rate limit HTTP do Better Auth nem conta falhas com sessão ativa (G7 da pesquisa) — por isso o limite próprio:
 * 5 tentativas em 15 min por usuária (chave = HMAC do id, `public_rate_limits`), zerado no acerto, e a recusa do mesmo
 * código já aceito nos últimos 90 s. O código nunca vai ao log; quem chama registra a recusa no histórico (digitalizada.ts; no Plano 10B, também o envio do PDF assinado).
 */
export async function confirmarCodigo2fa(e: { userId: string; codigo: unknown; headers: Headers }, deps: Deps2fa = {}): Promise<'ok' | 'invalido' | 'bloqueado'> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const codigo = typeof e.codigo === 'string' ? e.codigo.replace(/\s/g, '') : '';
  const tentativas = chaveDoLimite('totp-erro', e.userId);
  if (!(await consumirLimite(db, tentativas, MAX_TENTATIVAS_2FA, JANELA_2FA_S, agora))) return 'bloqueado';
  if (!/^\d{6}$/.test(codigo)) return 'invalido';
  if (!(await (deps.verificar ?? verificarPeloBetterAuth)(codigo, e.headers))) return 'invalido';
  if (!(await consumirLimite(db, chaveDoLimite('totp-usado', `${e.userId}:${codigo}`), 1, REPETICAO_2FA_S, agora))) return 'invalido';
  await liberarLimite(db, tentativas);
  return 'ok';
}
```

Run: `pnpm test src/lib/confirmar-2fa.test.ts` → PASS.

- [ ] **Step 3: Guia `seguranca` e a ajuda na própria tela** (D18)

Em `src/modules/ajuda/conteudo.ts`, depois do guia `whatsapp`:

```ts
  {
    id: 'seguranca',
    versao: 1,
    padrao: /^\/conta\/seguranca$/,
    titulo: 'Segurança da conta',
    ajuda: {
      resumo: 'A verificação em duas etapas pede, além da senha, um código de 6 dígitos do aplicativo autenticador do celular. Ela é obrigatória para assinar documentos.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Instale um aplicativo autenticador no celular (Google Authenticator, Authy, 1Password…).',
            'Clique em "Ativar verificação em duas etapas" e confirme a sua senha.',
            'Leia o QR Code com o aplicativo e digite o código de 6 dígitos que ele mostra.',
            'Guarde os códigos de recuperação num lugar seguro: cada um funciona uma vez, se você perder o celular.',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Ao enviar um documento assinado à mão (digitalizado), o sistema pede o código do aplicativo a cada envio.',
            'Depois de 5 códigos errados, espere 15 minutos para tentar de novo.',
            'Se o código não confere, confira se a hora do celular está automática.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'ativar-2fa', titulo: 'Ativar', texto: 'Confirme a senha, leia o QR Code com o aplicativo autenticador e digite o código de 6 dígitos.' }],
  },
```

`src/app/conta/seguranca/ajuda-seguranca.tsx` (fora do layout do painel: sem tour; a ajuda fica na tela):

```tsx
import { guiaDaRota } from '@/modules/ajuda/conteudo';
import { SECURITY_PATH } from '@/lib/session-rules';

/** D18 (Plano 10A): /conta/seguranca não tem o GuiaDoPainel (fora do layout do painel); o guia aparece aqui, aberto ou fechado. */
export function AjudaSeguranca() {
  const g = guiaDaRota(SECURITY_PATH);
  if (!g) return null;
  return (
    <details className="rounded-2xl border border-borda bg-cartao p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">Como funciona</summary>
      <p className="mt-2">{g.ajuda.resumo}</p>
      {g.ajuda.secoes.map((s) => (
        <section key={s.titulo} className="mt-3">
          <h2 className="font-semibold">{s.titulo}</h2>
          <ul className="list-disc space-y-1 pl-5">
            {s.itens.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </section>
      ))}
    </details>
  );
}
```

Em `page.tsx`, depois do `<h1>`: `<AjudaSeguranca />`. Em `enable-2fa.tsx`, os dois `<form>` ganham `data-guia="ativar-2fa"`.

Em `src/modules/ajuda/conteudo.test.ts`: `TSX` passa a ler também `src/app/conta`; `PAGINAS` ganha as `page.tsx` de `src/app/conta` (caminho `/conta/...`); e um caso novo:

```ts
  it('D18 (Plano 10A): /conta/seguranca tem guia (o 2FA é exigido para assinar documentos)', () => {
    expect(guiaDaRota('/conta/seguranca')?.id).toBe('seguranca');
  });
```

- [ ] **Step 4: CLAUDE.md, regra 1** — na lista de quem acessa a tabela `user`/autenticação fora de `withTenant`: "…por `src/lib/confirmar-2fa.ts` (só pela API do Better Auth, `auth.api.verifyTOTP` com a sessão da própria usuária: o código do 2FA no momento de assinar, Plano 10A, RN-145)".

- [ ] **Step 5: Rodar e commit**

Run: `pnpm test src/lib/confirmar-2fa.test.ts src/modules/ajuda src/app/conta` → PASS.

```bash
git add src/lib/confirmar-2fa{,.test}.ts src/modules/agenda/limite-ip.ts src/app/conta/seguranca src/modules/ajuda CLAUDE.md
git commit -m "feat(seguranca): código do 2FA no momento de assinar com limite e anti-repetição; guia da tela de Segurança (RN-145, D13, D18)"
```

---
### Task 5: Receita — código, esquema da prescrição e ciclo do rascunho até "Preparando o PDF" (US-142, US-143 parte 1, RN-142, RN-149, RN-150, RN-154; P10A-05; antiga T6)

**Files:**
- Create: `src/modules/documentos/codigo.ts` (+ `codigo.test.ts`), `src/modules/documentos/prescricao.ts` (+ `prescricao.test.ts`), `src/modules/documentos/documentos.ts` (+ `documentos.test.ts`), `src/modules/documentos/arquivos-do-preparo.ts` (o caso dos emitidos é testado na T8, em `registrar-assinatura.test.ts`)
- Modify: `src/modules/documentos/constantes.ts` (declaração da receita), `src/jobs/queues.ts` (filas `documento-pdf`, `documento-digitalizado`, `expirar-documento-pdf`)

**Interfaces:**
- Consumes: `signedDocuments`, `signedDocumentNotes` (T1); `copiaDoPerfil`, `PerfilIncompletoError` (T3); `carregarPacienteParaEscrita`, `PacienteBloqueadoError`, `PacienteNaoEncontradoError`, `idValido` (`pacientes/base.ts`); `auditRead`; `getBoss`, `fromDrizzle`.
- Produces:
  - `codigo.ts`: `gerarCodigo(): string`, `normalizarCodigo(e: unknown): string | null`, `formatarCodigo(c: string): string`.
  - `prescricao.ts`: `TIPOS_ITEM`, `CATEGORIAS`, `UNIDADES`, `VIAS`, `MODOS_PREPARO` (rótulos exatos da US-142), `MSG_PRESCRICAO`, tipos `ItemPrescricao`, `ConteudoReceita = { versao: 1; tipo: 'receita'; itens: ItemPrescricao[]; orientacoes: string; copia?: { profissional: CopiaProfissional; paciente: { nome: string } }; declaracao?: string }`; `validarRascunho(input: unknown, o: { habilitada: boolean }): ConteudoReceita` (lança `DocumentoError` com chaves `itens.0.posologia`…), `validarParaPreparar(c: ConteudoReceita, justificativa: string | null, o: { habilitada: boolean }): void`, `descreverItem(item: ItemPrescricao): { titulo: string; linhas: string[] }`.
  - `documentos.ts`: `criarReceita(ctx, patientId, deps?): Promise<string>`, `salvarRascunhoReceita(ctx, tenant, patientId, docId, input: { conteudo: unknown; justificativa: unknown }, deps?)`, `apagarRascunho(ctx, patientId, docId, deps?)`, `prepararParaAssinatura(ctx, tenant, patientId, docId, input: { declaracao: unknown }, deps?: { db?; boss?; agora? })`, `voltarAEditar(ctx, patientId, docId, deps?: { db?; dataDir? })`, `pedirNovoPdfDocumento(ctx, patientId, docId, deps?)`, `listarDocumentos(ctx, patientId, db?): Promise<ItemLista[]>` (sem `auditRead`, D17), `lerDocumento(ctx, patientId, docId, db?): Promise<DocumentoLido | null>` (com `auditRead`), `estadoDoDocumento(ctx, docId, db?)`, `lerDocumentoNaTransacao(tx, id, o: { auditar: boolean; patientId?: string })` (com `patientId`, o filtro do paciente vai na própria leitura: documento de outro paciente → `null` antes de ler notas e recibos); tipos `ItemLista`, `DocumentoLido`.
  - `arquivos-do-preparo.ts` (sem sessão: o painel e o worker importam): `soltarArquivosDoPreparo(ctx, documentoId, estados, deps?: { db?; dataDir?; soFotos? }): Promise<number>` — regra 9: cada foto da digitalizada e o PDF base saem no seu `apagarArquivo`, com o ponteiro no `naMesmaTransacao` (usado no "Voltar a editar" com `soFotos`, na T7, na T9, na T14 e pelo envio do PDF assinado do Plano 10B).
  - `constantes.ts`: `DECLARACAO_RECEITA` (texto da D5 da spec, **rascunho**).

- [ ] **Step 1: Código Crockford — teste e implementação** (`codigo.test.ts` / `codigo.ts`)

```ts
// codigo.test.ts
import { describe, expect, it } from 'vitest';
import { formatarCodigo, gerarCodigo, normalizarCodigo } from './codigo';

describe('código de verificação (RN-142)', () => {
  it('12 caracteres Crockford, sem I, L, O, U; 60 bits (sem repetição em 10 mil)', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      vistos.add(c);
    }
    expect(vistos.size).toBe(10_000);
  });
  it('aceita hífen, espaço e minúsculas; I/L viram 1 e O vira 0; U e tamanho errado são inválidos', () => {
    expect(normalizarCodigo('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizarCodigo(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN');
    expect(normalizarCodigo('ILO0-0000-0000')).toBe('110000000000'); // I e L → 1, O → 0
    expect(normalizarCodigo('UUUU-0000-0000')).toBeNull();
    expect(normalizarCodigo('ABC')).toBeNull();
    expect(normalizarCodigo(42)).toBeNull();
    expect(formatarCodigo('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
  });
});
```

```ts
// codigo.ts
import { randomBytes } from 'node:crypto';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** RN-142: 60 bits aleatórios em base32 Crockford (12 caracteres). */
export function gerarCodigo(): string {
  let n = randomBytes(8).readBigUInt64BE() >> 4n;
  let s = '';
  for (let i = 0; i < 12; i++) {
    s = ALFABETO[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s;
}

/** Aceita "abcd-efgh-jkmn", espaços e minúsculas; I/L → 1, O → 0 (Crockford). Nulo se não fechar 12 caracteres válidos. */
export function normalizarCodigo(e: unknown): string | null {
  if (typeof e !== 'string' || e.length > 40) return null;
  const s = e.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

export const formatarCodigo = (c: string): string => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
```

Run: `pnpm test src/modules/documentos/codigo.test.ts` → PASS.

- [ ] **Step 2: Esquema da prescrição — teste (falha)** — `prescricao.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { DocumentoError } from './erros';
import { descreverItem, MSG_PRESCRICAO, validarParaPreparar, validarRascunho } from './prescricao';

const vitD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia, no almoço' };
const curcuma = { tipo: 'derivado_vegetal', nomenclatura: 'Curcuma longa L.', parte: 'Rizoma', formaFarmaceutica: 'Cápsula', dose: '500 mg', via: 'oral', posologia: '1 cápsula ao dia' };
const erroEm = (chave: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[chave] === msg;

describe('receita (US-142, RN-149, RN-150)', () => {
  it('aceita suplemento e derivado vegetal sem habilitação; quantidade com vírgula vira número', () => {
    const c = validarRascunho({ itens: [{ ...vitD, composicao: [{ nome: 'Vitamina D3', quantidade: '2000,5', unidade: 'UI' }] }, curcuma], orientacoes: '' }, { habilitada: false });
    expect(c.itens[0]).toMatchObject({ tipo: 'suplemento', composicao: [{ quantidade: 2000.5 }] });
    expect(c.itens).toHaveLength(2);
  });
  it('probiótico só em UFC e enzima só em U, com o texto da spec', () => {
    // expect.unreachable() nos dois: sem ele, o teste passaria mesmo se a validação não lançasse (Minor da revisão de cobertura)
    try {
      validarRascunho({ itens: [{ ...vitD, categoria: 'probiotico', composicao: [{ nome: 'L. acidophilus', quantidade: '10', unidade: 'mg' }] }] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.0.composicao.0.unidade', MSG_PRESCRICAO.probiotico)(e)).toBe(true);
    }
    try {
      validarRascunho({ itens: [{ ...vitD, categoria: 'enzima', composicao: [{ nome: 'Lactase', quantidade: '9000', unidade: 'UI' }] }] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.0.composicao.0.unidade', MSG_PRESCRICAO.enzima)(e)).toBe(true);
    }
  });
  it('chá só com infusão, decocção ou maceração; via anorretal e injetável não existem', () => {
    expect(() => validarRascunho({ itens: [{ tipo: 'planta_cha', nomenclatura: 'Matricaria chamomilla L.', parte: 'Flores', modoPreparo: 'tintura', formaUso: '1 xícara', posologia: '2x ao dia' }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, via: 'retal' }] }, { habilitada: false })).toThrow(DocumentoError);
  });
  it('fitoterápico formulado: recusado sem habilitação (com a mensagem da spec), aceito com ela', () => {
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' };
    try {
      validarRascunho({ itens: [fito] }, { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('itens.0.tipo', MSG_PRESCRICAO.semHabilitacao)(e)).toBe(true);
    }
    expect(validarRascunho({ itens: [fito] }, { habilitada: true }).itens).toHaveLength(1);
  });
  it('limites: 21 itens, 11 componentes, quantidade 0 ou 1e9, posologia com 301 caracteres', () => {
    expect(() => validarRascunho({ itens: Array(21).fill(vitD) }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: Array(11).fill(vitD.composicao[0]) }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: [{ ...vitD.composicao[0], quantidade: '0' }] }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, composicao: [{ ...vitD.composicao[0], quantidade: '1e9' }] }] }, { habilitada: false })).toThrow(DocumentoError);
    expect(() => validarRascunho({ itens: [{ ...vitD, posologia: 'x'.repeat(301) }] }, { habilitada: false })).toThrow(DocumentoError);
  });
  it('para preparar: ao menos 1 item e a justificativa (texto da spec); a habilitação é conferida de novo', () => {
    const vazio = validarRascunho({ itens: [] }, { habilitada: false });
    expect(() => validarParaPreparar(vazio, 'ok', { habilitada: false })).toThrow(MSG_PRESCRICAO.semItens);
    const c = validarRascunho({ itens: [vitD] }, { habilitada: false });
    try {
      validarParaPreparar(c, '  ', { habilitada: false });
      expect.unreachable();
    } catch (e) {
      expect(erroEm('justificativa', MSG_PRESCRICAO.justificativa)(e)).toBe(true);
    }
    const fito = validarRascunho({ itens: [{ tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 cápsula à noite' }] }, { habilitada: true });
    expect(() => validarParaPreparar(fito, 'Ansiedade leve', { habilitada: false })).toThrow(DocumentoError); // habilitação retirada entre salvar e preparar
  });
  it('descreve o item para o PDF e o portal (sem a justificativa)', () => {
    const [item] = validarRascunho({ itens: [vitD] }, { habilitada: false }).itens;
    expect(descreverItem(item)).toEqual({ titulo: 'Vitamina D3 2000 UI', linhas: ['Suplemento alimentar (Nutriente) · Cápsula', 'Via: Oral', 'Posologia: 1 cápsula ao dia, no almoço'] });
  });
});
```

Run: `pnpm test src/modules/documentos/prescricao.test.ts` → FAIL.

- [ ] **Step 3: Esquema da prescrição — implementação** — `src/modules/documentos/prescricao.ts`

```ts
import { z } from 'zod';
import { DocumentoError } from './erros';
import type { CopiaProfissional } from './perfil-profissional';

/** US-142: rótulos exatos (também usados pelo formulário 'use client' — este arquivo não importa nada do servidor). */
export const TIPOS_ITEM = {
  suplemento: 'Suplemento alimentar',
  planta_cha: 'Planta medicinal ou droga vegetal (chá)',
  derivado_vegetal: 'Droga ou derivado vegetal classificado como alimento ou suplemento',
  fitoterapico: 'Fitoterápico (forma farmacêutica ou fórmula magistral)',
} as const;
export const CATEGORIAS = { nutriente: 'Nutriente', enzima: 'Enzima', probiotico: 'Probiótico', outro: 'Outro' } as const;
export const UNIDADES = ['g', 'mg', 'mcg', 'UI', 'U', 'UFC', 'mL'] as const;
/** RN-149: só oral e enteral (Res. CFN 656/2020, art. 1º, § 3º); nunca anorretal nem injetável. */
export const VIAS = { oral: 'Oral', sublingual: 'Sublingual', enteral: 'Enteral (sonda)' } as const;
/** RN-150: o chá só em água (Res. CFN 680/2021, art. 3º, I). */
export const MODOS_PREPARO = { infusao: 'Infusão', decoccao: 'Decocção', maceracao: 'Maceração em água' } as const;

export const MSG_PRESCRICAO = {
  probiotico: 'Probióticos são prescritos em UFC (Resolução CFN nº 656/2020, art. 3º, IX).',
  enzima: 'Enzimas são prescritas em Unidades (U) (Resolução CFN nº 656/2020, art. 3º, IX).',
  semHabilitacao:
    'Exige habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021). Para produto vegetal classificado como alimento ou suplemento, use "Droga ou derivado vegetal classificado como alimento ou suplemento". Registre a habilitação no seu perfil.',
  justificativa: 'Escreva a justificativa de uso (fica no prontuário, não vai na receita).',
  semItens: 'Inclua ao menos um item na receita.',
  itensDemais: 'A receita pode ter até 20 itens.',
  componentes: 'Informe de 1 a 10 componentes.',
  quantidade: 'Informe uma quantidade maior que zero.',
  opcao: 'Escolha uma das opções.',
  orientacoes: 'Use no máximo 2000 caracteres.',
  /** Minor 11 da revisão de normas (texto novo, rascunho para a Debby): o extrato vegetal não é "Outro". */
  dicaOutro: 'Extrato ou produto vegetal não entra em "Outro": use "Droga ou derivado vegetal classificado como alimento ou suplemento" ou, com a habilitação, "Fitoterápico (forma farmacêutica ou fórmula magistral)".',
} as const;

const esp = (s: string) => s.trim().replace(/\s+/g, ' ');
const obrig = (rotulo: string, min: number, max: number) =>
  z.string({ message: `Informe ${rotulo} (até ${max} caracteres).` }).transform(esp).pipe(z.string().min(min, `Informe ${rotulo} (até ${max} caracteres).`).max(max, `Informe ${rotulo} (até ${max} caracteres).`));
const opc = (max: number) => z.string().optional().transform((s) => (s ? esp(s) : '')).pipe(z.string().max(max, `Use no máximo ${max} caracteres.`));
const escolha = <T extends Record<string, string>>(o: T) => z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]], { message: MSG_PRESCRICAO.opcao });
const numero = z.union([z.number(), z.string()]).transform((v, c) => {
  const n = typeof v === 'number' ? v : Number(v.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) {
    c.addIssue({ code: 'custom', message: MSG_PRESCRICAO.quantidade });
    return z.NEVER;
  }
  return Math.round(n * 1000) / 1000;
});

const componente = z.object({ nome: obrig('o componente', 1, 120), quantidade: numero, unidade: z.enum(UNIDADES, { message: MSG_PRESCRICAO.opcao }) });
const botanica = { nomenclatura: obrig('a nomenclatura botânica', 2, 120), parte: obrig('a parte utilizada', 1, 60), nomePopular: opc(60), duracao: opc(100) };

const suplemento = z
  .object({
    tipo: z.literal('suplemento'),
    categoria: escolha(CATEGORIAS),
    composicao: z.array(componente).min(1, MSG_PRESCRICAO.componentes).max(10, MSG_PRESCRICAO.componentes),
    forma: obrig('a forma de apresentação', 1, 60),
    via: escolha(VIAS),
    posologia: obrig('a posologia', 1, 300),
    duracao: opc(100),
    manipulado: z.union([z.boolean(), z.literal('on'), z.literal('')]).optional().transform((v) => v === true || v === 'on'),
  })
  .superRefine((s, c) => {
    s.composicao.forEach((k, i) => {
      if (s.categoria === 'probiotico' && k.unidade !== 'UFC') c.addIssue({ code: 'custom', path: ['composicao', i, 'unidade'], message: MSG_PRESCRICAO.probiotico });
      if (s.categoria === 'enzima' && k.unidade !== 'U') c.addIssue({ code: 'custom', path: ['composicao', i, 'unidade'], message: MSG_PRESCRICAO.enzima });
    });
  });
const plantaCha = z.object({ tipo: z.literal('planta_cha'), ...botanica, modoPreparo: escolha(MODOS_PREPARO), formaUso: obrig('a forma de utilização e o preparo', 1, 300), posologia: obrig('a posologia', 1, 300) });
const derivadoVegetal = z.object({
  tipo: z.literal('derivado_vegetal'),
  ...botanica,
  formaFarmaceutica: obrig('a forma farmacêutica', 1, 60),
  dose: obrig('a dose', 1, 120),
  via: escolha(VIAS),
  posologia: obrig('a posologia', 1, 300),
  padronizacao: opc(120),
  extracao: opc(120),
});
const fitoterapico = z.object({
  tipo: z.literal('fitoterapico'),
  ...botanica,
  extracao: obrig('a forma ou meio de extração', 1, 120),
  formaFarmaceutica: obrig('a forma farmacêutica', 1, 60),
  dose: obrig('a dose', 1, 120),
  via: escolha(VIAS),
  posologia: obrig('a posologia', 1, 300),
  padronizacao: opc(120),
});
const item = z.discriminatedUnion('tipo', [suplemento, plantaCha, derivadoVegetal, fitoterapico], { message: MSG_PRESCRICAO.opcao });
export type ItemPrescricao = z.output<typeof item>;

const rascunho = z.object({ itens: z.array(item).max(20, MSG_PRESCRICAO.itensDemais).default([]), orientacoes: opc(2000) });

export type ConteudoReceita = {
  versao: 1;
  tipo: 'receita';
  itens: ItemPrescricao[];
  orientacoes: string;
  /** RN-154: a cópia congelada no preparo. */
  copia?: { profissional: CopiaProfissional; paciente: { nome: string } };
  /** D5 da spec: o texto da declaração confirmada no preparo. */
  declaracao?: string;
};

function erros(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) out[i.path.join('.') || 'geral'] ??= i.message;
  return out;
}

function conferirHabilitacao(itens: ItemPrescricao[], habilitada: boolean): void {
  const e: Record<string, string> = {};
  itens.forEach((it, i) => {
    if (it.tipo === 'fitoterapico' && !habilitada) e[`itens.${i}.tipo`] = MSG_PRESCRICAO.semHabilitacao;
  });
  if (Object.keys(e).length) throw new DocumentoError(e);
}

/** US-142: o que o rascunho aceita (itens completos; 0 itens vale no rascunho). Habilitação conferida no servidor (RN-150). */
export function validarRascunho(input: unknown, o: { habilitada: boolean }): ConteudoReceita {
  const p = rascunho.safeParse(input ?? {});
  if (!p.success) throw new DocumentoError(erros(p.error));
  conferirHabilitacao(p.data.itens, o.habilitada);
  return { versao: 1, tipo: 'receita', itens: p.data.itens, orientacoes: p.data.orientacoes };
}

/** US-142/US-143: para preparar, 1 a 20 itens e a justificativa; a habilitação de novo (pode ter sido retirada depois do salvar). */
export function validarParaPreparar(c: ConteudoReceita, justificativa: string | null, o: { habilitada: boolean }): void {
  if (!c.itens.length) throw new DocumentoError({ itens: MSG_PRESCRICAO.semItens });
  const j = (justificativa ?? '').trim();
  if (!j || j.length > 2000) throw new DocumentoError({ justificativa: MSG_PRESCRICAO.justificativa });
  conferirHabilitacao(c.itens, o.habilitada);
}

const qtd = (n: number) => String(n).replace('.', ',');
/** Texto do item no PDF, no portal e no painel (nunca a justificativa). */
export function descreverItem(it: ItemPrescricao): { titulo: string; linhas: string[] } {
  const comum = (via?: keyof typeof VIAS) => [...(via ? [`Via: ${VIAS[via]}`] : []), `Posologia: ${it.posologia}`, ...('duracao' in it && it.duracao ? [`Duração: ${it.duracao}`] : [])];
  switch (it.tipo) {
    case 'suplemento':
      return {
        titulo: it.composicao.map((k) => `${k.nome} ${qtd(k.quantidade)} ${k.unidade}`).join(' + '),
        linhas: [`${TIPOS_ITEM.suplemento} (${CATEGORIAS[it.categoria]}) · ${it.forma}${it.manipulado ? ' · manipulado' : ''}`, ...comum(it.via)],
      };
    case 'planta_cha':
      return { titulo: `${it.nomenclatura}${it.nomePopular ? ` (${it.nomePopular})` : ''}`, linhas: [`Parte utilizada: ${it.parte}`, `${MODOS_PREPARO[it.modoPreparo]}: ${it.formaUso}`, ...comum()] };
    case 'derivado_vegetal':
    case 'fitoterapico':
      return {
        titulo: `${it.nomenclatura}${it.nomePopular ? ` (${it.nomePopular})` : ''}`,
        linhas: [
          `Parte utilizada: ${it.parte} · ${it.formaFarmaceutica} · ${it.dose}`,
          ...(it.extracao ? [`Extração: ${it.extracao}`] : []),
          ...(it.padronizacao ? [`Padronização: ${it.padronizacao}`] : []),
          ...comum(it.via),
        ],
      };
  }
}
```

Em `constantes.ts`:

```ts
/**
 * D5 da spec (RASCUNHO até a revisão da Debby e a consulta ao CRN-3, runbook passo 3). Minor 10 da revisão de normas:
 * o texto cita também os medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas
 * (Res. CFN 656/2020, art. 1º, § 1º) — registrado na spec v0.3.1 como o texto proposto que vai à Debby e ao CRN-3.
 */
export const DECLARACAO_RECEITA =
  'Declaro que os itens são suplementos alimentares, medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas, produtos vegetais classificáveis como alimento ou suplemento ou fitoterápicos isentos de prescrição médica, dentro da minha competência (Resoluções CFN nº 656/2020 e nº 680/2021), e que a receita não indica marca nem local de compra.';
export const MSG_DECLARACAO = 'Confirme a declaração para continuar.';
```

Run: `pnpm test src/modules/documentos/prescricao.test.ts` → PASS.

- [ ] **Step 4: Filas** — `src/jobs/queues.ts`

```ts
  // Plano 10A (US-143): PDF preparado da receita, com o código e o QR (≤ 30 s, RNF-140). Payload { tenantId, documentoId }
  'documento-pdf': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // Plano 10A (RN-157, D4): PDF montado com as fotos da digitalizada. Payload { tenantId, documentoId }
  'documento-digitalizado': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 180, deleteAfterSeconds: 86_400 },
  // Plano 10A: PDF pendente há mais de 1 h → falhou; digitalização "recebendo"/"pendente" há mais de 1 h → falhou; PDF base e
  // fotos da digitalizada sem referência → apagados (de 15 em 15 min)
  'expirar-documento-pdf': { retryLimit: 1, retryDelay: 60, expireInSeconds: 300 },
```

- [ ] **Step 5: Ciclo do documento — teste (falha)** — `src/modules/documentos/documentos.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { apagarRascunho, criarReceita, lerDocumento, listarDocumentos, prepararParaAssinatura, salvarRascunhoReceita, voltarAEditar } from './documentos';
import { MSG_PERFIL_PROF, PerfilIncompletoError } from './perfil-profissional';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

const vitD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia, no almoço' };

async function consultorioCompleto() {
  const T = await novoTenant(app.db);
  await app.db.update(tenants).set({ crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678', documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, tenant: tenant as TenantRow };
}

describe('ciclo do documento (US-142, US-143)', () => {
  it('cria o rascunho, salva itens e a justificativa ("Rascunho salvo."), lista e lê com auditoria', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD], orientacoes: 'Tomar com água.' }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    const lista = await listarDocumentos(T.ctx, p.id, app.db);
    expect(lista).toMatchObject([{ id, status: 'rascunho', tipo: 'receita' }]);
    // D17 / regra 8 do CLAUDE.md: a lista não audita porque não devolve conteúdo — só estas chaves (nada de itens, orientações ou justificativa)
    expect(Object.keys(lista[0]).sort()).toEqual(['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo']);
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'rascunho', justificativa: 'Exposição solar baixa', conteudo: { itens: [{ tipo: 'suplemento' }], orientacoes: 'Tomar com água.' } });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows.length).toBe(1);
  });

  it('documento de outro paciente do mesmo consultório: null, sem auditoria (o filtro do paciente vai na própria leitura, antes de notas e recibos)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    expect(await lerDocumento(T.ctx, outro.id, id, app.db)).toBeNull();
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows).toEqual([]);
  });

  it('paciente bloqueado: nada é criado (texto do MVP)', async () => {
    const { T } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(criarReceita(T.ctx, p.id, { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
  });

  it('preparar: exige a declaração, o perfil completo e a justificativa; congela a cópia e enfileira o PDF', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: '' }, { db: app.db });
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: undefined }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.declaracao === 'Confirme a declaração para continuar.');
    await expect(prepararParaAssinatura(T.ctx, { ...tenant, nomeProfissional: null }, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toThrow(MSG_PERFIL_PROF.incompleto);
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && !!e.erros.justificativa);
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') });
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'preparando', pdfStatus: 'pendente', conteudo: { copia: { paciente: { nome: 'Ana Souza' }, profissional: { nomeCompleto: 'Débora Silva Santos', telefone: '(11) 91234-5678' } } } });
    expect(d!.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const jobs = await (await getBoss()).findJobs<{ documentoId: string }>('documento-pdf');
    expect(jobs.some((j) => j.data.documentoId === id)).toBe(true);
    // depois de preparar, salvar o rascunho é recusado (RN-140)
    await expect(salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'x' }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
  });

  it('voltar a editar: o código deixa de existir e o PDF base e as fotos de um envio que falhou saem do disco e da cota, cada um no seu apagar (RN-140 a, regra 9)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const base = `${T.tenantId}/documento_base/${crypto.randomUUID()}.pdf`;
    const foto = `${T.tenantId}/documento_digitalizado/${crypto.randomUUID()}.jpg`;
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, async (tx) => {
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id}), (${T.tenantId}, 'documento_digitalizado', ${foto}, 10, 'image/jpeg', ${p.id})`);
      await tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10, area_assinatura = '{"x1":351,"y1":62,"x2":559,"y2":132}' where id = ${id}`);
      await tx.execute(sql`update signed_documents set digitalizacao = ${JSON.stringify([foto])}::jsonb, digitalizacao_status = 'falhou' where id = ${id}`);
    }, app.db);
    await voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' });
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'rascunho', codigo: null });
    const sobrou = await withTenant(T.ctx, (tx) => tx.execute(sql`select caminho from stored_files where caminho in (${base}, ${foto})`), app.db);
    expect(sobrou.rows).toEqual([]);
  });

  it('apagar: só o rascunho (com a nota em cascata)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await apagarRascunho(T.ctx, p.id, id, { db: app.db });
    expect(await listarDocumentos(T.ctx, p.id, app.db)).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/documentos/documentos.test.ts` → FAIL.

- [ ] **Step 6: Ciclo do documento — implementação** — `src/modules/documentos/documentos.ts`

```ts
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { signedDocumentNotes, signedDocumentReceipts, signedDocuments, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { gerarCodigo } from './codigo';
import { DECLARACAO_RECEITA, MSG_DECLARACAO, type EventoRecibo, type StatusDocumento, type TipoAssinatura, type ViaRecibo } from './constantes';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { copiaDoPerfil } from './perfil-profissional';
import { validarParaPreparar, validarRascunho, type ConteudoReceita } from './prescricao';

export type Recibo = { evento: EventoRecibo; via: ViaRecibo; em: Date };
export type ItemLista = {
  id: string; tipo: 'receita'; status: StatusDocumento; codigo: string | null; createdAt: Date; assinadoEm: Date | null;
  assinaturaTipo: TipoAssinatura | null; pdfStatus: string | null; entregueEm: Date | null; recibos: Recibo[];
};
export type DocumentoLido = ItemLista & {
  conteudo: ConteudoReceita; justificativa: string | null; motivoCancelamento: string | null; assinanteNome: string | null;
  basePdfPath: string | null; pdfPath: string | null; pdfSha256: string | null; digitalizacaoStatus: string | null; anonimizadoEm: Date | null;
};

const CONTEUDO_VAZIO: ConteudoReceita = { versao: 1, tipo: 'receita', itens: [], orientacoes: '' };

/** Trava o documento do paciente (FOR UPDATE) num dos estados pedidos; outro estado → TransicaoInvalidaError. */
async function travarDocumento(tx: Tx, patientId: string, docId: string, estados: readonly StatusDocumento[]) {
  if (!idValido(docId)) throw new DocumentoNaoEncontradoError();
  const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId))).for('update');
  if (!d) throw new DocumentoNaoEncontradoError();
  if (!estados.includes(d.status as StatusDocumento)) throw new TransicaoInvalidaError();
  return d;
}

/** US-142: "Nova receita" — o rascunho vazio e a nota (a justificativa fica fora do conteúdo, D15 da spec). */
export async function criarReceita(ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string> {
  return withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.insert(signedDocuments).values({ tenantId: ctx.tenantId, patientId, tipo: 'receita', conteudo: CONTEUDO_VAZIO }).returning({ id: signedDocuments.id });
    await tx.insert(signedDocumentNotes).values({ tenantId: ctx.tenantId, patientId, documentoId: d.id });
    return d.id;
  }, deps.db ?? getDb());
}

/** "Rascunho salvo." — valida os itens (habilitação no servidor, RN-150) e grava conteúdo e justificativa. */
export async function salvarRascunhoReceita(
  ctx: TenantContext, tenant: TenantRow, patientId: string, docId: string, input: { conteudo: unknown; justificativa: unknown }, deps: { db?: Db } = {},
): Promise<void> {
  const conteudo = validarRascunho(input.conteudo, { habilitada: !!tenant.fitoterapiaRegistro });
  const j = typeof input.justificativa === 'string' ? input.justificativa.trim() : '';
  if (j.length > 2000) throw new DocumentoError({ justificativa: 'Use no máximo 2000 caracteres.' });
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    await travarDocumento(tx, patientId, docId, ['rascunho']);
    await tx.update(signedDocuments).set({ conteudo, updatedAt: new Date() }).where(eq(signedDocuments.id, docId));
    await tx.update(signedDocumentNotes).set({ justificativaUso: j || null, updatedAt: new Date() }).where(eq(signedDocumentNotes.documentoId, docId));
  }, deps.db ?? getDb());
}

export async function apagarRascunho(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    await travarDocumento(tx, patientId, docId, ['rascunho']);
    await tx.delete(signedDocuments).where(eq(signedDocuments.id, docId)); // a nota sai em cascata
  }, deps.db ?? getDb());
}

/**
 * US-143: declaração (D5) + perfil completo + justificativa → congela a cópia (RN-154), gera o código (RN-142) e enfileira o
 * PDF na mesma transação (o job só existe se a transação confirmar).
 */
export async function prepararParaAssinatura(
  ctx: TenantContext, tenant: TenantRow, patientId: string, docId: string, input: { declaracao: unknown }, deps: { db?: Db; boss?: PgBoss; agora?: Date } = {},
): Promise<void> {
  if (input.declaracao !== 'on') throw new DocumentoError({ declaracao: MSG_DECLARACAO });
  const profissional = copiaDoPerfil(tenant); // PerfilIncompletoError
  const agora = deps.agora ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  await withTenant(ctx, async (tx) => {
    const paciente = await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['rascunho']);
    const [nota] = await tx.select({ j: signedDocumentNotes.justificativaUso }).from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, docId));
    const conteudo = d.conteudo as ConteudoReceita;
    validarParaPreparar(conteudo, nota?.j ?? null, { habilitada: !!tenant.fitoterapiaRegistro });
    await tx
      .update(signedDocuments)
      .set({
        status: 'preparando',
        codigo: gerarCodigo(),
        declaracaoEm: agora,
        conteudo: { ...conteudo, copia: { profissional, paciente: { nome: paciente.nome } }, declaracao: DECLARACAO_RECEITA },
        pdfStatus: 'pendente',
        pdfPedidoEm: agora,
        updatedAt: agora,
      })
      .where(eq(signedDocuments.id, docId));
    await boss.send('documento-pdf', { tenantId: ctx.tenantId, documentoId: docId }, { db: fromDrizzle(tx, sql) });
  }, deps.db ?? getDb());
}

/**
 * RN-140 (a): volta a rascunho (código e base nulos) no naMesmaTransacao do DELETE do PDF base. Regra 9: as fotos de um
 * envio digitalizado que falhou saem ANTES, cada uma no seu apagarArquivo (soltarArquivosDoPreparo com `soFotos`); o
 * `digitalizacao: null` do `limpar` só cobre uma foto gravada no meio (corrida), que a varredura da T7 apaga sem referência.
 */
export async function voltarAEditar(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; dataDir?: string } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const limpar = {
    status: 'rascunho', codigo: null, declaracaoEm: null, basePdfPath: null, basePdfSha256: null, basePdfBytes: null, areaAssinatura: null,
    pdfStatus: null, pdfPedidoEm: null, digitalizacao: null, digitalizacaoStatus: null, digitalizacaoEm: null, updatedAt: new Date(),
  } as const;
  const base = await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando', 'aguardando_assinatura']);
    if (!d.basePdfPath) await tx.update(signedDocuments).set(limpar).where(eq(signedDocuments.id, docId));
    return d.basePdfPath;
  }, db);
  if (!base) return;
  await soltarArquivosDoPreparo(ctx, docId, ['aguardando_assinatura'], { db, dataDir: deps.dataDir, soFotos: true });
  const ok = await apagarArquivo(ctx, { caminho: base }, {
    db,
    dataDir: deps.dataDir,
    naMesmaTransacao: async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const r = await tx
        .update(signedDocuments)
        .set(limpar)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.basePdfPath, base), inArray(signedDocuments.status, ['preparando', 'aguardando_assinatura'])))
        .returning({ id: signedDocuments.id });
      return r.length > 0;
    },
  });
  if (!ok) throw new TransicaoInvalidaError();
}

/** US-143 "Gerar o PDF de novo": só com o PDF falho (ou sem cota, RNF-143) e ainda em preparo. */
export async function pedirNovoPdfDocumento(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; boss?: PgBoss; agora?: Date } = {}): Promise<void> {
  const boss = deps.boss ?? (await getBoss());
  const agora = deps.agora ?? new Date();
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando']);
    if (d.pdfStatus !== 'falhou' && d.pdfStatus !== 'sem_cota') throw new TransicaoInvalidaError();
    await tx.update(signedDocuments).set({ pdfStatus: 'pendente', pdfPedidoEm: agora, updatedAt: agora }).where(eq(signedDocuments.id, docId));
    await boss.send('documento-pdf', { tenantId: ctx.tenantId, documentoId: docId }, { db: fromDrizzle(tx, sql) });
  }, deps.db ?? getDb());
}

async function recibosDe(tx: Tx, ids: string[]): Promise<Map<string, Recibo[]>> {
  const m = new Map<string, Recibo[]>();
  if (!ids.length) return m;
  const rs = await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ids)).orderBy(asc(signedDocumentReceipts.em));
  for (const r of rs) m.set(r.documentoId, [...(m.get(r.documentoId) ?? []), { evento: r.evento as EventoRecibo, via: r.via as ViaRecibo, em: r.em }]);
  return m;
}

const comoItem = (d: typeof signedDocuments.$inferSelect, recibos: Recibo[]): ItemLista => ({
  id: d.id, tipo: 'receita', status: d.status as StatusDocumento, codigo: d.codigo, createdAt: d.createdAt, assinadoEm: d.assinadoEm,
  assinaturaTipo: d.assinaturaTipo as TipoAssinatura | null, pdfStatus: d.pdfStatus, entregueEm: d.entregueEm, recibos,
});

/**
 * Lista do prontuário (título, data, situação): sem auditRead, como a agenda (D17; exceção na regra 8 do CLAUDE.md). Só
 * devolve as chaves de ItemLista — nunca itens, orientações ou justificativa (teste das chaves em documentos.test.ts).
 */
export async function listarDocumentos(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<ItemLista[]> {
  if (!idValido(patientId)) return [];
  return withTenant(ctx, async (tx) => {
    const ds = await tx.select().from(signedDocuments).where(eq(signedDocuments.patientId, patientId)).orderBy(desc(signedDocuments.createdAt));
    const rs = await recibosDe(tx, ds.map((d) => d.id));
    return ds.map((d) => comoItem(d, rs.get(d.id) ?? []));
  }, db);
}

/**
 * Leitura completa na transação de quem chama; `auditar` = false no worker (como lerPlanoNaTransacao). Com `patientId`, o
 * filtro do paciente vai na PRÓPRIA leitura do documento: de outro paciente → null antes de ler notas e recibos (uma consulta só).
 */
export async function lerDocumentoNaTransacao(tx: Tx, id: string, o: { auditar: boolean; patientId?: string }): Promise<DocumentoLido | null> {
  if (!idValido(id)) return null;
  const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, id), o.patientId ? eq(signedDocuments.patientId, o.patientId) : undefined));
  if (!d) return null;
  const [n] = await tx.select().from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, id));
  const rs = await recibosDe(tx, [id]);
  if (o.auditar) await auditRead(tx, { entidade: 'documentos', entidadeId: id, patientId: d.patientId });
  return {
    ...comoItem(d, rs.get(id) ?? []),
    conteudo: d.conteudo as ConteudoReceita, justificativa: n?.justificativaUso ?? null, motivoCancelamento: n?.motivoCancelamento ?? null,
    assinanteNome: d.assinanteNome, basePdfPath: d.basePdfPath, pdfPath: d.pdfPath, pdfSha256: d.pdfSha256, digitalizacaoStatus: d.digitalizacaoStatus, anonimizadoEm: d.anonimizadoEm,
  };
}

/** Página do documento no painel (conteúdo + justificativa): dado de saúde, com auditRead (RNF-142), só do paciente da rota. */
export async function lerDocumento(ctx: TenantContext, patientId: string, docId: string, db: Db = getDb()): Promise<DocumentoLido | null> {
  if (!idValido(patientId)) return null;
  return withTenant(ctx, (tx) => lerDocumentoNaTransacao(tx, docId, { auditar: true, patientId }), db);
}

/** Acompanhamento sem recarregar a página (sem auditoria, como statusDoPdf do plano). */
export async function estadoDoDocumento(ctx: TenantContext, docId: string, db: Db = getDb()): Promise<{ status: StatusDocumento; pdfStatus: string | null; digitalizacaoStatus: string | null } | null> {
  if (!idValido(docId)) return null;
  return withTenant(ctx, async (tx) => {
    const [d] = await tx.select({ status: signedDocuments.status, pdfStatus: signedDocuments.pdfStatus, digitalizacaoStatus: signedDocuments.digitalizacaoStatus }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    return d ? { status: d.status as StatusDocumento, pdfStatus: d.pdfStatus, digitalizacaoStatus: d.digitalizacaoStatus } : null;
  }, db);
}
```

`src/modules/documentos/arquivos-do-preparo.ts` (sem sessão — o painel, `documentos.ts`, e o worker, T7/T9/T14, importam; o grafo do worker já é conferido pela guarda da T8):

```ts
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import type { StatusDocumento } from './constantes';

/**
 * Regra 9 do CLAUDE.md (correção do /code-review high do PR #18): cada arquivo do preparo — as fotos da digitalizada e o
 * PDF base — sai do disco e da cota no SEU apagarArquivo, e o ponteiro sai no naMesmaTransacao desse apagar, só se o
 * documento ainda está num dos `estados` e ainda aponta para o arquivo (como o original da foto do diário). Depois da
 * assinatura (EMITIDOS) é o que solta o base e as fotos — a assinatura os mantém e o gatilho só deixa esses ponteiros
 * encolherem (T2); no "Voltar a editar" (`soFotos`), as fotos saem antes do base. Um arquivo que falha não para os outros:
 * a varredura da T7 tenta de novo. Devolve quantos arquivos saíram.
 */
export async function soltarArquivosDoPreparo(
  ctx: TenantContext, documentoId: string, estados: readonly StatusDocumento[], deps: { db?: Db; dataDir?: string; soFotos?: boolean } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  const noEstado = and(eq(signedDocuments.id, documentoId), inArray(signedDocuments.status, [...estados]));
  const [d] = await withTenant(ctx, (tx) => tx.select({ base: signedDocuments.basePdfPath, fotos: signedDocuments.digitalizacao }).from(signedDocuments).where(noEstado), db);
  if (!d) return 0;
  const soltar = (caminho: string, set: Partial<typeof signedDocuments.$inferInsert>, aponta: SQL) =>
    apagarArquivo(ctx, { caminho }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) =>
        (await tx.update(signedDocuments).set({ ...set, updatedAt: new Date() }).where(and(noEstado, aponta)).returning({ id: signedDocuments.id })).length > 0,
    }).catch(() => false);
  let n = 0;
  for (const c of d.fotos ?? [])
    if (await soltar(c, { digitalizacao: sql`nullif(${signedDocuments.digitalizacao} - ${c}::text, '[]'::jsonb)` }, sql`${signedDocuments.digitalizacao} ? ${c}`)) n++;
  const comBase = !!d.base && !deps.soFotos;
  if (comBase && (await soltar(d.base!, { basePdfPath: null }, eq(signedDocuments.basePdfPath, d.base!)))) n++;
  if (n < (d.fotos?.length ?? 0) + (comBase ? 1 : 0))
    logger.warn({ tenantId: ctx.tenantId, documentoId, motivo: 'arquivo_do_preparo' }, 'arquivo do preparo não apagado (a varredura tenta de novo)');
  return n;
}
```

Run: `pnpm test src/modules/documentos/documentos.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/documentos/{codigo,codigo.test,prescricao,prescricao.test,documentos,documentos.test,constantes,arquivos-do-preparo}.ts src/jobs/queues.ts
git commit -m "feat(documentos): receita — código Crockford, esquema da prescrição e ciclo até o preparo (US-142, US-143, RN-142, RN-149, RN-150)"
```

---
### Task 6: Painel — aba "Documentos", lista, editor da receita, preparo, cartão do Início, interruptor do admin e o guia `documentos` (US-142, US-143, P-B8, D18, D20; P10A-06; antiga T7)

**Files:**
- Create: `src/app/painel/pacientes/[id]/documentos/page.tsx`, `.../documentos/actions.ts` (+ `actions.test.ts`), `.../documentos/[docId]/page.tsx` (+ `page.test.ts`), `.../documentos/[docId]/receita-form.tsx`, `.../documentos/[docId]/preparar.tsx`, `.../documentos/[docId]/estado-pdf.tsx`, `.../documentos/[docId]/acao-documento.tsx`
- Modify: `src/app/painel/pacientes/[id]/abas.tsx` e `layout.tsx` (aba só com `documentosLiberados`), `src/modules/agenda/inicio.ts` + `src/app/painel/page.tsx` (cartão), `src/modules/plataforma/contas.ts` + `src/app/admin/{page.tsx,actions.ts,documentos-form.tsx}` (D20), `src/modules/ajuda/conteudo.ts` (+ `conteudo.test.ts`: `src/modules/documentos` em `TSX_FORA`), `e2e/painel-rotas.ts`, `e2e/painel.ts`, `scripts/e2e-seed.ts`

**Interfaces:**
- Consumes: tudo da T5; `ROTULO_STATUS`, `DECLARACAO_RECEITA`, `MSG_DECLARACAO` (constantes); `TIPOS_ITEM`, `CATEGORIAS`, `UNIDADES`, `VIAS`, `MODOS_PREPARO`, `descreverItem` (prescricao); `carregarProntuario`; `Cartao`, `Botao`, `BotaoLink`, `Aviso`, `Selo`, `ConfirmarBotao`.
- Produces:
  - Server Actions (`.../documentos/actions.ts`): `criarReceitaAction(patientId)`, `salvarRascunhoAction(patientId, docId, prev, form)`, `apagarRascunhoAction(patientId, docId, prev)`, `prepararAction(patientId, docId, prev, form)`, `voltarAEditarAction(patientId, docId, prev)`, `pedirNovoPdfAction(patientId, docId, prev)`; tipo `EstadoForm = { erros?: Record<string, string>; ok?: boolean }`. As ações de botão devolvem o erro ao formulário (`useActionState`, componente `AcaoDocumento`) e só dão o sinal de sucesso (`?apagado=1`, página revalidada) quando deu certo.
  - `situacaoNoPainel(d: ItemLista, fuso: string): string` (em `documentos.ts`; interface alinhada ao código — Minor da revisão de cobertura: "Rascunho", "Preparando o PDF", "Aguardando assinatura", "Assinado em dd/mm/aaaa"…, a parte da entrega vem na T10).
  - `contarAguardandoAssinatura(tx): Promise<number>` (em `documentos.ts`; sem os de paciente bloqueado ou anonimizado — prontuário só para consulta, nada a resolver; o arquivado conta, porque pode assinar, D14); `Inicio.documentosAguardando: number | null`.
  - `definirDocumentosLiberados(db, tenantId, liberar: boolean, adminId: string)` (em `contas.ts`); `ContaResumo.documentosLiberados`.
  - `IdsDoPainel.documento`; rotas `/painel/pacientes/[id]/documentos` e `/painel/pacientes/[id]/documentos/[docId]` em `ROTAS_DO_PAINEL`.
  - Guia `documentos` em `GUIAS` (antes do `prontuario`).

- [ ] **Step 1: Teste do manual e das rotas (falha)**

Em `src/modules/ajuda/conteudo.test.ts`, no caso `guiaDaRota`:

```ts
    expect(guiaDaRota(`/painel/pacientes/${UUID}/documentos`)?.id).toBe('documentos');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/documentos/${UUID}`)?.id).toBe('documentos');
```

e `TSX_FORA` passa a incluir `'src/modules/documentos'` (os rótulos dos tipos de item e das vias vêm de `prescricao.ts`).

Run: `pnpm test src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL (sem guia; depois das páginas, sem rota no axe).

Os testes das correções do `/code-review high` do PR #18 (ações que engoliam o erro, página que quebrava com documento anonimizado, cartão do Início contando o que não dá para resolver):

```ts
// src/app/painel/pacientes/[id]/documentos/actions.test.ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { documentoNoBanco } from '../../../../../../test/documentos';
import { nutriComDpa } from '../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../test/pacientes';

// As ações pelo caminho real (requireNutri → Postgres via Testcontainers), como plano-alimentar/actions.test.ts; só o
// que depende do runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
const req = vi.hoisted(() => ({ headers: new Headers() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { apagarRascunhoAction, pedirNovoPdfAction, voltarAEditarAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => revalidatePath.mockClear());
const MUDOU = { erros: { geral: 'Este documento mudou de situação. Recarregue a página.' } };

async function consultorio() {
  const N = await nutriComDpa(db, auth);
  await db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, N.tenantId));
  req.headers = new Headers({ cookie: N.cookie });
  const p = await novoPaciente(db, N.ctx);
  return { N, p };
}

describe('ações do documento: o erro volta ao formulário; o sinal de sucesso só quando deu certo', () => {
  it('"Apagar rascunho" de um documento que outra aba já preparou: o motivo, sem "Rascunho apagado." nem revalidar', async () => {
    const { N, p } = await consultorio();
    const preparando = await documentoNoBanco(db, N.ctx, p.id, { status: 'preparando' });
    expect(await apagarRascunhoAction(p.id, preparando.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    await expect(apagarRascunhoAction(p.id, rascunho.id, {})).rejects.toThrow(`redirect /painel/pacientes/${p.id}/documentos?apagado=1`);
  });

  it('"Gerar o PDF de novo" e "Voltar a editar" fora do estado: o motivo, sem revalidar; no estado certo, ok', async () => {
    const { N, p } = await consultorio();
    const preparando = await documentoNoBanco(db, N.ctx, p.id, { status: 'preparando' }); // pdf_status nulo: nada a pedir de novo
    expect(await pedirNovoPdfAction(p.id, preparando.id, {})).toEqual(MUDOU);
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    expect(await voltarAEditarAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await voltarAEditarAction(p.id, preparando.id, {})).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
  });
});
```

```ts
// src/app/painel/pacientes/[id]/documentos/[docId]/page.test.ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: prontuário, documento e ações simulados (como /p/plano/page.test.ts).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
vi.mock('../../prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: { fuso: 'America/Sao_Paulo', documentosLiberados: true, fitoterapiaRegistro: null },
    paciente: { id: PACIENTE, status: 'bloqueado', anonimizadoEm: new Date('2026-10-01T12:00:00Z'), userId: null, email: 'ana@ex.com' },
    data: { user: { twoFactorEnabled: true } },
  }),
}));
// a T10 acrescenta entreguePessoalmenteAction e reenviarLinkAction; a T15, cancelarAction
vi.mock('../actions', () => ({ apagarRascunhoAction: vi.fn(), pedirNovoPdfAction: vi.fn(), voltarAEditarAction: vi.fn() }));
vi.mock('@/modules/documentos/documentos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/documentos/documentos')>()),
  // RN-140 (c): emitido anonimizado — conteudo '{}', sem PDF
  lerDocumento: async () => ({
    id: DOC, tipo: 'receita', status: 'assinado', codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: new Date('2026-09-02T12:00:00Z'),
    assinaturaTipo: 'digitalizada', pdfStatus: 'pronto', entregueEm: null, recibos: [], conteudo: {}, justificativa: null, motivoCancelamento: null,
    assinanteNome: null, basePdfPath: null, pdfPath: null, pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null, anonimizadoEm: new Date('2026-10-01T12:00:00Z'),
  }),
}));
const { default: DocumentoPage } = await import('./page');

describe('página do documento: documento anonimizado (RN-140 c)', () => {
  it('não quebra com o conteúdo vazio: mostra "Documento anonimizado." e nada de itens nem de PDF', async () => {
    const html = renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }) } as never));
    expect(html).toContain('Documento anonimizado.');
    expect(html).not.toContain('Itens da receita');
    expect(html).not.toContain('Baixar PDF assinado');
  });
});
```

E em `src/modules/documentos/documentos.test.ts` (imports a mais: `documentoNoBanco` de `../../../test/documentos` e `contarAguardandoAssinatura` de `./documentos`):

```ts
  it('P-B8: o cartão do Início conta o que dá para assinar — arquivado conta (D14); bloqueado e anonimizado não (prontuário só para consulta)', async () => {
    const { T } = await consultorioCompleto();
    const ativo = await novoPaciente(app.db, T.ctx);
    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const bloqueado = await novoPaciente(app.db, T.ctx);
    for (const p of [ativo, arquivado, bloqueado]) await documentoNoBanco(app.db, T.ctx, p.id, { status: 'aguardando_assinatura' });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${bloqueado.id}`), app.db);
    expect(await withTenant(T.ctx, (tx) => contarAguardandoAssinatura(tx), app.db)).toBe(2);
  });
```

Run: `pnpm test 'src/app/painel/pacientes/[id]/documentos' src/modules/documentos/documentos.test.ts` → FAIL (sem as ações, a página e a contagem).

- [ ] **Step 2: Ações** — `src/app/painel/pacientes/[id]/documentos/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { apagarRascunho, criarReceita, pedirNovoPdfDocumento, prepararParaAssinatura, salvarRascunhoReceita, voltarAEditar } from '@/modules/documentos/documentos';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from '@/modules/documentos/erros';
import { PerfilIncompletoError } from '@/modules/documentos/perfil-profissional';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type EstadoForm = { erros?: Record<string, string>; ok?: boolean; perfilIncompleto?: boolean };

const caminho = (patientId: string, docId?: string) => `/painel/pacientes/${patientId}/documentos${docId ? `/${docId}` : ''}`;

/** D20: sem a liberação, as ações não existem (404), como a aba. */
async function acesso(path: string) {
  const a = await requireNutri(path);
  if (!a.tenant.documentosLiberados) notFound();
  return a;
}

function comoEstado(e: unknown): EstadoForm {
  if (e instanceof DocumentoError) return { erros: e.erros };
  if (e instanceof PerfilIncompletoError) return { erros: { geral: e.message }, perfilIncompleto: true };
  if (e instanceof TransicaoInvalidaError || e instanceof PacienteBloqueadoError) return { erros: { geral: e.message } };
  if (e instanceof DocumentoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) notFound();
  throw e;
}

export async function criarReceitaAction(patientId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId));
  let id: string;
  try {
    id = await criarReceita(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (e instanceof PacienteBloqueadoError) redirect(`${caminho(patientId)}?bloqueado=1`);
    throw e;
  }
  redirect(caminho(patientId, id));
}

export async function salvarRascunhoAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx, tenant } = await acesso(caminho(patientId, docId));
  let conteudo: unknown = null;
  try {
    conteudo = JSON.parse(String(f.get('conteudo') ?? '{}'));
  } catch {
    return { erros: { geral: 'Formulário inválido.' } };
  }
  try {
    await salvarRascunhoReceita(ctx, tenant, patientId, docId, { conteudo, justificativa: f.get('justificativa') });
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

/**
 * As ações de botão (AcaoDocumento, useActionState): o erro VOLTA ao formulário (role="alert") e o sinal de sucesso —
 * "?apagado=1", a página revalidada — só sai quando deu certo (correção do /code-review high do PR #18: antes, o retorno
 * de comoEstado era ignorado e a tela dizia "Rascunho apagado." com o documento ainda lá).
 */
export async function apagarRascunhoAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await apagarRascunho(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  redirect(`${caminho(patientId)}?apagado=1`);
}

export async function prepararAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx, tenant } = await acesso(caminho(patientId, docId));
  try {
    await prepararParaAssinatura(ctx, tenant, patientId, docId, { declaracao: f.get('declaracao') });
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

export async function voltarAEditarAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await voltarAEditar(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

export async function pedirNovoPdfAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await pedirNovoPdfDocumento(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId, docId));
  return { ok: true };
}
```

`src/app/painel/pacientes/[id]/documentos/[docId]/acao-documento.tsx` (o botão das ações acima e das da T10):

```tsx
'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import type { EstadoForm } from '../actions';

/**
 * Botão de uma ação do documento, com confirmação opcional. O erro volta aqui (role="alert"); o sucesso aparece na página
 * revalidada ou no aviso do redirect ("Rascunho apagado.", "Link reenviado.") — como BotaoAcao do plano alimentar.
 */
export function AcaoDocumento({ acao, rotulo, confirmar, secundario = false }: { acao: (prev: EstadoForm) => Promise<EstadoForm>; rotulo: string; confirmar?: string; secundario?: boolean }) {
  const [s, action, pendente] = useActionState<EstadoForm>(acao, {});
  const erro = Object.values(s.erros ?? {})[0];
  return (
    <form action={action} className="space-y-1" onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }}>
      {secundario ? (
        <Botao variante="secundario" disabled={pendente}>{rotulo}</Botao>
      ) : (
        <button disabled={pendente} className="inline-flex min-h-11 items-center text-link underline disabled:opacity-50">{rotulo}</button>
      )}
      {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Lista** — `src/app/painel/pacientes/[id]/documentos/page.tsx`

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import { listarDocumentos, situacaoNoPainel } from '@/modules/documentos/documentos';
import { linhaDaAssinatura, ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO } from '@/modules/documentos/constantes';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';
import { criarReceitaAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function DocumentosPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/documentos'>) {
  const { id } = await params;
  const busca = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  if (!tenant.documentosLiberados) notFound();
  const lista = await listarDocumentos(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado' || !!paciente.anonimizadoEm;
  return (
    <section aria-labelledby="documentos" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="documentos" className="text-lg font-semibold">Documentos</h2>
        {!bloqueado && (
          <form action={criarReceitaAction.bind(null, paciente.id)} data-guia="nova-receita">
            <Botao>Nova receita</Botao>
          </form>
        )}
      </div>
      {busca.apagado && <Aviso tipo="ok" papel="status">Rascunho apagado.</Aviso>}
      {(bloqueado || busca.bloqueado) && <Aviso tipo="aviso">Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.</Aviso>}
      {lista.length === 0 ? (
        <p>Nenhum documento ainda.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">{`Documentos de ${paciente.nome}`}</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Documento</th>
              <th scope="col">Data</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((d) => (
              <tr key={d.id} className="border-t border-linha">
                <td>
                  <Link href={`/painel/pacientes/${paciente.id}/documentos/${d.id}`} className="inline-flex min-h-11 items-center text-link underline">
                    {`${TIPO_DOCUMENTO_ROTULO[d.tipo]} de ${formatarData(hojeNoFuso(tenant.fuso, d.createdAt))}`}
                  </Link>
                </td>
                <td>{formatarData(hojeNoFuso(tenant.fuso, d.assinadoEm ?? d.createdAt))}</td>
                <td>
                  <Selo>{ROTULO_STATUS[d.status]}</Selo> <span className="text-sm text-suave">{situacaoNoPainel(d, tenant.fuso)}</span>
                  {/* RN-157 / US-144: "Assinatura: Digitalizado" (ou gov.br, ICP) também na lista da nutricionista */}
                  {d.assinaturaTipo && <span className="block text-sm text-suave">{linhaDaAssinatura(d.assinaturaTipo)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

Em `documentos.ts`, acrescentar:

```ts
import { partesNoFuso } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';

/** "dd/mm/aaaa às hh:mm" no fuso do consultório (o formatarQuando da agenda põe o dia da semana na frente). */
export function dataHora(d: Date, fuso: string): string {
  const p = partesNoFuso(d, fuso);
  return `${formatarData(p.data)} às ${p.hora}`;
}

/** Linha da situação na lista (a parte da entrega e do recebimento entra na T10). */
export function situacaoNoPainel(d: ItemLista, fuso: string): string {
  if (d.status === 'preparando') return d.pdfStatus === 'falhou' ? 'Não foi possível gerar o PDF. Tente de novo.' : d.pdfStatus === 'sem_cota' ? MSG_COTA_ESGOTADA : '';
  if (d.status === 'assinado' && d.assinadoEm) return `Assinado em ${dataHora(d.assinadoEm, fuso)}`;
  return '';
}

/**
 * P-B8: o cartão do Início — só o que a nutricionista consegue resolver. Paciente bloqueado (ou anonimizado) tem o
 * prontuário só para consulta: não assina, não volta a editar, e a anonimização apaga o não emitido (T14) — não conta.
 * O arquivado conta: pode redigir, preparar e assinar (D14). Correção do /code-review high do PR #18.
 */
export async function contarAguardandoAssinatura(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(signedDocuments)
    .innerJoin(patients, and(eq(patients.tenantId, signedDocuments.tenantId), eq(patients.id, signedDocuments.patientId)))
    .where(and(eq(signedDocuments.status, 'aguardando_assinatura'), ne(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm)));
  return r?.n ?? 0;
}
```

(imports a mais em `documentos.ts`: `isNull`, `ne` de `drizzle-orm` e `patients` de `@/db/schema`.)


- [ ] **Step 4: Página do documento** — `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { Selo } from '@/components/ui/selo';
import { idValido } from '@/modules/pacientes/base';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { DECLARACAO_RECEITA, ROTULO_ASSINATURA, ROTULO_STATUS } from '@/modules/documentos/constantes';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { dataHora, lerDocumento } from '@/modules/documentos/documentos';
import { descreverItem } from '@/modules/documentos/prescricao';
import { carregarProntuario } from '../../prontuario';
import { apagarRascunhoAction, pedirNovoPdfAction, voltarAEditarAction } from '../actions';
import { AcaoDocumento } from './acao-documento';
import { EstadoPdf } from './estado-pdf';
import { Preparar } from './preparar';
import { ReceitaForm } from './receita-form';

export const dynamic = 'force-dynamic';

export default async function DocumentoPage({ params }: PageProps<'/painel/pacientes/[id]/documentos/[docId]'>) {
  const { id, docId } = await params;
  if (!idValido(docId)) notFound();
  const { ctx, tenant, paciente, data } = await carregarProntuario(id);
  if (!tenant.documentosLiberados) notFound();
  const d = await lerDocumento(ctx, paciente.id, docId);
  if (!d) notFound();
  const bloqueado = paciente.status === 'bloqueado' || !!paciente.anonimizadoEm;
  const habilitada = !!tenant.fitoterapiaRegistro;
  // RN-140 (c): o emitido anonimizado tem conteudo '{}' e nenhum PDF — a página mostra só a situação (correção do /code-review high do PR #18)
  const anonimizado = !!d.anonimizadoEm;
  return (
    <section aria-labelledby="documento" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="documento" className="text-lg font-semibold">Receita</h2>
        <Selo>{ROTULO_STATUS[d.status]}</Selo>
        {d.codigo && d.status !== 'rascunho' && <span className="text-sm text-suave">{`Código de verificação: ${formatarCodigo(d.codigo)}`}</span>}
      </div>

      {anonimizado && <Aviso tipo="aviso">Documento anonimizado.</Aviso>}

      {d.status === 'rascunho' && !bloqueado && (
        <>
          <ReceitaForm patientId={paciente.id} docId={d.id} conteudo={d.conteudo} justificativa={d.justificativa ?? ''} habilitada={habilitada} />
          <Preparar patientId={paciente.id} docId={d.id} declaracao={DECLARACAO_RECEITA} />
          <AcaoDocumento acao={apagarRascunhoAction.bind(null, paciente.id, d.id)} rotulo="Apagar rascunho" confirmar="Apagar este rascunho?" />
        </>
      )}

      {d.status !== 'rascunho' && !anonimizado && (
        <Cartao id="itens-receita" titulo="Itens da receita">
          <ol className="list-decimal space-y-2 pl-5">
            {(d.conteudo.itens ?? []).map((it, i) => {
              const x = descreverItem(it);
              return (
                <li key={i}>
                  <p className="font-semibold">{x.titulo}</p>
                  {x.linhas.map((l) => <p key={l} className="text-sm">{l}</p>)}
                </li>
              );
            })}
          </ol>
          {d.conteudo.orientacoes && <p className="mt-3">{d.conteudo.orientacoes}</p>}
          {d.justificativa && <p className="mt-3 text-sm text-suave">{`Justificativa de uso (fica no prontuário, não vai na receita): ${d.justificativa}`}</p>}
        </Cartao>
      )}

      {d.status === 'preparando' && (
        d.pdfStatus === 'falhou' || d.pdfStatus === 'sem_cota' ? (
          <Aviso tipo="erro" papel="alert">
            {/* RNF-143 (Minor da revisão de cobertura): cota esgotada tem a mensagem dela, não a de falha genérica */}
            {d.pdfStatus === 'sem_cota' ? MSG_COTA_ESGOTADA : 'Não foi possível gerar o PDF. Tente de novo.'}
            <div className="mt-2">
              <AcaoDocumento acao={pedirNovoPdfAction.bind(null, paciente.id, d.id)} rotulo="Gerar o PDF de novo" secundario />
            </div>
          </Aviso>
        ) : (
          <EstadoPdf docId={d.id} />
        )
      )}

      {d.status === 'aguardando_assinatura' && (
        <Cartao id="aguardando-assinatura" titulo="Aguardando assinatura" data-guia="assinar-documento">
          {/* Plano 10A: só a digitalizada. O Plano 10B (T5) troca este parágrafo pelo texto do gov.br e do certificado e põe a dica do quadro. */}
          <p>Baixe o PDF, imprima, assine à mão e envie fotos das páginas aqui.</p>
          <BotaoLink href={`/api/painel/documentos/${d.id}/pdf?base=1`} prefetch={false}>Baixar PDF para assinar</BotaoLink>
          {!data.user.twoFactorEnabled && (
            <Aviso tipo="aviso">
              Ative a verificação em duas etapas em Segurança para assinar documentos. <a href="/conta/seguranca" className="underline">Ativar agora</a>
            </Aviso>
          )}
          {!bloqueado && (
            <AcaoDocumento acao={voltarAEditarAction.bind(null, paciente.id, d.id)} rotulo="Voltar a editar" confirmar="O PDF preparado será descartado. Continuar?" />
          )}
        </Cartao>
      )}

      {d.status === 'assinado' && (
        <Cartao id="documento-assinado" titulo="Documento assinado">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>Assinado em</dt>
            <dd>{d.assinadoEm ? dataHora(d.assinadoEm, tenant.fuso) : '—'}</dd>
            <dt>Assinatura</dt>
            <dd>{d.assinaturaTipo ? ROTULO_ASSINATURA[d.assinaturaTipo] : '—'}</dd>
            {d.assinanteNome && (
              <>
                <dt>Assinado por</dt>
                <dd>{d.assinanteNome}</dd>
              </>
            )}
          </dl>
          {!anonimizado && <BotaoLink href={`/api/painel/documentos/${d.id}/pdf`} prefetch={false} variante="secundario">Baixar PDF assinado</BotaoLink>}
        </Cartao>
      )}
    </section>
  );
}
```

> A T9 acrescenta `<EnviarDigitalizada />` dentro do cartão "Aguardando assinatura"; a T10 a seção de entrega e recebimento; a T15 o "Cancelar documento" — as duas só com `!anonimizado` (documento anonimizado não tem PDF nem conteúdo). O Plano 10B (T5) acrescenta o formulário do PDF assinado e o texto do gov.br e do certificado.

- [ ] **Step 5: Editor da receita** — `src/app/painel/pacientes/[id]/documentos/[docId]/receita-form.tsx`

```tsx
'use client';

import { useActionState, useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { CATEGORIAS, MODOS_PREPARO, MSG_PRESCRICAO, TIPOS_ITEM, UNIDADES, VIAS, type ConteudoReceita } from '@/modules/documentos/prescricao';
import { salvarRascunhoAction, type EstadoForm } from '../actions';

type TipoItem = keyof typeof TIPOS_ITEM;
type Componente = { nome: string; quantidade: string; unidade: string };
type ItemForm = Record<string, string | boolean | Componente[]> & { tipo: TipoItem };
type CampoTexto = { chave: string; rotulo: string; max: number; obrigatorio: boolean; area?: boolean };

const T = (chave: string, rotulo: string, max: number, obrigatorio = true, area = false): CampoTexto => ({ chave, rotulo, max, obrigatorio, area });
const BOTANICA = [T('nomenclatura', 'Nomenclatura botânica', 120), T('parte', 'Parte utilizada', 60)];
const FINAIS = [T('nomePopular', 'Nome popular', 60, false), T('duracao', 'Duração', 100, false)];
/** US-142: os campos de cada tipo de item (rótulos e limites da tabela da spec). */
const CAMPOS: Record<TipoItem, CampoTexto[]> = {
  suplemento: [T('forma', 'Forma de apresentação', 60), T('posologia', 'Posologia', 300, true, true), T('duracao', 'Duração', 100, false)],
  planta_cha: [...BOTANICA, T('formaUso', 'Forma de utilização e preparo', 300, true, true), T('posologia', 'Posologia', 300, true, true), ...FINAIS],
  derivado_vegetal: [...BOTANICA, T('formaFarmaceutica', 'Forma farmacêutica', 60), T('dose', 'Dose', 120), T('posologia', 'Posologia', 300, true, true), T('padronizacao', 'Padronização do marcador', 120, false), T('extracao', 'Forma ou meio de extração', 120, false), ...FINAIS],
  fitoterapico: [...BOTANICA, T('extracao', 'Forma ou meio de extração', 120), T('formaFarmaceutica', 'Forma farmacêutica', 60), T('dose', 'Dose', 120), T('posologia', 'Posologia', 300, true, true), T('padronizacao', 'Padronização do marcador', 120, false), ...FINAIS],
};
const novoItem = (tipo: TipoItem): ItemForm =>
  tipo === 'suplemento' ? { tipo, categoria: 'nutriente', composicao: [{ nome: '', quantidade: '', unidade: 'mg' }], via: 'oral', manipulado: false } : tipo === 'planta_cha' ? { tipo, modoPreparo: 'infusao' } : { tipo, via: 'oral' };

/** O conteúdo salvo vira o estado do formulário (números como texto, para a vírgula). */
function doConteudo(c: ConteudoReceita): ItemForm[] {
  return c.itens.map((it) => {
    const o: Record<string, unknown> = { ...it };
    if (it.tipo === 'suplemento') o.composicao = it.composicao.map((k) => ({ nome: k.nome, quantidade: String(k.quantidade).replace('.', ','), unidade: k.unidade }));
    return o as ItemForm;
  });
}

export function ReceitaForm({ patientId, docId, conteudo, justificativa, habilitada }: { patientId: string; docId: string; conteudo: ConteudoReceita; justificativa: string; habilitada: boolean }) {
  const [s, action, pendente] = useActionState<EstadoForm, FormData>(salvarRascunhoAction.bind(null, patientId, docId), {});
  const [itens, setItens] = useState<ItemForm[]>(() => doConteudo(conteudo));
  const [orientacoes, setOrientacoes] = useState(conteudo.orientacoes);
  const [tipoNovo, setTipoNovo] = useState<TipoItem>('suplemento');
  const e = s.erros ?? {};
  const mudar = (i: number, chave: string, v: unknown) => setItens((xs) => xs.map((x, j) => (j === i ? { ...x, [chave]: v as string } : x)));
  const erroDe = (k: string) => e[k];
  const idDe = (k: string) => k.replace(/\./g, '-');
  const campo = (i: number, c: CampoTexto, it: ItemForm) => {
    const k = `itens.${i}.${c.chave}`;
    const Tag = c.area ? 'textarea' : 'input';
    return (
      <div key={c.chave} className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{`${c.rotulo}${c.obrigatorio ? '' : ' (opcional)'}`}</label>
        <Tag id={idDe(k)} maxLength={c.max} value={String(it[c.chave] ?? '')} onChange={(ev) => mudar(i, c.chave, ev.target.value)} aria-invalid={erroDe(k) ? true : undefined} aria-describedby={erroDe(k) ? `${idDe(k)}-erro` : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {erroDe(k) && <p id={`${idDe(k)}-erro`} role="alert" className="text-sm text-erro">{erroDe(k)}</p>}
      </div>
    );
  };
  const selecao = (i: number, chave: string, rotulo: string, opcoes: Record<string, string>, it: ItemForm) => {
    const k = `itens.${i}.${chave}`;
    return (
      <div className="space-y-1">
        <label htmlFor={idDe(k)} className="block font-medium">{rotulo}</label>
        <select id={idDe(k)} value={String(it[chave] ?? '')} onChange={(ev) => mudar(i, chave, ev.target.value)} aria-invalid={erroDe(k) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">
          {Object.entries(opcoes).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        {erroDe(k) && <p role="alert" className="text-sm text-erro">{erroDe(k)}</p>}
      </div>
    );
  };
  return (
    <form action={action} className="space-y-6" data-guia="editor-receita">
      <input type="hidden" name="conteudo" value={JSON.stringify({ itens, orientacoes })} />
      <h3 className="font-semibold">Itens da receita</h3>
      {e.itens && <p role="alert" className="text-erro">{e.itens}</p>}
      {itens.map((it, i) => (
        <fieldset key={i} className="space-y-3 rounded-2xl border border-borda p-4">
          <legend className="px-1 font-semibold">{`Item ${i + 1}: ${TIPOS_ITEM[it.tipo]}`}</legend>
          {erroDe(`itens.${i}.tipo`) && <p role="alert" className="text-sm text-erro">{erroDe(`itens.${i}.tipo`)}</p>}
          {it.tipo === 'suplemento' && (
            <>
              {selecao(i, 'categoria', 'Categoria', CATEGORIAS, it)}
              {/* Minor 11 da revisão de normas: extrato vegetal não entra como "Outro" (art. 12, I, da Res. 680) */}
              {it.categoria === 'outro' && <p className="text-sm text-suave">{MSG_PRESCRICAO.dicaOutro}</p>}
              <fieldset className="space-y-2">
                <legend className="font-medium">Composição</legend>
                {(it.composicao as Componente[]).map((k, j) => {
                  const base = `itens.${i}.composicao.${j}`;
                  const set = (campoK: keyof Componente, v: string) => mudar(i, 'composicao', (it.composicao as Componente[]).map((x, m) => (m === j ? { ...x, [campoK]: v } : x)));
                  return (
                    <div key={j} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                      <div><label htmlFor={idDe(`${base}.nome`)} className="block text-sm">{`Componente ${j + 1}`}</label><input id={idDe(`${base}.nome`)} value={k.nome} maxLength={120} onChange={(ev) => set('nome', ev.target.value)} aria-invalid={erroDe(`${base}.nome`) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" /></div>
                      <div><label htmlFor={idDe(`${base}.quantidade`)} className="block text-sm">Quantidade</label><input id={idDe(`${base}.quantidade`)} inputMode="decimal" value={k.quantidade} onChange={(ev) => set('quantidade', ev.target.value)} aria-invalid={erroDe(`${base}.quantidade`) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" /></div>
                      <div><label htmlFor={idDe(`${base}.unidade`)} className="block text-sm">Unidade</label><select id={idDe(`${base}.unidade`)} value={k.unidade} onChange={(ev) => set('unidade', ev.target.value)} aria-invalid={erroDe(`${base}.unidade`) ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto">{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></div>
                      <button type="button" className="min-h-11 self-end underline" onClick={() => mudar(i, 'composicao', (it.composicao as Componente[]).filter((_, m) => m !== j))}>{`Remover componente ${j + 1}`}</button>
                      {[`${base}.nome`, `${base}.quantidade`, `${base}.unidade`].map((x) => erroDe(x) && <p key={x} role="alert" className="text-sm text-erro sm:col-span-4">{erroDe(x)}</p>)}
                    </div>
                  );
                })}
                {(it.composicao as Componente[]).length < 10 && (
                  <button type="button" className="min-h-11 underline" onClick={() => mudar(i, 'composicao', [...(it.composicao as Componente[]), { nome: '', quantidade: '', unidade: 'mg' }])}>Adicionar componente</button>
                )}
              </fieldset>
            </>
          )}
          {it.tipo === 'planta_cha' && selecao(i, 'modoPreparo', 'Modo de preparo', MODOS_PREPARO, it)}
          {CAMPOS[it.tipo].map((c) => campo(i, c, it))}
          {it.tipo !== 'planta_cha' && selecao(i, 'via', 'Via', VIAS, it)}
          {it.tipo === 'suplemento' && (
            <div className="flex items-center gap-2">
              <input id={`item-${i}-manipulado`} type="checkbox" checked={it.manipulado === true} onChange={(ev) => mudar(i, 'manipulado', ev.target.checked)} className="size-5" />
              <label htmlFor={`item-${i}-manipulado`}>Manipulado</label>
            </div>
          )}
          <button type="button" className="min-h-11 underline" onClick={() => setItens((xs) => xs.filter((_, j) => j !== i))}>{`Remover item ${i + 1}`}</button>
        </fieldset>
      ))}
      {itens.length < 20 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="tipo-novo" className="block font-medium">Tipo do item</label>
            <select id="tipo-novo" value={tipoNovo} onChange={(ev) => setTipoNovo(ev.target.value as TipoItem)} aria-describedby={habilitada ? undefined : 'fito-dica'} className="rounded-xl border border-campo bg-cartao p-2 text-texto">
              {(Object.keys(TIPOS_ITEM) as TipoItem[]).map((t) => (
                <option key={t} value={t} disabled={t === 'fitoterapico' && !habilitada}>{TIPOS_ITEM[t]}</option>
              ))}
            </select>
          </div>
          <Botao type="button" variante="secundario" onClick={() => setItens((xs) => [...xs, novoItem(tipoNovo)])}>Adicionar item</Botao>
          {!habilitada && <p id="fito-dica" className="w-full text-sm text-suave">{MSG_PRESCRICAO.semHabilitacao}</p>}
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="orientacoes" className="block font-medium">Orientações gerais (opcional)</label>
        <textarea id="orientacoes" maxLength={2000} value={orientacoes} onChange={(ev) => setOrientacoes(ev.target.value)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        {e.orientacoes && <p role="alert" className="text-sm text-erro">{e.orientacoes}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="justificativa" className="block font-medium">Justificativa de uso</label>
        <textarea id="justificativa" name="justificativa" maxLength={2000} defaultValue={justificativa} aria-describedby="justificativa-dica" aria-invalid={e.justificativa ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <p id="justificativa-dica" className="text-sm text-suave">Fica no prontuário, não vai na receita.</p>
        {e.justificativa && <p role="alert" className="text-sm text-erro">{e.justificativa}</p>}
      </div>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {s.ok && <p role="status">Rascunho salvo.</p>}
      <Botao disabled={pendente}>Salvar rascunho</Botao>
    </form>
  );
}
```

- [ ] **Step 6: Preparar e acompanhar o PDF** — `preparar.tsx` e `estado-pdf.tsx`

```tsx
// preparar.tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { prepararAction, type EstadoForm } from '../actions';

/** US-143: a declaração (D5 da spec, rascunho) com a caixa obrigatória. */
export function Preparar({ patientId, docId, declaracao }: { patientId: string; docId: string; declaracao: string }) {
  const [s, action, pendente] = useActionState<EstadoForm, FormData>(prepararAction.bind(null, patientId, docId), {});
  const e = s.erros ?? {};
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-borda bg-cartao p-4" data-guia="preparar-documento">
      <fieldset className="space-y-2">
        <legend className="font-semibold">Declaração</legend>
        <div className="flex items-start gap-2">
          <input id="declaracao" name="declaracao" type="checkbox" className="mt-1 size-5" aria-invalid={e.declaracao ? true : undefined} aria-describedby={e.declaracao ? 'declaracao-erro' : undefined} />
          <label htmlFor="declaracao">{declaracao}</label>
        </div>
        {e.declaracao && <p id="declaracao-erro" role="alert" className="text-sm text-erro">{e.declaracao}</p>}
      </fieldset>
      {e.justificativa && <p role="alert" className="text-erro">{e.justificativa}</p>}
      {e.itens && <p role="alert" className="text-erro">{e.itens}</p>}
      {e.geral && (
        <p role="alert" className="text-erro">
          {e.geral} {s.perfilIncompleto && <Link href="/painel/configuracoes/perfil#documentos" className="underline">Completar perfil</Link>}
        </p>
      )}
      <Botao disabled={pendente}>Preparar para assinatura</Botao>
    </form>
  );
}
```

```tsx
// estado-pdf.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** "Preparando o PDF…": pergunta o estado a cada 3 s (sem auditoria, como o plano alimentar) e recarrega quando muda. */
export function EstadoPdf({ docId }: { docId: string }) {
  const router = useRouter();
  useEffect(() => {
    let vivo = true;
    const t = setInterval(async () => {
      const r = await fetch(`/api/painel/documentos/${docId}/pdf?estado=1`, { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { status: string; pdfStatus: string | null }) : null;
      if (vivo && j && (j.status !== 'preparando' || j.pdfStatus === 'falhou' || j.pdfStatus === 'sem_cota')) router.refresh();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [docId, router]);
  return <p role="status" aria-live="polite">Preparando o PDF…</p>;
}
```

- [ ] **Step 7: Aba, cartão do Início e interruptor do admin (D20)**

`abas.tsx`: `ABAS` ganha `{ seg: 'documentos', rotulo: 'Documentos' }` **antes** de `historico`; `Abas` recebe `documentos: boolean` e filtra `ABAS.filter((a) => a.seg !== 'documentos' || documentos)`; o `layout.tsx` passa `documentos={tenant.documentosLiberados}`.

`inicio.ts`: `lerInicio` recebe `tenant` com `documentosLiberados` e devolve `documentosAguardando: tenant.documentosLiberados ? await contarAguardandoAssinatura(tx) : null` (na mesma transação). `src/app/painel/page.tsx` mostra, quando `documentosAguardando` > 0:

```tsx
        <Cartao id="documentos-aguardando" titulo="Documentos aguardando assinatura" data-guia="documentos-aguardando">
          <p>{documentosAguardando === 1 ? '1 documento aguardando assinatura' : `${documentosAguardando} documentos aguardando assinatura`}</p>
          <p className="text-sm text-suave">Abra o prontuário do paciente, aba "Documentos", para assinar e enviar.</p>
        </Cartao>
```

`contas.ts`: `listarContas` seleciona `documentos_liberados` (`ContaResumo.documentosLiberados: boolean`) e:

```ts
/** D20 (Plano 10A): o admin libera os documentos assinados do consultório só depois da liberação para uso real. */
export async function definirDocumentosLiberados(db: Db, tenantId: string, liberar: boolean, adminId: string): Promise<void> {
  const r = await db.update(tenants).set({ documentosLiberados: liberar, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!r.length) throw new ContaNaoEncontradaError();
  logger.info({ tenantId, adminId, documentosLiberados: liberar }, 'documentos assinados liberados/bloqueados pelo admin');
}
```

`src/app/admin/actions.ts`:

```ts
export async function definirDocumentosAction(tenantId: string, liberar: boolean): Promise<void> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) return;
  await definirDocumentosLiberados(getDb(), tenantId, liberar, user.id);
  revalidatePath('/admin');
}
```

Na tabela do admin, coluna "Documentos" com um formulário por linha: `<form action={definirDocumentosAction.bind(null, c.tenantId, !c.documentosLiberados)}><ConfirmarBotao mensagem={c.documentosLiberados ? \`Bloquear os documentos assinados de ${c.nomeExibicao}? Só antes do uso real. Bloqueado: o consultório perde a aba Documentos (inclusive Cancelar documento e Entregue pessoalmente), os pacientes deixam de ver e abrir os documentos no app e pelo link do e-mail (nenhum código é enviado), e a verificação pública pelo código continua funcionando.\` : \`Liberar os documentos assinados para ${c.nomeExibicao}? Confira antes a resposta do CRN-3, o termo e o backup.\`}>{c.documentosLiberados ? 'Bloquear' : 'Liberar'}<span className="sr-only">{\` os documentos de ${c.nomeExibicao}\`}</span></ConfirmarBotao></form>`.

- [ ] **Step 8: Guia `documentos`** (antes do `prontuario` em `GUIAS`)

```ts
  {
    id: 'documentos',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}/documentos(/.*)?$`),
    titulo: 'Documentos e receita',
    ajuda: {
      resumo: 'Receitas de suplementos e fitoterápicos com os campos que o CFN exige, assinadas por você à mão (digitalizada) e entregues ao paciente com código de verificação.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Clique em "Nova receita", adicione os itens e escreva a justificativa de uso (ela fica no prontuário e não vai na receita). Clique em "Salvar rascunho".',
            'Clique em "Preparar para assinatura" e confirme a declaração. Em alguns segundos o PDF fica pronto.',
            'Clique em "Baixar PDF para assinar", imprima, assine à mão e envie as fotos das páginas em "Enviar documento digitalizado (assinado à mão)", com o código da verificação em duas etapas.',
            'Assinado, o documento vai para o app do paciente; quem não tem o app recebe um link por e-mail. Na consulta presencial, use "Entregue pessoalmente".',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Para assinar, a verificação em duas etapas precisa estar ativa (Segurança).',
            'Depois de assinado, o documento não muda. Errou? Use "Cancelar documento" e faça uma receita nova.',
            'Qualquer pessoa com o código de verificação (o paciente, uma farmácia) confere a autenticidade sem ver o conteúdo.',
            '"Fitoterápico (forma farmacêutica ou fórmula magistral)" só aparece com a habilitação registrada em Configurações.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'nova-receita', titulo: 'Nova receita', texto: 'Comece aqui. A receita nasce como rascunho e só o paciente certo a recebe depois de assinada.' },
      { alvo: 'editor-receita', titulo: 'Itens e justificativa', texto: 'Cada tipo de item pede os campos da resolução do CFN. A justificativa de uso fica só no prontuário.' },
      { alvo: 'preparar-documento', titulo: 'Preparar para assinatura', texto: 'A declaração confirma a sua responsabilidade. O PDF sai com a sua marca, o código de verificação e o QR code.' },
      { alvo: 'assinar-documento', titulo: 'Assinar e enviar', texto: 'Baixe o PDF, imprima, assine à mão e envie as fotos das páginas com o código da verificação em duas etapas. O sistema monta um PDF novo com o código e o QR.' },
    ],
  },
```

> O Plano 10B (T5) devolve ao guia o gov.br e o certificado (resumo, passo a passo e o passo "Assinar e enviar") e sobe a `versao`. As frases entre aspas citam rótulos de telas das Tarefas 9, 10 e 15 ("Enviar documento digitalizado (assinado à mão)", "Entregue pessoalmente", "Cancelar documento"): até elas existirem, a guarda "todo nome citado existe numa tela" falha. Escrever o guia com essas três frases **sem aspas** aqui e pôr as aspas de volta na Tarefa 16 (fechamento do manual).

- [ ] **Step 9: Rotas do axe e o id no E2E**

`e2e/painel-rotas.ts`: `IdsDoPainel` ganha `documento: string`; `ROTAS_DO_PAINEL` ganha:

```ts
  '/painel/pacientes/[id]/documentos': (i) => `/painel/pacientes/${i.paciente}/documentos`,
  '/painel/pacientes/[id]/documentos/[docId]': (i) => `/painel/pacientes/${i.paciente}/documentos/${i.documento}`,
```

`e2e/painel.ts` (`prepararTelasComId`), antes do `return`:

```ts
  // receita (Plano 10A): o consultório do E2E tem os documentos liberados no seed (D20)
  await nutri.goto(`${p}/documentos`);
  await nutri.getByRole('button', { name: 'Nova receita' }).click();
  await expect(nutri).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  const documento = idDaUrl(nutri, new RegExp(`/documentos/(${UUID})$`));
```

e `documento` no objeto devolvido. `scripts/e2e-seed.ts`: o consultório da nutricionista do E2E com `documentosLiberados: true`, `crn`, `nomeProfissional`, `contatoEmail`, `contatoTelefoneE164` preenchidos.

- [ ] **Step 10: Rodar e commit**

Run: `pnpm test src/modules/ajuda src/app/painel src/app/admin src/modules/agenda/inicio.test.ts src/modules/documentos/documentos.test.ts && pnpm typecheck && pnpm lint` → PASS.

```bash
git add src/app/painel/pacientes/[id] src/app/painel/page.tsx src/modules/agenda/inicio.ts src/modules/plataforma/contas.ts src/app/admin src/modules/documentos/{documentos,documentos.test}.ts src/modules/ajuda e2e/painel-rotas.ts e2e/painel.ts scripts/e2e-seed.ts
git commit -m "feat(documentos): aba Documentos, editor da receita, preparo, cartão do Início, liberação pelo admin e guia (US-142, US-143, P-B8, D18, D20)"
```

---
### Task 7: PDF preparado no worker — marca, carimbo, quadro "Assinatura digital", código e QR (US-143, RN-142, RN-143, RNF-143, D15; P10A-07; antiga T8)

> O campo de assinatura pré-criado e a conferência da premissa do leitor de PDF (uma revisão, sem `/ObjStm`) vêm com o leitor no **Plano 10B, Tarefa 1**. O PDF preparado aqui já é o definitivo: o quadro "Assinatura digital" e as colunas `base_pdf_bytes`/`area_assinatura` nascem no 10A (D22).

**Files:**
- Create: `src/modules/documentos/documento-pdf.tsx`, `src/modules/documentos/documento-pdf-job.ts`, `src/modules/documentos/documento-pdf-job.test.ts`, `src/app/api/painel/documentos/[id]/pdf/route.ts` (+ `route.test.ts`)
- Modify: `src/worker/index.ts`, `src/modules/documentos/documentos.ts` (`caminhoDoPdfNoPainel`), `src/modules/pacientes/exportacao.test.ts` (guarda de grafo)

**Interfaces:**
- Consumes: `signedDocuments` (T1); `lerDocumentoNaTransacao`, `ConteudoReceita`, `descreverItem`, `formatarCodigo`, `soltarArquivosDoPreparo` (T5); `AREA_ASSINATURA`, `EMITIDOS` (T1); `codigoAleatorio` (`test/documentos.ts`, T1); `salvarArquivo`, `apagarArquivo`, `resolverCaminho`, `CotaEsgotadaError`; `buscarTenant`, `tenantIsActive`, `listarTenantsParaVarredura`; `paraWinAnsi`; `QRCode` (`qrcode`); `urlDoApp`.
- Produces:
  - `renderizarDocumento(d: DadosPdfDocumento): Promise<Buffer>`; `DadosPdfDocumento = { conteudo: ConteudoReceita; codigo: string; urlVerificacao: string; data: string; cor: string; logo: Buffer | null; nomeConsultorio: string }`.
  - `gerarPdfDoDocumento(data: { tenantId: string; documentoId: string }, deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDocumento }): Promise<'pronto' | 'ignorado' | 'falhou'>`.
  - `expirarPdfsDeDocumentoPendentes(db: Db, now: Date, o?: { tenantId?: string }): Promise<number>` (também a digitalização `recebendo`/`pendente` com `digitalizacao_em` de mais de 1 h → `falhou`, D24); `limparArquivosOrfaosDeDocumentos(db: Db, now: Date, dataDir: string, o?: { tenantId?: string }): Promise<number>` (também o que a assinatura deixou apontado, por `soltarArquivosDoPreparo`). `o.tenantId` restringe a varredura a um tenant — só os testes passam (o banco de teste é compartilhado: uma varredura de todos os tenants mexeria nos documentos de outros testes).
  - `gerarPdfDoDocumento` amarra o `registrar` e o `marcarFalhou` à versão lida (`codigo`): o job de uma versão descartada por "Voltar a editar" + novo preparo não grava o base nem marca "falhou" na versão nova.
  - `caminhoDoPdfNoPainel(ctx, docId, qual: 'base' | 'assinado', db?): Promise<string | null>` (com `auditRead`).
  - Rota `GET /api/painel/documentos/[id]/pdf` (`?estado=1` → JSON sem auditoria; `?base=1` → 303 para o PDF preparado; sem parâmetro → 303 para o assinado).

- [ ] **Step 1: Teste do job (falha)** — `src/modules/documentos/documento-pdf-job.test.ts`

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { codigoAleatorio } from '../../../test/documentos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { AREA_ASSINATURA } from './constantes';
import { renderizarDocumento, type DadosPdfDocumento } from './documento-pdf';
import { expirarPdfsDeDocumentoPendentes, gerarPdfDoDocumento, limparArquivosOrfaosDeDocumentos } from './documento-pdf-job';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const conteudo = {
  versao: 1, tipo: 'receita', orientacoes: 'Tomar com água.',
  itens: [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia', duracao: '', manipulado: false }],
  copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'debby@consultorio.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana Souza' } },
};

/** O código é UNIQUE no banco inteiro: cada documento do teste ganha um aleatório (um fixo colidiria no 2º emPreparo). */
async function emPreparo() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const id = randomUUID();
  const codigo = codigoAleatorio();
  await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em)
    values (${id}, ${T.tenantId}, ${p.id}, 'preparando', ${codigo}, ${JSON.stringify(conteudo)}::jsonb, now(), 'pendente', now())`), app.db);
  return { T, p, id, codigo };
}

/** "Voltar a editar" + novo preparo noutra aba, direto no banco (o caminho que o gatilho aceita): outro código, PDF pendente. */
const novoPreparo = (T: Awaited<ReturnType<typeof emPreparo>>['T'], id: string) =>
  withTenant(T.ctx, async (tx) => {
    await tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, pdf_status = null, pdf_pedido_em = null where id = ${id}`);
    await tx.execute(sql`update signed_documents set status = 'preparando', codigo = ${codigoAleatorio()}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${id}`);
  }, app.db);

describe('PDF preparado (US-143)', () => {
  it('gera o PDF com o código, o QR e o quadro; grava SHA-256, bytes e área; leva a "Aguardando assinatura"', async () => {
    const { T, id, codigo } = await emPreparo();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    let recebido: DadosPdfDocumento | undefined;
    const r = await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, {
      db: app.db, dataDir, appUrl: 'https://nutri.exemplo.com', ultimaTentativa: false,
      renderizar: async (d) => ((recebido = d), renderizarDocumento(d)),
    });
    expect(r).toBe('pronto');
    expect(recebido).toMatchObject({ codigo, urlVerificacao: `https://nutri.exemplo.com/v/${codigo}` });
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status, base_pdf_path, base_pdf_sha256, base_pdf_bytes, area_assinatura from signed_documents where id = ${id}`), app.db)).rows as Record<string, unknown>[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', pdf_status: 'pronto', area_assinatura: AREA_ASSINATURA });
    const arquivo = await readFile(path.join(dataDir, String(d.base_pdf_path)));
    expect(createHash('sha256').update(arquivo).digest('hex')).toBe(d.base_pdf_sha256);
    expect(arquivo.length).toBe(d.base_pdf_bytes);
    // a premissa do leitor (uma revisão, xref clássica, nenhum /ObjStm) é conferida no Plano 10B, Tarefa 1, com o leitor de PDF
    expect(arquivo.toString('latin1').match(/%%EOF/g)).toHaveLength(1);
  });

  it('RNF-143: cota esgotada → "sem_cota" (a tela mostra "Espaço de armazenamento esgotado…"), sem nova tentativa', async () => {
    const { T, id } = await emPreparo();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('falhou');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d).toEqual({ status: 'preparando', pdf_status: 'sem_cota' });
  });

  it('idempotente; paciente bloqueado → falhou; tenant suspenso → ignorado e falhou', async () => {
    const { T, p, id } = await emPreparo();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('ignorado');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d.pdf_status).toBe('falhou');
    const outro = await emPreparo();
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, outro.T.tenantId));
    expect(await gerarPdfDoDocumento({ tenantId: outro.T.tenantId, documentoId: outro.id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('ignorado');
  });

  it('versão lida: "Voltar a editar" + novo preparo no meio → o job velho não grava o base na versão nova nem a marca como "falhou"', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    const estado = async (T: Awaited<ReturnType<typeof emPreparo>>['T'], id: string) =>
      (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status, codigo, base_pdf_path from signed_documents where id = ${id}`), app.db)).rows[0] as Record<string, unknown>;
    const a = await emPreparo();
    expect(await gerarPdfDoDocumento({ tenantId: a.T.tenantId, documentoId: a.id }, {
      db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false,
      renderizar: async (d) => (await novoPreparo(a.T, a.id), renderizarDocumento(d)), // o PDF sai com o código VELHO
    })).toBe('ignorado');
    const da = await estado(a.T, a.id);
    expect(da).toMatchObject({ status: 'preparando', pdf_status: 'pendente', base_pdf_path: null });
    expect(da.codigo).not.toBe(a.codigo);
    const bases = await withTenant(a.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where tipo = 'documento_base'`), app.db);
    expect(bases.rows).toEqual([]); // o salvarArquivo desfez a reserva e o arquivo
    // a última tentativa do job velho falha DEPOIS do novo preparo: o marcarFalhou não casa com a versão nova
    const b = await emPreparo();
    expect(await gerarPdfDoDocumento({ tenantId: b.T.tenantId, documentoId: b.id }, {
      db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: true,
      renderizar: async () => {
        await novoPreparo(b.T, b.id);
        throw new Error('falha de render');
      },
    })).toBe('falhou');
    expect(await estado(b.T, b.id)).toMatchObject({ status: 'preparando', pdf_status: 'pendente' });
  });

  it('expira o pendente esquecido (> 1 h) e apaga PDF base sem referência (> 1 h) — varredura só no tenant do teste', async () => {
    const { T, p, id } = await emPreparo();
    const agora = new Date(Date.now() + 2 * 3600_000);
    // { tenantId }: o banco de teste é compartilhado — varrer todos os tenants com o relógio + 2 h mexeria nos outros testes
    expect(await expirarPdfsDeDocumentoPendentes(app.db, agora, { tenantId: T.tenantId })).toBe(1);
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d.pdf_status).toBe('falhou');
    const orfao = `${T.tenantId}/documento_base/${randomUUID()}.pdf`;
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id, created_at) values (${T.tenantId}, 'documento_base', ${orfao}, 10, 'application/pdf', ${p.id}, now() - interval '2 hours')`), app.db);
    expect(await limparArquivosOrfaosDeDocumentos(app.db, new Date(), '/tmp', { tenantId: T.tenantId })).toBe(1);
    const sobrou = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${orfao}`), app.db);
    expect(sobrou.rows).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/documentos/documento-pdf-job.test.ts` → FAIL.

- [ ] **Step 2: O PDF** — `src/modules/documentos/documento-pdf.tsx`

```tsx
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { paraWinAnsi as w } from '@/modules/pacientes/prontuario-pdf';
import { formatarCodigo } from './codigo';
import { AREA_ASSINATURA as A } from './constantes';
import { descreverItem, type ConteudoReceita } from './prescricao';

/** Só o worker importa este arquivo (guarda de grafo em exportacao.test.ts). */
export type DadosPdfDocumento = { conteudo: ConteudoReceita; codigo: string; urlVerificacao: string; data: string; cor: string; logo: Buffer | null; nomeConsultorio: string };

const ALTURA_RODAPE = 150; // o quadro (y1 62 → y2 132) + a faixa do código; o conteúdo nunca passa por baixo
const s = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: ALTURA_RODAPE, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  item: { marginTop: 8 },
  itemTitulo: { fontFamily: 'Helvetica-Bold' },
  carimbo: { marginTop: 18, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#999999' },
  quadro: { position: 'absolute', left: A.x1, bottom: A.y1, width: A.x2 - A.x1, height: A.y2 - A.y1, borderWidth: 1, borderColor: '#999999', borderStyle: 'dashed' },
  rodape: { position: 'absolute', left: 36, right: 36, bottom: 16, flexDirection: 'row', alignItems: 'center' },
});

function Receita({ d, qr }: { d: DadosPdfDocumento; qr: Buffer }) {
  const c = d.conteudo;
  const p = c.copia!.profissional;
  const carimbo = [p.nomeCompleto, 'Nutricionista', p.crn, p.email, p.telefone].join(' · ');
  return (
    <Document title="Receita" author={p.nomeCompleto} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{w(d.nomeConsultorio)}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>Receita</Text>
        <Text>{w(`Paciente: ${c.copia!.paciente.nome}`)}</Text>
        <Text>{`Data de emissão: ${d.data}`}</Text>
        {c.itens.map((it, i) => {
          const x = descreverItem(it);
          return (
            <View key={i} style={s.item} wrap={false}>
              <Text style={s.itemTitulo}>{w(`${i + 1}. ${x.titulo}`)}</Text>
              {x.linhas.map((l) => <Text key={l}>{w(l)}</Text>)}
            </View>
          );
        })}
        {c.orientacoes ? <Text style={{ marginTop: 12 }}>{w(`Orientações gerais: ${c.orientacoes}`)}</Text> : null}
        <View style={s.carimbo} wrap={false}>
          <Text>{w(carimbo)}</Text>
          {p.endereco ? <Text>{w(p.endereco)}</Text> : null}
        </View>
        {/* D15 / RN-144 (6): o quadro em branco, em TODA página, na posição gravada em area_assinatura */}
        <View fixed style={s.quadro}>
          <Text style={{ fontSize: 8, color: '#666666', margin: 4 }}>Assinatura digital</Text>
        </View>
        <View fixed style={s.rodape}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          <Image src={{ data: qr, format: 'png' }} style={{ width: 40, height: 40, marginRight: 8 }} />
          <Text style={{ fontSize: 8, flex: 1 }}>{`Código de verificação: ${formatarCodigo(d.codigo)} · Verifique em ${d.urlVerificacao}`}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderizarDocumento(d: DadosPdfDocumento): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.urlVerificacao, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return renderToBuffer(<Receita d={d} qr={qr} />);
}
```

- [ ] **Step 3: O job** — `src/modules/documentos/documento-pdf-job.ts`

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { patients, signedDocuments, storedFiles } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { apagarArquivo, CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { buscarTenant, listarTenantsParaVarredura, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { AREA_ASSINATURA, EMITIDOS } from './constantes';
import { renderizarDocumento } from './documento-pdf';
import type { ConteudoReceita } from './prescricao';

/** Só o worker importa este arquivo. */
export type DepsJobDocumento = { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDocumento };
class JaProntoError extends Error {}
class TitularComExclusaoError extends Error {}

/**
 * US-143: lê o documento em preparo (a cópia congelada, RN-154), gera o PDF com a marca, o carimbo, o quadro "Assinatura
 * digital" e o código/QR (RN-142), e grava o base (SHA-256 e bytes: o prefixo da RN-144 (2)) no `registrar` do
 * salvarArquivo, levando a "Aguardando assinatura". Idempotente (só com pdf_status pendente). Ordem: paciente → tenant → documento.
 * Versão lida (correção do /code-review high do PR #18): o `registrar` e o `marcarFalhou` casam id + "preparando" +
 * "pendente" + o CÓDIGO lido — "Voltar a editar" + novo preparo noutra aba troca o código, e o job velho (o PDF com o
 * código e o conteúdo antigos) não grava o base na versão nova nem a marca como "falhou".
 */
export async function gerarPdfDoDocumento(data: { tenantId: string; documentoId: string }, deps: DepsJobDocumento): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const lido = await withTenant(ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente')));
    return d ?? null;
  }, db);
  if (!lido || !lido.codigo) return 'ignorado';
  const daVersao = and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente'), eq(signedDocuments.codigo, lido.codigo));
  const marcarFalhou = (pdfStatus: 'falhou' | 'sem_cota' = 'falhou') =>
    withTenant(ctx, (tx) => tx.update(signedDocuments).set({ pdfStatus, updatedAt: now }).where(daVersao), db);
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorado';
  }
  try {
    const tenant = (await buscarTenant(db, data.tenantId))!;
    const logo = tenant.logoPath ? await readFile(resolverCaminho(deps.dataDir, tenant.logoPath)).catch(() => null) : null;
    // o Plano 10B (T1) acrescenta aqui o campo pré-criado, se o relatório do spike pedir
    const pdf = await (deps.renderizar ?? renderizarDocumento)({
      conteudo: lido.conteudo as ConteudoReceita,
      codigo: lido.codigo,
      urlVerificacao: urlDoApp(deps.appUrl, `/v/${lido.codigo}`),
      data: formatarData(hojeNoFuso(tenant.fuso, lido.declaracaoEm ?? now)),
      cor: tenant.corPrimaria ?? COR_PADRAO,
      logo,
      nomeConsultorio: tenant.nomeExibicao,
    });
    const sha = createHash('sha256').update(pdf).digest('hex');
    await salvarArquivo(
      ctx,
      {
        tipo: 'documento_base',
        conteudo: pdf,
        permitidos: ['pdf'],
        patientId: lido.patientId,
        antesDaReserva: async (tx) => {
          const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, lido.patientId)).for('update');
          if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new TitularComExclusaoError();
        },
        registrar: async (tx, arq) => {
          const r = await tx
            .update(signedDocuments)
            .set({ status: 'aguardando_assinatura', pdfStatus: 'pronto', basePdfPath: arq.caminho, basePdfSha256: sha, basePdfBytes: pdf.length, areaAssinatura: AREA_ASSINATURA })
            .where(daVersao)
            .returning({ id: signedDocuments.id });
          if (!r.length) throw new JaProntoError(); // já pronto, ou outra versão (outro código) no meio
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return 'pronto';
  } catch (e) {
    if (e instanceof JaProntoError) return 'ignorado';
    if (e instanceof TitularComExclusaoError) {
      await marcarFalhou();
      return 'ignorado';
    }
    if (e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      logger.warn({ documentoId: data.documentoId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : 'erro' }, 'PDF do documento não gerado');
      await marcarFalhou(e instanceof CotaEsgotadaError ? 'sem_cota' : 'falhou'); // RNF-143: a tela mostra a mensagem da cota
      return 'falhou';
    }
    throw e;
  }
}

export const PDF_DOCUMENTO_PENDENTE_MAX_MS = 3600_000;

/** `o.tenantId`: só os testes (banco compartilhado: varrer todos os tenants com o relógio adiantado mexeria nos documentos de outros testes). */
const tenantsDaVarredura = async (db: Db, o: { tenantId?: string }) => (o.tenantId ? [{ id: o.tenantId }] : await listarTenantsParaVarredura(db));

/**
 * Rede de segurança do "Preparando o PDF…" (como expirarPdfsPendentes do plano) e da digitalização (D24, Minor da revisão
 * de cobertura): "recebendo" ou "pendente" com mais de 1 h viram "falhou" (a tela oferece enviar as fotos de novo; o
 * job atrasado que chegar depois não casa mais). Um tenant com erro não para os outros.
 */
export async function expirarPdfsDeDocumentoPendentes(db: Db, now: Date, o: { tenantId?: string } = {}): Promise<number> {
  const limite = new Date(now.getTime() - PDF_DOCUMENTO_PENDENTE_MAX_MS);
  let n = 0;
  for (const t of await tenantsDaVarredura(db, o)) {
    try {
      const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) =>
        tx.update(signedDocuments).set({ pdfStatus: 'falhou', updatedAt: now })
          .where(and(eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente'), lt(sql`coalesce(${signedDocuments.pdfPedidoEm}, ${signedDocuments.updatedAt})`, limite)))
          .returning({ id: signedDocuments.id }), db);
      const dig = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) =>
        tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou', updatedAt: now })
          .where(and(eq(signedDocuments.status, 'aguardando_assinatura'), inArray(signedDocuments.digitalizacaoStatus, ['recebendo', 'pendente']), lt(sql`coalesce(${signedDocuments.digitalizacaoEm}, ${signedDocuments.updatedAt})`, limite)))
          .returning({ id: signedDocuments.id }), db);
      n += r.length + dig.length;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao expirar PDFs de documento pendentes');
    }
  }
  return n;
}

/**
 * RN-140 (b) e RN-157: (1) o PDF base e as fotos da digitalizada sem documento que aponte para eles, com mais de 1 h, saem
 * do disco e da cota (a referência é conferida de novo no naMesmaTransacao); (2) regra 9: o que a assinatura deixou
 * apontado num documento emitido (o soltarArquivosDoPreparo logo depois dela falhou) sai pelo mesmo soltarArquivosDoPreparo.
 */
export async function limparArquivosOrfaosDeDocumentos(db: Db, now: Date, dataDir: string, o: { tenantId?: string } = {}): Promise<number> {
  const limite = new Date(now.getTime() - PDF_DOCUMENTO_PENDENTE_MAX_MS);
  let n = 0;
  for (const t of await tenantsDaVarredura(db, o)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    const semReferencia = sql`not exists (select 1 from signed_documents d where d.tenant_id = ${storedFiles.tenantId} and (d.base_pdf_path = ${storedFiles.caminho} or d.digitalizacao ? ${storedFiles.caminho}))`;
    try {
      const orfaos = await withTenant(ctx, (tx) =>
        tx.select({ caminho: storedFiles.caminho }).from(storedFiles)
          .where(and(inArray(storedFiles.tipo, ['documento_base', 'documento_digitalizado']), lt(storedFiles.createdAt, limite), semReferencia)), db);
      for (const o of orfaos) {
        const ok = await apagarArquivo(ctx, { caminho: o.caminho }, {
          db, dataDir,
          naMesmaTransacao: async (tx) => (await tx.select({ c: storedFiles.caminho }).from(storedFiles).where(and(eq(storedFiles.caminho, o.caminho), semReferencia))).length > 0,
        });
        if (ok) n++;
      }
      const sobras = await withTenant(ctx, (tx) =>
        tx.select({ id: signedDocuments.id }).from(signedDocuments)
          .where(and(inArray(signedDocuments.status, [...EMITIDOS]), or(isNotNull(signedDocuments.basePdfPath), isNotNull(signedDocuments.digitalizacao)))), db);
      for (const s of sobras) n += await soltarArquivosDoPreparo(ctx, s.id, EMITIDOS, { db, dataDir });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao limpar arquivos órfãos de documentos');
    }
  }
  return n;
}
```

Run: `pnpm test src/modules/documentos/documento-pdf-job.test.ts` → PASS.

- [ ] **Step 4: Worker** — `src/worker/index.ts`

```ts
import { expirarPdfsDeDocumentoPendentes, gerarPdfDoDocumento, limparArquivosOrfaosDeDocumentos } from '@/modules/documentos/documento-pdf-job';
// …
  // Plano 10A (US-143): PDF preparado da receita; a cada 15 min, pendente esquecido (PDF ou digitalização) → falhou e PDF base/fotos órfãos apagados
  await work('documento-pdf', { includeMetadata: true }, async ([job]: JobWithMetadata<{ tenantId: string; documentoId: string }>[]) => {
    await gerarPdfDoDocumento(job.data, { db: getDb(), dataDir: env.DATA_DIR, appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
  await boss.schedule('expirar-documento-pdf', '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('expirar-documento-pdf', async () => {
    await expirarPdfsDeDocumentoPendentes(getDb(), new Date());
    await limparArquivosOrfaosDeDocumentos(getDb(), new Date(), env.DATA_DIR);
  });
```

- [ ] **Step 5: Rota do PDF no painel** — `caminhoDoPdfNoPainel` em `documentos.ts` e `src/app/api/painel/documentos/[id]/pdf/route.ts`

```ts
// documentos.ts
/** RNF-142: devolver o PDF de um documento é leitura de dado de saúde — auditRead na transação que lê o caminho. */
export async function caminhoDoPdfNoPainel(ctx: TenantContext, docId: string, qual: 'base' | 'assinado', db: Db = getDb()): Promise<string | null> {
  if (!idValido(docId)) return null;
  return withTenant(ctx, async (tx) => {
    const [d] = await tx.select({ patientId: signedDocuments.patientId, status: signedDocuments.status, base: signedDocuments.basePdfPath, pdf: signedDocuments.pdfPath }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    const caminho = !d ? null : qual === 'base' ? (d.status === 'aguardando_assinatura' ? d.base : null) : d.pdf;
    if (!caminho || !d) return null;
    await auditRead(tx, { entidade: 'documentos', entidadeId: docId, patientId: d.patientId });
    return caminho;
  }, db);
}
```

```ts
// src/app/api/painel/documentos/[id]/pdf/route.ts
import { requireApiNutri } from '@/lib/tenant-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdfNoPainel, estadoDoDocumento } from '@/modules/documentos/documentos';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-143/144: `?estado=1` → JSON para o "Preparando o PDF…" (sem auditoria); `?base=1` → o PDF preparado; sem nada → o assinado. A URL assinada nasce no clique (303). */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/documentos/[id]/pdf'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return new Response(null, { status: 404 });
  const { id } = await params;
  const url = new URL(req.url);
  if (url.searchParams.get('estado') === '1') {
    const e = await estadoDoDocumento(acesso.ctx, id);
    return e ? Response.json(e, { headers: SEM_CACHE }) : new Response(null, { status: 404, headers: SEM_CACHE });
  }
  const caminho = await caminhoDoPdfNoPainel(acesso.ctx, id, url.searchParams.get('base') === '1' ? 'base' : 'assinado');
  if (!caminho) return new Response(null, { status: 404, headers: SEM_CACHE });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), ...SEM_CACHE } });
}
```

Teste da rota (`route.test.ts`, padrão do `exames/route.test.ts`): sem sessão → 401; consultório sem `documentosLiberados` → 404; `?estado=1` devolve `{ status: 'preparando', pdfStatus: 'pendente' }` sem linha nova em `audit_log`; `?base=1` num documento "Aguardando assinatura" → 303 para `/api/arquivos?…` e uma linha "ler" de `documentos`; documento de outro consultório → 404.

- [ ] **Step 6: Guarda de grafo** — em `src/modules/pacientes/exportacao.test.ts`, a lista de proibidos ganha `'src/modules/documentos/documento-pdf.tsx'`, `'src/modules/documentos/documento-pdf-job.ts'` e `'src/modules/documentos/digitalizada-job.ts'` (o último nasce na T9; antes dela a conferência passa por não existir).

Run: `pnpm test src/modules/documentos src/app/api/painel/documentos src/modules/pacientes/exportacao.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/documentos/{documento-pdf.tsx,documento-pdf-job.ts,documento-pdf-job.test.ts,documentos.ts} src/app/api/painel/documentos src/worker/index.ts src/modules/pacientes/exportacao.test.ts
git commit -m "feat(documentos): PDF preparado no worker com carimbo, quadro de assinatura, código e QR (US-143)"
```

---
### Task 8: Assinatura no banco — `registrarAssinatura` (versão lida, verificação pública; base e fotos soltos depois, um a um) sem dependência de sessão (RN-140 b, RN-143, RN-156 parte de escrita; P10A-08; parte comum da antiga T10)

> Da antiga Tarefa 10 (envio do PDF assinado), ficou aqui tudo o que é **comum às duas formas de assinar**: a ida a "assinado" amarrada à versão lida (o base e as fotos continuam apontados e saem depois, cada um no seu `apagarArquivo`, por `soltarArquivosDoPreparo` — regra 9, desvio da RN-140 (b) registrado), a linha da verificação pública, a conferência da habilitação no momento de assinar e os ajudantes de teste. A entrega (portal, link, `entregue_em`) entra no fim de `registrarAssinatura` na T10; a auditoria das escritas é do gatilho (`app_enable_audit`, T1) e a da tentativa com código recusado é da T9. O que é do certificado (upload do PDF assinado, conferência, primeiro certificado com 2FA, CPF e troca do CPF do consultório, liberação de cada assinador pelo spike) está no **Plano 10B, Tarefas 3 e 5**.
>
> **Minor da revisão de cobertura aplicado (D23):** `registrarAssinatura` mora em `registrar-assinatura.ts`, que não importa nada de sessão (`@/lib/auth`, `confirmar-2fa`, `next/*`), nem pelos imports dos imports (`grafoDeImports` de `test/grafo-de-imports.ts`, o mesmo da guarda de `exportacao.test.ts`). No plano único ela ficava no arquivo do envio do PDF assinado, e o `digitalizada-job.ts` (worker) puxava o Better Auth com `nextCookies` para dentro do worker.

**Files:**
- Create: `src/modules/documentos/registrar-assinatura.ts` (+ `registrar-assinatura.test.ts`), `src/modules/documentos/verificacao.ts` (+ `verificacao.test.ts`)
- Modify: `test/documentos.ts` (`novoConsultorio`, `outroDocumento`, `novoPreparoNoBanco`, `pdfDeTeste`)

**Interfaces:**
- Consumes: `signedDocuments`, `documentVerifications`, `storedFiles` (T1); `TransicaoInvalidaError`, `RecusaAssinaturaError` (T1); `CopiaProfissional` (T3); `ConteudoReceita` (T5); `salvarArquivo` (`armazenamento.ts`, nos testes); `AREA_ASSINATURA` (T1).
- Produces:
  - `verificacao.ts` (ÚNICO acesso a `document_verifications`): `NovaVerificacao`, `registrarVerificacao(tx: Tx, v: NovaVerificacao): Promise<void>`, `mudarSituacao(tx: Tx, documentoId: string, situacao: SituacaoVerificacao, em: Date): Promise<void>`; a T13 acrescenta a leitura pública.
  - `registrar-assinatura.ts`:
    - `type AcessoAssinatura = { ctx: TenantContext; tenant: TenantRow; user: { id: string; email: string; twoFactorEnabled: boolean | null } }`
    - `type DepsAssinar = { headers: Headers; db?: Db; dataDir?: string; agora?: Date; appUrl?: string; confirmar2fa?: (e: { userId: string; codigo: unknown; headers: Headers }) => Promise<'ok' | 'invalido' | 'bloqueado'> }` (o Plano 10B estende com as dependências da conferência)
    - `type VersaoLida = { codigo: string } & ({ baseSha256: string } | { digitalizacaoPendente: true })` (a digitalizada usa a 2ª; o envio do PDF assinado do 10B, a 1ª)
    - `type AssinaturaAceita = { documentoId; codigo; patientId; tenantId; caminho; sha256; tipo: TipoAssinatura; emissor: string | null; assinanteNome: string | null; userId; agora: Date; copia: CopiaProfissional; base: string | null; versao: VersaoLida }` (a T10 acrescenta `appUrl: string`)
    - `registrarAssinatura(tx: Tx, a: AssinaturaAceita): Promise<void>` — lança `TransicaoInvalidaError` se a versão lida não é mais a do banco
    - `exigirHabilitacaoAtual(tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, conteudo: ConteudoReceita): void` — lança `RecusaAssinaturaError('sem_habilitacao')` (Minor 9 da revisão de segurança)
  - `test/documentos.ts`: `pdfDeTeste(texto?: string): Buffer`, `novoConsultorio(db)`, `type Consultorio`, `outroDocumento(c, db, o?: { base?: Buffer; conteudo?: object })`, `novoPreparoNoBanco(x, db)`, `liberarDocumentos(db, tenantId)` (D20 ligado — os testes do portal e do link, T11, T12 e T15, que usam `novoTenant`).

- [ ] **Step 1: Ajudantes de teste** — acrescentar a `test/documentos.ts`

```ts
// imports a mais em test/documentos.ts: createHash (node:crypto); mkdir, mkdtemp, writeFile (node:fs/promises); tmpdir (node:os);
// path (node:path); eq (drizzle-orm); tenants, type TenantRow (@/db/schema); novoPaciente, novoTenant (./pacientes);
// AREA_ASSINATURA (@/modules/documentos/constantes)

/**
 * Um PDF mínimo válido pelo conteúdo (detectarTipo vê "%PDF-"). No Plano 10A ele faz o papel do PDF preparado e do PDF
 * assinado; o Plano 10B passa o PDF base dos testes dele em `outroDocumento(…, { base })`.
 */
export function pdfDeTeste(texto = 'base de teste'): Buffer {
  return Buffer.from(`%PDF-1.3\n% ${texto}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/** D20: liga o interruptor do admin (o `novoTenant` nasce com `documentos_liberados = false`, como em produção). */
export const liberarDocumentos = (db: Db, tenantId: string) => db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, tenantId));

/** Consultório completo (perfil e documentos liberados) e a pasta de dados do teste. */
export async function novoConsultorio(db: Db) {
  const T = await novoTenant(db);
  await db.update(tenants).set({ crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'd@x.com', contatoTelefoneE164: '+5511912345678', documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'assinar-'));
  const acesso = { ctx: T.ctx, tenant: tenant as TenantRow, user: { id: T.nutriId, email: 'd@x.com', twoFactorEnabled: true } };
  return { T, dataDir, acesso };
}
export type Consultorio = Awaited<ReturnType<typeof novoConsultorio>>;

const CROCKFORD_TESTE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const COPIA_TESTE = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };

/** Um documento em "Aguardando assinatura" com o base no disco (como depois da T7), num paciente novo do consultório. */
export async function outroDocumento(c: Consultorio, db: Db, o: { base?: Buffer; conteudo?: Record<string, unknown> } = {}) {
  const BASE_DOC = o.base ?? pdfDeTeste();
  const p = await novoPaciente(db, c.T.ctx);
  const base = `${c.T.tenantId}/documento_base/${randomUUID()}.pdf`;
  await mkdir(path.join(c.dataDir, path.dirname(base)), { recursive: true });
  await writeFile(path.join(c.dataDir, base), BASE_DOC);
  const id = randomUUID();
  const conteudo = o.conteudo ?? { versao: 1, tipo: 'receita', itens: [], orientacoes: '', copia: { profissional: COPIA_TESTE, paciente: { nome: 'Ana Souza' } } };
  const codigo = Array.from({ length: 12 }, () => CROCKFORD_TESTE[Math.floor(Math.random() * 32)]).join('');
  await withTenant(c.T.ctx, async (tx) => {
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${c.T.tenantId}, 'documento_base', ${base}, ${BASE_DOC.length}, 'application/pdf', ${p.id})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em) values (${id}, ${c.T.tenantId}, ${p.id}, 'preparando', ${codigo}, ${JSON.stringify(conteudo)}::jsonb, now())`);
  }, db);
  await withTenant({ tenantId: c.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${createHash('sha256').update(BASE_DOC).digest('hex')}, base_pdf_bytes = ${BASE_DOC.length}, area_assinatura = ${JSON.stringify(AREA_ASSINATURA)}::jsonb where id = ${id}`), db);
  return { ...c, p, id, base, codigo, baseSha256: createHash('sha256').update(BASE_DOC).digest('hex') };
}

/**
 * "Voltar a editar" + novo preparo + o worker com OUTRO base, direto no banco (o mesmo caminho que o gatilho aceita):
 * o documento volta a "aguardando_assinatura" com outro código e outro SHA-256. Para o teste da versão lida (T8, T9 e 10B).
 */
export async function novoPreparoNoBanco(x: Awaited<ReturnType<typeof outroDocumento>>, db: Db) {
  const outro = pdfDeTeste(`outra versão ${randomUUID()}`);
  const base = `${x.T.tenantId}/documento_base/${randomUUID()}.pdf`;
  await mkdir(path.join(x.dataDir, path.dirname(base)), { recursive: true });
  await writeFile(path.join(x.dataDir, base), outro);
  const codigo = Array.from({ length: 12 }, () => CROCKFORD_TESTE[Math.floor(Math.random() * 32)]).join('');
  await withTenant(x.T.ctx, async (tx) => {
    await tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, base_pdf_path = null, base_pdf_sha256 = null, base_pdf_bytes = null, area_assinatura = null, digitalizacao = null, digitalizacao_status = null, digitalizacao_em = null where id = ${x.id}`);
    await tx.execute(sql`update signed_documents set status = 'preparando', codigo = ${codigo}, declaracao_em = now() where id = ${x.id}`);
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${x.T.tenantId}, 'documento_base', ${base}, ${outro.length}, 'application/pdf', ${x.p.id})`);
  }, db);
  await withTenant({ tenantId: x.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${createHash('sha256').update(outro).digest('hex')}, base_pdf_bytes = ${outro.length}, area_assinatura = ${JSON.stringify(AREA_ASSINATURA)}::jsonb where id = ${x.id}`), db);
}
```

> O base antigo de `novoPreparoNoBanco` fica sem referência e a varredura da T7 o apaga (como na vida real, o `voltarAEditar` o apagaria).

- [ ] **Step 2: Testes (falham)** — `src/modules/documentos/registrar-assinatura.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento, pdfDeTeste } from '../../../test/documentos';
import { caminhoAte, grafoDeImports } from '../../../test/grafo-de-imports';
import { signedDocuments } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { EMITIDOS } from './constantes';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import { exigirHabilitacaoAtual, registrarAssinatura, type VersaoLida } from './registrar-assinatura';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const COPIA = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };

/** O que a digitalizada (T9) e o envio do 10B fazem: o PDF final por salvarArquivo, com a transição no registrar. */
async function assinarNoBanco(x: Awaited<ReturnType<typeof outroDocumento>>, versao: VersaoLida, agora = new Date()) {
  const pdf = pdfDeTeste('assinado');
  await salvarArquivo(x.T.ctx, {
    tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: x.p.id, substitui: x.base,
    registrar: (tx, arq) => registrarAssinatura(tx, {
      documentoId: x.id, codigo: x.codigo, patientId: x.p.id, tenantId: x.T.tenantId, caminho: arq.caminho, sha256: createHash('sha256').update(pdf).digest('hex'),
      tipo: 'digitalizada', emissor: null, assinanteNome: null, userId: x.T.nutriId, agora, copia: COPIA, base: x.base, versao,
    }),
  }, { db: app.db, dataDir: x.dataDir });
  return pdf;
}

describe('registrarAssinatura (RN-140 b, RN-143, RN-156)', () => {
  it('leva a "assinado" e grava a verificação "valido" com o emissor da cópia, sem "Assinado por"; o base continua apontado até o próprio apagar (regra 9)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const pdf = await assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 });
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_sha256, base_pdf_path, assinatura_tipo, assinante_nome from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'assinado', pdf_sha256: createHash('sha256').update(pdf).digest('hex'), base_pdf_path: x.base, assinatura_tipo: 'digitalizada', assinante_nome: null });
    const v = (await app.db.execute(sql`select situacao, pdf_sha256, emissor_nome, emissor_crn, assinante_nome from document_verifications where codigo = ${x.codigo}`)).rows[0];
    expect(v).toEqual({ situacao: 'valido', pdf_sha256: d.pdf_sha256, emissor_nome: 'Débora Silva Santos', emissor_crn: 'CRN-3 12345', assinante_nome: null });
  });

  it('regra 9: soltarArquivosDoPreparo apaga o base e as fotos do documento emitido, cada um com o ponteiro no naMesmaTransacao do próprio apagar; antes de emitido, nada sai', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const jpeg = await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const foto = await salvarArquivo(x.T.ctx, {
      tipo: 'documento_digitalizado', conteudo: jpeg, permitidos: ['jpg'], patientId: x.p.id,
      registrar: async (tx, arq) => {
        await tx.update(signedDocuments).set({ digitalizacao: [arq.caminho], digitalizacaoStatus: 'pendente', digitalizacaoEm: new Date() }).where(eq(signedDocuments.id, x.id));
      },
    }, { db: app.db, dataDir: x.dataDir });
    const soltar = () => soltarArquivosDoPreparo(x.T.ctx, x.id, EMITIDOS, { db: app.db, dataDir: x.dataDir });
    expect(await soltar()).toBe(0); // ainda "aguardando_assinatura": nada sai
    await assinarNoBanco(x, { codigo: x.codigo, digitalizacaoPendente: true });
    expect(await soltar()).toBe(2);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path, digitalizacao from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'assinado', base_pdf_path: null, digitalizacao: null });
    const sobra = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select tipo from stored_files where caminho in (${x.base}, ${foto.caminho})`), app.db);
    expect(sobra.rows).toEqual([]);
    for (const c of [x.base, foto.caminho]) await expect(access(path.join(x.dataDir, c))).rejects.toThrow();
    expect(await soltar()).toBe(0); // idempotente
  });

  it('versão lida: "Voltar a editar" + novo preparo no meio → TransicaoInvalidaError e nada muda (nem arquivo, nem verificação)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const lida = { codigo: x.codigo, baseSha256: x.baseSha256 };
    await novoPreparoNoBanco(x, app.db);
    await expect(assinarNoBanco(x, lida)).rejects.toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'aguardando_assinatura', pdf_path: null });
    expect((await app.db.execute(sql`select 1 from document_verifications where documento_id = ${x.id}`)).rows).toEqual([]);
    const assinados = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where tipo = 'documento_assinado' and patient_id = ${x.p.id}`), app.db);
    expect(assinados.rows).toEqual([]); // o salvarArquivo desfez a reserva e o arquivo
  });

  it('a variante da digitalizada exige digitalizacao_status "pendente"; já assinado → TransicaoInvalidaError', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(assinarNoBanco(x, { codigo: x.codigo, digitalizacaoPendente: true })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    await assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 });
    await expect(assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 })).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });

  it('Minor 9: fitoterápico formulado com a habilitação retirada depois do preparo → recusa "sem_habilitacao"', () => {
    const fito = { versao: 1, tipo: 'receita', orientacoes: '', itens: [{ tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 à noite', nomePopular: '', duracao: '', padronizacao: '' }] } as const;
    expect(() => exigirHabilitacaoAtual({ fitoterapiaRegistro: null }, fito as never)).toThrow(RecusaAssinaturaError);
    expect(() => exigirHabilitacaoAtual({ fitoterapiaRegistro: 'CRN-3 nº 1/2024' }, fito as never)).not.toThrow();
    expect(() => exigirHabilitacaoAtual({ fitoterapiaRegistro: null }, { versao: 1, tipo: 'receita', orientacoes: '', itens: [] })).not.toThrow();
  });

  it('D23: registrar-assinatura.ts não puxa sessão, nem pelos imports dos imports (o worker da digitalizada o importa)', () => {
    const fonte = readFileSync('src/modules/documentos/registrar-assinatura.ts', 'utf8');
    expect(fonte).not.toMatch(/@\/lib\/auth|confirmar-2fa|tenant-session|from 'next\//);
    const g = grafoDeImports(['src/modules/documentos/registrar-assinatura.ts']);
    for (const proibido of ['src/lib/auth.ts', 'src/lib/confirmar-2fa.ts', 'src/lib/tenant-session.ts'])
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
  });
});
```

Run: `pnpm test src/modules/documentos/registrar-assinatura.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Verificação (escrita) e a guarda de acesso** — `src/modules/documentos/verificacao.ts` e `verificacao.test.ts`

```ts
// verificacao.ts
import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { documentVerifications } from '@/db/schema';
import type { SituacaoVerificacao, TipoAssinatura } from './constantes';

/**
 * RN-156: ÚNICO arquivo que toca `document_verifications` (fora da RLS; guarda em verificacao.test.ts). Sem dado do
 * paciente nem de saúde. A linha nasce na assinatura e só a situação muda depois (privilégio por coluna, 0090).
 */
export type NovaVerificacao = {
  codigo: string; tenantId: string; documentoId: string; tipo: 'receita'; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinaturaTipo: TipoAssinatura; pdfSha256: string;
};

export async function registrarVerificacao(tx: Tx, v: NovaVerificacao): Promise<void> {
  await tx.insert(documentVerifications).values({ ...v, situacao: 'valido', situacaoEm: v.assinadoEm });
}

export async function mudarSituacao(tx: Tx, documentoId: string, situacao: SituacaoVerificacao, em: Date): Promise<void> {
  await tx.update(documentVerifications).set({ situacao, situacaoEm: em }).where(eq(documentVerifications.documentoId, documentoId));
}
```

```ts
// verificacao.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('document_verifications só por verificacao.ts (RLS_EXCEPTIONS)', () => {
  it('nenhum outro arquivo de src (fora o schema) cita a tabela', () => {
    const arquivos = readdirSync('src', { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.test.ts'))
      .map((d) => path.join(d.parentPath, d.name))
      .filter((f) => !f.endsWith(path.join('documentos', 'verificacao.ts')) && !f.includes(path.join('db', 'schema')) && !f.endsWith(path.join('db', 'rls-guard.ts')));
    const citam = arquivos.filter((f) => /documentVerifications|document_verifications/.test(readFileSync(f, 'utf8')));
    expect(citam).toEqual([]);
  });
});
```

- [ ] **Step 4: Implementação** — `src/modules/documentos/registrar-assinatura.ts`

```ts
import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { signedDocuments, type TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import type { TipoAssinatura } from './constantes';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import type { CopiaProfissional } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';
import { registrarVerificacao } from './verificacao';

/**
 * D23 (Plano 10A): a parte da assinatura que a rota (envio) e o WORKER (digitalizada) compartilham. Este arquivo não
 * importa nada de sessão (@/lib/auth, confirmar-2fa, next/*): o worker o importa (guarda no teste). Os tipos de acesso e
 * de dependências moram aqui para a digitalizada (T9) e o envio do PDF assinado (Plano 10B) usarem os mesmos.
 */
export type AcessoAssinatura = { ctx: TenantContext; tenant: TenantRow; user: { id: string; email: string; twoFactorEnabled: boolean | null } };
export type DepsAssinar = {
  headers: Headers; db?: Db; dataDir?: string; agora?: Date; appUrl?: string;
  confirmar2fa?: (e: { userId: string; codigo: unknown; headers: Headers }) => Promise<'ok' | 'invalido' | 'bloqueado'>;
};
/**
 * `versao` amarra o registrar à versão do documento que foi LIDA (revisão do rascunho, Important): entre a leitura e o
 * registrar (2FA, disco, worker) a nutricionista pode, noutra aba, "Voltar a editar" e preparar de novo — o documento
 * volta a "aguardando_assinatura" com outro código e outro base, e um UPDATE só por status aceitaria o PDF antigo sobre o
 * conteúdo novo (quebra "PDF = prontuário", CS-141). A digitalizada amarra pelo código + "pendente"; o envio do PDF
 * assinado (Plano 10B) pelo código + SHA-256 do base conferido.
 */
export type VersaoLida = { codigo: string } & ({ baseSha256: string } | { digitalizacaoPendente: true });
export type AssinaturaAceita = {
  documentoId: string; codigo: string; patientId: string; tenantId: string; caminho: string; sha256: string; tipo: TipoAssinatura;
  emissor: string | null; assinanteNome: string | null; userId: string; agora: Date; copia: CopiaProfissional; base: string | null;
  versao: VersaoLida;
};

/**
 * Minor 9 da revisão de segurança: a habilitação em Fitoterapia é conferida ao salvar e ao preparar (T5) e de novo AO
 * ASSINAR — retirada entre o preparo e o envio, o fitoterápico formulado não é assinado. Quem chama passa o tenant lido
 * na sessão do envio (a digitalizada no envio das fotos; o 10B no envio do PDF assinado).
 */
export function exigirHabilitacaoAtual(tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, conteudo: ConteudoReceita): void {
  if (!tenant.fitoterapiaRegistro && conteudo.itens.some((i) => i.tipo === 'fitoterapico')) throw new RecusaAssinaturaError('sem_habilitacao', 'habilitacao_retirada');
}

/**
 * RN-140 (b): a ida a "assinado" e a verificação pública — na transação do arquivo (o `registrar` do salvarArquivo do PDF
 * final). Regra 9 (desvio registrado da RN-140 b): `base_pdf_path` e `digitalizacao` NÃO mudam aqui; quem chama, depois do
 * salvarArquivo, solta cada arquivo no seu apagarArquivo com `soltarArquivosDoPreparo(ctx, id, EMITIDOS)` (T9; o envio do
 * PDF assinado do Plano 10B faz o mesmo), e a varredura da T7 repete o que falhar. A T10 acrescenta a entrega.
 */
export async function registrarAssinatura(tx: Tx, a: AssinaturaAceita): Promise<void> {
  const daVersao = 'baseSha256' in a.versao
    ? eq(signedDocuments.basePdfSha256, a.versao.baseSha256)
    : eq(signedDocuments.digitalizacaoStatus, 'pendente');
  const r = await tx
    .update(signedDocuments)
    .set({
      status: 'assinado', pdfPath: a.caminho, pdfSha256: a.sha256, assinaturaTipo: a.tipo, assinaturaEmissor: a.emissor?.slice(0, 200) ?? null,
      assinanteNome: a.assinanteNome?.slice(0, 200) ?? null, assinadoEm: a.agora, assinadoPor: a.userId,
      digitalizacaoStatus: null, digitalizacaoEm: null, updatedAt: a.agora,
    })
    .where(and(eq(signedDocuments.id, a.documentoId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.codigo, a.versao.codigo), daVersao))
    .returning({ id: signedDocuments.id });
  if (!r.length) throw new TransicaoInvalidaError(); // outra versão no meio (ou já assinado): o salvarArquivo desfaz tudo
  await registrarVerificacao(tx, {
    codigo: a.codigo, tenantId: a.tenantId, documentoId: a.documentoId, tipo: 'receita', assinadoEm: a.agora, emissorNome: a.copia.nomeCompleto,
    emissorCrn: a.copia.crn, assinanteNome: a.tipo === 'digitalizada' ? null : a.assinanteNome, assinaturaTipo: a.tipo, pdfSha256: a.sha256,
  });
}
```

> `entregue_em` **não** é gravado aqui: a T10 o grava só quando `entregarDocumento` entrega de fato (portal ou link) — Minor da revisão de cobertura (paciente arquivado aparecia como "Enviado em … · ainda não aberto").

Run: `pnpm test src/modules/documentos/registrar-assinatura.test.ts src/modules/documentos/verificacao.test.ts` → PASS (o caso "regra 9" usa o `soltarArquivosDoPreparo` da T5).

- [ ] **Step 5: Commit**

```bash
git add src/modules/documentos/{registrar-assinatura,registrar-assinatura.test,verificacao,verificacao.test}.ts test/documentos.ts
git commit -m "feat(documentos): assinatura no banco amarrada à versão lida e verificação pública, sem dependência de sessão (RN-140 b, RN-156)"
```

---
### Task 9: Digitalizada — fotos das páginas, código do 2FA a cada envio e PDF novo montado no worker (D1 opção E, D4 ★, RN-157; P10A-09; antiga T11)

> **Minors da revisão de cobertura aplicados (D24):** dois envios simultâneos não somam fotos (o primeiro trava o documento em `recebendo`; o segundo recebe 409) e um `recebendo`/`pendente` esquecido expira em 1 h (varredura da T7). A habilitação em Fitoterapia é conferida de novo no envio (Minor 9 da revisão de segurança). A rota é escrita inteira aqui (no plano único ela copiava a do PDF assinado, que foi para o Plano 10B), com o semáforo contado **depois** de ler o corpo e um envio por usuária de cada vez (Minor 6).

**Files:**
- Create: `src/modules/documentos/digitalizada.ts` (+ `digitalizada.test.ts`), `src/modules/documentos/digitalizada-job.ts` (+ `digitalizada-job.test.ts`), `src/app/api/painel/documentos/[id]/digitalizada/route.ts` (+ `route.test.ts`), `src/app/painel/pacientes/[id]/documentos/[docId]/enviar-digitalizada.tsx`
- Modify: `src/worker/index.ts`, `src/modules/documentos/constantes.ts` (`MAX_PIXELS_FOTO = 40_000_000`, como o diário e a capa: acima disto, recusa pelo cabeçalho, sem decodificar; `DIGITALIZACAO_MAX_MS = 3_600_000`), a página do documento (cartão "Aguardando assinatura" e o estado "Montando o PDF digitalizado…")

**Interfaces:**
- Consumes: `registrarAssinatura`, `AssinaturaAceita`, `VersaoLida`, `AcessoAssinatura`, `DepsAssinar`, `exigirHabilitacaoAtual` (T8, `registrar-assinatura.ts`); `novoConsultorio`, `outroDocumento`, `novoPreparoNoBanco` (T8, testes); `expirarPdfsDeDocumentoPendentes` (T7, teste); `soltarArquivosDoPreparo` (T5); `confirmarCodigo2fa` (T4); `salvarArquivo`, `apagarArquivo`; `detectarTipo`; `sharp` e `paraJpegSemMetadados` (`src/lib/jpeg.ts`, Planos 06–07); `formatarCodigo`, `AREA_ASSINATURA`; `getBoss`, `fromDrizzle`; `recordAudit`.
- Produces:
  - `receberDigitalizada(a: AcessoAssinatura, docId: string, imagens: Buffer[], codigo2fa: unknown, deps: DepsAssinar & { boss?: PgBoss }): Promise<void>` (lança `RecusaAssinaturaError` com `imagens`, `sem_2fa`, `codigo_2fa`, `tentativas_2fa`, `sem_habilitacao`; `TransicaoInvalidaError` com outro envio em curso ou outra versão); `MSG_DIGITALIZADA = { aviso, fotos, montando, falhou }`.
  - `montarPdfDigitalizado(data: { tenantId: string; documentoId: string; userId: string }, deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDigitalizada }): Promise<'pronto' | 'ignorado' | 'falhou'>` (o `marcarFalhou` casa a versão lida: id + "pendente" + código; depois da assinatura, `soltarArquivosDoPreparo`); `renderizarDigitalizada(d: { paginas: { dados: Buffer; formato: 'jpg' }[]; codigo: string; urlVerificacao: string }): Promise<Buffer>` (as páginas chegam já normalizadas: JPEG sem metadados, orientação aplicada, até 3508 px).

- [ ] **Step 1: Testes (falham)** — `digitalizada.test.ts` e `digitalizada-job.test.ts`

```ts
// digitalizada.test.ts (ajudantes novoConsultorio/outroDocumento/novoPreparoNoBanco de test/documentos.ts, T8)
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento } from '../../../test/documentos';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { receberDigitalizada } from './digitalizada';
import { expirarPdfsDeDocumentoPendentes } from './documento-pdf-job';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});
const png = () => sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).png().toBuffer();
const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n');
const recusa = (c: string) => (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === c;
const deps = (dataDir: string, codigo: 'ok' | 'invalido' = 'ok') => ({ db: app.db, dataDir, headers: new Headers(), confirmar2fa: async () => codigo });
/** PNG de poucos bytes que DECLARA largura × altura no IHDR (uma "bomba de pixels": decodificado, seriam gigabytes). */
function pngDeclarando(largura: number, altura: number): Buffer {
  const chunk = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo, 'latin1');
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), chunk('IEND', Buffer.alloc(0))]);
}

describe('digitalizada (RN-157, D4)', () => {
  it('PDF como "digitalizado" é recusado (só fotos); 6 fotos também; o código do 2FA é pedido em todo envio', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(receberDigitalizada(x.acesso, x.id, [pdf], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('imagens'));
    const f = await png();
    await expect(receberDigitalizada(x.acesso, x.id, Array(6).fill(f), '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('imagens'));
    await expect(receberDigitalizada(x.acesso, x.id, [f], '000000', deps(x.dataDir, 'invalido'))).rejects.toSatisfy(recusa('codigo_2fa'));
  });

  it('PNG que declara 30.000 × 30.000 → recusa "imagens" pelo cabeçalho, sem decodificar (o processo segue de pé)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(receberDigitalizada(x.acesso, x.id, [pngDeclarando(30_000, 30_000)], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('imagens'));
  });

  it('versão lida: "Voltar a editar" e um novo preparo durante o envio → 409 e nenhuma foto presa à versão nova', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const noMeio = async () => (await novoPreparoNoBanco(x, app.db), 'ok' as const);
    await expect(receberDigitalizada(x.acesso, x.id, [await png()], '123456', { ...deps(x.dataDir), confirmar2fa: noMeio })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ digitalizacao: null, digitalizacao_status: null });
  });

  it('fotos aceitas: guardadas como documento_digitalizado (o paciente não vê), status "pendente" e o job na fila', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await receberDigitalizada(x.acesso, x.id, [await png(), await png()], '123456', deps(x.dataDir));
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows as { status: string; digitalizacao: string[]; digitalizacao_status: string }[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', digitalizacao_status: 'pendente' });
    expect(d.digitalizacao).toHaveLength(2);
    const jobs = await (await getBoss()).findJobs<{ documentoId: string }>('documento-digitalizado');
    expect(jobs.some((j) => j.data.documentoId === x.id)).toBe(true);
  });

  it('D24: dois envios ao mesmo tempo → um passa e o outro recebe 409; as fotos não se somam', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const [f1, f2] = [await png(), await png()];
    const r = await Promise.allSettled([
      receberDigitalizada(x.acesso, x.id, [f1, f1, f1], '123456', deps(x.dataDir)),
      receberDigitalizada(x.acesso, x.id, [f2, f2, f2], '123456', deps(x.dataDir)),
    ]);
    expect(r.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows as { digitalizacao: string[]; digitalizacao_status: string }[];
    expect(d.digitalizacao).toHaveLength(3);
    expect(d.digitalizacao_status).toBe('pendente');
  });

  it('D24: "recebendo" ou "pendente" esquecido há mais de 1 h vira "falhou" na varredura e libera um envio novo', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update signed_documents set digitalizacao_status = 'recebendo', digitalizacao_em = now() - interval '2 hours' where id = ${x.id}`), app.db);
    // só o tenant do teste: o banco é compartilhado (a varredura de todos expiraria envios "recebendo" de outros testes)
    expect(await expirarPdfsDeDocumentoPendentes(app.db, new Date(), { tenantId: x.T.tenantId })).toBe(1);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d.digitalizacao_status).toBe('falhou');
    await receberDigitalizada(x.acesso, x.id, [await png()], '123456', deps(x.dataDir)); // "Envie as fotos de novo"
  });

  it('Minor 9: fitoterápico formulado com a habilitação retirada depois do preparo → "sem_habilitacao", nada gravado', async () => {
    const c = await novoConsultorio(app.db);
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 à noite', nomePopular: '', duracao: '', padronizacao: '' };
    const x = await outroDocumento(c, app.db, { conteudo: { versao: 1, tipo: 'receita', itens: [fito], orientacoes: '', copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: true }, paciente: { nome: 'Ana Souza' } } } });
    await expect(receberDigitalizada({ ...x.acesso, tenant: { ...x.acesso.tenant, fitoterapiaRegistro: null } }, x.id, [await png()], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('sem_habilitacao'));
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ digitalizacao: null, digitalizacao_status: null });
  });
});
```

```ts
// digitalizada-job.test.ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento } from '../../../test/documentos';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado, renderizarDigitalizada } from './digitalizada-job';
import { TransicaoInvalidaError } from './erros';
import { registrarAssinatura } from './registrar-assinatura';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

describe('PDF da digitalizada no worker (RN-157)', () => {
  it('monta um PDF NOVO (sem ação nem anexo), assina como "digitalizada", sem "Assinado por"; apaga as fotos e o base', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    expect(await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, { db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, assinatura_tipo, assinante_nome, pdf_path, pdf_sha256, digitalizacao, codigo from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, string | null>[];
    expect(d).toMatchObject({ status: 'assinado', assinatura_tipo: 'digitalizada', assinante_nome: null, digitalizacao: null });
    const arquivo = await readFile(path.join(x.dataDir, d.pdf_path!));
    expect(createHash('sha256').update(arquivo).digest('hex')).toBe(d.pdf_sha256);
    // PDF NOVO, sem ação nem anexo (o react-pdf escreve os dicionários em texto); a conferência estrutural, com o leitor
    // limitado, entra no Plano 10B (Tarefa 1)
    for (const chave of ['/OpenAction', '/JavaScript', '/JS ', '/EmbeddedFile', '/Launch', '/AA ']) expect(arquivo.includes(chave), chave).toBe(false);
    const v = (await app.db.execute(sql`select assinatura_tipo, assinante_nome from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v).toEqual({ assinatura_tipo: 'digitalizada', assinante_nome: null });
    const sobra = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select tipo from stored_files where tipo in ('documento_digitalizado', 'documento_base') and patient_id = ${x.p.id}`), app.db);
    expect(sobra.rows).toEqual([]);
  });

  it('a foto do celular com EXIF e GPS sai no PDF sem metadados (normalizada pelo paraJpegSemMetadados, orientação aplicada)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 1100, height: 800, channels: 3, background: '#ffffff' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'CelularTeste', Model: 'Serie-XYZ-123', Orientation: '6' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '46/1 38/1 0/1' } })
      .toBuffer();
    expect(foto.includes('Exif')).toBe(true);
    await receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    expect(await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, { db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select pdf_path from signed_documents where id = ${x.id}`), app.db)).rows as { pdf_path: string }[];
    const arquivo = await readFile(path.join(x.dataDir, d.pdf_path));
    for (const marca of ['Exif', 'CelularTeste', 'Serie-XYZ-123']) expect(arquivo.includes(marca), marca).toBe(false); // o bloco APP1 inteiro (com o GPS) some
  });

  it('versão lida: "Voltar a editar" + novo preparo + envio novo enquanto o job velho monta → o job velho não assina nem marca "falhou" o envio novo', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const receber = () => receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    await receber();
    const r = await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, {
      db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false,
      renderizar: async (d) => {
        await novoPreparoNoBanco(x, app.db); // outra aba: outro código, outro base
        await receber(); // e um envio novo, "pendente" na versão nova
        return renderizarDigitalizada(d);
      },
    });
    expect(r).toBe('ignorado');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, digitalizacao_status, codigo, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, string | null>[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', digitalizacao_status: 'pendente', pdf_path: null }); // o envio novo continua de pé para o job dele
    expect(d.codigo).not.toBe(x.codigo);
  });

  it('registrarAssinatura da digitalizada com a versão antiga (outro código) → TransicaoInvalidaError', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await receberDigitalizada(x.acesso, x.id, [await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    const copia = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };
    await expect(withTenant({ tenantId: x.T.tenantId, role: 'worker' }, (tx) => registrarAssinatura(tx, {
      documentoId: x.id, codigo: 'ZZZZZZZZZZZZ', patientId: x.p.id, tenantId: x.T.tenantId, caminho: x.base, sha256: 'x', tipo: 'digitalizada', emissor: null,
      assinanteNome: null, userId: x.T.nutriId, agora: new Date(), copia, base: x.base, versao: { codigo: 'ZZZZZZZZZZZZ', digitalizacaoPendente: true },
    }), app.db)).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });
});
```

Run: `pnpm test src/modules/documentos/digitalizada.test.ts src/modules/documentos/digitalizada-job.test.ts` → FAIL.

- [ ] **Step 2: Receber as fotos** — `src/modules/documentos/digitalizada.ts`

```ts
import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { getDb } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { confirmarCodigo2fa } from '@/lib/confirmar-2fa';
import { detectarTipo } from '@/lib/file-type';
import { logger } from '@/lib/logger';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { apagarArquivo, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { DIGITALIZACAO_MAX_MS, MAX_PIXELS_FOTO } from './constantes';
import { DocumentoNaoEncontradoError, RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import type { ConteudoReceita } from './prescricao';
import { exigirHabilitacaoAtual, type AcessoAssinatura, type DepsAssinar } from './registrar-assinatura';

export const MAX_FOTOS = 5;
export const MAX_FOTOS_BYTES = 10 * 1024 * 1024;
/** US-144 (texto exato da spec v0.3) e os novos deste plano. */
export const MSG_DIGITALIZADA = {
  aviso: 'O sistema não confere o conteúdo de documentos digitalizados. Envie fotos das páginas do PDF preparado, assinadas e sem alterações.',
  fotos: 'Envie de 1 a 5 fotos, até 10 MB no total.',
  montando: 'Montando o PDF digitalizado…',
  falhou: 'Não foi possível montar o PDF. Envie as fotos de novo.',
} as const;

/** Um envio em curso (recebendo ou pendente) que ainda não expirou: outro envio espera (D24). */
const emCurso = (d: { digitalizacaoStatus: string | null; digitalizacaoEm: Date | null }, agora: Date) =>
  (d.digitalizacaoStatus === 'recebendo' || d.digitalizacaoStatus === 'pendente') && !!d.digitalizacaoEm && agora.getTime() - d.digitalizacaoEm.getTime() < DIGITALIZACAO_MAX_MS;

/**
 * RN-157 / D4: só fotos (JPEG/PNG, tipo pelo conteúdo, 1 a 5, 10 MB no total) e o código do 2FA em TODO envio (sem
 * certificado, é o que liga a autoria, D13). As fotos vão para stored_files (`documento_digitalizado`, fora da política do
 * paciente) e o worker monta o PDF novo — o arquivo enviado nunca é entregue como veio.
 * Ordem: fotos conferidas → versão lida (código) e habilitação (Minor 9) → 2FA → TRAVA "recebendo" (D24: um envio por
 * vez; o segundo recebe 409) → fotos antigas apagadas e as novas gravadas, cada uma amarrada à versão + "recebendo" →
 * "pendente" e o job na mesma transação. Qualquer erro depois da trava → "falhou" (a tela pede as fotos de novo).
 */
export async function receberDigitalizada(a: AcessoAssinatura, docId: string, imagens: Buffer[], codigo2fa: unknown, deps: DepsAssinar & { boss?: PgBoss }): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (!a.user.twoFactorEnabled) throw new RecusaAssinaturaError('sem_2fa');
  const total = imagens.reduce((s, b) => s + b.length, 0);
  if (!imagens.length || imagens.length > MAX_FOTOS || total > MAX_FOTOS_BYTES) throw new RecusaAssinaturaError('imagens', 'quantidade_ou_tamanho');
  if (!imagens.every((b) => ['jpg', 'png'].includes(detectarTipo(b)?.ext ?? ''))) throw new RecusaAssinaturaError('imagens', 'tipo');
  // RN-157: bomba de pixels (PNG de poucos MB que declara 30.000 × 30.000) recusada pelo cabeçalho — decodificada no
  // worker, derrubaria o processo e o pg-boss repetiria o job em laço (e-mails, push e exportações de todos parados)
  for (const img of imagens) {
    const m = await sharp(img, { limitInputPixels: MAX_PIXELS_FOTO, failOn: 'error' }).metadata().catch(() => null);
    if (!m?.width || !m.height || m.width * m.height > MAX_PIXELS_FOTO) throw new RecusaAssinaturaError('imagens', 'pixels');
  }
  const lida = await withTenant(a.ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'aguardando_assinatura' || !d.codigo || emCurso(d, agora)) throw new TransicaoInvalidaError();
    const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId));
    if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
    return { patientId: d.patientId, codigo: d.codigo, conteudo: d.conteudo as ConteudoReceita };
  }, db);
  exigirHabilitacaoAtual(a.tenant, lida.conteudo);
  const r = await (deps.confirmar2fa ?? ((e) => confirmarCodigo2fa(e, { db })))({ userId: a.user.id, codigo: codigo2fa, headers: deps.headers });
  if (r === 'bloqueado') throw new RecusaAssinaturaError('tentativas_2fa');
  if (r === 'invalido') {
    await withTenant(a.ctx, (tx) => recordAudit(tx, { acao: 'criar', entidade: 'tentativa_assinatura', entidadeId: docId, patientId: lida.patientId }), db);
    logger.warn({ tenantId: a.ctx.tenantId, documentoId: docId }, 'código do 2FA recusado ao assinar');
    throw new RecusaAssinaturaError('codigo_2fa');
  }
  // D24: a trava. Versão lida (o código) + nenhum envio em curso; "Voltar a editar" + novo preparo no meio troca o código
  const antigas = await withTenant(a.ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId)).for('update');
    if (!d || d.status !== 'aguardando_assinatura' || d.codigo !== lida.codigo || emCurso(d, agora)) throw new TransicaoInvalidaError();
    await tx.update(signedDocuments).set({ digitalizacaoStatus: 'recebendo', digitalizacaoEm: agora }).where(eq(signedDocuments.id, docId));
    return d.digitalizacao ?? [];
  }, db);
  const daVersao = and(eq(signedDocuments.id, docId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.codigo, lida.codigo), eq(signedDocuments.digitalizacaoStatus, 'recebendo'));
  try {
    for (const c of antigas)
      await apagarArquivo(a.ctx, { caminho: c }, {
        db, dataDir: deps.dataDir,
        naMesmaTransacao: async (tx) => (await tx.update(signedDocuments).set({ digitalizacao: sql`coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb) - ${c}::text` }).where(daVersao).returning({ id: signedDocuments.id })).length > 0,
      }).catch(() => undefined); // a varredura da T7 apaga a foto sem referência
    for (const img of imagens) {
      await salvarArquivo(a.ctx, {
        tipo: 'documento_digitalizado', conteudo: img, permitidos: ['jpg', 'png'], patientId: lida.patientId,
        registrar: async (tx, arq) => {
          const ok = await tx
            .update(signedDocuments)
            .set({ digitalizacao: sql`coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb) || jsonb_build_array(${arq.caminho}::text)` })
            .where(daVersao)
            .returning({ id: signedDocuments.id });
          if (!ok.length) throw new TransicaoInvalidaError();
        },
      }, { db, dataDir: deps.dataDir });
    }
    const boss = deps.boss ?? (await getBoss());
    await withTenant(a.ctx, async (tx) => {
      const ok = await tx.update(signedDocuments).set({ digitalizacaoStatus: 'pendente' }).where(daVersao).returning({ id: signedDocuments.id });
      if (!ok.length) throw new TransicaoInvalidaError();
      await boss.send('documento-digitalizado', { tenantId: a.ctx.tenantId, documentoId: docId, userId: a.user.id }, { db: fromDrizzle(tx, sql) });
    }, db);
  } catch (e) {
    await withTenant(a.ctx, (tx) => tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou' }).where(daVersao), db).catch(() => undefined);
    throw e;
  }
  logger.info({ tenantId: a.ctx.tenantId, documentoId: docId, fotos: imagens.length }, 'digitalização recebida');
}
```

- [ ] **Step 3: O job** — `src/modules/documentos/digitalizada-job.ts`

```tsx
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Document, Image, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { and, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import sharp from 'sharp';
import type { Db } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { formatarCodigo } from './codigo';
import { EMITIDOS, MAX_PIXELS_FOTO } from './constantes';
import { TransicaoInvalidaError } from './erros';
import type { ConteudoReceita } from './prescricao';
import { registrarAssinatura } from './registrar-assinatura';

/** A4 a 300 dpi no lado maior: legível na farmácia, sem levar a foto original. */
const LADO_MAX_PAGINA = 3508;

/** Só o worker importa este arquivo (guarda de grafo). Ele importa `registrar-assinatura.ts`, sem sessão (D23). */
export async function renderizarDigitalizada(d: { paginas: { dados: Buffer; formato: 'jpg' }[]; codigo: string; urlVerificacao: string }): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.urlVerificacao, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return renderToBuffer(
    <Document title="Receita (digitalizada)" creator="NutriDebby" producer="NutriDebby">
      {d.paginas.map((p, i) => (
        <Page key={i} size="A4" style={{ padding: 24, paddingBottom: 72 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf */}
          <Image src={{ data: p.dados, format: p.formato }} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          <View fixed style={{ position: 'absolute', left: 24, right: 24, bottom: 16, flexDirection: 'row', alignItems: 'center' }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf */}
            <Image src={{ data: qr, format: 'png' }} style={{ width: 40, height: 40, marginRight: 8 }} />
            <Text style={{ fontSize: 8, flex: 1 }}>{`Documento digitalizado · Código de verificação: ${formatarCodigo(d.codigo)} · Verifique em ${d.urlVerificacao}`}</Text>
          </View>
        </Page>
      ))}
    </Document>,
  );
}

class JaFeitoError extends Error {}
class FotoInvalidaError extends Error {}

/**
 * RN-157: a foto NUNCA entra no PDF como veio. O pdfkit embute o JPEG com o APP1 (EXIF: GPS — muitas vezes a casa da
 * nutricionista —, modelo e série do aparelho) e não aplica a orientação. Aqui: limite de pixels, rotate() (aplica a
 * orientação do EXIF antes de descartá-lo) e o pipeline do diário e da capa (sem metadados, fundo branco).
 */
async function normalizarPagina(dados: Buffer): Promise<{ dados: Buffer; formato: 'jpg' }> {
  try {
    return { dados: await paraJpegSemMetadados(sharp(dados, { limitInputPixels: MAX_PIXELS_FOTO, failOn: 'error' }).rotate(), LADO_MAX_PAGINA), formato: 'jpg' };
  } catch {
    throw new FotoInvalidaError();
  }
}

/**
 * RN-157: o PDF novo com as fotos e o rodapé; a ida a "assinado" (tipo digitalizada) no registrar; depois, regra 9: cada
 * foto e o base no seu apagarArquivo, com o ponteiro no naMesmaTransacao (soltarArquivosDoPreparo). A versão lida (o código)
 * amarra o registrar e o marcarFalhou (correção do /code-review high do PR #18): "Voltar a editar" + novo preparo + envio
 * novo enquanto este job monta → a versão nova (outro código, também "pendente") não é assinada nem marcada "falhou".
 */
export async function montarPdfDigitalizado(
  data: { tenantId: string; documentoId: string; userId: string },
  deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDigitalizada },
): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const agora = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const d = await withTenant(ctx, async (tx) => (await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.digitalizacaoStatus, 'pendente'))))[0] ?? null, db);
  if (!d || !d.codigo || !d.digitalizacao?.length) return 'ignorado';
  const codigo = d.codigo;
  const marcarFalhou = () =>
    withTenant(ctx, (tx) => tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou' }).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.digitalizacaoStatus, 'pendente'), eq(signedDocuments.codigo, codigo))), db);
  try {
    // uma por vez (não Promise.all): até 5 fotos de 40 MP decodificadas juntas pesariam no worker de todos
    const paginas: { dados: Buffer; formato: 'jpg' }[] = [];
    for (const c of d.digitalizacao) paginas.push(await normalizarPagina(await readFile(resolverCaminho(deps.dataDir, c))));
    const pdf = await (deps.renderizar ?? renderizarDigitalizada)({ paginas, codigo, urlVerificacao: urlDoApp(deps.appUrl, `/v/${codigo}`) });
    const sha = createHash('sha256').update(pdf).digest('hex');
    const copia = (d.conteudo as ConteudoReceita).copia!.profissional;
    await salvarArquivo(ctx, {
      tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: d.patientId, substitui: d.basePdfPath ?? undefined,
      antesDaReserva: async (tx) => {
        const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId)).for('update');
        if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new JaFeitoError();
      },
      registrar: async (tx, arq) => {
        await registrarAssinatura(tx, {
          documentoId: d.id, codigo, patientId: d.patientId, tenantId: data.tenantId, caminho: arq.caminho, sha256: sha, tipo: 'digitalizada',
          emissor: null, assinanteNome: null, userId: data.userId, agora, copia, base: d.basePdfPath,
          versao: { codigo, digitalizacaoPendente: true }, // a versão lida: mesmo código e ainda "pendente"
        });
      },
    }, { db, dataDir: deps.dataDir });
    // regra 9: os ponteiros ficaram na assinatura; cada foto e o base saem agora no SEU apagar (o que falhar, a varredura repete)
    await soltarArquivosDoPreparo(ctx, d.id, EMITIDOS, { db, dataDir: deps.dataDir });
    return 'pronto';
  } catch (e) {
    if (e instanceof JaFeitoError || e instanceof TransicaoInvalidaError) {
      // casa só a versão lida (mesmo código) ainda "pendente": numa versão nova — outro código, mesmo que com um envio
      // novo também "pendente" — não muda nada
      await marcarFalhou();
      return 'ignorado';
    }
    if (e instanceof FotoInvalidaError || e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      // foto ilegível ou acima do limite de pixels não melhora na próxima tentativa: falha já, sem laço no pg-boss
      logger.warn({ documentoId: data.documentoId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : e instanceof FotoInvalidaError ? 'foto' : 'erro' }, 'PDF da digitalização não montado');
      await marcarFalhou();
      return 'falhou';
    }
    throw e;
  }
}
```

`src/worker/index.ts`:

```ts
import { montarPdfDigitalizado } from '@/modules/documentos/digitalizada-job';
// …
  await work('documento-digitalizado', { includeMetadata: true }, async ([job]: JobWithMetadata<{ tenantId: string; documentoId: string; userId: string }>[]) => {
    await montarPdfDigitalizado(job.data, { db: getDb(), dataDir: env.DATA_DIR, appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
```

- [ ] **Step 4: Rota e tela**

`src/app/api/painel/documentos/[id]/digitalizada/route.ts` (Route Handler: o proxy corta corpo de Server Action em 10 MB):

```ts
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { logger } from '@/lib/logger';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { receberDigitalizada, MAX_FOTOS_BYTES, MSG_DIGITALIZADA } from '@/modules/documentos/digitalizada';
import { DocumentoNaoEncontradoError, RecusaAssinaturaError, TransicaoInvalidaError } from '@/modules/documentos/erros';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';
const LIMITE_CORPO = MAX_FOTOS_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
/**
 * RNF-141: no máximo 2 envios processando ao mesmo tempo no processo (sharp lê o cabeçalho de até 5 fotos) e um por
 * usuária. Minor 6 da revisão de segurança: a vaga só é ocupada DEPOIS de ler o corpo (60 s) — dois envios lentos não
 * seguram as vagas de todos os consultórios.
 */
const MAX_PROCESSANDO = 2;
let processando = 0;
const porUsuaria = new Set<string>();

/** RN-157 / US-144: multipart com `fotos` (1 a 5) e `codigo2fa`. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/documentos/[id]/digitalizada'>) {
  if (!mesmaOrigem(req)) return resposta(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return resposta(404, { erro: 'Documento não encontrado.' });
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erro: MSG_DIGITALIZADA.fotos });
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO, { prazoMs: 60_000 });
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erro: MSG_DIGITALIZADA.fotos });
    if (e instanceof CorpoLentoError) return resposta(408, { erro: 'O envio demorou demais. Tente de novo.' });
    return resposta(400, { erro: 'Formulário inválido.' });
  }
  const userId = acesso.data.user.id;
  if (processando >= MAX_PROCESSANDO || porUsuaria.has(userId)) return resposta(429, { erro: 'Outro envio está em andamento. Tente de novo em instantes.' });
  processando++;
  porUsuaria.add(userId);
  try {
    const fotos: Buffer[] = [];
    for (const f of form.getAll('fotos')) if (f instanceof Blob && f.size > 0) fotos.push(Buffer.from(await f.arrayBuffer()));
    await receberDigitalizada(
      { ctx: acesso.ctx, tenant: acesso.tenant, user: { id: userId, email: acesso.data.user.email, twoFactorEnabled: acesso.data.user.twoFactorEnabled ?? null } },
      id, fotos, form.get('codigo2fa') ?? undefined, { headers: req.headers },
    );
    return resposta(200, { ok: true });
  } catch (e) {
    if (e instanceof RecusaAssinaturaError) {
      logger.info({ tenantId: acesso.ctx.tenantId, documentoId: id, motivo: e.motivoTecnico }, 'digitalização recusada');
      return resposta(422, { erro: e.mensagem(), codigo: e.codigo });
    }
    if (e instanceof DocumentoNaoEncontradoError) return resposta(404, { erro: e.message });
    if (e instanceof TransicaoInvalidaError || e instanceof PacienteBloqueadoError) return resposta(409, { erro: e.message });
    if (e instanceof CotaEsgotadaError) return resposta(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    processando--;
    porUsuaria.delete(userId);
  }
}
```

`route.test.ts` (padrão dos exames): origem estranha → 403; sem sessão → 401; consultório sem `documentosLiberados` → 404; corpo de 11 MB → 413 com "Envie de 1 a 5 fotos, até 10 MB no total."; um PDF no campo `fotos` → 422 com "Envie fotos das páginas (JPEG ou PNG)." e o documento continua "Aguardando assinatura"; o log da recusa (spy no `logger.info`) só com `tenantId`, `documentoId` e `motivo` (nunca o código do 2FA).

`enviar-digitalizada.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Botao } from '@/components/ui/botao';

/** RN-157 / D4: fotos das páginas + o código do 2FA (todo envio). Os textos vêm do servidor (MSG_DIGITALIZADA). */
export function EnviarDigitalizada({ docId, aviso, dica }: { docId: string; aviso: string; dica: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  if (!aberto) return <Botao type="button" variante="secundario" onClick={() => setAberto(true)}>Enviar documento digitalizado (assinado à mão)</Botao>;
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErro('');
        setEnviando(true);
        const r = await fetch(`/api/painel/documentos/${docId}/digitalizada`, { method: 'POST', body: new FormData(e.currentTarget) }).catch(() => null);
        const j = (r ? await r.json().catch(() => ({})) : {}) as { ok?: boolean; erro?: string };
        setEnviando(false);
        if (j.ok) router.refresh();
        else setErro(j.erro ?? 'Não foi possível enviar. Tente de novo.');
      }}
    >
      <p role="note" className="rounded-xl border border-borda p-3">{aviso}</p>
      <label htmlFor="fotos" className="block font-medium">Fotos das páginas (JPEG ou PNG, até 5)</label>
      <input id="fotos" name="fotos" type="file" accept="image/jpeg,image/png" multiple required aria-describedby="fotos-dica" />
      <p id="fotos-dica" className="text-sm text-suave">{dica}</p>
      <label htmlFor="codigo-2fa-dig" className="block font-medium">Código da verificação em duas etapas</label>
      <input id="codigo-2fa-dig" name="codigo2fa" inputMode="numeric" autoComplete="one-time-code" required className="w-40 rounded-xl border border-campo bg-cartao p-2 text-texto" />
      {erro && <p role="alert" className="text-erro">{erro}</p>}
      <Botao disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</Botao>
    </form>
  );
}
```

Na página do documento: no cartão "Aguardando assinatura", `{data.user.twoFactorEnabled && !bloqueado && !['recebendo', 'pendente'].includes(d.digitalizacaoStatus ?? '') && <EnviarDigitalizada docId={d.id} aviso={MSG_DIGITALIZADA.aviso} dica={MSG_DIGITALIZADA.fotos} />}`; com `d.digitalizacaoStatus` `'recebendo'` ou `'pendente'`, `<EstadoPdf docId={d.id} esperando="digitalizacao" />`; com `'falhou'`, `<Aviso tipo="erro">{MSG_DIGITALIZADA.falhou}</Aviso>` e o formulário de novo. O `EstadoPdf` da T6 ganha a prop (sem ela, o documento em "Aguardando assinatura" recarregaria a página a cada 3 s, porque a condição da T6 olha só o `preparando`):

```tsx
// estado-pdf.tsx (T6), com a prop nova; o texto vem da prop, não do módulo (componente 'use client')
export function EstadoPdf({ docId, esperando = 'pdf' }: { docId: string; esperando?: 'pdf' | 'digitalizacao' }) {
  const router = useRouter();
  useEffect(() => {
    let vivo = true;
    const t = setInterval(async () => {
      const r = await fetch(`/api/painel/documentos/${docId}/pdf?estado=1`, { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { status: string; pdfStatus: string | null; digitalizacaoStatus: string | null }) : null;
      const mudou = !j ? false : esperando === 'pdf'
        ? j.status !== 'preparando' || j.pdfStatus === 'falhou' || j.pdfStatus === 'sem_cota'
        : j.status !== 'aguardando_assinatura' || !['recebendo', 'pendente'].includes(j.digitalizacaoStatus ?? '');
      if (vivo && mudou) router.refresh();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [docId, esperando, router]);
  return <p role="status" aria-live="polite">{esperando === 'pdf' ? 'Preparando o PDF…' : 'Montando o PDF digitalizado…'}</p>;
}
```

- [ ] **Step 5: Rodar e commit**

Em `constantes.ts`: `export const MAX_PIXELS_FOTO = 40_000_000;` e `/** D24: um envio digitalizado "recebendo"/"pendente" vale por 1 h; depois, a varredura o expira e outro envio pode começar. */ export const DIGITALIZACAO_MAX_MS = 3_600_000;`.

Run: `pnpm test src/modules/documentos/digitalizada.test.ts src/modules/documentos/digitalizada-job.test.ts src/app/api/painel/documentos src/modules/pacientes/exportacao.test.ts` → PASS (a guarda de grafo agora encontra `digitalizada-job.ts` e confere que nenhuma rota o importa).

```bash
git add src/modules/documentos/{digitalizada,digitalizada.test,digitalizada-job,digitalizada-job.test}.ts* src/modules/documentos/constantes.ts src/app/api/painel/documentos/[id]/digitalizada src/app/painel/pacientes/[id]/documentos/[docId] src/worker/index.ts
git commit -m "feat(documentos): digitalizada por fotos com 2FA a cada envio e PDF novo montado no worker (RN-157, D4)"
```

---
### Task 10: Entrega ao paciente, link de uso único (token), "Entregue pessoalmente", situação da entrega e avisos neutros (US-145, RN-152, RN-153, RN-158 parte do token, D3 e D11 da spec; P10A-10; antiga T12)

> **Minors aplicados:** `entregue_em` só é gravado quando a entrega acontece (portal ou link) — paciente arquivado não aparece como "Enviado em … · ainda não aberto" nem conta no CS-142 (revisão de cobertura); o `if (!p.email)` morto saiu (`patients.email` é NOT NULL); `lerLinkDocumento` devolve `null` para e-mail vazio em vez de 500 (Minor 8 da revisão de segurança). A entrega entra no fim de `registrarAssinatura` (`registrar-assinatura.ts`, T8), que vale para a digitalizada (T9) e, no Plano 10B, para o PDF assinado.

**Files:**
- Create: `src/modules/documentos/entrega.ts` (+ `entrega.test.ts`), `src/modules/documentos/recebimento.ts`, `src/modules/documentos/link-documento.ts` (parte do token), `src/app/painel/pacientes/[id]/documentos/[docId]/entrega.tsx`
- Modify: `src/modules/documentos/registrar-assinatura.ts` (`registrarAssinatura` chama a entrega e grava `entregue_em` só com entrega; `AssinaturaAceita.appUrl`), `src/modules/documentos/digitalizada-job.ts` (passa `appUrl`) e os testes que chamam `registrarAssinatura` direto (`appUrl: 'https://x'`), `src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL.documento_novo`), `src/email/{types.ts,templates.tsx}` (`documento_novo`, `documento_link`), a página e a lista de documentos (situação), `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS`)

**Interfaces:**
- Consumes: `notifications`, `patients`, `tenants`; `enqueueEmail`; `dispararEnvio`; `telaDoPortal`; `urlDoApp`; `primeiroNome`; `encryptionKey`; `normalizarEmailDoLink` (padrão de `link-consulta.ts`); `dataHora` (T6).
- Produces:
  - `link-documento.ts`: `chaveDoLinkDocumento(): Buffer`, `assinarLinkDocumento(l: { tenantId; patientId; documentoId; emitidoEm: Date; email: string }): string`, `lerLinkDocumento<T extends { email: string }>(token: unknown, agora: Date, carregar: (ids) => Promise<T | null>): Promise<{ ids; emitidoEm: Date; expirado: boolean; dados: T } | null>`, `VALIDADE_LINK_MS = 30 dias`, `urlDoLinkDocumento(appUrl, token)`.
  - `entrega.ts`: `entregarDocumento(tx, e: { tenantId; patientId; documentoId; agora: Date; appUrl: string }): Promise<'portal' | 'link' | 'nenhuma'>`, `reenviarLink(ctx, patientId, docId, deps?: { db?; appUrl?; agora? }): Promise<void>`, `situacaoDaEntrega(d: ItemLista, fuso: string): string`, `MSG_ENTREGA`.
  - `recebimento.ts`: `marcarEntreguePessoalmente(ctx, patientId, docId, deps?): Promise<boolean>`, `registrarRecibo(tx, r: { tenantId; patientId; documentoId; evento: EventoRecibo; via: ViaRecibo; registradoPor?: string | null }): Promise<boolean>` (usado pelo portal e pelo link).
  - E-mails `{ tipo: 'documento_novo'; para; nome; consultorio; link }` e `{ tipo: 'documento_link'; para; nome; consultorio; link }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/entrega.test.ts`

```ts
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio, outroDocumento, pdfDeTeste } from '../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { entregarDocumento, situacaoDaEntrega } from './entrega';
import { listarDocumentos } from './documentos';
import { assinarLinkDocumento, lerLinkDocumento } from './link-documento';
import { marcarEntreguePessoalmente } from './recebimento';
import { registrarAssinatura } from './registrar-assinatura';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const entregar = (T: { tenantId: string; ctx: Parameters<typeof withTenant>[0] }, patientId: string, documentoId: string) =>
  withTenant(T.ctx, (tx) => entregarDocumento(tx, { tenantId: T.tenantId, patientId, documentoId, agora: new Date(), appUrl: 'https://nutri.exemplo.com' }), app.db);

describe('entrega (US-145, RN-152, RN-153)', () => {
  it('com conta: push documento_novo e e-mail neutro com o primeiro nome e o link do portal (?v=)', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    const { paciente, email } = await pacienteComConta(app.db, T, { nome: 'Ana Souza' });
    const d = await documentoNoBanco(app.db, T.ctx, paciente.id, { status: 'assinado' });
    expect(await entregar(T, paciente.id, d.id)).toBe('portal');
    const [m] = await emailsNaFila('documento_novo', email);
    expect(m).toMatchObject({ nome: 'Ana', consultorio: 'Consultório Debby' });
    expect(m.link).toMatch(/\/p\/documentos\?v=/);
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select canal, tipo from notifications where patient_id = ${paciente.id}`), app.db);
    expect(n.rows).toEqual([{ canal: 'push', tipo: 'documento_novo' }]);
  });

  it('sem conta e com e-mail: e-mail com o link de uso único (o token confere com o e-mail atual); arquivado: nada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    expect(await entregar(T, p.id, d.id)).toBe('link');
    const [m] = await emailsNaFila('documento_link', p.email);
    const token = m.link.split('/documento/')[1];
    const lido = await lerLinkDocumento(token, new Date(), async () => ({ email: p.email }));
    expect(lido?.ids).toEqual({ tenantId: T.tenantId, patientId: p.id, documentoId: d.id });
    expect(await lerLinkDocumento(token, new Date(), async () => ({ email: 'outro@ex.com' }))).toBeNull(); // e-mail corrigido → link morto
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const d2 = await documentoNoBanco(app.db, T.ctx, arq.id, { status: 'assinado' });
    expect(await entregar(T, arq.id, d2.id)).toBe('nenhuma');
  });

  it('"Entregue pessoalmente" conta como recebido, uma vez; a situação na lista segue a D4', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    let [item] = await listarDocumentos(T.ctx, p.id, app.db);
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toMatch(/^Enviado em \d{2}\/\d{2}\/\d{4} · ainda não aberto$/);
    expect(await marcarEntreguePessoalmente(T.ctx, p.id, d.id, { db: app.db })).toBe(true);
    expect(await marcarEntreguePessoalmente(T.ctx, p.id, d.id, { db: app.db })).toBe(false);
    [item] = await listarDocumentos(T.ctx, p.id, app.db);
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toMatch(/^Entregue pessoalmente em \d{2}\/\d{2}\/\d{4}$/);
  });

  it('Minor: entregue_em só quando houve entrega — assinado de paciente arquivado fica sem "Enviado em"', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update patients set status = 'arquivado' where id = ${x.p.id}`), app.db);
    const pdf = pdfDeTeste('assinado');
    const copia = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };
    await salvarArquivo(x.T.ctx, {
      tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: x.p.id, substitui: x.base,
      registrar: (tx, arq) => registrarAssinatura(tx, {
        documentoId: x.id, codigo: x.codigo, patientId: x.p.id, tenantId: x.T.tenantId, caminho: arq.caminho, sha256: createHash('sha256').update(pdf).digest('hex'),
        tipo: 'digitalizada', emissor: null, assinanteNome: null, userId: x.T.nutriId, agora: new Date(), copia, base: x.base,
        versao: { codigo: x.codigo, baseSha256: x.baseSha256 }, appUrl: 'https://x',
      }),
    }, { db: app.db, dataDir: x.dataDir });
    const [item] = await listarDocumentos(x.T.ctx, x.p.id, app.db);
    expect(item).toMatchObject({ status: 'assinado', entregueEm: null });
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toBe('');
  });

  it('Minor 8: link com e-mail vazio no cadastro → null (nunca 500)', async () => {
    const token = assinarLinkDocumento({ tenantId: randomUUID(), patientId: randomUUID(), documentoId: randomUUID(), emitidoEm: new Date(), email: 'a@b.com' });
    expect(await lerLinkDocumento(token, new Date(), async () => ({ email: '' }))).toBeNull();
  });
});
```

Run: `pnpm test src/modules/documentos/entrega.test.ts` → FAIL.

- [ ] **Step 2: O token do link** — `src/modules/documentos/link-documento.ts` (a T12 acrescenta o código e a sessão)

```ts
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { encryptionKey } from '@/lib/crypto';
import { urlDoApp } from '@/lib/url-do-app';
import { normalizarEmailDoLink } from '@/modules/agenda/link-consulta';

/**
 * RN-158 / D3 b: link de uso único SEM ESTADO (como link-consulta.ts): versão + tenant + paciente + documento + emissão
 * (segundos), MAC de 128 bits com o e-mail ATUAL do paciente (corrigido o e-mail, o link morre). Válido por 30 dias (D6 ★)
 * e só enquanto o documento estiver assinado (conferido por quem lê). Este arquivo está em SEM_CONTA_PERMITIDOS.
 */
const VERSAO = 1;
export const VALIDADE_LINK_MS = 30 * 86_400_000;
let chave: Buffer | undefined;
export const chaveDoLinkDocumento = () => (chave ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:link-documento:v1', 32)));
const uuidBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const mac = (corpo: Buffer, email: string) =>
  createHmac('sha256', chaveDoLinkDocumento()).update(corpo).update(createHash('sha256').update(normalizarEmailDoLink(email), 'utf8').digest()).digest().subarray(0, 16);

export type IdsDoLink = { tenantId: string; patientId: string; documentoId: string };

export function assinarLinkDocumento(l: IdsDoLink & { emitidoEm: Date; email: string }): string {
  const corpo = Buffer.alloc(53);
  corpo.writeUInt8(VERSAO, 0);
  uuidBytes(l.tenantId).copy(corpo, 1);
  uuidBytes(l.patientId).copy(corpo, 17);
  uuidBytes(l.documentoId).copy(corpo, 33);
  corpo.writeUInt32BE(Math.floor(l.emitidoEm.getTime() / 1000), 49);
  return Buffer.concat([corpo, mac(corpo, l.email)]).toString('base64url');
}

/** null = formato, versão ou MAC inválidos (inclusive e-mail corrigido). `carregar` recebe ids AINDA NÃO autenticados. */
export async function lerLinkDocumento<T extends { email: string }>(token: unknown, agora: Date, carregar: (ids: IdsDoLink) => Promise<T | null>): Promise<{ ids: IdsDoLink; emitidoEm: Date; expirado: boolean; dados: T } | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{92}$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.length !== 69 || b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const corpo = b.subarray(0, 53);
  const ids = { tenantId: bytesUuid(corpo.subarray(1, 17)), patientId: bytesUuid(corpo.subarray(17, 33)), documentoId: bytesUuid(corpo.subarray(33, 49)) };
  const dados = await carregar(ids);
  // Minor 8 (revisão de segurança): sem e-mail no cadastro, o link não abre (nunca normalizarEmailDoLink(null) → 500)
  if (!dados || !dados.email || !timingSafeEqual(mac(corpo, dados.email), b.subarray(53))) return null;
  const emitidoEm = new Date(corpo.readUInt32BE(49) * 1000);
  return { ids, emitidoEm, expirado: agora.getTime() - emitidoEm.getTime() > VALIDADE_LINK_MS, dados };
}

export const urlDoLinkDocumento = (appUrl: string, token: string) => urlDoApp(appUrl, `/documento/${token}`);
```

Em `src/db/tenant.ts`, `SEM_CONTA_PERMITIDOS` ganha `'src/modules/documentos/link-documento.ts'`.

- [ ] **Step 3: Entrega e recibo** — `entrega.ts` e `recebimento.ts`

```ts
// entrega.ts
import { and, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { notifications, patients, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { telaDoPortal } from '@/modules/portal/link-portal';
import { dataHora, type ItemLista } from './documentos';
import { DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { assinarLinkDocumento, urlDoLinkDocumento } from './link-documento';

/** US-145 (textos propostos, para a Debby revisar). */
export const MSG_ENTREGA = {
  semPortal: 'Este paciente ainda não tem acesso ao app. Enviamos um link por e-mail para ele abrir o documento com um código. Se a entrega for no consultório, marque "Entregue pessoalmente".',
  arquivado: 'Paciente arquivado: entregue o documento pessoalmente e marque "Entregue pessoalmente".',
  linkReenviado: 'Link reenviado.',
} as const;

/**
 * RN-152 / RN-153, na transação da assinatura: ativo com conta → portal + push + e-mail neutro; ativo sem conta e com
 * e-mail → e-mail com o link de uso único (D3 b); arquivado → nada (só "Entregue pessoalmente"). Nenhum texto diz o tipo
 * do documento, itens ou produtos. Tenant suspenso: a nutricionista nem entra (RN-15) e o job de e-mail descarta.
 */
export async function entregarDocumento(tx: Tx, e: { tenantId: string; patientId: string; documentoId: string; agora: Date; appUrl: string }): Promise<'portal' | 'link' | 'nenhuma'> {
  const [p] = await tx.select({ nome: patients.nome, email: patients.email, userId: patients.userId, status: patients.status }).from(patients).where(eq(patients.id, e.patientId));
  const [t] = await tx.select({ nome: tenants.nomeExibicao }).from(tenants).where(eq(tenants.id, e.tenantId));
  if (!p || !t || p.status !== 'ativo') return 'nenhuma';
  const base = { para: p.email, nome: primeiroNome(p.nome), consultorio: t.nome };
  if (p.userId) {
    await tx.insert(notifications).values({ tenantId: e.tenantId, patientId: e.patientId, canal: 'push', tipo: 'documento_novo', agendadaPara: e.agora });
    await enqueueEmail({ tipo: 'documento_novo', ...base, link: urlDoApp(e.appUrl, telaDoPortal('/p/documentos', e.tenantId)) }, { tenantId: e.tenantId, tx });
    await dispararEnvio(tx, e.tenantId);
    return 'portal';
  }
  const token = assinarLinkDocumento({ tenantId: e.tenantId, patientId: e.patientId, documentoId: e.documentoId, emitidoEm: e.agora, email: p.email });
  await enqueueEmail({ tipo: 'documento_link', ...base, link: urlDoLinkDocumento(e.appUrl, token) }, { tenantId: e.tenantId, tx });
  return 'link';
}

/** D6 ★: "Reenviar link por e-mail" — token novo (30 dias a partir de agora), só para assinado de paciente ativo sem conta. */
export async function reenviarLink(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; appUrl?: string; agora?: Date } = {}): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const p = await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'assinado' || p.userId || p.status !== 'ativo') throw new TransicaoInvalidaError();
    await entregarDocumento(tx, { tenantId: ctx.tenantId, patientId, documentoId: docId, agora: deps.agora ?? new Date(), appUrl: deps.appUrl ?? getEnv().APP_URL });
  }, deps.db ?? getDb());
}

/** D4 da spec: a linha de situação da entrega (painel). */
export function situacaoDaEntrega(d: ItemLista, fuso: string): string {
  const recebido = d.recibos.find((r) => r.evento === 'recebido');
  const aberto = d.recibos.find((r) => r.evento === 'aberto');
  if (recebido?.via === 'pessoalmente') return `Entregue pessoalmente em ${dataHora(recebido.em, fuso).split(' às ')[0]}`;
  if (recebido) return `Recebido pelo paciente em ${dataHora(recebido.em, fuso)}`;
  if (aberto) return `Aberto em ${dataHora(aberto.em, fuso).split(' às ')[0]} · recebimento não confirmado`;
  return d.entregueEm ? `Enviado em ${dataHora(d.entregueEm, fuso).split(' às ')[0]} · ainda não aberto` : '';
}
```

```ts
// recebimento.ts
import { and, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { signedDocumentReceipts, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import type { EventoRecibo, ViaRecibo } from './constantes';
import { DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';

/** D11: o recibo é só INSERT, uma linha por evento (ON CONFLICT DO NOTHING). true = gravou agora. */
export async function registrarRecibo(tx: Tx, r: { tenantId: string; patientId: string; documentoId: string; evento: EventoRecibo; via: ViaRecibo; registradoPor?: string | null }): Promise<boolean> {
  const g = await tx
    .insert(signedDocumentReceipts)
    .values({ tenantId: r.tenantId, patientId: r.patientId, documentoId: r.documentoId, evento: r.evento, via: r.via, registradoPor: r.registradoPor ?? null })
    .onConflictDoNothing({ target: [signedDocumentReceipts.documentoId, signedDocumentReceipts.evento] })
    .returning({ id: signedDocumentReceipts.id });
  return g.length > 0;
}

/** D3 a da spec: "Entregue pessoalmente" — recebimento registrado pela nutricionista (auditado pelo gatilho). */
export async function marcarEntreguePessoalmente(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<boolean> {
  return withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'assinado') throw new TransicaoInvalidaError();
    return registrarRecibo(tx, { tenantId: ctx.tenantId, patientId, documentoId: docId, evento: 'recebido', via: 'pessoalmente', registradoPor: ctx.actorUserId ?? null });
  }, deps.db ?? getDb());
}
```

Em `registrar-assinatura.ts` (T8), `AssinaturaAceita` ganha `appUrl: string` e o fim de `registrarAssinatura` passa a:

```ts
  // RN-152/RN-153: a entrega na mesma transação; `entregue_em` só quando houve entrega de fato (Minor da revisão de
  // cobertura): arquivado → 'nenhuma' e a lista não mostra "Enviado em …" (só "Entregue pessoalmente", se marcado)
  const via = await entregarDocumento(tx, { tenantId: a.tenantId, patientId: a.patientId, documentoId: a.documentoId, agora: a.agora, appUrl: a.appUrl });
  if (via !== 'nenhuma') await tx.update(signedDocuments).set({ entregueEm: a.agora }).where(eq(signedDocuments.id, a.documentoId));
```

(o gatilho da T2 aceita o segundo UPDATE: em "assinado", `entregue_em` sai de nulo uma vez). Import novo: `import { entregarDocumento } from './entrega';` — `entrega.ts` não puxa sessão (a guarda de grafo da T8 confere). Em `digitalizada-job.ts` (T9), a chamada de `registrarAssinatura` ganha `appUrl: deps.appUrl`; as chamadas diretas dos testes (`registrar-assinatura.test.ts`, `digitalizada-job.test.ts`) ganham `appUrl: 'https://x'`. O envio do PDF assinado do Plano 10B passa o `appUrl` dele (`DepsAssinar.appUrl`, padrão `getEnv().APP_URL`).

- [ ] **Step 4: Textos do e-mail e do push**

`src/email/types.ts`:

```ts
  /** US-145 / RN-152: documento novo no portal; sem tipo de documento, item ou produto. `nome` = primeiro nome. */
  | { tipo: 'documento_novo'; para: string; nome: string; consultorio: string; link: string }
  /** RN-158 / D3 b: paciente sem conta — o link de uso único (pede um código no e-mail para abrir). */
  | { tipo: 'documento_link'; para: string; nome: string; consultorio: string; link: string }
```

`src/email/templates.tsx`:

```tsx
    case 'documento_novo':
    case 'documento_link': {
      const subject = 'Você tem um novo documento';
      const linhas =
        msg.tipo === 'documento_novo'
          ? [`Olá, ${msg.nome}. ${msg.consultorio} disponibilizou um novo documento para você. Para ver, entre no app: ${msg.link}`]
          : [`Olá, ${msg.nome}. ${msg.consultorio} disponibilizou um novo documento para você.`, 'Para abrir, use o link abaixo. Vamos enviar um código de 6 dígitos para este e-mail. O link vale por 30 dias.'];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => <P key={l}>{l}</P>)}
            <Botao href={msg.link}>{msg.tipo === 'documento_novo' ? 'Ver meus documentos' : 'Abrir documento'}</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
```

`src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL`): `documento_novo: { corpo: 'Você tem um novo documento.', tela: '/p/documentos' }`.

- [ ] **Step 5: Tela da entrega** — `entrega.tsx` + a ação

Em `.../documentos/actions.ts`:

```ts
// como as ações de botão da T6: o erro volta ao formulário (AcaoDocumento) e "Link reenviado." só sai quando deu certo
export async function entreguePessoalmenteAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await marcarEntreguePessoalmente(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

export async function reenviarLinkAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await reenviarLink(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  redirect(`${caminho(patientId, docId)}?link=1`);
}
```

Em `actions.test.ts` (T6), o import passa a trazer também `entreguePessoalmenteAction` e `reenviarLinkAction`, e entra o caso (o mock de `../actions` do `page.test.ts` da T6 ganha as duas):

```ts
  it('"Reenviar link" e "Entregue pessoalmente" fora do estado: o motivo, sem "Link reenviado." nem revalidar; no estado certo, o sinal', async () => {
    const { N, p } = await consultorio(); // paciente ativo, sem conta, com e-mail
    const rascunho = await documentoNoBanco(db, N.ctx, p.id);
    expect(await reenviarLinkAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(await entreguePessoalmenteAction(p.id, rascunho.id, {})).toEqual(MUDOU);
    expect(revalidatePath).not.toHaveBeenCalled();
    const assinado = await documentoNoBanco(db, N.ctx, p.id, { status: 'assinado' });
    await expect(reenviarLinkAction(p.id, assinado.id, {})).rejects.toThrow(`redirect /painel/pacientes/${p.id}/documentos/${assinado.id}?link=1`);
    expect(await entreguePessoalmenteAction(p.id, assinado.id, {})).toEqual({ ok: true });
  });
```

`entrega.tsx` (componente de servidor, dentro do cartão "Documento assinado", só com o documento não anonimizado):

```tsx
import { Aviso } from '@/components/ui/aviso';
import { MSG_ENTREGA, situacaoDaEntrega } from '@/modules/documentos/entrega';
import type { DocumentoLido } from '@/modules/documentos/documentos';
import { entreguePessoalmenteAction, reenviarLinkAction } from '../actions';
import { AcaoDocumento } from './acao-documento';

export function Entrega({ d, paciente, fuso, linkReenviado }: { d: DocumentoLido; paciente: { id: string; userId: string | null; status: string; email: string | null }; fuso: string; linkReenviado: boolean }) {
  const recebido = d.recibos.some((r) => r.evento === 'recebido');
  return (
    <section aria-labelledby="entrega" className="space-y-2" data-guia="entrega-documento">
      <h3 id="entrega" className="font-semibold">Entrega</h3>
      <p>{situacaoDaEntrega(d, fuso)}</p>
      {paciente.status === 'arquivado' && <Aviso tipo="aviso">{MSG_ENTREGA.arquivado}</Aviso>}
      {paciente.status === 'ativo' && !paciente.userId && <Aviso tipo="aviso">{MSG_ENTREGA.semPortal}</Aviso>}
      {linkReenviado && <Aviso tipo="ok" papel="status">{MSG_ENTREGA.linkReenviado}</Aviso>}
      {d.status === 'assinado' && !recebido && (
        <AcaoDocumento acao={entreguePessoalmenteAction.bind(null, paciente.id, d.id)} rotulo="Entregue pessoalmente" confirmar="Marcar como entregue pessoalmente?" />
      )}
      {d.status === 'assinado' && paciente.status === 'ativo' && !paciente.userId && paciente.email && (
        <AcaoDocumento acao={reenviarLinkAction.bind(null, paciente.id, d.id)} rotulo="Reenviar link por e-mail" confirmar="Reenviar o link do documento para o e-mail do paciente?" />
      )}
    </section>
  );
}
```

Na lista (T6), a coluna "Situação" passa a mostrar `situacaoDaEntrega(d, tenant.fuso)` para os assinados (no lugar do "Assinado em …").

- [ ] **Step 6: Rodar e commit**

Run: `pnpm test src/modules/documentos src/db/sem-conta-guarda.test.ts src/email src/modules/notificacoes 'src/app/painel/pacientes/[id]/documentos'` → PASS.

```bash
git add src/modules/documentos/{entrega,entrega.test,recebimento,link-documento,registrar-assinatura,registrar-assinatura.test,digitalizada-job,digitalizada-job.test}.ts* src/app/painel/pacientes/[id]/documentos src/email src/modules/notificacoes/mensagens.ts src/db/tenant.ts
git commit -m "feat(documentos): entrega pelo portal ou por link de uso único, entregue pessoalmente e situação da entrega (US-145, RN-152, RN-153)"
```

---
### Task 11: Portal — "Documentos", abrir o PDF e "Confirmo que recebi este documento" (US-146, D4 da spec, D5 ★; P10A-11; antiga T13)

> **Minors da revisão de cobertura aplicados:** o link visível é "Abrir PDF" (texto da spec), com o resto do nome acessível só para leitor de tela; o "fora da cópia offline" (US-146) ganha teste em `sw-regras.test.ts`.

**Files:**
- Create: `src/modules/documentos/portal.ts` (+ `portal.test.ts`), `src/app/p/(portal)/documentos/page.tsx`, `src/app/p/(portal)/documentos/actions.ts`, `src/app/api/p/documentos/[id]/pdf/route.ts`
- Modify: `src/app/p/navegacao.ts` (`tambem` de "Perfil"), `src/app/p/(portal)/inicio/page.tsx` (cartão), `src/app/p/(portal)/perfil/page.tsx` (link), `src/app/sw-regras.test.ts` (fora da cópia offline)

**Interfaces:**
- Consumes: `registrarRecibo` (T10); `auditRead`; `EMITIDOS`; `TIPO_DOCUMENTO_ROTULO`; `requirePaciente`/`requireApiPaciente`; `signFileUrl`.
- Produces: `documentosDoPaciente(ctx, db?): Promise<DocumentoNoPortal[]>` (sem `auditRead`), `DocumentoNoPortal = { id; titulo: 'Receita'; data: Date; status: 'assinado' | 'substituido' | 'cancelado'; assinaturaTipo: TipoAssinatura; aberto: boolean; recebidoEm: Date | null }` (a tela mostra `linhaDaAssinatura`, RN-157); `novosNoPortal(ctx, db?): Promise<number>`; `caminhoDoPdfNoPortal(ctx, docId, db?): Promise<string | null>` (`auditRead` + evento `aberto`); `confirmarRecebimentoNoPortal(ctx, docId, db?): Promise<Date | null>`; `MSG_PORTAL_DOC`. Todas conferem o interruptor do admin (D20, `tenants.documentos_liberados`) junto com a situação do paciente: desligado, a lista vem vazia, nada é contado, nenhum PDF abre e nenhum recibo é gravado (correção do `/code-review high` do PR #18); a página e a rota do PDF também conferem.

- [ ] **Step 1: Teste (falha)** — `src/modules/documentos/portal.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { linhaDaAssinatura } from './constantes';
import { caminhoDoPdfNoPortal, confirmarRecebimentoNoPortal, documentosDoPaciente, novosNoPortal } from './portal';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
/** D20 ligado (o novoTenant nasce desligado, como em produção). */
const consultorioLiberado = async () => {
  const T = await novoTenant(app.db);
  await liberarDocumentos(app.db, T.tenantId);
  return T;
};

describe('documentos no portal (US-146)', () => {
  it('só os emitidos do próprio paciente, do mais novo para o mais antigo; a lista não audita', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    await documentoNoBanco(app.db, T.ctx, p.id);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const c = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await documentoNoBanco(app.db, T.ctx, outro.id, { status: 'assinado' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const lista = await documentosDoPaciente(ctx, app.db);
    expect(lista.map((d) => d.id).sort()).toEqual([a.id, c.id].sort());
    // D17 / regra 8 do CLAUDE.md: a lista não audita porque não devolve conteúdo — só estas chaves
    expect(Object.keys(lista[0]).sort()).toEqual(['aberto', 'assinaturaTipo', 'data', 'id', 'recebidoEm', 'status', 'titulo']);
    expect(await novosNoPortal(ctx, app.db)).toBe(1); // o assinado ainda não aberto (o cancelado não conta)
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows).toEqual([]);
  });

  it('D20: com o interruptor do admin desligado, o portal não mostra nem entrega nada (lista vazia, 0 novos, sem PDF, sem recibo)', async () => {
    const T = await novoTenant(app.db); // documentos_liberados = false (padrão)
    const p = await novoPaciente(app.db, T.ctx);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await documentosDoPaciente(ctx, app.db)).toEqual([]);
    expect(await novosNoPortal(ctx, app.db)).toBe(0);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBeNull();
    expect(await confirmarRecebimentoNoPortal(ctx, a.id, app.db)).toBeNull();
    const recibos = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from signed_document_receipts where documento_id = ${a.id}`), app.db);
    expect(recibos.rows).toEqual([]);
  });

  it('RN-157: a digitalizada aparece como "Assinatura: Digitalizado" (o Plano 10B acrescenta o caso do gov.br)', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const dig = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', assinaturaTipo: 'digitalizada' });
    const lista = await documentosDoPaciente(ctxPaciente(T.tenantId, p.id), app.db);
    expect(linhaDaAssinatura(lista.find((d) => d.id === dig.id)!.assinaturaTipo)).toBe('Assinatura: Digitalizado');
  });

  it('abrir o PDF audita e grava "aberto" uma vez; confirmar grava "recebido" uma vez; cancelado não confirma; rascunho dá 404', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const c = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    const r = await documentoNoBanco(app.db, T.ctx, p.id);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBe(a.pdfPath);
    expect(await caminhoDoPdfNoPortal(ctx, a.id, app.db)).toBe(a.pdfPath);
    expect(await caminhoDoPdfNoPortal(ctx, r.id, app.db)).toBeNull();
    const recibos = await withTenant(T.ctx, (tx) => tx.execute(sql`select evento, via from signed_document_receipts where documento_id = ${a.id}`), app.db);
    expect(recibos.rows).toEqual([{ evento: 'aberto', via: 'portal' }]);
    const em = await confirmarRecebimentoNoPortal(ctx, a.id, app.db);
    expect(em).toBeInstanceOf(Date);
    expect(await confirmarRecebimentoNoPortal(ctx, a.id, app.db)).toEqual(em); // a mesma data, sem linha nova
    expect(await confirmarRecebimentoNoPortal(ctx, c.id, app.db)).toBeNull();
  });
});
```

Run: `pnpm test src/modules/documentos/portal.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/documentos/portal.ts`

```ts
import { and, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, signedDocumentReceipts, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import type { TipoAssinatura } from './constantes';
import { registrarRecibo } from './recebimento';

/** US-146 (texto exato da spec v0.3). */
export const MSG_PORTAL_DOC = {
  vazio: 'Você ainda não tem documentos.',
  substituido: 'Substituído por uma versão mais nova.',
  cancelado: 'Cancelado pela nutricionista. Não use este documento.',
  confirmar: 'Confirmo que recebi este documento',
} as const;

export type DocumentoNoPortal = { id: string; titulo: 'Receita'; data: Date; status: 'assinado' | 'substituido' | 'cancelado'; assinaturaTipo: TipoAssinatura; aberto: boolean; recebidoEm: Date | null };

/**
 * RN-153: bloqueado ou anonimizado não vê mais nada (o prontuário fica só para a nutricionista). D20: com o interruptor
 * do admin desligado (`documentos_liberados`), o portal também não mostra nem entrega documento — a regra vale dos dois
 * lados, não só na aba da nutricionista (correção do /code-review high do PR #18).
 */
async function ativo(tx: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: TenantContext): Promise<boolean> {
  const [t] = await tx.select({ liberado: tenants.documentosLiberados }).from(tenants).where(eq(tenants.id, ctx.tenantId));
  if (!t?.liberado) return false;
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ctx.patientId!));
  return !!p && p.status !== 'bloqueado' && !p.anonimizadoEm;
}

/**
 * A lista (título, data, situação) não chama auditRead, como a agenda (D17; exceção na regra 8 do CLAUDE.md): só as chaves
 * de DocumentoNoPortal, nunca itens ou orientações (teste das chaves em portal.test.ts). A RLS (paciente_so_emitidos) já filtra.
 */
export async function documentosDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<DocumentoNoPortal[]> {
  return withTenant(ctx, async (tx) => {
    if (!(await ativo(tx, ctx))) return [];
    const ds = await tx
      .select({ id: signedDocuments.id, status: signedDocuments.status, assinadoEm: signedDocuments.assinadoEm, assinaturaTipo: signedDocuments.assinaturaTipo })
      .from(signedDocuments)
      .where(sql`${signedDocuments.anonimizadoEm} is null`)
      .orderBy(desc(signedDocuments.assinadoEm));
    const rs = ds.length ? await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ds.map((d) => d.id))) : [];
    return ds.map((d) => ({
      id: d.id, titulo: 'Receita' as const, data: d.assinadoEm!, status: d.status as DocumentoNoPortal['status'], assinaturaTipo: d.assinaturaTipo as TipoAssinatura,
      aberto: rs.some((r) => r.documentoId === d.id && r.evento === 'aberto'), recebidoEm: rs.find((r) => r.documentoId === d.id && r.evento === 'recebido')?.em ?? null,
    }));
  }, db);
}

/** O número do cartão do Início: assinados ainda não abertos. */
export async function novosNoPortal(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  return withTenant(ctx, async (tx) => {
    if (!(await ativo(tx, ctx))) return 0;
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(signedDocuments)
      .where(and(eq(signedDocuments.status, 'assinado'), notExists(tx.select({ x: sql`1` }).from(signedDocumentReceipts).where(and(eq(signedDocumentReceipts.documentoId, signedDocuments.id), eq(signedDocumentReceipts.evento, 'aberto'))))));
    return r?.n ?? 0;
  }, db);
}

/** "Abrir PDF": dado de saúde → auditRead; grava o evento "aberto" (uma vez). A URL assinada nasce na rota (303). */
export async function caminhoDoPdfNoPortal(ctx: TenantContext, docId: string, db: Db = getDb()): Promise<string | null> {
  if (!idValido(docId)) return null;
  return withTenant(ctx, async (tx) => {
    if (!(await ativo(tx, ctx))) return null;
    const [d] = await tx.select({ pdf: signedDocuments.pdfPath, status: signedDocuments.status }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (!d?.pdf) return null;
    await auditRead(tx, { entidade: 'documentos', entidadeId: docId, patientId: ctx.patientId! });
    if (d.status === 'assinado') await registrarRecibo(tx, { tenantId: ctx.tenantId, patientId: ctx.patientId!, documentoId: docId, evento: 'aberto', via: 'portal' });
    return d.pdf;
  }, db);
}

/** D4: o botão. Só documento assinado (a política paciente_recibo_proprio confere no banco); devolve a data do recebimento. */
export async function confirmarRecebimentoNoPortal(ctx: TenantContext, docId: string, db: Db = getDb()): Promise<Date | null> {
  if (!idValido(docId)) return null;
  return withTenant(ctx, async (tx) => {
    if (!(await ativo(tx, ctx))) return null;
    const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (d?.status !== 'assinado') return null;
    await registrarRecibo(tx, { tenantId: ctx.tenantId, patientId: ctx.patientId!, documentoId: docId, evento: 'recebido', via: 'portal' });
    const [r] = await tx.select({ em: signedDocumentReceipts.em }).from(signedDocumentReceipts).where(and(eq(signedDocumentReceipts.documentoId, docId), eq(signedDocumentReceipts.evento, 'recebido')));
    return r?.em ?? null;
  }, db);
}
```

Run: `pnpm test src/modules/documentos/portal.test.ts` → PASS.

- [ ] **Step 3: Rota do PDF e a tela**

`src/app/api/p/documentos/[id]/pdf/route.ts`:

```ts
import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdfNoPortal } from '@/modules/documentos/portal';

export const dynamic = 'force-dynamic';

/** US-146: a URL assinada (5 min) nasce no clique, nunca no HTML guardado (como /api/p/plano/pdf). D20: desligado, 404 (o módulo confere de novo). */
export async function GET(req: Request, { params }: RouteContext<'/api/p/documentos/[id]/pdf'>) {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const { id } = await params;
  const caminho = await caminhoDoPdfNoPortal(acesso.ctx, id);
  if (!caminho) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), 'cache-control': 'no-store' } });
}
```

`src/app/p/(portal)/documentos/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { confirmarRecebimentoNoPortal } from '@/modules/documentos/portal';

export async function confirmarRecebimentoAction(docId: string): Promise<void> {
  const { ctx } = await requirePaciente('/p/documentos');
  await confirmarRecebimentoNoPortal(ctx, docId);
  revalidatePath('/p/documentos');
}
```

`src/app/p/(portal)/documentos/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { linhaDaAssinatura } from '@/modules/documentos/constantes';
import { documentosDoPaciente, MSG_PORTAL_DOC } from '@/modules/documentos/portal';
import { confirmarRecebimentoAction } from './actions';

export const dynamic = 'force-dynamic';

/** US-146 / D5 ★: chega pelo cartão do Início e pelo link em Perfil; marca a aba "Perfil". Fora da cópia offline. D20: desligado, 404. */
export default async function MeusDocumentos() {
  const { ctx, tenant } = await requirePaciente('/p/documentos');
  if (!tenant.documentosLiberados) notFound();
  const lista = await documentosDoPaciente(ctx);
  const data = (d: Date) => formatarData(hojeNoFuso(tenant.fuso, d));
  return (
    <main className="space-y-6 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Documentos</h1>
      {lista.length === 0 && <p>{MSG_PORTAL_DOC.vazio}</p>}
      <ul className="space-y-4">
        {lista.map((d) => (
          <li key={d.id} className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
            <h2 className="font-semibold">{`${d.titulo} · ${data(d.data)}`}</h2>
            <p className="text-sm text-suave">{linhaDaAssinatura(d.assinaturaTipo)}</p>
            {d.status === 'substituido' && <p>{MSG_PORTAL_DOC.substituido}</p>}
            {d.status === 'cancelado' && <p role="note" className="font-semibold">{MSG_PORTAL_DOC.cancelado}</p>}
            {/* texto da spec ("Abrir PDF"); o complemento só para leitor de tela distingue os links da lista */}
            <a href={`/api/p/documentos/${d.id}/pdf`} className="inline-flex min-h-11 items-center underline">
              Abrir PDF<span className="sr-only">{` da ${d.titulo.toLowerCase()} de ${data(d.data)}`}</span>
            </a>
            {d.status === 'assinado' && (d.recebidoEm ? (
              <p role="status">{`Recebimento confirmado em ${data(d.recebidoEm)}.`}</p>
            ) : (
              <form action={confirmarRecebimentoAction.bind(null, d.id)}>
                <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-current px-5 font-semibold">{MSG_PORTAL_DOC.confirmar}</button>
              </form>
            ))}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`src/app/p/navegacao.ts`: `{ href: '/p/perfil', rotulo: 'Perfil', tambem: ['/p/documentos'] }` (e o teste de `navegacao.test.ts` ganha `expect(itemAtual('/p/documentos')).toBe('/p/perfil')`). Em Perfil, antes de "Notificações" e só com `tenant.documentosLiberados` (D20): `<p><Link href="/p/documentos" className="inline-flex min-h-11 items-center underline">Meus documentos</Link></p>`. No Início, com `novosNoPortal(ctx) > 0` (consulta só com `tenant.documentosLiberados`): um cartão "Documentos" com "1 documento novo" / "{n} documentos novos" e o link "Ver documentos".

Em `src/app/sw-regras.test.ts`, o caso novo (US-146: "Documentos" fica fora da cópia offline; o service worker não muda):

```ts
  it('US-146 (Plano 10A): /p/documentos nunca é a página guardada nem é gravada no cache do plano', () => {
    const o = 'https://app.exemplo.com';
    expect(ehPaginaDoPlano(new URL('/p/documentos', o), 'navigate', o)).toBe(false);
    expect(podeGuardarPlano({ status: 200, type: 'basic', redirected: false, url: `${o}/p/documentos`, headers: new Headers({ 'content-type': 'text/html' }) }, o)).toBe(false);
  });
```

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos/portal.test.ts src/app/p src/app/sw-regras.test.ts` → PASS.

```bash
git add src/modules/documentos/{portal,portal.test}.ts src/app/p src/app/api/p/documentos src/app/sw-regras.test.ts
git commit -m "feat(portal): Documentos — lista, abrir o PDF e confirmar o recebimento (US-146, D4)"
```

---
### Task 12: Link de uso único — código de 6 dígitos, sessão curta, a página `/documento/[token]` e a limpeza diária dos códigos (RN-158, D3 b da spec, D6 ★, D12; P10A-12; antiga T14)

> **Minor da revisão de cobertura aplicado:** a §10 da spec pede a "limpeza diária dos vencidos" de `document_access_codes`, e só a anonimização apagava códigos e sessões. `limparCodigosDeDocumentoVencidos` roda na `agenda-limpeza` (todo dia às 04:30, `src/worker/index.ts`). As regras de UPDATE da tabela (tentativas só sobem, sessão nasce uma vez) estão no gatilho da T2.

**Files:**
- Modify: `src/modules/documentos/link-documento.ts` (código, sessão e limpeza) (+ `link-documento.test.ts`), `src/email/{types.ts,templates.tsx}` (`codigo_documento`), `next.config.ts`, `src/lib/sentry-filtro.ts` (+ teste), `src/worker/index.ts` (`agenda-limpeza`)
- Create: `src/app/documento/[token]/page.tsx`, `src/app/documento/[token]/codigo-form.tsx`, `src/app/api/documento/[token]/codigo/route.ts`, `.../confirmar/route.ts`, `.../recebido/route.ts`, `.../pdf/route.ts`

**Interfaces:**
- Consumes: token da T10; `documentAccessCodes`, `signedDocuments`, `patients`, `tenants` (status); `registrarRecibo`; `auditRead`; `consumirLimite`/`chaveDoLimite('documento-ip' | 'documento-envio' | 'documento-codigo-ip')`; `verifyTurnstile` (via `depsDaRequisicao` do `/api/n/[slug]/resposta.ts`, reaproveitado); `enqueueEmail`; `randomInt`, `createHmac`.
- Produces: `estadoDoLink(token, deps): Promise<EstadoLink>` (`{ tipo: 'invalido' | 'expirado' | 'indisponivel' } | { tipo: 'pedir_codigo' } | { tipo: 'aberto'; titulo; data: Date; recebidoEm: Date | null }` — com `sessao` opcional), `pedirCodigoDocumento(token, input: { turnstile?: unknown }, deps): Promise<void>`, `confirmarCodigoDocumento(token, input: { codigo?: unknown }, deps): Promise<{ sessao: string; expira: Date }>`, `pdfDoLink(token, sessao, deps): Promise<string | null>`, `confirmarRecebimentoPeloLink(token, sessao, deps): Promise<Date | null>`; `LinkError { status: number; mensagem: string }`; `MSG_LINK`; `NOME_COOKIE_LINK = 'nd_doc'`; `limparCodigosDeDocumentoVencidos(db: Db, agora: Date, o?: { tenantId?: string }): Promise<number>` (`o.tenantId` só nos testes, como as varreduras da T7); o link só é utilizável com o interruptor do admin ligado (D20: desligado, "indisponível" e nenhum código enviado); `DepsLink = { db?; agora?; ip: string | null; ipDoLimite: string | null; verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>; appUrl: string }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/link-documento.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { assinarLinkDocumento, confirmarCodigoDocumento, confirmarRecebimentoPeloLink, estadoDoLink, limparCodigosDeDocumentoVencidos, LinkError, MSG_LINK, pdfDoLink, pedirCodigoDocumento } from './link-documento';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});
let ip = 0;
const deps = (agora = new Date()) => ({ db: app.db, agora, ip: `198.51.100.${++ip % 250}`, ipDoLimite: `198.51.100.${ip % 250}`, verificarTurnstile: async () => 'ok' as const, appUrl: 'https://x' });

/** `liberado`: o interruptor do admin (D20); o novoTenant nasce desligado, como em produção. */
async function cenario(o: { liberado?: boolean } = {}) {
  const T = await novoTenant(app.db);
  if (o.liberado !== false) await liberarDocumentos(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
  const token = assinarLinkDocumento({ tenantId: T.tenantId, patientId: p.id, documentoId: d.id, emitidoEm: new Date(), email: p.email });
  return { T, p, d, token };
}
const ultimoCodigo = async (email: string) => (await emailsNaFila('codigo_documento', email)).at(-1)!.codigo;

describe('link de uso único (RN-158, Review Focus 4)', () => {
  it('o GET (estado) não consome nada; pedir código manda o e-mail; o código abre UMA vez e cria a sessão', async () => {
    const x = await cenario();
    expect(await estadoDoLink(x.token, undefined, deps())).toEqual({ tipo: 'pedir_codigo' });
    expect(await estadoDoLink(x.token, undefined, deps())).toEqual({ tipo: 'pedir_codigo' });
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const codigo = await ultimoCodigo(x.p.email);
    const { sessao } = await confirmarCodigoDocumento(x.token, { codigo }, deps());
    expect(await estadoDoLink(x.token, sessao, deps())).toMatchObject({ tipo: 'aberto' });
    await expect(confirmarCodigoDocumento(x.token, { codigo }, deps())).rejects.toBeInstanceOf(LinkError); // o mesmo código de novo
    expect(await pdfDoLink(x.token, sessao, deps())).toBe(x.d.pdfPath);
    const r = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select evento, via from signed_document_receipts where documento_id = ${x.d.id}`), app.db);
    expect(r.rows).toEqual([{ evento: 'aberto', via: 'link_email' }]);
  });

  it('limites: 1 código por minuto e 5 por hora por documento; 5 erros invalidam o código', async () => {
    const x = await cenario();
    const t0 = new Date();
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(t0));
    await expect(pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(new Date(t0.getTime() + 10_000)))).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.aguarde);
    for (let i = 1; i <= 4; i++) await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(new Date(t0.getTime() + i * 61_000)));
    await expect(pedirCodigoDocumento(x.token, { turnstile: 't' }, deps(new Date(t0.getTime() + 5 * 61_000)))).rejects.toBeInstanceOf(LinkError);
    const y = await cenario();
    await pedirCodigoDocumento(y.token, { turnstile: 't' }, deps());
    const certo = await ultimoCodigo(y.p.email);
    for (let i = 0; i < 5; i++) await expect(confirmarCodigoDocumento(y.token, { codigo: certo === '000000' ? '111111' : '000000' }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.codigoInvalido);
    // o incremento sobreviveu aos erros (nada de rollback junto com o LinkError)
    const t = await withTenant(y.T.ctx, (tx) => tx.execute(sql`select tentativas from document_access_codes where documento_id = ${y.d.id}`), app.db);
    expect(t.rows).toEqual([{ tentativas: 5 }]);
    await expect(confirmarCodigoDocumento(y.token, { codigo: certo }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.codigoVencido);
  });

  it('a confirmação também tem limite por IP: a 31ª tentativa na hora, do mesmo IP, é recusada', async () => {
    const x = await cenario();
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const mesmoIp = (agora = new Date()) => ({ ...deps(agora), ipDoLimite: '203.0.113.77' });
    for (let i = 0; i < 30; i++) await expect(confirmarCodigoDocumento(x.token, { codigo: 'abc' }, mesmoIp())).rejects.toBeInstanceOf(LinkError);
    await expect(confirmarCodigoDocumento(x.token, { codigo: await ultimoCodigo(x.p.email) }, mesmoIp())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.limite);
  });

  it('e-mail corrigido, documento cancelado, paciente bloqueado, link de 31 dias → indisponível/expirado; a sessão de um link não abre outro', async () => {
    const x = await cenario();
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update patients set email = 'novo@ex.com' where id = ${x.p.id}`), app.db);
    expect((await estadoDoLink(x.token, undefined, deps())).tipo).toBe('invalido');
    const y = await cenario();
    await withTenant(y.T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${y.d.id}`), app.db);
    expect((await estadoDoLink(y.token, undefined, deps())).tipo).toBe('indisponivel');
    const z = await cenario();
    expect((await estadoDoLink(z.token, undefined, deps(new Date(Date.now() + 31 * 86_400_000)))).tipo).toBe('expirado');
    const w = await cenario();
    await pedirCodigoDocumento(w.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(w.token, { codigo: await ultimoCodigo(w.p.email) }, deps());
    expect(await pdfDoLink(z.token, sessao, deps())).toBeNull();
  });

  it('D20: com o interruptor do admin desligado, o link fica indisponível, nenhum código é enviado e a sessão aberta antes deixa de abrir o PDF', async () => {
    const x = await cenario({ liberado: false });
    expect((await estadoDoLink(x.token, undefined, deps())).tipo).toBe('indisponivel');
    await expect(pedirCodigoDocumento(x.token, { turnstile: 't' }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.invalido);
    expect(await emailsNaFila('codigo_documento', x.p.email)).toEqual([]);
    const y = await cenario();
    await pedirCodigoDocumento(y.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(y.token, { codigo: await ultimoCodigo(y.p.email) }, deps());
    await app.db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, y.T.tenantId)); // o admin desliga
    expect(await pdfDoLink(y.token, sessao, deps())).toBeNull();
    expect(await confirmarRecebimentoPeloLink(y.token, sessao, deps())).toBeNull();
    const r = await withTenant(y.T.ctx, (tx) => tx.execute(sql`select 1 from signed_document_receipts where documento_id = ${y.d.id}`), app.db);
    expect(r.rows).toEqual([]);
  });

  it('limpeza diária: código vencido há mais de 1 dia (e sem sessão viva) sai; o da sessão em uso fica', async () => {
    const x = await cenario();
    const q = (s: ReturnType<typeof sql>) => withTenant(x.T.ctx, (tx) => tx.execute(s), app.db);
    await q(sql`insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em, created_at) values (${x.T.tenantId}, ${x.p.id}, ${x.d.id}, 'velho', now() - interval '2 days', now() - interval '2 days')`);
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(x.token, { codigo: await ultimoCodigo(x.p.email) }, deps());
    expect(await limparCodigosDeDocumentoVencidos(app.db, new Date(), { tenantId: x.T.tenantId })).toBe(1); // só o tenant do teste (banco compartilhado)
    const restam = await q(sql`select codigo_hash from document_access_codes where documento_id = ${x.d.id}`);
    expect(restam.rows.map((r) => r.codigo_hash)).not.toContain('velho');
    expect(await pdfDoLink(x.token, sessao, deps())).toBe(x.d.pdfPath); // a sessão em uso continua valendo
  });
});
```

Run: `pnpm test src/modules/documentos/link-documento.test.ts` → FAIL.

- [ ] **Step 2: Código e sessão** — acrescentar a `src/modules/documentos/link-documento.ts`

```ts
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { documentAccessCodes, patients, signedDocumentReceipts, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { safeEqual, sha256 } from '@/lib/crypto';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { logger } from '@/lib/logger';
import { auditRead } from '@/modules/plataforma/audit';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { registrarRecibo } from './recebimento';

/** RN-158 (textos novos deste plano, tabela de desvios). */
export const MSG_LINK = {
  invalido: 'Este documento não está mais disponível. Fale com sua nutricionista.',
  expirado: 'Este link expirou. Peça um novo à sua nutricionista.',
  aguarde: 'Aguarde 1 minuto para pedir outro código.',
  limite: 'Muitas tentativas. Tente de novo em alguns minutos.',
  codigoInvalido: 'Código inválido.',
  codigoVencido: 'Código vencido. Peça outro.',
  turnstile: 'Confirme que você não é um robô.',
  turnstileFora: 'Tente novamente em alguns minutos',
} as const;
export const NOME_COOKIE_LINK = 'nd_doc';
const CODIGO_VALIDADE_MS = 10 * 60_000;
const SESSAO_MS = 15 * 60_000;
const MAX_ERROS = 5;
const INTERVALO_MS = 60_000;
const POR_HORA_DOCUMENTO = 5;
const POR_HORA_IP = 20;
const CONFIRMACOES_POR_HORA_IP = 30;

export class LinkError extends Error {
  override name = 'LinkError';
  constructor(readonly status: number, readonly mensagem: string) {
    super(mensagem);
  }
}
export type DepsLink = { db?: Db; agora?: Date; ip: string | null; ipDoLimite: string | null; verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>; appUrl: string };
export type EstadoLink = { tipo: 'invalido' | 'expirado' | 'indisponivel' } | { tipo: 'pedir_codigo' } | { tipo: 'aberto'; titulo: 'Receita'; data: Date; recebidoEm: Date | null };

const hashDoCodigo = (pedido: string, codigo: string) => createHmac('sha256', chaveDoLinkDocumento()).update(`codigo:${pedido}:${codigo}`).digest('base64url');
const ctxDo = (ids: IdsDoLink, ip: string | null): TenantContext => ({ tenantId: ids.tenantId, role: 'paciente', patientId: ids.patientId, semConta: true, ip });

/** Lê o token no contexto do paciente SEM LOGIN (a RLS limita ao paciente do token e aos emitidos) e confere tudo. */
async function abrirLink(token: unknown, deps: DepsLink) {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  return lerLinkDocumento(token, agora, async (ids) => {
    try {
      return await withTenant(ctxDo(ids, deps.ip), async (tx) => {
        const [t] = await tx.select({ status: tenants.status, liberado: tenants.documentosLiberados }).from(tenants).where(eq(tenants.id, ids.tenantId));
        const [p] = await tx.select({ email: patients.email, status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ids.patientId));
        const [d] = await tx.select({ status: signedDocuments.status, assinadoEm: signedDocuments.assinadoEm, pdf: signedDocuments.pdfPath }).from(signedDocuments).where(eq(signedDocuments.id, ids.documentoId));
        if (!p) return null;
        // D20 (correção do /code-review high do PR #18): o interruptor do admin vale também aqui — desligado, o link fica
        // indisponível, nenhum código é enviado (linkUtilizavel) e a sessão já aberta não abre o PDF nem confirma
        const disponivel = t?.status === 'ativa' && !!t.liberado && p.status === 'ativo' && !p.anonimizadoEm && d?.status === 'assinado' && !!d.pdf;
        return { email: p.email, disponivel, assinadoEm: d?.assinadoEm ?? null, pdf: d?.pdf ?? null };
      }, db);
    } catch {
      return null;
    }
  });
}

async function sessaoValida(ids: IdsDoLink, sessao: string | undefined, deps: DepsLink): Promise<boolean> {
  if (!sessao || !/^[A-Za-z0-9_-]{43}$/.test(sessao)) return false;
  const agora = deps.agora ?? new Date();
  return withTenant(ctxDo(ids, deps.ip), async (tx) => {
    const [c] = await tx.select({ id: documentAccessCodes.id }).from(documentAccessCodes)
      .where(and(eq(documentAccessCodes.documentoId, ids.documentoId), eq(documentAccessCodes.sessaoHash, sha256(sessao)), gt(documentAccessCodes.sessaoExpiraEm, agora)));
    return !!c;
  }, deps.db ?? getDb());
}

/** A página: GET não consome nada (leitores de link dos provedores de e-mail fazem GET). */
export async function estadoDoLink(token: unknown, sessao: string | undefined, deps: DepsLink): Promise<EstadoLink> {
  const l = await abrirLink(token, deps);
  if (!l) return { tipo: 'invalido' };
  if (!l.dados.disponivel) return { tipo: 'indisponivel' };
  if (l.expirado) return { tipo: 'expirado' };
  if (!(await sessaoValida(l.ids, sessao, deps))) return { tipo: 'pedir_codigo' };
  const recebido = await withTenant(ctxDo(l.ids, deps.ip), async (tx) => (await tx.select({ em: signedDocumentReceipts.em }).from(signedDocumentReceipts).where(and(eq(signedDocumentReceipts.documentoId, l.ids.documentoId), eq(signedDocumentReceipts.evento, 'recebido'))))[0]?.em ?? null, deps.db ?? getDb());
  return { tipo: 'aberto', titulo: 'Receita', data: l.dados.assinadoEm!, recebidoEm: recebido };
}

async function linkUtilizavel(token: unknown, deps: DepsLink) {
  const l = await abrirLink(token, deps);
  if (!l || !l.dados.disponivel) throw new LinkError(410, MSG_LINK.invalido);
  if (l.expirado) throw new LinkError(410, MSG_LINK.expirado);
  return l;
}

/** Turnstile → limite por IP → 1/min e 5/h por documento → código novo (HMAC amarrado ao pedido) → e-mail. */
export async function pedirCodigoDocumento(token: unknown, input: { turnstile?: unknown }, deps: DepsLink): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const ts = await deps.verificarTurnstile(typeof input.turnstile === 'string' ? input.turnstile : null);
  if (ts === 'indisponivel') throw new LinkError(503, MSG_LINK.turnstileFora);
  if (ts !== 'ok') throw new LinkError(403, MSG_LINK.turnstile);
  if (!(await consumirLimite(db, chaveDoLimite('documento-ip', deps.ipDoLimite ?? 'sem-ip'), POR_HORA_IP, 3600, agora))) throw new LinkError(429, MSG_LINK.limite);
  const l = await linkUtilizavel(token, deps);
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await withTenant(ctxDo(l.ids, deps.ip), async (tx) => {
    const [ultimo] = await tx.select({ em: documentAccessCodes.createdAt }).from(documentAccessCodes).where(eq(documentAccessCodes.documentoId, l.ids.documentoId)).orderBy(desc(documentAccessCodes.createdAt)).limit(1);
    if (ultimo && agora.getTime() - ultimo.em.getTime() < INTERVALO_MS) throw new LinkError(429, MSG_LINK.aguarde);
    if (!(await consumirLimite(tx, chaveDoLimite('documento-envio', l.ids.documentoId), POR_HORA_DOCUMENTO, 3600, agora))) throw new LinkError(429, MSG_LINK.limite);
    const id = crypto.randomUUID();
    await tx.insert(documentAccessCodes).values({ id, tenantId: l.ids.tenantId, patientId: l.ids.patientId, documentoId: l.ids.documentoId, codigoHash: hashDoCodigo(id, codigo), expiraEm: new Date(agora.getTime() + CODIGO_VALIDADE_MS), createdAt: agora });
    const [t] = await tx.select({ nome: tenants.nomeExibicao }).from(tenants).where(eq(tenants.id, l.ids.tenantId));
    await enqueueEmail({ tipo: 'codigo_documento', para: l.dados.email, codigo, consultorio: t?.nome ?? '' }, { tenantId: l.ids.tenantId, tx });
  }, db);
}

/**
 * O código do pedido mais recente; 5 erros invalidam; acerto → "usado" + sessão de 15 min (só o hash no banco).
 * O erro volta como RESULTADO do callback e só é lançado FORA do withTenant: um throw lá dentro desfaria (rollback) o
 * "tentativas + 1", e o código de 6 dígitos ficaria aberto a tentativas ilimitadas (revisão do rascunho, Critical).
 * Limite por IP também na confirmação (30/h), além do limite do pedido.
 */
export async function confirmarCodigoDocumento(token: unknown, input: { codigo?: unknown }, deps: DepsLink): Promise<{ sessao: string; expira: Date }> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (!(await consumirLimite(db, chaveDoLimite('documento-codigo-ip', deps.ipDoLimite ?? 'sem-ip'), CONFIRMACOES_POR_HORA_IP, 3600, agora))) throw new LinkError(429, MSG_LINK.limite);
  const l = await linkUtilizavel(token, deps);
  const codigo = typeof input.codigo === 'string' ? input.codigo.replace(/\s/g, '') : '';
  const r = await withTenant(ctxDo(l.ids, deps.ip), async (tx) => {
    const [c] = await tx.select().from(documentAccessCodes).where(eq(documentAccessCodes.documentoId, l.ids.documentoId)).orderBy(desc(documentAccessCodes.createdAt)).limit(1).for('update');
    if (!c || c.usadoEm || c.tentativas >= MAX_ERROS || c.expiraEm <= agora) return { erro: 'vencido' } as const;
    if (!/^\d{6}$/.test(codigo) || !safeEqual(hashDoCodigo(c.id, codigo), c.codigoHash)) {
      await tx.update(documentAccessCodes).set({ tentativas: c.tentativas + 1 }).where(eq(documentAccessCodes.id, c.id));
      return { erro: 'invalido' } as const; // a transação faz COMMIT do incremento
    }
    const sessao = randomBytes(32).toString('base64url');
    const expira = new Date(agora.getTime() + SESSAO_MS);
    await tx.update(documentAccessCodes).set({ usadoEm: agora, sessaoHash: sha256(sessao), sessaoExpiraEm: expira }).where(and(eq(documentAccessCodes.id, c.id), isNull(documentAccessCodes.usadoEm)));
    return { sessao, expira };
  }, db);
  if ('erro' in r) throw r.erro === 'vencido' ? new LinkError(410, MSG_LINK.codigoVencido) : new LinkError(400, MSG_LINK.codigoInvalido);
  return r;
}

/** "Abrir PDF" pela página do link: sessão do PRÓPRIO link; audita sem ator (D20 do Plano 05) e grava "aberto" (link_email). */
export async function pdfDoLink(token: unknown, sessao: string | undefined, deps: DepsLink): Promise<string | null> {
  const l = await abrirLink(token, deps);
  if (!l || !l.dados.disponivel || l.expirado || !(await sessaoValida(l.ids, sessao, deps))) return null;
  return withTenant(ctxDo(l.ids, deps.ip), async (tx) => {
    await auditRead(tx, { entidade: 'documentos', entidadeId: l.ids.documentoId, patientId: l.ids.patientId });
    await registrarRecibo(tx, { ...l.ids, evento: 'aberto', via: 'link_email' });
    return l.dados.pdf;
  }, deps.db ?? getDb());
}

export async function confirmarRecebimentoPeloLink(token: unknown, sessao: string | undefined, deps: DepsLink): Promise<Date | null> {
  const l = await abrirLink(token, deps);
  if (!l || !l.dados.disponivel || l.expirado || !(await sessaoValida(l.ids, sessao, deps))) return null;
  return withTenant(ctxDo(l.ids, deps.ip), async (tx) => {
    await registrarRecibo(tx, { ...l.ids, evento: 'recebido', via: 'link_email' });
    return (await tx.select({ em: signedDocumentReceipts.em }).from(signedDocumentReceipts).where(and(eq(signedDocumentReceipts.documentoId, l.ids.documentoId), eq(signedDocumentReceipts.evento, 'recebido'))))[0]?.em ?? null;
  }, deps.db ?? getDb());
}

/**
 * §10 da spec ("limpeza diária dos vencidos"), Minor da revisão de cobertura: códigos vencidos há mais de 1 dia cuja
 * sessão também já venceu (ou nunca existiu) saem do banco — o HMAC do código e o hash da sessão não ficam para sempre.
 * Roda no worker (contexto `worker` de cada tenant), na `agenda-limpeza` das 04:30. Um tenant com erro não para os outros.
 */
export async function limparCodigosDeDocumentoVencidos(db: Db, agora: Date, o: { tenantId?: string } = {}): Promise<number> {
  const limite = new Date(agora.getTime() - 86_400_000);
  let n = 0;
  // `o.tenantId`: só os testes (banco compartilhado), como as varreduras da T7
  for (const t of o.tenantId ? [{ id: o.tenantId }] : await listarTenantsParaVarredura(db)) {
    try {
      const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) =>
        tx.delete(documentAccessCodes)
          .where(and(lt(documentAccessCodes.expiraEm, limite), or(isNull(documentAccessCodes.sessaoExpiraEm), lt(documentAccessCodes.sessaoExpiraEm, limite))))
          .returning({ id: documentAccessCodes.id }), db);
      n += r.length;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao limpar códigos de documento vencidos');
    }
  }
  return n;
}
```

Em `src/worker/index.ts`, na `agenda-limpeza` (todo dia às 04:30): `const codigos = await limparCodigosDeDocumentoVencidos(getDb(), new Date());` e `codigos` no `logger.info` da limpeza (com o import de `@/modules/documentos/link-documento`). `listarTenantsParaVarredura` devolve todos os tenants, suspensos inclusive (`tenant-status.ts`): os códigos de um consultório suspenso também vencem e saem.

> `pedirCodigoDocumento` grava `created_at = agora` (o teste anda o relógio); `document_access_codes.created_at` aceita o valor explícito (default só quando omitido).

E-mail: `| { tipo: 'codigo_documento'; para: string; codigo: string; consultorio: string }` e o template (neutro):

```tsx
    case 'codigo_documento':
      return simples(`Código para abrir seu documento: ${msg.codigo}`, [
        `Use o código ${msg.codigo} para abrir o documento enviado por ${msg.consultorio}.`,
        'Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.',
      ]);
```

Run: `pnpm test src/modules/documentos/link-documento.test.ts src/db/sem-conta-guarda.test.ts` → PASS.

- [ ] **Step 3: Rotas, página e cabeçalhos**

As 4 rotas em `src/app/api/documento/[token]/` usam `depsDaRequisicao(req)` de `src/app/api/n/[slug]/resposta.ts` (IP real, balde /64 e Turnstile) com `appUrl`, `lerJson` (8 KB) e `SEM_CACHE`:
- `codigo/route.ts` (POST `{ turnstile }`): `pedirCodigoDocumento` → `200 { ok: true }`; `LinkError` → `{ erro: e.mensagem }` com o `status` dele.
- `confirmar/route.ts` (POST `{ codigo }`): `confirmarCodigoDocumento` → `200 { ok: true }` com **dois** `Set-Cookie` (`nd_doc=<sessao>; Path=/documento/<token>; HttpOnly; Secure; SameSite=Strict; Max-Age=900` e o mesmo com `Path=/api/documento/<token>`).
- `recebido/route.ts` (POST): `confirmarRecebimentoPeloLink(token, cookie)` → `200 { em }` ou `410 { erro: MSG_LINK.invalido }`.
- `pdf/route.ts` (GET): `pdfDoLink(token, cookie)` → `303` para `signFileUrl(caminho)` ou `404`.
Todas com `mesmaOrigem(req)` nos POST e `cache-control: no-store`.

`src/app/documento/[token]/page.tsx` (Server Component, sem login, fora de `PROTECTED` do proxy):

```tsx
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { getEnv } from '@/env';
import { clientIp, clientIpDoLimite } from '@/lib/ip';
import { estadoDoLink, MSG_LINK, NOME_COOKIE_LINK } from '@/modules/documentos/link-documento';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { CodigoForm } from './codigo-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Abrir documento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** RN-158: a página do link. O GET não gasta nada; sem sessão, pede o código; com sessão, mostra o documento. */
export default async function DocumentoPeloLink({ params }: PageProps<'/documento/[token]'>) {
  const { token } = await params;
  const env = getEnv();
  const h = await headers();
  const deps = { ip: clientIp(h, env.TRUSTED_PROXIES), ipDoLimite: clientIpDoLimite(h, env.TRUSTED_PROXIES), appUrl: env.APP_URL, verificarTurnstile: async () => 'invalido' as const };
  const estado = await estadoDoLink(token, (await cookies()).get(NOME_COOKIE_LINK)?.value, deps);
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-fundo p-6 font-sans text-texto">
      <h1 className="font-titulo text-2xl font-semibold">Abrir documento</h1>
      {estado.tipo === 'invalido' || estado.tipo === 'indisponivel' ? <p>{MSG_LINK.invalido}</p> : null}
      {estado.tipo === 'expirado' && <p>{MSG_LINK.expirado}</p>}
      {estado.tipo === 'pedir_codigo' && <CodigoForm token={token} siteKey={env.TURNSTILE_SITE_KEY} />}
      {estado.tipo === 'aberto' && (
        <section className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <h2 className="font-semibold">{`${estado.titulo} · ${formatarData(hojeNoFuso('America/Sao_Paulo', estado.data))}`}</h2>
          <a href={`/api/documento/${token}/pdf`} className="inline-flex min-h-11 items-center underline">Abrir PDF</a>
          {estado.recebidoEm ? (
            <p role="status">{`Recebimento confirmado em ${formatarData(hojeNoFuso('America/Sao_Paulo', estado.recebidoEm))}.`}</p>
          ) : (
            <CodigoForm token={token} siteKey={null} confirmarRecebimento />
          )}
        </section>
      )}
    </main>
  );
}
```

`codigo-form.tsx` (`'use client'`): com `confirmarRecebimento`, um botão "Confirmo que recebi este documento" que faz `POST /api/documento/<token>/recebido` e `router.refresh()`; sem ele, o `TurnstileWidget` + "Enviar código" (POST `codigo`) → "Código enviado. Confira seu e-mail." e o campo "Código" + "Abrir" (POST `confirmar` → `router.refresh()`), mensagens de erro em `role="alert"`. Textos: "Para abrir o documento, enviaremos um código de 6 dígitos para o seu e-mail.".

`next.config.ts` (depois da global): `{ source: '/documento/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] }` e o mesmo para `/api/documento/:token*`.

`src/lib/sentry-filtro.ts` (`caminhoSeguro`): o `replace` final passa a `/^\/(convite(?:\/paciente)?|consulta|documento|api\/documento)\/[^/]+/` → `'/$1/:token'`; teste em `sentry-filtro.test.ts`: `caminhoSeguro('/documento/AbC…92…')` → `'/documento/:token'` e `caminhoSeguro('/api/documento/AbC…/pdf')` → `'/api/documento/:token/pdf'`.

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos/link-documento.test.ts src/lib/sentry-filtro.test.ts src/app/api/documento && pnpm typecheck` → PASS.

```bash
git add src/modules/documentos/link-documento{,.test}.ts src/app/documento src/app/api/documento src/email next.config.ts src/lib/sentry-filtro{,.test}.ts src/worker/index.ts
git commit -m "feat(documentos): link de uso único com código por e-mail, sessão curta e limpeza diária dos códigos (RN-158, D3 b)"
```

---
### Task 13: Verificação pública por código ou QR (US-147, RN-143, RN-156, D8 da spec; P10A-13; antiga T15)

> No 10A, toda verificação é de digitalizada: sem "Assinado por" e sem o link do validador do ITI (RN-157). O campo "Assinado por" e a linha condicional já ficam na página (vêm de `document_verifications.assinante_nome`, nulo no 10A); o link "Validar a assinatura no validador oficial do ITI" e o caso do gov.br nos testes entram no **Plano 10B, Tarefa 5**.

**Files:**
- Modify: `src/modules/documentos/verificacao.ts` (leitura pública) (+ `verificacao-publica.test.ts`), `next.config.ts`, `src/lib/sentry-filtro.ts` (+ teste)
- Create: `src/app/v/page.tsx`, `src/app/v/[codigo]/page.tsx`

**Interfaces:**
- Consumes: `documentVerifications` (só aqui, T8); `normalizarCodigo`, `formatarCodigo` (T5); `consumirLimite`/`chaveDoLimite('verificacao-ip')`; `ROTULO_ASSINATURA`; `partesNoFuso`.
- Produces: `consultarVerificacao(codigoBruto: unknown, deps: { db?: Db; ipDoLimite: string | null; agora?: Date }): Promise<ResultadoVerificacao>`, `ResultadoVerificacao = { tipo: 'limite' } | { tipo: 'nao_encontrado' } | { tipo: 'ok'; v: VerificacaoPublica }`, `VerificacaoPublica = { codigo; tipo: 'Receita'; situacao: SituacaoVerificacao; situacaoEm: Date; assinadoEm: Date; emissorNome; emissorCrn; assinanteNome: string | null; assinatura: string; sha256: string }`, `MSG_VERIFICACAO`, `textoSha256(sha: string): string` (grupos de 4).

- [ ] **Step 1: Teste (falha)** — `src/modules/documentos/verificacao-publica.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { codigoAleatorio } from '../../../test/documentos';
import { novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { formatarCodigo } from './codigo';
import { consultarVerificacao, textoSha256 } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
let n = 0;
const ip = () => `2001:db8:${++n}::1`;

async function verificacao(situacao = 'valido', assinatura = 'digitalizada') {
  const T = await novoTenant(app.db);
  const codigo = codigoAleatorio();
  await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, situacao, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
    values (${codigo}, ${T.tenantId}, ${randomUUID()}, 'receita', ${situacao}, '2026-10-05T15:30:00Z', 'Débora Silva Santos', 'CRN-3 12345', ${assinatura === 'digitalizada' ? null : 'DEBORA SILVA SANTOS'}, ${assinatura}, ${'ab'.repeat(32)})`);
  return { T, codigo };
}

describe('verificação pública (US-147, RN-156, D8)', () => {
  it('válido: só os campos da D8 (nada do paciente), aceita minúsculas e hífen', async () => {
    const { codigo } = await verificacao();
    const r = await consultarVerificacao(formatarCodigo(codigo).toLowerCase(), { db: app.db, ipDoLimite: ip() });
    expect(r).toMatchObject({ tipo: 'ok', v: { codigo, tipo: 'Receita', situacao: 'valido', emissorNome: 'Débora Silva Santos', emissorCrn: 'CRN-3 12345', assinanteNome: null, assinatura: 'Digitalizado' } });
    expect(Object.keys((r as { v: object }).v).sort()).toEqual(['assinadoEm', 'assinanteNome', 'assinatura', 'codigo', 'emissorCrn', 'emissorNome', 'sha256', 'situacao', 'situacaoEm', 'tipo'].sort());
    expect(textoSha256('ab'.repeat(32))).toBe(Array(16).fill('abab').join(' '));
  });
  it('inexistente e malformado dão a mesma resposta; o 31º do mesmo IP na hora é recusado', async () => {
    const meu = ip();
    expect(await consultarVerificacao('ZZZZ-ZZZZ-ZZZZ', { db: app.db, ipDoLimite: meu })).toEqual({ tipo: 'nao_encontrado' });
    expect(await consultarVerificacao('<script>', { db: app.db, ipDoLimite: meu })).toEqual({ tipo: 'nao_encontrado' });
    for (let i = 3; i <= 30; i++) await consultarVerificacao('ZZZZZZZZZZZZ', { db: app.db, ipDoLimite: meu });
    expect(await consultarVerificacao('ZZZZZZZZZZZZ', { db: app.db, ipDoLimite: meu })).toEqual({ tipo: 'limite' });
  });
  it('tenant suspenso continua respondendo; digitalizada sem "Assinado por"', async () => {
    const { T, codigo } = await verificacao('valido', 'digitalizada');
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    expect(await consultarVerificacao(codigo, { db: app.db, ipDoLimite: ip() })).toMatchObject({ tipo: 'ok', v: { assinanteNome: null, assinatura: 'Digitalizado' } });
  });
});
```

Run: `pnpm test src/modules/documentos/verificacao-publica.test.ts` → FAIL.

- [ ] **Step 2: Leitura pública** — acrescentar a `verificacao.ts`

```ts
import { getDb, type Db } from '@/db/client';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { normalizarCodigo } from './codigo';
import { ROTULO_ASSINATURA } from './constantes';

export const MSG_VERIFICACAO = {
  valido: 'Documento válido',
  cancelado: (data: string) => `Documento cancelado — Este documento foi cancelado por quem o emitiu em ${data} e não deve ser usado.`,
  substituido: (data: string) => `Documento substituído — Este documento foi substituído por uma versão retificada em ${data}. Peça a versão atual a quem o emitiu.`,
  eliminado: (data: string) => `Documento emitido em ${data} — o prazo de guarda terminou e o conteúdo foi eliminado.`,
  naoEncontrado: 'Código não encontrado. Confira os 12 caracteres.',
  limite: 'Muitas tentativas. Tente de novo em alguns minutos.',
} as const;
export const LIMITE_VERIFICACAO_HORA = 30;

export type VerificacaoPublica = {
  codigo: string; tipo: 'Receita'; situacao: SituacaoVerificacao; situacaoEm: Date; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinatura: string; sha256: string;
};
export type ResultadoVerificacao = { tipo: 'limite' } | { tipo: 'nao_encontrado' } | { tipo: 'ok'; v: VerificacaoPublica };

export const textoSha256 = (sha: string) => sha.match(/.{1,4}/g)!.join(' ');

/** RN-156: só desta tabela, sem contexto de tenant; 30/h por IP (balde /64); a mesma resposta para inexistente e malformado. */
export async function consultarVerificacao(codigoBruto: unknown, deps: { db?: Db; ipDoLimite: string | null; agora?: Date }): Promise<ResultadoVerificacao> {
  const db = deps.db ?? getDb();
  if (!(await consumirLimite(db, chaveDoLimite('verificacao-ip', deps.ipDoLimite ?? 'sem-ip'), LIMITE_VERIFICACAO_HORA, 3600, deps.agora ?? new Date()))) return { tipo: 'limite' };
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) return { tipo: 'nao_encontrado' };
  const [v] = await db.select().from(documentVerifications).where(eq(documentVerifications.codigo, codigo));
  if (!v) return { tipo: 'nao_encontrado' };
  return {
    tipo: 'ok',
    v: {
      codigo, tipo: 'Receita', situacao: v.situacao as SituacaoVerificacao, situacaoEm: v.situacaoEm, assinadoEm: v.assinadoEm, emissorNome: v.emissorNome,
      emissorCrn: v.emissorCrn, assinanteNome: v.assinanteNome, assinatura: ROTULO_ASSINATURA[v.assinaturaTipo as TipoAssinatura], sha256: v.pdfSha256,
    },
  };
}
```

Run: `pnpm test src/modules/documentos/verificacao-publica.test.ts src/modules/documentos/verificacao.test.ts` → PASS.

- [ ] **Step 3: Páginas**

`src/app/v/page.tsx` (formulário GET sem JavaScript): `<form action="/v" method="get">` com `<label for="codigo">Código de verificação (12 caracteres)</label>`, `<input id="codigo" name="codigo" autoComplete="off" />` e o botão "Verificar"; com `?codigo=` na URL, `redirect(\`/v/${normalizarCodigo(codigo) ?? encodeURIComponent(String(codigo).slice(0, 20))}\`)`. `metadata = { title: 'Verificar documento', robots: { index: false, follow: false }, referrer: 'no-referrer' }`.

`src/app/v/[codigo]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getEnv } from '@/env';
import { clientIpDoLimite } from '@/lib/ip';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { consultarVerificacao, MSG_VERIFICACAO, textoSha256 } from '@/modules/documentos/verificacao';
import { formatarData } from '@/modules/pacientes/datas';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verificar documento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const brasilia = (d: Date) => {
  const p = partesNoFuso(d, 'America/Sao_Paulo');
  return { data: formatarData(p.data), completo: `${formatarData(p.data)} às ${p.hora} (horário de Brasília)` };
};

/** US-147 / D8: situação, tipo, data, quem emitiu (CRN), quem assinou e o SHA-256 — nada do paciente. Sem script. */
export default async function Verificacao({ params }: PageProps<'/v/[codigo]'>) {
  const { codigo } = await params;
  const r = await consultarVerificacao(codigo, { ipDoLimite: clientIpDoLimite(await headers(), getEnv().TRUSTED_PROXIES) });
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-fundo p-6 font-sans text-texto">
      <h1 className="font-titulo text-2xl font-semibold">Verificar documento</h1>
      {r.tipo === 'limite' && <p role="alert">{MSG_VERIFICACAO.limite}</p>}
      {r.tipo === 'nao_encontrado' && <p role="alert">{MSG_VERIFICACAO.naoEncontrado}</p>}
      {r.tipo === 'ok' && (
        <section className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
          <h2 className="text-xl font-semibold">
            {r.v.situacao === 'valido' ? MSG_VERIFICACAO.valido : r.v.situacao === 'cancelado' ? MSG_VERIFICACAO.cancelado(brasilia(r.v.situacaoEm).data) : r.v.situacao === 'substituido' ? MSG_VERIFICACAO.substituido(brasilia(r.v.situacaoEm).data) : MSG_VERIFICACAO.eliminado(brasilia(r.v.assinadoEm).data)}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Tipo:</dt><dd>{r.v.tipo}</dd>
            <dt>Emitido por:</dt><dd>{`${r.v.emissorNome} — ${r.v.emissorCrn}`}</dd>
            {r.v.assinanteNome && (<><dt>Assinado por:</dt><dd>{r.v.assinanteNome}</dd></>)}
            <dt>Assinado em:</dt><dd>{brasilia(r.v.assinadoEm).completo}</dd>
            <dt>Assinatura:</dt><dd>{r.v.assinatura}</dd>
            <dt>Código:</dt><dd>{formatarCodigo(r.v.codigo)}</dd>
          </dl>
          <p className="break-all font-mono text-sm">{`Impressão digital do arquivo (SHA-256): ${textoSha256(r.v.sha256)}`}</p>
          {/* o Plano 10B (T5) acrescenta aqui o link do validador do ITI para gov.br e ICP-Brasil (nunca na digitalizada, RN-157) */}
        </section>
      )}
    </main>
  );
}
```

`next.config.ts`: `{ source: '/v/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }` (depois da global). `caminhoSeguro`: `.replace(/^\/v\/[^/]+/, '/v/:codigo')` (12 caracteres não pegam na regra dos 20) e o teste `caminhoSeguro('/v/ABCDEFGHJKMN')` → `'/v/:codigo'`.

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos src/lib/sentry-filtro.test.ts && pnpm typecheck` → PASS.

```bash
git add src/modules/documentos/{verificacao,verificacao-publica.test}.ts src/app/v next.config.ts src/lib/sentry-filtro{,.test}.ts
git commit -m "feat(documentos): verificação pública por código e QR, sem dado do paciente (US-147, RN-156)"
```

---
### Task 14: LGPD da receita — exportação da equipe e do titular, bloqueio e anonimização (D1 ★, spec §2.3 i, US-150 base, RN-140 c, RN-153; P10A-14; antiga T16)

> **D1 ★ aprovada pelo dono em 05/10/2026** (como recomendada): a base de LGPD da receita fica no Plano 10A, antes do uso real.

**Files:**
- Create: `src/modules/documentos/lgpd-documentos.ts` (+ `lgpd-documentos.test.ts`)
- Modify: `src/modules/pacientes/lgpd.ts` (`anonimizarVencidos`), `src/modules/pacientes/exportacao-job.ts` (`DadosExportacao.documentos`, `AnexoParaZip`, `montarDados`, `lerAnexos`), `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.test.ts`

**Interfaces:**
- Consumes: `app_anonimizar_documentos` (T2); `apagarArquivo`; `descreverItem`, `ConteudoReceita`, `soltarArquivosDoPreparo` (T5); `EMITIDOS`; `formatarCodigo`.
- Produces:
  - `DocumentoExportado = { tipo: 'Receita'; situacao: string; criadoEm: string; assinadoEm: string | null; codigo: string | null; sha256: string | null; assinatura: string | null; itens: { titulo: string; linhas: string[] }[]; orientacoes: string; justificativaDeUso: string | null; recebimento: { evento: string; via: string; em: string }[]; pdf: string | null }`.
  - `documentosParaExportacao(tx, patientId, escopo: EscopoExportacao): Promise<{ documentos: DocumentoExportado[]; anexos: { indice: number; caminho: string; nome: string }[] }>`.
  - `anonimizarDocumentosDoPaciente(ctx: TenantContext /* worker */, patientId: string, deps: { db: Db; dataDir?: string }): Promise<number>`, `pdfsDeDocumentosRestantes(tx, patientId): Promise<number>`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/lgpd-documentos.test.ts`

```ts
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { anonimizarDocumentosDoPaciente, documentosParaExportacao, pdfsDeDocumentosRestantes } from './lgpd-documentos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const conteudo = { versao: 1, tipo: 'receita', orientacoes: 'Com água.', itens: [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', duracao: '', manipulado: false }], copia: { profissional: {}, paciente: { nome: 'Ana Souza' } } };

describe('LGPD dos documentos (US-150 base, D15 da spec)', () => {
  it('equipe: todos, com a justificativa; titular: só os emitidos, com a justificativa e o recebimento; nunca o motivo de cancelamento', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await documentoNoBanco(app.db, T.ctx, p.id, { conteudo });
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado', conteudo });
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${r.id}, 'J rascunho')`);
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_cancelamento) values (${T.tenantId}, ${p.id}, ${a.id}, 'Dose errada')`);
    }, app.db);
    const equipe = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => documentosParaExportacao(tx, p.id, 'equipe'), app.db);
    expect(equipe.documentos.map((d) => d.situacao).sort()).toEqual(['Cancelado', 'Rascunho']);
    expect(JSON.stringify(equipe)).not.toContain('Dose errada');
    expect(equipe.documentos.find((d) => d.situacao === 'Rascunho')?.justificativaDeUso).toBe('J rascunho');
    const titular = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => documentosParaExportacao(tx, p.id, 'titular'), app.db);
    expect(titular.documentos.map((d) => d.situacao)).toEqual(['Cancelado']);
    expect(titular.anexos).toHaveLength(1);
    expect(titular.anexos[0].nome).toMatch(/^documentos\/\d{4}-\d{2}-\d{2}-01\.pdf$/);
  });

  it('anonimização: emitido limpo pela função e PDF apagado do disco; rascunho e preparo apagados; nada sobra', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const dataDir = await mkdtemp(path.join(tmpdir(), 'lgpd-doc-'));
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', conteudo });
    await mkdir(path.join(dataDir, path.dirname(a.pdfPath!)), { recursive: true });
    await writeFile(path.join(dataDir, a.pdfPath!), '%PDF-1.3');
    await documentoNoBanco(app.db, T.ctx, p.id, { conteudo });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    const worker = { tenantId: T.tenantId, role: 'worker' as const };
    expect(await anonimizarDocumentosDoPaciente(worker, p.id, { db: app.db, dataDir })).toBe(2);
    const docs = await withTenant(T.ctx, (tx) => tx.execute(sql`select status, conteudo, pdf_path from signed_documents where patient_id = ${p.id}`), app.db);
    expect(docs.rows).toEqual([{ status: 'assinado', conteudo: {}, pdf_path: null }]);
    await expect(access(path.join(dataDir, a.pdfPath!))).rejects.toThrow();
    expect(await withTenant(worker, (tx) => pdfsDeDocumentosRestantes(tx, p.id), app.db)).toBe(0);
  });
});
```

Run: `pnpm test src/modules/documentos/lgpd-documentos.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/documentos/lgpd-documentos.ts`

```ts
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { signedDocumentNotes, signedDocumentReceipts, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { EscopoExportacao } from '@/modules/pacientes/exportacao-job';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { formatarCodigo } from './codigo';
import { EMITIDOS, ROTULO_ASSINATURA, ROTULO_STATUS, type StatusDocumento, type TipoAssinatura } from './constantes';
import { descreverItem, type ConteudoReceita } from './prescricao';

export type DocumentoExportado = {
  tipo: 'Receita'; situacao: string; criadoEm: string; assinadoEm: string | null; codigo: string | null; sha256: string | null; assinatura: string | null;
  itens: { titulo: string; linhas: string[] }[]; orientacoes: string; justificativaDeUso: string | null; recebimento: { evento: string; via: string; em: string }[]; pdf: string | null;
};

/**
 * US-150 base (D1 ★): equipe = todos, com a justificativa; titular = só os emitidos, com a justificativa (D15 = (b)) e o
 * recebimento; o motivo de cancelamento nunca sai. O worker roda como `worker` (a RLS do paciente não filtra): o filtro do
 * titular é explícito aqui, como planosParaExportacao. O PDF preparado nunca vai; o assinado vai em documentos/.
 */
export async function documentosParaExportacao(tx: Tx, patientId: string, escopo: EscopoExportacao) {
  const ds = await tx
    .select()
    .from(signedDocuments)
    .where(and(eq(signedDocuments.patientId, patientId), escopo === 'titular' ? inArray(signedDocuments.status, [...EMITIDOS]) : undefined))
    .orderBy(asc(signedDocuments.createdAt));
  const ids = ds.map((d) => d.id);
  const notas = ids.length ? await tx.select({ d: signedDocumentNotes.documentoId, j: signedDocumentNotes.justificativaUso }).from(signedDocumentNotes).where(inArray(signedDocumentNotes.documentoId, ids)) : [];
  const recibos = ids.length ? await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ids)) : [];
  const anexos: { indice: number; caminho: string; nome: string }[] = [];
  const documentos: DocumentoExportado[] = ds.map((d, i) => {
    const c = d.conteudo as Partial<ConteudoReceita>;
    if (d.pdfPath && !d.anonimizadoEm) anexos.push({ indice: i, caminho: d.pdfPath, nome: `documentos/${(d.assinadoEm ?? d.createdAt).toISOString().slice(0, 10)}-${String(i + 1).padStart(2, '0')}.pdf` });
    return {
      tipo: 'Receita', situacao: ROTULO_STATUS[d.status as StatusDocumento], criadoEm: d.createdAt.toISOString(), assinadoEm: d.assinadoEm?.toISOString() ?? null,
      codigo: d.codigo && d.status !== 'rascunho' ? formatarCodigo(d.codigo) : null, sha256: d.pdfSha256, assinatura: d.assinaturaTipo ? ROTULO_ASSINATURA[d.assinaturaTipo as TipoAssinatura] : null,
      itens: (c.itens ?? []).map(descreverItem), orientacoes: c.orientacoes ?? '', justificativaDeUso: notas.find((n) => n.d === d.id)?.j ?? null,
      recebimento: recibos.filter((r) => r.documentoId === d.id).map((r) => ({ evento: r.evento, via: r.via, em: r.em.toISOString() })), pdf: null,
    };
  });
  return { documentos, anexos };
}

/**
 * RN-140 (c), ANTES do laço de anexos de anonimizarVencidos: emitido → apagarArquivo do PDF com a função no
 * naMesmaTransacao (marca, limpa conteúdo e notas, elimina a verificação, solta o caminho); não emitido → volta a rascunho
 * (soltando o base no mesmo apagar) e é apagado. Um documento por transação. Devolve quantos documentos tratou.
 */
export async function anonimizarDocumentosDoPaciente(ctx: TenantContext, patientId: string, deps: { db: Db; dataDir?: string }): Promise<number> {
  const ds = await withTenant(ctx, (tx) => tx.select({ id: signedDocuments.id, status: signedDocuments.status, pdf: signedDocuments.pdfPath, base: signedDocuments.basePdfPath }).from(signedDocuments).where(and(eq(signedDocuments.patientId, patientId), isNull(signedDocuments.anonimizadoEm))), deps.db);
  let n = 0;
  for (const d of ds) {
    // regra 9: o que sobrou do preparo (base, fotos) sai antes, cada arquivo no seu apagar (soltarArquivosDoPreparo, T5)
    await soltarArquivosDoPreparo(ctx, d.id, EMITIDOS.includes(d.status as StatusDocumento) ? EMITIDOS : ['preparando', 'aguardando_assinatura'], { db: deps.db, dataDir: deps.dataDir, soFotos: !EMITIDOS.includes(d.status as StatusDocumento) });
    if (EMITIDOS.includes(d.status as StatusDocumento)) {
      const anonimizar = async (tx: Tx) => {
        const r = await tx.execute<{ caminho: string | null }>(sql`select app_anonimizar_documentos(${d.id}) as caminho`);
        return r.rows[0]?.caminho === d.pdf;
      };
      if (d.pdf) await apagarArquivo(ctx, { caminho: d.pdf }, { db: deps.db, dataDir: deps.dataDir, removerAntesDoCommit: true, naMesmaTransacao: anonimizar });
      else await withTenant(ctx, anonimizar, deps.db);
    } else {
      const apagarDoc = async (tx: Tx) => {
        if (d.status !== 'rascunho')
          await tx.update(signedDocuments).set({ status: 'rascunho', codigo: null, declaracaoEm: null, basePdfPath: null, basePdfSha256: null, basePdfBytes: null, areaAssinatura: null, pdfStatus: null, pdfPedidoEm: null, digitalizacao: null, digitalizacaoStatus: null, digitalizacaoEm: null }).where(eq(signedDocuments.id, d.id));
        await tx.delete(signedDocuments).where(eq(signedDocuments.id, d.id));
        return true;
      };
      if (d.base) await apagarArquivo(ctx, { caminho: d.base }, { db: deps.db, dataDir: deps.dataDir, removerAntesDoCommit: true, naMesmaTransacao: apagarDoc });
      else await withTenant(ctx, apagarDoc, deps.db);
    }
    n++;
  }
  return n;
}

/** A conferência final da anonimização (paciente já travado): nenhum PDF de documento pode ter sobrado. */
export async function pdfsDeDocumentosRestantes(tx: Tx, patientId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(signedDocuments).where(and(eq(signedDocuments.patientId, patientId), or(isNotNull(signedDocuments.pdfPath), isNotNull(signedDocuments.basePdfPath))));
  return r?.n ?? 0;
}
```

> As fotos de uma digitalização (`digitalizacao`) e o base que sobrou de um emitido saem antes, cada um no seu `apagarArquivo` (`soltarArquivosDoPreparo`, regra 9); uma foto gravada no meio (corrida com um envio) fica sem referência quando o documento some, e a varredura `limparArquivosOrfaosDeDocumentos` (T7) a apaga — fica anotado no teste da T14 (caso "aguardando com fotos": depois da anonimização nenhuma `documento_digitalizado` sobra; a varredura, se o caso precisar dela, roda com `{ tenantId }`, nunca em todos os tenants do banco de teste).

- [ ] **Step 3: Encaixe em `lgpd.ts` e na exportação**

`src/modules/pacientes/lgpd.ts`, em `anonimizarVencidos`, logo antes do laço `for (const caminho of await withTenant(ctx, (tx) => anexosDoPaciente(tx, id), db))`:

```ts
        // RN-140 (c) (Plano 10A): documentos assinados primeiro, pela função de anonimização (nunca por anexosDoPaciente)
        await anonimizarDocumentosDoPaciente(ctx, id, { db, dataDir: deps.dataDir });
```

e, na transação final, depois de `if (r.length && (await anexosDoPaciente(tx, id)).length) throw …`:

```ts
            if (r.length && (await pdfsDeDocumentosRestantes(tx, id))) throw new Error('documento novo durante a anonimização');
```

`src/modules/pacientes/exportacao-job.ts`:
- `DadosExportacao` ganha `/** Plano 10A (US-150 base): receitas; o titular recebe só as emitidas (D15 = (b): com a justificativa de uso). */ documentos: DocumentoExportado[];`
- `AnexoParaZip.tipo` passa a `'laudo' | 'foto' | 'documento'`;
- em `montarDados`: `const docs = await documentosParaExportacao(tx, patientId, escopo);`, `documentos: docs.documentos` em `dados`, e `const pdfsDeDocumentos: AnexoParaZip[] = docs.anexos.map((a) => ({ tipo: 'documento', ...a }));` somado ao retorno (`laudos: [...laudos, ...fotos, ...pdfsDeDocumentos]`);
- em `lerAnexos`: `else if (l.tipo === 'documento') dados.documentos[l.indice].pdf = l.nome;` (no lugar do `else` que marcava a foto: `else if (l.tipo === 'foto') …`).

Testes: em `exportacao.test.ts`, um caso "o ZIP do titular traz o PDF assinado em documentos/ e não traz o rascunho nem a justificativa de outro paciente"; em `lgpd.test.ts`, um caso "anonimizarVencidos trata os documentos antes dos anexos, e a verificação pública fica 'eliminado'".

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos/lgpd-documentos.test.ts src/modules/pacientes/lgpd.test.ts src/modules/pacientes/exportacao.test.ts` → PASS.

```bash
git add src/modules/documentos/lgpd-documentos{,.test}.ts src/modules/pacientes/{lgpd,exportacao-job,lgpd.test,exportacao.test}.ts
git commit -m "feat(documentos): exportação da equipe e do titular, bloqueio e anonimização das receitas (US-150 base, RN-140 c, D1)"
```

---
### Task 15: Cancelar documento (US-149, RN-147, D11 da spec, D3 ★; P10A-15; antiga T17)

> **D3 ★ aprovada pelo dono em 05/10/2026** (como recomendada): a US-149 sobe para o Plano 10A; a retificação (US-148) continua no Plano 13. Minor da revisão de cobertura aplicado: `MSG_CANCELAMENTO.retificacao` (texto do Plano 13) saiu daqui — entra com a retificação.

**Files:**
- Create: `src/modules/documentos/cancelamento.ts` (+ `cancelamento.test.ts`), `src/app/painel/pacientes/[id]/documentos/[docId]/cancelar.tsx`
- Modify: `.../documentos/actions.ts` (`cancelarAction`), a página do documento, `src/email/{types.ts,templates.tsx}` (`documento_atualizado`), `src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL.documento_atualizado`)

**Interfaces:**
- Consumes: `mudarSituacao` (T8); `assinarLinkDocumento`, `urlDoLinkDocumento` (T10); `carregarPacienteParaEscrita`; `enqueueEmail`; `dispararEnvio`; `telaDoPortal`.
- Produces: `cancelarDocumento(ctx, patientId, docId, motivo: unknown, deps?: { db?; appUrl?; agora? }): Promise<void>`; `MSG_CANCELAMENTO = { motivo, confirmacao }`; e-mail `{ tipo: 'documento_atualizado'; para; nome; consultorio; link }`.

- [ ] **Step 1: Teste (falha)** — `src/modules/documentos/cancelamento.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { ctxPaciente, emailsNaFila, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { cancelarDocumento, MSG_CANCELAMENTO } from './cancelamento';
import { DocumentoError } from './erros';
import { confirmarRecebimentoNoPortal } from './portal';
import { consultarVerificacao } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('cancelar documento (US-149, RN-147)', () => {
  it('sem motivo → texto da spec; com motivo → cancelado no prontuário, no portal e na verificação; e-mail neutro (D11)', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    await liberarDocumentos(app.db, T.tenantId); // D20 ligado: o "não confirma" do fim é pelo cancelamento, não pelo interruptor
    const { paciente, email } = await pacienteComConta(app.db, T, { nome: 'Ana Souza' });
    const d = await documentoNoBanco(app.db, T.ctx, paciente.id, { status: 'assinado' });
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Débora', 'CRN-3 12345', null, 'digitalizada', ${'a'.repeat(64)})`);
    await expect(cancelarDocumento(T.ctx, paciente.id, d.id, '  ', { db: app.db, appUrl: 'https://x' })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.motivo === MSG_CANCELAMENTO.motivo);
    await cancelarDocumento(T.ctx, paciente.id, d.id, 'Dose digitada errada', { db: app.db, appUrl: 'https://x' });
    const [linha] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select d.status, n.motivo_cancelamento from signed_documents d left join signed_document_notes n on n.documento_id = d.id where d.id = ${d.id}`), app.db)).rows;
    expect(linha).toEqual({ status: 'cancelado', motivo_cancelamento: 'Dose digitada errada' });
    expect(await consultarVerificacao(d.codigo, { db: app.db, ipDoLimite: '192.0.2.77' })).toMatchObject({ tipo: 'ok', v: { situacao: 'cancelado' } });
    const [m] = await emailsNaFila('documento_atualizado', email);
    expect(m).toMatchObject({ nome: 'Ana', consultorio: 'Consultório Debby' });
    expect(JSON.stringify(m)).not.toContain('Dose');
    expect(await confirmarRecebimentoNoPortal(ctxPaciente(T.tenantId, paciente.id), d.id, app.db)).toBeNull();
  });
});
```

Run: `pnpm test src/modules/documentos/cancelamento.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/documentos/cancelamento.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { notifications, signedDocumentNotes, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { telaDoPortal } from '@/modules/portal/link-portal';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { assinarLinkDocumento, urlDoLinkDocumento } from './link-documento';
import { mudarSituacao } from './verificacao';

/** US-149 (texto exato da spec v0.3). */
export const MSG_CANCELAMENTO = {
  motivo: 'Escreva o motivo do cancelamento (até 500 caracteres).',
  confirmacao: 'O documento deixa de valer para o paciente e na verificação pública. Esta ação não pode ser desfeita.',
} as const;

/**
 * RN-147: só de "assinado"; motivo 1–500 em signed_document_notes (STAFF_ONLY, nunca nas exportações); a verificação passa
 * a "cancelado" na mesma transação; e-mail neutro (D11 da spec) — com conta, o link do portal; sem conta, o link de uso
 * único (que mostra "não está mais disponível"). A retificação em andamento (Plano 13) entra aqui quando existir.
 */
export async function cancelarDocumento(ctx: TenantContext, patientId: string, docId: string, motivo: unknown, deps: { db?: Db; appUrl?: string; agora?: Date } = {}): Promise<void> {
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (!m || m.length > 500) throw new DocumentoError({ motivo: MSG_CANCELAMENTO.motivo });
  const agora = deps.agora ?? new Date();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  await withTenant(ctx, async (tx) => {
    const p = await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId))).for('update');
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'assinado') throw new TransicaoInvalidaError();
    await tx.update(signedDocuments).set({ status: 'cancelado', canceladoEm: agora, updatedAt: agora }).where(eq(signedDocuments.id, docId));
    await tx
      .insert(signedDocumentNotes)
      .values({ tenantId: ctx.tenantId, patientId, documentoId: docId, motivoCancelamento: m })
      .onConflictDoUpdate({ target: signedDocumentNotes.documentoId, set: { motivoCancelamento: m, updatedAt: agora } });
    await mudarSituacao(tx, docId, 'cancelado', agora);
    if (p.status !== 'ativo') return; // patients.email é NOT NULL (o `!p.email` do rascunho era código morto)
    const [t] = await tx.select({ nome: tenants.nomeExibicao }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const link = p.userId
      ? urlDoApp(appUrl, telaDoPortal('/p/documentos', ctx.tenantId))
      : urlDoLinkDocumento(appUrl, assinarLinkDocumento({ tenantId: ctx.tenantId, patientId, documentoId: docId, emitidoEm: agora, email: p.email }));
    await enqueueEmail({ tipo: 'documento_atualizado', para: p.email, nome: primeiroNome(p.nome), consultorio: t?.nome ?? '', link }, { tenantId: ctx.tenantId, tx });
    if (p.userId) {
      await tx.insert(notifications).values({ tenantId: ctx.tenantId, patientId, canal: 'push', tipo: 'documento_atualizado', agendadaPara: agora });
      await dispararEnvio(tx, ctx.tenantId);
    }
  }, deps.db ?? getDb());
}
```

E-mail: `| { tipo: 'documento_atualizado'; para: string; nome: string; consultorio: string; link: string }`; template com o assunto "Um documento seu foi atualizado" e o corpo "Olá, {nome}. {consultorio} atualizou um documento seu. Para ver, entre no app: {link}" (texto da US-149), botão "Ver meus documentos". `AVISOS_DO_PORTAL.documento_atualizado = { corpo: 'Um documento seu foi atualizado.', tela: '/p/documentos' }`.

- [ ] **Step 3: Tela** — `cancelar.tsx` + `cancelarAction`

```tsx
'use client';

import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { cancelarAction, type EstadoForm } from '../actions';

/** US-149: o motivo fica só no prontuário; a confirmação diz que não tem volta. */
export function Cancelar({ patientId, docId, confirmacao }: { patientId: string; docId: string; confirmacao: string }) {
  const [s, action, pendente] = useActionState<EstadoForm, FormData>(cancelarAction.bind(null, patientId, docId), {});
  return (
    <form action={action} className="space-y-2" onSubmit={(e) => { if (!window.confirm(confirmacao)) e.preventDefault(); }} data-guia="cancelar-documento">
      <label htmlFor="motivo" className="block font-medium">Motivo do cancelamento</label>
      <textarea id="motivo" name="motivo" maxLength={500} required aria-describedby="motivo-dica" aria-invalid={s.erros?.motivo ? true : undefined} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
      <p id="motivo-dica" className="text-sm text-suave">Fica só no prontuário.</p>
      {s.erros?.motivo && <p role="alert" className="text-sm text-erro">{s.erros.motivo}</p>}
      {s.erros?.geral && <p role="alert" className="text-erro">{s.erros.geral}</p>}
      <Botao variante="secundario" disabled={pendente}>Cancelar documento</Botao>
    </form>
  );
}
```

```ts
// actions.ts
export async function cancelarAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await cancelarDocumento(ctx, patientId, docId, f.get('motivo'));
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}
```

Na página do documento, no cartão "Documento assinado" (status `assinado`, paciente não bloqueado): `<Cancelar patientId={paciente.id} docId={d.id} confirmacao={MSG_CANCELAMENTO.confirmacao} />`; com status `cancelado`, o cartão mostra "Cancelado em dd/mm/aaaa" e `Motivo (só no prontuário): {d.motivoCancelamento}`.

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos/cancelamento.test.ts src/email src/modules/notificacoes` → PASS.

```bash
git add src/modules/documentos/cancelamento{,.test}.ts src/app/painel/pacientes/[id]/documentos src/email src/modules/notificacoes/mensagens.ts
git commit -m "feat(documentos): cancelar documento com motivo só no prontuário e aviso neutro (US-149, D3)"
```

---
### Task 16: E2E da receita, acessibilidade das telas novas e o fechamento do manual guiado (RNF-144, US-057 do MVP; P10A-16; antiga T18)

**Files:**
- Create: `e2e/documentos.spec.ts`
- Modify: `scripts/e2e-seed.ts` (`E2E_DOCS`: nutricionista própria do fluxo de documentos, no mesmo consultório, com o 2FA já ativo e um segredo TOTP conhecido), `e2e/acessibilidade.spec.ts` (portal `/p/documentos`, `/v/<código>`, `/documento/<token>`), `e2e/acessibilidade-painel.spec.ts` (nada: as rotas novas já estão em `ROTAS_DO_PAINEL`, T6), `src/modules/ajuda/conteudo.ts` (aspas de volta no guia `documentos`; passos "Entrega" e "Cancelar"), `docs/operacao/go-live.md` (itens do Plano 10A)

**Interfaces:**
- Consumes: as telas das Tarefas 6 a 15; `entrarComo` (`e2e/helpers.ts`; não existe `entrarComoNutri`), `e2e/portal.ts`, `e2e/mailpit.ts` (código do e-mail); `otpauth` (o 2FA da nutricionista no E2E); `symmetricEncrypt` (`better-auth/crypto`, só no seed).
- Produces: `e2e/documentos.spec.ts` com o fluxo de ponta a ponta pela **digitalizada** — a única forma de assinar do Plano 10A (no 10B o E2E continua por ela: a assinatura gov.br/ICP do E2E exigiria âncoras de teste dentro do app, o que não fazemos).

- [ ] **Step 1: Conta própria do fluxo** — `scripts/e2e-seed.ts`

A spec **não** ativa o 2FA na conta compartilhada `E2E_NUTRI`: nessa execução e na seguinte sem reseed, todo login dela cairia no desafio do 2FA e quebraria as outras specs do painel (revisão do rascunho). O seed cria uma nutricionista só deste fluxo, no mesmo consultório, já com o 2FA ativo e um segredo conhecido (fictício, só de teste):

```ts
import { symmetricEncrypt } from 'better-auth/crypto';
import { twoFactor } from '@/db/schema';
import { getEnv } from '@/lib/env';
// …
/** Plano 10A (T16): assinar exige 2FA; segredo TOTP fixo e fictício (base32), só do E2E. */
export const E2E_DOCS = { email: 'docs-e2e@nutridebby.test', password: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
// …
await db.delete(user).where(eq(user.email, E2E_DOCS.email));
const docsId = randomUUID();
await db.insert(user).values({ id: docsId, name: 'Docs E2E', email: E2E_DOCS.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id, twoFactorEnabled: true });
await db.insert(account).values({ id: randomUUID(), userId: docsId, accountId: docsId, providerId: 'credential', password: await hashPassword(E2E_DOCS.password) });
// como o enableTwoFactor do better-auth 1.7.6 grava (two-factor/index.mjs: symmetricEncrypt com o secretConfig = AUTH_SECRET)
await db.insert(twoFactor).values({
  id: randomUUID(), userId: docsId, verified: true,
  secret: await symmetricEncrypt({ key: getEnv().AUTH_SECRET, data: E2E_DOCS.totp }),
  backupCodes: await symmetricEncrypt({ key: getEnv().AUTH_SECRET, data: JSON.stringify([]) }),
});
```

E `E2E_DOCS.email` entra na lista do `guia: TUDO_VISTO` (o tour não abre por cima do fluxo). Conferir, na versão instalada, que o `secretConfig` do Better Auth é a própria `AUTH_SECRET` (sem rotação de segredos); se não for, ativar o 2FA dessa conta pelo `auth.api` no seed.

- [ ] **Step 2: O fluxo de ponta a ponta** — `e2e/documentos.spec.ts`

```ts
import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';
import { E2E_DOCS } from '../scripts/e2e-seed';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

test('receita: rascunho → preparar → digitalizada → portal (abrir e confirmar) → verificação pública', async ({ browser }) => {
  test.setTimeout(180_000);
  // conta própria do fluxo (E2E_DOCS), com o 2FA já ativo no seed: o login passa pelo desafio do 2FA
  const totp = new TOTP({ secret: E2E_DOCS.totp, digits: 6, period: 30 });
  const page = await entrarComo(browser, E2E_DOCS.email, E2E_DOCS.password, '10.9.14.9', { viewport: { width: 1280, height: 900 } });
  await expect(page).toHaveURL(/\/entrar\/2fa/);
  await page.getByLabel('Código do app autenticador').fill(totp.generate());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/painel/);

  const paciente = await pacienteNoPortal(browser, page, '10.9.14.10');
  await page.goto(`${paciente.prontuario}/documentos`);
  await page.getByRole('button', { name: 'Nova receita' }).click();
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await page.getByLabel('Componente 1').fill('Vitamina D3');
  await page.getByLabel('Quantidade').fill('2000');
  await page.getByLabel('Unidade').selectOption('UI');
  await page.getByLabel('Forma de apresentação').fill('Cápsula');
  await page.getByLabel('Posologia').fill('1 cápsula ao dia, no almoço');
  await page.getByLabel('Justificativa de uso').fill('Exposição solar baixa');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
  await page.getByLabel(/Declaro que os itens são suplementos/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Enviar documento digitalizado (assinado à mão)' }).click();
  await page.getByLabel('Fotos das páginas (JPEG ou PNG, até 5)').setInputFiles('e2e/fixtures/pagina-assinada.png');
  await page.getByLabel('Código da verificação em duas etapas').fill(totp.generate());
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('Assinado em')).toBeVisible({ timeout: 60_000 });
  const codigo = (await page.getByText(/^Código de verificação: /).innerText()).replace('Código de verificação: ', '');

  // portal: cartão no Início → Documentos → abrir → confirmar
  const p = paciente.page;
  await p.goto('/p/inicio');
  await p.getByRole('link', { name: 'Ver documentos' }).click();
  await expect(p.getByRole('heading', { name: /^Receita · / })).toBeVisible();
  await expect(p.getByText('Assinatura: Digitalizado')).toBeVisible(); // RN-157 no portal
  const download = p.waitForEvent('download');
  await p.getByRole('link', { name: /^Abrir PDF da receita/ }).click();
  await download;
  await p.getByRole('button', { name: 'Confirmo que recebi este documento' }).click();
  await expect(p.getByRole('status').filter({ hasText: /^Recebimento confirmado em / })).toBeVisible();

  // painel: situação da entrega
  await page.reload();
  await expect(page.getByText(/^Recebido pelo paciente em /)).toBeVisible();
  // RN-157 também na lista da nutricionista
  await page.goto(`${paciente.prontuario}/documentos`);
  await expect(page.getByText('Assinatura: Digitalizado')).toBeVisible();

  // verificação pública: sem login, sem nada do paciente
  const anonimo = await browser.newPage();
  await anonimo.goto(`/v/${codigo.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: 'Documento válido' })).toBeVisible();
  await expect(anonimo.getByText('Digitalizado')).toBeVisible();
  await expect(anonimo.getByText(paciente.nome)).toHaveCount(0);
  await expect(anonimo.getByText('Vitamina D3')).toHaveCount(0);
  await expect(anonimo.getByRole('link', { name: 'Validar a assinatura no validador oficial do ITI' })).toHaveCount(0);
});
```

`e2e/fixtures/pagina-assinada.png`: uma imagem PNG pequena gerada por `sharp` no setup do teste (ou versionada, 1 página em branco com um rabisco; sem dado pessoal).

- [ ] **Step 3: Acessibilidade** — em `e2e/acessibilidade.spec.ts`, os casos `/p/documentos` (paciente com uma receita emitida), `/v/<código>` (válido e "não encontrado") e `/documento/<token>` (estado "pedir código") nos três modos (claro, escuro, aparelho) e a 360 px, com o mesmo `axe` do Plano 08 (zero violação WCAG 2.1 AA). As telas do painel já entram pelo `ROTAS_DO_PAINEL` (T6).

- [ ] **Step 4: Manual guiado — fechamento** (`src/modules/ajuda/conteudo.ts`)

No guia `documentos`, as três frases que ficaram sem aspas na T6 voltam com os rótulos exatos ("Enviar documento digitalizado (assinado à mão)", "Entregue pessoalmente", "Cancelar documento") e os passos ganham:

```ts
      { alvo: 'entrega-documento', titulo: 'Entrega', texto: 'O paciente recebe pelo app ou por um link por e-mail. Aqui você vê se ele abriu e confirmou o recebimento, ou marca a entrega pessoal.' },
      { alvo: 'cancelar-documento', titulo: 'Cancelar', texto: 'Documento errado? Cancele com o motivo (fica só no prontuário) e faça uma receita nova. A verificação pública passa a mostrar "cancelado".' },
```

O guia `prontuario` ganha "documentos" no resumo ("…evolução, plano alimentar, documentos e privacidade.") e sobe para `versao: 2`. Conferir com `pnpm test src/modules/ajuda` (alvos, aspas e rotas) e rodar `e2e/manual.spec.ts`.

- [ ] **Step 5: Checklist do go-live** — `docs/operacao/go-live.md` ganha a seção "Plano 10A — receita (liberação para uso real)": resposta do CRN-3 (P-B1) arquivada; textos da D5 e "(proposto)" revistos pela Debby (inclusive a declaração com os medicamentos isentos à base de vitaminas e minerais, Minor 10, e a dica do "Outro", Minor 11); termo e DPA com a entrega eletrônica e a verificação (P-B3/E-09) e o novo aceite; backup no host (P02-11); o admin liga "Documentos" do consultório (D20) **e não desliga depois do uso real** (Minor 12: desligado, o consultório perde "Cancelar documento" e a entrega das receitas já assinadas); um teste manual completo pela digitalizada (receita, fotos, portal, link + código para paciente sem app, verificação pelo QR no celular, confirmação de recebimento). O Plano 10B acrescenta a parte do gov.br e do certificado.

- [ ] **Step 6: Rodar e commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e` → PASS (a suíte inteira, não só as specs novas: prova que nenhuma conta compartilhada ficou com 2FA).

```bash
git add e2e scripts/e2e-seed.ts src/modules/ajuda docs/operacao/go-live.md
git commit -m "test(documentos): E2E da receita pela digitalizada, axe das telas novas e manual guiado (RNF-144)"
```

---

## Runbook do Plano 10A (o dono faz; nada disto é código)

1. **Consulta ao CRN-3 (P-B1)** — escrita, pela Debby ou pelo dono, com: (i) o gov.br (assinatura avançada) atende o "assinatura digital certificada" das Res. 656/680 na receita? (ii) a assinatura na plataforma com 2FA + código verificador atende o parecer (D2) e (iii) o plano alimentar online (D12, Res. 760/2023, art. 10)? (iv) a identificação do cliente no documento precisa de e-mail e telefone além do nome (art. 10, I)? (v) os textos da D5 (a declaração da receita, agora com os medicamentos isentos à base de vitaminas, e, para o Plano 13, a ressalva e a declaração do parecer); (vi) a receita **digitalizada** (assinatura à mão, PDF montado pelo sistema com código e QR) atende a entrega eletrônica? **A liberação para uso real depende da resposta** (o desenvolvimento não).
2. **Advogado (P-B3, junto com o E-09):** o termo do paciente e o DPA citam a entrega eletrônica de documentos (portal e link por e-mail com código), a assinatura usada e a página pública de verificação; o termo novo exige novo aceite. A D15 da spec (justificativa na exportação do titular) é confirmada aqui.
3. **Textos para a Debby revisar** (junto com o manual guiado, P08-08): a declaração da receita (D5), a dica da categoria "Outro", a recusa `sem_habilitacao`, os textos "(proposto)" da spec v0.3.1 (US-145 paciente sem portal e arquivado), os do link (RN-158), o do cartão "Aguardando assinatura" e os guias `documentos`, `configuracoes` (v2) e `seguranca`.
4. **Backup no host (P02-11, etapas 6 e 8)** continua pendente: sem ele, nada de paciente real — e receita é prontuário.
5. **Cota do Resend:** o link e o código da D3 (b) somam até 2 e-mails por documento de paciente sem app (mais os reenvios). Conferir no painel do Resend se o plano atual comporta o volume da Debby (custo zero, CS-143).
6. **Deploy (merge = deploy), com o OK do dono e snapshot no hPanel antes.** As migrations 0089–0091 (ou a numeração depois do Plano 09) só criam tabelas, colunas nulas/padrão em `tenants`, trocam os CHECKs de `stored_files.tipo` e `notifications.tipo` (acrescentam valores; a validação lê as duas tabelas uma vez), refazem a política `paciente_arquivos` e criam gatilhos e uma função. Nenhuma migração de dados. Nenhuma variável nova. `documentos_liberados` nasce `false`: nada aparece para a Debby até a etapa 7.
7. **Liberação para uso real** (checklist do `docs/operacao/go-live.md`, seção do Plano 10A): resposta do CRN-3 arquivada; textos revistos; termo/DPA (E-09) com o novo aceite; backup no host; "Cancelar documento" no ar (D3); o admin liga "Documentos" do consultório da Debby (D20) — **e não desliga depois** (Minor 12); teste manual com uma receita digitalizada de um paciente de teste com app e outro sem app (link + código), a verificação pelo QR no celular e a confirmação de recebimento.

## Fechamento do plano (após a Tarefa 16)

- [ ] **Independência do 10B (exigência do dono, 05/10/2026):** com a lista de arquivos, funções e tabelas da seção "Estrutura de arquivos" do Plano 10B, `grep -rnE '<a lista, separada por |>' src test e2e scripts drizzle` não acha nada; `pnpm typecheck`, `pnpm test` e `pnpm build` passam sem nenhum pacote novo; o CHECK de `assinatura_tipo` (nas duas tabelas) só aceita `'digitalizada'`.
- [ ] Revisão da entrega conforme o índice (revista em 02/10/2026): revisor por tarefa (ao longo) → **revisão final do branch (workflow) com uma onda de correções** → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor → backlog) → re-revisão **só do diff das correções** → `/security-review` com o **checklist reforçado** (D9 ★):
  - **Digitalizada (RN-157):** só JPEG/PNG pelo conteúdo, 1 a 5 fotos, 10 MB, 40 MP pelo cabeçalho no envio; cada página normalizada (`rotate()` + `paraJpegSemMetadados`, sem EXIF/GPS) antes do react-pdf; o arquivo enviado nunca é entregue como veio; um envio por vez (`recebendo`), expiração em 1 h; `registrarAssinatura` amarrado à versão lida (`codigo` + `digitalizacao_status = 'pendente'`); habilitação conferida de novo; `registrar-assinatura.ts` sem sessão (grafo verde).
  - **2FA (RN-145):** `confirmarCodigo2fa` só pela API do Better Auth; 5 tentativas em 15 min; anti-repetição de 90 s; recusa registrada no histórico do paciente; nada gravado antes do código; semáforo da rota depois de ler o corpo, um envio por usuária.
  - **Banco:** `app_documento_imutavel` (todas as transições, no-op passa, rascunho sem PDF nem assinatura, anonimização só no worker), notas imutáveis, `paciente_so_emitidos`, recibo só INSERT (`paciente_recibo_proprio`, REVOKE), `document_verifications` fora da RLS só em `verificacao.ts` (guarda verde) com UPDATE só de duas colunas e DELETE revogado, `app_codigo_acesso_regras`, `signed_document_notes` STAFF_ONLY, `paciente_arquivos` sem o base e as fotos, FKs `NO ACTION`, `app_anonimizar_documentos` INVOKER (desvio registrado).
  - **Link (RN-158):** GET não consome; token sem estado com o e-mail atual no MAC (e-mail vazio → link morto); 30 dias; código HMAC por pedido, 10 min, 5 erros (o incremento grava mesmo com o erro: resultado devolvido, throw fora do `withTenant`), 1/min e 5/h por documento, 20/h por IP no pedido e 30/h por IP na confirmação, Turnstile; sessão de 15 min só com hash no banco, cookie `HttpOnly`/`SameSite=Strict` por caminho; `semConta` na lista fechada; limpeza diária; `no-referrer`, `noindex`, `no-store`; `caminhoSeguro` com `:token`.
  - **Página pública (RN-156):** só `document_verifications`; nada do paciente; 30/h por IP; mesma resposta para inexistente e malformado; `no-referrer`, `noindex`, sem script; `/v/:codigo` no Sentry.
  - **Arquivos (regra 9):** base, PDF final e fotos só por `salvarArquivo`/`apagarArquivo`; registro no `registrar`/`naMesmaTransacao`, também depois da assinatura (ela mantém os ponteiros; `soltarArquivosDoPreparo` solta cada arquivo no seu apagar; o gatilho só deixa os ponteiros de emitido encolherem); varredura de órfãos e de sobras; PDFs e a digitalizada só no worker (grafo verde); cota esgotada com a mensagem da RNF-143.
  - **LGPD (D1 ★):** exportações com e sem rascunho, justificativa só onde a D15 da spec manda, nunca o motivo de cancelamento; anonimização pela função antes dos anexos, conferência final, verificação "eliminado".
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema Critical/Important confirmado, parar e avisar o dono.
- [ ] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): P10A-01 a P10A-16 (com o PR); os Minor da revisão num item "P10A-17 — débitos do Plano 10A" (com a tela de auditoria do consultório e a seg. 12, se o dono quiser).
- [ ] Atualizar a spec de documentos assinados para a **v0.4** depois do 10B (o que os dois planos mudaram: os "Desvios conscientes" acima e os do 10B, o resultado do spike) e a spec do MVP onde ela cita documentos (§4.1: a escrita nova do paciente e o contexto `semConta` do link; §7: as tabelas novas; RNF-10: as telas novas no axe).
- [ ] Atualizar os **dois manuais** (memória do projeto): o do usuário (Claude Docs, "NutriDebby — Manual do sistema", seção "Documentos assinados e receita", só a digitalizada) e o técnico (`docs/manual-tecnico/`, módulo `documentos`, as tabelas, o runbook).
- [ ] Anotar para os próximos planos (no backlog): **Plano 10B** — assinatura gov.br e ICP-Brasil (depende dos PDFs reais assinados do dono); **Plano 13** — parecer (US-141), retificar (US-148), a parte da US-150 do parecer, a D2 (com a resposta do CRN-3), o CHECK de `tipo` com `'parecer'` e `exam_ids`; **Plano 12** — "Exames" no portal pede o "Mais" na barra (D5); D12 (plano alimentar com código e confirmação) se o CRN-3 exigir.
- [ ] Lembrar o dono: backup no host (P02-11) pendente; liberação para uso real só pelo checklist (runbook, etapa 7); merge (= deploy) só com OK explícito e snapshot no hPanel antes.

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec v0.3.1 (parte do 10A)**

| Requisito | Onde |
|---|---|
| US-140 (perfil, habilitação D6, perfil incompleto bloqueia, cópia congelada) | Tarefas 3 (perfil, Fitoterapia, auditoria), 5 (`copiaDoPerfil` no preparo) e 6 ("Completar perfil") |
| US-142 (tipos de item, unidades, chá, fitoterápico sem habilitação, derivado vegetal D13, justificativa fora do PDF, bloqueado, arquivado D14) | Tarefas 5 (`prescricao.ts`, `documentos.ts`) e 6 (editor) |
| US-143 (declaração D5, PDF com marca, carimbo, quadro, código e QR, voltar a editar, falha do PDF, cota) | Tarefas 5 (preparar, voltar), 6 (tela, "Gerar o PDF de novo") e 7 (worker, `sem_cota`) |
| US-144, parte da digitalizada (sem 2FA, código, fotos, aviso, "Montando o PDF digitalizado…") | Tarefas 4 (2FA), 8 (assinatura no banco) e 9 (digitalizada). O envio do PDF assinado é do Plano 10B |
| US-145 (entrega com e sem portal, D3 a/b, D4, arquivado) | Tarefas 10 (entrega, token, pessoalmente), 11 (portal) e 12 (link) |
| US-146 (lista, abrir, confirmar, situações, vazio, fora do offline) | Tarefa 11 (com o teste do service worker) |
| US-147 (válido, cancelado/eliminado, não encontrado, abuso; sem link do ITI na digitalizada) | Tarefa 13 (+ T15 para cancelado, T14 para eliminado). O link do ITI é do 10B |
| US-149 (D3 ★) e US-150 base (D1 ★) | Tarefas 15 e 14 |
| RN-140/RN-141 (imutabilidade, transições, ordem de operações, FK NO ACTION) | Tarefas 2 (gatilhos, função), 5 (voltar), 8 (assinar), 14 (anonimizar) |
| RN-142/RN-143 (código, SHA-256) | Tarefas 5, 7, 8, 13 |
| RN-145 (2FA a cada digitalizada) | Tarefas 4 e 9 |
| RN-149/RN-150/RN-151 | Tarefa 5 (sem campo de marca) |
| RN-152/RN-153/RN-154 | Tarefas 10, 11, 5 |
| RN-156/RN-157/RN-158 | Tarefas 8 e 13, 9, 10 e 12 |
| RNF-140 a RNF-145 (parte do 10A) | T7 (30 s, cota), T9 (rota com limites), T12/T13 (Sentry), T14 (cota da exportação), T16 (axe), Tech Stack (custo) |
| Manual guiado (toda tela nova do painel com guia; `/conta/seguranca`) | Tarefas 3 (`configuracoes` v2), 4 (`seguranca`), 6 (`documentos`, `ROTAS_DO_PAINEL`) e 16 (fechamento) |

**2. Placeholders:** nenhum. Os trechos em prosa são trocas mecânicas em arquivos existentes (uma entrada numa lista, um import, uma linha num menu) com o texto exato, ou repetem um esqueleto já escrito no plano (as rotas do link na T12 seguem `depsDaRequisicao` do `/api/n/[slug]`).

**3. Consistência de nomes:** `AREA_ASSINATURA`/`TipoAssinatura`/`RecusaAssinaturaError`/`MSG_RECUSA` (T1) em T7–T9; `documentoNoBanco`/`codigoAleatorio` (T1) e `novoConsultorio`/`outroDocumento`/`novoPreparoNoBanco`/`pdfDeTeste` (T8) em T9–T15; `confirmarCodigo2fa` (T4) em T9; `copiaDoPerfil`/`CopiaProfissional` (T3) em T5 e T8; `validarRascunho`/`validarParaPreparar`/`descreverItem`/`ConteudoReceita` (T5) em T6, T7, T8, T14; `lerDocumentoNaTransacao`/`dataHora`/`ItemLista`/`situacaoNoPainel(d, fuso)` (T5/T6) em T7 e T10; `registrarAssinatura`/`VersaoLida`/`AcessoAssinatura`/`DepsAssinar`/`exigirHabilitacaoAtual` (T8, com `appUrl` na T10) em T9 e T10; `EstadoPdf` com `esperando` (T6, prop na T9); `linhaDaAssinatura` (T1) em T6 e T11; `registrarVerificacao`/`mudarSituacao` (T8) em T13 e T15; `assinarLinkDocumento`/`lerLinkDocumento` (T10) em T12 e T15; `registrarRecibo` (T10) em T11 e T12; `expirarPdfsDeDocumentoPendentes` (T7, com `{ tenantId }` nos testes) no teste da T9; `soltarArquivosDoPreparo` (T5) em T7, T8 (teste), T9 e T14; `liberarDocumentos` (T8) em T11, T12 e T15; `AcaoDocumento` (T6) em T10; `DIGITALIZACAO_MAX_MS`/`MAX_PIXELS_FOTO` (T9) em `digitalizada.ts` e `digitalizada-job.ts`.

**4. Review Focus:** 1 (fotos no limite) → T9 (PDF disfarçado, 6 fotos, bomba de pixels, EXIF/GPS, dois envios, expiração) e T7 (varredura); 2 (2FA no limite) → T4 (5 erros → bloqueado, repetição, espaço; cookie da sessão nova depois da ativação) e T9 (tentativa registrada, sem 2FA antes de gravar); 3 (link na caixa errada) → T12 (GET não consome, e-mail corrigido, limites, 5 erros que sobrevivem ao erro, limite por IP na confirmação, código reusado, cancelado, sessão de outro link, limpeza) e T2 (gatilho das colunas); 4 (campos da receita) → T5 (UFC/U, 21 itens, 11 componentes, 0 e 1e9, 301 caracteres, habilitação retirada entre salvar e preparar), T8 e T9 (habilitação retirada antes do envio); 5 (documento muda por baixo) → T2 (gatilho, FK, anonimização, ponteiros de emitido que só saem), T7, T8 e T9 (versão lida: também o `registrar` e o `marcarFalhou` dos jobs do PDF preparado e da digitalizada).

## Decisões do dono (aprovadas em 05/10/2026)

Todas as ★ do plano único foram **aprovadas pelo dono em 05/10/2026, como recomendadas**, junto com a divisão em 10A e 10B. No 10A: **D1** (LGPD da receita no 10A), **D2** (esquema completo), **D3** (cancelar antes do uso real), **D4** (digitalizada só por fotos), **D5** (cartão no Início + link em Perfil), **D6** (link por 30 dias com "Reenviar") e **D9** (`/security-review` com o checklist reforçado, também no 10B). No 10B: **D7** (âncoras trimestrais pelo Claude, a pedido) e **D8** (gov.br sem CPF: nome + número de série, com 2FA a cada certificado novo), e a parte da D9 sobre a conferência.

Pontos que precisam de atenção (não são decisões):
- **A consulta ao CRN-3 (P-B1)** não bloqueia o desenvolvimento, mas bloqueia a liberação; a D2 (parecer) e a D12 (plano alimentar online) dependem da mesma resposta.
- **Backup no host (P02-11)** segue pendente: sem ele, nada de paciente real.
- **O Plano 09 (fechamento do MVP) vem antes** no roadmap: se ele trouxer migration, os Planos 10A e 10B renumeram as suas no rebase.
- **O Plano 10B** só começa a valer para uso real com os PDFs reais assinados do dono (runbook do 10B, passo 1); até lá, a digitalizada é a forma de assinar.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa com as lentes spec/qualidade e segurança/LGPD, revisão final do branch no fim) — as 16 tarefas dependem umas das outras por interfaces bem definidas (o `registrarAssinatura` da T8 é o mesmo da digitalizada, da entrega e do Plano 10B), e uma falha no gatilho de imutabilidade ou no link sem login é cara de desfazer com receitas reais em produção. Ordem da D21: T1 → T2 → T3 → [T4 ‖ T5] → T6 → T7 → T8 → T9 → T10 → [T11 ‖ T12] → T13 → T14 → T15 → T16. Só a T4 com a T5 (depois da 3) e a T11 com a T12 (depois da 10) correm em paralelo, em worktrees, como nos Planos 06–08.

# Plano 10 — Receita e base de documentos assinados (F3-06): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RASCUNHO — aguardando o dono.** Escrito em 05/10/2026 a partir de `origin/main` @ `62615b9` (Planos 01–08 em produção, migrations 0000–0088, spec do MVP v1.11) e da spec de documentos assinados **v0.3** (commit `e9035f0`, branch `plano-10-receita`). As decisões ★ (D1 a D9 abaixo) precisam do OK do dono antes da execução; a Tarefa 1 (spike) precisa dos PDFs reais assinados que só o dono e a Debby conseguem produzir (runbook, passo 1). Nenhuma linha de código deste plano foi escrita; nada foi rodado no banco. Próximos passos: o dono decide as ★ → `/code-review high` **do plano** (como no Plano 08) → execução.

**Goal:** A nutricionista monta no prontuário uma receita de suplementos e fitoterápicos com os campos que o CFN exige, prepara um PDF com a marca, código de verificação e QR, assina fora do sistema (gov.br ou certificado ICP-Brasil) ou à mão (digitalizada) e envia de volta; o sistema confere a assinatura sem rede e sem serviço pago, trava o documento no banco, entrega ao paciente pelo portal, por link de uso único com código ou pessoalmente, registra a confirmação de recebimento e responde numa página pública de verificação sem dado de saúde.

**Architecture:** Um módulo novo, `src/modules/documentos`, com a base de documento assinado (estados, código Crockford, cópia congelada, imutabilidade no banco), a receita (`prescricao.ts`), a conferência do PDF assinado (leitor **limitado** à atualização incremental + CMS + cadeia + titular, toda a criptografia pelo `node:crypto`), a entrega (portal, link + código, pessoalmente) e a verificação pública. Sete mudanças de banco (0089–0091): `signed_documents` (gatilho `app_documento_imutavel`, política `paciente_so_emitidos`), `signed_document_notes` (STAFF_ONLY), `signed_document_receipts` (só INSERT, a única escrita nova do paciente), `document_access_codes` (link sem login), `document_verifications` (fora da RLS, só `verificacao.ts`, UPDATE só de duas colunas), `tenant_signer` (CPF do assinante, STAFF_ONLY) e as colunas do perfil em `tenants`. O PDF preparado e o PDF da digitalizada nascem no worker (`@react-pdf/renderer`), com um quadro "Assinatura digital" em branco no rodapé de cada página; o envio do PDF assinado é um Route Handler (`/api/painel/documentos/[id]/assinado`) que confere tudo em ≤ 3 s e, no `registrar` do `salvarArquivo`, leva o documento a `assinado`, grava a verificação e enfileira e-mail e push na mesma transação.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Route Handlers, Server Actions, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · Better Auth (`twoFactor`) · `@react-pdf/renderer` 4.9 e `qrcode` 1.5 (já instalados) · **novos:** `pkijs` 3.4 + `asn1js` 3.0 (BSD-3, só leitura de ASN.1) e, só em desenvolvimento, `@peculiar/x509` 2.1 + `reflect-metadata` (AC de teste). Só se a D16 da spec entrar pelo spike: `pdfjs-dist` 6.4 no worker (Tarefa 19).

**Spec:** [`../specs/2026-10-03-nutridebby-documentos-assinados-design.md`](../specs/2026-10-03-nutridebby-documentos-assinados-design.md) (**v0.3**: §2.3 fatias, §3.4 D1, §5 fluxo, §5.1 código, US-140 e US-142 a US-147, RN-140 a RN-145, RN-149 a RN-158, RNF-140 a RNF-145, INT-B1, §10 modelo, §11 P-B1 a P-B11, "Decisões do dono (05/10/2026)") e a spec do MVP [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.11: §4.1, RN-08, RN-15, RN-16, RN-18, RNF-08, RNF-10, RNF-11, US-018, US-046, US-057). Pesquisas da preparação (fora do git): `.superpowers/sdd/2026-10-05-nutridebby-10-preparacao/` (`pesquisa-spec.md`, `pesquisa-codigo.md` G1–G12, `pesquisa-assinatura.md`, `revisao-v02-*.md`). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P10-01 a P10-12).

## Global Constraints

- Tudo dos Planos 01–08 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista (guarda `acoes-de-paciente.test.ts`) e `requireApiNutri` nos Route Handlers dela; `requirePaciente`/`requireApiPaciente` em todo o portal; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500); toda página nova de `src/app/painel/**` renderiza `<Cabecalho` pelo layout (guarda `cabecalho.test.ts`) e entra em `ROTAS_DO_PAINEL` (guarda `rotas-axe.test.ts`) e em `GUIAS` ou `SEM_AJUDA` (guarda `conteudo.test.ts`).
- **Base:** `origin/main` em `62615b9`. As migrations deste plano começam em **`0089`**: `0089_documentos_assinados` (gerada, T2), `0090_rls_documentos` (custom, T2), `0091_documentos_imutaveis` (custom, T3). **O Plano 09 (fechamento do MVP) vem antes no roadmap:** se ele entrar na `main` com migration, renumerar no rebase e corrigir as referências deste plano no PR. Migrations só com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7); **nunca** no banco de dev compartilhado sem combinar, nunca em produção fora do deploy.
- Toda tabela nova com `tenant_id`: `app_enable_tenant_rls`; com `patient_id`, `app_enable_patient_rls`; dado de saúde, `app_enable_audit` + `ENTIDADE_ROTULO`, ou entrada justificada em `AUDIT_EXCEPTIONS`; fábrica em `FABRICAS` de `test/isolamento.test.ts`. CLAUDE.md regras 1, 2, 8 e 9.
- **Escrita do paciente (D1 do Plano 06):** as únicas escritas novas da sessão de paciente são `signed_document_receipts` (`insert`) e `document_access_codes` (`insert`, `update`), cada uma com `SELECT app_allow_paciente_escrita(...)` na migration **e** a entrada em `PACIENTE_ESCREVE`, na mesma tarefa (T2). `signed_documents`, `signed_document_notes`, `tenant_signer` e `document_verifications` ficam fechadas ao paciente.
- **Imutabilidade (RN-140):** quem garante é o gatilho `app_documento_imutavel` no banco (T3), não o código. Nenhum código fora de `app_anonimizar_documentos` limpa `conteudo` ou `pdf_path` de documento emitido.
- **Uma conexão por transação** (Plano 05): dentro do callback de `withTenant` só o `tx` recebido. A conferência do PDF (CPU, até 3 s) roda **fora** de transação; a verificação do código do 2FA (chamada à API do Better Auth) também.
- **Arquivos (regra 9):** PDF base (`documento_base`), PDF assinado (`documento_assinado`) e imagens da digitalizada (`documento_digitalizado`) só por `salvarArquivo` (o `registrar` grava o ponteiro na mesma transação) e `apagarArquivo` (o `naMesmaTransacao` confere/limpa o registro); servir só por `signFileUrl`, com a URL nascendo no clique (rota que responde 303). FKs `NO ACTION` para `stored_files.caminho` (as primeiras do projeto). Nunca montar caminho com texto do usuário.
- **Só o worker:** `documento-pdf.tsx`, `documento-pdf-job.ts`, `digitalizada-job.ts` (e `pdfjs-dist`, se a T19 entrar) fora do grafo do Next — guarda de grafo em `exportacao.test.ts`.
- **Conferência sem rede (RN-144):** nada de `fetch`, `http`, `https`, LCR, OCSP nem `caIssuers` na conferência; guarda de teste na T9.
- RNF-142 / CLAUDE.md regra 3: nada de conteúdo, itens da receita, nome de paciente, CPF, CN do certificado, código de verificação, token, código de 6 dígitos ou caminho de arquivo em log/Sentry; logs só com ids, motivo fixo e o nome do erro; `err.message` do `pkijs`/`asn1js`/leitor nunca vai ao logger.
- Textos de interface em pt-BR, com o texto exato da spec v0.3 quando existir (US-140, US-142 a US-147, RN-157, RN-158). Os textos "(proposto)" da spec e a declaração da receita (D5 da spec) são **rascunho** até a revisão da Debby (runbook, passo 3) — como o manual guiado (P08-08). Textos novos deste plano estão na tabela de desvios (última linha).
- Visual V2 (Plano 08): só os tokens do tema (`bg-fundo`, `bg-cartao`, `text-texto`, `text-suave`, `border-borda`, `text-link`, `border-marca`…), nunca cor fixa em `src/app/painel` e em `src/modules/*/ui` (guarda `cores.test.ts`); componentes `Cartao`, `Botao`/`BotaoLink`, `Aviso`, `Selo`, `Campo`, `ConfirmarBotao`; axe nos três modos (claro, escuro, igual ao aparelho) e 360 px no portal, em `/v` e em `/documento/[token]`.
- Acessibilidade (RNF-10): `<label for>`, `fieldset`/`legend`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso com `role="status"`, alvo de toque ≥ 44 px.
- Custo zero: nenhuma dependência paga, nenhum serviço novo; o VALIDAR do ITI é gratuito e só aparece como link. Os e-mails novos (link e código da D3 b) entram na cota do plano atual do Resend (runbook, passo 6).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos. **Nenhuma variável nova** (as chaves derivam de `ENCRYPTION_KEY` por HKDF; o Turnstile já existe). Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes.
- Política de revisão por entrega (índice, revista em 02/10/2026): revisor por tarefa → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` (com o checklist reforçado, D9). Se sobrar problema Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais.
- **Liberação para uso real** (não é merge): só com a resposta do CRN-3 (P-B1), os textos revistos pela Debby, o termo e o DPA revistos (P-B3, E-09), o backup no host (P02-11) e — pela D3 abaixo — o "Cancelar documento" no ar. Até lá, a nutricionista não vê a aba "Documentos" (interruptor `documentos_liberados` em `tenants`, ligado pelo admin; T7).

### Decisões de desenho (tomadas neste plano — as marcadas com ★ precisam do OK do dono)

| # | Tema | Decisão (aplicada no plano) | Custo / consequência · se o dono escolher outra |
|---|---|---|---|
| D1 ★ | LGPD da receita (spec §2.3 i) | **No Plano 10**: auditoria (gatilho + `auditRead`), exportação da equipe e do titular com os PDFs e a chave `documentos` no `dados.json`, bloqueio (só leitura) e anonimização pela `app_anonimizar_documentos` (Tarefa 16) | +1 tarefa (~1 dia). **Alternativa:** deixar para o Plano 13 e **não** liberar o uso real antes dele — a RN-154 copia o nome do paciente para o conteúdo e o PDF; sem isto, um paciente anonimizado continua identificável e as exportações (US-018/US-046, LGPD art. 18) saem sem as receitas |
| D2 ★ | Esquema completo (spec §2.3 ii) | Os **6 estados**, o gatilho com **todas** as transições (inclusive `substituido`, testado por SQL), as 4 situações da verificação e `signed_document_notes.motivo_cancelamento` nascem aqui; `tipo` só `'receita'` (o Plano 13 amplia o CHECK e cria `exam_ids`) | Sem custo a mais (T2/T3). **Alternativa:** só até `assinado` agora e o Plano 13 reescreve o gatilho de uma tabela que já terá receitas assinadas de verdade (migração mais arriscada) |
| D3 ★ | Cancelar antes do uso real (spec §2.3 iii) | **A US-149 sobe para o Plano 10** (Tarefa 17): "Cancelar documento" com motivo (STAFF_ONLY), e-mail neutro (D11 da spec) e a verificação em "cancelado". A retificação (US-148) continua no Plano 13: a nutricionista cancela e emite uma receita nova | +1 tarefa (~meio dia). **Alternativa:** manter o roadmap e liberar o uso real só depois do Plano 13 — até lá, uma receita assinada com dose errada continua "Documento válido" para a farmácia, e a única saída seria mexer no banco de produção |
| D4 ★ | Digitalizada (opção E) | **Só imagens** (JPEG/PNG, 1 a 5 páginas, 10 MB no total, tipo pelo conteúdo) + código do 2FA; o worker monta um PDF novo com as imagens e o rodapé do código/QR (RN-157). Um PDF enviado como "digitalizado" é recusado ("Envie fotos das páginas (JPEG ou PNG).") | Achado I6 da revisão: um PDF qualquer levaria script, anexo ou ação ao paciente e à farmácia, com a marca do consultório. **Alternativa:** aceitar PDF e rasterizar no worker (`pdfjs-dist` + `@napi-rs/canvas`, ~40 MB a mais na imagem, superfície de ataque do pdf.js) — só se a Debby digitalizar em scanner que só gera PDF |
| D5 ★ | "Documentos" no portal | **Sem aba nova**: cartão "Documentos" no Início (com o número de novos) e link "Meus documentos" em Perfil; `/p/documentos` marca a aba "Perfil" (`tambem`). A barra continua com 7 colunas (R16) | **Alternativas:** trocar uma aba (qual sai?) ou um item "Mais" (uma tela a mais; fica para quando "Exames" e "IA Nutri" chegarem, Planos 12 e 15) |
| D6 ★ | Link da D3 (b) | Válido por **30 dias** e enquanto o documento estiver `assinado`; botão "Reenviar link por e-mail" no painel emite um token novo | **Alternativa:** sem prazo (o link vale enquanto o documento valer) — um e-mail antigo esquecido continua abrindo o documento para quem tiver acesso à caixa de entrada e ao código |
| D7 ★ | Âncoras de confiança (INT-B1) | As raízes e as 180 ACs do ITI e a cadeia gov.br ficam versionadas no repositório; **atualização trimestral feita pelo Claude a pedido do dono** (`pnpm certs:ancoras` + PR revisado), com teste que falha **180 dias** antes de qualquer âncora vencer e item no `docs/operacao/` | Compromisso recorrente (~30 min por trimestre). **Alternativas:** o dono roda o script; ou só quando uma recusa "Tipo de assinatura não aceito" aparecer (e-CPF de AC nova recusado até lá) |
| D8 ★ (condicional) | Certificado gov.br sem CPF em campo próprio | Só se o spike (T1) mostrar que o certificado gov.br **não** traz o CPF num campo próprio: **(a)** RN-145 do gov.br pelo nome completo + o número de série do certificado (que muda a cada renovação anual: a nutricionista confirma com o 2FA a cada certificado novo); (b) aceitar só ICP-Brasil (C) e a digitalizada (E) | (a) mantém o gov.br gratuito, com uma confirmação por ano; (b) tira a opção gratuita de quem não tem e-CPF |
| D9 ★ | `/security-review` do Plano 10 | **Com o checklist reforçado** (como os Planos 01–03 e 05–08): o 10 traz conferência criptográfica própria, parser de PDF, escrita nova do paciente, página pública, link sem login com código e uma função `SECURITY DEFINER` | Sem custo (assinatura). Alternativa: `/security-review` padrão |
| D10 | CPF do assinante | Tabela `tenant_signer` (STAFF_ONLY, RLS de tenant), não colunas em `tenants`: o `PerfilForm` (`'use client'`) recebe o `TenantRow` inteiro e `tenants` é lida no contexto `publico` (G2 da pesquisa). HMAC com chave HKDF `nutridebby:cpf-assinante:v1` + máscara `***.456.789-**` | — |
| D11 | Recebimento (D4 da spec) | Tabela própria `signed_document_receipts`, **só INSERT** (o paciente nunca faz UPDATE em `signed_documents`; achado I2): eventos `aberto` e `recebido`, uma linha por evento (`ON CONFLICT DO NOTHING`), `REVOKE UPDATE, DELETE` | — |
| D12 | Código do link (D3 b) | Tabela própria `document_access_codes` com `patient_id`, escrita pela sessão de paciente **sem login** (`semConta`, `link-documento.ts` em `SEM_CONTA_PERMITIDOS`); em `AUDIT_EXCEPTIONS` (só HMAC, sem dado de saúde; a abertura vira evento auditado no recibo). O token do link não tem estado (MAC com o e-mail atual, como `link-consulta.ts`) | Alternativa da pesquisa (contexto `publico` + `PUBLICO_LIBERADO`) misturaria dois contextos no mesmo fluxo |
| D13 | Quando pedir o código do 2FA | No **primeiro** certificado do consultório, na **troca** de CPF e em **toda** digitalizada (sem certificado ligando a autoria). Mecanismo único `confirmarCodigo2fa` (`src/lib/confirmar-2fa.ts`): `auth.api.verifyTOTP` com a sessão da própria usuária (sem ler `two_factor`), 5 tentativas em 15 min por usuária (contador zerado no acerto), anti-repetição de 90 s e, em `assinar.ts`, registro da recusa no histórico ("Tentativa de assinatura com código recusado") e no log (sem o código). No primeiro certificado, o arquivo é **reenviado** junto com o código (nada fica gravado antes) | Achados I7 e Minor 7 da revisão |
| D14 | Paciente arquivado | Pode redigir, preparar e assinar (como o resto do prontuário, `carregarPacienteParaEscrita`); sem e-mail, push nem link: só "Entregue pessoalmente" (RN-153 v0.3) | — |
| D15 | Área reservada da assinatura | Quadro "Assinatura digital" fixo no rodapé **de cada página**, à direita, 208 × 70 pt (`AREA_ASSINATURA`), gravado em `area_assinatura` no preparo; o widget aceito tem área zero ou cabe nele (2 pt de tolerância). O **campo pré-criado com `/Lock`** (FieldMDP, para o VALIDAR não dar "Indeterminada") só entra se o spike aprovar (constante `CAMPO_PRE_CRIADO`, T1/T8) | Se o assinador do gov.br puser o carimbo onde a pessoa clica: instrução na tela + recusa com texto próprio; se o atrito for alto, a D16 (a) da spec só para a comparação visual (T19) |
| D16 | Nomes no código | "Prescrição" nos identificadores (`prescricao.ts`, `ItemPrescricao`), para não colidir com as receitas culinárias do Plano 07 (`receitas.ts`, `liberarReceitasDoPlano`); no banco e na tela continua "receita" (`tipo = 'receita'`, "Receita") | — |
| D17 | Auditoria de leitura (RNF-142) | `auditRead` na leitura do conteúdo no painel (página do documento) e nas rotas que assinam a URL do PDF (painel, portal e link); a lista do painel e a do portal (título, data, situação) **não** auditam, como a agenda (D10 do Plano 05). O worker não chama `auditRead` (`lerDocumentoNaTransacao(tx, id, { auditar: false })`) | — |
| D18 | Manual guiado | Guia novo **`documentos`** (antes do `prontuario` na lista, padrão `/painel/pacientes/<id>/documentos…`, com os passos "Nova receita", "Preparar para assinatura", "Enviar PDF assinado" e "Entrega"); guia **`configuracoes`** com `versao: 2` (a seção "Dados para documentos"); guia **novo `seguranca`** para `/conta/seguranca` (fora do layout do painel: a própria tela ganha a seção "Como funciona" com o resumo e os passos do guia, sem tour), e o teste do manual passa a cobrir `src/app/conta` | Achado do manual: toda tela nova do painel precisa de guia, e o 2FA passa a ser exigido para assinar |
| D19 | Teste de isolamento | A fábrica de `signed_documents` cria um documento **`assinado` já anonimizado** (visível ao paciente, sem arquivo, para a FK `NO ACTION` não segurar `stored_files`); `signed_document_receipts` em `SO_INSERE`; `IMUTAVEIS` (`signed_documents`, `signed_document_notes`) aceitam a recusa do gatilho (42501) nos testes de WITH CHECK e, em `signed_documents`, o DELETE do tenant B só apaga rascunhos | — |
| D20 | Liberação gradual | Interruptor `tenants.documentos_liberados` (padrão `false`), ligado pelo admin na tela do consultório depois da liberação para uso real (Global Constraints); sem ele, a aba "Documentos" não aparece e as ações respondem 404 | Evita que a Debby use antes da resposta do CRN-3 |
| D21 | Ordem e paralelismo | T1 (spike) → T2 → T3 → [T4, T5, T6 em paralelo] → T7 → T8 → T9 → T10 → [T11, T12] → [T13, T14, T15 em paralelo] → T16 → T17 → T18; T19 só se o relatório do spike pedir. As Tarefas 4, 5 e 6 tocam arquivos diferentes; 13, 14 e 15 também | — |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano)

| Spec v0.3 | Neste plano | Motivo |
|---|---|---|
| §10 `signed_documents` | Colunas a mais: `base_pdf_bytes` (prefixo da RN-144 (2)), `area_assinatura jsonb` (D15), `digitalizacao jsonb` (caminhos das imagens da digitalizada, D4) e `digitalizacao_status` (`pendente`/`falhou`); o gatilho libera `digitalizacao*` só em `aguardando_assinatura` e a limpeza em `assinado` | Implementação da RN-144 e da RN-157 |
| §10 `tenants` | Coluna a mais `documentos_liberados boolean` (D20) | Liberação só depois do CRN-3 |
| US-144 "Sim, sou eu" | O segundo envio leva o **mesmo arquivo** + o código (D13) | Nada gravado antes do 2FA (Minor 7) |
| US-146 lugar | Cartão no Início + link em Perfil (D5) | R16 |
| §5.1 rotas | `GET /api/painel/documentos/[id]/pdf?estado=1` devolve o estado em JSON (sem auditoria); sem `?estado`, 303 para o PDF (com auditoria) | Uma rota para as duas coisas, como a do plano |
| RN-158 | Sessão do link: cookie `nd_doc` com `path=/documento/<token>` **e** `/api/documento/<token>` (dois cookies iguais, um por caminho) | O `path` de um cookie não cobre dois prefixos |
| Textos novos de interface | Painel: "Documentos", "Nova receita", "Receita", "Situação", "Data", "Nenhum documento ainda.", "Itens da receita", "Adicionar item", "Tipo do item", "Remover item {n}", "Categoria", "Componente", "Quantidade", "Unidade", "Adicionar componente", "Forma de apresentação", "Via", "Posologia", "Duração", "Manipulado", "Nomenclatura botânica", "Parte utilizada", "Modo de preparo", "Forma de utilização e preparo", "Nome popular", "Forma farmacêutica", "Dose", "Padronização do marcador", "Forma ou meio de extração", "Orientações gerais", "Justificativa de uso", "Fica no prontuário, não vai na receita.", "Salvar rascunho", "Apagar rascunho", "Apagar este rascunho?", "Rascunho apagado.", "Preparar para assinatura", "Declaração", "Confirmar e preparar", "Preparando o PDF…", "Baixar PDF para assinar", "Enviar PDF assinado", "Enviando…", "Conferindo a assinatura…", "Arquivo do PDF assinado", "Código da verificação em duas etapas", "Sim, sou eu", "Não", "Enviar documento digitalizado (assinado à mão)", "Fotos das páginas (JPEG ou PNG, até 5)", "Montando o PDF digitalizado…", "Não foi possível montar o PDF. Envie as fotos de novo.", "Envie fotos das páginas (JPEG ou PNG).", "Envie de 1 a 5 fotos, até 10 MB no total.", "Baixar PDF assinado", "Entregue pessoalmente", "Marcar como entregue pessoalmente?", "Reenviar link por e-mail", "Link reenviado.", "Documentos aguardando assinatura", "{n} documento(s) aguardando assinatura", "Dados para documentos", "Nome completo", "E-mail profissional", "Telefone profissional", "Registro da habilitação no CRN", "Retirar habilitação", "Habilitação em Fitoterapia retirada do perfil.", "Dados para documentos salvos.", "Assinado por", "Assinado em", "Assinatura", "Código de verificação", "Este documento está em outro paciente ou não existe.", "Documento não encontrado.", "Muitas tentativas. Tente de novo em 15 minutos." · Portal: "Documentos", "Meus documentos", "Abrir PDF", "Confirmo que recebi este documento", "Recebimento confirmado em {data}.", "{n} documento(s) novo(s)" · Link: "Abrir documento", "Para abrir o documento, enviaremos um código de 6 dígitos para o seu e-mail.", "Enviar código", "Código enviado. Confira seu e-mail.", "Código", "Abrir", "Código inválido.", "Código vencido. Peça outro.", "Este link expirou. Peça um novo à sua nutricionista.", "Este documento não está mais disponível. Fale com sua nutricionista.", "Aguarde 1 minuto para pedir outro código." · Verificação: "Verificar documento", "Código de verificação (12 caracteres)", "Verificar", "Documento válido", "Tipo", "Emitido por", "Impressão digital do arquivo (SHA-256)", "Validar a assinatura no validador oficial do ITI" · E-mails: "Você tem um novo documento", "Código para abrir seu documento: {codigo}", "Certificado do consultório confirmado", "Um documento seu foi atualizado" · Push: "Você tem um novo documento." | Telas novas |

### Itens adiados de planos anteriores e débitos da mesma área

**Incorporados:** P-B8 da spec (cartão do Início, T7); P08-11 só no que toca os arquivos mexidos (nenhum item aberto do P08-11 toca `documentos`); o Minor da revisão do Plano 08 sobre o 2FA da nutricionista opcional fica como está (o 2FA passa a ser condição só para assinar).

**Não incorporados:** a retificação (US-148), o parecer (US-141) e a parte de LGPD do parecer (Plano 13); o plano alimentar com código e confirmação (D12 da spec, depende do CRN-3); revogação lida do próprio PDF e cache de LCRs (backlog da spec); os débitos P04-10, P06-12, P07-09 e P08-11 que não tocam documentos (Plano 09).

## Review Focus

1. **PDF assinado que parece certo mas mostra outra coisa.** O mesmo PDF preparado com, na atualização da assinatura: uma `/FreeText` "Vitamina D3 50000 UI" sobre a dose; o widget da assinatura com `/Rect` sobre o conteúdo e um `/AP` que pinta um retângulo branco; a fonte ou o *stream* de conteúdo da página redefinido com o mesmo número de objeto; `/Resources` ou `/MediaBox` trocados; uma revisão depois da assinatura que não é `/DSS`; dois dicionários `/Sig`; `/ByteRange` com `b + c` antes do fim. Esperado: recusa "Este PDF recebeu alterações além da assinatura…" (ou "A assinatura deste PDF não confere…"), documento continua "Aguardando assinatura", nada gravado. Testes na Tarefa 9 (fixtures da Tarefa 1).
2. **Certificado errado na hora certa.** e-CPF vencido (o A1 que ficou com o contador), e-CNPJ da clínica, certificado de outra pessoa no primeiro envio e depois dele, cadeia que termina numa raiz desconhecida, raiz ICP v7 (algoritmo não lido), SHA-1. Esperado: a mensagem certa da US-144 para cada um; nenhum CPF gravado no primeiro envio recusado; o CN e o CPF nunca no log. Testes nas Tarefas 9 e 10.
3. **Código do 2FA no limite.** Código errado 5 vezes, o 6º certo dentro dos 15 min; o mesmo código certo usado duas vezes em 30 s (dois envios); usuária sem 2FA ativo; código com espaço ("123 456"). Esperado: "Muitas tentativas…" a partir da 6ª tentativa, a repetição recusada, "Ative a verificação em duas etapas…" antes de qualquer conferência, o espaço aceito. Testes na Tarefa 5 e na 10.
4. **Link de uso único na caixa de entrada errada.** O GET do link feito pelo leitor de links do Outlook antes do paciente; o link aberto depois de o e-mail do paciente ser corrigido; 6 códigos pedidos em 1 hora; o código certo digitado duas vezes; o link de um documento depois cancelado; a página aberta com o cookie da sessão de outro link. Esperado: o GET não gasta nada; link com e-mail antigo → "Este documento não está mais disponível…"; o 6º pedido recusado; o segundo uso do código recusado; documento cancelado indisponível; a sessão de um link não abre outro. Testes na Tarefa 14.
5. **Receita no limite dos campos.** Probiótico em "mg", enzima em "UI", 21 itens, 11 componentes, quantidade "0" ou "1e9", posologia com 301 caracteres, fitoterápico com a habilitação retirada entre o salvar e o preparar, justificativa vazia só no preparar, "Droga ou derivado vegetal…" sem habilitação (vale). Esperado: as mensagens exatas da US-142 por campo; o servidor confere a habilitação de novo no preparar. Testes na Tarefa 6.

---

## Estrutura de arquivos

```
drizzle/
  0089_documentos_assinados (gerada: 6 tabelas, colunas de tenants, CHECKs de stored_files e notifications)           # T2
  0090_rls_documentos (custom: RLS, staff_only, auditoria, escrita do paciente, paciente_so_emitidos, paciente_arquivos, privilégios)  # T2
  0091_documentos_imutaveis (custom: app_documento_imutavel, app_notas_imutaveis, app_anonimizar_documentos)            # T3
src/db/schema/documentos.ts (+ index.ts) · platform.ts (tenants, stored_files) · agenda.ts (notifications)              # T2
src/db/rls-guard.ts (+test) · audit-guard.ts · tenant.ts (SEM_CONTA_PERMITIDOS) · documentos-schema.test.ts · documentos-imutaveis.test.ts   # T2, T3
src/lib/confirmar-2fa.ts (+test)                                                                                        # T5
src/lib/sentry-filtro.ts (+test) · next.config.ts                                                                       # T14, T15
src/modules/documentos/
  constantes.ts · erros.ts · codigo.ts (+test)                                                                          # T2, T6
  ancoras/{icp-raizes.pem, icp-acs.pem, govbr.pem, fonte.json} · ancoras.ts · ancoras-fonte.test.ts                     # T1
  pdf-leitor.ts (+test)                                                                                                 # T1
  pdf-atualizacao.ts · cms.ts · certificados.ts · assinatura-pades.ts (+tests)                                          # T9
  perfil-profissional.ts (+test)                                                                                        # T4
  prescricao.ts (+test) · documentos.ts (+test)                                                                         # T6
  documento-pdf.tsx · documento-pdf-job.ts (+test) · campo-assinatura.ts                                                # T8
  verificacao.ts (+test) · assinar.ts (+test)                                                                           # T10 (verificacao também em T15, T16, T17)
  digitalizada.ts · digitalizada-job.ts (+test)                                                                         # T11
  entrega.ts · recebimento.ts (+test)                                                                                   # T12
  portal.ts (+test)                                                                                                     # T13
  link-documento.ts (+test)                                                                                             # T14
  lgpd-documentos.ts (+test)                                                                                            # T16
  cancelamento.ts (+test)                                                                                               # T17
  conferencia-visual-job.ts (+test)                                                                                     # T19 (condicional)
src/modules/plataforma/audit.ts · armazenamento.ts                                                                      # T2
src/modules/agenda/limite-ip.ts                                                                                         # T5, T14, T15
src/modules/notificacoes/{tipos,mensagens}.ts · src/email/{types.ts,templates.tsx}                                      # T12, T14, T17
src/modules/pacientes/{lgpd,exportacao-job}.ts (+test)                                                                  # T16
src/modules/ajuda/conteudo.ts (+test)                                                                                   # T4, T5, T7, T18
src/jobs/queues.ts · src/worker/index.ts                                                                                # T8, T11, T14
src/app/painel/configuracoes/perfil/{page.tsx, documentos-form.tsx, actions.ts}                                         # T4
src/app/painel/pacientes/[id]/abas.tsx · documentos/{page.tsx, actions.ts} · documentos/[docId]/{page.tsx, receita-form.tsx, preparar.tsx, enviar-assinado.tsx, enviar-digitalizada.tsx, entrega.tsx, cancelar.tsx}   # T7, T10–T12, T17
src/app/painel/page.tsx (cartão do Início) · src/app/admin/{page.tsx,actions.ts} (interruptor D20)                           # T7
src/app/api/painel/documentos/[id]/{pdf,assinado,digitalizada}/route.ts (+tests)                                        # T8, T10, T11
src/app/conta/seguranca/page.tsx (+ ajuda-seguranca.tsx)                                                                # T5
src/app/p/navegacao.ts · (portal)/documentos/{page.tsx, actions.ts} · (portal)/inicio/page.tsx · (portal)/perfil/page.tsx   # T13
src/app/api/p/documentos/[id]/pdf/route.ts                                                                              # T13
src/app/documento/[token]/{page.tsx, codigo-form.tsx} · src/app/api/documento/[token]/{codigo,confirmar,recebido,pdf}/route.ts   # T14
src/app/v/{page.tsx, [codigo]/page.tsx}                                                                                 # T15
scripts/certs/gerar-ancoras.ts · scripts/certs/relatorio-pdf.ts                                                         # T1
test/assinatura/{fabrica.ts, base-minimo.ts} · test/documentos.ts · test/isolamento.test.ts                             # T1, T2, T6
e2e/documentos.spec.ts · e2e/painel-rotas.ts · e2e/acessibilidade.spec.ts                                               # T7, T18
docs/operacao/ancoras-assinatura.md · docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md               # T1
CLAUDE.md                                                                                                               # T2 (regras 1, 2, 8, 9), T5 (regra 1)
```

**Ordem e dependências:** ver D21. A Tarefa 1 entrega o leitor e a fábrica de PDFs de teste usados pelas Tarefas 9 e 10; o relatório do spike decide `CAMPO_PRE_CRIADO` (T8), a tolerância do fim de linha (T9), onde fica o CPF do gov.br (T9, D8) e se a T19 entra.

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// src/modules/documentos/constantes.ts (T2; sem imports — usado por componentes 'use client')
export const STATUS_DOCUMENTO = ['rascunho', 'preparando', 'aguardando_assinatura', 'assinado', 'substituido', 'cancelado'] as const;
export type StatusDocumento = (typeof STATUS_DOCUMENTO)[number];
export const EMITIDOS: readonly StatusDocumento[] = ['assinado', 'substituido', 'cancelado'];
export type TipoAssinatura = 'govbr' | 'icp' | 'digitalizada';
export type AreaAssinatura = { x1: number; y1: number; x2: number; y2: number };
// src/modules/documentos/codigo.ts (T6)
export function gerarCodigo(): string;                       // 12 caracteres Crockford maiúsculos
export function normalizarCodigo(entrada: unknown): string | null;
export function formatarCodigo(codigo: string): string;      // XXXX-XXXX-XXXX
// src/modules/documentos/pdf-leitor.ts (T1)
export type PdfValor = number | boolean | null | PdfNome | PdfTexto | PdfRef | PdfValor[] | PdfDict | PdfStream;
export function lerAtualizacao(arquivo: Buffer, inicio: number): Atualizacao;    // revisões depois do prefixo
// src/modules/documentos/assinatura-pades.ts (T9)
export function conferirPdfAssinado(arquivo: Buffer, base: BaseDoDocumento, deps?: DepsConferencia): Conferido; // lança RecusaAssinaturaError
// src/modules/documentos/erros.ts (T2)
export class RecusaAssinaturaError extends Error { codigo: CodigoRecusa }
// src/lib/confirmar-2fa.ts (T5)
export function confirmarCodigo2fa(e: { userId: string; codigo: unknown; headers: Headers }, deps?: Deps2fa): Promise<'ok' | 'invalido' | 'bloqueado'>;
// src/modules/documentos/verificacao.ts (T10)
export function registrarVerificacao(tx: Tx, v: NovaVerificacao): Promise<void>;
export function mudarSituacao(tx: Tx, codigo: string, situacao: SituacaoVerificacao, em: Date): Promise<void>;
// src/modules/documentos/entrega.ts (T12)
export function entregarDocumento(tx: Tx, e: EntregaDoDocumento): Promise<'portal' | 'link' | 'nenhuma'>;
```

---
### Task 1: Spike da conferência da assinatura — âncoras, leitor limitado, fábrica de PDFs assinados de teste e relatório (P-B2, D16 da spec; P10-01)

**Objetivo do spike:** responder, com código que fica no repositório, às perguntas da P-B2 antes de escrever a conferência (T9): (1) o leitor limitado lê as atualizações incrementais reais (tabela clássica, *xref stream*, `/ObjStm`)? (2) o gov.br e os programas ICP preservam o PDF preparado como prefixo? (3) que objetos cada um põe na atualização (para a lista fechada da RN-144 (5))? (4) onde fica o CPF no certificado gov.br? (5) o assinador usa o campo pré-criado (FieldMDP) e o VALIDAR aprova? (6) o carimbo visível cabe no quadro "Assinatura digital"? (7) há tolerância de fim de linha depois do `%%EOF`? A saída é o relatório `docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md` (sem nome nem CPF) e a decisão da D16 da spec registrada nele: **leitor síncrono** (T9 como está) ou **plano B** (T19 entra).

**Files:**
- Create: `src/modules/documentos/constantes.ts` (parte inicial), `src/modules/documentos/pdf-leitor.ts`, `src/modules/documentos/pdf-leitor.test.ts`, `src/modules/documentos/pdf-escrita.ts`, `src/modules/documentos/campo-assinatura.ts`, `src/modules/documentos/ancoras.ts`, `src/modules/documentos/ancoras-raizes.ts`, `src/modules/documentos/ancoras/dados.ts` (gerado), `src/modules/documentos/ancoras/fonte.json` (gerado), `src/modules/documentos/ancoras-fonte.test.ts`, `scripts/certs/gerar-ancoras.ts`, `scripts/certs/relatorio-pdf.ts`, `scripts/certs/pdf-de-teste.tsx`, `test/assinatura/base-minimo.ts`, `test/assinatura/fabrica.ts`, `docs/operacao/ancoras-assinatura.md`, `docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md`
- Modify: `package.json` (dependências e scripts `certs:ancoras`, `assinatura:relatorio`, `assinatura:pdf-teste`), `.gitignore` (`test/assinatura/reais/`)

**Interfaces:**
- Consumes: nada do Plano 10 (é a primeira tarefa); `@react-pdf/renderer` e `qrcode` (já instalados) no script do PDF de teste.
- Produces:
  - `constantes.ts`: `AREA_ASSINATURA: AreaAssinatura` (`{ x1: 351, y1: 62, x2: 559, y2: 132 }`, em pontos, origem embaixo à esquerda, A4 595 × 842), `TOLERANCIA_AREA_PT = 2`, `CAMPO_PRE_CRIADO` (boolean decidido pelo relatório; começa `false`), tipos `AreaAssinatura`, `TipoAssinatura`.
  - `pdf-leitor.ts`: tipos `PdfValor`, `PdfNome { n }`, `PdfTexto { s: Buffer; hex: boolean }`, `PdfRef { num; gen }`, `PdfDict { d: Map<string, PdfValor> }`, `PdfStream { dict: PdfDict; dados: Buffer; inicio: number }`, `ObjetoLido { num; gen; valor; offset: number | null; objStm: number | null }`, `Revisao { inicio; fim; xrefOffset; trailer: PdfDict; objetos: Map<number, ObjetoLido>; xrefStream: boolean }`, `BaseLida { objetos: Map<number, ObjetoLido>; trailer: PdfDict; startxref: number; tamanho: number }`; funções `lerBase(buf: Buffer): BaseLida`, `lerAtualizacao(buf: Buffer, inicio: number): Revisao[]`, `pegar(d: PdfDict, chave: string): PdfValor | undefined`, `nomeDe(v): string | null`, `ehDict`, `ehRef`, `ehStream`, `ehNome`, `iguais(a, b): boolean` (comparação estrutural), `percorrer(v, visita)`; erro `PdfIlegivelError { motivo }`; `LIMITES_LEITOR`.
  - `pdf-escrita.ts`: `serializar(v: PdfValor): Buffer`, `nome(n)`, `dict(o)`, `ref(num, gen?)`, `texto(s)`, `hex(buf)`, `escreverAtualizacao(anterior: Buffer, e: { prev: number; size: number; trailer: Record<string, PdfValor>; objetos: { num: number; corpo: Buffer }[] }): Buffer`.
  - `campo-assinatura.ts`: `acrescentarCampoDeAssinatura(pdf: Buffer, area: AreaAssinatura): Buffer` (atualização incremental com o campo vazio e `/Lock`; usado pela T8 só se `CAMPO_PRE_CRIADO`).
  - `ancoras.ts`: `RAIZES_FIXADAS: Record<string, string>` (nome → SHA-256), `carregarAncoras(): Ancoras` com `{ raizes: X509Certificate[]; acs: X509Certificate[]; govbr: { raiz; intermediaria; final }; conjunto(c: X509Certificate): 'icp' | 'govbr' | null }`.
  - `test/assinatura/fabrica.ts`: `criarAc(o?)`, `criarTitular(ac, o)`, `assinarDeTeste(base, titular, o?)`, `pdfBaseDeTeste()`, tipos `AcDeTeste`, `TitularDeTeste`, `OpcoesAssinatura` (variantes válidas e adulteradas da §9.2 da pesquisa).

- [ ] **Step 1: Dependências e `.gitignore`**

```bash
pnpm add pkijs@3.4.1 asn1js@3.0.10
pnpm add -D @peculiar/x509@2.1.0 reflect-metadata@0.2.2
printf '\n# P-B2: PDFs reais assinados (nome e CPF de verdade) — só na máquina de dev\ntest/assinatura/reais/\n' >> .gitignore
```

Em `package.json`, `scripts`: `"certs:ancoras": "tsx scripts/certs/gerar-ancoras.ts"`, `"assinatura:relatorio": "tsx scripts/certs/relatorio-pdf.ts"`, `"assinatura:pdf-teste": "tsx scripts/certs/pdf-de-teste.tsx"`.

- [ ] **Step 2: Constantes iniciais** — `src/modules/documentos/constantes.ts`

```ts
/**
 * Plano 10 — documentos assinados. SEM imports: componentes 'use client' leem daqui (como marca-constantes.ts).
 * A Tarefa 2 acrescenta os estados, os rótulos e as mensagens.
 */
export type TipoAssinatura = 'govbr' | 'icp' | 'digitalizada';
/** Pontos PDF, origem no canto de baixo à esquerda (A4 = 595 × 842). */
export type AreaAssinatura = { x1: number; y1: number; x2: number; y2: number };

/**
 * D15 / RN-144 (6): o quadro "Assinatura digital", em branco, no rodapé de CADA página, à direita (208 × 70 pt), acima
 * da faixa do código e do QR. O widget da assinatura aceito tem área zero ou cabe aqui.
 */
export const AREA_ASSINATURA: AreaAssinatura = { x1: 351, y1: 62, x2: 559, y2: 132 };
export const TOLERANCIA_AREA_PT = 2;

/**
 * §6.5 da pesquisa / INT-B1 "VALIDAR e DocMDP": o PDF preparado ganha um campo de assinatura vazio com /Lock (FieldMDP)?
 * Decidido pelo relatório do spike (Tarefa 1): true só se o gov.br e os programas ICP testados usarem o campo e o VALIDAR
 * aprovar. Mudar aqui muda o PDF base (T8) e a lista fechada aceita o campo pré-criado (T9).
 */
export const CAMPO_PRE_CRIADO = false;
```

- [ ] **Step 3: PDF base mínimo para os testes do leitor** — `test/assinatura/base-minimo.ts`

```ts
/**
 * PDF-1.3 de uma página, xref clássica, sem /ObjStm — a forma do que o @react-pdf gera (pesquisa §8) — escrito à mão para
 * os testes do leitor serem rápidos e determinísticos. Objetos: 1 Catalog, 2 Pages, 3 Page, 4 Contents, 5 Font, 6 Info.
 */
export function baseMinimo(textoDaDose = 'Vitamina D3 2000 UI'): Buffer {
  const conteudo = `BT /F1 12 Tf 72 720 Td (${textoDaDose}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Producer (NutriDebby) >>',
  ];
  let corpo = '%PDF-1.3\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(corpo, 'latin1'));
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(corpo, 'latin1');
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) corpo += `${String(o).padStart(10, '0')} 00000 n \n`;
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, 'latin1');
}
```

- [ ] **Step 4: Testes do leitor (falham)** — `src/modules/documentos/pdf-leitor.test.ts`

```ts
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { baseMinimo } from '../../../test/assinatura/base-minimo';
import { dict, escreverAtualizacao, nome, ref, serializar } from './pdf-escrita';
import { ehStream, iguais, lerAtualizacao, lerBase, LIMITES_LEITOR, nomeDe, pegar, PdfIlegivelError, type PdfDict } from './pdf-leitor';

const ilegivel = (motivo: string) => (e: unknown) => e instanceof PdfIlegivelError && e.motivo === motivo;

describe('leitor limitado de PDF (RN-144, RNF-141)', () => {
  it('lê o PDF base: catálogo, página, stream com /Length direto e o startxref', () => {
    const b = lerBase(baseMinimo());
    const raiz = pegar(b.trailer, 'Root');
    expect(raiz).toEqual({ num: 1, gen: 0 });
    const pagina = b.objetos.get(3)!.valor as PdfDict;
    expect(nomeDe(pegar(pagina, 'Type'))).toBe('Page');
    const conteudo = b.objetos.get(4)!.valor;
    expect(ehStream(conteudo) && conteudo.dados.toString('latin1')).toContain('Vitamina D3 2000 UI');
    expect(b.tamanho).toBe(7);
  });

  it('lê uma atualização incremental com xref clássica e /Prev para o base', () => {
    const base = baseMinimo();
    const b = lerBase(base);
    const novo = escreverAtualizacao(base, {
      prev: b.startxref,
      size: 8,
      trailer: { Root: ref(1), Info: ref(6) },
      objetos: [{ num: 7, corpo: serializar(dict({ Type: nome('Sig'), Contents: { s: Buffer.alloc(4), hex: true } })) }],
    });
    const [rev] = lerAtualizacao(novo, base.length);
    expect(rev.inicio).toBe(base.length);
    expect(rev.fim).toBe(novo.length);
    expect(pegar(rev.trailer, 'Prev')).toBe(b.startxref);
    expect(nomeDe(pegar(rev.objetos.get(7)!.valor as PdfDict, 'Type'))).toBe('Sig');
  });

  it('lê xref stream com preditor PNG e objetos dentro de /ObjStm', () => {
    const base = baseMinimo();
    const b = lerBase(base);
    // ObjStm com o objeto 8 dentro; xref stream (objeto 9) com /W [1 4 2] e Predictor 12
    const dentro = serializar(dict({ Type: nome('Annot'), Subtype: nome('Widget') })).toString('latin1');
    const cabeca = `8 0 `;
    const objStmDados = deflateSync(Buffer.from(cabeca + dentro, 'latin1'));
    const inicioRev = base.length;
    let corpo = Buffer.from('\n');
    const off7 = inicioRev + corpo.length;
    corpo = Buffer.concat([corpo, Buffer.from(`7 0 obj\n<< /Type /ObjStm /N 1 /First ${cabeca.length} /Filter /FlateDecode /Length ${objStmDados.length} >>\nstream\n`), objStmDados, Buffer.from('\nendstream\nendobj\n')]);
    const off9 = inicioRev + corpo.length;
    const linhas = [
      [1, off7, 0],
      [2, 7, 0],
      [1, off9, 0],
    ].map(([t, o, g]) => Buffer.from([t, (o >>> 24) & 255, (o >>> 16) & 255, (o >>> 8) & 255, o & 255, (g >>> 8) & 255, g & 255]));
    // preditor PNG "Up" (tipo 2) linha a linha
    let anterior = Buffer.alloc(7);
    const filtradas = linhas.map((l) => {
      const f = Buffer.alloc(8);
      f[0] = 2;
      for (let i = 0; i < 7; i++) f[i + 1] = (l[i] - anterior[i]) & 255;
      anterior = l;
      return f;
    });
    const xrefDados = deflateSync(Buffer.concat(filtradas));
    corpo = Buffer.concat([corpo, Buffer.from(`9 0 obj\n<< /Type /XRef /Size 10 /Root 1 0 R /Prev ${b.startxref} /W [1 4 2] /Index [7 3] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${xrefDados.length} >>\nstream\n`), xrefDados, Buffer.from(`\nendstream\nendobj\nstartxref\n${off9}\n%%EOF\n`)]);
    const pdf = Buffer.concat([base, corpo]);
    const [rev] = lerAtualizacao(pdf, base.length);
    expect(rev.xrefStream).toBe(true);
    expect(rev.objetos.get(8)!.objStm).toBe(7);
    expect(nomeDe(pegar(rev.objetos.get(8)!.valor as PdfDict, 'Subtype'))).toBe('Widget');
  });

  it('compara valores pela estrutura (nomes decodificados, refs e números), não pelos bytes', () => {
    const b = lerBase(baseMinimo());
    const pagina = b.objetos.get(3)!.valor;
    const reescrita = lerBase(Buffer.from(baseMinimo().toString('latin1').replace('/MediaBox [0 0 595 842]', '/MediaBox [ 0 0 595 842 ]'), 'latin1')).objetos.get(3)!.valor;
    expect(iguais(pagina, reescrita)).toBe(true);
    const outra = lerBase(Buffer.from(baseMinimo().toString('latin1').replace('/MediaBox [0 0 595 842]', '/MediaBox [0 0 595 841]'), 'latin1')).objetos.get(3)!.valor;
    expect(iguais(pagina, outra)).toBe(false);
  });

  it('recusa lixo depois do último %%EOF, objeto fora da revisão, aninhamento demais e inflate grande demais', () => {
    const base = baseMinimo();
    const b = lerBase(base);
    const ok = escreverAtualizacao(base, { prev: b.startxref, size: 8, trailer: { Root: ref(1) }, objetos: [{ num: 7, corpo: Buffer.from('<< >>') }] });
    expect(() => lerAtualizacao(Buffer.concat([ok, Buffer.from('lixo')]), base.length)).toThrow(PdfIlegivelError);
    const fundo = '['.repeat(LIMITES_LEITOR.aninhamento + 5) + ']'.repeat(LIMITES_LEITOR.aninhamento + 5);
    const profundo = escreverAtualizacao(base, { prev: b.startxref, size: 8, trailer: { Root: ref(1) }, objetos: [{ num: 7, corpo: Buffer.from(fundo) }] });
    expect(() => lerAtualizacao(profundo, base.length)).toThrow(PdfIlegivelError);
    try {
      lerAtualizacao(profundo, base.length);
    } catch (e) {
      expect(ilegivel('aninhamento')(e)).toBe(true);
    }
    const bomba = deflateSync(Buffer.alloc(LIMITES_LEITOR.inflateBytes + 1));
    const comBomba = Buffer.concat([base, Buffer.from(`\n7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${bomba.length} >>\nstream\n`), bomba, Buffer.from('\nendstream\nendobj\n')]);
    const off7 = base.length + 1;
    const final = Buffer.concat([comBomba, Buffer.from(`xref\n0 1\n0000000000 65535 f \n7 2\n${String(off7).padStart(10, '0')} 00000 n \n0000000000 00000 n \ntrailer\n<< /Size 9 /Root 1 0 R /Prev ${b.startxref} >>\nstartxref\n${comBomba.length}\n%%EOF\n`)]);
    expect(() => lerAtualizacao(final, base.length)).toThrow(PdfIlegivelError);
  });
});
```

Run: `pnpm test src/modules/documentos/pdf-leitor.test.ts` → FAIL (`Cannot find module './pdf-leitor'`).

- [ ] **Step 5: O leitor** — `src/modules/documentos/pdf-leitor.ts`

```ts
import { inflateSync } from 'node:zlib';

/**
 * RN-144 / RNF-141: leitor PRÓPRIO e LIMITADO de PDF. Lê o PDF base (o nosso, do react-pdf: xref clássica, sem /ObjStm)
 * e as revisões da atualização incremental depois dele (xref clássica ou xref stream, objetos em /ObjStm). Nunca resolve o
 * documento inteiro, nunca executa nada, nunca vai à rede. Qualquer coisa fora do esperado → PdfIlegivelError com um
 * motivo FIXO (vai ao log; nunca o conteúdo).
 */
export class PdfIlegivelError extends Error {
  override name = 'PdfIlegivelError';
  constructor(readonly motivo: string) {
    super('PDF ilegível');
  }
}

export const LIMITES_LEITOR = { aninhamento: 32, objetos: 2000, inflateBytes: 20 * 1024 * 1024, revisoes: 2 } as const;

export type PdfNome = { n: string };
export type PdfTexto = { s: Buffer; hex: boolean };
export type PdfRef = { num: number; gen: number };
export type PdfDict = { d: Map<string, PdfValor> };
export type PdfStream = { dict: PdfDict; dados: Buffer; inicio: number };
export type PdfValor = number | boolean | null | PdfNome | PdfTexto | PdfRef | PdfValor[] | PdfDict | PdfStream;

export type ObjetoLido = { num: number; gen: number; valor: PdfValor; offset: number | null; objStm: number | null };
export type Revisao = { inicio: number; fim: number; xrefOffset: number; trailer: PdfDict; objetos: Map<number, ObjetoLido>; xrefStream: boolean };
export type BaseLida = { objetos: Map<number, ObjetoLido>; trailer: PdfDict; startxref: number; tamanho: number };

export const ehNome = (v: PdfValor | undefined): v is PdfNome => !!v && typeof v === 'object' && 'n' in v;
export const ehRef = (v: PdfValor | undefined): v is PdfRef => !!v && typeof v === 'object' && 'num' in v && 'gen' in v;
export const ehDict = (v: PdfValor | undefined): v is PdfDict => !!v && typeof v === 'object' && 'd' in v;
export const ehStream = (v: PdfValor | undefined): v is PdfStream => !!v && typeof v === 'object' && 'dados' in v;
export const ehTexto = (v: PdfValor | undefined): v is PdfTexto => !!v && typeof v === 'object' && 's' in v;
export const nomeDe = (v: PdfValor | undefined): string | null => (ehNome(v) ? v.n : null);
/** Dicionário de um valor: o próprio, ou o de um stream. */
export const dictDe = (v: PdfValor | undefined): PdfDict | null => (ehDict(v) ? v : ehStream(v) ? v.dict : null);
export const pegar = (d: PdfDict, chave: string): PdfValor | undefined => d.d.get(chave);

/** Comparação estrutural (RN-144 (5): "chave a chave"); streams comparam dicionário E bytes. */
export function iguais(a: PdfValor | undefined, b: PdfValor | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => iguais(x, b[i]));
  if (ehNome(a) || ehNome(b)) return ehNome(a) && ehNome(b) && a.n === b.n;
  if (ehRef(a) || ehRef(b)) return ehRef(a) && ehRef(b) && a.num === b.num && a.gen === b.gen;
  if (ehTexto(a) || ehTexto(b)) return ehTexto(a) && ehTexto(b) && a.s.equals(b.s);
  if (ehStream(a) || ehStream(b)) return ehStream(a) && ehStream(b) && iguais(a.dict, b.dict) && a.dados.equals(b.dados);
  if (ehDict(a) && ehDict(b)) {
    if (a.d.size !== b.d.size) return false;
    for (const [k, v] of a.d) if (!iguais(v, b.d.get(k))) return false;
    return true;
  }
  return false;
}

/** Visita todo valor aninhado (dicionários, arrays, dicionário dos streams). */
export function percorrer(v: PdfValor, visita: (v: PdfValor, chave: string | null) => void, chave: string | null = null, prof = 0): void {
  if (prof > LIMITES_LEITOR.aninhamento) throw new PdfIlegivelError('aninhamento');
  visita(v, chave);
  if (Array.isArray(v)) for (const x of v) percorrer(x, visita, null, prof + 1);
  else if (ehDict(v)) for (const [k, x] of v.d) percorrer(x, visita, k, prof + 1);
  else if (ehStream(v)) percorrer(v.dict, visita, null, prof + 1);
}

const BRANCO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const INTEIRO = /^\d+$/;

type ResolverTamanho = (r: PdfRef) => number | undefined;

class Lexer {
  constructor(
    readonly buf: Buffer,
    public pos: number,
    readonly resolver: ResolverTamanho = () => undefined,
  ) {}

  brancos(): void {
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (BRANCO.has(c)) this.pos++;
      else if (c === 0x25) while (this.pos < this.buf.length && this.buf[this.pos] !== 0x0a && this.buf[this.pos] !== 0x0d) this.pos++;
      else break;
    }
  }

  palavra(): string {
    this.brancos();
    const ini = this.pos;
    while (this.pos < this.buf.length && !BRANCO.has(this.buf[this.pos]) && !DELIM.has(this.buf[this.pos])) this.pos++;
    return this.buf.toString('latin1', ini, this.pos);
  }

  esperar(p: string): void {
    if (this.palavra() !== p) throw new PdfIlegivelError(`esperado_${p}`);
  }

  valor(prof = 0): PdfValor {
    if (prof > LIMITES_LEITOR.aninhamento) throw new PdfIlegivelError('aninhamento');
    this.brancos();
    if (this.pos >= this.buf.length) throw new PdfIlegivelError('fim_inesperado');
    const c = this.buf[this.pos];
    if (c === 0x2f) return this.nome();
    if (c === 0x28) return this.literal();
    if (c === 0x3c && this.buf[this.pos + 1] === 0x3c) return this.dicionario(prof);
    if (c === 0x3c) return this.hexa();
    if (c === 0x5b) {
      this.pos++;
      const arr: PdfValor[] = [];
      for (;;) {
        this.brancos();
        if (this.buf[this.pos] === 0x5d) {
          this.pos++;
          return arr;
        }
        if (this.pos >= this.buf.length) throw new PdfIlegivelError('array_aberto');
        arr.push(this.valor(prof + 1));
      }
    }
    const p = this.palavra();
    if (p === 'true') return true;
    if (p === 'false') return false;
    if (p === 'null') return null;
    if (!NUMERO.test(p)) throw new PdfIlegivelError('token_desconhecido');
    if (INTEIRO.test(p)) {
      // "num gen R"
      const salvo = this.pos;
      const g = this.palavra();
      if (INTEIRO.test(g)) {
        const r = this.palavra();
        if (r === 'R') return { num: Number(p), gen: Number(g) };
      }
      this.pos = salvo;
    }
    return Number(p);
  }

  nome(): PdfNome {
    this.pos++; // '/'
    const ini = this.pos;
    while (this.pos < this.buf.length && !BRANCO.has(this.buf[this.pos]) && !DELIM.has(this.buf[this.pos])) this.pos++;
    const bruto = this.buf.toString('latin1', ini, this.pos);
    return { n: bruto.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
  }

  literal(): PdfTexto {
    this.pos++; // '('
    const out: number[] = [];
    let nivel = 1;
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++];
      if (c === 0x5c) {
        const e = this.buf[this.pos++];
        const mapa: Record<number, number> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (e in mapa) out.push(mapa[e]);
        else if (e >= 0x30 && e <= 0x37) {
          let o = e - 0x30;
          for (let i = 0; i < 2 && this.buf[this.pos] >= 0x30 && this.buf[this.pos] <= 0x37; i++) o = o * 8 + (this.buf[this.pos++] - 0x30);
          out.push(o & 255);
        } else if (e === 0x0d) {
          if (this.buf[this.pos] === 0x0a) this.pos++;
        } else if (e !== 0x0a) out.push(e);
        continue;
      }
      if (c === 0x28) nivel++;
      if (c === 0x29 && --nivel === 0) return { s: Buffer.from(out), hex: false };
      out.push(c);
    }
    throw new PdfIlegivelError('texto_aberto');
  }

  hexa(): PdfTexto {
    const fim = this.buf.indexOf(0x3e, this.pos + 1);
    if (fim < 0) throw new PdfIlegivelError('hex_aberto');
    const limpo = this.buf.toString('latin1', this.pos + 1, fim).replace(/[\s\0]/g, '');
    if (!/^[0-9a-fA-F]*$/.test(limpo)) throw new PdfIlegivelError('hex_invalido');
    this.pos = fim + 1;
    return { s: Buffer.from(limpo.length % 2 ? `${limpo}0` : limpo, 'hex'), hex: true };
  }

  dicionario(prof: number): PdfDict | PdfStream {
    this.pos += 2;
    const d = new Map<string, PdfValor>();
    for (;;) {
      this.brancos();
      if (this.buf[this.pos] === 0x3e && this.buf[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.buf[this.pos] !== 0x2f) throw new PdfIlegivelError('chave_invalida');
      const k = this.nome().n;
      d.set(k, this.valor(prof + 1));
    }
    const dict: PdfDict = { d };
    const salvo = this.pos;
    if (this.palavra() !== 'stream') {
      this.pos = salvo;
      return dict;
    }
    // "stream" + CRLF ou LF
    if (this.buf[this.pos] === 0x0d) this.pos++;
    if (this.buf[this.pos] === 0x0a) this.pos++;
    const inicio = this.pos;
    const len = pegar(dict, 'Length');
    const tamanho = typeof len === 'number' ? len : ehRef(len) ? this.resolver(len) : undefined;
    if (tamanho === undefined || !Number.isInteger(tamanho) || tamanho < 0 || inicio + tamanho > this.buf.length) throw new PdfIlegivelError('stream_sem_tamanho');
    this.pos = inicio + tamanho;
    this.esperar('endstream');
    return { dict, dados: this.buf.subarray(inicio, inicio + tamanho), inicio };
  }
}

/** "num gen obj <valor> endobj" no offset. */
function objetoEm(buf: Buffer, offset: number, resolver?: ResolverTamanho): { num: number; gen: number; valor: PdfValor } {
  const lx = new Lexer(buf, offset, resolver);
  const num = lx.palavra();
  const gen = lx.palavra();
  if (!INTEIRO.test(num) || !INTEIRO.test(gen)) throw new PdfIlegivelError('cabecalho_de_objeto');
  lx.esperar('obj');
  const valor = lx.valor();
  return { num: Number(num), gen: Number(gen), valor };
}

function inflar(dados: Buffer): Buffer {
  try {
    return inflateSync(dados, { maxOutputLength: LIMITES_LEITOR.inflateBytes });
  } catch {
    throw new PdfIlegivelError('inflate');
  }
}

/** /DecodeParms com /Predictor ≥ 10 (PNG), o comum nas xref streams. */
function desfazerPreditor(dados: Buffer, parms: PdfValor | undefined): Buffer {
  const p = ehDict(parms) ? parms : null;
  const preditor = p ? pegar(p, 'Predictor') : undefined;
  if (preditor === undefined || preditor === 1) return dados;
  if (typeof preditor !== 'number' || preditor < 10) throw new PdfIlegivelError('preditor');
  const colunas = (p && pegar(p, 'Columns')) ?? 1;
  if (typeof colunas !== 'number' || colunas < 1) throw new PdfIlegivelError('preditor');
  const linha = colunas + 1;
  if (dados.length % linha) throw new PdfIlegivelError('preditor');
  const out = Buffer.alloc((dados.length / linha) * colunas);
  let anterior = Buffer.alloc(colunas);
  for (let i = 0; i < dados.length / linha; i++) {
    const tipo = dados[i * linha];
    const atual = Buffer.from(dados.subarray(i * linha + 1, (i + 1) * linha));
    for (let j = 0; j < colunas; j++) {
      const a = j ? atual[j - 1] : 0;
      const b = anterior[j];
      const c = j ? anterior[j - 1] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const soma = [0, a, b, (a + b) >> 1, paeth][tipo];
      if (soma === undefined) throw new PdfIlegivelError('preditor');
      atual[j] = (atual[j] + soma) & 255;
    }
    atual.copy(out, i * colunas);
    anterior = atual;
  }
  return out;
}

function decodificar(s: PdfStream): Buffer {
  const filtro = pegar(s.dict, 'Filter');
  const filtros = Array.isArray(filtro) ? filtro : filtro === undefined ? [] : [filtro];
  if (filtros.length > 1 || (filtros.length === 1 && nomeDe(filtros[0]) !== 'FlateDecode')) throw new PdfIlegivelError('filtro');
  const cru = filtros.length ? inflar(s.dados) : s.dados;
  return desfazerPreditor(cru, pegar(s.dict, 'DecodeParms'));
}

type Entrada = { tipo: 'n'; offset: number; gen: number } | { tipo: 'o'; stm: number; indice: number } | { tipo: 'f' };

function lerXref(buf: Buffer, offset: number): { entradas: Map<number, Entrada>; trailer: PdfDict; stream: boolean } {
  const lx = new Lexer(buf, offset);
  const salvo = lx.pos;
  if (lx.palavra() === 'xref') {
    const entradas = new Map<number, Entrada>();
    for (;;) {
      const antes = lx.pos;
      const w = lx.palavra();
      if (w === 'trailer') break;
      const qtd = lx.palavra();
      if (!INTEIRO.test(w) || !INTEIRO.test(qtd)) throw new PdfIlegivelError('xref');
      if (Number(qtd) > LIMITES_LEITOR.objetos) throw new PdfIlegivelError('objetos_demais');
      for (let i = 0; i < Number(qtd); i++) {
        const o = lx.palavra(), g = lx.palavra(), t = lx.palavra();
        if (!INTEIRO.test(o) || !INTEIRO.test(g) || (t !== 'n' && t !== 'f')) throw new PdfIlegivelError('xref');
        entradas.set(Number(w) + i, t === 'n' ? { tipo: 'n', offset: Number(o), gen: Number(g) } : { tipo: 'f' });
      }
      if (lx.pos === antes) throw new PdfIlegivelError('xref');
    }
    const trailer = lx.valor();
    if (!ehDict(trailer)) throw new PdfIlegivelError('trailer');
    return { entradas, trailer, stream: false };
  }
  lx.pos = salvo;
  // xref stream: o próprio objeto no offset
  const { valor } = objetoEm(buf, offset);
  if (!ehStream(valor) || nomeDe(pegar(valor.dict, 'Type')) !== 'XRef') throw new PdfIlegivelError('xref');
  const W = pegar(valor.dict, 'W');
  const size = pegar(valor.dict, 'Size');
  if (!Array.isArray(W) || W.length !== 3 || !W.every((x) => typeof x === 'number' && x >= 0 && x <= 8) || typeof size !== 'number') throw new PdfIlegivelError('xref');
  const [w1, w2, w3] = W as number[];
  const idx = pegar(valor.dict, 'Index') ?? [0, size];
  if (!Array.isArray(idx) || idx.length % 2 || !idx.every((x) => typeof x === 'number')) throw new PdfIlegivelError('xref');
  const dados = decodificar(valor);
  const larg = w1 + w2 + w3;
  const campo = (pos: number, w: number) => {
    let v = 0;
    for (let i = 0; i < w; i++) v = v * 256 + dados[pos + i];
    return v;
  };
  const entradas = new Map<number, Entrada>();
  let pos = 0;
  for (let k = 0; k < idx.length; k += 2) {
    const inicio = idx[k] as number, qtd = idx[k + 1] as number;
    if (qtd > LIMITES_LEITOR.objetos) throw new PdfIlegivelError('objetos_demais');
    for (let i = 0; i < qtd; i++, pos += larg) {
      if (pos + larg > dados.length) throw new PdfIlegivelError('xref');
      const t = w1 ? campo(pos, w1) : 1;
      const a = campo(pos + w1, w2), b = campo(pos + w1 + w2, w3);
      entradas.set(inicio + i, t === 1 ? { tipo: 'n', offset: a, gen: b } : t === 2 ? { tipo: 'o', stm: a, indice: b } : { tipo: 'f' });
    }
  }
  return { entradas, trailer: valor.dict, stream: true };
}

/** O último "startxref N" antes do fim (ou antes de `ate`). */
function ultimoStartxref(buf: Buffer, ate: number): number {
  const i = buf.lastIndexOf('startxref', ate, 'latin1');
  if (i < 0) throw new PdfIlegivelError('sem_startxref');
  const lx = new Lexer(buf, i + 9);
  const n = lx.palavra();
  if (!INTEIRO.test(n)) throw new PdfIlegivelError('sem_startxref');
  return Number(n);
}

/** Objetos de uma xref restritos a [inicio, fim); objetos de /ObjStm do mesmo intervalo. */
function lerObjetos(buf: Buffer, entradas: Map<number, Entrada>, inicio: number, fim: number, apagadoProibido: boolean): Map<number, ObjetoLido> {
  if (entradas.size > LIMITES_LEITOR.objetos) throw new PdfIlegivelError('objetos_demais');
  const porNum = new Map<number, ObjetoLido>();
  const resolver: ResolverTamanho = (r) => {
    const e = entradas.get(r.num);
    if (!e || e.tipo !== 'n' || e.offset < inicio || e.offset >= fim) return undefined;
    const v = objetoEm(buf, e.offset).valor;
    return typeof v === 'number' ? v : undefined;
  };
  const stms = new Map<number, Map<number, PdfValor>>();
  for (const [num, e] of entradas) {
    if (num === 0) continue;
    if (e.tipo === 'f') {
      if (apagadoProibido) throw new PdfIlegivelError('objeto_apagado');
      continue;
    }
    if (e.tipo === 'n') {
      if (e.offset < inicio || e.offset >= fim) throw new PdfIlegivelError('objeto_fora_da_revisao');
      const o = objetoEm(buf, e.offset, resolver);
      if (o.num !== num) throw new PdfIlegivelError('numero_de_objeto');
      porNum.set(num, { num, gen: o.gen, valor: o.valor, offset: e.offset, objStm: null });
      continue;
    }
    let conteudo = stms.get(e.stm);
    if (!conteudo) {
      const es = entradas.get(e.stm);
      if (!es || es.tipo !== 'n' || es.offset < inicio || es.offset >= fim) throw new PdfIlegivelError('objstm_fora_da_revisao');
      const s = objetoEm(buf, es.offset, resolver).valor;
      if (!ehStream(s) || nomeDe(pegar(s.dict, 'Type')) !== 'ObjStm') throw new PdfIlegivelError('objstm');
      const n = pegar(s.dict, 'N'), first = pegar(s.dict, 'First');
      if (typeof n !== 'number' || typeof first !== 'number' || n > LIMITES_LEITOR.objetos) throw new PdfIlegivelError('objstm');
      const dados = decodificar(s);
      const lx = new Lexer(dados, 0);
      const pares: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = lx.palavra(), b = lx.palavra();
        if (!INTEIRO.test(a) || !INTEIRO.test(b)) throw new PdfIlegivelError('objstm');
        pares.push([Number(a), Number(b)]);
      }
      conteudo = new Map();
      for (const [onum, off] of pares) conteudo.set(onum, new Lexer(dados, first + off).valor());
      stms.set(e.stm, conteudo);
    }
    const v = conteudo.get(num);
    if (v === undefined) throw new PdfIlegivelError('objstm');
    porNum.set(num, { num, gen: 0, valor: v, offset: null, objStm: e.stm });
  }
  return porNum;
}

/** O PDF base (o nosso): uma revisão, xref clássica. */
export function lerBase(buf: Buffer): BaseLida {
  const startxref = ultimoStartxref(buf, buf.length);
  const { entradas, trailer } = lerXref(buf, startxref);
  if (pegar(trailer, 'Prev') !== undefined) throw new PdfIlegivelError('base_com_revisoes');
  const size = pegar(trailer, 'Size');
  if (typeof size !== 'number') throw new PdfIlegivelError('trailer');
  return { objetos: lerObjetos(buf, entradas, 0, buf.length, false), trailer, startxref, tamanho: size };
}

const EOL = (buf: Buffer, i: number) => (buf[i] === 0x0d && buf[i + 1] === 0x0a ? 2 : buf[i] === 0x0a || buf[i] === 0x0d ? 1 : 0);

/**
 * RN-144 (3): as revisões depois de `inicio` (o fim do PDF base). Cada uma termina em "%%EOF" + fim de linha opcional; o
 * arquivo termina exatamente no fim da última (nada depois). Cada xref fica dentro da própria revisão e o /Prev aponta
 * para o startxref anterior (o do base, na primeira) — conferido em pdf-atualizacao.ts (T9).
 */
export function lerAtualizacao(buf: Buffer, inicio: number): Revisao[] {
  const revisoes: Revisao[] = [];
  let ini = inicio;
  while (ini < buf.length) {
    const eof = buf.indexOf('%%EOF', ini, 'latin1');
    if (eof < 0) throw new PdfIlegivelError('lixo_no_fim');
    const fim = eof + 5 + EOL(buf, eof + 5);
    if (revisoes.length >= LIMITES_LEITOR.revisoes) throw new PdfIlegivelError('revisoes_demais');
    const xrefOffset = ultimoStartxref(buf, eof);
    if (xrefOffset < ini || xrefOffset >= eof) throw new PdfIlegivelError('xref_fora_da_revisao');
    const { entradas, trailer, stream } = lerXref(buf, xrefOffset);
    // a própria xref stream é um objeto da revisão: entra no mapa (é conferida como "xref", não como conteúdo)
    const objetos = lerObjetos(buf, entradas, ini, eof, true);
    revisoes.push({ inicio: ini, fim, xrefOffset, trailer, objetos, xrefStream: stream });
    ini = fim;
  }
  if (!revisoes.length) throw new PdfIlegivelError('sem_atualizacao');
  return revisoes;
}
```

Run: `pnpm test src/modules/documentos/pdf-leitor.test.ts` → ainda FAIL (falta `pdf-escrita.ts`).

- [ ] **Step 6: Escrita de atualização incremental** — `src/modules/documentos/pdf-escrita.ts`

```ts
import type { PdfDict, PdfNome, PdfRef, PdfTexto, PdfValor } from './pdf-leitor';
import { ehDict, ehNome, ehRef, ehStream, ehTexto } from './pdf-leitor';

/** Usado pela fábrica de PDFs de teste (T1) e, no worker, pelo campo pré-criado (T8, se CAMPO_PRE_CRIADO). */
export const nome = (n: string): PdfNome => ({ n });
export const ref = (num: number, gen = 0): PdfRef => ({ num, gen });
export const texto = (s: string): PdfTexto => ({ s: Buffer.from(s, 'latin1'), hex: false });
export const hex = (s: Buffer): PdfTexto => ({ s, hex: true });
export const dict = (o: Record<string, PdfValor>): PdfDict => ({ d: new Map(Object.entries(o)) });

const nomeSeguro = (n: string) => n.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

export function serializar(v: PdfValor): Buffer {
  if (v === null) return Buffer.from('null');
  if (typeof v === 'boolean') return Buffer.from(v ? 'true' : 'false');
  if (typeof v === 'number') return Buffer.from(Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('['), ...v.flatMap((x, i) => (i ? [Buffer.from(' '), serializar(x)] : [serializar(x)])), Buffer.from(']')]);
  if (ehNome(v)) return Buffer.from(`/${nomeSeguro(v.n)}`, 'latin1');
  if (ehRef(v)) return Buffer.from(`${v.num} ${v.gen} R`);
  if (ehTexto(v)) return v.hex ? Buffer.from(`<${v.s.toString('hex').toUpperCase()}>`) : Buffer.concat([Buffer.from('('), Buffer.from(v.s.toString('latin1').replace(/([\\()])/g, '\\$1'), 'latin1'), Buffer.from(')')]);
  if (ehStream(v)) return Buffer.concat([serializar(dict({ ...Object.fromEntries(v.dict.d), Length: v.dados.length })), Buffer.from('\nstream\n'), v.dados, Buffer.from('\nendstream')]);
  if (ehDict(v)) return Buffer.concat([Buffer.from('<<'), ...[...v.d].flatMap(([k, x]) => [Buffer.from(`/${nomeSeguro(k)} `, 'latin1'), serializar(x), Buffer.from(' ')]), Buffer.from('>>')]);
  throw new Error('valor PDF desconhecido');
}

/**
 * Acrescenta uma revisão (atualização incremental) ao fim de `anterior`: os objetos, uma xref clássica com uma subseção por
 * faixa contínua de números, o trailer com /Prev e o "%%EOF\n".
 */
export function escreverAtualizacao(
  anterior: Buffer,
  e: { prev: number; size: number; trailer: Record<string, PdfValor>; objetos: { num: number; corpo: Buffer }[] },
): Buffer {
  const partes: Buffer[] = [anterior, Buffer.from('\n')];
  let pos = anterior.length + 1;
  const offsets = new Map<number, number>();
  for (const o of [...e.objetos].sort((a, b) => a.num - b.num)) {
    offsets.set(o.num, pos);
    const b = Buffer.concat([Buffer.from(`${o.num} 0 obj\n`), o.corpo, Buffer.from('\nendobj\n')]);
    partes.push(b);
    pos += b.length;
  }
  const xref = pos;
  const nums = [...offsets.keys()];
  let tabela = 'xref\n0 1\n0000000000 65535 f \n';
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    tabela += `${nums[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k++) tabela += `${String(offsets.get(nums[k])).padStart(10, '0')} 00000 n \n`;
    i = j + 1;
  }
  const trailer = serializar(dict({ ...e.trailer, Size: e.size, Prev: e.prev })).toString('latin1');
  partes.push(Buffer.from(`${tabela}trailer\n${trailer}\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}
```

Run: `pnpm test src/modules/documentos/pdf-leitor.test.ts` → PASS (5 testes).

- [ ] **Step 7: Âncoras — script de geração** — `scripts/certs/gerar-ancoras.ts`

```ts
/**
 * INT-B1 / D7: baixa as ACs da ICP-Brasil (arquivo único do ITI, por HTTP — o HTTPS do acraiz manda a cadeia TLS
 * incompleta), confere o SHA-512 publicado e aceita uma AC SÓ se ela encadeia até uma raiz FIXADA pelo SHA-256 em
 * src/modules/documentos/ancoras.ts (o zip é dado não confiável). Grava ancoras/dados.ts e ancoras/fonte.json.
 * Roda na máquina de dev (Claude, a pedido do dono, D7), nunca no CI. Uso: pnpm certs:ancoras
 */
import { createHash, X509Certificate } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { unzipSync } from 'fflate';
import { GOVBR_PEM, RAIZES_FIXADAS, RAIZES_ICP_PEM } from '../../src/modules/documentos/ancoras-raizes';

const ZIP = 'http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip';
const HASH = 'http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/hashsha512.txt';

const baixar = (url: string) =>
  new Promise<Buffer>((ok, erro) =>
    get(url, (r) => {
      if (r.statusCode !== 200) return erro(new Error(`HTTP ${r.statusCode} em ${url}`));
      const partes: Buffer[] = [];
      r.on('data', (p: Buffer) => partes.push(p)).on('end', () => ok(Buffer.concat(partes))).on('error', erro);
    }).on('error', erro),
  );

const sha256 = (c: X509Certificate) => c.fingerprint256;
const comoPem = (c: X509Certificate) => c.toString().trim();
const ler = (b: Uint8Array): X509Certificate[] => {
  const t = Buffer.from(b).toString('latin1');
  const pems = t.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return pems ? pems.map((p) => new X509Certificate(p)) : [new X509Certificate(Buffer.from(b))];
};

async function main() {
  const zip = await baixar(ZIP);
  const publicado = (await baixar(HASH)).toString('latin1').match(/[0-9a-fA-F]{128}/)?.[0]?.toLowerCase();
  const calculado = createHash('sha512').update(zip).digest('hex');
  if (publicado !== calculado) throw new Error('SHA-512 do zip não confere com o publicado pelo ITI');

  const raizes = RAIZES_ICP_PEM.map((p) => new X509Certificate(p));
  for (const r of raizes) if (!Object.values(RAIZES_FIXADAS).includes(sha256(r))) throw new Error('raiz embutida não confere com a fixada');
  const candidatas = Object.values(unzipSync(new Uint8Array(zip))).flatMap(ler).filter((c) => c.ca);
  const aceitas: X509Certificate[] = [];
  const confiaveis = [...raizes];
  // encadeia em rodadas: AC filha de AC aceita entra na rodada seguinte
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const c of candidatas) {
      if (aceitas.includes(c) || raizes.some((r) => sha256(r) === sha256(c))) continue;
      const emissor = confiaveis.find((e) => c.checkIssued(e) && (() => { try { return c.verify(e.publicKey); } catch { return false; } })());
      if (emissor) {
        aceitas.push(c);
        confiaveis.push(c);
        mudou = true;
      }
    }
  }
  const recusadas = candidatas.filter((c) => !aceitas.includes(c) && !raizes.some((r) => sha256(r) === sha256(c)));
  const govbr = GOVBR_PEM.map((p) => new X509Certificate(p));
  const linha = (c: X509Certificate) => ({ sujeito: c.subject.replace(/\n/g, ', '), sha256: sha256(c), validoAte: new Date(c.validTo).toISOString() });
  writeFileSync(
    'src/modules/documentos/ancoras/dados.ts',
    `// GERADO por scripts/certs/gerar-ancoras.ts em ${new Date().toISOString()} — não editar à mão (INT-B1, D7)\n` +
      `export const ACS_ICP_PEM: readonly string[] = ${JSON.stringify(aceitas.sort((a, b) => sha256(a).localeCompare(sha256(b))).map(comoPem), null, 1)};\n`,
  );
  writeFileSync(
    'src/modules/documentos/ancoras/fonte.json',
    `${JSON.stringify({ zip: ZIP, baixadoEm: new Date().toISOString(), sha512Zip: calculado, raizes: raizes.map(linha), govbr: govbr.map(linha), acs: aceitas.map(linha), recusadas: recusadas.length }, null, 1)}\n`,
  );
  console.log(`ACs aceitas: ${aceitas.length}; recusadas (sem cadeia até raiz fixada, ex.: v7): ${recusadas.length}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

`src/modules/documentos/ancoras-raizes.ts` traz os PEM das raízes ICP-Brasil v4, v5, v6, v10, v11, v12 e v13 (`RAIZES_ICP_PEM`), os 3 da cadeia gov.br (`GOVBR_PEM`) e `RAIZES_FIXADAS` com os SHA-256 da tabela da §3.1 e da §3.3 da pesquisa — copiados do `openssl x509 -fingerprint -sha256` dos arquivos baixados de `acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasil{vN}.crt` e do `Cadeia_GovBr-der.p7b` (autenticado pelas LCRs de `repo.iti.br`), **conferidos no PR pelo revisor contra a pesquisa**:

```ts
/** INT-B1: âncoras FIXADAS no código (revisadas no PR). O zip do ITI só entra se encadear até uma destas. */
export const RAIZES_FIXADAS: Record<string, string> = {
  'AC Raiz ICP-Brasil v4': 'F0:C1:5A:FD:25:8F:B6:74:E7:A9:6E:1A:50:FF:87:31:49:36:4B:9E:C7:0D:4D:93:C7:A9:F1:EB:60:60:D0:20',
  'AC Raiz ICP-Brasil v5': 'CA:A5:3F:C6:09:1C:69:51:88:7C:97:6E:37:8F:6E:F8:9A:A6:37:7C:55:D9:7B:64:75:42:2B:71:ED:7E:9B:17',
  'AC Raiz ICP-Brasil v6': '3B:DB:9B:50:93:52:F1:D3:D7:1C:2B:F6:4D:9A:38:A4:E6:CE:BD:A2:78:09:D7:7F:7A:C4:76:CB:DE:6E:31:4A',
  'AC Raiz ICP-Brasil v10': '6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6',
  'AC Raiz ICP-Brasil v11': '14:06:71:00:58:18:0F:A4:08:1A:AB:3F:24:6F:17:02:42:9C:55:2A:11:FA:31:43:B8:4C:88:CB:3A:B8:E5:E7',
  'AC Raiz ICP-Brasil v12': 'D8:47:8E:37:CE:19:C6:90:CF:65:73:81:E6:8F:E6:00:E4:E1:A0:42:53:68:30:F0:68:47:E0:3E:55:4C:4B:01',
  'AC Raiz ICP-Brasil v13': '2B:07:D0:BC:02:C4:A6:E0:47:8E:D2:2D:0D:99:E8:F9:7E:18:27:B2:69:09:76:96:A7:FE:B6:AA:D3:0C:3A:C8',
  'Raiz do Governo Federal do Brasil v1 (gov.br)': '16:3B:D0:03:BC:0D:F2:BE:AB:88:17:4B:6D:5B:45:0B:6E:1D:C9:73:A6:4B:2D:C2:A3:32:18:54:4F:49:EF:4E',
  'AC Intermediaria do Governo Federal do Brasil v1': 'C9:6F:8B:6D:E0:22:11:97:17:DF:D2:AE:B6:33:4E:98:03:6A:AE:B5:C3:81:8B:4D:84:BE:1D:26:79:26:D2:E7',
  'AC Final do Governo Federal do Brasil v1': '96:BB:5C:41:85:9F:C5:1D:88:F3:05:51:7B:E6:41:D9:EF:4A:5D:60:1B:1B:B2:35:2E:71:61:E9:7F:F8:B8:52',
};
/** PEM das 7 raízes ICP ativas suportadas (v1/v2 expiradas; v7 com algoritmo que o OpenSSL não lê) — colados do download. */
export const RAIZES_ICP_PEM: readonly string[] = [/* 7 blocos "-----BEGIN CERTIFICATE-----…" colados no Step 7, na ordem v4, v5, v6, v10, v11, v12, v13 */];
/** PEM da cadeia gov.br (raiz, intermediária, final), na ordem. */
export const GOVBR_PEM: readonly string[] = [/* 3 blocos colados no Step 7 */];
```

> Os PEM são dado público baixado na hora do Step 7 (não cabem neste plano). O `ancoras-fonte.test.ts` (Step 8) falha se faltar um ou se o SHA-256 não bater com `RAIZES_FIXADAS`, então o arquivo não sobe incompleto.

Run: `pnpm certs:ancoras` → "ACs aceitas: ~179; recusadas …: ~1".

- [ ] **Step 8: Âncoras — carga e teste de fonte e de vencimento** — `src/modules/documentos/ancoras.ts` e `ancoras-fonte.test.ts`

```ts
// src/modules/documentos/ancoras.ts
import { X509Certificate } from 'node:crypto';
import { ACS_ICP_PEM } from './ancoras/dados';
import { GOVBR_PEM, RAIZES_FIXADAS, RAIZES_ICP_PEM } from './ancoras-raizes';

export { RAIZES_FIXADAS };
export type Ancoras = {
  raizesIcp: X509Certificate[];
  acsIcp: X509Certificate[];
  govbr: { raiz: X509Certificate; intermediaria: X509Certificate; final: X509Certificate };
};

let cache: Ancoras | undefined;
/** RN-144 (9): as âncoras do repositório (lidas uma vez por processo). Os testes passam as da AC de teste por injeção. */
export function carregarAncoras(): Ancoras {
  if (cache) return cache;
  const [raiz, intermediaria, final] = GOVBR_PEM.map((p) => new X509Certificate(p));
  cache = { raizesIcp: RAIZES_ICP_PEM.map((p) => new X509Certificate(p)), acsIcp: ACS_ICP_PEM.map((p) => new X509Certificate(p)), govbr: { raiz, intermediaria, final } };
  return cache;
}
```

```ts
// src/modules/documentos/ancoras-fonte.test.ts
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fonte from './ancoras/fonte.json';
import { carregarAncoras, RAIZES_FIXADAS } from './ancoras';

const DIAS_ALARME = 180;

describe('âncoras de confiança (INT-B1, D7)', () => {
  const a = carregarAncoras();
  it('as raízes e a cadeia gov.br embutidas são exatamente as fixadas', () => {
    const embutidas = [...a.raizesIcp, a.govbr.raiz, a.govbr.intermediaria, a.govbr.final].map((c) => c.fingerprint256).sort();
    expect(embutidas).toEqual(Object.values(RAIZES_FIXADAS).sort());
  });
  it('dados.ts confere com o fonte.json (hash de cada AC) e não tem repetidas', () => {
    expect(a.acsIcp.map((c) => c.fingerprint256).sort()).toEqual(fonte.acs.map((x) => x.sha256).sort());
    expect(new Set(a.acsIcp.map((c) => c.fingerprint256)).size).toBe(a.acsIcp.length);
  });
  it('toda AC encadeia até uma raiz fixada (o zip do ITI é dado não confiável)', () => {
    const confiaveis: X509Certificate[] = [...a.raizesIcp];
    const faltam = new Set(a.acsIcp);
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const c of [...faltam]) {
        if (confiaveis.some((e) => c.checkIssued(e) && c.verify(e.publicKey))) {
          confiaveis.push(c);
          faltam.delete(c);
          mudou = true;
        }
      }
    }
    expect([...faltam].map((c) => c.subject)).toEqual([]);
    expect(a.govbr.intermediaria.verify(a.govbr.raiz.publicKey) && a.govbr.final.verify(a.govbr.intermediaria.publicKey)).toBe(true);
  });
  it(`ALARME: nenhuma raiz nem a cadeia gov.br vence em menos de ${DIAS_ALARME} dias (atualizar as âncoras, docs/operacao/ancoras-assinatura.md)`, () => {
    const limite = Date.now() + DIAS_ALARME * 86_400_000;
    const vencendo = [...a.raizesIcp, a.govbr.raiz, a.govbr.intermediaria, a.govbr.final].filter((c) => new Date(c.validTo).getTime() < limite).map((c) => c.subject);
    expect(vencendo).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/documentos/ancoras-fonte.test.ts` → PASS.

- [ ] **Step 9: Fábrica de PDFs assinados de teste** — `test/assinatura/fabrica.ts`

```ts
import 'reflect-metadata';
import { createHash, webcrypto, X509Certificate } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { dict, escreverAtualizacao, hex, nome, ref, serializar, texto } from '../../src/modules/documentos/pdf-escrita';
import { dictDe, lerBase, nomeDe, pegar, type PdfDict, type PdfValor } from '../../src/modules/documentos/pdf-leitor';
import { AREA_ASSINATURA, type AreaAssinatura } from '../../src/modules/documentos/constantes';

/**
 * §9.2 da pesquisa: AC de teste criada NO PRÓPRIO TESTE (nenhuma chave no repositório), titulares de teste (e-CPF,
 * "gov.br de teste", outra pessoa, e-CNPJ, vencido, sem uso de assinatura) e um assinador que escreve a atualização
 * incremental à mão sobre o PDF — nas variantes válidas e nas adulteradas que a T9 tem de recusar. Sem rede.
 */
x509.cryptoProvider.set(webcrypto as unknown as Crypto);
pkijs.setEngine('node', new pkijs.CryptoEngine({ crypto: webcrypto as unknown as Crypto }));

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
type Alg = 'RSA' | 'ECDSA';
const params = (a: Alg) => (a === 'RSA' ? RSA : ECDSA);

export type AcDeTeste = { raiz: X509Certificate; intermediaria: X509Certificate; chave: CryptoKey; certIntermediaria: x509.X509Certificate; alg: Alg };
export type TitularDeTeste = { cert: X509Certificate; der: Buffer; chave: CryptoKey; alg: Alg; nome: string; cpf: string | null };

let serial = 1;
const proximoSerial = () => (serial++).toString(16).padStart(2, '0');

export async function criarAc(o: { alg?: Alg; nome?: string } = {}): Promise<AcDeTeste> {
  const alg = o.alg ?? 'RSA';
  const kr = (await webcrypto.subtle.generateKey(params(alg), true, ['sign', 'verify'])) as CryptoKeyPair;
  const raiz = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: proximoSerial(), name: `CN=${o.nome ?? 'AC Raiz de Teste'}`, notBefore: new Date(Date.now() - 86_400_000), notAfter: new Date(Date.now() + 3650 * 86_400_000),
    keys: kr, signingAlgorithm: params(alg), extensions: [new x509.BasicConstraintsExtension(true, 2, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true)],
  });
  const ki = (await webcrypto.subtle.generateKey(params(alg), true, ['sign', 'verify'])) as CryptoKeyPair;
  const inter = await x509.X509CertificateGenerator.create({
    serialNumber: proximoSerial(), issuer: raiz.subject, subject: 'CN=AC Intermediaria de Teste', notBefore: new Date(Date.now() - 86_400_000), notAfter: new Date(Date.now() + 1825 * 86_400_000),
    publicKey: ki.publicKey, signingKey: kr.privateKey, signingAlgorithm: params(alg),
    extensions: [new x509.BasicConstraintsExtension(true, 0, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true)],
  });
  return { raiz: new X509Certificate(Buffer.from(raiz.rawData)), intermediaria: new X509Certificate(Buffer.from(inter.rawData)), chave: ki.privateKey, certIntermediaria: inter, alg };
}

/** SAN otherName ICP (2.16.76.1.3.1: nascimento ddmmaaaa + CPF + NIS + RG…) ou e-CNPJ (2.16.76.1.3.3). */
function sanIcp(oid: string, valor: string): x509.Extension {
  const outro = new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 0 }, value: [new asn1js.ObjectIdentifier({ value: oid }), new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 0 }, value: [new asn1js.OctetString({ valueHex: Buffer.from(valor, 'latin1') })] })] });
  return new x509.Extension('2.5.29.17', false, new asn1js.Sequence({ value: [outro] }).toBER(false));
}

export type TipoTitular = 'ecpf' | 'govbr' | 'ecnpj';
export async function criarTitular(
  ac: AcDeTeste,
  o: { nome: string; cpf?: string; tipo?: TipoTitular; vencido?: boolean; semUsoDeAssinatura?: boolean; politica?: string },
): Promise<TitularDeTeste> {
  const tipo = o.tipo ?? 'ecpf';
  const kp = (await webcrypto.subtle.generateKey(params(ac.alg), true, ['sign', 'verify'])) as CryptoKeyPair;
  const cpf = o.cpf ?? null;
  const exts: x509.Extension[] = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(o.semUsoDeAssinatura ? x509.KeyUsageFlags.keyEncipherment : x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.nonRepudiation | x509.KeyUsageFlags.keyEncipherment, true),
    new x509.CertificatePolicyExtension([o.politica ?? (tipo === 'govbr' ? '2.16.76.1.2.999.1' : '2.16.76.1.2.1.48')]),
  ];
  if (tipo === 'ecpf' && cpf) exts.push(sanIcp('2.16.76.1.3.1', `01011990${cpf}${'0'.repeat(11)}${'0'.repeat(15)}`));
  if (tipo === 'ecnpj') exts.push(sanIcp('2.16.76.1.3.3', '12345678000190'));
  const cn = tipo === 'ecpf' && cpf ? `${o.nome}:${cpf}` : o.nome;
  const agora = Date.now();
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: proximoSerial(), issuer: ac.certIntermediaria.subject,
    subject: tipo === 'govbr' && cpf ? `CN=${cn}, serialNumber=${cpf}` : `CN=${cn}`,
    notBefore: new Date(agora - (o.vencido ? 800 : 1) * 86_400_000), notAfter: new Date(agora + (o.vencido ? -1 : 365) * 86_400_000),
    publicKey: kp.publicKey, signingKey: ac.chave, signingAlgorithm: params(ac.alg), extensions: exts,
  });
  const der = Buffer.from(cert.rawData);
  return { cert: new X509Certificate(der), der, chave: kp.privateKey, alg: ac.alg, nome: o.nome, cpf };
}

/** A atualização da assinatura (e, opcionalmente, uma segunda revisão). Cada adulteração é uma das da §9.2 da pesquisa. */
export type OpcoesAssinatura = {
  subFilter?: 'adbe.pkcs7.detached' | 'ETSI.CAdES.detached' | 'adbe.pkcs7.sha1';
  /** Widget visível com este /Rect (padrão: invisível, área zero). */
  rect?: [number, number, number, number];
  /** /BBox da aparência (padrão: o tamanho do /Rect). */
  bbox?: [number, number, number, number];
  digest?: 'sha256' | 'sha1';
  /** Adulterações (cada uma com a mensagem esperada na T9). */
  freeText?: boolean;
  stamp?: boolean;
  redefinirConteudoDaPagina?: boolean;
  redefinirFonte?: boolean;
  trocarResources?: boolean;
  trocarMediaBox?: boolean;
  openAction?: boolean;
  javascriptNoWidget?: boolean;
  paginaNova?: boolean;
  duasAssinaturas?: boolean;
  byteRangeCurto?: boolean;
  digestErrado?: boolean;
  lixoNoFim?: boolean;
  /** Segunda revisão: 'ltv' (/DSS válido) ou 'isa' (texto depois da assinatura). */
  depois?: 'ltv' | 'isa';
  /** Certificado a mais no CMS (a cadeia completa); padrão: só o do titular, como o Acrobat. */
  cadeiaNoCms?: AcDeTeste;
};

const LARGURA_CONTENTS = 16_384; // bytes do CMS (32 KB em hex)
const MARCA_BR = '/ByteRange [0 0000000000 0000000000 0000000000]';

async function cms(dados: Buffer, t: TitularDeTeste, o: OpcoesAssinatura): Promise<Buffer> {
  const certPk = pkijs.Certificate.fromBER(t.der);
  const hashNome = o.digest === 'sha1' ? 'SHA-1' : 'SHA-256';
  const digest = createHash(o.digest === 'sha1' ? 'sha1' : 'sha256').update(o.digestErrado ? Buffer.concat([dados, Buffer.from('x')]) : dados).digest();
  const attrs = [
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })] }),
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.5', values: [new asn1js.UTCTime({ valueDate: new Date() })] }),
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: digest })] }),
  ];
  if (o.subFilter === 'ETSI.CAdES.detached') {
    const hashCert = createHash('sha256').update(t.der).digest();
    // SigningCertificateV2 { certs SEQUENCE OF ESSCertIDv2 { certHash } } (algoritmo padrão SHA-256 omitido)
    attrs.push(new pkijs.Attribute({ type: '1.2.840.113549.1.9.16.2.47', values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: hashCert })] })] })] })] }));
  }
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: certPk.issuer, serialNumber: certPk.serialNumber }), signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: attrs }) })],
    certificates: [certPk, ...(o.cadeiaNoCms ? [pkijs.Certificate.fromBER(o.cadeiaNoCms.intermediaria.raw)] : [])],
  });
  await sd.sign(t.chave, 0, hashNome);
  return Buffer.from(new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema(true) }).toSchema().toBER(false));
}

/** Assina `base` (o PDF preparado) como um assinador real faria: uma revisão nova com /Sig, campo/widget, AcroForm e /Annots. */
export async function assinarDeTeste(base: Buffer, t: TitularDeTeste, o: OpcoesAssinatura = {}): Promise<Buffer> {
  const b = lerBase(base);
  const raiz = pegar(b.trailer, 'Root') as { num: number; gen: number };
  const catalogo = b.objetos.get(raiz.num)!.valor as PdfDict;
  const paginas = b.objetos.get((pegar(catalogo, 'Pages') as { num: number }).num)!.valor as PdfDict;
  const pagRef = (pegar(paginas, 'Kids') as { num: number }[])[0];
  const pagina = b.objetos.get(pagRef.num)!.valor as PdfDict;
  let n = b.tamanho;
  const novo = () => n++;
  const objetos: { num: number; corpo: Buffer }[] = [];
  const add = (num: number, v: PdfValor | Buffer) => objetos.push({ num, corpo: Buffer.isBuffer(v) ? v : serializar(v) });

  const nSig = novo(), nCampo = novo(), nAcro = novo(), nAp = novo();
  const rect = o.rect ?? [0, 0, 0, 0];
  const bbox = o.bbox ?? [0, 0, rect[2] - rect[0], rect[3] - rect[1]];
  const sigCorpo = Buffer.from(
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${o.subFilter ?? 'adbe.pkcs7.detached'} ${MARCA_BR} /Contents <${'0'.repeat(LARGURA_CONTENTS * 2)}> /M (D:20261005120000Z) >>`,
    'latin1',
  );
  add(nSig, sigCorpo);
  const widget: Record<string, PdfValor> = { Type: nome('Annot'), Subtype: nome('Widget'), FT: nome('Sig'), T: texto('Assinatura1'), V: ref(nSig), F: 132, Rect: rect, P: pagRef };
  if (o.rect) widget.AP = dict({ N: ref(nAp) });
  if (o.javascriptNoWidget) widget.AA = dict({ E: dict({ S: nome('JavaScript'), JS: texto('app.alert(1)') }) });
  add(nCampo, dict(widget));
  add(nAp, { dict: dict({ Type: nome('XObject'), Subtype: nome('Form'), BBox: bbox }), dados: Buffer.from(o.rect ? '1 1 1 rg 0 0 500 500 re f' : ''), inicio: 0 });
  add(nAcro, dict({ Fields: [ref(nCampo)], SigFlags: 3 }));
  const annots: PdfValor[] = [ref(nCampo)];
  if (o.freeText || o.stamp) {
    const nAnot = novo();
    add(nAnot, dict({ Type: nome('Annot'), Subtype: nome(o.freeText ? 'FreeText' : 'Stamp'), Rect: [72, 700, 400, 730], Contents: texto('Vitamina D3 50000 UI'), DA: texto('/Helv 12 Tf 0 g') }));
    annots.push(ref(nAnot));
  }
  if (o.duasAssinaturas) {
    const nSig2 = novo(), nCampo2 = novo();
    add(nSig2, Buffer.from(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 10 20 30] /Contents <00> >>`, 'latin1'));
    add(nCampo2, dict({ Type: nome('Annot'), Subtype: nome('Widget'), FT: nome('Sig'), V: ref(nSig2), Rect: [0, 0, 0, 0], P: pagRef }));
    annots.push(ref(nCampo2));
  }
  const novaPagina = new Map(pagina.d);
  novaPagina.set('Annots', annots);
  if (o.trocarResources) novaPagina.set('Resources', dict({}));
  if (o.trocarMediaBox) novaPagina.set('MediaBox', [0, 0, 595, 900]);
  add(pagRef.num, { d: novaPagina });
  const novoCatalogo = new Map(catalogo.d);
  novoCatalogo.set('AcroForm', ref(nAcro));
  if (o.openAction) novoCatalogo.set('OpenAction', dict({ S: nome('JavaScript'), JS: texto('app.alert(1)') }));
  add(raiz.num, { d: novoCatalogo });
  if (o.redefinirConteudoDaPagina) {
    const c = pegar(pagina, 'Contents') as { num: number };
    add(c.num, { dict: dict({}), dados: Buffer.from('BT /F1 12 Tf 72 720 Td (Vitamina D3 50000 UI) Tj ET'), inicio: 0 });
  }
  if (o.redefinirFonte) {
    for (const [num, ob] of b.objetos) if (nomeDe(pegar(dictDe(ob.valor) ?? { d: new Map() }, 'Type')) === 'Font') add(num, dict({ Type: nome('Font'), Subtype: nome('Type1'), BaseFont: nome('Courier') }));
  }
  if (o.paginaNova) {
    const nPag = novo();
    add(nPag, dict({ Type: nome('Page'), Parent: pegar(catalogo, 'Pages')!, MediaBox: [0, 0, 595, 842] }));
  }

  let pdf = escreverAtualizacao(base, { prev: b.startxref, size: n, trailer: { Root: ref(raiz.num), ...(pegar(b.trailer, 'Info') ? { Info: pegar(b.trailer, 'Info')! } : {}) }, objetos });
  // /ByteRange [0 a b c]: a = o "<" do /Contents deste /Sig; b = depois do ">"; c = até o fim
  const s = pdf.toString('latin1');
  const iSig = s.indexOf(MARCA_BR, base.length);
  const a = s.indexOf('/Contents <', iSig) + '/Contents '.length;
  const bfim = a + LARGURA_CONTENTS * 2 + 2;
  const c = (o.byteRangeCurto ? pdf.length - 10 : pdf.length) - bfim;
  const br = `/ByteRange [0 ${a} ${bfim} ${c}]`.padEnd(MARCA_BR.length, ' ');
  pdf.write(br, iSig, 'latin1');
  const cobertos = Buffer.concat([pdf.subarray(0, a), pdf.subarray(bfim, bfim + c)]);
  const assinatura = await cms(cobertos, t, o);
  if (assinatura.length > LARGURA_CONTENTS) throw new Error('CMS maior que o espaço reservado');
  pdf.write(assinatura.toString('hex').toUpperCase().padEnd(LARGURA_CONTENTS * 2, '0'), a + 1, 'latin1');

  // o startxref da revisão da assinatura (o "xref" de "startxref" não serve: procurar o número depois dele)
  const startxrefAtual = () => Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf.toString('latin1'))![1]);
  if (o.depois === 'isa') {
    pdf = escreverAtualizacao(pdf, { prev: startxrefAtual(), size: n + 1, trailer: { Root: ref(raiz.num) }, objetos: [{ num: n, corpo: serializar(dict({ Type: nome('Annot'), Subtype: nome('FreeText'), Rect: [72, 700, 400, 730], Contents: texto('Dose alterada') })) }] });
  }
  if (o.depois === 'ltv') {
    const nDss = n;
    pdf = escreverAtualizacao(pdf, {
      prev: startxrefAtual(), size: n + 1, trailer: { Root: ref(raiz.num) },
      objetos: [
        { num: nDss, corpo: serializar(dict({ Certs: [] })) },
        { num: raiz.num, corpo: serializar({ d: new Map([...novoCatalogo, ['DSS', ref(nDss)]]) }) },
      ],
    });
  }
  if (o.lixoNoFim) pdf = Buffer.concat([pdf, Buffer.from('% lixo\n')]);
  return pdf;
}

/** O widget visível dentro do quadro "Assinatura digital" (variante válida). */
export const RECT_NO_QUADRO: [number, number, number, number] = [AREA_ASSINATURA.x1 + 4, AREA_ASSINATURA.y1 + 4, AREA_ASSINATURA.x2 - 4, AREA_ASSINATURA.y2 - 4];
export const RECT_SOBRE_A_DOSE: [number, number, number, number] = [72, 700, 400, 730];
export const quadro = (a: AreaAssinatura) => a;
export { hex };
```

Acrescentar a `pdf-leitor.test.ts` um teste que lê um PDF da fábrica (`assinarDeTeste(baseMinimo(), titular)`) e confere: 1 revisão, um objeto com `/Type /Sig`, e o `/ByteRange` cobrindo do byte 0 até o fim menos o buraco.

Run: `pnpm test src/modules/documentos/pdf-leitor.test.ts` → PASS.

- [ ] **Step 10: Campo pré-criado (experimento do spike)** — `src/modules/documentos/campo-assinatura.ts`

```ts
import { dict, escreverAtualizacao, nome, ref, serializar, texto } from './pdf-escrita';
import { lerBase, pegar, type PdfDict, type PdfRef } from './pdf-leitor';
import type { AreaAssinatura } from './constantes';

/**
 * §6.5 da pesquisa: campo de assinatura VAZIO na área reservada da última página, com /Lock (FieldMDP, /Action /All), numa
 * atualização incremental nossa sobre o PDF do react-pdf (que não cria campo). Programas que respeitam o campo (o Acrobat)
 * gravam FieldMDP, e o VALIDAR deixa de dar "Indeterminada". Só entra no preparo se o relatório do spike aprovar
 * (CAMPO_PRE_CRIADO); o SHA-256 e o tamanho do base passam a ser os deste arquivo.
 */
export function acrescentarCampoDeAssinatura(pdf: Buffer, area: AreaAssinatura): Buffer {
  const b = lerBase(pdf);
  const raiz = pegar(b.trailer, 'Root') as PdfRef;
  const catalogo = b.objetos.get(raiz.num)!.valor as PdfDict;
  const kids = pegar(b.objetos.get((pegar(catalogo, 'Pages') as PdfRef).num)!.valor as PdfDict, 'Kids') as PdfRef[];
  const ultima = kids[kids.length - 1];
  const pagina = b.objetos.get(ultima.num)!.valor as PdfDict;
  const nCampo = b.tamanho, nAcro = b.tamanho + 1;
  const annots = new Map(pagina.d);
  annots.set('Annots', [...((pegar(pagina, 'Annots') as PdfRef[] | undefined) ?? []), ref(nCampo)]);
  const cat = new Map(catalogo.d);
  cat.set('AcroForm', ref(nAcro));
  return escreverAtualizacao(pdf, {
    prev: b.startxref,
    size: b.tamanho + 2,
    trailer: { Root: ref(raiz.num), ...(pegar(b.trailer, 'Info') ? { Info: pegar(b.trailer, 'Info')! } : {}) },
    objetos: [
      { num: nCampo, corpo: serializar(dict({ Type: nome('Annot'), Subtype: nome('Widget'), FT: nome('Sig'), T: texto('AssinaturaNutriDebby'), F: 4, Rect: [area.x1, area.y1, area.x2, area.y2], P: ultima, Lock: dict({ Type: nome('SigFieldLock'), Action: nome('All') }) })) },
      { num: nAcro, corpo: serializar(dict({ Fields: [ref(nCampo)], SigFlags: 3 })) },
      { num: ultima.num, corpo: serializar({ d: annots }) },
      { num: raiz.num, corpo: serializar({ d: cat }) },
    ],
  });
}
```

Teste em `pdf-leitor.test.ts`: `acrescentarCampoDeAssinatura(baseMinimo(), AREA_ASSINATURA)` gera um PDF com uma revisão (o campo com `/Lock`), e `lerBase` do resultado falha com `base_com_revisoes` (o base com campo é lido como "base + 1 revisão" pela T9 — anotar no relatório).

- [ ] **Step 11: Relatório de estrutura de um PDF assinado (sem dado pessoal)** — `scripts/certs/relatorio-pdf.ts`

```ts
/**
 * P-B2 (§9.3 da pesquisa): `pnpm assinatura:relatorio <base.pdf> <assinado.pdf>` imprime a ESTRUTURA da atualização —
 * revisões, objetos novos e redefinidos (/Type, /Subtype, chaves mudadas no Catálogo e na página), /Rect e /BBox, xref
 * clássica ou stream, /ObjStm, /SubFilter, atributos do CMS, quantos certificados vêm no CMS, ONDE está o CPF (nome do
 * campo, nunca o valor), política, keyUsage, DocMDP/FieldMDP, /DSS e DocTimeStamp, fim de linha depois do %%EOF.
 * NUNCA imprime nome, CPF, CN ou o texto do documento: o relatório vai para o repositório.
 */
import { readFileSync } from 'node:fs';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { dictDe, iguais, lerAtualizacao, lerBase, nomeDe, pegar, type PdfDict } from '../../src/modules/documentos/pdf-leitor';

const [baseArq, assinadoArq] = process.argv.slice(2);
if (!baseArq || !assinadoArq) {
  console.error('uso: pnpm assinatura:relatorio <base.pdf> <assinado.pdf>');
  process.exit(2);
}
const base = readFileSync(baseArq);
const assinado = readFileSync(assinadoArq);
const linhas: string[] = [];
const out = (s: string) => linhas.push(s);

out(`- prefixo igual ao base: ${assinado.subarray(0, base.length).equals(base) ? 'SIM' : 'NÃO'} (base ${base.length} B, assinado ${assinado.length} B)`);
const fimDoBase = base.subarray(base.length - 7).toString('latin1');
out(`- base termina em: ${JSON.stringify(fimDoBase)}; o assinado continua com: ${JSON.stringify(assinado.subarray(base.length, base.length + 4).toString('latin1'))}`);
const b = lerBase(base);
let revs;
try {
  revs = lerAtualizacao(assinado, base.length);
} catch (e) {
  out(`- leitor limitado: FALHOU (${(e as { motivo?: string }).motivo ?? 'erro'})`);
  console.log(linhas.join('\n'));
  process.exit(0);
}
revs.forEach((r, i) => {
  out(`- revisão ${i + 1}: ${r.fim - r.inicio} B, xref ${r.xrefStream ? 'stream' : 'tabela'}, /Prev ${pegar(r.trailer, 'Prev')} (startxref do base ${b.startxref}), objetos ${r.objetos.size}`);
  for (const o of r.objetos.values()) {
    const d = dictDe(o.valor);
    const tipo = d ? `${nomeDe(pegar(d, 'Type')) ?? '-'}/${nomeDe(pegar(d, 'Subtype')) ?? nomeDe(pegar(d, 'FT')) ?? '-'}` : typeof o.valor;
    const doBase = b.objetos.get(o.num);
    let mudancas = '';
    if (doBase && d) {
      const antes = dictDe(doBase.valor)!;
      const chaves = new Set([...antes.d.keys(), ...d.d.keys()]);
      mudancas = ` redefinido; chaves mudadas: ${[...chaves].filter((k) => !iguais(antes.d.get(k), d.d.get(k))).join(', ') || 'nenhuma'}`;
    }
    const extra = d && pegar(d, 'Rect') ? ` Rect=${JSON.stringify(pegar(d, 'Rect'))}` : '';
    const sub = d && pegar(d, 'SubFilter') ? ` SubFilter=${nomeDe(pegar(d, 'SubFilter'))}` : '';
    out(`  - obj ${o.num}${o.objStm ? ` (em ObjStm ${o.objStm})` : ''}: ${tipo}${sub}${extra}${mudancas}`);
    if (d && pegar(d, 'Reference')) out(`    - /Reference presente (DocMDP/FieldMDP)`);
    if (d && pegar(d, 'Lock')) out(`    - /Lock presente`);
  }
});
// CMS: atributos, certificados, onde está o CPF (sem o valor)
const sig = revs[0] && [...revs[0].objetos.values()].map((o) => dictDe(o.valor)).find((d): d is PdfDict => !!d && !!pegar(d, 'ByteRange'));
const conteudo = sig && (pegar(sig, 'Contents') as { s: Buffer } | undefined);
if (conteudo) {
  const ci = pkijs.ContentInfo.fromBER(conteudo.s);
  const sd = new pkijs.SignedData({ schema: ci.content });
  out(`- CMS: ${sd.signerInfos.length} SignerInfo, ${sd.certificates?.length ?? 0} certificado(s), digest ${sd.signerInfos[0]?.digestAlgorithm.algorithmId}, assinatura ${sd.signerInfos[0]?.signatureAlgorithm.algorithmId}`);
  out(`- atributos assinados: ${sd.signerInfos[0]?.signedAttrs?.attributes.map((a) => a.type).join(', ')}`);
  const cert = sd.certificates?.find((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  if (cert) {
    const exts = cert.extensions ?? [];
    out(`- extensões do titular: ${exts.map((e) => e.extnID).join(', ')}`);
    const san = exts.find((e) => e.extnID === '2.5.29.17');
    if (san) {
      const seq = asn1js.fromBER(san.extnValue.valueBlock.valueHexView).result as asn1js.Sequence;
      out(`- SAN otherName: ${seq.valueBlock.value.filter((g) => g.idBlock.tagClass === 3 && g.idBlock.tagNumber === 0).map((g) => ((g as asn1js.Constructed).valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString()).join(', ') || 'nenhum'}`);
    }
    out(`- atributos do sujeito: ${cert.subject.typesAndValues.map((t) => t.type).join(', ')} (CPF em serialNumber 2.5.4.5? ${cert.subject.typesAndValues.some((t) => t.type === '2.5.4.5') ? 'há o atributo' : 'não'})`);
  }
}
const ultimo = assinado.subarray(assinado.length - 8).toString('latin1');
out(`- fim do arquivo: ${JSON.stringify(ultimo)}`);
console.log(linhas.join('\n'));
```

Run: `pnpm assinatura:relatorio test/assinatura/reais/base.pdf test/assinatura/reais/govbr-a.pdf` (depois do Step 13).

- [ ] **Step 12: PDF de teste para o dono assinar** — `scripts/certs/pdf-de-teste.tsx`

```tsx
/**
 * P-B2 / runbook passo 1: gera em test/assinatura/reais/ o PDF de uma receita FICTÍCIA ("Paciente Teste", itens inventados),
 * com o quadro "Assinatura digital" no rodapé (AREA_ASSINATURA) e o rodapé do código e do QR, nas duas formas: sem e com o
 * campo pré-criado. O dono e a Debby assinam estes arquivos (nunca uma receita de paciente real).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Document, Image, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { acrescentarCampoDeAssinatura } from '../../src/modules/documentos/campo-assinatura';
import { AREA_ASSINATURA as A } from '../../src/modules/documentos/constantes';

async function main() {
  const qr = await QRCode.toBuffer('https://nutri.wsscloud.tech/v/TESTE0000000', { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  const pdf = await renderToBuffer(
    <Document title="Receita (teste)" creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={{ padding: 36, paddingBottom: 150, fontSize: 10, fontFamily: 'Helvetica' }}>
        <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold' }}>Receita (TESTE — dados fictícios)</Text>
        <Text>Paciente: Paciente Teste</Text>
        <Text>1. Vitamina D3 — 2000 UI — Cápsula — Oral — 1 cápsula ao dia, no almoço</Text>
        <View fixed style={{ position: 'absolute', left: A.x1, bottom: A.y1, width: A.x2 - A.x1, height: A.y2 - A.y1, borderWidth: 1, borderColor: '#999999', borderStyle: 'dashed' }}>
          <Text style={{ fontSize: 8, color: '#666666', margin: 4 }}>Assinatura digital</Text>
        </View>
        <View fixed style={{ position: 'absolute', left: 36, right: 36, bottom: 20, flexDirection: 'row', alignItems: 'center' }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf */}
          <Image src={{ data: qr, format: 'png' }} style={{ width: 36, height: 36, marginRight: 8 }} />
          <Text style={{ fontSize: 8 }}>Código de verificação: TEST-E000-0000 · Verifique em https://nutri.wsscloud.tech/v/TESTE0000000</Text>
        </View>
      </Page>
    </Document>,
  );
  mkdirSync('test/assinatura/reais', { recursive: true });
  writeFileSync('test/assinatura/reais/base.pdf', pdf);
  writeFileSync('test/assinatura/reais/base-com-campo.pdf', acrescentarCampoDeAssinatura(pdf, A));
  console.log('Gerados test/assinatura/reais/base.pdf e base-com-campo.pdf (fora do git).');
}
main();
```

Run: `pnpm assinatura:pdf-teste` → os dois PDFs em `test/assinatura/reais/` (ignorados pelo git).

- [ ] **Step 13: CHECKPOINT DO DONO — PDFs reais (runbook, passo 1)**

Parar e pedir ao dono, com os dois arquivos do Step 12 (enviados por canal privado, nunca no git):
1. `base.pdf` assinado no **`assinador.iti.br`** com a conta gov.br prata/ouro da Debby ou do dono: (a) carimbo visível onde o assinador propõe; (b) carimbo dentro do quadro "Assinatura digital"; (c) sem carimbo visível, se o assinador oferecer. E `base-com-campo.pdf` assinado da forma (b).
2. Se houver e-CPF (A1 ou A3): o mesmo `base.pdf` e o `base-com-campo.pdf` assinados no **Adobe Acrobat Reader** e no **Assinador SERPRO** (ambos gratuitos), anotando o nome e a versão de cada programa.
3. Para cada arquivo assinado, o **relatório de conformidade do VALIDAR** (validar.iti.gov.br).
4. Os arquivos voltam para `test/assinatura/reais/` na máquina de dev (fora do git).

Enquanto os arquivos não chegam, o plano segue (Tarefas 2–8 não dependem deles) com as réplicas da fábrica; **a opção C só é liberada** depois de um arquivo real de pelo menos um programa ICP (critério de aceite da T9), e o **gov.br** só depois do arquivo real dele.

- [ ] **Step 14: Relatório do spike e decisão da D16** — `docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md`

Rodar `pnpm assinatura:relatorio test/assinatura/reais/base.pdf <cada assinado>` e escrever o relatório com: a saída de cada arquivo (sem nome nem CPF — o script não os imprime), o resultado do VALIDAR de cada um ("Aprovado"/"Indeterminado"), e a aplicação da tabela de critérios (§9.4 da pesquisa):

| Resultado | Caminho |
|---|---|
| gov.br e os programas ICP testados preservam o prefixo e a atualização cabe na lista da RN-144 (5)–(6) | **Leitor síncrono** (T9 como está). Ajustar a lista com o que o relatório mostrou (ex.: `/Prop_Build`, `/Metadata`) e criar uma **réplica estrutural** de cada formato na fábrica (`OpcoesAssinatura` nova, sem o arquivo real) |
| Algum preserva o prefixo, mas o carimbo visível fica fora do quadro sem controle | Instrução + recusa específica (texto da US-144); se o atrito for alto, **T19** só para esse caso |
| Algum **não** preserva o prefixo (reescreve o arquivo) | **T19** (D16 = (a) da spec) para aquele assinador; (c) se o programa for raro |
| `/ObjStm` ilegível ou formato instável entre versões | **T19** |
| O certificado gov.br não traz o CPF em campo próprio | **D8 ★** volta ao dono com o relatório |
| O campo pré-criado foi usado e o VALIDAR aprovou | `CAMPO_PRE_CRIADO = true` (T8) |
| Algum programa aceito sai "Indeterminado" no VALIDAR | Nota curta perto do link do ITI na `/v` (T15), texto a escrever com o resultado |

Também no relatório: a tolerância de fim de linha depois do `%%EOF` do base (se algum programa emenda sem o `\n` ou troca por `\r\n`, a T9 aceita só a variação "base sem o fim de linha final", com um segundo hash gravado no preparo — coluna `base_pdf_sha256_sem_eol`, desvio a registrar) e onde fica o CPF no gov.br (`serialNumber`? SAN?) para a T9.

- [ ] **Step 15: Operação das âncoras** — `docs/operacao/ancoras-assinatura.md`

```markdown
# Âncoras de confiança da assinatura (INT-B1, D7 do Plano 10)

**Quando:** a cada trimestre (jan, abr, jul, out), quando o teste "ALARME" de `ancoras-fonte.test.ts` falhar (uma raiz ou
a cadeia gov.br vence em menos de 180 dias), ou quando uma nutricionista receber "Tipo de assinatura não aceito" com um
e-CPF de AC credenciada.

**Quem:** o Claude, a pedido do dono (D7), numa branch própria; o PR é revisado como código.

1. `pnpm certs:ancoras` (baixa o arquivo único do ITI por HTTP, confere o SHA-512 publicado e só aceita AC que encadeia até
   uma raiz fixada em `src/modules/documentos/ancoras-raizes.ts`).
2. `pnpm test src/modules/documentos/ancoras-fonte.test.ts`.
3. No PR: o número de ACs aceitas e recusadas (a saída do script), o diff do `fonte.json` e, se uma **raiz nova** do ITI
   apareceu, o SHA-256 dela conferido no repositório do ITI antes de entrar em `RAIZES_FIXADAS` (decisão do dono).
4. A cadeia gov.br (`GOVBR_PEM`) só muda se o ITI publicar uma nova (vence em 06/2033); conferir pelas LCRs de `repo.iti.br`.
```

- [ ] **Step 16: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore src/modules/documentos/{constantes,pdf-leitor,pdf-leitor.test,pdf-escrita,campo-assinatura,ancoras,ancoras-raizes,ancoras-fonte.test}.ts src/modules/documentos/ancoras scripts/certs test/assinatura/base-minimo.ts test/assinatura/fabrica.ts docs/operacao/ancoras-assinatura.md docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md
git commit -m "feat(documentos): spike da conferência da assinatura — âncoras, leitor limitado, fábrica de PDFs de teste e relatório (P-B2)"
```

---
### Task 2: Banco — tabelas dos documentos, RLS, escrita do paciente, tipos de arquivo e de aviso, guardas (P10-02)

**Files:**
- Create: `src/db/schema/documentos.ts`, `drizzle/0089_documentos_assinados.sql` (gerada), `drizzle/0090_rls_documentos.sql` (custom), `src/db/documentos-schema.test.ts`, `src/modules/documentos/erros.ts`, `test/documentos.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/platform.ts` (`tenants`, `stored_files`), `src/db/schema/agenda.ts` (`notifications_tipo_valido`), `src/db/rls-guard.ts` (+ `rls-guard.test.ts` se listar exceções), `src/db/audit-guard.ts`, `src/modules/plataforma/audit.ts`, `src/modules/plataforma/armazenamento.ts`, `src/modules/notificacoes/tipos.ts`, `src/modules/documentos/constantes.ts`, `test/isolamento.test.ts`, `CLAUDE.md` (regras 1, 2, 8 e 9)

**Interfaces:**
- Consumes: `app_enable_tenant_rls`, `app_enable_patient_rls`, `app_enable_audit`, `app_enable_staff_only`, `app_allow_paciente_escrita` (0000/0007/0020/0070); `tenants`, `storedFiles` (`platform.ts`), `patients` (`pacientes.ts`); `AREA_ASSINATURA`, `TipoAssinatura` (T1).
- Produces:
  - `@/db/schema`: `signedDocuments`, `signedDocumentNotes`, `signedDocumentReceipts`, `documentAccessCodes`, `documentVerifications`, `tenantSigner` e os tipos `SignedDocumentRow`, `SignedDocumentReceiptRow`, `DocumentVerificationRow`; `tenants.nomeProfissional`, `contatoEmail`, `contatoTelefoneE164`, `fitoterapiaRegistro`, `fitoterapiaDeclaradaEm`, `fitoterapiaTermoVersao`, `documentosLiberados`.
  - `TipoDeArquivo` + `TIPOS_DO_PACIENTE` com `'documento_base' | 'documento_assinado' | 'documento_digitalizado'`; `TipoNotificacao` com `'documento_novo' | 'documento_atualizado'` (rótulos "Documento novo", "Documento atualizado").
  - `constantes.ts`: `STATUS_DOCUMENTO`, `StatusDocumento`, `EMITIDOS`, `ROTULO_STATUS`, `ROTULO_ASSINATURA`, `SituacaoVerificacao`, `EventoRecibo`, `ViaRecibo`.
  - `erros.ts`: `DocumentoNaoEncontradoError`, `DocumentoError { erros: Record<string, string> }`, `TransicaoInvalidaError`, `RecusaAssinaturaError { codigo: CodigoRecusa }`, `CodigoRecusa`, `MSG_RECUSA: Record<CodigoRecusa, string>`.
  - `ENTIDADE_ROTULO.documentos = 'Documentos assinados'`, `.perfil_profissional = 'Perfil profissional'`, `.tentativa_assinatura = 'Tentativa de assinatura com código recusado'`.
  - `test/documentos.ts`: `documentoNoBanco(db, ctx, patientId, o?: { status?: StatusDocumento; conteudo?: object }): Promise<{ id: string; codigo: string | null; pdfPath: string | null }>`.

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
  it('CHECKs: código só fora do rascunho e no formato Crockford; emitido sem PDF recusado; tipo só receita no Plano 10', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, codigo) values (${T.tenantId}, ${p.id}, 'ABCDEFGHJKMN')`)).rejects.toSatisfy(restricao('signed_documents_codigo_so_fora_do_rascunho'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo) values (${T.tenantId}, ${p.id}, 'preparando', 'ABCDEFGHIJKL')`)).rejects.toSatisfy(restricao('signed_documents_codigo_formato'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo) values (${T.tenantId}, ${p.id}, 'assinado', 'ABCDEFGHJKMN')`)).rejects.toSatisfy(restricao('signed_documents_emitido_com_pdf'));
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, tipo) values (${T.tenantId}, ${p.id}, 'parecer')`)).rejects.toSatisfy(restricao('signed_documents_tipo_valido'));
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

  it('notas e assinante (STAFF_ONLY): a sessão de paciente não vê a justificativa de uso nem o CPF do assinante', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${T.tenantId}, ${p.id}, ${d.id}, 'Baixa exposição solar')`);
      await tx.execute(sql`insert into tenant_signer (tenant_id, cpf_hmac, cpf_mascarado) values (${T.tenantId}, 'x', '***.456.789-**')`);
    }, app.db);
    const comoP = (s: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    expect((await comoP(sql`select 1 from signed_document_notes`)).rows).toEqual([]);
    expect((await comoP(sql`select 1 from tenant_signer`)).rows).toEqual([]);
  });

  it('document_verifications: fora da RLS, o app insere e muda só a situação; nunca apaga nem muda o SHA-256', async () => {
    const T = await novoTenant(app.db);
    const codigo = 'ABCDEFGHJKMN'.split('').sort(() => Math.random() - 0.5).join('');
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, situacao, situacao_em, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
      values (${codigo}, ${T.tenantId}, ${randomUUID()}, 'receita', 'valido', now(), now(), 'Debby Silva', 'CRN-3 12345', 'govbr', ${'a'.repeat(64)})`);
    await app.db.execute(sql`update document_verifications set situacao = 'cancelado', situacao_em = now() where codigo = ${codigo}`);
    await expect(app.db.execute(sql`update document_verifications set pdf_sha256 = ${'b'.repeat(64)} where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
    await expect(app.db.execute(sql`delete from document_verifications where codigo = ${codigo}`)).rejects.toSatisfy((e) => causa(e).code === '42501');
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

- [ ] **Step 2: Constantes e erros** — acrescentar a `src/modules/documentos/constantes.ts` e criar `erros.ts`

```ts
// acrescentar a constantes.ts
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
export const ROTULO_ASSINATURA: Record<TipoAssinatura, string> = { govbr: 'gov.br', icp: 'Certificado ICP-Brasil', digitalizada: 'Digitalizado' };
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

export type CodigoRecusa =
  | 'arquivo' | 'sem_assinatura' | 'nao_e_o_preparado' | 'alterado' | 'fora_do_quadro' | 'nao_confere' | 'vencido'
  | 'empresa' | 'outra_pessoa' | 'nao_aceito' | 'outro_titular_primeiro' | 'sem_2fa' | 'codigo_2fa' | 'tentativas_2fa' | 'imagens';

/** US-144 (texto exato da spec v0.3). `outro_titular_primeiro` recebe o nome do certificado (só na tela, nunca no log). */
export const MSG_RECUSA: Record<CodigoRecusa, string> = {
  arquivo: 'Envie o PDF assinado (até 10 MB).',
  sem_assinatura: 'Não encontramos assinatura digital neste PDF. Assine pelo gov.br ou com certificado ICP-Brasil e envie de novo.',
  nao_e_o_preparado: 'Este PDF não é o documento preparado. Baixe o PDF de novo, assine e envie.',
  alterado: 'Este PDF recebeu alterações além da assinatura. Baixe o PDF de novo, assine sem editar e envie.',
  fora_do_quadro: 'A assinatura visível ficou fora do quadro "Assinatura digital". Assine de novo com a assinatura dentro do quadro.',
  nao_confere: 'A assinatura deste PDF não confere. Assine de novo e envie.',
  vencido: 'O certificado usado está vencido. Renove o certificado ou use o gov.br e assine de novo.',
  empresa: 'O certificado deste PDF é de empresa (e-CNPJ). Assine com o seu gov.br ou o seu e-CPF.',
  outra_pessoa: 'O PDF foi assinado por outra pessoa. Use a sua conta gov.br ou o seu certificado.',
  nao_aceito: 'Tipo de assinatura não aceito. Use o gov.br ou um certificado ICP-Brasil.',
  outro_titular_primeiro: 'O certificado deste PDF está em nome de {nome}, diferente do nome do seu perfil profissional. Assine com o seu gov.br ou o seu certificado.',
  sem_2fa: 'Ative a verificação em duas etapas em Segurança para assinar documentos.',
  codigo_2fa: 'Código inválido. Confira o horário do celular e tente de novo.',
  tentativas_2fa: 'Muitas tentativas. Tente de novo em 15 minutos.',
  imagens: 'Envie fotos das páginas (JPEG ou PNG).',
};

export class RecusaAssinaturaError extends Error {
  override name = 'RecusaAssinaturaError';
  /** `motivoTecnico`: só para o log (fixo, sem dado pessoal), ex.: "byterange_forma". */
  constructor(readonly codigo: CodigoRecusa, readonly motivoTecnico: string = codigo, readonly nomeDoCertificado?: string) {
    super(MSG_RECUSA[codigo]);
  }
  /** A mensagem da tela (com o nome do certificado no caso do primeiro envio de outra pessoa). */
  mensagem(): string {
    return this.nomeDoCertificado ? MSG_RECUSA[this.codigo].replace('{nome}', this.nomeDoCertificado) : MSG_RECUSA[this.codigo];
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
    /** D4: caminhos das fotos da digitalizada até o worker montar o PDF; `digitalizacao_status` pendente/falhou. */
    digitalizacao: jsonb('digitalizacao').$type<string[]>(),
    digitalizacaoStatus: text('digitalizacao_status'),
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
    check('signed_documents_assinatura_tipo_valida', sql`${t.assinaturaTipo} is null or ${t.assinaturaTipo} in ('govbr','icp','digitalizada')`),
    check('signed_documents_pdf_status_valido', sql`${t.pdfStatus} is null or ${t.pdfStatus} in ('pendente','pronto','falhou')`),
    check('signed_documents_digitalizacao_status_valido', sql`${t.digitalizacaoStatus} is null or ${t.digitalizacaoStatus} in ('pendente','falhou')`),
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
    unique('document_verifications_documento_unique').on(t.documentoId),
  ],
);
export type DocumentVerificationRow = typeof documentVerifications.$inferSelect;

/** D10: CPF do assinante do consultório (HMAC + máscara), STAFF_ONLY — fora de `tenants`. */
export const tenantSigner = pgTable('tenant_signer', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  cpfHmac: text('cpf_hmac').notNull(),
  cpfMascarado: text('cpf_mascarado').notNull(),
  confirmadoEm: timestamp('confirmado_em', { withTimezone: true }).notNull().defaultNow(),
  confirmadoPor: uuid('confirmado_por'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Em `platform.ts`, `tenants` ganha (com os CHECKs na lista do `(t) => [...]`):

```ts
    /** US-140 (Plano 10): dados do carimbo dos documentos. */
    nomeProfissional: text('nome_profissional'),
    contatoEmail: text('contato_email'),
    contatoTelefoneE164: text('contato_telefone_e164'),
    /** D6 da spec: autodeclaração da habilitação em Fitoterapia (registro, data e versão do termo juntos ou nulos). */
    fitoterapiaRegistro: text('fitoterapia_registro'),
    fitoterapiaDeclaradaEm: timestamp('fitoterapia_declarada_em', { withTimezone: true }),
    fitoterapiaTermoVersao: text('fitoterapia_termo_versao'),
    /** D20 do Plano 10: documentos só depois da liberação para uso real (CRN-3, termo, backup); o admin liga. */
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
-- Plano 10 (spec de documentos assinados v0.3, §10). CLAUDE.md regras 2 e 8.
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
SELECT app_enable_tenant_rls('tenant_signer');
--> statement-breakpoint
SELECT app_enable_staff_only('tenant_signer');
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
  tenant_signer: 'D10 do Plano 10: CPF (HMAC e máscara) do assinante do consultório — só a equipe',
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

- [ ] **Step 6: Ajudante de teste** — `test/documentos.ts`

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { StatusDocumento } from '@/modules/documentos/constantes';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const codigoAleatorio = () => Array.from({ length: 12 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join('');

/**
 * Documento gravado direto no banco (sem o fluxo), no estado pedido. Emitido = com o stored_files do PDF assinado (FK NO
 * ACTION), SHA-256 e assinatura gov.br. O gatilho de imutabilidade (0091) não olha INSERT.
 */
export async function documentoNoBanco(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  o: { status?: StatusDocumento; conteudo?: Record<string, unknown> } = {},
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
              ${pdfPath}, ${emitido ? 'a'.repeat(64) : null}, ${emitido ? new Date() : null}, ${emitido ? 'govbr' : null}, ${emitido ? 'DEBBY SILVA' : null}, ${emitido ? new Date() : null})`);
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
  // uma linha por tenant (PK tenant_id)
  tenant_signer: (t) => sql`insert into tenant_signer (tenant_id, cpf_hmac, cpf_mascarado) select ${t}, 'h', '***.000.000-**' where not exists (select 1 from tenant_signer where tenant_id = ${t})`,
```

```ts
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log', 'signed_document_receipts']);
/**
 * D19 (Plano 10): o gatilho de imutabilidade (0091) recusa mudar tenant_id/patient_id com 42501 ANTES do WITH CHECK da RLS
 * (mensagem própria, não "row-level security"); em signed_documents, só o rascunho é apagado.
 */
const IMUTAVEIS = new Set(['signed_documents', 'signed_document_notes']);
const SO_APAGA: Record<string, SQL> = { signed_documents: sql`status = 'rascunho'` };
const ULTIMAS = ['meals', 'meal_plans', 'recipes', 'contents', 'anamnesis_templates', 'foods', 'appointments', 'signed_documents', 'stored_files', 'patients'];
```

Nos testes "WITH CHECK" (tenant B move linha para A; P2 move linha para P1), a recusa esperada vira `IMUTAVEIS.has(t) || colunasConferidas.has(t) ? negado : violaRls`. No teste "o tenant B só vê e só altera as próprias linhas", o DELETE passa a `sql\`delete from ${id}${SO_APAGA[t] ? sql\` where ${SO_APAGA[t]}\` : sql\`\`}\`` e, para `SO_APAGA`, o esperado é "apagou só os rascunhos de B; os emitidos de B continuam; A intacto":

```ts
          const apagaveis = SO_APAGA[t] ? (await tx.execute(sql`select 1 from ${id} where ${SO_APAGA[t]}`)).rows.length : proprias.length;
          const apagadas = await tx.execute(sql`delete from ${id}${SO_APAGA[t] ? sql` where ${SO_APAGA[t]}` : sql``}`);
          expect(apagadas.rowCount, t).toBe(apagaveis); // em signed_documents, só os rascunhos de B (os emitidos ficam)
```

e, depois do bloco, `if (!SO_INSERE.has(t) && !SO_APAGA[t]) expect(await contarTenant(t, B), t).toBe(0);`. (Os emitidos de B que ficam seguram o `stored_files` deles? Não: a fábrica cria emitido **sem** PDF — anonimizado.)

- [ ] **Step 8: CLAUDE.md** (regras 1, 2, 8 e 9; o texto final fica no PR)

- Regra 1: "…e, com `tenant_id` mas em `RLS_EXCEPTIONS`, `invites`, `consents` **e `document_verifications`** (verificação pública de documento assinado: só `src/modules/documentos/verificacao.ts`, DELETE revogado e UPDATE só de `situacao`/`situacao_em`, Plano 10)".
- Regra 2: "Tabela que o paciente só **insere** (prova, como `signed_document_receipts`): `app_allow_paciente_escrita('<tabela>', 'insert')` + `REVOKE UPDATE, DELETE` de `nutri_app_role` + `SO_INSERE` no teste de isolamento."
- Regra 8: "a anonimização de documentos assinados só pela função `app_anonimizar_documentos` (migration 0091, contexto `worker`, ao lado da `app_anonimizar_aceites`); as tabelas com gatilho de imutabilidade (`signed_documents`, `signed_document_notes`) entram em `IMUTAVEIS` do teste de isolamento."
- Regra 9: "PDF preparado, PDF assinado e fotos da digitalizada (`documento_base`, `documento_assinado`, `documento_digitalizado`) com FK **`NO ACTION`** (o registro sai antes, no `naMesmaTransacao`); o PDF de documento e o da digitalizada só no worker (`documento-pdf.tsx`, `documento-pdf-job.ts`, `digitalizada-job.ts` — guarda de grafo em `exportacao.test.ts`)."

- [ ] **Step 9: Rodar**

Run: `pnpm test src/db/documentos-schema.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/sem-conta-guarda.test.ts` → PASS (o teste do gatilho de imutabilidade entra na T3; até lá, o caso "move a linha para A" de `IMUTAVEIS` ainda cai na RLS — `negado` aceita os dois).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/{documentos,index,platform,agenda}.ts drizzle/0089_documentos_assinados.sql drizzle/0090_rls_documentos.sql drizzle/meta src/db/{rls-guard,audit-guard,documentos-schema.test}.ts src/modules/plataforma/{audit,armazenamento}.ts src/modules/notificacoes/tipos.ts src/modules/documentos/{constantes,erros}.ts test/documentos.ts test/isolamento.test.ts CLAUDE.md
git commit -m "feat(documentos): tabelas, RLS, recibo só INSERT, verificação fora da RLS e guardas (Plano 10, T2)"
```

---
### Task 3: Imutabilidade no banco e anonimização (RN-140, RN-141, CS-141; P10-03)

**Files:**
- Create: `drizzle/0091_documentos_imutaveis.sql` (custom), `src/db/documentos-imutaveis.test.ts`

**Interfaces:**
- Consumes: tabelas da T2; `documentoNoBanco` (`test/documentos.ts`); `apagarArquivo` (`armazenamento.ts`).
- Produces (SQL): gatilhos `app_documento_imutavel` (BEFORE UPDATE OR DELETE em `signed_documents`) e `app_notas_imutaveis` (BEFORE INSERT OR UPDATE OR DELETE em `signed_document_notes`), ambos com `ERRCODE '42501'`; função `app_anonimizar_documentos(p_documento uuid) RETURNS text` (devolve o `pdf_path` a apagar; só contexto `worker`, paciente `bloqueado`). Usada pela T16 no `naMesmaTransacao` de `apagarArquivo`.

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
    await withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, base_pdf_path = null, base_pdf_sha256 = null, base_pdf_bytes = null, area_assinatura = null, pdf_status = null where id = ${d.id}`), app.db);
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
      values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Debby Silva', 'CRN-3 12345', 'DEBBY SILVA', 'govbr', ${'a'.repeat(64)})`);
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
       OR NOT (mudou <@ ARRAY['anonimizado_em', 'conteudo', 'pdf_path', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status'])
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
    RETURN NEW;
  END IF;

  IF OLD.status IN ('preparando', 'aguardando_assinatura') THEN
    -- "Voltar a editar" (RN-140 a): tudo do preparo volta a nulo
    IF NEW.status = 'rascunho' THEN
      IF NOT (mudou <@ ARRAY['status', 'codigo', 'declaracao_em', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura', 'pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status'])
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
      IF NOT (mudou <@ ARRAY['pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status']) THEN
        RAISE EXCEPTION 'conteúdo congelado desde o preparo (RN-140)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- a assinatura (RN-140 b): o PDF base sai NO MESMO UPDATE
    IF OLD.status = 'aguardando_assinatura' AND NEW.status = 'assinado' THEN
      IF NOT (mudou <@ ARRAY['status', 'pdf_path', 'pdf_sha256', 'assinatura_tipo', 'assinatura_emissor', 'assinante_nome', 'assinado_em', 'assinado_por', 'entregue_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status'])
         OR NEW.base_pdf_path IS NOT NULL THEN
        RAISE EXCEPTION 'assinatura fora da regra (RN-140 b)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'transição inválida (RN-141)' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'assinado' THEN
    IF NEW.status = 'assinado' AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'entregue_em']
       AND NEW.base_pdf_path IS NULL AND NEW.digitalizacao IS NULL AND (OLD.entregue_em IS NULL OR NEW.entregue_em IS NOT DISTINCT FROM OLD.entregue_em) THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'cancelado' AND mudou <@ ARRAY['status', 'cancelado_em', 'base_pdf_path', 'digitalizacao'] AND NEW.cancelado_em IS NOT NULL
       AND NEW.base_pdf_path IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'substituido' AND mudou <@ ARRAY['status', 'substituido_em', 'base_pdf_path', 'digitalizacao'] AND NEW.substituido_em IS NOT NULL
       AND NEW.base_pdf_path IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'documento assinado não muda (RN-140)' USING ERRCODE = '42501';
  END IF;

  -- substituido / cancelado: só soltar o que sobrou do preparo
  IF NEW.status = OLD.status AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status'] AND NEW.base_pdf_path IS NULL AND NEW.digitalizacao IS NULL THEN
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
     SET anonimizado_em = clock_timestamp(), conteudo = '{}'::jsonb, pdf_path = NULL, base_pdf_path = NULL, digitalizacao = NULL, digitalizacao_status = NULL, updated_at = clock_timestamp()
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
```

> Nota: o `base_pdf_path` de documento emitido já é nulo (a assinatura o solta no mesmo UPDATE); a função o limpa por defesa. A conferência "nenhum PDF de documento sobrou" da anonimização é a `pdfsDeDocumentosRestantes` (T16).

- [ ] **Step 3: Rodar**

Run: `pnpm test src/db/documentos-imutaveis.test.ts src/db/documentos-schema.test.ts test/isolamento.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0091_documentos_imutaveis.sql drizzle/meta src/db/documentos-imutaveis.test.ts
git commit -m "feat(documentos): imutabilidade no banco e anonimização só pelo worker (RN-140, RN-141, CS-141)"
```

---
### Task 4: Perfil profissional para documentos e assinante do consultório (US-140, D6 e D10; P10-04)

**Files:**
- Create: `src/modules/documentos/perfil-profissional.ts`, `src/modules/documentos/perfil-profissional.test.ts`, `src/app/painel/configuracoes/perfil/documentos-form.tsx`, `src/app/painel/configuracoes/perfil/fitoterapia-form.tsx`, `src/app/painel/configuracoes/perfil/actions.ts`
- Modify: `src/app/painel/configuracoes/perfil/page.tsx`, `src/app/painel/configuracoes/page.tsx` (texto do cartão), `src/modules/ajuda/conteudo.ts` (guia `configuracoes`, `versao: 2`)

**Interfaces:**
- Consumes: `tenants` e `tenantSigner` (T2); `crnSchema` (`plataforma/contas.ts`); `normalizarTelefone`/`formatarTelefone`; `recordAudit`; `encryptionKey` (`src/lib/crypto.ts`); `primeiroErroPorCampo`.
- Produces:
  - `MSG_PERFIL_PROF` (textos da US-140), `TERMO_FITOTERAPIA = { versao: '2026-10-05', texto }`, `ROTULO_HABILITACAO`.
  - `type CopiaProfissional = { nomeCompleto: string; crn: string; email: string; telefone: string; endereco: string | null; fitoterapia: boolean }`.
  - `perfilCompleto(t: TenantRow): boolean`, `copiaDoPerfil(t: TenantRow): CopiaProfissional` (lança `PerfilIncompletoError`), `class PerfilIncompletoError`.
  - `salvarDadosParaDocumentos(ctx, input: Record<string, unknown>, db?): Promise<void>` (lança `DocumentoError`), `declararFitoterapia(ctx, input, deps?)`, `retirarFitoterapia(ctx, deps?)`.
  - `hmacDoCpf(cpf: string): string`, `mascararCpf(cpf: string): string` (`***.456.789-**`), `lerAssinante(tx): Promise<{ cpfHmac: string; cpfMascarado: string } | null>`, `gravarAssinante(tx, a: { tenantId: string; cpf: string; userId: string; agora: Date }): Promise<void>`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/perfil-profissional.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { DocumentoError } from './erros';
import { copiaDoPerfil, declararFitoterapia, gravarAssinante, hmacDoCpf, lerAssinante, mascararCpf, MSG_PERFIL_PROF, perfilCompleto, PerfilIncompletoError, retirarFitoterapia, salvarDadosParaDocumentos } from './perfil-profissional';

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

  it('D10: o CPF do assinante vira HMAC + máscara (6 dígitos visíveis), nunca o CPF; ler devolve o gravado', async () => {
    const T = await novoTenant(app.db);
    expect(mascararCpf('12345678909')).toBe('***.456.789-**');
    expect(hmacDoCpf('12345678909')).not.toContain('12345678909');
    expect(hmacDoCpf('12345678909')).toBe(hmacDoCpf('123.456.789-09'));
    await withTenant(T.ctx, (tx) => gravarAssinante(tx, { tenantId: T.tenantId, cpf: '12345678909', userId: T.nutriId, agora: new Date() }), app.db);
    const a = await withTenant(T.ctx, (tx) => lerAssinante(tx), app.db);
    expect(a).toEqual({ cpfHmac: hmacDoCpf('12345678909'), cpfMascarado: '***.456.789-**' });
  });
});
```

Run: `pnpm test src/modules/documentos/perfil-profissional.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementação** — `src/modules/documentos/perfil-profissional.ts`

```ts
import { createHmac, hkdfSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { tenants, tenantSigner, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { encryptionKey } from '@/lib/crypto';
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

let chaveCpf: Buffer | undefined;
/** RN-145: HMAC do CPF com chave própria (HKDF de ENCRYPTION_KEY), como os links e os limites. */
export function hmacDoCpf(cpf: string): string {
  chaveCpf ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:cpf-assinante:v1', 32));
  return createHmac('sha256', chaveCpf).update(cpf.replace(/\D/g, '')).digest('base64url');
}
/** "***.456.789-**": a máscara do certificado (6 dígitos do meio). */
export function mascararCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

export async function lerAssinante(tx: Tx): Promise<{ cpfHmac: string; cpfMascarado: string } | null> {
  const [a] = await tx.select({ cpfHmac: tenantSigner.cpfHmac, cpfMascarado: tenantSigner.cpfMascarado }).from(tenantSigner);
  return a ?? null;
}

/** Primeiro certificado ou troca de CPF (RN-145), sempre na transação da assinatura, depois do código do 2FA. */
export async function gravarAssinante(tx: Tx, a: { tenantId: string; cpf: string; userId: string; agora: Date }): Promise<void> {
  const valores = { cpfHmac: hmacDoCpf(a.cpf), cpfMascarado: mascararCpf(a.cpf), confirmadoEm: a.agora, confirmadoPor: a.userId, updatedAt: a.agora };
  await tx.insert(tenantSigner).values({ tenantId: a.tenantId, ...valores }).onConflictDoUpdate({ target: tenantSigner.tenantId, set: valores });
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

> O passo `dados-documentos` só tem alvo na página "Perfil e marca": na página do hub, o tour pula o passo cujo alvo não está na tela (comportamento do `Tour` do Plano 08). Os textos entre aspas ("Perfil e marca", "Dados para documentos", "Segurança", "Fitoterápico (forma farmacêutica ou fórmula magistral)") precisam existir nos `.tsx`; o último é rótulo de opção do formulário da receita (T7) — até a T7, deixar a frase sem as aspas e voltá-las na T7.

Run: `pnpm test src/modules/ajuda/conteudo.test.ts src/app/painel` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/documentos/perfil-profissional{,.test}.ts src/app/painel/configuracoes src/modules/ajuda/conteudo.ts
git commit -m "feat(documentos): dados para documentos, habilitação em Fitoterapia e assinante do consultório (US-140)"
```

---
### Task 5: Código do 2FA no momento de assinar e o guia da tela de Segurança (RN-145, D13, D18; P10-05)

**Files:**
- Create: `src/lib/confirmar-2fa.ts`, `src/lib/confirmar-2fa.test.ts`, `src/app/conta/seguranca/ajuda-seguranca.tsx`
- Modify: `src/modules/agenda/limite-ip.ts` (tipos novos de `chaveDoLimite`), `src/app/conta/seguranca/page.tsx`, `src/app/conta/seguranca/enable-2fa.tsx` (`data-guia`), `src/modules/ajuda/conteudo.ts` (guia `seguranca`), `src/modules/ajuda/conteudo.test.ts` (páginas e `.tsx` de `src/app/conta`), `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `getAuth().api.verifyTOTP` (Better Auth `twoFactor`), `consumirLimite`/`liberarLimite`/`chaveDoLimite` (`limite-ip.ts`).
- Produces:
  - `chaveDoLimite(tipo: 'ip' | 'email-hora' | 'webhook' | 'verificacao-ip' | 'documento-ip' | 'documento-envio' | 'totp-erro' | 'totp-usado', valor)`.
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
  await auth.api.verifyTOTP({ body: { code: totp.generate() }, headers: headers() }); // ativa
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

Em `src/modules/agenda/limite-ip.ts`: `export function chaveDoLimite(tipo: 'ip' | 'email-hora' | 'webhook' | 'verificacao-ip' | 'documento-ip' | 'documento-envio' | 'totp-erro' | 'totp-usado', valor: string): string` (o corpo não muda; o comentário do arquivo ganha: "Plano 10: verificação pública por IP, código do link por IP e por documento, tentativas e repetição do código do 2FA").

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
 * RN-145 / D13 (Plano 10): o código do 2FA "no momento de assinar". `auth.api.verifyTOTP` chamado no servidor não passa
 * pelo rate limit HTTP do Better Auth nem conta falhas com sessão ativa (G7 da pesquisa) — por isso o limite próprio:
 * 5 tentativas em 15 min por usuária (chave = HMAC do id, `public_rate_limits`), zerado no acerto, e a recusa do mesmo
 * código já aceito nos últimos 90 s. O código nunca vai ao log; quem chama registra a recusa no histórico (assinar.ts).
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
            'Ao assinar documentos, o sistema pede o código do aplicativo no primeiro certificado do consultório e em todo envio digitalizado.',
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

/** D18 (Plano 10): /conta/seguranca não tem o GuiaDoPainel (fora do layout do painel); o guia aparece aqui, aberto ou fechado. */
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
  it('D18 (Plano 10): /conta/seguranca tem guia (o 2FA é exigido para assinar documentos)', () => {
    expect(guiaDaRota('/conta/seguranca')?.id).toBe('seguranca');
  });
```

- [ ] **Step 4: CLAUDE.md, regra 1** — na lista de quem acessa a tabela `user`/autenticação fora de `withTenant`: "…por `src/lib/confirmar-2fa.ts` (só pela API do Better Auth, `auth.api.verifyTOTP` com a sessão da própria usuária: o código do 2FA no momento de assinar, Plano 10, RN-145)".

- [ ] **Step 5: Rodar e commit**

Run: `pnpm test src/lib/confirmar-2fa.test.ts src/modules/ajuda src/app/conta` → PASS.

```bash
git add src/lib/confirmar-2fa{,.test}.ts src/modules/agenda/limite-ip.ts src/app/conta/seguranca src/modules/ajuda CLAUDE.md
git commit -m "feat(seguranca): código do 2FA no momento de assinar com limite e anti-repetição; guia da tela de Segurança (RN-145, D13, D18)"
```

---
### Task 6: Receita — código, esquema da prescrição e ciclo do rascunho até "Preparando o PDF" (US-142, US-143 parte 1, RN-142, RN-149, RN-150, RN-154; P10-06)

**Files:**
- Create: `src/modules/documentos/codigo.ts` (+ `codigo.test.ts`), `src/modules/documentos/prescricao.ts` (+ `prescricao.test.ts`), `src/modules/documentos/documentos.ts` (+ `documentos.test.ts`)
- Modify: `src/modules/documentos/constantes.ts` (declaração da receita), `src/jobs/queues.ts` (filas `documento-pdf`, `documento-digitalizado`, `expirar-documento-pdf`)

**Interfaces:**
- Consumes: `signedDocuments`, `signedDocumentNotes` (T2); `copiaDoPerfil`, `PerfilIncompletoError` (T4); `carregarPacienteParaEscrita`, `PacienteBloqueadoError`, `PacienteNaoEncontradoError`, `idValido` (`pacientes/base.ts`); `auditRead`; `getBoss`, `fromDrizzle`.
- Produces:
  - `codigo.ts`: `gerarCodigo(): string`, `normalizarCodigo(e: unknown): string | null`, `formatarCodigo(c: string): string`.
  - `prescricao.ts`: `TIPOS_ITEM`, `CATEGORIAS`, `UNIDADES`, `VIAS`, `MODOS_PREPARO` (rótulos exatos da US-142), `MSG_PRESCRICAO`, tipos `ItemPrescricao`, `ConteudoReceita = { versao: 1; tipo: 'receita'; itens: ItemPrescricao[]; orientacoes: string; copia?: { profissional: CopiaProfissional; paciente: { nome: string } }; declaracao?: string }`; `validarRascunho(input: unknown, o: { habilitada: boolean }): ConteudoReceita` (lança `DocumentoError` com chaves `itens.0.posologia`…), `validarParaPreparar(c: ConteudoReceita, justificativa: string | null, o: { habilitada: boolean }): void`, `descreverItem(item: ItemPrescricao): { titulo: string; linhas: string[] }`.
  - `documentos.ts`: `criarReceita(ctx, patientId, deps?): Promise<string>`, `salvarRascunhoReceita(ctx, tenant, patientId, docId, input: { conteudo: unknown; justificativa: unknown }, deps?)`, `apagarRascunho(ctx, patientId, docId, deps?)`, `prepararParaAssinatura(ctx, tenant, patientId, docId, input: { declaracao: unknown }, deps?: { db?; boss?; agora? })`, `voltarAEditar(ctx, patientId, docId, deps?: { db?; dataDir? })`, `pedirNovoPdfDocumento(ctx, patientId, docId, deps?)`, `listarDocumentos(ctx, patientId, db?): Promise<ItemLista[]>`, `lerDocumento(ctx, patientId, docId, db?): Promise<DocumentoLido | null>` (com `auditRead`), `estadoDoDocumento(ctx, docId, db?)`, `lerDocumentoNaTransacao(tx, id, o: { auditar: boolean })`; tipos `ItemLista`, `DocumentoLido`.
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
    expect(() => validarRascunho({ itens: [{ ...vitD, categoria: 'probiotico', composicao: [{ nome: 'L. acidophilus', quantidade: '10', unidade: 'mg' }] }] }, { habilitada: false })).toThrow(DocumentoError);
    try {
      validarRascunho({ itens: [{ ...vitD, categoria: 'probiotico', composicao: [{ nome: 'L. acidophilus', quantidade: '10', unidade: 'mg' }] }] }, { habilitada: false });
    } catch (e) {
      expect(erroEm('itens.0.composicao.0.unidade', MSG_PRESCRICAO.probiotico)(e)).toBe(true);
    }
    try {
      validarRascunho({ itens: [{ ...vitD, categoria: 'enzima', composicao: [{ nome: 'Lactase', quantidade: '9000', unidade: 'UI' }] }] }, { habilitada: false });
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
/** D5 da spec (RASCUNHO até a revisão da Debby e a consulta ao CRN-3, runbook passo 3). */
export const DECLARACAO_RECEITA =
  'Declaro que os itens são suplementos alimentares, produtos vegetais classificáveis como alimento ou suplemento ou fitoterápicos isentos de prescrição médica, dentro da minha competência (Resoluções CFN nº 656/2020 e nº 680/2021), e que a receita não indica marca nem local de compra.';
export const MSG_DECLARACAO = 'Confirme a declaração para continuar.';
```

Run: `pnpm test src/modules/documentos/prescricao.test.ts` → PASS.

- [ ] **Step 4: Filas** — `src/jobs/queues.ts`

```ts
  // Plano 10 (US-143): PDF preparado da receita, com o código e o QR (≤ 30 s, RNF-140). Payload { tenantId, documentoId }
  'documento-pdf': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // Plano 10 (RN-157, D4): PDF montado com as fotos da digitalizada. Payload { tenantId, documentoId }
  'documento-digitalizado': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 180, deleteAfterSeconds: 86_400 },
  // Plano 10: pendente há mais de 1 h → falhou; PDF base e fotos da digitalizada sem referência → apagados (de 15 em 15 min)
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
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'rascunho', justificativa: 'Exposição solar baixa', conteudo: { itens: [{ tipo: 'suplemento' }], orientacoes: 'Tomar com água.' } });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows.length).toBe(1);
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

  it('voltar a editar: o código deixa de existir e o PDF base sai do disco e da cota (RN-140 a)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const base = `${T.tenantId}/documento_base/${crypto.randomUUID()}.pdf`;
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, async (tx) => {
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id})`);
      await tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10, area_assinatura = '{"x1":351,"y1":62,"x2":559,"y2":132}' where id = ${id}`);
    }, app.db);
    await voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' });
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'rascunho', codigo: null });
    const sobrou = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${base}`), app.db);
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

/** RN-140 (a): volta a rascunho (código e base nulos) no naMesmaTransacao do DELETE do PDF base. */
export async function voltarAEditar(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; dataDir?: string } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const limpar = {
    status: 'rascunho', codigo: null, declaracaoEm: null, basePdfPath: null, basePdfSha256: null, basePdfBytes: null, areaAssinatura: null,
    pdfStatus: null, pdfPedidoEm: null, digitalizacao: null, digitalizacaoStatus: null, updatedAt: new Date(),
  } as const;
  const base = await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando', 'aguardando_assinatura']);
    if (!d.basePdfPath) await tx.update(signedDocuments).set(limpar).where(eq(signedDocuments.id, docId));
    return d.basePdfPath;
  }, db);
  if (!base) return;
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

/** US-143 "Gerar o PDF de novo": só com o PDF falho e ainda em preparo. */
export async function pedirNovoPdfDocumento(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; boss?: PgBoss; agora?: Date } = {}): Promise<void> {
  const boss = deps.boss ?? (await getBoss());
  const agora = deps.agora ?? new Date();
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando']);
    if (d.pdfStatus !== 'falhou') throw new TransicaoInvalidaError();
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

/** Lista do prontuário (título, data, situação): sem auditRead, como a agenda (D17). */
export async function listarDocumentos(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<ItemLista[]> {
  if (!idValido(patientId)) return [];
  return withTenant(ctx, async (tx) => {
    const ds = await tx.select().from(signedDocuments).where(eq(signedDocuments.patientId, patientId)).orderBy(desc(signedDocuments.createdAt));
    const rs = await recibosDe(tx, ds.map((d) => d.id));
    return ds.map((d) => comoItem(d, rs.get(d.id) ?? []));
  }, db);
}

/** Leitura completa na transação de quem chama; `auditar` = false no worker (como lerPlanoNaTransacao). */
export async function lerDocumentoNaTransacao(tx: Tx, id: string, o: { auditar: boolean }): Promise<DocumentoLido | null> {
  if (!idValido(id)) return null;
  const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, id));
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

/** Página do documento no painel (conteúdo + justificativa): dado de saúde, com auditRead (RNF-142). */
export async function lerDocumento(ctx: TenantContext, patientId: string, docId: string, db: Db = getDb()): Promise<DocumentoLido | null> {
  return withTenant(ctx, async (tx) => {
    const d = await lerDocumentoNaTransacao(tx, docId, { auditar: false });
    if (!d) return null;
    const [dono] = await tx.select({ p: signedDocuments.patientId }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (dono?.p !== patientId) return null;
    await auditRead(tx, { entidade: 'documentos', entidadeId: docId, patientId });
    return d;
  }, db);
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

Run: `pnpm test src/modules/documentos/documentos.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/documentos/{codigo,codigo.test,prescricao,prescricao.test,documentos,documentos.test,constantes}.ts src/jobs/queues.ts
git commit -m "feat(documentos): receita — código Crockford, esquema da prescrição e ciclo até o preparo (US-142, US-143, RN-142, RN-149, RN-150)"
```

---
### Task 7: Painel — aba "Documentos", lista, editor da receita, preparo, cartão do Início, interruptor do admin e o guia `documentos` (US-142, US-143, P-B8, D18, D20; P10-07)

**Files:**
- Create: `src/app/painel/pacientes/[id]/documentos/page.tsx`, `.../documentos/actions.ts`, `.../documentos/[docId]/page.tsx`, `.../documentos/[docId]/receita-form.tsx`, `.../documentos/[docId]/preparar.tsx`, `.../documentos/[docId]/estado-pdf.tsx`
- Modify: `src/app/painel/pacientes/[id]/abas.tsx` e `layout.tsx` (aba só com `documentosLiberados`), `src/modules/agenda/inicio.ts` + `src/app/painel/page.tsx` (cartão), `src/modules/plataforma/contas.ts` + `src/app/admin/{page.tsx,actions.ts,documentos-form.tsx}` (D20), `src/modules/ajuda/conteudo.ts` (+ `conteudo.test.ts`: `src/modules/documentos` em `TSX_FORA`), `e2e/painel-rotas.ts`, `e2e/painel.ts`, `scripts/e2e-seed.ts`

**Interfaces:**
- Consumes: tudo da T6; `ROTULO_STATUS`, `DECLARACAO_RECEITA`, `MSG_DECLARACAO` (constantes); `TIPOS_ITEM`, `CATEGORIAS`, `UNIDADES`, `VIAS`, `MODOS_PREPARO`, `descreverItem` (prescricao); `carregarProntuario`; `Cartao`, `Botao`, `BotaoLink`, `Aviso`, `Selo`, `ConfirmarBotao`.
- Produces:
  - Server Actions (`.../documentos/actions.ts`): `criarReceitaAction(patientId)`, `salvarRascunhoAction(patientId, docId, prev, form)`, `apagarRascunhoAction(patientId, docId)`, `prepararAction(patientId, docId, prev, form)`, `voltarAEditarAction(patientId, docId)`, `pedirNovoPdfAction(patientId, docId)`; tipo `EstadoForm = { erros?: Record<string, string>; ok?: boolean }`.
  - `situacaoNoPainel(d: ItemLista): string` (em `documentos.ts`: "Rascunho", "Preparando o PDF", "Aguardando assinatura", "Assinado em dd/mm/aaaa"…, a parte da entrega vem na T12).
  - `contarAguardandoAssinatura(tx): Promise<number>` (em `documentos.ts`); `Inicio.documentosAguardando: number | null`.
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

export async function apagarRascunhoAction(patientId: string, docId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await apagarRascunho(ctx, patientId, docId);
  } catch (e) {
    comoEstado(e);
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

export async function voltarAEditarAction(patientId: string, docId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await voltarAEditar(ctx, patientId, docId);
  } catch (e) {
    comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
}

export async function pedirNovoPdfAction(patientId: string, docId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await pedirNovoPdfDocumento(ctx, patientId, docId);
  } catch (e) {
    comoEstado(e);
  }
  revalidatePath(caminho(patientId, docId));
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
import { ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO } from '@/modules/documentos/constantes';
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

/** "dd/mm/aaaa às hh:mm" no fuso do consultório (o formatarQuando da agenda põe o dia da semana na frente). */
export function dataHora(d: Date, fuso: string): string {
  const p = partesNoFuso(d, fuso);
  return `${formatarData(p.data)} às ${p.hora}`;
}

/** Linha da situação na lista (a parte da entrega e do recebimento entra na T12). */
export function situacaoNoPainel(d: ItemLista, fuso: string): string {
  if (d.status === 'preparando') return d.pdfStatus === 'falhou' ? 'Não foi possível gerar o PDF. Tente de novo.' : '';
  if (d.status === 'assinado' && d.assinadoEm) return `Assinado em ${dataHora(d.assinadoEm, fuso)}`;
  return '';
}

/** P-B8: o cartão do Início. */
export async function contarAguardandoAssinatura(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(signedDocuments).where(eq(signedDocuments.status, 'aguardando_assinatura'));
  return r?.n ?? 0;
}
```


- [ ] **Step 4: Página do documento** — `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import { Botao, BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { Selo } from '@/components/ui/selo';
import { idValido } from '@/modules/pacientes/base';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { DECLARACAO_RECEITA, ROTULO_ASSINATURA, ROTULO_STATUS } from '@/modules/documentos/constantes';
import { dataHora, lerDocumento } from '@/modules/documentos/documentos';
import { descreverItem } from '@/modules/documentos/prescricao';
import { carregarProntuario } from '../../prontuario';
import { apagarRascunhoAction, pedirNovoPdfAction, voltarAEditarAction } from '../actions';
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
  return (
    <section aria-labelledby="documento" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="documento" className="text-lg font-semibold">Receita</h2>
        <Selo>{ROTULO_STATUS[d.status]}</Selo>
        {d.codigo && d.status !== 'rascunho' && <span className="text-sm text-suave">{`Código de verificação: ${formatarCodigo(d.codigo)}`}</span>}
      </div>

      {d.status === 'rascunho' && !bloqueado && (
        <>
          <ReceitaForm patientId={paciente.id} docId={d.id} conteudo={d.conteudo} justificativa={d.justificativa ?? ''} habilitada={habilitada} />
          <Preparar patientId={paciente.id} docId={d.id} declaracao={DECLARACAO_RECEITA} />
          <form action={apagarRascunhoAction.bind(null, paciente.id, d.id)}>
            <ConfirmarBotao mensagem="Apagar este rascunho?">Apagar rascunho</ConfirmarBotao>
          </form>
        </>
      )}

      {d.status !== 'rascunho' && (
        <Cartao titulo="Itens da receita">
          <ol className="list-decimal space-y-2 pl-5">
            {d.conteudo.itens.map((it, i) => {
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
        d.pdfStatus === 'falhou' ? (
          <Aviso tipo="erro" papel="alert">
            Não foi possível gerar o PDF. Tente de novo.
            <form action={pedirNovoPdfAction.bind(null, paciente.id, d.id)} className="mt-2">
              <Botao variante="secundario">Gerar o PDF de novo</Botao>
            </form>
          </Aviso>
        ) : (
          <EstadoPdf docId={d.id} />
        )
      )}

      {d.status === 'aguardando_assinatura' && (
        <Cartao titulo="Aguardando assinatura" data-guia="assinar-documento">
          <p>
            Assine o PDF no assinador do gov.br (assinador.iti.br) ou com o seu certificado ICP-Brasil e envie o arquivo assinado aqui. Sem gov.br nem certificado, imprima, assine à mão e envie fotos das páginas.
          </p>
          <p className="text-sm text-suave">Se o assinador pedir o lugar da assinatura visível, use o quadro &quot;Assinatura digital&quot; no fim da página.</p>
          <BotaoLink href={`/api/painel/documentos/${d.id}/pdf?base=1`} prefetch={false}>Baixar PDF para assinar</BotaoLink>
          {!data.user.twoFactorEnabled && (
            <Aviso tipo="aviso">
              Ative a verificação em duas etapas em Segurança para assinar documentos. <a href="/conta/seguranca" className="underline">Ativar agora</a>
            </Aviso>
          )}
          {!bloqueado && (
            <form action={voltarAEditarAction.bind(null, paciente.id, d.id)}>
              <ConfirmarBotao mensagem="O PDF preparado será descartado. Continuar?">Voltar a editar</ConfirmarBotao>
            </form>
          )}
        </Cartao>
      )}

      {d.status === 'assinado' && (
        <Cartao titulo="Documento assinado">
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
          <BotaoLink href={`/api/painel/documentos/${d.id}/pdf`} prefetch={false} variante="secundario">Baixar PDF assinado</BotaoLink>
        </Cartao>
      )}
    </section>
  );
}
```

> A T10 acrescenta `<EnviarAssinado />` e a T11 `<EnviarDigitalizada />` dentro do cartão "Aguardando assinatura"; a T12 a seção de entrega e recebimento; a T17 o "Cancelar documento".

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
      if (vivo && j && (j.status !== 'preparando' || j.pdfStatus === 'falhou')) router.refresh();
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
        <Cartao titulo="Documentos aguardando assinatura" data-guia="documentos-aguardando">
          <p>{documentosAguardando === 1 ? '1 documento aguardando assinatura' : `${documentosAguardando} documentos aguardando assinatura`}</p>
          <p className="text-sm text-suave">Abra o prontuário do paciente, aba "Documentos", para assinar e enviar.</p>
        </Cartao>
```

`contas.ts`: `listarContas` seleciona `documentos_liberados` (`ContaResumo.documentosLiberados: boolean`) e:

```ts
/** D20 (Plano 10): o admin libera os documentos assinados do consultório só depois da liberação para uso real. */
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

Na tabela do admin, coluna "Documentos" com um formulário por linha: `<form action={definirDocumentosAction.bind(null, c.tenantId, !c.documentosLiberados)}><ConfirmarBotao mensagem={c.documentosLiberados ? \`Bloquear os documentos assinados de ${c.nomeExibicao}?\` : \`Liberar os documentos assinados para ${c.nomeExibicao}? Confira antes a resposta do CRN-3, o termo e o backup.\`}>{c.documentosLiberados ? 'Bloquear' : 'Liberar'}<span className="sr-only">{\` os documentos de ${c.nomeExibicao}\`}</span></ConfirmarBotao></form>`.

- [ ] **Step 8: Guia `documentos`** (antes do `prontuario` em `GUIAS`)

```ts
  {
    id: 'documentos',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}/documentos(/.*)?$`),
    titulo: 'Documentos e receita',
    ajuda: {
      resumo: 'Receitas de suplementos e fitoterápicos com os campos que o CFN exige, assinadas por você no gov.br, com o seu certificado ICP-Brasil ou à mão, e entregues ao paciente com código de verificação.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Clique em "Nova receita", adicione os itens e escreva a justificativa de uso (ela fica no prontuário e não vai na receita). Clique em "Salvar rascunho".',
            'Clique em "Preparar para assinatura" e confirme a declaração. Em alguns segundos o PDF fica pronto.',
            'Clique em "Baixar PDF para assinar", assine no assinador do gov.br ou com o seu certificado e envie o arquivo assinado. Sem gov.br nem certificado, use "Enviar documento digitalizado (assinado à mão)".',
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
      { alvo: 'assinar-documento', titulo: 'Assinar e enviar', texto: 'Baixe o PDF, assine no gov.br ou com o seu certificado e envie o arquivo assinado. O sistema confere a assinatura.' },
    ],
  },
```

> As frases entre aspas citam rótulos de telas das Tarefas 10, 11, 12 e 17 ("Enviar documento digitalizado (assinado à mão)", "Entregue pessoalmente", "Cancelar documento"): até elas existirem, a guarda "todo nome citado existe numa tela" falha. Escrever o guia com essas três frases **sem aspas** aqui e pôr as aspas de volta na Tarefa 18 (fechamento do manual).

- [ ] **Step 9: Rotas do axe e o id no E2E**

`e2e/painel-rotas.ts`: `IdsDoPainel` ganha `documento: string`; `ROTAS_DO_PAINEL` ganha:

```ts
  '/painel/pacientes/[id]/documentos': (i) => `/painel/pacientes/${i.paciente}/documentos`,
  '/painel/pacientes/[id]/documentos/[docId]': (i) => `/painel/pacientes/${i.paciente}/documentos/${i.documento}`,
```

`e2e/painel.ts` (`prepararTelasComId`), antes do `return`:

```ts
  // receita (Plano 10): o consultório do E2E tem os documentos liberados no seed (D20)
  await nutri.goto(`${p}/documentos`);
  await nutri.getByRole('button', { name: 'Nova receita' }).click();
  await expect(nutri).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  const documento = idDaUrl(nutri, new RegExp(`/documentos/(${UUID})$`));
```

e `documento` no objeto devolvido. `scripts/e2e-seed.ts`: o consultório da nutricionista do E2E com `documentosLiberados: true`, `crn`, `nomeProfissional`, `contatoEmail`, `contatoTelefoneE164` preenchidos.

- [ ] **Step 10: Rodar e commit**

Run: `pnpm test src/modules/ajuda src/app/painel src/app/admin src/modules/agenda/inicio.test.ts && pnpm typecheck && pnpm lint` → PASS.

```bash
git add src/app/painel/pacientes/[id] src/app/painel/page.tsx src/modules/agenda/inicio.ts src/modules/plataforma/contas.ts src/app/admin src/modules/documentos/documentos.ts src/modules/ajuda e2e/painel-rotas.ts e2e/painel.ts scripts/e2e-seed.ts
git commit -m "feat(documentos): aba Documentos, editor da receita, preparo, cartão do Início, liberação pelo admin e guia (US-142, US-143, P-B8, D18, D20)"
```

---
### Task 8: PDF preparado no worker — marca, carimbo, quadro "Assinatura digital", código e QR (US-143, RN-142, RN-143, D15; P10-08)

**Files:**
- Create: `src/modules/documentos/documento-pdf.tsx`, `src/modules/documentos/documento-pdf-job.ts`, `src/modules/documentos/documento-pdf-job.test.ts`, `src/app/api/painel/documentos/[id]/pdf/route.ts` (+ `route.test.ts`)
- Modify: `src/worker/index.ts`, `src/modules/documentos/documentos.ts` (`caminhoDoPdfNoPainel`), `src/modules/pacientes/exportacao.test.ts` (guarda de grafo)

**Interfaces:**
- Consumes: `signedDocuments` (T2); `lerDocumentoNaTransacao`, `ConteudoReceita`, `descreverItem`, `formatarCodigo` (T6); `AREA_ASSINATURA`, `CAMPO_PRE_CRIADO` (T1); `acrescentarCampoDeAssinatura` (T1); `salvarArquivo`, `apagarArquivo`, `resolverCaminho`, `CotaEsgotadaError`; `buscarTenant`, `tenantIsActive`, `listarTenantsParaVarredura`; `paraWinAnsi`; `QRCode` (`qrcode`); `urlDoApp`.
- Produces:
  - `renderizarDocumento(d: DadosPdfDocumento): Promise<Buffer>`; `DadosPdfDocumento = { conteudo: ConteudoReceita; codigo: string; urlVerificacao: string; data: string; cor: string; logo: Buffer | null; nomeConsultorio: string }`.
  - `gerarPdfDoDocumento(data: { tenantId: string; documentoId: string }, deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean; renderizar?: typeof renderizarDocumento }): Promise<'pronto' | 'ignorado' | 'falhou'>`.
  - `expirarPdfsDeDocumentoPendentes(db: Db, now: Date): Promise<number>`; `limparArquivosOrfaosDeDocumentos(db: Db, now: Date, dataDir: string): Promise<number>`.
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
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { AREA_ASSINATURA } from './constantes';
import { renderizarDocumento, type DadosPdfDocumento } from './documento-pdf';
import { expirarPdfsDeDocumentoPendentes, gerarPdfDoDocumento, limparArquivosOrfaosDeDocumentos } from './documento-pdf-job';
import { lerBase } from './pdf-leitor';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const conteudo = {
  versao: 1, tipo: 'receita', orientacoes: 'Tomar com água.',
  itens: [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia', duracao: '', manipulado: false }],
  copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'debby@consultorio.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana Souza' } },
};

async function emPreparo() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const id = randomUUID();
  await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em)
    values (${id}, ${T.tenantId}, ${p.id}, 'preparando', 'ABCDEFGHJKMN', ${JSON.stringify(conteudo)}::jsonb, now(), 'pendente', now())`), app.db);
  return { T, p, id };
}

describe('PDF preparado (US-143)', () => {
  it('gera o PDF com o código, o QR e o quadro; grava SHA-256, bytes e área; leva a "Aguardando assinatura"', async () => {
    const { T, id } = await emPreparo();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    let recebido: DadosPdfDocumento | undefined;
    const r = await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, {
      db: app.db, dataDir, appUrl: 'https://nutri.exemplo.com', ultimaTentativa: false,
      renderizar: async (d) => ((recebido = d), renderizarDocumento(d)),
    });
    expect(r).toBe('pronto');
    expect(recebido).toMatchObject({ codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://nutri.exemplo.com/v/ABCDEFGHJKMN' });
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status, base_pdf_path, base_pdf_sha256, base_pdf_bytes, area_assinatura from signed_documents where id = ${id}`), app.db)).rows as Record<string, unknown>[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', pdf_status: 'pronto', area_assinatura: AREA_ASSINATURA });
    const arquivo = await readFile(path.join(dataDir, String(d.base_pdf_path)));
    expect(createHash('sha256').update(arquivo).digest('hex')).toBe(d.base_pdf_sha256);
    expect(arquivo.length).toBe(d.base_pdf_bytes);
    // a premissa do leitor (T1): o PDF do react-pdf tem uma revisão, xref clássica e nenhum /ObjStm
    const base = lerBase(arquivo);
    expect([...base.objetos.values()].every((o) => o.objStm === null)).toBe(true);
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

  it('expira o pendente esquecido (> 1 h) e apaga PDF base sem referência (> 1 h)', async () => {
    const { T, p, id } = await emPreparo();
    const agora = new Date(Date.now() + 2 * 3600_000);
    expect(await expirarPdfsDeDocumentoPendentes(app.db, agora)).toBeGreaterThanOrEqual(1);
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d.pdf_status).toBe('falhou');
    const orfao = `${T.tenantId}/documento_base/${randomUUID()}.pdf`;
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id, created_at) values (${T.tenantId}, 'documento_base', ${orfao}, 10, 'application/pdf', ${p.id}, now() - interval '2 hours')`), app.db);
    expect(await limparArquivosOrfaosDeDocumentos(app.db, new Date(), '/tmp')).toBeGreaterThanOrEqual(1);
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
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { patients, signedDocuments, storedFiles } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { apagarArquivo, CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { COR_PADRAO } from '@/modules/plataforma/marca-constantes';
import { buscarTenant, listarTenantsParaVarredura, tenantIsActive } from '@/modules/plataforma/tenant-status';
import { acrescentarCampoDeAssinatura } from './campo-assinatura';
import { AREA_ASSINATURA, CAMPO_PRE_CRIADO } from './constantes';
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
 */
export async function gerarPdfDoDocumento(data: { tenantId: string; documentoId: string }, deps: DepsJobDocumento): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () =>
    withTenant(ctx, (tx) => tx.update(signedDocuments).set({ pdfStatus: 'falhou', updatedAt: now }).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente'))), db);
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorado';
  }
  const lido = await withTenant(ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente')));
    return d ?? null;
  }, db);
  if (!lido || !lido.codigo) return 'ignorado';
  try {
    const tenant = (await buscarTenant(db, data.tenantId))!;
    const logo = tenant.logoPath ? await readFile(resolverCaminho(deps.dataDir, tenant.logoPath)).catch(() => null) : null;
    let pdf = await (deps.renderizar ?? renderizarDocumento)({
      conteudo: lido.conteudo as ConteudoReceita,
      codigo: lido.codigo,
      urlVerificacao: urlDoApp(deps.appUrl, `/v/${lido.codigo}`),
      data: formatarData(hojeNoFuso(tenant.fuso, lido.declaracaoEm ?? now)),
      cor: tenant.corPrimaria ?? COR_PADRAO,
      logo,
      nomeConsultorio: tenant.nomeExibicao,
    });
    if (CAMPO_PRE_CRIADO) pdf = acrescentarCampoDeAssinatura(pdf, AREA_ASSINATURA);
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
            .where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente')))
            .returning({ id: signedDocuments.id });
          if (!r.length) throw new JaProntoError();
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
      await marcarFalhou();
      return 'falhou';
    }
    throw e;
  }
}

export const PDF_DOCUMENTO_PENDENTE_MAX_MS = 3600_000;

/** Rede de segurança do "Preparando o PDF…" (como expirarPdfsPendentes do plano). Um tenant com erro não para os outros. */
export async function expirarPdfsDeDocumentoPendentes(db: Db, now: Date): Promise<number> {
  const limite = new Date(now.getTime() - PDF_DOCUMENTO_PENDENTE_MAX_MS);
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    try {
      const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) =>
        tx.update(signedDocuments).set({ pdfStatus: 'falhou', updatedAt: now })
          .where(and(eq(signedDocuments.status, 'preparando'), eq(signedDocuments.pdfStatus, 'pendente'), lt(sql`coalesce(${signedDocuments.pdfPedidoEm}, ${signedDocuments.updatedAt})`, limite)))
          .returning({ id: signedDocuments.id }), db);
      n += r.length;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao expirar PDFs de documento pendentes');
    }
  }
  return n;
}

/**
 * RN-140 (b) e RN-157: o PDF base que sobrou (o apagarArquivo depois da assinatura falhou) e as fotos da digitalizada sem
 * documento que aponte para elas, com mais de 1 h, saem do disco e da cota. A referência é conferida de novo dentro da
 * transação do apagar (naMesmaTransacao).
 */
export async function limparArquivosOrfaosDeDocumentos(db: Db, now: Date, dataDir: string): Promise<number> {
  const limite = new Date(now.getTime() - PDF_DOCUMENTO_PENDENTE_MAX_MS);
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
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
  // Plano 10 (US-143): PDF preparado da receita; a cada 15 min, pendente esquecido → falhou e PDF base/fotos órfãos apagados
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

- [ ] **Step 6: Guarda de grafo** — em `src/modules/pacientes/exportacao.test.ts`, a lista de proibidos ganha `'src/modules/documentos/documento-pdf.tsx'`, `'src/modules/documentos/documento-pdf-job.ts'` e `'src/modules/documentos/digitalizada-job.ts'` (o último nasce na T11; antes dela a conferência passa por não existir).

Run: `pnpm test src/modules/documentos src/app/api/painel/documentos src/modules/pacientes/exportacao.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/documentos/{documento-pdf.tsx,documento-pdf-job.ts,documento-pdf-job.test.ts,documentos.ts} src/app/api/painel/documentos src/worker/index.ts src/modules/pacientes/exportacao.test.ts
git commit -m "feat(documentos): PDF preparado no worker com carimbo, quadro de assinatura, código e QR (US-143)"
```

---
### Task 9: Conferência do PDF assinado — forma do `/ByteRange`, lista fechada por alcance, CMS, cadeia, validade e titular, sem rede (RN-144, RN-145 parte técnica, RNF-141; P10-09)

> Escrita com o resultado do relatório do spike (T1, Step 14): se ele mandou ajustar a lista fechada (ex.: um `/Prop_Build` ou `/Metadata` que o gov.br põe), o ajuste entra aqui **com uma réplica estrutural** na fábrica; se mandou a T19, esta tarefa fica com a parte criptográfica (CMS, cadeia, titular) e a comparação de conteúdo vai para o worker.

**Files:**
- Create: `src/modules/documentos/pdf-atualizacao.ts`, `src/modules/documentos/cms.ts`, `src/modules/documentos/certificados.ts`, `src/modules/documentos/assinatura-pades.ts`, `src/modules/documentos/assinatura-pades.test.ts`, `src/modules/documentos/sem-rede.test.ts`
- Modify: `src/modules/documentos/constantes.ts` (`MAX_ENVIO_BYTES`, `LIMITE_CONFERENCIA_MS`)

**Interfaces:**
- Consumes: `lerBase`, `lerAtualizacao`, `pegar`, `iguais`, `percorrer`, `ehDict`, `ehRef`, `ehStream`, `nomeDe`, `dictDe`, `PdfIlegivelError` (T1); `carregarAncoras`, `Ancoras` (T1); `RecusaAssinaturaError` (T2); fábrica `criarAc`, `criarTitular`, `assinarDeTeste`, `RECT_NO_QUADRO`, `RECT_SOBRE_A_DOSE` (T1); `baseMinimo` (T1).
- Produces:
  - `BaseDoDocumento = { bytes: number; sha256: string; area: AreaAssinatura }`.
  - `conferirAtualizacao(arquivo: Buffer, base: BaseDoDocumento): { contents: Buffer; byteRange: [number, number, number, number]; subFilter: string }` (o base com o campo pré-criado — uma revisão nossa — é lido sozinho por `estadoInicial`).
  - `lerCms(contents: Buffer): CmsLido`, `conferirCms(c: CmsLido, cobertos: Buffer, o: { cades: boolean }): void`.
  - `cadeiaAte(titular: X509Certificate, extras: X509Certificate[], ancoras: Ancoras, agora: Date): { conjunto: 'icp' | 'govbr'; emissor: string }`, `titularDoCertificado(c: X509Certificate, conjunto): { nome: string; cpf: string | null }`, `cpfValido(cpf: string): boolean`, `normalizarNome(n: string): string`.
  - `conferirPdfAssinado(arquivo: Buffer, base: BaseDoDocumento, deps?: { ancoras?: Ancoras; agora?: Date; campoPreCriado?: boolean; limiteMs?: number }): Conferido` com `Conferido = { tipo: 'govbr' | 'icp'; emissor: string; titularNome: string; cpf: string | null; sha256: string }`. Lança só `RecusaAssinaturaError` (código fixo; `motivoTecnico` só para o log).

- [ ] **Step 1: Testes com a fábrica (falham)** — `src/modules/documentos/assinatura-pades.test.ts`

```ts
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { baseMinimo } from '../../../test/assinatura/base-minimo';
import { assinarDeTeste, criarAc, criarTitular, RECT_NO_QUADRO, RECT_SOBRE_A_DOSE, type AcDeTeste, type OpcoesAssinatura, type TitularDeTeste } from '../../../test/assinatura/fabrica';
import type { Ancoras } from './ancoras';
import { conferirPdfAssinado, type BaseDoDocumento } from './assinatura-pades';
import { AREA_ASSINATURA } from './constantes';
import { RecusaAssinaturaError, type CodigoRecusa } from './erros';

let icp: AcDeTeste, gov: AcDeTeste, estranha: AcDeTeste;
let debby: TitularDeTeste, debbyGov: TitularDeTeste, outra: TitularDeTeste, vencido: TitularDeTeste, cnpj: TitularDeTeste, semUso: TitularDeTeste, desconhecida: TitularDeTeste;
let ancoras: Ancoras;
const BASE = baseMinimo();
const base: BaseDoDocumento = { bytes: BASE.length, sha256: createHash('sha256').update(BASE).digest('hex'), area: AREA_ASSINATURA };

beforeAll(async () => {
  icp = await criarAc({ nome: 'AC Raiz ICP de Teste' });
  gov = await criarAc({ nome: 'AC Raiz gov.br de Teste' });
  estranha = await criarAc({ nome: 'AC Estranha' });
  ancoras = { raizesIcp: [icp.raiz], acsIcp: [icp.intermediaria], govbr: { raiz: gov.raiz, intermediaria: gov.intermediaria, final: gov.intermediaria } };
  debby = await criarTitular(icp, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
  debbyGov = await criarTitular(gov, { nome: 'DÉBORA SILVA SANTOS', cpf: '12345678909', tipo: 'govbr' });
  outra = await criarTitular(icp, { nome: 'OUTRA PESSOA', cpf: '98765432100' });
  vencido = await criarTitular(icp, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909', vencido: true });
  cnpj = await criarTitular(icp, { nome: 'CLINICA LTDA', tipo: 'ecnpj' });
  semUso = await criarTitular(icp, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909', semUsoDeAssinatura: true });
  desconhecida = await criarTitular(estranha, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
}, 60_000);

const recusa = (codigo: CodigoRecusa) => (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === codigo;
const conferir = (pdf: Buffer) => conferirPdfAssinado(pdf, base, { ancoras });
const assinado = (t: TitularDeTeste, o: OpcoesAssinatura = {}) => assinarDeTeste(BASE, t, o);

describe('conferência do PDF assinado — variantes válidas (RN-144)', () => {
  it.each<[string, OpcoesAssinatura]>([
    ['invisível, adbe.pkcs7.detached', {}],
    ['ETSI.CAdES.detached com signingCertificateV2', { subFilter: 'ETSI.CAdES.detached' }],
    ['visível dentro do quadro "Assinatura digital"', { rect: RECT_NO_QUADRO }],
    ['com a cadeia completa no CMS', { cadeiaNoCms: icp }],
    ['com a revisão de validação de longo prazo (/DSS)', { depois: 'ltv' }],
  ])('%s → aceito, tipo icp, titular e CPF lidos do campo próprio', async (_n, o) => {
    const pdf = await assinado(debby, o);
    const c = conferir(pdf);
    expect(c).toMatchObject({ tipo: 'icp', titularNome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
    expect(c.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  });

  it('gov.br: o conjunto vem da âncora (nunca do nome do emissor); o nome sem acento confere depois (RN-145, T10)', async () => {
    const c = conferir(await assinado(debbyGov));
    expect(c).toMatchObject({ tipo: 'govbr', titularNome: 'DÉBORA SILVA SANTOS' });
  });

  it('ECDSA P-256 pelo node:crypto', async () => {
    const ec = await criarAc({ alg: 'ECDSA', nome: 'AC EC de Teste' });
    const t = await criarTitular(ec, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
    expect(conferirPdfAssinado(await assinarDeTeste(BASE, t), base, { ancoras: { ...ancoras, raizesIcp: [ec.raiz], acsIcp: [ec.intermediaria] } }).tipo).toBe('icp');
  });
});

describe('conferência do PDF assinado — adulterações recusadas (RN-144, RNF-141, Review Focus 1)', () => {
  it.each<[string, OpcoesAssinatura, CodigoRecusa]>([
    ['/FreeText com outra dose', { freeText: true }, 'alterado'],
    ['/Stamp', { stamp: true }, 'alterado'],
    ['stream de conteúdo da página redefinido', { redefinirConteudoDaPagina: true }, 'alterado'],
    ['fonte redefinida (shadow "replace")', { redefinirFonte: true }, 'alterado'],
    ['/Resources da página trocado', { trocarResources: true }, 'alterado'],
    ['/MediaBox trocado', { trocarMediaBox: true }, 'alterado'],
    ['/OpenAction com JavaScript no Catálogo', { openAction: true }, 'alterado'],
    ['/AA com JavaScript no widget', { javascriptNoWidget: true }, 'alterado'],
    ['página nova', { paginaNova: true }, 'alterado'],
    ['dois dicionários de assinatura', { duasAssinaturas: true }, 'alterado'],
    ['/ByteRange que não chega ao fim (USF)', { byteRangeCurto: true }, 'alterado'],
    ['lixo depois do %%EOF', { lixoNoFim: true }, 'alterado'],
    ['atualização depois da assinatura que não é /DSS (ISA)', { depois: 'isa' }, 'alterado'],
    ['widget visível sobre a dose', { rect: RECT_SOBRE_A_DOSE }, 'fora_do_quadro'],
    ['/BBox da aparência maior que o /Rect', { rect: RECT_NO_QUADRO, bbox: [0, 0, 600, 800] }, 'alterado'],
    ['messageDigest que não confere', { digestErrado: true }, 'nao_confere'],
    ['SHA-1', { digest: 'sha1' }, 'nao_aceito'],
  ])('%s → %s', async (_n, o, codigo) => {
    const pdf = await assinado(debby, o);
    let erro: unknown;
    try {
      conferir(pdf);
    } catch (e) {
      erro = e;
    }
    expect(recusa(codigo)(erro)).toBe(true);
  });

  it('PDF de outro documento (prefixo diferente) → "Este PDF não é o documento preparado."', async () => {
    const outro = await assinarDeTeste(baseMinimo('Vitamina D3 50000 UI'), debby);
    expect(() => conferir(outro)).toThrow(RecusaAssinaturaError);
    try {
      conferir(outro);
    } catch (e) {
      expect(recusa('nao_e_o_preparado')(e)).toBe(true);
    }
  });

  it('o PDF preparado sem assinatura, um arquivo que não é PDF e um de 11 MB', () => {
    expect(() => conferir(Buffer.concat([BASE, Buffer.from('\n')]))).toThrow(RecusaAssinaturaError);
    expect(() => conferir(Buffer.from('MZ não é pdf'))).toThrow(RecusaAssinaturaError);
    expect(() => conferir(Buffer.concat([BASE, Buffer.alloc(11 * 1024 * 1024)]))).toThrow(RecusaAssinaturaError);
  });
});

describe('certificados (RN-144 (9)–(10), Review Focus 2)', () => {
  it.each<[string, () => TitularDeTeste, CodigoRecusa]>([
    ['vencido na hora do envio', () => vencido, 'vencido'],
    ['e-CNPJ', () => cnpj, 'empresa'],
    ['sem uso de assinatura (keyUsage)', () => semUso, 'nao_aceito'],
    ['cadeia até raiz desconhecida', () => desconhecida, 'nao_aceito'],
  ])('%s → %s', async (_n, t, codigo) => {
    const pdf = await assinado(t());
    let erro: unknown;
    try {
      conferir(pdf);
    } catch (e) {
      erro = e;
    }
    expect(recusa(codigo)(erro)).toBe(true);
  });

  it('o CPF e o CN nunca vão na mensagem nem no motivo técnico do erro', async () => {
    try {
      conferir(await assinado(outra, { freeText: true }));
    } catch (e) {
      const r = e as RecusaAssinaturaError;
      expect(`${r.message} ${r.motivoTecnico}`).not.toMatch(/98765432100|OUTRA PESSOA/);
    }
  });
});

describe('desempenho (RNF-140)', () => {
  it('confere em menos de 3 s um PDF preparado grande (40 itens e um logo de ~3 MB)', async () => {
    const { renderizarDocumento } = await import('./documento-pdf');
    const sharp = (await import('sharp')).default;
    // PNG de ruído (não comprime): ~3 MB de imagem dentro do PDF base
    const ruido = Buffer.from(Array.from({ length: 1000 * 1000 * 3 }, () => Math.floor(Math.random() * 256)));
    const logo = await sharp(ruido, { raw: { width: 1000, height: 1000, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    const item = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia', duracao: '', manipulado: false } as const;
    const pdfBase = await renderizarDocumento({
      conteudo: { versao: 1, tipo: 'receita', orientacoes: '', itens: Array(40).fill(item), copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana' } } },
      codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '05/10/2026', cor: '#1d6b5a', logo, nomeConsultorio: 'Consultório',
    });
    const b = { bytes: pdfBase.length, sha256: createHash('sha256').update(pdfBase).digest('hex'), area: AREA_ASSINATURA };
    const pdf = await assinarDeTeste(pdfBase, debby);
    const t0 = performance.now();
    conferirPdfAssinado(pdf, b, { ancoras });
    expect(performance.now() - t0).toBeLessThan(3000);
  }, 60_000);
});
```

Run: `pnpm test src/modules/documentos/assinatura-pades.test.ts` → FAIL (módulos não existem).

- [ ] **Step 2: Atualização incremental** — `src/modules/documentos/pdf-atualizacao.ts`

```ts
import { createHash } from 'node:crypto';
import type { AreaAssinatura } from './constantes';
import { TOLERANCIA_AREA_PT } from './constantes';
import { RecusaAssinaturaError } from './erros';
import {
  dictDe, ehDict, ehRef, ehStream, iguais, lerAtualizacao, lerBase, nomeDe, pegar, percorrer, PdfIlegivelError,
  type ObjetoLido, type PdfDict, type PdfRef, type PdfValor, type Revisao,
} from './pdf-leitor';

export type BaseDoDocumento = { bytes: number; sha256: string; area: AreaAssinatura };
export type AssinaturaDaAtualizacao = { contents: Buffer; byteRange: [number, number, number, number]; subFilter: string };

const alterado = (motivo: string) => new RecusaAssinaturaError('alterado', motivo);
const SUBFILTERS = new Set(['adbe.pkcs7.detached', 'ETSI.CAdES.detached']);
/** RN-144 (5): ação, script ou anexo em qualquer objeto novo ou redefinido → recusa. */
const PROIBIDAS = new Set(['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'Names', 'XFA', 'URI', 'SubmitForm', 'ImportData', 'GoToR', 'RichMedia', 'Movie', 'Sound', 'Rendition']);
const TIPOS_DE_APARENCIA = new Set(['XObject', 'Font', 'FontDescriptor', 'ExtGState', 'Encoding', 'ObjStm', 'XRef', 'SigRef', 'TransformParams', 'Sig', 'Metadata']);
/** ISO 32000, 12.5.6: todo /Subtype de anotação (a /FreeText sem /Type /Annot também é anotação). */
const SUBTIPOS_DE_ANOTACAO = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget', 'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Redact', 'Projection', 'RichMedia']);

type Estado = { objetos: Map<number, ObjetoLido>; tamanho: number; raiz: number; paginas: Set<number>; acroform: number | null; info: number | null; startxref: number };

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const num = (v: PdfValor | undefined) => (ehRef(v) ? v.num : null);
const valorDe = (e: Estado, v: PdfValor | undefined): PdfValor | undefined => (ehRef(v) ? e.objetos.get(v.num)?.valor : v);

function estadoInicial(base: Buffer): Estado {
  // o base pode já ter uma revisão nossa (o campo pré-criado, CAMPO_PRE_CRIADO): a 1ª revisão é a do react-pdf
  const eol = (i: number) => (base[i] === 0x0d && base[i + 1] === 0x0a ? 2 : base[i] === 0x0a || base[i] === 0x0d ? 1 : 0);
  const primeiro = base.indexOf('%%EOF', 0, 'latin1');
  const fim1 = primeiro + 5 + eol(primeiro + 5);
  const b = lerBase(base.subarray(0, fim1));
  const e: Estado = { objetos: new Map(b.objetos), tamanho: b.tamanho, raiz: num(pegar(b.trailer, 'Root'))!, paginas: new Set(), acroform: null, info: num(pegar(b.trailer, 'Info')), startxref: b.startxref };
  if (fim1 < base.length) for (const r of lerAtualizacao(base, fim1)) aplicar(e, r);
  recalcular(e);
  return e;
}

function aplicar(e: Estado, r: Revisao): void {
  for (const [n, o] of r.objetos) e.objetos.set(n, o);
  const size = pegar(r.trailer, 'Size');
  if (typeof size === 'number') e.tamanho = Math.max(e.tamanho, size);
  e.startxref = r.xrefOffset;
  const info = num(pegar(r.trailer, 'Info'));
  if (info !== null) e.info = info;
}

function recalcular(e: Estado): void {
  const cat = dictDe(e.objetos.get(e.raiz)?.valor);
  if (!cat) throw alterado('sem_catalogo');
  e.acroform = num(pegar(cat, 'AcroForm'));
  e.paginas = new Set();
  const visitar = (ref: PdfValor | undefined, prof: number) => {
    if (prof > 32 || !ehRef(ref)) return;
    const d = dictDe(e.objetos.get(ref.num)?.valor);
    if (!d) return;
    if (nomeDe(pegar(d, 'Type')) === 'Page') e.paginas.add(ref.num);
    const kids = pegar(d, 'Kids');
    if (Array.isArray(kids)) for (const k of kids) visitar(k, prof + 1);
  };
  visitar(pegar(cat, 'Pages'), 0);
}

/** Chaves que mudaram entre dois dicionários. */
function chavesMudadas(a: PdfDict, b: PdfDict): string[] {
  const ks = new Set([...a.d.keys(), ...b.d.keys()]);
  return [...ks].filter((k) => !iguais(a.d.get(k), b.d.get(k)));
}

function semProibidas(v: PdfValor): void {
  percorrer(v, (_x, chave) => {
    if (chave && PROIBIDAS.has(chave)) throw alterado('acao_ou_anexo');
  });
  percorrer(v, (x) => {
    const n = nomeDe(x);
    if (n && PROIBIDAS.has(n)) throw alterado('acao_ou_anexo');
  });
}

/** RN-144 (6): área zero ou dentro do quadro, e a aparência dentro do /Rect. */
function conferirWidget(e: Estado, w: PdfDict, area: AreaAssinatura, soAreaZero: boolean): void {
  const r = pegar(w, 'Rect');
  if (!Array.isArray(r) || r.length !== 4 || !r.every((x) => typeof x === 'number')) throw alterado('rect');
  const [x1, y1, x2, y2] = [Math.min(r[0] as number, r[2] as number), Math.min(r[1] as number, r[3] as number), Math.max(r[0] as number, r[2] as number), Math.max(r[1] as number, r[3] as number)];
  const zero = x2 - x1 === 0 || y2 - y1 === 0;
  if (soAreaZero && !zero) throw alterado('carimbo_visivel');
  const t = TOLERANCIA_AREA_PT;
  if (!zero && (x1 < area.x1 - t || y1 < area.y1 - t || x2 > area.x2 + t || y2 > area.y2 + t)) throw new RecusaAssinaturaError('fora_do_quadro', 'rect_fora');
  const ap = dictDe(valorDe(e, pegar(w, 'AP')));
  const n = ap ? valorDe(e, pegar(ap, 'N')) : undefined;
  const bbox = ehStream(n) ? pegar(n.dict, 'BBox') : undefined;
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((x) => typeof x === 'number')) {
    const [b1, b2, b3, b4] = bbox as number[];
    if (Math.abs(b3 - b1) > x2 - x1 + t || Math.abs(b4 - b2) > y2 - y1 + t) throw alterado('bbox');
  }
}

const ehWidgetDeAssinatura = (d: PdfDict) => nomeDe(pegar(d, 'Subtype')) === 'Widget' && (nomeDe(pegar(d, 'FT')) === 'Sig' || pegar(d, 'Parent') !== undefined);

/**
 * RN-144 (5)–(7): o que uma revisão pode trazer. `tipo` = 'assinatura' (a 1ª) ou 'ltv' (a 2ª, opcional).
 * Devolve o número do objeto do dicionário de assinatura (com /ByteRange) desta revisão.
 */
function conferirRevisao(e: Estado, r: Revisao, tipo: 'assinatura' | 'ltv', area: AreaAssinatura): number {
  const anteriores = new Map(e.objetos);
  const tamanhoAntes = e.tamanho;
  const assinaturas: number[] = [];
  const widgetsNovos = new Set<number>();
  for (const [n, o] of r.objetos) {
    const d = dictDe(o.valor);
    if (d && (nomeDe(pegar(d, 'Type')) === 'XRef' || nomeDe(pegar(d, 'Type')) === 'ObjStm')) continue; // contêineres da própria revisão
    semProibidas(o.valor);
    if (n < tamanhoAntes && anteriores.has(n)) {
      redefinido(e, anteriores.get(n)!.valor, o.valor, n, tipo);
      continue;
    }
    if (!d) continue; // número, array ou texto solto (ex.: /Length indireto)
    const t = nomeDe(pegar(d, 'Type'));
    if (pegar(d, 'ByteRange') !== undefined) {
      const sf = nomeDe(pegar(d, 'SubFilter'));
      if (tipo === 'assinatura' && (!sf || !SUBFILTERS.has(sf))) throw new RecusaAssinaturaError(sf?.includes('sha1') ? 'nao_aceito' : 'alterado', 'subfilter');
      if (tipo === 'ltv' && (t !== 'DocTimeStamp' || sf !== 'ETSI.RFC3161')) throw alterado('ltv_assinatura');
      assinaturas.push(n);
      continue;
    }
    // anotação: qualquer dicionário com /Rect, /Type /Annot ou /Subtype de anotação (mesmo sem /Type) — só o widget da assinatura
    const sub = nomeDe(pegar(d, 'Subtype'));
    if (pegar(d, 'Rect') !== undefined || t === 'Annot' || (sub !== null && SUBTIPOS_DE_ANOTACAO.has(sub))) {
      if (!ehWidgetDeAssinatura(d)) throw alterado('anotacao');
      widgetsNovos.add(n);
      continue;
    }
    if (nomeDe(pegar(d, 'FT')) === 'Sig' || pegar(d, 'Fields') !== undefined) continue; // campo (com /Kids) ou o /AcroForm novo
    if (tipo === 'ltv' && (t === 'DSS' || t === 'VRI' || pegar(d, 'Certs') !== undefined || pegar(d, 'VRI') !== undefined)) continue;
    if (t === 'Page' || t === 'Pages' || t === 'Catalog' || t === 'Action' || t === 'Filespec' || t === 'EmbeddedFile') throw alterado(t === 'Page' ? 'pagina_nova' : 'objeto_proibido');
    if (t && !TIPOS_DE_APARENCIA.has(t)) throw alterado('tipo_desconhecido');
  }
  aplicar(e, r);
  if (!assinaturas.length) throw tipo === 'assinatura' ? new RecusaAssinaturaError('sem_assinatura', 'sem_byterange') : alterado('ltv_sem_carimbo');
  if (assinaturas.length > 1) throw alterado('duas_assinaturas');
  for (const w of widgetsNovos) conferirWidget(e, dictDe(e.objetos.get(w)!.valor)!, area, tipo === 'ltv');
  // toda referência nova em /Annots aponta para um widget novo desta revisão
  for (const p of e.paginas) {
    const antes = dictDe(anteriores.get(p)?.valor);
    const agora = dictDe(e.objetos.get(p)?.valor);
    const a0 = (antes && (pegar(antes, 'Annots') as PdfValor[] | undefined)) ?? [];
    const a1 = (agora && (pegar(agora, 'Annots') as PdfValor[] | undefined)) ?? [];
    for (const x of a1.slice(a0.length)) if (!ehRef(x) || !widgetsNovos.has(x.num)) throw alterado('annots');
  }
  return assinaturas[0];
}

/** RN-144 (5): o que um objeto do base redefinido pode mudar, chave a chave. */
function redefinido(e: Estado, antes: PdfValor, depois: PdfValor, n: number, tipo: 'assinatura' | 'ltv'): void {
  const a = dictDe(antes), b = dictDe(depois);
  if (!a || !b || ehStream(antes) !== ehStream(depois)) throw alterado('objeto_redefinido');
  if (ehStream(antes) && ehStream(depois) && !antes.dados.equals(depois.dados)) throw alterado('objeto_redefinido');
  const mud = chavesMudadas(a, b);
  const so = (permitidas: string[]) => {
    if (!mud.every((k) => permitidas.includes(k))) throw alterado('objeto_redefinido');
  };
  if (n === e.raiz) return so(tipo === 'ltv' ? ['DSS', 'Extensions'] : ['AcroForm', 'Perms', 'Version', 'Extensions', 'Metadata']);
  if (n === e.info) return so(['ModDate', 'Producer', 'Creator']);
  if (e.paginas.has(n)) {
    so(['Annots']);
    const a0 = (pegar(a, 'Annots') as PdfValor[] | undefined) ?? [];
    const a1 = (pegar(b, 'Annots') as PdfValor[] | undefined) ?? [];
    if (!Array.isArray(a1) || a1.length < a0.length || !a0.every((x, i) => iguais(x, a1[i]))) throw alterado('annots');
    return;
  }
  if (n === e.acroform) {
    so(['Fields', 'SigFlags', 'DR']);
    const f0 = (pegar(a, 'Fields') as PdfValor[] | undefined) ?? [];
    const f1 = (pegar(b, 'Fields') as PdfValor[] | undefined) ?? [];
    if (!Array.isArray(f1) || !f0.every((x, i) => iguais(x, f1[i]))) throw alterado('fields');
    const dr0 = dictDe(pegar(a, 'DR')), dr1 = dictDe(pegar(b, 'DR'));
    if (dr0 && (!dr1 || [...dr0.d].some(([k, v]) => !iguais(v, dr1.d.get(k))))) throw alterado('dr');
    return;
  }
  // campo pré-criado (CAMPO_PRE_CRIADO): só a assinatura e a aparência entram
  if (ehWidgetDeAssinatura(a) && pegar(a, 'Lock') !== undefined) return so(['V', 'AP', 'MK', 'F']);
  throw alterado('objeto_redefinido');
}

/** RN-144 (4): /ByteRange [0 a b c], buraco = o /Contents DESTE dicionário, b + c = fim da revisão. */
function conferirByteRange(arquivo: Buffer, o: ObjetoLido, fimDaRevisao: number): AssinaturaDaAtualizacao {
  const d = dictDe(o.valor)!;
  if (o.offset === null) throw alterado('assinatura_em_objstm');
  const br = pegar(d, 'ByteRange');
  if (!Array.isArray(br) || br.length !== 4 || !br.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0)) throw alterado('byterange_forma');
  const [z, a, b, c] = br as number[];
  if (z !== 0 || a <= 0 || b <= a + 1 || b + c !== fimDaRevisao) throw alterado('byterange_cobertura');
  const fimObj = arquivo.indexOf('endobj', o.offset, 'latin1');
  if (a < o.offset || fimObj < 0 || b > fimObj) throw alterado('byterange_fora_do_objeto');
  if (arquivo[a] !== 0x3c || arquivo[b - 1] !== 0x3e) throw alterado('byterange_buraco');
  const hex = arquivo.toString('latin1', a + 1, b - 1);
  if (!/^[0-9A-Fa-f]*$/.test(hex) || hex.length > 131_072) throw alterado('byterange_buraco');
  const contents = pegar(d, 'Contents');
  const bytes = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  if (!contents || !('s' in (contents as object)) || !(contents as { s: Buffer }).s.equals(bytes)) throw alterado('byterange_contents');
  return { contents: bytes, byteRange: [0, a, b, c], subFilter: nomeDe(pegar(d, 'SubFilter')) ?? '' };
}

/**
 * RN-144 (2)–(7). O prefixo é conferido pelo SHA-256 do base (nunca regenerado); o resto pelo leitor limitado.
 * Qualquer PdfIlegivelError → "alterado" (nunca 500).
 */
export function conferirAtualizacao(arquivo: Buffer, base: BaseDoDocumento): AssinaturaDaAtualizacao {
  if (arquivo.length <= base.bytes || sha256(arquivo.subarray(0, base.bytes)) !== base.sha256) throw new RecusaAssinaturaError('nao_e_o_preparado', 'prefixo');
  try {
    const e = estadoInicial(arquivo.subarray(0, base.bytes));
    const revs = lerAtualizacao(arquivo, base.bytes);
    if (pegar(revs[0].trailer, 'Prev') !== e.startxref) throw alterado('prev');
    if (num(pegar(revs[0].trailer, 'Root')) !== e.raiz) throw alterado('root');
    const nSig = conferirRevisao(e, revs[0], 'assinatura', base.area);
    recalcular(e);
    const sig = conferirByteRange(arquivo, revs[0].objetos.get(nSig)!, revs[0].fim);
    if (revs[1]) {
      if (pegar(revs[1].trailer, 'Prev') !== revs[0].xrefOffset) throw alterado('prev_ltv');
      const nTs = conferirRevisao(e, revs[1], 'ltv', base.area);
      conferirByteRange(arquivo, revs[1].objetos.get(nTs)!, revs[1].fim);
    }
    return sig;
  } catch (err) {
    if (err instanceof RecusaAssinaturaError) throw err;
    if (err instanceof PdfIlegivelError) throw err.motivo === 'sem_atualizacao' ? new RecusaAssinaturaError('sem_assinatura', 'sem_atualizacao') : alterado(`ilegivel_${err.motivo}`);
    throw alterado('erro_do_leitor');
  }
}
```

- [ ] **Step 3: CMS** — `src/modules/documentos/cms.ts`

```ts
import { constants, createHash, verify, X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { RecusaAssinaturaError } from './erros';

/**
 * RN-144 (8): pkijs/asn1js só LEEM o ASN.1; toda verificação é do node:crypto (o WebCrypto do Node não tem brainpool,
 * usado pelas raízes ICP v4 e v13). Nada aqui vai à rede.
 */
const OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4',
  signingCertV2: '1.2.840.113549.1.9.16.2.47', sha1: '1.3.14.3.2.26', rsaPss: '1.2.840.113549.1.1.10',
} as const;
type Hash = 'sha256' | 'sha384' | 'sha512';
const DIGESTS: Record<string, Hash> = { '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512' };
/** Algoritmo da assinatura → hash do node:crypto ('digest' = o do digestAlgorithm; null = EdDSA, sem hash). */
const ASSINATURAS: Record<string, Hash | 'digest' | null> = {
  '1.2.840.113549.1.1.1': 'digest', '1.2.840.113549.1.1.11': 'sha256', '1.2.840.113549.1.1.12': 'sha384', '1.2.840.113549.1.1.13': 'sha512',
  [OID.rsaPss]: 'digest', '1.2.840.10045.2.1': 'digest', '1.2.840.10045.4.3.2': 'sha256', '1.2.840.10045.4.3.3': 'sha384', '1.2.840.10045.4.3.4': 'sha512',
  '1.3.101.112': null, '1.3.101.113': null,
};

export type CmsLido = {
  titular: X509Certificate; certificados: X509Certificate[]; digest: Hash; messageDigest: Buffer; signedAttrs: Buffer; assinatura: Buffer;
  hashDaAssinatura: Hash | null; pss: { saltLength: number } | null; certHashV2: Buffer | null;
};

const naoAceito = (m: string) => new RecusaAssinaturaError('nao_aceito', m);
const naoConfere = (m: string) => new RecusaAssinaturaError('nao_confere', m);
const der = (c: pkijs.Certificate) => Buffer.from(c.toSchema().toBER(false));

export function lerCms(contents: Buffer): CmsLido {
  const asn = asn1js.fromBER(contents);
  if (asn.offset === -1) throw naoConfere('cms_ilegivel');
  if (contents.subarray(asn.offset).some((b) => b !== 0)) throw naoConfere('cms_lixo'); // depois do CMS, só o preenchimento com zeros
  let sd: pkijs.SignedData;
  try {
    const ci = new pkijs.ContentInfo({ schema: asn.result });
    if (ci.contentType !== OID.signedData) throw naoConfere('cms_tipo');
    sd = new pkijs.SignedData({ schema: ci.content });
  } catch (e) {
    if (e instanceof RecusaAssinaturaError) throw e;
    throw naoConfere('cms_ilegivel');
  }
  if (sd.signerInfos.length !== 1) throw naoAceito('cms_assinantes');
  if (sd.encapContentInfo.eContent || sd.encapContentInfo.eContentType !== OID.data) throw naoAceito('cms_nao_destacado');
  const si = sd.signerInfos[0];
  const digestOid = si.digestAlgorithm.algorithmId;
  if (digestOid === OID.sha1) throw naoAceito('sha1');
  const digest = DIGESTS[digestOid];
  if (!digest) throw naoAceito('digest_desconhecido');
  const sigOid = si.signatureAlgorithm.algorithmId;
  if (!(sigOid in ASSINATURAS)) throw naoAceito('assinatura_desconhecida');
  if (!si.signedAttrs) throw naoAceito('sem_atributos');
  const attrs = si.signedAttrs.attributes;
  const ct = attrs.find((a) => a.type === OID.contentType)?.values[0] as asn1js.ObjectIdentifier | undefined;
  if (ct?.valueBlock.toString() !== OID.data) throw naoConfere('content_type');
  const md = attrs.find((a) => a.type === OID.messageDigest)?.values[0] as asn1js.OctetString | undefined;
  if (!md) throw naoConfere('sem_message_digest');
  const scv2 = attrs.find((a) => a.type === OID.signingCertV2)?.values[0] as asn1js.Sequence | undefined;
  let certHashV2: Buffer | null = null;
  if (scv2) {
    const certs = scv2.valueBlock.value[0] as asn1js.Sequence;
    const id = certs?.valueBlock.value[0] as asn1js.Sequence | undefined;
    const primeiro = id?.valueBlock.value[0];
    const hashOct = primeiro instanceof asn1js.OctetString ? primeiro : (id?.valueBlock.value[1] as asn1js.OctetString | undefined);
    if (hashOct) certHashV2 = Buffer.from(hashOct.valueBlock.valueHexView);
  }
  const pkCerts = (sd.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
  const sid = si.sid;
  const titularPk = pkCerts.find((c) =>
    sid instanceof pkijs.IssuerAndSerialNumber
      ? c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber)
      : (() => {
          const ski = c.extensions?.find((x) => x.extnID === '2.5.29.14');
          const v = ski && (asn1js.fromBER(ski.extnValue.valueBlock.valueHexView).result as asn1js.OctetString);
          return !!v && Buffer.from(v.valueBlock.valueHexView).equals(Buffer.from((sid as asn1js.OctetString).valueBlock.valueHexView));
        })(),
  );
  if (!titularPk) throw naoAceito('sem_certificado_do_titular');
  const signedAttrs = Buffer.from(si.signedAttrs.toSchema().toBER(false));
  signedAttrs[0] = 0x31; // [0] IMPLICIT → SET (a assinatura é sobre o SET)
  const regra = ASSINATURAS[sigOid];
  let pss: { saltLength: number } | null = null;
  let hashDaAssinatura: Hash | null = regra === 'digest' ? digest : regra;
  if (sigOid === OID.rsaPss) {
    const p = new pkijs.RSASSAPSSParams({ schema: si.signatureAlgorithm.algorithmParams });
    hashDaAssinatura = DIGESTS[p.hashAlgorithm.algorithmId] ?? 'sha256';
    pss = { saltLength: p.saltLength };
  }
  return {
    titular: new X509Certificate(der(titularPk)), certificados: pkCerts.map((c) => new X509Certificate(der(c))), digest, messageDigest: Buffer.from(md.valueBlock.valueHexView),
    signedAttrs, assinatura: Buffer.from(si.signature.valueBlock.valueHexView), hashDaAssinatura, pss, certHashV2,
  };
}

/** RN-144 (8): messageDigest = hash dos bytes cobertos; signingCertificateV2 confere (CAdES); assinatura sobre os signedAttrs. */
export function conferirCms(c: CmsLido, cobertos: Buffer, o: { cades: boolean }): void {
  if (!createHash(c.digest).update(cobertos).digest().equals(c.messageDigest)) throw naoConfere('message_digest');
  if (o.cades && (!c.certHashV2 || !createHash('sha256').update(c.titular.raw).digest().equals(c.certHashV2))) throw naoConfere('signing_certificate_v2');
  const chave = c.pss ? { key: c.titular.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: c.pss.saltLength } : c.titular.publicKey;
  let ok = false;
  try {
    ok = verify(c.hashDaAssinatura, c.signedAttrs, chave, c.assinatura);
  } catch {
    throw naoAceito('algoritmo_nao_suportado');
  }
  if (!ok) throw naoConfere('assinatura');
}
```

- [ ] **Step 4: Cadeia e titular** — `src/modules/documentos/certificados.ts`

```ts
import { X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { Ancoras } from './ancoras';
import { RecusaAssinaturaError } from './erros';

const naoAceito = (m: string) => new RecusaAssinaturaError('nao_aceito', m);
const OID_CN = '2.5.4.3', OID_SERIAL = '2.5.4.5', OID_PF = '2.16.76.1.3.1', OID_CNPJ = '2.16.76.1.3.3', OID_RESP_PJ = '2.16.76.1.3.4';

const assinou = (filho: X509Certificate, pai: X509Certificate) => {
  try {
    return filho.checkIssued(pai) && filho.verify(pai.publicKey);
  } catch {
    return false; // algoritmo que o OpenSSL não lê (raiz v7) ou certificado malformado
  }
};
const valido = (c: X509Certificate, agora: Date) => new Date(c.validFrom) <= agora && agora <= new Date(c.validTo);

/**
 * RN-144 (9): o emissor é procurado nos certificados do CMS (não confiáveis por si) e nas ACs fixadas, até uma RAIZ fixada,
 * no máximo 5 níveis, com CA = true nas ACs e a validade de TODOS na hora do envio. O conjunto (icp/govbr) vem da âncora.
 */
export function cadeiaAte(titular: X509Certificate, extras: X509Certificate[], a: Ancoras, agora: Date): { conjunto: 'icp' | 'govbr'; emissor: string } {
  const raizesIcp = new Set(a.raizesIcp.map((r) => r.fingerprint256));
  const candidatos = [...extras, ...a.acsIcp, ...a.raizesIcp, a.govbr.final, a.govbr.intermediaria, a.govbr.raiz];
  const cadeia = [titular];
  let atual = titular;
  for (let nivel = 0; nivel < 6; nivel++) {
    const fp = atual.fingerprint256;
    if (raizesIcp.has(fp) || fp === a.govbr.raiz.fingerprint256) {
      if (!cadeia.every((c) => valido(c, agora))) throw new RecusaAssinaturaError('vencido', 'validade');
      const conjunto = raizesIcp.has(fp) ? 'icp' : 'govbr';
      if (conjunto === 'govbr' && !assinou(titular, a.govbr.final)) throw naoAceito('govbr_fora_da_ac_final');
      return { conjunto, emissor: titular.issuer.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? 'desconhecido' };
    }
    const pai = candidatos.find((c) => c.ca && c.fingerprint256 !== fp && assinou(atual, c));
    if (!pai) throw naoAceito('cadeia');
    cadeia.push(pai);
    atual = pai;
  }
  throw naoAceito('cadeia_longa');
}

export const normalizarNome = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

function otherNames(c: pkijs.Certificate): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const san = c.extensions?.find((e) => e.extnID === '2.5.29.17');
  if (!san) return out;
  const seq = asn1js.fromBER(san.extnValue.valueBlock.valueHexView).result as asn1js.Sequence;
  for (const g of seq.valueBlock.value ?? []) {
    if (g.idBlock.tagClass !== 3 || g.idBlock.tagNumber !== 0) continue;
    const [oid, valor] = (g as asn1js.Constructed).valueBlock.value;
    const interno = (valor as asn1js.Constructed)?.valueBlock?.value?.[0] as asn1js.BaseBlock | undefined;
    const bytes = interno && 'valueBlock' in interno && 'valueHexView' in (interno.valueBlock as object) ? Buffer.from((interno.valueBlock as { valueHexView: Uint8Array }).valueHexView) : Buffer.alloc(0);
    out.set((oid as asn1js.ObjectIdentifier).valueBlock.toString(), bytes);
  }
  return out;
}

/**
 * RN-144 (10) / RN-145: uso da chave de assinatura; e-CNPJ e responsável por PJ recusados; na ICP, o CPF do campo
 * 2.16.76.1.3.1 (nascimento ddmmaaaa + CPF), nunca de uma busca solta por 11 dígitos; no gov.br, o campo que o spike
 * confirmar (SAN 2.16.76.1.3.1 ou o atributo serialNumber do sujeito) — sem CPF, `cpf: null` (D8 ★).
 */
export function titularDoCertificado(cert: X509Certificate, conjunto: 'icp' | 'govbr'): { nome: string; cpf: string | null } {
  const c = pkijs.Certificate.fromBER(cert.raw);
  const ku = c.extensions?.find((e) => e.extnID === '2.5.29.15');
  const bits = ku ? new Uint8Array((asn1js.fromBER(ku.extnValue.valueBlock.valueHexView).result as asn1js.BitString).valueBlock.valueHexView) : new Uint8Array();
  if (!((bits[0] ?? 0) & 0xc0)) throw naoAceito('key_usage');
  const nomes = otherNames(c);
  if (nomes.has(OID_CNPJ) || nomes.has(OID_RESP_PJ)) throw new RecusaAssinaturaError('empresa', 'ecnpj');
  const pf = nomes.get(OID_PF);
  let cpf: string | null = pf ? pf.toString('latin1').slice(8, 19) : null;
  if (!cpf && conjunto === 'govbr') {
    const serial = c.subject.typesAndValues.find((t) => t.type === OID_SERIAL)?.value.valueBlock.value;
    cpf = typeof serial === 'string' && /^\d{11}$/.test(serial) ? serial : null;
  }
  if (conjunto === 'icp' && !pf) throw naoAceito('sem_dados_de_pessoa_fisica');
  if (cpf && !cpfValido(cpf)) throw naoAceito('cpf_invalido');
  const cn = String(c.subject.typesAndValues.find((t) => t.type === OID_CN)?.value.valueBlock.value ?? '');
  return { nome: cn.replace(/:\d{11}$/, '').trim(), cpf };
}
```

- [ ] **Step 5: A conferência inteira** — `src/modules/documentos/assinatura-pades.ts` (+ `MAX_ENVIO_BYTES = 10 * 1024 * 1024` e `LIMITE_CONFERENCIA_MS = 3000` em `constantes.ts`)

```ts
import { createHash } from 'node:crypto';
import { carregarAncoras, type Ancoras } from './ancoras';
import { cadeiaAte, titularDoCertificado } from './certificados';
import { conferirCms, lerCms } from './cms';
import { LIMITE_CONFERENCIA_MS, MAX_ENVIO_BYTES } from './constantes';
import { RecusaAssinaturaError } from './erros';
import { conferirAtualizacao, type BaseDoDocumento } from './pdf-atualizacao';

export type { BaseDoDocumento };
export type Conferido = { tipo: 'govbr' | 'icp'; emissor: string; titularNome: string; cpf: string | null; sha256: string };

/**
 * RN-144 inteira, síncrona e SEM REDE (sem-rede.test.ts): prefixo → atualização (forma do /ByteRange, lista fechada,
 * quadro) → CMS → cadeia e validade → titular. "Assinado em" NÃO sai daqui (é a hora do servidor no aceite, T10).
 * Só lança RecusaAssinaturaError (código fixo); o motivoTecnico vai ao log, nunca o CN ou o CPF.
 */
export function conferirPdfAssinado(arquivo: Buffer, base: BaseDoDocumento, deps: { ancoras?: Ancoras; agora?: Date; limiteMs?: number } = {}): Conferido {
  const t0 = performance.now();
  if (arquivo.length > MAX_ENVIO_BYTES || !arquivo.subarray(0, 1024).includes('%PDF-')) throw new RecusaAssinaturaError('arquivo', 'tipo_ou_tamanho');
  const sig = conferirAtualizacao(arquivo, base);
  const [, a, b, c] = sig.byteRange;
  const cobertos = Buffer.concat([arquivo.subarray(0, a), arquivo.subarray(b, b + c)]);
  const cms = lerCms(sig.contents);
  conferirCms(cms, cobertos, { cades: sig.subFilter === 'ETSI.CAdES.detached' });
  const { conjunto, emissor } = cadeiaAte(cms.titular, cms.certificados, deps.ancoras ?? carregarAncoras(), deps.agora ?? new Date());
  const titular = titularDoCertificado(cms.titular, conjunto);
  if (performance.now() - t0 > (deps.limiteMs ?? LIMITE_CONFERENCIA_MS)) throw new RecusaAssinaturaError('nao_aceito', 'tempo');
  return { tipo: conjunto, emissor, titularNome: titular.nome, cpf: titular.cpf, sha256: createHash('sha256').update(arquivo).digest('hex') };
}
```

- [ ] **Step 6: Guarda "sem rede"** — `src/modules/documentos/sem-rede.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ARQUIVOS = ['pdf-leitor.ts', 'pdf-atualizacao.ts', 'cms.ts', 'certificados.ts', 'assinatura-pades.ts', 'ancoras.ts'].map((f) => `src/modules/documentos/${f}`);

describe('a conferência não vai à rede (RN-144)', () => {
  afterEach(() => vi.restoreAllMocks());
  it('nenhum arquivo da conferência importa http, https, net, dns ou usa fetch', () => {
    for (const f of ARQUIVOS) expect(readFileSync(f, 'utf8'), f).not.toMatch(/node:(http|https|net|dns|tls)|from '(http|https|net|dns|tls)'|\bfetch\(/);
  });
  it('com o fetch quebrado, uma conferência válida passa (pkijs não busca caIssuers nem OCSP)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sem rede no teste'));
    const { conferirComFabrica } = await import('./sem-rede.fixture');
    await conferirComFabrica();
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

`src/modules/documentos/sem-rede.fixture.ts`:

```ts
import { createHash } from 'node:crypto';
import { baseMinimo } from '../../../test/assinatura/base-minimo';
import { assinarDeTeste, criarAc, criarTitular } from '../../../test/assinatura/fabrica';
import { conferirPdfAssinado } from './assinatura-pades';
import { AREA_ASSINATURA } from './constantes';

/** Uma conferência completa e válida (AC de teste, assinatura invisível), para a guarda "sem rede". */
export async function conferirComFabrica(): Promise<void> {
  const ac = await criarAc();
  const t = await criarTitular(ac, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
  const base = baseMinimo();
  const pdf = await assinarDeTeste(base, t);
  conferirPdfAssinado(pdf, { bytes: base.length, sha256: createHash('sha256').update(base).digest('hex'), area: AREA_ASSINATURA }, {
    ancoras: { raizesIcp: [ac.raiz], acsIcp: [ac.intermediaria], govbr: { raiz: ac.raiz, intermediaria: ac.intermediaria, final: ac.intermediaria } },
  });
}
```

- [ ] **Step 7: Rodar**

Run: `pnpm test src/modules/documentos/assinatura-pades.test.ts src/modules/documentos/sem-rede.test.ts` → PASS. Com os arquivos reais na máquina (`test/assinatura/reais/`), rodar também o teste local:

```ts
// em assinatura-pades.test.ts
const REAIS = 'test/assinatura/reais';
it.skipIf(!existsSync(`${REAIS}/govbr-a.pdf`))('arquivos reais do spike: o do gov.br e os dos programas ICP passam com as âncoras do repositório', () => {
  const base = readFileSync(`${REAIS}/base.pdf`);
  const b = { bytes: base.length, sha256: createHash('sha256').update(base).digest('hex'), area: AREA_ASSINATURA };
  for (const f of readdirSync(REAIS).filter((x) => x !== 'base.pdf' && x !== 'base-com-campo.pdf' && x.endsWith('.pdf') && !x.includes('campo'))) {
    expect(() => conferirPdfAssinado(readFileSync(`${REAIS}/${f}`), b), f).not.toThrow();
  }
});
```

**Critério de aceite (P-B2):** o gov.br só é aceito depois que o arquivo real dele passar aqui, e a opção C depois de pelo menos um arquivo real de programa ICP. Até lá, o envio responde "Tipo de assinatura não aceito" para o conjunto que falta — bandeira em `constantes.ts`, conferida na T10 e ligada no commit que traz o resultado do spike:

```ts
/** P-B2: cada conjunto só é aceito depois de um PDF REAL dele passar na conferência (Tarefa 9, Step 7). */
export const ASSINATURAS_LIBERADAS: Record<'govbr' | 'icp', boolean> = { govbr: false, icp: false };
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/documentos/{pdf-atualizacao,cms,certificados,assinatura-pades,assinatura-pades.test,sem-rede.test,sem-rede.fixture,constantes}.ts
git commit -m "feat(documentos): conferência do PDF assinado sem rede — /ByteRange estrito, lista fechada por alcance, CMS, cadeia e titular (RN-144)"
```

---
### Task 10: Enviar o PDF assinado — primeiro certificado com 2FA, CPF do consultório, assinatura no banco e verificação pública (US-144, RN-140 b, RN-145, RN-156 parte de escrita; P10-10)

**Files:**
- Create: `src/modules/documentos/assinar.ts` (+ `assinar.test.ts`), `src/modules/documentos/verificacao.ts` (+ `verificacao.test.ts`), `src/app/api/painel/documentos/[id]/assinado/route.ts` (+ `route.test.ts`), `src/app/painel/pacientes/[id]/documentos/[docId]/enviar-assinado.tsx`
- Modify: `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx` (o envio no cartão "Aguardando assinatura"), `src/email/types.ts` + `src/email/templates.tsx` (`certificado_confirmado`), `test/documentos.ts` (`novoConsultorio`, `outroDocumento`)

**Interfaces:**
- Consumes: `conferirPdfAssinado`, `BaseDoDocumento`, `normalizarNome` (T9); `ASSINATURAS_LIBERADAS`, `MAX_ENVIO_BYTES` (constantes); `confirmarCodigo2fa` (T5); `lerAssinante`, `gravarAssinante`, `hmacDoCpf`, `mascararCpf` (T4); `salvarArquivo`, `apagarArquivo`; `recordAudit`; `enqueueEmail`; `mesmaOrigem`, `requireApiNutri`, `lerCorpoLimitado`.
- Produces:
  - `verificacao.ts` (ÚNICO acesso a `document_verifications`): `registrarVerificacao(tx, v: NovaVerificacao)`, `mudarSituacao(tx, documentoId: string, situacao: SituacaoVerificacao, em: Date)`; a T15 acrescenta a leitura pública.
  - `assinar.ts`: `aceitarPdfAssinado(a: AcessoAssinatura, docId: string, arquivo: Buffer, input: { codigo2fa?: unknown }, deps: DepsAssinar): Promise<ResultadoEnvio>`; `ResultadoEnvio = { tipo: 'assinado' } | { tipo: 'confirmar_certificado'; nome: string; cpfMascarado: string }`; `AcessoAssinatura = { ctx: TenantContext; tenant: TenantRow; user: { id: string; email: string; twoFactorEnabled: boolean | null } }`; `DepsAssinar = { headers: Headers; db?; dataDir?; agora?; ancoras?; liberadas?; confirmar2fa? }`; `registrarAssinatura(tx, e: AssinaturaAceita)` (o pedaço do `registrar` que a digitalizada reusa, T11) com `AssinaturaAceita = { documentoId; codigo; patientId; tenantId; caminho; sha256; tipo: TipoAssinatura; emissor: string | null; assinanteNome: string | null; userId: string; agora: Date; copia: CopiaProfissional; base: string | null }`.
  - E-mail `{ tipo: 'certificado_confirmado'; para: string; mascara: string }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/assinar.test.ts`

```ts
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { baseMinimo } from '../../../test/assinatura/base-minimo';
import { assinarDeTeste, criarAc, criarTitular, type AcDeTeste, type TitularDeTeste } from '../../../test/assinatura/fabrica';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import type { Ancoras } from './ancoras';
import { aceitarPdfAssinado } from './assinar';
import { AREA_ASSINATURA } from './constantes';
import { RecusaAssinaturaError, type CodigoRecusa } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

let ac: AcDeTeste;
let debby: TitularDeTeste, outra: TitularDeTeste;
let ancoras: Ancoras;
const BASE = baseMinimo();
beforeAll(async () => {
  ac = await criarAc();
  ancoras = { raizesIcp: [ac.raiz], acsIcp: [ac.intermediaria], govbr: { raiz: ac.raiz, intermediaria: ac.intermediaria, final: ac.intermediaria } };
  debby = await criarTitular(ac, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
  outra = await criarTitular(ac, { nome: 'OUTRA PESSOA', cpf: '98765432100' });
}, 60_000);

// ---- em test/documentos.ts (exportados; usados também nas Tarefas 11–17). Imports a mais lá: node:crypto, node:fs/promises, node:os, node:path, drizzle-orm (eq), @/db/schema (tenants, TenantRow), ./pacientes (novoPaciente, novoTenant), ./assinatura/base-minimo, @/modules/documentos/constantes (AREA_ASSINATURA)
const BASE_DOC = baseMinimo();
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

/** Um documento em "Aguardando assinatura" com o base no disco (como depois da T8), num paciente novo do consultório. */
export async function outroDocumento(c: Consultorio, db: Db) {
  const p = await novoPaciente(db, c.T.ctx);
  const base = `${c.T.tenantId}/documento_base/${randomUUID()}.pdf`;
  await mkdir(path.join(c.dataDir, path.dirname(base)), { recursive: true });
  await writeFile(path.join(c.dataDir, base), BASE_DOC);
  const id = randomUUID();
  const conteudo = { versao: 1, tipo: 'receita', itens: [], orientacoes: '', copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana Souza' } } };
  const codigo = Array.from({ length: 12 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('');
  await withTenant(c.T.ctx, async (tx) => {
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${c.T.tenantId}, 'documento_base', ${base}, ${BASE_DOC.length}, 'application/pdf', ${p.id})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em) values (${id}, ${c.T.tenantId}, ${p.id}, 'preparando', ${codigo}, ${JSON.stringify(conteudo)}::jsonb, now())`);
  }, db);
  await withTenant({ tenantId: c.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${createHash('sha256').update(BASE_DOC).digest('hex')}, base_pdf_bytes = ${BASE_DOC.length}, area_assinatura = ${JSON.stringify(AREA_ASSINATURA)}::jsonb where id = ${id}`), db);
  return { ...c, p, id, base };
}
// ---- fim de test/documentos.ts
const aguardando = async () => outroDocumento(await novoConsultorio(app.db), app.db);
const deps = (dataDir: string, codigo: 'ok' | 'invalido' | 'bloqueado' = 'ok') => ({
  db: app.db, dataDir, ancoras, headers: new Headers(), liberadas: { govbr: true, icp: true }, confirmar2fa: async () => codigo,
});
const recusa = (c: CodigoRecusa) => (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === c;

describe('enviar o PDF assinado (US-144, RN-145)', () => {
  it('sem 2FA ativo → recusa antes de qualquer conferência', async () => {
    const x = await aguardando();
    await expect(aceitarPdfAssinado({ ...x.acesso, user: { ...x.acesso.user, twoFactorEnabled: false } }, x.id, await assinarDeTeste(BASE, debby), {}, deps(x.dataDir))).rejects.toSatisfy(recusa('sem_2fa'));
  });

  it('primeiro certificado de outra pessoa → recusa com o nome do certificado; nenhum CPF gravado; nada muda', async () => {
    const x = await aguardando();
    await expect(aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, outra), {}, deps(x.dataDir))).rejects.toSatisfy(
      (e) => recusa('outro_titular_primeiro')(e) && (e as RecusaAssinaturaError).mensagem().includes('OUTRA PESSOA'),
    );
    const s = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from tenant_signer`), app.db);
    expect(s.rows).toEqual([]);
  });

  it('primeiro certificado com o nome certo: pede "Sim, sou eu" com a máscara; código errado → recusa e registra a tentativa; código certo → assinado', async () => {
    const x = await aguardando();
    const pdf = await assinarDeTeste(BASE, debby);
    expect(await aceitarPdfAssinado(x.acesso, x.id, pdf, {}, deps(x.dataDir))).toEqual({ tipo: 'confirmar_certificado', nome: 'DEBORA SILVA SANTOS', cpfMascarado: '***.456.789-**' });
    await expect(aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '000000' }, deps(x.dataDir, 'invalido'))).rejects.toSatisfy(recusa('codigo_2fa'));
    const tent = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select acao, entidade from audit_log where entidade = 'tentativa_assinatura'`), app.db);
    expect(tent.rows).toEqual([{ acao: 'criar', entidade: 'tentativa_assinatura' }]);
    await expect(aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '000000' }, deps(x.dataDir, 'bloqueado'))).rejects.toSatisfy(recusa('tentativas_2fa'));
    expect(await aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '123456' }, deps(x.dataDir))).toEqual({ tipo: 'assinado' });
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_sha256, base_pdf_path, assinatura_tipo, assinante_nome, codigo from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, string | null>[];
    expect(d).toMatchObject({ status: 'assinado', pdf_sha256: createHash('sha256').update(pdf).digest('hex'), base_pdf_path: null, assinatura_tipo: 'icp', assinante_nome: 'DEBORA SILVA SANTOS' });
    const v = (await app.db.execute(sql`select situacao, pdf_sha256, emissor_nome, emissor_crn from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v).toEqual({ situacao: 'valido', pdf_sha256: d.pdf_sha256, emissor_nome: 'Débora Silva Santos', emissor_crn: 'CRN-3 12345' });
    const baseSobrou = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${x.base}`), app.db);
    expect(baseSobrou.rows).toEqual([]);
    const s = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select cpf_mascarado from tenant_signer`), app.db);
    expect(s.rows).toEqual([{ cpf_mascarado: '***.456.789-**' }]);
  });

  it('depois do primeiro: o mesmo CPF assina sem código; outro CPF → "O PDF foi assinado por outra pessoa."', async () => {
    const x = await aguardando();
    await aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, debby), { codigo2fa: '123456' }, deps(x.dataDir));
    const y = await outroDocumento(x, app.db);
    expect(await aceitarPdfAssinado(x.acesso, y.id, await assinarDeTeste(BASE, debby), {}, deps(x.dataDir))).toEqual({ tipo: 'assinado' });
    const w = await outroDocumento(x, app.db);
    await expect(aceitarPdfAssinado(x.acesso, w.id, await assinarDeTeste(BASE, outra), {}, deps(x.dataDir))).rejects.toSatisfy(recusa('outra_pessoa'));
  });
});
```

Run: `pnpm test src/modules/documentos/assinar.test.ts` → FAIL.

- [ ] **Step 2: Verificação (escrita) e a guarda de acesso** — `src/modules/documentos/verificacao.ts` e `verificacao.test.ts`

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

- [ ] **Step 3: Aceitar o envio** — `src/modules/documentos/assinar.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients, signedDocuments, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { confirmarCodigo2fa } from '@/lib/confirmar-2fa';
import { logger } from '@/lib/logger';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { apagarArquivo, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import type { Ancoras } from './ancoras';
import { conferirPdfAssinado } from './assinatura-pades';
import { normalizarNome } from './certificados';
import { ASSINATURAS_LIBERADAS, type AreaAssinatura, type TipoAssinatura } from './constantes';
import { DocumentoNaoEncontradoError, RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import { gravarAssinante, hmacDoCpf, lerAssinante, mascararCpf, type CopiaProfissional } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';
import { registrarVerificacao } from './verificacao';

export type AcessoAssinatura = { ctx: TenantContext; tenant: TenantRow; user: { id: string; email: string; twoFactorEnabled: boolean | null } };
export type DepsAssinar = {
  headers: Headers; db?: Db; dataDir?: string; agora?: Date; ancoras?: Ancoras; liberadas?: Record<'govbr' | 'icp', boolean>;
  confirmar2fa?: (e: { userId: string; codigo: unknown; headers: Headers }) => Promise<'ok' | 'invalido' | 'bloqueado'>;
};
export type ResultadoEnvio = { tipo: 'assinado' } | { tipo: 'confirmar_certificado'; nome: string; cpfMascarado: string };
export type AssinaturaAceita = {
  documentoId: string; codigo: string; patientId: string; tenantId: string; caminho: string; sha256: string; tipo: TipoAssinatura;
  emissor: string | null; assinanteNome: string | null; userId: string; agora: Date; copia: CopiaProfissional; base: string | null;
};

/** RN-140 (b): a ida a "assinado" com o base solto NO MESMO UPDATE, a verificação pública e (T12) a entrega — na transação do arquivo. */
export async function registrarAssinatura(tx: Tx, a: AssinaturaAceita): Promise<void> {
  const r = await tx
    .update(signedDocuments)
    .set({
      status: 'assinado', pdfPath: a.caminho, pdfSha256: a.sha256, assinaturaTipo: a.tipo, assinaturaEmissor: a.emissor?.slice(0, 200) ?? null,
      assinanteNome: a.assinanteNome?.slice(0, 200) ?? null, assinadoEm: a.agora, assinadoPor: a.userId, entregueEm: a.agora, basePdfPath: null,
      digitalizacao: null, digitalizacaoStatus: null, updatedAt: a.agora,
    })
    .where(and(eq(signedDocuments.id, a.documentoId), eq(signedDocuments.status, 'aguardando_assinatura')))
    .returning({ id: signedDocuments.id });
  if (!r.length) throw new TransicaoInvalidaError();
  await registrarVerificacao(tx, {
    codigo: a.codigo, tenantId: a.tenantId, documentoId: a.documentoId, tipo: 'receita', assinadoEm: a.agora, emissorNome: a.copia.nomeCompleto,
    emissorCrn: a.copia.crn, assinanteNome: a.tipo === 'digitalizada' ? null : a.assinanteNome, assinaturaTipo: a.tipo, pdfSha256: a.sha256,
  });
}

type Lido = { patientId: string; codigo: string; base: string; sha: string; bytes: number; area: AreaAssinatura; copia: CopiaProfissional; assinante: { cpfHmac: string } | null };

async function lerParaAssinar(ctx: TenantContext, docId: string, db: Db): Promise<Lido> {
  return withTenant(ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'aguardando_assinatura' || !d.basePdfPath || !d.basePdfSha256 || !d.basePdfBytes || !d.areaAssinatura || !d.codigo) throw new TransicaoInvalidaError();
    const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId));
    if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
    const copia = (d.conteudo as ConteudoReceita).copia!.profissional;
    return { patientId: d.patientId, codigo: d.codigo, base: d.basePdfPath, sha: d.basePdfSha256, bytes: d.basePdfBytes, area: d.areaAssinatura, copia, assinante: await lerAssinante(tx) };
  }, db);
}

/**
 * US-144 / RN-145. Ordem: 2FA ativo → conferência (fora de transação, sem rede) → quem assina (CPF do consultório, ou o
 * primeiro certificado com o nome e o código do 2FA) → salvarArquivo do assinado (substitui o base; o registrar faz a
 * transição, a verificação e a entrega) → apagarArquivo do base. Nada é gravado numa recusa.
 */
export async function aceitarPdfAssinado(a: AcessoAssinatura, docId: string, arquivo: Buffer, input: { codigo2fa?: unknown }, deps: DepsAssinar): Promise<ResultadoEnvio> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (!a.user.twoFactorEnabled) throw new RecusaAssinaturaError('sem_2fa');
  const d = await lerParaAssinar(a.ctx, docId, db);
  const c = conferirPdfAssinado(arquivo, { bytes: d.bytes, sha256: d.sha, area: d.area }, { ancoras: deps.ancoras, agora });
  if (!(deps.liberadas ?? ASSINATURAS_LIBERADAS)[c.tipo]) throw new RecusaAssinaturaError('nao_aceito', 'assinador_nao_liberado');
  if (!c.cpf) throw new RecusaAssinaturaError('nao_aceito', 'certificado_sem_cpf'); // D8 ★ (gov.br sem CPF em campo próprio)
  const primeiro = !d.assinante;
  if (d.assinante && hmacDoCpf(c.cpf) !== d.assinante.cpfHmac) throw new RecusaAssinaturaError('outra_pessoa', 'cpf_diferente');
  if (primeiro) {
    if (normalizarNome(c.titularNome) !== normalizarNome(d.copia.nomeCompleto)) throw new RecusaAssinaturaError('outro_titular_primeiro', 'nome_diferente', c.titularNome);
    if (input.codigo2fa === undefined || input.codigo2fa === null || input.codigo2fa === '') return { tipo: 'confirmar_certificado', nome: c.titularNome, cpfMascarado: mascararCpf(c.cpf) };
    const r = await (deps.confirmar2fa ?? ((e) => confirmarCodigo2fa(e, { db })))({ userId: a.user.id, codigo: input.codigo2fa, headers: deps.headers });
    if (r === 'bloqueado') throw new RecusaAssinaturaError('tentativas_2fa');
    if (r === 'invalido') {
      await withTenant(a.ctx, (tx) => recordAudit(tx, { acao: 'criar', entidade: 'tentativa_assinatura', entidadeId: docId, patientId: d.patientId }), db);
      logger.warn({ tenantId: a.ctx.tenantId, documentoId: docId }, 'código do 2FA recusado ao assinar');
      throw new RecusaAssinaturaError('codigo_2fa');
    }
  }
  await salvarArquivo(
    a.ctx,
    {
      tipo: 'documento_assinado', conteudo: arquivo, permitidos: ['pdf'], patientId: d.patientId, substitui: d.base,
      antesDaReserva: async (tx) => {
        const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId)).for('update');
        if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
      },
      registrar: async (tx, arq) => {
        if (primeiro) await gravarAssinante(tx, { tenantId: a.ctx.tenantId, cpf: c.cpf!, userId: a.user.id, agora });
        await registrarAssinatura(tx, {
          documentoId: docId, codigo: d.codigo, patientId: d.patientId, tenantId: a.ctx.tenantId, caminho: arq.caminho, sha256: c.sha256, tipo: c.tipo,
          emissor: c.emissor, assinanteNome: c.titularNome, userId: a.user.id, agora, copia: d.copia, base: d.base,
        });
        if (primeiro) await enqueueEmail({ tipo: 'certificado_confirmado', para: a.user.email, mascara: mascararCpf(c.cpf!) }, { tenantId: a.ctx.tenantId, tx });
      },
    },
    { db, dataDir: deps.dataDir },
  );
  await apagarArquivo(a.ctx, { caminho: d.base }, {
    db, dataDir: deps.dataDir,
    naMesmaTransacao: async (tx) => !(await tx.select({ id: signedDocuments.id }).from(signedDocuments).where(eq(signedDocuments.basePdfPath, d.base))).length,
  }).catch(() => logger.warn({ tenantId: a.ctx.tenantId, documentoId: docId }, 'PDF base não apagado depois da assinatura (a varredura apaga)'));
  return { tipo: 'assinado' };
}
```

E-mail (`src/email/types.ts`): `| { tipo: 'certificado_confirmado'; para: string; mascara: string }`; template (`templates.tsx`):

```tsx
    case 'certificado_confirmado':
      return simples('Certificado do consultório confirmado', [
        `O certificado com CPF ${msg.mascara} passou a ser o do consultório para assinar documentos no NutriDebby.`,
        'Se não foi você, troque a senha e fale com o suporte.',
      ]);
```

Run: `pnpm test src/modules/documentos/assinar.test.ts src/modules/documentos/verificacao.test.ts` → PASS.

- [ ] **Step 4: Rota** — `src/app/api/painel/documentos/[id]/assinado/route.ts`

```ts
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { logger } from '@/lib/logger';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { aceitarPdfAssinado } from '@/modules/documentos/assinar';
import { MAX_ENVIO_BYTES } from '@/modules/documentos/constantes';
import { DocumentoNaoEncontradoError, MSG_RECUSA, RecusaAssinaturaError, TransicaoInvalidaError } from '@/modules/documentos/erros';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';
const LIMITE_CORPO = MAX_ENVIO_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
/** RNF-141: a conferência usa até 3 s de CPU no processo do Next; no máximo 2 ao mesmo tempo (como os exames). */
const MAX_CONFERENCIAS = 2;
let emAndamento = 0;

/** US-144: multipart (arquivo, codigo2fa opcional). Route Handler (o proxy corta corpo de Server Action em 10 MB). */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/documentos/[id]/assinado'>) {
  if (!mesmaOrigem(req)) return resposta(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return resposta(404, { erro: 'Documento não encontrado.' });
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erro: MSG_RECUSA.arquivo });
  if (emAndamento >= MAX_CONFERENCIAS) return resposta(429, { erro: 'Outro envio está em andamento. Tente de novo em instantes.' });
  emAndamento++;
  try {
    let form: FormData;
    try {
      const corpo = await lerCorpoLimitado(req, LIMITE_CORPO, { prazoMs: 60_000 });
      form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
    } catch (e) {
      if (e instanceof CorpoGrandeError) return resposta(413, { erro: MSG_RECUSA.arquivo });
      if (e instanceof CorpoLentoError) return resposta(408, { erro: 'O envio demorou demais. Tente de novo.' });
      return resposta(400, { erro: 'Formulário inválido.' });
    }
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof Blob) || arquivo.size === 0 || arquivo.size > MAX_ENVIO_BYTES) return resposta(415, { erro: MSG_RECUSA.arquivo });
    const r = await aceitarPdfAssinado(
      { ctx: acesso.ctx, tenant: acesso.tenant, user: { id: acesso.data.user.id, email: acesso.data.user.email, twoFactorEnabled: acesso.data.user.twoFactorEnabled ?? null } },
      id, Buffer.from(await arquivo.arrayBuffer()), { codigo2fa: form.get('codigo2fa') ?? undefined }, { headers: req.headers },
    );
    return resposta(200, r.tipo === 'assinado' ? { ok: true } : { confirmar: { nome: r.nome, cpfMascarado: r.cpfMascarado } });
  } catch (e) {
    if (e instanceof RecusaAssinaturaError) {
      logger.info({ tenantId: acesso.ctx.tenantId, documentoId: id, motivo: e.motivoTecnico }, 'PDF assinado recusado');
      return resposta(422, { erro: e.mensagem(), codigo: e.codigo });
    }
    if (e instanceof DocumentoNaoEncontradoError) return resposta(404, { erro: e.message });
    if (e instanceof TransicaoInvalidaError || e instanceof PacienteBloqueadoError) return resposta(409, { erro: e.message });
    if (e instanceof CotaEsgotadaError) return resposta(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    emAndamento--;
  }
}
```

`route.test.ts` (padrão dos exames): origem estranha → 403; sem sessão → 401; corpo de 11 MB → 413 com "Envie o PDF assinado (até 10 MB)."; PDF adulterado da fábrica → 422 com a mensagem de "alterado" e o documento continua "Aguardando assinatura"; o log da recusa (spy no `logger.info`) tem só `tenantId`, `documentoId` e `motivo` (nada de CN/CPF). Para a rota usar a AC de teste, o teste troca as âncoras por `vi.mock('@/modules/documentos/ancoras', …)` e liga `ASSINATURAS_LIBERADAS` por `vi.mock('@/modules/documentos/constantes', async (o) => ({ ...(await o()), ASSINATURAS_LIBERADAS: { govbr: true, icp: true } }))`.

- [ ] **Step 5: Tela de envio** — `enviar-assinado.tsx` (no cartão "Aguardando assinatura" da página do documento, só com `data.user.twoFactorEnabled`)

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Botao } from '@/components/ui/botao';

type Confirmar = { nome: string; cpfMascarado: string };

/** US-144: envio do PDF assinado; no primeiro certificado, "Sim, sou eu" reenvia o MESMO arquivo com o código do 2FA (D13). */
export function EnviarAssinado({ docId }: { docId: string }) {
  const router = useRouter();
  const arquivo = useRef<File | null>(null);
  const [estado, setEstado] = useState<'livre' | 'enviando' | 'confirmar'>('livre');
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);

  async function enviar(codigo?: string) {
    if (!arquivo.current) return setErro('Envie o PDF assinado (até 10 MB).');
    setErro('');
    setEstado('enviando');
    const f = new FormData();
    f.set('arquivo', arquivo.current);
    if (codigo) f.set('codigo2fa', codigo);
    const r = await fetch(`/api/painel/documentos/${docId}/assinado`, { method: 'POST', body: f }).catch(() => null);
    const j = (r ? await r.json().catch(() => ({})) : {}) as { ok?: boolean; confirmar?: Confirmar; erro?: string };
    if (j.ok) {
      setOk(true);
      router.refresh();
      return;
    }
    if (j.confirmar) {
      setConfirmar(j.confirmar);
      setEstado('confirmar');
      return;
    }
    setErro(j.erro ?? 'Não foi possível enviar. Tente de novo.');
    setEstado(confirmar ? 'confirmar' : 'livre');
  }

  return (
    <div className="space-y-3">
      {estado !== 'confirmar' && (
        <form onSubmit={(e) => (e.preventDefault(), enviar())} className="space-y-2">
          <label htmlFor="pdf-assinado" className="block font-medium">Arquivo do PDF assinado</label>
          <input id="pdf-assinado" type="file" accept="application/pdf" onChange={(e) => (arquivo.current = e.target.files?.[0] ?? null)} className="block" />
          <Botao disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Conferindo a assinatura…' : 'Enviar PDF assinado'}</Botao>
        </form>
      )}
      {estado === 'confirmar' && confirmar && (
        <form onSubmit={(e) => (e.preventDefault(), enviar(String(new FormData(e.currentTarget).get('codigo') ?? '')))} className="space-y-2" aria-labelledby="confirmar-cert">
          <p id="confirmar-cert">{`Assinado por ${confirmar.nome} (CPF ${confirmar.cpfMascarado}). Este é o seu certificado?`}</p>
          <label htmlFor="codigo-2fa" className="block font-medium">Código da verificação em duas etapas</label>
          <input id="codigo-2fa" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className="w-40 rounded-xl border border-campo bg-cartao p-2 text-texto" />
          <div className="flex gap-2">
            <Botao>Sim, sou eu</Botao>
            <Botao type="button" variante="secundario" onClick={() => (setEstado('livre'), setConfirmar(null))}>Não</Botao>
          </div>
        </form>
      )}
      {erro && <p role="alert" className="text-erro">{erro}</p>}
      {ok && <p role="status">Documento assinado.</p>}
    </div>
  );
}
```

Na página do documento, no cartão "Aguardando assinatura", depois do aviso do 2FA: `{data.user.twoFactorEnabled && !bloqueado && <EnviarAssinado docId={d.id} />}`.

- [ ] **Step 6: Rodar e commit**

Run: `pnpm test src/modules/documentos src/app/api/painel/documentos && pnpm typecheck` → PASS.

```bash
git add src/modules/documentos/{assinar,assinar.test,verificacao,verificacao.test}.ts src/app/api/painel/documentos/[id]/assinado src/app/painel/pacientes/[id]/documentos/[docId] src/email
git commit -m "feat(documentos): envio do PDF assinado — primeiro certificado com 2FA, CPF do consultório, assinatura e verificação (US-144, RN-145)"
```

---
### Task 11: Digitalizada — fotos das páginas, código do 2FA a cada envio e PDF novo montado no worker (D1 opção E, D4 ★, RN-157; P10-11)

**Files:**
- Create: `src/modules/documentos/digitalizada.ts` (+ `digitalizada.test.ts`), `src/modules/documentos/digitalizada-job.ts` (+ `digitalizada-job.test.ts`), `src/app/api/painel/documentos/[id]/digitalizada/route.ts`, `src/app/painel/pacientes/[id]/documentos/[docId]/enviar-digitalizada.tsx`
- Modify: `src/worker/index.ts`, a página do documento (cartão "Aguardando assinatura" e o estado "Montando o PDF digitalizado…")

**Interfaces:**
- Consumes: `registrarAssinatura`, `AssinaturaAceita` (T10); `confirmarCodigo2fa` (T5); `salvarArquivo`, `apagarArquivo`; `detectarTipo`; `formatarCodigo`, `AREA_ASSINATURA`; `getBoss`, `fromDrizzle`; `recordAudit`.
- Produces:
  - `receberDigitalizada(a: AcessoAssinatura, docId: string, imagens: Buffer[], codigo2fa: unknown, deps: DepsAssinar & { boss?: PgBoss }): Promise<void>` (lança `RecusaAssinaturaError` com `imagens`, `sem_2fa`, `codigo_2fa`, `tentativas_2fa`); `MSG_DIGITALIZADA = { aviso, fotos, montando, falhou }`.
  - `montarPdfDigitalizado(data: { tenantId: string; documentoId: string; userId: string }, deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean }): Promise<'pronto' | 'ignorado' | 'falhou'>`; `renderizarDigitalizada(d: { paginas: { dados: Buffer; formato: 'jpg' | 'png' }[]; codigo: string; urlVerificacao: string }): Promise<Buffer>`.

- [ ] **Step 1: Testes (falham)** — `digitalizada.test.ts` e `digitalizada-job.test.ts`

```ts
// digitalizada.test.ts (ajudantes novoConsultorio/outroDocumento de test/documentos.ts, T10)
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, outroDocumento } from '../../../test/documentos';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { receberDigitalizada } from './digitalizada';
import { RecusaAssinaturaError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});
const png = () => sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).png().toBuffer();
const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n');
const recusa = (c: string) => (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === c;
const deps = (dataDir: string, codigo: 'ok' | 'invalido' = 'ok') => ({ db: app.db, dataDir, headers: new Headers(), confirmar2fa: async () => codigo });

describe('digitalizada (RN-157, D4)', () => {
  it('PDF como "digitalizado" é recusado (só fotos); 6 fotos também; o código do 2FA é pedido em todo envio', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(receberDigitalizada(x.acesso, x.id, [pdf], '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('imagens'));
    const f = await png();
    await expect(receberDigitalizada(x.acesso, x.id, Array(6).fill(f), '123456', deps(x.dataDir))).rejects.toSatisfy(recusa('imagens'));
    await expect(receberDigitalizada(x.acesso, x.id, [f], '000000', deps(x.dataDir, 'invalido'))).rejects.toSatisfy(recusa('codigo_2fa'));
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
import { novoConsultorio, outroDocumento } from '../../../test/documentos';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado } from './digitalizada-job';
import { lerBase, percorrer } from './pdf-leitor';

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
    const b = lerBase(arquivo);
    for (const o of b.objetos.values()) percorrer(o.valor, (_v, k) => expect(['OpenAction', 'JavaScript', 'JS', 'EmbeddedFile', 'AA']).not.toContain(k));
    const v = (await app.db.execute(sql`select assinatura_tipo, assinante_nome from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v).toEqual({ assinatura_tipo: 'digitalizada', assinante_nome: null });
    const sobra = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select tipo from stored_files where tipo in ('documento_digitalizado', 'documento_base') and patient_id = ${x.p.id}`), app.db);
    expect(sobra.rows).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/documentos/digitalizada.test.ts src/modules/documentos/digitalizada-job.test.ts` → FAIL.

- [ ] **Step 2: Receber as fotos** — `src/modules/documentos/digitalizada.ts`

```ts
import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
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
import type { AcessoAssinatura, DepsAssinar } from './assinar';
import { DocumentoNaoEncontradoError, RecusaAssinaturaError, TransicaoInvalidaError } from './erros';

export const MAX_FOTOS = 5;
export const MAX_FOTOS_BYTES = 10 * 1024 * 1024;
/** US-144 (texto exato da spec v0.3) e os novos deste plano. */
export const MSG_DIGITALIZADA = {
  aviso: 'O sistema não confere o conteúdo de documentos digitalizados. Envie fotos das páginas do PDF preparado, assinadas e sem alterações.',
  fotos: 'Envie de 1 a 5 fotos, até 10 MB no total.',
  montando: 'Montando o PDF digitalizado…',
  falhou: 'Não foi possível montar o PDF. Envie as fotos de novo.',
} as const;

/**
 * RN-157 / D4: só fotos (JPEG/PNG, tipo pelo conteúdo, 1 a 5, 10 MB no total) e o código do 2FA em TODO envio (sem
 * certificado, é o que liga a autoria, D13). As fotos vão para stored_files (`documento_digitalizado`, fora da política do
 * paciente) e o worker monta o PDF novo — o arquivo enviado nunca é entregue como veio.
 */
export async function receberDigitalizada(a: AcessoAssinatura, docId: string, imagens: Buffer[], codigo2fa: unknown, deps: DepsAssinar & { boss?: PgBoss }): Promise<void> {
  const db = deps.db ?? getDb();
  if (!a.user.twoFactorEnabled) throw new RecusaAssinaturaError('sem_2fa');
  const total = imagens.reduce((s, b) => s + b.length, 0);
  if (!imagens.length || imagens.length > MAX_FOTOS || total > MAX_FOTOS_BYTES) throw new RecusaAssinaturaError('imagens', 'quantidade_ou_tamanho');
  if (!imagens.every((b) => ['jpg', 'png'].includes(detectarTipo(b)?.ext ?? ''))) throw new RecusaAssinaturaError('imagens', 'tipo');
  // trava o envio (um por vez) e guarda as fotos antigas de um envio que falhou, para apagar depois
  const { patientId, antigas } = await withTenant(a.ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId)).for('update');
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'aguardando_assinatura' || d.digitalizacaoStatus === 'pendente') throw new TransicaoInvalidaError();
    const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId));
    if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
    return { patientId: d.patientId, antigas: d.digitalizacao ?? [] };
  }, db);
  const r = await (deps.confirmar2fa ?? ((e) => confirmarCodigo2fa(e, { db })))({ userId: a.user.id, codigo: codigo2fa, headers: deps.headers });
  if (r === 'bloqueado') throw new RecusaAssinaturaError('tentativas_2fa');
  if (r === 'invalido') {
    await withTenant(a.ctx, (tx) => recordAudit(tx, { acao: 'criar', entidade: 'tentativa_assinatura', entidadeId: docId, patientId }), db);
    throw new RecusaAssinaturaError('codigo_2fa');
  }
  for (const c of antigas) await apagarArquivo(a.ctx, { caminho: c }, { db, dataDir: deps.dataDir, naMesmaTransacao: async (tx) => (await tx.update(signedDocuments).set({ digitalizacao: sql`coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb) - ${c}::text` }).where(eq(signedDocuments.id, docId)).returning({ id: signedDocuments.id })).length > 0 }).catch(() => undefined);
  try {
    for (const img of imagens) {
      await salvarArquivo(a.ctx, {
        tipo: 'documento_digitalizado', conteudo: img, permitidos: ['jpg', 'png'], patientId,
        registrar: async (tx, arq) => {
          const ok = await tx
            .update(signedDocuments)
            .set({ digitalizacao: sql`coalesce(${signedDocuments.digitalizacao}, '[]'::jsonb) || jsonb_build_array(${arq.caminho}::text)`, digitalizacaoStatus: null })
            .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.status, 'aguardando_assinatura')))
            .returning({ id: signedDocuments.id });
          if (!ok.length) throw new TransicaoInvalidaError();
        },
      }, { db, dataDir: deps.dataDir });
    }
  } catch (e) {
    await withTenant(a.ctx, (tx) => tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou' }).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.status, 'aguardando_assinatura'))), db).catch(() => undefined);
    throw e;
  }
  const boss = deps.boss ?? (await getBoss());
  await withTenant(a.ctx, async (tx) => {
    await tx.update(signedDocuments).set({ digitalizacaoStatus: 'pendente' }).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.status, 'aguardando_assinatura')));
    await boss.send('documento-digitalizado', { tenantId: a.ctx.tenantId, documentoId: docId, userId: a.user.id }, { db: fromDrizzle(tx, sql) });
  }, db);
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
import type { Db } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { detectarTipo } from '@/lib/file-type';
import { logger } from '@/lib/logger';
import { urlDoApp } from '@/lib/url-do-app';
import { apagarArquivo, CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { registrarAssinatura } from './assinar';
import { formatarCodigo } from './codigo';
import type { ConteudoReceita } from './prescricao';

/** Só o worker importa este arquivo (guarda de grafo). */
export async function renderizarDigitalizada(d: { paginas: { dados: Buffer; formato: 'jpg' | 'png' }[]; codigo: string; urlVerificacao: string }): Promise<Buffer> {
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

/** RN-157: o PDF novo com as fotos e o rodapé; a ida a "assinado" (tipo digitalizada) no registrar; depois, fotos e base apagados. */
export async function montarPdfDigitalizado(data: { tenantId: string; documentoId: string; userId: string }, deps: { db: Db; dataDir: string; appUrl: string; now?: Date; ultimaTentativa: boolean }): Promise<'pronto' | 'ignorado' | 'falhou'> {
  const { db } = deps;
  const agora = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () => withTenant(ctx, (tx) => tx.update(signedDocuments).set({ digitalizacaoStatus: 'falhou' }).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.digitalizacaoStatus, 'pendente'))), db);
  const d = await withTenant(ctx, async (tx) => (await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, data.documentoId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.digitalizacaoStatus, 'pendente'))))[0] ?? null, db);
  if (!d || !d.codigo || !d.digitalizacao?.length) return 'ignorado';
  try {
    const paginas = await Promise.all(d.digitalizacao.map(async (c) => {
      const dados = await readFile(resolverCaminho(deps.dataDir, c));
      const t = detectarTipo(dados)?.ext;
      if (t !== 'jpg' && t !== 'png') throw new Error('foto inválida');
      return { dados, formato: t };
    }));
    const pdf = await renderizarDigitalizada({ paginas, codigo: d.codigo, urlVerificacao: urlDoApp(deps.appUrl, `/v/${d.codigo}`) });
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
          documentoId: d.id, codigo: d.codigo!, patientId: d.patientId, tenantId: data.tenantId, caminho: arq.caminho, sha256: sha, tipo: 'digitalizada',
          emissor: null, assinanteNome: null, userId: data.userId, agora, copia, base: d.basePdfPath,
        });
      },
    }, { db, dataDir: deps.dataDir });
    for (const c of [...d.digitalizacao, ...(d.basePdfPath ? [d.basePdfPath] : [])])
      await apagarArquivo(ctx, { caminho: c }, { db, dataDir: deps.dataDir }).catch(() => logger.warn({ tenantId: data.tenantId, documentoId: d.id }, 'arquivo da digitalização não apagado (a varredura apaga)'));
    return 'pronto';
  } catch (e) {
    if (e instanceof JaFeitoError) {
      await marcarFalhou();
      return 'ignorado';
    }
    if (e instanceof CotaEsgotadaError || deps.ultimaTentativa) {
      logger.warn({ documentoId: data.documentoId, tenantId: data.tenantId, motivo: e instanceof CotaEsgotadaError ? 'cota' : 'erro' }, 'PDF da digitalização não montado');
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

`src/app/api/painel/documentos/[id]/digitalizada/route.ts`: o mesmo esqueleto da rota do assinado (mesmaOrigem, requireApiNutri, `documentosLiberados`, corpo limitado a `MAX_FOTOS_BYTES + 64 KB`, semáforo de 2), lendo `form.getAll('fotos')` (Blobs não vazios → `Buffer`) e `form.get('codigo2fa')`, chamando `receberDigitalizada(…, { headers: req.headers })` e respondendo `200 { ok: true }`, `422 { erro: e.mensagem() }` (recusa), `409`, `404`, `507`, como lá.

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

Na página do documento: no cartão "Aguardando assinatura", `{data.user.twoFactorEnabled && !bloqueado && d.digitalizacaoStatus !== 'pendente' && <EnviarDigitalizada docId={d.id} aviso={MSG_DIGITALIZADA.aviso} dica={MSG_DIGITALIZADA.fotos} />}`; com `d.digitalizacaoStatus === 'pendente'`, `<p role="status" aria-live="polite">Montando o PDF digitalizado…</p>` e o mesmo `EstadoPdf` (que recarrega quando o status muda — o `estadoDoDocumento` já devolve `digitalizacaoStatus`); com `'falhou'`, `<Aviso tipo="erro">{MSG_DIGITALIZADA.falhou}</Aviso>`.

- [ ] **Step 5: Rodar e commit**

Run: `pnpm test src/modules/documentos/digitalizada.test.ts src/modules/documentos/digitalizada-job.test.ts src/modules/pacientes/exportacao.test.ts` → PASS (a guarda de grafo agora encontra `digitalizada-job.ts` e confere que nenhuma rota o importa).

```bash
git add src/modules/documentos/{digitalizada,digitalizada.test,digitalizada-job,digitalizada-job.test}.ts* src/app/api/painel/documentos/[id]/digitalizada src/app/painel/pacientes/[id]/documentos/[docId] src/worker/index.ts test/documentos.ts
git commit -m "feat(documentos): digitalizada por fotos com 2FA a cada envio e PDF novo montado no worker (RN-157, D4)"
```

---
### Task 12: Entrega ao paciente, link de uso único (token), "Entregue pessoalmente", situação da entrega e avisos neutros (US-145, RN-152, RN-153, RN-158 parte do token, D3 e D11 da spec; P10-12)

**Files:**
- Create: `src/modules/documentos/entrega.ts` (+ `entrega.test.ts`), `src/modules/documentos/recebimento.ts`, `src/modules/documentos/link-documento.ts` (parte do token), `src/app/painel/pacientes/[id]/documentos/[docId]/entrega.tsx`
- Modify: `src/modules/documentos/assinar.ts` (`registrarAssinatura` chama a entrega; `AssinaturaAceita.appUrl`), `src/app/api/painel/documentos/[id]/assinado/route.ts` (passa `appUrl`), `src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL.documento_novo`), `src/email/{types.ts,templates.tsx}` (`documento_novo`, `documento_link`), a página e a lista de documentos (situação), `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS`)

**Interfaces:**
- Consumes: `notifications`, `patients`, `tenants`; `enqueueEmail`; `dispararEnvio`; `telaDoPortal`; `urlDoApp`; `primeiroNome`; `encryptionKey`; `normalizarEmailDoLink` (padrão de `link-consulta.ts`); `dataHora` (T7).
- Produces:
  - `link-documento.ts`: `chaveDoLinkDocumento(): Buffer`, `assinarLinkDocumento(l: { tenantId; patientId; documentoId; emitidoEm: Date; email: string }): string`, `lerLinkDocumento<T extends { email: string }>(token: unknown, agora: Date, carregar: (ids) => Promise<T | null>): Promise<{ ids; emitidoEm: Date; expirado: boolean; dados: T } | null>`, `VALIDADE_LINK_MS = 30 dias`, `urlDoLinkDocumento(appUrl, token)`.
  - `entrega.ts`: `entregarDocumento(tx, e: { tenantId; patientId; documentoId; agora: Date; appUrl: string }): Promise<'portal' | 'link' | 'nenhuma'>`, `reenviarLink(ctx, patientId, docId, deps?: { db?; appUrl?; agora? }): Promise<void>`, `situacaoDaEntrega(d: ItemLista, fuso: string): string`, `MSG_ENTREGA`.
  - `recebimento.ts`: `marcarEntreguePessoalmente(ctx, patientId, docId, deps?): Promise<boolean>`, `registrarRecibo(tx, r: { tenantId; patientId; documentoId; evento: EventoRecibo; via: ViaRecibo; registradoPor?: string | null }): Promise<boolean>` (usado pelo portal e pelo link).
  - E-mails `{ tipo: 'documento_novo'; para; nome; consultorio; link }` e `{ tipo: 'documento_link'; para; nome; consultorio; link }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/entrega.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { entregarDocumento, situacaoDaEntrega } from './entrega';
import { listarDocumentos } from './documentos';
import { lerLinkDocumento } from './link-documento';
import { marcarEntreguePessoalmente } from './recebimento';

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
});
```

Run: `pnpm test src/modules/documentos/entrega.test.ts` → FAIL.

- [ ] **Step 2: O token do link** — `src/modules/documentos/link-documento.ts` (a T14 acrescenta o código e a sessão)

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
  if (!dados || !timingSafeEqual(mac(corpo, dados.email), b.subarray(53))) return null;
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
  if (!p.email) return 'nenhuma';
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

Em `assinar.ts`, `AssinaturaAceita` ganha `appUrl: string` e o fim de `registrarAssinatura` passa a `await entregarDocumento(tx, { tenantId: a.tenantId, patientId: a.patientId, documentoId: a.documentoId, agora: a.agora, appUrl: a.appUrl });`; `aceitarPdfAssinado` recebe `appUrl` em `DepsAssinar` (padrão `getEnv().APP_URL`) e o passa no `registrarAssinatura`; em `digitalizada-job.ts` (T11), a chamada de `registrarAssinatura` ganha `appUrl: deps.appUrl`.

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
export async function entreguePessoalmenteAction(patientId: string, docId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await marcarEntreguePessoalmente(ctx, patientId, docId);
  } catch (e) {
    comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
}

export async function reenviarLinkAction(patientId: string, docId: string): Promise<void> {
  const { ctx } = await acesso(caminho(patientId, docId));
  try {
    await reenviarLink(ctx, patientId, docId);
  } catch (e) {
    comoEstado(e);
  }
  redirect(`${caminho(patientId, docId)}?link=1`);
}
```

`entrega.tsx` (componente de servidor, dentro do cartão "Documento assinado"):

```tsx
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import { MSG_ENTREGA, situacaoDaEntrega } from '@/modules/documentos/entrega';
import type { DocumentoLido } from '@/modules/documentos/documentos';
import { entreguePessoalmenteAction, reenviarLinkAction } from '../actions';

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
        <form action={entreguePessoalmenteAction.bind(null, paciente.id, d.id)}>
          <ConfirmarBotao mensagem="Marcar como entregue pessoalmente?">Entregue pessoalmente</ConfirmarBotao>
        </form>
      )}
      {d.status === 'assinado' && paciente.status === 'ativo' && !paciente.userId && paciente.email && (
        <form action={reenviarLinkAction.bind(null, paciente.id, d.id)}>
          <ConfirmarBotao mensagem="Reenviar o link do documento para o e-mail do paciente?">Reenviar link por e-mail</ConfirmarBotao>
        </form>
      )}
    </section>
  );
}
```

Na lista (T7), a coluna "Situação" passa a mostrar `situacaoDaEntrega(d, tenant.fuso)` para os assinados (no lugar do "Assinado em …").

- [ ] **Step 6: Rodar e commit**

Run: `pnpm test src/modules/documentos src/db/sem-conta-guarda.test.ts src/email src/modules/notificacoes` → PASS.

```bash
git add src/modules/documentos/{entrega,entrega.test,recebimento,link-documento,assinar}.ts src/app/api/painel/documentos src/app/painel/pacientes/[id]/documentos src/email src/modules/notificacoes/mensagens.ts src/db/tenant.ts
git commit -m "feat(documentos): entrega pelo portal ou por link de uso único, entregue pessoalmente e situação da entrega (US-145, RN-152, RN-153)"
```

---
### Task 13: Portal — "Documentos", abrir o PDF e "Confirmo que recebi este documento" (US-146, D4 da spec, D5 ★; P10-13)

**Files:**
- Create: `src/modules/documentos/portal.ts` (+ `portal.test.ts`), `src/app/p/(portal)/documentos/page.tsx`, `src/app/p/(portal)/documentos/actions.ts`, `src/app/api/p/documentos/[id]/pdf/route.ts`
- Modify: `src/app/p/navegacao.ts` (`tambem` de "Perfil"), `src/app/p/(portal)/inicio/page.tsx` (cartão), `src/app/p/(portal)/perfil/page.tsx` (link)

**Interfaces:**
- Consumes: `registrarRecibo` (T12); `auditRead`; `EMITIDOS`; `TIPO_DOCUMENTO_ROTULO`; `requirePaciente`/`requireApiPaciente`; `signFileUrl`.
- Produces: `documentosDoPaciente(ctx, db?): Promise<DocumentoNoPortal[]>` (sem `auditRead`), `DocumentoNoPortal = { id; titulo: 'Receita'; data: Date; status: 'assinado' | 'substituido' | 'cancelado'; aberto: boolean; recebidoEm: Date | null }`; `novosNoPortal(ctx, db?): Promise<number>`; `caminhoDoPdfNoPortal(ctx, docId, db?): Promise<string | null>` (`auditRead` + evento `aberto`); `confirmarRecebimentoNoPortal(ctx, docId, db?): Promise<Date | null>`; `MSG_PORTAL_DOC`.

- [ ] **Step 1: Teste (falha)** — `src/modules/documentos/portal.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { caminhoDoPdfNoPortal, confirmarRecebimentoNoPortal, documentosDoPaciente, novosNoPortal } from './portal';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('documentos no portal (US-146)', () => {
  it('só os emitidos do próprio paciente, do mais novo para o mais antigo; a lista não audita', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    await documentoNoBanco(app.db, T.ctx, p.id);
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const c = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await documentoNoBanco(app.db, T.ctx, outro.id, { status: 'assinado' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const lista = await documentosDoPaciente(ctx, app.db);
    expect(lista.map((d) => d.id).sort()).toEqual([a.id, c.id].sort());
    expect(await novosNoPortal(ctx, app.db)).toBe(1); // o assinado ainda não aberto (o cancelado não conta)
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows).toEqual([]);
  });

  it('abrir o PDF audita e grava "aberto" uma vez; confirmar grava "recebido" uma vez; cancelado não confirma; rascunho dá 404', async () => {
    const T = await novoTenant(app.db);
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
import { patients, signedDocumentReceipts, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { registrarRecibo } from './recebimento';

/** US-146 (texto exato da spec v0.3). */
export const MSG_PORTAL_DOC = {
  vazio: 'Você ainda não tem documentos.',
  substituido: 'Substituído por uma versão mais nova.',
  cancelado: 'Cancelado pela nutricionista. Não use este documento.',
  confirmar: 'Confirmo que recebi este documento',
} as const;

export type DocumentoNoPortal = { id: string; titulo: 'Receita'; data: Date; status: 'assinado' | 'substituido' | 'cancelado'; aberto: boolean; recebidoEm: Date | null };

/** RN-153: bloqueado ou anonimizado não vê mais nada (o prontuário fica só para a nutricionista). */
async function ativo(tx: Parameters<Parameters<typeof withTenant>[1]>[0], patientId: string): Promise<boolean> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId));
  return !!p && p.status !== 'bloqueado' && !p.anonimizadoEm;
}

/** A lista (título, data, situação) não chama auditRead, como a agenda (D17). A RLS (paciente_so_emitidos) já filtra. */
export async function documentosDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<DocumentoNoPortal[]> {
  return withTenant(ctx, async (tx) => {
    if (!(await ativo(tx, ctx.patientId!))) return [];
    const ds = await tx
      .select({ id: signedDocuments.id, status: signedDocuments.status, assinadoEm: signedDocuments.assinadoEm })
      .from(signedDocuments)
      .where(sql`${signedDocuments.anonimizadoEm} is null`)
      .orderBy(desc(signedDocuments.assinadoEm));
    const rs = ds.length ? await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ds.map((d) => d.id))) : [];
    return ds.map((d) => ({
      id: d.id, titulo: 'Receita' as const, data: d.assinadoEm!, status: d.status as DocumentoNoPortal['status'],
      aberto: rs.some((r) => r.documentoId === d.id && r.evento === 'aberto'), recebidoEm: rs.find((r) => r.documentoId === d.id && r.evento === 'recebido')?.em ?? null,
    }));
  }, db);
}

/** O número do cartão do Início: assinados ainda não abertos. */
export async function novosNoPortal(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  return withTenant(ctx, async (tx) => {
    if (!(await ativo(tx, ctx.patientId!))) return 0;
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
    if (!(await ativo(tx, ctx.patientId!))) return null;
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
    if (!(await ativo(tx, ctx.patientId!))) return null;
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

/** US-146: a URL assinada (5 min) nasce no clique, nunca no HTML guardado (como /api/p/plano/pdf). */
export async function GET(req: Request, { params }: RouteContext<'/api/p/documentos/[id]/pdf'>) {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
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
import { requirePaciente } from '@/lib/paciente-session';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { documentosDoPaciente, MSG_PORTAL_DOC } from '@/modules/documentos/portal';
import { confirmarRecebimentoAction } from './actions';

export const dynamic = 'force-dynamic';

/** US-146 / D5 ★: chega pelo cartão do Início e pelo link em Perfil; marca a aba "Perfil". Fora da cópia offline. */
export default async function MeusDocumentos() {
  const { ctx, tenant } = await requirePaciente('/p/documentos');
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
            {d.status === 'substituido' && <p>{MSG_PORTAL_DOC.substituido}</p>}
            {d.status === 'cancelado' && <p role="note" className="font-semibold">{MSG_PORTAL_DOC.cancelado}</p>}
            <a href={`/api/p/documentos/${d.id}/pdf`} className="inline-flex min-h-11 items-center underline">{`Abrir PDF da ${d.titulo.toLowerCase()} de ${data(d.data)}`}</a>
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

`src/app/p/navegacao.ts`: `{ href: '/p/perfil', rotulo: 'Perfil', tambem: ['/p/documentos'] }` (e o teste de `navegacao.test.ts` ganha `expect(itemAtual('/p/documentos')).toBe('/p/perfil')`). Em Perfil, antes de "Notificações": `<p><Link href="/p/documentos" className="inline-flex min-h-11 items-center underline">Meus documentos</Link></p>`. No Início, com `novosNoPortal(ctx) > 0` (consulta só com `tenant.documentosLiberados`): um cartão "Documentos" com "1 documento novo" / "{n} documentos novos" e o link "Ver documentos".

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos/portal.test.ts src/app/p` → PASS.

```bash
git add src/modules/documentos/{portal,portal.test}.ts src/app/p src/app/api/p/documentos
git commit -m "feat(portal): Documentos — lista, abrir o PDF e confirmar o recebimento (US-146, D4)"
```

---
### Task 14: Link de uso único — código de 6 dígitos, sessão curta e a página `/documento/[token]` (RN-158, D3 b da spec, D6 ★, D12; P10-14)

**Files:**
- Modify: `src/modules/documentos/link-documento.ts` (código e sessão) (+ `link-documento.test.ts`), `src/email/{types.ts,templates.tsx}` (`codigo_documento`), `next.config.ts`, `src/lib/sentry-filtro.ts` (+ teste)
- Create: `src/app/documento/[token]/page.tsx`, `src/app/documento/[token]/codigo-form.tsx`, `src/app/api/documento/[token]/codigo/route.ts`, `.../confirmar/route.ts`, `.../recebido/route.ts`, `.../pdf/route.ts`

**Interfaces:**
- Consumes: token da T12; `documentAccessCodes`, `signedDocuments`, `patients`, `tenants` (status); `registrarRecibo`; `auditRead`; `consumirLimite`/`chaveDoLimite('documento-ip' | 'documento-envio')`; `verifyTurnstile` (via `depsDaRequisicao` do `/api/n/[slug]/resposta.ts`, reaproveitado); `enqueueEmail`; `randomInt`, `createHmac`.
- Produces: `estadoDoLink(token, deps): Promise<EstadoLink>` (`{ tipo: 'invalido' | 'expirado' | 'indisponivel' } | { tipo: 'pedir_codigo' } | { tipo: 'aberto'; titulo; data: Date; recebidoEm: Date | null }` — com `sessao` opcional), `pedirCodigoDocumento(token, input: { turnstile?: unknown }, deps): Promise<void>`, `confirmarCodigoDocumento(token, input: { codigo?: unknown }, deps): Promise<{ sessao: string; expira: Date }>`, `pdfDoLink(token, sessao, deps): Promise<string | null>`, `confirmarRecebimentoPeloLink(token, sessao, deps): Promise<Date | null>`; `LinkError { status: number; mensagem: string }`; `MSG_LINK`; `NOME_COOKIE_LINK = 'nd_doc'`; `DepsLink = { db?; agora?; ip: string | null; ipDoLimite: string | null; verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>; appUrl: string }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/link-documento.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { assinarLinkDocumento, confirmarCodigoDocumento, estadoDoLink, LinkError, MSG_LINK, pdfDoLink, pedirCodigoDocumento } from './link-documento';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});
let ip = 0;
const deps = (agora = new Date()) => ({ db: app.db, agora, ip: `198.51.100.${++ip % 250}`, ipDoLimite: `198.51.100.${ip % 250}`, verificarTurnstile: async () => 'ok' as const, appUrl: 'https://x' });

async function cenario() {
  const T = await novoTenant(app.db);
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
    for (let i = 0; i < 5; i++) await expect(confirmarCodigoDocumento(y.token, { codigo: certo === '000000' ? '111111' : '000000' }, deps())).rejects.toBeInstanceOf(LinkError);
    await expect(confirmarCodigoDocumento(y.token, { codigo: certo }, deps())).rejects.toSatisfy((e) => e instanceof LinkError && e.mensagem === MSG_LINK.codigoVencido);
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
});
```

Run: `pnpm test src/modules/documentos/link-documento.test.ts` → FAIL.

- [ ] **Step 2: Código e sessão** — acrescentar a `src/modules/documentos/link-documento.ts`

```ts
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { documentAccessCodes, patients, signedDocumentReceipts, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { safeEqual, sha256 } from '@/lib/crypto';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { auditRead } from '@/modules/plataforma/audit';
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
        const disponivel = t?.status === 'ativa' && p.status === 'ativo' && !p.anonimizadoEm && d?.status === 'assinado' && !!d.pdf;
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

/** O código do pedido mais recente; 5 erros invalidam; acerto → "usado" + sessão de 15 min (só o hash no banco). */
export async function confirmarCodigoDocumento(token: unknown, input: { codigo?: unknown }, deps: DepsLink): Promise<{ sessao: string; expira: Date }> {
  const agora = deps.agora ?? new Date();
  const l = await linkUtilizavel(token, deps);
  const codigo = typeof input.codigo === 'string' ? input.codigo.replace(/\s/g, '') : '';
  return withTenant(ctxDo(l.ids, deps.ip), async (tx) => {
    const [c] = await tx.select().from(documentAccessCodes).where(eq(documentAccessCodes.documentoId, l.ids.documentoId)).orderBy(desc(documentAccessCodes.createdAt)).limit(1).for('update');
    if (!c || c.usadoEm || c.tentativas >= MAX_ERROS || c.expiraEm <= agora) throw new LinkError(410, MSG_LINK.codigoVencido);
    if (!/^\d{6}$/.test(codigo) || !safeEqual(hashDoCodigo(c.id, codigo), c.codigoHash)) {
      await tx.update(documentAccessCodes).set({ tentativas: c.tentativas + 1 }).where(eq(documentAccessCodes.id, c.id));
      throw new LinkError(400, MSG_LINK.codigoInvalido);
    }
    const sessao = randomBytes(32).toString('base64url');
    const expira = new Date(agora.getTime() + SESSAO_MS);
    await tx.update(documentAccessCodes).set({ usadoEm: agora, sessaoHash: sha256(sessao), sessaoExpiraEm: expira }).where(and(eq(documentAccessCodes.id, c.id), isNull(documentAccessCodes.usadoEm)));
    return { sessao, expira };
  }, deps.db ?? getDb());
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
```

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
git add src/modules/documentos/link-documento{,.test}.ts src/app/documento src/app/api/documento src/email next.config.ts src/lib/sentry-filtro{,.test}.ts
git commit -m "feat(documentos): link de uso único com código por e-mail e sessão curta (RN-158, D3 b)"
```

---
### Task 15: Verificação pública por código ou QR (US-147, RN-143, RN-156, D8 da spec; P10-15)

**Files:**
- Modify: `src/modules/documentos/verificacao.ts` (leitura pública) (+ `verificacao-publica.test.ts`), `next.config.ts`, `src/lib/sentry-filtro.ts` (+ teste)
- Create: `src/app/v/page.tsx`, `src/app/v/[codigo]/page.tsx`

**Interfaces:**
- Consumes: `documentVerifications` (só aqui, T10); `normalizarCodigo`, `formatarCodigo` (T6); `consumirLimite`/`chaveDoLimite('verificacao-ip')`; `ROTULO_ASSINATURA`; `partesNoFuso`.
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

async function verificacao(situacao = 'valido', assinatura = 'govbr') {
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
    expect(r).toMatchObject({ tipo: 'ok', v: { codigo, tipo: 'Receita', situacao: 'valido', emissorNome: 'Débora Silva Santos', emissorCrn: 'CRN-3 12345', assinanteNome: 'DEBORA SILVA SANTOS', assinatura: 'gov.br' } });
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
  validador: 'Validar a assinatura no validador oficial do ITI',
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
          {r.v.assinatura !== 'Digitalizado' && (
            <a href="https://validar.iti.gov.br" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">{MSG_VERIFICACAO.validador}</a>
          )}
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
### Task 16: LGPD da receita — exportação da equipe e do titular, bloqueio e anonimização (D1 ★, spec §2.3 i, US-150 base, RN-140 c, RN-153; P10-16)

> **Só se o dono aprovar a D1.** Sem ela, esta tarefa sai do Plano 10 e a liberação para uso real espera o Plano 13.

**Files:**
- Create: `src/modules/documentos/lgpd-documentos.ts` (+ `lgpd-documentos.test.ts`)
- Modify: `src/modules/pacientes/lgpd.ts` (`anonimizarVencidos`), `src/modules/pacientes/exportacao-job.ts` (`DadosExportacao.documentos`, `AnexoParaZip`, `montarDados`, `lerAnexos`), `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.test.ts`

**Interfaces:**
- Consumes: `app_anonimizar_documentos` (T3); `apagarArquivo`; `descreverItem`, `ConteudoReceita` (T6); `EMITIDOS`; `formatarCodigo`.
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
          await tx.update(signedDocuments).set({ status: 'rascunho', codigo: null, declaracaoEm: null, basePdfPath: null, basePdfSha256: null, basePdfBytes: null, areaAssinatura: null, pdfStatus: null, pdfPedidoEm: null, digitalizacao: null, digitalizacaoStatus: null }).where(eq(signedDocuments.id, d.id));
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

> As fotos de uma digitalização pendente (`digitalizacao`) de paciente bloqueado: a varredura `limparArquivosOrfaosDeDocumentos` (T8) as apaga depois que o documento some (sem referência) — fica anotado no teste da T16 (caso "aguardando com fotos": depois da anonimização e de uma varredura com o relógio + 2 h, nenhuma `documento_digitalizado` sobra).

- [ ] **Step 3: Encaixe em `lgpd.ts` e na exportação**

`src/modules/pacientes/lgpd.ts`, em `anonimizarVencidos`, logo antes do laço `for (const caminho of await withTenant(ctx, (tx) => anexosDoPaciente(tx, id), db))`:

```ts
        // RN-140 (c) (Plano 10): documentos assinados primeiro, pela função de anonimização (nunca por anexosDoPaciente)
        await anonimizarDocumentosDoPaciente(ctx, id, { db, dataDir: deps.dataDir });
```

e, na transação final, depois de `if (r.length && (await anexosDoPaciente(tx, id)).length) throw …`:

```ts
            if (r.length && (await pdfsDeDocumentosRestantes(tx, id))) throw new Error('documento novo durante a anonimização');
```

`src/modules/pacientes/exportacao-job.ts`:
- `DadosExportacao` ganha `/** Plano 10 (US-150 base): receitas; o titular recebe só as emitidas (D15 = (b): com a justificativa de uso). */ documentos: DocumentoExportado[];`
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
### Task 17: Cancelar documento (US-149, RN-147, D11 da spec, D3 ★; P10-17)

> **Só se o dono aprovar a D3.** Sem ela, esta tarefa vai para o Plano 13 e a liberação para uso real espera por ele.

**Files:**
- Create: `src/modules/documentos/cancelamento.ts` (+ `cancelamento.test.ts`), `src/app/painel/pacientes/[id]/documentos/[docId]/cancelar.tsx`
- Modify: `.../documentos/actions.ts` (`cancelarAction`), a página do documento, `src/email/{types.ts,templates.tsx}` (`documento_atualizado`), `src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL.documento_atualizado`)

**Interfaces:**
- Consumes: `mudarSituacao` (T10); `assinarLinkDocumento`, `urlDoLinkDocumento` (T12); `carregarPacienteParaEscrita`; `enqueueEmail`; `dispararEnvio`; `telaDoPortal`.
- Produces: `cancelarDocumento(ctx, patientId, docId, motivo: unknown, deps?: { db?; appUrl?; agora? }): Promise<void>`; `MSG_CANCELAMENTO = { motivo, confirmacao, retificacao }`; e-mail `{ tipo: 'documento_atualizado'; para; nome; consultorio; link }`.

- [ ] **Step 1: Teste (falha)** — `src/modules/documentos/cancelamento.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
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
    const { paciente, email } = await pacienteComConta(app.db, T, { nome: 'Ana Souza' });
    const d = await documentoNoBanco(app.db, T.ctx, paciente.id, { status: 'assinado' });
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
      values (${d.codigo}, ${T.tenantId}, ${d.id}, 'receita', now(), 'Débora', 'CRN-3 12345', 'DEBORA', 'govbr', ${'a'.repeat(64)})`);
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
  retificacao: (n: number) => `Há uma retificação em andamento (versão ${n}). Conclua ou apague a retificação antes de cancelar.`,
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
    if (p.status !== 'ativo' || !p.email) return;
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
### Task 18: E2E da receita, acessibilidade das telas novas e o fechamento do manual guiado (RNF-144, US-057 do MVP; P10-18)

**Files:**
- Create: `e2e/documentos.spec.ts`
- Modify: `e2e/acessibilidade.spec.ts` (portal `/p/documentos`, `/v/<código>`, `/documento/<token>`), `e2e/acessibilidade-painel.spec.ts` (nada: as rotas novas já estão em `ROTAS_DO_PAINEL`, T7), `src/modules/ajuda/conteudo.ts` (aspas de volta no guia `documentos`; passos "Entrega" e "Cancelar"), `docs/operacao/go-live.md` (itens do Plano 10)

**Interfaces:**
- Consumes: as telas das Tarefas 7 a 17; `e2e/helpers.ts`, `e2e/portal.ts`, `e2e/mailpit.ts` (código do e-mail); `otpauth` (o 2FA da nutricionista no E2E).
- Produces: `e2e/documentos.spec.ts` com o fluxo de ponta a ponta pela **digitalizada** (o caminho que não depende de certificado real: a assinatura gov.br/ICP do E2E exigiria âncoras de teste dentro do app, o que não fazemos).

- [ ] **Step 1: O fluxo de ponta a ponta** — `e2e/documentos.spec.ts`

```ts
import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';
import { entrarComoNutri } from './helpers';
import { pacienteNoPortal } from './portal';

test('receita: rascunho → preparar → digitalizada → portal (abrir e confirmar) → verificação pública', async ({ browser, page }) => {
  test.setTimeout(180_000);
  await entrarComoNutri(page);
  // 2FA da nutricionista (exigido para assinar), pela tela de Segurança
  await page.goto('/conta/seguranca');
  await page.getByLabel('Confirme sua senha').fill(process.env.E2E_SENHA_NUTRI ?? 'Nutri2026segura');
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  const segredo = await page.getByTestId('totp-secret').innerText();
  const totp = new TOTP({ secret: segredo, digits: 6, period: 30 });
  await page.getByLabel('Código de 6 dígitos').fill(totp.generate());
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Verificação em duas etapas ativada.' })).toBeVisible();

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
  const download = p.waitForEvent('download');
  await p.getByRole('link', { name: /^Abrir PDF da receita/ }).click();
  await download;
  await p.getByRole('button', { name: 'Confirmo que recebi este documento' }).click();
  await expect(p.getByRole('status').filter({ hasText: /^Recebimento confirmado em / })).toBeVisible();

  // painel: situação da entrega
  await page.reload();
  await expect(page.getByText(/^Recebido pelo paciente em /)).toBeVisible();

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

- [ ] **Step 2: Acessibilidade** — em `e2e/acessibilidade.spec.ts`, os casos `/p/documentos` (paciente com uma receita emitida), `/v/<código>` (válido e "não encontrado") e `/documento/<token>` (estado "pedir código") nos três modos (claro, escuro, aparelho) e a 360 px, com o mesmo `axe` do Plano 08 (zero violação WCAG 2.1 AA). As telas do painel já entram pelo `ROTAS_DO_PAINEL` (T7).

- [ ] **Step 3: Manual guiado — fechamento** (`src/modules/ajuda/conteudo.ts`)

No guia `documentos`, as três frases que ficaram sem aspas na T7 voltam com os rótulos exatos ("Enviar documento digitalizado (assinado à mão)", "Entregue pessoalmente", "Cancelar documento") e os passos ganham:

```ts
      { alvo: 'entrega-documento', titulo: 'Entrega', texto: 'O paciente recebe pelo app ou por um link por e-mail. Aqui você vê se ele abriu e confirmou o recebimento, ou marca a entrega pessoal.' },
      { alvo: 'cancelar-documento', titulo: 'Cancelar', texto: 'Documento errado? Cancele com o motivo (fica só no prontuário) e faça uma receita nova. A verificação pública passa a mostrar "cancelado".' },
```

O guia `prontuario` ganha "documentos" no resumo ("…evolução, plano alimentar, documentos e privacidade.") e sobe para `versao: 2`. Conferir com `pnpm test src/modules/ajuda` (alvos, aspas e rotas) e rodar `e2e/manual.spec.ts`.

- [ ] **Step 4: Checklist do go-live** — `docs/operacao/go-live.md` ganha a seção "Plano 10 — documentos assinados (liberação para uso real)": resposta do CRN-3 (P-B1) arquivada; textos da D5 e "(proposto)" revistos pela Debby; termo e DPA com a entrega eletrônica e a verificação (P-B3/E-09) e o novo aceite; backup no host (P02-11); `ASSINATURAS_LIBERADAS` com o resultado do spike; o admin liga "Documentos" do consultório (D20); um teste manual completo com um PDF real assinado no gov.br da Debby e um paciente de teste.

- [ ] **Step 5: Rodar e commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e e2e/documentos.spec.ts e2e/acessibilidade.spec.ts e2e/acessibilidade-painel.spec.ts e2e/manual.spec.ts` → PASS.

```bash
git add e2e src/modules/ajuda docs/operacao/go-live.md
git commit -m "test(documentos): E2E da receita pela digitalizada, axe das telas novas e manual guiado (RNF-144)"
```

---
### Task 19 (CONDICIONAL — só se o relatório do spike pedir): conferência de conteúdo assíncrona no worker (D16 = (a) da spec; P10-19)

> Entra **só** se o relatório da T1 cair numa das linhas "T19" da tabela de decisão (assinador que reescreve o arquivo, `/ObjStm` instável, carimbo fora do quadro sem controle). Sem isso, nada desta tarefa é feito e `pdfjs-dist` não entra.

**Files:**
- Create: `src/modules/documentos/conferencia-visual-job.ts` (+ `conferencia-visual-job.test.ts`)
- Modify: `src/modules/documentos/assinar.ts` (ramo assíncrono), `src/modules/documentos/assinatura-pades.ts` (`conferirPdfAssinado(…, { soCriptografia: true })`), `src/jobs/queues.ts` (`documento-conferir`), `src/worker/index.ts`, a página do documento ("Conferindo o PDF assinado…"), `package.json` (`pdfjs-dist@6.4.299` só no worker), `src/modules/pacientes/exportacao.test.ts` (o pacote `pdfjs-dist` na lista dos proibidos no grafo do Next), `src/db/schema/documentos.ts` + migration `0092_conferencia_assincrona` (gerada: `conferencia_status text` e `conferencia_path text` → `stored_files.caminho` NO ACTION, liberadas pelo gatilho só em `aguardando_assinatura`)

**Interfaces:**
- Consumes: `conferirAtualizacao` (só a parte de forma do `/ByteRange` e o CMS continuam síncronos), `registrarAssinatura` (T10/T12).
- Produces: `compararConteudo(base: Buffer, assinado: Buffer, area: AreaAssinatura): Promise<'igual' | { diferenca: 'texto' | 'operadores' | 'anotacoes' | 'acoes' | 'paginas' }>`; `conferirConteudoNoWorker(data: { tenantId; documentoId; userId }, deps): Promise<'assinado' | 'recusado' | 'ignorado'>`.

- [ ] **Step 1: Teste da comparação (falha)** — com as fixtures da T1: a assinatura válida → `'igual'`; `/FreeText` → `{ diferenca: 'anotacoes' }` (o texto extraído sai igual — conclusão 5 da pesquisa); stream redefinido → `{ diferenca: 'operadores' }`; página nova → `{ diferenca: 'paginas' }`; `/OpenAction` → `{ diferenca: 'acoes' }`.

```ts
import { describe, expect, it } from 'vitest';
import { baseMinimo } from '../../../test/assinatura/base-minimo';
import { assinarDeTeste, criarAc, criarTitular } from '../../../test/assinatura/fabrica';
import { compararConteudo } from './conferencia-visual-job';
import { AREA_ASSINATURA } from './constantes';

describe('comparação de conteúdo no worker (D16 a)', async () => {
  const ac = await criarAc();
  const t = await criarTitular(ac, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
  const base = baseMinimo();
  it.each([
    [{}, 'igual'],
    [{ freeText: true }, 'anotacoes'],
    [{ redefinirConteudoDaPagina: true }, 'operadores'],
    [{ paginaNova: true }, 'paginas'],
    [{ openAction: true }, 'acoes'],
  ] as const)('%o → %s', async (o, esperado) => {
    const r = await compararConteudo(base, await assinarDeTeste(base, t, o), AREA_ASSINATURA);
    expect(r === 'igual' ? 'igual' : r.diferenca).toBe(esperado);
  });
});
```

- [ ] **Step 2: Implementação da comparação** — `conferencia-visual-job.ts` (só o worker; `pdfjs-dist` com `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, no máximo 20 páginas e 20 s)

```ts
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { AreaAssinatura } from './constantes';

async function abrir(dados: Buffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(dados), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true }).promise;
}

const dentro = (r: number[], a: AreaAssinatura) => {
  const [x1, y1, x2, y2] = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  return x2 - x1 === 0 || y2 - y1 === 0 || (x1 >= a.x1 - 2 && y1 >= a.y1 - 2 && x2 <= a.x2 + 2 && y2 <= a.y2 + 2);
};

/**
 * D16 (a) da spec / §7 da pesquisa: página a página, o texto, a lista de operadores (nomes de recurso normalizados), as
 * anotações (as do base + exatamente um widget de assinatura, dentro do quadro) e nada de ação no catálogo. Só o texto não
 * basta (uma /FreeText não muda o texto).
 */
export async function compararConteudo(base: Buffer, assinado: Buffer, area: AreaAssinatura): Promise<'igual' | { diferenca: 'texto' | 'operadores' | 'anotacoes' | 'acoes' | 'paginas' }> {
  const [a, b] = await Promise.all([abrir(base), abrir(assinado)]);
  try {
    if (a.numPages !== b.numPages || a.numPages > 20) return { diferenca: 'paginas' };
    const acoes = await b.getJSActions();
    if (acoes && Object.keys(acoes).length) return { diferenca: 'acoes' };
    const anexos = await b.getAttachments();
    if (anexos && Object.keys(anexos).length) return { diferenca: 'acoes' };
    let widgets = 0;
    for (let i = 1; i <= a.numPages; i++) {
      const [pa, pb] = await Promise.all([a.getPage(i), b.getPage(i)]);
      const [ta, tb] = await Promise.all([pa.getTextContent(), pb.getTextContent()]);
      const texto = (t: typeof ta) => t.items.map((x) => ('str' in x ? x.str : '')).join('');
      if (texto(ta) !== texto(tb)) return { diferenca: 'texto' };
      const [oa, ob] = await Promise.all([pa.getOperatorList(), pb.getOperatorList()]);
      if (oa.fnArray.length !== ob.fnArray.length || oa.fnArray.some((f, k) => f !== ob.fnArray[k])) return { diferenca: 'operadores' };
      const [aa, ab] = await Promise.all([pa.getAnnotations(), pb.getAnnotations()]);
      const novas = ab.filter((x) => !aa.some((y) => y.id === x.id));
      for (const n of novas) {
        if (n.subtype !== 'Widget' || n.fieldType !== 'Sig' || !dentro(n.rect, area)) return { diferenca: 'anotacoes' };
        widgets++;
      }
    }
    return widgets <= 1 ? 'igual' : { diferenca: 'anotacoes' };
  } finally {
    await Promise.all([a.destroy(), b.destroy()]);
  }
}
```

- [ ] **Step 3: O ramo assíncrono** — `aceitarPdfAssinado` com `{ soCriptografia: true }` na conferência (prefixo dispensado só para o assinador do relatório que reescreve o arquivo; forma do `/ByteRange`, CMS, cadeia e titular continuam síncronos): grava o PDF enviado como `documento_assinado` pendente (`conferencia_path`, `conferencia_status = 'pendente'`) e enfileira `documento-conferir`; o job lê o base e o enviado, roda `compararConteudo` e, se `'igual'`, chama o `registrarAssinatura` (T10/T12) na transação; se diferente, apaga o enviado (`apagarArquivo` com o `naMesmaTransacao` limpando os dois campos) e grava `conferencia_status = 'recusado'` com o motivo; a tela mostra "Conferindo o PDF assinado…" e, na recusa, "Este PDF recebeu alterações além da assinatura. Baixe o PDF de novo, assine sem editar e envie.". Meta do job: 30 s (p95) (RNF-140 v0.3).

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos src/modules/pacientes/exportacao.test.ts` → PASS.

```bash
git add src/modules/documentos src/jobs/queues.ts src/worker/index.ts package.json pnpm-lock.yaml drizzle src/db/schema/documentos.ts src/modules/pacientes/exportacao.test.ts
git commit -m "feat(documentos): conferência de conteúdo assíncrona no worker para o assinador que reescreve o PDF (D16 a)"
```

---

## Runbook do Plano 10 (o dono faz; nada disto é código)

1. **PDFs reais para o spike (P-B2, T1 Step 13).** Com os dois PDFs fictícios gerados pela T1 (`base.pdf` e `base-com-campo.pdf`, enviados por canal privado): a Debby (ou o dono) assina no **assinador.iti.br** com a conta gov.br prata/ouro — (a) carimbo onde o assinador propõe, (b) dentro do quadro "Assinatura digital", (c) sem carimbo visível, se houver a opção — e, se houver e-CPF, no **Adobe Acrobat Reader** e no **Assinador SERPRO** (gratuitos); para cada arquivo, o **relatório de conformidade do VALIDAR** (validar.iti.gov.br). Os arquivos voltam para `test/assinatura/reais/` na máquina de dev (**nunca** no git: têm nome e CPF reais). Só documento fictício; nunca receita de paciente real no VALIDAR.
2. **Consulta ao CRN-3 (P-B1)** — escrita, pela Debby ou pelo dono, com: (i) o gov.br (assinatura avançada) atende o "assinatura digital certificada" das Res. 656/680 na receita? (ii) a assinatura na plataforma com 2FA + código verificador atende o parecer (D2) e (iii) o plano alimentar online (D12, Res. 760/2023, art. 10)? (iv) a identificação do cliente no documento precisa de e-mail e telefone além do nome (art. 10, I)? (v) os textos da D5 (declaração da receita e, para o Plano 13, a ressalva e a declaração do parecer). **A liberação para uso real depende da resposta** (o desenvolvimento não).
3. **Textos para a Debby revisar** (junto com o manual guiado, P08-08): a declaração da receita (D5), os textos "(proposto)" da spec v0.3 (US-143 dica do quadro; US-144 "Certificado do consultório confirmado"; US-145 paciente sem portal e arquivado), os do link (RN-158) e o guia `documentos`, `configuracoes` (v2) e `seguranca` do manual.
4. **Advogado (P-B3, junto com o E-09):** o termo do paciente e o DPA citam a entrega eletrônica de documentos (portal e link por e-mail com código), a assinatura usada e a página pública de verificação; o termo novo exige novo aceite. A D15 (justificativa na exportação do titular) é confirmada aqui.
5. **Backup no host (P02-11, etapas 6 e 8)** continua pendente: sem ele, nada de paciente real — e receita é prontuário.
6. **Cota do Resend:** o link e o código da D3 (b) somam até 2 e-mails por documento de paciente sem app (mais os reenvios). Conferir no painel do Resend se o plano atual comporta o volume da Debby (custo zero, CS-143).
7. **Deploy (merge = deploy), com o OK do dono e snapshot no hPanel antes.** As migrations 0089–0091 (ou a numeração depois do Plano 09) só criam tabelas, colunas nulas/padrão em `tenants`, trocam os CHECKs de `stored_files.tipo` e `notifications.tipo` (acrescentam valores; validação lê as duas tabelas uma vez), refazem a política `paciente_arquivos` e criam gatilhos e uma função. Nenhuma migração de dados. Nenhuma variável nova. `documentos_liberados` nasce `false`: nada aparece para a Debby até a etapa 8.
8. **Liberação para uso real** (checklist do `docs/operacao/go-live.md`, seção do Plano 10): resposta do CRN-3 arquivada; textos revistos; termo/DPA (E-09) com o novo aceite; backup no host; `ASSINATURAS_LIBERADAS` com o resultado do spike (PR curto); "Cancelar documento" no ar (D3); o admin liga "Documentos" do consultório da Debby (D20); teste manual com um PDF real assinado no gov.br da Debby, um paciente de teste com app e outro sem app (link + código), a verificação pelo QR no celular e a confirmação de recebimento.
9. **Trimestral (D7):** atualização das âncoras (`docs/operacao/ancoras-assinatura.md`) — o Claude faz a pedido do dono.

## Fechamento do plano (após a Tarefa 18, ou a 19)

- [ ] Revisão da entrega conforme o índice (revista em 02/10/2026): revisor por tarefa (ao longo) → **revisão final do branch (workflow) com uma onda de correções** → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor → backlog) → re-revisão **só do diff das correções** → `/security-review` com o **checklist reforçado** (D9):
  - **Conferência (RN-144):** forma do `/ByteRange` `[0 a b c]` com um único dicionário de assinatura e `b + c` = fim da revisão; lista fechada por alcance e comparação chave a chave dos redefinidos (fonte, stream, `/Resources`, `/MediaBox` recusados); widget só de área zero ou no quadro, `/BBox` dentro do `/Rect`; nenhuma ação/anexo; CMS com um `SignerInfo`, destacado, `messageDigest` e assinatura pelo `node:crypto`; cadeia até âncora fixada, validade de todos, certificado de pessoa (e-CNPJ, ACT, SSL recusados), CPF do campo próprio; "Assinado em" = hora do servidor; **sem rede** (guarda verde); leitor com limites (inflate, aninhamento, objetos, revisões) e nenhum 500; nada de CN/CPF no log.
  - **2FA (RN-145):** `confirmarCodigo2fa` só pela API do Better Auth; 5 tentativas em 15 min; anti-repetição de 90 s; recusa registrada no histórico; nada gravado antes do código no primeiro certificado.
  - **Banco:** `app_documento_imutavel` (todas as transições, no-op passa, anonimização só no worker), notas imutáveis, `paciente_so_emitidos`, recibo só INSERT (`paciente_recibo_proprio`, REVOKE), `document_verifications` fora da RLS só em `verificacao.ts` (guarda verde) com UPDATE só de duas colunas e DELETE revogado, `tenant_signer` e `signed_document_notes` STAFF_ONLY, `paciente_arquivos` sem o base e as fotos, FKs `NO ACTION`.
  - **Link (RN-158):** GET não consome; token sem estado com o e-mail atual no MAC; 30 dias; código HMAC por pedido, 10 min, 5 erros, 1/min e 5/h por documento, 20/h por IP, Turnstile; sessão de 15 min só com hash no banco, cookie `HttpOnly`/`SameSite=Strict` por caminho; `semConta` na lista fechada; `no-referrer`, `noindex`, `no-store`; `caminhoSeguro` com `:token`.
  - **Página pública (RN-156):** só `document_verifications`; nada do paciente; 30/h por IP; mesma resposta para inexistente e malformado; `no-referrer`, `noindex`, sem script; `/v/:codigo` no Sentry.
  - **Arquivos (regra 9):** base, assinado e fotos só por `salvarArquivo`/`apagarArquivo`; registro no `registrar`/`naMesmaTransacao`; base solto no mesmo UPDATE da assinatura; varredura de órfãos; PDFs e a digitalizada só no worker (grafo verde); digitalizada nunca entrega o arquivo enviado.
  - **LGPD (D1, se aprovada):** exportações com e sem rascunho, justificativa só onde a D15 manda, nunca o motivo de cancelamento; anonimização pela função antes dos anexos, conferência final, verificação "eliminado".
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema Critical/Important confirmado, parar e avisar o dono.
- [ ] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): P10-01 a P10-19 (com o PR); os Minor da revisão num item "P10-20 — débitos do Plano 10".
- [ ] Atualizar a spec de documentos assinados para a **v0.4** (o que este plano mudou: os "Desvios conscientes" acima, as decisões ★ tomadas pelo dono, o resultado do spike — onde fica o CPF no gov.br, campo pré-criado, `ASSINATURAS_LIBERADAS` — e a tabela "Textos de interface do Plano 10") e a spec do MVP onde ela cita documentos (§4.1: a escrita nova do paciente e o contexto `semConta` do link; §7: as tabelas novas; RNF-10: as telas novas no axe).
- [ ] Atualizar os **dois manuais** (memória do projeto): o do usuário (Claude Docs, "NutriDebby — Manual do sistema", seção "Documentos assinados e receita") e o técnico (`docs/manual-tecnico/`, módulo `documentos`, a conferência, as tabelas, o runbook).
- [ ] Anotar para os próximos planos (no backlog): **Plano 13** — parecer (US-141), retificar (US-148), a parte da US-150 do parecer, a D2 (com a resposta do CRN-3), o CHECK de `tipo` com `'parecer'` e `exam_ids`, e a US-149 se a D3 não subiu; **Plano 12** — "Exames" no portal pede o "Mais" na barra (D5); a revogação lida do próprio PDF e o cache de LCRs (backlog da spec); D12 (plano alimentar com código e confirmação) se o CRN-3 exigir.
- [ ] Lembrar o dono: backup no host (P02-11) pendente; liberação para uso real só pelo checklist (runbook, etapa 8); merge (= deploy) só com OK explícito e snapshot no hPanel antes.

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec v0.3**

| Requisito | Onde |
|---|---|
| US-140 (perfil, habilitação D6, perfil incompleto bloqueia, cópia congelada) | Tarefas 4 (perfil, Fitoterapia, auditoria), 6 (`copiaDoPerfil` no preparo) e 7 ("Completar perfil") |
| US-142 (tipos de item, unidades, chá, fitoterápico sem habilitação, derivado vegetal D13, justificativa fora do PDF, bloqueado, arquivado D14) | Tarefas 6 (`prescricao.ts`, `documentos.ts`) e 7 (editor) |
| US-143 (declaração D5, PDF com marca, carimbo, quadro, código e QR, voltar a editar, falha do PDF) | Tarefas 6 (preparar, voltar), 7 (tela, "Gerar o PDF de novo") e 8 (worker) |
| US-144 (assinatura aceita, primeiro certificado, outra pessoa, sem 2FA, todas as recusas, digitalizada) | Tarefas 5 (2FA), 9 (conferência), 10 (envio) e 11 (digitalizada) |
| US-145 (entrega com e sem portal, D3 a/b, D4, arquivado) | Tarefas 12 (entrega, token, pessoalmente), 13 (portal) e 14 (link) |
| US-146 (lista, abrir, confirmar, situações, vazio, fora do offline) | Tarefa 13 (o service worker não muda) |
| US-147 (válido, ITI, cancelado/eliminado, não encontrado, abuso) | Tarefa 15 (+ T17 para cancelado, T16 para eliminado) |
| US-149 (★ D3) e US-150 base (★ D1) | Tarefas 17 e 16 |
| RN-140/RN-141 (imutabilidade, transições, ordem de operações, FK NO ACTION) | Tarefas 3 (gatilhos, função), 6 (voltar), 10 (assinar), 16 (anonimizar) |
| RN-142/RN-143 (código, SHA-256) | Tarefas 6, 8, 10, 15 |
| RN-144 (toda a conferência) | Tarefas 1 (leitor, âncoras, fábrica) e 9; T19 se o spike pedir |
| RN-145 (2FA, nome, CPF HMAC, troca) | Tarefas 4, 5 e 10 |
| RN-149/RN-150/RN-151 | Tarefa 6 (sem campo de marca) |
| RN-152/RN-153/RN-154 | Tarefas 12, 13, 6 |
| RN-156/RN-157/RN-158 | Tarefas 15, 11, 12 e 14 |
| RNF-140 a RNF-145 | T8 (30 s), T9 (3 s, sem rede, limites), T10/T11 (rotas), T14/T15 (Sentry), T16 (cota), T18 (axe), Tech Stack (custo) |
| Manual guiado (toda tela nova do painel com guia; `/conta/seguranca`) | Tarefas 4 (`configuracoes` v2), 5 (`seguranca`), 7 (`documentos`, `ROTAS_DO_PAINEL`) e 18 (fechamento) |

**2. Placeholders:** os PEM das âncoras (`ancoras-raizes.ts`, T1 Step 7) são dado público baixado no próprio passo (não cabem no plano) e a guarda `ancoras-fonte.test.ts` reprova o arquivo incompleto; o resto dos passos de código traz o código. Os trechos em prosa são trocas mecânicas em arquivos existentes (uma entrada numa lista, um import, uma linha num menu) com o texto exato, ou repetem um esqueleto já escrito no plano (as rotas da T11 e da T14 seguem a rota da T10, citada).

**3. Consistência de nomes:** `AREA_ASSINATURA`/`CAMPO_PRE_CRIADO` (T1) em T8 e T9; `lerBase`/`lerAtualizacao`/`PdfIlegivelError` (T1) em T9 e T11; `RecusaAssinaturaError`/`MSG_RECUSA`/`CodigoRecusa` (T2) em T9–T11; `documentoNoBanco`/`codigoAleatorio` (T2) e `novoConsultorio`/`outroDocumento` (T10) em T11–T17; `confirmarCodigo2fa` (T5) em T10 e T11; `copiaDoPerfil`/`gravarAssinante`/`hmacDoCpf` (T4) em T6 e T10; `validarRascunho`/`validarParaPreparar`/`descreverItem`/`ConteudoReceita` (T6) em T7, T8, T16; `lerDocumentoNaTransacao`/`dataHora`/`ItemLista` (T6/T7) em T8 e T12; `registrarAssinatura` (T10, com `appUrl` na T12) em T11 e T19; `registrarVerificacao`/`mudarSituacao` (T10) em T15 e T17; `assinarLinkDocumento`/`lerLinkDocumento` (T12) em T14 e T17; `registrarRecibo` (T12) em T13 e T14; `ASSINATURAS_LIBERADAS` (T9) em T10.

**4. Review Focus:** 1 (PDF que mostra outra coisa) → T9 (`it.each` das adulterações: FreeText, Stamp, stream e fonte redefinidos, `/Resources`, `/MediaBox`, widget sobre a dose, `/BBox`, duas assinaturas, `/ByteRange` curto, ISA, lixo); 2 (certificado errado) → T9 (vencido, e-CNPJ, sem uso, raiz desconhecida, SHA-1) e T10 (primeiro de outra pessoa, CPF diferente, nada gravado); 3 (2FA no limite) → T5 (5 erros → bloqueado, repetição, espaço) e T10 (tentativa registrada, sem 2FA antes da conferência); 4 (link na caixa errada) → T14 (GET não consome, e-mail corrigido, limites, código reusado, cancelado, sessão de outro link); 5 (campos da receita) → T6 (UFC/U, 21 itens, 11 componentes, 0 e 1e9, 301 caracteres, habilitação retirada entre salvar e preparar, derivado sem habilitação).

## Decisões para o dono

As marcadas com ★ na tabela "Decisões de desenho". Recomendação entre parênteses; o custo e a consequência de cada alternativa estão na tabela.

1. **D1 ★ — LGPD da receita no Plano 10** (sim: exportação, bloqueio e anonimização; +~1 dia). Alternativa: só no Plano 13, e o uso real espera.
2. **D2 ★ — esquema completo no Plano 10** (sim: os 6 estados e o gatilho inteiro agora, sem custo a mais). Alternativa: o Plano 13 reescreve o gatilho com receitas reais no banco.
3. **D3 ★ — "Cancelar documento" no Plano 10** (sim: US-149 sobe; +~meio dia). Alternativa: uso real só depois do Plano 13.
4. **D4 ★ — digitalizada só por fotos** (sim: o worker monta o PDF; sem conteúdo ativo). Alternativa: aceitar PDF e rasterizar (`pdfjs-dist` + `@napi-rs/canvas`).
5. **D5 ★ — "Documentos" no portal por cartão no Início + link em Perfil** (sim; a barra de 7 abas não muda). Alternativas: trocar uma aba, ou um "Mais".
6. **D6 ★ — link da D3 (b) por 30 dias com "Reenviar link"** (sim). Alternativa: sem prazo.
7. **D7 ★ — âncoras atualizadas a cada trimestre pelo Claude, a pedido** (sim; alarme 180 dias antes de vencer). Alternativas: o dono roda o script; ou só quando houver recusa.
8. **D8 ★ (só se o spike mostrar gov.br sem CPF em campo próprio) — gov.br pelo nome + número de série do certificado, com 2FA a cada certificado novo** (sim). Alternativa: só ICP-Brasil e digitalizada.
9. **D9 ★ — `/security-review` com o checklist reforçado** (sim; sem custo).

Pontos que precisam de atenção (não são decisões):
- **Os PDFs reais assinados (runbook, etapa 1)** destravam a Tarefa 9 para uso real: sem eles, o gov.br e a opção C ficam desligados (`ASSINATURAS_LIBERADAS`) e só a digitalizada funciona.
- **A consulta ao CRN-3 (P-B1)** não bloqueia o desenvolvimento, mas bloqueia a liberação; a D2 (parecer) e a D12 (plano alimentar online) dependem da mesma resposta.
- **Backup no host (P02-11)** segue pendente: sem ele, nada de paciente real.
- **O Plano 09 (fechamento do MVP) vem antes** no roadmap: se ele trouxer migration, este plano renumera as suas (0089 em diante) no rebase.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa com as lentes spec/qualidade e segurança/LGPD, revisão final do branch no fim) — as 18 tarefas (19 com o ramo condicional) dependem umas das outras por interfaces bem definidas (o leitor da T1 decide a T9; o `registrarAssinatura` da T10 é o mesmo da digitalizada e da entrega), e uma falha na conferência da assinatura (aceitar um PDF adulterado) ou no gatilho de imutabilidade é cara de desfazer com receitas reais em produção. As Tarefas 4, 5 e 6 podem correr em paralelo depois da 3, e as 13, 14 e 15 depois da 12, em worktrees, como nos Planos 06–08. A Tarefa 1 tem um checkpoint do dono (os PDFs reais) que não bloqueia as Tarefas 2–8.

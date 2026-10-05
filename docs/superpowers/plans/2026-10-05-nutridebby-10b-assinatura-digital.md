# Plano 10B — Assinatura gov.br e ICP-Brasil (F3-06, parte do certificado): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Aprovado pelo dono em 05/10/2026** (decisões ★ D1 a D9 do Plano 10 aprovadas como recomendadas; D7, D8 e a parte da D9 sobre a conferência ficam aqui). O plano único (`2026-10-05-nutridebby-10-receita.md`, 19 tarefas) foi dividido no [**Plano 10A — Receita**](2026-10-05-nutridebby-10a-receita.md) (base de documentos + receita com assinatura digitalizada, sem nada deste plano) e neste **Plano 10B**, que acrescenta a assinatura **gov.br (B)** e **ICP-Brasil (C)** pelo envio do PDF assinado, conferida no servidor sem rede. **Depende do Plano 10A** (na `main` ou na branch) e, para o uso real, dos **PDFs reais assinados do dono** (runbook, passo 1). Escrito a partir do plano único e da spec de documentos assinados **v0.3.1**; aplicados os Minors das revisões que valem para o 10B (seção "Minors das revisões"). Nenhuma linha de código foi escrita; nada foi rodado no banco.

**Goal:** A nutricionista assina o PDF preparado (Plano 10A) no assinador do gov.br ou com o seu certificado ICP-Brasil e envia o arquivo de volta; o sistema confere a assinatura sem rede e sem serviço pago (prefixo intacto, atualização incremental dentro de uma lista fechada, CMS, cadeia até âncora fixada, validade e titular), confirma o primeiro certificado — e a troca dele — com o código do 2FA, e leva o documento a "assinado" pelo mesmo `registrarAssinatura` do 10A (verificação pública, entrega e recebimento iguais aos da digitalizada).

**Architecture:** Os arquivos novos de `src/modules/documentos` são a conferência (`pdf-leitor.ts` + `pdf-escrita.ts`, leitor **limitado** à atualização incremental; `pdf-atualizacao.ts`, lista fechada por alcance; `cms.ts` e `certificados.ts`, toda a criptografia pelo `node:crypto`; `ancoras*`, raízes fixadas no repositório; `assinatura-pades.ts`, a conferência inteira), o assinante do consultório (`assinante.ts` + tabela `tenant_signer`, STAFF_ONLY) e o envio (`assinar.ts` + Route Handler `/api/painel/documentos/[id]/assinado`, que confere em ≤ 3 s e, no `registrar` do `salvarArquivo`, chama o `registrarAssinatura` do 10A). Duas migrations (0092–0093): `tenant_signer` e os CHECKs de `assinatura_tipo` com `'govbr'` e `'icp'` (sem migração de dados: a tabela de documentos e o PDF preparado já são os do 10A, D22). A Tarefa 2 (relatório do spike) decide o campo pré-criado, a liberação de cada assinador e, se for o caso, a Tarefa 6 (conferência assíncrona no worker).

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 · PostgreSQL 16 · Drizzle 0.45 · `node:crypto` (RSA PKCS#1 e PSS, ECDSA inclusive brainpool, Ed25519) · **novos:** `pkijs` 3.4 + `asn1js` 3.0 (BSD-3, só leitura de ASN.1) e, só em desenvolvimento, `@peculiar/x509` 2.1 + `reflect-metadata` (AC de teste). Só se a D16 da spec entrar pelo spike: `pdfjs-dist` 6.4 no worker (Tarefa 6).

**Spec:** [`../specs/2026-10-03-nutridebby-documentos-assinados-design.md`](../specs/2026-10-03-nutridebby-documentos-assinados-design.md) (**v0.3.1**: §2.3 e a divisão 10A/10B, §3.4 D1, US-144 (envio do PDF assinado, primeiro certificado, recusas), US-147 (link do ITI), RN-144 inteira, RN-145 (CPF, nome, troca), RNF-141, INT-B1, P-B2, §10 `tenant_signer`, "Decisões do Plano 10 (aprovadas em 05/10/2026)"). Pesquisas da preparação (fora do git): `.superpowers/sdd/2026-10-05-nutridebby-10-preparacao/` (`pesquisa-assinatura.md` §3, §6–§9, `revisao-seguranca-normas.md`). Plano 10A: [`2026-10-05-nutridebby-10a-receita.md`](2026-10-05-nutridebby-10a-receita.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P10B-01 a P10B-07).

## Global Constraints

- Tudo do Plano 10A continua valendo (Global Constraints de lá: Planos 01–08, regras do CLAUDE.md, visual V2, acessibilidade, custo zero, regras do servidor, política de revisão, liberação para uso real pelo interruptor `documentos_liberados`).
- **Depende do Plano 10A:** `constantes.ts` (`AREA_ASSINATURA`, `TOLERANCIA_AREA_PT`, `AreaAssinatura`), `erros.ts`, `registrar-assinatura.ts` (`registrarAssinatura`, `exigirHabilitacaoAtual`, `AcessoAssinatura`, `DepsAssinar`, `VersaoLida`), `confirmar-2fa.ts`, `verificacao.ts`, o PDF preparado (`documento-pdf-job.ts`), a página do documento e os ajudantes de teste (`test/documentos.ts`). Nada do 10A importa o 10B; o 10B importa o 10A, nunca o contrário (o worker continua sem sessão).
- **Migrations:** `0092_assinatura_certificado` (gerada, T3) e `0093_rls_tenant_signer` (custom, T3); `0094`/`0095` só com a Tarefa 6. Se o Plano 09 ou outro plano entrar na `main` antes com migration, renumerar no rebase. Migrations só com `DATABASE_URL_MIGRATOR`; nunca no banco de dev compartilhado sem combinar, nunca em produção fora do deploy.
- **Conferência sem rede (RN-144):** nada de `fetch`, `http`, `https`, LCR, OCSP nem `caIssuers` na conferência; guarda de teste `sem-rede.test.ts` (T4). A conferência (CPU, até 3 s) roda **fora** de transação; a verificação do código do 2FA também.
- **Nunca erro 500 na conferência:** todo erro do leitor, do CMS, da cadeia ou do titular vira `RecusaAssinaturaError` com código fixo e `motivoTecnico` fixo; `err.message` do `pkijs`/`asn1js`/leitor nunca vai ao logger (T4, Minor 3).
- RNF-142 / CLAUDE.md regra 3: nada de CN do certificado, CPF, número de série, conteúdo, código de verificação ou caminho de arquivo em log/Sentry; logs só com ids, motivo fixo e o nome do erro. O "Assinado por" público nunca leva dígitos (T4, Minor 5).
- **`ASSINATURAS_LIBERADAS`** (T4): cada conjunto (`govbr`, `icp`) só é aceito depois de um PDF **real** dele passar na conferência (Tarefa 4, Step 7); até lá, "Tipo de assinatura não aceito" e a digitalizada do 10A continua sendo a forma de assinar.
- **PDFs reais** (nome e CPF de verdade) só em `test/assinatura/reais/` na máquina de dev, **nunca** no git (`.gitignore`, T1); só documento fictício no VALIDAR.
- Textos de interface: os da US-144 (texto exato da spec v0.3.1) e os novos deste plano na tabela de desvios; os do gov.br e do certificado só aparecem nas telas a partir da Tarefa 5.
- `/security-review` com o checklist reforçado da conferência (D9 ★, fechamento).

### Decisões de desenho

As marcadas com ★ foram **aprovadas pelo dono em 05/10/2026, como recomendadas**. Numeração do plano único (as outras estão no Plano 10A).

| # | Tema | Decisão (aplicada no plano) | Consequência |
|---|---|---|---|
| D7 ★ | Âncoras de confiança (INT-B1) | **Aprovada pelo dono em 05/10/2026.** As raízes e as ~180 ACs do ITI e a cadeia gov.br ficam versionadas no repositório; **atualização trimestral feita pelo Claude a pedido do dono** (`pnpm certs:ancoras` + PR revisado), com teste que falha **180 dias** antes de qualquer âncora vencer e item em `docs/operacao/ancoras-assinatura.md` (T1). As impressões digitais das raízes são conferidas por HTTPS numa página do ITI, com a URL e a data no `fonte.json` (Minor 7) | Compromisso recorrente (~30 min por trimestre) |
| D8 ★ (condicional) | Certificado gov.br sem CPF em campo próprio | **Aprovada pelo dono em 05/10/2026, opção (a):** se o spike (T2) mostrar que o certificado gov.br **não** traz o CPF num campo próprio, a RN-145 do gov.br é pelo nome completo + o **número de série do certificado** (`Titular { tipo: 'serie' }`, T3 e T5); como a série muda a cada renovação anual, a nutricionista confirma com o 2FA a cada certificado novo (o mesmo caminho da troca). Com o CPF no certificado, o ramo da série não é usado | Mantém o gov.br gratuito, com uma confirmação por ano |
| D9 ★ | `/security-review` da conferência | **Aprovada pelo dono em 05/10/2026.** Com o checklist reforçado: conferência criptográfica própria, parser de PDF, assinante do consultório (fechamento) | Sem custo (assinatura) |
| D10 | Assinante do consultório | Tabela `tenant_signer` (STAFF_ONLY, RLS de tenant), não colunas em `tenants` (o `PerfilForm` `'use client'` recebe o `TenantRow` inteiro e `tenants` é lida no contexto `publico`). HMAC com chave HKDF `nutridebby:assinante:v1` do titular (`cpf:<dígitos>` ou `serie:<hex>`) + a identificação da tela (`CPF ***.456.789-**` ou `certificado gov.br de série …A1B2`) | — |
| D13 (parte do 10B) | 2FA no certificado | Código do 2FA no **primeiro** certificado do consultório e na **troca** do titular (outro CPF, ou outro certificado gov.br sem CPF, com o mesmo nome do perfil). No primeiro certificado e na troca, o arquivo é **reenviado** junto com o código (nada fica gravado antes); `gravarAssinante` faz compare-and-set | Achados I7 e Minor 7 da revisão do rascunho |
| D15 (parte do 10B) | Campo pré-criado | O campo de assinatura vazio com `/Lock` (FieldMDP, para o VALIDAR não dar "Indeterminada") só entra se o spike aprovar (`CAMPO_PRE_CRIADO`, T1/T2); o `documento-pdf-job.ts` do 10A ganha o `if` na T1 | Se o assinador do gov.br puser o carimbo onde a pessoa clica: instrução na tela + recusa com texto próprio; se o atrito for alto, a T6 |
| D16 (spec) | Conferência que não couber no leitor limitado | (a) biblioteca gratuita de parser no worker, com conferência assíncrona (Tarefa 6, condicional ao relatório da T2) | — |
| D21 (10B) | Ordem | **T1 → T3 → T4 → T5**, em série (a T4 usa os códigos de recusa da T3; a T5 usa a T3 e a T4); a **T2** (checkpoint do dono, relatório, D16, D8, `CAMPO_PRE_CRIADO`, `ASSINATURAS_LIBERADAS`) corre à parte e não bloqueia as outras; a **T6** só se o relatório da T2 pedir | — |

### Desvios conscientes da spec (registrados aqui; atualizar a spec na v0.4)

| Spec v0.3.1 | Neste plano | Motivo |
|---|---|---|
| §10 / D10 "`tenant_signer` (CPF HMAC e máscara)" | Colunas `titular_hmac` e `titular_identificacao`: o titular é o CPF **ou** o número de série do certificado gov.br (D8 (a)) | A D8 aprovada; um nome de coluna só |
| US-144 "Assinado por … (CPF ***…)" | "Assinado por {nome} ({identificação})" — `CPF ***.456.789-**` (igual à spec) ou `certificado gov.br de série …A1B2` (D8 (a)) | A D8 aprovada |
| RN-145 "troca do CPF do consultório" | A troca acontece **no próprio envio**: titular diferente do confirmado + nome do certificado igual ao `nome_profissional` copiado → a mesma confirmação, com a identificação anterior, e o código do 2FA; `gravarAssinante` faz compare-and-set (dois "primeiros" simultâneos → o segundo recebe 409), audita "Perfil profissional" e manda o e-mail de aviso. Nome diferente → "O PDF foi assinado por outra pessoa." | Sem a troca, um CPF gravado errado (D8), uma troca da `ENCRYPTION_KEY` (muda o HMAC) ou um certificado novo travariam a assinatura sem saída fora do banco de produção |
| P-B2 "tolerância de fim de linha" | Se o relatório pedir, a variação "base sem o fim de linha final" é conferida pelo hash calculado do **próprio PDF base**, que ainda está no disco em "Aguardando assinatura" — **sem coluna nova** | Documentos preparados no 10A continuam assináveis |
| Textos novos de interface | "O certificado confirmado no consultório era o de {identificação anterior}. Ao confirmar, este passa a ser o certificado do consultório." (troca, T5); e-mail "Certificado do consultório confirmado" com "O certificado com {identificação} passou a ser o do consultório para assinar documentos no NutriDebby." e "O certificado do consultório para assinar documentos no NutriDebby foi trocado: {anterior} deu lugar a {identificação}."; "Assinatura: gov.br" e "Assinatura: Certificado ICP-Brasil" no portal, na lista e na `/v`; "Arquivo do PDF assinado", "Enviar PDF assinado", "Conferindo a assinatura…", "Sim, sou eu", "Não", "Assinado por", "Validar a assinatura no validador oficial do ITI"; os guias `documentos` e `seguranca` na v2 | Telas novas do 10B |

### Minors das revisões (`revisao-cobertura.md` e `revisao-seguranca-normas.md`, 05/10/2026)

**Aplicados no 10B:** seg. 1 (geração do redefinido igual à do base, 0 nos novos, geração do cabeçalho × xref no leitor, nenhum objeto "solto" fora da xref — T1 e T4); seg. 2 (widget só com `/FT /Sig` nele ou no pai, `/BBox` de cada estado do `/AP /N`, `/AcroForm` novo só com `Fields`/`SigFlags`/`DR`/`DA`, `/Type /Page` antes do atalho do `/Fields` — T4, com variantes novas na fábrica, T1); seg. 3 (erros fora do mapa → `nao_aceito`, nunca 500 — T4); seg. 4 (`signedAttrs` pelos bytes originais, PSS sem parâmetros recusado — T4); seg. 5 (nenhum dígito no "Assinado por" — T4); seg. 6 (semáforo depois de ler o corpo e um envio por usuária — T5; o 10A fez o mesmo na rota da digitalizada); seg. 7 (raízes conferidas por HTTPS, fonte no `fonte.json` — T1); seg. 9 (habilitação conferida no envio do PDF assinado — T5, com a função do 10A); cobertura: interface `Ancoras` alinhada (T1), `deps.campoPreCriado` fora da interface (T4), `serialNumber` da fábrica pelo OID `2.5.4.5` (T1).

**Aplicados sem teste dedicado:** seg. 4 — a fábrica de teste só gera RSA PKCS#1 e ECDSA com DER canônico, então os dois ramos (bytes originais dos `signedAttrs` e PSS sem parâmetros) ficam conferidos pela revisão e pelos arquivos reais do spike (T2), não por um caso da fábrica.

**Os demais Minors** (gatilhos, link, entrega, portal, digitalizada, textos da receita) são do Plano 10A e foram aplicados lá.

## Review Focus

1. **PDF assinado que parece certo mas mostra outra coisa.** O mesmo PDF preparado com, na atualização da assinatura: uma `/FreeText` "Vitamina D3 50000 UI" sobre a dose; o widget da assinatura com `/Rect` sobre o conteúdo e um `/AP` (ou um dos estados do `/AP /N`) que pinta um retângulo branco; a fonte ou o *stream* de conteúdo da página redefinido com o mesmo número de objeto — inclusive disfarçado com `/Type /ObjStm` ou `/Type /XRef`, ou com outra geração; um objeto "solto" que a xref não lista; `/Resources` ou `/MediaBox` trocados; uma revisão depois da assinatura que não é `/DSS`; dois dicionários `/Sig`; `/ByteRange` com `b + c` antes do fim; um widget pendurado num campo de texto. Esperado: recusa "Este PDF recebeu alterações além da assinatura…" (ou "A assinatura deste PDF não confere…"), documento continua "Aguardando assinatura", nada gravado. E o contrário: o PDF real do react-pdf (Catálogo com `/Names`) com uma assinatura limpa, com ou sem a revisão de longo prazo só com `/DSS`, **aceito**. Também: um PDF de 10 MB feito para inflar gigabytes recusado em menos de 3 s, sem parar o app. Testes na Tarefa 4 (fixtures da Tarefa 1).
2. **Certificado errado na hora certa.** e-CPF vencido (o A1 que ficou com o contador), e-CNPJ da clínica, certificado de outra pessoa no primeiro envio e depois dele, cadeia que termina numa raiz desconhecida, raiz ICP v7 (algoritmo não lido), SHA-1, CN com o CPF no texto, um ASN.1 estranho que faria o `pkijs` lançar `TypeError`. Esperado: a mensagem certa da US-144 para cada um; nenhum titular gravado no primeiro envio recusado; o CN e o CPF nunca no log nem na `/v`; nenhum 500. Testes nas Tarefas 4 e 5.
3. **Primeiro certificado e troca com o 2FA.** Código errado, 5 erros e o bloqueio; o mesmo código duas vezes; um certificado novo com o mesmo nome (troca); um gov.br sem CPF e a renovação anual dele (D8 (a)); dois "primeiros" envios ao mesmo tempo. Esperado: confirmação com a identificação certa (e a anterior, na troca), recusa registrada no histórico, compare-and-set (o segundo recebe 409), e-mail de aviso, nada gravado antes do código. Testes nas Tarefas 3 e 5.
4. **O documento muda por baixo do envio.** "Voltar a editar" e um novo preparo noutra aba entre a conferência e o registrar; a habilitação em Fitoterapia retirada entre o preparo e o envio. Esperado: 409 e nada muda (o PDF antigo nunca assina o conteúdo novo); recusa "sem_habilitacao" antes da conferência. Testes na Tarefa 5.
5. **A rota sob carga.** Dois envios lentos (60 s de corpo) de consultórios diferentes; três envios de uma só usuária ao mesmo tempo. Esperado: as vagas da conferência só são ocupadas depois de o corpo chegar; a segunda e a terceira da mesma usuária recebem 429. Teste no `route.test.ts` da Tarefa 5.

---

## Estrutura de arquivos

```
drizzle/
  0092_assinatura_certificado (gerada: tenant_signer, CHECKs de assinatura_tipo com 'govbr' e 'icp')                     # T3
  0093_rls_tenant_signer (custom: app_enable_tenant_rls, app_enable_staff_only)                                         # T3
  0094_conferencia_assincrona · 0095_gatilho_conferencia                                                                # T6 (condicional)
src/db/schema/documentos.ts (tenantSigner, CHECKs) · src/db/rls-guard.ts (STAFF_ONLY) · src/db/documentos-schema.test.ts   # T3
src/modules/documentos/
  constantes.ts (+ CAMPO_PRE_CRIADO, MAX_ENVIO_BYTES, LIMITE_CONFERENCIA_MS, ASSINATURAS_LIBERADAS; TipoAssinatura e ROTULO_ASSINATURA ampliados)  # T1, T3, T4
  erros.ts (códigos e mensagens da conferência)                                                                        # T3
  pdf-leitor.ts (+test) · pdf-escrita.ts · campo-assinatura.ts                                                          # T1
  ancoras/{dados.ts, fonte.json} · ancoras.ts · ancoras-raizes.ts · ancoras-fonte.test.ts                               # T1
  assinante.ts (+test)                                                                                                  # T3
  pdf-atualizacao.ts · cms.ts · certificados.ts · assinatura-pades.ts (+test) · sem-rede.test.ts (+ sem-rede.fixture.ts) # T4
  assinar.ts (+test)                                                                                                    # T5
  documento-pdf-job.ts (+test) · digitalizada-job.test.ts (do 10A: campo pré-criado e premissa do leitor)               # T1
  verificacao.ts (link do ITI) · verificacao-publica.test.ts · portal.test.ts (do 10A: o caso do gov.br)                # T5
  conferencia-visual-job.ts (+test)                                                                                     # T6 (condicional)
src/app/api/painel/documentos/[id]/assinado/route.ts (+test)                                                            # T5
src/app/painel/pacientes/[id]/documentos/[docId]/{page.tsx, enviar-assinado.tsx}                                       # T5
src/app/v/[codigo]/page.tsx                                                                                             # T5
src/modules/ajuda/conteudo.ts (documentos v2, seguranca v2)                                                             # T5
src/email/{types.ts, templates.tsx} (certificado_confirmado)                                                           # T5
scripts/certs/{gerar-ancoras.ts, relatorio-pdf.ts, pdf-de-teste.tsx}                                                    # T1
test/assinatura/{base-minimo.ts, fabrica.ts} · test/isolamento.test.ts (tenant_signer)                                  # T1, T3
docs/operacao/ancoras-assinatura.md (T1) · docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md (T2)    # T1, T2
package.json · .gitignore                                                                                               # T1
```

**Ordem e dependências:** ver D21 (10B). A Tarefa 1 entrega o leitor e a fábrica usados pelas Tarefas 4 e 5; o relatório do spike (Tarefa 2) decide `CAMPO_PRE_CRIADO`, a tolerância do fim de linha (T4), onde fica o CPF do gov.br (T4, D8), `ASSINATURAS_LIBERADAS` e se a T6 entra.

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// src/modules/documentos/pdf-leitor.ts (T1)
export type PdfValor = number | boolean | null | PdfNome | PdfTexto | PdfRef | PdfValor[] | PdfDict | PdfStream;
export function lerBase(arquivo: Buffer, orc?: Orcamento): BaseLida;
export function lerAtualizacao(arquivo: Buffer, inicio: number, orc?: Orcamento): Revisao[];    // revisões depois do prefixo
// src/modules/documentos/ancoras.ts (T1)
export type Ancoras = { raizesIcp: X509Certificate[]; acsIcp: X509Certificate[]; govbr: { raiz: X509Certificate; intermediaria: X509Certificate; final: X509Certificate } };
// src/modules/documentos/assinante.ts (T3)
export type Titular = { tipo: 'cpf'; cpf: string } | { tipo: 'serie'; serie: string };
export function gravarAssinante(tx: Tx, a: { tenantId: string; titular: Titular; userId: string; agora: Date; anterior: string | null }): Promise<void>;
// src/modules/documentos/assinatura-pades.ts (T4)
export function conferirPdfAssinado(arquivo: Buffer, base: BaseDoDocumento, deps?: { ancoras?: Ancoras; agora?: Date; limiteMs?: number }): Conferido; // lança RecusaAssinaturaError
export type Conferido = { tipo: 'govbr' | 'icp'; emissor: string; titularNome: string; cpf: string | null; serie: string; sha256: string };
// src/modules/documentos/assinar.ts (T5)
export function aceitarPdfAssinado(a: AcessoAssinatura, docId: string, arquivo: Buffer, input: { codigo2fa?: unknown }, deps: DepsEnvio): Promise<ResultadoEnvio>;
// do Plano 10A (registrar-assinatura.ts): registrarAssinatura, exigirHabilitacaoAtual, AcessoAssinatura, DepsAssinar, VersaoLida
```

### Task 1: Spike da conferência da assinatura — âncoras, leitor limitado, fábrica de PDFs assinados de teste e o campo pré-criado no PDF do 10A (P-B2, D16 da spec, D7; P10B-01; antiga T1a)

> **Divisão do Plano 10B (05/10/2026):** esta tarefa era a 1a do plano único. Ela não destrava mais nada do Plano 10A (que roda sem leitor, sem âncoras e sem `pkijs`); destrava a conferência (T4). O checkpoint do dono, o relatório do spike e o que ele decide — `CAMPO_PRE_CRIADO`, a D16, `ASSINATURAS_LIBERADAS`, a D8 — são a **Tarefa 2**, que não bloqueia as Tarefas 3 a 5. `constantes.ts`, `AREA_ASSINATURA` e o PDF preparado já existem (10A-T1 e 10A-T7).

**Objetivo do spike:** responder, com código que fica no repositório, às perguntas da P-B2 antes de escrever a conferência (T4): (1) o leitor limitado lê as atualizações incrementais reais (tabela clássica, *xref stream*, `/ObjStm`)? (2) o gov.br e os programas ICP preservam o PDF preparado como prefixo? (3) que objetos cada um põe na atualização (para a lista fechada da RN-144 (5))? (4) onde fica o CPF no certificado gov.br? (5) o assinador usa o campo pré-criado (FieldMDP) e o VALIDAR aprova? (6) o carimbo visível cabe no quadro "Assinatura digital"? (7) há tolerância de fim de linha depois do `%%EOF`? A saída da 1a é o código (leitor, âncoras, fábrica, scripts do relatório e do PDF de teste); a da **1b** é o relatório `docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md` (sem nome nem CPF) e a decisão da D16 da spec registrada nele: **leitor síncrono** (T4 como está) ou **plano B** (T6 entra).

**Files:**
- Create: `src/modules/documentos/pdf-leitor.ts`, `src/modules/documentos/pdf-leitor.test.ts`, `src/modules/documentos/pdf-escrita.ts`, `src/modules/documentos/campo-assinatura.ts`, `src/modules/documentos/ancoras.ts`, `src/modules/documentos/ancoras-raizes.ts`, `src/modules/documentos/ancoras/dados.ts` (gerado), `src/modules/documentos/ancoras/fonte.json` (gerado), `src/modules/documentos/ancoras-fonte.test.ts`, `scripts/certs/gerar-ancoras.ts`, `scripts/certs/relatorio-pdf.ts`, `scripts/certs/pdf-de-teste.tsx`, `test/assinatura/base-minimo.ts`, `test/assinatura/fabrica.ts`, `docs/operacao/ancoras-assinatura.md` (o relatório do spike é da Tarefa 2)
- Modify: `package.json` (dependências e scripts `certs:ancoras`, `assinatura:relatorio`, `assinatura:pdf-teste`), `.gitignore` (`test/assinatura/reais/`), `src/modules/documentos/constantes.ts` (10A-T1: acrescenta `CAMPO_PRE_CRIADO`), `src/modules/documentos/documento-pdf-job.ts` + `documento-pdf-job.test.ts` (10A-T7: o campo pré-criado e a premissa do leitor), `src/modules/documentos/digitalizada-job.test.ts` (10A-T9: o PDF da digitalizada lido pelo leitor)

**Interfaces:**
- Consumes: o Plano 10A na `main` (ou na branch): `AreaAssinatura`, `AREA_ASSINATURA`, `TOLERANCIA_AREA_PT` (10A-T1, `constantes.ts`); `gerarPdfDoDocumento` (10A-T7); `montarPdfDigitalizado`, `receberDigitalizada` (10A-T9); `novoConsultorio`, `outroDocumento` (10A-T8, testes); `@react-pdf/renderer` e `qrcode` (já instalados) no script do PDF de teste.
- Produces:
  - `constantes.ts`: `CAMPO_PRE_CRIADO` (boolean decidido pelo relatório; começa `false`). `AREA_ASSINATURA`, `TOLERANCIA_AREA_PT` e `AreaAssinatura` já vêm do 10A-T1.
  - `pdf-leitor.ts`: tipos `PdfValor`, `PdfNome { n }`, `PdfTexto { s: Buffer; hex: boolean }`, `PdfRef { num; gen }`, `PdfDict { d: Map<string, PdfValor> }`, `PdfStream { dict: PdfDict; dados: Buffer; inicio: number }`, `ObjetoLido { num; gen; valor; offset: number | null; objStm: number | null }`, `Revisao { inicio; fim; xrefOffset; trailer: PdfDict; objetos: Map<number, ObjetoLido>; xrefStream: boolean }`, `BaseLida { objetos: Map<number, ObjetoLido>; trailer: PdfDict; startxref: number; tamanho: number }`; funções `lerBase(buf: Buffer, orc?: Orcamento): BaseLida`, `lerAtualizacao(buf: Buffer, inicio: number, orc?: Orcamento): Revisao[]`, `Orcamento`, `novoOrcamento(ms?)`, `verificarPrazo(orc)` (orçamento total de inflate de 32 MB, no máximo 16 /ObjStm por revisão e prazo conferido dentro dos laços, RNF-141), `pegar(d: PdfDict, chave: string): PdfValor | undefined`, `nomeDe(v): string | null`, `ehDict`, `ehRef`, `ehStream`, `ehNome`, `iguais(a, b): boolean` (comparação estrutural), `percorrer(v, visita)`; erro `PdfIlegivelError { motivo }`; `LIMITES_LEITOR`.
  - `pdf-escrita.ts`: `serializar(v: PdfValor): Buffer`, `nome(n)`, `dict(o)`, `ref(num, gen?)`, `texto(s)`, `hex(buf)`, `escreverAtualizacao(anterior: Buffer, e: { prev: number; size: number; trailer: Record<string, PdfValor>; objetos: { num: number; corpo: Buffer }[] }): Buffer`.
  - `campo-assinatura.ts`: `acrescentarCampoDeAssinatura(pdf: Buffer, area: AreaAssinatura): Buffer` (atualização incremental com o campo vazio e `/Lock`; usado pela 10A-T7 só se `CAMPO_PRE_CRIADO`).
  - `ancoras.ts`: `RAIZES_FIXADAS: Record<string, string>` (nome → SHA-256), `carregarAncoras(): Ancoras` com `Ancoras = { raizesIcp: X509Certificate[]; acsIcp: X509Certificate[]; govbr: { raiz: X509Certificate; intermediaria: X509Certificate; final: X509Certificate } }` (interface alinhada ao código — Minor da revisão de cobertura: o rascunho dizia `{ raizes; acs; govbr; conjunto() }`; o conjunto alcançado sai de `cadeiaAte`, T4).
  - `test/assinatura/base-minimo.ts`: `baseMinimo(texto?, { names? })` (Catálogo com `/Names`, como o pdfkit), `baseComRecursos()` + `OBJ` (logo e `/FontFile2`), `revisaoComXrefStream(...)`, `objStmCheio(...)`.
  - `test/assinatura/fabrica.ts`: `criarAc(o?)`, `criarTitular(ac, o)`, `assinarDeTeste(base, titular, o?)`, `pdfBaseDeTeste()`, tipos `AcDeTeste`, `TitularDeTeste`, `OpcoesAssinatura` (variantes válidas e adulteradas da §9.2 da pesquisa).

- [ ] **Step 1: Dependências e `.gitignore`**

```bash
pnpm add pkijs@3.4.1 asn1js@3.0.10
pnpm add -D @peculiar/x509@2.1.0 reflect-metadata@0.2.2
printf '\n# P-B2: PDFs reais assinados (nome e CPF de verdade) — só na máquina de dev\ntest/assinatura/reais/\n' >> .gitignore
```

Em `package.json`, `scripts`: `"certs:ancoras": "tsx scripts/certs/gerar-ancoras.ts"`, `"assinatura:relatorio": "tsx scripts/certs/relatorio-pdf.ts"`, `"assinatura:pdf-teste": "tsx scripts/certs/pdf-de-teste.tsx"`.

- [ ] **Step 2: O interruptor do campo pré-criado** — acrescentar a `src/modules/documentos/constantes.ts` (10A-T1; o arquivo continua sem imports)

```ts
/**
 * §6.5 da pesquisa / INT-B1 "VALIDAR e DocMDP": o PDF preparado ganha um campo de assinatura vazio com /Lock (FieldMDP)?
 * Decidido pelo relatório do spike (Tarefa 2): true só se o gov.br e os programas ICP testados usarem o campo e o VALIDAR
 * aprovar. Mudar aqui muda o PDF base (10A-T7) e a lista fechada aceita o campo pré-criado (T4).
 */
export const CAMPO_PRE_CRIADO = false;
```

- [ ] **Step 3: PDF base mínimo para os testes do leitor** — `test/assinatura/base-minimo.ts`

```ts
import { deflateSync } from 'node:zlib';

/**
 * PDF-1.3 de uma página, xref clássica, sem /ObjStm — a forma do que o @react-pdf gera (pesquisa §8) — escrito à mão para
 * os testes do leitor serem rápidos e determinísticos. Objetos: 1 Catalog, 2 Pages, 3 Page, 4 Contents, 5 Font, 6 Info.
 * O Catálogo tem /Names << /Dests … >>, como o do pdfkit 0.20.1 (dependência do @react-pdf/renderer 4.9; pdfkit.js
 * 7021-7028 cria o Catálogo SEMPRE com /Names): sem isso, os testes não pegariam uma conferência que recusa todo PDF
 * real (revisão do rascunho, Critical). `names: false` só para o teste de /Names acrescentado.
 */
export function baseMinimo(textoDaDose = 'Vitamina D3 2000 UI', o: { names?: boolean } = {}): Buffer {
  const conteudo = `BT /F1 12 Tf 72 720 Td (${textoDaDose}) Tj ET`;
  return montar([
    o.names === false ? '<< /Type /Catalog /Pages 2 0 R >>' : '<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Producer (NutriDebby) >>',
  ]);
}

/**
 * O base com os streams que um PDF real do react-pdf tem: logo (7, XObject /Image) e fonte embutida (5 → 8
 * /FontDescriptor → 9 /FontFile2). Para os testes de stream do base redefinido disfarçado de /ObjStm ou /XRef (T4).
 */
export const OBJ = { conteudo: 4, logo: 7, fontFile: 9 } as const;
export function baseComRecursos(): Buffer {
  const conteudo = 'q 60 0 0 30 72 760 cm /Im1 Do Q BT /F1 12 Tf 72 720 Td (Vitamina D3 2000 UI) Tj ET';
  const fonte = 'A'.repeat(64);
  return montar([
    '<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /TrueType /BaseFont /FonteTeste /FirstChar 32 /LastChar 32 /Widths [250] /FontDescriptor 8 0 R >>',
    '<< /Producer (NutriDebby) >>',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream',
    '<< /Type /FontDescriptor /FontName /FonteTeste /Flags 32 /FontBBox [0 0 500 700] /ItalicAngle 0 /Ascent 700 /Descent 0 /CapHeight 700 /StemV 80 /FontFile2 9 0 R >>',
    `<< /Length ${fonte.length} >>\nstream\n${fonte}\nendstream`,
  ]);
}

function montar(objs: string[]): Buffer {
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

/**
 * Uma revisão com xref stream (/W [1 4 2], /Predictor 12, como o Acrobat) e objetos dentro de /ObjStm comprimidos: cada
 * `stms[i]` vira um objeto tipo 1 e os números em `objetos` viram entradas TIPO 2 que apontam para ele (é a entrada tipo
 * 2 que obriga o leitor a decodificar o /ObjStm). A xref stream ganha o número seguinte ao maior usado.
 */
export function revisaoComXrefStream(base: Buffer, prev: number, stms: { num: number; dados: Buffer; first: number; objetos: number[]; n?: number }[]): Buffer {
  const partes: Buffer[] = [Buffer.from('\n')];
  let tam = base.length + 1;
  const entradas: [number, number, number, number][] = []; // [número, tipo, campo 2, campo 3]
  for (const s of stms) {
    entradas.push([s.num, 1, tam, 0]);
    const cab = Buffer.from(`${s.num} 0 obj\n<< /Type /ObjStm /N ${s.n ?? s.objetos.length} /First ${s.first} /Filter /FlateDecode /Length ${s.dados.length} >>\nstream\n`, 'latin1');
    const fim = Buffer.from('\nendstream\nendobj\n', 'latin1');
    partes.push(cab, s.dados, fim);
    tam += cab.length + s.dados.length + fim.length;
    s.objetos.forEach((o, i) => entradas.push([o, 2, s.num, i]));
  }
  const nXref = Math.max(...entradas.map((e) => e[0])) + 1;
  entradas.push([nXref, 1, tam, 0]);
  entradas.sort((x, y) => x[0] - y[0]);
  let anterior = Buffer.alloc(7);
  const filtradas = entradas.map(([, t, a, g]) => {
    const l = Buffer.from([t, (a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (g >>> 8) & 255, g & 255]);
    const f = Buffer.alloc(8);
    f[0] = 2; // preditor PNG "Up"
    for (let i = 0; i < 7; i++) f[i + 1] = (l[i] - anterior[i]) & 255;
    anterior = l;
    return f;
  });
  const dados = deflateSync(Buffer.concat(filtradas));
  const index = entradas.map((e) => `${e[0]} 1`).join(' ');
  partes.push(
    Buffer.from(`${nXref} 0 obj\n<< /Type /XRef /Size ${nXref + 1} /Root 1 0 R /Prev ${prev} /W [1 4 2] /Index [${index}] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${dados.length} >>\nstream\n`, 'latin1'),
    dados,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${tam}\n%%EOF\n`, 'latin1'),
  );
  return Buffer.concat([base, ...partes]);
}

/**
 * Conteúdo de /ObjStm com os objetos `nums` (todos no deslocamento 0, o mesmo `<< >>`; /N = nums.length), completado
 * com zeros até `bytes` descomprimidos. UM deflate serve a vários /ObjStm (testes de orçamento e de negação de serviço).
 */
export function objStmCheio(nums: number[], bytes: number): { dados: Buffer; first: number; n: number } {
  const cab = nums.map((x) => `${x} 0 `).join('');
  const corpo = Buffer.from(`${cab}<< >>`, 'latin1');
  return { dados: deflateSync(Buffer.concat([corpo, Buffer.alloc(Math.max(0, bytes - corpo.length))])), first: cab.length, n: nums.length };
}
```

- [ ] **Step 4: Testes do leitor (falham)** — `src/modules/documentos/pdf-leitor.test.ts`

```ts
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { baseMinimo, objStmCheio, revisaoComXrefStream } from '../../../test/assinatura/base-minimo';
import { dict, escreverAtualizacao, nome, ref, serializar } from './pdf-escrita';
import { ehStream, iguais, lerAtualizacao, lerBase, LIMITES_LEITOR, nomeDe, novoOrcamento, pegar, PdfIlegivelError, type PdfDict } from './pdf-leitor';

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
    // ObjStm (7) com o objeto 8 dentro; xref stream (9) com /W [1 4 2] e Predictor 12
    const dentro = serializar(dict({ Type: nome('Annot'), Subtype: nome('Widget') })).toString('latin1');
    const cabeca = `8 0 `;
    const pdf = revisaoComXrefStream(base, b.startxref, [{ num: 7, dados: deflateSync(Buffer.from(cabeca + dentro, 'latin1')), first: cabeca.length, objetos: [8] }]);
    const [rev] = lerAtualizacao(pdf, base.length);
    expect(rev.xrefStream).toBe(true);
    expect(rev.objetos.get(8)!.objStm).toBe(7);
    expect(nomeDe(pegar(rev.objetos.get(8)!.valor as PdfDict, 'Subtype'))).toBe('Widget');
  });

  it('Minor 1: a geração do cabeçalho "N G obj" tem de ser a da entrada da xref', () => {
    const base = baseMinimo();
    const b = lerBase(base);
    const ok = escreverAtualizacao(base, { prev: b.startxref, size: 8, trailer: { Root: ref(1) }, objetos: [{ num: 7, corpo: Buffer.from('<< >>') }] });
    const i = ok.indexOf('7 0 obj', base.length, 'latin1');
    const errado = Buffer.from(ok);
    errado.write('7 1 obj', i, 'latin1'); // mesmo tamanho: os offsets da xref continuam certos
    expect(() => lerAtualizacao(errado, base.length)).toThrow(PdfIlegivelError);
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
    // bomba de inflate: xref STREAM com a entrada tipo 2 (8 → /ObjStm 7), que obriga o leitor a decodificar o /ObjStm
    // (numa xref clássica o /ObjStm nunca seria decodificado e o teste passaria sem chegar ao inflate — revisão do rascunho)
    const bomba = revisaoComXrefStream(base, b.startxref, [{ num: 7, dados: deflateSync(Buffer.alloc(LIMITES_LEITOR.inflateBytes + 1)), first: 4, objetos: [8] }]);
    let motivo: string | undefined;
    try {
      lerAtualizacao(bomba, base.length);
    } catch (e) {
      motivo = (e as PdfIlegivelError).motivo;
    }
    expect(motivo).toBe('inflate');
  });

  it('RNF-141: orçamento total de inflate por conferência, no máximo 16 /ObjStm por revisão e prazo dentro dos laços', () => {
    const base = baseMinimo();
    const b = lerBase(base);
    // 20 MB descomprimidos cada (dentro do limite POR stream), com o cabeçalho válido para os números 1000 e 1001
    const cheio = objStmCheio([1000, 1001], LIMITES_LEITOR.inflateBytes);
    const stms = (qtd: number) => Array.from({ length: qtd }, (_, i) => ({ num: 7 + i, ...cheio, objetos: [1000 + i] }));
    const motivoDe = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as PdfIlegivelError).motivo;
      }
      return undefined;
    };
    // 2 × 20 MB > 32 MB de orçamento: recusa no 2º, sem decodificar o resto
    expect(motivoDe(() => lerAtualizacao(revisaoComXrefStream(base, b.startxref, stms(2)), base.length))).toBe('inflate_total');
    // 17 /ObjStm pequenos: recusa pelo número, antes de decodificar o 17º
    const nums = Array.from({ length: 17 }, (_, i) => 1000 + i);
    const pequeno = objStmCheio(nums, 0);
    const muitos = nums.map((x, i) => ({ num: 7 + i, ...pequeno, objetos: [x] }));
    expect(motivoDe(() => lerAtualizacao(revisaoComXrefStream(base, b.startxref, muitos), base.length))).toBe('objstm_demais');
    // prazo já vencido: recusa 'tempo' no primeiro laço
    expect(motivoDe(() => lerAtualizacao(revisaoComXrefStream(base, b.startxref, stms(1)), base.length, novoOrcamento(-1)))).toBe('tempo');
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

/**
 * RNF-141. `inflateBytes` vale POR stream; `inflateTotalBytes` é o ORÇAMENTO da conferência inteira (todas as revisões);
 * `objStmPorRevisao` limita quantos /ObjStm uma revisão pode obrigar a decodificar. Sem o orçamento total, ~500 /ObjStm
 * de 20 KB (20 MB cada, Predictor 12) cabem em 10 MB e param o event loop do Next por dezenas de segundos para todos os
 * consultórios (revisão do rascunho, Important).
 */
export const LIMITES_LEITOR = { aninhamento: 32, objetos: 2000, inflateBytes: 20 * 1024 * 1024, inflateTotalBytes: 32 * 1024 * 1024, objStmPorRevisao: 16, revisoes: 2 } as const;

/** Orçamento de UMA conferência: bytes que ainda podem ser descomprimidos e o prazo (performance.now()). */
export type Orcamento = { bytes: number; prazo: number };
export const novoOrcamento = (ms = 3000): Orcamento => ({ bytes: LIMITES_LEITOR.inflateTotalBytes, prazo: performance.now() + ms });
/** Conferido DENTRO dos laços do leitor e da conferência (T4), não só no fim: código síncrono não é interrompido de fora. */
export function verificarPrazo(orc: Orcamento): void {
  if (performance.now() > orc.prazo) throw new PdfIlegivelError('tempo');
}

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

function inflar(dados: Buffer, orc: Orcamento): Buffer {
  verificarPrazo(orc);
  const limite = Math.min(LIMITES_LEITOR.inflateBytes, orc.bytes);
  let out: Buffer;
  try {
    out = inflateSync(dados, { maxOutputLength: limite });
  } catch {
    throw new PdfIlegivelError(limite < LIMITES_LEITOR.inflateBytes ? 'inflate_total' : 'inflate');
  }
  orc.bytes -= out.length;
  return out;
}

/** /DecodeParms com /Predictor ≥ 10 (PNG), o comum nas xref streams. Prazo conferido a cada 4.096 linhas. */
function desfazerPreditor(dados: Buffer, parms: PdfValor | undefined, orc: Orcamento): Buffer {
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
    if ((i & 4095) === 0) verificarPrazo(orc);
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

function decodificar(s: PdfStream, orc: Orcamento): Buffer {
  const filtro = pegar(s.dict, 'Filter');
  const filtros = Array.isArray(filtro) ? filtro : filtro === undefined ? [] : [filtro];
  if (filtros.length > 1 || (filtros.length === 1 && nomeDe(filtros[0]) !== 'FlateDecode')) throw new PdfIlegivelError('filtro');
  const cru = filtros.length ? inflar(s.dados, orc) : s.dados;
  return desfazerPreditor(cru, pegar(s.dict, 'DecodeParms'), orc);
}

type Entrada = { tipo: 'n'; offset: number; gen: number } | { tipo: 'o'; stm: number; indice: number } | { tipo: 'f' };

function lerXref(buf: Buffer, offset: number, orc: Orcamento): { entradas: Map<number, Entrada>; trailer: PdfDict; stream: boolean } {
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
  const dados = decodificar(valor, orc);
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
function lerObjetos(buf: Buffer, entradas: Map<number, Entrada>, inicio: number, fim: number, apagadoProibido: boolean, orc: Orcamento): Map<number, ObjetoLido> {
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
    verificarPrazo(orc);
    if (num === 0) continue;
    if (e.tipo === 'f') {
      if (apagadoProibido) throw new PdfIlegivelError('objeto_apagado');
      continue;
    }
    if (e.tipo === 'n') {
      if (e.offset < inicio || e.offset >= fim) throw new PdfIlegivelError('objeto_fora_da_revisao');
      const o = objetoEm(buf, e.offset, resolver);
      if (o.num !== num) throw new PdfIlegivelError('numero_de_objeto');
      // Minor 1 da revisão de segurança: a geração do cabeçalho "N G obj" é a da entrada da xref (com N 1 obj, as
      // referências "N 0 R" do base deixam de casar em alguns leitores)
      if (o.gen !== e.gen) throw new PdfIlegivelError('geracao');
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
      if (stms.size >= LIMITES_LEITOR.objStmPorRevisao) throw new PdfIlegivelError('objstm_demais');
      const dados = decodificar(s, orc);
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
export function lerBase(buf: Buffer, orc: Orcamento = novoOrcamento()): BaseLida {
  const startxref = ultimoStartxref(buf, buf.length);
  const { entradas, trailer } = lerXref(buf, startxref, orc);
  if (pegar(trailer, 'Prev') !== undefined) throw new PdfIlegivelError('base_com_revisoes');
  const size = pegar(trailer, 'Size');
  if (typeof size !== 'number') throw new PdfIlegivelError('trailer');
  return { objetos: lerObjetos(buf, entradas, 0, buf.length, false, orc), trailer, startxref, tamanho: size };
}

const EOL = (buf: Buffer, i: number) => (buf[i] === 0x0d && buf[i + 1] === 0x0a ? 2 : buf[i] === 0x0a || buf[i] === 0x0d ? 1 : 0);

/**
 * RN-144 (3): as revisões depois de `inicio` (o fim do PDF base). Cada uma termina em "%%EOF" + fim de linha opcional; o
 * arquivo termina exatamente no fim da última (nada depois). Cada xref fica dentro da própria revisão e o /Prev aponta
 * para o startxref anterior (o do base, na primeira) — conferido em pdf-atualizacao.ts (T4).
 */
export function lerAtualizacao(buf: Buffer, inicio: number, orc: Orcamento = novoOrcamento()): Revisao[] {
  const revisoes: Revisao[] = [];
  let ini = inicio;
  while (ini < buf.length) {
    const eof = buf.indexOf('%%EOF', ini, 'latin1');
    if (eof < 0) throw new PdfIlegivelError('lixo_no_fim');
    const fim = eof + 5 + EOL(buf, eof + 5);
    if (revisoes.length >= LIMITES_LEITOR.revisoes) throw new PdfIlegivelError('revisoes_demais');
    const xrefOffset = ultimoStartxref(buf, eof);
    if (xrefOffset < ini || xrefOffset >= eof) throw new PdfIlegivelError('xref_fora_da_revisao');
    const { entradas, trailer, stream } = lerXref(buf, xrefOffset, orc);
    // a própria xref stream é um objeto da revisão: entra no mapa (é conferida como "xref", não como conteúdo)
    const objetos = lerObjetos(buf, entradas, ini, eof, true, orc);
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

/** Usado pela fábrica de PDFs de teste (T1) e, no worker, pelo campo pré-criado (10A-T7, se CAMPO_PRE_CRIADO). */
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
import { GOVBR_PEM, RAIZES_CONFERIDAS, RAIZES_FIXADAS, RAIZES_ICP_PEM } from '../../src/modules/documentos/ancoras-raizes';

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
    `${JSON.stringify({ zip: ZIP, baixadoEm: new Date().toISOString(), sha512Zip: calculado, raizesFonte: RAIZES_CONFERIDAS.fonte, raizesConferidasEm: RAIZES_CONFERIDAS.em, raizes: raizes.map(linha), govbr: govbr.map(linha), acs: aceitas.map(linha), recusadas: recusadas.length }, null, 1)}\n`,
  );
  console.log(`ACs aceitas: ${aceitas.length}; recusadas (sem cadeia até raiz fixada, ex.: v7): ${recusadas.length}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

`src/modules/documentos/ancoras-raizes.ts` traz os PEM das raízes ICP-Brasil v4, v5, v6, v10, v11, v12 e v13 (`RAIZES_ICP_PEM`), os 3 da cadeia gov.br (`GOVBR_PEM`) e `RAIZES_FIXADAS` com os SHA-256 da tabela da §3.1 e da §3.3 da pesquisa — copiados do `openssl x509 -fingerprint -sha256` dos arquivos baixados de `acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasil{vN}.crt` e do `Cadeia_GovBr-der.p7b` (autenticado pelas LCRs de `repo.iti.br`), **conferidos no PR pelo revisor contra a pesquisa e contra uma fonte independente por HTTPS** (a página das raízes da ICP-Brasil no site do ITI, `gov.br/iti`): a pesquisa baixou os certificados por HTTP (o `acraiz` não tem a cadeia TLS completa), então o SHA-256 só entra em `RAIZES_FIXADAS` depois de bater com a página por HTTPS — a URL e a data da conferência ficam em `fonte.json` (`raizesConferidasEm`, `raizesFonte`) (Minor 7 da revisão de segurança):

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
/**
 * Minor 7 (revisão de segurança): onde e quando os SHA-256 acima foram conferidos por HTTPS, numa fonte independente da
 * pesquisa (que baixou por HTTP). Preenchido no PR; o gerar-ancoras.ts copia para o fonte.json.
 */
export const RAIZES_CONFERIDAS: { fonte: string; em: string } = { fonte: 'https://www.gov.br/iti/<página das raízes, preenchida no PR>', em: '<AAAA-MM-DD do PR>' };
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
  it('Minor 7: as raízes foram conferidas numa fonte HTTPS registrada (URL e data no fonte.json)', () => {
    expect(fonte.raizesFonte).toMatch(/^https:\/\/[^<]+$/);
    expect(fonte.raizesConferidasEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
 * incremental à mão sobre o PDF — nas variantes válidas e nas adulteradas que a T4 tem de recusar. Sem rede.
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
    // serialNumber pelo OID (2.5.4.5): o parser de nomes do @peculiar/x509 aceita OID em texto; o apelido "serialNumber"
    // pode não estar no mapa dele (Minor da revisão de cobertura)
    subject: tipo === 'govbr' && cpf ? `CN=${cn}, 2.5.4.5=${cpf}` : `CN=${cn}`,
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
  /** Adulterações (cada uma com a mensagem esperada na T4). */
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
  /** RNF-141: /Launch no widget, anexo (/Filespec + /EmbeddedFile), /Names trocado no Catálogo, aninhamento de 10.000 níveis. */
  launch?: boolean;
  anexo?: boolean;
  namesNovo?: boolean;
  aninhamento?: boolean;
  /** Shadow attack "replace" disfarçado: o objeto `num` do base redefinido como stream com /Type /ObjStm ou /XRef. */
  disfarce?: { num: number; tipo: 'ObjStm' | 'XRef' };
  /** Um segundo stream /Type /XRef (número novo) que não é o do startxref. */
  xrefExtra?: boolean;
  /** Segunda revisão: 'ltv' (só /DSS), 'ltv-carimbo' (só /DocTimeStamp), 'ltv-dss-carimbo' (os dois) ou 'isa' (texto depois da assinatura). */
  depois?: 'ltv' | 'ltv-carimbo' | 'ltv-dss-carimbo' | 'isa';
  /** Certificado a mais no CMS (a cadeia completa); padrão: só o do titular, como o Acrobat. */
  cadeiaNoCms?: AcDeTeste;
  /** Minors 1 e 2 da revisão de segurança (T4): widget sem /FT com /Parent num campo de texto (/FT /Tx). */
  widgetDeTexto?: boolean;
  /** /AP /N como dicionário de estados, um deles com /BBox maior que o /Rect (usar com `rect`). */
  apComEstados?: boolean;
  /** Uma chave a mais no /AcroForm novo. */
  acroformExtra?: 'NeedAppearances' | 'XFA' | 'CO';
  /** Objeto novo com /Type /Page E /Fields (antes, o /Fields pulava a checagem de página). */
  paginaComFields?: boolean;
  /** Um "90 0 obj" na região da revisão que a xref não lista. */
  objetoSolto?: boolean;
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
  if (o.launch) widget.A = dict({ S: nome('Launch'), F: texto('calc.exe') });
  if (o.widgetDeTexto) {
    const nPai = novo();
    delete widget.FT;
    widget.Parent = ref(nPai);
    add(nPai, dict({ FT: nome('Tx'), T: texto('Campo'), Kids: [ref(nCampo)] }));
  }
  if (o.apComEstados) {
    const nApGrande = novo();
    widget.AP = dict({ N: dict({ On: ref(nAp), Off: ref(nApGrande) }) });
    add(nApGrande, { dict: dict({ Type: nome('XObject'), Subtype: nome('Form'), BBox: [0, 0, 600, 800] }), dados: Buffer.alloc(0), inicio: 0 });
  }
  add(nCampo, dict(widget));
  add(nAp, { dict: dict({ Type: nome('XObject'), Subtype: nome('Form'), BBox: bbox }), dados: Buffer.from(o.rect ? '1 1 1 rg 0 0 500 500 re f' : ''), inicio: 0 });
  const extra: Record<string, PdfValor> = o.acroformExtra === 'NeedAppearances' ? { NeedAppearances: true } : o.acroformExtra ? { [o.acroformExtra]: [] } : {};
  add(nAcro, dict({ Fields: [ref(nCampo)], SigFlags: 3, ...extra }));
  if (o.paginaComFields) add(novo(), dict({ Type: nome('Page'), Fields: [], Parent: pegar(catalogo, 'Pages')!, MediaBox: [0, 0, 595, 842] }));
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
  // /Names trocado (ou acrescentado, num base sem /Names): uma árvore de JavaScript de documento
  if (o.namesNovo) novoCatalogo.set('Names', dict({ JavaScript: dict({ Names: [texto('a'), dict({ S: nome('JavaScript'), JS: texto('app.alert(1)') })] }) }));
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
  if (o.anexo) {
    const nArq = novo(), nEsp = novo();
    add(nArq, { dict: dict({ Type: nome('EmbeddedFile') }), dados: Buffer.from('MZ'), inicio: 0 });
    add(nEsp, dict({ Type: nome('Filespec'), F: texto('receita.exe'), EF: dict({ F: ref(nArq) }) }));
  }
  if (o.aninhamento) add(novo(), Buffer.from('['.repeat(10_000) + ']'.repeat(10_000), 'latin1'));
  if (o.disfarce) {
    // o conteúdo original + um retângulo branco sobre a dose: um leitor de PDF ignora o /Type de um stream de conteúdo
    const antes = b.objetos.get(o.disfarce.num)!.valor as { dados: Buffer };
    add(o.disfarce.num, { dict: dict({ Type: nome(o.disfarce.tipo) }), dados: Buffer.concat([antes.dados, Buffer.from(' 1 1 1 rg 70 715 200 20 re f')]), inicio: 0 });
  }
  if (o.xrefExtra) add(novo(), { dict: dict({ Type: nome('XRef'), Size: 1, W: [1, 4, 2] }), dados: Buffer.alloc(0), inicio: 0 });

  // objetoSolto: o "90 0 obj" fica entre o fim do base e os objetos da revisão (dentro do /ByteRange), sem entrada na xref
  const anterior = o.objetoSolto ? Buffer.concat([base, Buffer.from('\n90 0 obj\n<< /Type /Annot /Subtype /FreeText /Rect [72 700 400 730] /Contents (Vitamina D3 50000 UI) >>\nendobj\n', 'latin1')]) : base;
  let pdf = escreverAtualizacao(anterior, { prev: b.startxref, size: n, trailer: { Root: ref(raiz.num), ...(pegar(b.trailer, 'Info') ? { Info: pegar(b.trailer, 'Info')! } : {}) }, objetos });
  await fecharByteRange(pdf, base.length, (cobertos) => cms(cobertos, t, o), o.byteRangeCurto);

  // o startxref da revisão da assinatura (o "xref" de "startxref" não serve: procurar o número depois dele)
  const startxrefAtual = () => Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf.toString('latin1'))![1]);
  if (o.depois === 'isa') {
    pdf = escreverAtualizacao(pdf, { prev: startxrefAtual(), size: n + 1, trailer: { Root: ref(raiz.num) }, objetos: [{ num: n, corpo: serializar(dict({ Type: nome('Annot'), Subtype: nome('FreeText'), Rect: [72, 700, 400, 730], Contents: texto('Dose alterada') })) }] });
  }
  if (o.depois && o.depois !== 'isa') {
    // RN-144 (7): /DSS e/ou carimbo do tempo (/DocTimeStamp, ETSI.RFC3161, widget de área zero); o token não é validado
    const comDss = o.depois !== 'ltv-carimbo';
    const comCarimbo = o.depois !== 'ltv';
    let m = n;
    const objs: { num: number; corpo: Buffer }[] = [];
    if (comDss) {
      const nDss = m++;
      objs.push({ num: nDss, corpo: serializar(dict({ Certs: [] })) });
      objs.push({ num: raiz.num, corpo: serializar({ d: new Map([...novoCatalogo, ['DSS', ref(nDss)]]) }) });
    }
    if (comCarimbo) {
      const nTs = m++, nTsCampo = m++;
      objs.push({ num: nTs, corpo: Buffer.from(`<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 ${MARCA_BR} /Contents <${'0'.repeat(LARGURA_CONTENTS * 2)}> >>`, 'latin1') });
      objs.push({ num: nTsCampo, corpo: serializar(dict({ Type: nome('Annot'), Subtype: nome('Widget'), FT: nome('Sig'), T: texto('Carimbo1'), V: ref(nTs), F: 132, Rect: [0, 0, 0, 0], P: pagRef })) });
      objs.push({ num: pagRef.num, corpo: serializar({ d: new Map([...novaPagina, ['Annots', [...annots, ref(nTsCampo)]]]) }) });
      objs.push({ num: nAcro, corpo: serializar(dict({ Fields: [ref(nCampo), ref(nTsCampo)], SigFlags: 3 })) });
    }
    const inicio2 = pdf.length;
    pdf = escreverAtualizacao(pdf, { prev: startxrefAtual(), size: m, trailer: { Root: ref(raiz.num) }, objetos: objs });
    if (comCarimbo) await fecharByteRange(pdf, inicio2, async () => TOKEN_DE_CARIMBO);
  }
  if (o.lixoNoFim) pdf = Buffer.concat([pdf, Buffer.from('% lixo\n')]);
  return pdf;
}

/** Um DER qualquer no lugar do token RFC 3161: a RN-144 (7) aceita o carimbo e não o valida. */
const TOKEN_DE_CARIMBO = Buffer.from('3003020100', 'hex');

/**
 * Preenche o primeiro MARCA_BR depois de `desde`: /ByteRange [0 a b c] (a = o "<" do /Contents deste dicionário; b = depois
 * do ">"; c = até o fim do arquivo, ou 10 bytes antes com `curto`) e o /Contents com o que `gerar` devolver.
 */
async function fecharByteRange(pdf: Buffer, desde: number, gerar: (cobertos: Buffer) => Promise<Buffer>, curto = false): Promise<void> {
  const s = pdf.toString('latin1');
  const iSig = s.indexOf(MARCA_BR, desde);
  const a = s.indexOf('/Contents <', iSig) + '/Contents '.length;
  const bfim = a + LARGURA_CONTENTS * 2 + 2;
  const c = (curto ? pdf.length - 10 : pdf.length) - bfim;
  pdf.write(`/ByteRange [0 ${a} ${bfim} ${c}]`.padEnd(MARCA_BR.length, ' '), iSig, 'latin1');
  const assinatura = await gerar(Buffer.concat([pdf.subarray(0, a), pdf.subarray(bfim, bfim + c)]));
  if (assinatura.length > LARGURA_CONTENTS) throw new Error('CMS maior que o espaço reservado');
  pdf.write(assinatura.toString('hex').toUpperCase().padEnd(LARGURA_CONTENTS * 2, '0'), a + 1, 'latin1');
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

Teste em `pdf-leitor.test.ts`: `acrescentarCampoDeAssinatura(baseMinimo(), AREA_ASSINATURA)` gera um PDF com uma revisão (o campo com `/Lock`), e `lerBase` do resultado falha com `base_com_revisoes` (o base com campo é lido como "base + 1 revisão" pela T4 — anotar no relatório).

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

Run: `pnpm assinatura:relatorio test/assinatura/reais/base.pdf test/assinatura/reais/govbr-a.pdf` (na Tarefa 2, depois do checkpoint do dono).

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

- [ ] **Step 13: Operação das âncoras** — `docs/operacao/ancoras-assinatura.md`

```markdown
# Âncoras de confiança da assinatura (INT-B1, D7 do Plano 10B)

**Quando:** a cada trimestre (jan, abr, jul, out), quando o teste "ALARME" de `ancoras-fonte.test.ts` falhar (uma raiz ou
a cadeia gov.br vence em menos de 180 dias), ou quando uma nutricionista receber "Tipo de assinatura não aceito" com um
e-CPF de AC credenciada.

**Quem:** o Claude, a pedido do dono (D7), numa branch própria; o PR é revisado como código.

1. `pnpm certs:ancoras` (baixa o arquivo único do ITI por HTTP, confere o SHA-512 publicado e só aceita AC que encadeia até
   uma raiz fixada em `src/modules/documentos/ancoras-raizes.ts`).
2. `pnpm test src/modules/documentos/ancoras-fonte.test.ts`.
3. No PR: o número de ACs aceitas e recusadas (a saída do script), o diff do `fonte.json` e, se uma **raiz nova** do ITI
   apareceu, o SHA-256 dela conferido no repositório do ITI **e numa página do ITI por HTTPS** antes de entrar em
   `RAIZES_FIXADAS` (decisão do dono), com a URL e a data em `fonte.json` (`raizesFonte`, `raizesConferidasEm`).
4. A cadeia gov.br (`GOVBR_PEM`) só muda se o ITI publicar uma nova (vence em 06/2033); conferir pelas LCRs de `repo.iti.br`.
```

- [ ] **Step 14: O campo pré-criado e a premissa do leitor nos jobs do Plano 10A**

Em `src/modules/documentos/documento-pdf-job.ts` (10A-T7), no lugar do comentário "o Plano 10B (T1) acrescenta aqui o campo pré-criado":

```ts
import { acrescentarCampoDeAssinatura } from './campo-assinatura';
import { AREA_ASSINATURA, CAMPO_PRE_CRIADO } from './constantes'; // no lugar do import de AREA_ASSINATURA do 10A
// …
    let pdf = await (deps.renderizar ?? renderizarDocumento)({ /* …o mesmo objeto do 10A… */ });
    // D15 / §6.5 da pesquisa: o campo vazio com /Lock (FieldMDP) só entra se o relatório do spike (T2) ligar a bandeira
    if (CAMPO_PRE_CRIADO) pdf = acrescentarCampoDeAssinatura(pdf, AREA_ASSINATURA);
```

(`campo-assinatura.ts` só importa o leitor e a escrita, sem sessão: o worker pode importá-lo; a guarda de grafo de `exportacao.test.ts` continua verde.)

Em `documento-pdf-job.test.ts` (10A-T7), no primeiro caso, a premissa do leitor (no 10A ela era só "um `%%EOF`"):

```ts
import { lerBase } from './pdf-leitor';
// …
    // a premissa do leitor (T1): o PDF do react-pdf tem uma revisão, xref clássica e nenhum /ObjStm
    const base = lerBase(arquivo);
    expect([...base.objetos.values()].every((o) => o.objStm === null)).toBe(true);
```

Em `digitalizada-job.test.ts` (10A-T9), no primeiro caso, a conferência estrutural do PDF novo (o 10A só procura as chaves no texto):

```ts
import { lerBase, percorrer } from './pdf-leitor';
// …
    const b = lerBase(arquivo);
    for (const o of b.objetos.values()) percorrer(o.valor, (_v, k) => expect(['OpenAction', 'JavaScript', 'JS', 'EmbeddedFile', 'AA', 'Launch']).not.toContain(k));
```

Run: `pnpm test src/modules/documentos/documento-pdf-job.test.ts src/modules/documentos/digitalizada-job.test.ts src/modules/pacientes/exportacao.test.ts` → PASS.

- [ ] **Step 15: Commit (Tarefa 1)**

```bash
git add package.json pnpm-lock.yaml .gitignore src/modules/documentos/{constantes,pdf-leitor,pdf-leitor.test,pdf-escrita,campo-assinatura,ancoras,ancoras-raizes,ancoras-fonte.test,documento-pdf-job,documento-pdf-job.test,digitalizada-job.test}.ts src/modules/documentos/ancoras scripts/certs test/assinatura/base-minimo.ts test/assinatura/fabrica.ts docs/operacao/ancoras-assinatura.md
git commit -m "feat(documentos): spike da conferência da assinatura — âncoras, leitor limitado e fábrica de PDFs de teste (P-B2)"
```

---
### Task 2: Checkpoint do dono, relatório do spike e as decisões que dependem dele — D16, D8, `CAMPO_PRE_CRIADO`, `ASSINATURAS_LIBERADAS` (P-B2; P10B-02; antiga T1b) — não bloqueia as Tarefas 3 a 5

**Depende de:** Tarefa 1 (os scripts) e dos PDFs reais do dono (runbook, passo 1). **Não bloqueia** as Tarefas 3 a 5: até ela fechar, o envio responde "Tipo de assinatura não aceito" para o conjunto sem arquivo real (`ASSINATURAS_LIBERADAS`, T4) e `CAMPO_PRE_CRIADO` fica `false` — a digitalizada do Plano 10A continua sendo a única forma de assinar em produção.

**Files:**
- Create: `docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md`
- Modify: `src/modules/documentos/constantes.ts` (`CAMPO_PRE_CRIADO` e, se a T4 já entrou, `ASSINATURAS_LIBERADAS`), e as réplicas estruturais em `test/assinatura/fabrica.ts`, se o relatório pedir

- [ ] **Step 1: CHECKPOINT DO DONO — PDFs reais (runbook, passo 1)**

Parar e pedir ao dono, com os dois arquivos do Step 12 da Tarefa 1 (enviados por canal privado, nunca no git):
1. `base.pdf` assinado no **`assinador.iti.br`** com a conta gov.br prata/ouro da Debby ou do dono: (a) carimbo visível onde o assinador propõe; (b) carimbo dentro do quadro "Assinatura digital"; (c) sem carimbo visível, se o assinador oferecer. E `base-com-campo.pdf` assinado da forma (b).
2. Se houver e-CPF (A1 ou A3): o mesmo `base.pdf` e o `base-com-campo.pdf` assinados no **Adobe Acrobat Reader** e no **Assinador SERPRO** (ambos gratuitos), anotando o nome e a versão de cada programa.
3. Para cada arquivo assinado, o **relatório de conformidade do VALIDAR** (validar.iti.gov.br).
4. Os arquivos voltam para `test/assinatura/reais/` na máquina de dev (fora do git).

Enquanto os arquivos não chegam, o plano segue (as Tarefas 3 a 5 não esperam esta) com as réplicas da fábrica; **a opção C só é liberada** depois de um arquivo real de pelo menos um programa ICP (critério de aceite da T4), e o **gov.br** só depois do arquivo real dele.

- [ ] **Step 2: Relatório do spike e decisão da D16** — `docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md`

Rodar `pnpm assinatura:relatorio test/assinatura/reais/base.pdf <cada assinado>` e escrever o relatório com: a saída de cada arquivo (sem nome nem CPF — o script não os imprime), o resultado do VALIDAR de cada um ("Aprovado"/"Indeterminado"), e a aplicação da tabela de critérios (§9.4 da pesquisa):

| Resultado | Caminho |
|---|---|
| gov.br e os programas ICP testados preservam o prefixo e a atualização cabe na lista da RN-144 (5)–(6) | **Leitor síncrono** (T4 como está). Ajustar a lista com o que o relatório mostrou (ex.: `/Prop_Build`, `/Metadata`) e criar uma **réplica estrutural** de cada formato na fábrica (`OpcoesAssinatura` nova, sem o arquivo real) |
| Algum preserva o prefixo, mas o carimbo visível fica fora do quadro sem controle | Instrução + recusa específica (texto da US-144); se o atrito for alto, **T6** só para esse caso |
| Algum **não** preserva o prefixo (reescreve o arquivo) | **T6** (D16 = (a) da spec) para aquele assinador; (c) se o programa for raro |
| `/ObjStm` ilegível ou formato instável entre versões | **T6** |
| O certificado gov.br não traz o CPF em campo próprio | **D8 ★ (a), aprovada pelo dono em 05/10/2026:** RN-145 do gov.br pelo nome completo + o número de série do certificado (`Titular { tipo: 'serie' }`, T3 e T5 — o código já trata os dois casos); a nutricionista confirma com o 2FA a cada certificado novo (renovação anual). Registrar no relatório o campo onde o CPF **não** está, para a T4 não buscá-lo solto |
| O campo pré-criado foi usado e o VALIDAR aprovou | `CAMPO_PRE_CRIADO = true` (10A-T7) |
| Algum programa aceito sai "Indeterminado" no VALIDAR | Nota curta perto do link do ITI na `/v` (10A-T13), texto a escrever com o resultado |

Também no relatório: a tolerância de fim de linha depois do `%%EOF` do base (se algum programa emenda sem o `\n` ou troca por `\r\n`, a T4 aceita só a variação "base sem o fim de linha final" — **sem coluna nova**: o hash do base sem o fim de linha sai do próprio PDF base, que ainda está no disco enquanto o documento está em "Aguardando assinatura", então os documentos preparados no Plano 10A continuam assináveis; desvio a registrar) e onde fica o CPF no gov.br (`serialNumber`? SAN?) para a T4.

- [ ] **Step 3: Aplicar o resultado** — `CAMPO_PRE_CRIADO` em `constantes.ts` (e o job do PDF preparado, 10A-T7, passa a acrescentar o campo no preparo — o `if` entrou na T1, Step 14); com a T4 já na branch, `ASSINATURAS_LIBERADAS` liga o conjunto cujo arquivo real passou no teste local da T4 (Step 7); réplicas estruturais na fábrica para o que o relatório mostrou. Se a T4 ainda não entrou, este passo fica para o PR curto da liberação (runbook, etapa 5). Se o relatório cair numa linha "T6", a Tarefa 6 entra.

- [ ] **Step 4: Commit (Tarefa 2)**

```bash
git add docs/superpowers/plans/2026-10-xx-nutridebby-10-spike-assinatura.md src/modules/documentos/constantes.ts test/assinatura/fabrica.ts
git commit -m "docs(documentos): relatório do spike da assinatura e decisões da D16 e da D8 (P-B2)"
```

---
### Task 3: Banco do 10B e o assinante do consultório — `tenant_signer`, CHECKs com gov.br e ICP, recusas da conferência, CPF e troca do CPF (D10, RN-145, D13, D8 (a); P10B-03; da antiga T2 e da antiga T4)

> Tudo o que o Plano 10A deixou de fora por ser do certificado: a tabela do assinante (no plano único, na antiga T2), as funções do CPF (na antiga T4), a troca do CPF do consultório (RN-145/D13, revisão do rascunho) e os códigos de recusa da conferência. O 10A não tem CPF: a digitalizada liga a autoria pelo código do 2FA a cada envio. **D8 ★ (a), aprovada pelo dono em 05/10/2026:** se o spike (T2) mostrar que o certificado gov.br não traz o CPF em campo próprio, o titular do gov.br é identificado pelo **número de série do certificado** (`Titular { tipo: 'serie' }`), e todo certificado novo (renovação anual) passa pela mesma confirmação da troca — mesmo nome do perfil + código do 2FA. Se o gov.br trouxer o CPF, o ramo `'serie'` simplesmente não é usado.

**Files:**
- Create: `drizzle/0092_assinatura_certificado.sql` (gerada: tabela `tenant_signer` e os dois CHECKs ampliados), `drizzle/0093_rls_tenant_signer.sql` (custom), `src/modules/documentos/assinante.ts` (+ `assinante.test.ts`)
- Modify: `src/db/schema/documentos.ts` (`tenantSigner`, CHECKs), `src/db/rls-guard.ts` (`STAFF_ONLY`), `src/db/documentos-schema.test.ts` (o caso do tipo de assinatura), `src/modules/documentos/constantes.ts` (`TipoAssinatura`, `ROTULO_ASSINATURA`), `src/modules/documentos/erros.ts` (códigos e mensagens da conferência), `test/isolamento.test.ts` (`FABRICAS`)

**Interfaces:**
- Consumes (Plano 10A): `signedDocuments`, `documentVerifications`, `tenants` (10A-T1); `app_enable_tenant_rls`, `app_enable_staff_only`; `RecusaAssinaturaError`, `MSG_RECUSA`, `CodigoRecusa`, `TransicaoInvalidaError` (10A-T1); `recordAudit`, `ENTIDADE_ROTULO.perfil_profissional` (10A-T1); `encryptionKey` (`src/lib/crypto.ts`).
- Produces:
  - `@/db/schema`: `tenantSigner` (`tenant_id` PK, `titular_hmac`, `titular_identificacao`, `confirmado_em`, `confirmado_por`, `updated_at`).
  - `constantes.ts`: `TipoAssinatura = 'govbr' | 'icp' | 'digitalizada'`; `ROTULO_ASSINATURA = { govbr: 'gov.br', icp: 'Certificado ICP-Brasil', digitalizada: 'Digitalizado' }`.
  - `erros.ts`: `CodigoRecusa` com `'arquivo' | 'sem_assinatura' | 'nao_e_o_preparado' | 'alterado' | 'fora_do_quadro' | 'nao_confere' | 'vencido' | 'empresa' | 'outra_pessoa' | 'nao_aceito' | 'outro_titular_primeiro'` a mais; `new RecusaAssinaturaError(codigo, motivoTecnico?, nomeDoCertificado?)`, `mensagem()` com o nome do certificado.
  - `assinante.ts`: `type Titular = { tipo: 'cpf'; cpf: string } | { tipo: 'serie'; serie: string }`, `hmacDoTitular(t: Titular): string`, `mascararCpf(cpf: string): string` (`***.456.789-**`), `identificacaoDoTitular(t: Titular): string` (`CPF ***.456.789-**` ou `certificado gov.br de série …A1B2`), `lerAssinante(tx: Tx): Promise<{ titularHmac: string; identificacao: string } | null>`, `gravarAssinante(tx: Tx, a: { tenantId: string; titular: Titular; userId: string; agora: Date; anterior: string | null }): Promise<void>` (compare-and-set: `anterior = null` só insere; senão só troca a linha que ainda tem o HMAC anterior; nada casou → `TransicaoInvalidaError`; audita "Perfil profissional").

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/assinante.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { gravarAssinante, hmacDoTitular, identificacaoDoTitular, lerAssinante, mascararCpf, type Titular } from './assinante';
import { TransicaoInvalidaError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const cpf = (c: string): Titular => ({ tipo: 'cpf', cpf: c });

describe('assinante do consultório (D10, RN-145, D8)', () => {
  it('D10: o CPF vira HMAC + identificação com a máscara (6 dígitos visíveis), nunca o CPF; ler devolve o gravado', async () => {
    const T = await novoTenant(app.db);
    expect(mascararCpf('12345678909')).toBe('***.456.789-**');
    expect(identificacaoDoTitular(cpf('12345678909'))).toBe('CPF ***.456.789-**');
    expect(hmacDoTitular(cpf('12345678909'))).not.toContain('12345678909');
    expect(hmacDoTitular(cpf('12345678909'))).toBe(hmacDoTitular(cpf('123.456.789-09')));
    await withTenant(T.ctx, (tx) => gravarAssinante(tx, { tenantId: T.tenantId, titular: cpf('12345678909'), userId: T.nutriId, agora: new Date(), anterior: null }), app.db);
    expect(await withTenant(T.ctx, (tx) => lerAssinante(tx), app.db)).toEqual({ titularHmac: hmacDoTitular(cpf('12345678909')), identificacao: 'CPF ***.456.789-**' });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao from audit_log where entidade = 'perfil_profissional'`), app.db);
    expect(audit.rows).toEqual([{ acao: 'criar' }]);
  });

  it('D8 (a): gov.br sem CPF em campo próprio → HMAC do número de série; o CPF e a série nunca colidem', () => {
    const serie: Titular = { tipo: 'serie', serie: '0a1b2c3d4e5f' };
    expect(identificacaoDoTitular(serie)).toBe('certificado gov.br de série …4E5F');
    expect(hmacDoTitular(serie)).not.toBe(hmacDoTitular(cpf('01234567890')));
    expect(hmacDoTitular(serie)).toBe(hmacDoTitular({ tipo: 'serie', serie: '0A1B2C3D4E5F' }));
  });

  it('RN-145 troca: só troca a partir do titular que a tela mostrou; dois "primeiros" ao mesmo tempo → o segundo perde (TransicaoInvalidaError)', async () => {
    const T = await novoTenant(app.db);
    const grava = (t: Titular, anterior: string | null) => withTenant(T.ctx, (tx) => gravarAssinante(tx, { tenantId: T.tenantId, titular: t, userId: T.nutriId, agora: new Date(), anterior }), app.db);
    await grava(cpf('12345678909'), null);
    await expect(grava(cpf('98765432100'), null)).rejects.toBeInstanceOf(TransicaoInvalidaError); // "primeiro" de novo: já existe
    await expect(grava(cpf('98765432100'), hmacDoTitular(cpf('11111111111')))).rejects.toBeInstanceOf(TransicaoInvalidaError); // anterior errado
    await grava(cpf('98765432100'), hmacDoTitular(cpf('12345678909')));
    expect((await withTenant(T.ctx, (tx) => lerAssinante(tx), app.db))?.identificacao).toBe('CPF ***.654.321-**');
  });

  it('STAFF_ONLY: a sessão de paciente não vê o assinante', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => gravarAssinante(tx, { tenantId: T.tenantId, titular: cpf('12345678909'), userId: T.nutriId, agora: new Date(), anterior: null }), app.db);
    const visto = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`select 1 from tenant_signer`), app.db);
    expect(visto.rows).toEqual([]);
  });
});
```

Em `src/db/documentos-schema.test.ts` (10A-T1), o trecho "Plano 10A: só a digitalizada existe" passa a:

```ts
    // Plano 10B: gov.br e ICP-Brasil entram no CHECK; um tipo desconhecido continua recusado
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, assinatura_tipo) values (${T.tenantId}, ${p.id}, 'plataforma')`)).rejects.toSatisfy(restricao('signed_documents_assinatura_tipo_valida'));
```

e, no caso de `document_verifications`, o insert com `'icp'` e `assinante_nome = 'DEBBY'` passa a ser **aceito** (troque o `rejects.toSatisfy(…)` por `await`), e um com `'plataforma'` é recusado por `document_verifications_assinatura_tipo_valida`.

Run: `pnpm test src/modules/documentos/assinante.test.ts src/db/documentos-schema.test.ts` → FAIL (tabela e módulo não existem; os CHECKs ainda são os do 10A).

- [ ] **Step 2: Schema e migrations**

Em `src/db/schema/documentos.ts`:

```ts
// em signedDocuments, o CHECK passa a:
    check('signed_documents_assinatura_tipo_valida', sql`${t.assinaturaTipo} is null or ${t.assinaturaTipo} in ('govbr','icp','digitalizada')`),
// em documentVerifications:
    check('document_verifications_assinatura_tipo_valida', sql`${t.assinaturaTipo} in ('govbr','icp','digitalizada')`),

/**
 * D10 (Plano 10B): quem assina pelo consultório — o HMAC do CPF do certificado (ou do número de série, D8 (a)) e o texto
 * que a tela mostra ("CPF ***.456.789-**"). STAFF_ONLY, fora de `tenants` (o PerfilForm 'use client' recebe o TenantRow
 * inteiro e `tenants` é lida no contexto `publico`).
 */
export const tenantSigner = pgTable(
  'tenant_signer',
  {
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
    titularHmac: text('titular_hmac').notNull(),
    titularIdentificacao: text('titular_identificacao').notNull(),
    confirmadoEm: timestamp('confirmado_em', { withTimezone: true }).notNull().defaultNow(),
    confirmadoPor: uuid('confirmado_por'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('tenant_signer_identificacao_tamanho', sql`char_length(${t.titularIdentificacao}) <= 80`)],
);
```

Run: `pnpm db:generate` → `drizzle/0092_assinatura_certificado.sql` (renomear o arquivo gerado e a entrada do `meta/_journal.json`, se o nome sair outro). Conferir no SQL: `CREATE TABLE "tenant_signer"` e, para cada CHECK, `DROP CONSTRAINT` + `ADD CONSTRAINT` (sem migração de dados: os valores antigos, só `'digitalizada'`, continuam válidos).

`pnpm drizzle-kit generate --custom --name rls_tenant_signer` → `drizzle/0093_rls_tenant_signer.sql`:

```sql
-- Plano 10B (D10): o assinante do consultório. CLAUDE.md regra 2 (sem patient_id: só tenant e STAFF_ONLY).
SELECT app_enable_tenant_rls('tenant_signer');
--> statement-breakpoint
SELECT app_enable_staff_only('tenant_signer');
```

`src/db/rls-guard.ts` (`STAFF_ONLY`): `tenant_signer: 'D10 do Plano 10B: HMAC do CPF (ou do número de série, D8) do assinante do consultório — só a equipe',`.

`test/isolamento.test.ts` (`FABRICAS`; uma linha por tenant, PK `tenant_id`):

```ts
  tenant_signer: (t) => sql`insert into tenant_signer (tenant_id, titular_hmac, titular_identificacao) select ${t}, 'h', 'CPF ***.000.000-**' where not exists (select 1 from tenant_signer where tenant_id = ${t})`,
```

- [ ] **Step 3: Tipos e recusas** — `constantes.ts` e `erros.ts`

```ts
// constantes.ts (10A-T1): os dois passam a
/** Planos 10A e 10B: digitalizada (10A), gov.br e ICP-Brasil (10B). */
export type TipoAssinatura = 'govbr' | 'icp' | 'digitalizada';
export const ROTULO_ASSINATURA: Record<TipoAssinatura, string> = { govbr: 'gov.br', icp: 'Certificado ICP-Brasil', digitalizada: 'Digitalizado' };
```

```ts
// erros.ts (10A-T1): CodigoRecusa, MSG_RECUSA e RecusaAssinaturaError passam a
export type CodigoRecusa =
  | 'arquivo' | 'sem_assinatura' | 'nao_e_o_preparado' | 'alterado' | 'fora_do_quadro' | 'nao_confere' | 'vencido'
  | 'empresa' | 'outra_pessoa' | 'nao_aceito' | 'outro_titular_primeiro'
  | 'sem_2fa' | 'codigo_2fa' | 'tentativas_2fa' | 'imagens' | 'sem_habilitacao';

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
  sem_habilitacao: 'A receita tem fitoterápico formulado e a habilitação em Fitoterapia não está mais no seu perfil. Registre a habilitação de novo ou volte a editar a receita.',
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

- [ ] **Step 4: Implementação** — `src/modules/documentos/assinante.ts`

```ts
import { createHmac, hkdfSync } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { tenantSigner } from '@/db/schema';
import { encryptionKey } from '@/lib/crypto';
import { recordAudit } from '@/modules/plataforma/audit';
import { TransicaoInvalidaError } from './erros';

/**
 * RN-145 / D8 ★ (a): quem assina pelo consultório. O CPF vem do campo próprio do certificado (SAN 2.16.76.1.3.1 na ICP;
 * no gov.br, o campo que o spike confirmar). Sem CPF no gov.br, o número de série do certificado (muda a cada renovação:
 * a nutricionista confirma com o 2FA a cada certificado novo, pelo mesmo caminho da troca).
 */
export type Titular = { tipo: 'cpf'; cpf: string } | { tipo: 'serie'; serie: string };

let chave: Buffer | undefined;
/** HMAC com chave própria (HKDF de ENCRYPTION_KEY), como os links e os limites. Prefixos distintos: CPF e série nunca colidem. */
export function hmacDoTitular(t: Titular): string {
  chave ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:assinante:v1', 32));
  const valor = t.tipo === 'cpf' ? `cpf:${t.cpf.replace(/\D/g, '')}` : `serie:${t.serie.toUpperCase()}`;
  return createHmac('sha256', chave).update(valor).digest('base64url');
}

/** "***.456.789-**": a máscara do certificado (6 dígitos do meio). */
export function mascararCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** O que a tela, o e-mail e o banco (`titular_identificacao`) mostram — nunca o CPF inteiro. */
export function identificacaoDoTitular(t: Titular): string {
  return t.tipo === 'cpf' ? `CPF ${mascararCpf(t.cpf)}` : `certificado gov.br de série …${t.serie.slice(-4).toUpperCase()}`;
}

export async function lerAssinante(tx: Tx): Promise<{ titularHmac: string; identificacao: string } | null> {
  const [a] = await tx.select({ titularHmac: tenantSigner.titularHmac, identificacao: tenantSigner.titularIdentificacao }).from(tenantSigner);
  return a ?? null;
}

/**
 * Primeiro certificado (`anterior = null`) ou TROCA do titular do consultório (`anterior` = o HMAC que a tela mostrou),
 * RN-145 e D13 — sempre na transação da assinatura, depois do código do 2FA. Compare-and-set: o primeiro só INSERE (dois
 * primeiros envios simultâneos → o segundo não grava nada) e a troca só ATUALIZA a linha que ainda tem o HMAC anterior.
 * Nada casou → TransicaoInvalidaError (409) e o salvarArquivo desfaz tudo. Audita "Perfil profissional".
 */
export async function gravarAssinante(tx: Tx, a: { tenantId: string; titular: Titular; userId: string; agora: Date; anterior: string | null }): Promise<void> {
  const valores = { titularHmac: hmacDoTitular(a.titular), titularIdentificacao: identificacaoDoTitular(a.titular), confirmadoEm: a.agora, confirmadoPor: a.userId, updatedAt: a.agora };
  const r = a.anterior === null
    ? await tx.insert(tenantSigner).values({ tenantId: a.tenantId, ...valores }).onConflictDoNothing({ target: tenantSigner.tenantId }).returning({ id: tenantSigner.tenantId })
    : await tx.update(tenantSigner).set(valores).where(and(eq(tenantSigner.tenantId, a.tenantId), eq(tenantSigner.titularHmac, a.anterior))).returning({ id: tenantSigner.tenantId });
  if (!r.length) throw new TransicaoInvalidaError();
  await recordAudit(tx, { acao: a.anterior === null ? 'criar' : 'alterar', entidade: 'perfil_profissional', entidadeId: a.tenantId, patientId: null });
}
```

Run: `pnpm test src/modules/documentos/assinante.test.ts src/db/documentos-schema.test.ts src/db/rls-guard.test.ts test/isolamento.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/documentos.ts drizzle/0092_assinatura_certificado.sql drizzle/0093_rls_tenant_signer.sql drizzle/meta src/db/{rls-guard,documentos-schema.test}.ts src/modules/documentos/{assinante,assinante.test,constantes,erros}.ts test/isolamento.test.ts
git commit -m "feat(documentos): assinante do consultório, CHECKs com gov.br e ICP-Brasil e recusas da conferência (D10, RN-145, D8)"
```

---
### Task 4: Conferência do PDF assinado — forma do `/ByteRange`, lista fechada por alcance, CMS, cadeia, validade e titular, sem rede (RN-144, RN-145 parte técnica, RNF-141; P10B-04; antiga T9)

> **Minors da revisão de segurança aplicados aqui (1 a 5):** geração do objeto redefinido igual à do base e 0 nos novos, e nenhum `N G obj` "solto" na revisão fora da xref (`conferirCobertura`); widget só de campo `/FT /Sig` (no widget ou no pai), `/BBox` de cada estado do `/AP /N`, `/AcroForm` novo só com `Fields`/`SigFlags`/`DR`/`DA`, e a checagem de `/Type /Page` antes do atalho do `/Fields`; todo erro inesperado depois do leitor (CMS, cadeia, titular, `X509Certificate`) vira `nao_aceito` com `motivoTecnico` fixo (nunca 500); `signedAttrs` pelos bytes originais e PSS sem parâmetros recusado; o "Assinado por" nunca leva dígitos do CN (um CPF no CN iria para a `/v`). A geração no cabeçalho × xref está no leitor (T1). Interface alinhada ao código (Minor da revisão de cobertura): `conferirPdfAssinado` não tem `deps.campoPreCriado` — o base com o campo pré-criado é lido por `estadoInicial`. `Conferido` ganha `serie` (o número de série do certificado, para a D8 (a), T5).

> Escrita com o resultado do relatório do spike, se ele já existir (T2, Step 2; senão, a T2 aplica o resultado depois): se ele mandou ajustar a lista fechada (ex.: um `/Prop_Build` ou `/Metadata` que o gov.br põe), o ajuste entra aqui **com uma réplica estrutural** na fábrica; se mandou a T6, esta tarefa fica com a parte criptográfica (CMS, cadeia, titular) e a comparação de conteúdo vai para o worker.

**Files:**
- Create: `src/modules/documentos/pdf-atualizacao.ts`, `src/modules/documentos/cms.ts`, `src/modules/documentos/certificados.ts`, `src/modules/documentos/assinatura-pades.ts`, `src/modules/documentos/assinatura-pades.test.ts`, `src/modules/documentos/sem-rede.test.ts`
- Modify: `src/modules/documentos/constantes.ts` (`MAX_ENVIO_BYTES`, `LIMITE_CONFERENCIA_MS`)

**Interfaces:**
- Consumes: `lerBase`, `lerAtualizacao`, `pegar`, `iguais`, `percorrer`, `ehDict`, `ehRef`, `ehStream`, `nomeDe`, `dictDe`, `PdfIlegivelError`, `Orcamento`, `novoOrcamento`, `verificarPrazo`, `LIMITES_LEITOR` (T1); `baseComRecursos`, `OBJ`, `objStmCheio`, `revisaoComXrefStream` (T1, testes); `carregarAncoras`, `Ancoras` (T1); `RecusaAssinaturaError` e os códigos da conferência (T3; a classe nasce no 10A-T1); `AREA_ASSINATURA`, `TOLERANCIA_AREA_PT` (10A-T1); fábrica `criarAc`, `criarTitular`, `assinarDeTeste`, `RECT_NO_QUADRO`, `RECT_SOBRE_A_DOSE` (T1); `baseMinimo` (T1).
- Produces:
  - `BaseDoDocumento = { bytes: number; sha256: string; area: AreaAssinatura }`.
  - `conferirAtualizacao(arquivo: Buffer, base: BaseDoDocumento, orc?: Orcamento): { contents: Buffer; byteRange: [number, number, number, number]; subFilter: string }` (o base reenviado sem assinar → `sem_assinatura`; a revisão de longo prazo aceita só `/DSS`, só o carimbo ou os dois) (o base com o campo pré-criado — uma revisão nossa — é lido sozinho por `estadoInicial`).
  - `lerCms(contents: Buffer): CmsLido`, `conferirCms(c: CmsLido, cobertos: Buffer, o: { cades: boolean }): void`.
  - `cadeiaAte(titular: X509Certificate, extras: X509Certificate[], ancoras: Ancoras, agora: Date): { conjunto: 'icp' | 'govbr'; emissor: string }`, `titularDoCertificado(c: X509Certificate, conjunto): { nome: string; cpf: string | null }`, `cpfValido(cpf: string): boolean`, `normalizarNome(n: string): string`.
  - `conferirCobertura(arquivo: Buffer, r: Revisao): void` (Minor 1).
  - `conferirPdfAssinado(arquivo: Buffer, base: BaseDoDocumento, deps?: { ancoras?: Ancoras; agora?: Date; limiteMs?: number }): Conferido` com `Conferido = { tipo: 'govbr' | 'icp'; emissor: string; titularNome: string; cpf: string | null; serie: string; sha256: string }`. Lança só `RecusaAssinaturaError` (código fixo; `motivoTecnico` só para o log).

- [ ] **Step 1: Testes com a fábrica (falham)** — `src/modules/documentos/assinatura-pades.test.ts`

```ts
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { baseComRecursos, baseMinimo, OBJ, objStmCheio, revisaoComXrefStream } from '../../../test/assinatura/base-minimo';
import { assinarDeTeste, criarAc, criarTitular, RECT_NO_QUADRO, RECT_SOBRE_A_DOSE, type AcDeTeste, type OpcoesAssinatura, type TitularDeTeste } from '../../../test/assinatura/fabrica';
import type { Ancoras } from './ancoras';
import { conferirPdfAssinado, type BaseDoDocumento } from './assinatura-pades';
import { AREA_ASSINATURA, MAX_ENVIO_BYTES } from './constantes';
import { lerBase, LIMITES_LEITOR } from './pdf-leitor';
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
const conferir = (pdf: Buffer, b: BaseDoDocumento = base) => conferirPdfAssinado(pdf, b, { ancoras });
const assinado = (t: TitularDeTeste, o: OpcoesAssinatura = {}) => assinarDeTeste(BASE, t, o);
const baseDe = (pdf: Buffer): BaseDoDocumento => ({ bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), area: AREA_ASSINATURA });
const erroDe = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('conferência do PDF assinado — variantes válidas (RN-144)', () => {
  it.each<[string, OpcoesAssinatura]>([
    ['invisível, adbe.pkcs7.detached', {}],
    ['ETSI.CAdES.detached com signingCertificateV2', { subFilter: 'ETSI.CAdES.detached' }],
    ['visível dentro do quadro "Assinatura digital"', { rect: RECT_NO_QUADRO }],
    ['com a cadeia completa no CMS', { cadeiaNoCms: icp }],
    ['revisão de longo prazo só com /DSS', { depois: 'ltv' }],
    ['revisão de longo prazo só com o carimbo do tempo (/DocTimeStamp)', { depois: 'ltv-carimbo' }],
    ['revisão de longo prazo com /DSS e carimbo do tempo', { depois: 'ltv-dss-carimbo' }],
  ])('%s → aceito, tipo icp, titular e CPF lidos do campo próprio', async (_n, o) => {
    const pdf = await assinado(debby, o);
    const c = conferir(pdf);
    expect(c).toMatchObject({ tipo: 'icp', titularNome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
    expect(c.serie).toMatch(/^[0-9A-F]+$/);
    expect(c.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  });

  it('o Catálogo com /Names inalterado (como o do pdfkit/react-pdf) é aceito: a lista proibida vale só para o que mudou', async () => {
    expect(BASE.toString('latin1')).toContain('/Names');
    expect(conferir(await assinado(debby)).tipo).toBe('icp');
  });

  it('gov.br: o conjunto vem da âncora (nunca do nome do emissor); o nome sem acento confere depois (RN-145, T5)', async () => {
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
    ['/Launch no widget', { launch: true }, 'alterado'],
    ['anexo (/Filespec + /EmbeddedFile)', { anexo: true }, 'alterado'],
    ['/Names trocado no Catálogo', { namesNovo: true }, 'alterado'],
    ['aninhamento de 10.000 níveis', { aninhamento: true }, 'alterado'],
    ['stream de conteúdo da página redefinido com /Type /ObjStm', { disfarce: { num: OBJ.conteudo, tipo: 'ObjStm' } }, 'alterado'],
    ['stream de conteúdo da página redefinido com /Type /XRef', { disfarce: { num: OBJ.conteudo, tipo: 'XRef' } }, 'alterado'],
    ['segundo /XRef fora do startxref', { xrefExtra: true }, 'alterado'],
    ['widget visível sobre a dose', { rect: RECT_SOBRE_A_DOSE }, 'fora_do_quadro'],
    ['/BBox da aparência maior que o /Rect', { rect: RECT_NO_QUADRO, bbox: [0, 0, 600, 800] }, 'alterado'],
    ['messageDigest que não confere', { digestErrado: true }, 'nao_confere'],
    ['SHA-1', { digest: 'sha1' }, 'nao_aceito'],
    // Minors 1 e 2 da revisão de segurança
    ['objeto "solto" na revisão, fora da xref', { objetoSolto: true }, 'alterado'],
    ['widget com /Parent num campo de texto (/FT /Tx)', { widgetDeTexto: true }, 'alterado'],
    ['/AP /N com estados, um deles com /BBox maior que o /Rect', { rect: RECT_NO_QUADRO, apComEstados: true }, 'alterado'],
    ['/AcroForm novo com /NeedAppearances', { acroformExtra: 'NeedAppearances' }, 'alterado'],
    ['/AcroForm novo com /XFA', { acroformExtra: 'XFA' }, 'alterado'],
    ['objeto novo com /Type /Page e /Fields', { paginaComFields: true }, 'alterado'],
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

  it.each<[string, number, 'ObjStm' | 'XRef']>([
    ['logo', OBJ.logo, 'ObjStm'],
    ['logo', OBJ.logo, 'XRef'],
    ['/FontFile2', OBJ.fontFile, 'ObjStm'],
    ['/FontFile2', OBJ.fontFile, 'XRef'],
  ])('shadow "replace" disfarçado: %s do base redefinido com /Type /%s → alterado', async (_n, num, tipo) => {
    const rico = baseComRecursos();
    const pdf = await assinarDeTeste(rico, debby, { disfarce: { num, tipo } });
    expect(recusa('alterado')(erroDe(() => conferir(pdf, baseDe(rico))))).toBe(true);
    expect(conferir(await assinarDeTeste(rico, debby), baseDe(rico)).tipo).toBe('icp'); // o mesmo base sem o disfarce passa
  });

  it('/Names acrescentado num base que não tinha → alterado', async () => {
    const semNames = baseMinimo(undefined, { names: false });
    expect(conferir(await assinarDeTeste(semNames, debby), baseDe(semNames)).tipo).toBe('icp');
    const comNames = await assinarDeTeste(semNames, debby, { namesNovo: true });
    expect(recusa('alterado')(erroDe(() => conferir(comNames, baseDe(semNames))))).toBe(true);
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

  it('o PDF preparado reenviado sem assinar → "Não encontramos assinatura digital…" (sem_assinatura), não "não é o preparado"', () => {
    expect(recusa('sem_assinatura')(erroDe(() => conferir(BASE)))).toBe(true); // idêntico ao base
    expect(recusa('sem_assinatura')(erroDe(() => conferir(Buffer.concat([BASE, Buffer.from('\r\n  \n')]))))).toBe(true); // base + bytes sem revisão nova
  });

  it('um arquivo que não é PDF e um de 11 MB → "Envie o PDF assinado (até 10 MB)."', () => {
    expect(recusa('arquivo')(erroDe(() => conferir(Buffer.from('MZ não é pdf'))))).toBe(true);
    expect(recusa('arquivo')(erroDe(() => conferir(Buffer.concat([BASE, Buffer.alloc(11 * 1024 * 1024)]))))).toBe(true);
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

  it('Minor 5: CN com o CPF no texto ("NOME 123.456.789-09") → o nome sai sem os dígitos (nunca um CPF na /v)', async () => {
    const t = await criarTitular(icp, { nome: 'DEBORA SILVA SANTOS 123.456.789-09', cpf: '12345678909' });
    expect(conferir(await assinado(t)).titularNome).toBe('DEBORA SILVA SANTOS');
  });

  it('Minor 3: erro inesperado depois do leitor (aqui, nas âncoras) → "nao_aceito" com motivo fixo, nunca 500', async () => {
    const pdf = await assinado(debby);
    const quebradas = { ...ancoras, get raizesIcp(): Ancoras['raizesIcp'] { throw new TypeError('quebrou'); } } as Ancoras;
    const e = erroDe(() => conferirPdfAssinado(pdf, base, { ancoras: quebradas }));
    expect(recusa('nao_aceito')(e)).toBe(true);
    expect((e as RecusaAssinaturaError).motivoTecnico).toBe('cripto_erro');
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

describe('negação de serviço (RNF-141)', () => {
  it('500 /ObjStm de 20 MB descomprimidos cada (≈ 10 MB de arquivo) → recusa em menos de 3 s, sem assinatura válida', () => {
    const nums = Array.from({ length: 500 }, (_, i) => 1000 + i);
    const cheio = objStmCheio(nums, LIMITES_LEITOR.inflateBytes); // UM deflate, reaproveitado nos 500 /ObjStm
    const pdf = revisaoComXrefStream(BASE, lerBase(BASE).startxref, nums.map((x, i) => ({ num: 7 + i, ...cheio, objetos: [x] })));
    expect(pdf.length).toBeLessThan(MAX_ENVIO_BYTES);
    const t0 = performance.now();
    expect(recusa('alterado')(erroDe(() => conferir(pdf)))).toBe(true);
    expect(performance.now() - t0).toBeLessThan(3000);
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
  dictDe, ehDict, ehRef, ehStream, iguais, lerAtualizacao, lerBase, nomeDe, novoOrcamento, pegar, percorrer, PdfIlegivelError, verificarPrazo,
  type ObjetoLido, type Orcamento, type PdfDict, type PdfRef, type PdfValor, type Revisao,
} from './pdf-leitor';

export type BaseDoDocumento = { bytes: number; sha256: string; area: AreaAssinatura };
export type AssinaturaDaAtualizacao = { contents: Buffer; byteRange: [number, number, number, number]; subFilter: string };

const alterado = (motivo: string) => new RecusaAssinaturaError('alterado', motivo);
const SUBFILTERS = new Set(['adbe.pkcs7.detached', 'ETSI.CAdES.detached']);
/**
 * RN-144 (5): ação, script ou anexo em qualquer objeto NOVO, ou numa chave que MUDOU de um objeto redefinido → recusa.
 * Nunca no objeto redefinido inteiro: o Catálogo do pdfkit (react-pdf) nasce sempre com /Names, e varrer as chaves que
 * não mudaram recusaria toda assinatura real (revisão do rascunho, Critical). Que o /Names não mude é o `so(...)` de
 * `redefinido` (o Catálogo só pode mudar /AcroForm, /Perms, /Version, /Extensions e /Metadata).
 */
const PROIBIDAS = new Set(['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'Names', 'XFA', 'URI', 'SubmitForm', 'ImportData', 'GoToR', 'RichMedia', 'Movie', 'Sound', 'Rendition']);
/** /ObjStm e /XRef NÃO estão aqui: têm regra própria em conferirRevisao (número novo; contêiner desta revisão; o startxref). */
const TIPOS_DE_APARENCIA = new Set(['XObject', 'Font', 'FontDescriptor', 'ExtGState', 'Encoding', 'SigRef', 'TransformParams', 'Sig', 'Metadata']);
/** ISO 32000, 12.5.6: todo /Subtype de anotação (a /FreeText sem /Type /Annot também é anotação). */
const SUBTIPOS_DE_ANOTACAO = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget', 'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Redact', 'Projection', 'RichMedia']);

type Estado = { objetos: Map<number, ObjetoLido>; tamanho: number; raiz: number; paginas: Set<number>; acroform: number | null; info: number | null; startxref: number };

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const num = (v: PdfValor | undefined) => (ehRef(v) ? v.num : null);
const valorDe = (e: Estado, v: PdfValor | undefined): PdfValor | undefined => (ehRef(v) ? e.objetos.get(v.num)?.valor : v);

function estadoInicial(base: Buffer, orc: Orcamento): Estado {
  // o base pode já ter uma revisão nossa (o campo pré-criado, CAMPO_PRE_CRIADO): a 1ª revisão é a do react-pdf
  const eol = (i: number) => (base[i] === 0x0d && base[i + 1] === 0x0a ? 2 : base[i] === 0x0a || base[i] === 0x0d ? 1 : 0);
  const primeiro = base.indexOf('%%EOF', 0, 'latin1');
  const fim1 = primeiro + 5 + eol(primeiro + 5);
  const b = lerBase(base.subarray(0, fim1), orc);
  const e: Estado = { objetos: new Map(b.objetos), tamanho: b.tamanho, raiz: num(pegar(b.trailer, 'Root'))!, paginas: new Set(), acroform: null, info: num(pegar(b.trailer, 'Info')), startxref: b.startxref };
  if (fim1 < base.length) for (const r of lerAtualizacao(base, fim1, orc)) aplicar(e, r);
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
  // Minor 2: /AP /N pode ser um stream ou um dicionário de estados (/On, /Off…) — cada estado é conferido
  const estados = ehStream(n) ? [n] : ehDict(n) ? [...n.d.values()].map((v) => valorDe(e, v)) : [];
  for (const s of estados) {
    if (!ehStream(s)) throw alterado('ap_estado');
    const bbox = pegar(s.dict, 'BBox');
    if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((x) => typeof x === 'number')) {
      const [b1, b2, b3, b4] = bbox as number[];
      if (Math.abs(b3 - b1) > x2 - x1 + t || Math.abs(b4 - b2) > y2 - y1 + t) throw alterado('bbox');
    }
  }
}

/**
 * Minor 2 (revisão de segurança): widget de ASSINATURA = /Subtype /Widget com /FT /Sig nele ou no pai (/Parent resolvido);
 * um /Parent qualquer (um campo de texto, /FT /Tx) não basta.
 */
const ehWidgetDeAssinatura = (d: PdfDict, resolver: (v: PdfValor | undefined) => PdfValor | undefined) => {
  if (nomeDe(pegar(d, 'Subtype')) !== 'Widget') return false;
  if (nomeDe(pegar(d, 'FT')) === 'Sig') return true;
  const pai = dictDe(resolver(pegar(d, 'Parent')));
  return !!pai && nomeDe(pegar(pai, 'FT')) === 'Sig';
};
/** Minor 2: o /AcroForm NOVO só com estas chaves (nada de /NeedAppearances, /CO nem /XFA). */
const CHAVES_DO_ACROFORM_NOVO = new Set(['Fields', 'SigFlags', 'DR', 'DA']);

/**
 * Minor 1 (revisão de segurança): toda declaração "N G obj" na região da revisão pertence a um objeto que a xref lista
 * (um objeto "solto" aparece nos leitores que reconstroem a xref). Os bytes de cada objeto listado vão do offset ao
 * "endobj" (depois dos dados, se for stream: um stream pode conter o texto "1 0 obj").
 */
export function conferirCobertura(arquivo: Buffer, r: Revisao): void {
  const faixas = [...r.objetos.values()].filter((o) => o.offset !== null).map((o) => {
    const desde = ehStream(o.valor) ? o.valor.inicio + o.valor.dados.length : o.offset!;
    const fim = arquivo.indexOf('endobj', desde, 'latin1');
    return [o.offset!, fim < 0 ? r.fim : fim + 6] as const;
  });
  // a xref stream da própria revisão, mesmo que a xref não liste a si mesma (o leitor já a leu no startxref)
  if (r.xrefStream) {
    const fim = arquivo.indexOf('endobj', r.xrefOffset, 'latin1');
    faixas.push([r.xrefOffset, fim < 0 ? r.fim : fim + 6]);
  }
  for (const m of arquivo.toString('latin1', r.inicio, r.fim).matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
    const pos = r.inicio + (m.index ?? 0);
    if (!faixas.some(([a, b]) => pos >= a && pos < b)) throw alterado('objeto_solto');
  }
}

/**
 * RN-144 (5)–(7): o que uma revisão pode trazer. `tipo` = 'assinatura' (a 1ª) ou 'ltv' (a 2ª, opcional).
 * Devolve o número do objeto com /ByteRange desta revisão: o /Sig (obrigatório na 'assinatura') ou o /DocTimeStamp
 * (opcional na 'ltv', que traz /DSS e/ou o carimbo — RN-144 (7)); `null` = revisão 'ltv' só com /DSS.
 *
 * Ordem (revisão do rascunho, Critical — shadow attack "replace" disfarçado): PRIMEIRO "redefinido ou novo", DEPOIS o
 * /Type. Todo número que já existia vai para redefinido() — um stream do base com /Type /ObjStm ou /XRef é stream do
 * base redefinido e é recusado. /XRef só é aceito como o objeto no startxref desta revisão (número novo); /ObjStm só
 * com número novo e como contêiner de entradas tipo 2 desta revisão.
 */
function conferirRevisao(e: Estado, r: Revisao, tipo: 'assinatura' | 'ltv', area: AreaAssinatura, orc: Orcamento): number | null {
  const anteriores = new Map(e.objetos);
  const raizAntes = dictDe(anteriores.get(e.raiz)?.valor);
  const assinaturas: number[] = [];
  const widgetsNovos = new Set<number>();
  const conteineres = new Set([...r.objetos.values()].map((x) => x.objStm).filter((x): x is number => x !== null));
  const naRevisao = (v: PdfValor | undefined) => (ehRef(v) ? (r.objetos.get(v.num)?.valor ?? anteriores.get(v.num)?.valor) : v);
  for (const [n, o] of r.objetos) {
    verificarPrazo(orc);
    const d = dictDe(o.valor);
    const t = d ? nomeDe(pegar(d, 'Type')) : null;
    if (anteriores.has(n)) {
      // Minor 1: a geração do redefinido é a do base (com "N 1 obj", as referências "N 0 R" deixam de casar)
      if (o.gen !== anteriores.get(n)!.gen) throw alterado('geracao');
      redefinido(e, anteriores.get(n)!.valor, o.valor, n, tipo);
      continue;
    }
    if (o.gen !== 0) throw alterado('geracao');
    if (t === 'XRef') {
      if (!r.xrefStream || o.offset !== r.xrefOffset) throw alterado('xref_extra');
      continue; // a própria xref stream da revisão (o trailer dela já foi lido pelo leitor)
    }
    if (t === 'ObjStm') {
      if (o.objStm !== null || !conteineres.has(n)) throw alterado('objstm_extra');
      continue; // contêiner: os objetos de dentro são conferidos um a um, como entradas próprias
    }
    semProibidas(o.valor);
    if (!d) continue; // número, array ou texto solto (ex.: /Length indireto)
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
      if (!ehWidgetDeAssinatura(d, naRevisao)) throw alterado('anotacao');
      widgetsNovos.add(n);
      continue;
    }
    // Minor 2: /Type /Page (e os outros proibidos) ANTES do atalho do campo e do /AcroForm — um objeto novo com /Fields
    // e /Type /Page não passa mais por "/AcroForm novo"
    if (t === 'Page' || t === 'Pages' || t === 'Catalog' || t === 'Action' || t === 'Filespec' || t === 'EmbeddedFile') throw alterado(t === 'Page' ? 'pagina_nova' : 'objeto_proibido');
    if (nomeDe(pegar(d, 'FT')) === 'Sig') continue; // campo de assinatura (com /Kids)
    if (pegar(d, 'Fields') !== undefined) {
      if (![...d.d.keys()].every((k) => CHAVES_DO_ACROFORM_NOVO.has(k))) throw alterado('acroform_chaves');
      continue; // o /AcroForm novo
    }
    if (tipo === 'ltv' && (t === 'DSS' || t === 'VRI' || pegar(d, 'Certs') !== undefined || pegar(d, 'VRI') !== undefined)) continue;
    if (t && !TIPOS_DE_APARENCIA.has(t)) throw alterado('tipo_desconhecido');
  }
  aplicar(e, r);
  if (assinaturas.length > 1) throw alterado('duas_assinaturas');
  if (tipo === 'assinatura' && !assinaturas.length) throw new RecusaAssinaturaError('sem_assinatura', 'sem_byterange');
  if (tipo === 'ltv') {
    // RN-144 (7): "/DSS e/ou carimbo do tempo" — a revisão tem de trazer pelo menos um dos dois (o /DSS entra pelo Catálogo)
    const raizDepois = dictDe(e.objetos.get(e.raiz)?.valor);
    const dssNoCatalogo = !!raizDepois && pegar(raizDepois, 'DSS') !== undefined && !iguais(raizAntes ? pegar(raizAntes, 'DSS') : undefined, pegar(raizDepois, 'DSS'));
    if (!assinaturas.length && !dssNoCatalogo) throw alterado('ltv_vazia');
  }
  for (const w of widgetsNovos) conferirWidget(e, dictDe(e.objetos.get(w)!.valor)!, area, tipo === 'ltv');
  // toda referência nova em /Annots aponta para um widget novo desta revisão
  for (const p of e.paginas) {
    const antes = dictDe(anteriores.get(p)?.valor);
    const agora = dictDe(e.objetos.get(p)?.valor);
    const a0 = (antes && (pegar(antes, 'Annots') as PdfValor[] | undefined)) ?? [];
    const a1 = (agora && (pegar(agora, 'Annots') as PdfValor[] | undefined)) ?? [];
    for (const x of a1.slice(a0.length)) if (!ehRef(x) || !widgetsNovos.has(x.num)) throw alterado('annots');
  }
  return assinaturas[0] ?? null;
}

/**
 * RN-144 (5): o que um objeto do base redefinido pode mudar, chave a chave. Stream do base redefinido é SEMPRE recusa
 * (conteúdo da página, fonte, /FontFile2, logo — mesmo com /Type /ObjStm ou /XRef no dicionário novo): nenhum dos
 * objetos que um assinador pode redefinir (Catálogo, /Info, página, /AcroForm, campo pré-criado) é stream.
 */
function redefinido(e: Estado, antes: PdfValor, depois: PdfValor, n: number, tipo: 'assinatura' | 'ltv'): void {
  if (ehStream(antes) || ehStream(depois)) throw alterado('stream_redefinido');
  const a = dictDe(antes), b = dictDe(depois);
  if (!a || !b) throw alterado('objeto_redefinido');
  const mud = chavesMudadas(a, b);
  // ação/anexo só nas chaves que mudaram (o /Names inalterado do Catálogo do pdfkit passa; ver PROIBIDAS)
  for (const k of mud) {
    if (PROIBIDAS.has(k)) throw alterado('acao_ou_anexo');
    const v = b.d.get(k);
    if (v !== undefined) semProibidas(v);
  }
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
  if (ehWidgetDeAssinatura(a, (v) => valorDe(e, v)) && pegar(a, 'Lock') !== undefined) return so(['V', 'AP', 'MK', 'F']);
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
export function conferirAtualizacao(arquivo: Buffer, base: BaseDoDocumento, orc: Orcamento = novoOrcamento()): AssinaturaDaAtualizacao {
  if (arquivo.length < base.bytes || sha256(arquivo.subarray(0, base.bytes)) !== base.sha256) throw new RecusaAssinaturaError('nao_e_o_preparado', 'prefixo');
  // o erro mais comum: reenviar o PDF baixado sem assinar (idêntico ao base, ou o base + bytes soltos sem revisão nova)
  // → o texto da US-144 "Não encontramos assinatura digital neste PDF…", não "Este PDF não é o documento preparado"
  const resto = arquivo.subarray(base.bytes);
  if (!resto.length || !resto.includes('%%EOF', 0, 'latin1')) throw new RecusaAssinaturaError('sem_assinatura', 'sem_revisao');
  try {
    const e = estadoInicial(arquivo.subarray(0, base.bytes), orc);
    const revs = lerAtualizacao(arquivo, base.bytes, orc);
    for (const r of revs) conferirCobertura(arquivo, r);
    if (pegar(revs[0].trailer, 'Prev') !== e.startxref) throw alterado('prev');
    if (num(pegar(revs[0].trailer, 'Root')) !== e.raiz) throw alterado('root');
    const nSig = conferirRevisao(e, revs[0], 'assinatura', base.area, orc)!;
    recalcular(e);
    const sig = conferirByteRange(arquivo, revs[0].objetos.get(nSig)!, revs[0].fim);
    if (revs[1]) {
      if (pegar(revs[1].trailer, 'Prev') !== revs[0].xrefOffset) throw alterado('prev_ltv');
      const nTs = conferirRevisao(e, revs[1], 'ltv', base.area, orc);
      // /ByteRange do carimbo só se houver carimbo (RN-144 (7): a revisão só com /DSS não tem)
      if (nTs !== null) conferirByteRange(arquivo, revs[1].objetos.get(nTs)!, revs[1].fim);
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
  // Minor 4: os bytes ORIGINAIS dos signedAttrs (como o SignedData.verify do pkijs); recodificar com toSchema().toBER()
  // recusaria uma assinatura válida com codificação não canônica
  const original = si.signedAttrs.encodedValue;
  if (!original || !original.byteLength) throw naoConfere('signed_attrs');
  const signedAttrs = Buffer.from(new Uint8Array(original)); // cópia: o [0] muda abaixo
  signedAttrs[0] = 0x31; // [0] IMPLICIT → SET (a assinatura é sobre o SET)
  const regra = ASSINATURAS[sigOid];
  let pss: { saltLength: number } | null = null;
  let hashDaAssinatura: Hash | null = regra === 'digest' ? digest : regra;
  if (sigOid === OID.rsaPss) {
    // Minor 4: PSS sem parâmetros é SHA-1 pela RFC 4055 — recusado como SHA-1 (não "cai" em sha256 e vira "não confere")
    if (!si.signatureAlgorithm.algorithmParams) throw naoAceito('pss_sem_parametros');
    const p = new pkijs.RSASSAPSSParams({ schema: si.signatureAlgorithm.algorithmParams });
    const h = DIGESTS[p.hashAlgorithm.algorithmId];
    if (!h) throw naoAceito('pss_hash');
    hashDaAssinatura = h;
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
  // Minor 5: o nome vai para a /v ("Assinado por"); sem o sufixo ":CPF" da ICP e sem nenhuma sequência de dígitos (um CN
  // gov.br ou de AC com "NOME 123.456.789-09" publicaria o CPF da nutricionista)
  const nome = cn.replace(/:\d{11}$/, '').replace(/\d[\d.\-/ ]*\d|\d/g, '').replace(/\s+/g, ' ').trim();
  if (!nome) throw naoAceito('nome_vazio');
  return { nome, cpf };
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
import { novoOrcamento } from './pdf-leitor';

export type { BaseDoDocumento };
/** `serie`: o número de série do certificado (hex), a identificação do titular no gov.br sem CPF em campo próprio (D8 (a), T5). */
export type Conferido = { tipo: 'govbr' | 'icp'; emissor: string; titularNome: string; cpf: string | null; serie: string; sha256: string };

/**
 * RN-144 inteira, síncrona e SEM REDE (sem-rede.test.ts): prefixo → atualização (forma do /ByteRange, lista fechada,
 * quadro) → CMS → cadeia e validade → titular. "Assinado em" NÃO sai daqui (é a hora do servidor no aceite, T5).
 * Só lança RecusaAssinaturaError (código fixo); o motivoTecnico vai ao log, nunca o CN ou o CPF.
 */
export function conferirPdfAssinado(arquivo: Buffer, base: BaseDoDocumento, deps: { ancoras?: Ancoras; agora?: Date; limiteMs?: number } = {}): Conferido {
  const t0 = performance.now();
  if (arquivo.length > MAX_ENVIO_BYTES || !arquivo.subarray(0, 1024).includes('%PDF-')) throw new RecusaAssinaturaError('arquivo', 'tipo_ou_tamanho');
  // RNF-141: orçamento total de inflate (32 MB) e prazo conferidos DENTRO dos laços do leitor e da lista fechada — código
  // síncrono no processo do Next não é interrompido de fora; o teste do fim só pega o que passou do prazo na criptografia
  const sig = conferirAtualizacao(arquivo, base, novoOrcamento(deps.limiteMs ?? LIMITE_CONFERENCIA_MS));
  const [, a, b, c] = sig.byteRange;
  const cobertos = Buffer.concat([arquivo.subarray(0, a), arquivo.subarray(b, b + c)]);
  // Minor 3 (revisão de segurança): lerCms fora do trecho do ContentInfo, cadeiaAte, titularDoCertificado (otherNames,
  // fromBER, PSS) e o construtor de X509Certificate podem lançar TypeError com ASN.1 estranho — tudo vira "nao_aceito"
  // com motivo fixo (nunca 500, nunca err.message no log)
  try {
    const cms = lerCms(sig.contents);
    conferirCms(cms, cobertos, { cades: sig.subFilter === 'ETSI.CAdES.detached' });
    const { conjunto, emissor } = cadeiaAte(cms.titular, cms.certificados, deps.ancoras ?? carregarAncoras(), deps.agora ?? new Date());
    const titular = titularDoCertificado(cms.titular, conjunto);
    if (performance.now() - t0 > (deps.limiteMs ?? LIMITE_CONFERENCIA_MS)) throw new RecusaAssinaturaError('nao_aceito', 'tempo');
    return { tipo: conjunto, emissor, titularNome: titular.nome, cpf: titular.cpf, serie: cms.titular.serialNumber.toUpperCase(), sha256: createHash('sha256').update(arquivo).digest('hex') };
  } catch (e) {
    if (e instanceof RecusaAssinaturaError) throw e;
    throw new RecusaAssinaturaError('nao_aceito', 'cripto_erro');
  }
}
```

**Negação de serviço (RNF-141, revisão do rascunho):** o leitor roda antes de qualquer criptografia, então basta um documento "Aguardando assinatura" do próprio consultório para mandar um PDF hostil. Por isso o orçamento (32 MB descomprimidos no total, 16 `/ObjStm` por revisão) e o prazo (`LIMITE_CONFERENCIA_MS`) são conferidos **dentro** dos laços do leitor e da lista fechada, e não só no fim — código síncrono no processo do Next não é interrompido de fora, e o semáforo de 2 da rota não protege o event loop. Isolar a conferência em `worker_threads` (com `resourceLimits` e `terminate` aos 3 s) seria a defesa mais forte, mas pede um *bundle* separado no Next 16; fica para o backlog (P10B-07) se o teste de negação de serviço desta tarefa passar perto do limite.

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

**Critério de aceite (P-B2):** o gov.br só é aceito depois que o arquivo real dele passar aqui, e a opção C depois de pelo menos um arquivo real de programa ICP. Até lá, o envio responde "Tipo de assinatura não aceito" para o conjunto que falta — bandeira em `constantes.ts`, conferida na T5 e ligada no commit que traz o resultado do spike:

```ts
/** P-B2: cada conjunto só é aceito depois de um PDF REAL dele passar na conferência (Tarefa 4, Step 7). */
export const ASSINATURAS_LIBERADAS: Record<'govbr' | 'icp', boolean> = { govbr: false, icp: false };
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/documentos/{pdf-atualizacao,cms,certificados,assinatura-pades,assinatura-pades.test,sem-rede.test,sem-rede.fixture,constantes}.ts test/assinatura/fabrica.ts
git commit -m "feat(documentos): conferência do PDF assinado sem rede — /ByteRange estrito, lista fechada por alcance, CMS, cadeia e titular (RN-144)"
```

---
### Task 5: Enviar o PDF assinado — primeiro certificado e troca do titular com 2FA, a parte do certificado nas telas, no guia e na `/v` (US-144, RN-140 b, RN-145, D13, D8 (a); P10B-05; parte específica da antiga T10)

> Da antiga Tarefa 10, ficou aqui só o que é do certificado: o upload do PDF assinado (`/api/painel/documentos/[id]/assinado`), a conferência (T4) chamada fora de transação, o primeiro certificado e a **troca** do titular do consultório com o código do 2FA (RN-145/D13), o `ASSINATURAS_LIBERADAS` e o e-mail "Certificado do consultório confirmado". A ida a "assinado", a verificação pública, a entrega e a conferência da habilitação são as do Plano 10A (`registrar-assinatura.ts`, 10A-T8 e 10A-T10), chamadas daqui no `registrar` do `salvarArquivo` — `assinar.ts` importa `registrar-assinatura.ts`, nunca o contrário (o worker continua sem sessão).
>
> **Minors aplicados:** o semáforo da rota conta a vaga **depois** de ler o corpo e limita um envio por usuária (Minor 6 da revisão de segurança); a habilitação em Fitoterapia é conferida de novo no envio (`exigirHabilitacaoAtual`, Minor 9); D8 (a): sem CPF no gov.br, o titular é o número de série do certificado.

**Files:**
- Create: `src/modules/documentos/assinar.ts` (+ `assinar.test.ts`), `src/app/api/painel/documentos/[id]/assinado/route.ts` (+ `route.test.ts`), `src/app/painel/pacientes/[id]/documentos/[docId]/enviar-assinado.tsx`
- Modify: a página do documento (10A-T6: o cartão "Aguardando assinatura" com o texto do gov.br e do certificado e o `<EnviarAssinado />`), `src/modules/ajuda/conteudo.ts` (guias `documentos` e `seguranca`), `src/modules/documentos/verificacao.ts` (`MSG_VERIFICACAO.validador`) + `src/app/v/[codigo]/page.tsx` (link do ITI) + `verificacao-publica.test.ts`, `src/modules/documentos/portal.test.ts` (caso do gov.br), `src/email/types.ts` + `src/email/templates.tsx` (`certificado_confirmado`)

**Interfaces:**
- Consumes: `conferirPdfAssinado`, `Conferido`, `normalizarNome` (T4); `ASSINATURAS_LIBERADAS`, `MAX_ENVIO_BYTES` (T4, `constantes.ts`); `Titular`, `lerAssinante`, `gravarAssinante`, `hmacDoTitular`, `identificacaoDoTitular` (T3); do Plano 10A: `registrarAssinatura`, `exigirHabilitacaoAtual`, `AcessoAssinatura`, `DepsAssinar` (10A-T8, `registrar-assinatura.ts`), `confirmarCodigo2fa` (10A-T4), `novoConsultorio`, `outroDocumento`, `novoPreparoNoBanco` (10A-T8, testes), `soltarArquivosDoPreparo` (10A-T5, `arquivos-do-preparo.ts`), `EMITIDOS` (10A-T1, `constantes.ts`), `salvarArquivo`, `recordAudit`, `enqueueEmail`, `mesmaOrigem`, `requireApiNutri`, `lerCorpoLimitado`; `baseMinimo` e a fábrica (T1, testes).
- Produces:
  - `assinar.ts`: `DepsEnvio = DepsAssinar & { ancoras?: Ancoras; liberadas?: Record<'govbr' | 'icp', boolean> }`; `ResultadoEnvio = { tipo: 'assinado' } | { tipo: 'confirmar_certificado'; nome: string; identificacao: string; anterior: string | null }` (`anterior` ≠ null = troca do titular do consultório); `aceitarPdfAssinado(a: AcessoAssinatura, docId: string, arquivo: Buffer, input: { codigo2fa?: unknown }, deps: DepsEnvio): Promise<ResultadoEnvio>`; `titularDoConferido(c: Conferido): Titular | null`.
  - E-mail `{ tipo: 'certificado_confirmado'; para: string; identificacao: string; anterior: string | null }`.
  - Rota `POST /api/painel/documentos/[id]/assinado` → `200 { ok: true }` | `200 { confirmar: { nome, identificacao, anterior } }` | `422 { erro, codigo }` | `404` | `409` | `413` | `429` | `507`.

- [ ] **Step 1: Testes (falham)** — `src/modules/documentos/assinar.test.ts`

```ts
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { baseMinimo } from '../../../test/assinatura/base-minimo';
import { assinarDeTeste, criarAc, criarTitular, type AcDeTeste, type TitularDeTeste } from '../../../test/assinatura/fabrica';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento } from '../../../test/documentos';
import { emailsNaFila } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import type { Ancoras } from './ancoras';
import { aceitarPdfAssinado } from './assinar';
import { RecusaAssinaturaError, TransicaoInvalidaError, type CodigoRecusa } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

let ac: AcDeTeste, gov: AcDeTeste;
let debby: TitularDeTeste, outra: TitularDeTeste;
let ancoras: Ancoras;
const BASE = baseMinimo();
beforeAll(async () => {
  ac = await criarAc();
  gov = await criarAc({ nome: 'AC gov.br de Teste' });
  ancoras = { raizesIcp: [ac.raiz], acsIcp: [ac.intermediaria], govbr: { raiz: gov.raiz, intermediaria: gov.intermediaria, final: gov.intermediaria } };
  debby = await criarTitular(ac, { nome: 'DEBORA SILVA SANTOS', cpf: '12345678909' });
  outra = await criarTitular(ac, { nome: 'OUTRA PESSOA', cpf: '98765432100' });
}, 60_000);

/** Um documento "Aguardando assinatura" cujo PDF base é o `baseMinimo()` do leitor (o que a fábrica assina). */
const aguardando = async () => outroDocumento(await novoConsultorio(app.db), app.db, { base: BASE });
const deps = (dataDir: string, codigo: 'ok' | 'invalido' | 'bloqueado' = 'ok') => ({
  db: app.db, dataDir, ancoras, headers: new Headers(), liberadas: { govbr: true, icp: true }, appUrl: 'https://x', confirmar2fa: async () => codigo,
});
const recusa = (c: CodigoRecusa) => (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === c;

describe('enviar o PDF assinado (US-144, RN-145)', () => {
  it('sem 2FA ativo → recusa antes de qualquer conferência', async () => {
    const x = await aguardando();
    await expect(aceitarPdfAssinado({ ...x.acesso, user: { ...x.acesso.user, twoFactorEnabled: false } }, x.id, await assinarDeTeste(BASE, debby), {}, deps(x.dataDir))).rejects.toSatisfy(recusa('sem_2fa'));
  });

  it('primeiro certificado de outra pessoa → recusa com o nome do certificado; nenhum titular gravado; nada muda', async () => {
    const x = await aguardando();
    await expect(aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, outra), {}, deps(x.dataDir))).rejects.toSatisfy(
      (e) => recusa('outro_titular_primeiro')(e) && (e as RecusaAssinaturaError).mensagem().includes('OUTRA PESSOA'),
    );
    expect((await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from tenant_signer`), app.db)).rows).toEqual([]);
  });

  it('primeiro certificado com o nome certo: pede "Sim, sou eu" com a máscara; código errado → recusa e registra a tentativa; código certo → assinado', async () => {
    const x = await aguardando();
    const pdf = await assinarDeTeste(BASE, debby);
    expect(await aceitarPdfAssinado(x.acesso, x.id, pdf, {}, deps(x.dataDir))).toEqual({ tipo: 'confirmar_certificado', nome: 'DEBORA SILVA SANTOS', identificacao: 'CPF ***.456.789-**', anterior: null });
    await expect(aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '000000' }, deps(x.dataDir, 'invalido'))).rejects.toSatisfy(recusa('codigo_2fa'));
    const tent = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select acao, entidade from audit_log where entidade = 'tentativa_assinatura'`), app.db);
    expect(tent.rows).toEqual([{ acao: 'criar', entidade: 'tentativa_assinatura' }]);
    await expect(aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '000000' }, deps(x.dataDir, 'bloqueado'))).rejects.toSatisfy(recusa('tentativas_2fa'));
    expect(await aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '123456' }, deps(x.dataDir))).toEqual({ tipo: 'assinado' });
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_sha256, base_pdf_path, assinatura_tipo, assinante_nome, codigo from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, string | null>[];
    // regra 9: o registrar mantém o base apontado; o base_pdf_path nulo, o registro e o arquivo fora vêm do
    // soltarArquivosDoPreparo (10A-T5) depois do salvarArquivo — o ponteiro sai no naMesmaTransacao do apagarArquivo do base
    expect(d).toMatchObject({ status: 'assinado', pdf_sha256: createHash('sha256').update(pdf).digest('hex'), base_pdf_path: null, assinatura_tipo: 'icp', assinante_nome: 'DEBORA SILVA SANTOS' });
    const v = (await app.db.execute(sql`select situacao, pdf_sha256, emissor_nome, emissor_crn, assinante_nome from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v).toEqual({ situacao: 'valido', pdf_sha256: d.pdf_sha256, emissor_nome: 'Débora Silva Santos', emissor_crn: 'CRN-3 12345', assinante_nome: 'DEBORA SILVA SANTOS' });
    expect((await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${x.base}`), app.db)).rows).toEqual([]);
    await expect(access(path.join(x.dataDir, x.base))).rejects.toThrow();
    const s = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select titular_identificacao from tenant_signer`), app.db);
    expect(s.rows).toEqual([{ titular_identificacao: 'CPF ***.456.789-**' }]);
  });

  it('depois do primeiro: o mesmo CPF assina sem código; outro CPF com outro nome → "O PDF foi assinado por outra pessoa."', async () => {
    const x = await aguardando();
    await aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, debby), { codigo2fa: '123456' }, deps(x.dataDir));
    const y = await outroDocumento(x, app.db, { base: BASE });
    expect(await aceitarPdfAssinado(x.acesso, y.id, await assinarDeTeste(BASE, debby), {}, deps(x.dataDir))).toEqual({ tipo: 'assinado' });
    const w = await outroDocumento(x, app.db, { base: BASE });
    await expect(aceitarPdfAssinado(x.acesso, w.id, await assinarDeTeste(BASE, outra), {}, deps(x.dataDir))).rejects.toSatisfy(recusa('outra_pessoa'));
  });

  it('troca do CPF do consultório (RN-145, D13): mesmo nome e outro CPF → confirmação com o anterior; com o 2FA troca, audita e avisa; outro nome → recusa', async () => {
    const x = await aguardando();
    await aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, debby), { codigo2fa: '123456' }, deps(x.dataDir));
    const novoCert = await criarTitular(ac, { nome: 'Débora Silva Santos', cpf: '11144477735' }); // certificado novo (ou o CPF agora lido certo)
    const y = await outroDocumento(x, app.db, { base: BASE });
    const pdf = await assinarDeTeste(BASE, novoCert);
    expect(await aceitarPdfAssinado(x.acesso, y.id, pdf, {}, deps(x.dataDir))).toEqual({ tipo: 'confirmar_certificado', nome: 'Débora Silva Santos', identificacao: 'CPF ***.444.777-**', anterior: 'CPF ***.456.789-**' });
    await expect(aceitarPdfAssinado(x.acesso, y.id, pdf, { codigo2fa: '000000' }, deps(x.dataDir, 'invalido'))).rejects.toSatisfy(recusa('codigo_2fa'));
    expect(await aceitarPdfAssinado(x.acesso, y.id, pdf, { codigo2fa: '123456' }, deps(x.dataDir))).toEqual({ tipo: 'assinado' });
    expect((await withTenant(x.T.ctx, (tx) => tx.execute(sql`select titular_identificacao from tenant_signer`), app.db)).rows).toEqual([{ titular_identificacao: 'CPF ***.444.777-**' }]);
    const aud = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select acao from audit_log where entidade = 'perfil_profissional' order by em`), app.db);
    expect(aud.rows).toEqual([{ acao: 'criar' }, { acao: 'alterar' }]);
    expect((await emailsNaFila('certificado_confirmado', 'd@x.com')).at(-1)).toMatchObject({ identificacao: 'CPF ***.444.777-**', anterior: 'CPF ***.456.789-**' });
    const w = await outroDocumento(x, app.db, { base: BASE });
    await expect(aceitarPdfAssinado(x.acesso, w.id, await assinarDeTeste(BASE, outra), { codigo2fa: '123456' }, deps(x.dataDir))).rejects.toSatisfy(recusa('outra_pessoa'));
  });

  it('D8 (a): gov.br sem CPF em campo próprio → titular pelo número de série; cada certificado novo pede o 2FA de novo', async () => {
    const x = await aguardando();
    const govSemCpf = await criarTitular(gov, { nome: 'DEBORA SILVA SANTOS', tipo: 'govbr' });
    const r = await aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, govSemCpf), {}, deps(x.dataDir));
    expect(r).toMatchObject({ tipo: 'confirmar_certificado', nome: 'DEBORA SILVA SANTOS', anterior: null });
    expect((r as { identificacao: string }).identificacao).toMatch(/^certificado gov\.br de série …[0-9A-F]{1,4}$/);
    expect(await aceitarPdfAssinado(x.acesso, x.id, await assinarDeTeste(BASE, govSemCpf), { codigo2fa: '123456' }, deps(x.dataDir))).toEqual({ tipo: 'assinado' });
    const renovado = await criarTitular(gov, { nome: 'DEBORA SILVA SANTOS', tipo: 'govbr' }); // outra série (renovação anual)
    const y = await outroDocumento(x, app.db, { base: BASE });
    expect(await aceitarPdfAssinado(x.acesso, y.id, await assinarDeTeste(BASE, renovado), {}, deps(x.dataDir))).toMatchObject({ tipo: 'confirmar_certificado', anterior: (r as { identificacao: string }).identificacao });
  });

  it('Minor 9: fitoterápico formulado com a habilitação retirada depois do preparo → "sem_habilitacao" antes da conferência', async () => {
    const x = await aguardando();
    const tenantSemHabilitacao = { ...x.acesso.tenant, fitoterapiaRegistro: null };
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 à noite', nomePopular: '', duracao: '', padronizacao: '' };
    const comFito = await outroDocumento(x, app.db, { base: BASE, conteudo: { versao: 1, tipo: 'receita', itens: [fito], orientacoes: '', copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: true }, paciente: { nome: 'Ana Souza' } } } });
    await expect(aceitarPdfAssinado({ ...x.acesso, tenant: tenantSemHabilitacao }, comFito.id, await assinarDeTeste(BASE, debby), {}, deps(x.dataDir))).rejects.toSatisfy(recusa('sem_habilitacao'));
  });

  it('versão lida: "Voltar a editar" e um novo preparo durante o envio → 409 e nada muda (o PDF antigo nunca assina o conteúdo novo)', async () => {
    const x = await aguardando();
    const pdf = await assinarDeTeste(BASE, debby);
    // o código do 2FA é conferido entre a conferência do PDF e o registrar: o novo preparo acontece "noutra aba" bem ali
    const noMeio = async () => (await novoPreparoNoBanco(x, app.db), 'ok' as const);
    await expect(aceitarPdfAssinado(x.acesso, x.id, pdf, { codigo2fa: '123456' }, { ...deps(x.dataDir), confirmar2fa: noMeio })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'aguardando_assinatura', pdf_path: null });
    expect((await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from tenant_signer`), app.db)).rows).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/documentos/assinar.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Aceitar o envio** — `src/modules/documentos/assinar.ts`

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { confirmarCodigo2fa } from '@/lib/confirmar-2fa';
import { logger } from '@/lib/logger';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import type { Ancoras } from './ancoras';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { gravarAssinante, hmacDoTitular, identificacaoDoTitular, lerAssinante, type Titular } from './assinante';
import { conferirPdfAssinado, type Conferido } from './assinatura-pades';
import { normalizarNome } from './certificados';
import { ASSINATURAS_LIBERADAS, EMITIDOS, type AreaAssinatura } from './constantes';
import { DocumentoNaoEncontradoError, RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import type { CopiaProfissional } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';
import { exigirHabilitacaoAtual, registrarAssinatura, type AcessoAssinatura, type DepsAssinar } from './registrar-assinatura';

export type DepsEnvio = DepsAssinar & { ancoras?: Ancoras; liberadas?: Record<'govbr' | 'icp', boolean> };
/** `anterior` ≠ null = TROCA do titular do consultório (RN-145, D13): a tela mostra a identificação antiga junto. */
export type ResultadoEnvio = { tipo: 'assinado' } | { tipo: 'confirmar_certificado'; nome: string; identificacao: string; anterior: string | null };

/** RN-145 / D8 ★ (a): o CPF do campo próprio; sem ele, no gov.br, o número de série do certificado; senão, ninguém. */
export function titularDoConferido(c: Conferido): Titular | null {
  if (c.cpf) return { tipo: 'cpf', cpf: c.cpf };
  return c.tipo === 'govbr' ? { tipo: 'serie', serie: c.serie } : null;
}

type Lido = {
  patientId: string; codigo: string; base: string; sha: string; bytes: number; area: AreaAssinatura; conteudo: ConteudoReceita; copia: CopiaProfissional;
  assinante: { titularHmac: string; identificacao: string } | null;
};

async function lerParaAssinar(ctx: TenantContext, docId: string, db: Db): Promise<Lido> {
  return withTenant(ctx, async (tx) => {
    const [d] = await tx.select().from(signedDocuments).where(eq(signedDocuments.id, docId));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'aguardando_assinatura' || !d.basePdfPath || !d.basePdfSha256 || !d.basePdfBytes || !d.areaAssinatura || !d.codigo) throw new TransicaoInvalidaError();
    const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId));
    if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
    const conteudo = d.conteudo as ConteudoReceita;
    return {
      patientId: d.patientId, codigo: d.codigo, base: d.basePdfPath, sha: d.basePdfSha256, bytes: d.basePdfBytes, area: d.areaAssinatura,
      conteudo, copia: conteudo.copia!.profissional, assinante: await lerAssinante(tx),
    };
  }, db);
}

/**
 * US-144 / RN-145. Ordem: 2FA ativo → leitura (versão) e habilitação (Minor 9) → conferência (fora de transação, sem
 * rede, T4) → quem assina (o titular do consultório; ou o primeiro certificado, ou a TROCA do titular, os dois com o nome
 * do certificado = nome do perfil e o código do 2FA) → salvarArquivo do assinado (substitui o base na conta da cota; o
 * registrar troca/grava o assinante e chama o registrarAssinatura do 10A, amarrado à versão lida, que MANTÉM o base
 * apontado) → regra 9: soltarArquivosDoPreparo (10A-T5) apaga o base no seu apagarArquivo, com o ponteiro saindo no
 * naMesmaTransacao (o que falhar, a varredura da 10A-T7 repete).
 * Nada é gravado numa recusa.
 */
export async function aceitarPdfAssinado(a: AcessoAssinatura, docId: string, arquivo: Buffer, input: { codigo2fa?: unknown }, deps: DepsEnvio): Promise<ResultadoEnvio> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (!a.user.twoFactorEnabled) throw new RecusaAssinaturaError('sem_2fa');
  const d = await lerParaAssinar(a.ctx, docId, db);
  exigirHabilitacaoAtual(a.tenant, d.conteudo);
  const c = conferirPdfAssinado(arquivo, { bytes: d.bytes, sha256: d.sha, area: d.area }, { ancoras: deps.ancoras, agora });
  if (!(deps.liberadas ?? ASSINATURAS_LIBERADAS)[c.tipo]) throw new RecusaAssinaturaError('nao_aceito', 'assinador_nao_liberado');
  const titular = titularDoConferido(c);
  if (!titular) throw new RecusaAssinaturaError('nao_aceito', 'certificado_sem_cpf');
  const primeiro = !d.assinante;
  // RN-145 / D13 / D8 (a): titular diferente do confirmado no consultório = TROCA, só com o nome do certificado igual ao do
  // perfil e o código do 2FA (certificado novo, renovação do gov.br sem CPF, CPF lido errado no primeiro envio, troca da
  // ENCRYPTION_KEY que muda o HMAC); com outro nome, "O PDF foi assinado por outra pessoa." — sem saída pelo banco
  const troca = !!d.assinante && hmacDoTitular(titular) !== d.assinante.titularHmac;
  const mesmoNome = normalizarNome(c.titularNome) === normalizarNome(d.copia.nomeCompleto);
  if (troca && !mesmoNome) throw new RecusaAssinaturaError('outra_pessoa', 'titular_diferente');
  if (primeiro || troca) {
    if (!mesmoNome) throw new RecusaAssinaturaError('outro_titular_primeiro', 'nome_diferente', c.titularNome);
    if (input.codigo2fa === undefined || input.codigo2fa === null || input.codigo2fa === '') {
      return { tipo: 'confirmar_certificado', nome: c.titularNome, identificacao: identificacaoDoTitular(titular), anterior: d.assinante?.identificacao ?? null };
    }
    const r = await (deps.confirmar2fa ?? ((e) => confirmarCodigo2fa(e, { db })))({ userId: a.user.id, codigo: input.codigo2fa, headers: deps.headers });
    if (r === 'bloqueado') throw new RecusaAssinaturaError('tentativas_2fa');
    if (r === 'invalido') {
      await withTenant(a.ctx, (tx) => recordAudit(tx, { acao: 'criar', entidade: 'tentativa_assinatura', entidadeId: docId, patientId: d.patientId }), db);
      logger.warn({ tenantId: a.ctx.tenantId, documentoId: docId }, 'código do 2FA recusado ao assinar');
      throw new RecusaAssinaturaError('codigo_2fa');
    }
  }
  // 10A, code review do PR #19 (I3): com o código já aceito, uma falha do salvarArquivo abaixo (507, 409, gravação) devolve
  // a marca anti-repetição — `.catch(async (e) => { await (deps.liberar2fa ?? ((x) => liberarCodigo2fa(x, { db })))({ userId: a.user.id, codigo: input.codigo2fa }).catch(() => undefined); throw e; })`, como a digitalizada
  await salvarArquivo(
    a.ctx,
    {
      tipo: 'documento_assinado', conteudo: arquivo, permitidos: ['pdf'], patientId: d.patientId, substitui: d.base,
      antesDaReserva: async (tx) => {
        const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, d.patientId)).for('update');
        if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new PacienteBloqueadoError();
        await travarDocumentoAntesDaCota(tx, docId); // 10A, code review do PR #19 (I2): paciente → documento → tenant, como o soltarArquivosDoPreparo
      },
      registrar: async (tx, arq) => {
        if (primeiro || troca) await gravarAssinante(tx, { tenantId: a.ctx.tenantId, titular, userId: a.user.id, agora, anterior: d.assinante?.titularHmac ?? null });
        await registrarAssinatura(tx, {
          documentoId: docId, codigo: d.codigo, patientId: d.patientId, tenantId: a.ctx.tenantId, caminho: arq.caminho, sha256: c.sha256, tipo: c.tipo,
          emissor: c.emissor, assinanteNome: c.titularNome, userId: a.user.id, agora, copia: d.copia, base: d.base,
          versao: { codigo: d.codigo, baseSha256: d.sha }, appUrl: deps.appUrl ?? getEnv().APP_URL,
        });
        if (primeiro || troca) await enqueueEmail({ tipo: 'certificado_confirmado', para: a.user.email, identificacao: identificacaoDoTitular(titular), anterior: d.assinante?.identificacao ?? null }, { tenantId: a.ctx.tenantId, tx });
      },
    },
    { db, dataDir: deps.dataDir },
  );
  // regra 9: a assinatura já valeu; o base (e fotos de uma digitalização que tenha ficado) sai agora, cada arquivo no seu
  // apagarArquivo com o ponteiro no naMesmaTransacao — uma falha aqui não desfaz a assinatura (a varredura repete)
  await soltarArquivosDoPreparo(a.ctx, docId, EMITIDOS, { db, dataDir: deps.dataDir })
    .catch(() => logger.warn({ tenantId: a.ctx.tenantId, documentoId: docId }, 'PDF base não apagado depois da assinatura (a varredura apaga)'));
  return { tipo: 'assinado' };
}
```

E-mail (`src/email/types.ts`): `| { tipo: 'certificado_confirmado'; para: string; identificacao: string; anterior: string | null }`; template (`templates.tsx`):

```tsx
    case 'certificado_confirmado':
      return simples('Certificado do consultório confirmado', [
        msg.anterior
          ? `O certificado do consultório para assinar documentos no NutriDebby foi trocado: ${msg.anterior} deu lugar a ${msg.identificacao}.`
          : `O certificado com ${msg.identificacao} passou a ser o do consultório para assinar documentos no NutriDebby.`,
        'Se não foi você, troque a senha e fale com o suporte.',
      ]);
```

Run: `pnpm test src/modules/documentos/assinar.test.ts` → PASS.

- [ ] **Step 3: Rota** — `src/app/api/painel/documentos/[id]/assinado/route.ts`

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
/**
 * RNF-141: a conferência usa até 3 s de CPU no processo do Next; no máximo 2 ao mesmo tempo e uma por usuária. Minor 6
 * da revisão de segurança: a vaga só é ocupada DEPOIS de ler o corpo (até 60 s) — dois envios lentos não seguram a
 * assinatura de todos os consultórios.
 */
const MAX_CONFERENCIAS = 2;
let emAndamento = 0;
const porUsuaria = new Set<string>();

/** US-144: multipart (arquivo, codigo2fa opcional). Route Handler (o proxy corta corpo de Server Action em 10 MB). */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/documentos/[id]/assinado'>) {
  if (!mesmaOrigem(req)) return resposta(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return resposta(404, { erro: 'Documento não encontrado.' });
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erro: MSG_RECUSA.arquivo });
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
  const userId = acesso.data.user.id;
  if (emAndamento >= MAX_CONFERENCIAS || porUsuaria.has(userId)) return resposta(429, { erro: 'Outro envio está em andamento. Tente de novo em instantes.' });
  emAndamento++;
  porUsuaria.add(userId);
  try {
    const r = await aceitarPdfAssinado(
      { ctx: acesso.ctx, tenant: acesso.tenant, user: { id: userId, email: acesso.data.user.email, twoFactorEnabled: acesso.data.user.twoFactorEnabled ?? null } },
      id, Buffer.from(await arquivo.arrayBuffer()), { codigo2fa: form.get('codigo2fa') ?? undefined }, { headers: req.headers },
    );
    return resposta(200, r.tipo === 'assinado' ? { ok: true } : { confirmar: { nome: r.nome, identificacao: r.identificacao, anterior: r.anterior } });
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
    porUsuaria.delete(userId);
  }
}
```

`route.test.ts` (padrão dos exames e da rota da digitalizada, 10A-T9): origem estranha → 403; sem sessão → 401; corpo de 11 MB → 413 com "Envie o PDF assinado (até 10 MB)."; PDF adulterado da fábrica → 422 com a mensagem de "alterado" e o documento continua "Aguardando assinatura"; dois envios da mesma usuária ao mesmo tempo → o segundo 429; o log da recusa (spy no `logger.info`) tem só `tenantId`, `documentoId` e `motivo` (nada de CN/CPF). Para a rota usar a AC de teste, o teste troca as âncoras por `vi.mock('@/modules/documentos/ancoras', …)` e liga `ASSINATURAS_LIBERADAS` por `vi.mock('@/modules/documentos/constantes', async (o) => ({ ...(await o()), ASSINATURAS_LIBERADAS: { govbr: true, icp: true } }))`.

- [ ] **Step 4: Tela de envio** — `enviar-assinado.tsx`

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Botao } from '@/components/ui/botao';

type Confirmar = { nome: string; identificacao: string; anterior: string | null };

/** US-144: envio do PDF assinado; no primeiro certificado e na troca do titular do consultório, "Sim, sou eu" reenvia o MESMO arquivo com o código do 2FA (D13). */
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
          <p id="confirmar-cert">{`Assinado por ${confirmar.nome} (${confirmar.identificacao}). Este é o seu certificado?`}</p>
          {confirmar.anterior && <p>{`O certificado confirmado no consultório era o de ${confirmar.anterior}. Ao confirmar, este passa a ser o certificado do consultório.`}</p>}
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

Na página do documento (10A-T6), o cartão "Aguardando assinatura" troca o parágrafo do 10A ("Baixe o PDF, imprima, assine à mão e envie fotos das páginas aqui.") por:

```tsx
          <p>
            Assine o PDF no assinador do gov.br (assinador.iti.br) ou com o seu certificado ICP-Brasil e envie o arquivo assinado aqui. Sem gov.br nem certificado, imprima, assine à mão e envie fotos das páginas.
          </p>
          <p className="text-sm text-suave">Se o assinador pedir o lugar da assinatura visível, use o quadro &quot;Assinatura digital&quot; no fim da página.</p>
```

e, depois do aviso do 2FA e antes do `<EnviarDigitalizada />` (10A-T9): `{data.user.twoFactorEnabled && !bloqueado && !['recebendo', 'pendente'].includes(d.digitalizacaoStatus ?? '') && <EnviarAssinado docId={d.id} />}`.

- [ ] **Step 5: Guias, verificação pública e portal com o gov.br e o certificado**

`src/modules/ajuda/conteudo.ts`:
- Guia `documentos`, `versao: 2`: `resumo` volta a "Receitas de suplementos e fitoterápicos com os campos que o CFN exige, assinadas por você no gov.br, com o seu certificado ICP-Brasil ou à mão, e entregues ao paciente com código de verificação."; o 3º item do "Passo a passo" passa a 'Clique em "Baixar PDF para assinar", assine no assinador do gov.br ou com o seu certificado e envie o arquivo assinado. Sem gov.br nem certificado, use "Enviar documento digitalizado (assinado à mão)".'; o passo `assinar-documento` passa a 'Baixe o PDF, assine no gov.br ou com o seu certificado e envie o arquivo assinado. O sistema confere a assinatura. Sem certificado, envie fotos das páginas assinadas à mão.'; nas "Perguntas comuns", "Na primeira assinatura com certificado, o sistema mostra o nome e o CPF mascarado do certificado e pede o código da verificação em duas etapas."
- Guia `seguranca`, `versao: 2`: o item das perguntas comuns passa a 'Ao assinar documentos, o sistema pede o código do aplicativo no primeiro certificado do consultório, na troca do certificado (outro CPF, ou outro certificado gov.br, com o mesmo nome) e em todo envio digitalizado.'

`src/modules/documentos/verificacao.ts` (10A-T8/T13): `MSG_VERIFICACAO.validador = 'Validar a assinatura no validador oficial do ITI'`. Em `src/app/v/[codigo]/page.tsx`, no lugar do comentário do 10A:

```tsx
          {r.v.assinatura !== 'Digitalizado' && (
            <a href="https://validar.iti.gov.br" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">{MSG_VERIFICACAO.validador}</a>
          )}
```

Em `verificacao-publica.test.ts` (10A-T13), um caso novo:

```ts
  it('gov.br: "Assinado por" e o rótulo "gov.br" (o link do ITI aparece na página; na digitalizada, não)', async () => {
    const { codigo } = await verificacao('valido', 'govbr');
    expect(await consultarVerificacao(codigo, { db: app.db, ipDoLimite: ip() })).toMatchObject({ tipo: 'ok', v: { assinanteNome: 'DEBORA SILVA SANTOS', assinatura: 'gov.br' } });
  });
```

Em `portal.test.ts` (10A-T11), o caso da RN-157 ganha o gov.br:

```ts
    const gov = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', assinaturaTipo: 'govbr' });
    // …
    expect(linhaDaAssinatura(lista.find((d) => d.id === gov.id)!.assinaturaTipo)).toBe('Assinatura: gov.br');
```

O E2E (`e2e/documentos.spec.ts`, 10A-T16) já confere que a `/v` da digitalizada não mostra o link do ITI; continua valendo.

Run: `pnpm test src/modules/documentos src/app/api/painel/documentos src/modules/ajuda src/email && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/documentos/{assinar,assinar.test,verificacao,verificacao-publica.test,portal.test}.ts src/app/api/painel/documentos/[id]/assinado src/app/painel/pacientes/[id]/documentos/[docId] src/app/v src/modules/ajuda src/email
git commit -m "feat(documentos): envio do PDF assinado — primeiro certificado e troca do titular com 2FA, gov.br e ICP-Brasil nas telas (US-144, RN-145, D8)"
```

---
### Task 6 (CONDICIONAL — só se o relatório do spike pedir): conferência de conteúdo assíncrona no worker (D16 = (a) da spec; P10B-06; antiga T19)

> Entra **só** se o relatório da T2 cair numa das linhas "T6" da tabela de decisão (assinador que reescreve o arquivo, `/ObjStm` instável, carimbo fora do quadro sem controle). Sem isso, nada desta tarefa é feito e `pdfjs-dist` não entra.

**Files:**
- Create: `src/modules/documentos/conferencia-visual-job.ts` (+ `conferencia-visual-job.test.ts`)
- Modify: `src/modules/documentos/assinar.ts` (ramo assíncrono), `src/modules/documentos/assinatura-pades.ts` (`conferirPdfAssinado(…, { soCriptografia: true })`), `src/jobs/queues.ts` (`documento-conferir`), `src/worker/index.ts`, a página do documento ("Conferindo o PDF assinado…"), `package.json` (`pdfjs-dist@6.4.299` só no worker), `src/modules/pacientes/exportacao.test.ts` (o pacote `pdfjs-dist` na lista dos proibidos no grafo do Next), `src/db/schema/documentos.ts` + migration `0094_conferencia_assincrona` (gerada: `conferencia_status text` e `conferencia_path text` → `stored_files.caminho` NO ACTION) + `0095_gatilho_conferencia` (custom: `CREATE OR REPLACE FUNCTION app_documento_imutavel()` do 10A-T2 com as duas colunas novas nas listas do mesmo estado e da assinatura, liberadas só em `aguardando_assinatura`, e limpas pela `app_anonimizar_documentos`; teste novo em `documentos-imutaveis.test.ts`)

**Interfaces:**
- Consumes: `conferirAtualizacao` (só a parte de forma do `/ByteRange` e o CMS continuam síncronos), `registrarAssinatura` (10A-T8, com a entrega da 10A-T10; o job importa `registrar-assinatura.ts`, sem sessão).
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

- [ ] **Step 3: O ramo assíncrono** — `aceitarPdfAssinado` com `{ soCriptografia: true }` na conferência (prefixo dispensado só para o assinador do relatório que reescreve o arquivo; forma do `/ByteRange`, CMS, cadeia e titular continuam síncronos): grava o PDF enviado como `documento_assinado` pendente (`conferencia_path`, `conferencia_status = 'pendente'`) e enfileira `documento-conferir`; o job lê o base e o enviado, roda `compararConteudo` e, se `'igual'`, chama o `registrarAssinatura` (10A-T8/10A-T10, `versao: { codigo, baseSha256 }`) na transação e, depois do commit, `soltarArquivosDoPreparo(ctx, id, EMITIDOS)` (regra 9, como na Tarefa 5); se diferente, apaga o enviado (`apagarArquivo` com o `naMesmaTransacao` limpando os dois campos) e grava `conferencia_status = 'recusado'` com o motivo; a tela mostra "Conferindo o PDF assinado…" e, na recusa, "Este PDF recebeu alterações além da assinatura. Baixe o PDF de novo, assine sem editar e envie.". Meta do job: 30 s (p95) (RNF-140 v0.3).

- [ ] **Step 4: Rodar e commit**

Run: `pnpm test src/modules/documentos src/modules/pacientes/exportacao.test.ts` → PASS.

```bash
git add src/modules/documentos src/jobs/queues.ts src/worker/index.ts package.json pnpm-lock.yaml drizzle src/db/schema/documentos.ts src/modules/pacientes/exportacao.test.ts
git commit -m "feat(documentos): conferência de conteúdo assíncrona no worker para o assinador que reescreve o PDF (D16 a)"
```

---

## Runbook do Plano 10B (o dono faz; nada disto é código)

1. **PDFs reais para o spike (P-B2, Tarefa 2 Step 1).** Com os dois PDFs fictícios gerados pela Tarefa 1 (`base.pdf` e `base-com-campo.pdf`, enviados por canal privado): a Debby (ou o dono) assina no **assinador.iti.br** com a conta gov.br prata/ouro — (a) carimbo onde o assinador propõe, (b) dentro do quadro "Assinatura digital", (c) sem carimbo visível, se houver a opção — e, se houver e-CPF, no **Adobe Acrobat Reader** e no **Assinador SERPRO** (gratuitos); para cada arquivo, o **relatório de conformidade do VALIDAR** (validar.iti.gov.br). Os arquivos voltam para `test/assinatura/reais/` na máquina de dev (**nunca** no git: têm nome e CPF reais). Só documento fictício; nunca receita de paciente real no VALIDAR.
2. **Consulta ao CRN-3 (P-B1):** a mesma do Plano 10A; para este plano, a pergunta (i) — o gov.br (assinatura avançada) atende o "assinatura digital certificada" das Res. 656/680 na receita? Se o CRN-3 recusar o gov.br, `ASSINATURAS_LIBERADAS.govbr` fica `false` e a receita segue com C (ICP-Brasil) e E (digitalizada), pela D1 da spec.
3. **Textos para a Debby revisar:** os da US-144 do certificado ("(proposto)"), a dica do quadro, o e-mail "Certificado do consultório confirmado", a confirmação da troca e os guias `documentos` e `seguranca` na v2.
4. **Deploy (merge = deploy), com o OK do dono e snapshot no hPanel antes.** As migrations 0092–0093 (ou a numeração depois de outros planos) criam `tenant_signer` e trocam dois CHECKs para aceitar mais valores (sem migração de dados; a validação lê `signed_documents` e `document_verifications` uma vez). Nenhuma variável nova. Com `ASSINATURAS_LIBERADAS` desligado, nada muda para a Debby: o envio do PDF assinado responde "Tipo de assinatura não aceito" e a digitalizada continua.
5. **Liberação de cada assinador** (PR curto, com o resultado do spike): `ASSINATURAS_LIBERADAS` liga o conjunto cujo arquivo real passou na conferência (Tarefa 4, Step 7); `CAMPO_PRE_CRIADO` conforme o relatório; o checklist do `docs/operacao/go-live.md` ganha a seção do 10B (teste manual com um PDF real assinado no gov.br da Debby e um paciente de teste; a `/v` com o link do ITI).
6. **Trimestral (D7 ★):** atualização das âncoras (`docs/operacao/ancoras-assinatura.md`) — o Claude faz a pedido do dono.

## Fechamento do plano (após a Tarefa 5, ou a 6)

- [ ] Revisão da entrega conforme o índice (revista em 02/10/2026): revisor por tarefa (ao longo) → **revisão final do branch (workflow) com uma onda de correções** → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor → backlog) → re-revisão **só do diff das correções** → `/security-review` com o **checklist reforçado** (D9 ★):
  - **Conferência (RN-144):** forma do `/ByteRange` `[0 a b c]` com um único dicionário de assinatura e `b + c` = fim da revisão; lista fechada por alcance e comparação chave a chave dos redefinidos (fonte, stream, `/Resources`, `/MediaBox` recusados); geração igual nos redefinidos e 0 nos novos; nenhum objeto fora da xref; widget só de campo `/FT /Sig`, de área zero ou no quadro, `/BBox` de cada estado dentro do `/Rect`; `/AcroForm` novo só com as quatro chaves; nenhuma ação/anexo; CMS com um `SignerInfo`, destacado, `messageDigest`, `signedAttrs` pelos bytes originais e assinatura pelo `node:crypto`; PSS sem parâmetros recusado; cadeia até âncora fixada (raízes conferidas por HTTPS), validade de todos, certificado de pessoa (e-CNPJ, ACT, SSL recusados), CPF do campo próprio; "Assinado por" sem dígitos; "Assinado em" = hora do servidor; **sem rede** (guarda verde); leitor com limites (inflate por stream e orçamento total de 32 MB, no máximo 16 `/ObjStm` por revisão, prazo conferido dentro dos laços, aninhamento, objetos, revisões) e nenhum 500 (todo erro inesperado → `nao_aceito`); todo número do base passa por `redefinido()` antes de olhar o `/Type`; `/XRef` só no `startxref` da revisão e `/ObjStm` só como contêiner novo; lista proibida só nos objetos novos e nas chaves que mudaram; revisão de longo prazo com `/DSS` e/ou carimbo; nada de CN/CPF/série no log.
  - **Assinante (RN-145, D10, D8):** `tenant_signer` STAFF_ONLY, só HMAC e identificação mascarada; compare-and-set no primeiro e na troca; auditoria "Perfil profissional" e e-mail de aviso; 2FA antes de qualquer gravação; registrar amarrado à versão lida (`codigo` + `base_pdf_sha256`); habilitação conferida no envio.
  - **Rota:** `mesmaOrigem`, `requireApiNutri`, `documentosLiberados`, corpo limitado e com prazo, semáforo depois do corpo e um envio por usuária, `ASSINATURAS_LIBERADAS`.
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema Critical/Important confirmado, parar e avisar o dono.
- [ ] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): P10B-01 a P10B-06 (com o PR); os Minor da revisão num item "P10B-07 — débitos do Plano 10B" (com o isolamento da conferência em `worker_threads`, se o teste de negação de serviço da T4 passar perto do limite).
- [ ] Atualizar a spec de documentos assinados para a **v0.4** (o que os Planos 10A e 10B mudaram: os "Desvios conscientes" dos dois, o resultado do spike — onde fica o CPF no gov.br, campo pré-criado, `ASSINATURAS_LIBERADAS` — e as tabelas de textos de interface).
- [ ] Atualizar os **dois manuais** (memória do projeto): o do usuário (seção "Documentos assinados e receita": o gov.br e o certificado) e o técnico (`docs/manual-tecnico/`, a conferência, as âncoras, o runbook do spike).
- [ ] Lembrar o dono: backup no host (P02-11) pendente; a liberação de cada assinador só com o arquivo real (runbook, etapa 5); merge (= deploy) só com OK explícito e snapshot no hPanel antes.

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec v0.3.1 (parte do 10B)**

| Requisito | Onde |
|---|---|
| US-144 (envio do PDF assinado, primeiro certificado, outra pessoa, sem 2FA, todas as recusas, troca) | Tarefas 3 (assinante, recusas), 4 (conferência) e 5 (envio, tela) |
| US-147 (link do validador do ITI para gov.br e ICP; nunca na digitalizada) | Tarefa 5 |
| RN-144 (toda a conferência) | Tarefas 1 (leitor com orçamento de inflate e prazo, geração, âncoras, fábrica) e 4 (lista fechada por alcance com "redefinido antes do /Type", cobertura da xref, widget, /DSS e/ou carimbo, CMS, cadeia, titular); 2 (relatório); T6 se o spike pedir |
| RN-145 (CPF do campo próprio, nome, HMAC, troca, D8 (a)) | Tarefas 3 e 5 |
| RNF-141 (3 s, limites, sem rede, nunca 500) | Tarefas 1 e 4 (guarda sem rede, negação de serviço) e 5 (semáforo) |
| INT-B1 (âncoras, VALIDAR como link) | Tarefas 1 (âncoras, D7) e 5 (link do ITI) |
| P-B2 (spike) | Tarefas 1 e 2 |
| §10 `tenant_signer`, CHECKs de `assinatura_tipo` | Tarefa 3 |
| Manual guiado (`documentos` e `seguranca` com o certificado) | Tarefa 5 |

**2. Placeholders:** os PEM das âncoras (`ancoras-raizes.ts`, T1 Step 7) e a URL/data da conferência das raízes por HTTPS (`RAIZES_CONFERIDAS`) são dado público copiado no próprio passo e preenchido no PR (não cabem no plano); a guarda `ancoras-fonte.test.ts` reprova o arquivo incompleto (inclusive a URL que não começa por `https://`). O resto dos passos de código traz o código. Os trechos em prosa são trocas mecânicas em arquivos do 10A (um parágrafo da página, um item de guia, um caso de teste) com o texto exato.

**3. Consistência de nomes:** `CAMPO_PRE_CRIADO` (T1) em T2 e no job do 10A; `lerBase`/`lerAtualizacao`/`PdfIlegivelError`/`percorrer` (T1) em T4 e nos testes dos jobs do 10A; `Ancoras` com `raizesIcp`/`acsIcp`/`govbr` (T1) em T4 e T5; `RecusaAssinaturaError` com `nomeDoCertificado`, `CodigoRecusa`, `MSG_RECUSA` (T3) em T4 e T5; `Titular`/`hmacDoTitular`/`identificacaoDoTitular`/`lerAssinante`/`gravarAssinante` (T3) em T5; `Conferido` com `serie` (T4) em `titularDoConferido` (T5); `conferirCobertura` (T4); `ASSINATURAS_LIBERADAS`/`MAX_ENVIO_BYTES` (T4) em T5; do 10A: `registrarAssinatura`, `exigirHabilitacaoAtual`, `AcessoAssinatura`, `DepsAssinar`, `VersaoLida`, `novoConsultorio`, `outroDocumento(…, { base, conteudo })`, `novoPreparoNoBanco` em T5; `revisaoComXrefStream`/`objStmCheio`/`baseComRecursos` (T1) em T4; as opções novas da fábrica (`objetoSolto`, `widgetDeTexto`, `apComEstados`, `acroformExtra`, `paginaComFields`) em T4.

**4. Review Focus:** 1 (PDF que mostra outra coisa) → T4 (`it.each` das adulterações: FreeText, Stamp, stream e fonte redefinidos, `/Resources`, `/MediaBox`, widget sobre a dose, `/BBox`, estados do `/AP`, widget de campo de texto, `/AcroForm` com chaves a mais, página com `/Fields`, objeto solto, duas assinaturas, `/ByteRange` curto, ISA, lixo, `/Launch`, anexo, `/Names` trocado e acrescentado, aninhamento, disfarces com `/ObjStm` e `/XRef`, segundo `/XRef`; o `/Names` inalterado do pdfkit aceito; `/DSS` só, carimbo só e os dois aceitos; base reenviado sem assinar → `sem_assinatura`; 500 `/ObjStm` de 20 MB recusados em < 3 s) e T1 (geração do cabeçalho × xref); 2 (certificado errado) → T4 (vencido, e-CNPJ, sem uso, raiz desconhecida, SHA-1, CN com CPF, erro inesperado → `nao_aceito`) e T5 (primeiro de outra pessoa, nada gravado); 3 (primeiro certificado e troca) → T3 (compare-and-set) e T5 (confirmação, código errado e bloqueio, troca, D8 (a)); 4 (documento muda por baixo) → T5 (versão lida, habilitação); 5 (rota sob carga) → `route.test.ts` da T5.

## Decisões do dono (aprovadas em 05/10/2026)

Todas as ★ do plano único foram **aprovadas pelo dono em 05/10/2026, como recomendadas**, junto com a divisão em 10A e 10B. Neste plano: **D7** (âncoras versionadas, atualização trimestral pelo Claude a pedido do dono, alarme 180 dias antes de vencer), **D8** (gov.br sem CPF em campo próprio: nome + número de série, 2FA a cada certificado novo — condicional ao spike) e a parte da **D9** sobre a conferência (`/security-review` com o checklist reforçado). As outras (D1–D6 e a D9 do resto) estão no Plano 10A.

Pontos que precisam de atenção (não são decisões):
- **Os PDFs reais assinados (runbook, etapa 1)** destravam a Tarefa 2 e a liberação de cada assinador: sem eles, o gov.br e a opção C ficam desligados (`ASSINATURAS_LIBERADAS`) e só a digitalizada do 10A funciona.
- **A consulta ao CRN-3 (P-B1)** decide se o gov.br vale para a receita.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa com as lentes spec/qualidade e segurança, revisão final do branch no fim) — as tarefas dependem umas das outras por interfaces bem definidas (o leitor da T1 decide a T4; o assinante da T3 e a conferência da T4 são usados pela T5), e uma falha na conferência (aceitar um PDF adulterado) é cara de desfazer com receitas reais em produção. Ordem da D21 (10B): T1 → T3 → T4 → T5, em série; a T2 corre à parte (checkpoint do dono) e a T6 só se o relatório da T2 pedir.

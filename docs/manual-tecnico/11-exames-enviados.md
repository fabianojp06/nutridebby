# 11. Exames enviados pelo paciente (Plano 12, F3-04)

Conferido contra o branch `plano-12-exames-paciente` em 07/10/2026 (Tarefas 1–14; em produção desde 08/10/2026, PR #25, merge `3b59c38`),
migrations `0101_exames_enviados` e `0102_rls_exames_enviados` (a `0103_sessao_equipe_30min` é da Tarefa 14, sessão da
equipe, e não deste capítulo), spec `docs/superpowers/specs/2026-10-03-nutridebby-paciente-exames-ia-design.md` (v0.3, parte
F3-04) e plano `docs/superpowers/plans/2026-10-07-nutridebby-12-exames-paciente.md` (decisões D1–D13, D-R1 a D-R3 e as do
dono durante a execução, R-D1 a R-D5). Runbook do dono: [`docs/operacao/exames-enviados.md`](../operacao/exames-enviados.md).
Só **nomes** de variáveis aparecem aqui; o Plano 12 não criou variável de ambiente nova.

## 11.1 Visão

**O que faz (US-160 a US-165).** O paciente envia pelo app um laudo — **1 PDF** de até 20 MB ou **1 a 5 fotos** (JPEG, PNG
ou HEIC, até 10 MB cada, 30 MB no total) — com a data da coleta, um nome e uma observação opcionais. O arquivo **não entra
no prontuário sozinho**: o worker transforma tudo em imagens, monta um **PDF limpo** só com elas e o envio cai na fila
"Exames recebidos" da nutricionista, que confere as páginas e **aceita** (vira um exame da aba Exames, com o selo "Enviado
pelo paciente"; com a IA ativa, dá para aceitar e já pedir a leitura da F3-01) ou **recusa** com um motivo que o paciente
vê. O paciente acompanha a situação em `/p/exames`, baixa o PDF limpo enquanto aguarda e pode cancelar.

**Nasce desligado (D18 = a).** A nutricionista liga em Configurações, seção "Exames enviados pelos pacientes"
(`tenants.exames_paciente_ativado_em`). Desligado, o portal não mostra "Enviar exame" e o envio
(`POST /api/p/exames`, `src/app/api/p/exames/route.ts`) recusa com 404; a tela `/p/exames` continua abrindo pelo endereço e
mostra só a lista, sem o formulário (`src/app/p/(portal)/exames/page.tsx`); os envios que já estão na fila continuam revisáveis.

**Onde fica no portal (Plano 16, layout G).** Antes, "Enviar exame" e "Meus exames" eram links do Início e do Perfil;
desde o Plano 16 ([§5.5.2](05-agenda-portal-conteudo.md#552-rotas-e-seções)):

- **Seção "Exames"** (`/p/exames`, título "Meus exames") na faixa do topo, **condicional** (RN-192, G-D9 = a): aparece com o
  recebimento ligado **ou** quando o paciente tem envio não cancelado (`temEnvioVisivel`, `src/modules/portal/exames-enviados.ts`:
  só a existência, sem `auditRead`; em Hoje, `temEnvioVisivelNaTransacao` dentro de `faixaDeHoje`, P08-13;
  `secoesDoPortal({ exames })`, `src/app/p/navegacao.ts`). Sem os dois, o portal tem quatro
  seções; a rota continua abrindo pelo endereço.
- **"Enviar exame" na barra "Ações" de Hoje** (`BarraDeAcoes`, `/p/exames#enviar`), só com o recebimento ligado (RN-215).
- **Item do mural** (§5.5.11, RN-199): envio de hoje, ou mudança de situação depois do envio nos últimos 7 dias (revisão,
  expiração, falha; o processamento não conta), com o texto "{nome do exame}: {situação}" (`situacaoParaPaciente`, a mesma
  de `/p/exames`) e o link "Ver meus exames". O mural lê os envios na sua transação e chama `auditRead`
  (`exames_enviados`) uma vez, quando há linhas.

**Por que tudo passa pelo worker (D23 = a, R-170).** Um PDF vindo do **paciente** é conteúdo não confiável (JavaScript,
links, anexos embutidos, falhas de leitor). O worker o **rasteriza** num processo filho e guarda só imagens: o que a
nutricionista vê, o que vira laudo e o que vai à IA da F3-01 nunca é o original. As imagens de página são temporárias; o PDF
limpo é o que fica.

**Fluxo, com os nomes do código:**

```
Paciente /p/exames → POST /api/p/exames (multipart; mesmaOrigem → requireApiPaciente; 2 envios por processo, 1 por conta,
   │  prazo de 180 s para o corpo; fora do src/proxy.ts)
   │  enviarExame (src/modules/portal/exames-enviados.ts): valida campos, tipo pelo conteúdo, tamanhos, 40 MP pelo cabeçalho
   │  (classificarArquivos), limites (10 pendentes, 5 por dia) e, com o paciente travado, salvarArquivos (tipo exame_original,
   │  UMA reserva de cota) → registrar = INSERT exam_submissions ('processando') + exam_submission_files ('original')
   │  + boss.send('exame-envio', { tenantId, envioId }) na mesma transação — tudo ou nada
   ▼
nutri_worker, fila `exame-envio` (um job por vez) → processarEnvio (exames-enviados-job.tsx)
   │  converterOriginais: foto → fotoParaJpeg (pipeline do diário: HEIC, EXIF fora, orientação, ≤ 2000 px, qualidade 85);
   │  PDF → rasterizarPdf (processo filho, uma página por vez) → JPEG; renderizarPdfLimpo (@react-pdf, só as imagens)
   │  cada página: salvarArquivo (exame_pagina; registrar = linha 'pagina'); por último o PDF limpo: salvarArquivo (exame;
   │  registrar = envio 'recebido' com arquivo_path + avisarExamesRecebidos); depois os originais saem (apagarArquivosDoEnvio)
   ▼
Painel /painel/exames-recebidos (filaDeEnvios, sem auditoria) → /painel/exames-recebidos/[id] (abrirEnvio: conteúdo e
   auditRead só no 'recebido'; nas outras situações, só a situação)
   → aceitarEnvio: paciente → envio travados; INSERT exams apontando para o MESMO PDF limpo; envio 'aceito' (exam_id,
     revisado_por/em, arquivo_path → nulo); push neutro; depois do commit, as páginas saem
   → "Aceitar e ler valores com IA": aceitarEnvio e, em seguida, pedirLeituraExame (src/modules/ia/tarefas.ts)
   → recusarEnvio: apagarArquivo(PDF limpo) com naMesmaTransacao = envio 'recusado' (motivo) + push neutro; páginas depois
Paciente "Cancelar envio" → cancelarMeuEnvio: 'recebido' → 'cancelado' + job `exame-envio-limpar` (limparEnvio no worker:
     a sessão de paciente não apaga stored_files)
Fila `expirar-exame-envio` (*/15, America/Sao_Paulo) → varrerEnvios: 'processando' parado > 30 min sem job vivo → 'falhou'
     (interrompido); 'recebido' há 90 dias → 'expirado' + push; sobras e órfãos com mais de 1 h → apagados
```

## 11.2 Peças

| Arquivo | Responsabilidade | Só no worker? |
|---|---|---|
| `src/db/schema/exames-enviados.ts` | Tabelas `exam_submissions` e `exam_submission_files` (Drizzle) | não |
| `src/modules/pacientes/exames-enviados-constantes.ts` | Limites (`ENVIO_*`, `MAX_PIXELS_IMAGEM_PDF`, `ENVIOS_PENDENTES_MAX`, `ENVIOS_POR_DIA_MAX`), prazos (`ENVIO_EXPIRA_DIAS` 90, `ENVIO_LEMBRETE_DIAS` 30, `AVISO_EXAMES_INTERVALO_MS` 6 h), listas de situação e motivos, textos (`MSG_ENVIO`, `SITUACAO`, `MSG_REVISAO`, `ROTULO_MOTIVO_RECUSA`) e funções puras (`situacaoParaPaciente`, `nomeDoEnvio`, `diasEntre`, `haDias`). Sem import de servidor: serve ao cliente | não |
| `src/modules/plataforma/armazenamento.ts` | `salvarArquivos` (lote do paciente; núcleo comum `gravarArquivos` com `salvarArquivo`) | não |
| `src/modules/portal/exames-enviados.ts` | Lado do paciente: `classificarArquivos`, `enviarExame`, `meusEnvios`, `pdfDoMeuEnvio`, `cancelarMeuEnvio`, `EnvioError` | não |
| `src/app/api/p/exames/route.ts`, `src/app/api/p/exames/[id]/pdf/route.ts`, `src/app/api/p/exames/situacoes/route.ts` | `POST` do envio (vagas, prazo do corpo, `lerCorpoLimitado`), `GET` do PDF limpo (303 para `signFileUrl`) e `GET` só da situação (`[{ id, status }]`, sem auditoria; hotfix 09/10/2026) | não |
| `src/app/p/(portal)/exames/` | Tela `/p/exames`: `EnvioForm` (fetch multipart), `CancelarEnvio` (`window.confirm`), `cancelarEnvioAction`; com algum envio "Processando…", `AtualizarEnquantoProcessa` consulta só a situação em `GET /api/p/exames/situacoes` (`situacoesDosMeusEnvios`: `[{ id, status }]`, sem `auditRead`, cabeçalho de consulta automática) a cada 5 s nos 3 primeiros minutos e a cada 30 s até 30 min (pausa com a aba oculta; recomeça quando o conjunto de envios em processamento muda) e faz `router.refresh()` uma única vez quando algum sai de "processando" (a lista relida audita uma vez); e `AnunciarSituacoes` (região viva única, sempre montada) anuncia "Nome: situação" do envio que mudou (hotfix 09/10/2026) | não |
| `src/modules/pacientes/exames-enviados-arquivos.ts` | `apagarArquivosDoEnvio`: cada arquivo no seu `apagarArquivo`, por papel e situação; idempotente | não |
| `src/modules/pacientes/exames-enviados.ts` | Lado da equipe: `filaDeEnvios`, `contarEnviosRecebidos`, `contarEnviosDoPaciente`, `examesEnviadosPeloPaciente`, `abrirEnvio`, `aceitarEnvio`, `recusarEnvio`, `RevisaoError` | não |
| `src/modules/pacientes/exames-enviados-ia.ts` | Chave curta das mensagens da IA no redirecionamento do "Aceitar e ler" (`chaveDaMensagemIa`, `mensagemIaDaChave`) | não |
| `src/app/painel/exames-recebidos/` | Fila, revisão (`AceitarForm`, `RecusarForm`, `aceitarEnvioAction`, `recusarEnvioAction`) | não |
| `src/app/painel/navegacao.ts` + menu | `ITEM_EXAMES`, `itensDoMenu`, `rotuloDoItem` ("Exames recebidos (n)", D11) | não |
| `src/modules/plataforma/recebimento-exames.ts` | `definirRecebimentoDeExames` (liga/desliga, só a nutricionista) | não |
| `src/modules/plataforma/metricas.ts` | `metricasDeExamesEnviadosPorTenant` (coluna "Exames do app" do admin) | não |
| `src/modules/portal/avisos.ts`, `src/modules/notificacoes/mensagens.ts` | `avisarEnvioAtualizado` (push neutro `exame_revisado`/`exame_expirado`) | não |
| `src/modules/pacientes/exames-enviados-aviso.ts` | `avisarExamesRecebidos` (e-mail agrupado à nutricionista, no máximo 1 a cada 6 h) | não (chamado no worker) |
| `src/modules/pacientes/rasterizar-pdf.ts` | `rasterizarPdf`: diretório temporário do job, `fork` do filho, vigia de memória, prazo, leitura das páginas | **sim** |
| `src/modules/pacientes/rasterizar-pdf-processo.ts` | Processo filho: PDFium em WASM; único importador de `@hyzyla/pdfium` | **sim** |
| `src/modules/pacientes/exames-enviados-job.tsx` | `processarEnvio`, `converterOriginais`, `renderizarPdfLimpo` | **sim** |
| `src/modules/pacientes/exames-enviados-varredura.ts` | `limparEnvio` (fila `exame-envio-limpar`) e `varrerEnvios` (fila `expirar-exame-envio`) | **sim** |
| `src/modules/pacientes/lgpd.ts`, `exportacao-job.ts` | `apagarEnviosDoTitular` (exclusão atendida e anonimização) e `examesEnviados` no `dados.json` / `envios/` no ZIP | **sim** (jobs) |

**Guardas de grafo (`src/modules/pacientes/exames-enviados-guardas.test.ts`, RNF-169, R-175).** `@hyzyla/pdfium` só em
`rasterizar-pdf-processo.ts` (em `src` e `scripts`); nada do grafo do Next alcança `rasterizar-pdf.ts`,
`rasterizar-pdf-processo.ts` nem `exames-enviados-job.tsx`, e nenhum caminho do Next importa `@hyzyla/pdfium` ou
`heic-decode`. Também valem as guardas de `src/modules/pacientes/exportacao.test.ts` (grafo) e as gerais (`rls-guard`,
`audit-guard`, `isolamento`, `mesma-origem-rotas`, `formularios-post`, `acoes-de-paciente`, `rotas-axe`, `cores`).

**Filas** (`src/jobs/queues.ts`):

| Fila | Payload | Política | Quem consome |
|---|---|---|---|
| `exame-envio` | `{ tenantId, envioId }` | `retryLimit` 2, `retryDelay` 30 s com backoff, `expireInSeconds` 300; um job por vez | `processarEnvio` (`ultimaTentativa = retryCount >= retryLimit`) |
| `exame-envio-limpar` | `{ tenantId, envioId }` | `retryLimit` 3, `retryDelay` 60 s, `expireInSeconds` 120 | `limparEnvio` |
| `expirar-exame-envio` | `{}` | cron `*/15 * * * *` (America/Sao_Paulo), `retryLimit` 1 | `varrerEnvios(…, new Date())` |

## 11.3 Banco

**`exam_submissions`** (0101): `id`, `tenant_id`, `patient_id`, `enviado_por` (a conta do paciente), `status`
(`processando`, `recebido`, `aceito`, `recusado`, `cancelado`, `expirado`, `falhou`), `data_coleta`, `nome` (1–120),
`observacao` (1–500), `arquivo_path` (o PDF limpo; FK para `stored_files`, `ON DELETE SET NULL`; CHECK
`exam_submissions_arquivo_valido`: só em `recebido` ou `cancelado` e só `<tenant>/exame/%`), `motivo_recusa`
(`ilegivel`, `nao_e_exame`, `outra_pessoa`, `repetido`, `outro`), `motivo_recusa_texto` (1–300, só com `outro`),
`motivo_falha` (`conversao`, `paginas`, `cota`, `interrompido`), `exam_id`, `revisado_por`, `revisado_em`, `created_at`,
`updated_at`. CHECKs amarram cada coluna à situação (`exam_submissions_recusa`, `_recusa_texto`, `_exame_so_aceito`,
`_revisao`, `_falha`). UNIQUE `(tenant_id, patient_id, id)`. Índices da fila (`tenant_id, status, created_at`) e da lista do
paciente. A FK composta `exam_submissions_exame_fk` (0102) aponta para `exams (tenant_id, patient_id, id)` com
`ON DELETE SET NULL (exam_id)`: excluir o exame aceito mantém o registro de que ele veio do paciente.

**`exam_submission_files`** (0101): `submission_id`, `arquivo_path` (UNIQUE; FK para `stored_files` com
`ON DELETE CASCADE`), `papel` (`original` → `<tenant>/exame_original/%`, `pagina` → `<tenant>/exame_pagina/%`), `ordem`
(1–10, única por envio e papel). FK composta para o envio, também em cascata.

**Colunas e listas alteradas.** `tenants.exames_paciente_ativado_em` (nulo = desligado) e `tenants.exames_aviso_em` (o
último e-mail agrupado). `stored_files_tipo_valido` ganha `exame_original` e `exame_pagina` (os dois **com dono**; o CHECK
`stored_files_dono` não mudou — Desvio 3); `notifications_tipo_valido` ganha `exame_revisado` e `exame_expirado`.
`ENTIDADE_ROTULO.exames_enviados = 'Exames enviados pelo paciente'`.

**RLS e auditoria (0102; regras 2 e 8).** As duas tabelas: `app_enable_tenant_rls`, `app_enable_patient_rls` e
`app_enable_audit(…, 'exames_enviados')`; nenhuma em `PUBLICO_LIBERADO`, `STAFF_ONLY` ou `CONTEUDO_POR_AUDIENCIA`;
`PACIENTE_ESCREVE` ganha `exam_submissions` (`insert`, `update`) e `exam_submission_files` (`insert`). Políticas
`RESTRICTIVE` só para o papel `paciente`:

| Política | Tabela | O que o paciente pode |
|---|---|---|
| `paciente_envio_insert` | `exam_submissions` | Criar só envio `processando`, com `enviado_por` = a própria conta e nada da revisão, do PDF limpo ou da falha |
| `paciente_envio_update` | `exam_submissions` | Só mudar de `recebido` para `cancelado` (o gatilho confere que nenhuma outra coluna muda) |
| `paciente_envio_arquivo` | `exam_submission_files` | Ver e inserir só a linha `original` do próprio envio `processando`, apontando para um `exame_original` dele |
| `paciente_arquivo_insert` (refeita) | `stored_files` | Inserir só `diario_foto_original` ou `exame_original` |
| `paciente_arquivos` (refeita) | `stored_files` | Não vê `exame_pagina` (nem `documento_base`/`documento_digitalizado`); o `exame_original` continua visível ao dono (Desvio 1) |

**Gatilhos (PM-14, §6.5; todos com `SET search_path = public, pg_temp` e erro 42501).**

- `exam_submissions_nasce` (`BEFORE INSERT`): com qualquer papel definido, o envio nasce `processando`, sem PDF limpo,
  exame, revisão nem falha — nem a equipe nem o worker fabricam a origem "Enviado pelo paciente" (ECF.17.01). Sem
  contexto (migrations, o owner dos testes) fica livre.
- `exam_submissions_regras` (`BEFORE UPDATE`): colunas fixas (`id`, `tenant_id`, `patient_id`, `enviado_por`,
  `data_coleta`, `nome`, `observacao`, `created_at`); só as transições e os papéis abaixo; a revisão sai em nome de quem
  revisa (`revisado_por = app_current_user()`); o PDF limpo só entra em `processando → recebido`, o `exam_id` só em
  `recebido → aceito`, a revisão só no aceite ou na recusa e o motivo da falha só na falha; a sessão de paciente só muda
  `status` e `updated_at`. Os ponteiros podem ir a nulo a qualquer hora (limpeza e o `SET NULL` das FKs).
- `exam_submissions_sem_apagar` (`BEFORE DELETE`): a linha só sai no contexto `worker` com o titular `bloqueado` ou
  anonimizado (pedido de exclusão atendido e anonimização; NGS1.12.03). O papel `worker` também roda no processo web
  (agendamento público, webhook, link de documento), por isso a conferência do titular.

| De → para | Quem (papel) | Onde no código |
|---|---|---|
| (nasce) `processando` | `paciente` | `enviarExame` |
| `processando` → `recebido` | `worker` | `processarEnvio` (no `registrar` do PDF limpo) |
| `processando` → `falhou` | `worker` | `processarEnvio` (`conversao`, `paginas`, `cota`; última tentativa) e `varrerEnvios` (`interrompido`) |
| `recebido` → `aceito` | `nutri` | `aceitarEnvio` |
| `recebido` → `recusado` | `nutri` | `recusarEnvio` |
| `recebido` → `cancelado` | `paciente` | `cancelarMeuEnvio` |
| `recebido` → `expirado` | `worker` | `varrerEnvios` (90 dias) |

**Admin.** `admin_metricas_exames_enviados()` (`SECURITY DEFINER`, molde de `admin_metricas_ia()`; recusa rodar dentro de
`withTenant` com 55000) devolve por tenant `enviados_mes` (no fuso do tenant) e `pendentes` (`processando` + `recebido`).
Função própria para não mudar o tipo de retorno de `admin_tenant_metrics()` (Desvio 2). O admin nunca consulta as tabelas.

**Matriz de isolamento.** As duas tabelas estão em `FABRICAS` de `test/isolamento.test.ts` (a das linhas de arquivo cria
a mãe no mesmo comando, `COM_MAE`) e passam pelas transições legais (`envioNoBanco`, `test/exames-enviados.ts`);
`exam_submissions` entra em `IMUTAVEIS` e `SEM_DELETE`.

## 11.4 Arquivos e cota

**Tipos (regra 9).** `exame_original` (o que o paciente mandou; vive enquanto o envio está `processando`), `exame_pagina`
(imagens das páginas para a revisão; saem na revisão, no cancelamento, na expiração ou na falha) e `exame` (o PDF limpo,
o mesmo tipo dos laudos da US-015). Nenhum caminho usa texto do usuário.

**`salvarArquivos` (DEP-09 reduzida, PM-8).** Só o envio do paciente a usa: vários conteúdos, **uma** reserva de cota pela
soma e um `registrar` só — tudo ou nada, porque a sessão de paciente não conseguiria desfazer um envio gravado pela metade
(não tem `DELETE` em `stored_files`). Lote vazio, conteúdo vazio, tipo fora dos permitidos ou SVG → `TipoNaoPermitidoError`;
soma que não cabe → `CotaEsgotadaError`; erro do `registrar` ou do `antesDaReserva` volta depois da limpeza dos `.tmp`.

**`apagarArquivosDoEnvio`.** Um `apagarArquivo` por arquivo (molde do diário e do Plano 10A): o `original` sai fora de
`processando`; a `pagina`, fora de `processando` e de `recebido` (com `refazer`, ao contrário: só em `processando`, para uma
nova tentativa do job refazer as páginas, D12); o PDF limpo (`arquivo_path`) sai — soltando o ponteiro no
`naMesmaTransacao` — só sem `papel` e fora de `processando`/`recebido`. As linhas de `exam_submission_files` saem pela FK em
cascata na mesma transação do `DELETE` de `stored_files`. Idempotente; a falha num arquivo não para os outros (log só com o
código do erro).

**Um dono só no aceite.** O exame passa a apontar para a **mesma** linha de `stored_files` do PDF limpo e o envio solta o
ponteiro na mesma transação: sem cópia, sem cota em dobro; `excluirExame`, `anexosDoPaciente` e a exportação tratam o
arquivo como laudo.

**Ordem de travas.** Paciente → envio → tenant (cota), a mesma do `criarExame` e do diário: o `INSERT` em `stored_files`
pede KEY SHARE no paciente pela FK. O job trava o paciente (`FOR UPDATE`) e o envio antes de cada `salvarArquivo`
(`travarParaGravar`); o aceite e a recusa usam `carregarPacienteParaEscrita` e depois o envio; a expiração também trava o
paciente primeiro (revisão do plano). `avisarExamesRecebidos` relê o tenant em `FOR NO KEY UPDATE` (D10): `FOR UPDATE`
conflitaria com o KEY SHARE de toda FK `tenant_id`, inclusive a do `audit_log`, e fecharia deadlock com qualquer escrita
auditada do consultório (o erro corrigido no Plano 11 em `src/modules/ia/cota.ts`; teste com duas conexões na T6). Em
`apagarArquivosDoEnvio` a ordem é envio (`FOR NO KEY UPDATE`) → tenant (o arquivo já tem dono e nada insere em
`stored_files`). **Ação de RI:** excluir o exame de um envio aceito (`excluirExame`) dispara o `SET NULL (exam_id)` da FK
`exam_submissions_exame_fk` (0102), um `UPDATE` implícito que trava a linha do envio; por isso o `excluirExame` trava o envio
que aponta para o exame (`FOR NO KEY UPDATE`) logo depois do paciente e antes do tenant (paciente → envio → tenant). Com a
ação de RI depois do tenant, a exclusão e a limpeza das páginas do mesmo envio fechavam ciclo (40P01; code review do PR #25,
P12-22 a; teste com duas conexões em `exames-enviados-arquivos.test.ts`).

**Cota.** Toda falha definitiva (`conversao`, `paginas`, `cota`), o cancelamento, a recusa e a expiração devolvem o espaço
exatamente (os testes conferem `tenants.armazenamento_bytes` antes e depois de cada caminho). A varredura apaga as sobras
(cancelado cujo job de limpeza falhou, páginas de aceito ou recusado, original de um `recebido`) e, por defesa, arquivo de
envio sem linha que aponte para ele há mais de 1 h, inclusive o PDF limpo que nenhum exame nem envio aponta.

## 11.5 Rasterização

**Motor (D1, DEP-10).** `@hyzyla/pdfium` **2.1.13** (versão fixada): o PDFium — o motor de PDF do Chrome — compilado em
WebAssembly **sem o V8**, então nenhum JavaScript do PDF roda. Licenças: MIT (o pacote) e BSD-3-Clause/Apache-2.0 (PDFium);
nada AGPL. O `sharp` pré-compilado não abre PDF (`sharp.format.pdf.input.buffer === false`, conferido em 07/10/2026). Plano
B, não usado: `pdfjs-dist` + `@napi-rs/canvas`, ≈ 70 MB a mais na imagem.

**Processo filho (`rasterizar-pdf-processo.ts`).** Um `fork` por PDF, não uma thread: a memória do WASM fica fora do teto do
heap de uma thread, e só um processo à parte pode ser medido (`/proc/<pid>/status`) e morto (`SIGKILL`) sem derrubar o
worker. O filho:

- nasce **sem variáveis de ambiente**, salvo `MALLOC_MMAP_THRESHOLD_=131072` (limiar do `mmap` do glibc, R-D2; não é
  credencial), com heap de **64 MB** (`HEAP_MAX_RASTER_MB`) e `--expose-gc` (um `gc()` por página);
- escreve `1000` em `/proc/self/oom_score_adj`: num estouro da cgroup do container, o kernel mata o filho, não o worker;
- recebe o PDF **por arquivo** (`entrada.pdf`, 0600) no diretório temporário do job (`mkdtemp`, 0700, nomes gerados pelo
  código), lido direto para a memória do WASM sem cópia no JavaScript e apagado logo depois (R-D4); pela IPC vão só
  metadados (`tamanhoPdf`, `dir`, limites);
- confere, antes de desenhar cada página, o tamanho **declarado** de cada imagem dela (`FPDFImageObj_GetImagePixelSize`,
  também dentro de Form XObjects e nas imagens inline): acima de **20 MP** (`MAX_PIXELS_IMAGEM_PDF`) recusa sem decodificar;
- desenha **uma página por vez** com o maior lado em **2000 px** (`ENVIO_LADO_MAX`) e grava os pixels RGBA num arquivo
  `pagina-<n>.rgba` do mesmo diretório (R-D2); pela IPC manda só `{ indice, total, largura, altura, caminho }` e espera o
  `proxima` do pai; mais de 10 páginas (`ENVIO_MAX_PAGINAS`) → recusa `paginas`, antes de desenhar.

**O pai (`rasterizar-pdf.ts`).** Vigia a memória residente do filho de **20 em 20 ms** e o mata acima de **256 MiB**
(`TETO_RSS_RASTER_BYTES`); prazo de **120 s** para o PDF inteiro (`TEMPO_MAX_RASTER_MS`; Desvio 9: não é por página).
Calcula o caminho esperado de cada página com o próprio contador e recusa caminho diferente, índice fora de ordem ou lado
fora de `1..ladoMax`; lê o arquivo com `O_NOFOLLOW`, exige arquivo comum, `nlink === 1` e tamanho exato
`largura × altura × 4`, apaga-o e só então chama `aoReceber` (que converte em JPEG e solta os pixels). O diretório inteiro
sai no `finally` — também em erro, prazo, teto ou morte do filho, depois de esperar a saída do filho (até 5 s). Estouro,
erro, saída sem resposta ou prazo → `RasterizacaoError('conversao')` → o envio vira `falhou` com a cota devolvida; o worker
segue com as outras filas. O log leva só o nome/código do erro ("PDF do paciente recusado na rasterização").

**Orçamento de memória (RNF-162; D-R1 revista pela R-D4, dono, 07/10/2026).** Pico do worker + pico do processo filho
**≤ 400 MiB** no job; teto do filho **256 MiB**; o container do `nutri_worker` tem limite de **1 GiB** no Easypanel
(conferido em 07/10/2026: `MemoryBytes` 1073741824) com base de ~160 MiB. A primeira versão do plano propunha 200 MB de teto
e 250 MB de soma (D-R1 aprovada nesses números), que não comportaram o laudo escaneado pelo celular.

| Medida (Node 24, `exames-enviados-memoria.test.ts` e `rasterizar-pdf.test.ts`, um Node novo por rodada) | Worker (pai) | Filho | Soma |
|---|---|---|---|
| Revisão do plano: só o Node com o WASM; 1 página A4 a 2000 px | — | 66–69 MB; 153–156 MB | — |
| T3 (com pixels por arquivo, R-D2): `pdfDeFotos(10)`, 12,4 MB, 1600 × 1200, só a rasterização — local / na imagem de produção | +55 a +67 MB / +46 a +64 MB | 134–137 MB / 134 MB | 191–203 MB / 180–198 MB |
| T6, antes da R-D4 (PDF pela IPC): PDF de 19,6 MiB com 10 páginas de fotos de 12 MP, job inteiro | +93 a +142 MiB | 194–196 MiB | 287–336 MiB (reprovava os 250) |
| **T6 com a R-D4 (PDF por arquivo):** o mesmo PDF, job inteiro, 5 rodadas | +95 a +133 MiB | 175–177 MiB | **270–310 MiB** (folga ≥ 22 % sobre 400) |
| T6: 5 fotos de 12 MP com 9,58 MiB cada (48 MiB, acima dos 30 MiB aceitos) | +141 a +161 MiB | — | ≤ 161 MiB |
| T6, informativa: 3 fotos de 40 MP (8,55 MiB cada) | +84 MiB | — | — |

O filho sozinho fica a ≥ 31 % do teto (177 de 256 MiB). O lado do worker varia com o GC; o grosso é o JPEG do `sharp` por
página mais o Buffer da página lido do arquivo. **HEIC (Desvio 8, R3 do plano):** o HEIC é decodificado no processo do
worker (`heic-decode` aloca largura × altura × 4 bytes; 24 MP ≈ 96 MB, mais a cópia do `sharp`), fora do filho, e o CI não
tem HEIC real (o decodificador é simulado, como no diário): acima de ~15 MP o pico não é garantido — o runbook (passo 3)
manda testar com o iPhone.

**PDF hostil (Review Focus 1; testes da T3 e da T6).** PDF com `/OpenAction`, `/URI` e anexo → o PDF limpo não tem
`/JavaScript`, `/URI`, `/EmbeddedFile`, `/OpenAction` nem o texto do original; imagem que declara 6000 × 6000 px → recusa
sem decodificar; "bomba" de descompressão → o filho morre no teto e o envio vira `falhou`; PDF sem páginas, truncado ou com
página de tamanho zero → `conversao`.

**JPEG e PDF limpo.** Página e foto: `paraJpegSemMetadados(img, 2000, 85)` (D2; o diário e a capa seguem em 80), sem EXIF
nem GPS, orientação aplicada. `renderizarPdfLimpo`: uma página A4 por JPEG, margem de 24 pt por posição absoluta,
`objectFit: 'contain'`, metadados `title "Exame"`, `creator`/`producer` "NutriDebby".

**Na imagem Docker (D-R2).** O estágio `build` do `Dockerfile` deixa do `@hyzyla/pdfium` só `dist/index.esm.js` e
`dist/pdfium.wasm` (a poda tira ≈ 2,8 MB comprimidos e sobram ≈ 2,1 MB, quase todo o WASM; `test -f` para o build se a versão
mudar os nomes). A imagem foi a **262 MB** (build local da T3) e **263 MB** (integração da T3), com o limite do job `image`
subido para **265 MB**; as tarefas seguintes só acrescentaram código-fonte. O job `image` também rasteriza uma página na
imagem podada, sem rede ("rasterização ok na imagem"). Detalhe em [§7.7](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy).

## 11.6 Privacidade

- **Nada de dado de saúde em log, fila, push ou e-mail (regra 3, RNF-166, C-05).** Os jobs levam só `{ tenantId, envioId }`;
  os logs, só ids, o motivo de uma lista fechada e contagens ("exame enviado não processado", "PDF do paciente recusado na
  rasterização"). O **push** ao paciente tem um texto só, "Há uma atualização para você no app." (sem "exame"), com
  `url` para `/p/exames?v=<tenantId>`. O **e-mail** à nutricionista (`exames_recebidos`, assunto "Exames enviados por
  pacientes", botão "Ver exames recebidos") diz "Você tem exames novos enviados por pacientes para revisar." e, se há envio
  aguardando há mais de 30 dias, a frase do lembrete (D6) — sem nome de paciente, de exame ou arquivo; no máximo 1 a cada
  6 h por consultório (`tenants.exames_aviso_em`), reaproveitando `avisarNutri` (regra 1).
- **Auditoria de leitura (regra 8; Plano 06, D22).** `auditRead` (entidade `exames_enviados`) ao **abrir** um envio
  `recebido` no painel (`abrirEnvio`; nas outras situações ele não devolve observação, PDF nem páginas e não audita — code
  review do PR #25, P12-22 b) e, no portal, na **lista** (`meusEnvios`, quando não está vazia) e no **download** do próprio PDF
  (`pdfDoMeuEnvio`). A fila e os contadores do menu não chamam (só listam, como a lista de pacientes), nem a consulta de
  situação do portal (`situacoesDosMeusEnvios`, `GET /api/p/exames/situacoes`: só id e status, hotfix 09/10/2026). As escritas viram
  `audit_log` pelo gatilho; o worker grava com ator nulo ("Sistema").
- **O original nunca sai.** Ele só existe enquanto o envio está `processando`, não é servido por nenhuma rota, não chega ao
  navegador nem à IA. O paciente baixa só o PDF limpo, e só enquanto o envio está `recebido`; a nutricionista vê as páginas
  como `<img>` por URL assinada de 5 min (`signFileUrl`).
- **LGPD (spec §13.3).** Exportação (US-018, US-046): `dados.json` ganha `examesEnviados` (datas, nome, observação,
  situação, motivo da recusa, data da revisão e o exame ligado ao envio aceito) e o ZIP leva `envios/<data>-<nn>.pdf` só do
  PDF limpo de envio `recebido` (o aceito já sai como laudo). **Pedido de exclusão atendido:** `apagarEnviosDoTitular`
  apaga todos os arquivos de envio do titular e as linhas dos envios **não aceitos** antes do e-mail ao titular, que diz
  "os exames enviados pelo app que ainda não tinham sido aceitos" (a aba Privacidade: "…que ainda não foram aceitos"; D-R3,
  redação final com o advogado, P12-15); a varredura diária (`apagarEnviosDosBloqueados`) é a rede de segurança.
  **Anonimização:** os arquivos e as linhas não aceitas saem antes; as dos aceitos saem na transação da anonimização —
  nenhuma linha de envio sobra.
- **Texto livre dos envios não aceitos (R9, R-176).** Recusado (inclusive "Exame de outra pessoa"), cancelado, expirado ou
  falhou: o arquivo sai, mas `nome`, `observacao` e `motivo_recusa_texto` ficam até a exclusão atendida ou a anonimização,
  e o gatilho torna `nome`/`observacao` imutáveis. Decisão do dono com o advogado (P12-15).

## 11.7 Como estender

- **Outro tipo de arquivo** (por exemplo, DOCX): acrescentar o tipo em `classificarArquivos` (detecção pelo conteúdo, nunca
  pela extensão), no `permitidos` de `enviarExame` e em `converterOriginais` (um caminho que termine em JPEG de página);
  textos novos na spec antes (regra 4); a medida do RNF-162 com o pior caso do tipo novo; o que abrir conteúdo não
  confiável vai para um processo filho, nunca para o processo do worker.
- **Outro motor de rasterização:** trocar só o processo filho (`rasterizar-pdf-processo.ts`), mantendo o protocolo
  (`MensagemDoProcesso`: `pagina` com `caminho`, `fim`, `recusa`) — o pai, o job e os testes de `rasterizar-pdf.test.ts`
  continuam valendo; atualizar a guarda de `exames-enviados-guardas.test.ts` (único importador), a poda do `Dockerfile`, o
  passo de fumaça do job `image` e medir de novo (`exames-enviados-memoria.test.ts`).
- **Mudar teto, orçamento, lado ou qualidade:** são decisões do dono (D-R1/R-D4, PM-9). Nunca subir número por conta própria;
  medir antes e depois.
- **Nova transição de situação:** muda a migration do gatilho `exam_submissions_regras` (lista de pares e papéis), a
  política do papel envolvido e os testes de `src/db/exames-enviados-schema.test.ts`.

## 11.8 Divergências conhecidas

**Desvios conscientes da spec v0.3 (registrados no plano):**

1. `paciente_arquivos` esconde só `exame_pagina` (a spec §13.2 dizia também `exame_original`): a política de INSERT de
   `exam_submission_files` precisa enxergar o original do próprio paciente para conferir que é dele.
2. Métricas do admin numa função nova, `admin_metricas_exames_enviados()`, e não em colunas de `admin_tenant_metrics()`.
3. `stored_files_dono` não muda: os tipos novos já caem no lado "tem dono".
4. Processo filho em vez de thread na rasterização (a spec citava o molde de `preparar-pdf-thread.ts`); a spec v0.3 já foi
   alinhada (RNF-162, §4.1, R-175).
5. A expiração de 90 dias conta de `created_at` (a spec não tem `recebido_em`).
6. Corrida do aceite ou da recusa com envio `expirado`/`falhou` mostra "Este envio já foi revisado.".
7. Textos novos fora da spec (lista no plano, "Desvios conscientes", item 7), à revisão de interface; o guia "Exames
   recebidos" do manual guiado é rascunho até a Debby aprovar (como o P08-08).
8. HEIC decodificado no processo do worker, sem HEIC real no CI: o pico com HEIC acima de ~15 MP não é garantido (§11.5).
9. O prazo de 120 s da rasterização é do PDF inteiro, não por página (R-170 fala em "tempo por página").

**Abertas (backlog):**

- **Envio aceito cujo exame foi excluído depois:** `exam_id` vira nulo pela FK e o paciente continua vendo "Recebido no seu
  prontuário" — texto próprio depende do dono (P12-16 c).
- Os demais "Pontos menores" do plano (P12-16) e os Minors das revisões por tarefa (P12-17 a P12-20), entre eles: o
  `created_at` da sessão de paciente não é imposto pelo banco; resíduo `nutri-raster-*` no `/tmp` se o worker morrer no meio
  do job; falha de infraestrutura na rasterização (ENOSPC, `fork`) vira `conversao` definitiva; o job sem `job.signal`
  (job em dobro, R8, só monitorado). ("Processando…" não se atualizava sozinho em `/p/exames`: resolvido no hotfix de
  09/10/2026.)
- A confirmar com a Debby (P12-21): lembrete próprio dos 30 dias sem envio novo (D6), aba própria no portal (D4), contador
  do menu sem navegar (R5).

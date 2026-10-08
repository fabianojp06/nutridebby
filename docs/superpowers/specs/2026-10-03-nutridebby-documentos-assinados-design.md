# NutriDebby — Documentos assinados: parecer nutricional (F3-05) e receita de suplementos e fitoterápicos (F3-06) — Especificação (Design)

| Item | Valor |
|---|---|
| Versão | 0.5 (preparação do Plano 13: parecer, retificação, LGPD do parecer; D2 decidida) |
| Data | 2026-10-08 |
| Revisão 0.2 | Revisão do workflow aplicada: Res. CFN nº 760/2023 (telenutrição, art. 10: assinatura eletrônica **e/ou código verificador**, "preferencialmente" avançada ou qualificada; confirmação de recebimento) na §3.4, com a D2 reaberta e a lacuna do plano alimentar online registrada (P-B10, D12); art. 14 da Lei 14.063 lido como suficiência, não exigência; § 2º do art. 3º da Res. 680 (redação da 731/2022) na §3.3 (D13); Res. CFN nº 856/2026 ao lado da 599/2018 (RN-151 como decisão de produto, D14); imutabilidade × `apagarArquivo` com ordem de operações e FK sem `SET NULL` (RN-140); justificativa e motivo de cancelamento fora do alcance do paciente **no banco** (tabela `STAFF_ONLY`, D15) e exportação do titular separada; limites da atualização incremental do PDF assinado e regra explícita da digitalizada (RN-144, RN-157); 2FA e nome do titular do certificado no primeiro uso (RN-145) |
| Revisão 0.3 | Decisões do dono de 05/10/2026 aplicadas (D1, D3 a D16; D2 aberta para o Plano 13); US-151 e RN-155 cortadas (D7); corte em **Plano 10** (base + receita) e **Plano 13** (parecer, retificar, cancelar, LGPD do parecer) — §2.3; reconciliação com o código em produção (MVP v1.11, migrations até 0088): `PACIENTE_ESCREVE` e recibo em tabela própria (`signed_document_receipts`), paciente sem login por `semConta`, PK `id` nas tabelas auditadas, `updated_at` no gatilho, anonimização só no contexto `worker`, upload por Route Handler `/api/…`, `caminhoSeguro` do Sentry, `ROTAS_DO_PAINEL`, manual guiado (P08-10) e visual V2; achados das revisões de segurança e normas da v0.2 tratados: forma estrita do `/ByteRange` `[0 a b c]` com um único dicionário de assinatura, lista fechada por **alcance** com comparação chave a chave dos objetos redefinidos ("shadow attacks"), área reservada para a assinatura visível, validade, uso da chave e tipo do certificado, "Assinado em" pela hora do servidor, conferência sem rede, âncoras com as ACs intermediárias (RN-144, INT-B1); 2FA no momento de assinar com limite de tentativas, anti-repetição e auditoria (RN-145); digitalizada sem conteúdo ativo (RN-157); link de uso único com código (RN-158) |
| Correções da v0.3 (revisão do rascunho do Plano 10, 05/10/2026) | RN-144 (5): lista proibida só nos objetos novos e nas **chaves que mudaram** dos redefinidos (o Catálogo do react-pdf/pdfkit nasce com `/Names`); todo número que já existia é **redefinido** antes de olhar o `/Type` (stream do base redefinido = recusa, mesmo com `/Type /ObjStm` ou `/XRef`); `/XRef` só no `startxref` da revisão e `/ObjStm` só como contêiner novo. RN-144 (7): `/DSS` **e/ou** carimbo (carimbo opcional). US-144: o PDF preparado reenviado sem assinar recebe "Não encontramos assinatura digital…". RNF-141: orçamento total de inflate, máximo de `/ObjStm` e prazo dentro dos laços. RN-145: a troca do CPF do consultório acontece no envio (mesmo nome + 2FA). RN-157: limite de pixels pelo cabeçalho e foto normalizada sem EXIF/GPS. RN-158: limite por IP também na confirmação do código. US-140 e US-144: "Histórico do consultório" não existe — critérios reescritos |
| Revisão 0.3.1 (05/10/2026) | **Plano 10 dividido** pelo dono em **Plano 10A — Receita** (base de documentos + receita com assinatura **digitalizada**, opção E, entrega, recebimento, verificação, cancelar e a base de LGPD) e **Plano 10B — Assinatura gov.br e ICP-Brasil** (spike P-B2, conferência RN-144, assinante do consultório e troca do CPF, envio do PDF assinado); o 10A não depende do 10B (§2.3). **Decisões ★ D1–D9 do Plano 10 aprovadas como recomendadas** (seção "Decisões do Plano 10"): os ajustes (i), (ii) e (iii) da §2.3 passam a valer (US-149 e a base da US-150 no 10A). Do texto: RN-140 (c) — `app_anonimizar_documentos` é **SECURITY INVOKER** (antes "DEFINER"; Minors das revisões); §10 — `signed_documents.digitalizacao_status` com `recebendo` e a coluna `digitalizacao_em` (um envio digitalizado por vez, expiração em 1 h), `pdf_status` com `sem_cota` (RNF-143), `document_access_codes` com UPDATE só de `tentativas` (+1) e da sessão (uma vez), por gatilho, `tenant_signer` com `titular_hmac`/`titular_identificacao` (o titular é o CPF ou, na D8 (a), o número de série do certificado gov.br); `entregue_em` só quando houve entrega; D5 — a declaração da receita proposta cita também os medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas (Res. CFN 656/2020, art. 1º, § 1º) |
| Revisão 0.4 (06/10/2026) | **Fechamento do Plano 10A** (PR #19, em produção desde 06/10/2026, migrations **0089–0093**): o que a execução, as revisões e o `/code-review high` mudaram, conferido no código (seção nova "Plano 10A — o que mudou na execução", no fim). **RN-140 (b) corrigida:** a assinatura **mantém** `base_pdf_path` e as fotos; cada arquivo sai depois no seu `apagarArquivo` (`soltarArquivosDoPreparo`, regra 9), e o gatilho só deixa esses ponteiros **saírem** num emitido. **Banco:** colunas `digitalizacao`, `digitalizacao_status`, `digitalizacao_em` e `tenants.documentos_liberados` no §10; migration **0092** (defesa em profundidade: recibo `portal`/`link_email` só pela sessão de paciente, situação da verificação só avança, FK da verificação para o documento, código do link só de documento assinado) e **0093** (PDF assinado só em `documento_assinado/` com prefixo exato e do tipo certo na assinatura; rascunho sem dados de assinatura, cancelamento ou substituição; preparo exige declaração e PDF pendente). **Interruptor do admin** (`documentos_liberados`, D20 do Plano 10A) em US-140, US-146 e RN-153. **Textos de interface finais** do 10A (seção nova) e os ajustes de US-143, US-144 (digitalizada), US-145, US-146, US-147 e US-149 ao que a tela mostra. Nada do Plano 10B nem do Plano 13 mudou nesta versão; o 10B numera as migrations dele a partir da **0094** |
| Revisão 0.5 (08/10/2026) | **Preparação do Plano 13** (pedido e aprovado pelo dono em 08/10/2026), só na parte do Plano 13 — parecer (§3.1, US-141, RN-148), retificação (US-148, RN-146, RN-147), LGPD e histórico do parecer (US-150), portal e verificação pública do parecer —, conferida contra o código da `main` em `3b59c38` (Planos 01–12 em produção) e o manual técnico (cap. 09, 10 e 11). **D2 decidida pelo dono em 08/10/2026: (a)** — o parecer tem o mesmo nível de assinatura da receita (hoje a digitalizada do 10A; gov.br e ICP-Brasil quando o 10B sair), revisável para (b) se o CRN-3 confirmar (P-B1); a variante da opção A (`plataforma`, `preparando → assinado` pelo worker) **não** entra no Plano 13. **Correções pelo código:** exames **não têm edição** (US-015 só cria e exclui; a IA do Plano 11 só **acrescenta** linhas com `iaTarefaId` e pode trocar a data; o Plano 12 cria exame sem valores a partir do envio aceito) — os cenários "corrijo o exame" da US-141 foram reescritos; o índice único parcial da RN-146 **já existe** (0089); `tipo` e `document_verifications` estão fixos em `'receita'` em vários pontos do código (lista no fim); **a próxima migration livre é a 0104** (a 0094–0103 já foram usadas pelos Planos 09, 11 e 12: o "10B a partir da 0094" da v0.4 caducou). Seção nova no fim: "Plano 13 — preparação (v0.5)", com as dependências conferidas, os desvios, as migrations propostas, as boas práticas SBIS NGS1 e as perguntas que sobram ao dono. Item à parte do Plano 13: **P09-07** (paginação e busca da lista de consultórios no `/admin`). Nada do Plano 10A nem do 10B muda nesta versão |
| Status | **Aprovada pelo dono em 05/10/2026** (D1, D3–D16; v0.3.1: divisão 10A/10B e decisões ★ D1–D9 do Plano 10). **D2 decidida pelo dono em 08/10/2026: (a)**, revisável para (b) com a resposta do CRN-3 (v0.5). A parte do Plano 13 da v0.5 aguarda a revisão do dono (perguntas Q13-1 a Q13-5 na seção "Plano 13 — preparação"). **Plano 10A em produção desde 06/10/2026**; o interruptor `documentos_liberados` nasce desligado (padrão `false`, migration 0089); **uso real da receita** (o admin ligar o interruptor) depende da resposta do CRN-3 (P-B1), do termo e do DPA revistos (P-B3, E-09), dos textos revistos pela Debby e do backup no host (P02-11) — checklist em `docs/operacao/go-live.md`, seção do Plano 10A |
| Subprojeto | B do escopo novo (backlog F3-05 e F3-06, confirmados pelo dono em 03/10/2026) |
| Quando | **Plano 10A** (base de documento assinado + receita com assinatura digitalizada: US-140, US-142 a US-147, US-149, base da US-150; **concluído em 06/10/2026**, PR #19), **Plano 10B** (assinatura gov.br e ICP-Brasil: a parte do certificado da US-144, RN-144, RN-145) e **Plano 13** (parecer, retificar, cancelar e a parte de LGPD do parecer: US-141, US-148 a US-150), pelo roadmap aprovado em 05/10/2026. O código vem depois do Plano 08 (em produção desde 04/10/2026). Usa o portal do paciente (Plano 06, em produção) |
| Base | Spec do MVP [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) **v1.11** e histórias [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md). IDs de RN, RNF, INT, US e tabelas sem o prefixo desta spec se referem àqueles documentos |
| Faixa de IDs | Histórias **US-140 a US-159**, regras **RN-140 a RN-159**, requisitos **RNF-140 a RNF-149**, integração **INT-B1**, pendências **P-B1 a P-B11**, critérios **CS-140 a CS-143** (faixa reservada a este subprojeto). **US-151 e RN-155 cortadas** (D7) e não reutilizadas. RN-158 nova na v0.3 |
| Relação com a IA (subprojeto A) | **Nenhuma.** D7 = (a) (05/10/2026): a US-151 (rascunho do parecer com IA) foi cortada; se voltar, é mudança de escopo do Subprojeto A (A-D17 reaberta). Faixas de IDs sem sobreposição (A usa 100–129) |

---

## 1. Visão

A nutricionista emite, dentro do prontuário, dois documentos com validade profissional:

1. **Parecer nutricional** sobre os exames do paciente (F3-05): a leitura, do ponto de vista nutricional, dos marcadores lançados em Exames (US-015), com a conduta e os encaminhamentos — **sem diagnóstico de doença**. Entra no **Plano 13**.
2. **Receita** de suplementos alimentares e de fitoterápicos (F3-06), dentro do que o CFN permite ao nutricionista — **nunca medicamento sujeito a prescrição médica**. Entra nos **Planos 10A** (com a base comum e a assinatura digitalizada) **e 10B** (gov.br e ICP-Brasil).

Os dois nascem de uma **base comum de "documento assinado"**: rascunho editável → PDF com a marca gerado no worker → assinatura → documento **imutável**, com **código de verificação e QR code**, **impressão digital (SHA-256)** do arquivo, **retificação** por nova versão e **cancelamento**. O paciente recebe um **e-mail sem dado de saúde** e abre o documento no **portal** (Plano 06) — ou, sem portal, por um **link de uso único com código** enviado ao e-mail (D3); a nutricionista pode registrar a **entrega pessoal**. O paciente **confirma o recebimento** com um botão (D4). Qualquer pessoa com o código (o paciente, uma farmácia de manipulação) confere a autenticidade numa **página pública que não mostra dado de saúde**.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-140 | Nos 30 dias seguintes à entrega, **100% das receitas de suplementos e fitoterápicos** da Debby saem pelo sistema | Confirmação da Debby + contagem de `signed_documents` com `tipo = 'receita'` e `status = 'assinado'` |
| CS-141 | **Nenhum** documento assinado muda depois da assinatura | Teste automatizado do gatilho de imutabilidade (RN-140), inclusive pelos caminhos de apagar arquivo e anonimizar, e a tentativa de anonimizar fora do contexto `worker` + SHA-256 da página de verificação igual ao do arquivo guardado |
| CS-142 | **≥ 80%** dos documentos entregues têm o recebimento confirmado pelo paciente em até 7 dias | `recebido.em − documento.entregue_em ≤ 7 dias` (`signed_document_receipts`, evento `recebido`) / documentos entregues no mês |
| CS-143 | Custo recorrente extra para o dono = **R$ 0** (D1) | Fatura dos serviços externos (o envio de e-mail continua dentro da cota do plano atual do Resend — conferir no runbook do Plano 10A) |

### 1.2 Premissas

| # | Premissa | Origem |
|---|---|---|
| B-01 | Um tenant = uma nutricionista (D-10 do MVP v1.11: sem recepcionista). O perfil profissional fica no tenant; se a Fase 2 trouxer mais de uma nutricionista por tenant, o perfil vira por usuário | Spec do MVP |
| B-02 | Somente pacientes adultos (D-11, RN-17) | Spec do MVP |
| B-03 | Nenhum custo extra além do que o dono aceitar explicitamente (a assinatura era a principal fonte possível de custo; a D1 escolheu caminhos gratuitos) | Dono |
| B-04 | O conteúdo técnico (doses, interações, limites de ingestão) é **responsabilidade profissional da nutricionista**; o sistema registra, formata, trava e entrega, mas não valida a conduta | Res. CFN 656/2020, art. 4º (responsabilidade ética, civil e criminal) |
| B-05 | Esta spec **não** cria nada de loja (F4-01, projeto à parte). Ver §3.5 | Dono (03/10/2026 e 05/10/2026) |

---

## 2. Escopo

### 2.1 Dentro do escopo

| ID | Bloco | Conteúdo | Plano |
|---|---|---|---|
| B1 | **Base de documento assinado** | Perfil profissional para documentos (nome completo, CRN, contato, habilitação em fitoterapia); estados e travas; PDF com a marca no worker; código de verificação + QR; SHA-256; assinatura (D1: gov.br, ICP-Brasil e digitalizada); entrega por e-mail neutro + portal, link de uso único (D3) e entrega pessoal; confirmação de recebimento (D4); página pública de verificação; auditoria, exportação, bloqueio e anonimização (LGPD) da receita; retificação; cancelamento | **10** (base, sem retificação; LGPD da receita pela §2.3 i; cancelamento pela §2.3 iii) · **13** (retificação; cancelamento, se não subir; LGPD do parecer) |
| B2 | **Parecer nutricional (F3-05)** | Sobre exames já lançados (US-015): escolha dos exames, cópia congelada dos valores, avaliação nutricional, conduta, encaminhamentos, ressalva fixa; declaração de que não há diagnóstico de doença | **13** |
| B3 | **Receita (F3-06)** | Suplementos alimentares (Res. CFN 656/2020), plantas medicinais e drogas vegetais em chá (todas as nutricionistas), drogas e derivados vegetais em forma farmacêutica classificados como alimento ou suplemento (todas, Res. 680, art. 3º, § 2º, redação da 731/2022; tipo próprio, D13) e fitoterápicos em forma farmacêutica / magistrais (só com habilitação, Res. CFN 680/2021); campos obrigatórios das resoluções; justificativa de uso no prontuário, fora do alcance do paciente no banco (D15) | **10** |

### 2.2 Fora do escopo

Checagem automática de dose máxima (UL), interações nutriente × fármaco × planta e contraindicações (responsabilidade da nutricionista, B-04) · catálogo de suplementos ou de plantas · campo de marca, fabricante, farmácia ou loja (decisão de produto, RN-151 e D14; a norma permite citar marca com mais de uma opção) · integração com farmácias · receita de medicamento de qualquer tipo · atestado, declaração de comparecimento e relatório para convênio (outros documentos; a base serve a eles depois, se o dono quiser) · assinatura e confirmação de recebimento do **plano alimentar** entregue em telenutrição — **lacuna de conformidade do MVP registrada** (Res. CFN 760/2023, art. 10; P-B10): pela D12 = (b), a pergunta vai na consulta da P-B1 e, se o CRN-3 confirmar a exigência, vira escopo novo, fora dos Planos 10 e 13 · assinatura em lote · assinatura pelo paciente · validação de revogação do certificado (OCSP/LCR) — a página de verificação aponta para o validador oficial do ITI (RN-144) · integração por API com prestador de assinatura em nuvem (opção D da D1, só com demanda e custo aprovado) · **rascunho de parecer com IA** (D7: cortado; se voltar, mudança de escopo do Subprojeto A, A-D17) · integração por QR com o VALIDAR do ITI (exporia o PDF a quem tivesse o código, contra a D8) · loja (F4-01).

### 2.3 Fatias de entrega: Planos 10A, 10B e 13 (D9)

**v0.3.1 (05/10/2026):** o Plano 10 foi dividido pelo dono em **10A** e **10B**. O 10A entrega a receita utilizável de verdade com a assinatura **digitalizada** (opção E da D1) e não depende do 10B; o 10B acrescenta gov.br (B) e ICP-Brasil (C) pelo mesmo fluxo de envio do PDF assinado, sobre a mesma tabela e o mesmo PDF preparado (um documento preparado antes do 10B pode ser assinado com certificado depois dele).

| Item | Plano 10A (base + receita + digitalizada) | Plano 10B (gov.br e ICP-Brasil) | Plano 13 (parecer, retificar, LGPD do parecer) | Fora |
|---|---|---|---|---|
| Histórias | US-140, US-142, US-143, US-144 (digitalizada), US-145, US-146, US-147, US-149 (iii), US-150 (base, i) | US-144 (envio do PDF assinado, primeiro certificado, recusas), US-147 (link do ITI) | US-141, US-148, US-150 (parte do parecer) | US-151 (D7) |
| Regras | RN-140 a RN-143, RN-145 (2FA na digitalizada), RN-147, RN-149 a RN-154, RN-156 a RN-158 | RN-144, RN-145 (CPF, nome, troca) | RN-146, RN-147 (retificação em andamento), RN-148, RN-154 (exames) | RN-155 (D7) |
| Decisões | D1 (E), D3, D4, D5 (texto da receita), D6, D10 (limite), D13, D14, D15 | D1 (B e C), D8, D16 | **D2 = (a)** (08/10/2026; revisável para (b) com o CRN-3), D5 (ressalva e declaração do parecer), D11, D12 (resposta do CRN-3) | D7 |

Três ajustes de corte, propostos ao dono no Plano 10 (decisões ★ de lá) e **aprovados pelo dono em 05/10/2026** como recomendados — os três ficam no Plano 10A:

- **(i) Base de LGPD da receita no Plano 10A** (aprovado): auditoria (gatilho + `auditRead`), exportação da equipe e do titular com os PDFs e o `dados.json`, bloqueio (só leitura) e anonimização pela `app_anonimizar_documentos`. A RN-154 copia o nome do paciente para o conteúdo, e a anonimização atual (`anonimizarVencidos`) não conhece os PDFs: sem isto, um paciente anonimizado continuaria identificável, e as exportações (US-018, US-046) sairiam sem as receitas. No Plano 13, a US-150 cobre só o que é do parecer.
- **(ii) Esquema completo no Plano 10A** (aprovado): `status` com os 6 estados, gatilho `app_documento_imutavel` com todas as transições, `document_verifications.situacao` com as 4 situações e `signed_document_notes.motivo_cancelamento`. O CHECK de `tipo` é só `'receita'` no Plano 10; o Plano 13 amplia para `'parecer'` e cria `exam_ids`. O gatilho é a parte mais delicada (CS-141): escrito e testado uma vez, sem reescrever o gatilho de uma tabela que já tem documentos assinados de verdade.
- **(iii) Cancelar antes do uso real** (aprovado: a US-149 sobe para o Plano 10A): sem cancelamento, uma receita assinada com dose errada continua "Documento válido" na verificação pública, para a farmácia, até o Plano 13. Alternativa: a liberação para uso real da receita fica depois do Plano 13.

---

## 3. Enquadramento normativo (o que a nutricionista pode e não pode)

> As normas abaixo foram conferidas no texto publicado pelo CFN ou em fonte oficial, salvo onde está escrito **"a confirmar"**. Esta seção não substitui a consulta ao CRN-3 nem ao advogado (P-B1, P-B3).

### 3.1 Parecer nutricional sobre exames (Plano 13)

| Pode (com fundamento) | Não pode |
|---|---|
| Solicitar e avaliar exames laboratoriais "necessários à avaliação, à prescrição e à evolução nutricional" (Res. CFN 306/2003, art. 1º; Lei 8.234/1991; Res. CFN 600/2018, Anexo, D.2.1) | Afirmar **diagnóstico nosológico** (doença): "anemia ferropriva", "diabetes", "hipotireoidismo". O inciso I do art. 4º da Lei 12.842/2013 (diagnóstico nosológico privativo do médico) foi **vetado**, mas o § 1º define diagnóstico nosológico e o CFM o trata como exclusivo; a posição segura é **não afirmar doença** |
| Fazer o **diagnóstico de nutrição**: "identificação e determinação do estado nutricional do cliente/paciente/usuário" (Res. CFN 600/2018, Anexo I, item XXXII) — p. ex. "marcadores compatíveis com baixa reserva de ferro; consumo alimentar de ferro abaixo da recomendação" | Prescrever, suspender ou ajustar **medicamento** |
| Considerar "diagnósticos, laudos e pareceres dos demais membros da equipe" e definir a conduta com eles (Res. CFN 656/2020, art. 3º, III; Res. CFN 306/2003, art. 2º, parágrafo único) | Contradizer conduta médica sem diálogo (cabe **encaminhar**) |
| Registrar conduta dietética, orientação e **encaminhamento** ("sugiro avaliação médica para…") | Usar o parecer como laudo de exame (quem emite laudo é o laboratório) |

Consequências no produto: título fixo **"Parecer nutricional"**, ressalva fixa impressa (texto na D5), campo próprio de **encaminhamentos** e **declaração** da nutricionista antes de preparar para assinatura (RN-148). O sistema **não** filtra palavras: a responsabilidade é da profissional (B-04).

**v0.5 — os exames que o parecer lê, como estão no código (08/10/2026):** `exams` (US-015) guarda `data`, `titulo`, o laudo (`arquivo_path`, opcional) e `valores jsonb` = lista de `{ nome, valor (número), unidade, referencia, iaTarefaId? }` (até 50 linhas, `lerValores` em `src/modules/pacientes/exames.ts`). **Não existe edição de exame:** a nutricionista cria e exclui (`criarExame`, `excluirExame`); a leitura com IA do Plano 11 (`aplicarSugestao`, `src/modules/ia/conferencia.ts`) só **acrescenta** linhas conferidas pela nutricionista, cada uma com `iaTarefaId` (a origem fica no prontuário, spec da IA §5.11), e pode trocar a `data` do exame; o Plano 12 cria o exame a partir do envio aceito do paciente (`aceitarEnvio`), **sem valores** e com o selo "Enviado pelo paciente" (`exam_submissions.exam_id`). Por isso "os valores mudaram" no Plano 13 quer dizer: linhas acrescentadas pela IA, data trocada ou exame excluído. O paciente não vê exames no portal (US-044; D17 do Plano 12); no parecer ele recebe a cópia dos valores dentro do PDF, que é o documento da nutricionista.

### 3.2 Receita de suplementos alimentares — Res. CFN 656/2020 (alterada pela Res. CFN 731/2022)

- **O que entra** (art. 1º, § 1º): nutrientes (vitaminas, minerais, lipídios, ácidos graxos, carboidratos, fibras, proteínas, aminoácidos e seus precursores e metabólitos), substâncias bioativas, enzimas, prebióticos, probióticos, produtos apícolas (mel, própolis, geleia real, pólen), novos alimentos e novos ingredientes e outros autorizados pela Anvisa, **e medicamentos isentos de prescrição** à base de vitaminas, minerais, aminoácidos e/ou proteínas. Produto industrializado ou manipulado, **isento de prescrição médica** (§ 2º).
- **Vias** (§ 3º): só **oral e enteral**, incluídas mucosa, sublingual e sonda enteral; **excluída a anorretal**. Injetável nunca.
- **Deveres** (art. 3º): triagem e avaliação nutricional sistematizadas (II); não prescrever de forma isolada, só como parte da adequação do consumo alimentar (IV); considerar interações e toxicidade (VI); respeitar o **UL** (VII); respeitar as listas de constituintes da **IN Anvisa 28/2018 e atualizações** (VIII; versão vigente **a confirmar**, P-B4); **enzimas em Unidades (U)** e **probióticos em UFC** (IX).
- **Campos obrigatórios do receituário** (art. 3º, XI): nome do paciente; **via, composição e posologia**; data; assinatura e **carimbo** com nome, número do registro no Conselho e **jurisdição**; **telefone e endereço completo ou outro meio de contato profissional**.
- **Prontuário** (art. 3º, XII, redação da 731/2022): via, composição, posologia e **justificativa de uso**.
- **Entrega** (parágrafo único-A, incluído pela 731/2022): "pessoalmente ou enviado eletronicamente (**digitalizado ou com assinatura digital certificada**) …, **com confirmação de recebimento**".

### 3.3 Fitoterapia — Res. CFN 680/2021 (alterada pelas Res. CFN 688/2021 e 731/2022)

| Item | Regra | Artigo |
|---|---|---|
| Plantas medicinais *in natura* e drogas vegetais **em infusão, decocção ou maceração em água** | **Todas** as nutricionistas | Art. 3º, I |
| Drogas vegetais em forma farmacêutica, medicamentos fitoterápicos, produtos tradicionais fitoterápicos e preparações magistrais | Só com **habilitação em Fitoterapia registrada no CRN** (pós-graduação lato sensu com ≥ 200 h de disciplinas de fitoterapia, ou título de especialista) | Art. 3º, II, e art. 5º |
| **Exceção:** drogas vegetais e derivados vegetais, **em formas farmacêuticas**, "que podem ser classificados como alimentos, novos alimentos e ingredientes, e suplementos alimentares" (p. ex. um extrato vegetal registrado como suplemento) | **Todas** as nutricionistas: "não se exige certificado de pós-graduação em fitoterapia ou título de especialista na área". Valem os campos do art. 12, I (nomenclatura botânica, parte utilizada, padronização do marcador quando houver) | Art. 3º, § 2º, incluído pela Res. CFN 731/2022 |
| Planta *in natura*/droga vegetal **do inciso I** (uso tradicional, não classificada como alimento/suplemento) | Só como chá (decocção, maceração ou infusão em água), não em cápsula, xarope, tintura, extrato etc.; a forma farmacêutica cai na linha da habilitação, **salvo** o produto classificável como alimento ou suplemento (exceção do § 2º acima) | Art. 10 + art. 3º, § 2º |
| Fitoterápico **sujeito a prescrição médica** (e a planta correspondente, em qualquer forma) | **Proibido** | Art. 9º, I |
| Vitaminas, minerais, aminoácidos, substâncias isoladas ou associações na **composição** de fitoterápico/magistral | **Proibido** (suplemento vai como item próprio, pela Res. 656) | Art. 9º, II |
| Venda, comercialização e propaganda dos produtos que ela indica | **Proibido** | Art. 9º, III |
| **Consequência no produto** | O item "Suplemento alimentar" sozinho não tem os campos do art. 12, I; o produto vegetal do § 2º tem **tipo próprio** liberado para todas, com os campos do art. 12, I obrigatórios (D13 = (a), 05/10/2026) | — |
| **Campos do receituário** | Nomenclatura botânica (nome popular opcional); parte utilizada; forma de utilização e modo de preparo (chás); forma/meio de extração, padronização do marcador (quando houver na literatura) e forma farmacêutica (formulados); via e posologia; data; dados do paciente e da nutricionista (nome completo, CRN, e-mail e telefone); carimbo e assinatura; entrega pessoal ou eletrônica "(digitalizado ou com assinatura digital certificada)… **com confirmação de recebimento**"; registro em prontuário | Art. 12 |

### 3.4 Assinatura eletrônica — análise e decisão D1

**Normas:** MP 2.200-2/2001, art. 10, § 1º (documento assinado com certificado **ICP-Brasil** presume-se verdadeiro em relação ao signatário) e § 2º (outros meios de comprovação de autoria e integridade valem se **admitidos pelas partes ou aceitos pela pessoa a quem forem opostos**). Lei 14.063/2020, art. 4º: **simples** (identifica o signatário), **avançada** (certificado não ICP-Brasil ou outro meio admitido pelas partes, ligada ao signatário de forma unívoca, sob seu controle exclusivo e com **qualquer modificação posterior detectável**) e **qualificada** (certificado ICP-Brasil). Para a saúde, a lei exige **qualificada** só para receita de medicamento sob controle especial e atestado médico (art. 13) e declara válidos "para todos os fins" os demais documentos eletrônicos de profissionais de saúde assinados com **avançada ou qualificada** (art. 14) — redação dos arts. 13 e 14 conferida em fontes secundárias; **conferir no Planalto**. **Leitura do art. 14:** é cláusula de **suficiência** — documentos de saúde com avançada ou qualificada têm presunção de validade "para todos os fins"; a lei **não proíbe** a assinatura simples nesses documentos. A **exigência** de qualificada (art. 13) vale só para receita de medicamento sob controle especial e atestado médico, que não são documentos da nutricionista.

**Exigências do CFN — dois grupos de normas:**

| Norma | Alcance | O que exige | Texto |
|---|---|---|---|
| **Res. CFN 760/2023** (telenutrição; DOU de 24/10/2023; revogou a Res. 666/2020, art. 17) | "As informações e os documentos produzidos a partir do atendimento e/ou da prestação de serviços em alimentação e nutrição por meio da Telenutrição" — **todos** os documentos da consulta online (parecer, receita, plano alimentar, orientações) | Art. 10: I — datados e identificados (cliente e nutricionista: nome completo, CRN, e-mail e telefone); II — "assinados eletronicamente **e/ou com código verificador da autenticidade do documento**, em consonância com a Lei n° 14.063 […], sendo, **preferencialmente**, assinatura eletrônica avançada ou qualificada"; III — "enviados eletronicamente ou de qualquer outra forma que tenha sido acordada com o cliente, desde que tenha a **confirmação de recebimento**"; IV — registrados em prontuário | Conferido em fonte secundária (LegisMap); DOU **a conferir** |
| **Res. CFN 656/2020** (parágrafo único-A, redação da 731/2022) e **Res. CFN 680/2021** (art. 12, IV) | Só a **receita** (suplementos e fitoterapia), presencial ou online | Entrega eletrônica "**digitalizado ou com assinatura digital certificada**", com confirmação de recebimento | Conferido no site do CFN |

Leitura: para o **parecer**, a norma específica é a 760/2023 (quando a consulta é online) — assinatura eletrônica com código verificador basta, e avançada/qualificada é **preferencial**; para o parecer de consulta presencial não há norma do CFN de forma, só a Lei 14.063 (D2, Plano 13). Para a **receita**, as Res. 656/680 pedem "digitalizado ou com assinatura digital certificada"; se o gov.br (certificado do ITI fora da ICP-Brasil) atende essa expressão é **a confirmar com o CRN-3** (P-B1).

| Opção | O que é | Nível (Lei 14.063) | Receita: atende o "assinatura digital certificada" (656/680)? | Parecer e demais documentos: atende a 760/2023? | Custo | Atrito para a nutricionista | Integração no NutriDebby |
|---|---|---|---|---|---|---|---|
| **A. Assinatura na plataforma + código de verificação** | Senha + código do 2FA no momento de assinar; o sistema registra quem, quando, IP e o SHA-256; o PDF sai com código verificador e QR | Simples, ou avançada **discutível** | **Provavelmente não** | **Sim, pelo texto**; não é a forma "preferencial" | R$ 0 | **Baixo** | Simples (tudo dentro do sistema) — **só para o parecer, se a D2 = (b)** |
| **B. gov.br** | A nutricionista baixa o PDF, assina em `assinador.iti.br` com a conta gov.br prata ou ouro e envia o PDF assinado de volta | Avançada | **A confirmar** (P-B1) | Sim (preferencial) | R$ 0 | **Alto** (baixar, assinar no site do ITI, reenviar) | Upload do PDF assinado + conferência no servidor (RN-144). A API do gov.br é só para órgão público ("credenciais… solicitadas por um Gestor Público") |
| **C. ICP-Brasil da nutricionista** | e-CPF A1/A3 ou em nuvem da própria nutricionista; assina o PDF fora do sistema (Adobe Acrobat Reader, Assinador SERPRO, app do certificado) e envia | **Qualificada** | **Sim** | Sim (preferencial) | R$ 0 para o dono; a nutricionista paga o certificado (~R$ 160–240/ano para e-CPF A1, **a confirmar**) | **Alto** (igual à B) | Igual à B (mesmo upload e conferência) |
| **D. ICP-Brasil em nuvem integrada** | O sistema chama a API de um prestador de assinatura em nuvem (PSC) | Qualificada | Sim | Sim (preferencial) | **Custo por assinatura ou contrato com o PSC** | Médio | Integração por API, contrato, homologação |
| **E. Digitalizada** | Imprime, assina à mão, fotografa ou digitaliza as páginas e envia | — (cópia de documento físico) | **Sim** ("digitalizado" está no texto do CFN) | Sim, com o código verificador do sistema | R$ 0 | Alto (imprimir e digitalizar) | Envio das páginas como imagens; o worker monta um PDF novo com o rodapé do código e do QR (RN-157). **Sem conferência de conteúdo nem de assinatura** |

**Força de prova:** C e D (qualificada) > B (avançada) > A (simples/avançada discutível, mas com trilha de auditoria, 2FA e código verificador) > E (cópia digitalizada, sem vínculo técnico entre o arquivo e o conteúdo preparado).

**Decisão D1 (05/10/2026), receita:** aceitar **B e C pelo mesmo fluxo** (baixar PDF → assinar fora → enviar PDF assinado; o servidor confere a assinatura PAdES), com custo zero para o dono; **E** como alternativa para quem não tem gov.br prata/ouro nem certificado, sabendo que o sistema não confere o conteúdo dela (RN-157); assinar exige a verificação em duas etapas ativa (RN-145); **não** oferecer A para a receita; **D** só com demanda e custo aprovado. Se o CRN-3 recusar o gov.br (P-B1), a receita fica só com C e E, sem mudar o fluxo. **Parecer:** escolha própria na **D2** (Plano 13; A é alternativa real pela 760/2023). **v0.5 — D2 = (a), decidida pelo dono em 08/10/2026:** o parecer usa o **mesmo nível de assinatura da receita** — hoje a digitalizada (E) do Plano 10A, com o código do 2FA em todo envio (RN-145); gov.br (B) e ICP-Brasil (C) quando o Plano 10B sair, pelo mesmo fluxo. Revisável para (b) se o CRN-3 confirmar, na consulta da P-B1, que a opção A atende o parecer (Res. CFN 760/2023, art. 10, II).

### 3.5 Relação com a loja (F4-01) e normas de ética

**Normas de ética e a data de vigência.** Hoje vale o Código de Ética da **Res. CFN 599/2018**; o novo Código, **Res. CFN 856/2026** (DOU de 28/04/2026), revoga a 599 e entra em vigor em **23/01/2027** (prorrogação da vacância por resolução do CFN de 20/07/2026, **número e texto a confirmar no DOU**, P-B11). Os Planos 10A e 10B entram antes dessa data; o texto da 856 ainda pode mudar (consulta pública de 2026). Por isso as duas são citadas:

| Tema | Res. CFN 599/2018 (vigente até a 856) | Res. CFN 856/2026 (a partir de 23/01/2027, texto publicado) |
|---|---|---|
| Marca na prescrição | Art. 60: vedado indicar ou manifestar preferência por marcas "de modo a não direcionar escolhas"; **inciso III**: havendo necessidade de mencionar marcas na prescrição dietética, "deverá apresentar mais de uma opção, quando disponível"; sem outra opção equivalente, "é permitido indicar o único existente" | Art. 74, caput (vedação de prescrever, indicar ou manifestar preferência por marcas de suplementos, fitoterápicos, farmácias etc.) e **inciso III** (na prescrição dietética, múltiplas opções de marcas quando disponíveis); parágrafo único: venda casada proibida |
| Venda e propaganda do que indica | Arts. 60 a 63 | Arts. 60, 63, 74 a 77 (ver a nota de viabilidade da loja) |
| Uso de IA | — | Art. 37 (indicar o uso de ferramentas automatizadas). **D7 decidida (05/10/2026): sem IA nos documentos** — fica só como referência |

Também a Res. CFN 680/2021, art. 9º, III, proíbe vender, comercializar e fazer propaganda dos fitoterápicos que ela indica. As normas **permitem** citar marca na receita com mais de uma opção; a ausência do campo de marca é **decisão de produto** (RN-151, D14), alinhada ao art. 74 da 856/2026. Este subprojeto não tem nenhum ponto de contato com a F4-01; a loja é **projeto à parte** (roadmap de 05/10/2026), o que reduz o risco ético para a nutricionista.

---

## 4. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** | Criar, editar e apagar rascunhos; preparar para assinatura; enviar o PDF assinado ou a digitalização; registrar a entrega pessoal; reenviar o link de acesso; retificar (Plano 13); cancelar; ver tudo dos documentos do próprio tenant | Alterar ou apagar documento assinado; prescrever fitoterápico formulado sem habilitação registrada no perfil (RN-150) |
| **Paciente** (portal, Plano 06; ou pelo link com código, D3) | Ver e baixar os **próprios** documentos emitidos (assinados, substituídos ou cancelados); **confirmar o recebimento** (D4) | Ver rascunhos, documentos em preparo e documentos de outro paciente — garantido **no banco** (política `paciente_so_emitidos`), não só na API; ver a justificativa de uso e o motivo de cancelamento — também no banco, pela tabela `STAFF_ONLY` `signed_document_notes` (§10). **D15 = (b):** a justificativa sai só na exportação do titular; o motivo de cancelamento nunca. Alterar qualquer coluna do documento (a sessão de paciente só **insere** o recibo, `signed_document_receipts`) |
| **Admin da plataforma** | Nada nos documentos (regra do MVP: nunca lê dado de saúde) | Ler, contar por paciente ou baixar documentos; ler o CPF do assinante |
| **Visitante da verificação** (paciente, farmácia, qualquer um com o código) | Ver situação, tipo, data, nutricionista e CRN, o nome do titular do certificado que assinou e o SHA-256 (D8) | Ver nome do paciente, conteúdo, exames ou itens da receita |

---

## 5. Fluxo e estados

```
            "Nova receita" (Plano 10A) / "Novo parecer" e "Retificar" (Plano 13)
                              │
                              ▼
   ┌──────────────► rascunho ──── "Apagar rascunho" ──► (apagado)
   │                   │
   │  "Voltar a        │ "Preparar para assinatura" (declaração + perfil completo)
   │   editar"         ▼        congela o conteúdo, gera o código
   ├──────────────── preparando ── worker: PDF com a marca, código, QR e quadro "Assinatura digital" ──┐
   │                   │                                                                             │ falhou → "Gerar o PDF de novo"
   │                   ▼                                                                             │
   └──────────── aguardando_assinatura ◄─────────────────────────────────────────────────────────────┘
                       │  "Enviar PDF assinado" (B/C, conferência RN-144) ou
                       │  "Enviar documento digitalizado" (E, imagens → PDF montado no worker, RN-157)
                       ▼
                   assinado ──► entrega: portal + e-mail neutro (+ push) · sem portal: link + código (D3 b)
                    │    │                · presencial: "Entregue pessoalmente"
                    │    │                └─► recibo: aberto / recebido (D4, signed_document_receipts)
       "Retificar" ─┘    └─ "Cancelar documento" ──► cancelado
       (Plano 13; nova versão assinada)
                    ▼
                substituido
```

- Do `preparando` em diante o **conteúdo não muda** (gatilho no banco, RN-140). "Voltar a editar" só existe antes da assinatura: descarta o código, solta o PDF base e volta a `rascunho`, na ordem da RN-140. **v0.4 (code review do PR #19, item 9):** na tela, em "Preparando o PDF" o botão só aparece com o PDF falho ou sem cota (`podeVoltarAEditar`, `src/modules/documentos/constantes.ts`; senão o documento ficaria preso), e em "Aguardando assinatura" nunca durante um envio digitalizado em curso (`envioEmCurso`: `recebendo`/`pendente` há menos de 1 h) — o módulo também recusa, na trava e no `apagarArquivo` do base.
- **v0.4 — interruptor do admin (D20 do Plano 10A):** `tenants.documentos_liberados` (padrão `false`). Desligado, a aba "Documentos" não aparece, as ações e as rotas do painel respondem 404, o portal não mostra nem abre documento, o link do e-mail fica "indisponível" (nenhum código é enviado) e a entrega da assinatura não sai; a verificação pública continua respondendo. O admin liga na tela do consultório depois da liberação para uso real e **não desliga depois** (desligado, o consultório perde também "Cancelar documento" e "Entregue pessoalmente").
- A linha pública de verificação (`document_verifications`) nasce **só na assinatura**; o código impresso num PDF que nunca foi assinado não existe na verificação.
- Na digitalizada (E), o PDF entregue é o que o worker monta a partir das imagens; enquanto ele não fica pronto, a tela mostra "Montando o PDF digitalizado…" (o documento continua em `aguardando_assinatura` até o `registrar` do arquivo novo).

### 5.1 Organização do código

Módulo novo `src/modules/documentos/` (padrão do MVP: funções de domínio em vários arquivos). Planos 10A e 10B (v0.3.1: no 10A, tudo menos o leitor, a conferência, as âncoras, `assinar.ts` e `assinante.ts`, que são do 10B; a parte comum da assinatura — a ida a "assinado" amarrada à versão lida, a verificação pública e a entrega — fica em `registrar-assinatura.ts`, no 10A, sem dependência de sessão, usada pela digitalizada no worker e pelo `assinar.ts` do 10B): `constantes.ts` (textos e limites, sem imports, para componentes `'use client'`), `codigo.ts` (código Crockford), `prescricao.ts` (esquema Zod da receita; "prescrição" nos identificadores, para não colidir com as receitas culinárias do Plano 07), `documentos.ts` (rascunho, estados, preparar, voltar a editar), `perfil-profissional.ts`, `pdf-leitor.ts` + `pdf-atualizacao.ts` + `cms.ts` + `certificados.ts` + `assinatura-pades.ts` (conferência do PDF assinado, com leitor **limitado** à atualização incremental; nenhum parser completo de PDF no processo do Next), `assinar.ts` (aceite do envio), `verificacao.ts` (único acesso a `document_verifications`), `documento-pdf.tsx` + `documento-pdf-job.ts` + `digitalizada-job.ts` (**só o worker importa**: `@react-pdf/renderer`), `entrega.ts` (e-mail e push), `recebimento.ts` (D4), `link-documento.ts` (D3 b), `lgpd-documentos.ts` (exportação e anonimização) e `cancelamento.ts` (§2.3 iii). Plano 13: `parecer.ts`, `retificacao.ts`. Fora do módulo: `src/lib/confirmar-2fa.ts` (código do 2FA no momento de assinar, RN-145).

**Contextos:** painel = `nutri` (com `actorUserId` e `ip`); portal = `paciente`; PDF, conferência assíncrona (D16 a, se o spike pedir), entrega pelo worker e anonimização = `worker`; página do link (D3 b) = `paciente` com `semConta: true` (`link-documento.ts` entra em `SEM_CONTA_PERMITIDOS`); verificação pública = **nenhum contexto de tenant** (só `verificacao.ts`, tabela em `RLS_EXCEPTIONS`, §10). O contexto `publico` (D11 do Plano 05) **não** é usado: nenhuma tabela nova entra em `PUBLICO_LIBERADO`.

**Rotas:** painel `/painel/pacientes/[id]/documentos` (lista e "Nova receita") e `/painel/pacientes/[id]/documentos/[docId]` (editor e situação); `POST /api/painel/documentos/[id]/assinado` (Route Handler, não Server Action: o `proxy.ts` corta corpos em 10 MB), `POST /api/painel/documentos/[id]/digitalizada`, `GET /api/painel/documentos/[id]/pdf` (estado do PDF e download, como `/api/painel/planos/[id]/pdf`); portal `/p/documentos`, `GET /api/p/documentos/[id]/pdf`; link `/documento/[token]` + `POST /api/documento/[token]/{codigo,confirmar,recebido}` e `GET /api/documento/[token]/pdf`; verificação `/v` e `/v/[codigo]`. **v0.4 (como ficou no 10A):** `POST /api/painel/documentos/[id]/assinado` é do Plano 10B (não existe no 10A); `GET /api/painel/documentos/[id]/pdf` responde `?estado=1` com o estado em JSON (sem auditoria, para o "Preparando o PDF…"), `?base=1` com 303 para o PDF preparado (só em "Aguardando assinatura") e, sem parâmetro, com 303 para o PDF assinado — as duas leituras de PDF com `auditRead`; a sessão do link é o cookie `nd_doc` gravado duas vezes (`Path=/documento/<token>` e `Path=/api/documento/<token>`), porque o `path` de um cookie não cobre os dois prefixos; os módulos novos fora da lista acima são `arquivos-do-preparo.ts` (`soltarArquivosDoPreparo`, `travarDocumentoAntesDaCota`), `digitalizada.ts`, `portal.ts`, `erros.ts` e `registrar-assinatura.ts`; `src/lib/ler-cookie.ts` (o `lerCookie` sem `server-only`, para a rota do link sem login).

**Guardas:** toda página nova do painel entra em `ROTAS_DO_PAINEL` (axe e 768 px) e tem guia no manual (`GUIAS`, P08-10) ou entrada em `SEM_AJUDA`; o arquivo do link entra em `SEM_CONTA_PERMITIDOS`; nenhuma rota importa os arquivos de PDF do worker (grafo de imports); só `verificacao.ts` referencia `document_verifications`. **Manual guiado:** guia próprio `documentos` (antes do `prontuario` na lista, como o do plano alimentar), seção "Dados para documentos" no guia `configuracoes` (com `versao` + 1) e guia novo `seguranca` para `/conta/seguranca` (a tela de ativar a verificação em duas etapas, exigida para assinar); textos em rascunho até a aprovação (P08-08). **v0.4:** `documentos` v1 (6 passos), `configuracoes` v2 e `seguranca` v1, este mostrado na própria tela de Segurança num bloco "Como funciona" (a tela fica fora do layout do painel); o guia `prontuario` **não** cita a aba Documentos e fica na v1 enquanto a aba depender do interruptor (P10A-17).

---

## 6. Histórias de usuário

**Prioridade:** **M** = obrigatória para entregar F3-05/F3-06 · **S** = pode ficar para depois. A Definition of Done do MVP vale para todas (RLS + teste de isolamento, auditoria, Zod, axe no painel e no portal nos três modos — claro, escuro e igual ao aparelho —, visual V2 só com os tokens do tema, nada de dado de saúde em log/Sentry, guia no manual para toda tela nova do painel). Os textos marcados "(proposto)" são da v0.3 e passam pela revisão da Debby junto com os da D5.

### US-140 — Perfil profissional para documentos · **M** · Plano 10A

**Como** nutricionista, **quero** completar meus dados profissionais, **para que** saiam no carimbo dos documentos como o CFN exige.

Lugar: Configurações > Perfil e marca, seção "Dados para documentos" (`/painel/configuracoes/perfil#documentos`).

| Campo | Obrig. | Validação | Erro |
|---|---|---|---|
| `nome_profissional` (nome completo) | Sim | 5–120 caracteres | "Informe seu nome completo (5 a 120 caracteres)" |
| `crn` (já existe; a coluna é opcional desde o MVP) | Sim para preparar | `CRN_REGEX` do MVP (`crnSchema`, ex.: CRN-3 12345); a jurisdição é o número da região | "CRN inválido. Ex.: CRN-3 12345" |
| `contato_email` | Sim | e-mail válido | "Informe um e-mail profissional válido" |
| `contato_telefone` | Sim | validação e formato por `src/modules/pacientes/telefone.ts` (E.164, exibido `(11) 91234-5678`) | "Informe um telefone válido com DDD" |
| `endereco_consultorio` (já existe) | Não | até 200 caracteres | "Use no máximo 200 caracteres" (texto do MVP) |
| Habilitação em Fitoterapia | Não | caixa + "Registro da habilitação no CRN" (até 60 caracteres) obrigatório se a caixa estiver marcada | "Informe o registro da sua habilitação em Fitoterapia no CRN" |

```gherkin
Cenário: Perfil incompleto bloqueia a preparação
  Dado que meu perfil não tem "nome completo"
  Quando clico em "Preparar para assinatura"
  Então vejo "Complete seu perfil profissional (nome completo, CRN e contato) antes de preparar documentos."
  E o link "Completar perfil" leva a Configurações > Perfil e marca

Cenário: Declarar habilitação em Fitoterapia (D6: autodeclaração)
  Quando marco "Tenho habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021)"
  E informo o registro "CRN-3 nº 1234/2024"
  E confirmo "Declaro, sob minha responsabilidade, que a habilitação está registrada no CRN."
  Então vejo "Habilitação em Fitoterapia registrada no perfil."
  E a data da declaração e a versão do termo ficam gravadas
  E a declaração fica registrada na auditoria do consultório (`audit_log`, entidade "Perfil profissional", sem paciente)
  # v0.3 corrigida: não existe tela "Histórico do consultório" (só o Histórico de acessos de cada paciente); a auditoria
  # é conferida por teste. Uma tela de auditoria do consultório fica no backlog do Plano 10A (P10A-17)

Cenário: Mudar o perfil não altera documentos já preparados
  Dado um documento em "Aguardando assinatura" com o telefone antigo
  Quando altero o telefone do perfil
  Então o PDF já preparado continua com o telefone antigo
```

**v0.4 (como ficou no 10A):** a seção fica em `/painel/configuracoes/perfil#documentos`, abaixo do formulário "Perfil e marca", com a frase "O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020). O CRN e o endereço ficam no formulário acima."; o CRN e o endereço continuam no formulário de cima. Botões "Salvar dados para documentos" e "Registrar habilitação"; com a habilitação registrada, a tela mostra "Habilitação em Fitoterapia: {registro} (declarada em dd/mm/aaaa)." e o botão "Retirar habilitação" (confirmação "Retirar a habilitação em Fitoterapia do perfil? Os fitoterápicos formulados deixam de poder ser prescritos."; depois, "Habilitação em Fitoterapia retirada do perfil."). Auditoria (`audit_log`, entidade `perfil_profissional`, sem paciente): salvar os dados grava `alterar`; a declaração grava `criar` com `entidade_id = 'fitoterapia:<versão do termo>'` (a prova de quando ela se declarou e de qual termo aceitou, que sobrevive à retirada); a retirada grava `excluir` com `entidade_id = 'fitoterapia'` (desvio do §10, que dizia `alterar` com o id do tenant). O termo é versionado em `TERMO_FITOTERAPIA` (`versao: '2026-10-05'`). A seção aparece mesmo com o interruptor do admin desligado (os dados do carimbo podem ser preenchidos antes da liberação).

### US-141 — Redigir parecer nutricional sobre exames · **M** · Plano 13

**Como** nutricionista, **quero** escrever um parecer sobre os exames lançados, **para** entregar ao paciente minha leitura nutricional assinada.

| Campo | Obrig. | Validação | Erro |
|---|---|---|---|
| Exames considerados | Sim | 1 a 20 exames do próprio paciente (lista com data e título) | "Selecione ao menos um exame." / "Selecione no máximo 20 exames." |
| "Avaliação nutricional" | Sim | 1–5000 caracteres | "Escreva a avaliação nutricional (até 5000 caracteres)." |
| "Conduta e orientações" | Não | até 5000 | "Use no máximo 5000 caracteres." |
| "Encaminhamentos" | Não | até 1000 | "Use no máximo 1000 caracteres." |

```gherkin
Cenário: Criar rascunho
  Dado um paciente ativo com o exame "Hemograma" de 01/09/2026 com valores lançados
  Quando abro Paciente > Documentos > "Novo parecer nutricional"
  E seleciono "Hemograma — 01/09/2026" e escrevo a avaliação
  Então vejo "Rascunho salvo."
  E o documento aparece na lista com a situação "Rascunho"

Cenário: Exame sem valores lançados
  Dado um exame só com o laudo anexado
  Quando o seleciono
  Então o parecer mostra a linha "Hemograma — 01/09/2026 (laudo no prontuário, sem valores lançados)"

Cenário: Valores atualizados no rascunho
  # v0.5: exame não tem edição (US-015); "mudar" = linhas acrescentadas pela IA conferida (Plano 11), data trocada
  # pela IA ou exame excluído e lançado de novo
  Dado um parecer em "Rascunho" com o exame "Hemograma — 01/09/2026" sem "Ferritina"
  Quando confiro a leitura com IA desse exame e aplico "Ferritina = 12 ng/mL" e salvo o rascunho do parecer
  Então o parecer passa a mostrar "Ferritina = 12 ng/mL" (a cópia é refeita a cada salvamento do rascunho)

Cenário: Valores congelados antes da assinatura
  Dado um parecer em "Aguardando assinatura" com o exame "Hemograma — 01/09/2026"
  Quando acrescento linhas a esse exame pela leitura com IA (ou a data do exame muda)
  Então o parecer continua com a cópia feita ao preparar
  E na tela do parecer aparece "Os valores deste exame mudaram depois do parecer." com o botão "Voltar a editar"

Cenário: Valores congelados depois da assinatura
  Dado um parecer "Assinado" com o exame "Hemograma — 01/09/2026"
  Quando acrescento linhas a esse exame pela leitura com IA (ou a data do exame muda)
  Então o parecer continua com a cópia assinada
  E na tela do parecer aparece "Os valores deste exame mudaram depois do parecer." com o link "Retificar"

Cenário: Exame excluído depois do parecer (v0.5, proposto)
  Dado um parecer em "Aguardando assinatura" ou "Assinado" que cita o exame "Hemograma — 01/09/2026"
  Quando excluo esse exame na aba Exames
  Então o parecer continua com a cópia (o PDF não muda)
  E na tela do parecer aparece "O exame Hemograma — 01/09/2026 foi excluído depois do parecer." (proposto)
  E, num rascunho, salvar ou preparar com o exame excluído na seleção mostra "Um dos exames selecionados foi excluído. Revise a seleção." (proposto)

Cenário: Paciente bloqueado
  Dado um paciente com pedido de exclusão atendido
  Quando tento criar um parecer
  Então vejo "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."
```

**v0.5 — como o parecer se apoia no que já existe (conferido no código em `3b59c38`):**

- **Lugar:** a mesma aba "Documentos" do prontuário (`/painel/pacientes/[id]/documentos`, só com o interruptor `documentos_liberados` ligado, D20 do 10A), com o botão "Novo parecer nutricional" ao lado de "Nova receita"; o editor e a situação na mesma página `/painel/pacientes/[id]/documentos/[docId]` (sem página nova em `ROTAS_DO_PAINEL`; o guia `documentos` sobe de versão). Lista: "Parecer nutricional de dd/mm/aaaa" (como "Receita de dd/mm/aaaa").
- **Seleção dos exames:** pela lista do prontuário (`listarExames`, que já grava `auditRead` entidade `exames` — regra 8; sem exceção nova na regra 8). Só exames do **próprio paciente** (filtro por `patient_id` dentro do `withTenant`, regra 1).
- **Cópia:** a cada salvamento do rascunho e, por último, ao preparar (RN-148, RN-154), o `conteudo` recebe, por exame, `id`, `data`, `titulo` e as linhas de `valores` como estavam (`nome`, `valor`, `unidade`, `referencia`; a origem `iaTarefaId` — ver Q13-2), mais a indicação "laudo no prontuário, sem valores lançados" quando `valores` está vazio (exame só com laudo, inclusive o que veio de um envio do paciente, Plano 12). Nada do laudo (arquivo) entra no parecer.
- **Assinatura (D2 = (a)):** "Preparar para assinatura" → PDF no worker → digitalizada com 2FA (RN-157, RN-145), exatamente como a receita no 10A; gov.br/ICP no 10B. `exigirHabilitacaoAtual` (Fitoterapia) é só da receita.
- **Declaração e ressalva:** as da D5 (rascunho até a revisão da Debby e a consulta ao CRN-3).
- **PDF proposto:** o nome e o logo do consultório no topo; "Parecer nutricional"; "Paciente: {nome}"; "Data de emissão: dd/mm/aaaa"; "Exames considerados" (por exame, "{título} — dd/mm/aaaa" e a tabela nome · valor · unidade · referência, ou "(laudo no prontuário, sem valores lançados)"); "Avaliação nutricional"; "Conduta e orientações" (se houver); "Encaminhamentos" (se houver); a ressalva fixa da D5; o carimbo, o quadro "Assinatura digital" e o rodapé com o código e o QR em cada página, como a receita (US-143 v0.4). Na retificação, "Versão {n} — substitui o documento {código da versão anterior}" abaixo do título (proposto). — Redigir receita de suplementos e fitoterápicos · **M** · Plano 10A

**Como** nutricionista, **quero** montar a receita com os campos que o CFN exige, **para** entregá-la ao paciente com segurança.

Lugar: Paciente > aba "Documentos" (antes de "Histórico de acessos") > "Nova receita". Cada receita tem **1 a 20 itens**. O tipo do item define os campos (RN-149, RN-150):

| Tipo do item (rótulo exato) | Campos obrigatórios | Opcionais |
|---|---|---|
| "Suplemento alimentar" | Categoria ("Nutriente", "Enzima", "Probiótico", "Outro"); composição (1–10 componentes: nome 1–120, quantidade > 0, unidade ∈ g, mg, mcg, UI, U, UFC, mL); forma de apresentação (até 60); via ∈ "Oral", "Sublingual", "Enteral (sonda)"; posologia (1–300) | Duração (até 100); "Manipulado" (sim/não) |
| "Planta medicinal ou droga vegetal (chá)" | Nomenclatura botânica (2–120); parte utilizada (1–60); modo de preparo ∈ "Infusão", "Decocção", "Maceração em água"; forma de utilização e preparo (1–300); posologia (1–300) | Nome popular (até 60); duração |
| "Droga ou derivado vegetal classificado como alimento ou suplemento" — **todas** (Res. 680, art. 3º, § 2º; D13 = (a)) | Nomenclatura botânica (2–120); parte utilizada (1–60); forma farmacêutica (1–60); dose (1–120); via ∈ "Oral", "Sublingual", "Enteral (sonda)"; posologia (1–300) | Padronização do marcador (até 120); forma ou meio de extração (até 120); nome popular; duração |
| "Fitoterápico (forma farmacêutica ou fórmula magistral)" — **só com habilitação** | Nomenclatura botânica; parte utilizada; forma ou meio de extração (1–120); forma farmacêutica (1–60); dose (1–120); via; posologia | Padronização do marcador (até 120); nome popular; duração |

Campos da receita: "Orientações gerais" (opcional, até 2000, vai no PDF) e **"Justificativa de uso"** (obrigatória para preparar, até 2000; **fica só no prontuário**, não vai no PDF — Res. 656, art. 3º, XII; guardada em `signed_document_notes`, fora do alcance da sessão de paciente, D15). A justificativa segue a mesma trava do conteúdo: não muda a partir de `preparando` (RN-140).

```gherkin
Cenário: Receita de suplemento
  Quando adiciono "Suplemento alimentar", categoria "Nutriente", "Vitamina D3" 2000 UI, "Cápsula", via "Oral", posologia "1 cápsula ao dia, no almoço"
  E escrevo a justificativa de uso
  Então vejo "Rascunho salvo."

Cenário: Enzima e probiótico com a unidade certa
  Quando informo um "Probiótico" com quantidade em "mg"
  Então vejo "Probióticos são prescritos em UFC (Resolução CFN nº 656/2020, art. 3º, IX)."
  E, para "Enzima" fora de "U": "Enzimas são prescritas em Unidades (U) (Resolução CFN nº 656/2020, art. 3º, IX)."

Cenário: Fitoterápico formulado sem habilitação
  Dado que meu perfil não tem habilitação em Fitoterapia
  Então a opção "Fitoterápico (forma farmacêutica ou fórmula magistral)" aparece desabilitada com a dica "Exige habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021). Para produto vegetal classificado como alimento ou suplemento, use \"Droga ou derivado vegetal classificado como alimento ou suplemento\". Registre a habilitação no seu perfil."
  E o servidor recusa um item desse tipo com a mesma mensagem
  E a opção "Droga ou derivado vegetal classificado como alimento ou suplemento" continua habilitada

Cenário: Derivado vegetal como suplemento, sem habilitação
  Dado que meu perfil não tem habilitação em Fitoterapia
  Quando adiciono "Droga ou derivado vegetal classificado como alimento ou suplemento" com nomenclatura botânica "Curcuma longa L.", parte utilizada "Rizoma", forma farmacêutica "Cápsula", dose "500 mg", via "Oral" e posologia "1 cápsula ao dia"
  Então vejo "Rascunho salvo."
  E a declaração ao preparar inclui que o item é classificável como alimento ou suplemento (texto na D5)

Cenário: Planta medicinal só como chá
  Quando escolho "Planta medicinal ou droga vegetal (chá)"
  Então o modo de preparo só oferece "Infusão", "Decocção" e "Maceração em água"

Cenário: Sem justificativa
  Quando tento preparar sem justificativa de uso
  Então vejo "Escreva a justificativa de uso (fica no prontuário, não vai na receita)."

Cenário: Paciente arquivado
  Dado um paciente arquivado
  Então posso redigir, preparar e assinar a receita (o prontuário continua editável, como no MVP)
  E a entrega é só "Entregue pessoalmente" (RN-153)

Cenário: Paciente bloqueado
  Dado um paciente com pedido de exclusão atendido
  Quando tento criar uma receita
  Então vejo "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."
```

**v0.4 (como ficou no 10A):** a aba "Documentos" fica entre "Plano alimentar" e "Histórico de acessos" (11 abas) e só existe com o interruptor do admin ligado; a lista tem as colunas "Documento" ("Receita de dd/mm/aaaa", link para o documento), "Data" (a da assinatura ou, antes dela, a da criação) e "Situação" (o selo e a linha da situação; no assinado, a da entrega da US-145, e "Assinatura: Digitalizado"); vazia, "Nenhum documento ainda.". O editor e o preparo são **um formulário só** ("Preparar para assinatura" grava o que está na tela e prepara; os erros dos dois botões voltam aos campos). Mensagens de campo que a spec não tinha (textos novos, rascunho para a Debby): "Inclua ao menos um item na receita.", "A receita pode ter até 20 itens.", "Informe de 1 a 10 componentes.", "Informe uma quantidade maior que zero.", "Use vírgula para decimais (até 3 casas) e ponto só para milhar (ex.: 2000, 2.000 ou 0,5)." (ponto só de milhar: "50.000" nunca vira 50), "Use uma quantidade de até 10.000.000.000.000." (teto só contra valor absurdo: probiótico em UFC passa de 10^10), "Escolha uma das opções.", "Use no máximo {n} caracteres."; com a categoria "Outro", a dica "Extrato ou produto vegetal não entra em "Outro": use "Droga ou derivado vegetal classificado como alimento ou suplemento" ou, com a habilitação, "Fitoterápico (forma farmacêutica ou fórmula magistral)"." (Minor 11 da revisão de normas). A opção "Fitoterápico (forma farmacêutica ou fórmula magistral)" aparece **desabilitada** no seletor "Tipo do item", com a dica da US-142 abaixo dele.

### US-143 — Preparar para assinatura · **M** · Plano 10A

**Como** nutricionista, **quero** gerar o PDF final com a minha marca, **para** assiná-lo.

```gherkin
Cenário: Preparar
  Dado um rascunho válido e o perfil profissional completo
  Quando clico em "Preparar para assinatura"
  Então vejo a declaração do tipo do documento (texto na D5) com a caixa obrigatória
  E, sem marcar a caixa: "Confirme a declaração para continuar."
  Quando marco e confirmo
  Então a situação vira "Preparando o PDF" e depois "Aguardando assinatura"
  E vejo "Baixar PDF para assinar" e a instrução "Assine o PDF no assinador do gov.br (assinador.iti.br) ou com o seu certificado ICP-Brasil e envie o arquivo assinado aqui. Sem gov.br nem certificado, imprima, assine à mão e envie fotos das páginas."
  E a dica "Se o assinador pedir o lugar da assinatura visível, use o quadro \"Assinatura digital\" no fim da página." (proposto)

Cenário: Conteúdo do PDF
  Então o PDF tem logo e cor do consultório, o título do documento, nome do paciente, data de emissão, o conteúdo, o carimbo "{nome completo} · Nutricionista · {CRN} · {e-mail} · {telefone}" (+ endereço, se houver)
  E o quadro em branco "Assinatura digital" no rodapé de cada página (área reservada da RN-144)
  E o rodapé "Código de verificação: XXXX-XXXX-XXXX · Verifique em {APP_URL}/v/XXXXXXXXXXXX" com o QR code do mesmo endereço ({APP_URL} montado por urlDoApp)
  E a receita não traz a justificativa de uso

Cenário: Voltar a editar
  Dado um documento em "Aguardando assinatura"
  Quando clico em "Voltar a editar" e confirmo "O PDF preparado será descartado. Continuar?"
  Então o documento volta a "Rascunho" e o código anterior deixa de existir

Cenário: Falha do PDF
  Dado que o worker não conseguiu gerar o PDF
  Então vejo "Não foi possível gerar o PDF. Tente de novo." e o botão "Gerar o PDF de novo"
```

**v0.4 (como ficou no 10A):** a declaração fica num quadro "Declaração" dentro do formulário do editor, com o botão "Preparar para assinatura". Enquanto o worker trabalha, a tela mostra "Preparando o PDF…" e pergunta o estado a cada 3 s. Cota esgotada no preparo: `pdf_status = 'sem_cota'` e a mensagem da RNF-143 ("Espaço de armazenamento esgotado. Fale com o suporte."), com "Gerar o PDF de novo". No 10A, o cartão "Aguardando assinatura" diz **"Baixe o PDF, imprima, assine à mão e envie fotos das páginas aqui."** e o botão "Baixar PDF para assinar"; a instrução do gov.br/ICP e a dica do quadro (acima) entram no Plano 10B. O PDF preparado tem: o nome de exibição e o logo do consultório no topo; "Receita"; "Paciente: {nome}"; "Data de emissão: dd/mm/aaaa" (dia da declaração, no fuso do consultório); os itens numerados; "Orientações gerais: …" (se houver); o carimbo "{nome completo} · Nutricionista · {CRN} · {e-mail} · {telefone}" e, abaixo, o endereço; o quadro tracejado "Assinatura digital" (208 × 70 pt, à direita, `AREA_ASSINATURA`) e o rodapé com o QR e "Código de verificação: XXXX-XXXX-XXXX · Verifique em {APP_URL}/v/XXXXXXXXXXXX" em **cada** página. O `APP_URL` fica impresso no QR de toda receita: trocar o domínio depois exige redirecionar `/v/*`.

### US-144 — Enviar o PDF assinado · **M** · Plano 10A (digitalizada) e Plano 10B (gov.br e ICP-Brasil)

**Como** nutricionista, **quero** enviar o PDF que assinei no gov.br ou com meu certificado, **para** concluir o documento.

```gherkin
Cenário: Assinatura aceita
  Dado um documento em "Aguardando assinatura"
  Quando envio o PDF baixado e assinado no gov.br
  Então vejo "Documento assinado."
  E a situação vira "Assinado" com "Assinado em dd/mm/aaaa às hh:mm" (hora do servidor no aceite) e o tipo "gov.br" (ou "Certificado ICP-Brasil")
  E o PDF preparado (sem assinatura) é apagado

Cenário: Primeiro certificado usado
  Dado que é a primeira assinatura do consultório
  E o nome do titular do certificado confere com o meu nome completo do perfil (sem acento e sem diferença de maiúsculas)
  Quando envio o PDF assinado
  Então vejo "Assinado por {NOME DO CERTIFICADO} (CPF ***.456.789-**). Este é o seu certificado?" com "Sim, sou eu" e "Não"
  E "Sim, sou eu" pede o código da verificação em duas etapas e o mesmo arquivo de novo (nada é guardado antes do código certo)
  E só depois do código certo o documento vira "Assinado" e a nutricionista recebe o e-mail "Certificado do consultório confirmado" (proposto)

Cenário: Código do 2FA errado
  Quando digito um código errado
  Então vejo "Código inválido. Confira o horário do celular e tente de novo."
  E depois de 5 erros em 15 minutos: "Muitas tentativas. Tente de novo em 15 minutos." (cada erro fica no Histórico de acessos do paciente do documento, como "Tentativa de assinatura com código recusado")

Cenário: Troca do certificado do consultório (RN-145)
  Dado que o consultório já tem um CPF confirmado
  E envio um PDF assinado por um certificado com o meu nome completo do perfil e outro CPF (certificado novo, ou o CPF lido errado no primeiro envio)
  Então vejo "Assinado por {NOME DO CERTIFICADO} (CPF ***.444.777-**). Este é o seu certificado?" e "O CPF confirmado no consultório era ***.456.789-**. Ao confirmar, este passa a ser o certificado do consultório." (proposto)
  E "Sim, sou eu" pede o código da verificação em duas etapas e o mesmo arquivo de novo
  E só depois do código certo o CPF do consultório é trocado, a troca fica na auditoria ("Perfil profissional") e a nutricionista recebe o e-mail "Certificado do consultório confirmado" com o CPF anterior e o novo (proposto)
  E com um nome diferente do perfil, a recusa é "O PDF foi assinado por outra pessoa. Use a sua conta gov.br ou o seu certificado."

Cenário: Primeiro certificado de outra pessoa
  Dado que é a primeira assinatura do consultório
  Quando envio um PDF assinado por um certificado cujo titular não tem o meu nome completo do perfil
  Então vejo "O certificado deste PDF está em nome de {NOME DO CERTIFICADO}, diferente do nome do seu perfil profissional. Assine com o seu gov.br ou o seu certificado."
  E o documento continua em "Aguardando assinatura" e nenhum CPF é gravado

Cenário: Sem verificação em duas etapas
  Dado que minha conta não tem a verificação em duas etapas ativa
  Quando abro um documento em "Aguardando assinatura"
  Então vejo "Ative a verificação em duas etapas em Segurança para assinar documentos." com o link "Ativar agora" (para /conta/seguranca)

Cenário: Recusas
  Quando envio um arquivo que não é PDF ou maior que 10 MB → "Envie o PDF assinado (até 10 MB)."
  Quando envio um PDF sem assinatura digital (inclusive o próprio PDF preparado, baixado e reenviado sem assinar, com ou sem bytes soltos no fim) → "Não encontramos assinatura digital neste PDF. Assine pelo gov.br ou com certificado ICP-Brasil e envie de novo."
  Quando envio um PDF cujo início não é byte a byte o PDF preparado → "Este PDF não é o documento preparado. Baixe o PDF de novo, assine e envie."
  Quando envio um PDF com acréscimos depois da preparação que não são só a assinatura (anotação, texto, página nova, script, anexo, objeto redefinido) → "Este PDF recebeu alterações além da assinatura. Baixe o PDF de novo, assine sem editar e envie."
  Quando a assinatura visível ficou fora do quadro "Assinatura digital" → "A assinatura visível ficou fora do quadro \"Assinatura digital\". Assine de novo com a assinatura dentro do quadro."
  Quando a assinatura não confere com o conteúdo → "A assinatura deste PDF não confere. Assine de novo e envie."
  Quando o certificado está vencido na hora do envio → "O certificado usado está vencido. Renove o certificado ou use o gov.br e assine de novo."
  Quando o certificado é de empresa (e-CNPJ) ou não é de pessoa → "O certificado deste PDF é de empresa (e-CNPJ). Assine com o seu gov.br ou o seu e-CPF."
  Quando o CPF do certificado é diferente do confirmado no consultório e o nome do titular é outro → "O PDF foi assinado por outra pessoa. Use a sua conta gov.br ou o seu certificado." (mesmo nome → troca, cenário acima)
  Quando a cadeia do certificado não chega ao gov.br nem à ICP-Brasil (ou usa algoritmo que o sistema não lê) → "Tipo de assinatura não aceito. Use o gov.br ou um certificado ICP-Brasil."
  E em todas as recusas o documento continua em "Aguardando assinatura" e nada é gravado

Cenário: Digitalizada (D1, opção E)
  Quando escolho "Enviar documento digitalizado (assinado à mão)"
  Então vejo o aviso "O sistema não confere o conteúdo de documentos digitalizados. Envie fotos das páginas do PDF preparado, assinadas e sem alterações."
  E o envio pede as páginas como imagens JPEG ou PNG (1 a 5, até 10 MB no total) e o código da verificação em duas etapas
  Quando envio
  Então vejo "Montando o PDF digitalizado…" e depois "Documento assinado." com o tipo "Digitalizado"
  E o PDF entregue é montado pelo sistema com as imagens e o rodapé do código e do QR (o arquivo enviado nunca é entregue como veio)
  E o portal, a lista de documentos da nutricionista e a verificação pública mostram "Assinatura: Digitalizado" (RN-157)
  E as fotos entram no PDF normalizadas (orientação aplicada, sem EXIF nem GPS do celular); foto acima de 40 megapixels é recusada com "Envie de 1 a 5 fotos, até 10 MB no total." (RN-157)
```

**v0.4 (a digitalizada como ficou no 10A):** o botão "Enviar documento digitalizado (assinado à mão)" abre o formulário com o aviso da RN-157, o campo "Fotos das páginas (JPEG ou PNG, até 5)" (dica "Envie de 1 a 5 fotos, até 10 MB no total."), "Código da verificação em duas etapas" e "Enviar" ("Enviando…"). Sem o 2FA ativo, o cartão mostra "Ative a verificação em duas etapas em Segurança para assinar documentos." com o link "Ativar agora" e **não** mostra o formulário. Recusas do envio (`POST /api/painel/documentos/[id]/digitalizada`): arquivo que não é JPEG/PNG pelo conteúdo (inclusive um PDF) → "Envie fotos das páginas (JPEG ou PNG)."; 0 ou mais de 5 fotos, mais de 10 MB ou foto acima de 40 MP → "Envie de 1 a 5 fotos, até 10 MB no total."; código errado → "Código inválido. Confira o horário do celular e tente de novo." (a recusa vai ao Histórico de acessos do paciente como "Tentativa de assinatura com código recusado"); depois de 5 erros em 15 min → "Muitas tentativas. Tente de novo em 15 minutos."; fitoterápico formulado com a habilitação retirada depois do preparo → "A receita tem fitoterápico formulado e a habilitação em Fitoterapia não está mais no seu perfil. Registre a habilitação de novo ou volte a editar a receita." (texto novo); outro envio da mesma usuária ou mais de 2 no processo → "Outro envio está em andamento. Tente de novo em instantes." (429); corpo lento → "O envio demorou demais. Tente de novo." (408); cota → a mensagem da RNF-143 (507); documento que mudou de situação (outra aba) → "Este documento mudou de situação. Recarregue a página." (409). Aceito, a tela mostra "Montando o PDF digitalizado…"; se o worker falhar, ou se o envio ficar mais de 1 h sem terminar, "Não foi possível montar o PDF. Envie as fotos de novo." e o formulário de volta. O PDF montado leva, em cada página, a foto e o rodapé "Documento digitalizado · Código de verificação: XXXX-XXXX-XXXX · Verifique em {APP_URL}/v/…" com o QR. O tenant suspenso entre o envio e o job não é assinado (o envio vira "falhou"). Assinado, o cartão "Documento assinado" mostra "Assinado em" (dd/mm/aaaa às hh:mm), "Assinatura" (Digitalizado) e "Baixar PDF assinado"; a lista mostra "Assinatura: Digitalizado".

### US-145 — Entrega ao paciente e confirmação de recebimento · **M** · Plano 10A

**Como** nutricionista, **quero** que o paciente receba o documento e confirme o recebimento, **para** cumprir o CFN.

```gherkin
Cenário: Entrega automática
  Dado um paciente ativo com acesso ao portal
  Quando o documento é assinado
  Então o documento aparece no portal do paciente
  E o paciente recebe o e-mail com o assunto "Você tem um novo documento" e o corpo "Olá, {primeiro nome}. {nome de exibição do consultório} disponibilizou um novo documento para você. Para ver, entre no app: {link}" (link = urlDoApp(APP_URL, telaDoPortal('/p/documentos', tenantId)))
  E, se houver inscrição de push, a notificação "Você tem um novo documento."
  E nenhum dos dois diz o tipo do documento, exames, itens ou nomes de produtos

Cenário: Confirmação de recebimento (D4)
  Quando o paciente abre o documento (no portal ou na página do link) e clica em "Confirmo que recebi este documento"
  Então a nutricionista vê "Recebido pelo paciente em dd/mm/aaaa às hh:mm"
  E, se ele abriu sem confirmar, "Aberto em dd/mm/aaaa · recebimento não confirmado"
  E, se ainda não abriu, "Enviado em dd/mm/aaaa · ainda não aberto"

Cenário: Paciente sem acesso ao portal (D3 b + a)
  Dado um paciente ativo com e-mail cadastrado que não aceitou o convite
  Quando o documento é assinado
  Então vejo "Este paciente ainda não tem acesso ao app. Enviamos um link por e-mail para ele abrir o documento com um código. Se a entrega for no consultório, marque \"Entregue pessoalmente\"." (proposto)
  E o paciente recebe o e-mail neutro "Você tem um novo documento" com um link de uso único (sem anexo e sem dado de saúde)
  E, ao abrir o link, ele pede um código de 6 dígitos, recebe-o no e-mail, digita e vê o documento
  E a confirmação de recebimento segue a D4 nessa página
  E posso usar "Reenviar link por e-mail" (o link vale 30 dias)

Cenário: Entregue pessoalmente (D3 a)
  Quando marco "Entregue pessoalmente" e confirmo
  Então a situação mostra "Entregue pessoalmente em dd/mm/aaaa" e conta como recebimento registrado pela nutricionista

Cenário: Arquivado ou sem e-mail
  Dado um paciente arquivado (RN-08)
  Quando o documento é assinado
  Então não sai e-mail, push nem link
  E vejo "Paciente arquivado: entregue o documento pessoalmente e marque \"Entregue pessoalmente\"." (proposto)
```

**v0.4 (como ficou no 10A):** a entrega fica na seção "Entrega" do cartão "Documento assinado", com a linha da situação ("Recebido pelo paciente em dd/mm/aaaa às hh:mm", "Entregue pessoalmente em dd/mm/aaaa", "Aberto em dd/mm/aaaa · recebimento não confirmado" ou "Enviado em dd/mm/aaaa · ainda não aberto"); sem entrega (arquivado), a linha fica vazia — `entregue_em` só é gravado quando o e-mail saiu de fato. "Entregue pessoalmente" pede "Marcar como entregue pessoalmente?" e some depois de qualquer recebimento confirmado; "Reenviar link por e-mail" só aparece para paciente ativo sem conta e com e-mail, pede "Reenviar o link do documento para o e-mail do paciente?" e mostra "Link reenviado.". Os avisos do paciente sem portal e do arquivado usam os textos propostos acima. E-mail do paciente **com** conta: o texto da US-145 com o botão "Ver meus documentos". E-mail do paciente **sem** conta (assunto "Você tem um novo documento"): "Olá, {primeiro nome}. {consultório} disponibilizou um novo documento para você." e "Para abrir, use o link abaixo. Vamos enviar um código de 6 dígitos para este e-mail. O link vale por 30 dias.", com o botão "Abrir documento" (texto novo). O e-mail do código tem o assunto "Código para abrir seu documento: {código}" e o corpo "Use o código {código} para abrir o documento enviado por {consultório}." e "Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail." (texto novo). Com o interruptor do admin desligado no momento da assinatura (D20), nada sai e `entregue_em` fica nulo.

### US-146 — Paciente vê os documentos no portal · **M** · Plano 10A

Lugar: cartão "Documentos" no Início e link "Meus documentos" em Perfil; `/p/documentos` marca a aba "Perfil" (`tambem`). A barra de 7 abas não muda (R16).

```gherkin
Cenário: Lista
  Quando abro "Documentos" no app
  Então vejo cada documento com título ("Receita"; "Parecer nutricional" a partir do Plano 13), data e situação, do mais novo para o mais antigo
  E "Abrir PDF" chama /api/p/documentos/{id}/pdf, que registra a abertura (uma vez) e baixa o arquivo por URL assinada de 5 min

Cenário: Confirmar recebimento (D4)
  Dado um documento assinado que ainda não confirmei
  Quando clico em "Confirmo que recebi este documento"
  Então vejo "Recebimento confirmado em dd/mm/aaaa."
  E o botão não aparece de novo (nem em documento cancelado)

Cenário: Situações
  Então um documento substituído (Plano 13) mostra "Substituído por uma versão mais nova."
  E um cancelado mostra "Cancelado pela nutricionista. Não use este documento."
  E rascunhos e documentos em preparo nunca aparecem (nem no JSON da API)

Cenário: Sem documentos
  Então vejo "Você ainda não tem documentos."

Cenário: Sem cópia offline
  Então os documentos não ficam na cópia offline do app (o service worker só guarda /p/plano)
```

**v0.4 (como ficou no 10A):** o cartão do Início se chama "Documentos", diz "1 documento novo" / "{n} documentos novos" (assinados ainda não abertos) e tem o link "Ver documentos"; o link de Perfil é "Meus documentos". A página `/p/documentos` (título "Documentos") mostra, por documento, "Receita · dd/mm/aaaa", "Assinatura: Digitalizado", os avisos de substituído e de cancelado, o link "Abrir PDF" e, no assinado, o botão "Confirmo que recebi este documento" ou "Recebimento confirmado em dd/mm/aaaa." — este também quando o recebimento foi registrado pela nutricionista ("Entregue pessoalmente"; Minor no backlog, P10A-19). O assinado não tem linha de situação própria (Minor, P10A-19). Com o interruptor do admin desligado (D20), o cartão e o link somem e `/p/documentos` responde 404; paciente bloqueado ou anonimizado não vê documento algum (RN-153).

**v0.5 (Plano 13, o que muda no portal):** `documentosDoPaciente` (`src/modules/documentos/portal.ts`) devolve hoje `titulo: 'Receita'` fixo; passa a devolver o título pelo `tipo` ("Receita" ou "Parecer nutricional"), e a linha fica "Parecer nutricional · dd/mm/aaaa". A lista continua **sem** `auditRead` e só com as chaves de `DocumentoNoPortal` (D17 do 10A; teste das chaves em `portal.test.ts`) — nunca exames, valores, avaliação ou conduta; ganha no máximo a versão ("Versão 2", proposto) para o paciente distinguir a retificada da substituída. O substituído continua com "Substituído por uma versão mais nova.", sem botão de recebimento e com "Abrir PDF" (o PDF antigo continua sendo prova do que foi entregue); "Abrir PDF" do parecer é auditado como o da receita (`caminhoDoPdfNoPortal`). A página do link de uso único (`link-documento.ts`, também com `titulo: 'Receita'` fixo) segue a mesma regra; o link da versão substituída responde "Este documento não está mais disponível. Fale com sua nutricionista." (RN-158). O cartão do Início ("{n} documentos novos") conta o parecer como a receita.

### US-147 — Verificação pública por código ou QR · **M** · Plano 10A (o link do validador do ITI no 10B)

**Como** paciente ou farmácia, **quero** conferir se um documento é autêntico, **sem** ver dados de saúde.

```gherkin
Cenário: Documento válido
  Quando abro {APP_URL}/v/ABCDEFGHJKMN (ou digito "ABCD-EFGH-JKMN" em {APP_URL}/v)
  Então vejo "Documento válido"
  E "Tipo: Receita" (ou "Tipo: Parecer nutricional"), "Emitido por: {nome completo} — {CRN}", "Assinado por: {nome do titular do certificado}" (só em gov.br e ICP-Brasil), "Assinado em: dd/mm/aaaa às hh:mm (horário de Brasília)", "Assinatura: gov.br" (ou "Certificado ICP-Brasil" ou "Digitalizado"), "Código: ABCD-EFGH-JKMN"
  E "Impressão digital do arquivo (SHA-256): {64 caracteres}"
  E nunca o nome do paciente, exames, itens ou texto do documento

Cenário: Validador oficial
  Então vejo o link "Validar a assinatura no validador oficial do ITI" para https://validar.iti.gov.br (exceto em "Digitalizado")

Cenário: Cancelado, eliminado (Plano 10A) e substituído (Plano 13)
  Então vejo "Documento cancelado — Este documento foi cancelado por quem o emitiu em dd/mm/aaaa e não deve ser usado."
  Ou "Documento emitido em dd/mm/aaaa — o prazo de guarda terminou e o conteúdo foi eliminado."
  Ou "Documento substituído — Este documento foi substituído por uma versão retificada em dd/mm/aaaa. Peça a versão atual a quem o emitiu."

Cenário: Código inexistente ou mal digitado
  Então vejo "Código não encontrado. Confira os 12 caracteres."

Cenário: Abuso
  Dado 30 consultas do mesmo IP na mesma hora
  Quando faço a 31ª consulta nessa hora
  Então vejo "Muitas tentativas. Tente de novo em alguns minutos."
```

**v0.4 (como ficou no 10A):** `/v` tem o título "Verificar documento", o campo "Código de verificação (12 caracteres)" e o botão "Verificar" (formulário GET, sem JavaScript; o código digitado vai para `/v/<código normalizado>`). `/v/<código>` mostra o título da situação e a lista "Tipo:", "Emitido por:", "Assinado por:" (só gov.br e ICP), "Assinado em:" ("dd/mm/aaaa às hh:mm (horário de Brasília)"), "Assinatura:", "Código:" e "Impressão digital do arquivo (SHA-256): …" em grupos de 4 caracteres (RN-143), mais o link "Verificar outro código". O link do validador do ITI é do Plano 10B. Na situação `eliminado`, a data é a da assinatura ("Documento emitido em …"); na anonimização, um documento cancelado passa a `eliminado` e deixa de dizer que foi cancelado (pergunta ao CRN-3 e ao advogado registrada no backlog, P10A-18).

**v0.5 (Plano 13):** `consultarVerificacao` (`src/modules/documentos/verificacao.ts`) devolve hoje `tipo: 'Receita'` sem ler a coluna; `document_verifications.tipo` existe (`text NOT NULL`) mas **não tem CHECK** e `registrarAssinatura` grava sempre `'receita'`. No Plano 13 a coluna recebe o `tipo` do documento, ganha CHECK (`'receita'`, `'parecer'`) e a página mostra "Tipo: Parecer nutricional". Nada mais do parecer aparece em `/v` (D8): nem exames, nem valores, nem avaliação. A situação `substituido` já existe (gatilho `verificacao_situacao`, 0092: `valido → substituido` permitido) e o texto "Documento substituído — …" já está em `MSG_VERIFICACAO`; a página da versão nova é "Documento válido" com o código **dela** (cada versão tem o próprio código, RN-142). O link do validador do ITI segue o 10B (não aparece em "Digitalizado").

### US-148 — Retificar · **M** · Plano 13

```gherkin
Cenário: Retificar um documento assinado
  Dado um documento "Assinado" (versão 1)
  Quando clico em "Retificar"
  Então abre um rascunho "Versão 2" com o conteúdo da versão 1
  E a versão 1 continua válida até a versão 2 ser assinada
  Quando a versão 2 é assinada
  Então a versão 1 vira "Substituído" (também na verificação pública) e o paciente recebe o e-mail neutro de documento novo

Cenário: Uma retificação por vez
  Dado que a versão 1 já tem uma retificação em andamento ("Rascunho", "Preparando o PDF" ou "Aguardando assinatura")
  Quando clico em "Retificar" na versão 1
  Então abro a retificação existente

Cenário: Retificação apagada
  Dado que apaguei o rascunho da versão 2
  Quando clico em "Retificar" na versão 1
  Então abre um novo rascunho "Versão 2"

Cenário: Só a versão em vigor é retificada
  Dado um documento "Substituído" ou "Cancelado"
  Então o botão "Retificar" não aparece
```

**v0.5 (Plano 13, conferido no código):**

- **Vale para os dois tipos.** A retificação é da base (B1): receita e parecer. Na receita, o rascunho da versão nova copia os itens, as orientações e a justificativa de uso (nota nova em `signed_document_notes`); a habilitação em Fitoterapia é conferida de novo ao salvar, preparar e assinar (RN-150, `exigirHabilitacaoAtual`). No parecer, copia a seleção de exames, a avaliação, a conduta e os encaminhamentos; a cópia dos valores é **refeita** pelos exames atuais no primeiro salvamento (RN-148) — é o caso de uso principal ("Os valores deste exame mudaram depois do parecer." → "Retificar"). A cópia do perfil e do nome do paciente (`copia`) não vai para o rascunho; nasce de novo ao preparar (RN-154).
- **O que já existe no banco (0089/0091):** `versao smallint NOT NULL DEFAULT 1` com CHECK `>= 1`; `retifica_id` com FK composta (`tenant_id`, `patient_id`, `retifica_id`) → `signed_documents` (mesmo tenant e paciente); o índice único parcial `signed_documents_retificacao_aberta` (`retifica_id` com status em rascunho/preparando/aguardando); `tipo`, `versao` e `retifica_id` são colunas fixas no gatilho `app_documento_imutavel`; a transição `assinado → substituido` com `substituido_em` já é aceita pelo gatilho. **O que falta (Plano 13, migration custom):** o gatilho é só `BEFORE UPDATE OR DELETE` — nada confere o **INSERT** da versão nova (mesmo `tipo` da original, original `assinado` e não anonimizado, `versao = original.versao + 1`, `retifica_id` nulo ⇔ `versao = 1`); e a ida a `substituido` não exige que exista uma retificação **assinada** dela na mesma transação. As duas regras entram no banco (ver "Plano 13 — preparação", migrations).
- **Ordem na assinatura da versão nova:** na transação do `registrar` (`registrarAssinatura`, sem dependência de sessão — o worker da digitalizada o importa), depois da ida da nova a `assinado`: original `assinado → substituido` (só se ainda `assinado`; senão a assinatura inteira volta) e `mudarSituacao(original, 'substituido')`. Trava a original **antes** da nova (ordem original → retificação → tenant), a mesma do cancelamento, para não haver deadlock com "Cancelar documento" na original.
- **Entrega:** a versão nova sai como documento novo (e-mail e push `documento_novo`, RN-152); a D11 ("avisar na substituição") fica atendida por esse e-mail — sem um segundo e-mail `documento_atualizado` (proposto, para não mandar dois avisos pelo mesmo fato).
- **Corrida "uma retificação por vez":** dois cliques simultâneos batem no índice único (23505); o segundo abre a retificação existente.
- **SBIS NGS1.12.01:** a correção de registro finalizado é por **nova versão**, pelo **próprio autor** (B-01: um tenant = uma nutricionista) e **com justificativa** — a US-148 não tem campo de motivo; ver **Q13-1**.

### US-149 — Cancelar · **M** · Plano 10A (§2.3 iii, aprovado pelo dono em 05/10/2026)

```gherkin
Cenário: Cancelar
  Dado um documento "Assinado"
  Quando clico em "Cancelar documento", escrevo o motivo (1–500 caracteres, "fica só no prontuário") e confirmo "O documento deixa de valer para o paciente e na verificação pública. Esta ação não pode ser desfeita."
  Então a situação vira "Cancelado" (portal e verificação)
  E o paciente recebe o e-mail com o assunto "Um documento seu foi atualizado" e o corpo "Olá, {primeiro nome}. {nome de exibição do consultório} atualizou um documento seu. Para ver, entre no app: {link}" (D11: e-mail neutro)
  E sem motivo: "Escreva o motivo do cancelamento (até 500 caracteres)."
  # v0.4 (10A): o campo é "Motivo do cancelamento" (dica "Fica só no prontuário."), o botão "Cancelar documento", e a
  # confirmação acima só aparece com o motivo preenchido. O cartão vira "Documento cancelado", com "Cancelado em dd/mm/aaaa",
  # "Motivo (só no prontuário): …", como foi assinado, o PDF e a entrega de antes. Com conta, também o push
  # "Um documento seu foi atualizado." (tipo documento_atualizado); sem conta, o e-mail leva um link de uso único novo, que
  # abre "Este documento não está mais disponível. Fale com sua nutricionista."; arquivado, nada sai

Cenário: Cancelar com retificação em andamento (Plano 13)
  Dado um documento "Assinado" com a "Versão 2" em andamento
  Quando clico em "Cancelar documento"
  Então vejo "Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar."
  E nada muda
```

**v0.5 (Plano 13):** `cancelarDocumento` (`src/modules/documentos/cancelamento.ts`) trava o documento (`FOR UPDATE`) e só confere `status = 'assinado'`; o comentário do código já marca o ponto ("A retificação em andamento (Plano 13) entra aqui quando existir"). No Plano 13: com a original travada, procurar a retificação em rascunho/preparando/aguardando (`retifica_id = id`) e recusar com o texto acima, que usa a `versao` dela. Uma versão retificada (v2) assinada pode ser cancelada como qualquer assinada; a v1 continua "Substituído" (não volta a valer). Cancelar a v1 já substituída não existe (só de `assinado`).

### US-150 — LGPD e histórico · **M** · Plano 13 — parte do parecer; a base vai no Plano 10A (§2.3 i, aprovado pelo dono em 05/10/2026)

```gherkin
Cenário: Auditoria
  Quando a nutricionista ou o paciente abre o conteúdo ou o PDF de um documento
  Então o "Histórico de acessos" do paciente mostra "Visualizou · Documentos assinados"
  E criar, preparar, assinar, entregar, confirmar, retificar e cancelar aparecem como "Criou"/"Alterou" (as mudanças do worker aparecem sem ator, como no plano alimentar)
  E a lista do portal (título, data, situação) não grava "Visualizou" (como a agenda)

Cenário: Exportação pela equipe (US-018)
  Então o ZIP traz os PDFs assinados em documentos/ e, em dados.json (chave documentos), todos os documentos do paciente em qualquer situação, com o conteúdo e a justificativa de uso
  E não traz o motivo de cancelamento escrito pela nutricionista (mesma decisão do MVP para a agenda, 2026-10-02)
  E nunca o PDF preparado (sem assinatura)

Cenário: Exportação do titular (US-046)
  Então o ZIP traz só os documentos emitidos (assinado, substituído, cancelado): os PDFs em documentos/ e, em dados.json, o conteúdo, a justificativa de uso (D15 = (b)) e o recebimento (data_exports.escopo = 'titular')
  E não traz rascunhos nem documentos em preparo ou aguardando assinatura (mesma regra dos planos em rascunho, P-16 b do MVP)
  E nunca o motivo de cancelamento

Cenário: Pedido de exclusão atendido
  Então os documentos ficam guardados e bloqueados (prontuário, art. 16, I, da LGPD): nenhuma escrita nova, some o acesso pelo portal e pelo link, e a verificação pública continua respondendo

Cenário: Anonimização após o prazo de guarda
  Então os PDFs são apagados, o conteúdo e as notas são limpos e a verificação passa a "Documento emitido em … — o prazo de guarda terminou e o conteúdo foi eliminado."
  E a ordem é a da RN-140 (marcar e limpar pela função de anonimização, no contexto worker, depois apagar os arquivos na mesma transação)
```

**v0.4 (como ficou no 10A):** a chave `documentos` do `dados.json` traz, por documento, `tipo` ("Receita"), `situacao` (o rótulo da tela), `criadoEm`, `assinadoEm`, `codigo` (formatado; nulo no rascunho), `sha256`, `assinatura` ("Digitalizado"), `itens` (título e linhas, como na tela), `orientacoes`, `justificativaDeUso`, `recebimento` (evento, via e data) e `pdf` (o caminho no ZIP: `documentos/<aaaa-mm-dd>-NN.pdf`, nome sem texto do usuário; nulo sem PDF ou acima do teto de memória da exportação, como os laudos). Equipe: todos os documentos; titular: só os emitidos. A anonimização (`anonimizarDocumentosDoPaciente`, `src/modules/documentos/lgpd-documentos.ts`) roda **antes** do laço de anexos de `anonimizarVencidos`: no emitido, solta antes o que sobrou do preparo (base e fotos) e chama `app_anonimizar_documentos` no `naMesmaTransacao` do `apagarArquivo` do PDF assinado (`removerAntesDoCommit`), que também apaga os códigos do link do documento; o não emitido volta a rascunho e é apagado no `naMesmaTransacao` do apagar do PDF base. A conferência final (`pdfsDeDocumentosRestantes`) recusa a anonimização se sobrar `pdf_path` ou `base_pdf_path`. O bloqueio (pedido de exclusão atendido) não apaga o que não foi emitido (o base e as fotos ficam até a anonimização; Minor no backlog, P10A-18).

**v0.5 (Plano 13 — a parte do parecer e da retificação):**

- **Auditoria:** nada novo no banco — `signed_documents`, `signed_document_notes` e `signed_document_receipts` já têm o gatilho (entidade `documentos`, regra 8). Retificar aparece como "Criou" (versão nova) e, na assinatura dela, "Alterou" (a original vira substituída); a seleção de exames do editor grava "Visualizou · Exames" pelo `listarExames`; a leitura do parecer no painel e o PDF (painel, portal, link) gravam "Visualizou · Documentos assinados" como a receita. O `audit_log` não guarda conteúdo (só ação, entidade, id, paciente, ator, IP e hora — NGS1.07.06).
- **Exportação (`documentosParaExportacao`, `src/modules/documentos/lgpd-documentos.ts`):** hoje `tipo: 'Receita'` fixo e o conteúdo lido como receita (`itens`, `orientacoes`). No Plano 13, o `tipo` pelo documento ("Parecer nutricional") e, no parecer, `exames` (a cópia: título, data e linhas), `avaliacao`, `conduta` e `encaminhamentos` no lugar de `itens`/`orientacoes`; nos dois tipos, `versao` e `retificaCodigo` (o código formatado da versão que esta substitui, ou nulo). Equipe: todos os documentos; titular: só os emitidos (v1 substituída e v2 vigente vão as duas). O motivo de cancelamento continua fora das duas; o motivo da retificação depende da **Q13-1**.
- **Bloqueio:** igual à receita (nenhuma escrita nova; portal e link somem; `/v` continua). Uma retificação em andamento de paciente bloqueado fica até a anonimização (como o rascunho de receita).
- **Anonimização:** `app_anonimizar_documentos` já limpa `conteudo` (a cópia dos valores dos exames sai junto) e as notas, e passa a verificação a `eliminado`, documento por documento (v1 e v2 cada um na sua chamada). A retificação não emitida volta a rascunho e é apagada pelo caminho (a) da RN-140; a FK `retifica_id` não impede (a original nunca é apagada). Se a coluna `exam_ids` for criada (§10, Q13-4), ela também precisa ser limpa: a função e a lista de colunas da anonimização no gatilho (`mudou <@ …`) mudam na mesma migration.

### US-151 — cortada (D7, 05/10/2026)

O rascunho do parecer com IA saiu do escopo. Se o dono quiser depois, é mudança de escopo do Subprojeto A (A-D17 reaberta, com nova análise de risco, enquadramento Anvisa e política do provedor).

---

## 7. Regras de negócio

| ID | Regra |
|---|---|
| RN-140 | **Imutabilidade.** Garantia no **banco**: gatilho `BEFORE UPDATE OR DELETE` (`app_documento_imutavel`) em `signed_documents` que só deixa passar as transições da RN-141 e, **por estado**, só estas colunas (em todos, `updated_at` pode mudar sempre; um UPDATE que não muda nada passa): **`rascunho`** — tudo, menos `id`, `tenant_id`, `patient_id`, `tipo`, `versao` e `retifica_id`; `DELETE` só aqui. **`preparando`/`aguardando_assinatura`** — `pdf_status`, `pdf_pedido_em`; `base_pdf_path`, `base_pdf_sha256`, `base_pdf_bytes` e `area_assinatura` de NULL para preenchido (pelo worker, uma vez); a volta a `rascunho` com `codigo`, `declaracao_em`, `base_pdf_path`, `base_pdf_sha256`, `base_pdf_bytes` e `area_assinatura` → NULL; a ida a `assinado` com `pdf_path`, `pdf_sha256`, `assinatura_tipo`, `assinatura_emissor`, `assinante_nome`, `assinado_em`, `assinado_por`, `entregue_em`, `digitalizacao_status` e `digitalizacao_em` (**v0.4:** `base_pdf_path` e `digitalizacao` **não** mudam nesse UPDATE — ver (b) abaixo; a 0093 exige que o `pdf_path` seja um `stored_files` do tipo `documento_assinado` do mesmo tenant e paciente). **`assinado`** — os ponteiros do preparo só **saem** (`base_pdf_path` → NULL, `digitalizacao` encolhe, nunca troca nem cresce); `entregue_em` de NULL para preenchido uma vez (reenvio do link); `status` → `substituido` com `substituido_em` (Plano 13), ou → `cancelado` com `cancelado_em`. **`substituido`/`cancelado`** — só soltar os ponteiros do preparo. **`rascunho`** (v0.4, 0091 e 0093) — nada do PDF, da assinatura, do cancelamento, da substituição nem da digitalizada (`pdf_path`, `pdf_sha256`, `assinado_em`, `assinado_por`, `assinatura_tipo`, `assinatura_emissor`, `assinante_nome`, `base_pdf_path`, `entregue_em`, `cancelado_em`, `substituido_em`, `digitalizacao*` nulos), e `rascunho → preparando` exige `declaracao_em` e `pdf_status = 'pendente'`; as fotos e a trava do envio (`digitalizacao*`) só existem em `aguardando_assinatura`. **Anonimização (qualquer estado emitido)** — `anonimizado_em` de NULL para preenchido, só com `app_current_role() = 'worker'`; `conteudo` limpo (`'{}'`) e `pdf_path` → NULL **só com `anonimizado_em` preenchido na mesma linha**. Fora disso, `conteudo`, `tipo`, `patient_id`, `codigo`, `versao`, `retifica_id`, `pdf_sha256` e `pdf_path` nunca mudam de `preparando` em diante. O recebimento não é coluna de `signed_documents`: vai para `signed_document_receipts` (§10), só INSERT. A tabela filha `signed_document_notes` tem gatilho equivalente: `justificativa_uso` fixa a partir de `preparando` do documento; `motivo_cancelamento` gravado uma vez, na transação do cancelamento; as duas só são limpas com `anonimizado_em` preenchido no documento; DELETE só com o documento em `rascunho` (a cascata do rascunho apagado). **Arquivos:** as FKs `base_pdf_path` e `pdf_path` → `stored_files.caminho` são **`NO ACTION`** (as primeiras do projeto: todas as outras para `stored_files` são `SET NULL`), então um `apagarArquivo` avulso sobre um PDF ainda referenciado é recusado pela FK (o gatilho é a segunda barreira); `anexosDoPaciente` nunca lista estes caminhos. **Ordem de operações** (regra 9 do CLAUDE.md: o registro muda no `naMesmaTransacao` de `apagarArquivo`, na mesma transação do `DELETE` de `stored_files`): (a) "Voltar a editar": `UPDATE` para `rascunho` com os campos do base NULL → `DELETE` do PDF base; (b) assinatura (**v0.4, corrigida** — desvio consciente do Plano 10A, achado do `/code-review high` do PR #18, regra 9 do CLAUDE.md: o ponteiro sai no `naMesmaTransacao` do `apagarArquivo` do próprio arquivo, nunca numa transação separada): o envio aceito chama `salvarArquivo({ tipo: 'documento_assinado', permitidos: ['pdf'], patientId, registrar })`; o `registrar` (`registrarAssinatura`, `src/modules/documentos/registrar-assinatura.ts`, sem dependência de sessão) faz a ida a `assinado` amarrada à **versão lida** (código + SHA-256 do base, no 10B; código + `digitalizacao_status = 'pendente'` + as **mesmas fotos** lidas, na digitalizada), **mantendo** `base_pdf_path` e `digitalizacao`, grava `document_verifications` e faz a entrega (e-mail e push) na mesma transação; depois, `soltarArquivosDoPreparo(ctx, id, EMITIDOS)` (`src/modules/documentos/arquivos-do-preparo.ts`) apaga cada foto e o base, um por vez, cada um com o ponteiro limpo no `naMesmaTransacao` do seu `apagarArquivo`; se algum falhar, a varredura `expirar-documento-pdf` repete (`limparArquivosOrfaosDeDocumentos`: emitido com ponteiro sobrando → o mesmo `soltarArquivosDoPreparo`; `documento_base`/`documento_digitalizado` sem referência há mais de 1 h → apagado). Toda gravação de arquivo num documento trava o documento **antes** da cota do tenant (`travarDocumentoAntesDaCota` no `antesDaReserva`; ordem documento → tenant, a mesma do soltar, sem deadlock — I2 do PR #19); (c) anonimização: a função `app_anonimizar_documentos(p_documento uuid)` (`SECURITY INVOKER` — v0.3.1: o gatilho já exige o contexto `worker`, e INVOKER não dá privilégio a mais; a v0.3 dizia DEFINER, como a `app_anonimizar_aceites` da 0065), chamada no `naMesmaTransacao` e só no contexto `worker` de um tenant com o paciente `bloqueado` e travado, marca `anonimizado_em`, limpa `conteudo` e as notas, põe `pdf_path` e `base_pdf_path` NULL, passa `document_verifications.situacao` a `eliminado` e devolve o caminho → `DELETE` desse `stored_files` (um documento por chamada); **v0.4:** a função também zera `digitalizacao*` e apaga as linhas de `document_access_codes` do documento, e o base e as fotos que sobraram saem antes, pelo `soltarArquivosDoPreparo`; documentos não emitidos do paciente voltam a `rascunho` e são apagados pelo caminho (a). Por ser tabela-mãe de FK `NO ACTION`, `stored_files` entra em `ULTIMAS` de `test/isolamento.test.ts`. **Testes obrigatórios:** apagar o PDF base de um documento assinado passa; anonimizar um documento assinado passa e a verificação fica `eliminado`; anonimizar fora do contexto `worker` é recusado; `apagarArquivo` avulso sobre o PDF assinado é recusado e nada muda; `UPDATE` direto de `conteudo` ou `pdf_path` num documento assinado sem `anonimizado_em` é recusado |
| RN-141 | **Transições:** `rascunho → preparando → aguardando_assinatura → assinado`; `preparando/aguardando_assinatura → rascunho` ("Voltar a editar", só antes de assinar); `assinado → substituido` (Plano 13: quando a retificação é assinada, na mesma transação; só se a original ainda estiver `assinado`); `assinado → cancelado` (só sem retificação em andamento, RN-147). `preparando → aguardando_assinatura` só pelo worker. Nenhuma volta depois de `assinado`. Na variante da opção A (só parecer, D2 = (b), Plano 13), `preparando → assinado` pelo worker. **v0.5:** D2 = (a) (08/10/2026) — a variante **não** entra no Plano 13; só volta se a D2 for revista para (b) com a resposta do CRN-3 |
| RN-142 | **Código de verificação:** 60 bits aleatórios em base32 Crockford (12 caracteres, sem I, L, O, U), exibido `XXXX-XXXX-XXXX`, aceito sem hífen, com espaços e em minúsculas (I/L viram 1, O vira 0); gerado ao preparar e único entre os documentos existentes (UNIQUE em `signed_documents.codigo`, PK em `document_verifications`). Em "Voltar a editar" o código é descartado sem registro; a garantia de que um código descartado (que pode ter saído impresso num PDF base baixado) não volta a ser sorteado é **probabilística** (60 bits). Um código descartado nunca aparece na verificação, que só nasce na assinatura |
| RN-143 | **Impressão digital:** SHA-256 dos bytes do PDF final (o assinado, ou o montado pelo worker na digitalizada), gravada em `signed_documents.pdf_sha256` e em `document_verifications` e mostrada na página pública em minúsculas, em grupos de 4 caracteres. A conferência do arquivo dentro da página ("Conferir arquivo") ficou para o backlog |
| RN-144 | **Conferência do PDF assinado (B/C)**, toda **sem rede** (nem LCR, nem OCSP, nem `caIssuers`; guarda de teste que troca `fetch`, `http` e `https` por funções que falham): (1) PDF pelo conteúdo, até 10 MB; (2) **prefixo:** `L = base_pdf_bytes`; o arquivo tem mais que `L` bytes e `sha256(arquivo[0..L)) = base_pdf_sha256` (o PDF base nunca é regenerado: o react-pdf não é determinístico); (3) **revisões depois do prefixo:** 1 (a da assinatura) ou 2 (mais uma de validação de longo prazo); a xref de cada uma (tabela clássica ou *xref stream*, inclusive objetos em `/ObjStm`) é lida por um **leitor próprio limitado à atualização incremental**, com `/Prev` apontando para o `startxref` anterior; (4) **forma do `/ByteRange`:** na revisão da assinatura há **exatamente um** dicionário de assinatura (com `/ByteRange` e `/Contents`), `/ByteRange [0 a b c]` com `a` = posição do `<` do `/Contents` **desse** dicionário, `b` = posição logo depois do `>`, o buraco só com dígitos hexadecimais (até 64 KB) e `b + c` = fim da revisão da assinatura (depois do `%%EOF` e do fim de linha) — fecha os ataques USF e SWA; (5) **lista fechada por alcance**: objetos **novos** só podem ser o dicionário de assinatura (`/SubFilter` ∈ `adbe.pkcs7.detached`, `ETSI.CAdES.detached`) e, se houver, `/SigRef` e `/TransformParams` (`/DocMDP` ou `/FieldMDP`); o campo/widget de assinatura (`/FT /Sig`, `/Subtype /Widget`); o `/AcroForm`, se o base não tinha; os objetos da aparência do widget e do `/Prop_Build` (`/XObject` `/Form` ou `/Image`, `/Font`, `/FontDescriptor`, *streams* sem `/Type`, `/ExtGState`); `/Metadata` e `/Info` só se o Catálogo ou o *trailer* os referenciam. Objetos **do base redefinidos** só podem ser o Catálogo (só `/AcroForm`, `/Perms`, `/Version`, `/Extensions` e `/Metadata` mudam; `/Names`, `/OpenAction`, `/AA`, `/Pages`, `/Outlines`, `/OCProperties` nunca), o `/AcroForm` que já existia (`/Fields` só com acréscimo, `/SigFlags`, `/DR` só com acréscimo), a página que recebe o widget (`/Annots` = a lista antiga + refs só aos widgets novos; `/Contents`, `/Resources`, `/MediaBox`, `/CropBox`, `/Rotate`, `/Parent`, `/Group` iguais) e o `/Info` (`/ModDate`, `/Producer`, `/Creator`) — cada um comparado **chave a chave** com o original; qualquer outro objeto do base redefinido (fonte, *stream* de conteúdo, XObject, `/Pages`) → recusa. **"Redefinido" é decidido pelo número, antes de olhar o `/Type`:** todo número que já existia é comparado como redefinido, e um *stream* do base redefinido é sempre recusa — mesmo que o dicionário novo diga `/Type /ObjStm` ou `/Type /XRef` (um leitor de PDF ignora o `/Type` de um *stream* de conteúdo e desenha o que estiver nele: *shadow attack* "replace" disfarçado). `/XRef` só é aceito como o objeto no `startxref` da própria revisão, com número novo; `/ObjStm` só com número novo e como contêiner de entradas tipo 2 da mesma revisão (os objetos de dentro são conferidos um a um). Qualquer outra anotação (`/FreeText`, `/Stamp`, `/Square`…), página nova, ação ou anexo em qualquer objeto **novo**, ou numa chave que **mudou** de um objeto redefinido (`/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/EmbeddedFiles`, `/Names`, `/XFA`, `/URI`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/RichMedia`) → recusa — nunca nas chaves que não mudaram: o Catálogo do PDF preparado (react-pdf/pdfkit) nasce **sempre** com `/Names << /Dests … >>`, e todo assinador redefine o Catálogo para pôr o `/AcroForm`; que o `/Names` não mude já é a regra do Catálogo acima; (6) **`/Rect` do widget:** área zero (assinatura invisível) **ou** dentro da **área reservada** "Assinatura digital" que o worker deixa em branco no rodapé de cada página (coordenadas gravadas no preparo em `area_assinatura`, tolerância de 2 pt), com o `/BBox` da aparência dentro do `/Rect`; (7) depois da assinatura, só **uma** revisão de validação de longo prazo: `/DSS` (certificados, OCSP, LCR, `/VRI`) e/ou carimbo do tempo (`/Type /DocTimeStamp`, `/SubFilter /ETSI.RFC3161`) com widget de área zero, Catálogo redefinido só com `/DSS` e `/Extensions` a mais, e o `/ByteRange` do carimbo — **se houver carimbo** — na mesma forma do item (4); a revisão tem de trazer pelo menos um dos dois (só `/DSS`, como o Acrobat com LTV, é aceita; vazia, recusa); o token do carimbo é aceito e não validado; (8) **CMS:** `signedData` com **um** `SignerInfo`, sem `eContent` (destacado), `contentType` = `id-data`, `messageDigest` = hash dos bytes do `/ByteRange` (SHA-256/384/512; SHA-1 recusado), em `ETSI.CAdES.detached` o `signingCertificateV2` confere com o certificado, e a assinatura sobre os `signedAttrs` confere pelo `node:crypto` (RSA ≥ 2048 PKCS#1 e PSS, ECDSA inclusive brainpool, Ed25519, Ed448 — o WebCrypto não tem brainpool, usado pelas raízes ICP v4 e v13; `pkijs`/`asn1js` só **leem** o ASN.1); (9) **cadeia:** o emissor é procurado nos certificados do CMS e nas ACs fixadas no repositório (o CMS pode trazer só o certificado de quem assinou), até uma raiz fixada, no máximo 5 níveis, com `ca = true` nas ACs; **validade** (`notBefore ≤ agora ≤ notAfter`) de todos na hora do envio; o conjunto de âncoras alcançado define `assinatura_tipo` (`govbr` ou `icp`), nunca o nome do emissor; (10) **certificado de pessoa:** uso da chave com `digitalSignature` ou `nonRepudiation`; na ICP-Brasil, SAN `otherName` 2.16.76.1.3.1 (dados da pessoa física) obrigatório e `2.16.76.1.3.3`/`2.16.76.1.3.4` (CNPJ, responsável pela PJ) recusados — ACT, SSL e assinatura de código caem aqui; no gov.br, emissor = "AC Final do Governo Federal do Brasil v1"; o CPF vem do **campo próprio** (SAN 2.16.76.1.3.1 na ICP; no gov.br, o que o spike confirmar), nunca de uma busca solta por 11 dígitos; (11) **titular e CPF** conferem (RN-145). **"Assinado em"** = hora do servidor no aceite (o `signingTime` do CMS e o `/M` são declarados por quem assina e ficam só como informação). Revogação (OCSP/LCR) **não** é conferida: a verificação pública aponta para o validador do ITI. Qualquer erro do leitor (objeto malformado, `inflate` acima do limite por *stream* ou do orçamento total da conferência, mais de 16 `/ObjStm` numa revisão, prazo estourado, aninhamento > 32, mais de 2.000 objetos na atualização) → recusa com o texto da US-144, nunca erro 500; o PDF preparado reenviado sem assinatura (idêntico, ou com bytes soltos depois sem revisão nova) recebe o texto de "sem assinatura", não o de "não é o documento preparado"; recusas com classe de erro própria e mensagem fixa, sem o CN nem o CPF do certificado em log ou Sentry. Limite de 3 s; no máximo 2 conferências simultâneas por processo. Se o spike (P-B2) mostrar que (2), (5) ou (6) não cabem no leitor limitado: **D16 = (a) (05/10/2026)** — biblioteca gratuita de parser no worker, com conferência assíncrona ("Conferindo o PDF assinado…") só para a comparação de conteúdo; (c) recusar programas raros; (b) só com aceite explícito do risco. Erro → mensagem da US-144 e nada é gravado |
| RN-145 | **Quem assina:** assinar documentos exige a verificação em duas etapas **ativa** na conta da nutricionista (`user.twoFactorEnabled`; no MVP ela é opcional para a nutricionista; aqui passa a ser condição para assinar). **Código no momento de assinar:** uma função única, `confirmarCodigo2fa` (`src/lib/confirmar-2fa.ts`), confere o código pela API do Better Auth (`auth.api.verifyTOTP` com a sessão da própria usuária, sem ler o segredo das tabelas de autenticação), com limite próprio de **5 erros em 15 minutos** por usuária (`consumirLimite`, chave por HMAC do id), **recusa do mesmo código já usado** nos últimos 90 s (anti-repetição) e auditoria da falha (sem o código); o arquivo entra na lista da regra 1 do CLAUDE.md. Ela é pedida: no **primeiro** certificado aceito do consultório, na **troca** do CPF do consultório e em **todo** envio digitalizado (E, sem certificado ligando a autoria). No primeiro certificado: (a) o nome do titular (CN do certificado, sem o sufixo `:CPF` quando houver) tem de conferir com o nome completo copiado no documento (cópia do `nome_profissional`, RN-154), comparados sem acento, sem diferença de maiúsculas e com espaços normalizados — se divergir, recusa (texto da US-144) e nada é gravado; (b) a nutricionista confirma ("Sim, sou eu") **com o código do 2FA** e o mesmo arquivo, enviados juntos (nada fica gravado antes do código certo); só então o CPF é guardado como HMAC (chave por HKDF de `ENCRYPTION_KEY`, info `nutridebby:cpf-assinante:v1`) + máscara `***.456.789-**` na tabela `tenant_signer` (STAFF_ONLY, fora de `tenants`, que vai inteira ao formulário do perfil e é lida em contextos públicos), e a nutricionista recebe um e-mail de aviso. Os seguintes têm de ter o mesmo CPF. **Troca do CPF do consultório** (certificado novo, CPF lido errado no primeiro envio, troca da `ENCRYPTION_KEY` que muda o HMAC): acontece no próprio envio — CPF diferente do confirmado **e** nome do titular igual ao nome completo copiado no documento → a mesma confirmação "Sim, sou eu", mostrando também a máscara do CPF anterior, com o código do 2FA e o mesmo arquivo; a gravação é *compare-and-set* (só troca a linha que ainda tem o CPF anterior; dois primeiros envios simultâneos → o segundo é recusado e nada é gravado), fica na auditoria ("Perfil profissional") e gera o e-mail de aviso com o CPF anterior e o novo; nome diferente → "O PDF foi assinado por outra pessoa." Nunca há troca pelo banco de produção O nome do titular é gravado em `signed_documents.assinante_nome` e `document_verifications.assinante_nome` e aparece como "Assinado por" na verificação pública. **v0.4 (10A, só a digitalizada):** a recusa do código grava no `audit_log` a entidade `tentativa_assinatura` ("Tentativa de assinatura com código recusado" no Histórico de acessos do paciente), sem o código; se o envio falhar **depois** do código aceito (409, 507, erro de gravação), a marca anti-repetição é devolvida (`liberarCodigo2fa`, I3 do PR #19) — o mesmo código certo, reenviado, não vira "Código inválido"; o `verify-totp` do Better Auth pela web é recusado com sessão aberta e 2FA já ativo (`src/lib/auth.ts`), para não ser um oráculo do código fora do limite por usuária; a chave dos contadores é `totp-erro`/`totp-usado` em `public_rate_limits` |
| RN-146 | **Retificação (Plano 13):** só de um documento `assinado` (a versão em vigor); cria `versao + 1` com `retifica_id`; no máximo **uma** retificação em andamento por documento — índice único parcial em `retifica_id` WHERE `status IN ('rascunho','preparando','aguardando_assinatura')`; a original continua `assinado` até a nova ser assinada, quando vira `substituido` na mesma transação. **v0.5:** o índice único parcial (`signed_documents_retificacao_aberta`), a FK composta de `retifica_id`, o CHECK `versao >= 1` e as colunas fixas (`tipo`, `versao`, `retifica_id`) já existem desde a 0089/0091; faltam no banco a conferência do INSERT da versão nova (mesmo `tipo`, original `assinado` e não anonimizada, `versao` = a da original + 1, `retifica_id` nulo ⇔ `versao = 1`) e a exigência, na ida a `substituido`, de uma retificação dela já `assinado` na mesma transação. Vale para receita e parecer; motivo da retificação na Q13-1 (SBIS NGS1.12.01) |
| RN-147 | **Cancelamento:** só de `assinado` e (a partir do Plano 13) só sem retificação em andamento ("Há uma retificação em andamento (versão N). Conclua ou apague a retificação antes de cancelar."); motivo obrigatório (1–500), guardado em `signed_document_notes` (visível só à equipe, D15); e-mail neutro ao paciente (D11); a verificação pública passa a "cancelado"; o botão de recebimento some do portal. **v0.5:** a recusa com retificação em andamento ainda não existe no código (`cancelarDocumento` só confere `assinado`); entra no Plano 13 com a original travada antes da busca da retificação |
| RN-148 | **Parecer (Plano 13):** título fixo "Parecer nutricional"; ressalva fixa impressa (D5); exames só do próprio paciente, com os valores **copiados de novo a cada salvamento do rascunho** e **congelados** ao preparar; aviso (não bloqueio) quando o exame muda depois de preparar ("Voltar a editar" antes da assinatura, "Retificar" depois); declaração obrigatória ao preparar (D5). **v0.5:** "o exame muda" = linhas acrescentadas pela IA conferida, data trocada pela IA ou exame excluído (exame não tem edição, US-015); a comparação é entre a cópia guardada e o exame atual (mesmo `id`: título, data e linhas), feita na leitura da tela, sem gravar nada; exame excluído aparece como tal (texto proposto na US-141). A seleção usa `listarExames` (com `auditRead`); a cópia leva só o que está em `exams` (nunca o arquivo do laudo); assinatura pela D2 = (a) |
| RN-149 | **Receita — suplementos (Res. CFN 656/2020):** vias só "Oral", "Sublingual" e "Enteral (sonda)"; enzima só em U, probiótico só em UFC; composição, via, posologia obrigatórias; justificativa de uso obrigatória para preparar e fora do PDF; declaração ao preparar (D5) |
| RN-150 | **Receita — fitoterapia (Res. CFN 680/2021, com a redação da 731/2022):** item "Planta medicinal ou droga vegetal (chá)" para todas, só com infusão, decocção ou maceração em água; item "Droga ou derivado vegetal classificado como alimento ou suplemento" para todas (art. 3º, § 2º; tipo próprio, D13), com os campos do art. 12, I; item "Fitoterápico (forma farmacêutica ou fórmula magistral)" só com habilitação registrada no perfil (conferido no servidor ao salvar **e** ao preparar); nomenclatura botânica e parte utilizada sempre obrigatórias nos três. O enquadramento do produto como alimento ou suplemento é responsabilidade da nutricionista (B-04) e entra na declaração ao preparar (D5) |
| RN-151 | **Sem marca, loja ou farmácia (decisão de produto):** a receita não tem campo de marca, fabricante, farmácia nem link, e o PDF não traz propaganda. As normas **permitem** citar marca com mais de uma opção (Res. CFN 599/2018, art. 60, III; Res. CFN 856/2026, art. 74, III); a escolha de não ter o campo é do produto, alinhada ao art. 74 da 856/2026 e ao art. 9º, III, da Res. 680/2021 — D14 (05/10/2026). A declaração ao preparar cobre o texto livre |
| RN-152 | **Entrega:** ao assinar, na mesma transação: paciente ativo **com conta** → visível no portal, e-mail neutro (assunto e corpo da US-145, nome só no corpo, link por `telaDoPortal`, `enqueueEmail` com `tx`) + push neutro pelo motor (tipo `documento_novo`); paciente ativo **sem conta e com e-mail** → e-mail neutro com o link de uso único (RN-158); arquivado → nada sai (só "Entregue pessoalmente"). **Recebimento:** botão explícito "Confirmo que recebi este documento" (D4), uma vez por documento; a abertura fica registrada à parte (evento `aberto`, uma vez); "Entregue pessoalmente" é recebimento registrado pela nutricionista. Tudo em `signed_document_receipts` (só INSERT; `via` ∈ `portal`, `link_email`, `pessoalmente`), auditado. **v0.4 (0092):** fora da sessão de paciente, o recibo só pode ser `pessoalmente` com `registrado_por` = a própria usuária (política `recibo_fora_do_paciente`); `portal`/`link_email` só pela sessão do paciente (com ou sem conta, `paciente_recibo_proprio`). O push do cancelamento é o tipo `documento_atualizado` ("Um documento seu foi atualizado."), só para quem tem conta |
| RN-153 | **Situação do paciente e do consultório:** arquivado → pode redigir, preparar e assinar (o prontuário continua editável, como em `carregarPacienteParaEscrita`); sem portal, e-mail, push nem link (RN-08): entrega só "Entregue pessoalmente"; bloqueado ou anonimizado → nenhuma escrita ("Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."), some o acesso pelo portal e pelo link; tenant suspenso → a nutricionista não entra (RN-15), então não há documento novo nem entrega; o motor não envia push (`tenant_suspenso`) e o job de e-mail descarta; a verificação pública continua respondendo (prova para terceiros). **v0.4:** o job da digitalizada confere o tenant ativo (`tenantIsActive`) antes de montar o PDF (suspenso → o envio vira "falhou", sem assinatura nem verificação), e o link de uso único responde "indisponível" com o tenant suspenso. **Interruptor do admin** (`tenants.documentos_liberados`, D20 do Plano 10A; ver §5): desligado, nada de documento aparece para a nutricionista nem para o paciente, e a verificação pública continua respondendo |
| RN-154 | **Cópia congelada:** ao preparar, o conteúdo recebe a cópia do perfil profissional, do nome do paciente (e, no parecer, dos valores dos exames); o PDF e o portal leem a cópia. **v0.5:** no código do 10A a cópia é `conteudo.copia = { profissional, paciente: { nome } }` e a declaração (`prepararParaAssinatura`); no parecer, os exames entram em `conteudo.exames` já no rascunho (refeitos a cada salvamento) e ficam fixos a partir de `preparando` pelo gatilho (o `conteudo` inteiro não muda mais) |
| RN-155 | **Cortada** (D7, 05/10/2026) |
| RN-156 | **Verificação pública:** responde só a partir de `document_verifications` (sem dado de saúde); limite de **30 consultas por IP por hora** (balde /64 no IPv6) — a 31ª é recusada — por `consumirLimite(db, chaveDoLimite('verificacao-ip', ip), 30, 3600, agora)` (tipo novo em `chaveDoLimite`; limpeza diária já existente); mesma resposta para código inexistente e malformado; `metadata.robots = { index: false }` e a regra `{ source: '/v/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }` no `next.config.ts`, depois da global; sem script inline (CSP por nonce do proxy); `caminhoSeguro` do Sentry troca `/v/<código>` por `/v/:codigo`; tenant suspenso continua respondendo. **v0.4 (0092):** a situação só avança (gatilho `verificacao_situacao`: `valido` → `substituido`/`cancelado`/`eliminado`; `substituido`/`cancelado` → `eliminado`; `eliminado` é final; a data não muda sem mudar a situação), e a linha aponta para o documento do mesmo tenant e do mesmo código (FK `document_verifications_documento_fk` → `signed_documents (tenant_id, id, codigo)`, `NO ACTION`) |
| RN-157 | **Digitalizada (opção E, D1):** o sistema **não confere** conteúdo nem assinatura. O envio é das **páginas como imagens** JPEG ou PNG (1 a 5, até 10 MB no total, tipo pelo conteúdo) com o código do 2FA (RN-145); as imagens vão para `stored_files` (tipo `documento_digitalizado`) e o worker monta um **PDF novo** (react-pdf) com as imagens e o rodapé do código e do QR — o arquivo enviado nunca é entregue como veio, então não carrega script, anexo nem ação. **As fotos também não entram como vieram:** no envio, cada uma é conferida pelo cabeçalho (até 40 megapixels, como o diário e a capa; acima disso, recusa sem decodificar — um PNG de poucos MB que declara 30.000 × 30.000 derrubaria o worker e o pg-boss repetiria o job em laço); no worker, cada página é normalizada antes do react-pdf (orientação do EXIF aplicada e **todos** os metadados descartados: EXIF, GPS — muitas vezes a casa da nutricionista —, modelo e série do aparelho; JPEG de até 3.508 px no lado maior), e uma foto ilegível falha na hora, sem nova tentativa; o SHA-256 é o desse PDF; as imagens são apagadas depois. A tela de envio avisa isso (texto da US-144); o portal, a lista da nutricionista e a verificação pública mostram "Assinatura: Digitalizado", sem "Assinado por" e sem o link do validador do ITI. **v0.4:** um envio por vez (`digitalizacao_status` `recebendo` → `pendente`, com `digitalizacao_em`; o segundo envio recebe 409); `recebendo`/`pendente` há mais de 1 h viram `falhou` na varredura; o job assina só se as fotos ainda forem as que ele leu (um envio novo depois de 1 h, com o mesmo código, não é assinado com as fotos antigas — I1 do PR #19); a habilitação em Fitoterapia é conferida de novo no envio; as fotos ficam no tipo `documento_digitalizado`, fora da política do paciente; na rota, no máximo 2 envios processando por processo e 1 por usuária, a vaga ocupada só depois de ler o corpo (60 s) |
| RN-158 | **Link de uso único (D3 b):** token `nutridebby:link-documento:v1` assinado (tenant + paciente + documento + emissão, MAC com o **e-mail atual do paciente**, como `link-consulta.ts`), válido por **30 dias** e enquanto o documento estiver `assinado` (cancelado, substituído, paciente bloqueado/anonimizado ou tenant suspenso → "Este documento não está mais disponível. Fale com sua nutricionista."). O `GET` da página **não consome nada** (leitores de link dos provedores de e-mail fazem GET): só mostra "Enviar código". Cada abertura pede um **código de 6 dígitos novo**, enviado ao e-mail, com Turnstile antes do envio, HMAC do código amarrado ao pedido (`document_access_codes`), válido por 10 min, 5 erros invalidam, 1 envio por minuto e 5 por hora por documento, e 20 pedidos por hora por IP; a **confirmação** do código também tem limite por IP (30 por hora), e o erro conta mesmo quando a resposta é de erro (o incremento das tentativas não pode ser desfeito junto com a recusa); "uso único" = cada código abre o documento uma vez, criando uma sessão de 15 min (cookie `HttpOnly`, `SameSite=Strict`, com o `path` do link; no banco, só o hash). Contexto `paciente` + `semConta` (`link-documento.ts` em `SEM_CONTA_PERMITIDOS`); auditoria sem ator (D20 do Plano 05); recibo com `via = 'link_email'`. Página `/documento/[token]` com `Referrer-Policy: no-referrer` (regra no `next.config.ts`), `noindex`, `Cache-Control: no-store`, e `caminhoSeguro` trocando o token por `:token`. "Reenviar link por e-mail" (painel) emite um token novo. **v0.4:** o token leva tenant, paciente, documento e emissão, com MAC (HKDF de `ENCRYPTION_KEY`, info `nutridebby:link-documento:v1`) sobre o **e-mail atual** do paciente — e-mail trocado ou vazio mata o link; trocar a `ENCRYPTION_KEY` também. Limites como na regra, com as chaves `documento-ip` (pedido, 20/h), `documento-codigo-ip` (confirmação, 30/h) e `documento-envio` (5/h por documento) em `public_rate_limits`, mais 1 envio por minuto; textos da página na seção "Textos de interface do Plano 10A". A sessão é o cookie `nd_doc` (dois cookies iguais, um por caminho, `HttpOnly`, `SameSite=Strict`, `Secure` em https, 15 min). A sessão de paciente só cria código para documento **assinado** (política `paciente_codigo_de_assinado`, 0092). A limpeza diária dos códigos vencidos roda no job `agenda-limpeza` (04h30). As datas da página do link usam o fuso de Brasília, não o do consultório (Minor, P10A-19) |

---

## 8. Requisitos não funcionais

| ID | Requisito | Meta verificável |
|---|---|---|
| RNF-140 | Desempenho | PDF preparado em ≤ 30 s (p95) no worker; conferência do PDF assinado ≤ 3 s para 10 MB (parte síncrona); página `/v/<codigo>` p95 ≤ 300 ms. Se o spike levar à D16 (a), a comparação de conteúdo vira assíncrona, com meta de 30 s (p95) no job, e o "≤ 3 s" vale só para a parte criptográfica |
| RNF-141 | Segurança | Upload por Route Handler (`mesmaOrigem`, `requireApiNutri`, `lerCorpoLimitado` com 10 MB + folga, no máximo 2 conferências simultâneas por processo, como os exames); PDF por *magic bytes*; leitura da assinatura sem parser completo de PDF (leitor limitado à atualização incremental, limites de tamanho, `inflate` por *stream* e **orçamento total** de bytes descomprimidos por conferência — 32 MB —, no máximo 16 `/ObjStm` por revisão, aninhamento, e o **prazo de 3 s conferido dentro dos laços** do leitor e da lista fechada, não só no fim: a conferência é síncrona no processo do Next, e ~500 `/ObjStm` de 20 KB que inflam 20 MB cada cabem em 10 MB e parariam o app de todos os consultórios; isolamento em `worker_threads` fica como reforço no backlog), com a forma do `/ByteRange` e a lista fechada da RN-144 e testes com PDFs adulterados (FreeText, Stamp, conteúdo de página trocado, *stream* e fonte redefinidos, `/Resources` e `/MediaBox` trocados, widget sobre o conteúdo, `/BBox` maior que o `/Rect`, JavaScript, OpenAction, AA, Launch, anexo, `/Names`, página nova, segunda assinatura, atualização depois da assinatura, `/ByteRange` torto, lixo depois do `%%EOF`, `messageDigest` errado, SHA-1, prefixo de outro documento, o PDF preparado reenviado sem assinar, *stream* do base (conteúdo, fonte embutida, logo) redefinido com `/Type /ObjStm` ou `/XRef`, segundo `/XRef`, bomba de `inflate` (pela entrada tipo 2 de uma *xref stream*), 500 `/ObjStm` de 20 MB (recusa em menos de 3 s), aninhamento de 10.000 níveis, 11 MB, certificado vencido, e-CNPJ, sem uso de assinatura, raiz desconhecida, de outra pessoa no primeiro envio); conferência sem rede (guarda de teste); URL assinada de 5 min para os PDFs (`signFileUrl`); código de 60 bits + limite por IP (RN-156); download no portal só do próprio paciente (`paciente_arquivos`, 0072/0085), e o PDF preparado (`documento_base`) e as imagens da digitalizada fora dessa política para a sessão de paciente; digitalizada sem conteúdo ativo (RN-157); `/v` e `/documento/[token]` sem script inline, PDF aberto por `/api/arquivos` (CSP `sandbox`) |
| RNF-142 | Privacidade | Nada de conteúdo, itens da receita, CPF, CN do certificado, token ou código em log ou Sentry (`caminhoSeguro` troca `/v/<código>` por `/v/:codigo` — 12 caracteres não pegam na regra de 20 — e `/documento/<token>` por `/documento/:token`; teste em `sentry-filtro.test.ts`); erros do `pkijs`/`asn1js`/leitor mapeados para códigos fixos, nunca `err.message`; payload dos jobs só com ids; e-mail e push neutros; página pública sem dado de saúde; receita e parecer são dado de saúde: `auditRead(tx, { entidade: 'documentos', entidadeId, patientId })` na rota que assina a URL do PDF (painel, portal e link) e na leitura do conteúdo no painel — **não** na lista do portal (título, data, situação), como a agenda (D10 do Plano 05); documentos fora da cópia offline (o service worker só guarda `/p/plano`) |
| RNF-143 | Armazenamento | PDFs contam na cota de 5 GB (RN-18); o PDF preparado e as imagens da digitalizada são apagados depois da assinatura; cota esgotada → "Espaço de armazenamento esgotado. Fale com o suporte." (sem `naoBarrarPelaCota`, que é só da exportação). Sem limite de documentos por tenant ou por mês (D10) |
| RNF-144 | Acessibilidade e visual | Telas novas (painel, portal, `/v`, `/documento/[token]`) sem violações axe A/AA nos três modos (RNF-10 v1.11), só com os tokens do visual V2 (`cores.test.ts`), 360 px sem rolagem horizontal no portal e na verificação; toda página nova do painel em `ROTAS_DO_PAINEL`. **v0.4:** `/painel/pacientes/[id]/documentos` e `/painel/pacientes/[id]/documentos/[docId]` em `ROTAS_DO_PAINEL` (axe e 768 px); o E2E `e2e/documentos.spec.ts` passa pela receita digitalizada de ponta a ponta e roda o axe do painel nos cartões "Aguardando assinatura" (com o formulário das fotos aberto) e "Documento assinado" (no modo escuro, o axe do painel só vê o rascunho — Minor, P10A-20); `e2e/acessibilidade.spec.ts` roda o axe em `/p/documentos`, `/v/<código>` (válido e não encontrado) e `/documento/<token>` (pedir o código), com o aparelho claro e escuro e a 360 px (o formulário `/v` não tem axe próprio — Minor, P10A-20); a barra de abas do prontuário passou a ter 11 abas (sem `gap`, `px-2`), inteiras a partir de 1280 px |
| RNF-145 | Custo | Bibliotecas gratuitas: `qrcode` e `@react-pdf/renderer` já são dependências; só `pkijs` + `asn1js` (BSD-3) são novas no app, e `@peculiar/x509` + `reflect-metadata` (MIT, só desenvolvimento, para a AC de teste); `pdfjs-dist` (Apache-2.0) só no worker e só se a D16 (a) entrar; nenhum serviço pago (D1) |

---

## 9. Integrações

### INT-B1 — Assinatura externa (gov.br e ICP-Brasil)

| Item | Especificação |
|---|---|
| Fluxo | Sem API (a do gov.br é só para órgão público): a nutricionista baixa o PDF preparado, assina em `assinador.iti.br` (gov.br prata/ouro) ou no programa do certificado ICP-Brasil (Adobe Acrobat Reader, Assinador SERPRO, app da AC), e envia o arquivo assinado (US-144) |
| Formato aceito | PDF com assinatura PAdES (CMS destacado em `/Contents`, `adbe.pkcs7.detached` ou `ETSI.CAdES.detached`); uma assinatura por documento, que cobre o arquivo inteiro **salvo** uma revisão final só com `/DSS` e/ou carimbo do tempo `/DocTimeStamp` (PAdES-LTV); entre o PDF preparado e a assinatura, só o que a RN-144 (5) e (6) permite |
| Âncoras de confiança | **Raízes e ACs intermediárias** (o CMS pode trazer só o certificado do titular): raízes ICP-Brasil ativas v4, v5, v6, v10, v11, v12 e v13 (a v7 usa um algoritmo que o OpenSSL não lê: e-CPF sob ela é recusado), as 180 ACs do "arquivo único compactado" do ITI (aceitas só se encadeiam até uma raiz fixada pelo SHA-256 no código) e os 3 certificados da cadeia gov.br (Raiz, Intermediária e "AC Final do Governo Federal do Brasil v1", até 06/2033, autenticados pelas LCRs oficiais do ITI). Ficam em `src/modules/documentos/ancoras/` com `fonte.json` (URL, data, SHA-512 do zip, SHA-256 e validade de cada certificado), gerados por `pnpm certs:ancoras` (o CI nunca baixa nada); teste confere os hashes, o encadeamento e **dispara alarme 180 dias antes** do vencimento de qualquer âncora (a raiz v5 vence em 02/03/2029). Atualização a cada trimestre e quando uma recusa "Tipo de assinatura não aceito" vier de AC credenciada (item em `docs/operacao/`) |
| Bibliotecas | `pkijs` + `asn1js` (BSD-3) para **ler** o CMS e os certificados; toda verificação de assinatura e de cadeia pelo `node:crypto` (`crypto.verify`, `X509Certificate`). Não usar `node-forge` (não verifica PKCS#7) nem `pdf-lib` (sem manutenção, junta as revisões) |
| Não faz | Revogação (OCSP/LCR), validação do carimbo do tempo e da política de assinatura ICP (o `/DSS` e o `/DocTimeStamp` são aceitos, não validados) — o validador oficial do ITI cobre esses pontos para quem precisar. Integração por QR com o VALIDAR (exporia o PDF) |
| VALIDAR e DocMDP | Desde 2023 o VALIDAR dá "Indeterminada" se a primeira assinatura não define DocMDP/FieldMDP. O spike testa um campo de assinatura vazio já criado no PDF preparado, com `/Lock` (FieldMDP); se aprovado, o worker o acrescenta numa atualização incremental própria e a lista fechada aceita o campo pré-criado (`/V`, `/AP`, `/MK`, `/F` mudam; `/Rect`, `/P`, `/T`, `/Lock` iguais). Se algum programa aceito sair "Indeterminada", a US-147 ganha uma nota perto do link do ITI |
| Plano B (D16 = (a), 05/10/2026) | Se o spike mostrar que o assinador não preserva o PDF como prefixo, que a atualização dele não cabe na lista fechada de forma estável ou que o carimbo visível fica fora da área reservada sem controle: a parte criptográfica, a cadeia e o titular continuam síncronos; a **comparação de conteúdo** vai para um job `documento-conferir` no worker (`pdfjs-dist`, `isEvalSupported: false`, limites de páginas e tempo), que compara página a página o **texto**, a **lista de operadores**, as **anotações** (as do base + exatamente um widget de assinatura) e a ausência de ações e anexos — só o texto não basta (uma `/FreeText` passa no texto); se o assinador reescrever as fontes, a imagem renderizada (`@napi-rs/canvas`) fora do `/Rect`. Enquanto isso, "Conferindo o PDF assinado…". (c) recusar programas raros; (b) só com aceite explícito do risco |
| Opção D (só se escolhida) | API de PSC de assinatura em nuvem: especificar à parte, com custo aprovado pelo dono |

### Reuso do MVP

E-mail (INT-02: Resend/Mailpit, modelos React próprios; `enqueueEmail(…, { tenantId, tx })` na transação da assinatura — o job só existe se a transação confirmar e vai cifrado; tipos novos `documento_novo`, `documento_link`, `codigo_documento`, `certificado_confirmado` e `documento_atualizado`), push (INT-03: motor de notificações do Plano 05, só no worker, tipo novo `documento_novo` no CHECK `notifications_tipo_valido`, em `TipoNotificacao`, `ROTULO_TIPO` e `AVISOS_DO_PORTAL` com `{ corpo: 'Você tem um novo documento.', tela: '/p/documentos' }`, como `avisarPlanoNovo`), arquivos (`salvarArquivo`/`apagarArquivo`, `signFileUrl`), filas pg-boss novas em `src/jobs/queues.ts` (`documento-pdf`, `documento-digitalizado` e `expirar-documento-pdf`, de 15 em 15 min: pendente há mais de 1 h → `falhou`, como o plano alimentar, e varredura do `documento_base` sem referência), limite por IP (`limite-ip.ts`), Turnstile (`src/lib/turnstile.ts`), código de 6 dígitos (padrão da RN-16) e link assinado (padrão de `link-consulta.ts`).

---

## 10. Modelo de dados

Convenções do MVP (🔒 = `tenant_id` + RLS forçada; FK composta `tenant_id` + `patient_id` nas tabelas filhas; PK `id` uuid nas tabelas auditadas, porque o gatilho de auditoria grava `entidade_id = id`).

| Tabela | Campos-chave | Restrições / RLS |
|---|---|---|
| `tenants` (alteração) | `nome_profissional` (5–120), `contato_email`, `contato_telefone_e164`, `fitoterapia_registro` (até 60), `fitoterapia_declarada_em`, `fitoterapia_termo_versao`; **v0.4:** `documentos_liberados boolean NOT NULL DEFAULT false` (interruptor do admin, D20 do Plano 10A) | CHECK de tamanho; `fitoterapia_registro`, `fitoterapia_declarada_em` e `fitoterapia_termo_versao` juntos ou nulos. `tenants` não tem gatilho de auditoria: a declaração e a retirada gravam `recordAudit(tx, { acao: 'alterar', entidade: 'perfil_profissional', entidadeId: tenantId, patientId: null })`. **v0.4 (como ficou no 10A, ver US-140):** salvar os dados grava `alterar` com o id do tenant; a declaração grava `criar` com `entidadeId: 'fitoterapia:<versão do termo>'` e a retirada, `excluir` com `entidadeId: 'fitoterapia'` |
| 🔒 `tenant_signer` (Plano 10B) | `tenant_id` (PK, FK → `tenants`), `titular_hmac`, `titular_identificacao`, `confirmado_em`, `confirmado_por` (user), `updated_at` | Titular do certificado do consultório **fora** de `tenants`: HMAC do CPF (ou, pela D8 (a), do número de série do certificado gov.br) e a identificação mascarada (`CPF ***.456.789-**`). **RLS:** `app_enable_tenant_rls` + `app_enable_staff_only('tenant_signer')` + entrada em `STAFF_ONLY`; acesso só por `assinante.ts` (usado por `assinar.ts`); o admin não lê |
| 🔒 `signed_documents` | `id`, `patient_id`, `tipo` (`receita`; `parecer` a partir do Plano 13), `status` (`rascunho`/`preparando`/`aguardando_assinatura`/`assinado`/`substituido`/`cancelado`), `versao`, `retifica_id`, `conteudo jsonb` (esquema Zod por tipo; inclui a cópia do perfil e do nome do paciente; **sem** a justificativa de uso), `declaracao_em`, `codigo` (12), `base_pdf_path` → `stored_files.caminho` (`NO ACTION`), `base_pdf_sha256`, `base_pdf_bytes`, `area_assinatura jsonb` (coordenadas do quadro, RN-144 (6)), `pdf_status` (`pendente`/`pronto`/`falhou`), `pdf_pedido_em`, `pdf_path` → `stored_files.caminho` (`NO ACTION`), `pdf_sha256`, `assinatura_tipo` (`govbr`/`icp`/`digitalizada`; `plataforma` só se a D2 = (b), Plano 13), `assinatura_emissor` (AC, até 200), `assinante_nome` (titular do certificado, até 200; nulo em `digitalizada`), `assinado_em`, `assinado_por` (user), `entregue_em`, `cancelado_em`, `substituido_em`, `anonimizado_em`, `created_at`, `updated_at`; **v0.4 (0089):** `digitalizacao jsonb` (caminhos das fotos do envio digitalizado, um array), `digitalizacao_status` (`recebendo`/`pendente`/`falhou`) e `digitalizacao_em` (D24 do Plano 10A); `pdf_status` com `sem_cota`. Plano 13: `exam_ids uuid[]`. **v0.5:** com a D2 = (a), `assinatura_tipo` **não** ganha `plataforma` no Plano 13; o CHECK `signed_documents_tipo_valido` passa de `('receita')` a `('receita','parecer')`; `exam_ids` fica condicionada à Q13-4 (os ids já ficam na cópia em `conteudo.exames`) e, se criada, entra na lista de colunas limpas pela anonimização | `codigo` UNIQUE; CHECK `codigo IS NULL` ⇔ `status = 'rascunho'`; CHECK do formato do código (Crockford); CHECK `anonimizado_em IS NOT NULL OR ((pdf_path IS NOT NULL AND pdf_sha256 IS NOT NULL AND assinado_em IS NOT NULL) = (status IN ('assinado','substituido','cancelado')))`; FK composta `retifica_id` → mesmo tenant e paciente; índice único parcial (`retifica_id`) WHERE `status IN ('rascunho','preparando','aguardando_assinatura')` (RN-146); índice (`tenant_id`, `patient_id`, `created_at DESC`) e (`tenant_id`, `status`) para o cartão do Início; CHECK dos caminhos do próprio tenant (como `exams_arquivo_do_tenant`; **v0.4, 0093:** prefixo exato com `starts_with` — o base em `<tenant>/documento_base/`, o PDF final só em `<tenant>/documento_assinado/`); **v0.4:** CHECK `assinatura_tipo` só `'digitalizada'` no 10A (o 10B amplia), o CHECK do emitido inclui `assinatura_tipo IS NOT NULL`, UNIQUE (`tenant_id`, `id`, `codigo`) para a FK da verificação (0092). **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_enable_audit('signed_documents', 'documentos')`; política `RESTRICTIVE` `paciente_so_emitidos` (`FOR ALL USING (app_current_role() IS DISTINCT FROM 'paciente' OR status IN ('assinado','substituido','cancelado')) WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente')`, como `paciente_sem_rascunho`); **sem** entrada em `PACIENTE_ESCREVE` (o paciente nunca altera documento); `publico_negado` (padrão). Gatilho `app_documento_imutavel` (RN-140). As mudanças do worker (`pdf_status`, base pronto) aparecem como "Alterou" sem ator, como no plano alimentar |
| 🔒 `signed_document_notes` | `id` (PK), `documento_id` (UNIQUE, FK composta `tenant_id` + `patient_id` + `documento_id` → `signed_documents`, `ON DELETE CASCADE` só para o rascunho apagado), `patient_id`, `justificativa_uso` (até 2000; só receita), `motivo_cancelamento` (até 500), `updated_at`; **v0.4:** `tenant_id` | Anotações da nutricionista que o paciente **não** lê no banco (D15). **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_enable_staff_only('signed_document_notes')` + entrada em `STAFF_ONLY` (motivo: "Res. CFN 656, art. 3º, XII / D15: justificativa de uso e motivo de cancelamento — só a equipe (a exportação do titular lê pelo worker)") + `app_enable_audit('signed_document_notes', 'documentos')`; gatilho de imutabilidade da RN-140. A exportação do titular (worker, contexto `worker`) lê a justificativa daqui |
| 🔒 `signed_document_receipts` | `id` (PK), `tenant_id`, `patient_id`, `documento_id` (FK composta → `signed_documents`), `evento` ∈ `aberto`/`recebido`, `via` ∈ `portal`/`link_email`/`pessoalmente`, `em`, `registrado_por` (user; nulo no link) | UNIQUE (`documento_id`, `evento`); CHECK `via = 'pessoalmente'` ⇒ `evento = 'recebido'`. **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_enable_audit('signed_document_receipts', 'documentos')` (prova de entrega: auditada, não `AUDIT_EXCEPTIONS`) + `app_allow_paciente_escrita('signed_document_receipts', 'insert')` + entrada em `PACIENTE_ESCREVE` (motivo: "D4: o paciente registra que abriu e confirma o recebimento do próprio documento emitido, uma vez por evento") + RESTRICTIVE `paciente_recibo_proprio` FOR INSERT (documento `assinado` do próprio paciente, `via` ≠ `pessoalmente`, `registrado_por` nulo); **v0.4 (0092):** RESTRICTIVE `recibo_fora_do_paciente` FOR INSERT (fora da sessão de paciente, só `pessoalmente` com `registrado_por = app_current_user()`); CHECK `signed_document_receipts_pessoalmente` (`pessoalmente` ⇔ `registrado_por` preenchido). Só INSERT: `REVOKE UPDATE, DELETE` de `nutri_app_role` (append-only, como `audit_log`). CS-142 mede pelo evento `recebido` |
| 🔒 `document_access_codes` | `id` (PK), `tenant_id`, `patient_id`, `documento_id` (FK composta), `codigo_hash`, `expira_em`, `tentativas`, `usado_em`, `sessao_hash`, `sessao_expira_em`, `created_at` | Códigos do link de uso único (RN-158). **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_allow_paciente_escrita('document_access_codes', 'insert', 'update')` + entrada em `PACIENTE_ESCREVE` (motivo: "RN-158 / D3 b: o paciente sem login pede e confere o código do próprio documento (link-documento.ts, semConta)"); sem dado de saúde nem o código (só HMAC) → entrada em `AUDIT_EXCEPTIONS` (a abertura vira evento auditado em `signed_document_receipts`); UPDATE só de `tentativas` (+1) e da sessão (uma vez), pelo gatilho `app_codigo_acesso_regras` (v0.3.1); limpeza diária dos vencidos (`agenda-limpeza`); **v0.4:** CHECK `tentativas` entre 0 e 5 e sessão (`sessao_hash` ⇔ `sessao_expira_em`, só depois de `usado_em`); RESTRICTIVE `paciente_codigo_de_assinado` FOR INSERT (0092: a sessão de paciente só cria código de documento **assinado**); a anonimização apaga os códigos do documento |
| `document_verifications` | `codigo` (PK), `tenant_id`, `documento_id`, `tipo`, `situacao` (`valido`/`substituido`/`cancelado`/`eliminado`), `situacao_em`, `assinado_em`, `emissor_nome`, `emissor_crn`, `assinante_nome` (nulo em digitalizada), `assinatura_tipo`, `pdf_sha256`, `created_at` | **Sem dado de saúde nem do paciente.** Lida pelo código antes de existir contexto de tenant → entra em `RLS_EXCEPTIONS` (motivo: "lida pelo código antes de existir contexto de tenant (verificação pública); sem dado de saúde nem do paciente; acesso só por src/modules/documentos/verificacao.ts; DELETE revogado"); teste que só `verificacao.ts` referencia a tabela. **Privilégios:** `REVOKE DELETE` e `REVOKE UPDATE` de `nutri_app_role` + `GRANT UPDATE (situacao, situacao_em)`, como `consents` (0009) e `backup_runs` (0014). Gravada na mesma transação da assinatura, retificação, cancelamento e anonimização. CLAUDE.md, regra 1: a lista das tabelas com `tenant_id` em `RLS_EXCEPTIONS` ganha `document_verifications`. **v0.4:** UNIQUE (`documento_id`); CHECKs do formato do código, da situação, de `assinatura_tipo` (só `'digitalizada'` no 10A) e "`assinante_nome` nulo ⇔ digitalizada"; **0092:** FK (`tenant_id`, `documento_id`, `codigo`) → `signed_documents` (`NO ACTION`) e gatilho `verificacao_situacao` (a situação só avança). O teste de restauração (`nutri-restauracao-teste.sh`) também a deixa fora da conta das tabelas sem RLS, como as outras de `RLS_EXCEPTIONS` (guarda em `rls-guard.test.ts`). **v0.5:** `tipo` é `text NOT NULL` **sem CHECK** e o código grava sempre `'receita'`; o Plano 13 acrescenta o CHECK (`'receita'`, `'parecer'`) e grava o tipo do documento |
| `stored_files` (alteração) | `tipo` ganha `documento_base`, `documento_assinado` e `documento_digitalizado` | CHECK `stored_files_tipo_valido` atualizado; os três em `TipoDeArquivo` e em `TIPOS_DO_PACIENTE` (com dono: `patient_id` obrigatório pelo `stored_files_dono`); `paciente_arquivos` refeita: o paciente vê os próprios arquivos **menos** `documento_base` e `documento_digitalizado` |
| `notifications` (alteração) | `tipo` ganha `documento_novo` (e `documento_atualizado` com o cancelamento) | CHECK `notifications_tipo_valido` atualizado |

Outros pontos de código: `ENTIDADE_ROTULO.documentos = 'Documentos assinados'` e `perfil_profissional = 'Perfil profissional'`; `PACIENTE_ESCREVE` (recibos e códigos), `SEM_CONTA_PERMITIDOS` (`link-documento.ts`), `RLS_EXCEPTIONS` (`document_verifications`), `STAFF_ONLY` (`signed_document_notes`, `tenant_signer`), `AUDIT_EXCEPTIONS` (`document_access_codes`); `FABRICAS` de `test/isolamento.test.ts` para as tabelas novas (a de `signed_documents` cria documento `assinado` já anonimizado, visível ao paciente e sem arquivo; as filhas criam a mãe no mesmo comando) e `stored_files` + `signed_documents` em `ULTIMAS`; `chaveDoLimite` ganha `verificacao-ip`, `documento-ip`, `totp-erro` e `totp-usado`; `caminhoSeguro`; `next.config.ts` (`/v/:path*`, `/documento/:token*`); `ABAS` do prontuário (aba "Documentos" antes de "Histórico de acessos"); `ITENS_DO_PORTAL` (`/p/documentos` em `tambem` de "Perfil"); `GUIAS` (`documentos`, `configuracoes` e `seguranca`); `exportacao-job.ts` com a chave `documentos` e os PDFs em `documentos/`; `lgpd.ts` com o caminho (c) da RN-140 antes do laço de anexos e a conferência final por função própria (`pdfsDeDocumentosRestantes`), sem mexer em `anexosDoPaciente`; CLAUDE.md do projeto: regra 1 (`document_verifications`, `confirmar-2fa.ts` entre os que acessam `user`/2FA pela API), regra 2 (exemplo de tabela com recibo só INSERT), regra 8 (`app_anonimizar_documentos` ao lado da `app_anonimizar_aceites`) e regra 9 (PDF e digitalizada de documento só no worker; FK `NO ACTION`).

**v0.4 — como ficou no código do 10A:** `chaveDoLimite` ganhou também `documento-envio` (envios de código por documento) e `documento-codigo-ip` (confirmação do código por IP); o `next.config.ts` manda `Referrer-Policy: no-referrer` e `Cache-Control: no-store` em `/documento/:token*` **e** em `/api/documento/:token*`, e `no-referrer` em `/v/:path*`; o `caminhoSeguro` troca `/documento/<token>` e `/api/documento/<token>` por `:token`; `ENTIDADE_ROTULO` também tem `tentativa_assinatura` ("Tentativa de assinatura com código recusado"); `IMUTAVEIS` (`signed_documents`, `signed_document_notes`, `document_access_codes`), `SO_INSERE` (`signed_document_receipts`) e `SO_APAGA` em `test/isolamento.test.ts`; as filas `documento-pdf`, `documento-digitalizado` e `expirar-documento-pdf` (de 15 em 15 min: PDF ou digitalização pendente há mais de 1 h → `falhou`; base e fotos sem referência → apagados; ponteiros que sobraram num emitido → `soltarArquivosDoPreparo`). O E2E tem uma conta própria com 2FA ativo (`E2E_DOCS` em `scripts/e2e-seed.ts`).

---

## 11. Riscos e pendências

| ID | Item | Tipo | Ação / responsável |
|---|---|---|---|
| P-B1 | O CFN exige "assinatura digital certificada" na receita eletrônica (Res. 656/680); não está claro se a assinatura avançada do gov.br atende, nem como a Res. CFN 760/2023, art. 10, II, convive com essa exigência na receita de telenutrição; nem se a assinatura na plataforma com 2FA + código verificador (opção A) atende o parecer (D2) e o plano alimentar (D12) | Pendência (dono; **bloqueia o uso real, não o desenvolvimento**) | Consulta escrita ao CRN-3 (Debby/dono), com os textos da D5 revisados pela Debby e as perguntas da D2 e da D12. Conferir o texto da 760/2023 no DOU. Se o gov.br não atender, a receita fica com C e E |
| P-B2 | Spike técnico: o assinador do gov.br e os programas ICP preservam os bytes do PDF? Que objetos cada um põe na atualização? Onde fica o CPF no certificado gov.br? O assinador usa o campo pré-criado? Resultado no VALIDAR (DocMDP)? Tolerância do fim de linha depois do `%%EOF`? `/DSS`/DocTimeStamp? `/ObjStm`? | Pendência técnica | Tarefas 1 e 2 do Plano 10B. **Depende do dono e da Debby:** PDFs de teste com dados fictícios assinados no gov.br e, se houver, com e-CPF A1/A3 em dois programas, com o relatório do VALIDAR. Os arquivos reais têm nome e CPF: ficam fora do git (`test/assinatura/reais/` no `.gitignore`); no repositório só o relatório de estrutura e as réplicas estruturais. A opção C só é liberada depois de um arquivo real de pelo menos um programa ICP |
| P-B3 | Termo de consentimento do paciente e DPA precisam citar a entrega eletrônica de documentos, o link por e-mail, a assinatura usada e a página pública de verificação; na telenutrição, o TCLE (Res. CFN 760/2023, art. 9º, VI) é o lugar da "forma acordada com o cliente" (art. 10, III) | Pendência | Junto com o E-09 (P08-06 bloqueado); o termo novo exige novo aceite (`src/modules/portal/termo.ts`) |
| P-B4 | Versão vigente da lista de constituintes de suplementos (IN Anvisa 28/2018 e atualizações citadas pela Res. CFN 731/2022) | A confirmar | Debby confere; o sistema não valida itens contra a lista (B-04) |
| P-B5 | Prazo de guarda vale também para documentos assinados | Pendência | Segue a P-01 (aberta; `PRAZO_GUARDA_ANOS = 20`, `lgpd.ts`) |
| P-B6 | Validação própria da assinatura pode ter falha (aceitar o que não deveria), inclusive sobreposição de conteúdo na atualização incremental ("shadow attacks") | Risco | Forma do `/ByteRange`, lista fechada por alcance com comparação chave a chave e área reservada (RN-144); cadeia até âncora fixada + validade + certificado de pessoa + nome do titular e CPF conferidos com 2FA (RN-145) + "Assinado por" na página pública + link ao validador do ITI; os testes da RNF-141; revisão de segurança com o checklist reforçado |
| P-B7 | Receita **impressa** perde a conferência de conteúdo: o QR prova que o código existe, não que o papel não foi alterado. Na digitalizada (E), nem o arquivo eletrônico tem conferência de conteúdo (RN-157) | Risco aceito (D1) | A página mostra situação, data, emissor e quem assinou; a farmácia pode pedir o PDF e conferir o SHA-256 |
| P-B8 | Documentos esquecidos em "Aguardando assinatura" | Risco de uso | Cartão "Documentos aguardando assinatura" no Início (bento, visual V2) |
| P-B9 | Responsabilidade profissional: o sistema não confere UL, interações, a lista da Anvisa nem o enquadramento do produto vegetal como alimento ou suplemento (RN-150) | Risco aceito (B-04) | Declaração ao preparar; sem IA nos documentos (D7) |
| P-B10 | **Lacuna de conformidade do MVP:** o plano alimentar e as orientações entregues em telenutrição são "documentos produzidos" no sentido da Res. CFN 760/2023, art. 10; hoje saem sem assinatura/código verificador e sem confirmação de recebimento | Pendência (conformidade) | **D12 = (b) (05/10/2026):** a pergunta vai na consulta da P-B1; se o CRN-3 confirmar a exigência, vira escopo novo (plano alimentar com código e confirmação), fora dos Planos 10 e 13 |
| P-B11 | A Res. CFN 856/2026 substitui a 599/2018 em 23/01/2027 (número do ato de prorrogação a confirmar no DOU) e o texto ainda pode mudar | A confirmar | Conferir o texto e a vigência antes do uso real (junto com R-107 de A e P-L6 da loja); revisar RN-151 e §3.5 se mudar |

---

## 12. Referências

| Norma / fonte | Uso nesta spec | URL |
|---|---|---|
| Resolução CFN nº 656/2020 (prescrição dietética de suplementos alimentares), com a redação da Res. CFN nº 731/2022 | §3.2, RN-149 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_656_2020.html |
| Resolução CFN nº 731/2022 (altera as Res. 656/2020 e 680/2021; inclui o § 2º do art. 3º da 680) | §3.2, §3.3, RN-150, D13 | https://www.cfn.org.br/wp-content/uploads/resolucoes/Res_731_2022.html |
| Resolução CFN nº 680/2021 (fitoterapia), alterada pelas Res. CFN 688/2021 e 731/2022 | §3.3, RN-150, RN-151 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_680_2021.html |
| Resolução CFN nº 760/2023 (telenutrição), arts. 9º, VI, e 10 — texto conferido em fonte secundária; DOU **a conferir** | §3.4, D1, D2, D3, D12, P-B1, P-B10 | https://legismap.com.br/leis-e-normas/resolucao-cfn-n-760-de-22-10-2023 · https://www.in.gov.br/en/web/dou/-/resolucao-cfn-n-760-de-22-de-outubro-de-2023-518461727 |
| Resolução CFN nº 599/2018 (Código de Ética), arts. 20, 60 a 63 | §3.5, RN-151, D14 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html |
| Resolução CFN nº 856/2026 (novo Código de Ética; vigência em 23/01/2027, ato de prorrogação **a confirmar**) | §3.5, RN-151, D14, P-B11 | https://www.legisweb.com.br/legislacao/?id=494878 |
| Resolução CFN nº 600/2018 (atribuições; glossário) | §3.1 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_600_2018.htm |
| Resolução CFN nº 306/2003 (solicitação de exames laboratoriais) | §3.1 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_306_2003.htm |
| Lei nº 8.234/1991 — texto **não conferido** | §3.1 | https://www.planalto.gov.br/ccivil_03/leis/l8234.htm |
| Lei nº 12.842/2013 (ato médico) | §3.1 | https://www.normasbrasil.com.br/norma/lei-12842-2013_256316.html |
| Lei nº 14.063/2020 (assinaturas eletrônicas), arts. 4º, 13 e 14 — arts. 13 e 14 **a conferir no Planalto** | §3.4, D1, D2 | https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm |
| MP nº 2.200-2/2001 (ICP-Brasil), art. 10 | §3.4 | https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm |
| ITI — assinatura eletrônica avançada gov.br; manual de integração da API (Gestor Público; PKCS#7 SHA256-RSA com o certificado do usuário; DocMDP recomendado) | §3.4, INT-B1 | https://www.gov.br/iti/pt-br/assuntos/assinatura-eletronica-avancada · https://manual-integracao-assinatura-eletronica.servicos.gov.br/pt-br/latest/iniciarintegracao.html |
| ITI — repositório AC-Raiz e arquivo único das ACs; LCRs do gov.br | INT-B1 | https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz · http://repo.iti.br/lcr/public/LCRacraizGovBr.crl |
| ITI — VALIDAR (dúvidas: "Indeterminada" sem DocMDP/FieldMDP; Guia do Desenvolvedor) | RN-144, US-147, INT-B1 | https://validar.iti.gov.br/duvidas.html · https://validar.iti.gov.br/guia-desenvolvedor.html |
| Assinador SERPRO (gratuito, PAdES ICP-Brasil) | P-B2 | https://serpro.gov.br/links-fixos-superiores/assinador-digital |
| Shadow Attacks (NDSS 2021) e PDF Insecurity (USF/ISA/SWA, 2019) | RN-144, RNF-141, P-B6 | https://www.ndss-symposium.org/wp-content/uploads/ndss2021_1B-4_24117_paper.pdf · https://pdf-insecurity.org/ |
| CVE-2024-4367 (pdf.js) | INT-B1 (plano B) | https://nvd.nist.gov/vuln/detail/CVE-2024-4367 |
| Preço de mercado do e-CPF A1 em 2026 (**a confirmar**) | §3.4 | https://www.omie.com.br/blog/qual-e-o-valor-do-certificado-digital-a1-e-a3-em-2026/ |
| IN Anvisa nº 28/2018 e atualizações — versão vigente **a confirmar** | §3.2, P-B4 | (via Res. CFN 656/2020) |
| LGPD (Lei nº 13.709/2018): arts. 11, 16, I, e 18 | US-150 | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm |

---

## Pontos menores (backlog)

| Item | Origem | Observação |
|---|---|---|
| "Conferir arquivo" na página de verificação (SHA-256 calculado no navegador) | Revisão 0.2 (YAGNI) | Repete o validador do ITI; prioridade S, se a Debby ou farmácias pedirem |
| Textos de interface da variante da opção A | Revisão 0.2 | Só se a D2 = (b) (Plano 13) |
| Aba "Documentos" na barra do portal ou um "Mais" | v0.3 | Se o cartão no Início e o link em Perfil não bastarem (a barra tem 7 colunas, R16) |
| "Histórico de acessos" agrupado por dia para os eventos de recebimento | v0.3 | Como o diário no Início (1× por paciente por dia) |
| Revogação lida do próprio PDF (`adbe-revocationInfoArchival` ou `/DSS`), sem rede, e cache diário de LCRs no worker | Pesquisa de assinatura (05/10/2026) | Não exigido pela spec; o VALIDAR cobre |
| Raiz ICP-Brasil v7 (algoritmo que o OpenSSL não lê) | Pesquisa de assinatura | Rever quando o Node suportar; hoje 1 AC |
| Identificação do cliente além do nome (e-mail e telefone) no PDF | Revisão de normas (Res. 760/2023, art. 10, I) | Pergunta na consulta da P-B1; hoje o PDF traz só o nome |

Achado não aplicado como proposto, com fato verificável: exportação da equipe (US-018) "com tudo" — o motivo de cancelamento continua **fora** das duas exportações (decisão do dono para a agenda em 2026-10-02, RNF-08 da spec do MVP); a justificativa de uso entra na exportação da equipe e, pela D15 = (b), na do titular.

---

## Decisões do dono (05/10/2026)

Todas conforme a recomendação da v0.2.

| ID | Pergunta | Decisão |
|---|---|---|
| D1 | Tipo de assinatura aceito na **receita** | **B (gov.br) + C (ICP-Brasil da nutricionista) pelo mesmo fluxo de envio do PDF assinado, + E (digitalizada) como alternativa**; assinar exige 2FA ativo (RN-145); **não** oferecer A para a receita; D só com demanda e custo aprovado. Se o CRN-3 recusar o gov.br (P-B1), a receita fica com C e E |
| D3 | Entrega a paciente sem acesso ao portal | **(b) link de uso único por e-mail + código de 6 dígitos** para quem não tem portal (RN-158) e **(a) "Entregue pessoalmente"** para o presencial; **nunca** PDF anexo |
| D4 | O que conta como confirmação de recebimento | **Botão explícito "Confirmo que recebi este documento"**, uma vez por documento; a abertura sem confirmação aparece como "aberto, recebimento não confirmado" |
| D5 | Textos sensíveis | **Textos propostos; a Debby revisa e eles vão na consulta ao CRN-3.** Ressalva do parecer: "Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica." · Declaração do parecer: "Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento." · Declaração da receita: "Declaro que os itens são suplementos alimentares, produtos vegetais classificáveis como alimento ou suplemento ou fitoterápicos isentos de prescrição médica, dentro da minha competência (Resoluções CFN nº 656/2020 e nº 680/2021), e que a receita não indica marca nem local de compra." No Plano 10, só a da receita (rascunho até a aprovação) · **v0.3.1:** a declaração proposta da receita passa a citar também os medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas (Res. CFN 656/2020, art. 1º, § 1º; Minor 10 da revisão de normas) — continua rascunho para a Debby e o CRN-3 |
| D6 | Comprovação da habilitação em Fitoterapia | **Autodeclaração** com o registro no CRN e termo de responsabilidade (versão do termo gravada) |
| D7 | Rascunho do parecer com IA (US-151) | **(a) cortar** |
| D8 | O que a página pública mostra | **Situação, tipo, data, nutricionista com CRN, "Assinado por" (titular do certificado) e SHA-256**, nada do paciente |
| D9 | Ordem de entrega | **Base + receita primeiro (Plano 10, dividido em 10A e 10B na v0.3.1), parecer depois (Plano 13)** |
| D10 | Limite de documentos | **Sem limite** (só a cota de 5 GB) |
| D11 | Avisar o paciente no cancelamento ou na substituição | **Sim, e-mail neutro** |
| D12 | Plano alimentar em telenutrição (P-B10) | **(b)** consultar o CRN-3 antes, na mesma consulta da P-B1 |
| D13 | Produto vegetal classificável como alimento ou suplemento | **(a) tipo próprio** "Droga ou derivado vegetal classificado como alimento ou suplemento", com os campos do art. 12, I, obrigatórios |
| D14 | Marca na receita | **Não** (sem campo de marca) |
| D15 | Justificativa de uso e motivo de cancelamento visíveis ao titular? | **(b)** justificativa fora do portal mas **na exportação do titular**; motivo de cancelamento só da equipe (confirmar com o advogado, E-09) |
| D16 | Conferência que não couber no leitor limitado | **(a)** biblioteca gratuita de parser no worker, com conferência assíncrona; (c) para programas raros; (b) só com aceite explícito do risco |

### Decisões do Plano 10 (aprovadas pelo dono em 05/10/2026)

As decisões ★ do plano de implementação (numeração do plano, distinta das decisões da spec acima), todas **aprovadas como recomendadas**, junto com a divisão do Plano 10 em 10A e 10B.

| ID | Pergunta | Decisão | Plano |
|---|---|---|---|
| D1 ★ | Base de LGPD da receita (§2.3 i) | Auditoria, exportação da equipe e do titular, bloqueio e anonimização pela `app_anonimizar_documentos`, antes do uso real | 10A |
| D2 ★ | Esquema completo (§2.3 ii) | Os 6 estados, o gatilho com todas as transições, as 4 situações da verificação e o motivo de cancelamento já no 10A; `tipo` só `'receita'` | 10A |
| D3 ★ | Cancelar antes do uso real (§2.3 iii) | A US-149 sobe para o 10A; a retificação (US-148) fica no Plano 13 | 10A |
| D4 ★ | Digitalizada (opção E) | Só fotos (JPEG/PNG, 1 a 5, 10 MB) + código do 2FA; o worker monta um PDF novo | 10A |
| D5 ★ | "Documentos" no portal | Cartão no Início + link "Meus documentos" em Perfil; a barra de 7 abas não muda | 10A |
| D6 ★ | Link de uso único | Válido por 30 dias e enquanto o documento estiver assinado; "Reenviar link por e-mail" | 10A |
| D7 ★ | Âncoras de confiança (INT-B1) | Versionadas no repositório; atualização trimestral pelo Claude a pedido do dono; alarme 180 dias antes de vencer | 10B |
| D8 ★ (condicional) | gov.br sem CPF em campo próprio | (a) nome completo + número de série do certificado, com o 2FA a cada certificado novo — só se o spike mostrar que falta o CPF | 10B |
| D9 ★ | `/security-review` | Com o checklist reforçado | 10A e 10B (a parte da conferência no 10B) |

### Decisão do dono de 08/10/2026 (D2, Plano 13)

| ID | Pergunta | Opções | Decisão |
|---|---|---|---|
| D2 (Plano 13) | O **parecer** exige o mesmo nível de assinatura da receita? | (a) mesmo nível (B/C/E): prova mais forte, atrito **alto**, R$ 0 · (b) opção A (plataforma com 2FA + código verificador): atende o texto da Res. CFN 760/2023, art. 10, II ("e/ou código verificador"), atrito **baixo**, R$ 0, prova mais fraca · (c) as duas, à escolha da nutricionista por documento | **(a) — decidida pelo dono em 08/10/2026** ("siga" para o Plano 13), enquanto o CRN-3 não responder: o parecer usa o mesmo nível de assinatura da receita (hoje a **digitalizada** do Plano 10A, com o 2FA em todo envio; **gov.br e ICP-Brasil** quando o Plano 10B sair). **Revisável para (b)** se o CRN-3 confirmar na consulta da P-B1; aí entram a variante da RN-141 (`preparando → assinado` pelo worker), `assinatura_tipo = 'plataforma'` e os textos da variante A (backlog "Pontos menores"). (c) só se a Debby pedir |

### Consultas externas pendentes (não são decisões do dono)

P-B1 (CRN-3: gov.br na receita, D2, D12, textos da D5, identificação do cliente), P-B3 (advogado, E-09: termo, DPA, D15), P-B4 (Debby: IN Anvisa), P-B5 (prazo de guarda, P-01), P-B11 (DOU: vigência da Res. 856/2026), e os arts. 13 e 14 da Lei 14.063 e o texto da Res. 760/2023 no Planalto/DOU.

---

## Plano 10A — o que mudou na execução (v0.4, 06/10/2026)

Conferido no código da `main` em `3991c7d` (merge do PR #19; plano [`2026-10-05-nutridebby-10a-receita.md`](../plans/2026-10-05-nutridebby-10a-receita.md)). As notas "**v0.4**" ao longo do texto apontam para esta seção. Nada aqui muda o que é do Plano 10B (certificado, conferência do PDF assinado, assinante do consultório) nem do Plano 13 (parecer, retificação, LGPD do parecer).

### Migrations

| Migration | Tipo | O que faz |
|---|---|---|
| `0089_documentos_assinados` | Gerada | As 5 tabelas (`signed_documents`, `signed_document_notes`, `signed_document_receipts`, `document_access_codes`, `document_verifications`), as colunas do perfil e `documentos_liberados` em `tenants`, os CHECKs novos de `stored_files.tipo` (`documento_base`, `documento_assinado`, `documento_digitalizado`) e de `notifications.tipo` (`documento_novo`, `documento_atualizado`) |
| `0090_rls_documentos` | Custom | RLS, `staff_only` das notas, auditoria (entidade `documentos`) das três tabelas de saúde, escrita do paciente (recibo só `insert`; código `insert`/`update`), `paciente_so_emitidos`, `paciente_recibo_proprio`, `REVOKE UPDATE, DELETE` do recibo, privilégios da verificação (só `situacao`/`situacao_em`) e `paciente_arquivos` refeita sem o base e as fotos |
| `0091_documentos_imutaveis` | Custom | Gatilhos `app_documento_imutavel` (RN-140/141), `app_notas_imutaveis`, `app_codigo_acesso_regras` e a função `app_anonimizar_documentos` (`SECURITY INVOKER`, só `worker`) |
| `0092_documentos_defesa` | Custom (revisão final do branch, Minors de segurança) | `recibo_fora_do_paciente`; gatilho `verificacao_situacao` (só avança); UNIQUE (`tenant_id`, `id`, `codigo`) em `signed_documents` + FK da verificação para o documento; `paciente_codigo_de_assinado` |
| `0093_documentos_arquivos_e_rascunho` | Custom (`/code-review high` do PR #19, itens 5 e 6) | CHECK `signed_documents_arquivos_do_tenant` com prefixo exato (`starts_with`); `app_documento_imutavel` refeita: a assinatura exige um `stored_files` `documento_assinado` do mesmo tenant e paciente, o rascunho recusa os campos de assinatura, cancelamento e substituição, e o preparo exige `declaracao_em` e `pdf_status = 'pendente'` |

Nenhuma migração de dados; nenhuma variável de ambiente nova (as chaves derivam de `ENCRYPTION_KEY` por HKDF). O Plano 10B numera as dele a partir da **0094**. **v0.5 (08/10/2026):** a 0094 a 0103 foram usadas pelos Planos 09 (0094–0097), 11 (0098–0100) e 12 (0101–0103, a 0103 é a sessão da equipe de 30 min, P12-14); a próxima livre na `main` é a **0104**, e quem entrar primeiro (Plano 13 ou 10B) fica com ela.

### Decisões de desenho do Plano 10A (além das ★ D1–D6 e D9)

| # | Decisão (aplicada) |
|---|---|
| D11 | Recebimento em tabela própria, só INSERT (`signed_document_receipts`), eventos `aberto` e `recebido`, um por documento (`ON CONFLICT DO NOTHING`) |
| D12 | Código do link em `document_access_codes`, escrito pela sessão de paciente **sem login** (`link-documento.ts` em `SEM_CONTA_PERMITIDOS`), em `AUDIT_EXCEPTIONS`; token sem estado (MAC com o e-mail atual) |
| D13 | Código do 2FA em **todo** envio digitalizado, por `confirmarCodigo2fa` (`src/lib/confirmar-2fa.ts`): 5 erros em 15 min por usuária, anti-repetição de 90 s, recusa no histórico do paciente |
| D14 | Paciente arquivado: redige, prepara e assina; entrega só "Entregue pessoalmente", sem `entregue_em` |
| D15 | Quadro "Assinatura digital" 208 × 70 pt no rodapé de cada página, gravado em `area_assinatura` no preparo (o PDF é o mesmo no 10A e no 10B) |
| D16 | "Prescrição" nos identificadores do código (`prescricao.ts`); "receita" no banco e na tela |
| D17 | `auditRead` na leitura do conteúdo no painel e nas rotas que devolvem o PDF (painel, portal, link); as listas do painel e do portal não auditam (só tipo, data, situação, assinatura e recibos — teste das chaves) |
| D18 | Guias `documentos` (v1), `configuracoes` (v2) e `seguranca` (v1, mostrado em `/conta/seguranca`) |
| D19 | Isolamento: fábrica de `signed_documents` cria um emitido já anonimizado; `SO_INSERE`, `IMUTAVEIS`, `SO_APAGA`; `signed_documents` e `stored_files` em `ULTIMAS` |
| D20 | Interruptor `tenants.documentos_liberados`, ligado pelo admin (coluna "Documentos" da lista de contas, botões "Liberar"/"Bloquear" com confirmação), **sem registro durável além do log** (Minor, P10A-18); não desligar depois do uso real |
| D22 | As colunas que só o 10B lê (`base_pdf_bytes`, `area_assinatura`, `assinatura_emissor`, `assinante_nome`) e o quadro nascem no 10A |
| D23 | `registrarAssinatura` em `registrar-assinatura.ts`, sem dependência de sessão (o worker importa; guarda de grafo no teste) |
| D24 | Um envio digitalizado por vez (`recebendo`/`pendente` + `digitalizacao_em`), expiração em 1 h |

### Correções do `/code-review high` do PR #19 (refletidas no texto)

(I1) a digitalizada assina só com as **fotos lidas** pelo job; (I2) ordem de travas documento → tenant em todo `salvarArquivo` que grava num documento (`travarDocumentoAntesDaCota`); (I3) a marca anti-repetição do 2FA volta quando o envio falha depois do código aceito (`liberarCodigo2fa`); (4) "Voltar a editar" gravado sem a linha do base é sucesso; (5) e (6) a migration 0093; (7) `lerCookie` em `src/lib/ler-cookie.ts`; (8) `RESET_PREPARO` único (voltar a editar e anonimização); (9) "Voltar a editar" no PDF falho ou sem cota e nunca com envio digitalizado em curso. O `/security-review` com o checklist reforçado (D9 ★) não manteve nenhum achado.

### Textos de interface do Plano 10A (finais no código)

Os marcados "(proposto)" na spec, a declaração da receita (D5) e os textos novos abaixo continuam **rascunho** até a revisão da Debby (runbook do Plano 10A, passo 3; checklist em `docs/operacao/go-live.md`).

| Onde | Textos |
|---|---|
| Configurações > Perfil e marca (`#documentos`) | Seção "Dados para documentos"; "O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020). O CRN e o endereço ficam no formulário acima."; "Nome completo" (dica "Sai no carimbo das receitas, como no seu registro no CRN."), "E-mail profissional", "Telefone profissional" (dica "Com DDD. Ex.: (11) 91234-5678"); "Salvar dados para documentos"; "Dados para documentos salvos."; "Tenho habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021)"; "Registro da habilitação no CRN" (dica 'Ex.: "CRN-3 nº 1234/2024"'); "Declaro, sob minha responsabilidade, que a habilitação está registrada no CRN."; "Registrar habilitação"; "Habilitação em Fitoterapia registrada no perfil."; "Habilitação em Fitoterapia: {registro} (declarada em {data})."; "Retirar habilitação"; "Retirar a habilitação em Fitoterapia do perfil? Os fitoterápicos formulados deixam de poder ser prescritos."; "Habilitação em Fitoterapia retirada do perfil."; cartão do hub: "Nome, CRN, logo, cor, regras da agenda e dados para documentos." |
| Prontuário > Documentos (lista) | Aba "Documentos"; título "Documentos"; "Nova receita"; colunas "Documento", "Data", "Situação"; "Receita de {data}"; "Nenhum documento ainda."; "Rascunho apagado."; "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta." |
| Documento (cabeçalho e editor) | "Receita"; selos "Rascunho", "Preparando o PDF", "Aguardando assinatura", "Assinado", "Substituído", "Cancelado"; "Código de verificação: XXXX-XXXX-XXXX"; "Itens da receita"; "Item {n}: {tipo}"; "Categoria"; "Composição"; "Componente {n}"; "Quantidade"; "Unidade"; "Remover componente {n}"; "Adicionar componente"; "Modo de preparo"; "Via"; "Manipulado"; os campos de cada tipo com "(opcional)" nos opcionais; "Remover item {n}"; "Tipo do item"; "Adicionar item"; "Orientações gerais (opcional)"; "Justificativa de uso" + "Fica no prontuário, não vai na receita."; "Salvar rascunho"; "Rascunho salvo."; "Apagar rascunho" + "Apagar este rascunho?"; "Declaração"; "Preparar para assinatura"; "Complete seu perfil profissional (nome completo, CRN e contato) antes de preparar documentos." + "Completar perfil"; "Formulário inválido."; "Este documento mudou de situação. Recarregue a página." |
| Documento (preparo e assinatura) | "Preparando o PDF…"; "Não foi possível gerar o PDF. Tente de novo."; "Espaço de armazenamento esgotado. Fale com o suporte."; "Gerar o PDF de novo"; "Voltar a editar" + "O PDF preparado será descartado. Continuar?"; cartão "Aguardando assinatura": "Baixe o PDF, imprima, assine à mão e envie fotos das páginas aqui.", "Baixar PDF para assinar", "Ative a verificação em duas etapas em Segurança para assinar documentos." + "Ativar agora", "Enviar documento digitalizado (assinado à mão)", o aviso da RN-157, "Fotos das páginas (JPEG ou PNG, até 5)", "Código da verificação em duas etapas", "Enviar"/"Enviando…", "Montando o PDF digitalizado…", "Não foi possível montar o PDF. Envie as fotos de novo.", "Não foi possível enviar. Tente de novo.", e as recusas da US-144 (v0.4) |
| Documento (assinado, entrega, cancelado) | Cartão "Documento assinado": "Assinado em", "Assinatura", "Baixar PDF assinado"; "Entrega" e as linhas da US-145; "Entregue pessoalmente" + "Marcar como entregue pessoalmente?"; "Reenviar link por e-mail" + "Reenviar o link do documento para o e-mail do paciente?"; "Link reenviado."; "Motivo do cancelamento" + "Fica só no prontuário."; "Cancelar documento"; cartão "Documento cancelado": "Cancelado em {data}", "Motivo (só no prontuário): {motivo}"; "Documento anonimizado." |
| Início do painel | Cartão "Documentos aguardando assinatura": "1 documento aguardando assinatura" / "{n} documentos aguardando assinatura" e 'Abra o prontuário do paciente, aba "Documentos", para assinar e enviar.' (só com a liberação e algo a assinar; não conta paciente bloqueado) |
| Admin (lista de contas) | Coluna "Documentos": "Liberados"/"Bloqueados"; "Liberar"/"Bloquear"; confirmações "Liberar os documentos assinados para {consultório}? Confira antes a resposta do CRN-3, o termo e o backup." e "Bloquear os documentos assinados de {consultório}? Só antes do uso real. Bloqueado: o consultório perde a aba Documentos (inclusive Cancelar documento e Entregue pessoalmente), os pacientes deixam de ver e abrir os documentos no app e pelo link do e-mail (nenhum código é enviado), e a verificação pública pelo código continua funcionando." |
| Segurança (`/conta/seguranca`) | Bloco "Como funciona" com o guia `seguranca` (resumo "… Ela é obrigatória para assinar documentos.") |
| Portal | Início: cartão "Documentos", "1 documento novo"/"{n} documentos novos", "Ver documentos"; Perfil: "Meus documentos"; `/p/documentos`: "Documentos", "Receita · {data}", "Assinatura: Digitalizado", "Abrir PDF", "Confirmo que recebi este documento", "Recebimento confirmado em {data}.", "Substituído por uma versão mais nova.", "Cancelado pela nutricionista. Não use este documento.", "Você ainda não tem documentos." |
| Link (`/documento/<token>`) | "Abrir documento"; "Para abrir o documento, enviaremos um código de 6 dígitos para o seu e-mail."; "Enviar código"; "Código enviado. Confira seu e-mail."; "Código"; "Abrir"; "Receita · {data}"; "Abrir PDF"; "Confirmo que recebi este documento"; "Recebimento confirmado em {data}."; erros "Código inválido.", "Código vencido. Peça outro.", "Aguarde 1 minuto para pedir outro código.", "Muitas tentativas. Tente de novo em alguns minutos.", "Confirme que você não é um robô.", "Tente novamente em alguns minutos", "Este link expirou. Peça um novo à sua nutricionista.", "Este documento não está mais disponível. Fale com sua nutricionista." |
| Verificação (`/v`, `/v/<código>`) | "Verificar documento"; "Código de verificação (12 caracteres)"; "Verificar"; os títulos da US-147; "Tipo:", "Emitido por:", "Assinado por:", "Assinado em:", "Assinatura:", "Código:", "Impressão digital do arquivo (SHA-256): …"; "Verificar outro código"; "Código não encontrado. Confira os 12 caracteres."; "Muitas tentativas. Tente de novo em alguns minutos." |
| E-mails e push | "Você tem um novo documento" (com conta: texto da US-145 + "Ver meus documentos"; sem conta: texto da US-145 v0.4 + "Abrir documento"); "Código para abrir seu documento: {código}"; "Um documento seu foi atualizado" (+ "Ver meus documentos"); push "Você tem um novo documento." e "Um documento seu foi atualizado." |
| PDF | Preparado: "Receita", "Paciente: …", "Data de emissão: …", "Orientações gerais: …", o carimbo, "Assinatura digital", "Código de verificação: … · Verifique em …"; digitalizado: "Documento digitalizado · Código de verificação: … · Verifique em …" |

### Pendências do 10A que ficam no backlog

Os Minors das revisões que não entraram estão no backlog como **P10A-18** (banco, LGPD e segurança), **P10A-19** (interface e acessibilidade), **P10A-20** (testes) e **P10A-21** (operação e documentação); a tela de auditoria do consultório e o segundo estado do interruptor continuam em **P10A-17**.

---

## Plano 13 — preparação (v0.5, 08/10/2026)

Pedido e aprovado pelo dono em 08/10/2026 ("siga" para o Plano 13). Conferido no código da `main` em `3b59c38` (merge do PR #25; Planos 01–12 em produção) e no manual técnico (cap. 09 — documentos assinados, cap. 10 — IA, cap. 11 — exames enviados). As notas "**v0.5**" ao longo do texto apontam para esta seção. Escopo do Plano 13: **US-141** (parecer), **US-148** (retificar, receita e parecer), **US-149** (só a recusa com retificação em andamento), **US-150** (parte do parecer e da retificação), o que o **portal** (US-146) e a **verificação pública** (US-147) mostram do parecer, e o item à parte **P09-07**.

### Dependências conferidas no código

| Dependência | Onde está | Situação em `3b59c38` | O que o Plano 13 faz |
|---|---|---|---|
| Estados e transições (RN-140/141) | `app_documento_imutavel` (0091, refeita na 0093) | 6 estados; `assinado → substituido` com `substituido_em` já aceito; `tipo`, `versao`, `retifica_id` fixos; só `BEFORE UPDATE OR DELETE` | Conferir o INSERT da versão nova e exigir a retificação assinada na ida a `substituido` (migration custom) |
| Retificação no banco (RN-146) | `src/db/schema/documentos.ts`; 0089 | `versao` (CHECK ≥ 1), `retifica_id` com FK composta, índice único parcial `signed_documents_retificacao_aberta` | Nada a criar; usar |
| Tipo do documento | CHECK `signed_documents_tipo_valido` | Só `'receita'` | Ampliar para `'parecer'` (migration gerada) |
| Verificação pública (RN-156) | `verificacao.ts` (único acesso a `document_verifications`, `RLS_EXCEPTIONS`) | `tipo` sem CHECK, gravado `'receita'`; a consulta devolve `'Receita'` fixo; `substituido` e o texto da US-147 já existem; gatilho `verificacao_situacao` (0092) aceita `valido → substituido` | CHECK do `tipo`, gravar o tipo real, mostrar "Tipo: Parecer nutricional"; `mudarSituacao(original, 'substituido')` na assinatura da retificação |
| Código do link (RN-158) | `link-documento.ts`, `document_access_codes`, `app_codigo_acesso_regras` | Link só de documento `assinado` (política `paciente_codigo_de_assinado`, 0092); título `'Receita'` fixo | Título pelo tipo; a versão substituída cai em "não está mais disponível" sem código novo |
| Digitalizada (RN-157) e PDF no worker (regra 9) | `digitalizada.ts`, `digitalizada-job.tsx`, `documento-pdf.tsx`, `documento-pdf-job.ts` | Leem o `conteudo` como `ConteudoReceita`; `exigirHabilitacaoAtual` lê `conteudo.itens` (num parecer, `itens` não existe) | Ramo por `tipo`: o PDF do parecer em `documento-pdf.tsx` (só no worker, guarda de grafo em `exportacao.test.ts`); a habilitação só na receita |
| Assinatura (D2 = (a)) | `registrar-assinatura.ts` (sem dependência de sessão; o worker importa) | Só `digitalizada` (CHECK); 2FA em todo envio (`confirmarCodigo2fa`) | Mesmo fluxo para o parecer; a substituição da original entra no `registrarAssinatura`, sem importar nada de sessão |
| Auditoria (regra 8) | `app_enable_audit('signed_documents', 'documentos')` e notas e recibos (0090) | Escritas auditadas; `auditRead` na leitura do conteúdo e nas rotas do PDF; listas sem `auditRead` (D17 do 10A) | Nada novo no banco; a seleção de exames usa `listarExames` (já audita `exames`) |
| Anonimização | `app_anonimizar_documentos` (0091, `SECURITY INVOKER`, só `worker`); `anonimizarDocumentosDoPaciente` | Limpa `conteudo`, ponteiros, notas, códigos do link; verificação `eliminado` | Nada, salvo `exam_ids` (Q13-4) e o motivo da retificação (Q13-1), se criados |
| Exames da equipe | `exams` (`src/db/schema/pacientes.ts`), `src/modules/pacientes/exames.ts` | Sem edição; `valores` até 50 linhas; `listarExames` com `auditRead` | Fonte da cópia (RN-148/154) |
| Valores lidos com IA (Plano 11) | `aplicarSugestao` (`src/modules/ia/conferencia.ts`) | Só **acrescenta** linhas conferidas, com `iaTarefaId`, e pode trocar a `data`; a aba Exames mostra "IA · conferido em …" | É o "valor mudou" do parecer; origem na cópia pela Q13-2 |
| Exames enviados (Plano 12) | `aceitarEnvio` (`src/modules/pacientes/exames-enviados.ts`); `exam_submissions.exam_id` (`ON DELETE SET NULL`) | Exame aceito nasce **sem valores**, com o PDF limpo como laudo e o selo "Enviado pelo paciente" | Entra no parecer como "laudo no prontuário, sem valores lançados" (ou com as linhas da IA, se lidas); origem pela Q13-2 |
| Portal (US-146) | `documentosDoPaciente`, `caminhoDoPdfNoPortal`, `novosNoPortal` (`src/modules/documentos/portal.ts`) | `titulo: 'Receita'` fixo; RLS `paciente_so_emitidos` | Título pelo tipo; sem chave nova de conteúdo |
| Interruptor do admin (D20 do 10A) | `tenants.documentos_liberados` | Desligado esconde tudo (painel, portal, link) | O parecer segue o mesmo interruptor (sem interruptor novo) |

### Pontos do código fixos em "receita" (o Plano 13 generaliza)

`constantes.ts:37` (`TIPO_DOCUMENTO_ROTULO` só com `receita`); `documentos.ts:21`, `:30`, `:45`, `:89`, `:178`, `:208` (`ItemLista.tipo`, `CONTEUDO_VAZIO`, `criarReceita`, cópia e leitura como `ConteudoReceita`); `prescricao.ts:116`, `:144`; `documento-pdf.tsx:29` (`title="Receita"`); `documento-pdf-job.ts:53`; `digitalizada.ts:59` e `:61` (`exigirHabilitacaoAtual`); `digitalizada-job.tsx:92`; `registrar-assinatura.ts:75` (`tipo: 'receita'` na verificação); `verificacao.ts:13`, `:38`, `:68`; `portal.ts:20`, `:63`; `link-documento.ts:97`, `:157`; `lgpd-documentos.ts:14`, `:60`. A tela usa `TIPO_DOCUMENTO_ROTULO[d.tipo]` (`src/app/painel/pacientes/[id]/documentos/page.tsx:51`).

### Desvios e correções (spec × código)

| # | Spec até a v0.4 | Código / correção na v0.5 |
|---|---|---|
| 1 | US-141: "corrijo o exame para 15 ng/mL" | Exame não tem edição (US-015). Cenários reescritos: linhas da IA, data trocada, exame excluído |
| 2 | §10: índice único parcial da RN-146 como coisa do Plano 13 | Já existe desde a 0089 (`signed_documents_retificacao_aberta`) |
| 3 | v0.4: "o 10B numera a partir da 0094" | 0094–0103 usadas (Planos 09, 11, 12); próxima livre **0104** |
| 4 | US-147: "Tipo: Parecer nutricional" | `consultarVerificacao` devolve `'Receita'` fixo e `document_verifications.tipo` não tem CHECK |
| 5 | RN-140: gatilho cobre "todas as transições" | Não cobre o INSERT (versão nova) nem exige retificação assinada na ida a `substituido` |
| 6 | RN-141 e §10: variante A (`plataforma`) no Plano 13 | Fora pela D2 = (a) |
| 7 | US-148 sem justificativa | SBIS NGS1.12.01 pede justificativa na correção de registro finalizado (Q13-1) |
| 8 | §10: `exam_ids uuid[]` no Plano 13 | Os ids já ficam na cópia (`conteudo.exames`); a coluna só faz sentido para consulta inversa (Q13-4) |
| 9 | Fábrica do isolamento (D19 do 10A) | Cria `signed_documents` já emitido e anonimizado por INSERT direto: a conferência do INSERT (item 5) **não** pode exigir `status = 'rascunho'` — só a coerência de `versao`/`retifica_id`/`tipo` |
| 10 | Backlog `.md` | O P09-07 só existe no backlog do artifact (07/10/2026); o `.md` tem só a P10A-20 (11), sobre o mesmo sintoma no E2E — acrescentado ao `.md` nesta revisão |
| 11 | Manual técnico, cap. 11 (cabeçalho) | Diz "ainda sem merge na `main`", mas o Plano 12 entrou no PR #25 (`3b59c38`) — corrigir no fechamento do Plano 13 (guardião do manual) |

### Migrations propostas (a partir da 0104; rodar com `DATABASE_URL_MIGRATOR`, regra 7)

| Migration | Tipo | Conteúdo |
|---|---|---|
| `0104_parecer` | Gerada (`pnpm db:generate`) | CHECK `signed_documents_tipo_valido` → `('receita','parecer')`; CHECK novo `document_verifications_tipo_valido` (`'receita'`, `'parecer'`); se a Q13-4 = sim, `exam_ids uuid[]`; se a Q13-1 = sim, `signed_document_notes.motivo_retificacao` (1–500) |
| `0105_parecer_regras` | Custom (`pnpm drizzle-kit generate --custom`) | Gatilho **novo** `BEFORE INSERT` em `signed_documents` (coerência da versão: `retifica_id` nulo ⇔ `versao = 1`; com `retifica_id`, a original do mesmo `tipo`, `assinado`, sem `anonimizado_em`, e `versao` = a dela + 1); `app_documento_imutavel` refeita só no ramo `assinado → substituido` (exige `EXISTS` de retificação `assinado` com `retifica_id = OLD.id`) e, se houver `exam_ids`, na lista de colunas limpas pela anonimização; `app_anonimizar_documentos` e `app_notas_imutaveis` refeitas só se a Q13-1/Q13-4 criarem colunas. **Nenhum `DISABLE TRIGGER`** (NGS1.07.01) e nenhuma migração de dados |

Nenhuma tabela nova com `tenant_id` (regra 2: sem `app_enable_tenant_rls` novo, sem entrada nova em `FABRICAS`, `STAFF_ONLY`, `PACIENTE_ESCREVE` ou `PUBLICO_LIBERADO`); `IMUTAVEIS` do teste de isolamento continua com as três tabelas do 10A e ganha os casos novos do gatilho.

### Regras do CLAUDE.md aplicadas ao Plano 13

- **Regra 1:** toda leitura de `exams` e `signed_documents` dentro de `withTenant` (contexto `nutri` com `actorUserId` e `ip`; `worker` no PDF e na digitalizada; `paciente` no portal); nenhuma exceção nova; `document_verifications` continua só em `verificacao.ts`.
- **Regra 2:** sem tabela nova; se `motivo_retificacao` entrar, é coluna de `signed_document_notes` (já `STAFF_ONLY`, com RLS e auditoria).
- **Regra 8:** escritas já auditadas (entidade `documentos`); `auditRead` na leitura do parecer no painel e nas rotas do PDF; listas (prontuário e portal) sem `auditRead`, só tipo, data, situação, assinatura, recibos e versão (testes das chaves em `documentos.test.ts` e `portal.test.ts`).
- **Regra 9:** o PDF do parecer só no worker (`documento-pdf.tsx`/`documento-pdf-job.ts`, guarda de grafo); arquivos só por `salvarArquivo`/`apagarArquivo`, com a ordem de travas documento → tenant (`travarDocumentoAntesDaCota`) e, na retificação, original → versão nova → tenant; o laudo do exame nunca é copiado.

### Boas práticas SBIS NGS1 (Manual de Certificação v5.2) que o Plano 13 cita

| Requisito | O que pede | Como o Plano 13 atende |
|---|---|---|
| NGS1.12.01 | Correção de registro finalizado só pelo autor, em **nova versão**, com justificativa | Retificação = versão nova (`versao + 1`, `retifica_id`); a original fica intacta e "Substituído"; autor = a nutricionista do tenant (B-01); justificativa pela Q13-1 |
| NGS1.12.02 | A versão nova pode reaproveitar a atual como base | O rascunho da retificação nasce com o conteúdo da versão em vigor |
| NGS1.12.03 | Inativar com justificativa em vez de apagar | "Cancelar documento" com motivo (US-149, 10A); emitido nunca é apagado (gatilho) |
| NGS1.07.01 | Auditoria contínua, sem desligar | Nenhuma migration do Plano 13 usa `DISABLE TRIGGER` |
| NGS1.07.03 | Trilha de criação, consulta e alteração do RES | Gatilho `audit_row_change` + `auditRead` (painel, portal, link, PDF, exames) |
| NGS1.07.06 | Sem dado clínico na trilha | `audit_log` só guarda ação, entidade, id, paciente, ator, IP e hora |
| NGS1.01.01 | Versão identificada | Versão do documento impressa no PDF da retificação e na exportação (`versao`, `retificaCodigo`) |
| Integridade (CS-141) | Documento assinado imutável e conferível | SHA-256 do PDF na verificação pública; código próprio por versão; a original substituída continua conferível ("Documento substituído — …") |

Para depois do 10B (NGS2, assinatura digital ICP-Brasil, só referência): NGS2.02.04 (ver o que será assinado — o PDF preparado baixável), NGS2.02.05/06 (pendência de assinatura — o cartão "Documentos aguardando assinatura"), NGS2.02.09 (indicar assinado, quem e quando) e NGS2.06.03 (exportar o assinado validável fora do sistema — o PDF no ZIP).

### Perguntas que sobram ao dono (Plano 13)

| ID | Pergunta | Opções | Recomendação |
|---|---|---|---|
| Q13-1 | A retificação pede **motivo**? | (a) sim, "Motivo da retificação" obrigatório (1–500), em `signed_document_notes` (só a equipe, como o motivo de cancelamento), na exportação da equipe e fora da do titular · (b) não (US-148 como está) | **(a)**: é o que a SBIS NGS1.12.01 pede; texto proposto "Escreva o motivo da retificação (até 500 caracteres)." |
| Q13-2 | O parecer mostra a **origem** dos valores (IA conferida, enviado pelo paciente)? | (a) só na cópia guardada (prontuário e exportação), não no PDF · (b) também no PDF, como nota por linha | **(a)**: os valores foram conferidos pela nutricionista e o parecer é dela (D7: sem IA nos documentos); reabrir se o CRN-3 ou a Res. CFN 856/2026, art. 37, pedirem (P-B11) |
| Q13-3 | Na substituição, um ou dois e-mails ao paciente? | (a) só o "Você tem um novo documento" da versão nova · (b) esse + "Um documento seu foi atualizado" | **(a)** (D11 atendida pelo e-mail da versão nova) |
| Q13-4 | Criar a coluna `exam_ids` (§10)? | (a) não — os ids ficam na cópia (`conteudo.exames`) · (b) sim, para a aba Exames mostrar "citado em parecer" | **(a)** (YAGNI; (b) só se a Debby pedir o aviso na aba Exames) |
| Q13-5 | Versão visível ao paciente? | (a) "Versão 2" no portal e "Versão {n} — substitui o documento {código}" no PDF · (b) só no painel | **(a)** (o paciente e a farmácia distinguem a vigente) |

### Item à parte do Plano 13: P09-07 — paginação e busca da lista de consultórios no `/admin`

Achado da integração da T14 do Plano 11 (07/10/2026), registrado no backlog do artifact (S, "a fazer"): `/admin` carrega **todos** os consultórios de uma vez — com ~220 consultórios de teste no banco de dev, o HTML passa de 1,8 MB e a tela leva ~11 s; sem impacto hoje em produção (poucos consultórios). No código: `src/app/admin/page.tsx` chama, juntos, `listarContas()` (`src/modules/plataforma/contas.ts:140`, `tenants` + `user` + `account` + `invites`, `order by t.created_at desc`, sem `limit`) e as quatro métricas por consultório (`metricasPorTenant`, `metricasDeSucessoPorTenant`, `metricasDeIaPorTenant`, `metricasDeExamesEnviadosPorTenant`, funções `admin_metricas_*` sobre todos os tenants) e desenha uma linha por conta. Mesmo sintoma da P10A-20 (11) (`plataforma.spec.ts:75` instável sob carga). **Escopo proposto:** paginação por cursor (`created_at desc`, `id`), 50 por página, com "Anterior"/"Próxima" por `searchParams`; busca por nome de exibição, slug ou e-mail (só as tabelas que o admin já lê, sem nenhuma tabela 🔒 — guarda `sem-tabelas-tenant.test.ts`); as métricas só dos consultórios da página (parâmetro de ids nas funções `admin_metricas_*`, migration própria, ou filtro do mapa já pronto — decidir no plano); E2E do `/admin` com a busca; axe da página. Sem dado de saúde, sem mudança de RLS; o admin continua sem ler tabela com `tenant_id` de saúde.

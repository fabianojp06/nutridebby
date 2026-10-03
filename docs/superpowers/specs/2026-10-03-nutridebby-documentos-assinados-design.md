# NutriDebby — Documentos assinados: parecer nutricional (F3-05) e receita de suplementos e fitoterápicos (F3-06) — Especificação (Design)

| Item | Valor |
|---|---|
| Versão | 0.2 (rascunho para revisão do dono) |
| Data | 2026-10-03 |
| Revisão 0.2 | Revisão do workflow aplicada: Res. CFN nº 760/2023 (telenutrição, art. 10: assinatura eletrônica **e/ou código verificador**, "preferencialmente" avançada ou qualificada; confirmação de recebimento) na §3.4, com a D2 reaberta e a lacuna do plano alimentar online registrada (P-B10, D12); art. 14 da Lei 14.063 lido como suficiência, não exigência; § 2º do art. 3º da Res. 680 (redação da 731/2022) na §3.3 (D13); Res. CFN nº 856/2026 ao lado da 599/2018 (RN-151 como decisão de produto, D14; art. 37 na D7); imutabilidade × `apagarArquivo` com ordem de operações e FK sem `SET NULL` (RN-140); justificativa e motivo de cancelamento fora do alcance do paciente **no banco** (tabela `STAFF_ONLY`, D15) e exportação do titular separada; limites da atualização incremental do PDF assinado e regra explícita da digitalizada (RN-144, RN-157); 2FA e nome do titular do certificado no primeiro uso (RN-145); US-151 alinhada ao subprojeto A (D7). Pontos menores na seção "Pontos menores (backlog)" |
| Status | **Em revisão**: só vale depois que o dono responder às "Decisões pendentes do dono" (fim do documento) |
| Subprojeto | B do escopo novo (backlog F3-05 e F3-06, confirmados pelo dono em 03/10/2026) |
| Quando | **Só depois do go-live** (Plano 08). Depende do portal do paciente (Plano 06) para a entrega |
| Base | Spec do MVP [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) v1.8 e histórias [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md). IDs de RN, RNF, INT, US e tabelas sem o prefixo desta spec se referem àqueles documentos |
| Faixa de IDs | Histórias **US-140 a US-159**, regras **RN-140 a RN-159**, requisitos **RNF-140 a RNF-149**, integração **INT-B1**, pendências **P-B1 a P-B11**, critérios **CS-140 a CS-143** (faixa reservada a este subprojeto para não colidir com os outros subprojetos do escopo novo) |
| Relação com a IA (subprojeto A) | **Opcional.** Só a US-151 (rascunho do parecer com IA) usaria a base de IA de [`2026-10-03-nutridebby-ia-nutricionista-design.md`](2026-10-03-nutridebby-ia-nutricionista-design.md) (provedor, cota, pré-condições da RN-100 e pseudonimização de lá), e ela **conflita com o escopo atual de A** (A põe fora a interpretação de exames pela IA): a recomendação da D7 é cortá-la desta spec. Nada mais aqui depende de A. Faixas de IDs sem sobreposição (A usa 100–129) |

---

## 1. Visão

A nutricionista emite, dentro do prontuário, dois documentos com validade profissional:

1. **Parecer nutricional** sobre os exames do paciente (F3-05): a leitura, do ponto de vista nutricional, dos marcadores lançados em Exames (US-015), com a conduta e os encaminhamentos — **sem diagnóstico de doença**.
2. **Receita** de suplementos alimentares e de fitoterápicos (F3-06), dentro do que o CFN permite ao nutricionista — **nunca medicamento sujeito a prescrição médica**.

Os dois nascem de uma **base comum de "documento assinado"**: rascunho editável → PDF com a marca gerado no worker → assinatura → documento **imutável**, com **código de verificação e QR code**, **impressão digital (SHA-256)** do arquivo, **retificação** por nova versão e **cancelamento**. O paciente recebe um **e-mail sem dado de saúde** e abre o documento no **portal** (Plano 06); qualquer pessoa com o código (o paciente, uma farmácia de manipulação) confere a autenticidade numa **página pública que não mostra dado de saúde**.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-140 | Nos 30 dias seguintes à entrega, **100% das receitas de suplementos e fitoterápicos** da Debby saem pelo sistema | Confirmação da Debby + contagem de `signed_documents` com `tipo = 'receita'` e `status = 'assinado'` |
| CS-141 | **Nenhum** documento assinado muda depois da assinatura | Teste automatizado do gatilho de imutabilidade (RN-140), inclusive pelos caminhos de apagar arquivo e anonimizar + SHA-256 da página de verificação igual ao do arquivo guardado |
| CS-142 | **≥ 80%** dos documentos entregues têm o recebimento confirmado pelo paciente em até 7 dias | `recebido_em − entregue_em ≤ 7 dias` / documentos entregues no mês |
| CS-143 | Custo recorrente extra para o dono = **R$ 0** (na recomendação da D1) | Fatura dos serviços externos |

### 1.2 Premissas

| # | Premissa | Origem |
|---|---|---|
| B-01 | Um tenant = uma nutricionista (D-10 do MVP: sem recepcionista). O perfil profissional fica no tenant; se a Fase 2 trouxer mais de uma nutricionista por tenant, o perfil vira por usuário | Spec do MVP |
| B-02 | Somente pacientes adultos (D-11, RN-17) | Spec do MVP |
| B-03 | Nenhum custo extra além do que o dono aceitar explicitamente (a assinatura é a principal fonte possível de custo, D1) | Dono |
| B-04 | O conteúdo técnico (doses, interações, limites de ingestão) é **responsabilidade profissional da nutricionista**; o sistema registra, formata, trava e entrega, mas não valida a conduta | Res. CFN 656/2020, art. 4º (responsabilidade ética, civil e criminal) |
| B-05 | Esta spec **não** cria nada de loja (F4-01). Ver §3.5 | Dono (03/10/2026) |

---

## 2. Escopo

### 2.1 Dentro do escopo

| ID | Bloco | Conteúdo |
|---|---|---|
| B1 | **Base de documento assinado** | Perfil profissional para documentos (nome completo, CRN, contato, habilitação em fitoterapia); estados e travas; PDF com a marca no worker; código de verificação + QR; SHA-256; assinatura (tipo conforme D1); retificação; cancelamento; entrega por e-mail neutro + portal; confirmação de recebimento; página pública de verificação; auditoria, exportação, bloqueio e anonimização (LGPD) |
| B2 | **Parecer nutricional (F3-05)** | Sobre exames já lançados (US-015): escolha dos exames, cópia congelada dos valores, avaliação nutricional, conduta, encaminhamentos, ressalva fixa; declaração de que não há diagnóstico de doença |
| B3 | **Receita (F3-06)** | Suplementos alimentares (Res. CFN 656/2020), plantas medicinais e drogas vegetais em chá (todas as nutricionistas), drogas e derivados vegetais em forma farmacêutica classificados como alimento ou suplemento (todas, Res. 680, art. 3º, § 2º, redação da 731/2022; forma na D13) e fitoterápicos em forma farmacêutica / magistrais (só com habilitação, Res. CFN 680/2021); campos obrigatórios das resoluções; justificativa de uso no prontuário, fora do alcance do paciente no banco (D15) |
| B4 | **Rascunho com IA (opcional)** | Botão para pedir à IA do subprojeto A um rascunho do texto do parecer, sempre revisado pela nutricionista (US-151). **Recomendação da D7: cortar desta spec**, porque conflita com o escopo de A (interpretação de exame pela IA) |

### 2.2 Fora do escopo

Checagem automática de dose máxima (UL), interações nutriente × fármaco × planta e contraindicações (responsabilidade da nutricionista, B-04) · catálogo de suplementos ou de plantas · campo de marca, fabricante, farmácia ou loja (decisão de produto, RN-151 e D14; a norma permite citar marca com mais de uma opção) · integração com farmácias · receita de medicamento de qualquer tipo · atestado, declaração de comparecimento e relatório para convênio (outros documentos; a base serve a eles depois, se o dono quiser) · assinatura e confirmação de recebimento do **plano alimentar** entregue em telenutrição — **lacuna de conformidade do MVP registrada**, não resolvida aqui sem decisão do dono (Res. CFN 760/2023, art. 10; P-B10, D12) · assinatura em lote · assinatura pelo paciente · validação de revogação do certificado (OCSP/LCR) — a página de verificação aponta para o validador oficial do ITI (RN-144) · integração por API com prestador de assinatura em nuvem (custo; só se o dono escolher a opção D da D1) · loja (F4-01).

---

## 3. Enquadramento normativo (o que a nutricionista pode e não pode)

> As normas abaixo foram conferidas no texto publicado pelo CFN ou em fonte oficial, salvo onde está escrito **"a confirmar"**. Esta seção não substitui a consulta ao CRN-3 nem ao advogado (P-B1, P-B3).

### 3.1 Parecer nutricional sobre exames

| Pode (com fundamento) | Não pode |
|---|---|
| Solicitar e avaliar exames laboratoriais "necessários à avaliação, à prescrição e à evolução nutricional" (Res. CFN 306/2003, art. 1º; Lei 8.234/1991; Res. CFN 600/2018, Anexo, D.2.1) | Afirmar **diagnóstico nosológico** (doença): "anemia ferropriva", "diabetes", "hipotireoidismo". O inciso I do art. 4º da Lei 12.842/2013 (diagnóstico nosológico privativo do médico) foi **vetado**, mas o § 1º define diagnóstico nosológico e o CFM o trata como exclusivo; a posição segura é **não afirmar doença** |
| Fazer o **diagnóstico de nutrição**: "identificação e determinação do estado nutricional do cliente/paciente/usuário" (Res. CFN 600/2018, Anexo I, item XXXII) — p. ex. "marcadores compatíveis com baixa reserva de ferro; consumo alimentar de ferro abaixo da recomendação" | Prescrever, suspender ou ajustar **medicamento** |
| Considerar "diagnósticos, laudos e pareceres dos demais membros da equipe" e definir a conduta com eles (Res. CFN 656/2020, art. 3º, III; Res. CFN 306/2003, art. 2º, parágrafo único) | Contradizer conduta médica sem diálogo (cabe **encaminhar**) |
| Registrar conduta dietética, orientação e **encaminhamento** ("sugiro avaliação médica para…") | Usar o parecer como laudo de exame (quem emite laudo é o laboratório) |

Consequências no produto: título fixo **"Parecer nutricional"**, ressalva fixa impressa (texto na D5), campo próprio de **encaminhamentos** e **declaração** da nutricionista antes de preparar para assinatura (RN-148). O sistema **não** filtra palavras: a responsabilidade é da profissional (B-04).

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
| **Consequência no produto** | O item "Suplemento alimentar" sozinho não tem os campos do art. 12, I; por isso o produto vegetal do § 2º precisa de um tipo próprio liberado para todas **ou** de campos botânicos opcionais no suplemento (categoria "Derivado vegetal") — **D13**, com a Debby | — |
| **Campos do receituário** | Nomenclatura botânica (nome popular opcional); parte utilizada; forma de utilização e modo de preparo (chás); forma/meio de extração, padronização do marcador (quando houver na literatura) e forma farmacêutica (formulados); via e posologia; data; dados do paciente e da nutricionista (nome completo, CRN, e-mail e telefone); carimbo e assinatura; entrega pessoal ou eletrônica "(digitalizado ou com assinatura digital certificada)… **com confirmação de recebimento**"; registro em prontuário | Art. 12 |

### 3.4 Assinatura eletrônica — análise para a D1

**Normas:** MP 2.200-2/2001, art. 10, § 1º (documento assinado com certificado **ICP-Brasil** presume-se verdadeiro em relação ao signatário) e § 2º (outros meios de comprovação de autoria e integridade valem se **admitidos pelas partes ou aceitos pela pessoa a quem forem opostos**). Lei 14.063/2020, art. 4º: **simples** (identifica o signatário), **avançada** (certificado não ICP-Brasil ou outro meio admitido pelas partes, ligada ao signatário de forma unívoca, sob seu controle exclusivo e com **qualquer modificação posterior detectável**) e **qualificada** (certificado ICP-Brasil). Para a saúde, a lei exige **qualificada** só para receita de medicamento sob controle especial e atestado médico (art. 13) e declara válidos "para todos os fins" os demais documentos eletrônicos de profissionais de saúde assinados com **avançada ou qualificada** (art. 14) — redação dos arts. 13 e 14 conferida em fontes secundárias; **conferir no Planalto** (o site oficial não respondeu nas duas pesquisas). **Leitura correta do art. 14:** é cláusula de **suficiência** — documentos de saúde com avançada ou qualificada têm presunção de validade "para todos os fins"; a lei **não proíbe** a assinatura simples nesses documentos. A **exigência** de qualificada (art. 13) vale só para receita de medicamento sob controle especial e atestado médico, que não são documentos da nutricionista. Logo: **avançada ou qualificada dão presunção de validade (art. 14); a simples não é proibida para o parecer, mas tem prova mais fraca** (vale se admitida pelas partes, MP 2.200-2, art. 10, § 2º).

**Exigências do CFN — dois grupos de normas:**

| Norma | Alcance | O que exige | Texto |
|---|---|---|---|
| **Res. CFN 760/2023** (telenutrição; DOU de 24/10/2023; revogou a Res. 666/2020, art. 17) | "As informações e os documentos produzidos a partir do atendimento e/ou da prestação de serviços em alimentação e nutrição por meio da Telenutrição" — **todos** os documentos da consulta online (parecer, receita, plano alimentar, orientações) | Art. 10: I — datados e identificados (cliente e nutricionista: nome completo, CRN, e-mail e telefone); II — "assinados eletronicamente **e/ou com código verificador da autenticidade do documento**, em consonância com a Lei n° 14.063 […], sendo, **preferencialmente**, assinatura eletrônica avançada ou qualificada"; III — "enviados eletronicamente ou de qualquer outra forma que tenha sido acordada com o cliente, desde que tenha a **confirmação de recebimento**"; IV — registrados em prontuário | Conferido em fonte secundária (LegisMap); DOU **a conferir** (o site da Imprensa Nacional não respondeu) |
| **Res. CFN 656/2020** (parágrafo único-A, redação da 731/2022) e **Res. CFN 680/2021** (art. 12, IV) | Só a **receita** (suplementos e fitoterapia), presencial ou online | Entrega eletrônica "**digitalizado ou com assinatura digital certificada**", com confirmação de recebimento | Conferido no site do CFN |

Leitura: para o **parecer**, a norma específica é a 760/2023 (quando a consulta é online) — assinatura eletrônica com código verificador basta, e avançada/qualificada é **preferencial**, não obrigatória; para o parecer de consulta presencial não há norma do CFN de forma, só a Lei 14.063. Para a **receita**, as Res. 656/680 continuam pedindo "digitalizado ou com assinatura digital certificada"; "certificada" sugere **certificado digital**. Como a 760/2023 (mais nova e geral para telenutrição) convive com o "assinatura digital certificada" das Res. 656/680 (específicas da receita), e se o gov.br (certificado do ITI fora da ICP-Brasil) atende essa expressão, é **a confirmar com o CRN-3** (P-B1).

| Opção | O que é | Nível (Lei 14.063) | Receita: atende o "assinatura digital certificada" (656/680)? | Parecer e demais documentos: atende a 760/2023? | Custo | Atrito para a nutricionista | Integração no NutriDebby |
|---|---|---|---|---|---|---|---|
| **A. Assinatura na plataforma + código de verificação** | Senha + código do 2FA no momento de assinar; o sistema registra quem, quando, IP e o SHA-256; o PDF sai com código verificador e QR | Simples, ou avançada **discutível** (depende de ser "admitida pelas partes"; a farmácia é terceiro) | **Provavelmente não** | **Sim, pelo texto** ("assinados eletronicamente e/ou com código verificador"); não é a forma "preferencial" | R$ 0 | **Baixo** (um clique + código do 2FA) | Simples (tudo dentro do sistema) |
| **B. gov.br** | A nutricionista baixa o PDF, assina em `assinador.iti.br` com a conta gov.br prata ou ouro e envia o PDF assinado de volta | Avançada | **A confirmar** (P-B1) | Sim (preferencial) | R$ 0 (gratuito; certificado gov.br de 1 ano, renovado sem custo) | **Alto** (baixar, assinar no site do ITI, reenviar) | Upload do PDF assinado + conferência no servidor (RN-144). API do gov.br para sistemas privados **não confirmada** (o ITI fala em "aplicações públicas") |
| **C. ICP-Brasil da nutricionista** | e-CPF A1/A3 ou em nuvem da própria nutricionista; assina o PDF fora do sistema (Adobe, assinador do ITI, app do certificado) e envia | **Qualificada** | **Sim** | Sim (preferencial) | R$ 0 para o dono; a nutricionista paga o certificado (faixa de mercado ~R$ 160–240/ano para e-CPF A1, **a confirmar**) | **Alto** (igual à B) | Igual à B (mesmo upload e conferência) |
| **D. ICP-Brasil em nuvem integrada** | O sistema chama a API de um prestador de assinatura em nuvem (PSC) e a nutricionista autoriza no celular, sem baixar/enviar | Qualificada | Sim | Sim (preferencial) | **Custo por assinatura ou contrato com o PSC** (custo extra do dono) + certificado em nuvem da nutricionista | Médio | Integração por API, contrato, homologação |
| **E. Digitalizada** | Imprime, assina à mão, digitaliza e envia | — (cópia de documento físico) | **Sim** ("digitalizado" está no texto do CFN) | Sim, com o código verificador do sistema | R$ 0 | Alto (imprimir e digitalizar) | Upload **sem conferência de conteúdo nem de assinatura** (RN-157): só código, QR e SHA-256 do arquivo enviado |

**Força de prova:** C e D (qualificada) > B (avançada) > A (simples/avançada discutível, mas com trilha de auditoria, 2FA e código verificador) > E (cópia digitalizada, sem vínculo técnico entre o arquivo e o conteúdo preparado).

**Recomendação (D1 — receita):** aceitar **B e C pelo mesmo fluxo** (baixar PDF → assinar fora → enviar PDF assinado; o servidor confere a assinatura PAdES), com custo zero para o dono; **E** como alternativa para quem não tem gov.br prata/ouro nem certificado, sabendo que o sistema não confere o conteúdo dela (RN-157); **não** oferecer A para receita; **D** só se houver demanda e o dono aceitar o custo. Se o CRN-3 responder que o gov.br não atende, a receita passa a aceitar só C e E, sem mudar o fluxo. **Parecer:** escolha própria na **D2** (A é alternativa real pela 760/2023).

### 3.5 Relação com a loja (F4-01)

**Normas de ética e a data de vigência.** Hoje vale o Código de Ética da **Res. CFN 599/2018**; o novo Código, **Res. CFN 856/2026** (DOU de 28/04/2026), revoga a 599 e entra em vigor em **23/01/2027** (prorrogação da vacância por resolução do CFN de 20/07/2026, **número e texto a confirmar no DOU**, como nas specs de A e da loja). Este subprojeto só é implementado depois do go-live, provavelmente já sob a 856/2026; o texto dela ainda pode mudar (consulta pública de 2026). Por isso as duas são citadas:

| Tema | Res. CFN 599/2018 (vigente até a 856) | Res. CFN 856/2026 (a partir de 23/01/2027, texto publicado) |
|---|---|---|
| Marca na prescrição | Art. 60: vedado indicar ou manifestar preferência por marcas "de modo a não direcionar escolhas"; **inciso III**: havendo necessidade de mencionar marcas na prescrição dietética, "deverá apresentar mais de uma opção, quando disponível"; sem outra opção equivalente, "é permitido indicar o único existente" | Art. 74, caput (vedação de prescrever, indicar ou manifestar preferência por marcas de suplementos, fitoterápicos, farmácias etc.) e **inciso III** (na prescrição dietética, múltiplas opções de marcas quando disponíveis); parágrafo único: venda casada proibida |
| Venda e propaganda do que indica | Arts. 60 a 63 | Arts. 60, 63, 74 a 77 (ver a nota de viabilidade da loja) |
| Uso de IA | — | Art. 37: "Nas comunicações, materiais ou pesquisas produzidos com suporte de IA ou de automação, a(o) nutricionista deverá indicar que houve uso de ferramentas automatizadas…" (pesa na D7) |

Também a Res. CFN 680/2021, art. 9º, III, proíbe vender, comercializar e fazer propaganda dos fitoterápicos que ela indica. As normas **permitem** citar marca na receita com mais de uma opção; a ausência do campo de marca é **decisão de produto** (RN-151, D14), alinhada ao art. 74 da 856/2026, e não uma proibição literal. Este subprojeto não tem nenhum ponto de contato com a F4-01. Do ponto de vista destas normas, manter a loja como **produto separado**, sem ligação com prontuário e receita, reduz o risco ético para a nutricionista — o que reforça a decisão do dono de tratá-la como outro projeto (nota de viabilidade [`2026-10-03-nutridebby-loja-viabilidade.md`](2026-10-03-nutridebby-loja-viabilidade.md), P-L4 atendida por esta revisão).

---

## 4. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** | Criar, editar e apagar rascunhos; preparar para assinatura; enviar o PDF assinado; retificar; cancelar; ver tudo dos documentos do próprio tenant | Alterar ou apagar documento assinado; prescrever fitoterápico formulado sem habilitação registrada no perfil (RN-150) |
| **Paciente** (portal, Plano 06) | Ver e baixar os **próprios** documentos assinados, substituídos ou cancelados; confirmar o recebimento | Ver rascunhos, documentos em preparo e documentos de outro paciente — garantido **no banco** (política `paciente_so_emitidos`), não só na API; ver a justificativa de uso e o motivo de cancelamento — também no banco, pela tabela `STAFF_ONLY` `signed_document_notes` (§10), salvo o que a D15 liberar (recomendação: a justificativa só na exportação do titular) |
| **Admin da plataforma** | Nada nos documentos (regra do MVP: nunca lê dado de saúde) | Ler, contar por paciente ou baixar documentos |
| **Visitante da verificação** (paciente, farmácia, qualquer um com o código) | Ver situação, tipo, data, nutricionista e CRN, o nome do titular do certificado que assinou e o SHA-256 | Ver nome do paciente, conteúdo, exames ou itens da receita |

---

## 5. Fluxo e estados

```
            "Novo parecer" / "Nova receita" / "Retificar"
                              │
                              ▼
   ┌──────────────► rascunho ──── "Apagar rascunho" ──► (apagado)
   │                   │
   │  "Voltar a        │ "Preparar para assinatura" (declaração + perfil completo)
   │   editar"         ▼        congela o conteúdo, gera o código
   ├──────────────── preparando ── worker: PDF com a marca, código e QR ──┐
   │                   │                                                  │ falhou → "Gerar o PDF de novo"
   │                   ▼                                                  │
   └──────────── aguardando_assinatura ◄──────────────────────────────────┘
                       │  "Enviar PDF assinado" (B/C/E) — conferência síncrona (RN-144)
                       ▼
                   assinado ──► entrega: portal + e-mail neutro (+ push neutro)
                    │    │                └─► recebido_em (confirmação do paciente)
       "Retificar" ─┘    └─ "Cancelar documento" ──► cancelado
       (nova versão assinada)
                    ▼
                substituido
```

- Do `preparando` em diante o **conteúdo não muda** (gatilho no banco, RN-140). "Voltar a editar" só existe antes da assinatura: descarta o código, solta o PDF base e volta a `rascunho`, na ordem da RN-140.
- A linha pública de verificação (`document_verifications`) nasce **só na assinatura**; o código impresso num PDF que nunca foi assinado não existe na verificação.
- Variante se o dono escolher a opção A (D2, parecer; ou D1): para aquele tipo, `aguardando_assinatura` some; "Assinar" pede senha e código do 2FA (registro de quem, quando e IP), e o worker gera o PDF final e leva a linha a `assinado` com `assinatura_tipo = 'plataforma'` no `registrar` do `salvarArquivo` (a CHECK do PDF preenchido continua valendo); o PDF traz o bloco "Assinado eletronicamente por {nome completo} em dd/mm/aaaa às hh:mm, com código de verificação" (o SHA-256 é o do PDF gerado). Textos dessa variante entram no plano se a opção for escolhida.

### 5.1 Organização do código

Módulo novo `src/modules/documentos/` (padrão do MVP: funções de domínio em vários arquivos): `documentos.ts` (rascunho, estados, retificar, cancelar), `parecer.ts` e `receita.ts` (esquemas Zod do conteúdo e validação), `perfil-profissional.ts`, `assinatura-pades.ts` (conferência do PDF assinado, sem parser completo de PDF), `verificacao.ts` (único acesso a `document_verifications`), `documento-pdf.tsx` + `documento-pdf-job.ts` (**só o worker importa**: `@react-pdf/renderer` e `qrcode`), `entrega.ts` (e-mail e push). Rotas: `/painel/pacientes/[id]/documentos/…`, `/p/documentos` (portal), `/v/[codigo]` (verificação pública), `GET /api/painel/documentos/[id]/estado` (acompanhamento do PDF, sem auditoria, como o do plano alimentar).

---

## 6. Histórias de usuário

**Prioridade:** **M** = obrigatória para entregar F3-05/F3-06 · **S** = pode ficar para depois. A Definition of Done do MVP vale para todas (RLS + teste de isolamento, auditoria, Zod, axe no portal, nada de dado de saúde em log/Sentry).

### US-140 — Perfil profissional para documentos · **M**

**Como** nutricionista, **quero** completar meus dados profissionais, **para que** saiam no carimbo dos documentos como o CFN exige.

| Campo | Obrig. | Validação | Erro |
|---|---|---|---|
| `nome_profissional` (nome completo) | Sim | 5–120 caracteres | "Informe seu nome completo (5 a 120 caracteres)" |
| `crn` (já existe) | Sim | `CRN_REGEX` do MVP (ex.: CRN-3 12345); a jurisdição é o número da região | "CRN inválido. Ex.: CRN-3 12345" |
| `contato_email` | Sim | e-mail válido | "Informe um e-mail profissional válido" |
| `contato_telefone` | Sim | E.164 (exibido `(11) 91234-5678`) | "Informe um telefone válido com DDD" |
| `endereco_consultorio` (já existe) | Não | até 500 caracteres | (texto do MVP) |
| Habilitação em Fitoterapia | Não | caixa + "Registro da habilitação no CRN" (até 60 caracteres) obrigatório se a caixa estiver marcada | "Informe o registro da sua habilitação em Fitoterapia no CRN" |

```gherkin
Cenário: Perfil incompleto bloqueia a preparação
  Dado que meu perfil não tem "nome completo"
  Quando clico em "Preparar para assinatura"
  Então vejo "Complete seu perfil profissional (nome completo, CRN e contato) antes de preparar documentos."
  E o link "Completar perfil" leva a Configurações > Perfil profissional

Cenário: Declarar habilitação em Fitoterapia
  Quando marco "Tenho habilitação em Fitoterapia registrada no CRN (Resolução CFN nº 680/2021)"
  E informo o registro "CRN-3 nº 1234/2024"
  E confirmo "Declaro, sob minha responsabilidade, que a habilitação está registrada no CRN."
  Então vejo "Habilitação em Fitoterapia registrada no perfil."
  E a data da declaração fica gravada

Cenário: Mudar o perfil não altera documentos já preparados
  Dado um documento em "Aguardando assinatura" com o telefone antigo
  Quando altero o telefone do perfil
  Então o PDF já preparado continua com o telefone antigo
```

Nota: a forma de comprovar a habilitação (autodeclaração ou comprovante revisado) é a **D6**.

### US-141 — Redigir parecer nutricional sobre exames · **M**

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
  Dado um parecer em "Rascunho" com "Ferritina = 12 ng/mL"
  Quando corrijo o exame para 15 ng/mL e salvo o rascunho do parecer
  Então o parecer passa a mostrar 15 ng/mL (a cópia é refeita a cada salvamento do rascunho)

Cenário: Valores congelados antes da assinatura
  Dado um parecer em "Aguardando assinatura" com "Ferritina = 12 ng/mL"
  Quando corrijo o exame para 15 ng/mL
  Então o parecer continua com 12 ng/mL
  E na tela do parecer aparece "Os valores deste exame mudaram depois do parecer." com o botão "Voltar a editar"

Cenário: Valores congelados depois da assinatura
  Dado um parecer "Assinado" com "Ferritina = 12 ng/mL"
  Quando corrijo o exame para 15 ng/mL
  Então o parecer continua com 12 ng/mL
  E na tela do parecer aparece "Os valores deste exame mudaram depois do parecer." com o link "Retificar"

Cenário: Paciente bloqueado
  Dado um paciente com pedido de exclusão atendido
  Quando tento criar um parecer
  Então vejo "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."
```

### US-142 — Redigir receita de suplementos e fitoterápicos · **M**

**Como** nutricionista, **quero** montar a receita com os campos que o CFN exige, **para** entregá-la ao paciente com segurança.

Cada receita tem **1 a 20 itens**. O tipo do item define os campos (RN-149, RN-150):

| Tipo do item (rótulo exato) | Campos obrigatórios | Opcionais |
|---|---|---|
| "Suplemento alimentar" | Categoria ("Nutriente", "Enzima", "Probiótico", "Outro"); composição (1–10 componentes: nome 1–120, quantidade > 0, unidade ∈ g, mg, mcg, UI, U, UFC, mL); forma de apresentação (até 60); via ∈ "Oral", "Sublingual", "Enteral (sonda)"; posologia (1–300) | Duração (até 100); "Manipulado" (sim/não) |
| "Planta medicinal ou droga vegetal (chá)" | Nomenclatura botânica (2–120); parte utilizada (1–60); modo de preparo ∈ "Infusão", "Decocção", "Maceração em água"; forma de utilização e preparo (1–300); posologia (1–300) | Nome popular (até 60); duração |
| "Droga ou derivado vegetal classificado como alimento ou suplemento" — **todas** (Res. 680, art. 3º, § 2º; **forma conforme a D13**: este tipo próprio, recomendado, ou a categoria "Derivado vegetal" do suplemento com os mesmos campos) | Nomenclatura botânica (2–120); parte utilizada (1–60); forma farmacêutica (1–60); dose (1–120); via ∈ "Oral", "Sublingual", "Enteral (sonda)"; posologia (1–300) | Padronização do marcador (até 120); forma ou meio de extração (até 120); nome popular; duração |
| "Fitoterápico (forma farmacêutica ou fórmula magistral)" — **só com habilitação** | Nomenclatura botânica; parte utilizada; forma ou meio de extração (1–120); forma farmacêutica (1–60); dose (1–120); via; posologia | Padronização do marcador (até 120); nome popular; duração |

Campos da receita: "Orientações gerais" (opcional, até 2000, vai no PDF) e **"Justificativa de uso"** (obrigatória, até 2000; **fica só no prontuário**, não vai no PDF — Res. 656, art. 3º, XII; guardada em `signed_document_notes`, fora do alcance da sessão de paciente se a D15 mantiver a recomendação). A justificativa segue a mesma trava do conteúdo: não muda a partir de `preparando` (RN-140).

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
```

### US-143 — Preparar para assinatura · **M**

**Como** nutricionista, **quero** gerar o PDF final com a minha marca, **para** assiná-lo.

```gherkin
Cenário: Preparar
  Dado um rascunho válido e o perfil profissional completo
  Quando clico em "Preparar para assinatura"
  Então vejo a declaração do tipo do documento (texto na D5) com a caixa obrigatória
  E, sem marcar a caixa: "Confirme a declaração para continuar."
  Quando marco e confirmo
  Então a situação vira "Preparando o PDF" e depois "Aguardando assinatura"
  E vejo "Baixar PDF para assinar" e a instrução "Assine o PDF no assinador do gov.br (assinador.iti.br) ou com o seu certificado ICP-Brasil e envie o arquivo assinado aqui."

Cenário: Conteúdo do PDF
  Então o PDF tem logo e cor do consultório, o título do documento, nome do paciente, data de emissão, o conteúdo, o carimbo "{nome completo} · Nutricionista · {CRN} · {e-mail} · {telefone}" (+ endereço, se houver)
  E o rodapé "Código de verificação: XXXX-XXXX-XXXX · Verifique em {APP_URL}/v/XXXXXXXXXXXX" com o QR code do mesmo endereço
  E a receita não traz a justificativa de uso

Cenário: Voltar a editar
  Dado um documento em "Aguardando assinatura"
  Quando clico em "Voltar a editar" e confirmo "O PDF preparado será descartado. Continuar?"
  Então o documento volta a "Rascunho" e o código anterior deixa de existir

Cenário: Falha do PDF
  Dado que o worker não conseguiu gerar o PDF
  Então vejo "Não foi possível gerar o PDF. Tente de novo." e o botão "Gerar o PDF de novo"
```

### US-144 — Enviar o PDF assinado · **M**

**Como** nutricionista, **quero** enviar o PDF que assinei no gov.br ou com meu certificado, **para** concluir o documento.

```gherkin
Cenário: Assinatura aceita
  Dado um documento em "Aguardando assinatura"
  Quando envio o PDF baixado e assinado no gov.br
  Então vejo "Documento assinado."
  E a situação vira "Assinado" com "Assinado em dd/mm/aaaa às hh:mm" e o tipo "gov.br" (ou "Certificado ICP-Brasil")
  E o PDF preparado (sem assinatura) é apagado

Cenário: Primeiro certificado usado
  Dado que é a primeira assinatura do consultório
  E o nome do titular do certificado confere com o meu nome completo do perfil (sem acento e sem diferença de maiúsculas)
  Quando envio o PDF assinado
  Então vejo "Assinado por {NOME DO CERTIFICADO} (CPF ***.456.789-**). Este é o seu certificado?" com "Sim, sou eu" e "Não"
  E "Sim, sou eu" pede o código da verificação em duas etapas
  E só depois do código certo o documento vira "Assinado"

Cenário: Primeiro certificado de outra pessoa
  Dado que é a primeira assinatura do consultório
  Quando envio um PDF assinado por um certificado cujo titular não tem o meu nome completo do perfil
  Então vejo "O certificado deste PDF está em nome de {NOME DO CERTIFICADO}, diferente do nome do seu perfil profissional. Assine com o seu gov.br ou o seu certificado."
  E o documento continua em "Aguardando assinatura" e nenhum CPF é gravado

Cenário: Sem verificação em duas etapas
  Dado que minha conta não tem a verificação em duas etapas ativa
  Quando abro um documento em "Aguardando assinatura"
  Então vejo "Ative a verificação em duas etapas em Segurança para assinar documentos." com o link "Ativar agora"

Cenário: Recusas
  Quando envio um arquivo que não é PDF ou maior que 10 MB → "Envie o PDF assinado (até 10 MB)."
  Quando envio um PDF sem assinatura digital → "Não encontramos assinatura digital neste PDF. Assine pelo gov.br ou com certificado ICP-Brasil e envie de novo."
  Quando envio um PDF cujo início não é byte a byte o PDF preparado → "Este PDF não é o documento preparado. Baixe o PDF de novo, assine e envie."
  Quando envio um PDF com acréscimos depois da preparação que não são só a assinatura (anotação, texto, página nova, script, anexo) → "Este PDF recebeu alterações além da assinatura. Baixe o PDF de novo, assine sem editar e envie."
  Quando a assinatura não confere com o conteúdo → "A assinatura deste PDF não confere. Assine de novo e envie."
  Quando o CPF do certificado é diferente do confirmado no consultório → "O PDF foi assinado por outra pessoa. Use a sua conta gov.br ou o seu certificado."
  Quando a cadeia do certificado não chega ao gov.br nem à ICP-Brasil → "Tipo de assinatura não aceito. Use o gov.br ou um certificado ICP-Brasil."
  E em todas as recusas o documento continua em "Aguardando assinatura"

Cenário: Digitalizada (se a D1 aceitar a opção E)
  Quando escolho "Enviar documento digitalizado (assinado à mão)"
  Então vejo o aviso "O sistema não confere o conteúdo de documentos digitalizados. Envie a digitalização do PDF preparado, sem alterações."
  Quando envio o PDF
  Então vejo "Documento assinado." com o tipo "Digitalizado"
  E o portal e a verificação pública mostram "Assinatura: Digitalizado" (RN-157)
```

### US-145 — Entrega ao paciente e confirmação de recebimento · **M**

**Como** nutricionista, **quero** que o paciente receba o documento e confirme o recebimento, **para** cumprir o CFN.

```gherkin
Cenário: Entrega automática
  Dado um paciente com acesso ao portal
  Quando o documento é assinado
  Então o documento aparece no portal do paciente
  E o paciente recebe o e-mail com o assunto "Você tem um novo documento" e o corpo "Olá, {primeiro nome}. {nome de exibição do consultório} disponibilizou um novo documento para você. Para ver, entre no app: {APP_URL}/p/documentos"
  E, se houver inscrição de push, a notificação "Você tem um novo documento."
  E nenhum dos dois diz o tipo do documento, exames, itens ou nomes de produtos

Cenário: Confirmação de recebimento
  Quando o paciente abre o documento no portal (regra exata na D4)
  Então a nutricionista vê "Recebido pelo paciente em dd/mm/aaaa às hh:mm"
  E, até isso, "Enviado em dd/mm/aaaa · ainda não aberto"

Cenário: Paciente sem acesso ao portal — D3 (a)
  Dado um paciente que não aceitou o convite
  Quando o documento é assinado
  Então vejo "Este paciente ainda não tem acesso ao app. Baixe o PDF e entregue pessoalmente, ou reenvie o convite."
  E posso marcar "Entregue pessoalmente em {data}", que conta como recebimento registrado pela nutricionista

Cenário: Paciente sem acesso ao portal — D3 (b), se escolhida
  Dado um paciente com e-mail cadastrado que não aceitou o convite
  Quando o documento é assinado
  Então o paciente recebe o e-mail neutro da entrega com um link de uso único (sem anexo e sem dado de saúde)
  E ao abrir o link ele recebe por e-mail um código de 6 dígitos, digita o código e vê o documento
  E a confirmação de recebimento segue a D4 nessa página
```

### US-146 — Paciente vê os documentos no portal · **M**

```gherkin
Cenário: Lista
  Quando abro "Documentos" no app
  Então vejo cada documento com título ("Parecer nutricional" ou "Receita"), data e situação, do mais novo para o mais antigo
  E "Abrir PDF" baixa o arquivo por URL assinada de 5 min

Cenário: Situações
  Então um documento substituído mostra "Substituído por uma versão mais nova."
  E um cancelado mostra "Cancelado pela nutricionista. Não use este documento."
  E rascunhos e documentos em preparo nunca aparecem (nem no JSON da API)

Cenário: Sem documentos
  Então vejo "Você ainda não tem documentos."
```

### US-147 — Verificação pública por código ou QR · **M**

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

Cenário: Substituído, cancelado, eliminado
  Então vejo "Documento substituído — Este documento foi substituído por uma versão retificada em dd/mm/aaaa. Peça a versão atual a quem o emitiu."
  Ou "Documento cancelado — Este documento foi cancelado por quem o emitiu em dd/mm/aaaa e não deve ser usado."
  Ou "Documento emitido em dd/mm/aaaa — o prazo de guarda terminou e o conteúdo foi eliminado."

Cenário: Código inexistente ou mal digitado
  Então vejo "Código não encontrado. Confira os 12 caracteres."

Cenário: Abuso
  Dado 30 consultas do mesmo IP na mesma hora
  Quando faço a 31ª consulta nessa hora
  Então vejo "Muitas tentativas. Tente de novo em alguns minutos."
```

### US-148 — Retificar · **M**

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

### US-149 — Cancelar · **M**

```gherkin
Cenário: Cancelar
  Dado um documento "Assinado"
  Quando clico em "Cancelar documento", escrevo o motivo (1–500 caracteres, "fica só no prontuário") e confirmo "O documento deixa de valer para o paciente e na verificação pública. Esta ação não pode ser desfeita."
  Então a situação vira "Cancelado" (portal e verificação)
  E o paciente recebe o e-mail com o assunto "Um documento seu foi atualizado" e o corpo "Olá, {primeiro nome}. {nome de exibição do consultório} atualizou um documento seu. Para ver, entre no app: {APP_URL}/p/documentos"
  E sem motivo: "Escreva o motivo do cancelamento (até 500 caracteres)."

Cenário: Cancelar com retificação em andamento
  Dado um documento "Assinado" com a "Versão 2" em andamento
  Quando clico em "Cancelar documento"
  Então vejo "Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar."
  E nada muda
```

### US-150 — LGPD e histórico · **M**

```gherkin
Cenário: Auditoria
  Quando a nutricionista ou o paciente abre o conteúdo ou o PDF de um documento
  Então o "Histórico de acessos" do paciente mostra "Visualizou · Documentos assinados"
  E criar, preparar, assinar, retificar e cancelar aparecem como "Criou"/"Alterou"

Cenário: Exportação pela equipe (US-018)
  Então o ZIP traz os PDFs assinados em documentos/ e, em dados.json, todos os documentos do paciente em qualquer situação, com o conteúdo e a justificativa de uso
  E não traz o motivo de cancelamento escrito pela nutricionista (mesma decisão do MVP para a agenda, 2026-10-02)

Cenário: Exportação do titular (US-046)
  Então o ZIP traz só os documentos emitidos (assinado, substituído, cancelado): os PDFs em documentos/ e, em dados.json, só as colunas visíveis ao paciente
  E não traz rascunhos nem documentos em preparo ou aguardando assinatura (mesma regra dos planos em rascunho, P-16 b do MVP)
  E traz a justificativa de uso conforme a D15 (recomendação: sim, na exportação); nunca o motivo de cancelamento

Cenário: Histórico de acessos visível ao paciente
  Então as linhas de auditoria das edições de documento em rascunho seguem a decisão do P-16 c do MVP (a mesma dos planos em rascunho)

Cenário: Pedido de exclusão atendido
  Então os documentos ficam guardados e bloqueados (prontuário, art. 16, I, da LGPD), some o acesso pelo portal e a verificação pública continua respondendo

Cenário: Anonimização após o prazo de guarda
  Então os PDFs são apagados, o conteúdo é limpo e a verificação passa a "Documento emitido em … — o prazo de guarda terminou e o conteúdo foi eliminado."
  E a ordem é a da RN-140 (marcar e limpar pela função de anonimização, depois apagar os arquivos na mesma transação)
```

### US-151 — Rascunho do parecer com IA · **S** (só se D7 = (b); recomendação: cortar)

> **Conflito com o subprojeto A.** A spec de A põe fora do escopo a "interpretação dos exames pela IA (marcar alto/baixo, … sugerir conduta ou foco clínico a partir de exame)" (A-D17) e proíbe isso nas instruções fixas (RN-123 de A). Um rascunho de parecer **é** interpretação de exame. Esta história só existe se o dono, na D7, aprovar a mudança de escopo de A (A-D17 reaberta, com nova análise de risco — inclusive enquadramento como software dispositivo médico, R-106 de A — e da política de uso do provedor). Se entrar, valem as regras abaixo.

```gherkin
Cenário: Pedir rascunho
  Dado que todas as pré-condições da RN-100 do subprojeto A valem para este paciente (IA ligada e ativada, aditivo de IA aceito, paciente ativo, informado sobre o uso de IA, sem recusa de IA — A-D9 — e cota com saldo)
  Quando clico em "Sugerir rascunho com IA" no parecer
  Então os campos de texto recebem a sugestão com o aviso "Rascunho sugerido pela IA. Revise tudo antes de preparar para assinatura."
  E a IA recebe só nome do marcador, valor, unidade e referência normalizados dos exames selecionados, idade e sexo — nunca nome, e-mail ou telefone do paciente, nem o título livre do exame
  E qualquer texto vindo do exame vai entre delimitadores e é tratado como dado, não como instrução (defesa contra instruções em documentos, como em A)

Cenário: Paciente com recusa de IA ou sem ciência registrada
  Então o botão não aparece para esse paciente e o parecer funciona igual

Cenário: IA desligada
  Então o botão não aparece e o parecer funciona igual
```

---

## 7. Regras de negócio

| ID | Regra |
|---|---|
| RN-140 | **Imutabilidade.** Garantia no **banco**: gatilho `BEFORE UPDATE OR DELETE` (`app_documento_imutavel`) em `signed_documents` que só deixa passar as transições da RN-141 e, **por estado**, só estas colunas: **`rascunho`** — tudo, menos `id`, `tenant_id`, `patient_id`, `tipo`, `versao` e `retifica_id`; `DELETE` só aqui. **`preparando`/`aguardando_assinatura`** — `pdf_status`, `pdf_pedido_em`; `base_pdf_path` e `base_pdf_sha256` de NULL para preenchido (pelo worker, uma vez); a volta a `rascunho` com `codigo`, `base_pdf_path` e `base_pdf_sha256` → NULL; a ida a `assinado` com `pdf_path`, `pdf_sha256`, `assinatura_tipo`, `assinatura_emissor`, `assinante_nome`, `assinado_em`, `assinado_por` e `entregue_em`. **`assinado`** — `base_pdf_path` → NULL (apagar o PDF preparado, RNF-143); `entregue_em`, `recebido_em`, `recebido_via` (cada um uma vez); `status` → `substituido` com `substituido_em`, ou → `cancelado` com `cancelado_em`. **`substituido`/`cancelado`** — `base_pdf_path` → NULL e `recebido_em`/`recebido_via` (uma vez). **Anonimização (qualquer estado emitido)** — `anonimizado_em` de NULL para preenchido; `conteudo` limpo e `pdf_path` → NULL **só com `anonimizado_em` preenchido na mesma linha**. Fora disso, `conteudo`, `tipo`, `patient_id`, `codigo`, `versao`, `retifica_id`, `pdf_sha256` e `pdf_path` nunca mudam de `preparando` em diante. A tabela filha `signed_document_notes` (§10) tem gatilho equivalente: `justificativa_uso` fixa a partir de `preparando` do documento; `motivo_cancelamento` gravado uma vez, na transação do cancelamento; as duas só são limpas com `anonimizado_em` preenchido no documento. **Arquivos:** as FKs `base_pdf_path` e `pdf_path` → `stored_files.caminho` são **sem `ON DELETE SET NULL`** (`NO ACTION`), então um `apagarArquivo` avulso sobre um PDF ainda referenciado é recusado pela FK (o gatilho é a segunda barreira). **Ordem de operações** (regra 9 do CLAUDE.md: o registro muda no `naMesmaTransacao` de `apagarArquivo`, na mesma transação do `DELETE` de `stored_files`): (a) "Voltar a editar": `UPDATE` para `rascunho` com `codigo`, `base_pdf_path` e `base_pdf_sha256` NULL → `DELETE` do PDF base; (b) PDF preparado depois da assinatura: `UPDATE base_pdf_path = NULL` → `DELETE`; (c) anonimização: a função `app_anonimizar_documentos` (`SECURITY DEFINER`, como a `app_anonimizar_aceites` da migration 0065), chamada no `naMesmaTransacao`, marca `anonimizado_em`, limpa `conteudo` e as notas, põe `pdf_path` e `base_pdf_path` NULL, passa `document_verifications.situacao` a `eliminado` e devolve o caminho → `DELETE` desse `stored_files` (um documento por chamada de `apagarArquivo`); documentos não emitidos do paciente voltam a `rascunho` e são apagados pelo caminho (a). `anexosDoPaciente` (lgpd.ts) nunca apaga esses PDFs por fora deste caminho. Por ser tabela-mãe de FK `NO ACTION`, `stored_files` entra em `ULTIMAS` de `test/isolamento.test.ts`, se ainda não estiver. **Testes obrigatórios:** apagar o PDF base de um documento assinado passa; anonimizar um documento assinado passa e a verificação fica `eliminado`; `apagarArquivo` avulso sobre o PDF assinado é recusado e nada muda; `UPDATE` direto de `conteudo` ou `pdf_path` num documento assinado sem `anonimizado_em` é recusado |
| RN-141 | **Transições:** `rascunho → preparando → aguardando_assinatura → assinado`; `preparando/aguardando_assinatura → rascunho` ("Voltar a editar", só antes de assinar); `assinado → substituido` (quando a retificação é assinada, na mesma transação; só se a original ainda estiver `assinado`); `assinado → cancelado` (só sem retificação em andamento, RN-147). `preparando → aguardando_assinatura` só pelo worker. Nenhuma volta depois de `assinado`. Na variante da opção A (D1/D2), `preparando → assinado` pelo worker |
| RN-142 | **Código de verificação:** 60 bits aleatórios em base32 Crockford (12 caracteres, sem I, L, O, U), exibido `XXXX-XXXX-XXXX`, aceito sem hífen e em minúsculas; gerado ao preparar e único entre os documentos existentes (UNIQUE em `signed_documents.codigo`, PK em `document_verifications`). Em "Voltar a editar" o código é descartado sem registro; a garantia de que um código descartado (que pode ter saído impresso num PDF base baixado) não volta a ser sorteado é **probabilística** (60 bits: chance desprezível). Um código descartado nunca aparece na verificação, que só nasce na assinatura |
| RN-143 | **Impressão digital:** SHA-256 dos bytes do PDF final (o assinado), gravada em `signed_documents.pdf_sha256` e em `document_verifications` e mostrada na página pública para quem quiser conferir com ferramenta própria. A conferência do arquivo dentro da página ("Conferir arquivo", no navegador) ficou para o backlog |
| RN-144 | **Conferência do PDF assinado (opções B/C):** (1) PDF pelo conteúdo, até 10 MB; (2) há assinatura PAdES (`/ByteRange` + `/Contents`), localizada sem parser completo de PDF; (3) os bytes do início do arquivo até o fim do PDF preparado são **exatamente** o PDF preparado (SHA-256 igual ao `base_pdf_sha256`); (4) **a atualização incremental entre o PDF preparado e a assinatura só pode conter** o dicionário de assinatura (`/Type /Sig`), o campo (`/FT /Sig`) e o seu widget (`/Subtype /Widget`), o XObject da aparência do widget, e a reescrita do `/Catalog`/`/AcroForm` e da página só para incluir o campo em `/Fields`/`/Annots`; é **recusada** qualquer outra anotação (`/FreeText` e afins), conteúdo de página novo ou trocado (`/Contents`, objeto de página novo), `/JavaScript`/`/JS`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`; objetos em `/ObjStm` nessa atualização que não puderem ser lidos também levam à recusa — sem isso, uma sobreposição ("shadow attack") mostraria dose ou item diferente do `conteudo` registrado; (5) depois da assinatura, só é aceita uma atualização final de validação de longo prazo: `/DSS` (certificados, OCSP, LCR) e/ou carimbo do tempo (`/Type /DocTimeStamp`, `/SubFilter /ETSI.RFC3161`); qualquer outro acréscimo → recusa; (6) o `messageDigest` do CMS confere com os bytes cobertos e a assinatura confere com a chave do certificado; (7) a cadeia do certificado chega a uma raiz **ICP-Brasil** ou do **gov.br** (raízes públicas empacotadas no código, atualizadas por PR); (8) titular e CPF conferem (RN-145). Revogação (OCSP/LCR) **não** é conferida: a verificação pública aponta para o validador do ITI. Se o spike (P-B2) mostrar que (4) e (5) não cabem num leitor limitado à atualização incremental, a escolha entre biblioteca de parser no worker (conferência assíncrona) e risco aceito com texto de recusa ajustado é a **D16**. Tudo síncrono na rota, com limite de 3 s; erro → mensagem da US-144 e nada é gravado |
| RN-145 | **Quem assina:** assinar documentos exige a verificação em duas etapas **ativa** na conta da nutricionista (no MVP ela é opcional para a nutricionista; aqui passa a ser condição para assinar). No **primeiro** certificado aceito do consultório: (a) o nome do titular (CN do certificado, sem o sufixo `:CPF` quando houver) tem de conferir com o nome completo copiado no documento (cópia do `nome_profissional`, RN-154), comparados sem acento, sem diferença de maiúsculas e com espaços normalizados — se divergir, recusa (texto da US-144) e nada é gravado; se o perfil estiver errado, ela corrige o perfil, volta a editar e prepara de novo; (b) a nutricionista confirma ("Sim, sou eu") **com o código do 2FA naquele momento**; só então o CPF é guardado como HMAC (`ENCRYPTION_KEY`) + máscara no tenant. Os seguintes têm de ter o mesmo CPF. Trocar o CPF do consultório exige as mesmas (a) e (b). O nome do titular é gravado em `signed_documents.assinante_nome` e `document_verifications.assinante_nome` e aparece como "Assinado por" na verificação pública |
| RN-146 | **Retificação:** só de um documento `assinado` (a versão em vigor); cria `versao + 1` com `retifica_id`; no máximo **uma** retificação em andamento por documento — índice único parcial em `retifica_id` WHERE `status IN ('rascunho','preparando','aguardando_assinatura')`, para que uma retificação apagada não impeça outra; a original continua `assinado` até a nova ser assinada, quando vira `substituido` na mesma transação |
| RN-147 | **Cancelamento:** só de `assinado` e só sem retificação em andamento ("Há uma retificação em andamento (versão N). Conclua ou apague a retificação antes de cancelar."); motivo obrigatório (1–500), guardado em `signed_document_notes` (visível só à equipe, D15); e-mail neutro ao paciente; a verificação pública passa a "cancelado" |
| RN-148 | **Parecer:** título fixo "Parecer nutricional"; ressalva fixa impressa (D5); exames só do próprio paciente, com os valores **copiados de novo a cada salvamento do rascunho** e **congelados** ao preparar; aviso (não bloqueio) quando o exame muda depois de preparar ("Voltar a editar" antes da assinatura, "Retificar" depois); declaração obrigatória ao preparar (D5) |
| RN-149 | **Receita — suplementos (Res. CFN 656/2020):** vias só "Oral", "Sublingual" e "Enteral (sonda)"; enzima só em U, probiótico só em UFC; composição, via, posologia obrigatórias; justificativa de uso obrigatória e fora do PDF; declaração ao preparar (D5) |
| RN-150 | **Receita — fitoterapia (Res. CFN 680/2021, com a redação da 731/2022):** item "Planta medicinal ou droga vegetal (chá)" para todas, só com infusão, decocção ou maceração em água; item "Droga ou derivado vegetal classificado como alimento ou suplemento" para todas (art. 3º, § 2º; forma conforme a D13), com os campos do art. 12, I; item "Fitoterápico (forma farmacêutica ou fórmula magistral)" só com habilitação registrada no perfil (conferido no servidor ao salvar **e** ao preparar); nomenclatura botânica e parte utilizada sempre obrigatórias nos três. O enquadramento do produto como alimento ou suplemento é responsabilidade da nutricionista (B-04) e entra na declaração ao preparar (D5) |
| RN-151 | **Sem marca, loja ou farmácia (decisão de produto):** a receita não tem campo de marca, fabricante, farmácia nem link, e o PDF não traz propaganda. As normas **permitem** citar marca com mais de uma opção (Res. CFN 599/2018, art. 60, III; Res. CFN 856/2026, art. 74, III); a escolha de não ter o campo é do produto, alinhada ao art. 74 da 856/2026 (vedação de indicar ou manifestar preferência por marca) e ao art. 9º, III, da Res. 680/2021 — **D14**. A declaração ao preparar cobre o texto livre |
| RN-152 | **Entrega:** ao assinar, o documento fica visível no portal e sai o e-mail neutro (assunto e corpo da US-145, nome só no corpo, sem tipo de documento nem dado de saúde) + push neutro se houver inscrição. **Recebimento:** regra da D4, gravado uma única vez (`recebido_em`, `recebido_via` `portal`/`pessoalmente`), auditado |
| RN-153 | **Situação do paciente:** arquivado → sem novos documentos e sem entrega pelo portal (RN-08); bloqueado ou anonimizado → nenhuma escrita ("Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."); tenant suspenso → sem e-mail/push e verificação pública continua respondendo (prova para terceiros) |
| RN-154 | **Cópia congelada:** ao preparar, o conteúdo recebe a cópia do perfil profissional, do nome do paciente e dos valores dos exames; o PDF e o portal leem a cópia |
| RN-155 | **IA opcional (só se D7 = (b)):** valem todas as pré-condições da RN-100 do subprojeto A (inclusive paciente informado e sem recusa de IA, A-D9), conferidas ao pedir e de novo no worker; a IA recebe só marcadores normalizados (nome, valor, unidade, referência), idade e sexo, com qualquer texto vindo do exame entre delimitadores e tratado como dado; o rascunho só preenche campos editáveis; nada é preparado ou assinado sem ação da nutricionista; o uso fica registrado em `ia_rascunho_em`; a marca no documento segue a D7 alinhada à A-D13 (art. 37 da Res. 856/2026); conta na cota de IA de A |
| RN-156 | **Verificação pública:** responde só a partir de `document_verifications` (sem dado de saúde); limite de 30 consultas por IP por hora — a 31ª na mesma hora é recusada (HMAC do IP em `public_rate_limits`, pela função de `src/modules/agenda/limite-ip.ts`); mesma resposta para código inexistente e malformado; `noindex`, `Referrer-Policy: no-referrer` |
| RN-157 | **Digitalizada (opção E, se a D1 a aceitar):** o sistema **não confere** conteúdo nem assinatura do arquivo enviado — confere só que é PDF (até 10 MB) e calcula o SHA-256; a tela de envio avisa isso (texto da US-144); o portal, a lista da nutricionista e a verificação pública mostram "Assinatura: Digitalizado", sem "Assinado por" e sem o link do validador do ITI. Esse limite é parte da decisão D1 |

---

## 8. Requisitos não funcionais

| ID | Requisito | Meta verificável |
|---|---|---|
| RNF-140 | Desempenho | PDF preparado em ≤ 30 s (p95) no worker; conferência do PDF assinado ≤ 3 s para 10 MB; página `/v/<codigo>` p95 ≤ 300 ms |
| RNF-141 | Segurança | Upload só PDF por *magic bytes*, até 10 MB; leitura da assinatura sem parser completo de PDF (busca limitada à atualização incremental posterior ao PDF preparado, tamanho máximo do `/Contents`), com a lista fechada do que a atualização pode conter (RN-144, (4) e (5)) e testes com PDFs adulterados (FreeText, troca de conteúdo de página, JavaScript, OpenAction, anexo, certificado de outra pessoa); URL assinada de 5 min para os PDFs (`signFileUrl`); código de 60 bits + limite por IP (RN-156); download no portal só do próprio paciente (`stored_files` por paciente, P-16 d do MVP) |
| RNF-142 | Privacidade | Nada de conteúdo, valores de exame, itens da receita ou CPF em log ou Sentry; e-mail e push neutros; página pública sem dado de saúde; auditoria de leitura (`auditRead`) ao devolver conteúdo ou PDF; a IA (US-151, só se D7 = (b)) recebe só marcadores normalizados, idade e sexo |
| RNF-143 | Armazenamento | PDFs contam na cota de 5 GB (RN-18); o PDF preparado é apagado depois da assinatura; cota esgotada → "Espaço de armazenamento esgotado. Fale com o suporte." (sem `naoBarrarPelaCota`, que é só da exportação) |
| RNF-144 | Acessibilidade | Lista do portal e página de verificação sem violações axe A/AA |
| RNF-145 | Custo | Bibliotecas gratuitas (`qrcode`, `pkijs`/`asn1js`, `@react-pdf/renderer` já usado); nenhum serviço pago na recomendação da D1 |

---

## 9. Integrações

### INT-B1 — Assinatura externa (gov.br e ICP-Brasil)

| Item | Especificação |
|---|---|
| Fluxo | Sem API: a nutricionista baixa o PDF preparado, assina em `assinador.iti.br` (gov.br prata/ouro) ou no programa do certificado ICP-Brasil, e envia o arquivo assinado (US-144) |
| Formato aceito | PDF com assinatura PAdES (CMS destacado em `/Contents`); uma assinatura por documento, que cobre o arquivo inteiro **salvo** uma atualização final só com `/DSS` e/ou carimbo do tempo `/DocTimeStamp` (PAdES-LTV, comum em programas ICP); entre o PDF preparado e a assinatura, só os objetos da RN-144 (4) |
| Raízes confiáveis | Certificados raiz da ICP-Brasil e da AC do gov.br, em arquivo versionado no repositório, com fonte e SHA-256 conferidos por teste (padrão do seed da TACO) |
| Bibliotecas | `pkijs` + `asn1js` (licença BSD-3) para CMS e cadeia; **escolha final no spike** (P-B2) |
| Não faz | Revogação (OCSP/LCR), validação do carimbo do tempo e da política de assinatura ICP (o `/DSS` e o `/DocTimeStamp` são aceitos, não validados) — o validador oficial do ITI cobre esses pontos para quem precisar |
| Plano B (se o spike mostrar que o assinador **não** preserva o PDF como prefixo) | A conferência (3) da RN-144 não é possível. Alternativas, a decidir com o resultado do spike (D16): (a) conferir no worker o texto extraído do PDF assinado contra o texto do PDF preparado (biblioteca de parser, conferência assíncrona); (b) aceitar só a assinatura e a cadeia, com a página pública mandando conferir no validador do ITI e a recusa "não é o documento preparado" retirada; (c) não aceitar aquele assinador |
| Opção D (só se escolhida) | API de PSC de assinatura em nuvem: especificar à parte, com custo aprovado pelo dono |

### Reuso do MVP

E-mail (INT-02: Resend/Mailpit, modelos React próprios, idempotência por documento), push (INT-03: só no worker, texto neutro), arquivos (`salvarArquivo`/`apagarArquivo`, `signFileUrl`), filas pg-boss (job `documento-pdf`, varredura de PDF pendente há mais de 1 h → `falhou`, como o plano alimentar).

---

## 10. Modelo de dados

Convenções do MVP (🔒 = `tenant_id` + RLS forçada; FK composta `tenant_id` + `patient_id` nas tabelas filhas).

| Tabela | Campos-chave | Restrições / RLS |
|---|---|---|
| `tenants` (alteração) | `nome_profissional`, `contato_email`, `contato_telefone_e164`, `fitoterapia_registro` (até 60), `fitoterapia_declarada_em`, `assinante_cpf_hmac`, `assinante_cpf_mascarado` | CHECK de tamanho; `fitoterapia_registro` e `fitoterapia_declarada_em` juntos ou nulos |
| 🔒 `signed_documents` | `patient_id`, `tipo` (`parecer`/`receita`), `status` (`rascunho`/`preparando`/`aguardando_assinatura`/`assinado`/`substituido`/`cancelado`), `versao`, `retifica_id`, `conteudo jsonb` (esquema Zod por tipo; inclui a cópia do perfil, do nome do paciente e dos exames; **sem** a justificativa de uso), `exam_ids uuid[]` (referência; o valor que vale é a cópia), `declaracao_em`, `codigo` (12), `base_pdf_path` → `stored_files.caminho` (**sem `ON DELETE`**, `NO ACTION`), `base_pdf_sha256`, `pdf_status` (`pendente`/`pronto`/`falhou`), `pdf_pedido_em`, `pdf_path` → `stored_files.caminho` (**sem `ON DELETE`**), `pdf_sha256`, `assinatura_tipo` (`govbr`/`icp`/`digitalizada`/`plataforma`), `assinatura_emissor` (AC, até 200), `assinante_nome` (titular do certificado, até 200; nulo em `digitalizada`), `assinado_em`, `assinado_por` (user), `entregue_em`, `recebido_em`, `recebido_via` (`portal`/`pessoalmente`/`link_email`, este só se D3 = (b)), `cancelado_em`, `substituido_em`, `ia_rascunho_em`, `anonimizado_em`, `created_at`, `updated_at` | `codigo` UNIQUE; CHECK `codigo IS NULL` ⇔ `status = 'rascunho'`; CHECK `anonimizado_em IS NOT NULL OR ((pdf_path IS NOT NULL AND pdf_sha256 IS NOT NULL AND assinado_em IS NOT NULL) = (status IN ('assinado','substituido','cancelado')))`; FK composta `retifica_id` → mesmo tenant e paciente; índice único parcial (`retifica_id`) WHERE `status IN ('rascunho','preparando','aguardando_assinatura')` (RN-146); índice (`tenant_id`, `patient_id`, `created_at DESC`); CHECK dos caminhos do próprio tenant (como `exams_arquivo_do_tenant`). **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_enable_audit('signed_documents', 'documentos')`; política `RESTRICTIVE` `paciente_so_emitidos` (sessão de paciente vê só `assinado`/`substituido`/`cancelado`, como `paciente_sem_rascunho` do plano: garantia no banco, §4.1 do MVP); `publico_negado` (padrão). Gatilho `app_documento_imutavel` (RN-140) |
| 🔒 `signed_document_notes` | `documento_id` (PK, FK composta `tenant_id` + `patient_id` + `documento_id` → `signed_documents`, `ON DELETE CASCADE` só para o rascunho apagado), `patient_id`, `justificativa_uso` (até 2000; só receita), `motivo_cancelamento` (até 500), `updated_at` | Anotações da nutricionista que o paciente **não** lê no banco (se a D15 mantiver a recomendação). **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_enable_staff_only('signed_document_notes')` + entrada em `STAFF_ONLY` (`src/db/rls-guard.ts`) + `app_enable_audit('signed_document_notes', 'documentos')`; gatilho de imutabilidade da RN-140; entrada em `FABRICAS` (cria a linha-mãe no mesmo comando). Em D15 (b), a exportação do titular (worker) lê a justificativa daqui; em D15 (c), a justificativa volta para `conteudo` e esta tabela fica só com o motivo de cancelamento |
| `document_verifications` | `codigo` (PK), `tenant_id`, `documento_id`, `tipo`, `situacao` (`valido`/`substituido`/`cancelado`/`eliminado`), `situacao_em`, `assinado_em`, `emissor_nome`, `emissor_crn`, `assinante_nome` (nulo em digitalizada), `assinatura_tipo`, `pdf_sha256` | **Sem dado de saúde nem do paciente.** Lida pelo código antes de existir contexto de tenant → entra em `RLS_EXCEPTIONS` (como `invites`), acesso só por `src/modules/documentos/verificacao.ts`; o role da aplicação faz `SELECT`/`INSERT`/`UPDATE` de `situacao`, nunca `DELETE`; gravada na mesma transação da assinatura, retificação, cancelamento e anonimização |
| `stored_files` (alteração) | `tipo` ganha `documento_base` e `documento_assinado` | CHECK atualizado |

Outros pontos de código: `ENTIDADE_ROTULO.documentos = 'Documentos assinados'`; entradas de `signed_documents` e `signed_document_notes` em `FABRICAS` de `test/isolamento.test.ts` e `stored_files` em `ULTIMAS` (FK `NO ACTION`, RN-140); `exportacao-job.ts` inclui os PDFs e separa a exportação da equipe (US-018) da do titular (US-046) como na US-150; `anexosDoPaciente` (lgpd.ts, que hoje apaga laudos, exportações e PDFs de plano por `apagarArquivo` sem `naMesmaTransacao`, contando com o `SET NULL`) **não** recebe os PDFs de documentos: eles saem pelo caminho (c) da RN-140, antes do laço de anexos, e a conferência final "anexo novo durante a anonimização" passa a contar também `signed_documents` com `pdf_path` ou `base_pdf_path` preenchido; CLAUDE.md do projeto ganha a exceção de `document_verifications` na regra 1 e a menção à `app_anonimizar_documentos` ao lado da `app_anonimizar_aceites`.

---

## 11. Riscos e pendências

| ID | Item | Tipo | Ação / responsável |
|---|---|---|---|
| P-B1 | O CFN exige "assinatura digital certificada" na receita eletrônica (Res. 656/680); não está claro se a assinatura avançada do gov.br atende, nem **como a Res. CFN 760/2023, art. 10, II ("assinados eletronicamente e/ou com código verificador…, preferencialmente avançada ou qualificada"), convive com essa exigência** na receita de telenutrição; nem se a assinatura na plataforma com 2FA + código verificador (opção A) atende o parecer e o plano alimentar | Pendência | Consulta escrita ao CRN-3 (Debby/dono) **antes do plano**, com as três perguntas e os textos da D5; a resposta fecha a D1, a D2 e a D12. Conferir o texto da 760/2023 no DOU |
| P-B2 | Spike técnico: o assinador do gov.br e os programas ICP mais comuns preservam os bytes do PDF (atualização incremental)? Que objetos cada um põe na atualização (para a lista fechada da RN-144, (4))? Acrescentam `/DSS` ou `/DocTimeStamp` depois da assinatura (PAdES-LTV)? Usam `/ObjStm` na atualização? O certificado do gov.br traz o CPF e o nome do titular? `pkijs` valida as cadeias? Os termos de uso do assinador gov.br permitem documentos entre particulares? | Pendência técnica | Dev, na tarefa 1 do plano, com PDFs reais assinados pela Debby (gov.br, A1 e A3 de pelo menos dois programas). Se algum não preservar o prefixo ou a lista não couber num leitor limitado: plano B do INT-B1 e **D16** |
| P-B3 | Termo de consentimento do paciente e DPA precisam citar a entrega eletrônica de documentos, a assinatura usada e a página pública de verificação; na telenutrição, o TCLE exigido antes do primeiro atendimento (Res. CFN 760/2023, art. 9º, VI) é o lugar natural para a "forma acordada com o cliente" de envio dos documentos (art. 10, III) | Pendência | Advogado (E-09 do MVP); nova versão do termo exige novo aceite |
| P-B4 | Versão vigente da lista de constituintes de suplementos (IN Anvisa 28/2018 e atualizações citadas pela Res. CFN 731/2022) | A confirmar | Debby confere; o sistema não valida itens contra a lista (B-04) |
| P-B5 | Prazo de guarda (P-01 do MVP) vale também para documentos assinados | Pendência | Mesma validação do P-01 |
| P-B6 | Validação própria da assinatura pode ter falha (aceitar o que não deveria), inclusive sobreposição de conteúdo na atualização incremental ("shadow attacks") que mostre dose ou item diferente do `conteudo` | Risco | Lista fechada da atualização incremental (RN-144, (4) e (5)); cadeia até raiz confiável + nome do titular e CPF conferidos com 2FA (RN-145) + "Assinado por" na página pública + link ao validador do ITI; testes com PDFs adulterados (FreeText, conteúdo de página trocado, JavaScript, OpenAction, anexo, certificado de outra pessoa no primeiro envio); revisão de segurança dedicada |
| P-B7 | Receita **impressa** perde a conferência de conteúdo: o QR prova que o código existe, não que o papel não foi alterado. Na digitalizada (opção E) nem o arquivo eletrônico tem conferência de conteúdo (RN-157) | Risco aceito (E depende da D1) | A página mostra situação, data, emissor e quem assinou; a farmácia pode pedir o PDF e conferir o SHA-256 com ferramenta própria |
| P-B8 | Documentos esquecidos em "Aguardando assinatura" | Risco de uso | Contador "Documentos aguardando assinatura" no painel inicial |
| P-B9 | Responsabilidade profissional: o sistema não confere UL, interações, a lista da Anvisa nem o enquadramento do produto vegetal como alimento ou suplemento (RN-150); a IA (US-151, se entrar) pode sugerir texto com diagnóstico ou interpretação de exame | Risco aceito (B-04) | Declaração ao preparar; aviso fixo da IA; revisão obrigatória; US-151 cortada na recomendação da D7 |
| P-B10 | **Lacuna de conformidade do MVP:** o plano alimentar e as orientações entregues em telenutrição (consulta `online`, Plano 05; PDF no portal, Plano 06) são "documentos produzidos" no sentido da Res. CFN 760/2023, art. 10, que pede assinatura eletrônica e/ou código verificador e **confirmação de recebimento**; hoje saem sem nenhum dos dois | Pendência (conformidade) | **D12**: decisão do dono; não é corrigido por esta spec sem ela |
| P-B11 | A Res. CFN 856/2026 substitui a 599/2018 em 23/01/2027 (número do ato de prorrogação a confirmar no DOU) e o texto ainda pode mudar (consulta pública de 2026) | A confirmar | Conferir o texto vigente antes do plano, junto com R-107 de A e P-L6 da loja; revisar RN-151, §3.5 e D7 se mudar |

---

## 12. Referências

| Norma / fonte | Uso nesta spec | URL |
|---|---|---|
| Resolução CFN nº 656/2020 (prescrição dietética de suplementos alimentares), com a redação da Res. CFN nº 731/2022 | §3.2, RN-149 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_656_2020.html |
| Resolução CFN nº 731/2022 (altera as Res. 656/2020 e 680/2021; inclui o § 2º do art. 3º da 680: produto vegetal classificável como alimento ou suplemento sem exigência de pós-graduação em fitoterapia) | §3.2, §3.3, RN-150, D13 | https://www.cfn.org.br/wp-content/uploads/resolucoes/Res_731_2022.html |
| Resolução CFN nº 680/2021 (fitoterapia), alterada pelas Res. CFN 688/2021 e 731/2022 | §3.3, RN-150, RN-151 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_680_2021.html |
| Resolução CFN nº 760/2023 (telenutrição; DOU de 24/10/2023, Seção 1, p. 206; revoga as Res. CFN 666/2020 e 751/2023, art. 17), arts. 9º, VI, e 10 (documentos: identificação, assinatura eletrônica e/ou código verificador, preferencialmente avançada ou qualificada, confirmação de recebimento, prontuário) — texto conferido em fonte secundária; DOU **a conferir** | §3.4, D1, D2, D3, D12, P-B1, P-B10 | https://legismap.com.br/leis-e-normas/resolucao-cfn-n-760-de-22-10-2023 · https://www.in.gov.br/en/web/dou/-/resolucao-cfn-n-760-de-22-de-outubro-de-2023-518461727 · https://cfn.org.br/cfn-publica-resolucao-que-regulamenta-a-telenutricao/ |
| Resolução CFN nº 599/2018 (Código de Ética e de Conduta do Nutricionista), arts. 20, 60 (inclusive o inciso III: mais de uma opção de marca na prescrição) a 63 — vigente até a 856/2026 | §3.5, RN-151, D14 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html |
| Resolução CFN nº 856/2026 (novo Código de Ética e Conduta; DOU de 28/04/2026; revoga a 599/2018), art. 37 (indicar o uso de ferramentas automatizadas) e art. 74 (marcas; inciso III: múltiplas opções na prescrição; parágrafo único: venda casada). Vigência em 23/01/2027 por resolução de 20/07/2026 (**número a confirmar** no DOU); texto sujeito à consulta pública de 2026 | §3.5, RN-151, RN-155, D7, D14, P-B11 | https://www.legisweb.com.br/legislacao/?id=494878 · https://legismap.com.br/leis-e-normas/resolucao-cfn-n-856-de-25-04-2026 |
| Resolução CFN nº 600/2018 (atribuições; glossário: "diagnóstico de nutrição", "prescrição dietética"; consultório D.2.1 e D.2.2) | §3.1 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_600_2018.htm |
| Resolução CFN nº 306/2003 (solicitação de exames laboratoriais) | §3.1 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_306_2003.htm |
| Lei nº 8.234/1991 (regulamenta a profissão; exames laboratoriais para o acompanhamento dietoterápico) — citada pelo CFN; texto **não conferido** nesta pesquisa | §3.1 | https://www.planalto.gov.br/ccivil_03/leis/l8234.htm |
| Lei nº 12.842/2013 (ato médico): art. 4º, I e § 2º **vetados**; § 1º (definição de diagnóstico nosológico) e § 7º (competências das outras profissões, inclusive nutricionista) | §3.1 | https://www.normasbrasil.com.br/norma/lei-12842-2013_256316.html |
| Lei nº 14.063/2020 (assinaturas eletrônicas), art. 4º; arts. 13 (exigência de qualificada só para receita de controle especial e atestado médico) e 14 (cláusula de suficiência: avançada ou qualificada válidas "para todos os fins") — arts. 13 e 14 **a conferir no Planalto** (o site não respondeu nas pesquisas de 03/10/2026) | §3.4, D1, D2 | https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm |
| MP nº 2.200-2/2001 (ICP-Brasil), art. 10, §§ 1º e 2º | §3.4 | https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm |
| ITI — assinatura eletrônica avançada gov.br (prata/ouro, gratuita, certificado de 1 ano, API para "aplicações públicas") | §3.4, INT-B1 | https://www.gov.br/iti/pt-br/assuntos/assinatura-eletronica-avancada |
| ITI — Validar (validador de assinaturas) | RN-144, US-147 | https://www.gov.br/pt-br/servicos/realizar-validacao-de-assinaturas-eletronicas-validar |
| Preço de mercado do e-CPF A1 em 2026 (~R$ 162–235; **a confirmar** na compra) | §3.4, D1 | https://www.omie.com.br/blog/qual-e-o-valor-do-certificado-digital-a1-e-a3-em-2026/ |
| IN Anvisa nº 28/2018 e atualizações (lista de constituintes de suplementos), citada pela Res. CFN 656/2020, art. 3º, VIII — versão vigente **a confirmar** | §3.2, P-B4 | (via Res. CFN 656/2020) |
| LGPD (Lei nº 13.709/2018): arts. 11 (dado sensível), 16, I (guarda por obrigação legal), 18 (direitos do titular) | US-150 | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm |

---

## Pontos menores (backlog)

Todos os pontos menores da revisão 0.2 foram aplicados no corpo (DSS/carimbo do tempo e plano B do spike — RN-144, INT-B1, P-B2; índice da retificação e cancelamento com retificação aberta — RN-146, RN-147, US-148, US-149; cenários dos valores congelados — US-141, RN-148; código descartado — RN-142; limite da verificação — US-147, RN-156; efeito colateral da D3). Ficam para o backlog:

| Item | Origem | Observação |
|---|---|---|
| "Conferir arquivo" na página de verificação (SHA-256 calculado no navegador, Web Crypto, com `aria-live`) | Revisão 0.2 (YAGNI) | Repete o que o validador do ITI já faz; a página continua mostrando o SHA-256. Prioridade S, se a Debby ou farmácias pedirem |
| Textos de interface da variante da opção A (§5) | Revisão 0.2 | Só se a D1 ou a D2 escolherem A; escrever no plano |

Achado não aplicado como proposto, com fato verificável:

- Exportação da equipe (US-018) "com tudo": o motivo de cancelamento escrito pela nutricionista continua **fora** das duas exportações, porque o dono decidiu assim para a agenda em 2026-10-02 (spec do MVP, RNF-08, v1.8); a justificativa de uso entra na exportação da equipe.

---

## Decisões pendentes do dono

| ID | Pergunta | Opções | Recomendação |
|---|---|---|---|
| D1 | Que tipo de assinatura o sistema aceita **na receita**? (análise na §3.4) | A) na plataforma (senha + 2FA + código verificador) · B) gov.br (avançada, grátis) · C) ICP-Brasil da nutricionista (qualificada; certificado pago por ela) · D) ICP-Brasil em nuvem integrada por API (custo do dono por assinatura/contrato) · E) digitalizada (assinada à mão; o sistema **não confere o conteúdo**, RN-157) | **B + C pelo mesmo fluxo de envio do PDF assinado, + E como alternativa** (aceitando que E não tem conferência de conteúdo e aparece como "Digitalizado"); assinar exige 2FA ativo (RN-145); não oferecer A para receita (Res. 656/680 pedem "assinatura digital certificada"); D só com demanda e custo aprovado. Se o CRN-3 recusar o gov.br (P-B1), receita só com C e E |
| D2 | O **parecer** exige o mesmo nível de assinatura da receita? | (a) mesmo nível (B/C/E): prova mais forte, atrito **alto** (baixar, assinar no gov.br ou no programa ICP, reenviar), R$ 0 · (b) opção A (plataforma com 2FA + código verificador): atende o texto da Res. CFN 760/2023, art. 10, II ("e/ou código verificador"), atrito **baixo**, R$ 0, prova mais fraca (simples ou avançada discutível; avançada/qualificada é só "preferencial") · (c) as duas, à escolha da nutricionista por documento | **(b), se o CRN-3 confirmar na consulta da P-B1**; sem a resposta, (a). O parecer vai ao paciente, não a terceiro; a Lei 14.063, art. 14, não exige avançada (é cláusula de suficiência) e a 760/2023 aceita código verificador. (c) só se a Debby pedir: dois fluxos para manter |
| D3 | Como entregar a paciente sem acesso ao portal? | a) só portal (a nutricionista entrega o PDF pessoalmente e registra) · b) link de uso único por e-mail + código de 6 dígitos enviado ao e-mail (sem conta e sem anexo) · c) PDF anexado ao e-mail | **(b) para quem não tem portal, com (a) mantido para o presencial** ("Entregue pessoalmente"). Efeito colateral da (a) sozinha: na telenutrição, empurra a nutricionista a mandar o PDF por WhatsApp ou e-mail pessoal, fora do sistema, sem auditoria nem confirmação de recebimento — pior para a LGPD; a Res. 760/2023 aceita "qualquer outra forma que tenha sido acordada com o cliente", com confirmação de recebimento. (b) reaproveita o padrão de código por e-mail da página pública (RN-16) e confirma o recebimento na própria página. Nunca (c) (dado de saúde na caixa de entrada) |
| D4 | O que conta como "confirmação de recebimento" exigida pelo CFN? | Primeira abertura do PDF no portal (automática, auditada) · botão explícito "Confirmo que recebi este documento" · os dois | **Botão explícito** ao abrir o documento no portal (ou na página da D3 (b)) — prova mais forte do que a abertura; uma vez por documento; a abertura sem confirmação aparece como "aberto, recebimento não confirmado" |
| D5 | Textos sensíveis: ressalva fixa do parecer e declarações ao preparar | Propostas: ressalva "Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica." · declaração do parecer "Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento." · declaração da receita "Declaro que os itens são suplementos alimentares, produtos vegetais classificáveis como alimento ou suplemento ou fitoterápicos isentos de prescrição médica, dentro da minha competência (Resoluções CFN nº 656/2020 e nº 680/2021), e que a receita não indica marca nem local de compra." | Aprovar as propostas **com a Debby** e mandar junto na consulta ao CRN-3 (P-B1) |
| D6 | Como comprovar a habilitação em Fitoterapia? | Autodeclaração com o registro no CRN · envio de comprovante revisado pelo admin | **Autodeclaração** com registro e termo de responsabilidade (o CRN é quem fiscaliza; revisão pelo admin cria trabalho manual e guarda documento pessoal sem necessidade) |
| D7 | Rascunho do parecer com IA (US-151): entra? | (a) cortar desta spec; se o dono quiser depois, vira **mudança de escopo do subprojeto A** (A-D17 reaberta: interpretação de exame pela IA, com nova análise de risco, enquadramento Anvisa — R-106 de A — e política do provedor) · (b) manter aqui como S, depois de A, com A-D17 reaberta, as pré-condições da RN-100 de A (inclusive recusa de IA, A-D9) e a entrada só de marcadores normalizados. Em (b), a marca "Elaborado com apoio de IA…" no PDF é decidida **junto com a A-D13**, depois da resposta do CRN sobre o art. 37 da Res. CFN 856/2026 ("indicar que houve uso de ferramentas automatizadas") | **(a) cortar** (YAGNI): nenhum item confirmado precisa dela, e ela contradiz o escopo aprovado de A |
| D8 | O que a página pública de verificação mostra? | Só situação, data e código · + tipo do documento · + nutricionista e CRN · + titular do certificado que assinou · + iniciais do paciente | **Situação, tipo, data, nutricionista com CRN, "Assinado por" (titular do certificado, RN-145) e SHA-256**, sem nada do paciente (a farmácia precisa saber quem emitiu e perceber divergência com quem assinou; o tipo não identifica ninguém) |
| D9 | Ordem de entrega | Base + receita primeiro, parecer depois · base + parecer primeiro · tudo junto | **Base + receita primeiro** (F3-06 só depende do go-live e é o uso mais frequente no consultório); parecer na sequência (depende de exames lançados, se beneficia da F3-01/F3-04 e da resposta da D2) |
| D10 | Limite de documentos por tenant ou por mês? | Sem limite (só a cota de 5 GB) · limite mensal | **Sem limite**: não há custo por uso na recomendação da D1; a cota de armazenamento já protege o disco |
| D11 | Avisar o paciente por e-mail quando um documento é cancelado ou substituído? | Sim, e-mail neutro · só aparece no portal | **Sim, e-mail neutro** (US-149): o paciente pode estar levando a receita à farmácia |
| D12 | Plano alimentar e orientações entregues em **telenutrição** (P-B10): a Res. CFN 760/2023, art. 10, pede assinatura eletrônica e/ou código verificador e confirmação de recebimento, e o MVP entrega o PDF sem nenhum dos dois | (a) a base deste subprojeto passa a cobrir o PDF do plano alimentar (código de verificação + QR + confirmação de recebimento; assinatura conforme a D2) — escopo novo, mexe no Plano 04 e no portal (Plano 06) · (b) consultar o CRN-3 antes (junto com a P-B1) e decidir com a resposta · (c) aceitar o risco | **(b)**, com a pergunta na mesma consulta da P-B1; se o CRN-3 confirmar a exigência, (a) com a assinatura escolhida na D2. Não aceitar (c) sem a resposta |
| D13 | Produto vegetal em forma farmacêutica classificável como alimento ou suplemento (Res. 680, art. 3º, § 2º, redação da 731/2022), liberado para nutricionista sem habilitação: como lançar na receita? | (a) tipo próprio "Droga ou derivado vegetal classificado como alimento ou suplemento", com os campos do art. 12, I, obrigatórios · (b) categoria "Derivado vegetal" no "Suplemento alimentar", com os campos botânicos opcionais | **(a)**, confirmar com a Debby: os campos do art. 12, I, ficam obrigatórios e o tipo não se confunde com o fitoterápico que exige habilitação |
| D14 | A receita permite citar **marca** quando há mais de uma opção (Res. 599/2018, art. 60, III; Res. 856/2026, art. 74, III)? | Não (sem campo de marca; texto livre coberto pela declaração) · Sim, campo opcional que exige ao menos duas marcas | **Não**: reduz o risco ético (art. 74, caput, da 856/2026), mantém a receita longe da loja (F4-01, outro projeto) e simplifica |
| D15 | A **justificativa de uso** (prontuário, Res. 656, art. 3º, XII) e o **motivo de cancelamento** são visíveis ao titular? | (a) os dois só para a equipe: fora do portal e da exportação do titular · (b) justificativa fora do portal mas **na exportação do titular**; motivo só da equipe · (c) justificativa também no portal; motivo só da equipe | **(b)**: o direito de acesso do titular (LGPD, art. 18, I e II) sugere que a justificativa, que é dado dele no prontuário, saia na exportação; o motivo de cancelamento segue a decisão do dono para a agenda (2026-10-02). Nas três, o banco garante o que o paciente não lê (tabela `STAFF_ONLY`, §10). Confirmar com o advogado (E-09) |
| D16 | Se o spike (P-B2) mostrar que a conferência do PDF assinado não cabe num leitor limitado (prefixo não preservado, lista fechada da atualização incremental ou `/ObjStm` ilegível) | (a) biblioteca gratuita de parser de PDF no worker, com conferência assíncrona ("Conferindo o PDF assinado…") · (b) aceitar o risco: conferir só assinatura, cadeia e titular, retirar a recusa "não é o documento preparado" e mandar conferir no validador do ITI · (c) recusar o assinador ou programa que não couber | **(a)**: custo R$ 0 e fecha a sobreposição de conteúdo ("shadow attack"); (c) para programas raros; (b) só com aceite explícito do risco (P-B6) |

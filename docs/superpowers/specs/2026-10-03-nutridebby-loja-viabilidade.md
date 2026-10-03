# NutriDebby — Loja de produtos do ramo (F4-01) — Nota de viabilidade

| Item | Valor |
|---|---|
| Versão | 0.2 (rascunho revisado; para decisão do dono) |
| Data | 2026-10-03 |
| Tipo | **Nota de viabilidade**, não spec. Não traz histórias nem modelo de dados: serve para o dono decidir **se**, **como** e **onde** a loja existe. A spec completa só é escrita depois das decisões do fim deste documento |
| Item do backlog | F4-01 (loja de produtos do ramo, confirmada pelo dono em 03/10/2026; Fase 4 da §10 da spec do MVP) |
| Quando | Só **depois do go-live** (Plano 08) e, pela §10, depois da Fase 3. Na prática, **2027**, quando o novo Código de Ética do CFN já estará em vigor (§3) |
| Base | Spec do MVP [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) v1.8 (§10, RNF-03, RNF-08, P-05) e a spec dos documentos assinados [`2026-10-03-nutridebby-documentos-assinados-design.md`](2026-10-03-nutridebby-documentos-assinados-design.md) (RN-151: receita sem marca, loja ou farmácia) |
| Numeração nova | Riscos **R-L1 a R-L9** · pendências **P-L1 a P-L7** · decisões **D1 a D10** (deste documento) |

> As normas foram conferidas no texto publicado (CFN, Planalto, Senado, Anvisa) salvo onde está escrito **"a confirmar"**. A análise do CFN vale para o texto da Res. CFN 856/2026 **publicado em 28/04/2026**; o próprio CFN admite ajustes antes da vigência (§3.1, R-L9). Esta nota não substitui a consulta ao CRN-3, ao contador e ao advogado (P-L1 a P-L3).

---

## 1. Resposta curta

1. **Projeto separado: sim.** A loja deve ser **outro produto** — outro repositório, outro banco, outro serviço no Easypanel, outro domínio — e não um módulo do NutriDebby. O motivo principal não é técnico. Dado de saúde coletado para o acompanhamento nutricional só pode ser usado para essa finalidade (LGPD, art. 6º, I e II), e nenhuma hipótese do art. 11 cobre marketing com dado sensível; e o Código de Ética do CFN **proíbe** vincular a venda à prescrição individualizada (Res. CFN 856/2026, art. 74, parágrafo único). Bases separadas tornam o cruzamento impossível **pelo sistema**; não impedem a nutricionista de exportar a própria lista de pacientes, por isso os termos de uso e o DPA do NutriDebby também passam a proibir esse uso (P-L7).
2. **Ética do CFN:** a venda com a imagem da nutricionista **é possível para produto próprio** — quando ela é sócia ou proprietária da empresa **que desenvolve os itens** (art. 74, I, b) —, com **declaração de conflito de interesses** e **sem ligação com a prescrição individualizada**. **Revenda de marcas de terceiros: a confirmar** com o CRN-3 (P-L1), porque pode cair na vedação do caput do art. 74. **Comissão por venda** à nutricionista (afiliado, repasse) bate de frente com o código (arts. 60, 63 e 77). Até 22/01/2027 vale o código antigo (Res. 599/2018), mais restritivo (§3.3).
3. **Modelo recomendado (D2/D3/D7):** começar **sem construir nada**, só com **produto próprio** (Modelo A1) — a nutricionista vende com o CNPJ dela, por link de pagamento e catálogo simples — e só construir ou contratar a loja quando a meta de demanda da D10 for atingida. **Descartar** afiliado com comissão para a nutricionista e "venda pela plataforma com repasse à nutricionista".
4. **Integração com o NutriDebby:** **nenhuma** até o CRN-3 responder por escrito (P-L1). Se a resposta liberar, no máximo **um link geral** no portal do paciente, **desligado por padrão**, com a declaração de conflito e as regras de segurança da §5; **nunca** na receita, no plano, no parecer nem com base em dado do paciente; **sem login único**.

---

## 2. Projeto separado × módulo do NutriDebby

| Critério | Módulo dentro do NutriDebby | Projeto separado |
|---|---|---|
| **Dado de saúde / LGPD** | Mesmo banco que prontuário, exames e planos. Um `JOIN`, um relatório ou uma "recomendação" errada vira uso de dado de saúde fora da finalidade do atendimento (LGPD, art. 6º, I e II) e sem base legal do art. 11 para marketing. A defesa fica só nas regras de código (RLS, revisão) | **Nenhum dado de saúde** no banco da loja. Cliente da loja ≠ paciente; o vazamento de um não expõe o outro. O aviso de privacidade do NutriDebby não muda; o DPA e os termos ganham só a cláusula da P-L7 |
| **Papel na LGPD** | Confuso: no NutriDebby a nutricionista é controladora e a plataforma é operadora (RNF-08). Na loja, quem vende é controlador do dado de compra. Misturar os dois papéis no mesmo sistema complica o DPA e o atendimento aos titulares | Papéis limpos: loja com aviso de privacidade próprio, sem dado sensível; NutriDebby intacto |
| **Ética do CFN** | Tentação permanente de "ligar a receita ao produto" — exatamente o que o art. 74, parágrafo único, veda (§3) | A separação já é a barreira; nenhum ponto de contato até o CRN-3 responder (§5) |
| **Domínio do problema** | E-commerce tem estoque, frete, NF-e, devolução, chargeback, fraude — nada disso existe no NutriDebby. Inflaria o código, os testes e a revisão de cada entrega | Domínio próprio, pode até usar uma plataforma pronta em vez de código (D3) |
| **Risco de produção** | Bug, pico de acesso (promoção) ou incidente de pagamento derruba ou expõe o prontuário. Deploy da loja = deploy do sistema de saúde | Falha isolada; o consultório segue funcionando |
| **Segurança** | Mais superfície pública (catálogo, checkout, webhooks de pagamento) no mesmo app que guarda dado de saúde | Superfície pública separada; o checkout fica no gateway (o cartão nunca passa pelos nossos servidores) |
| **Deploy e revisão** | Cada mudança da loja passa pelo fluxo pesado do NutriDebby (RLS, auditoria, guardas de CI) sem necessidade | Fluxo próprio, mais leve, proporcional ao risco |
| **Custo de infraestrutura** | Zero serviço novo | Mais 1 app + 1 banco na VPS (estimativa **~0,7–1 GB de RAM**, a medir), ou plataforma pronta (mensalidade/taxa — D3, D8). A VPS já tem o NutriDebby (~3 GB, RNF-03) e o `cursoia_crm` (P-05) |
| **Reuso** | Reaproveita autenticação, layout e PDF | Reaproveita **o conhecimento e o stack** (Next.js, Drizzle, Better Auth, pg-boss), não o banco nem as contas |

**Recomendação (D1): projeto separado.** O único ganho do módulo (não subir serviço novo) não compensa misturar e-commerce com prontuário. Se o dono optar por plataforma pronta (D3), o "projeto separado" vira só configuração, sem código.

---

## 3. Ética do CFN sobre vender e indicar produtos

### 3.1 Qual código vale

| Período | Norma | Situação |
|---|---|---|
| Até 22/01/2027 | **Res. CFN 599/2018** (Código de Ética e de Conduta do Nutricionista) | Vigente |
| A partir de 23/01/2027 | **Res. CFN 856/2026** (novo Código de Ética e Conduta), publicada no DOU em 28/04/2026; revoga a 599/2018 | Em vacância. A vigência original era 90 dias após a publicação (art. 117); uma resolução do CFN de 20/07/2026 prorrogou a vacância por 180 dias a partir de 27/07/2026, até 23/01/2027 — **número dessa resolução a confirmar** (a nota editorial do LegisWeb cita "Res. CFN nº 156", provável erro de digitação; uma busca aponta "nº 858", também não conferido no DOU) |

Como a loja só vem depois do go-live e da Fase 3, ela nasce sob a **Res. 856/2026**. A spec dos documentos assinados (RN-151, §3.5 de lá) cita a 599/2018; ver P-L4.

**O texto da 856/2026 ainda pode mudar.** Na Nota de Posicionamento de maio de 2026, o CFN abriu escuta e consulta pública virtual (13/05 a 13/06/2026) e afirmou que a publicação "não impede a continuidade do processo de escuta e participação da categoria, tampouco inviabiliza eventuais adequações, aperfeiçoamentos ou ajustes". A prorrogação da vacância vai no mesmo sentido. Os arts. 60, 63, 74, 75, 76 e 77, que sustentam esta nota, podem ser alterados antes ou depois de 23/01/2027 (R-L9). Antes de decidir a D2 e a D9, conferir o texto consolidado vigente (P-L6).

### 3.2 O que a Res. CFN 856/2026 diz (texto publicado em 28/04/2026, conferido)

| Artigo | Regra | Efeito na loja |
|---|---|---|
| **Art. 74, caput** | Vedado "prescrever, indicar, manifestar preferência ou associar sua imagem para divulgar, fazer publicidade ou propaganda de marcas de alimentos, bebidas, suplementos alimentares, fitoterápicos, […] utensílios, […] farmácias, empresas ou indústrias do setor", presencialmente, por telenutrição ou em mídias sociais | Regra geral: a nutricionista **não** promove marca nem loja |
| **Art. 74, I, a** | Permitida a associação da imagem quando a nutricionista "for a(o) profissional responsável técnica(o) pelo desenvolvimento dos itens" | Cobre o produto que **ela desenvolveu** como responsável técnica |
| **Art. 74, I, b** | Permitida quando a nutricionista "for sócia(o) ou proprietária(o) do estabelecimento ou da empresa que desenvolva os itens" | Na leitura literal, a exceção cobre a dona do negócio que **desenvolve ou fabrica** o produto (marca própria, **Modelo A1**). **Revender marcas de terceiros** com a imagem dela (**Modelo A2**) não está claramente coberto e pode cair no caput — **a confirmar** com o CRN-3 (P-L1) |
| **Art. 74, parágrafo único** | Nos casos do inciso I, "é vedada a vinculação à prescrição dietética individualizada, sendo obrigatória a declaração de conflito de interesses" | **Nada** de link da receita, do plano ou do parecer para produto da loja; declaração de conflito **sempre** visível |
| **Art. 74, II** | Comunicação técnico-científica dirigida a profissionais, sem fim publicitário, com conflito declarado | Não se aplica à loja (público é consumidor) |
| **Art. 74, III** | Na prescrição dietética, "quando houver necessidade de mencionar marcas, a(o) nutricionista deve apresentar mais de uma opção, quando disponível, e, não havendo substituto equivalente […], admite-se a indicação de marca única, com a devida justificativa" | A receita do NutriDebby **não tem campo de marca** (RN-151): é mais restritiva que o art. 74, III, **por escolha do produto**, não por exigência da norma |
| **Art. 74, IV** | Veda vestimentas e materiais de trabalho com marca, salvo nos casos do inciso I | Material da loja com a marca própria dela entra na exceção do inciso I |
| **Art. 75** | Pode atender em locais cuja atividade-fim seja a comercialização de alimentos, suplementos, fitoterápicos etc., "desde que respeitadas as legislações vigentes" | Atender e vender no mesmo lugar deixa de ser vedado (era, na 599/2018, art. 61) |
| **Art. 76** | Vedado "condicionar, subordinar ou sujeitar sua prática e exercício profissional a qualquer forma de venda casada" | Consulta, plano ou retorno **nunca** dependem de compra; nada de "pacote consulta + suplemento" obrigatório |
| **Art. 60** | Vedado "aproveitar-se de situações decorrentes da sua relação profissional […] para obter qualquer tipo de vantagem ou benefício para si ou para terceiros" | Não usar o vínculo terapêutico (portal, mensagens do consultório, lembretes, dados do paciente) para vender |
| **Art. 63** | Vedado "receber comissão, remuneração, gratificação ou benefício que não corresponda a serviços prestados" | **Comissão por venda** (afiliado, cupom, repasse da plataforma) à nutricionista é o ponto mais arriscado |
| **Art. 77, caput** | Vedado "receber patrocínio ou vantagens financeiras de empresas ou indústrias ligadas ao campo da alimentação e nutrição" | Reforça o art. 63 para afiliado e repasse |
| **Art. 77, parágrafo único** | Quem exerce outra atividade remunerada deve "declarar, de maneira evidente e ostensiva, a existência de conflito de interesses, mantendo essa atuação expressamente dissociada de seu exercício profissional como nutricionista" | A loja é **outra atividade**: precisa ficar **dissociada** do atendimento. Um item de menu no portal clínico é o oposto de dissociado — por isso a D5 recomenda "não mostra" até o CRN-3 responder |
| **Art. 69, § 6º** | Vedado "alegar a garantia dos resultados para produtos, técnicas, protocolos" | Textos da loja sem promessa de resultado ("emagreça X kg") |
| **Arts. 17 e 24** | Declarar conflitos de interesses sempre que existirem | Base da declaração da D6 |

### 3.3 Até 22/01/2027 (Res. CFN 599/2018, texto conferido)

Para uma **loja online, sem atendimento no local**, pesam:

- **Art. 60:** vedado "prescrever, indicar, manifestar preferência ou associar sua imagem intencionalmente para divulgar marcas de produtos alimentícios, suplementos nutricionais, fitoterápicos, utensílios […]" (com mais de uma opção quando mencionar marca, inciso III);
- **Art. 63:** vedado "fazer publicidade ou propaganda em meios de comunicação com fins comerciais, de marcas de produtos alimentícios, suplementos nutricionais, fitoterápicos, utensílios, equipamentos […]";
- art. 62 (venda casada) e arts. 49 e 64 (comissão e vantagem de empresas).

O **art. 61** trata de outra coisa: o **local de consulta** ("exercer ou associar atividades de consulta nutricional e prescrição dietética em locais cuja atividade-fim seja a comercialização…"). Sua ressalva (parágrafo único) alcança só "alimentos ou produto alimentício de **fabricação e marca próprias** de nutricionista" — **suplementos e fitoterápicos não estão nela**. Não serve de base para liberar uma loja de suplementos.

Consequência: antes de 23/01/2027, divulgar a loja com a imagem da nutricionista esbarra nos arts. 60 e 63 da 599/2018, e a 599/2018 não tem exceção equivalente ao art. 74, I, b. Se o dono quiser testar antes de 2027 (D3, validação), o teste fica restrito a **alimento ou produto alimentício de fabricação e marca próprias**, sem propaganda de marcas, e **só depois** da resposta do CRN-3 sobre esse caso (P-L1) — ou espera a vigência da 856/2026.

---

## 4. Modelos possíveis e obrigações de cada um

O Modelo A se divide em dois, por causa do art. 74, I, b (§3.2):

- **A1 — produto próprio:** a loja da nutricionista vende itens que a empresa dela **desenvolve ou fabrica** (marca própria, inclusive produção terceirizada sob a marca dela — enquadramento da terceirização **a confirmar**, P-L1).
- **A2 — revenda de terceiros:** a loja da nutricionista revende marcas de outras empresas.

| | A1. Loja própria — produto próprio | A2. Loja própria — revenda de terceiros | B. Marketplace de terceiros (lojistas vendem, plataforma intermedia) | C. Afiliado / indicação | D. Venda pela plataforma com repasse à nutricionista |
|---|---|---|---|---|---|
| **Quem vende (fornecedor no CDC)** | A nutricionista (CNPJ dela) | A nutricionista (CNPJ dela) | Cada lojista; a plataforma como intermediadora | A loja externa | O dono (CNPJ da plataforma) |
| **CFN** | **Permitido** pela leitura literal do art. 74, I, b + declaração de conflito + sem vínculo com a prescrição (856/2026) | **Enquadramento incerto**: associar a imagem a marcas de terceiros pode cair no art. 74, caput — **a confirmar** com o CRN-3 (P-L1) | Se a nutricionista for lojista, igual a A1 ou A2; se só "indicar" lojistas, cai no art. 74, caput | **Alto risco**: comissão ou vantagem por indicação (arts. 60, 63, 77) e indicação de marca (art. 74) | **Alto risco**: repasse por venda ao paciente = comissão (art. 63) e vantagem da relação profissional (art. 60) |
| **CDC** (Lei 8.078/1990; Decreto 7.962/2013) | Integral para ela: informação clara (fornecedor, CNPJ, endereço, características, preço com frete, prazo), atendimento, **arrependimento em 7 dias** (art. 49) pelo mesmo meio da compra | Igual a A1 | Lojista responde; a responsabilidade solidária do intermediador é tema de jurisprudência — **a confirmar** com advogado | Da loja externa | Integral para o dono |
| **Nota fiscal** | NF-e/NFC-e de produto (ICMS) emitida por ela; CNAE de fabricação e/ou comércio e enquadramento **a confirmar com contador** | NF-e/NFC-e; CNAE de comércio varejista **a confirmar** | NF-e de cada lojista + **NFS-e** do dono pela comissão de intermediação | Nenhuma da plataforma (só NFS-e se o dono receber comissão como afiliado) | NF-e de produto pelo dono + tratamento fiscal do repasse — **a confirmar** |
| **Anvisa** | Produto próprio também precisa estar **regularizado**: suplementos seguem a RDC 243/2018 e, pelo novo marco (RDC 843/2024; prazo da RDC 990/2025 encerrado em 01/09/2026), precisam de **notificação** na Anvisa; quem fabrica responde pela regularização e pelo licenciamento sanitário da produção (**a confirmar**, P-L3) | Só vender produto **regularizado**, conferido no portal da Anvisa antes de anunciar | Igual, por lojista; a plataforma deveria exigir comprovação | Da loja externa | Igual a A2, para o dono |
| **Fora do catálogo (todos)** | **Medicamentos**, inclusive fitoterápicos em forma farmacêutica: dispensação privativa de farmácia, drogaria e afins (Lei 5.991/1973, art. 6º). **Plantas medicinais e drogas vegetais**: dispensação privativa de farmácias e ervanarias (art. 7º). Chás enquadrados como **alimento** seguem norma própria da Anvisa — **a confirmar** (P-L3). Licença ou alvará sanitário do comércio: **a confirmar** com a vigilância sanitária local (P-L3) | Igual | Igual | — | Igual |
| **Frete e devolução** | Contrato de frete dela; devolução no arrependimento sem custo para o consumidor (**a confirmar** quem paga o frete de volta, entendimento majoritário = fornecedor) | Igual a A1 | Por lojista | Da loja externa | Do dono |
| **Pagamento** | Conta de pagamento **dela** (Asaas ou outro); checkout hospedado pelo gateway; **sem split** | Igual a A1 | **Split** obrigatório (Asaas: só pela API, uma subconta/`walletId` por recebedor, estorno desfaz os repasses); KYC de cada lojista | Nenhum na plataforma | Split ao contrário (dono → nutricionista) — o próprio repasse é o problema ético |
| **Esforço** | Baixo a médio (mais o de desenvolver o produto) | Baixo a médio | **Alto** (onboarding de lojistas, disputa, repasse, NFS-e) | Baixo técnico, alto ético | Médio técnico, alto ético e fiscal |
| **Veredito** | **Recomendado** | **Só depois** de resposta escrita favorável do CRN-3 (P-L1) | Só se o dono quiser virar operador de marketplace — fora do escopo de um SaaS de consultório | **Descartar** para a nutricionista | **Descartar** |

### 4.1 Relação com o Asaas da Fase 2

O Asaas da Fase 2 é a conta **do dono** para cobrar a **assinatura do SaaS** (§10 da spec do MVP). A loja **não usa essa conta**: nos modelos A1/A2 cada nutricionista vendedora tem a **própria conta** de recebimento e as chaves ficam no projeto da loja, nunca no NutriDebby. Misturar daria receita de venda de produto no CNPJ do dono (fiscal) e um ponto único de falha entre assinatura e loja. O split só entra se o dono escolher B (ou cobrar comissão por venda, D4). Taxas do Asaas por transação e por split: **a confirmar** na tabela vigente no momento da decisão.

---

## 5. Integração mínima com o NutriDebby (sem misturar bases)

| Ponto | Proposta | Por quê |
|---|---|---|
| Link geral no portal do paciente | **Não mostrar** até o CRN-3 responder por escrito (P-L1). Se a resposta liberar: opcional, **desligado por padrão**, ligado pela nutricionista em Configurações; um item de menu fixo (não personalizado) com a declaração de conflito (D6) e as regras de segurança abaixo | O portal só existe por causa da relação profissional: usá-lo para vender esbarra no art. 60, e o art. 77, parágrafo único, exige que a outra atividade fique "expressamente dissociada" do exercício profissional. O art. 74, I, b não fala em canal de atendimento — não autoriza nem proíbe o link; a dúvida é do CRN-3 |
| Receita, plano, parecer, lembretes, WhatsApp, e-mails do consultório | **Nunca** citam a loja nem produto | Art. 74, parágrafo único; art. 60; art. 77, parágrafo único; RN-151 |
| Login único (SSO) | **Não.** Conta da loja separada (ou compra sem conta) | O SSO diria à loja "esta pessoa é paciente desta nutricionista" — vínculo com serviço de saúde; e criaria dependência técnica entre os sistemas |
| Dados do paciente (nome, e-mail, plano) na loja | **Nunca** importados; nada de "produtos para você" com base no plano | LGPD, art. 6º, I e II (finalidade e adequação: o dado foi coletado para o acompanhamento) e art. 11 (nenhuma hipótese do inciso II cobre marketing; o consentimento específico do inciso I não é coletado e, pedido no atendimento, esbarraria no art. 60 do CFN). Quando a loja é de **outro controlador** (Modelos B, C e D), soma-se o art. 11, § 4º (vedada a comunicação ou o uso compartilhado **entre controladores** de dado de saúde para vantagem econômica). A proibição contratual do uso pela própria nutricionista vem da P-L7 |
| Dados da loja no NutriDebby | Nenhum (nem histórico de compras no prontuário) | Evita que a compra vire parte do acompanhamento (venda casada, art. 76) |
| Marca visual | A loja pode usar a identidade da nutricionista no Modelo A1 (art. 74, I, b); no A2, só após a P-L1 | — |

**Regras de segurança do link (só se a D5 liberar):**

- URL **somente `https://`**, validada **no servidor** ao salvar (nada de `javascript:`, `data:` nem `http:`); o paciente vê o domínio de destino antes de clicar.
- Link com `rel="noopener noreferrer"` e `Referrer-Policy: no-referrer` na página do portal que o exibe. Sem isso, o padrão do navegador (`strict-origin-when-cross-origin`) entrega à loja a origem do portal, ou seja, "esta pessoa é paciente" — a mesma inferência que faz recusar o SSO. Hoje o `next.config.ts` só aplica `no-referrer` em `/convite` e `/consulta`.
- **Sem parâmetros** de rastreamento ou identificação do paciente na URL (nada de `?paciente=`, UTM por paciente, cupom individual).
- A mudança só entra **depois do Plano 06** (o portal do paciente) e da validação da D3/D10.

Com isso, o lado do NutriDebby se resume a **uma configuração** (`tenants.loja_url` + `loja_ativa`, padrão `false`) e um item de menu no portal — se a D5 for aprovada depois da P-L1. Não há tabela nova com `tenant_id`, nem RLS, nem auditoria envolvidas.

---

## 6. Custos e riscos

### 6.1 Custos (quem paga)

| Item | Modelo A com plataforma pronta | Modelo A com loja própria (código nosso) | Quem paga |
|---|---|---|---|
| Desenvolvimento | ~zero (configuração) | Semanas de trabalho (catálogo, carrinho, checkout hospedado, webhooks, pedidos, estoque, NF-e, devolução) | Dono (tempo) |
| Hospedagem | Mensalidade e/ou taxa por venda da plataforma — **a confirmar** por fornecedor | ~0,7–1 GB de RAM na VPS (a medir); pode antecipar a migração da P-05 | Plataforma: nutricionista ou dono (D8). VPS: dono |
| Domínio | ~R$ 40/ano para `.com.br` (**a confirmar** no registro.br) | Igual | Nutricionista (a loja é dela) |
| Gateway de pagamento | Taxa por transação (cartão, PIX, boleto) — **a confirmar** | Igual | Vendedora (nutricionista) |
| Emissão de NF-e | Emissor (muitas vezes pago) + certificado e-CNPJ — **a confirmar** | Integração com emissor (custo por nota, **a confirmar**) | Vendedora |
| Contador, alvará/licença sanitária, frete, estoque | Por conta da operação | Igual | Vendedora |

Pela restrição do dono (nenhum custo extra sem aceite explícito), **qualquer** linha que caia no dono vira decisão (D3, D4, D8).

### 6.2 Riscos

| ID | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R-L1 | Processo ético no CRN contra a nutricionista (revenda de marca de terceiros fora do art. 74, I, b; indicação vinculada; comissão; venda casada; uso do portal para vender) | Média | Alto | Modelo A1; A2 e o link no portal só com resposta escrita do CRN-3 (P-L1); sem vínculo com prescrição (§5); declaração de conflito |
| R-L2 | Venda de suplemento sem notificação na Anvisa, de medicamento (inclusive fitoterápico) ou de planta medicinal/droga vegetal fora de farmácia ou ervanaria | Média | Alto | Catálogo só com produto regularizado, conferido no portal da Anvisa; sem medicamentos, plantas medicinais nem drogas vegetais (D7; Lei 5.991/1973, arts. 6º e 7º) |
| R-L3 | Uso de dado de saúde para vender (LGPD, arts. 6º, I e II, e 11; § 4º quando há outro controlador) | Baixa com projeto separado; **alta** como módulo | Muito alto | D1 (bases separadas); sem SSO nem importação de pacientes; cláusula nos termos e no DPA (P-L7) |
| R-L4 | Incidente da loja afeta o prontuário (queda, invasão) | Baixa separado; média como módulo | Alto | D1; limites de recurso no Easypanel; checkout hospedado (sem cartão nos nossos servidores) |
| R-L5 | Falta de memória na VPS com mais um app + banco | Média | Alto (afeta `cursoia_crm` e NutriDebby) | Plataforma pronta ou medir antes; limites do Easypanel; P-05 |
| R-L6 | Obrigações de CDC mal cumpridas (arrependimento, informação, atendimento) | Média | Médio | Textos de política de troca e informação do Decreto 7.962/2013 revisados por advogado (P-L2) |
| R-L7 | Demanda baixa: semanas de desenvolvimento para poucas vendas | Média | Médio | Validar sem código antes de construir (D3) com meta objetiva (D10) |
| R-L8 | A loja desvia o foco do MVP e da Fase 3 | Média | Médio | Só depois do go-live e da Fase 3 (D9) |
| R-L9 | Texto da Res. CFN 856/2026 alterado antes ou depois da vigência (consulta pública de maio/junho de 2026; CFN admite ajustes) | Média | Alto (a análise da §3.2 pode cair) | Conferir o texto consolidado vigente antes da D2 e da D9 (P-L6); a consulta ao CRN-3 (P-L1) cita o texto vigente na data |

### 6.3 Pendências

| ID | Pendência | Responsável |
|---|---|---|
| P-L1 | Consulta escrita ao **CRN-3**, sobre o texto vigente na data: (1) a alínea b do art. 74, I, alcança a **revenda de marcas de terceiros** pela loja de que a nutricionista é dona, ou só itens que a empresa dela desenvolve? Produção terceirizada sob marca própria conta como "desenvolver"? (2) **link geral da loja no portal do paciente** é compatível com os arts. 60 e 77, parágrafo único? (3) texto da declaração de conflito (D6); (4) até 22/01/2027, loja online de produto próprio sem atendimento no local é compatível com os arts. 60 e 63 da 599/2018, dado que a ressalva do art. 61 cobre só alimentos e produtos alimentícios próprios? (5) número da resolução que prorrogou a vigência | Debby / dono |
| P-L2 | **Advogado**: CDC no modelo escolhido, política de troca e devolução, responsabilidade do intermediador (se B), termos e aviso de privacidade da loja; revisão da cláusula da P-L7 | Dono |
| P-L3 | **Contador e vigilância sanitária**: CNPJ e CNAE da vendedora (fabricação e/ou comércio), ICMS e NF-e, licença sanitária para fabricar ou comerciar suplementos; enquadramento de **chás** (alimento × planta medicinal/droga vegetal) | Debby |
| P-L4 | Atualizar a spec dos documentos assinados (RN-151, §3.5, referências) para citar também a Res. CFN 856/2026, que substitui a 599/2018 em 23/01/2027, incluindo o art. 74, III (RN-151 é mais restritiva por escolha do produto) | Orquestrador / revisão da spec B |
| P-L5 | Medir RAM real de um app + banco mínimos antes de decidir hospedagem na VPS (D8) | Dono (com apoio técnico) |
| P-L6 | Conferir o **texto consolidado vigente** da Res. CFN 856/2026 (e eventuais alterações da consulta pública de 2026) antes de decidir a D2 e a D9; refazer a §3.2 se mudar | Orquestrador (na retomada da F4-01) |
| P-L7 | Incluir nos **termos de uso e no DPA do NutriDebby** a proibição expressa de usar dados de pacientes tratados na plataforma (inclusive exportações) para divulgar ou vender produtos. Texto final aprovado pelo dono, revisado pelo advogado (P-L2) | Dono |

---

## 7. Referências

| Norma / fonte | Usada em | URL |
|---|---|---|
| Res. CFN nº 856/2026 (novo Código de Ética e Conduta da(o) Nutricionista), arts. 17, 24, 60, 63, 69 § 6º, 74 (caput, I a IV, parágrafo único), 75, 76, 77 (caput e parágrafo único) e 117 — texto publicado em 28/04/2026 | §1, §3.1, §3.2, §4, §5 | https://www.legisweb.com.br/legislacao/?id=494878 · https://legismap.com.br/leis-e-normas/resolucao-cfn-n-856-de-25-04-2026 |
| Resolução do CFN de 20/07/2026 que prorroga a vacância da Res. 856/2026 até 23/01/2027 — **número a confirmar** | §3.1 | (nota editorial em https://www.legisweb.com.br/legislacao/?id=494878) |
| CFN — Nota de Posicionamento de maio de 2026 (consulta pública de 13/05 a 13/06/2026; possibilidade de ajustes) | §3.1, R-L9, P-L6 | https://cfn.org.br/nota-de-posicionamento-maio-2026 |
| CFN — notícia da atualização do Código de Ética | §3.1 | https://cfn.org.br/cfn-atualiza-codigo-de-etica-e-reforca-protecao-ao-paciente-e-a-pratica-profissional-na-nutricao/ |
| Res. CFN nº 599/2018 (Código de Ética e de Conduta do Nutricionista), arts. 49, 60 a 64 | §3.3 | https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html |
| Lei nº 8.078/1990 (CDC), art. 49 (arrependimento) | §4 | https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm |
| Decreto nº 7.962/2013 (comércio eletrônico) | §4, R-L6 | https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm |
| LGPD (Lei nº 13.709/2018), arts. 6º, I e II, 11 (caput, I, II e § 4º, este na redação da Lei nº 13.853/2019) | §1, §2, §5, R-L3 | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm · https://planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/l13853.htm |
| RDC Anvisa nº 243/2018 (suplementos alimentares) e IN nº 28/2018 com atualizações — versão vigente da IN **a confirmar** | §4, R-L2 | https://www.gov.br/anvisa/pt-br (Biblioteca de Alimentos) |
| RDC Anvisa nº 843/2024 (regularização de alimentos) e RDC nº 990/2025 (prazo de notificação de suplementos até 01/09/2026) | §4, R-L2 | https://legismap.com.br/conteudos/artigos-e-noticias/noticias-anvisa-em-01-09-2026 |
| Lei nº 5.991/1973, art. 6º (dispensação de medicamentos privativa de farmácia, drogaria, posto e dispensário) e art. 7º (dispensação de plantas medicinais privativa de farmácias e ervanárias) | §4, R-L2, D7 | https://legis.senado.leg.br/norma/547867/publicacao/15809512 |
| Asaas — split de pagamentos (só pela API; `walletId` por recebedor; estorno desfaz repasses) | §4, §4.1 | https://docs.asaas.com/docs/faq-do-split · https://docs.asaas.com/docs/duvidas-frequentes-split |

---

## Pontos menores (backlog)

- Todos os achados da revisão (1 crítico, 2 importantes, 8 menores) foram aplicados nesta versão 0.2; nenhum foi recusado.
- Número da resolução que prorrogou a vacância da 856/2026: segue **a confirmar** no DOU (as fontes divergem entre "nº 156" e "nº 858"); levado à P-L1.
- Enquadramento de produção terceirizada sob marca própria ("empresa que desenvolva os itens") no Modelo A1: levado à P-L1, sem bloquear a recomendação.

---

## Decisões pendentes do dono

| ID | Pergunta | Opções | Recomendação |
|---|---|---|---|
| D1 | A loja é módulo do NutriDebby ou outro projeto? | a) módulo no mesmo app e banco · b) projeto separado (repositório, banco, serviço e domínio próprios) | **b) Projeto separado** (§2): impede pelo sistema o uso de dado de saúde fora da finalidade (LGPD, arts. 6º, I e II, e 11), cumpre o art. 74, parágrafo único, por construção e não arrisca o prontuário. Complemento contratual na P-L7 |
| D2 | Quem é a vendedora e o que ela vende? | A1) a nutricionista, com CNPJ dela, produto próprio · A2) a nutricionista revendendo marcas de terceiros · B) marketplace de lojistas · C) afiliado/indicação com comissão · D) o dono vende e repassa à nutricionista | **A1.** A2 só depois de resposta escrita favorável do CRN-3 (P-L1) e conferido o texto vigente (P-L6). Descartar C e D (comissão por venda: Res. CFN 856/2026, arts. 60, 63 e 77). B só se o dono quiser operar marketplace — outro negócio |
| D3 | Como começar? | a) validar sem código (link de pagamento e catálogo simples da nutricionista) · b) plataforma de loja pronta · c) loja própria em código | **a) Validar primeiro** (custo R$ 0 para o dono); passar para b ou c só quando a meta da D10 for atingida, com os custos na mesa. Antes de 23/01/2027, só alimento ou produto alimentício de fabricação e marca próprias, sem propaganda de marcas, e depois da resposta do CRN-3 (§3.3; Res. 599/2018, arts. 60 e 63) |
| D4 | O dono ganha com a loja? Como? | Nada no piloto · mensalidade fixa pelo serviço de loja (produto separado) · comissão por venda cobrada da nutricionista (exige split e NFS-e) | **Nada no piloto; depois, mensalidade fixa**, se for o caso. Comissão cobrada **pelo dono da** nutricionista não é vantagem recebida por ela (não fere os arts. 63 e 77), mas traz custo de split e NFS-e por venda. Comissão **paga à** nutricionista continua vedada (Modelos C e D) |
| D5 | O NutriDebby mostra a loja ao paciente? | Não mostra · link geral no portal, desligado por padrão, com declaração de conflito (**condicionado** à resposta escrita do CRN-3, P-L1) · link + login único (SSO) | **Não mostra** até o CRN-3 responder por escrito (arts. 60 e 77, parágrafo único). Se liberado, link geral desligado por padrão com as regras de segurança da §5 (só `https://` validada no servidor, `noopener noreferrer` + `no-referrer`, sem parâmetros do paciente), depois do Plano 06. **Sem SSO**; nunca em receita, plano, parecer, lembretes ou WhatsApp |
| D6 | Texto da declaração de conflito (sensível) | Proposta: "Declaração de conflito de interesses: sou proprietária desta loja. A compra é opcional e não faz parte do seu acompanhamento nutricional." | Aprovar **com a Debby** e levar na consulta ao CRN-3 (P-L1) antes de publicar |
| D7 | O que pode ser vendido? | Produtos próprios regularizados (alimentos, suplementos, utensílios de marca/fabricação da nutricionista) · + revenda de marcas de terceiros regularizadas · + medicamentos fitoterápicos, plantas medicinais ou drogas vegetais | **Só produto próprio regularizado** até a resposta do CRN-3 (P-L1); revenda de terceiros depois, se liberada. **Nunca** medicamentos (inclusive fitoterápicos), plantas medicinais nem drogas vegetais (Lei 5.991/1973, arts. 6º e 7º); chás só se enquadrados como alimento (P-L3) |
| D8 | Onde a loja roda (se for construída)? | Mesma VPS (novo projeto no Easypanel) · VPS separada · plataforma pronta (SaaS) | Decidir **depois da validação** (D3/D10) e da medição (P-L5). Na VPS atual só com limites no Easypanel e sem afetar `cursoia_crm`; custo de plataforma pronta, se escolhida, pago pela vendedora |
| D9 | Quando? | Logo após o go-live · depois da Fase 3 (F3-01..F3-06) · sem data, sob demanda | **Depois da Fase 3**, como na §10, e só com P-L1 a P-L3 e P-L6 resolvidas. A validação sem código (D3-a) pode ser feita pela Debby a qualquer momento, fora do sistema, sem trabalho de desenvolvimento, **respeitada a restrição da §3.3 até 22/01/2027 e depois da resposta do CRN-3 (P-L1)** |
| D10 | Qual meta de demanda dispara construir ou contratar a loja (D3-b/c, D8)? | a) número mínimo de pedidos pagos por mês, sustentado por um prazo de observação · b) faturamento mensal mínimo no mesmo prazo · c) sem meta (decisão caso a caso) | **a) Pedidos pagos por mês, por 3 meses seguidos**, com o número fixado pelo dono e pela Debby **antes** de começar a validação (ponto de partida sugerido, sem dado histórico: 30 pedidos/mês, a calibrar). Pedidos são fáceis de contar no link de pagamento e não dependem de margem |

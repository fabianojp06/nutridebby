---
name: fontes-lgpd-mascara-ia
description: Artigos da LGPD conferidos no Planalto (17/11/2026) e a decisão sobre o nome social na máscara da IA (P18-11)
---

Conferidos em 17/11/2026 em https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm:
art. 6º, III; art. 8º, § 6º; art. 9º, §§ 1º e 2º; art. 13, § 4º; art. 18, II e V; art. 19, II e § 3º; art. 33, VIII.

Decisão (Plano 18, P18-11, RN-282): pôr o nome social do próprio paciente na máscara (`outrosNomes`, mesma regra do
nome de registro) NÃO exige versão nova da autorização 1.1, do consentimento da IA Nutri 1.0 nem do aditivo 1.2 (item 5).
- Art. 8º, § 6º só exige aviso quando muda inciso I, II, III ou V do art. 9º (finalidade, forma/duração, controlador,
  compartilhamento); art. 9º, § 2º só a mudança de finalidade incompatível. Nada disso muda; sai menos dado.
- A autorização (textos-legais.ts, "O que é enviado") só promete nova autorização "se isso mudar"; não aumenta.
- Boa prática: na próxima versão desses textos, "o seu nome (inclusive o nome social, se houver)".
- Redação final segue com o advogado (D11/E-09); nada novo para ele nem para o CRN-3.
Registrado no comentário de cabeçalho de `src/modules/ia/pseudonimizar.ts`.
- Reconferidos no Planalto em 23/11/2026: art. 5º, I; 6º, III; 7º, V e IX; 18, caput, I e II; 19, caput, I, II e §§ 1º a 4º (o 19, II ressalva só segredo comercial e industrial; o § 3º dá cópia integral quando a base é consentimento ou contrato).
- Conferidos no Planalto em 23/11/2026 (revisão da T7 do Plano 23): art. 6º caput, I (finalidade), III (necessidade) e VI (transparência); art. 8º caput (meio que demonstre a vontade) e § 2º (ônus da prova é do controlador); art. 9º caput, I a VII; art. 15, I (finalidade alcançada); art. 16 caput e I (eliminação após o término); art. 46 caput (segurança). Parecer da T7: registrar em `consents` o aceite da página com `aceito_em = verificado_em`, gravado depois pela sessão `nutri`, é prova válida se copia fielmente o pedido (versão, IP, verificação do e-mail) e o `audit_log` mostra quem criou o paciente e quando.
- Conferidos no Planalto em 24/11/2026 (revisão da T10 do Plano 23, aniversário): art. 5º, XII e XIII; art. 8º, caput e §§ 1º, 2º, 4º (genérica é nula), 5º (revogação facilitada) e 6º; art. 9º, caput, I a VII, § 1º (nulo sem transparência prévia) e § 2º; art. 14, caput e §§ 1º a 6º (o § 1º, pais ou responsável, é só para criança); art. 18, II, VI, VIII e IX. Parecer da T10: nome social na saudação do WhatsApp aceito (AG-D35 cobre a 'saudação'; projeção na lista é o padrão do Plano 18). Important I-1: o 'Abrir no WhatsApp' usa a autorização informada como 'uma por ano, por e-mail'; o texto do portal não cita o WhatsApp nem o telefone (art. 9º, § 1º).

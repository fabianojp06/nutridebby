# Plano 15 — Caderno de decisões da IA Nutri do paciente

| Item | Valor |
|---|---|
| Data | 09/10/2026 |
| Para quem | O dono do NutriDebby |
| Base | Spec [`2026-10-03-nutridebby-paciente-exames-ia-design.md`](2026-10-03-nutridebby-paciente-exames-ia-design.md), **v0.4**, §18 (lá estão os detalhes técnicos de cada decisão) |
| O que é a IA Nutri | Um assistente no app do paciente. Ele acha no plano alimentar a resposta para dúvidas simples ("quanto é 1 colher de arroz?"). Ele não cria conselho novo: mostra só o que a nutricionista escreveu. O resto vai para a nutricionista |

---

## Decisão do dono (10/10/2026)

**Todas as recomendações deste caderno aprovadas** ("minha decisão são suas recomendações"). Nas duas que tinham escolha em aberto:
- **D1:** prazo de **8 semanas** para a resposta do CRN-3; sem resposta, a decisão volta para o dono e a IA Nutri não liga no modo (d).
- **D3:** cota da IA Nutri de **US$ 7 por consultório por mês** (para não bloquear no pior caso da D4), dentro do teto global de US$ 50.

A D27 já foi aplicada ao plano da 14B (branch `plano-14b-ia-nutri`, Task 6: textos 1.1 com "Nestes usos, a IA não fala com você"). O plano do Plano 15 só é escrito depois da 14B-2; ligar com paciente real depende das consultas da D2 (CRN-3, advogado, RIPD) e, sem a confirmação por escrito da Anthropic, só a partir de 12/11/2026.

## Resumo

1. A parte da IA Nutri na spec foi revista contra o sistema de hoje. Muita coisa mudou desde 03/10.
2. Há **28 decisões**: 17 antigas (revistas) e 11 novas (D26 a D36).
3. Três delas são técnicas (D30, D31, D35). Pode aprovar a recomendação sem estudar.
4. O ponto mais urgente: os textos legais em uso dizem "a IA não fala com você". A IA Nutri fala. Isso precisa ser corrigido antes (D27).
5. A IA Nutri só pode começar **depois da 14B-2**, porque usa peças que a 14B cria.
6. Com o modelo mais barato (Haiku 5.5), a IA Nutri custa **centavos por paciente por mês** e cabe no teto atual de US$ 50.
7. Antes de ligar com paciente real, recomendo ouvir o **CRN-3** e o **advogado**. Sem confirmação por escrito da Anthropic, a IA Nutri só liga com paciente real **a partir de 12/11/2026**, quando a política nova dela entra em vigor (D2).
8. A Debby precisa escolher o nome que o paciente vê e revisar os textos.
9. Não há custo mensal novo além do uso da IA, dentro da cota. Há **custos pontuais de terceiros** a orçar antes de ligar: advogado (pode ir junto com o P14A-16), RIPD e revisão de um psicólogo (D2, D11). A tabela final marca quais decisões geram esse custo.
10. No fim há uma tabela com todas as recomendações, para aprovar de uma vez.

## O que já vem decidido de fora (não precisa decidir de novo)

- **A-D27 (09/10/2026):** a IA usa a Anthropic direta, nos Estados Unidos. A Anthropic guarda os dados por até 30 dias. Os textos 1.0 foram publicados sem advogado, por sua decisão.
- **Plano 14A (em produção):** o paciente autoriza a IA por escrito, para cada uso. A autorização diz para onde os dados vão. O paciente pode retirar quando quiser, em Eu › Privacidade.
- **Plano 14B (aprovado, ainda não feito):** IA para a nutricionista (modelos, resumo, rascunho de plano). Vem em duas partes (14B-1 e 14B-2). A 14B-2 publica os textos 1.1.
- **Plano 16 (em produção):** o app do paciente tem 5 seções fixas: Hoje, Jornada, Plano, Exames e Eu.

## Ordem sugerida para decidir

Decidir nesta ordem destrava o resto:

1. **D27 e D26** — textos legais e onde guardar o "sim" do paciente. Mexem na 14B, que vem antes.
2. **D2 e D36** — quem consultar fora (CRN-3, advogado) e o que fazer quando o novo Código de Ética valer. Leva tempo; melhor começar cedo.
3. **D1, D21, D24** — como a IA responde e o que a nutricionista faz com as dúvidas.
4. **D5, D3, D4** — modelo, custo e limites.
5. **D28, D29, D34** — nome, lugar no app e jeito de falar com o paciente.
6. As demais.

---

## Bloco 1 — Textos legais e consentimento

### D27 — Em que ordem fazer e como corrigir os textos legais

**Pergunta:** como corrigir os textos que dizem "a IA não fala com você", sem pedir de novo a autorização de IA dos exames a todos os pacientes?

**Opções:**
- **(a)** Fazer o Plano 15 depois da 14B-2. Antes de fazer a 14B-2, trocar uma frase nos textos 1.1: "Nestes usos, a IA não fala com você". No Plano 15, só a nutricionista aceita um aditivo novo (1.2). Os pacientes não precisam refazer a autorização de IA dos exames. Quem for usar a IA Nutri dá um "sim" separado, só para ela (D26).
- **(b)** Não mexer na 14B. No Plano 15, publicar uma autorização 1.2 nova. Todos os pacientes autorizam de novo, pela segunda vez em poucas semanas.
- **(c)** Fazer o Plano 15 antes da 14B-2. Refazer partes da 14B.

**Recomendação: (a).** É uma frase só, que fica verdadeira e mais precisa. Evita pedir duas vezes a mesma coisa aos pacientes. O aditivo 1.2 só trava a IA Nutri, não a leitura de exames.

**Se escolher outra:** com (b), cada paciente vê "o texto mudou" duas vezes e perde a IA até decidir de novo. Com (c), a 14B atrasa e precisa ser refeita em parte.

**Depende de terceiro:** não para decidir. O advogado revisa os textos depois (já está na lista do P14A-16).

### D26 — Onde guardar o "sim" do paciente para a IA Nutri

**Pergunta:** o consentimento da IA Nutri fica num registro próprio ou junto da autorização de IA que já existe?

**Opções:**
- **(a)** Registro próprio, copiando o jeito seguro da autorização que já existe (data, para onde vai, aparelho, sem apagar).
- **(b)** Junto da autorização atual, com uma marca "IA Nutri". Todo o sistema da 14A passa a separar pela marca.
- **(c)** Como mais um uso dentro da autorização única. Todos autorizam de novo; retirar vale para tudo.

**Recomendação: (a).** Um "não" para a IA Nutri nunca desliga, por engano, a leitura de exames. A lei pede que o "sim" seja específico para cada finalidade, e separar é o jeito mais seguro de garantir isso, além de deixar o paciente aceitar uma coisa e recusar a outra. Para o paciente, os dois aparecem lado a lado em Eu › Privacidade.

**Se escolher outra:** com (b), qualquer ponto esquecido do sistema pode tratar "desligar a IA Nutri" como "retirar tudo". Com (c), o paciente não consegue aceitar uma coisa e recusar a outra.

**Depende de terceiro:** não.

### D11 — Quem revisa os textos sensíveis

**Pergunta:** quem revisa os textos de consentimento, de emergência e de transtorno alimentar antes de ligar?

**Opções:**
- **(a)** Debby, advogado e, nos textos de risco, um psicólogo.
- **(b)** A Debby revisa e você publica como versão final, como fez na A-D27.
- **(c)** Usar os textos propostos como estão.

**Recomendação: (a).** A A-D27 valeu só para a autorização de exames. Estes textos falam com o paciente em crise. E o que ele escreve sai do Brasil. O psicólogo também escreve um **protocolo curto para a nutricionista**: o que fazer ao receber um "Sinal de risco" (contatar o paciente, indicar CAPS ou psicólogo, registrar no prontuário). O protocolo aparece na própria fila. É boa prática, não exigência do CFN para paciente adulto.

**Se escolher outra:** com (b), o risco fica anotado no backlog, como na A-D27. Com (c), o texto vai sem nenhuma revisão profissional.

**Depende de terceiro:** Debby, advogado e psicólogo. **Custo pontual:** honorários do advogado e do psicólogo.

### D2 — Consultas externas antes de ligar

**Pergunta:** quem precisamos ouvir antes de ligar a IA Nutri com paciente real?

**Opções:**
- **(a)** CRN-3, advogado, relatório de impacto (RIPD) e uma confirmação por escrito da Anthropic, obrigatória.
- **(b)** O mesmo de (a), mas a confirmação da Anthropic vira boa prática: pedimos a confirmação à Anthropic. Sem resposta, só ligamos com paciente real a partir de 12/11/2026, já com a política nova em vigor.
- **(c)** Só o advogado.
- **(d)** Ninguém.

**Recomendação: (b).** A política nova da Anthropic deixa explicar um plano feito pela nutricionista, desde que a explicação não vire uma recomendação nova. Até 11/11/2026 vale a política antiga, que é ambígua para um plano clínico: por isso, sem a confirmação da Anthropic, a data de 12/11/2026 é condição para ligar (fica no roteiro do Plano 15). Se a Anthropic mudar a página de novo, a IA Nutri fica pausada até relermos o texto e você decidir.

**Perguntas ao CRN-3** (a resposta precisa cobrir as duas resoluções):
1. Res. 599/2018, art. 52: um explicador do plano publicado é "delegar a função dela"?
2. Res. 856/2026, art. 34, parágrafo único (vale a partir de 23/01/2027, cerca de 2 a 3 meses depois de ligar): a IA Nutri "substitui a nutricionista na interação direta"? Para um assistente que conversa com o paciente, é a pergunta mais difícil: um "pode" sob a 599 pode virar "não pode" em janeiro (D36).
3. Res. 599/2018, art. 20, I (sigilo), junto com o advogado: o texto do paciente que os sistemas da Anthropic sinalizam pode ser lido por pessoas do fornecedor, que não têm o mesmo dever de sigilo.
4. A conversa com a IA é prontuário? (D8)
5. Levar este exemplo: "posso comer o lanche da tarde mesmo com diarreia?". O app mostra o trecho certo do plano, mas isso pode soar como "sim, pode".

**Para o advogado**, revisados juntos e com o P14A-16: o DPA e o termo do paciente, que ainda estão na versão provisória (0.1) no sistema, o aditivo 1.2 e o consentimento da IA Nutri. A IA Nutri acrescenta uma finalidade nova, com texto livre do paciente indo para os EUA. Recomendo só ligar com paciente real depois que o DPA e o termo deixarem de ser provisórios, ou com uma decisão sua de seguir assim, anotada como na A-D27. O advogado e o RIPD cobrem os dados de saúde que saem do país.

**Se escolher outra:** com (a), podemos ficar parados esperando a Anthropic. Com (c) ou (d), fica sem a opinião do conselho da profissão.

**Depende de terceiro:** CRN-3, advogado e (opcional) Anthropic. **Custo pontual:** honorários do advogado e o RIPD.


### D36 — A IA Nutri quando o novo Código de Ética entrar em vigor (23/01/2027)

**Pergunta:** o que fazer com a IA Nutri em 23/01/2027, se o texto final da Res. CFN 856/2026 mantiver que a IA não pode "substituir a nutricionista na interação direta"?

**Opções:**
- **(a)** Reler o texto final em dezembro de 2026. Se o CRN-3 entender que a IA Nutri é "interação direta", pausar na plataforma em 22/01/2027 (o botão já existe) ou passar ao modo (c) da D1.
- **(b)** Manter ligada até o CRN se manifestar.
- **(c)** Desligar em 23/01/2027 sem esperar.

**Recomendação: (a).** O botão de pausa já existe. Evita que uma resposta "pode" do CRN, dada sob o código antigo, continue valendo quando o novo entrar em vigor.

**Se escolher outra:** com (b), a IA Nutri pode ficar ligada contra o código novo. Com (c), desliga mesmo que o texto final permita.

**Depende de terceiro:** CRN-3 (mesma consulta da D2).

---

## Bloco 2 — Como a IA responde

### D1 — Resposta na hora ou só depois da nutricionista

**Pergunta:** a IA responde na hora ou a nutricionista aprova antes?

**Opções:**
- **(a)** Conversa livre sobre alimentação.
- **(b)** Resposta na hora, só com o que está no plano.
- **(c)** Toda resposta passa pela nutricionista antes.
- **(d)** Resposta na hora quando a dúvida é do plano; o resto vai para a nutricionista.

**Recomendação: (d)**, se o CRN-3 aceitar. É rápido para o paciente e não cria trabalho novo para a Debby. O paciente só lê o que ela escreveu.

**Se o CRN-3 disser não:** modo (c), ou não ligar. **Se não responder em 8 semanas:** a decisão volta para o dono (consulta a conselho pode levar meses); a IA Nutri não liga sozinha no modo (d).

**Se escolher outra:** com (c), cada pergunta vira tarefa para a Debby. Com (a), o risco ético e de política é alto.

**Depende de terceiro:** CRN-3 (D2).

### D21 — Quem escreve o texto que o paciente lê

**Pergunta:** a IA escreve a resposta com as próprias palavras ou o sistema monta com trechos do plano?

**Opções:**
- **(a)** O sistema monta: frase fixa + trecho do plano, igual ao que a Debby escreveu.
- **(b)** A IA escreve livre, e uma segunda IA confere.
- **(c)** A IA escreve livre, só com conferência de números.

**Recomendação: (a).** A IA não escreve texto. O risco que sobra é mostrar um trecho certo do plano como se respondesse a uma pergunta sobre sintoma (ex.: "posso comer o lanche mesmo com diarreia?"). Por isso as frases fixas não soam como "sim" ou "não", e perguntas do tipo "posso X se estou Y" vão para a nutricionista. É o que deixa a IA Nutri segura e dentro da política da Anthropic. A resposta fica menos "conversada", mas certa.

**Se escolher outra:** com (b) ou (c), a IA pode dizer coisas como "pode pular o jantar", que não estão no plano.

**Depende de terceiro:** não.

### D25 — Suplemento que está no plano

**Pergunta:** se a Debby pôs "whey 30 g" no plano, a IA pode mostrar isso? E expressões como "em jejum" que estão no plano?

**Opções:**
- **(a)** Nunca mostrar suplemento.
- **(b)** Mostrar quando está escrito no plano. Pergunta sobre suplemento fora do plano vai para a Debby.

**Recomendação: (b).** O paciente só lê o que a Debby receitou. Bloquear faria a IA "recusar" o próprio plano. Ponto sensível: para quem tem risco de transtorno alimentar ou o peso oculto (D33), mostrar "em jejum" pesa mais. Ao liberar esse paciente, a Debby confirma também esses termos.

**Se escolher outra:** com (a), o paciente pergunta do whey do plano e ouve "não posso falar disso".

**Depende de terceiro:** a Debby revisa a lista de palavras.

### D9 — O que a IA pode ler

**Pergunta:** que dados do paciente a IA usa para responder?

**Opções:**
- **(a)** Plano publicado e orientações dos 5 últimos atendimentos.
- **(b)** (a) + receitas e textos da biblioteca.
- **(c)** (b) + peso e medidas.

**Recomendação: (a).** É o mínimo para responder. Falar de peso é o maior risco (caso de um robô nos EUA que deu dieta a quem tinha transtorno alimentar).

**Se escolher outra:** (b) pode vir depois, se a Debby pedir. (c) não é recomendado.

**Depende de terceiro:** não.

---

## Bloco 3 — Dúvidas que vão para a nutricionista

### D24 — O que a nutricionista faz com a dúvida

**Pergunta:** a nutricionista responde por escrito no app ou só marca que viu?

**Opções:**
- **(a)** Responde por escrito no app.
- **(b)** Marca "vista" e trata na consulta ou pelo canal que já usa.
- **(c)** Sem encaminhamento.

**Recomendação: (b).** Responder por escrito no app quase certamente conta como teleconsulta. Isso exige termo próprio e cadastro no conselho, e vira prontuário. Com (b), nada disso muda.

**Se escolher outra:** com (a), só depois do CRN-3 e com o termo de teleconsulta. Com (c), o paciente fica sem caminho.

**Depende de terceiro:** CRN-3, se quiser (a).

### D19 — Resposta escrita da nutricionista quando o paciente desliga a IA

**Pergunta:** se o paciente desliga a IA Nutri, as respostas escritas da nutricionista são apagadas?

**Opções:**
- **(a)** Apagar tudo.
- **(b)** Manter as respostas dela.

**Recomendação: (b)**, mas só importa se a D24 for (a). Resposta escrita dela é parte do prontuário, que tem guarda de 20 anos.

**Se escolher outra:** com (a), pode apagar algo que a lei manda guardar.

**Depende de terceiro:** advogado.

### D12 — A IA escreve um rascunho para a nutricionista responder

**Pergunta:** a IA prepara um rascunho de resposta para a Debby?

**Opções:** **(a)** sim; **(b)** não.

**Recomendação: (b).** Só faz sentido se a D24 for (a). Evita custo e trabalho agora.

**Se escolher outra:** custa mais uma chamada de IA por dúvida.

**Depende de terceiro:** não.

### D34 — Como o app fala com o paciente sobre a dúvida

**Pergunta:** que voz o app usa ao avisar o paciente sobre a dúvida?

**Opções:**
- **(a)** Voz de "Aviso do app", sem prometer nada em nome da Debby. Ex.: "Sua dúvida foi vista no consultório." Ajustar o rodapé do mural e o guia do app.
- **(b)** Tirar o botão "Enviar para minha nutricionista" agora.
- **(c)** A nutricionista responde por escrito (D24 = a).

**Recomendação: (a).** O app não deve falar como se fosse a Debby. Hoje o mural diz "este app não é um canal de conversa". Isso precisa continuar verdadeiro.

**Se escolher outra:** com (b), o paciente só ouve "anote para a consulta". Com (c), volta a questão da teleconsulta.

**Depende de terceiro:** a Debby revisa os textos.

### D10 — Avisar a nutricionista quando há sinal de risco

**Pergunta:** se o paciente escreve algo de risco (ex.: se machucar), a Debby recebe aviso?

**Opções:**
- **(a)** Sim: no topo da fila e um e-mail sem nome nem texto.
- **(b)** Só na fila.
- **(c)** Não avisar.

**Recomendação: (a).** É o jeito de a Debby ver rápido. O e-mail não leva nenhum dado do paciente. Nenhuma regra do conselho obriga, mas é o cuidado certo.

**Riscos que vêm junto:** o caminho de risco depende de uma pessoa só, sem prazo. O paciente lê "Sua mensagem foi enviada ao consultório" e pode esperar que alguém aja logo. Por isso o texto de risco passa a dizer que o consultório não acompanha as mensagens em tempo real e não atende emergências, sempre com CVV 188 e SAMU 192. E a Debby recebe um protocolo curto do que fazer (D11). Isso é boa prática, não exigência do CFN para adulto.

**Se escolher outra:** com (b), ela só vê quando abrir o painel. Com (c), o alerta pode se perder.

**Depende de terceiro:** não.

### D22 — Mensagem de risco quando o paciente desliga a IA

**Pergunta:** se o paciente escreve algo de risco e logo desliga a IA, a mensagem some?

**Opções:**
- **(a)** Fica na fila da Debby até ela abrir, **no máximo 30 dias**; depois é apagada. Se ela não abrir em 30 dias (férias, saída do consultório, conta suspensa), fica só o aviso "houve sinal de risco", sem o texto, e depois nada. Se ninguém abrir em 72 h, a admin recebe um aviso sem dados.
- **(b)** Fica só um aviso "houve sinal de risco", sem o texto.
- **(c)** Some na hora.

**Recomendação: (a)**, se o advogado concordar. A base é a proteção da vida, que justifica uma janela curta para alguém agir, não guardar para sempre. O consentimento avisa isso antes. O prazo de 30 dias vai ao advogado junto com a base legal.

**Se escolher outra:** com (b), a Debby sabe que houve risco, mas não o quê. Com (c), o alerta some antes de chegar a ela.

**Depende de terceiro:** advogado.

---

## Bloco 4 — Modelo, custo e limites

### D5 — Qual modelo de IA usar

**Pergunta:** qual modelo da Anthropic responde ao paciente?

**Opções:**
- **(a)** Haiku 5.5 — o mais barato (cerca de US$ 1,50 por 1.000 perguntas).
- **(b)** Sonnet 5.5 — o mesmo da leitura de exames (cerca de US$ 20–25 por 1.000).
- **(c)** Testar os dois na avaliação e escolher pelo resultado.
- **(d)** Opus 5.5 — o mais caro (cerca de US$ 50 por 1.000).

**Recomendação: (c)**, ficando com o Haiku 5.5 se ele passar no teste. A tarefa é simples: achar o trecho certo do plano. O Haiku custa cerca de 15 vezes menos. Mas o teste também compara qual modelo percebe melhor **sinais sutis de risco** (transtorno alimentar, autolesão), onde o modelo é a única barreira. Nesse ponto vale a segurança, não o preço: se o Sonnet for melhor, ele ganha.

**Se escolher outra:** com (b) direto, o custo sobe muito e a D3 muda. O modelo antigo da spec (Haiku 4.5) não funciona mais com a nossa configuração.

**Depende de terceiro:** a Debby avalia as respostas no teste.

### D3 — Quanto gastar e como limitar

**Pergunta:** quanto você aceita gastar com a IA Nutri e como separar da IA de exames?

**Opções:**
- **(a)** Com o Haiku: limite próprio de **US$ 5 por mês por consultório**, dentro do teto atual de US$ 50. Seu gasto máximo continua US$ 50.
- **(b)** Com o Sonnet: limite de US$ 25 + teto próprio de US$ 25. Gasto máximo de US$ 75 por mês.
- **(c)** Sem separar: os pacientes usam o mesmo limite da leitura de exames.
- **(d)** Não ligar agora.

**Recomendação: (a)**, se a D5 der Haiku. Um consultório com 40 pacientes gasta cerca de US$ 1,50 por mês. Rever o teto de US$ 50 antes do 3º consultório. **Atenção:** no pior caso (todos os 40 pacientes no limite da D4), o gasto chega a US$ 5,30–6,40 e a cota de US$ 5 bloqueia os pacientes antes do fim do mês. Escolha: aceitar esse bloqueio no pior caso ou subir para **US$ 7**.

**Se escolher outra:** com (b), o custo pode passar de US$ 75. Com (c), os pacientes podem esgotar a leitura de exames da Debby.

**Depende de terceiro:** não. (Repasse ao consultório: decidir antes do 2º consultório.)

### D4 — Quantas perguntas por paciente

**Pergunta:** quantas perguntas cada paciente pode fazer?

**Opções:** **(a)** 10 por dia e 100 por mês; **(b)** 20 e 200; **(c)** 5 e 50.

**Recomendação: (a).** Evita abuso e uso excessivo. Com o Haiku, o pior caso não pesa no custo, mas pode esgotar a cota de US$ 5 antes do fim do mês (D3).

**Se escolher outra:** (b) dá mais liberdade; (c) pode frustrar quem usa muito.

**Depende de terceiro:** a Debby pode opinar.

---

## Bloco 5 — App do paciente

### D28 — Que nome o paciente vê

**Pergunta:** o paciente vê "IA Nutri" ou outro nome?

**Opções:**
- **(a)** "IA Nutri" para o paciente, e outro nome para a IA da nutricionista.
- **(b)** Outro nome para o paciente. Ex.: "Dúvidas do plano (IA)".
- **(c)** O mesmo nome para os dois.

**Recomendação: (b).** A 14B já chama de "IA Nutri" a ferramenta da nutricionista. Um nome com "Nutri" pode fazer o paciente achar que fala com a Debby. Trocar agora não custa nada.

**Se escolher outra:** com (a), muda o nome da 14B. Com (c), suporte e histórico ficam confusos.

**Depende de terceiro:** a Debby escolhe o nome.

### D29 — Onde fica no app

**Pergunta:** em que lugar do app o paciente acessa a IA Nutri?

**Opções:**
- **(a)** Dentro de **Plano**, com botão "Tirar dúvida sobre o plano". Um convite único pode aparecer no Hoje.
- **(b)** Uma 6ª seção.
- **(c)** Um atalho na tela Hoje.
- **(d)** Dentro do mural.

**Recomendação: (a).** A IA só fala do plano, então ela mora no plano. Não muda as 5 seções.

**Se escolher outra:** (b) não cabe na tela pequena. (c) e (d) confundem com recados da Debby.

**Depende de terceiro:** não.

### D33 — Paciente que esconde o peso

**Pergunta:** a IA Nutri pode ser ligada para quem pediu para não ver o peso?

**Opções:**
- **(a)** Pode, mas a Debby confirma na ficha. E a IA nunca fala em "peso" ou "calorias" nos avisos.
- **(b)** Esconder o peso desliga a IA Nutri.
- **(c)** Uma coisa não depende da outra.

**Recomendação: (a).** A decisão clínica é da Debby. O que não pode é a IA puxar o assunto.

**Se escolher outra:** (b) tira a escolha da Debby. (c) pode tocar num ponto sensível sem querer.

**Depende de terceiro:** não.

### D6 — Ligar para todos ou paciente por paciente

**Pergunta:** a IA Nutri vale para todos os pacientes ou a Debby libera um a um?

**Opções:** **(a)** um a um (começa desligada); **(b)** todos, com bloqueio individual.

**Recomendação: (a).** A Debby conhece quem não deve usar (ex.: transtorno alimentar). Se ela bloquear, o paciente não recebe aviso; a opção só some.

**Se escolher outra:** com (b), alguém sensível pode usar antes de ela perceber.

**Depende de terceiro:** não.

### D7 — A nutricionista lê as conversas

**Pergunta:** a Debby vê todas as conversas do paciente com a IA?

**Opções:** **(a)** vê tudo; **(b)** só dúvidas enviadas e sinais de risco; **(c)** não vê.

**Recomendação: (a).** Ela pode ver o que a IA mostrou ao paciente. O paciente é avisado antes de aceitar ("sua nutricionista pode ler", nunca "acompanha").

**Risco que vem junto:** "vê tudo" cria uma expectativa de vigilância. Um sinal sutil que ficou visível na ficha pode virar "ela tinha acesso e não agiu" (Res. CFN 599/2018, art. 16: ela responde pelas próprias ações). Por isso, ao ligar a IA Nutri, a Debby é avisada de que a aba existe e do que se espera dela.

**Se escolher outra:** (b) protege mais a privacidade, mas ela perde o contexto.

**Depende de terceiro:** advogado (se ler tudo é proporcional).

### D8 — Por quanto tempo guardar as conversas

**Pergunta:** quanto tempo o NutriDebby guarda as conversas?

**Opções:** **(a)** 90 dias; **(b)** 180 dias; **(c)** 12 meses; **(d)** como prontuário (20 anos).

**Recomendação: (b).** Nossa leitura é que a conversa com a IA não é prontuário, porque não foi a nutricionista quem registrou; o CRN-3 e o advogado confirmam (pergunta na D2). Se disserem que é, as conversas lidas por ela passam a ter guarda de 20 anos e não podem ser apagadas quando o paciente desliga. Para separar, o desenho prevê que a Debby copie para o prontuário o que ela usar. Seis meses bastam para a Debby acompanhar. A Anthropic guarda por até 30 dias, à parte.

**Se escolher outra:** prazo menor perde histórico; maior guarda dado de saúde sem necessidade.

**Depende de terceiro:** advogado e CRN-3.

### D32 — O que "apagar as conversas" apaga

**Pergunta:** quando o paciente desliga a IA, o que é apagado?

**Opções:**
- **(a)** Tudo, inclusive a contagem de perguntas.
- **(b)** Todo o conteúdo. Fica só a contagem até o fim do mês, sem texto.
- **(c)** Um contador separado.

**Recomendação: (b).** Sem isso, desligar e ligar de novo zera o limite de perguntas. A contagem não guarda nada de saúde.

**Se escolher outra:** com (a), alguém pode burlar o limite e gastar a cota do consultório.

**Depende de terceiro:** o texto do consentimento passa pela D11.

---

## Bloco 6 — Decisões técnicas (pode aprovar a recomendação)

### D30 — Onde o sistema confere a cota

**Pergunta:** em que ponto o sistema confere se ainda há saldo?

**Opções:** **(a)** num comando no banco; **(b)** no app, com acesso amplo; **(c)** o banco confere os limites do paciente e o processador de IA confere o saldo.

**Recomendação: (c).** Usa a mesma conta de saldo que já funciona hoje. Não abre acesso amplo a partir do celular do paciente.

**Se escolher outra:** (a) cria duas contas de saldo que podem divergir; (b) é menos seguro.

**Depende de terceiro:** não.

### D31 — A IA "pensa" antes de responder

**Pergunta:** deixamos a IA usar raciocínio interno?

**Opções:** **(a)** sim, no nível mais leve; **(b)** desligar.

**Recomendação: (a).** Mantém a regra da 14B. Em pedidos simples, quase não pensa. Medimos no teste.

**Se escolher outra:** (b) exige abrir exceção numa regra de segurança.

**Depende de terceiro:** não.

### D35 — Guardar parte da pergunta para economizar

**Pergunta:** usamos o "cache" (guardar parte do pedido por 5 minutos)?

**Opções:** **(a)** não agora; **(b)** sim.

**Recomendação: (a).** Com perguntas espaçadas, o cache sai mais caro. Com o Haiku, a diferença é de centavos.

**Se escolher outra:** (b) pede mudança no código da 14B e testes nos dois fornecedores.

**Depende de terceiro:** não.

---

## Tabela para aprovar de uma vez

A coluna "Custo de terceiro" marca as decisões que geram honorários pontuais (não mensais).

| Decisão | Recomendação | Depende de | Custo de terceiro |
|---|---|---|---|
| D27 Textos e ordem | (a) Plano 15 depois da 14B-2; trocar uma frase na 1.1; aditivo 1.2 só para a IA Nutri | — | — |
| D26 Onde guardar o "sim" | (a) registro próprio | — | — |
| D11 Revisão dos textos | (a) Debby, advogado e psicólogo (com protocolo de risco para a nutricionista) | Debby, advogado, psicólogo | Sim (advogado, psicólogo) |
| D2 Consultas externas | (b) CRN-3 (três perguntas), advogado e RIPD; Anthropic como boa prática; sem ela, ligar só a partir de 12/11/2026 | CRN-3, advogado, Anthropic | Sim (advogado, RIPD) |
| D36 Código de Ética novo | (a) reler em dezembro; pausar ou ir para (c) se for "interação direta" | CRN-3 | — (mesma consulta da D2) |
| D1 Resposta na hora | (d) na hora só para dúvida do plano; se o CRN-3 disser não, (c) ou não ligar | CRN-3 | — |
| D21 Quem escreve | (a) o sistema monta com trechos do plano, com frase que não soa como "sim" | — | — |
| D25 Suplemento do plano | (b) mostrar se está no plano (inclusive "em jejum"; a Debby confirma no peso oculto) | Debby (lista) | — |
| D9 O que a IA lê | (a) plano e orientações | — | — |
| D24 Dúvida para a nutricionista | (b) marcar "vista" | CRN-3 só se (a) | — |
| D19 Resposta escrita dela | (b) manter (só se D24 = a) | advogado | Sim (advogado, na mesma consulta) |
| D12 Rascunho da IA | (b) não | — | — |
| D34 Voz do app | (a) "Aviso do app" | Debby | — |
| D10 Aviso de risco | (a) fila + e-mail sem dados; texto diz que não é atendimento em tempo real | — | — |
| D22 Risco ao desligar | (a) fica até a Debby abrir, no máximo 30 dias | advogado | Sim (advogado, na mesma consulta) |
| D5 Modelo | (c) testar; Haiku 5.5 se passar, Sonnet se perceber melhor os sinais sutis | Debby (teste) | — |
| D3 Custo | (a) US$ 5 por consultório (ou US$ 7, para não bloquear no pior caso), teto de US$ 50 | — | — |
| D4 Limite por paciente | (a) 10 por dia, 100 por mês | — | — |
| D28 Nome | (b) outro nome para o paciente | Debby | — |
| D29 Lugar no app | (a) dentro de Plano | — | — |
| D33 Peso oculto | (a) Debby confirma | — | — |
| D6 Liberação | (a) paciente por paciente | — | — |
| D7 Ler conversas | (a) pode ler tudo | advogado | Sim (advogado, na mesma consulta) |
| D8 Guarda | (b) 180 dias, se o CRN-3 e o advogado confirmarem que não é prontuário | advogado, CRN-3 | Sim (advogado, na mesma consulta) |
| D32 O que apagar | (b) conteúdo, mantendo a contagem do mês | — | — |
| D30 Cota (técnica) | (c) | — | — |
| D31 Raciocínio (técnica) | (a) | — | — |
| D35 Cache (técnica) | (a) sem cache agora | — | — |

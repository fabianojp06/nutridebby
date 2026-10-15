# NutriDebby — App do paciente no layout G verde (Plano 16) — Design

| Item | Valor |
|---|---|
| Versão | 0.2 (emendas do Plano 15, IA Nutri do paciente: C-191, C-192, C-197, RN-193, RN-194 e RN-209 — spec C v0.5, §7.8, D34) |
| Data | 2026-10-08 · 2026-10-15 (v0.2, emendas do Plano 15) |
| Status | **Implementado no Plano 16** (branch `plano-16-app-paciente`, Tarefas 1–17, 08/10/2026; o merge na `main` — o deploy — depende do OK do dono, e a data do merge entra aqui no PR de fechamento). Pedido e aprovado pelo dono em 08/10/2026 ("concordo, pode seguir"), com as decisões G-D1 a G-D4; as pendências G-D5 a G-D17 foram respondidas pelo dono em 08/10/2026 com as recomendações ("Aprovo todas (Recomendado)", §14). Fica aberta só a D6 ★ do plano (a opção de peso na exportação do titular, com o advogado, E-09). Conferido contra o código da `main` 19fcea5 (Planos 01–12 em produção); acertada pela revisão do plano em 08/10/2026 (§16) e no fechamento do Plano 16 (CHECK da §9, G-D16 na §4.5, dia da semana nos exemplos) |
| Itens do backlog | Novo: **G-01** (app do paciente no layout G verde) e **G-02** ("Não mostrar peso no app", por paciente) |
| Quando | **Plano 16**, executado **logo depois do Plano 13** (parecer) e **antes do Plano 14** (IA da nutricionista) — G-D2 |
| Desenho aprovado | `.superpowers/sdd/2026-10-08-plano16-preparacao/desenho/`: `GV-Hoje.dc.html`, `GV-Jornada.dc.html`, `GV-Almoco.dc.html` (layout G verde). Referências: `D-Assuntos.dc.html` (lista por assunto, molde da seção "Eu"), `F-Medidas.dc.html` (tabela de medidas, molde de "Todas as medidas"), `F-Plano.dc.html` (refeições em sanfona, molde da seção "Plano") |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (v1.13), [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (E5, US-040 a US-046), [`2026-10-03-nutridebby-documentos-assinados-design.md`](2026-10-03-nutridebby-documentos-assinados-design.md) (US-146), [`2026-10-03-nutridebby-paciente-exames-ia-design.md`](2026-10-03-nutridebby-paciente-exames-ia-design.md) (v0.3: F3-04 em produção; **D24**: o app não é canal de mensagens) e o manual técnico, caps. [05](../../manual-tecnico/05-agenda-portal-conteudo.md) (§5.5 portal, §5.7 interface, §5.8 manual guiado) e [11](../../manual-tecnico/11-exames-enviados.md) |
| Numeração nova | US-190 a US-199 · RN-190 a RN-219 · RNF-190 a RNF-199 · CS-190 a CS-194 · R-190 a R-199 · C-190 a C-197 · DEP-G1 a DEP-G8 · PM-G1 a PM-G14 · G-D1 a G-D12 (decisões deste documento; o prefixo "G-" evita colisão com as D dos planos e das outras specs) |

---

## 1. Visão

O portal do paciente (`/p`, Plano 06) funciona, mas é uma pilha de páginas com **7 abas iguais no rodapé** (Início,
Plano, Diário, Conteúdos, Evolução, Agenda, Perfil) e funções novas penduradas em links ("Meus documentos" e "Meus
exames" em Perfil). O paciente abre o app para três coisas: **saber o que comer agora**, **contar o que comeu** e
**ver como está indo**. O layout G verde reorganiza o mesmo conteúdo em volta disso:

1. **Faixa do topo na cor do consultório**, com o nome do consultório, a saudação, a **mini-jornada** (variação do
   peso desde a primeira consulta e o próximo marco) e **cinco seções**: **Hoje · Jornada · Plano · Exames · Eu**.
2. **Hoje** é um **mural** do consultório montado pelo sistema a partir do que já existe — a refeição que vem aí, o que
   o paciente registrou, o comentário da nutricionista, a situação do exame enviado, a próxima consulta, o conteúdo
   novo — com **respostas por botão** ("Comi assim", "Ver a refeição") e uma **barra de ações** embaixo (foto da
   refeição, enviar exame, agendar). **Não é chat:** não há caixa de texto, nada é enviado à nutricionista como
   mensagem e não existe tabela de mensagens (spec C, D24 = b).
3. **Jornada** mostra o peso de cada consulta num gráfico e as consultas numa **linha do tempo**, cada uma com a
   orientação que a nutricionista deixou naquele atendimento.
4. **A refeição aberta** (tela "Almoço") mostra quantidades, trocas e três respostas: "Mandar foto do prato", "Comi
   assim" e "Comi outra coisa" — todas gravadas no **diário que já existe** (US-042).
5. **"Não mostrar peso no app"** (G-D1): opção **por paciente**, que **só a equipe liga**, para pacientes em que ver o
   número faz mal (transtorno alimentar, ansiedade com a balança). O paciente não vê a opção; o app deixa de mostrar o
   peso (e o que deriva dele) na faixa, na Jornada e em "Todas as medidas".

**O painel da nutricionista fica como está** (G-D3). As únicas mudanças nele são as indispensáveis: a caixa "Não
mostrar peso no app" no prontuário e a leitura das respostas novas do diário no feed que já existe (§4.9).

**Nada some.** Toda função de hoje tem lugar no layout novo (tabela da §4.10), as rotas atuais continuam valendo (links
de push e e-mail, cópia offline do plano, PWA instalado) e o teste "nada some" (RNF-197) quebra o CI se uma delas
ficar sem caminho a partir da navegação.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-190 | Toda função do portal de hoje é alcançável a partir de Hoje, sem digitar endereço, no número de toques da tabela da §4.10: **≤ 2**, e **3** só nas três linhas marcadas lá (consulta que não é a próxima, receita de refeição que não é a próxima, conteúdo que não é novo — G-D14 ★) | Teste E2E "nada some" (RNF-197) sobre a tabela da §4.10 |
| CS-191 | **≥ 50%** dos pacientes ativos com plano publicado registram ao menos **3 respostas em cada uma das 4 semanas** ("Comi assim", "Comi outra coisa" ou foto) depois do deploy (**meta proposta**, G-D12 ★; "cada semana" × "média" e quem pode ser medido antes do DPA definitivo: G-D15 ★) | Função agregada `SECURITY DEFINER` (molde da 0087: só contagens por tenant, nenhuma linha de saúde) sobre `diary_entries.resposta` não nulo ou foto, por paciente e semana ISO, no fuso do tenant — nunca SQL ad hoc em produção; entre consultórios só com a cláusula de estatística agregada no DPA definitivo (E-09) ou com o pedido registrado da nutricionista (LGPD art. 39) |
| CS-192 | Acesso diário (CS-02 do MVP) **não cai** nas 4 semanas depois do deploy, comparado às 4 anteriores | `access_events` (5.5.5 do manual) |
| CS-193 | **Zero** violação do axe e **zero** rolagem horizontal em todas as telas do portal a **360 px e 320 px**, nos modos claro e escuro | E2E de acessibilidade (RNF-191) |
| CS-194 | Com "Não mostrar peso no app" ligado, **nenhum** valor de peso ou IMC chega ao aparelho do paciente (HTML, payload RSC, cópia offline) | Teste de integração que procura os valores na resposta (RNF-197) |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-190 | **Só documentos nesta etapa.** O código, as migrations e os testes são do Plano 16, escrito depois desta spec | Dono, 08/10/2026 |
| C-191 | **Sem tabela de mensagens, sem chat, sem caixa de texto livre no mural.** O mural é composição de leitura; as únicas escritas são as que já existem (diário, confirmar presença, enviar exame, agendar). A resposta escrita da nutricionista pelo app continua fora até a consulta ao CRN (spec C, D2 e D24) **Emenda do Plano 15 (15/10/2026; spec C §7.8, D34):** a IA Nutri do paciente (F3-02) é **tela própria dentro de Plano** (`/p/plano/ia`), fora do mural e da barra de ações, com autor visível "IA Nutri — inteligência artificial"; o mural continua sem caixa de texto e sem chat. A dúvida enviada à nutricionista só é marcada como vista (D24 = b), sem resposta escrita pela plataforma. | Spec C, D24 = (b) |
| C-192 | **Sem custo novo.** Sem serviço externo, sem IA, sem push novo; fontes servidas pelo próprio app (`next/font`, como as do painel — CSP `font-src 'self'`) **Emenda do Plano 15 (15/10/2026; spec C §7.8, D34):** a IA Nutri é o primeiro uso de IA no app do paciente (custo dentro da cota da IA Nutri, US$ 7/mês por consultório, e do teto global de US$ 50, D3 da spec C) e traz um push novo, **neutro**: `duvida_vista`, "Há uma atualização para você no app.", tela `/p/plano/ia` (sem IA, dúvida nem nutricionista no texto). O mural continua sem IA. | Memória "No extra costs"; P08 D24 |
| C-193 | **Painel como está** (G-D3): nada do visual, dos tokens ou do menu do painel muda; os tokens novos ficam escopados ao portal | Dono, 08/10/2026 |
| C-194 | **Somente adultos** (RN-17): a linguagem sobre peso é para adultos, mas neutra (RN-206) | MVP D-11 |
| C-195 | **URLs do portal preservadas.** `manifest.id` e `start_url` continuam `/p/inicio` (trocar o `id` criaria "outro app" nos aparelhos que já instalaram); os destinos de push (`AVISOS_DO_PORTAL`, `src/modules/notificacoes/mensagens.ts:110`), os links de e-mail e a cópia offline (`/p/plano`) continuam válidos | Código |
| C-196 | **Plano 13 em paralelo.** Outra frente escreve o Plano 13 noutra worktree; as migrations do Plano 16 numeram a partir da **próxima livre depois do merge do Plano 13** (hoje a última em produção é a `0103_sessao_equipe_30min.sql`). Se o Plano 13 entregar o parecer no portal (US-148), ele entra em "Meus documentos" (Eu) como a receita | Código, índice dos planos |
| C-197 | **Nenhum texto montado pelo sistema é atribuído à nutricionista.** Só o que ela escreveu (comentário do diário, orientação do atendimento, orientações e observações do plano) aparece como "Sua nutricionista …"; o resto é do "app do consultório" (RN-194). Evita que o paciente tome um lembrete automático por orientação profissional **Emenda do Plano 15 (15/10/2026; spec C §7.8, D34):** a resposta da IA Nutri não é da nutricionista: o autor visível é "IA Nutri — inteligência artificial", sem a borda de destaque dela; a resposta montada mostra o trecho que ela escreveu com a fonte ("Fonte: Orientações do plano", "Fonte: Almoço — itens"…), e os textos fixos ficam na voz "Aviso do app" ("Sua dúvida foi vista no consultório."). | Boa prática (SBIS ECF.17.01) e princípio geral da Res. CFN nº 599/2018 (Código de Ética), arts. 16 (responder pelas próprias ações) e 19 (manter o indivíduo informado) — a 599/2018 não tem regra expressa sobre texto automático atribuído ao profissional (conferido em 08/10/2026). A vigência da Res. CFN nº 856/2026 (art. 37, declarar ferramenta automatizada; 23/01/2027, prorrogação a confirmar no DOU, R-169 da spec C) não muda esta regra: o mural não tem IA |

### 1.3 Dependências (conferidas no código em 08/10/2026)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-G1 | **Plano 06 — portal** | Sessão, vínculos, termo, layout, PWA, abas | ✅ Em produção. `requirePaciente` (`src/lib/paciente-session.ts`), layout `src/app/p/(portal)/layout.tsx` (marca com `getTenantBrand`, `DonoDoAparelho`, `RegistrarAcesso`, `SeloOffline`, `NavPortal`), abas em `src/app/p/navegacao.ts` (`ITENS_DO_PORTAL`, `itemAtual` com `tambem`), "Sair" em `src/app/p/layout.tsx` (`SairPortal`) |
| DEP-G2 | **US-041 — plano** | Refeições, horário, itens, substituições, kcal, próxima refeição | ✅ `planoDoPaciente` (`src/modules/portal/plano.ts`): `refeicoes[].{nome, horario, observacao, itens[].substituicoes, receita}`, `proximaRefeicaoId`, `totalKcal` só com `mostrarCalorias`; leitura auditada. **Atenção:** `meals.horario` é **nulo** em refeição sem horário (`src/db/schema/plano*.ts`) — ela não entra no mural (RN-196) |
| DEP-G3 | **US-042/043 — diário** | Respostas do mural e comentário da nutricionista | ✅ `registrarNoDiario`, `diarioDoPaciente` (`src/modules/portal/diario.ts`), `REFEICOES_DO_DIARIO` (lista fechada, CHECK `diary_entries_refeicao_valida`), 10 registros/dia com o paciente travado, CHECK `diary_entries_tem_conteudo` (texto **ou** foto), política `paciente_diario_insert` (0080). **Falta:** colunas `resposta` e `refeicao_do_plano` e o CHECK novo (§9) |
| DEP-G4 | **US-044 — evolução** | Peso por consulta, medidas, orientações | ✅ `evolucaoParaPaciente` (`src/modules/portal/evolucao.ts`, regra `permitida`: peso, IMC, circunferências; % de gordura só com `tenants.mostrar_perc_gordura_paciente`), `orientacoesDoPaciente` (`src/modules/pacientes/atendimentos.ts:179`), `anthropometry.consultation_id` liga a avaliação ao atendimento |
| DEP-G5 | **Plano 05/06 — agenda no portal** | Próxima consulta, confirmar presença, agendar | ✅ `consultasDoPaciente` (`src/modules/portal/agenda.ts`: `proximas`, `anteriores`, `podeAgendar`), ações em `src/app/p/(portal)/agenda/` ("Confirmar presença", "Cancelar consulta", remarcar), sem `auditRead` (P05 D10) |
| DEP-G6 | **Plano 07, 10A, 12** | Conteúdo novo, documento novo, situação do exame | ✅ `feedDeConteudos` (`novo` = não visto), `novosNoPortal` (`src/modules/documentos/portal.ts:76`), `meusEnvios` + `situacaoParaPaciente` (`src/modules/portal/exames-enviados.ts`, `src/modules/pacientes/exames-enviados-constantes.ts`) |
| DEP-G7 | **Plano 08 — tokens e manual guiado** | `data-tema`, cor do consultório, contraste, `user.guia` | ✅ `src/app/globals.css` (`--nd-marca-base`, `--nd-marca-clara`, `--color-destaque`), `contraste` (`src/lib/tema/contraste`), `corNoEscuro` (`src/lib/tema/marca-tema`), cor do consultório validada com **≥ 4,5:1 contra o branco** (`perfilSchema`, `src/modules/plataforma/marca.ts`); manual guiado só no painel (`src/modules/ajuda/conteudo.ts`, `marcarGuia` em `src/modules/plataforma/preferencias.ts`) |
| DEP-G8 | **Fontes** | Red Hat Display e Atkinson Hyperlegible Next por `next/font/google` | ⬜ **A conferir no plano:** se a versão de `next` do repositório já traz as duas no catálogo do `next/font/google` (a Atkinson Hyperlegible **Next** entrou no Google Fonts em 2025). Se não trouxer, `next/font/local` com os `woff2` versionados no repositório (licença SIL OFL 1.1 nas duas) |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo |
|---|---|---|
| G-01a | **Moldura** | Faixa do topo na cor do consultório (logo e nome do consultório, título da seção, saudação e mini-jornada em Hoje), navegação "Seções" com **Hoje · Jornada · Plano · Exames · Eu**, telas de detalhe com cabeçalho compacto e "Voltar"; sai a barra de 7 abas do rodapé |
| G-01b | **Hoje** (`/p/inicio`) | Mural montado (RN-193 a RN-201), respostas por botão, barra de ações (Foto da refeição · Enviar exame · Agendar), cartões do aparelho (ativar notificações, instalar) |
| G-01c | **Refeição aberta** (`/p/plano/refeicao/<id>`) | Quantidades, trocas, observação, receita sugerida, "Mandar foto do prato", "Comi assim", "Comi outra coisa" |
| G-01d | **Jornada** (`/p/jornada`, rota nova) | Gráfico "Peso nas consultas", linha do tempo (próxima consulta + atendimentos com medidas e orientação), links "Todas as medidas" (`/p/evolucao`) e "Minhas consultas" (`/p/agenda`) |
| G-01e | **Plano** (`/p/plano`) | Refeições em sanfona com a próxima destacada (molde F-Plano), "Baixar PDF", "Lista de compras", "Conteúdos"; cópia offline mantida |
| G-01f | **Exames** (`/p/exames`) | A tela do Plano 12 no visual novo (formulário só com o recebimento ligado; lista sempre) |
| G-01g | **Eu** (`/p/perfil`) | Lista por assunto (molde D-Assuntos): conta, consultório e "Trocar de nutricionista", Meus documentos, Notificações (push e WhatsApp), Instalar o app, Privacidade (baixar e pedir exclusão), Como usar o app, Sair |
| G-01h | **Visual** | Tokens do portal (fundo, texto, verde claro, âmbar, bordas) claros e escuros, fontes Red Hat Display e Atkinson Hyperlegible Next, cor do consultório com contraste garantido (RN-207), `/p/termo`, `/p/escolher`, `/p/sem-acesso` e `/p/meus-dados/exportacoes/<id>` no mesmo visual |
| G-01i | **Manual guiado do portal** | Tour "O app mudou" (uma vez) e "Como usar o app" em Eu, sem JavaScript obrigatório (RN-212) |
| G-02 | **"Não mostrar peso no app"** | Coluna por paciente, caixa no prontuário (aba Evolução), efeito na faixa, na Jornada e em "Todas as medidas"; trilha pelo gatilho de auditoria (RN-203 a RN-206) |

### 2.2 Fora

Chat ou mensagem livre paciente ↔ nutricionista (C-191) · tabela de mensagens, "lido/não lido" de mensagem, push novo ·
redesenho do painel (G-D3) · IA no mural ou na refeição (Plano 15) · registro offline do diário ou das respostas (só o
plano fica offline, P06 D6) · mural unindo vários consultórios (cada vínculo tem o seu, RN-210) · editar ou apagar
resposta já gravada (o paciente só cria no diário, P06 D11; ver G-D5) · meta de peso, "peso ideal", ranking, medalha
ou sequência ("streak") · lembrete por horário de refeição por push ou WhatsApp (seria push novo e custo de cota) ·
mudar o que o paciente vê de exames depois de aceitos (spec C, D17 = a) · receitas e pareceres novos (Planos 10A/13 —
só ganham o visual) · tema escolhido pelo paciente (o portal segue o aparelho, P08 D18).

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Paciente** (sessão `paciente`, vínculo ativo e termo aceito) | Ver as cinco seções do próprio vínculo; responder às refeições (grava no próprio diário); confirmar presença, agendar, enviar exame, baixar o próprio PDF e os documentos como hoje | Ver a opção "Não mostrar peso no app" nem mudá-la (gatilho `paciente_colunas`, 0085); ver o mural de outro paciente ou de outro consultório (RLS por paciente); escrever texto livre para a nutricionista |
| **Nutricionista** | Ligar e desligar "Não mostrar peso no app" de um paciente (aba Evolução do prontuário); ver as respostas no feed do diário (US-043) e comentar como hoje | Escrever no mural (o mural não guarda nada); esconder do paciente dado que a LGPD manda entregar (exportação do titular, RN-204) |
| **Admin** | — (nada novo) | Ver dado de paciente (como hoje) |
| **Worker** | — (nada novo: o mural não tem job) | — |

---

## 4. Arquitetura

### 4.1 Seções e rotas

As rotas atuais ficam; muda a moldura e o que cada uma "marca" na navegação (`ITENS_DO_PORTAL` passa a ter 5 itens,
com `tambem` cobrindo as rotas que não são seção).

| Seção | Rota da seção | Também marca a seção | Título na faixa |
|---|---|---|---|
| **Hoje** | `/p/inicio` | `/p/diario` (diário completo) | "Olá, {primeiro nome}" + data por extenso curta ("Quinta, 8 out") |
| **Jornada** | `/p/jornada` (nova) | `/p/evolucao` ("Todas as medidas"), `/p/agenda`, `/p/agenda/nova`, `/p/agenda/<id>` | "Sua jornada desde {mês da primeira consulta}" (sem consulta: "Sua jornada") |
| **Plano** | `/p/plano` | `/p/plano/refeicao/<id>` (nova), `/p/compras`, `/p/conteudos`, `/p/conteudos/<id>` | "Plano de hoje" |
| **Exames** | `/p/exames` | — | "Meus exames" |
| **Eu** | `/p/perfil` | `/p/documentos`, `/p/meus-dados/exportacoes/<id>`, `/p/ajuda` (nova) | "Eu" |

Fora do layout do portal (sem seções, com "Sair" no topo como hoje): `/p/escolher`, `/p/sem-acesso`, `/p/termo`.

`/p` continua redirecionando para `/p/inicio`. `manifest.ts` não muda (`id` e `start_url` = `/p/inicio`, C-195);
`theme_color` continua `#1d6b5a`.

### 4.2 Moldura

```
┌──────────────────────────────────────────────┐
│ [logo] Acompanhamento com {consultório}      │  ← faixa (cor do consultório, RN-207), texto branco
│ Olá, Marina                     Quinta, 8 out│  ← h1 da seção (em Hoje: saudação)
│ ┌──────────────────────────────────────────┐ │
│ │ ╲__╲__•▪  −4,2 kg desde março        ›  │ │  ← mini-jornada (só em Hoje): link para Jornada
│ │           Próximo marco: amanhã, 14:00   │ │
│ └──────────────────────────────────────────┘ │
│ [Hoje] Jornada  Plano  Exames  Eu            │  ← nav "Seções": 5 colunas iguais, nunca rola
├──────────────────────────────────────────────┤
│ Offline — exibindo última versão             │  ← SeloOffline (como hoje)
│ … conteúdo da seção …                        │
├──────────────────────────────────────────────┤
│ 📷 Foto da refeição │ ⬆ Enviar exame │ 📅 Agendar │  ← nav "Ações" (só em Hoje)
└──────────────────────────────────────────────┘
```

- **Faixa** (`<header>`): primeira linha com o logo do consultório (URL assinada de 5 min, fundo branco, como hoje) e
  "Acompanhamento com {nome de exibição}" — mantém a US-005 "Marca aplicada" e diz em qual consultório o paciente está
  quando tem mais de um vínculo (RN-210). Depois o `h1` da seção e, só em Hoje, a mini-jornada (RN-202).
- **Seções** (`<nav aria-label="Seções">`): 5 links em **grade de colunas iguais** (`grid-cols-5`; 4 quando "Exames"
  não aparece, RN-192), alvo de toque ≥ 44 px, `aria-current="page"` na seção atual (pílula branca com texto escuro;
  as outras em texto branco — o estado não depende só de cor: pílula + `aria-current`). **Nunca rola na horizontal**
  em nenhuma largura (regra ratificada pelo dono em 04/10/2026 para a barra atual; a palavra que não cabe quebra com
  hífen, como em `nav-portal.tsx`).
- **Telas de detalhe** (refeição aberta, consulta, conteúdo, documento, exportação, "Todas as medidas", "Minhas
  consultas", diário completo, lista de compras): cabeçalho compacto na cor do consultório com o link "Voltar" (44 × 44
  px, `aria-label="Voltar para {destino}"` — a seção, ou a lista de que o detalhe faz parte, como "Minhas consultas") e o
  título; sem a nav "Seções": a seção a que a tela pertence é dita pelo "Voltar para {seção}" (G-D13 ★). O "Voltar" é um
  **link fixo para o destino**, não o histórico do navegador (o nome acessível tem de dizer para onde o toque leva; filtros,
  busca, `?dias=`, `?semana=` e redirects mudam a URL); o "voltar" do navegador e o gesto do aparelho continuam valendo.
- **Barra de ações** (`<nav aria-label="Ações">`, só em Hoje, fixa embaixo): "Foto da refeição" (abre o registro do
  diário com a câmera, RN-197), "Enviar exame" (→ `/p/exames#enviar`; some com o recebimento desligado, RN-215) e
  "Agendar" (→ `/p/agenda/nova`; no teto de consultas futuras, leva a "Minhas consultas", que já mostra o motivo).
- **"Sair"** sai do topo das páginas do portal e vai para o fim de **Eu** (o mesmo `SairPortal`, que limpa o aparelho).
  Nas páginas fora do layout (`/p/escolher`, `/p/sem-acesso`, `/p/termo`) continua no topo.

### 4.3 O mural "Hoje"

O mural é **leitura**: `muralDoPaciente(ctx, tenant, agora)` (módulo novo `src/modules/portal/mural.ts`) abre **uma**
transação `withTenant` com o contexto do paciente, lê as fontes abaixo (RLS por paciente) e devolve uma lista de
**itens tipados**; uma função pura `comporMural(fontes, agora, fuso)` decide quais itens aparecem, a ordem, os textos e
os botões — testável sem banco. Nada é gravado para o mural existir; não há "mensagem" no banco.

| Fonte (já existe) | Item no mural | Quando aparece | Autor mostrado | Botões | Auditoria |
|---|---|---|---|---|---|
| Plano publicado: refeição **com horário** (`planoDoPaciente`) | "Próxima refeição às {HH:MM} — {nome}: {resumo}." antes do horário; "{nome} das {HH:MM}: {resumo}." depois | De **90 min antes** do horário até o fim do dia (RN-196) | App do consultório | "Ver a refeição", "Comi assim" (some depois da resposta) | `auditRead` entidade do plano (como `planoDoPaciente`) |
| Primeira refeição do dia | Igual, com a saudação na frente: "Bom dia, {primeiro nome}." | Idem | App do consultório | Idem | Idem |
| Diário do dia (`diary_entries` do paciente) | Balão do paciente: foto (JPEG convertido) e/ou texto, rótulo da resposta ("Comi assim" / "Comi outra coisa"), refeição | Na hora do registro | Você | — (o balão leva ao diário completo) | `auditRead` `diario` |
| Comentário da nutricionista (`comentario_nutri`, `comentado_em`) | "Sua nutricionista comentou seu registro ({refeição}, {dia} às {hora})" + o texto dela, verbatim | Em `comentado_em`, se nos últimos 7 dias | **Sua nutricionista** | "Ver no diário" | Mesma leitura do diário |
| Envio de exame (`meusEnvios`) | "{nome do envio}: {situação}" (texto de `SITUACAO`, igual ao de `/p/exames`) | Envio de hoje, e mudança de situação nos últimos 7 dias (`revisado_em`/`updated_at`) | App do consultório (a recusa leva o motivo que a nutricionista escolheu ou escreveu, como hoje) | "Ver meus exames" | `auditRead` `exames_enviados` (como `meusEnvios`) |
| Próxima consulta (`consultasDoPaciente`) | "Sua próxima consulta: {quando} ({modalidade})." | Consulta ativa nos próximos 7 dias | App do consultório | "Ver a consulta"; "Confirmar presença" se agendada, não confirmada e ainda alterável | Sem `auditRead` (P05 D10) |
| Plano novo (`meal_plans.publicado_em`) | "Seu novo plano alimentar está disponível." | Publicado nos últimos 7 dias | App do consultório | "Ver o plano" | Mesma leitura do plano |
| Conteúdo novo (`feedDeConteudos`, `novo`) | "Novo conteúdo: {título}" (até 3, mais recentes) | Publicado nos últimos 7 dias e não visto | App do consultório | "Abrir" | Sem `auditRead` (P07 D6) |
| Documento novo (`novosNoPortal`, só com `documentosLiberados`) | "Você tem 1 documento novo." / "Você tem {n} documentos novos." | Enquanto houver documento assinado não aberto | App do consultório | "Ver documentos" | Sem `auditRead` (Plano 10A, D17: contagem) |
| Aparelho | "Ative as notificações para saber quando houver novidades." (`AtivarNotificacoes`) e "Instale o app na tela inicial." (`Instalar`) | No topo, enquanto não feito neste aparelho; "Agora não" esconde por 30 dias (`localStorage`, apagado no "Sair") | — | Os botões dos componentes atuais | — |

**Ordem e janela (RN-195).** O mural mostra **Hoje** (itens do dia, do mais antigo para o mais recente, com a hora
local) e, recolhido acima, **"Dias anteriores"** (`<details>`, últimos 7 dias, por dia, com separador "Ontem",
"Seg, 6 out"). Até **40 itens**; os mais antigos saem primeiro. Sem rolagem automática e sem região viva: o mural é
renderizado no servidor; volta a ser buscado quando o app volta ao primeiro plano (`visibilitychange` →
`router.refresh()`), sem anunciar nada ao leitor de tela.

**Rodapé fixo do mural (RN-193):** "Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar
quando os ler. Este app não é um canal de conversa e não tem prazo de resposta. Dúvidas: anote para a consulta ou use os
contatos do consultório. Em emergência, ligue 192." (texto ★ G-D10). **Emenda do Plano 15 (D34):** com a IA Nutri, a frase
"Este app não é um canal de conversa" deixou de ser verdade; o rodapé passa a "Seus registros do diário ficam visíveis
para sua nutricionista, que pode comentar quando os ler. O mural não é uma conversa com a sua nutricionista e não tem prazo
de resposta. A IA Nutri, quando liberada, é um programa e responde só sobre o seu plano. Dúvidas: anote para a consulta
ou use os contatos do consultório. Em emergência, ligue 192." (`MSG_MURAL.rodape`, nome pela constante `NOME_IA_NUTRI`),
a mesma redação no guia do portal (`GUIA_PORTAL` v2). A v0.1 dizia "Este app não envia mensagens para sua
nutricionista", o que é falso: todo registro do diário, com o texto livre e a foto, vai ao feed dela (US-043), e ela
comenta (LGPD art. 6º, VI — transparência; a urgência é boa prática, não exigência de norma).

**Mural vazio:** sem plano publicado, "Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições
aparecem aqui."; com plano publicado e nada para agora (antes dos 90 min da primeira refeição, ou refeições sem horário),
"Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma." — o mural nunca diz que ela não publicou
quando publicou.

**Autor visível (RN-194, §11.1):** todo item mostra o autor em texto — "Você", "Aviso do app" (o que o sistema monta) ou,
no comentário, "Sua nutricionista comentou seu registro ({refeição}, {dia} às {hora})" — com a hora; o lado e a cor do
balão não bastam (lembrariam um chat, R-190), e o comentário dela tem estilo próprio (borda de destaque), diferente do
aviso automático.

### 4.4 Respostas da refeição (diário existente)

```
"Comi assim" (mural ou refeição aberta)
   └─ server action responderRefeicao(refeicaoId, 'como_no_plano')
        └─ registrarNoDiario(ctx, tenant, { refeicao: mapeada, texto: null, foto: null,
                                             resposta: 'como_no_plano', refeicaoDoPlano: '{nome} · {HH:MM}' })
             ├─ confere que a refeição é do plano publicado do paciente (leitura pela RLS)
             ├─ conferirLimite (paciente travado: 10/dia, RN-07) + 1 resposta por refeição do plano por dia (RN-197)
             └─ INSERT diary_entries (gatilho de auditoria: ator = conta do paciente)
"Comi outra coisa"  → formulário do diário com a refeição já escolhida; texto ou foto obrigatório; resposta 'outra_coisa'
"Mandar foto do prato" / "Foto da refeição" → formulário do diário com a câmera; depois da foto, escolher
                      "Comi assim" ou "Comi outra coisa" (opcional) e "Enviar" → o fluxo da foto de hoje (P06 D10)
```

A refeição do diário (`refeicao`, lista fechada) vem do **nome** da refeição do plano: se o nome, sem acento e sem
diferença de maiúsculas, for igual a um item de `REFEICOES_DO_DIARIO`, usa esse item; senão, "Outro". O nome e o horário
originais ficam em `refeicao_do_plano` (cópia, não FK: o plano muda de id a cada publicação e a resposta tem de
continuar dizendo a que refeição se referia — prática de integridade do registro, §11).

### 4.5 Jornada

`jornadaDoPaciente(ctx, tenant, agora)` (módulo novo `src/modules/portal/jornada.ts`) junta, numa transação:

- **Atendimentos** (`consultations` do paciente: `data`, `orientacoes_paciente`) — `auditRead` `atendimentos`, como
  `orientacoesDoPaciente`;
- **Avaliações antropométricas** (`listarAntropometrias`, já auditada), filtradas pela regra `permitida` de hoje e pela
  RN-203; cada avaliação vai para o atendimento de `consultation_id`; a sem atendimento vira um marco próprio ("Medidas
  de {data}");
- **Próxima consulta** (`consultasDoPaciente`, sem `auditRead`).

```
Peso nas consultas  [gráfico: um ponto por avaliação com peso; tracejado até o marco âmbar da próxima consulta]
                    "Todas as medidas" → /p/evolucao
● Amanhã, 14:00 · próxima consulta        (marco âmbar, com contorno — RN-207)
  Online.                                   ← modalidade; "Ver a consulta"
● 22 de setembro                            (data do atendimento)
  78,6 kg · cintura 86 cm                   ← medidas permitidas (peso só sem a RN-203)
  ┌ Orientação da sua nutricionista ┐       ← orientacoes_paciente, verbatim
● 18 de março · primeira consulta
"Minhas consultas" → /p/agenda   "Agendar consulta" → /p/agenda/nova
```

O gráfico é o `GraficoLinha` atual (com a alternativa em texto/tabela que ele já tem), no visual novo. Com **menos de 2
pesos** e o peso visível, o gráfico vira "Cintura nas consultas" se houver ≥ 2 cinturas; **com o peso oculto, nenhum
gráfico de medida corporal em destaque** (G-D16 = a, respondida em 08/10/2026; a cintura continua nas consultas da
linha do tempo); senão, não aparece
(nenhuma mensagem sobre o peso faltar). O texto do desenho "Leve suas dúvidas anotadas." **não** entra: seria texto do
sistema com voz de orientação; a linha mostra só a modalidade e o local/link, como "Minhas consultas".

### 4.6 "Não mostrar peso no app"

```
Painel › paciente › aba Evolução: [ ] Não mostrar peso no app
   └─ action definirPesoOculto(patientId, ligado) → withTenant (equipe) → UPDATE patients SET peso_oculto_no_app_em = now() | null
        ├─ gatilho audit_row_change de patients: "alterar", quem e quando (sem dizer a coluna)
        └─ recordAudit na mesma transação: entidade peso_no_app, "criar" (ligou) ou "excluir" (desligou), quem e quando
Portal (qualquer leitura de medida para o paciente): evolucaoParaPaciente / jornadaDoPaciente / faixa
   └─ lê patients.peso_oculto_no_app_em do próprio paciente (RLS) e tira peso e IMC (G-D6) ANTES de montar a resposta
```

A filtragem é **no servidor, no módulo**, nunca por CSS ou no componente: o valor não chega ao aparelho (CS-194). O
texto de ajuda da caixa, no painel: "O paciente não vê esta opção. O peso e o IMC deixam de aparecer no app. Continuam no
prontuário, nos documentos que você assina, no que você escreve (orientações e comentários aparecem como estão) e na
cópia dos dados que o paciente pedir (LGPD)." (texto ★ G-D10).

### 4.7 Cor do consultório e tokens

- **Faixa e cabeçalhos:** cor do consultório (`--nd-marca-base`) — a mesma que o painel usa como `destaque` —, nos
  modos claro e escuro, com **texto sempre branco** (`#ffffff`). A cor já passa por **≥ 4,5:1 com o branco** na
  validação (`perfilSchema`), mas o desenho põe outras coisas sobre ela: o cartão translúcido da mini-jornada e o traço
  claro do gráfico. Conta feita nesta spec: com a cor padrão `#1d6b5a`, branco = 6,36:1 e o cartão translúcido (verde
  claro a 16%) com texto branco = 4,64:1; com uma cor de consultório no limite (≈ `#767676`, 4,54:1), o mesmo cartão cai
  para **3,52:1** e o texto `#e2efe9` direto na faixa para **3,84:1** — reprovados. Por isso:
  - **`corDaFaixa(cor)`** (nova, em `src/lib/tema/marca-tema.ts`, ao lado de `corNoEscuro`): escurece a cor do
    consultório só o necessário (passos de luminosidade) até o **branco sobre o cartão translúcido** dar **≥ 4,5:1**;
    a cor padrão não muda. Teste de propriedade: para toda cor aceita pelo `perfilSchema`, os pares da faixa passam
    (RNF-192). O ajuste vale só na faixa e nos cabeçalhos do portal (G-D7 ★);
  - na faixa, **nenhum texto em verde claro**: rótulos, seções não selecionadas e data em branco;
  - traços do gráfico na faixa (`aria-hidden`, o texto ao lado diz tudo) em branco a 85%.
- **Tokens do portal** (escopados num atributo do contêiner do portal, p. ex. `data-app="paciente"`, para não tocar o
  painel — C-193):

| Token | Claro | Escuro | Uso | Contraste conferido (claro) |
|---|---|---|---|---|
| `--nd-p-fundo` | `#eaf0ec` | `#0f1613` (o fundo escuro atual) | fundo da página | texto `#14211d` = 14,37:1 |
| `--nd-p-texto` | `#14211d` | `#e6efe9` | texto | — |
| `--nd-p-suave` | `#4b5c55` | `#a9bab2` | hora, rótulos | 6,14:1 no fundo; 6,00:1 no verde claro; 7,09:1 no branco |
| `--nd-p-cartao` | `#ffffff` | `#17221d` | balão do consultório, cartões | — |
| `--nd-p-clara` | `#e2efe9` | `#1f3a31` | balão do paciente, separador de dia | texto = 14,04:1 |
| `--nd-p-borda` | `#d5e0da` | `#2b3a33` | linhas (decorativas) | — |
| `--nd-p-marco` | `#f0b867` | `#f0b867` | marcos (próxima consulta), chip da refeição | texto escuro sobre ele = 9,29:1; **sobre o fundo claro só 1,55:1 → o marco leva contorno de 2 px em `--nd-p-texto`** (WCAG 1.4.11) e nunca é a única pista (o texto diz "próxima consulta") |
| botão de resposta | borda `--nd-marca` | borda `--nd-marca-clara` | "Comi assim" etc. | borda `#1d6b5a` no branco = 6,36:1 |

  Os valores escuros são ponto de partida: o plano confere cada par com `contraste()` em teste (RNF-192) e ajusta.
- **Fontes:** Red Hat Display (700/800/900) nos títulos e números; Atkinson Hyperlegible Next (400/700) no texto; só
  no portal (`next/font` no layout de `/p`), subconjunto `latin`, `display: swap` (DEP-G8, RNF-193). O painel continua
  com Figtree e Bricolage Grotesque.

### 4.8 Offline (mantido)

Nada muda na regra do service worker (manual 5.5.4): só **`/p/plano`** fica no aparelho, e qualquer navegação em `/p/`
sem rede cai na cópia do plano com o selo "Offline — exibindo última versão". Para isso funcionar com o layout novo:

- a página `/p/plano` **contém tudo da refeição aberta** (quantidades, trocas, observação) em sanfona: sem rede, abrir
  Hoje ou uma refeição mostra a cópia do plano com tudo;
- a cópia guardada traz a moldura do plano (faixa com o título "Plano de hoje" e as seções). As seções levam à cópia;
- **as respostas não funcionam offline**: os botões que gravam ficam desabilitados com "Sem conexão. Registre quando
  voltar." (sem fila offline — §2.2);
- `versaoDaCopiaOffline` não muda; o `x-nd-build` já força a renovação da cópia no deploy (manual 5.5.4, "Deploy novo").

### 4.9 Mudanças mínimas no painel

1. **Aba Evolução do prontuário** (`src/app/painel/pacientes/[id]/evolucao/page.tsx`): a caixa "Não mostrar peso no
   app" com o texto de ajuda (§4.6) e, quando ligada, a linha "Peso oculto no app desde {data}". Somente leitura para
   paciente bloqueado ou anonimizado (como "Uso de IA").
2. **Feed do diário e registro aberto** (US-043, `src/modules/portal/diario-nutri.ts`): o registro com `resposta`
   mostra "Comeu como no plano" ou "Comeu outra coisa" e `refeicao_do_plano` ("Almoço · 12:30"). Sem isso, um "Comi
   assim" sem texto nem foto apareceria vazio para ela.

Nada mais no painel muda (G-D3).

### 4.10 Onde fica cada função de hoje ("nada some")

| Função de hoje | Onde está hoje | Onde fica | Caminho a partir de Hoje |
|---|---|---|---|
| Próxima consulta | Início | Mural (item da consulta, 7 dias) + mini-jornada + Jornada (marco âmbar) | 0 toque (mural/faixa) |
| Cartão "Documentos" (novos) | Início | Mural (item "documento novo") + Eu › Meus documentos | 1 |
| "Enviar exame" | Início (botão) | Barra de ações + seção Exames | 1 |
| Instalar o app | Início | Cartão do aparelho no mural + Eu › Instalar o app | 0–1 |
| Ativar notificações (push) | Início e Perfil | Cartão do aparelho no mural + Eu › Notificações | 0–1 |
| "Conectado como {e-mail}" | Início e Perfil | Eu (topo) | 1 |
| Plano do dia, refeições, quantidades, substituições, kcal (se liberadas), observação | Plano | Seção Plano (sanfona) + refeição aberta + mural | 1 |
| Sugestão de receita da refeição | Plano | Refeição aberta e sanfona do Plano (mesmo link `?de=plano`) | 2 (3 para refeição que não é a próxima: abrir a sanfona — G-D14 ★) |
| Orientações do plano | Plano | Seção Plano (fim) | 1 |
| Baixar PDF do plano | Plano | Seção Plano | 1 |
| Lista de compras | Plano (link) | Seção Plano (link) | 2 |
| Plano offline | `/p/plano` | `/p/plano` (sem mudança) | — |
| Registrar refeição (texto, foto) | Diário | Barra de ações "Foto da refeição", respostas do mural e da refeição, e o formulário completo em "Ver todo o diário" (`/p/diario`, marca Hoje) | 1 |
| Histórico do diário, situação da foto, comentário da nutricionista | Diário | Mural (hoje e 7 dias) + `/p/diario` (completo, 50 registros como hoje) pelo link "Ver todo o diário" no topo do mural | 1 |
| Conteúdos (feed, filtros, busca, etiqueta, favoritos, conteúdo aberto, PDF) | aba Conteúdos | Seção Plano › "Conteúdos" (`/p/conteudos`, marca Plano) + item "Novo conteúdo" no mural (G-D8 ★) | 2 (conteúdo aberto que não é novo: 3 — G-D14 ★) |
| Evolução: medidas, diferenças, gráficos | aba Evolução | Jornada (gráfico e medidas por consulta) + "Todas as medidas" (`/p/evolucao`, tabela por consulta como F-Medidas + os gráficos de hoje) | 1–2 |
| Orientações recebidas (por atendimento) | Evolução | Jornada (balão em cada consulta) | 1 |
| Minhas consultas (próximas e anteriores), consulta aberta | aba Agenda | Jornada › "Minhas consultas" (`/p/agenda`, marca Jornada) + item do mural "Ver a consulta" | 2 |
| Agendar consulta | Agenda | Barra de ações "Agendar" + Jornada | 1 |
| Confirmar presença, cancelar, remarcar | Consulta aberta | Consulta aberta (sem mudança) + "Confirmar presença" no item do mural | 1–2 (próxima consulta: mural ou Jornada › "Ver a consulta"); 3 para outra consulta futura (Jornada › "Minhas consultas" › consulta — G-D14 ★) |
| Meus documentos (abrir PDF, confirmar recebimento) | Perfil (link) | Eu › Meus documentos (`/p/documentos`, marca Eu) | 2 |
| Meus exames (enviar, lista, baixar, cancelar) | Perfil (link) | Seção Exames | 1 |
| Lembretes por WhatsApp | Perfil | Eu › Notificações | 1 |
| Baixar meus dados, pedir exclusão | Perfil › Privacidade | Eu › Privacidade (sem mudança de texto) | 1 |
| Página da exportação | e-mail | `/p/meus-dados/exportacoes/<id>` (marca Eu) | — |
| Trocar de nutricionista (2+ vínculos) | Perfil | Eu › consultório › "Trocar de nutricionista" | 1 |
| Sair | Topo de toda página | Eu (fim) — e topo das páginas fora do portal | 1 |
| Marca do consultório (logo e nome) | Barra abaixo do topo | Faixa (primeira linha) | 0 |
| Selo offline | Abaixo da marca | Abaixo da faixa | 0 |
| Termo, escolher consultório, sem acesso | Fora do layout | Fora do layout (visual novo) | — |
| Toque no push | `AVISOS_DO_PORTAL` | Mesmas rotas (todas existem) | — |

---

## 5. Histórias de usuário

### E16 — App do paciente G

#### US-190 — Navegar pelas seções · **M**

**Como** paciente, **quero** cinco seções claras no topo, **para** achar o que preciso sem procurar em sete abas.

```gherkin
Cenário: Seções na faixa
  Dado que entro no app com plano publicado e o consultório recebe exames pelo app
  Então vejo no topo, na cor do consultório, "Acompanhamento com {consultório}" e as seções "Hoje", "Jornada", "Plano", "Exames" e "Eu"
  E "Hoje" está marcada (aria-current="page")
  E a barra de 7 abas do rodapé não existe mais

Cenário: Recebimento de exames desligado e nenhum envio (RN-192, G-D9)
  Dado que o consultório não recebe exames pelo app e eu nunca enviei exame
  Então vejo 4 seções: "Hoje", "Jornada", "Plano" e "Eu"
  E a barra de ações não tem "Enviar exame"

Cenário: Rotas antigas continuam (C-195)
  Quando toco num push "Sua nutricionista comentou seu diário"
  Então abre "/p/diario" com o cabeçalho de detalhe e o link "Voltar para Hoje"
  Quando abro "/p/agenda" ou "/p/evolucao"
  Então o cabeçalho tem "Voltar para Jornada"
  Quando abro "/p/conteudos", "/p/compras" ou uma refeição
  Então o cabeçalho tem "Voltar para Plano"
  Quando abro "/p/documentos"
  Então o cabeçalho tem "Voltar para Eu"
  # telas de detalhe não têm a nav "Seções" (§4.2): a seção é dita pelo "Voltar" (G-D13 ★); nas seções, aria-current

Cenário: Tela estreita
  Dado um aparelho com 320 px de largura e o texto em 200%
  Então as seções cabem sem rolagem horizontal (a palavra que não cabe quebra)
  E cada seção tem alvo de toque de pelo menos 44 px

Cenário: Tela de detalhe
  Quando abro uma refeição
  Então vejo o cabeçalho com "Voltar" e o título da refeição, sem a lista de seções
  E "Voltar para Plano" me leva à seção Plano (link fixo para o destino que o nome diz; o "voltar" do navegador continua voltando pelo histórico)
```

#### US-191 — Ver o mural "Hoje" · **M**

**Como** paciente, **quero** ver num lugar só o que importa hoje, **para** não ter de abrir cada parte do app.

```gherkin
Cenário: Refeição que vem aí
  Dado que meu plano tem "Almoço" às 12:30 com arroz integral, feijão, frango grelhado e salada
  E agora são 11:05 no fuso do consultório
  Então vejo, do app do consultório, "Próxima refeição às 12:30 — Almoço: arroz integral, feijão, frango grelhado e salada."
  E os botões "Ver a refeição" e "Comi assim"
  E o item NÃO diz "Sua nutricionista"

Cenário: Refeição ainda distante
  Dado que o "Jantar" é às 19:30 e agora são 11:05
  Então o jantar não aparece no mural (aparece às 18:00)

Cenário: Refeição sem horário (RN-196)
  Dado que a refeição "Ceia" do plano não tem horário
  Então ela não aparece no mural e continua na seção Plano

Cenário: Comentário da nutricionista
  Dado que a nutricionista comentou "Ótima combinação!" no meu café da manhã às 09:15
  Então vejo, depois do meu registro, o balão "Sua nutricionista comentou" com "Ótima combinação!" e a hora 09:15

Cenário: Exame enviado
  Dado que enviei hoje o exame "Hemograma" e ele aguarda revisão
  Então vejo "Hemograma: Aguardando sua nutricionista" com o botão "Ver meus exames"
  Dado que a nutricionista recusou o envio ontem com o motivo "Imagem ilegível"
  Então vejo, em "Dias anteriores", "Hemograma: Não aceito: Imagem ilegível"

Cenário: Consulta próxima
  Dado que tenho consulta online amanhã às 14:00, agendada e ainda alterável
  Então vejo "Sua próxima consulta: amanhã, 14:00 (online)." com "Ver a consulta" e "Confirmar presença"
  Quando toco em "Confirmar presença"
  Então a consulta fica confirmada como na tela da consulta (mesma ação do Plano 05)

Cenário: Conteúdo, documento e plano novos
  Dado que a nutricionista publicou o conteúdo "Lanches para levar" anteontem e eu não abri
  E tenho 1 documento assinado não aberto
  E meu plano novo foi publicado há 2 dias
  Então vejo "Novo conteúdo: Lanches para levar" com "Abrir", "Você tem 1 documento novo." com "Ver documentos" e "Seu novo plano alimentar está disponível." com "Ver o plano"

Cenário: Sem caixa de texto (C-191)
  Então o mural não tem campo para escrever mensagem
  E vejo no rodapé "Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta. Dúvidas: anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192."

Cenário: Sem plano
  Dado que minha nutricionista ainda não publicou o plano e não há outro item
  Então vejo "Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui."

Cenário: Plano publicado e nada para agora
  Dado que meu plano está publicado e a primeira refeição é às 08:00
  Quando abro Hoje às 05:00 e não há outro item
  Então vejo "Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma."

Cenário: Fuso do aparelho diferente (RN-06)
  Dado que o consultório está em America/Sao_Paulo e meu aparelho em America/Manaus
  Então as horas do mural mostram a sigla do fuso, como "Minhas consultas" (QuandoLocal)

Cenário: Leitura auditada (P06 D22)
  Quando abro Hoje
  Então o histórico de acessos registra "Visualizou" do plano, do diário e dos exames enviados, com a minha conta como ator, uma vez por entidade
```

#### US-192 — Responder à refeição · **M**

**Como** paciente, **quero** dizer com um toque se comi o que estava no plano, **para** registrar o diário sem escrever.

```gherkin
Cenário: Comi assim
  Dado o item do almoço no mural
  Quando toco em "Comi assim"
  Então vejo "Registrado no diário." (role="status")
  E o item mostra o meu balão "Comi assim" com a hora
  E o diário ganha um registro: refeição "Almoço", resposta "como_no_plano", refeição do plano "Almoço · 12:30", sem texto e sem foto
  E a nutricionista vê no feed do diário "Comeu como no plano" (§4.9)

Cenário: Desfazer (G-D5 = c, se aprovada)
  Quando toco em "Comi assim" e, antes de 10 s, toco em "Desfazer"
  Então nada é gravado
  E o leitor de tela anuncia "Registro desfeito."

Cenário: Comi outra coisa
  Quando toco em "Comi outra coisa"
  Então abre o registro do diário com a refeição "Almoço" já escolhida
  E preciso escrever o que comi ou mandar foto ("Escreva o que você comeu ou envie uma foto.")
  Quando escrevo "Sanduíche natural" e toco em "Registrar"
  Então o registro tem resposta "outra_coisa" e o texto

Cenário: Mandar foto do prato
  Quando toco em "Mandar foto do prato" e tiro a foto
  E escolho "Comi assim" e toco em "Enviar"
  Então o registro tem a foto (convertida no worker, sem EXIF/GPS, como hoje) e a resposta "como_no_plano"
  E o balão mostra "Foto sendo preparada…" até a conversão

Cenário: Uma resposta por refeição por dia (RN-197)
  Dado que já respondi "Comi assim" no almoço de hoje
  Então o item do almoço não mostra mais "Comi assim"
  E uma segunda resposta ao mesmo almoço no mesmo dia (outra aba, toque duplo) devolve o registro já gravado, sem criar outro

Cenário: Limite do dia (RN-07)
  Dado que já fiz 10 registros hoje
  Quando toco em "Comi assim"
  Então vejo "Limite de 10 registros por dia atingido"

Cenário: Refeição que não é do meu plano
  Quando uma requisição responde a uma refeição de outro plano ou de outro paciente
  Então nada é gravado (a refeição é lida pela RLS do paciente e não é encontrada)

Cenário: Sem conexão
  Dado que estou sem rede
  Então os botões que gravam aparecem desabilitados com "Sem conexão. Registre quando voltar."

Cenário: Paciente bloqueado
  Dado que meu vínculo foi bloqueado depois que abri a tela
  Quando toco em "Comi assim"
  Então vejo "Conta temporariamente indisponível" (conferirLimite, como hoje)
```

#### US-193 — Abrir a refeição · **M**

**Como** paciente, **quero** ver a refeição com quantidades e trocas, **para** montar o prato certo.

```gherkin
Cenário: Refeição aberta
  Quando toco em "Ver a refeição" no almoço
  Então vejo o chip "Almoço · 12:30", o título com os itens principais "Arroz integral, feijão, frango grelhado e salada"
  E cada item com a quantidade à direita ("Arroz integral — 4 colheres de sopa")
  E, abaixo de cada item com substituição, as trocas ("ou batata-doce, 1 média · ou mandioca, 2 pedaços")
  E a observação da refeição escrita pela nutricionista ("Comece pela salada.")
  E a sugestão de receita, se houver (mesmo link de hoje, ?de=plano)
  E os botões "Mandar foto do prato", "Comi assim" e "Comi outra coisa"

Cenário: Calorias
  Dado que o plano está com "mostrar calorias" desligado
  Então a refeição aberta não mostra kcal
  Dado que está ligado
  Então vejo "Cerca de {kcal} kcal" e as kcal de cada item, como na seção Plano

Cenário: Refeição de outro plano
  Quando abro "/p/plano/refeicao/<id>" de uma refeição que não é do meu plano publicado
  Então vejo "Página não encontrada" (404)

Cenário: Offline
  Dado que estou sem rede
  Quando abro a refeição
  Então vejo a cópia do plano, com a mesma refeição aberta na sanfona, e o selo "Offline — exibindo última versão"
```

#### US-194 — Ver a Jornada · **M**

**Como** paciente, **quero** ver minhas consultas e o que mudou em cada uma, **para** acompanhar meu progresso.

```gherkin
Cenário: Jornada completa
  Dado que tive atendimentos em 18/03, 15/07 e 22/09 com peso, cintura e orientações, e tenho consulta amanhã às 14:00
  Então vejo "Sua jornada desde março"
  E o gráfico "Peso nas consultas" com os pesos de cada avaliação e o marco da próxima consulta
  E a linha do tempo, da próxima consulta para a primeira:
    | Amanhã, 14:00 · próxima consulta                        |
    | 22 de setembro — 78,6 kg · cintura 86 cm — orientação   |
    | 15 de julho — 79,7 kg · cintura 88 cm — orientação      |
    | 18 de março · primeira consulta — 82,8 kg · cintura 92 cm |
  E o balão "Orientação da sua nutricionista" traz o texto que ela escreveu no atendimento, sem mudança

Cenário: Medidas que o paciente vê (P06 D14)
  Então vejo peso, IMC e circunferências; % de gordura só se o consultório liberou
  E nunca dobras, densidade ou exames

Cenário: Avaliação sem atendimento
  Dado uma avaliação antropométrica de 27/05 sem atendimento ligado
  Então a linha do tempo tem "Medidas de 27 de maio" com as medidas

Cenário: Ainda sem consulta
  Dado que ainda não tive atendimento nem tenho consulta marcada
  Então vejo "Sua jornada" e "Sua jornada começa na primeira consulta."
  E o botão "Agendar consulta" (se eu puder agendar)

Cenário: Todas as medidas
  Quando toco em "Todas as medidas"
  Então vejo uma tabela com uma coluna por avaliação e uma linha por medida, e a coluna "Desde {mês}" com a diferença
  E os gráficos de hoje logo abaixo (com a alternativa em texto)
  E a tabela tem cabeçalhos de linha e de coluna (th com scope)

Cenário: Minhas consultas
  Quando toco em "Minhas consultas"
  Então vejo as próximas e as 10 anteriores com a situação, como hoje

Cenário: Mini-jornada na faixa
  Então em Hoje a faixa mostra "−4,2 kg desde março" e "Próximo marco: consulta amanhã, 14:00"
  E o nome acessível do link contém o texto visível, sem aria-label (WCAG 2.5.3): "Sua jornada: −4,2 kg desde março (78,6 kg na última consulta) Próximo marco: consulta amanhã, 14:00" — "Sua jornada:" e o último peso só para o leitor de tela (sr-only)
  E não há cor de "bom" ou "ruim", elogio ou meta (RN-206)
```

#### US-195 — Nutricionista esconde o peso do app · **M**

**Como** nutricionista, **quero** que o app de um paciente não mostre o peso, **para** proteger quem se faz mal ao ver o número.

```gherkin
Cenário: Ligar a opção
  Dado o prontuário da paciente Marina, aba Evolução
  Quando marco "Não mostrar peso no app"
  Então vejo "Peso oculto no app desde 08/10/2026"
  E o histórico de acessos registra "Ligou — Peso oculto no app" com o meu nome (linha própria, entidade peso_no_app), além da alteração em "patients"

Cenário: Efeito no app (G-D6 = a, se aprovada)
  Dado que "Não mostrar peso no app" está ligado para Marina
  Quando Marina abre o app
  Então a faixa de Hoje mostra "{n} consultas desde março" e "Próximo marco: consulta amanhã, 14:00", sem peso
  E a Jornada não tem o gráfico de peso nem peso ou IMC nas consultas (a cintura continua)
  E "Todas as medidas" não tem as linhas de peso e de IMC
  E nenhuma resposta do servidor ao aparelho de Marina contém o peso ou o IMC (HTML, payload RSC, cópia offline) (CS-194)
  E o app não diz que o peso está oculto

Cenário: O paciente não vê nem muda a opção
  Então a opção não aparece em nenhuma tela do app
  E um UPDATE em patients.peso_oculto_no_app_em pela sessão de paciente é recusado pelo gatilho paciente_colunas

Cenário: O que não muda (RN-204)
  Dado que a opção está ligada
  Quando Marina pede "Baixar meus dados"
  Então o dados.json traz as avaliações com o peso (direito de acesso, LGPD art. 18, II)
  E os documentos assinados e as orientações escritas pela nutricionista aparecem como foram escritos

Cenário: Desligar
  Quando desmarco "Não mostrar peso no app"
  Então o peso volta a aparecer no app no próximo carregamento
  E o histórico de acessos registra "Desligou — Peso oculto no app" com o meu nome (dá para reconstruir quando o peso esteve oculto e quem decidiu, R-193)
```

#### US-196 — Plano, lista de compras e conteúdos · **M**

**Como** paciente, **quero** o plano do dia, a lista de compras e os conteúdos da minha nutricionista na seção Plano, **para** ter tudo da alimentação num lugar.

```gherkin
Cenário: Plano em sanfona
  Quando abro "Plano"
  Então vejo as refeições pelo horário, cada uma recolhida com o horário, o nome e, na próxima, "Próxima, daqui a 1 h 25 min" (o "No diário" fica no mural e na refeição aberta: a página do Plano é a cópia offline e não leva dado do diário, §4.8)
  E a próxima refeição vem aberta e destacada (borda âmbar com contorno)
  E cada refeição aberta mostra itens, quantidades, trocas, observação, receita sugerida e os botões de resposta
  E vejo "Baixar PDF", "Lista de compras", "Conteúdos" e as orientações do plano no fim

Cenário: Conteúdos dentro de Plano (G-D8 = a, se aprovada)
  Quando toco em "Conteúdos"
  Então vejo a biblioteca de hoje (Todos, Vídeos, Receitas, Orientações, Favoritos, busca e etiqueta) com a seção "Plano" marcada

Cenário: Plano offline (US-040)
  Dado que abri "Plano" com rede hoje
  Quando abro o app sem rede
  Então vejo a cópia do plano com o selo "Offline — exibindo última versão"
```

#### US-197 — Exames e "Eu" · **M**

**Como** paciente, **quero** achar meus exames, documentos, notificações, privacidade e a saída sem procurar, **para** cuidar da minha conta.

```gherkin
Cenário: Exames
  Quando abro "Exames"
  Então vejo "Enviar exame" (com o recebimento ligado) e "Meus exames enviados", com as regras do Plano 12 sem mudança

Cenário: Eu
  Quando abro "Eu"
  Então vejo, em lista: "Conectado como {e-mail}", o consultório (logo, nome) e "Trocar de nutricionista" (só com 2+ vínculos), "Meus documentos" (só com documentos liberados), "Notificações", "Instalar o app", "Privacidade", "Como usar o app" e "Sair"

Cenário: Privacidade sem mudança
  Quando abro "Privacidade"
  Então vejo "Baixar meus dados" e "Pedir exclusão dos meus dados" com a mesma confirmação de hoje
  E o texto "Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados)." (RN-214)

Cenário: Sair
  Quando toco em "Sair"
  Então o aparelho é limpo como hoje (cookies, cópia do plano, lista de compras, cartões dispensados) e volto ao login
```

#### US-198 — Cor do consultório e modo escuro · **M**

**Como** nutricionista, **quero** que o app dos meus pacientes tenha a cor do meu consultório, **para** que reconheçam o atendimento — **e como** paciente, **quero** ler tudo bem em qualquer modo.

```gherkin
Cenário: Cor padrão
  Dado um consultório sem cor própria
  Então a faixa usa #1d6b5a com texto branco

Cenário: Cor do consultório no limite do contraste (RN-207, G-D7)
  Dado um consultório com a cor #767676 (4,54:1 com o branco)
  Então a faixa usa corDaFaixa(#767676), um pouco mais escura, e todo texto da faixa e do cartão da mini-jornada passa de 4,5:1

Cenário: Modo escuro
  Dado que o aparelho está no modo escuro
  Então o fundo, os cartões e os balões usam os tokens escuros do portal
  E a faixa continua na cor do consultório com texto branco
  E o axe não acha violação de contraste

Cenário: Movimento reduzido
  Dado que o aparelho pede movimento reduzido
  Então a sanfona e o tour abrem sem animação
```

#### US-199 — Manual guiado do portal · **S**

**Como** paciente que já usava o app, **quero** um passeio curto pelo layout novo, **para** não me perder.

```gherkin
Cenário: Primeira abertura depois do deploy
  Dado que nunca vi o tour "portal-novidades" na versão 1
  Quando abro Hoje
  Então vejo o aviso "O app mudou. Quer ver onde ficou cada coisa?" com "Ver como funciona" e "Agora não"
  Quando toco em "Ver como funciona"
  Então o tour mostra, em 5 passos ("1 de 5"), a faixa e a jornada, o mural, as respostas, a barra de ações e a seção "Eu"
  E "Voltar", "Próximo", "Concluir" e "Pular o tour" funcionam pelo teclado e pelo leitor de tela
  E o progresso fica gravado na minha conta (vale para todos os aparelhos e consultórios)

Cenário: Como usar o app
  Quando abro "Eu" > "Como usar o app"
  Então vejo a página de ajuda do portal, que funciona sem JavaScript, com "Ver o tour de novo"
```

---

## 6. Regras de negócio

| ID | Regra |
|---|---|
| RN-190 | **Seções.** O portal tem as seções **Hoje** (`/p/inicio`), **Jornada** (`/p/jornada`), **Plano** (`/p/plano`), **Exames** (`/p/exames`) e **Eu** (`/p/perfil`), nessa ordem. Nenhuma rota atual muda de endereço (C-195); a única rota de seção nova é `/p/jornada`. Rotas novas de detalhe: `/p/plano/refeicao/<id>` e `/p/ajuda` |
| RN-191 | **Seção marcada.** `itemAtual` marca a seção pela tabela da §4.1 (campo `tambem`); toda rota de `/p/(portal)` marca exatamente uma seção (teste) |
| RN-192 | **Seção "Exames" (G-D9 ★).** Aparece quando `tenants.exames_paciente_ativado_em` não é nulo **ou** o paciente tem envio não cancelado; senão, some da navegação (a rota continua abrindo pelo endereço, como hoje, Plano 12) |
| RN-193 | **O mural não é canal de mensagens** (spec C, D24 = b). Não tem caixa de texto, não grava nada além das respostas da RN-197 e das ações que já existem, não cria item visível à nutricionista como "mensagem" e não tem tabela própria. O rodapé fixo diz ao paciente que os registros do diário são visíveis para ela, que o app não é canal de conversa nem tem prazo de resposta, e onde levar dúvidas e urgências (§4.3) **Emenda do Plano 15 (15/10/2026; spec C §7.8, D34):** o rodapé diz que o **mural** não é uma conversa com a nutricionista nem tem prazo de resposta e que a IA Nutri, quando liberada, é um programa e responde só sobre o plano (§4.3); o único item da IA Nutri em Hoje é o convite único "A IA Nutri está disponível para você." ("Aviso do app", "Agora não" por 30 dias). |
| RN-194 | **Autoria.** Só texto escrito pela nutricionista leva a voz dela: "Sua nutricionista comentou seu registro (…)" (comentário do diário, com a refeição e a hora do registro a que se refere), "Orientação da sua nutricionista" (atendimento), a observação da refeição e as orientações do plano. Texto montado pelo sistema é do "app do consultório" (autor visível "Aviso do app"), em 3ª pessoa ou impessoal, sem elogio, conselho ou ordem ("Comece pela salada" só aparece se ela escreveu). Nenhum item diz "IA" (não há IA no mural) **Emenda do Plano 15 (15/10/2026; spec C §7.8, D34):** fora do mural, a tela da IA Nutri tem três autores em texto — "Você", "IA Nutri — inteligência artificial" e "Aviso do app" —; nenhum texto da IA Nutri leva a voz da nutricionista, e a resposta montada só reproduz o que ela escreveu, com a fonte (spec C, RN-172). |
| RN-195 | **Janela e ordem.** Hoje (dia no fuso do tenant) em ordem crescente de hora; "Dias anteriores" com os últimos 7 dias, recolhido; no máximo 40 itens (os mais antigos saem). Constantes `JANELA_MURAL_DIAS = 7`, `MAX_ITENS_MURAL = 40` |
| RN-196 | **Refeição no mural.** Só refeição do plano **publicado** com horário. Aparece a partir de `horário − 90 min` (`ANTECEDENCIA_REFEICAO_MIN = 90`) e fica até o fim do dia; a primeira refeição do dia leva a saudação ("Bom dia" de 05:00 a 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" no resto). Resumo = nomes dos itens principais (sem substituições), até 4, unidos por vírgula e "e"; sem quantidade no mural (a quantidade fica na refeição aberta) |
| RN-197 | **Respostas.** "Comi assim" grava em `diary_entries` com `resposta = 'como_no_plano'`, sem texto nem foto; "Comi outra coisa" grava `resposta = 'outra_coisa'` com texto ou foto obrigatório (as regras do diário: 2000 caracteres, foto JPEG/PNG/HEIC até 10 MB); a foto pode levar qualquer das duas respostas ou nenhuma. `refeicao` = item de `REFEICOES_DO_DIARIO` igual ao nome da refeição do plano (sem acento e sem caixa) ou "Outro"; `refeicao_do_plano` = "{nome} · {HH:MM}". Conta no limite de 10 registros/dia. **Uma resposta por refeição do plano por dia:** com o paciente travado (`conferirLimite`), se já houver registro com `resposta` não nula e o mesmo `refeicao_do_plano` no dia, devolve esse registro (idempotente). A chave é o texto "{nome} · {HH:MM}": duas refeições com o mesmo nome e o mesmo horário no mesmo plano contam como uma (não há unique em `meals (nome, horario)`; aceito — para o paciente é a mesma refeição). A refeição tem de ser do plano publicado do paciente da sessão (lida pela RLS) |
| RN-198 | **Desfazer (G-D5 ★).** Se aprovada a (c): o "Comi assim" fica 10 s no aparelho com "Desfazer" antes de ir ao servidor; o prazo pausa enquanto o foco ou o toque está no aviso (WCAG 2.2.1); fechar a tela nesse prazo **envia** (o paciente já disse que comeu). Sem DELETE no banco (a sessão de paciente continua sem apagar diário, P06 D11) |
| RN-199 | **Itens de outras fontes** seguem a tabela da §4.3: exame (envio de hoje e mudanças em 7 dias, textos de `SITUACAO`), consulta (ativa nos próximos 7 dias; "Confirmar presença" com as mesmas regras da tela da consulta), plano novo (7 dias), conteúdo novo (não visto, 7 dias, até 3), documento novo (só com `documentosLiberados`). O mural nunca mostra item que a tela de origem esconderia |
| RN-200 | **Leitura e trilha.** `muralDoPaciente` lê tudo numa transação e chama `auditRead` **uma vez por entidade com dado de saúde lida** (plano, diário, exames enviados), com a conta do paciente como ator (P06 D22); agenda, conteúdos e contagem de documentos sem `auditRead` (P05 D10, P07 D6, 10A D17). Sem dado de saúde em log (RNF-196) |
| RN-201 | **Cartões do aparelho.** "Ative as notificações…" só sem inscrição de push neste aparelho; "Instale o app…" só fora do modo instalado e onde o navegador permite (regras de `instalacao.ts`). "Agora não" esconde por 30 dias neste aparelho (`localStorage`, chave por conta; apagado no "Sair", no login e na troca de dono, como a lista de compras) |
| RN-202 | **Mini-jornada (Hoje).** Com ≥ 2 pesos permitidos e o peso visível: "{±x,x} kg desde {mês da 1ª avaliação}" (vírgula decimal, sinal "−" ou "+", "Sem mudança de peso desde {mês}" se 0,0); senão, "{n} consulta(s) desde {mês}"; sem atendimento: "Sua jornada começa na primeira consulta." Segunda linha: "Próximo marco: consulta {quando}" ou "Nenhuma consulta marcada." O gráfico pequeno é decorativo (`aria-hidden`); o link **não** tem `aria-label`: o nome acessível é o texto visível, completado por `sr-only` ("Sua jornada:" antes e o último peso depois, nunca com a RN-203) — WCAG 2.5.3 |
| RN-203 | **"Não mostrar peso no app" (G-D1, G-D6 ★).** `patients.peso_oculto_no_app_em` não nulo ⇒ o portal não mostra **peso nem IMC** (recomendação da G-D6) em nenhum lugar: faixa, Jornada, "Todas as medidas", gráficos, diferenças. A filtragem é feita no servidor, nos módulos `evolucaoParaPaciente` e `jornadaDoPaciente`, antes de montar a resposta; nenhum componente recebe o valor para esconder |
| RN-204 | **O que a opção não muda.** Prontuário, painel e exportações (inclusive a do titular, `escopo = 'titular'`: direito de acesso, LGPD art. 18, II); documentos assinados; textos livres da nutricionista (orientações, comentários, observações do plano) — ela é avisada no texto de ajuda. A opção não apaga nem altera dado |
| RN-205 | **Quem liga.** Só a equipe (sessão de nutricionista do tenant, `withTenant`), na aba Evolução do prontuário; paciente bloqueado ou anonimizado: somente leitura. O paciente não vê a opção; a sessão de paciente não muda a coluna (gatilho `paciente_colunas`, 0085: a coluna fica fora de `livres`). A troca é auditada pelo gatilho de `patients` ("alterar") **e** por uma linha própria gravada na mesma transação (`recordAudit`, entidade `peso_no_app`, `criar` = ligou, `excluir` = desligou), que o "Histórico de acessos" mostra como "Ligou/Desligou — Peso oculto no app" |
| RN-206 | **Linguagem neutra sobre corpo.** Nenhuma tela do portal julga a variação de medida: sem verde/vermelho de "bom/ruim", sem seta de sucesso, sem "parabéns", sem meta ou peso ideal, sem comparação com outros. A diferença é número com sinal |
| RN-207 | **Cor do consultório.** Faixa e cabeçalhos com `corDaFaixa(cor do consultório)`, texto branco, nos dois modos; nenhum texto em verde claro sobre a faixa; marcos âmbar com contorno de 2 px (`--nd-p-texto`) sobre fundo claro; foco visível de 3 px (`outline`) com anel branco de 2 px em volta, nos dois modos (como no desenho) — **o Plano 16 entrega o foco de 3 px global (≥ 3:1, testado) sem o anel duplo** (Desvio 15 do plano; o anel fica no backlog) |
| RN-208 | **Offline.** Só `/p/plano` fica no aparelho (sem mudança no service worker). A página do plano contém as refeições abertas; sem rede, toda navegação em `/p/` mostra essa cópia com o selo; botões que gravam ficam desabilitados com "Sem conexão. Registre quando voltar." |
| RN-209 | **Push e e-mail sem mudança.** Mesmos tipos, textos e telas (`AVISOS_DO_PORTAL`); nenhum push novo (C-192) **Emenda do Plano 15 (15/10/2026; spec C §7.8, D34):** um tipo novo de push, `duvida_vista` (neutro, "Há uma atualização para você no app.", tela `/p/plano/ia`), quando a nutricionista marca a dúvida como vista; os demais continuam iguais. |
| RN-210 | **Vários vínculos.** Tudo é do vínculo escolhido (cookie `nd_vinculo`): mural, jornada, plano, exames. A faixa diz o consultório; "Trocar de nutricionista" fica em Eu. O tour e os cartões dispensados são da **conta** |
| RN-211 | **Sair** fica no fim de Eu nas páginas do portal e no topo de `/p/escolher`, `/p/sem-acesso` e `/p/termo`; o comportamento (`/sair` com `Clear-Site-Data`, `esquecerPlanoGuardado`) não muda |
| RN-212 | **Manual guiado do portal.** Guia novo `portal-novidades` (v1, 5 passos) com o mesmo modelo do painel (`id`, `versao`, `padrao`, `ajuda`, `passos`; `<dialog>` modal nativo; "{i} de {n}"; não executa ações); progresso em `user.guia` da **conta do paciente** por `marcarGuia` com o `userId` vindo de `requirePaciente` (nunca do formulário); só o aviso "O app mudou…" abre sozinho, uma vez; `/p/ajuda` funciona sem JavaScript. Texto em rascunho até a revisão (G-D10) |
| RN-213 | **Refeição aberta.** Mostra o que `planoDoPaciente` já devolve: itens principais com quantidade, substituições como "ou {nome}, {quantidade}", observação, receita sugerida; kcal só com `mostrarCalorias` ("Cerca de {total da refeição} kcal"). Refeição fora do plano publicado do paciente → 404 |
| RN-214 | **Transparência sem estigma.** Em Eu › Privacidade, texto fixo: "Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados)." (a v0.1 dizia "Todas estão na cópia", o que promete demais: notas privadas, o rascunho do plano e o motivo de cancelamento escrito pela nutricionista não saem — `exportacao-job.ts`; texto com a Debby, G-D10 ★, e no pacote do advogado, E-09). Nenhuma tela diz ao paciente, individualmente, que o peso está oculto — nem a ajuda "Como usar o app" e o tour, que não falam de peso |
| RN-215 | **Recebimento de exames desligado.** A barra de ações não tem "Enviar exame"; o mural ainda mostra mudanças de situação de envios antigos (US-161 continua) |
| RN-216 | **Textos de interface** em pt-BR; os textos novos desta spec ficam numa constante (`MSG_MURAL`, `MSG_JORNADA`, `MSG_G`) e entram na tabela "Textos de interface" das histórias do MVP no fechamento |
| RN-217 | **Datas e horas** gravadas em UTC e exibidas no fuso do tenant, com a sigla quando o aparelho estiver noutro fuso (RN-06); datas por extenso curtas ("Quinta, 8 out", "22 de setembro") e `dd/mm/aaaa` nos dados tabulares (RNF-12) |
| RN-218 | **Nome do paciente.** A saudação usa o primeiro nome de `patients.nome` (até o primeiro espaço); paciente anonimizado não chega ao portal (sem vínculo ativo) |
| RN-219 | **Ordem de entrega.** O layout novo entra para **todos os pacientes** no deploy do Plano 16 (G-D11 ★), com o tour "O app mudou" |

---

## 7. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-190 | Desempenho | Hoje e Jornada: página com p95 ≤ 800 ms (meta das páginas, RNF-01 v1.11) e LCP ≤ 2,5 s em "Slow 4G"; `muralDoPaciente` e `jornadaDoPaciente` em **uma** transação cada, sem N+1, só com índices existentes (`diary_entries_paciente_idx`, `exam_submissions_paciente_idx`, `consultations_paciente_data_idx`, `anthropometry_paciente_data_idx`, índice de `appointments`). A pilha de carga (P08-03) ganha o cenário "abrir Hoje" |
| RNF-191 | Acessibilidade | WCAG 2.1 AA em todas as telas do portal: axe com zero violação a 360 e 320 px, claro e escuro; sem rolagem horizontal a 320 px (1.4.10); alvos ≥ 44 px; marcos de região (`header`, `nav "Seções"`, `main`, `nav "Ações"`); mural como lista (`ol`) com autor e hora no texto de cada item (não só no estilo do balão); resultado das respostas em `role="status"` sempre montado (molde de `privacidade.tsx`); foco vai para o título da tela de detalhe ao abrir; gráfico com alternativa em texto; zoom de texto de 200% sem perda; nenhuma informação só por cor (o autor de cada balão dito em texto **visível** — "Você", "Aviso do app", "Sua nutricionista comentou seu registro (…)" — §4.3) |
| RNF-192 | Contraste | Teste unitário que confere, com `contraste()`, todos os pares de token da §4.7 nos dois modos (texto ≥ 4,5:1; componentes e marcos ≥ 3:1) e o teste de propriedade de `corDaFaixa` sobre a faixa de cores aceitas pelo `perfilSchema` |
| RNF-193 | Fontes | Red Hat Display (700/800/900) e Atkinson Hyperlegible Next (400/700) por `next/font` (servidas pelo app, CSP `font-src 'self'`, sem chamada ao Google — LGPD), subconjunto `latin`, `display: swap`; orçamento ≤ 160 KB de `woff2` no primeiro carregamento do portal; carregadas só no layout de `/p` |
| RNF-194 | Modo escuro | Segue o aparelho (`data-tema="sistema"`, P08 D18); `themeColor` claro `#1d6b5a` e escuro `#0f1613` sem mudança |
| RNF-195 | Compatibilidade | Chrome Android 10+ e Safari iOS 16.4+ (RNF-09); `<details>`/`<dialog>` nativos; câmera por `<input type="file" accept="image/*" capture="environment">` (sem `getUserMedia`) |
| RNF-196 | Privacidade em log | Nada do mural, da jornada ou das respostas em log/Sentry: nem texto do diário, nem nome de refeição, nem medida (RNF-11); erros logam só o tipo de item e o motivo |
| RNF-197 | Testes | (a) unitários de `comporMural` (janela, ordem, horário, saudação, autoria, botões, idempotência), de `corDaFaixa` e dos tokens; (b) integração com Testcontainers: resposta grava no diário com RLS, paciente não responde a refeição alheia, limite/idempotência com duas conexões, gatilho recusa a coluna de peso pela sessão de paciente, CS-194 (procura os valores de peso e IMC no HTML e no payload RSC de Hoje, Jornada e "Todas as medidas"); (c) E2E "nada some": a partir de `/p/inicio`, cada linha da §4.10 é alcançada no número de toques da tabela (≤ 2; 3 só nas linhas marcadas, G-D14 ★), as telas de detalhe têm o "Voltar para {seção}" certo e "Conectado como" mostra o e-mail; (d) E2E de acessibilidade das telas novas; (e) `sw-regras.test.ts` continua passando sem mudança |
| RNF-198 | Movimento | `prefers-reduced-motion`: sem animação na sanfona, no tour e no "Registrado no diário." |
| RNF-199 | Manutenção | Os componentes do portal ficam em `src/app/p/` e `src/components/portal/` (novos); nenhum componente do painel muda de visual por causa do portal (C-193) |

---

## 8. Integrações

Nenhuma integração nova. Push (INT-03), e-mail (INT-02) e WhatsApp (INT-01) seguem iguais (RN-209). As URLs de toque
do push (`/p/diario`, `/p/plano`, `/p/conteudos`, `/p/documentos`, `/p/exames`, link da consulta) continuam existindo e
marcam a seção certa (RN-191).

---

## 9. Modelo de dados

**Nenhuma tabela nova** (C-191). Duas mudanças em tabelas existentes, numa migration a partir da próxima livre depois
do Plano 13 (C-196), rodada com `DATABASE_URL_MIGRATOR` (CLAUDE.md, regra 7):

| Tabela | Mudança | Regras |
|---|---|---|
| `diary_entries` | `resposta text null` | CHECK `diary_entries_resposta_valida`: `resposta is null or resposta in ('como_no_plano', 'outra_coisa')` |
| `diary_entries` | `refeicao_do_plano text null` | CHECK `char_length between 1 and 80`; obrigatório quando `resposta` não é nulo (`(resposta is null) = (refeicao_do_plano is null)`) |
| `diary_entries` | CHECK `diary_entries_tem_conteudo` refeito | `texto is not null or foto_status <> 'sem_foto' or resposta is not distinct from 'como_no_plano'` (não `=`: com `resposta` nula, `resposta = 'como_no_plano'` dá `null`, e um CHECK com `null` passa — aceitaria registro vazio; acertado no fechamento do Plano 16, como está na migration `0106`); e `resposta = 'outra_coisa'` exige texto ou foto (`resposta is distinct from 'outra_coisa' or texto is not null or foto_status <> 'sem_foto'`) |
| `patients` | `peso_oculto_no_app_em timestamptz null` | Sem CHECK. Fica **fora** de `livres` no gatilho `paciente_colunas` (sem mudar a função: ela já recusa toda coluna fora da lista; o plano acrescenta o teste) |

- **RLS:** nada novo — as duas tabelas já têm `tenant_isolation`, `patient_isolation` e as políticas da sessão de
  paciente. `paciente_diario_insert` (0080) continua valendo (as colunas novas não apontam para arquivo; a CHECK cobre os
  valores). O teste de isolamento (`test/isolamento.test.ts`) não ganha fábrica nova (tabelas já cobertas); a fábrica
  de `diary_entries` passa a preencher as colunas novas num dos casos.
- **Auditoria:** as duas tabelas já têm `audit_row_change` (entidades `diario` e `patients`); a migration só adiciona
  colunas, sem dados (nenhum `DISABLE TRIGGER`).
- **Índices:** nenhum novo; a idempotência da RN-197 roda com o paciente travado e o índice `diary_entries_paciente_idx`
  (tenant, paciente, data/hora). Se a medição do plano pedir, índice parcial `(tenant_id, patient_id, data_hora) where
  resposta is not null`.
- **Drizzle:** colunas em `src/db/schema/portal.ts` e `src/db/schema/pacientes.ts`; `pnpm db:generate` gera a migration.
- **Sem estado de mural no banco.** Cartões dispensados ficam no `localStorage` (RN-201); o progresso do tour, em
  `user.guia` (RN-212).

---

## 10. LGPD

| Tema | Tratamento |
|---|---|
| Finalidade e base legal | O mural e a Jornada só **reorganizam a exibição** de dados que o paciente já vê hoje no app (plano, diário, comentários, evolução, orientações, agenda, exames enviados, documentos), para a mesma finalidade (acompanhamento nutricional; tutela da saúde, LGPD art. 11, II, "f", e o termo aceito). Nenhum dado novo é coletado além das respostas "Comi assim/Comi outra coisa", que são registro do diário (mesma finalidade e mesmo tratamento do US-042) |
| Minimização | O mural não guarda cópia de nada; a resposta guarda só o rótulo e o nome/horário da refeição. Nada novo vai para o aparelho além do que as telas atuais já mostram; a cópia offline continua só o plano — a página `/p/plano` não leva a marca "No diário" das refeições respondidas (a marca fica no mural e na refeição aberta, que não são guardadas) |
| Transparência | RN-214 em Privacidade; o termo do paciente não precisa de versão nova (nenhuma finalidade ou categoria nova) — **a confirmar com o advogado (E-09)** junto do pacote P12-23/P09-00 |
| "Não mostrar peso no app" | É **apresentação**, não restrição de acesso: o titular continua com acesso integral pela exportação (art. 18, II) e pelo pedido à nutricionista. Escolha clínica da profissional, registrada com autor e data numa linha própria da trilha (`peso_no_app`, "Ligou"/"Desligou", RN-205) — o gatilho de `patients` sozinho não diz a coluna e a coluna volta a nulo ao desligar. Risco R-193 |
| Direitos do titular | Exportação (`dados.json`) ganha `resposta` e `refeicaoDoPlano` em cada registro do diário (escopos `titular` e `equipe`); pedido de exclusão e anonimização tratam `refeicao_do_plano` como o `texto` do diário (mesma rotina de `lgpd.ts`); `peso_oculto_no_app_em` vai na exportação **dos dois escopos** como "preferência de exibição no app definida pela nutricionista" (revisto na revisão do plano: é dado pessoal do titular, art. 5º, I — provavelmente referente à saúde, art. 5º, II —, e o acesso do art. 18, II e a "declaração clara e completa" do art. 19, II não se limitam ao que ele forneceu; as notas privadas, citadas na v0.1 como precedente, não saem em **nenhum** escopo). A exclusão da cópia do titular só com o parecer do advogado (E-09, pacote P12-23/P09-00) e decisão do dono (D6 ★ do plano), com a base no LEIA-ME da exportação. A resposta vai também com o rótulo que o paciente viu ("Comi assim"/"Comi outra coisa", art. 19, II) |
| Tela de bloqueio | Nenhum push novo; o mural só aparece dentro do app autenticado |
| Aparelho compartilhado | "Sair" continua limpando tudo; cartões dispensados e tour não guardam dado de saúde |

---

## 11. Boas práticas SBIS NGS1

O NutriDebby mira a certificação SBIS (PEP, NGS1). O layout novo não cria registro clínico novo, mas mexe na
**exibição** e na **entrada** de dados do paciente; as práticas abaixo valem sem escopo extra:

1. **Origem e autoria visíveis** (ECF.17.01, como no selo "Enviado pelo paciente" do Plano 12): todo item do mural diz
   de quem é, **em texto visível** (não só pelo lado ou pela cor do balão) — "Você", "Sua nutricionista comentou seu registro
   (…)" ou "Aviso do app" — com data e hora; nada escrito pelo sistema aparece
   como se fosse da profissional (RN-194).
2. **Registro íntegro e contextualizado:** a resposta grava a refeição do plano como cópia (`refeicao_do_plano`), que
   não muda quando o plano é republicado; o paciente não edita nem apaga (P06 D11); a idempotência impede registro
   duplicado por toque duplo (RN-197).
3. **Controle de acesso** (NGS1.03): a refeição é lida pela RLS do paciente (só refeição do próprio plano publicado) e a
   escrita só no próprio diário (`paciente_diario_insert`); o vínculo da resposta com o plano e a hora do registro são do
   servidor (módulo `registrarNoDiario`), não do banco — a política 0080 não restringe `resposta`, `refeicao_do_plano` nem
   `data_hora` (um gatilho que fixe `data_hora = now()` para o papel paciente fica no backlog); a opção de peso só pela
   equipe, com o gatilho `paciente_colunas` barrando a sessão de paciente.
4. **Trilha** (NGS1.07): leituras pelo paciente com `auditRead` (RN-200); escritas pelo gatilho `audit_row_change`
   (respostas e a troca da opção de peso, com o ator) e, para a opção de peso, a linha própria `peso_no_app`
   ("Ligou"/"Desligou", RN-205), que diz o que foi decidido — o gatilho não guarda "antes/depois" de colunas; nenhuma
   migration desliga o gatilho (NGS1.07.01).
5. **Datas consistentes** (ECF.17.05): hora do registro dada pelo servidor (`agora`), nunca pelo aparelho; exibição no
   fuso do tenant com a sigla quando o aparelho difere (RN-217).
6. **Sessão e saída:** "Sair" sempre a um toque a partir de Eu, limpando o aparelho; sessão do paciente sem mudança
   (RNF-06).
7. **Disponibilidade sem vazamento:** offline só o plano (sem diário, medidas ou exames no aparelho).
8. **Acessibilidade e legibilidade** como requisito de segurança do paciente (fontes de alta legibilidade, contraste
   garantido por teste, linguagem simples).

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-190 | O paciente toma o mural por chat e espera resposta da nutricionista | Sem caixa de texto; rodapé fixo (RN-193: os registros são visíveis para ela, sem prazo de resposta); autor visível em todo item e o comentário dela com estilo próprio (RN-194); itens do sistema em voz impessoal; texto revisado pela Debby (G-D10) |
| R-191 | Lembrete automático lido como orientação profissional (CFN) | RN-194; nada de conselho montado pelo sistema; só texto dela leva a voz dela |
| R-192 | "Comi assim" por engano vira registro permanente | G-D5 (desfazer); idempotência; o paciente pode escrever outro registro explicando |
| R-193 | Paciente com o peso oculto descobre o número na exportação ou num documento e se sente enganado | Texto genérico em Privacidade (RN-214); ajuda da opção avisa a nutricionista do que não muda (RN-204); decisão clínica dela |
| R-194 | Cor de consultório próxima do limite fica escura demais na faixa | `corDaFaixa` escurece o mínimo necessário; G-D7 |
| R-195 | 5 seções não cabem a 320 px com texto em 200% | Grade de colunas iguais com quebra hifenizada (molde atual); E2E a 320 px (CS-193) |
| R-196 | Mural mais lento que o Início (6 fontes) | Uma transação, índices existentes, limite de 40 itens, cenário na pilha de carga (RNF-190) |
| R-197 | Aumento de linhas de `audit_log` (3 "Visualizou" por abertura de Hoje) | Uma linha por entidade por abertura (RN-200); medir no plano; se pesar, agrupar por dia como `access_events` (PM-G11) |
| R-198 | Fonte Atkinson Hyperlegible Next ausente do `next/font/google` | `next/font/local` com os arquivos OFL (DEP-G8) |
| R-199 | Conflito com o Plano 13 em arquivos do portal (documentos/parecer) e na numeração das migrations | Plano 16 começa depois do merge do Plano 13 (G-D2); renumerar as migrations no início do plano (C-196) |

---

## 13. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-G1 | Conferir a §1.3 contra a `main` depois do merge do Plano 13 (parecer no portal? rotas novas em `/p/`?) e renumerar as migrations |
| PM-G2 | DEP-G8: catálogo do `next/font/google` na versão do repositório; plano B `next/font/local` |
| PM-G3 | `corDaFaixa` em `src/lib/tema/marca-tema.ts`, com teste de propriedade; valores escuros dos tokens conferidos por teste (§4.7) |
| PM-G4 | `navegacao.ts`: 5 itens, `tambem` da §4.1, seção "Exames" condicional (RN-192) — o `ITENS_DO_PORTAL` vira função do contexto (recebimento ligado/envios), ou a nav recebe a lista do layout |
| PM-G5 | `src/modules/portal/mural.ts` (`muralDoPaciente` + `comporMural` puro) e `jornada.ts`; reuso das funções de leitura atuais dentro de uma transação (talvez versões `…NaTransacao(tx, …)` de `planoDoPaciente`, `diarioDoPaciente`, `meusEnvios`, como `lerPlanoNaTransacao`) |
| PM-G6 | `registrarNoDiario` ganha `resposta` e `refeicaoDoPlano`; action `responderRefeicao`; rota `POST /api/p/diario` aceita os campos novos (multipart da foto) |
| PM-G7 | `/p/plano` em sanfona com as refeições abertas dentro da página (cópia offline) e `/p/plano/refeicao/[id]` |
| PM-G8 | Painel: caixa na aba Evolução (+ action com `requireNutri`, `withTenant`) e rótulos das respostas no feed do diário |
| PM-G9 | Exportação: `resposta` e `refeicaoDoPlano` no `dados.json` (titular e equipe); anonimização de `refeicao_do_plano` |
| PM-G10 | Manual guiado do portal: `GUIAS` ganha o guia `portal-novidades` (ou um arquivo próprio do portal), `marcarGuia` chamado com `userId` de `requirePaciente`; **CLAUDE.md, regra 1:** `preferencias.ts` passa a ser usado também pela sessão de paciente (progresso do manual da própria conta) — atualizar o texto da exceção da tabela `user` |
| PM-G11 | Medir o volume de `audit_log` com o mural na pilha de carga; decidir se agrupa |
| PM-G12 | E2E "nada some" a partir da tabela da §4.10 (lista de destinos como dado do teste) |
| PM-G13 | Manual técnico (cap. 05, §5.5 e §5.7; cap. 11, "onde fica no portal") e manual do usuário (Docs) atualizados no fechamento; tabela "Textos de interface" do E5 |
| PM-G14 | Agentes especialistas nas revisões: `revisor-interface` (visual, textos, tour, acessibilidade), `revisor-rls` (colunas, gatilho, RLS da resposta), `normas-cfn-lgpd` (autoria, peso oculto, exportação), `guardiao-manual` |

---

## 14. Decisões do dono

### Decisões do dono de 08/10/2026 ("concordo, pode seguir")

| ID | Decisão | Efeito no texto |
|---|---|---|
| G-D1 | **Opção por paciente "Não mostrar peso no app"**, ligada pela nutricionista; o paciente não vê a opção | §4.6, RN-203 a RN-206, US-195, §9 |
| G-D2 | **Implementar logo depois do Plano 13, antes do Plano 14** | Cabeçalho, C-196, R-199 |
| G-D3 | **O painel da nutricionista fica como está** | C-193, §4.9 (só o mínimo indispensável) |
| G-D4 | **Layout G verde aprovado** (GV-Hoje, GV-Jornada, GV-Almoço) com as cores e fontes padrão | §4, US-190 a US-199 |

### Pendências ★

| ID | Pergunta | Opções | Recomendação |
|---|---|---|---|
| G-D5 ★ | "Comi assim" grava no primeiro toque? (R-192) | (a) grava na hora, sem desfazer (como o diário hoje); (b) toque abre confirmação ("Registrar 'Comi assim' no almoço?"); (c) aviso com **"Desfazer" por 10 s** antes de enviar (prazo pausa com foco; fechar a tela envia) | **(c)**: mantém o toque único do desenho e corrige o engano sem dar ao paciente DELETE no banco |
| G-D6 ★ | O que "Não mostrar peso no app" esconde? | (a) **peso e IMC** (o IMC revela o peso); (b) (a) + % de gordura; (c) todas as medidas corporais (só sobram consultas e orientações) | **(a)**: é o que o nome diz; (c) a nutricionista pode querer depois — vira opção nova, não esta |
| G-D7 ★ | Cor do consultório na faixa quando o contraste fica curto (§4.7) | (a) **escurecer automaticamente só na faixa**, o mínimo necessário; (b) usar sempre a cor padrão na faixa e a do consultório só nos detalhes; (c) recusar na Configuração cores que não passem na faixa | **(a)**: a marca continua reconhecível e nenhuma nutricionista precisa trocar a cor já salva |
| G-D8 ★ | Onde ficam os **Conteúdos** (biblioteca) | (a) **dentro de Plano** ("Conteúdos" ao lado de "Lista de compras") + item "Novo conteúdo" no mural; (b) em Eu; (c) sexta seção | **(a)**: receitas e orientações completam o plano; (c) quebra a regra de não rolar a 320 px |
| G-D9 ★ | Seção "Exames" com o recebimento desligado e sem envio | (a) **some** (4 seções); (b) aparece com "Seu consultório ainda não recebe exames pelo app." | **(a)**: não mostra porta fechada |
| G-D10 ★ | Textos novos (mural, rodapé, ajuda da opção de peso, Privacidade, tour) | (a) **Debby revisa antes do deploy** (como o P08-08); (b) usar os propostos | **(a)** |
| G-D11 ★ | Como o layout entra | (a) **para todos no deploy**, com o tour "O app mudou"; (b) interruptor por consultório durante uma transição | **(a)**: poucos pacientes no piloto e o painel não muda; (b) duplica telas e testes |
| G-D12 ★ | Meta do CS-191 (≥ 50% dos pacientes com plano registram ≥ 3 respostas/semana) | (a) **aceitar**; (b) outra meta | **(a)**, revista depois de 4 semanas |

### Pendências ★ novas da revisão do plano (08/10/2026)

| ID | Pergunta | Opções | Recomendação |
|---|---|---|---|
| G-D13 ★ | Nas telas de detalhe (diário, Minhas consultas, Todas as medidas, conteúdos, lista de compras, documentos) não há a nav "Seções": a US-190 pedia "a seção marcada" | (a) **aceitar** que o "Voltar para {seção}" do cabeçalho diga a seção (Desvio 14 do plano); (b) as telas de detalhe ganham a nav "Seções" compacta | **(a)**: tela de detalhe limpa, como o desenho; (b) vai para o backlog se a Debby sentir falta |
| G-D14 ★ | Três linhas da §4.10 passam de 2 toques (consulta que não é a próxima, receita de refeição que não é a próxima, conteúdo que não é novo) | (a) **aceitar 3 toques** nessas linhas (§4.10 e CS-190 acertadas); (b) atalhos: "Ver a consulta" em cada consulta futura na Jornada e a receita fora da sanfona | **(a)**: as três têm o caminho curto para o caso comum (a próxima consulta, a próxima refeição, o conteúdo novo no mural) |
| G-D15 ★ | CS-191: como contar e quem pode ser medido | Definição: (a) **≥ 3 em cada uma das 4 semanas**; (b) média ≥ 3/semana. Medida: (a) **só no consultório da Debby**, com o pedido dela registrado como instrução da controladora, até o DPA definitivo (E-09) ter a cláusula de estatística agregada; (b) trocar por métrica sem tabela de saúde (abertura de Hoje em `access_events`) | Definição **(a)**; medida **(a)**, pela função agregada do P16-17 |
| G-D16 ★ | Com o peso oculto, o gráfico principal da Jornada vira "Cintura nas consultas" (§4.5) — a medida corporal toma o destaque do peso justamente para quem a nutricionista quis proteger | (a) **sem gráfico de medida corporal em destaque** com o peso oculto (a cintura continua nas consultas e em "Todas as medidas"); (b) manter a troca | Decisão do dono com a Debby (boa prática, não norma); o plano mantém (b) até a resposta (troca de uma condição em `montarJornada`) |
| G-D17 ★ | Quem entra pela primeira vez depois do deploy também vê "O app mudou. Quer ver onde ficou cada coisa?" (a US-199 é para quem já usava) | (a) **texto de boas-vindas** para quem não tem `access_events` anteriores ao deploy; (b) o mesmo aviso com outra pergunta; (c) manter | **(a)**, com o texto da Debby (G-D10) |

Além dessas, a revisão do plano mudou textos que já estavam na G-D10 ★ (rodapé do mural, Privacidade, autor visível,
comentário com o registro, mural vazio com plano) e reabriu a **D6 ★ do plano** (a opção de peso na exportação do titular:
nos dois escopos até o parecer do advogado, E-09).

> As pendências ★ que sobram para o dono são **G-D5 a G-D17** e a D6 do plano. Nenhuma bloqueia a
> escrita do plano: o plano parte das recomendações e marca os pontos que mudam se a resposta for outra.

### Respostas do dono de 08/10/2026 (G-D5 a G-D17)

O dono aprovou o desenho G verde e o Plano 16 com **todas as recomendações** ("Aprovo todas (Recomendado)"):

| ID | Resposta | Onde está no código |
|---|---|---|
| G-D5 | (c) "Desfazer" por 10 s no aparelho; fechar a tela envia | `PRAZO_DESFAZER_MS`, `ComiAssim` |
| G-D6 | (a) peso e IMC | `SERIES_DO_PESO` (`peso-oculto.ts`) |
| G-D7 | (a) escurecer só a cor da faixa, o mínimo necessário | `corDaFaixa` (`marca-tema.ts`) |
| G-D8 | (a) Conteúdos dentro de Plano + item no mural | `SECOES_DO_PORTAL` (`tambem` de Plano) |
| G-D9 | (a) Exames some sem recebimento e sem envio | `secoesDoPortal`, `temEnvioVisivel` |
| G-D10 | (a) a Debby revisa os textos antes do deploy | runbook `docs/operacao/app-paciente.md`, passo 2 |
| G-D11 | (a) para todos no deploy, com o tour | `GuiaDoPortal`, `AVISO_PORTAL` |
| G-D12 | (a) meta aceita, revista depois de 4 semanas | runbook, passo 6 |
| G-D13 | (a) a seção das telas de detalhe dita pelo "Voltar para {seção}" | `CabecalhoDetalhe` |
| G-D14 | (a) três linhas da §4.10 com 3 toques | `e2e/nada-some.spec.ts` |
| G-D15 | (a) ≥ 3 em cada uma das 4 semanas; medir só no consultório da Debby, com o pedido registrado, até o DPA definitivo | função agregada no backlog (P16-18), runbook passo 6 |
| G-D16 | (a) com o peso oculto, nenhum gráfico de medida corporal em destaque | `montarJornada` (`jornada-regras.ts`) |
| G-D17 | (a) boas-vindas para quem entra pela primeira vez | `AVISO_PORTAL.boasVindas`, `jaUsavaOApp` |

A **D6 ★ do plano** continua com o advogado (E-09): a opção de peso vai na exportação dos dois escopos até o parecer.

---

## 15. Referências

- Desenho aprovado: `.superpowers/sdd/2026-10-08-plano16-preparacao/desenho/` (GV-Hoje, GV-Jornada, GV-Almoco; D-Assuntos, F-Medidas, F-Plano).
- Código do portal: `src/app/p/**`, `src/modules/portal/**`, `src/app/sw-regras.ts`, `src/app/manifest.ts`, `src/modules/notificacoes/mensagens.ts`, `src/modules/plataforma/marca.ts`, `src/app/globals.css`, `drizzle/0080_paciente_restricoes.sql`, `drizzle/0085_paciente_colunas.sql`.
- Manual técnico: cap. 05 (§5.5 portal, §5.7 interface, §5.8 manual guiado) e cap. 11 (exames enviados).
- WCAG 2.1 (W3C, 2018): 1.3.1, 1.4.1, 1.4.3, 1.4.10, 1.4.11, 1.4.12, 2.2.1, 2.4.3, 2.4.7, 2.5.3, 4.1.3.
- LGPD (Lei nº 13.709/2018): arts. 6º (finalidade, necessidade, transparência), 11, II, "f", e 18, II.
- Res. CFN nº 599/2018 (Código de Ética), arts. 16 e 19: https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html (conferido em 08/10/2026); nº 760/2023 (telenutrição) — via spec C, §5.1; nº 856/2026, art. 37, só em fonte secundária (a conferir no DOU).
- LGPD, arts. 5º, I e II; 6º, VI; 9º; 18, II; 19, II; 39 — publicação original em https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-publicacaooriginal-156212-pl.html (conferida em 08/10/2026).
- SBIS — Manual de Certificação para S-RES, nível NGS1 (requisitos citados como nas specs anteriores: NGS1.03, NGS1.07, ECF.17.01, ECF.17.05).

---

## 16. Correções da revisão do plano (08/10/2026)

A revisão do Plano 16 (lentes de cobertura, dados e normas) acertou esta spec sem mudar a versão do desenho. Em resumo:
"Voltar" é link fixo para o destino e a seção das telas de detalhe é dita por ele (§4.2, US-190, G-D13 ★); a §4.10, o
CS-190 e a RNF-197(c) aceitam 3 toques em três linhas (G-D14 ★); o rodapé do mural diz que o diário é visto pela
nutricionista (RN-193); todo item do mural tem autor visível e o comentário diz a qual registro se refere (RN-194, §4.3);
o mural vazio com plano publicado não diz que ela não publicou (§4.3, US-191); a mini-jornada não usa `aria-label`
(WCAG 2.5.3, RN-202, US-194); a opção de peso ganha linha própria na trilha (`peso_no_app`, RN-205, US-195, §4.6, §10,
§11.4); a exportação leva a opção nos dois escopos e o rótulo da resposta (§10); o texto de Privacidade não promete "todas"
(RN-214, US-197); a página do Plano não leva "No diário" (§10, US-196); a §11.3 diz o que é do banco e o que é do módulo;
a RN-197 registra a chave "{nome} · {HH:MM}"; a RN-207 registra o foco sem o anel duplo; a C-197 cita a origem conferida;
o CS-191 tem a definição corrigida e a medida por função agregada (G-D15 ★); pendências novas G-D13 a G-D17 ★ (§14).
Lista completa, com uma linha por achado: plano 16, seção "Correções da revisão do plano (08/10/2026)".

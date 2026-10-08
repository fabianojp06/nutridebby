# Plano 16 — App do paciente no layout G verde (G-01, G-02): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Escrito em 08/10/2026** a partir de `main` @ `19fcea5` + `a803091` (spec do app do paciente G v0.1; Planos 01–12 em produção, migrations `0000`–`0103`), com as decisões do dono de 08/10/2026 ("concordo, pode seguir": **G-D1** opção por paciente "Não mostrar peso no app", ligada pela nutricionista; **G-D2** executar **logo depois do Plano 13**, antes do Plano 14; **G-D3** o painel da nutricionista fica como está; **G-D4** layout G verde aprovado) e o relatório da preparação (fora do git: `.superpowers/sdd/2026-10-08-plano16-preparacao/spec.md`). As pendências **G-D5 a G-D12 ★** seguem as recomendações da spec e estão marcadas onde mudam o texto. Nenhuma linha de código de produto foi escrita; nada foi rodado em banco; nenhum banco de produção foi tocado. Os nomes de função, tabela, coluna, rota, componente e helper usados aqui foram conferidos no código da `main` (os que este plano cria estão em "Contratos entre tarefas"). O catálogo do `next/font/google` do `next` 16.3.6 instalado foi conferido em 08/10/2026: **Red Hat Display** (300–900, variável) e **Atkinson Hyperlegible Next** (200–800, variável) estão lá, com o subconjunto `latin` (DEP-G8 resolvida: não precisa de `next/font/local`). O **Plano 13 está em execução noutra worktree** e reserva as migrations **0104–0105**: as deste plano começam em **0106+** e **podem ser renumeradas** no rebase depois do merge do Plano 13 (C-196, PM-G1). Próximo passo: revisão do plano pelo dono e execução depois do merge do Plano 13. **Revisado em 08/10/2026** (lentes de cobertura, dados e normas): 41 achados aplicados no plano e na spec ou levados aos "Pontos menores", e as decisões novas G-D13 a G-D17 ★ e a D6 ★ revista — ver "Correções da revisão do plano (08/10/2026)".

**Goal:** O portal do paciente (`/p`) troca as 7 abas iguais do rodapé pelo layout G verde — faixa do topo na cor do consultório com cinco seções (**Hoje · Jornada · Plano · Exames · Eu**), um **mural "Hoje"** montado pelo sistema a partir do que já existe (refeição que vem aí, diário, comentário da nutricionista, situação do exame, próxima consulta, conteúdo, plano e documento novos), **respostas por botão** ("Comi assim", "Comi outra coisa", foto) gravadas no **diário que já existe**, a **Jornada** (peso por consulta e linha do tempo com a orientação de cada atendimento), a **refeição aberta**, e a opção por paciente **"Não mostrar peso no app"**, que só a equipe liga e que tira peso e IMC de tudo o que chega ao aparelho — sem chat, sem tabela de mensagens, sem push novo, sem mudar URLs e sem mexer no visual do painel.

**Architecture:** Nenhuma tabela nova. Uma migration gerada (**0106+**) acrescenta `diary_entries.resposta` e `diary_entries.refeicao_do_plano` (com os CHECKs da spec §9, `diary_entries_tem_conteudo` refeito) e `patients.peso_oculto_no_app_em` (fora de `livres` no gatilho `paciente_colunas`, 0085: a sessão de paciente não muda a coluna, sem mudar a função). O mural é **leitura**: `comporMural` (função pura, `src/modules/portal/mural-regras.ts`) decide itens, ordem, textos, autoria e botões; `muralDoPaciente` (`src/modules/portal/mural.ts`) lê todas as fontes numa transação `withTenant` com o contexto do paciente (RLS por paciente) e chama `auditRead` uma vez por entidade com dado de saúde (plano, diário, exames enviados). As respostas reaproveitam `registrarNoDiario` e a rota `POST /api/p/diario` (campos novos `refeicaoId` e `resposta`): a refeição é lida do plano **publicado** do paciente pela RLS, a resposta é uma por refeição do plano por dia com o paciente travado, e o limite de 10 registros por dia continua. A Jornada (`src/modules/portal/jornada.ts`) junta atendimentos, avaliações e a próxima consulta numa transação, com as regras puras em `jornada-regras.ts`; o peso oculto é filtrado **no módulo** (`evolucaoParaPaciente`, `jornadaDoPaciente`, `miniJornadaDoPaciente`), nunca no componente. A moldura (`Faixa`, `CabecalhoDetalhe`, `NavSecoes`, `BarraDeAcoes`, em `src/components/portal/`) é de servidor, sem JavaScript para navegar; tokens novos e as fontes (Red Hat Display e Atkinson Hyperlegible Next por `next/font`, subconjunto `latin`) ficam escopados em `[data-app='paciente']`; a cor da faixa é `corDaFaixa(cor do consultório)`, que escurece só o necessário para o texto branco passar de 4,5:1 também sobre o cartão translúcido. O manual guiado do portal (`portal-novidades`, v1) reaproveita o `Tour` do painel e grava o progresso em `user.guia` da conta do paciente. Offline continua só `/p/plano`, que passa a conter as refeições abertas em sanfona.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3.6 (App Router, Server Components, Server Actions, Route Handlers, `next/font/google`) · React 19.2 · PostgreSQL 16 · Drizzle 0.45 · Tailwind 4 · Zod 4 · Vitest + Testcontainers · Playwright + `@axe-core/playwright` (todos já instalados). **Nenhuma dependência nova** (as duas fontes vêm do `next/font/google`, que baixa no build e serve pelo próprio app).

**Spec:** [`../specs/2026-10-08-nutridebby-app-paciente-g-design.md`](../specs/2026-10-08-nutridebby-app-paciente-g-design.md) (**v0.1**: §1.1 CS-190 a CS-194, §1.2 C-190 a C-197, §1.3 DEP-G1 a DEP-G8, §2.1 G-01a a G-01i e G-02, §3, §4.1 a §4.10, US-190 a US-199, RN-190 a RN-219, RNF-190 a RNF-199, §9, §10, §11, §12 R-190 a R-199, §13 PM-G1 a PM-G14, §14 G-D1 a G-D12) e a spec do MVP [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.13: RN-06, RN-07, RN-08, RN-12, RN-17, RNF-06, RNF-09, RNF-10, RNF-11, RNF-12, US-040 a US-046). Desenho aprovado: `.superpowers/sdd/2026-10-08-plano16-preparacao/desenho/` (`GV-Hoje`, `GV-Jornada`, `GV-Almoco`; moldes `D-Assuntos`, `F-Medidas`, `F-Plano`). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (G-01, G-02 → P16-01 a P16-16). Manual técnico: [`../../manual-tecnico/README.md`](../../manual-tecnico/README.md) (caps. 05 e 11).

## Global Constraints

- Tudo dos Planos 01–12 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts`, porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel); `requirePaciente` na **primeira** linha de toda página e Server Action do portal (`requireApiPaciente` nas rotas), `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista (guarda `src/app/painel/acoes-de-paciente.test.ts`); ids de rota conferidos com `idValido` (id inválido = 404, nunca 500); formulários com `action={…}` ou `method="post"` (guarda `src/app/formularios-post.test.ts`); rota de API com método de escrita confere a origem com `mesmaOrigem` **antes** da sessão (guarda `src/app/api/mesma-origem-rotas.test.ts`; este plano não cria rota nova).
- **Base:** `main` depois do merge do **Plano 13** (G-D2). Migration deste plano: **`0106_app_paciente_g`** (gerada, T1) — **"0106+"**: hoje a última em produção é a `0103_sessao_equipe_30min.sql` e o Plano 13 reserva a 0104–0105; se ele entrar com outro número de migrations, **renumerar** no rebase (o `drizzle-kit generate` da T1 roda **depois** do rebase, sobre o `_journal.json` da `main`) e corrigir as referências deste plano e do manual. Migrations só com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7); nunca no banco de dev compartilhado sem combinar; nunca em produção fora do deploy. **Nunca acessar banco de produção** (nem para ler) em nenhuma tarefa.
- **CLAUDE.md regra 1:** toda consulta a `diary_entries`, `patients`, `meal_plans`, `meals`, `exam_submissions`, `appointments`, `consultations`, `anthropometry`, `contents`, `content_views`, `signed_documents` por `withTenant`; o admin não vê nada novo. **Muda o texto da exceção da tabela `user`** (T14): `src/modules/plataforma/preferencias.ts` passa a ser chamado também pela **sessão de paciente** (progresso do manual guiado da própria conta, `userId` vindo de `requirePaciente`, nunca do formulário).
- **Regra 2:** nenhuma tabela nova; nenhuma entrada nova em `PACIENTE_ESCREVE`, `STAFF_ONLY`, `PUBLICO_LIBERADO` ou `CONTEUDO_POR_AUDIENCIA`. `paciente_diario_insert` (0080) continua valendo para as colunas novas (elas não apontam para arquivo; os CHECKs cobrem os valores). O gatilho `paciente_colunas` de `patients` (0085) **não muda**: `peso_oculto_no_app_em` fica fora de `livres` e a sessão de paciente leva 42501 (teste na T1). A fábrica de `diary_entries` de `test/isolamento.test.ts` passa a preencher as colunas novas.
- **Regra 3 / RNF-11 / RNF-196:** nada do mural, da jornada ou das respostas em log, Sentry, push ou e-mail — nem texto do diário, nem nome de refeição, nem medida; erros logam só o tipo de item e o motivo. Nenhum push novo (RN-209).
- **Regra 8 (auditoria):** `diary_entries` e `patients` já têm `audit_row_change` (entidades `diario` e `patients`): as respostas e a troca da opção de peso viram `audit_log` sozinhas; **nenhuma** migration deste plano desliga o gatilho (NGS1.07.01) — a migration só acrescenta colunas, sem dados. A decisão "Não mostrar peso no app" ganha, além do gatilho, uma linha própria por `recordAudit` (entidade `peso_no_app`, T8; Desvio 5). `auditRead` (com a conta do paciente como ator, P06 D22): no mural, **uma vez por entidade** lida com dado de saúde (`plano_alimentar` pelo `lerPlanoNaTransacao`, `diario`, `exames_enviados`); na Jornada, `atendimentos` e `antropometria`; na mini-jornada, `antropometria` só quando o peso é lido. Agenda, conteúdos e contagem de documentos **sem** `auditRead` (P05 D10, P07 D6, 10A D17).
- **Regra 4 / RN-216:** textos de interface em pt-BR, com o **texto exato da spec** quando existir; os textos novos ficam nas constantes `MSG_MURAL` (`mural-regras.ts`), `MSG_JORNADA` (`jornada-regras.ts`), `MSG_G` (`src/components/portal/textos.ts`), `MSG_PESO_OCULTO` (`peso-oculto.ts`) e no guia `portal-novidades`; **todos em rascunho até a Debby revisar (G-D10 ★)** e entram na tabela "Textos de interface" do E5 no fechamento (T16).
- **Painel como está (G-D3, C-193):** nada do visual, dos tokens ou do menu do painel muda. As únicas mudanças no painel são as da spec §4.9: a caixa "Não mostrar peso no app" na aba Evolução do prontuário (T8) e os rótulos das respostas no feed e no registro aberto do diário (T7). O `Tour` muda de pasta (T14) sem mudar de comportamento no painel.
- **Visual do portal (RNF-191 a RNF-199):** tokens só por classe de tema (`bg-fundo`, `bg-cartao`, `text-suave`, `border-borda`, `bg-faixa`, `bg-p-clara`, `bg-p-marco`…), nunca cor da paleta do Tailwind (guarda `src/app/painel/cores.test.ts`, que já varre `src/app/p` e `src/components`); exceções só com motivo na lista `EXCECOES` da guarda. Alvo de toque ≥ 44 px (`min-h-11`); WCAG 2.1 AA (axe zero violação) a **360 e 320 px**, claro e escuro; sem rolagem horizontal a 320 px (1.4.10) com texto em 200%; marcos de região (`header`, `nav "Seções"`, `main`, `nav "Ações"`); mural como lista (`ol`) com autor e hora **no texto** de cada item; resultado das respostas em `role="status"` sempre montado; `prefers-reduced-motion` sem animação; nenhuma informação só por cor; linguagem neutra sobre o corpo (RN-206: sem verde/vermelho de "bom/ruim", sem seta de sucesso, sem "parabéns", sem meta).
- **Imagem Docker e dependências:** orçamento de **265 MB** comprimidos (CI, job `image`, D-R2 do Plano 12); hoje em **260 MB**. **Nada de biblioteca nova sem medir.** As fontes entram por `next/font` (subconjunto `latin`; RNF-193: **≤ 160 KB de `woff2`** no primeiro carregamento do portal, medido na T2) e somam algumas centenas de KB à imagem: a T2 mede o `.next/static/media` e o PR registra o tamanho do job `image`; se passar de 265 MB, **parar e perguntar ao dono** (não apagar outra coisa às cegas).
- **Custo:** nenhum (C-192): sem serviço externo, sem IA, sem push novo; as fontes são servidas pelo próprio app (CSP `font-src 'self'`, sem chamada ao Google em tempo de execução — LGPD).
- **Boas práticas SBIS NGS1 (spec §11):** origem e autoria **visíveis** (texto na tela, não só o lado ou a cor do balão) em todo item do mural ("Você", "Sua nutricionista comentou seu registro (…)", "Aviso do app") com data e hora; nada escrito pelo sistema aparece como da profissional (RN-194, C-197); a resposta grava a refeição do plano como **cópia** (`refeicao_do_plano`), que não muda quando o plano é republicado; o paciente não edita nem apaga (P06 D11); a idempotência impede registro duplicado por toque duplo; hora do registro dada pelo **servidor**; controle de acesso no banco (RLS do paciente para a resposta; gatilho `paciente_colunas` para a opção de peso); trilha de leitura e escrita; offline só o plano.
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos. **Merge = deploy**, só com OK explícito do dono e snapshot no hPanel antes. Subagentes nunca consultam o banco de produção. O `nutri-backup.sh` só roda dentro de `test/backup.test.ts` (regra 10; este plano não o muda).
- Política de revisão por entrega (índice, revista em 02/10/2026; modo misto aprovado pelo dono): revisor por tarefa (cada tarefa diz **Revisão: completa (agente …)** ou **Revisão: leve (revisor-interface)**) → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` com o checklist reforçado (peso oculto que não pode vazar ao aparelho, resposta só à refeição do próprio plano, idempotência e limite com o paciente travado, autoria no mural, `user.guia` pela sessão de paciente). Se sobrar Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11)** segue pendente.

**Revisão completa** = o agente especialista indicado (`.claude/agents/revisor-rls.md` para banco, RLS, auditoria, rotas e leitura do titular; `.claude/agents/normas-cfn-lgpd.md` para a opção de peso, autoria e linguagem do mural, dados do mural e LGPD) com as lentes de segurança/LGPD e de spec, três verificadores adversariais por achado, até duas rodadas de correção. **Revisão leve** = `.claude/agents/revisor-interface.md` (visual V2/G, textos, acessibilidade, manual guiado), uma rodada. O fechamento (T16) passa também pelo `.claude/agents/guardiao-manual.md`. Cada agente guarda o que aprende em `.claude/agent-memory/<nome>/`.

### Decisões do plano

As marcadas com ★ **ainda são do dono** (a spec já trazia a recomendação; o plano a aplica e diz o que muda se a resposta for outra). As outras são técnicas, tomadas aqui com base na spec v0.1 e no código.

| # | Tema | Decisão (aplicada no plano) | Consequência |
|---|---|---|---|
| D1 | Ordem e paralelismo | **[T1 ‖ T2 ‖ T3 ‖ T5] → [T4 ‖ T7 ‖ T8] → [T6 ‖ T9 ‖ T11 ‖ T13] → [T10 ‖ T12 ‖ T15] → T14 → T16** (detalhe em "Dependências") | — |
| D2 | Leitura do mural numa transação (RNF-190, PM-G5) | `muralDoPaciente` lê tudo num `withTenant`: o plano por `lerPlanoNaTransacao` (já existe, já audita), o diário e os envios por consulta direta (com `paraRegistro` e `situacaoParaPaciente`, que já existem), a próxima consulta por `listarConsultasNaTransacao` (já existe), e duas funções novas no molde de `contarDiariosNaoVistosNaTransacao`: `conteudosNovosNaTransacao` (`portal/conteudos.ts`) e `novosNoPortalNaTransacao` (`documentos/portal.ts`, que passa a ser o corpo de `novosNoPortal`). A **mini-jornada** da faixa fica fora do mural (`miniJornadaDoPaciente`, outra transação curta): Hoje = **duas** transações, cada uma com o seu `auditRead` | T6, T9, T10 |
| D3 | Idempotência da resposta (RN-197) | Com o paciente travado: se já há resposta para a mesma `refeicao_do_plano` no dia, **"Comi assim" sem texto nem foto devolve o registro existente** (toque duplo, outra aba). Registro **com conteúdo** (texto ou foto) depois de uma resposta entra como **registro comum do diário** (`resposta` e `refeicao_do_plano` nulos, refeição mapeada) — nunca perde o que o paciente escreveu (R-192: "o paciente pode escrever outro registro explicando") e mantém "uma resposta por refeição por dia" | T7; Desvio 1 |
| D4 ★ | "Desfazer" de 10 s (G-D5, recomendação **c**) | Só no aparelho: o toque em "Comi assim" mostra "Registrado no diário." com **"Desfazer"** por 10 s (`PRAZO_DESFAZER_MS`); o prazo pausa com foco ou ponteiro no aviso (WCAG 2.2.1); ao fim do prazo, ao sair da tela (`pagehide`) ou ao desmontar o componente, envia por `fetch(…, { keepalive: true })` para `POST /api/p/diario`. "Desfazer" cancela antes de enviar: **sem DELETE** no banco (P06 D11). Se o dono escolher **(a)**, o `ComiAssim` envia no toque (troca de uma constante: `PRAZO_DESFAZER_MS = 0`); **(b)** troca o aviso por um `ConfirmarBotao` | T10, T11; runbook passo 3 |
| D5 ★ | O que "Não mostrar peso no app" esconde (G-D6, recomendação **a**) | **Peso e IMC** (`SERIES_DO_PESO = ['peso', 'imc']`, `peso-oculto.ts`); filtrados **no módulo**, antes de montar a resposta: `evolucaoParaPaciente` lê as avaliações pela leitura auditada de sempre (`listarAntropometrias`) e tira peso e IMC com `semPeso` antes de devolver; `jornadaDoPaciente` e `miniJornadaDoPaciente` nem leem `peso_kg`/`imc` quando a opção está ligada (texto corrigido na revisão do plano; a opção e as medidas da evolução ficam em duas transações curtas, como antes — o valor nunca chega ao aparelho, CS-194); o `% de gordura` e as circunferências continuam. Se o dono escolher **(b)**, acrescentar `'perc_gordura'` à constante; **(c)** é opção nova (backlog) | T8, T9, T15 |
| D6 ★ | Exportação e a opção de peso (spec §10; **revista na revisão do plano, 08/10/2026**) | `pesoOcultoNoAppEm` vai no `dados.json` **dos dois escopos** (equipe e titular), descrito como "preferência de exibição no app definida pela nutricionista"; as avaliações com o peso continuam nas duas (RN-204). Motivo: a opção é dado pessoal do titular (LGPD art. 5º, I; registra um juízo clínico, provavelmente dado referente à saúde, art. 5º, II) e o acesso (art. 18, II) e a "declaração clara e completa" (art. 19, II) não se limitam ao que ele forneceu; a analogia com as notas privadas da v0.1 não se sustenta (elas não saem em **nenhum** escopo, `exportacao-job.ts:119` e `:254`). Há tensão clínica real (R-193): **a pergunta vai ao advogado (E-09, pacote P12-23/P09-00)** — se ele aceitar tirar a opção da cópia do titular, a decisão é do dono depois do parecer, e a base vai no LEIA-ME da exportação (troca de uma condição no `montarDados`) | T15 |
| D7 ★ | Cor da faixa (G-D7, recomendação **a**) | `corDaFaixa(cor)` (`src/lib/tema/marca-tema.ts`): mistura com preto em passos de 2% até o branco dar ≥ 4,5:1 sobre a faixa **e** sobre o cartão translúcido (verde claro `#e2efe9` a 16%); a cor padrão `#1d6b5a` não muda. Vale só na faixa e nos cabeçalhos do portal (`--nd-faixa`, calculada no layout); botões e links continuam com `--nd-marca` | T2, T4 |
| D8 | Tokens do portal (§4.7) | Os valores **claros** da spec para fundo, texto, suave, cartão e borda são **os mesmos** de `TOKENS` (`src/lib/tema/tokens.ts`): o portal reaproveita os tokens existentes (e os valores escuros atuais, que passam no `contraste()`). Tokens **novos** só os que faltam: `p-clara`, `p-marco`, `p-marco-texto` (`TOKENS_PORTAL`), `faixa` e `faixa-cartao` — escopados em `[data-app='paciente']` | T2; Desvio 2 |
| D9 | Fontes (DEP-G8, RNF-193) | `next/font/google` (as duas estão no catálogo do `next` 16.3.6), `subsets: ['latin']`, `display: 'swap'`, pesos 700/800/900 (Red Hat Display) e 400/700 (Atkinson Hyperlegible Next), declaradas em `src/app/p/fontes.ts` e aplicadas só no `src/app/p/layout.tsx`. A T2 mede os `woff2`: se passar de **160 KB**, trocar os pesos pela versão variável (`weight: 'variable'`) e medir de novo; se ainda passar, parar e perguntar ao dono | T2 |
| D10 | Moldura de servidor (§4.2) | `Faixa` e `CabecalhoDetalhe` são componentes de **servidor** que cada página renderiza com o seu título (a faixa depende de dado da página: primeiro nome, mês da primeira consulta); `NavSecoes` recebe `atual` da página e não usa `usePathname` (a navegação funciona sem JavaScript). Sai a `NavPortal` (7 abas) e a linha da marca do layout | T4 |
| D11 ★ | Seção "Exames" (G-D9, recomendação **a**) | Aparece com o recebimento ligado **ou** com envio não cancelado (`temEnvioVisivel`, só a existência, sem `auditRead`); a rota continua abrindo pelo endereço. "Enviar exame" na barra de ações só com o recebimento ligado (RN-215). Se o dono escolher **(b)**, a seção sempre aparece e a página mostra "Seu consultório ainda não recebe exames pelo app." | T3, T4 |
| D12 | "Sair" (RN-211) | O `SairPortal` sai do `src/app/p/layout.tsx` (topo de toda página) e vai para o **fim de Eu**; continua no topo de `/p/escolher`, `/p/sem-acesso` e `/p/termo` (cabeçalho repetido nas três páginas). O comportamento (limpeza do aparelho, `/sair` com `Clear-Site-Data`) não muda; a limpeza ganha os cartões dispensados (RN-201) | T4, T10 |
| D13 | Itens do mural sem hora própria no passado | A próxima consulta e a contagem de documentos novos entram em **Hoje** na hora da leitura (`agora`); plano novo e conteúdo novo, na data da publicação (podem cair em "Dias anteriores") | T5 |
| D14 | Manual guiado do portal (PM-G10) | Guia num arquivo próprio, `src/modules/ajuda/portal.ts` (`GUIA_PORTAL`, fora de `GUIAS`, que é do painel e casa por rota do painel); o `Tour` muda de `src/app/painel/guia/tour.tsx` para `src/components/guia/tour.tsx` (mesmo código + as props `focoAoFechar`, padrão o botão "Ajuda" do painel, e `folhaEvitaAlvo`, padrão `false`, achado 8 da revisão do plano); ação própria `marcarGuiaPortalAction` com `requirePaciente` | T14 |
| D15 ★ | Conteúdos (G-D8, recomendação **a**) | "Conteúdos" dentro de **Plano** (link ao lado de "Lista de compras", `/p/conteudos` marca Plano) + item "Novo conteúdo" no mural. Se o dono escolher **(b)**, o link vai para Eu e o `tambem` muda de seção | T3, T11 |
| D16 ★ | Como o layout entra (G-D11, recomendação **a**) | Para todos no deploy, com o aviso "O app mudou…" (uma vez por conta). Sem interruptor por consultório | T14; runbook |
| D17 ★ | Textos (G-D10, recomendação **a**) | Todos os textos novos ficam nas constantes e vão à **Debby antes do deploy** (runbook passo 2); trocar texto é trocar a constante (e o teste que a cita) | Runbook |
| D18 ★ | Meta do CS-191 (G-D12, recomendação **a**) | Aceita (≥ 50% dos pacientes ativos com plano publicado registram ≥ 3 respostas por semana nas 4 semanas depois do deploy); medida por função agregada `SECURITY DEFINER` (molde da 0087, só contagens por tenant; item **P16-17** do backlog), chamada **pelo controlador com o OK do dono**, nunca por subagente nem por SQL ad hoc — sem tela nova. Definição corrigida na revisão do plano (≥ 3 em **cada** uma das 4 semanas) e quem pode ser medido antes do DPA definitivo: **G-D15 ★** | Runbook passos 6 e 7 |

### Desvios conscientes da spec v0.1

1. **Resposta com conteúdo depois de outra resposta** (RN-197 diz "devolve esse registro"): só o "Comi assim" sem texto nem foto é idempotente; com texto ou foto, o registro entra como registro comum (sem resposta) — o que o paciente escreveu nunca se perde e continua valendo "uma resposta por refeição do plano por dia" (D3).
2. **Tokens do portal:** reaproveitam `TOKENS` em vez de redefinir `--nd-p-fundo`, `--nd-p-texto`, `--nd-p-suave`, `--nd-p-cartao` e `--nd-p-borda` com os mesmos valores claros; os escuros ficam os atuais (`#a3b5ad`, `#17211d`, `#26332e` em vez de `#a9bab2`, `#17221d`, `#2b3a33`), que o teste de contraste já aprova (D8). Acrescentado `p-marco-texto` (`#14211d` nos dois modos): no escuro o token `texto` é claro e reprovaria sobre o âmbar.
3. **Horários das refeições sem a sigla do fuso:** "Próxima refeição às 12:30" é a hora do plano (relógio de parede do dia do paciente), não um instante; a sigla (RN-06) vale para a hora dos itens, para a consulta e para a mini-jornada (`QuandoLocal`).
4. **Mini-jornada fora do mural:** a spec põe o `auditRead` do mural em três entidades (RN-200); a mini-jornada lê o peso das avaliações e audita `antropometria` na própria transação (D2). Com o peso oculto, ela nem lê o peso (nenhum `auditRead` de antropometria nesse caso: só conta atendimentos).
5. **Trilha da opção de peso sem "antes/depois" de coluna** (corrigido na revisão do plano, 08/10/2026): o gatilho `audit_row_change` grava só "alterar" em `patients` (não diz a coluna) e a coluna volta a nulo ao desligar; por isso `definirPesoOculto` grava, na mesma transação do UPDATE, uma linha própria com `recordAudit` — entidade `peso_no_app`, `criar` = ligou, `excluir` = desligou, com o ator, a hora e o paciente (molde de `tentativa_assinatura`). O "Histórico de acessos" mostra "Ligou/Desligou — Peso oculto no app". Assim dá para reconstruir quando o peso esteve oculto e quem decidiu (R-193), sem mudar a função de auditoria nem criar tabela. A §4.6, a §10 e a §11.4 da spec foram acertadas (não prometem mais "antes/depois" de colunas).
6. **"Foto da refeição" sem abrir a câmera sozinha:** a barra leva a `/p/diario?foto=1#registrar`, com o campo de foto já com `capture="environment"` (RNF-195); abrir a câmera exige um toque do paciente (o navegador não deixa abrir sem gesto).
7. **Mês "desde março"** ganha o ano quando a primeira consulta é de outro ano ("desde março de 2025"): sem isso, um acompanhamento longo diria "desde março" do ano errado.
8. **Resumo da refeição no mural:** os nomes dos itens principais vêm como estão no plano (nomes da TACO têm vírgula: "Arroz, integral, cozido"); só a primeira letra vai para minúscula. A Debby confere o resultado com planos reais (G-D10) — risco R6.
9. **Cartões dispensados apagados no "Sair" e no `/entrar`** (RN-201 cita também a "troca de dono"): a chave já leva a conta (`nd-cartao:<conta>:<cartão>`), então outra conta no aparelho nunca herda a dispensa.
10. **Textos novos não citados na spec** (vão à revisão de interface e à Debby): "Ver todo o diário", "Dias anteriores", "Ver no diário", "Ver meus exames", "Ver a consulta", "Ver o plano", "Abrir", "Ver documentos", "Mandar foto do prato", "Desfazer", "Registro desfeito.", "Registrado no diário.", "Refeição não encontrada no seu plano.", "Próxima, daqui a {tempo}", "No diário", "Cerca de {n} kcal", "Observação da sua nutricionista", "Sugestão de receita:", "Orientações do plano", "Como foi?", "Voltar para {seção}", "Plano de hoje", "Meus exames", "Eu", "Conta", "Consultório", "Instalar o app", "Como usar o app", "Agora não", "Ative as notificações para saber quando houver novidades.", "Instale o app na tela inicial.", "Peso no app do paciente", "Salvar", "Comeu como no plano", "Comeu outra coisa", "Refeição do plano:", "Ver meus documentos", "Novidade", "Linha do tempo", "Medidas por avaliação", "Medida", e os passos do guia `portal-novidades`; e os da revisão do plano (08/10/2026): "Você" e "Aviso do app" (autor visível), "Sua nutricionista comentou seu registro ({refeição}, {dia} às {hora})", "Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma.", "Para desfazer, use o botão Desfazer logo abaixo." (só leitor de tela), "Voltar para {destino}" (Desvio 13), o rodapé novo do mural e o texto novo de Privacidade (RN-193 e RN-214 acertadas na spec), "Ligou"/"Desligou — Peso oculto no app" (Histórico de acessos) e as perguntas comuns novas da ajuda do painel (`prontuario`, `diarios`).
11. **Gráfico da Jornada sem o tracejado até o marco da próxima consulta** (desenho GV-Jornada): a spec manda usar o `GraficoLinha` atual (§4.5), que não tem esse traço; o marco da próxima consulta fica na linha do tempo, logo abaixo. Se a Debby sentir falta, é uma prop nova do `GraficoLinha` (backlog).
12. **"Orientações recebidas" sai de `/p/evolucao`** e `evolucaoParaPaciente` deixa de ler as orientações: elas moram na Jornada (§4.10), que já as lê e audita; ler e auditar numa tela que não as mostra deixaria uma linha falsa na trilha.
13. **"Voltar" é um link fixo para o destino, não o histórico** (US-190 dizia "Voltar me leva de volta à tela de onde vim"; correção da revisão do plano, 08/10/2026): o `Voltar` vai sempre ao `href` do cabeçalho de detalhe e o nome acessível é "Voltar para {destino}" — a seção ("Hoje", "Jornada", "Plano", "Eu") ou a lista de que o detalhe faz parte ("Minhas consultas", "Conteúdos"). Com `history.back()`, filtros e busca de Conteúdos, `?dias=` da Lista de compras, `?semana=` de Agendar e o redirect da consulta remarcada levariam a outro lugar que o nome promete, e o histórico podia ser de outro site ou do `/entrar`. O "voltar" do navegador e o gesto do aparelho continuam voltando pelo histórico. A spec (US-190 e §4.2) foi acertada.
14. **Nas telas de detalhe nenhuma seção fica marcada na tela** (US-190 "Rotas antigas continuam" dizia "com a seção Hoje/Jornada/Plano marcada"): pela §4.2 as telas de detalhe não têm a nav "Seções"; a seção a que pertencem é dita pelo "Voltar para {seção}" do cabeçalho (o E2E "nada some" confere esse nome nas rotas de detalhe). A spec (US-190) foi acertada. Se o dono quiser a seção marcada de verdade, as telas de detalhe ganham a nav "Seções" compacta (G-D13 ★, backlog).
15. **Foco sem o anel branco de 2 px da RN-207:** o portal usa o `:focus-visible` global (`outline: 3px solid var(--nd-foco)`, testado em contraste ≥ 3:1 nos dois modos) e, sobre a faixa, o foco branco da T4; o anel duplo (`box-shadow`) fica nos "Pontos menores".
16. **Algumas linhas da §4.10 passam de 2 toques** e a §4.10 foi acertada: consulta que não é a próxima (Jornada → "Minhas consultas" → consulta → ação, 3 toques; a próxima tem "Ver a consulta" no mural e na Jornada) e o conteúdo aberto (Plano → Conteúdos → item, 3 toques; os novos aparecem no mural, 2). A sugestão de receita fica visível no `summary` de cada refeição (2 toques: Plano → receita), sem abrir a sanfona.

### Correções da revisão do plano (08/10/2026)

Revisão do plano (workflow com as lentes de cobertura, dados e normas), achados conferidos no código da `main` @ `19fcea5`. Uma linha por achado: o que mudou e onde. Os Minor sem valor agora foram para "Pontos menores"; as decisões que só o dono pode tomar estão em "Decisões do dono (★)", logo abaixo.

1. **[Important · cobertura] E2E "Minha evolução" (US-044) quebraria** — T4 Step 6 troca o h1 para "Todas as medidas"; T12 reescreve o teste para a tabela (`row` "Peso (kg)" e "% de gordura") e põe `e2e/portal.spec.ts` nos Files e no commit.
2. **[Important · cobertura] "Voltar" com `history.back()` levava a outro lugar que o nome dizia** — `Voltar` vira link de servidor fixo para o `href` (T4); Desvio 13; spec §4.2 e US-190 acertadas.
3. **[Important · cobertura] "Comi assim" sem desfazer pelo teclado/leitor de tela** — `ComiAssim` (T11) leva o foco ao "Desfazer" quando a ativação veio pelo foco (pausa o prazo) e devolve ao botão ao desfazer; status com `sr-only` "Para desfazer…"; E2E só com teclado na T16.
4. **[Important · cobertura] "Presença confirmada" sumia com o refresh** — `ConfirmarNoMural` (T10) fica montado em todo item de consulta, com `role="status"` sempre montado e o foco na confirmação.
5. **[Important · cobertura] Cartão de notificações sumia sem confirmar** — com `cartao`, `AtivarNotificacoes` continua mostrando o resultado depois de agir (`agiu`) até a próxima abertura; "Agora não" e o Instalar no Android levam o foco a "Ver todo o diário" (`id="ver-todo-diario"`).
6. **[Important · cobertura] Sanfona do Plano sem marcador** — `summary` sem `flex` (h3 `inline`, chip `inline-block`), teste que recusa `flex`/`grid` no `summary` (T11).
7. **[Important · cobertura] Mini-jornada reprovava a WCAG 2.5.3** — sem `aria-label`; `MiniJornada.complemento` (último peso) e "Sua jornada:" em `sr-only` dentro do link (contrato, T9, T10 e testes); spec US-194 e RN-202 acertadas.
8. **[Important · cobertura] Folha do tour cobria a barra de ações no celular** — `Tour` ganha `folhaEvitaAlvo` (a folha sobe para `max-sm:top-3` quando o alvo encosta no rodapé; o painel não muda), passada pelo `GuiaDoPortal`; E2E confere que folha e alvo não se sobrepõem no passo 4 (T14, T16).
9. **[Important · cobertura] "Nada some" não cobria a §4.10 inteira** — CAMINHOS ganha confirmar/cancelar/remarcar (com `marcarParaPaciente`), Baixar PDF, a Jornada com as orientações e a refeição com a receita; testes próprios para "Conectado como {e-mail}" e "Trocar de nutricionista" (conta MULTI); 3 toques em três linhas (Desvio 16, G-D14 ★); spec §4.10, CS-190 e RNF-197(c) acertadas.
10. **[Important · cobertura] US-190 pedia seção marcada nas telas de detalhe** — Desvio 14: a seção é dita pelo "Voltar para {seção}" (o E2E das rotas antigas confere esse nome); spec US-190 acertada; nav compacta = G-D13 ★.
11. **[Minor · cobertura] "Mandar foto do prato" e "Comi outra coisa" ativos sem rede** — `LinkDeResposta` (T11, cliente com `useOnline`): sem rede, `aria-disabled` e "Sem conexão. Registre quando voltar.".
12. **[Minor · cobertura] `useOnline` ignora o ping do `SeloOffline`** — Pontos menores.
13. **[Minor · cobertura] "Próxima, daqui a…" congelado na cópia offline** — Pontos menores.
14. **[Minor · cobertura] "O app mudou" também para quem nunca usou** — G-D17 ★ (com a G-D10); Pontos menores.
15. **[Minor · cobertura] Passo "Responder à refeição" sem alvo fora da janela de 90 min** — texto do passo independe do item ("Quando uma refeição estiver perto do horário…") (T14).
16. **[Minor · cobertura] RN-207 (anel branco de 2 px) sem Desvio** — Desvio 15; spec RN-207 anotada; o anel vai para Pontos menores.
17. **[Minor · cobertura] Eu sem o logo do consultório (US-197)** — T13 mostra o logo (URL assinada, fundo branco, `alt`) ao lado do nome.
18. **[Minor · cobertura] Telas de detalhe sem o nome do consultório (RN-210)** — Pontos menores.
19. **[Minor · cobertura] "Salvar" da opção de peso sem retorno** — Pontos menores.
20. **[Minor · cobertura] Ajuda do painel desatualizada** — T8 acrescenta perguntas comuns aos guias `prontuario` e `diarios` (`conteudo.ts`), sem subir a versão.
21. **[Minor · cobertura] Axe a 320 px só em Hoje; mural dependia da hora do CI** — `acessibilidade.spec` passa a `publicarPlanoDoDia`, axe a 320 px em todas as rotas do portal e axe de Hoje com o "Desfazer" aberto nos dois modos (T16).
22. **[Minor · cobertura] Ajustes de texto** — o `sr-only` repetido do comentário sai (autor visível, achado 31); "Voltar para Minhas consultas" segue "Voltar para {destino}" (Desvio 13); Desvio 10 completado.
23. **[Important · dados] Trilha da opção de peso não registrava a decisão** — `definirPesoOculto` grava `recordAudit` (`peso_no_app`, criar/excluir) na mesma transação; `ENTIDADE_ROTULO` e "Ligou/Desligou" em `rotuloDaAcao`; teste da T8; Desvio 5 reescrito; spec §4.6, §10, §11.4, RN-205 e US-195 acertadas.
24. **[Minor · dados] Cópia offline de `/p/plano` com "No diário"** — opção (a): `/p/plano` não chama `respostasDeHoje` (a marca fica no mural e na refeição aberta); teste da página confere; spec US-196 e §10 acertadas.
25. **[Minor · dados] D6 com analogia errada (notas privadas)** — D6 reescrita sem a analogia (achado 33).
26. **[Minor · dados] SQL do CS-191 ad hoc em tabelas com RLS e métrica errada** — runbook sem SQL; função agregada `SECURITY DEFINER` no molde da 0087 vira P16-17 (backlog); definição "≥ 3 em cada uma das 4 semanas"; G-D15 ★.
27. **[Minor · dados] Voltar atrás mostra o peso de novo** — runbook passo 7 e manual §6.8.1 (T16 Step 6) com o aviso: listar e avisar com o OK do dono, ou corrigir para a frente.
28. **[Minor · dados] D5 dizia que `evolucaoParaPaciente` nem lê o peso** — D5 corrigida (filtra no módulo; a jornada e a mini-jornada nem leem).
29. **[Minor · dados] §11.3 dizia que o controle da resposta é do banco; chave da idempotência por texto** — spec §11.3 reescrita (RLS lê a refeição; vínculo e hora são do módulo); RN-197 registra a chave "{nome} · {HH:MM}" (aceito); gatilho de `data_hora` vai para Pontos menores.
30. **[Important · normas] Rodapé "não envia mensagens" contrariava o que o app faz** — `MSG_MURAL.rodape` com o texto proposto (diário visível para ela, sem conversa nem prazo, contatos, 192), ajuda do portal, testes e E2E; spec §4.3, RN-193 e US-191 acertadas; texto com a Debby (G-D10 ★).
31. **[Important · normas] Autoria só pela posição/cor do balão** — autor visível em todo item ("Você", "Aviso do app", rótulo do comentário) e estilo próprio do comentário dela (borda de destaque); teste confere fora do `sr-only` (T5, T10); spec §4.3 e RN-194.
32. **[Important · normas] Privacidade prometia "Todas estão na cópia"** — texto novo ("Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).") na T13 e no teste; spec RN-214 e US-197; Debby (G-D10 ★) e advogado (E-09).
33. **[Important · normas] D6 tirava a opção de peso da cópia do titular** — D6 ★ revista: nos dois escopos ("preferência de exibição no app definida pela nutricionista") até o parecer do advogado (E-09); T15 (tipo, `montarDados`, teste, commit); spec §10.
34. **[Important · normas] Ajuda "Como usar o app" falava de peso a todos** — texto neutro da Jornada; teste novo: ajuda, passos e aviso sem "peso"/"IMC" (T14).
35. **[Important · normas] Mural vazio dizia que ela não publicou o plano** — `Mural.semPlano`; `MSG_MURAL.nadaAgora` com plano publicado; testes em `mural-regras` (05:00, 1ª refeição às 08:00) e `mural-lista`; spec §4.3 e US-191.
36. **[Important · normas] Medida do CS-191 lia diário de todos os consultórios (operadora, art. 39)** — runbook: antes de medir, G-D15 ★ (só no consultório da Debby com o pedido registrado, ou cláusula de estatística agregada no DPA definitivo, E-09, ou métrica sem tabela de saúde); spec CS-191.
37. **[Minor · normas] Trilha sem "antes/depois" (§4.6/§10)** — resolvido com o achado 23 (linha própria `peso_no_app`; spec sem a promessa de "antes/depois").
38. **[Minor · normas] Comentário longe do registro, sem dizer qual** — "Sua nutricionista comentou seu registro ({refeição}, {dia} às {hora})" (`ItemDoMural.sobre`, teste em `mural-regras`); spec §4.3 e RN-194.
39. **[Minor · normas] Resposta exportada só com o código interno** — `diario[].respostaRotulo` ("Comi assim"/"Comi outra coisa") nos dois escopos (T15); junta-se à P12-23 (e).
40. **[Minor · normas] Origem da C-197 sem artigo e com a 760/2023** — spec C-197 e §15: SBIS ECF.17.01 + Res. CFN 599/2018, arts. 16 e 19; a 856/2026 (art. 37) não muda a regra (o mural não tem IA).
41. **[Minor · normas] Cintura vira o gráfico principal com o peso oculto** — G-D16 ★ (com a Debby); o plano mantém a troca até a resposta; spec §4.5 anotada.

### Decisões do dono (★) da revisão do plano

As recomendações abaixo **não** foram aplicadas como decisão: o plano segue o que está escrito e marca o que muda se a resposta for outra.

- **D6 ★ (revista) — opção de peso na exportação do titular:** o plano a inclui nos dois escopos até o parecer do advogado (E-09, pacote P12-23/P09-00); tirar da cópia do titular só com o parecer e a decisão do dono.
- **G-D10 ★ (textos, ampliada):** a Debby revisa também o rodapé novo do mural, o texto novo de Privacidade, "Aviso do app"/"Você", o rótulo do comentário com o registro, "Nada para agora…", "Para desfazer…" e as perguntas novas da ajuda do painel.
- **G-D13 ★ — seção nas telas de detalhe:** (a) o "Voltar para {seção}" diz a seção (aplicado, Desvio 14); (b) nav "Seções" compacta nas telas de detalhe.
- **G-D14 ★ — três linhas da §4.10 com 3 toques:** (a) aceitar (aplicado, Desvio 16); (b) atalhos na Jornada e receita fora da sanfona.
- **G-D15 ★ — CS-191:** definição (≥ 3 em cada semana × média) e quem pode ser medido antes do DPA definitivo (só o consultório da Debby com o pedido registrado × métrica sem tabela de saúde); a função agregada (P16-17) só depois da resposta.
- **G-D16 ★ — cintura no lugar do peso no gráfico da Jornada com o peso oculto:** manter a troca (como está) ou nenhum gráfico de medida corporal em destaque — com a Debby.
- **G-D17 ★ — aviso "O app mudou" para quem nunca usou o app:** boas-vindas próprias, o mesmo aviso com outra pergunta, ou manter (como está) — com a G-D10.

## Review Focus

1. **Peso oculto vazando para o aparelho (CS-194).** Paciente com "Não mostrar peso no app" ligado abre Hoje, Jornada, "Todas as medidas", volta pela navegação do cliente (payload RSC), fica offline (cópia do plano) e abre o gráfico pequeno da faixa. Esperado: nenhum valor de peso ou de IMC, nem "kg", nem "IMC", em nenhuma resposta do servidor (HTML, RSC, cópia offline); a cintura continua; o app não diz que o peso está oculto. Testes: módulos com e sem a opção (T8, T9), a serialização das funções do portal (T15) e o E2E que lê o corpo de toda resposta (T16).
2. **"Comi assim" repetido, desfeito ou sem rede.** Toque duplo, duas abas, "Desfazer" no último segundo, fechar a tela antes dos 10 s, o 11º registro do dia, refeição de outro plano ou de outro paciente, vínculo bloqueado entre abrir e tocar, aparelho sem rede. Esperado: no máximo uma resposta por refeição do plano por dia (o segundo toque devolve o mesmo registro), nada gravado no "Desfazer", gravado ao fechar a tela, "Limite de 10 registros por dia atingido", 404 da refeição alheia sem gravar, "Conta temporariamente indisponível", botões desabilitados com "Sem conexão. Registre quando voltar.". Testes: T7 (módulo e rota, com duas conexões), T11 (estado do aviso e o botão desabilitado sem rede), T16 (E2E do desfazer, do envio ao sair e do offline).
3. **Virada do dia e fuso.** Consultório em `America/Sao_Paulo` e aparelho em `America/Manaus`; refeição às 00:30 vista às 23:30 do dia anterior; registro às 23:59 e mural aberto às 00:01; consulta "amanhã" às 00:30; servidor em UTC. Esperado: "Hoje" e "Ontem" no fuso do consultório; a refeição do dia seguinte não aparece antes da meia-noite; a resposta de ontem não esconde o "Comi assim" de hoje; a sigla aparece quando o aparelho está noutro fuso. Testes: T5 (`comporMural` e `datas-portal` com instantes fixos) e T7 (resposta por dia no fuso).
4. **Tela estreita, texto grande, modo escuro e cor no limite.** 320 px com texto em 200%, aparelho escuro, consultório com cor `#767676` (4,54:1), cinco seções com "Jornada" e "Exames", "Todas as medidas" com 8 avaliações. Esperado: nenhuma rolagem horizontal da página (a tabela rola dentro da própria região focável), seções em colunas iguais com alvo ≥ 44 px, texto branco ≥ 4,5:1 na faixa e no cartão da mini-jornada, foco visível branco sobre a faixa, axe sem violação nos dois modos. Testes: T2 (propriedade de `corDaFaixa` e pares de token), T12 (região da tabela), T16 (E2E a 360/320 px, claro e escuro, e o foco sobre a faixa).
5. **Rotas antigas e vários vínculos.** Toque num push antigo (`/p/diario`, `/p/plano`, `/p/conteudos`, `/p/documentos`, `/p/exames`, link da consulta), favorito em `/p/evolucao`, PWA instalado com `start_url` `/p/inicio`, paciente com dois consultórios (cookie `nd_vinculo`). Esperado: toda rota abre e marca exatamente uma seção; o mural, a jornada e a faixa são do vínculo escolhido; o tour e os cartões dispensados são da conta. Testes: T3 (toda `page.tsx` de `/p/(portal)` marca uma seção), T6 (isolamento entre pacientes e tenants), T16 (E2E "nada some" com os destinos do push).

---
## Estrutura de arquivos

```
drizzle/
  0106_app_paciente_g (gerada: diary_entries.resposta e refeicao_do_plano + CHECKs; patients.peso_oculto_no_app_em)  # T1 ("0106+")
src/db/schema/portal.ts (diaryEntries) · src/db/schema/pacientes.ts (patients)                                      # T1
src/db/app-paciente-schema.test.ts · test/isolamento.test.ts (fábrica de diary_entries) · test/plano.ts (helper)    # T1
src/modules/portal/diario-constantes.ts (+ diario-constantes.test.ts)                                               # T1 (respostas, rótulo e mapa da refeição)
src/lib/tema/marca-tema.ts (corDaFaixa) · tokens.ts (TOKENS_PORTAL) · tema.test.ts · src/app/globals.css             # T2
src/app/p/fontes.ts · src/app/painel/cores.test.ts (tokens de borda)                                                 # T2
src/app/p/navegacao.ts (+ navegacao.test.ts) · src/modules/portal/exames-enviados.ts (temEnvioVisivel, + test)       # T3
src/modules/portal/datas-portal.ts (+test) · mural-regras.ts (+test)                                                 # T5 (puros)
src/components/portal/{faixa.tsx, nav-secoes.tsx, cabecalho-detalhe.tsx, voltar.tsx, barra-de-acoes.tsx,
  focar-titulo.tsx, cabecalho-sair.tsx, textos.ts} · src/app/p/moldura.ts                                           # T4
src/app/p/layout.tsx · src/app/p/(portal)/layout.tsx · src/app/p/nav-portal.tsx (sai) · src/modules/portal/perfil.ts  # T4
src/app/p/(portal)/*/page.tsx (cabeçalhos) · src/app/p/(portal)/jornada/page.tsx (esqueleto) · termo/escolher/sem-acesso  # T4
e2e/{portal,acessibilidade,exames-enviados,pacientes}.spec.ts (barra antiga → seções)                               # T4
src/modules/portal/mural.ts (+ mural.test.ts) · conteudos.ts (conteudosNovosNaTransacao) · documentos/portal.ts      # T6
src/modules/portal/diario.ts (+test) · src/app/api/p/diario/route.ts (+test) · diario-nutri.ts (+test)               # T7
src/app/painel/diarios/page.tsx · src/app/painel/diarios/[id]/page.tsx                                               # T7
src/modules/pacientes/peso-oculto.ts (+test) · src/modules/portal/evolucao.ts (+test)                                # T8
src/app/painel/pacientes/[id]/evolucao/{page.tsx, actions.ts, peso-oculto.tsx}                                       # T8
src/modules/portal/jornada-regras.ts (+test) · jornada.ts (+test)                                                    # T9
src/app/p/(portal)/inicio/{page.tsx (+test), mural-lista.tsx (+test), confirmar-no-mural.tsx, cartoes-do-aparelho.tsx,
  atualizar-ao-voltar.tsx} · src/components/portal/{mini-jornada.tsx, cartoes-dispensados.ts (+test)} · src/app/p/sair-portal.tsx
  · src/app/entrar/page.tsx · src/app/p/notificacoes.tsx · src/app/p/instalar.tsx                                    # T10
src/components/portal/{comi-assim.tsx, comi-assim-estado.ts (+test), online.ts}                                     # T11
src/modules/portal/plano.ts (+test: kcal da refeição, próxima com horário) · src/app/p/(portal)/plano/{page.tsx (+test),
  refeicao-detalhe.tsx, abrir-refeicao-da-url.tsx, refeicao/[id]/page.tsx (+test)} · src/app/p/(portal)/diario/{page.tsx, diario-form.tsx (+test)}  # T11
src/app/p/(portal)/jornada/{page.tsx (+test), linha-do-tempo.tsx} · src/app/p/(portal)/evolucao/{page.tsx (+test), tabela-medidas.tsx}  # T12
src/app/p/(portal)/perfil/page.tsx (+ page.test.ts) · exames/page.tsx · documentos/page.tsx · termo · escolher · sem-acesso  # T13
src/modules/ajuda/portal.ts (+test) · src/components/guia/tour.tsx (movido) · src/app/painel/guia/guia-do-painel.tsx (import)
  · src/app/p/(portal)/ajuda/{page.tsx, actions.ts (+test)} · src/app/p/(portal)/inicio/guia-do-portal.tsx · CLAUDE.md (regra 1)  # T14
src/modules/pacientes/exportacao-job.ts (+ exportacao.test.ts) · src/modules/portal/peso-oculto-portal.test.ts      # T15
e2e/{app-paciente.spec.ts, nada-some.spec.ts, portal.ts (helper)} · e2e/acessibilidade.spec.ts (ROTAS, 360/320) · test/carga/cenario.js  # T16
docs/manual-tecnico/{05-agenda-portal-conteudo.md, 11-exames-enviados.md, README.md} · docs/operacao/app-paciente.md
  · índice · backlog · spec G (status) · spec do MVP (tabela de textos do E5)                                         # T16
```

### Dependências entre tarefas (worktrees em paralelo)

| Tarefa | Depende de | Pode rodar em paralelo com | Por quê |
|---|---|---|---|
| T1 Banco | — | T2, T3, T5 | só schema, migration, helpers de teste e `diario-constantes.ts` |
| T2 Tema e fontes | — | T1, T3, T5 | `marca-tema.ts`, `tokens.ts`, `globals.css`, `fontes.ts`, `cores.test.ts` |
| T3 Navegação | — | T1, T2, T5 | `navegacao.ts` e `temEnvioVisivel` (arquivo do Plano 12, função nova no fim) |
| T5 Regras do mural e datas | T1 só pelo tipo `RespostaDoDiario` e por `rotuloDaRefeicao` (se rodar antes, copiar as duas linhas do contrato e apagar no merge) | T1, T2, T3 | só arquivos novos e puros |
| T4 Moldura | T2, T3, T5 (`dataDaFaixa`) | T7, T8 | `src/components/portal/`, layouts e o cabeçalho de **todas** as páginas do portal; E2E da barra antiga |
| T7 Respostas no diário | T1 | T4, T8 | `diario.ts`, rota do diário, feed da nutricionista (painel) |
| T8 Peso oculto | T1 | T4, T7 | `peso-oculto.ts`, `portal/evolucao.ts`, aba Evolução do painel |
| T6 Leitura do mural | T1, T5, T7 (`paraRegistro` com a resposta) | T9, T11, T13 | `mural.ts`, `conteudos.ts` (função nova), `documentos/portal.ts` (refatoração sem mudar comportamento) |
| T9 Jornada (módulo) | T1, T5, T8 | T6, T11, T13 | `jornada-regras.ts`, `jornada.ts` |
| T11 Plano e refeição aberta | T4, T7 | T6, T9, T13 | `plano/`, `diario/`, `portal/plano.ts` |
| T13 Exames e Eu | T4 | T6, T9, T11 | `perfil/`, `exames/`, `documentos/`, `termo`, `escolher`, `sem-acesso` |
| T10 Hoje | T4, T6, T7, T9, T11 (`ComiAssim` mora em `inicio/` mas a refeição aberta da T11 o importa — ver Interfaces) | T12, T15 | `inicio/`, `components/portal/` (arquivos novos), `sair-portal.tsx`, `entrar/page.tsx`, `notificacoes.tsx` |
| T12 Jornada e "Todas as medidas" (telas) | T4, T9 | T10, T15 | `jornada/`, `evolucao/` do portal |
| T15 LGPD e CS-194 | T7, T8, T9 | T10, T12 | `exportacao-job.ts` e testes |
| T14 Manual guiado | T10, T13 | — | `inicio/page.tsx` (aviso e tour) e Eu (link) depois deles |
| T16 Fechamento | todas | — | E2E, axe, carga, manuais, runbook, índice, backlog |

**Ordem de merge no branch do plano:** T1, T2, T3, T5 → T4, T7, T8 → T6, T9, T11, T13 → T10, T12, T15 → T14 → T16. **Arquivos que mais de uma tarefa toca** (resolver por ordem, nunca em paralelo): `src/app/p/(portal)/inicio/page.tsx` (T4 → T10 → T14), `plano/page.tsx` e `diario/page.tsx` (T4 → T11), `perfil/page.tsx` (T4 → T13 → T14), `evolucao/page.tsx` do portal (T4 → T12), `src/modules/portal/diario.ts` (T7 → T6 só lê), `src/modules/portal/plano.ts` (T11), `e2e/acessibilidade.spec.ts` (T4 → T16), `CLAUDE.md` (só T14).

**Nota sobre a T11 e o `ComiAssim`:** o componente do botão com "Desfazer" é criado pela **T11** (`src/components/portal/comi-assim.tsx`, junto do estado puro), porque a refeição aberta e a sanfona do Plano já o usam; a T10 só o importa no mural. Por isso a T10 depende da T11.

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// src/db/schema (T1)
// diaryEntries: resposta: string | null; refeicaoDoPlano: string | null
// patients: pesoOcultoNoAppEm: Date | null

// src/modules/portal/diario-constantes.ts (T1; sem imports de servidor)
export const RESPOSTAS_DO_DIARIO = ['como_no_plano', 'outra_coisa'] as const;
export type RespostaDoDiario = (typeof RESPOSTAS_DO_DIARIO)[number];
export const ROTULO_RESPOSTA: Record<RespostaDoDiario, string>;        // "Comi assim" / "Comi outra coisa" (paciente)
export const ROTULO_RESPOSTA_NUTRI: Record<RespostaDoDiario, string>;  // "Comeu como no plano" / "Comeu outra coisa" (painel)
export const REFEICAO_DO_PLANO_MAX = 80;
export function rotuloDaRefeicao(nome: string, horario: string): string;   // "Almoço · 12:30" (sem horário: "Almoço")
export function refeicaoDoDiario(nomeDoPlano: string): RefeicaoDiario;     // "almoco" → "Almoço"; "Pré-treino" → "Outro"
// MSG_DIARIO ganha: refeicaoNaoEncontrada, registrado

// test/plano.ts (T1)
export type RefeicaoDeTeste = { nome: string; horario: string; observacao?: string; itens?: { gramas: number; substitui?: number }[] };
export function planoPublicado(db: Db, T: TenantDeTeste, patientId: string, o?: { refeicoes?: RefeicaoDeTeste[]; mostrarCalorias?: boolean; orientacoes?: string }): Promise<{ planId: string; refeicoes: { id: string; nome: string; horario: string }[] }>;

// src/lib/tema/marca-tema.ts (T2)
export const VERDE_CLARO_PORTAL = '#e2efe9'; export const OPACIDADE_CARTAO_FAIXA = 0.16;
export function corDaFaixa(cor: string): string;
// src/lib/tema/tokens.ts (T2)
export const TOKENS_PORTAL: { 'p-clara': [string, string]; 'p-marco': [string, string]; 'p-marco-texto': [string, string] };
export const PARES_PORTAL: readonly { texto: Token | TokenPortal; fundo: Token | TokenPortal; minimo: number }[];
// src/app/p/fontes.ts (T2): export const redHat, atkinson (NextFontWithVariable: --font-redhat, --font-atkinson)
// Classes Tailwind (T2): bg-faixa, text-faixa, bg-faixa-cartao, bg-p-clara, bg-p-marco, text-p-marco-texto, border-p-marco-texto,
//   font-portal, font-portal-titulo

// src/app/p/navegacao.ts (T3)
export type SecaoPortal = { href: string; rotulo: string; tambem: readonly string[] };
export const SECOES_DO_PORTAL: readonly SecaoPortal[];
export function secoesDoPortal(o: { exames: boolean }): SecaoPortal[];
export function itemAtual(pathname: string): string | null;
export function secaoDe(pathname: string): SecaoPortal | null;
// src/modules/portal/exames-enviados.ts (T3)
export function temEnvioVisivel(ctx: TenantContext, db?: Db): Promise<boolean>;

// src/modules/portal/datas-portal.ts (T5; puro)
export function dataDaFaixa(data: string): string;                       // "Quarta, 8 out"
export function separadorDoDia(data: string, hoje: string): string;      // "Ontem" | "Seg, 6 out"
export function dataPorExtenso(data: string, hoje: string): string;      // "22 de setembro" (+ " de 2025")
export function mesPorExtenso(data: string, hoje: string): string;       // "março" (+ " de 2025")
export function quandoRelativo(inicio: Date, agora: Date, fuso: string): string;        // "amanhã, 14:00"
export function quandoRelativoComFuso(inicio: Date, agora: Date, fuso: string): string; // "amanhã, 14:00 (horário de Brasília)"
export function horaComFuso(instante: Date, fuso: string): { semFuso: string; comFuso: string };
export function daquiA(minutos: number): string;                         // "daqui a 1 h 25 min"
// src/modules/portal/mural-regras.ts (T5; puro)
export const JANELA_MURAL_DIAS = 7, MAX_ITENS_MURAL = 40, ANTECEDENCIA_REFEICAO_MIN = 90, MAX_CONTEUDOS_NO_MURAL = 3, LIMITE_DIARIO_NO_MURAL = 100;
export const MSG_MURAL: {...};
export type FontesDoMural; export type ItemDoMural; export type Mural = { primeiroNome: string; hoje: ItemDoMural[]; anteriores: { dia: string; rotulo: string; itens: ItemDoMural[] }[]; vazio: boolean; /** sem plano publicado: o texto "Nada por aqui ainda…" só vale aqui */ semPlano: boolean };
export function resumoDaRefeicao(itens: readonly { nome: string }[]): string;
export function saudacao(minutosDoDia: number): 'Bom dia' | 'Boa tarde' | 'Boa noite';
export function comporMural(f: FontesDoMural, agora: Date, fuso: string): Mural;

// src/components/portal/* (T4)
export function Faixa(p: { marca: MarcaTenant; titulo: string; subtitulo?: string; secoes: readonly SecaoPortal[]; atual: string; children?: ReactNode }): JSX.Element;
export function CabecalhoDetalhe(p: { titulo: string; voltar: { href: string; secao: string } }): JSX.Element;
export function NavSecoes(p: { secoes: readonly SecaoPortal[]; atual: string }): JSX.Element;
export function BarraDeAcoes(p: { exames: boolean; podeAgendar: boolean }): JSX.Element;
export const MSG_G: {...};
// src/app/p/moldura.ts (T4; server-only)
export function molduraDaSecao(a: PacienteAccess): Promise<{ marca: MarcaTenant; secoes: SecaoPortal[] }>;
// src/modules/portal/perfil.ts (T4)
export const primeiroNome: (nome: string) => string;

// src/modules/portal/mural.ts (T6)
export function muralDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db?: Db): Promise<Mural>; // documentos: a liberação é lida do tenant dentro da transação
// src/modules/portal/conteudos.ts (T6)
export function conteudosNovosNaTransacao(tx: Tx, patientId: string, desde: Date, limite: number): Promise<{ id: string; titulo: string; publicadoEm: Date }[]>;
// src/modules/documentos/portal.ts (T6)
export function novosNoPortalNaTransacao(tx: Tx, ctx: TenantContext): Promise<number>;

// src/modules/portal/diario.ts (T7)
export type RegistroDoDiario = { …; resposta: RespostaDoDiario | null; refeicaoDoPlano: string | null };
export function registrarNoDiario(ctx, tenant: { fuso: string }, input: { refeicao: unknown; texto: unknown; foto: Buffer | null; refeicaoId?: unknown; resposta?: unknown }, deps?): Promise<{ id: string; semFoto: boolean; jaRegistrado: boolean }>;
export function respostasDeHoje(ctx: TenantContext, fuso: string, o?: { db?: Db; agora?: Date }): Promise<Set<string>>; // rótulos "Almoço · 12:30" já respondidos hoje

// src/modules/pacientes/peso-oculto.ts (T8)
export const SERIES_DO_PESO = ['peso', 'imc'] as const; export const MSG_PESO_OCULTO: {...};
export function semPeso<T extends { id: string }>(series: readonly T[]): T[];
export function definirPesoOculto(ctx: TenantContext, patientId: string, ocultar: boolean, deps?: { db?: Db; agora?: Date }): Promise<void>;
export function pesoOcultoNaTransacao(tx: Tx, patientId: string): Promise<boolean>;

// src/modules/portal/jornada-regras.ts (T9; puro)
export type AvaliacaoDaJornada; export type AtendimentoDaJornada; export type Medida = { id: string; texto: string };
export type Marco; export type Jornada = { titulo: string; grafico: SerieEvolucao | null; marcos: Marco[]; vazia: boolean; podeAgendar: boolean };
export type MiniJornada = { linha1: string; linha2: { semFuso: string; comFuso: string }; complemento: string | null; pontos: number[]; podeAgendar: boolean }; // complemento: texto só para leitor de tela depois da linha 1 (WCAG 2.5.3: sem aria-label)
export const MSG_JORNADA: {...};
export function medidasDaAvaliacao(a: AvaliacaoDaJornada, o: { percGordura: boolean }): Medida[];
export function montarJornada(e: EntradaDaJornada, agora: Date, fuso: string): Jornada;
export function miniJornada(e: EntradaDaMini, agora: Date, fuso: string): MiniJornada;
// src/modules/portal/jornada.ts (T9)
export function jornadaDoPaciente(ctx, tenant: TenantAgenda & { mostrarPercGorduraPaciente: boolean }, agora: Date, db?: Db): Promise<Jornada>;
export function miniJornadaDoPaciente(ctx, tenant: TenantAgenda, agora: Date, db?: Db): Promise<MiniJornada>;

// src/modules/portal/plano.ts (T11)
// RefeicaoDoPaciente ganha kcal: string | null (total da refeição, só com mostrarCalorias); PlanoDoPaciente ganha mostrarCalorias: boolean
// src/components/portal/comi-assim.tsx (T11) + comi-assim-estado.ts (T11; puro)
export const PRAZO_DESFAZER_MS: number; // 10_000 (G-D5 ★ = c); 0 = envia no toque (a)
export const MSG_COMI_ASSIM: { desfazer: string; desfeito: string; semConexao: string; podeDesfazer: string };
export type FaseComiAssim = 'pronto' | 'aguardando' | 'enviando' | 'feito' | 'desfeito' | 'erro';
export function sobra(restanteMs: number, decorridoMs: number): number;
export function mensagemDaFase(f: FaseComiAssim): string;
export function mostraBotao(f: FaseComiAssim): boolean;
export function ComiAssim(p: { refeicaoId: string }): JSX.Element;
// src/components/portal/online.ts (T11): export function useOnline(): boolean
// src/components/portal/link-de-resposta.tsx (T11): export function LinkDeResposta(p: { href: string; className: string; children: ReactNode }): JSX.Element // sem rede: aria-disabled
// src/components/portal/cartoes-dispensados.ts (T10): export function dispensado(conta, cartao, agora?), dispensar(conta, cartao, agora?), esquecerCartoesDoAparelho()

// src/modules/ajuda/portal.ts (T14)
export const GUIA_PORTAL: Guia; export const AVISO_PORTAL: {...};
// src/components/guia/tour.tsx (T14, movido) — Tour ganha focoAoFechar?: string e folhaEvitaAlvo?: boolean (padrão false: o painel não muda)
// src/app/p/(portal)/ajuda/actions.ts (T14)
export function marcarGuiaPortalAction(versao: number, estado: EstadoGuia): Promise<void>;
```

### Cobertura da spec v0.1 (autoconferência)

| Requisito | Tarefa(s) |
|---|---|
| US-190 (seções, recebimento desligado, rotas antigas, 320 px, tela de detalhe) / RN-190, RN-191, RN-192, C-195 | T3 (seções, `tambem`, toda rota marca uma), T4 (moldura, detalhe com "Voltar"), T16 (E2E "nada some", 320 px) |
| US-191 (mural: refeição, distante, sem horário, comentário, exame, consulta, conteúdo/documento/plano, sem caixa de texto, vazio, fuso, leitura auditada) / RN-193 a RN-196, RN-199, RN-200 | T5 (`comporMural`), T6 (`muralDoPaciente`, auditoria, isolamento), T10 (tela) |
| US-192 (Comi assim, desfazer, outra coisa, foto, uma por dia, limite, refeição alheia, sem rede, bloqueado) / RN-197, RN-198 | T7 (módulo, rota), T11 (`ComiAssim`, formulário com a resposta), T10 (no mural), T16 (E2E) |
| US-193 (refeição aberta, calorias, de outro plano, offline) / RN-213, RN-208 | T11 |
| US-194 (Jornada, medidas permitidas, avaliação sem atendimento, sem consulta, todas as medidas, minhas consultas, mini-jornada) / RN-202, RN-206 | T9 (módulo), T12 (telas), T10 (faixa de Hoje) |
| US-195 (ligar, efeito no app, o paciente não vê nem muda, o que não muda, desligar) / RN-203, RN-204, RN-205, RN-214 | T1 (coluna, gatilho), T8 (módulo, painel, evolução), T9 (jornada, mini), T13 (texto em Privacidade), T15 (exportação, CS-194), T16 (E2E) |
| US-196 (plano em sanfona, conteúdos dentro de Plano, plano offline) | T3 (`tambem`), T11 |
| US-197 (Exames, Eu, Privacidade sem mudança, Sair) / RN-211, RN-215 | T4 (Sair), T13, T10 (limpeza dos cartões) |
| US-198 (cor padrão, cor no limite, modo escuro, movimento reduzido) / RN-207, RNF-192, RNF-194, RNF-198 | T2, T4, T16 |
| US-199 (tour "O app mudou", como usar o app) / RN-212 | T14 |
| RN-201 (cartões do aparelho) / RN-209 (push sem mudança) / RN-210 (vínculos) | T10 / T16 ("nada some" com os destinos do push) / T6, T14, T16 |
| RN-216 / RN-217 / RN-218 / RN-219 | constantes em T5, T9, T4; T16 (tabela de textos) / T5 / T4 (`primeiroNome`), T6 / D16, runbook |
| RNF-190 (desempenho, uma transação, carga) / RNF-191 / RNF-193 / RNF-195 / RNF-196 / RNF-197 / RNF-199 | T6, T9, T16 (`cenario.js`) / T4, T10–T13, T16 / T2 / T11 (câmera) / todas (sem log) / T5–T9, T15, T16 / T4 |
| CS-190 / CS-191 / CS-192 / CS-193 / CS-194 | T16 / runbook / runbook / T16 / T15, T16 |
| §4.8 offline / §4.9 painel / §4.10 "nada some" | T11 / T7, T8 / T16 |
| §9 modelo de dados / §10 LGPD / §11 SBIS | T1 / T15 (+ D6) / Global Constraints, T1, T6, T7 |
| PM-G1 a PM-G14 | PM-G1: Global Constraints e T1 (renumerar); PM-G2: D9/T2; PM-G3: T2; PM-G4: T3; PM-G5: D2/T6; PM-G6: T7; PM-G7: T11; PM-G8: T7, T8; PM-G9: T15; PM-G10: T14; PM-G11: T16 (carga) e runbook; PM-G12: T16; PM-G13: T16; PM-G14: cabeçalho de cada tarefa |

### Task 1: Banco — respostas no diário, "Não mostrar peso no app", constantes das respostas e helpers de teste (P16-01)

**Revisão: completa (agente revisor-rls)** — colunas novas em tabelas com RLS e auditoria, CHECKs refeitos, gatilho `paciente_colunas` (sem mudar a função), política `paciente_diario_insert`, fábrica do isolamento.

**Files:**
- Create: `drizzle/0106_app_paciente_g.sql` (gerada; **0106+**), `src/db/app-paciente-schema.test.ts`, `src/modules/portal/diario-constantes.test.ts`, `test/plano.ts`
- Modify: `src/db/schema/portal.ts` (`diaryEntries`), `src/db/schema/pacientes.ts` (`patients`), `src/modules/portal/diario-constantes.ts`, `test/isolamento.test.ts` (fábrica `diary_entries`), `src/app/painel/pacientes/valores.test.ts` (o `PatientRow` literal ganha a coluna nova)

**Interfaces:**
- Consumes: `diaryEntries`, `patients` (schema), `REFEICOES_DO_DIARIO`, `criarRascunho`/`salvarRascunho` (`src/modules/plano-alimentar/rascunho.ts`), `publicarPlano` (`publicacao.ts`), `idTaco` (`src/modules/alimentos/taco.ts`), `novoTenant`/`novoPaciente`/`ctxPaciente` (`test/pacientes.ts`), `makeDb` (`test/db.ts`).
- Produces: as colunas `diary_entries.resposta`, `diary_entries.refeicao_do_plano`, `patients.peso_oculto_no_app_em` (Drizzle: `resposta`, `refeicaoDoPlano`, `pesoOcultoNoAppEm`); `RESPOSTAS_DO_DIARIO`, `RespostaDoDiario`, `ROTULO_RESPOSTA`, `ROTULO_RESPOSTA_NUTRI`, `REFEICAO_DO_PLANO_MAX`, `rotuloDaRefeicao`, `refeicaoDoDiario`, `MSG_DIARIO.refeicaoNaoEncontrada`, `MSG_DIARIO.registrado`; `test/plano.ts` (`planoPublicado`).

- [ ] **Step 0: Base e numeração (PM-G1, C-196)**

O Plano 16 começa **depois do merge do Plano 13** (G-D2). Antes de tudo:

```bash
git fetch origin && git rebase origin/main
ls drizzle/*.sql | tail -3        # a última migration; a deste plano é a próxima livre (0106 se o Plano 13 terminou na 0105)
git log --oneline -3 origin/main
```

Conferir de novo a §1.3 da spec contra a `main` (o Plano 13 pode ter criado rotas em `/p/` — por exemplo o parecer em "Meus documentos", US-148): toda `page.tsx` nova em `src/app/p/(portal)` precisa de uma seção no `tambem` da T3 (o teste da T3 quebra se faltar). Se o número livre não for `0106`, usar o número certo em todo este plano (busca por `0106`).

- [ ] **Step 1: Testes puros das constantes (falham)**

Criar `src/modules/portal/diario-constantes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REFEICAO_DO_PLANO_MAX, refeicaoDoDiario, RESPOSTAS_DO_DIARIO, ROTULO_RESPOSTA, ROTULO_RESPOSTA_NUTRI, rotuloDaRefeicao } from './diario-constantes';

describe('respostas do diário (Plano 16, RN-197)', () => {
  it('a refeição do diário vem do nome da refeição do plano, sem acento e sem diferença de maiúsculas; senão "Outro"', () => {
    expect(refeicaoDoDiario('Almoço')).toBe('Almoço');
    expect(refeicaoDoDiario('  almoco ')).toBe('Almoço');
    expect(refeicaoDoDiario('CAFÉ DA MANHÃ')).toBe('Café da manhã');
    expect(refeicaoDoDiario('Lanche da tarde')).toBe('Lanche da tarde');
    expect(refeicaoDoDiario('Pré-treino')).toBe('Outro');
    expect(refeicaoDoDiario('')).toBe('Outro');
  });

  it('o rótulo da refeição do plano é "{nome} · {HH:MM}" (sem horário, só o nome) e cabe no CHECK do banco', () => {
    expect(rotuloDaRefeicao('Almoço', '12:30')).toBe('Almoço · 12:30');
    expect(rotuloDaRefeicao('Ceia', '')).toBe('Ceia');
    // meals.nome tem até 60 caracteres (meals_textos_tamanho): 60 + " · 12:30" = 68 ≤ 80
    expect(rotuloDaRefeicao('x'.repeat(60), '23:59').length).toBeLessThanOrEqual(REFEICAO_DO_PLANO_MAX);
  });

  it('dois valores de resposta, com o texto do paciente e o do painel (§4.9)', () => {
    expect(RESPOSTAS_DO_DIARIO).toEqual(['como_no_plano', 'outra_coisa']);
    expect(ROTULO_RESPOSTA).toEqual({ como_no_plano: 'Comi assim', outra_coisa: 'Comi outra coisa' });
    expect(ROTULO_RESPOSTA_NUTRI).toEqual({ como_no_plano: 'Comeu como no plano', outra_coisa: 'Comeu outra coisa' });
  });
});
```

Run: `pnpm vitest run src/modules/portal/diario-constantes.test.ts` → FAIL (`refeicaoDoDiario` não existe).

- [ ] **Step 2: As constantes**

Em `src/modules/portal/diario-constantes.ts`, acrescentar depois de `COMENTARIO_MAX` (o arquivo continua sem imports de servidor: o formulário do cliente usa):

```ts
/** Plano 16 (RN-197): respostas à refeição do plano, gravadas no diário. Lista fechada (CHECK diary_entries_resposta_valida). */
export const RESPOSTAS_DO_DIARIO = ['como_no_plano', 'outra_coisa'] as const;
export type RespostaDoDiario = (typeof RESPOSTAS_DO_DIARIO)[number];
export const ehRespostaDoDiario = (v: unknown): v is RespostaDoDiario => typeof v === 'string' && (RESPOSTAS_DO_DIARIO as readonly string[]).includes(v);
/** O que o paciente vê no balão dele (texto da spec, US-192). */
export const ROTULO_RESPOSTA: Record<RespostaDoDiario, string> = { como_no_plano: 'Comi assim', outra_coisa: 'Comi outra coisa' };
/** O que a nutricionista vê no feed e no registro aberto (§4.9). */
export const ROTULO_RESPOSTA_NUTRI: Record<RespostaDoDiario, string> = { como_no_plano: 'Comeu como no plano', outra_coisa: 'Comeu outra coisa' };
/** CHECK diary_entries_refeicao_do_plano (char_length 1..80). */
export const REFEICAO_DO_PLANO_MAX = 80;

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** "Almoço · 12:30": a cópia (não FK) da refeição do plano no registro — o plano muda e o registro continua dizendo a que se referia. */
export function rotuloDaRefeicao(nome: string, horario: string): string {
  return horario ? `${nome} · ${horario}` : nome;
}

/** §4.4: a refeição do diário (lista fechada) a partir do nome da refeição do plano; sem correspondência, "Outro". */
export function refeicaoDoDiario(nomeDoPlano: string): RefeicaoDiario {
  const alvo = semAcento(nomeDoPlano);
  return REFEICOES_DO_DIARIO.find((r) => r !== 'Outro' && semAcento(r) === alvo) ?? 'Outro';
}
```

E em `MSG_DIARIO`, acrescentar as duas chaves:

```ts
  refeicaoNaoEncontrada: 'Refeição não encontrada no seu plano.',
  registrado: 'Registrado no diário.',
```

Run: `pnpm vitest run src/modules/portal/diario-constantes.test.ts` → PASS.

- [ ] **Step 3: Testes do banco (falham)**

Criar `src/db/app-paciente-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { auditLog, diaryEntries, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
const falhaCom = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigo(e);
  }
  return 'sem erro';
};

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const comoPaciente = ctxPaciente(T.tenantId, p.id);
  const registro = (ctx: Parameters<typeof withTenant>[0], v: Partial<typeof diaryEntries.$inferInsert>) =>
    withTenant(ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', ...v }).returning({ id: diaryEntries.id }), app.db);
  return { T, p, comoPaciente, registro };
}

describe('diary_entries: respostas à refeição do plano (Plano 16, §9, RN-197)', () => {
  it('"Comi assim" sem texto nem foto entra pela sessão do paciente (paciente_diario_insert continua valendo)', async () => {
    const { comoPaciente, registro } = await cenario();
    const [r] = await registro(comoPaciente, { resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30' });
    expect(r.id).toBeTruthy();
  });

  it('CHECKs: resposta da lista; refeição do plano junto da resposta (e só com ela), de 1 a 80 caracteres; "outra coisa" e registro comum exigem texto ou foto', async () => {
    const { comoPaciente, registro } = await cenario();
    expect(await falhaCom(registro(comoPaciente, { resposta: 'talvez', refeicaoDoPlano: 'Almoço · 12:30', texto: 'x' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'como_no_plano' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { refeicaoDoPlano: 'Almoço · 12:30', texto: 'arroz' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'como_no_plano', refeicaoDoPlano: 'x'.repeat(81) }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'como_no_plano', refeicaoDoPlano: '' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, { resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30' }))).toBe('23514');
    expect(await falhaCom(registro(comoPaciente, {}))).toBe('23514'); // a regra antiga continua: sem texto, sem foto, sem "Comi assim"
    await registro(comoPaciente, { resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30', texto: 'Sanduíche natural' });
    await registro(comoPaciente, { texto: 'arroz e feijão' });
  });

  it('a resposta do paciente vira audit_log pelo gatilho (entidade diario, ator = a conta do paciente)', async () => {
    const { T, p, registro } = await cenario();
    const conta = randomUUID();
    const [r] = await registro(ctxPaciente(T.tenantId, p.id, conta), { resposta: 'como_no_plano', refeicaoDoPlano: 'Jantar · 19:30' });
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'diario'), eq(auditLog.entidadeId, r.id))), app.db);
    expect(linhas).toEqual([expect.objectContaining({ acao: 'criar', actorUserId: conta, patientId: p.id })]);
  });
});

describe('patients.peso_oculto_no_app_em (Plano 16, G-D1, RN-205)', () => {
  it('a sessão de paciente não liga nem desliga a opção (gatilho paciente_colunas, 0085: a coluna fica fora de `livres`)', async () => {
    const { p, comoPaciente } = await cenario();
    const mudar = (v: Date | null) => withTenant(comoPaciente, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: v }).where(eq(patients.id, p.id)), app.db);
    expect(await falhaCom(mudar(new Date()))).toBe('42501');
  });

  it('a equipe liga e desliga; cada troca vira audit_log (entidade patients, ação alterar, ator = quem trocou)', async () => {
    const { T, p } = await cenario();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: null }).where(eq(patients.id, p.id)), app.db);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'patients'), eq(auditLog.entidadeId, p.id), eq(auditLog.acao, 'alterar'))), app.db);
    expect(linhas.filter((l) => l.actorUserId === T.nutriId)).toHaveLength(2);
  });

  it('o paciente lê a própria opção pela RLS (o portal filtra no servidor), e não a de outro paciente', async () => {
    const { T, p, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ pesoOcultoNoAppEm: new Date() }).where(eq(patients.id, outro.id)), app.db);
    const vistos = await withTenant(comoPaciente, (tx) => tx.execute(sql`select id, peso_oculto_no_app_em from patients`), app.db);
    expect(vistos.rows).toEqual([{ id: p.id, peso_oculto_no_app_em: null }]);
  });
});
```

Run: `pnpm vitest run src/db/app-paciente-schema.test.ts` → FAIL (colunas não existem).

- [ ] **Step 4: Schema**

Em `src/db/schema/portal.ts`, importar `RESPOSTAS_DO_DIARIO` junto de `REFEICOES_DO_DIARIO` (no mesmo import **relativo** `../../modules/portal/diario-constantes` — o `drizzle-kit` não resolve o alias `@/`) e, em `diaryEntries`, acrescentar depois de `fotoStatus`:

```ts
    /** Plano 16 (RN-197): resposta à refeição do plano ("Comi assim" / "Comi outra coisa"); null = registro comum. */
    resposta: text('resposta'),
    /** Plano 16: "{nome} · {HH:MM}" da refeição do plano — CÓPIA, não FK (a refeição pode mudar numa publicação nova). */
    refeicaoDoPlano: text('refeicao_do_plano'),
```

E trocar o CHECK `diary_entries_tem_conteudo` e acrescentar os três novos (logo depois dele):

```ts
    // Plano 16: o "Comi assim" (resposta sem texto nem foto) também é conteúdo
    check('diary_entries_tem_conteudo', sql`${t.texto} is not null or ${t.fotoStatus} <> 'sem_foto' or ${t.resposta} = 'como_no_plano'`),
    check('diary_entries_resposta_valida', sql`${t.resposta} is null or ${t.resposta} in (${sql.raw(RESPOSTAS_DO_DIARIO.map((r) => `'${r}'`).join(', '))})`),
    // a refeição do plano vem junto da resposta, e só com ela
    check('diary_entries_refeicao_do_plano', sql`(${t.resposta} is null) = (${t.refeicaoDoPlano} is null) and (${t.refeicaoDoPlano} is null or char_length(${t.refeicaoDoPlano}) between 1 and 80)`),
    // "Comi outra coisa" exige o que foi comido (texto ou foto)
    check('diary_entries_outra_coisa_tem_conteudo', sql`${t.resposta} is distinct from 'outra_coisa' or ${t.texto} is not null or ${t.fotoStatus} <> 'sem_foto'`),
```

Em `src/db/schema/pacientes.ts`, em `patients`, depois de `iaAvisoEnviadoEm`:

```ts
    /**
     * Plano 16 (G-D1, RN-203): "Não mostrar peso no app" — só a equipe liga (aba Evolução do prontuário); o portal deixa de
     * mostrar peso e IMC (filtrado no servidor). Fora de `livres` no gatilho paciente_colunas (0085): a sessão de paciente não muda.
     */
    pesoOcultoNoAppEm: timestamp('peso_oculto_no_app_em', { withTimezone: true }),
```

- [ ] **Step 5: A migration (gerada)**

```bash
pnpm drizzle-kit generate --name app_paciente_g
cat drizzle/0106_app_paciente_g.sql
```

Esperado (a ordem das linhas pode variar): `ALTER TABLE "diary_entries" ADD COLUMN "resposta" text`, `ADD COLUMN "refeicao_do_plano" text`, `ALTER TABLE "patients" ADD COLUMN "peso_oculto_no_app_em" timestamp with time zone`, `ALTER TABLE "diary_entries" DROP CONSTRAINT "diary_entries_tem_conteudo"` e os quatro `ADD CONSTRAINT … CHECK`. **Conferir:** nenhum `DROP COLUMN`, nenhum dado mexido, nenhum `DISABLE TRIGGER` (NGS1.07.01); as linhas antigas passam nos CHECKs novos (todas têm `resposta` nula). Se o `drizzle-kit` não gerar o `DROP`/`ADD` do CHECK refeito, acrescentar à mão no fim do mesmo arquivo:

```sql
--> statement-breakpoint
ALTER TABLE "diary_entries" DROP CONSTRAINT "diary_entries_tem_conteudo";--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_tem_conteudo" CHECK ("diary_entries"."texto" is not null or "diary_entries"."foto_status" <> 'sem_foto' or "diary_entries"."resposta" = 'como_no_plano');
```

Aplicar no banco de testes local com o role do migrator (o Testcontainers do `pnpm test` já roda as migrations no `global-setup`).

- [ ] **Step 6: A fábrica do isolamento e o helper do plano**

Em `test/isolamento.test.ts`, a fábrica de `diary_entries` passa a cobrir as colunas novas (uma resposta "Comi assim" sem texto):

```ts
  diary_entries: (t, p) => sql`insert into diary_entries (tenant_id, patient_id, refeicao, resposta, refeicao_do_plano) values (${t}, ${p}, 'Almoço', 'como_no_plano', 'Almoço · 12:30')`,
```

Criar `test/plano.ts` (helper que a T6, a T7, a T9 e a T11 usam; tira a repetição de `src/modules/portal/plano.test.ts`):

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import type { TenantDeTeste } from './pacientes';

/** `itens[].substitui` = índice do item principal que este substitui (US-024). Todos com o alimento 3 da TACO. */
export type RefeicaoDeTeste = { nome: string; horario: string; observacao?: string; itens?: { gramas: number; substitui?: number }[] };

/**
 * Plano publicado pela nutricionista (US-022/US-025), pelos serviços de verdade (rascunho → publicar). A publicação troca o
 * status no lugar (os ids das refeições ficam) e enfileira o PDF: quem usa precisa de stopBoss() + closeDb() no afterAll.
 */
export async function planoPublicado(
  db: Db,
  T: TenantDeTeste,
  patientId: string,
  o: { refeicoes?: RefeicaoDeTeste[]; mostrarCalorias?: boolean; orientacoes?: string } = {},
): Promise<{ planId: string; refeicoes: { id: string; nome: string; horario: string }[] }> {
  const refeicoes = o.refeicoes ?? [{ nome: 'Almoço', horario: '12:30' }];
  const { id } = await criarRascunho(T.ctx, patientId, { db });
  const [r] = await withTenant(T.ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, id)), db);
  const comIds = refeicoes.map((ref) => {
    const itens = ref.itens ?? [{ gramas: 100 }];
    const idsDosItens = itens.map(() => randomUUID());
    return {
      id: randomUUID(),
      nome: ref.nome,
      horario: ref.horario,
      observacao: ref.observacao ?? '',
      itens: itens.map((it, k) => ({
        id: idsDosItens[k],
        foodId: idTaco(3),
        quantidadeG: String(it.gramas),
        medida: null,
        substituiItemId: it.substitui === undefined ? null : idsDosItens[it.substitui],
      })),
    };
  });
  await salvarRascunho(
    T.ctx,
    id,
    { revisao: r.revisao, envio: randomUUID(), titulo: 'Plano de teste', metaKcal: '', mostrarCalorias: o.mostrarCalorias ?? false, orientacoes: o.orientacoes ?? '', refeicoes: comIds },
    { db },
  );
  await publicarPlano(T.ctx, patientId, id, { db });
  return { planId: id, refeicoes: comIds.map((x) => ({ id: x.id, nome: x.nome, horario: x.horario })) };
}
```

O `PatientRow` ganha um campo obrigatório no tipo: em `src/app/painel/pacientes/valores.test.ts`, o objeto `base` (`satisfies PatientRow`) ganha `pesoOcultoNoAppEm: null,` depois de `iaAvisoEnviadoEm: null,` (é o único literal tipado de `patients` no repositório, conferido em 08/10/2026; o `pnpm typecheck` acha outro, se aparecer).

- [ ] **Step 7: Rodar e conferir as guardas**

```bash
pnpm vitest run src/db/app-paciente-schema.test.ts src/modules/portal/diario-constantes.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/db/paciente-escrita.test.ts test/isolamento.test.ts src/modules/portal/diario.test.ts
pnpm typecheck && pnpm lint
```

Expected: PASS (as guardas não mudam: nenhuma tabela nova; o isolamento cobre a fábrica nova).

- [ ] **Step 8: Commit**

```bash
git add drizzle/ src/db/schema/portal.ts src/db/schema/pacientes.ts src/db/app-paciente-schema.test.ts src/modules/portal/diario-constantes.ts src/modules/portal/diario-constantes.test.ts test/isolamento.test.ts test/plano.ts src/app/painel/pacientes/valores.test.ts
git commit -m "$(cat <<'MSG'
feat(banco): respostas no diário e "Não mostrar peso no app" (P16-01)

Colunas diary_entries.resposta e refeicao_do_plano com os CHECKs da spec G §9
(tem_conteudo refeito) e patients.peso_oculto_no_app_em, fora de livres no
gatilho paciente_colunas. Constantes das respostas e helper planoPublicado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 2: Tema do portal — `corDaFaixa`, tokens novos e as fontes (P16-02)

**Revisão: leve (revisor-interface)** — contraste (RNF-192), tokens escopados (C-193), fontes servidas pelo app (RNF-193). O revisor confere também a medida dos `woff2` e o tamanho da imagem no CI.

**Files:**
- Create: `src/app/p/fontes.ts`, `e2e/fontes-portal.spec.ts`
- Modify: `src/lib/tema/marca-tema.ts`, `src/lib/tema/tokens.ts`, `src/lib/tema/tema.test.ts`, `src/app/globals.css`, `src/app/painel/cores.test.ts` (tokens de borda), `src/app/p/layout.tsx` (só as classes das fontes e o `data-app`)

**Interfaces:**
- Consumes: `contraste`, `misturar`, `luminancia` (`src/lib/tema/contraste.ts`), `TOKENS`, `PARES` (`tokens.ts`), `COR_PADRAO` (`src/modules/plataforma/marca-constantes.ts`), `entrarComo` (`e2e/helpers.ts`), `E2E_MULTI` (o seed: `multi-e2e@nutridebby.test`).
- Produces: `corDaFaixa`, `VERDE_CLARO_PORTAL`, `OPACIDADE_CARTAO_FAIXA`; `TOKENS_PORTAL`, `TokenPortal`, `PARES_PORTAL`; as variáveis `--nd-faixa` (cor da faixa, posta pelo layout na T4), `--nd-p-clara`, `--nd-p-marco`, `--nd-p-marco-texto`; as classes `bg-faixa`, `text-faixa`, `bg-faixa-cartao`, `bg-p-clara`, `bg-p-marco`, `text-p-marco-texto`, `border-p-marco-texto`, `font-portal`, `font-portal-titulo`; `redHat` e `atkinson` (`src/app/p/fontes.ts`).

- [ ] **Step 1: Testes (falham)**

Em `src/lib/tema/tema.test.ts`, trocar os imports do topo para incluir o que é novo:

```ts
import { contraste, luminancia, misturar } from './contraste';
import { corDaFaixa, corNoEscuro, OPACIDADE_CARTAO_FAIXA, VERDE_CLARO_PORTAL } from './marca-tema';
import { PARES, PARES_PORTAL, TOKENS, TOKENS_PORTAL, type Token } from './tokens';
```

e acrescentar no fim do arquivo:

```ts
describe('portal do paciente: tokens novos e a cor da faixa (Plano 16, §4.7, RNF-192)', () => {
  const todos: Record<string, readonly [string, string]> = { ...TOKENS, ...TOKENS_PORTAL };
  it.each(PARES_PORTAL.flatMap((p) => [0, 1].map((m) => [p.texto, p.fundo, m === 0 ? 'claro' : 'escuro', p.minimo, m] as const)))(
    '%s sobre %s no modo %s: contraste ≥ %d',
    (texto, fundo, _modo, minimo, m) => {
      expect(contraste(todos[texto][m], todos[fundo][m])).toBeGreaterThanOrEqual(minimo);
    },
  );

  it('o marco âmbar sozinho some contra o fundo claro (1,55:1): por isso leva contorno de 2 px no token do texto (WCAG 1.4.11)', () => {
    expect(contraste(TOKENS_PORTAL['p-marco'][0], TOKENS.fundo[0])).toBeLessThan(3);
    expect(contraste(TOKENS_PORTAL['p-marco-texto'][0], TOKENS.fundo[0])).toBeGreaterThanOrEqual(3);
    expect(contraste(TOKENS.texto[1], TOKENS.fundo[1])).toBeGreaterThanOrEqual(3);
  });

  it('o globals.css declara os tokens do portal só em [data-app=paciente] (o painel não muda, C-193), claro e com o aparelho escuro', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const bloco = (inicio: string) => {
      const i = css.indexOf(inicio);
      expect(i, inicio).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    const claro = bloco("[data-app='paciente'] {");
    const escuro = bloco("[data-app='paciente'][data-tema='sistema'] {");
    for (const [nome, [c, e]] of Object.entries(TOKENS_PORTAL)) {
      expect(claro, `${nome} claro`).toContain(`--nd-${nome}: ${c};`);
      expect(escuro, `${nome} escuro`).toContain(`--nd-${nome}: ${e};`);
    }
    // o bloco escuro fica dentro do @media do aparelho escuro (o portal segue o aparelho, P08 D18)
    expect(css.indexOf("[data-app='paciente'][data-tema='sistema'] {")).toBeGreaterThan(css.lastIndexOf('@media (prefers-color-scheme: dark) {'));
    expect(css).toContain(`--color-faixa-cartao: rgb(226 239 233 / ${OPACIDADE_CARTAO_FAIXA});`);
    expect(VERDE_CLARO_PORTAL).toBe(TOKENS_PORTAL['p-clara'][0]);
  });

  it('corDaFaixa: a cor padrão não muda; a cor no limite (#767676, 4,54:1) escurece até o branco passar também no cartão translúcido', () => {
    expect(corDaFaixa(COR_PADRAO)).toBe(COR_PADRAO);
    // o problema que a spec mediu: branco sobre o cartão (verde claro a 16%) da cor no limite = 3,52:1
    expect(contraste('#ffffff', misturar('#767676', VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA))).toBeLessThan(4.5);
    const c = corDaFaixa('#767676');
    expect(c).not.toBe('#767676');
    expect(contraste('#ffffff', misturar(c, VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA))).toBeGreaterThanOrEqual(4.5);
  });

  const rnd = mulberry32(2026);
  const aceitas = Array.from({ length: 3000 }, () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`).filter((c) => contraste(c, '#ffffff') >= 4.5);
  it('propriedade: para toda cor aceita pelo perfil (≥ 4,5 com o branco), o branco passa na faixa e no cartão, a pílula (cor da faixa sobre branco) passa, e a cor só escurece', () => {
    expect(aceitas.length).toBeGreaterThan(500);
    for (const c of [...aceitas, COR_PADRAO]) {
      const f = corDaFaixa(c);
      expect(contraste('#ffffff', f), `${c} → ${f}`).toBeGreaterThanOrEqual(4.5);
      expect(contraste('#ffffff', misturar(f, VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA)), `${c} → ${f} (cartão)`).toBeGreaterThanOrEqual(4.5);
      // no aparelho escuro o cartão usa o mesmo verde claro a 16% (a cor da faixa não muda com o modo): mesma conta
      expect(luminancia(f)).toBeLessThanOrEqual(luminancia(c) + 1e-9);
    }
  });
});
```

Criar `e2e/fontes-portal.spec.ts` (RNF-193; IP do bloco do Plano 16, `10.9.26.x`):

```ts
import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

// Plano 16 (RNF-193, D9): as fontes do portal são servidas pelo app (CSP font-src 'self', sem Google) e o primeiro
// carregamento de uma página de /p baixa no máximo 160 KB de woff2. /p/escolher usa o layout de /p (as fontes do portal)
// e é a primeira tela da conta com três consultórios do seed (E2E_MULTI).
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' };

test('fontes do portal: só do próprio app e até 160 KB de woff2 no primeiro carregamento (RNF-193)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.26.1');
  await expect(page).toHaveURL(/\/p\/escolher/);
  const fontes: { url: string; bytes: number }[] = [];
  page.on('response', async (r) => {
    if (/\.woff2(\?|$)/.test(r.url())) fontes.push({ url: r.url(), bytes: (await r.body()).length });
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(fontes.length, 'o portal carrega as fontes').toBeGreaterThan(0);
  for (const f of fontes) expect(new URL(f.url).origin, f.url).toBe(new URL(page.url()).origin);
  const total = fontes.reduce((s, f) => s + f.bytes, 0);
  console.log(`woff2 no primeiro carregamento de /p/escolher: ${(total / 1024).toFixed(1)} KB em ${fontes.length} arquivo(s)`);
  expect(total).toBeLessThanOrEqual(160 * 1024);
  await page.context().close();
});
```

Run: `pnpm vitest run src/lib/tema/tema.test.ts` → FAIL (`corDaFaixa`, `TOKENS_PORTAL` não existem).

- [ ] **Step 2: `corDaFaixa` e os tokens**

Em `src/lib/tema/marca-tema.ts`, acrescentar no fim:

```ts
/** Plano 16 (§4.7): o verde claro do portal (token p-clara, claro) e a opacidade do cartão translúcido da mini-jornada na faixa. */
export const VERDE_CLARO_PORTAL = '#e2efe9';
export const OPACIDADE_CARTAO_FAIXA = 0.16;

/**
 * Plano 16 (RN-207, G-D7 ★ = a): a cor da faixa do portal. A cor do consultório já tem ≥ 4,5:1 com o branco (perfilSchema),
 * mas na faixa o texto branco também fica sobre o cartão translúcido (verde claro a 16%), que clareia o fundo — com a cor no
 * limite (#767676) cai para 3,52:1. Escurece com preto em passos de 2% até o branco passar nos dois; a cor padrão não muda.
 * Só a faixa e os cabeçalhos do portal usam (--nd-faixa); botões e links continuam com a cor do consultório.
 */
export function corDaFaixa(cor: string): string {
  for (let i = 0; i <= 50; i++) {
    const c = misturar(cor, '#000000', i / 50);
    if (contraste('#ffffff', c) >= 4.5 && contraste('#ffffff', misturar(c, VERDE_CLARO_PORTAL, OPACIDADE_CARTAO_FAIXA)) >= 4.5) return c;
  }
  return '#000000';
}
```

Em `src/lib/tema/tokens.ts`, acrescentar no fim:

```ts
/**
 * Plano 16 (§4.7, D8): tokens só do portal do paciente ([data-app='paciente']), [claro, escuro]. Fundo, texto, suave,
 * cartão e borda do portal são os de TOKENS (os valores claros da spec são os mesmos). `p-marco-texto` é escuro nos dois
 * modos: no escuro o token `texto` é claro e reprovaria sobre o âmbar.
 */
export const TOKENS_PORTAL = {
  'p-clara': ['#e2efe9', '#1f3a31'],
  'p-marco': ['#f0b867', '#f0b867'],
  'p-marco-texto': ['#14211d', '#14211d'],
} as const satisfies Record<string, readonly [string, string]>;

export type TokenPortal = keyof typeof TOKENS_PORTAL;

/** Pares do portal: balão do paciente (texto e hora sobre p-clara), chip/marco âmbar, contorno do marco contra o fundo (1.4.11). */
export const PARES_PORTAL: readonly { texto: Token | TokenPortal; fundo: Token | TokenPortal; minimo: number }[] = [
  { texto: 'texto', fundo: 'p-clara', minimo: 4.5 },
  { texto: 'suave', fundo: 'p-clara', minimo: 4.5 },
  { texto: 'link', fundo: 'p-clara', minimo: 4.5 },
  { texto: 'p-marco-texto', fundo: 'p-marco', minimo: 4.5 },
  { texto: 'texto', fundo: 'fundo', minimo: 3 },
];
```

- [ ] **Step 3: CSS (tokens, utilitários e fontes)**

Em `src/app/globals.css`, logo **depois** do bloco `[data-sobre-marca] { --nd-foco: #ffffff; }`, acrescentar:

```css
/* Plano 16 (§4.7, C-193): tokens do portal do paciente — só dentro de [data-app='paciente'] (o painel não muda). Os
   outros tokens do portal são os gerais (fundo, cartão, texto, suave, borda). Valores conferidos em tema.test.ts. */
[data-app='paciente'] {
  --nd-p-clara: #e2efe9;
  --nd-p-marco: #f0b867;
  --nd-p-marco-texto: #14211d;
}
@media (prefers-color-scheme: dark) {
  [data-app='paciente'][data-tema='sistema'] {
    --nd-p-clara: #1f3a31;
    --nd-p-marco: #f0b867;
    --nd-p-marco-texto: #14211d;
  }
}
```

E, dentro de `@theme inline { … }`, depois de `--color-destaque`:

```css
  /* Plano 16: a faixa do portal (corDaFaixa da cor do consultório, posta pelo layout em --nd-faixa) e o cartão translúcido
     sobre ela (verde claro a 16%: a conta de corDaFaixa usa os mesmos números) */
  --color-faixa: var(--nd-faixa, #1d6b5a);
  --color-faixa-cartao: rgb(226 239 233 / 0.16);
  --color-p-clara: var(--nd-p-clara);
  --color-p-marco: var(--nd-p-marco);
  --color-p-marco-texto: var(--nd-p-marco-texto);
  --font-portal: var(--font-atkinson), system-ui, sans-serif;
  --font-portal-titulo: var(--font-redhat), var(--font-atkinson), system-ui, sans-serif;
```

Em `src/app/painel/cores.test.ts`, a lista de tokens de borda ganha os do portal (mais longo antes do mais curto, por causa da alternância do regex):

```ts
const TOKENS_DE_BORDA = 'campo|borda|transparent|marca|destaque|erro|aviso|ok|linha|current|white|p-marco-texto|p-marco|faixa';
```

- [ ] **Step 4: As fontes**

Criar `src/app/p/fontes.ts`:

```ts
import { Atkinson_Hyperlegible_Next, Red_Hat_Display } from 'next/font/google';

/**
 * Plano 16 (RNF-193, D9): só no portal (aplicadas em src/app/p/layout.tsx). Baixadas no build e servidas pelo próprio app —
 * o navegador não fala com o Google (CSP font-src 'self', LGPD). Subconjunto latin; títulos e números em Red Hat Display,
 * texto em Atkinson Hyperlegible Next (alta legibilidade). Orçamento: 160 KB de woff2 no primeiro carregamento
 * (e2e/fontes-portal.spec.ts); se passar, `weight: 'variable'` nas duas.
 */
export const redHat = Red_Hat_Display({ variable: '--font-redhat', subsets: ['latin'], weight: ['700', '800', '900'], display: 'swap' });
export const atkinson = Atkinson_Hyperlegible_Next({ variable: '--font-atkinson', subsets: ['latin'], weight: ['400', '700'], display: 'swap' });
```

Em `src/app/p/layout.tsx`, importar `{ atkinson, redHat } from './fontes'` e trocar o contêiner (o cabeçalho com o "Sair" fica como está até a T4):

```tsx
    <div data-tema="sistema" data-app="paciente" className={`${redHat.variable} ${atkinson.variable} flex min-h-dvh flex-col bg-fundo font-portal text-texto`}>
```

- [ ] **Step 5: Rodar os testes, o build e medir**

```bash
pnpm vitest run src/lib/tema/tema.test.ts src/app/painel/cores.test.ts
pnpm typecheck && pnpm lint && pnpm build
pnpm playwright test e2e/fontes-portal.spec.ts
```

Expected: PASS; o `console.log` do E2E mostra o total de `woff2`. **Se passar de 160 KB:** trocar `weight: [...]` por `weight: 'variable'` nas duas fontes e medir de novo; se ainda passar, **parar e perguntar ao dono** (as opções são tirar o `preload` das fontes do painel, que também carregam no portal, ou aceitar o número — nenhuma é desta tarefa). Anotar o número no PR e no capítulo 05 do manual (T16).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tema/ src/app/globals.css src/app/painel/cores.test.ts src/app/p/fontes.ts src/app/p/layout.tsx e2e/fontes-portal.spec.ts
git commit -m "$(cat <<'MSG'
feat(portal): cor da faixa, tokens e fontes do layout G (P16-02)

corDaFaixa escurece a cor do consultório só o necessário para o texto branco
passar de 4,5:1 na faixa e no cartão translúcido (teste de propriedade).
Tokens do portal escopados em [data-app=paciente]; Red Hat Display e Atkinson
Hyperlegible Next por next/font, subconjunto latin, medidas no E2E.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 3: Navegação — as cinco seções, o que cada rota marca e a seção "Exames" condicional (P16-03)

**Revisão: leve (revisor-interface)**; a função `temEnvioVisivel` (leitura de `exam_submissions` pela sessão do paciente, sem `auditRead`) passa também por **uma rodada do revisor-rls**.

**Files:**
- Modify: `src/app/p/navegacao.ts`, `src/app/p/navegacao.test.ts`, `src/modules/portal/exames-enviados.ts` (função nova no fim), `src/modules/portal/exames-enviados.test.ts`

**Interfaces:**
- Consumes: `examSubmissions`, `pacienteDaSessao`, `withTenant`; `envioNoBanco` (`test/exames-enviados.ts`).
- Produces: `SecaoPortal`, `SECOES_DO_PORTAL`, `secoesDoPortal`, `itemAtual`, `secaoDe`; `temEnvioVisivel`. **Sai** `ITENS_DO_PORTAL` (o único consumidor, `nav-portal.tsx`, sai na T4 — até lá ele importa `SECOES_DO_PORTAL`; ver Step 3).

- [ ] **Step 1: Testes (falham)**

Trocar o conteúdo de `src/app/p/navegacao.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemAtual, secaoDe, SECOES_DO_PORTAL, secoesDoPortal } from './navegacao';

const ID = '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';

/** Toda página de /p/(portal) como rota ([id] vira um uuid; o grupo (portal) some da URL). */
function rotasDoPortal(): string[] {
  const raiz = join(process.cwd(), 'src/app/p/(portal)');
  return (readdirSync(raiz, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((f) => f === 'page.tsx' || f.endsWith(`${sep}page.tsx`))
    .map((f) => `/p/${f.split(sep).slice(0, -1).join('/')}`.replace(/\[[^\]]+\]/g, ID).replace(/\/$/, ''))
    .sort();
}

describe('seções do portal (Plano 16, RN-190, §4.1)', () => {
  it('cinco seções, nessa ordem, todas dentro do escopo /p/ do PWA; a única rota de seção nova é /p/jornada', () => {
    expect(SECOES_DO_PORTAL.map((s) => [s.rotulo, s.href])).toEqual([
      ['Hoje', '/p/inicio'],
      ['Jornada', '/p/jornada'],
      ['Plano', '/p/plano'],
      ['Exames', '/p/exames'],
      ['Eu', '/p/perfil'],
    ]);
  });

  it('a tabela da §4.1: o que cada rota marca (as URLs antigas continuam, C-195)', () => {
    const casos: [string, string][] = [
      ['/p/inicio', '/p/inicio'],
      ['/p/diario', '/p/inicio'],
      ['/p/jornada', '/p/jornada'],
      ['/p/evolucao', '/p/jornada'],
      ['/p/agenda', '/p/jornada'],
      ['/p/agenda/nova', '/p/jornada'],
      [`/p/agenda/${ID}`, '/p/jornada'],
      ['/p/plano', '/p/plano'],
      [`/p/plano/refeicao/${ID}`, '/p/plano'],
      ['/p/compras', '/p/plano'],
      ['/p/conteudos', '/p/plano'], // G-D8 ★ = a
      [`/p/conteudos/${ID}`, '/p/plano'],
      ['/p/exames', '/p/exames'],
      ['/p/perfil', '/p/perfil'],
      ['/p/documentos', '/p/perfil'],
      [`/p/meus-dados/exportacoes/${ID}`, '/p/perfil'],
      ['/p/ajuda', '/p/perfil'],
    ];
    for (const [rota, secao] of casos) expect(itemAtual(rota), rota).toBe(secao);
    expect(itemAtual('/p/iniciozinho')).toBeNull();
    expect(itemAtual('/p/escolher')).toBeNull(); // fora do layout do portal
    expect(secaoDe('/p/compras')?.rotulo).toBe('Plano');
  });

  it('RN-191: toda página de /p/(portal) marca exatamente uma seção (uma rota nova sem `tambem` quebra aqui)', () => {
    const rotas = rotasDoPortal();
    expect(rotas.length).toBeGreaterThan(10);
    for (const rota of rotas) {
      const marcam = SECOES_DO_PORTAL.filter((s) => [s.href, ...s.tambem].some((h) => rota === h || rota.startsWith(`${h}/`)));
      expect(marcam.map((s) => s.rotulo), rota).toHaveLength(1);
    }
  });

  it('RN-192 (G-D9 ★ = a): sem o recebimento de exames e sem envio, quatro seções — "Exames" some', () => {
    expect(secoesDoPortal({ exames: true }).map((s) => s.rotulo)).toEqual(['Hoje', 'Jornada', 'Plano', 'Exames', 'Eu']);
    expect(secoesDoPortal({ exames: false }).map((s) => s.rotulo)).toEqual(['Hoje', 'Jornada', 'Plano', 'Eu']);
  });
});
```

No fim de `src/modules/portal/exames-enviados.test.ts`, acrescentar (o arquivo já importa `envioNoBanco`, `novoTenant`, `novoPaciente`, `ctxPaciente` e `app`; conferir os nomes no topo):

```ts
describe('temEnvioVisivel (Plano 16, RN-192)', () => {
  it('false sem envio ou só com cancelado; true com qualquer outro; nunca enxerga o envio de outro paciente', async () => {
    const T = await novoTenant(app.db);
    const [p, outro] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await temEnvioVisivel(ctx, app.db)).toBe(false);
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido' });
    expect(await temEnvioVisivel(ctx, app.db)).toBe(false);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    expect(await temEnvioVisivel(ctx, app.db)).toBe(false);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado' });
    expect(await temEnvioVisivel(ctx, app.db)).toBe(true);
  });

  it('só em sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await expect(temEnvioVisivel(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
```

(Importar `temEnvioVisivel` junto dos outros nomes de `./exames-enviados`.)

Run: `pnpm vitest run src/app/p/navegacao.test.ts src/modules/portal/exames-enviados.test.ts` → FAIL.

- [ ] **Step 2: Implementação**

Trocar o conteúdo de `src/app/p/navegacao.ts`:

```ts
export type SecaoPortal = { href: string; rotulo: string; /** Outras telas que marcam esta seção (RN-191, §4.1). */ tambem: readonly string[] };

/**
 * Plano 16 (RN-190, §4.1): as cinco seções do layout G, nessa ordem, na faixa do topo (sai a barra de 7 abas do rodapé,
 * D23 do Plano 06). Nenhuma URL muda (C-195): as telas que não são seção marcam a seção pelo `tambem`. "Exames" só com o
 * recebimento ligado ou com envio (RN-192, G-D9 ★): `secoesDoPortal`. Conteúdos dentro de Plano (G-D8 ★ = a).
 */
export const SECOES_DO_PORTAL: readonly SecaoPortal[] = [
  { href: '/p/inicio', rotulo: 'Hoje', tambem: ['/p/diario'] },
  { href: '/p/jornada', rotulo: 'Jornada', tambem: ['/p/evolucao', '/p/agenda'] },
  { href: '/p/plano', rotulo: 'Plano', tambem: ['/p/compras', '/p/conteudos'] },
  { href: '/p/exames', rotulo: 'Exames', tambem: [] },
  { href: '/p/perfil', rotulo: 'Eu', tambem: ['/p/documentos', '/p/meus-dados', '/p/ajuda'] },
];

/** As seções que este paciente vê (RN-192): sem o recebimento e sem envio, "Exames" some (a rota continua abrindo pelo endereço). */
export function secoesDoPortal(o: { exames: boolean }): SecaoPortal[] {
  return SECOES_DO_PORTAL.filter((s) => s.href !== '/p/exames' || o.exames);
}

const dentro = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** A seção de uma rota do portal (também nas subpáginas e nas telas do `tambem`). */
export function secaoDe(pathname: string): SecaoPortal | null {
  return SECOES_DO_PORTAL.find((s) => dentro(pathname, s.href) || s.tambem.some((t) => dentro(pathname, t))) ?? null;
}

/** O `href` da seção marcada (aria-current) numa rota; null fora do portal. */
export function itemAtual(pathname: string): string | null {
  return secaoDe(pathname)?.href ?? null;
}
```

E, no fim de `src/modules/portal/exames-enviados.ts` (os imports `and`, `eq`, `ne`, `examSubmissions`, `withTenant`, `getDb` já existem no arquivo):

```ts
/**
 * Plano 16 (RN-192): o paciente da sessão tem envio não cancelado? Decide se a seção "Exames" aparece com o recebimento
 * desligado. Só a existência — nenhum dado do envio sai daqui —, sem auditRead (como as contagens do painel).
 */
export async function temEnvioVisivel(ctx: TenantContext, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'temEnvioVisivel');
  const r = await withTenant(
    ctx,
    (tx) => tx.select({ id: examSubmissions.id }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado'))).limit(1),
    db,
  );
  return r.length > 0;
}
```

- [ ] **Step 3: O consumidor antigo continua compilando até a T4**

Em `src/app/p/nav-portal.tsx` (sai inteiro na T4), trocar `ITENS_DO_PORTAL` por `SECOES_DO_PORTAL` no import e no `map` (a barra mostra as cinco seções por enquanto; `grid-cols-7` vira `grid-cols-5`). Conferir com `git grep -n ITENS_DO_PORTAL` que não sobra uso.

- [ ] **Step 4: Rodar e commitar**

```bash
pnpm vitest run src/app/p/navegacao.test.ts src/modules/portal/exames-enviados.test.ts
pnpm typecheck && pnpm lint
git add src/app/p/navegacao.ts src/app/p/navegacao.test.ts src/app/p/nav-portal.tsx src/modules/portal/exames-enviados.ts src/modules/portal/exames-enviados.test.ts
git commit -m "$(cat <<'MSG'
feat(portal): as cinco seções do layout G e a seção Exames condicional (P16-03)

SECOES_DO_PORTAL com o tambem da §4.1 (as URLs antigas continuam e marcam a
seção certa), teste que toda página de /p/(portal) marca exatamente uma seção
(RN-191) e temEnvioVisivel para a seção Exames (RN-192).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 4: Moldura — faixa, seções, cabeçalho de detalhe, barra de ações, "Sair" em Eu e o cabeçalho de todas as páginas (P16-04)

**Revisão: leve (revisor-interface)** — marcos de região, alvo de toque, foco sobre a faixa, 320 px, texto da moldura, "Voltar".

**Files:**
- Create: `src/components/portal/textos.ts`, `src/components/portal/faixa.tsx`, `src/components/portal/nav-secoes.tsx`, `src/components/portal/cabecalho-detalhe.tsx`, `src/components/portal/voltar.tsx`, `src/components/portal/focar-titulo.tsx`, `src/components/portal/barra-de-acoes.tsx`, `src/components/portal/cabecalho-sair.tsx`, `src/components/portal/moldura.test.ts`, `src/app/p/moldura.ts`, `src/app/p/(portal)/jornada/page.tsx` (esqueleto; a T12 completa)
- Modify: `src/app/p/layout.tsx`, `src/app/p/(portal)/layout.tsx`, `src/modules/portal/perfil.ts` (+ `perfil.test.ts`), todas as `page.tsx` de `src/app/p/(portal)` (cabeçalho), `src/app/p/termo/page.tsx`, `src/app/p/escolher/page.tsx`, `src/app/p/sem-acesso/page.tsx`, `src/app/p/(portal)/plano/page.test.ts`, `src/app/p/(portal)/exames/page.test.ts`, `src/app/painel/cores.test.ts` (o teste da marca no portal e a exceção do `bg-white`), `e2e/portal.spec.ts`, `e2e/acessibilidade.spec.ts`, `e2e/exames-enviados.spec.ts`, `e2e/pacientes.spec.ts`
- Delete: `src/app/p/nav-portal.tsx`

**Interfaces:**
- Consumes: T2 (`corDaFaixa`, classes `bg-faixa`, `text-faixa`, `font-portal-titulo`), T3 (`SecaoPortal`, `secoesDoPortal`, `temEnvioVisivel`), T5 (`dataDaFaixa`); `getTenantBrand`, `MarcaTenant` (`src/modules/plataforma/marca.ts`), `SeloOffline`, `SairPortal`, `DonoDoAparelho`, `RegistrarAcesso`, `requirePaciente`, `PacienteAccess`, `hojeNoFuso`.
- Produces: `Faixa`, `NavSecoes`, `CabecalhoDetalhe`, `Voltar`, `FocarTitulo`, `BarraDeAcoes`, `CabecalhoSair`, `MSG_G`, `molduraDaSecao`, `primeiroNome`, `primeiroNomeDoPaciente`; os atributos `data-guia="faixa"`, `data-guia="acoes"`, `data-guia="secao-eu"` (usados pelo tour da T14); o `id="titulo-da-tela"` do h1 das telas de detalhe.

- [ ] **Step 1: Testes da moldura e do nome (falham)**

Criar `src/components/portal/moldura.test.ts` (os testes do projeto são `.ts`, sem JSX: `createElement`):

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { secoesDoPortal } from '@/app/p/navegacao';
import { BarraDeAcoes } from './barra-de-acoes';
import { CabecalhoDetalhe } from './cabecalho-detalhe';
import { Faixa } from './faixa';

const MARCA = { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: '/api/arquivos?x=1' };

describe('moldura do portal (Plano 16, §4.2)', () => {
  it('faixa: marca, h1 da seção, nav "Seções" com a atual marcada (aria-current + pílula), foco branco (data-sobre-marca)', () => {
    const html = renderToStaticMarkup(createElement(Faixa, { marca: MARCA, titulo: 'Plano de hoje', secoes: secoesDoPortal({ exames: true }), atual: '/p/plano' }));
    // (o React 19 põe um <link rel="preload"> do logo antes: sem âncora no começo)
    expect(html).toMatch(/<header data-sobre-marca="" data-guia="faixa" class="[^"]*\bbg-faixa\b[^"]*\btext-white\b/);
    expect(html).toContain('Acompanhamento com Consultório Debby');
    expect(html).toContain('alt="Logo de Consultório Debby"');
    expect(html).toMatch(/<h1[^>]*>Plano de hoje<\/h1>/);
    expect(html).toContain('<nav aria-label="Seções"');
    expect(html).toMatch(/<ul class="[^"]*\bgrid-cols-5\b/);
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/p\/plano"|<a [^>]*href="\/p\/plano"[^>]*aria-current="page"/);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-guia="secao-eu"');
    expect(html).toMatch(/<\/header><p role="status"/); // o SeloOffline logo depois da faixa (região viva sempre montada)
  });

  it('quatro seções sem "Exames" (RN-192): grade de 4 colunas', () => {
    const html = renderToStaticMarkup(createElement(Faixa, { marca: MARCA, titulo: 'Eu', secoes: secoesDoPortal({ exames: false }), atual: '/p/perfil' }));
    expect(html).toMatch(/<ul class="[^"]*\bgrid-cols-4\b/);
    expect(html).not.toContain('>Exames<');
  });

  it('tela de detalhe: "Voltar" de 44 px com nome acessível e o h1 focável, sem a lista de seções', () => {
    const html = renderToStaticMarkup(createElement(CabecalhoDetalhe, { titulo: 'Minhas consultas', voltar: { href: '/p/jornada', secao: 'Jornada' } }));
    expect(html).toMatch(/<a [^>]*aria-label="Voltar para Jornada"/);
    expect(html).toContain('href="/p/jornada"');
    expect(html).toMatch(/<a [^>]*class="[^"]*\bsize-11\b/);
    expect(html).toMatch(/<h1 id="titulo-da-tela" tabindex="-1"[^>]*>Minhas consultas<\/h1>/);
    expect(html).not.toContain('aria-label="Seções"');
  });

  it('barra de ações (só em Hoje): "Enviar exame" só com o recebimento ligado (RN-215); "Agendar" leva a Minhas consultas no teto', () => {
    const com = renderToStaticMarkup(createElement(BarraDeAcoes, { exames: true, podeAgendar: true }));
    expect(com).toContain('<nav aria-label="Ações" data-guia="acoes"');
    expect(com).toMatch(/href="\/p\/diario\?foto=1#registrar"[^>]*>.*Foto da refeição/);
    expect(com).toMatch(/href="\/p\/exames#enviar"[^>]*>.*Enviar exame/);
    expect(com).toMatch(/href="\/p\/agenda\/nova"[^>]*>.*Agendar/);
    const sem = renderToStaticMarkup(createElement(BarraDeAcoes, { exames: false, podeAgendar: false }));
    expect(sem).not.toContain('Enviar exame');
    expect(sem).toMatch(/href="\/p\/agenda"[^>]*>.*Agendar/);
  });
});
```

Em `src/modules/portal/perfil.test.ts`, acrescentar (o arquivo já tem `app`, `novoTenant`, `novoPaciente`, `ctxPaciente`; conferir os imports no topo):

```ts
describe('primeiro nome para a saudação (Plano 16, RN-218)', () => {
  it('até o primeiro espaço, sem espaços nas pontas; vazio continua vazio', () => {
    expect(primeiroNome('  Marina  Souza ')).toBe('Marina');
    expect(primeiroNome('Ana')).toBe('Ana');
    expect(primeiroNome('')).toBe('');
  });
  it('lê o nome do próprio prontuário pela sessão do paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Marina Souza' });
    expect(await primeiroNomeDoPaciente(ctxPaciente(T.tenantId, p.id), app.db)).toBe('Marina');
  });
});
```

Run: `pnpm vitest run src/components/portal/moldura.test.ts src/modules/portal/perfil.test.ts` → FAIL.

- [ ] **Step 2: Textos e componentes**

Criar `src/components/portal/textos.ts`:

```ts
/** Plano 16: textos da moldura do portal (RN-216). Rascunho até a Debby revisar (G-D10 ★). */
export const MSG_G = {
  acompanhamento: (nome: string) => `Acompanhamento com ${nome}`,
  logo: (nome: string) => `Logo de ${nome}`,
  voltarPara: (secao: string) => `Voltar para ${secao}`,
  navSecoes: 'Seções',
  navAcoes: 'Ações',
  titulos: { hoje: (nome: string) => (nome ? `Olá, ${nome}` : 'Olá'), jornada: 'Sua jornada', plano: 'Plano de hoje', exames: 'Meus exames', eu: 'Eu' },
  acoes: { foto: 'Foto da refeição', exame: 'Enviar exame', agendar: 'Agendar' },
} as const;
```

Criar `src/components/portal/nav-secoes.tsx`:

```tsx
import Link from 'next/link';
import type { SecaoPortal } from '@/app/p/navegacao';
import { MSG_G } from './textos';

/**
 * Plano 16 (§4.2, RN-190): as seções na faixa. Colunas IGUAIS (5, ou 4 sem "Exames", RN-192), alvo de 44 px, a palavra que
 * não cabe quebra com hífen (como a barra antiga, regra ratificada pelo dono em 04/10/2026): nunca rola na horizontal. A
 * seção atual: pílula branca com o texto na cor da faixa + aria-current (o estado não depende só de cor). Sem JavaScript:
 * a página diz qual é a atual.
 */
export function NavSecoes({ secoes, atual }: { secoes: readonly SecaoPortal[]; atual: string }) {
  return (
    <nav aria-label={MSG_G.navSecoes} className="mt-3">
      <ul className={`grid gap-1 ${secoes.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {secoes.map((s) => (
          <li key={s.href} className="min-w-0">
            <Link
              href={s.href}
              aria-current={s.href === atual ? 'page' : undefined}
              data-guia={s.href === '/p/perfil' ? 'secao-eu' : undefined}
              className="flex min-h-11 items-center justify-center rounded-full px-1 text-center text-sm font-bold text-white hyphens-auto wrap-break-word aria-[current=page]:bg-white aria-[current=page]:text-faixa"
            >
              {s.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

Criar `src/components/portal/faixa.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { SecaoPortal } from '@/app/p/navegacao';
import { SeloOffline } from '@/app/p/selo-offline';
import type { MarcaTenant } from '@/modules/plataforma/marca';
import { NavSecoes } from './nav-secoes';
import { MSG_G } from './textos';

/**
 * Plano 16 (§4.2, D10, RN-207): a faixa do topo de cada seção, na cor da faixa (corDaFaixa da cor do consultório, posta
 * pelo layout em --nd-faixa), texto sempre branco, nenhum texto em verde claro. Linha 1: logo e "Acompanhamento com
 * {consultório}" (US-005; diz o consultório a quem tem mais de um vínculo, RN-210). Depois o h1 da seção, o que a página
 * põe dentro (a mini-jornada em Hoje) e as seções. data-sobre-marca: foco branco (globals.css). Servidor, sem JavaScript.
 */
export function Faixa({ marca, titulo, subtitulo, secoes, atual, children }: { marca: MarcaTenant; titulo: string; subtitulo?: string; secoes: readonly SecaoPortal[]; atual: string; children?: ReactNode }) {
  return (
    <>
      <header data-sobre-marca="" data-guia="faixa" className="bg-faixa px-4 pb-3 pt-3 text-white">
        <p className="flex items-center gap-2 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, sem otimização do Next */}
          {marca.logoUrl && <img src={marca.logoUrl} alt={MSG_G.logo(marca.nome)} className="h-8 w-auto rounded bg-white p-1" />}
          <span>{MSG_G.acompanhamento(marca.nome)}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="font-portal-titulo text-2xl font-extrabold">{titulo}</h1>
          {subtitulo && <p className="text-sm">{subtitulo}</p>}
        </div>
        {children}
        <NavSecoes secoes={secoes} atual={atual} />
      </header>
      <SeloOffline />
    </>
  );
}
```

Criar `src/components/portal/voltar.tsx`:

```tsx
import Link from 'next/link';

/**
 * Plano 16 (§4.2, Desvio 13): "Voltar" das telas de detalhe — 44 × 44 px, nome acessível "Voltar para {destino}". Link
 * simples, de servidor, sem history.back(): o nome acessível diz exatamente para onde o toque leva. Com history.back(), as
 * telas que mudam a URL (filtros e busca de Conteúdos, `?dias=` da Lista de compras, `?semana=` de Agendar, o redirect da
 * consulta remarcada) e o histórico de outro site ou do /entrar levariam a outro lugar, e a tela de detalhe não tem a nav
 * "Seções" para sair da cadeia. O "voltar" do navegador e o gesto do aparelho continuam voltando pelo histórico.
 */
export function Voltar({ href, rotulo }: { href: string; rotulo: string }) {
  return (
    <Link
      href={href}
      aria-label={rotulo}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </Link>
  );
}
```

Criar `src/components/portal/focar-titulo.tsx`:

```tsx
'use client';
import { useEffect } from 'react';

/** RNF-191: ao abrir uma tela de detalhe, o foco vai para o título (o leitor de tela anuncia a tela nova). */
export function FocarTitulo() {
  useEffect(() => {
    document.getElementById('titulo-da-tela')?.focus({ preventScroll: true });
  }, []);
  return null;
}
```

Criar `src/components/portal/cabecalho-detalhe.tsx`:

```tsx
import { SeloOffline } from '@/app/p/selo-offline';
import { FocarTitulo } from './focar-titulo';
import { MSG_G } from './textos';
import { Voltar } from './voltar';

/** Plano 16 (§4.2): cabeçalho compacto das telas de detalhe — "Voltar" e o título, sem a lista de seções (a seção continua marcada para quem volta). */
export function CabecalhoDetalhe({ titulo, voltar }: { titulo: string; voltar: { href: string; secao: string } }) {
  return (
    <>
      <header data-sobre-marca="" className="flex items-center gap-1 bg-faixa px-2 py-2 text-white">
        <Voltar href={voltar.href} rotulo={MSG_G.voltarPara(voltar.secao)} />
        <h1 id="titulo-da-tela" tabIndex={-1} className="font-portal-titulo text-xl font-extrabold">
          {titulo}
        </h1>
      </header>
      <SeloOffline />
      <FocarTitulo />
    </>
  );
}
```

Criar `src/components/portal/barra-de-acoes.tsx`:

```tsx
import Link from 'next/link';
import { MSG_G } from './textos';

/**
 * Plano 16 (§4.2): a barra de ações de Hoje, fixa embaixo. "Foto da refeição" abre o registro do diário com o campo da
 * câmera (Desvio 6); "Enviar exame" só com o recebimento ligado (RN-215); "Agendar" leva a "Minhas consultas" no teto de
 * consultas futuras (a tela já mostra o motivo).
 */
export function BarraDeAcoes({ exames, podeAgendar }: { exames: boolean; podeAgendar: boolean }) {
  const acoes = [
    { href: '/p/diario?foto=1#registrar', rotulo: MSG_G.acoes.foto },
    ...(exames ? [{ href: '/p/exames#enviar', rotulo: MSG_G.acoes.exame }] : []),
    { href: podeAgendar ? '/p/agenda/nova' : '/p/agenda', rotulo: MSG_G.acoes.agendar },
  ];
  return (
    <nav aria-label={MSG_G.navAcoes} data-guia="acoes" className="sticky bottom-0 border-t border-borda bg-cartao">
      <ul className={`grid ${acoes.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {acoes.map((a) => (
          <li key={a.href} className="min-w-0">
            <Link href={a.href} className="flex min-h-11 items-center justify-center px-1 py-2 text-center text-sm font-semibold text-link hyphens-auto wrap-break-word">
              {a.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

Criar `src/components/portal/cabecalho-sair.tsx`:

```tsx
import { SairPortal } from '@/app/p/sair-portal';

/** RN-211: nas páginas fora do layout do portal (/p/escolher, /p/sem-acesso, /p/termo) o "Sair" continua no topo. */
export function CabecalhoSair() {
  return (
    <header className="flex justify-end px-6 pt-4">
      <SairPortal />
    </header>
  );
}
```

Criar `src/app/p/moldura.ts`:

```ts
import 'server-only';
import type { PacienteAccess } from '@/lib/paciente-session';
import { getTenantBrand, type MarcaTenant } from '@/modules/plataforma/marca';
import { temEnvioVisivel } from '@/modules/portal/exames-enviados';
import { secoesDoPortal, type SecaoPortal } from './navegacao';

/** Plano 16 (D10, RN-192): o que a faixa de uma seção precisa — a marca e as seções que este paciente vê. */
export async function molduraDaSecao(a: Pick<PacienteAccess, 'tenant' | 'ctx'>): Promise<{ marca: MarcaTenant; secoes: SecaoPortal[] }> {
  const exames = Boolean(a.tenant.examesPacienteAtivadoEm) || (await temEnvioVisivel(a.ctx));
  return { marca: getTenantBrand(a.tenant), secoes: secoesDoPortal({ exames }) };
}
```

No fim de `src/modules/portal/perfil.ts` (acrescentar `patients` ao import de `@/db/schema` e `eq` ao de `drizzle-orm` se faltarem):

```ts
/** Plano 16 (RN-218): a saudação usa o primeiro nome (até o primeiro espaço). */
export const primeiroNome = (nome: string): string => nome.trim().split(/\s+/)[0] ?? '';

/** O primeiro nome do prontuário do vínculo (RLS do paciente). Nome não é dado de saúde: sem auditRead (como a lista de pacientes). */
export async function primeiroNomeDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<string> {
  const patientId = pacienteDaSessao(ctx, 'primeiroNomeDoPaciente');
  const [p] = await withTenant(ctx, (tx) => tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, patientId)), db);
  return primeiroNome(p?.nome ?? '');
}
```

- [ ] **Step 3: Layouts**

Trocar `src/app/p/layout.tsx` (o "Sair" sai do topo; D12):

```tsx
import type { Metadata, Viewport } from 'next';
import { atkinson, redHat } from './fontes';
import { SwProvider } from './sw-provider';

// US-040: o iPhone usa o `apple-touch-icon` e não lê os ícones do manifest
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'NutriDebby', statusBarStyle: 'default' },
  icons: { apple: '/icones/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  // D18: barra do sistema na cor do tema do aparelho (RNF-194: sem mudança)
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0f1613' }, { color: '#1d6b5a' }],
};

/**
 * Todas as páginas do portal do paciente. Plano 16: fontes e tokens do layout G (data-app="paciente", só aqui — o painel
 * não muda) e o "Sair" no fim de "Eu" (RN-211); as páginas fora do layout do portal (escolher, sem-acesso, termo) têm o
 * CabecalhoSair. D18: o tema segue o aparelho.
 */
export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-tema="sistema" data-app="paciente" className={`${redHat.variable} ${atkinson.variable} flex min-h-dvh flex-col bg-fundo font-portal text-texto`}>
      <SwProvider>{children}</SwProvider>
    </div>
  );
}
```

Trocar `src/app/p/(portal)/layout.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { requirePaciente } from '@/lib/paciente-session';
import { corDaFaixa } from '@/lib/tema/marca-tema';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { RegistrarAcesso } from '../acesso';
import { DonoDoAparelho } from '../plano-guardado';

export const dynamic = 'force-dynamic';

/**
 * Páginas que exigem vínculo escolhido e termo aceito (todas de /p/, menos /p/escolher, /p/sem-acesso e /p/termo).
 * Cada página chama requirePaciente de novo (o layout não roda de novo na navegação entre seções). Plano 16: a faixa
 * (marca e seções) é de cada página (Faixa / CabecalhoDetalhe, D10); aqui só as cores do consultório: --nd-marca-base
 * (botões e links), --nd-marca-clara (o escuro) e --nd-faixa (corDaFaixa, RN-207).
 */
export default async function PortalLayout({ children }: LayoutProps<'/p'>) {
  const { tenant, vinculo } = await requirePaciente('/p/inicio');
  const marca = getTenantBrand(tenant);
  // --nd-marca é calculado no elemento com [data-tema]: o contêiner repete data-tema="sistema" junto com a cor do consultório
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro, '--nd-faixa': corDaFaixa(marca.cor) } as CSSProperties;
  return (
    // sem min-h-dvh: o contêiner de /p/layout.tsx já tem (débito T-4)
    <div data-tema="sistema" data-app="paciente" style={cores} className="flex flex-1 flex-col">
      <DonoDoAparelho dono={vinculo.patientId} />
      <RegistrarAcesso dono={vinculo.patientId} />
      {children}
    </div>
  );
}
```

`git rm src/app/p/nav-portal.tsx`.

- [ ] **Step 4: O cabeçalho de cada página**

Em cada página, o `<h1>` que abre o `<main>` sai e a página passa a devolver um fragmento com o cabeçalho antes do `<main>`. **Seções** (`Faixa`; a página chama `molduraDaSecao` com o retorno de `requirePaciente`, que passa a ser guardado inteiro em `acesso`):

| Página | Cabeçalho |
|---|---|
| `inicio/page.tsx` | `<Faixa {...moldura} atual="/p/inicio" titulo={MSG_G.titulos.hoje(await primeiroNomeDoPaciente(ctx))} subtitulo={dataDaFaixa(hojeNoFuso(tenant.fuso))} />`; o `BotaoLink` "Enviar exame" sai e entra, depois do `</main>`, `<BarraDeAcoes exames={Boolean(tenant.examesPacienteAtivadoEm)} podeAgendar={consultas.podeAgendar} />` (guardar o retorno inteiro de `consultasDoPaciente` em `consultas`; `proxima = consultas.proximas[0]`) |
| `plano/page.tsx` | `<Faixa {...moldura} atual="/p/plano" titulo={MSG_G.titulos.plano} />` |
| `exames/page.tsx` | `<Faixa {...moldura} atual="/p/exames" titulo={MSG_G.titulos.exames} />` (o h1 "Meus exames" sai) |
| `perfil/page.tsx` | `<Faixa {...moldura} atual="/p/perfil" titulo={MSG_G.titulos.eu} />`; e o `<SairPortal />` (import de `'../../sair-portal'`) entra como **último** filho do `<main>`, dentro de um `<p>` |
| `jornada/page.tsx` (novo) | ver o código abaixo |

**Detalhes** (`CabecalhoDetalhe`; o h1 sai do `<main>`):

| Página | `titulo` | `voltar` |
|---|---|---|
| `diario/page.tsx` | `'Diário'` | `{ href: '/p/inicio', secao: 'Hoje' }` |
| `evolucao/page.tsx` | `'Todas as medidas'` | `{ href: '/p/jornada', secao: 'Jornada' }` |
| `agenda/page.tsx` | `'Minhas consultas'` | `{ href: '/p/jornada', secao: 'Jornada' }` |
| `agenda/nova/page.tsx` | `'Agendar consulta'` | `{ href: '/p/agenda', secao: 'Minhas consultas' }` |
| `agenda/[id]/page.tsx` | `'Sua consulta'` | `{ href: '/p/agenda', secao: 'Minhas consultas' }` |
| `compras/page.tsx` | `'Lista de compras'` | `{ href: '/p/plano', secao: 'Plano' }` |
| `conteudos/page.tsx` | `'Conteúdos'` | `{ href: '/p/plano', secao: 'Plano' }` |
| `conteudos/[id]/page.tsx` | `c.titulo` | `c.soPeloPlano ? { href: '/p/plano', secao: 'Plano' } : { href: '/p/conteudos', secao: 'Conteúdos' }` — e os links "Voltar ao plano"/"Voltar aos conteúdos" de dentro do `<main>` saem (o "Voltar" do cabeçalho os substitui) |
| `documentos/page.tsx` | `'Meus documentos'` | `{ href: '/p/perfil', secao: 'Eu' }` |
| `meus-dados/exportacoes/[id]/page.tsx` | `'Seus dados'` | `{ href: '/p/perfil', secao: 'Eu' }` |

Exemplo completo de uma seção (o início de `plano/page.tsx`; o resto do `<main>` fica como está, menos o h1):

```tsx
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { molduraDaSecao } from '../../moldura';
// …imports que já existiam

export default async function MeuPlano({ searchParams }: PageProps<'/p/plano'>) {
  const acesso = await requirePaciente('/p/plano');
  const { ctx, tenant, vinculo } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const plano = await planoDoPaciente(ctx, tenant.fuso);
  const { pdf } = await searchParams;
  return (
    <>
      <Faixa {...moldura} atual="/p/plano" titulo={MSG_G.titulos.plano} />
      <main className="space-y-6 p-6">
        {/* …o conteúdo de antes, sem o <h1>Plano</h1> */}
      </main>
    </>
  );
}
```

Exemplo completo de um detalhe (o início de `agenda/page.tsx`):

```tsx
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
// …
  return (
    <>
      <CabecalhoDetalhe titulo="Minhas consultas" voltar={{ href: '/p/jornada', secao: 'Jornada' }} />
      <main className="space-y-6 p-6">
        {/* …o conteúdo de antes, sem o <h1>Minhas consultas</h1> */}
      </main>
    </>
  );
```

Criar `src/app/p/(portal)/jornada/page.tsx` (esqueleto: a rota de seção existe desde já; a T12 a completa):

```tsx
import Link from 'next/link';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { requirePaciente } from '@/lib/paciente-session';
import { molduraDaSecao } from '../../moldura';

export const dynamic = 'force-dynamic';

/** Plano 16 (RN-190): a seção Jornada. Esqueleto da T4 — a T12 traz o gráfico e a linha do tempo. */
export default async function Jornada() {
  const acesso = await requirePaciente('/p/jornada');
  const moldura = await molduraDaSecao(acesso);
  return (
    <>
      <Faixa {...moldura} atual="/p/jornada" titulo={MSG_G.titulos.jornada} />
      <main className="space-y-4 p-6">
        <p><Link href="/p/evolucao" className="inline-flex min-h-11 items-center underline">Todas as medidas</Link></p>
        <p><Link href="/p/agenda" className="inline-flex min-h-11 items-center underline">Minhas consultas</Link></p>
      </main>
    </>
  );
}
```

Nas três páginas fora do layout do portal (`termo`, `escolher`, `sem-acesso`), importar `CabecalhoSair` de `@/components/portal/cabecalho-sair` e devolver `<><CabecalhoSair />{/* o <main> de antes */}</>`; o `h1` delas ganha `font-portal-titulo` no lugar de `font-titulo`.

- [ ] **Step 5: Testes de página e guardas que citam a moldura antiga**

Em `src/app/p/(portal)/plano/page.test.ts` e `src/app/p/(portal)/exames/page.test.ts`, acrescentar o mock da moldura (logo depois dos outros `vi.mock`):

```ts
vi.mock('@/app/p/moldura', () => ({
  molduraDaSecao: async () => ({ marca: { nome: 'Consultório', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }),
}));
```

e trocar o `requirePaciente` mockado para devolver também `tenant.examesPacienteAtivadoEm` quando a página o lê (o de exames já devolve). Os testes de página dos detalhes (`agenda/[id]`, `documentos`, `evolucao`) não precisam de mock novo (`CabecalhoDetalhe` não usa hook do roteador).

Em `src/app/painel/cores.test.ts`: (a) a exceção `'src/app/p/(portal)/layout.tsx'` sai de `EXCECOES` (o logo mudou de arquivo) e entra `'src/components/portal/faixa.tsx': { motivo: 'o logo do consultório fica sobre fundo branco e a seção atual é a pílula branca da faixa (texto na cor da faixa, ≥ 4,5:1 por corDaFaixa); nenhum token é branco nos dois modos', classes: ['bg-white'] }` e o mesmo para `'src/components/portal/nav-secoes.tsx'` (classe `bg-white`, motivo: a pílula); (b) o teste "marca do consultório no portal" passa a conferir a faixa:

```ts
describe('marca do consultório no portal (US-005, RN-207)', () => {
  it('a faixa usa a cor da faixa (bg-faixa = corDaFaixa, posta pelo layout em --nd-faixa), nunca a cor original em style', () => {
    const faixa = readFileSync('src/components/portal/faixa.tsx', 'utf8');
    expect(faixa).toMatch(/(?<![\w-])bg-faixa(?![\w-])/);
    expect(faixa).toMatch(/<img [^>]*className="[^"]*\bbg-white\b/);
    expect(faixa).not.toMatch(/backgroundColor/);
    expect(readFileSync('src/app/p/(portal)/layout.tsx', 'utf8')).toMatch(/'--nd-faixa': corDaFaixa\(marca\.cor\)/);
  });
});
```

- [ ] **Step 6: Os E2E que usam a barra antiga**

A barra de 7 abas (`navigation 'Portal'`) deixa de existir; a navegação é `navigation 'Seções'` (Hoje, Jornada, Plano, Exames, Eu), o "Sair" do portal fica no fim de Eu e o h1 de Hoje é "Olá, {primeiro nome}". Trocar (conferir com `git grep -n "name: 'Portal'\|Meu acompanhamento" e2e`):

- `e2e/portal.spec.ts`: linha ~26 → `getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Hoje' })`; ~37 → `getByRole('heading', { level: 1, name: /^Olá, / })`; ~79 → `Seções`/`Plano`; ~94 → antes do clique em "Sair", `await p.page.goto('/p/perfil')`; ~229 → `Seções`/`Hoje`; ~242 → `Seções`/`Eu`; o teste "cor do consultório no portal" (~362–392) passa a conferir a **pílula** da seção atual: `const item = p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Hoje' })`, cor do texto `rgb(corDaFaixa(COR))` **nos dois modos** e o fundo da faixa `rgb(corDaFaixa(COR))` (`p.page.getByRole('banner')`, `backgroundColor`), com `import { corDaFaixa } from '@/lib/tema/marca-tema'` no lugar de `corNoEscuro`; o título do teste e o comentário dizem "faixa" no lugar de "barra de abas"; o teste "Minha evolução: peso sem % de gordura… (US-044)" (~305–322): linha ~310 → `getByRole('heading', { level: 1, name: 'Todas as medidas' })` (o resto do teste a **T12** reescreve para a tabela; até lá a lista antiga continua na página e o teste passa).
- `e2e/pacientes.spec.ts`: ~67, ~79 e ~88 → `getByRole('heading', { level: 1, name: /^Olá, / })`; ~81 → `await page.goto('/p/perfil')` antes do "Sair".
- `e2e/exames-enviados.spec.ts`: ~42 → `await expect(p.page).toHaveURL(/\/p\/exames(#enviar)?$/)`; ~44 → `Seções`/`Exames`.
- `e2e/acessibilidade.spec.ts`: ~265 e ~270 → `Seções`/`Plano` e `Seções`/`Eu`. O teste "alvo de toque ≥ 44 px" (~213) continua (o link "Próxima consulta" de Hoje só sai na T10, que ajusta este teste). O teste "celular (RNF-09)" (~170–211) troca a barra de abas pelas seções — o título e o trecho do meio passam a ser (o laço das `ROTAS` antes e o "T-4" depois ficam como estão):

```ts
test('celular (RNF-09): a 360 px (o menor Android da R16), nenhuma tela do PWA rola na horizontal e as seções da faixa cabem em 5 colunas iguais (também a 320 px, com axe)', async () => {
  // …o laço das ROTAS a 360 px, sem mudança
    await paciente.page.goto('/p/inicio');
    const secoes = paciente.page.getByRole('navigation', { name: 'Seções' });
    for (const s of ['Hoje', 'Jornada', 'Plano', 'Exames', 'Eu']) await expect(secoes.getByRole('link', { name: s, exact: true })).toBeVisible();
    // Plano 16 (§4.2): 5 colunas iguais (o consultório do E2E recebe exames), palavra longa quebra com hífen — nada rola nem invade a vizinha
    for (const largura of [360, 320]) {
      await paciente.page.setViewportSize({ width: largura, height: 780 });
      const barra = await secoes.evaluate((nav) => {
        const ul = nav.querySelector('ul')!;
        const lis = [...ul.querySelectorAll('li')].map((li) => li.getBoundingClientRect());
        const links = [...ul.querySelectorAll('a')];
        return {
          rola: ul.scrollWidth > ul.clientWidth || document.documentElement.scrollWidth > window.innerWidth,
          colunas: lis.length,
          larguras: lis.map((r) => Math.round(r.width)),
          vazaDaColuna: links.filter((a) => a.scrollWidth > a.clientWidth).map((a) => a.textContent),
          alturaMin: Math.min(...links.map((a) => a.getBoundingClientRect().height)),
        };
      });
      expect(barra.colunas, `${largura} px`).toBe(5);
      expect(barra.rola, `${largura} px`).toBe(false);
      expect(Math.max(...barra.larguras) - Math.min(...barra.larguras), `${largura} px: ${barra.larguras}`).toBeLessThanOrEqual(1);
      expect(barra.vazaDaColuna, `${largura} px`).toEqual([]);
      expect(barra.alturaMin, `${largura} px`).toBeGreaterThanOrEqual(44);
      expect(await violacoes(paciente.page), `axe a ${largura} px`).toEqual([]);
    }
  // …o "T-4" e o finally, sem mudança
```

- [ ] **Step 7: Rodar tudo e commitar**

```bash
pnpm vitest run src/components/portal src/modules/portal/perfil.test.ts src/app/p src/app/painel/cores.test.ts src/app/formularios-post.test.ts src/lib/tema
pnpm typecheck && pnpm lint && pnpm build
pnpm test:e2e -- e2e/portal.spec.ts e2e/pacientes.spec.ts e2e/exames-enviados.spec.ts e2e/acessibilidade.spec.ts e2e/sair.spec.ts e2e/sessao-portal.spec.ts e2e/csp.spec.ts
```

Expected: PASS. Se o `next build` reclamar de `LayoutProps<'/p'>` no `(portal)/layout.tsx`, manter a assinatura de antes (é a mesma).

```bash
git add -A src/components/portal src/app/p src/modules/portal/perfil.ts src/modules/portal/perfil.test.ts src/app/painel/cores.test.ts e2e/portal.spec.ts e2e/acessibilidade.spec.ts e2e/exames-enviados.spec.ts e2e/pacientes.spec.ts
git commit -m "$(cat <<'MSG'
feat(portal): moldura do layout G — faixa, seções, detalhe e ações (P16-04)

Faixa na cor da faixa com a marca, o título e as cinco seções (servidor, sem
JavaScript); cabeçalho compacto com Voltar nas telas de detalhe; barra de
ações em Hoje; Sair no fim de Eu e no topo das páginas fora do portal. Sai a
barra de 7 abas; E2E ajustados para a navegação Seções.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 5: Regras do mural e datas do portal — funções puras (P16-05)

**Revisão: completa (agente normas-cfn-lgpd)** — autoria (RN-194, C-197: só o texto da nutricionista leva a voz dela), linguagem do sistema (sem conselho, elogio ou ordem), o que o mural mostra e esconde (RN-199: nunca item que a tela de origem esconderia), janela e ordem (RN-195), fuso (RN-06, RN-217).

**Files:**
- Create: `src/modules/portal/datas-portal.ts` (+ `datas-portal.test.ts`), `src/modules/portal/mural-regras.ts` (+ `mural-regras.test.ts`)

**Interfaces:**
- Consumes: `partesNoFuso`, `paraInstante`, `inicioDoDia`, `somarDias`, `diaDaSemana`, `diaCurto`, `rotuloDoFuso` (`src/modules/agenda/fuso.ts`); `formatarDataNoFuso` (`src/modules/pacientes/datas.ts`); `nomeDoEnvio` (`src/modules/pacientes/exames-enviados-constantes.ts`); `rotuloDaRefeicao`, `RespostaDoDiario` (T1). Todos puros (sem banco, sem Node): o módulo pode ir ao cliente.
- Produces: o contrato de `datas-portal.ts` e `mural-regras.ts` (ver "Contratos entre tarefas").

- [ ] **Step 1: Testes das datas (falham)**

Criar `src/modules/portal/datas-portal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { daquiA, dataDaFaixa, dataPorExtenso, horaComFuso, mesPorExtenso, quandoRelativo, quandoRelativoComFuso, separadorDoDia } from './datas-portal';

const SP = 'America/Sao_Paulo';

describe('datas do portal (RN-217)', () => {
  it('faixa de Hoje: "Quinta, 8 out"; separador: "Ontem" e "Ter, 6 out"', () => {
    expect(dataDaFaixa('2026-10-08')).toBe('Quinta, 8 out');
    expect(separadorDoDia('2026-10-07', '2026-10-08')).toBe('Ontem');
    expect(separadorDoDia('2026-10-06', '2026-10-08')).toBe('Ter, 6 out');
    expect(separadorDoDia('2026-09-30', '2026-10-01')).toBe('Ontem'); // virada do mês
  });

  it('Jornada: "22 de setembro" no ano corrente; com o ano quando é outro (Desvio 7)', () => {
    expect(dataPorExtenso('2026-09-22', '2026-10-08')).toBe('22 de setembro');
    expect(dataPorExtenso('2025-03-18', '2026-10-08')).toBe('18 de março de 2025');
    expect(mesPorExtenso('2026-03-18', '2026-10-08')).toBe('março');
    expect(mesPorExtenso('2025-12-02', '2026-10-08')).toBe('dezembro de 2025');
  });

  it('consulta: hoje, amanhã ou o dia curto, no fuso do consultório (servidor em UTC); com a sigla quando pedida', () => {
    const agora = new Date('2026-10-08T14:05:00Z'); // 11:05 em São Paulo
    expect(quandoRelativo(new Date('2026-10-08T20:00:00Z'), agora, SP)).toBe('hoje, 17:00');
    expect(quandoRelativo(new Date('2026-10-09T17:00:00Z'), agora, SP)).toBe('amanhã, 14:00');
    // 00:30 de sexta em SP ainda é quinta 03:30 UTC… e vice-versa: o dia é sempre o do fuso
    expect(quandoRelativo(new Date('2026-10-09T03:30:00Z'), agora, SP)).toBe('amanhã, 00:30');
    expect(quandoRelativo(new Date('2026-10-16T17:00:00Z'), agora, SP)).toBe('sex., 16/10, 14:00');
    expect(quandoRelativoComFuso(new Date('2026-10-09T17:00:00Z'), agora, SP)).toBe('amanhã, 14:00 (horário de Brasília)');
    expect(horaComFuso(new Date('2026-10-08T12:15:00Z'), SP)).toEqual({ semFuso: '09:15', comFuso: '09:15 (horário de Brasília)' });
  });

  it('"daqui a": horas e minutos, sem "0 h"', () => {
    expect(daquiA(85)).toBe('daqui a 1 h 25 min');
    expect(daquiA(40)).toBe('daqui a 40 min');
    expect(daquiA(120)).toBe('daqui a 2 h');
    expect(daquiA(0)).toBe('agora');
  });
});
```

Run: `pnpm vitest run src/modules/portal/datas-portal.test.ts` → FAIL.

- [ ] **Step 2: As datas**

Criar `src/modules/portal/datas-portal.ts`:

```ts
import { diaCurto, diaDaSemana, partesNoFuso, rotuloDoFuso, somarDias } from '@/modules/agenda/fuso';

/** Plano 16 (RN-217): datas por extenso curtas do portal, no fuso do tenant. Puro (servidor e cliente). */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const partes = (data: string) => data.split('-').map(Number) as [number, number, number];

/** "Quinta, 8 out" — a data da faixa de Hoje. */
export function dataDaFaixa(data: string): string {
  const [, m, d] = partes(data);
  return `${DIAS[diaDaSemana(data)]}, ${d} ${MESES[m - 1].slice(0, 3)}`;
}

/** "Ontem" ou "Ter, 6 out" — o separador de dia em "Dias anteriores" (RN-195). */
export function separadorDoDia(data: string, hoje: string): string {
  if (data === somarDias(hoje, -1)) return 'Ontem';
  const [, m, d] = partes(data);
  return `${DIAS_CURTOS[diaDaSemana(data)]}, ${d} ${MESES[m - 1].slice(0, 3)}`;
}

/** "22 de setembro" (com " de 2025" quando o ano não é o de hoje) — a data de um atendimento na Jornada. */
export function dataPorExtenso(data: string, hoje: string): string {
  const [a, m, d] = partes(data);
  return `${d} de ${MESES[m - 1]}${a === partes(hoje)[0] ? '' : ` de ${a}`}`;
}

/** "março" (ou "março de 2025") — o mês de "desde {mês}" (Desvio 7). */
export function mesPorExtenso(data: string, hoje: string): string {
  const [a, m] = partes(data);
  return `${MESES[m - 1]}${a === partes(hoje)[0] ? '' : ` de ${a}`}`;
}

/** "hoje, 17:00", "amanhã, 14:00" ou "sex., 16/10, 14:00" — consulta no mural e na faixa, no fuso do tenant. */
export function quandoRelativo(inicio: Date, agora: Date, fuso: string): string {
  const i = partesNoFuso(inicio, fuso);
  const hoje = partesNoFuso(agora, fuso).data;
  if (i.data === hoje) return `hoje, ${i.hora}`;
  if (i.data === somarDias(hoje, 1)) return `amanhã, ${i.hora}`;
  return `${diaCurto(i.data)}, ${i.hora}`;
}

/** RN-06: com a sigla do fuso, para o aparelho que está noutro fuso (QuandoLocal escolhe). */
export function quandoRelativoComFuso(inicio: Date, agora: Date, fuso: string): string {
  return `${quandoRelativo(inicio, agora, fuso)} (${rotuloDoFuso(fuso)})`;
}

/** A hora de um item do mural, com e sem a sigla do fuso (QuandoLocal escolhe no aparelho). */
export function horaComFuso(instante: Date, fuso: string): { semFuso: string; comFuso: string } {
  const hora = partesNoFuso(instante, fuso).hora;
  return { semFuso: hora, comFuso: `${hora} (${rotuloDoFuso(fuso)})` };
}

/** "daqui a 1 h 25 min" — a próxima refeição na sanfona do Plano. */
export function daquiA(minutos: number): string {
  if (minutos <= 0) return 'agora';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `daqui a ${[h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')}`;
}
```

Run: `pnpm vitest run src/modules/portal/datas-portal.test.ts` → PASS.

- [ ] **Step 3: Testes do mural (falham)**

Criar `src/modules/portal/mural-regras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { comporMural, MAX_ITENS_MURAL, MSG_MURAL, resumoDaRefeicao, saudacao, type FontesDoMural, type ItemDoMural } from './mural-regras';

const SP = 'America/Sao_Paulo';
const AGORA = new Date('2026-10-08T14:05:00Z'); // quinta, 11:05 em São Paulo
const sp = (dataHora: string) => new Date(`${dataHora}-03:00`); // instante a partir do relógio de SP

const ALMOCO = { id: 'r-almoco', nome: 'Almoço', horario: '12:30', itens: [{ nome: 'Arroz integral' }, { nome: 'feijão' }, { nome: 'frango grelhado' }, { nome: 'salada' }] };
const CAFE = { id: 'r-cafe', nome: 'Café da manhã', horario: '07:00', itens: [{ nome: 'Pão integral' }] };
const JANTAR = { id: 'r-jantar', nome: 'Jantar', horario: '19:30', itens: [{ nome: 'Sopa' }] };
const CEIA = { id: 'r-ceia', nome: 'Ceia', horario: '', itens: [{ nome: 'Chá' }] };

const vazio = (): FontesDoMural => ({ primeiroNome: 'Marina', plano: null, diario: [], envios: [], consulta: null, conteudos: [], documentosNovos: 0 });
const todos = (m: ReturnType<typeof comporMural>): ItemDoMural[] => [...m.anteriores.flatMap((d) => d.itens), ...m.hoje];
const textoDe = (i: ItemDoMural) => (!('texto' in i) || i.texto === null ? '' : typeof i.texto === 'string' ? i.texto : i.texto.semFuso);

describe('comporMural (RN-193 a RN-201)', () => {
  it('refeição que vem aí: 90 min antes, texto do app do consultório, "Comi assim"; a primeira do dia leva a saudação', () => {
    const f = { ...vazio(), plano: { publicadoEm: sp('2026-09-01T10:00'), refeicoes: [CAFE, ALMOCO, JANTAR, CEIA] } };
    const m = comporMural(f, AGORA, SP);
    const refeicoes = m.hoje.filter((i) => i.tipo === 'refeicao');
    expect(refeicoes.map(textoDe)).toEqual([
      'Bom dia, Marina. Café da manhã das 07:00: pão integral.',
      'Próxima refeição às 12:30 — Almoço: arroz integral, feijão, frango grelhado e salada.',
    ]);
    // jantar às 19:30 só aparece às 18:00; a ceia sem horário nunca aparece (RN-196)
    expect(textoDe(refeicoes[1])).not.toMatch(/nutricionista/i);
    expect(refeicoes.every((i) => i.autor === 'consultorio')).toBe(true);
    expect(refeicoes[1]).toMatchObject({ refeicaoId: 'r-almoco', respondida: false, hora: { semFuso: '12:30', comFuso: '12:30' } });
    const as18 = comporMural(f, sp('2026-10-08T18:00'), SP).hoje.filter((i) => i.tipo === 'refeicao');
    expect(as18.map((i) => (i.tipo === 'refeicao' ? i.refeicaoId : ''))).toEqual(['r-cafe', 'r-almoco', 'r-jantar']);
  });

  it('a resposta de hoje esconde o "Comi assim" daquela refeição; a de ontem não', () => {
    const resp = (dataHora: string) => ({ id: dataHora, dataHora: sp(dataHora), refeicao: 'Almoço', texto: null, foto: { estado: 'sem_foto' as const }, resposta: 'como_no_plano' as const, refeicaoDoPlano: 'Almoço · 12:30', comentario: null, comentadoEm: null });
    const base = { ...vazio(), plano: { publicadoEm: null, refeicoes: [ALMOCO] } };
    const ontem = comporMural({ ...base, diario: [resp('2026-10-07T12:40')] }, AGORA, SP).hoje.find((i) => i.tipo === 'refeicao');
    expect(ontem).toMatchObject({ respondida: false });
    const hoje = comporMural({ ...base, diario: [resp('2026-10-08T10:00')] }, AGORA, SP).hoje.find((i) => i.tipo === 'refeicao');
    expect(hoje).toMatchObject({ respondida: true });
  });

  it('diário: balão "Você" com a resposta e a refeição do plano; comentário da nutricionista com a voz dela, verbatim', () => {
    const f = {
      ...vazio(),
      diario: [
        { id: 'e1', dataHora: sp('2026-10-08T08:10'), refeicao: 'Café da manhã', texto: 'Pão com ovo', foto: { estado: 'sem_foto' as const }, resposta: null, refeicaoDoPlano: null, comentario: 'Ótima combinação!', comentadoEm: sp('2026-10-08T09:15') },
      ],
    };
    const m = comporMural(f, AGORA, SP);
    expect(m.hoje.map((i) => [i.tipo, i.autor])).toEqual([['registro', 'voce'], ['comentario', 'nutricionista']]);
    expect(m.hoje[1]).toMatchObject({ texto: 'Ótima combinação!', hora: { semFuso: '09:15' } });
  });

  it('exame: envio de hoje e mudança de situação em 7 dias (o texto de SITUACAO vem pronto); envio antigo sem mudança não entra', () => {
    const f = {
      ...vazio(),
      envios: [
        { id: 'x1', nome: 'Hemograma', enviadoEm: sp('2026-10-08T09:00'), mudouEm: sp('2026-10-08T09:00'), situacao: 'Aguardando sua nutricionista' },
        { id: 'x2', nome: 'Glicemia', enviadoEm: sp('2026-10-01T09:00'), mudouEm: sp('2026-10-07T16:00'), situacao: 'Não aceito: Imagem ilegível' },
        // recebido (só processado): mudouEm = enviadoEm (muralDoPaciente, T6) — o processamento não conta como mudança
        { id: 'x3', nome: 'Ferritina', enviadoEm: sp('2026-10-02T09:00'), mudouEm: sp('2026-10-02T09:00'), situacao: 'Aguardando sua nutricionista' },
      ],
    };
    const m = comporMural(f, AGORA, SP);
    expect(m.hoje.map(textoDe)).toEqual(['Hemograma: Aguardando sua nutricionista']);
    expect(m.anteriores).toEqual([{ dia: '2026-10-07', rotulo: 'Ontem', itens: [expect.objectContaining({ texto: 'Glicemia: Não aceito: Imagem ilegível' })] }]);
  });

  it('consulta nos próximos 7 dias (com e sem a sigla), "Confirmar presença" só se pode; fora dos 7 dias não entra', () => {
    const consulta = { id: 'c1', inicio: sp('2026-10-09T14:00'), modalidade: 'online' as const, podeConfirmar: true };
    const item = comporMural({ ...vazio(), consulta }, AGORA, SP).hoje[0];
    expect(item).toMatchObject({
      tipo: 'consulta',
      consultaId: 'c1',
      podeConfirmar: true,
      hora: null,
      texto: { semFuso: 'Sua próxima consulta: amanhã, 14:00 (online).', comFuso: 'Sua próxima consulta: amanhã, 14:00 (horário de Brasília) (online).' },
    });
    expect(comporMural({ ...vazio(), consulta: { ...consulta, inicio: sp('2026-10-16T14:00') } }, AGORA, SP).vazio).toBe(true);
  });

  it('plano novo (7 dias), conteúdo novo (até 3, 7 dias) e documentos novos; o plano antigo não', () => {
    const f = {
      ...vazio(),
      plano: { publicadoEm: sp('2026-10-06T10:00'), refeicoes: [] },
      conteudos: [1, 2, 3, 4].map((n) => ({ id: `k${n}`, titulo: `Lanches ${n}`, publicadoEm: sp(`2026-10-0${n + 3}T08:00`) })),
      documentosNovos: 1,
    };
    const textos = todos(comporMural(f, AGORA, SP)).map(textoDe);
    expect(textos).toContain('Seu novo plano alimentar está disponível.');
    expect(textos).toContain('Você tem 1 documento novo.');
    expect(textos.filter((t) => t.startsWith('Novo conteúdo: '))).toHaveLength(3);
    expect(comporMural({ ...vazio(), plano: { publicadoEm: sp('2026-09-20T10:00'), refeicoes: [] } }, AGORA, SP).vazio).toBe(true);
    expect(MSG_MURAL.documentos(2)).toBe('Você tem 2 documentos novos.');
  });

  it('autoria (RN-194, C-197): só o comentário é da nutricionista; nenhum texto do sistema fala por ela nem diz "IA"', () => {
    const f: FontesDoMural = {
      ...vazio(),
      plano: { publicadoEm: sp('2026-10-08T07:00'), refeicoes: [CAFE, ALMOCO] },
      diario: [{ id: 'e1', dataHora: sp('2026-10-08T08:00'), refeicao: 'Café da manhã', texto: 'ok', foto: { estado: 'sem_foto' }, resposta: null, refeicaoDoPlano: null, comentario: 'Boa!', comentadoEm: sp('2026-10-08T08:30') }],
      envios: [{ id: 'x1', nome: null, enviadoEm: sp('2026-10-08T09:00'), mudouEm: sp('2026-10-08T09:00'), situacao: 'Processando…' }],
      consulta: { id: 'c1', inicio: sp('2026-10-09T14:00'), modalidade: 'presencial', podeConfirmar: false },
      conteudos: [{ id: 'k1', titulo: 'Rótulos', publicadoEm: sp('2026-10-08T06:00') }],
      documentosNovos: 2,
    };
    for (const i of todos(comporMural(f, AGORA, SP))) {
      if (i.autor === 'nutricionista') expect(i.tipo).toBe('comentario');
      else expect(textoDe(i)).not.toMatch(/^Sua nutricionista|\bIA\b/);
    }
    // o comentário diz a qual registro se refere (o texto dela continua verbatim)
    expect(todos(comporMural(f, AGORA, SP)).find((i) => i.tipo === 'comentario')).toMatchObject({ sobre: 'Café da manhã, hoje às 08:00', texto: 'Boa!' });
    expect(MSG_MURAL.nutricionistaComentou('Café da manhã, hoje às 08:00')).toBe('Sua nutricionista comentou seu registro (Café da manhã, hoje às 08:00)');
  });

  it('janela e ordem (RN-195): hoje em ordem crescente; dias anteriores por dia; no máximo 40 itens, os mais antigos saem; vazio', () => {
    const diario = Array.from({ length: 45 }, (_, k) => ({
      id: `e${k}`,
      dataHora: new Date(sp('2026-10-01T08:00').getTime() + k * 3 * 3600_000),
      refeicao: 'Outro',
      texto: `r${k}`,
      foto: { estado: 'sem_foto' as const },
      resposta: null,
      refeicaoDoPlano: null,
      comentario: null,
      comentadoEm: null,
    }));
    const m = comporMural({ ...vazio(), diario }, AGORA, SP);
    const lista = todos(m);
    expect(lista).toHaveLength(MAX_ITENS_MURAL);
    expect(lista.map((i) => i.quando.getTime())).toEqual([...lista.map((i) => i.quando.getTime())].sort((a, b) => a - b));
    expect(lista[0]).toMatchObject({ chave: 'registro:e5' }); // e0 a e4 saíram
    // o último registro (e44) é de 06/10 20:00: nenhum de ontem nem de hoje
    expect(m.anteriores.map((d) => d.rotulo)).toEqual(['Qui, 1 out', 'Sex, 2 out', 'Sáb, 3 out', 'Dom, 4 out', 'Seg, 5 out', 'Ter, 6 out']);
    expect(m.hoje).toEqual([]);
    expect(comporMural(vazio(), AGORA, SP)).toEqual({ primeiroNome: 'Marina', hoje: [], anteriores: [], vazio: true, semPlano: true });
    // plano publicado e nada para agora (05:00, primeira refeição às 08:00): vazio, mas NÃO "sem plano" (o texto não diz que ela não publicou)
    const cedo = comporMural({ ...vazio(), plano: { publicadoEm: sp('2026-09-20T10:00'), refeicoes: [{ id: 'r-cafe', nome: 'Café da manhã', horario: '08:00', itens: [{ nome: 'Pão' }] }] } }, sp('2026-10-08T05:00'), SP);
    expect(cedo).toMatchObject({ vazio: true, semPlano: false });
  });

  it('virada do dia (Review Focus 3): às 23:30, a refeição das 00:30 é a de hoje (já passou), nunca a "próxima" de amanhã; o registro de ontem às 23:59 fica em "Ontem"', () => {
    const f = { ...vazio(), plano: { publicadoEm: null, refeicoes: [{ id: 'r0', nome: 'Ceia', horario: '00:30', itens: [] }] } };
    expect(comporMural(f, sp('2026-10-08T23:30'), SP).hoje).toEqual([expect.objectContaining({ texto: 'Boa noite, Marina. Ceia das 00:30.', quando: sp('2026-10-08T00:30') })]);
    // às 00:10 a das 00:30 já é a próxima (de hoje): 20 min antes, dentro dos 90
    expect(comporMural(f, sp('2026-10-09T00:10'), SP).hoje).toEqual([expect.objectContaining({ texto: 'Boa noite, Marina. Próxima refeição às 00:30 — Ceia.' })]);
    const reg = { id: 'e1', dataHora: sp('2026-10-07T23:59'), refeicao: 'Ceia', texto: 'chá', foto: { estado: 'sem_foto' as const }, resposta: null, refeicaoDoPlano: null, comentario: null, comentadoEm: null };
    const m = comporMural({ ...vazio(), diario: [reg] }, sp('2026-10-08T00:01'), SP);
    expect(m.hoje).toEqual([]);
    expect(m.anteriores[0].rotulo).toBe('Ontem');
  });

  it('resumo e saudação', () => {
    expect(resumoDaRefeicao([{ nome: 'Arroz, integral, cozido' }])).toBe('arroz, integral, cozido');
    expect(resumoDaRefeicao([{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }, { nome: 'D' }, { nome: 'E' }])).toBe('a, b, c e d');
    expect(resumoDaRefeicao([])).toBe('');
    expect([saudacao(4 * 60 + 59), saudacao(5 * 60), saudacao(11 * 60 + 59), saudacao(12 * 60), saudacao(17 * 60 + 59), saudacao(18 * 60)]).toEqual([
      'Boa noite', 'Bom dia', 'Bom dia', 'Boa tarde', 'Boa tarde', 'Boa noite',
    ]);
  });
});
```

Run: `pnpm vitest run src/modules/portal/mural-regras.test.ts` → FAIL.

- [ ] **Step 4: As regras do mural**

Criar `src/modules/portal/mural-regras.ts`:

```ts
import { inicioDoDia, paraInstante, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { horaComFuso, quandoRelativo, quandoRelativoComFuso, separadorDoDia } from './datas-portal';
import { rotuloDaRefeicao, type RespostaDoDiario } from './diario-constantes';

/**
 * Plano 16 (§4.3): o mural "Hoje" é LEITURA — nenhuma tabela, nenhuma mensagem (spec C, D24 = b). Esta função pura decide
 * os itens, a ordem, os textos, a autoria e quais respostas aparecem; `muralDoPaciente` (mural.ts) só busca as fontes.
 * Autoria (RN-194, C-197): só o texto que a nutricionista escreveu leva a voz dela; o resto é do app do consultório, em
 * 3ª pessoa ou impessoal, sem elogio, conselho ou ordem. Textos em rascunho até a Debby revisar (G-D10 ★).
 */
export const JANELA_MURAL_DIAS = 7; // RN-195
export const MAX_ITENS_MURAL = 40; // RN-195
export const ANTECEDENCIA_REFEICAO_MIN = 90; // RN-196
export const MAX_CONTEUDOS_NO_MURAL = 3; // RN-199
/** Teto da leitura do diário no mural (7 dias × 10 registros = 70; folga para os comentários). */
export const LIMITE_DIARIO_NO_MURAL = 100;

export const MSG_MURAL = {
  // correção da revisão do plano (normas, LGPD art. 6º, VI): o diário É visto por ela — o rodapé não pode dizer o contrário
  rodape: 'Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta. Dúvidas: anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192.',
  vazio: 'Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui.',
  /** Plano publicado e nada no mural (antes dos 90 min da 1ª refeição, ou refeições sem horário): nunca dizer que ela não publicou. */
  nadaAgora: 'Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma.',
  verTodoDiario: 'Ver todo o diário',
  diasAnteriores: 'Dias anteriores',
  /** Autor VISÍVEL de cada item (RN-194, §11.1): o lado do balão não basta. O comentário da nutricionista usa o rótulo próprio. */
  autor: { voce: 'Você', consultorio: 'Aviso do app' },
  /** RN-194: rótulo montado pelo sistema em 3ª pessoa; diz a qual registro o comentário se refere (o texto dela vem verbatim). */
  nutricionistaComentou: (sobre: string) => `Sua nutricionista comentou seu registro (${sobre})`,
  saudacao: (s: string, nome: string) => (nome ? `${s}, ${nome}.` : `${s}.`),
  refeicaoAntes: (hora: string, nome: string, resumo: string) => `Próxima refeição às ${hora} — ${resumo ? `${nome}: ${resumo}` : nome}.`,
  refeicaoDepois: (nome: string, hora: string, resumo: string) => `${nome} das ${hora}${resumo ? `: ${resumo}` : ''}.`,
  exame: (nome: string, situacao: string) => `${nome}: ${situacao}`,
  consulta: (quando: string, modalidade: string) => `Sua próxima consulta: ${quando} (${modalidade}).`,
  planoNovo: 'Seu novo plano alimentar está disponível.',
  conteudo: (titulo: string) => `Novo conteúdo: ${titulo}`,
  documentos: (n: number) => (n === 1 ? 'Você tem 1 documento novo.' : `Você tem ${n} documentos novos.`),
  botoes: {
    verRefeicao: 'Ver a refeição',
    verDiario: 'Ver no diário',
    verExames: 'Ver meus exames',
    verConsulta: 'Ver a consulta',
    confirmar: 'Confirmar presença',
    verPlano: 'Ver o plano',
    abrir: 'Abrir',
    verDocumentos: 'Ver documentos',
  },
} as const;

export type FotoDoRegistro = { estado: 'sem_foto' | 'processando' | 'falhou' } | { estado: 'pronta'; caminho: string };

export type FontesDoMural = {
  primeiroNome: string;
  plano: { publicadoEm: Date | null; refeicoes: readonly { id: string; nome: string; horario: string; itens: readonly { nome: string }[] }[] } | null;
  diario: readonly {
    id: string;
    dataHora: Date;
    refeicao: string;
    texto: string | null;
    foto: FotoDoRegistro;
    resposta: RespostaDoDiario | null;
    refeicaoDoPlano: string | null;
    comentario: string | null;
    comentadoEm: Date | null;
  }[];
  /**
   * `situacao` = o texto de situacaoParaPaciente (o mesmo de /p/exames). `mudouEm` = quando a situação mudou DEPOIS do envio
   * (revisão, expiração, falha); para "processando" e "recebido", igual a `enviadoEm` (o processamento não é mudança).
   */
  envios: readonly { id: string; nome: string | null; enviadoEm: Date; mudouEm: Date; situacao: string }[];
  consulta: { id: string; inicio: Date; modalidade: 'presencial' | 'online'; podeConfirmar: boolean } | null;
  conteudos: readonly { id: string; titulo: string; publicadoEm: Date }[];
  documentosNovos: number;
};

type Hora = { semFuso: string; comFuso: string };
type Base = { chave: string; quando: Date; /** null: item sem hora própria (D13). */ hora: Hora | null };
export type ItemDoMural =
  | (Base & { tipo: 'refeicao'; autor: 'consultorio'; texto: string; refeicaoId: string; respondida: boolean })
  | (Base & { tipo: 'registro'; autor: 'voce'; refeicao: string; resposta: RespostaDoDiario | null; texto: string | null; foto: FotoDoRegistro })
  | (Base & { tipo: 'comentario'; autor: 'nutricionista'; /** "Almoço · 12:30, hoje às 12:41" */ sobre: string; texto: string })
  | (Base & { tipo: 'exame'; autor: 'consultorio'; texto: string })
  | (Base & { tipo: 'consulta'; autor: 'consultorio'; consultaId: string; texto: Hora; podeConfirmar: boolean })
  | (Base & { tipo: 'plano'; autor: 'consultorio'; texto: string })
  | (Base & { tipo: 'conteudo'; autor: 'consultorio'; conteudoId: string; titulo: string; texto: string })
  | (Base & { tipo: 'documentos'; autor: 'consultorio'; texto: string });

export type Mural = { primeiroNome: string; hoje: ItemDoMural[]; anteriores: { dia: string; rotulo: string; itens: ItemDoMural[] }[]; vazio: boolean; /** sem plano publicado: o texto "Nada por aqui ainda…" só vale aqui */ semPlano: boolean };

const minuscula = (s: string) => s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1);

/** RN-196: os nomes dos itens principais (sem substituições), até 4, com vírgula e "e"; sem quantidade (ela fica na refeição aberta). */
export function resumoDaRefeicao(itens: readonly { nome: string }[]): string {
  const nomes = itens.slice(0, 4).map((i) => minuscula(i.nome.trim())).filter(Boolean);
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** RN-196: "Bom dia" de 05:00 a 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" no resto (minutos desde 00:00 no fuso). */
export function saudacao(minutosDoDia: number): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  if (minutosDoDia >= 5 * 60 && minutosDoDia < 12 * 60) return 'Bom dia';
  if (minutosDoDia >= 12 * 60 && minutosDoDia < 18 * 60) return 'Boa tarde';
  return 'Boa noite';
}

export function comporMural(f: FontesDoMural, agora: Date, fuso: string): Mural {
  const p = partesNoFuso(agora, fuso);
  const hoje = p.data;
  const inicioHoje = inicioDoDia(hoje, fuso);
  const inicioJanela = inicioDoDia(somarDias(hoje, -JANELA_MURAL_DIAS), fuso);
  const hora = (d: Date) => horaComFuso(d, fuso);
  // o comentário diz a qual registro se refere (pode cair longe dele no mural): "Almoço · 12:30, hoje às 12:41"
  const sobreORegistro = (e: FontesDoMural['diario'][number]) => {
    const dia = partesNoFuso(e.dataHora, fuso).data;
    const quando = dia === hoje ? 'hoje' : separadorDoDia(dia, hoje).toLocaleLowerCase('pt-BR');
    return `${e.refeicaoDoPlano ?? e.refeicao}, ${quando} às ${hora(e.dataHora).semFuso}`;
  };
  const itens: ItemDoMural[] = [];

  // RN-196 / RN-197: refeições de hoje com horário, a partir de 90 min antes; a resposta de hoje esconde o "Comi assim"
  const respondidasHoje = new Set(f.diario.flatMap((e) => (e.resposta && e.refeicaoDoPlano && e.dataHora >= inicioHoje ? [e.refeicaoDoPlano] : [])));
  const comHorario = (f.plano?.refeicoes ?? []).filter((r) => /^\d{2}:\d{2}$/.test(r.horario)).sort((a, b) => a.horario.localeCompare(b.horario));
  comHorario.forEach((r, i) => {
    const [h, m] = r.horario.split(':').map(Number);
    const minutos = h * 60 + m;
    if (p.minutos < minutos - ANTECEDENCIA_REFEICAO_MIN) return;
    const resumo = resumoDaRefeicao(r.itens);
    const corpo = p.minutos < minutos ? MSG_MURAL.refeicaoAntes(r.horario, r.nome, resumo) : MSG_MURAL.refeicaoDepois(r.nome, r.horario, resumo);
    itens.push({
      chave: `refeicao:${r.id}`,
      tipo: 'refeicao',
      autor: 'consultorio',
      quando: paraInstante(hoje, r.horario, fuso) ?? agora,
      // Desvio 3: a hora do plano é relógio de parede (sem a sigla do fuso)
      hora: { semFuso: r.horario, comFuso: r.horario },
      texto: i === 0 ? `${MSG_MURAL.saudacao(saudacao(p.minutos), f.primeiroNome)} ${corpo}` : corpo,
      refeicaoId: r.id,
      respondida: respondidasHoje.has(rotuloDaRefeicao(r.nome, r.horario)),
    });
  });

  for (const e of f.diario) {
    if (e.dataHora >= inicioJanela)
      itens.push({ chave: `registro:${e.id}`, tipo: 'registro', autor: 'voce', quando: e.dataHora, hora: hora(e.dataHora), refeicao: e.refeicaoDoPlano ?? e.refeicao, resposta: e.resposta, texto: e.texto, foto: e.foto });
    if (e.comentario && e.comentadoEm && e.comentadoEm >= inicioJanela)
      itens.push({ chave: `comentario:${e.id}`, tipo: 'comentario', autor: 'nutricionista', quando: e.comentadoEm, hora: hora(e.comentadoEm), sobre: sobreORegistro(e), texto: e.comentario });
  }

  // RN-199: envio de hoje, ou mudança de situação nos últimos 7 dias (o processamento também conta como mudança)
  for (const e of f.envios) {
    const mudou = e.mudouEm.getTime() > e.enviadoEm.getTime() && e.mudouEm >= inicioJanela;
    if (e.enviadoEm < inicioHoje && !mudou) continue;
    const quando = mudou ? e.mudouEm : e.enviadoEm;
    itens.push({ chave: `exame:${e.id}`, tipo: 'exame', autor: 'consultorio', quando, hora: hora(quando), texto: MSG_MURAL.exame(nomeDoEnvio(e.nome, formatarDataNoFuso(e.enviadoEm, fuso)), e.situacao) });
  }

  // D13: a consulta dos próximos 7 dias e os documentos novos entram em Hoje na hora da leitura, sem hora própria
  const c = f.consulta;
  if (c && c.inicio.getTime() <= agora.getTime() + JANELA_MURAL_DIAS * 86_400_000) {
    itens.push({
      chave: `consulta:${c.id}`,
      tipo: 'consulta',
      autor: 'consultorio',
      quando: agora,
      hora: null,
      consultaId: c.id,
      texto: { semFuso: MSG_MURAL.consulta(quandoRelativo(c.inicio, agora, fuso), c.modalidade), comFuso: MSG_MURAL.consulta(quandoRelativoComFuso(c.inicio, agora, fuso), c.modalidade) },
      podeConfirmar: c.podeConfirmar,
    });
  }
  if (f.plano?.publicadoEm && f.plano.publicadoEm >= inicioJanela)
    itens.push({ chave: 'plano', tipo: 'plano', autor: 'consultorio', quando: f.plano.publicadoEm, hora: hora(f.plano.publicadoEm), texto: MSG_MURAL.planoNovo });
  for (const k of f.conteudos.filter((x) => x.publicadoEm >= inicioJanela).slice(0, MAX_CONTEUDOS_NO_MURAL))
    itens.push({ chave: `conteudo:${k.id}`, tipo: 'conteudo', autor: 'consultorio', quando: k.publicadoEm, hora: hora(k.publicadoEm), conteudoId: k.id, titulo: k.titulo, texto: MSG_MURAL.conteudo(k.titulo) });
  if (f.documentosNovos > 0) itens.push({ chave: 'documentos', tipo: 'documentos', autor: 'consultorio', quando: agora, hora: null, texto: MSG_MURAL.documentos(f.documentosNovos) });

  const ordenados = itens
    .filter((i) => i.quando >= inicioJanela)
    .sort((a, b) => a.quando.getTime() - b.quando.getTime() || a.chave.localeCompare(b.chave))
    .slice(-MAX_ITENS_MURAL);
  const porDia = new Map<string, ItemDoMural[]>();
  for (const i of ordenados) {
    if (i.quando >= inicioHoje) continue;
    const dia = partesNoFuso(i.quando, fuso).data;
    porDia.set(dia, [...(porDia.get(dia) ?? []), i]);
  }
  return {
    primeiroNome: f.primeiroNome,
    hoje: ordenados.filter((i) => i.quando >= inicioHoje),
    anteriores: [...porDia].map(([dia, lista]) => ({ dia, rotulo: separadorDoDia(dia, hoje), itens: lista })),
    vazio: ordenados.length === 0,
    semPlano: f.plano === null,
  };
}
```

Run: `pnpm vitest run src/modules/portal/mural-regras.test.ts src/modules/portal/datas-portal.test.ts` → PASS. Se o teste da janela falhar no `lista[0]`, conferir a conta (45 registros de 3 em 3 h desde 01/10 08:00; o 40º mais recente é o `e5`) antes de mexer no código.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint
git add src/modules/portal/datas-portal.ts src/modules/portal/datas-portal.test.ts src/modules/portal/mural-regras.ts src/modules/portal/mural-regras.test.ts
git commit -m "$(cat <<'MSG'
feat(portal): regras puras do mural Hoje e datas do portal (P16-05)

comporMural decide itens, ordem, janela de 7 dias, máximo de 40, saudação,
autoria (só o comentário da nutricionista leva a voz dela, RN-194) e quais
respostas aparecem; datas por extenso curtas no fuso do consultório.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 6: Leitura do mural — `muralDoPaciente` numa transação (P16-06)

**Revisão: completa (agente revisor-rls)** — uma transação `withTenant` com o contexto do paciente (RLS por paciente), `auditRead` uma vez por entidade com dado de saúde (plano, diário, exames enviados), nada lido de outro paciente ou de outro tenant, conteúdo só pela audiência (RN-12, sem a liberação das receitas do plano), documentos só com a liberação do consultório, sem N+1 e só com índices existentes (RNF-190).

**Files:**
- Create: `src/modules/portal/mural.ts` (+ `mural.test.ts`)
- Modify: `src/modules/portal/conteudos.ts` (função nova), `src/modules/documentos/portal.ts` (`novosNoPortal` passa a chamar `novosNoPortalNaTransacao`, sem mudar o comportamento)

**Interfaces:**
- Consumes: T5 (`comporMural`, `Mural`, `JANELA_MURAL_DIAS`, `LIMITE_DIARIO_NO_MURAL`, `MAX_CONTEUDOS_NO_MURAL`), T7 (`paraRegistro` com `resposta`/`refeicaoDoPlano`), T4 (`primeiroNome`); `lerPlanoNaTransacao` (`src/modules/plano-alimentar/carregar.ts`, já audita `plano_alimentar`), `listarConsultasNaTransacao`, `STATUS_ATIVOS`, `TenantAgenda` (`src/modules/agenda/consultas.ts`), `podeAlterarPeloPaciente` (`src/modules/agenda/cancelamento.ts`), `situacaoParaPaciente` (`exames-enviados-constantes.ts`), `auditRead`; nos testes, `planoPublicado` (T1), `envioNoBanco` (`test/exames-enviados.ts`), `consultaDireta` (`test/agenda.ts`), `novoConteudo` (`test/conteudos.ts`), `comentarRegistro` (`diario-nutri.ts`), `registrarNoDiario`.
- Produces: `muralDoPaciente(ctx, tenant: TenantAgenda, agora, db?) → Promise<Mural>`; `conteudosNovosNaTransacao(tx, patientId, desde, limite)`; `novosNoPortalNaTransacao(tx, ctx)`.

- [ ] **Step 1: Testes (falham)**

Criar `src/modules/portal/mural.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { novoConteudo } from '../../../test/conteudos';
import { makeDb } from '../../../test/db';
import { envioNoBanco } from '../../../test/exames-enviados';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { auditLog, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { registrarNoDiario } from './diario';
import { comentarRegistro } from './diario-nutri';
import { muralDoPaciente } from './mural';
import type { ItemDoMural, Mural } from './mural-regras';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // a publicação do plano enfileira o PDF; o comentário, o push
  await closeDb();
  await app.pool.end();
});

const SP = 'America/Sao_Paulo';
const todos = (m: Mural): ItemDoMural[] => [...m.anteriores.flatMap((d) => d.itens), ...m.hoje];
const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0];
const leituras = async (T: { tenantId: string; ctx: Parameters<typeof withTenant>[0] }, patientId: string) => {
  const r = await withTenant(
    T.ctx,
    (tx) => tx.select({ entidade: auditLog.entidade, n: count() }).from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'))).groupBy(auditLog.entidade),
    app.db,
  );
  return Object.fromEntries(r.map((x) => [x.entidade, x.n]));
};
/** HH:MM de daqui a 30 min em São Paulo (perto da meia-noite, 23:59: a refeição é sempre de hoje e já está na janela de 90 min). */
const horarioProximo = (agora: Date) => {
  const p = partesNoFuso(new Date(agora.getTime() + 30 * 60_000), SP);
  return p.data === partesNoFuso(agora, SP).data ? p.hora : '23:59';
};

describe('muralDoPaciente (Plano 16, RN-199, RN-200, RNF-190)', () => {
  it('junta as fontes do vínculo e audita a leitura uma vez por entidade com dado de saúde (plano, diário, exames enviados)', async () => {
    const agora = new Date();
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Marina Souza' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { refeicoes } = await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: horarioProximo(agora) }] });
    const registro = await registrarNoDiario(ctx, { fuso: SP }, { refeicao: 'Café da manhã', texto: 'pão com ovo', foto: null }, { db: app.db });
    await comentarRegistro(T.ctx, registro.id, 'Ótima combinação!', { db: app.db });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', nome: 'Hemograma' });
    await consultaDireta(app.db, T.ctx, p.id, new Date(agora.getTime() + 26 * 3600_000), 60, { modalidade: 'online' });
    await novoConteudo(app.db, T, { titulo: 'Lanches para levar' });
    const antes = await leituras(T, p.id);

    const mural = await muralDoPaciente(ctx, await tenantDe(T.tenantId), agora, app.db);

    expect(mural.primeiroNome).toBe('Marina');
    const porTipo = new Map(todos(mural).map((i) => [i.tipo, i]));
    expect(porTipo.get('refeicao')).toMatchObject({ refeicaoId: refeicoes[0].id, respondida: false });
    expect(porTipo.get('registro')).toMatchObject({ autor: 'voce', texto: 'pão com ovo' });
    expect(porTipo.get('comentario')).toMatchObject({ autor: 'nutricionista', texto: 'Ótima combinação!' });
    expect(porTipo.get('exame')).toMatchObject({ texto: 'Hemograma: Aguardando sua nutricionista' });
    expect(porTipo.get('consulta')).toMatchObject({ podeConfirmar: true });
    expect(porTipo.get('plano')).toMatchObject({ texto: 'Seu novo plano alimentar está disponível.' });
    expect(porTipo.get('conteudo')).toMatchObject({ titulo: 'Lanches para levar' });
    expect(porTipo.has('documentos')).toBe(false); // documentos não liberados no consultório (D20 do 10A)

    const depois = await leituras(T, p.id);
    const novas = Object.fromEntries(Object.entries(depois).map(([k, n]) => [k, n - (antes[k] ?? 0)]).filter(([, n]) => n !== 0));
    expect(novas).toEqual({ plano_alimentar: 1, diario: 1, exames_enviados: 1 });
  });

  it('isolamento: nada de outro paciente do consultório, de outro consultório, nem conteúdo fora da audiência', async () => {
    const agora = new Date();
    const T = await novoTenant(app.db);
    const [p, outro] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const U = await novoTenant(app.db);
    const deU = await novoPaciente(app.db, U.ctx);
    await registrarNoDiario(ctxPaciente(T.tenantId, outro.id), { fuso: SP }, { refeicao: 'Jantar', texto: 'segredo do outro', foto: null }, { db: app.db });
    await registrarNoDiario(ctxPaciente(U.tenantId, deU.id), { fuso: SP }, { refeicao: 'Jantar', texto: 'segredo de outro consultório', foto: null }, { db: app.db });
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido', nome: 'Exame do outro' });
    await consultaDireta(app.db, T.ctx, outro.id, new Date(agora.getTime() + 26 * 3600_000));
    await novoConteudo(app.db, T, { titulo: 'Só para o outro', visibilidade: 'pacientes', pacientes: [outro.id] });
    const mural = await muralDoPaciente(ctxPaciente(T.tenantId, p.id), await tenantDe(T.tenantId), agora, app.db);
    expect(JSON.stringify(mural)).not.toMatch(/segredo|Exame do outro|Só para o outro/);
    expect(mural.vazio).toBe(true);
    expect(await leituras(T, p.id)).toEqual({}); // nada lido, nada auditado
  });

  it('o "Comi assim" de hoje marca a refeição como respondida; envio cancelado não entra', async () => {
    const agora = new Date();
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { refeicoes } = await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: horarioProximo(agora) }] });
    await registrarNoDiario(ctx, { fuso: SP }, { refeicao: null, texto: '', foto: null, refeicaoId: refeicoes[0].id, resposta: 'como_no_plano' }, { db: app.db });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado', nome: 'Cancelado' });
    const mural = await muralDoPaciente(ctx, await tenantDe(T.tenantId), agora, app.db);
    expect(todos(mural).find((i) => i.tipo === 'refeicao')).toMatchObject({ respondida: true });
    expect(todos(mural).find((i) => i.tipo === 'registro')).toMatchObject({ resposta: 'como_no_plano' });
    expect(JSON.stringify(mural)).not.toContain('Cancelado');
  });

  it('só em sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await expect(muralDoPaciente(T.ctx, await tenantDe(T.tenantId), new Date(), app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
```

(`contents.visibilidade` aceita `'todos' | 'etiquetas' | 'pacientes'`, CHECK `contents_visibilidade_valida`; o helper grava a audiência em `content_audience`.)

Run: `pnpm vitest run src/modules/portal/mural.test.ts` → FAIL (`./mural` não existe).

- [ ] **Step 2: As funções "na transação"**

No fim de `src/modules/portal/conteudos.ts` (acrescentar `gte`, `not` ao import de `drizzle-orm` e `type Tx` ao de `@/db/client`):

```ts
/**
 * Plano 16 (mural, RN-199): até `limite` conteúdos publicados desde `desde` que o paciente ainda não abriu. A RLS de
 * `contents` aplica a audiência (RN-12) — sem a liberação das receitas do plano, que é só de planoDoPaciente. Sem auditRead (P07 D6).
 */
export async function conteudosNovosNaTransacao(tx: Tx, patientId: string, desde: Date, limite: number): Promise<{ id: string; titulo: string; publicadoEm: Date }[]> {
  const idDoConteudo = sql`${contents}.${sql.identifier(contents.id.name)}`;
  const visto = sql`exists (select 1 from ${contentViews} v where v.content_id = ${idDoConteudo} and v.patient_id = ${patientId})`;
  const r = await tx
    .select({ id: contents.id, titulo: contents.titulo, publicadoEm: contents.publicadoEm })
    .from(contents)
    .where(and(eq(contents.status, 'publicado'), gte(contents.publicadoEm, desde), not(visto)))
    .orderBy(desc(contents.publicadoEm), desc(contents.id))
    .limit(limite);
  return r.map((c) => ({ id: c.id, titulo: c.titulo, publicadoEm: c.publicadoEm! }));
}
```

Em `src/modules/documentos/portal.ts`, trocar `novosNoPortal` por:

```ts
/** O número do cartão do Início (e do item do mural): assinados ainda não abertos. Sem auditRead (10A D17: contagem). */
export async function novosNoPortal(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  return withTenant(ctx, (tx) => novosNoPortalNaTransacao(tx, ctx), db);
}

/** Plano 16: o mesmo, dentro da transação do mural (muralDoPaciente). Só numa sessão de paciente. */
export async function novosNoPortalNaTransacao(tx: Tx, ctx: TenantContext): Promise<number> {
  if (!(await ativo(tx, ctx))) return 0;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(signedDocuments)
    .where(
      and(
        eq(signedDocuments.patientId, ctx.patientId!),
        eq(signedDocuments.status, 'assinado'),
        isNull(signedDocuments.anonimizadoEm),
        notExists(
          tx
            .select({ x: sql`1` })
            .from(signedDocumentReceipts)
            .where(and(eq(signedDocumentReceipts.documentoId, signedDocuments.id), eq(signedDocumentReceipts.evento, 'aberto'))),
        ),
      ),
    );
  return r?.n ?? 0;
}
```

- [ ] **Step 3: O mural**

Criar `src/modules/portal/mural.ts`:

```ts
import { and, desc, eq, gt, gte, inArray, lt, ne, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, diaryEntries, examSubmissions, mealPlans, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { podeAlterarPeloPaciente } from '@/modules/agenda/cancelamento';
import { listarConsultasNaTransacao, STATUS_ATIVOS, type TenantAgenda } from '@/modules/agenda/consultas';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { novosNoPortalNaTransacao } from '@/modules/documentos/portal';
import { situacaoParaPaciente } from '@/modules/pacientes/exames-enviados-constantes';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import { auditRead } from '@/modules/plataforma/audit';
import { conteudosNovosNaTransacao } from './conteudos';
import { paraRegistro } from './diario';
import { comporMural, JANELA_MURAL_DIAS, LIMITE_DIARIO_NO_MURAL, MAX_CONTEUDOS_NO_MURAL, type FontesDoMural, type Mural } from './mural-regras';
import { primeiroNome } from './perfil';
import { pacienteDaSessao } from './sessao';

const DIA_MS = 86_400_000;

/**
 * Plano 16 (§4.3, RN-199, RN-200, RNF-190): as fontes do mural numa transação, com o contexto do paciente (a RLS entrega só
 * as linhas dele). auditRead uma vez por entidade com dado de saúde: o plano (lerPlanoNaTransacao, com o id do plano), o
 * diário e os exames enviados; agenda, conteúdos e a contagem de documentos não (P05 D10, P07 D6, 10A D17). Nada é gravado.
 * Índices: diary_entries_paciente_idx, exam_submissions_paciente_idx, o de appointments e o de meal_plans por paciente.
 */
export async function muralDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()): Promise<Mural> {
  const patientId = pacienteDaSessao(ctx, 'muralDoPaciente');
  const hoje = partesNoFuso(agora, tenant.fuso).data;
  const janela = inicioDoDia(somarDias(hoje, -JANELA_MURAL_DIAS), tenant.fuso);
  const fontes = await withTenant(
    ctx,
    async (tx): Promise<FontesDoMural> => {
      const [p] = await tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, patientId));

      const [publicado] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      // auditRead do plano dentro (D22), só se há plano; sem a liberação das receitas (o mural não mostra receita)
      const plano = publicado ? await lerPlanoNaTransacao(tx, publicado.id, { comMedidas: false }) : null;

      const diario = await tx
        .select()
        .from(diaryEntries)
        .where(and(eq(diaryEntries.patientId, patientId), or(gte(diaryEntries.dataHora, janela), gte(diaryEntries.comentadoEm, janela))))
        .orderBy(desc(diaryEntries.dataHora))
        .limit(LIMITE_DIARIO_NO_MURAL);
      if (diario.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });

      const envios = await tx
        .select()
        .from(examSubmissions)
        .where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado'), or(gte(examSubmissions.createdAt, janela), gte(examSubmissions.updatedAt, janela))))
        .orderBy(desc(examSubmissions.createdAt))
        .limit(20);
      if (envios.length) await auditRead(tx, { entidade: 'exames_enviados', entidadeId: null, patientId });

      const [consulta] = await listarConsultasNaTransacao(
        tx,
        and(inArray(appointments.status, [...STATUS_ATIVOS]), gt(appointments.fim, agora), lt(appointments.inicio, new Date(agora.getTime() + JANELA_MURAL_DIAS * DIA_MS))),
        { ordem: 'asc', limite: 1 },
      );
      const conteudos = await conteudosNovosNaTransacao(tx, patientId, janela, MAX_CONTEUDOS_NO_MURAL);
      const documentosNovos = await novosNoPortalNaTransacao(tx, ctx);

      return {
        primeiroNome: primeiroNome(p?.nome ?? ''),
        plano: plano
          ? {
              publicadoEm: plano.publicadoEm ? new Date(plano.publicadoEm) : null,
              refeicoes: plano.refeicoes.map((r) => ({ id: r.id, nome: r.nome, horario: r.horario, itens: r.itens.filter((i) => i.substituiItemId === null).map((i) => ({ nome: i.nome })) })),
            }
          : null,
        diario: diario.map((e) => {
          const r = paraRegistro(e);
          return { id: r.id, dataHora: r.dataHora, refeicao: r.refeicao, texto: r.texto, foto: r.foto, resposta: r.resposta, refeicaoDoPlano: r.refeicaoDoPlano, comentario: r.comentario, comentadoEm: r.comentadoEm };
        }),
        // mudouEm (FontesDoMural): o processamento não é mudança — só a revisão, a expiração e a falha
        envios: envios.map((e) => ({
          id: e.id,
          nome: e.nome,
          enviadoEm: e.createdAt,
          mudouEm: e.status === 'processando' || e.status === 'recebido' ? e.createdAt : (e.revisadoEm ?? e.updatedAt),
          situacao: situacaoParaPaciente(e),
        })),
        consulta: consulta
          ? { id: consulta.id, inicio: consulta.inicio, modalidade: consulta.modalidade, podeConfirmar: consulta.status === 'agendada' && podeAlterarPeloPaciente(consulta.inicio, tenant.cancelamentoMinH, agora) }
          : null,
        conteudos,
        documentosNovos,
      };
    },
    db,
  );
  return comporMural(fontes, agora, tenant.fuso);
}
```

Run: `pnpm vitest run src/modules/portal/mural.test.ts src/modules/documentos/portal.test.ts src/modules/portal/conteudos.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck && pnpm lint
git add src/modules/portal/mural.ts src/modules/portal/mural.test.ts src/modules/portal/conteudos.ts src/modules/documentos/portal.ts
git commit -m "$(cat <<'MSG'
feat(portal): muralDoPaciente lê as fontes do mural numa transação (P16-06)

Plano, diário, envios de exame, próxima consulta, conteúdos novos e
documentos novos pela RLS do paciente, com auditRead uma vez por entidade
de saúde (RN-200). conteudosNovosNaTransacao e novosNoPortalNaTransacao no
molde das funções NaTransacao que já existem.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 7: Respostas no diário — "Comi assim" e "Comi outra coisa" pelo `registrarNoDiario`, e os rótulos no feed da nutricionista (P16-07)

**Revisão: completa (agente revisor-rls)** — a refeição lida pela RLS do paciente (só do próprio plano **publicado**), a idempotência e o limite com o paciente travado, a ordem das travas, a rota, a trilha (o gatilho grava a resposta com o ator), nada em log.

**Files:**
- Modify: `src/modules/portal/diario.ts` (+ `diario.test.ts`), `src/app/api/p/diario/route.ts` (+ `route.test.ts`), `src/modules/portal/diario-nutri.test.ts`, `src/app/painel/diarios/page.tsx`, `src/app/painel/diarios/[id]/page.tsx`

**Interfaces:**
- Consumes: T1 (`resposta`, `refeicaoDoPlano`, `ehRespostaDoDiario`, `rotuloDaRefeicao`, `refeicaoDoDiario`, `ROTULO_RESPOSTA_NUTRI`, `MSG_DIARIO.refeicaoNaoEncontrada`, `planoPublicado`); `meals`, `mealPlans`, `idValido`, `inicioDoDia`, `partesNoFuso`, `somarDias`, `salvarArquivo`.
- Produces: `registrarNoDiario(ctx, tenant, { refeicao, texto, foto, refeicaoId?, resposta? }, deps?) → { id, semFoto, jaRegistrado }`; `respostasDeHoje(ctx, fuso, o?) → Set<string>`; `RegistroDoDiario.resposta`, `RegistroDoDiario.refeicaoDoPlano` (o feed da nutricionista, `ItemDoFeed`, herda); a rota `POST /api/p/diario` aceita `refeicaoId` e `resposta` (multipart, como hoje) e devolve `jaRegistrado`; status **404** para a refeição que não é do plano publicado.

- [ ] **Step 1: Testes do módulo (falham)**

No fim de `src/modules/portal/diario.test.ts` (acrescentar ao topo `import { planoPublicado } from '../../../test/plano';`, `import { patients } from '@/db/schema'` junto dos outros e `import { stopBoss } from '@/jobs/boss'` se faltar — o arquivo já para o pg-boss no `afterAll`):

```ts
describe('respostas à refeição do plano (Plano 16, RN-197, D3)', () => {
  const ALMOCO_1240 = new Date('2026-10-05T15:40:00Z'); // 12:40 em São Paulo
  async function comPlano(o: { refeicoes?: { nome: string; horario: string }[] } = {}) {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const plano = await planoPublicado(app.db, T, p.id, { refeicoes: o.refeicoes ?? [{ nome: 'Almoço', horario: '12:30' }, { nome: 'Pré-treino', horario: '17:00' }, { nome: 'Ceia', horario: '' }] });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const linhas = () => withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), app.db);
    return { T, p, ctx, plano, linhas, ref: (nome: string) => plano.refeicoes.find((r) => r.nome === nome)!.id };
  }

  it('"Comi assim": refeição do diário mapeada pelo nome, resposta e a cópia "{nome} · {HH:MM}", sem texto nem foto', async () => {
    const { ctx, linhas, ref } = await comPlano();
    const r = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect(r).toMatchObject({ semFoto: false, jaRegistrado: false });
    expect(await linhas()).toEqual([expect.objectContaining({ id: r.id, refeicao: 'Almoço', resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30', texto: null, fotoStatus: 'sem_foto', dataHora: ALMOCO_1240 })]);
  });

  it('nome fora da lista vira "Outro"; refeição sem horário leva só o nome', async () => {
    const { ctx, linhas, ref } = await comPlano();
    await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Pré-treino'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Ceia'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect((await linhas()).map((e) => [e.refeicao, e.refeicaoDoPlano]).sort()).toEqual([['Ceia', 'Ceia'], ['Outro', 'Pré-treino · 17:00']]);
  });

  it('uma resposta por refeição do plano por dia: o segundo "Comi assim" devolve o mesmo registro — também em duas conexões ao mesmo tempo', async () => {
    const { ctx, linhas, ref } = await comPlano();
    const entrada = { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' };
    const [a, b] = await Promise.all([registrarNoDiario(ctx, SP, entrada, deps(ALMOCO_1240)), registrarNoDiario(ctx, SP, entrada, deps(ALMOCO_1240))]);
    expect(a.id).toBe(b.id);
    expect([a.jaRegistrado, b.jaRegistrado].sort()).toEqual([false, true]);
    expect(await linhas()).toHaveLength(1);
    // no dia seguinte, outra resposta à mesma refeição entra
    await registrarNoDiario(ctx, SP, entrada, deps(new Date('2026-10-06T15:40:00Z')));
    expect(await linhas()).toHaveLength(2);
  });

  it('"Comi outra coisa" exige texto ou foto; com texto, entra com a resposta; depois de uma resposta, o registro com conteúdo vira registro comum (D3)', async () => {
    const { ctx, linhas, ref } = await comPlano();
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '  ', foto: null, refeicaoId: ref('Almoço'), resposta: 'outra_coisa' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.vazio });
    const outra = await registrarNoDiario(ctx, SP, { refeicao: null, texto: 'Sanduíche natural', foto: null, refeicaoId: ref('Almoço'), resposta: 'outra_coisa' }, deps(ALMOCO_1240));
    const depois = await registrarNoDiario(ctx, SP, { refeicao: null, texto: 'e um suco', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect(depois.id).not.toBe(outra.id);
    const porId = new Map((await linhas()).map((e) => [e.id, e]));
    expect(porId.get(outra.id)).toMatchObject({ resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30', texto: 'Sanduíche natural' });
    expect(porId.get(depois.id)).toMatchObject({ resposta: null, refeicaoDoPlano: null, refeicao: 'Almoço', texto: 'e um suco' });
  });

  it('refeição de outro paciente, do rascunho, id inválido ou resposta sem refeição: nada gravado', async () => {
    const { T, ctx, linhas } = await comPlano();
    const outro = await novoPaciente(app.db, T.ctx);
    const deOutro = (await planoPublicado(app.db, T, outro.id)).refeicoes[0].id;
    const naoEncontrada = { geral: MSG_DIARIO.refeicaoNaoEncontrada };
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: deOutro, resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual(naoEncontrada);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: 'nao-e-uuid', resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual(naoEncontrada);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Almoço', texto: '', foto: null, resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.formulario });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: deOutro, resposta: 'talvez' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.formulario });
    expect(await linhas()).toEqual([]);
  });

  it('limite de 10 por dia (RN-07): o "Comi assim" novo recusa; o repetido de uma refeição já respondida devolve o registro', async () => {
    const { ctx, ref } = await comPlano();
    const almoco = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    for (let i = 0; i < 9; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps(ALMOCO_1240));
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Pré-treino'), resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual({ geral: MSG_DIARIO.limite });
    const repetido = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    expect(repetido).toMatchObject({ id: almoco.id, jaRegistrado: true });
  });

  it('vínculo bloqueado depois de abrir a tela: "Conta temporariamente indisponível"', async () => {
    const { T, p, ctx, ref } = await comPlano();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: null, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240)))).toEqual({ geral: 'Conta temporariamente indisponível' });
  });

  it('foto com "Comi assim": a resposta vai junto da foto em processamento; respostasDeHoje e a leitura devolvem a resposta', async () => {
    const { ctx, ref } = await comPlano();
    const r = await registrarNoDiario(ctx, SP, { refeicao: null, texto: '', foto: JPEG, refeicaoId: ref('Almoço'), resposta: 'como_no_plano' }, deps(ALMOCO_1240));
    const lista = await diarioDoPaciente(ctx, { db: app.db });
    expect(lista).toEqual([expect.objectContaining({ id: r.id, resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30', foto: { estado: 'processando' } })]);
    expect(await respostasDeHoje(ctx, SP.fuso, { db: app.db, agora: ALMOCO_1240 })).toEqual(new Set(['Almoço · 12:30']));
    expect(await respostasDeHoje(ctx, SP.fuso, { db: app.db, agora: new Date('2026-10-06T15:40:00Z') })).toEqual(new Set());
  });
});
```

(Importar `respostasDeHoje` junto de `DiarioError, diarioDoPaciente, registrarNoDiario` de `./diario`.)

Em `src/modules/portal/diario-nutri.test.ts`, acrescentar um caso (o arquivo já cria tenant, paciente e registros; conferir os helpers locais do topo):

```ts
  it('Plano 16 (§4.9): o registro de "Comi assim" chega ao feed e ao registro aberto com a resposta e a refeição do plano', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30' }), app.db);
    const [item] = await feedDeDiarios(T.ctx, { db: app.db });
    expect(item).toMatchObject({ resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30', texto: null });
    expect((await abrirRegistro(T.ctx, item.id, { db: app.db }))?.resposta).toBe('como_no_plano');
  });
```

Run: `pnpm vitest run src/modules/portal/diario.test.ts src/modules/portal/diario-nutri.test.ts` → FAIL.

- [ ] **Step 2: O módulo**

Em `src/modules/portal/diario.ts`:

1. Imports: acrescentar `isNotNull` ao import de `drizzle-orm`; `meals, mealPlans` ao de `@/db/schema`; `idValido` de `@/modules/pacientes/base`; e, de `./diario-constantes`, `ehRespostaDoDiario`, `refeicaoDoDiario`, `rotuloDaRefeicao`, `type RespostaDoDiario`.
2. `RegistroDoDiario` ganha `resposta: RespostaDoDiario | null; refeicaoDoPlano: string | null;` e `paraRegistro` devolve `resposta: (e.resposta as RespostaDoDiario | null) ?? null, refeicaoDoPlano: e.refeicaoDoPlano,`.
3. Trocar `conferirLimite` e `registrarNoDiario` por:

```ts
/** D12: trava o paciente (a corrida do 11º registro e a da resposta repetida). Fora de "ativo" (RN-08) não registra. */
async function travarPaciente(tx: Tx, patientId: string): Promise<void> {
  const [p] = await tx.select({ status: patients.status }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo') throw new DiarioError({ geral: 'Conta temporariamente indisponível' });
}

/** O dia de `agora` no fuso do tenant, como intervalo [início, fim). */
function diaDe(agora: Date, fuso: string): { inicio: Date; fim: Date } {
  const hoje = partesNoFuso(agora, fuso).data;
  return { inicio: inicioDoDia(hoje, fuso), fim: inicioDoDia(somarDias(hoje, 1), fuso) };
}

/** RN-07: os registros do dia (no fuso do tenant), com o paciente já travado. */
async function conferirLimite(tx: Tx, patientId: string, fuso: string, agora: Date): Promise<void> {
  const { inicio, fim } = diaDe(agora, fuso);
  const [{ n }] = await tx
    .select({ n: count() })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.patientId, patientId), gte(diaryEntries.dataHora, inicio), lt(diaryEntries.dataHora, fim)));
  if (n >= LIMITE_DIARIO_POR_DIA) throw new DiarioError({ geral: MSG_DIARIO.limite });
}

/** Plano 16 (RN-197): a refeição do plano PUBLICADO do paciente da sessão (a RLS já esconde a dos outros); senão null. */
async function refeicaoDoPlanoPublicado(tx: Tx, patientId: string, refeicaoId: string): Promise<{ nome: string; horario: string } | null> {
  const [r] = await tx
    .select({ nome: meals.nome, horario: meals.horario })
    .from(meals)
    .innerJoin(mealPlans, and(eq(mealPlans.id, meals.planId), eq(mealPlans.tenantId, meals.tenantId)))
    .where(and(eq(meals.id, refeicaoId), eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
  return r ? { nome: r.nome, horario: r.horario ? r.horario.slice(0, 5) : '' } : null;
}

type Gravacao = { refeicao: string; resposta: RespostaDoDiario | null; refeicaoDoPlano: string | null };

/**
 * US-042 / RN-07 e, no Plano 16, as respostas à refeição do plano (RN-197): `refeicaoId` + `resposta` ("como_no_plano"
 * dispensa texto e foto; "outra_coisa" exige um dos dois). A refeição é lida do plano publicado pela RLS e a resposta é uma
 * por refeição do plano por dia, com o paciente travado: o "Comi assim" repetido (toque duplo, outra aba) devolve o registro
 * que já existe — mesmo no limite de 10; com texto ou foto, depois de uma resposta, o registro entra como registro comum (D3).
 * A foto original (JPEG/PNG/HEIC ≤ 10 MB, tipo pelo conteúdo) entra por salvarArquivo e o registro + o job de conversão vão
 * no `registrar` (mesma transação, CLAUDE.md regra 9). Cota esgotada com texto → o texto é salvo sem a foto; só a foto → erro.
 */
export async function registrarNoDiario(
  ctx: TenantContext,
  tenant: { fuso: string },
  input: { refeicao: unknown; texto: unknown; foto: Buffer | null; refeicaoId?: unknown; resposta?: unknown },
  deps: Deps = {},
): Promise<{ id: string; semFoto: boolean; jaRegistrado: boolean }> {
  const patientId = pacienteDaSessao(ctx, 'registrarNoDiario');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const refeicaoId = typeof input.refeicaoId === 'string' && input.refeicaoId !== '' ? input.refeicaoId : null;
  const respostaBruta = input.resposta === undefined || input.resposta === null || input.resposta === '' ? null : input.resposta;
  if (respostaBruta !== null && (!ehRespostaDoDiario(respostaBruta) || !refeicaoId)) throw new DiarioError({ geral: MSG_DIARIO.formulario });
  const resposta = respostaBruta as RespostaDoDiario | null;
  if (refeicaoId && !idValido(refeicaoId)) throw new DiarioError({ geral: MSG_DIARIO.refeicaoNaoEncontrada });
  const refeicaoInformada = typeof input.refeicao === 'string' ? input.refeicao : '';
  if (!refeicaoId && !(REFEICOES_DO_DIARIO as readonly string[]).includes(refeicaoInformada)) throw new DiarioError({ refeicao: MSG_DIARIO.refeicao });
  const texto = typeof input.texto === 'string' ? input.texto.normalize('NFC').trim() : '';
  // NUL não cabe num `text` do Postgres (SQLSTATE 22021): sem isto, um 500 em vez de um 400
  if (texto.includes('\0')) throw new DiarioError({ geral: MSG_DIARIO.formulario });
  // Caracteres (code points), como o CHECK do banco (char_length) e a spec — não unidades UTF-16 (um emoji conta 1)
  if ([...texto].length > TEXTO_DIARIO_MAX) throw new DiarioError({ texto: MSG_DIARIO.texto });
  const foto = input.foto && input.foto.length > 0 ? input.foto : null;
  if (!texto && !foto && resposta !== 'como_no_plano') throw new DiarioError({ geral: MSG_DIARIO.vazio });
  if (foto && foto.length > FOTO_DIARIO_MAX_BYTES) throw new DiarioError({ foto: MSG_DIARIO.foto });

  /** Com o paciente travado: a refeição do plano, a resposta que vale (ou o registro que já existe) e o limite do dia. */
  const preparar = async (tx: Tx): Promise<Gravacao | { existente: string }> => {
    await travarPaciente(tx, patientId);
    let g: Gravacao = { refeicao: refeicaoInformada, resposta: null, refeicaoDoPlano: null };
    if (refeicaoId) {
      const r = await refeicaoDoPlanoPublicado(tx, patientId, refeicaoId);
      if (!r) throw new DiarioError({ geral: MSG_DIARIO.refeicaoNaoEncontrada });
      const rotulo = rotuloDaRefeicao(r.nome, r.horario);
      g = { refeicao: refeicaoDoDiario(r.nome), resposta: null, refeicaoDoPlano: null };
      if (resposta) {
        const { inicio, fim } = diaDe(agora, tenant.fuso);
        const [ja] = await tx
          .select({ id: diaryEntries.id })
          .from(diaryEntries)
          .where(and(eq(diaryEntries.patientId, patientId), isNotNull(diaryEntries.resposta), eq(diaryEntries.refeicaoDoPlano, rotulo), gte(diaryEntries.dataHora, inicio), lt(diaryEntries.dataHora, fim)))
          .limit(1);
        if (ja && !texto && !foto) return { existente: ja.id };
        if (!ja) g = { ...g, resposta, refeicaoDoPlano: rotulo };
      }
    }
    await conferirLimite(tx, patientId, tenant.fuso, agora);
    return g;
  };

  const soTexto = () =>
    withTenant(
      ctx,
      async (tx) => {
        const g = await preparar(tx);
        if ('existente' in g) return { id: g.existente, jaRegistrado: true };
        const [e] = await tx
          .insert(diaryEntries)
          .values({ tenantId: ctx.tenantId, patientId, dataHora: agora, refeicao: g.refeicao, texto: texto || null, resposta: g.resposta, refeicaoDoPlano: g.refeicaoDoPlano, createdAt: agora, updatedAt: agora })
          .returning({ id: diaryEntries.id });
        return { id: e.id, jaRegistrado: false };
      },
      db,
    );
  if (!foto) return { ...(await soTexto()), semFoto: false };

  // Fora da transação: o start do pg-boss não pode esperar segurando a conexão (e a trava) do paciente
  const boss = deps.boss ?? (await getBoss());
  let id = '';
  let gravacao: Gravacao = { refeicao: refeicaoInformada, resposta: null, refeicaoDoPlano: null };
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'diario_foto_original',
        conteudo: foto,
        permitidos: ['jpg', 'png', 'heic'],
        patientId,
        antesDaReserva: async (tx) => {
          const g = await preparar(tx);
          // com foto nunca há "existente" (só o "Comi assim" sem conteúdo é idempotente)
          if (!('existente' in g)) gravacao = g;
        },
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .insert(diaryEntries)
            .values({
              tenantId: ctx.tenantId,
              patientId,
              dataHora: agora,
              refeicao: gravacao.refeicao,
              texto: texto || null,
              resposta: gravacao.resposta,
              refeicaoDoPlano: gravacao.refeicaoDoPlano,
              fotoOriginalPath: arquivo.caminho,
              fotoStatus: 'processando',
              createdAt: agora,
              updatedAt: agora,
            })
            .returning({ id: diaryEntries.id });
          id = e.id;
          const job = await boss.send('diario-foto', { tenantId: ctx.tenantId, entryId: e.id }, { db: fromDrizzle(tx, sql) });
          if (!job) throw new Error('A fila recusou a conversão da foto');
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return { id, semFoto: false, jaRegistrado: false };
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new DiarioError({ foto: MSG_DIARIO.foto });
    if (e instanceof CotaEsgotadaError) {
      if (!texto) throw new DiarioError({ foto: MSG_COTA_ESGOTADA });
      return { ...(await soTexto()), semFoto: true };
    }
    throw e;
  }
}

/** Plano 16: os rótulos ("Almoço · 12:30") das refeições do plano já respondidas hoje (Plano e refeição aberta escondem o "Comi assim"). Auditado (D22). */
export async function respostasDeHoje(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<Set<string>> {
  const patientId = pacienteDaSessao(ctx, 'respostasDeHoje');
  const { inicio, fim } = diaDe(o.agora ?? new Date(), fuso);
  const r = await withTenant(
    ctx,
    async (tx) => {
      const linhas = await tx
        .select({ rotulo: diaryEntries.refeicaoDoPlano })
        .from(diaryEntries)
        .where(and(eq(diaryEntries.patientId, patientId), isNotNull(diaryEntries.resposta), gte(diaryEntries.dataHora, inicio), lt(diaryEntries.dataHora, fim)));
      if (linhas.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });
      return linhas;
    },
    o.db ?? getDb(),
  );
  return new Set(r.flatMap((x) => (x.rotulo ? [x.rotulo] : [])));
}
```

(As chamadas antigas `conferirLimite(tx, …)` só existiam dentro de `registrarNoDiario`; `travarPaciente` + `conferirLimite` substituem a função antiga.)

Run: `pnpm vitest run src/modules/portal/diario.test.ts src/modules/portal/diario-nutri.test.ts` → PASS (os testes antigos continuam: sem `refeicaoId` o caminho é o de antes).

- [ ] **Step 3: A rota (teste, falha, implementação)**

No fim de `src/app/api/p/diario/route.test.ts` (acrescentar `import { planoPublicado } from '../../../../../test/plano';`):

```ts
describe('Plano 16: respostas à refeição do plano (RN-197)', () => {
  it('"Comi assim" pela rota: 200 e jaRegistrado no segundo envio; refeição de outro paciente → 404 sem gravar', async () => {
    const { T, paciente, cookie } = await pacienteLogado();
    const { refeicoes } = await planoPublicado(db, T, paciente.id);
    const primeira = await enviar({ refeicaoId: refeicoes[0].id, resposta: 'como_no_plano' }, { cookie });
    expect(primeira.status).toBe(200);
    expect(await primeira.json()).toMatchObject({ ok: true, jaRegistrado: false });
    const segunda = await enviar({ refeicaoId: refeicoes[0].id, resposta: 'como_no_plano' }, { cookie });
    expect(await segunda.json()).toMatchObject({ ok: true, jaRegistrado: true });
    expect(await registros(T, paciente.id)).toHaveLength(1);

    const outro = await pacienteComConta(db, T);
    const alheia = (await planoPublicado(db, T, outro.paciente.id)).refeicoes[0].id;
    const r = await enviar({ refeicaoId: alheia, resposta: 'como_no_plano' }, { cookie });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ erros: { geral: MSG_DIARIO.refeicaoNaoEncontrada } });
    expect(await registros(T, paciente.id)).toHaveLength(1);
  });
});
```

Em `src/app/api/p/diario/route.ts`, no `receber`, passar os campos novos e o 404:

```ts
    const r = await registrarNoDiario(acesso.ctx, acesso.tenant, {
      refeicao: form.get('refeicao'),
      texto: form.get('texto'),
      foto,
      refeicaoId: form.get('refeicaoId'),
      resposta: form.get('resposta'),
    });
    // R9: com a cota esgotada o texto entra sem a foto, e a pessoa vê o texto da spec (US-042 "Cota de armazenamento")
    return resposta(200, { ok: true, id: r.id, jaRegistrado: r.jaRegistrado, mensagem: r.semFoto ? `${MSG_DIARIO.salvoSemFoto} ${MSG_COTA_ESGOTADA}` : MSG_DIARIO.salvo, semFoto: r.semFoto });
  } catch (e) {
    if (e instanceof DiarioError) {
      const status = e.erros.foto
        ? foto && foto.length > FOTO_DIARIO_MAX_BYTES ? 413 : e.erros.foto === MSG_DIARIO.foto ? 415 : 507
        : e.erros.geral === MSG_DIARIO.limite ? 409
        : e.erros.geral === MSG_DIARIO.refeicaoNaoEncontrada ? 404
        : 400;
      return resposta(status, { erros: e.erros });
    }
    throw e;
  }
```

Run: `pnpm vitest run src/app/api/p/diario/route.test.ts src/app/api/mesma-origem-rotas.test.ts` → PASS.

- [ ] **Step 4: O feed e o registro aberto da nutricionista (§4.9; painel como está, só o rótulo)**

Em `src/app/painel/diarios/page.tsx` (importar `ROTULO_RESPOSTA_NUTRI, type RespostaDoDiario` de `@/modules/portal/diario-constantes`), o texto do link e um rótulo depois dele:

```tsx
                <Link href={`/painel/diarios/${f.id}`} className="text-link underline">{`${f.paciente} — ${f.refeicaoDoPlano ?? f.refeicao} · ${quandoComFuso(f.dataHora, tenant.fuso)}`}</Link>
                {f.resposta && <span className="text-sm text-suave">{ROTULO_RESPOSTA_NUTRI[f.resposta as RespostaDoDiario]}</span>}
```

Em `src/app/painel/diarios/[id]/page.tsx`, logo depois do `<h1>` (e trocando `r.refeicao` do h1 por `r.refeicaoDoPlano ?? r.refeicao`):

```tsx
        {r.resposta && <p className="font-medium">{ROTULO_RESPOSTA_NUTRI[r.resposta as RespostaDoDiario]}</p>}
        {r.refeicaoDoPlano && <p className="text-sm text-suave">{`Refeição do plano: ${r.refeicaoDoPlano}`}</p>}
```

Sem isto, um "Comi assim" sem texto nem foto apareceria vazio para ela (§4.9). Nada mais do painel muda (G-D3).

- [ ] **Step 5: Rodar e commitar**

```bash
pnpm vitest run src/modules/portal src/app/api/p/diario src/app/painel/acoes-de-paciente.test.ts src/app/painel/cores.test.ts
pnpm typecheck && pnpm lint
git add src/modules/portal/diario.ts src/modules/portal/diario.test.ts src/modules/portal/diario-nutri.test.ts src/app/api/p/diario/ src/app/painel/diarios/
git commit -m "$(cat <<'MSG'
feat(diario): respostas à refeição do plano no diário (P16-07)

registrarNoDiario aceita refeicaoId e resposta: a refeição vem do plano
publicado pela RLS, uma resposta por refeição por dia com o paciente travado
(o Comi assim repetido devolve o registro), limite de 10 mantido. A rota do
diário aceita os campos novos (404 para refeição alheia); o feed e o registro
aberto da nutricionista mostram a resposta e a refeição do plano.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 8: "Não mostrar peso no app" — a opção no prontuário e o filtro no servidor (P16-08)

**Revisão: completa (agentes normas-cfn-lgpd e revisor-rls)** — decisão clínica registrada com autor e data (trilha), o que a opção esconde (G-D6 ★) e o que não muda (RN-204: prontuário, documentos, textos livres, exportação), o paciente que não vê nem muda a opção (RN-205), filtro no módulo e não no componente (RN-203, CS-194), somente leitura para bloqueado/anonimizado.

**Files:**
- Create: `src/modules/pacientes/peso-oculto.ts` (+ `peso-oculto.test.ts`), `src/app/painel/pacientes/[id]/evolucao/actions.ts`, `src/app/painel/pacientes/[id]/evolucao/peso-oculto.tsx`
- Modify: `src/modules/portal/evolucao.ts` (+ `evolucao.test.ts`), `src/app/painel/pacientes/[id]/evolucao/page.tsx`, `src/modules/ajuda/conteudo.ts` (perguntas comuns de `prontuario` e `diarios`), `src/modules/plataforma/audit.ts` (+ `audit.test.ts`: `ENTIDADE_ROTULO.peso_no_app` e o rótulo "Ligou"/"Desligou" em `rotuloDaAcao`)

**Interfaces:**
- Consumes: T1 (`patients.pesoOcultoNoAppEm`); `recordAudit` (`src/modules/plataforma/audit.ts`); `carregarPacienteParaEscrita`, `PacienteBloqueadoError`, `PacienteNaoEncontradoError` (`src/modules/pacientes/base.ts`), `requireNutri`, `carregarProntuario` (`src/app/painel/pacientes/[id]/prontuario.ts`), `formatarDataNoFuso`, `Botao`.
- Produces: `SERIES_DO_PESO`, `MSG_PESO_OCULTO`, `semPeso`, `definirPesoOculto`, `pesoOcultoNaTransacao`; `pesoOcultoAction(patientId, formData)`; `evolucaoParaPaciente` sem peso nem IMC quando a opção está ligada.

- [ ] **Step 1: Testes (falham)**

Criar `src/modules/pacientes/peso-oculto.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError } from './base';
import { definirPesoOculto, pesoOcultoNaTransacao, semPeso, SERIES_DO_PESO } from './peso-oculto';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const opcao = (T: Awaited<ReturnType<typeof novoTenant>>, id: string) =>
  withTenant(T.ctx, (tx) => tx.select({ em: patients.pesoOcultoNoAppEm }).from(patients).where(eq(patients.id, id)), app.db).then((r) => r[0].em);

describe('"Não mostrar peso no app" (Plano 16, G-D1, RN-203 a RN-205)', () => {
  it('a nutricionista liga (com a data) e desliga; ligar de novo mantém a data; cada troca vira audit_log com o nome dela e com O QUE foi feito (peso_no_app criar/excluir)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const em = new Date('2026-10-08T13:00:00Z');
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db, agora: em });
    expect(await opcao(T, p.id)).toEqual(em);
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db, agora: new Date('2026-10-09T13:00:00Z') });
    expect(await opcao(T, p.id)).toEqual(em); // já ligada: nada muda, nenhuma linha nova na trilha
    await definirPesoOculto(T.ctx, p.id, false, { db: app.db });
    expect(await opcao(T, p.id)).toBeNull();
    const trilha = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'patients'), eq(auditLog.entidadeId, p.id), eq(auditLog.acao, 'alterar'))), app.db);
    expect(trilha.map((l) => l.actorUserId)).toEqual([T.nutriId, T.nutriId]);
    // correção da revisão do plano (spec §10, R-193): a linha genérica de patients não diz o que mudou e a coluna volta a
    // nulo ao desligar — a decisão clínica tem linha própria, na mesma transação do UPDATE
    const decisao = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'peso_no_app'), eq(auditLog.patientId, p.id))).orderBy(auditLog.criadoEm), app.db);
    expect(decisao.map((l) => [l.acao, l.actorUserId, l.entidadeId])).toEqual([['criar', T.nutriId, p.id], ['excluir', T.nutriId, p.id]]);
  });

  it('só a equipe: a sessão de paciente é recusada antes do banco; bloqueado ou anonimizado é só leitura', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(definirPesoOculto(ctxPaciente(T.tenantId, p.id), p.id, true, { db: app.db })).rejects.toThrow(/só pela equipe/);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(definirPesoOculto(T.ctx, p.id, true, { db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('pesoOcultoNaTransacao lê a opção do próprio prontuário pela sessão do paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ler = () => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => pesoOcultoNaTransacao(tx, p.id), app.db);
    expect(await ler()).toBe(false);
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    expect(await ler()).toBe(true);
  });

  it('G-D6 ★ = a: esconde peso e IMC; o resto das séries fica', () => {
    expect(SERIES_DO_PESO).toEqual(['peso', 'imc']);
    expect(semPeso([{ id: 'peso' }, { id: 'imc' }, { id: 'perc_gordura' }, { id: 'circ_cintura' }]).map((s) => s.id)).toEqual(['perc_gordura', 'circ_cintura']);
  });
});
```

Em `src/modules/portal/evolucao.test.ts`, acrescentar (importar `definirPesoOculto` de `@/modules/pacientes/peso-oculto`):

```ts
  it('Plano 16 (RN-203, CS-194): com "Não mostrar peso no app", nem peso nem IMC saem do módulo — a cintura e as orientações continuam', async () => {
    const { T, p } = await comAvaliacoes();
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    const e = await evolucaoParaPaciente(ctxPaciente(T.tenantId, p.id), { mostrarPercGorduraPaciente: true }, app.db);
    expect(e.series.map((s) => s.id)).toEqual(['perc_gordura', 'circ_cintura']);
    expect(e.diferencas.map((d) => d.rotulo)).toEqual(['% de gordura', 'Cintura']);
    expect(e.orientacoes).toEqual([{ data: '2026-09-01', orientacoes: 'Caminhar 30 min' }]);
    // os valores de peso (80 e 77) e de IMC (27,68 e 26,64 com 170 cm) não estão em lugar nenhum da resposta
    expect(JSON.stringify(e)).not.toMatch(/"peso"|"imc"|27\.68|26\.64|"valor":80|"valor":77/);
  });
```

Run: `pnpm vitest run src/modules/pacientes/peso-oculto.test.ts src/modules/portal/evolucao.test.ts` → FAIL.

- [ ] **Step 2: O módulo e o filtro**

Criar `src/modules/pacientes/peso-oculto.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { recordAudit } from '@/modules/plataforma/audit';
import { carregarPacienteParaEscrita } from './base';

/**
 * Plano 16 (G-D1, RN-203 a RN-206): "Não mostrar peso no app", por paciente, ligada só pela equipe. É APRESENTAÇÃO, não
 * restrição de acesso (spec §10): o prontuário, os documentos, os textos livres da nutricionista e as exportações não mudam
 * (RN-204). O portal filtra no servidor, antes de montar a resposta (CS-194). Textos em rascunho até a Debby (G-D10 ★).
 */
export const MSG_PESO_OCULTO = {
  titulo: 'Peso no app do paciente',
  rotulo: 'Não mostrar peso no app',
  ajuda:
    'O paciente não vê esta opção. O peso e o IMC deixam de aparecer no app. Continuam no prontuário, nos documentos que você assina, no que você escreve (orientações e comentários aparecem como estão) e na cópia dos dados que o paciente pedir (LGPD).',
  desde: (data: string) => `Peso oculto no app desde ${data}`,
  salvar: 'Salvar',
} as const;

/** G-D6 ★ = a: o que a opção esconde (o IMC revela o peso). Com (b), acrescentar 'perc_gordura'. */
export const SERIES_DO_PESO = ['peso', 'imc'] as const;

export function semPeso<T extends { id: string }>(series: readonly T[]): T[] {
  return series.filter((s) => !(SERIES_DO_PESO as readonly string[]).includes(s.id));
}

/**
 * Liga ou desliga a opção (aba Evolução do prontuário). Bloqueado ou anonimizado: só leitura (carregarPacienteParaEscrita).
 * Ligar de novo mantém a data da primeira vez (nenhuma linha nova na trilha). Trilha (spec §10, NGS1.07): o gatilho de
 * patients grava "alterar" sem dizer a coluna, e a coluna volta a nulo ao desligar — por isso a decisão ganha linha própria
 * (entidade `peso_no_app`, `criar` = ligou, `excluir` = desligou; molde de `tentativa_assinatura`), na mesma transação.
 */
export async function definirPesoOculto(ctx: TenantContext, patientId: string, ocultar: boolean, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (ctx.role !== 'nutri') throw new Error('"Não mostrar peso no app" só pela equipe');
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (Boolean(p.pesoOcultoNoAppEm) === ocultar) return;
      await tx.update(patients).set({ pesoOcultoNoAppEm: ocultar ? agora : null, updatedAt: agora }).where(eq(patients.id, p.id));
      await recordAudit(tx, { acao: ocultar ? 'criar' : 'excluir', entidade: 'peso_no_app', entidadeId: p.id, patientId: p.id });
    },
    deps.db ?? getDb(),
  );
}

/** Na transação do portal (RLS do paciente): a opção do próprio prontuário. */
export async function pesoOcultoNaTransacao(tx: Tx, patientId: string): Promise<boolean> {
  const [p] = await tx.select({ em: patients.pesoOcultoNoAppEm }).from(patients).where(eq(patients.id, patientId));
  return Boolean(p?.em);
}
```

Em `src/modules/portal/evolucao.ts`, ler a opção e filtrar antes das diferenças:

```ts
import { getDb, type Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { listarAntropometrias } from '@/modules/pacientes/antropometria';
import { orientacoesDoPaciente } from '@/modules/pacientes/atendimentos';
import { diferencas, seriesDasAvaliacoes, type Diferenca, type SerieEvolucao } from '@/modules/pacientes/evolucao';
import { pesoOcultoNaTransacao, semPeso } from '@/modules/pacientes/peso-oculto';
import { pacienteDaSessao } from './sessao';

/** D14: o que o paciente vê da antropometria. Dobras, densidade e exames nunca; % de gordura só com a opção do tenant. */
const permitida = (id: string, mostrarPercGordura: boolean) => id === 'peso' || id === 'imc' || id.startsWith('circ_') || (mostrarPercGordura && id === 'perc_gordura');

/**
 * US-044: gráficos de peso e medidas e as orientações de cada consulta. Leituras auditadas (D22). Plano 16 (RN-203): com
 * "Não mostrar peso no app", peso e IMC saem AQUI, antes de montar a resposta — nenhum componente recebe o valor (CS-194).
 */
export async function evolucaoParaPaciente(ctx: TenantContext, tenant: { mostrarPercGorduraPaciente: boolean }, db: Db = getDb()) {
  const patientId = pacienteDaSessao(ctx, 'evolucaoParaPaciente');
  const oculto = await withTenant(ctx, (tx) => pesoOcultoNaTransacao(tx, patientId), db);
  // Mesma leitura auditada do painel (D22): a RLS do contexto de paciente restringe às linhas dele.
  const avaliacoes = await listarAntropometrias(ctx, patientId, db);
  const todas: SerieEvolucao[] = seriesDasAvaliacoes(avaliacoes).filter((s) => permitida(s.id, tenant.mostrarPercGorduraPaciente));
  const series = oculto ? semPeso(todas) : todas;
  const difs: Diferenca[] = diferencas(series);
  const orientacoes = await orientacoesDoPaciente(ctx, db);
  return { avaliacoes: avaliacoes.length, series, diferencas: difs, orientacoes };
}
```

Em `src/modules/plataforma/audit.ts`: `ENTIDADE_ROTULO` ganha `peso_no_app: 'Peso oculto no app'` e `rotuloDaAcao` ganha, ao lado das linhas da `ia`, `if (i.entidade === 'peso_no_app') return i.acao === 'criar' ? 'Ligou' : 'Desligou';` — o "Histórico de acessos" mostra "Ligou — Peso oculto no app" e "Desligou — Peso oculto no app" com o nome de quem fez. Em `audit.test.ts`, um caso: `expect(rotuloDaAcao({ acao: 'criar', entidade: 'peso_no_app' })).toBe('Ligou')` e o de `excluir`.

Run: `pnpm vitest run src/modules/pacientes/peso-oculto.test.ts src/modules/portal/evolucao.test.ts src/modules/plataforma/audit.test.ts` → PASS.

- [ ] **Step 3: A caixa no prontuário (aba Evolução; §4.9)**

Criar `src/app/painel/pacientes/[id]/evolucao/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';

/** Plano 16 (US-195): "Não mostrar peso no app" (caixa marcada = ligar). Bloqueado/anonimizado: nada muda (a tela já é só leitura). */
export async function pesoOcultoAction(patientId: string, formData: FormData): Promise<void> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/evolucao`);
  try {
    await definirPesoOculto(ctx, patientId, formData.get('ocultar') === 'on');
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (!(e instanceof PacienteBloqueadoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
}
```

Criar `src/app/painel/pacientes/[id]/evolucao/peso-oculto.tsx`:

```tsx
import { Botao } from '@/components/ui/botao';
import type { PatientRow } from '@/db/schema';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { MSG_PESO_OCULTO } from '@/modules/pacientes/peso-oculto';
import { pesoOcultoAction } from './actions';

/** Plano 16 (§4.9, US-195): a caixa "Não mostrar peso no app" na aba Evolução. Funciona sem JavaScript (formulário com ação). */
export function PesoOcultoNoApp({ paciente, fuso }: { paciente: PatientRow; fuso: string }) {
  const somenteLeitura = paciente.status === 'bloqueado' || Boolean(paciente.anonimizadoEm);
  return (
    <section aria-labelledby="peso-no-app" className="space-y-2">
      <h2 id="peso-no-app" className="text-lg font-semibold">{MSG_PESO_OCULTO.titulo}</h2>
      {paciente.pesoOcultoNoAppEm && <p>{MSG_PESO_OCULTO.desde(formatarDataNoFuso(paciente.pesoOcultoNoAppEm, fuso))}</p>}
      <form action={pesoOcultoAction.bind(null, paciente.id)} className="space-y-2">
        <p className="flex min-h-11 items-center gap-2">
          <input id="ocultar" name="ocultar" type="checkbox" defaultChecked={Boolean(paciente.pesoOcultoNoAppEm)} disabled={somenteLeitura} aria-describedby="ocultar-ajuda" className="size-5" />
          <label htmlFor="ocultar">{MSG_PESO_OCULTO.rotulo}</label>
        </p>
        <p id="ocultar-ajuda" className="max-w-2xl text-sm text-suave">{MSG_PESO_OCULTO.ajuda}</p>
        {!somenteLeitura && <Botao variante="secundario">{MSG_PESO_OCULTO.salvar}</Botao>}
      </form>
    </section>
  );
}
```

Em `src/app/painel/pacientes/[id]/evolucao/page.tsx`: guardar o `tenant` de `carregarProntuario` (`const { ctx, paciente, tenant } = await carregarProntuario(id);`), importar `PesoOcultoNoApp` de `./peso-oculto` e pôr `<PesoOcultoNoApp paciente={paciente} fuso={tenant.fuso} />` como **primeiro** filho do `<div className="space-y-10">`. O resto da aba não muda (G-D3).

Ajuda do painel (correção da revisão do plano; `src/modules/ajuda/conteudo.ts`): no guia `prontuario`, "Perguntas comuns" ganha `'Na aba Evolução, "Não mostrar peso no app" tira o peso e o IMC do app do paciente; o prontuário, os documentos e a cópia dos dados não mudam.'`; no guia `diarios`, a `ajuda` ganha a seção `{ titulo: 'Perguntas comuns', itens: ['Um registro pode chegar só com "Comeu como no plano" ou "Comeu outra coisa": é a resposta do paciente à refeição do plano, com a refeição e o horário.'] }`. Os passos não mudam: a versão dos dois guias fica como está (mesmo critério do Plano 11). Textos com a Debby (G-D10 ★).

- [ ] **Step 4: Rodar as guardas do painel e commitar**

```bash
pnpm vitest run src/modules/pacientes/peso-oculto.test.ts src/modules/portal/evolucao.test.ts src/app/painel/acoes-de-paciente.test.ts src/app/painel/cores.test.ts src/app/formularios-post.test.ts src/app/painel/rotas-axe.test.ts src/modules/ajuda/conteudo.test.ts src/modules/plataforma/audit.test.ts
pnpm typecheck && pnpm lint
git add src/modules/pacientes/peso-oculto.ts src/modules/pacientes/peso-oculto.test.ts src/modules/portal/evolucao.ts src/modules/portal/evolucao.test.ts src/modules/plataforma/audit.ts src/modules/plataforma/audit.test.ts src/modules/ajuda/conteudo.ts "src/app/painel/pacientes/[id]/evolucao/"
git commit -m "$(cat <<'MSG'
feat(prontuario): "Não mostrar peso no app", por paciente (P16-08)

Só a equipe liga, na aba Evolução, com o texto de ajuda do que não muda;
bloqueado ou anonimizado é só leitura; a troca vai para a trilha pelo
gatilho de patients. No portal, peso e IMC saem no módulo, antes de montar
a resposta (RN-203, CS-194).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 9: Jornada — regras puras, `jornadaDoPaciente` e a mini-jornada da faixa (P16-09)

**Revisão: completa (agente normas-cfn-lgpd)** — linguagem neutra sobre o corpo (RN-206: número com sinal, sem "bom/ruim", sem meta), o peso oculto que nem sai do banco (RN-203), as medidas que o paciente vê (P06 D14: peso, IMC, circunferências; % de gordura só com a opção do consultório; nunca dobras, densidade ou exames), a orientação verbatim com a voz dela (RN-194), a trilha de leitura (atendimentos e antropometria).

**Files:**
- Create: `src/modules/portal/jornada-regras.ts` (+ `jornada-regras.test.ts`), `src/modules/portal/jornada.ts` (+ `jornada.test.ts`)

**Interfaces:**
- Consumes: T5 (`dataPorExtenso`, `mesPorExtenso`, `quandoRelativo`, `quandoRelativoComFuso`), T8 (`pesoOcultoNaTransacao`, `definirPesoOculto`); `CIRCUNFERENCIAS` (`antropometria-constantes.ts`), `formatarDiferenca`, `Ponto`, `SerieEvolucao` (`src/modules/pacientes/evolucao.ts`), `arredondar`, `casasDecimais`, `formatarDecimal` (`src/lib/numero.ts`), `listarConsultasNaTransacao`, `STATUS_ATIVOS`, `TenantAgenda`, `MAX_CONSULTAS_FUTURAS_PUBLICO` (3), `anthropometry`, `consultations`, `auditRead`; nos testes, `consultaDireta`.
- Produces: `MSG_JORNADA`, `AvaliacaoDaJornada`, `AtendimentoDaJornada`, `Medida`, `Marco`, `Jornada`, `MiniJornada`, `medidasDaAvaliacao`, `montarJornada`, `miniJornada`; `jornadaDoPaciente(ctx, tenant, agora, db?)`, `miniJornadaDoPaciente(ctx, tenant, agora, db?)`. **`jornada-regras.ts` importa `src/modules/pacientes/evolucao.ts` (que importa o banco): só servidor** — os componentes de cliente recebem as strings prontas.

- [ ] **Step 1: Testes das regras (falham)**

Criar `src/modules/portal/jornada-regras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { medidasDaAvaliacao, miniJornada, montarJornada, MSG_JORNADA, type AvaliacaoDaJornada } from './jornada-regras';

const SP = 'America/Sao_Paulo';
const AGORA = new Date('2026-10-08T14:05:00Z');
const AMANHA_14H = new Date('2026-10-09T17:00:00Z');
const av = (id: string, data: string, consultationId: string | null, pesoKg: number | null, cintura: number, imc: number | null = null): AvaliacaoDaJornada => ({
  id,
  data,
  consultationId,
  pesoKg,
  imc,
  percGordura: 25.5,
  circunferencias: { cintura },
});
const ATENDIMENTOS = [
  { id: 'c3', data: '2026-09-22', orientacao: 'Manter as frutas no lanche.' },
  { id: 'c2', data: '2026-07-15', orientacao: null },
  { id: 'c1', data: '2026-03-18', orientacao: 'Beber 2 litros de água.' },
];
const AVALIACOES = [av('a3', '2026-09-22', 'c3', 78.6, 86, 27.2), av('a4', '2026-05-27', null, 80.9, 90), av('a2', '2026-07-15', 'c2', 79.7, 88), av('a1', '2026-03-18', 'c1', 82.8, 92)];

describe('Jornada (US-194, RN-202, RN-203, RN-206)', () => {
  it('título desde o mês da primeira consulta; marcos da próxima consulta para a primeira, com as medidas e a orientação dela', () => {
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes: AVALIACOES, proxima: { id: 'ap1', inicio: AMANHA_14H, modalidade: 'online' }, podeAgendar: true, percGordura: false }, AGORA, SP);
    expect(j.titulo).toBe('Sua jornada desde março');
    expect(j.marcos.map((m) => (m.tipo === 'proxima' ? `próxima ${m.quando.semFuso}` : m.titulo))).toEqual([
      'próxima amanhã, 14:00',
      '22 de setembro',
      '15 de julho',
      'Medidas de 27 de maio',
      '18 de março',
    ]);
    expect(j.marcos[1]).toMatchObject({ tipo: 'atendimento', primeira: false, orientacao: 'Manter as frutas no lanche.', medidas: [{ id: 'peso', texto: '78,6 kg' }, { id: 'imc', texto: 'IMC 27,2' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }] });
    expect(j.marcos[4]).toMatchObject({ tipo: 'atendimento', primeira: true });
    expect(j.marcos[0]).toMatchObject({ tipo: 'proxima', modalidade: 'Online.', quando: { comFuso: 'amanhã, 14:00 (horário de Brasília)' } });
    expect(j.grafico).toMatchObject({ id: 'peso', rotulo: 'Peso nas consultas', unidade: 'kg' });
    expect(j.grafico?.pontos.map((p) => p.valor)).toEqual([82.8, 80.9, 79.7, 78.6]);
    expect(j.vazia).toBe(false);
  });

  it('peso oculto (avaliações sem peso nem IMC, como o banco devolve): o gráfico vira "Cintura nas consultas"; nenhuma medida em kg', () => {
    const semPeso = AVALIACOES.map((a) => ({ ...a, pesoKg: null, imc: null }));
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes: semPeso, proxima: null, podeAgendar: true, percGordura: false }, AGORA, SP);
    expect(j.grafico).toMatchObject({ id: 'circ_cintura', rotulo: 'Cintura nas consultas', unidade: 'cm' });
    expect(JSON.stringify(j)).not.toMatch(/kg|IMC/);
  });

  it('% de gordura só com a opção do consultório; menos de 2 pesos e de 2 cinturas: sem gráfico e sem mensagem sobre o peso', () => {
    expect(medidasDaAvaliacao(AVALIACOES[0], { percGordura: true }).map((m) => m.texto)).toContain('% de gordura 25,5');
    expect(medidasDaAvaliacao(AVALIACOES[0], { percGordura: false }).map((m) => m.id)).not.toContain('perc_gordura');
    const j = montarJornada({ atendimentos: [], avaliacoes: [AVALIACOES[0]], proxima: null, podeAgendar: true, percGordura: false }, AGORA, SP);
    expect(j.grafico).toBeNull();
  });

  it('ainda sem consulta: "Sua jornada", vazia', () => {
    expect(montarJornada({ atendimentos: [], avaliacoes: [], proxima: null, podeAgendar: true, percGordura: false }, AGORA, SP)).toEqual({ titulo: 'Sua jornada', grafico: null, marcos: [], vazia: true, podeAgendar: true });
  });

  it('mini-jornada: variação com sinal e sem julgamento; o complemento só para leitor de tela (o nome acessível contém o texto visível, WCAG 2.5.3); com e sem a sigla do fuso', () => {
    const m = miniJornada({ pesos: [{ data: '2026-03-18', valor: 82.8 }, { data: '2026-09-22', valor: 78.6 }], atendimentos: 3, primeiroAtendimento: '2026-03-18', proxima: { inicio: AMANHA_14H }, podeAgendar: true }, AGORA, SP);
    expect(m.linha1).toBe('−4,2 kg desde março');
    expect(m.linha2).toEqual({ semFuso: 'Próximo marco: consulta amanhã, 14:00', comFuso: 'Próximo marco: consulta amanhã, 14:00 (horário de Brasília)' });
    expect(m.complemento).toBe('78,6 kg na última consulta');
    expect(m.pontos).toEqual([82.8, 78.6]);
    expect(miniJornada({ pesos: [{ data: '2026-03-18', valor: 80 }, { data: '2026-09-22', valor: 81.5 }], atendimentos: 2, primeiroAtendimento: '2026-03-18', proxima: null, podeAgendar: true }, AGORA, SP).complemento).toBe('81,5 kg na última consulta');
    expect(miniJornada({ pesos: [{ data: '2026-03-18', valor: 80 }, { data: '2026-09-22', valor: 80 }], atendimentos: 2, primeiroAtendimento: '2026-03-18', proxima: null, podeAgendar: true }, AGORA, SP).linha1).toBe('Sem mudança de peso desde março');
  });

  it('mini-jornada com o peso oculto (pesos vazios): número de consultas, nenhum valor; sem consulta: a jornada começa na primeira', () => {
    const oculto = miniJornada({ pesos: [], atendimentos: 3, primeiroAtendimento: '2026-03-18', proxima: { inicio: AMANHA_14H }, podeAgendar: true }, AGORA, SP);
    expect(oculto.linha1).toBe('3 consultas desde março');
    expect(oculto.complemento).toBeNull(); // nenhum peso, nem só para o leitor de tela
    expect(oculto.pontos).toEqual([]);
    const nova = miniJornada({ pesos: [], atendimentos: 0, primeiroAtendimento: null, proxima: null, podeAgendar: true }, AGORA, SP);
    expect(nova.linha1).toBe(MSG_JORNADA.comeca);
    expect(nova.complemento).toBeNull();
  });
});
```

Run: `pnpm vitest run src/modules/portal/jornada-regras.test.ts` → FAIL.

- [ ] **Step 2: As regras**

Criar `src/modules/portal/jornada-regras.ts`:

```ts
import { arredondar, casasDecimais, formatarDecimal } from '@/lib/numero';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { CIRCUNFERENCIAS } from '@/modules/pacientes/antropometria-constantes';
import { formatarDiferenca, type Ponto, type SerieEvolucao } from '@/modules/pacientes/evolucao';
import { dataPorExtenso, mesPorExtenso, quandoRelativo, quandoRelativoComFuso } from './datas-portal';

/**
 * Plano 16 (§4.5, US-194): a Jornada e a mini-jornada da faixa. Puro, mas SÓ SERVIDOR (importa pacientes/evolucao, que
 * importa o banco): os componentes de cliente recebem as strings prontas. RN-206: a variação é número com sinal, sem cor,
 * elogio ou meta. RN-203: com o peso oculto, quem chama já não leu peso nem IMC (pesoKg/imc nulos, pesos vazios).
 */
export const MSG_JORNADA = {
  titulo: 'Sua jornada',
  desde: (mes: string) => `Sua jornada desde ${mes}`,
  comeca: 'Sua jornada começa na primeira consulta.',
  orientacao: 'Orientação da sua nutricionista',
  primeira: 'primeira consulta',
  proxima: 'próxima consulta',
  medidasDe: (data: string) => `Medidas de ${data}`,
  todasAsMedidas: 'Todas as medidas',
  minhasConsultas: 'Minhas consultas',
  agendar: 'Agendar consulta',
  verConsulta: 'Ver a consulta',
  pesoNasConsultas: 'Peso nas consultas',
  cinturaNasConsultas: 'Cintura nas consultas',
  semMarco: 'Nenhuma consulta marcada.',
  proximoMarco: (quando: string) => `Próximo marco: consulta ${quando}`,
  semMudanca: (mes: string) => `Sem mudança de peso desde ${mes}`,
  variacao: (diferenca: string, mes: string) => `${diferenca} desde ${mes}`,
  consultas: (n: number, mes: string) => `${n} ${n === 1 ? 'consulta' : 'consultas'} desde ${mes}`,
  modalidade: { online: 'Online.', presencial: 'Presencial.' },
} as const;

export type AvaliacaoDaJornada = { id: string; data: string; consultationId: string | null; pesoKg: number | null; imc: number | null; percGordura: number | null; circunferencias: Record<string, number> };
export type AtendimentoDaJornada = { id: string; data: string; orientacao: string | null };
export type ProximaConsulta = { id: string; inicio: Date; modalidade: 'presencial' | 'online' };
export type Medida = { id: string; texto: string };
type Quando = { semFuso: string; comFuso: string };
export type Marco =
  | { tipo: 'proxima'; consultaId: string; quando: Quando; modalidade: string }
  | { tipo: 'atendimento'; data: string; titulo: string; primeira: boolean; medidas: Medida[]; orientacao: string | null }
  | { tipo: 'medidas'; data: string; titulo: string; medidas: Medida[] };
export type Jornada = { titulo: string; grafico: SerieEvolucao | null; marcos: Marco[]; vazia: boolean; podeAgendar: boolean };
export type EntradaDaJornada = { atendimentos: readonly AtendimentoDaJornada[]; avaliacoes: readonly AvaliacaoDaJornada[]; proxima: ProximaConsulta | null; podeAgendar: boolean; percGordura: boolean };
export type MiniJornada = { linha1: string; linha2: Quando; complemento: string | null; pontos: number[]; podeAgendar: boolean };
export type EntradaDaMini = { pesos: readonly Ponto[]; atendimentos: number; primeiroAtendimento: string | null; proxima: { inicio: Date } | null; podeAgendar: boolean };

/** "78,6", "86", "27,2": as casas que a medida tem. */
const g = (n: number) => formatarDecimal(n, casasDecimais(n));

/** P06 D14: peso, IMC, % de gordura (só com a opção do consultório) e circunferências; nunca dobras nem densidade. */
export function medidasDaAvaliacao(a: AvaliacaoDaJornada, o: { percGordura: boolean }): Medida[] {
  const m: Medida[] = [];
  if (a.pesoKg !== null) m.push({ id: 'peso', texto: `${g(a.pesoKg)} kg` });
  if (a.imc !== null) m.push({ id: 'imc', texto: `IMC ${g(a.imc)}` });
  if (o.percGordura && a.percGordura !== null) m.push({ id: 'perc_gordura', texto: `% de gordura ${g(a.percGordura)}` });
  for (const c of CIRCUNFERENCIAS) {
    const v = a.circunferencias[c.id];
    if (typeof v === 'number') m.push({ id: `circ_${c.id}`, texto: `${c.rotulo.toLocaleLowerCase('pt-BR')} ${g(v)} cm` });
  }
  return m;
}

export function montarJornada(e: EntradaDaJornada, agora: Date, fuso: string): Jornada {
  const hoje = partesNoFuso(agora, fuso).data;
  const atendimentosAsc = [...e.atendimentos].sort((a, b) => a.data.localeCompare(b.data));
  const primeira = atendimentosAsc[0]?.id ?? null;
  const ids = new Set(e.atendimentos.map((a) => a.id));
  const porAtendimento = new Map(e.avaliacoes.flatMap((a) => (a.consultationId && ids.has(a.consultationId) ? [[a.consultationId, a] as const] : [])));
  const passados: Exclude<Marco, { tipo: 'proxima' }>[] = [
    ...e.atendimentos.map((a) => {
      const avaliacao = porAtendimento.get(a.id);
      return { tipo: 'atendimento' as const, data: a.data, titulo: dataPorExtenso(a.data, hoje), primeira: a.id === primeira, medidas: avaliacao ? medidasDaAvaliacao(avaliacao, e) : [], orientacao: a.orientacao };
    }),
    // avaliação sem atendimento (ou de atendimento que o paciente não vê) vira um marco próprio
    ...e.avaliacoes
      .filter((a) => !a.consultationId || !ids.has(a.consultationId))
      .map((a) => ({ tipo: 'medidas' as const, data: a.data, titulo: MSG_JORNADA.medidasDe(dataPorExtenso(a.data, hoje)), medidas: medidasDaAvaliacao(a, e) })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  const proxima: Marco[] = e.proxima
    ? [{ tipo: 'proxima', consultaId: e.proxima.id, quando: { semFuso: quandoRelativo(e.proxima.inicio, agora, fuso), comFuso: quandoRelativoComFuso(e.proxima.inicio, agora, fuso) }, modalidade: MSG_JORNADA.modalidade[e.proxima.modalidade] }]
    : [];
  const asc = [...e.avaliacoes].sort((a, b) => a.data.localeCompare(b.data));
  const pontos = (valor: (a: AvaliacaoDaJornada) => number | null | undefined): Ponto[] =>
    asc.flatMap((a) => {
      const v = valor(a);
      return typeof v === 'number' ? [{ data: a.data, valor: v }] : [];
    });
  const pesos = pontos((a) => a.pesoKg);
  const cinturas = pontos((a) => a.circunferencias.cintura);
  const grafico: SerieEvolucao | null =
    pesos.length >= 2
      ? { id: 'peso', rotulo: MSG_JORNADA.pesoNasConsultas, unidade: 'kg', casas: 1, pontos: pesos }
      : cinturas.length >= 2
        ? { id: 'circ_cintura', rotulo: MSG_JORNADA.cinturaNasConsultas, unidade: 'cm', casas: 1, pontos: cinturas }
        : null;
  return {
    titulo: atendimentosAsc[0] ? MSG_JORNADA.desde(mesPorExtenso(atendimentosAsc[0].data, hoje)) : MSG_JORNADA.titulo,
    grafico,
    marcos: [...proxima, ...passados],
    vazia: proxima.length + passados.length === 0,
    podeAgendar: e.podeAgendar,
  };
}

/** RN-202: a mini-jornada da faixa de Hoje. O gráfico pequeno (pontos) é decorativo; o complemento (último peso) vai só ao leitor de tela, DENTRO do texto do link (sem aria-label: WCAG 2.5.3, Rótulo no nome). */
export function miniJornada(e: EntradaDaMini, agora: Date, fuso: string): MiniJornada {
  const hoje = partesNoFuso(agora, fuso).data;
  let linha1: string = MSG_JORNADA.comeca;
  let complemento: string | null = null;
  if (e.pesos.length >= 2) {
    const [primeiro, ultimo] = [e.pesos[0], e.pesos[e.pesos.length - 1]];
    const mes = mesPorExtenso(primeiro.data, hoje);
    const diferenca = ultimo.valor - primeiro.valor;
    const modulo = arredondar(Math.abs(diferenca), 1);
    linha1 = modulo === 0 ? MSG_JORNADA.semMudanca(mes) : MSG_JORNADA.variacao(formatarDiferenca(diferenca, 1, 'kg'), mes);
    complemento = `${g(ultimo.valor)} kg na última consulta`;
  } else if (e.atendimentos > 0 && e.primeiroAtendimento) {
    linha1 = MSG_JORNADA.consultas(e.atendimentos, mesPorExtenso(e.primeiroAtendimento, hoje));
  }
  const quando = e.proxima ? { semFuso: quandoRelativo(e.proxima.inicio, agora, fuso), comFuso: quandoRelativoComFuso(e.proxima.inicio, agora, fuso) } : null;
  return {
    linha1,
    linha2: quando ? { semFuso: MSG_JORNADA.proximoMarco(quando.semFuso), comFuso: MSG_JORNADA.proximoMarco(quando.comFuso) } : { semFuso: MSG_JORNADA.semMarco, comFuso: MSG_JORNADA.semMarco },
    complemento,
    pontos: e.pesos.length >= 2 ? e.pesos.map((p) => p.valor) : [],
    podeAgendar: e.podeAgendar,
  };
}
```

Run: `pnpm vitest run src/modules/portal/jornada-regras.test.ts` → PASS.

- [ ] **Step 3: Testes do banco (falham)**

Criar `src/modules/portal/jornada.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';
import { jornadaDoPaciente, miniJornadaDoPaciente } from './jornada';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const tenantDe = async (id: string) => ({ ...(await app.db.select().from(tenants).where(eq(tenants.id, id)))[0], mostrarPercGorduraPaciente: false });
const leituras = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select({ entidade: auditLog.entidade, n: count() }).from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'))).groupBy(auditLog.entidade), app.db).then((r) =>
    Object.fromEntries(r.map((x) => [x.entidade, x.n])),
  );

/** Dois atendimentos (com orientação e avaliação ligada), uma avaliação sem atendimento e uma nota privada (que nunca aparece). */
async function comHistorico() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  await withTenant(
    T.ctx,
    async (tx) => {
      const [c1] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${T.tenantId}, ${p.id}, '2026-03-18', 'Beber 2 litros de água.') returning id`)).rows;
      const [c2] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data) values (${T.tenantId}, ${p.id}, '2026-09-22') returning id`)).rows;
      await tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${T.tenantId}, ${p.id}, ${c2.id}, 'segredo da nutri')`);
      await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, consultation_id, data, peso_kg, altura_cm, perc_gordura, dobras_mm, circunferencias) values
        (${T.tenantId}, ${p.id}, ${c1.id}, '2026-03-18', 81.37, 170, 30.5, '{"triceps": 20}', '{"cintura": 92}'),
        (${T.tenantId}, ${p.id}, ${c2.id}, '2026-09-22', 78.62, 170, 28.1, '{"triceps": 18}', '{"cintura": 86}'),
        (${T.tenantId}, ${p.id}, null, '2026-05-27', 80.11, 170, null, '{}', '{"cintura": 90}')`);
    },
    app.db,
  );
  return { T, p, ctx: ctxPaciente(T.tenantId, p.id) };
}

describe('jornadaDoPaciente / miniJornadaDoPaciente (Plano 16, US-194, RN-202, RN-203)', () => {
  it('marcos com as medidas e a orientação; leitura auditada (atendimentos e antropometria); sem nota privada, dobras nem % de gordura', async () => {
    const { T, p, ctx } = await comHistorico();
    const agora = new Date('2026-10-08T14:05:00Z');
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-09T17:00:00Z'), 60, { modalidade: 'online' });
    const j = await jornadaDoPaciente(ctx, await tenantDe(T.tenantId), agora, app.db);
    expect(j.titulo).toBe('Sua jornada desde março');
    expect(j.marcos.map((m) => m.tipo)).toEqual(['proxima', 'atendimento', 'medidas', 'atendimento']);
    expect(j.marcos[3]).toMatchObject({ primeira: true, orientacao: 'Beber 2 litros de água.' });
    expect(j.grafico?.pontos.map((x) => x.valor)).toEqual([81.37, 80.11, 78.62]);
    expect(JSON.stringify(j)).not.toMatch(/segredo|triceps|gordura/);
    expect(await leituras(T, p.id)).toEqual({ atendimentos: 1, antropometria: 1 });
  });

  it('peso oculto (RN-203, CS-194): nem o peso nem o IMC saem do módulo — a mini-jornada conta consultas e não lê a antropometria', async () => {
    const { T, p, ctx } = await comHistorico();
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    const agora = new Date('2026-10-08T14:05:00Z');
    const tenant = await tenantDe(T.tenantId);
    const j = await jornadaDoPaciente(ctx, tenant, agora, app.db);
    const mini = await miniJornadaDoPaciente(ctx, tenant, agora, app.db);
    const tudo = JSON.stringify({ j, mini });
    expect(tudo).not.toMatch(/81[.,]37|81[.,]4|78[.,]62|78[.,]6|80[.,]11|kg|IMC|28[.,]1|27[.,]2/);
    expect(j.grafico).toMatchObject({ id: 'circ_cintura' });
    expect(mini).toMatchObject({ linha1: '2 consultas desde março', pontos: [] });
    expect((await leituras(T, p.id)).antropometria).toBe(1); // só a da jornada (cinturas); a mini não leu nada da antropometria
  });

  it('mini-jornada com o peso visível: a variação e a próxima consulta; leitura da antropometria auditada', async () => {
    const { T, p, ctx } = await comHistorico();
    const mini = await miniJornadaDoPaciente(ctx, await tenantDe(T.tenantId), new Date('2026-10-08T14:05:00Z'), app.db);
    expect(mini.linha1).toBe('−2,8 kg desde março');
    expect(mini.linha2.semFuso).toBe('Nenhuma consulta marcada.');
    expect(await leituras(T, p.id)).toEqual({ antropometria: 1 });
  });

  it('isolamento e papel: só o próprio histórico; só em sessão de paciente', async () => {
    const { T, ctx } = await comHistorico();
    const outro = await novoPaciente(app.db, T.ctx);
    const j = await jornadaDoPaciente(ctxPaciente(T.tenantId, outro.id), await tenantDe(T.tenantId), new Date(), app.db);
    expect(j).toMatchObject({ vazia: true, titulo: 'Sua jornada' });
    await expect(jornadaDoPaciente(T.ctx, await tenantDe(T.tenantId), new Date(), app.db)).rejects.toThrow(/sessão de paciente/);
    expect(ctx.role).toBe('paciente');
  });
});
```

Run: `pnpm vitest run src/modules/portal/jornada.test.ts` → FAIL.

- [ ] **Step 4: O módulo**

Criar `src/modules/portal/jornada.ts`:

```ts
import { and, asc, count, desc, eq, gt, inArray, min } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { anthropometry, appointments, consultations } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { MAX_CONSULTAS_FUTURAS_PUBLICO } from '@/modules/agenda/constantes';
import { listarConsultasNaTransacao, STATUS_ATIVOS, type Consulta, type TenantAgenda } from '@/modules/agenda/consultas';
import { pesoOcultoNaTransacao } from '@/modules/pacientes/peso-oculto';
import { auditRead } from '@/modules/plataforma/audit';
import { miniJornada, montarJornada, type AvaliacaoDaJornada, type Jornada, type MiniJornada } from './jornada-regras';
import { pacienteDaSessao } from './sessao';

const futuras = (tx: Tx, agora: Date) =>
  listarConsultasNaTransacao(tx, and(inArray(appointments.status, [...STATUS_ATIVOS]), gt(appointments.fim, agora)), { ordem: 'asc', limite: 20 });
// T-1 (Plano 05): o mesmo teto do servidor (RN-16): ativas que ainda vão começar
const podeAgendar = (lista: Consulta[], agora: Date) => lista.filter((c) => c.inicio > agora).length < MAX_CONSULTAS_FUTURAS_PUBLICO;

/** As avaliações do paciente; com o peso oculto (RN-203) peso_kg e imc nem saem do banco. Sem dobras nem densidade (P06 D14). */
async function avaliacoesNaTransacao(tx: Tx, patientId: string, o: { semPeso: boolean; percGordura: boolean }): Promise<AvaliacaoDaJornada[]> {
  const base = { id: anthropometry.id, data: anthropometry.data, consultationId: anthropometry.consultationId, percGordura: anthropometry.percGordura, circunferencias: anthropometry.circunferencias };
  const ordem = [desc(anthropometry.data), desc(anthropometry.createdAt)] as const;
  const linhas = o.semPeso
    ? (await tx.select(base).from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(...ordem)).map((a) => ({ ...a, pesoKg: null, imc: null }))
    : await tx.select({ ...base, pesoKg: anthropometry.pesoKg, imc: anthropometry.imc }).from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(...ordem);
  return linhas.map((a) => ({ ...a, percGordura: o.percGordura ? a.percGordura : null, circunferencias: a.circunferencias ?? {} }));
}

/**
 * Plano 16 (§4.5, US-194): atendimentos (data e orientação ao paciente — nunca a nota privada, staff_only), avaliações e a
 * próxima consulta, numa transação com o contexto do paciente. auditRead de atendimentos e de antropometria (como
 * orientacoesDoPaciente e listarAntropometrias); a agenda sem auditRead (P05 D10).
 */
export async function jornadaDoPaciente(ctx: TenantContext, tenant: TenantAgenda & { mostrarPercGorduraPaciente: boolean }, agora: Date, db: Db = getDb()): Promise<Jornada> {
  const patientId = pacienteDaSessao(ctx, 'jornadaDoPaciente');
  const d = await withTenant(
    ctx,
    async (tx) => {
      const semPeso = await pesoOcultoNaTransacao(tx, patientId);
      const atendimentos = await tx
        .select({ id: consultations.id, data: consultations.data, orientacao: consultations.orientacoesPaciente })
        .from(consultations)
        .where(eq(consultations.patientId, patientId))
        .orderBy(desc(consultations.data));
      if (atendimentos.length) await auditRead(tx, { entidade: 'atendimentos', entidadeId: null, patientId });
      const avaliacoes = await avaliacoesNaTransacao(tx, patientId, { semPeso, percGordura: tenant.mostrarPercGorduraPaciente });
      if (avaliacoes.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      return { atendimentos, avaliacoes, futuras: await futuras(tx, agora) };
    },
    db,
  );
  const p = d.futuras[0];
  return montarJornada(
    {
      atendimentos: d.atendimentos,
      avaliacoes: d.avaliacoes,
      proxima: p ? { id: p.id, inicio: p.inicio, modalidade: p.modalidade } : null,
      podeAgendar: podeAgendar(d.futuras, agora),
      percGordura: tenant.mostrarPercGorduraPaciente,
    },
    agora,
    tenant.fuso,
  );
}

/**
 * RN-202: a mini-jornada da faixa de Hoje. Com o peso visível, lê só data e peso (auditRead de antropometria); com o peso
 * oculto, não lê a antropometria (conta atendimentos — sem conteúdo, sem auditRead).
 */
export async function miniJornadaDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()): Promise<MiniJornada> {
  const patientId = pacienteDaSessao(ctx, 'miniJornadaDoPaciente');
  const d = await withTenant(
    ctx,
    async (tx) => {
      const semPeso = await pesoOcultoNaTransacao(tx, patientId);
      const pesos = semPeso
        ? []
        : await tx.select({ data: anthropometry.data, valor: anthropometry.pesoKg }).from(anthropometry).where(eq(anthropometry.patientId, patientId)).orderBy(asc(anthropometry.data), asc(anthropometry.createdAt));
      if (pesos.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId });
      const [c] = await tx.select({ n: count(), primeira: min(consultations.data) }).from(consultations).where(eq(consultations.patientId, patientId));
      return { pesos, atendimentos: c?.n ?? 0, primeira: c?.primeira ?? null, futuras: await futuras(tx, agora) };
    },
    db,
  );
  return miniJornada(
    { pesos: d.pesos, atendimentos: d.atendimentos, primeiroAtendimento: d.primeira, proxima: d.futuras[0] ? { inicio: d.futuras[0].inicio } : null, podeAgendar: podeAgendar(d.futuras, agora) },
    agora,
    tenant.fuso,
  );
}
```

Run: `pnpm vitest run src/modules/portal/jornada-regras.test.ts src/modules/portal/jornada.test.ts` → PASS. (Conferir em `src/db/schema/pacientes.ts` se `consultation_notes` exige mais colunas no `insert` do teste; o `evolucao.test.ts` já usa o mesmo comando.)

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint
git add src/modules/portal/jornada-regras.ts src/modules/portal/jornada-regras.test.ts src/modules/portal/jornada.ts src/modules/portal/jornada.test.ts
git commit -m "$(cat <<'MSG'
feat(portal): Jornada e mini-jornada do paciente (P16-09)

Atendimentos com a orientação dela, avaliações (a sem atendimento vira um
marco), a próxima consulta e o gráfico de peso (ou de cintura) numa
transação, com auditRead de atendimentos e antropometria. Com o peso oculto,
peso e IMC nem saem do banco (RN-203); linguagem neutra (RN-206).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 10: Hoje — o mural, a mini-jornada, os cartões do aparelho e a barra de ações (P16-10)

**Revisão: leve (revisor-interface)** — mural como lista com autor e hora no texto (RNF-191), rodapé fixo (RN-193), sem caixa de texto (C-191), mini-jornada com nome acessível (RN-202), cartões "Agora não" (RN-201), "Confirmar presença" no mural, atualização ao voltar ao app sem região viva.

**Files:**
- Create: `src/app/p/(portal)/inicio/mural-lista.tsx` (+ `mural-lista.test.ts`), `src/app/p/(portal)/inicio/confirmar-no-mural.tsx`, `src/app/p/(portal)/inicio/cartoes-do-aparelho.tsx`, `src/app/p/(portal)/inicio/atualizar-ao-voltar.tsx`, `src/app/p/(portal)/inicio/page.test.ts`, `src/components/portal/mini-jornada.tsx`, `src/components/portal/cartoes-dispensados.ts` (+ `cartoes-dispensados.test.ts`)
- Modify: `src/app/p/(portal)/inicio/page.tsx`, `src/app/p/notificacoes.tsx` e `src/app/p/instalar.tsx` (prop `cartao`), `src/app/p/sair-portal.tsx` e `src/app/entrar/page.tsx` (limpeza dos cartões), `src/modules/portal/perfil.ts` (+ teste: sai `primeiroNomeDoPaciente`), `e2e/acessibilidade.spec.ts` (o teste "alvo de toque" de Hoje)

**Interfaces:**
- Consumes: T4 (`Faixa`, `BarraDeAcoes`, `molduraDaSecao`, `MSG_G`), T5 (`MSG_MURAL`, `Mural`, `ItemDoMural`, `dataDaFaixa`), T6 (`muralDoPaciente`), T9 (`miniJornadaDoPaciente`, `MiniJornada`), T11 (`ComiAssim`, `useOnline`); `confirmarAction`, `AgendaState` (`src/app/p/(portal)/agenda/actions.ts`), `QuandoLocal`, `precisaDaSigla` (`src/app/p/quando-local.tsx`), `AtivarNotificacoes`, `Instalar`, `signFileUrl`, `getEnv`, `hojeNoFuso`.
- Produces: a tela Hoje; `MiniJornada` (componente); `dispensado`, `dispensar`, `esquecerCartoesDoAparelho`, `DISPENSA_MS`; `data-guia="mural"` e `data-guia="respostas"` (tour, T14); a prop opcional `cartao` de `AtivarNotificacoes` e de `Instalar`.

- [ ] **Step 1: Testes (falham)**

Criar `src/components/portal/cartoes-dispensados.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DISPENSA_MS, dispensado, dispensar, esquecerCartoesDoAparelho } from './cartoes-dispensados';

// localStorage do navegador, simulado (o ambiente dos testes é o Node)
const mapa = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return mapa.size;
    },
    key: (i: number) => [...mapa.keys()][i] ?? null,
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
  },
});

describe('cartões do aparelho dispensados (RN-201)', () => {
  beforeEach(() => mapa.clear());
  it('"Agora não" esconde por 30 dias, por conta (outra conta no aparelho vê o cartão)', () => {
    const t0 = Date.UTC(2026, 9, 8);
    dispensar('conta-a', 'notificacoes', t0);
    expect(dispensado('conta-a', 'notificacoes', t0 + DISPENSA_MS - 1)).toBe(true);
    expect(dispensado('conta-a', 'notificacoes', t0 + DISPENSA_MS)).toBe(false);
    expect(dispensado('conta-b', 'notificacoes', t0)).toBe(false);
    expect(dispensado('conta-a', 'instalar', t0)).toBe(false);
  });
  it('o "Sair" e o /entrar apagam as dispensas (e nada mais do aparelho)', () => {
    dispensar('conta-a', 'instalar');
    mapa.set('nd-compras:p1', '[]');
    esquecerCartoesDoAparelho();
    expect([...mapa.keys()]).toEqual(['nd-compras:p1']);
  });
  it('sem armazenamento (navegação privada que recusa), nada quebra: o cartão aparece', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('bloqueado'); } });
    expect(dispensado('conta-a', 'instalar')).toBe(false);
    expect(() => dispensar('conta-a', 'instalar')).not.toThrow();
    expect(() => esquecerCartoesDoAparelho()).not.toThrow();
  });
});
```

Criar `src/app/p/(portal)/inicio/mural-lista.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_MURAL, type Mural } from '@/modules/portal/mural-regras';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/signed-url', () => ({ signFileUrl: (c: string) => `/api/arquivos?c=${c}` }));
vi.mock('../agenda/actions', () => ({ confirmarAction: async () => ({}) }));
const { MuralLista } = await import('./mural-lista');

const quando = new Date('2026-10-08T12:00:00Z');
const hora = { semFuso: '09:00', comFuso: '09:00 (horário de Brasília)' };
const MURAL: Mural = {
  primeiroNome: 'Marina',
  vazio: false,
  semPlano: false,
  anteriores: [{ dia: '2026-10-07', rotulo: 'Ontem', itens: [{ chave: 'plano', tipo: 'plano', autor: 'consultorio', quando, hora, texto: 'Seu novo plano alimentar está disponível.' }] }],
  hoje: [
    { chave: 'refeicao:r1', tipo: 'refeicao', autor: 'consultorio', quando, hora: { semFuso: '12:30', comFuso: '12:30' }, texto: 'Próxima refeição às 12:30 — Almoço: arroz.', refeicaoId: 'r1', respondida: false },
    { chave: 'registro:e1', tipo: 'registro', autor: 'voce', quando, hora, refeicao: 'Almoço · 12:30', resposta: 'como_no_plano', texto: null, foto: { estado: 'sem_foto' } },
    { chave: 'comentario:e1', tipo: 'comentario', autor: 'nutricionista', quando, hora, sobre: 'Almoço · 12:30, hoje às 12:41', texto: 'Ótima combinação!' },
    { chave: 'consulta:c1', tipo: 'consulta', autor: 'consultorio', quando, hora: null, consultaId: 'c1', texto: { semFuso: 'Sua próxima consulta: amanhã, 14:00 (online).', comFuso: 'x' }, podeConfirmar: true },
    { chave: 'conteudo:k1', tipo: 'conteudo', autor: 'consultorio', quando, hora, conteudoId: 'k1', titulo: 'Lanches', texto: 'Novo conteúdo: Lanches' },
  ],
};

describe('mural "Hoje" (US-191, RNF-191)', () => {
  it('lista (ol) com o autor VISÍVEL e a hora de cada item (RN-194, §11.1); a voz da nutricionista só no comentário, com o registro a que se refere', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: MURAL, fuso: 'America/Sao_Paulo' }));
    expect(html).toContain('<ol');
    // o autor é texto visível (fora de sr-only), não só o lado ou a cor do balão
    expect(html).not.toMatch(/<span class="sr-only">(Você|Aviso do app|Sua nutricionista)/);
    expect(html).toContain('<span class="font-semibold text-texto">Você</span>');
    expect((html.match(/<span class="font-semibold text-texto">Aviso do app<\/span>/g) ?? []).length).toBe(4);
    expect(html).toContain('<span class="font-semibold text-texto">Sua nutricionista comentou seu registro (Almoço · 12:30, hoje às 12:41)</span>');
    expect(html).toMatch(/<li class="[^"]*border-l-4 border-l-marca[^"]*"/); // o comentário dela tem estilo próprio, diferente do aviso automático
    expect(html).toContain('Comi assim'); // o balão do paciente diz a resposta
    expect(html).toMatch(/<button[^>]*>Comi assim<\/button>/); // e a refeição ainda não respondida tem o botão
    expect(html).toContain('href="/p/plano/refeicao/r1"');
    expect(html).toContain('href="/p/agenda/c1"');
    expect(html).toMatch(/<button[^>]*>Confirmar presença<\/button>/);
    expect(html).toContain('Abrir<span class="sr-only"> Lanches</span>');
    expect(html).toContain('data-guia="respostas"');
  });
  it('"Dias anteriores" recolhido acima, com o separador do dia; nenhuma caixa de texto (C-191)', () => {
    const html = renderToStaticMarkup(createElement(MuralLista, { mural: MURAL, fuso: 'America/Sao_Paulo' }));
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('Próxima refeição'));
    expect(html).toMatch(/<summary[^>]*>Dias anteriores<\/summary>/);
    expect(html).toContain('>Ontem</h3>');
    expect(html).not.toMatch(/<textarea|<input[^>]*type="text"/);
  });
  it('vazio: sem plano, o texto da spec; com plano e nada para agora, o texto neutro (nunca diz que ela não publicou)', () => {
    const semPlano = renderToStaticMarkup(createElement(MuralLista, { mural: { primeiroNome: '', vazio: true, semPlano: true, hoje: [], anteriores: [] }, fuso: 'America/Sao_Paulo' }));
    expect(semPlano).toContain('Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui.');
    const comPlano = renderToStaticMarkup(createElement(MuralLista, { mural: { primeiroNome: '', vazio: true, semPlano: false, hoje: [], anteriores: [] }, fuso: 'America/Sao_Paulo' }));
    expect(comPlano).toContain(MSG_MURAL.nadaAgora);
    expect(comPlano).not.toContain('publicar seu plano');
  });
});
```

Criar `src/app/p/(portal)/inicio/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_MURAL } from '@/modules/portal/mural-regras';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, data: { user: { id: 'u1', email: 'marina@ex.com' } }, vinculo: { patientId: 'p1' }, tenant: { fuso: 'America/Sao_Paulo', examesPacienteAtivadoEm: null } }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/mural', () => ({ muralDoPaciente: async () => ({ primeiroNome: 'Marina', vazio: true, semPlano: true, hoje: [], anteriores: [] }) }));
vi.mock('@/modules/portal/jornada', () => ({
  miniJornadaDoPaciente: async () => ({
    linha1: '−4,2 kg desde março',
    linha2: { semFuso: 'Próximo marco: consulta amanhã, 14:00', comFuso: 'Próximo marco: consulta amanhã, 14:00 (horário de Brasília)' },
    complemento: '78,6 kg na última consulta',
    pontos: [82.8, 78.6],
    podeAgendar: true,
  }),
}));
vi.mock('../agenda/actions', () => ({ confirmarAction: async () => ({}) }));
const { default: Hoje } = await import('./page');

describe('/p/inicio — Hoje (US-191, RN-193, RN-202)', () => {
  it('faixa com "Olá, Marina", a mini-jornada (link para Jornada, nome acessível que contém o texto visível), o rodapé fixo, "Ver todo o diário" e a barra de ações', async () => {
    const html = renderToStaticMarkup(await Hoje());
    expect(html).toMatch(/<h1[^>]*>Olá, Marina<\/h1>/);
    // WCAG 2.5.3 (Rótulo no nome): sem aria-label no link — o texto visível faz parte do nome; o resto vai em sr-only
    expect(html).not.toMatch(/<a[^>]*href="\/p\/jornada"[^>]*aria-label/);
    expect(html).toContain('<span class="sr-only">Sua jornada: </span>−4,2 kg desde março<span class="sr-only"> (78,6 kg na última consulta)</span>');
    // no servidor (e sem JavaScript) o fuso do aparelho é desconhecido: a versão com a sigla (nunca ambígua, como QuandoLocal)
    expect(html).toContain('Próximo marco: consulta amanhã, 14:00 (horário de Brasília)');
    expect(html).toContain(MSG_MURAL.rodape);
    expect(html).toContain('href="/p/diario"');
    expect(html).toContain('<nav aria-label="Ações"');
    expect(html).not.toContain('Enviar exame'); // recebimento desligado (RN-215)
    expect(html).not.toMatch(/<textarea|Meu acompanhamento/);
  });
});
```

Run: `pnpm vitest run src/components/portal/cartoes-dispensados.test.ts "src/app/p/(portal)/inicio"` → FAIL.

- [ ] **Step 2: Os cartões dispensados e os componentes do aparelho**

Criar `src/components/portal/cartoes-dispensados.ts`:

```ts
/**
 * Plano 16 (RN-201): "Agora não" nos cartões do aparelho (notificações, instalar) esconde por 30 dias NESTE aparelho, por
 * conta (a chave leva a conta: outra pessoa no mesmo aparelho vê o cartão). Sai no "Sair" e no /entrar (como a lista de
 * compras). Sem dado de saúde. Sem armazenamento, o cartão aparece (nunca quebra a tela).
 */
const PREFIXO = 'nd-cartao:';
export const DISPENSA_MS = 30 * 24 * 60 * 60 * 1000;
const chave = (conta: string, cartao: string) => `${PREFIXO}${conta}:${cartao}`;

export function dispensado(conta: string, cartao: string, agora: number = Date.now()): boolean {
  try {
    const v = Number(localStorage.getItem(chave(conta, cartao)));
    return Number.isFinite(v) && v > 0 && agora - v < DISPENSA_MS;
  } catch {
    return false;
  }
}

export function dispensar(conta: string, cartao: string, agora: number = Date.now()): void {
  try {
    localStorage.setItem(chave(conta, cartao), String(agora));
  } catch {
    // sem armazenamento: vale enquanto a tela estiver aberta (estado do componente)
  }
}

export function esquecerCartoesDoAparelho(): void {
  try {
    const chaves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIXO)) chaves.push(k);
    }
    for (const k of chaves) localStorage.removeItem(k);
  } catch {
    // sem armazenamento: nada guardado
  }
}
```

Em `src/app/p/sair-portal.tsx`, no `limparAparelho`, logo depois de `esquecerComprasDoAparelho();`: `esquecerCartoesDoAparelho(); // RN-201: os cartões dispensados` (import de `@/components/portal/cartoes-dispensados`). Em `src/app/entrar/page.tsx`, no mesmo `useEffect` que chama `esquecerComprasDoAparelho()`, a mesma chamada.

Em `src/app/p/notificacoes.tsx`, `AtivarNotificacoes` ganha a prop opcional `cartao?: (conteudo: ReactNode) => ReactNode` (import de `type ReactNode`): com ela, só **abre** nos estados em que há o que fazer, dentro do cartão — e, depois que a pessoa agiu nesta tela, o cartão **continua** mostrando o resultado ("Notificações ativadas neste aparelho." com o `role="status"` de hoje, ou o texto do "negado") até a próxima abertura (correção da revisão do plano: sem isso, o cartão some junto com a confirmação e o foco cai no `<body>`). Um `const [agiu, setAgiu] = useState(false)`, com `setAgiu(true)` no começo do handler do botão "Ativar notificações" (antes do primeiro `setEstado`):

```tsx
export function AtivarNotificacoes({ chavePublica, dono, cartao }: { chavePublica: string | null; dono: string; cartao?: (conteudo: ReactNode) => ReactNode }) {
  // …o corpo de antes até o `if (estado === 'carregando' || estado === 'instale') return null;`
  // Plano 16 (RN-201): no mural, o cartão só aparece quando dá para ativar (ou a tentativa falhou); depois de agir nesta
  // tela, fica até a próxima abertura, com o resultado (ativo/negado) anunciado pela região viva de hoje
  if (cartao && !agiu && estado !== 'pode' && estado !== 'falhou') return null;
  const link = linkDaRecusa(recusa);
  const conteudo = (
    <div className="space-y-2">{/* …o JSX de antes, sem mudança */}</div>
  );
  return cartao ? cartao(conteudo) : conteudo;
}
```

Em `src/app/p/instalar.tsx`, `Instalar` ganha a mesma prop: os dois `return` com JSX passam a guardar o JSX numa constante e devolvem `cartao ? cartao(jsx) : jsx`; o `return null` do fim continua (nada a fazer = nenhum cartão). Se o Android some com o botão depois de "Instalar app" (evento `appinstalled` ou a escolha do prompt), o cartão some também: antes de sumir, o foco vai para o link "Ver todo o diário" (`id="ver-todo-diario"`, Step 4), como no "Agora não".

Criar `src/app/p/(portal)/inicio/cartoes-do-aparelho.tsx`:

```tsx
'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { dispensado, dispensar } from '@/components/portal/cartoes-dispensados';
import { Instalar } from '../../instalar';
import { AtivarNotificacoes } from '../../notificacoes';

const CARTOES = {
  notificacoes: 'Ative as notificações para saber quando houver novidades.',
  instalar: 'Instale o app na tela inicial.',
} as const;
type Cartao = keyof typeof CARTOES;
const semAssinatura = () => () => {};

/** Plano 16 (§4.3, RN-201): os cartões do aparelho no topo do mural, enquanto não feitos neste aparelho; "Agora não" esconde por 30 dias. */
export function CartoesDoAparelho({ conta, dono, chavePublica }: { conta: string; dono: string; chavePublica: string | null }) {
  // o localStorage só existe no cliente: no servidor e na hidratação, nenhum cartão
  const noCliente = useSyncExternalStore(semAssinatura, () => true, () => false);
  const [fechados, setFechados] = useState<ReadonlySet<Cartao>>(() => new Set());
  if (!noCliente) return null;
  const visivel = (c: Cartao) => !fechados.has(c) && !dispensado(conta, c);
  // função com nome (react/display-name): o cartão em volta do que AtivarNotificacoes/Instalar decidem mostrar
  const moldura = (c: Cartao) =>
    function MolduraDoCartao(conteudo: ReactNode) {
      return (
        <section aria-label={CARTOES[c]} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
          <p>{CARTOES[c]}</p>
          {conteudo}
          <button
            type="button"
            onClick={() => {
              dispensar(conta, c);
              setFechados((f) => new Set(f).add(c));
              // o botão sai do DOM com o cartão: o foco vai ao próximo ponto estável do mural, nunca ao <body>
              document.getElementById('ver-todo-diario')?.focus();
            }}
            className="min-h-11 px-2 text-link underline"
          >
            Agora não
          </button>
        </section>
      );
    };
  return (
    <>
      {visivel('notificacoes') && <AtivarNotificacoes chavePublica={chavePublica} dono={dono} cartao={moldura('notificacoes')} />}
      {visivel('instalar') && <Instalar cartao={moldura('instalar')} />}
    </>
  );
}
```

Criar `src/app/p/(portal)/inicio/confirmar-no-mural.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { useOnline } from '@/components/portal/online';
import { confirmarAction, type AgendaState } from '../agenda/actions';

/**
 * US-191 "Consulta próxima": a mesma ação da tela da consulta (Plano 05); depois, o mural é buscado de novo. Correção da
 * revisão do plano (RNF-191, memória "mensagem de sucesso desmontada", Plano 11 T14): o componente fica montado em todo item
 * de consulta (o refresh devolve podeConfirmar = false e o botão some, mas o estado e a região viva continuam); a região
 * role="status" está SEMPRE montada e só o texto muda; o foco, que estava no botão que saiu, vai para a confirmação.
 */
export function ConfirmarNoMural({ id, podeConfirmar }: { id: string; podeConfirmar: boolean }) {
  const router = useRouter();
  const online = useOnline();
  const aviso = useRef<HTMLParagraphElement>(null);
  const [estado, confirmar, confirmando] = useActionState<AgendaState>(async () => {
    const r = await confirmarAction(id);
    if (r.ok) router.refresh();
    return r;
  }, {});
  useEffect(() => {
    if (estado.ok) aviso.current?.focus();
  }, [estado.ok]);
  return (
    <form action={confirmar} className="space-y-1">
      {podeConfirmar && !estado.ok && (
        <button disabled={confirmando || !online} className="min-h-11 rounded-full bg-destaque px-4 font-semibold text-white disabled:opacity-60">Confirmar presença</button>
      )}
      {estado.erro && <p role="alert" className="text-sm text-erro">{estado.erro}</p>}
      <p ref={aviso} tabIndex={-1} role="status" className="text-sm">{estado.ok ?? ''}</p>
    </form>
  );
}
```

Criar `src/app/p/(portal)/inicio/atualizar-ao-voltar.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** RN-195: o mural é do servidor; volta a ser buscado quando o app volta ao primeiro plano — sem anunciar nada ao leitor de tela. */
export function AtualizarAoVoltar() {
  const router = useRouter();
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [router]);
  return null;
}
```

Criar `src/components/portal/mini-jornada.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { precisaDaSigla } from '@/app/p/quando-local';
import { MSG_JORNADA } from '@/modules/portal/jornada-regras';

type Texto = { semFuso: string; comFuso: string };
const semAssinatura = () => () => {};
const fusoDoAparelho = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

/** O gráfico pequeno (decorativo, aria-hidden): os pesos em linha, traço branco a 85% (§4.7). Sem pontos, nada. */
function Tracinho({ pontos }: { pontos: number[] }) {
  const [min, max] = [Math.min(...pontos), Math.max(...pontos)];
  const y = (v: number) => (max === min ? 14 : 4 + ((max - v) / (max - min)) * 20);
  const d = pontos.map((v, i) => `${(i / (pontos.length - 1)) * 72 + 4},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg aria-hidden="true" viewBox="0 0 80 28" className="h-7 w-20 shrink-0">
      <polyline points={d} fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Plano 16 (RN-202): a mini-jornada na faixa de Hoje — link para Jornada com a frase inteira como nome acessível, sem cor
 * de "bom" ou "ruim" (RN-206). Texto branco sobre o cartão translúcido (≥ 4,5:1 por corDaFaixa). Com o aparelho noutro
 * fuso, a hora leva a sigla (RN-06, como QuandoLocal).
 */
export function MiniJornada({ linha1, linha2, complemento, pontos, fuso }: { linha1: string; linha2: Texto; complemento: string | null; pontos: number[]; fuso: string }) {
  const aparelho = useSyncExternalStore(semAssinatura, fusoDoAparelho, () => '');
  const v = (t: Texto) => (precisaDaSigla(aparelho, fuso) ? t.comFuso : t.semFuso);
  // WCAG 2.5.3 (Rótulo no nome, nível A): sem aria-label — quem usa comando de voz diz o que vê ("−4,2 kg desde março").
  return (
    <Link href="/p/jornada" className="mt-3 flex min-h-11 items-center gap-3 rounded-2xl bg-faixa-cartao p-3 text-white">
      {pontos.length >= 2 && <Tracinho pontos={pontos} />}
      <span className="min-w-0 flex-1">
        <span className="block font-portal-titulo text-lg font-extrabold">
          {!linha1.startsWith(MSG_JORNADA.titulo) && <span className="sr-only">{`${MSG_JORNADA.titulo}: `}</span>}
          {linha1}
          {complemento && <span className="sr-only">{` (${complemento})`}</span>}
        </span>
        <span className="block text-sm">{v(linha2)}</span>
      </span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
```

- [ ] **Step 3: A lista do mural**

Criar `src/app/p/(portal)/inicio/mural-lista.tsx`:

```tsx
import Link from 'next/link';
import { ComiAssim } from '@/components/portal/comi-assim';
import { signFileUrl } from '@/lib/signed-url';
import { MSG_DIARIO, ROTULO_RESPOSTA } from '@/modules/portal/diario-constantes';
import { MSG_MURAL, type ItemDoMural, type Mural } from '@/modules/portal/mural-regras';
import { QuandoLocal } from '../../quando-local';
import { ConfirmarNoMural } from './confirmar-no-mural';

const B = MSG_MURAL.botoes;
const LINK = 'inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-3 text-sm font-semibold text-link';

function Acoes({ item, guia }: { item: ItemDoMural; guia: boolean }) {
  const link = (href: string, texto: string, extra?: string) => (
    <Link href={href} className={LINK}>
      {texto}
      {extra && <span className="sr-only">{` ${extra}`}</span>}
    </Link>
  );
  switch (item.tipo) {
    case 'refeicao':
      return (
        <div data-guia={guia ? 'respostas' : undefined} className="flex flex-wrap items-start gap-2">
          {link(`/p/plano/refeicao/${item.refeicaoId}`, B.verRefeicao)}
          {!item.respondida && <ComiAssim refeicaoId={item.refeicaoId} />}
        </div>
      );
    case 'registro':
    case 'comentario':
      return link('/p/diario', B.verDiario);
    case 'exame':
      return link('/p/exames', B.verExames);
    case 'consulta':
      return (
        <div className="flex flex-wrap items-start gap-2">
          {link(`/p/agenda/${item.consultaId}`, B.verConsulta)}
          {/* sempre montado: depois do refresh (podeConfirmar = false) a confirmação continua na tela e anunciada */}
          <ConfirmarNoMural id={item.consultaId} podeConfirmar={item.podeConfirmar} />
        </div>
      );
    case 'plano':
      return link('/p/plano', B.verPlano);
    case 'conteudo':
      return link(`/p/conteudos/${item.conteudoId}`, B.abrir, item.titulo);
    case 'documentos':
      return link('/p/documentos', B.verDocumentos);
  }
}

function Corpo({ item, fuso }: { item: ItemDoMural; fuso: string }) {
  switch (item.tipo) {
    case 'registro':
      return (
        <>
          <p className="font-medium">{`${item.refeicao}${item.resposta ? ` · ${ROTULO_RESPOSTA[item.resposta]}` : ''}`}</p>
          {item.texto && <p className="whitespace-pre-line">{item.texto}</p>}
          {item.foto.estado === 'pronta' && (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (CLAUDE.md regra 9)
            <img src={signFileUrl(item.foto.caminho)} alt={`Foto do registro de ${item.refeicao}`} className="max-h-60 rounded-xl" />
          )}
          {item.foto.estado === 'processando' && <p className="text-sm">{MSG_DIARIO.processando}</p>}
          {item.foto.estado === 'falhou' && <p className="text-sm text-erro">{MSG_DIARIO.fotoFalhou}</p>}
        </>
      );
    case 'consulta':
      return <p><QuandoLocal semFuso={item.texto.semFuso} comFuso={item.texto.comFuso} fuso={fuso} /></p>;
    default:
      return <p className="whitespace-pre-line">{item.texto}</p>;
  }
}

/**
 * RNF-191, RN-194, §11.1 (correção da revisão do plano): autor VISÍVEL em todo item — "Você", "Aviso do app" ou o rótulo do
 * comentário dela —, não só o lado ou a cor do balão (que lembraria um chat, R-190). O comentário da nutricionista tem
 * estilo próprio (borda de destaque), diferente do aviso automático.
 */
const ESTILO = {
  voce: 'ml-8 space-y-2 rounded-2xl bg-p-clara p-3',
  consultorio: 'mr-8 space-y-2 rounded-2xl border border-borda bg-cartao p-3',
  nutricionista: 'mr-8 space-y-2 rounded-2xl border border-borda border-l-4 border-l-marca bg-cartao p-3',
} as const;
function Item({ item, fuso, guia }: { item: ItemDoMural; fuso: string; guia: boolean }) {
  const autor = item.tipo === 'comentario' ? MSG_MURAL.nutricionistaComentou(item.sobre) : MSG_MURAL.autor[item.autor];
  return (
    <li className={ESTILO[item.autor]}>
      <p className="text-sm text-suave">
        <span className="font-semibold text-texto">{autor}</span>
        {item.hora && ' · '}
        {item.hora && <QuandoLocal semFuso={item.hora.semFuso} comFuso={item.hora.comFuso} fuso={fuso} />}
      </p>
      <Corpo item={item} fuso={fuso} />
      <Acoes item={item} guia={guia} />
    </li>
  );
}

/** Plano 16 (§4.3, RN-195): "Dias anteriores" recolhido acima; Hoje em ordem crescente; vazio com o texto da spec. */
export function MuralLista({ mural, fuso }: { mural: Mural; fuso: string }) {
  const primeiraRefeicao = mural.hoje.find((i) => i.tipo === 'refeicao')?.chave;
  return (
    <>
      {mural.anteriores.length > 0 && (
        <details className="rounded-2xl border border-borda bg-cartao p-3">
          <summary className="min-h-11 cursor-pointer font-semibold">{MSG_MURAL.diasAnteriores}</summary>
          {mural.anteriores.map((d) => (
            <section key={d.dia} aria-labelledby={`dia-${d.dia}`} className="mt-3 space-y-2">
              <h3 id={`dia-${d.dia}`} className="text-center text-sm font-semibold text-suave">{d.rotulo}</h3>
              <ol className="space-y-2">
                {d.itens.map((i) => <Item key={i.chave} item={i} fuso={fuso} guia={false} />)}
              </ol>
            </section>
          ))}
        </details>
      )}
      {mural.vazio ? (
        <p>{mural.semPlano ? MSG_MURAL.vazio : MSG_MURAL.nadaAgora}</p>
      ) : (
        mural.hoje.length > 0 && (
          <ol aria-label="Hoje" className="space-y-2">
            {mural.hoje.map((i) => <Item key={i.chave} item={i} fuso={fuso} guia={i.chave === primeiraRefeicao} />)}
          </ol>
        )
      )}
    </>
  );
}
```

- [ ] **Step 4: A página**

Trocar `src/app/p/(portal)/inicio/page.tsx`:

```tsx
import Link from 'next/link';
import { BarraDeAcoes } from '@/components/portal/barra-de-acoes';
import { Faixa } from '@/components/portal/faixa';
import { MiniJornada } from '@/components/portal/mini-jornada';
import { MSG_G } from '@/components/portal/textos';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { dataDaFaixa } from '@/modules/portal/datas-portal';
import { miniJornadaDoPaciente } from '@/modules/portal/jornada';
import { muralDoPaciente } from '@/modules/portal/mural';
import { MSG_MURAL } from '@/modules/portal/mural-regras';
import { molduraDaSecao } from '../../moldura';
import { AtualizarAoVoltar } from './atualizar-ao-voltar';
import { CartoesDoAparelho } from './cartoes-do-aparelho';
import { MuralLista } from './mural-lista';

export const dynamic = 'force-dynamic';

/**
 * Plano 16 (US-191, §4.3): Hoje — a faixa com a saudação e a mini-jornada, o mural do consultório (leitura: nada é
 * gravado para ele existir; não é chat, RN-193), os cartões do aparelho e a barra de ações. Duas transações curtas: o mural
 * e a mini-jornada (D2).
 */
export default async function Hoje() {
  const acesso = await requirePaciente('/p/inicio');
  const { ctx, tenant, vinculo, data } = acesso;
  const agora = new Date();
  const [moldura, mural, mini] = await Promise.all([molduraDaSecao(acesso), muralDoPaciente(ctx, tenant, agora), miniJornadaDoPaciente(ctx, tenant, agora)]);
  return (
    <>
      <Faixa {...moldura} atual="/p/inicio" titulo={MSG_G.titulos.hoje(mural.primeiroNome)} subtitulo={dataDaFaixa(hojeNoFuso(tenant.fuso, agora))}>
        <MiniJornada linha1={mini.linha1} linha2={mini.linha2} complemento={mini.complemento} pontos={mini.pontos} fuso={tenant.fuso} />
      </Faixa>
      <main data-guia="mural" className="flex-1 space-y-4 p-4">
        <CartoesDoAparelho conta={data.user.id} dono={vinculo.patientId} chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} />
        <p>
          <Link id="ver-todo-diario" href="/p/diario" className="inline-flex min-h-11 items-center font-semibold text-link underline">{MSG_MURAL.verTodoDiario}</Link>
        </p>
        <MuralLista mural={mural} fuso={tenant.fuso} />
        <p className="text-sm text-suave">{MSG_MURAL.rodape}</p>
      </main>
      <BarraDeAcoes exames={Boolean(tenant.examesPacienteAtivadoEm)} podeAgendar={mini.podeAgendar} />
      <AtualizarAoVoltar />
    </>
  );
}
```

O "Conectado como {e-mail}" sai de Hoje (vai para Eu na T13). `primeiroNomeDoPaciente` (T4) fica sem uso: apagar a função e o caso dela em `perfil.test.ts` (o `primeiroNome` puro continua).

Em `e2e/acessibilidade.spec.ts`, o teste "alvo de toque ≥ 44 px (RNF-10): 'Próxima consulta' no Início…" troca a primeira conferência (o link "Próxima consulta:" saiu de Hoje) pela barra de ações e pelo "Ver todo o diário":

```ts
  await paciente.page.goto('/p/inicio');
  for (const link of [paciente.page.getByRole('navigation', { name: 'Ações' }).getByRole('link').first(), paciente.page.getByRole('link', { name: 'Ver todo o diário' })])
    expect(await altura(link)).toBeGreaterThanOrEqual(44);
```

- [ ] **Step 5: Rodar e commitar**

```bash
pnpm vitest run src/components/portal "src/app/p" src/modules/portal/perfil.test.ts src/app/painel/cores.test.ts src/app/formularios-post.test.ts
pnpm typecheck && pnpm lint
git add src/components/portal "src/app/p/(portal)/inicio" src/app/p/notificacoes.tsx src/app/p/instalar.tsx src/app/p/sair-portal.tsx src/app/entrar/page.tsx src/modules/portal/perfil.ts src/modules/portal/perfil.test.ts e2e/acessibilidade.spec.ts
git commit -m "$(cat <<'MSG'
feat(portal): Hoje com o mural do consultório, a mini-jornada e as ações (P16-10)

O mural lista as refeições, o diário, o comentário da nutricionista, os
exames, a consulta e as novidades com o autor e a hora no texto; Comi assim
e Confirmar presença no próprio item; rodapé fixo de que o app não envia
mensagens; cartões do aparelho com Agora não por 30 dias; a mini-jornada
leva à Jornada com a frase inteira como nome acessível.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 11: Plano em sanfona, refeição aberta, "Comi assim" com "Desfazer" e o diário com a resposta (P16-11)

**Revisão: leve (revisor-interface)** — sanfona e refeição aberta (molde F-Plano/GV-Almoço), o aviso "Desfazer" (WCAG 2.2.1, `role="status"`), botões desabilitados sem rede, formulário do diário com a refeição já escolhida, câmera, offline (a cópia do plano com tudo dentro).

**Files:**
- Create: `src/components/portal/comi-assim-estado.ts` (+ `comi-assim-estado.test.ts`), `src/components/portal/comi-assim.tsx`, `src/components/portal/online.ts`, `src/components/portal/link-de-resposta.tsx`, `src/app/p/(portal)/plano/refeicao-detalhe.tsx`, `src/app/p/(portal)/plano/abrir-refeicao-da-url.tsx`, `src/app/p/(portal)/plano/refeicao/[id]/page.tsx` (+ `page.test.ts`)
- Modify: `src/modules/portal/plano.ts` (+ `plano.test.ts`), `src/app/p/(portal)/plano/page.tsx` (+ `page.test.ts`), `src/app/p/(portal)/diario/page.tsx`, `src/app/p/(portal)/diario/diario-form.tsx` (+ `diario-form.test.ts`), `e2e/portal.spec.ts` (o item do plano em colunas)

**Interfaces:**
- Consumes: T4 (`Faixa`, `CabecalhoDetalhe`, `molduraDaSecao`, `MSG_G`), T5 (`daquiA`, `resumoDaRefeicao`), T7 (`respostasDeHoje`, `MSG_DIARIO.registrado`, a rota com `refeicaoId`/`resposta`), T1 (`rotuloDaRefeicao`, `ROTULO_RESPOSTA`); `planoDoPaciente`, `versaoDaCopiaOffline`, `GuardarPlano`, `recusaDoPortal`, `totalDosItens`, `kcalTexto`, `partesNoFuso`, `idValido`.
- Produces: `ComiAssim` (`src/components/portal/comi-assim.tsx`; a T10 usa no mural), `PRAZO_DESFAZER_MS`, `MSG_COMI_ASSIM`, `useOnline`; `RefeicaoDoPaciente.kcal`, `PlanoDoPaciente.mostrarCalorias`; a rota `/p/plano/refeicao/[id]`; o `DiarioForm` com `refeicaoDoPlano`, `resposta` e `foto`.

- [ ] **Step 1: Testes (falham)**

Criar `src/components/portal/comi-assim-estado.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mensagemDaFase, MSG_COMI_ASSIM, mostraBotao, PRAZO_DESFAZER_MS, sobra } from './comi-assim-estado';

describe('"Comi assim" com "Desfazer" (G-D5 ★ = c, RN-198)', () => {
  it('prazo de 10 s que pausa (WCAG 2.2.1): o que sobra nunca é negativo', () => {
    expect(PRAZO_DESFAZER_MS).toBe(10_000);
    expect(sobra(10_000, 3_500)).toBe(6_500);
    expect(sobra(2_000, 5_000)).toBe(0);
  });
  it('mensagens da região viva (sempre montada) e o botão que some depois da resposta', () => {
    expect(mensagemDaFase('pronto')).toBe('');
    expect(mensagemDaFase('aguardando')).toBe('Registrado no diário.');
    expect(mensagemDaFase('feito')).toBe('Registrado no diário.');
    expect(mensagemDaFase('desfeito')).toBe(MSG_COMI_ASSIM.desfeito);
    expect(MSG_COMI_ASSIM).toEqual({ desfazer: 'Desfazer', desfeito: 'Registro desfeito.', semConexao: 'Sem conexão. Registre quando voltar.', podeDesfazer: 'Para desfazer, use o botão Desfazer logo abaixo.' });
    expect(['pronto', 'aguardando', 'enviando', 'feito', 'desfeito', 'erro'].filter((f) => mostraBotao(f as never))).toEqual(['pronto', 'desfeito', 'erro']);
  });
});
```

Criar `src/app/p/(portal)/plano/refeicao/[id]/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const ID = '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('@/modules/portal/diario', () => ({ respostasDeHoje: async () => new Set<string>() }));
vi.mock('@/modules/portal/plano', async (orig) => ({
  ...(await orig<typeof import('@/modules/portal/plano')>()),
  planoDoPaciente: async () => ({
    id: 'p1',
    titulo: 'Plano',
    orientacoes: '',
    totalKcal: null,
    mostrarCalorias: true,
    pdf: 'indisponivel',
    proximaRefeicaoId: ID,
    refeicoes: [
      {
        id: ID,
        nome: 'Almoço',
        horario: '12:30',
        observacao: 'Comece pela salada.',
        kcal: '512 kcal',
        itens: [
          { id: 'i1', nome: 'Arroz integral', quantidade: '4 colheres de sopa', kcal: '160 kcal', substituicoes: [{ id: 's1', nome: 'Batata-doce', quantidade: '1 média', kcal: null }, { id: 's2', nome: 'Mandioca', quantidade: '2 pedaços', kcal: null }] },
          { id: 'i2', nome: 'feijão', quantidade: '1 concha', kcal: null, substituicoes: [] },
        ],
      },
    ],
  }),
}));
const { default: Refeicao } = await import('./page');
const pagina = (id: string) => Refeicao({ params: Promise.resolve({ id }) } as never);

describe('/p/plano/refeicao/[id] (US-193, RN-213)', () => {
  it('chip, título com os itens principais, quantidades, trocas, observação dela, kcal e as três respostas', async () => {
    const html = renderToStaticMarkup(await pagina(ID));
    expect(html).toContain('Almoço · 12:30');
    expect(html).toMatch(/<h2[^>]*>Arroz integral e feijão<\/h2>/);
    expect(html).toContain('4 colheres de sopa');
    expect(html).toContain('ou batata-doce, 1 média · ou mandioca, 2 pedaços');
    expect(html).toContain('Observação da sua nutricionista');
    expect(html).toContain('Comece pela salada.');
    expect(html).toContain('Cerca de 512 kcal');
    expect(html).toContain(`href="/p/diario?refeicao=${ID}&amp;foto=1#registrar"`);
    expect(html).toContain(`href="/p/diario?refeicao=${ID}&amp;resposta=outra_coisa#registrar"`);
    expect(html).toMatch(/<button[^>]*>Comi assim<\/button>/);
    expect(html).toContain('aria-label="Voltar para Plano"');
  });
  it('refeição que não é do plano publicado do paciente → 404 (RN-213)', async () => {
    await expect(pagina('1b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).rejects.toThrow('notFound');
    await expect(pagina('nao-e-uuid')).rejects.toThrow('notFound');
  });
});
```

Trocar o teste de `src/app/p/(portal)/plano/page.test.ts` (o `<summary>` das substituições sai: as trocas ficam escritas, "ou {nome}, {quantidade}"; o mock de `planoDoPaciente` ganha `mostrarCalorias: false` e `kcal: null` na refeição; mock novo para a moldura; `respostasDeHoje` **não** é chamada — a cópia offline não leva dado do diário):

```ts
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/p/moldura', () => ({
  molduraDaSecao: async () => ({ marca: { nome: 'Consultório', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }),
}));
const respostas = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock('@/modules/portal/diario', () => ({ respostasDeHoje: respostas }));
// …o mock de planoDoPaciente de antes, com `mostrarCalorias: false` no plano e `kcal: null` na refeição

describe('/p/plano em sanfona (US-196, F-Plano)', () => {
  it('cada refeição é um <details> com o h3 "{nome} · {HH:MM}" e o summary sem flex/grid (marcador visível); as trocas escritas; nada do diário na cópia offline', async () => {
    const html = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    expect(html).toMatch(/<details id="ref-r1"[^>]*><summary[^>]*><h3[^>]*>Almoço · 12:00<\/h3>/);
    expect(html).not.toMatch(/<summary[^>]*class="[^"]*\b(flex|grid|inline-flex)\b/);
    expect(html).toContain('ou batata, 150 g');
    expect(html).not.toContain('No diário'); // §4.8/§10: a cópia offline não guarda o que o paciente comeu hoje
    expect(respostas).not.toHaveBeenCalled();
    expect(html).toMatch(/<button[^>]*>Comi assim<\/button>/);
    expect(html).toContain('href="/p/conteudos"'); // G-D8 ★ = a: Conteúdos dentro de Plano
    expect(html).toContain('href="/p/compras"');
  });
});
```

Em `src/modules/portal/plano.test.ts`, acrescentar ao primeiro teste (o plano do helper local mostra calorias):

```ts
    // Plano 16 (RN-213): o total da refeição (sem as substituições), só com "mostrar calorias"
    expect(plano!.refeicoes.map((r) => r.kcal)).toEqual(['64 kcal', '128 kcal']);
    expect(plano!.mostrarCalorias).toBe(true);
```

e um caso novo:

```ts
  it('Plano 16: refeição sem horário não é a "próxima" (vai para o fim da sanfona e nunca ao mural, RN-196)', () => {
    expect(proximaRefeicao([{ id: 'ceia', horario: '' }, { id: 'almoco', horario: '12:30' }], '10:00')).toBe('almoco');
    expect(proximaRefeicao([{ id: 'ceia', horario: '' }], '10:00')).toBeNull();
  });
```

Em `src/app/p/(portal)/diario/diario-form.test.ts`, acrescentar:

```ts
describe('DiarioForm com a refeição do plano (Plano 16, US-192)', () => {
  it('a refeição já escolhida vai num campo escondido (sem a lista); "Como foi?" com as duas respostas, "Comi outra coisa" marcada quando pedida', () => {
    const html = renderToStaticMarkup(createElement(DiarioForm, { refeicaoDoPlano: { id: 'r1', rotulo: 'Almoço · 12:30' }, resposta: 'outra_coisa' }));
    expect(html).toContain('<input type="hidden" name="refeicaoId" value="r1"/>');
    expect(html).not.toContain('<select');
    expect(html).toContain('Almoço · 12:30');
    expect(html).toContain('<legend');
    expect(html).toMatch(/<input[^>]*value="outra_coisa"[^>]*checked=""/);
    expect(html).toMatch(/<input[^>]*value="como_no_plano"/);
  });
  it('"Foto da refeição": o campo da foto pede a câmera traseira (RNF-195)', () => {
    expect(renderToStaticMarkup(createElement(DiarioForm, { foto: true }))).toMatch(/<input[^>]*capture="environment"/);
    expect(renderToStaticMarkup(createElement(DiarioForm))).not.toContain('capture=');
  });
});
```

Run: `pnpm vitest run src/components/portal/comi-assim-estado.test.ts "src/app/p/(portal)/plano" "src/app/p/(portal)/diario" src/modules/portal/plano.test.ts` → FAIL.

- [ ] **Step 2: O plano com o total da refeição**

Em `src/modules/portal/plano.ts`: importar `totalDosItens` junto de `kcalTexto` (de `@/modules/plano-alimentar/calculo`); `RefeicaoDoPaciente` ganha `kcal: string | null` e `PlanoDoPaciente` ganha `mostrarCalorias: boolean`; no `map` das refeições acrescentar

```ts
      // RN-213: "Cerca de {total} kcal" na refeição aberta — o total dos itens principais (as substituições não somam)
      kcal: mostrar ? `${kcalTexto(totalDosItens(r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId }))).kcal)} kcal` : null,
```

no objeto devolvido, `mostrarCalorias: mostrar,`; e trocar `proximaRefeicao` para ignorar refeição sem horário (antes, `''` caía no fim da busca e voltava como a "primeira do dia seguinte"):

```ts
/** A primeira refeição COM HORÁRIO a partir de agora (HH:MM no fuso do tenant); depois da última, a primeira do dia seguinte. */
export function proximaRefeicao(horarios: { id: string; horario: string }[], agoraHHMM: string): string | null {
  const ordem = horarios.filter((r) => r.horario).sort((a, b) => a.horario.localeCompare(b.horario));
  return (ordem.find((r) => r.horario >= agoraHHMM) ?? ordem[0])?.id ?? null;
}
```

E a ordem das refeições devolvidas põe as sem horário **no fim** (antes iam para o começo, `'' < '07:00'`):

```ts
    .sort((a, b) => (a.horario === '' ? 1 : 0) - (b.horario === '' ? 1 : 0) || a.horario.localeCompare(b.horario))
```

- [ ] **Step 3: O estado do "Comi assim", o `useOnline` e o componente**

Criar `src/components/portal/comi-assim-estado.ts`:

```ts
import { MSG_DIARIO } from '@/modules/portal/diario-constantes';

/** Plano 16 (G-D5 ★ = c, RN-198): o aviso "Desfazer" fica 10 s antes de enviar. Com (a), 0 (envia no toque). */
// `: number`: com o tipo literal, o `PRAZO_DESFAZER_MS === 0` do componente não compila (TS2367)
export const PRAZO_DESFAZER_MS: number = 10_000;

export const MSG_COMI_ASSIM = { desfazer: 'Desfazer', desfeito: 'Registro desfeito.', semConexao: 'Sem conexão. Registre quando voltar.', podeDesfazer: 'Para desfazer, use o botão Desfazer logo abaixo.' } as const;

export type FaseComiAssim = 'pronto' | 'aguardando' | 'enviando' | 'feito' | 'desfeito' | 'erro';

/** O que sobra do prazo depois de `decorridoMs` (a pausa da WCAG 2.2.1 guarda isto). */
export const sobra = (restanteMs: number, decorridoMs: number): number => Math.max(0, restanteMs - decorridoMs);

/** O texto da região viva (role="status", sempre montada — molde de privacidade.tsx). O erro vai num role="alert" à parte. */
export function mensagemDaFase(f: FaseComiAssim): string {
  if (f === 'aguardando' || f === 'enviando' || f === 'feito') return MSG_DIARIO.registrado;
  if (f === 'desfeito') return MSG_COMI_ASSIM.desfeito;
  return '';
}

/** O botão "Comi assim" some depois da resposta (RN-197) e volta no "Desfazer" ou no erro. */
export const mostraBotao = (f: FaseComiAssim): boolean => f === 'pronto' || f === 'desfeito' || f === 'erro';
```

Criar `src/components/portal/online.ts`:

```ts
'use client';
import { useSyncExternalStore } from 'react';

const assinar = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** RN-208: sem rede, os botões que gravam ficam desabilitados. No servidor e na hidratação, "online" (o HTML não mente sobre o aparelho). */
export function useOnline(): boolean {
  return useSyncExternalStore(assinar, () => navigator.onLine, () => true);
}
```

Criar `src/components/portal/comi-assim.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { recusaDoPortal } from '@/app/p/recusa-api';
import { MSG_DIARIO, ROTULO_RESPOSTA } from '@/modules/portal/diario-constantes';
import { mensagemDaFase, mostraBotao, MSG_COMI_ASSIM, PRAZO_DESFAZER_MS, sobra, type FaseComiAssim } from './comi-assim-estado';
import { useOnline } from './online';

/**
 * Plano 16 (US-192, RN-197, RN-198): "Comi assim" grava no diário (POST /api/p/diario, refeicaoId + resposta). O toque
 * mostra "Registrado no diário." com "Desfazer" por 10 s; o prazo pausa com foco ou ponteiro no aviso (WCAG 2.2.1); ao fim
 * do prazo, ao sair da tela (pagehide) ou ao desmontar, envia com keepalive — o paciente já disse que comeu. "Desfazer"
 * cancela antes de enviar: sem DELETE no banco (P06 D11). Sem rede, desabilitado (RN-208).
 */
export function ComiAssim({ refeicaoId }: { refeicaoId: string }) {
  const router = useRouter();
  const online = useOnline();
  const [fase, setFase] = useState<FaseComiAssim>('pronto');
  const [erro, setErro] = useState<string | null>(null);
  const pendente = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prazo = useRef({ restante: PRAZO_DESFAZER_MS, desde: 0 });
  // Correção da revisão do plano: quem chegou pelo foco (teclado, leitor de tela) não pode perder o foco no <body> quando o
  // botão sai do DOM — o foco vai ao "Desfazer" (o que já pausa o prazo, WCAG 2.2.1) e, ao desfazer, volta ao "Comi assim".
  const botao = useRef<HTMLButtonElement>(null);
  const botaoDesfazer = useRef<HTMLButtonElement>(null);
  const focoPara = useRef<'desfazer' | 'botao' | null>(null);
  useEffect(() => {
    if (focoPara.current === 'desfazer' && fase === 'aguardando') botaoDesfazer.current?.focus();
    if (focoPara.current === 'botao' && mostraBotao(fase)) botao.current?.focus();
    focoPara.current = null;
  }, [fase]);

  const enviar = useCallback(
    async (keepalive: boolean) => {
      if (!pendente.current) return;
      pendente.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setFase('enviando');
      const corpo = new FormData();
      corpo.set('refeicaoId', refeicaoId);
      corpo.set('resposta', 'como_no_plano');
      try {
        const r = await fetch('/api/p/diario', { method: 'POST', body: corpo, keepalive });
        if (r.ok) {
          setFase('feito');
          router.refresh();
          return;
        }
        const dados = (await r.json().catch(() => ({}))) as { erros?: { geral?: string } };
        setErro(recusaDoPortal(r.status, dados, location.pathname)?.mensagem ?? dados.erros?.geral ?? MSG_DIARIO.ocupado);
      } catch {
        setErro(MSG_DIARIO.ocupado);
      }
      setFase('erro');
    },
    [refeicaoId, router],
  );

  const agendar = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      prazo.current = { restante: ms, desde: Date.now() };
      timer.current = setTimeout(() => void enviar(false), ms);
    },
    [enviar],
  );

  useEffect(() => {
    const aoSair = () => void enviar(true);
    window.addEventListener('pagehide', aoSair);
    return () => {
      window.removeEventListener('pagehide', aoSair);
      void enviar(true); // saiu da tela pelo app (outra seção) dentro do prazo: envia
    };
  }, [enviar]);

  const tocar = (e: MouseEvent<HTMLButtonElement>) => {
    // teclado/leitor de tela (detail 0) ou o botão já com o foco: o foco segue para o "Desfazer"; toque sem foco não rouba o foco
    const peloFoco = e.detail === 0 || document.activeElement === e.currentTarget;
    pendente.current = true;
    setErro(null);
    if (PRAZO_DESFAZER_MS === 0) return void enviar(false);
    focoPara.current = peloFoco ? 'desfazer' : null;
    setFase('aguardando');
    agendar(PRAZO_DESFAZER_MS);
  };
  const desfazer = () => {
    pendente.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    focoPara.current = 'botao';
    setFase('desfeito');
  };
  const pausar = () => {
    if (!pendente.current || !timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    prazo.current.restante = sobra(prazo.current.restante, Date.now() - prazo.current.desde);
  };
  const retomar = () => {
    if (pendente.current && !timer.current) agendar(prazo.current.restante);
  };

  return (
    <div className="space-y-1">
      {mostraBotao(fase) && (
        <button
          ref={botao}
          type="button"
          onClick={tocar}
          disabled={!online}
          aria-describedby={online ? undefined : `sem-rede-${refeicaoId}`}
          className="min-h-11 rounded-full border-2 border-marca bg-cartao px-4 font-semibold text-texto disabled:opacity-60"
        >
          {ROTULO_RESPOSTA.como_no_plano}
        </button>
      )}
      {!online && mostraBotao(fase) && (
        <p id={`sem-rede-${refeicaoId}`} className="text-sm text-suave">{MSG_COMI_ASSIM.semConexao}</p>
      )}
      <div onFocus={pausar} onBlur={retomar} onPointerEnter={pausar} onPointerLeave={retomar} className="flex flex-wrap items-center gap-2">
        <p role="status" className="text-sm">
          {mensagemDaFase(fase)}
          {fase === 'aguardando' && <span className="sr-only">{` ${MSG_COMI_ASSIM.podeDesfazer}`}</span>}
        </p>
        {fase === 'aguardando' && (
          <button ref={botaoDesfazer} type="button" onClick={desfazer} className="min-h-11 px-2 font-semibold text-link underline">
            {MSG_COMI_ASSIM.desfazer}
          </button>
        )}
      </div>
      {fase === 'erro' && erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 4: A refeição (componente comum), a sanfona e a rota da refeição**

Criar `src/app/p/(portal)/plano/refeicao-detalhe.tsx`:

```tsx
import Link from 'next/link';
import { ComiAssim } from '@/components/portal/comi-assim';
import { LinkDeResposta } from '@/components/portal/link-de-resposta';
import { ROTULO_RESPOSTA } from '@/modules/portal/diario-constantes';
import type { RefeicaoDoPaciente } from '@/modules/portal/plano';

const minuscula = (s: string) => s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1);
const BOTAO = 'inline-flex min-h-11 items-center rounded-full border-2 border-marca bg-cartao px-4 font-semibold text-texto';

/**
 * Plano 16 (US-193, RN-213, molde GV-Almoço): o que planoDoPaciente já devolve — itens com a quantidade à direita, as trocas
 * ("ou {nome}, {quantidade}"), a observação dela (a voz dela, RN-194), a receita sugerida (?de=plano) e as três respostas.
 * Usado na refeição aberta e dentro da sanfona do Plano (a cópia offline tem tudo, §4.8).
 */
export function RefeicaoDetalhe({ refeicao, respondida }: { refeicao: RefeicaoDoPaciente; respondida: boolean }) {
  return (
    <div className="space-y-3">
      {refeicao.kcal && <p className="text-sm text-suave">{`Cerca de ${refeicao.kcal}`}</p>}
      <ul className="divide-y divide-borda">
        {refeicao.itens.map((i) => (
          <li key={i.id} className="py-2">
            <p className="flex justify-between gap-3">
              <span>{i.nome}</span>
              <span className="text-right font-semibold">{`${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}</span>
            </p>
            {i.substituicoes.length > 0 && <p className="text-sm text-suave">{i.substituicoes.map((s) => `ou ${minuscula(s.nome)}, ${s.quantidade}`).join(' · ')}</p>}
          </li>
        ))}
      </ul>
      {refeicao.observacao && (
        <div className="rounded-2xl bg-p-clara p-3">
          <p className="text-sm font-semibold">Observação da sua nutricionista</p>
          <p className="whitespace-pre-line">{refeicao.observacao}</p>
        </div>
      )}
      {refeicao.receita && (
        <p className="text-sm">
          <span className="font-semibold">Sugestão de receita: </span>
          {/* ?de=plano: a receita fora da audiência só abre por aqui (RN-12, exceção — D2 do Plano 07) */}
          <Link href={`/p/conteudos/${refeicao.receita.id}?de=plano`} className="text-link underline">{refeicao.receita.titulo}</Link>
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <LinkDeResposta href={`/p/diario?refeicao=${refeicao.id}&foto=1#registrar`} className={BOTAO}>Mandar foto do prato</LinkDeResposta>
        {respondida ? <p className="inline-flex min-h-11 items-center text-sm">No diário</p> : <ComiAssim refeicaoId={refeicao.id} />}
        <LinkDeResposta href={`/p/diario?refeicao=${refeicao.id}&resposta=outra_coisa#registrar`} className={BOTAO}>{ROTULO_RESPOSTA.outra_coisa}</LinkDeResposta>
      </div>
    </div>
  );
}
```

Criar `src/components/portal/link-de-resposta.tsx` (correção da revisão do plano: sem rede, "Mandar foto do prato" e "Comi outra coisa" também gravam — como links ativos, o toque abriria a cópia do plano de novo, no topo, sem explicação; RN-208):

```tsx
'use client';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { MSG_COMI_ASSIM } from './comi-assim-estado';
import { useOnline } from './online';

/** As respostas que levam ao formulário do diário: sem rede, desabilitadas (aria-disabled, sem href) com o mesmo aviso do "Comi assim". */
export function LinkDeResposta({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const online = useOnline();
  const aviso = useId();
  if (online) return <Link href={href} className={className}>{children}</Link>;
  return (
    <span className="space-y-1">
      <a role="link" aria-disabled="true" aria-describedby={aviso} className={`${className} opacity-60`}>{children}</a>
      <span id={aviso} className="block text-sm text-suave">{MSG_COMI_ASSIM.semConexao}</span>
    </span>
  );
}
```

Criar `src/app/p/(portal)/plano/abrir-refeicao-da-url.tsx`:

```tsx
'use client';
import { useEffect } from 'react';

/**
 * Plano 16 (§4.8, US-193 "Offline"): sem rede, toda navegação em /p/ cai na cópia de /p/plano (o service worker não muda).
 * Aberta pelo endereço de uma refeição (/p/plano/refeicao/<id>), a cópia abre essa refeição na sanfona e rola até ela.
 */
export function AbrirRefeicaoDaUrl() {
  useEffect(() => {
    const id = /^\/p\/plano\/refeicao\/([0-9a-f-]{36})$/.exec(location.pathname)?.[1];
    const alvo = id ? document.getElementById(`ref-${id}`) : null;
    if (alvo instanceof HTMLDetailsElement) {
      alvo.open = true;
      alvo.scrollIntoView({ block: 'start' });
    }
  }, []);
  return null;
}
```

Trocar o `<main>` de `src/app/p/(portal)/plano/page.tsx` (a `Faixa` da T4 fica; imports novos: `RefeicaoDetalhe`, `AbrirRefeicaoDaUrl`, `rotuloDaRefeicao` de `@/modules/portal/diario-constantes`, `daquiA` de `@/modules/portal/datas-portal`, `partesNoFuso` de `@/modules/agenda/fuso`). **Sem `respostasDeHoje` aqui** (correção da revisão do plano): `/p/plano` é a cópia offline guardada no aparelho, e a spec manda "offline só o plano (sem diário…)" (§4.8, §10, §11.7) — a marca "No diário" fica no mural e na refeição aberta (que não são guardadas); na sanfona o "Comi assim" aparece sempre e, se a refeição já tiver resposta hoje, o toque devolve o registro existente (D3, idempotente) e mostra "Registrado no diário.":

```tsx
  const agora = new Date();
  const minutosAgora = partesNoFuso(agora, tenant.fuso).minutos;
  const minutosAte = (horario: string) => {
    const [h, m] = horario.split(':').map(Number);
    const ate = h * 60 + m - minutosAgora;
    return ate >= 0 ? ate : ate + 24 * 60; // a "próxima" depois da última do dia é a primeira de amanhã
  };
  return (
    <>
      <Faixa {...moldura} atual="/p/plano" titulo={MSG_G.titulos.plano} />
      <main className="space-y-6 p-4">
        {/* D6: plano novo = id novo (e US-054: sugestões de receita mudaram = versão nova) */}
        <GuardarPlano dono={vinculo.patientId} versao={versaoDaCopiaOffline(plano)} />
        <AbrirRefeicaoDaUrl />
        {!plano ? (
          <p role="status">{MSG_PLANO_PACIENTE.semPlano}</p>
        ) : (
          <>
            <h2 className="font-portal-titulo text-xl font-bold">{plano.titulo}</h2>
            {plano.totalKcal && <p>{`Total do dia: ${plano.totalKcal}`}</p>}
            {pdf === 'preparando' && <p role="status">{MSG_PLANO_PACIENTE.pdfPreparando}</p>}
            <p className="flex flex-wrap gap-2">
              {plano.pdf !== 'indisponivel' && (
                <a href="/api/p/plano/pdf" className="inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4">Baixar PDF</a>
              )}
              {/* D3 (Plano 07): a lista de compras é derivada do plano publicado; G-D8 ★ = a: os conteúdos também moram aqui */}
              <Link href="/p/compras" className="inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4">Lista de compras</Link>
              <Link href="/p/conteudos" className="inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4">Conteúdos</Link>
            </p>
            <ol className="space-y-3">
              {plano.refeicoes.map((r) => {
                const proxima = r.id === plano.proximaRefeicaoId;
                return (
                  <li key={r.id}>
                    <details id={`ref-${r.id}`} open={proxima} className={proxima ? 'rounded-2xl border-2 border-p-marco bg-cartao ring-2 ring-p-marco-texto' : 'rounded-2xl border border-borda bg-cartao'}>
                      {/* sem flex/grid no summary: ele perde o display: list-item e o marcador ▶/▼ que diz que a refeição abre (molde ajuda-seguranca.tsx); h3 direto no summary (o modelo de conteúdo admite um título) */}
                      <summary className="min-h-11 cursor-pointer p-3">
                        <h3 className="inline font-portal-titulo text-lg font-bold">{rotuloDaRefeicao(r.nome, r.horario)}</h3>
                        {proxima && r.horario && <span className="ml-3 inline-block rounded-full bg-p-marco px-2 text-sm font-semibold text-p-marco-texto">{`Próxima, ${daquiA(minutosAte(r.horario))}`}</span>}
                      </summary>
                      <div className="px-3 pb-3">
                        <RefeicaoDetalhe refeicao={r} respondida={false} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            {plano.orientacoes && (
              <section aria-labelledby="orientacoes-plano" className="rounded-2xl bg-p-clara p-3">
                <h2 id="orientacoes-plano" className="font-semibold">Orientações do plano</h2>
                <p className="whitespace-pre-line">{plano.orientacoes}</p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
```

Criar `src/app/p/(portal)/plano/refeicao/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { requirePaciente } from '@/lib/paciente-session';
import { idValido } from '@/modules/pacientes/base';
import { respostasDeHoje } from '@/modules/portal/diario';
import { rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { resumoDaRefeicao } from '@/modules/portal/mural-regras';
import { planoDoPaciente } from '@/modules/portal/plano';
import { RefeicaoDetalhe } from '../../refeicao-detalhe';

export const dynamic = 'force-dynamic';

/** Plano 16 (US-193, RN-213): a refeição aberta. Fora do plano publicado do paciente (ou id inválido) → 404. */
export default async function Refeicao({ params }: PageProps<'/p/plano/refeicao/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requirePaciente(`/p/plano/refeicao/${id}`);
  if (!idValido(id)) notFound();
  const plano = await planoDoPaciente(ctx, tenant.fuso);
  const refeicao = plano?.refeicoes.find((r) => r.id === id);
  if (!refeicao) notFound();
  const rotulo = rotuloDaRefeicao(refeicao.nome, refeicao.horario);
  const respondida = (await respostasDeHoje(ctx, tenant.fuso)).has(rotulo);
  const resumo = resumoDaRefeicao(refeicao.itens);
  return (
    <>
      <CabecalhoDetalhe titulo={refeicao.nome} voltar={{ href: '/p/plano', secao: 'Plano' }} />
      <main className="space-y-4 p-4">
        <p>
          <span className="inline-flex rounded-full bg-p-marco px-3 py-1 text-sm font-semibold text-p-marco-texto">{rotulo}</span>
        </p>
        {resumo && <h2 className="font-portal-titulo text-xl font-bold">{resumo.charAt(0).toLocaleUpperCase('pt-BR') + resumo.slice(1)}</h2>}
        <RefeicaoDetalhe refeicao={refeicao} respondida={respondida} />
      </main>
    </>
  );
}
```

Na tabela `tambem` da T3, `/p/plano/refeicao/<id>` já marca Plano (é subpágina de `/p/plano`).

- [ ] **Step 5: O diário com a refeição do plano**

Em `src/app/p/(portal)/diario/page.tsx`, a página recebe `searchParams` e lê a refeição pedida pelo link ("Comi outra coisa", "Mandar foto do prato", "Foto da refeição"):

```tsx
export default async function Diario({ searchParams }: PageProps<'/p/diario'>) {
  const { ctx, tenant } = await requirePaciente('/p/diario');
  const q = await searchParams;
  const pedida = typeof q.refeicao === 'string' && idValido(q.refeicao) ? q.refeicao : null;
  // só uma refeição do plano publicado dele (planoDoPaciente, auditado); um id qualquer cai no formulário comum
  const doPlano = pedida ? ((await planoDoPaciente(ctx, tenant.fuso))?.refeicoes.find((r) => r.id === pedida) ?? null) : null;
  const registros = await diarioDoPaciente(ctx);
  // … o resto como antes, com:
  //   <DiarioForm refeicaoDoPlano={doPlano ? { id: doPlano.id, rotulo: rotuloDaRefeicao(doPlano.nome, doPlano.horario) } : null}
  //               resposta={q.resposta === 'outra_coisa' ? 'outra_coisa' : null} foto={q.foto === '1'} />
  //   no cabeçalho de cada registro: `${r.refeicaoDoPlano ?? r.refeicao} · ${quandoComFuso(r.dataHora, tenant.fuso)}`
  //   e, logo abaixo: {r.resposta && <p className="text-sm font-medium">{ROTULO_RESPOSTA[r.resposta]}</p>}
```

Em `src/app/p/(portal)/diario/diario-form.tsx`, a assinatura e o começo do formulário:

```tsx
type Props = { refeicaoDoPlano?: { id: string; rotulo: string } | null; resposta?: 'outra_coisa' | null; foto?: boolean };

/** US-042 + Plano 16 (US-192): com a refeição do plano, a refeição já vem escolhida e "Como foi?" grava a resposta. */
export function DiarioForm({ refeicaoDoPlano = null, resposta = null, foto = false }: Props = {}) {
```

e, no lugar do `<div>` do `<select id="refeicao">`:

```tsx
      {refeicaoDoPlano ? (
        <>
          <input type="hidden" name="refeicaoId" value={refeicaoDoPlano.id} />
          <p className="font-medium">{`Refeição: ${refeicaoDoPlano.rotulo}`}</p>
          <fieldset className="space-y-1">
            <legend className="font-medium">Como foi?</legend>
            {(['como_no_plano', 'outra_coisa'] as const).map((r) => (
              <p key={r} className="flex min-h-11 items-center gap-2">
                <input id={`resposta-${r}`} type="radio" name="resposta" value={r} defaultChecked={resposta === r} className="size-5" />
                <label htmlFor={`resposta-${r}`}>{ROTULO_RESPOSTA[r]}</label>
              </p>
            ))}
          </fieldset>
        </>
      ) : (
        /* …o <div> do <select id="refeicao"> de antes, sem mudança */
      )}
```

No `<input id="foto">`, acrescentar `capture={foto ? 'environment' : undefined}`. Na validação do cliente (antes do `fetch`), "Comi outra coisa" sem texto nem foto mostra `MSG_DIARIO.vazio` (o servidor também recusa):

```tsx
    if (dados.get('resposta') === 'outra_coisa' && !String(dados.get('texto') ?? '').trim() && !(foto instanceof File && foto.size > 0)) {
      setOk(null);
      return setErros({ geral: MSG_DIARIO.vazio });
    }
```

(Importar `ROTULO_RESPOSTA` de `@/modules/portal/diario-constantes`.)

- [ ] **Step 6: O E2E que lia o item numa linha só**

Em `e2e/portal.spec.ts`, no teste "Meu plano: sem plano → … (US-041)" (~linha 67), o item passou a ter o nome e a quantidade em colunas: trocar `getByText('Chuchu, cozido — 100 g')` por `getByText('Chuchu, cozido', { exact: true })` e `getByText('100 g', { exact: true })` (os dois `toBeVisible()`, com a sanfona da refeição aberta: `await p.page.getByRole('heading', { name: /Almoço · 12:00/ }).click()` antes, se ela não for a próxima).

- [ ] **Step 7: Rodar e commitar**

```bash
pnpm test:e2e -- e2e/portal.spec.ts
pnpm vitest run src/components/portal "src/app/p/(portal)/plano" "src/app/p/(portal)/diario" src/modules/portal/plano.test.ts src/app/formularios-post.test.ts src/app/painel/cores.test.ts src/app/sw-regras.test.ts
pnpm typecheck && pnpm lint
git add src/components/portal src/modules/portal/plano.ts src/modules/portal/plano.test.ts "src/app/p/(portal)/plano" "src/app/p/(portal)/diario" e2e/portal.spec.ts
git commit -m "$(cat <<'MSG'
feat(portal): plano em sanfona, refeição aberta e Comi assim com Desfazer (P16-11)

As refeições do plano em sanfona, com a próxima aberta e destacada e tudo
dentro da página (a cópia offline continua só /p/plano); a refeição aberta
em /p/plano/refeicao/<id> (404 fora do plano); Comi assim com Desfazer de
10 s que pausa com foco e envia ao sair; o diário com a refeição já
escolhida e Como foi?; sem rede, os botões que gravam ficam desabilitados.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 12: Jornada e "Todas as medidas" — as telas (P16-12)

**Revisão: leve (revisor-interface)** — linha do tempo (molde GV-Jornada), marco âmbar com contorno (RN-207), gráfico com a alternativa em tabela, a tabela "Todas as medidas" (molde F-Medidas) com cabeçalhos de linha e de coluna e rolagem só dentro da própria região focável a 320 px.

**Files:**
- Create: `src/app/p/(portal)/jornada/linha-do-tempo.tsx`, `src/app/p/(portal)/jornada/page.test.ts`, `src/app/p/(portal)/evolucao/tabela-medidas.tsx`
- Modify: `src/app/p/(portal)/jornada/page.tsx` (o esqueleto da T4), `src/app/p/(portal)/evolucao/page.tsx` (+ `page.test.ts`), `src/modules/portal/evolucao.ts` (+ `evolucao.test.ts`: as orientações saem — moram na Jornada), `e2e/portal.spec.ts` (o teste "Minha evolução…" de US-044 passa a conferir a tabela — Step 4)

**Interfaces:**
- Consumes: T9 (`jornadaDoPaciente`, `Jornada`, `Marco`, `MSG_JORNADA`), T8 (`evolucaoParaPaciente` sem peso quando oculto), T4 (`Faixa`, `CabecalhoDetalhe`, `molduraDaSecao`), T5 (`mesPorExtenso`); `GraficoLinha` (`src/modules/pacientes/ui/grafico-linha.tsx`), `QuandoLocal`, `formatarData`, `formatarDecimal`, `hojeNoFuso`.
- Produces: as telas `/p/jornada` e `/p/evolucao` ("Todas as medidas"); `evolucaoParaPaciente` devolve `{ avaliacoes, series, diferencas }` (sem `orientacoes`).

- [ ] **Step 1: Testes (falham)**

Criar `src/app/p/(portal)/jornada/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Jornada } from '@/modules/portal/jornada-regras';

const estado = vi.hoisted(() => ({ jornada: null as unknown as Jornada }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', mostrarPercGorduraPaciente: false } }) }));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/jornada', () => ({ jornadaDoPaciente: async () => estado.jornada }));
const { default: Jornada } = await import('./page');

describe('/p/jornada (US-194)', () => {
  it('título na faixa, gráfico com a alternativa em tabela, linha do tempo da próxima consulta à primeira, orientação com a voz dela', async () => {
    estado.jornada = {
      titulo: 'Sua jornada desde março',
      podeAgendar: true,
      vazia: false,
      grafico: { id: 'peso', rotulo: 'Peso nas consultas', unidade: 'kg', casas: 1, pontos: [{ data: '2026-03-18', valor: 82.8 }, { data: '2026-09-22', valor: 78.6 }] },
      marcos: [
        { tipo: 'proxima', consultaId: 'c9', quando: { semFuso: 'amanhã, 14:00', comFuso: 'amanhã, 14:00 (horário de Brasília)' }, modalidade: 'Online.' },
        { tipo: 'atendimento', data: '2026-09-22', titulo: '22 de setembro', primeira: false, medidas: [{ id: 'peso', texto: '78,6 kg' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }], orientacao: 'Manter as frutas.' },
        { tipo: 'atendimento', data: '2026-03-18', titulo: '18 de março', primeira: true, medidas: [], orientacao: null },
      ],
    };
    const html = renderToStaticMarkup(await Jornada());
    expect(html).toMatch(/<h1[^>]*>Sua jornada desde março<\/h1>/);
    expect(html).toContain('Peso nas consultas');
    expect(html).toContain('Ver os dados em tabela');
    expect(html).toContain('amanhã, 14:00 (horário de Brasília)'); // sem JavaScript, com a sigla (QuandoLocal)
    expect(html).toContain('próxima consulta');
    expect(html).toContain('href="/p/agenda/c9"');
    expect(html).toContain('78,6 kg · cintura 86 cm');
    expect(html).toContain('Orientação da sua nutricionista');
    expect(html).toContain('18 de março · primeira consulta');
    expect(html.indexOf('22 de setembro')).toBeLessThan(html.indexOf('18 de março'));
    for (const href of ['/p/evolucao', '/p/agenda', '/p/agenda/nova']) expect(html).toContain(`href="${href}"`);
    expect(html).not.toMatch(/Leve suas dúvidas/); // texto do sistema com voz de orientação: não entra (§4.5)
  });

  it('ainda sem consulta: "Sua jornada começa na primeira consulta." e, sem poder agendar, sem o botão', async () => {
    estado.jornada = { titulo: 'Sua jornada', podeAgendar: false, vazia: true, grafico: null, marcos: [] };
    const html = renderToStaticMarkup(await Jornada());
    expect(html).toContain('Sua jornada começa na primeira consulta.');
    expect(html).not.toContain('href="/p/agenda/nova"');
  });
});
```

Trocar os testes de `src/app/p/(portal)/evolucao/page.test.ts` (o `evolucaoParaPaciente` mockado deixa de ter `orientacoes`):

```ts
describe('/p/evolucao — "Todas as medidas" (US-194, F-Medidas)', () => {
  it('2 avaliações sem nenhuma medida repetida → "poucos dados", sem tabela', async () => {
    estado.evolucao = {
      avaliacoes: 2,
      series: [
        { id: 'peso', rotulo: 'Peso', unidade: 'kg', casas: 1, pontos: [{ data: '2026-09-01', valor: 70 }] },
        { id: 'circ_cintura', rotulo: 'Cintura', unidade: 'cm', casas: 1, pontos: [{ data: '2026-09-20', valor: 80 }] },
      ],
      diferencas: [],
    };
    const html = await pagina();
    expect(html).toContain(MSG_POUCOS_DADOS);
    expect(html).not.toContain('<table');
  });

  it('tabela: uma coluna por avaliação, uma linha por medida, "Desde {mês}" com a diferença; th com scope; região que rola sozinha', async () => {
    const primeiro = { data: '2026-03-18', valor: 82.8 };
    const ultimo = { data: '2026-09-22', valor: 78.6 };
    estado.evolucao = {
      avaliacoes: 2,
      series: [
        { id: 'peso', rotulo: 'Peso', unidade: 'kg', casas: 1, pontos: [primeiro, ultimo] },
        { id: 'circ_cintura', rotulo: 'Cintura', unidade: 'cm', casas: 1, pontos: [{ data: '2026-09-22', valor: 86 }] },
      ],
      diferencas: [{ rotulo: 'Peso', casas: 1, unidade: 'kg', primeiro, ultimo, texto: '−4,2 kg' }],
    };
    const html = await pagina();
    expect(html).toMatch(/<div role="region" aria-labelledby="tabela-medidas" tabindex="0" class="[^"]*\boverflow-x-auto\b/);
    expect(html).toContain('<th scope="col">18/03/2026</th><th scope="col">22/09/2026</th><th scope="col">Desde março</th>');
    expect(html).toContain('<th scope="row">Peso (kg)</th><td>82,8</td><td>78,6</td><td>−4,2 kg</td>');
    expect(html).toContain('<th scope="row">Cintura (cm)</th><td>—</td><td>86,0</td><td>—</td>');
    expect(html).toContain('aria-label="Voltar para Jornada"');
  });
});
```

(O mock de `requirePaciente` do arquivo passa a devolver `tenant: { mostrarPercGorduraPaciente: false, fuso: 'America/Sao_Paulo' }`; o `pagina` continua `renderToStaticMarkup(await MinhaEvolucao())`. A data de hoje do teste é a do relógio: "Desde março" vale até o fim de 2026 — use `vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))` com `vi.useFakeTimers({ toFake: ['Date'] })` no topo do arquivo para fixar.)

Em `src/modules/portal/evolucao.test.ts`, nos dois testes que conferem `e.orientacoes`, trocar a conferência por `expect(e).not.toHaveProperty('orientacoes')` (as orientações moram na Jornada, T9; o caso das notas privadas continua coberto pelo `jornada.test.ts`).

Run: `pnpm vitest run "src/app/p/(portal)/jornada" "src/app/p/(portal)/evolucao" src/modules/portal/evolucao.test.ts` → FAIL.

- [ ] **Step 2: O módulo da evolução sem as orientações**

Em `src/modules/portal/evolucao.ts`, tirar o import e a chamada de `orientacoesDoPaciente` e devolver `{ avaliacoes: avaliacoes.length, series, diferencas: difs }` (a leitura auditada das orientações acontece na Jornada; aqui ela seria uma leitura sem tela). O comentário da função passa a dizer "US-044 / Plano 16: as medidas de 'Todas as medidas'".

- [ ] **Step 3: A linha do tempo e a Jornada**

Criar `src/app/p/(portal)/jornada/linha-do-tempo.tsx`:

```tsx
import Link from 'next/link';
import { MSG_JORNADA, type Marco } from '@/modules/portal/jornada-regras';
import { QuandoLocal } from '../../quando-local';

/**
 * Plano 16 (§4.5, molde GV-Jornada): da próxima consulta para a primeira. O marco da próxima é âmbar com contorno de 2 px
 * (RN-207; 1,55:1 sozinho contra o fundo claro) e nunca é a única pista — o texto diz "próxima consulta". A orientação é a
 * dela, verbatim (RN-194). Sem texto do sistema com voz de orientação ("Leve suas dúvidas anotadas." não entra).
 */
export function LinhaDoTempo({ marcos, fuso }: { marcos: Marco[]; fuso: string }) {
  return (
    <ol aria-label="Linha do tempo" className="space-y-5 border-l-2 border-borda pl-5">
      {marcos.map((m) => (
        <li key={m.tipo === 'proxima' ? `proxima-${m.consultaId}` : `${m.tipo}-${m.data}-${m.titulo}`} className="relative space-y-2">
          <span
            aria-hidden="true"
            className={m.tipo === 'proxima' ? 'absolute -left-[1.85rem] top-1 size-4 rounded-full border-2 border-p-marco-texto bg-p-marco' : 'absolute -left-[1.7rem] top-1.5 size-3 rounded-full bg-marca'}
          />
          {m.tipo === 'proxima' ? (
            <>
              <h2 className="font-portal-titulo text-lg font-bold">
                <QuandoLocal semFuso={m.quando.semFuso} comFuso={m.quando.comFuso} fuso={fuso} />
                {` · ${MSG_JORNADA.proxima}`}
              </h2>
              <p>{m.modalidade}</p>
              <Link href={`/p/agenda/${m.consultaId}`} className="inline-flex min-h-11 items-center font-semibold text-link underline">{MSG_JORNADA.verConsulta}</Link>
            </>
          ) : (
            <>
              <h2 className="font-portal-titulo text-lg font-bold">{m.tipo === 'atendimento' && m.primeira ? `${m.titulo} · ${MSG_JORNADA.primeira}` : m.titulo}</h2>
              {m.medidas.length > 0 && <p>{m.medidas.map((x) => x.texto).join(' · ')}</p>}
              {m.tipo === 'atendimento' && m.orientacao && (
                <div className="rounded-2xl bg-p-clara p-3">
                  <p className="text-sm font-semibold">{MSG_JORNADA.orientacao}</p>
                  <p className="whitespace-pre-line">{m.orientacao}</p>
                </div>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
```

Trocar `src/app/p/(portal)/jornada/page.tsx`:

```tsx
import Link from 'next/link';
import { Faixa } from '@/components/portal/faixa';
import { requirePaciente } from '@/lib/paciente-session';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { jornadaDoPaciente } from '@/modules/portal/jornada';
import { MSG_JORNADA } from '@/modules/portal/jornada-regras';
import { molduraDaSecao } from '../../moldura';
import { LinhaDoTempo } from './linha-do-tempo';

export const dynamic = 'force-dynamic';

const BOTAO = 'inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4 font-semibold';

/**
 * Plano 16 (US-194, RN-190): a seção Jornada — o gráfico de peso nas consultas (ou de cintura, com o peso oculto ou com
 * menos de 2 pesos; nenhuma mensagem sobre o peso faltar) e a linha do tempo. "Todas as medidas" e "Minhas consultas" ficam
 * a um toque (§4.10).
 */
export default async function Jornada() {
  const acesso = await requirePaciente('/p/jornada');
  const { ctx, tenant } = acesso;
  const [moldura, j] = await Promise.all([molduraDaSecao(acesso), jornadaDoPaciente(ctx, tenant, new Date())]);
  return (
    <>
      <Faixa {...moldura} atual="/p/jornada" titulo={j.titulo} />
      <main className="space-y-6 p-4">
        {j.grafico && <GraficoLinha id="grafico-jornada" titulo={j.grafico.rotulo} unidade={j.grafico.unidade} casas={j.grafico.casas} pontos={j.grafico.pontos} />}
        <p className="flex flex-wrap gap-2">
          <Link href="/p/evolucao" className={BOTAO}>{MSG_JORNADA.todasAsMedidas}</Link>
          <Link href="/p/agenda" className={BOTAO}>{MSG_JORNADA.minhasConsultas}</Link>
          {j.podeAgendar && <Link href="/p/agenda/nova" className={BOTAO}>{MSG_JORNADA.agendar}</Link>}
        </p>
        {j.vazia ? <p>{MSG_JORNADA.comeca}</p> : <LinhaDoTempo marcos={j.marcos} fuso={tenant.fuso} />}
      </main>
    </>
  );
}
```

(O tracejado até o marco da próxima consulta, do desenho, fica fora: o `GraficoLinha` é o atual, como a spec manda — Desvio 11.)

- [ ] **Step 4: "Todas as medidas"**

Criar `src/app/p/(portal)/evolucao/tabela-medidas.tsx`:

```tsx
import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '@/modules/pacientes/datas';
import type { Diferenca, SerieEvolucao } from '@/modules/pacientes/evolucao';

/**
 * Plano 16 (US-194 "Todas as medidas", molde F-Medidas): uma coluna por avaliação, uma linha por medida e a coluna
 * "Desde {mês}" com a diferença (número com sinal, RN-206). Tabela de dados: rola dentro da própria região, focável pelo
 * teclado (WCAG 1.4.10 admite rolagem em tabela; a página nunca rola na horizontal); th com scope.
 */
export function TabelaMedidas({ series, diferencas, desde }: { series: SerieEvolucao[]; diferencas: Diferenca[]; desde: string }) {
  const datas = [...new Set(series.flatMap((s) => s.pontos.map((p) => p.data)))].sort();
  return (
    <div role="region" aria-labelledby="tabela-medidas" tabIndex={0} className="overflow-x-auto p-2 focus-visible:outline-offset-[-3px]">
      <table className="min-w-full text-left text-sm">
        <caption id="tabela-medidas" className="pb-2 text-left font-semibold">Medidas por avaliação</caption>
        <thead>
          <tr>
            <th scope="col">Medida</th>
            {datas.map((d) => <th scope="col" key={d}>{formatarData(d)}</th>)}
            <th scope="col">{`Desde ${desde}`}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const dif = diferencas.find((d) => d.rotulo === s.rotulo);
            return (
              <tr key={s.id} className="border-t border-linha">
                <th scope="row">{s.unidade ? `${s.rotulo} (${s.unidade})` : s.rotulo}</th>
                {datas.map((d) => {
                  const p = s.pontos.find((x) => x.data === d);
                  return <td key={d}>{p ? formatarDecimal(p.valor, s.casas) : '—'}</td>;
                })}
                <td>{dif?.texto ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

Trocar o `<main>` de `src/app/p/(portal)/evolucao/page.tsx` (o `CabecalhoDetalhe` "Todas as medidas" da T4 fica; a seção "Orientações recebidas" sai — mora na Jornada):

```tsx
export default async function TodasAsMedidas() {
  const { ctx, tenant } = await requirePaciente('/p/evolucao');
  const e = await evolucaoParaPaciente(ctx, tenant);
  const primeira = e.series.flatMap((s) => s.pontos.map((p) => p.data)).sort()[0];
  return (
    <>
      <CabecalhoDetalhe titulo="Todas as medidas" voltar={{ href: '/p/jornada', secao: 'Jornada' }} />
      <main className="space-y-8 p-4">
        {/* menos de 2 avaliações, ou 2+ sem nenhuma medida repetida: nada a comparar */}
        {e.diferencas.length === 0 ? (
          <p>{MSG_POUCOS_DADOS}</p>
        ) : (
          <>
            <TabelaMedidas series={e.series} diferencas={e.diferencas} desde={mesPorExtenso(primeira, hojeNoFuso(tenant.fuso))} />
            {e.series.filter((s) => s.pontos.length >= 2).map((s) => (
              <GraficoLinha key={s.id} id={`serie-${s.id}`} titulo={s.rotulo} unidade={s.unidade} casas={s.casas} pontos={s.pontos} />
            ))}
          </>
        )}
      </main>
    </>
  );
}
```

(Imports: `TabelaMedidas` de `./tabela-medidas`, `mesPorExtenso` de `@/modules/portal/datas-portal`, `hojeNoFuso` de `@/modules/pacientes/datas`; saem `formatarDecimal` e `formatarData` se não sobrar uso. O teste da página chama o default export: manter o nome que o `page.test.ts` importa ou trocar nos dois.)

Reescrever em `e2e/portal.spec.ts` o teste "Minha evolução: peso sem % de gordura…" (~305–322; a lista "Peso: 80,0 (…) → …" e "Orientações recebidas" saem da página, Desvio 12). Novo título: `'Todas as medidas: peso sem % de gordura; com a opção ligada, o % aparece (US-044, US-194)'`; o meio passa a ser:

```ts
  await p.page.goto('/p/evolucao');
  await expect(p.page.getByRole('heading', { level: 1, name: 'Todas as medidas' })).toBeVisible();
  const tabela = p.page.getByRole('table', { name: 'Medidas por avaliação' });
  await expect(tabela.getByRole('row', { name: /^Peso \(kg\)/ })).toContainText('80,0');
  await expect(tabela.getByRole('row', { name: /^% de gordura/ })).toHaveCount(0);
  try {
    await mostrarPercGordura(nutri, true);
    await p.page.reload();
    await expect(tabela.getByRole('row', { name: /^% de gordura/ })).toBeVisible();
  } finally {
    await mostrarPercGordura(nutri, false);
  }
```

(a conferência de "Nenhuma orientação registrada ainda." sai: as orientações moram na Jornada, coberta pelo `app-paciente.spec.ts` da T16).

- [ ] **Step 5: Rodar e commitar**

```bash
pnpm vitest run "src/app/p/(portal)/jornada" "src/app/p/(portal)/evolucao" src/modules/portal/evolucao.test.ts src/app/painel/cores.test.ts src/app/p/navegacao.test.ts
pnpm typecheck && pnpm lint
pnpm test:e2e e2e/portal.spec.ts
git add "src/app/p/(portal)/jornada" "src/app/p/(portal)/evolucao" src/modules/portal/evolucao.ts src/modules/portal/evolucao.test.ts e2e/portal.spec.ts
git commit -m "$(cat <<'MSG'
feat(portal): telas da Jornada e de Todas as medidas (P16-12)

Jornada com o gráfico de peso nas consultas (ou de cintura) e a linha do
tempo da próxima consulta à primeira, com a orientação dela em cada
atendimento; Todas as medidas numa tabela por avaliação, com a diferença
desde o primeiro mês e os gráficos de antes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 13: Eu e Exames — a lista por assunto, a transparência de Privacidade e o visual das telas de conta (P16-13)

**Revisão: leve (revisor-interface)**; o texto da RN-214 em Privacidade passa também por **uma rodada do normas-cfn-lgpd** (transparência sem estigma: nenhuma tela diz ao paciente, individualmente, que o peso está oculto).

**Files:**
- Create: `src/app/p/(portal)/perfil/instalar-no-eu.tsx`, `src/app/p/(portal)/perfil/page.test.ts`
- Modify: `src/app/p/(portal)/perfil/page.tsx`, `src/app/p/(portal)/perfil/privacidade.tsx` (o texto da RN-214), `src/app/p/(portal)/exames/page.tsx` (visual), `src/app/p/termo/page.tsx`, `src/app/p/escolher/page.tsx`, `src/app/p/sem-acesso/page.tsx` (visual)

**Interfaces:**
- Consumes: T4 (`Faixa`, `molduraDaSecao`, `MSG_G`, o `SairPortal` no fim de Eu), T10 (a prop `cartao` de `Instalar`); `situacaoDoWhatsapp`, `AtivarNotificacoes`, `WhatsappForm`, `Privacidade`, `getEnv`.
- Produces: a seção Eu na ordem da spec (US-197): Conta ("Conectado como"), Consultório (logo, nome e "Trocar de nutricionista" com 2+ vínculos), Meus documentos (só com documentos liberados), Notificações, Instalar o app, Privacidade, (Como usar o app — T14), Sair; o lugar da seção "Como usar o app" (T14) é logo antes do Sair.

- [ ] **Step 1: Teste (falha)**

Criar `src/app/p/(portal)/perfil/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ vinculos: 2, documentos: true }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({
    ctx: {},
    data: { user: { email: 'marina@ex.com' } },
    vinculo: { patientId: 'p1' },
    vinculos: Array.from({ length: estado.vinculos }, (_, i) => ({ tenantId: `t${i}` })),
    tenant: { documentosLiberados: estado.documentos },
  }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/perfil', () => ({ situacaoDoWhatsapp: async () => ({ ativo: false }) }));
vi.mock('./actions', () => ({ meusDadosAction: async () => ({}), exclusaoAction: async () => ({}), whatsappAction: async () => ({}) }));
// no servidor o Instalar não renderiza nada (o estado vem do navegador): o marcador deixa a posição da seção conferida
vi.mock('./instalar-no-eu', () => ({ InstalarNoEu: () => 'Instalar o app' }));
const { default: Eu } = await import('./page');

describe('/p/perfil — Eu (US-197, molde D-Assuntos)', () => {
  it('na ordem da spec: conta, consultório e "Trocar de nutricionista", meus documentos, notificações, instalar, privacidade com a RN-214 e o Sair no fim', async () => {
    const html = renderToStaticMarkup(await Eu());
    const ordem = ['Conectado como marina@ex.com.', 'Consultório Debby', 'Trocar de nutricionista', 'Meus documentos', 'Notificações', 'Instalar o app', 'Privacidade', '>Sair<'];
    const corpo = html.slice(html.indexOf('<main')); // a faixa também diz o nome do consultório
    const posicoes = ordem.map((t) => corpo.indexOf(t));
    expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(html).toContain('Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).');
    expect(html).not.toMatch(/peso/i); // RN-214: nenhuma tela diz que o peso está oculto
  });
  it('um vínculo só: sem "Trocar de nutricionista"; documentos não liberados: sem "Meus documentos"', async () => {
    estado.vinculos = 1;
    estado.documentos = false;
    const html = renderToStaticMarkup(await Eu());
    expect(html).not.toContain('Trocar de nutricionista');
    expect(html).not.toContain('Meus documentos');
  });
});
```

Run: `pnpm vitest run "src/app/p/(portal)/perfil/page.test.ts"` → FAIL.

- [ ] **Step 2: A seção Eu**

Criar `src/app/p/(portal)/perfil/instalar-no-eu.tsx` (a função do cartão só pode nascer no cliente):

```tsx
'use client';
import { Instalar } from '../../instalar';

/** Eu › "Instalar o app": a seção só aparece quando dá para instalar (fora do modo instalado, onde o navegador permite). */
export function InstalarNoEu() {
  return (
    <Instalar
      cartao={(conteudo) => (
        <section aria-labelledby="eu-instalar" className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="eu-instalar" className="font-portal-titulo text-lg font-bold">Instalar o app</h2>
          {conteudo}
        </section>
      )}
    />
  );
}
```

Trocar `src/app/p/(portal)/perfil/page.tsx`:

```tsx
import Link from 'next/link';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { situacaoDoWhatsapp } from '@/modules/portal/perfil';
import { molduraDaSecao } from '../../moldura';
import { AtivarNotificacoes } from '../../notificacoes';
import { SairPortal } from '../../sair-portal';
import { InstalarNoEu } from './instalar-no-eu';
import { Privacidade } from './privacidade';
import { WhatsappForm } from './whatsapp-form';

export const dynamic = 'force-dynamic';

const CARTAO = 'space-y-2 rounded-2xl border border-borda bg-cartao p-4';
const H2 = 'font-portal-titulo text-lg font-bold';
const LINK = 'inline-flex min-h-11 items-center font-semibold text-link underline';

/**
 * Plano 16 (US-197, G-01g, molde D-Assuntos): Eu — a conta, o consultório ("Trocar de nutricionista" com 2+ vínculos,
 * RN-210), Meus documentos (US-146: só com os documentos liberados, D20 do 10A), Notificações (push e WhatsApp), Instalar
 * o app, Privacidade (US-046 + RN-214), Como usar o app (T14) e, no fim, Sair (RN-211).
 */
export default async function Eu() {
  const acesso = await requirePaciente('/p/perfil');
  const { ctx, data, tenant, vinculo, vinculos } = acesso;
  const [moldura, whatsapp] = await Promise.all([molduraDaSecao(acesso), situacaoDoWhatsapp(ctx)]);
  return (
    <>
      <Faixa {...moldura} atual="/p/perfil" titulo={MSG_G.titulos.eu} />
      <main className="space-y-4 p-4">
        <section aria-labelledby="eu-conta" className={CARTAO}>
          <h2 id="eu-conta" className={H2}>Conta</h2>
          <p>{`Conectado como ${data.user.email}.`}</p>
        </section>
        <section aria-labelledby="eu-consultorio" className={CARTAO}>
          <h2 id="eu-consultorio" className={H2}>Consultório</h2>
          {/* US-197: "o consultório (logo, nome)" — o logo como na faixa (URL assinada de 5 min, fundo branco) */}
          <p className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, sem otimização do Next */}
            {moldura.marca.logoUrl && <img src={moldura.marca.logoUrl} alt={`Logo de ${moldura.marca.nome}`} className="h-10 w-auto rounded bg-white p-1" />}
            <span>{moldura.marca.nome}</span>
          </p>
          {vinculos.length > 1 && (
            <Link href="/p/escolher?volta=%2Fp%2Finicio" className={LINK}>Trocar de nutricionista</Link>
          )}
        </section>
        {tenant.documentosLiberados && (
          <section aria-labelledby="eu-documentos" className={CARTAO}>
            <h2 id="eu-documentos" className={H2}>Meus documentos</h2>
            <Link href="/p/documentos" className={LINK}>Ver meus documentos</Link>
          </section>
        )}
        <section aria-labelledby="notificacoes" className={CARTAO}>
          <h2 id="notificacoes" className={H2}>Notificações</h2>
          <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
          <WhatsappForm ativo={whatsapp.ativo} />
        </section>
        <InstalarNoEu />
        <section aria-labelledby="privacidade" className={CARTAO}>
          <h2 id="privacidade" className={H2}>Privacidade</h2>
          <Privacidade />
        </section>
        <p>
          <SairPortal />
        </p>
      </main>
    </>
  );
}
```

Em `src/app/p/(portal)/perfil/privacidade.tsx`, logo no começo do que o componente devolve (antes dos botões), o texto fixo da RN-214 (G-D10 ★ — a Debby revisa):

```tsx
      {/* RN-214 (Plano 16): transparência sem estigma — nunca diz ao paciente que o peso dele está oculto; e não promete
          "todas" na cópia (notas privadas, rascunho do plano e anotações da nutricionista não saem — exportacao-job.ts) */}
      <p className="text-sm">Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).</p>
```

- [ ] **Step 3: Exames e as telas de conta no visual G**

`src/app/p/(portal)/exames/page.tsx`: sem mudança de regra (Plano 12); a seção "Enviar exame" ganha `className="space-y-3 rounded-2xl border border-borda bg-cartao p-4"` (já tem) e os `h2` passam a `font-portal-titulo text-lg font-bold`; a âncora `#enviar` da barra de ações cai no `<h2 id="enviar">` que já existe. Em `termo`, `escolher` e `sem-acesso`, os cartões e botões continuam; só os `h1` (já `font-portal-titulo` desde a T4) e os `h2`/`legend` passam a `font-portal-titulo`.

- [ ] **Step 4: Rodar e commitar**

```bash
pnpm vitest run "src/app/p" src/app/painel/cores.test.ts src/app/formularios-post.test.ts
pnpm typecheck && pnpm lint
git add "src/app/p/(portal)/perfil" "src/app/p/(portal)/exames/page.tsx" src/app/p/termo/page.tsx src/app/p/escolher/page.tsx src/app/p/sem-acesso/page.tsx
git commit -m "$(cat <<'MSG'
feat(portal): seção Eu por assunto e o visual G nas telas de conta (P16-13)

Eu na ordem da spec — conta, consultório e Trocar de nutricionista, Meus
documentos, Notificações, Instalar o app, Privacidade com o texto da RN-214
e Sair no fim; Exames, termo, escolher e sem acesso com os títulos do G.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 14: Manual guiado do portal — "O app mudou", o tour de 5 passos e "Como usar o app" (P16-14)

**Revisão: completa (agente revisor-rls)** — a exceção da tabela `user` (CLAUDE.md regra 1) passa a valer para a sessão de paciente: `marcarGuia`/`lerGuia` só com o `userId` de `requirePaciente`, nunca do formulário; a ação só aceita o guia do portal e a versão dele. Mais **uma rodada leve do revisor-interface** (texto do tour, `<dialog>` modal, teclado e leitor de tela, `prefers-reduced-motion`).

**Files:**
- Create: `src/modules/ajuda/portal.ts` (+ `portal.test.ts`), `src/app/p/(portal)/ajuda/page.tsx`, `src/app/p/(portal)/ajuda/actions.ts` (+ `actions.test.ts`), `src/app/p/(portal)/inicio/guia-do-portal.tsx`
- Move: `src/app/painel/guia/tour.tsx` → `src/components/guia/tour.tsx` (`git mv`; mesmo código + as props `focoAoFechar` e `folhaEvitaAlvo`)
- Modify: `src/app/painel/guia/guia-do-painel.tsx` (import do `Tour`; `aplicarMarca` passa a ser importado de `preferencias-tipos.ts` e reexportado), `src/modules/plataforma/preferencias-tipos.ts` (`aplicarMarca`, puro), `src/app/p/(portal)/inicio/page.tsx` (+ `page.test.ts`), `src/app/p/(portal)/perfil/page.tsx` (+ `page.test.ts`), `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `Guia`, `precisaDoGuia` (`src/modules/ajuda/conteudo.ts`), `marcarGuia`, `lerGuia`, `ESTADOS_GUIA`, `EstadoGuia`, `ProgressoGuia` (`src/modules/plataforma/preferencias*.ts`), `requirePaciente`; T4 (`CabecalhoDetalhe`, `data-guia` da faixa, das ações e de Eu), T10 (`data-guia="mural"`, `data-guia="respostas"`).
- Produces: `GUIA_PORTAL` (id `portal-novidades`, versão 1, 5 passos), `AVISO_PORTAL`; `marcarGuiaPortalAction(versao, estado)`; `GuiaDoPortal`; a rota `/p/ajuda` (sem JavaScript obrigatório); `Tour` em `src/components/guia/tour.tsx` com `focoAoFechar?: string` (padrão `'[data-guia="ajuda"]'`, o botão "Ajuda" do painel).

- [ ] **Step 1: Testes (falham)**

Criar `src/modules/ajuda/portal.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS } from './conteudo';
import { AVISO_PORTAL, GUIA_PORTAL } from './portal';

const FONTES = ['src/app/p', 'src/components/portal']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('manual guiado do portal (Plano 16, RN-212, US-199)', () => {
  it('id no formato do progresso e fora dos guias do painel; versão 1; 5 passos com "1 de 5"', () => {
    expect(GUIA_PORTAL.id).toBe('portal-novidades');
    expect(GUIA_PORTAL.id).toMatch(ID_GUIA);
    expect(GUIAS.map((g) => g.id)).not.toContain(GUIA_PORTAL.id);
    expect(GUIA_PORTAL.versao).toBe(1);
    expect(GUIA_PORTAL.passos).toHaveLength(5);
  });
  it('todo alvo do tour existe numa tela do portal (data-guia); a faixa, o mural, as respostas, as ações e a seção Eu', () => {
    expect(GUIA_PORTAL.passos.map((p) => p.alvo)).toEqual(['faixa', 'mural', 'respostas', 'acoes', 'secao-eu']);
    for (const p of GUIA_PORTAL.passos) expect(FONTES, p.alvo).toMatch(new RegExp(`['"]${p.alvo}['"]`));
  });
  it('textos do aviso (US-199) e nenhum texto do tour fala pela nutricionista', () => {
    expect(AVISO_PORTAL).toMatchObject({ pergunta: 'O app mudou. Quer ver onde ficou cada coisa?', ver: 'Ver como funciona', agoraNao: 'Agora não' });
    for (const p of GUIA_PORTAL.passos) expect(p.texto).not.toMatch(/^Sua nutricionista/);
  });
  it('RN-203/RN-214: nem a ajuda nem o tour falam de peso ou IMC (o mesmo texto vai a quem tem o peso oculto)', () => {
    expect(JSON.stringify({ ajuda: GUIA_PORTAL.ajuda, passos: GUIA_PORTAL.passos, aviso: AVISO_PORTAL })).not.toMatch(/peso|IMC/i);
  });
});
```

Criar `src/app/p/(portal)/ajuda/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const marcarGuia = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ data: { user: { id: 'conta-do-paciente' } } }) }));
vi.mock('@/modules/plataforma/preferencias', async (orig) => ({ ...(await orig<typeof import('@/modules/plataforma/preferencias')>()), marcarGuia }));
const { marcarGuiaPortalAction } = await import('./actions');

describe('marcarGuiaPortalAction (RN-212, CLAUDE.md regra 1)', () => {
  beforeEach(() => marcarGuia.mockClear());
  it('grava o progresso do guia do portal na conta da SESSÃO (o id do guia e a conta não vêm do cliente)', async () => {
    await marcarGuiaPortalAction(1, 'concluido');
    expect(marcarGuia).toHaveBeenCalledWith('conta-do-paciente', 'portal-novidades', 1, 'concluido');
  });
  it('versão ou estado fora do guia: recusa calada (nada gravado, nenhum 500)', async () => {
    for (const [v, e] of [[2, 'concluido'], [0, 'visto'], [1.5, 'visto'], [1, 'apagado']] as const) await marcarGuiaPortalAction(v, e as never);
    expect(marcarGuia).not.toHaveBeenCalled();
  });
});
```

Em `src/app/p/(portal)/inicio/page.test.ts`, acrescentar o mock `vi.mock('@/modules/plataforma/preferencias', () => ({ lerGuia: async () => ({}) }));` e `vi.mock('../ajuda/actions', () => ({ marcarGuiaPortalAction: async () => {} }));`, trocar a chamada por `await Hoje({ searchParams: Promise.resolve({}) } as never)` e acrescentar ao teste:

```ts
    // US-199: na primeira abertura depois do deploy, o aviso (só ele abre sozinho; o tour, só pelo botão)
    expect(html).toContain('O app mudou. Quer ver onde ficou cada coisa?');
    expect(html).toMatch(/<button[^>]*>Ver como funciona<\/button>/);
    expect(html).not.toContain('<dialog');
```

Em `src/app/p/(portal)/perfil/page.test.ts`, a lista da ordem ganha `'Como usar o app'` entre `'Privacidade'` e `'>Sair<'`.

Run: `pnpm vitest run src/modules/ajuda "src/app/p/(portal)/ajuda" "src/app/p/(portal)/inicio" "src/app/p/(portal)/perfil"` → FAIL.

- [ ] **Step 2: O guia, a ação e o `Tour` compartilhado**

Criar `src/modules/ajuda/portal.ts`:

```ts
import type { Guia } from './conteudo';

/**
 * Plano 16 (RN-212, US-199): o manual guiado do portal, no modelo do painel (P08-10). Fora de GUIAS: aqueles casam por rota
 * do painel; este só abre em Hoje. Texto RASCUNHO até a Debby revisar (G-D10 ★). Sobe a versão quando o texto mudar de
 * verdade (o aviso volta uma vez).
 */
export const GUIA_PORTAL: Guia = {
  id: 'portal-novidades',
  versao: 1,
  padrao: /^\/p\/inicio$/,
  titulo: 'Como usar o app',
  ajuda: {
    resumo: 'O app do seu acompanhamento tem cinco partes, no topo: Hoje, Jornada, Plano, Exames e Eu.',
    secoes: [
      {
        titulo: 'Onde fica cada coisa',
        itens: [
          'Hoje: o que importa no dia — a próxima refeição, o que você registrou, os comentários da sua nutricionista e os avisos do consultório. O diário completo fica em "Ver todo o diário".',
          // RN-203/RN-214: igual para todos e sem a palavra "peso" (quem tem o peso oculto não pode ler aqui que ele existe)
          'Jornada: suas consultas, as medidas e as orientações de cada atendimento, "Todas as medidas" e "Minhas consultas".',
          'Plano: as refeições do dia, o PDF, a lista de compras e os conteúdos.',
          'Exames: enviar um exame e acompanhar os que você enviou (quando o consultório recebe exames pelo app).',
          'Eu: sua conta, documentos, notificações, privacidade, este manual e o Sair.',
        ],
      },
      {
        titulo: 'Perguntas comuns',
        itens: [
          'Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta: dúvidas, anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192.',
          '"Comi assim" registra a refeição no seu diário, sem escrever. Você tem 10 segundos para desfazer.',
          'Sem internet, o app mostra a última versão do seu plano.',
        ],
      },
    ],
  },
  passos: [
    { alvo: 'faixa', titulo: 'Seu acompanhamento', texto: 'No topo ficam o nome do consultório e as partes do app. Em Hoje, um resumo da sua jornada leva à Jornada.' },
    { alvo: 'mural', titulo: 'Hoje', texto: 'Aqui aparecem a próxima refeição, o que você registrou, os comentários da sua nutricionista e os avisos do consultório.' },
    // o alvo só existe com uma refeição na janela de 90 min: o texto não depende de haver uma na tela (sem alvo, o passo aparece centralizado)
    { alvo: 'respostas', titulo: 'Responder à refeição', texto: 'Quando uma refeição estiver perto do horário, ela aparece em Hoje. Toque em "Comi assim" para registrar no diário sem escrever. Se comeu outra coisa, abra a refeição e toque em "Comi outra coisa".' },
    { alvo: 'acoes', titulo: 'Atalhos', texto: 'Aqui embaixo: foto da refeição, enviar exame e agendar consulta.' },
    { alvo: 'secao-eu', titulo: 'Eu', texto: 'Sua conta, documentos, notificações, privacidade, este passeio e o Sair ficam em Eu.' },
  ],
};

export const AVISO_PORTAL = {
  pergunta: 'O app mudou. Quer ver onde ficou cada coisa?',
  ver: 'Ver como funciona',
  agoraNao: 'Agora não',
  reverTour: 'Ver o tour de novo',
  comoUsar: 'Como usar o app',
} as const;
```

Criar `src/app/p/(portal)/ajuda/actions.ts`:

```ts
'use server';

import { requirePaciente } from '@/lib/paciente-session';
import { GUIA_PORTAL } from '@/modules/ajuda/portal';
import { ESTADOS_GUIA, marcarGuia, type EstadoGuia } from '@/modules/plataforma/preferencias';

/**
 * RN-212 / CLAUDE.md regra 1: o progresso do manual guiado do portal na conta do PACIENTE da sessão (`userId` de
 * requirePaciente, nunca do formulário). Só o guia do portal, até a versão atual; o resto é recusa calada (como a do painel).
 */
export async function marcarGuiaPortalAction(versao: number, estado: EstadoGuia): Promise<void> {
  const { data } = await requirePaciente('/p/inicio');
  if (!Number.isInteger(versao) || versao < 1 || versao > GUIA_PORTAL.versao || !ESTADOS_GUIA.includes(estado)) return;
  await marcarGuia(data.user.id, GUIA_PORTAL.id, versao, estado);
}
```

Mover o `Tour`: `git mv src/app/painel/guia/tour.tsx src/components/guia/tour.tsx`; na assinatura, `focoAoFechar = '[data-guia="ajuda"]'` como prop opcional (`{ guia, aberto, aoFechar, aoMarcar, focoAoFechar = '[data-guia="ajuda"]' }: { …; focoAoFechar?: string }`), e a linha do foco perdido passa a `if (perdido) document.querySelector<HTMLElement>(focoAoFechar)?.focus();`. **Folha que não cobre o alvo** (correção da revisão do plano): abaixo de 640 px o cartão é uma folha presa embaixo (`max-sm:bottom-3`, ~240 px) e cobriria a barra de ações (`sticky bottom-0`, passo "Atalhos"); o `Tour` ganha a prop opcional `folhaEvitaAlvo = false` (o painel não muda, G-D3) e, com ela, quando `caixa && caixa.bottom > window.innerHeight - CARTAO_ALTURA - 24`, a folha troca `max-sm:bottom-3` por `max-sm:top-3`. O `GuiaDoPortal` passa `folhaEvitaAlvo`. Em `src/app/painel/guia/guia-do-painel.tsx`: `import { Tour } from '@/components/guia/tour';`. Mover `aplicarMarca` (o corpo, sem mudança) para o fim de `src/modules/plataforma/preferencias-tipos.ts` e, em `guia-do-painel.tsx`, `import { aplicarMarca } from '@/modules/plataforma/preferencias-tipos'` + `export { aplicarMarca };` (o `guia-do-painel.test.ts` continua importando de lá). O painel não muda de comportamento (G-D3).

Criar `src/app/p/(portal)/inicio/guia-do-portal.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Tour } from '@/components/guia/tour';
import { precisaDoGuia } from '@/modules/ajuda/conteudo';
import { AVISO_PORTAL, GUIA_PORTAL } from '@/modules/ajuda/portal';
import { aplicarMarca, type EstadoGuia, type ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';
import { marcarGuiaPortalAction } from '../ajuda/actions';

/**
 * Plano 16 (US-199, RN-212): só o aviso "O app mudou…" abre sozinho, uma vez por conta (grava "visto" ao aparecer); o tour
 * (<dialog> modal do painel, "{i} de {n}", Voltar/Próximo/Concluir/Pular o tour) abre pelo botão ou por ?tour=portal-novidades
 * (o "Ver o tour de novo" de /p/ajuda). O progresso fica na conta (vale para todos os aparelhos e consultórios, RN-210).
 */
export function GuiaDoPortal({ progresso: inicial, abrir }: { progresso: ProgressoGuia; abrir: boolean }) {
  const router = useRouter();
  const [progresso, setProgresso] = useState(inicial);
  const [aberto, setAberto] = useState(abrir);
  const [avisoFechado, setAvisoFechado] = useState(false);
  const marcar = (estado: EstadoGuia) => {
    setProgresso((p) => aplicarMarca(p, GUIA_PORTAL.id, GUIA_PORTAL.versao, estado));
    marcarGuiaPortalAction(GUIA_PORTAL.versao, estado).catch(() => {});
  };
  const mostrarAviso = !aberto && !avisoFechado && precisaDoGuia(progresso, GUIA_PORTAL, ['concluido', 'dispensado', 'visto']);
  useEffect(() => {
    // uma vez: grava "visto" no servidor sem tirar o aviso desta visita
    if (mostrarAviso) marcarGuiaPortalAction(GUIA_PORTAL.versao, 'visto').catch(() => {});
  }, [mostrarAviso]);
  return (
    <>
      {aberto && (
        <Tour
          guia={GUIA_PORTAL}
          aberto
          focoAoFechar='[data-guia="secao-eu"]'
          folhaEvitaAlvo
          aoMarcar={marcar}
          aoFechar={() => {
            setAberto(false);
            if (abrir) router.replace('/p/inicio');
          }}
        />
      )}
      {mostrarAviso && (
        <aside aria-label="Novidade" className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
          <p>{AVISO_PORTAL.pergunta}</p>
          <p className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAvisoFechado(true);
                setAberto(true);
              }}
              className="min-h-11 rounded-full bg-destaque px-4 font-semibold text-white"
            >
              {AVISO_PORTAL.ver}
            </button>
            <button
              type="button"
              onClick={() => {
                setAvisoFechado(true);
                marcar('dispensado');
              }}
              className="min-h-11 px-2 text-link underline"
            >
              {AVISO_PORTAL.agoraNao}
            </button>
          </p>
        </aside>
      )}
    </>
  );
}
```

- [ ] **Step 3: Hoje, "Como usar o app" e Eu**

Em `src/app/p/(portal)/inicio/page.tsx`: a página recebe `{ searchParams }: PageProps<'/p/inicio'>`; lê `const progresso = await lerGuia(data.user.id)` (import de `@/modules/plataforma/preferencias`; vai junto do `Promise.all`) e `const { tour } = await searchParams`; e o primeiro filho do `<main>` passa a ser `<GuiaDoPortal progresso={progresso} abrir={tour === GUIA_PORTAL.id} />`.

Criar `src/app/p/(portal)/ajuda/page.tsx`:

```tsx
import Link from 'next/link';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { requirePaciente } from '@/lib/paciente-session';
import { AVISO_PORTAL, GUIA_PORTAL } from '@/modules/ajuda/portal';

export const dynamic = 'force-dynamic';

/** Plano 16 (US-199, RN-212): "Como usar o app" — funciona sem JavaScript; "Ver o tour de novo" abre o tour em Hoje. */
export default async function ComoUsarOApp() {
  await requirePaciente('/p/ajuda');
  return (
    <>
      <CabecalhoDetalhe titulo={GUIA_PORTAL.titulo} voltar={{ href: '/p/perfil', secao: 'Eu' }} />
      <main className="space-y-4 p-4">
        <p>{GUIA_PORTAL.ajuda.resumo}</p>
        {GUIA_PORTAL.ajuda.secoes.map((s, i) => (
          <section key={s.titulo} aria-labelledby={`ajuda-${i}`} className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
            <h2 id={`ajuda-${i}`} className="font-portal-titulo text-lg font-bold">{s.titulo}</h2>
            <ul className="list-disc space-y-1 pl-5">
              {s.itens.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        <p>
          <Link href={`/p/inicio?tour=${GUIA_PORTAL.id}`} className="inline-flex min-h-11 items-center font-semibold text-link underline">{AVISO_PORTAL.reverTour}</Link>
        </p>
      </main>
    </>
  );
}
```

Em `src/app/p/(portal)/perfil/page.tsx`, logo antes do `<p>` do "Sair":

```tsx
        <p>
          <Link href="/p/ajuda" className={LINK}>{AVISO_PORTAL.comoUsar}</Link>
        </p>
```

(Importar `AVISO_PORTAL` de `@/modules/ajuda/portal`; `/p/ajuda` já marca "Eu", T3.)

- [ ] **Step 4: CLAUDE.md, regra 1**

Trocar, na regra 1, o trecho `por \`src/modules/plataforma/preferencias.ts\` (tema do painel e progresso do manual guiado da própria usuária, Plano 08, D17)` por:

```
por `src/modules/plataforma/preferencias.ts` (tema do painel e progresso do manual guiado da própria usuária, Plano 08, D17; e, desde o Plano 16, o progresso do manual guiado do portal na conta do próprio paciente — `src/app/p/(portal)/ajuda/actions.ts` e a página Hoje, sempre com o `userId` de `requirePaciente`, nunca do formulário)
```

- [ ] **Step 5: Rodar e commitar**

```bash
pnpm vitest run src/modules/ajuda "src/app/p" src/app/painel/guia src/app/painel/preferencias src/app/painel/cores.test.ts src/app/formularios-post.test.ts src/lib/tema/tema.test.ts
pnpm typecheck && pnpm lint
git add -A src/modules/ajuda/portal.ts src/modules/ajuda/portal.test.ts src/components/guia src/app/painel/guia src/modules/plataforma/preferencias-tipos.ts "src/app/p/(portal)/ajuda" "src/app/p/(portal)/inicio" "src/app/p/(portal)/perfil" CLAUDE.md
git commit -m "$(cat <<'MSG'
feat(portal): manual guiado do portal e "Como usar o app" (P16-14)

Aviso "O app mudou" uma vez por conta, tour de 5 passos com o Tour do
painel (agora em src/components/guia), progresso em user.guia da conta do
paciente pela sessão, e a página /p/ajuda, que funciona sem JavaScript.
CLAUDE.md, regra 1: preferencias.ts também na sessão de paciente.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 15: LGPD — exportação, anonimização e a prova do CS-194 nos módulos do portal (P16-15)

**Revisão: completa (agente normas-cfn-lgpd)** — direito de acesso (LGPD art. 18, II): o titular continua recebendo o peso na cópia dos dados (RN-204); a resposta (com o rótulo que o paciente viu) e a refeição do plano entram no `dados.json` dos dois escopos; `pesoOcultoNoAppEm` também nos dois (D6 ★, revista: a questão vai ao advogado, E-09); a anonimização trata `refeicao_do_plano` como o texto do diário; nenhum módulo do portal devolve peso ou IMC com a opção ligada (CS-194).

**Files:**
- Create: `src/modules/portal/peso-oculto-portal.test.ts`
- Modify: `src/modules/pacientes/exportacao-job.ts` (+ `exportacao.test.ts`), `src/modules/pacientes/lgpd.test.ts`

**Interfaces:**
- Consumes: T1 (colunas), T6 (`muralDoPaciente`), T7 (respostas), T8 (`definirPesoOculto`, `evolucaoParaPaciente`), T9 (`jornadaDoPaciente`, `miniJornadaDoPaciente`), T11 (`planoDoPaciente`); `montarDados`, `EscopoExportacao`, `anonimizarVencidos`.
- Produces: `DadosExportacao.diario[].resposta`, `DadosExportacao.diario[].respostaRotulo`, `DadosExportacao.diario[].refeicaoDoPlano`, `DadosExportacao.paciente.pesoOcultoNoAppEm` (nos dois escopos, D6 ★ revista).

- [ ] **Step 1: Testes (falham)**

No fim do `describe` principal de `src/modules/pacientes/exportacao.test.ts`:

```ts
  it('Plano 16 (§10, RN-204, D6 ★): resposta (código e rótulo) e refeição do plano no diário dos dois escopos; "Não mostrar peso no app" nos dois; o peso continua nos dois', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { pesoOcultoNoAppEm: now });
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', resposta: 'como_no_plano', refeicaoDoPlano: 'Almoço · 12:30', dataHora: now }), app.db);
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${T.tenantId}, ${p.id}, '2026-09-01', 81.37, 170)`), app.db);
    const equipe = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo', 'equipe'), app.db);
    const titular = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo', 'titular'), app.db);
    for (const d of [equipe.dados, titular.dados]) {
      // LGPD art. 19, II e art. 9º: o texto que o paciente viu, não só o código interno (mesmo problema do P12-23 e)
      expect(d.diario).toEqual([expect.objectContaining({ refeicao: 'Almoço', resposta: 'como_no_plano', respostaRotulo: 'Comi assim', refeicaoDoPlano: 'Almoço · 12:30', texto: null })]);
      expect(d.antropometria.map((a) => a.pesoKg)).toEqual([81.37]); // RN-204: a opção não muda a exportação
      // D6 ★ revista: dado pessoal do titular (art. 5º, I; art. 18, II) — nos dois escopos até o parecer do advogado (E-09)
      expect(d.paciente.pesoOcultoNoAppEm).toBe(now.toISOString());
    }
  });
```

Em `src/modules/pacientes/lgpd.test.ts`, no `describe` da anonimização (usa `anonimizarSo`, `ler` e o `now` do arquivo):

```ts
  it('Plano 16 (§10): a anonimização trata a refeição do plano como o texto do diário — o registro fica, a identificação sai', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-30' });
    await withTenant(T.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', texto: 'arroz', resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30' }), app.db);
    await anonimizarSo(T);
    expect((await ler(T.ctx, p.id)).nome).toBe('Paciente anonimizado');
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), app.db);
    expect(e).toMatchObject({ texto: 'arroz', resposta: 'outra_coisa', refeicaoDoPlano: 'Almoço · 12:30' });
  });
```

(Importar `diaryEntries` de `@/db/schema` no `lgpd.test.ts` se faltar.)

Criar `src/modules/portal/peso-oculto-portal.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';
import { evolucaoParaPaciente } from './evolucao';
import { jornadaDoPaciente, miniJornadaDoPaciente } from './jornada';
import { muralDoPaciente } from './mural';
import { planoDoPaciente } from './plano';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

// Valores que só podem vir do peso (81,37 e 78,62 kg com 170 cm → IMC 28,16 e 27,20) e as formas como a tela os escreveria
const PESO_OU_IMC = /81[.,]37|81[.,]4|78[.,]62|78[.,]6|28[.,]16|28[.,]2|27[.,]2|\bkg\b|IMC|"peso"|"imc"|pesoKg/;

describe('CS-194: com "Não mostrar peso no app", nenhum módulo do portal devolve peso ou IMC (RN-203)', () => {
  it('mural, jornada, mini-jornada, "Todas as medidas" e o plano (a cópia offline) — a cintura continua', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: '12:30' }], mostrarCalorias: true });
    await consultaDireta(app.db, T.ctx, p.id, new Date(Date.now() + 26 * 3600_000));
    await withTenant(
      T.ctx,
      async (tx) => {
        const [c] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${T.tenantId}, ${p.id}, '2026-03-18', 'Beber água.') returning id`)).rows;
        await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, consultation_id, data, peso_kg, altura_cm, circunferencias) values
          (${T.tenantId}, ${p.id}, ${c.id}, '2026-03-18', 81.37, 170, '{"cintura": 92}'),
          (${T.tenantId}, ${p.id}, null, '2026-09-22', 78.62, 170, '{"cintura": 86}')`);
      },
      app.db,
    );
    await definirPesoOculto(T.ctx, p.id, true, { db: app.db });
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    const agora = new Date();
    const respostas = {
      mural: await muralDoPaciente(ctx, tenant, agora, app.db),
      jornada: await jornadaDoPaciente(ctx, tenant, agora, app.db),
      mini: await miniJornadaDoPaciente(ctx, tenant, agora, app.db),
      medidas: await evolucaoParaPaciente(ctx, tenant, app.db),
      plano: await planoDoPaciente(ctx, tenant.fuso, { db: app.db }),
    };
    for (const [nome, r] of Object.entries(respostas)) expect(JSON.stringify(r), nome).not.toMatch(PESO_OU_IMC);
    expect(JSON.stringify(respostas.jornada)).toContain('cintura 86 cm');
    expect(respostas.medidas.series.map((s) => s.id)).toEqual(['circ_cintura']);

    // desligar: o peso volta no próximo carregamento (US-195 "Desligar")
    await definirPesoOculto(T.ctx, p.id, false, { db: app.db });
    expect(JSON.stringify(await jornadaDoPaciente(ctx, tenant, agora, app.db))).toContain('78,62 kg');
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/modules/portal/peso-oculto-portal.test.ts` → FAIL na exportação (os campos novos).

- [ ] **Step 2: A exportação**

Em `src/modules/pacientes/exportacao-job.ts`:

1. No tipo `DadosExportacao`, em `paciente`, acrescentar depois de `recusouIaEm`:

```ts
    /**
     * Plano 16 (G-D1, D6 ★ revista na revisão do plano): preferência de exibição no app definida pela nutricionista ("Não
     * mostrar peso no app", desde quando) — nos DOIS escopos: é dado pessoal do titular (LGPD art. 5º, I; art. 18, II). Tirar
     * da cópia do titular só com o parecer do advogado (E-09) e a base no LEIA-ME. O peso das avaliações vai nos dois (RN-204).
     */
    pesoOcultoNoAppEm: string | null;
```

e, em `diario`, o tipo passa a `{ dataHora: string; refeicao: string; texto: string | null; foto: string | null; comentarioNutri: string | null; /** Plano 16 (RN-197): "como_no_plano" | "outra_coisa" | null. */ resposta: string | null; /** o texto que o paciente viu: "Comi assim" | "Comi outra coisa" | null (LGPD art. 19, II). */ respostaRotulo: string | null; /** "{nome} · {HH:MM}" da refeição do plano (cópia). */ refeicaoDoPlano: string | null }[]` (o comentário do campo diz: "texto, refeição, a resposta à refeição do plano, comentário da nutricionista e a foto").

2. No objeto `paciente` montado em `montarDados`, depois de `recusouIaEm`:

```ts
      pesoOcultoNoAppEm: p.pesoOcultoNoAppEm?.toISOString() ?? null, // D6 ★ revista: nos dois escopos
```

3. No `diario: di.map(…)`:

```ts
    diario: di.map((e) => ({ dataHora: e.dataHora.toISOString(), refeicao: e.refeicao, texto: e.texto, foto: null, comentarioNutri: e.comentarioNutri, resposta: e.resposta, respostaRotulo: e.resposta ? ROTULO_RESPOSTA[e.resposta as RespostaDoDiario] : null, refeicaoDoPlano: e.refeicaoDoPlano })),
```

(Import de `ROTULO_RESPOSTA` e `type RespostaDoDiario` de `@/modules/portal/diario-constantes`, que não importa nada de servidor.)

O `prontuario.pdf` da exportação não tem seção do diário (conferido em 08/10/2026: o diário só vai no `dados.json` e as fotos em `diario/`): nada a mudar nele.

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm vitest run src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/modules/portal/peso-oculto-portal.test.ts src/modules/portal
pnpm typecheck && pnpm lint
git add src/modules/pacientes/exportacao-job.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/modules/portal/peso-oculto-portal.test.ts
git commit -m "$(cat <<'MSG'
feat(lgpd): respostas do diário e a opção de peso na exportação (P16-15)

O dados.json leva a resposta e a refeição do plano de cada registro do
diário nos dois escopos (com o rótulo que o paciente viu) e "Não mostrar
peso no app" também nos dois (D6, revista: dado pessoal do titular);
o peso das avaliações continua nos dois (RN-204). A anonimização trata a
refeição do plano como o texto do diário. Teste do CS-194 sobre todos os
módulos do portal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

### Task 16: Fechamento — E2E "nada some", app do paciente, acessibilidade, carga, manuais, runbook, índice e backlog (P16-16)

**Revisão: leve (revisor-interface)** — E2E e axe das telas novas; o manual técnico e o manual do usuário passam também pelo `guardiao-manual` (`.claude/agents/guardiao-manual.md`).

**Files:**
- Create: `e2e/app-paciente.spec.ts`, `e2e/nada-some.spec.ts`, `docs/operacao/app-paciente.md`
- Modify: `e2e/portal.ts` (helper `publicarPlanoDoDia`), `e2e/acessibilidade.spec.ts` (`ROTAS`, refeição aberta, tour, foco sobre a faixa, 320 px com texto em 200%), `test/carga/cenario.js`, `docs/manual-tecnico/05-agenda-portal-conteudo.md`, `docs/manual-tecnico/11-exames-enviados.md`, `docs/manual-tecnico/06-worker-seguranca-operacao.md` (§6.8.1, voltar atrás), `docs/manual-tecnico/README.md`, `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md`, `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md`, `docs/superpowers/specs/2026-10-08-nutridebby-app-paciente-g-design.md` (status), `docs/superpowers/specs/2026-09-27-nutridebby-mvp-historias.md` (tabela "Textos de interface" do E5)

**Interfaces:**
- Consumes: tudo das Tarefas 1–15; `pacienteNoPortal`, `avaliar`, `entradasDoPlano` (`e2e/portal.ts`), `entrarComo` (`e2e/helpers.ts`), `contraste`, `corDaFaixa`.
- Produces: o E2E de ponta a ponta do layout G; o runbook; os manuais; o fechamento no índice e no backlog. **IPs do Plano 16 nos E2E: bloco `10.9.26.x`** (o `.1` é do `fontes-portal.spec.ts`, T2).

- [ ] **Step 1: O helper do plano "de agora"**

Em `e2e/portal.ts`, acrescentar (o mural só mostra a refeição de 90 min antes do horário: o E2E precisa de uma refeição perto da hora de quem roda):

```ts
/** HH:MM de daqui a 30 min em São Paulo (o fuso do consultório do E2E); perto da meia-noite, 23:59 (sempre hoje, já na janela de 90 min). */
export function horarioDaquiAMeiaHora(agora = new Date()): string {
  const f = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const [hoje, depois] = [f(agora), f(new Date(agora.getTime() + 30 * 60_000))];
  return hoje.slice(0, 10) === depois.slice(0, 10) ? depois.slice(12, 17) : '23:59';
}

/** Como publicarPlanoSimples, com o "Almoço" no horário pedido (padrão: daqui a 30 min) — para o mural de Hoje (RN-196). */
export async function publicarPlanoDoDia(nutri: Page, prontuario: string, horario = horarioDaquiAMeiaHora()) {
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).fill('Almoço');
  await nutri.getByLabel('Horário de Almoço').fill(horario);
  await nutri.getByLabel('Adicionar alimento em Almoço').fill('chuchu cozido');
  await nutri.getByRole('option', { name: /Chuchu, cozido/ }).click();
  await nutri.getByLabel('Gramas de Chuchu, cozido').fill('100');
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10_000 });
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
  return horario;
}
```

(Conferir no `Intl` do Node do CI que o formato `en-CA` com hora sai `AAAA-MM-DD, HH:MM`; se vier sem a vírgula, ajustar o `slice` — o teste do Step 2 falha logo se o horário vier errado.)

- [ ] **Step 2: E2E do app do paciente**

Criar `e2e/app-paciente.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { avaliar, entradasDoPlano, pacienteNoPortal, publicarPlanoDoDia } from './portal';

// Plano 16 (US-191 a US-195). IPs: 10.9.26.2 (nutricionista) e 10.9.26.3 a 10.9.26.9 (pacientes).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.26.2');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('Hoje: a refeição que vem aí; "Comi assim" com "Desfazer"; depois do prazo vai ao diário e a nutricionista vê "Comeu como no plano"', async ({ browser }) => {
  test.setTimeout(90_000);
  const p = await pacienteNoPortal(browser, nutri, '10.9.26.3');
  const horario = await publicarPlanoDoDia(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { level: 1, name: /^Olá, Paula$/ })).toBeVisible();
  const item = p.page.getByRole('listitem').filter({ hasText: `Almoço` }).filter({ hasText: horario });
  await expect(item).toBeVisible();
  await expect(item).not.toContainText('Sua nutricionista'); // RN-194: o lembrete é do app do consultório
  await expect(p.page.getByText('Este app não é um canal de conversa', { exact: false })).toBeVisible();
  await expect(p.page.locator('main textarea, main input[type="text"]')).toHaveCount(0); // C-191

  await item.getByRole('button', { name: 'Comi assim' }).click();
  await expect(item.getByRole('status')).toContainText('Registrado no diário.'); // + o sr-only "Para desfazer…"
  await item.getByRole('button', { name: 'Desfazer' }).click();
  await expect(item.getByRole('status')).toHaveText('Registro desfeito.');
  await p.page.goto('/p/diario');
  await expect(p.page.getByText('Nenhum registro ainda.')).toBeVisible(); // nada foi gravado

  await p.page.goto('/p/inicio');
  await item.getByRole('button', { name: 'Comi assim' }).click();
  await expect(item.getByRole('button', { name: 'Desfazer' })).toBeHidden({ timeout: 15_000 }); // 10 s e envia
  await expect(p.page.getByRole('listitem').filter({ hasText: 'Comi assim' }).filter({ hasText: `Almoço · ${horario}` })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Comi assim' })).toHaveCount(0); // RN-197: some depois da resposta

  await nutri.goto('/painel/diarios');
  await expect(nutri.getByRole('listitem').filter({ hasText: p.nome }).filter({ hasText: 'Comeu como no plano' })).toBeVisible();
  await p.page.context().close();
});

test('RN-198: sair da tela dentro do prazo envia (o paciente já disse que comeu)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.26.4');
  const horario = await publicarPlanoDoDia(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.getByRole('listitem').filter({ hasText: horario }).getByRole('button', { name: 'Comi assim' }).click();
  await p.page.goto('/p/diario'); // navegação inteira: pagehide → fetch com keepalive
  await expect
    .poll(async () => {
      await p.page.reload();
      return p.page.getByText('Comi assim', { exact: true }).count();
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await p.page.context().close();
});

test('"Não mostrar peso no app" (US-195, CS-194): nenhuma resposta do servidor ao aparelho traz o peso ou o IMC; desligar devolve', async ({ browser }) => {
  test.setTimeout(120_000);
  const p = await pacienteNoPortal(browser, nutri, '10.9.26.5');
  await publicarPlanoDoDia(nutri, p.prontuario);
  await avaliar(nutri, p.prontuario, '2026-03-18', '81.4');
  await avaliar(nutri, p.prontuario, '2026-09-22', '78.6');
  await nutri.goto(`${p.prontuario}/evolucao`);
  await nutri.getByLabel('Não mostrar peso no app').check();
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByText(/^Peso oculto no app desde \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

  const corpos: string[] = [];
  p.page.on('response', async (r) => {
    const tipo = r.request().resourceType();
    if (new URL(r.url()).pathname.startsWith('/p/') && (tipo === 'document' || tipo === 'fetch')) corpos.push(await r.text().catch(() => ''));
  });
  await p.page.goto('/p/inicio');
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Jornada' }).click(); // RSC do roteador
  await expect(p.page).toHaveURL(/\/p\/jornada$/);
  await p.page.getByRole('link', { name: 'Todas as medidas' }).click();
  await expect(p.page).toHaveURL(/\/p\/evolucao$/);
  await p.page.goto('/p/jornada');
  await p.page.goto('/p/evolucao');
  await p.page.goto('/p/plano'); // a cópia offline
  await p.page.waitForLoadState('networkidle');
  expect(corpos.length).toBeGreaterThan(4);
  for (const c of corpos) expect(c).not.toMatch(/81[.,]4|78[.,]6|\d kg\b|IMC/);
  await expect(p.page.getByText('peso', { exact: false })).toHaveCount(0); // o app não diz que o peso está oculto

  await nutri.getByLabel('Não mostrar peso no app').uncheck();
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await p.page.goto('/p/jornada');
  await expect(p.page.getByText(/78,6 kg/).first()).toBeVisible(); // US-195 "Desligar"
  await p.page.context().close();
});

test('offline (US-193, RN-208): o endereço de uma refeição cai na cópia do plano com a refeição aberta; os botões que gravam ficam desabilitados', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.26.6');
  const horario = await publicarPlanoDoDia(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  const id = (await p.page.locator('details[id^="ref-"]').first().getAttribute('id'))!.slice(4);
  await p.page.context().setOffline(true);
  await p.page.goto(`/p/plano/refeicao/${id}`);
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await expect(p.page.locator(`details#ref-${id}`)).toHaveAttribute('open', '');
  await expect(p.page.getByRole('heading', { name: `Almoço · ${horario}` })).toBeVisible();
  await expect(p.page.getByRole('button', { name: 'Comi assim' }).first()).toBeDisabled();
  await expect(p.page.getByText('Sem conexão. Registre quando voltar.').first()).toBeVisible();
  await p.page.context().setOffline(false);
  await p.page.context().close();
});
```

- [ ] **Step 3: E2E "nada some" (CS-190, RNF-197 c, §4.10)**

Criar `e2e/nada-some.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { marcarParaPaciente, pacienteNoPortal, publicarPlanoDoDia } from './portal';

// Plano 16 (CS-190): toda função do portal de antes do layout G é alcançável a partir de Hoje no número de toques da
// tabela "nada some" da §4.10 da spec (o dado deste teste; ≤ 2, e 3 só nas linhas do Desvio 16). O consultório do E2E tem
// documentos liberados e o recebimento de exames ligado (scripts/e2e-seed.ts). IPs: 10.9.26.10 (nutricionista),
// 10.9.26.11 (paciente) e 10.9.26.12 (conta MULTI). O conteúdo de dentro das telas que dependem de dado que o E2E não cria
// (a "Sugestão de receita" na refeição aberta, a "Orientação da sua nutricionista" na Jornada) é coberto pelos testes de
// componente (T11 `RefeicaoDetalhe`, T12 `jornada/page.test.ts`); aqui o teste mede o caminho até a tela que os mostra.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' }; // scripts/e2e-seed.ts: 3 consultórios
type Toque = { nome: string; em?: 'Seções' | 'Ações'; papel?: 'link' | 'button' };
type Caminho = { funcao: string; toques: [Toque] | [Toque, Toque] | [Toque, Toque, Toque]; destino?: RegExp; ve?: { papel: 'link' | 'button' | 'heading'; nome: string } };

const CAMINHOS: Caminho[] = [
  { funcao: 'Diário completo (histórico, foto, comentário)', toques: [{ nome: 'Ver todo o diário' }], destino: /\/p\/diario$/ },
  { funcao: 'Registrar refeição com foto', toques: [{ nome: 'Foto da refeição', em: 'Ações' }], destino: /\/p\/diario\?foto=1/ },
  { funcao: 'Refeição aberta (e a sugestão de receita dela)', toques: [{ nome: 'Ver a refeição' }], destino: /\/p\/plano\/refeicao\/[0-9a-f-]{36}$/ },
  { funcao: 'Enviar exame', toques: [{ nome: 'Enviar exame', em: 'Ações' }], destino: /\/p\/exames(#enviar)?$/ },
  { funcao: 'Agendar consulta', toques: [{ nome: 'Agendar', em: 'Ações' }], destino: /\/p\/agenda(\/nova)?$/ },
  { funcao: 'Jornada (medidas por consulta, orientações recebidas)', toques: [{ nome: 'Jornada', em: 'Seções' }], destino: /\/p\/jornada$/ },
  { funcao: 'Confirmar presença, cancelar, remarcar (próxima consulta)', toques: [{ nome: 'Jornada', em: 'Seções' }, { nome: 'Ver a consulta' }], destino: /\/p\/agenda\/[0-9a-f-]{36}$/, ve: { papel: 'button', nome: 'Confirmar presença' } },
  { funcao: 'Todas as medidas', toques: [{ nome: 'Jornada', em: 'Seções' }, { nome: 'Todas as medidas' }], destino: /\/p\/evolucao$/ },
  { funcao: 'Minhas consultas', toques: [{ nome: 'Jornada', em: 'Seções' }, { nome: 'Minhas consultas' }], destino: /\/p\/agenda$/ },
  { funcao: 'Plano do dia e orientações', toques: [{ nome: 'Plano', em: 'Seções' }], destino: /\/p\/plano$/ },
  { funcao: 'Baixar PDF do plano', toques: [{ nome: 'Plano', em: 'Seções' }], ve: { papel: 'link', nome: 'Baixar PDF' } },
  { funcao: 'Lista de compras', toques: [{ nome: 'Plano', em: 'Seções' }, { nome: 'Lista de compras' }], destino: /\/p\/compras/ },
  { funcao: 'Conteúdos', toques: [{ nome: 'Plano', em: 'Seções' }, { nome: 'Conteúdos' }], destino: /\/p\/conteudos$/ },
  { funcao: 'Meus exames', toques: [{ nome: 'Exames', em: 'Seções' }], destino: /\/p\/exames$/ },
  { funcao: 'Conectado como', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'heading', nome: 'Conta' } }, // e o e-mail: teste próprio abaixo
  { funcao: 'Meus documentos', toques: [{ nome: 'Eu', em: 'Seções' }, { nome: 'Ver meus documentos' }], destino: /\/p\/documentos$/ },
  { funcao: 'Notificações e WhatsApp', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'heading', nome: 'Notificações' } },
  { funcao: 'Privacidade (baixar, pedir exclusão)', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'button', nome: 'Baixar meus dados' } },
  { funcao: 'Como usar o app', toques: [{ nome: 'Eu', em: 'Seções' }, { nome: 'Como usar o app' }], destino: /\/p\/ajuda$/ },
  { funcao: 'Sair', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'button', nome: 'Sair' } },
];

let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.26.10');
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.26.11');
  await publicarPlanoDoDia(nutri, paciente.prontuario);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 0); // a próxima consulta (Jornada › "Ver a consulta")
});
test.afterAll(async () => {
  await paciente?.page.context().close();
  await nutri?.context().close();
});

for (const c of CAMINHOS) {
  test(`nada some: ${c.funcao} em ${c.toques.length} toque(s) a partir de Hoje`, async () => {
    const page = paciente.page;
    await page.goto('/p/inicio');
    for (const t of c.toques) {
      const raiz = t.em ? page.getByRole('navigation', { name: t.em }) : page.getByRole('main');
      await raiz.getByRole(t.papel ?? 'link', { name: t.nome, exact: true }).first().click();
    }
    if (c.destino) await expect(page).toHaveURL(c.destino);
    if (c.ve) await expect(page.getByRole(c.ve.papel, { name: c.ve.nome, exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '404' })).toHaveCount(0);
  });
}

test('"Conectado como {e-mail}" em Eu (§4.10)', async () => {
  await paciente.page.goto('/p/inicio');
  await paciente.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Eu', exact: true }).click();
  await expect(paciente.page.getByText(paciente.email)).toBeVisible();
});

test('"Trocar de nutricionista" (2+ vínculos) em Eu, a 1 toque de Hoje (§4.10)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.26.12');
  await expect(page).toHaveURL(/\/p\/escolher/);
  await page.getByRole('main').getByRole('button').first().click(); // o primeiro consultório da lista (o "Sair" fica no cabeçalho, fora do main)
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Eu', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Trocar de nutricionista' })).toBeVisible();
  await page.context().close();
});

test('as rotas antigas continuam (C-195): os destinos do push e do e-mail abrem; seção marcada nas seções e "Voltar para {seção}" nos detalhes (Desvio 14)', async () => {
  const page = paciente.page;
  // [rota, seção da nav marcada | null, nome do "Voltar" nas telas de detalhe]
  const secoes: [string, string | null, string | null][] = [
    ['/p/diario', null, 'Voltar para Hoje'],
    ['/p/plano', 'Plano', null],
    ['/p/conteudos', null, 'Voltar para Plano'],
    ['/p/compras', null, 'Voltar para Plano'],
    ['/p/documentos', null, 'Voltar para Eu'],
    ['/p/exames', 'Exames', null],
    ['/p/evolucao', null, 'Voltar para Jornada'],
    ['/p/agenda', null, 'Voltar para Jornada'],
    ['/p/perfil', 'Eu', null],
  ];
  for (const [rota, secao, voltar] of secoes) {
    await page.goto(rota);
    await expect(page, rota).toHaveURL(new RegExp(`${rota.replace(/\//g, '\\/')}$`));
    await expect(page.getByRole('heading', { level: 1 }), rota).toBeVisible();
    if (secao) await expect(page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: secao }), rota).toHaveAttribute('aria-current', 'page');
    if (voltar) await expect(page.getByRole('banner').getByRole('link', { name: voltar, exact: true }), rota).toBeVisible();
  }
});
```

(A "Página da exportação" da §4.10 não sai de Hoje — chega pelo link do e-mail — e já tem E2E em `portal.spec.ts` e `acessibilidade.spec.ts`; o "Ativar notificações" do cartão do mural depende da permissão do navegador, e a mesma função fica em Eu › Notificações, linha "Notificações e WhatsApp".)

- [ ] **Step 4: Acessibilidade das telas novas**

Em `e2e/acessibilidade.spec.ts`:

1. `ROTAS` ganha `'/p/jornada'` e `'/p/ajuda'` (as duas entram também no laço do modo escuro, que já percorre `ROTAS`).
2. No `beforeAll`, o `publicarPlanoSimples` passa a `publicarPlanoDoDia` (import de `./portal`; correção da revisão do plano: com o "Almoço" às 12:00, o mural só tem a refeição entre 10:30 e 23:59 e o axe de Hoje com o "Comi assim" dependeria da hora do CI — conferir com `git grep -n "12:00" e2e/acessibilidade.spec.ts` que nenhum teste do arquivo depende desse horário) e, depois dele, guardar o id da refeição para o axe da refeição aberta: `await paciente.page.goto('/p/plano'); refeicaoId = (await paciente.page.locator('details[id^="ref-"]').first().getAttribute('id'))!.slice(4);` (com `let refeicaoId = '';` no topo).
3. Acrescentar os testes:

```ts
test('axe na refeição aberta (claro e escuro) e no tour do portal (passo a passo, só teclado)', async () => {
  await semViolacoes(paciente.page, `/p/plano/refeicao/${refeicaoId}`);
  await paciente.page.emulateMedia({ colorScheme: 'dark' });
  try {
    expect(await violacoes(paciente.page), 'refeição aberta, aparelho escuro').toEqual([]);
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
  }
  await paciente.page.goto('/p/inicio?tour=portal-novidades');
  const dialogo = paciente.page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('1 de 5')).toBeVisible();
  expect(await violacoes(paciente.page)).toEqual([]);
  for (let i = 2; i <= 5; i++) {
    await dialogo.getByRole('button', { name: 'Próximo' }).focus();
    await paciente.page.keyboard.press('Enter');
    await expect(dialogo.getByText(`${i} de 5`)).toBeVisible();
    if (i === 4) {
      // "Atalhos" (alvo: a barra de ações, sticky no rodapé): a folha do tour não pode cobrir o alvo (folhaEvitaAlvo, T14)
      const alvo = (await paciente.page.locator('[data-guia="acoes"]').boundingBox())!;
      const folha = (await dialogo.locator('#tour-titulo').locator('xpath=..').boundingBox())!;
      expect(folha.y + folha.height <= alvo.y || alvo.y + alvo.height <= folha.y, 'folha do tour sobre a barra de ações').toBe(true);
    }
  }
  await dialogo.getByRole('button', { name: 'Concluir' }).focus();
  await paciente.page.keyboard.press('Enter');
  await expect(dialogo).toBeHidden();
});

test('foco visível sobre a faixa do portal: contorno branco ≥ 3:1 contra a cor da faixa, no claro e no escuro (RN-207)', async () => {
  const hex = (cor: string) => `#${/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cor)!.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  for (const modo of ['light', 'dark'] as const) {
    await paciente.page.emulateMedia({ colorScheme: modo });
    try {
      await paciente.page.goto('/p/inicio');
      const alvos = paciente.page.locator('header[data-sobre-marca] a[href]');
      expect(await alvos.count()).toBeGreaterThan(4);
      await paciente.page.keyboard.press('Tab');
      for (let k = 0; k < (await alvos.count()); k++) {
        const r = await alvos.nth(k).evaluate((el) => {
          (el as HTMLElement).focus();
          const s = getComputedStyle(el);
          return { visivel: el.matches(':focus-visible'), cor: s.outlineColor, largura: parseFloat(s.outlineWidth), faixa: getComputedStyle(el.closest('header')!).backgroundColor };
        });
        expect(r.visivel, `${modo} ${k}`).toBe(true);
        expect(r.largura).toBeGreaterThanOrEqual(2);
        expect(contraste(hex(r.cor), hex(r.faixa)), `${modo} ${k}`).toBeGreaterThanOrEqual(3);
      }
    } finally {
      await paciente.page.emulateMedia({ colorScheme: 'light' });
    }
  }
});

test('320 px com o texto em 200% (WCAG 1.4.4/1.4.10): nenhuma tela do layout G rola na horizontal; as seções continuam em colunas; axe a 320 px em todas', async () => {
  await paciente.page.setViewportSize({ width: 320, height: 780 });
  try {
    // todas as telas do portal que esta paciente abre (termo, escolher e sem-acesso: testes próprios do arquivo)
    for (const url of ['/p/inicio', '/p/jornada', '/p/plano', `/p/plano/refeicao/${refeicaoId}`, '/p/evolucao', '/p/exames', '/p/perfil', '/p/ajuda', '/p/diario', '/p/conteudos', '/p/agenda', '/p/compras', '/p/documentos']) {
      await paciente.page.goto(url);
      expect(await violacoes(paciente.page), `axe a 320 px: ${url}`).toEqual([]);
      await paciente.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      expect(await paciente.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
  } finally {
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
  }
});

test('"Comi assim" só com o teclado (WCAG 2.1.1, 2.2.1, 2.4.3): o foco vai ao "Desfazer" (o prazo pausa) e, ao desfazer, volta ao botão; axe com o aviso aberto, claro e escuro', async () => {
  test.setTimeout(60_000);
  for (const modo of ['light', 'dark'] as const) {
    await paciente.page.emulateMedia({ colorScheme: modo });
    try {
      await paciente.page.goto('/p/inicio');
      const comi = paciente.page.getByRole('main').getByRole('button', { name: 'Comi assim' }).first();
      await comi.focus();
      await paciente.page.keyboard.press('Enter');
      const desfazer = paciente.page.getByRole('button', { name: 'Desfazer' });
      await expect(desfazer).toBeFocused();
      expect(await violacoes(paciente.page), `Hoje com o "Desfazer" aberto (${modo})`).toEqual([]);
      await paciente.page.waitForTimeout(11_000); // com o foco no aviso, o prazo de 10 s não corre (nada é enviado)
      await expect(desfazer).toBeVisible();
      await paciente.page.keyboard.press('Enter');
      await expect(paciente.page.getByRole('main').getByRole('button', { name: 'Comi assim' }).first()).toBeFocused();
    } finally {
      await paciente.page.emulateMedia({ colorScheme: 'light' });
    }
  }
});
```

- [ ] **Step 5: Carga (RNF-190, PM-G11)**

Em `test/carga/cenario.js`, `ROTAS` ganha `'/p/jornada'` e o laço do `paciente()` passa a abrir `'/p/inicio', '/p/jornada', '/p/plano', …` (a Jornada logo depois de Hoje, como o paciente faz). A pilha de carga roda **só** no ambiente de carga do P08-03 (nunca em produção); o runbook (Step 7) registra a p95 de `/p/inicio` e `/p/jornada` (meta 800 ms) e o crescimento de `audit_log` por abertura de Hoje (três "Visualizou" + o da antropometria da mini-jornada, PM-G11).

- [ ] **Step 6: Manuais, spec, índice e backlog**

- `docs/manual-tecnico/05-agenda-portal-conteudo.md`: §5.5.2 "Rotas e abas" vira "Rotas e seções" (a tabela da §4.1 da spec: seção, rota, o que marca, título; `SECOES_DO_PORTAL`, `secoesDoPortal`, `itemAtual`; a regra "toda página marca uma seção" e o teste); §5.5 ganha **5.5.11 "Hoje: o mural"** (`comporMural` × `muralDoPaciente`, fontes, janela de 7 dias, 40 itens, 90 min, autoria RN-194, `auditRead` por entidade, por que não há tabela de mensagens), **5.5.12 "Respostas no diário"** (colunas, CHECKs, `refeicao_do_plano` como cópia, idempotência D3, "Desfazer" no aparelho com `keepalive`, sem DELETE), **5.5.13 "Jornada"** (módulo, mini-jornada, gráfico peso/cintura) e **5.5.14 "Não mostrar peso no app"** (coluna, gatilho `paciente_colunas`, filtro no módulo, o que não muda, exportação D6); §5.5.4 (offline) acrescenta a refeição aberta dentro de `/p/plano` e o `AbrirRefeicaoDaUrl`; §5.7 (interface) acrescenta os tokens do portal, `corDaFaixa` com a conta da spec, as fontes e o número medido na T2; §5.8 (manual guiado) acrescenta o `portal-novidades` e a regra 1. O §5.5.8 deixa de falar das 7 abas.
- `docs/manual-tecnico/11-exames-enviados.md`: "onde fica no portal" — a seção Exames (condicional, RN-192), o "Enviar exame" da barra de ações e o item do mural.
- `docs/manual-tecnico/06-worker-seguranca-operacao.md` §6.8.1 (voltar atrás): o aviso do passo 7 do runbook — depois do Plano 16, a imagem anterior mostra peso e IMC a quem tem "Não mostrar peso no app" ligado; listar e avisar as nutricionistas (com o OK do dono) ou corrigir para a frente.
- `docs/manual-tecnico/README.md`: o Plano 16 no índice dos capítulos e as divergências spec × código (Desvios 1 a 16 deste plano).
- Spec G: status "**Implementado no Plano 16**" com a data do merge e as respostas do dono a G-D5…G-D12 (as recomendações, se ele não mudou nada); a spec do MVP (histórias, E5): a tabela "Textos de interface" ganha os textos de `MSG_MURAL`, `MSG_JORNADA`, `MSG_G`, `MSG_PESO_OCULTO`, `MSG_COMI_ASSIM`, `AVISO_PORTAL` e do guia.
- Índice dos planos: a linha do **Plano 16** ("App do paciente no layout G verde", G-01 e G-02, spec G v0.1, status) entre o 13 e o 14, com o registro do processo da execução.
- Backlog: G-01 e G-02 → P16-01 a P16-16 concluídos; os Minors da revisão e os "Pontos menores" abaixo.
- **Manual do usuário (Docs):** o `guardiao-manual` atualiza as páginas do portal do paciente (cinco seções, mural, respostas, Jornada) e a da nutricionista (a caixa "Não mostrar peso no app" e os rótulos no feed do diário) — no conector de Docs do dono, no fechamento (memória "Post-MVP roadmap + manuals").

- [ ] **Step 7: O runbook**

Criar `docs/operacao/app-paciente.md` com o conteúdo de "Runbook do dono" (abaixo), na forma de passos com caixa de seleção. **Sem SQL ad hoc em produção** (correção da revisão do plano): `diary_entries`, `meal_plans` e `patients` têm RLS forçada — com o `nutri_app` e sem `app.tenant_id` a consulta devolve 0 (lido como "meta não atingida"), e com superusuário leria dado de saúde de todos os consultórios fora do modelo da regra 1. O runbook registra a definição da medida e as duas condições antes de medir:

- **Definição do CS-191 (G-D12 ★, G-D15 ★):** paciente ativo, não anonimizado, com plano publicado no início da janela, que registrou **≥ 3 respostas** ("Comi assim", "Comi outra coisa" ou foto) **em cada uma das 4 semanas ISO** depois do deploy, no fuso do tenant (a v0.1 contava quem chegou a 3 em **qualquer** semana — `filter (where s.n >= 3)` — o que não é a meta). A alternativa "média ≥ 3 por semana nas 4 semanas" fica para o dono escolher na G-D15.
- **Como medir:** por uma função agregada `SECURITY DEFINER` no molde de `drizzle/0087_metricas_sucesso_admin.sql` (`search_path` fixo, entra tenant a tenant com `set_config`, recusa rodar dentro de `withTenant`, devolve **só contagens** por tenant — `base` e `com_meta` —, nenhuma linha de saúde), chamada pelo admin ou pelo runbook. A função **não** entra neste plano: vira o item **P16-17** do backlog (migration + teste com duas semanas cheias e uma com 2 respostas), feito só depois da G-D15 ★.
- **Quem pode ser medido (G-D15 ★, LGPD art. 39; DPA `0.1-provisorio`, `src/modules/plataforma/dpa.ts:14`: a operadora trata os dados "segundo as instruções da controladora … nem usado para outra finalidade"):** até o DPA definitivo (E-09) ter uma cláusula de estatística de uso agregada, sem dado de saúde no resultado, medir **só no consultório da Debby**, com o pedido dela registrado como instrução da controladora; ou trocar a métrica por uma que não leia tabela de saúde (por exemplo, abertura de Hoje em `access_events`, que já é a base do CS-02).

- [ ] **Step 8: Verificação completa e commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e
```

Expected: tudo verde; o `fontes-portal.spec.ts` imprime o total de `woff2` (anotar no PR e no §5.7); o job `image` do CI dentro de **265 MB** (anotar).

```bash
git add e2e/ test/carga/cenario.js docs/
git commit -m "$(cat <<'MSG'
test(e2e)+docs: fechamento do Plano 16 — app do paciente no layout G (P16-16)

E2E do mural, do Comi assim com Desfazer, do envio ao sair, do peso oculto
(nenhuma resposta do servidor com peso ou IMC), do offline da refeição e o
"nada some" da §4.10; axe da refeição aberta, do tour, do foco sobre a
faixa e de 320 px com o texto em 200%. Carga com a Jornada; manual técnico
(caps. 05 e 11), runbook, índice, backlog e o status da spec G.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th
MSG
)"
```

## Runbook do dono (Plano 16 — app do paciente G)

Nenhum passo é do código; cada um tem dono. O layout entra **para todos** os pacientes no deploy (G-D11 ★ = a).

1. **Antes de executar o plano.** O Plano 13 já está na `main` (G-D2). O dono responde às pendências **G-D5 a G-D12 ★** (ou confirma as recomendações, que o plano já aplica): D4/G-D5 (desfazer de 10 s), D5/G-D6 (peso e IMC), D7/G-D7 (escurecer a cor só na faixa), D15/G-D8 (Conteúdos em Plano), D11/G-D9 (Exames some), D17/G-D10 (a Debby revisa os textos), D16/G-D11 (para todos), D18/G-D12 (meta do CS-191) — e a **D6 ★** (revista: a opção de peso vai na exportação dos dois escopos até o parecer do advogado, E-09) e as novas **G-D13 a G-D17 ★** (em "Decisões do dono (★) da revisão do plano", no topo do plano).
2. **Textos (G-D10 ★).** A Debby lê, no ambiente de teste, o mural (refeição, comentário, exames, consulta, novidades, rodapé "Seus registros do diário ficam visíveis para sua nutricionista…", que substitui o "Este app não envia mensagens…" da spec v0.1), a refeição aberta, a Jornada, a ajuda da caixa "Não mostrar peso no app", o texto de Privacidade (RN-214) e os 5 passos do tour. Correção de texto = trocar a constante (e o teste que a cita) **antes** do merge; nenhum texto do sistema pode falar pela nutricionista (RN-194).
3. **Teste no consultório (Debby, com dado fictício).** Com uma conta de paciente de teste no celular dela: abrir Hoje perto de uma refeição do plano, "Comi assim" e "Desfazer", "Comi outra coisa" com texto, "Mandar foto do prato"; conferir no painel o feed do diário ("Comeu como no plano"); ligar "Não mostrar peso no app" e conferir que o app não mostra peso nem IMC em lugar nenhum; desligar. Conferir no modo escuro e com a fonte do celular no máximo.
4. **Antes do merge (merge = deploy).** Snapshot da VPS no hPanel; OK explícito do dono no PR; conferir no PR o job `image` (≤ 265 MB) e o total de `woff2` (≤ 160 KB).
5. **Depois do deploy.** O manifest do PWA não muda (`id`/`start_url` = `/p/inicio`): quem já instalou continua com o mesmo app; o service worker renova a cópia do plano pelo `x-nd-build`. Avisar os pacientes, se a Debby quiser, de que o app mudou (o próprio app mostra o aviso uma vez).
6. **4 semanas depois (CS-191, CS-192, PM-G11).** **Antes de medir** (correção da revisão do plano): a G-D15 ★ respondida (definição da meta e de quem pode ser medido) e a função agregada do P16-17 em produção — nunca SQL ad hoc nas tabelas de saúde, nunca medida entre consultórios sem a cláusula do DPA definitivo (E-09) ou o pedido registrado da nutricionista (LGPD art. 39). Depois, o controlador, com o OK do dono, chama a função (respostas por semana, só contagens) e lê o acesso diário pela `admin_metricas_sucesso` (CS-192) e o crescimento de `audit_log`. Se o `audit_log` pesar, propor o agrupamento por dia (como `access_events`) num plano novo.
7. **Voltar atrás (imagem anterior) depois do Plano 16** (correção da revisão do plano): a coluna `peso_oculto_no_app_em` continua no banco (migration só aditiva), mas o portal antigo **não a lê** e volta a mostrar peso e IMC aos pacientes com "Não mostrar peso no app" ligado — o dano que a G-02 existe para evitar. Antes de qualquer volta atrás, com o OK do dono: contar (função agregada ou o painel de cada nutricionista, nunca SQL ad hoc) os pacientes com a opção ligada e avisar as nutricionistas, ou **preferir corrigir para a frente**. Na janela start-first do deploy, a instância antiga ignora a opção por segundos (aceito).
8. **Backup no host (P02-11) — continua pendente.** Lembrete: nada do Plano 16 muda o backup, mas os dados reais dos pacientes só devem crescer com ele ligado.

## Checagem final (antes do PR)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes; `pnpm test:e2e` com `app-paciente.spec.ts`, `nada-some.spec.ts`, `fontes-portal.spec.ts`, `acessibilidade.spec.ts`, `portal.spec.ts`, `pacientes.spec.ts`, `exames-enviados.spec.ts`, `sair.spec.ts`, `sessao-portal.spec.ts` e `csp.spec.ts` verdes.
- [ ] Guardas: `src/db/rls-guard.test.ts`, `src/db/audit-guard.test.ts`, `test/isolamento.test.ts`, `src/db/paciente-escrita.test.ts`, `src/app/api/mesma-origem-rotas.test.ts`, `src/app/formularios-post.test.ts`, `src/app/painel/acoes-de-paciente.test.ts`, `src/app/painel/cores.test.ts`, `src/app/painel/rotas-axe.test.ts`, `src/lib/tema/tema.test.ts`, `src/app/p/navegacao.test.ts` (toda rota marca uma seção), `src/app/sw-regras.test.ts` (sem mudança, RNF-197 e), `src/modules/ajuda/conteudo.test.ts`.
- [ ] `git grep -n "peso_oculto_no_app_em\|pesoOcultoNoAppEm"` só em: schema, migration, `peso-oculto.ts`, `exportacao-job.ts`, a aba Evolução do painel, testes e docs (nenhum componente do portal lê a coluna: o filtro é no módulo).
- [ ] `git grep -n "Sua nutricionista" src/modules/portal src/app/p src/components/portal` — cada ocorrência é texto dela (comentário, orientação, observação) ou cita a profissional em 3ª pessoa, nunca fala por ela (RN-194).
- [ ] Nenhum `logger.` novo com texto do diário, nome de refeição, medida ou nome de paciente (RNF-196).
- [ ] O número da migration confere com a `main` depois do Plano 13 (0106+); a migration não tem `DROP COLUMN`, dado nem `DISABLE TRIGGER`.
- [ ] CLAUDE.md (regra 1), manual técnico (caps. 05 e 11 + README), runbook em `docs/operacao/`, índice, backlog, spec G e spec do MVP (textos do E5) atualizados.
- [ ] Revisão final do branch (workflow) com uma onda de correções → `/code-review high` uma vez → correções Critical/Important → re-revisão do diff → `/security-review` (checklist: peso oculto que não chega ao aparelho, resposta só à refeição do próprio plano publicado, idempotência e limite com o paciente travado, `user.guia` só pela sessão do próprio paciente, autoria no mural). Lembrar o dono do backup no host (P02-11).

## Riscos e pendências que ficam

| # | Risco / pendência | Onde está tratado | O que falta |
|---|---|---|---|
| R1 | Plano 13 muda arquivos do portal (parecer em "Meus documentos", US-148) ou a numeração das migrations (R-199) | Step 0 da T1 (rebase, renumerar, conferir a §1.3); o teste "toda rota marca uma seção" (T3) quebra se o Plano 13 criou página em `/p/` sem seção | Rodar o Step 0 só depois do merge do Plano 13 |
| R2 | O paciente toma o mural por chat (R-190) ou lê o lembrete como orientação (R-191) | RN-193 (rodapé), RN-194 (autoria, teste da T5), textos com a Debby (G-D10 ★) | Observar as primeiras semanas (a Debby diz se alguém respondeu "pelo app") |
| R3 | Paciente com o peso oculto descobre o número na exportação ou num documento (R-193) | RN-214 (texto genérico em Privacidade), ajuda da caixa avisa a nutricionista, D6 ★ | Decisão clínica dela; o advogado confirma na revisão do Termo (E-09) que o termo não precisa de versão nova (spec §10) |
| R4 | `woff2` acima de 160 KB ou a imagem acima de 265 MB | D9 (variável), medida na T2 e no CI | Se passar, o dono decide (sem apagar nada às cegas) |
| R5 | `audit_log` cresce com 3–4 "Visualizou" por abertura de Hoje (R-197) | Uma linha por entidade (RN-200); medida na carga e no runbook (passo 6) | Agrupar por dia, se pesar (plano novo) |
| R6 | Resumo da refeição com nomes da TACO cheios de vírgulas ("arroz, integral, cozido, feijão…") fica confuso no mural (Desvio 8) | Texto com a Debby (G-D10 ★) | Se confundir: separador "·" entre itens, ou o nome curto da medida — troca em `resumoDaRefeicao` |
| R7 | "Comi assim" com foto e cota esgotada recusa tudo (como a foto sem texto do diário hoje) | Mesmo comportamento do diário (R9 do Plano 06) | Se a Debby quiser, gravar a resposta sem a foto (backlog) |
| R8 | A equipe pode alterar `resposta`/`texto` de um registro do diário (nenhum gatilho impede; hoje só o código) | Fora do escopo da spec (o paciente não edita, P06 D11) | Avaliar um gatilho de imutabilidade do conteúdo do paciente no diário (SBIS, integridade) — backlog |
| R9 | Fechar o app pelo gerenciador de tarefas dentro dos 10 s pode perder o envio (o `pagehide` nem sempre dispara no iOS) | `keepalive` no `pagehide` e no desmontar (RN-198) | Aceito: o paciente vê o registro faltando no mural e toca de novo; se a Debby preferir, G-D5 = (a) |

## Autoconferência do plano (writing-plans)

- **Cobertura da spec:** a tabela "Cobertura da spec v0.1" liga cada US, RN, RNF, CS e PM a uma tarefa; §9 na T1, §10 na T15, §11 nas Global Constraints e nas tarefas de banco, §4.10 na T16.
- **Sem lacunas de código:** cada passo de código traz o código ou o trecho exato a trocar; os passos de documentação dizem a seção e o que entra.
- **Nomes consistentes:** os contratos do topo são os usados nas tarefas (`corDaFaixa`, `secoesDoPortal`, `itemAtual`, `temEnvioVisivel`, `comporMural`, `muralDoPaciente`, `conteudosNovosNaTransacao`, `novosNoPortalNaTransacao`, `registrarNoDiario` com `refeicaoId`/`resposta`, `respostasDeHoje`, `definirPesoOculto`, `pesoOcultoNaTransacao`, `semPeso`, `montarJornada`, `miniJornada`, `jornadaDoPaciente`, `miniJornadaDoPaciente`, `ComiAssim`, `molduraDaSecao`, `GUIA_PORTAL`, `marcarGuiaPortalAction`); os nomes do código existente foram conferidos na `main` @ `19fcea5` (`requirePaciente`, `pacienteDaSessao`, `planoDoPaciente`, `lerPlanoNaTransacao`, `listarConsultasNaTransacao`, `STATUS_ATIVOS`, `podeAlterarPeloPaciente`, `situacaoParaPaciente`, `nomeDoEnvio`, `paraRegistro`, `feedDeDiarios`, `abrirRegistro`, `listarAntropometrias`, `orientacoesDoPaciente`, `seriesDasAvaliacoes`, `formatarDiferenca`, `carregarPacienteParaEscrita`, `getTenantBrand`, `corNoEscuro`, `contraste`, `misturar`, `TOKENS`, `marcarGuia`, `lerGuia`, `precisaDoGuia`, `aplicarMarca`, `Tour`, `GraficoLinha`, `QuandoLocal`, `SeloOffline`, `SairPortal`, `AtivarNotificacoes`, `Instalar`, `confirmarAction`, `montarDados`, `anonimizarVencidos`, `envioNoBanco`, `consultaDireta`, `novoConteudo`, `pacienteNoPortal`, `avaliar`, `entradasDoPlano`, `MAX_CONSULTAS_FUTURAS_PUBLICO`).
- **Verificação do código puro deste plano:** os módulos sem banco (`datas-portal`, `mural-regras`, `jornada-regras`, `diario-constantes`, `comi-assim-estado`, `cartoes-dispensados`, `navegacao`, `GUIA_PORTAL`) e os componentes testados por `renderToStaticMarkup` (moldura, mural, Hoje, refeição aberta, Jornada, "Todas as medidas", Eu) foram rodados com o Vitest numa cópia de trabalho em 08/10/2026, sem commit (53 casos verdes depois dos ajustes), com o `tsc` (inclusive `mural.ts`, `jornada.ts`, `peso-oculto.ts` e os testes de banco, só a compilação), o `eslint` e a guarda `cores.test.ts` — os testes foram corrigidos para o que o código real faz (SSR com a sigla do fuso, `<link rel="preload">` do React 19, o `PatientRow` literal de `valores.test.ts`, o `react/display-name`). Os testes com banco (Testcontainers) e os E2E rodam na execução.
- **Review Focus:** cada linha tem os testes nas tarefas indicadas.

## Pontos menores (backlog do Plano 16)

- **Gráfico com o tracejado até a próxima consulta** (Desvio 11): prop nova do `GraficoLinha`, se a Debby quiser.
- **Imutabilidade do conteúdo do paciente no diário** (R8): gatilho que impede a equipe de mudar `texto`, `resposta` e `refeicao_do_plano` (só a LGPD remove a foto).
- **Resposta sem a foto com a cota esgotada** (R7).
- **"Próxima refeição" sem horário no plano antigo:** a correção de `proximaRefeicao` (T11) muda também o destaque de quem tinha refeição sem horário — conferir com a Debby se algum plano real dependia disso.
- **`useOnline` com o ping do `SeloOffline`** (revisão do plano, achado 12): com a rede que não responde, o selo diz "Offline" e o "Comi assim" fica habilitado até o envio falhar em 10 s; pôr o estado do ping num store que o `useOnline` também leia.
- **"Próxima, daqui a {tempo}" e a refeição aberta na cópia offline** (achado 13): calculados no servidor, ficam congelados na cópia de até 30 dias; calcular no cliente a partir dos horários ou esconder a contagem com o selo offline.
- **Aviso "O app mudou" para quem nunca usou** (achado 14, G-D17 ★): boas-vindas para quem não tem `access_events` anteriores ao deploy.
- **Anel branco de 2 px em volta do foco (RN-207, Desvio 15):** `box-shadow` escopado em `[data-app='paciente']`, conferido pelo teste de contraste.
- **Nome do consultório nas telas de detalhe** (achado 18, RN-210): linha pequena (ou `sr-only`) no `CabecalhoDetalhe` quando `vinculos.length > 1`.
- **"Salvar" de "Não mostrar peso no app" sem retorno** (achado 19): `useActionState` com "Preferência salva." num `role="status"` sempre montado.
- **Gatilho que fixa `data_hora = now()` para o papel paciente em `diary_entries`** (achado 29, §11.3 da spec).
- **P16-17 — função agregada do CS-191** (achado 26, G-D15 ★): `SECURITY DEFINER` no molde da `0087_metricas_sucesso_admin.sql`, só contagens por tenant, com teste (semanas cheias × uma semana com 2 respostas); só depois da G-D15.
- **Nav "Seções" compacta nas telas de detalhe** (G-D13 ★ = b) e **atalhos da §4.10** (G-D14 ★ = b), se o dono escolher.

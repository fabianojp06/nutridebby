# Plano 07 — Biblioteca de conteúdo (M6): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ENTREGUE:** PR #10 mesclado em `3a1c6a4` e em produção desde 04/10/2026 (migrations 0081–0084; spec v1.10). Ver "Resultado da entrega", no fim.

> **DECISÕES ★ APROVADAS pelo dono em 04/10/2026** (D1, D3, D4, D6, D7, D11, D13, D14, D21 — todas conforme a recomendação do plano). Escrito em 03/10/2026 a partir de `origin/main` @ `359e1bb` (Planos 01–06 em produção, spec v1.9). `/code-review high` do PR #10 feito em 04/10/2026: os 10 achados estão corrigidos no texto (audiência que não apaga alvo escondido, capa PNG com fundo branco, capa de vídeo trocado, gramas arredondadas antes de conferir, exceção da RN-12 só no caminho do plano — ajuste da D2 —, link sem esquema, exclusão sem arquivo órfão, publicado nunca vazio, métricas numa consulta, regra 8 do CLAUDE.md). Próximo passo: a execução; merge só com OK do dono. Nenhuma linha de código deste plano foi escrita ainda; nada foi rodado no banco.

**Goal:** A nutricionista publica vídeos (link do YouTube/Vimeo, capa baixada pelo oEmbed, player sem cookies), receitas com o valor nutricional por porção calculado da tabela de alimentos e orientações em texto formatado (+ PDF), escolhe quem vê cada conteúdo (todos, pacientes com uma etiqueta, pacientes específicos), sugere uma receita numa refeição do plano e vê quantos pacientes abriram cada conteúdo; o paciente navega pela aba "Conteúdos" do PWA (feed, busca, filtros, favoritos, selo "Novo") e recebe no máximo um aviso de conteúdo novo por dia — com o banco garantindo que conteúdo fora da audiência não aparece nem pela URL.

**Architecture:** Um módulo novo, `src/modules/conteudo` (vídeo e oEmbed, capa, markdown seguro, núcleo do conteúdo, audiência, receitas, aviso, métricas), as telas do painel em `src/app/painel/conteudos/…` e as do portal em `src/app/p/(portal)/conteudos/…` (lidas por `src/modules/portal/conteudos.ts`). Seis tabelas novas com RLS (`contents`, `recipes`, `recipe_ingredients`, `content_audience`, `content_views`, `content_favorites`) e a coluna `meals.recipe_content_id`. A audiência (RN-12) é avaliada **na leitura e no banco**: uma política RESTRICTIVE `paciente_conteudo_visivel` em `contents`, `recipes` e `recipe_ingredients` deixa a sessão de paciente ver só o conteúdo publicado da audiência dela — "pacientes" por subconsulta em `content_audience` (o paciente lê só as próprias linhas), "etiquetas" por uma função `SECURITY DEFINER` que responde só sim/não (a nota do Plano 03: `patient_tag_links` é `staff_only`) e a exceção da receita anexada ao plano publicado do próprio paciente — esta **só no caminho do plano** ("Meu plano" e a receita aberta pelo cartão ligam `app.receitas_do_plano` na própria transação; o feed, a busca, os filtros, o selo "Novo" e os favoritos nunca); o acesso direto pela URL dá 404 porque a linha não existe para ele. Visualizações e favoritos são as únicas escritas novas do paciente (`PACIENTE_ESCREVE`), conferidas também no banco (só de conteúdo visível). Capa e PDF entram por `salvarArquivo`/`apagarArquivo` (regra 9), servidos por `signFileUrl`; o markdown é um subconjunto próprio renderizado como elementos React (sem HTML). O aviso de conteúdo novo sai pelo motor de notificações (tipo `conteudo_novo`, canal push), inserido na transação da publicação, no máximo um por paciente a cada 24 h.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Route Handlers, Server Actions, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 (`ON DELETE SET NULL (coluna)`, `websearch_to_tsquery`) · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · `sharp` 0.35.4 (já instalado) · Vitest 5 + Testcontainers · Playwright 1.63 + `@axe-core/playwright` 4.13.0 (já instalado). **Nenhuma dependência nova.**

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.9: §2.1 M6, §4.1 regras de acesso, §6 INT-03 e INT-05, §7 `contents`/`recipes`/`recipe_ingredients`/`content_audience`/`content_views`/`content_favorites`/`meals.recipe_content_id`/`stored_files`, §8 RN-08, RN-10, RN-11, RN-12, RN-18, §5 RNF-06 a RNF-11, §11 P-07) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md) (US-050 a US-056; US-018, US-019 e US-041 nas partes que o conteúdo usa). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P07-01 a P07-08; débitos P04-10 e P06-12 da mesma área).

## Global Constraints

- Tudo dos Planos 01–06 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na entrada de toda página e Server Action da nutricionista (é a **primeira** linha: a guarda `acoes-de-paciente.test.ts` chama toda ação do painel com sessão de paciente) e `requireApiNutri` nos Route Handlers dela; `requirePaciente`/`requireApiPaciente` em todo o portal; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500). Toda página nova de `src/app/painel/**` renderiza `<Cabecalho` (guarda `cabecalho.test.ts`).
- **Base:** `origin/main` em `359e1bb` (Plano 06 em produção, migrations até `0080`). As migrations deste plano começam em **`0081`**: `0081_conteudos` (gerada, T1), `0082_rls_conteudos` (custom, T1), `0083_audiencia_conteudos` (custom, T2), `0084_conteudo_novo` (gerada, T10). O número exato é o que o `drizzle-kit` gerar; se outra migration entrar na `main` antes (ex.: o PR de débitos), renumerar no rebase e corrigir as referências deste plano no PR. Migrations só com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7); **nunca** no banco de dev compartilhado sem combinar, nunca em produção fora do deploy.
- Toda tabela nova com `tenant_id`: `app_enable_tenant_rls`; com `patient_id`, `app_enable_patient_rls`; dado de saúde, `app_enable_audit` + `ENTIDADE_ROTULO`, ou entrada justificada em `AUDIT_EXCEPTIONS`; fábrica em `FABRICAS` de `test/isolamento.test.ts` (mães com FK para elas em `ULTIMAS`). CLAUDE.md regras 1, 2, 8 e 9.
- **Escrita do paciente (D1 do Plano 06):** as únicas escritas novas da sessão de paciente são `content_views` (`insert`) e `content_favorites` (`insert`, `delete`), cada uma com `SELECT app_allow_paciente_escrita(...)` na migration **e** a entrada em `PACIENTE_ESCREVE`, na mesma tarefa (T1). `contents`, `recipes`, `recipe_ingredients` e `content_audience` ficam fechadas ao paciente.
- **Audiência no banco (D2):** `contents`, `recipes` e `recipe_ingredients` têm a política RESTRICTIVE `paciente_conteudo_visivel` (FOR SELECT) e entram em `CONTEUDO_POR_AUDIENCIA` (`src/db/rls-guard.ts`); a guarda `findConteudoAudienciaViolations` quebra o CI se faltar. Nenhum código do portal filtra a audiência "à mão": quem decide é a RLS; o código do portal só lê `status = 'publicado'` por clareza. A exceção da RN-12 (receita do plano publicado) só existe na transação que chamou `liberarReceitasDoPlano` — "Meu plano" e a receita aberta pelo cartão; nunca o feed (guarda na T7).
- **Uma conexão por transação** (Plano 05): dentro do callback de `withTenant` só o `tx` recebido. Chamadas de rede (oEmbed) **nunca** dentro de transação: antes ou depois dela.
- **Arquivos (regra 9):** capa (`tipo: 'capa'`, JPEG convertido) e PDF da orientação (`tipo: 'orientacao_pdf'`) só por `salvarArquivo` (o `registrar` grava o ponteiro em `contents` na mesma transação) e `apagarArquivo` (o `naMesmaTransacao` confere/apaga o registro); servir só por `signFileUrl`. Nunca montar caminho com texto do usuário.
- **Terceiros (INT-05, RN-10):** o portal nunca carrega imagem de terceiros (a capa do vídeo é baixada para `/data`); o player é `https://www.youtube-nocookie.com/embed/<id>` ou `https://player.vimeo.com/video/<id>?dnt=1`; o servidor só fala com `www.youtube.com/oembed`, `vimeo.com/api/oembed.json`, `i.ytimg.com` e `i.vimeocdn.com` (prazo total de 5 s, sem redirecionamento, corpo limitado).
- RNF-11 / CLAUDE.md regra 3: nada de título, texto, nome de paciente, link de vídeo, caminho de arquivo ou corpo de resposta do oEmbed em log/Sentry; logs só com ids, tipo, provedor e o nome do erro.
- Textos de interface em pt-BR, com o texto exato da spec quando existir: "Use um link do YouTube ou do Vimeo", "Vídeos não listados podem ser vistos por quem tiver o link." (com ponto, como a RN-10 — desvio), "A porção não pode ser maior que o rendimento", "Baixar material (PDF)", "Avisar pacientes", "Sugestão de receita", "Receita indisponível", "Conteúdos", "Vídeos", "Receitas", "Orientações", "Novo", "Favoritos", "{vistos} de {audiência} pacientes ({pct}%)", "Espaço de armazenamento esgotado. Fale com o suporte.". Textos novos estão na tabela de desvios (última linha).
- Acessibilidade (RNF-10, padrão dos Planos 02–06): `<label for>`, `fieldset`/`legend`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso com `role="status"`, alvo de toque ≥ 44 px no PWA, iframe com `title`; a Tarefa 13 roda o axe nas telas novas do PWA (zero violação WCAG 2.1 AA) e a 360 px sem rolagem horizontal.
- Custo zero na assinatura: nenhuma dependência nova, nenhum serviço pago (o oEmbed do YouTube e do Vimeo é gratuito e sem chave). Bunny Stream continua na Fase 2 (P-07).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos. Nenhuma variável nova. Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes.
- Política de revisão por entrega (índice, revista em 02/10/2026): revisor por tarefa → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` (com o checklist reforçado do fechamento, se o dono aceitar a D21). Se sobrar problema Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais.

### Decisões de desenho (tomadas neste plano — o dono confirmou as marcadas com ★ em 04/10/2026)

| # | Tema | Decisão (aplicada no plano) | Custo / consequência · se o dono escolher outra |
|---|---|---|---|
| D1 ★ ✅ aprovada 04/10 | Duas "etiquetas" (US-053 × US-055) | **São coisas diferentes.** Audiência "etiquetas" = etiquetas **de paciente** (`patient_tags`, US-019, que o paciente nunca vê), gravadas em `content_audience.tag_id`. Filtro do feed "sem lactose" = rótulos **do conteúdo** (`contents.etiquetas text[]`, texto livre, visíveis ao paciente). A US-053 escreve `visibilidade "etiquetas" = ["gestante"]`: "gestante" é a etiqueta de paciente | Nenhum custo extra. Alternativa: um campo só (rótulo do conteúdo casando com o nome da etiqueta do paciente) — o filtro do feed passaria a mostrar ao paciente nomes como "gestante"/"diabetes", contra a US-019 ("Paciente não vê etiquetas") |
| D2 | Audiência na leitura (RN-12) | No banco: política RESTRICTIVE `paciente_conteudo_visivel` (FOR SELECT) em `contents` — `status = 'publicado'` **e** (`todos` · ou `pacientes` com linha do próprio paciente em `content_audience` · ou `etiquetas` por `app_conteudo_por_etiqueta(id)` (SECURITY DEFINER, devolve só sim/não, paciente `ativo`) · ou receita anexada a refeição de plano **publicado** do próprio paciente **só com `app.receitas_do_plano = 'on'` na transação** — ligada por `liberarReceitasDoPlano(tx)` apenas em "Meu plano" e na receita aberta pelo cartão (`?de=plano`); o feed, a busca, o filtro de etiquetas, o selo "Novo" e os favoritos seguem só a audiência — ajuste do `/code-review high`, achado 5); `recipes` e `recipe_ingredients` herdam por `EXISTS` em `contents`. `content_views`/`content_favorites` só aceitam conteúdo visível **pela audiência** (RESTRICTIVE FOR INSERT, nunca com a liberação do plano ligada). Guarda `CONTEUDO_POR_AUDIENCIA` | A função roda por linha só nos conteúdos "etiquetas" do feed (dezenas por tenant): entra no k6 do P08-03. Fora da sessão de paciente (push, métricas) a audiência é a condição SQL `naAudiencia` sobre `patients`, rodando como equipe |
| D3 ★ ✅ aprovada 04/10 | Barra de abas cheia (R16: 7 colunas em 360 px) | **"Conteúdos" entra no lugar de "Compras"**; a "Lista de compras" vira link na página "Plano" (é derivada do plano), `/p/compras` continua igual e marca a aba "Plano". Ordem: Início, Plano, Diário, Conteúdos, Evolução, Agenda, Perfil | Mantém a grade de 7 (D23 do Plano 06: "o layout não muda"). Alternativas: 8 colunas (≈ 45 px por aba em 360 px; "Conteúdos" quebra em duas linhas e o axe/360 px precisa de nova conferência) ou um item "Mais" (uma tela a mais) |
| D4 ★ ✅ aprovada 04/10 | Texto do push de conteúdo novo (US-053 pede "Novo conteúdo: <título>") | **Texto neutro** "Sua nutricionista publicou um novo conteúdo" (título "NutriDebby"), o toque abre `/p/conteudos` (onde os novos têm o selo "Novo") — como D8/D19/D24 do Plano 06: o título de um conteúdo dirigido por etiqueta ("Cardápio para gestantes") diria na tela de bloqueio uma condição de saúde | Se o dono preferir o texto da spec, o push passa a levar o título (tipo de push com texto variável — o motor hoje só tem textos fixos por tipo) e a abrir o próprio conteúdo |
| D5 | Regras do aviso (US-053) | Tipo `conteudo_novo` pelo motor do Plano 05 (canal `push`, sem consulta); só paciente `ativo`, não anonimizado, com conta no portal, **com push ativo** (alguma inscrição em `push_subscriptions` no consultório — decisão do dono, 04/10/2026: quem não tem inscrição não é avisado nem entra em "Aviso enviado para {n} pacientes.") e na audiência **no momento da publicação**; **no máximo 1 a cada 24 h por paciente** (sem linha `conteudo_novo` criada nas 24 h anteriores — os outros conteúdos ficam no feed com "Novo"); publicado no horário silencioso (21h–8h no fuso do tenant) sai às 08:00. Sem e-mail. Tudo num `INSERT … SELECT` na transação da publicação | Tenant suspenso: o motor já ignora (RN-15). Audiência grande = uma instrução só |
| D6 ★ ✅ aprovada 04/10 | Auditoria (regra 8) | `content_audience` **com gatilho** (entidade `conteudos`, rótulo "Público de conteúdo": escolher pacientes para um conteúdo é decisão clínica); `content_views` e `content_favorites` em `AUDIT_EXCEPTIONS` (registro de uso, como `access_events`); a leitura do conteúdo pelo paciente e a lista "Quem viu" da nutricionista **sem** `auditRead` (não é prontuário; como a agenda, D10 do Plano 05, e a lista de pacientes) | Alternativa: auditar visualizações e favoritos — uma linha "Criou · Conteúdos" com o nome do paciente no "Histórico de acessos" a cada conteúdo aberto |
| D7 ★ ✅ aprovada 04/10 | Markdown "sem HTML ou script executável" (US-052) | **Subconjunto próprio**, sem dependência: parágrafos, quebras de linha, `**negrito**`, `*itálico*`, títulos `##`/`###`, listas `-`/`1.` e links `[texto](https://…)` (só http/https, `rel="noopener noreferrer nofollow"`, nova aba). Renderizado como elementos React (nunca `dangerouslySetInnerHTML`): HTML digitado aparece como texto. Quantificadores limitados (sem retrocesso catastrófico) | Alternativa: `marked` + `sanitize-html` (duas dependências, HTML real, mais superfície para a revisão de segurança do P08-05) |
| D8 | "Uma imagem" da orientação (US-052) e capas | A imagem da orientação é a **capa** do conteúdo (como a da receita: JPEG/PNG ≤ 5 MB, US-051); não há imagem dentro do texto. Toda capa é convertida para JPEG ≤ 1280 px, qualidade 80, sem EXIF, transparência sobre fundo branco (`processarCapa`, `sharp`, o mesmo pipeline da foto do diário — `paraJpegSemMetadados` em `src/lib/jpeg.ts`, extraído do `paraJpeg` do Plano 06). A capa do vídeo vem só do oEmbed | Imagem no meio do texto seria upload + sintaxe nova no markdown (backlog, se pedirem) |
| D9 | oEmbed (INT-05) | Ao salvar o link (criar ou trocar), **depois** da transação: `GET` no oEmbed do provedor e na miniatura, prazo **total** de 5 s, JSON ≤ 64 KB, miniatura só de `https://i.ytimg.com` ou `https://i.vimeocdn.com`, sem seguir redirecionamento, ≤ 2 MB, tipo pelo conteúdo (JPEG/PNG/WebP), convertida pelo `processarCapa`. Qualquer falha → **capa padrão** (um bloco com o tipo do conteúdo, sem imagem) e o cadastro segue (US-050). Trocar o link de um vídeo apaga a capa antiga; a capa (ou a remoção) que chega depois do oEmbed só vale se o conteúdo **ainda** aponta para o mesmo vídeo — conferido na transação da troca (dois salvamentos sobrepostos não deixam a capa do vídeo anterior) | O servidor nunca busca URL digitada pela nutricionista (só a do provedor, montada com o id validado): sem SSRF |
| D10 | Player | YouTube `https://www.youtube-nocookie.com/embed/<id>`; Vimeo `https://player.vimeo.com/video/<id>?dnt=1` (com `h=<hash>` do vídeo não listado). `iframe` com `title`, `loading="lazy"`, `referrerPolicy="strict-origin-when-cross-origin"` (o YouTube recusa embed sem referrer), `allow="encrypted-media; picture-in-picture; fullscreen"`. O id é validado por regex no código **e** num CHECK do banco | A CSP global (P08-05) precisará de `frame-src https://www.youtube-nocookie.com https://player.vimeo.com` (anotado para o Plano 08) |
| D11 ★ ✅ aprovada 04/10 | Valores da receita (RN-11) | **Calculados na hora** a partir dos alimentos atuais (TACO ou "Meu alimento"), sem cópia congelada: corrigir um "Meu alimento" muda a receita publicada. Alimento sem valor na TACO conta 0 e a tela avisa "Sem valor na TACO" (RN-02) | Alternativa: congelar na publicação (como a D10 do Plano 04) — coluna de nutrientes por ingrediente e "republicar para atualizar" |
| D12 | Ingredientes | Quantidade em gramas (0,1 a 5000, a mesma regra do plano) + "medida caseira" em texto livre opcional (`medida_caseira_txt`, como a spec), até 50 ingredientes. `recipe_ingredients.food_id` com FK `RESTRICT` (como `meal_items`): alimento usado em receita não é excluído — a mensagem passa a ser "Este alimento está em um plano ou receita e não pode ser excluído." | O seletor de medidas do editor de plano fica para depois (backlog), se a Debby pedir |
| D13 ★ ✅ aprovada 04/10 | Receita na refeição (US-054) | Só no **rascunho** do plano (RN-01: o publicado é imutável — para sugerir no plano em uso, "Editar" cria a nova versão); anexar exige receita **publicada**; uma sugestão que ficou despublicada continua gravada e o editor mostra "Receita indisponível" (a nutricionista remove ou deixa); o portal só mostra o cartão se a receita estiver publicada (leitura viva). Modelos e "Editar" copiam a sugestão; ela **não** entra no total do plano nem no PDF. Excluir o conteúdo solta a sugestão (`ON DELETE SET NULL (recipe_content_id)`) | Alternativa: permitir anexar no plano publicado sem nova versão ("é só sugestão") — exceção à RN-01 e ao "Histórico" do plano |
| D14 ★ ✅ aprovada 04/10 | Métricas (US-056) | **Audiência atual**: denominador = pacientes `ativos` na audiência (com ou sem conta no portal, como a RN-12 define); numerador = quantos deles já abriram; arquivado/bloqueado sai das duas contas; quem abriu só pelo cartão do plano (fora da audiência) não conta. "Quem viu" lista nome e data, mais recentes primeiro. "1 de 1 paciente (100%)" no singular | Alternativa: denominador só com conta no portal (quem pode ver) — a porcentagem sobe para quem ainda tem pacientes sem convite aceito |
| D15 | LGPD do titular | Pedido de exclusão atendido (bloqueio) apaga do titular `content_views`, `content_favorites` e `content_audience` ("sai das audiências", "sem uso em conteúdo" — US-018, RNF-08); a anonimização apaga de novo (idempotente). Arquivar não apaga (desarquivado volta às audiências) — e salvar o conteúdo também não: `gravarAudiencia` só tira paciente que o formulário mostrou (ativo, entre os 500 da lista) e a nutricionista desmarcou. A exportação (equipe e titular) leva `conteudos`: títulos vistos (com a data) e favoritos | — |
| D16 | Rotas | Painel: `/painel/conteudos`, `/painel/conteudos/novo?tipo=video\|receita\|orientacao`, `/painel/conteudos/[id]`, `/painel/conteudos/[id]/visualizacoes`; `POST /api/painel/conteudos/[id]/capa` e `/pdf` (upload). Portal: `/p/conteudos` (`?tipo=`, `?busca=`, `?etiqueta=`, `?favoritos=1`), `/p/conteudos/[id]`; `GET /api/p/conteudos/[id]/pdf` (assina no clique). Nada disso fica offline (D6 do Plano 06: só "Meu plano") | — |
| D17 | Ciclo de vida | `rascunho` → "Publicar" → `publicado`; "Despublicar" volta a `rascunho` (some do feed na hora); publicar de novo renova `publicado_em` (volta ao topo; "Novo" para quem não abriu). O que a publicação exige (receita com ingrediente, orientação com texto ou PDF) vale também ao salvar e ao remover o PDF de um conteúdo **publicado** (nunca fica publicado vazio). Excluir (nutricionista, com confirmação) apaga capa e PDF (regra 9) e o conteúdo — o DELETE do conteúdo vai na transação do último arquivo | — |
| D18 | Visualização e favorito (US-055) | A visualização é registrada **no navegador**, ao abrir o detalhe (Server Action chamada pela página uma vez) — não no render do servidor, para a pré-busca do `next/link` não contar; uma por paciente (`ON CONFLICT DO NOTHING`); o favorito é um formulário (Server Action) "Favoritar"/"Remover dos favoritos" | — |
| D19 | Busca (US-055) | Full-text `portuguese` sobre `app_unaccent(titulo \|\| ' ' \|\| resumo)` (índice GIN, §7), com `websearch_to_tsquery`; filtro pela etiqueta do conteúdo com `etiquetas @> ARRAY[…]` (índice GIN). Feed com no máximo 100 itens, do mais recente para o mais antigo | Busca por pedaço de palavra ("ave") não acha "aveia": o full-text trabalha com palavras inteiras (stemming) |
| D20 | Tamanhos e a política `paciente_arquivos` | Capa ≤ 5 MB (US-051); PDF ≤ 10 MB (a spec só dá o exemplo de 2 MB). A política `paciente_arquivos` **não muda**: o portal assina o `pdf_path`/`capa_path` lido de `contents` (já filtrado pela audiência), nunca lê `stored_files` na sessão de paciente — a nota do backlog ("o `orientacao_pdf` precisa entrar na política quando o portal o servir") fica resolvida sem liberar o tipo para todo o tenant | — |
| D21 ★ ✅ aprovada 04/10 | `/security-review` do Plano 07 | **Com o checklist reforçado** (como os Planos 01, 02, 03, 05 e 06): o 07 traz escrita nova do paciente, uploads, HTML gerado de markdown, iframe de terceiros, chamada de rede do servidor e uma função `SECURITY DEFINER` dentro de política de RLS | Sem custo (assinatura). Alternativa: `/security-review` padrão |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano)

| Spec | Neste plano | Motivo |
|---|---|---|
| §7 `contents` | CHECKs a mais: `tipo`, `visibilidade`, `status` em listas; `publicado_em` só no publicado; título 1–120, resumo ≤ 300, `corpo_md` ≤ 20000, até 10 etiquetas de até 30; vídeo obrigatório no tipo `video`, `video_id` no formato do provedor; PDF só na orientação; capa/PDF do próprio tenant. `unique (tenant_id, id)` para as FKs compostas | Defesa em profundidade (D10) |
| §7 `recipes` / `recipe_ingredients` | `recipes` com chave `content_id` (1:1, sem `id` próprio); `recipe_ingredients.content_id` no lugar de `recipe_id`; `ordem`; quantidade 0,1–5000 g; até 50 por receita (código) | 1:1 com o conteúdo |
| §7 `content_audience` | `unique (content_id, patient_id)` e `unique (content_id, tag_id)`; FKs compostas com `ON DELETE CASCADE` para conteúdo e etiqueta | Sem linhas repetidas |
| §7 `meals.recipe_content_id` | FK composta `(tenant_id, recipe_content_id) → contents` com `ON DELETE SET NULL (recipe_content_id)` (só na migration: o Drizzle não gera a lista de colunas) | D13 |
| §7 `notifications.tipo` | `conteudo_novo` + índice parcial `(tenant_id, patient_id, created_at) WHERE tipo = 'conteudo_novo'` | D5 |
| RN-10 × US-050 | Aviso "Vídeos não listados podem ser vistos por quem tiver o link." **com ponto** (texto da RN-10; a US-050 não tem ponto) | Os textos do E5 terminam com ponto |
| US-050 "capa padrão" | Bloco com o tipo do conteúdo, sem imagem (D9) | Sem arquivo novo |
| US-052 "uma imagem" e "texto formatado" | A imagem é a capa (D8); markdown é um subconjunto (D7) | — |
| US-053 "Novo conteúdo: <título>" | "Sua nutricionista publicou um novo conteúdo" (D4) | Texto neutro (Plano 06) |
| US-054 | Só no rascunho; a sugestão despublicada fica gravada como "Receita indisponível"; cópia em modelos/"Editar"; fora do PDF (D13). A receita fora da audiência abre só pelo cartão (`?de=plano`): não entra no feed, na busca nem nos favoritos, e não conta visualização (D2, D14) | RN-01; RN-12 (a exceção é "anexada ao plano", não "na biblioteca") |
| US-055 "Registro de visualização" | Registrado pelo navegador ao abrir (D18) | Pré-busca do `next/link` |
| US-056 | Audiência atual; singular "1 de 1 paciente (100%)" (D14) | — |
| D23 do Plano 06 ("o layout não muda") | "Compras" sai da barra; "Lista de compras" vira link em "Plano" (D3) | R16 (7 abas em 360 px) |
| RN-11 | Sem cópia congelada dos valores (D11) | — |
| D3 / R16 (barra do portal em 7 colunas iguais) | **Ratificado pelo dono (04/10/2026):** `grid-cols-7` (7 colunas iguais) com `hyphens-auto` (pelo `lang="pt-BR"` do `<html>`) e `wrap-break-word` de reserva: a palavra que não cabe na coluna ("Conteúdos", "Evolução") quebra com hífen, e a barra nunca rola na horizontal, em nenhuma largura. O E2E confere 360 e 320 px (colunas iguais, nada vaza da coluna, alvo de 44 px de altura, axe) | Desvio 3 da Tarefa 7; achado A da revisão final; `/code-review` do PR #10 |
| Textos novos de interface | Painel: "Conteúdos", "Novo vídeo", "Nova receita", "Nova orientação", "Todos", "Título", "Tipo", "Situação", "Visualizações", "Rascunho", "Publicado", "Vídeo", "Receita", "Orientação", "Nenhum conteúdo ainda.", "Resumo", "Link do vídeo", "Texto", "Use **negrito**, *itálico*, listas com - e títulos com ##.", "Etiquetas do conteúdo", "Separe por vírgula. Ex.: sem lactose, café da manhã", "Quem vê", "Todos os pacientes", "Pacientes com etiqueta", "Pacientes específicos", "Etiquetas", "Pacientes", "Nenhuma etiqueta cadastrada.", "Criar", "Salvar", "Conteúdo salvo.", "Informe o título (até 120 caracteres).", "Use no máximo 300 caracteres no resumo.", "Texto muito longo (até 20000 caracteres).", "Use até 10 etiquetas de até 30 caracteres.", "Escolha quem vê este conteúdo.", "Escolha pelo menos uma etiqueta ou um paciente.", "Conteúdo não encontrado.", "Capa (JPEG ou PNG, até 5 MB)", "Enviar capa", "Remover capa", "Material em PDF (até 10 MB)", "Enviar PDF", "Remover PDF", "Enviando…", "Capa salva.", "PDF salvo.", "Envie uma imagem JPEG ou PNG de até 5 MB.", "Envie um PDF de até 10 MB.", "Outro envio está em andamento. Tente de novo em instantes.", "Publicar", "Despublicar", "Excluir conteúdo", "Excluir este conteúdo? A sugestão de receita sai dos planos.", "Conteúdo publicado.", "Conteúdo despublicado.", "Conteúdo excluído.", "Aviso enviado para {n} pacientes." / "Aviso enviado para 1 paciente.", "Preencha a receita (rendimento, porção e ingredientes) antes de publicar.", "Escreva o texto ou envie o PDF antes de publicar.", "Um conteúdo publicado precisa de texto ou PDF. Despublique antes de tirar os dois.", "Rendimento total (g)", "Porção (g)", "Tempo de preparo (min)", "Modo de preparo", "Ingredientes", "Adicionar ingrediente", "Gramas de {nome}", "Medida caseira de {nome} (opcional)", "Remover {nome}", "Por porção: {kcal} kcal · proteína {g} g · carboidrato {g} g · lipídio {g} g · fibra {g} g", "Salvar receita", "Receita salva.", "Informe o rendimento total em gramas (maior que 0).", "Informe a porção em gramas (maior que 0).", "Inclua pelo menos um ingrediente.", "A receita pode ter até 50 ingredientes.", "Tempo de preparo entre 1 e 1440 minutos.", "Texto muito longo (até 10000 caracteres).", "Medida caseira até 60 caracteres.", "Sugestão de receita em {refeição}", "Nenhuma", "Receita não encontrada.", "Ver quem viu", "Ver quem viu: {título}" (nome acessível do link da métrica), "Quem viu: {título}", "Ninguém abriu este conteúdo ainda.", "Voltar ao conteúdo", "Voltar aos conteúdos", "Publicado em {data}", "Filtrar conteúdos" (nome da navegação dos filtros), "Arquivos", "Ver PDF", "Não foi possível enviar. Tente de novo.", "Notificação de teste", "Comentário no diário", "Plano novo", "Conteúdo novo" (tipos na lista de envios da consulta, W-1), "Este alimento está em um plano ou receita e não pode ser excluído." · Portal: "Conteúdos", "Todos", "Favoritos", "Buscar", "Etiqueta", "Todas", "Nenhum conteúdo por aqui ainda.", "Nenhum conteúdo encontrado.", "Você ainda não favoritou nenhum conteúdo.", "Favoritar", "Remover dos favoritos", "Voltar aos conteúdos", "Voltar ao plano" (receita aberta pelo cartão, fora da audiência), "Rendimento: {g} g · Porção: {g} g", "Tempo de preparo: {n} min", "Por porção", "Sem valor na TACO", "Lista de compras" (link em "Plano"), "Sugestão de receita:" (rótulo do cartão em "Meu plano"), "Vídeo: {título}" (título do iframe) · Push: "Sua nutricionista publicou um novo conteúdo" · Exportação (`dados.json`): "Conteúdo indisponível" (visto/favoritado que não está mais publicado) | Telas novas |

### Itens adiados de planos anteriores e débitos da mesma área

**Incorporados** (a tarefa entre parênteses):
- Plano 04 (P04 `:60`, `:6069`): `meals.recipe_content_id` e `recipe_ingredients.food_id` com FK `RESTRICT`, reaproveitando `buscarAlimentos` e o cálculo RN-02 (Tarefas 1, 6 e 9).
- Plano 06 (US-041, desvio): o cartão "Sugestão de receita" no "Meu plano" (Tarefa 9).
- Plano 06 (D23 e nota do backlog): a aba "Conteúdos" em `ITENS_DO_PORTAL`; `content_views`/`content_favorites` em `PACIENTE_ESCREVE` (Tarefas 1 e 7); o PDF de orientação servido sem mexer em `paciente_arquivos` (D20, Tarefa 7).
- Plano 03 (`:9576`): audiência por etiqueta com função `SECURITY DEFINER` que responde só sim/não (Tarefa 2); (`:83`) arquivado/bloqueado sai das audiências (Tarefas 2, 10, 11 e 12).
- Plano 05: aviso pelo motor de notificações, horário silencioso (Tarefa 10).
- Débitos (triagem `pesquisa-debitos.md`, item b — só o que toca a mesma área): **B-5** a guarda de `PACIENTE_ESCREVE` confere a expressão da política (Tarefa 1); **S-9** `mesmaOrigem(req)` num lugar só, antes das rotas novas de upload (Tarefa 5); **T-4** `min-h-dvh` aninhado no layout do portal, que esta entrega mexe (Tarefa 7); **D04-2** inserts em lote no `salvarRascunho`, que a Tarefa 9 mexe (Tarefa 8); **D04-1** exportação sem N+1 nas versões do plano e **F-12** `lerLaudos` → `lerAnexos`, no arquivo que a Tarefa 12 mexe (Tarefa 12); **W-1/X-7** `TipoNotificacao`/`ROTULO_TIPO` com os tipos do portal, junto do tipo novo (Tarefa 10); **T-9** e **B-9** no fechamento (spec).

**Não incorporados** (motivo):
- B-4 (gatilho de colunas do paciente em `patients`/`data_exports`) e B-6 (`audit_log` sem SELECT do paciente): não tocam conteúdo; ficam no PR de débitos ou no P08-05.
- S-7/S-8/S-10/X-8 (sessão do portal), W-2..W-8, B-7 (push e service worker): o 07 não muda o service worker nem a inscrição; W-3 (agrupar também o `plano_novo`) muda um comportamento do Plano 06 — decisão do dono, fica no backlog.
- D04-3 (helper da trava paciente → plano em três arquivos): refatoração sem mudança de comportamento; fica no backlog (a Tarefa 8 mexe só no `salvarRascunho`).
- Os itens (a) da triagem (PR de débitos antes do go-live) e (c) (depois do MVP).

## Review Focus

1. **Conteúdo fora da audiência chegando ao paciente.** URL direta `/p/conteudos/<id>` de conteúdo de outro paciente, de outra etiqueta, em rascunho, despublicado ou de outro consultório (conta com 2 vínculos); `GET /api/p/conteudos/<id>/pdf` do mesmo; receita anexada a um plano **arquivado** ou em rascunho (não publicado); receita fora da audiência anexada ao plano publicado dela aparecendo no feed, na busca, no filtro de etiquetas ou com "Novo"; etiqueta tirada da paciente ou paciente arquivada; favoritar/registrar visualização de conteúdo invisível. Esperado: 404 (a linha não existe para ela), cartão sem a receita, a receita do plano só pelo cartão (`?de=plano`), o banco recusa a visualização/favorito (42501) e nada aparece no feed. Testes nas Tarefas 2, 7, 9 e 13.
2. **Link de vídeo estranho ou hostil.** `https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ`, `javascript:alert(1)`, `https://youtu.be/dQw4w9WgXcQ?t=30`, `youtube.com/shorts/<id>`, `m.youtube.com`, `http://`, sem esquema (`youtu.be/<id>`), Vimeo não listado `vimeo.com/123456789/abcdef1234`, id com 12 caracteres ou com `"`/`<`, link com usuário e senha; oEmbed que demora 6 s, responde 5 MB, redireciona, devolve `thumbnail_url` de outro host ou um SVG/HTML. Esperado: só YouTube/Vimeo com id válido ("Use um link do YouTube ou do Vimeo"), player sempre montado do id validado, capa padrão em qualquer falha do oEmbed, nenhum pedido a host fora da lista. Testes na Tarefa 3.
3. **Markdown hostil.** `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `[x](javascript:alert(1))`, `[x](data:text/html,…)`, `[x](//evil.com)`, `**` sem fechar, 20000 asteriscos seguidos, linha de 20000 caracteres. Esperado: tudo como texto, link só http/https com `rel`, render em menos de 200 ms, sem `dangerouslySetInnerHTML` no código. Testes na Tarefa 4.
4. **Receita com números na borda.** Porção igual ao rendimento (vale), porção maior ("A porção não pode ser maior que o rendimento"), zero, negativo, "250,5" (vírgula), alimento sem kcal na TACO (conta 0 e avisa), alimento de outro consultório (id que a RLS esconde), 51 ingredientes, "Meu alimento" corrigido depois de publicada (D11). Esperado: mensagens por campo, nenhum `NaN`, 2000 kcal / 1000 g / 250 g → 500 kcal. Testes na Tarefa 6.
5. **Aviso de conteúdo novo em massa ou repetido.** Três conteúdos publicados na mesma hora, publicar → despublicar → publicar, publicação às 22h, audiência com paciente sem conta, arquivado, bloqueado ou anonimizado, 500 pacientes na audiência, duas publicações simultâneas. Esperado: no máximo 1 `conteudo_novo` por paciente a cada 24 h, o das 22h agendado para as 08:00, só ativos com conta, uma instrução por publicação. Testes na Tarefa 10.

---

## Estrutura de arquivos

```
drizzle/
  0081_conteudos (gerada: 6 tabelas, meals.recipe_content_id) · 0082_rls_conteudos (custom: RLS, auditoria, escrita do paciente, FK da refeição)  # T1
  0083_audiencia_conteudos (custom: app_conteudo_por_etiqueta, paciente_conteudo_visivel, visto/favorito só de conteúdo visível)        # T2
  0084_conteudo_novo (gerada: tipo conteudo_novo, índice)                                                                                  # T10
src/db/schema/conteudo.ts (+ index.ts) · plano-alimentar.ts (meals) · agenda.ts (notifications)   # T1, T10
src/db/rls-guard.ts (+test) · audit-guard.ts · conteudo-schema.test.ts                           # T1 (PACIENTE_ESCREVE, B-5, AUDIT_EXCEPTIONS), T2 (CONTEUDO_POR_AUDIENCIA)
src/lib/mesma-origem.ts (+test)                                                                  # T5 (S-9) — e as 5 rotas que copiavam a conferência
src/modules/conteudo/
  constantes.ts · video.ts (+test) · oembed.ts (+test) · capa.ts (+test)                         # T3 (+ src/lib/jpeg.ts, usado também pela foto do diário)
  markdown.tsx (+test)                                                                           # T4
  audiencia.ts (+test)                                                                           # T2
  conteudos.ts (+test) · arquivos.ts (+test)                                                     # T5
  receita-calculo.ts (+test) · receitas.ts (+test)                                               # T6
  aviso.ts (+test)                                                                               # T10
  metricas.ts (+test)                                                                            # T11
src/modules/portal/conteudos.ts (+test) · plano.ts (+test)                                       # T7, T9
src/modules/plano-alimentar/{tipos,carregar,rascunho,constantes}.ts (+test)                      # T8, T9
src/modules/alimentos/alimentos-constantes.ts                                                    # T6 (D12)
src/modules/notificacoes/{mensagens,tipos}.ts (+test)                                            # T10
src/modules/plataforma/audit.ts                                                                  # T1 (rótulo "Público de conteúdo")
src/modules/pacientes/{lgpd,exportacao-job}.ts (+test)                                           # T12
src/components/player-video.tsx · capa-padrao.tsx · markdown (em src/modules/conteudo)           # T3, T7
src/app/painel/cabecalho.tsx                                                                     # T5 — "Conteúdos" no menu
src/app/painel/conteudos/
  page.tsx · novo/page.tsx · [id]/page.tsx · actions.ts · conteudo-form.tsx · arquivos.tsx · publicar-form.tsx   # T5 (T10: "Avisar pacientes"; T11: métricas)
  [id]/receita-form.tsx                                                                          # T6
  [id]/visualizacoes/page.tsx                                                                    # T11
src/app/api/painel/conteudos/[id]/{capa,pdf}/route.ts (+test)                                   # T5
src/app/painel/planos/editor/{estado,editor-plano}.tsx · pacientes/[id]/plano-alimentar/[planId]/page.tsx · planos/modelos/[id]/page.tsx   # T9
src/app/p/
  navegacao.ts (+test) · nav-portal.tsx · (portal)/layout.tsx                                    # T7 (D3, T-4)
  (portal)/conteudos/{page,actions,marcar-visto,favorito-form}.tsx · [id]/page.tsx               # T7
  (portal)/plano/page.tsx                                                                        # T7 (link da lista de compras), T9 (cartão)
src/app/api/p/conteudos/[id]/pdf/route.ts                                                        # T7
test/isolamento.test.ts · test/conteudos.ts                                                      # T1, T2
e2e/conteudos.spec.ts · e2e/acessibilidade.spec.ts                                               # T13
CLAUDE.md                                                                                        # T1 (regra 8: exceções da D6), T2 (regra 2: audiência), T5 (regra 9: capa/PDF)
```

**Ordem e dependências:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. As Tarefas 1 e 2 fecham o banco (tabelas, RLS e a audiência) antes de existir tela; 3 e 4 são peças sem banco (vídeo/oEmbed/capa, markdown); 5 é o painel do conteúdo; 6 a receita; 7 o portal; 8 e 9 o plano alimentar (débito D04-2 antes de mexer no `salvarRascunho`); 10 o aviso; 11 as métricas; 12 LGPD e exportação; 13 o E2E e o axe. As Tarefas 3 e 4 podem rodar em paralelo com a 2 (worktrees), e a 8 em paralelo com 5–7.

---
### Task 1: Tabelas de conteúdo, RLS de tenant/paciente, escrita do paciente e guardas (P07-01 a; débito B-5)

**Files:**
- Create: `src/db/schema/conteudo.ts`, `drizzle/0081_conteudos.sql` (gerada), `drizzle/0082_rls_conteudos.sql` (custom), `src/db/conteudo-schema.test.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/plano-alimentar.ts` (`meals.recipe_content_id`), `src/db/rls-guard.ts` (+ `rls-guard.test.ts`), `src/db/audit-guard.ts`, `src/modules/plataforma/audit.ts`, `test/isolamento.test.ts`, `CLAUDE.md` (regra 8: as exceções da D6)

**Interfaces:**
- Consumes: `app_enable_tenant_rls`, `app_enable_patient_rls`, `app_enable_audit`, `app_allow_paciente_escrita` (migrations 0000/0007/0070); `tenants`, `storedFiles` (`platform.ts`), `patients`, `patientTags` (`pacientes.ts`), `foods` (`alimentos.ts`); `PACIENTE_ESCREVE`, `findPacienteEscritaViolations` (`rls-guard.ts`).
- Produces:
  - `@/db/schema`: `contents`, `recipes`, `recipeIngredients`, `contentAudience`, `contentViews`, `contentFavorites` e os tipos `ContentRow`, `RecipeRow`, `RecipeIngredientRow`; `meals.recipeContentId` (`uuid | null`).
  - SQL: FK `meals_receita_fk (tenant_id, recipe_content_id) → contents (tenant_id, id) ON DELETE SET NULL (recipe_content_id)`.
  - `PACIENTE_ESCREVE.content_views = ['insert']`, `PACIENTE_ESCREVE.content_favorites = ['insert', 'delete']`; `AUDIT_EXCEPTIONS.content_views`/`content_favorites`; `ENTIDADE_ROTULO.conteudos = 'Público de conteúdo'`.
  - `findPacienteEscritaViolations` passa a exigir a expressão `app_current_role() IS DISTINCT FROM 'paciente'` (B-5).

- [ ] **Step 1: Teste do schema (falha)** — `src/db/conteudo-schema.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint?: string };
const restricao = (nome: string) => (e: unknown) => causa(e).constraint === nome;
const umId = (r: { rows: unknown[] }) => (r.rows[0] as { id: string }).id;

describe('tabelas de conteúdo (§7, Plano 07)', () => {
  it('CHECKs: vídeo sem id ou com id fora do formato, publicado sem data, porção maior que o rendimento, público sem alvo ou com os dois', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    await expect(q(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'video', 'Sem link')`)).rejects.toSatisfy(restricao('contents_video_completo'));
    await expect(
      q(sql`insert into contents (tenant_id, tipo, titulo, video_provider, video_id) values (${T.tenantId}, 'video', 'X', 'youtube', '"><script>x')`),
    ).rejects.toSatisfy(restricao('contents_video_id_valido'));
    await expect(q(sql`insert into contents (tenant_id, tipo, titulo, status) values (${T.tenantId}, 'orientacao', 'X', 'publicado')`)).rejects.toSatisfy(restricao('contents_publicado_em'));
    const id = umId(await q(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'receita', 'Panqueca de aveia') returning id`));
    await expect(q(sql`insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) values (${T.tenantId}, ${id}, 1000, 1200)`)).rejects.toSatisfy(restricao('recipes_porcao_valida'));
    await q(sql`insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) values (${T.tenantId}, ${id}, 1000, 1000)`); // porção = rendimento vale
    await expect(q(sql`insert into content_audience (tenant_id, content_id) values (${T.tenantId}, ${id})`)).rejects.toSatisfy(restricao('content_audience_um_alvo'));
    const tag = umId(await q(sql`insert into patient_tags (tenant_id, nome) values (${T.tenantId}, 'gestante') returning id`));
    await expect(
      q(sql`insert into content_audience (tenant_id, content_id, patient_id, tag_id) values (${T.tenantId}, ${id}, ${p.id}, ${tag})`),
    ).rejects.toSatisfy(restricao('content_audience_um_alvo'));
  });

  it('uma visualização e um favorito por paciente e conteúdo (US-055)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const q = (s: ReturnType<typeof sql>) => withTenant(T.ctx, (tx) => tx.execute(s), app.db);
    const id = umId(await q(sql`insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${T.tenantId}, 'orientacao', 'Rótulos', 'publicado', now()) returning id`));
    await q(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`);
    await expect(q(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`)).rejects.toSatisfy(restricao('content_views_unique'));
    await q(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`);
    await expect(q(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${id}, ${p.id})`)).rejects.toSatisfy(restricao('content_favorites_unique'));
  });

  it('D13: a refeição só aponta para receita do mesmo tenant; excluir o conteúdo solta a sugestão (SET NULL só na coluna)', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const deT = umId(await withTenant(T.ctx, (tx) => tx.execute(sql`insert into contents (tenant_id, tipo, titulo) values (${T.tenantId}, 'receita', 'Panqueca') returning id`), app.db));
    const deU = umId(await withTenant(U.ctx, (tx) => tx.execute(sql`insert into contents (tenant_id, tipo, titulo) values (${U.tenantId}, 'receita', 'Bolo') returning id`), app.db));
    const meal = crypto.randomUUID();
    await withTenant(
      T.ctx,
      async (tx) => {
        const plano = umId(await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo) values (${T.tenantId}, ${p.id}, 'Plano') returning id`));
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem, recipe_content_id) values (${meal}, ${T.tenantId}, ${p.id}, ${plano}, 'Café da manhã', 0, ${deT})`);
      },
      app.db,
    );
    await expect(
      withTenant(T.ctx, (tx) => tx.execute(sql`update meals set recipe_content_id = ${deU} where id = ${meal}`), app.db),
    ).rejects.toSatisfy(restricao('meals_receita_fk'));
    await withTenant(T.ctx, (tx) => tx.execute(sql`delete from contents where id = ${deT}`), app.db);
    const [m] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select tenant_id, recipe_content_id from meals where id = ${meal}`), app.db)).rows;
    expect(m).toEqual({ tenant_id: T.tenantId, recipe_content_id: null }); // o tenant_id (NOT NULL) fica
  });
});
```

Run: `pnpm test src/db/conteudo-schema.test.ts` → FAIL (relation "contents" does not exist).

- [ ] **Step 2: Schema** — `src/db/schema/conteudo.ts`

```ts
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { foods } from './alimentos';
import { patients, patientTags } from './pacientes';
import { storedFiles, tenants } from './platform';

/**
 * M6 (US-050 a US-056). `etiquetas` = rótulos DO CONTEÚDO ("sem lactose": filtro do feed, visíveis ao paciente); a
 * audiência por etiqueta DE PACIENTE ("gestante", staff_only) fica em content_audience.tag_id (D1). A sessão de
 * paciente só vê o publicado da audiência dela (política paciente_conteudo_visivel, migration 0083, D2).
 * `video_id`: YouTube = 11 caracteres; Vimeo = número, ou "número/hash" do vídeo não listado (D10).
 */
export const contents = pgTable(
  'contents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tipo: text('tipo').notNull(),
    titulo: text('titulo').notNull(),
    resumo: text('resumo').notNull().default(''),
    corpoMd: text('corpo_md').notNull().default(''),
    videoProvider: text('video_provider'),
    videoId: text('video_id'),
    /** JPEG convertido (D8): upload da receita/orientação ou miniatura do oEmbed (vídeo, D9). */
    capaPath: text('capa_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    /** Só orientação (US-052). */
    pdfPath: text('pdf_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    etiquetas: text('etiquetas').array().notNull().default(sql`'{}'::text[]`),
    visibilidade: text('visibilidade').notNull().default('todos'),
    status: text('status').notNull().default('rascunho'),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('contents_tipo_valido', sql`${t.tipo} in ('video', 'receita', 'orientacao')`),
    check('contents_visibilidade_valida', sql`${t.visibilidade} in ('todos', 'etiquetas', 'pacientes')`),
    check('contents_status_valido', sql`${t.status} in ('rascunho', 'publicado')`),
    check('contents_publicado_em', sql`(${t.status} = 'publicado') = (${t.publicadoEm} is not null)`),
    check('contents_textos_tamanho', sql`char_length(${t.titulo}) between 1 and 120 and char_length(${t.resumo}) <= 300 and char_length(${t.corpoMd}) <= 20000`),
    check('contents_etiquetas_tamanho', sql`cardinality(${t.etiquetas}) <= 10`),
    check(
      'contents_video_completo',
      sql`(${t.videoProvider} is null) = (${t.videoId} is null) and (${t.tipo} <> 'video' or ${t.videoId} is not null) and (${t.tipo} <> 'orientacao' or ${t.videoId} is null)`,
    ),
    check(
      'contents_video_id_valido',
      sql`${t.videoId} is null or (${t.videoProvider} = 'youtube' and ${t.videoId} ~ '^[A-Za-z0-9_-]{11}$') or (${t.videoProvider} = 'vimeo' and ${t.videoId} ~ '^[0-9]{6,12}(/[0-9a-f]{6,20})?$')`,
    ),
    check('contents_pdf_so_orientacao', sql`${t.pdfPath} is null or ${t.tipo} = 'orientacao'`),
    check('contents_capa_do_tenant', sql`${t.capaPath} is null or ${t.capaPath} like ${t.tenantId}::text || '/capa/%'`),
    check('contents_pdf_do_tenant', sql`${t.pdfPath} is null or ${t.pdfPath} like ${t.tenantId}::text || '/orientacao_pdf/%'`),
    unique('contents_tenant_id_unique').on(t.tenantId, t.id),
    // US-055: feed do mais recente; D19: filtro por etiqueta do conteúdo e busca full-text em título + resumo
    index('contents_feed_idx').on(t.tenantId, t.status, t.publicadoEm.desc()),
    index('contents_etiquetas_idx').using('gin', t.etiquetas),
    index('contents_busca_idx').using('gin', sql`to_tsvector('portuguese', app_unaccent(${t.titulo} || ' ' || ${t.resumo}))`),
  ],
);

export type ContentRow = typeof contents.$inferSelect;

/** US-051 / RN-11: 1:1 com o conteúdo do tipo receita (a chave é o próprio content_id). */
export const recipes = pgTable(
  'recipes',
  {
    contentId: uuid('content_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    rendimentoTotalG: numeric('rendimento_total_g', { precision: 7, scale: 1, mode: 'number' }).notNull(),
    porcaoG: numeric('porcao_g', { precision: 7, scale: 1, mode: 'number' }).notNull(),
    tempoPreparoMin: smallint('tempo_preparo_min'),
    modoPreparoMd: text('modo_preparo_md').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('recipes_rendimento_faixa', sql`${t.rendimentoTotalG} > 0 and ${t.rendimentoTotalG} <= 20000`),
    check('recipes_porcao_valida', sql`${t.porcaoG} > 0 and ${t.porcaoG} <= ${t.rendimentoTotalG}`),
    check('recipes_tempo_faixa', sql`${t.tempoPreparoMin} is null or ${t.tempoPreparoMin} between 1 and 1440`),
    check('recipes_modo_tamanho', sql`char_length(${t.modoPreparoMd}) <= 10000`),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'recipes_conteudo_fk' }).onDelete('cascade'),
    unique('recipes_tenant_conteudo_unique').on(t.tenantId, t.contentId),
  ],
);

export type RecipeRow = typeof recipes.$inferSelect;

/** D12: gramas + medida caseira em texto livre. FK RESTRICT para foods, como meal_items (alimento em uso não sai). */
export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    foodId: uuid('food_id').notNull().references(() => foods.id, { onDelete: 'restrict' }),
    quantidadeG: numeric('quantidade_g', { precision: 7, scale: 2, mode: 'number' }).notNull(),
    medidaCaseiraTxt: text('medida_caseira_txt'),
    ordem: smallint('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('recipe_ingredients_quantidade_faixa', sql`${t.quantidadeG} between 0.1 and 5000`),
    check('recipe_ingredients_medida_tamanho', sql`${t.medidaCaseiraTxt} is null or char_length(${t.medidaCaseiraTxt}) between 1 and 60`),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [recipes.tenantId, recipes.contentId], name: 'recipe_ingredients_receita_fk' }).onDelete('cascade'),
    index('recipe_ingredients_receita_idx').on(t.tenantId, t.contentId, t.ordem),
    index('recipe_ingredients_alimento_idx').on(t.foodId),
  ],
);

export type RecipeIngredientRow = typeof recipeIngredients.$inferSelect;

/** US-053 / RN-12: alvo de um conteúdo "etiquetas" (tag_id) ou "pacientes" (patient_id) — exatamente um dos dois. */
export const contentAudience = pgTable(
  'content_audience',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    patientId: uuid('patient_id'),
    tagId: uuid('tag_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('content_audience_um_alvo', sql`(${t.patientId} is null) <> (${t.tagId} is null)`),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'content_audience_conteudo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'content_audience_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [patientTags.tenantId, patientTags.id], name: 'content_audience_etiqueta_fk' }).onDelete('cascade'),
    unique('content_audience_paciente_unique').on(t.contentId, t.patientId),
    unique('content_audience_etiqueta_unique').on(t.contentId, t.tagId),
    index('content_audience_paciente_idx').on(t.tenantId, t.patientId),
    index('content_audience_etiqueta_idx').on(t.tenantId, t.tagId),
  ],
);

/** US-055: uma linha por (conteúdo, paciente) — conta pacientes únicos (US-056). */
export const contentViews = pgTable(
  'content_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    vistoEm: timestamp('visto_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('content_views_unique').on(t.contentId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'content_views_conteudo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'content_views_paciente_fk' }),
    index('content_views_paciente_idx').on(t.tenantId, t.patientId),
  ],
);

export const contentFavorites = pgTable(
  'content_favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    contentId: uuid('content_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('content_favorites_unique').on(t.contentId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.contentId], foreignColumns: [contents.tenantId, contents.id], name: 'content_favorites_conteudo_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'content_favorites_paciente_fk' }),
    index('content_favorites_paciente_idx').on(t.tenantId, t.patientId),
  ],
);
```

`src/db/schema/index.ts`: acrescentar `export * from './conteudo';` depois de `./plano-alimentar`.

`src/db/schema/plano-alimentar.ts`, em `meals` (coluna depois de `observacao` e o índice no fim da lista):

```ts
    /**
     * US-054 (D13): receita sugerida nesta refeição — não entra no total. A FK composta com
     * `ON DELETE SET NULL (recipe_content_id)` fica na migration 0082 (o Drizzle não gera a lista de colunas).
     */
    recipeContentId: uuid('recipe_content_id'),
```

```ts
    // a exceção da RN-12 (política paciente_conteudo_visivel) e o SET NULL procuram a refeição pela receita
    index('meals_receita_idx').on(t.tenantId, t.recipeContentId).where(sql`${t.recipeContentId} is not null`),
```

Run: `pnpm db:generate` → `drizzle/0081_conteudos.sql` (renomear a tag se o gerador escolher outro nome: `pnpm drizzle-kit generate --name conteudos`). Conferir no SQL gerado: as 6 tabelas, os CHECKs, `ALTER TABLE "meals" ADD COLUMN "recipe_content_id" uuid`, o índice `contents_busca_idx` com `to_tsvector('portuguese', app_unaccent(...))` e **nenhuma** FK de `meals` para `contents`.

- [ ] **Step 3: RLS, auditoria e escrita do paciente** — `pnpm drizzle-kit generate --custom --name rls_conteudos`; `drizzle/0082_rls_conteudos.sql`:

```sql
-- Plano 07 (M6): RLS de tenant em todas as tabelas de conteúdo; de paciente nas que têm patient_id. A leitura por
-- audiência (RN-12) da sessão de paciente vem na 0083 (política paciente_conteudo_visivel).
SELECT app_enable_tenant_rls('contents');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recipes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recipe_ingredients');
--> statement-breakpoint
SELECT app_enable_tenant_rls('content_audience');
--> statement-breakpoint
SELECT app_enable_patient_rls('content_audience');
--> statement-breakpoint
-- D6: escolher pacientes para um conteúdo ("Cardápio para gestantes" → Ana) é decisão clínica: escritas auditadas
SELECT app_enable_audit('content_audience', 'conteudos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('content_views');
--> statement-breakpoint
SELECT app_enable_patient_rls('content_views');
--> statement-breakpoint
-- US-055 (D18): o paciente registra a própria visualização, uma vez (INSERT … ON CONFLICT DO NOTHING)
SELECT app_allow_paciente_escrita('content_views', 'insert');
--> statement-breakpoint
SELECT app_enable_tenant_rls('content_favorites');
--> statement-breakpoint
SELECT app_enable_patient_rls('content_favorites');
--> statement-breakpoint
-- US-055: favoritar e desfavoritar
SELECT app_allow_paciente_escrita('content_favorites', 'insert', 'delete');
--> statement-breakpoint
-- US-054 / D13: a refeição só aponta para receita do mesmo tenant; excluir o conteúdo solta só a sugestão
-- (SET NULL com lista de colunas, PG 15+: tenant_id é NOT NULL e não pode ir junto)
ALTER TABLE meals ADD CONSTRAINT meals_receita_fk
  FOREIGN KEY (tenant_id, recipe_content_id) REFERENCES contents (tenant_id, id) ON DELETE SET NULL (recipe_content_id);
```

Run: `pnpm db:migrate` (banco de **dev local** do `docker-compose.dev.yml`, com `DATABASE_URL_MIGRATOR`) e `pnpm test src/db/conteudo-schema.test.ts` → PASS.

- [ ] **Step 4: Listas das guardas** — `src/db/rls-guard.ts`, em `PACIENTE_ESCREVE` (depois de `data_exports`):

```ts
  content_views: { comandos: ['insert'], motivo: 'US-055 (D18): o paciente registra que abriu o conteúdo, uma vez; só de conteúdo que ele vê (0083)' },
  content_favorites: { comandos: ['insert', 'delete'], motivo: 'US-055: favoritar e desfavoritar; só conteúdo que ele vê (0083)' },
```

`src/db/audit-guard.ts`, em `AUDIT_EXCEPTIONS`:

```ts
  content_views: 'D6 (Plano 07): registro de uso (o paciente abriu o conteúdo da nutricionista), como access_events; não é prontuário',
  content_favorites: 'D6 (Plano 07): preferência do paciente na biblioteca de conteúdo; não é prontuário',
```

`src/modules/plataforma/audit.ts`, em `ENTIDADE_ROTULO` (depois de `diario`): `conteudos: 'Público de conteúdo',`.

`CLAUDE.md`, regra 8 (D6, aprovada pelo dono em 04/10/2026 — a regra diz que toda tabela com `patient_id` ganha `app_enable_audit`, e estas duas não ganham): logo depois da frase "A leitura da agenda (`appointments`: nome, hora e situação) não chama `auditRead`, como a lista de pacientes (Plano 05, D10); as escritas em `appointments` são auditadas pelo gatilho (entidade `agenda`).", acrescentar: "Tabela com `patient_id` que não é dado de saúde fica **sem** gatilho só com a entrada justificada em `AUDIT_EXCEPTIONS` (`src/db/audit-guard.ts`), como `access_events` e `push_subscriptions`; no Plano 07 (D6), `content_views` (o paciente abriu o conteúdo) e `content_favorites` (favorito na biblioteca) — registro de uso, não prontuário. A leitura do conteúdo pelo paciente e a lista \"Quem viu\" da nutricionista também não chamam `auditRead`; `content_audience` (quem a nutricionista escolhe para cada conteúdo) tem o gatilho (entidade `conteudos`)."

- [ ] **Step 5: B-5 — a guarda confere a expressão da negação (teste falha)** — em `src/db/rls-guard.test.ts`, no `describe('escrita da sessão de paciente (D1, P-16 a)'`:

```ts
  it('B-5: a política com o nome e o comando certos, mas que não nega nada (USING true), também quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_sem_delete on exams');
      await client.query('create policy paciente_sem_delete on exams as restrictive for delete using (true)');
      await client.query('drop policy paciente_sem_insert on contents');
      await client.query('create policy paciente_sem_insert on contents as restrictive for insert with check (true)');
      const v = await findPacienteEscritaViolations(client);
      expect(v).toContainEqual({ table: 'exams', problem: 'a sessão de paciente pode delete sem entrada em PACIENTE_ESCREVE' });
      expect(v).toContainEqual({ table: 'contents', problem: 'a sessão de paciente pode insert sem entrada em PACIENTE_ESCREVE' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
```

Run: `pnpm test src/db/rls-guard.test.ts` → FAIL (a política `USING (true)` passa).

- [ ] **Step 6: B-5 — implementação** — `src/db/rls-guard.ts`, em `findPacienteEscritaViolations`:

```ts
/** B-5 (P06-12): o texto que o Postgres guarda da negação de app_deny_paciente_escrita, sem espaços e parênteses. */
const normalizarExpressao = (e: string | null) => (e ?? '').replace(/[\s()]/g, '').toLowerCase();
const NEGA_PACIENTE = normalizarExpressao("app_current_role() IS DISTINCT FROM 'paciente'::text");
```

e trocar a consulta e a condição `negada` por:

```ts
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string; qual: string | null; with_check: string | null }>(
    `select tablename as t, policyname as pol, cmd, permissive, qual, with_check from pg_policies
      where schemaname = 'public' and policyname like 'paciente\\_sem\\_%'`,
  );
```

```ts
      // nome, comando, RESTRICTIVE e a expressão (B-5): um `paciente_sem_delete USING (true)` não nega o DELETE
      const negada = rows.some(
        (r) =>
          r.t === table && r.pol === `paciente_sem_${c}` && r.cmd === c.toUpperCase() && r.permissive === 'RESTRICTIVE' &&
          normalizarExpressao(c === 'insert' ? r.with_check : r.qual) === NEGA_PACIENTE,
      );
```

Run: `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts` → PASS (as tabelas novas: `contents`, `recipes`, `recipe_ingredients` e `content_audience` negam os três comandos; `content_views` libera `insert`; `content_favorites`, `insert` e `delete`).

- [ ] **Step 7: Matriz de isolamento** — `test/isolamento.test.ts`, em `FABRICAS` (depois de `diary_entries`):

```ts
  // Plano 07: cada fábrica cria o próprio conteúdo (UNIQUE (content_id, patient_id) em views/favoritos) no mesmo comando
  contents: (t) => sql`insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'publicado', now())`,
  recipes: (t) => sql`with c as (insert into contents (tenant_id, tipo, titulo) values (${t}, 'receita', 'Iso') returning id)
    insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) select ${t}, c.id, 1000, 250 from c`,
  recipe_ingredients: (t) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo) values (${t}, 'receita', 'Iso') returning id),
             r as (insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) select ${t}, c.id, 1000, 250 from c returning content_id)
        insert into recipe_ingredients (tenant_id, content_id, food_id, quantidade_g, ordem)
        select ${t}, r.content_id, '00000000-0000-4000-8000-000000000003', 100, 0 from r`,
  content_audience: (t, p) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo, visibilidade, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'pacientes', 'publicado', now()) returning id)
        insert into content_audience (tenant_id, content_id, patient_id) select ${t}, c.id, ${p} from c`,
  content_views: (t, p) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'publicado', now()) returning id)
        insert into content_views (tenant_id, content_id, patient_id) select ${t}, c.id, ${p} from c`,
  content_favorites: (t, p) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'publicado', now()) returning id)
        insert into content_favorites (tenant_id, content_id, patient_id) select ${t}, c.id, ${p} from c`,
```

e `ULTIMAS` (as filhas de conteúdo apontam para `contents`/`recipes` com cascata: apagar a mãe antes zeraria as linhas de B que o teste ainda vai contar):

```ts
const ULTIMAS = ['meals', 'meal_plans', 'recipes', 'contents', 'anamnesis_templates', 'foods', 'appointments', 'patients'];
```

Run: `pnpm test test/isolamento.test.ts src/db` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/conteudo.ts src/db/schema/index.ts src/db/schema/plano-alimentar.ts drizzle/0081_conteudos.sql drizzle/0082_rls_conteudos.sql drizzle/meta src/db/conteudo-schema.test.ts src/db/rls-guard.ts src/db/rls-guard.test.ts src/db/audit-guard.ts src/modules/plataforma/audit.ts test/isolamento.test.ts CLAUDE.md
git commit -m "feat(db): tabelas de conteúdo com RLS, visualização/favorito do paciente e meals.recipe_content_id; guarda confere a expressão da negação (B-5)"
```

---

### Task 2: Audiência avaliada na leitura (P07-01 b; US-053, RN-12)

**Files:**
- Create: `drizzle/0083_audiencia_conteudos.sql` (custom), `src/modules/conteudo/constantes.ts`, `src/modules/conteudo/audiencia.ts`, `src/modules/conteudo/audiencia.test.ts`, `test/conteudos.ts`
- Modify: `src/db/rls-guard.ts` (+ `rls-guard.test.ts`), `src/db/migrate-owner.test.ts` (a função SECURITY DEFINER no cluster do runbook), `CLAUDE.md` (regra 2)

**Interfaces:**
- Consumes: tabelas da Tarefa 1; `patientTagLinks`, `patientTags`, `patients`, `meals`, `mealPlans`; `listarEtiquetas` (`src/modules/pacientes/etiquetas.ts`); `idValido` (`src/modules/pacientes/base.ts`); `novoTenant`, `novoPaciente`, `ctxPaciente` (`test/pacientes.ts`).
- Produces:
  - SQL: `app_conteudo_por_etiqueta(uuid) RETURNS boolean` (SECURITY DEFINER); políticas RESTRICTIVE `paciente_conteudo_visivel` (FOR SELECT) em `contents`, `recipes`, `recipe_ingredients` — a exceção da receita do plano só com `current_setting('app.receitas_do_plano', true) = 'on'`; `paciente_conteudo_visto` (`content_views`) e `paciente_conteudo_favorito` (`content_favorites`), FOR INSERT (recusam com a liberação do plano ligada).
  - `@/db/rls-guard`: `CONTEUDO_POR_AUDIENCIA: Record<string, string>`, `findConteudoAudienciaViolations(db): Promise<RlsViolation[]>`.
  - `@/modules/conteudo/constantes` (sem banco, o cliente importa): `TIPOS_CONTEUDO`, `type TipoConteudo`, `ROTULO_TIPO_CONTEUDO`, `FILTROS_DO_FEED`, `VISIBILIDADES`, `type Visibilidade`, `ROTULO_VISIBILIDADE`, `ehTipoConteudo(v): v is TipoConteudo`, `ehVisibilidade(v)`, limites (`TITULO_MAX`, `RESUMO_MAX`, `CORPO_MAX`, `ETIQUETAS_MAX`, `ETIQUETA_MAX`, `CAPA_MAX_BYTES`, `PDF_MAX_BYTES`, `INGREDIENTES_MAX`, `RENDIMENTO_MAX`, `MODO_PREPARO_MAX`, `MEDIDA_TXT_MAX`, `FEED_LIMITE`), `MSG_CONTEUDO`, `MSG_RECEITA`, `MSG_PORTAL_CONTEUDO`.
  - `@/modules/conteudo/audiencia`: `naAudiencia(contentId: string, visibilidade: Visibilidade): SQL` (condição sobre `patients`); `naAudienciaDaLinha(contentId: AnyColumn | SQL, visibilidade: AnyColumn | SQL): SQL` (a mesma condição com o conteúdo vindo da linha da consulta — métricas agrupadas, T11); `liberarReceitasDoPlano(tx): Promise<unknown>` (liga `app.receitas_do_plano` só na transação — a exceção da RN-12; só `src/modules/portal/plano.ts` e `conteudoDoPaciente` chamam); `PACIENTES_NA_LISTA`; `gravarAudiencia(tx, tenantId, contentId, a: AudienciaEnviada): Promise<{ pacientes: string[]; etiquetas: string[] }>`; `lerAudiencia(tx, contentId): Promise<{ pacientes: string[]; etiquetas: string[] }>`; `opcoesDeAudiencia(ctx, db?): Promise<OpcoesDeAudiencia>`; tipos `AudienciaEnviada = { visibilidade: Visibilidade; pacientes: string[]; etiquetas: string[] }`, `OpcoesDeAudiencia = { etiquetas: { id: string; nome: string }[]; pacientes: { id: string; nome: string }[] }`.
  - `test/conteudos.ts`: `novoConteudo(db, T, o?)`, `novaEtiqueta(db, T, nome, pacientes?)`, `comoPaciente(db, tenantId, patientId)`.

- [ ] **Step 1: Constantes do módulo** — `src/modules/conteudo/constantes.ts` (sem banco: o editor e o portal importam)

```ts
/** M6. Só constantes e tipos: cliente e servidor importam daqui. */
export const TIPOS_CONTEUDO = ['video', 'receita', 'orientacao'] as const;
export type TipoConteudo = (typeof TIPOS_CONTEUDO)[number];
export const ehTipoConteudo = (v: unknown): v is TipoConteudo => typeof v === 'string' && (TIPOS_CONTEUDO as readonly string[]).includes(v);
export const ROTULO_TIPO_CONTEUDO: Record<TipoConteudo, string> = { video: 'Vídeo', receita: 'Receita', orientacao: 'Orientação' };
/** US-055: "Vídeos / Receitas / Orientações". */
export const FILTROS_DO_FEED: { tipo: TipoConteudo; rotulo: string }[] = [
  { tipo: 'video', rotulo: 'Vídeos' },
  { tipo: 'receita', rotulo: 'Receitas' },
  { tipo: 'orientacao', rotulo: 'Orientações' },
];

export const VISIBILIDADES = ['todos', 'etiquetas', 'pacientes'] as const;
export type Visibilidade = (typeof VISIBILIDADES)[number];
export const ehVisibilidade = (v: unknown): v is Visibilidade => typeof v === 'string' && (VISIBILIDADES as readonly string[]).includes(v);
export const ROTULO_VISIBILIDADE: Record<Visibilidade, string> = { todos: 'Todos os pacientes', etiquetas: 'Pacientes com etiqueta', pacientes: 'Pacientes específicos' };

export const TITULO_MAX = 120;
export const RESUMO_MAX = 300;
export const CORPO_MAX = 20000;
export const ETIQUETAS_MAX = 10;
export const ETIQUETA_MAX = 30;
/** US-051: capa JPEG/PNG ≤ 5 MB. D20: PDF ≤ 10 MB. */
export const CAPA_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const INGREDIENTES_MAX = 50;
export const RENDIMENTO_MAX = 20000;
export const MODO_PREPARO_MAX = 10000;
export const MEDIDA_TXT_MAX = 60;
/** D19: o feed mostra no máximo isto (do mais recente para o mais antigo). */
export const FEED_LIMITE = 100;

export const MSG_CONTEUDO = {
  titulo: 'Informe o título (até 120 caracteres).',
  resumo: 'Use no máximo 300 caracteres no resumo.',
  corpo: 'Texto muito longo (até 20000 caracteres).',
  etiquetas: 'Use até 10 etiquetas de até 30 caracteres.',
  visibilidade: 'Escolha quem vê este conteúdo.',
  audienciaVazia: 'Escolha pelo menos uma etiqueta ou um paciente.',
  naoEncontrado: 'Conteúdo não encontrado.',
  /** US-050 (texto exato). */
  videoDominio: 'Use um link do YouTube ou do Vimeo',
  /** RN-10 (com ponto, como a RN-10; a US-050 não tem). */
  videoAviso: 'Vídeos não listados podem ser vistos por quem tiver o link.',
  capa: 'Envie uma imagem JPEG ou PNG de até 5 MB.',
  pdf: 'Envie um PDF de até 10 MB.',
  ocupado: 'Outro envio está em andamento. Tente de novo em instantes.',
  salvo: 'Conteúdo salvo.',
  capaSalva: 'Capa salva.',
  pdfSalvo: 'PDF salvo.',
  publicado: 'Conteúdo publicado.',
  despublicado: 'Conteúdo despublicado.',
  excluido: 'Conteúdo excluído.',
  receitaIncompleta: 'Preencha a receita (rendimento, porção e ingredientes) antes de publicar.',
  orientacaoVazia: 'Escreva o texto ou envie o PDF antes de publicar.',
  /** D17: salvar sem texto ou tirar o PDF de uma orientação PUBLICADA a deixaria vazia. */
  publicadoVazio: 'Um conteúdo publicado precisa de texto ou PDF. Despublique antes de tirar os dois.',
  avisados: (n: number) => (n === 1 ? 'Aviso enviado para 1 paciente.' : `Aviso enviado para ${n} pacientes.`),
} as const;

export const MSG_RECEITA = {
  rendimento: 'Informe o rendimento total em gramas (maior que 0).',
  porcao: 'Informe a porção em gramas (maior que 0).',
  /** US-051 (texto exato). */
  porcaoMaior: 'A porção não pode ser maior que o rendimento',
  ingredientes: 'Inclua pelo menos um ingrediente.',
  ingredientesMax: 'A receita pode ter até 50 ingredientes.',
  tempo: 'Tempo de preparo entre 1 e 1440 minutos.',
  modo: 'Texto muito longo (até 10000 caracteres).',
  medida: 'Medida caseira até 60 caracteres.',
  salva: 'Receita salva.',
  /** US-054 (texto exato). */
  indisponivel: 'Receita indisponível',
  naoEncontrada: 'Receita não encontrada.',
} as const;

export const MSG_PORTAL_CONTEUDO = {
  vazio: 'Nenhum conteúdo por aqui ainda.',
  semResultado: 'Nenhum conteúdo encontrado.',
  semFavoritos: 'Você ainda não favoritou nenhum conteúdo.',
  favoritar: 'Favoritar',
  desfavoritar: 'Remover dos favoritos',
  /** US-052 (texto exato). */
  baixarPdf: 'Baixar material (PDF)',
} as const;
```

- [ ] **Step 2: Ajudantes de teste** — `test/conteudos.ts`

```ts
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { contentAudience, contents, patientTagLinks, patientTags, recipeIngredients, recipes, type ContentRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { ctxPaciente, type TenantDeTeste } from './pacientes';

type Extra = Partial<typeof contents.$inferInsert> & {
  /** visibilidade "pacientes": os alvos. */
  pacientes?: string[];
  /** visibilidade "etiquetas": ids de patient_tags. */
  tags?: string[];
  /** tipo "receita": rendimento, porção e ingredientes (gramas). */
  receita?: { rendimento: number; porcao: number; ingredientes?: { foodId: string; g: number }[] };
};

/** Conteúdo gravado direto como a nutricionista (sem validação): publicado, orientação, para todos — salvo o `extra`. */
export async function novoConteudo(db: Db, T: TenantDeTeste, extra: Extra = {}): Promise<ContentRow> {
  const { pacientes = [], tags = [], receita, ...colunas } = extra;
  const status = colunas.status ?? 'publicado';
  return withTenant(
    T.ctx,
    async (tx) => {
      const [c] = await tx
        .insert(contents)
        .values({ tenantId: T.tenantId, tipo: 'orientacao', titulo: 'Como ler rótulos', status, publicadoEm: status === 'publicado' ? new Date() : null, ...colunas })
        .returning();
      for (const patientId of pacientes) await tx.insert(contentAudience).values({ tenantId: T.tenantId, contentId: c.id, patientId });
      for (const tagId of tags) await tx.insert(contentAudience).values({ tenantId: T.tenantId, contentId: c.id, tagId });
      if (receita) {
        await tx.insert(recipes).values({ tenantId: T.tenantId, contentId: c.id, rendimentoTotalG: receita.rendimento, porcaoG: receita.porcao });
        for (const [ordem, i] of (receita.ingredientes ?? []).entries())
          await tx.insert(recipeIngredients).values({ tenantId: T.tenantId, contentId: c.id, foodId: i.foodId, quantidadeG: i.g, ordem });
      }
      return c;
    },
    db,
  );
}

/** Etiqueta de paciente (US-019) já aplicada a `pacientes`. */
export async function novaEtiqueta(db: Db, T: TenantDeTeste, nome: string, pacientes: string[] = []): Promise<string> {
  return withTenant(
    T.ctx,
    async (tx) => {
      const [e] = await tx.insert(patientTags).values({ tenantId: T.tenantId, nome: `${nome}-${crypto.randomUUID().slice(0, 6)}` }).returning({ id: patientTags.id });
      for (const patientId of pacientes) await tx.insert(patientTagLinks).values({ tenantId: T.tenantId, patientId, tagId: e.id });
      return e.id;
    },
    db,
  );
}

/** Roda `fn` na sessão de um paciente (RLS dele). */
export const comoPaciente =
  (db: Db, tenantId: string, patientId: string) =>
  <R>(fn: (tx: Tx) => Promise<R>): Promise<R> =>
    withTenant(ctxPaciente(tenantId, patientId), fn, db);

/** Os ids de conteúdo que a sessão vê (para conferir a audiência). */
export const idsVisiveis = (tx: Tx) => tx.execute(sql`select id from contents order by created_at`).then((r) => r.rows.map((x) => x.id as string));
```

- [ ] **Step 3: Teste da audiência (falha)** — `src/modules/conteudo/audiencia.test.ts`

```ts
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { comoPaciente, idsVisiveis, novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import type { Tx } from '@/db/client';
import { auditLog, contentAudience, contents, patients, patientTagLinks } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { gravarAudiencia, lerAudiencia, liberarReceitasDoPlano, naAudiencia, naAudienciaDaLinha, opcoesDeAudiencia } from './audiencia';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
  return { T, ana, bia, comoAna: comoPaciente(app.db, T.tenantId, ana.id), comoBia: comoPaciente(app.db, T.tenantId, bia.id) };
}

describe('audiência avaliada na leitura (RN-12, US-053) — a RLS da sessão de paciente', () => {
  it('"todos": todo paciente do tenant vê o publicado; rascunho ninguém vê; a nutricionista vê os dois', async () => {
    const { T, comoAna, comoBia } = await cenario();
    const pub = await novoConteudo(app.db, T);
    const rasc = await novoConteudo(app.db, T, { status: 'rascunho', titulo: 'Rascunho' });
    expect(await comoAna(idsVisiveis)).toEqual([pub.id]);
    expect(await comoBia(idsVisiveis)).toEqual([pub.id]);
    expect(await withTenant(T.ctx, idsVisiveis, app.db)).toEqual([pub.id, rasc.id]);
  });

  it('"pacientes" = [Ana]: só a Ana vê; a Bia não acha a linha (404 pela URL) e não lê a lista de alvos', async () => {
    const { T, ana, comoAna, comoBia } = await cenario();
    const c = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] });
    expect(await comoAna(idsVisiveis)).toEqual([c.id]);
    expect(await comoBia(idsVisiveis)).toEqual([]);
    expect(await comoBia((tx) => tx.select().from(contentAudience))).toEqual([]);
    expect((await comoAna((tx) => tx.select().from(contentAudience))).map((r) => r.patientId)).toEqual([ana.id]);
  });

  it('"etiquetas" = [gestante]: só quem tem a etiqueta e está ativo; aplicar a etiqueta à Bia vale na hora; tirar, também', async () => {
    const { T, ana, bia, comoAna, comoBia } = await cenario();
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    expect(await comoAna(idsVisiveis)).toEqual([c.id]);
    expect(await comoBia(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.insert(patientTagLinks).values({ tenantId: T.tenantId, patientId: bia.id, tagId: gestante }), app.db);
    expect(await comoBia(idsVisiveis)).toEqual([c.id]); // "passa a ver imediatamente"
    await withTenant(T.ctx, (tx) => tx.delete(patientTagLinks).where(eq(patientTagLinks.patientId, bia.id)), app.db);
    expect(await comoBia(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, ana.id)), app.db);
    expect(await comoAna(idsVisiveis)).toEqual([]); // RN-08: arquivado sai das audiências
    // a sessão de paciente continua sem ver etiqueta nenhuma (US-019), nem as linhas de alvo por etiqueta
    expect(await comoAna((tx) => tx.execute(sql`select 1 from patient_tag_links`).then((r) => r.rows))).toEqual([]);
    expect(await comoAna((tx) => tx.select().from(contentAudience))).toEqual([]);
  });

  it('a função devolve o contexto do chamador e não responde fora da sessão de paciente', async () => {
    const { T, ana, comoAna } = await cenario();
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    const r = await comoAna((tx) =>
      tx.execute(sql`select app_conteudo_por_etiqueta(${c.id}) as ok, current_setting('app.role') as papel, current_setting('app.patient_id') as paciente`),
    );
    expect(r.rows[0]).toEqual({ ok: true, papel: 'paciente', paciente: ana.id });
    const comoNutri = await withTenant(T.ctx, (tx) => tx.execute(sql`select app_conteudo_por_etiqueta(${c.id}) as ok`), app.db);
    expect(comoNutri.rows[0]).toEqual({ ok: false });
  });

  it('exceção da RN-12 (US-054): a receita sugerida no plano PUBLICADO da Bia aparece para ela SÓ no caminho do plano, com receita e ingredientes; plano arquivado ou receita despublicada, não', async () => {
    const { T, ana, bia, comoBia } = await cenario();
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      visibilidade: 'pacientes',
      pacientes: [ana.id],
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: idTaco(3), g: 200 }] },
    });
    const plano = await withTenant(
      T.ctx,
      async (tx) => {
        const [p] = (await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo, status, publicado_em) values (${T.tenantId}, ${bia.id}, 'Plano', 'publicado', now()) returning id`)).rows as { id: string }[];
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, horario, ordem, recipe_content_id) values (gen_random_uuid(), ${T.tenantId}, ${bia.id}, ${p.id}, 'Café da manhã', '07:00', 0, ${r.id})`);
        return p.id;
      },
      app.db,
    );
    // fora do caminho do plano (feed, busca, filtro de etiquetas, selo "Novo", URL direta): a receita não existe para ela
    expect(await comoBia(idsVisiveis)).toEqual([]);
    expect(await comoBia((tx) => tx.execute(sql`select count(*)::int as n from recipe_ingredients`).then((x) => x.rows[0]))).toEqual({ n: 0 });
    // "Meu plano" e a receita aberta pelo cartão ligam a liberação na própria transação
    const peloPlano = <R,>(fn: (tx: Tx) => Promise<R>) =>
      comoBia(async (tx) => {
        await liberarReceitasDoPlano(tx);
        return fn(tx);
      });
    expect(await peloPlano(idsVisiveis)).toEqual([r.id]);
    expect(await peloPlano((tx) => tx.execute(sql`select count(*)::int as n from recipes`).then((x) => x.rows[0]))).toEqual({ n: 1 });
    expect(await peloPlano((tx) => tx.execute(sql`select count(*)::int as n from recipe_ingredients`).then((x) => x.rows[0]))).toEqual({ n: 1 });
    // D14: nem com a liberação ligada a visualização/favorito passam (só pela audiência)
    await expect(peloPlano((tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${r.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    await expect(peloPlano((tx) => tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${r.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    // a liberação vale só na transação que a ligou (set_config local): a seguinte volta ao normal
    expect(await comoBia(idsVisiveis)).toEqual([]);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update meal_plans set status = 'arquivado' where id = ${plano}`), app.db);
    expect(await peloPlano(idsVisiveis)).toEqual([]);
    expect(await peloPlano((tx) => tx.execute(sql`select count(*)::int as n from recipe_ingredients`).then((x) => x.rows[0]))).toEqual({ n: 0 });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update meal_plans set status = 'publicado' where id = ${plano}`), app.db);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update contents set status = 'rascunho', publicado_em = null where id = ${r.id}`), app.db);
    expect(await peloPlano(idsVisiveis)).toEqual([]); // US-054 "Receita despublicada"
  });

  it('visualização e favorito só de conteúdo visível (42501 no invisível); repetir a visualização não duplica', async () => {
    const { T, ana, bia, comoBia } = await cenario();
    const daAna = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] });
    const deTodos = await novoConteudo(app.db, T);
    await expect(comoBia((tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${daAna.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    await expect(comoBia((tx) => tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id) values (${T.tenantId}, ${daAna.id}, ${bia.id})`))).rejects.toSatisfy(violaRls);
    const ver = sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${deTodos.id}, ${bia.id}) on conflict do nothing`;
    await comoBia((tx) => tx.execute(ver));
    await comoBia((tx) => tx.execute(ver));
    expect(await comoBia((tx) => tx.execute(sql`select count(*)::int as n from content_views`).then((x) => x.rows[0]))).toEqual({ n: 1 });
  });
});

describe('audiência fora da sessão de paciente (naAudiencia, gravarAudiencia)', () => {
  it('naAudiencia: os pacientes ATIVOS da audiência, para cada visibilidade', async () => {
    const { T, ana, bia } = await cenario();
    const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio', status: 'arquivado' });
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id, caio.id]);
    const todos = await novoConteudo(app.db, T);
    const porEtiqueta = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    const daBia = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [bia.id, caio.id] });
    const quem = (id: string, v: 'todos' | 'etiquetas' | 'pacientes') =>
      withTenant(T.ctx, (tx) => tx.select({ id: patients.id }).from(patients).where(naAudiencia(id, v)).orderBy(patients.nome), app.db).then((r) => r.map((x) => x.id));
    expect(await quem(todos.id, 'todos')).toEqual([ana.id, bia.id]);
    expect(await quem(porEtiqueta.id, 'etiquetas')).toEqual([ana.id]);
    expect(await quem(daBia.id, 'pacientes')).toEqual([bia.id]);
    // naAudienciaDaLinha: o mesmo resultado com o conteúdo vindo da linha (a visibilidade lida do banco)
    const daLinha = (id: string) =>
      withTenant(
        T.ctx,
        (tx) =>
          tx
            .select({ id: patients.id })
            .from(patients)
            .innerJoin(contents, and(eq(contents.tenantId, patients.tenantId), eq(contents.id, id)))
            .where(naAudienciaDaLinha(contents.id, contents.visibilidade))
            .orderBy(patients.nome),
        app.db,
      ).then((r) => r.map((x) => x.id));
    expect(await daLinha(todos.id)).toEqual([ana.id, bia.id]);
    expect(await daLinha(porEtiqueta.id)).toEqual([ana.id]);
    expect(await daLinha(daBia.id)).toEqual([bia.id]);
  });

  it('gravarAudiencia: grava só a diferença, ignora paciente de outro tenant, arquivado e etiqueta desconhecida; alvo que o formulário não mostra fica (D15); trocar a visibilidade limpa os alvos', async () => {
    const { T, ana, bia } = await cenario();
    const U = await novoTenant(app.db);
    const deFora = await novoPaciente(app.db, U.ctx);
    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const c = await novoConteudo(app.db, T, { status: 'rascunho' });
    const gravar = (a: Parameters<typeof gravarAudiencia>[3]) => withTenant(T.ctx, (tx) => gravarAudiencia(tx, T.tenantId, c.id, a), app.db);
    expect(await gravar({ visibilidade: 'pacientes', pacientes: [ana.id, deFora.id, arquivado.id, 'lixo'], etiquetas: [] })).toEqual({ pacientes: [ana.id], etiquetas: [] });
    const auditadas = () => withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'conteudos'))), app.db).then((r) => r.length);
    const antes = await auditadas();
    await gravar({ visibilidade: 'pacientes', pacientes: [ana.id], etiquetas: [] }); // nada mudou: nenhuma escrita
    expect(await auditadas()).toBe(antes);
    await gravar({ visibilidade: 'pacientes', pacientes: [bia.id], etiquetas: [] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [bia.id], etiquetas: [] });
    // D15: o Caio era alvo e foi arquivado — o formulário não o mostra (só ativos), então salvar NÃO o tira;
    // desarquivado, volta à audiência sem a nutricionista refazer a escolha
    const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio' });
    await gravar({ visibilidade: 'pacientes', pacientes: [bia.id, caio.id], etiquetas: [] });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, caio.id)), app.db);
    expect(await gravar({ visibilidade: 'pacientes', pacientes: [bia.id], etiquetas: [] })).toEqual({ pacientes: [bia.id], etiquetas: [] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [bia.id, caio.id], etiquetas: [] });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, caio.id)), app.db);
    const naDaBia = await withTenant(T.ctx, (tx) => tx.select({ id: patients.id }).from(patients).where(naAudiencia(c.id, 'pacientes')).orderBy(patients.nome), app.db);
    expect(naDaBia.map((x) => x.id)).toEqual([bia.id, caio.id]);
    // o que o formulário mostra e a nutricionista desmarca, sai
    await gravar({ visibilidade: 'pacientes', pacientes: [bia.id], etiquetas: [] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [bia.id], etiquetas: [] });
    const gestante = await novaEtiqueta(app.db, T, 'gestante');
    await gravar({ visibilidade: 'etiquetas', pacientes: [bia.id], etiquetas: [gestante, crypto.randomUUID()] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [], etiquetas: [gestante] });
    await gravar({ visibilidade: 'todos', pacientes: [ana.id], etiquetas: [gestante] });
    expect(await withTenant(T.ctx, (tx) => lerAudiencia(tx, c.id), app.db)).toEqual({ pacientes: [], etiquetas: [] });
  });

  it('opcoesDeAudiencia: etiquetas do tenant e só pacientes ativos, por nome', async () => {
    const { T, ana, bia } = await cenario();
    await novoPaciente(app.db, T.ctx, { nome: 'Arquivada', status: 'arquivado' });
    const gestante = await novaEtiqueta(app.db, T, 'gestante');
    const o = await opcoesDeAudiencia(T.ctx, app.db);
    expect(o.pacientes).toEqual([{ id: ana.id, nome: 'Ana Souza' }, { id: bia.id, nome: 'Bia Lima' }]);
    expect(o.etiquetas.map((e) => e.id)).toEqual([gestante]);
  });
});
```

Run: `pnpm test src/modules/conteudo/audiencia.test.ts` → FAIL (`./audiencia` não existe; sem a 0083 a Bia vê o conteúdo da Ana).

- [ ] **Step 4: Migration da audiência** — `pnpm drizzle-kit generate --custom --name audiencia_conteudos`; `drizzle/0083_audiencia_conteudos.sql`:

```sql
-- RN-12 / D2 (Plano 07): a sessão de paciente só vê conteúdo PUBLICADO da audiência dela, avaliada na leitura (uma
-- etiqueta aplicada agora vale agora). A audiência por etiqueta usa patient_tag_links, que é staff_only (US-019: o
-- paciente não vê nem os próprios vínculos): esta função responde só "este conteúdo é para uma etiqueta deste
-- paciente ativo?" (nota do Plano 03), sem devolver etiqueta nenhuma. A RLS é FORCE também para o dono das tabelas:
-- a leitura roda com o papel `worker` do MESMO tenant (set_config local à transação, como a app_soltar_endpoint_push
-- da 0075) e devolve o contexto do chamador ANTES de retornar — a política que a chama continua vendo `paciente`.
-- Fora da sessão de paciente responde false (não é atalho para a equipe). search_path fixo e nomes qualificados.
CREATE OR REPLACE FUNCTION app_conteudo_por_etiqueta(p_content uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := current_setting('app.patient_id', true);
  v_tenant uuid := app_current_tenant();
  v_ok boolean;
BEGIN
  IF v_role IS DISTINCT FROM 'paciente' OR nullif(v_patient, '') IS NULL OR v_tenant IS NULL OR p_content IS NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  v_ok := EXISTS (
    SELECT 1
      FROM public.content_audience a
      JOIN public.patient_tag_links l ON l.tenant_id = a.tenant_id AND l.tag_id = a.tag_id
      JOIN public.patients p ON p.tenant_id = l.tenant_id AND p.id = l.patient_id
     WHERE a.tenant_id = v_tenant AND a.content_id = p_content AND a.tag_id IS NOT NULL
       AND l.patient_id = v_patient::uuid AND p.status = 'ativo' AND p.anonimizado_em IS NULL);
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  RETURN v_ok;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_conteudo_por_etiqueta(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_conteudo_por_etiqueta(uuid) TO nutri_app_role;
--> statement-breakpoint
-- A equipe, o worker, o `publico` e o `conta` não mudam (o `publico` e o `conta` já não veem nada: 0051/0073).
-- As subconsultas rodam com a RLS de quem lê: content_audience só tem as linhas do próprio paciente; meals e
-- meal_plans, só as dele (e nunca o rascunho — paciente_sem_rascunho).
CREATE POLICY paciente_conteudo_visivel ON contents AS RESTRICTIVE FOR SELECT
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (status = 'publicado' AND (
      visibilidade = 'todos'
      OR (visibilidade = 'pacientes' AND EXISTS (
        SELECT 1 FROM content_audience a
         WHERE a.tenant_id = contents.tenant_id AND a.content_id = contents.id AND a.patient_id = app_current_patient()))
      OR (visibilidade = 'etiquetas' AND app_conteudo_por_etiqueta(contents.id))
      -- RN-12, exceção (US-054): receita sugerida numa refeição do plano PUBLICADO do próprio paciente — SÓ no caminho
      -- do plano: "Meu plano" e a receita aberta pelo cartão ligam app.receitas_do_plano na própria transação
      -- (liberarReceitasDoPlano, set_config local). O feed, a busca, o filtro de etiquetas, o selo "Novo", os favoritos
      -- e o registro de visualização nunca ligam: lá a receita fora da audiência não existe.
      OR (tipo = 'receita' AND current_setting('app.receitas_do_plano', true) = 'on' AND EXISTS (
        SELECT 1 FROM meals m JOIN meal_plans pl ON pl.tenant_id = m.tenant_id AND pl.id = m.plan_id
         WHERE m.tenant_id = contents.tenant_id AND m.recipe_content_id = contents.id AND pl.status = 'publicado'))
    ))
  );
--> statement-breakpoint
CREATE POLICY paciente_conteudo_visivel ON recipes AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM contents c WHERE c.tenant_id = recipes.tenant_id AND c.id = recipes.content_id));
--> statement-breakpoint
CREATE POLICY paciente_conteudo_visivel ON recipe_ingredients AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM contents c WHERE c.tenant_id = recipe_ingredients.tenant_id AND c.id = recipe_ingredients.content_id));
--> statement-breakpoint
-- US-055 (defesa em profundidade, como a 0080): visualização e favorito só de conteúdo que o paciente vê PELA
-- AUDIÊNCIA — nunca com a liberação do plano ligada (D14: quem abre só pelo cartão, fora da audiência, não conta)
CREATE POLICY paciente_conteudo_visto ON content_views AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    current_setting('app.receitas_do_plano', true) IS DISTINCT FROM 'on' AND EXISTS (
      SELECT 1 FROM contents c WHERE c.tenant_id = content_views.tenant_id AND c.id = content_views.content_id)));
--> statement-breakpoint
CREATE POLICY paciente_conteudo_favorito ON content_favorites AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    current_setting('app.receitas_do_plano', true) IS DISTINCT FROM 'on' AND EXISTS (
      SELECT 1 FROM contents c WHERE c.tenant_id = content_favorites.tenant_id AND c.id = content_favorites.content_id)));
```

**Teste no cluster do runbook (dono sem superusuário)** — `src/db/migrate-owner.test.ts`. Nos testes comuns a função pertence ao superusuário (o `global-setup` migra como `postgres`) e ignora a RLS; em produção o dono é o migrator **sem** superusuário e **sem** BYPASSRLS, e com FORCE RLS a função só enxerga `patient_tag_links` (staff_only) porque troca `app.role` para `worker`. Se essa troca sumir numa refatoração, o CI ficaria verde e, em produção, todo conteúdo "Pacientes com etiqueta" sumiria para todos, sem erro. Mesmo precedente das funções da 0012 e da 0065 (já com caso neste arquivo). Acrescentar, no fim do `describe`:

```ts
  it('audiência por etiqueta (0083): a função SECURITY DEFINER do migrator sem superusuário enxerga patient_tag_links sob FORCE RLS e devolve o contexto do paciente', async () => {
    const c = await app.connect();
    const emWorker = async (t: string) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [t]);
    };
    const comoPaciente = async (t: string, p: string) => {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'paciente', true), set_config('app.patient_id', $2, true)`, [t, p]);
    };
    try {
      const t = (await c.query(`insert into tenants (slug, nome_exibicao) values ('aud-etiqueta', 'A') returning id`)).rows[0].id as string;
      await emWorker(t);
      const [ana, bia] = (
        await c.query(
          `insert into patients (tenant_id, nome, data_nascimento, sexo, email, status)
           values ($1, 'Ana', '1990-01-01', 'F', 'ana@aud.dev', 'ativo'), ($1, 'Bia', '1990-01-01', 'F', 'bia@aud.dev', 'ativo') returning id`,
          [t],
        )
      ).rows.map((r) => r.id as string);
      const tag = (await c.query(`insert into patient_tags (tenant_id, nome) values ($1, 'gestante') returning id`, [t])).rows[0].id as string;
      await c.query(`insert into patient_tag_links (tenant_id, patient_id, tag_id) values ($1, $2, $3)`, [t, ana, tag]);
      const conteudo = (
        await c.query(
          `insert into contents (tenant_id, tipo, titulo, visibilidade, status, publicado_em) values ($1, 'orientacao', 'Para gestantes', 'etiquetas', 'publicado', now()) returning id`,
          [t],
        )
      ).rows[0].id as string;
      await c.query(`insert into content_audience (tenant_id, content_id, tag_id) values ($1, $2, $3)`, [t, conteudo, tag]);
      await c.query('commit');

      await comoPaciente(t, ana);
      expect((await c.query('select count(*)::int as n from contents')).rows[0].n).toBe(1);
      const ctxDepois = await c.query(`select current_setting('app.role') as papel, current_setting('app.patient_id') as paciente`);
      expect(ctxDepois.rows[0]).toEqual({ papel: 'paciente', paciente: ana });
      // a sessão de paciente continua sem ver a etiqueta (staff_only)
      expect((await c.query('select count(*)::int as n from patient_tag_links')).rows[0].n).toBe(0);
      await c.query('rollback');

      await comoPaciente(t, bia);
      expect((await c.query('select count(*)::int as n from contents')).rows[0].n).toBe(0);
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
```

Run: `pnpm test src/db/migrate-owner.test.ts` → PASS (depois da migration).

- [ ] **Step 5: Módulo da audiência** — `src/modules/conteudo/audiencia.ts`

```ts
import { and, asc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contentAudience, patients, patientTagLinks, patientTags } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import type { Visibilidade } from './constantes';

export type AudienciaEnviada = { visibilidade: Visibilidade; pacientes: string[]; etiquetas: string[] };
export type OpcoesDeAudiencia = { etiquetas: { id: string; nome: string }[]; pacientes: { id: string; nome: string }[] };

/** Teto da lista de pacientes no formulário (ordem alfabética). */
export const PACIENTES_NA_LISTA = 500;

type Conteudo = string | AnyColumn | SQL;
const ativo = () => sql`${patients.status} = 'ativo' and ${patients.anonimizadoEm} is null`;
const porPaciente = (contentId: Conteudo) => sql`exists (select 1 from ${contentAudience} a
      where a.tenant_id = ${patients.tenantId} and a.content_id = ${contentId} and a.patient_id = ${patients.id})`;
const porEtiqueta = (contentId: Conteudo) => sql`exists (select 1 from ${contentAudience} a
      join ${patientTagLinks} l on l.tenant_id = a.tenant_id and l.tag_id = a.tag_id
      where a.tenant_id = ${patients.tenantId} and a.content_id = ${contentId} and l.patient_id = ${patients.id})`;

/**
 * RN-12 fora da sessão de paciente (aviso de conteúdo novo, métricas): condição SQL sobre `patients` — ativo, não
 * anonimizado e na audiência do conteúdo. A sessão de paciente NÃO usa isto: lá a RLS decide (0083).
 */
export function naAudiencia(contentId: string, visibilidade: Visibilidade): SQL {
  if (visibilidade === 'todos') return ativo();
  return sql`${ativo()} and ${visibilidade === 'pacientes' ? porPaciente(contentId) : porEtiqueta(contentId)}`;
}

/** A mesma condição com o conteúdo vindo da linha da consulta (id e visibilidade lidos do banco): métricas agrupadas (T11). */
export function naAudienciaDaLinha(contentId: AnyColumn | SQL, visibilidade: AnyColumn | SQL): SQL {
  return sql`${ativo()} and (${visibilidade} = 'todos'
      or (${visibilidade} = 'pacientes' and ${porPaciente(contentId)})
      or (${visibilidade} = 'etiquetas' and ${porEtiqueta(contentId)}))`;
}

/**
 * RN-12, exceção (US-054): libera, SÓ nesta transação (set_config local), a leitura das receitas sugeridas no plano
 * publicado do próprio paciente (política paciente_conteudo_visivel, 0083). Só "Meu plano" (`planoDoPaciente`,
 * src/modules/portal/plano.ts) e a receita aberta pelo cartão (`conteudoDoPaciente(…, { doPlano: true })`) chamam —
 * nunca o feed, a busca, os favoritos ou o registro de visualização (guarda em src/modules/portal/conteudos.test.ts).
 */
export const liberarReceitasDoPlano = (tx: Tx) => tx.execute(sql`select set_config('app.receitas_do_plano', 'on', true)`);

/** Os pacientes que o formulário mostra: ativos, não anonimizados, os PACIENTES_NA_LISTA primeiros por nome. */
const pacientesDoFormulario = (tx: Tx) =>
  tx
    .select({ id: patients.id, nome: patients.nome })
    .from(patients)
    .where(and(eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm)))
    .orderBy(asc(patients.nome), asc(patients.id))
    .limit(PACIENTES_NA_LISTA);

/**
 * Deixa o conteúdo com estes alvos (só os da visibilidade escolhida: "todos" limpa tudo). Vale só o que a RLS mostra
 * (paciente/etiqueta de outro tenant some) e paciente ativo, não anonimizado. D15: só sai o paciente que o formulário
 * MOSTROU e a nutricionista desmarcou — alvo arquivado, ou além dos PACIENTES_NA_LISTA, não aparece no formulário e
 * fica (desarquivado, volta à audiência). Trocar a visibilidade é escolha explícita e limpa os alvos do tipo anterior.
 * Grava só a diferença: o gatilho de auditoria (entidade `conteudos`, D6) registra o que mudou. Chamar com o conteúdo
 * travado. Devolve os alvos pedidos que valeram (para "Escolha pelo menos uma etiqueta ou um paciente.").
 */
export async function gravarAudiencia(tx: Tx, tenantId: string, contentId: string, a: AudienciaEnviada): Promise<{ pacientes: string[]; etiquetas: string[] }> {
  const pedidos = (ids: string[]) => [...new Set(ids.filter(idValido))];
  const pedP = a.visibilidade === 'pacientes' ? pedidos(a.pacientes) : [];
  const pedE = a.visibilidade === 'etiquetas' ? pedidos(a.etiquetas) : [];
  const pacientes = pedP.length
    ? (await tx.select({ id: patients.id }).from(patients).where(and(inArray(patients.id, pedP), eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm)))).map((r) => r.id)
    : [];
  const etiquetas = pedE.length ? (await tx.select({ id: patientTags.id }).from(patientTags).where(inArray(patientTags.id, pedE))).map((r) => r.id) : [];
  const atuais = await tx.select().from(contentAudience).where(eq(contentAudience.contentId, contentId));
  const exibidos =
    a.visibilidade === 'pacientes' && atuais.some((r) => r.patientId) ? new Set((await pacientesDoFormulario(tx)).map((p) => p.id)) : new Set<string>();
  const sair = atuais
    .filter((r) =>
      r.patientId
        ? a.visibilidade !== 'pacientes' || (exibidos.has(r.patientId) && !pacientes.includes(r.patientId))
        : !etiquetas.includes(r.tagId!),
    )
    .map((r) => r.id);
  if (sair.length) await tx.delete(contentAudience).where(inArray(contentAudience.id, sair));
  const temP = new Set(atuais.map((r) => r.patientId));
  const temE = new Set(atuais.map((r) => r.tagId));
  const novos = [
    ...pacientes.filter((id) => !temP.has(id)).map((patientId) => ({ tenantId, contentId, patientId })),
    ...etiquetas.filter((id) => !temE.has(id)).map((tagId) => ({ tenantId, contentId, tagId })),
  ];
  if (novos.length) await tx.insert(contentAudience).values(novos);
  return { pacientes: pedP.filter((id) => pacientes.includes(id)), etiquetas: pedE.filter((id) => etiquetas.includes(id)) };
}

export async function lerAudiencia(tx: Tx, contentId: string): Promise<{ pacientes: string[]; etiquetas: string[] }> {
  const rs = await tx.select({ patientId: contentAudience.patientId, tagId: contentAudience.tagId }).from(contentAudience).where(eq(contentAudience.contentId, contentId)).orderBy(asc(contentAudience.createdAt));
  return { pacientes: rs.flatMap((r) => (r.patientId ? [r.patientId] : [])), etiquetas: rs.flatMap((r) => (r.tagId ? [r.tagId] : [])) };
}

/** O que o formulário oferece: as etiquetas do tenant e os pacientes ativos (nome, sem auditoria — como a lista de pacientes, D6). */
export async function opcoesDeAudiencia(ctx: TenantContext, db: Db = getDb()): Promise<OpcoesDeAudiencia> {
  return withTenant(
    ctx,
    async (tx) => ({
      etiquetas: await tx.select({ id: patientTags.id, nome: patientTags.nome }).from(patientTags).orderBy(asc(patientTags.nome)),
      // a MESMA lista que gravarAudiencia usa para decidir o que pode sair (D15)
      pacientes: await pacientesDoFormulario(tx),
    }),
    db,
  );
}
```

- [ ] **Step 6: Guarda da política de audiência (teste falha, depois passa)** — `src/db/rls-guard.test.ts`:

```ts
describe('leitura por audiência (RN-12, Plano 07)', () => {
  it('toda tabela de CONTEUDO_POR_AUDIENCIA tem a política RESTRICTIVE de SELECT; a lista não cita tabela inexistente', async () => {
    expect(await findConteudoAudienciaViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { CONTEUDO_POR_AUDIENCIA })).toEqual([]);
  });
  it('perder a política quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_conteudo_visivel on recipe_ingredients');
      expect(await findConteudoAudienciaViolations(client)).toEqual([{ table: 'recipe_ingredients', problem: 'sem política paciente_conteudo_visivel (RN-12)' }]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
```

e em `src/db/rls-guard.ts`, depois de `findPacienteEscritaViolations`:

```ts
/**
 * RN-12 / D2 (Plano 07): tabelas sem patient_id que a sessão de paciente lê pela audiência do conteúdo — política
 * RESTRICTIVE `paciente_conteudo_visivel` (FOR SELECT, migration 0083). Tabela nova de conteúdo entra aqui.
 */
export const CONTEUDO_POR_AUDIENCIA: Record<string, string> = {
  contents: 'publicado e da audiência do paciente (todos, etiqueta via app_conteudo_por_etiqueta, pacientes) ou, só com liberarReceitasDoPlano, receita do plano publicado dele',
  recipes: 'herda de contents',
  recipe_ingredients: 'herda de contents',
};

export async function findConteudoAudienciaViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string }>(
    `select tablename as t from pg_policies
      where schemaname = 'public' and policyname = 'paciente_conteudo_visivel' and permissive = 'RESTRICTIVE' and cmd = 'SELECT'`,
  );
  const com = new Set(rows.map((r) => r.t));
  return Object.keys(CONTEUDO_POR_AUDIENCIA)
    .filter((t) => !com.has(t))
    .map((table) => ({ table, problem: 'sem política paciente_conteudo_visivel (RN-12)' }));
}
```

Run: `pnpm db:migrate` e `pnpm test src/modules/conteudo/audiencia.test.ts src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 7: CLAUDE.md** — na regra 2, depois da frase da sessão de paciente (Plano 06, D1), acrescentar: "Conteúdo (Plano 07, RN-12): tabela sem `patient_id` que o paciente lê pela audiência do conteúdo ganha a política RESTRICTIVE `paciente_conteudo_visivel` (FOR SELECT, herdando de `contents` por `EXISTS`) e a entrada em `CONTEUDO_POR_AUDIENCIA` (`src/db/rls-guard.ts`) — a guarda `findConteudoAudienciaViolations` quebra o CI se esquecer. O portal nunca filtra a audiência à mão; a etiqueta do paciente só por `app_conteudo_por_etiqueta`. A exceção da RN-12 (receita sugerida no plano publicado do próprio paciente, US-054) só vale com `liberarReceitasDoPlano(tx)` (`src/modules/conteudo/audiencia.ts`, `set_config` local à transação), chamada só por `planoDoPaciente` (`src/modules/portal/plano.ts`) e por `conteudoDoPaciente(…, { doPlano: true })` — nunca no feed, na busca, nos favoritos ou na visualização (guarda em `src/modules/portal/conteudos.test.ts`)."

- [ ] **Step 8: Commit**

```bash
git add drizzle/0083_audiencia_conteudos.sql drizzle/meta src/modules/conteudo/constantes.ts src/modules/conteudo/audiencia.ts src/modules/conteudo/audiencia.test.ts test/conteudos.ts src/db/rls-guard.ts src/db/rls-guard.test.ts src/db/migrate-owner.test.ts CLAUDE.md
git commit -m "feat(conteudo): audiência avaliada na leitura pela RLS (todos, etiquetas via SECURITY DEFINER, pacientes; receita do plano só no caminho do plano) — RN-12"
```

---
### Task 3: Vídeo por link, capa pelo oEmbed e processamento da capa (P07-02 a; US-050, RN-10, INT-05)

**Files:**
- Create: `src/modules/conteudo/video.ts` (+ `video.test.ts`), `src/modules/conteudo/oembed.ts` (+ `oembed.test.ts`), `src/modules/conteudo/capa.ts` (+ `capa.test.ts`), `src/lib/jpeg.ts`, `src/components/player-video.tsx`, `src/components/capa-conteudo.tsx`
- Modify: `src/modules/portal/diario-foto-job.ts` (o `paraJpeg` passa a usar `paraJpegSemMetadados` — mesmo pipeline, sem mudança de comportamento)

**Interfaces:**
- Consumes: `detectarTipo` (`src/lib/file-type.ts`), `TipoNaoPermitidoError` (`src/modules/plataforma/armazenamento.ts`), `logger`, `nomeDoErro` (`src/lib/logger.ts`), `ROTULO_TIPO_CONTEUDO`, `TipoConteudo` (Tarefa 2).
- Produces:
  - `@/modules/conteudo/video` (sem banco nem rede; o cliente importa): `type ProvedorVideo = 'youtube' | 'vimeo'`, `type VideoDoLink = { provider: ProvedorVideo; id: string }`, `lerLinkDeVideo(entrada: unknown): VideoDoLink | null`, `urlDoPlayer(v): string`, `urlDoVideo(v): string`, `videoDoConteudo(c: { videoProvider: string | null; videoId: string | null }): VideoDoLink | null`.
  - `@/modules/conteudo/oembed`: `miniaturaDoVideo(v: VideoDoLink, o?: { fetchImpl?: typeof fetch; prazoMs?: number }): Promise<Buffer | null>`, `urlDaMiniatura(u: unknown): string | null`, `OEMBED_PRAZO_MS = 5000`.
  - `@/lib/jpeg` (só `sharp`, sem HEIC — rota e worker importam): `paraJpegSemMetadados(img: Sharp, ladoMax: number): Promise<Buffer>` (reduz para caber em `ladoMax`, transparência sobre branco, JPEG 80 mozjpeg, sem metadados).
  - `@/modules/conteudo/capa`: `processarCapa(conteudo: Buffer, aceitos?: readonly ('jpg' | 'png' | 'webp')[]): Promise<Buffer>` (JPEG ≤ 1280 px, sem EXIF, fundo branco), `CAPA_LADO_MAX = 1280`.
  - `@/components/player-video`: `PlayerVideo({ video, titulo })`; `@/components/capa-conteudo`: `CapaDoConteudo({ tipo, capaUrl, className? })`.

- [ ] **Step 1: Teste do link (falha)** — `src/modules/conteudo/video.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { lerLinkDeVideo, urlDoPlayer, urlDoVideo, videoDoConteudo } from './video';

describe('link de vídeo (RN-10, INT-05, US-050)', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://youtu.be/dQw4w9WgXcQ?t=30', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['youtu.be/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['http://m.youtube.com/watch?v=dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ' }],
    ['https://vimeo.com/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://vimeo.com/76979871/abcdef1234', { provider: 'vimeo', id: '76979871/abcdef1234' }],
    ['https://vimeo.com/channels/staffpicks/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://player.vimeo.com/video/76979871?h=abcdef1234', { provider: 'vimeo', id: '76979871/abcdef1234' }],
  ])('aceita %s', (url, esperado) => {
    expect(lerLinkDeVideo(url)).toEqual(esperado);
  });

  it.each([
    'https://tiktok.com/@x/video/1', // US-050 "Domínio não suportado"
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com/youtu.be/dQw4w9WgXcQ',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://youtu.be/dQw4w9WgXc', // 10 caracteres
    'https://youtu.be/dQw4w9WgXcQQ', // 12
    'https://www.youtube.com/watch?v=dQw4w9W"><x',
    'https://user:senha@youtu.be/dQw4w9WgXcQ',
    'https://youtu.be:8443/dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL1',
    'https://vimeo.com/abc',
    'https://vimeo.com/76979871/ABC"x',
    'ftp://vimeo.com/76979871',
    '',
    'x'.repeat(600),
    42,
    null,
  ])('recusa %s', (url) => {
    expect(lerLinkDeVideo(url)).toBeNull();
  });

  it('player sem cookies (US-050) / sem rastreamento (D10), montado só do id', () => {
    expect(urlDoPlayer({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(urlDoPlayer({ provider: 'vimeo', id: '76979871' })).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(urlDoPlayer({ provider: 'vimeo', id: '76979871/abcdef1234' })).toBe('https://player.vimeo.com/video/76979871?h=abcdef1234&dnt=1');
    expect(urlDoVideo({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(urlDoVideo({ provider: 'vimeo', id: '76979871/abcdef1234' })).toBe('https://vimeo.com/76979871/abcdef1234');
  });

  it('videoDoConteudo relê o que o banco guardou (e recusa o que não bate com o provedor)', () => {
    expect(videoDoConteudo({ videoProvider: 'vimeo', videoId: '76979871/abcdef1234' })).toEqual({ provider: 'vimeo', id: '76979871/abcdef1234' });
    expect(videoDoConteudo({ videoProvider: 'youtube', videoId: '76979871' })).toBeNull();
    expect(videoDoConteudo({ videoProvider: null, videoId: null })).toBeNull();
  });
});
```

Run: `pnpm test src/modules/conteudo/video.test.ts` → FAIL (`./video` não existe).

- [ ] **Step 2: Implementação** — `src/modules/conteudo/video.ts`

```ts
/** RN-10 / INT-05 / D10. Sem banco e sem rede: o formulário (cliente), o servidor e o portal usam o mesmo. */
export type ProvedorVideo = 'youtube' | 'vimeo';
export type VideoDoLink = { provider: ProvedorVideo; id: string };

// os mesmos formatos do CHECK contents_video_id_valido (0081)
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/;
const HOSTS_YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const HOSTS_VIMEO = new Set(['vimeo.com', 'www.vimeo.com']);

const youtube = (id: string | null | undefined): VideoDoLink | null => (id && YT_ID.test(id) ? { provider: 'youtube', id } : null);
/** Vimeo não listado: o "hash" vai junto ("76979871/abcdef1234") — sem ele o player não abre. */
const vimeo = (id: string | undefined, hash: string | null | undefined): VideoDoLink | null => {
  if (!id || !VIMEO_ID.test(id)) return null;
  if (!hash) return { provider: 'vimeo', id };
  return VIMEO_HASH.test(hash) ? { provider: 'vimeo', id: `${id}/${hash}` } : null;
};

/**
 * US-050: a URL colada → provedor + id. Só youtube.com/youtu.be/vimeo.com (RN-10), sem usuário, senha ou porta;
 * qualquer outra coisa → null ("Use um link do YouTube ou do Vimeo"). Sem esquema ("youtu.be/…") vale como https.
 */
export function lerLinkDeVideo(entrada: unknown): VideoDoLink | null {
  if (typeof entrada !== 'string') return null;
  const texto = entrada.trim();
  if (!texto || texto.length > 500) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return partes.length === 1 ? youtube(partes[0]) : null;
  if (HOSTS_YOUTUBE.has(host)) {
    if (partes.length === 1 && partes[0] === 'watch') return youtube(u.searchParams.get('v'));
    if (partes.length === 2 && ['shorts', 'embed', 'live'].includes(partes[0])) return youtube(partes[1]);
    return null;
  }
  if (HOSTS_VIMEO.has(host)) {
    const resto = partes[0] === 'channels' && partes.length >= 3 ? partes.slice(2) : partes;
    if (resto.length === 1) return vimeo(resto[0], u.searchParams.get('h'));
    if (resto.length === 2) return vimeo(resto[0], resto[1]);
    return null;
  }
  if (host === 'player.vimeo.com' && partes.length === 2 && partes[0] === 'video') return vimeo(partes[1], u.searchParams.get('h'));
  return null;
}

/** D10: YouTube sem cookies; Vimeo com `dnt=1`. O src sai só do id validado, nunca da URL digitada. */
export function urlDoPlayer(v: VideoDoLink): string {
  if (v.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${v.id}`;
  const [id, h] = v.id.split('/');
  return `https://player.vimeo.com/video/${id}?${new URLSearchParams(h ? { h, dnt: '1' } : { dnt: '1' })}`;
}

/** O endereço canônico do vídeo: pedido ao oEmbed e o valor que o formulário mostra. */
export function urlDoVideo(v: VideoDoLink): string {
  return v.provider === 'youtube' ? `https://www.youtube.com/watch?v=${v.id}` : `https://vimeo.com/${v.id}`;
}

/** Relê `contents.video_provider/video_id` (o CHECK do banco já garante o formato; aqui é a segunda trava). */
export function videoDoConteudo(c: { videoProvider: string | null; videoId: string | null }): VideoDoLink | null {
  if (c.videoProvider === 'youtube') return youtube(c.videoId);
  if (c.videoProvider === 'vimeo' && c.videoId) {
    const [id, hash] = c.videoId.split('/');
    return vimeo(id, hash ?? null);
  }
  return null;
}
```

Run: `pnpm test src/modules/conteudo/video.test.ts` → PASS.

- [ ] **Step 3: Teste do oEmbed (falha)** — `src/modules/conteudo/oembed.test.ts`

```ts
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { miniaturaDoVideo, urlDaMiniatura } from './oembed';

let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#2a7' } }).jpeg().toBuffer();
});

type Resposta = { status?: number; corpo: string | Buffer; tipo?: string };
/** fetch falso: devolve as respostas na ordem e anota os endereços pedidos. */
function falso(...respostas: Resposta[]) {
  const pedidos: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push(String(url));
    expect(init?.redirect).toBe('error'); // D9: nunca segue redirecionamento
    const r = respostas.shift();
    if (!r) throw new Error('pedido a mais');
    return new Response(typeof r.corpo === 'string' ? r.corpo : new Uint8Array(r.corpo), { status: r.status ?? 200, headers: { 'content-type': r.tipo ?? 'application/json' } });
  }) as typeof fetch;
  return { f, pedidos };
}
const YT = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;
const oembed = (thumb: string) => ({ corpo: JSON.stringify({ title: 'x', thumbnail_url: thumb }) });

describe('capa do vídeo pelo oEmbed (INT-05, D9)', () => {
  it('YouTube: pede o oEmbed com a URL canônica e baixa a miniatura de i.ytimg.com', async () => {
    const { f, pedidos } = falso(oembed('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), { corpo: jpeg, tipo: 'image/jpeg' });
    const buf = await miniaturaDoVideo(YT, { fetchImpl: f });
    expect(buf?.equals(jpeg)).toBe(true);
    expect(pedidos).toEqual([
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ]);
  });

  it('Vimeo: oembed.json e i.vimeocdn.com', async () => {
    const { f, pedidos } = falso(oembed('https://i.vimeocdn.com/video/1.jpg'), { corpo: jpeg });
    expect(await miniaturaDoVideo({ provider: 'vimeo', id: '76979871' }, { fetchImpl: f })).not.toBeNull();
    expect(pedidos[0]).toBe('https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871&format=json');
  });

  it('miniatura de outro host, http ou com credenciais: nem pede (sem SSRF)', async () => {
    for (const thumb of ['https://169.254.169.254/latest', 'http://i.ytimg.com/x.jpg', 'https://u:p@i.ytimg.com/x.jpg', 'https://i.ytimg.com.evil.com/x.jpg']) {
      const { f, pedidos } = falso(oembed(thumb));
      expect(await miniaturaDoVideo(YT, { fetchImpl: f }), thumb).toBeNull();
      expect(pedidos, thumb).toHaveLength(1);
    }
  });

  it('erro, corpo grande, JSON inválido, miniatura que não é imagem → null (capa padrão)', async () => {
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso({ status: 404, corpo: 'Not Found' }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso({ corpo: 'x'.repeat(70 * 1024) }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso({ corpo: '<html>' }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso(oembed('https://i.ytimg.com/x.jpg'), { corpo: '<svg/>', tipo: 'image/svg+xml' }).f })).toBeNull();
    expect(await miniaturaDoVideo(YT, { fetchImpl: falso(oembed('https://i.ytimg.com/x.jpg'), { corpo: Buffer.alloc(3 * 1024 * 1024, 0xff) }).f })).toBeNull();
  });

  it('demora mais que o prazo (US-050: > 5 s) → null, sem esperar', async () => {
    const lento = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)))) as typeof fetch;
    const t0 = Date.now();
    expect(await miniaturaDoVideo(YT, { fetchImpl: lento, prazoMs: 50 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('urlDaMiniatura só aceita https de i.ytimg.com e i.vimeocdn.com', () => {
    expect(urlDaMiniatura('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg');
    expect(urlDaMiniatura('https://i.vimeocdn.com/video/1-d_640')).toBe('https://i.vimeocdn.com/video/1-d_640');
    for (const u of ['https://i.ytimg.com:444/x', 'https://ytimg.com/x', 42, null, 'nao é url']) expect(urlDaMiniatura(u)).toBeNull();
  });
});
```

Run: `pnpm test src/modules/conteudo/oembed.test.ts` → FAIL.

- [ ] **Step 4: Implementação** — `src/modules/conteudo/oembed.ts`

```ts
import { detectarTipo } from '@/lib/file-type';
import { logger, nomeDoErro } from '@/lib/logger';
import { urlDoVideo, type VideoDoLink } from './video';

/** US-050: "oEmbed indisponível (erro ou demora > 5 s) → salvo com a capa padrão". Prazo TOTAL (oEmbed + miniatura). */
export const OEMBED_PRAZO_MS = 5000;
const OEMBED_JSON_MAX = 64 * 1024;
const MINIATURA_MAX = 2 * 1024 * 1024;
const OEMBED: Record<VideoDoLink['provider'], string> = { youtube: 'https://www.youtube.com/oembed', vimeo: 'https://vimeo.com/api/oembed.json' };
/** D9: os únicos hosts de onde o servidor baixa a miniatura. */
const HOSTS_MINIATURA = new Set(['i.ytimg.com', 'i.vimeocdn.com']);

class OembedFalhou extends Error {
  override name = 'OembedFalhou';
}

/** O `thumbnail_url` do oEmbed, se for https de um host da lista (sem credenciais nem porta); senão null. */
export function urlDaMiniatura(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !HOSTS_MINIATURA.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Lê o corpo até `max` bytes (não confia no Content-Length); passou → erro. */
async function lerAte(r: Response, max: number): Promise<Buffer> {
  if (Number(r.headers.get('content-length') ?? 0) > max) {
    await r.body?.cancel().catch(() => undefined);
    throw new OembedFalhou('grande');
  }
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel().catch(() => undefined);
      throw new OembedFalhou('grande');
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

/**
 * INT-05 / D9: a miniatura do vídeo para virar a capa (baixada para /data: o PWA nunca carrega imagem de terceiros).
 * Chamar FORA de transação. Qualquer falha (rede, prazo, HTTP, JSON, host, tamanho, tipo) → null, e o conteúdo fica
 * com a capa padrão. RNF-11: o log leva só o provedor e o motivo, nunca a URL nem o corpo.
 */
export async function miniaturaDoVideo(v: VideoDoLink, o: { fetchImpl?: typeof fetch; prazoMs?: number } = {}): Promise<Buffer | null> {
  const f = o.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(o.prazoMs ?? OEMBED_PRAZO_MS);
  try {
    const url = `${OEMBED[v.provider]}?${new URLSearchParams({ url: urlDoVideo(v), format: 'json' })}`;
    const r = await f(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!r.ok) {
      await r.body?.cancel().catch(() => undefined);
      throw new OembedFalhou(`http_${r.status}`);
    }
    let dados: { thumbnail_url?: unknown };
    try {
      dados = JSON.parse((await lerAte(r, OEMBED_JSON_MAX)).toString('utf8'));
    } catch (e) {
      throw e instanceof OembedFalhou ? e : new OembedFalhou('json');
    }
    const miniatura = urlDaMiniatura(dados?.thumbnail_url);
    if (!miniatura) throw new OembedFalhou('host');
    const m = await f(miniatura, { signal, redirect: 'error' });
    if (!m.ok) {
      await m.body?.cancel().catch(() => undefined);
      throw new OembedFalhou(`http_${m.status}`);
    }
    const buf = await lerAte(m, MINIATURA_MAX);
    const tipo = detectarTipo(buf);
    if (!tipo || !['jpg', 'png', 'webp'].includes(tipo.ext)) throw new OembedFalhou('tipo');
    return buf;
  } catch (err) {
    logger.info({ provider: v.provider, motivo: err instanceof OembedFalhou ? err.message : nomeDoErro(err) }, 'capa do vídeo indisponível: capa padrão');
    return null;
  }
}
```

Run: `pnpm test src/modules/conteudo/oembed.test.ts` → PASS.

- [ ] **Step 5: Teste da capa (falha)** — `src/modules/conteudo/capa.test.ts`

```ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { CAPA_LADO_MAX, processarCapa } from './capa';

const imagem = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#fa0' } });

describe('capa do conteúdo (D8, US-051)', () => {
  it('PNG grande com EXIF → JPEG de no máximo 1280 px, sem metadados', async () => {
    const png = await imagem(3000, 2000).withExif({ IFD0: { Copyright: 'Fulana', ImageDescription: 'GPS aqui' } }).png().toBuffer();
    const out = await processarCapa(png);
    const m = await sharp(out).metadata();
    expect(m.format).toBe('jpeg');
    expect(Math.max(m.width!, m.height!)).toBe(CAPA_LADO_MAX);
    expect(m.exif).toBeUndefined();
  });

  it('não aumenta imagem pequena', async () => {
    const out = await processarCapa(await imagem(400, 300).jpeg().toBuffer());
    expect((await sharp(out).metadata()).width).toBe(400);
  });

  it('PNG com transparência → fundo branco (sem o flatten o JPEG sai preto), como a foto do diário', async () => {
    const transparente = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp(await processarCapa(transparente)).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(data[0], data[1], data[2])).toBeGreaterThan(245);
  });

  it('recusa o que não é JPEG/PNG (upload da nutricionista) e o arquivo corrompido', async () => {
    const webp = await imagem(10, 10).webp().toBuffer();
    await expect(processarCapa(webp, ['jpg', 'png'])).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    expect(await processarCapa(webp)).toBeInstanceOf(Buffer); // a miniatura do oEmbed pode vir em WebP
    await expect(processarCapa(Buffer.from('%PDF-1.7 x'))).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    const quebrado = Buffer.concat([(await imagem(50, 50).jpeg().toBuffer()).subarray(0, 40)]);
    await expect(processarCapa(quebrado)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
  });
});
```

Run: `pnpm test src/modules/conteudo/capa.test.ts` → FAIL.

- [ ] **Step 6: Implementação** — primeiro o pipeline comum, extraído do `paraJpeg` da foto do diário (Plano 06) para um arquivo só com `sharp` (o `diario-foto-job.ts` importa `heic-decode` e só o worker pode importá-lo; a capa roda na rota de upload) — `src/lib/jpeg.ts`:

```ts
import type { Sharp } from 'sharp';

/**
 * Pixels → JPEG que cabe em `ladoMax` × `ladoMax`, qualidade 80, sem metadados (o sharp só copia EXIF/GPS com
 * withMetadata). Transparência (PNG/WebP) sobre fundo BRANCO: sem o flatten, o JPEG pinta o transparente de preto.
 * Um pipeline só para a foto do diário (Plano 06, 1600 px) e a capa do conteúdo (Plano 07, 1280 px).
 */
export function paraJpegSemMetadados(img: Sharp, ladoMax: number): Promise<Buffer> {
  return img
    .resize({ width: ladoMax, height: ladoMax, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}
```

`src/modules/portal/diario-foto-job.ts`, em `paraJpeg`: trocar o `return img.resize(…).flatten(…).jpeg(…).toBuffer().catch(…)` por `return paraJpegSemMetadados(img, LADO_MAX).catch(() => { throw new FotoInvalidaError('conversao'); });` (importar de `@/lib/jpeg`; o comentário "Pixels → JPEG ≤ 1600 px…" fica). Run: `pnpm test src/modules/portal/diario-foto-job.test.ts` → PASS (sem mudança de comportamento).

`src/modules/conteudo/capa.ts`

```ts
import sharp from 'sharp';
import { detectarTipo } from '@/lib/file-type';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { logger, nomeDoErro } from '@/lib/logger';
import { TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';

export const CAPA_LADO_MAX = 1280;
type Aceito = 'jpg' | 'png' | 'webp';

/**
 * D8: toda capa vira JPEG ≤ 1280 px, qualidade 80, sem EXIF/GPS, transparência sobre branco — o mesmo pipeline da foto
 * do diário (`paraJpegSemMetadados`); `rotate()` aplica a orientação antes. Tipo pelo conteúdo; 40 MP no máximo (como
 * o logo). Upload da nutricionista: `['jpg', 'png']` (US-051); a miniatura do oEmbed também pode vir em WebP.
 */
export async function processarCapa(conteudo: Buffer, aceitos: readonly Aceito[] = ['jpg', 'png', 'webp']): Promise<Buffer> {
  const tipo = detectarTipo(conteudo);
  if (!tipo || !(aceitos as readonly string[]).includes(tipo.ext)) throw new TipoNaoPermitidoError();
  try {
    return await paraJpegSemMetadados(sharp(conteudo, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate(), CAPA_LADO_MAX);
  } catch (err) {
    logger.warn({ err: nomeDoErro(err) }, 'capa recusada pelo decodificador');
    throw new TipoNaoPermitidoError();
  }
}
```

Run: `pnpm test src/modules/conteudo/capa.test.ts` → PASS.

- [ ] **Step 7: Componentes** — `src/components/player-video.tsx`

```tsx
import { urlDoPlayer, type VideoDoLink } from '@/modules/conteudo/video';

/**
 * US-050 / D10: player sem cookies (YouTube) ou sem rastreamento (Vimeo `dnt=1`). O `src` sai só do id validado. O
 * YouTube recusa embed sem referrer: `strict-origin-when-cross-origin` manda só a origem (nunca o caminho do portal).
 */
export function PlayerVideo({ video, titulo }: { video: VideoDoLink; titulo: string }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
      <iframe
        src={urlDoPlayer(video)}
        title={`Vídeo: ${titulo}`}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
```

`src/components/capa-conteudo.tsx`

```tsx
import { ROTULO_TIPO_CONTEUDO, type TipoConteudo } from '@/modules/conteudo/constantes';

/**
 * A capa (URL assinada de 5 min, imagem decorativa: o título está ao lado) ou a "capa padrão" de US-050/D9 — um
 * bloco com o tipo, sem imagem de terceiros.
 */
export function CapaDoConteudo({ tipo, capaUrl, className = '' }: { tipo: TipoConteudo; capaUrl: string | null; className?: string }) {
  if (capaUrl)
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, fora do otimizador de imagens
    return <img src={capaUrl} alt="" className={`aspect-video w-full rounded object-cover ${className}`} />;
  return (
    <div aria-hidden="true" className={`flex aspect-video w-full items-center justify-center rounded bg-emerald-50 text-sm font-semibold text-emerald-900 ${className}`}>
      {ROTULO_TIPO_CONTEUDO[tipo]}
    </div>
  );
}
```

Teste do player — acrescentar a `src/modules/conteudo/video.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerVideo } from '@/components/player-video';

describe('PlayerVideo (D10)', () => {
  it('iframe do youtube-nocookie com título, lazy e referrer só da origem; nada de youtube.com/embed', () => {
    const html = renderToStaticMarkup(createElement(PlayerVideo, { video: { provider: 'youtube', id: 'dQw4w9WgXcQ' }, titulo: 'Como montar o prato' }));
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('title="Vídeo: Como montar o prato"');
    expect(html).toContain('loading="lazy"');
    expect(html).toMatch(/referrerpolicy="strict-origin-when-cross-origin"/i); // o React pode escrever o atributo em minúsculas
    expect(html).not.toContain('youtube.com/embed');
  });
});
```

Run: `pnpm test src/modules/conteudo src/modules/portal/diario-foto-job.test.ts` → PASS. `pnpm typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/conteudo/video.ts src/modules/conteudo/video.test.ts src/modules/conteudo/oembed.ts src/modules/conteudo/oembed.test.ts src/modules/conteudo/capa.ts src/modules/conteudo/capa.test.ts src/lib/jpeg.ts src/modules/portal/diario-foto-job.ts src/components/player-video.tsx src/components/capa-conteudo.tsx
git commit -m "feat(conteudo): link do YouTube/Vimeo, capa pelo oEmbed com prazo e hosts fixos, capa em JPEG sem EXIF e com fundo branco (pipeline da foto do diário), player sem cookies (RN-10, INT-05)"
```

---

### Task 4: Markdown seguro das orientações (P07-04 a; US-052, RNF-06)

**Files:**
- Create: `src/modules/conteudo/markdown.tsx`, `src/modules/conteudo/markdown.test.ts`

**Interfaces:**
- Consumes: nada (React só).
- Produces: `@/modules/conteudo/markdown` (sem banco; servidor e cliente): `type Inline`, `type Bloco`, `lerMarkdown(md: string): Bloco[]`, `lerInline(s: string): Inline[]`, `hrefSeguro(href: string): string | null`, componente `Markdown({ texto, className? })`.

- [ ] **Step 1: Teste (falha)** — `src/modules/conteudo/markdown.test.ts`

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hrefSeguro, lerMarkdown, Markdown } from './markdown';

const html = (texto: string) => renderToStaticMarkup(createElement(Markdown, { texto }));

describe('markdown das orientações (US-052: "sem HTML ou script executável", D7)', () => {
  it('negrito, itálico, títulos, listas, parágrafos e quebra de linha', () => {
    expect(html('## Como ler rótulos\n\nOlhe **sempre** a *porção*.\nDepois os ingredientes.\n\n- açúcar\n- sódio\n\n1. primeiro\n2. segundo')).toBe(
      '<h2>Como ler rótulos</h2><p>Olhe <strong>sempre</strong> a <em>porção</em>.<br/>Depois os ingredientes.</p>' +
        '<ul><li>açúcar</li><li>sódio</li></ul><ol><li>primeiro</li><li>segundo</li></ol>',
    );
    expect(html('# Título 1\n### Título 3\n#### Título 4')).toBe('<h2>Título 1</h2><h3>Título 3</h3><h3>Título 4</h3>');
  });

  it('HTML digitado vira texto (React escapa), nunca elemento', () => {
    const r = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:x">y</a>');
    expect(r).not.toMatch(/<script|<img|<a /);
    expect(r).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('link só http/https, com rel e nova aba; javascript:, data:, // e relativo viram o texto do link', () => {
    expect(html('[Guia](https://www.gov.br/anvisa)')).toBe(
      '<p><a href="https://www.gov.br/anvisa" target="_blank" rel="noopener noreferrer nofollow">Guia</a></p>',
    );
    for (const mau of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', '/p/inicio', 'https://u:p@evil.com']) {
      expect(html(`[clique](${mau})`), mau).toBe('<p>clique</p>');
    }
    expect(hrefSeguro('http://exemplo.com/a?b=1')).toBe('http://exemplo.com/a?b=1');
  });

  it('marcação sem fechar fica como texto; nada de retrocesso catastrófico (20000 asteriscos em menos de 200 ms)', () => {
    expect(html('**sem fechar')).toBe('<p>**sem fechar</p>');
    const t0 = performance.now();
    html('*'.repeat(20000));
    html(`[${'['.repeat(10000)}`);
    html('**a'.repeat(6000));
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('texto vazio não gera nada; espaços e linhas em branco a mais não viram parágrafos vazios', () => {
    expect(lerMarkdown('')).toEqual([]);
    expect(html('\n\n  \nA\n\n\n\nB\n')).toBe('<p>A</p><p>B</p>');
  });
});
```

Run: `pnpm test src/modules/conteudo/markdown.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/conteudo/markdown.tsx`

```tsx
import { Fragment, type ReactNode } from 'react';

/**
 * D7: subconjunto de markdown das orientações (US-052), renderizado como elementos React — nunca
 * `dangerouslySetInnerHTML`: HTML digitado sai escapado, como texto. Parágrafos (linha em branco separa; quebra simples
 * vira <br>), `**negrito**`, `*itálico*`, títulos `#`–`######` (viram h2/h3: o h1 é o título do conteúdo), listas
 * `-`/`*` e `1.`, links `[texto](https://…)`. Quantificadores limitados (sem retrocesso catastrófico) e profundidade
 * de aninhamento 3.
 */
export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'negrito'; filhos: Inline[] }
  | { t: 'italico'; filhos: Inline[] }
  | { t: 'link'; href: string; filhos: Inline[] };
export type Bloco =
  | { t: 'titulo'; nivel: 2 | 3; filhos: Inline[] }
  | { t: 'paragrafo'; linhas: Inline[][] }
  | { t: 'lista'; ordenada: boolean; itens: Inline[][] };

const TOKEN = /\*\*([^*\n]{1,500})\*\*|\*([^*\n]{1,500})\*|\[([^\]\n]{1,200})\]\(([^()\s]{1,500})\)/;
const TITULO = /^(#{1,6})\s+(.+)$/;
const ITEM = /^\s{0,3}(?:([-*])|(\d{1,3})[.)])\s+(.+)$/;

/** Link só http(s) absoluto, sem usuário/senha; o resto (javascript:, data:, //, relativo) → null. */
export function hrefSeguro(href: string): string | null {
  try {
    const u = new URL(href);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function lerInline(s: string, profundidade = 0): Inline[] {
  if (profundidade > 3) return [{ t: 'texto', v: s }];
  const out: Inline[] = [];
  let resto = s;
  while (resto) {
    const m = TOKEN.exec(resto);
    if (!m) {
      out.push({ t: 'texto', v: resto });
      break;
    }
    if (m.index > 0) out.push({ t: 'texto', v: resto.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: 'negrito', filhos: lerInline(m[1], profundidade + 1) });
    else if (m[2] !== undefined) out.push({ t: 'italico', filhos: lerInline(m[2], profundidade + 1) });
    else {
      const href = hrefSeguro(m[4]);
      out.push(href ? { t: 'link', href, filhos: lerInline(m[3], profundidade + 1) } : { t: 'texto', v: m[3] });
    }
    resto = resto.slice(m.index + m[0].length);
  }
  return out;
}

export function lerMarkdown(md: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: Inline[][] = [];
  let lista: { ordenada: boolean; itens: Inline[][] } | null = null;
  const fechar = () => {
    if (paragrafo.length) blocos.push({ t: 'paragrafo', linhas: paragrafo });
    if (lista) blocos.push({ t: 'lista', ...lista });
    paragrafo = [];
    lista = null;
  };
  for (const bruta of md.replace(/\r\n?/g, '\n').split('\n')) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) {
      fechar();
      continue;
    }
    const titulo = TITULO.exec(linha);
    if (titulo) {
      fechar();
      blocos.push({ t: 'titulo', nivel: titulo[1].length <= 2 ? 2 : 3, filhos: lerInline(titulo[2].trim()) });
      continue;
    }
    const item = ITEM.exec(linha);
    if (item) {
      const ordenada = item[2] !== undefined;
      if (paragrafo.length || (lista && lista.ordenada !== ordenada)) fechar();
      lista ??= { ordenada, itens: [] };
      lista.itens.push(lerInline(item[3].trim()));
      continue;
    }
    if (lista) fechar();
    paragrafo.push(lerInline(linha.trim()));
  }
  fechar();
  return blocos;
}

function Inlines({ itens }: { itens: Inline[] }): ReactNode {
  return itens.map((i, k) => {
    switch (i.t) {
      case 'texto':
        return <Fragment key={k}>{i.v}</Fragment>;
      case 'negrito':
        return <strong key={k}><Inlines itens={i.filhos} /></strong>;
      case 'italico':
        return <em key={k}><Inlines itens={i.filhos} /></em>;
      case 'link':
        return (
          <a key={k} href={i.href} target="_blank" rel="noopener noreferrer nofollow">
            <Inlines itens={i.filhos} />
          </a>
        );
    }
  });
}

export function Markdown({ texto, className }: { texto: string; className?: string }) {
  const blocos = lerMarkdown(texto).map((b, k) => {
    if (b.t === 'titulo') {
      const H = b.nivel === 2 ? 'h2' : 'h3';
      return <H key={k}><Inlines itens={b.filhos} /></H>;
    }
    if (b.t === 'lista') {
      const L = b.ordenada ? 'ol' : 'ul';
      return <L key={k}>{b.itens.map((it, j) => <li key={j}><Inlines itens={it} /></li>)}</L>;
    }
    return (
      <p key={k}>
        {b.linhas.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            <Inlines itens={l} />
          </Fragment>
        ))}
      </p>
    );
  });
  return className ? <div className={className}>{blocos}</div> : <>{blocos}</>;
}
```

Run: `pnpm test src/modules/conteudo/markdown.test.ts` → PASS. Conferir também: `git grep -n dangerouslySetInnerHTML -- src/modules/conteudo src/app` → nada.

- [ ] **Step 3: Commit**

```bash
git add src/modules/conteudo/markdown.tsx src/modules/conteudo/markdown.test.ts
git commit -m "feat(conteudo): markdown das orientações como elementos React, sem HTML e com links só http(s) (US-052, D7)"
```

---
### Task 5: Conteúdos no painel — criar, editar, público, capa e PDF, publicar, despublicar, excluir (P07-01 c, P07-02 b, P07-04 b; débito S-9)

**Files:**
- Create: `src/lib/mesma-origem.ts` (+ `mesma-origem.test.ts`), `src/modules/conteudo/erros.ts`, `src/modules/conteudo/arquivos.ts` (+ `arquivos.test.ts`), `src/modules/conteudo/conteudos.ts` (+ `conteudos.test.ts`), `src/app/api/painel/conteudos/[id]/capa/route.ts` (+ `route.test.ts`), `src/app/api/painel/conteudos/[id]/pdf/route.ts`, `src/app/painel/conteudos/page.tsx`, `src/app/painel/conteudos/novo/page.tsx`, `src/app/painel/conteudos/[id]/page.tsx`, `src/app/painel/conteudos/actions.ts`, `src/app/painel/conteudos/conteudo-form.tsx`, `src/app/painel/conteudos/arquivos.tsx`, `src/app/painel/conteudos/publicar-form.tsx`
- Modify: `src/app/painel/cabecalho.tsx`; as cinco rotas que copiavam a conferência de origem (`src/app/api/painel/marca/logo/route.ts`, `src/app/api/painel/pacientes/[id]/exames/route.ts`, `src/app/api/p/diario/route.ts`, `src/app/api/p/acesso/route.ts`, `src/app/api/p/push/route.ts`); `CLAUDE.md` (regra 9)

**Interfaces:**
- Consumes: `salvarArquivo`, `apagarArquivo`, `CotaEsgotadaError`, `TipoNaoPermitidoError`, `MSG_COTA_ESGOTADA` (`armazenamento.ts`); `signFileUrl`; `lerCorpoLimitado`, `CorpoGrandeError`, `CorpoLentoError`; `requireNutri`, `requireApiNutri`; `processarCapa` (T3), `miniaturaDoVideo` (T3), `lerLinkDeVideo`, `urlDoVideo`, `videoDoConteudo`, `VideoDoLink` (T3); `gravarAudiencia`, `lerAudiencia`, `opcoesDeAudiencia`, `OpcoesDeAudiencia` (T2); constantes (T2); `PlayerVideo`, `CapaDoConteudo` (T3); `Cabecalho`, `ConfirmarBotao`.
- Produces:
  - `@/lib/mesma-origem`: `mesmaOrigem(req: Request, appUrl?: string): boolean`.
  - `@/modules/conteudo/erros`: `ConteudoError` (`erros: Record<string, string>`), `ConteudoNaoEncontradoError`, `VideoTrocadoError` (a capa do oEmbed chegou depois de outro salvamento trocar o link).
  - `@/modules/conteudo/arquivos`: `trocarCapa(ctx, contentId, conteudo: Buffer, o?: { db?; dataDir?; aceitos?; tipos?: TipoConteudo[]; doVideo?: VideoDoLink }): Promise<string>`, `trocarPdf(ctx, contentId, conteudo, o?): Promise<string>`, `removerCapa(ctx, contentId, o?: { db?; dataDir?; doVideo?: VideoDoLink }): Promise<boolean>`, `removerPdf(ctx, contentId, o?): Promise<boolean>` (orientação publicada sem texto → `ConteudoError({ geral: MSG_CONTEUDO.publicadoVazio })`).
  - `@/modules/conteudo/conteudos`: `type EntradaConteudo`, `type Deps = { db?; dataDir?; agora?; fetchImpl? }`, `lerEtiquetasDoConteudo(v): string[] | null`, `validarConteudo(tipo, e)`, `criarConteudo(ctx, tipo, e, deps?): Promise<string>`, `salvarConteudo(ctx, id, e, deps?): Promise<void>`, `publicarConteudo(ctx, id, deps?): Promise<void>` (**a Tarefa 10 troca a assinatura** para `(ctx, id, opcoes: { avisar: boolean }, deps?) → { avisados: number }`), `despublicarConteudo(ctx, id, deps?)`, `excluirConteudo(ctx, id, deps?)`, `listarConteudosDoPainel(ctx, filtro?, db?): Promise<ConteudoDaLista[]>`, `carregarConteudoDoPainel(ctx, id, db?): Promise<ConteudoDoPainel | null>`; tipos `ConteudoDaLista = { id; tipo: TipoConteudo; titulo; status: 'rascunho' | 'publicado'; visibilidade: Visibilidade; publicadoEm: Date | null; atualizadoEm: Date }`, `ConteudoDoPainel = { id; tipo; titulo; resumo; corpoMd; etiquetas: string[]; visibilidade; status; publicadoEm: Date | null; video: VideoDoLink | null; link: string; capaUrl: string | null; pdfUrl: string | null; audiencia: { pacientes: string[]; etiquetas: string[] } }`.
  - Server Actions (`src/app/painel/conteudos/actions.ts`): `criarConteudoAction(tipo, s, fd)`, `salvarConteudoAction(id, s, fd)`, `publicarConteudoAction(id, s, fd)`, `despublicarConteudoAction(id)`, `excluirConteudoAction(id)`, `removerCapaAction(id)`, `removerPdfAction(id): Promise<{ erro?: string }>`; tipos `ValoresDoForm`, `ConteudoState`.
  - Componentes: `ConteudoForm`, `ArquivosDoConteudo`, `PublicarForm` (`src/app/painel/conteudos/`).

- [ ] **Step 1: S-9 — teste (falha)** — `src/lib/mesma-origem.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { mesmaOrigem } from './mesma-origem';

const req = (origin?: string) => new Request('http://localhost:3000/api/x', { method: 'POST', headers: origin === undefined ? {} : { origin } });
const APP = 'http://localhost:3000';

describe('mesmaOrigem (S-9)', () => {
  it('sem Origin passa; a própria origem passa; outra, vazia ou "null" é recusada', () => {
    expect(mesmaOrigem(req(), APP)).toBe(true);
    expect(mesmaOrigem(req('http://localhost:3000'), APP)).toBe(true);
    expect(mesmaOrigem(req('https://evil.example'), APP)).toBe(false);
    expect(mesmaOrigem(req(''), APP)).toBe(false); // antes, as rotas do painel deixavam passar (`origem &&`)
    expect(mesmaOrigem(req('null'), APP)).toBe(false);
  });
});
```

Run: `pnpm test src/lib/mesma-origem.test.ts` → FAIL.

- [ ] **Step 2: S-9 — implementação e as rotas existentes** — `src/lib/mesma-origem.ts`

```ts
import { getEnv } from '@/env';

/**
 * S-9 (P06-12): POST de Route Handler só da própria origem. Sem `Origin` passa (o cookie de sessão é SameSite=Lax, que já
 * não vai em POST entre sites); `Origin` presente e diferente — inclusive vazio ou "null" — é recusado. Um lugar só,
 * em vez da conferência copiada em cada rota (as do painel aceitavam o `Origin` vazio).
 */
export function mesmaOrigem(req: Request, appUrl: string = getEnv().APP_URL): boolean {
  const origem = req.headers.get('origin');
  return origem === null || origem === new URL(appUrl).origin;
}
```

Nas cinco rotas, trocar as duas linhas da conferência (`const origem = req.headers.get('origin'); if (origem … ) return …;`) por `if (!mesmaOrigem(req)) return <a mesma resposta 403 que a rota já devolvia>;` e importar `mesmaOrigem` de `@/lib/mesma-origem` (tirar o `getEnv` do import onde ele só servia para isso). Run: `pnpm test src/lib/mesma-origem.test.ts src/app/api` → PASS.

- [ ] **Step 3: Erros do módulo** — `src/modules/conteudo/erros.ts`

```ts
import { MSG_CONTEUDO } from './constantes';

/** Erros por campo (`titulo`, `resumo`, `etiquetas`, `visibilidade`, `link`, `corpo`, `geral`). */
export class ConteudoError extends Error {
  override name = 'ConteudoError';
  constructor(readonly erros: Record<string, string>) {
    super('Conteúdo inválido');
  }
}

export class ConteudoNaoEncontradoError extends Error {
  override name = 'ConteudoNaoEncontradoError';
  constructor() {
    super(MSG_CONTEUDO.naoEncontrado);
  }
}

/** D9: a capa do oEmbed chegou depois de outro salvamento trocar o link — a capa é do salvamento mais novo. */
export class VideoTrocadoError extends Error {
  override name = 'VideoTrocadoError';
}
```

- [ ] **Step 4: Teste dos arquivos (falha)** — `src/modules/conteudo/arquivos.test.ts`

```ts
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { novoTenant } from '../../../test/pacientes';
import { contents, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { COTA_BYTES, CotaEsgotadaError, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { removerCapa, removerPdf, trocarCapa, trocarPdf } from './arquivos';
import { MSG_CONTEUDO } from './constantes';
import { ConteudoNaoEncontradoError, VideoTrocadoError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#f80' } }).png().toBuffer();
});
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000)]);
const arquivos = (T: { ctx: Parameters<typeof withTenant>[0] }) =>
  withTenant(T.ctx, (tx) => tx.select({ tipo: storedFiles.tipo, caminho: storedFiles.caminho, patientId: storedFiles.patientId }).from(storedFiles), app.db);
const conteudo = (T: { ctx: Parameters<typeof withTenant>[0] }, id: string) => withTenant(T.ctx, (tx) => tx.select().from(contents).where(eq(contents.id, id)), app.db).then((r) => r[0]);

describe('capa e PDF do conteúdo (D8, regra 9)', () => {
  it('capa: PNG vira JPEG do consultório; trocar apaga a antiga; remover limpa o ponteiro e o arquivo', async () => {
    const T = await novoTenant(app.db);
    const c = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca' });
    const primeira = await trocarCapa(T.ctx, c.id, png, { ...deps, aceitos: ['jpg', 'png'] });
    expect(primeira).toMatch(new RegExp(`^${T.tenantId}/capa/.+\\.jpg$`));
    const segunda = await trocarCapa(T.ctx, c.id, png, deps);
    expect((await conteudo(T, c.id)).capaPath).toBe(segunda);
    expect(await arquivos(T)).toEqual([{ tipo: 'capa', caminho: segunda, patientId: null }]);
    expect(await removerCapa(T.ctx, c.id, deps)).toBe(true);
    expect((await conteudo(T, c.id)).capaPath).toBeNull();
    expect(await arquivos(T)).toEqual([]);
  });

  it('capa: WebP enviado pela nutricionista é recusado; capa enviada em vídeo não (só o oEmbed põe capa no vídeo)', async () => {
    const T = await novoTenant(app.db);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R' });
    const webp = await sharp(png).webp().toBuffer();
    await expect(trocarCapa(T.ctx, r.id, webp, { ...deps, aceitos: ['jpg', 'png'] })).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    const v = await novoConteudo(app.db, T, { tipo: 'video', titulo: 'V', videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ' });
    await expect(trocarCapa(T.ctx, v.id, png, { ...deps, tipos: ['receita', 'orientacao'] })).rejects.toBeInstanceOf(ConteudoNaoEncontradoError);
    expect(await arquivos(T)).toEqual([]);
  });

  it('D9: a capa do oEmbed (e a remoção dela) só vale se o conteúdo ainda aponta para o mesmo vídeo', async () => {
    const T = await novoTenant(app.db);
    const v = await novoConteudo(app.db, T, { tipo: 'video', titulo: 'V', videoProvider: 'vimeo', videoId: '76979871' });
    const antigo = { provider: 'youtube', id: 'dQw4w9WgXcQ' } as const;
    await expect(trocarCapa(T.ctx, v.id, png, { ...deps, doVideo: antigo })).rejects.toBeInstanceOf(VideoTrocadoError);
    expect(await arquivos(T)).toEqual([]); // nada gravado, cota intacta
    const capa = await trocarCapa(T.ctx, v.id, png, { ...deps, doVideo: { provider: 'vimeo', id: '76979871' } });
    expect(await removerCapa(T.ctx, v.id, { ...deps, doVideo: antigo })).toBe(false);
    expect((await conteudo(T, v.id)).capaPath).toBe(capa);
  });

  it('D17: orientação PUBLICADA sem texto não perde o PDF (ficaria vazia); com texto, perde', async () => {
    const T = await novoTenant(app.db);
    const o = await novoConteudo(app.db, T); // publicada, sem texto
    await trocarPdf(T.ctx, o.id, pdf, deps);
    await expect(removerPdf(T.ctx, o.id, deps)).rejects.toMatchObject({ erros: { geral: MSG_CONTEUDO.publicadoVazio } });
    expect((await conteudo(T, o.id)).pdfPath).not.toBeNull();
    expect(await arquivos(T)).toHaveLength(1);
    await withTenant(T.ctx, (tx) => tx.update(contents).set({ corpoMd: 'Leia a porção.' }).where(eq(contents.id, o.id)), app.db);
    expect(await removerPdf(T.ctx, o.id, deps)).toBe(true);
  });

  it('PDF: só na orientação; tipo pelo conteúdo; cota esgotada não grava nada', async () => {
    const T = await novoTenant(app.db);
    const o = await novoConteudo(app.db, T, { status: 'rascunho' }); // rascunho: tirar o PDF não esbarra na D17
    const caminho = await trocarPdf(T.ctx, o.id, pdf, deps);
    expect(caminho).toMatch(/\/orientacao_pdf\/.+\.pdf$/);
    await expect(trocarPdf(T.ctx, o.id, png, deps)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R' });
    await expect(trocarPdf(T.ctx, r.id, pdf, deps)).rejects.toBeInstanceOf(ConteudoNaoEncontradoError);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    await expect(trocarPdf(T.ctx, o.id, pdf, deps)).rejects.toBeInstanceOf(CotaEsgotadaError);
    expect((await conteudo(T, o.id)).pdfPath).toBe(caminho);
    expect(await removerPdf(T.ctx, o.id, deps)).toBe(true);
    expect(await removerPdf(T.ctx, o.id, deps)).toBe(false);
  });
});
```

Run: `pnpm test src/modules/conteudo/arquivos.test.ts` → FAIL.

- [ ] **Step 5: Arquivos — implementação** — `src/modules/conteudo/arquivos.ts`

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { apagarArquivo, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { processarCapa } from './capa';
import { MSG_CONTEUDO, TIPOS_CONTEUDO, type TipoConteudo } from './constantes';
import { ConteudoError, ConteudoNaoEncontradoError, VideoTrocadoError } from './erros';
import type { VideoDoLink } from './video';

type DepsArquivo = { db?: Db; dataDir?: string };
/** D9: a capa do oEmbed só vale enquanto o conteúdo aponta para este vídeo (conferido com a linha travada). */
type DoVideo = { doVideo?: VideoDoLink };
type Campo = 'capaPath' | 'pdfPath';
/** O `set` do ponteiro com a coluna nomeada (chave computada não tipa no Drizzle). */
const apontar = (campo: Campo, caminho: string | null) =>
  campo === 'capaPath' ? { capaPath: caminho, updatedAt: new Date() } : { pdfPath: caminho, updatedAt: new Date() };
const outroVideo = (c: { videoProvider: string | null; videoId: string | null }, v: VideoDoLink | undefined) =>
  Boolean(v) && (c.videoProvider !== v!.provider || c.videoId !== v!.id);

/**
 * Regra 9: o arquivo entra por salvarArquivo e o ponteiro em `contents` é gravado no `registrar` (mesma transação);
 * o antigo sai por apagarArquivo, cujo `naMesmaTransacao` confere que nada aponta mais para ele. Ordem de travas igual
 * à de salvarArquivo: conteúdo (antesDaReserva, FOR UPDATE) → tenant (cota) → registro.
 */
async function trocar(
  ctx: TenantContext,
  contentId: string,
  campo: Campo,
  arquivo: { tipo: 'capa' | 'orientacao_pdf'; conteudo: Buffer; permitidos: readonly ('jpg' | 'pdf')[] },
  tipos: readonly TipoConteudo[],
  o: DepsArquivo & DoVideo,
): Promise<string> {
  if (!idValido(contentId)) throw new ConteudoNaoEncontradoError();
  let antigo: string | null = null;
  const salvo = await salvarArquivo(
    ctx,
    {
      tipo: arquivo.tipo,
      conteudo: arquivo.conteudo,
      permitidos: arquivo.permitidos,
      antesDaReserva: async (tx) => {
        const [c] = await tx
          .select({ tipo: contents.tipo, atual: contents[campo], videoProvider: contents.videoProvider, videoId: contents.videoId })
          .from(contents)
          .where(eq(contents.id, contentId))
          .for('update');
        if (!c || !tipos.includes(c.tipo as TipoConteudo)) throw new ConteudoNaoEncontradoError();
        // D9: outro salvamento trocou o link depois do oEmbed deste — desiste (rollback: nada gravado, cota intacta)
        if (outroVideo(c, o.doVideo)) throw new VideoTrocadoError();
        antigo = c.atual;
      },
      registrar: async (tx, a) => {
        await tx.update(contents).set(apontar(campo, a.caminho)).where(eq(contents.id, contentId));
      },
    },
    o,
  );
  if (antigo) await apagarSolto(ctx, contentId, campo, antigo, o);
  return salvo.caminho;
}

/** Apaga um arquivo que o conteúdo deixou de apontar (se ainda aponta — outra troca no meio —, fica). */
async function apagarSolto(ctx: TenantContext, contentId: string, campo: Campo, caminho: string, o: DepsArquivo): Promise<void> {
  await apagarArquivo(ctx, { caminho }, {
    ...o,
    naMesmaTransacao: async (tx: Tx) => {
      const [c] = await tx.select({ atual: contents[campo] }).from(contents).where(eq(contents.id, contentId)).for('update');
      return !c || c.atual !== caminho;
    },
  });
}

/**
 * D8: capa em JPEG ≤ 1280 px sem EXIF. Upload da nutricionista: `aceitos: ['jpg','png']`, `tipos: ['receita','orientacao']`.
 * Capa do oEmbed: `doVideo` — só entra se o conteúdo ainda aponta para esse vídeo (senão `VideoTrocadoError`).
 */
export async function trocarCapa(
  ctx: TenantContext,
  contentId: string,
  conteudo: Buffer,
  o: DepsArquivo & DoVideo & { aceitos?: readonly ('jpg' | 'png' | 'webp')[]; tipos?: readonly TipoConteudo[] } = {},
): Promise<string> {
  const jpeg = await processarCapa(conteudo, o.aceitos);
  return trocar(ctx, contentId, 'capaPath', { tipo: 'capa', conteudo: jpeg, permitidos: ['jpg'] }, o.tipos ?? TIPOS_CONTEUDO, o);
}

/** US-052: o PDF da orientação (tipo pelo conteúdo; D20: ≤ 10 MB, conferido na rota). */
export async function trocarPdf(ctx: TenantContext, contentId: string, conteudo: Buffer, o: DepsArquivo = {}): Promise<string> {
  return trocar(ctx, contentId, 'pdfPath', { tipo: 'orientacao_pdf', conteudo, permitidos: ['pdf'] }, ['orientacao'], o);
}

/**
 * Tira o arquivo do conteúdo: o ponteiro é limpo no `naMesmaTransacao` de apagarArquivo (regra 9), com a linha
 * travada. D17: o PDF de uma orientação PUBLICADA sem texto não sai (ela ficaria publicada vazia). D9: com `doVideo`,
 * só remove se o conteúdo ainda aponta para esse vídeo.
 */
async function remover(ctx: TenantContext, contentId: string, campo: Campo, o: DepsArquivo & DoVideo): Promise<boolean> {
  if (!idValido(contentId)) return false;
  const db = o.db ?? getDb();
  const [c] = await withTenant(ctx, (tx) => tx.select({ atual: contents[campo] }).from(contents).where(eq(contents.id, contentId)), db);
  if (!c?.atual) return false;
  const caminho = c.atual;
  return apagarArquivo(ctx, { caminho }, {
    ...o,
    naMesmaTransacao: async (tx) => {
      const [x] = await tx
        .select({ atual: contents[campo], status: contents.status, corpoMd: contents.corpoMd, videoProvider: contents.videoProvider, videoId: contents.videoId })
        .from(contents)
        .where(eq(contents.id, contentId))
        .for('update');
      if (!x || x.atual !== caminho || outroVideo(x, o.doVideo)) return false;
      if (campo === 'pdfPath' && x.status === 'publicado' && !x.corpoMd) throw new ConteudoError({ geral: MSG_CONTEUDO.publicadoVazio });
      await tx.update(contents).set(apontar(campo, null)).where(eq(contents.id, contentId));
      return true;
    },
  });
}

export const removerCapa = (ctx: TenantContext, contentId: string, o: DepsArquivo & DoVideo = {}) => remover(ctx, contentId, 'capaPath', o);
export const removerPdf = (ctx: TenantContext, contentId: string, o: DepsArquivo = {}) => remover(ctx, contentId, 'pdfPath', o);
```

Run: `pnpm test src/modules/conteudo/arquivos.test.ts` → PASS.

- [ ] **Step 6: Teste do núcleo (falha)** — `src/modules/conteudo/conteudos.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novaEtiqueta } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { contents, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { trocarCapa, trocarPdf } from './arquivos';
import { MSG_CONTEUDO } from './constantes';
import { carregarConteudoDoPainel, criarConteudo, despublicarConteudo, excluirConteudo, listarConteudosDoPainel, publicarConteudo, salvarConteudo, validarConteudo } from './conteudos';
import { ConteudoError } from './erros';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#09f' } }).jpeg().toBuffer();
});
/** oEmbed que responde: o JSON aponta para i.ytimg.com e a miniatura é o JPEG acima. */
const oembedOk = (async (url: string | URL | Request) =>
  String(url).includes('oembed')
    ? Response.json({ thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
    : new Response(new Uint8Array(jpeg))) as typeof fetch;
const oembedFora = (async () => {
  throw new TypeError('fetch failed');
}) as typeof fetch;
const base = { titulo: 'Como montar o prato', resumo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConteudoError) return e.erros;
    throw e;
  }
  throw new Error('não falhou');
};
const capas = (T: { ctx: Parameters<typeof withTenant>[0] }) =>
  withTenant(T.ctx, (tx) => tx.select({ caminho: storedFiles.caminho }).from(storedFiles).where(eq(storedFiles.tipo, 'capa')), app.db);

describe('validação (US-050 a US-053)', () => {
  it('mensagens por campo', () => {
    const e = (tipo: 'video' | 'receita' | 'orientacao', x: Record<string, unknown>) => {
      try {
        validarConteudo(tipo, { ...base, ...x });
        return {};
      } catch (err) {
        return (err as ConteudoError).erros;
      }
    };
    expect(e('orientacao', { titulo: '  ' })).toEqual({ titulo: MSG_CONTEUDO.titulo });
    expect(e('orientacao', { resumo: 'x'.repeat(301) })).toEqual({ resumo: MSG_CONTEUDO.resumo });
    expect(e('orientacao', { etiquetas: Array.from({ length: 11 }, (_, i) => `e${i}`).join(',') })).toEqual({ etiquetas: MSG_CONTEUDO.etiquetas });
    expect(e('orientacao', { visibilidade: 'publico' })).toEqual({ visibilidade: MSG_CONTEUDO.visibilidade });
    expect(e('orientacao', { visibilidade: 'pacientes', pacientes: ['nao-e-id'] })).toEqual({ visibilidade: MSG_CONTEUDO.audienciaVazia });
    expect(e('video', { link: 'https://tiktok.com/@x/video/1' })).toEqual({ link: 'Use um link do YouTube ou do Vimeo' });
    expect(e('receita', { link: 'https://tiktok.com/@x/video/1' })).toEqual({ link: 'Use um link do YouTube ou do Vimeo' });
    expect(e('receita', { link: '' })).toEqual({}); // vídeo opcional na receita (US-051)
    expect(e('orientacao', { corpo: 'x'.repeat(20001) })).toEqual({ corpo: MSG_CONTEUDO.corpo });
    expect(validarConteudo('orientacao', { ...base, etiquetas: 'sem lactose, Sem Lactose ,café da manhã,,' }).etiquetas).toEqual(['sem lactose', 'café da manhã']);
  });
});

describe('vídeo por link (US-050, INT-05)', () => {
  it('"https://youtu.be/dQw4w9WgXcQ" + "Como montar o prato" → youtube/dQw4w9WgXcQ, capa baixada para /data, rascunho', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedOk });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(contents).where(eq(contents.id, id)), app.db);
    expect(c).toMatchObject({ tipo: 'video', titulo: 'Como montar o prato', videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ', status: 'rascunho' });
    expect(c.capaPath).toMatch(new RegExp(`^${T.tenantId}/capa/`));
    const p = await carregarConteudoDoPainel(T.ctx, id, app.db);
    expect(p).toMatchObject({ link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video: { provider: 'youtube', id: 'dQw4w9WgXcQ' } });
    expect(p!.capaUrl).toMatch(/^\/api\/arquivos\?/);
  });

  it('oEmbed indisponível → salvo com a capa padrão (sem capa); trocar o link troca a capa; link que falha tira a antiga', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedFora });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.capaUrl).toBeNull();
    await salvarConteudo(T.ctx, id, { ...base, link: 'https://vimeo.com/76979871' }, { db: app.db, fetchImpl: oembedOk });
    const [primeira] = await capas(T);
    expect(primeira).toBeDefined();
    await salvarConteudo(T.ctx, id, { ...base, titulo: 'Só o título', link: 'https://vimeo.com/76979871' }, { db: app.db, fetchImpl: oembedFora }); // mesmo vídeo: nem pede o oEmbed
    expect(await capas(T)).toEqual([primeira]);
    await salvarConteudo(T.ctx, id, { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedFora });
    expect(await capas(T)).toEqual([]);
  });

  it('dois salvamentos sobrepostos: a capa do link anterior, que chega depois do oEmbed, não fica (D9)', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db: app.db, fetchImpl: oembedFora });
    let segundo: Promise<void> | undefined;
    let capaDoSegundo: string | null = null;
    // o oEmbed do 1º salvamento (→ Vimeo) só responde depois que um 2º salvamento (→ outro YouTube) termina com a capa dele
    const lento = (async (url: string | URL | Request) => {
      segundo ??= salvarConteudo(T.ctx, id, { ...base, link: 'https://youtu.be/9bZkp7q19f0' }, { db: app.db, fetchImpl: oembedOk }).then(async () => {
        capaDoSegundo = (await withTenant(T.ctx, (tx) => tx.select({ c: contents.capaPath }).from(contents).where(eq(contents.id, id)), app.db))[0].c;
      });
      await segundo;
      return oembedOk(url);
    }) as typeof fetch;
    await salvarConteudo(T.ctx, id, { ...base, link: 'https://vimeo.com/76979871' }, { db: app.db, fetchImpl: lento });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(contents).where(eq(contents.id, id)), app.db);
    expect(c).toMatchObject({ videoProvider: 'youtube', videoId: '9bZkp7q19f0' });
    expect(capaDoSegundo).not.toBeNull();
    expect(c.capaPath).toBe(capaDoSegundo); // sem a conferência do vídeo, a capa do Vimeo trocaria esta
    expect(await capas(T)).toEqual([{ caminho: capaDoSegundo }]);
  });
});

describe('público do conteúdo (US-053)', () => {
  it('"pacientes" grava os alvos; só paciente de outro consultório → "Escolha pelo menos uma etiqueta ou um paciente." e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const deFora = await novoPaciente(app.db, U.ctx);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, visibilidade: 'pacientes', pacientes: [ana.id] }, { db: app.db });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.audiencia).toEqual({ pacientes: [ana.id], etiquetas: [] });
    expect(await erros(criarConteudo(T.ctx, 'orientacao', { ...base, titulo: 'Outro', visibilidade: 'pacientes', pacientes: [deFora.id] }, { db: app.db }))).toEqual({
      visibilidade: MSG_CONTEUDO.audienciaVazia,
    });
    expect((await listarConteudosDoPainel(T.ctx, {}, app.db)).map((c) => c.titulo)).toEqual([base.titulo]);
    const gestante = await novaEtiqueta(app.db, T, 'gestante');
    await salvarConteudo(T.ctx, id, { ...base, visibilidade: 'etiquetas', tags: [gestante] }, { db: app.db });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.audiencia).toEqual({ pacientes: [], etiquetas: [gestante] });
  });
});

describe('publicar, despublicar, excluir (D17)', () => {
  it('orientação sem texto nem PDF não publica; com texto publica com a data; despublicar volta a rascunho', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, titulo: 'Como ler rótulos' }, { db: app.db });
    expect(await erros(publicarConteudo(T.ctx, id, { db: app.db }))).toEqual({ geral: MSG_CONTEUDO.orientacaoVazia });
    await salvarConteudo(T.ctx, id, { ...base, titulo: 'Como ler rótulos', corpo: '## Rótulos\n\nLeia a **porção**.' }, { db: app.db });
    const agora = new Date('2026-10-20T13:00:00Z');
    await publicarConteudo(T.ctx, id, { db: app.db, agora });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toMatchObject({ status: 'publicado', publicadoEm: agora, corpoMd: '## Rótulos\n\nLeia a **porção**.' });
    await despublicarConteudo(T.ctx, id, { db: app.db });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toMatchObject({ status: 'rascunho', publicadoEm: null });
  });

  it('orientação PUBLICADA não fica vazia: salvar sem texto (e sem PDF) é recusado; no rascunho pode', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, corpo: 'Leia a porção.' }, { db: app.db });
    await publicarConteudo(T.ctx, id, { db: app.db });
    expect(await erros(salvarConteudo(T.ctx, id, { ...base, corpo: '   ' }, { db: app.db }))).toEqual({ corpo: MSG_CONTEUDO.publicadoVazio });
    expect((await carregarConteudoDoPainel(T.ctx, id, app.db))!.corpoMd).toBe('Leia a porção.');
    await despublicarConteudo(T.ctx, id, { db: app.db });
    await salvarConteudo(T.ctx, id, { ...base, corpo: '' }, { db: app.db });
  });

  it('receita sem ingredientes não publica', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'receita', { ...base, titulo: 'Panqueca de aveia' }, { db: app.db });
    expect(await erros(publicarConteudo(T.ctx, id, { db: app.db }))).toEqual({ geral: MSG_CONTEUDO.receitaIncompleta });
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) values (${T.tenantId}, ${id}, 1000, 250)`);
      await tx.execute(sql`insert into recipe_ingredients (tenant_id, content_id, food_id, quantidade_g, ordem) values (${T.tenantId}, ${id}, ${idTaco(3)}, 200, 0)`);
    }, app.db);
    await publicarConteudo(T.ctx, id, { db: app.db });
  });

  it('excluir apaga capa e PDF (regra 9) e devolve o espaço', async () => {
    const T = await novoTenant(app.db);
    const id = await criarConteudo(T.ctx, 'orientacao', { ...base, corpo: 'x' }, { db: app.db });
    await trocarCapa(T.ctx, id, jpeg, { db: app.db });
    await trocarPdf(T.ctx, id, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]), { db: app.db });
    await excluirConteudo(T.ctx, id, { db: app.db });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toBeNull();
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    const [t] = await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.b).toBe(0);
  });

  it('excluir com um envio de capa ao mesmo tempo: nunca sobra arquivo sem conteúdo nem cota contada (regra 9)', async () => {
    for (let i = 0; i < 5; i++) {
      const T = await novoTenant(app.db);
      const id = await criarConteudo(T.ctx, 'orientacao', { ...base, corpo: 'x' }, { db: app.db });
      await trocarPdf(T.ctx, id, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]), { db: app.db });
      await Promise.allSettled([excluirConteudo(T.ctx, id, { db: app.db }), trocarCapa(T.ctx, id, jpeg, { db: app.db })]);
      const resta = await carregarConteudoDoPainel(T.ctx, id, app.db);
      const guardados = await withTenant(T.ctx, (tx) => tx.select({ caminho: storedFiles.caminho, bytes: storedFiles.bytes }).from(storedFiles), app.db);
      const [t] = await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId));
      expect(t.b).toBe(guardados.reduce((s, f) => s + f.bytes, 0));
      if (!resta) expect(guardados).toEqual([]);
    }
  });

  it('id inválido ou de outro tenant: não encontrado (nunca 500)', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const id = await criarConteudo(U.ctx, 'orientacao', base, { db: app.db });
    expect(await carregarConteudoDoPainel(T.ctx, id, app.db)).toBeNull();
    expect(await carregarConteudoDoPainel(T.ctx, 'lixo', app.db)).toBeNull();
    await expect(salvarConteudo(T.ctx, id, base, { db: app.db })).rejects.toThrow(MSG_CONTEUDO.naoEncontrado);
  });
});
```

Run: `pnpm test src/modules/conteudo/conteudos.test.ts` → FAIL.

- [ ] **Step 7: Núcleo — implementação** — `src/modules/conteudo/conteudos.ts`

```ts
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents, recipeIngredients, type ContentRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { signFileUrl } from '@/lib/signed-url';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { apagarArquivo, CotaEsgotadaError, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { removerCapa, trocarCapa } from './arquivos';
import { gravarAudiencia, lerAudiencia } from './audiencia';
import { CORPO_MAX, ehVisibilidade, ETIQUETA_MAX, ETIQUETAS_MAX, MSG_CONTEUDO, RESUMO_MAX, TITULO_MAX, type TipoConteudo, type Visibilidade } from './constantes';
import { ConteudoError, ConteudoNaoEncontradoError, VideoTrocadoError } from './erros';
import { miniaturaDoVideo } from './oembed';
import { lerLinkDeVideo, urlDoVideo, videoDoConteudo, type VideoDoLink } from './video';

export type EntradaConteudo = { titulo?: unknown; resumo?: unknown; etiquetas?: unknown; visibilidade?: unknown; pacientes?: unknown; tags?: unknown; link?: unknown; corpo?: unknown };
export type Deps = { db?: Db; dataDir?: string; agora?: Date; fetchImpl?: typeof fetch };
type Validado = { titulo: string; resumo: string; etiquetas: string[]; visibilidade: Visibilidade; pacientes: string[]; tags: string[]; video: VideoDoLink | null; corpoMd: string };

export type ConteudoDaLista = { id: string; tipo: TipoConteudo; titulo: string; status: 'rascunho' | 'publicado'; visibilidade: Visibilidade; publicadoEm: Date | null; atualizadoEm: Date };
export type ConteudoDoPainel = {
  id: string;
  tipo: TipoConteudo;
  titulo: string;
  resumo: string;
  corpoMd: string;
  etiquetas: string[];
  visibilidade: Visibilidade;
  status: 'rascunho' | 'publicado';
  publicadoEm: Date | null;
  video: VideoDoLink | null;
  /** O link canônico do vídeo, para o campo do formulário ('' sem vídeo). */
  link: string;
  capaUrl: string | null;
  pdfUrl: string | null;
  audiencia: { pacientes: string[]; etiquetas: string[] };
};

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** "sem lactose, Sem Lactose, café da manhã" → ['sem lactose', 'café da manhã']; passou do limite → null. */
export function lerEtiquetasDoConteudo(v: unknown): string[] | null {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const bruta of typeof v === 'string' ? v.split(',') : textos(v)) {
    const e = normalizarTexto(bruta);
    if (!e) continue;
    if (e.length > ETIQUETA_MAX) return null;
    const chave = e.toLocaleLowerCase('pt-BR');
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    out.push(e);
  }
  return out.length > ETIQUETAS_MAX ? null : out;
}

/** Validação completa antes de tocar no banco: erro por campo, nunca gravação parcial. */
export function validarConteudo(tipo: TipoConteudo, e: EntradaConteudo): Validado {
  const erros: Record<string, string> = {};
  const titulo = normalizarTexto(e.titulo);
  if (!titulo || titulo.length > TITULO_MAX) erros.titulo = MSG_CONTEUDO.titulo;
  const resumo = typeof e.resumo === 'string' ? e.resumo.trim() : '';
  if (resumo.length > RESUMO_MAX) erros.resumo = MSG_CONTEUDO.resumo;
  const etiquetas = lerEtiquetasDoConteudo(e.etiquetas);
  if (!etiquetas) erros.etiquetas = MSG_CONTEUDO.etiquetas;
  const visibilidade = ehVisibilidade(e.visibilidade) ? e.visibilidade : null;
  const pacientes = textos(e.pacientes).filter(idValido);
  const tags = textos(e.tags).filter(idValido);
  if (!visibilidade) erros.visibilidade = MSG_CONTEUDO.visibilidade;
  else if ((visibilidade === 'pacientes' && !pacientes.length) || (visibilidade === 'etiquetas' && !tags.length)) erros.visibilidade = MSG_CONTEUDO.audienciaVazia;
  const link = typeof e.link === 'string' ? e.link.trim() : '';
  const video = tipo === 'orientacao' || !link ? null : lerLinkDeVideo(link);
  if ((tipo === 'video' && !video) || (tipo === 'receita' && link && !video)) erros.link = MSG_CONTEUDO.videoDominio;
  const corpoMd = tipo === 'orientacao' && typeof e.corpo === 'string' ? e.corpo.replace(/\r\n?/g, '\n').trim() : '';
  if (corpoMd.length > CORPO_MAX) erros.corpo = MSG_CONTEUDO.corpo;
  if (Object.keys(erros).length) throw new ConteudoError(erros);
  return { titulo, resumo, etiquetas: etiquetas!, visibilidade: visibilidade!, pacientes, tags, video, corpoMd };
}

const colunas = (v: Validado, agora: Date) => ({
  titulo: v.titulo,
  resumo: v.resumo,
  etiquetas: v.etiquetas,
  visibilidade: v.visibilidade,
  corpoMd: v.corpoMd,
  videoProvider: v.video?.provider ?? null,
  videoId: v.video?.id ?? null,
  updatedAt: agora,
});

/** Grava o público e confere que sobrou alguém (paciente de outro tenant/arquivado some em gravarAudiencia). */
async function gravarPublico(tx: Tx, tenantId: string, contentId: string, v: Validado): Promise<void> {
  const a = await gravarAudiencia(tx, tenantId, contentId, { visibilidade: v.visibilidade, pacientes: v.pacientes, etiquetas: v.tags });
  if (v.visibilidade !== 'todos' && !a.pacientes.length && !a.etiquetas.length) throw new ConteudoError({ visibilidade: MSG_CONTEUDO.audienciaVazia });
}

/**
 * D9: capa do vídeo pelo oEmbed, FORA da transação. Falhou (ou a cota acabou) → sem capa: a capa padrão (US-050 não
 * bloqueia o cadastro). Só o tipo `video`: na receita, a capa é a enviada pela nutricionista. Gravar e remover
 * reconferem, com a linha travada, que o conteúdo ainda aponta para ESTE vídeo (`doVideo`): se outro salvamento trocou o
 * link enquanto o oEmbed respondia (ou o conteúdo foi excluído), a capa é dele e esta desiste.
 */
async function capaDoVideo(ctx: TenantContext, id: string, video: VideoDoLink, deps: Deps): Promise<void> {
  const miniatura = await miniaturaDoVideo(video, { fetchImpl: deps.fetchImpl });
  if (miniatura) {
    try {
      await trocarCapa(ctx, id, miniatura, { ...deps, doVideo: video });
      return;
    } catch (err) {
      if (err instanceof VideoTrocadoError || err instanceof ConteudoNaoEncontradoError) return;
      if (!(err instanceof TipoNaoPermitidoError || err instanceof CotaEsgotadaError)) throw err;
    }
  }
  await removerCapa(ctx, id, { ...deps, doVideo: video });
}

export async function criarConteudo(ctx: TenantContext, tipo: TipoConteudo, entrada: EntradaConteudo, deps: Deps = {}): Promise<string> {
  const v = validarConteudo(tipo, entrada);
  const agora = deps.agora ?? new Date();
  const id = await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.insert(contents).values({ tenantId: ctx.tenantId, tipo, ...colunas(v, agora), createdAt: agora }).returning({ id: contents.id });
      await gravarPublico(tx, ctx.tenantId, c.id, v);
      return c.id;
    },
    deps.db ?? getDb(),
  );
  if (tipo === 'video' && v.video) await capaDoVideo(ctx, id, v.video, deps);
  return id;
}

export async function salvarConteudo(ctx: TenantContext, id: string, entrada: EntradaConteudo, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  const r = await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(eq(contents.id, id)).for('update');
      if (!c) throw new ConteudoNaoEncontradoError();
      const tipo = c.tipo as TipoConteudo;
      const v = validarConteudo(tipo, entrada);
      // D17: a mesma exigência da publicação vale para o que já está publicado — não fica publicado vazio
      if (c.status === 'publicado' && tipo === 'orientacao' && !v.corpoMd && !c.pdfPath) throw new ConteudoError({ corpo: MSG_CONTEUDO.publicadoVazio });
      await tx.update(contents).set(colunas(v, agora)).where(eq(contents.id, id));
      await gravarPublico(tx, ctx.tenantId, id, v);
      const mudou = (v.video?.provider ?? null) !== c.videoProvider || (v.video?.id ?? null) !== c.videoId;
      return { tipo, video: v.video, mudou };
    },
    deps.db ?? getDb(),
  );
  if (r.tipo === 'video' && r.mudou && r.video) await capaDoVideo(ctx, id, r.video, deps);
}

async function exigirPublicavel(tx: Tx, c: ContentRow): Promise<void> {
  if (c.tipo === 'receita') {
    const [{ n }] = await tx.select({ n: count() }).from(recipeIngredients).where(eq(recipeIngredients.contentId, c.id));
    if (!n) throw new ConteudoError({ geral: MSG_CONTEUDO.receitaIncompleta });
  }
  if (c.tipo === 'orientacao' && !c.corpoMd && !c.pdfPath) throw new ConteudoError({ geral: MSG_CONTEUDO.orientacaoVazia });
  if (c.visibilidade !== 'todos') {
    const a = await lerAudiencia(tx, c.id);
    if (!a.pacientes.length && !a.etiquetas.length) throw new ConteudoError({ visibilidade: MSG_CONTEUDO.audienciaVazia });
  }
}

/** D17: publica (de novo: `publicado_em` renovado — volta ao topo do feed). */
export async function publicarConteudo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(eq(contents.id, id)).for('update');
      if (!c) throw new ConteudoNaoEncontradoError();
      await exigirPublicavel(tx, c);
      await tx.update(contents).set({ status: 'publicado', publicadoEm: agora, updatedAt: agora }).where(eq(contents.id, id));
    },
    deps.db ?? getDb(),
  );
}

/** D17 / US-054 "Receita despublicada": some do feed e do cartão do plano na hora (a RLS só mostra o publicado). */
export async function despublicarConteudo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  const r = await withTenant(
    ctx,
    (tx) => tx.update(contents).set({ status: 'rascunho', publicadoEm: null, updatedAt: agora }).where(eq(contents.id, id)).returning({ id: contents.id }),
    deps.db ?? getDb(),
  );
  if (!r.length) throw new ConteudoNaoEncontradoError();
}

/** Voltas da exclusão: cada envio de capa/PDF que chega no meio custa uma (com capa e PDF, a primeira tira a capa). */
const EXCLUIR_VOLTAS = 4;

/**
 * D17 / regra 9: o conteúdo sai na MESMA transação que apaga o último arquivo dele — o `naMesmaTransacao` de
 * apagarArquivo trava a linha, confere que os dois ponteiros são os lidos e faz o DELETE (as filhas saem em cascata; a
 * sugestão na refeição vira nula — D13). Um upload de capa/PDF que entra entre a leitura e o DELETE troca o ponteiro:
 * a conferência falha, nada é apagado e a volta seguinte relê — nunca sobra `stored_files` órfão nem cota contada.
 * Com capa e PDF, a capa sai antes (removerCapa: ponteiro limpo na transação dela; a capa não tem a exigência da D17).
 * Sem arquivo, o DELETE trava e confere do mesmo jeito. Esgotadas as voltas: "Outro envio está em andamento…".
 */
export async function excluirConteudo(ctx: TenantContext, id: string, deps: Deps = {}): Promise<void> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const db = deps.db ?? getDb();
  for (let volta = 0; volta < EXCLUIR_VOLTAS; volta++) {
    const [c] = await withTenant(ctx, (tx) => tx.select({ capaPath: contents.capaPath, pdfPath: contents.pdfPath }).from(contents).where(eq(contents.id, id)), db);
    if (!c) throw new ConteudoNaoEncontradoError();
    if (c.capaPath && c.pdfPath) {
      await removerCapa(ctx, id, deps); // a próxima volta tem um arquivo só (o PDF)
      continue;
    }
    let apagou = false;
    const apagarSeIgual = async (tx: Tx): Promise<boolean> => {
      const [x] = await tx.select({ capaPath: contents.capaPath, pdfPath: contents.pdfPath }).from(contents).where(eq(contents.id, id)).for('update');
      if (!x || x.capaPath !== c.capaPath || x.pdfPath !== c.pdfPath) return false;
      await tx.delete(contents).where(eq(contents.id, id));
      apagou = true;
      return true;
    };
    const ultimo = c.capaPath ?? c.pdfPath;
    if (ultimo) await apagarArquivo(ctx, { caminho: ultimo }, { ...deps, naMesmaTransacao: apagarSeIgual });
    else await withTenant(ctx, apagarSeIgual, db);
    if (apagou) return;
  }
  throw new ConteudoError({ geral: MSG_CONTEUDO.ocupado });
}

export async function listarConteudosDoPainel(ctx: TenantContext, filtro: { tipo?: TipoConteudo } = {}, db: Db = getDb()): Promise<ConteudoDaLista[]> {
  const rs = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: contents.id, tipo: contents.tipo, titulo: contents.titulo, status: contents.status, visibilidade: contents.visibilidade, publicadoEm: contents.publicadoEm, atualizadoEm: contents.updatedAt })
        .from(contents)
        .where(filtro.tipo ? eq(contents.tipo, filtro.tipo) : undefined)
        .orderBy(desc(contents.updatedAt))
        .limit(200),
    db,
  );
  return rs.map((r) => ({ ...r, tipo: r.tipo as TipoConteudo, status: r.status as ConteudoDaLista['status'], visibilidade: r.visibilidade as Visibilidade }));
}

export async function carregarConteudoDoPainel(ctx: TenantContext, id: string, db: Db = getDb()): Promise<ConteudoDoPainel | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(and(eq(contents.id, id)));
      if (!c) return null;
      const video = videoDoConteudo(c);
      return {
        id: c.id,
        tipo: c.tipo as TipoConteudo,
        titulo: c.titulo,
        resumo: c.resumo,
        corpoMd: c.corpoMd,
        etiquetas: c.etiquetas,
        visibilidade: c.visibilidade as Visibilidade,
        status: c.status as ConteudoDoPainel['status'],
        publicadoEm: c.publicadoEm,
        video,
        link: video ? urlDoVideo(video) : '',
        capaUrl: c.capaPath ? signFileUrl(c.capaPath) : null,
        pdfUrl: c.pdfPath ? signFileUrl(c.pdfPath) : null,
        audiencia: await lerAudiencia(tx, c.id),
      };
    },
    db,
  );
}
```

Run: `pnpm test src/modules/conteudo` → PASS.

- [ ] **Step 8: Rotas de upload (teste e implementação)** — `src/app/api/painel/conteudos/[id]/capa/route.ts`

```ts
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { trocarCapa } from '@/modules/conteudo/arquivos';
import { CAPA_MAX_BYTES, MSG_CONTEUDO } from '@/modules/conteudo/constantes';
import { ConteudoNaoEncontradoError } from '@/modules/conteudo/erros';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

const json = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
// Cada envio segura até ~2 cópias de 5 MB e o sharp; a VPS é dividida com o CRM de produção (como o logo e o exame)
const MAX_ENVIOS = 2;
let emAndamento = 0;

/** US-051/US-052 (D8): corpo = a imagem crua (fetch com body: File). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/conteudos/[id]/capa'>): Promise<Response> {
  if (!mesmaOrigem(req)) return json(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > CAPA_MAX_BYTES) return json(413, { erro: MSG_CONTEUDO.capa });
  if (emAndamento >= MAX_ENVIOS) return json(429, { erro: MSG_CONTEUDO.ocupado });
  emAndamento++;
  try {
    const conteudo = await lerCorpoLimitado(req, CAPA_MAX_BYTES, { prazoMs: 60_000 });
    await trocarCapa(acesso.ctx, id, conteudo, { aceitos: ['jpg', 'png'], tipos: ['receita', 'orientacao'] });
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, { erro: MSG_CONTEUDO.capa });
    if (e instanceof CorpoLentoError) return json(408, { erro: MSG_CONTEUDO.ocupado });
    if (e instanceof TipoNaoPermitidoError) return json(415, { erro: MSG_CONTEUDO.capa });
    if (e instanceof ConteudoNaoEncontradoError) return json(404, { erro: MSG_CONTEUDO.naoEncontrado });
    if (e instanceof CotaEsgotadaError) return json(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    emAndamento--;
  }
}
```

`src/app/api/painel/conteudos/[id]/pdf/route.ts`

```ts
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { trocarPdf } from '@/modules/conteudo/arquivos';
import { MSG_CONTEUDO, PDF_MAX_BYTES } from '@/modules/conteudo/constantes';
import { ConteudoNaoEncontradoError } from '@/modules/conteudo/erros';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

const json = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
const MAX_ENVIOS = 2;
let emAndamento = 0;

/** US-052 (D20): corpo = o PDF cru (fetch com body: File), só na orientação. Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/conteudos/[id]/pdf'>): Promise<Response> {
  if (!mesmaOrigem(req)) return json(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > PDF_MAX_BYTES) return json(413, { erro: MSG_CONTEUDO.pdf });
  if (emAndamento >= MAX_ENVIOS) return json(429, { erro: MSG_CONTEUDO.ocupado });
  emAndamento++;
  try {
    const conteudo = await lerCorpoLimitado(req, PDF_MAX_BYTES, { prazoMs: 120_000 });
    await trocarPdf(acesso.ctx, id, conteudo);
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, { erro: MSG_CONTEUDO.pdf });
    if (e instanceof CorpoLentoError) return json(408, { erro: MSG_CONTEUDO.ocupado });
    if (e instanceof TipoNaoPermitidoError) return json(415, { erro: MSG_CONTEUDO.pdf });
    if (e instanceof ConteudoNaoEncontradoError) return json(404, { erro: MSG_CONTEUDO.naoEncontrado });
    if (e instanceof CotaEsgotadaError) return json(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    emAndamento--;
  }
}
```

Teste — `src/app/api/painel/conteudos/[id]/capa/route.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { carregarConteudoDoPainel, criarConteudo } from '@/modules/conteudo/conteudos';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../../../../../test/sessao';
import { POST } from './route';

vi.mock('server-only', () => ({}));
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `ct-${randomUUID().slice(0, 8)}`, nomeExibicao: 'CT' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
const enviar = (id: string, corpo: Uint8Array, cookie: string, origin = 'http://localhost:3000') =>
  POST(new Request(`http://localhost:3000/api/painel/conteudos/${id}/capa`, { method: 'POST', body: corpo, headers: { cookie, origin } }), { params: Promise.resolve({ id }) });
const base = { titulo: 'Panqueca', resumo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };

describe('POST /api/painel/conteudos/[id]/capa', () => {
  it('JPEG da receita → 200 e a capa aparece; outra origem 403; tipo errado 415; vídeo 404', async () => {
    const A = await nutriComDpa();
    const r = await criarConteudo(A.ctx, 'receita', base, { db });
    const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#0a0' } }).jpeg().toBuffer();
    expect((await enviar(r, jpg, A.cookie, 'https://evil.example')).status).toBe(403);
    expect((await enviar(r, jpg, A.cookie)).status).toBe(200);
    expect((await carregarConteudoDoPainel(A.ctx, r, db))!.capaUrl).not.toBeNull();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10)]);
    const t = await enviar(r, pdf, A.cookie);
    expect(t.status).toBe(415);
    expect(await t.json()).toEqual({ erro: 'Envie uma imagem JPEG ou PNG de até 5 MB.' });
    const v = await criarConteudo(A.ctx, 'video', { ...base, link: 'https://youtu.be/dQw4w9WgXcQ' }, { db, fetchImpl: (async () => { throw new Error('rede'); }) as typeof fetch });
    expect((await enviar(v, jpg, A.cookie)).status).toBe(404);
  });
});
```

Run: `pnpm test src/app/api/painel/conteudos` → PASS.

- [ ] **Step 9: Server Actions** — `src/app/painel/conteudos/actions.ts`

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { removerCapa, removerPdf } from '@/modules/conteudo/arquivos';
import { ehTipoConteudo, MSG_CONTEUDO } from '@/modules/conteudo/constantes';
import { criarConteudo, despublicarConteudo, excluirConteudo, publicarConteudo, salvarConteudo } from '@/modules/conteudo/conteudos';
import { ConteudoError, ConteudoNaoEncontradoError } from '@/modules/conteudo/erros';

/** O que o formulário mandou — volta no estado com o erro (o React 19 limpa o formulário depois da ação). */
export type ValoresDoForm = { titulo: string; resumo: string; link: string; corpo: string; etiquetas: string; visibilidade: string; pacientes: string[]; tags: string[] };
export type ConteudoState = { erros?: Record<string, string>; ok?: string; valores?: ValoresDoForm };

const valoresDo = (fd: FormData): ValoresDoForm => ({
  titulo: String(fd.get('titulo') ?? ''),
  resumo: String(fd.get('resumo') ?? ''),
  link: String(fd.get('link') ?? ''),
  corpo: String(fd.get('corpo') ?? ''),
  etiquetas: String(fd.get('etiquetas') ?? ''),
  visibilidade: String(fd.get('visibilidade') ?? ''),
  pacientes: fd.getAll('pacientes').map(String),
  tags: fd.getAll('tags').map(String),
});

export async function criarConteudoAction(tipo: string, _: ConteudoState, fd: FormData): Promise<ConteudoState> {
  const { ctx } = await requireNutri('/painel/conteudos/novo');
  if (!ehTipoConteudo(tipo)) return { erros: { geral: MSG_CONTEUDO.naoEncontrado } };
  const valores = valoresDo(fd);
  let id: string;
  try {
    id = await criarConteudo(ctx, tipo, valores);
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros, valores };
    throw e;
  }
  redirect(`/painel/conteudos/${id}`);
}

export async function salvarConteudoAction(id: string, _: ConteudoState, fd: FormData): Promise<ConteudoState> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  const valores = valoresDo(fd);
  try {
    await salvarConteudo(ctx, id, valores);
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros, valores };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message }, valores };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: MSG_CONTEUDO.salvo };
}

export async function publicarConteudoAction(id: string, _: ConteudoState, fd: FormData): Promise<ConteudoState> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  void fd; // a Tarefa 10 lê "Avisar pacientes" daqui
  try {
    await publicarConteudo(ctx, id);
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message } };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: MSG_CONTEUDO.publicado };
}

export async function despublicarConteudoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  await despublicarConteudo(ctx, id).catch((e) => {
    if (!(e instanceof ConteudoNaoEncontradoError)) throw e;
  });
  revalidatePath(`/painel/conteudos/${id}`);
}

export async function excluirConteudoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  try {
    await excluirConteudo(ctx, id);
  } catch (e) {
    // envios de capa/PDF seguidos no meio da exclusão (D17): a página mostra "Outro envio está em andamento…"
    if (e instanceof ConteudoError) redirect(`/painel/conteudos/${id}?ocupado=1`);
    if (!(e instanceof ConteudoNaoEncontradoError)) throw e;
  }
  redirect('/painel/conteudos?excluido=1');
}

export async function removerCapaAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  await removerCapa(ctx, id);
  revalidatePath(`/painel/conteudos/${id}`);
}

/** D17: o PDF de uma orientação publicada sem texto não sai — a mensagem volta para a tela (arquivos.tsx). */
export async function removerPdfAction(id: string): Promise<{ erro?: string }> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  try {
    await removerPdf(ctx, id);
  } catch (e) {
    if (e instanceof ConteudoError) return { erro: e.erros.geral };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return {};
}
```

- [ ] **Step 10: Formulário** — `src/app/painel/conteudos/conteudo-form.tsx`

```tsx
'use client';
import { useActionState, useState } from 'react';
import type { OpcoesDeAudiencia } from '@/modules/conteudo/audiencia';
import { CORPO_MAX, MSG_CONTEUDO, RESUMO_MAX, ROTULO_VISIBILIDADE, TITULO_MAX, VISIBILIDADES, type TipoConteudo } from '@/modules/conteudo/constantes';
import type { ConteudoState, ValoresDoForm } from './actions';

type Props = {
  tipo: TipoConteudo;
  inicial: ValoresDoForm;
  opcoes: OpcoesDeAudiencia;
  acao: (s: ConteudoState, fd: FormData) => Promise<ConteudoState>;
  botao: 'Criar' | 'Salvar';
};

/** US-050/051/052/053: campos comuns, o do tipo (link ou texto) e "Quem vê". */
export function ConteudoForm({ tipo, inicial, opcoes, acao, botao }: Props) {
  const [s, enviar, enviando] = useActionState<ConteudoState, FormData>(acao, {});
  const v = s.valores ?? inicial;
  const [visibilidade, setVisibilidade] = useState(v.visibilidade || 'todos');
  const erro = (c: string) => s.erros?.[c];
  const aria = (c: string) => ({ 'aria-invalid': erro(c) ? true : undefined, 'aria-describedby': erro(c) ? `${c}-erro` : undefined });
  const Erro = ({ c }: { c: string }) => (erro(c) ? <p id={`${c}-erro`} role="alert" className="text-sm text-red-700">{erro(c)}</p> : null);
  return (
    <form action={enviar} className="space-y-4">
      {erro('geral') && <p role="alert" className="text-red-700">{erro('geral')}</p>}
      <div className="space-y-1">
        <label htmlFor="titulo" className="block font-medium">Título</label>
        <input id="titulo" name="titulo" defaultValue={v.titulo} maxLength={TITULO_MAX} {...aria('titulo')} className="w-full rounded border p-2" />
        <Erro c="titulo" />
      </div>
      <div className="space-y-1">
        <label htmlFor="resumo" className="block font-medium">Resumo</label>
        <textarea id="resumo" name="resumo" rows={2} defaultValue={v.resumo} maxLength={RESUMO_MAX} {...aria('resumo')} className="w-full rounded border p-2" />
        <Erro c="resumo" />
      </div>
      {tipo !== 'orientacao' && (
        <div className="space-y-1">
          <label htmlFor="link" className="block font-medium">Link do vídeo</label>
          {/* type="text" (não "url"): o navegador barraria "youtu.be/…" sem esquema, que lerLinkDeVideo aceita (US-050) */}
          <input id="link" name="link" type="text" inputMode="url" autoComplete="off" spellCheck={false} defaultValue={v.link} aria-invalid={erro('link') ? true : undefined} aria-describedby={`link-aviso${erro('link') ? ' link-erro' : ''}`} className="w-full rounded border p-2" />
          <p id="link-aviso" className="text-sm text-zinc-600">{MSG_CONTEUDO.videoAviso}</p>
          <Erro c="link" />
        </div>
      )}
      {tipo === 'orientacao' && (
        <div className="space-y-1">
          <label htmlFor="corpo" className="block font-medium">Texto</label>
          <textarea id="corpo" name="corpo" rows={12} defaultValue={v.corpo} maxLength={CORPO_MAX} aria-invalid={erro('corpo') ? true : undefined} aria-describedby={`corpo-ajuda${erro('corpo') ? ' corpo-erro' : ''}`} className="w-full rounded border p-2 font-mono text-sm" />
          <p id="corpo-ajuda" className="text-sm text-zinc-600">Use **negrito**, *itálico*, listas com - e títulos com ##.</p>
          <Erro c="corpo" />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="etiquetas" className="block font-medium">Etiquetas do conteúdo</label>
        <input id="etiquetas" name="etiquetas" defaultValue={v.etiquetas} aria-invalid={erro('etiquetas') ? true : undefined} aria-describedby={`etiquetas-ajuda${erro('etiquetas') ? ' etiquetas-erro' : ''}`} className="w-full rounded border p-2" />
        <p id="etiquetas-ajuda" className="text-sm text-zinc-600">Separe por vírgula. Ex.: sem lactose, café da manhã</p>
        <Erro c="etiquetas" />
      </div>
      <fieldset className="space-y-2" aria-describedby={erro('visibilidade') ? 'visibilidade-erro' : undefined}>
        <legend className="font-medium">Quem vê</legend>
        {VISIBILIDADES.map((x) => (
          <label key={x} className="flex items-center gap-2">
            <input type="radio" name="visibilidade" value={x} checked={visibilidade === x} onChange={() => setVisibilidade(x)} />
            {ROTULO_VISIBILIDADE[x]}
          </label>
        ))}
        {visibilidade === 'etiquetas' && (
          <fieldset className="ml-6 space-y-1">
            <legend className="text-sm font-medium">Etiquetas</legend>
            {opcoes.etiquetas.length === 0 && <p className="text-sm">Nenhuma etiqueta cadastrada.</p>}
            {opcoes.etiquetas.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="tags" value={e.id} defaultChecked={v.tags.includes(e.id)} />
                {e.nome}
              </label>
            ))}
          </fieldset>
        )}
        {visibilidade === 'pacientes' && (
          <fieldset className="ml-6 max-h-64 space-y-1 overflow-y-auto">
            <legend className="text-sm font-medium">Pacientes</legend>
            {opcoes.pacientes.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="pacientes" value={p.id} defaultChecked={v.pacientes.includes(p.id)} />
                {p.nome}
              </label>
            ))}
          </fieldset>
        )}
        <Erro c="visibilidade" />
      </fieldset>
      <p role="status">{s.ok}</p>
      <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">{botao}</button>
    </form>
  );
}
```

- [ ] **Step 11: Arquivos e publicação na tela** — `src/app/painel/conteudos/arquivos.tsx`

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { MSG_CONTEUDO, type TipoConteudo } from '@/modules/conteudo/constantes';
import { removerCapaAction, removerPdfAction } from './actions';

const FALHOU = 'Não foi possível enviar. Tente de novo.';

/** D8/D20: capa (receita e orientação) e PDF (orientação), enviados crus para a rota (como o logo). */
export function ArquivosDoConteudo({ id, tipo, capaUrl, pdfUrl }: { id: string; tipo: TipoConteudo; capaUrl: string | null; pdfUrl: string | null }) {
  const router = useRouter();
  const [estado, setEstado] = useState<{ ok?: string; erro?: string; enviando?: boolean }>({});
  async function enviar(rota: 'capa' | 'pdf', arquivo: File | undefined, ok: string) {
    if (!arquivo) return;
    setEstado({ enviando: true });
    try {
      const r = await fetch(`/api/painel/conteudos/${id}/${rota}`, { method: 'POST', body: arquivo });
      const j = (await r.json().catch(() => ({}))) as { erro?: string };
      if (!r.ok) return setEstado({ erro: j.erro ?? FALHOU });
      setEstado({ ok });
      router.refresh();
    } catch {
      setEstado({ erro: FALHOU });
    }
  }
  return (
    <section aria-labelledby="arquivos-titulo" className="space-y-3 rounded border p-4">
      <h2 id="arquivos-titulo" className="font-semibold">Arquivos</h2>
      <CapaDoConteudo tipo={tipo} capaUrl={capaUrl} className="max-w-xs" />
      <div className="space-y-1">
        <label htmlFor="capa" className="block font-medium">Capa (JPEG ou PNG, até 5 MB)</label>
        <input id="capa" type="file" accept="image/jpeg,image/png" disabled={estado.enviando} onChange={(e) => void enviar('capa', e.target.files?.[0], MSG_CONTEUDO.capaSalva)} />
      </div>
      {capaUrl && (
        <form action={removerCapaAction.bind(null, id)}>
          <button className="underline">Remover capa</button>
        </form>
      )}
      {tipo === 'orientacao' && (
        <>
          <div className="space-y-1">
            <label htmlFor="pdf" className="block font-medium">Material em PDF (até 10 MB)</label>
            <input id="pdf" type="file" accept="application/pdf" disabled={estado.enviando} onChange={(e) => void enviar('pdf', e.target.files?.[0], MSG_CONTEUDO.pdfSalvo)} />
          </div>
          {pdfUrl && (
            <div className="flex gap-4">
              <a href={pdfUrl} className="underline">Ver PDF</a>
              <button
                type="button"
                className="underline"
                onClick={async () => {
                  const r = await removerPdfAction(id);
                  if (r.erro) setEstado({ erro: r.erro });
                  else router.refresh();
                }}
              >
                Remover PDF
              </button>
            </div>
          )}
        </>
      )}
      {estado.enviando && <p role="status">Enviando…</p>}
      {estado.ok && <p role="status">{estado.ok}</p>}
      {estado.erro && <p role="alert" className="text-red-700">{estado.erro}</p>}
    </section>
  );
}
```

`src/app/painel/conteudos/publicar-form.tsx`

```tsx
'use client';
import { useActionState } from 'react';
import { despublicarConteudoAction, publicarConteudoAction, type ConteudoState } from './actions';

/**
 * D17: "Publicar" no rascunho; "Despublicar" no publicado. A Tarefa 10 acrescenta "Avisar pacientes".
 * A action chama `revalidatePath`: o refresh rende a página de novo já com `publicado = true`, e o estado do
 * `useActionState` continua (mesmo componente, mesma posição). Por isso o `role="status"` fica FORA dos dois ramos —
 * senão "Conteúdo publicado. Aviso enviado para N pacientes." (D5) nunca aparece. Só mostra o `ok` no ramo publicado:
 * depois de "Despublicar", o "Conteúdo publicado." antigo não volta no ramo do rascunho.
 */
export function PublicarForm({ id, publicado }: { id: string; publicado: boolean }) {
  const [s, publicar, enviando] = useActionState<ConteudoState, FormData>(publicarConteudoAction.bind(null, id), {});
  const erro = s.erros?.geral ?? s.erros?.visibilidade;
  return (
    <div className="space-y-2">
      {!publicado && erro && <p role="alert" className="text-red-700">{erro}</p>}
      <p role="status">{publicado ? s.ok : undefined}</p>
      {publicado ? (
        <form action={despublicarConteudoAction.bind(null, id)}>
          <button className="rounded border px-4 py-2">Despublicar</button>
        </form>
      ) : (
        <form action={publicar} className="space-y-2">
          <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Publicar</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Páginas** — `src/app/painel/conteudos/page.tsx`

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { ehTipoConteudo, FILTROS_DO_FEED, MSG_CONTEUDO, ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { listarConteudosDoPainel } from '@/modules/conteudo/conteudos';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { Cabecalho } from '../cabecalho';

export const dynamic = 'force-dynamic';

export default async function Conteudos({ searchParams }: PageProps<'/painel/conteudos'>) {
  const { ctx, tenant } = await requireNutri('/painel/conteudos');
  const { tipo, excluido } = await searchParams;
  const filtro = ehTipoConteudo(tipo) ? tipo : undefined;
  const lista = await listarConteudosDoPainel(ctx, { tipo: filtro });
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Conteúdos</h1>
        {excluido === '1' && <p role="status">{MSG_CONTEUDO.excluido}</p>}
        <div className="flex flex-wrap gap-3">
          <Link href="/painel/conteudos/novo?tipo=video" className="rounded border px-3 py-1">Novo vídeo</Link>
          <Link href="/painel/conteudos/novo?tipo=receita" className="rounded border px-3 py-1">Nova receita</Link>
          <Link href="/painel/conteudos/novo?tipo=orientacao" className="rounded border px-3 py-1">Nova orientação</Link>
        </div>
        <nav aria-label="Filtrar conteúdos" className="flex gap-3 text-sm">
          <Link href="/painel/conteudos" aria-current={!filtro ? 'page' : undefined} className="aria-[current=page]:font-semibold">Todos</Link>
          {FILTROS_DO_FEED.map((f) => (
            <Link key={f.tipo} href={`/painel/conteudos?tipo=${f.tipo}`} aria-current={filtro === f.tipo ? 'page' : undefined} className="aria-[current=page]:font-semibold">{f.rotulo}</Link>
          ))}
        </nav>
        {lista.length === 0 ? (
          <p>Nenhum conteúdo ainda.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Tipo</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2"><Link href={`/painel/conteudos/${c.id}`} className="underline">{c.titulo}</Link></td>
                  <td>{ROTULO_TIPO_CONTEUDO[c.tipo]}</td>
                  <td>{c.status === 'publicado' && c.publicadoEm ? `Publicado em ${formatarDataNoFuso(c.publicadoEm, tenant.fuso)}` : 'Rascunho'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
```

`src/app/painel/conteudos/novo/page.tsx`

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { opcoesDeAudiencia } from '@/modules/conteudo/audiencia';
import { ehTipoConteudo } from '@/modules/conteudo/constantes';
import { Cabecalho } from '../../cabecalho';
import { criarConteudoAction } from '../actions';
import { ConteudoForm } from '../conteudo-form';

export const dynamic = 'force-dynamic';

/** Os mesmos textos dos links da lista. */
const TITULO_NOVO = { video: 'Novo vídeo', receita: 'Nova receita', orientacao: 'Nova orientação' } as const;

export default async function NovoConteudo({ searchParams }: PageProps<'/painel/conteudos/novo'>) {
  const { ctx, tenant } = await requireNutri('/painel/conteudos/novo');
  const { tipo } = await searchParams;
  if (!ehTipoConteudo(tipo)) notFound();
  const opcoes = await opcoesDeAudiencia(ctx);
  const vazio = { titulo: '', resumo: '', link: '', corpo: '', etiquetas: '', visibilidade: 'todos', pacientes: [], tags: [] };
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <Link href="/painel/conteudos" className="text-sm underline">Voltar aos conteúdos</Link>
        <h1 className="text-2xl font-semibold">{TITULO_NOVO[tipo]}</h1>
        <ConteudoForm tipo={tipo} inicial={vazio} opcoes={opcoes} acao={criarConteudoAction.bind(null, tipo)} botao="Criar" />
      </main>
    </>
  );
}
```

`src/app/painel/conteudos/[id]/page.tsx`

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { PlayerVideo } from '@/components/player-video';
import { requireNutri } from '@/lib/tenant-session';
import { opcoesDeAudiencia } from '@/modules/conteudo/audiencia';
import { MSG_CONTEUDO, ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { carregarConteudoDoPainel } from '@/modules/conteudo/conteudos';
import { Cabecalho } from '../../cabecalho';
import { excluirConteudoAction, salvarConteudoAction } from '../actions';
import { ArquivosDoConteudo } from '../arquivos';
import { ConteudoForm } from '../conteudo-form';
import { PublicarForm } from '../publicar-form';

export const dynamic = 'force-dynamic';

export default async function ConteudoPage({ params, searchParams }: PageProps<'/painel/conteudos/[id]'>) {
  const { id } = await params;
  const { ocupado } = await searchParams;
  const { ctx, tenant } = await requireNutri(`/painel/conteudos/${id}`);
  const c = await carregarConteudoDoPainel(ctx, id);
  if (!c) notFound();
  const opcoes = await opcoesDeAudiencia(ctx);
  const inicial = {
    titulo: c.titulo,
    resumo: c.resumo,
    link: c.link,
    corpo: c.corpoMd,
    etiquetas: c.etiquetas.join(', '),
    visibilidade: c.visibilidade,
    pacientes: c.audiencia.pacientes,
    tags: c.audiencia.etiquetas,
  };
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <Link href="/painel/conteudos" className="text-sm underline">Voltar aos conteúdos</Link>
        <h1 className="text-2xl font-semibold">{c.titulo}</h1>
        <p>{`${ROTULO_TIPO_CONTEUDO[c.tipo]} · ${c.status === 'publicado' ? 'Publicado' : 'Rascunho'}`}</p>
        {c.tipo === 'video' && <CapaDoConteudo tipo={c.tipo} capaUrl={c.capaUrl} className="max-w-xs" />}
        {c.video && <PlayerVideo video={c.video} titulo={c.titulo} />}
        <ConteudoForm tipo={c.tipo} inicial={inicial} opcoes={opcoes} acao={salvarConteudoAction.bind(null, c.id)} botao="Salvar" />
        {c.tipo !== 'video' && <ArquivosDoConteudo id={c.id} tipo={c.tipo} capaUrl={c.capaUrl} pdfUrl={c.pdfUrl} />}
        <PublicarForm id={c.id} publicado={c.status === 'publicado'} />
        {ocupado === '1' && <p role="alert" className="text-red-700">{MSG_CONTEUDO.ocupado}</p>}
        <form action={excluirConteudoAction.bind(null, c.id)}>
          <ConfirmarBotao mensagem="Excluir este conteúdo? A sugestão de receita sai dos planos.">Excluir conteúdo</ConfirmarBotao>
        </form>
      </main>
    </>
  );
}
```

`src/app/painel/cabecalho.tsx`: depois de `<Link href="/painel/diarios">Diários</Link>`, acrescentar `<Link href="/painel/conteudos">Conteúdos</Link>`.

`CLAUDE.md`, regra 9, depois da frase da exportação: "Capa (`capa`, JPEG convertido) e PDF da orientação (`orientacao_pdf`) do conteúdo (Plano 07): só por `trocarCapa`/`trocarPdf`/`removerCapa`/`removerPdf` (`src/modules/conteudo/arquivos.ts`), que gravam e limpam o ponteiro em `contents` na transação do arquivo, e por `excluirConteudo` (`src/modules/conteudo/conteudos.ts`), que apaga o conteúdo no `naMesmaTransacao` do último arquivo (linha travada, ponteiros conferidos)."

Run: `pnpm test src/app/painel src/modules/conteudo src/lib` (inclui `acoes-de-paciente.test.ts` e `cabecalho.test.ts`, que passam a cobrir as ações e as páginas novas) → PASS; `pnpm lint && pnpm typecheck` → PASS.

- [ ] **Step 13: Conferência manual rápida** — `pnpm dev`, como a nutricionista de dev: "Conteúdos" no menu → "Novo vídeo" com `https://youtu.be/dQw4w9WgXcQ` → a página do conteúdo mostra o player (`youtube-nocookie`) e a capa (ou o bloco "Vídeo" sem rede); "Nova orientação" com texto e PDF → "Publicar" → "Despublicar" → "Excluir conteúdo".

- [ ] **Step 14: Commit**

```bash
git add src/lib/mesma-origem.ts src/lib/mesma-origem.test.ts src/app/api src/modules/conteudo/erros.ts src/modules/conteudo/arquivos.ts src/modules/conteudo/arquivos.test.ts src/modules/conteudo/conteudos.ts src/modules/conteudo/conteudos.test.ts src/app/painel/conteudos src/app/painel/cabecalho.tsx CLAUDE.md
git commit -m "feat(conteudo): conteúdos no painel — vídeo com capa do oEmbed, orientação com PDF, público, publicar/despublicar/excluir; mesmaOrigem num lugar só (S-9)"
```

---
### Task 6: Receita com ingredientes e valor por porção (P07-03; US-051, RN-11, RN-02)

**Files:**
- Create: `src/modules/conteudo/receita-calculo.ts` (+ `receita-calculo.test.ts`), `src/modules/conteudo/receitas.ts` (+ `receitas.test.ts`), `src/app/painel/conteudos/[id]/receita-form.tsx`
- Modify: `src/app/painel/conteudos/actions.ts` (`salvarReceitaAction`), `src/app/painel/conteudos/[id]/page.tsx`, `src/modules/alimentos/alimentos-constantes.ts` (D12)

**Interfaces:**
- Consumes: `nutrientesDoItem`, `ZERO`, `Nutrientes`, `kcalTexto`, `gTexto`, `lerQuantidade` (`src/modules/plano-alimentar/calculo.ts`); `MSG_PLANO` (`plano-alimentar/constantes.ts`); `Nutrientes100`, `AlimentoEncontrado` (`alimentos/busca.ts`, só tipos no cliente); `BuscaAlimento`, `Selo` (`src/app/painel/alimentos/busca-alimento.tsx`); `lerDecimal`, `arredondar`, `formatarDecimal`, `casasDecimais` (`src/lib/numero.ts`); `ConteudoError`, `ConteudoNaoEncontradoError` (T5); constantes (T2).
- Produces:
  - `@/modules/conteudo/receita-calculo` (sem banco; o cliente importa): `type IngredienteCalculo = { porCem: Nutrientes100; quantidadeG: number | null }`, `nutrientesPorPorcao(ingredientes, rendimentoG: number | null, porcaoG: number | null): (Nutrientes & { semValor: (keyof Nutrientes)[] }) | null`, `textoPorPorcao(n: Nutrientes): string`.
  - `@/modules/conteudo/receitas`: `type EntradaReceita`, `type ReceitaLida = { rendimentoG: number; porcaoG: number; tempoMin: number | null; modoPreparo: string; ingredientes: { foodId: string; nome: string; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; quantidadeG: number; medidaCaseiraTxt: string | null }[] }`, `type ReceitaParaPlano = { id: string; titulo: string }`, `validarReceita(e)`, `salvarReceita(ctx, contentId, e, deps?): Promise<void>`, `lerReceitaNaTransacao(tx, contentId): Promise<ReceitaLida | null>` (roda com a RLS de quem lê — o portal usa na T7), `carregarReceitaDoPainel(ctx, contentId, db?): Promise<ReceitaLida | null>`, `listarReceitasPublicadas(ctx, db?): Promise<ReceitaParaPlano[]>` (T9).
  - Server Action `salvarReceitaAction(id, s, fd)`; tipo `ReceitaState = { erros?: Record<string, string>; ok?: string }`; componente `ReceitaForm({ id, inicial })`.

- [ ] **Step 1: Teste do cálculo (falha)** — `src/modules/conteudo/receita-calculo.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { nutrientesPorPorcao, textoPorPorcao } from './receita-calculo';

const mistura = { kcal: 400, proteinaG: 10, carboidratoG: 50, lipidioG: 15, fibraG: 5 }; // por 100 g

describe('valor por porção (RN-11)', () => {
  it('US-051: ingredientes somando 2000 kcal, rendimento 1000 g, porção 250 g → 500 kcal, macros proporcionais', () => {
    const n = nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 500 }], 1000, 250)!;
    expect(n).toEqual({ kcal: 500, proteinaG: 12.5, carboidratoG: 62.5, lipidioG: 18.75, fibraG: 6.25, semValor: [] });
    expect(textoPorPorcao(n)).toBe('Por porção: 500 kcal · proteína 12,5 g · carboidrato 62,5 g · lipídio 18,8 g · fibra 6,3 g');
  });

  it('alimento sem valor na TACO conta 0 e é avisado (RN-02); quantidade inválida fica fora; rendimento/porção inválidos → null', () => {
    const semFibra = { ...mistura, fibraG: null };
    const n = nutrientesPorPorcao([{ porCem: semFibra, quantidadeG: 100 }, { porCem: mistura, quantidadeG: null }], 100, 100)!;
    expect(n.kcal).toBe(400);
    expect(n.fibraG).toBe(0);
    expect(n.semValor).toEqual(['fibraG']);
    expect(nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 100 }], 0, 50)).toBeNull();
    expect(nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 100 }], 100, null)).toBeNull();
  });

  it('porção = rendimento: a receita inteira', () => {
    expect(nutrientesPorPorcao([{ porCem: mistura, quantidadeG: 250 }], 250, 250)!.kcal).toBe(1000);
  });
});
```

Run: `pnpm test src/modules/conteudo/receita-calculo.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/conteudo/receita-calculo.ts`

```ts
import { arredondar } from '@/lib/numero';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { gTexto, kcalTexto, nutrientesDoItem, ZERO, type Nutrientes } from '@/modules/plano-alimentar/calculo';

/** RN-11. Sem banco e sem React: o formulário (cliente), o painel e o portal usam a mesma conta. */
export type IngredienteCalculo = { porCem: Nutrientes100; quantidadeG: number | null };

const CAMPOS = ['kcal', 'proteinaG', 'carboidratoG', 'lipidioG', 'fibraG'] as const;

/**
 * Σ(nutriente de cada ingrediente) × porção / rendimento. Cada ingrediente pela RN-02 (valor por 100 g × gramas / 100;
 * sem valor na TACO conta 0 e vai para `semValor`); quantidade inválida (null) fica fora. Rendimento ou porção
 * inválidos → null (a tela não mostra conta).
 */
export function nutrientesPorPorcao(ingredientes: IngredienteCalculo[], rendimentoG: number | null, porcaoG: number | null): (Nutrientes & { semValor: (keyof Nutrientes)[] }) | null {
  if (!rendimentoG || !porcaoG || rendimentoG <= 0 || porcaoG <= 0) return null;
  const total: Nutrientes = { ...ZERO };
  const semValor = new Set<keyof Nutrientes>();
  for (const i of ingredientes) {
    if (i.quantidadeG === null) continue;
    const n = nutrientesDoItem(i.porCem, i.quantidadeG);
    for (const c of CAMPOS) total[c] = arredondar(total[c] + n[c], 6);
    for (const c of n.semValor) semValor.add(c);
  }
  const fator = porcaoG / rendimentoG;
  const porPorcao: Nutrientes = { ...ZERO };
  for (const c of CAMPOS) porPorcao[c] = arredondar(total[c] * fator, 6);
  return { ...porPorcao, semValor: CAMPOS.filter((c) => semValor.has(c)) };
}

/** "Por porção: 500 kcal · proteína 12,5 g · …" — RN-02: kcal inteiro, gramas com 1 casa, vírgula decimal. */
export const textoPorPorcao = (n: Nutrientes): string =>
  `Por porção: ${kcalTexto(n.kcal)} kcal · proteína ${gTexto(n.proteinaG)} g · carboidrato ${gTexto(n.carboidratoG)} g · lipídio ${gTexto(n.lipidioG)} g · fibra ${gTexto(n.fibraG)} g`;
```

Run: `pnpm test src/modules/conteudo/receita-calculo.test.ts` → PASS.

- [ ] **Step 3: Teste da receita no banco (falha)** — `src/modules/conteudo/receitas.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { excluirAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { MSG_RECEITA } from './constantes';
import { ConteudoError } from './erros';
import { nutrientesPorPorcao } from './receita-calculo';
import { carregarReceitaDoPainel, listarReceitasPublicadas, salvarReceita } from './receitas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

/** "Meu alimento" com valores redondos (por 100 g). */
async function meuAlimento(T: TenantDeTeste, kcal = 400): Promise<string> {
  const r = await withTenant(
    T.ctx,
    (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${T.tenantId}, 'Mistura de aveia', 'Miscelâneas', ${kcal}, 10, 50, 15, 5) returning id`),
    app.db,
  );
  return (r.rows[0] as { id: string }).id;
}
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConteudoError) return e.erros;
    throw e;
  }
  throw new Error('não falhou');
};

describe('receita (US-051, RN-11)', () => {
  it('2000 kcal de ingredientes, rendimento 1000 g, porção 250 g → 500 kcal por porção; regravar substitui os ingredientes', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', status: 'rascunho' });
    await salvarReceita(T.ctx, r.id, { rendimento: '1000', porcao: '250', tempo: '20', modo: 'Misture e asse.', ingredientes: [{ foodId: food, quantidadeG: '500', medida: '5 xícaras' }] }, { db: app.db });
    const lida = (await carregarReceitaDoPainel(T.ctx, r.id, app.db))!;
    expect(lida).toMatchObject({ rendimentoG: 1000, porcaoG: 250, tempoMin: 20, modoPreparo: 'Misture e asse.' });
    expect(lida.ingredientes).toEqual([{ foodId: food, nome: 'Mistura de aveia', origem: 'Meu alimento', porCem: { kcal: 400, proteinaG: 10, carboidratoG: 50, lipidioG: 15, fibraG: 5 }, quantidadeG: 500, medidaCaseiraTxt: '5 xícaras' }]);
    expect(nutrientesPorPorcao(lida.ingredientes, lida.rendimentoG, lida.porcaoG)!.kcal).toBe(500);
    await salvarReceita(T.ctx, r.id, { rendimento: '1000', porcao: '250,5', tempo: '', modo: '', ingredientes: [{ foodId: food, quantidadeG: '100' }] }, { db: app.db });
    expect(await carregarReceitaDoPainel(T.ctx, r.id, app.db)).toMatchObject({ porcaoG: 250.5, tempoMin: null, ingredientes: [{ quantidadeG: 100, medidaCaseiraTxt: null }] });
  });

  it('"Porção maior que rendimento": 1200 g de 1000 g → "A porção não pode ser maior que o rendimento"; e as outras validações', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    const um = [{ foodId: food, quantidadeG: '100' }];
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '1000', porcao: '1200', ingredientes: um }, { db: app.db }))).toEqual({ porcao: 'A porção não pode ser maior que o rendimento' });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '0', porcao: '', tempo: '0', ingredientes: [] }, { db: app.db }))).toEqual({
      rendimento: MSG_RECEITA.rendimento,
      porcao: MSG_RECEITA.porcao,
      tempo: MSG_RECEITA.tempo,
      ingredientes: MSG_RECEITA.ingredientes,
    });
    // "0,04" arredonda para 0,0: mensagem do campo, nunca o CHECK do banco (500)
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '0,04', porcao: '0,04', ingredientes: um }, { db: app.db }))).toEqual({
      rendimento: MSG_RECEITA.rendimento,
      porcao: MSG_RECEITA.porcao,
    });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: food, quantidadeG: '0' }, { foodId: 'x', quantidadeG: '10' }] }, { db: app.db }))).toEqual({
      'ingrediente:0:quantidade': MSG_PLANO.quantidade,
      'ingrediente:1:alimento': MSG_PLANO.alimento,
    });
    const muitos = Array.from({ length: 51 }, () => ({ foodId: food, quantidadeG: '10' }));
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: muitos }, { db: app.db }))).toEqual({ ingredientes: MSG_RECEITA.ingredientesMax });
  });

  it('alimento de outro consultório (a RLS esconde) → "Alimento não encontrado."; conteúdo que não é receita → não encontrado', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const deU = await meuAlimento(U);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: deU, quantidadeG: '10' }] }, { db: app.db }))).toEqual({ 'ingrediente:0:alimento': MSG_PLANO.alimento });
    const o = await novoConteudo(app.db, T);
    // entrada VÁLIDA (com ingrediente do próprio consultório): `validarReceita` roda antes de conferir o tipo; com
    // `ingredientes: []` o erro seria "Conteúdo inválido" e o caso "não é receita" nunca seria exercitado
    const doT = await meuAlimento(T);
    await expect(salvarReceita(T.ctx, o.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: doT, quantidadeG: '10' }] }, { db: app.db })).rejects.toThrow('Conteúdo não encontrado.');
  });

  it('D12: "Meu alimento" usado em receita não é excluído, com a mensagem nova', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    await salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: food, quantidadeG: '10' }] }, { db: app.db });
    await expect(excluirAlimento(T.ctx, food, { db: app.db })).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.emUso } });
    expect(MSG_ALIMENTO.emUso).toBe('Este alimento está em um plano ou receita e não pode ser excluído.');
  });

  it('listarReceitasPublicadas: só receitas publicadas, por título (o seletor do plano, US-054)', async () => {
    const T = await novoTenant(app.db);
    const b = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Bolo de banana' });
    const a = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Aveia overnight' });
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Rascunho', status: 'rascunho' });
    await novoConteudo(app.db, T, { titulo: 'Orientação' });
    expect(await listarReceitasPublicadas(T.ctx, app.db)).toEqual([{ id: a.id, titulo: 'Aveia overnight' }, { id: b.id, titulo: 'Bolo de banana' }]);
  });
});
```

Run: `pnpm test src/modules/conteudo/receitas.test.ts` → FAIL.

- [ ] **Step 4: Implementação** — `src/modules/conteudo/receitas.ts`

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { contents, foods, recipeIngredients, recipes } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar, lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import type { Nutrientes100 } from '@/modules/alimentos/busca';
import { idValido } from '@/modules/pacientes/base';
import { lerQuantidade } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { INGREDIENTES_MAX, MEDIDA_TXT_MAX, MODO_PREPARO_MAX, MSG_RECEITA, RENDIMENTO_MAX } from './constantes';
import { ConteudoError, ConteudoNaoEncontradoError } from './erros';

export type EntradaReceita = { rendimento?: unknown; porcao?: unknown; tempo?: unknown; modo?: unknown; ingredientes?: unknown };
export type ReceitaLida = {
  rendimentoG: number;
  porcaoG: number;
  tempoMin: number | null;
  modoPreparo: string;
  ingredientes: { foodId: string; nome: string; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; quantidadeG: number; medidaCaseiraTxt: string | null }[];
};
export type ReceitaParaPlano = { id: string; titulo: string };
type Valida = { rendimentoG: number; porcaoG: number; tempoMin: number | null; modoPreparo: string; ingredientes: { foodId: string; quantidadeG: number; medidaCaseiraTxt: string | null }[] };

/**
 * Rendimento e porção: arredonda para 1 casa ANTES de conferir — "0,04" vira 0,0, que o CHECK do banco (> 0) recusaria
 * com 500; aqui vira a mensagem do campo. Mínimo 0,1 g (a menor quantidade que a coluna numeric(7,1) guarda).
 */
const gramas = (v: unknown): number | null => {
  const n = lerDecimal(v);
  if (n === null || Number.isNaN(n)) return null;
  const g = arredondar(n, 1);
  return g < 0.1 || g > RENDIMENTO_MAX ? null : g;
};

/** Validação completa antes do banco; erros por campo (`ingrediente:<posição>:<campo>` para os ingredientes). */
export function validarReceita(e: EntradaReceita): Valida {
  const erros: Record<string, string> = {};
  const rendimentoG = gramas(e.rendimento);
  if (rendimentoG === null) erros.rendimento = MSG_RECEITA.rendimento;
  const porcaoG = gramas(e.porcao);
  if (porcaoG === null) erros.porcao = MSG_RECEITA.porcao;
  else if (rendimentoG !== null && porcaoG > rendimentoG) erros.porcao = MSG_RECEITA.porcaoMaior;
  const t = lerDecimal(e.tempo);
  const tempoMin = t !== null && Number.isInteger(t) && t >= 1 && t <= 1440 ? t : null;
  if (t !== null && tempoMin === null) erros.tempo = MSG_RECEITA.tempo;
  const modoPreparo = typeof e.modo === 'string' ? e.modo.replace(/\r\n?/g, '\n').trim() : '';
  if (modoPreparo.length > MODO_PREPARO_MAX) erros.modo = MSG_RECEITA.modo;
  const brutos = Array.isArray(e.ingredientes) ? (e.ingredientes as unknown[]) : [];
  if (!brutos.length) erros.ingredientes = MSG_RECEITA.ingredientes;
  if (brutos.length > INGREDIENTES_MAX) erros.ingredientes = MSG_RECEITA.ingredientesMax;
  const ingredientes: Valida['ingredientes'] = [];
  if (brutos.length <= INGREDIENTES_MAX)
    brutos.forEach((b, k) => {
      const o = (b ?? {}) as Record<string, unknown>;
      if (!idValido(o.foodId)) {
        erros[`ingrediente:${k}:alimento`] = MSG_PLANO.alimento;
        return;
      }
      const g = lerQuantidade(o.quantidadeG);
      if (g === null) erros[`ingrediente:${k}:quantidade`] = MSG_PLANO.quantidade;
      const medida = normalizarTexto(o.medida);
      if (medida.length > MEDIDA_TXT_MAX) erros[`ingrediente:${k}:medida`] = MSG_RECEITA.medida;
      ingredientes.push({ foodId: o.foodId, quantidadeG: g === null ? 0 : arredondar(g, 2), medidaCaseiraTxt: medida || null });
    });
  if (Object.keys(erros).length) throw new ConteudoError(erros);
  return { rendimentoG: rendimentoG!, porcaoG: porcaoG!, tempoMin, modoPreparo, ingredientes };
}

/**
 * US-051: grava a receita inteira (os ingredientes são substituídos). Só conteúdo do tipo receita do tenant (RLS);
 * alimento que a RLS não mostra (de outro consultório) → "Alimento não encontrado." no ingrediente.
 */
export async function salvarReceita(ctx: TenantContext, contentId: string, entrada: EntradaReceita, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (!idValido(contentId)) throw new ConteudoNaoEncontradoError();
  const v = validarReceita(entrada);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ tipo: contents.tipo }).from(contents).where(eq(contents.id, contentId)).for('update');
      if (!c || c.tipo !== 'receita') throw new ConteudoNaoEncontradoError();
      const ids = [...new Set(v.ingredientes.map((i) => i.foodId))];
      const visiveis = new Set((await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, ids))).map((f) => f.id));
      const invisiveis = Object.fromEntries(v.ingredientes.flatMap((i, k) => (visiveis.has(i.foodId) ? [] : [[`ingrediente:${k}:alimento`, MSG_PLANO.alimento]])));
      if (Object.keys(invisiveis).length) throw new ConteudoError(invisiveis);
      const dados = { rendimentoTotalG: v.rendimentoG, porcaoG: v.porcaoG, tempoPreparoMin: v.tempoMin, modoPreparoMd: v.modoPreparo, updatedAt: agora };
      await tx.insert(recipes).values({ tenantId: ctx.tenantId, contentId, ...dados }).onConflictDoUpdate({ target: recipes.contentId, set: dados });
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.contentId, contentId));
      await tx.insert(recipeIngredients).values(v.ingredientes.map((i, ordem) => ({ tenantId: ctx.tenantId, contentId, ...i, ordem })));
      await tx.update(contents).set({ updatedAt: agora }).where(eq(contents.id, contentId));
    },
    deps.db ?? getDb(),
  );
}

/** A receita com os valores ATUAIS dos alimentos (D11). Roda com a RLS de quem lê (no portal, só a receita visível). */
export async function lerReceitaNaTransacao(tx: Tx, contentId: string): Promise<ReceitaLida | null> {
  const [r] = await tx.select().from(recipes).where(eq(recipes.contentId, contentId));
  if (!r) return null;
  const its = await tx
    .select({ i: recipeIngredients, f: { nome: foods.nome, tenantId: foods.tenantId, kcal: foods.kcal, proteinaG: foods.proteinaG, carboidratoG: foods.carboidratoG, lipidioG: foods.lipidioG, fibraG: foods.fibraG } })
    .from(recipeIngredients)
    .innerJoin(foods, eq(foods.id, recipeIngredients.foodId))
    .where(eq(recipeIngredients.contentId, contentId))
    .orderBy(asc(recipeIngredients.ordem));
  return {
    rendimentoG: r.rendimentoTotalG,
    porcaoG: r.porcaoG,
    tempoMin: r.tempoPreparoMin,
    modoPreparo: r.modoPreparoMd,
    ingredientes: its.map(({ i, f }) => ({
      foodId: i.foodId,
      nome: f.nome,
      origem: f.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const),
      porCem: { kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG },
      quantidadeG: i.quantidadeG,
      medidaCaseiraTxt: i.medidaCaseiraTxt,
    })),
  };
}

export async function carregarReceitaDoPainel(ctx: TenantContext, contentId: string, db: Db = getDb()): Promise<ReceitaLida | null> {
  if (!idValido(contentId)) return null;
  return withTenant(ctx, (tx) => lerReceitaNaTransacao(tx, contentId), db);
}

/** US-054: o seletor "Sugestão de receita" do editor do plano — receitas publicadas, por título. */
export async function listarReceitasPublicadas(ctx: TenantContext, db: Db = getDb()): Promise<ReceitaParaPlano[]> {
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: contents.id, titulo: contents.titulo })
        .from(contents)
        .where(and(eq(contents.tipo, 'receita'), eq(contents.status, 'publicado')))
        .orderBy(asc(contents.titulo), asc(contents.id)),
    db,
  );
}
```

`src/modules/alimentos/alimentos-constantes.ts`: `emUso: 'Este alimento está em um plano ou receita e não pode ser excluído.',` (D12; a FK RESTRICT de `recipe_ingredients.food_id` já cai no mesmo `fkViolation` de `excluirAlimento`).

Run: `pnpm test src/modules/conteudo src/modules/alimentos src/modules/plano-alimentar` → PASS.

- [ ] **Step 5: Ação e formulário** — `src/app/painel/conteudos/actions.ts`, acrescentar:

```ts
import { MSG_RECEITA } from '@/modules/conteudo/constantes';
import { salvarReceita } from '@/modules/conteudo/receitas';

export type ReceitaState = { erros?: Record<string, string>; ok?: string };

/** US-051: os ingredientes chegam como JSON (o formulário monta a lista no cliente). */
export async function salvarReceitaAction(id: string, _: ReceitaState, fd: FormData): Promise<ReceitaState> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  let ingredientes: unknown = null;
  try {
    ingredientes = JSON.parse(String(fd.get('ingredientes') ?? '[]'));
  } catch {
    ingredientes = null; // vira "Inclua pelo menos um ingrediente."
  }
  try {
    await salvarReceita(ctx, id, { rendimento: fd.get('rendimento'), porcao: fd.get('porcao'), tempo: fd.get('tempo'), modo: fd.get('modo'), ingredientes });
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message } };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: MSG_RECEITA.salva };
}
```

(juntar `MSG_RECEITA` ao import existente de `@/modules/conteudo/constantes`.)

`src/app/painel/conteudos/[id]/receita-form.tsx`

```tsx
'use client';
import { useActionState, useState } from 'react';
import { BuscaAlimento, Selo } from '@/app/painel/alimentos/busca-alimento';
import { casasDecimais, formatarDecimal, lerDecimal } from '@/lib/numero';
import { MODO_PREPARO_MAX, INGREDIENTES_MAX, MEDIDA_TXT_MAX } from '@/modules/conteudo/constantes';
import { nutrientesPorPorcao, textoPorPorcao } from '@/modules/conteudo/receita-calculo';
import type { ReceitaLida } from '@/modules/conteudo/receitas';
import { lerQuantidade } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { salvarReceitaAction, type ReceitaState } from '../actions';

type Linha = ReceitaLida['ingredientes'][number] & { chave: string; gramasTexto: string; medidaTexto: string };
const num = (n: number) => formatarDecimal(n, casasDecimais(n));
const positivo = (t: string) => {
  const n = lerDecimal(t);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
};

/** US-051: rendimento, porção, tempo, modo de preparo e ingredientes (TACO + "Meu alimento"), com a conta por porção ao vivo. */
export function ReceitaForm({ id, inicial }: { id: string; inicial: ReceitaLida | null }) {
  const [s, enviar, enviando] = useActionState<ReceitaState, FormData>(salvarReceitaAction.bind(null, id), {});
  const [rendimento, setRendimento] = useState(inicial ? num(inicial.rendimentoG) : '');
  const [porcao, setPorcao] = useState(inicial ? num(inicial.porcaoG) : '');
  const [tempo, setTempo] = useState(inicial?.tempoMin ? String(inicial.tempoMin) : '');
  const [modo, setModo] = useState(inicial?.modoPreparo ?? '');
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    (inicial?.ingredientes ?? []).map((i) => ({ ...i, chave: crypto.randomUUID(), gramasTexto: num(i.quantidadeG), medidaTexto: i.medidaCaseiraTxt ?? '' })),
  );
  const erro = (c: string) => s.erros?.[c];
  const calc = nutrientesPorPorcao(linhas.map((l) => ({ porCem: l.porCem, quantidadeG: lerQuantidade(l.gramasTexto) })), positivo(rendimento), positivo(porcao));
  const mudar = (chave: string, campo: 'gramasTexto' | 'medidaTexto', valor: string) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  const json = JSON.stringify(linhas.map((l) => ({ foodId: l.foodId, quantidadeG: l.gramasTexto, medida: l.medidaTexto })));
  const campo = (c: string, nome: string, rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <label htmlFor={nome} className="block font-medium">{rotulo}</label>
      <input id={nome} name={nome} inputMode="decimal" value={valor} onChange={(e) => set(e.target.value)} aria-invalid={erro(c) ? true : undefined} aria-describedby={erro(c) ? `${nome}-erro` : undefined} className="w-32 rounded border p-2" />
      {erro(c) && <p id={`${nome}-erro`} role="alert" className="text-sm text-red-700">{erro(c)}</p>}
    </div>
  );
  return (
    <section aria-labelledby="receita-titulo" className="space-y-4 rounded border p-4">
      <h2 id="receita-titulo" className="font-semibold">Receita</h2>
      <form action={enviar} className="space-y-4">
        <input type="hidden" name="ingredientes" value={json} />
        {erro('geral') && <p role="alert" className="text-red-700">{erro('geral')}</p>}
        <div className="flex flex-wrap gap-4">
          {campo('rendimento', 'rendimento', 'Rendimento total (g)', rendimento, setRendimento)}
          {campo('porcao', 'porcao', 'Porção (g)', porcao, setPorcao)}
          {campo('tempo', 'tempo', 'Tempo de preparo (min)', tempo, setTempo)}
        </div>
        <fieldset className="space-y-2" aria-describedby={erro('ingredientes') ? 'ingredientes-erro' : undefined}>
          <legend className="font-medium">Ingredientes</legend>
          <ul className="space-y-2">
            {linhas.map((l, k) => {
              const eq = erro(`ingrediente:${k}:quantidade`);
              return (
                <li key={l.chave} className="flex flex-wrap items-end gap-3">
                  <p className="min-w-48 flex-1">{l.nome} <Selo origem={l.origem} />{l.porCem.kcal === null && <span className="ml-2 text-sm text-zinc-600">{MSG_PLANO.semValor}</span>}</p>
                  <div className="space-y-1">
                    <label htmlFor={`${l.chave}-g`} className="block text-sm">{`Gramas de ${l.nome}`}</label>
                    <input id={`${l.chave}-g`} inputMode="decimal" value={l.gramasTexto} onChange={(e) => mudar(l.chave, 'gramasTexto', e.target.value)} aria-invalid={eq ? true : undefined} aria-describedby={eq ? `${l.chave}-erro` : undefined} className="w-24 rounded border p-2" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${l.chave}-m`} className="block text-sm">{`Medida caseira de ${l.nome} (opcional)`}</label>
                    <input id={`${l.chave}-m`} maxLength={MEDIDA_TXT_MAX} value={l.medidaTexto} onChange={(e) => mudar(l.chave, 'medidaTexto', e.target.value)} className="w-40 rounded border p-2" />
                  </div>
                  <button type="button" className="text-sm underline" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>{`Remover ${l.nome}`}</button>
                  {(eq ?? erro(`ingrediente:${k}:alimento`) ?? erro(`ingrediente:${k}:medida`)) && (
                    <p id={`${l.chave}-erro`} role="alert" className="w-full text-sm text-red-700">{eq ?? erro(`ingrediente:${k}:alimento`) ?? erro(`ingrediente:${k}:medida`)}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {linhas.length < INGREDIENTES_MAX && (
            <BuscaAlimento
              rotulo="Adicionar ingrediente"
              aoEscolher={(a) => setLinhas((ls) => [...ls, { foodId: a.id, nome: a.nome, origem: a.origem, porCem: a.porCem, quantidadeG: 0, medidaCaseiraTxt: null, chave: crypto.randomUUID(), gramasTexto: '', medidaTexto: '' }])}
            />
          )}
          {erro('ingredientes') && <p id="ingredientes-erro" role="alert" className="text-sm text-red-700">{erro('ingredientes')}</p>}
        </fieldset>
        <p aria-live="polite" className="font-medium">{calc ? textoPorPorcao(calc) : ''}</p>
        <div className="space-y-1">
          <label htmlFor="modo" className="block font-medium">Modo de preparo</label>
          <textarea id="modo" name="modo" rows={6} maxLength={MODO_PREPARO_MAX} value={modo} onChange={(e) => setModo(e.target.value)} aria-invalid={erro('modo') ? true : undefined} aria-describedby={erro('modo') ? 'modo-erro' : undefined} className="w-full rounded border p-2" />
          {erro('modo') && <p id="modo-erro" role="alert" className="text-sm text-red-700">{erro('modo')}</p>}
        </div>
        <p role="status">{s.ok}</p>
        <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Salvar receita</button>
      </form>
    </section>
  );
}
```

`src/app/painel/conteudos/[id]/page.tsx`: importar `ReceitaForm` (`./receita-form`) e `carregarReceitaDoPainel` (`@/modules/conteudo/receitas`); antes do `<ArquivosDoConteudo`, acrescentar `{c.tipo === 'receita' && <ReceitaForm id={c.id} inicial={await carregarReceitaDoPainel(ctx, c.id)} />}`. O "Modo de preparo" usa o mesmo markdown da orientação no portal (T7): a ajuda "Use **negrito**, *itálico*, listas com - e títulos com ##." não aparece aqui (texto corrido também funciona).

Run: `pnpm lint && pnpm typecheck && pnpm test src/app/painel` → PASS. Conferência manual: nova receita "Panqueca de aveia" → "Adicionar ingrediente" (aveia), 1000 g / 250 g → o "Por porção" muda ao digitar; porção 1200 → "A porção não pode ser maior que o rendimento".

- [ ] **Step 6: Commit**

```bash
git add src/modules/conteudo/receita-calculo.ts src/modules/conteudo/receita-calculo.test.ts src/modules/conteudo/receitas.ts src/modules/conteudo/receitas.test.ts src/app/painel/conteudos src/modules/alimentos/alimentos-constantes.ts
git commit -m "feat(conteudo): receita com ingredientes da tabela de alimentos e valor por porção (US-051, RN-11)"
```

---

### Task 7: Aba "Conteúdos" no portal — feed, busca, filtros, favoritos, visualização e o detalhe (P07-06; US-055, US-050, US-051, US-052; débito T-4)

**Files:**
- Create: `src/modules/portal/conteudos.ts` (+ `conteudos.test.ts`), `src/app/p/(portal)/conteudos/page.tsx`, `src/app/p/(portal)/conteudos/actions.ts`, `src/app/p/(portal)/conteudos/marcar-visto.tsx`, `src/app/p/(portal)/conteudos/[id]/page.tsx`, `src/app/api/p/conteudos/[id]/pdf/route.ts` (+ `route.test.ts`)
- Modify: `src/app/p/navegacao.ts` (+ `navegacao.test.ts`), `src/app/p/nav-portal.tsx`, `src/app/p/(portal)/layout.tsx` (T-4), `src/app/p/(portal)/plano/page.tsx` (link "Lista de compras", D3)

**Interfaces:**
- Consumes: `requirePaciente`, `requireApiPaciente`; `pacienteDaSessao`; `signFileUrl`; `lerReceitaNaTransacao`, `ReceitaLida` (T6); `nutrientesPorPorcao`, `textoPorPorcao` (T6); `videoDoConteudo`, `VideoDoLink` (T3); `Markdown` (T4); `PlayerVideo`, `CapaDoConteudo` (T3); `FEED_LIMITE`, `FILTROS_DO_FEED`, `MSG_PORTAL_CONTEUDO`, `ROTULO_TIPO_CONTEUDO`, `ehTipoConteudo` (T2); RLS da audiência e `liberarReceitasDoPlano` (T2).
- Produces:
  - `@/modules/portal/conteudos`: `type FiltroDoFeed = { tipo?: TipoConteudo; busca?: string; etiqueta?: string; favoritos?: boolean }`, `type ItemDoFeed = { id; tipo; titulo; resumo; capaUrl: string | null; publicadoEm: Date; novo: boolean; favorito: boolean }`, `feedDeConteudos(ctx, filtro?, db?): Promise<{ itens: ItemDoFeed[]; etiquetas: string[] }>`, `type ConteudoDoPaciente` (com `soPeloPlano: boolean`), `conteudoDoPaciente(ctx, id, db?, o?: { doPlano?: boolean }): Promise<ConteudoDoPaciente | null>` (`doPlano`: a receita aberta pelo cartão "Sugestão de receita", `?de=plano` — exceção da RN-12), `registrarVisualizacao(ctx, id, db?): Promise<boolean>`, `marcarFavorito(ctx, id, favorito: boolean, db?): Promise<boolean>`, `caminhoDoPdfDoConteudo(ctx, id, db?): Promise<string | null>`.
  - `ItemPortal = { href: string; rotulo: string; tambem?: string[] }`; `ITENS_DO_PORTAL` com "Conteúdos" no lugar de "Compras" (D3).

- [ ] **Step 1: Teste do módulo do portal (falha)** — `src/modules/portal/conteudos.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { caminhoDoPdfDoConteudo, conteudoDoPaciente, feedDeConteudos, marcarFavorito, registrarVisualizacao } from './conteudos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia' });
  return { T, ana, bia, ctxAna: ctxPaciente(T.tenantId, ana.id), ctxBia: ctxPaciente(T.tenantId, bia.id) };
}
const titulos = (r: { itens: { titulo: string }[] }) => r.itens.map((i) => i.titulo);

describe('aba "Conteúdos" (US-055)', () => {
  it('feed: só a audiência, do mais recente para o mais antigo, filtro por tipo, "Novo" até abrir', async () => {
    const { T, ana, ctxAna, ctxBia } = await cenario();
    const antigo = await novoConteudo(app.db, T, { titulo: 'Como ler rótulos', publicadoEm: new Date('2026-10-01T12:00:00Z') });
    await novoConteudo(app.db, T, { tipo: 'video', titulo: 'Como montar o prato', videoProvider: 'youtube', videoId: 'dQw4w9WgXcQ', publicadoEm: new Date('2026-10-02T12:00:00Z') });
    await novoConteudo(app.db, T, { titulo: 'Só da Ana', visibilidade: 'pacientes', pacientes: [ana.id], publicadoEm: new Date('2026-10-03T12:00:00Z') });
    await novoConteudo(app.db, T, { titulo: 'Rascunho', status: 'rascunho' });
    expect(titulos(await feedDeConteudos(ctxAna, {}, app.db))).toEqual(['Só da Ana', 'Como montar o prato', 'Como ler rótulos']);
    expect(titulos(await feedDeConteudos(ctxBia, {}, app.db))).toEqual(['Como montar o prato', 'Como ler rótulos']);
    expect(titulos(await feedDeConteudos(ctxAna, { tipo: 'video' }, app.db))).toEqual(['Como montar o prato']);
    expect((await feedDeConteudos(ctxAna, {}, app.db)).itens.every((i) => i.novo)).toBe(true);
    expect(await registrarVisualizacao(ctxAna, antigo.id, app.db)).toBe(true);
    expect(await registrarVisualizacao(ctxAna, antigo.id, app.db)).toBe(true); // "uma única vez": a segunda não duplica
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from content_views where content_id = ${antigo.id}`), app.db);
    expect(n.rows[0]).toEqual({ n: 1 });
    expect((await feedDeConteudos(ctxAna, {}, app.db)).itens.find((i) => i.titulo === 'Como ler rótulos')!.novo).toBe(false);
  });

  it('"Busca e filtro": "aveia" no título ou resumo E a etiqueta "sem lactose"; as etiquetas do filtro vêm do que ela vê', async () => {
    const { T, ctxAna } = await cenario();
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', etiquetas: ['sem lactose'] });
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Mingau', resumo: 'Com aveia e leite', etiquetas: ['café da manhã'] });
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Bolo sem leite', etiquetas: ['sem lactose'] });
    expect(titulos(await feedDeConteudos(ctxAna, { busca: 'aveia', etiqueta: 'sem lactose' }, app.db))).toEqual(['Panqueca de aveia']);
    expect(titulos(await feedDeConteudos(ctxAna, { busca: 'Aveia' }, app.db)).sort()).toEqual(['Mingau', 'Panqueca de aveia']);
    expect(titulos(await feedDeConteudos(ctxAna, { busca: '<script>' }, app.db))).toEqual([]); // nada quebra
    expect((await feedDeConteudos(ctxAna, {}, app.db)).etiquetas).toEqual(['café da manhã', 'sem lactose']);
  });

  it('"Favoritos": favoritar uma receita → aparece em Favoritos; desfavoritar tira; conteúdo invisível não favorita', async () => {
    const { T, ana, ctxAna, ctxBia } = await cenario();
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia' });
    const daAna = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] });
    expect(await marcarFavorito(ctxAna, r.id, true, app.db)).toBe(true);
    expect(titulos(await feedDeConteudos(ctxAna, { favoritos: true }, app.db))).toEqual(['Panqueca de aveia']);
    expect(await marcarFavorito(ctxAna, r.id, false, app.db)).toBe(true);
    expect(titulos(await feedDeConteudos(ctxAna, { favoritos: true }, app.db))).toEqual([]);
    expect(await marcarFavorito(ctxBia, daAna.id, true, app.db)).toBe(false);
    expect(await registrarVisualizacao(ctxBia, daAna.id, app.db)).toBe(false);
  });

  it('detalhe: fora da audiência → null (a página dá 404); receita com valores por porção; PDF só da orientação visível', async () => {
    const { T, ana, ctxAna, ctxBia } = await cenario();
    const daAna = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id], pdfPath: null });
    expect(await conteudoDoPaciente(ctxBia, daAna.id, app.db)).toBeNull();
    expect(await conteudoDoPaciente(ctxBia, 'nao-e-id', app.db)).toBeNull();
    expect(await conteudoDoPaciente(ctxAna, daAna.id, app.db)).toMatchObject({ id: daAna.id, tipo: 'orientacao', temPdf: false, favorito: false, receita: null });
    expect(await caminhoDoPdfDoConteudo(ctxBia, daAna.id, app.db)).toBeNull();
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      videoProvider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: '00000000-0000-4000-8000-000000000003', g: 400 }] },
    });
    const c = (await conteudoDoPaciente(ctxAna, r.id, app.db))!;
    expect(c.video).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(c.receita).toMatchObject({ rendimentoG: 1000, porcaoG: 250, ingredientes: [{ quantidadeG: 400 }] });
    expect(c.porPorcao).toMatch(/^Por porção: \d+ kcal/);
    expect(c.soPeloPlano).toBe(false);
  });

  it('US-054: receita fora da audiência sugerida no plano PUBLICADO da Bia só abre pelo cartão — nem feed, busca, etiqueta, "Novo", favorito ou visualização', async () => {
    const { T, ana, bia, ctxAna, ctxBia } = await cenario();
    const r = await novoConteudo(app.db, T, {
      tipo: 'receita',
      titulo: 'Panqueca de aveia',
      etiquetas: ['sem lactose'],
      visibilidade: 'pacientes',
      pacientes: [ana.id],
      receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: '00000000-0000-4000-8000-000000000003', g: 400 }] },
    });
    await withTenant(
      T.ctx,
      async (tx) => {
        const [p] = (await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo, status, publicado_em) values (${T.tenantId}, ${bia.id}, 'Plano', 'publicado', now()) returning id`)).rows as { id: string }[];
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, horario, ordem, recipe_content_id) values (gen_random_uuid(), ${T.tenantId}, ${bia.id}, ${p.id}, 'Café da manhã', '07:00', 0, ${r.id})`);
      },
      app.db,
    );
    expect(await feedDeConteudos(ctxBia, {}, app.db)).toEqual({ itens: [], etiquetas: [] });
    expect((await feedDeConteudos(ctxBia, { busca: 'aveia', etiqueta: 'sem lactose' }, app.db)).itens).toEqual([]);
    expect(await conteudoDoPaciente(ctxBia, r.id, app.db)).toBeNull(); // URL direta, sem o caminho do plano: 404
    expect(await conteudoDoPaciente(ctxBia, r.id, app.db, { doPlano: true })).toMatchObject({ id: r.id, soPeloPlano: true, favorito: false, receita: { porcaoG: 250 } });
    expect(await marcarFavorito(ctxBia, r.id, true, app.db)).toBe(false);
    expect(await registrarVisualizacao(ctxBia, r.id, app.db)).toBe(false); // D14: quem abre só pelo cartão não conta
    // na audiência, o caminho do plano não muda nada
    expect(await conteudoDoPaciente(ctxAna, r.id, app.db, { doPlano: true })).toMatchObject({ id: r.id, soPeloPlano: false });
  });

  it('guarda: só "Meu plano" e o detalhe pelo cartão ligam a liberação das receitas do plano (o feed nunca)', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const fontes = (await readdir('src', { recursive: true })).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    const usam: string[] = [];
    for (const f of fontes) {
      const texto = await readFile(`src/${f}`, 'utf8');
      if (texto.includes('receitas_do_plano') || texto.includes('liberarReceitasDoPlano(')) usam.push(f);
    }
    // a Tarefa 9 acrescenta 'modules/portal/plano.ts' ("Meu plano") a esta lista — e só ele
    expect(usam.sort()).toEqual(['modules/conteudo/audiencia.ts', 'modules/portal/conteudos.ts']);
  });
});
```

Run: `pnpm test src/modules/portal/conteudos.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/portal/conteudos.ts`

```ts
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { contentFavorites, contents, contentViews } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { signFileUrl } from '@/lib/signed-url';
import { liberarReceitasDoPlano } from '@/modules/conteudo/audiencia';
import { FEED_LIMITE, type TipoConteudo } from '@/modules/conteudo/constantes';
import { nutrientesPorPorcao, textoPorPorcao } from '@/modules/conteudo/receita-calculo';
import { lerReceitaNaTransacao, type ReceitaLida } from '@/modules/conteudo/receitas';
import { videoDoConteudo, type VideoDoLink } from '@/modules/conteudo/video';
import { idValido } from '@/modules/pacientes/base';
import { pacienteDaSessao } from './sessao';

export type FiltroDoFeed = { tipo?: TipoConteudo; busca?: string; etiqueta?: string; favoritos?: boolean };
export type ItemDoFeed = { id: string; tipo: TipoConteudo; titulo: string; resumo: string; capaUrl: string | null; publicadoEm: Date; novo: boolean; favorito: boolean };
export type ConteudoDoPaciente = {
  id: string;
  tipo: TipoConteudo;
  titulo: string;
  resumo: string;
  corpoMd: string;
  capaUrl: string | null;
  video: VideoDoLink | null;
  temPdf: boolean;
  favorito: boolean;
  receita: ReceitaLida | null;
  /** "Por porção: …" (RN-11) ou null fora da receita. */
  porPorcao: string | null;
  /**
   * US-054: receita fora da audiência, aberta pelo cartão do plano publicado (`?de=plano`). A página não mostra
   * "Favoritar" nem registra a visualização (o banco recusaria; D14: não conta) e volta para "Meu plano".
   */
  soPeloPlano: boolean;
};

const BUSCA_MAX = 100;

/**
 * US-055: o feed. A RLS já entrega só o publicado da audiência (D2) — aqui só os filtros, o "Novo" (sem visualização
 * do próprio paciente) e os favoritos. NUNCA chama `liberarReceitasDoPlano`: a receita sugerida no plano, fora da
 * audiência, não entra no feed, na busca nem no filtro de etiquetas (US-054 só abre pelo cartão). Não é prontuário:
 * sem auditoria (D6). Busca full-text (D19).
 */
export async function feedDeConteudos(ctx: TenantContext, filtro: FiltroDoFeed = {}, db: Db = getDb()): Promise<{ itens: ItemDoFeed[]; etiquetas: string[] }> {
  const patientId = pacienteDaSessao(ctx, 'feedDeConteudos');
  const termo = (filtro.busca ?? '').trim().slice(0, BUSCA_MAX);
  const visto = sql<boolean>`exists (select 1 from ${contentViews} v where v.content_id = ${contents.id} and v.patient_id = ${patientId})`;
  const favorito = sql<boolean>`exists (select 1 from ${contentFavorites} f where f.content_id = ${contents.id} and f.patient_id = ${patientId})`;
  const condicoes: SQL[] = [eq(contents.status, 'publicado')];
  if (filtro.tipo) condicoes.push(eq(contents.tipo, filtro.tipo));
  if (filtro.etiqueta) condicoes.push(sql`${contents.etiquetas} @> array[${filtro.etiqueta}]::text[]`);
  if (termo.length >= 2)
    condicoes.push(sql`to_tsvector('portuguese', app_unaccent(${contents.titulo} || ' ' || ${contents.resumo})) @@ websearch_to_tsquery('portuguese', app_unaccent(${termo}))`);
  if (filtro.favoritos) condicoes.push(favorito);
  return withTenant(
    ctx,
    async (tx) => {
      const rs = await tx
        .select({ id: contents.id, tipo: contents.tipo, titulo: contents.titulo, resumo: contents.resumo, capaPath: contents.capaPath, publicadoEm: contents.publicadoEm, visto, favorito })
        .from(contents)
        .where(and(...condicoes))
        .orderBy(desc(contents.publicadoEm), desc(contents.id))
        .limit(FEED_LIMITE);
      const e = await tx.execute(sql`select coalesce(array_agg(distinct x order by x), '{}') as etiquetas from ${contents}, unnest(${contents.etiquetas}) as x where ${contents.status} = 'publicado'`);
      return {
        itens: rs.map((r) => ({
          id: r.id,
          tipo: r.tipo as TipoConteudo,
          titulo: r.titulo,
          resumo: r.resumo,
          capaUrl: r.capaPath ? signFileUrl(r.capaPath) : null,
          publicadoEm: r.publicadoEm!,
          novo: !r.visto,
          favorito: r.favorito,
        })),
        etiquetas: (e.rows[0] as { etiquetas: string[] }).etiquetas,
      };
    },
    db,
  );
}

/**
 * O conteúdo aberto pelo paciente; fora da audiência (ou id inválido) → null, e a página responde 404 (US-053).
 * `doPlano` (o link do cartão "Sugestão de receita", US-054): se a audiência não o mostra, liga a liberação das receitas
 * do plano NESTA transação e tenta de novo — a RLS só a entrega se for receita de refeição do plano publicado dele.
 */
export async function conteudoDoPaciente(ctx: TenantContext, id: string, db: Db = getDb(), o: { doPlano?: boolean } = {}): Promise<ConteudoDoPaciente | null> {
  const patientId = pacienteDaSessao(ctx, 'conteudoDoPaciente');
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const ler = () => tx.select().from(contents).where(and(eq(contents.id, id), eq(contents.status, 'publicado')));
      let [c] = await ler();
      let soPeloPlano = false;
      if (!c && o.doPlano) {
        await liberarReceitasDoPlano(tx);
        [c] = await ler();
        soPeloPlano = Boolean(c);
      }
      if (!c) return null;
      const [fav] = await tx.select({ id: contentFavorites.id }).from(contentFavorites).where(and(eq(contentFavorites.contentId, id), eq(contentFavorites.patientId, patientId)));
      const receita = c.tipo === 'receita' ? await lerReceitaNaTransacao(tx, id) : null;
      const n = receita ? nutrientesPorPorcao(receita.ingredientes, receita.rendimentoG, receita.porcaoG) : null;
      return {
        id: c.id,
        tipo: c.tipo as TipoConteudo,
        titulo: c.titulo,
        resumo: c.resumo,
        corpoMd: c.corpoMd,
        capaUrl: c.capaPath ? signFileUrl(c.capaPath) : null,
        video: videoDoConteudo(c),
        temPdf: Boolean(c.pdfPath),
        favorito: Boolean(fav),
        receita,
        porPorcao: n ? textoPorPorcao(n) : null,
        soPeloPlano,
      };
    },
    db,
  );
}

/** D18: uma visualização por paciente (ON CONFLICT DO NOTHING). Conteúdo que ele não vê → false (o banco também recusa). */
export async function registrarVisualizacao(ctx: TenantContext, id: string, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'registrarVisualizacao');
  if (!idValido(id)) return false;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ id: contents.id }).from(contents).where(eq(contents.id, id));
      if (!c) return false;
      await tx.insert(contentViews).values({ tenantId: ctx.tenantId, contentId: id, patientId }).onConflictDoNothing();
      return true;
    },
    db,
  );
}

/** US-055 "Favoritos": marca ou desmarca. Conteúdo que ele não vê → false. */
export async function marcarFavorito(ctx: TenantContext, id: string, favorito: boolean, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'marcarFavorito');
  if (!idValido(id)) return false;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ id: contents.id }).from(contents).where(eq(contents.id, id));
      if (!c) return false;
      if (favorito) await tx.insert(contentFavorites).values({ tenantId: ctx.tenantId, contentId: id, patientId }).onConflictDoNothing();
      else await tx.delete(contentFavorites).where(and(eq(contentFavorites.contentId, id), eq(contentFavorites.patientId, patientId)));
      return true;
    },
    db,
  );
}

/** US-052 "Baixar material (PDF)": o caminho interno, para a rota assinar na hora do clique (D20). */
export async function caminhoDoPdfDoConteudo(ctx: TenantContext, id: string, db: Db = getDb()): Promise<string | null> {
  pacienteDaSessao(ctx, 'caminhoDoPdfDoConteudo');
  if (!idValido(id)) return null;
  const [c] = await withTenant(ctx, (tx) => tx.select({ pdfPath: contents.pdfPath }).from(contents).where(and(eq(contents.id, id), eq(contents.tipo, 'orientacao'))), db);
  return c?.pdfPath ?? null;
}
```

Run: `pnpm test src/modules/portal/conteudos.test.ts` → PASS.

- [ ] **Step 3: Navegação (D3) e layout (T-4)** — teste primeiro, em `src/app/p/navegacao.test.ts`:

```ts
  it('D3 (Plano 07): "Conteúdos" no lugar de "Compras"; a lista de compras marca a aba "Plano"; continuam 7 abas (R16)', () => {
    expect(ITENS_DO_PORTAL.map((i) => i.rotulo)).toEqual(['Início', 'Plano', 'Diário', 'Conteúdos', 'Evolução', 'Agenda', 'Perfil']);
    expect(itemAtual('/p/conteudos/0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).toBe('/p/conteudos');
    expect(itemAtual('/p/compras')).toBe('/p/plano');
  });
```

Run: `pnpm test src/app/p/navegacao.test.ts` → FAIL. Depois, `src/app/p/navegacao.ts`:

```ts
export type ItemPortal = { href: string; rotulo: string; /** Outras telas que marcam esta aba. */ tambem?: string[] };

/**
 * D23 (Plano 06): as abas do portal, em ordem — grade de 7 colunas (R16, 360 px). D3 (Plano 07): "Conteúdos" entrou no
 * lugar de "Compras"; a lista de compras é um link em "Plano" e marca essa aba. Depois do MVP ("Exames", "IA Nutri"),
 * decidir de novo o que sai da barra (ou um "Mais").
 */
export const ITENS_DO_PORTAL: ItemPortal[] = [
  { href: '/p/inicio', rotulo: 'Início' },
  { href: '/p/plano', rotulo: 'Plano', tambem: ['/p/compras'] },
  { href: '/p/diario', rotulo: 'Diário' },
  { href: '/p/conteudos', rotulo: 'Conteúdos' },
  { href: '/p/evolucao', rotulo: 'Evolução' },
  { href: '/p/agenda', rotulo: 'Agenda' },
  { href: '/p/perfil', rotulo: 'Perfil' },
];

const dentro = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** O item da aba atual (também nas subpáginas: /p/agenda/… marca "Agenda"; /p/compras marca "Plano"). */
export function itemAtual(pathname: string): string | null {
  return ITENS_DO_PORTAL.find((i) => dentro(pathname, i.href) || (i.tambem ?? []).some((t) => dentro(pathname, t)))?.href ?? null;
}
```

`src/app/p/nav-portal.tsx`: trocar o comentário R16 por "R16 / D3 (Plano 07): grade de 7 colunas (Início, Plano, Diário, Conteúdos, Evolução, Agenda, Perfil) com texto pequeno…" (a classe `grid-cols-7` fica).

`src/app/p/(portal)/plano/page.tsx` (D3): importar `Link` de `next/link` e, logo depois do bloco do link "Baixar PDF" (dentro do ramo do plano publicado — a lista exige plano), acrescentar `<Link href="/p/compras" className="ml-4 inline-flex min-h-11 items-center underline">Lista de compras</Link>`.

T-4 — `src/app/p/(portal)/layout.tsx`: o `<div className="flex min-h-dvh flex-col">` vira `<div className="flex flex-1 flex-col">` (o `body` já é `min-h-full flex flex-col` e o `header` do "Sair" vem antes: `min-h-dvh` somava a altura do cabeçalho e criava rolagem vertical em toda tela do portal). Conferência no E2E da Tarefa 13.

Run: `pnpm test src/app/p` → PASS.

- [ ] **Step 4: Páginas do portal** — `src/app/p/(portal)/conteudos/actions.ts`

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { marcarFavorito, registrarVisualizacao } from '@/modules/portal/conteudos';

/** D18: chamada pela página no navegador, uma vez (não no render: a pré-busca do next/link não conta). Sem revalidar. */
export async function vistoAction(id: string): Promise<void> {
  const { ctx } = await requirePaciente(`/p/conteudos/${id}`);
  await registrarVisualizacao(ctx, id);
}

/** US-055 "Favoritos". */
export async function favoritoAction(id: string, favorito: boolean): Promise<void> {
  const { ctx } = await requirePaciente(`/p/conteudos/${id}`);
  await marcarFavorito(ctx, id, favorito);
  revalidatePath(`/p/conteudos/${id}`);
  revalidatePath('/p/conteudos');
}
```

`src/app/p/(portal)/conteudos/marcar-visto.tsx`

```tsx
'use client';
import { useEffect } from 'react';
import { vistoAction } from './actions';

/** D18: registra a visualização quando a página abre no navegador (em dev o Strict Mode chama duas vezes: o banco ignora a segunda). */
export function MarcarVisto({ id }: { id: string }) {
  useEffect(() => {
    void vistoAction(id).catch(() => undefined);
  }, [id]);
  return null;
}
```

`src/app/p/(portal)/conteudos/page.tsx`

```tsx
import Link from 'next/link';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { requirePaciente } from '@/lib/paciente-session';
import { ehTipoConteudo, FILTROS_DO_FEED, MSG_PORTAL_CONTEUDO, ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { feedDeConteudos } from '@/modules/portal/conteudos';

export const dynamic = 'force-dynamic';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** US-055: feed, filtros "Vídeos / Receitas / Orientações", "Favoritos", busca e etiqueta do conteúdo. */
export default async function Conteudos({ searchParams }: PageProps<'/p/conteudos'>) {
  const { ctx } = await requirePaciente('/p/conteudos');
  const q = await searchParams;
  const tipo = ehTipoConteudo(um(q.tipo)) ? (um(q.tipo) as 'video' | 'receita' | 'orientacao') : undefined;
  const busca = (um(q.busca) ?? '').slice(0, 100);
  const etiqueta = um(q.etiqueta) || undefined;
  const favoritos = um(q.favoritos) === '1';
  const { itens, etiquetas } = await feedDeConteudos(ctx, { tipo, busca, etiqueta, favoritos });
  const filtrando = Boolean(tipo || busca.trim() || etiqueta);
  const vazio = favoritos ? MSG_PORTAL_CONTEUDO.semFavoritos : filtrando ? MSG_PORTAL_CONTEUDO.semResultado : MSG_PORTAL_CONTEUDO.vazio;
  const aba = (href: string, rotulo: string, atual: boolean) => (
    <Link key={href} href={href} aria-current={atual ? 'page' : undefined} className="inline-flex min-h-11 items-center rounded border px-3 aria-[current=page]:bg-emerald-700 aria-[current=page]:text-white">
      {rotulo}
    </Link>
  );
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Conteúdos</h1>
      <nav aria-label="Filtrar conteúdos" className="flex flex-wrap gap-2">
        {aba('/p/conteudos', 'Todos', !tipo && !favoritos)}
        {FILTROS_DO_FEED.map((f) => aba(`/p/conteudos?tipo=${f.tipo}`, f.rotulo, tipo === f.tipo && !favoritos))}
        {aba('/p/conteudos?favoritos=1', 'Favoritos', favoritos)}
      </nav>
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        {favoritos && <input type="hidden" name="favoritos" value="1" />}
        <div className="space-y-1">
          <label htmlFor="busca" className="block text-sm">Buscar</label>
          <input id="busca" name="busca" type="search" defaultValue={busca} maxLength={100} className="min-h-11 rounded border px-2" />
        </div>
        {etiquetas.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="etiqueta" className="block text-sm">Etiqueta</label>
            <select id="etiqueta" name="etiqueta" defaultValue={etiqueta ?? ''} className="min-h-11 rounded border px-2">
              <option value="">Todas</option>
              {etiquetas.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        )}
        <button className="min-h-11 rounded border px-4">Buscar</button>
      </form>
      {itens.length === 0 ? (
        <p role="status">{vazio}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {itens.map((c) => (
            <li key={c.id}>
              <Link href={`/p/conteudos/${c.id}`} className="block space-y-2 rounded border p-3">
                <CapaDoConteudo tipo={c.tipo} capaUrl={c.capaUrl} />
                <p className="text-sm text-zinc-700">
                  {ROTULO_TIPO_CONTEUDO[c.tipo]}
                  {c.novo && <span className="ml-2 rounded bg-amber-200 px-2 font-semibold text-zinc-900">Novo</span>}
                </p>
                <h2 className="font-semibold">{c.titulo}</h2>
                {c.resumo && <p className="text-sm">{c.resumo}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`src/app/p/(portal)/conteudos/[id]/page.tsx`

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CapaDoConteudo } from '@/components/capa-conteudo';
import { PlayerVideo } from '@/components/player-video';
import { requirePaciente } from '@/lib/paciente-session';
import { formatarDecimal, casasDecimais } from '@/lib/numero';
import { MSG_PORTAL_CONTEUDO } from '@/modules/conteudo/constantes';
import { Markdown } from '@/modules/conteudo/markdown';
import { quantidadeDoItem } from '@/modules/plano-alimentar/calculo';
import { conteudoDoPaciente } from '@/modules/portal/conteudos';
import { favoritoAction } from '../actions';
import { MarcarVisto } from '../marcar-visto';

export const dynamic = 'force-dynamic';

const g = (n: number) => formatarDecimal(n, casasDecimais(n));

/** US-050/051/052/055. Fora da audiência, em rascunho ou de outro consultório: 404 (US-053 "acesso direto pela URL"). */
export default async function ConteudoDoPaciente({ params, searchParams }: PageProps<'/p/conteudos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requirePaciente(`/p/conteudos/${id}`);
  // US-054: o cartão "Sugestão de receita" de "Meu plano" abre com ?de=plano — só aí a receita fora da audiência abre
  const doPlano = (await searchParams).de === 'plano';
  const c = await conteudoDoPaciente(ctx, id, undefined, { doPlano });
  if (!c) notFound();
  return (
    <main className="space-y-4 p-6">
      {/* D14: só pela audiência — quem abre só pelo cartão do plano não registra visualização nem favorita */}
      {!c.soPeloPlano && <MarcarVisto id={c.id} />}
      {c.soPeloPlano ? (
        <Link href="/p/plano" className="inline-flex min-h-11 items-center underline">Voltar ao plano</Link>
      ) : (
        <Link href="/p/conteudos" className="inline-flex min-h-11 items-center underline">Voltar aos conteúdos</Link>
      )}
      <h1 className="text-2xl font-semibold">{c.titulo}</h1>
      {!c.soPeloPlano && (
        <form action={favoritoAction.bind(null, c.id, !c.favorito)}>
          <button className="min-h-11 rounded border px-4">{c.favorito ? MSG_PORTAL_CONTEUDO.desfavoritar : MSG_PORTAL_CONTEUDO.favoritar}</button>
        </form>
      )}
      {c.tipo === 'video' && c.video ? <PlayerVideo video={c.video} titulo={c.titulo} /> : <CapaDoConteudo tipo={c.tipo} capaUrl={c.capaUrl} />}
      {c.resumo && <p>{c.resumo}</p>}
      {c.receita && (
        <>
          <p>{`Rendimento: ${g(c.receita.rendimentoG)} g · Porção: ${g(c.receita.porcaoG)} g`}</p>
          {c.receita.tempoMin && <p>{`Tempo de preparo: ${c.receita.tempoMin} min`}</p>}
          {c.porPorcao && <p className="font-medium">{c.porPorcao}</p>}
          <section aria-labelledby="ingredientes">
            <h2 id="ingredientes" className="font-semibold">Ingredientes</h2>
            <ul className="ml-5 list-disc">
              {c.receita.ingredientes.map((i, k) => <li key={k}>{`${i.nome} — ${quantidadeDoItem(i)}`}</li>)}
            </ul>
          </section>
          {/* US-051 "Vídeo opcional": o vídeo aparece acima do modo de preparo */}
          {c.video && <PlayerVideo video={c.video} titulo={c.titulo} />}
          {c.receita.modoPreparo && (
            <section aria-labelledby="modo-preparo" className="space-y-2">
              <h2 id="modo-preparo" className="font-semibold">Modo de preparo</h2>
              <Markdown texto={c.receita.modoPreparo} className="space-y-2" />
            </section>
          )}
        </>
      )}
      {c.tipo === 'orientacao' && <Markdown texto={c.corpoMd} className="space-y-3 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_ul]:ml-5 [&_ul]:list-disc [&_a]:underline" />}
      {c.temPdf && (
        <a href={`/api/p/conteudos/${c.id}/pdf`} className="inline-flex min-h-11 items-center rounded border px-4">{MSG_PORTAL_CONTEUDO.baixarPdf}</a>
      )}
    </main>
  );
}
```

`src/app/api/p/conteudos/[id]/pdf/route.ts`

```ts
import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdfDoConteudo } from '@/modules/portal/conteudos';

export const dynamic = 'force-dynamic';

/** US-052 "Baixar material (PDF)": a URL assinada (5 min) nasce no clique; fora da audiência → 404 (D20). */
export async function GET(req: Request, { params }: RouteContext<'/api/p/conteudos/[id]/pdf'>): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const caminho = await caminhoDoPdfDoConteudo(acesso.ctx, id);
  if (!caminho) return Response.json({ erro: 'Não encontrado' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), 'cache-control': 'no-store' } });
}
```

Teste — `src/app/api/p/conteudos/[id]/pdf/route.test.ts` (padrão de `src/app/api/p/plano/pdf/route.test.ts`, com `pacienteComConta` + `entrar`):

```ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { contents } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { trocarPdf } from '@/modules/conteudo/arquivos';
import { novoConteudo } from '../../../../../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../../test/portal';
import { entrar } from '../../../../../../../test/sessao';
import { GET } from './route';

vi.mock('server-only', () => ({}));
const db = getDb();
afterAll(() => closeDb());

describe('GET /api/p/conteudos/[id]/pdf (US-052)', () => {
  it('da audiência: 303 para a URL assinada; de outro paciente: 404', async () => {
    const T = await novoTenant(db);
    const { paciente, email } = await pacienteComConta(db, T);
    const outra = await novoPaciente(db, T.ctx);
    const meu = await novoConteudo(db, T, { visibilidade: 'pacientes', pacientes: [paciente.id] });
    const dela = await novoConteudo(db, T, { visibilidade: 'pacientes', pacientes: [outra.id] });
    for (const c of [meu, dela]) await trocarPdf(T.ctx, c.id, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]), { db });
    const cookie = await entrar(getAuth(), email);
    const pedir = (id: string) => GET(new Request(`http://localhost:3000/api/p/conteudos/${id}/pdf`, { headers: { cookie } }), { params: Promise.resolve({ id }) });
    const ok = await pedir(meu.id);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/api\/arquivos\?c=/);
    expect((await pedir(dela.id)).status).toBe(404);
    const [{ pdfPath }] = await withTenant(T.ctx, (tx) => tx.select({ pdfPath: contents.pdfPath }).from(contents).where(eq(contents.id, dela.id)), db);
    expect(pdfPath).not.toBeNull(); // o arquivo existe: é a audiência que esconde
  });
});
```

Run: `pnpm test src/app/api/p/conteudos src/modules/portal` → PASS; `pnpm lint && pnpm typecheck` → PASS.

- [ ] **Step 5: Conferência manual** — `pnpm dev`: paciente de dev → aba "Conteúdos" (7 abas, "Compras" saiu; "Lista de compras" em "Plano"), feed com "Novo", filtro "Vídeos", busca "aveia", "Favoritar" → "Favoritos"; abrir o vídeo (player `youtube-nocookie`), a receita (valores por porção, vídeo acima do modo de preparo) e a orientação (texto formatado, "Baixar material (PDF)" baixa o arquivo); URL de conteúdo de outra paciente → 404.

- [ ] **Step 6: Commit**

```bash
git add src/modules/portal/conteudos.ts src/modules/portal/conteudos.test.ts "src/app/p/(portal)/conteudos" src/app/api/p/conteudos src/app/p/navegacao.ts src/app/p/navegacao.test.ts src/app/p/nav-portal.tsx "src/app/p/(portal)/layout.tsx" "src/app/p/(portal)/plano/page.tsx"
git commit -m "feat(portal): aba Conteúdos — feed da audiência, busca, filtros, favoritos, visualização única, vídeo, receita e orientação com PDF (US-055, D3)"
```

---
### Task 8: Inserts em lote no salvamento automático do plano (débito D04-2, antes da Tarefa 9)

**Files:**
- Create: `src/modules/plano-alimentar/rascunho-lote.test.ts`
- Modify: `src/modules/plano-alimentar/rascunho.ts` (passos 2 e 3 de `salvarRascunho`)

**Interfaces:**
- Consumes: `salvarRascunho`, `criarRascunho` (`rascunho.ts`), `CorpoSalvamento` (`tipos.ts`).
- Produces: o mesmo `salvarRascunho` (assinatura e comportamento iguais), com **um** `INSERT` para as refeições novas e **dois** para os itens novos (principais, depois substituições — FK `meal_items_principal_fk`); só os alterados viram `UPDATE`. A Tarefa 9 mexe neste mesmo trecho.

- [ ] **Step 1: Teste (falha)** — `src/modules/plano-alimentar/rascunho-lote.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import * as schema from '@/db/schema';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPlano } from './carregar';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

/** D04-2: um plano grande (2 refeições × 10 principais + 5 substituições) salvo de uma vez. */
function grande(revisao: number): CorpoSalvamento {
  const refeicoes = ['Café da manhã', 'Almoço'].map((nome, k) => {
    const principais = Array.from({ length: 10 }, () => ({ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }));
    const subs = principais.slice(0, 5).map((p) => ({ id: randomUUID(), foodId: idTaco(3), quantidadeG: '50', medida: null, substituiItemId: p.id }));
    return { id: randomUUID(), nome, horario: k ? '12:00' : '07:00', observacao: '', itens: [...principais, ...subs] };
  });
  return { revisao, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '', refeicoes };
}

describe('salvarRascunho em lote (D04-2)', () => {
  it('30 itens novos: 1 INSERT de refeições e 2 de itens; reenviar igual não grava nada; mudar 1 item = 1 UPDATE', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, { db: app.db });
    const consultas: string[] = [];
    const db = drizzle({ client: app.pool, schema, logger: { logQuery: (q) => void consultas.push(q) } });
    const corpo = grande(0);
    const { revisao } = await salvarRascunho(T.ctx, id, corpo, { db });
    const contar = (re: RegExp) => consultas.filter((q) => re.test(q)).length;
    expect(contar(/^insert into "meals"/)).toBe(1);
    expect(contar(/^insert into "meal_items"/)).toBe(2);
    const plano = (await carregarPlano(T.ctx, id, app.db))!;
    expect(plano.refeicoes.map((r) => r.itens.length)).toEqual([15, 15]);
    expect(plano.refeicoes[0].itens.filter((i) => i.substituiItemId).length).toBe(5);

    consultas.length = 0;
    const mesmo = { ...corpo, revisao, envio: randomUUID() };
    const r2 = await salvarRascunho(T.ctx, id, mesmo, { db });
    expect(contar(/^(insert into|update) "meal(s|_items)"/)).toBe(0);

    consultas.length = 0;
    const mudado = structuredClone({ ...mesmo, revisao: r2.revisao, envio: randomUUID() });
    mudado.refeicoes[1].itens[3].quantidadeG = '120';
    await salvarRascunho(T.ctx, id, mudado, { db });
    expect(contar(/^update "meal_items"/)).toBe(1);
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/rascunho-lote.test.ts` → FAIL (2 INSERTs de refeição e 30 de item).

- [ ] **Step 2: Implementação** — em `salvarRascunho` (`rascunho.ts`), trocar os passos 2 e 3 por:

```ts
        // 2. Refeições novas (um INSERT só — D04-2) e alteradas
        const refeicoesNovas: (typeof meals.$inferInsert)[] = [];
        for (const r of v.refeicoes) {
          const atual = refeicoesAtuais.get(r.id);
          const dados = { nome: r.nome, horario: r.horario, observacao: r.observacao, ordem: r.ordem };
          if (!atual) refeicoesNovas.push({ id: r.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, ...dados });
          else if (!iguais({ nome: atual.nome, horario: atual.horario?.slice(0, 5) ?? null, observacao: atual.observacao, ordem: atual.ordem }, dados))
            await tx.update(meals).set({ ...dados, updatedAt: now }).where(eq(meals.id, r.id));
        }
        if (refeicoesNovas.length) await tx.insert(meals).values(refeicoesNovas);

        // 3. Itens: principais antes das substituições (FK meal_items_principal_fk) — um INSERT por grupo (D04-2); os
        //    alterados, um UPDATE cada (o gatilho de auditoria registra só o que mudou)
        for (const grupo of [v.itens.filter((i) => i.substituiItemId === null), v.itens.filter((i) => i.substituiItemId !== null)]) {
          const novos: (typeof mealItems.$inferInsert)[] = [];
          for (const i of grupo) {
            const atual = itensAtuais.get(i.id);
            const dados = { foodId: i.foodId, quantidadeG: i.quantidadeG, medida: i.medida, medidaCaseiraTxt: i.medidaCaseiraTxt, substituiItemId: i.substituiItemId, ordem: i.ordem };
            if (!atual) novos.push({ id: i.id, tenantId: ctx.tenantId, patientId: p.patientId, planId, mealId: i.mealId, ...dados });
            else if (!iguais({ foodId: atual.foodId, quantidadeG: atual.quantidadeG, medida: atual.medida ?? null, medidaCaseiraTxt: atual.medidaCaseiraTxt, substituiItemId: atual.substituiItemId, ordem: atual.ordem }, dados))
              await tx.update(mealItems).set({ ...dados, updatedAt: now }).where(eq(mealItems.id, i.id));
          }
          if (novos.length) await tx.insert(mealItems).values(novos);
        }
```

Run: `pnpm test src/modules/plano-alimentar src/app/api/painel/planos src/app/painel/planos` → PASS (a suíte do editor e do salvamento continua igual: o resultado gravado é o mesmo).

- [ ] **Step 3: Commit**

```bash
git add src/modules/plano-alimentar/rascunho.ts src/modules/plano-alimentar/rascunho-lote.test.ts
git commit -m "perf(plano): salvamento automático grava refeições e itens novos em lote (D04-2)"
```

---

### Task 9: Receita sugerida numa refeição do plano e o cartão "Sugestão de receita" no portal (P07-05; US-054, US-041)

**Files:**
- Create: `src/modules/plano-alimentar/receita-no-plano.test.ts`
- Modify: `src/modules/plano-alimentar/tipos.ts`, `src/modules/plano-alimentar/constantes.ts`, `src/modules/plano-alimentar/carregar.ts`, `src/modules/plano-alimentar/rascunho.ts` (`validar`, `salvarRascunho`, `copiarConteudo`), `src/app/painel/planos/editor/estado.ts` (+ `estado.test.ts`), `src/app/painel/planos/editor/editor-plano.tsx`, `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`, `src/app/painel/planos/modelos/[id]/page.tsx`, `src/modules/portal/plano.ts` (+ `plano.test.ts`; `liberarReceitasDoPlano` em `planoDoPaciente`), `src/modules/portal/conteudos.test.ts` (a guarda da liberação), `src/app/p/(portal)/plano/page.tsx`

**Interfaces:**
- Consumes: `meals.recipeContentId` e a FK `meals_receita_fk` (T1); a exceção da RN-12 na política de `contents`, ligada por `liberarReceitasDoPlano` (T2); `conteudoDoPaciente(…, { doPlano })` e a guarda da liberação em `src/modules/portal/conteudos.test.ts` (T7); `listarReceitasPublicadas`, `ReceitaParaPlano` (T6); `MSG_RECEITA` (T2); `salvarRascunho` em lote (T8); `publicarPlano`, `editarPublicado`, `salvarComoModelo`.
- Produces:
  - `@/modules/plano-alimentar/tipos`: `type ReceitaDaRefeicao = { id: string; titulo: string; disponivel: boolean }`; `RefeicaoPlano.receita?: ReceitaDaRefeicao` (presente só com sugestão); `RascunhoEnviado.refeicoes[].recipeContentId?: string | null`.
  - `MSG_PLANO.receita = 'Receita não encontrada.'`; erro de campo `refeicao:<id>:receita`.
  - Editor: `Acao` `{ tipo: 'receita'; id: string; receita: { id: string; titulo: string } | null }`; `EditorPlano` aceita `receitas?: ReceitaParaPlano[]`.
  - `@/modules/portal/plano`: `RefeicaoDoPaciente.receita?: { id: string; titulo: string }` (só receita publicada).

- [ ] **Step 1: Teste (falha)** — `src/modules/plano-alimentar/receita-no-plano.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { meals } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { despublicarConteudo, excluirConteudo } from '@/modules/conteudo/conteudos';
import { conteudoDoPaciente, feedDeConteudos } from '@/modules/portal/conteudos';
import { planoDoPaciente } from '@/modules/portal/plano';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError } from './erros';
import { salvarComoModelo } from './modelos';
import { editarPublicado, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db, appUrl: 'https://nutri.exemplo.com' };

/** Rascunho com "Café da manhã 07:00 · arroz 100 g", com ou sem a receita sugerida. */
function corpo(revisao: number, cafe: string, item: string, receita: string | null): CorpoSalvamento {
  return {
    revisao,
    envio: randomUUID(),
    titulo: 'Plano da Ana',
    metaKcal: '',
    mostrarCalorias: true,
    orientacoes: '',
    refeicoes: [{ id: cafe, nome: 'Café da manhã', horario: '07:00', observacao: '', recipeContentId: receita, itens: [{ id: item, foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
  };
}
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PlanoError) return e.erros;
    throw e;
  }
  throw new Error('esperava PlanoError');
};
async function cenario() {
  const T: TenantDeTeste = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx);
  const bia = await novoPaciente(app.db, T.ctx);
  // a receita é só da Bia: a Ana a vê pelo plano (exceção da RN-12)
  const panqueca = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', visibilidade: 'pacientes', pacientes: [bia.id], receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: idTaco(3), g: 200 }] } });
  const { id } = await criarRascunho(T.ctx, ana.id, { db: app.db });
  return { T, ana, panqueca, id, cafe: randomUUID(), item: randomUUID() };
}

describe('"Sugestão de receita" (US-054)', () => {
  it('anexa só receita publicada: rascunho de receita, orientação ou id inventado → "Receita não encontrada." na refeição', async () => {
    const { T, id, cafe, item } = await cenario();
    const rascunho = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Em preparo', status: 'rascunho' });
    const orientacao = await novoConteudo(app.db, T);
    for (const ruim of [rascunho.id, orientacao.id, randomUUID()])
      expect(await erros(salvarRascunho(T.ctx, id, corpo(0, cafe, item, ruim), deps)), ruim).toEqual({ [`refeicao:${cafe}:receita`]: MSG_PLANO.receita });
    expect(await erros(salvarRascunho(T.ctx, id, corpo(0, cafe, item, 'lixo'), deps))).toEqual({ [`refeicao:${cafe}:receita`]: MSG_PLANO.receita });
  });

  it('a Ana vê o cartão mesmo fora da audiência; a receita não entra no total; despublicada, o cartão some e o editor mostra "indisponível" — e salvar de novo não falha', async () => {
    const { T, ana, panqueca, id, cafe, item } = await cenario();
    await salvarRascunho(T.ctx, id, corpo(0, cafe, item, panqueca.id), deps);
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia', disponivel: true });
    await publicarPlano(T.ctx, ana.id, id, deps);
    const comoAna = ctxPaciente(T.tenantId, ana.id);
    const plano = (await planoDoPaciente(comoAna, 'America/Sao_Paulo', { db: app.db }))!;
    expect(plano.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia' });
    expect(plano.totalKcal).toBe('128 kcal'); // só o arroz (100 g): "é só sugestão"
    // a exceção da RN-12 vale só no caminho do plano: no feed da Ana a receita (só da Bia) não aparece
    expect((await feedDeConteudos(comoAna, {}, app.db)).itens).toEqual([]);
    expect(await conteudoDoPaciente(comoAna, panqueca.id, app.db, { doPlano: true })).toMatchObject({ soPeloPlano: true });
    await despublicarConteudo(T.ctx, panqueca.id, { db: app.db });
    expect((await planoDoPaciente(comoAna, 'America/Sao_Paulo', { db: app.db }))!.refeicoes[0].receita).toBeUndefined();
    const { id: nova } = await editarPublicado(T.ctx, ana.id, id, deps); // "Editar" copia a sugestão
    expect((await carregarPlano(T.ctx, nova, app.db))!.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia', disponivel: false });
    const r = (await carregarPlano(T.ctx, nova, app.db))!;
    const mantido = corpo(r.revisao, r.refeicoes[0].id, r.refeicoes[0].itens[0].id, panqueca.id);
    await salvarRascunho(T.ctx, nova, mantido, deps); // a sugestão que já estava, mesmo despublicada, não barra o salvamento
  });

  it('modelo leva a sugestão; excluir a receita solta a sugestão (SET NULL) sem apagar a refeição', async () => {
    const { T, panqueca, id, cafe, item } = await cenario();
    await salvarRascunho(T.ctx, id, corpo(0, cafe, item, panqueca.id), deps);
    const { id: modelo } = await salvarComoModelo(T.ctx, id, 'Modelo com panqueca', deps);
    expect((await carregarPlano(T.ctx, modelo, app.db))!.refeicoes[0].receita?.id).toBe(panqueca.id);
    await excluirConteudo(T.ctx, panqueca.id, { db: app.db });
    const [m] = await withTenant(T.ctx, (tx) => tx.select({ receita: meals.recipeContentId }).from(meals).where(eq(meals.id, cafe)), app.db);
    expect(m).toEqual({ receita: null });
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].receita).toBeUndefined();
  });
});
```

Run: `pnpm test src/modules/plano-alimentar/receita-no-plano.test.ts` → FAIL.

- [ ] **Step 2: Tipos e mensagens** — `src/modules/plano-alimentar/tipos.ts`:

```ts
/** US-054 (D13): receita sugerida na refeição — `disponivel` = publicada (a despublicada fica gravada como "Receita indisponível"). */
export type ReceitaDaRefeicao = { id: string; titulo: string; disponivel: boolean };

export type RefeicaoPlano = { id: string; nome: string; horario: string; observacao: string; itens: ItemPlano[]; receita?: ReceitaDaRefeicao };
```

e em `RascunhoEnviado.refeicoes` acrescentar `recipeContentId?: string | null;` (ausente = sem sugestão).

`src/modules/plano-alimentar/constantes.ts`, em `MSG_PLANO`: `receita: 'Receita não encontrada.',`.

- [ ] **Step 3: Leitura** — `src/modules/plano-alimentar/carregar.ts`, em `lerPlanoNaTransacao`, depois de ler `rs` (importar `contents` de `@/db/schema`, `inArray` de `drizzle-orm` e `type ReceitaDaRefeicao` de `./tipos`):

```ts
  // US-054: título e situação da receita sugerida. Na sessão de paciente a RLS só devolve a publicada (e, fora da
  // audiência, só porque planoDoPaciente ligou liberarReceitasDoPlano nesta transação) — a despublicada fica fora do
  // mapa e a refeição sai sem `disponivel` (o portal esconde o cartão)
  const idsReceita = [...new Set(rs.flatMap((r) => (r.recipeContentId ? [r.recipeContentId] : [])))];
  const receitas = new Map(
    idsReceita.length
      ? (await tx.select({ id: contents.id, titulo: contents.titulo, status: contents.status }).from(contents).where(inArray(contents.id, idsReceita))).map((c) => [c.id, c])
      : [],
  );
  const receitaDa = (id: string | null): { receita?: ReceitaDaRefeicao } => {
    if (!id) return {};
    const c = receitas.get(id);
    return { receita: c ? { id, titulo: c.titulo, disponivel: c.status === 'publicado' } : { id, titulo: '', disponivel: false } };
  };
```

e, no `rs.map((r) => ({ … }))`, acrescentar `...receitaDa(r.recipeContentId),` depois de `observacao`.

- [ ] **Step 4: Gravação** — `src/modules/plano-alimentar/rascunho.ts`:

`type RefeicaoValida = { id: string; nome: string; horario: string | null; observacao: string; ordem: number; recipeContentId: string | null };`

Em `validar`, dentro do `refeicoesEntrada.forEach`, antes do `refeicoes.push(…)`:

```ts
    const receita = r.recipeContentId ?? null;
    if (receita !== null && !idValido(receita)) erros[`${chave}:receita`] = MSG_PLANO.receita;
```

e o `push` passa a levar `recipeContentId: idValido(receita) ? receita : null`.

Em `salvarRascunho`, logo depois de montar `refeicoesAtuais` (importar `contents` de `@/db/schema`):

```ts
        // US-054 (D13): sugestão NOVA (ou trocada) só de receita publicada do tenant; a que já estava fica mesmo se a
        // receita foi despublicada depois ("Receita indisponível"), senão o salvamento automático travaria
        const anexadas = [...new Set(v.refeicoes.flatMap((r) => (r.recipeContentId && r.recipeContentId !== (refeicoesAtuais.get(r.id)?.recipeContentId ?? null) ? [r.recipeContentId] : [])))];
        if (anexadas.length) {
          const ok = new Set(
            (await tx.select({ id: contents.id }).from(contents).where(and(inArray(contents.id, anexadas), eq(contents.tipo, 'receita'), eq(contents.status, 'publicado')))).map((c) => c.id),
          );
          const ruins = Object.fromEntries(v.refeicoes.filter((r) => r.recipeContentId && anexadas.includes(r.recipeContentId) && !ok.has(r.recipeContentId)).map((r) => [`refeicao:${r.id}:receita`, MSG_PLANO.receita]));
          if (Object.keys(ruins).length) throw new PlanoError(ruins);
        }
```

No passo 2 (o da Tarefa 8), `dados` passa a ser `{ nome: r.nome, horario: r.horario, observacao: r.observacao, ordem: r.ordem, recipeContentId: r.recipeContentId }` e a comparação, `iguais({ nome: atual.nome, horario: atual.horario?.slice(0, 5) ?? null, observacao: atual.observacao, ordem: atual.ordem, recipeContentId: atual.recipeContentId }, dados)`. Anexar, trocar ou tirar a receita vira um UPDATE em `meals` — auditado como "Plano alimentar" pelo gatilho que já existe (0045).

Em `copiarConteudo`, no `insert` de `meals`, acrescentar `recipeContentId: r.recipeContentId` (D13: modelos e "Editar" levam a sugestão).

Run: `pnpm test src/modules/plano-alimentar` → PASS menos o caso do portal (Step 6).

- [ ] **Step 5: Editor** — `src/app/painel/planos/editor/estado.ts`:

```ts
import type { ReceitaDaRefeicao } from '@/modules/plano-alimentar/tipos';
export type RefeicaoEstado = { id: string; nome: string; horario: string; observacao: string; itens: ItemEstado[]; receita?: ReceitaDaRefeicao | null };
```

`Acao` ganha `| { tipo: 'receita'; id: string; receita: { id: string; titulo: string } | null }`; em `estadoInicial`, na refeição, `...(r.receita ? { receita: r.receita } : {}),`; em `reduzir`:

```ts
    case 'receita':
      return { ...e, refeicoes: e.refeicoes.map((r) => (r.id === a.id ? { ...r, receita: a.receita ? { ...a.receita, disponivel: true } : null } : r)) };
```

em `paraEnvio`, na refeição, `...(r.receita ? { recipeContentId: r.receita.id } : {}),` (ausente = sem sugestão); em `errosSemCampo`, `campos.add(`refeicao:${r.id}:receita`)` junto dos outros campos da refeição.

Teste — `src/app/painel/planos/editor/estado.test.ts`:

```ts
  it('US-054: escolher, trocar e tirar a receita; o envio leva recipeContentId só com sugestão', () => {
    const plano: PlanoDoCliente = {
      id: 'p1', patientId: 'pa', isTemplate: false, titulo: 'Plano', metaKcal: null, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
      publicadoEm: null, mostrarCalorias: false, orientacoes: '', pdfStatus: null,
      refeicoes: [{ id: 'r1', nome: 'Café', horario: '07:00', observacao: '', itens: [], receita: { id: 'c1', titulo: 'Panqueca', disponivel: false } }],
    };
    const e0 = estadoInicial(plano);
    expect(e0.refeicoes[0].receita).toEqual({ id: 'c1', titulo: 'Panqueca', disponivel: false });
    const e1 = reduzir(e0, { tipo: 'receita', id: 'r1', receita: { id: 'c2', titulo: 'Mingau' } });
    expect(e1.refeicoes[0].receita).toEqual({ id: 'c2', titulo: 'Mingau', disponivel: true });
    expect(paraEnvio(e1, 3).refeicoes[0].recipeContentId).toBe('c2');
    const e2 = reduzir(e1, { tipo: 'receita', id: 'r1', receita: null });
    expect(paraEnvio(e2, 3).refeicoes[0]).not.toHaveProperty('recipeContentId');
    expect(errosSemCampo(e2, { 'refeicao:r1:receita': 'Receita não encontrada.' })).toEqual([]);
  });
```

(importar `type PlanoDoCliente` de `@/modules/plano-alimentar/tipos` no teste, se ainda não estiver.)

`src/app/painel/planos/editor/editor-plano.tsx`:
- `type Props = { …; receitas?: ReceitaParaPlano[] }` (importar `ReceitaParaPlano` de `@/modules/conteudo/receitas` com `import type` e `MSG_RECEITA` de `@/modules/conteudo/constantes`); `Editor` recebe `receitas = []` e passa `receitas={receitas}` a cada `<Refeicao`.
- Em `Refeicao` (props `receitas: ReceitaParaPlano[]`), dentro do `<fieldset … sm:grid-cols-4>`, depois do total da refeição:

```tsx
        <div className="space-y-1 sm:col-span-4">
          <label htmlFor={`${r.id}-receita`} className="block font-medium">{`Sugestão de receita em ${r.nome || 'refeição'}`}</label>
          <select
            id={`${r.id}-receita`}
            value={r.receita?.id ?? ''}
            onChange={(e) => {
              const x = receitas.find((y) => y.id === e.target.value);
              despachar({ tipo: 'receita', id: r.id, receita: x ? { id: x.id, titulo: x.titulo } : null });
            }}
            aria-invalid={erro(`${chave}:receita`) ? true : undefined}
            aria-describedby={erro(`${chave}:receita`) ? `${r.id}-receita-erro` : r.receita && !r.receita.disponivel ? `${r.id}-receita-aviso` : undefined}
            className="w-full rounded border p-2"
          >
            <option value="">Nenhuma</option>
            {r.receita && !r.receita.disponivel && <option value={r.receita.id}>{r.receita.titulo || MSG_RECEITA.indisponivel}</option>}
            {receitas.map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
          </select>
          {r.receita && !r.receita.disponivel && <p id={`${r.id}-receita-aviso`} className="text-sm font-semibold text-amber-800">{MSG_RECEITA.indisponivel}</p>}
          {erro(`${chave}:receita`) && <p id={`${r.id}-receita-erro`} role="alert" className="text-sm text-red-700">{erro(`${chave}:receita`)}</p>}
        </div>
```

Páginas: em `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx` e em `src/app/painel/planos/modelos/[id]/page.tsx`, `receitas={await listarReceitasPublicadas(ctx)}` no `<EditorPlano` (importar de `@/modules/conteudo/receitas`).

Run: `pnpm test src/app/painel/planos` → PASS.

- [ ] **Step 6: Portal** — `src/modules/portal/plano.ts`: `export type RefeicaoDoPaciente = { id: string; nome: string; horario: string; observacao: string; itens: ItemDoPaciente[]; receita?: { id: string; titulo: string } };` e, no `map` das refeições, `...(r.receita?.disponivel ? { receita: { id: r.receita.id, titulo: r.receita.titulo } } : {}),`.

Em `planoDoPaciente`, dentro do `withTenant`, ligar a exceção da RN-12 só nesta transação, antes de ler o plano (importar `liberarReceitasDoPlano` de `@/modules/conteudo/audiencia`):

```ts
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      if (!p) return null;
      // US-054: a receita sugerida aparece no cartão mesmo fora da audiência (RN-12) — só neste caminho (D2)
      await liberarReceitasDoPlano(tx);
      return lerPlanoNaTransacao(tx, p.id, { comMedidas: false });
```

Na guarda da Tarefa 7 (`src/modules/portal/conteudos.test.ts`, "guarda: só \"Meu plano\"…"), a lista esperada passa a ser `['modules/conteudo/audiencia.ts', 'modules/portal/conteudos.ts', 'modules/portal/plano.ts']`.

No mesmo arquivo (importar `createHash` de `node:crypto`), a versão da cópia offline — calculada no servidor e **curta**: o service worker só aceita a mensagem `plano` com `versao` de até 100 caracteres (`textoCurto` em `src/app/sw-regras.ts`) e descarta em silêncio o que passar disso (a cópia antiga ficaria, com a receita despublicada ou o plano velho). Pôr os ids das receitas por extenso estoura com 2 sugestões (36 + 1 + 36 + 1 + 36 = 110):

```ts
/**
 * D6 (Plano 06) + US-054: versão da cópia offline de "Meu plano" = id do plano + resumo das sugestões de receita (o
 * cartão some da cópia quando a receita é despublicada). Resumo de 16 caracteres (sha256 em base64url): 36 + 1 + 16 = 53,
 * dentro do limite de 100 do service worker (`textoCurto`, `src/app/sw-regras.ts`) com qualquer número de refeições.
 */
export function versaoDaCopiaOffline(plano: { id: string; refeicoes: { receita?: { id: string } }[] } | null): string {
  if (!plano) return 'sem-plano';
  const sugestoes = plano.refeicoes.map((r) => r.receita?.id ?? '-').join(',');
  return `${plano.id}:${createHash('sha256').update(sugestoes).digest('base64url').slice(0, 16)}`;
}
```

`src/app/p/(portal)/plano/page.tsx` (importar `Link` de `next/link`):
- dentro do `<li>` da refeição, depois da observação:

```tsx
                  {r.receita && (
                    <p className="mt-2 rounded bg-emerald-50 p-2 text-sm">
                      <span className="font-semibold">Sugestão de receita: </span>
                      {/* ?de=plano: a receita fora da audiência só abre por aqui (RN-12, exceção — D2) */}
                      <Link href={`/p/conteudos/${r.receita.id}?de=plano`} className="underline">{r.receita.titulo}</Link>
                    </p>
                  )}
```

- a versão da cópia offline (D6 do Plano 06) passa a incluir as sugestões, para o cartão sumir também da cópia quando a receita for despublicada: `<GuardarPlano dono={vinculo.patientId} versao={versaoDaCopiaOffline(plano)} />` (importar `versaoDaCopiaOffline` de `@/modules/portal/plano`; o `page.test.ts` simula o módulo com `importOriginal`, então a função real continua lá). Nunca os ids por extenso na versão (limite de 100 do service worker). O link da receita não abre offline (só "Meu plano" fica no aparelho) — sem rede, cai na cópia do plano, como qualquer outra tela.

Testes — `src/modules/portal/plano.test.ts` (importar `versaoDaCopiaOffline` de `./plano`, `lerMensagem` de `@/app/sw-regras` e `MAX_REFEICOES` de `@/modules/plano-alimentar/constantes`):
- plano publicado sem sugestão continua com as refeições **sem** a chave `receita` (`expect(plano.refeicoes[0]).not.toHaveProperty('receita')`);
- a versão cabe na mensagem ao service worker com o pior caso e muda quando uma sugestão sai:

```ts
  it('D6 + US-054: a versão da cópia offline com 15 refeições, todas com receita, passa por lerMensagem e muda quando uma sugestão sai', () => {
    const refeicoes = Array.from({ length: MAX_REFEICOES }, () => ({ receita: { id: randomUUID() } }));
    const plano = { id: randomUUID(), refeicoes };
    const versao = versaoDaCopiaOffline(plano);
    expect(versao.length).toBeLessThanOrEqual(100);
    expect(lerMensagem({ tipo: 'plano', dono: randomUUID(), versao })).not.toBeNull();
    const semUma = versaoDaCopiaOffline({ ...plano, refeicoes: [{}, ...refeicoes.slice(1)] });
    expect(semUma).not.toBe(versao);
    expect(semUma.startsWith(`${plano.id}:`)).toBe(true);
    expect(versaoDaCopiaOffline(null)).toBe('sem-plano');
  });
```

Run: `pnpm test src/modules/plano-alimentar src/modules/portal src/app/p` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/plano-alimentar src/app/painel/planos src/app/painel/pacientes src/modules/portal/plano.ts src/modules/portal/plano.test.ts src/modules/portal/conteudos.test.ts "src/app/p/(portal)/plano/page.tsx"
git commit -m "feat(plano): receita sugerida na refeição (só publicada; não entra no total) e o cartão \"Sugestão de receita\" no portal (US-054, US-041)"
```

---
### Task 10: Aviso de conteúdo novo — no máximo 1 push por paciente a cada 24 h (P07-07; US-053; débitos W-1, X-7)

**Files:**
- Create: `src/modules/conteudo/aviso.ts` (+ `aviso.test.ts`), `drizzle/0084_conteudo_novo.sql` (gerada)
- Modify: `src/db/schema/agenda.ts` (CHECK e índice de `notifications`), `src/modules/conteudo/conteudos.ts` (`publicarConteudo`), `src/modules/conteudo/conteudos.test.ts`, `src/app/painel/conteudos/actions.ts`, `src/app/painel/conteudos/publicar-form.tsx`, `src/modules/notificacoes/mensagens.ts` (+ `mensagens.test.ts`), `src/modules/notificacoes/tipos.ts` (+ teste)

**Interfaces:**
- Consumes: `naAudiencia` (T2); `dispararEnvio`, `emHorarioSilencioso`, `fimDoSilencio` (`src/modules/notificacoes/agendar.ts`); `notifications`, `patients`, `tenants`; `AVISOS_DO_PORTAL`/`pushDaNotificacao` (`mensagens.ts`); `publicarConteudo` (T5).
- Produces:
  - SQL: `notifications_tipo_valido` com `'conteudo_novo'`; índice parcial `notifications_conteudo_idx (tenant_id, patient_id, created_at) WHERE tipo = 'conteudo_novo'`.
  - `@/modules/conteudo/aviso`: `avisarConteudoNovo(tx, o: { tenantId: string; contentId: string; visibilidade: Visibilidade; fuso: string }, agora: Date): Promise<number>`, `JANELA_AVISO_MS`.
  - **Assinatura nova:** `publicarConteudo(ctx, id, opcoes: { avisar: boolean }, deps?: Deps): Promise<{ avisados: number }>` (a T5 chamava `publicarConteudo(ctx, id, deps)`; os testes da T5 passam a `publicarConteudo(ctx, id, { avisar: false }, deps)`).
  - `TipoNotificacao` e `ROTULO_TIPO` com `push_teste`, `comentario_diario`, `plano_novo`, `conteudo_novo` (W-1).

- [ ] **Step 1: Teste (falha)** — `src/modules/conteudo/aviso.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { avisarConteudoNovo } from './aviso';
import { publicarConteudo } from './conteudos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const meioDia = new Date('2026-10-20T15:00:00Z'); // 12:00 em Brasília

async function cenario() {
  const T = await novoTenant(app.db);
  const { paciente: ana } = await pacienteComConta(app.db, T, { nome: 'Ana' });
  const { paciente: arquivada } = await pacienteComConta(app.db, T, { nome: 'Arquivada', status: 'arquivado' });
  const semConta = await novoPaciente(app.db, T.ctx, { nome: 'Sem conta' });
  return { T, ana, arquivada, semConta };
}
const avisos = (T: { ctx: Parameters<typeof withTenant>[0] }) =>
  withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'conteudo_novo')).orderBy(notifications.createdAt), app.db);
const despublicar = (T: { ctx: Parameters<typeof withTenant>[0] }, id: string) =>
  withTenant(T.ctx, (tx) => tx.execute(sql`update contents set status = 'rascunho', publicado_em = null where id = ${id}`), app.db);

describe('aviso de conteúdo novo (US-053, D4, D5)', () => {
  it('só paciente ativo, com conta no portal e na audiência; push pendente agora', async () => {
    const { T, ana } = await cenario();
    const c = await novoConteudo(app.db, T, { status: 'rascunho', titulo: 'Como ler rótulos', corpoMd: 'x' });
    const r = await publicarConteudo(T.ctx, c.id, { avisar: true }, { db: app.db, agora: meioDia });
    expect(r).toEqual({ avisados: 1 });
    const [n] = await avisos(T);
    expect(n).toMatchObject({ patientId: ana.id, canal: 'push', status: 'pendente', appointmentId: null, agendadaPara: meioDia });
  });

  it('"no máximo 1 push de conteúdo por paciente a cada 24 h": o 2º conteúdo na mesma hora não avisa; 25 h depois, avisa', async () => {
    const { T } = await cenario();
    const aviso = (contentId: string, agora: Date) => withTenant(T.ctx, (tx) => avisarConteudoNovo(tx, { tenantId: T.tenantId, contentId, visibilidade: 'todos', fuso: SP }, agora), app.db);
    const c = await novoConteudo(app.db, T);
    expect(await aviso(c.id, meioDia)).toBe(1);
    expect(await aviso(c.id, new Date(meioDia.getTime() + 3_600_000))).toBe(0);
    expect(await aviso(c.id, new Date(meioDia.getTime() + 25 * 3_600_000))).toBe(1);
    expect(await avisos(T)).toHaveLength(2);
  });

  it('publicado às 22h (horário silencioso) → agendado para as 08:00 do dia seguinte', async () => {
    const { T } = await cenario();
    const c = await novoConteudo(app.db, T);
    const vinteDuas = new Date('2026-10-21T01:00:00Z'); // 22:00 de 20/10 em Brasília
    await withTenant(T.ctx, (tx) => avisarConteudoNovo(tx, { tenantId: T.tenantId, contentId: c.id, visibilidade: 'todos', fuso: SP }, vinteDuas), app.db);
    expect((await avisos(T))[0].agendadaPara).toEqual(new Date('2026-10-21T11:00:00Z'));
  });

  it('audiência por etiqueta: só quem está nela (a Ana, sem a etiqueta, não)', async () => {
    const { T } = await cenario();
    const { paciente: bia } = await pacienteComConta(app.db, T, { nome: 'Bia' });
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [bia.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    expect(await withTenant(T.ctx, (tx) => avisarConteudoNovo(tx, { tenantId: T.tenantId, contentId: c.id, visibilidade: 'etiquetas', fuso: SP }, meioDia), app.db)).toBe(1);
    expect((await avisos(T)).map((n) => n.patientId)).toEqual([bia.id]);
  });

  it('sem "Avisar pacientes": nada; duas publicações ao mesmo tempo: um aviso só por paciente', async () => {
    const { T } = await cenario();
    const a = await novoConteudo(app.db, T, { status: 'rascunho', corpoMd: 'a' });
    const b = await novoConteudo(app.db, T, { status: 'rascunho', titulo: 'Outro', corpoMd: 'b' });
    expect(await publicarConteudo(T.ctx, a.id, { avisar: false }, { db: app.db, agora: meioDia })).toEqual({ avisados: 0 });
    await despublicar(T, a.id);
    await Promise.all([a.id, b.id].map((id) => publicarConteudo(T.ctx, id, { avisar: true }, { db: app.db, agora: meioDia })));
    expect(await avisos(T)).toHaveLength(1);
  });
});
```

Run: `pnpm test src/modules/conteudo/aviso.test.ts` → FAIL.

- [ ] **Step 2: Tipo novo no banco** — `src/db/schema/agenda.ts`, em `notifications`: acrescentar `'conteudo_novo'` ao fim da lista de `notifications_tipo_valido` e, na lista de índices:

```ts
    // US-053 / D5: "no máximo 1 push de conteúdo por paciente a cada 24 h" — o último aviso do paciente
    index('notifications_conteudo_idx').on(t.tenantId, t.patientId, t.createdAt).where(sql`${t.tipo} = 'conteudo_novo'`),
```

Run: `pnpm drizzle-kit generate --name conteudo_novo` → `drizzle/0084_conteudo_novo.sql` (conferir: `DROP CONSTRAINT notifications_tipo_valido` + `ADD CONSTRAINT … 'conteudo_novo'` e o `CREATE INDEX`); `pnpm db:migrate`.

- [ ] **Step 3: O aviso** — `src/modules/conteudo/aviso.ts`

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { notifications, patients } from '@/db/schema';
import { dispararEnvio, emHorarioSilencioso, fimDoSilencio } from '@/modules/notificacoes/agendar';
import { naAudiencia } from './audiencia';
import type { Visibilidade } from './constantes';

/** US-053: "no máximo 1 push de conteúdo por paciente a cada 24 h". */
export const JANELA_AVISO_MS = 24 * 3_600_000;

/**
 * US-053 "Aviso de novo conteúdo" (D4, D5), na transação da publicação: um push `conteudo_novo` (texto neutro, motor do
 * Plano 05) para cada paciente ativo, não anonimizado, com conta no portal, na audiência AGORA e sem outro
 * `conteudo_novo` criado nas 24 h anteriores — os demais conteúdos ficam no feed com "Novo". Um INSERT … SELECT só,
 * serializado por tenant (duas publicações ao mesmo tempo não avisam a mesma pessoa duas vezes). No horário
 * silencioso (21h–8h no fuso do tenant) a linha sai às 08:00 pela varredura; fora dele, o envio é disparado já.
 * Devolve quantos pacientes serão avisados.
 */
export async function avisarConteudoNovo(tx: Tx, o: { tenantId: string; contentId: string; visibilidade: Visibilidade; fuso: string }, agora: Date): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('conteudo_novo'), hashtext(${o.tenantId}))`);
  const quando = emHorarioSilencioso(agora, o.fuso) ? fimDoSilencio(agora, o.fuso) : agora;
  const desde = new Date(agora.getTime() - JANELA_AVISO_MS);
  const r = await tx.execute(sql`
    insert into ${notifications} (tenant_id, patient_id, canal, tipo, agendada_para, created_at, updated_at)
    select ${patients.tenantId}, ${patients.id}, 'push', 'conteudo_novo', ${quando.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz
      from ${patients}
     where ${patients.tenantId} = ${o.tenantId}
       and ${patients.userId} is not null
       and ${naAudiencia(o.contentId, o.visibilidade)}
       and not exists (
         select 1 from ${notifications} n
          where n.tenant_id = ${patients.tenantId} and n.patient_id = ${patients.id}
            and n.tipo = 'conteudo_novo' and n.created_at > ${desde.toISOString()}::timestamptz)`);
  const avisados = r.rowCount ?? 0;
  if (avisados && quando.getTime() === agora.getTime()) await dispararEnvio(tx, o.tenantId);
  return avisados;
}
```

- [ ] **Step 4: Publicar com "Avisar pacientes"** — `src/modules/conteudo/conteudos.ts`, trocar `publicarConteudo` por (importar `tenants` de `@/db/schema` e `avisarConteudoNovo` de `./aviso`):

```ts
/**
 * D17: publica (de novo: `publicado_em` renovado — volta ao topo do feed). US-053 "Avisar pacientes": o aviso entra na
 * mesma transação (D5). Devolve quantos pacientes serão avisados.
 */
export async function publicarConteudo(ctx: TenantContext, id: string, opcoes: { avisar: boolean }, deps: Deps = {}): Promise<{ avisados: number }> {
  if (!idValido(id)) throw new ConteudoNaoEncontradoError();
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select().from(contents).where(eq(contents.id, id)).for('update');
      if (!c) throw new ConteudoNaoEncontradoError();
      await exigirPublicavel(tx, c);
      await tx.update(contents).set({ status: 'publicado', publicadoEm: agora, updatedAt: agora }).where(eq(contents.id, id));
      if (!opcoes.avisar) return { avisados: 0 };
      const [t] = await tx.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      return { avisados: await avisarConteudoNovo(tx, { tenantId: ctx.tenantId, contentId: id, visibilidade: c.visibilidade as Visibilidade, fuso: t.fuso }, agora) };
    },
    deps.db ?? getDb(),
  );
}
```

Em `conteudos.test.ts`, trocar as chamadas `publicarConteudo(T.ctx, id, { db: app.db … })` por `publicarConteudo(T.ctx, id, { avisar: false }, { db: app.db … })`.

`src/app/painel/conteudos/actions.ts`, em `publicarConteudoAction` (no lugar do `void fd` e da chamada):

```ts
  const avisar = fd.get('avisar') === 'on';
  let avisados = 0;
  try {
    ({ avisados } = await publicarConteudo(ctx, id, { avisar }));
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message } };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: avisar ? `${MSG_CONTEUDO.publicado} ${MSG_CONTEUDO.avisados(avisados)}` : MSG_CONTEUDO.publicado };
```

`src/app/painel/conteudos/publicar-form.tsx`, dentro do formulário de publicar (o do ramo `!publicado`), antes do botão — o `<p role="status">` continua fora dos dois ramos (Tarefa 5, Step 11), para "Conteúdo publicado. Aviso enviado para N pacientes." aparecer depois do refresh:

```tsx
      <label className="flex items-center gap-2">
        <input type="checkbox" name="avisar" />
        Avisar pacientes
      </label>
```

(e a primeira linha do comentário do componente vira "D17 / US-053: "Publicar" (com "Avisar pacientes") no rascunho; "Despublicar" no publicado."; o resto do comentário fica.)

- [ ] **Step 5: Texto do push e tipos (W-1, X-7)** — `src/modules/notificacoes/mensagens.ts`, em `AVISOS_DO_PORTAL`:

```ts
  // D4 (Plano 07): neutro — o título do conteúdo pode dizer uma condição de saúde na tela de bloqueio
  conteudo_novo: { corpo: 'Sua nutricionista publicou um novo conteúdo', tela: '/p/conteudos' },
```

`src/modules/notificacoes/tipos.ts`:

```ts
export type TipoNotificacao =
  | TipoLembrete | 'consulta_marcada' | 'consulta_cancelada' | 'convite_paciente' | 'resposta_confirmacao' | 'resposta_remarcar'
  | 'push_teste' | 'comentario_diario' | 'plano_novo' | 'conteudo_novo';
```

e em `ROTULO_TIPO`: `push_teste: 'Notificação de teste', comentario_diario: 'Comentário no diário', plano_novo: 'Plano novo', conteudo_novo: 'Conteúdo novo',`.

Testes — `src/modules/notificacoes/mensagens.test.ts`, no caso "push sem consulta": acrescentar `expect(pushDaNotificacao(semConsulta('conteudo_novo'), deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Sua nutricionista publicou um novo conteúdo', url: `https://app.exemplo.com/p/conteudos?v=${tenant.id}` });` e `'conteudo_novo'` na lista do laço que confere que o corpo não tem nome. Em `src/modules/notificacoes/tipos.test.ts` (criar se não existir):

```ts
import { describe, expect, it } from 'vitest';
import { ROTULO_TIPO } from './tipos';

describe('ROTULO_TIPO (W-1)', () => {
  it('tem rótulo para todo tipo do CHECK de notifications', () => {
    for (const t of ['lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar', 'push_teste', 'comentario_diario', 'plano_novo', 'conteudo_novo'])
      expect(ROTULO_TIPO[t as keyof typeof ROTULO_TIPO], t).toBeTruthy();
  });
});
```

Run: `pnpm test src/modules/conteudo src/modules/notificacoes src/app/painel` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/agenda.ts drizzle/0084_conteudo_novo.sql drizzle/meta src/modules/conteudo/aviso.ts src/modules/conteudo/aviso.test.ts src/modules/conteudo/conteudos.ts src/modules/conteudo/conteudos.test.ts src/app/painel/conteudos src/modules/notificacoes
git commit -m "feat(conteudo): \"Avisar pacientes\" — push neutro de conteúdo novo, no máximo 1 a cada 24 h, adiado no horário silencioso (US-053)"
```

---

### Task 11: Métricas de conteúdo — "18 de 40 pacientes (45%)" e quem viu (P07-08; US-056)

**Files:**
- Create: `src/modules/conteudo/metricas.ts` (+ `metricas.test.ts`), `src/app/painel/conteudos/[id]/visualizacoes/page.tsx`
- Modify: `src/app/painel/conteudos/page.tsx` (coluna "Visualizações")

**Interfaces:**
- Consumes: `naAudiencia`, `naAudienciaDaLinha` (T2); `contentViews`, `patients`, `contents`; `ConteudoDaLista` (T5); `arredondar`.
- Produces: `@/modules/conteudo/metricas`: `type Metrica = { vistos: number; audiencia: number }`, `textoDaMetrica(m: Metrica): string`, `metricasDosConteudos(ctx, conteudos: { id: string }[], db?): Promise<Map<string, Metrica>>` (uma consulta agrupada por `content_id`; a visibilidade é lida do banco), `quemViu(ctx, contentId, db?): Promise<{ titulo: string; pessoas: { nome: string; vistoEm: Date }[] } | null>`.

- [ ] **Step 1: Teste (falha)** — `src/modules/conteudo/metricas.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { metricasDosConteudos, quemViu, textoDaMetrica } from './metricas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('métricas (US-056, D14)', () => {
  it('texto da spec, com arredondamento e singular', () => {
    expect(textoDaMetrica({ vistos: 18, audiencia: 40 })).toBe('18 de 40 pacientes (45%)');
    expect(textoDaMetrica({ vistos: 1, audiencia: 3 })).toBe('1 de 3 pacientes (33%)');
    expect(textoDaMetrica({ vistos: 1, audiencia: 1 })).toBe('1 de 1 paciente (100%)');
    expect(textoDaMetrica({ vistos: 0, audiencia: 0 })).toBe('0 de 0 pacientes (0%)');
  });

  it('audiência atual (ativos); quem saiu (arquivado) não conta em nenhum lado; quem viu fora da audiência não conta', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia, caio, duda] = await Promise.all(['Ana', 'Bia', 'Caio', 'Duda'].map((nome) => novoPaciente(app.db, T.ctx, { nome })));
    const c = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id, bia.id, caio.id] });
    const ver = (patientId: string, quando: string) =>
      withTenant(T.ctx, (tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id, visto_em) values (${T.tenantId}, ${c.id}, ${patientId}, ${quando})`), app.db);
    await ver(ana.id, '2026-10-20T12:00:00Z');
    await ver(caio.id, '2026-10-21T12:00:00Z');
    await ver(duda.id, '2026-10-21T13:00:00Z'); // pelo cartão do plano, fora da audiência
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, caio.id)), app.db);
    const m = await metricasDosConteudos(T.ctx, [{ id: c.id }], app.db);
    expect(m.get(c.id)).toEqual({ vistos: 1, audiencia: 2 });
    expect(await quemViu(T.ctx, c.id, app.db)).toEqual({ titulo: c.titulo, pessoas: [{ nome: 'Ana', vistoEm: new Date('2026-10-20T12:00:00Z') }] });
    expect(await quemViu(T.ctx, 'lixo', app.db)).toBeNull();
  });

  it('vários conteúdos numa consulta só: todos, etiqueta, pacientes sem ninguém na audiência e id de outro consultório', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const [ana, bia] = await Promise.all(['Ana', 'Bia'].map((nome) => novoPaciente(app.db, T.ctx, { nome })));
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [ana.id]);
    const todos = await novoConteudo(app.db, T);
    const porEtiqueta = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    const ninguem = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [] });
    const deFora = await novoConteudo(app.db, U);
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id) values (${T.tenantId}, ${todos.id}, ${bia.id}), (${T.tenantId}, ${porEtiqueta.id}, ${ana.id})`), app.db);
    const m = await metricasDosConteudos(T.ctx, [todos, porEtiqueta, ninguem, deFora], app.db);
    expect(Object.fromEntries(m)).toEqual({
      [todos.id]: { vistos: 1, audiencia: 2 },
      [porEtiqueta.id]: { vistos: 1, audiencia: 1 },
      [ninguem.id]: { vistos: 0, audiencia: 0 },
    });
  });
});
```

Run: `pnpm test src/modules/conteudo/metricas.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/conteudo/metricas.ts`

```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { contents, contentViews, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { arredondar } from '@/lib/numero';
import { idValido } from '@/modules/pacientes/base';
import { naAudiencia, naAudienciaDaLinha } from './audiencia';
import type { Visibilidade } from './constantes';

export type Metrica = { vistos: number; audiencia: number };

/** US-056: "18 de 40 pacientes (45%)" — porcentagem inteira (meio para cima); "1 de 1 paciente" no singular. */
export function textoDaMetrica(m: Metrica): string {
  const pct = m.audiencia ? arredondar((m.vistos / m.audiencia) * 100, 0) : 0;
  return `${m.vistos} de ${m.audiencia} ${m.audiencia === 1 ? 'paciente' : 'pacientes'} (${pct}%)`;
}

/**
 * D14: a audiência ATUAL (RN-12: pacientes ativos, com ou sem conta no portal) e quantos deles já abriram — quem saiu
 * da audiência (arquivado, etiqueta tirada) não conta em nenhum dos dois; quem abriu pelo cartão do plano, fora da
 * audiência, também não. UMA consulta agrupada por conteúdo para a lista inteira (até 200 a cada render de
 * /painel/conteudos): conteúdo × pacientes da audiência (left join — sem ninguém, 0 de 0) × visualizações deles; a
 * visibilidade vem da própria linha. Id de outro consultório: a RLS esconde e ele fica fora do mapa.
 */
export async function metricasDosConteudos(ctx: TenantContext, conteudos: { id: string }[], db: Db = getDb()): Promise<Map<string, Metrica>> {
  const ids = [...new Set(conteudos.map((c) => c.id).filter(idValido))];
  if (!ids.length) return new Map();
  const rs = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: contents.id, audiencia: sql<number>`count(${patients.id})::int`, vistos: sql<number>`count(${contentViews.id})::int` })
        .from(contents)
        .leftJoin(patients, and(eq(patients.tenantId, contents.tenantId), naAudienciaDaLinha(contents.id, contents.visibilidade)))
        .leftJoin(contentViews, and(eq(contentViews.tenantId, patients.tenantId), eq(contentViews.contentId, contents.id), eq(contentViews.patientId, patients.id)))
        .where(inArray(contents.id, ids))
        .groupBy(contents.id),
    db,
  );
  return new Map(rs.map((r) => [r.id, { vistos: r.vistos, audiencia: r.audiencia }]));
}

/** "Posso ver a lista de nomes de quem viu" — os da audiência atual, mais recentes primeiro. Sem auditoria (D6). */
export async function quemViu(ctx: TenantContext, contentId: string, db: Db = getDb()): Promise<{ titulo: string; pessoas: { nome: string; vistoEm: Date }[] } | null> {
  if (!idValido(contentId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ titulo: contents.titulo, visibilidade: contents.visibilidade }).from(contents).where(eq(contents.id, contentId));
      if (!c) return null;
      const pessoas = await tx
        .select({ nome: patients.nome, vistoEm: contentViews.vistoEm })
        .from(contentViews)
        .innerJoin(patients, and(eq(patients.tenantId, contentViews.tenantId), eq(patients.id, contentViews.patientId)))
        .where(and(eq(contentViews.contentId, contentId), naAudiencia(contentId, c.visibilidade as Visibilidade)))
        .orderBy(desc(contentViews.vistoEm));
      return { titulo: c.titulo, pessoas };
    },
    db,
  );
}
```

Run: `pnpm test src/modules/conteudo/metricas.test.ts` → PASS.

- [ ] **Step 3: Telas** — `src/app/painel/conteudos/page.tsx`: depois de `listarConteudosDoPainel`, `const metricas = await metricasDosConteudos(ctx, lista.filter((c) => c.status === 'publicado'));`; acrescentar `<th scope="col">Visualizações</th>` e, na linha:

```tsx
                  <td>
                    {metricas.get(c.id) ? (
                      <Link href={`/painel/conteudos/${c.id}/visualizacoes`} className="underline" aria-label={`Ver quem viu: ${c.titulo}`}>
                        {textoDaMetrica(metricas.get(c.id)!)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
```

`src/app/painel/conteudos/[id]/visualizacoes/page.tsx`

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { quemViu } from '@/modules/conteudo/metricas';
import { Cabecalho } from '../../../cabecalho';

export const dynamic = 'force-dynamic';

/** US-056: a lista de nomes de quem viu (da audiência atual). */
export default async function QuemViu({ params }: PageProps<'/painel/conteudos/[id]/visualizacoes'>) {
  const { id } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/conteudos/${id}/visualizacoes`);
  const r = await quemViu(ctx, id);
  if (!r) notFound();
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <Link href={`/painel/conteudos/${id}`} className="text-sm underline">Voltar ao conteúdo</Link>
        <h1 className="text-2xl font-semibold">{`Quem viu: ${r.titulo}`}</h1>
        {r.pessoas.length === 0 ? (
          <p>Ninguém abriu este conteúdo ainda.</p>
        ) : (
          <ul className="divide-y">
            {r.pessoas.map((p, k) => <li key={k} className="py-2">{`${p.nome} — ${quandoComFuso(p.vistoEm, tenant.fuso)}`}</li>)}
          </ul>
        )}
      </main>
    </>
  );
}
```

No `[id]/page.tsx`, logo depois do `<PublicarForm …/>`: `{c.status === 'publicado' && <Link href={`/painel/conteudos/${c.id}/visualizacoes`} className="underline">Ver quem viu</Link>}`.

Run: `pnpm test src/app/painel src/modules/conteudo && pnpm lint && pnpm typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/conteudo/metricas.ts src/modules/conteudo/metricas.test.ts src/app/painel/conteudos
git commit -m "feat(conteudo): métricas \"N de M pacientes (P%)\" pela audiência atual e a lista de quem viu (US-056)"
```

---
### Task 12: LGPD do titular — exclusão, anonimização e exportação com os conteúdos (D15; débitos D04-1 e F-12)

**Files:**
- Create: `src/modules/conteudo/titular.ts` (+ `titular.test.ts`)
- Modify: `src/modules/pacientes/lgpd.ts` (+ `lgpd.test.ts`), `src/modules/pacientes/exportacao-job.ts` (+ `exportacao.test.ts`)

**Interfaces:**
- Consumes: `contentAudience`, `contentFavorites`, `contentViews`, `contents`, `meals`, `mealItems`, `mealPlans`, `foods`; `atenderPedidoExclusao`, `anonimizarVencidos` (`lgpd.ts`); `montarDados`, `DadosExportacao` (`exportacao-job.ts`).
- Produces:
  - `@/modules/conteudo/titular`: `apagarUsoDeConteudo(tx, patientId): Promise<void>`, `type ConteudosDoTitular = { vistos: { titulo: string; vistoEm: string }[]; favoritos: { titulo: string; favoritadoEm: string }[] }`, `conteudosDoTitular(tx, patientId): Promise<ConteudosDoTitular>`.
  - `DadosExportacao.conteudos: ConteudosDoTitular`; `DadosExportacao.planos[].refeicoes[].sugestaoDeReceita: string | null`; `montarDados` lê todas as versões do plano em 3 consultas (`planosParaExportacao`, D04-1); `lerLaudos` → `lerAnexos` (F-12).

- [ ] **Step 1: Teste (falha)** — `src/modules/conteudo/titular.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { apagarUsoDeConteudo, conteudosDoTitular } from './titular';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('conteúdo e o titular (US-018, US-046, D15)', () => {
  it('o que viu e favoritou vai para a exportação; a exclusão apaga alvos, favoritos e visualizações só dele', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx);
    const c = await novoConteudo(app.db, T, { titulo: 'Como ler rótulos', visibilidade: 'pacientes', pacientes: [ana.id, bia.id] });
    await withTenant(
      T.ctx,
      async (tx) => {
        for (const p of [ana.id, bia.id]) {
          await tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id, visto_em) values (${T.tenantId}, ${c.id}, ${p}, '2026-10-20T12:00:00Z')`);
          await tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id, created_at) values (${T.tenantId}, ${c.id}, ${p}, '2026-10-20T12:05:00Z')`);
        }
      },
      app.db,
    );
    expect(await withTenant(T.ctx, (tx) => conteudosDoTitular(tx, ana.id), app.db)).toEqual({
      vistos: [{ titulo: 'Como ler rótulos', vistoEm: '2026-10-20T12:00:00.000Z' }],
      favoritos: [{ titulo: 'Como ler rótulos', favoritadoEm: '2026-10-20T12:05:00.000Z' }],
    });
    await withTenant(T.ctx, (tx) => apagarUsoDeConteudo(tx, ana.id), app.db);
    const restam = await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`select (select count(*) from content_views where patient_id = ${ana.id})::int as v, (select count(*) from content_favorites where patient_id = ${ana.id})::int as f,
        (select count(*) from content_audience where patient_id = ${ana.id})::int as a, (select count(*) from content_views where patient_id = ${bia.id})::int as vb`),
      app.db,
    );
    expect(restam.rows[0]).toEqual({ v: 0, f: 0, a: 0, vb: 1 });
  });
});
```

Run: `pnpm test src/modules/conteudo/titular.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/conteudo/titular.ts`

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { contentAudience, contentFavorites, contents, contentViews } from '@/db/schema';

/**
 * D15 / US-018 ("sai das audiências de conteúdo") / RNF-08 ("sem uso em conteúdo"): na transação do bloqueio e da
 * anonimização, o titular deixa de ser alvo e o uso dele (visualizações, favoritos) some. A saída de content_audience
 * fica no "Histórico de acessos" (gatilho, D6).
 */
export async function apagarUsoDeConteudo(tx: Tx, patientId: string): Promise<void> {
  await tx.delete(contentAudience).where(eq(contentAudience.patientId, patientId));
  await tx.delete(contentFavorites).where(eq(contentFavorites.patientId, patientId));
  await tx.delete(contentViews).where(eq(contentViews.patientId, patientId));
}

export type ConteudosDoTitular = { vistos: { titulo: string; vistoEm: string }[]; favoritos: { titulo: string; favoritadoEm: string }[] };

/** US-018 / US-046 (D15): o que o titular abriu e favoritou, para o dados.json (só o título e a data). */
export async function conteudosDoTitular(tx: Tx, patientId: string): Promise<ConteudosDoTitular> {
  const doConteudo = (t: typeof contentViews | typeof contentFavorites) => and(eq(contents.tenantId, t.tenantId), eq(contents.id, t.contentId));
  const vistos = await tx.select({ titulo: contents.titulo, em: contentViews.vistoEm }).from(contentViews).innerJoin(contents, doConteudo(contentViews)).where(eq(contentViews.patientId, patientId)).orderBy(asc(contentViews.vistoEm));
  const favoritos = await tx.select({ titulo: contents.titulo, em: contentFavorites.createdAt }).from(contentFavorites).innerJoin(contents, doConteudo(contentFavorites)).where(eq(contentFavorites.patientId, patientId)).orderBy(asc(contentFavorites.createdAt));
  return {
    vistos: vistos.map((v) => ({ titulo: v.titulo, vistoEm: v.em.toISOString() })),
    favoritos: favoritos.map((f) => ({ titulo: f.titulo, favoritadoEm: f.em.toISOString() })),
  };
}
```

Run: `pnpm test src/modules/conteudo/titular.test.ts` → PASS.

- [ ] **Step 3: Exclusão e anonimização** — `src/modules/pacientes/lgpd.ts` (importar `apagarUsoDeConteudo` de `@/modules/conteudo/titular`):
- em `atenderPedidoExclusao`, logo depois de `await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, p.id));`: `await apagarUsoDeConteudo(tx, p.id); // D15: sai das audiências de conteúdo (US-018), sem uso em conteúdo (RNF-08)`;
- em `anonimizarVencidos`, depois de `if (r.length) await tx.delete(pushSubscriptions)…`: `if (r.length) await apagarUsoDeConteudo(tx, id);`.

Teste — `src/modules/pacientes/lgpd.test.ts`, no caso que atende o pedido de exclusão da Ana (o que chama `atenderPedidoExclusao(T.ctx, T.tenant, ana.id, ana.nome, deps)`): antes da chamada, gravar como a nutricionista uma visualização, um favorito e um alvo de conteúdo da Ana (`novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [ana.id] })` + os dois `insert` do teste do Step 1); depois, conferir as três contagens da Ana em 0 (mesma consulta do Step 1).

- [ ] **Step 4: Exportação (D15, D04-1, F-12)** — `src/modules/pacientes/exportacao-job.ts`:

Em `DadosExportacao`, na refeição dos planos, acrescentar `sugestaoDeReceita: string | null;` (o título; US-054) e, depois de `diario`:

```ts
  /** Plano 07 (D15): conteúdos que o titular abriu e favoritou (título e data). */
  conteudos: ConteudosDoTitular;
```

Trocar o laço das versões do plano (`for (const { id } of ids) { const pl = await lerPlanoNaTransacao(…) … }`) por `const planos = await planosParaExportacao(tx, ids.map((x) => x.id));` e acrescentar, antes de `montarDados`:

```ts
/**
 * D04-1: todas as versões do plano em 3 consultas (antes, uma leitura completa por versão). Publicado/arquivado com os
 * nomes congelados na publicação (D10 do Plano 04); o rascunho com os atuais. Mesma forma de antes, mais a sugestão
 * de receita da refeição (o título, se ainda existir — D13).
 */
async function planosParaExportacao(tx: Tx, ids: string[]): Promise<DadosExportacao['planos']> {
  if (!ids.length) return [];
  const ps = await tx.select().from(mealPlans).where(inArray(mealPlans.id, ids)).orderBy(asc(mealPlans.versao));
  const rs = await tx.select().from(meals).where(inArray(meals.planId, ids)).orderBy(asc(meals.ordem));
  const its = await tx.select({ i: mealItems, nome: foods.nome }).from(mealItems).innerJoin(foods, eq(foods.id, mealItems.foodId)).where(inArray(mealItems.planId, ids)).orderBy(asc(mealItems.ordem));
  const idsReceita = [...new Set(rs.flatMap((r) => (r.recipeContentId ? [r.recipeContentId] : [])))];
  const titulos = new Map(idsReceita.length ? (await tx.select({ id: contents.id, titulo: contents.titulo }).from(contents).where(inArray(contents.id, idsReceita))).map((c) => [c.id, c.titulo]) : []);
  return ps.map((p) => {
    const nomeDo = (x: (typeof its)[number]) => (p.status !== 'rascunho' && x.i.nutrientes ? x.i.nutrientes.nome : x.nome);
    return {
      versao: p.versao,
      status: p.status,
      titulo: p.titulo,
      publicadoEm: p.publicadoEm?.toISOString() ?? null,
      metaKcal: p.metaKcal,
      orientacoes: p.orientacoes,
      refeicoes: rs
        .filter((r) => r.planId === p.id)
        .map((r) => {
          const itens = its.filter((x) => x.i.mealId === r.id);
          return {
            nome: r.nome,
            horario: r.horario ? r.horario.slice(0, 5) : '',
            observacao: r.observacao,
            sugestaoDeReceita: r.recipeContentId ? (titulos.get(r.recipeContentId) ?? null) : null,
            itens: itens.map((x) => {
              const principal = x.i.substituiItemId ? itens.find((y) => y.i.id === x.i.substituiItemId) : undefined;
              return { alimento: nomeDo(x), quantidadeG: x.i.quantidadeG, medida: x.i.medidaCaseiraTxt, substituiDe: principal ? nomeDo(principal) : null };
            }),
          };
        }),
    };
  });
}
```

(imports: `inArray` de `drizzle-orm`; `contents`, `foods`, `mealItems`, `meals` de `@/db/schema`; `conteudosDoTitular`, `type ConteudosDoTitular` de `@/modules/conteudo/titular`; o `lerPlanoNaTransacao` sai do import se ficar sem uso.) No objeto `dados`, depois de `diario`: `conteudos: await conteudosDoTitular(tx, patientId),` — **lido antes** de montar o objeto (consultas em sequência na mesma transação: `const conteudos = await conteudosDoTitular(tx, patientId);` junto das outras leituras, e `conteudos,` no objeto).

F-12: renomear `lerLaudos` → `lerAnexos` (definição, comentário e a chamada) e a mensagem do log para `'anexo ausente no disco ficou fora da exportação'`.

Testes — `src/modules/pacientes/exportacao.test.ts`:
- no `expect(dados.planos).toEqual([...])` já existente, acrescentar `sugestaoDeReceita: null` à refeição;
- um caso novo: paciente com uma visualização de "Como ler rótulos" e um plano publicado cuja refeição sugere "Panqueca de aveia" → `dados.conteudos.vistos[0].titulo === 'Como ler rótulos'` e `dados.planos[0].refeicoes[0].sugestaoDeReceita === 'Panqueca de aveia'`;
- D04-1: com 4 versões do plano, `montarDados` faz **uma** leitura de `meal_items` (o mesmo `drizzle({ client: app.pool, schema, logger })` da Tarefa 8, contando `/from "meal_items"/` nas consultas) e devolve as 4 versões na ordem.

Run: `pnpm test src/modules/pacientes src/modules/conteudo` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/conteudo/titular.ts src/modules/conteudo/titular.test.ts src/modules/pacientes/lgpd.ts src/modules/pacientes/lgpd.test.ts src/modules/pacientes/exportacao-job.ts src/modules/pacientes/exportacao.test.ts
git commit -m "feat(lgpd): titular sai das audiências na exclusão/anonimização; exportação leva conteúdos e a sugestão de receita; versões do plano sem N+1 (D15, D04-1, F-12)"
```

---

### Task 13: E2E "conteúdo visível só para a audiência certa" (§9.7) e axe das telas novas (RNF-09, RNF-10)

**Files:**
- Create: `e2e/conteudos.spec.ts`
- Modify: `e2e/acessibilidade.spec.ts`

**Interfaces:**
- Consumes: todas as telas das Tarefas 5–11; `entrarComo` (`e2e/helpers.ts`), `pacienteNoPortal`, `publicarPlanoSimples` (`e2e/portal.ts`).
- Produces: `e2e/conteudos.spec.ts` (bloco de IP **10.9.11.x**: nutricionista .1, pacientes .2 e .3); rotas novas no axe.

- [ ] **Step 1: O E2E** — `e2e/conteudos.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal, publicarPlanoSimples } from './portal';

// §9.7 / US-050 a US-056. Bloco de IP deste spec (o limite de login é por IP): 10.9.11.x — nutri .1, Ana .2, Bia .3.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let ana: Awaited<ReturnType<typeof pacienteNoPortal>>;
let bia: Awaited<ReturnType<typeof pacienteNoPortal>>;
const sufixo = Date.now().toString(36);
const VIDEO = `Como montar o prato ${sufixo}`;
const RECEITA = `Panqueca de aveia ${sufixo}`;
let urlDoVideo = '';
let urlDaReceita = '';

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.11.1');
  await expect(nutri).toHaveURL(/\/painel$/);
  ana = await pacienteNoPortal(browser, nutri, '10.9.11.2');
  bia = await pacienteNoPortal(browser, nutri, '10.9.11.3');
});
test.afterAll(async () => {
  await ana?.page.context().close();
  await bia?.page.context().close();
  await nutri?.context().close();
});

test('vídeo só para a Ana (US-050, US-053): a Ana vê no feed com "Novo" e o player sem cookies; a Bia recebe 404 pela URL', async () => {
  await nutri.goto('/painel/conteudos');
  await nutri.getByRole('link', { name: 'Novo vídeo' }).click();
  await nutri.getByLabel('Título').fill(VIDEO);
  await nutri.getByLabel('Link do vídeo').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(nutri.getByText('Vídeos não listados podem ser vistos por quem tiver o link.')).toBeVisible();
  await nutri.getByLabel('Pacientes específicos').check();
  await nutri.getByLabel(ana.nome).check();
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  await nutri.getByLabel('Avisar pacientes').check();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado. Aviso enviado para 1 paciente.' })).toBeVisible();

  await ana.page.goto('/p/conteudos');
  const cartao = ana.page.getByRole('link', { name: new RegExp(VIDEO) });
  await expect(cartao).toContainText('Novo');
  await cartao.click();
  urlDoVideo = new URL(ana.page.url()).pathname;
  await expect(ana.page.locator(`iframe[title="Vídeo: ${VIDEO}"]`)).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await expect
    .poll(async () => {
      await ana.page.goto('/p/conteudos');
      return ana.page.getByRole('link', { name: new RegExp(VIDEO) }).getByText('Novo').count();
    })
    .toBe(0); // US-055: visualização registrada ao abrir

  const resposta = await bia.page.goto(urlDoVideo);
  expect(resposta?.status()).toBe(404);
  await bia.page.goto('/p/conteudos');
  await expect(bia.page.getByRole('link', { name: new RegExp(VIDEO) })).toHaveCount(0);
});

test('receita (US-051, US-055): valor por porção, busca + etiqueta e favoritos', async () => {
  await nutri.goto('/painel/conteudos/novo?tipo=receita');
  await nutri.getByLabel('Título').fill(RECEITA);
  await nutri.getByLabel('Etiquetas do conteúdo').fill('sem lactose');
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  urlDaReceita = new URL(nutri.url()).pathname;
  await nutri.getByLabel('Rendimento total (g)').fill('1000');
  await nutri.getByLabel('Porção (g)').fill('1200');
  await nutri.getByLabel('Adicionar ingrediente').fill('aveia flocos');
  await nutri.getByRole('option', { name: /Aveia, flocos/ }).first().click();
  await nutri.getByLabel(/^Gramas de Aveia, flocos/).fill('500');
  await nutri.getByRole('button', { name: 'Salvar receita' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'A porção não pode ser maior que o rendimento' })).toBeVisible();
  await nutri.getByLabel('Porção (g)').fill('250');
  await expect(nutri.getByText(/^Por porção: \d+ kcal · proteína/)).toBeVisible();
  await nutri.getByRole('button', { name: 'Salvar receita' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Receita salva.' })).toBeVisible();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();

  await ana.page.goto('/p/conteudos');
  await ana.page.getByLabel('Buscar').fill('aveia');
  await ana.page.getByLabel('Etiqueta').selectOption('sem lactose');
  await ana.page.getByRole('button', { name: 'Buscar' }).click();
  await ana.page.getByRole('link', { name: new RegExp(RECEITA) }).click();
  await expect(ana.page.getByText(/^Por porção: \d+ kcal/)).toBeVisible();
  await ana.page.getByRole('button', { name: 'Favoritar' }).click();
  await expect(ana.page.getByRole('button', { name: 'Remover dos favoritos' })).toBeVisible();
  await ana.page.goto('/p/conteudos?favoritos=1');
  await expect(ana.page.getByRole('link', { name: new RegExp(RECEITA) })).toBeVisible();
});

test('receita na refeição (US-054): a Bia vê a "Sugestão de receita" no plano; despublicada, o cartão some', async () => {
  // a receita é "todos"; o caso "fora da audiência" (só pelo cartão, fora do feed) é coberto nos testes das Tarefas 2, 7 e 9
  await publicarPlanoSimples(nutri, bia.prontuario);
  await nutri.getByRole('button', { name: 'Editar' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByLabel('Sugestão de receita em Almoço').selectOption({ label: RECEITA });
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10_000 });
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();

  await bia.page.goto('/p/plano');
  await expect(bia.page.getByText('Sugestão de receita:')).toBeVisible();
  await expect(bia.page.getByRole('link', { name: RECEITA })).toHaveAttribute('href', `${urlDaReceita.replace('/painel/conteudos/', '/p/conteudos/')}?de=plano`);

  await nutri.goto(urlDaReceita);
  await nutri.getByRole('button', { name: 'Despublicar' }).click();
  await expect(nutri.getByRole('button', { name: 'Publicar' })).toBeVisible();
  await bia.page.goto('/p/plano');
  await expect(bia.page.getByText('Sugestão de receita:')).toHaveCount(0);
});
```

Run: `pnpm build && pnpm test:e2e e2e/conteudos.spec.ts` → PASS (ajustar só seletores que não batam com o texto real das telas — nunca o comportamento).

- [ ] **Step 2: axe e 360 px** — `e2e/acessibilidade.spec.ts`:
- `ROTAS` ganha `'/p/conteudos'` e `'/p/conteudos?favoritos=1'`;
- no teste de 360 px, a lista das abas vira `['Início', 'Plano', 'Diário', 'Conteúdos', 'Evolução', 'Agenda', 'Perfil']` e, no fim do `try`, a T-4:

```ts
    // T-4: sem o min-h-dvh aninhado, tela curta do portal não rola na vertical
    await paciente.page.goto('/p/conteudos?favoritos=1');
    await paciente.page.waitForLoadState('networkidle');
    expect(await paciente.page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
```

- um teste novo, depois do laço das `ROTAS`:

```ts
test('axe sem violações no detalhe de uma orientação (markdown e "Baixar material (PDF)")', async () => {
  const titulo = `Como ler rótulos ${Date.now().toString(36)}`;
  await nutri.goto('/painel/conteudos/novo?tipo=orientacao');
  await nutri.getByLabel('Título').fill(titulo);
  await nutri.getByLabel('Texto').fill('## Rótulos\n\nOlhe **sempre** a *porção*.\n\n- açúcar\n- sódio\n\n[Guia da Anvisa](https://www.gov.br/anvisa)');
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();
  await paciente.page.goto('/p/conteudos');
  await paciente.page.getByRole('link', { name: new RegExp(titulo) }).click();
  await expect(paciente.page.getByRole('heading', { name: 'Rótulos' })).toBeVisible();
  expect(await violacoes(paciente.page)).toEqual([]);
});
```

Run: `pnpm build && pnpm test:e2e` → PASS (os dois projetos, `chromium` e `celular`).

- [ ] **Step 3: Commit**

```bash
git add e2e/conteudos.spec.ts e2e/acessibilidade.spec.ts
git commit -m "test(e2e): conteúdo visível só para a audiência certa, receita no plano e axe das telas de conteúdo (§9.7, RNF-10)"
```

---

## Runbook do deploy do Plano 07 (o dono faz, com confirmação a cada passo)

1. **Snapshot no hPanel** antes do merge (regra do servidor). Lembrete: o **backup no host (P02-11, etapas 6 e 8) segue pendente** — sem ele, nada de pacientes reais.
2. **Nenhuma variável nova.** O push de conteúdo novo usa o VAPID do Plano 06 (`VAPID_PUBLIC_KEY` no app, a mesma do worker — passo 2 do runbook do Plano 06, se ainda não foi feito).
3. **Saída de rede do app:** o oEmbed sai do container `nutri_app` para `www.youtube.com`, `vimeo.com`, `i.ytimg.com` e `i.vimeocdn.com` (HTTPS, porta 443). Sem isso, todo vídeo fica com a capa padrão (o cadastro funciona). Nada a configurar se a VPS já sai para a internet (o Resend e o R2 já saem).
4. Merge (= deploy) só com o OK explícito do dono. As migrations **0081–0084** rodam no deploy (`DATABASE_URL_MIGRATOR`): só criam tabelas, uma coluna nula em `meals`, políticas, uma função e trocam o CHECK de `notifications.tipo` (acrescenta um valor; a validação lê a tabela de notificações uma vez). Nenhuma migração de dados; nada a conferir antes no banco de produção. Enquanto a troca de imagens não termina, o app antigo não conhece as tabelas novas e segue igual.
5. **Teste manual** (o CI não alcança o YouTube/Vimeo reais nem um serviço de push real):
   - Painel: "Novo vídeo" com um link **não listado** do YouTube da Debby → a capa aparece (baixada) e o aviso "Vídeos não listados podem ser vistos por quem tiver o link." está no formulário; um link do Vimeo → player com `dnt=1`.
   - Celular (Android e iPhone, PWA instalado, notificações ativadas): publicar com "Avisar pacientes" → chega "Sua nutricionista publicou um novo conteúdo"; o toque abre "Conteúdos"; o vídeo toca dentro do app; publicar um segundo conteúdo em seguida **não** manda outro push.
   - Orientação com PDF → "Baixar material (PDF)" baixa no celular.
   - Plano: "Editar" → "Sugestão de receita em …" → publicar → o cartão aparece em "Meu plano"; abrir o plano offline continua funcionando (o link da receita não abre sem rede).
6. Apagar os conteúdos de teste só com a confirmação do dono ("Excluir conteúdo" no painel).

## Fechamento do plano (após a Tarefa 13)

- [x] Revisão da entrega conforme o índice (revista em 02/10/2026): revisor por tarefa (ao longo) → **revisão final do branch (workflow) com uma onda de correções** → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor → backlog) → re-revisão **só do diff das correções** → `/security-review` — com o **checklist reforçado** se o dono aceitar a D21:
  - **Audiência (D2):** `contents`, `recipes`, `recipe_ingredients` com `paciente_conteudo_visivel` (guarda verde); `app_conteudo_por_etiqueta` só responde sim/não, só na sessão de paciente, e devolve o contexto do chamador (`app.role`, `app.patient_id`) antes de retornar — conferido também no cluster do runbook, com o dono sem superusuário (`src/db/migrate-owner.test.ts`, caso "audiência por etiqueta (0083)": Ana com a etiqueta vê 1, Bia sem ela vê 0); nenhuma etiqueta de paciente chega ao portal (nem no JSON); rascunho, despublicado e fora da audiência dão 404; a exceção da receita só vale para plano **publicado** do próprio paciente e **só no caminho do plano** (`liberarReceitasDoPlano` só em `planoDoPaciente` e em `conteudoDoPaciente(…, { doPlano: true })` — guarda verde; a receita fora da audiência não aparece no feed, na busca, no filtro de etiquetas nem com "Novo", e não aceita visualização/favorito).
  - **Escrita do paciente:** só `content_views` (`insert`) e `content_favorites` (`insert`, `delete`), e só de conteúdo visível (`paciente_conteudo_visto`/`paciente_conteudo_favorito`); a guarda B-5 confere a expressão.
  - **Arquivos (regra 9, D8, D20):** capa e PDF por `trocarCapa`/`trocarPdf`/`removerCapa`/`removerPdf`; tipo pelo conteúdo; 5 MB/10 MB conferidos no corpo; `sharp` com 40 MP; JPEG sem EXIF e com fundo branco; ponteiro gravado/limpo na transação do arquivo; `excluirConteudo` apaga o conteúdo na transação do último arquivo (upload no meio → nenhum `stored_files` órfão); a capa do oEmbed confere o vídeo com a linha travada; o portal assina só o caminho lido de `contents` pela RLS.
  - **Markdown (D7):** nada de `dangerouslySetInnerHTML`; links só http(s) com `rel`; sem retrocesso catastrófico.
  - **Vídeo e oEmbed (D9, D10):** `src` do iframe só do id validado (regex + CHECK); `referrerPolicy` só da origem; o servidor só pede aos quatro hosts fixos, sem redirecionamento, com prazo e corpo limitados; o link digitado nunca é buscado.
  - **Push (D4, D5):** texto neutro; no máximo 1 por paciente a cada 24 h; só ativo com conta, com push ativo e na audiência; horário silencioso.
  - **LGPD (D15):** exclusão e anonimização apagam o uso de conteúdo do titular; exportação (equipe e titular) com `conteudos`.
  - **Logs:** nada de título, texto, link, nome ou caminho (só ids, provedor e motivo).
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema Critical/Important confirmado, parar e avisar o dono.
- [x] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): P07-01 a P07-08 ✅ (com o PR); débitos B-5, S-9, T-4, D04-1, D04-2, F-12, W-1 ✅; os Minor da revisão num item "P07-09 — débitos do Plano 07". (O `.md` — com o P07-09 por tema, os itens do PR #11 marcados no P06-12 e as notas abaixo — no PR de fechamento; o painel é atualizado à parte.)
- [x] Atualizar a spec para a versão seguinte (**v1.10**, a seguinte à v1.9 da `main`): §4.1 (leitura por audiência no banco, `CONTEUDO_POR_AUDIENCIA`, `app_conteudo_por_etiqueta`, a exceção da RN-12 só no caminho do plano — `app.receitas_do_plano`; B-9: o limite conhecido da D1 — tabelas sem `tenant_id` e as de `RLS_EXCEPTIONS` ficam fora da negação da escrita do paciente), §4.2 (rotas do conteúdo; "Conteúdos" no lugar de "Compras" na barra — D3), §6 INT-05 (prazo total de 5 s, hosts fixos, capa padrão, capa convertida) e INT-03 (`conteudo_novo`), §7 (as tabelas como ficaram, `meals.recipe_content_id` com `SET NULL`, `notifications.tipo`), §8 RN-10 a RN-12 (as notas deste plano), US-050 a US-056 com as notas de entrega (os "Desvios conscientes" desta página) e uma tabela **"Textos de interface do E6"** com os textos novos (como a do E4/E5); conferir também os textos do Plano 06 que ficaram fora da spec (T-9). Feito: corpo da spec, notas "Plano 07, v1.10" em US-018, US-019, US-041 e US-050 a US-056, a tabela "Textos de interface e mensagens do E6" conferida no código (três textos da lista acima não aparecem em tela e ficaram fora: "Conteúdo despublicado.", "Enviar capa", "Enviar PDF"), B-9 (já na §4.1 desde a v1.9) e T-9 (já na tabela do E5) conferidos.
- [x] Anotar para os próximos planos (no backlog, sob o Plano 08 e o Pós-MVP):
  - **Plano 08 (go-live):** P08-05 — a CSP global precisa de `frame-src https://www.youtube-nocookie.com https://player.vimeo.com` e de `img-src 'self'` (as capas são locais); revisar os uploads de capa/PDF e a chamada de rede do oEmbed. P08-03 (k6) — `/p/conteudos` com 100 conteúdos e audiência por etiqueta (a função por linha), a busca full-text e `/painel/conteudos` (a consulta agrupada das métricas com 200 conteúdos publicados e muitos pacientes). P08-06 — o termo do paciente e o DPA precisam citar YouTube e Vimeo (o player roda no aparelho do paciente; P-02/P-18, advogado). P08-08 — a Debby valida o cálculo das receitas (RN-11) e os textos do E6.
  - **Pós-MVP:** Bunny Stream (P-07, Fase 2); vitrine pública de conteúdo (Fase 4); seletor de medidas caseiras na receita (D12); push com o título do conteúdo se o dono quiser (D4); "Mais" na barra quando entrarem "Exames"/"IA Nutri" (D3).
- [x] Lembrar o dono: backup no host (P02-11) pendente; merge (= deploy) só com OK explícito e snapshot no hPanel antes.
- [x] Pedir ao dono o merge do PR (= deploy). Mesclado em `3a1c6a4` com o OK do dono (04/10/2026).

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec**

| Requisito | Onde |
|---|---|
| US-050 "Link válido" (provedor, id, capa via oEmbed, aviso) | Tarefas 3 (`lerLinkDeVideo`, `miniaturaDoVideo`) e 5 (`criarConteudo`, formulário) |
| US-050 "Domínio não suportado" | Tarefas 3 e 5 ("Use um link do YouTube ou do Vimeo") |
| US-050 "oEmbed indisponível" (> 5 s) | Tarefa 3 (prazo total) e 5 (capa padrão) |
| US-050 "Player sem rastreamento" | Tarefa 3 (`urlDoPlayer`, `PlayerVideo`) e 13 (E2E) |
| US-051 validações, cálculo por porção, porção > rendimento, vídeo opcional | Tarefas 6 (`validarReceita`, `nutrientesPorPorcao`) e 7 (vídeo acima do modo de preparo) |
| US-052 texto formatado sanitizado, imagem, "Baixar material (PDF)" | Tarefas 4 (markdown), 5 (capa/PDF) e 7 (rota do PDF) |
| US-053 etiqueta (na hora), pacientes (404 pela URL), rascunho, aviso (1 a cada 24 h) | Tarefas 2 (RLS), 7 (404), 10 (aviso), 13 (E2E) |
| US-054 anexar, cartão fora da audiência, fora do total, despublicada | Tarefas 1 (FK), 2 (exceção RN-12), 9 |
| US-055 feed, filtros, selo "Novo", busca + etiqueta, favoritos, visualização única | Tarefa 7 (+ T13) |
| US-056 "18 de 40 pacientes (45%)" e lista de nomes | Tarefa 11 |
| RN-10, RN-11, RN-12, INT-05 | Tarefas 3, 6, 2, 3/5 |
| RN-08 / US-018 (sai das audiências), RNF-08 | Tarefas 2 (status), 10, 11, 12 |
| RN-18 (cota de capas e PDFs) | Tarefa 5 (`salvarArquivo`; cota esgotada no oEmbed → capa padrão) |
| RNF-07 (isolamento), §9.7 (E2E de audiência) | Tarefas 1, 2 e 13 |
| RNF-09 / RNF-10 (360 px, axe) | Tarefas 7 (D3, T-4) e 13 |
| RNF-11 (logs) | Tarefas 3 (oEmbed e capa só com motivo) e 5 |

**2. Placeholders:** nenhum "TBD"/"implementar depois"; os passos de código trazem o código. Os trechos em prosa são trocas mecânicas em arquivos existentes (uma linha num menu, uma entrada numa lista, um import, a mesma rota com outro nome de função), com o texto exato.

**3. Consistência de tipos e nomes:** `Visibilidade`/`TipoConteudo`/`MSG_*` (T2) em T3–T13; `naAudiencia` (T2) em T10 e T11; `naAudienciaDaLinha` (T2) em T11; `liberarReceitasDoPlano` (T2) em T7 (`conteudoDoPaciente`) e T9 (`planoDoPaciente`); `paraJpegSemMetadados` (T3) em `capa.ts` e `diario-foto-job.ts`; `VideoTrocadoError` (T5) em `arquivos.ts` e `capaDoVideo`; `gravarAudiencia`/`lerAudiencia`/`opcoesDeAudiencia` (T2) em T5; `lerLinkDeVideo`/`urlDoVideo`/`videoDoConteudo`/`VideoDoLink` (T3) em T5 e T7; `processarCapa` (T3) em `trocarCapa` (T5); `Markdown` (T4) em T7; `ConteudoError`/`ConteudoNaoEncontradoError` (T5) em T6; `trocarCapa`/`trocarPdf`/`removerCapa`/`removerPdf` (T5) em T5, T7 (teste) e no `excluirConteudo`; `publicarConteudo` muda de assinatura na T10 (anotado nas duas tarefas e nos testes da T5); `lerReceitaNaTransacao`/`ReceitaLida`/`listarReceitasPublicadas` (T6) em T7 e T9; `nutrientesPorPorcao`/`textoPorPorcao` (T6) em T7; `ReceitaDaRefeicao`/`recipeContentId` (T9) no editor, no portal e na exportação (T12); `apagarUsoDeConteudo`/`conteudosDoTitular` (T12) no `lgpd.ts` e no `exportacao-job.ts`; `novoConteudo`/`novaEtiqueta`/`comoPaciente`/`idsVisiveis` (`test/conteudos.ts`, T2) em T2–T12.

**4. Review Focus:** 1 (fora da audiência) → T2 (`audiencia.test.ts`: todos, pacientes, etiquetas na hora, arquivado, exceção do plano publicado × arquivado × despublicado só com a liberação, visualização/favorito 42501 mesmo com ela), T7 (detalhe `null`, PDF 404, favoritar/visualizar invisível → false, receita do plano fora do feed/busca/etiquetas e só com `doPlano`, guarda da liberação), T9 (cartão some; feed da Ana sem a receita), T13 (404 pela URL no navegador); 2 (link estranho) → T3 (`video.test.ts` com os 18 casos, `oembed.test.ts`: hosts, http, credenciais, redirect, 404, JSON grande/inválido, SVG, prazo); 3 (markdown hostil) → T4 (script, img, javascript:, data:, //, sem fechar, 20000 asteriscos < 200 ms); 4 (números da receita) → T6 (porção = rendimento, porção > rendimento, 0, "0,04" arredondado para 0, vírgula, sem valor na TACO, outro consultório, 51 ingredientes); 5 (aviso em massa) → T10 (24 h, 22h → 08:00, só ativo com conta, etiqueta, publicações simultâneas, sem "Avisar").

## Decisões para o dono

**Em 04/10/2026 o dono aprovou todas, conforme a recomendação do plano (nenhuma alteração).** As marcadas com ★ na tabela "Decisões de desenho" são estas:

1. **D1 — ✅ APROVADA (04/10/2026) — "etiquetas" da audiência são as etiquetas de paciente; as do filtro do feed são rótulos do conteúdo.** *Recomendado* (o paciente nunca vê "gestante"/"diabetes"). Alternativa: um campo só (o filtro mostraria as etiquetas de paciente).
2. **D3 — ✅ APROVADA (04/10/2026) — "Conteúdos" entra no lugar de "Compras" na barra; "Lista de compras" vira link em "Plano".** *Recomendado* (mantém 7 abas em 360 px). Alternativas: 8 abas apertadas, ou um "Mais".
3. **D4 — ✅ APROVADA (04/10/2026) — push neutro "Sua nutricionista publicou um novo conteúdo"**, sem o título (a spec pede "Novo conteúdo: <título>"). *Recomendado* (título pode revelar condição de saúde na tela de bloqueio). Alternativa: o texto da spec.
4. **D6 — ✅ APROVADA (04/10/2026) — auditar quem a nutricionista escolhe para cada conteúdo; não auditar visualização/favorito do paciente nem a leitura do conteúdo.** *Recomendado.* Alternativa: auditar também as visualizações (uma linha por conteúdo aberto no "Histórico de acessos").
5. **D7 — ✅ APROVADA (04/10/2026) — markdown próprio (subconjunto, sem HTML), sem biblioteca nova.** *Recomendado.* Alternativa: `marked` + `sanitize-html`.
6. **D11 — ✅ APROVADA (04/10/2026) — valores da receita calculados na hora (sem congelar).** *Recomendado* (mais simples; corrigir um alimento corrige a receita). Alternativa: congelar na publicação, como o plano.
7. **D13 — ✅ APROVADA (04/10/2026) — sugestão de receita só no rascunho do plano** (no plano em uso, "Editar" cria a nova versão); fora do PDF. *Recomendado* (RN-01). Alternativa: anexar direto no publicado.
8. **D14 — ✅ APROVADA (04/10/2026) — métrica pela audiência atual, contando pacientes sem conta no portal.** *Recomendado* (é a definição da RN-12). Alternativa: contar só quem tem conta.
9. **D21 — ✅ APROVADA (04/10/2026) — `/security-review` do Plano 07 com o checklist reforçado.** *Recomendado* (sem custo).

Pontos que precisam de atenção (não são decisões):
- **Backup (P02-11, etapas 6 e 8) pendente**: sem ele, nada de pacientes reais.
- **Termo do paciente e DPA**: o player do YouTube/Vimeo roda no aparelho do paciente (o IP dele vai ao provedor, mesmo no modo sem cookies). Vale o advogado citar os dois no termo/DPA (P-02/P-18) antes do go-live — anotado para o P08-06.
- **Vídeo não listado não é privado** (P-07, risco aceito na spec): o aviso aparece no formulário; Bunny Stream fica na Fase 2.
- O teste manual do runbook (passo 5) precisa de um celular com o PWA instalado e as notificações ativadas.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa, revisão final do branch no fim) — as 13 tarefas dependem umas das outras por interfaces bem definidas (a audiência da T2 decide tudo o que o portal mostra; o `publicarConteudo` muda de assinatura na T10), e um erro de RLS que mostre conteúdo dirigido por etiqueta ("gestante") a quem não deve é caro de desfazer em produção. As Tarefas 3 e 4 (sem banco) e a 8 (débito do plano) podem correr em paralelo, em worktrees, como no Plano 06.

## Resultado da entrega

**PR #10** (`plano-07-conteudos` → `main`), mesclado em `3a1c6a4` (04/10/2026, 12:33 UTC). Base real da execução: `226c3e3` (PR #11 de débitos já na `main`; nenhuma migration nova nele, então a numeração 0081–0084 ficou); antes do merge, rebase sobre o PR #13 (modo escuro). Execução por workflow (57 agentes) depois de uma varredura prévia do plano contra a `main` (decisões R1–R11 por cima do texto: base, ordem das tarefas, NUL nos textos → "Formulário inválido.", guarda R11 da audiência, testes); as Tarefas 2, 3, 4 e 8 em worktrees paralelos.

| Tarefa | Resultado da revisão por tarefa (2 lentes: spec/qualidade e segurança/LGPD) | Commit na `main` |
|---|---|---|
| T1 — tabelas, RLS, escrita do paciente, guardas (B-5) | 1 rodada de correção: CHECK de 1 a 30 caracteres por etiqueta do conteúdo (`app_etiquetas_validas`, 0082); 0 residual | `1bbb37b`, `6188376` |
| T2 — audiência na leitura (RN-12) | 0 Critical/Important | `f48837c` |
| T3 — vídeo, oEmbed, capa | 0 (concluída com ressalvas registradas; `constantes.ts` igual ao da T2) | `70139e1` |
| T4 — markdown seguro | 1 rodada: título e item sem retrocesso quadrático com U+2028/U+2029 | `0c2f871`, `fba5b53` |
| T5 — conteúdos no painel (S-9) | 0 | `feaa6c2` |
| T6 — receita e valor por porção | 0 | `a8e94d7` |
| T7 — aba "Conteúdos" no portal (T-4, D3) | 0 (concluída com ressalvas: o desvio 3, a barra de abas, foi para o dono) | `82de3a1` |
| T8 — inserts em lote no salvamento automático (D04-2) | 0 | `81098d2` |
| T9 — receita sugerida na refeição e o cartão no portal | 0 | `ebae68b` |
| T10 — aviso de conteúdo novo (W-1/X-7) | 0 | `b3ede29` |
| T11 — métricas e "Quem viu" | 0 | `6e692e1` |
| T12 — LGPD do titular e exportação (D15, D04-1, F-12) | 0 | `ff67053` |
| T13 — E2E da audiência (§9.7) e axe | 1 rodada: seletor exato de "Publicar" depois de despublicar | `56c4574`, `3220171` |

| Etapa | Resultado |
|---|---|
| Revisão final do branch (workflow, 4 lentes: banco, painel e arquivos, portal, LGPD e testes) | **0 Critical/Important** confirmados. Uma onda de correções com **22 minors** corrigidos (`86c1eae`): fronteiras da RN-12 em teste, guardas da R11, das políticas de INSERT e da liberação do plano, 408 e "Remover PDF", tetos e prazo total do oEmbed em teste, a sugestão despublicada e a lista de refeições "ruins", lista vazia do feed, filtro de publicado no portal, exportação do titular, E2E e axe novos, isolamento das métricas e da receita; re-revisão do diff: 0 abertos; 61 minors para o backlog (P07-09, agrupados por tema) |
| `/code-review high` (uma vez) | **No plano**, antes da execução: 10 achados, todos corrigidos no texto (`60469b6`). **No código** (@`4c79d27`): 7 achados, todos corrigidos (`59636ba..31b246f`) — capa do vídeo sem 500 nem cadastro duplicado (Important), `dados.json` sem título de conteúdo despublicado — "Conteúdo indisponível" (Important, LGPD), receita anexada conferida com `FOR SHARE` (Important), versão da cópia offline com o título da receita, a janela dos 500 pacientes enviada pelo formulário (`exibidos`) e as duas decisões do dono: o aviso só para paciente com push ativo e a barra em 7 colunas iguais com hífen (desvio 3 ratificado). Re-revisão só do diff: 7/7 endereçados, 0 abertos; 4 minors para o backlog |
| `/security-review` (checklist reforçado, D21) | **0** achados |
| Testes e CI | `pnpm test` 1467 testes, typecheck, lint e build verdes; E2E de conteúdos e acessibilidade verdes (completo 102/102 na onda da revisão final); **CI verde** @`31b246f` (quality, test, e2e, image). O GitGuardian acusa "Generic Password" em `src/modules/conteudo/oembed.ts`: falso positivo (a recusa de URL com usuário/senha), já presente antes das correções — o dono marca no painel do GitGuardian |
| Deploy | Merge às 12:33 UTC com o OK do dono; o CI publicou a imagem e o Easypanel reimplantou app e worker em **04/10/2026 12:40 UTC** (09h40 BRT): "Migrations aplicadas e role da aplicação conferido", **85 migrations** (até a 0084: tabelas de conteúdo, RLS, a função `app_conteudo_por_etiqueta`, as políticas da audiência e o tipo `conteudo_novo`; nenhuma migração de dados) |

**Fica para o teste manual (runbook, passo 5)** — o CI não alcança o YouTube/Vimeo reais nem um serviço de push real:
- Painel: "Novo vídeo" com um link **não listado** do YouTube da Debby → a capa aparece (baixada) e o aviso "Vídeos não listados podem ser vistos por quem tiver o link." está no formulário; um link do Vimeo → player com `dnt=1`.
- Celular (Android e iPhone, PWA instalado, notificações ativadas): publicar com "Avisar pacientes" → chega "Sua nutricionista publicou um novo conteúdo"; o toque abre "Conteúdos"; o vídeo toca dentro do app; publicar um segundo conteúdo em seguida **não** manda outro push. Sem notificações ativadas, a tela diz "Aviso enviado para 0 pacientes." (só conta quem tem push ativo).
- Orientação com PDF → "Baixar material (PDF)" baixa no celular.
- Plano: "Editar" → "Sugestão de receita em …" → publicar → o cartão aparece em "Meu plano"; abrir o plano offline continua funcionando (o link da receita não abre sem rede).
- Barra de abas no celular: as 7 abas cabem sem rolar ("Conteúdos" e "Evolução" podem quebrar com hífen); "Lista de compras" abre pelo link em "Plano".
- Depois (passo 6): apagar os conteúdos de teste só com a confirmação do dono ("Excluir conteúdo" no painel).

Segue pendente do dono: o backup no host (P02-11, etapas 6 e 8) — sem ele, nada de pacientes reais.

# NutriDebby — Plano alimentar 2 (Plano 19) — Design

| Item | Valor |
|---|---|
| Versão | 0.1 |
| Data | 2026-11-16 |
| Status | **Decisões aprovadas pelo dono em 16/11/2026** ("aprovo todas as recomendações, pode seguir": as seis perguntas da proposta, §14). Spec escrita a partir da proposta aprovada (`.sessoes/proposta-plano-19.json`: brief, crítica de completude, normas e levantamento do código), com as correções da crítica conferidas no código da `main` 5482450 (última migration `0117_ia_nutri_funcoes`). Só documentos nesta etapa: o plano de execução vem depois, nesta mesma branch (`plano-19-plano-alimentar-2`, sessão B, worktree `../nutridebby-b`) |
| Itens do backlog | Paridade Dietbox, onda 1: **PD-20** TBCA (preparada, carga desligada até a autorização) · **PD-21** USDA · **PD-22** micronutrientes e valores de referência · **PD-23** busca por nutriente e equivalentes · **PD-24** texto livre · **PD-25** dias da semana · **PD-26** minhas refeições · **PD-27** observação no app e receitas, materiais e lista de substituição ligados ao plano · **PD-28** listas de substituição reutilizáveis |
| Quando | **Plano 19**, em paralelo como sessão B (`docs/operacao/sessoes-paralelas.md`, branch `docs/sessoes-paralelas`, ainda não mesclada). Só a parte dos lembretes da T8 depende do merge do Plano 17 (D28) |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (RN-01, RN-02, RN-11, RN-12, RN-13, INT-04), [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-020 a US-026, US-041, US-045, US-054), [`2026-10-03-nutridebby-ia-nutricionista-design.md`](2026-10-03-nutridebby-ia-nutricionista-design.md) (RN-109, RN-116, RN-117, RN-126), [`2026-10-03-nutridebby-paciente-exames-ia-design.md`](2026-10-03-nutridebby-paciente-exames-ia-design.md) (IA Nutri, D9 = a, RN-170, RN-171), [`2026-10-08-nutridebby-app-paciente-g-design.md`](2026-10-08-nutridebby-app-paciente-g-design.md) (RN-194, RN-196, RN-197, RN-213), spec do Plano 17 (branch `plano-17-lembretes-rotina`) e o manual técnico, cap. [04](../../manual-tecnico/04-modulos-clinicos.md) (§4.3 Alimentos, §4.4 Plano alimentar) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) |
| Numeração nova | US-230 a US-239 · RN-230 a RN-259 · RNF-230 a RNF-235 · CS-230 a CS-233 · R-230 a R-243 · C-230 a C-235 · DEP-PA1 a DEP-PA8 · PM-PA1 a PM-PA14 · D1 a D28 (decisões **deste documento**; fora daqui, cite "spec 19, Dn", como "Plano 05, D10"). O bloco 230 (e não o 220, o primeiro livre) evita colisão com as specs dos Planos 18 e 20, escritas ao mesmo tempo; se mesmo assim colidir, quem mescla depois renumera. A INT-04 ganha versão nova em vez de um INT novo, pelo mesmo motivo |

---

## 1. Visão

O editor de plano alimentar do NutriDebby (Plano 04) funciona e já está em produção: busca na TACO e nos alimentos
próprios, cálculo em tempo real de energia e macros, substituições por item, modelos, publicação com versão (RN-01) e
PDF. Este plano **amplia o editor sem trocar a base**: tudo entra como extensão de `foods`, `meal_plans`, `meals` e
`meal_items` e de tabelas novas da biblioteca da nutricionista. Para a nutricionista, muda isto:

1. **Mais alimentos.** Além da TACO, a busca traz os alimentos da **USDA (EUA)**, com o nome traduzido e o original em
   inglês ao lado. A TBCA ganha o lugar no modelo, mas a carga fica desligada até a autorização dos coordenadores.
2. **Micronutrientes.** O plano soma os micros (cálcio, ferro, sódio, vitaminas…) e mostra os "mais importantes para o
   paciente" (Res. CFN 594/2017) contra um **perfil de referência** que a própria nutricionista cadastra, com a fonte.
3. **Busca melhor.** Um diálogo de busca com três abas: **Lista** (por nome), **Nutrientes** ("rico em" e "pobre em")
   e **Equivalentes** (mesmo grupo, quantidade calculada, critério à vista).
4. **Texto livre.** O plano pode ser escrito em texto, uma refeição por vez, sem alimentos nem gramas.
5. **Dias da semana.** Cada refeição vale para os dias marcados: um "Almoço" de segunda a sexta e outro no fim de
   semana, no mesmo plano publicado.
6. **Minhas refeições.** Salvar uma refeição pronta e carregá-la em outro plano.
7. **Listas de substituição** reutilizáveis, ligadas ao plano como **cópia congelada**, e **receitas e materiais**
   ligados ao plano, que o paciente abre pelo app mesmo fora da audiência do conteúdo.

Para o paciente, o app mostra as refeições **do dia**, a lista de substituição e as receitas e materiais do plano.
Micronutrientes não aparecem no app (D12). Os lembretes de refeição do Plano 17 passam a respeitar o dia da semana.

**Copiamos a função do Dietbox, nunca a marca, o texto ou o layout** (C-230).

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-230 | Todo plano publicado depois do deploy tem `fonte`, `fonteVersao` e `micros` congelados em cada item, e o perfil de referência congelado quando houver um | Teste de integração de `publicarPlano`; conferência agregada (contagem, sem dado de saúde) no runbook do deploy |
| CS-231 | A busca por nome com TACO + USDA + próprios responde em **p95 ≤ 300 ms** e a busca por nutriente em **p95 ≤ 500 ms** no volume real do seed | `busca.tempo.test.ts` com o seed USDA carregado (RNF-230) |
| CS-232 | **Nenhum** valor de micronutriente nem do perfil de referência chega ao aparelho do paciente (HTML, payload RSC, cópia offline) | Teste das chaves da projeção de `planoDoPaciente` e busca dos valores na resposta (RNF-233, molde do CS-194) |
| CS-233 | **Zero** refeição de outro dia no Hoje, na página Plano, no "Comi assim" e nos lembretes | Testes de unidade com fuso e virada de dia (domingo 23:59 → segunda 00:00 no fuso do consultório) e E2E do fluxo principal |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-230 | **Função, não marca.** O que o Dietbox faz serve de referência de função; nenhum nome de tela, texto, ícone, layout ou dado do Dietbox é copiado. A biblioteca de refeições e de listas começa **vazia** (não importamos o "Assistente" nem os cardápios da Debby que estão lá) | Dono, backlog Paridade Dietbox |
| C-231 | **Sem custo novo.** Nada de API paga nem chamada à API da USDA em produção: o seed é offline, versionado, com hash. A tradução dos nomes é feita uma vez, na preparação do seed (D3) | Memória "No extra costs" |
| C-232 | **Licenças.** TBCA só com autorização por escrito dos coordenadores (termos v7.3/2025). DRI das National Academies têm copyright e os termos proíbem "derivative datasets": nada pré-carregado. USDA é CC0 (citação pedida, não exigida, mas fazemos) | Normas (16/11/2026) |
| C-233 | **RN-01 continua.** No máximo 1 plano publicado e 1 rascunho por paciente; o publicado é imutável e lê a cópia congelada | MVP, RN-01 |
| C-234 | **IA.** A IA da nutricionista continua só com TACO e próprios (RN-116/RN-126) e nada novo sai para ela (RN-109). Materiais e receitas continuam fora da IA Nutri do paciente (D9 = a do Plano 15) | Specs A e C |
| C-235 | **Sessões paralelas.** Planos 17 (sessão A), 18, 19 (sessão B) e 20 (sessão C) andam juntos. Migrations sempre geradas de novo em cima da `main` antes do PR (§5 de `sessoes-paralelas.md`); arquivos disputados só recebem acréscimos (§6) | Orquestradora |

### 1.3 Dependências (conferidas no código em 16/11/2026, `main` 5482450)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-PA1 | **Plano 04 — alimentos e plano** | `foods`, `food_measures`, `meal_plans`, `meals`, `meal_items`, cálculo, rascunho, publicação, modelos, PDF | ✅ `src/db/schema/alimentos.ts` (CHECK `foods_origem_valida`: `(tenant_id is null) = (taco_id is not null)`; `foods_valores_faixa`: kcal 0–900, demais 0–100; 15 grupos), `src/db/schema/plano-alimentar.ts` (`NutrientesCongelados` só com kcal e 4 macros, `origem` `'TACO' \| 'Meu alimento'`), `src/modules/plano-alimentar/{calculo,rascunho,publicacao,modelos,carregar,constantes}.ts` (`MAX_REFEICOES = 15`, `MAX_ITENS = 200`), `plano-pdf.tsx` (rodapé `Fonte: {FONTE_TACO_TEXTO}`) |
| DEP-PA2 | **Busca** | `buscarAlimentos` (pg_trgm, até 20) e o combobox `BuscaAlimento` | ✅ `src/modules/alimentos/busca.ts`; `src/app/painel/alimentos/busca-alimento.tsx` (`BuscaAlimento`, `Selo` com `'TACO' \| 'Meu alimento'`), usado inline no editor (`editor-plano.tsx:202` e `:305`) e em `/painel/alimentos`. **Não existe** diálogo de adicionar alimento: ele é criado aqui (D13) |
| DEP-PA3 | **Plano 07 — conteúdos e RN-12** | Exceção da RN-12 para receita da refeição | ✅ Política `paciente_conteudo_visivel` (0083, linhas 55–57): só `tipo = 'receita'` e só por `meals.recipe_content_id`, com `app.receitas_do_plano = 'on'` (`liberarReceitasDoPlano`, `src/modules/conteudo/audiencia.ts`). A capa herda por `paciente_arquivos` (0085: `EXISTS` em `contents`, que roda com a RLS de quem lê). O PDF da orientação sai por `caminhoDoPdfDoConteudo` (`src/modules/portal/conteudos.ts:181`, rota `/api/p/conteudos/[id]/pdf`), **sem** a liberação |
| DEP-PA4 | **Plano 16 — app G** | Hoje (mural), refeição aberta, "Comi assim", lista de compras | ✅ `muralDoPaciente` (`src/modules/portal/mural.ts:68` mapeia **todas** as refeições), `planoDoPaciente`/`proximaRefeicao` (`portal/plano.ts`), `refeicaoDoPlanoPublicado` (`portal/diario.ts:69`, aceita qualquer refeição do plano), `listaDeCompras` (`portal/lista-compras.ts`, RN-13: itens principais × dias) |
| DEP-PA5 | **Plano 15 — IA Nutri** | Contexto e releitura de trechos | ✅ `src/modules/ia/nutri-paciente/contexto.ts` (`FonteDoContexto.tipo`: `refeicao`, `item`, `substituicao`, `orientacao_plano`, `orientacao_atendimento`; trecho da refeição montado dos itens, linha 213), `textos.ts:42` (`substituicao: 'No seu plano, as opções de substituição são:'`), `pseudonimizar.ts` (`mascarar`) |
| DEP-PA6 | **Plano 14/14B — IA da nutricionista** | Ferramentas e o que sai | ✅ `ferramentas-alimentos.ts` chama `buscarAlimentos` com papel `worker`: **sem filtro**, a USDA entraria sozinha na IA (D8). `resumo-dados.ts:132` manda nome, horário e itens principais do plano publicado; `rascunho-dados.ts` usa `MAX_REFEICOES` |
| DEP-PA7 | **Plano 17 — lembretes de rotina** (branch `plano-17-lembretes-rotina`, P17-01 com as migrations `0118`/`0119`, **não mesclada**) | Refeições do plano publicado nos lembretes | ⬜ `planoDoDia`/`maiorDiaDaSemana` (`src/modules/lembretes/slots.ts`, plano do 17) recebem `RefeicaoDoPlano = { nome; horario }`, **sem dia**; `DiaDaSemana = 0..6` (0 = domingo) em `lembretes/config.ts` |
| DEP-PA8 | **Sessões paralelas** | Regras de migration e de arquivos disputados | ⬜ `docs/operacao/sessoes-paralelas.md` (branch `docs/sessoes-paralelas`, não mesclada): §2 (no máximo 3 sessões de código), §5 (migration gerada de novo), §6 (só acrescentar) |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo |
|---|---|---|
| PD-21 | **USDA** | Seed offline de Foundation e SR Legacy (sem "Branded Foods" nem itens com marca), nome traduzido + original em inglês, mapa de nutrientes para o catálogo, mapa de grupos para os 15 da TACO, selo "USDA (EUA)", citação (RN-230 a RN-233) |
| PD-20 | **TBCA (modelo)** | Valor `tbca` aceito em `foods.fonte`, citação pronta em `FONTES`, guarda que impede carga sem a autorização (RN-232) |
| PD-22 | **Micronutrientes** | Catálogo de nutrientes, soma dos micros no editor, no PDF e na publicação (congelados), micros no "Meu alimento", perfis de referência do consultório com fonte obrigatória, nutrientes escolhidos por plano, "Ver todos os nutrientes" (RN-235 a RN-240) |
| PD-23 | **Busca** | Diálogo "Buscar alimento" com as abas Lista, Nutrientes e Equivalentes; "Ver nutrientes" do resultado; atalho para cadastrar alimento (RN-241, RN-242) |
| PD-24 | **Texto livre** | Modo do plano "Texto livre": um texto por refeição; VET, macros e fracionamento opcionais, com aviso; PDF, portal, exportação, IA Nutri com máscara (RN-243 a RN-245) |
| PD-25 | **Dias da semana** | Dias por refeição; filtro e legenda no editor; totais por dia; Hoje, Plano, "Comi assim", lista de compras, PDF e lembretes pelo dia (RN-246 a RN-249) |
| PD-26 | **Minhas refeições** | Salvar refeição do editor, carregar no editor, tela de cadastro com tipo e kcal (RN-250) |
| PD-27 | **Ligado ao plano** | Rótulo "Aparece para o paciente no app"; receitas e materiais ligados ao plano (exceção da RN-12 ampliada); lista de substituição ligada como cópia; tudo no portal, no PDF, na exportação e nas cópias do plano (RN-252 a RN-256) |
| PD-28 | **Listas de substituição** | Biblioteca do consultório: grupos e itens com quantidade e medida caseira, com o atalho "Sugerir equivalentes" (RN-251) |
| — | **Fechamento** | Exportação do titular, auditoria, guardas de RLS, `FABRICAS`, RN novas e versão nova das RN-01/02/12/13 e INT-04, manual técnico, manual do usuário, manual guiado e Central de Ajuda |

### 2.2 Fora

- **Carga da TBCA** enquanto não houver autorização por escrito dos coordenadores (vira um plano curto quando chegar).
- **Tabela de DRI/IOM** ou outra referência pré-carregada pela plataforma (aguarda o E-09). O perfil com os VDR da
  ANVISA (IN 75/2020) fica como pendência ★ do dono (P19-★1, §14).
- **"Branded Foods"** da USDA, itens com marca da SR Legacy e consulta em tempo real à API da USDA.
- **Medidas caseiras da USDA** ("1 cup"): ficam a gramagem e as medidas do consultório (D5).
- Tucunduva, tabelas "exclusivas" e suplementos de marca.
- Biblioteca pronta de refeições ou cardápios; listas de substituição tiradas de livros (Lei 9.610, art. 7º, XIII).
- Importar os cardápios, refeições e receitas da Debby que estão no Dietbox (outro projeto).
- **Vários planos publicados ao mesmo tempo** para o mesmo paciente (o dono escolheu "um plano só", D17).
- TBCA e USDA nas ferramentas da IA da nutricionista (RN-116/RN-126 continuam).
- Materiais e receitas do plano no contexto da IA Nutri (D9 = a do Plano 15).
- **Micronutrientes no app do paciente** (D12).
- Busca por nutriente dentro de receitas; micros por porção de receita (RN-11 continua só com macros).
- Mudar o texto do consentimento da IA Nutri ou da autorização de IA (RN-109, RN-171).
- Cadastrar alimento **dentro** do diálogo de busca (há só o atalho, D13).
- Editar item por item a cópia da lista de substituição ligada ao plano (D23: "Atualizar da biblioteca" ou trocar de lista).

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista / equipe** (sessão `nutri`, `withTenant`) | Buscar em todas as fontes; editar micros do "Meu alimento"; cadastrar perfis de referência, minhas refeições e listas de substituição; montar plano calculado ou em texto livre, com dias da semana; ligar listas, receitas e materiais ao plano | Alterar alimento da TACO, USDA ou TBCA (somente leitura, política `taco_leitura`); publicar plano com refeição sem dia ou sem texto (modo livre) |
| **Paciente** (sessão `paciente`) | Ver, do plano **publicado**: as refeições do dia (e dos outros dias, na página Plano), a lista de substituição ligada e as receitas e materiais ligados | Ver micronutrientes, perfil de referência, rascunho, biblioteca do consultório (`staff_only`), lista ou conteúdo ligado a rascunho (`paciente_sem_rascunho`); responder "Comi assim" a refeição de outro dia |
| **Worker** | Gerar o PDF (com dias, texto livre, lista e fontes); montar o contexto da IA Nutri com a lista de substituição; enviar os lembretes do Plano 17 só no dia da refeição | — |
| **Admin** | — (nada novo) | Ver dado de paciente |

---

## 4. Arquitetura

### 4.1 Fontes de alimentos (PD-20, PD-21)

- `foods` ganha **`fonte`** (`taco` | `usda` | `tbca` | `propria`) e **`fonte_ref`** (o código na tabela de origem:
  número da TACO, `fdc_id` da USDA, código da TBCA; nulo no "Meu alimento"), única por fonte. O CHECK
  `foods_origem_valida` passa a ser `(tenant_id is null) = (fonte <> 'propria')`, `(fonte = 'propria') = (fonte_ref is
  null)` e `(taco_id is not null) = (fonte = 'taco')`. `taco_id` fica (o seed da TACO, os ids determinísticos e o
  `taco-fonte.test.ts` não mudam). A migration preenche `fonte` e `fonte_ref` das linhas atuais.
- `foods.nome_original` guarda o nome em inglês da USDA (nulo nas outras fontes). A busca procura nos dois nomes.
- As tabelas públicas continuam com `tenant_id` nulo e **só leitura**: a política `taco_leitura` (`tenant_id IS NULL`,
  0040) já cobre USDA e TBCA, sem mudança (o nome fica; o comentário da migration diz "tabelas públicas").
- `src/modules/alimentos/fontes.ts` (novo) troca o `FONTE_TACO_TEXTO` solto por `FONTES`: selo, sigla e citação de cada
  fonte, com a versão (RN-233). `taco.ts` reexporta `FONTE_TACO_TEXTO` a partir de `FONTES.taco` para não quebrar
  quem importa.
- Seed USDA: script offline (`scripts/usda/preparar-seed.ts`) lê os arquivos baixados do FoodData Central (CSV de
  Foundation e SR Legacy), filtra, converte e grava os CSVs versionados `seeds/usda-*.csv` (alimentos, nomes em
  português, mapa de nutrientes, mapa de grupos, exclusões); um teste confere o sha256 dos arquivos de origem e refaz o
  CSV, como o `taco-fonte.test.ts` (INT-04). A migration de seed (custom) insere as linhas.

### 4.2 Micronutrientes e referências (PD-22)

- **Catálogo único** em `src/modules/alimentos/nutrientes.ts`: chave, nome, unidade, casas na exibição e fontes que
  trazem o valor. As 20 chaves da TACO (`CAMPOS_MICRO`, `taco.ts`) ficam como estão; entram as que a USDA traz e a
  TACO não (RN-235). `foods.micros` só aceita chaves do catálogo (validação no código e teste do seed).
- `calculo.ts` continua **puro** (sem banco nem React, manual §4.4.1) e passa a somar os micros com a mesma regra da
  RN-02 (só itens principais), contando os itens sem valor (RN-236).
- `NutrientesCongelados` ganha `fonte`, `fonteVersao`, `fonteOrigem` e `micros`; `publicarPlano` congela isso no
  mesmo `UPDATE … FROM foods` de hoje. A leitura aceita o formato antigo (RN-237).
- **Perfis de referência** (`referencias_nutrientes`, do consultório, `staff_only`): nome, fonte obrigatória e, por
  nutriente, meta e máximo. O plano aponta para um perfil e escolhe os nutrientes que mostra; a publicação congela o
  perfil (RN-238, RN-239).

### 4.3 Diálogo "Buscar alimento" (PD-23)

O combobox inline `BuscaAlimento` continua no editor e em `/painel/alimentos` (caminho rápido, sem mudança de
comportamento além do selo e da ordem das fontes). Ao lado dele, no editor, o botão **"Mais opções de busca"** abre o
diálogo novo `DialogoBuscaAlimento` (`<dialog>` nativo, como o manual guiado), com três abas:

| Aba | O que faz |
|---|---|
| **Lista** | A mesma busca por nome, com filtro de fonte (Todas · TACO · USDA (EUA) · Meus alimentos) e de grupo |
| **Nutrientes** | Escolhe um nutriente do catálogo e "Rico em" ou "Pobre em"; ordena pelo valor em 100 g; filtros de grupo e fonte (RN-241) |
| **Equivalentes** | Para um item do plano: alimentos do mesmo grupo com a quantidade que dá a mesma energia (ou o mesmo nutriente escolhido), com o critério escrito na tela (RN-242) |

Cada resultado tem **"Ver nutrientes"** (abre os valores em 100 g, todos os do catálogo) e o botão **"Adicionar"**. No
rodapé do diálogo, o link **"Não encontrou? Cadastrar meu alimento"** abre `/painel/alimentos/novo` em outra aba (o
editor salva sozinho, D7 do Plano 04; o alimento novo aparece na busca seguinte). No item do plano, a ação
**"Equivalentes"** abre o diálogo já na aba Equivalentes, com o item como referência; o escolhido entra como
**substituição** daquele item (US-023).

### 4.4 Texto livre e dias da semana (PD-24, PD-25)

- `meal_plans.modo` (`calculado` | `livre`, padrão `calculado`). No modo livre, cada refeição tem nome, horário, dias,
  observação e **`descricao_livre`** no lugar dos alimentos. O Hoje, o PDF, o "Comi assim" e os lembretes do Plano 17
  continuam funcionando **por refeição** (por isso o texto é por refeição, D15).
- `meals.dias_semana` (`smallint[]`, 0 = domingo, mesma convenção do Plano 17; padrão os 7 dias). Fica **um plano
  publicado** por paciente (RN-01 intacta): "Almoço" de segunda a sexta e "Almoço" no sábado e no domingo são duas
  refeições do mesmo plano.
- **Perfis de dia.** Os dias que têm exatamente o mesmo conjunto de refeições formam um perfil ("Segunda a sexta",
  "Sábado e domingo"). O PDF, o resumo do editor e a página Plano do app agrupam por perfil, com o rótulo de
  `rotuloDosDias` (o mesmo formatador do Plano 17). Plano com todas as refeições nos 7 dias = um perfil só, e tudo fica
  como hoje.

### 4.5 Biblioteca e ligações ao plano (PD-26, PD-27, PD-28)

| Coisa | Onde fica | Paciente vê? |
|---|---|---|
| Minha refeição | `refeicoes_modelo` + `refeicoes_modelo_itens` (consultório, `staff_only`) | Não |
| Lista de substituição (biblioteca) | `listas_substituicao` + `_grupos` + `_itens` (consultório, `staff_only`) | Não |
| Lista ligada ao plano | `plano_listas_substituicao` (com `patient_id`, cópia congelada em `jsonb`, auditada, `paciente_sem_rascunho`) | Sim, do plano publicado |
| Receita ou material ligado ao plano | `plano_conteudos` (com `patient_id`, auditada, `paciente_sem_rascunho`) | Sim, pela exceção da RN-12 ampliada |
| Perfil de referência | `referencias_nutrientes` (consultório, `staff_only`); cópia congelada em `meal_plans.referencia_congelada` | Não |

### 4.6 Telas novas e onde ficam

Nenhum item novo no menu do painel (`navegacao.ts` não muda, D27). Três cartões novos em **Configurações**, ao lado de
"Alimentos" e "Modelos de plano":

| Rota | Cartão em Configurações (título · texto) |
|---|---|
| `/painel/planos/refeicoes` e `/painel/planos/refeicoes/[id]` | **Minhas refeições** · "Refeições prontas para carregar nos planos." |
| `/painel/planos/listas` e `/painel/planos/listas/[id]` | **Listas de substituição** · "Grupos de alimentos que se trocam entre si." |
| `/painel/planos/referencias` e `/painel/planos/referencias/[id]` | **Perfis de referência** · "Metas de nutrientes, com a fonte, para comparar nos planos." |

O cartão "Alimentos" muda o texto para **"TACO, USDA e os seus alimentos."**

No editor do plano, entram: o seletor de modo, o filtro de dias, o diálogo de busca, "Salvar como minha refeição",
"Carregar minha refeição", a seção **"Nutrientes do paciente"** e a seção **"Ligado ao plano"** (listas, receitas e
materiais). No portal, a página Plano ganha os dias e a seção "Ligado ao seu plano".

---

## 5. Histórias de usuário

### E19 — Plano alimentar 2

#### US-230 — Buscar alimentos da USDA · **M** (PD-21, PD-20)

**Como** nutricionista, **quero** encontrar alimentos que a TACO não tem, **para** montar o plano sem cadastrar tudo à mão.

```gherkin
Cenário: Alimento da USDA na busca
  Dado que digito "quinoa" na busca do editor
  Então vejo "Quinoa, cozida" com o selo "USDA (EUA)" e, abaixo, em texto menor, "Quinoa, cooked"
  E o aviso "Nome traduzido automaticamente do inglês." no título do selo e em "Ver nutrientes"
  E os alimentos da TACO e os meus que começam com o termo aparecem antes dos da USDA

Cenário: Busca pelo nome em inglês
  Quando digito "cooked quinoa"
  Então "Quinoa, cozida" aparece

Cenário: Filtro de fonte
  Dado o diálogo "Buscar alimento", aba "Lista"
  Quando escolho a fonte "USDA (EUA)"
  Então só aparecem alimentos com o selo "USDA (EUA)"

Cenário: Alimento da USDA é só leitura
  Quando abro um alimento da USDA em /painel/alimentos/<id>
  Então não vejo "Editar" nem "Excluir"
  E vejo "Duplicar como meu alimento" e "Fonte: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, {ano}. fdc.nal.usda.gov"

Cenário: Duplicar alimento da USDA
  Quando toco em "Duplicar como meu alimento"
  Então o alimento novo tem o selo "Meu alimento", o nome em português e os micros da USDA
  E num plano publicado com ele o rodapé do PDF cita a USDA (RN-233)

Cenário: Sem valor
  Dado um alimento da USDA sem fibra
  Então a fibra aparece como "Sem valor na USDA" e conta 0 nos totais (RN-02)

Cenário: TBCA desligada
  Então nenhum alimento tem o selo "TBCA" e o filtro de fonte não mostra "TBCA"
```

#### US-231 — Micronutrientes do alimento · **S** (PD-22)

**Como** nutricionista, **quero** ver e cadastrar os micronutrientes dos alimentos, **para** que o plano some os micros.

```gherkin
Cenário: Ver os micros
  Quando abro "Ver nutrientes" de um alimento da TACO
  Então vejo os valores em 100 g de todos os nutrientes do catálogo, com a unidade
  E "Sem valor na TACO" nos que a TACO não traz (ex.: vitamina D)

Cenário: Meu alimento com micros
  Dado o formulário "Cadastrar meu alimento"
  Então há a seção recolhida "Micronutrientes (opcional)" com todos os nutrientes do catálogo
  Quando preencho "Cálcio (mg)" com "120" e deixo o resto vazio
  Então o alimento salva com cálcio 120 e os outros sem valor

Cenário: Valor inválido
  Quando preencho "Sódio (mg)" com "-3"
  Então vejo "Use um número de 0 a 100000." no campo
```

#### US-232 — Perfis de referência · **S** (PD-22)

**Como** nutricionista, **quero** cadastrar metas de nutrientes com a fonte, **para** comparar o plano com a referência que eu escolhi.

```gherkin
Cenário: Cadastrar perfil
  Dado a tela "Perfis de referência"
  Quando crio "Mulher 19 a 50 anos" com a fonte "DRI/IOM 2006 — conferida pela nutricionista"
  E informo a meta de ferro "18" mg e o máximo "45" mg
  Então o perfil aparece na lista com "1 nutriente" e a fonte

Cenário: Fonte obrigatória
  Quando salvo sem fonte
  Então vejo "Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA)."

Cenário: Pelo menos um nutriente
  Quando salvo sem nenhum valor
  Então vejo "Informe a meta ou o máximo de pelo menos um nutriente."

Cenário: Lista vazia
  Dado que o consultório não tem perfis
  Então vejo "Nenhum perfil cadastrado. A plataforma não traz valores de referência prontos: cadastre os que você usa, com a fonte."

Cenário: Excluir perfil em uso
  Dado um perfil escolhido num rascunho
  Quando excluo o perfil
  Então o rascunho fica sem perfil e o editor mostra "O perfil de referência foi excluído. Escolha outro."
  E o plano publicado com ele continua mostrando a cópia congelada
```

#### US-233 — Nutrientes do paciente no plano · **M** (PD-22)

**Como** nutricionista, **quero** ver no editor os micronutrientes mais importantes para o paciente contra a referência, **para** registrar a prescrição completa.

```gherkin
Cenário: Escolher perfil e nutrientes
  Dado o editor de um plano calculado
  Quando abro "Nutrientes do paciente", escolho o perfil "Mulher 19 a 50 anos" e marco ferro, cálcio e sódio
  Então o resumo mostra "Ferro: 12,4 mg · meta 18 mg (69%)", "Cálcio: …" e "Sódio: …"
  E cada linha diz quantos itens não têm o valor ("2 itens sem valor de ferro")

Cenário: Acima do máximo
  Dado sódio total 2600 mg e máximo 2300 mg no perfil
  Então a linha mostra "Acima do máximo (2300 mg)" em texto, não só em cor

Cenário: Ver todos os nutrientes
  Quando toco em "Ver todos os nutrientes"
  Então abre a lista com todos os nutrientes do catálogo, o total do dia e, quando o perfil tem, a meta e o máximo

Cenário: Por dia
  Dado um plano com perfis de dia diferentes
  Então o resumo vale para o dia escolhido no filtro de dias (RN-247)

Cenário: Publicação congela
  Quando publico
  Então os micros de cada item e o perfil (nome, fonte e valores) ficam congelados
  E editar o perfil depois não muda o plano publicado

Cenário: No PDF, só se eu marcar
  Dado "Mostrar calorias ao paciente" desligado
  Então a caixa "Mostrar no PDF os nutrientes escolhidos" fica desabilitada, com "Ligue antes "Mostrar calorias ao paciente"."
  Dado as duas ligadas
  Então o PDF traz, no topo, "Nutrientes: Ferro 12,4 mg (meta 18 mg) · …" e "Referência: Mulher 19 a 50 anos — DRI/IOM 2006 — conferida pela nutricionista"

Cenário: Nunca no app
  Então nenhuma tela do app do paciente mostra micronutrientes nem o perfil (RN-240)
```

#### US-234 — Buscar por nutriente e por equivalentes · **M** (PD-23)

**Como** nutricionista, **quero** achar alimentos ricos ou pobres num nutriente e equivalentes de um item, **para** ajustar o plano mais rápido.

```gherkin
Cenário: Rico em ferro
  Dado o diálogo "Buscar alimento", aba "Nutrientes"
  Quando escolho "Ferro" e "Rico em"
  Então vejo até 20 alimentos ordenados pelo ferro em 100 g, do maior para o menor, com o valor
  E o critério "Ordenado por ferro em 100 g (maior primeiro)."
  E o aviso "Sugestão: confira antes de usar."

Cenário: Pobre em sódio, só verduras
  Quando escolho "Sódio", "Pobre em" e o grupo "Verduras, hortaliças e derivados"
  Então a lista vem do menor para o maior e deixa de fora quem não tem o valor

Cenário: Equivalentes por energia
  Dado o item "Arroz branco, cozido — 120 g" no almoço
  Quando toco em "Equivalentes" no item
  Então o diálogo abre na aba "Equivalentes" com a referência "Arroz branco, cozido — 120 g (154 kcal)"
  E o critério "Mesmo grupo (Cereais e derivados) · mesma energia · ordenados pela proximidade de proteína, carboidrato e lipídio."
  E cada sugestão traz a quantidade calculada (exemplo: "Macarrão, cozido — 104 g")
  Quando toco em "Adicionar como substituição"
  Então o item entra como substituição do arroz, com 104 g

Cenário: Equivalentes por um nutriente
  Quando troco "Igualar por" para "Carboidrato"
  Então a quantidade dá o mesmo carboidrato
  E só aparecem os que ficam com energia até 10% acima ou abaixo da referência
  E o critério diz "Mesmo grupo (Cereais e derivados) · mesmo carboidrato · energia até ±10%."

Cenário: Nada encontrado
  Então vejo "Nenhum alimento atende a este critério."

Cenário: Ver nutrientes e cadastrar
  Quando toco em "Ver nutrientes" num resultado
  Então vejo os valores em 100 g sem sair do diálogo
  E no rodapé há "Não encontrou? Cadastrar meu alimento", que abre em outra aba
```

#### US-235 — Plano em texto livre · **M** (PD-24)

**Como** nutricionista, **quero** escrever o plano em texto, refeição por refeição, **para** atender quem não precisa de gramas e alimentos.

```gherkin
Cenário: Escolher o modo
  Dado um rascunho vazio
  Quando escolho "Texto livre por refeição" em "Como montar o plano"
  Então cada refeição mostra a caixa "O que comer" no lugar da busca de alimentos
  E o painel de totais some, ficando os campos opcionais "Meta (kcal)" e "Distribuição prescrita (opcional)": proteína, carboidrato e lipídio em %

Cenário: Trocar de calculado para livre
  Dado um rascunho com alimentos
  Quando troco para "Texto livre por refeição"
  Então vejo "Os alimentos de cada refeição viram texto e saem do plano. Continuar?"
  E, se confirmo, cada refeição ganha o texto "Arroz branco, cozido — 4 colheres de sopa; Feijão…"

Cenário: Trocar de livre para calculado
  Quando troco para "Com alimentos e quantidades"
  Então vejo "O texto das refeições será apagado. Continuar?"

Cenário: Publicar sem VET
  Dado o modo livre sem "Meta (kcal)"
  Quando toco em "Publicar"
  Então a confirmação traz o aviso "Registre o VET e os nutrientes da prescrição no plano ou no atendimento."
  E posso publicar mesmo assim

Cenário: Refeição sem texto
  Quando publico com o almoço sem texto
  Então vejo "A refeição "Almoço" está sem texto."

Cenário: No app e no PDF
  Então a refeição aberta no app mostra o texto como "Sua nutricionista:" (voz dela, RN-194), sem kcal
  E o PDF traz o texto de cada refeição, a meta e a distribuição quando preenchidas
  E a lista de compras diz "Este plano não tem alimentos com quantidade, então não há lista de compras."
```

#### US-236 — Refeições por dia da semana · **M** (PD-25)

**Como** nutricionista, **quero** marcar em que dias cada refeição vale, **para** ter um plano de semana e outro de fim de semana sem publicar dois planos.

```gherkin
Cenário: Marcar dias
  Dado a refeição "Almoço" no editor
  Quando desmarco sábado e domingo em "Dias"
  Então o cartão mostra "seg a sex"
  E eu crio outro "Almoço" só com "sáb e dom"

Cenário: Filtro e legenda
  Então o editor mostra "Dias: Todos · seg · ter · qua · qui · sex · sáb · dom"
  E a legenda "seg a sex: 1.820 kcal · sáb e dom: 2.050 kcal"
  Quando escolho "sáb"
  Então só vejo as refeições de sábado e os totais e nutrientes de sábado

Cenário: Dia sem refeição
  Dado que domingo não tem nenhuma refeição
  Então a legenda mostra "dom: sem refeições"
  E a confirmação de publicar avisa "Domingo não tem refeições. Publicar mesmo assim?"

Cenário: Hoje no app
  Dado hoje é sábado no fuso do consultório
  Então o Hoje mostra só as refeições de sábado
  E a página Plano abre em "Hoje (sáb)", com os outros dias em "Ver outros dias"

Cenário: "Comi assim" de outro dia
  Quando uma requisição responde a uma refeição que não vale hoje
  Então nada é gravado e vejo a mensagem de refeição não encontrada do diário (`MSG_DIARIO.refeicaoNaoEncontrada`)

Cenário: Lembretes (depois do merge do Plano 17)
  Dado o lembrete de refeições ligado
  Então o almoço de segunda a sexta não gera aviso no sábado

Cenário: PDF por dia
  Então o PDF traz "Segunda a sexta" e "Sábado e domingo", cada um com as suas refeições e o total do dia
```

#### US-237 — Minhas refeições · **S** (PD-26)

**Como** nutricionista, **quero** salvar uma refeição e carregá-la em outros planos, **para** não montar de novo o que repito.

```gherkin
Cenário: Salvar do editor
  Quando toco em "Salvar como minha refeição" no almoço
  Então abre "Salvar refeição" com o nome "Almoço", o tipo "Almoço" e a caixa "Incluir a observação" desmarcada
  E o aviso "Confira o nome e os itens: retire dados do paciente antes de salvar."
  Quando salvo
  Então vejo "Refeição salva em Minhas refeições."

Cenário: Incluir a observação
  Quando marco "Incluir a observação"
  Então vejo "A observação pode ter dados do paciente. Revise antes de salvar."

Cenário: Carregar
  Quando toco em "Carregar minha refeição" e escolho "Almoço leve"
  Então o plano ganha a refeição com os itens (ids novos), os 7 dias e o horário salvo
  E os valores são os de hoje dos alimentos

Cenário: Tela de cadastro
  Dado "Minhas refeições"
  Então vejo a lista com nome, tipo e "Cerca de {kcal} kcal", filtrável pelo tipo
  E posso criar, editar e excluir

Cenário: Modo do plano
  Dado um plano em texto livre
  Quando carrego uma refeição com alimentos
  Então ela entra como texto ("Arroz…; Feijão…")
```

#### US-238 — Listas de substituição do consultório · **S** (PD-28)

**Como** nutricionista, **quero** montar listas de alimentos que se trocam entre si, **para** entregar ao paciente junto do plano.

```gherkin
Cenário: Criar lista
  Dado "Listas de substituição"
  Quando crio "Trocas do dia a dia" com o grupo "Carboidratos — 1 porção"
  E adiciono "Arroz branco, cozido — 4 colheres de sopa" e "Batata-doce, cozida — 1 unidade média"
  Então a lista mostra o grupo com os itens e a energia de cada um

Cenário: Sugerir equivalentes
  Dado o grupo com o primeiro item "Arroz branco, cozido — 120 g"
  Quando toco em "Sugerir equivalentes"
  Então abre o diálogo na aba "Equivalentes" com o arroz como referência, e o escolhido entra no grupo

Cenário: Limites
  Quando tento o 21º grupo
  Então vejo "A lista pode ter até 20 grupos e 30 itens por grupo."

Cenário: Paciente não vê a biblioteca
  Então nenhuma lista da biblioteca aparece no app enquanto não for ligada a um plano publicado
```

#### US-239 — Ligar lista, receitas e materiais ao plano · **M** (PD-27)

**Como** nutricionista, **quero** ligar ao plano a lista de substituição, receitas e materiais, **para** o paciente achar tudo junto do plano.

```gherkin
Cenário: Ligar lista
  Dado o editor, seção "Ligado ao plano"
  Quando toco em "Ligar lista de substituição" e escolho "Trocas do dia a dia"
  Então a lista entra como cópia, com "Cópia de 16/11/2026. Mudanças na biblioteca não alteram este plano."
  E aparece "Atualizar da biblioteca" e "Remover"

Cenário: Biblioteca muda depois
  Dado o plano publicado com a lista
  Quando edito a lista na biblioteca
  Então o paciente continua vendo a cópia que recebeu

Cenário: Ligar receita ou material
  Quando toco em "Ligar receita ou material" e escolho a orientação "Como montar o prato"
  Então ela aparece na seção, com o tipo e a situação ("Publicado" ou "Não publicado — o paciente não vê")

Cenário: O paciente vê pelo plano
  Dado a orientação fora da audiência do paciente e ligada ao plano publicado
  Então ele a vê em "Ligado ao seu plano", abre o texto e baixa o PDF dela
  Mas ela não aparece em Conteúdos, na busca, nos favoritos nem no item "Novo conteúdo" do Hoje
  E abrir pelo plano não conta em "Quem viu"

Cenário: Rascunho não vaza
  Dado a lista e o material ligados só ao rascunho
  Então o paciente não vê nenhum dos dois

Cenário: Observação
  Então o campo "Observação" da refeição diz, abaixo do rótulo, "Aparece para o paciente no app."

Cenário: IA Nutri e a lista
  Dado a IA Nutri liberada e a lista ligada ao plano publicado
  Quando o paciente pergunta "posso trocar o arroz por quê?"
  Então a resposta cita primeiro as substituições do item no almoço e depois a lista, com a fonte "Lista de substituição — Carboidratos — 1 porção"
```

---

## 6. Regras de negócio

| ID | Regra |
|---|---|
| RN-230 | **Fonte do alimento (D1).** `foods.fonte` ∈ {`taco`, `usda`, `tbca`, `propria`}; `fonte_ref` único por fonte (nulo só em `propria`); `tenant_id` nulo ⇔ fonte pública. Selos: "TACO", "USDA (EUA)", "TBCA", "Meu alimento". Alimento de fonte pública é só leitura (política `taco_leitura` + escrita só em `tenant_id` não nulo, `exigirProprio`). **Ordem da busca por nome:** começa com a 1ª palavra → fonte brasileira ou própria antes da USDA → semelhança → nome mais curto (a ordem de hoje com um critério a mais). A busca acha pelo `nome` e pelo `nome_original` (sem acento, sem caixa, índice de trigramas nos dois). "Sem valor na TACO" (RN-02) vira "Sem valor na {sigla da fonte}" ("Sem valor na USDA"); no "Meu alimento" continua 0 obrigatório nos 5 valores (CHECK `foods_proprio_completo`) |
| RN-231 | **Seed da USDA (D2–D6).** Só **Foundation** e **SR Legacy** de uma versão fixa do FoodData Central (ano e data no `FONTES.usda`); arquivos de origem com sha256 fixo e teste que refaz os CSVs. **Fora:** "Branded Foods"; as categorias da SR Legacy que são de marca ou de restaurante ("Baby Foods", "Fast Foods", "Restaurant Foods", "Breakfast Cereals", "Meals, Entrees, and Side Dishes"); todo nome com palavra de 3 letras ou mais em caixa alta (a convenção da SR Legacy para marca, ex.: "KELLOGG'S"); valores fora das faixas do CHECK. Cada exclusão vai para `seeds/usda-exclusoes.csv` com o motivo. **Energia:** nutriente "Energy (kcal)"; sem ele, a energia de Atwater específica, depois a geral; sem nenhuma, nulo. **Unidades** convertidas para as do catálogo pelo mapa `seeds/usda-nutrientes.csv` (teste: toda chave do mapa existe no catálogo e toda unidade casa). **Grupos:** mapa revisável `seeds/usda-grupos.csv` (categoria USDA → um dos 15 grupos da TACO; sem equivalente → o mais próximo, com a justificativa na linha). **Nome:** `nome` = tradução para o português feita uma vez, na preparação do seed (D3), gravada em `seeds/usda-nomes-pt.csv` (`fdc_id`, original, tradução), 2 a 120 caracteres; `nome_original` = descrição em inglês. **Sem medidas caseiras** (D5). Foundation e SR Legacy do mesmo alimento entram as duas, cada uma com o seu `fdc_id` |
| RN-232 | **TBCA (D7).** O valor `tbca` existe no CHECK e em `FONTES` ("Tabela Brasileira de Composição de Alimentos (TBCA). Universidade de São Paulo (USP). Centro de Pesquisa em Alimentos (FoRC). Versão 7.3. São Paulo, 2025."), mas **nenhuma linha** com `fonte = 'tbca'` entra enquanto `TBCA_AUTORIZADA` (constante em `fontes.ts`) for `false`. Guarda de teste: falha se alguma migration ou seed inserir `tbca` com a constante desligada; o filtro de fonte e o selo não mostram TBCA sem linhas. A autorização tem de cobrir carga, conversão (faixas, grupos), "Duplicar como meu alimento", PDF ao paciente, exportação e, se um dia houver, envio à IA (pergunta ao E-09). A carga vira plano próprio |
| RN-233 | **Citação (D1, Res. CFN 599, art. 82; Res. 856, art. 94).** Cada fonte tem a citação em `FONTES`: TACO "TACO 4ª ed. — NEPA/UNICAMP"; USDA "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, {ano}. fdc.nal.usda.gov"; TBCA (RN-232). A tela de alimentos lista as fontes carregadas; a página do alimento, a dele. O **rodapé do PDF** lista só as fontes usadas no plano (itens congelados e itens das listas ligadas), uma por linha, depois de "Fontes:". O "Meu alimento" duplicado de uma fonte pública (`origem_food_id`) leva no congelamento `fonteOrigem`, e o rodapé cita também a fonte de origem |
| RN-234 | **IA da nutricionista (D8; RN-116, RN-126 continuam).** `ferramentas-alimentos.ts` passa a chamar a busca com `fontes: ['taco', 'propria']`; a USDA (e a TBCA, quando houver) nunca chega à IA. O "Meu alimento" duplicado da USDA é próprio e pode chegar (é da nutricionista, que conferiu). O "Usar como rascunho" grava `modo = 'calculado'` e os 7 dias em todas as refeições; o resumo do histórico não muda o que manda (RN-109, D26) |
| RN-235 | **Catálogo de nutrientes (D9).** `NUTRIENTES` em `src/modules/alimentos/nutrientes.ts`: `{ chave, nome, unidade ('g' \| 'mg' \| 'mcg' \| '%'), casas, fontes }`. As 20 chaves da TACO continuam (`umidade_pct`, `colesterol_mg`, `cinzas_g`, `calcio_mg`, `magnesio_mg`, `manganes_mg`, `fosforo_mg`, `ferro_mg`, `sodio_mg`, `potassio_mg`, `cobre_mg`, `zinco_mg`, `retinol_mcg`, `re_mcg`, `rae_mcg`, `tiamina_mg`, `riboflavina_mg`, `piridoxina_mg`, `niacina_mg`, `vitamina_c_mg`); entram `vitamina_d_mcg`, `vitamina_b12_mcg`, `folato_dfe_mcg`, `vitamina_e_mg`, `vitamina_k_mcg`, `selenio_mcg`, `acucares_g`, `gordura_saturada_g`, `gordura_mono_g`, `gordura_poli_g`, `gordura_trans_g`. Exibição: g e mg com 1 casa, mcg sem casa (símbolo "µg" na tela), % com 1 casa, vírgula decimal (RNF-12). Uma chave nova no catálogo é mudança de código com teste; `foods.micros` com chave fora do catálogo é recusado no "Meu alimento" e quebra o teste do seed |
| RN-236 | **Cálculo dos micros (RN-02 estendida).** Micro do item = `valor_por_100g × quantidade_g / 100`; totais por refeição e do dia só com itens principais (`substitui_item_id IS NULL`); item sem o valor conta 0 e o total diz quantos itens ficaram sem ele ("{n} itens sem valor de {nutriente}"; 1 item: "1 item sem valor de {nutriente}"). Puro em `calculo.ts` (`microsDoItem`, `totalMicros`), usado pelo editor, pelo servidor e pelo PDF. Os totais são **por dia** (RN-247) |
| RN-237 | **Congelação na publicação (D10; RN-01).** Cada `meal_items.nutrientes` passa a ter `{ nome, origem, fonte, fonteVersao, fonteOrigem, kcal, proteinaG, carboidratoG, lipidioG, fibraG, micros }` (`origem` fica para os leitores antigos). O `UPDATE … FROM foods` de `publicarPlano` grava tudo, e a conferência de linhas continua. `meal_plans.referencia_congelada` recebe `{ nome, fonte, valores }` do perfil escolhido. **Formato antigo** (planos publicados antes do deploy): sem `fonte`, a fonte sai de `origem` (`'TACO'` → `taco`, `'Meu alimento'` → `propria`); sem `micros`, o resumo mostra "Micronutrientes não registrados nesta versão do plano." e o PDF não mostra micros. Nenhum plano publicado é alterado pela migration |
| RN-238 | **Perfis de referência (D11).** Do consultório (`referencias_nutrientes`, `staff_only`): nome (1 a 80, único no consultório), fonte (2 a 300, **obrigatória**) e valores por chave do catálogo, cada um com `meta` e/ou `maximo` (≥ 0, ao menos um dos dois; se os dois, `meta ≤ maximo`); ao menos um nutriente. A plataforma **não** traz perfil pronto. Excluir um perfil anula `referencia_id` dos rascunhos e modelos (FK `ON DELETE SET NULL (referencia_id)`); os publicados têm a cópia |
| RN-239 | **Nutrientes do paciente no plano (Res. CFN 594, art. 4º, § 1º, VIII).** O plano guarda `referencia_id` (opcional) e `nutrientes_exibidos` (até 12 chaves do catálogo). O resumo mostra, para cada um, o total do dia, e com perfil: "meta {x} ({%})" e "Acima do máximo ({y})" quando passa. "Ver todos os nutrientes" mostra o catálogo inteiro. Sem perfil, só os totais. O PDF mostra os escolhidos e a referência (nome e fonte) só com `mostrar_micros_pdf` **e** `mostrar_calorias` ligados (D12) |
| RN-240 | **Micros fora do app (D12).** A projeção de `planoDoPaciente` (e de toda leitura do portal: mural, lista de compras, IA Nutri) é **fechada**: devolve só as chaves de hoje mais as novas desta spec (dias, texto livre, lista, conteúdos ligados). Teste das chaves (molde de `documentos.test.ts`) e procura dos valores de micros na resposta (CS-232). O contexto da IA Nutri não leva micros nem perfil |
| RN-241 | **Busca por nutriente.** Entrada: chave do catálogo ou macro (`kcal`, `proteinaG`, `carboidratoG`, `lipidioG`, `fibraG`), direção (`rico` = maior primeiro; `pobre` = menor primeiro), grupo e fonte opcionais. Só alimentos com o valor (nulo fica fora). Até 20 resultados, desempate por nome. Mostra o valor em 100 g. Critério na tela: "Ordenado por {nutriente} em 100 g (maior primeiro)." / "(menor primeiro)."; aviso fixo "Sugestão: confira antes de usar." A IA não usa esta busca |
| RN-242 | **Equivalentes (D14; Res. CFN 599, arts. 37 e 38; Res. 856, arts. 35 e 53).** Referência = um item (alimento e quantidade). Candidatos: **mesmo grupo**, outro alimento, com o valor do critério > 0, filtro de fonte opcional. "Igualar por" = energia (padrão) ou um nutriente. Quantidade sugerida = `quantidade_ref × valor_ref_100g ÷ valor_cand_100g`, arredondada a 1 g, só se ficar entre 0,1 e 5000 g. **Por energia:** ordenados pela soma das diferenças absolutas de proteína, carboidrato e lipídio (g) na quantidade sugerida. **Por nutriente:** só os candidatos cuja energia na quantidade sugerida fica a ±10% da energia da referência, ordenados pela menor diferença de energia. Até 20. Critério escrito na tela (US-234) e "Sugestão: confira antes de usar." A escolha entra como substituição do item (no plano) ou no grupo (na lista) |
| RN-243 | **Modo do plano (D15).** `meal_plans.modo` ∈ {`calculado`, `livre`}. No `livre`: nenhum `meal_items` nas refeições, `meals.descricao_livre` com 1 a 2000 caracteres para publicar (rascunho aceita vazio), `recipe_content_id` permitido (receita sugerida continua), `mostrar_calorias` sem efeito (não há cálculo), `nutrientes_exibidos` e `referencia_id` ignorados. No `calculado`: `descricao_livre` nulo. As regras ficam em `validar` (rascunho) e `exigirPublicavel`; teste de banco confere que o salvamento nunca grava as duas coisas |
| RN-244 | **Publicar em texto livre (D16, decisão do dono).** Exige ao menos uma refeição, horário em todas (`publicarHorario`), ao menos um dia por refeição (CHECK) e texto em todas ("A refeição "{nome}" está sem texto."). `meta_kcal` (VET) e `macros_prescritos` (proteína, carboidrato e lipídio em % do VET, inteiros de 0 a 100 que somam 100) são opcionais; sem `meta_kcal`, a confirmação mostra "Registre o VET e os nutrientes da prescrição no plano ou no atendimento." e **não** barra. Revisto quando o CRN-3 responder (pergunta 1 ao CRN-3). O fracionamento é o número de refeições por dia, que o PDF mostra ("5 refeições por dia"; por perfil de dia quando variam) |
| RN-245 | **Troca de modo.** Só no rascunho, com confirmação. Calculado → livre: cada refeição ganha o texto `"{nome} — {quantidade}"` dos itens principais, unidos por "; ", e as substituições como `" (ou {nome} — {quantidade})"` depois do principal, cortado em 2000 caracteres; os itens saem. Livre → calculado: o texto e os `macros_prescritos` saem. A troca grava pelo salvamento de sempre (trava de revisão, D7 do Plano 04) |
| RN-246 | **Dias da semana (D17, decisão do dono).** `meals.dias_semana smallint[]`, valores de 0 (domingo) a 6 (sábado), sem repetição, em ordem, de 1 a 7 dias; padrão `{0,1,2,3,4,5,6}` (as refeições que já existem ficam com os 7 dias). O rótulo é `rotuloDosDias` (Plano 17): "todos os dias", "seg a sex", "sáb e dom" ou a lista ("seg, qua e sex"). O dia é o do **fuso do consultório** (`tenants.fuso`). **Perfil de dia:** dias com o mesmo conjunto de refeições, rotulados juntos ("Segunda a sexta"). Dia sem refeição é aviso na publicação ("{Dia} não tem refeições. Publicar mesmo assim?"; vários: "Domingo e sábado não têm refeições. Publicar mesmo assim?"), não erro |
| RN-247 | **Onde o dia vale.** (a) **Editor:** filtro "Todos" + os 7 dias; legenda com o total de energia de cada perfil; totais, indicador da meta (RN-02) e nutrientes do paciente calculados **por dia** (em "Todos", com perfis diferentes, o painel mostra a tabela dos perfis e pede "Escolha um dia para ver os detalhes."). (b) **Hoje (mural, RN-196):** só as refeições cujo `dias_semana` tem o dia de hoje. (c) **Página Plano:** abre no dia de hoje ("Hoje ({dia abreviado})"); os outros dias ficam na mesma página, em "Ver outros dias" (a cópia offline tem a semana toda, RN-208). Com um perfil só, nada muda na tela. (d) **Próxima refeição:** a primeira de hoje a partir de agora; depois da última, a primeira do próximo dia que tenha refeição. (e) **"Comi assim" (RN-197):** `refeicaoDoPlanoPublicado` só aceita refeição que vale hoje; outra = `MSG_DIARIO.refeicaoNaoEncontrada`. (f) **Lembretes do Plano 17:** `RefeicaoDoPlano` ganha `dias` e `planoDoDia` pula a refeição que não vale no dia (D28). (g) **PDF:** um bloco por perfil de dia, com o título do perfil, as refeições e o total do dia (com `mostrar_calorias`). (h) **IA Nutri:** cada refeição vai com os dias, e o contexto diz o dia de hoje (RN-255) |
| RN-248 | **Lista de compras (RN-13, versão nova; D19).** Para N dias a partir de **hoje** (1 a 14, padrão 7), soma cada item principal **uma vez por dia** em que a refeição vale (`quantidade × número de dias da janela que estão em dias_semana`). Refeição em texto livre não entra; se nenhuma refeição tem alimento, "Este plano não tem alimentos com quantidade, então não há lista de compras."; se só algumas, abaixo da lista: "As refeições em texto livre não entram na lista." A marcação no aparelho continua por plano (`nd-compras:<id do plano>`) |
| RN-249 | **Limites (D18).** `MAX_REFEICOES` sobe de 15 para **50** e `MAX_ITENS` de 200 para **400** por plano (mensagem `MSG_PLANO.limite`: "O plano pode ter até 50 refeições e 400 itens."). O formulário do rascunho da IA (`rascunho-dados.ts`) passa a usar a constante própria `MAX_REFEICOES_RASCUNHO_IA = 15`. A pilha de carga (P08-03) e o tamanho do contexto da IA Nutri são medidos com um plano de 50 refeições antes de fechar a tarefa (PM-PA9) |
| RN-250 | **Minhas refeições (D21).** Do consultório, `staff_only`, sem paciente: nome (1 a 60), tipo (lista `TIPOS_DE_REFEICAO`: "Café da manhã", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar", "Ceia", "Outra"), horário opcional, modo (`calculado` com itens, até 40, mesmas regras de quantidade e substituição de `meal_items`; ou `livre` com texto), observação opcional. "Salvar como minha refeição" **não** leva a observação, a não ser que a nutricionista marque "Incluir a observação" (LGPD, art. 6º, III). Carregar copia para o rascunho com ids novos, os 7 dias e o horário salvo; no plano em texto livre, os itens viram texto (regra da RN-245). A kcal da lista é calculada na hora com os valores atuais (como a RN-11), sem cópia congelada. Até 200 refeições salvas por consultório |
| RN-251 | **Listas de substituição (biblioteca, D22).** Do consultório, `staff_only`: nome (1 a 80, único), orientação opcional (até 1000), grupos (nome 1 a 60, até 20) e itens por grupo (alimento da tabela, quantidade 0,1 a 5000 g, medida caseira opcional como em `meal_items.medida`, até 30). Energia por item calculada na hora. "Sugerir equivalentes" usa o primeiro item do grupo como referência (RN-242). Até 100 listas por consultório. A plataforma não traz listas prontas |
| RN-252 | **Lista ligada ao plano (D23).** "Ligar lista de substituição" grava em `plano_listas_substituicao` uma **cópia** da lista: nome, orientação e `conteudo` = grupos e itens com nome do alimento, gramas, texto da medida caseira, fonte e valores por 100 g (kcal e macros) congelados na hora da ligação. Até 5 listas por plano. "Atualizar da biblioteca" troca a cópia pela lista atual (só no rascunho; some se a lista de origem foi excluída: "A lista de origem foi excluída."). Editar ou excluir a lista da biblioteca não muda as cópias. O paciente vê a cópia do plano **publicado** (política `paciente_sem_rascunho`); a energia de cada item só com `mostrar_calorias` |
| RN-253 | **Receitas e materiais ligados ao plano (D24; RN-12, exceção ampliada).** `plano_conteudos` liga ao plano receitas, orientações e vídeos (até 10, sem repetir). A política `paciente_conteudo_visivel` de `contents` passa a liberar, **com `app.receitas_do_plano = 'on'`**, também o conteúdo `publicado` ligado por `plano_conteudos` a um plano `publicado` do próprio paciente (qualquer tipo), além da receita da refeição (US-054). O marcador e a função `liberarReceitasDoPlano` **mantêm o nome** (só o comentário muda para "conteúdos do plano"). Ligam a liberação só: `planoDoPaciente`, `conteudoDoPaciente(…, { doPlano: true })` e, novo, `caminhoDoPdfDoConteudo(…, { doPlano: true })` (rota `/api/p/conteudos/[id]/pdf?de=plano`). A capa herda pela política `paciente_arquivos` (0085, `EXISTS` em `contents`), sem mudança. O feed, a busca, o filtro, o selo "Novo", os favoritos e "Quem viu" continuam sem a liberação: abrir pelo plano **não conta** visualização (D14 do Plano 07, `paciente_conteudo_visto`). Conteúdo despublicado some do app e fica na lista do editor com "Não publicado — o paciente não vê"; conteúdo excluído deixa a ligação com `content_id` nulo e o título copiado, que o editor mostra como "{título} (excluído)" e o app não mostra |
| RN-254 | **Texto da nutricionista no app (RN-194).** A observação da refeição, o texto livre e a orientação da lista ligada são da nutricionista e aparecem no app com a voz dela ("Observação da sua nutricionista", "Sua nutricionista:"). No editor, os três campos levam abaixo do rótulo "Aparece para o paciente no app." (`aria-describedby`) |
| RN-255 | **IA Nutri (D25, decisão do dono).** O contexto do plano publicado ganha: (a) os dias de cada refeição e o dia de hoje no fuso do consultório; (b) no modo livre, `descricao_livre` mascarada (`mascarar`, `pseudonimizar.ts`) como trecho da refeição, fonte "{refeição} — texto do plano"; (c) a lista de substituição ligada, mascarada, com o índice próprio `#L{lista}-{grupo}` e a fonte "Lista de substituição — {grupo}" (tipo novo `lista_substituicao` em `FonteDoContexto`, relido em `relerTrechos` pela cópia do plano publicado). **Prioridade** numa pergunta de troca: primeiro as substituições do item na refeição (`substitui_item_id`, mais específicas), depois a lista do plano; o texto fixo continua "No seu plano, as opções de substituição são:". Receitas e materiais ligados **não** entram (D9 = a do Plano 15). Micros e perfil não entram (RN-240). O consentimento ("o seu plano publicado") não muda de versão |
| RN-256 | **Cópias do plano.** `copiarConteudo` (usado por "Editar", `salvarComoModelo` e `criarDeModelo`) copia `modo`, `referencia_id`, `nutrientes_exibidos`, `macros_prescritos`, `mostrar_micros_pdf`, `dias_semana` e `descricao_livre` de cada refeição, as cópias de `plano_listas_substituicao` (o mesmo `conteudo`, sem reler a biblioteca) e as linhas de `plano_conteudos`. `iguais` (comparação do salvamento) e `validar` passam a conhecer os campos novos. `referencia_congelada` **não** é copiada (é da publicação). `salvarComoModelo` continua levando as observações (comportamento de hoje, RNF-08) e passa a levar também o texto livre; a tela "Salvar como modelo" ganha o aviso "Observações e textos das refeições vão para o modelo. Retire dados do paciente antes de salvar." |
| RN-257 | **Exportação e anonimização (LGPD, art. 18, II e V).** `planosParaExportacao` leva, em cada plano: `modo`, `metaKcal`, `macrosPrescritos`, `referencia` (a cópia congelada, só de publicado/arquivado), `nutrientesExibidos`; em cada refeição: `diasSemana` (rótulo e números) e `descricaoLivre`; em cada item: `fonte` e `micros` congelados; e `listasSubstituicao` (cópias) e `conteudosLigados` (tipo e título; no escopo `titular`, só os publicados, como a receita da refeição hoje). Rascunho continua fora do escopo `titular`. Na **anonimização**, as tabelas novas com `patient_id` seguem o plano (prontuário guardado 20 anos, Res. CFN 594, art. 3º, VI, "b"): `descricao_livre` tem o mesmo tratamento que `observacao` tem hoje; o PDF sai como hoje. Biblioteca do consultório não é dado de paciente e não entra na exportação do titular |
| RN-258 | **Excluir alimento em uso.** As FKs `RESTRICT` de `refeicoes_modelo_itens` e `listas_substituicao_itens` para `foods` somam-se à de `meal_items` e às de receitas. `MSG_ALIMENTO.emUso` passa a ser "Este alimento está em uso (plano, receita, minha refeição ou lista de substituição) e não pode ser excluído." As cópias em `plano_listas_substituicao` não têm FK (guardam o nome) |
| RN-259 | **Textos de interface.** Os textos novos ficam em constantes (`MSG_FONTES`, `MSG_NUTRIENTES`, `MSG_REFERENCIAS`, `MSG_BUSCA`, `MSG_TEXTO_LIVRE`, `MSG_DIAS`, `MSG_MINHAS_REFEICOES`, `MSG_LISTAS`, `MSG_LIGADOS`) e entram na tabela "Textos de interface" das histórias do MVP no fechamento. Texto exato: §5 e §6.1 |

### 6.1 Textos de interface (resumo)

| Onde | Texto |
|---|---|
| Selo / aviso USDA | "USDA (EUA)" · "Nome traduzido automaticamente do inglês." |
| Sem valor | "Sem valor na {sigla}" (ex.: "Sem valor na USDA") |
| Busca | "Mais opções de busca" · "Buscar alimento" (título do diálogo) · abas "Lista", "Nutrientes", "Equivalentes" · "Ver nutrientes" · "Adicionar" · "Adicionar como substituição" · "Não encontrou? Cadastrar meu alimento" · "Rico em" / "Pobre em" · "Igualar por" · "Sugestão: confira antes de usar." · "Nenhum alimento atende a este critério." |
| Modo | "Como montar o plano" · "Com alimentos e quantidades" · "Texto livre por refeição" · "O que comer" · "Distribuição prescrita (opcional)" · "A soma de proteína, carboidrato e lipídio precisa dar 100%." |
| Dias | "Dias" · "Todos" · "seg" … "dom" · "{dia}: sem refeições" · "Escolha ao menos um dia da semana." · "Escolha um dia para ver os detalhes." |
| Nutrientes | "Nutrientes do paciente" · "Perfil de referência" · "Sem perfil" · "Ver todos os nutrientes" · "Mostrar no PDF os nutrientes escolhidos" · "Escolha até 12 nutrientes." · "Acima do máximo ({valor})" · "Micronutrientes não registrados nesta versão do plano." |
| Ligado ao plano | "Ligado ao plano" · "Ligar lista de substituição" · "Ligar receita ou material" · "Atualizar da biblioteca" · "Remover" · "Cópia de {data}. Mudanças na biblioteca não alteram este plano." · "Não publicado — o paciente não vê" · "{título} (excluído)" · "O plano pode ter até 5 listas e 10 receitas ou materiais." |
| Observação | "Aparece para o paciente no app." |
| Minhas refeições | "Salvar como minha refeição" · "Carregar minha refeição" · "Incluir a observação" · "Confira o nome e os itens: retire dados do paciente antes de salvar." · "Refeição salva em Minhas refeições." · "Nenhuma refeição salva. Use "Salvar como minha refeição" no editor do plano." |
| Portal | "Hoje ({dia})" · "Ver outros dias" · "Seu plano não tem refeições para hoje." · "Ligado ao seu plano" · "Lista de substituição" · "Receitas e materiais do seu plano" · "Sua nutricionista:" |

---

## 7. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-230 | Desempenho | Busca por nome p95 ≤ 300 ms e por nutriente/equivalentes p95 ≤ 500 ms com o seed USDA (CS-231), medidos em `busca.tempo.test.ts` (que roda em `pnpm test:tempo`). Índice GIN de trigramas em `app_unaccent(lower(nome_original))` (parcial, `nome_original is not null`) e índice em `foods (grupo)`; índice por expressão em `micros` **só** se o teste pedir. Editor: o recálculo com micros e dias continua síncrono no cliente, sem travar a digitação num plano de 50 refeições (medido no E2E) |
| RNF-231 | Tamanho | Migration do seed USDA abaixo de 10 MB de SQL; se passar, dividida em partes custom em sequência (sem mudar a regra de geração do §5). O CSV fica em `seeds/` e conta no repositório |
| RNF-232 | Acessibilidade | Diálogo com `<dialog>` nativo, título ligado por `aria-labelledby`, abas com o padrão ARIA (`tablist`/`tab`/`tabpanel`, setas do teclado), foco no campo de busca ao abrir e volta ao botão que abriu ao fechar; resultados em lista com contagem anunciada (`role="status"`); filtro de dias como grupo de botões de alternância com `aria-pressed`; indicador da meta e "Acima do máximo" em texto (WCAG 1.4.1); axe com zero violação nas telas novas, claro e escuro |
| RNF-233 | Privacidade | Nada de nome de alimento do plano, texto livre, observação ou valor de nutriente em log/Sentry (regra 3 do `CLAUDE.md`); erros logam só ids e o motivo. Teste das chaves da projeção do portal (RN-240) |
| RNF-234 | Testes | (a) unidade: catálogo, `microsDoItem`/`totalMicros`, perfis de dia e `rotuloDosDias`, equivalentes, troca de modo, lista de compras por dia, próxima refeição com dias e fuso; (b) integração (Testcontainers): fonte e CHECKs, seed USDA (hash, faixas, chaves do catálogo, nenhuma marca), congelação nova e leitura do formato antigo, RLS das tabelas novas (`staff_only`, `paciente_sem_rascunho`, isolamento), exceção da RN-12 ampliada com a guarda de que o feed, a busca, os favoritos e a visualização não a ligam, `caminhoDoPdfDoConteudo` com `doPlano`, exportação; (c) E2E do fluxo principal: plano com seg a sex e sáb e dom, lista e material ligados, publicar, ver no app no dia certo |
| RNF-235 | Manutenção | `calculo.ts` puro (sem banco nem React); `DiaDaSemana` num lugar só (D28); os módulos novos em `src/modules/alimentos/` (fontes, nutrientes, referências) e `src/modules/plano-alimentar/` (refeicoes-modelo, listas, ligados) |

---

## 8. Integrações

Nenhuma integração em tempo real. A **INT-04** (tabelas de composição) ganha versão nova: além da TACO 4ª ed. e das
medidas do IBGE, o seed da USDA FoodData Central (Foundation e SR Legacy, versão fixa, CC0, sem API e sem chave da
data.gov no repositório) e o lugar da TBCA (desligado, RN-232). Push, e-mail e WhatsApp sem mudança; os lembretes do
Plano 17 só passam a respeitar o dia (RN-247 f).

---

## 9. Modelo de dados

Migrations geradas a partir da `main` do momento do PR (§5 de `sessoes-paralelas.md`, D28), rodadas com
`DATABASE_URL_MIGRATOR` (regra 7). Nenhum número é reservado aqui.

### 9.1 Tabelas que mudam

| Tabela | Mudança | Regras |
|---|---|---|
| `foods` | `fonte text not null` (default só na migration, para o preenchimento) | CHECK `foods_fonte_valida`: `fonte in ('taco', 'usda', 'tbca', 'propria')` |
| `foods` | `fonte_ref text null` | UNIQUE `foods_fonte_ref_unique (fonte, fonte_ref)`; CHECK `char_length(fonte_ref) between 1 and 40` |
| `foods` | `nome_original text null` | CHECK `nome_original is null or (fonte = 'usda' and char_length(nome_original) between 2 and 200)`; índice GIN de trigramas parcial |
| `foods` | CHECK `foods_origem_valida` refeito | `(tenant_id is null) = (fonte <> 'propria') and (fonte = 'propria') = (fonte_ref is null) and (taco_id is not null) = (fonte = 'taco')`. Preenchimento na mesma migration: `fonte = case when tenant_id is null then 'taco' else 'propria' end`, `fonte_ref = taco_id::text` |
| `foods` | CHECK `foods_valores_faixa` | kcal de 0 a **1000** (D6: gorduras da SR Legacy chegam a 902 kcal/100 g); os demais continuam 0 a 100 |
| `foods` | índice `foods_grupo_idx (grupo)` | Equivalentes e filtro de grupo |
| `meal_plans` | `modo text not null default 'calculado'` | CHECK `meal_plans_modo_valido` |
| `meal_plans` | `referencia_id uuid null` | FK composta `(tenant_id, referencia_id)` → `referencias_nutrientes (tenant_id, id)` `ON DELETE SET NULL (referencia_id)` (na migration custom, como a 0082) |
| `meal_plans` | `nutrientes_exibidos text[] not null default '{}'` | CHECK `cardinality(nutrientes_exibidos) <= 12` (as chaves são conferidas no código) |
| `meal_plans` | `referencia_congelada jsonb null` | CHECK `referencia_congelada is null or status <> 'rascunho'` (só a publicação grava) |
| `meal_plans` | `macros_prescritos jsonb null` | CHECK `macros_prescritos is null or modo = 'livre'`; formato conferido no código (RN-244) |
| `meal_plans` | `mostrar_micros_pdf boolean not null default false` | — |
| `meals` | `dias_semana smallint[] not null default '{0,1,2,3,4,5,6}'` | CHECK `meals_dias_validos`: `app_dias_semana_validos(dias_semana)` (função `IMMUTABLE` nova: 1 a 7 valores, de 0 a 6, em ordem crescente, sem repetição) |
| `meals` | `descricao_livre text null` | CHECK `descricao_livre is null or char_length(descricao_livre) <= 2000` |
| `meal_items` | `nutrientes` (jsonb) | Só o tipo `NutrientesCongelados` muda (RN-237); nenhuma linha é reescrita |

- **Auditoria:** `meal_plans`, `meals` e `meal_items` já têm `audit_row_change` (entidade `plano_alimentar`). A migration
  só acrescenta colunas com `DEFAULT` (sem `UPDATE` de linhas auditadas, sem `DISABLE TRIGGER`). O preenchimento de
  `foods` não toca tabela auditada.
- **RLS:** sem mudança em `foods` (`taco_leitura` já cobre as fontes públicas) nem nas três tabelas do plano.

### 9.2 Tabelas novas

Cada uma com migration custom `rls_<tabela>` (regra 2), entrada em `FABRICAS` de `test/isolamento.test.ts` (e
`COM_MAE` quando precisa de linha-mãe) e as guardas do CI.

| Tabela | Colunas principais | RLS e guardas | Auditoria |
|---|---|---|---|
| `referencias_nutrientes` | `tenant_id`, `id`, `nome` (1–80, UNIQUE por tenant), `fonte` (2–300, NOT NULL), `valores jsonb` (`{ chave: { meta, maximo } }`), carimbos | `app_enable_tenant_rls` + `app_enable_staff_only`; `STAFF_ONLY`; `FABRICAS` | Sem `patient_id`: sem gatilho (não é dado de saúde; fora de `AUDIT_EXCEPTIONS`, que só lista tabela com `patient_id`) |
| `refeicoes_modelo` | `tenant_id`, `id`, `nome` (1–60), `tipo` (CHECK da lista), `horario time null`, `modo`, `descricao_livre`, `observacao` (até 2000), carimbos | `app_enable_tenant_rls` + `app_enable_staff_only`; `STAFF_ONLY`; `FABRICAS` | Sem gatilho |
| `refeicoes_modelo_itens` | `tenant_id`, `refeicao_id` (FK composta, cascade), `id`, `food_id` (FK **RESTRICT**), `quantidade_g` (0,1–5000), `medida jsonb`, `substitui_item_id` (FK para o principal da mesma refeição, cascade), `ordem` | Idem; `FABRICAS` + `COM_MAE` | Sem gatilho |
| `listas_substituicao` | `tenant_id`, `id`, `nome` (1–80, UNIQUE por tenant), `orientacao` (até 1000), carimbos | Idem; `STAFF_ONLY`; `FABRICAS` | Sem gatilho |
| `listas_substituicao_grupos` | `tenant_id`, `lista_id` (FK composta, cascade), `id`, `nome` (1–60), `ordem` | Idem; `FABRICAS` + `COM_MAE` | Sem gatilho |
| `listas_substituicao_itens` | `tenant_id`, `lista_id`, `grupo_id` (FK composta, cascade), `id`, `food_id` (FK **RESTRICT**), `quantidade_g` (0,1–5000), `medida jsonb`, `ordem` | Idem; `FABRICAS` + `COM_MAE` | Sem gatilho |
| `plano_listas_substituicao` | `tenant_id`, `patient_id` (nulo em modelo, como `meals`), `plan_id`, `id`, `lista_origem_id uuid null` (sem FK: só informativo), `nome`, `orientacao`, `conteudo jsonb` (grupos e itens congelados, RN-252), `copiada_em`, `ordem`, carimbos. FKs compostas `(tenant_id, plan_id)` e `(tenant_id, plan_id, patient_id)` → `meal_plans`, cascade (molde de `meals`). CHECK `jsonb_typeof(conteudo) = 'object'` e tamanho (`pg_column_size(conteudo) <= 65536`) | `app_enable_tenant_rls` + `app_enable_patient_rls` + política RESTRICTIVE `paciente_sem_rascunho` (molde da 0045: `EXISTS` em `meal_plans` com `status <> 'rascunho'`); sem escrita do paciente (fora de `PACIENTE_ESCREVE`); `FABRICAS` + `COM_MAE` + filtro em `SO_APAGA.patients` | `app_enable_audit('plano_listas_substituicao', 'plano_alimentar')` |
| `plano_conteudos` | `tenant_id`, `patient_id` (nulo em modelo), `plan_id`, `id`, `content_id uuid null` (FK composta `(tenant_id, content_id)` → `contents` `ON DELETE SET NULL (content_id)`), `titulo` (cópia, 1–120), `ordem`, `created_at`. UNIQUE `(plan_id, content_id)`. FKs para `meal_plans` como acima. Índice `(tenant_id, content_id) where content_id is not null` (a política de `contents` procura por ele) | Idem a `plano_listas_substituicao` | `app_enable_audit('plano_conteudos', 'plano_alimentar')` |

- **Política de `contents`** (migration custom): `DROP` e `CREATE` de `paciente_conteudo_visivel` com o ramo novo da
  RN-253 (`EXISTS (SELECT 1 FROM plano_conteudos pc JOIN meal_plans pl ON pl.tenant_id = pc.tenant_id AND pl.id =
  pc.plan_id WHERE pc.tenant_id = contents.tenant_id AND pc.content_id = contents.id AND pl.status = 'publicado')`,
  dentro do mesmo `current_setting('app.receitas_do_plano', true) = 'on'`). As subconsultas rodam com a RLS de quem lê:
  só as linhas do próprio paciente, nunca o rascunho. `CONTEUDO_POR_AUDIENCIA` (`src/db/rls-guard.ts`) ganha o trecho
  novo; `findConteudoAudienciaViolations` confere.
- **Ordem das migrations:** gerada (colunas, tabelas, CHECKs) → custom `rls_*` de cada tabela nova → custom das FKs com
  `SET NULL (coluna)` e da política de `contents` → custom `seed_usda` (dados, por último). Se uma custom precisar
  rodar entre duas geradas, regenerar por etapas (§5, passo 4 de `sessoes-paralelas.md`).
- **Drizzle:** colunas em `src/db/schema/alimentos.ts` e `plano-alimentar.ts`; tabelas novas em
  `src/db/schema/plano-alimentar.ts` (ligações) e num arquivo novo `src/db/schema/biblioteca-plano.ts` (biblioteca e
  referências), exportado em `src/db/schema/index.ts` (só acrescentar).
- **`CLAUDE.md`:** regras 1, 2 e 8 ganham uma frase do Plano 19 (as tabelas `staff_only`, as duas com `patient_id`
  auditadas e a exceção da RN-12 ampliada), no fim, como manda o §6 de `sessoes-paralelas.md`.

---

## 10. LGPD

| Tema | Tratamento |
|---|---|
| Finalidade e base legal | Nada novo: acompanhamento nutricional, tutela da saúde (LGPD, art. 11, II, "f", redação conferida em 16/11/2026). O plano continua sendo o mesmo dado, mais detalhado; nenhuma coleta nova do paciente |
| Prontuário | A lista ligada (cópia), as ligações de conteúdo, o texto livre, os dias e todas as versões do plano são prontuário (Res. CFN 594, art. 3º, VI, "b": 20 anos). Auditoria pelo gatilho (entidade `plano_alimentar`) e leitura com `auditRead` pelos caminhos de hoje (`lerPlanoNaTransacao`, `planoDoPaciente`, `listaDoPlano`): a lista e os conteúdos ligados são lidos na mesma transação e entram no mesmo registro |
| Minimização | "Minhas refeições" e as listas da biblioteca não têm paciente; a observação só vai para a minha refeição se a nutricionista marcar (art. 6º, III); aviso ao salvar como modelo (RN-256). Micros e perfil não vão ao app (RN-240) |
| Direitos do titular | Exportação ampliada (RN-257), escopos `titular` e `equipe`; conteúdo ligado não publicado fica fora do `titular`, como a receita da refeição hoje |
| Anonimização e exclusão | Sem rotina nova: as tabelas com `patient_id` seguem o plano; `descricao_livre` como `observacao` (RN-257) |
| IA | IA Nutri: lista e texto livre mascarados (`mascarar`), dentro de "o seu plano publicado" — o consentimento não muda (dono, 16/11/2026). IA da nutricionista: nada novo sai (RN-109, D26); só TACO e próprios nas ferramentas (RN-234) |
| Dados de terceiros | Bases públicas: USDA (CC0) com citação; TBCA só com autorização; nenhuma lista de livro pré-carregada (Lei 9.610, art. 7º, XIII) |

---

## 11. Boas práticas SBIS NGS1

1. **Registro íntegro** (NGS1.07): congelação dos valores, da fonte e do perfil na publicação; a cópia da lista não muda
   com a biblioteca; nenhuma migration reescreve plano publicado.
2. **Origem visível** (ECF.17.01): selo da fonte em cada alimento, "Nome traduzido automaticamente do inglês.", fonte
   obrigatória no perfil, citação no PDF; equivalentes e busca por nutriente com o critério e "Sugestão: confira antes
   de usar."
3. **Controle de acesso** (NGS1.03): biblioteca `staff_only`; ligações com `paciente_sem_rascunho`; exceção da RN-12 só
   no caminho do plano, com guarda de teste.
4. **Trilha** (NGS1.07): gatilho nas duas tabelas novas com `patient_id`; nenhuma migration desliga o gatilho.
5. **Datas** (ECF.17.05): o dia da semana é o do fuso do consultório, no servidor.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-230 | A TBCA não responde ou nega | O PD-20 fica só com o lugar pronto (RN-232); TACO e USDA cobrem o plano |
| R-231 | Tradução automática ruim ("Beef, chuck" traduzido ao pé da letra) | Original em inglês ao lado, aviso visível, busca pelos dois nomes, "Duplicar como meu alimento" para corrigir; CSV de nomes revisável e corrigível por PR |
| R-232 | Marca escapa do filtro da SR Legacy (Res. CFN 599, art. 60, III; Res. 856, art. 74, III) | Exclusão por categoria e por palavra em caixa alta, relatório de exclusões revisado pelo `normas-cfn-lgpd` na tarefa do seed, teste que procura caixa alta nos nomes importados |
| R-233 | Valores fora das faixas do CHECK ou em outra unidade quebram o seed | Mapa de nutrientes com teste de unidade; kcal até 1000 (D6); linha fora da faixa sai com o motivo no relatório |
| R-234 | Volume da USDA (milhares de linhas) deixa a busca lenta | Índices da RNF-230 e `busca.tempo.test.ts` no volume real; índice em `micros` se o teste pedir |
| R-235 | Leitores do formato antigo de `NutrientesCongelados` quebram (PDF, portal, exportação, IA, resumo) | Leitura tolerante num lugar só (`lerCongelados`), teste com plano publicado antes do deploy |
| R-236 | Dia da semana esquecido num leitor: o paciente vê refeição do dia errado | Lista fechada de leitores na RN-247 (editor, mural, Plano, próxima refeição, diário, lembretes, PDF, IA, lista de compras) e CS-233 |
| R-237 | A exceção da RN-12 ampliada libera conteúdo fora do caminho do plano | Mesmo marcador e mesmos pontos de liberação; guarda em `src/modules/portal/conteudos.test.ts` (feed, busca, favoritos, visualização e mural nunca ligam); `findConteudoAudienciaViolations` |
| R-238 | Texto livre ou observação com nome ou telefone do paciente vai à IA ou ao modelo | `mascarar` com teste; aviso ao salvar minha refeição e modelo |
| R-239 | Planos de 50 refeições pesam no editor, no PDF e no contexto da IA Nutri | Medição antes de fechar a tarefa (RN-249, PM-PA9); se passar do orçamento, o limite volta a ser discutido |
| R-240 | Colisão com o Plano 17 (lembretes) e os Planos 18 e 20 em arquivos e migrations | §13, D28: só acrescentar, migration gerada de novo, um PR com migration por vez |
| R-241 | Texto livre sem VET não cumpre a "prescrição dietética" (Res. CFN 594, art. 4º, § 1º, VIII) | Aviso na publicação (RN-244); pergunta ao CRN-3; regra revista com a resposta |
| R-242 | A nutricionista toma o perfil de referência por dado "oficial" da plataforma | Fonte obrigatória e mostrada sempre junto dos valores; a lista vazia diz que a plataforma não traz valores prontos |
| R-243 | Quatro worktrees de plano ao mesmo tempo (`-a`, `-b`, `-c`, `-18`) passam do limite de 3 sessões de código (§2 de `sessoes-paralelas.md`) e disputam CPU com a produção | A orquestradora escalona suíte, E2E e revisões pesadas; esta sessão só roda suíte pesada quando avisada |

---

## 13. Conflitos com sessões paralelas

Estado em 16/11/2026: Plano 17 em `../nutridebby-a` (P17-01 feito, migrations `0118`/`0119` na branch), Plano 18 em
`../nutridebby-18`, Plano 20 em `../nutridebby-c`, Plano 19 aqui (sessão B). Nada mesclado ainda. Regras: §5 e §6 de
`sessoes-paralelas.md` — migration gerada de novo sobre a `main` antes do PR, só acrescentar nos arquivos disputados,
quem entra depois resolve o conflito no rebase, um PR com migration na fila por vez.

| Arquivo ou área | Quem mais mexe | Como o Plano 19 entra |
|---|---|---|
| `drizzle/` (journal, snapshots, numeração) | 17, 18, 20 | Sem número reservado; regenera antes do PR (D28) |
| `src/db/schema/index.ts`, `plano-alimentar.ts`, `alimentos.ts` | 17 (lembretes lê refeições), 18 (`pacientes.ts`) | Só acréscimos; tabelas novas em arquivo próprio (`biblioteca-plano.ts`) |
| `src/db/rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts` | 17, 20 | Só acrescentar no fim de `STAFF_ONLY`, `CONTEUDO_POR_AUDIENCIA`, `FABRICAS`, `COM_MAE`, `SO_APAGA` |
| `CLAUDE.md` (regras 1, 2, 8) | 17, 18, 20 | Frase nova no fim de cada regra |
| `src/modules/plano-alimentar/carregar.ts` | 17 | Campos novos no `PlanoCompleto`; sem mudar assinaturas usadas pelo 17 |
| `src/modules/lembretes/{slots,envio}.ts` e `config.ts` (`DiaDaSemana`) | 17 | **Depois do merge do 17**: `RefeicaoDoPlano` ganha `dias`, `planoDoDia` filtra, a leitura do worker traz `dias_semana`. Se o 19 entrar antes, cria `DiaDaSemana` em `src/modules/plano-alimentar/dias.ts`, e o 17 passa a importar dali no rebase (D28) |
| `src/modules/pacientes/exportacao-job.ts`, `exportacao.test.ts`, `lgpd.ts` | 17, 18, 20 | Acréscimos em `planosParaExportacao`; `lgpd.ts` sem rotina nova |
| `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx` | 17 (seção de lembretes), 18 | Só se a página precisar mostrar o modo ou os dias; preferir mudar o editor |
| `src/modules/portal/{plano,mural,diario,diario-constantes,lista-compras,conteudos}.ts` e `src/app/p/(portal)/{plano,inicio,compras}/*` | 17 (diário), 18 (filtros de visibilidade do PD-13) | Filtro por dia e seções novas; projeção fechada com teste |
| `src/app/api/p/conteudos/[id]/pdf` | — | `?de=plano` |
| `src/app/painel/alimentos/busca-alimento.tsx`, `src/app/painel/planos/editor/*` | — | Selo novo, diálogo novo |
| `src/modules/ia/{ferramentas-alimentos,resumo-dados,rascunho-ia,rascunho-dados,modelos-job,geracao-formato,campos-enviados,pseudonimizar}.ts`, `nutri-paciente/{contexto,montar-resposta,textos}.ts` | 18 (`pseudonimizar.ts`, `campos-enviados.test.ts`), branch `p15-a` (`pseudonimizar.ts`) | Filtro de fonte, padrões do rascunho, contexto com dias e lista |
| `scripts/e2e-seed.ts`, `test/carga/seed.ts` | 18, 20, `p15-a` | Acréscimos (um plano com dias e lista ligada) |
| `src/app/painel/configuracoes/page.tsx` | 20 (talvez) | Três cartões no fim de `CARTOES` |
| `docs/manual-tecnico/04-modulos-clinicos.md` (§4.3, §4.4, §4.6), `05-agenda-portal-conteudo.md`, `README.md`; specs do MVP (RN-01, RN-02, RN-12, RN-13, INT-04) e da IA (RN-116, RN-126) | 18, 20 | No fechamento; RN novas no bloco 230 |

---

## 14. Decisões

### 14.1 Decisões desta spec

| ID | Decisão | Por quê |
|---|---|---|
| D1 | **Fonte do alimento em coluna**: `foods.fonte` + `fonte_ref` única por fonte, no lugar do par TACO/próprio do CHECK `foods_origem_valida`; `taco_id` fica; `FONTES` com selo e citação por fonte | Uma coluna atende TACO, USDA, TBCA e as próximas sem tabela por fonte; a RLS (`taco_leitura`) e a busca não mudam; o seed e os testes da TACO seguem iguais |
| D2 | **USDA = Foundation + SR Legacy, offline**, sem "Branded Foods" e sem os itens com marca da SR Legacy (categorias e palavras em caixa alta); nome traduzido com o original ao lado (decisão do dono) | Domínio público (CC0), sem custo nem chave de API; marca no plano fere a Res. 599, art. 60, III e a Res. 856, art. 74, III; sem tradução a busca em português não acha nada |
| D3 | **Tradução feita uma vez, na preparação do seed**, gravada em `seeds/usda-nomes-pt.csv` e revisável por PR; nenhum serviço de tradução em produção | Sem custo novo nem dado indo a terceiros em tempo de uso; o arquivo versionado deixa a tradução conferível |
| D4 | **Grupos da USDA mapeados para os 15 da TACO** em CSV revisável, sem mexer no CHECK de grupos | Tela, filtros, equivalentes, lista de compras e o CHECK já usam os 15 grupos; grupo novo espalharia mudança sem ganho |
| D5 | **Sem medidas caseiras da USDA** ("1 cup"): gramagem + medidas do consultório | As porções vêm em inglês e em medidas americanas; a nutricionista já cadastra medidas próprias (`food_measures`) |
| D6 | **Teto de kcal do CHECK sobe para 1000**; demais faixas ficam; linha fora da faixa sai do seed com o motivo | Gorduras da SR Legacy chegam a 902 kcal/100 g (sebo bovino); nenhum alimento real passa de 1000 |
| D7 | **TBCA: lugar pronto, carga desligada** até a autorização por escrito (decisão do dono: ele pede a autorização e o plano segue sem ela) | A licença proíbe uso comercial sem autorização; esperar travaria os outros oito itens |
| D8 | **IA da nutricionista continua só com TACO e próprios** (filtro por fonte nas ferramentas) | RN-116/RN-126; mudar exige decisão nova do dono e talvez versão nova da autorização (RN-109) |
| D9 | **Catálogo único de nutrientes em código**; `foods.micros` só com as chaves dele | Uma lista guia o seed, o formulário, o cálculo, a busca e o perfil; chave nova é mudança revisada |
| D10 | **`NutrientesCongelados` ganha fonte, versão, fonte de origem e micros**; leitura aceita o formato antigo; nenhum publicado é reescrito | RN-01 (o publicado não muda quando a tabela muda) e Res. 594 (micros na prescrição registrada) |
| D11 | **Perfis de referência do consultório, com fonte obrigatória; nada pré-carregado** | As DRI têm copyright e os termos proíbem "derivative datasets"; os VDR da ANVISA são para rotulagem; o perfil próprio cumpre o "mais importantes para o paciente" sem risco de licença |
| D12 | **Micros fora do app**; no PDF só se a nutricionista marcar, junto com "Mostrar calorias ao paciente" | Lista de micros sem orientação confunde o paciente; o padrão de `mostrar_calorias` já existe |
| D13 | **Diálogo novo "Buscar alimento"** (Lista, Nutrientes, Equivalentes), ao lado do combobox inline, que continua; "Ver nutrientes" e o atalho "Cadastrar meu alimento" | O diálogo não existia (o editor usa o `BuscaAlimento` inline, também usado em `/painel/alimentos`); manter o inline preserva o caminho rápido e a tela de alimentos |
| D14 | **Equivalentes com critério visível**: mesmo grupo, igualar por energia (ordem pela proximidade dos macros) ou por um nutriente (energia a ±10%) | A equivalência é julgamento da nutricionista (Res. 599, arts. 37 e 38); a tela só sugere e mostra como chegou à quantidade |
| D15 | **Texto livre por refeição** (decisão do dono), como modo do plano | Hoje, PDF, "Comi assim", lembretes e citações da IA Nutri funcionam por refeição; um texto único quebraria todos |
| D16 | **Texto livre pode ser publicado sem VET, com aviso** (decisão do dono); macros prescritos opcionais | A norma pede o VET na prescrição, mas ainda não sabemos se ele pode ficar só no atendimento (pergunta ao CRN-3) |
| D17 | **Dias da semana = um plano só, com refeições marcadas por dia** (decisão do dono): `meals.dias_semana`, padrão os 7 dias | Mantém a RN-01, as versões, o PDF, a IA e os lembretes; vários planos publicados mudariam boa parte do sistema |
| D18 | **Limites sobem para 50 refeições e 400 itens**; o rascunho da IA fica com 15 | Com refeições por dia, 15 não bastam; o rascunho da IA gera um dia só |
| D19 | **Lista de compras por dia de cada refeição** a partir de hoje; texto livre fora, com aviso | Com dias, multiplicar tudo pelo número de dias somaria o almoço de sábado em todos os dias |
| D20 | **"Comi assim" só para refeição que vale hoje** | A resposta é do dia (RN-197); responder a refeição de outro dia gravaria um registro sem sentido |
| D21 | **Minhas refeições em tabelas próprias, `staff_only`, sem paciente**; observação fora por padrão | `meals` exige plano; um plano-modelo falso por refeição bagunçaria os modelos; a observação pode ter dado do paciente (LGPD, art. 6º, III) |
| D22 | **Biblioteca de listas em três tabelas `staff_only`**, com alimento da tabela em cada item | Grupos e itens editáveis, energia calculada, FK `RESTRICT` protege o alimento em uso |
| D23 | **Lista ligada ao plano = uma tabela com a cópia em `jsonb`**, não tabelas filhas; sem edição item a item da cópia | A cópia é congelada; uma linha só simplifica RLS, auditoria, exportação, `FABRICAS` e as cópias do plano (a crítica pedia escolher entre as duas formas) |
| D24 | **Conteúdos ligados em `plano_conteudos` + exceção da RN-12 ampliada**, com o mesmo marcador e os mesmos pontos de liberação, mais o PDF com `doPlano`; não conta em "Quem viu" | É o mecanismo seguro da US-054; renomear o marcador tocaria guardas e testes sem ganho; a política de hoje só libera receita por `meals.recipe_content_id`, e o PDF da orientação não abria sem a liberação |
| D25 | **IA Nutri usa a lista de substituição do plano publicado** (decisão do dono), com a mesma máscara e prioridade para a substituição da refeição; texto livre entra mascarado; materiais e receitas continuam fora | O consentimento fala em "o seu plano publicado", e a lista faz parte dele; a substituição da refeição é a mais específica |
| D26 | **IA da nutricionista: nada novo sai** — o resumo continua com nome, horário e itens principais (refeição em texto livre vai sem itens, sem o texto); "Usar como rascunho" grava modo calculado e os 7 dias | RN-109: qualquer mudança no que sai pede versão nova da autorização de cada paciente |
| D27 | **Telas novas sem item no menu**: cartões em Configurações | O menu é arquivo disputado e já cheio; alimentos e modelos já moram em Configurações |
| D28 | **Sessão B em paralelo**, migrations geradas de novo sobre a `main` antes do PR (§5), sem número reservado; só a parte dos lembretes da T8 espera o merge do 17; `DiaDaSemana` num lugar só | A branch do 17 ainda não foi mesclada e esperar atrasaria semanas; renumerar à mão faria o migrador pular a migration em silêncio |

### 14.2 Respostas do dono de 16/11/2026

O dono aprovou **todas as recomendações** da proposta ("aprovo todas as recomendações, pode seguir"):

| Pergunta da proposta | Resposta | Onde está |
|---|---|---|
| TBCA proíbe uso comercial sem autorização | O dono pede a autorização aos coordenadores (tbca.contato@usp.br) e o plano segue sem ela: estrutura pronta, carga desligada | D7, RN-232 |
| Como a nutricionista vê os alimentos da USDA | Nome traduzido (marcado "tradução automática") com o original em inglês ao lado; a busca acha pelos dois | D2, D3, RN-230, RN-231 |
| Dias da semana | Um plano só, com refeições marcadas por dia | D17, RN-246, RN-247 |
| Onde fica o texto livre | Um texto por refeição | D15, RN-243 |
| Publicar texto livre sem VET | Pode, com aviso | D16, RN-244 |
| IA Nutri e a lista de substituição | Pode usar a lista do plano publicado, com a mesma máscara | D25, RN-255 |

### 14.3 Pendências ★ (nenhuma bloqueia o plano)

| ID | Pergunta | Recomendação |
|---|---|---|
| P19-★1 | Pré-carregar os VDR da ANVISA (IN 75/2020) como perfil opcional? É ato oficial (Lei 9.610, art. 8º, IV), mas a finalidade declarada é rotulagem e os valores do Anexo II ficaram **a conferir** | **Não no Plano 19.** Se o dono quiser, entra depois como dado (um perfil com a fonte "IN 75/2020 da ANVISA — VDR para rotulagem"), sem mudar o modelo |
| P19-★2 | CRN-3: (1) texto livre sem VET cumpre a prescrição, com o VET no atendimento? (2) VDR de rotulagem como meta individual tem restrição? (3) art. 74, parágrafo único da Res. 856 e alimentos com marca | Mandar junto das outras perguntas ao CRN-3; a RN-244 é revista com a resposta |
| P19-★3 | E-09: (1) alcance da autorização da TBCA (carga, conversão, "Duplicar", PDF, exportação, IA; SaaS por assinatura é "uso comercial"?); (2) DRI pré-carregada; (3) quem responde por lista de substituição importada de obra de terceiros | Pacote do advogado; nada disso entra no Plano 19 |

---

## 15. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-PA1 | Doze tarefas, na ordem: T1 fonte (D1, RN-230, RN-233, RN-234) · T2 catálogo e micros (RN-235 a RN-237) · T3 seed USDA (RN-231) · T4 perfis de referência e nutrientes do paciente (RN-238 a RN-240) · T5 diálogo de busca (RN-241, RN-242) · T6 minhas refeições (RN-250) · T7 texto livre (RN-243 a RN-245) · T8 dias da semana (RN-246 a RN-249; lembretes depois do merge do 17) · T9 biblioteca de listas (RN-251) · T10 ligações ao plano e RN-12 ampliada (RN-252, RN-253, RN-256) · T11 portal, PDF e IA Nutri (RN-247, RN-254, RN-255, RN-257) · T12 fechamento |
| PM-PA2 | Revisores por tarefa: `revisor-rls` (T1, T4, T6, T8, T9, T10), `normas-cfn-lgpd` (T1, T3, T4, T7, T10, T11), `revisor-interface` (T4, T5, T6, T7, T8, T9, T11), `guardiao-manual` (T12) |
| PM-PA3 | T3: baixar os arquivos do FoodData Central uma vez, guardar o sha256 em `FONTES.usda`, não versionar o zip se passar do limite (guardar o link e o hash); script e testes no molde de `taco-fonte.test.ts` |
| PM-PA4 | T3: a tradução é feita pelo agente que executa a tarefa, em lotes, e revisada por amostragem pelo `normas-cfn-lgpd` (nomes com marca, termos clínicos); o CSV fica no PR |
| PM-PA5 | T2: `lerCongelados` (leitura tolerante, RN-237) usado por todos os leitores do plano publicado: PDF, portal, exportação, `resumo-dados`, contexto da IA Nutri, editor |
| PM-PA6 | T5: o diálogo reusa a rota `GET /api/painel/alimentos` com parâmetros novos (`fonte`, `grupo`, `nutriente`, `direcao`) e uma rota para equivalentes; a busca da IA passa `fontes` explicitamente |
| PM-PA7 | T8: perfis de dia (`perfisDeDia`) e `rotuloDosDias` puros, compartilhados por editor, PDF e portal; testes com fuso e virada de dia |
| PM-PA8 | T8: lista fechada de leitores do dia (RN-247) como checklist da tarefa e do revisor |
| PM-PA9 | T8: medir editor, PDF e contexto da IA Nutri com 50 refeições e 400 itens (RN-249); registrar no plano |
| PM-PA10 | T10: guarda em `src/modules/portal/conteudos.test.ts` ampliada (o mural `conteudosNovosNaTransacao`, o feed, a busca, os favoritos e a visualização nunca ligam a liberação); teste do PDF com `?de=plano` |
| PM-PA11 | T11: teste das chaves da projeção de `planoDoPaciente`, do mural e da lista de compras (RN-240, CS-232) |
| PM-PA12 | T11: `FonteDoContexto` ganha `lista_substituicao`; `relerTrechos` relê a cópia do plano publicado; testes da prioridade e da máscara |
| PM-PA13 | Antes do PR: §5 de `sessoes-paralelas.md` (regenerar migrations), §6 (só acrescentar), E2E escalonado com as outras sessões |
| PM-PA14 | T12: RN-01, RN-02, RN-12, RN-13 e INT-04 com versão nova na spec do MVP; RN-116/RN-126 com a nota do filtro por fonte na spec da IA; manual técnico §4.3, §4.4, §4.6 e cap. 05; manual do usuário (Docs), manual guiado (passos novos no editor) e Central de Ajuda; backlog PD-20 a PD-28 (carga da TBCA pendente da autorização) |

---

## 16. Critérios de aceite do plano

O Plano 19 está pronto quando, na branch, com a suíte verde (`pnpm test`, `pnpm test:tempo`, `pnpm lint`,
`pnpm typecheck`, E2E):

1. **Fontes:** a busca traz TACO, USDA (com selo, nome traduzido e original) e meus alimentos, na ordem da RN-230; os
   alimentos públicos não são editáveis; o filtro de fonte não mostra TBCA; a guarda da RN-232 quebra se uma migration
   inserir `tbca`; a IA da nutricionista não recebe USDA (teste das ferramentas).
2. **Seed USDA:** hash dos arquivos de origem conferido; nenhum nome com marca (teste); toda chave de `micros` está no
   catálogo; nenhuma linha fora das faixas; relatório de exclusões no repositório; `busca.tempo.test.ts` dentro do
   CS-231.
3. **Micros:** editor, PDF e publicação somam os micros pela RN-236; a publicação congela fonte, versão, micros e o
   perfil; plano publicado antes do deploy abre sem erro com "Micronutrientes não registrados nesta versão do plano.";
   nenhum micro chega ao app (CS-232).
4. **Perfis:** fonte obrigatória; nada pré-carregado; excluir perfil anula o rascunho e não muda o publicado.
5. **Busca:** abas Lista, Nutrientes e Equivalentes com o critério escrito e "Sugestão: confira antes de usar.";
   equivalente vira substituição do item; "Ver nutrientes" e "Cadastrar meu alimento" funcionam; `/painel/alimentos`
   continua igual.
6. **Texto livre:** publicar sem VET mostra o aviso e publica; refeição sem texto é recusada; troca de modo converte
   com confirmação; app, PDF e exportação mostram o texto; a IA Nutri recebe o texto mascarado.
7. **Dias:** editor filtra e mostra a legenda; Hoje, Plano, próxima refeição, "Comi assim", lista de compras, PDF e IA
   Nutri respeitam o dia no fuso do consultório (CS-233); depois do merge do 17, os lembretes também.
8. **Minhas refeições e listas:** salvar sem observação por padrão, com o aviso; carregar com ids novos; biblioteca
   `staff_only` (o paciente não lê, teste de isolamento); excluir alimento em uso dá a mensagem nova.
9. **Ligado ao plano:** a lista entra como cópia e não muda com a biblioteca; o paciente vê lista e conteúdos só do
   publicado; o conteúdo fora da audiência abre (texto e PDF) só pelo plano e não conta visualização; "Editar",
   "Salvar como modelo" e "Usar modelo" copiam tudo da RN-256.
10. **Guardas:** `rls-guard`, `audit-guard` e `test/isolamento.test.ts` com as tabelas novas (`STAFF_ONLY`,
    `CONTEUDO_POR_AUDIENCIA`, `FABRICAS`, `COM_MAE`, `SO_APAGA.patients`); auditoria das duas tabelas com `patient_id`.
11. **LGPD:** exportação com os campos da RN-257 nos dois escopos; nada de texto livre, observação ou valor de nutriente
    em log.
12. **Documentos:** RN e INT revistas, manuais e Central de Ajuda atualizados, backlog conciliado (PM-PA14).

---

## 17. Referências

- Proposta aprovada: `/home/deploy/servidor/projetos/.sessoes/proposta-plano-19.json` (brief, crítica de completude,
  normas, levantamento do código), 16/11/2026.
- Código conferido (`main` 5482450): `src/db/schema/{alimentos,plano-alimentar,conteudo}.ts`,
  `src/modules/alimentos/{taco,busca,alimentos,grupos}.ts`, `src/modules/plano-alimentar/{calculo,constantes,tipos,carregar,rascunho,publicacao,modelos,plano-pdf}.ts(x)`,
  `src/modules/portal/{plano,mural,diario,lista-compras,conteudos}.ts`, `src/modules/conteudo/audiencia.ts`,
  `src/modules/ia/{ferramentas-alimentos,resumo-dados,rascunho-dados,campos-enviados}.ts`,
  `src/modules/ia/nutri-paciente/{contexto,textos}.ts`, `src/modules/pacientes/{exportacao-job,lgpd}.ts`,
  `src/app/painel/alimentos/busca-alimento.tsx`, `src/app/painel/planos/editor/editor-plano.tsx`,
  `src/app/painel/configuracoes/page.tsx`, `drizzle/0040`, `0045`, `0083`, `0085`.
- Plano 17 (branch `plano-17-lembretes-rotina`): spec `2026-11-13-nutridebby-lembretes-de-rotina-design.md` e plano
  `2026-11-13-nutridebby-17-lembretes-rotina.md` (`planoDoDia`, `maiorDiaDaSemana`, `DiaDaSemana`).
- `docs/operacao/sessoes-paralelas.md` (branch `docs/sessoes-paralelas`), §2, §5 e §6.
- TBCA, termos v7.3/2025: https://www.tbca.net.br/ (conferido em 16/11/2026).
- USDA FoodData Central (CC0; citação pedida): https://fdc.nal.usda.gov/ e http://fdc.nal.usda.gov/api-guide/ (16/11/2026).
- National Academies, termos de uso (DRI): https://www.nationalacademies.org/terms-of-use (16/11/2026).
- ANVISA, IN 75/2020, arts. 1º e 3º (VDR para rotulagem; valores do Anexo II a conferir).
- Lei 9.610/1998, arts. 7º, XIII e § 2º; 8º, I e IV; 87.
- Res. CFN 594/2017 (art. 3º, VI, "b"; art. 4º, § 1º, VIII), 599/2018 (arts. 37, 38, 60, III, 82), 600/2018
  (glossário LVIII, LXI, LXX); Res. CFN 856/2026 (arts. 35, 53, 74, III e parágrafo único, 94; fonte não oficial,
  LegisWeb).
- LGPD (Lei 13.709/2018), arts. 5º, I; 6º, III; 11, II, "f"; 18, II e V.

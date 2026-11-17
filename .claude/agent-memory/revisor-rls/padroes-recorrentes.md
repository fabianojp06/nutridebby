---
name: padroes-recorrentes
description: Tipos de erro de banco/LGPD que se repetem nas specs e planos do NutriDebby e onde costumam aparecer (conferir em toda revisão)
metadata:
  type: project
---

Padrões vistos (revisão do Plano 11, IA e laudos, 06/10/2026):

- Gatilho "só o worker apaga/altera" confiando só em `app.role = 'worker'`: esse papel também roda no processo web
  (agendamento público, webhook do WhatsApp, link de documento, acesso do portal). Conferir se a guarda deveria exigir
  o estado do registro (ex.: paciente com `anonimizado_em` na mesma transação), como faz `app_anonimizar_aceites` (0065).
- Saída de dado para provedor externo: transmissão antes da marca de envio (ex.: contagem de tokens com o arquivo) e
  reconferência das pré-condições fora de transação/trava (janela entre checar e enviar). Conferir onde o dado sai de fato.
- Rótulo de auditoria no `criar` afirmando algo que só acontece depois no worker (ator nulo, filtrado da tela);
  exportação do titular sem o campo que prova o compartilhamento.
- "Ciência por e-mail" registrada no aceite do provedor de e-mail (sem tratamento de bounce) apresentada como "entregue".

- Caminho de exclusão que passa a tocar contador global/cota (ex.: excluirExame → cancelarTarefas → estorno) inverte a
  ordem de travas documentada (exame depois do tenant/plataforma). Conferir se o paciente `FOR UPDATE` no início serializa
  com o worker/app; se algum fluxo não travar o paciente primeiro, vira deadlock.

- "Trava e ignora": a função trava a linha (ex.: tenant `FOR UPDATE`, D16) mas decide o estado com a cópia que o chamador
  leu antes da transação (ex.: `estadoIaDoTenant(tenant)` no pedido da IA, T10 do Plano 11). Conferir se a decisão usa a
  linha travada; corrida típica com desativar/bloquear/suspender, que mudam essa linha.

- "Reconfere antes de gravar" sem trava: a gravação final do worker trava só a própria linha (tarefa FOR UPDATE) e relê
  paciente/tenant sem FOR SHARE; o cancelamento concorrente filtra por status visível (`IN ('na_fila','pronta')`) e
  PULA a linha 'processando' sem esperar → o resultado sobrevive à recusa/desativação (T11 do Plano 11, passo 6).
  Conferir: a gravação trava paciente → exame → tenant antes da linha, como o portão.

- `SELECT … FROM tenants FOR UPDATE` depois do paciente FOR UPDATE: conflita com o FOR KEY SHARE das FKs `tenant_id`
  (insert do portal em access_events/diary: tenant KEY SHARE → espera o paciente) → deadlock novo. Sugerir
  `FOR NO KEY UPDATE` no tenant (T15 do Plano 11, padrão também em cota.ts/exames.ts).

- FK `audit_log.tenant_id` → tenants: TODA escrita auditada pede FOR KEY SHARE no tenant. Quem trava uma linha (tarefa,
  exame) ANTES do tenant e depois grava (passo 1 do job, varredura, descarte sem trava do paciente) fecha ciclo com quem
  trava tenant `FOR UPDATE` e depois essa linha (cancelarTarefas, SET NULL do DELETE). Revisões por tarefa dizem
  "sem ciclo" olhando só as travas explícitas — sempre somar o KEY SHARE implícito das FKs (revisão final Plano 11).

- Docs de fechamento (Plano 11, 07/10/2026): afirmação "a coluna X preserva a data (coalesce)" conferida só no caminho que
  grava, sem procurar quem ZERA a coluna (ex.: `desativarIa` põe `ia_ativada_em` = null → a "primeira ativação" se perde).
  Conferir sempre todos os `set({ coluna: null })` antes de aceitar "fica"/"nunca volta a nulo". Também: descrição de
  gatilho em prosa mais forte que o SQL (ex.: "não troca o canal" quando o gatilho só barra NEW.canal = 'email').

Plano 12 (exames enviados, revisão do plano 07/10/2026):
- CHECK de estado ("ponteiro só em 'recebido'") que impede uma transição que o papel não consegue completar: o paciente só
  muda `status` (gatilho), então recebido → cancelado com o ponteiro ainda setado viola o CHECK. Cruzar todo CHECK
  "coluna X só no status Y" com cada transição de cada papel (e com o que o gatilho deixa esse papel mudar).
- Tenant `FOR UPDATE` voltou (aviso agrupado no `registrar` do worker) — o padrão de KEY SHARE abaixo se repete a cada plano.
- Varredura/expiração que trava o registro (UPDATE) e depois INSERE em `notifications` (FK patients → KEY SHARE no
  paciente), sem travar o paciente antes: ciclo com aceite/recusa (paciente FOR UPDATE → registro FOR UPDATE).

Plano 12, T1 (banco, 07/10/2026):
- Gatilho de nascimento "para qualquer papel" que só fixa o estado inicial ainda deixa a equipe/worker criar o registro
  de origem do paciente (`enviado_por` livre). Conferir se o INSERT deveria ser só do papel dono da origem.
- Política de INSERT do paciente que não fixa `created_at`/`updated_at` quando limites, expiração ou métricas contam por
  essas colunas. Sugerir forçar `now()` no gatilho para o papel paciente.
- Antes de aceitar uma migration, conferir que o `when` do `_journal.json` é crescente (o Drizzle pula a migration se não for).

Plano 12, revisão final do branch (07/10/2026):
- FK `ON DELETE SET NULL` (ou CASCADE) é trava implícita na FILHA: apagar a mãe (exams) depois de travar o tenant
  (cancelarTarefas) espera a linha-filha travada por quem trava filha → tenant (limpeza de arquivos). Somar o RI action às
  travas explícitas, não só o KEY SHARE.
- Tela/função de leitura que devolve arquivos sem filtrar a situação (cancelado/processando/falhou) "porque o worker já vai
  apagar": conferir que a leitura só devolve arquivo no estado vivo.
- Minors da revisão por tarefa que não chegam ao backlog: conferir na revisão final se os da lente banco foram registrados.

**Why:** são furos que nenhuma guarda de CI (rls-guard, audit-guard, isolamento) pega; só a leitura do fluxo.
**How to apply:** em spec/plano novo com worker, provedor externo, consentimento/aviso ou gatilho de integridade,
procurar esses quatro pontos primeiro. Ver também [[revisor-rls-escopo]].

Plano 12, revisão final (lente arquivos/worker, 07/10/2026):
- Função "abrir" do painel que devolve o ponteiro do arquivo sem filtrar pela situação: o arquivo que o paciente cancelou
  (ponteiro vivo até o job de limpeza) continua baixável. Conferir se abrir/servir exige a situação em que o arquivo é válido.
- Pasta excluída do backup com linhas no banco apontando para ela: conferir o que a restauração mostra (imagem quebrada, job
  que falha) e se o runbook diz isso.
- Antes de reportar, ler o backlog do plano (P1x-16..20) e a tabela de riscos: muitos Minors de worker já estão lá.

Plano 13 (parecer e retificação, revisão do plano 08/10/2026):
- Gatilho de INSERT que confere só a "coerência" da linha derivada (versão/retifica_id) sem exigir o estado inicial
  ('rascunho'): a regra que mora numa TRANSIÇÃO (motivo obrigatório no rascunho → preparando) é pulada inserindo a linha
  já 'preparando'/'assinado'. A desculpa "a fábrica do isolamento insere emitido direto" só vale para linhas SEM o campo
  de derivação. Conferir: toda regra exigida "no banco" numa transição também fecha o INSERT direto no estado final.
- Expand/contract: desde o P09-02 o worker NOVO espera a versão do schema (`esperarVersaoDoSchema`, src/worker/versao-schema.ts)
  — conferir isso antes de acusar 42703 de worker novo. O risco que sobra é o app/worker ANTIGO depois da migration e a
  volta atrás (§6.8.1): coluna nova que o código antigo ignora (ex.: flag de esconder dado) volta a mostrar o dado.

Plano 13, T1 (gatilhos da retificação, 08/10/2026):
- Gatilho que confere linha de OUTRA tabela sem trava (EXISTS na nota ao preparar; o gatilho da nota lê o status do
  documento sem FOR SHARE) → write skew entre duas requisições concorrentes. Conferir se um dos lados trava a linha comum.
- Invariante "uma versão em vigor" fechada só num sentido (INSERT/substituir), não na assinatura da versão nova: conferir
  se o banco exige o par (assinar v2 ⇒ v1 substituída) ou se depende do módulo.
- btrim/regex de "não só espaços" no SQL só com ASCII, enquanto o JS `trim()` tira espaço Unicode.

Plano 13, T3 (parecer, 08/10/2026):
- Teste "não grava auditoria" que chama a função com um paciente e consulta o audit_log filtrando OUTRO (vacuous). Conferir
  se o filtro do assert é o mesmo id da chamada. Também: bloco de UI estreitado por tipo que engole botões genéricos (Apagar).

Plano 13, T4 (PDF do parecer, 08/10/2026):
- Discriminador de regra de segurança lido do jsonb gravável (`conteudo.tipo`) em vez da coluna fixa pelo gatilho
  (`signed_documents.tipo`), com `return` cedo "fora da receita" = fail-open. Conferir de onde vem o tipo/estado que decide.

Plano 13, T7 (retificação, 08/10/2026):
- Teste de "herança/cópia" de campo (justificativa copiada para a versão nova) cuja fixture deixa o campo NULO na origem:
  passa sem provar nada. Conferir se a fixture preenche o que o título promete copiar.
- Regra que só mora no módulo novo (substituir a original ao assinar) + job criado pelo app novo e processado pelo WORKER
  ANTIGO na janela de deploy → estado que o banco não impede (duas versões em vigor). Cruzar com o expand/contract do cap. 06.
- Antes de dizer "sem ciclo", listar as FKs reais da tabela filha (receipts não tem FK para patients; audit_log só tenants).

Plano 13, revisão final do branch (08/10/2026):
- Helper de trava compartilhado (ex.: `travarDocumentoAntesDaCota`) com ordem "paciente → A → B → tenant" documentada, mas
  um dos chamadores (rota de envio) não trava o paciente antes e depois grava em `stored_files` (FK patients → KEY SHARE):
  ciclo com quem faz paciente FOR UPDATE → A. Conferir CADA chamador do helper, não só o helper.

Plano 16 (app do paciente G, revisão do plano 08/10/2026):
- Opção clínica guardada só como timestamp anulável (`*_em` = now() | null) + gatilho audit_row_change genérico ("alterar
  patients", sem colunas): desligar apaga quem/quando ligou e a trilha não distingue de uma troca de telefone. Sugerir
  recordAudit com entidade própria (molde `tentativa_assinatura` em ENTIDADE_ROTULO) na transação da troca.
- Cópia offline do portal (/p/plano, Cache Storage) ganhando dado derivado de outra fonte (ex.: "No diário" de respostasDeHoje)
  contra a regra "offline só o plano". Conferir o que a página guardada passa a ler.
- Runbook com SQL ad hoc cross-tenant em produção em tabela com RLS forçada: com nutri_app devolve 0/erro calado; precisa
  superuser (fora da regra 1). Molde aceito: função SECURITY DEFINER agregada por tenant (0087 admin_metricas_sucesso).
- Justificativa por analogia ("como as notas privadas") sem conferir o precedente: notas privadas não saem em NENHUM escopo
  da exportação (montarDados, staff_only), não "só na da equipe".
- Ao trocar FOR UPDATE por FOR NO KEY UPDATE (re-revisão do PR #27): conferir quem dependia do bloqueio do KEY SHARE (FK de
  receipts/notes) e os gatilhos com FOR SHARE (0105 app_documento_versao) — FOR SHARE e UPDATE de coluna comum ainda conflitam.

Plano 16, T1 (08/10/2026):
- SQL de CHECK no brief/plano com `col = 'valor'` em coluna anulável dentro de um OR: com a coluna nula o OR vira NULL e o CHECK
  PASSA. Conferir todo CHECK novo com coluna anulável (exigir `is not distinct from`/`coalesce`), não só o que o teste cobre.
- Coluna nova "do paciente" (resposta, rótulo copiado) sem gatilho de congelamento: equipe/worker podem reescrever; só auditado.

Plano 16, T7 (respostas no diário, 08/10/2026):
- Filtro de estado que mora SÓ no módulo (ex.: `status = 'publicado'`) ao lado de RLS que cobre parte dele (rascunho):
  teste com título "rascunho/arquivado" que não exercita o caso. Conferir se tirar a linha do filtro quebra algum teste.

Plano 16, T6 (mural, 08/10/2026):
- Helper exportado `*NaTransacao(tx, patientId, …)` cuja segurança depende do PAPEL do tx (RLS de `contents` só aplica
  audiência na sessão de paciente): num tx de equipe devolve tudo. Conferir se o helper exige a sessão ou só o chamador.
- Dado com caminho de arquivo cru (`foto.caminho`) atravessando a camada de módulo até a página: conferir na tarefa da tela
  que vira `signFileUrl` no servidor e não vai cru para componente cliente.

Plano 16, T14 (manual guiado do portal, 08/10/2026):
- Exceção da regra 1 (tabela `user`) estendida a um papel novo (paciente) no CLAUDE.md, mas o docstring do módulo
  (preferencias.ts: "userId vem sempre de requireNutri") fica velho. Conferir o comentário-contrato do módulo, não só o CLAUDE.md.
- Página que soma consultas ao `Promise.all` (Hoje: 5 em paralelo) contra pool `max: 10`: cada uma pega uma conexão.

Plano 14 (spec v0.5 da IA, autorização do paciente, 08/10/2026):
- Tabela "só inclusão" posta em `SO_INSERE` mas que precisa de UPDATE (anular ponteiro de arquivo, IP na anonimização):
  `SO_INSERE` pula os testes de UPDATE cross-tenant. Conferir REVOKE UPDATE × UPDATE de que o fluxo precisa.
- "CHECK … no INSERT" não existe (CHECK vale no UPDATE): ponteiro anulado por apagarArquivo/anonimização viola. Vai para gatilho.
- Gatilho que libera a anonimização "com o titular anonimizado", mas a função roda ANTES do UPDATE de `anonimizado_em`
  (molde 0065: `bloqueado` e `anonimizado_em` nulo). Conferir em que ponto do lgpd.ts a chamada acontece.
- "Último evento" (consentimento, situação) sem coluna de ordem definida, com data informada pelo usuário (papel) e
  `now()` de início de transação: exigir ordem monotônica gravada pelo banco (`clock_timestamp()` após a trava, ou identity).
- Arquivo de prova gravado por salvarArquivo: o paciente tem de ser travado em `antesDaReserva`, não no `registrar`.

Plano 16, revisão final do branch (08/10/2026):
- Revisão por tarefa que prova "só X lê o dado" com grep num caminho que não existe (src/app/portal em vez de src/app/p): o
  grep vazio parece prova. Conferir o caminho real das rotas antes de aceitar "nenhum outro módulo lê".
- Minor de vazão (Promise.all com N conexões contra pool max 10) apontado por tarefa e esquecido no backlog — repete o padrão
  "Minors que não chegam ao backlog".

Plano 14A, T1 (ia_autorizacoes, 09/10/2026):
- Função SECURITY DEFINER de soltura copiada de molde ("bloqueado OU anonimizado", exam_submissions) para dado cuja regra é
  "só na anonimização": `bloqueado` = todo o prazo de guarda (anos). Conferir se a condição exige o vencimento (anonimizar_apos).
- Tabela só-inclusão + anonimização por função que exige `anonimizado_em` nulo: INSERT posterior (link que "não vence")
  reintroduz IP/UA e nada mais tira. Conferir se o gatilho de INSERT recusa titular anonimizado.
- Ponteiro de arquivo com FK só por `caminho` (padrão do projeto): sem conferir patient_id/tipo/UNIQUE; com FK NO ACTION,
  caminho repetido em duas linhas trava a anonimização (23503 no apagarArquivo).
- Coluna "gravada junto da primeira saída" protegida só por `OLD.col IS NOT NULL`: pode ser carimbada depois em linha
  legada (saiu_em já gravado). Exigir também `OLD.saiu_em IS NULL` para mudar.

Plano 14A, T3 (provedor Bedrock, 09/10/2026):
- Pré-condição "sem chamada" do provedor (modelo fora do perfil, região errada) checada DENTRO de `lerDocumento`, depois
  do portão que já gravou `saiu_em` + auditoria "Laudo enviado à IA": registra transferência internacional que não houve.
  Alcançável na troca de provedor com tarefas `na_fila` (modelo gravado pelo app com a config antiga). Conferir que toda
  recusa local do provedor roda ANTES do portão (passo 2/3 do job), não só "sem chamada".
- SDK novo com env implícitas: ler o construtor do pacote no node_modules (não só o brief); o base do @anthropic-ai/sdk lê
  ANTHROPIC_CUSTOM_HEADERS mesmo com tudo explícito — só a recusa no env.ts do worker fecha.

Plano 14A, T4 (RN-100 com a autorização, 09/10/2026):
- Regra "cancela só o que foi pedido ANTES da retirada" (reautorização) implementada só no job assíncrono (`criadasAntesDe`),
  enquanto portão/gravação/aplicar/varredura olham só "a última decisão é vigente": retirada + reautorização antes do job, ou
  tarefa `processando` à espera de nova tentativa (429 limpa `enviado_em`; `cancelarTarefas` pula `processando`), sai/aplica.
  Conferir: toda regra temporal do job também mora nos pontos síncronos (comparar `criado_em` com a última retirada).
- Checagem de coluna "uma vez gravada não muda" (destino) feita com a cópia do passo 1, não com a linha no portão.

Plano 14A, T6 (link sem login da autorização, 09/10/2026):
- Consentimento em duas etapas (GET mostra o texto, POST grava) em que o POST grava versão/usos/destino da config do
  instante do POST: deploy no meio (troca de provedor, versão nova da 14B) grava prova de texto não lido. Exigir que o
  POST envie o que foi exibido e o módulo compare na transação (409). Vale para app, link e qualquer aceite versionado.

Plano 14A, T10 (legado congelado, 09/10/2026):
- Migration que só refaz gatilho para CONGELAR colunas que a versão anterior grava é contração de comportamento, mas o §6.8.1
  (volta atrás) só lista remover/renomear. Conferir se o fechamento registra que a imagem antiga quebra nesses caminhos.
- Comentário de "janela do deploy" que diz "o job antigo falha" sem ver ONDE falha: o envio externo vem antes do pós-envio.

Diagnóstico de relato do dono (envio de exame "não atualiza", 09/10/2026):
- Job assíncrono do worker (exame-envio) que recusa por regra (PDF > 10 páginas → falhou/paginas) aparece só como
  "Processando…" até o paciente recarregar (a tela não consulta de novo) e a nutri nunca vê envio `falhou`. Primeiro
  passo: `docker service logs nutri_worker | grep "exame enviado"` (só ids e motivo); sucesso NÃO loga. Sem consultar banco.
- Workflow que manda revisar outro assunto e diz que o pedido do dono "não é desta tarefa": o pedido do dono prevalece.

Plano 14A, revisão final do branch (09/10/2026):
- Repetiu "Minors que não chegam ao backlog": dos Minors de banco da T1, o teste cross-tenant das funções SECURITY DEFINER e o
  EXISTS sem trava ficaram fora da P14A-15. Conferir item a item contra review-task-*-b.md, não só pelo tema.
- Fábrica de isolamento numa tabela com política por canal/papel (ex.: canal 'nutricionista'): na sessão de paciente o negativo
  cai na regra de canal, não na de isolamento — o teste passa sem provar tenant/patient isolation. Pedir o negativo com o canal
  que o papel PODE usar.

- Polling de tela (router.refresh/fetch periódico) que relê leitura auditada: cada ciclo vira auditRead no Histórico de
  acessos. Padrão aceito: rota leve só de estado ({id,status}, sem auditRead, CONSULTA_AUTOMATICA) + refresh único na
  mudança. Conferir teto do polling × prazo real (job + cadência da varredura, não só o limiar dela) — hotfix 09/10/2026.

CI sem repetir no deploy (ci-ja-passou.sh, 09/10/2026):
- Guarda "o CI do head já passou" que escolhe a execução só por `head_sha`: o `pull_request` roda no merge do head com a
  base DAQUELE PR naquele instante (ci.yml sem filtro de branch → PR empilhado/outra base, fork com o mesmo commit). NÃO usar
  `pull_requests[]` da execução (vazio após o merge, ver abaixo): gravar número e base.sha no `run-name` do ci.yml. Migration de dados que recalcula
  prazo: o app ANTIGO segue gravando pela regra velha entre a migration e a troca — repetir o UPDATE idempotente depois.

- CI/deploy (09/10/2026): `workflow_runs[].pull_requests` da API do GitHub só lista PRs ABERTOS — depois do merge vem
  vazio (conferido em 30 execuções reais). Guarda de deploy que depende dele vira no-op; teste com gh falso não pega.
  Conferir a forma real da resposta da API (gh api, só leitura) antes de aceitar teste com mock.

Plano 15 (F3-02 IA Nutri do paciente, spec C v0.3 × código, 09/10/2026):
- Spec escrita ANTES de um plano posterior cita pré-condições já congeladas/trocadas (ciência/recusa do Plano 11 congeladas
  pela 0109; autorização = ia_autorizacoes 0107/0108) e um molde de consentimento próprio sem destino/canal/registrado_em.
  Conferir cada pré-condição e cada "tabela de prova" contra as migrations mais novas.
- "Função SECURITY DEFINER grava em tabela STAFF_ONLY/negada ao paciente": sob FORCE RLS e migrator sem BYPASSRLS, a função
  vê app.role='paciente'; precisa trocar para 'worker' localmente e devolver (molde 0075/0083). Specs omitem isso.
- "Política RESTRICTIVE por comando" prometida para limitar COLUNAS do UPDATE do paciente: RLS não compara OLD/NEW → gatilho.
- Limite por usuário contado em linhas que o próprio usuário apaga (revogar e aceitar de novo zera o dia/mês).
- Leitura "só do paciente X" no contexto worker: patient_isolation e paciente_sem_rascunho não valem; só o código isola.
- Mudar PK/UNIQUE de tabela usada em ON CONFLICT (ia_gasto_plataforma.mes) quebra o app antigo na janela do deploy.

Plano 15 (spec C v0.4 × código, 2ª revisão, 09/10/2026):
- Função SQL SECURITY DEFINER que "enfileira o job" ou confere "job vivo" (pgboss.job): o schema pgboss é do nutri_app
  (migrate.ts) e o migrator tem `INHERIT FALSE` → permissão negada em produção. O CI roda as migrations como SUPERUSUÁRIO
  (test/global-setup.ts) e passa. Enfileirar sempre em TS (`boss.send` com `fromDrizzle(tx)`) depois da função.
- `paciente_sem_rascunho` (0045) deixa a sessão de paciente ver plano ARQUIVADO; "só o publicado" mora no módulo
  (`planoDoPaciente`). Releitura por id na sessão de paciente não barra versão substituída. `lerPlanoNaTransacao` audita
  por padrão (`auditar !== false`).
- Duas tabelas com a MESMA entidade de auditoria + rótulo por (entidade, ação) em `rotuloDaAcao`: o `criar` de outra
  tabela (liberação pela nutri, resposta do worker) herda o rótulo da pergunta. Conferir entidade × tabela × ator.
- Revogação/retirada feita na sessão de paciente (ou função SQL) que "estorna": estorno é só por cota.ts no worker
  (molde: job ia-retirada da 14A). E o passo de gravação do worker precisa reconferir o consentimento (14A: passo 6).

Plano 14B-1, T3 (laço de ferramentas, 10/10/2026):
- Envelope de erro que leva o gasto (`ErroNoLaco`) só em volta da chamada ao provedor: exceção dos callbacks (busca no banco,
  `antesDaVolta`) escapa crua e o custo das voltas se perde. Conferir no job se o caminho genérico mantém a reserva (incerto).
- Índice que o modelo usa (medida) aceito além do que a ferramenta mostrou (slice(0,5)): conferir o limite nos dois lados.

Plano 14B-1, T4 (modelos sugeridos, 10/10/2026):
- Função de desativação que chama DOIS cancelamentos em sequência (cancelarTarefas → cancelarGeracoes): o 2º trava linhas
  DEPOIS do estorno do 1º (linha global do mês em ia_gasto_plataforma) → ciclo com a varredura da 2ª tabela, que trava a
  linha sem o tenant e estorna. Conferir a ordem "linhas → plataforma" em cada transação com mais de um grupo de estornos;
  trocar a ordem das chamadas só move o ciclo para a outra varredura. Correção: a varredura trava o tenant antes.

Plano 17 (lembretes de rotina, revisão do plano 16/11/2026):
- Tabela nova com gatilho "INSERT/UPDATE só o worker": as FABRICAS de test/isolamento.test.ts semeiam como `nutri` e o teste
  faz UPDATE no-op (`set tenant_id = tenant_id`) como nutri → beforeAll quebra. Gatilho que recusa mudar tenant/paciente com
  42501 próprio exige IMUTAVEIS. Mãe com FK CASCADE para filha nova → ULTIMAS (a ordem de exclusão é alfabética: a mãe
  `x` vem antes de `x_envios` e zera as linhas de B que o teste ainda conta). Fábrica COM_MAE não pode colidir com índice
  único parcial da fábrica da própria mãe.
- Chave nova no dados.json da exportação com nome já usado (`lembretes` = notificações de consulta). Conferir o tipo.
- "Marca gravada antes do envio" sem upsert condicional (WHERE ultimo < novo RETURNING): dois jobs sobrepostos (deploy com
  dois workers, job lento) mandam o mesmo push.
- Decisão de autonomia do titular ("a nutricionista não religa") só no módulo: gatilho 0085 volta cedo para quem não é paciente.

Plano 17, T1 (lembretes, 16/11/2026):
- Autonomia do titular guardada por gatilho de UPDATE numa coluna da linha (desligado_pelo_paciente_em) enquanto a equipe
  pode DELETE + INSERT a mesma linha: a recriação nasce "ligada" e contorna o gatilho. Conferir DELETE/INSERT, não só UPDATE.
- Exceção "worker/contexto vazio muda a marca do paciente (anonimização)" sem condição de estado: o worker roda também no web.
- Tabela "escrita só pelo worker" com gatilho de INSERT/UPDATE, mas DELETE deixado à RLS da equipe: apagar a marca de
  "já enviado" reabre o slot (push duplicado). Conferir os três comandos.

Plano 17, T3 (módulo da equipe, 16/11/2026):
- Teto/limite conferido só na escrita contra estado que muda por fora (plano republicado com mais refeições): a edição que
  só renomeia ou que reduz, mas não desce abaixo do teto, é recusada. Conferir se a regra compara "antes × depois" na edição.
- Interruptor que trava a linha com FOR UPDATE sem mudar chave: conflita à toa com o KEY SHARE da FK das marcas do worker
  (envios); FOR NO KEY UPDATE basta. Módulo bem feito no resto (trava do paciente, 23505 por nome, set() sem a marca).

Plano 17, T4 (job do worker, 16/11/2026):
- Marca do worker gravada com INSERT … VALUES a partir de uma leitura feita em OUTRA transação: não reconfere o estado
  (pausa, desligado, exclusão) e uma linha-mãe apagada no meio vira 23503 que aborta o lote do tenant inteiro. Sugerir
  INSERT … SELECT FROM a tabela-mãe com as condições (linha some = slot não sai). Teste de "suspenso" que suspende ANTES
  da leitura não cobre o getTenantStatus da marca — conferir se a reconferência tem teste próprio.

Plano 17, T6 (portal Eu › Lembretes, 17/11/2026):
- Entrada de navegação (seção de Eu, link) condicionada a "algum ATIVO" (`temLembretes` sem desligados pelo paciente): o
  titular que desliga tudo perde o único caminho para religar (dead end de autonomia), e o predicado veio do brief. Conferir
  se o predicado do link é o mesmo da LISTA da tela (o que ela mostra), não o do "ainda recebe aviso" (que serve ao cartão).
- Escrita do paciente por id sem o mesmo filtro da leitura (`ligado = true`): aba velha mexe em linha que a tela já não mostra.

Plano 17, T7 (LGPD dos lembretes, 17/11/2026):
- DELETE novo na exclusão atendida (linha que o worker referencia por FK → KEY SHARE na marca) posto ANTES de cancelarTarefas
  (tenant FOR NO KEY UPDATE), enquanto o worker segura tenant FOR SHARE (getTenantStatus aguardarSuspensao) e insere a marca:
  ciclo. Conferir onde o DELETE novo cai em relação à trava do tenant em atenderPedidoExclusao (mover para depois).

Plano 17, revisão final do branch (17/11/2026):
- Fechamento de plano com tabela nova SEM a anotação no CLAUDE.md (regras 2 e 8: listas, gatilhos, entidade de auditoria,
  exceção de papel em gatilho de `patients`); o manual só registrou como divergência. Conferir `git diff main -- CLAUDE.md`
  em toda revisão final e entregar o texto proposto.
- Limpeza LGPD nova (DELETE na exclusão/anonimização) que a imagem antiga não faz: na volta atrás (§6.8.1) o dado fica.
  Conferir se o fechamento registra isso, junto com o gatilho novo que a imagem antiga atravessa sem saber.

Plano 17, re-revisão do code review (17/11/2026):
- Coluna nova "técnica" em tabela de saúde já exportada: o dados.json (exportacao-job) lista colunas à mão e nenhuma guarda
  força a decisão. Conferir se a coluna guarda informação que não está em outra (ex.: a refeição do plano escolhida num
  registro 'Outro' sem resposta) — se sim, recomendar exportar (art. 19, II). Coluna nova sem CHECK de tamanho que a irmã tem.
Plano 18, T1 (registro de seções do Início, 17/11/2026): limpo na lente banco. Ponto de atenção para planos que penduram seção:
- Guarda de fonte "arquivo nunca chama auditRead" por regex do nome direto deixa passar helper que audita por padrão
  (`lerPlanoNaTransacao`, `lerDocumentoNaTransacao`, `auditar !== false`). Conferir os imports da seção nova, não só o grep.

Plano 18, PR 1 (registro de seções da ficha, 17/11/2026):
- Tipo marcado (`TxDePaciente`, brand com `unique symbol`) apresentado como garantia de contexto: qualquer módulo faz
  `tx as TxDePaciente`. Só vale com guarda de fonte do cast (só o arquivo dono). Conferir no PR que cria o dono.
- Mesma "última linha" lida em dois lugares com ORDER BY diferente (cabeçalho com `id desc`, seção sem): no empate, a tela
  mostra registros diferentes. Conferir desempate igual quando duas leituras dizem "a última".

Plano 18 (ficha, re-revisão do code review do PR 1, 17/11/2026):
- Guarda de "lista fechada de imports" (ex.: `IMPORTS_PERMITIDOS` de `ficha/registro.test.ts`) ampliada com o módulo
  inteiro (que exporta funções que auditam/escrevem) só para reaproveitar um filtro puro. A guarda textual
  (`auditRead|recordAudit`) não pega a chamada indireta. Sugerir mover o helper puro para um módulo sem efeitos
  (constantes/filtro) ou restringir os nomes importados.

Plano 20, T1 (Financeiro, 17/11/2026):
- Gatilho BEFORE ROW UPDATE que trava a mãe (paciente FOR KEY SHARE) "como defesa" roda DEPOIS da trava da própria linha:
  inverte a ordem paciente → linha se o módulo não travar o paciente antes; ciclo com a anonimização (paciente FOR UPDATE →
  linhas). Conferir em cada UPDATE do módulo que o paciente é travado primeiro.
- Marcador local (`set_config('app.x','1',true)`) é gravável por qualquer sessão: a condição extra que só mora na função
  (ex.: prazo `anonimizar_apos` vencido) não vale no gatilho. Conferir se o gatilho repete as pré-condições da função.
- Função SQL com `now()` do banco × módulo com `now` injetado (anonimizarVencidos): a função recusa onde o módulo aceita
  (testes com data fixa); avisar a tarefa que liga a chamada.
Plano 18, T5 (patient_cadastro, 17/11/2026): limpo na lente banco (política com_conta, gatilhos, listas, journal ok).
- Teste negativo de ESCRITA de política RESTRICTIVE nova na sessão de paciente é vácuo: `paciente_sem_*` (0070) já recusa
  antes. Só o SELECT prova a política; o WITH CHECK fica sem teste — pedir asserção em pg_policies se importar.
- Gatilho "só apaga com titular anonimizado" não cobre INSERT/UPDATE depois da anonimização: conferir a rede da varredura.

Plano 18, T7a (formulário do cadastro, 17/11/2026):
- `<select defaultValue>` num `<form action>` com `useActionState`, sem `key`: o React não re-sincroniza o defaultValue do
  select e o reset automático pós-ação volta à opção da montagem → a tela mostra o valor velho e o próximo "Salvar"
  reverte o gravado em silêncio. O projeto já usa `key` (consulta-form, alimento-form, regra-form). Conferir todo select
  novo em formulário de Server Action — testes de `renderToStaticMarkup` e de action não pegam.

Plano 18, T8 (lista de pacientes, 17/11/2026): limpo na lente banco (projeção, auditoria da etiqueta, ILIKE escapado,
invites com tenant explícito, action pelo withTenant).
- Função de leitura que ganha coluna nova (ex.: `nomeSocial` em `listarPacientes`) e um chamador antigo que passa o objeto
  INTEIRO a um componente 'use client' (agenda → ConsultaForm): o payload RSC leva a coluna ao navegador mesmo sem
  exibi-la. Procurar todos os chamadores e pedir projeção no limite servidor→cliente.

Plano 18, T9 (No app, semConta pela nutricionista, 17/11/2026): limpo na lente banco (papel nutri, helper não exportado,
cast só no dono, paridade com o portal testada contra as funções reais na sessão com login).
- Módulo da lista SEM_CONTA importando helper "puro" de um arquivo de UI que importa `../audit` (formatarDataHora de
  historico-acessos.tsx): a guarda textual não pega. Conferir o grafo de imports do arquivo dono, não só o texto.
- Paridade de audiência testada só no caso negativo (sem a etiqueta): pedir o positivo, que é o que quebraria em silêncio.

Plano 18, T10 (anonimização do cadastro, 17/11/2026):
- Em `anonimizarVencidos` há funções com pré-condição OPOSTA sobre `anonimizado_em`: as `app_anonimizar_*` (aceites, IA,
  financeiro do Plano 20) exigem nulo → ANTES do UPDATE de `patients`; os DELETE com gatilho `*_sem_apagar` (cadastro,
  exam_submissions, ia_nutri) exigem não nulo → DEPOIS. No rebase entre planos, conferir de que lado cada passo novo caiu.
Plano 18, T11 (nome social na máscara da IA, 17/11/2026): limpo na lente banco (projeção, worker fora da sessão sem login,
papel conferido por app_current_role, sem auditRead, espia de contextos no teste).
- Guarda de fonte que apaga a linha de `import` do schema antes de procurar o nome da tabela não pega import com alias
  (`{ tabela as t }` → `t.coluna`); regex de "quem importa X" com `(\.\.?)\/` não pega `../../`. Conferir alias e caminho.
- Helper exportado de leitura "só para a máscara" alcançável pela web sem guarda de quem importa: qualquer módulo pode
  reutilizá-lo para exibir o dado sem auditRead. Pedir lista fechada de importadores.
Plano 18, T12c (docs de fechamento, 17/11/2026): CLAUDE.md regras 2/8 e manual §2 batiam com 0124/0125 e o isolamento.
- Ao acrescentar frase a um parágrafo antigo do manual ("um sétimo arquivo"), a referência `arquivo:linhas` e a contagem
  ("só seis") da frase anterior ficam velhas. Conferir as refs do parágrafo inteiro, não só da frase nova.
Plano 18, revisão final do PR 2 (17/11/2026): limpo na lente banco (0124/0125, CPF sob advisory lock, nenhum 23514
alcançável — tamanho por code point = char_length —, auditRead só no Perfil, rede da anonimização, isolamento com ator).
- Repetiu "Minor da tarefa que não chega ao backlog": a projeção de `listarPacientes` no limite servidor→cliente
  (agenda/nova → ConsultaForm) apontada na T8 não entrou na seção de backlog do plano. Conferir item a item na final.

Plano 20, T3 (módulo do Financeiro, 17/11/2026):
- Conferência da linha-mãe sem trava (categoria lida sem FOR KEY SHARE) antes do INSERT da filha + DELETE/arquivamento da
  mãe com FOR UPDATE noutra transação: em READ COMMITTED quem perde é o INSERT (23503 na FK, sem tradução → erro genérico),
  não o DELETE — e o comentário costuma afirmar o contrário. Conferir: a conferência da mãe trava `FOR KEY SHARE` e relê
  o estado (arquivada) sob a trava.
- Testes de bloqueio concorrente que usam UPDATE simples de `status` (FOR NO KEY UPDATE) não conflitam com FOR KEY SHARE:
  a serialização só existe porque o bloqueio real (lgpd.ts) faz `carregarPacienteParaEscrita` (FOR UPDATE). Conferir o
  caminho real de quem muda a situação, não o helper do teste.

Plano 20, T7 (cobrança da consulta, 17/11/2026) — revisão limpa na lente banco; molde aceito para conferir em outras:
- Efeito colateral chamado DENTRO da transação de outro fluxo (presença → cobrança): a função relê a situação do paciente
  sob a própria trava (FOR KEY SHARE, que espera o FOR UPDATE do bloqueio real) e devolve um resultado, em vez de deixar o
  gatilho recusar com 42501 e derrubar o fluxo principal. Conferir sempre: (a) o bloqueio real usa FOR UPDATE (KEY SHARE
  não espera UPDATE simples); (b) nenhum throw residual (ex.: categoria ausente) no caminho chamado.
- Action de seção que recebe o id do registro pelo formulário (não por bind) ao lado do id da página: só RLS do tenant
  limita; costuma ser Minor (a usuária já pode agir no registro pela tela própria).

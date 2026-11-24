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

Plano 20, re-revisão do /code-review do PR 1 (17/11/2026):
- Ramo `worker` de gatilho de anonimização guardado só por marcador local (`app.<x>_anonimizando`): o marcador pode ser
  ligado à mão; o gatilho tem de reconferir o prazo/estado da função e fixar datas pelo relógio do banco. Depois de barrar
  o pago, conferir o inverso: o em aberto anonimizado SEM cancelamento ainda passa (fica pendente para sempre).

Plano 20 (testes de auditoria, 17/11/2026):
- Asserção "nada gravado"/"0 linhas" contada pelo `app.pool`/`app.db` FORA de `withTenant` em tabela com RLS (audit_log,
  fin_*): a RLS esconde tudo e a contagem volta 0 sempre. O `ownerDatabaseUrl` dos testes é o superusuário do Testcontainers
  (enxerga tudo). Conferir de qual pool vem cada `contar`/`leituras` e se há controle positivo com o mesmo helper.
  Achado: `configuracoes/actions.test.ts` (`contar` no app.pool para `fin_categorias`).

Plano 20, T9 (LGPD do Financeiro, 17/11/2026) — limpa na lente banco. Pontos a conferir em tarefas iguais:
- Chamada de função SQL de anonimização posta sob condição ("só se há linha") para contornar o `now` injetado dos testes:
  aceitável só se nenhuma linha pode nascer depois do bloqueio (gatilho de INSERT recusa bloqueado) — conferir isso.
- Limpeza LGPD nova chamada só pela imagem nova + função que exige `anonimizado_em` nulo: na volta atrás o texto fica e
  nada o tira depois. Pedir o registro no fechamento (§6.8.1).

Plano 20, revisão final do PR 2 (17/11/2026):
- GET de download que grava `exportar` em nome da sessão: cookie Lax vai junto em navegação de outro site e o HEAD
  automático do Next chama o GET. Conferir guarda `Sec-Fetch-Site` (same-origin/none) antes do módulo e HEAD 405.
- `onConflictDoNothing` + `return` cedo que pula efeito colateral (marca no tenant): idempotente demais — depois de uma
  volta atrás o reaceite não regrava e o usuário fica preso. Conferir o caminho "linha já existe" de todo aceite.

SUS-102 (gatilho de UPDATE em tenants, 23/11/2026): limpo na lente banco. Resíduos a lembrar em tabelas sem RLS guardadas por
gatilho de sessão: (1) "só a própria linha" para a `nutri` não fecha as colunas que só a admin deveria mudar (status, cotas
fora das da IA, contador de armazenamento para baixo) — conferir coluna a coluna quem é o dono; (2) liberação "só para cima"
de contador ainda deixa a sessão inflar o contador e esgotar a cota do consultório (DoS) — sugerir teto no gatilho.
- Re-revisão (23/11): o "só para cima/teto" do contador NÃO serve para a sessão que também devolve espaço (`apagarArquivo`
  na `nutri`) nem para a troca com `liberados` (passa a cota por um instante) — aceitar como resíduo Minor (cota própria,
  não isolamento). Teto do paciente replicado como literal no SQL: conferir que o teste compara com a constante TS.
TRI-17-20 Tarefa A (gatilhos dos lembretes, 23/11/2026): limpa na lente banco. Molde aceito e o resíduo a lembrar:
- Exceção "a cascata da mãe apaga a filha" por `pg_trigger_depth() > 1` (RI cascade = profundidade 2): aceita QUALQUER DELETE
  feito de dentro de outro gatilho. Defesa mais estreita: `NOT EXISTS` da mãe (já apagada no snapshot do gatilho). Minor.
- Paciente sem conta no banco = `app_current_user()` nulo (withTenant grava '' e assertContext recusa semConta com ator).

Limpeza Minor P17-P20, revisão final (23/11/2026):
- Gatilho novo que passa a recusar (42501) um INSERT/DELETE antes livre (criado_por = sessão, DELETE só worker/cascata):
  a tarefa roda só a pasta do módulo; conferir com grep os INSERTs/DELETEs da tabela em TODOS os testes e sementes
  (ficha/no-app, lgpd, exportacao, e2e-seed, carga) e na imagem antiga (expand/contract). Aqui estavam todos coerentes.
Plano 27, T1a (tabelas e RLS sem gatilhos, 23/11/2026): limpa na lente banco. A conferir em tarefas "fundação em fatias":
- Commit intermediário com `app_allow_paciente_escrita` e SEM o gatilho de colunas/transições (fica para a fatia seguinte):
  o paciente reescreve qualquer coluna da própria linha. Só aceitável se o PR sai inteiro; conferir antes do PR.
- FK de UNIQUE novo em tabela existente: o drizzle-kit cria o UNIQUE depois das FKs (42830) → FK só na custom (molde 0112).
Plano 23, T1a (Agenda 2, banco, 17/11/2026):
- Política RESTRICTIVE `FOR SELECT` usada para "o papel não grava o estado X" (aguardando_fora_do_publico): barra o UPDATE
  (linha nova conferida pelo SELECT) e o FOR UPDATE, mas NÃO o INSERT sem RETURNING — o `publico` insere a linha já no estado
  X (provado no dev com rollback). Conferir os três comandos; pedir FOR ALL (USING + WITH CHECK) ou política de INSERT própria.
Plano 23, T1b (gatilhos do pedido, 17/11/2026):
- Regra de NASCIMENTO decidida no BEFORE INSERT (chave → `solicitada`) com o papel que tem UPDATE amplo na própria linha
  (paciente em `appointments`: `app_allow_paciente_escrita(...,'update')`, sem gatilho de colunas desde a 0070): reabrir a
  cancelada (`cancelada → agendada`, provado no dev com ROLLBACK) ou mover o horário de uma agendada contorna a regra. Conferir
  sempre o que o papel já pode fazer por UPDATE nas linhas que NÃO estão no estado novo, não só as transições do estado novo.
- `tenants` sem RLS: gatilho "só a equipe muda a coluna" barra papel, não tenant — a sessão nutri de A muda a linha de B.
Plano 23, T1c (SECURITY DEFINER da agenda, 17/11/2026): sem Critical/Important; migrate-owner com dono NOBYPASSRLS ok.
- Gatilho que decide pela coluna `origem` que o próprio papel grava (cópia do link só com origem='paciente'): a sessão de
  paciente/publico manda origem 'nutri' e mantém o link do código. Conferir se o discriminador é gravável pelo papel guardado.
- Função SQL que toma a trava consultiva do tenant e depois a linha: o módulo que já fez FOR UPDATE da linha antes de chamá-la
  (concluir/confirmarCodigo do agendamento público) inverte a ordem tenant → linha. Conferir o chamador na tarefa que liga.
- Anonimização SECURITY DEFINER nova copiando o molde 0065/0108 (bloqueado + anonimizado_em nulo) sem o prazo vencido que a
  0123 já exige: apontar o molde mais novo.
Plano 23, revisão final do PR 1 (fundação, 17/11/2026): sem Critical/Important na lente banco.
- PR de fundação é o ALVO da volta atrás dos PRs seguintes (runbook): job da imagem dele que apaga/trata linhas sem conhecer
  o estado novo (limparPedidosPublicos apaga aguardando > 24 h pela criação) perde dado na volta. Conferir varreduras do worker.
- Backfill que desdobra linhas (regra "ambas" → par) contra teto do módulo da mesma imagem (MAX_REGRAS 30): a nutri trava.
SUS-100 (17/11/2026): teste de guarda com DDL (drop/create policy, drop trigger) em tabela real no banco compartilhado do
  Testcontainers segura AccessExclusive até o rollback → 40P01 com outro arquivo. Correção: clone por TEMPLATE
  (`test/ddl.ts`). Em teste novo com DDL em tabela real, exigir o banco próprio; o TEMPLATE não copia ACL/SET de banco.
Plano 23, re-revisão do /code-review do PR #59 (17/11/2026): os 5 itens resolvidos, sem quebra nova Critical/Important.
- Recorrentes que o /code-review pegou e a revisão por tarefa não: gatilho que deriva coluna da FK só no BEFORE INSERT (a FK
  trocada no UPDATE deixa o dado do pai antigo); "ocupado" em função SQL com lista de status ≠ recorte do EXCLUDE/TS e sem
  bloqueios; borda `<=` × `<` entre validade SQL e TS. Cruzar sempre com o EXCLUDE, o leitor TS e a borda do TS.
- Junção de linhas desdobradas por chave de horário (juntarPares) vale só enquanto o par não pode nascer: quando a tarefa
  seguinte liberar regras por local na mesma faixa, a junção e o "apaga a outra metade" passam a apagar regra legítima.

Plano 27, T1b (gatilhos de envio/recordatório/metas, 23/11/2026): limpa na lente banco. Resíduos a lembrar em gatilhos de transição:
- Coluna de data do evento (`cancelado_em`) deixada ao valor mandado enquanto a autora (`cancelado_por`) é conferida: data
  forjável e, se omitida, 23514 alcançável pela sessão (a linha vai ao log do Postgres). Sugerir `:= clock_timestamp()` no ramo.
- Teste de CHECK "que o gatilho já recusa" provado com `set local session_replication_role = replica` (dono): desliga também
  as FKs (RI são gatilhos) — só serve para CHECK; conferir que nenhum 23503 é provado por esse caminho.
Plano 27, T1c (isolamento, semente e endurecimentos, 23/11/2026): limpa na lente banco. Resíduos a lembrar:
- Endurecimento "42501 antes do CHECK" feito para um CHECK só (via/respostas nulas) deixa os irmãos alcançáveis pela mesma
  sessão (jsonb não objeto, tamanho): conferir todos os CHECKs da linha que o papel alcança, não só o que a revisão citou.
- Gatilho novo que olha `app_current_role()` acrescentado depois da spec: a lista "as N funções" para a guarda de outro plano
  (`FUNCOES_COM_PAPEL` do 26) fica velha no texto da spec/plano. Conferir a contagem nas seções de coordenação.
Plano 27, revisão final do PR 1 (fundação, 23/11/2026): limpa na lente banco (seis gatilhos, RLS, listas, Histórico, e2e-seed).
- Endurecimento "data do evento pelo relógio do banco" aplicado a um ramo (cancelado_em) e esquecido nos irmãos da mesma
  migration (metas_paciente.encerrada_em, questionario_envios.enviado_em no INSERT): conferir TODA coluna *_em de transição.
Plano 27, T1d (endurecimentos, 23/11/2026): limpa na lente banco. Resíduos a lembrar:
- "Congela o prontuário do bloqueado" posto só na mãe (recordatorios) e não na filha (itens: INSERT/UPDATE/DELETE livres à
  nutri): vale só porque o módulo sempre grava a mãe na mesma transação. Conferir mãe E filhas em todo congelamento.
- Termo da spec reusado com outro sentido no SQL ("meta terminada" = ativa com fim passado, editável, QP-D55 × encerrada).
- 42501 novo no ramo do worker (realinhar para consulta cancelada): o job futuro tem de tratá-lo no SAVEPOINT como o 23505.
Plano 27, T1f (itens congelados com o titular bloqueado, 23/11/2026): limpa na lente banco. Molde aceito para "congelar a filha":
- Gatilho próprio BEFORE INSERT OR UPDATE OR DELETE, só 'nutri', `RETURN OLD` no DELETE, titular `FOR KEY SHARE` pela
  (tenant_id, patient_id) da filha — válido só porque a FK composta da filha para a mãe inclui patient_id. Conferir a FK.
- Matcher de teste "do gatilho" = qualquer 42501 sem "row-level security": não distingue entre gatilhos irmãos; conferir que
  só um gatilho pode disparar no cenário (papel e colunas) antes de aceitar a prova.
Plano 27, T3 (envio do questionário, avisos, 24/11/2026): limpa na lente banco (paciente FOR UPDATE → envio → consulta KEY SHARE,
igual à agenda; e-mail e push na transação; auditRead só lista/abertura; seção e bloco sem conteúdo). Resíduos a lembrar:
- Helper de aviso exportado "para o worker da próxima tarefa" (`avisarEnvio`) sem reconferir situação/e-mail do titular: a
  guarda fica só no chamador. Conferir na tarefa do worker que ele trava e relê o paciente antes de chamar.
- Tipo novo de notificação/e-mail: na janela do deploy o worker ANTIGO pega o job (push → null/falhou; e-mail → throw + retry).
Plano 27, T4 (resposta pelo link e no app, 24/11/2026): limpo na lente banco (semConta só em link.ts, MAC com o e-mail
lido sob a trava, paciente KEY SHARE antes do UPDATE, gatilho fecha canal app/link por app_current_user, recordAudit nos
dois canais, filtro do Histórico exato). Pontos de atenção que se repetem:
- `catch` de 42501 num SAVEPOINT para traduzir a recusa do gatilho em estado de negócio também engole o 42501 do WITH CHECK
  da RLS: uma regressão de política vira "fechado" em silêncio. Pedir para conferir a origem (mensagem/código do gatilho).
- Função de "estado do registro" que devolve o estado terminal (respondido) ANTES de conferir titular/consultório: a ordem
  dos retornos decide qual texto o titular bloqueado vê. Conferir a ordem contra a lista de casos da spec.

Revisão do Plano 27 T5 (worker questionarios-automaticos, 24/11/2026):
- Job em fases "criar antes de manter" (QP-D52) com filtro de "aberto" que ignora envio de consulta cancelada (ENVIO_VISIVEL):
  a criação manda envio NOVO para a consulta remarcada antes de a manutenção levar o antigo para ela; a manutenção então
  cancela o antigo (e-mail duplicado, RN-535 anulada). Conferir se a fase 1 exclui o que a fase 2 vai mover, e se o teste
  da remarcação roda com o automático LIGADO e a nova dentro da janela.
- Manutenção em UMA transação com várias fases (d/e/b/c), cada mudança num SAVEPOINT: o SAVEPOINT liberado não solta a
  trava da linha. Com dois envios do mesmo titular mexidos em fases diferentes × um UPDATE único do bloqueio (RN-536) que
  trava as linhas noutra ordem → 40P01. Os testes "nenhum 40P01" só usam UM envio por titular.

Plano 27, T6 (cópia para a anamnese e LGPD do questionário, 24/11/2026):
- UPDATE novo em atenderPedidoExclusao posto "depois de cancelarTarefas" esquece que cancelarFuturasPelaExclusao (antes) já
  trava as consultas futuras FOR UPDATE; o worker que pega a linha com FOR UPDATE SKIP LOCKED e depois lê a consulta FOR KEY
  SHARE (gatilho e FK) espera → ciclo 40P01. SKIP LOCKED só na linha não basta: conferir cada trava que o gatilho/FK do worker
  pega DEPOIS e o que a exclusão já segura antes (ordem real: paciente → consultas → tenant → linhas).
Plano 27, revisão final do PR 2 (questionário, 24/11/2026): limpa na lente banco (semConta só em link.ts com MAC sob a trava,
SKIP LOCKED envio → consulta na manutenção, UPDATE da RN-536 depois de cancelarTarefas, auditRead nos pontos da spec).
- Repetiu "CLAUDE.md sem o contrato LGPD/travas do plano": a regra 8 ganhou só as leituras auditadas; a exclusão que cancela
  os abertos (ordem paciente → consultas → tenant → envios), a anonimização que não toca e a exportação ficaram só no manual.
- Varredura que cria registro e reconfere titular/consulta DEPOIS do INSERT sem trava na consulta (status muda com NO KEY
  UPDATE, que não espera o KEY SHARE da FK): o aviso sai para consulta cancelada no meio. Conferir o que o KEY SHARE NÃO barra.
Plano 27, T7b (metas na ficha, 24/11/2026): limpa na lente banco (escritas sob carregarPacienteParaEscrita, limite contado
sob a trava, bloqueio só `situacao` depois dos envios, auditRead só com metas, Início/No app sem auditRead). Resíduo a lembrar:
- Teste de paridade do "No app" escrito ANTES da função do portal compara o filtro exportado com ele mesmo (tautológico):
  conferir na tarefa do portal que o caso passou a chamar a função real (metasDeHoje/minhasMetas).
Plano 27, T8 (metas no portal, 24/11/2026): limpa na lente banco (titular KEY SHARE antes do INSERT, meta sem trava, dia do
banco, paridade do "No app" já com metasDeHoje). Resíduo:
- `INSERT … ON CONFLICT DO UPDATE` sem `setWhere … IS DISTINCT FROM`: o gatilho "UPDATE sem mudança passa" deixa passar,
  mas o `audit_row_change` grava um `alterar` a cada toque repetido (o audit não compara OLD/NEW). Conferir em todo upsert
  de tabela auditada feito pelo portal/carga.
Plano 27, revisão final do PR 3 (metas, 24/11/2026): limpa na lente banco (equipe FOR UPDATE → limite sob a trava com teste
concorrente real; portal titular KEY SHARE → meta sem trava → upsert com dia do banco; bloqueio só `situacao` depois dos
envios; auditRead só com metas; Início/No app sem auditRead; exportação dois escopos; CLAUDE.md com refs de linha certas).
- Resíduo a lembrar: equipe calcula "hoje" no TS (hojeNoFuso) para limite/faixa e o portal no banco (app_hoje_do_tenant):
  na virada do dia as duas telas podem divergir por segundos. Só vira defeito se uma regra de escrita depender dos dois.
Plano 27, T8d (guarda da virada do dia no registro de metas, 24/11/2026): limpa na lente banco (hoje da tela por bind,
mesmo now() do INSERT, recusa antes de gravar e depois do nao_encontrada; runbook só leitura, superusuário, só ids).
- "Dia que a tela leu" vindo de fonte diferente da leitura dos dados (TS `hojeNoFuso` antes da transação × registros por
  `app_hoje_do_tenant()`): na virada, recusa espúria por ms. Pedir que a página use o dia devolvido pela própria leitura.
Plano 23, T3 (local na consulta e nos horários, 23/11/2026): sem Critical; travas locais → regras → local FOR SHARE ok.
- Formulário de edição com `<select defaultValue>` de um id fora das opções (local arquivado some do seletor): o navegador e o
  React marcam a 1ª opção habilitada, e "Salvar" grava o registro no outro local/tipo sem escolha explícita. Conferir o
  valor inicial de todo seletor que filtra arquivados contra o valor gravado no registro editado.
- Gatilho de cópia pela `origem` (sala → link) também dispara no UPDATE da equipe: sobrescreve o valor que a nutri digitou
  numa linha nascida no portal. Conferir o gatilho de cópia nos caminhos de edição, não só no INSERT do papel alvo.
Plano 23, T4 (local fora do painel, 23/11/2026): sem Critical; módulos limpos (projeções, chaves, localRecusado, par início+local).
- Guarda por AST "select() sem colunas no publico" testada com script à parte (copiar as funções do teste e rodar com node +
  typescript do projeto): 7 falsos negativos — coluna da sala explícita (`select({ l: appointments.linkOnline })`), alias de
  import, `schema.appointments`, alias de `locaisAtendimento`, `.returning()` sem colunas no INSERT do publico (devolve a sala
  copiada pelo gatilho), `sql` cru e ctx publico numa const. Controle positivo só com os casos que a guarda já pega não prova
  nada sobre o resto: pedir no controle os casos de bypass, não só os acertos.
Plano 23, revisão final do PR 2 (locais e visões, 24/11/2026): sem Critical; projeções e sala limpas. Repetiram:
- Página GET que grava `exportar` no render (impressão) sem a guarda de origem que a main já usa (`navegacaoDaPropriaOrigem`,
  relatórios/imprimir e CSVs): spec escrita antes do molde. Em toda rota/página nova que grava no GET, procurar o molde na main.
- Impressão com filtro por paciente gravando `exportar` sem `patient_id` enquanto a main (RN-493, Ranking) grava um por titular.
- Runbook da volta atrás que lista só os efeitos de ESCRITA da imagem antiga: esquecer o que ela OFERECE e MOSTRA sobre o dado
  novo (horários de local sem agendamento/arquivado, endereço do Perfil nas mensagens, teto antigo de regras).
Plano 23, revisão final do PR 4 (filtros de local, AG-D79–D82, fechamento, 24/11/2026): sem Critical/Important na lente banco.
- Repetiu "runbook da volta atrás incompleto": o PR que se descreve como "só lê" também mudava o worker (AG-D81: sem aviso
  para horário passado, com `prazo_passado` no envio). A imagem anterior manda as notificações que a nova já criou contando
  com a recusa no envio. Conferir no diff do PR todo arquivo de worker/notificações antes de aceitar "só lê".
- Critério das opções do filtro ≠ critério do filtro (opção "arquivado com consulta" conta qualquer status; o filtro exclui
  cancelada/solicitada): opção que devolve lista vazia. Cruzar sempre o EXISTS das opções com o do filtro.
Plano 23, revisão final do PR 3 (pedidos, retorno, aniversário, 24/11/2026): sem Critical/Important na lente banco (ordem
trava consultiva do tenant → paciente → consulta coerente em portal/página/aceite/vencimento; exclusão sem a consultiva, sem ciclo).
- Discriminador lido de tabela de vida curta: `daPagina` (origem do pedido, link do "não confirmado") vem de
  `public_booking_requests`, que a limpeza apaga 24 h depois da criação enquanto a consulta `solicitada` dura dias. Conferir
  a retenção de toda tabela usada como "de onde veio" de um registro que vive mais que ela.
- Tipo novo de notificação com índice "uma por ano": na janela do deploy (ou na volta atrás) o worker antigo marca `falhou`
  (sem modelo) e a linha ocupa o balde do ano para sempre. Pedir o worker primeiro ou o tratamento no runbook.
- CLAUDE.md dizendo "semConta só para gravar" quando o módulo também lê com semConta no GET (estado do link): conferir verbo.
Plano 23, re-revisão escopada das correções do /code-review do PR 2 (24/11/2026): sem Critical/Important.
- Defesa no servidor mais larga que o gatilho que ela espelha (gatilho só age na troca de local; o código grava a sala
  sempre): sobrescreve, sem a nutricionista ver, um link antigo ≠ sala atual. Cruzar o "quando" do gatilho com o do código.
- Fallback "resolver pelo único candidato" (local do pedido sem local): conferir que o teste cobre o caso ambíguo (>1).
Plano 23, T6 (solicitada, vencimento, 23/11/2026): sem Critical/Important na lente banco (travas paciente → consulta, tenant
consultivo no começo do portal, RETURNING decide, vencimento por pedido com try/catch, gatilho conversa com o módulo).
- Teste de "ordem de travas sem 40P01" num fluxo embrulhado em `repetirSeDeadlock`: a ordem errada vira 40P01 → nova
  tentativa → o teste ainda pode passar (só pela mensagem/tempo). Pedir prova direta: numa 3ª conexão, `FOR UPDATE NOWAIT`
  no paciente enquanto o fluxo espera a trava do tenant (tem de conseguir).
- Guarda de texto de status (status-guarda) cobre `<>|not in|in` no SQL, mas não `!=` nem `=` cru, alias de tabela,
  `${'x'}` parametrizado nem `.includes(x.status)`: no SQL o typecheck não ajuda — pedir os bypass no controle positivo.
- Trava consultiva do tenant tomada "só pela ordem" (remarcação) sem a reconferência que justifica a trava
  (`app_pedidos_aguardando` sob ela): conferir se todo caminho que toma a trava faz a checagem que ela serializa.
Plano 23, T7 (pessoa nova pela página pública, 23/11/2026): sem Critical/Important; travas e-mail → tenant → pedido ok,
corrida provada com NOWAIT no paciente e o aceite sem máscara de 40P01.
- Interruptor lido no TS (decide o caminho) e relido pelo gatilho na MESMA transação, sem trava comum com quem o muda: no
  meio, os dois leem valores diferentes (aqui: cadastro novo com consulta `solicitada`). Pedir que a escrita do interruptor
  tome a mesma trava consultiva que o leitor segura (ou FOR SHARE na linha lida).
- Limpeza LGPD que só apaga depois de OUTRO job marcar o estado final (vencer → resolvido_em): a linha que nunca resolve
  (falha repetida) fica para sempre, contra a frase do ponto de coleta. Pedir a rede pela data do próprio dado.
- GET "só mostra" que chama função SECURITY DEFINER com trava consultiva do tenant + FOR UPDATE, sem limite por IP.
Plano 23, T9 (previsão de retorno e seção Consultas, 24/11/2026): sem Critical/Important na lente banco.
- Duas leituras do mesmo "sem consulta futura" com janelas diferentes (seção da ficha limitada à Lista de 12 meses ×
  marcador sem teto): com consulta só depois de 12 meses, a ficha diz "Retorno previsto" e a agenda não. Cruzar o predicado.
- Guarda de texto "a IA não cita a coluna X" não pega `select()` sem colunas (resumo-dados.ts lê a linha inteira de
  `consultations`): a coluna entra na memória do módulo da IA sem o nome no fonte. Pedir prova pelo payload montado.
- CHECK entre duas colunas editáveis (previsão × data) protegido só no módulo novo: na volta atrás, a imagem antiga edita
  a data sem conhecer a previsão → 23514 com a linha (orientações) no log do Postgres. Pedir registro no §6.8.1.
Plano 23, T10 (aniversariantes, 24/11/2026): sem Critical/Important na lente banco (semConta só no link, helper não
exportado, trava do paciente nos três canais, ON CONFLICT idêntico ao índice, anonimização com controle positivo).
- Índice "um por ano" com o ano em UTC (`timezone('UTC', agendada_para)`) × ano do consultório: a linha "sai agora" com
  `agendada_para = agora` à noite de 31/12 num fuso a oeste de -3 (Manaus, Rio Branco) cai no balde do ano seguinte e
  bloqueia a mensagem do ano que vem; a nova tentativa (agora + espera) também pode cruzar. Conferir todo valor gravado na
  coluna da expressão do índice, não só o agendamento das 9h. Correção barata: gravar o instante das 9h locais (já vencido).
- Frase do CLAUDE.md "semConta só para gravar X" enquanto o módulo também LÊ no semConta (GET da página do link): pedir o
  ajuste do texto no fechamento.
Plano 23, T11 (filtro de local em Pacientes e Financeiro, 24/11/2026): sem Critical na lente banco (exists com tenant
correlacionado, withTenant, uma transação nas telas, só id e nome dos locais, sem auditRead novo, exportar intacto).
- Opções de filtro copiadas da agenda ("ativos + o escolhido") em tela de HISTÓRICO (Financeiro, relatórios): o local
  arquivado com lançamentos some do select e a partição "locais + Sem local = total" quebra na tela, embora o teste de
  propriedade (só locais ativos) passe. Conferir se a fixture da propriedade arquiva algum item da partição.
- Filtro inválido "ignorado como os outros" num EXPORT (CSV): exporta tudo com o mesmo nome de arquivo. Conferir se o
  arquivo/registro diz o recorte e se valor inválido num ato deliberado não deveria recusar como o período.

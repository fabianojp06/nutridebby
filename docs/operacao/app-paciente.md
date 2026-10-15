# Runbook do dono — app do paciente no layout G (Plano 16)

Origem: seção "Runbook do dono" do plano
[`2026-10-08-nutridebby-16-app-paciente.md`](../superpowers/plans/2026-10-08-nutridebby-16-app-paciente.md), com as
decisões do dono de 08/10/2026 já aplicadas (o plano ainda as tratava como pendentes) e um ajuste de numeração: a função
agregada do CS-191 é o item **P16-18** do backlog (o P16-17 é a Tarefa 17, o `/admin` em abas). Spec:
[`2026-10-08-nutridebby-app-paciente-g-design.md`](../superpowers/specs/2026-10-08-nutridebby-app-paciente-g-design.md).
Manual técnico: [§5.5](../manual-tecnico/05-agenda-portal-conteudo.md#55-portal-do-paciente-p-plano-06-layout-g-no-plano-16)
(seções, mural, respostas, Jornada, "Não mostrar peso no app") e
[§6.8.1](../manual-tecnico/06-worker-seguranca-operacao.md#681-roteiro-de-volta-atrás) (voltar atrás).

Nenhum passo é do código; cada um tem dono. O layout entra **para todos** os pacientes no deploy (G-D11 = a), com o
aviso "O app mudou…" (ou as boas-vindas, para quem entra pela primeira vez, G-D17 = a) uma vez por conta.

**Sem SQL ad hoc em produção.** `diary_entries`, `meal_plans` e `patients` têm RLS forçada: com o `nutri_app` e sem
`app.tenant_id` uma consulta devolve 0 linhas (e seria lida como "meta não atingida"); com superusuário leria dado de saúde
de todos os consultórios, fora do modelo da regra 1 do `CLAUDE.md`. Toda medida passa por função agregada que devolve só
contagens (passo 6).

---

## Passos

- [ ] **1. Decisões do dono (respondidas em 08/10/2026).** Plano e desenho G verde aprovados, com as recomendações:
  G-D5 (c) "Desfazer" de 10 s só no aparelho; G-D6 (a) a opção esconde peso e IMC; G-D7 (a) escurecer só a cor da faixa;
  G-D8 (a) Conteúdos dentro de Plano; G-D9 (a) a seção Exames some sem recebimento e sem envio; G-D10 (a) a Debby revisa
  os textos antes do deploy (passo 2); G-D11 (a) para todos, com o tour; G-D12 e G-D15 (a) a meta do CS-191 e a medida só
  no consultório da Debby (passo 6); G-D13 (a) a seção das telas de detalhe dita pelo "Voltar para {seção}"; G-D14 (a)
  três linhas da §4.10 com 3 toques; G-D16 (a) com o peso oculto, nenhum gráfico de medida corporal em destaque; G-D17 (a)
  boas-vindas para quem entra pela primeira vez. **Continua aberta:** a D6 ★ — a opção de peso vai na exportação dos dois
  escopos até o parecer do advogado (E-09, pacote P12-23/P09-00); tirar da cópia do titular só depois do parecer e da
  decisão do dono.
- [ ] **2. Textos (G-D10).** A Debby lê, no ambiente de teste: o mural (refeição, comentário, exames, consulta, novidades e
  o rodapé "Seus registros do diário ficam visíveis para sua nutricionista…", que substitui o "Este app não envia
  mensagens…" da spec v0.1), a refeição aberta, a Jornada, a ajuda da caixa "Não mostrar peso no app", o texto de
  Privacidade (RN-214), "Você"/"Aviso do app", o rótulo do comentário com o registro, "Nada para agora…", "Para
  desfazer…", o aviso "O app mudou…" e as boas-vindas, os 5 passos do tour e as perguntas novas da ajuda do painel. Os
  textos estão na tabela "Textos de interface" do E5 da spec do MVP. Correção de texto = trocar a constante (e o teste que
  a cita) **antes** do merge; nenhum texto do sistema pode falar pela nutricionista (RN-194).
- [ ] **3. Teste no consultório (Debby, com dado fictício).** Com uma conta de paciente de teste no celular dela: abrir
  Hoje perto de uma refeição do plano (o mural mostra a refeição 90 min antes do horário), "Comi assim" e "Desfazer",
  "Comi outra coisa" com texto, "Mandar foto do prato"; conferir no painel o feed do diário ("Comeu como no plano");
  ligar "Não mostrar peso no app" na aba Evolução e conferir que o app não mostra peso nem IMC em lugar nenhum (Hoje,
  Jornada, Todas as medidas, Plano); desligar. Conferir no modo escuro e com a fonte do celular no máximo.
- [ ] **4. Antes do merge (merge = deploy).** Snapshot da VPS no hPanel; OK explícito do dono no PR; conferir no PR o job
  `image` (≤ 300 MB desde 15/10/2026; antes 265 MB) e o total de `woff2` impresso pelo `e2e/fontes-portal.spec.ts` (≤ 160 KB; na T2, ≈ 123,2 KB).
- [ ] **5. Depois do deploy.** O manifest do PWA não muda (`id`/`start_url` = `/p/inicio`): quem já instalou continua
  com o mesmo app; o service worker renova a cópia do plano pelo `x-nd-build`. Avisar os pacientes, se a Debby quiser, de
  que o app mudou (o próprio app mostra o aviso uma vez).
- [ ] **6. 4 semanas depois (CS-191, CS-192, PM-G11).**
  - **Definição do CS-191 (G-D12 = a, G-D15 = a):** paciente ativo, não anonimizado, com plano publicado no início da
    janela, que registrou **≥ 3 respostas** ("Comi assim", "Comi outra coisa" ou foto) **em cada uma das 4 semanas ISO**
    depois do deploy, no fuso do consultório. Meta: ≥ 50% desses pacientes. (A v0.1 contava quem chegou a 3 em
    **qualquer** semana — `filter (where s.n >= 3)` —, o que não é a meta.)
  - **Quem pode ser medido (G-D15 = a; LGPD art. 39; DPA `0.1-provisorio`, `src/modules/plataforma/dpa.ts`: a operadora
    trata os dados "segundo as instruções da controladora … nem usado para outra finalidade"):** até o DPA definitivo
    (E-09) ter uma cláusula de estatística de uso agregada, sem dado de saúde no resultado, medir **só no consultório da
    Debby**, com o pedido dela registrado como instrução da controladora.
  - **Antes de medir:** a função agregada do **P16-18** em produção — `SECURITY DEFINER` no molde de
    `drizzle/0087_metricas_sucesso_admin.sql` (`search_path` fixo, entra tenant a tenant com `set_config`, recusa rodar
    dentro de `withTenant`, devolve **só contagens** por tenant — `base` e `com_meta` —, nenhuma linha de saúde), com
    teste (duas semanas cheias e uma com 2 respostas). Ela **não** entrou no Plano 16.
  - **Medir:** o controlador, com o OK do dono, chama a função (só contagens); lê o acesso diário pela
    `admin_metricas_sucesso` (CS-192, "App na semana" na página da conta no `/admin`) e o crescimento de `audit_log`
    (uma abertura de Hoje grava até quatro "Visualizou": plano, diário, exames enviados e a antropometria da mini-jornada).
    A carga (`test/carga/cenario.js`, só no ambiente de carga do P08-03, nunca em produção) registra a p95 de `/p/inicio`
    e `/p/jornada` (meta 800 ms). Se o `audit_log` pesar, propor o agrupamento por dia (como `access_events`) num plano
    novo. **Nunca** SQL ad hoc nas tabelas de saúde; **nunca** medida entre consultórios sem a cláusula do DPA definitivo.
- [ ] **7. Voltar atrás (imagem anterior) depois do Plano 16.** A coluna `peso_oculto_no_app_em` continua no banco
  (migration `0106` só aditiva), mas o portal antigo **não a lê** e volta a mostrar peso e IMC aos pacientes com "Não
  mostrar peso no app" ligado — o dano que a opção existe para evitar. Antes de qualquer volta atrás, com o OK do dono:
  contar os pacientes com a opção ligada (pela função agregada ou pelo painel de cada nutricionista, nunca SQL ad hoc) e
  avisar as nutricionistas, ou **preferir corrigir para a frente**
  ([§6.8.1](../manual-tecnico/06-worker-seguranca-operacao.md#681-roteiro-de-volta-atrás), passo 5). Na janela
  start-first do deploy, a instância antiga ignora a opção por segundos (aceito). A imagem antiga também mostra cada "Comi
  assim" (sem texto nem foto) como um registro em branco no feed do diário e no registro aberto do painel (não conhece a
  coluna `resposta`): avisar as nutricionistas junto.
- [ ] **8. Backup no host (P02-11) — continua pendente.** Nada do Plano 16 muda o backup (`nutri-backup.sh` sem
  mudança), mas os dados reais dos pacientes só devem crescer com ele ligado.

---

## Riscos que ficam

| # | Risco | Onde está tratado | O que falta |
|---|---|---|---|
| R2 | O paciente toma o mural por chat ou lê o lembrete como orientação | RN-193 (rodapé), RN-194 (autoria no texto), textos com a Debby | Observar as primeiras semanas (a Debby diz se alguém respondeu "pelo app") |
| R3 | Paciente com o peso oculto descobre o número na exportação ou num documento | Texto genérico em Privacidade (RN-214); a ajuda da caixa avisa a nutricionista; D6 ★ | Decisão clínica dela; o advogado confirma na revisão do Termo (E-09) |
| R4 | `woff2` acima de 160 KB ou a imagem acima de 265 MB | Medidos na T2 e no CI | Se passar, o dono decide (sem apagar nada às cegas) |
| R5 | `audit_log` cresce com 3–4 "Visualizou" por abertura de Hoje | Uma linha por entidade (RN-200); medida na carga e no passo 6 | Agrupar por dia, se pesar (plano novo) |
| R6 | Resumo da refeição com nomes da TACO cheios de vírgulas | Texto com a Debby (G-D10) | Se confundir: separador "·" entre itens, em `resumoDaRefeicao` |
| R7 | "Comi assim" com foto e cota esgotada recusa tudo | Mesmo comportamento do diário (R9 do Plano 06) | Backlog, se a Debby quiser |
| R8 | A equipe pode alterar `resposta`/`texto` de um registro do diário | Fora do escopo da spec | Gatilho de imutabilidade (backlog, SBIS) |
| R9 | Fechar o app pelo gerenciador de tarefas dentro dos 10 s pode perder o envio | `keepalive` no `pagehide`, no `visibilitychange` e no desmontar (RN-198) | Aceito: o paciente vê o registro faltando e toca de novo; se a Debby preferir, "envia no toque" (`PRAZO_DESFAZER_MS = 0`) |

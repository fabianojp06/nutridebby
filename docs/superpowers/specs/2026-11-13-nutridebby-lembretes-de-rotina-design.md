# NutriDebby — Lembretes de rotina no app do paciente (design)

Data: 13/11/2026 · Situação: rascunho para aprovação do dono · Plano previsto: Plano 17

## 1. Intenção

A nutricionista (pedido da Debby) quer que o app do paciente avise ao longo do dia: beber água, hora das refeições e
outros hábitos do plano. Quem configura é a nutricionista, por paciente. O objetivo é **ajudar o paciente a cumprir o
plano no dia a dia** — não aumentar o uso do app por si só.

Sucesso: o paciente com notificações ativas recebe cada lembrete no minuto configurado (atraso típico < 1 min); a
nutricionista configura um paciente em menos de 2 minutos, sem redigitar os horários das refeições.

Isto **reabre de propósito** uma exclusão da spec do Plano 16 (§2.2: "lembrete por horário de refeição por push ou
WhatsApp"), que saiu por ser push novo e por custo de cota. Aqui é só push (sem custo) e não usa a cota do WhatsApp.

## 2. Metas, fora e anti-metas

**Metas**
- Lembretes de rotina por **push** (notificação no app/PWA), configurados pela nutricionista por paciente.
- Tipos: **Água**, **Refeições** (do plano publicado, com o pedido opcional de registro no diário), **Suplemento** e
  **Lembrete livre**.
- O paciente pode desligar cada lembrete ou pausar todos; não edita o que a nutricionista configurou.
- Página no portal com os lembretes do paciente (o detalhe que não vai para a tela de bloqueio aparece ali).

**Fora (agora)**
- WhatsApp e e-mail para lembretes de rotina (cota do WhatsApp e ruído na caixa de entrada).
- Lembrete da véspera da consulta ("envie os exames, preencha o diário") — o `lembrete_24h` já existe; fica para depois.
- Modelo de lembretes do consultório (padrão aplicado a todos os pacientes) — fica para depois; v1 traz sugestão
  pré-preenchida por paciente.
- Contar copos de água, marcar "bebi"/"comi", relatório de adesão.
- Notificação agendada no próprio aparelho (Notification Triggers / Periodic Background Sync): sem suporte confiável.

**Anti-metas (seria fracasso mesmo funcionando)**
- Lembrete de **pesagem** ou qualquer lembrete sobre peso/medidas (risco de transtorno alimentar; coerente com
  "Não mostrar peso no app", RN-203).
- Sequência ("streak"), medalha, ranking ou tom de cobrança/culpa ("Você esqueceu…").
- Texto montado pelo sistema que pareça orientação da nutricionista (C-197, RN-194, R-191).
- Dado de saúde na tela de bloqueio (nome de suplemento, texto livre da nutricionista).
- Lembrete fora de hora (madrugada) ou atrasado a ponto de perder sentido ("Hora do almoço" às 18h).

## 3. Restrições do projeto que pesam aqui

- **Push já existe** (`src/modules/notificacoes/push.ts`, só no worker; `push_subscriptions` por vínculo
  tenant × paciente; cartão "Ative as notificações" no Hoje; Eu › Notificações). No iPhone o push só chega com o app
  instalado na tela inicial (iOS 16.4+) — parte dos pacientes não receberá.
- **Motor de notificações atual** (`notifications`, varredura a cada minuto) envia no máximo `LOTE_POR_EXECUCAO = 40`
  por execução para a plataforma toda e grava uma linha por envio. Para rotina (água a cada 2 h × centenas de pacientes,
  todos às 12:00 no almoço) isso atrasaria minutos e faria a tabela crescer sem limpeza.
- `meals.horario` (time, opcional) já existe nas refeições do plano.
- Regras do CLAUDE.md: tabela com `tenant_id` → RLS + guardas do CI; com `patient_id` → `app_enable_patient_rls`,
  gatilho de auditoria (regra 8), `FABRICAS` do teste de isolamento; escrita do paciente → `PACIENTE_ESCREVE`.
- Textos de interface em pt-BR; push com texto neutro (padrão `AVISOS_DO_PORTAL`, `mensagens.ts`).
- Abas do prontuário: já são 12 e mal cabem a 1280 px (`abas.tsx`) — não cabe uma 13ª.

## 4. Abordagens consideradas

1. **Reusar `notifications` + varredura atual.** Um job cria as linhas do dia; a varredura envia. Ganha histórico e
   estados prontos. Perde: teto de 40/min (atraso no pico), crescimento de linhas sem retenção, mistura com o histórico de
   lembretes de consulta (tela da consulta, exportação `lembretes`).
2. **Motor próprio e leve (escolhida).** Tabela de configuração por paciente; job a cada minuto calcula o que vence
   naquele minuto e envia push em paralelo, reusando `ProvedorPush` e a limpeza de inscrições mortas. Guarda só a marca
   do último horário enviado por lembrete. Não cresce, não disputa o lote das consultas.
3. **Agendamento no aparelho.** Descartada: os navegadores não oferecem isso de forma confiável (Android nem iPhone).

O dono delegou a escolha ("seguirei suas recomendações", 13/11/2026). Escolha: **2**.

## 5. Design

### 5.1 Tipos de lembrete

| Tipo | A nutricionista define | Texto do push (tela de bloqueio) | Toque abre |
|---|---|---|---|
| Água | janela (início/fim), intervalo (1 h, 1h30, 2 h, 3 h, 4 h), dias da semana | "Hora de beber água 💧" | `/p/inicio` |
| Refeições | liga/desliga; aviso na hora ou 15/30 min antes; opcional "pedir registro no diário" 30/60 min depois | "Está chegando a hora: {nome da refeição}" / "Registre sua refeição no diário" | `/p/plano` (refeição) / `/p/diario` |
| Suplemento | nome (só no app), horários (até 4), dias | "Hora do seu suplemento" | página Lembretes |
| Livre | texto (até 120, só no app), horários (até 4), dias | "Você tem um lembrete do seu plano" | página Lembretes |

- **Refeições** não copiam horários: no envio, lê as refeições do plano **publicado** com `horario` preenchido.
  Republicar o plano muda os lembretes sozinho. Refeição sem horário não gera lembrete (o painel avisa quais).
  Sem plano publicado, nada sai.
- **Nome da refeição no push** (minha decisão): o nome é escrito pela nutricionista e costuma ser genérico ("Almoço");
  ajuda mais do que atrapalha. O revisor de normas confere; se vetar, cai para "Está chegando a hora da sua refeição".
- Título de todos os pushes: `'NutriDebby'`, fixo, como os outros avisos do portal (`mensagens.ts`).
- **Pedido de registro no diário** só sai se o paciente ainda não registrou aquela refeição no dia
  (`diary_entries.refeicao_do_plano`, Plano 16) — nada de cobrar quem já registrou.
- **Suplemento** (minha decisão): nome livre digitado pela nutricionista, sem vínculo com receita assinada (Plano 10A).
  O lembrete lembra uma orientação que ela já deu; não é prescrição nem a substitui. O texto fixo da página não diz
  dose. O revisor de normas (`normas-cfn-lgpd`) confere na revisão da tarefa; se exigir vínculo com a receita, volta ao
  dono.
- Voz: textos fixos são "Aviso do app". Na página Lembretes, nome do suplemento e texto livre aparecem como
  "Sua nutricionista: …" (escritos por ela, C-197).

### 5.2 Horários e limites

- Janela permitida para lembretes de rotina: **06:00 a 22:00** no fuso do consultório (minha decisão; o silêncio de
  21h–8h dos lembretes de consulta continua como está). A tela não deixa salvar fora dela; refeição com horário fora
  da janela não gera aviso.
- Máximo de **24 pushes por paciente por dia** somando tudo (minha decisão); avisos fundidos no mesmo minuto contam
  como 1. A tela mostra o total previsto e não deixa salvar acima do teto. Como as refeições vêm do plano, republicar
  pode passar do teto sem editar os lembretes: a publicação **não** é barrada; o worker corta no envio pela prioridade
  (refeição > suplemento > livre > diário > água), e a seção do painel mostra "Acima do limite de 24 por dia: alguns
  lembretes de água não serão enviados."
- Sem atraso: o slot que não saiu até **10 min** depois do horário (worker parado, por ex.) é **pulado**, não enviado
  atrasado. TTL do push: 30 min (aparelho desligado não recebe "hora do almoço" à tarde).
- **No máximo uma vez** por slot (como D6/INT-01): a marca do slot é gravada antes do envio; falha incerta não repete.
- Dois lembretes no mesmo minuto para o mesmo paciente saem como **um** push (texto do mais prioritário: refeição >
  suplemento > livre > água) — evita rajada.

### 5.3 Quem pode o quê

- **Nutricionista/equipe**: cria, edita, liga/desliga e apaga lembretes do paciente. Vê se o paciente tem notificações
  ativas em algum aparelho e se desligou algum lembrete ou pausou todos (com a data).
- **Paciente**: liga/desliga cada lembrete e "Pausar todos os lembretes" / "Retomar"; não altera horário nem texto.
  Lembrete desligado pelo paciente não é religado pela nutricionista (ela vê "Desligado pelo paciente em …"; editar não
  religa). Autonomia do titular.
- Lembretes só saem com: tenant ativo, paciente ativo e não anonimizado (RN-08), convite aceito, inscrição de push viva
  no vínculo, lembrete ligado pelas duas partes, sem pausa geral.
- Paciente com vários consultórios: cada vínculo tem os seus (como o push hoje).

### 5.4 Telas

**Painel** — seção "Lembretes no app" dentro da aba **Plano alimentar** do prontuário (não cabe aba nova; as
refeições já estão ali). Primeira vez: sugestão pré-preenchida (Água 08:00–20:00 a cada 2 h, dias úteis e fim de
semana; Refeições ligado, na hora; sem diário) que só vale depois de "Salvar". Aviso quando o paciente não tem
notificações ativas: "Este paciente ainda não ativou as notificações no app. Os lembretes começam quando ele ativar."

```
Lembretes no app                               [Notificações: ativas em 1 aparelho]
 ☑ Água          08:00–20:00 · a cada 2 h · todos os dias         [Editar]
 ☑ Refeições     na hora · pedir registro no diário 30 min depois  [Editar]
                 (Ceia sem horário — não gera lembrete)
 ☐ Suplemento    Vitamina D · 08:00 · seg a sex     Desligado pelo paciente em 12/11
 + Adicionar suplemento   + Adicionar lembrete livre
 Previsto para hoje: 11 lembretes
```

**Portal** — Eu › **Lembretes** (`/p/perfil/lembretes`): lista dos lembretes com horários, detalhe (nome do
suplemento, texto livre), interruptor por lembrete e "Pausar todos os lembretes". Sem notificações ativas neste
aparelho, mostra o botão de ativar (componente `AtivarNotificacoes` atual). O cartão "Ative as notificações" do Hoje
passa a citar os lembretes quando o paciente tiver algum ligado ("Ative as notificações para receber os lembretes da
sua nutricionista.").

### 5.5 Dados (esboço — nomes finais com o revisor de banco)

- Tabela nova `lembretes_rotina` (`tenant_id`, `patient_id`, `tipo`, `config` validada por tipo — janela, intervalo,
  horários, dias, antecedência, diário —, `texto` para suplemento/livre, `ligado` (equipe),
  `desligado_pelo_paciente_em`, carimbos). RLS de tenant + paciente; paciente lê as próprias linhas e só escreve
  `desligado_pelo_paciente_em` (`PACIENTE_ESCREVE` update + gatilho de colunas).
- **Marca do envio em tabela à parte** (ex.: `lembretes_rotina_envios`: lembrete, último slot enviado), uma linha por
  lembrete, atualizada no lugar, escrita só pelo worker, `STAFF_ONLY`. Fica **sem** gatilho de auditoria, com a entrada
  justificada em `AUDIT_EXCEPTIONS`, como `notifications` ("registro técnico de entrega; nenhum dado clínico"). Motivo:
  o gatilho `app_audit_row_change` grava uma linha de `audit_log` a cada UPDATE; com a marca na tabela auditada, cada
  push viraria uma linha de auditoria e o `audit_log` cresceria na escala que a §4 quis evitar.
- Pausa geral do paciente: coluna em `patients` (ex.: `lembretes_pausados_em`), liberada na lista de colunas do
  paciente (gatilho `paciente_colunas`, 0085).
- **Auditoria**: a configuração é parte da conduta (nome de suplemento, texto da nutricionista) → gatilho
  `app_enable_audit` (entidade `lembretes`, "Lembretes no app"). Só escritas da equipe e do paciente, poucas.
  Leituras seguem o padrão do plano alimentar.
- **Sem interruptor no consultório** (minha decisão): a função vai ao ar para todos, mas não faz nada até a
  nutricionista salvar lembretes de um paciente. Não há coluna em `tenants` nem tela no admin.
- **LGPD**: entra no `dados.json` da exportação (configuração, sem a marca de envio); as duas tabelas saem na
  anonimização.

### 5.6 Worker

- Cron `lembretes-rotina` a cada minuto (`America/Sao_Paulo` no agendamento; o cálculo usa o fuso de cada tenant).
- Por tenant ativo, em `withTenant` de contexto worker: seleciona lembretes ligados com slot vencido no minuto
  (tolerância de 10 min), grava a marca em `lembretes_rotina_envios` na transação, e envia fora dela com concorrência
  limitada (ex.: 10).
- Reusa `ProvedorPush` e a remoção de inscrição morta (404/410) do motor atual; não grava em `notifications`.
- Métrica mínima no log técnico (sem dado de saúde): quantos saíram/falharam por execução.

## 6. Decisões do dono

- Lembretes configurados pela nutricionista (pedido da Debby, 13/11/2026).
- Escolhas de abordagem e detalhes delegados a mim (13/11/2026: "pode seguir, seguirei suas recomendações").

## 7. Decisões minhas (o dono pode corrigir)

Só push · tipos Água/Refeições(+diário)/Suplemento/Livre · nome da refeição no push · janela 06:00–22:00 · teto de 24
por dia, cortado no envio por prioridade (sem barrar a publicação do plano) · pular slot com mais de 10 min de atraso
· um push por minuto por paciente · pedido do diário só se a refeição ainda não foi registrada · suplemento com nome
livre, sem vínculo com receita · paciente desliga/pausa mas não edita, e a nutricionista não religa · seção dentro da
aba Plano alimentar · sugestão pré-preenchida · sem interruptor no consultório · sem pesagem, sem contagem, sem streak
· auditoria da configuração, com a marca de envio em tabela à parte, fora da auditoria.

## 8. Fica com quem constrói

Nomes de tabela/colunas e formato de `config`; desenho exato do formulário (com o revisor de interface); textos finais
dos avisos dentro dos limites acima; tamanho do lote e concorrência do envio; testes (unidade do cálculo de slots com
fuso e dias da semana; isolamento/RLS; E2E do painel e do portal); entrada no manual técnico, no manual do usuário e
na Central de Ajuda no fechamento.

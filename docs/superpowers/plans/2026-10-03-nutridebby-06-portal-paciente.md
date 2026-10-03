# Plano 06 — Portal do paciente (M5): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O paciente entra no portal (`/p/…`), instala o PWA (Android com o prompt nativo, iPhone com o tutorial), ativa as notificações (push de teste "Notificações ativadas ✅"), vê o plano publicado — também sem internet —, baixa o PDF, registra o diário com foto (HEIC convertido no worker), recebe o comentário da nutricionista, vê a evolução e as orientações, gera a lista de compras, agenda/cancela/remarca/confirma consultas e exerce os direitos de titular (baixar os dados, pedir exclusão) — com o banco negando por padrão qualquer escrita da sessão de paciente fora do que o portal precisa.

**Architecture:** Um módulo novo, `src/modules/portal` (vínculos da conta, acesso diário, plano para o paciente, diário, comentários, evolução, lista de compras, pedidos do titular, inscrição de push), e a sessão de paciente em `src/lib/paciente-session.ts` (`requirePaciente`/`requireApiPaciente`, o par do `requireNutri`). A conta de paciente é global (sem `tenantId`); os vínculos (tenant, paciente) são lidos num contexto novo do banco, **`conta`**, que só enxerga em `patients` as linhas com `user_id` = a conta (política `paciente_por_conta`, só `SELECT`); o vínculo escolhido fica no cookie `nd_vinculo` e é reconferido a cada requisição. Antes de qualquer tela, a Tarefa 1 fecha o banco: toda tabela com `tenant_id` nasce com `paciente_sem_insert/update/delete` (RESTRICTIVE), liberadas só por `app_allow_paciente_escrita` + a lista `PACIENTE_ESCREVE` (guarda no CI) — o mesmo desenho do contexto `publico` do Plano 05. O PWA usa o Serwist já instalado (spike P01-15): `NetworkFirst` só para a página "Meu plano" (uma entrada em Cache Storage) e, sem rede, qualquer página do portal cai no plano guardado com o selo "Offline — exibindo última versão"; o "Sair" limpa o cache e cancela a inscrição de push do aparelho. Push de teste e de comentário saem pelo motor de notificações do Plano 05 (tipos novos, canal `push`). Foto do diário: o original (JPEG/PNG/HEIC ≤ 10 MB) é guardado por `salvarArquivo` e o worker (fila `diario-foto`) converte para JPEG ≤ 1600 px, qualidade 80, sem EXIF/GPS (`heic-decode` para HEIC, `sharp` para o resto) e apaga o original.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Route Handlers, Server Actions, `PageProps`/`RouteContext`, `cookies()` assíncrono) · React 19.2 · PostgreSQL 16 · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · Serwist 9.5.12 (`serwist`, `@serwist/turbopack` — já instalados) · `web-push` 3.6.7 (já instalado, só worker) · `sharp` 0.35.4 (já instalado) · **`heic-decode` 2.1.0** (novo, só worker; puxa `libheif-js` 1.23.2, WASM) · **`@axe-core/playwright` 4.13.0** (novo, dev) · Vitest 5 + Testcontainers · Playwright 1.63.

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.8: §3 perfil Paciente, §4.1 regras de acesso, §4.2 rota `/p/…`, §6 INT-03, §7 `diary_entries`/`access_events`/`push_subscriptions`/`stored_files`/`privacy_requests`, §8 RN-06, RN-07, RN-08, RN-13, RN-15, RN-18, §5 RNF-06, RNF-09, RNF-10, §11 P-14, P-16) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md) (US-040 a US-046; US-018, US-032, US-033, US-035 nas partes que o portal usa). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P06-00 a P06-11).

## Global Constraints

- Tudo dos Planos 01–05 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na entrada de toda página e Server Action da nutricionista e `requireApiNutri` nos Route Handlers dela; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500).
- **Base:** `main` em `f3d1a38` (Plano 05 em produção, migrations até `0069`). As migrations deste plano começam em `0070`; o número exato é o que o `drizzle-kit` gerar (se outra migration entrar na `main` antes, renumerar no rebase e corrigir as referências deste plano no PR).
- **Sessão de paciente (Tarefa 3):** toda página de `/p/…` (menos `/p/escolher`, `/p/sem-acesso` e `/p/termo`, que usam `requireUser`/`permitirTermoPendente`) e toda Server Action do portal começam com `requirePaciente(path)`; todo Route Handler de `/api/p/…`, com `requireApiPaciente(req)`. Os dois devolvem `{ data, tenant, vinculo, ctx }` com `ctx = { tenantId, role: 'paciente', patientId, actorUserId, ip }`. Nada no portal monta `TenantContext` à mão nem lê `tenantId`/`patientId` de formulário, URL ou corpo.
- **Escrita do paciente negada por padrão (Tarefa 1, D1):** `app_enable_tenant_rls` passa a criar também `paciente_sem_insert`, `paciente_sem_update` e `paciente_sem_delete` (RESTRICTIVE). Tabela que a sessão de paciente precisa gravar: `SELECT app_allow_paciente_escrita('<tabela>', '<comando>', …);` **e** entrada em `PACIENTE_ESCREVE` (`src/db/rls-guard.ts`), com o motivo; a guarda `findPacienteEscritaViolations` quebra o CI se as duas coisas não baterem. Lembrete: sem a política de `UPDATE`, `SELECT … FOR UPDATE/SHARE` de paciente não enxerga a linha (ela some do resultado).
- Toda tabela nova com `tenant_id`: depois de `pnpm db:generate`, migration custom `rls_<tabela>` com `SELECT app_enable_tenant_rls('<tabela>');`; com `patient_id`, também `SELECT app_enable_patient_rls('<tabela>');`; dado de saúde, também `SELECT app_enable_audit('<tabela>', '<entidade>');` + rótulo em `ENTIDADE_ROTULO`; entrada em `FABRICAS` de `test/isolamento.test.ts`. CLAUDE.md regras 1, 2, 8 e 9.
- **Uma conexão por transação** (Plano 05): dentro do callback de `withTenant`/`withConta` só o `tx` recebido; leituras que abrem outra transação (`vinculosDaConta`, `horariosParaPaciente`, `escolherHorario`, `buscarTenant`) acontecem antes e são revalidadas dentro.
- **Auditoria (RNF-08, D22):** leitura de dado de saúde pelo próprio paciente também chama `auditRead` (precedente: `orientacoesDoPaciente`, Plano 03), com o ator = a conta do paciente — o "Histórico de acessos" da nutricionista mostra "<nome> · Visualizou · Plano alimentar". `diary_entries` tem gatilho de auditoria (entidade `diario`); `access_events` e `push_subscriptions` ficam em `AUDIT_EXCEPTIONS` (não são dado de saúde).
- **Arquivos (CLAUDE.md regra 9):** só `salvarArquivo`/`apagarArquivo`; servir só por `signFileUrl` (5 min). A foto do diário entra com `patientId` (Tarefa 2: `stored_files.patient_id`); o original fica fora do alcance de `signFileUrl` até a conversão (o portal só assina `diary_entries.foto_path`, nunca `foto_original_path`). `heic-decode` e `sharp` da conversão só no worker: nenhuma rota importa `diario-foto-job.ts` (teste no grafo de imports).
- **PWA (D6):** Cache Storage guarda **só** o HTML de `/p/plano` (cache `nd-plano-v1`, 1 entrada, só resposta 200 não redirecionada da própria URL, gravada pelo service worker a pedido da página com o dono — conta + vínculo — e a versão); nenhuma resposta de `/api/…`, de foto ou de PDF vai para o cache; a cópia sai no login, na troca de dono e após 30 dias; `/sair` responde com `Clear-Site-Data: "cache", "storage"`, apaga o cookie `nd_vinculo`, e o botão "Sair" do portal apaga o cache e cancela a inscrição de push do aparelho antes de enviar o formulário.
- RNF-11 / CLAUDE.md regra 3: nada de texto do diário, comentário, nome, e-mail, endpoint ou chaves de push, conteúdo de foto ou caminho de arquivo em log/Sentry; logs só com ids, tipo, motivo e código de erro.
- Textos de interface em pt-BR, com o texto exato da spec quando existir: "Instalar app", "Compartilhar → Adicionar à Tela de Início", "Ativar notificações", "Notificações ativadas ✅", "Offline — exibindo última versão", "Plano", "Sua nutricionista ainda está preparando seu plano", "Baixar PDF", "Almoço", "Limite de 10 registros por dia atingido", "Envie uma foto JPEG, PNG ou HEIC de até 10 MB", "Espaço de armazenamento esgotado. Fale com o suporte.", "Diários", "Sua nutricionista comentou seu diário", "Evolução", "Mostrar % de gordura ao paciente", "Baixar meus dados", "Perfil > Privacidade", "Pedir exclusão dos meus dados", "Pedido de exclusão de <nome>", "Seu pedido foi registrado", "Esse horário acabou de ser ocupado. Escolha outro.", "Para alterar, fale com sua nutricionista.", "Conta temporariamente indisponível". Textos novos estão na tabela de desvios (última linha).
- Acessibilidade (RNF-10, padrão dos Planos 02–05): `<label for>`, `fieldset`/`legend`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso/estado com `role="status"`, alvo de toque ≥ 44 px no PWA, navegação do portal em `<nav aria-label="Portal">` com `aria-current="page"`; a Tarefa 13 roda o axe em todas as telas do PWA (WCAG 2.1 AA) e zero violação é critério de pronto.
- Compatibilidade (RNF-09): Chrome Android 10+ e Safari iOS 16.4+. Nada de API que o Safari 16.4 não tenha sem alternativa (`beforeinstallprompt` só no Chrome — o iPhone usa o tutorial; push no iOS só com o PWA instalado).
- Custo zero na assinatura: `heic-decode` (LGPL, WASM, gratuito), `@axe-core/playwright` (MPL, dev). Nenhum serviço novo. O orçamento da imagem no CI (P02-01a) precisa continuar verde (o WASM do `libheif-js` tem ~2 MB).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos (só nomes de variável). A variável nova do app (`VAPID_PUBLIC_KEY`, Tarefa 6) é configurada pelo dono no Easypanel no deploy. Merge = deploy, só com OK explícito do dono.
- Política de revisão por entrega (índice, revista em 02/10/2026): revisor por tarefa → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` com o checklist reforçado do fechamento. Se sobrar problema Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais — e o portal é o primeiro lugar em que o paciente grava dado de saúde.

### Decisões de desenho (tomadas neste plano — o dono confirma as marcadas com ★)

| # | Tema | Decisão (aplicada no plano) | Custo / consequência · se o dono escolher outra |
|---|---|---|---|
| D1 ★ | P-16 (a): escrita da sessão de paciente | **Negar por padrão no banco**, como o `publico` (D11 do Plano 05): `paciente_sem_insert/update/delete` (RESTRICTIVE) em toda tabela com `tenant_id`, inclusive as antigas (migration 0070) e as futuras (`app_enable_tenant_rls`); liberadas só por comando com `app_allow_paciente_escrita` + `PACIENTE_ESCREVE`. Hoje: `patients` (`update`), `appointments` (`insert`, `update`), `notifications` (`insert`, `update`), `audit_log` (`insert`); o plano acrescenta `stored_files` (`insert`), `push_subscriptions` (`insert`, `delete`), `access_events` (`insert`), `diary_entries` (`insert`), `privacy_requests` (`insert`), `data_exports` (`insert`, `update`). `foods`, `food_measures`, `anamnesis_templates` (o pedido do P-16) e todo o prontuário (antropometria, exames, planos, atendimentos…) ficam fechados | Cobre o P-16 (a) e qualquer tabela futura. Se o dono preferir o pedido literal do P-16 (só as três tabelas), a Tarefa 1 troca a função genérica por três `CREATE POLICY … RESTRICTIVE` e a guarda vira uma lista fixa — o resto do prontuário com `patient_id` continuaria gravável pela sessão do próprio paciente em caso de bug |
| D2 | Achar os vínculos da conta (conta de paciente sem `tenantId`, §3 "um mesmo usuário pode ser paciente de mais de um tenant") | Contexto novo **`conta`** no banco (`withConta(userId, fn)`, sem tenant): política `paciente_por_conta` em `patients`, **só `SELECT`**, `USING (app_current_role() = 'conta' AND user_id = app_current_user())`. Toda outra tabela continua com 0 linhas (sem `app.tenant_id`, `tenant_isolation` não casa) e nenhuma escrita passa. Só `src/modules/portal/vinculos.ts` usa (`vinculosDaConta`) | Uma consulta indexada por requisição (índice novo `patients_user_idx`). Alternativa descartada: função `SECURITY DEFINER` que percorre todos os tenants (N consultas por requisição) |
| D3 ★ | Mais de um vínculo | O vínculo escolhido fica no cookie `nd_vinculo` (só o `tenantId`, `httpOnly`, `SameSite=Lax`, 30 dias) e é **reconferido** contra `vinculosDaConta` a cada requisição; sem cookie válido e com 2+ vínculos → `/p/escolher` ("Com qual nutricionista você quer entrar?"); com 1 → entra direto; com 0 → `/p/sem-acesso`. Trocar em "Perfil" ("Trocar de nutricionista") | Se o dono preferir: sempre perguntar ao entrar (sem cookie) |
| D4 | P-16 (d): `stored_files` por paciente | Coluna `patient_id` (nula = arquivo do consultório: logo, capa) com FK composta para `patients`; política `paciente_arquivos` (RESTRICTIVE): a sessão de paciente vê e grava só linhas com o próprio `patient_id`, e lê as de `tipo in ('logo', 'capa')`. `salvarArquivo` ganha `patientId`; a migration preenche o `patient_id` dos laudos, PDFs de plano e exportações existentes (por tenant, `set_config`) | `stored_files` entra em `PATIENT_POLICY_EXCEPTIONS` (a política é a própria, não a `patient_isolation`, por causa dos arquivos do consultório) |
| D5 ★ | P-16 (c): auditoria das edições do rascunho visível ao paciente | O portal **não mostra** o "Histórico de acessos" no MVP (nenhuma história pede) e a exportação do titular não leva `audit_log` (como hoje): o item (c) não se aplica | Se o dono quiser o histórico no portal, ele vira item novo do backlog, e aí as linhas de `plano_alimentar` de planos em rascunho precisam ser filtradas |
| D6 ★ | Offline (US-040) | Só **"Meu plano"** fica offline: o service worker guarda o HTML de `/p/plano` (NetworkFirst, 4 s de espera pela rede, 1 entrada, só 200 não redirecionado) e, sem rede, qualquer navegação em `/p/…` recebe esse HTML; o selo "Offline — exibindo última versão" aparece quando `navigator.onLine` é falso ou o `ping` (`/api/p/ping`) falha. A cópia é gravada **a pedido da página "Meu plano"** (o menu é `next/link`, que não gera navegação `navigate`) e leva o **dono** (conta + vínculo) e a versão do plano: sai no "Sair" (`Clear-Site-Data` + `caches.delete`), na tela de login (sessão vencida, outra pessoa entrando), quando o portal abre com outro dono (troca de conta ou de nutricionista) e depois de 30 dias | O plano (dado de saúde) fica no aparelho enquanto a conta que o guardou é a última a usar o portal nele (sem rede, o aparelho não sabe quem está com ele). Se o dono não quiser dado de saúde em cache, o offline sai do escopo (desvio da US-040) |
| D7 | Push de teste e de comentário | Pelo motor de notificações do Plano 05: tipos novos `push_teste` e `comentario_diario` (canal `push`, sem consulta), varridos como os outros (no máximo uma vez, inscrições 404/410 apagadas, `sem_inscricao`/`push_desligado`). O app passa a ler `VAPID_PUBLIC_KEY` (opcional) para entregar a chave ao navegador | Reaproveita o envio já revisado; sem as variáveis do VAPID, "Ativar notificações" some ("Notificações no app ainda não estão disponíveis.") |
| D8 ★ | Texto do push do comentário | "Sua nutricionista comentou seu diário" (texto da US-043), sem o nome da nutricionista nem do paciente, como a decisão do dono de 02/10/2026 para os lembretes; o toque abre `/p/diario` | — |
| D9 | `access_events` (CS-02) e P06-11 | `POST /api/p/acesso`, chamado uma vez quando o portal abre (componente no layout), grava 1 linha por paciente por **dia no fuso do tenant** (`ON CONFLICT DO NOTHING`) e **reescreve o cookie de sessão** com `Max-Age` de 30 dias (o mesmo valor, nome e atributos do login) — o banco já desliza em `requireUser`; o cookie passa a deslizar junto | Fecha o P06-11 sem tocar no Better Auth |
| D10 ★ | HEIC (RN-07) | O `sharp` pré-compilado lê HEIF só com AV1 (AVIF), não HEVC (conferido: `sharp.format.heif` = `.avif`, sem `libde265`): HEIC do iPhone é decodificado com **`heic-decode@2.1.0`** (libheif em WASM) e entregue ao `sharp` como pixels crus. Só no worker | Patente do HEVC: risco jurídico baixo (decodificação, uso interno) mas a registrar; alternativa seria recusar HEIC (o Safari do iPhone já converte para JPEG no `<input type=file accept="image/jpeg,image/png">`) — desvio da RN-07 |
| D11 ★ | Editar/apagar registro do diário | **Não** no MVP: o paciente só cria (as histórias não pedem; evita "apagar o que a nutricionista comentou") | Se o dono quiser "Apagar registro" enquanto não comentado, vira item do backlog |
| D12 | Limite de 10 registros por dia (RN-07) | Conta registros (com ou sem foto) criados no **dia do fuso do tenant**; a corrida (dois envios ao mesmo tempo) é decidida com a linha do paciente travada (`FOR UPDATE`) antes de contar | — |
| D13 | Comentário da nutricionista (US-043) | Um comentário por registro (`comentario_nutri`, até 1000 caracteres), que ela pode corrigir; o push sai **só no primeiro comentário** (corrigir não manda outro); abrir o registro preenche `visto_pela_nutri_em` (uma vez) | Evita push repetido a cada correção |
| D14 | Evolução do paciente (US-044) | Só antropometria: peso, IMC e circunferências (gráficos com ≥ 2 pontos) + "% de gordura" **só** com `tenants.mostrar_perc_gordura_paciente` (opção nova em "Perfil e marca": "Mostrar % de gordura ao paciente"); dobras e densidade nunca; exames nunca; as orientações de cada atendimento (`orientacoesDoPaciente`) | — |
| D15 | Lista de compras (RN-13) | Calculada no servidor a partir do plano publicado (itens principais × dias, 1–14, padrão 7), agrupada pelo grupo do alimento; a marcação "comprado" fica no `localStorage` com a chave `nd-compras:<id do plano>` (plano novo = lista nova) | — |
| D16 ★ | Exportação pelo titular (US-046) | Mesmo job da US-018, com `data_exports.escopo = 'titular'`: sem notas privadas e etiquetas (já hoje), **sem planos em rascunho** (P-16 b) e com o diário (texto + fotos, no mesmo teto de 100 MB dos laudos); **1 pedido a cada 24 h** por paciente ("Você já pediu seus dados nas últimas 24 horas. O link chega por e-mail."); o link do e-mail abre `/p/meus-dados/exportacoes/<id>` (pede login de paciente). Os pedidos dos dois escopos **não se misturam**: o pendente reaproveitado (ou dado como perdido) e o "um ZIP válido" que apaga o anterior são por paciente **e escopo** (cada pedido tem o seu destinatário, link e conteúdo) | Protege o worker e o disco (o ZIP não é barrado pela cota). Sem o limite, o paciente pode pedir à vontade (o anterior é apagado quando o novo fica pronto) |
| D17 | Pedido de exclusão pelo paciente | `privacy_requests` `exclusao`/`aberto`, prazo = hoje + 15 dias no fuso do tenant, um aberto por vez (índice único parcial; pedir de novo mostra "Seu pedido de exclusão já foi registrado em dd/mm/aaaa."); e-mail "Seu pedido foi registrado" ao paciente; quadro "Pedidos do titular" no painel com "Pedido de exclusão de <nome>" (link para a aba Privacidade, onde o "Atender pedido de exclusão" do Plano 03 já conclui o pedido aberto) | Sem e-mail à nutricionista (a US-046 pede o quadro no painel) |
| D18 ★ | P06-08: conta `user` do titular anonimizado | Na anonimização (fim do prazo de guarda), se a conta não tiver **outro** vínculo não anonimizado (em qualquer tenant, `vinculosDaConta` com todos os status), nome → "Paciente anonimizado", e-mail → `anonimo-<id>@anonimizado.invalid`, sessões e senha (`account`) apagadas. Com outro vínculo, a conta fica (é de outro consultório também) | Desvio consciente do Plano 03 decidido pelo dono em 30/09/2026 |
| D19 | Agenda no PWA (P06-09) | Tela sobre as funções do Plano 05 (`horariosParaPaciente`, `agendarComoPaciente`, `remarcarComoPaciente`, `cancelarConsulta(por: 'paciente')`, `confirmarPresenca(via: 'link')`, `pedirRemarcacao`); "Minhas consultas": próximas + as 10 últimas; RN-06: a sigla do fuso aparece quando o fuso do aparelho é outro | `confirmada_via = 'link'` também para a confirmação pelo portal (o selo "Confirmada pelo link" vale para os dois) |
| D20 | Perfil | "Perfil": "Notificações" (ativar push; "Receber lembretes por WhatsApp" — desmarcar grava `whatsapp_optout_em`, marcar exige telefone no cadastro e grava opt-in de origem `paciente`), "Privacidade" (US-046), "Trocar de nutricionista" (com 2+ vínculos) e "Sair" | — |
| D21 ★ | Ícones do PWA | Ícones genéricos do NutriDebby (folha verde em fundo `#1d6b5a`) gerados por `scripts/gerar-icones.ts` (sharp, a partir de um SVG no repositório): 192, 512, 512 *maskable* e 180 (`apple-touch-icon`) | O dono pode trocar a arte depois (só o SVG muda) |
| D22 ★ | Auditoria da leitura feita pelo próprio paciente | Mantida (regra 8; precedente `orientacoesDoPaciente`): plano, evolução, orientações e diário lidos pelo paciente geram "Visualizou" com o ator = paciente | ~1 linha por página aberta. Se o dono preferir não auditar a leitura do próprio titular, as funções de portal passam `auditar: false` |
| D23 | Escopo de rotas do PWA | `/p/inicio` (início), `/p/plano`, `/p/diario`, `/p/evolucao`, `/p/compras`, `/p/agenda`, `/p/perfil`, `/p/meus-dados/exportacoes/[id]`, `/p/escolher`, `/p/sem-acesso`; a navegação é uma lista (`ITENS_DO_PORTAL` em `src/app/p/navegacao.ts`) para os planos seguintes acrescentarem "Conteúdos" (Plano 07) e, depois do MVP, "Exames"/"IA Nutri" sem mexer no layout | — |
| D24 | Aviso de plano novo (US-025, adiado do Plano 04) | Na publicação, na mesma transação: push "Seu novo plano alimentar está disponível" (tipo `plano_novo`, pelo motor) e e-mail com o mesmo assunto e o link de `/p/plano` — **só** para paciente `ativo` com conta no portal (`user_id`); sem conta, nada (o convite já leva ao portal) | Sem dado de saúde no texto |
| D25 | Novo aceite do termo (US-011 "Nova versão do termo", adiado do Plano 03) | `requirePaciente` confere em `consents` se a conta aceitou a versão atual (`TERMO_PACIENTE`) **naquele consultório**; senão `/p/termo` (botão "Continuar" desabilitado até marcar). Hoje a versão é a mesma do convite (`0.1-provisorio`): ninguém é parado até o P08-06 publicar o texto do advogado | `consents` continua fora da RLS; `src/modules/portal/termo.ts` entra na lista de quem a acessa |
| D26 | Inscrição de push em aparelho compartilhado (Review Focus 4) | Um endpoint de push pertence a **uma conta**: ativar, e toda abertura do portal com inscrição no navegador, chamam `app_soltar_endpoint_push` (SECURITY DEFINER, só na sessão de paciente), que apaga o endpoint de toda outra conta em qualquer tenant; na abertura (`sincronizar`), se o endpoint não era desta conta, nada é gravado e o navegador descarta a inscrição — a outra pessoa só recebe push depois de tocar em "Ativar notificações"; se era, os vínculos novos ganham a linha | Uma função que percorre os tenants (como a `admin_tenant_metrics`), mas só ao ativar e uma vez por abertura do portal com inscrição — não a cada requisição (D2). Se o número de tenants crescer muito, trocar por uma tabela global endpoint → conta (backlog) |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano)

| Spec | Neste plano | Motivo |
|---|---|---|
| §4.1 "Paciente só vê o que é dele" (só leitura implícita) | Escrita da sessão de paciente negada no banco por padrão + `PACIENTE_ESCREVE` (D1) | P-16 (a), generalizado |
| §4.1 contextos do `withTenant` | Contexto novo `conta` (`withConta`), só `SELECT` em `patients` da própria conta (D2) | Conta de paciente sem tenant |
| §7 `stored_files` | Coluna `patient_id` (nula = arquivo do consultório) + política `paciente_arquivos`; tipo novo `diario_foto_original` (D4, D10) | P-16 (d); original do diário até a conversão |
| §7 `diary_entries` | Colunas a mais: `tenant_id`, `foto_original_path`, `foto_status` (`sem_foto`/`processando`/`pronta`/`falhou`/`removida`), `created_at`/`updated_at`; `refeicao` limitada a uma lista (`Café da manhã`, `Lanche da manhã`, `Almoço`, `Lanche da tarde`, `Jantar`, `Ceia`, `Outro`); `texto` até 2000 caracteres | Conversão assíncrona (US-042) |
| §7 `access_events` | `dia` no fuso do tenant; `tenant_id` | CS-02 por tenant |
| §7 `data_exports` (Plano 03) | Coluna `escopo` (`equipe`/`titular`) | US-046 sem rascunho (P-16 b) |
| §7 `notifications.tipo` | `push_teste`, `comentario_diario` (D7) | US-040, US-043 |
| §7 `privacy_requests` | Índice único parcial: um pedido `aberto` por paciente e tipo (D17) | Pedido repetido |
| §7 `patients` | Índice `patients_user_idx (user_id)` (D2) | Vínculos da conta |
| US-040 "push de teste" | Sai pelo motor (até ~1 min depois do clique) (D7) | Mesmo envio revisado do Plano 05 |
| US-041 "Sugestão de receita" | Fica para o Plano 07 (P07-05): `meals.recipe_content_id` ainda não existe | Conteúdo é do M6 |
| US-042 "miniatura local" + RN-07 | Original guardado (conta na cota) até a conversão; com a cota esgotada o texto é salvo sem foto (US-042) e a tela diz "Espaço de armazenamento esgotado. Fale com o suporte." (D10) | — |
| US-043 "o paciente recebe push" | Só no primeiro comentário (D13) | Push repetido |
| US-046 "Baixar meus dados" | 1 pedido a cada 24 h (D16) | Proteção do worker |
| RN-08 "perde o login do portal para aquele tenant" | O vínculo some de `vinculosDaConta` (paciente `arquivado`, `bloqueado` ou anonimizado); com outro vínculo ativo, a conta continua entrando nele | — |
| Textos novos de interface | Portal: "Meu acompanhamento", "Início", "Plano", "Diário", "Evolução", "Compras", "Agenda", "Perfil", "Portal", "Com qual nutricionista você quer entrar?", "Entrar", "Trocar de nutricionista", "Seu acesso ao portal não está ativo. Fale com sua nutricionista.", "Instalar app", "Para instalar no iPhone: toque em Compartilhar → Adicionar à Tela de Início.", "Depois de instalar, abra o app pela tela de início para ativar as notificações.", "Ativar notificações", "Notificações ativadas neste aparelho.", "Você bloqueou as notificações. Para ativar, mude a permissão do site nas configurações do navegador.", "Notificações no app ainda não estão disponíveis.", "Não foi possível ativar as notificações. Tente de novo.", "Offline — exibindo última versão", "Próxima refeição", "Substituições", "Ver substituições de {alimento}", "Seu PDF está sendo preparado. Volte em alguns minutos.", "Orientações", "Diário", "Registrar refeição", "Refeição", "Café da manhã", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar", "Ceia", "Outro", "O que você comeu?", "Foto (opcional)", "Registrar", "Registro salvo.", "Registro salvo sem a foto.", "Escreva o que você comeu ou envie uma foto.", "Use no máximo 2000 caracteres.", "Escolha a refeição.", "Foto sendo preparada…", "Não foi possível processar a foto.", "Comentário da nutricionista", "Nenhum registro ainda.", "Novo", "Visto", "Comentar", "Salvar comentário", "Comentário salvo.", "Escreva o comentário.", "Use no máximo 1000 caracteres.", "Nenhum registro de diário ainda.", "Registro não encontrado.", "Minha evolução", "Medidas", "Registre mais uma avaliação para ver a evolução", "Orientações recebidas", "Nenhuma orientação registrada ainda.", "Lista de compras", "Para quantos dias?", "Gerar lista", "Escolha de 1 a 14 dias.", "Comprado", "Sem plano publicado, não há lista de compras.", "Agenda", "Minhas consultas", "Próximas", "Anteriores", "Agendar consulta", "Nenhuma consulta marcada.", "Consulta marcada para {quando}.", "Perfil", "Notificações", "Receber lembretes por WhatsApp", "Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.", "Preferência salva.", "Privacidade", "Baixar meus dados", "Pedimos seus dados. O link chega por e-mail e vale por 24 horas.", "Você já pediu seus dados nas últimas 24 horas. O link chega por e-mail.", "Pedir exclusão dos meus dados", "Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal.", "Pedido de exclusão registrado. Enviamos a confirmação para o seu e-mail.", "Seu pedido de exclusão já foi registrado em {data}.", "Seus dados", "O arquivo está pronto. O link vale até {quando}.", "Baixar arquivo", "Ainda estamos preparando seus dados. Volte em alguns minutos.", "Este link expirou. Peça os dados de novo em Perfil.", "Não foi possível gerar seus dados. Peça de novo em Perfil." · Painel: "Diários", "Pedidos do titular", "Pedido de exclusão de {nome}", "prazo {data}", "Mostrar % de gordura ao paciente" · E-mails: "Seu pedido foi registrado" (assunto), "Recebemos seu pedido de exclusão de dados. {nutri} tem até {prazo} para responder.", "A exportação de dados que você pediu no NutriDebby está pronta.", "O link vale por 24 horas e pede que você entre no portal." | Telas novas |

### Itens adiados de planos anteriores

**Incorporados** (a tarefa entre parênteses):
- P-16 (a) escrita só da equipe em `foods`, `food_measures`, `anamnesis_templates` (Tarefa 1, generalizado — D1); (b) exportação do titular sem rascunho (Tarefa 11); (c) não se aplica (D5); (d) `stored_files` por paciente (Tarefa 2).
- Plano 01 (rodada 3, achado 2) / P06-11: renovar o cookie de sessão do paciente com o uso (Tarefa 6).
- Plano 03 / P06-08: anonimizar nome e e-mail da conta `user` do titular sem outro vínculo (Tarefa 11).
- Plano 03 (`lgpd.ts`): "Plano 06: apagar aqui também as fotos do diário" no pedido de exclusão e na anonimização (Tarefa 11).
- Plano 05 (Tarefa 13): P06-02 grava `push_subscriptions` com a sessão do paciente, uma linha por vínculo ativo do dispositivo, e passa `VAPID_PUBLIC_KEY` ao app (Tarefa 6).
- Plano 05: P06-09 sobre `horariosParaPaciente`, `agendarComoPaciente`, `remarcarComoPaciente`, `cancelarConsulta(por: 'paciente')`, `confirmarPresenca`, `pedirRemarcacao`; RN-06 com a sigla do fuso; "Perfil > Notificações" grava `whatsapp_optout_em` (Tarefas 11 e 12).
- Plano 05: a página pública ganha "Entrar (já sou paciente)" (Tarefa 3).
- Plano 03: `orientacoesDoPaciente` (já escrita para o portal) na Evolução (Tarefa 9).
- Plano 04 (US-025): push + e-mail "Seu novo plano alimentar está disponível" na publicação, no gancho de `publicarPlano` (Tarefa 6, D24).
- Plano 02 (US-005): a marca da nutricionista (logo, cor) no topo do PWA por `getTenantBrand()` (Tarefa 3); os ícones do manifest (Tarefa 5).
- Plano 03 (US-011): novo aceite quando o termo mudar de versão (Tarefa 3, D25) e "Revogar o WhatsApp" em Perfil > Notificações (Tarefa 11).
- Plano 02 (`suspensao.ts`): pacientes barrados por vínculo quando o consultório está suspenso (RN-15) — em `requirePaciente` (Tarefa 3).

**Não incorporados** (motivo):
- P04-10 (débitos do Plano 04: exportação N+1, inserts em lote, helper de trava) — fica num PR pequeno à parte (mesmo motivo do Plano 05).
- US-041 "Sugestão de receita" — Plano 07 (P07-05).
- Escopo pós-MVP (F3-02 IA Nutri do paciente, F3-04 envio de exames pelo paciente) — fora deste plano; a navegação (D23) e as rotas `/p/…` ficam prontas para receber "Exames" e "IA Nutri" sem mudar o layout, e a guarda `PACIENTE_ESCREVE` obriga a declarar qualquer escrita nova.

## Review Focus

1. **Sessão de paciente entrando onde não deve.** Paciente arquivado, bloqueado ou anonimizado; conta com dois vínculos e cookie `nd_vinculo` de um tenant em que não é paciente (cookie forjado); tenant suspenso; nutricionista abrindo `/p/plano`; paciente chamando `/api/painel/…` e Server Actions do painel. Esperado: vínculo inativo some (outro vínculo continua), cookie forjado é ignorado (volta a `/p/escolher` ou ao único vínculo), suspenso → "Conta temporariamente indisponível", papel errado → home do papel (403 na API), nunca 500 nem dado de outro paciente. Testes nas Tarefas 3 e 13.
2. **Escrita da sessão de paciente fora do permitido (D1).** Um bug que faça a sessão de paciente gravar em `anthropometry`, `exams`, `meal_plans` publicados, `foods`, `food_measures`, `anamnesis_templates`, `consultations` ou apagar o próprio diário. Esperado: o banco recusa (42501 no INSERT, 0 linhas no UPDATE/DELETE) e os fluxos do Plano 05 que rodam como paciente (link da consulta, webhook, aceite do convite) continuam passando. Testes nas Tarefas 1 e 2 e a suíte do Plano 05 inteira verde.
3. **Foto do diário maliciosa ou grande.** HEIC de 6 MB do iPhone, PNG com EXIF/GPS, JPEG de 15 MB, PDF renomeado para `.jpg`, SVG, imagem 20000 × 20000 px ("bomba de descompressão"), arquivo HEIC corrompido, cota esgotada no meio, dois envios ao mesmo tempo com 9 registros no dia, worker caindo entre gravar o JPEG e apagar o original (o ponteiro do original só é solto no `naMesmaTransacao` do `apagarArquivo`, regra 9). Esperado: tipo pelo conteúdo; > 10 MB → 413 "Envie uma foto JPEG, PNG ou HEIC de até 10 MB"; pixels acima de 40 MP recusados pela conversão pelo cabeçalho, **antes** de decodificar (HEIC inclusive: o `heic-decode` só aloca no `decode()`) ("Não foi possível processar a foto."); JPEG final ≤ 1600 px sem EXIF/GPS; cota esgotada → texto salvo sem foto; 11º registro → "Limite de 10 registros por dia atingido" mesmo na corrida; nenhum arquivo órfão nem cota contada em dobro. Testes na Tarefa 7.
4. **Dado de saúde no aparelho e em aparelho compartilhado.** Paciente A sai e B entra no mesmo celular; sessão de A expira (sem "Sair") com o plano no cache e B entra; A troca de nutricionista; push de A chegando para B; "Plano" aberto pelo menu (navegação do roteador, não `navigate`). Esperado: "Sair" apaga o cache `nd-plano-v1`, o cookie `nd_vinculo` e a inscrição de push do aparelho (no servidor e no navegador) e a resposta de `/sair` leva `Clear-Site-Data`; a tela de login e a abertura do portal com outro dono apagam a cópia; abrir o portal com a inscrição de outra conta tira o endpoint dela (em qualquer tenant) e B só recebe push depois de tocar em "Ativar notificações"; o cache é preenchido também pela navegação do menu e só guarda `/p/plano` 200 da própria URL (nunca o HTML do `/entrar` depois de um redirecionamento) e nunca `/api/…`, fotos ou PDFs. Testes nas Tarefas 5 e 6.
5. **Bordas de fuso no portal.** Registro do diário às 23:30 de Brasília (02:30 UTC do dia seguinte) — conta no limite de qual dia; acesso diário (CS-02) à meia-noite; "próxima refeição" às 21:00 com a última refeição às 20:00 (nenhuma próxima → a primeira do dia seguinte); aparelho em Lisboa vendo consulta de São Paulo; prazo do pedido de exclusão. Esperado: dia, hora e prazo sempre no fuso do tenant; no aparelho em outro fuso, a sigla "(horário de Brasília)". Testes nas Tarefas 4 (próxima refeição), 6 (acesso do dia), 7 (diário), 11 (prazo do pedido) e 12 (agenda).

---

## Estrutura de arquivos

```
drizzle/
  0070_paciente_sem_escrita (custom)                                                   # T1
  0071_stored_files_paciente (gerada: patient_id, data_exports.escopo, patients_user_idx) · 0072_rls_stored_files_paciente (custom: FK, preenchimento, política)  # T2
  0073_conta_vinculos (custom: política paciente_por_conta)                             # T3
  0074_portal_acesso (gerada: access_events, tipos de notifications) · 0075_rls_access_events (custom)  # T6
  0076_diario (gerada) · 0077_rls_diario (custom)                                       # T7
  0078_pedido_aberto_unico (gerada) · 0079_paciente_titular (custom)                    # T11
src/db/schema/portal.ts (+ index.ts)       # T6, T7 — access_events, diary_entries
src/db/schema/platform.ts · pacientes.ts · agenda.ts   # T2 (stored_files.patient_id, data_exports.escopo, patients_user_idx), T6 (tipos), T11 (índice)
src/db/tenant.ts (+test)                   # T3 — withConta
src/db/rls-guard.ts (+test) · paciente-escrita.test.ts · audit-guard.ts   # T1 (PACIENTE_ESCREVE), T2, T3, T6, T7, T11
src/env.ts (+test) · .env.example          # T6 — VAPID_PUBLIC_KEY no app
src/lib/paciente-session.ts (+test)        # T3
src/lib/sessao-cookies.ts (+test)          # T6 — cookie renovado (P06-11)
src/modules/portal/
  vinculos.ts (+test) · termo.ts (+test)                             # T3
  plano.ts (+test)                                                   # T4
  acesso.ts (+test) · push-inscricao.ts (+test) · avisos.ts (+test)  # T6
  diario.ts (+test) · diario-constantes.ts · diario-foto-job.ts (+test)   # T7
  diario-nutri.ts (+test)                                            # T8
  evolucao.ts (+test)                                                # T9
  lista-compras.ts (+test, + banco)                                  # T10
  meus-dados.ts (+test) · perfil.ts (+test)                          # T11
  agenda.ts (+test)                                                  # T12
src/modules/plataforma/armazenamento.ts (+test)            # T2 — patientId
src/modules/notificacoes/{push,push-endpoint,mensagens}.ts (+test)   # T6 — endpoint sem web-push, push_teste/comentario_diario/plano_novo
src/modules/plano-alimentar/publicacao.ts (+test)          # T6 — aviso de plano novo (US-025)
src/modules/pacientes/{exportacao,exportacao-job,lgpd,convite-paciente}.ts (+test) · conta-titular.ts (+test)   # T2, T11
src/modules/plataforma/{audit,marca,suspensao}.ts          # T3 (comentário), T7 (rótulo), T9 (opção do %G)
src/email/types.ts · templates.tsx (+ render.test)          # T6, T11
src/jobs/queues.ts · src/worker/index.ts   # T7
src/app/sw.ts · sw-regras.ts (+test) · manifest.ts (+test)  # T5 (cache), T6 (push, toque)
public/icones/* · scripts/gerar-icones.ts  # T5
src/app/sair/route.ts (+test)              # T5 — Clear-Site-Data e nd_vinculo apagado
src/app/entrar/page.tsx                    # T5 — o login apaga o plano guardado
src/app/p/
  layout.tsx · navegacao.ts (+test) · nav-portal.tsx                             # T3, T5 (metadados, Sair)
  (portal)/layout.tsx                                                            # T3, T5 (selo), T6 (acesso)
  escolher/{page,actions}.tsx · sem-acesso/page.tsx · termo/{page,termo-form,actions}.tsx   # T3
  instalacao.ts (+test) · instalar.tsx · selo-offline.tsx · sair-portal.tsx · plano-guardado.tsx   # T5 (T6 estende o Sair)
  notificacoes.tsx · acesso.tsx                                                  # T6
  quando-local.tsx (+test)                                                       # T12
  (portal)/inicio/page.tsx                                                       # T3, T5, T6, T12
  (portal)/plano/page.tsx                                                        # T4
  (portal)/diario/{page,diario-form}.tsx                                         # T7, T8
  (portal)/evolucao/page.tsx                                                     # T9
  (portal)/compras/{page,lista-compras}.tsx                                      # T10
  (portal)/perfil/{page,actions,privacidade,whatsapp-form}.tsx · (portal)/meus-dados/exportacoes/[id]/page.tsx   # T11
  (portal)/agenda/{page,actions,agendar-form,acoes-consulta}.tsx · nova/page.tsx · [id]/page.tsx   # T12
src/app/api/p/{plano/pdf,ping,acesso,push,diario}/route.ts (+test)   # T4, T5, T6, T6, T7
src/app/n/[slug]/page.tsx                  # T3, T12 — "Entrar (já sou paciente)"
src/app/painel/diarios/{page,[id]/page,actions,comentario-form}.tsx · cabecalho.tsx   # T8
src/app/painel/page.tsx · pacientes/[id]/privacidade/actions.ts                       # T11 — "Pedidos do titular", fotos do diário
src/app/painel/configuracoes/perfil-form.tsx · src/app/painel/actions.ts              # T9
test/isolamento.test.ts · test/portal.ts   # T1+, T3
src/modules/notificacoes/push.test.ts      # T7 — guarda do grafo (diario-foto-job, heic-decode)
e2e/portal.ts · e2e/portal.spec.ts · e2e/fixtures/prato.jpg · e2e/acessibilidade.spec.ts   # T3+, T7, T13
package.json · pnpm-lock.yaml · playwright.config.ts · .github/workflows/ci.yml  # T5 (script icones), T7 (heic-decode), T13 (axe, projeto celular)
CLAUDE.md                                  # T1 (regra 2), T3 (regra 1: contexto conta, termo.ts), T11 (regra 1: conta-titular.ts, lgpd.ts)
```

**Ordem e dependências:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. As Tarefas 1 e 2 fecham o banco antes de existir sessão de paciente no navegador (P-16); a 3 cria a sessão; a 4 entrega "Meu plano" (a página que o offline da 5 guarda); 5 e 6 o PWA, o push e o acesso diário; 7–12 as outras telas; a 13 audita a acessibilidade de todas.

---
### Task 1: Escrita da sessão de paciente negada por padrão no banco — `paciente_sem_*`, `PACIENTE_ESCREVE` e guarda (P06-00 a)

**Files:**
- Create: `drizzle/0070_paciente_sem_escrita.sql` (custom), `src/db/paciente-escrita.test.ts`
- Modify: `src/db/rls-guard.ts`, `src/db/rls-guard.test.ts`, `test/isolamento.test.ts`, `src/modules/alimentos/foods-rls.test.ts`, `CLAUDE.md` (regra 2)

**Interfaces:**
- Consumes: `app_enable_tenant_rls`, `app_deny_publico`, `app_current_role()` (migrations 0000/0051); `listTenantTables`, `RLS_EXCEPTIONS`, `RlsViolation` (`src/db/rls-guard.ts`).
- Produces:
  - SQL: `app_deny_paciente_escrita(tbl regclass)`, `app_allow_paciente_escrita(tbl regclass, VARIADIC comandos text[])` (comandos: `insert`, `update`, `delete`); `app_enable_tenant_rls(tbl)` passa a chamar também `app_deny_paciente_escrita`. Políticas RESTRICTIVE `paciente_sem_insert` (FOR INSERT WITH CHECK), `paciente_sem_update` (FOR UPDATE USING), `paciente_sem_delete` (FOR DELETE USING).
  - `@/db/rls-guard`: `type ComandoEscrita = 'insert' | 'update' | 'delete'`, `PACIENTE_ESCREVE: Record<string, { comandos: readonly ComandoEscrita[]; motivo: string }>`, `findPacienteEscritaViolations(db): Promise<RlsViolation[]>`. **Contrato para as Tarefas 2, 5, 7 e 11:** liberar escrita = `SELECT app_allow_paciente_escrita(...)` na migration **e** a entrada aqui, na mesma tarefa.

- [ ] **Step 1: Teste da guarda (falha)** — acrescentar a `src/db/rls-guard.test.ts` (e `findPacienteEscritaViolations`, `PACIENTE_ESCREVE` no import)

```ts
describe('escrita da sessão de paciente (D1, P-16 a)', () => {
  it('toda tabela com tenant_id nega a escrita do paciente ou bate com PACIENTE_ESCREVE; a lista não cita tabela inexistente', async () => {
    expect(await findPacienteEscritaViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { PACIENTE_ESCREVE })).toEqual([]);
  });
  it('tabela nova nasce fechada; liberar sem declarar, ou perder a política, quebra (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_paciente (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_paciente')`);
      await client.query('create table tmp_paciente_liberada (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_paciente_liberada')`);
      await client.query(`select app_allow_paciente_escrita('tmp_paciente_liberada', 'insert')`);
      let v = await findPacienteEscritaViolations(client);
      expect(v.map((x) => x.table)).not.toContain('tmp_paciente');
      expect(v).toContainEqual({ table: 'tmp_paciente_liberada', problem: 'a sessão de paciente pode insert sem entrada em PACIENTE_ESCREVE' });
      await client.query('drop policy paciente_sem_delete on tmp_paciente');
      await client.query('drop policy paciente_sem_insert on anthropometry');
      v = await findPacienteEscritaViolations(client);
      expect(v).toContainEqual({ table: 'tmp_paciente', problem: 'a sessão de paciente pode delete sem entrada em PACIENTE_ESCREVE' });
      expect(v).toContainEqual({ table: 'anthropometry', problem: 'a sessão de paciente pode insert sem entrada em PACIENTE_ESCREVE' });
      expect(v.map((x) => x.table)).not.toContain('patients'); // update liberado em PACIENTE_ESCREVE e sem a política: certo
      await expect(client.query(`select app_allow_paciente_escrita('tmp_paciente', 'select')`)).rejects.toThrow(/comando inválido/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('PACIENTE_ESCREVE libera um comando que o banco nega → quebra', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select app_deny_paciente_escrita('appointments')`); // volta a negar insert/update
      const v = await findPacienteEscritaViolations(client);
      expect(v).toContainEqual({ table: 'appointments', problem: 'PACIENTE_ESCREVE libera insert, mas o banco nega (paciente_sem_insert)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('a política com o nome certo mas o comando errado também quebra (paciente_sem_delete criada FOR SELECT)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('drop policy paciente_sem_delete on exams');
      await client.query(`create policy paciente_sem_delete on exams as restrictive for select using (app_current_role() is distinct from 'paciente')`);
      expect(await findPacienteEscritaViolations(client)).toContainEqual({ table: 'exams', problem: 'a sessão de paciente pode delete sem entrada em PACIENTE_ESCREVE' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
```

Run: `pnpm test src/db/rls-guard.test.ts` → FAIL (`findPacienteEscritaViolations` não existe).

- [ ] **Step 2: Migration** — `pnpm drizzle-kit generate --custom --name paciente_sem_escrita`; `drizzle/0070_paciente_sem_escrita.sql`:

```sql
-- P-16 (a) / D1 (Plano 06): a sessão de paciente não grava em tabela nenhuma, a não ser as de PACIENTE_ESCREVE
-- (src/db/rls-guard.ts), só nos comandos listados. RESTRICTIVE: soma-se (AND) às políticas de tenant/paciente.
-- Mesmo desenho do contexto `publico` (0051): negar por padrão, liberar por comando. A leitura continua com as
-- políticas de sempre (tenant_isolation, patient_isolation, staff_only, paciente_sem_rascunho).
CREATE OR REPLACE FUNCTION app_deny_paciente_escrita(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'paciente_sem_' || c, tbl);
    IF c = 'insert' THEN
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR INSERT WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
        'paciente_sem_' || c, tbl, 'paciente');
    ELSE
      -- Sem WITH CHECK: no UPDATE o USING vale também para a linha nova. Atenção: sem a política de UPDATE,
      -- SELECT … FOR UPDATE/SHARE da sessão de paciente não enxerga a linha (ela some do resultado).
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s USING (app_current_role() IS DISTINCT FROM %L)',
        'paciente_sem_' || c, tbl, upper(c), 'paciente');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Libera à sessão de paciente só os comandos listados (as outras políticas paciente_sem_* continuam). Idempotente:
-- recria as três negações e tira só as liberadas.
CREATE OR REPLACE FUNCTION app_allow_paciente_escrita(tbl regclass, VARIADIC comandos text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  IF NOT comandos <@ ARRAY['insert', 'update', 'delete'] THEN
    RAISE EXCEPTION 'app_allow_paciente_escrita: comando inválido em % (use insert, update, delete)', comandos;
  END IF;
  PERFORM app_deny_paciente_escrita(tbl);
  FOREACH c IN ARRAY comandos LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'paciente_sem_' || c, tbl);
  END LOOP;
END $$;
--> statement-breakpoint
-- Tabela nova nasce fechada também para a escrita do paciente: o mesmo corpo da 0051 + app_deny_paciente_escrita.
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', tbl);
  PERFORM app_deny_publico(tbl);
  PERFORM app_deny_paciente_escrita(tbl);
END $$;
--> statement-breakpoint
-- As tabelas que já existem (Planos 01–05) também ficam fechadas
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' LOOP
    PERFORM app_deny_paciente_escrita(format('public.%I', t)::regclass);
  END LOOP;
END $$;
--> statement-breakpoint
-- PACIENTE_ESCREVE (o que os Planos 03 e 05 já fazem como paciente): aceite do convite e opt-in/opt-out (patients),
-- agenda pelo link e pelo WhatsApp (appointments, notifications) e a auditoria (gatilho e auditRead)
SELECT app_allow_paciente_escrita('patients', 'update');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('appointments', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('notifications', 'insert', 'update');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('audit_log', 'insert');
```

- [ ] **Step 3: Lista e guarda** — `src/db/rls-guard.ts`, depois de `findPublicoViolations`:

```ts
export type ComandoEscrita = 'insert' | 'update' | 'delete';
const ESCRITAS: readonly ComandoEscrita[] = ['insert', 'update', 'delete'];

/**
 * D1 (Plano 06, P-16 a): o que a sessão de paciente pode gravar, só com estes comandos. Toda outra tabela com tenant_id
 * tem `paciente_sem_insert/update/delete` (app_enable_tenant_rls). Liberar = `SELECT app_allow_paciente_escrita(...)` +
 * entrada aqui. Sem `update`, SELECT … FOR UPDATE/SHARE de paciente não enxerga a linha.
 */
export const PACIENTE_ESCREVE: Record<string, { comandos: readonly ComandoEscrita[]; motivo: string }> = {
  patients: { comandos: ['update'], motivo: 'aceite do convite (US-011), opt-in/opt-out do WhatsApp e a trava FOR UPDATE das ações do paciente' },
  appointments: { comandos: ['insert', 'update'], motivo: 'agendar, confirmar, cancelar e remarcar pelo link, pelo WhatsApp e pelo portal (US-032, US-033, US-035)' },
  notifications: { comandos: ['insert', 'update'], motivo: 'lembretes da consulta marcada pelo paciente, respostas "1"/"2" e lembretes cancelados' },
  audit_log: { comandos: ['insert'], motivo: 'o gatilho de auditoria e o auditRead rodam com o papel de quem age' },
};

/** Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega a escrita do paciente, ou bate exatamente com PACIENTE_ESCREVE. */
export async function findPacienteEscritaViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string }>(
    `select tablename as t, policyname as pol, cmd, permissive from pg_policies
      where schemaname = 'public' and policyname like 'paciente\\_sem\\_%'`,
  );
  const out: RlsViolation[] = [];
  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pode = PACIENTE_ESCREVE[table]?.comandos ?? [];
    for (const c of ESCRITAS) {
      // nome, comando e RESTRICTIVE: um `paciente_sem_delete` criado FOR SELECT (ou PERMISSIVE) não nega o DELETE
      const negada = rows.some((r) => r.t === table && r.pol === `paciente_sem_${c}` && r.cmd === c.toUpperCase() && r.permissive === 'RESTRICTIVE');
      if (!pode.includes(c) && !negada) out.push({ table, problem: `a sessão de paciente pode ${c} sem entrada em PACIENTE_ESCREVE` });
      if (pode.includes(c) && rows.some((r) => r.t === table && r.pol === `paciente_sem_${c}`)) {
        out.push({ table, problem: `PACIENTE_ESCREVE libera ${c}, mas o banco nega (paciente_sem_${c})` });
      }
    }
  }
  return out;
}
```

Run: `pnpm db:migrate` (banco de dev) e `pnpm test src/db/rls-guard.test.ts` → PASS.

- [ ] **Step 4: Testes de comportamento (falham antes da migration, passam depois)** — `src/db/paciente-escrita.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};

describe('P-16 (a) / D1: a sessão de paciente não grava fora de PACIENTE_ESCREVE', () => {
  it('não cria "Meu alimento", medida nem modelo de anamnese do tenant', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const comoPaciente = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(q), app.db);
    await expect(
      comoPaciente(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${T.tenantId}, 'Bolo da paciente', 'Miscelâneas', 100, 1, 1, 1, 1)`),
    ).rejects.toSatisfy(violaRls);
    await expect(comoPaciente(sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${T.tenantId}, 'X', '{"perguntas":[]}')`)).rejects.toSatisfy(violaRls);
  });

  it('não altera nem apaga alimento, medida e modelo que a nutricionista criou (0 linhas)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const foodId = randomUUID();
    await withTenant(
      T.ctx,
      async (tx) => {
        await tx.execute(sql`insert into foods (id, tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${foodId}, ${T.tenantId}, 'Granola da casa', 'Miscelâneas', 400, 10, 60, 12, 6)`);
        await tx.execute(sql`insert into food_measures (tenant_id, food_id, nome, plural, gramas) values (${T.tenantId}, ${foodId}, 'pote', 'potes', 40)`);
        await tx.execute(sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${T.tenantId}, 'Modelo', '{"perguntas":[]}')`);
      },
      app.db,
    );
    await withTenant(
      ctxPaciente(T.tenantId, p.id),
      async (tx) => {
        for (const t of ['foods', 'food_measures', 'anamnesis_templates']) {
          expect((await tx.execute(sql`update ${sql.identifier(t)} set tenant_id = tenant_id where tenant_id = ${T.tenantId}`)).rowCount, t).toBe(0);
          expect((await tx.execute(sql`delete from ${sql.identifier(t)} where tenant_id = ${T.tenantId}`)).rowCount, t).toBe(0);
        }
        // ainda lê (o editor de plano do paciente não existe, mas o plano publicado junta foods)
        expect((await tx.execute(sql`select 1 from foods where id = ${foodId}`)).rows).toHaveLength(1);
      },
      app.db,
    );
  });

  it('não grava no próprio prontuário (antropometria, exames, atendimentos)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${T.tenantId}, ${p.id}, '2026-09-01', 70, 170)`), app.db);
    const comoPaciente = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(q), app.db);
    await expect(comoPaciente(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${T.tenantId}, ${p.id}, '2026-09-02', 60, 170)`)).rejects.toSatisfy(violaRls);
    await expect(comoPaciente(sql`insert into exams (tenant_id, patient_id, data, titulo) values (${T.tenantId}, ${p.id}, '2026-09-02', 'X')`)).rejects.toSatisfy(violaRls);
    expect((await comoPaciente(sql`update anthropometry set peso_kg = 50`)).rowCount).toBe(0);
    expect((await comoPaciente(sql`delete from anthropometry`)).rowCount).toBe(0);
    expect((await comoPaciente(sql`select peso_kg from anthropometry`)).rows).toEqual([{ peso_kg: '70.00' }]); // e continua lendo
  });

  it('o que PACIENTE_ESCREVE libera continua funcionando (a trava FOR UPDATE do próprio cadastro)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`select id from patients where id = ${p.id} for update`), app.db);
    expect(r.rows).toHaveLength(1);
  });
});
```

Run: `pnpm test src/db/paciente-escrita.test.ts` → PASS (com a migration aplicada; antes dela, o primeiro e o terceiro casos falham).

- [ ] **Step 5: Matriz de isolamento** — `test/isolamento.test.ts`: importar `PACIENTE_ESCREVE` de `@/db/rls-guard`; no teste "a paciente P2 só vê e só altera as próprias linhas…", trocar as duas expectativas de contagem por:

```ts
          const pode = PACIENTE_ESCREVE[t]?.comandos ?? [];
          const alteradas = await tx.execute(sql`update ${id} set ${c} = ${c}`);
          // D1: sem `update` em PACIENTE_ESCREVE, o UPDATE da própria linha também dá 0 (paciente_sem_update)
          expect(alteradas.rowCount, t).toBe(pode.includes('update') ? vistas.rows.length : 0);
          if (!apaga) return;
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(pode.includes('delete') ? vistas.rows.length : 0);
```

e as duas linhas depois do `withTenant` por:

```ts
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1); // owner confirma: as linhas de P1 seguem intactas
      if (apaga && (PACIENTE_ESCREVE[t]?.comandos ?? []).includes('delete')) expect(await contarPaciente(t, col, A, P2), t).toBe(0);
```

e acrescentar o teste:

```ts
  it('D1: fora de PACIENTE_ESCREVE, a paciente P2 não cria nem a própria linha (tabelas com titular)', async () => {
    for (const t of tabelas) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t) || (PACIENTE_ESCREVE[t]?.comandos ?? []).includes('insert')) continue;
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, (tx) => tx.execute(q), app.db);
      await expect(comoP2(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRls);
    }
  });
```

Run: `pnpm test test/isolamento.test.ts src/modules/alimentos/foods-rls.test.ts` → PASS.

- [ ] **Step 6: Nada do Plano 05 quebrou** — Run: `pnpm test src/modules/agenda src/modules/notificacoes src/modules/pacientes` → PASS (link da consulta, webhook e aceite do convite rodam como paciente: se algum gravar numa tabela fora de `PACIENTE_ESCREVE`, o teste mostra a tabela; liberar só o comando que o fluxo usa, com o motivo, e citar no PR).

- [ ] **Step 7: CLAUDE.md** — na regra 2, depois da frase do contexto `publico`, acrescentar: "Sessão de paciente (Plano 06, D1): `app_enable_tenant_rls` também nega INSERT/UPDATE/DELETE a ela (`paciente_sem_*`); tabela que o portal precisa gravar ganha `SELECT app_allow_paciente_escrita('<tabela>', '<comando>', …);` e a entrada em `PACIENTE_ESCREVE` (`src/db/rls-guard.ts`) — a guarda `findPacienteEscritaViolations` quebra o CI se esquecer."

- [ ] **Step 8: Commit**

```bash
git add drizzle/0070_paciente_sem_escrita.sql drizzle/meta src/db/rls-guard.ts src/db/rls-guard.test.ts src/db/paciente-escrita.test.ts test/isolamento.test.ts CLAUDE.md
git commit -m "feat(db): escrita da sessão de paciente negada por padrão (paciente_sem_*, PACIENTE_ESCREVE) — P-16 (a)"
```

---

### Task 2: `stored_files` por paciente e escopo da exportação (P06-00 d e b)

**Files:**
- Create: `drizzle/0071_stored_files_paciente.sql` (gerada), `drizzle/0072_rls_stored_files_paciente.sql` (custom)
- Modify: `src/db/schema/platform.ts`, `src/db/schema/pacientes.ts`, `src/db/rls-guard.ts`, `src/modules/plataforma/armazenamento.ts`, `src/modules/plataforma/armazenamento.test.ts`, `src/modules/pacientes/exames.ts`, `src/modules/plano-alimentar/plano-pdf-job.ts`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/exportacao.test.ts` (testes de `montarDados`), `src/modules/pacientes/exames.test.ts` e os outros testes que chamam `salvarArquivo` com tipo de paciente, `test/isolamento.test.ts`

**Interfaces:**
- Consumes: `salvarArquivo` (Plano 02), `montarDados` (Plano 03), `PACIENTE_ESCREVE` (Tarefa 1).
- Produces:
  - Schema: `storedFiles.patientId: uuid | null` (FK composta `(tenant_id, patient_id)` → `patients`), tipo `diario_foto_original` no CHECK; `dataExports.escopo: 'equipe' | 'titular'` (padrão `equipe`); `patients_user_idx` (`user_id`) WHERE `user_id IS NOT NULL` (usado na Tarefa 3).
  - `salvarArquivo(ctx, { …, patientId?: string })` — obrigatório para `exame`, `plano_pdf`, `diario_foto`, `diario_foto_original`, `exportacao` (erro de programação se faltar); proibido para `logo`/`capa`.
  - `montarDados(tx, patientId, now, fuso, escopo: 'equipe' | 'titular' = 'equipe')` — `titular` tira os planos `rascunho`.
  - `TipoDeArquivo` ganha `'diario_foto_original'`; `TIPOS_DO_PACIENTE` exportado de `armazenamento.ts`.

- [ ] **Step 1: Testes (falham)** — `src/modules/plataforma/armazenamento.test.ts`, acrescentar:

```ts
describe('stored_files por paciente (P-16 d, D4)', () => {
  it('laudo, PDF, foto e exportação levam o patient_id; logo não pode levar', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG, permitidos: ['png'], patientId: p.id }, { db: app.db, dataDir });
    const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db);
    expect(linha.patientId).toBe(p.id);
    await expect(salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG, permitidos: ['png'] }, { db: app.db, dataDir })).rejects.toThrow(/patientId/);
    await expect(salvarArquivo(T.ctx, { tipo: 'logo', conteudo: PNG, permitidos: ['png'], patientId: p.id }, { db: app.db, dataDir })).rejects.toThrow(/patientId/);
  });

  it('a sessão de paciente só vê os próprios arquivos e os do consultório (logo); grava só os próprios', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await salvarArquivo(T.ctx, { tipo: 'logo', conteudo: PNG, permitidos: ['png'] }, { db: app.db, dataDir });
    const de1 = await salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG, permitidos: ['png'], patientId: p1.id }, { db: app.db, dataDir });
    await salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG, permitidos: ['png'], patientId: p2.id }, { db: app.db, dataDir });
    const vistos = await withTenant(ctxPaciente(T.tenantId, p1.id), (tx) => tx.select({ tipo: storedFiles.tipo, patientId: storedFiles.patientId }).from(storedFiles), app.db);
    expect(vistos).toEqual(expect.arrayContaining([{ tipo: 'logo', patientId: null }, { tipo: 'exame', patientId: p1.id }]));
    expect(vistos).toHaveLength(2);
    // grava a própria foto (Tarefa 7); a de outro paciente, não
    await salvarArquivo(ctxPaciente(T.tenantId, p1.id), { tipo: 'diario_foto_original', conteudo: PNG, permitidos: ['png'], patientId: p1.id }, { db: app.db, dataDir });
    await expect(
      salvarArquivo(ctxPaciente(T.tenantId, p1.id), { tipo: 'diario_foto_original', conteudo: PNG, permitidos: ['png'], patientId: p2.id }, { db: app.db, dataDir }),
    ).rejects.toThrow();
    // e não apaga nem o próprio laudo (paciente_sem_delete)
    expect(await apagarArquivo(ctxPaciente(T.tenantId, p1.id), { id: de1.id }, { db: app.db, dataDir })).toBe(false);
  });
});
```

(`PNG`, `dataDir`, `novoTenant`, `novoPaciente`, `ctxPaciente`, `withTenant`, `storedFiles`, `eq` já existem no arquivo ou vêm de `test/pacientes`; acrescentar os imports que faltarem.)

E, no teste da exportação (`montarDados`), acrescentar:

```ts
it('P-16 (b): no escopo do titular, o rascunho do plano fica fora; no da equipe, entra', async () => {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const { id: rascunho } = await criarRascunho(T.ctx, p.id, { db: app.db });
  const equipe = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo'), app.db);
  const titular = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo', 'titular'), app.db);
  expect(equipe.dados.planos.map((x) => x.status)).toContain('rascunho');
  expect(titular.dados.planos.map((x) => x.status)).not.toContain('rascunho');
  expect(rascunho).toBeTruthy();
});
```

Run: `pnpm test src/modules/plataforma/armazenamento.test.ts src/modules/pacientes` → FAIL.

- [ ] **Step 2: Schema** — `src/db/schema/platform.ts`, em `storedFiles`:

```ts
    /** P-16 (d) / D4: dono do arquivo (laudo, PDF do plano, foto do diário, exportação); nulo = arquivo do consultório (logo, capa). */
    patientId: uuid('patient_id'),
```

no CHECK do tipo, acrescentar `'diario_foto_original'`:

```ts
    check(
      'stored_files_tipo_valido',
      sql`${t.tipo} in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao')`,
    ),
    // logo/capa nunca têm dono; o resto sempre (orientacao_pdf é do Plano 07: do consultório)
    check(
      'stored_files_dono',
      sql`(${t.tipo} in ('logo','capa','orientacao_pdf')) = (${t.patientId} is null)`,
    ),
    index('stored_files_paciente_idx').on(t.tenantId, t.patientId),
```

A FK composta para `patients` fica na migration custom (o `platform.ts` não importa `patients` — evita o ciclo de imports entre os arquivos de schema):

`src/db/schema/pacientes.ts`: em `patients`, acrescentar `index('patients_user_idx').on(t.userId).where(sql\`${t.userId} is not null\`),`; em `dataExports`, a coluna e o CHECK:

```ts
    /** US-046 (Plano 06): `titular` = pedida pelo paciente no portal (sem planos em rascunho, link do portal). */
    escopo: text('escopo').notNull().default('equipe'),
```

```ts
    check('data_exports_escopo_valido', sql`${t.escopo} in ('equipe', 'titular')`),
```

Run: `pnpm db:generate --name stored_files_paciente` → `drizzle/0071_stored_files_paciente.sql` (colunas, CHECKs, índices). **Atenção:** o CHECK `stored_files_dono` falha nas linhas antigas (laudos e PDFs sem `patient_id`); por isso a migration gerada é editada à mão para criar o CHECK `NOT VALID`, e a 0072 o valida depois de preencher:

```sql
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_dono" CHECK (("stored_files"."tipo" in ('logo','capa','orientacao_pdf')) = ("stored_files"."patient_id" is null)) NOT VALID;
```

- [ ] **Step 3: Migration custom** — `pnpm drizzle-kit generate --custom --name rls_stored_files_paciente`; `drizzle/0072_rls_stored_files_paciente.sql`:

```sql
ALTER TABLE stored_files ADD CONSTRAINT stored_files_paciente_fk
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients (tenant_id, id);
--> statement-breakpoint
-- Preenche o dono dos arquivos que já existem. RLS forçada também para o dono da tabela: um tenant por vez.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    UPDATE stored_files sf SET patient_id = e.patient_id FROM exams e
     WHERE sf.tenant_id = t.id AND e.tenant_id = t.id AND e.arquivo_path = sf.caminho AND sf.patient_id IS NULL;
    UPDATE stored_files sf SET patient_id = m.patient_id FROM meal_plans m
     WHERE sf.tenant_id = t.id AND m.tenant_id = t.id AND m.pdf_path = sf.caminho AND m.patient_id IS NOT NULL AND sf.patient_id IS NULL;
    UPDATE stored_files sf SET patient_id = d.patient_id FROM data_exports d
     WHERE sf.tenant_id = t.id AND d.tenant_id = t.id AND d.arquivo_path = sf.caminho AND sf.patient_id IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
-- Arquivo de paciente que ficou sem dono (registro apagado antes desta migration) é órfão de verdade: o CHECK
-- abaixo recusaria. Nenhum é esperado; se houver, a migration falha e o dono decide (não apagamos arquivo aqui).
ALTER TABLE stored_files VALIDATE CONSTRAINT stored_files_dono;
--> statement-breakpoint
-- D4: a sessão de paciente vê e grava só os próprios arquivos; lê os do consultório (logo, capa)
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient() OR tipo IN ('logo', 'capa'))
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
--> statement-breakpoint
-- Tarefa 7: a foto do diário é gravada pela sessão de paciente (salvarArquivo)
SELECT app_allow_paciente_escrita('stored_files', 'insert');
```

`src/db/rls-guard.ts`: `PATIENT_POLICY_EXCEPTIONS.stored_files = 'D4: política própria paciente_arquivos — o paciente vê os próprios arquivos e os do consultório (logo, capa, patient_id nulo)'` e `PACIENTE_ESCREVE.stored_files = { comandos: ['insert'], motivo: 'foto do diário (US-042): salvarArquivo com a sessão do paciente' }`.

`test/isolamento.test.ts`, `FABRICAS.stored_files`:

```ts
  stored_files: (t, p) =>
    sql`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values (${t}, ${p}, 'exame', ${`${t}/exame/${randomUUID()}.png`}, 1, 'image/png')`,
```

(e `stored_files` sai de `ULTIMAS` se estiver lá; ela não está — a FK nova é de `stored_files` para `patients`, que já é a última.)

- [ ] **Step 4: `salvarArquivo`** — `src/modules/plataforma/armazenamento.ts`:

```ts
export type TipoDeArquivo =
  'logo' | 'capa' | 'exame' | 'plano_pdf' | 'diario_foto' | 'diario_foto_original' | 'orientacao_pdf' | 'exportacao';

/** D4: arquivos com dono (paciente). O resto é do consultório. */
export const TIPOS_DO_PACIENTE: readonly TipoDeArquivo[] = ['exame', 'plano_pdf', 'diario_foto', 'diario_foto_original', 'exportacao'];
```

no `input` de `salvarArquivo`:

```ts
    /** D4: dono do arquivo — obrigatório nos TIPOS_DO_PACIENTE, proibido no resto. */
    patientId?: string;
```

logo no começo da função (antes de `detectarTipo`):

```ts
  if (TIPOS_DO_PACIENTE.includes(input.tipo) !== Boolean(input.patientId)) {
    throw new Error(`salvarArquivo: patientId ${input.patientId ? 'proibido' : 'obrigatório'} para o tipo ${input.tipo}`);
  }
```

e no `insert(storedFiles).values({ … })`: `patientId: input.patientId ?? null,`.

- [ ] **Step 5: Chamadas existentes** — passar `patientId` em todas as chamadas de `salvarArquivo` com tipo de paciente: `src/modules/pacientes/exames.ts` (`patientId` do exame), `src/modules/plano-alimentar/plano-pdf-job.ts` (`plano.patientId`), `src/modules/pacientes/exportacao-job.ts` (`pedido.patientId`). Conferir com `grep -rn "salvarArquivo(" src --include=*.ts | grep -v test` que não sobrou nenhuma (o erro de programação do Step 4 quebra os testes dessas três se faltar). Nos testes que já chamam `salvarArquivo` com tipo de paciente (`armazenamento.test.ts`, `exames.test.ts` e os outros que o `grep -rln "salvarArquivo(" src test` mostrar), passar o `patientId` de um paciente criado com `novoPaciente` no mesmo teste.

- [ ] **Step 6: Exportação por escopo** — `src/modules/pacientes/exportacao-job.ts`:

```ts
export type EscopoExportacao = 'equipe' | 'titular';
```

assinatura `montarDados(tx, patientId, now, fuso, escopo: EscopoExportacao = 'equipe')`; a leitura dos ids dos planos:

```ts
  // P-16 (b): o titular não recebe o rascunho (a sessão de paciente também não o vê — paciente_sem_rascunho)
  const ids = await tx
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.patientId, patientId), escopo === 'titular' ? ne(mealPlans.status, 'rascunho') : undefined))
    .orderBy(asc(mealPlans.versao));
```

e, em `gerarExportacao`, `montarDados(tx, pedido.patientId, now, tenant?.fuso ?? 'America/Sao_Paulo', pedido.escopo as EscopoExportacao)`. (O link e o texto do e-mail por escopo ficam na Tarefa 11.) Atualizar o comentário do tipo `planos` em `DadosExportacao`: "todas as versões; o rascunho só no escopo da equipe".

Run: `pnpm db:migrate && pnpm test src/modules/plataforma src/modules/pacientes src/modules/plano-alimentar test/isolamento.test.ts src/db` → PASS.

- [ ] **Step 7: Commit**

```bash
git add drizzle src/db src/modules/plataforma/armazenamento.ts src/modules/plataforma/armazenamento.test.ts src/modules/pacientes src/modules/plano-alimentar/plano-pdf-job.ts test/isolamento.test.ts
git commit -m "feat(db): stored_files com patient_id e política paciente_arquivos; exportação do titular sem rascunho — P-16 (b, d)"
```

---
### Task 3: Sessão do paciente e vínculos — contexto `conta`, `requirePaciente`, escolher a nutricionista, navegação do portal (base do P06-01)

**Files:**
- Create: `drizzle/0073_conta_vinculos.sql` (custom), `src/modules/portal/vinculos.ts`, `src/modules/portal/vinculos.test.ts`, `src/modules/portal/termo.ts`, `src/modules/portal/termo.test.ts`, `src/app/p/termo/page.tsx`, `src/app/p/termo/termo-form.tsx`, `src/app/p/termo/actions.ts`, `src/lib/paciente-session.ts`, `src/lib/paciente-session.test.ts`, `src/app/p/navegacao.ts`, `src/app/p/navegacao.test.ts`, `src/app/p/nav-portal.tsx`, `src/app/p/(portal)/layout.tsx`, `src/app/p/escolher/page.tsx`, `src/app/p/escolher/actions.ts`, `src/app/p/sem-acesso/page.tsx`, `test/portal.ts`, `e2e/portal.ts`, `e2e/portal.spec.ts`
- Move: `src/app/p/inicio/page.tsx` → `src/app/p/(portal)/inicio/page.tsx`
- Modify: `src/db/tenant.ts`, `src/db/tenant.test.ts`, `src/db/rls-guard.ts` (motivo de `consents`), `test/isolamento.test.ts`, `src/app/n/[slug]/page.tsx`, `src/modules/plataforma/suspensao.ts` (comentário), `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `patients_user_idx` (Tarefa 2); `TERMO_PACIENTE`, `TERMO_PACIENTE_TITULO`, `TERMO_PACIENTE_ROTULO`, `TERMO_PACIENTE_PARAGRAFOS`, `MSG_TERMO_NAO_ACEITO` (`termo-paciente.ts`, Plano 03); `getTenantBrand` (`marca.ts`, Plano 02); `requireUserComTenant`, `SessionData` (`src/lib/session.ts`); `requireApiUser`, `recusaApi` (`src/lib/api-auth.ts`); `buscarTenant` (`tenant-status.ts`); `requestIp`, `clientIp`; `safeReturnPath`, `CURRENT_PATH_HEADER`; `SUSPENDED_PATH`, `homeFor`.
- Produces:
  - `@/db/tenant`: `withConta<T>(userId: string, fn: (tx: Tx) => Promise<T>, db?: Db): Promise<T>`.
  - `@/modules/portal/vinculos`: `type Vinculo = { tenantId: string; patientId: string; nomeNutri: string; tenantStatus: 'ativa' | 'suspensa' }`; `type VinculoQualquer = Vinculo & { pacienteStatus: 'ativo' | 'arquivado' | 'bloqueado'; anonimizado: boolean }`; `vinculosDaConta(userId, o?: { db?: Db; todos?: boolean }): Promise<Vinculo[] | VinculoQualquer[]>` (sem `todos`: só paciente `ativo` e não anonimizado); `escolherVinculo(vinculos: Vinculo[], cookie: string | undefined): { tipo: 'ok'; vinculo: Vinculo } | { tipo: 'escolher' } | { tipo: 'sem_acesso' }`.
  - `@/modules/portal/termo`: `termoAceito(userId: string, tenantId: string, db?: Db): Promise<boolean>`, `aceitarTermo(o: { userId: string; tenantId: string; ip: string | null }, db?: Db): Promise<void>` (US-011 "Nova versão do termo").
  - `@/lib/paciente-session`: `COOKIE_VINCULO = 'nd_vinculo'`, `ESCOLHER_PATH = '/p/escolher'`, `SEM_ACESSO_PATH = '/p/sem-acesso'`, `TERMO_PATH = '/p/termo'`, `type PacienteAccess = { data: SessionData; tenant: TenantRow; vinculo: Vinculo; vinculos: Vinculo[]; ctx: TenantContext }`, `requirePaciente(path: string, o?: { permitirTermoPendente?: boolean }): Promise<PacienteAccess>` (termo da versão atual não aceito neste consultório → `/p/termo`), `type ApiPaciente = ({ ok: true } & PacienteAccess) | { ok: false; response: Response }`, `requireApiPaciente(req: Request): Promise<ApiPaciente>`, `cookieDoVinculo(tenantId: string, secure: boolean): string` (o `Set-Cookie`), `lerCookie(header: string | null, nome: string): string | undefined`.
  - `src/app/p/navegacao.ts`: `type ItemPortal = { href: string; rotulo: string }`, `ITENS_DO_PORTAL: ItemPortal[]` (esta tarefa: só "Início"; cada tarefa seguinte acrescenta o seu), `itemAtual(pathname: string): string | null`.
  - `test/portal.ts`: `pacienteComConta(db, T: TenantDeTeste, extra?: … & { userId?: string; semTermo?: boolean }): Promise<{ paciente: PatientRow; userId: string; email: string }>` (cria `user` paciente + `account` com `SENHA_TESTE`, liga `patients.user_id` e grava o aceite do termo atual, como o convite — menos com `semTermo`).
  - `e2e/portal.ts`: `pacienteNoPortal(browser, nutri: Page, ip: string): Promise<{ page: Page; nome: string; email: string; senha: string; prontuario: string }>` (cadastra pelo painel, aceita o convite pelo Mailpit e devolve a página logada em `/p/inicio`).

- [ ] **Step 1: Migration** — `pnpm drizzle-kit generate --custom --name conta_vinculos`; `drizzle/0073_conta_vinculos.sql`:

```sql
-- D2 (Plano 06): a conta de paciente não tem tenant (§3: pode ser paciente de mais de uma nutricionista). No contexto
-- `conta` (withConta), só esta política libera linhas, e só em patients, só SELECT, só da própria conta. Sem
-- app.tenant_id, tenant_isolation não casa em tabela nenhuma; as RESTRICTIVE (publico_negado, patient_isolation,
-- paciente_sem_*) não se aplicam a este papel ou não são de leitura.
CREATE POLICY paciente_por_conta ON patients AS PERMISSIVE FOR SELECT
  USING (app_current_role() = 'conta' AND user_id = app_current_user());
```

- [ ] **Step 2: `withConta` (falha → passa)** — `src/db/tenant.test.ts`, acrescentar:

```ts
describe('withConta (D2)', () => {
  it('só enxerga em patients as linhas da própria conta, em qualquer tenant; nada mais; não grava', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const userId = randomUUID();
    await app.db.insert(user).values({ id: userId, name: 'Ana', email: `ana-${userId.slice(0, 8)}@teste.dev`, appRole: 'paciente' });
    const pa = await novoPaciente(app.db, A.ctx, { userId });
    const pb = await novoPaciente(app.db, B.ctx, { userId });
    await novoPaciente(app.db, A.ctx); // outro paciente do mesmo tenant
    const vistos = await withConta(userId, (tx) => tx.execute(sql`select id from patients order by id`), app.db);
    expect(vistos.rows.map((r) => r.id).sort()).toEqual([pa.id, pb.id].sort());
    expect((await withConta(userId, (tx) => tx.execute(sql`select 1 from appointments`), app.db)).rows).toEqual([]);
    expect((await withConta(userId, (tx) => tx.execute(sql`select 1 from anthropometry`), app.db)).rows).toEqual([]);
    expect((await withConta(userId, (tx) => tx.execute(sql`update patients set nome = 'x'`), app.db)).rowCount).toBe(0);
    await expect(withConta('nao-e-uuid', async () => 1, app.db)).rejects.toThrow(TenantContextError);
  });
});
```

(com os imports `randomUUID`, `user`, `novoPaciente`, `novoTenant` de `../../test/pacientes`, `sql`.)

`src/db/tenant.ts`, depois de `withTenant`:

```ts
/**
 * D2 (Plano 06): contexto `conta` — a conta de paciente (sem tenant) procurando os próprios vínculos. No banco, só a
 * política `paciente_por_conta` (patients, SELECT, user_id = app.user_id) libera linhas; toda outra tabela dá 0 linhas e
 * nada é gravado. Só src/modules/portal/vinculos.ts usa.
 */
export async function withConta<T>(userId: string, fn: (tx: Tx) => Promise<T>, db: Db = getDb()): Promise<T> {
  if (!UUID.test(userId)) throw new TenantContextError('userId inválido');
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select
        set_config('app.tenant_id', '', true),
        set_config('app.role', 'conta', true),
        set_config('app.patient_id', '', true),
        set_config('app.user_id', ${userId}, true),
        set_config('app.ip', '', true)`);
      return fn(tx);
    });
  } catch (err) {
    throw sanitizarErroDeBanco(err) ?? err;
  }
}
```

`test/isolamento.test.ts`, acrescentar:

```ts
  it('conta (D2): sem tenant, não vê nem grava nada em nenhuma tabela 🔒 (patients só pela política da própria conta)', async () => {
    const outra = randomUUID(); // conta sem vínculo nenhum
    for (const t of tabelas) {
      const vistas = await withConta(outra, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)}`), app.db);
      expect(vistas.rows.length, t).toBe(0);
      await expect(withConta(outra, (tx) => tx.execute(FABRICAS[t](A, P1)), app.db), t).rejects.toSatisfy(violaRls);
    }
  });
```

(o `user` com esse id não existe: a política compara com `app.user_id`, sem FK; importar `withConta`.)

Run: `pnpm db:migrate && pnpm test src/db/tenant.test.ts test/isolamento.test.ts` → PASS.

- [ ] **Step 3: Vínculos (falham → passam)** — `test/portal.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { account, consents, patients, user, type PatientRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { hashPassword } from '@/lib/password.server';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { novoPaciente, type TenantDeTeste } from './pacientes';
import { SENHA_TESTE } from './sessao';

/** Paciente com conta de login ligada (como depois do convite aceito, US-011). `userId` reaproveita uma conta existente. */
export async function pacienteComConta(
  db: Db,
  T: TenantDeTeste,
  extra: Partial<typeof patients.$inferInsert> & { userId?: string; semTermo?: boolean } = {},
): Promise<{ paciente: PatientRow; userId: string; email: string }> {
  let userId = extra.userId;
  let email = extra.email;
  if (!userId) {
    userId = randomUUID();
    email ??= `pac-${userId.slice(0, 8)}@teste.dev`;
    await db.insert(user).values({ id: userId, name: 'Ana Souza', email, emailVerified: true, appRole: 'paciente' });
    await db.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: await hashPassword(SENHA_TESTE) });
  } else {
    email ??= (await db.select({ email: user.email }).from(user).where(eq(user.id, userId)))[0].email;
  }
  const { semTermo, ...colunas } = extra;
  const paciente = await novoPaciente(db, T.ctx, { ...colunas, email, userId });
  await withTenant(T.ctx, (tx) => tx.update(patients).set({ userId }).where(eq(patients.id, paciente.id)), db);
  if (!semTermo) await db.insert(consents).values({ userId, tenantId: T.tenantId, termoVersao: TERMO_PACIENTE, ip: null }).onConflictDoNothing();
  return { paciente: { ...paciente, userId }, userId, email: email! };
}
```

`src/modules/portal/vinculos.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { escolherVinculo, vinculosDaConta, type Vinculo } from './vinculos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('vínculos da conta (D2, §3, RN-08)', () => {
  it('lista os vínculos ativos em todos os tenants, com o nome do consultório; arquivado, bloqueado e anonimizado somem', async () => {
    const A = await novoTenant(app.db, 'Debby Silva');
    const B = await novoTenant(app.db, 'Bia Nutri');
    const C = await novoTenant(app.db, 'Carla');
    const { userId } = await pacienteComConta(app.db, A);
    await pacienteComConta(app.db, B, { userId });
    const { paciente: pc } = await pacienteComConta(app.db, C, { userId });
    await withTenant(C.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, pc.id)), app.db);
    const v = await vinculosDaConta(userId, { db: app.db });
    expect(v.map((x) => x.nomeNutri)).toEqual(['Bia Nutri', 'Debby Silva']);
    expect(v[0]).toMatchObject({ tenantId: B.tenantId, tenantStatus: 'ativa' });
    const todos = await vinculosDaConta(userId, { db: app.db, todos: true });
    expect(todos).toHaveLength(3);
    expect(todos.find((x) => x.tenantId === C.tenantId)).toMatchObject({ pacienteStatus: 'arquivado', anonimizado: false });
  });

  it('tenant suspenso continua na lista (a sessão mostra "Conta temporariamente indisponível")', async () => {
    const A = await novoTenant(app.db);
    const { userId } = await pacienteComConta(app.db, A);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    expect((await vinculosDaConta(userId, { db: app.db }))[0].tenantStatus).toBe('suspensa');
  });

  it('escolherVinculo: 0 → sem acesso; 1 → entra; 2+ → o do cookie, se ainda for vínculo; senão escolher', () => {
    const a: Vinculo = { tenantId: '00000000-0000-4000-8000-00000000000a', patientId: '00000000-0000-4000-8000-0000000000a1', nomeNutri: 'A', tenantStatus: 'ativa' };
    const b: Vinculo = { ...a, tenantId: '00000000-0000-4000-8000-00000000000b', patientId: '00000000-0000-4000-8000-0000000000b1', nomeNutri: 'B' };
    expect(escolherVinculo([], a.tenantId)).toEqual({ tipo: 'sem_acesso' });
    expect(escolherVinculo([a], undefined)).toEqual({ tipo: 'ok', vinculo: a });
    expect(escolherVinculo([a], b.tenantId)).toEqual({ tipo: 'ok', vinculo: a }); // cookie velho/forjado com 1 vínculo: o único
    expect(escolherVinculo([a, b], b.tenantId)).toEqual({ tipo: 'ok', vinculo: b });
    expect(escolherVinculo([a, b], undefined)).toEqual({ tipo: 'escolher' });
    expect(escolherVinculo([a, b], '00000000-0000-4000-8000-00000000000c')).toEqual({ tipo: 'escolher' }); // forjado
  });
});
```

`src/modules/portal/vinculos.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients, tenants } from '@/db/schema';
import { withConta } from '@/db/tenant';

export type Vinculo = { tenantId: string; patientId: string; nomeNutri: string; tenantStatus: 'ativa' | 'suspensa' };
export type VinculoQualquer = Vinculo & { pacienteStatus: 'ativo' | 'arquivado' | 'bloqueado'; anonimizado: boolean };

/**
 * D2 / §3: os vínculos (consultório, prontuário) da conta de paciente. Sem `todos`, só os que dão acesso ao portal
 * (RN-08: arquivado, bloqueado e anonimizado ficam de fora). Contexto `conta`: só patients da própria conta.
 * `tenants` não tem RLS (nome e status do consultório).
 */
export async function vinculosDaConta(userId: string, o?: { db?: Db; todos?: false }): Promise<Vinculo[]>;
export async function vinculosDaConta(userId: string, o: { db?: Db; todos: true }): Promise<VinculoQualquer[]>;
export async function vinculosDaConta(userId: string, o: { db?: Db; todos?: boolean } = {}): Promise<Vinculo[] | VinculoQualquer[]> {
  const linhas = await withConta(
    userId,
    (tx) =>
      tx
        .select({
          tenantId: patients.tenantId,
          patientId: patients.id,
          pacienteStatus: patients.status,
          anonimizadoEm: patients.anonimizadoEm,
          nomeNutri: tenants.nomeExibicao,
          tenantStatus: tenants.status,
        })
        .from(patients)
        .innerJoin(tenants, eq(tenants.id, patients.tenantId))
        .where(eq(patients.userId, userId))
        .orderBy(asc(tenants.nomeExibicao), asc(tenants.id)),
    o.db ?? getDb(),
  );
  const todos = linhas.map((l) => ({
    tenantId: l.tenantId,
    patientId: l.patientId,
    nomeNutri: l.nomeNutri,
    tenantStatus: l.tenantStatus as Vinculo['tenantStatus'],
    pacienteStatus: l.pacienteStatus as VinculoQualquer['pacienteStatus'],
    anonimizado: l.anonimizadoEm !== null,
  }));
  if (o.todos) return todos;
  return todos
    .filter((v) => v.pacienteStatus === 'ativo' && !v.anonimizado)
    .map(({ tenantId, patientId, nomeNutri, tenantStatus }) => ({ tenantId, patientId, nomeNutri, tenantStatus }));
}

/** D3: com 1 vínculo entra direto; com 2+ vale o do cookie, só se ainda for vínculo (cookie velho ou forjado → escolher). */
export function escolherVinculo(
  vinculos: Vinculo[],
  cookie: string | undefined,
): { tipo: 'ok'; vinculo: Vinculo } | { tipo: 'escolher' } | { tipo: 'sem_acesso' } {
  if (!vinculos.length) return { tipo: 'sem_acesso' };
  if (vinculos.length === 1) return { tipo: 'ok', vinculo: vinculos[0] };
  const doCookie = vinculos.find((v) => v.tenantId === cookie);
  return doCookie ? { tipo: 'ok', vinculo: doCookie } : { tipo: 'escolher' };
}
```

Run: `pnpm test src/modules/portal/vinculos.test.ts` → PASS.

- [ ] **Step 4: Sessão do paciente (falha → passa)** — `src/lib/paciente-session.test.ts` (mesmo molde de `tenant-session.test.ts`: `next/headers` e `next/navigation` simulados, banco real):

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { novoTenant } from '../../test/pacientes';
import { pacienteComConta } from '../../test/portal';
import { criarEEntrar, entrar } from '../../test/sessao';
import { getAuth } from './auth';

const req = vi.hoisted(() => ({ headers: new Headers() }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () => req.headers,
  cookies: async () => {
    const pares = (req.headers.get('cookie') ?? '').split(';').map((c) => c.trim().split('='));
    return { get: (nome: string) => { const p = pares.find(([n]) => n === nome); return p ? { name: nome, value: p.slice(1).join('=') } : undefined; } };
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireApiPaciente, requirePaciente, cookieDoVinculo } = await import('./paciente-session');
const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

async function logado(vinculos = 1) {
  const A = await novoTenant(db, 'Debby');
  const { userId, paciente, email } = await pacienteComConta(db, A);
  const outros = [];
  for (let i = 1; i < vinculos; i++) {
    const T = await novoTenant(db, `Nutri ${i}`);
    outros.push({ T, ...(await pacienteComConta(db, T, { userId })) });
  }
  const cookie = await entrar(getAuth(), email);
  req.headers = new Headers({ cookie, 'x-forwarded-for': '203.0.113.30' });
  return { A, userId, paciente, outros, cookie };
}

describe('requirePaciente (D2, D3, RN-08, RN-15)', () => {
  it('um vínculo: entra com o contexto do paciente (tenant, paciente, ator, IP)', async () => {
    const { A, userId, paciente } = await logado();
    const r = await requirePaciente('/p/inicio');
    expect(r.ctx).toEqual({ tenantId: A.tenantId, role: 'paciente', patientId: paciente.id, actorUserId: userId, ip: '203.0.113.30' });
    expect(r.tenant.id).toBe(A.tenantId);
  });

  it('dois vínculos sem cookie → /p/escolher; com o cookie de um deles → entra nele; cookie forjado → /p/escolher', async () => {
    const { outros, cookie } = await logado(2);
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' });
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${outros[0].T.tenantId}` });
    expect((await requirePaciente('/p/plano')).ctx.patientId).toBe(outros[0].paciente.id);
    req.headers = new Headers({ cookie: `${cookie}; nd_vinculo=${randomUUID()}` });
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/escolher?volta=%2Fp%2Fplano' });
  });

  it('arquivado → /p/sem-acesso (RN-08); tenant suspenso → /indisponivel (RN-15)', async () => {
    const { A, paciente } = await logado();
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, paciente.id)), db);
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/p/sem-acesso' });
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, paciente.id)), db);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, A.tenantId));
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/indisponivel' });
  });

  it('termo da versão atual não aceito neste consultório → /p/termo (US-011 "Nova versão do termo"); a própria página do termo entra', async () => {
    const A = await novoTenant(db);
    const { email } = await pacienteComConta(db, A, { semTermo: true });
    req.headers = new Headers({ cookie: await entrar(getAuth(), email) });
    await expect(requirePaciente('/p/plano')).rejects.toMatchObject({ url: '/p/termo' });
    expect((await requirePaciente('/p/termo', { permitirTermoPendente: true })).tenant.id).toBe(A.tenantId);
  });

  it('nutricionista no portal vai para a home dela; sem sessão vai para o login', async () => {
    const [t] = await db.insert(tenants).values({ slug: `ps-${randomUUID().slice(0, 8)}`, nomeExibicao: 'X' }).returning();
    const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
    req.headers = new Headers({ cookie: n.cookie });
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/painel' });
    req.headers = new Headers();
    await expect(requirePaciente('/p/inicio')).rejects.toMatchObject({ url: '/entrar?volta=%2Fp%2Finicio' });
  });
});

describe('requireApiPaciente', () => {
  it('401 sem sessão, 403 para outro papel e para sem vínculo/escolha, ok com o contexto', async () => {
    expect((await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST' }))).ok).toBe(false);
    const { A, paciente, cookie } = await logado();
    const r = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie } }));
    expect(r.ok && r.ctx).toMatchObject({ tenantId: A.tenantId, patientId: paciente.id, role: 'paciente' });
    const dois = await logado(2);
    const sem = await requireApiPaciente(new Request('http://x/api/p/acesso', { method: 'POST', headers: { cookie: dois.cookie } }));
    expect(sem.ok ? 200 : sem.response.status).toBe(403);
  });

  it('cookieDoVinculo: httpOnly, SameSite=Lax, 30 dias, Secure só em produção', () => {
    const id = randomUUID();
    expect(cookieDoVinculo(id, false)).toBe(`nd_vinculo=${id}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    expect(cookieDoVinculo(id, true)).toContain('; Secure');
  });
});
```

`src/lib/paciente-session.ts`:

```ts
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import type { TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { MSG_TERMO_NAO_ACEITO } from '@/modules/pacientes/termo-paciente';
import { termoAceito } from '@/modules/portal/termo';
import { escolherVinculo, vinculosDaConta, type Vinculo } from '@/modules/portal/vinculos';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { recusaApi, requireApiUser } from './api-auth';
import { clientIp } from './ip';
import { requestIp } from './request-ip';
import { CURRENT_PATH_HEADER, safeReturnPath } from './safe-return';
import { requireUserComTenant, type SessionData } from './session';
import { SUSPENDED_PATH } from './session-rules';

/** D3: o vínculo (consultório) escolhido. Só o tenantId; reconferido contra vinculosDaConta a cada requisição. */
export const COOKIE_VINCULO = 'nd_vinculo';
export const ESCOLHER_PATH = '/p/escolher';
export const SEM_ACESSO_PATH = '/p/sem-acesso';
/** US-011 "Nova versão do termo": antes de usar o portal, aceitar a versão atual. */
export const TERMO_PATH = '/p/termo';
const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

export type PacienteAccess = { data: SessionData; tenant: TenantRow; vinculo: Vinculo; vinculos: Vinculo[]; ctx: TenantContext };

export function cookieDoVinculo(tenantId: string, secure: boolean): string {
  return `${COOKIE_VINCULO}=${tenantId}; Path=/; Max-Age=${TRINTA_DIAS_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function lerCookie(header: string | null, nome: string): string | undefined {
  for (const parte of (header ?? '').split(';')) {
    const [n, ...v] = parte.trim().split('=');
    if (n === nome) return v.join('=');
  }
  return undefined;
}

/**
 * Entrada de toda página e Server Action do portal (o par do requireNutri): sessão de paciente válida (requireUser),
 * vínculo ativo escolhido (D3, RN-08), consultório não suspenso (RN-15) e o contexto pronto para withTenant.
 */
export async function requirePaciente(path: string, o: { permitirTermoPendente?: boolean } = {}): Promise<PacienteAccess> {
  const { data } = await requireUserComTenant(['paciente'], path);
  const vinculos = await vinculosDaConta(data.user.id);
  const r = escolherVinculo(vinculos, (await cookies()).get(COOKIE_VINCULO)?.value);
  if (r.tipo === 'sem_acesso') redirect(SEM_ACESSO_PATH);
  if (r.tipo === 'escolher') {
    const volta = safeReturnPath((await headers()).get(CURRENT_PATH_HEADER)) ?? path;
    redirect(`${ESCOLHER_PATH}?volta=${encodeURIComponent(volta)}`);
  }
  const tenant = await buscarTenant(getDb(), r.vinculo.tenantId);
  if (!tenant) redirect(SEM_ACESSO_PATH);
  if (tenant.status === 'suspensa') redirect(SUSPENDED_PATH);
  if (!o.permitirTermoPendente && !(await termoAceito(data.user.id, tenant.id))) redirect(TERMO_PATH);
  return {
    data,
    tenant,
    vinculo: r.vinculo,
    vinculos,
    ctx: { tenantId: tenant.id, role: 'paciente', patientId: r.vinculo.patientId, actorUserId: data.user.id, ip: await requestIp() },
  };
}

export type ApiPaciente = ({ ok: true } & PacienteAccess) | { ok: false; response: Response };

/** requirePaciente para Route Handlers: 401/403 (requireApiUser), 403 sem vínculo escolhido, 403 com consultório suspenso. */
export async function requireApiPaciente(req: Request): Promise<ApiPaciente> {
  const auth = await requireApiUser(req, ['paciente']);
  if (!auth.ok) return auth;
  const vinculos = await vinculosDaConta(auth.data.user.id);
  const r = escolherVinculo(vinculos, lerCookie(req.headers.get('cookie'), COOKIE_VINCULO));
  if (r.tipo !== 'ok') return recusaApi(403, 'Acesso negado');
  const tenant = await buscarTenant(getDb(), r.vinculo.tenantId);
  if (!tenant) return recusaApi(403, 'Acesso negado');
  if (tenant.status === 'suspensa') return recusaApi(403, 'Conta temporariamente indisponível');
  if (!(await termoAceito(auth.data.user.id, tenant.id))) return recusaApi(403, MSG_TERMO_NAO_ACEITO);
  return {
    ok: true,
    data: auth.data,
    tenant,
    vinculo: r.vinculo,
    vinculos,
    ctx: { tenantId: tenant.id, role: 'paciente', patientId: r.vinculo.patientId, actorUserId: auth.data.user.id, ip: clientIp(req.headers, getEnv().TRUSTED_PROXIES) },
  };
}
```

Run: `pnpm test src/lib/paciente-session.test.ts` → PASS.

- [ ] **Step 5: Escolher a nutricionista e "sem acesso"** — `src/app/p/escolher/actions.ts`:

```ts
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { COOKIE_VINCULO } from '@/lib/paciente-session';
import { safeReturnPath } from '@/lib/safe-return';
import { requireUser } from '@/lib/session';
import { vinculosDaConta } from '@/modules/portal/vinculos';

/** D3: grava o vínculo escolhido — só se for mesmo um vínculo ativo da conta (o tenantId do formulário não é confiável). */
export async function escolherAction(tenantId: string, volta: string): Promise<void> {
  const { user } = await requireUser(['paciente'], '/p/escolher');
  const v = (await vinculosDaConta(user.id)).find((x) => x.tenantId === tenantId);
  if (!v) redirect('/p/escolher');
  (await cookies()).set(COOKIE_VINCULO, v.tenantId, {
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().APP_URL.startsWith('https://'),
  });
  redirect(safeReturnPath(volta)?.startsWith('/p/') ? safeReturnPath(volta)! : '/p/inicio');
}
```

`src/app/p/escolher/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { SEM_ACESSO_PATH } from '@/lib/paciente-session';
import { vinculosDaConta } from '@/modules/portal/vinculos';
import { escolherAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function EscolherNutri({ searchParams }: PageProps<'/p/escolher'>) {
  const { user } = await requireUser(['paciente'], '/p/escolher');
  const vinculos = await vinculosDaConta(user.id);
  if (!vinculos.length) redirect(SEM_ACESSO_PATH);
  const { volta } = await searchParams;
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Com qual nutricionista você quer entrar?</h1>
      <ul className="space-y-3">
        {vinculos.map((v) => (
          <li key={v.tenantId}>
            <form action={escolherAction.bind(null, v.tenantId, typeof volta === 'string' ? volta : '/p/inicio')}>
              <button className="min-h-11 w-full rounded border px-4 py-3 text-left">{v.nomeNutri}</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`src/app/p/sem-acesso/page.tsx`:

```tsx
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** RN-08: nenhum vínculo ativo (arquivado, bloqueado ou anonimizado em todos os consultórios). */
export default async function SemAcesso() {
  await requireUser(['paciente'], '/p/sem-acesso');
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Meu acompanhamento</h1>
      <p role="status">Seu acesso ao portal não está ativo. Fale com sua nutricionista.</p>
    </main>
  );
}
```

- [ ] **Step 5b: Novo aceite do termo (US-011 "Nova versão do termo")** — `src/modules/portal/termo.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { aceitarTermo, termoAceito } from './termo';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('termo do paciente por consultório', () => {
  it('sem aceite da versão atual → pendente; aceitar grava uma vez (repetir não duplica) e só vale para aquele consultório', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { userId } = await pacienteComConta(app.db, A, { semTermo: true });
    expect(await termoAceito(userId, A.tenantId, app.db)).toBe(false);
    await aceitarTermo({ userId, tenantId: A.tenantId, ip: '203.0.113.7' }, app.db);
    await aceitarTermo({ userId, tenantId: A.tenantId, ip: '203.0.113.7' }, app.db);
    expect(await termoAceito(userId, A.tenantId, app.db)).toBe(true);
    expect(await termoAceito(userId, B.tenantId, app.db)).toBe(false);
  });
});
```

`src/modules/portal/termo.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { consents } from '@/db/schema';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';

/**
 * US-011 "Nova versão do termo": a conta já aceitou a versão atual NESTE consultório? `consents` fica fora da RLS
 * (RLS_EXCEPTIONS): filtra sempre pela conta e pelo tenant (CLAUDE.md regra 1).
 */
export async function termoAceito(userId: string, tenantId: string, db: Db = getDb()): Promise<boolean> {
  const [c] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.tenantId, tenantId), eq(consents.termoVersao, TERMO_PACIENTE)));
  return Boolean(c);
}

/** Grava o aceite da versão atual (prova de aceite: só INSERT; repetir não duplica — UNIQUE NULLS NOT DISTINCT). */
export async function aceitarTermo(o: { userId: string; tenantId: string; ip: string | null }, db: Db = getDb()): Promise<void> {
  await db.insert(consents).values({ userId: o.userId, tenantId: o.tenantId, termoVersao: TERMO_PACIENTE, ip: o.ip }).onConflictDoNothing();
}
```

`src/app/p/termo/actions.ts`:

```ts
'use server';
import { redirect } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_TERMO_NAO_ACEITO } from '@/modules/pacientes/termo-paciente';
import { aceitarTermo } from '@/modules/portal/termo';

export async function aceitarTermoAction(_: { erro?: string }, formData: FormData): Promise<{ erro?: string }> {
  const { data, tenant, ctx } = await requirePaciente('/p/termo', { permitirTermoPendente: true });
  if (formData.get('aceite') !== 'on') return { erro: MSG_TERMO_NAO_ACEITO };
  await aceitarTermo({ userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null });
  redirect('/p/inicio');
}
```

`src/app/p/termo/termo-form.tsx` (cliente: o botão "Continuar" fica desabilitado até marcar, como no aceite do convite — US-011 "Consentimento obrigatório"):

```tsx
'use client';
import { useActionState, useState } from 'react';
import { TERMO_PACIENTE_ROTULO } from '@/modules/pacientes/termo-paciente';
import { aceitarTermoAction } from './actions';

export function TermoForm() {
  const [estado, enviar, enviando] = useActionState(aceitarTermoAction, {});
  const [marcado, setMarcado] = useState(false);
  return (
    <form action={enviar} className="space-y-3">
      <div className="flex items-start gap-2">
        <input id="aceite" name="aceite" type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} className="mt-1 size-5" />
        <label htmlFor="aceite">{TERMO_PACIENTE_ROTULO}</label>
      </div>
      {estado.erro && <p role="alert" className="text-red-700">{estado.erro}</p>}
      <button disabled={!marcado || enviando} className="min-h-11 rounded bg-emerald-700 px-4 text-white disabled:opacity-50">Continuar</button>
    </form>
  );
}
```

`src/app/p/termo/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { termoAceito } from '@/modules/portal/termo';
import { TermoForm } from './termo-form';

export const dynamic = 'force-dynamic';

export default async function NovoTermo() {
  const { data, tenant } = await requirePaciente('/p/termo', { permitirTermoPendente: true });
  if (await termoAceito(data.user.id, tenant.id)) redirect('/p/inicio');
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{TERMO_PACIENTE_TITULO}</h1>
      {TERMO_PACIENTE_PARAGRAFOS.map((t) => <p key={t}>{t}</p>)}
      <TermoForm />
    </main>
  );
}
```

`src/db/rls-guard.ts`, motivo de `RLS_EXCEPTIONS.consents`: acrescentar `src/modules/portal/termo.ts` (novo aceite no portal) à lista de quem acessa. `src/modules/plataforma/suspensao.ts`: o comentário "Pacientes (Plano 03+) são barrados por vínculo em requireUser (Plano 06)" vira "…barrados por vínculo em requirePaciente (Plano 06, RN-15)".

- [ ] **Step 6: Navegação e layout do portal** — `src/app/p/navegacao.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ITENS_DO_PORTAL, itemAtual } from './navegacao';

describe('navegação do portal (D23)', () => {
  it('todo item fica dentro do escopo /p/ do PWA e marca a página atual, também nas subpáginas', () => {
    for (const i of ITENS_DO_PORTAL) expect(i.href.startsWith('/p/')).toBe(true);
    expect(itemAtual('/p/inicio')).toBe('/p/inicio');
    expect(itemAtual('/p/outra')).toBeNull();
  });
});
```

`src/app/p/navegacao.ts`:

```ts
export type ItemPortal = { href: string; rotulo: string };

/**
 * D23: as abas do portal, em ordem. Cada tarefa do Plano 06 acrescenta a sua; os planos seguintes também
 * ("Conteúdos", Plano 07; depois do MVP, "Exames" e "IA Nutri") — o layout não muda.
 */
export const ITENS_DO_PORTAL: ItemPortal[] = [{ href: '/p/inicio', rotulo: 'Início' }];

/** O item da aba atual (também nas subpáginas: /p/agenda/… marca "Agenda"). */
export function itemAtual(pathname: string): string | null {
  return ITENS_DO_PORTAL.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.href ?? null;
}
```

`src/app/p/nav-portal.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ITENS_DO_PORTAL, itemAtual } from './navegacao';

export function NavPortal() {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Portal" className="sticky bottom-0 border-t bg-white">
      <ul className="flex justify-around">
        {ITENS_DO_PORTAL.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={atual === i.href ? 'page' : undefined} className="flex min-h-11 min-w-11 items-center px-2 text-sm aria-[current=page]:font-semibold aria-[current=page]:underline">
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`src/app/p/(portal)/layout.tsx`:

```tsx
import { requirePaciente } from '@/lib/paciente-session';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { NavPortal } from '../nav-portal';

export const dynamic = 'force-dynamic';

/**
 * Páginas que exigem vínculo escolhido e termo aceito (todas de /p/, menos /p/escolher, /p/sem-acesso e /p/termo).
 * US-005 "Marca aplicada" no PWA: logo e cor da nutricionista no topo.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requirePaciente('/p/inicio');
  const marca = getTenantBrand(tenant);
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 px-6 py-2" style={{ borderBottom: `3px solid ${marca.cor}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, sem otimização do Next */}
        {marca.logoUrl && <img src={marca.logoUrl} alt={`Logo de ${marca.nome}`} className="h-8 w-auto" />}
        <p className="text-sm text-gray-700">{`Acompanhamento com ${marca.nome}`}</p>
      </div>
      <div className="flex-1">{children}</div>
      <NavPortal />
    </div>
  );
}
```

Mover `src/app/p/inicio/page.tsx` para `src/app/p/(portal)/inicio/page.tsx` trocando `requireUser(['paciente'], '/p/inicio')` por `const { data } = await requirePaciente('/p/inicio');` e `user.email` por `data.user.email` (o título "Meu acompanhamento" fica — E2E dos Planos 02 e 03).

- [ ] **Step 7: "Entrar (já sou paciente)" na página pública** — `src/app/n/[slug]/page.tsx`, logo abaixo do título da página ativa:

```tsx
<p><Link href="/entrar?volta=%2Fp%2Finicio" className="underline">Entrar (já sou paciente)</Link></p>
```

(A Tarefa 12 troca o `volta` para `/p/agenda`.)

- [ ] **Step 8: E2E do acesso** — `e2e/portal.ts`:

```ts
import { expect, type Browser, type Page } from '@playwright/test';
import { esperarEmail, primeiroLink } from './mailpit';

let seq = 0;
/** Cadastra pelo painel, aceita o convite pelo Mailpit e devolve o paciente logado no portal. */
export async function pacienteNoPortal(browser: Browser, nutri: Page, ip: string) {
  const sufixo = `${Date.now().toString(36)}${++seq}`;
  const nome = `Paula Portal ${sufixo}`;
  const email = `paula-${sufixo}@nutridebby.test`;
  const senha = `Paula${sufixo}2026`;
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(nome);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-20');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(email);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  const prontuario = new URL(nutri.url()).pathname;
  const convite = await esperarEmail(email, { assunto: 'Convite de Consultório E2E no NutriDebby' });
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  await page.goto(primeiroLink(convite.texto, '/convite/paciente/'));
  await page.getByLabel('Nova senha').fill(senha);
  await page.getByLabel('Repita a senha').fill(senha);
  await page.getByLabel(/^Li e aceito o Termo de Uso e Privacidade \(versão /).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  return { page, nome, email, senha, prontuario };
}
```

`e2e/portal.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.8.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('portal: o paciente entra no consultório, vê a navegação; arquivado perde o acesso e desarquivado volta (RN-08)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.2');
  await expect(p.page.getByText('Acompanhamento com Consultório E2E')).toBeVisible();
  await expect(p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
  await nutri.goto(`${p.prontuario}/privacidade`);
  nutri.once('dialog', (d) => d.accept()); // ConfirmarBotao usa window.confirm
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page).toHaveURL(/\/p\/sem-acesso$/);
  await expect(p.page.getByRole('status')).toHaveText('Seu acesso ao portal não está ativo. Fale com sua nutricionista.');
  await nutri.getByRole('button', { name: 'Desarquivar paciente' }).click();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: 'Meu acompanhamento' })).toBeVisible();
  await p.page.context().close();
});

test('nutricionista em /p/inicio volta ao painel', async () => {
  await nutri.goto('/p/inicio');
  await expect(nutri).toHaveURL(/\/painel$/);
});
```

Run: `pnpm build && pnpm test:e2e e2e/portal.spec.ts e2e/pacientes.spec.ts` → PASS.

- [ ] **Step 9: CLAUDE.md** — regra 1 (`vinculos.ts` não toca a tabela `user`, então não entra na lista dela): acrescentar uma frase nova depois da primeira: "O contexto `conta` (`withConta`, Plano 06, D2) só é usado por `src/modules/portal/vinculos.ts` e só lê `patients` da própria conta (política `paciente_por_conta`)." E, na frase sobre `consents`, acrescentar `src/modules/portal/termo.ts` (novo aceite do termo no portal, US-011) à lista de quem a acessa.

- [ ] **Step 10: Commit**

```bash
git add drizzle src/db/tenant.ts src/db/tenant.test.ts src/db/rls-guard.ts src/modules/plataforma/suspensao.ts src/modules/portal src/lib/paciente-session.ts src/lib/paciente-session.test.ts src/app/p src/app/n test/portal.ts test/isolamento.test.ts e2e/portal.ts e2e/portal.spec.ts CLAUDE.md
git commit -m "feat(portal): sessão do paciente por vínculo (contexto conta, requirePaciente, escolher nutricionista) e navegação do portal"
```

---
### Task 4: "Meu plano" — refeições em ordem, próxima refeição, medidas, substituições e PDF (P06-03, US-041)

**Files:**
- Create: `src/modules/portal/plano.ts`, `src/modules/portal/plano.test.ts`, `src/app/p/(portal)/plano/page.tsx`, `src/app/api/p/plano/pdf/route.ts`, `src/app/api/p/plano/pdf/route.test.ts`
- Modify: `src/app/p/navegacao.ts` (item "Plano"), `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: `lerPlanoNaTransacao`, `PlanoCompleto` (Plano 04); `nutrientesDoItem`, `totalDoDia`, `kcalTexto` (`calculo.ts`); `formatarDecimal`, `casasDecimais` (`@/lib/numero`); `partesNoFuso` (`@/modules/agenda/fuso`); `requirePaciente`, `requireApiPaciente` (Tarefa 3); `signFileUrl`.
- Produces:
  - `@/modules/portal/plano`: `type ItemDoPaciente = { id: string; nome: string; quantidade: string; kcal: string | null; substituicoes: { id: string; nome: string; quantidade: string; kcal: string | null }[] }`; `type RefeicaoDoPaciente = { id: string; nome: string; horario: string; observacao: string; itens: ItemDoPaciente[] }`; `type PlanoDoPaciente = { id: string; titulo: string; orientacoes: string; totalKcal: string | null; refeicoes: RefeicaoDoPaciente[]; proximaRefeicaoId: string | null; pdf: 'pronto' | 'pendente' | 'indisponivel' }`; `proximaRefeicao(horarios: { id: string; horario: string }[], agoraHHMM: string): string | null`; `quantidadeDoItem(i: { quantidadeG: number; medidaCaseiraTxt: string | null }): string`; `planoDoPaciente(ctx: TenantContext, fuso: string, o?: { db?: Db; agora?: Date }): Promise<PlanoDoPaciente | null>`; `caminhoDoPdf(ctx: TenantContext, db?: Db): Promise<{ estado: 'pronto'; caminho: string } | { estado: 'pendente' | 'indisponivel' }>`; `MSG_PLANO_PACIENTE = { semPlano: 'Sua nutricionista ainda está preparando seu plano', pdfPreparando: 'Seu PDF está sendo preparado. Volte em alguns minutos.' }`.
  - Rota `GET /api/p/plano/pdf` → 303 para a URL assinada do PDF; sem PDF pronto → 303 para `/p/plano?pdf=preparando`.

- [ ] **Step 1: Testes (falham)** — `src/modules/portal/plano.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { caminhoDoPdf, planoDoPaciente, proximaRefeicao, quantidadeDoItem } from './plano';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // publicarPlano enfileira o PDF
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';

/** Plano publicado com café (07:00, pão + substituição) e almoço (12:30, arroz 100 g). */
async function planoPublicado() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, { db: app.db });
  const [r] = await withTenant(T.ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, id)), app.db);
  const [cafe, almoco, pao, sub, arroz] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await salvarRascunho(
    T.ctx,
    id,
    {
      revisao: r.revisao,
      envio: randomUUID(),
      titulo: 'Plano de setembro',
      metaKcal: '',
      mostrarCalorias: true,
      orientacoes: 'Beba água.',
      refeicoes: [
        { id: cafe, nome: 'Café da manhã', horario: '07:00', observacao: '', itens: [
          { id: pao, foodId: idTaco(3), quantidadeG: '50', medida: { nome: 'colher de sopa', plural: 'colheres de sopa', gramas: 25, qtd: 2 }, substituiItemId: null },
          { id: sub, foodId: idTaco(3), quantidadeG: '30', medida: null, substituiItemId: pao },
        ] },
        { id: almoco, nome: 'Almoço', horario: '12:30', observacao: 'Sem pressa', itens: [
          { id: arroz, foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null },
        ] },
      ],
    },
    { db: app.db },
  );
  await publicarPlano(T.ctx, p.id, id, { db: app.db });
  return { T, p, planId: id };
}

describe('Meu plano (US-041)', () => {
  it('refeições em ordem de horário, medida caseira e gramas, substituições no item, kcal se o plano mostra', async () => {
    const { T, p } = await planoPublicado();
    const plano = await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') });
    expect(plano!.refeicoes.map((r) => [r.nome, r.horario])).toEqual([['Café da manhã', '07:00'], ['Almoço', '12:30']]);
    const pao = plano!.refeicoes[0].itens[0];
    expect(pao).toMatchObject({ nome: 'Arroz, tipo 1, cozido', quantidade: '2 colheres de sopa (50 g)', kcal: '64 kcal' });
    expect(pao.substituicoes).toEqual([expect.objectContaining({ quantidade: '30 g' })]);
    expect(plano!.refeicoes[0].itens).toHaveLength(1); // a substituição não vira item principal
    expect(plano!.orientacoes).toBe('Beba água.');
  });

  it('próxima refeição no fuso do tenant: 10:00 de Brasília → almoço; 21:00 → o café do dia seguinte', async () => {
    const { T, p } = await planoPublicado();
    const ctx = ctxPaciente(T.tenantId, p.id);
    const as10 = await planoDoPaciente(ctx, SP, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') }); // 10:00 em SP
    expect(as10!.refeicoes.find((r) => r.id === as10!.proximaRefeicaoId)!.nome).toBe('Almoço');
    const as21 = await planoDoPaciente(ctx, SP, { db: app.db, agora: new Date('2026-10-06T00:00:00Z') }); // 21:00 em SP
    expect(as21!.refeicoes.find((r) => r.id === as21!.proximaRefeicaoId)!.nome).toBe('Café da manhã');
    expect(proximaRefeicao([], '10:00')).toBeNull();
    expect(proximaRefeicao([{ id: 'x', horario: '12:30' }], '12:30')).toBe('x'); // na hora ainda é a próxima
  });

  it('sem plano publicado → null (o rascunho não aparece: paciente_sem_rascunho)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await criarRascunho(T.ctx, p.id, { db: app.db });
    expect(await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db })).toBeNull();
  });

  it('leitura auditada com o paciente como ator (D22); PDF pronto devolve o caminho, senão pendente', async () => {
    const { T, p, planId } = await planoPublicado();
    const ctx = { ...ctxPaciente(T.tenantId, p.id), actorUserId: T.nutriId }; // qualquer conta serve para conferir o ator
    await planoDoPaciente(ctx, SP, { db: app.db });
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'plano_alimentar'))), app.db);
    expect(lidas.at(-1)?.actorUserId).toBe(T.nutriId);
    expect(await caminhoDoPdf(ctxPaciente(T.tenantId, p.id), app.db)).toEqual({ estado: 'pendente' }); // o worker não rodou
    await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ pdfStatus: 'pronto', pdfPath: null }).where(eq(mealPlans.id, planId)), app.db);
    expect(await caminhoDoPdf(ctxPaciente(T.tenantId, p.id), app.db)).toEqual({ estado: 'indisponivel' });
  });

  it('quantidadeDoItem: medida caseira com os gramas; sem medida, só os gramas com vírgula', () => {
    expect(quantidadeDoItem({ quantidadeG: 50, medidaCaseiraTxt: '2 colheres de sopa' })).toBe('2 colheres de sopa (50 g)');
    expect(quantidadeDoItem({ quantidadeG: 12.5, medidaCaseiraTxt: null })).toBe('12,5 g');
  });
});
```

(O corpo segue `CorpoSalvamento` (`tipos.ts`), como o `conteudo()` de `rascunho.test.ts`; o texto "2 colheres de sopa" vem de `textoMedida`. O kcal "64 kcal" é 128 kcal/100 g × 50 g da TACO.)

Run: `pnpm test src/modules/portal/plano.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/portal/plano.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { kcalTexto, nutrientesDoItem, totalDoDia } from '@/modules/plano-alimentar/calculo';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import type { ItemPlano } from '@/modules/plano-alimentar/tipos';

export const MSG_PLANO_PACIENTE = {
  semPlano: 'Sua nutricionista ainda está preparando seu plano',
  pdfPreparando: 'Seu PDF está sendo preparado. Volte em alguns minutos.',
} as const;

export type SubstituicaoDoPaciente = { id: string; nome: string; quantidade: string; kcal: string | null };
export type ItemDoPaciente = SubstituicaoDoPaciente & { substituicoes: SubstituicaoDoPaciente[] };
export type RefeicaoDoPaciente = { id: string; nome: string; horario: string; observacao: string; itens: ItemDoPaciente[] };
export type PlanoDoPaciente = {
  id: string;
  titulo: string;
  orientacoes: string;
  totalKcal: string | null;
  refeicoes: RefeicaoDoPaciente[];
  proximaRefeicaoId: string | null;
  pdf: 'pronto' | 'pendente' | 'indisponivel';
};

/** O mesmo texto do PDF (US-026): medida caseira com os gramas, ou só os gramas. */
export function quantidadeDoItem(i: { quantidadeG: number; medidaCaseiraTxt: string | null }): string {
  const g = `${formatarDecimal(i.quantidadeG, casasDecimais(i.quantidadeG))} g`;
  return i.medidaCaseiraTxt ? `${i.medidaCaseiraTxt} (${g})` : g;
}

/** A primeira refeição a partir de agora (HH:MM no fuso do tenant); depois da última, a primeira do dia seguinte. */
export function proximaRefeicao(horarios: { id: string; horario: string }[], agoraHHMM: string): string | null {
  const ordem = [...horarios].sort((a, b) => a.horario.localeCompare(b.horario));
  return (ordem.find((r) => r.horario >= agoraHHMM) ?? ordem[0])?.id ?? null;
}

const kcalDo = (i: ItemPlano, mostrar: boolean): string | null => {
  if (!mostrar) return null;
  const n = nutrientesDoItem(i.porCem, i.quantidadeG);
  return n.semValor.includes('kcal') ? null : `${kcalTexto(n.kcal)} kcal`;
};

/**
 * US-041: o plano publicado do paciente da sessão. A RLS entrega só o dele e nunca o rascunho (paciente_sem_rascunho);
 * os valores são a cópia congelada na publicação (RN-01). Leitura auditada com o paciente como ator (D22).
 */
export async function planoDoPaciente(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<PlanoDoPaciente | null> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('planoDoPaciente só roda em sessão de paciente');
  const plano = await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, ctx.patientId!), eq(mealPlans.status, 'publicado')));
      return p ? lerPlanoNaTransacao(tx, p.id, { comMedidas: false }) : null;
    },
    o.db ?? getDb(),
  );
  if (!plano) return null;
  const mostrar = plano.mostrarCalorias;
  const refeicoes = [...plano.refeicoes]
    .sort((a, b) => a.horario.localeCompare(b.horario))
    .map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: r.horario,
      observacao: r.observacao,
      itens: r.itens
        .filter((i) => i.substituiItemId === null)
        .map((i) => ({
          id: i.id,
          nome: i.nome,
          quantidade: quantidadeDoItem(i),
          kcal: kcalDo(i, mostrar),
          substituicoes: r.itens
            .filter((s) => s.substituiItemId === i.id)
            .map((s) => ({ id: s.id, nome: s.nome, quantidade: quantidadeDoItem(s), kcal: kcalDo(s, mostrar) })),
        })),
    }));
  const total = totalDoDia(plano.refeicoes.map((r) => ({ itens: r.itens.map((i) => ({ id: i.id, quantidadeG: i.quantidadeG, porCem: i.porCem, substituiItemId: i.substituiItemId })) })));
  return {
    id: plano.id,
    titulo: plano.titulo,
    orientacoes: plano.orientacoes,
    totalKcal: mostrar ? `${kcalTexto(total.kcal)} kcal` : null,
    refeicoes,
    proximaRefeicaoId: proximaRefeicao(refeicoes, partesNoFuso(o.agora ?? new Date(), fuso).hora),
    pdf: plano.pdfStatus === 'pronto' && plano.pdfPath ? 'pronto' : plano.pdfStatus === 'pendente' || plano.pdfStatus === null ? 'pendente' : 'indisponivel',
  };
}

/** "Baixar PDF" (US-041 = o PDF da US-026): só o estado e o caminho interno, para a rota assinar. Sem dado de saúde: sem auditoria. */
export async function caminhoDoPdf(ctx: TenantContext, db: Db = getDb()): Promise<{ estado: 'pronto'; caminho: string } | { estado: 'pendente' | 'indisponivel' }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('caminhoDoPdf só roda em sessão de paciente');
  const [p] = await withTenant(
    ctx,
    (tx) => tx.select({ status: mealPlans.pdfStatus, caminho: mealPlans.pdfPath }).from(mealPlans).where(and(eq(mealPlans.patientId, ctx.patientId!), eq(mealPlans.status, 'publicado'))),
    db,
  );
  if (p?.status === 'pronto' && p.caminho) return { estado: 'pronto', caminho: p.caminho };
  return { estado: !p || p.status === 'falhou' || p.status === 'pronto' ? 'indisponivel' : 'pendente' };
}
```

Run: `pnpm test src/modules/portal/plano.test.ts` → PASS.

- [ ] **Step 3: Rota do PDF (teste falha → passa)** — `src/app/api/p/plano/pdf/route.test.ts` (molde dos testes de rota do painel: `requireApiPaciente` simulado com `vi.mock('@/lib/paciente-session')`):

```ts
import { describe, expect, it, vi } from 'vitest';

const acesso = vi.hoisted(() => ({ atual: null as unknown }));
const pdf = vi.hoisted(() => ({ atual: { estado: 'pendente' } as unknown }));
vi.mock('@/lib/paciente-session', () => ({ requireApiPaciente: async () => acesso.atual }));
vi.mock('@/modules/portal/plano', () => ({ caminhoDoPdf: async () => pdf.atual }));
vi.mock('@/lib/signed-url', () => ({ signFileUrl: (c: string) => `/api/arquivos?c=${c}` }));
const { GET } = await import('./route');

describe('GET /api/p/plano/pdf', () => {
  it('sem sessão: a resposta de recusa', async () => {
    acesso.atual = { ok: false, response: new Response(null, { status: 401 }) };
    expect((await GET(new Request('http://x/api/p/plano/pdf'))).status).toBe(401);
  });
  it('pronto → 303 para a URL assinada; senão → 303 para /p/plano?pdf=preparando', async () => {
    acesso.atual = { ok: true, ctx: {} };
    pdf.atual = { estado: 'pronto', caminho: 't/plano_pdf/a.pdf' };
    const r = await GET(new Request('http://x/api/p/plano/pdf'));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/api/arquivos?c=t/plano_pdf/a.pdf');
    pdf.atual = { estado: 'pendente' };
    expect((await GET(new Request('http://x/api/p/plano/pdf'))).headers.get('location')).toBe('/p/plano?pdf=preparando');
  });
});
```

`src/app/api/p/plano/pdf/route.ts`:

```ts
import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdf } from '@/modules/portal/plano';

export const dynamic = 'force-dynamic';

const para = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });

/** US-041 "Baixar PDF": a URL assinada (5 min) nasce aqui, na hora do clique — nunca fica no HTML guardado offline (D6). */
export async function GET(req: Request): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const r = await caminhoDoPdf(acesso.ctx);
  return r.estado === 'pronto' ? para(signFileUrl(r.caminho)) : para('/p/plano?pdf=preparando');
}
```

- [ ] **Step 4: Página** — `src/app/p/(portal)/plano/page.tsx`

```tsx
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_PLANO_PACIENTE, planoDoPaciente } from '@/modules/portal/plano';

export const dynamic = 'force-dynamic';

export default async function MeuPlano({ searchParams }: PageProps<'/p/plano'>) {
  const { ctx, tenant } = await requirePaciente('/p/plano');
  const plano = await planoDoPaciente(ctx, tenant.fuso);
  const { pdf } = await searchParams;
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Plano</h1>
      {!plano ? (
        <p role="status">{MSG_PLANO_PACIENTE.semPlano}</p>
      ) : (
        <>
          <h2 className="text-lg">{plano.titulo}</h2>
          {plano.totalKcal && <p>{`Total do dia: ${plano.totalKcal}`}</p>}
          {pdf === 'preparando' && <p role="status">{MSG_PLANO_PACIENTE.pdfPreparando}</p>}
          {plano.pdf !== 'indisponivel' && (
            <a href="/api/p/plano/pdf" className="inline-flex min-h-11 items-center rounded border px-4">Baixar PDF</a>
          )}
          <ol className="space-y-4">
            {plano.refeicoes.map((r) => {
              const proxima = r.id === plano.proximaRefeicaoId;
              return (
                <li key={r.id} aria-labelledby={`ref-${r.id}`} className={proxima ? 'rounded border-2 border-emerald-700 p-3' : 'rounded border p-3'}>
                  <h3 id={`ref-${r.id}`} className="font-semibold">
                    {`${r.nome} · ${r.horario}`}
                    {proxima && <span className="ml-2 rounded bg-emerald-700 px-2 text-sm text-white">Próxima refeição</span>}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {r.itens.map((i) => (
                      <li key={i.id}>
                        {i.substituicoes.length ? (
                          <details>
                            <summary className="min-h-11 cursor-pointer" aria-label={`Ver substituições de ${i.nome}`}>
                              {`${i.nome} — ${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}
                            </summary>
                            <p className="mt-1 text-sm font-medium">Substituições</p>
                            <ul className="ml-4 list-disc text-sm">
                              {i.substituicoes.map((s) => <li key={s.id}>{`${s.nome} — ${s.quantidade}${s.kcal ? ` · ${s.kcal}` : ''}`}</li>)}
                            </ul>
                          </details>
                        ) : (
                          <span>{`${i.nome} — ${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {r.observacao && <p className="mt-2 text-sm italic">{r.observacao}</p>}
                </li>
              );
            })}
          </ol>
          {plano.orientacoes && (
            <section aria-labelledby="orientacoes-plano">
              <h2 id="orientacoes-plano" className="font-semibold">Orientações</h2>
              <p className="whitespace-pre-line">{plano.orientacoes}</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
```

`src/app/p/navegacao.ts`: `ITENS_DO_PORTAL` passa a `[{ href: '/p/inicio', rotulo: 'Início' }, { href: '/p/plano', rotulo: 'Plano' }]`.

- [ ] **Step 5: E2E** — `e2e/portal.spec.ts`, acrescentar (usa o editor do Plano 04 pela nutricionista):

```ts
test('Meu plano: sem plano → "Sua nutricionista ainda está preparando seu plano"; publicado → refeições e PDF (US-041)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.3');
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('status')).toHaveText('Sua nutricionista ainda está preparando seu plano');
  await publicarPlanoSimples(nutri, p.prontuario); // e2e/portal.ts
  await p.page.reload();
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByText('Chuchu, cozido — 100 g')).toBeVisible();
  await expect(p.page.getByRole('link', { name: 'Baixar PDF' })).toBeVisible();
  await p.page.context().close();
});
```

e, em `e2e/portal.ts` (mesmos passos e rótulos de `e2e/plano-alimentar.spec.ts`):

```ts
/** Rascunho com "Almoço 12:00 · Chuchu, cozido 100 g" publicado pela nutricionista (US-022, US-025). */
export async function publicarPlanoSimples(nutri: Page, prontuario: string) {
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).fill('Almoço');
  await nutri.getByLabel('Horário de Almoço').fill('12:00');
  await nutri.getByLabel('Adicionar alimento em Almoço').fill('chuchu cozido');
  await nutri.getByRole('option', { name: /Chuchu, cozido/ }).click();
  await nutri.getByLabel('Gramas de Chuchu, cozido').fill('100');
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10_000 });
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
}
```

(Chuchu não tem medida caseira no seed do IBGE: o item abre direto em gramas. Os testes deste plano que usam `publicarPlanoSimples` esperam "Chuchu, cozido — 100 g".)

Run: `pnpm build && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/portal/plano.ts src/modules/portal/plano.test.ts "src/app/p/(portal)/plano" src/app/api/p/plano src/app/p/navegacao.ts e2e/portal.ts e2e/portal.spec.ts
git commit -m "feat(portal): Meu plano — refeições em ordem, próxima refeição, substituições e PDF (US-041)"
```

---
### Task 5: PWA — ícones e manifest, "Meu plano" offline, instalar (Android e iPhone), selo offline e "Sair" que limpa o aparelho (P06-01, US-040)

**Files:**
- Create: `public/icones/icone.svg`, `scripts/gerar-icones.ts`, `public/icones/icone-192.png`, `public/icones/icone-512.png`, `public/icones/icone-maskable-512.png`, `public/icones/apple-touch-icon.png` (gerados pelo script), `src/app/sw-regras.ts`, `src/app/sw-regras.test.ts`, `src/app/p/instalacao.ts`, `src/app/p/instalacao.test.ts`, `src/app/p/instalar.tsx`, `src/app/p/selo-offline.tsx`, `src/app/p/sair-portal.tsx`, `src/app/p/plano-guardado.tsx`, `src/app/api/p/ping/route.ts`
- Modify: `src/app/sw.ts`, `src/app/manifest.ts`, `src/app/manifest.test.ts`, `src/app/p/layout.tsx`, `src/app/p/(portal)/layout.tsx`, `src/app/p/(portal)/inicio/page.tsx`, `src/app/p/(portal)/plano/page.tsx`, `src/app/entrar/page.tsx`, `src/lib/paciente-session.ts` (+test), `src/app/sair/route.ts`, `src/app/sair/route.test.ts`, `package.json` (script `icones`), `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: Serwist (`serwist` 9.5.12: `Serwist`, `NetworkFirst`, `NetworkOnly`; `@serwist/turbopack`: `createSerwistRoute`, `SerwistProvider` — spike P01-15); `sharp` (só no script); a página `/p/plano` (Tarefa 4).
- Produces:
  - `src/app/sw-regras.ts` (sem DOM, importável pelo service worker e pelo cliente): `CACHE_PLANO = 'nd-plano-v1'`, `URL_PLANO = '/p/plano'`, `ehPaginaDoPlano(url: URL, modo: RequestMode, origem: string): boolean`, `ehNavegacaoDoPortal(url: URL, modo: RequestMode, origem: string): boolean`, `podeGuardarPlano(r: { status: number; type: ResponseType; redirected: boolean; url: string; headers: Headers }, origem: string): boolean`, `ehSemSessao(r: { redirected: boolean; url: string }, origem: string): boolean`, `type MensagemAoSw = { tipo: 'dono'; dono: string } | { tipo: 'plano'; dono: string; versao: string }`, `lerMensagem(data: unknown): MensagemAoSw | null`, `precisaBuscarPlano(guardado: { dono: string | null; versao: string | null; guardadoEm: string | null } | null, pedido: { dono: string; versao: string }, agoraMs: number): boolean`, `planoValido(guardadoEm: string | null, agoraMs: number): boolean`, `VALIDADE_PLANO_MS` (30 dias), `RENOVAR_PLANO_MS` (1 dia), `CABECALHO_DONO`/`CABECALHO_VERSAO`/`CABECALHO_GUARDADO_EM`, `esquecerPlanoGuardado(): Promise<boolean>`.
  - `src/app/p/plano-guardado.tsx` (cliente): `DonoDoAparelho({ dono })` (layout do portal: plano guardado de outra conta ou de outro vínculo sai) e `GuardarPlano({ dono, versao })` (página "Meu plano": pede ao service worker para guardar o HTML desta conta).
  - `@/lib/paciente-session`: `cookieDoVinculoApagado(secure: boolean): string`.
  - `src/app/p/instalacao.ts`: `type EstadoInstalacao = 'instalado' | 'android' | 'ios' | 'nada'`, `estadoDeInstalacao(o: { ua: string; standalone: boolean; temPrompt: boolean; toques: number; plataforma: string }): EstadoInstalacao`, `ehIos(ua: string, plataforma: string, toques: number): boolean`.
  - `src/app/p/sair-portal.tsx`: `SairPortal()` e `limparAparelho(): Promise<void>` (a Tarefa 6 acrescenta o cancelamento do push).
  - `/sair` responde com `Clear-Site-Data: "cache", "storage"` (com e sem sessão) e apaga o cookie `nd_vinculo`.
  - `GET /api/p/ping` → 204 `no-store` (conectividade do selo offline).

- [ ] **Step 1: Ícones** — `public/icones/icone.svg` (fundo cheio, desenho no centro: serve também de *maskable*, que corta até 20% das bordas):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1d6b5a"/>
  <path fill="#ffffff" d="M256 132c-74 42-114 104-114 166 0 54 40 90 96 96v-88c-26-14-42-40-46-70 32 8 54 28 64 54 10-26 32-46 64-54-4 30-20 56-46 70v88c56-6 96-42 96-96 0-62-40-124-114-166z"/>
</svg>
```

`scripts/gerar-icones.ts`:

```ts
// D21: ícones do PWA a partir do SVG (rodar com `pnpm icones` quando a arte mudar; os PNG ficam no repositório).
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile('public/icones/icone.svg');
const saidas: [string, number][] = [
  ['public/icones/icone-192.png', 192],
  ['public/icones/icone-512.png', 512],
  ['public/icones/icone-maskable-512.png', 512],
  ['public/icones/apple-touch-icon.png', 180],
];
for (const [arquivo, lado] of saidas) {
  await sharp(svg, { density: 384 }).resize(lado, lado).png({ compressionLevel: 9 }).toFile(arquivo);
}
console.log(`ícones gerados: ${saidas.length}`);
```

`package.json`, em `scripts`: `"icones": "tsx scripts/gerar-icones.ts"`. Run: `pnpm icones` → 4 PNG em `public/icones/`.

- [ ] **Step 2: Manifest (falha → passa)** — `src/app/manifest.test.ts`, acrescentar:

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';

  it('instalável (Chrome Android): ícones 192 e 512 que existem em public/, um maskable, id, idioma e cor', () => {
    const m = manifest();
    expect(m.id).toBe('/p/inicio');
    expect(m.lang).toBe('pt-BR');
    expect(m.icons!.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const i of m.icons!) expect(existsSync(path.join('public', i.src)), i.src).toBe(true);
  });
```

`src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/p/inicio',
    name: 'NutriDebby',
    short_name: 'NutriDebby',
    description: 'Seu acompanhamento nutricional',
    lang: 'pt-BR',
    start_url: '/p/inicio',
    scope: '/p/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1d6b5a',
    // D21: arte genérica (o dono pode trocar o SVG e rodar `pnpm icones`)
    icons: [
      { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icones/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

`src/app/p/layout.tsx` ganha (o iPhone usa o `apple-touch-icon` e não lê os ícones do manifest):

```tsx
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'NutriDebby', statusBarStyle: 'default' },
  icons: { apple: '/icones/apple-touch-icon.png' },
};
export const viewport: Viewport = { themeColor: '#1d6b5a' };
```

Run: `pnpm test src/app/manifest.test.ts` → PASS.

- [ ] **Step 3: Regras do service worker (falham → passam)** — `src/app/sw-regras.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ehNavegacaoDoPortal, ehPaginaDoPlano, ehSemSessao, lerMensagem, planoValido, podeGuardarPlano, precisaBuscarPlano, RENOVAR_PLANO_MS, VALIDADE_PLANO_MS } from './sw-regras';

const O = 'https://nutri.exemplo.com';
const resposta = (o: Partial<{ status: number; type: ResponseType; redirected: boolean; url: string; tipo: string }> = {}) => ({
  status: o.status ?? 200,
  type: o.type ?? ('basic' as ResponseType),
  redirected: o.redirected ?? false,
  url: o.url ?? `${O}/p/plano`,
  headers: new Headers({ 'content-type': o.tipo ?? 'text/html; charset=utf-8' }),
});

describe('regras do cache do PWA (D6, Review Focus 4)', () => {
  it('só a navegação para /p/plano, sem query, da própria origem, é a página guardada', () => {
    expect(ehPaginaDoPlano(new URL(`${O}/p/plano`), 'navigate', O)).toBe(true);
    expect(ehPaginaDoPlano(new URL(`${O}/p/plano?pdf=preparando`), 'navigate', O)).toBe(false);
    expect(ehPaginaDoPlano(new URL(`${O}/p/plano`), 'cors', O)).toBe(false); // RSC/fetch do roteador
    expect(ehPaginaDoPlano(new URL('https://outro.com/p/plano'), 'navigate', O)).toBe(false);
  });
  it('qualquer navegação em /p/ cai no plano guardado sem rede; /api, /painel e /entrar não', () => {
    expect(ehNavegacaoDoPortal(new URL(`${O}/p/diario`), 'navigate', O)).toBe(true);
    expect(ehNavegacaoDoPortal(new URL(`${O}/api/p/acesso`), 'navigate', O)).toBe(false);
    expect(ehNavegacaoDoPortal(new URL(`${O}/painel`), 'navigate', O)).toBe(false);
    expect(ehNavegacaoDoPortal(new URL(`${O}/p/diario`), 'no-cors', O)).toBe(false);
  });
  it('guarda só 200 HTML de /p/plano, não redirecionado (nunca o /entrar de uma sessão vencida, nem redirecionamento opaco)', () => {
    expect(podeGuardarPlano(resposta(), O)).toBe(true);
    expect(podeGuardarPlano(resposta({ redirected: true, url: `${O}/entrar?volta=%2Fp%2Fplano` }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ status: 0, type: 'opaqueredirect' }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ status: 500 }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ url: `${O}/p/escolher` }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ tipo: 'application/json' }), O)).toBe(false);
  });
  it('Review Focus 4: o plano guardado é de uma conta + vínculo (dono) e de uma versão; outro dono → buscar de novo (e o velho sai)', () => {
    const DONO = '0b6f8f1e-3c1a-4f7e-9d2a-1a2b3c4d5e6f';
    const agora = Date.parse('2026-10-05T12:00:00Z');
    const ha = (ms: number) => new Date(agora - ms).toISOString();
    const pedido = { dono: DONO, versao: 'p1' };
    expect(precisaBuscarPlano(null, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(60_000) }, pedido, agora)).toBe(false); // nada mudou: sem segunda busca
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(60_000) }, { dono: DONO, versao: 'p2' }, agora)).toBe(true); // plano novo publicado
    expect(precisaBuscarPlano({ dono: 'outro', versao: 'p1', guardadoEm: ha(60_000) }, pedido, agora)).toBe(true); // outra conta ou outro vínculo
    expect(precisaBuscarPlano({ dono: null, versao: null, guardadoEm: null }, pedido, agora)).toBe(true);
    // mesmo dono e mesma versão, mas cópia com mais de 1 dia: busca de novo para a validade de 30 dias andar junto com a sessão
    // (paciente que abre o portal todo dia com o mesmo plano por mais de 30 dias continua com o plano offline)
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(RENOVAR_PLANO_MS + 60_000) }, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(29 * 24 * 60 * 60 * 1000) }, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: 'lixo' }, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: null }, pedido, agora)).toBe(true);
  });
  it('mensagens ao service worker: só os dois formatos, com textos curtos (nada de objeto arbitrário vindo da página)', () => {
    expect(lerMensagem({ tipo: 'plano', dono: 'd', versao: 'v' })).toEqual({ tipo: 'plano', dono: 'd', versao: 'v' });
    expect(lerMensagem({ tipo: 'dono', dono: 'd' })).toEqual({ tipo: 'dono', dono: 'd' });
    expect(lerMensagem({ tipo: 'plano', dono: 'd' })).toBeNull();
    expect(lerMensagem({ tipo: 'dono', dono: 'x'.repeat(101) })).toBeNull();
    expect(lerMensagem({ tipo: 'apagar-tudo' })).toBeNull();
    expect(lerMensagem('dono')).toBeNull();
  });
  it('sem sessão (a busca terminou no /entrar) → o plano guardado sai; guardado há mais de 30 dias (sessão máxima) não é servido', () => {
    expect(ehSemSessao({ redirected: true, url: `${O}/entrar?volta=%2Fp%2Fplano` }, O)).toBe(true);
    expect(ehSemSessao({ redirected: true, url: `${O}/p/escolher` }, O)).toBe(false);
    expect(ehSemSessao({ redirected: false, url: `${O}/p/plano` }, O)).toBe(false);
    const agora = Date.parse('2026-10-05T12:00:00Z');
    expect(planoValido(new Date(agora - VALIDADE_PLANO_MS + 60_000).toISOString(), agora)).toBe(true);
    expect(planoValido(new Date(agora - VALIDADE_PLANO_MS - 60_000).toISOString(), agora)).toBe(false);
    expect(planoValido(null, agora)).toBe(false);
    expect(planoValido('lixo', agora)).toBe(false);
  });
});
```

`src/app/sw-regras.ts`:

```ts
/**
 * D6: o que o service worker guarda. Sem DOM nem Node: o mesmo arquivo vai para o service worker (esbuild do Serwist)
 * e para o cliente (o "Sair" apaga o cache pelo nome).
 */
export const CACHE_PLANO = 'nd-plano-v1';
export const URL_PLANO = '/p/plano';

export function ehPaginaDoPlano(url: URL, modo: RequestMode, origem: string): boolean {
  return modo === 'navigate' && url.origin === origem && url.pathname === URL_PLANO && url.search === '';
}

export function ehNavegacaoDoPortal(url: URL, modo: RequestMode, origem: string): boolean {
  return modo === 'navigate' && url.origin === origem && url.pathname.startsWith('/p/');
}

export function podeGuardarPlano(r: { status: number; type: ResponseType; redirected: boolean; url: string; headers: Headers }, origem: string): boolean {
  if (r.status !== 200 || r.type !== 'basic' || r.redirected) return false;
  const u = new URL(r.url);
  return u.origin === origem && u.pathname === URL_PLANO && (r.headers.get('content-type') ?? '').startsWith('text/html');
}

/** A busca do plano terminou no login: não há sessão (vencida, ou outra pessoa no aparelho) — o guardado sai. */
export function ehSemSessao(r: { redirected: boolean; url: string }, origem: string): boolean {
  if (!r.redirected || !URL.canParse(r.url)) return false;
  const u = new URL(r.url);
  return u.origin === origem && u.pathname === '/entrar';
}

/**
 * Review Focus 4 (aparelho compartilhado): o HTML guardado leva de quem é (`dono` = o paciente da sessão, isto é, conta +
 * vínculo) e de qual versão do plano, nestes cabeçalhos da cópia em Cache Storage (nunca vão para a rede).
 */
export const CABECALHO_DONO = 'x-nd-dono';
export const CABECALHO_VERSAO = 'x-nd-versao';
export const CABECALHO_GUARDADO_EM = 'x-nd-guardado-em';
/** O mesmo prazo da sessão (que desliza, P06-11): uma cópia mais velha que isto não tem sessão viva por trás. */
export const VALIDADE_PLANO_MS = 30 * 24 * 60 * 60 * 1000;
/** Cópia com mais de 1 dia é buscada de novo na visita a "Meu plano" (mesmo dono e versão): a validade anda junto com a sessão. */
export const RENOVAR_PLANO_MS = 24 * 60 * 60 * 1000;

export type MensagemAoSw = { tipo: 'dono'; dono: string } | { tipo: 'plano'; dono: string; versao: string };

const textoCurto = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

/** O que a página pode pedir ao service worker: só estes dois formatos. */
export function lerMensagem(data: unknown): MensagemAoSw | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { tipo?: unknown; dono?: unknown; versao?: unknown };
  if (d.tipo === 'dono' && textoCurto(d.dono)) return { tipo: 'dono', dono: d.dono };
  if (d.tipo === 'plano' && textoCurto(d.dono) && textoCurto(d.versao)) return { tipo: 'plano', dono: d.dono, versao: d.versao };
  return null;
}

/**
 * Buscar de novo se não há cópia, se ela é de outro dono ou de outra versão do plano, ou se tem mais de 1 dia (no máximo uma
 * renderização extra por dia; sem isso o `guardado-em` nunca andaria e a cópia venceria em 30 dias para quem usa todo dia).
 */
export function precisaBuscarPlano(
  guardado: { dono: string | null; versao: string | null; guardadoEm: string | null } | null,
  pedido: { dono: string; versao: string },
  agoraMs: number,
): boolean {
  if (!guardado || guardado.dono !== pedido.dono || guardado.versao !== pedido.versao) return true;
  const t = guardado.guardadoEm ? Date.parse(guardado.guardadoEm) : Number.NaN;
  return !Number.isFinite(t) || agoraMs - t > RENOVAR_PLANO_MS;
}

export function planoValido(guardadoEm: string | null, agoraMs: number): boolean {
  const t = guardadoEm ? Date.parse(guardadoEm) : Number.NaN;
  return Number.isFinite(t) && agoraMs - t <= VALIDADE_PLANO_MS;
}

/** Página de login e "Sair": o plano guardado sai do aparelho (window e service worker têm `caches`). */
export function esquecerPlanoGuardado(): Promise<boolean> {
  return 'caches' in globalThis ? caches.delete(CACHE_PLANO).catch(() => false) : Promise.resolve(false);
}
```

Run: `pnpm test src/app/sw-regras.test.ts` → PASS.

- [ ] **Step 4: Service worker** — `src/app/sw.ts` inteiro:

```ts
/// <reference lib="webworker" />
import { NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';
import {
  CABECALHO_DONO,
  CABECALHO_GUARDADO_EM,
  CABECALHO_VERSAO,
  CACHE_PLANO,
  URL_PLANO,
  ehNavegacaoDoPortal,
  ehPaginaDoPlano,
  ehSemSessao,
  esquecerPlanoGuardado,
  lerMensagem,
  planoValido,
  podeGuardarPlano,
  precisaBuscarPlano,
} from './sw-regras';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const origem = self.location.origin;
const copia = async (): Promise<Response | undefined> => (await caches.open(CACHE_PLANO)).match(URL_PLANO, { ignoreVary: true });
/** A cópia guardada, se ainda vale (mais velha que a sessão máxima sai). */
const planoGuardado = async (): Promise<Response | undefined> => {
  const r = await copia();
  if (r && !planoValido(r.headers.get(CABECALHO_GUARDADO_EM), Date.now())) {
    await esquecerPlanoGuardado();
    return undefined;
  }
  return r;
};

/**
 * D6 + Review Focus 4: o plano só entra no cache a pedido da própria página "Meu plano" (mensagem `plano`), que diz de
 * quem é (conta + vínculo) e qual versão — a navegação pelo menu do portal é `fetch` do roteador (RSC), não 'navigate',
 * então guardar só na navegação deixaria o cache vazio no uso normal. O service worker busca o HTML com a sessão do
 * aparelho; se ele terminar no /entrar, a cópia sai; cópia de outro dono sai antes de buscar (mesmo se a busca falhar).
 */
async function guardarPlano(dono: string, versao: string): Promise<void> {
  const atual = await copia();
  const guardado = atual
    ? { dono: atual.headers.get(CABECALHO_DONO), versao: atual.headers.get(CABECALHO_VERSAO), guardadoEm: atual.headers.get(CABECALHO_GUARDADO_EM) }
    : null;
  if (!precisaBuscarPlano(guardado, { dono, versao }, Date.now())) return;
  if (guardado && guardado.dono !== dono) await esquecerPlanoGuardado();
  const r = await fetch(URL_PLANO, { credentials: 'same-origin', cache: 'no-store' });
  if (ehSemSessao(r, origem)) {
    await esquecerPlanoGuardado();
    return;
  }
  if (!podeGuardarPlano(r, origem)) return;
  const h = new Headers(r.headers);
  h.set(CABECALHO_DONO, dono);
  h.set(CABECALHO_VERSAO, versao);
  h.set(CABECALHO_GUARDADO_EM, new Date().toISOString());
  // put na mesma chave substitui: o cache continua com 1 entrada
  await (await caches.open(CACHE_PLANO)).put(URL_PLANO, new Response(await r.blob(), { status: 200, headers: h }));
}

/** Layout do portal (toda abertura): cópia de outra conta ou de outro vínculo sai na hora (login de outra pessoa, troca de nutricionista). */
async function conferirDono(dono: string): Promise<void> {
  const atual = await copia();
  if (atual && atual.headers.get(CABECALHO_DONO) !== dono) await esquecerPlanoGuardado();
}

self.addEventListener('message', (e) => {
  if (e.origin !== origem) return;
  const m = lerMensagem(e.data);
  if (!m) return;
  e.waitUntil((m.tipo === 'plano' ? guardarPlano(m.dono, m.versao) : conferirDono(m.dono)).catch(() => undefined));
});

// D6: os estáticos do build (precache) + só o HTML de "Meu plano" (1 entrada, gravada por guardarPlano). Nada de /api,
// foto, PDF ou outra página.
new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // "Meu plano" aberto direto (atalho, recarga): rede primeiro (4 s), senão a cópia. Esta rota NÃO grava — quem grava
      // é guardarPlano, que sabe o dono (a resposta de uma navegação não diz de quem é)
      matcher: ({ request, url }) => ehPaginaDoPlano(url, request.mode, origem),
      handler: new NetworkFirst({
        cacheName: CACHE_PLANO,
        networkTimeoutSeconds: 4,
        matchOptions: { ignoreVary: true },
        plugins: [
          { cacheWillUpdate: async () => null },
          { cachedResponseWillBeUsed: async ({ cachedResponse }) => (cachedResponse && planoValido(cachedResponse.headers.get(CABECALHO_GUARDADO_EM), Date.now()) ? cachedResponse : null) },
        ],
      }),
    },
    {
      // Sem rede, qualquer página do portal mostra o último plano guardado (com o selo offline)
      matcher: ({ request, url }) => ehNavegacaoDoPortal(url, request.mode, origem),
      handler: new NetworkOnly({ plugins: [{ handlerDidError: async () => planoGuardado() }] }),
    },
  ],
}).addEventListeners();
```

(A Tarefa 6 acrescenta os eventos `push` e `notificationclick` a este arquivo.)

`src/app/p/plano-guardado.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import type { MensagemAoSw } from '../sw-regras';

const avisar = (m: MensagemAoSw) => {
  if (!('serviceWorker' in navigator)) return;
  // `ready.active`, não `controller`: na primeira visita a página ainda não é controlada e o pedido não pode se perder
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(m)).catch(() => undefined);
};

/** Layout do portal: a cópia guardada é de outra conta ou de outro vínculo? Sai (Review Focus 4). */
export function DonoDoAparelho({ dono }: { dono: string }) {
  useEffect(() => avisar({ tipo: 'dono', dono }), [dono]);
  return null;
}

/** "Meu plano" exibida (pelo menu, por atalho ou recarga): o service worker guarda esta versão para esta conta (D6). */
export function GuardarPlano({ dono, versao }: { dono: string; versao: string }) {
  useEffect(() => avisar({ tipo: 'plano', dono, versao }), [dono, versao]);
  return null;
}
```

Em `src/app/p/(portal)/plano/page.tsx` (Tarefa 4), logo depois do `<h1>`: `<GuardarPlano dono={ctx.patientId!} versao={plano?.id ?? 'sem-plano'} />` (o plano publicado não muda: plano novo = id novo; a busca do service worker é uma segunda renderização auditada da página — "Visualizou · Plano alimentar" — só quando a versão ou o dono mudam, ou uma vez por dia para renovar a cópia — `RENOVAR_PLANO_MS`). Em `src/app/p/(portal)/layout.tsx`, `const { tenant, ctx } = await requirePaciente('/p/inicio');` e `<DonoDoAparelho dono={ctx.patientId!} />` dentro do `<div>` raiz.

`src/app/entrar/page.tsx`, no `Form`: `useEffect(() => { void esquecerPlanoGuardado(); }, []);` (`useEffect` de `react`, `esquecerPlanoGuardado` de `@/app/sw-regras`) — a tela de login é aonde a sessão vencida (navegação ou `fetch` do roteador) e o "Sair" levam, e por onde outra pessoa entra no mesmo aparelho: o plano guardado sai antes de qualquer login.

- [ ] **Step 5: Selo offline e ping** — `src/app/api/p/ping/route.ts`:

```ts
export const dynamic = 'force-dynamic';

/** D6: o selo offline confere se há rede de verdade ("lie-fi": navigator.onLine verdadeiro e a rede não responde). */
export function GET(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
```

`src/app/p/selo-offline.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

/** US-040 "Offline": "Offline — exibindo última versão" quando a página veio do cache do service worker. */
export function SeloOffline() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      if (!navigator.onLine) return vivo && setOffline(true);
      try {
        const r = await fetch('/api/p/ping', { cache: 'no-store' });
        if (vivo) setOffline(!r.ok);
      } catch {
        if (vivo) setOffline(true);
      }
    };
    void conferir();
    window.addEventListener('online', conferir);
    window.addEventListener('offline', conferir);
    return () => {
      vivo = false;
      window.removeEventListener('online', conferir);
      window.removeEventListener('offline', conferir);
    };
  }, []);
  return offline ? <p role="status" className="bg-amber-100 px-6 py-2 text-amber-900">Offline — exibindo última versão</p> : null;
}
```

Em `src/app/p/(portal)/layout.tsx`, `<SeloOffline />` logo acima do `<div className="flex-1">`.

- [ ] **Step 6: Instalar (falha → passa)** — `src/app/p/instalacao.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { estadoDeInstalacao } from './instalacao';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('instalação do PWA (US-040)', () => {
  it('Android com o prompt nativo → botão "Instalar app"; já instalado → nada', () => {
    expect(estadoDeInstalacao({ ua: ANDROID, standalone: false, temPrompt: true, toques: 5, plataforma: 'Linux armv8l' })).toBe('android');
    expect(estadoDeInstalacao({ ua: ANDROID, standalone: true, temPrompt: false, toques: 5, plataforma: 'Linux armv8l' })).toBe('instalado');
    expect(estadoDeInstalacao({ ua: ANDROID, standalone: false, temPrompt: false, toques: 5, plataforma: 'Linux armv8l' })).toBe('nada');
  });
  it('Safari no iPhone (e no iPad, que se diz Mac) fora do modo standalone → tutorial; instalado → nada', () => {
    expect(estadoDeInstalacao({ ua: IPHONE, standalone: false, temPrompt: false, toques: 5, plataforma: 'iPhone' })).toBe('ios');
    expect(estadoDeInstalacao({ ua: IPAD, standalone: false, temPrompt: false, toques: 5, plataforma: 'MacIntel' })).toBe('ios');
    expect(estadoDeInstalacao({ ua: IPHONE, standalone: true, temPrompt: false, toques: 5, plataforma: 'iPhone' })).toBe('instalado');
    expect(estadoDeInstalacao({ ua: IPAD, standalone: false, temPrompt: false, toques: 0, plataforma: 'MacIntel' })).toBe('nada'); // Mac de verdade
  });
});
```

`src/app/p/instalacao.ts`:

```ts
export type EstadoInstalacao = 'instalado' | 'android' | 'ios' | 'nada';

/** O iPadOS se apresenta como Mac ("MacIntel"); a tela de toque o denuncia. */
export function ehIos(ua: string, plataforma: string, toques: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (plataforma === 'MacIntel' && toques > 1);
}

/**
 * US-040: no Chrome (Android), o botão "Instalar app" chama o prompt nativo (`beforeinstallprompt`); no Safari do iOS,
 * que não tem prompt, o tutorial "Compartilhar → Adicionar à Tela de Início". Instalado (standalone) → nada.
 */
export function estadoDeInstalacao(o: { ua: string; standalone: boolean; temPrompt: boolean; toques: number; plataforma: string }): EstadoInstalacao {
  if (o.standalone) return 'instalado';
  if (o.temPrompt) return 'android';
  if (ehIos(o.ua, o.plataforma, o.toques)) return 'ios';
  return 'nada';
}
```

`src/app/p/instalar.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { estadoDeInstalacao, type EstadoInstalacao } from './instalacao';

type PromptDeInstalacao = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function Instalar() {
  const [prompt, setPrompt] = useState<PromptDeInstalacao | null>(null);
  const [estado, setEstado] = useState<EstadoInstalacao>('nada');
  useEffect(() => {
    const calcular = (temPrompt: boolean) =>
      setEstado(estadoDeInstalacao({ ua: navigator.userAgent, standalone: standalone(), temPrompt, toques: navigator.maxTouchPoints, plataforma: navigator.platform }));
    calcular(false);
    const aoPedir = (e: Event) => {
      e.preventDefault(); // guarda o evento: o prompt só abre no clique do botão
      setPrompt(e as PromptDeInstalacao);
      calcular(true);
    };
    const aoInstalar = () => {
      setPrompt(null);
      setEstado('instalado');
    };
    window.addEventListener('beforeinstallprompt', aoPedir);
    window.addEventListener('appinstalled', aoInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPedir);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);
  if (estado === 'android' && prompt) {
    return (
      <button
        onClick={async () => {
          await prompt.prompt();
          setPrompt(null);
          setEstado('nada');
        }}
        className="min-h-11 rounded bg-emerald-700 px-4 text-white"
      >
        Instalar app
      </button>
    );
  }
  if (estado === 'ios') {
    return (
      <section aria-labelledby="instalar-iphone" className="space-y-2 rounded border p-4">
        <h2 id="instalar-iphone" className="font-semibold">Instalar app</h2>
        <p>
          Para instalar no iPhone: toque em Compartilhar{' '}
          <svg aria-hidden="true" viewBox="0 0 24 24" className="inline size-5 align-text-bottom" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" />
          </svg>{' '}
          → Adicionar à Tela de Início.
        </p>
        <p>Depois de instalar, abra o app pela tela de início para ativar as notificações.</p>
      </section>
    );
  }
  return null;
}
```

Em `src/app/p/(portal)/inicio/page.tsx`, abaixo do título: `<Instalar />` (US-011 "sou levado ao PWA com o tutorial de instalação": o convite já termina em `/p/inicio`).

- [ ] **Step 7: "Sair" limpa o aparelho (falha → passa)** — `src/app/sair/route.test.ts`, no primeiro teste e no de "sem sessão":

```ts
    expect(r.headers.get('clear-site-data')).toBe('"cache", "storage"'); // D6: cache do plano, service worker e inscrição de push do aparelho
```

e, no mesmo teste, o cookie do vínculo (D3) sai junto com a sessão — senão a próxima conta no aparelho herda a escolha:

```ts
    expect(r.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^nd_vinculo=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax/));
```

`src/lib/paciente-session.ts`: `export function cookieDoVinculoApagado(secure: boolean): string { return `${COOKIE_VINCULO}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`; }` (+ caso no teste de `cookieDoVinculo`).

`src/app/sair/route.ts`, em `redirecionar` (só no caminho de sucesso — o de erro mantém a sessão e o aparelho):

```ts
const redirecionar = (para: string, cookies: string[] = [], limparAparelho = false): Response => {
  const h = new Headers({ location: para, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  // D6 (Plano 06): o plano guardado offline, o service worker e a inscrição de push do aparelho saem junto com a sessão
  if (limparAparelho) h.set('clear-site-data', '"cache", "storage"');
  return new Response(null, { status: 303, headers: h });
};
```

e `return redirecionar(SAIR_DESTINO, [...(await cookiesDeSessaoApagados(auth)), cookieDoVinculoApagado(getEnv().APP_URL.startsWith('https://'))], true);` (`cookieDoVinculoApagado` de `@/lib/paciente-session`).

`src/app/p/sair-portal.tsx`:

```tsx
'use client';
import type { FormEvent } from 'react';
import { esquecerPlanoGuardado } from '../sw-regras';

/**
 * D6 / Review Focus 4: antes de sair, apaga o plano guardado (o Clear-Site-Data da resposta faz o mesmo, mas o
 * Safari não o aplica a tudo). Falhar aqui não impede de sair.
 */
export async function limparAparelho(): Promise<void> {
  await esquecerPlanoGuardado();
}

/** "Sair" do portal: o mesmo POST /sair do BotaoSair, depois de limpar o aparelho. */
export function SairPortal() {
  const sair = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await limparAparelho();
    } finally {
      form.submit(); // submit() não dispara onSubmit de novo
    }
  };
  return (
    <form method="post" action="/sair" onSubmit={sair}>
      <button type="submit" data-sair className="min-h-11 cursor-pointer rounded border border-current px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2">
        Sair
      </button>
    </form>
  );
}
```

`src/app/p/layout.tsx`: trocar `<BotaoSair />` por `<SairPortal />`.

Run: `pnpm test src/app/sair src/app/p` → PASS.

- [ ] **Step 8: E2E offline e "Sair"** — `e2e/portal.spec.ts`:

```ts
const entradasDoPlano = (page: Page) => page.evaluate(async () => ((await caches.keys()).includes('nd-plano-v1') ? (await (await caches.open('nd-plano-v1')).keys()).length : 0));

test('offline: "Plano" aberto pelo menu fica guardado; sem rede aparece com o selo; outra página do portal cai no plano; "Sair" apaga o cache (US-040, D6)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.4');
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Uso normal: o menu é next/link (fetch RSC do roteador, não navegação 'navigate') — a página pede ao service worker
  await p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  await p.page.context().setOffline(true);
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await p.page.context().setOffline(false);
  await p.page.goto('/p/inicio');
  await p.page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(p.page).toHaveURL(/\/entrar$/);
  expect(await p.page.evaluate(() => caches.keys())).not.toContain('nd-plano-v1');
  expect((await p.page.context().cookies()).map((c) => c.name)).not.toContain('nd_vinculo');
  await p.page.context().close();
});

test('plano guardado é da conta: sessão vencida (sem "Sair") leva ao /entrar, que apaga a cópia antes de outra pessoa entrar (Review Focus 4)', async ({ browser }) => {
  const a = await pacienteNoPortal(browser, nutri, '10.9.8.7');
  await publicarPlanoSimples(nutri, a.prontuario);
  await a.page.goto('/p/plano');
  await expect.poll(() => entradasDoPlano(a.page)).toBe(1);
  await a.page.context().clearCookies(); // a sessão de A "vence" no aparelho
  await a.page.goto('/p/inicio');
  await expect(a.page).toHaveURL(/\/entrar/);
  await expect.poll(() => entradasDoPlano(a.page)).toBe(0);
  await a.page.context().close();
});
```

(A troca de dono sem passar pelo login — outro vínculo da mesma conta — é coberta pelas regras de `sw-regras.test.ts` e pelo `conferirDono`; um E2E com duas nutricionistas fica na Tarefa 13 se o axe já montar esse cenário.)

(Se o `setOffline` do Playwright não valer para as requisições do service worker nesta versão do Chromium, simular a queda com `p.page.context().route('**/p/**', (r) => r.abort('internetdisconnected'))` — o Playwright 1.63 roteia também as requisições do service worker quando `serviceWorkers` é `'allow'`, o padrão.)

Run: `pnpm build && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add public/icones scripts/gerar-icones.ts package.json src/app/sw.ts src/app/sw-regras.ts src/app/sw-regras.test.ts src/app/manifest.ts src/app/manifest.test.ts src/app/p src/app/api/p/ping src/app/sair src/app/entrar/page.tsx src/lib/paciente-session.ts src/lib/paciente-session.test.ts e2e/portal.spec.ts
git commit -m "feat(pwa): ícones e manifest, Meu plano offline, instalar (Android/iPhone), selo offline e Sair que limpa o aparelho (US-040)"
```

---
### Task 6: Notificações no app e acesso diário — inscrição de push, push de teste, aviso de plano novo, `access_events` (CS-02) e cookie que desliza (P06-02, P06-11; US-040, US-025)

**Files:**
- Create: `src/db/schema/portal.ts`, `drizzle/0074_portal_acesso.sql` (gerada), `drizzle/0075_rls_access_events.sql` (custom), `src/modules/notificacoes/push-endpoint.ts`, `src/modules/portal/push-inscricao.ts`, `src/modules/portal/push-inscricao.test.ts`, `src/modules/portal/acesso.ts`, `src/modules/portal/acesso.test.ts`, `src/modules/portal/avisos.ts`, `src/modules/portal/avisos.test.ts`, `src/app/api/p/push/route.ts`, `src/app/api/p/push/route.test.ts`, `src/app/api/p/acesso/route.ts`, `src/app/api/p/acesso/route.test.ts`, `src/app/p/notificacoes.tsx`, `src/app/p/acesso.tsx`
- Modify: `src/db/schema/index.ts`, `src/db/schema/agenda.ts` (tipos de `notifications`), `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `src/env.ts`, `src/env.test.ts`, `.env.example`, `src/modules/notificacoes/push.ts`, `src/modules/notificacoes/mensagens.ts`, `src/modules/notificacoes/mensagens.test.ts`, `src/modules/notificacoes/enviar.test.ts`, `src/modules/plano-alimentar/publicacao.ts`, `src/modules/plano-alimentar/publicacao.test.ts`, `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/lib/sessao-cookies.ts`, `src/lib/sessao-cookies.test.ts`, `src/app/sw.ts`, `src/app/sw-regras.ts`, `src/app/sw-regras.test.ts`, `src/app/p/sair-portal.tsx`, `src/app/p/(portal)/layout.tsx`, `src/app/p/(portal)/inicio/page.tsx`, `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: `pushSubscriptions` (Plano 05, contrato da Tarefa 13 dele), `notifications`, `dispararEnvio` (`@/modules/notificacoes/agendar`), `pushDaNotificacao` (`mensagens.ts`), `enqueueEmail`; `requireApiPaciente`, `PacienteAccess.vinculos` (Tarefa 3); `partesNoFuso`; `urlDoApp`; `getAuth().$context` (cookies do Better Auth).
- Produces:
  - Schema `@/db/schema/portal`: `accessEvents` 🔒 (`tenant_id`, `patient_id`, `dia date`, `created_at`; `UNIQUE (tenant_id, patient_id, dia)`), `type AccessEventRow`. Tipos novos em `notifications.tipo`: `push_teste`, `comentario_diario`, `plano_novo`.
  - `@/modules/notificacoes/push-endpoint`: `SERVICOS_DE_PUSH`, `endpointDePush(endpoint: string): boolean` (movidos de `push.ts`, que os reexporta; este arquivo não importa `web-push`).
  - `@/modules/portal/push-inscricao`: `MSG_PUSH`, `class InscricaoInvalidaError`, `inscreverAparelho(acesso: Pick<PacienteAccess, 'ctx' | 'vinculos' | 'data'>, entrada: unknown, userAgent: string | null, deps?: { db?: Db; agora?: Date; sincronizar?: boolean }): Promise<'inscrito' | 'de_outra_conta'>` (o endpoint sai de toda outra conta; uma linha por vínculo ativo + `push_teste` no vínculo atual; com `sincronizar`, sem push de teste e só se o endpoint já era desta conta), `cancelarAparelho(acesso, endpoint: unknown, deps?): Promise<void>` (apaga o endpoint em todos os vínculos).
  - Função `app_soltar_endpoint_push(p_endpoint text) RETURNS boolean` (SECURITY DEFINER, só na sessão de paciente): apaga o endpoint de **toda outra conta**, em qualquer tenant, e diz se ele já tinha linha desta conta; índice `push_subscriptions_endpoint_idx (endpoint)`.
  - `src/app/p/notificacoes.tsx`: `sincronizarAparelho(dono: string): Promise<'ativo' | 'sem_inscricao'>` (reatribui ou descarta a inscrição que o navegador já tem; uma vez por carga do portal e dono).
  - `@/modules/portal/acesso`: `registrarAcesso(ctx: TenantContext, fuso: string, o?: { db?: Db; agora?: Date }): Promise<boolean>` (true = primeira do dia).
  - `@/modules/portal/avisos`: `avisarPlanoNovo(tx: Tx, p: Pick<PatientRow, 'id' | 'tenantId' | 'email' | 'userId' | 'status'>, agora: Date, appUrl: string): Promise<void>`, `avisarComentario(tx: Tx, o: { tenantId: string; patientId: string }, agora: Date): Promise<void>` (a Tarefa 8 usa).
  - `@/lib/sessao-cookies`: `cookieDeSessaoRenovado(auth: Auth, cabecalhoCookie: string | null): Promise<string | null>` (`Set-Cookie` com o mesmo valor, nome e atributos do login e `Max-Age` de 30 dias).
  - `src/app/sw-regras.ts`: `urlDaNotificacao(url: unknown, origem: string): string` (mesma origem, senão `/p/inicio`).
  - E-mail `{ tipo: 'plano_novo'; para: string; link: string }`.
  - `getEnv().VAPID_PUBLIC_KEY?: string` (opcional no app; mesmo formato do worker).

- [ ] **Step 1: Tabela e tipos** — `src/db/schema/portal.ts`:

```ts
import { sql } from 'drizzle-orm';
import { date, foreignKey, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { tenants } from './platform';

/** CS-02 / D9: no máximo uma linha por paciente por dia (no fuso do tenant) em que ele abriu o portal. */
export const accessEvents = pgTable(
  'access_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    dia: date('dia', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('access_events_dia_unique').on(t.tenantId, t.patientId, t.dia),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'access_events_paciente_fk' }),
  ],
);

export type AccessEventRow = typeof accessEvents.$inferSelect;
```

(`sql` fica para a Tarefa 7, que acrescenta `diary_entries` neste arquivo.) `src/db/schema/index.ts`: `export * from './portal';`. `src/db/schema/agenda.ts`, CHECK `notifications_tipo_valido`: acrescentar `'push_teste', 'comentario_diario', 'plano_novo'` à lista; em `pushSubscriptions`, o índice que a reatribuição do aparelho usa (Step 6):

```ts
    // Review Focus 4: um endpoint pertence a uma conta só — app_soltar_endpoint_push procura o endpoint em cada tenant
    index('push_subscriptions_endpoint_idx').on(t.endpoint),
```

Run: `pnpm db:generate --name portal_acesso` e `pnpm drizzle-kit generate --custom --name rls_access_events`; `drizzle/0075_rls_access_events.sql`:

```sql
SELECT app_enable_tenant_rls('access_events');
--> statement-breakpoint
SELECT app_enable_patient_rls('access_events');
--> statement-breakpoint
-- D9: o próprio paciente registra o acesso do dia
SELECT app_allow_paciente_escrita('access_events', 'insert');
--> statement-breakpoint
-- D7 / contrato da Tarefa 13 do Plano 05: a inscrição é gravada (e cancelada) pela sessão do paciente
SELECT app_allow_paciente_escrita('push_subscriptions', 'insert', 'delete');
--> statement-breakpoint
-- Review Focus 4 (aparelho compartilhado): um endpoint de push pertence a UMA conta. O paciente A ativa no celular e a
-- sessão dele expira (ou ele não toca em "Sair"); B entra no mesmo navegador, que continua com a inscrição de A: sem
-- isto, os avisos de A seguem chegando no aparelho (com B logado) e B nunca ganha linha. Quem apresenta o endpoint (um
-- segredo que só o navegador do aparelho conhece) logado como paciente tira o endpoint de TODA outra conta, em qualquer
-- tenant, e fica sabendo se ele já tinha linha da própria conta (senão o cliente descarta a inscrição e mostra "Ativar
-- notificações" — B não passa a receber push sem ter pedido). A RLS é FORCE: a função entra em cada tenant
-- (set_config local à transação, como a admin_tenant_metrics da 0012) e devolve o contexto do chamador no fim.
-- Roda só ao ativar e uma vez por abertura do portal com inscrição no navegador (não a cada requisição — D2).
-- search_path fixo e nomes qualificados (mesmo endurecimento da 0012).
CREATE OR REPLACE FUNCTION app_soltar_endpoint_push(p_endpoint text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app_current_user();
  v_tenant text := current_setting('app.tenant_id', true);
  v_role text := current_setting('app.role', true);
  v_patient text := current_setting('app.patient_id', true);
  v_da_conta boolean := false;
  t record;
BEGIN
  IF v_user IS NULL OR app_current_role() IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'app_soltar_endpoint_push() só roda na sessão de um paciente' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR char_length(p_endpoint) > 1000 THEN
    RAISE EXCEPTION 'app_soltar_endpoint_push(): endpoint inválido' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT tn.id FROM public.tenants tn LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    DELETE FROM public.push_subscriptions s
      WHERE s.tenant_id = t.id AND s.endpoint = p_endpoint
        AND NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.tenant_id = s.tenant_id AND p.id = s.patient_id AND p.user_id = v_user);
    v_da_conta := v_da_conta OR EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.tenant_id = t.id AND s.endpoint = p_endpoint);
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_tenant, ''), true);
  PERFORM set_config('app.role', coalesce(v_role, ''), true);
  PERFORM set_config('app.patient_id', coalesce(v_patient, ''), true);
  RETURN v_da_conta;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_soltar_endpoint_push(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_soltar_endpoint_push(text) TO nutri_app_role;
```

`src/db/rls-guard.ts`, `PACIENTE_ESCREVE`: `access_events: { comandos: ['insert'], motivo: 'CS-02: o paciente registra o acesso do dia (D9)' }` e `push_subscriptions: { comandos: ['insert', 'delete'], motivo: 'INT-03 / P06-02: ativar e cancelar notificações no aparelho' }`. `src/db/audit-guard.ts`, `AUDIT_EXCEPTIONS.access_events = 'CS-02: só o dia em que o paciente abriu o portal; não é dado de saúde'`. `test/isolamento.test.ts`, `FABRICAS`:

```ts
  access_events: (t, p) => sql`insert into access_events (tenant_id, patient_id, dia) values (${t}, ${p}, ${`2030-01-${String((++seqConsulta % 28) + 1).padStart(2, '0')}`})`,
```

Run: `pnpm db:migrate && pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 2: Acesso do dia (falha → passa)** — `src/modules/portal/acesso.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { accessEvents } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { registrarAcesso } from './acesso';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('acesso diário (CS-02, D9)', () => {
  it('no máximo uma linha por dia no fuso do tenant: 23:30 de Brasília ainda é o mesmo dia; 00:10 é o seguinte', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const sp = 'America/Sao_Paulo';
    expect(await registrarAcesso(ctx, sp, { db: app.db, agora: new Date('2026-10-05T12:00:00Z') })).toBe(true);
    expect(await registrarAcesso(ctx, sp, { db: app.db, agora: new Date('2026-10-06T02:30:00Z') })).toBe(false); // 23:30 do dia 5
    expect(await registrarAcesso(ctx, sp, { db: app.db, agora: new Date('2026-10-06T03:10:00Z') })).toBe(true); // 00:10 do dia 6
    const dias = await withTenant(T.ctx, (tx) => tx.select({ dia: accessEvents.dia }).from(accessEvents).where(eq(accessEvents.patientId, p.id)), app.db);
    expect(dias.map((d) => d.dia).sort()).toEqual(['2026-10-05', '2026-10-06']);
  });
});
```

`src/modules/portal/acesso.ts`:

```ts
import { getDb, type Db } from '@/db/client';
import { accessEvents } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';

/** CS-02: 1 linha por paciente por dia (fuso do tenant). Devolve se foi a primeira do dia. */
export async function registrarAcesso(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<boolean> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('registrarAcesso só roda em sessão de paciente');
  const dia = partesNoFuso(o.agora ?? new Date(), fuso).data;
  const r = await withTenant(
    ctx,
    (tx) => tx.insert(accessEvents).values({ tenantId: ctx.tenantId, patientId: ctx.patientId!, dia }).onConflictDoNothing().returning({ id: accessEvents.id }),
    o.db ?? getDb(),
  );
  return r.length > 0;
}
```

- [ ] **Step 3: Cookie que desliza (P06-11, falha → passa)** — `src/lib/sessao-cookies.test.ts`, acrescentar:

```ts
describe('cookieDeSessaoRenovado (P06-11)', () => {
  it('reemite o cookie de sessão com o mesmo valor e atributos e Max-Age de 30 dias; sem o cookie → null', async () => {
    const auth = getAuth();
    const u = await criarEEntrar(getDb(), auth, { appRole: 'paciente' });
    const c = await cookieDeSessaoRenovado(auth, `${u.cookie}; outro=1`);
    const valor = u.cookie.split('=').slice(1).join('=');
    expect(c).toMatch(new RegExp(`^nd\\.session_token=${valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`));
    expect(await cookieDeSessaoRenovado(auth, 'outro=1')).toBeNull();
  });
});
```

(com `getAuth`, `getDb`, `closeDb` no `afterAll` e `criarEEntrar` de `../../test/sessao`; conferir no teste existente deste arquivo quais desses já estão importados.)

`src/lib/sessao-cookies.ts`, acrescentar:

```ts
const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

/**
 * P06-11 (adiado do Plano 01, rodada 3): o banco já desliza a sessão do paciente em requireUser, mas o cookie tinha
 * `Max-Age` fixo desde o login. Reemite o MESMO valor (token assinado) com o nome e os atributos do login e 30 dias
 * a partir de agora. Só chamar com a sessão já validada (requireApiPaciente).
 */
export async function cookieDeSessaoRenovado(auth: Auth, cabecalhoCookie: string | null): Promise<string | null> {
  const { authCookies } = await auth.$context;
  const { name, attributes: a } = authCookies.sessionToken as CookieDoAuth;
  const valor = (cabecalhoCookie ?? '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!valor) return null;
  return [
    `${name}=${valor}`,
    `Max-Age=${TRINTA_DIAS_S}`,
    `Path=${a.path ?? '/'}`,
    a.domain ? `Domain=${a.domain}` : '',
    a.httpOnly ? 'HttpOnly' : '',
    a.secure ? 'Secure' : '',
    a.sameSite ? `SameSite=${a.sameSite[0].toUpperCase()}${a.sameSite.slice(1).toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}
```

(Se o `sameSite` do Better Auth já vier capitalizado, o teste mostra; ajustar a capitalização para bater com o cookie do login.)

- [ ] **Step 4: Rota do acesso** — `src/app/api/p/acesso/route.test.ts` (mesmo molde do teste da rota do PDF: `requireApiPaciente`, `registrarAcesso` e `cookieDeSessaoRenovado` simulados):

```ts
import { describe, expect, it, vi } from 'vitest';

const acesso = vi.hoisted(() => ({ atual: null as unknown, registrado: 0 }));
vi.mock('@/lib/paciente-session', () => ({ requireApiPaciente: async () => acesso.atual }));
vi.mock('@/modules/portal/acesso', () => ({ registrarAcesso: async () => { acesso.registrado++; return true; } }));
vi.mock('@/lib/sessao-cookies', () => ({ cookieDeSessaoRenovado: async () => 'nd.session_token=x; Max-Age=2592000' }));
vi.mock('@/lib/auth', () => ({ getAuth: () => ({}) }));
vi.mock('@/env', () => ({ getEnv: () => ({ APP_URL: 'http://localhost:3000' }) }));
const { POST } = await import('./route');

const pedido = (origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/p/acesso', { method: 'POST', headers: { origin } });

describe('POST /api/p/acesso', () => {
  it('outra origem → 403 sem registrar; sem sessão → a recusa', async () => {
    acesso.atual = { ok: true, ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } };
    expect((await POST(pedido('https://evil.example'))).status).toBe(403);
    expect(acesso.registrado).toBe(0);
    acesso.atual = { ok: false, response: new Response(null, { status: 401 }) };
    expect((await POST(pedido())).status).toBe(401);
  });
  it('registra o dia e renova o cookie (204)', async () => {
    acesso.atual = { ok: true, ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } };
    const r = await POST(pedido());
    expect(r.status).toBe(204);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=2592000');
    expect(acesso.registrado).toBe(1);
  });
});
```

`src/app/api/p/acesso/route.ts`:

```ts
import { getEnv } from '@/env';
import { getAuth } from '@/lib/auth';
import { requireApiPaciente } from '@/lib/paciente-session';
import { cookieDeSessaoRenovado } from '@/lib/sessao-cookies';
import { registrarAcesso } from '@/modules/portal/acesso';

export const dynamic = 'force-dynamic';

/** D9: chamado uma vez quando o portal abre — o acesso do dia (CS-02) e o cookie de sessão que desliza (P06-11). */
export async function POST(req: Request): Promise<Response> {
  const origem = req.headers.get('origin');
  if (origem !== null && origem !== new URL(getEnv().APP_URL).origin) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  await registrarAcesso(acesso.ctx, acesso.tenant.fuso);
  const h = new Headers({ 'cache-control': 'no-store' });
  const cookie = await cookieDeSessaoRenovado(getAuth(), req.headers.get('cookie'));
  if (cookie) h.append('set-cookie', cookie);
  return new Response(null, { status: 204, headers: h });
}
```

`src/app/p/acesso.tsx`:

```tsx
'use client';
import { useEffect } from 'react';

/** D9: registra o acesso do dia e renova o cookie uma vez por carga do portal e dono (o layout persiste entre as abas). */
export function RegistrarAcesso({ dono }: { dono: string }) {
  useEffect(() => {
    void fetch('/api/p/acesso', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
  }, [dono]);
  return null;
}
```

Em `src/app/p/(portal)/layout.tsx`, `<RegistrarAcesso dono={ctx.patientId!} />` dentro do `<div>` raiz (o Step 11 acrescenta a sincronização do push no mesmo efeito).

- [ ] **Step 5: Endpoint de push sem `web-push`** — mover `SERVICOS_DE_PUSH`, `HOST_LDH` e `endpointDePush` (com os comentários) de `src/modules/notificacoes/push.ts` para `src/modules/notificacoes/push-endpoint.ts` (que importa só `node:url`), e em `push.ts`: `export { endpointDePush, SERVICOS_DE_PUSH } from './push-endpoint';` + `import { endpointDePush } from './push-endpoint';` onde é usado. Run: `pnpm test src/modules/notificacoes/push.test.ts` → PASS (nada muda no comportamento).

- [ ] **Step 6: Inscrição (falha → passa)** — `src/modules/portal/push-inscricao.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { vinculosDaConta } from './vinculos';
import { cancelarAparelho, InscricaoInvalidaError, inscreverAparelho } from './push-inscricao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const sub = (endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) => ({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });

async function comDoisVinculos() {
  const A = await novoTenant(app.db);
  const B = await novoTenant(app.db);
  const { userId, paciente: pa } = await pacienteComConta(app.db, A);
  const { paciente: pb } = await pacienteComConta(app.db, B, { userId });
  const vinculos = await vinculosDaConta(userId, { db: app.db });
  const acesso = { data: { user: { id: userId } }, vinculos, ctx: { tenantId: A.tenantId, role: 'paciente' as const, patientId: pa.id, actorUserId: userId } };
  return { A, B, pa, pb, acesso };
}

describe('inscrição de push (US-040, contrato D14 do Plano 05)', () => {
  it('uma linha por vínculo ativo do aparelho; push de teste só no vínculo atual; repetir não duplica', async () => {
    const { A, B, pa, pb, acesso } = await comDoisVinculos();
    const s = sub();
    await inscreverAparelho(acesso as never, s, 'Chrome Android', { db: app.db });
    await inscreverAparelho(acesso as never, s, 'Chrome Android', { db: app.db });
    const emA = await withTenant(A.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pa.id)), app.db);
    const emB = await withTenant(B.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pb.id)), app.db);
    expect([emA.length, emB.length]).toEqual([1, 1]);
    expect(emA[0]).toMatchObject({ endpoint: s.endpoint, userAgent: 'Chrome Android' });
    const testes = await withTenant(A.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, pa.id), eq(notifications.tipo, 'push_teste'))), app.db);
    expect(testes).toHaveLength(2); // cada clique em "Ativar" pede um teste (o motor envia no máximo uma vez cada)
    expect(testes[0]).toMatchObject({ canal: 'push', status: 'pendente', appointmentId: null });
  });

  it('endpoint fora dos serviços de push, http, chaves inválidas → InscricaoInvalidaError, nada gravado', async () => {
    const { A, pa, acesso } = await comDoisVinculos();
    for (const ruim of [sub('https://127.0.0.1/x'), sub('http://fcm.googleapis.com/x'), { endpoint: sub().endpoint, keys: { p256dh: 'x', auth: 'y' } }, 'lixo']) {
      await expect(inscreverAparelho(acesso as never, ruim, null, { db: app.db })).rejects.toThrow(InscricaoInvalidaError);
    }
    expect(await withTenant(A.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pa.id)), app.db)).toEqual([]);
  });

  it('aparelho compartilhado (Review Focus 4): o endpoint de A sai de A quando B abre o portal; B só ganha linha ao ativar', async () => {
    const { A, pa, acesso: deA } = await comDoisVinculos();
    const C = await novoTenant(app.db);
    const { userId: uB, paciente: pB } = await pacienteComConta(app.db, C);
    const deB = { data: { user: { id: uB } }, vinculos: await vinculosDaConta(uB, { db: app.db }), ctx: { tenantId: C.tenantId, role: 'paciente' as const, patientId: pB.id, actorUserId: uB } };
    const s = sub();
    expect(await inscreverAparelho(deA as never, s, null, { db: app.db })).toBe('inscrito');
    // B abre o portal no mesmo navegador, que ainda tem a inscrição de A
    expect(await inscreverAparelho(deB as never, s, null, { db: app.db, sincronizar: true })).toBe('de_outra_conta');
    const deAgora = async (T: typeof A, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, id)), app.db)).map((x) => x.endpoint);
    expect(await deAgora(A, pa.id)).toEqual([]); // e no outro vínculo da conta de A também
    expect(await deAgora(C, pB.id)).toEqual([]); // B não recebe push sem ter pedido
    // B toca em "Ativar notificações" (o cliente descartou a inscrição velha; aqui o mesmo endpoint basta para o teste)
    expect(await inscreverAparelho(deB as never, s, null, { db: app.db })).toBe('inscrito');
    expect(await deAgora(C, pB.id)).toEqual([s.endpoint]);
    // A volta a entrar e ativa: o endpoint sai de B
    await inscreverAparelho(deA as never, s, null, { db: app.db });
    expect(await deAgora(C, pB.id)).toEqual([]);
  });

  it('sincronizar: vínculo novo depois da ativação ganha a linha, sem push de teste; endpoint desconhecido → de_outra_conta', async () => {
    const A = await novoTenant(app.db);
    const { userId, paciente: pa } = await pacienteComConta(app.db, A);
    const acesso1 = { data: { user: { id: userId } }, vinculos: await vinculosDaConta(userId, { db: app.db }), ctx: { tenantId: A.tenantId, role: 'paciente' as const, patientId: pa.id, actorUserId: userId } };
    const s = sub();
    await inscreverAparelho(acesso1 as never, s, null, { db: app.db });
    const B = await novoTenant(app.db);
    const { paciente: pb } = await pacienteComConta(app.db, B, { userId }); // a conta vira paciente de outra nutricionista
    const acesso2 = { ...acesso1, vinculos: await vinculosDaConta(userId, { db: app.db }) };
    expect(await inscreverAparelho(acesso2 as never, s, null, { db: app.db, sincronizar: true })).toBe('inscrito');
    const emB = await withTenant(B.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pb.id)), app.db);
    expect(emB.map((x) => x.endpoint)).toEqual([s.endpoint]);
    const testes = await withTenant(A.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, pa.id), eq(notifications.tipo, 'push_teste'))), app.db);
    expect(testes).toHaveLength(1); // só o da ativação
    expect(await inscreverAparelho(acesso2 as never, sub(), null, { db: app.db, sincronizar: true })).toBe('de_outra_conta');
  });

  it('app_soltar_endpoint_push só roda na sessão de paciente (nutricionista e worker → 42501)', async () => {
    const A = await novoTenant(app.db);
    // o erro do pg vem embrulhado (DrizzleQueryError → cause); o mesmo laço do violaRls de agendamento-publico.test.ts
    const codigo = (e: unknown) => {
      let c = e as { code?: string; cause?: unknown } | undefined;
      for (let i = 0; c && i < 5; i++, c = c.cause as typeof c) if (c.code) return c.code;
      return undefined;
    };
    const soltar = (ctx: Parameters<typeof withTenant>[0]) => withTenant(ctx, (tx) => tx.execute(sql`select app_soltar_endpoint_push(${sub().endpoint})`), app.db);
    await expect(soltar(A.ctx).catch(codigo)).resolves.toBe('42501');
    await expect(soltar({ tenantId: A.tenantId, role: 'worker' }).catch(codigo)).resolves.toBe('42501');
  });

  it('cancelar apaga o endpoint em todos os vínculos (Sair, Review Focus 4); outro aparelho fica', async () => {
    const { A, B, pa, pb, acesso } = await comDoisVinculos();
    const este = sub();
    const outro = sub();
    await inscreverAparelho(acesso as never, este, null, { db: app.db });
    await inscreverAparelho(acesso as never, outro, null, { db: app.db });
    await cancelarAparelho(acesso as never, este.endpoint, { db: app.db });
    const restantes = async (T: typeof A, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, id)), app.db)).map((x) => x.endpoint);
    expect(await restantes(A, pa.id)).toEqual([outro.endpoint]);
    expect(await restantes(B, pb.id)).toEqual([outro.endpoint]);
  });
});
```

`src/modules/portal/push-inscricao.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import type { PacienteAccess } from '@/lib/paciente-session';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { endpointDePush } from '@/modules/notificacoes/push-endpoint';

export const MSG_PUSH = {
  indisponivel: 'Notificações no app ainda não estão disponíveis.',
  ativadas: 'Notificações ativadas neste aparelho.',
  bloqueadas: 'Você bloqueou as notificações. Para ativar, mude a permissão do site nas configurações do navegador.',
  falhou: 'Não foi possível ativar as notificações. Tente de novo.',
} as const;

export class InscricaoInvalidaError extends Error {
  override name = 'InscricaoInvalidaError';
}

// O formato que PushSubscription.toJSON() entrega; os mesmos limites dos CHECKs de push_subscriptions (Plano 05)
const inscricao = z.object({
  endpoint: z.string().max(1000).refine(endpointDePush),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/) }),
});

type Acesso = Pick<PacienteAccess, 'ctx' | 'vinculos' | 'data'>;

/**
 * US-040 "Permissão de push" / contrato D14 do Plano 05: o aparelho recebe os avisos de todos os vínculos ativos da conta
 * (uma linha por vínculo, cada uma no próprio tenant, transações separadas — uma conexão por transação) e o vínculo
 * atual ganha o push de teste "Notificações ativadas ✅" (pelo motor de notificações, D7).
 * Review Focus 4: antes de tudo o endpoint sai de TODA outra conta (app_soltar_endpoint_push) — num aparelho
 * compartilhado, os avisos do paciente anterior param de chegar. `sincronizar` (abertura do portal com inscrição no
 * navegador): sem push de teste, e só grava se o endpoint já era desta conta (vínculo novo ganha a linha); se era de
 * outra conta (ou de ninguém), nada é gravado e o cliente descarta a inscrição — B só recebe push depois de ativar.
 */
export async function inscreverAparelho(
  acesso: Acesso,
  entrada: unknown,
  userAgent: string | null,
  deps: { db?: Db; agora?: Date; sincronizar?: boolean } = {},
): Promise<'inscrito' | 'de_outra_conta'> {
  const p = inscricao.safeParse(entrada);
  if (!p.success) throw new InscricaoInvalidaError('inscrição de push inválida');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const ua = userAgent ? userAgent.slice(0, 300) : null;
  const daConta = await withTenant(
    acesso.ctx,
    async (tx) => {
      const r = await tx.execute<{ da_conta: boolean }>(sql`select app_soltar_endpoint_push(${p.data.endpoint}) as da_conta`);
      return r.rows[0]?.da_conta === true;
    },
    db,
  );
  if (deps.sincronizar && !daConta) return 'de_outra_conta';
  for (const v of acesso.vinculos) {
    const ctx = { tenantId: v.tenantId, role: 'paciente' as const, patientId: v.patientId, actorUserId: acesso.data.user.id };
    await withTenant(
      ctx,
      async (tx) => {
        await tx
          .insert(pushSubscriptions)
          .values({ tenantId: v.tenantId, patientId: v.patientId, endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, userAgent: ua })
          .onConflictDoNothing();
        if (deps.sincronizar || v.tenantId !== acesso.ctx.tenantId) return;
        await tx.insert(notifications).values({ tenantId: v.tenantId, patientId: v.patientId, canal: 'push', tipo: 'push_teste', agendadaPara: agora });
        await dispararEnvio(tx, v.tenantId);
      },
      db,
    );
  }
  return 'inscrito';
}

/** "Sair" / desativar: o endpoint deste aparelho sai de todos os vínculos da conta. */
export async function cancelarAparelho(acesso: Acesso, endpoint: unknown, deps: { db?: Db } = {}): Promise<void> {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return;
  for (const v of acesso.vinculos) {
    await withTenant(
      { tenantId: v.tenantId, role: 'paciente', patientId: v.patientId, actorUserId: acesso.data.user.id },
      (tx) => tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.patientId, v.patientId), eq(pushSubscriptions.endpoint, endpoint))),
      deps.db ?? getDb(),
    );
  }
}
```

(`dispararEnvio(tx, tenantId)` enfileira a varredura com a mesma transação: nos testes de unidade o pg-boss da suíte já está de pé — `stopBoss()` no `afterAll`, como nos testes do Plano 05.)

- [ ] **Step 7: Texto dos pushes novos (falha → passa)** — `src/modules/notificacoes/mensagens.test.ts`, acrescentar:

```ts
it('push sem consulta: teste, comentário e plano novo — textos neutros, toque abre a tela do portal (D7, D8, US-025)', () => {
  const base = contextoSemConsulta(); // helper do próprio arquivo de teste: ContextoEnvio com consulta null
  const deps = { appUrl: 'https://nutri.exemplo.com', chaveLinks: Buffer.alloc(32) };
  expect(pushDaNotificacao({ ...base, n: { ...base.n, tipo: 'push_teste' } }, deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Notificações ativadas ✅', url: 'https://nutri.exemplo.com/p/inicio' });
  expect(pushDaNotificacao({ ...base, n: { ...base.n, tipo: 'comentario_diario' } }, deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Sua nutricionista comentou seu diário', url: 'https://nutri.exemplo.com/p/diario' });
  expect(pushDaNotificacao({ ...base, n: { ...base.n, tipo: 'plano_novo' } }, deps)).toEqual({ titulo: 'NutriDebby', corpo: 'Seu novo plano alimentar está disponível', url: 'https://nutri.exemplo.com/p/plano' });
});
```

(Se o arquivo não tiver um contexto sem consulta, criar `contextoSemConsulta()` a partir do contexto que ele já monta, com `consulta: null`.) Em `src/modules/notificacoes/mensagens.ts`, no começo de `pushDaNotificacao`:

```ts
  // Plano 06 (D7, D8): avisos do portal, sem consulta — texto neutro (sem nome da nutricionista nem dado do paciente)
  if (!c.consulta) {
    const tela = { push_teste: ['Notificações ativadas ✅', '/p/inicio'], comentario_diario: ['Sua nutricionista comentou seu diário', '/p/diario'], plano_novo: ['Seu novo plano alimentar está disponível', '/p/plano'] }[c.n.tipo as string];
    return tela ? { titulo: 'NutriDebby', corpo: tela[0], url: urlDoApp(deps.appUrl, tela[1]) } : null;
  }
```

(`urlDoApp` de `@/lib/url-do-app`.) E em `src/modules/notificacoes/enviar.test.ts`, um caso: linha `push_teste` sem consulta, com inscrição e provedor falso → `enviada`; paciente arquivado → `ignorada`/`paciente_inativo`; sem inscrição → `ignorada`/`sem_inscricao` (mesmo molde dos testes de push da Tarefa 13 do Plano 05).

Run: `pnpm test src/modules/notificacoes src/modules/portal/push-inscricao.test.ts` → PASS.

- [ ] **Step 8: Aviso de plano novo (US-025, adiado do Plano 04; falha → passa)** — `src/modules/portal/avisos.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { avisarComentario, avisarPlanoNovo } from './avisos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date('2026-10-05T15:00:00Z');

describe('avisos do portal (US-025, US-043)', () => {
  it('plano novo: push + e-mail "Seu novo plano alimentar está disponível" só para quem tem acesso ao portal e está ativo', async () => {
    const T = await novoTenant(app.db);
    const { paciente: comConta, email } = await pacienteComConta(app.db, T);
    const semConta = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, async (tx) => {
      await avisarPlanoNovo(tx, comConta, agora, 'https://nutri.exemplo.com');
      await avisarPlanoNovo(tx, semConta, agora, 'https://nutri.exemplo.com');
      await avisarPlanoNovo(tx, { ...comConta, status: 'arquivado' }, agora, 'https://nutri.exemplo.com');
    }, app.db);
    const push = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'plano_novo')), app.db);
    expect(push.map((n) => [n.patientId, n.canal])).toEqual([[comConta.id, 'push']]);
    const emails = await emailsNaFila('plano_novo', email);
    expect(emails).toEqual([{ tipo: 'plano_novo', para: email, link: 'https://nutri.exemplo.com/p/plano' }]);
  });

  it('comentário: um push comentario_diario pendente para o paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => avisarComentario(tx, { tenantId: T.tenantId, patientId: p.id }, agora), app.db);
    const n = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, p.id), eq(notifications.tipo, 'comentario_diario'))), app.db);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ canal: 'push', status: 'pendente' });
  });
});
```

`src/modules/portal/avisos.ts`:

```ts
import type { Tx } from '@/db/client';
import { notifications, type PatientRow } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import { urlDoApp } from '@/lib/url-do-app';
import { dispararEnvio } from '@/modules/notificacoes/agendar';

/**
 * US-025 (adiado do Plano 04): ao publicar, o paciente com acesso ao portal recebe o push e o e-mail "Seu novo plano
 * alimentar está disponível" — na mesma transação da publicação. Sem conta (convite não aceito) ou fora de "ativo": nada.
 * Nenhum dado de saúde no texto (RNF-11).
 */
export async function avisarPlanoNovo(tx: Tx, p: Pick<PatientRow, 'id' | 'tenantId' | 'email' | 'userId' | 'status'>, agora: Date, appUrl: string): Promise<void> {
  if (!p.userId || p.status !== 'ativo') return;
  await tx.insert(notifications).values({ tenantId: p.tenantId, patientId: p.id, canal: 'push', tipo: 'plano_novo', agendadaPara: agora });
  await enqueueEmail({ tipo: 'plano_novo', para: p.email, link: urlDoApp(appUrl, '/p/plano') }, { tenantId: p.tenantId, tx });
  await dispararEnvio(tx, p.tenantId);
}

/** US-043 / D13: o primeiro comentário da nutricionista vira o push "Sua nutricionista comentou seu diário". */
export async function avisarComentario(tx: Tx, o: { tenantId: string; patientId: string }, agora: Date): Promise<void> {
  await tx.insert(notifications).values({ tenantId: o.tenantId, patientId: o.patientId, canal: 'push', tipo: 'comentario_diario', agendadaPara: agora });
  await dispararEnvio(tx, o.tenantId);
}
```

`src/email/types.ts`: `| { tipo: 'plano_novo'; para: string; link: string }`. `src/email/templates.tsx`, um `case` no molde do `exportacao_pronta`:

```tsx
    case 'plano_novo': {
      const subject = 'Seu novo plano alimentar está disponível';
      const linhas = ['Sua nutricionista publicou um novo plano alimentar para você no NutriDebby.', 'Entre no portal para ver as refeições e baixar o PDF.'];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => <P key={l}>{l}</P>)}
            <Botao href={msg.link}>Ver meu plano</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
```

`src/email/render.test.ts`: renderizar `plano_novo` e conferir o assunto e o link. `src/modules/plano-alimentar/publicacao.ts`: no fim da transação de `publicarPlano`, com a linha do paciente já travada (`carregarPacienteParaEscrita`/a leitura que a função já faz), `await avisarPlanoNovo(tx, paciente, now, deps.appUrl ?? getEnv().APP_URL);` — e o comentário "Plano 06: o aviso ao paciente … entra aqui" sai. `publicacao.test.ts`: publicar para paciente com conta → 1 `plano_novo` push; sem conta → 0.

Run: `pnpm test src/modules/portal/avisos.test.ts src/modules/plano-alimentar src/email` → PASS.

- [ ] **Step 9: Chave pública no app** — `src/env.test.ts`: `VAPID_PUBLIC_KEY` opcional também em `parseEnv` (formato 87 base64url; inválida → erro com o nome). `src/env.ts`, no `appSchema.extend({ … })`:

```ts
    // D7 (Plano 06): a chave PÚBLICA do VAPID vai para o navegador (inscrição de push). A privada fica só no worker.
    VAPID_PUBLIC_KEY: opcional(z.string().regex(VAPID_PUBLICA, { message: 'VAPID_PUBLIC_KEY deve ser a chave pública em base64url (87 caracteres)' }).optional()),
```

(mover `VAPID_PUBLICA` para antes do `appSchema` se ela estiver depois.) `.env.example`: no comentário do bloco do VAPID, "app e worker: VAPID_PUBLIC_KEY (a mesma nos dois); só worker: VAPID_PRIVATE_KEY e VAPID_SUBJECT".

- [ ] **Step 10: Rota da inscrição** — `src/app/api/p/push/route.ts`:

```ts
import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { requireApiPaciente } from '@/lib/paciente-session';
import { cancelarAparelho, InscricaoInvalidaError, inscreverAparelho, MSG_PUSH } from '@/modules/portal/push-inscricao';

export const dynamic = 'force-dynamic';

const resposta = (status: number, corpo?: unknown) =>
  corpo === undefined ? new Response(null, { status, headers: { 'cache-control': 'no-store' } }) : Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });

async function json(req: Request): Promise<unknown> {
  const corpo = await lerCorpoLimitado(req, 4096);
  return JSON.parse(new TextDecoder().decode(corpo));
}

async function entrada(req: Request) {
  const origem = req.headers.get('origin');
  if (origem !== null && origem !== new URL(getEnv().APP_URL).origin) return { erro: resposta(403) };
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return { erro: acesso.response };
  try {
    return { acesso, corpo: await json(req) };
  } catch (e) {
    return { erro: resposta(e instanceof CorpoGrandeError ? 413 : 400, { erro: MSG_PUSH.falhou }) };
  }
}

/**
 * US-040 "Ativar notificações": grava a inscrição do aparelho (todos os vínculos) e pede o push de teste.
 * `?sincronizar=1` (abertura do portal com inscrição no navegador, Review Focus 4): reatribui sem push de teste;
 * 409 = a inscrição era de outra conta (ou de ninguém) — o cliente a descarta e mostra "Ativar notificações".
 */
export async function POST(req: Request): Promise<Response> {
  if (!getEnv().VAPID_PUBLIC_KEY) return resposta(503, { erro: MSG_PUSH.indisponivel });
  const e = await entrada(req);
  if ('erro' in e) return e.erro!;
  const sincronizar = new URL(req.url).searchParams.get('sincronizar') === '1';
  try {
    const r = await inscreverAparelho(e.acesso, e.corpo, req.headers.get('user-agent'), { sincronizar });
    return resposta(r === 'inscrito' ? 204 : 409);
  } catch (err) {
    if (err instanceof InscricaoInvalidaError) return resposta(400, { erro: MSG_PUSH.falhou });
    throw err;
  }
}

/** "Sair" e desativar: o endpoint deste aparelho sai de todos os vínculos. */
export async function DELETE(req: Request): Promise<Response> {
  const e = await entrada(req);
  if ('erro' in e) return e.erro!;
  await cancelarAparelho(e.acesso, (e.corpo as { endpoint?: unknown } | null)?.endpoint);
  return resposta(204);
}
```

`src/app/api/p/push/route.test.ts`: mesmo molde do teste do `/api/p/acesso` (sessão e módulo simulados): sem `VAPID_PUBLIC_KEY` → 503 com `MSG_PUSH.indisponivel`; outra origem → 403; corpo de 5 KB → 413; inscrição inválida → 400; válida → 204 (e `inscreverAparelho` chamado com `sincronizar: false`); `?sincronizar=1` → `sincronizar: true`, 204 quando o módulo devolve `'inscrito'` e 409 quando devolve `'de_outra_conta'`; `DELETE` → 204 e chama `cancelarAparelho` com o endpoint.

- [ ] **Step 11: Service worker, botão e "Sair"** — `src/app/sw-regras.test.ts`:

```ts
it('urlDaNotificacao: só abre endereço da própria origem (o push poderia trazer outro); senão o início do portal', () => {
  expect(urlDaNotificacao('https://nutri.exemplo.com/p/diario', 'https://nutri.exemplo.com')).toBe('https://nutri.exemplo.com/p/diario');
  expect(urlDaNotificacao('https://evil.example/x', 'https://nutri.exemplo.com')).toBe('/p/inicio');
  expect(urlDaNotificacao(null, 'https://nutri.exemplo.com')).toBe('/p/inicio');
  expect(urlDaNotificacao('javascript:alert(1)', 'https://nutri.exemplo.com')).toBe('/p/inicio');
});
```

`src/app/sw-regras.ts`:

```ts
/** O toque na notificação só abre endereço da própria origem. */
export function urlDaNotificacao(url: unknown, origem: string): string {
  if (typeof url !== 'string' || !URL.canParse(url)) return '/p/inicio';
  const u = new URL(url);
  return u.origin === origem ? u.href : '/p/inicio';
}
```

`src/app/sw.ts`, antes do `new Serwist(…)`:

```ts
// INT-03: o payload do worker é { titulo, corpo, url } (Plano 05, D19), cifrado até o aparelho
self.addEventListener('push', (e) => {
  let d: { titulo?: unknown; corpo?: unknown; url?: unknown } | null = null;
  try {
    d = e.data?.json() ?? null;
  } catch {
    d = null;
  }
  if (!d || typeof d.titulo !== 'string') return;
  e.waitUntil(
    self.registration.showNotification(d.titulo, {
      body: typeof d.corpo === 'string' ? d.corpo : '',
      icon: '/icones/icone-192.png',
      data: { url: d.url ?? null },
    }),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(urlDaNotificacao((e.notification.data as { url?: unknown } | null)?.url, origem)));
});
```

`src/app/p/notificacoes.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { ehIos } from './instalacao';

type Estado = 'carregando' | 'indisponivel' | 'instale' | 'pode' | 'ativo' | 'negado' | 'falhou';
const TEXTO: Partial<Record<Estado, string>> = {
  indisponivel: 'Notificações no app ainda não estão disponíveis.',
  ativo: 'Notificações ativadas neste aparelho.',
  negado: 'Você bloqueou as notificações. Para ativar, mude a permissão do site nas configurações do navegador.',
  falhou: 'Não foi possível ativar as notificações. Tente de novo.',
};

/** base64url → bytes (applicationServerKey). */
function bytesDaChave(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const sincronias = new Map<string, Promise<'ativo' | 'sem_inscricao'>>();

/**
 * Review Focus 4 (aparelho compartilhado): a inscrição que o navegador já tem pode ser de OUTRA conta (A ativou, a sessão
 * expirou, B entrou). Ela nunca vale como "ativo" só por existir: vai ao servidor, que tira o endpoint das outras contas
 * e diz se ele já era desta (204 → vínculos novos ganham a linha) ou não (409 → descartada aqui; B ativa se quiser).
 * Uma vez por carga do portal e dono (`dono` = paciente da sessão: trocar de conta ou de vínculo sincroniza de novo).
 */
export function sincronizarAparelho(dono: string): Promise<'ativo' | 'sem_inscricao'> {
  let p = sincronias.get(dono);
  if (!p) {
    p = (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'sem_inscricao' as const;
      const reg = await navigator.serviceWorker.getRegistration('/p/');
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return 'sem_inscricao' as const;
      const r = await fetch('/api/p/push?sincronizar=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (r.status === 409) {
        await sub.unsubscribe().catch(() => false); // o endpoint morre no serviço de push: nada mais chega por ele
        return 'sem_inscricao' as const;
      }
      return r.ok ? ('ativo' as const) : ('sem_inscricao' as const);
    })().catch(() => 'sem_inscricao' as const);
    sincronias.set(dono, p);
  }
  return p;
}

/** US-040 "Permissão de push". No iPhone, só depois de instalado (o tutorial da Tarefa 5 cobre antes). */
export function AtivarNotificacoes({ chavePublica, dono }: { chavePublica: string | null; dono: string }) {
  const [estado, setEstado] = useState<Estado>('carregando');
  useEffect(() => {
    void (async () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches;
      if (ehIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) && !standalone) return setEstado('instale');
      if (!chavePublica || !('serviceWorker' in navigator) || !('PushManager' in window)) return setEstado('indisponivel');
      if (Notification.permission === 'denied') return setEstado('negado');
      // "ativo" só com o servidor confirmando que a inscrição é desta conta (nunca só porque o navegador tem uma)
      setEstado((await sincronizarAparelho(dono)) === 'ativo' ? 'ativo' : 'pode');
    })();
  }, [chavePublica, dono]);
  const ativar = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setEstado('negado');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(chavePublica!) });
      const r = await fetch('/api/p/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      setEstado(r.ok ? 'ativo' : 'falhou');
    } catch {
      setEstado('falhou');
    }
  };
  if (estado === 'carregando' || estado === 'instale') return null;
  return (
    <div className="space-y-2">
      {(estado === 'pode' || estado === 'falhou') && (
        <button onClick={ativar} className="min-h-11 rounded bg-emerald-700 px-4 text-white">Ativar notificações</button>
      )}
      {TEXTO[estado] && <p role={estado === 'falhou' ? 'alert' : 'status'}>{TEXTO[estado]}</p>}
    </div>
  );
}
```

Em `src/app/p/(portal)/inicio/page.tsx`: `<AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={ctx.patientId!} />` abaixo do `<Instalar />` (com `const { data, ctx } = await requirePaciente('/p/inicio')` na página; a Tarefa 11 repete em "Perfil > Notificações", com o mesmo `dono`). Depois de "Ativar" com sucesso, `ativar` também grava `sincronias.set(dono, Promise.resolve('ativo'))` (a próxima tela não pergunta de novo).

`src/app/p/acesso.tsx`: no mesmo `useEffect` de `RegistrarAcesso` (dependência `[dono]`), chamar também `void sincronizarAparelho(dono)` (de `./notificacoes`) — assim o endpoint troca de dono assim que B abre o portal, em qualquer página (não só no Início); o layout `(portal)` (que já lê `ctx` desde a Tarefa 5) renderiza `<RegistrarAcesso dono={ctx.patientId!} />`. (O `patientId` no HTML é o do próprio paciente da sessão — sem dado de saúde.)

`src/app/p/sair-portal.tsx`, `limparAparelho` passa a:

```ts
/** D6 / Review Focus 4: o plano guardado e a inscrição de push deste aparelho (servidor e navegador). No máximo 2 s. */
export async function limparAparelho(): Promise<void> {
  const tarefas: Promise<unknown>[] = [];
  if ('caches' in window) tarefas.push(caches.delete(CACHE_PLANO).catch(() => false));
  if ('serviceWorker' in navigator) {
    tarefas.push(
      (async () => {
        const reg = await navigator.serviceWorker.getRegistration('/p/');
        const sub = await reg?.pushManager.getSubscription();
        if (!sub) return;
        await fetch('/api/p/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }), keepalive: true }).catch(() => undefined);
        await sub.unsubscribe().catch(() => false);
      })().catch(() => undefined),
    );
  }
  await Promise.race([Promise.all(tarefas), new Promise((r) => setTimeout(r, 2000))]);
}
```

- [ ] **Step 12: E2E** — `e2e/portal.spec.ts`:

```ts
test('acesso do dia: abrir o portal registra o dia e renova o cookie de sessão (CS-02, P06-11)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.5');
  const renovou = p.page.waitForResponse((r) => r.url().endsWith('/api/p/acesso') && r.status() === 204);
  await p.page.goto('/p/inicio');
  const r = await renovou;
  expect(r.headers()['set-cookie']).toMatch(/session_token=.*Max-Age=2592000/);
  await p.page.context().close();
});

test('sem as chaves do VAPID no app, "Ativar notificações" não aparece e a tela explica', async ({ browser }) => {
  test.skip(!!process.env.VAPID_PUBLIC_KEY, 'o E2E com push de verdade precisa de um serviço de push real');
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.6');
  await expect(p.page.getByRole('status').filter({ hasText: 'Notificações no app ainda não estão disponíveis.' })).toBeVisible();
  await expect(p.page.getByRole('button', { name: 'Ativar notificações' })).toHaveCount(0);
  await p.page.context().close();
});
```

(A inscrição de verdade depende de um serviço de push — FCM — que o Chromium sem cabeça do CI não alcança: fica coberta pelos testes de unidade e pelo teste manual do runbook do deploy, no celular.)

Run: `pnpm build && pnpm test && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 13: Commit**

```bash
git add drizzle src/db src/env.ts src/env.test.ts .env.example src/modules/notificacoes src/modules/portal src/modules/plano-alimentar/publicacao.ts src/modules/plano-alimentar/publicacao.test.ts src/email src/lib/sessao-cookies.ts src/lib/sessao-cookies.test.ts src/app/sw.ts src/app/sw-regras.ts src/app/sw-regras.test.ts src/app/api/p src/app/p test/isolamento.test.ts e2e/portal.spec.ts
git commit -m "feat(portal): notificações no app (inscrição, push de teste, plano novo), acesso diário e cookie que desliza (US-040, US-025, P06-11)"
```

---
### Task 7: Diário alimentar — registro com texto e foto, limite de 10 por dia, conversão da foto no worker (P06-04, US-042, RN-07)

**Files:**
- Create: `src/modules/portal/diario-constantes.ts`, `src/modules/portal/diario.ts`, `src/modules/portal/diario.test.ts`, `src/modules/portal/diario-foto-job.ts`, `src/modules/portal/diario-foto-job.test.ts`, `drizzle/0076_diario.sql` (gerada), `drizzle/0077_rls_diario.sql` (custom), `src/app/api/p/diario/route.ts`, `src/app/api/p/diario/route.test.ts`, `src/app/p/(portal)/diario/page.tsx`, `src/app/p/(portal)/diario/diario-form.tsx`
- Modify: `package.json` + `pnpm-lock.yaml` (`heic-decode`), `src/db/schema/portal.ts`, `src/db/rls-guard.ts`, `src/modules/plataforma/audit.ts` (rótulo), `test/isolamento.test.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `src/modules/notificacoes/push.test.ts` (guarda do grafo), `src/app/p/navegacao.ts`, `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: `salvarArquivo`/`apagarArquivo`/`resolverCaminho`/`CotaEsgotadaError`/`TipoNaoPermitidoError`/`MSG_COTA_ESGOTADA` (`armazenamento.ts`, com `patientId` da Tarefa 2); `inicioDoDia`, `partesNoFuso`, `somarDias` (`@/modules/agenda/fuso`); `lerCorpoLimitado`, `CorpoGrandeError` (`@/lib/corpo`); `requireApiPaciente`, `requirePaciente`; `signFileUrl`; `getBoss`, `fromDrizzle`.
- Produces:
  - `@/modules/portal/diario-constantes` (sem banco, importável no cliente): `REFEICOES_DO_DIARIO` (`'Café da manhã' | 'Lanche da manhã' | 'Almoço' | 'Lanche da tarde' | 'Jantar' | 'Ceia' | 'Outro'`), `type RefeicaoDiario`, `FOTO_DIARIO_MAX_BYTES = 10 * 1024 * 1024`, `LIMITE_DIARIO_POR_DIA = 10`, `TEXTO_DIARIO_MAX = 2000`, `COMENTARIO_MAX = 1000`, `MSG_DIARIO`.
  - Schema `diaryEntries` 🔒 (`portal.ts`): `id`, `tenant_id`, `patient_id`, `data_hora`, `refeicao`, `texto`, `foto_path`, `foto_original_path`, `foto_status` (`sem_foto`/`processando`/`pronta`/`falhou`/`removida`), `comentario_nutri`, `comentado_em`, `visto_pela_nutri_em`, `created_at`, `updated_at`; `type DiaryEntryRow`.
  - `@/modules/portal/diario`: `class DiarioError { erros: Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>> }`, `registrarNoDiario(ctx: TenantContext, tenant: { fuso: string }, input: { refeicao: unknown; texto: unknown; foto: Buffer | null }, deps?: { db?: Db; agora?: Date; dataDir?: string; boss?: PgBoss }): Promise<{ id: string; semFoto: boolean }>` (`semFoto` = a foto não entrou por falta de cota), `type RegistroDoDiario = { id: string; dataHora: Date; refeicao: string; texto: string | null; foto: { estado: 'sem_foto' | 'processando' | 'falhou' } | { estado: 'pronta'; caminho: string }; comentario: string | null; comentadoEm: Date | null }`, `diarioDoPaciente(ctx: TenantContext, o?: { db?: Db; limite?: number }): Promise<RegistroDoDiario[]>`.
  - `@/modules/portal/diario-foto-job` (só worker): `MAX_PIXELS = 40_000_000`, `type DadosFotoDiario = { tenantId: string; entryId: string }`, `type ImagemHeic = { width: number; height: number; decode: () => Promise<{ data: Uint8ClampedArray }> }` (dimensões lidas do cabeçalho, pixels só no `decode()`), `converterFotoDoDiario(data, deps: { db: Db; dataDir: string; ultimaTentativa: boolean; abrirHeic?: (buf: Buffer) => Promise<ImagemHeic> }): Promise<'pronta' | 'ignorada' | 'falhou'>`.
  - Fila `diario-foto` (payload `{ tenantId, entryId }`).

- [ ] **Step 1: Dependência** — Run: `pnpm add heic-decode@2.1.0`. Expected: `"heic-decode": "2.1.0"` em `dependencies` (puxa `libheif-js` 1.23.2, WASM). Só o worker importa (Step 9).

**Conferir a API antes de seguir** (Review Focus 3, "bomba de descompressão"): o `decode({ buffer })` do `heic-decode` decodifica a imagem inteira em RGBA **antes** de devolver `width`/`height` — um HEIC de 2 MB que declara 20000 × 20000 alocaria ~1,6 GB no worker (VPS de 8 GB) antes de qualquer conferência. O job usa `decode.all({ buffer })`, que só lê o contêiner (o `HeifDecoder.decode` do `libheif-js` abre os *handles* das imagens, sem decodificar pixels) e devolve, por imagem, `{ width, height, decode() }` — os pixels só são alocados no `decode()`. Abrir `node_modules/heic-decode/README.md` e `index.js`/`lib.js` e confirmar: (a) `decode.all` existe e devolve `width`/`height` antes do `decode()`; (b) a primeira imagem da lista é a mesma que `decode()` usa. Se a versão instalada não tiver `decode.all` com esse formato, **parar e avisar** — a alternativa segura é ler a caixa `ispe` (largura/altura da imagem primária, `meta` → `iprp` → `ipco`) do buffer antes de chamar o `heic-decode`, com o mesmo teste do Step 5; nunca conferir os pixels depois do `decode()`.

- [ ] **Step 2: Constantes e tabela** — `src/modules/portal/diario-constantes.ts`:

```ts
/** US-042 / RN-07. Sem banco: o formulário (cliente) também usa. */
export const REFEICOES_DO_DIARIO = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outro'] as const;
export type RefeicaoDiario = (typeof REFEICOES_DO_DIARIO)[number];
export const FOTO_DIARIO_MAX_BYTES = 10 * 1024 * 1024; // RN-07
export const LIMITE_DIARIO_POR_DIA = 10; // RN-07
export const TEXTO_DIARIO_MAX = 2000;
export const COMENTARIO_MAX = 1000; // US-043 (Tarefa 8)

export const MSG_DIARIO = {
  refeicao: 'Escolha a refeição.',
  vazio: 'Escreva o que você comeu ou envie uma foto.',
  texto: 'Use no máximo 2000 caracteres.',
  foto: 'Envie uma foto JPEG, PNG ou HEIC de até 10 MB',
  limite: 'Limite de 10 registros por dia atingido',
  salvo: 'Registro salvo.',
  salvoSemFoto: 'Registro salvo sem a foto.',
  processando: 'Foto sendo preparada…',
  fotoFalhou: 'Não foi possível processar a foto.',
  nenhum: 'Nenhum registro ainda.',
  ocupado: 'Tente novamente em alguns instantes.',
} as const;
```

`src/db/schema/portal.ts`, acrescentar (com `check`, `index`, `text` no import e `storedFiles`, `REFEICOES_DO_DIARIO` — este por caminho relativo, como o `GRUPOS_TACO` em `alimentos.ts`, porque o drizzle-kit não resolve `@/`):

```ts
/** US-042 / US-043 (§7 + desvios): registro do diário com foto convertida no worker e comentário da nutricionista. */
export const diaryEntries = pgTable(
  'diary_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull().defaultNow(),
    refeicao: text('refeicao').notNull(),
    texto: text('texto'),
    /** JPEG convertido (≤ 1600 px, sem EXIF/GPS) — o único que o portal e o painel assinam. */
    fotoPath: text('foto_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    /** Original enviado (JPEG/PNG/HEIC) até a conversão; nunca é servido. */
    fotoOriginalPath: text('foto_original_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    fotoStatus: text('foto_status').notNull().default('sem_foto'),
    comentarioNutri: text('comentario_nutri'),
    comentadoEm: timestamp('comentado_em', { withTimezone: true }),
    vistoPelaNutriEm: timestamp('visto_pela_nutri_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('diary_entries_refeicao_valida', sql`${t.refeicao} in (${sql.raw(REFEICOES_DO_DIARIO.map((r) => `'${r}'`).join(', '))})`),
    check('diary_entries_texto_tamanho', sql`${t.texto} is null or char_length(${t.texto}) between 1 and 2000`),
    // 'removida': foto apagada pelo pedido de exclusão (US-018, Tarefa 11) — o registro fica
    check('diary_entries_foto_status_valido', sql`${t.fotoStatus} in ('sem_foto', 'processando', 'pronta', 'falhou', 'removida')`),
    check('diary_entries_tem_conteudo', sql`${t.texto} is not null or ${t.fotoStatus} <> 'sem_foto'`),
    check('diary_entries_comentario_tamanho', sql`${t.comentarioNutri} is null or char_length(${t.comentarioNutri}) between 1 and 1000`),
    check('diary_entries_foto_do_tenant', sql`${t.fotoPath} is null or ${t.fotoPath} like ${t.tenantId}::text || '/diario_foto/%'`),
    check('diary_entries_original_do_tenant', sql`${t.fotoOriginalPath} is null or ${t.fotoOriginalPath} like ${t.tenantId}::text || '/diario_foto_original/%'`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'diary_entries_paciente_fk' }),
    index('diary_entries_paciente_idx').on(t.tenantId, t.patientId, t.dataHora.desc()),
    // US-043: feed da nutricionista (não vistos primeiro, mais recentes)
    index('diary_entries_feed_idx').on(t.tenantId, t.vistoPelaNutriEm, t.dataHora.desc()),
  ],
);

export type DiaryEntryRow = typeof diaryEntries.$inferSelect;
```

Run: `pnpm db:generate --name diario` e `pnpm drizzle-kit generate --custom --name rls_diario`; `drizzle/0077_rls_diario.sql`:

```sql
SELECT app_enable_tenant_rls('diary_entries');
--> statement-breakpoint
SELECT app_enable_patient_rls('diary_entries');
--> statement-breakpoint
-- RNF-08: o diário é dado de saúde (texto do que comeu, foto); escritas no "Histórico de acessos" como "Diário"
SELECT app_enable_audit('diary_entries', 'diario');
--> statement-breakpoint
-- US-042 / D11: o paciente só cria registros (não altera nem apaga)
SELECT app_allow_paciente_escrita('diary_entries', 'insert');
```

`src/db/rls-guard.ts`: `PACIENTE_ESCREVE.diary_entries = { comandos: ['insert'], motivo: 'US-042: o paciente registra a refeição (não edita nem apaga, D11)' }`. `src/modules/plataforma/audit.ts`, `ENTIDADE_ROTULO.diario = 'Diário alimentar'`. `test/isolamento.test.ts`, `FABRICAS`:

```ts
  diary_entries: (t, p) => sql`insert into diary_entries (tenant_id, patient_id, refeicao, texto) values (${t}, ${p}, 'Almoço', 'arroz e feijão')`,
```

Run: `pnpm db:migrate && pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 3: Testes do registro (falham)** — `src/modules/portal/diario.test.ts`

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { diaryEntries, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { COTA_BYTES, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { MSG_DIARIO } from './diario-constantes';
import { DiarioError, diarioDoPaciente, registrarNoDiario } from './diario';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-diario-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const deps = (agora = new Date('2026-10-05T15:00:00Z')) => ({ db: app.db, dataDir, agora });
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DiarioError) return e.erros;
    throw e;
  }
  throw new Error('esperava DiarioError');
};

describe('diário (US-042, RN-07)', () => {
  it('"Almoço" com texto e foto: registro na hora, foto original guardada com dono e o job de conversão na fila', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const r = await registrarNoDiario(ctx, SP, { refeicao: 'Almoço', texto: 'arroz, feijão, frango', foto: JPEG }, deps());
    expect(r.semFoto).toBe(false);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, r.id)), app.db);
    expect(e).toMatchObject({ refeicao: 'Almoço', texto: 'arroz, feijão, frango', fotoStatus: 'processando', fotoPath: null });
    expect(e.fotoOriginalPath).toMatch(new RegExp(`^${T.tenantId}/diario_foto_original/`));
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, e.fotoOriginalPath!)), app.db);
    expect(f.patientId).toBe(p.id);
    const jobs = await (await getBoss()).findJobs('diario-foto');
    expect(jobs.some((j) => (j.data as { entryId: string }).entryId === r.id)).toBe(true);
  });

  it('validação: refeição fora da lista, vazio, texto longo, PDF no lugar da foto', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Brunch', texto: 'x', foto: null }, deps()))).toEqual({ refeicao: MSG_DIARIO.refeicao });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: '   ', foto: null }, deps()))).toEqual({ geral: MSG_DIARIO.vazio });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'a'.repeat(2001), foto: null }, deps()))).toEqual({ texto: MSG_DIARIO.texto });
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'x', foto: pdf }, deps()))).toEqual({ foto: MSG_DIARIO.foto });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Ceia', texto: 'x', foto: Buffer.alloc(10 * 1024 * 1024 + 1, 0xff) }, deps()))).toEqual({ foto: MSG_DIARIO.foto });
  });

  it('limite de 10 por dia no fuso do tenant: o 11º é recusado; 23:30 de Brasília ainda conta no mesmo dia; à 00:10 libera', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    for (let i = 0; i < 10; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps(new Date('2026-10-05T12:00:00Z')));
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: 'mais', foto: null }, deps(new Date('2026-10-06T02:30:00Z'))))).toEqual({ geral: MSG_DIARIO.limite });
    await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: 'novo dia', foto: null }, deps(new Date('2026-10-06T03:10:00Z')));
  });

  it('corrida: com 9 no dia, dois envios ao mesmo tempo → exatamente um entra (Review Focus 3)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    for (let i = 0; i < 9; i++) await registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `item ${i}`, foto: null }, deps());
    const r = await Promise.allSettled([1, 2].map((n) => registrarNoDiario(ctx, SP, { refeicao: 'Outro', texto: `c${n}`, foto: null }, deps())));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('cota esgotada (RN-18): o texto é salvo sem a foto; só a foto → "Espaço de armazenamento esgotado"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    const ctx = ctxPaciente(T.tenantId, p.id);
    const r = await registrarNoDiario(ctx, SP, { refeicao: 'Jantar', texto: 'sopa', foto: JPEG }, deps());
    expect(r.semFoto).toBe(true);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, r.id)), app.db);
    expect(e).toMatchObject({ texto: 'sopa', fotoStatus: 'sem_foto', fotoOriginalPath: null });
    expect(await erros(registrarNoDiario(ctx, SP, { refeicao: 'Jantar', texto: '', foto: JPEG }, deps()))).toEqual({ foto: MSG_COTA_ESGOTADA });
  });

  it('o paciente lê só os próprios registros, mais recentes primeiro; leitura auditada', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await registrarNoDiario(ctxPaciente(T.tenantId, p1.id), SP, { refeicao: 'Café da manhã', texto: 'pão', foto: null }, deps(new Date('2026-10-05T10:00:00Z')));
    await registrarNoDiario(ctxPaciente(T.tenantId, p1.id), SP, { refeicao: 'Almoço', texto: 'arroz', foto: null }, deps(new Date('2026-10-05T15:00:00Z')));
    await registrarNoDiario(ctxPaciente(T.tenantId, p2.id), SP, { refeicao: 'Almoço', texto: 'de outro', foto: null }, deps());
    const lista = await diarioDoPaciente(ctxPaciente(T.tenantId, p1.id), { db: app.db });
    expect(lista.map((x) => x.texto)).toEqual(['arroz', 'pão']);
    expect(lista[0].foto).toEqual({ estado: 'sem_foto' });
  });
});
```

Run: `pnpm test src/modules/portal/diario.test.ts` → FAIL.

- [ ] **Step 4: Implementação** — `src/modules/portal/diario.ts`

```ts
import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { diaryEntries, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { FOTO_DIARIO_MAX_BYTES, LIMITE_DIARIO_POR_DIA, MSG_DIARIO, REFEICOES_DO_DIARIO, TEXTO_DIARIO_MAX } from './diario-constantes';

export class DiarioError extends Error {
  override name = 'DiarioError';
  constructor(readonly erros: Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>>) {
    super('Registro do diário inválido');
  }
}

export type RegistroDoDiario = {
  id: string;
  dataHora: Date;
  refeicao: string;
  texto: string | null;
  foto: { estado: 'sem_foto' | 'processando' | 'falhou' } | { estado: 'pronta'; caminho: string };
  comentario: string | null;
  comentadoEm: Date | null;
};

type Deps = { db?: Db; agora?: Date; dataDir?: string; boss?: PgBoss };

/**
 * D12: trava o paciente (a corrida do 11º registro) e conta os registros do dia no fuso do tenant. Paciente fora de
 * "ativo" (RN-08) não registra — requirePaciente já barra; aqui é a garantia dentro da transação.
 */
async function conferirLimite(tx: Tx, patientId: string, fuso: string, agora: Date): Promise<void> {
  const [p] = await tx.select({ status: patients.status }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo') throw new DiarioError({ geral: 'Conta temporariamente indisponível' });
  const hoje = partesNoFuso(agora, fuso).data;
  const [{ n }] = await tx
    .select({ n: count() })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.patientId, patientId), gte(diaryEntries.dataHora, inicioDoDia(hoje, fuso)), lt(diaryEntries.dataHora, inicioDoDia(somarDias(hoje, 1), fuso))));
  if (n >= LIMITE_DIARIO_POR_DIA) throw new DiarioError({ geral: MSG_DIARIO.limite });
}

/**
 * US-042 / RN-07: registro com texto e/ou foto. A foto original (JPEG/PNG/HEIC ≤ 10 MB, tipo pelo conteúdo) entra por
 * salvarArquivo e o registro + o job de conversão vão no `registrar` (mesma transação, CLAUDE.md regra 9). Cota esgotada
 * com texto → o texto é salvo sem a foto (US-042 "Cota de armazenamento"); só a foto → erro da cota.
 */
export async function registrarNoDiario(
  ctx: TenantContext,
  tenant: { fuso: string },
  input: { refeicao: unknown; texto: unknown; foto: Buffer | null },
  deps: Deps = {},
): Promise<{ id: string; semFoto: boolean }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('registrarNoDiario só roda em sessão de paciente');
  const patientId = ctx.patientId;
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const refeicao = typeof input.refeicao === 'string' ? input.refeicao : '';
  if (!(REFEICOES_DO_DIARIO as readonly string[]).includes(refeicao)) throw new DiarioError({ refeicao: MSG_DIARIO.refeicao });
  const texto = typeof input.texto === 'string' ? input.texto.normalize('NFC').trim() : '';
  if (texto.length > TEXTO_DIARIO_MAX) throw new DiarioError({ texto: MSG_DIARIO.texto });
  const foto = input.foto && input.foto.length > 0 ? input.foto : null;
  if (!texto && !foto) throw new DiarioError({ geral: MSG_DIARIO.vazio });
  if (foto && foto.length > FOTO_DIARIO_MAX_BYTES) throw new DiarioError({ foto: MSG_DIARIO.foto });

  const soTexto = () =>
    withTenant(
      ctx,
      async (tx) => {
        await conferirLimite(tx, patientId, tenant.fuso, agora);
        const [e] = await tx.insert(diaryEntries).values({ tenantId: ctx.tenantId, patientId, dataHora: agora, refeicao, texto, createdAt: agora, updatedAt: agora }).returning({ id: diaryEntries.id });
        return e.id;
      },
      db,
    );
  if (!foto) return { id: await soTexto(), semFoto: false };

  const boss = deps.boss ?? (await getBoss());
  let id = '';
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'diario_foto_original',
        conteudo: foto,
        permitidos: ['jpg', 'png', 'heic'],
        patientId,
        antesDaReserva: (tx) => conferirLimite(tx, patientId, tenant.fuso, agora),
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .insert(diaryEntries)
            .values({ tenantId: ctx.tenantId, patientId, dataHora: agora, refeicao, texto: texto || null, fotoOriginalPath: arquivo.caminho, fotoStatus: 'processando', createdAt: agora, updatedAt: agora })
            .returning({ id: diaryEntries.id });
          id = e.id;
          const job = await boss.send('diario-foto', { tenantId: ctx.tenantId, entryId: e.id }, { db: fromDrizzle(tx, sql) });
          if (!job) throw new Error('A fila recusou a conversão da foto');
        },
      },
      { db, dataDir: deps.dataDir },
    );
    return { id, semFoto: false };
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new DiarioError({ foto: MSG_DIARIO.foto });
    if (e instanceof CotaEsgotadaError) {
      if (!texto) throw new DiarioError({ foto: MSG_COTA_ESGOTADA });
      return { id: await soTexto(), semFoto: true };
    }
    throw e;
  }
}

/** US-042: os registros do paciente da sessão (mais recentes primeiro), com o estado da foto. Leitura auditada (D22). */
export async function diarioDoPaciente(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<RegistroDoDiario[]> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('diarioDoPaciente só roda em sessão de paciente');
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, ctx.patientId!)).orderBy(desc(diaryEntries.dataHora)).limit(o.limite ?? 50);
      if (r.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId: ctx.patientId! });
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map(paraRegistro);
}

export function paraRegistro(e: typeof diaryEntries.$inferSelect): RegistroDoDiario {
  return {
    id: e.id,
    dataHora: e.dataHora,
    refeicao: e.refeicao,
    texto: e.texto,
    foto:
      e.fotoStatus === 'pronta' && e.fotoPath
        ? { estado: 'pronta', caminho: e.fotoPath }
        : { estado: e.fotoStatus === 'pronta' ? 'falhou' : e.fotoStatus === 'removida' ? 'sem_foto' : (e.fotoStatus as 'sem_foto' | 'processando' | 'falhou') },
    comentario: e.comentarioNutri,
    comentadoEm: e.comentadoEm,
  };
}
```

`src/jobs/queues.ts`, em `QUEUES`:

```ts
  // US-042 / RN-07: foto do diário convertida (JPEG ≤ 1600 px, sem EXIF/GPS) e original apagado. Payload { tenantId, entryId }.
  'diario-foto': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
```

Run: `pnpm test src/modules/portal/diario.test.ts` → PASS.

- [ ] **Step 5: Testes da conversão (falham)** — `src/modules/portal/diario-foto-job.test.ts`

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { diaryEntries, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { registrarNoDiario } from './diario';
import { converterFotoDoDiario, MAX_PIXELS } from './diario-foto-job';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-diario-foto-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

/** JPEG 3000 × 2000 com EXIF (Copyright marcado) — o resultado não pode levar nada disso. */
const fotoComExif = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#88aa44' } })
    .withExif({ IFD0: { Copyright: 'marca-exif-gps' } })
    .jpeg()
    .toBuffer();

async function registro(foto: Buffer) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await registrarNoDiario(ctxPaciente(T.tenantId, p.id), { fuso: 'America/Sao_Paulo' }, { refeicao: 'Almoço', texto: null, foto }, { db: app.db, dataDir });
  const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, id)), app.db))[0];
  return { T, p, id, ler };
}
const deps = { db: app.db, dataDir, ultimaTentativa: false };
/** Passa pelo detectarTipo como HEIC (caixa ftyp) — o conteúdo de verdade vem do `abrirHeic` simulado. */
const HEIC_FALSO = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]);

describe('conversão da foto do diário (RN-07)', () => {
  it('JPEG grande com EXIF → JPEG de no máximo 1600 px, sem EXIF; original apagado do disco e da cota', async () => {
    const r = await registro(await fotoComExif());
    const antes = await r.ler();
    const usadoAntes = (await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes;
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('pronta');
    const depois = await r.ler();
    expect(depois).toMatchObject({ fotoStatus: 'pronta', fotoOriginalPath: null });
    const jpeg = await sharp(resolverCaminho(dataDir, depois.fotoPath!)).metadata();
    expect([jpeg.format, Math.max(jpeg.width!, jpeg.height!)]).toEqual(['jpeg', 1600]);
    expect(jpeg.exif).toBeUndefined();
    expect(existsSync(resolverCaminho(dataDir, antes.fotoOriginalPath!))).toBe(false);
    const sobra = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, antes.fotoOriginalPath!)), app.db);
    expect(sobra).toEqual([]);
    const usadoDepois = (await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes;
    expect(usadoDepois).toBeLessThan(usadoAntes);
  });

  it('HEIC: decodificado pelo heic-decode (aqui simulado) e convertido do mesmo jeito', async () => {
    const r = await registro(HEIC_FALSO);
    const abrirHeic = async () => ({ width: 2400, height: 1800, decode: async () => ({ data: new Uint8ClampedArray(2400 * 1800 * 4).fill(200) }) });
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('pronta');
    const m = await sharp(resolverCaminho(dataDir, (await r.ler()).fotoPath!)).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 1600, 1200]);
  });

  it('HEIC que declara 20000 × 20000 ("bomba de descompressão"): recusado pelo cabeçalho, os pixels nunca são decodificados', async () => {
    const r = await registro(HEIC_FALSO);
    let decodificou = false;
    const abrirHeic = async () => ({
      width: 20_000,
      height: 20_000,
      decode: async () => {
        decodificou = true; // o heic-decode de verdade alocaria ~1,6 GB aqui
        return { data: new Uint8ClampedArray(0) };
      },
    });
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('falhou');
    expect(decodificou).toBe(false);
    expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoOriginalPath: null, fotoPath: null });
  });

  it('HEIC cujo decode devolve menos pixels que o cabeçalho declarou → "falhou" (nada de ler além do buffer)', async () => {
    const r = await registro(HEIC_FALSO);
    const abrirHeic = async () => ({ width: 2400, height: 1800, decode: async () => ({ data: new Uint8ClampedArray(16) }) });
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('falhou');
  });

  it('imagem acima de 40 MP ("bomba de descompressão") ou que não decodifica → "falhou", original apagado (definitivo)', async () => {
    const enorme = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(8000 * 6000).toBeGreaterThan(MAX_PIXELS);
    const r = await registro(enorme);
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('falhou');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoOriginalPath: null, fotoPath: null });
    const quebrada = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    const q = await registro(quebrada);
    expect(await converterFotoDoDiario({ tenantId: q.T.tenantId, entryId: q.id }, deps)).toBe('falhou');
  });

  it('idempotente: rodar de novo depois de pronta não faz nada', async () => {
    const r = await registro(await fotoComExif());
    await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps);
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('ignorada');
  });

  it('regra 9: o worker caiu entre gravar o JPEG e apagar o original → a nova tentativa só apaga o original (disco, stored_files e cota) e solta o ponteiro', async () => {
    const r = await registro(await fotoComExif());
    const { fotoOriginalPath } = await r.ler();
    // O estado que a queda deixa: JPEG gravado e apontado, registro "pronta" ainda apontando para o original
    const pequeno = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const jpeg = await salvarArquivo(r.T.ctx, { tipo: 'diario_foto', conteudo: pequeno, permitidos: ['jpg'], patientId: r.p.id }, { db: app.db, dataDir });
    await withTenant(r.T.ctx, (tx) => tx.update(diaryEntries).set({ fotoStatus: 'pronta', fotoPath: jpeg.caminho }).where(eq(diaryEntries.id, r.id)), app.db);
    const usadoAntes = (await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes;
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('ignorada');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'pronta', fotoOriginalPath: null, fotoPath: jpeg.caminho });
    expect(existsSync(resolverCaminho(dataDir, fotoOriginalPath!))).toBe(false);
    const sobra = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, fotoOriginalPath!)), app.db);
    expect(sobra).toEqual([]);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes).toBeLessThan(usadoAntes);
  });

  it('o heic-decode de verdade carrega no Node (WASM), expõe decode.all e recusa o que não é HEIC', async () => {
    const { default: decode } = await import('heic-decode');
    expect(typeof decode.all).toBe('function');
    await expect(decode.all({ buffer: Buffer.from('não é heic') })).rejects.toThrow();
  });
});
```

(A foto quebrada passa pelo `detectarTipo` — começa com a assinatura JPEG — e só falha no `sharp`: o caso "arquivo corrompido" do Review Focus 3.)

- [ ] **Step 6: Implementação da conversão** — `src/modules/portal/diario-foto-job.ts`

```ts
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { diaryEntries } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';

// Só o worker importa este arquivo (sharp + heic-decode/WASM): nenhuma rota do Next (guarda no grafo de imports).

/** RN-07 / Review Focus 3: acima disto (≈ 40 MP, mais que qualquer câmera de celular) é recusado — "bomba de descompressão". */
export const MAX_PIXELS = 40_000_000;
const LADO_MAX = 1600;

export type DadosFotoDiario = { tenantId: string; entryId: string };
/** Dimensões lidas do cabeçalho do HEIC; os pixels (RGBA) só são alocados no `decode()`. */
export type ImagemHeic = { width: number; height: number; decode: () => Promise<{ data: Uint8ClampedArray }> };
type AbrirHeic = (buf: Buffer) => Promise<ImagemHeic>;

class FotoInvalidaError extends Error {}

/** `decode.all` só abre o contêiner (Step 1): nada de pixels até o `decode()` — a conferência dos 40 MP vem antes. */
const heicDeVerdade: AbrirHeic = async (buf) => {
  const { default: decode } = await import('heic-decode');
  const [primeira] = await decode.all({ buffer: buf });
  if (!primeira) throw new Error('HEIC sem imagem');
  return primeira;
};

const grandeDemais = (width: number | undefined, height: number | undefined) =>
  !width || !height || width <= 0 || height <= 0 || width * height > MAX_PIXELS;

/** Pixels → JPEG ≤ 1600 px no maior lado, qualidade 80, sem metadados (o sharp só copia EXIF/GPS com withMetadata). */
async function paraJpeg(original: Buffer, ext: string, abrirHeic: AbrirHeic): Promise<Buffer> {
  let img: sharp.Sharp;
  if (ext === 'heic') {
    const heic = await abrirHeic(original).catch(() => {
      throw new FotoInvalidaError('heic');
    });
    // Bomba de descompressão: recusar pelo cabeçalho, ANTES de decodificar (o decode aloca largura × altura × 4 bytes)
    if (grandeDemais(heic.width, heic.height)) throw new FotoInvalidaError('pixels');
    const { data } = await heic.decode().catch(() => {
      throw new FotoInvalidaError('heic');
    });
    if (data.byteLength !== heic.width * heic.height * 4) throw new FotoInvalidaError('heic');
    img = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: heic.width, height: heic.height, channels: 4 }, limitInputPixels: MAX_PIXELS });
  } else {
    const meta = await sharp(original).metadata().catch(() => {
      throw new FotoInvalidaError('metadata');
    }); // só o cabeçalho: o sharp não decodifica pixels no metadata()
    if (grandeDemais(meta.width, meta.height)) throw new FotoInvalidaError('pixels');
    img = sharp(original, { limitInputPixels: MAX_PIXELS }).rotate(); // aplica a orientação do EXIF antes de descartá-lo
  }
  return img
    .resize({ width: LADO_MAX, height: LADO_MAX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // PNG com transparência → fundo branco
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
    .catch(() => {
      throw new FotoInvalidaError('conversao');
    });
}

/**
 * Job `diario-foto` (US-042 / RN-07). Idempotente: age sobre registro "processando" com original (converte) ou
 * "pronta" que ainda aponta para o original (o worker caiu entre gravar o JPEG e apagar o original: só apaga).
 * CLAUDE.md regra 9: o JPEG entra por salvarArquivo e o registro aponta para ele no `registrar`; o original sai por
 * apagarArquivo e o ponteiro `foto_original_path` é limpo no `naMesmaTransacao` dele — nunca numa transação separada
 * (senão uma queda entre as duas deixa o original no disco, contando na cota, sem nada que aponte para ele).
 * Imagem que não decodifica ou grande demais → "falhou" na hora (definitivo) e o original sai. Erro de infraestrutura →
 * o pg-boss tenta de novo; na última tentativa, "falhou".
 * ORDEM DE TRAVAS: registro do diário → tenant (cota), nos dois caminhos (`antesDaReserva` e `naMesmaTransacao`).
 */
export async function converterFotoDoDiario(
  data: DadosFotoDiario,
  deps: { db: Db; dataDir: string; ultimaTentativa: boolean; abrirHeic?: AbrirHeic },
): Promise<'pronta' | 'ignorada' | 'falhou'> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const [e] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select()
        .from(diaryEntries)
        .where(and(eq(diaryEntries.id, data.entryId), isNotNull(diaryEntries.fotoOriginalPath), inArray(diaryEntries.fotoStatus, ['processando', 'pronta']))),
    deps.db,
  );
  if (!e?.fotoOriginalPath) return 'ignorada';
  const original = e.fotoOriginalPath;
  const arquivos = { db: deps.db, dataDir: deps.dataDir };
  /** Apaga o original e, na MESMA transação, o ponteiro (e o que mais `set` disser) — só se o registro ainda aponta para ele. */
  const apagarOriginal = (set: Partial<typeof diaryEntries.$inferInsert>, status: 'processando' | 'pronta') =>
    apagarArquivo(ctx, { caminho: original }, {
      ...arquivos,
      naMesmaTransacao: async (tx) => {
        const r = await tx
          .update(diaryEntries)
          .set({ ...set, fotoOriginalPath: null, updatedAt: new Date() })
          .where(and(eq(diaryEntries.id, e.id), eq(diaryEntries.fotoStatus, status), eq(diaryEntries.fotoOriginalPath, original)))
          .returning({ id: diaryEntries.id });
        return r.length > 0;
      },
    });
  if (e.fotoStatus === 'pronta') {
    await apagarOriginal({}, 'pronta'); // sobra de uma tentativa que caiu depois de gravar o JPEG
    return 'ignorada';
  }
  const falhar = async (): Promise<'falhou'> => {
    await apagarOriginal({ fotoStatus: 'falhou' }, 'processando');
    return 'falhou';
  };
  let convertida = false;
  try {
    const buf = await readFile(resolverCaminho(deps.dataDir, original));
    const jpeg = await paraJpeg(buf, original.slice(original.lastIndexOf('.') + 1), deps.abrirHeic ?? heicDeVerdade);
    await salvarArquivo(
      ctx,
      {
        tipo: 'diario_foto',
        conteudo: jpeg,
        permitidos: ['jpg'],
        patientId: e.patientId,
        // Trava o registro antes da cota (mesma ordem do apagarArquivo abaixo)
        antesDaReserva: async (tx) => {
          const [ainda] = await tx
            .select({ id: diaryEntries.id })
            .from(diaryEntries)
            .where(and(eq(diaryEntries.id, e.id), eq(diaryEntries.fotoStatus, 'processando'), eq(diaryEntries.fotoOriginalPath, original)))
            .for('update');
          if (!ainda) throw new Error('registro do diário mudou durante a conversão');
        },
        // O original continua apontado aqui: quem o solta é o naMesmaTransacao do apagarArquivo
        registrar: async (tx, arquivo) => {
          await tx.update(diaryEntries).set({ fotoPath: arquivo.caminho, fotoStatus: 'pronta', updatedAt: new Date() }).where(eq(diaryEntries.id, e.id));
        },
      },
      arquivos,
    );
    convertida = true;
    await apagarOriginal({}, 'pronta');
    return 'pronta';
  } catch (err) {
    if (convertida) {
      // O JPEG já está gravado e apontado; o registro ainda aponta para o original (não é órfão): outra tentativa o apaga
      logger.warn({ tenantId: data.tenantId, entryId: data.entryId, motivo: 'original' }, 'original da foto do diário não apagado');
      if (!deps.ultimaTentativa) throw err;
      return 'pronta';
    }
    const definitivo = err instanceof FotoInvalidaError || deps.ultimaTentativa;
    // RNF-11: só ids e o motivo; nunca o caminho nem o conteúdo
    logger.warn({ tenantId: data.tenantId, entryId: data.entryId, motivo: err instanceof FotoInvalidaError ? err.message : 'erro', definitivo }, 'falha ao converter a foto do diário');
    if (!definitivo) throw err;
    return falhar();
  }
}
```

(Uma falha no `apagarOriginal` depois do `salvarArquivo` — banco fora no meio — não estraga a foto convertida: o pg-boss tenta de novo e a nova tentativa encontra o registro "pronta" ainda apontando para o original e só o apaga. Se até a última tentativa falhar aí, o registro continua apontando para o original — `anexosDoPaciente` e `apagarFotosDoDiario` (Tarefa 11) o enxergam e o apagam na exclusão/anonimização; nada fica órfão no disco.)

Tipos do `heic-decode` (se o pacote não trouxer): `src/types/heic-decode.d.ts`:

```ts
declare module 'heic-decode' {
  type Pixels = { width: number; height: number; data: Uint8ClampedArray };
  /** Decodifica a imagem inteira — NÃO usar no job (aloca antes de conferir o tamanho). */
  function decode(o: { buffer: Buffer | ArrayBuffer }): Promise<Pixels>;
  namespace decode {
    /** Só abre o contêiner: `width`/`height` do cabeçalho; os pixels só no `decode()` de cada imagem. */
    function all(o: { buffer: Buffer | ArrayBuffer }): Promise<{ width: number; height: number; decode: () => Promise<Pixels> }[]>;
  }
  export default decode;
}
```

`src/worker/index.ts`, perto do `plano-pdf`:

```ts
  // US-042 / RN-07: foto do diário convertida no worker (sharp + heic-decode)
  await boss.work('diario-foto', { includeMetadata: true }, async ([job]: JobWithMetadata<DadosFotoDiario>[]) => {
    await converterFotoDoDiario(job.data, { db: getDb(), dataDir: env.DATA_DIR, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
```

`src/modules/notificacoes/push.test.ts`, na guarda "R1": acrescentar `'src/modules/portal/diario-foto-job.ts'` à lista de `proibido` e `expect(g.pacotes.get('heic-decode')).toBeUndefined();`.

Run: `pnpm test src/modules/portal src/modules/notificacoes/push.test.ts` → PASS.

- [ ] **Step 7: Rota do envio** — `src/app/api/p/diario/route.ts`:

```ts
import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { requireApiPaciente, type ApiPaciente } from '@/lib/paciente-session';
import { DiarioError, registrarNoDiario } from '@/modules/portal/diario';
import { FOTO_DIARIO_MAX_BYTES, MSG_DIARIO } from '@/modules/portal/diario-constantes';

export const dynamic = 'force-dynamic';

const LIMITE_CORPO = FOTO_DIARIO_MAX_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
// Cada envio segura até ~3 cópias de 10 MB; a VPS é dividida com o CRM de produção (mesmo cuidado do upload de exame)
const MAX_ENVIOS = 2;
let emAndamento = 0;

/** US-042: multipart (refeicao, texto, foto opcional). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request): Promise<Response> {
  const origem = req.headers.get('origin');
  if (origem !== null && origem !== new URL(getEnv().APP_URL).origin) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { foto: MSG_DIARIO.foto } });
  if (emAndamento >= MAX_ENVIOS) return resposta(429, { erros: { geral: MSG_DIARIO.ocupado } });
  emAndamento++;
  try {
    return await receber(req, acesso);
  } finally {
    emAndamento--;
  }
}

async function receber(req: Request, acesso: Extract<ApiPaciente, { ok: true }>): Promise<Response> {
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erros: { foto: MSG_DIARIO.foto } });
    return resposta(400, { erros: { geral: 'Formulário inválido.' } });
  }
  const arquivo = form.get('foto');
  const foto = arquivo instanceof Blob && arquivo.size > 0 ? Buffer.from(await arquivo.arrayBuffer()) : null;
  try {
    const r = await registrarNoDiario(acesso.ctx, acesso.tenant, { refeicao: form.get('refeicao'), texto: form.get('texto'), foto });
    return resposta(200, { ok: true, id: r.id, mensagem: r.semFoto ? MSG_DIARIO.salvoSemFoto : MSG_DIARIO.salvo, semFoto: r.semFoto });
  } catch (e) {
    if (e instanceof DiarioError) {
      const status = e.erros.foto ? (foto && foto.length > FOTO_DIARIO_MAX_BYTES ? 413 : e.erros.foto === MSG_DIARIO.foto ? 415 : 507) : e.erros.geral === MSG_DIARIO.limite ? 409 : 400;
      return resposta(status, { erros: e.erros });
    }
    throw e;
  }
}
```

`src/app/api/p/diario/route.test.ts`: molde dos testes da rota do exame (`src/app/api/painel/pacientes/[id]/exames/route.test.ts`), com sessão de paciente real (`pacienteComConta` + `entrar`): sem sessão → 401; outra origem → 403; `content-length` acima de 10 MB + 64 KB → 413 com `MSG_DIARIO.foto`; PDF no campo `foto` → 415; 11º do dia → 409 `MSG_DIARIO.limite`; texto + JPEG válido → 200 `MSG_DIARIO.salvo`.

- [ ] **Step 8: Tela** — `src/app/p/(portal)/diario/diario-form.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { FOTO_DIARIO_MAX_BYTES, MSG_DIARIO, REFEICOES_DO_DIARIO } from '@/modules/portal/diario-constantes';

type Erros = Partial<Record<'refeicao' | 'texto' | 'foto' | 'geral', string>>;

/** US-042: envia por fetch (multipart) e mostra a miniatura local na hora, antes de o worker converter a foto. */
export function DiarioForm() {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [ok, setOk] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dados = new FormData(form);
    const foto = dados.get('foto');
    if (foto instanceof File && foto.size > FOTO_DIARIO_MAX_BYTES) return setErros({ foto: MSG_DIARIO.foto });
    setEnviando(true);
    setErros({});
    setOk(null);
    try {
      const r = await fetch('/api/p/diario', { method: 'POST', body: dados });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Erros; mensagem?: string };
      if (!r.ok) return setErros(corpo.erros ?? { geral: MSG_DIARIO.ocupado });
      setOk(corpo.mensagem ?? MSG_DIARIO.salvo);
      form.reset();
      router.refresh();
    } catch {
      setErros({ geral: MSG_DIARIO.ocupado });
    } finally {
      setEnviando(false);
    }
  };
  const campoErro = (id: keyof Erros) => (erros[id] ? { 'aria-invalid': true, 'aria-describedby': `${id}-erro` } : {});
  return (
    <form onSubmit={enviar} className="space-y-3" noValidate>
      <div className="space-y-1">
        <label htmlFor="refeicao" className="block font-medium">Refeição</label>
        <select id="refeicao" name="refeicao" defaultValue="" className="min-h-11 w-full rounded border p-2" {...campoErro('refeicao')}>
          <option value="" disabled>Escolha a refeição</option>
          {REFEICOES_DO_DIARIO.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {erros.refeicao && <p id="refeicao-erro" role="alert" className="text-sm text-red-700">{erros.refeicao}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="texto" className="block font-medium">O que você comeu?</label>
        <textarea id="texto" name="texto" maxLength={2000} rows={3} className="w-full rounded border p-2" {...campoErro('texto')} />
        {erros.texto && <p id="texto-erro" role="alert" className="text-sm text-red-700">{erros.texto}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="foto" className="block font-medium">Foto (opcional)</label>
        <input
          id="foto"
          name="foto"
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPrevia(f ? URL.createObjectURL(f) : null);
          }}
          className="block min-h-11"
          {...campoErro('foto')}
        />
        {erros.foto && <p id="foto-erro" role="alert" className="text-sm text-red-700">{erros.foto}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:), antes de enviar */}
        {previa && <img src={previa} alt="Miniatura da foto escolhida" className="h-24 w-24 rounded object-cover" />}
      </div>
      {erros.geral && <p role="alert" className="text-red-700">{erros.geral}</p>}
      {ok && <p role="status" className="rounded bg-emerald-50 p-3">{ok}</p>}
      <button disabled={enviando} className="min-h-11 rounded bg-emerald-700 px-4 text-white">Registrar</button>
    </form>
  );
}
```

(A miniatura de HEIC só aparece no Safari, que lê HEIC; nos outros navegadores o `<img>` não carrega — o `alt` cobre.)

`src/app/p/(portal)/diario/page.tsx`:

```tsx
import { requirePaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { diarioDoPaciente } from '@/modules/portal/diario';
import { MSG_DIARIO } from '@/modules/portal/diario-constantes';
import { DiarioForm } from './diario-form';

export const dynamic = 'force-dynamic';

export default async function Diario() {
  const { ctx, tenant } = await requirePaciente('/p/diario');
  const registros = await diarioDoPaciente(ctx);
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Diário</h1>
      <section aria-labelledby="registrar" className="space-y-3">
        <h2 id="registrar" className="text-lg font-semibold">Registrar refeição</h2>
        <DiarioForm />
      </section>
      {registros.length === 0 ? (
        <p>{MSG_DIARIO.nenhum}</p>
      ) : (
        <ol className="space-y-4">
          {registros.map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-3">
              <p className="font-medium">{`${r.refeicao} · ${quandoComFuso(r.dataHora, tenant.fuso)}`}</p>
              {r.texto && <p className="whitespace-pre-line">{r.texto}</p>}
              {r.foto.estado === 'pronta' && (
                // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (CLAUDE.md regra 9)
                <img src={signFileUrl(r.foto.caminho)} alt={`Foto do registro de ${r.refeicao}`} className="max-h-80 rounded" />
              )}
              {r.foto.estado === 'processando' && <p role="status" className="text-sm">{MSG_DIARIO.processando}</p>}
              {r.foto.estado === 'falhou' && <p className="text-sm text-red-700">{MSG_DIARIO.fotoFalhou}</p>}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
```

(`quandoComFuso` é o formato das datas do Plano 05 — "seg., 05/10 às 12:00 (horário de Brasília)"; se ele exigir outro formato de entrada, usar `formatarQuando`.) `src/app/p/navegacao.ts`: acrescentar `{ href: '/p/diario', rotulo: 'Diário' }` depois de "Plano".

- [ ] **Step 9: E2E** — `e2e/portal.spec.ts`:

```ts
test('diário: registro com texto e foto aparece na hora; o worker converte a foto; arquivo grande é recusado (US-042)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.7');
  await p.page.goto('/p/diario');
  await p.page.getByLabel('Refeição').selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill('arroz, feijão, frango');
  await p.page.getByLabel('Foto (opcional)').setInputFiles('e2e/fixtures/prato.jpg');
  await expect(p.page.getByAltText('Miniatura da foto escolhida')).toBeVisible();
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  await expect(p.page.getByText('arroz, feijão, frango')).toBeVisible();
  await expect.poll(async () => { await p.page.reload(); return p.page.getByAltText('Foto do registro de Almoço').count(); }, { timeout: 30_000 }).toBe(1);
  await p.page.getByLabel('Refeição').selectOption('Jantar');
  await p.page.getByLabel('Foto (opcional)').setInputFiles({ name: 'grande.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(11 * 1024 * 1024, 0xff) });
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.locator('#foto-erro')).toHaveText('Envie uma foto JPEG, PNG ou HEIC de até 10 MB');
  await p.page.context().close();
});
```

`e2e/fixtures/prato.jpg`: um JPEG pequeno (gerar uma vez com `node -e "require('sharp')({create:{width:800,height:600,channels:3,background:'#c84'}}).jpeg().toFile('e2e/fixtures/prato.jpg')"` e versionar).

Run: `pnpm build && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml drizzle src/db src/modules/portal src/modules/plataforma/audit.ts src/jobs/queues.ts src/worker/index.ts src/modules/notificacoes/push.test.ts src/app/api/p/diario "src/app/p/(portal)/diario" src/app/p/navegacao.ts test/isolamento.test.ts e2e
git commit -m "feat(portal): diário alimentar com foto (conversão no worker, HEIC, limite de 10 por dia, cota) — US-042"
```

---
### Task 8: "Diários" da nutricionista — feed com os não vistos primeiro, comentário e push ao paciente (P06-05, US-043)

**Files:**
- Create: `src/modules/portal/diario-nutri.ts`, `src/modules/portal/diario-nutri.test.ts`, `src/app/painel/diarios/page.tsx`, `src/app/painel/diarios/[id]/page.tsx`, `src/app/painel/diarios/actions.ts`, `src/app/painel/diarios/comentario-form.tsx`
- Modify: `src/app/painel/cabecalho.tsx` (link "Diários"), `src/app/p/(portal)/diario/page.tsx` (comentário), `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: `diaryEntries`, `paraRegistro`, `RegistroDoDiario`, `COMENTARIO_MAX` (Tarefa 7); `avisarComentario` (Tarefa 6); `auditRead`; `requireNutri`; `idValido`.
- Produces:
  - `@/modules/portal/diario-nutri`: `MSG_COMENTARIO = { vazio: 'Escreva o comentário.', tamanho: 'Use no máximo 1000 caracteres.', salvo: 'Comentário salvo.', naoEncontrado: 'Registro não encontrado.', nenhum: 'Nenhum registro de diário ainda.' }`, `class ComentarioError { erros: { comentario: string } }`, `type ItemDoFeed = RegistroDoDiario & { patientId: string; paciente: string; visto: boolean; somenteLeitura: boolean }` (`somenteLeitura` = paciente bloqueado ou anonimizado), `feedDeDiarios(ctx: TenantContext, o?: { db?: Db; limite?: number }): Promise<ItemDoFeed[]>`, `abrirRegistro(ctx: TenantContext, id: string, o?: { db?: Db; agora?: Date }): Promise<ItemDoFeed | null>` (preenche `visto_pela_nutri_em` na primeira abertura), `comentarRegistro(ctx: TenantContext, id: string, texto: unknown, o?: { db?: Db; agora?: Date }): Promise<{ primeiro: boolean }>`.

- [ ] **Step 1: Testes (falham)** — `src/modules/portal/diario-nutri.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, diaryEntries, notifications, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { registrarNoDiario } from './diario';
import { abrirRegistro, ComentarioError, comentarRegistro, feedDeDiarios, MSG_COMENTARIO } from './diario-nutri';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = { fuso: 'America/Sao_Paulo' };

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
  const reg = (p: typeof ana, texto: string, quando: string) =>
    registrarNoDiario(ctxPaciente(T.tenantId, p.id), SP, { refeicao: 'Almoço', texto, foto: null }, { db: app.db, agora: new Date(quando) });
  const a1 = await reg(ana, 'arroz', '2026-10-05T15:00:00Z');
  const b1 = await reg(bia, 'salada', '2026-10-05T16:00:00Z');
  const a2 = await reg(ana, 'peixe', '2026-10-05T17:00:00Z');
  return { T, ana, bia, a1, b1, a2 };
}

describe('Diários da nutricionista (US-043)', () => {
  it('feed: todos os pacientes, não vistos primeiro (mais recentes antes); abrir marca visto uma vez', async () => {
    const { T, a1, b1, a2 } = await cenario();
    await abrirRegistro(T.ctx, b1.id, { db: app.db, agora: new Date('2026-10-05T18:00:00Z') });
    const feed = await feedDeDiarios(T.ctx, { db: app.db });
    expect(feed.map((f) => [f.id, f.visto])).toEqual([[a2.id, false], [a1.id, false], [b1.id, true]]);
    expect(feed[0].paciente).toBe('Ana Souza');
    const primeira = await abrirRegistro(T.ctx, b1.id, { db: app.db, agora: new Date('2026-10-06T10:00:00Z') });
    expect(primeira?.visto).toBe(true); // a data do "visto" não muda na segunda abertura
  });

  it('comentar: o paciente vê; push só no primeiro comentário (D13); vazio e longo recusados', async () => {
    const { T, ana, a1 } = await cenario();
    expect(await comentarRegistro(T.ctx, a1.id, 'Ótima escolha de proteína!', { db: app.db })).toEqual({ primeiro: true });
    expect(await comentarRegistro(T.ctx, a1.id, 'Ótima escolha de proteína! Capriche na salada.', { db: app.db })).toEqual({ primeiro: false });
    const pushes = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, ana.id), eq(notifications.tipo, 'comentario_diario'))), app.db);
    expect(pushes).toHaveLength(1);
    const visto = (await import('./diario')).diarioDoPaciente;
    expect((await visto(ctxPaciente(T.tenantId, ana.id), { db: app.db })).find((r) => r.id === a1.id)?.comentario).toBe('Ótima escolha de proteína! Capriche na salada.');
    await expect(comentarRegistro(T.ctx, a1.id, '  ', { db: app.db })).rejects.toEqual(new ComentarioError({ comentario: MSG_COMENTARIO.vazio }));
    await expect(comentarRegistro(T.ctx, a1.id, 'x'.repeat(1001), { db: app.db })).rejects.toEqual(new ComentarioError({ comentario: MSG_COMENTARIO.tamanho }));
  });

  it('id de outro tenant ou inválido → null / erro de não encontrado; o paciente não comenta (sem update)', async () => {
    const { T, ana, a1 } = await cenario();
    const outro = await novoTenant(app.db);
    expect(await abrirRegistro(outro.ctx, a1.id, { db: app.db })).toBeNull();
    expect(await abrirRegistro(T.ctx, 'abc', { db: app.db })).toBeNull();
    await expect(comentarRegistro(outro.ctx, a1.id, 'oi', { db: app.db })).rejects.toThrow(MSG_COMENTARIO.naoEncontrado);
    await expect(comentarRegistro(ctxPaciente(T.tenantId, ana.id), a1.id, 'eu mesmo', { db: app.db })).rejects.toThrow(/sessão da nutricionista/);
  });

  it('paciente bloqueado (pedido de exclusão) ou anonimizado: o prontuário é só leitura — comentar recusa e não manda push', async () => {
    const { T, ana, bia, a1, b1 } = await cenario();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, ana.id)), app.db);
    expect((await abrirRegistro(T.ctx, a1.id, { db: app.db }))?.somenteLeitura).toBe(true); // a tela esconde o "Comentar"
    await expect(comentarRegistro(T.ctx, a1.id, 'Ótimo!', { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, bia.id)), app.db);
    await expect(comentarRegistro(T.ctx, b1.id, 'Ótimo!', { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(inArray(diaryEntries.id, [a1.id, b1.id])), app.db);
    expect(linhas.map((l) => l.comentarioNutri)).toEqual([null, null]);
    const pushes = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'comentario_diario')), app.db);
    expect(pushes).toEqual([]);
  });

  it('leitura do feed auditada por paciente; o texto do diário não vai para o audit_log', async () => {
    const { T, ana } = await cenario();
    await feedDeDiarios(T.ctx, { db: app.db });
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, ana.id), eq(auditLog.entidade, 'diario'), eq(auditLog.acao, 'ler'))), app.db);
    expect(lidas.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implementação** — `src/modules/portal/diario-nutri.ts`

```ts
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { diaryEntries, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { avisarComentario } from './avisos';
import { paraRegistro, type RegistroDoDiario } from './diario';
import { COMENTARIO_MAX } from './diario-constantes';

export const MSG_COMENTARIO = {
  vazio: 'Escreva o comentário.',
  tamanho: 'Use no máximo 1000 caracteres.',
  salvo: 'Comentário salvo.',
  naoEncontrado: 'Registro não encontrado.',
  nenhum: 'Nenhum registro de diário ainda.',
} as const;

export class ComentarioError extends Error {
  override name = 'ComentarioError';
  constructor(readonly erros: { comentario: string }) {
    super(erros.comentario);
  }
}

export type ItemDoFeed = RegistroDoDiario & { patientId: string; paciente: string; visto: boolean; somenteLeitura: boolean };

const soNutri = (ctx: TenantContext) => {
  if (ctx.role !== 'nutri') throw new Error('os diários dos pacientes são lidos e comentados só na sessão da nutricionista');
};

// Bloqueado ou anonimizado: só leitura (a mesma regra de carregarPacienteParaEscrita) — a tela esconde o "Comentar"
const colunas = { e: diaryEntries, paciente: patients.nome, somenteLeitura: sql<boolean>`(${patients.status} = 'bloqueado' or ${patients.anonimizadoEm} is not null)` };
const paraItem = (r: { e: typeof diaryEntries.$inferSelect; paciente: string; somenteLeitura: boolean }): ItemDoFeed => ({
  ...paraRegistro(r.e),
  patientId: r.e.patientId,
  paciente: r.paciente,
  visto: r.e.vistoPelaNutriEm !== null,
  somenteLeitura: r.somenteLeitura,
});

/** US-043 "Feed de diários": registros recentes de todos os pacientes, não vistos primeiro. Leitura auditada por paciente. */
export async function feedDeDiarios(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<ItemDoFeed[]> {
  soNutri(ctx);
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select(colunas)
        .from(diaryEntries)
        .innerJoin(patients, eq(patients.id, diaryEntries.patientId))
        .orderBy(sql`${diaryEntries.vistoPelaNutriEm} is not null`, desc(diaryEntries.dataHora))
        .limit(o.limite ?? 50);
      const titulares = [...new Set(r.map((x) => x.e.patientId))];
      if (titulares.length) await auditRead(tx, titulares.map((patientId) => ({ entidade: 'diario', entidadeId: null, patientId })));
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map(paraItem);
}

/** US-043: abrir o registro preenche `visto_pela_nutri_em` (só na primeira vez). */
export async function abrirRegistro(ctx: TenantContext, id: string, o: { db?: Db; agora?: Date } = {}): Promise<ItemDoFeed | null> {
  soNutri(ctx);
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      await tx.update(diaryEntries).set({ vistoPelaNutriEm: o.agora ?? new Date() }).where(and(eq(diaryEntries.id, id), isNull(diaryEntries.vistoPelaNutriEm)));
      const [r] = await tx.select(colunas).from(diaryEntries).innerJoin(patients, eq(patients.id, diaryEntries.patientId)).where(eq(diaryEntries.id, id));
      if (!r) return null;
      await auditRead(tx, { entidade: 'diario', entidadeId: id, patientId: r.e.patientId });
      return paraItem(r);
    },
    o.db ?? getDb(),
  );
}

/**
 * US-043 "Comentar" / D13: um comentário por registro (corrigível); o push sai só no primeiro. Escrita no prontuário
 * como as outras da nutricionista: o paciente é travado antes (carregarPacienteParaEscrita — mesma ordem de travas:
 * paciente → registro) e bloqueado/anonimizado recusa com PacienteBloqueadoError (US-018 "só para consulta").
 */
export async function comentarRegistro(ctx: TenantContext, id: string, texto: unknown, o: { db?: Db; agora?: Date } = {}): Promise<{ primeiro: boolean }> {
  soNutri(ctx);
  const comentario = typeof texto === 'string' ? texto.normalize('NFC').trim() : '';
  if (!comentario) throw new ComentarioError({ comentario: MSG_COMENTARIO.vazio });
  if (comentario.length > COMENTARIO_MAX) throw new ComentarioError({ comentario: MSG_COMENTARIO.tamanho });
  if (!idValido(id)) throw new ComentarioError({ comentario: MSG_COMENTARIO.naoEncontrado });
  const agora = o.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [alvo] = await tx.select({ patientId: diaryEntries.patientId }).from(diaryEntries).where(eq(diaryEntries.id, id));
      if (!alvo) throw new ComentarioError({ comentario: MSG_COMENTARIO.naoEncontrado });
      await carregarPacienteParaEscrita(tx, alvo.patientId);
      const [atual] = await tx.select({ patientId: diaryEntries.patientId, comentario: diaryEntries.comentarioNutri }).from(diaryEntries).where(eq(diaryEntries.id, id)).for('update');
      if (!atual) throw new ComentarioError({ comentario: MSG_COMENTARIO.naoEncontrado });
      await tx.update(diaryEntries).set({ comentarioNutri: comentario, comentadoEm: agora, vistoPelaNutriEm: sql`coalesce(${diaryEntries.vistoPelaNutriEm}, ${agora})`, updatedAt: agora }).where(eq(diaryEntries.id, id));
      const primeiro = atual.comentario === null;
      if (primeiro) await avisarComentario(tx, { tenantId: ctx.tenantId, patientId: atual.patientId }, agora);
      return { primeiro };
    },
    o.db ?? getDb(),
  );
}
```

(`asc` sai do import se não for usado; o `orderBy` com a expressão booleana põe `false` — não vistos — primeiro.)

Run: `pnpm test src/modules/portal/diario-nutri.test.ts` → PASS.

- [ ] **Step 3: Telas do painel** — `src/app/painel/diarios/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { ComentarioError, comentarRegistro, MSG_COMENTARIO } from '@/modules/portal/diario-nutri';

export type ComentarioState = { erro?: string; ok?: string; valor?: string };

export async function comentarAction(id: string, _: ComentarioState, formData: FormData): Promise<ComentarioState> {
  const { ctx } = await requireNutri(`/painel/diarios/${id}`);
  const valor = String(formData.get('comentario') ?? '');
  try {
    await comentarRegistro(ctx, id, valor);
  } catch (e) {
    if (e instanceof ComentarioError) return { erro: e.erros.comentario, valor };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message, valor }; // corrida com o bloqueio: a página já esconde o formulário
    throw e;
  }
  revalidatePath(`/painel/diarios/${id}`);
  return { ok: MSG_COMENTARIO.salvo };
}
```

`src/app/painel/diarios/comentario-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { comentarAction, type ComentarioState } from './actions';

export function ComentarioForm({ id, atual }: { id: string; atual: string | null }) {
  const [s, enviar, enviando] = useActionState<ComentarioState, FormData>(comentarAction.bind(null, id), {});
  return (
    <form action={enviar} className="space-y-2">
      <label htmlFor="comentario" className="block font-medium">Comentar</label>
      <textarea id="comentario" name="comentario" rows={3} maxLength={1000} defaultValue={s.valor ?? atual ?? ''} aria-invalid={s.erro ? true : undefined} aria-describedby={s.erro ? 'comentario-erro' : undefined} className="w-full rounded border p-2" />
      {s.erro && <p id="comentario-erro" role="alert" className="text-sm text-red-700">{s.erro}</p>}
      {s.ok && <p role="status">{s.ok}</p>}
      <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar comentário</button>
    </form>
  );
}
```

`src/app/painel/diarios/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { feedDeDiarios, MSG_COMENTARIO } from '@/modules/portal/diario-nutri';
import { Cabecalho } from '../cabecalho';

export const dynamic = 'force-dynamic';

export default async function Diarios() {
  const { ctx, tenant } = await requireNutri('/painel/diarios');
  const feed = await feedDeDiarios(ctx);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Diários</h1>
        {feed.length === 0 ? (
          <p>{MSG_COMENTARIO.nenhum}</p>
        ) : (
          <ul className="divide-y">
            {feed.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <span className={f.visto ? 'rounded border px-2 text-sm' : 'rounded bg-amber-200 px-2 text-sm font-semibold'}>{f.visto ? 'Visto' : 'Novo'}</span>
                <Link href={`/painel/diarios/${f.id}`} className="underline">{`${f.paciente} — ${f.refeicao} · ${quandoComFuso(f.dataHora, tenant.fuso)}`}</Link>
                {f.comentario && <span className="text-sm text-gray-600">Comentado</span>}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
```

`src/app/painel/diarios/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { signFileUrl } from '@/lib/signed-url';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { MSG_DIARIO } from '@/modules/portal/diario-constantes';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { abrirRegistro } from '@/modules/portal/diario-nutri';
import { Cabecalho } from '../../cabecalho';
import { ComentarioForm } from '../comentario-form';

export const dynamic = 'force-dynamic';

export default async function RegistroDoDiarioPage({ params }: PageProps<'/painel/diarios/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/diarios/${id}`);
  const r = await abrirRegistro(ctx, id);
  if (!r) notFound();
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="max-w-2xl space-y-4 p-6">
        <p><Link href="/painel/diarios" className="underline">Diários</Link></p>
        <h1 className="text-2xl font-semibold">{`${r.paciente} — ${r.refeicao}`}</h1>
        <p>{quandoComFuso(r.dataHora, tenant.fuso)}</p>
        <p><Link href={`/painel/pacientes/${r.patientId}`} className="underline">Abrir prontuário</Link></p>
        {r.texto && <p className="whitespace-pre-line">{r.texto}</p>}
        {r.foto.estado === 'pronta' && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min
          <img src={signFileUrl(r.foto.caminho)} alt={`Foto do registro de ${r.refeicao}`} className="max-h-96 rounded" />
        )}
        {r.foto.estado === 'processando' && <p role="status">{MSG_DIARIO.processando}</p>}
        {r.foto.estado === 'falhou' && <p>{MSG_DIARIO.fotoFalhou}</p>}
        {r.somenteLeitura ? (
          <>
            {r.comentario && <p className="whitespace-pre-line">{`Comentário da nutricionista: ${r.comentario}`}</p>}
            <p role="status">{MSG_BLOQUEADO}</p>
          </>
        ) : (
          <ComentarioForm id={r.id} atual={r.comentario} />
        )}
      </main>
    </>
  );
}
```

`src/app/painel/cabecalho.tsx`: `<Link href="/painel/diarios">Diários</Link>` depois de "Agenda" (a guarda `cabecalho.test.ts` confere que as páginas novas renderizam o `Cabecalho`).

- [ ] **Step 4: O paciente vê o comentário** — `src/app/p/(portal)/diario/page.tsx`, dentro de cada `<li>`, depois da foto:

```tsx
              {r.comentario && (
                <div className="rounded bg-emerald-50 p-2">
                  <p className="text-sm font-medium">Comentário da nutricionista</p>
                  <p className="whitespace-pre-line">{r.comentario}</p>
                </div>
              )}
```

- [ ] **Step 5: E2E** — `e2e/portal.spec.ts`:

```ts
test('Diários: a nutricionista vê o registro novo, abre, comenta; o paciente vê o comentário (US-043)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.8');
  await p.page.goto('/p/diario');
  await p.page.getByLabel('Refeição').selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill(`frango grelhado ${p.nome}`);
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  await nutri.goto('/painel/diarios');
  const item = nutri.getByRole('listitem').filter({ hasText: p.nome });
  await expect(item.getByText('Novo')).toBeVisible();
  await item.getByRole('link').click();
  await nutri.getByLabel('Comentar').fill('Ótima escolha de proteína!');
  await nutri.getByRole('button', { name: 'Salvar comentário' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Comentário salvo.' })).toBeVisible();
  await nutri.goto('/painel/diarios');
  await expect(nutri.getByRole('listitem').filter({ hasText: p.nome }).getByText('Visto')).toBeVisible();
  await p.page.reload();
  await expect(p.page.getByText('Ótima escolha de proteína!')).toBeVisible();
  await p.page.context().close();
});
```

Run: `pnpm build && pnpm test src/app/painel/cabecalho.test.ts && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/portal/diario-nutri.ts src/modules/portal/diario-nutri.test.ts src/app/painel/diarios src/app/painel/cabecalho.tsx "src/app/p/(portal)/diario/page.tsx" e2e/portal.spec.ts
git commit -m "feat(diario): feed de diários da nutricionista, comentário e push ao paciente (US-043)"
```

---

### Task 9: "Minha evolução" — medidas sem exames, % de gordura só com a opção, orientações recebidas (P06-06, US-044)

**Files:**
- Create: `src/modules/portal/evolucao.ts`, `src/modules/portal/evolucao.test.ts`, `src/app/p/(portal)/evolucao/page.tsx`
- Modify: `src/modules/plataforma/marca.ts` (+ `marca.test.ts`), `src/app/painel/actions.ts`, `src/app/painel/configuracoes/perfil-form.tsx`, `src/app/p/navegacao.ts`, `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: `seriesDasAvaliacoes`, `diferencas`, `MSG_POUCOS_DADOS`, `SerieEvolucao`, `Diferenca` (`@/modules/pacientes/evolucao`); `orientacoesDoPaciente` (`@/modules/pacientes/atendimentos`); `anthropometry`; `GraficoLinha` (`@/modules/pacientes/ui/grafico-linha`); `auditRead`.
- Produces:
  - `@/modules/portal/evolucao`: `SERIES_DO_PACIENTE` (ids permitidos: `peso`, `imc`, `circ_*`, e `perc_gordura` só com a opção), `evolucaoParaPaciente(ctx: TenantContext, tenant: { mostrarPercGorduraPaciente: boolean }, db?: Db): Promise<{ avaliacoes: number; series: SerieEvolucao[]; diferencas: Diferenca[]; orientacoes: { data: string; orientacoes: string }[] }>`.
  - `perfilSchema` ganha `mostrarPercGorduraPaciente: z.boolean()`; o formulário "Perfil e marca" ganha a caixa "Mostrar % de gordura ao paciente".

- [ ] **Step 1: Testes (falham)** — `src/modules/portal/evolucao.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { evolucaoParaPaciente } from './evolucao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function comAvaliacoes() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  await withTenant(
    T.ctx,
    async (tx) => {
      await tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm, perc_gordura, dobras_mm, circunferencias) values
        (${T.tenantId}, ${p.id}, '2026-08-01', 80, 170, 30.5, '{"triceps": 20}', '{"cintura": 90}'),
        (${T.tenantId}, ${p.id}, '2026-09-01', 77, 170, 28.1, '{"triceps": 18}', '{"cintura": 86}')`);
      await tx.execute(sql`insert into exams (tenant_id, patient_id, data, titulo, valores) values (${T.tenantId}, ${p.id}, '2026-09-01', 'Glicemia', '[{"nome":"Glicose","valor":90,"unidade":"mg/dL","referencia":null}]')`);
      // A nota privada fica em consultation_notes (staff_only, US-016), não em consultations
      const [c] = (await tx.execute<{ id: string }>(sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${T.tenantId}, ${p.id}, '2026-09-01', 'Caminhar 30 min') returning id`)).rows;
      await tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${T.tenantId}, ${p.id}, ${c.id}, 'segredo da nutri')`);
    },
    app.db,
  );
  return { T, p };
}

describe('Minha evolução (US-044, D14)', () => {
  it('peso, IMC e circunferências; sem % de gordura (opção desligada), sem dobras e sem exames; orientações sem notas privadas', async () => {
    const { T, p } = await comAvaliacoes();
    const e = await evolucaoParaPaciente(ctxPaciente(T.tenantId, p.id), { mostrarPercGorduraPaciente: false }, app.db);
    expect(e.series.map((s) => s.id)).toEqual(['peso', 'imc', 'circ_cintura']);
    expect(e.diferencas.map((d) => d.rotulo)).not.toContain('% de gordura');
    expect(e.orientacoes).toEqual([{ data: '2026-09-01', orientacoes: 'Caminhar 30 min' }]);
    expect(JSON.stringify(e)).not.toMatch(/Glicose|segredo|triceps/);
  });

  it('com "Mostrar % de gordura ao paciente" ligada, a série aparece', async () => {
    const { T, p } = await comAvaliacoes();
    const e = await evolucaoParaPaciente(ctxPaciente(T.tenantId, p.id), { mostrarPercGorduraPaciente: true }, app.db);
    expect(e.series.map((s) => s.id)).toContain('perc_gordura');
  });

  it('só em sessão de paciente', async () => {
    const { T } = await comAvaliacoes();
    await expect(evolucaoParaPaciente(T.ctx, { mostrarPercGorduraPaciente: false }, app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
```

- [ ] **Step 2: Implementação** — `src/modules/portal/evolucao.ts`

```ts
import { desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { anthropometry } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { orientacoesDoPaciente } from '@/modules/pacientes/atendimentos';
import { diferencas, seriesDasAvaliacoes, type Diferenca, type SerieEvolucao } from '@/modules/pacientes/evolucao';
import { auditRead } from '@/modules/plataforma/audit';

/** D14: o que o paciente vê da antropometria. Dobras, densidade e exames nunca; % de gordura só com a opção do tenant. */
const permitida = (id: string, mostrarPercGordura: boolean) => id === 'peso' || id === 'imc' || id.startsWith('circ_') || (mostrarPercGordura && id === 'perc_gordura');

/** US-044: gráficos de peso e medidas e as orientações de cada consulta. Leituras auditadas (D22). */
export async function evolucaoParaPaciente(ctx: TenantContext, tenant: { mostrarPercGorduraPaciente: boolean }, db: Db = getDb()) {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('evolucaoParaPaciente só roda em sessão de paciente');
  const avaliacoes = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx.select().from(anthropometry).where(eq(anthropometry.patientId, ctx.patientId!)).orderBy(desc(anthropometry.data), desc(anthropometry.createdAt));
      if (r.length) await auditRead(tx, { entidade: 'antropometria', entidadeId: null, patientId: ctx.patientId! });
      return r;
    },
    db,
  );
  const series: SerieEvolucao[] = seriesDasAvaliacoes(avaliacoes).filter((s) => permitida(s.id, tenant.mostrarPercGorduraPaciente));
  const difs: Diferenca[] = diferencas(series);
  const orientacoes = await orientacoesDoPaciente(ctx, db);
  return { avaliacoes: avaliacoes.length, series, diferencas: difs, orientacoes };
}
```

Run: `pnpm test src/modules/portal/evolucao.test.ts` → PASS.

- [ ] **Step 3: Opção no "Perfil e marca"** — `src/modules/plataforma/marca.test.ts`: o objeto `valido` ganha `mostrarPercGorduraPaciente: false`; um caso novo grava `true` e lê de volta. `src/modules/plataforma/marca.ts`, em `perfilSchema`: `mostrarPercGorduraPaciente: z.boolean(),`. `src/app/painel/actions.ts`: em `valores`, `mostrarPercGorduraPaciente: formData.get('mostrarPercGorduraPaciente') === 'on' ? 'on' : '',` e, no `atualizarPerfil`, `mostrarPercGorduraPaciente: valores.mostrarPercGorduraPaciente === 'on',`. `src/app/painel/configuracoes/perfil-form.tsx`, depois da caixa da página pública:

```tsx
      <div className="flex items-center gap-2">
        <input id="mostrarPercGorduraPaciente" name="mostrarPercGorduraPaciente" type="checkbox" defaultChecked={v ? v.mostrarPercGorduraPaciente === 'on' : tenant.mostrarPercGorduraPaciente} />
        <label htmlFor="mostrarPercGorduraPaciente">Mostrar % de gordura ao paciente</label>
      </div>
```

(o tipo do estado do formulário — `valores` — ganha o campo; seguir o mesmo caminho do `agendamentoPublicoAtivo`.)

- [ ] **Step 4: Tela** — `src/app/p/(portal)/evolucao/page.tsx`:

```tsx
import { requirePaciente } from '@/lib/paciente-session';
import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '@/modules/pacientes/datas';
import { MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { evolucaoParaPaciente } from '@/modules/portal/evolucao';

export const dynamic = 'force-dynamic';

export default async function MinhaEvolucao() {
  const { ctx, tenant } = await requirePaciente('/p/evolucao');
  const e = await evolucaoParaPaciente(ctx, tenant);
  return (
    <main className="space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Minha evolução</h1>
      <section aria-labelledby="medidas" className="space-y-4">
        <h2 id="medidas" className="text-lg font-semibold">Medidas</h2>
        {e.avaliacoes < 2 ? (
          <p>{MSG_POUCOS_DADOS}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {e.diferencas.map((d) => (
                <li key={d.rotulo}>{`${d.rotulo}: ${formatarDecimal(d.primeiro.valor, d.casas)} (${formatarData(d.primeiro.data)}) → ${formatarDecimal(d.ultimo.valor, d.casas)} (${formatarData(d.ultimo.data)}) · ${d.texto}`}</li>
              ))}
            </ul>
            {e.series.filter((s) => s.pontos.length >= 2).map((s) => (
              <GraficoLinha key={s.id} id={`serie-${s.id}`} titulo={s.rotulo} unidade={s.unidade} casas={s.casas} pontos={s.pontos} />
            ))}
          </>
        )}
      </section>
      <section aria-labelledby="orientacoes" className="space-y-2">
        <h2 id="orientacoes" className="text-lg font-semibold">Orientações recebidas</h2>
        {e.orientacoes.length === 0 ? (
          <p>Nenhuma orientação registrada ainda.</p>
        ) : (
          <ol className="space-y-3">
            {e.orientacoes.map((o) => (
              <li key={`${o.data}-${o.orientacoes.slice(0, 20)}`}>
                <p className="font-medium">{formatarData(o.data)}</p>
                <p className="whitespace-pre-line">{o.orientacoes}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
```

`src/app/p/navegacao.ts`: `{ href: '/p/evolucao', rotulo: 'Evolução' }` depois de "Diário".

- [ ] **Step 5: E2E** — `e2e/portal.ts`, acrescentar:

```ts
/** Avaliação pela aba Antropometria (mesmos passos de e2e/pacientes.spec.ts), com JP3 para gerar o % de gordura. */
export async function avaliar(nutri: Page, prontuario: string, data: string, peso: string) {
  await nutri.goto(`${prontuario}/antropometria`);
  await nutri.getByLabel('Data da avaliação').fill(data);
  await nutri.getByLabel('Peso (kg)').fill(peso);
  await nutri.getByLabel('Altura (cm)').fill('170');
  await nutri.getByLabel('Protocolo de dobras').selectOption('jp3');
  await nutri.getByLabel('Tríceps').fill('20');
  await nutri.getByLabel('Supra-ilíaca').fill('20');
  await nutri.getByLabel('Coxa', { exact: true }).last().fill('20');
  await nutri.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Avaliação salva.');
}

/** Liga ou desliga "Mostrar % de gordura ao paciente" em Perfil e marca (o tenant do E2E é compartilhado: sempre voltar a desligar). */
export async function mostrarPercGordura(nutri: Page, ligar: boolean) {
  await nutri.goto('/painel/configuracoes');
  await nutri.getByLabel('Mostrar % de gordura ao paciente').setChecked(ligar);
  await nutri.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Perfil salvo.' })).toBeVisible();
}
```

`e2e/portal.spec.ts`:

```ts
test('Minha evolução: peso sem % de gordura; com a opção ligada, o % aparece; orientações sem exames (US-044)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.9');
  await avaliar(nutri, p.prontuario, '2026-08-01', '80');
  await avaliar(nutri, p.prontuario, '2026-09-01', '77');
  await p.page.goto('/p/evolucao');
  await expect(p.page.getByRole('heading', { name: 'Minha evolução' })).toBeVisible();
  await expect(p.page.getByText(/^Peso: 80,0/)).toBeVisible();
  await expect(p.page.getByText('% de gordura')).toHaveCount(0);
  try {
    await mostrarPercGordura(nutri, true);
    await p.page.reload();
    await expect(p.page.getByText(/^% de gordura:/)).toBeVisible();
  } finally {
    await mostrarPercGordura(nutri, false);
  }
  await expect(p.page.getByText('Nenhuma orientação registrada ainda.')).toBeVisible();
  await p.page.context().close();
});
```

Run: `pnpm build && pnpm test src/modules/plataforma && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/portal/evolucao.ts src/modules/portal/evolucao.test.ts "src/app/p/(portal)/evolucao" src/app/p/navegacao.ts src/modules/plataforma/marca.ts src/modules/plataforma/marca.test.ts src/app/painel/actions.ts src/app/painel/configuracoes/perfil-form.tsx e2e/portal.ts e2e/portal.spec.ts
git commit -m "feat(portal): Minha evolução sem exames, % de gordura só com a opção da nutricionista (US-044)"
```

---
### Task 10: Lista de compras do plano publicado (P06-07, US-045, RN-13)

**Files:**
- Create: `src/modules/portal/lista-compras.ts`, `src/modules/portal/lista-compras.test.ts`, `src/modules/portal/lista-compras-banco.test.ts`, `src/app/p/(portal)/compras/page.tsx`, `src/app/p/(portal)/compras/lista-compras.tsx`
- Modify: `src/app/p/navegacao.ts`, `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: `mealPlans`, `mealItems`, `foods` (Plano 04; `meal_items.nutrientes.nome` é o nome congelado na publicação); `GRUPOS_TACO` (`@/modules/alimentos/grupos`); `formatarDecimal`, `casasDecimais`; `auditRead`.
- Produces:
  - `@/modules/portal/lista-compras`: `DIAS_PADRAO = 7`, `lerDias(v: unknown): number | null` (inteiro 1–14; vazio → 7), `type ItemCompra = { nome: string; gramas: number; texto: string }`, `type GrupoCompra = { grupo: string; itens: ItemCompra[] }`, `quantidadeTexto(gramas: number): string`, `listaDeCompras(itens: { nome: string; grupo: string; quantidadeG: number }[], dias: number): GrupoCompra[]`, `listaDoPlano(ctx: TenantContext, dias: number, db?: Db): Promise<{ planoId: string; grupos: GrupoCompra[] } | null>`, `MSG_COMPRAS = { dias: 'Escolha de 1 a 14 dias.', semPlano: 'Sem plano publicado, não há lista de compras.' }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/portal/lista-compras.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { lerDias, listaDeCompras, quantidadeTexto } from './lista-compras';

describe('lista de compras (RN-13)', () => {
  it('"Arroz, tipo 1, cozido" 100 g no almoço e no jantar × 7 dias = 1,4 kg em "Cereais e derivados"', () => {
    const l = listaDeCompras(
      [
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100 },
        { nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 100 },
        { nome: 'Chuchu, cozido', grupo: 'Verduras, hortaliças e derivados', quantidadeG: 80 },
      ],
      7,
    );
    expect(l).toEqual([
      { grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 1400, texto: '1,4 kg' }] },
      { grupo: 'Verduras, hortaliças e derivados', itens: [{ nome: 'Chuchu, cozido', gramas: 560, texto: '560 g' }] },
    ]);
  });
  it('g abaixo de 1000, kg com 1 casa a partir de 1000; grupos na ordem da TACO, itens em ordem alfabética', () => {
    expect([quantidadeTexto(999), quantidadeTexto(1000), quantidadeTexto(12.5), quantidadeTexto(1060)]).toEqual(['999 g', '1,0 kg', '12,5 g', '1,1 kg']);
    const l = listaDeCompras([{ nome: 'Ovo', grupo: 'Ovos e derivados', quantidadeG: 50 }, { nome: 'Banana', grupo: 'Frutas e derivados', quantidadeG: 50 }, { nome: 'Abacate', grupo: 'Frutas e derivados', quantidadeG: 50 }], 1);
    expect(l.map((g) => g.grupo)).toEqual(['Frutas e derivados', 'Ovos e derivados']);
    expect(l[0].itens.map((i) => i.nome)).toEqual(['Abacate', 'Banana']);
  });
  it('dias: 1 a 14, inteiro; vazio = 7', () => {
    expect([lerDias(''), lerDias(undefined), lerDias('1'), lerDias('14'), lerDias('0'), lerDias('15'), lerDias('2.5'), lerDias('abc')]).toEqual([7, 7, 1, 14, null, null, null, null]);
  });
});
```

E, em `src/modules/portal/lista-compras-banco.test.ts`, o caso com banco:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { listaDoPlano } from './lista-compras';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('lista do plano (US-045)', () => {
  it('só o plano publicado e só os itens principais: a substituição não entra; rascunho → null', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { id } = await criarRascunho(T.ctx, p.id, { db: app.db });
    expect(await listaDoPlano(ctx, 7, app.db)).toBeNull();
    const [r] = await withTenant(T.ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, id)), app.db);
    const [almoco, arroz, sub] = [randomUUID(), randomUUID(), randomUUID()];
    await salvarRascunho(T.ctx, id, {
      revisao: r.revisao, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '',
      refeicoes: [{ id: almoco, nome: 'Almoço', horario: '12:00', observacao: '', itens: [
        { id: arroz, foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null },
        { id: sub, foodId: idTaco(112), quantidadeG: '150', medida: null, substituiItemId: arroz },
      ] }],
    }, { db: app.db });
    await publicarPlano(T.ctx, p.id, id, { db: app.db });
    const lista = await listaDoPlano(ctx, 7, app.db);
    expect(lista!.grupos).toEqual([{ grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 700, texto: '700 g' }] }]);
  });
});
```

(`idTaco(112)` é o "Chuchu, cozido" do seed; ele é a substituição e não pode aparecer.)

- [ ] **Step 2: Implementação** — `src/modules/portal/lista-compras.ts`

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods, mealItems, mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import { auditRead } from '@/modules/plataforma/audit';

export const DIAS_PADRAO = 7;
export const MSG_COMPRAS = { dias: 'Escolha de 1 a 14 dias.', semPlano: 'Sem plano publicado, não há lista de compras.' } as const;

export type ItemCompra = { nome: string; gramas: number; texto: string };
export type GrupoCompra = { grupo: string; itens: ItemCompra[] };

export function lerDias(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return DIAS_PADRAO;
  if (typeof v !== 'string' || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 14 ? n : null;
}

/** RN-13: g abaixo de 1 kg; a partir de 1000 g, kg com 1 casa. */
export function quantidadeTexto(gramas: number): string {
  if (gramas >= 1000) return `${formatarDecimal(gramas / 1000, 1)} kg`;
  return `${formatarDecimal(gramas, Math.min(1, casasDecimais(gramas)))} g`;
}

const ordemDoGrupo = (g: string) => {
  const i = (GRUPOS_TACO as readonly string[]).indexOf(g);
  return i === -1 ? GRUPOS_TACO.length : i;
};

/** RN-13: soma dos itens principais × dias, agrupada pelo grupo do alimento. */
export function listaDeCompras(itens: { nome: string; grupo: string; quantidadeG: number }[], dias: number): GrupoCompra[] {
  const porGrupo = new Map<string, Map<string, number>>();
  for (const i of itens) {
    const g = porGrupo.get(i.grupo) ?? new Map<string, number>();
    g.set(i.nome, (g.get(i.nome) ?? 0) + i.quantidadeG * dias);
    porGrupo.set(i.grupo, g);
  }
  return [...porGrupo.entries()]
    .sort(([a], [b]) => ordemDoGrupo(a) - ordemDoGrupo(b) || a.localeCompare(b, 'pt-BR'))
    .map(([grupo, m]) => ({
      grupo,
      itens: [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([nome, gramas]) => ({ nome, gramas, texto: quantidadeTexto(gramas) })),
    }));
}

/** US-045: a lista do plano publicado do paciente da sessão (nunca do rascunho — RLS). Leitura auditada (D22). */
export async function listaDoPlano(ctx: TenantContext, dias: number, db: Db = getDb()): Promise<{ planoId: string; grupos: GrupoCompra[] } | null> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('listaDoPlano só roda em sessão de paciente');
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, ctx.patientId!), eq(mealPlans.status, 'publicado')));
      if (!p) return null;
      const linhas = await tx
        .select({ nomeCongelado: mealItems.nutrientes, nomeAtual: foods.nome, grupo: foods.grupo, quantidadeG: mealItems.quantidadeG })
        .from(mealItems)
        .innerJoin(foods, eq(foods.id, mealItems.foodId))
        .where(and(eq(mealItems.planId, p.id), isNull(mealItems.substituiItemId)));
      await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: ctx.patientId! });
      const itens = linhas.map((l) => ({ nome: l.nomeCongelado?.nome ?? l.nomeAtual, grupo: l.grupo, quantidadeG: Number(l.quantidadeG) }));
      return { planoId: p.id, grupos: listaDeCompras(itens, dias) };
    },
    db,
  );
}
```

Run: `pnpm test src/modules/portal/lista-compras.test.ts src/modules/portal/lista-compras-banco.test.ts` → PASS.

- [ ] **Step 3: Tela** — `src/app/p/(portal)/compras/lista-compras.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { GrupoCompra } from '@/modules/portal/lista-compras';

/** RN-13 / D15: "comprado" fica no aparelho (localStorage), por plano: plano novo, lista nova. */
export function ListaCompras({ planoId, grupos }: { planoId: string; grupos: GrupoCompra[] }) {
  const chave = `nd-compras:${planoId}`;
  const [comprados, setComprados] = useState<string[]>([]);
  useEffect(() => {
    try {
      setComprados(JSON.parse(localStorage.getItem(chave) ?? '[]'));
    } catch {
      setComprados([]);
    }
  }, [chave]);
  const alternar = (nome: string) => {
    const novos = comprados.includes(nome) ? comprados.filter((n) => n !== nome) : [...comprados, nome];
    setComprados(novos);
    try {
      localStorage.setItem(chave, JSON.stringify(novos));
    } catch {
      // modo privado sem armazenamento: a marcação vale só enquanto a tela estiver aberta
    }
  };
  return (
    <div className="space-y-4">
      {grupos.map((g, gi) => (
        <fieldset key={g.grupo} className="space-y-1">
          <legend className="font-semibold">{g.grupo}</legend>
          {g.itens.map((i, ii) => {
            const id = `item-${gi}-${ii}`;
            const marcado = comprados.includes(i.nome);
            return (
              <div key={i.nome} className="flex min-h-11 items-center gap-2">
                <input id={id} type="checkbox" checked={marcado} onChange={() => alternar(i.nome)} className="size-5" />
                <label htmlFor={id} className={marcado ? 'line-through' : undefined}>{`${i.nome} — ${i.texto}`}</label>
              </div>
            );
          })}
        </fieldset>
      ))}
      <p className="text-sm text-gray-700">Marque o que já comprou: a marcação fica neste aparelho.</p>
    </div>
  );
}
```

`src/app/p/(portal)/compras/page.tsx`:

```tsx
import { requirePaciente } from '@/lib/paciente-session';
import { DIAS_PADRAO, lerDias, listaDoPlano, MSG_COMPRAS } from '@/modules/portal/lista-compras';
import { ListaCompras } from './lista-compras';

export const dynamic = 'force-dynamic';

export default async function Compras({ searchParams }: PageProps<'/p/compras'>) {
  const { ctx } = await requirePaciente('/p/compras');
  const pedido = (await searchParams).dias;
  const dias = lerDias(typeof pedido === 'string' ? pedido : undefined);
  const lista = dias ? await listaDoPlano(ctx, dias) : null;
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Lista de compras</h1>
      <form method="get" className="flex items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="dias" className="block font-medium">Para quantos dias?</label>
          <input id="dias" name="dias" type="number" min={1} max={14} inputMode="numeric" defaultValue={dias ?? DIAS_PADRAO} aria-invalid={dias === null ? true : undefined} aria-describedby={dias === null ? 'dias-erro' : undefined} className="min-h-11 w-24 rounded border p-2" />
        </div>
        <button className="min-h-11 rounded border px-4">Gerar lista</button>
      </form>
      {dias === null && <p id="dias-erro" role="alert" className="text-red-700">{MSG_COMPRAS.dias}</p>}
      {dias !== null && !lista && <p role="status">{MSG_COMPRAS.semPlano}</p>}
      {lista && <ListaCompras planoId={lista.planoId} grupos={lista.grupos} />}
    </main>
  );
}
```

`src/app/p/navegacao.ts`: `{ href: '/p/compras', rotulo: 'Compras' }` depois de "Evolução".

- [ ] **Step 4: E2E** — `e2e/portal.spec.ts`:

```ts
test('lista de compras: 7 dias do chuchu de 100 g = 700 g em "Verduras…"; "comprado" continua marcado ao reabrir (US-045)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.10');
  await p.page.goto('/p/compras');
  await expect(p.page.getByRole('status')).toHaveText('Sem plano publicado, não há lista de compras.');
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/compras?dias=7');
  const grupo = p.page.getByRole('group', { name: 'Verduras, hortaliças e derivados' });
  const item = grupo.getByLabel('Chuchu, cozido — 700 g');
  await item.check();
  await p.page.reload();
  await expect(p.page.getByRole('group', { name: 'Verduras, hortaliças e derivados' }).getByLabel('Chuchu, cozido — 700 g')).toBeChecked();
  await p.page.goto('/p/compras?dias=15');
  await expect(p.page.getByRole('alert')).toHaveText('Escolha de 1 a 14 dias.');
  await p.page.context().close();
});
```

Run: `pnpm build && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/portal/lista-compras.ts src/modules/portal/lista-compras.test.ts src/modules/portal/lista-compras-banco.test.ts "src/app/p/(portal)/compras" src/app/p/navegacao.ts e2e/portal.spec.ts
git commit -m "feat(portal): lista de compras do plano publicado, com marcação no aparelho (US-045, RN-13)"
```

---
### Task 11: "Perfil" e direitos do titular — baixar meus dados, pedir exclusão, WhatsApp, fotos do diário e conta na LGPD (P06-08, US-046, US-011 "Revogar", US-018)

**Files:**
- Create: `drizzle/0078_pedido_aberto_unico.sql` (gerada), `drizzle/0079_paciente_titular.sql` (custom), `src/modules/portal/meus-dados.ts`, `src/modules/portal/meus-dados.test.ts`, `src/modules/portal/perfil.ts`, `src/modules/portal/perfil.test.ts`, `src/modules/pacientes/conta-titular.ts`, `src/modules/pacientes/conta-titular.test.ts`, `src/app/p/(portal)/perfil/page.tsx`, `src/app/p/(portal)/perfil/actions.ts`, `src/app/p/(portal)/perfil/privacidade.tsx`, `src/app/p/(portal)/perfil/whatsapp-form.tsx`, `src/app/p/(portal)/meus-dados/exportacoes/[id]/page.tsx`
- Modify: `src/db/schema/pacientes.ts` (índice), `src/db/rls-guard.ts`, `src/modules/pacientes/exportacao.ts`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/lgpd.test.ts`, `src/modules/pacientes/convite-paciente.ts` (exportar `escolhaWhatsapp`), `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/app/painel/page.tsx`, `src/app/p/navegacao.ts`, `e2e/portal.spec.ts`, `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `solicitarExportacao`, `EXPORTACAO_VALIDADE_MS`, `EstadoExportacao` (Plano 03); `montarDados(…, escopo)` (Tarefa 2); `PRAZO_RESPOSTA_DIAS`, `atenderPedidoExclusao`, `anexosDoPaciente`, `anonimizarVencidos` (`lgpd.ts`); `vinculosDaConta(userId, { todos: true })` (Tarefa 3); `diaryEntries` (Tarefa 7); `AtivarNotificacoes` (Tarefa 6); `enqueueEmail`; `hojeNoFuso`, `somarDias`, `formatarData` (`@/modules/pacientes/datas`).
- Produces:
  - `privacy_requests_aberto_unique` (`tenant_id`, `patient_id`, `tipo`) WHERE `status = 'aberto'`; `PACIENTE_ESCREVE` ganha `privacy_requests` (`insert`) e `data_exports` (`insert`, `update`).
  - `@/modules/pacientes/exportacao`: `solicitarExportacao(ctx, patientId, deps & { escopo?: EscopoExportacao })`; `linkDaExportacao(appUrl, patientId, exportId, escopo: EscopoExportacao = 'equipe')` (titular → `/p/meus-dados/exportacoes/<id>`).
  - `DadosExportacao` ganha `diario: { dataHora: string; refeicao: string; texto: string | null; foto: string | null; comentarioNutri: string | null }[]`; as fotos entram no ZIP em `diario/` no mesmo teto de 100 MB dos laudos (`laudosForaDoZip` passa a valer para os dois).
  - `@/modules/portal/meus-dados`: `MSG_MEUS_DADOS`, `pedirMeusDados(ctx: TenantContext, deps?: { db?: Db; agora?: Date; boss?: PgBoss }): Promise<'pedido' | 'ja_pedido'>`, `estadoDosMeusDados(ctx: TenantContext, exportId: string, o?: { db?: Db; agora?: Date }): Promise<EstadoExportacao>`, `pedirExclusao(ctx: TenantContext, tenant: { fuso: string; nomeExibicao: string }, deps?: { db?: Db; agora?: Date }): Promise<{ registrado: true } | { jaPedidoEm: string }>`.
  - `@/modules/portal/perfil`: `MSG_PERFIL`, `situacaoDoWhatsapp(ctx): Promise<{ ativo: boolean; temTelefone: boolean }>`, `preferenciaWhatsapp(ctx: TenantContext, quer: boolean, o?: { db?: Db; agora?: Date }): Promise<void>`.
  - `@/modules/pacientes/lgpd`: `pedidosDoTitularAbertos(ctx: TenantContext, db?: Db): Promise<{ patientId: string; nome: string; tipo: 'exclusao' | 'exportacao'; prazo: string }[]>`, `apagarFotosDoDiario(ctx: TenantContext, patientId: string, deps?: { db?: Db; dataDir?: string }): Promise<number>`; `anexosDoPaciente` inclui as fotos (e originais) do diário.
  - `@/modules/pacientes/conta-titular`: `anonimizarContaSemVinculo(tx: Tx, userId: string, now: Date): Promise<void>`.
  - E-mails: `{ tipo: 'pedido_exclusao_registrado'; para: string; nutri: string; prazo: string }`; `exportacao_pronta` ganha `titular?: boolean`.

- [ ] **Step 1: Índice e permissões** — `src/db/schema/pacientes.ts`, em `privacyRequests`:

```ts
    // US-046 / D17: um pedido aberto por paciente e tipo (pedir de novo mostra a data do que já está aberto)
    uniqueIndex('privacy_requests_aberto_unique').on(t.tenantId, t.patientId, t.tipo).where(sql`${t.status} = 'aberto'`),
```

Run: `pnpm db:generate --name pedido_aberto_unico` e `pnpm drizzle-kit generate --custom --name paciente_titular`; `drizzle/0079_paciente_titular.sql`:

```sql
-- US-046: o titular pede a exclusão (privacy_requests) e os próprios dados (data_exports; o pedido pendente
-- esquecido vira "falhou" — solicitarExportacao)
SELECT app_allow_paciente_escrita('privacy_requests', 'insert');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('data_exports', 'insert', 'update');
```

`src/db/rls-guard.ts`, `PACIENTE_ESCREVE`: `privacy_requests: { comandos: ['insert'], motivo: 'US-046: o titular pede a exclusão' }`, `data_exports: { comandos: ['insert', 'update'], motivo: 'US-046: o titular pede os próprios dados (solicitarExportacao marca o pendente esquecido como falhou)' }`.

Run: `pnpm db:migrate && pnpm test src/db` → PASS.

- [ ] **Step 2: Exportação pelo titular (falha → passa)** — `src/modules/pacientes/exportacao.test.ts`, acrescentar:

```ts
it('US-046: pedida pelo titular, o e-mail vai para a conta dele com o link do portal; diário (texto e foto) no ZIP', async () => {
  const T = await novoTenant(app.db);
  const { paciente: p, email, userId } = await pacienteComConta(app.db, T);
  await withTenant(T.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', texto: 'arroz', comentarioNutri: 'Ótimo!' }), app.db);
  const id = await solicitarExportacao({ ...ctxPaciente(T.tenantId, p.id), actorUserId: userId }, p.id, { db: app.db, escopo: 'titular' });
  await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { db: app.db, dataDir, appUrl: 'http://localhost:3000', ultimaTentativa: false });
  const [msg] = await emailsNaFila('exportacao_pronta', email);
  expect(msg).toMatchObject({ link: `http://localhost:3000/p/meus-dados/exportacoes/${id}`, titular: true });
  const dados = await dadosDoZip(T, id); // helper deste arquivo: abre o ZIP e devolve o dados.json
  expect(dados.diario).toEqual([expect.objectContaining({ refeicao: 'Almoço', texto: 'arroz', comentarioNutri: 'Ótimo!', foto: null })]);
});
```

(`pacienteComConta` de `../../../test/portal`; se o arquivo não tiver um `dadosDoZip`, extrair do teste "Exportar" existente a leitura do ZIP com `unzipSync` para uma função.)

`src/modules/pacientes/exportacao.ts`:

```ts
import type { EscopoExportacao } from './exportacao-job';

export function linkDaExportacao(appUrl: string, patientId: string, exportId: string, escopo: EscopoExportacao = 'equipe'): string {
  // US-046: o titular abre pelo portal (pede login de paciente); a equipe, pelo prontuário
  return urlDoApp(appUrl, escopo === 'titular' ? `/p/meus-dados/exportacoes/${exportId}` : `/painel/pacientes/${patientId}/exportacoes/${exportId}`);
}
```

(`import type` não puxa o arquivo do worker para o grafo do Next — a guarda de `exportacao.test.ts` continua verde; se ela reclamar, mover `EscopoExportacao` para `exportacao.ts` e importar de lá no job.) Em `solicitarExportacao`, `deps` ganha `escopo?: EscopoExportacao`, e o escopo vale em **toda** a lógica do pedido, não só no `insert` — senão os pedidos do titular e da equipe se misturam: o pendente de um seria devolvido ao outro (o e-mail vai para `solicitadoPor`, então o paciente não recebe nada e a nutricionista recebe o ZIP do titular), ou marcado "falhou" pelo pedido do outro. Com `const escopo = deps.escopo ?? 'equipe';` no começo:

```ts
      // O pendente reaproveitado (ou dado como perdido) é só o do MESMO escopo: o da equipe e o do titular
      // têm destinatário (solicitadoPor), link e conteúdo diferentes (D16)
      const [pendente] = await tx
        .select({ id: dataExports.id, createdAt: dataExports.createdAt })
        .from(dataExports)
        .where(and(eq(dataExports.patientId, p.id), eq(dataExports.escopo, escopo), eq(dataExports.status, 'pendente')));
```

(o `update(…).set({ status: 'falhou' })` continua pelo `id` desse pendente) e o `insert(dataExports).values({ … })` ganha `escopo,`. Atualizar o comentário de `solicitarExportacao`: "Um pedido do mesmo escopo ainda sendo gerado é reaproveitado…".

Em `exportacao-job.ts`, `expirarAnteriores` passa a receber o escopo do pedido e só apaga os ZIPs prontos **do mesmo escopo** (o ZIP do titular pronto não pode apagar o que a nutricionista acabou de pedir, nem o contrário): assinatura `expirarAnteriores(ctx, patientId, atual, escopo: EscopoExportacao, deps)`, o `where` ganha `eq(dataExports.escopo, escopo)`, a chamada em `gerarExportacao` vira `expirarAnteriores(ctx, pedido.patientId, pedido.id, pedido.escopo as EscopoExportacao, { db, dataDir: deps.dataDir })` e o comentário vira "Um ZIP válido por paciente **e escopo**". A varredura diária (`expirarExportacoesVencidas`) não muda: vencido é vencido em qualquer escopo.

Testes em `exportacao.test.ts` (no `describe` existente):

```ts
it('D16: pedidos do titular e da equipe não se misturam — o pendente de um não é reaproveitado nem marcado "falhou" pelo outro', async () => {
  const T = await novoTenant(app.db);
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  const ctxTitular = ctxPaciente(T.tenantId, p.id, userId);
  const daEquipe = await solicitarExportacao(T.ctx, p.id, deps);
  const doTitular = await solicitarExportacao(ctxTitular, p.id, { ...deps, escopo: 'titular' });
  expect(doTitular).not.toBe(daEquipe);
  expect(await solicitarExportacao(T.ctx, p.id, deps)).toBe(daEquipe); // duplo clique da equipe: o mesmo
  expect(await solicitarExportacao(ctxTitular, p.id, { ...deps, escopo: 'titular' })).toBe(doTitular);
  // 31 min depois a equipe pede de novo: só o pendente DELA vira "falhou"; o do titular segue pendente
  const depois = { ...deps, now: new Date(now.getTime() + 31 * 60_000) };
  expect(await solicitarExportacao(T.ctx, p.id, depois)).not.toBe(daEquipe);
  expect(await estadoDaExportacao(T.ctx, p.id, daEquipe, app.db, depois.now)).toEqual({ estado: 'falhou' });
  expect(await estadoDaExportacao(T.ctx, p.id, doTitular, app.db, depois.now)).toEqual({ estado: 'pendente' });
  const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, doTitular)), app.db);
  expect(linha).toMatchObject({ escopo: 'titular', solicitadoPor: userId });
});

it('D16: o ZIP do titular pronto não apaga o da equipe (um ZIP válido por paciente e escopo); cada e-mail vai para quem pediu', async () => {
  const T = await novoTenant(app.db);
  const { paciente: p, userId, email } = await pacienteComConta(app.db, T);
  const daEquipe = await solicitarExportacao(T.ctx, p.id, deps);
  await gerarExportacao({ tenantId: T.tenantId, exportId: daEquipe }, { ...deps, ultimaTentativa: false });
  const doTitular = await solicitarExportacao(ctxPaciente(T.tenantId, p.id, userId), p.id, { ...deps, escopo: 'titular' });
  expect(await gerarExportacao({ tenantId: T.tenantId, exportId: doTitular }, { ...deps, ultimaTentativa: false })).toBe('pronta');
  expect((await estadoDaExportacao(T.ctx, p.id, daEquipe, app.db, now)).estado).toBe('pronta');
  const [daNutri] = await emailsNaFila('exportacao_pronta', `nutri-${T.nutriId.slice(0, 8)}@teste.dev`);
  expect(daNutri.link).toBe(`http://localhost:3000/painel/pacientes/${p.id}/exportacoes/${daEquipe}`);
  const [doPaciente] = await emailsNaFila('exportacao_pronta', email);
  expect(doPaciente).toMatchObject({ link: `http://localhost:3000/p/meus-dados/exportacoes/${doTitular}`, titular: true });
});
```

(`ctxPaciente` de `../../../test/pacientes` e `pacienteComConta` de `../../../test/portal`, os mesmos do primeiro teste deste passo; o e-mail da nutricionista é o que `novoTenant` grava.)

`src/modules/pacientes/exportacao-job.ts`:
- em `DadosExportacao`, depois de `dispositivosPush`:

```ts
  /** Plano 06: diário alimentar (US-042/043) — texto, refeição, comentário da nutricionista e a foto (em `diario/`). */
  diario: { dataHora: string; refeicao: string; texto: string | null; foto: string | null; comentarioNutri: string | null }[];
```

- em `montarDados`, depois da leitura de `pushSubscriptions`:

```ts
  const di = await tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, patientId)).orderBy(asc(diaryEntries.dataHora));
```

  e, no objeto devolvido, `diario: di.map((e) => ({ dataHora: e.dataHora.toISOString(), refeicao: e.refeicao, texto: e.texto, foto: null, comentarioNutri: e.comentarioNutri }))`; a lista de anexos para o ZIP ganha as fotos prontas:

```ts
  // Fotos do diário (JPEG convertido): no ZIP, no mesmo teto dos laudos; o original nunca vai
  const fotos: AnexoParaZip[] = di.flatMap((e, i) => (e.fotoStatus === 'pronta' && e.fotoPath ? [{ tipo: 'foto' as const, indice: i, caminho: e.fotoPath, nome: `diario/${e.dataHora.toISOString().slice(0, 10)}-${i + 1}.jpg` }] : []));
```

- o tipo `LaudoParaZip` vira `type AnexoParaZip = { tipo: 'laudo' | 'foto'; indice: number; caminho: string; nome: string }` (os laudos com `tipo: 'laudo'`), `montarDados` devolve `{ dados, laudos: [...laudos, ...fotos] }`, e em `lerLaudos` a marcação passa a ser:

```ts
    if (l.tipo === 'laudo') dados.exames[l.indice].laudo = l.nome;
    else dados.diario[l.indice].foto = l.nome;
```

  (o comentário de `laudosForaDoZip` passa a dizer "laudos ou fotos do diário").
- no `registrar` de `gerarExportacao`, o e-mail:

```ts
            await enqueueEmail(
              { tipo: 'exportacao_pronta', para: quem.email, link: linkDaExportacao(deps.appUrl, pedido.patientId, pedido.id, pedido.escopo as EscopoExportacao), titular: pedido.escopo === 'titular' },
              { tenantId: data.tenantId, tx, boss },
            );
```

`src/email/types.ts`: `| { tipo: 'exportacao_pronta'; para: string; link: string; titular?: boolean }` e `| { tipo: 'pedido_exclusao_registrado'; para: string; nutri: string; prazo: string }`. `src/email/templates.tsx`: no `case 'exportacao_pronta'`, a segunda linha vira `msg.titular ? 'O link vale por 24 horas e pede que você entre no portal.' : 'O link vale por 24 horas e pede que você entre no painel.'`; e o `case` novo:

```tsx
    case 'pedido_exclusao_registrado': {
      const subject = 'Seu pedido foi registrado';
      const linhas = [
        `Recebemos seu pedido de exclusão de dados. ${msg.nutri} tem até ${msg.prazo} para responder.`,
        'Por obrigação legal, o prontuário clínico é guardado de forma bloqueada pelo prazo exigido; o resto é apagado quando o pedido for atendido. Você recebe outro e-mail nesse momento.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => <P key={l}>{l}</P>)}
          </Layout>,
        ),
        text: linhas.join('\n\n'),
      };
    }
```

`src/email/render.test.ts`: renderizar os dois e conferir assunto e as frases.

Run: `pnpm test src/modules/pacientes/exportacao.test.ts src/email` → PASS.

- [ ] **Step 3: Meus dados e pedido de exclusão (falham → passam)** — `src/modules/portal/meus-dados.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { dataExports, privacyRequests } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { estadoDosMeusDados, pedirExclusao, pedirMeusDados } from './meus-dados';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

async function titular() {
  const T = await novoTenant(app.db, 'Debby Silva');
  const { paciente, userId, email } = await pacienteComConta(app.db, T);
  return { T, paciente, email, ctx: { ...ctxPaciente(T.tenantId, paciente.id), actorUserId: userId } };
}

describe('Meus dados (US-046, D16, D17)', () => {
  it('"Baixar meus dados": pedido do titular; de novo em menos de 24 h → já pedido; depois de 24 h, outro', async () => {
    const { T, paciente, ctx } = await titular();
    const agora = new Date('2026-10-05T15:00:00Z');
    expect(await pedirMeusDados(ctx, { db: app.db, agora })).toBe('pedido');
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.patientId, paciente.id)), app.db);
    expect(e).toMatchObject({ escopo: 'titular', status: 'pendente', solicitadoPor: ctx.actorUserId });
    await withTenant(T.ctx, (tx) => tx.update(dataExports).set({ status: 'pronta' }).where(eq(dataExports.id, e.id)), app.db);
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-06T14:00:00Z') })).toBe('ja_pedido');
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-06T15:01:00Z') })).toBe('pedido');
  });

  it('pendente do titular há mais de 30 min (job perdido) não prende por 24 h; o pendente da equipe não conta para o titular', async () => {
    const { T, paciente, ctx } = await titular();
    const agora = new Date('2026-10-05T15:00:00Z');
    await withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'equipe', createdAt: agora, updatedAt: agora }), app.db);
    expect(await pedirMeusDados(ctx, { db: app.db, agora })).toBe('pedido'); // o da equipe, pendente, não é "já pedido"
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-05T15:20:00Z') })).toBe('ja_pedido');
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-05T15:31:00Z') })).toBe('pedido');
    const pedidos = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.patientId, paciente.id)), app.db);
    expect(pedidos.map((e) => `${e.escopo}:${e.status}`).sort()).toEqual(['equipe:pendente', 'titular:falhou', 'titular:pendente']);
  });

  it('o titular vê só os próprios pedidos do escopo titular (o da equipe, com rascunho, não abre pelo portal)', async () => {
    const { T, paciente, ctx } = await titular();
    const [daEquipe] = await withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'equipe' }).returning(), app.db);
    expect(await estadoDosMeusDados(ctx, daEquipe.id, { db: app.db })).toEqual({ estado: 'inexistente' });
  });

  it('"Pedir exclusão": privacy_requests aberto com prazo de 15 dias no fuso; e-mail "Seu pedido foi registrado"; de novo → a data do primeiro', async () => {
    const { T, paciente, email, ctx } = await titular();
    const r = await pedirExclusao(ctx, { fuso: 'America/Sao_Paulo', nomeExibicao: 'Debby Silva' }, { db: app.db, agora: new Date('2026-10-06T02:00:00Z') }); // 05/10 23:00 em SP
    expect(r).toEqual({ registrado: true });
    const [pr] = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(and(eq(privacyRequests.patientId, paciente.id), eq(privacyRequests.status, 'aberto'))), app.db);
    expect(pr).toMatchObject({ tipo: 'exclusao', prazo: '2026-10-20' });
    const [msg] = await emailsNaFila('pedido_exclusao_registrado', email);
    expect(msg).toMatchObject({ nutri: 'Debby Silva', prazo: '20/10/2026' });
    expect(await pedirExclusao(ctx, { fuso: 'America/Sao_Paulo', nomeExibicao: 'Debby Silva' }, { db: app.db })).toEqual({ jaPedidoEm: '05/10/2026' });
  });
});
```

`src/modules/portal/meus-dados.ts`:

```ts
import { and, eq, gt, inArray, or } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { dataExports, patients, privacyRequests } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { formatarData, hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { PENDENTE_MAX_MS, solicitarExportacao, type EstadoExportacao } from '@/modules/pacientes/exportacao';
import { PRAZO_RESPOSTA_DIAS } from '@/modules/pacientes/lgpd';
import { auditRead } from '@/modules/plataforma/audit';

export const MSG_MEUS_DADOS = {
  pedido: 'Pedimos seus dados. O link chega por e-mail e vale por 24 horas.',
  jaPedido: 'Você já pediu seus dados nas últimas 24 horas. O link chega por e-mail.',
  exclusaoRegistrada: 'Pedido de exclusão registrado. Enviamos a confirmação para o seu e-mail.',
  exclusaoJaPedida: (data: string) => `Seu pedido de exclusão já foi registrado em ${data}.`,
  pronta: (quando: string) => `O arquivo está pronto. O link vale até ${quando}.`,
  preparando: 'Ainda estamos preparando seus dados. Volte em alguns minutos.',
  expirada: 'Este link expirou. Peça os dados de novo em Perfil.',
  falhou: 'Não foi possível gerar seus dados. Peça de novo em Perfil.',
} as const;

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const doTitular = (ctx: TenantContext): string => {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('só em sessão de paciente');
  return ctx.patientId;
};

/** US-046 "Exportar meus dados" / D16: o ZIP da US-018 no escopo do titular, no máximo 1 a cada 24 h. */
export async function pedirMeusDados(ctx: TenantContext, deps: { db?: Db; agora?: Date; boss?: PgBoss } = {}): Promise<'pedido' | 'ja_pedido'> {
  const patientId = doTitular(ctx);
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const [recente] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: dataExports.id })
        .from(dataExports)
        .where(
          and(
            eq(dataExports.patientId, patientId),
            eq(dataExports.escopo, 'titular'),
            gt(dataExports.createdAt, new Date(agora.getTime() - UM_DIA_MS)),
            // "falhou" não conta; pendente há mais de 30 min é job perdido (solicitarExportacao o marca "falhou"
            // e cria outro) — sem isto o titular ficaria 24 h preso a um pedido que nunca chega
            or(inArray(dataExports.status, ['pronta', 'expirada']), and(eq(dataExports.status, 'pendente'), gt(dataExports.createdAt, new Date(agora.getTime() - PENDENTE_MAX_MS)))),
          ),
        ),
    db,
  );
  if (recente) return 'ja_pedido';
  await solicitarExportacao(ctx, patientId, { db, now: agora, boss: deps.boss, escopo: 'titular' });
  return 'pedido';
}

/** A página do link do e-mail: só pedidos do escopo titular do próprio paciente. Entregar o link é leitura auditada. */
export async function estadoDosMeusDados(ctx: TenantContext, exportId: string, o: { db?: Db; agora?: Date } = {}): Promise<EstadoExportacao> {
  const patientId = doTitular(ctx);
  const agora = o.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx): Promise<EstadoExportacao> => {
      const [e] = await tx.select().from(dataExports).where(and(eq(dataExports.id, exportId), eq(dataExports.patientId, patientId), eq(dataExports.escopo, 'titular')));
      if (!e) return { estado: 'inexistente' };
      if (e.status === 'pendente' || e.status === 'falhou') return { estado: e.status };
      if (e.status === 'pronta' && e.arquivoPath && e.expiraEm && e.expiraEm.getTime() > agora.getTime()) {
        await auditRead(tx, { entidade: 'exportacoes', entidadeId: e.id, patientId });
        return { estado: 'pronta', caminho: e.arquivoPath, expiraEm: e.expiraEm };
      }
      return { estado: 'expirada' };
    },
    o.db ?? getDb(),
  );
}

/**
 * US-046 "Pedir exclusão" / D17: um pedido aberto por vez, prazo de 15 dias no fuso do tenant, e-mail ao titular; a
 * nutricionista vê no quadro "Pedidos do titular" e atende pela aba Privacidade (US-018).
 */
export async function pedirExclusao(ctx: TenantContext, tenant: { fuso: string; nomeExibicao: string }, deps: { db?: Db; agora?: Date } = {}): Promise<{ registrado: true } | { jaPedidoEm: string }> {
  const patientId = doTitular(ctx);
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ email: patients.email }).from(patients).where(eq(patients.id, patientId)).for('update');
      if (!p) throw new Error('paciente da sessão não encontrado');
      const [aberto] = await tx
        .select({ createdAt: privacyRequests.createdAt })
        .from(privacyRequests)
        .where(and(eq(privacyRequests.patientId, patientId), eq(privacyRequests.tipo, 'exclusao'), eq(privacyRequests.status, 'aberto')));
      if (aberto) return { jaPedidoEm: formatarData(partesNoFuso(aberto.createdAt, tenant.fuso).data) };
      const prazo = somarDias(hojeNoFuso(tenant.fuso, agora), PRAZO_RESPOSTA_DIAS);
      await tx.insert(privacyRequests).values({ tenantId: ctx.tenantId, patientId, tipo: 'exclusao', status: 'aberto', prazo, createdAt: agora });
      await enqueueEmail({ tipo: 'pedido_exclusao_registrado', para: p.email, nutri: tenant.nomeExibicao, prazo: formatarData(prazo) }, { tenantId: ctx.tenantId, tx });
      return { registrado: true as const };
    },
    deps.db ?? getDb(),
  );
}
```

Run: `pnpm test src/modules/portal/meus-dados.test.ts` → PASS.

- [ ] **Step 4: WhatsApp no perfil (US-011 "Revogar o WhatsApp")** — em `src/modules/pacientes/convite-paciente.ts`, exportar a função `escolhaWhatsapp` (hoje local). `src/modules/portal/perfil.test.ts`:

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MSG_PERFIL, PerfilPacienteError, preferenciaWhatsapp, situacaoDoWhatsapp } from './perfil';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('Perfil > Notificações: WhatsApp (US-011)', () => {
  it('desmarcar grava o opt-out; marcar de novo grava o opt-in de origem paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await situacaoDoWhatsapp(ctx, app.db)).toEqual({ ativo: true, temTelefone: true });
    await preferenciaWhatsapp(ctx, false, { db: app.db });
    const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), app.db))[0];
    expect((await ler()).whatsappOptoutEm).not.toBeNull();
    expect(await situacaoDoWhatsapp(ctx, app.db)).toEqual({ ativo: false, temTelefone: true });
    await preferenciaWhatsapp(ctx, true, { db: app.db });
    expect(await ler()).toMatchObject({ whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null });
  });

  it('sem telefone, marcar é recusado com a orientação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: null });
    await expect(preferenciaWhatsapp(ctxPaciente(T.tenantId, p.id), true, { db: app.db })).rejects.toEqual(new PerfilPacienteError(MSG_PERFIL.semTelefone));
  });
});
```

`src/modules/portal/perfil.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { escolhaWhatsapp } from '@/modules/pacientes/convite-paciente';

export const MSG_PERFIL = {
  semTelefone: 'Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.',
  salvo: 'Preferência salva.',
} as const;

export class PerfilPacienteError extends Error {
  override name = 'PerfilPacienteError';
}

const doTitular = (ctx: TenantContext): string => {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('só em sessão de paciente');
  return ctx.patientId;
};

export async function situacaoDoWhatsapp(ctx: TenantContext, db: Db = getDb()): Promise<{ ativo: boolean; temTelefone: boolean }> {
  const id = doTitular(ctx);
  const [p] = await withTenant(ctx, (tx) => tx.select({ telefone: patients.telefoneE164, optin: patients.whatsappOptinEm, optout: patients.whatsappOptoutEm }).from(patients).where(eq(patients.id, id)), db);
  return { ativo: Boolean(p?.optin) && !p?.optout, temTelefone: Boolean(p?.telefone) };
}

/** US-011 "Revogar o WhatsApp": desmarcar = opt-out a partir de agora (o envio já respeita, INT-01); marcar = opt-in do paciente. */
export async function preferenciaWhatsapp(ctx: TenantContext, quer: boolean, o: { db?: Db; agora?: Date } = {}): Promise<void> {
  const id = doTitular(ctx);
  const agora = o.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, id)).for('update');
      if (!p) throw new Error('paciente da sessão não encontrado');
      if (quer && !p.telefoneE164) throw new PerfilPacienteError(MSG_PERFIL.semTelefone);
      await tx.update(patients).set({ ...escolhaWhatsapp(quer, p, agora), updatedAt: agora }).where(eq(patients.id, id));
    },
    o.db ?? getDb(),
  );
}
```

(`escolhaWhatsapp(quer, p, now)` é a função do aceite do convite: sem telefone devolve `{}`, por isso o `PerfilPacienteError` vem antes.)

Run: `pnpm test src/modules/portal/perfil.test.ts src/modules/pacientes/convite-paciente.test.ts` → PASS.

- [ ] **Step 5: LGPD — fotos do diário, quadro do painel e conta do titular (falham → passam)** — `src/modules/pacientes/lgpd.test.ts`, acrescentar:

```ts
it('Plano 06: atender o pedido de exclusão apaga as fotos do diário (o registro fica, com a foto "removida")', async () => {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const foto = await salvarArquivo(T.ctx, { tipo: 'diario_foto', conteudo: JPEG, permitidos: ['jpg'], patientId: p.id }, { db: app.db, dataDir });
  await withTenant(T.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId: p.id, refeicao: 'Almoço', fotoPath: foto.caminho, fotoStatus: 'pronta' }), app.db);
  await atenderPedidoExclusao(T.ctx, T.tenant, p.id, p.nome, { db: app.db });
  expect(await apagarFotosDoDiario(T.ctx, p.id, { db: app.db, dataDir })).toBe(1);
  const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), app.db);
  expect(e).toMatchObject({ fotoPath: null, fotoStatus: 'removida' });
  expect(existsSync(resolverCaminho(dataDir, foto.caminho))).toBe(false);
});

it('Plano 06: pedidos do titular abertos para o quadro do painel, com nome e prazo', async () => {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx, { nome: 'Carla Dias' });
  await withTenant(T.ctx, (tx) => tx.insert(privacyRequests).values({ tenantId: T.tenantId, patientId: p.id, tipo: 'exclusao', status: 'aberto', prazo: '2026-10-20' }), app.db);
  expect(await pedidosDoTitularAbertos(T.ctx, app.db)).toEqual([{ patientId: p.id, nome: 'Carla Dias', tipo: 'exclusao', prazo: '2026-10-20' }]);
});

it('P06-08 (D18): anonimizar sem outro vínculo anonimiza a conta (nome, e-mail, sessões, senha); com outro vínculo, a conta fica', async () => {
  const A = await novoTenant(app.db);
  const B = await novoTenant(app.db);
  const sozinha = await pacienteComConta(app.db, A);
  const dupla = await pacienteComConta(app.db, A);
  await pacienteComConta(app.db, B, { userId: dupla.userId });
  for (const x of [sozinha, dupla]) {
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2000-01-01' }).where(eq(patients.id, x.paciente.id)), app.db);
  }
  await anonimizarVencidos(app.db, new Date('2026-10-05T12:00:00Z'), { dataDir });
  const [u1] = await app.db.select().from(user).where(eq(user.id, sozinha.userId));
  expect(u1).toMatchObject({ name: 'Paciente anonimizado', email: `anonimo-${sozinha.userId}@anonimizado.invalid` });
  expect(await app.db.select().from(account).where(eq(account.userId, sozinha.userId))).toEqual([]);
  const [u2] = await app.db.select().from(user).where(eq(user.id, dupla.userId));
  expect(u2.email).toBe(dupla.email);
});
```

(imports a acrescentar: `existsSync`, `account`, `user`, `diaryEntries`, `privacyRequests`, `patients`, `pacienteComConta` de `../../../test/portal`, `salvarArquivo`, `resolverCaminho`, `apagarFotosDoDiario`, `pedidosDoTitularAbertos`; `JPEG` = o mesmo buffer pequeno de `diario.test.ts`.)

`src/modules/pacientes/conta-titular.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { account, session, twoFactor, user } from '@/db/schema';

/**
 * P06-08 (D18, desvio decidido pelo dono em 30/09/2026): o titular anonimizado que não tem outro vínculo perde a
 * identificação também na conta de login. A tabela `user` fica fora da RLS (CLAUDE.md regra 1): só pelo id da conta.
 * A linha não é apagada (patients.user_id e consents apontam para ela; apagar dispararia a auditoria fora do tenant).
 */
export async function anonimizarContaSemVinculo(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.delete(session).where(eq(session.userId, userId));
  await tx.delete(account).where(eq(account.userId, userId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await tx.update(user).set({ name: 'Paciente anonimizado', email: `anonimo-${userId}@anonimizado.invalid`, emailVerified: false, updatedAt: now }).where(eq(user.id, userId));
}
```

(`session`, `account` e `twoFactor` são os exports de `src/db/schema/auth.ts`.) `src/modules/pacientes/conta-titular.test.ts`: conta com duas sessões, senha e 2FA → depois, nenhuma sessão, nenhuma `account`, nenhum `two_factor`, `user` com nome e e-mail anônimos e o login com a senha antiga recusado (`entrar` de `test/sessao.ts` lança).

`src/modules/pacientes/lgpd.ts`:

```ts
/** Plano 06: os registros do diário com foto (convertida ou original) do paciente. */
async function fotosDoDiario(tx: Tx, patientId: string): Promise<{ id: string; caminho: string }[]> {
  const r = await tx.select({ id: diaryEntries.id, foto: diaryEntries.fotoPath, original: diaryEntries.fotoOriginalPath }).from(diaryEntries).where(and(eq(diaryEntries.patientId, patientId), or(isNotNull(diaryEntries.fotoPath), isNotNull(diaryEntries.fotoOriginalPath))));
  return r.flatMap((e) => [e.foto, e.original].filter((c): c is string => c !== null).map((caminho) => ({ id: e.id, caminho })));
}

/**
 * US-018 "fotos do diário … apagadas na hora" (Plano 06): o registro fica (prontuário guardado), sem a foto. Chamado
 * depois de atenderPedidoExclusao (arquivo fora da transação) e, como rede de segurança, pelo job diário de retenção
 * para quem está bloqueado. Idempotente.
 */
export async function apagarFotosDoDiario(ctx: TenantContext, patientId: string, deps: { db?: Db; dataDir?: string } = {}): Promise<number> {
  const db = deps.db ?? getDb();
  let n = 0;
  for (const f of await withTenant(ctx, (tx) => fotosDoDiario(tx, patientId), db)) {
    const ok = await apagarArquivo(ctx, { caminho: f.caminho }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) => {
        await tx
          .update(diaryEntries)
          .set({ fotoPath: sql`case when ${diaryEntries.fotoPath} = ${f.caminho} then null else ${diaryEntries.fotoPath} end`, fotoOriginalPath: sql`case when ${diaryEntries.fotoOriginalPath} = ${f.caminho} then null else ${diaryEntries.fotoOriginalPath} end`, fotoStatus: 'removida', updatedAt: new Date() })
          .where(eq(diaryEntries.id, f.id));
        return true;
      },
    });
    if (ok) n++;
  }
  return n;
}

/** Quadro "Pedidos do titular" do painel (US-046): os abertos, com o nome e o prazo, prazo mais curto primeiro. */
export async function pedidosDoTitularAbertos(ctx: TenantContext, db: Db = getDb()) {
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ patientId: privacyRequests.patientId, nome: patients.nome, tipo: privacyRequests.tipo, prazo: privacyRequests.prazo })
        .from(privacyRequests)
        .innerJoin(patients, eq(patients.id, privacyRequests.patientId))
        .where(eq(privacyRequests.status, 'aberto'))
        .orderBy(asc(privacyRequests.prazo)),
    db,
  ) as Promise<{ patientId: string; nome: string; tipo: 'exclusao' | 'exportacao'; prazo: string }[]>;
}
```

e:
- `anexosDoPaciente` acrescenta `...(await fotosDoDiario(tx, patientId)).map((f) => ({ c: f.caminho }))` à lista;
- o comentário de `atenderPedidoExclusao` ("Plano 06: apagar aqui também as fotos do diário") vira "as fotos do diário saem logo depois, por apagarFotosDoDiario (arquivo fora da transação)", e a Server Action que chama `atenderPedidoExclusao` (`src/app/painel/pacientes/[id]/privacidade/actions.ts`) chama `apagarFotosDoDiario(ctx, id)` em seguida (falha só vira log: o job diário repete);
- em `anonimizarVencidos`: a lista `vencidos` passa a ler também `userId`; antes de cada anonimização, as fotos saem pelo `anexosDoPaciente` (já incluídas); e, antes da transação final, `const contaSozinha = v.userId ? (await vinculosDaConta(v.userId, { db, todos: true })).every((x) => (x.tenantId === t.id && x.patientId === v.id) || x.anonimizado) : false;` — dentro da transação, depois do `UPDATE` de `patients`, `if (r.length && contaSozinha) await anonimizarContaSemVinculo(tx, v.userId!, now);`;
- no fim da varredura de cada tenant em `anonimizarVencidos`, a rede de segurança: para cada paciente `bloqueado` com foto no diário, `apagarFotosDoDiario(ctx, id, deps)` (erro só no log, como o resto da varredura).

`CLAUDE.md`, regra 1: acrescentar à lista da tabela `user` "por `src/modules/pacientes/conta-titular.ts` (anonimização da conta do titular sem outro vínculo, P06-08)" e, na frase do contexto `conta`, "e por `src/modules/pacientes/lgpd.ts` (outros vínculos da conta antes de anonimizá-la)".

Run: `pnpm test src/modules/pacientes` → PASS.

- [ ] **Step 6: Telas** — `src/app/p/(portal)/perfil/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_MEUS_DADOS, pedirExclusao, pedirMeusDados } from '@/modules/portal/meus-dados';
import { MSG_PERFIL, PerfilPacienteError, preferenciaWhatsapp } from '@/modules/portal/perfil';

export type PerfilState = { ok?: string; erro?: string };

export async function meusDadosAction(): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  return { ok: (await pedirMeusDados(ctx)) === 'pedido' ? MSG_MEUS_DADOS.pedido : MSG_MEUS_DADOS.jaPedido };
}

export async function exclusaoAction(): Promise<PerfilState> {
  const { ctx, tenant } = await requirePaciente('/p/perfil');
  const r = await pedirExclusao(ctx, tenant);
  return { ok: 'registrado' in r ? MSG_MEUS_DADOS.exclusaoRegistrada : MSG_MEUS_DADOS.exclusaoJaPedida(r.jaPedidoEm) };
}

export async function whatsappAction(_: PerfilState, formData: FormData): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  try {
    await preferenciaWhatsapp(ctx, formData.get('whatsapp') === 'on');
  } catch (e) {
    if (e instanceof PerfilPacienteError) return { erro: e.message };
    throw e;
  }
  revalidatePath('/p/perfil');
  return { ok: MSG_PERFIL.salvo };
}
```

`src/app/p/(portal)/perfil/privacidade.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { exclusaoAction, meusDadosAction, type PerfilState } from './actions';

const Retorno = ({ s }: { s: PerfilState }) => (s.ok ? <p role="status">{s.ok}</p> : s.erro ? <p role="alert" className="text-red-700">{s.erro}</p> : null);

/** US-046: "Baixar meus dados" e "Pedir exclusão dos meus dados" (com confirmação). */
export function Privacidade() {
  const [dados, pedirDados, pedindo] = useActionState<PerfilState>(meusDadosAction, {});
  const [exc, pedirExc, excluindo] = useActionState<PerfilState>(exclusaoAction, {});
  return (
    <div className="space-y-4">
      <form action={pedirDados}>
        <button disabled={pedindo} className="min-h-11 rounded border px-4">Baixar meus dados</button>
      </form>
      <Retorno s={dados} />
      <form
        action={pedirExc}
        onSubmit={(e) => {
          if (!window.confirm('Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal.')) e.preventDefault();
        }}
      >
        <button disabled={excluindo} className="min-h-11 rounded border border-red-700 px-4 text-red-800">Pedir exclusão dos meus dados</button>
      </form>
      <Retorno s={exc} />
    </div>
  );
}
```

`src/app/p/(portal)/perfil/whatsapp-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { whatsappAction, type PerfilState } from './actions';

export function WhatsappForm({ ativo }: { ativo: boolean }) {
  const [s, enviar, enviando] = useActionState<PerfilState, FormData>(whatsappAction, {});
  return (
    <form action={enviar} className="space-y-2">
      <div className="flex min-h-11 items-center gap-2">
        <input id="whatsapp" name="whatsapp" type="checkbox" defaultChecked={ativo} className="size-5" />
        <label htmlFor="whatsapp">Receber lembretes por WhatsApp</label>
      </div>
      {s.erro && <p role="alert" className="text-red-700">{s.erro}</p>}
      {s.ok && <p role="status">{s.ok}</p>}
      <button disabled={enviando} className="min-h-11 rounded border px-4">Salvar</button>
    </form>
  );
}
```

`src/app/p/(portal)/perfil/page.tsx`:

```tsx
import Link from 'next/link';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { situacaoDoWhatsapp } from '@/modules/portal/perfil';
import { AtivarNotificacoes } from '../../notificacoes';
import { Privacidade } from './privacidade';
import { WhatsappForm } from './whatsapp-form';

export const dynamic = 'force-dynamic';

export default async function Perfil() {
  const { ctx, data, vinculos } = await requirePaciente('/p/perfil');
  const whatsapp = await situacaoDoWhatsapp(ctx);
  return (
    <main className="space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Perfil</h1>
      <p>{`Conectado como ${data.user.email}.`}</p>
      <section aria-labelledby="notificacoes" className="space-y-3">
        <h2 id="notificacoes" className="text-lg font-semibold">Notificações</h2>
        <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={ctx.patientId!} />
        <WhatsappForm ativo={whatsapp.ativo} />
      </section>
      <section aria-labelledby="privacidade" className="space-y-3">
        <h2 id="privacidade" className="text-lg font-semibold">Privacidade</h2>
        <Privacidade />
      </section>
      {vinculos.length > 1 && (
        <p><Link href="/p/escolher?volta=%2Fp%2Finicio" className="underline">Trocar de nutricionista</Link></p>
      )}
    </main>
  );
}
```

`src/app/p/(portal)/meus-dados/exportacoes/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { formatarQuando } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { estadoDosMeusDados, MSG_MEUS_DADOS } from '@/modules/portal/meus-dados';

export const dynamic = 'force-dynamic';

export default async function MeusDadosExportacao({ params }: PageProps<'/p/meus-dados/exportacoes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requirePaciente(`/p/meus-dados/exportacoes/${id}`);
  if (!idValido(id)) notFound();
  const e = await estadoDosMeusDados(ctx, id);
  if (e.estado === 'inexistente') notFound();
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Seus dados</h1>
      {e.estado === 'pronta' && (
        <>
          <p>{MSG_MEUS_DADOS.pronta(formatarQuando(e.expiraEm, tenant.fuso))}</p>
          <a href={signFileUrl(e.caminho)} className="inline-flex min-h-11 items-center rounded bg-emerald-700 px-4 text-white">Baixar arquivo</a>
        </>
      )}
      {e.estado === 'pendente' && <p role="status">{MSG_MEUS_DADOS.preparando}</p>}
      {e.estado === 'expirada' && <p>{MSG_MEUS_DADOS.expirada}</p>}
      {e.estado === 'falhou' && <p role="alert">{MSG_MEUS_DADOS.falhou}</p>}
    </main>
  );
}
```

`src/app/p/navegacao.ts`: `{ href: '/p/perfil', rotulo: 'Perfil' }` no fim. `src/app/painel/page.tsx`, quadro novo depois do "Agenda":

```tsx
        {pedidos.length > 0 && (
          <section aria-labelledby="pedidos-titular" className="my-4 space-y-2">
            <h2 id="pedidos-titular" className="text-lg font-semibold">Pedidos do titular</h2>
            <ul className="list-disc pl-5 text-sm">
              {pedidos.map((p) => (
                <li key={`${p.patientId}-${p.tipo}`}>
                  <Link href={`/painel/pacientes/${p.patientId}/privacidade`} className="underline">
                    {p.tipo === 'exclusao' ? `Pedido de exclusão de ${p.nome}` : `Pedido de dados de ${p.nome}`}
                  </Link>
                  {` · prazo ${formatarData(p.prazo)}`}
                </li>
              ))}
            </ul>
          </section>
        )}
```

com `const pedidos = await pedidosDoTitularAbertos(ctx);` junto das outras leituras (transações separadas, como já é o painel).

- [ ] **Step 7: E2E** — `e2e/portal.spec.ts`:

```ts
test('Perfil > Privacidade: baixar meus dados chega por e-mail e abre no portal; pedir exclusão aparece no painel (US-046)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.11');
  await p.page.goto('/p/perfil');
  await p.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Pedimos seus dados. O link chega por e-mail e vale por 24 horas.' })).toBeVisible();
  const email = await esperarEmail(p.email, { assunto: 'Exportação de dados pronta' });
  expect(email.texto).toContain('pede que você entre no portal');
  await p.page.goto(primeiroLink(email.texto, '/p/meus-dados/exportacoes/'));
  await expect(p.page.getByRole('link', { name: 'Baixar arquivo' })).toBeVisible();
  await p.page.goto('/p/perfil');
  await p.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Você já pediu seus dados nas últimas 24 horas.' })).toBeVisible();
  p.page.once('dialog', (d) => d.accept());
  await p.page.getByRole('button', { name: 'Pedir exclusão dos meus dados' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Pedido de exclusão registrado.' })).toBeVisible();
  await esperarEmail(p.email, { assunto: 'Seu pedido foi registrado' });
  await nutri.goto('/painel');
  await expect(nutri.getByRole('link', { name: `Pedido de exclusão de ${p.nome}` })).toBeVisible();
  await p.page.context().close();
});

test('Perfil > Notificações: sem telefone, ligar o WhatsApp explica o que fazer (US-011)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.12');
  await p.page.goto('/p/perfil');
  await p.page.getByLabel('Receber lembretes por WhatsApp').check();
  await p.page.getByRole('button', { name: 'Salvar' }).click();
  await expect(p.page.getByRole('alert')).toHaveText('Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.');
  await p.page.context().close();
});
```

(importar `esperarEmail` e `primeiroLink` de `./mailpit`.)

Run: `pnpm build && pnpm test && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add drizzle src/db src/modules/portal src/modules/pacientes src/email "src/app/p/(portal)/perfil" "src/app/p/(portal)/meus-dados" src/app/p/navegacao.ts src/app/painel/page.tsx "src/app/painel/pacientes/[id]/privacidade/actions.ts" e2e/portal.spec.ts CLAUDE.md
git commit -m "feat(portal): Perfil — baixar meus dados, pedir exclusão, WhatsApp; fotos do diário e conta do titular na LGPD (US-046, P06-08)"
```

---
### Task 12: Agenda no PWA — minhas consultas, agendar, confirmar, cancelar, remarcar e avisar (P06-09, US-032, US-033, US-035, RN-06)

**Files:**
- Create: `src/modules/portal/agenda.ts`, `src/modules/portal/agenda.test.ts`, `src/app/p/(portal)/agenda/page.tsx`, `src/app/p/(portal)/agenda/nova/page.tsx`, `src/app/p/(portal)/agenda/[id]/page.tsx`, `src/app/p/(portal)/agenda/actions.ts`, `src/app/p/(portal)/agenda/agendar-form.tsx`, `src/app/p/(portal)/agenda/acoes-consulta.tsx`, `src/app/p/quando-local.tsx`, `src/app/p/quando-local.test.ts`
- Modify: `src/app/p/navegacao.ts`, `src/app/p/(portal)/inicio/page.tsx` (próxima consulta), `src/app/n/[slug]/page.tsx` (`volta` do "Entrar"), `e2e/portal.ts`, `e2e/portal.spec.ts`

**Interfaces:**
- Consumes (Plano 05, sem mudança): `horariosParaPaciente`, `semanaDaJanela`, `agendarComoPaciente`, `remarcarComoPaciente`, `cancelarConsulta(ctx, tenant, id, { por: 'paciente' })`, `confirmarPresenca(ctx, id, 'link')`, `pedirRemarcacao`, `podeAlterarPeloPaciente`, `listarConsultas`, `buscarConsulta`, `STATUS_ATIVOS`, `ConsultaError`, `ConsultaNaoEncontradaError`, `TenantAgenda`, `horariosVisiveis`, `HorarioVisivel`, `MSG_AGENDA`, `retornoDaConfirmacao`, `formatarQuando`, `quandoComFuso`, `inicioDoDia`, `partesNoFuso`, `somarDias`; `SeletorHorarios`; `PacienteBloqueadoError`.
- Produces:
  - `@/modules/portal/agenda`: `type ConsultaDoPaciente = { id: string; inicio: Date; fim: Date; modalidade: 'presencial' | 'online'; linkOnline: string | null; status: StatusConsulta; pedidoRemarcacao: boolean; podeAlterar: boolean }`, `consultasDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db?: Db): Promise<{ proximas: ConsultaDoPaciente[]; anteriores: ConsultaDoPaciente[] }>`, `consultaDoPaciente(ctx, tenant, id, agora, db?): Promise<ConsultaDoPaciente | null>`, `horariosDaSemana(tenant: TenantAgenda, agora: Date, semana: unknown, ignorarConsultaId?: string): Promise<{ semana: string; primeira: string; ultima: string; horarios: HorarioVisivel[] }>`.
  - `src/app/p/quando-local.tsx`: `QuandoLocal({ semFuso, comFuso, fuso })` (RN-06: a sigla só quando o fuso do aparelho é outro) e a função pura `precisaDaSigla(fusoDoAparelho: string, fusoDoTenant: string): boolean`.

- [ ] **Step 1: Testes (falham)** — `src/modules/portal/agenda.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { consultaDireta, em, semanaToda, tenantAgenda } from '../../../test/agenda';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { consultaDoPaciente, consultasDoPaciente, horariosDaSemana } from './agenda';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('agenda do paciente no PWA (P06-09)', () => {
  it('próximas (ativas, em ordem) e anteriores (as 10 últimas); só as do próprio paciente; prazo do RN-04', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const agora = em('2026-10-05', '10:00');
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-05', '20:00')); // hoje, a menos de 24 h: não altera
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-09', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-09-30', '09:00'));
    await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-08', '09:00'));
    const r = await consultasDoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), agora, app.db);
    expect(r.proximas.map((c) => [c.inicio.toISOString(), c.podeAlterar])).toEqual([
      [em('2026-10-05', '20:00').toISOString(), false],
      [em('2026-10-09', '09:00').toISOString(), true],
    ]);
    expect(r.anteriores.map((c) => c.inicio.toISOString())).toEqual([em('2026-09-30', '09:00').toISOString()]);
  });

  it('consulta de outro paciente pelo id → null (RLS)', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const id = await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-09', '09:00'));
    expect(await consultaDoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), id, em('2026-10-05', '10:00'), app.db)).toBeNull();
  });

  it('horários da semana pedida, presos à janela de 12 h a 60 dias (RN-03)', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const r = await horariosDaSemana({ ...tenantAgenda(T) }, em('2026-10-05', '10:00'), '9999-12-31');
    expect(r.semana <= r.ultima).toBe(true);
    expect(r.horarios.length).toBeGreaterThan(0);
    expect(r.horarios.every((h) => Date.parse(h.inicio) >= em('2026-10-05', '22:00').getTime())).toBe(true);
  });
});
```

(`horariosDaSemana` usa a conexão padrão — como `horariosParaPaciente` — e por isso o teste roda com o banco da suíte (`getDb`), igual aos testes de agendamento do Plano 05; conferir as assinaturas de `consultaDireta`, `semanaToda`, `tenantAgenda` e `em` em `test/agenda.ts`.)

- [ ] **Step 2: Implementação** — `src/modules/portal/agenda.ts`

```ts
import { and, eq, gt, inArray, lte, notInArray, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { horariosParaPaciente, semanaDaJanela } from '@/modules/agenda/agendamento-paciente';
import { podeAlterarPeloPaciente } from '@/modules/agenda/cancelamento';
import { buscarConsulta, listarConsultas, STATUS_ATIVOS, type Consulta, type StatusConsulta, type TenantAgenda } from '@/modules/agenda/consultas';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { horariosVisiveis, type HorarioVisivel } from '@/modules/agenda/horarios';

export type ConsultaDoPaciente = {
  id: string;
  inicio: Date;
  fim: Date;
  modalidade: 'presencial' | 'online';
  linkOnline: string | null;
  status: StatusConsulta;
  pedidoRemarcacao: boolean;
  podeAlterar: boolean;
};

const doTitular = (ctx: TenantContext) => {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('só em sessão de paciente');
};

const paraPaciente = (c: Consulta, tenant: TenantAgenda, agora: Date): ConsultaDoPaciente => ({
  id: c.id,
  inicio: c.inicio,
  fim: c.fim,
  modalidade: c.modalidade,
  linkOnline: c.linkOnline,
  status: c.status,
  pedidoRemarcacao: c.pedidoRemarcacaoEm !== null,
  podeAlterar: (STATUS_ATIVOS as readonly string[]).includes(c.status) && podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora),
});

/** P06-09: "Minhas consultas" — a RLS por paciente entrega só as do paciente da sessão. Leitura da agenda sem auditRead (D10 do Plano 05). */
export async function consultasDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()) {
  doTitular(ctx);
  const ativas = inArray(appointments.status, [...STATUS_ATIVOS]);
  const proximas = await listarConsultas(ctx, and(ativas, gt(appointments.fim, agora)), { ordem: 'asc', limite: 20 }, db);
  const anteriores = await listarConsultas(ctx, or(lte(appointments.fim, agora), notInArray(appointments.status, [...STATUS_ATIVOS])), { ordem: 'desc', limite: 10 }, db);
  return { proximas: proximas.map((c) => paraPaciente(c, tenant, agora)), anteriores: anteriores.map((c) => paraPaciente(c, tenant, agora)) };
}

export async function consultaDoPaciente(ctx: TenantContext, tenant: TenantAgenda, id: string, agora: Date, db: Db = getDb()): Promise<ConsultaDoPaciente | null> {
  doTitular(ctx);
  const c = await buscarConsulta(ctx, id, db);
  return c ? paraPaciente(c, tenant, agora) : null;
}

/** Horários livres de uma semana da janela do paciente (RN-03), como no link da consulta. */
export async function horariosDaSemana(tenant: TenantAgenda, agora: Date, semana: unknown, ignorarConsultaId?: string): Promise<{ semana: string; primeira: string; ultima: string; horarios: HorarioVisivel[] }> {
  const s = semanaDaJanela(semana, partesNoFuso(agora, tenant.fuso).data);
  const de = inicioDoDia(s.semana, tenant.fuso);
  const ate = inicioDoDia(somarDias(s.semana, 7), tenant.fuso);
  const horarios = horariosVisiveis(await horariosParaPaciente(tenant, agora, { de, ate, ignorarConsultaId }), tenant.fuso);
  return { ...s, horarios };
}
```

(`eq` sai do import se não for usado.) Run: `pnpm test src/modules/portal/agenda.test.ts` → PASS.

- [ ] **Step 3: RN-06 — hora com a sigla quando o aparelho está em outro fuso** — `src/app/p/quando-local.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { precisaDaSigla } from './quando-local';

describe('RN-06 no PWA', () => {
  it('a sigla aparece só quando o fuso do aparelho é outro', () => {
    expect(precisaDaSigla('America/Sao_Paulo', 'America/Sao_Paulo')).toBe(false);
    expect(precisaDaSigla('Europe/Lisbon', 'America/Sao_Paulo')).toBe(true);
    expect(precisaDaSigla('', 'America/Sao_Paulo')).toBe(true); // sem informação: na dúvida, mostra
  });
});
```

`src/app/p/quando-local.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

export const precisaDaSigla = (fusoDoAparelho: string, fusoDoTenant: string): boolean => fusoDoAparelho !== fusoDoTenant;

/** RN-06: "seg., 12/10 às 09:00" no fuso do consultório; com o aparelho em outro fuso, "(horário de Brasília)" junto. */
export function QuandoLocal({ semFuso, comFuso, fuso }: { semFuso: string; comFuso: string; fuso: string }) {
  const [texto, setTexto] = useState(comFuso); // no servidor (e sem JS), com a sigla: nunca ambíguo
  useEffect(() => {
    setTexto(precisaDaSigla(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '', fuso) ? comFuso : semFuso);
  }, [semFuso, comFuso, fuso]);
  return <>{texto}</>;
}
```

- [ ] **Step 4: Ações e telas** — `src/app/p/(portal)/agenda/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { agendarComoPaciente } from '@/modules/agenda/agendamento-paciente';
import { retornoDaConfirmacao } from '@/modules/agenda/acoes-link';
import { cancelarConsulta, confirmarPresenca, pedirRemarcacao, remarcarComoPaciente } from '@/modules/agenda/cancelamento';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import { ConsultaError, ConsultaNaoEncontradaError } from '@/modules/agenda/consultas';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';

export type AgendaState = { ok?: string; erro?: string };

function tratar(e: unknown): AgendaState {
  if (e instanceof ConsultaError) return { erro: e.erros.inicio ?? e.erros.geral ?? MSG_AGENDA.naoAgendavel };
  if (e instanceof ConsultaNaoEncontradaError) return { erro: MSG_AGENDA.naoEncontrada };
  if (e instanceof PacienteBloqueadoError) return { erro: MSG_AGENDA.contaIndisponivel };
  throw e;
}

export async function agendarAction(_: AgendaState, formData: FormData): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente('/p/agenda/nova');
  try {
    await agendarComoPaciente(ctx, tenant, { inicio: formData.get('inicio'), modalidade: formData.get('modalidade') });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  return { ok: `Consulta marcada para ${quandoComFuso(new Date(String(formData.get('inicio'))), tenant.fuso)}.` };
}

export async function confirmarAction(id: string): Promise<AgendaState> {
  const { ctx } = await requirePaciente(`/p/agenda/${id}`);
  try {
    const r = retornoDaConfirmacao(await confirmarPresenca(ctx, id, 'link'));
    revalidatePath(`/p/agenda/${id}`);
    return r;
  } catch (e) {
    return tratar(e);
  }
}

export async function cancelarAction(id: string): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    await cancelarConsulta(ctx, tenant, id, { por: 'paciente' });
  } catch (e) {
    return tratar(e);
  }
  revalidatePath('/p/agenda');
  return { ok: MSG_AGENDA.cancelada };
}

export async function remarcarAction(id: string, _: AgendaState, formData: FormData): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    const novo = await remarcarComoPaciente(ctx, tenant, id, { inicio: formData.get('inicio'), modalidade: formData.get('modalidade') });
    revalidatePath('/p/agenda');
    return { ok: MSG_AGENDA.remarcada(quandoComFuso(novo.inicio, tenant.fuso)) };
  } catch (e) {
    return tratar(e);
  }
}

export async function avisarAction(id: string): Promise<AgendaState> {
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  try {
    await pedirRemarcacao(ctx, tenant, id);
  } catch (e) {
    return tratar(e);
  }
  return { ok: MSG_AGENDA.avisoDeRemarcacao };
}
```

`src/app/p/(portal)/agenda/agendar-form.tsx` (serve ao "Agendar" e ao "Remarcar"):

```tsx
'use client';
import { useActionState, useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';
import type { AgendaState } from './actions';

export function AgendarForm({ acao, horarios, temOnline, rotulo }: { acao: (s: AgendaState, f: FormData) => Promise<AgendaState>; horarios: HorarioVisivel[]; temOnline: boolean; rotulo: string }) {
  const [s, enviar, enviando] = useActionState<AgendaState, FormData>(acao, {});
  const [mod, setMod] = useState<Modalidade>('presencial');
  return (
    <form action={enviar} className="space-y-3">
      {temOnline ? (
        <fieldset className="space-y-1">
          <legend className="font-medium">Escolha a modalidade</legend>
          {(['presencial', 'online'] as const).map((m) => (
            <label key={m} className="mr-4 inline-flex min-h-11 items-center gap-2">
              <input type="radio" name="modalidade" value={m} checked={mod === m} onChange={() => setMod(m)} /> {m === 'presencial' ? 'Presencial' : 'Online'}
            </label>
          ))}
        </fieldset>
      ) : (
        <input type="hidden" name="modalidade" value="presencial" />
      )}
      <SeletorHorarios horarios={horarios} modalidade={mod} erro={s.erro} />
      {s.ok && <p role="status" className="rounded bg-emerald-50 p-3">{s.ok}</p>}
      <button disabled={enviando} className="min-h-11 rounded bg-emerald-700 px-4 text-white">{rotulo}</button>
    </form>
  );
}
```

`src/app/p/(portal)/agenda/acoes-consulta.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { avisarAction, cancelarAction, confirmarAction, type AgendaState } from './actions';

const Retorno = ({ s }: { s: AgendaState }) => (s.erro ? <p role="alert" className="text-red-700">{s.erro}</p> : s.ok ? <p role="status" className="rounded bg-emerald-50 p-3">{s.ok}</p> : null);

/** US-033 / US-035 no PWA: confirmar; dentro do prazo, cancelar; fora dele, só avisar a nutricionista (RN-04). */
export function AcoesConsulta({ id, confirmada, podeAlterar, pedidoRemarcacao }: { id: string; confirmada: boolean; podeAlterar: boolean; pedidoRemarcacao: boolean }) {
  const [conf, confirmar, confirmando] = useActionState<AgendaState>(confirmarAction.bind(null, id), {});
  const [canc, cancelar, cancelando] = useActionState<AgendaState>(cancelarAction.bind(null, id), {});
  const [avis, avisar, avisando] = useActionState<AgendaState>(avisarAction.bind(null, id), {});
  return (
    <div className="space-y-3">
      {!confirmada && (
        <form action={confirmar}>
          <button disabled={confirmando} className="min-h-11 rounded bg-emerald-700 px-4 text-white">Confirmar presença</button>
        </form>
      )}
      <Retorno s={conf} />
      {podeAlterar ? (
        <form action={cancelar} onSubmit={(e) => { if (!window.confirm('Cancelar esta consulta?')) e.preventDefault(); }}>
          <button disabled={cancelando} className="min-h-11 rounded border px-4">Cancelar consulta</button>
        </form>
      ) : (
        <>
          <p>Para alterar, fale com sua nutricionista.</p>
          {!pedidoRemarcacao && (
            <form action={avisar}>
              <button disabled={avisando} className="min-h-11 rounded border px-4">Avisar que preciso remarcar</button>
            </form>
          )}
        </>
      )}
      <Retorno s={canc} />
      <Retorno s={avis} />
    </div>
  );
}
```

`src/app/p/(portal)/agenda/page.tsx`:

```tsx
import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { formatarQuando, quandoComFuso } from '@/modules/agenda/fuso';
import { consultasDoPaciente, type ConsultaDoPaciente } from '@/modules/portal/agenda';
import { QuandoLocal } from '../../quando-local';

export const dynamic = 'force-dynamic';

const SITUACAO: Record<string, string> = { agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou' };

export default async function Agenda() {
  const { ctx, tenant } = await requirePaciente('/p/agenda');
  const { proximas, anteriores } = await consultasDoPaciente(ctx, tenant, new Date());
  const linha = (c: ConsultaDoPaciente) => (
    <li key={c.id}>
      <Link href={`/p/agenda/${c.id}`} className="flex min-h-11 items-center underline">
        <QuandoLocal semFuso={formatarQuando(c.inicio, tenant.fuso)} comFuso={quandoComFuso(c.inicio, tenant.fuso)} fuso={tenant.fuso} />
        {` · ${ROTULO_MODALIDADE[c.modalidade]} · ${SITUACAO[c.status]}`}
      </Link>
    </li>
  );
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Minhas consultas</h1>
      <p><Link href="/p/agenda/nova" className="inline-flex min-h-11 items-center rounded bg-emerald-700 px-4 text-white">Agendar consulta</Link></p>
      <section aria-labelledby="proximas">
        <h2 id="proximas" className="text-lg font-semibold">Próximas</h2>
        {proximas.length ? <ul>{proximas.map(linha)}</ul> : <p>Nenhuma consulta marcada.</p>}
      </section>
      {anteriores.length > 0 && (
        <section aria-labelledby="anteriores">
          <h2 id="anteriores" className="text-lg font-semibold">Anteriores</h2>
          <ul>{anteriores.map(linha)}</ul>
        </section>
      )}
    </main>
  );
}
```

`src/app/p/(portal)/agenda/nova/page.tsx`:

```tsx
import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { somarDias } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { horariosDaSemana } from '@/modules/portal/agenda';
import { agendarAction } from '../actions';
import { AgendarForm } from '../agendar-form';

export const dynamic = 'force-dynamic';

export default async function NovaConsulta({ searchParams }: PageProps<'/p/agenda/nova'>) {
  const { tenant } = await requirePaciente('/p/agenda/nova');
  const s = await horariosDaSemana(tenant, new Date(), (await searchParams).semana);
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Agendar consulta</h1>
      <nav aria-label="Semana" className="flex gap-3 text-sm">
        {s.semana > s.primeira && <Link href={`/p/agenda/nova?semana=${somarDias(s.semana, -7)}`} className="underline">Semana anterior</Link>}
        <span>{`${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`}</span>
        {s.semana < s.ultima && <Link href={`/p/agenda/nova?semana=${somarDias(s.semana, 7)}`} className="underline">Próxima semana</Link>}
      </nav>
      <AgendarForm acao={agendarAction} horarios={s.horarios} temOnline={Boolean(tenant.linkOnlinePadrao)} rotulo="Agendar consulta" />
    </main>
  );
}
```

(A navegação de semanas é a mesma da página do link da consulta, `src/app/consulta/[token]/page.tsx`. Na página da consulta abaixo, o "Remarcar" mostra só a semana pedida em `?semana=`, com os mesmos links apontando para `/p/agenda/<id>?semana=…`.)

`src/app/p/(portal)/agenda/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { formatarQuando, quandoComFuso, somarDias } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { formatarData } from '@/modules/pacientes/datas';
import { consultaDoPaciente, horariosDaSemana } from '@/modules/portal/agenda';
import { QuandoLocal } from '../../../quando-local';
import { AcoesConsulta } from '../acoes-consulta';
import { remarcarAction } from '../actions';
import { AgendarForm } from '../agendar-form';

export const dynamic = 'force-dynamic';

export default async function ConsultaDoPortal({ params, searchParams }: PageProps<'/p/agenda/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  if (!idValido(id)) notFound();
  const agora = new Date();
  const c = await consultaDoPaciente(ctx, tenant, id, agora);
  if (!c) notFound();
  const ativa = c.status === 'agendada' || c.status === 'confirmada';
  const s = ativa && c.podeAlterar ? await horariosDaSemana(tenant, agora, (await searchParams).semana, c.id) : null;
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sua consulta</h1>
      <p>
        <QuandoLocal semFuso={formatarQuando(c.inicio, tenant.fuso)} comFuso={quandoComFuso(c.inicio, tenant.fuso)} fuso={tenant.fuso} />
        {` · ${ROTULO_MODALIDADE[c.modalidade]}`}
      </p>
      {c.modalidade === 'online' && c.linkOnline && <p><a href={c.linkOnline} className="underline" rel="noreferrer">Link da chamada</a></p>}
      {ativa ? <AcoesConsulta id={c.id} confirmada={c.status === 'confirmada'} podeAlterar={c.podeAlterar} pedidoRemarcacao={c.pedidoRemarcacao} /> : <p>{c.status === 'cancelada' ? 'Esta consulta foi cancelada.' : 'Consulta encerrada'}</p>}
      {s && (
        <section aria-labelledby="remarcar" className="space-y-3">
          <h2 id="remarcar" className="text-lg font-semibold">Remarcar</h2>
          <nav aria-label="Semana" className="flex gap-3 text-sm">
            {s.semana > s.primeira && <Link href={`/p/agenda/${c.id}?semana=${somarDias(s.semana, -7)}`} className="underline">Semana anterior</Link>}
            <span>{`${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`}</span>
            {s.semana < s.ultima && <Link href={`/p/agenda/${c.id}?semana=${somarDias(s.semana, 7)}`} className="underline">Próxima semana</Link>}
          </nav>
          <AgendarForm acao={remarcarAction.bind(null, c.id)} horarios={s.horarios} temOnline={Boolean(tenant.linkOnlinePadrao)} rotulo="Remarcar para este horário" />
        </section>
      )}
    </main>
  );
}
```

`src/app/p/navegacao.ts`: `{ href: '/p/agenda', rotulo: 'Agenda' }` antes de "Perfil". `src/app/p/(portal)/inicio/page.tsx`: "Próxima consulta: <QuandoLocal …/>" com `consultasDoPaciente(ctx, tenant, new Date()).proximas[0]`, com link para `/p/agenda/<id>`. `src/app/n/[slug]/page.tsx`: o "Entrar (já sou paciente)" passa a `href="/entrar?volta=%2Fp%2Fagenda"`.

- [ ] **Step 5: E2E** — `e2e/portal.ts`:

```ts
/** A nutricionista marca uma consulta para o paciente daqui a ~50 dias, num horário que não repete na mesma execução. */
export async function marcarParaPaciente(nutri: Page, nome: string, email: string): Promise<void> {
  const d = new Date(Date.now() + 50 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((10 - d.getUTCDay()) % 7)); // quarta-feira
  const hora = `${String(8 + (Math.floor(Date.now() / 60_000) % 9)).padStart(2, '0')}:00`;
  await nutri.goto(`/painel/agenda/nova?data=${d.toISOString().slice(0, 10)}`);
  await nutri.getByLabel('Paciente').selectOption({ label: `${nome} (${email})` });
  await nutri.getByLabel('Hora').fill(hora);
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
}
```

`e2e/portal.spec.ts`:

```ts
test('agenda no PWA: a consulta marcada pela nutricionista aparece; confirmar presença; a página de agendar abre (P06-09)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.8.13');
  await marcarParaPaciente(nutri, p.nome, p.email);
  await p.page.goto('/p/agenda');
  const proxima = p.page.getByRole('region', { name: 'Próximas' }).getByRole('link').first();
  await expect(proxima).toContainText('Agendada');
  await proxima.click();
  await p.page.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Presença confirmada. Até lá!' })).toBeVisible();
  await p.page.goto('/p/agenda/nova');
  await expect(p.page.getByRole('heading', { name: 'Agendar consulta' })).toBeVisible();
  await p.page.goto('/p/agenda/00000000-0000-4000-8000-000000000000');
  await expect(p.page.getByText('404')).toBeVisible();
  await p.page.context().close();
});
```

(Os `<section aria-labelledby>` viram `region` com o nome do título.)

Run: `pnpm build && pnpm test src/app/p src/modules/portal && pnpm test:e2e e2e/portal.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/portal/agenda.ts src/modules/portal/agenda.test.ts "src/app/p/(portal)/agenda" src/app/p/quando-local.tsx src/app/p/quando-local.test.ts src/app/p/navegacao.ts "src/app/p/(portal)/inicio/page.tsx" "src/app/n/[slug]/page.tsx" e2e/portal.ts e2e/portal.spec.ts
git commit -m "feat(portal): agenda no PWA — minhas consultas, agendar, confirmar, cancelar, remarcar e avisar (P06-09, RN-06)"
```

---

### Task 13: Auditoria de acessibilidade do PWA com axe (P06-10, RNF-10) e compatibilidade móvel (RNF-09)

**Files:**
- Create: `e2e/acessibilidade.spec.ts`
- Modify: `package.json` + `pnpm-lock.yaml` (`@axe-core/playwright`), `playwright.config.ts` (projeto `celular`), `.github/workflows/ci.yml` (se o job de E2E listar projetos), qualquer tela do portal que o axe acusar

**Interfaces:**
- Consumes: todas as telas do portal (Tarefas 3–12) e `pacienteNoPortal`, `publicarPlanoSimples`, `marcarParaPaciente` (`e2e/portal.ts`).
- Produces: `e2e/acessibilidade.spec.ts` (WCAG 2.1 AA, zero violações, em viewport de celular).

- [ ] **Step 1: Dependência** — Run: `pnpm add -D @axe-core/playwright@4.13.0`.

- [ ] **Step 2: Projeto de celular** — `playwright.config.ts`, em `projects`:

```ts
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /acessibilidade\.spec\.ts/ },
    // RNF-09 / RNF-10: as telas do PWA no tamanho de um Android (Chrome) — o Safari do iOS fica no teste manual do runbook
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /acessibilidade\.spec\.ts/ },
  ],
```

- [ ] **Step 3: O teste (falha onde houver violação)** — `e2e/acessibilidade.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.9.1');
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.9.2');
  await publicarPlanoSimples(nutri, paciente.prontuario);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email);
  // um registro no diário, para a lista não sair vazia
  await paciente.page.goto('/p/diario');
  await paciente.page.getByLabel('Refeição').selectOption('Almoço');
  await paciente.page.getByLabel('O que você comeu?').fill('arroz e feijão');
  await paciente.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
});
test.afterAll(async () => {
  await paciente?.page.context().close();
  await nutri?.context().close();
});

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function semViolacoes(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), url).toEqual([]);
}

for (const url of ['/p/inicio', '/p/plano', '/p/diario', '/p/evolucao', '/p/compras?dias=7', '/p/agenda', '/p/agenda/nova', '/p/perfil']) {
  test(`axe sem violações (WCAG 2.1 AA) em ${url}`, async () => {
    await semViolacoes(paciente.page, url);
  });
}

test('axe sem violações na consulta, no termo e no "sem acesso"', async ({ browser }) => {
  await paciente.page.goto('/p/agenda');
  await paciente.page.getByRole('region', { name: 'Próximas' }).getByRole('link').first().click();
  const r = await new AxeBuilder({ page: paciente.page }).withTags(WCAG).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  // termo e "sem acesso" com uma conta nova arquivada/sem termo ficam cobertos no E2E da Tarefa 3; aqui só o desenho da página
  const outro = await pacienteNoPortal(browser, nutri, '10.9.9.3');
  await semViolacoes(outro.page, '/p/sem-acesso');
  await outro.page.context().close();
});
```

Run: `pnpm build && pnpm test:e2e --project=celular` → anote as violações.

- [ ] **Step 4: Corrigir o que o axe acusar** — corrigir na tela de origem (contraste das cores de selo e botão — o verde `emerald-700` sobre branco passa; amarelos de selo precisam de texto escuro —, rótulos de campos, nomes de links e botões só com ícone, ordem de títulos, `lang`, alvos de toque). Cada correção é feita na tela, nunca desligando a regra no `AxeBuilder`. Repetir o Step 3 até `[]` em todas.

- [ ] **Step 5: CI** — se `.github/workflows/ci.yml` roda `pnpm test:e2e --project=chromium` explicitamente, trocar para rodar os dois projetos (`pnpm test:e2e`); senão, nada a mudar.

Run: `pnpm test:e2e` → PASS (os dois projetos).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts e2e/acessibilidade.spec.ts .github/workflows/ci.yml src/app/p src/components
git commit -m "test(a11y): auditoria axe (WCAG 2.1 AA) de todas as telas do PWA em viewport de celular (RNF-10, P06-10)"
```

---
## Runbook do deploy do Plano 06 (o dono faz, com confirmação a cada passo)

1. **Snapshot no hPanel** antes do merge (regra do servidor). Lembrete: o **backup no host (P02-11, etapas 6 e 8) segue pendente** — o portal é a primeira tela em que o paciente grava dado de saúde (diário com foto); sem backup, nada de pacientes reais.
2. **Variável nova no app** (Easypanel → `nutri` → `app` → Ambiente): `VAPID_PUBLIC_KEY` = **a mesma** chave pública já configurada no worker (Plano 05). Sem ela, "Ativar notificações" mostra "Notificações no app ainda não estão disponíveis." e o resto do portal funciona. Nunca colar o valor em chat.
3. Merge (= deploy) só com o OK explícito do dono; as migrations 0070–0079 rodam no deploy (`DATABASE_URL_MIGRATOR`). A 0072 preenche o dono dos arquivos já gravados (laudos, PDFs, exportações) e **falha** se achar arquivo de paciente sem dono — nesse caso, parar e avisar (nada é apagado automaticamente).
4. **Teste manual no celular** (o CI não alcança um serviço de push real nem o Safari do iOS):
   - Android (Chrome): entrar como paciente de teste, "Instalar app", abrir pelo ícone, "Ativar notificações" → chega "Notificações ativadas ✅"; abrir "Plano", ligar o modo avião, abrir o app → plano com o selo "Offline — exibindo última versão"; "Sair" → entrar com outra conta no mesmo aparelho e conferir que o plano anterior não aparece offline.
   - iPhone (Safari 16.4+): o tutorial "Compartilhar → Adicionar à Tela de Início" aparece no navegador; depois de instalado, "Ativar notificações" aparece e o push de teste chega; foto do diário tirada pela câmera (HEIC) vira JPEG em até ~1 min.
5. Conferir no painel: "Diários" com o registro de teste, comentário e push "Sua nutricionista comentou seu diário"; "Pedidos do titular" depois de um "Pedir exclusão" de teste — e **apagar os dados de teste só com confirmação do dono**.

## Fechamento do plano (após a Tarefa 13)

- [ ] Revisão da entrega conforme o índice (revista em 02/10/2026): revisor por tarefa (feito ao longo) → **revisão final do branch (workflow) com uma onda de correções** → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor → backlog) → re-revisão **só do diff das correções** → `/security-review` com o **checklist reforçado** deste plano:
  - **Escrita do paciente (D1):** toda tabela com `tenant_id` tem `paciente_sem_insert/update/delete` ou bate com `PACIENTE_ESCREVE` (guarda verde); nenhuma escrita nova do portal fora da lista; `foods`, `food_measures`, `anamnesis_templates` e o prontuário recusam a sessão de paciente; os fluxos do Plano 05 que rodam como paciente continuam verdes.
  - **Sessão e vínculos (D2, D3):** `withConta` só em `vinculos.ts`, só `SELECT` em `patients` da própria conta (matriz de isolamento); cookie `nd_vinculo` reconferido a cada requisição; vínculo arquivado/bloqueado/anonimizado sem acesso; consultório suspenso → "Conta temporariamente indisponível"; termo da versão atual exigido; nenhuma página do portal monta `TenantContext` à mão.
  - **Arquivos (D4, D10):** `stored_files.patient_id` em todo arquivo de paciente (`salvarArquivo` recusa sem); `paciente_arquivos` esconde os de outro paciente; a foto original nunca é assinada; conversão só no worker (guarda do grafo); limite de 40 MP; JPEG sem EXIF/GPS; cota reservada na transação; o original sai depois da conversão; fotos apagadas no pedido de exclusão (e pelo job diário) e na anonimização.
  - **PWA (D6):** Cache Storage só com `/p/plano` 200 da própria URL; nada de `/api`, foto ou PDF; `Clear-Site-Data` no `/sair`; o "Sair" cancela a inscrição de push no servidor e no navegador; o toque na notificação só abre a própria origem.
  - **Push e e-mail (D7, D8, D24):** textos neutros (sem nome da nutricionista, sem dado de saúde); endpoint só de serviço de push conhecido (`endpointDePush`); inscrição por vínculo ativo; `VAPID_PRIVATE_KEY` só no worker.
  - **Titular (D16, D17, D18):** exportação do titular sem rascunho, sem notas privadas e sem etiquetas; 1 a cada 24 h; o link do portal só abre pedidos do escopo titular do próprio paciente; pedido de exclusão único e com prazo no fuso; a conta só é anonimizada sem outro vínculo vivo; sessões e senha apagadas.
  - **Logs:** nada de texto do diário, comentário, endpoint, chaves, caminho de arquivo ou e-mail (só ids, tipo e motivo).
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema Critical/Important confirmado, parar e avisar o dono.
- [ ] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): P06-00 a P06-11 ✅ (com o PR), P-16 resolvida.
- [ ] Atualizar a spec para a versão seguinte à da `main` (v1.9): §4.1 (contexto `conta`; escrita do paciente negada por padrão + `PACIENTE_ESCREVE`; `stored_files` por paciente), §4.2 (rotas do portal), §6 INT-03 (inscrição por vínculo, `VAPID_PUBLIC_KEY` no app, push de teste/comentário/plano novo, toque só na própria origem), §7 (`stored_files.patient_id`, `diary_entries` com as colunas a mais, `access_events` com `tenant_id`, `data_exports.escopo`, tipos novos de `notifications`, índice de `privacy_requests`), §8 RN-07 (HEIC por `heic-decode`, 40 MP), §11 P-16 resolvida, US-040 a US-046 com as notas de entrega (os "Desvios conscientes" desta página) e os textos novos de interface.
- [ ] Anotar para os próximos planos:
  - **Plano 07 (conteúdo):** a aba "Conteúdos" entra em `ITENS_DO_PORTAL`; `contents`, `content_views`, `content_favorites` precisam de `app_allow_paciente_escrita` para as visualizações e os favoritos (e da entrada em `PACIENTE_ESCREVE`); "Sugestão de receita" no "Meu plano" (US-041, P07-05) lê `meals.recipe_content_id`.
  - **Plano 08 (go-live):** P08-07 lê `access_events` (CS-02: ≥ 60% dos pacientes ativos abrem o PWA 1×/semana); k6 inclui `/p/plano` e `/api/p/acesso`; o teste manual do PWA no iPhone e no Android (runbook acima) entra no checklist assinado; o P08-06 publica o termo do advogado com versão nova — a D25 passa a pedir o novo aceite no login.
  - **Pós-MVP (F3-02, F3-04):** "Exames" e "IA Nutri" entram em `ITENS_DO_PORTAL`; qualquer escrita nova do paciente passa pela guarda `PACIENTE_ESCREVE`; o envio de exame pelo paciente reaproveita o molde da foto do diário (original guardado, conversão/checagem no worker, `stored_files.patient_id`).
- [ ] Lembrar o dono: o backup no host (P02-11, etapas 6 e 8) segue pendente; a variável `VAPID_PUBLIC_KEY` do app é dele no Easypanel; o merge (= deploy) só com OK explícito e snapshot no hPanel antes.
- [ ] Pedir ao dono o merge do PR (= deploy).

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec**

| Requisito | Onde |
|---|---|
| US-040 "Android" (botão "Instalar app" com o prompt nativo) | Tarefa 5 (`instalacao.ts`, `Instalar`) |
| US-040 "iPhone" (tutorial; ativar notificações só depois de instalado) | Tarefas 5 e 6 (`ehIos`, `AtivarNotificacoes` some fora do standalone) |
| US-040 "Permissão de push" (inscrição gravada, push de teste "Notificações ativadas ✅") | Tarefa 6 (`inscreverAparelho`, `push_teste`) |
| US-040 "Offline" (plano publicado em cache, selo) | Tarefa 5 (`sw.ts`, `sw-regras.ts`, `SeloOffline`, E2E com `setOffline`) |
| US-040 "Registro de acesso" (≤ 1 linha por paciente por dia) | Tarefa 6 (`access_events`, `registrarAcesso`) |
| US-041 (refeições em ordem, próxima destacada, medida e gramas, substituições, "Sem plano", PDF) | Tarefa 4; "Sugestão de receita" → Plano 07 (desvio) |
| US-042 (registro com foto HEIC, JPEG ≤ 1600 px sem EXIF, limite 10/dia, arquivo inválido, cota) | Tarefa 7 |
| US-043 (feed com não vistos primeiro, `visto_pela_nutri_em`, comentário, push) | Tarefas 8 e 6 (`avisarComentario`) |
| US-044 (gráficos de peso e medidas, orientações, sem notas e sem exames, %G com a opção) | Tarefa 9 |
| US-045 (1,4 kg em "Cereais e derivados", sem substituições, comprado no aparelho) | Tarefa 10 |
| US-046 (baixar meus dados por e-mail 24 h sem notas e sem rascunho; pedir exclusão, tarefa no painel, e-mail) | Tarefas 2 (escopo) e 11 |
| US-011 "Revogar o WhatsApp" e "Nova versão do termo" | Tarefas 11 e 3 |
| US-018 "fotos do diário apagadas na hora"; P06-08 conta do titular | Tarefa 11 |
| US-025 push/e-mail de plano novo (adiado do Plano 04) | Tarefa 6 |
| US-032/033/035 pelo PWA (P06-09), RN-06 | Tarefa 12 |
| RN-07, RN-08, RN-13, RN-15, RN-18 | Tarefas 7, 3, 10, 3, 7 |
| RNF-06 (sessão do paciente de 30 dias que desliza — P06-11) | Tarefa 6 |
| RNF-08 (auditoria, exportação, anonimização) | Tarefas 1, 2, 4, 7, 8, 9, 11 (D22) |
| RNF-09 / RNF-10 (Android/iOS, axe WCAG 2.1 AA) | Tarefas 5 e 13 (+ runbook para o iOS) |
| P-16 (a)–(d) | Tarefas 1, 11, (D5), 2 |
| INT-03 (inscrição, `VAPID_PUBLIC_KEY`, 404/410) | Tarefa 6 (o envio e a limpeza já são do Plano 05) |

**2. Placeholders:** nenhum "TBD"/"implementar depois"; os passos de código trazem o código. Os trechos em prosa são trocas mecânicas em arquivos existentes (imports, entradas de listas, `case` de template no formato dos vizinhos, a chamada nova dentro de uma função existente), com o texto exato a usar, — sem decisão de desenho pendente.

**3. Consistência de tipos e nomes:** `PACIENTE_ESCREVE`/`findPacienteEscritaViolations`/`app_allow_paciente_escrita` (T1) crescem em T2 (`stored_files`), T6 (`access_events`, `push_subscriptions`), T7 (`diary_entries`), T11 (`privacy_requests`, `data_exports`), sempre migration + lista na mesma tarefa; `salvarArquivo(…, { patientId })` + `TIPOS_DO_PACIENTE` (T2) em T7 e no job da foto; `withConta` (T3) só em `vinculosDaConta`, que T6 (`inscreverAparelho` usa `acesso.vinculos`) e T11 (`anonimizarVencidos`, `todos: true`) reaproveitam; `requirePaciente`/`requireApiPaciente`/`PacienteAccess` (T3) em todas as telas e rotas de T4–T12; `CACHE_PLANO`/`URL_PLANO` (T5) no `sw.ts` e no `SairPortal`; `limparAparelho` (T5 → T6, versão completa na T6); `urlDaNotificacao` (T6) no `sw.ts`; `avisarComentario` (T6) em `comentarRegistro` (T8); `avisarPlanoNovo` (T6) em `publicarPlano`; `paraRegistro`/`RegistroDoDiario` (T7) em T8; `MSG_DIARIO`/`COMENTARIO_MAX` (T7) em T8; `montarDados(…, escopo)` e `EscopoExportacao` (T2) em T11; `ITENS_DO_PORTAL` cresce em T4, T7, T9, T10, T11, T12; `pacienteNoPortal`/`publicarPlanoSimples`/`avaliar`/`mostrarPercGordura`/`marcarParaPaciente` (`e2e/portal.ts`) usados até T13; `foto_status` com `'removida'` (T7) usado em T11.

**4. Review Focus:** 1 (sessão onde não deve) → T3 (`requirePaciente`, `escolherVinculo` com cookie forjado, arquivado, suspenso, nutricionista no portal, E2E de arquivar) e T13; 2 (escrita fora do permitido) → T1 (`paciente-escrita.test.ts`, matriz de isolamento, suíte do Plano 05) e T2 (`paciente_arquivos`); 3 (foto) → T7 (tipo pelo conteúdo, 10 MB, 40 MP, corrompida, HEIC, EXIF, corrida do 11º, cota, idempotência); 4 (aparelho compartilhado) → T5 (`podeGuardarPlano`, `precisaBuscarPlano`/`conferirDono`, `Clear-Site-Data` + `nd_vinculo` apagado, E2E "Plano" pelo menu, "Sair" e sessão vencida apagam o cache) e T6 (`cancelarAparelho` em todos os vínculos, `app_soltar_endpoint_push`/`sincronizar`, `urlDaNotificacao`); 5 (fuso) → T4 (21:00 → café do dia seguinte), T6 (23:30/00:10), T7 (limite no dia de Brasília), T11 (prazo do pedido feito às 23:00), T12 (`precisaDaSigla`).

## Decisões para o dono

O plano já está escrito com a recomendação de cada uma; responder só as que quiser mudar. As marcadas com ★ na tabela "Decisões de desenho" são estas:

1. **D1 — escrita do paciente negada por padrão no banco** (todas as tabelas, com lista do que o portal grava). *Recomendado.* Alternativa: só as três tabelas do P-16.
2. **D3 — escolha do consultório lembrada por 30 dias** (cookie), com "Trocar de nutricionista" no Perfil. *Recomendado.* Alternativa: perguntar sempre ao entrar.
3. **D5 — sem "Histórico de acessos" no portal no MVP** (o P-16 c deixa de se aplicar). *Recomendado.* Alternativa: item novo no backlog.
4. **D6 — só "Meu plano" offline**, guardado no aparelho até o "Sair". *Recomendado.* Alternativa: nenhum dado de saúde em cache (sem offline — desvio da US-040).
5. **D8 — texto do push do comentário "Sua nutricionista comentou seu diário"** (da spec, sem nome). *Recomendado.*
6. **D10 — aceitar HEIC com `heic-decode`** (biblioteca gratuita, WASM, só no worker; risco jurídico baixo da patente do HEVC). *Recomendado.* Alternativa: recusar HEIC (o iPhone já converte para JPEG no envio pelo Safari).
7. **D11 — o paciente não edita nem apaga registro do diário no MVP.** *Recomendado.* Alternativa: "Apagar registro" enquanto não comentado (backlog).
8. **D16 — "Baixar meus dados" no máximo 1 vez a cada 24 h.** *Recomendado.* Alternativa: sem limite.
9. **D18 — anonimizar a conta de login do titular só quando ele não tiver outro consultório.** Já decidido pelo dono em 30/09/2026; só confirmar o detalhe "outro consultório vivo mantém a conta".
10. **D21 — ícones genéricos do NutriDebby** (folha verde). *Recomendado* por ora; o dono pode mandar a arte final depois.
11. **D22 — auditar também a leitura feita pelo próprio paciente** ("Visualizou Plano alimentar" com o nome do paciente no histórico da nutricionista). *Recomendado* (regra 8 e o precedente do Plano 03). Alternativa: não auditar a leitura do próprio titular.

Pontos que precisam de atenção (não são decisões):
- **Backup (P02-11, etapas 6 e 8) pendente**: o portal é o primeiro lugar em que o paciente grava dado de saúde.
- **Variável `VAPID_PUBLIC_KEY` no app** (Easypanel) no deploy — sem ela o push do portal fica desligado.
- **Teste manual no iPhone e no Android** (runbook): o CI não alcança um serviço de push real nem o Safari do iOS.
- A migration 0072 para se achar arquivo de paciente sem dono (não apaga nada sozinha).

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa, revisão final do branch no fim) — as 13 tarefas dependem umas das outras por interfaces bem definidas (a sessão da T3 entra em todas as telas; a guarda da T1 cresce em cinco tarefas), e um erro de RLS, de cache no aparelho ou de foto com GPS é caro de desfazer em produção.

# Runbook do dono — Mensagens e recados (Plano 25)

Origem: spec [`2026-11-17-nutridebby-25-chat-recados-design.md`](../superpowers/specs/2026-11-17-nutridebby-25-chat-recados-design.md)
(v0.3, §9.9) e plano [`2026-11-17-nutridebby-25-chat-recados.md`](../superpowers/plans/2026-11-17-nutridebby-25-chat-recados.md)
(Task 1). Entrega em quatro PRs: **PR 1** (fundação no banco: tabelas, RLS, gatilhos, funções e guardas — nada visível),
**PR 2** (conversa de texto), **PR 3** (anexos, dúvida da IA Nutri respondida pela conversa e recados) e **PR 4** (recado
por local de atendimento, só com o Plano 23 PR 2 na `main`).

Este runbook nasce no PR 1 e é completado nas tarefas T5 (titular: exportação e anonimização), T8 (anexos) e T10
(recados), cada uma com a própria seção "Volta atrás" (CH-D52).

---

## 1. PR 1 — fundação no banco

O PR 1 só **acrescenta** (spec §9.9, "expansão, nunca contração"):

- duas migrations — a gerada `mensagens` (as sete tabelas novas: `chat_conversas`, `chat_mensagens`, `chat_leituras`,
  `chat_configuracoes`, `chat_avisos_nutri`, `chat_horarios` e `recados`, e os CHECKs ampliados) e a custom `rls_mensagens` (RLS, políticas,
  auditoria, `REVOKE`/`GRANT`, o `EXCLUDE` do horário, os gatilhos e as funções). O número de cada uma é o que o
  `pnpm db:generate` der em cima da `main` do momento;
- três CHECKs **ampliados** (só valores novos; os antigos continuam aceitos): `notifications.tipo` (+ `chat_mensagem`,
  `recado`), `stored_files.tipo` (+ `chat_anexo`, `chat_anexo_original`) e `ia_nutri_mensagens.resolucao`
  (+ `respondida`);
- a política `paciente_arquivo_insert` de `stored_files` refeita com mais um tipo (`chat_anexo_original`): o paciente
  continua gravando a foto original do diário e o original do exame enviado.

Nenhuma coluna nova em tabela existente; nada é apagado nem renomeado. Nenhuma tela, rota, item de menu ou aviso muda:
o código que usa as tabelas chega no PR 2.

**Antes do merge** (merge = deploy; as migrations rodam sozinhas no boot):

1. OK explícito do dono no PR; nunca das 03h às 07h30 BRT.
2. **Sem snapshot da Hostinger** (o snapshot congela a VPS, aviso de 06/11/2026): a migration é só aditiva e o backup
   restic diário cobre o banco.
3. Depois do deploy, conferir no log do `nutri_app` a linha "Migrations aplicadas" e que o painel e o app do paciente
   abrem normalmente (nada muda para quem usa).

### Volta atrás (PR 1)

Voltar para a imagem anterior ao PR 1 **não exige desfazer nada no banco**. A imagem anterior não conhece as sete tabelas
novas e simplesmente as ignora; os CHECKs ampliados aceitam todos os valores que ela grava; a política
`paciente_arquivo_insert` refeita aceita os mesmos tipos de antes (mais um que ela nunca usa). Como nenhuma tela usa as
tabelas antes do PR 2, elas estão vazias.

- **Não** apagar as tabelas nem reverter as migrations à mão: a próxima imagem (com o PR 1) as encontra prontas, e o
  registro das migrations (`drizzle.__drizzle_migrations`) continua coerente.
- Se o problema for na própria migration (o boot falhou ao aplicá-la), a transação da migration é desfeita inteira: o
  banco fica como antes e a imagem anterior sobe sem nada a fazer. Abrir um incidente e não tentar de novo sem a correção.

Depois que a conversa estiver em uso (PR 2 em diante), voltar para uma imagem anterior ao PR 2 tem os efeitos da §9.9 da
spec (nada apaga nem expõe dado; a rede de limpeza recolhe ao voltar). Essa parte é escrita nas seções das T5, T8 e T10.

---

## 2. PR 2 — conversa de texto (titular: exportação e anonimização)

O PR 2 não tem migration: usa as tabelas, os gatilhos e as funções do PR 1. Para o titular, o que muda:

- **Exportação** (`dados.json`, nos dois escopos): as seções `conversa` (liberação com nome e CRN de quem liberou, forma
  do TCLE, pausa) e `mensagens` (autor, carimbo só nas da nutricionista, recado, resposta à dúvida e risco pelo rótulo).
  Os anexos no ZIP entram no PR 3.
- **Pedido de exclusão atendido:** a conversa fica, só para consulta (é prontuário, CH-D2/CH-D25); os avisos pendentes do
  chat viram "ignorada" pelo caminho de sempre.
- **Anonimização** (job diário `retencao-lgpd`): `apagarConversaDoTitular` marca como `falhou` o anexo ainda em
  processamento, apaga os originais, depois os anexos convertidos, e chama `app_chat_apagar_do_titular`. A transação
  final reconfere que não sobrou anexo de chat (se sobrou, nada é anonimizado e o dia seguinte tenta de novo). A **rede
  de limpeza** (`apagarConversasDosAnonimizados`) roda no início de cada tenant e apaga a conversa de quem já tem
  `anonimizado_em`.

### Volta atrás (PR 2)

Voltar para a imagem anterior ao PR 2 depois que a conversa estiver em uso (spec §9.9). Nada apaga nem expõe dado, mas:

1. **Anonimização sem o chat.** A imagem antiga anonimiza sem conhecer o chat: grava `anonimizado_em` e deixa a conversa,
   as mensagens e os anexos desses titulares. Quando a imagem nova voltar, a rede de limpeza
   (`apagarConversasDosAnonimizados`, no início de cada tenant do job diário) apaga tudo. Não apagar à mão.
2. **Avisos do chat no worker antigo.** Um worker com imagem anterior ao PR 2 não conhece os tipos `chat_mensagem` e
   `recado` de `notifications`: ao pegar uma linha dessas, grava `falhou` com o erro `sem_modelo`. Nada vaza (a linha
   não tem conteúdo), mas **o aviso se perde**: o paciente não recebe aquele push ou e-mail. Depois da volta, as
   mensagens continuam no app e aparecem como não lidas.
3. **Exportação sem a conversa.** O ZIP gerado pela imagem antiga sai sem as seções `conversa` e `mensagens`. Se um
   titular pediu a exportação nessa janela, gerar de novo depois que a imagem nova voltar.
4. **Anexos em processamento** (só a partir do PR 3) ficam parados até a varredura nova (RN-474).

Registrar no incidente a janela (início e fim) em que a imagem antiga ficou no ar.

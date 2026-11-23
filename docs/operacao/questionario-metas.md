# Runbook do dono — Questionário pré-consulta, recordatório 24 h e metas (Plano 27)

Origem: spec [`2026-11-17-nutridebby-27-questionario-recordatorio-metas-design.md`](../superpowers/specs/2026-11-17-nutridebby-27-questionario-recordatorio-metas-design.md)
e plano [`2026-11-17-nutridebby-27-questionario-recordatorio-metas.md`](../superpowers/plans/2026-11-17-nutridebby-27-questionario-recordatorio-metas.md)
(QP-D51). Entrega em quatro PRs: **PR 1** (fundação: tabelas, RLS, gatilhos, guardas e semente), **PR 2** (questionário
pré-consulta), **PR 3** (metas e o registro diário no app) e **PR 4** (recordatório 24 h). Este runbook nasce no PR 1 e
cresce a cada PR (uma seção por PR, com a "Volta atrás").

Regras fixas, para todos os PRs:

- **Merge = deploy**, sempre com o OK do dono, nunca das 03h às 07h30 BRT (backup das 03h e a janela do worker).
- **Sem snapshot da Hostinger** com a produção no ar: até a Hostinger resolver (aviso de 06/11/2026), o snapshot congela
  a VPS e exige reboot manual. A proteção é a migration só aditiva e o backup restic diário (conferir em
  `/var/log/backup.log` que o da madrugada do dia do merge terminou bem).
- **Antes de voltar para uma imagem anterior ao PR 2**: desligar o envio automático e cancelar os envios abertos (R-535;
  detalhes na seção do PR 2, quando ela existir).

---

## 1. PR 1 — fundação (só banco, nenhuma tela)

### O que muda

Duas migrations, que rodam sozinhas no boot do `nutri_app` (com o `DATABASE_URL_MIGRATOR`, regra 7):

- a **gerada** `…_questionario_recordatorio_metas`: as seis tabelas novas (`questionario_envios`, `recordatorios`,
  `recordatorio_itens`, `metas_modelos`, `metas_paciente`, `metas_registros`), as colunas novas de `anamnesis_templates`
  (`finalidade` com default permanente `'anamnese'`, `envio_auto`, `envio_auto_dias`), o índice do modelo padrão refeito
  por finalidade, o UNIQUE novo em `anamneses` e o tipo `questionario_novo` no CHECK de `notifications`;
- a **custom** `…_rls_questionario_recordatorio_metas`: RLS, `staff_only` (agora também em `anamnesis_templates`),
  auditoria, `REVOKE DELETE`, a política `paciente_meta_registro_com_conta`, os gatilhos e as funções de fuso.

É **expansão, nunca contração**: nenhuma coluna existente muda, as colunas novas têm default ou são anuláveis, e as linhas
atuais de `anamnesis_templates` ficam todas `anamnese` (nada colide no índice refeito).

### Antes do merge

1. Conferir que o PR foi regenerado sobre a `main` do momento (`docs/operacao/sessoes-paralelas.md` §5): número das duas
   migrations, `drizzle/meta/_journal.json` e CI verde.
2. Conferir o backup da madrugada (`/var/log/backup.log`).
3. OK explícito do dono no PR.

### Depois do deploy

- O app sobe normalmente (a migration roda no boot). Nada aparece para a Debby nem para os pacientes: não há tela nova
  até o PR 2.
- Conferência rápida (só pelo painel do Easypanel, logs do `nutri_app`): a linha de migrations aplicadas, sem erro.

### Volta atrás

- **A imagem anterior sobre o banco novo funciona.** Ela não conhece as tabelas novas (não as lê nem grava), grava
  `anamnesis_templates` sem a coluna `finalidade` (o default `'anamnese'` vale para sempre), cria o modelo padrão com
  `onConflictDoNothing()` sem alvo (continua valendo com o índice por finalidade) e nunca lê modelos em contexto de
  paciente (o `staff_only` novo não a afeta). Voltar de imagem pelo Easypanel é seguro.
- **Nunca desfazer a migration** (o drizzle não tem "down"): depois que houver qualquer envio, recordatório ou meta, voltar
  o banco para antes do PR 1 apagaria prontuário. Se um problema exigir isso, parar e decidir com o dono; o único caminho
  seria restaurar o backup (`docs/operacao/restauracao.md`), perdendo tudo o que foi gravado depois dele.

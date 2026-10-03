-- D2 (Plano 06): a conta de paciente não tem tenant (§3: pode ser paciente de mais de uma nutricionista). No contexto
-- `conta` (withConta), só esta política libera linhas, e só em patients, só SELECT, só da própria conta. Sem
-- app.tenant_id, tenant_isolation não casa em tabela nenhuma; as RESTRICTIVE (publico_negado, patient_isolation,
-- paciente_sem_*) não se aplicam a este papel ou não são de leitura. Toda outra tabela dá 0 linhas, menos a TACO
-- (`foods` com `tenant_id` nulo, `taco_leitura`: dado público de referência, legível por qualquer sessão).
CREATE POLICY paciente_por_conta ON patients AS PERMISSIVE FOR SELECT
  USING (app_current_role() = 'conta' AND user_id = app_current_user());

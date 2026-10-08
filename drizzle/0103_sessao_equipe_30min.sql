-- RNF-06 (P12-14, decisão do dono 07/10/2026): sessões da equipe abertas antes da regra nova (12 h de inatividade)
-- passam a valer no máximo 30 min depois da última atividade registrada e 8 h depois do login, como a 0005 fez com as
-- 12 h. Assim, a invariante expires_at ≤ LEAST(updated_at + 30 min, created_at + 8 h) vale para toda linha da equipe e
-- /api/auth/* também recusa nativamente a sessão ociosa ou vencida (requireUser e requireApiUser já recusavam). Sessão
-- que já passou de um dos dois fica com expires_at no passado e sai na próxima leitura. O paciente não muda.
-- `session` não tem tenant_id nem gatilho de auditoria.
UPDATE "session" s
   SET "expires_at" = LEAST(s."updated_at" + interval '30 minutes', s."created_at" + interval '8 hours')
  FROM "user" u
 WHERE u."id" = s."user_id"
   AND u."app_role" IN ('admin', 'nutri')
   AND s."expires_at" > LEAST(s."updated_at" + interval '30 minutes', s."created_at" + interval '8 hours');

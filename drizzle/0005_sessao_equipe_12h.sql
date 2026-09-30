-- RNF-06 (Ruling R48): sessões da equipe criadas antes do limite de 12 h no expiresAt
-- passam a valer no máximo 12 h depois da última atividade registrada. Com o Better Auth
-- sem renovação própria (disableSessionRefresh), a invariante expires_at ≤ updated_at + 12 h
-- vale para toda linha da equipe, e /api/auth/* recusa a sessão ociosa nativamente.
UPDATE "session" s
   SET "expires_at" = s."updated_at" + interval '12 hours'
  FROM "user" u
 WHERE u."id" = s."user_id"
   AND u."app_role" IN ('admin', 'nutri')
   AND s."expires_at" > s."updated_at" + interval '12 hours';

-- P09-02 (b): registro do admin é só de inclusão para a aplicação (como audit_log, 0002, e consents, 0009)
REVOKE UPDATE, DELETE, TRUNCATE ON admin_actions FROM nutri_app_role;

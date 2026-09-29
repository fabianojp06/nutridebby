-- Só o script do host (superusuário local no container nutri_db) registra backups; o app só lê.
REVOKE INSERT, UPDATE, DELETE ON backup_runs FROM nutri_app_role;
